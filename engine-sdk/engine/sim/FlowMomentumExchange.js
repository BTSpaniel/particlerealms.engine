// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import {vec3Add,vec3Sub,vec3Scale,vec3Dot,vec3Cross,vec3Length} from '../core/math/MathVec3.js';
import {quatMultiply,quatRotateVec3} from '../core/math/MathQuat.js';

const finite=value=>Number.isFinite(value);
const vector=(value,label)=>{
    if(!value||value.length!==3||!Array.from(value).every(finite))throw new RangeError(`${label} must be finite xyz`);
    return Array.from(value);
};
const nativeVector=value=>[value.get_x(),value.get_y(),value.get_z()];
const nativeQuaternion=value=>[value.get_x(),value.get_y(),value.get_z(),value.get_w()];
const positive=(value,label)=>{if(!finite(value)||!(value>0)||!finite(1/value))throw new RangeError(`${label} must be finite and strictly positive`);return value;};
const normalizedQuaternion=(value,label)=>{
    if(!value||value.length!==4||!Array.from(value).every(finite))throw new RangeError(`${label} is invalid`);
    const norm=Math.hypot(...value);positive(norm,label);return Array.from(value,part=>part/norm);
};
function inertiaProduct(body,value,inverse=false){
    const q=body.inertiaRotation,local=quatRotateVec3(value,[-q[0],-q[1],-q[2],q[3]]);
    return quatRotateVec3(local.map((part,axis)=>inverse?part/body.inertia[axis]:part*body.inertia[axis]),q);
}
function massRecord(record,rigid){
    const value={position:vector(record.position,'Mass center'),mass:positive(record.mass,'Mass'),velocity:vector(record.velocity,'Velocity')};
    if(rigid){value.angularVelocity=vector(record.angularVelocity,'Angular velocity');value.inertia=vector(record.inertia,'Principal inertia');
        value.inertia.forEach(part=>positive(part,'Principal inertia'));value.inertiaRotation=normalizedQuaternion(record.inertiaRotation,'Inertia rotation');}
    return value;
}

/** Snapshot the actual finite native rigid body, including its mass frame.
 * A prescribed kinematic/static wall remains a separately accounted one-way
 * boundary. This operator cannot silently replace it with an infinite mass.
 */
export function captureFlowRigidBody(world,body){
    const actor=body?._actor,P=world?.module;
    if(!world?.ready||world.destroyed||world.bodies.get(body.handle)!==body||!actor?.getMass
        ||!actor.getMassSpaceInertiaTensor||!actor.getCMassLocalPose||!actor.setLinearVelocity||!actor.setAngularVelocity
        ||actor.getRigidBodyFlags().isSet(P.PxRigidBodyFlagEnum.eKINEMATIC))throw new RangeError('Paired Flow exchange requires an owned finite dynamic rigid body');
    const pose=actor.getGlobalPose(),p=nativeVector(pose.get_p()),q=nativeQuaternion(pose.get_q());
    const local=actor.getCMassLocalPose(),center=nativeVector(local.get_p()),rotation=nativeQuaternion(local.get_q());
    const raw={position:vec3Add(p,quatRotateVec3(center,q)),mass:actor.getMass(),velocity:nativeVector(actor.getLinearVelocity()),
        angularVelocity:nativeVector(actor.getAngularVelocity()),inertia:nativeVector(actor.getMassSpaceInertiaTensor()),inertiaRotation:quatMultiply(q,rotation)};
    const value=massRecord(raw,true);
    return {...value,body,actor,fingerprint:[...p,...q,...center,...rotation,raw.mass,...raw.velocity,...raw.angularVelocity,...raw.inertia]};
}

/** Stage an inelastic, normal-only terminal exchange at discrete fluid centers.
 * Every impulse is paired at the SAME point for linear/angular conservation.
 * This is not a coupled pressure solve. Scalar advection, combustion and other
 * native projections are outside this operator's momentum/energy ledger.
 * No source data is mutated, including on finite-domain or convergence failure.
 */
export function solveFlowMomentumExchange(gasInput,bodyInput,contacts,{maximumSweeps=128,velocityTolerance=1e-7,
    roundingVelocityTolerance=1e-5,momentumRelativeTolerance=2e-5,angularRelativeTolerance=2e-5,energyRelativeTolerance=2e-5}={}){
    if(!Array.isArray(gasInput)||!Array.isArray(bodyInput)||!Array.isArray(contacts)||gasInput.length>65536||bodyInput.length>4096||contacts.length>393216
        ||!Number.isInteger(maximumSweeps)||maximumSweeps<1||maximumSweeps>4096
        ||![velocityTolerance,roundingVelocityTolerance,momentumRelativeTolerance,angularRelativeTolerance,energyRelativeTolerance].every(value=>finite(value)&&value>0))throw new RangeError('Invalid paired Flow solve dimensions or controls');
    const gas=gasInput.map(value=>massRecord(value,false)),bodies=bodyInput.map(value=>massRecord(value,true));
    const beforeGas=gas.map(value=>({...value,velocity:[...value.velocity]}));
    const beforeBodies=bodies.map(value=>({...value,velocity:[...value.velocity],angularVelocity:[...value.angularVelocity]}));
    const constraints=contacts.map((contact,index)=>{
        if(!Number.isInteger(contact.gas)||contact.gas<0||contact.gas>=gas.length||!Number.isInteger(contact.body)||contact.body<0||contact.body>=bodies.length)
            throw new RangeError('Paired contact references an unknown gas cell or body');
        const normal=vector(contact.normal,'Contact normal'),norm=vec3Length(normal);positive(norm,'Normal length');
        const n=vec3Scale(normal,1/norm),g=gas[contact.gas],b=bodies[contact.body],arm=vec3Sub(g.position,b.position),angular=vec3Cross(arm,n);
        const angularResponse=inertiaProduct(b,angular,true),inverseMass=1/g.mass+1/b.mass+vec3Dot(angular,angularResponse);
        positive(inverseMass,'Effective inverse mass');
        return {gas:contact.gas,body:contact.body,normal:n,arm,angularResponse,inverseMass,index,impulse:0};
    }).sort((a,b)=>a.gas-b.gas||a.body-b.body||a.index-b.index);
    const relative=constraint=>{
        const g=gas[constraint.gas],b=bodies[constraint.body];
        const value=vec3Dot(vec3Sub(g.velocity,vec3Add(b.velocity,vec3Cross(b.angularVelocity,constraint.arm))),constraint.normal);
        if(!finite(value))throw new RangeError('Paired contact arithmetic is nonfinite');return value;
    };
    let heatObligationJ=0,sweeps=0,maximumClosingVelocity=0;
    for(;sweeps<maximumSweeps;sweeps++){
        for(const c of constraints){
            const speed=relative(c);if(speed>=0)continue;
            const impulse=-speed/c.inverseMass,g=gas[c.gas],b=bodies[c.body],j=vec3Scale(c.normal,impulse);
            g.velocity=vec3Add(g.velocity,vec3Scale(j,1/g.mass));b.velocity=vec3Sub(b.velocity,vec3Scale(j,1/b.mass));
            b.angularVelocity=vec3Sub(b.angularVelocity,vec3Scale(c.angularResponse,impulse));
            c.impulse+=impulse;heatObligationJ+=.5*impulse*(-speed);
            if(![...g.velocity,...b.velocity,...b.angularVelocity,c.impulse,heatObligationJ].every(finite))throw new RangeError('Paired impulse or work exceeds finite arithmetic');
        }
        maximumClosingVelocity=0;
        for(const c of constraints)maximumClosingVelocity=Math.max(maximumClosingVelocity,-relative(c));
        if(maximumClosingVelocity<=velocityTolerance){sweeps++;break;}
    }
    if(maximumClosingVelocity>velocityTolerance)throw new Error('Paired Flow impulse solve exhausted its convergence budget');
    const origin=[...(bodies[0]?.position??gas[0]?.position??[0,0,0])];
    const measure=(gasState,bodyState)=>{
        const result={gasImpulseNs:[0,0,0],bodyImpulseNs:[0,0,0],gasAngularImpulseNms:[0,0,0],bodyAngularImpulseNms:[0,0,0],gasWorkJ:0,bodyWorkJ:0};
        gasState.forEach((value,index)=>{
            const start=beforeGas[index],dv=vec3Sub(value.velocity,start.velocity),impulse=vec3Scale(dv,value.mass);
            result.gasImpulseNs=vec3Add(result.gasImpulseNs,impulse);
            result.gasAngularImpulseNms=vec3Add(result.gasAngularImpulseNms,vec3Cross(vec3Sub(value.position,origin),impulse));
            result.gasWorkJ+=.5*value.mass*vec3Dot(dv,vec3Add(value.velocity,start.velocity));
        });
        bodyState.forEach((value,index)=>{
            const start=beforeBodies[index],dv=vec3Sub(value.velocity,start.velocity),dw=vec3Sub(value.angularVelocity,start.angularVelocity),impulse=vec3Scale(dv,value.mass);
            result.bodyImpulseNs=vec3Add(result.bodyImpulseNs,impulse);
            result.bodyAngularImpulseNms=vec3Add(result.bodyAngularImpulseNms,vec3Add(inertiaProduct(value,dw),vec3Cross(vec3Sub(value.position,origin),impulse)));
            result.bodyWorkJ+=.5*value.mass*vec3Dot(dv,vec3Add(value.velocity,start.velocity))+.5*vec3Dot(dw,inertiaProduct(value,vec3Add(value.angularVelocity,start.angularVelocity)));
        });
        if(!Object.values(result).flat().every(finite))throw new RangeError('Paired work/momentum receipt is nonfinite');return result;
    };
    const ideal=measure(gas,bodies),energyResidual=ideal.gasWorkJ+ideal.bodyWorkJ+heatObligationJ;
    const energyScale=Math.max(Number.MIN_VALUE,Math.abs(ideal.gasWorkJ)+Math.abs(ideal.bodyWorkJ)+heatObligationJ);
    const impulseScale=constraints.reduce((sum,c)=>sum+c.impulse,0),angularScale=constraints.reduce((sum,c)=>sum+c.impulse*(vec3Length(c.arm)+vec3Length(vec3Sub(bodies[c.body].position,origin))),0);
    if(![energyResidual,energyScale,impulseScale,angularScale].every(finite))throw new RangeError('Paired conservation normalization exceeds finite arithmetic');
    if(Math.abs(energyResidual)>2e-10*energyScale||vec3Length(vec3Add(ideal.gasImpulseNs,ideal.bodyImpulseNs))>2e-10*impulseScale
        ||vec3Length(vec3Add(ideal.gasAngularImpulseNms,ideal.bodyAngularImpulseNms))>2e-10*angularScale)throw new Error('Paired f64 conservation check failed');
    const roundedGas=gas.map(value=>({...value,velocity:value.velocity.map(Math.fround)}));
    const roundedBodies=bodies.map(value=>({...value,velocity:value.velocity.map(Math.fround),angularVelocity:value.angularVelocity.map(Math.fround)}));
    if(![...roundedGas.flatMap(value=>value.velocity),...roundedBodies.flatMap(value=>[...value.velocity,...value.angularVelocity])].every(finite))throw new RangeError('Paired result is outside native f32 range');
    const applied=measure(roundedGas,roundedBodies);
    let appliedMaximumClosingVelocity=0,maximumRoundingVelocity=0;
    for(const c of constraints){
        const g=roundedGas[c.gas],b=roundedBodies[c.body];
        const rounded=vec3Dot(vec3Sub(g.velocity,vec3Add(b.velocity,vec3Cross(b.angularVelocity,c.arm))),c.normal);
        const rounding=Math.abs(rounded-relative(c));
        if(!finite(rounded)||!finite(rounding))throw new RangeError('Native velocity rounding is nonfinite');
        appliedMaximumClosingVelocity=Math.max(appliedMaximumClosingVelocity,-rounded);maximumRoundingVelocity=Math.max(maximumRoundingVelocity,rounding);
    }
    // Accuracy limits are fixed BEFORE the solve. A measured rounding error is
    // evidence, never its own tolerance. Also bound each phase's net impulse
    // error: losing both sides of a small impulse cannot masquerade as closure.
    const roundingImpulseNs=vec3Add(applied.gasImpulseNs,applied.bodyImpulseNs),roundingAngularImpulseNms=vec3Add(applied.gasAngularImpulseNms,applied.bodyAngularImpulseNms);
    const linearError=Math.max(vec3Length(roundingImpulseNs),vec3Length(vec3Sub(applied.gasImpulseNs,ideal.gasImpulseNs)),vec3Length(vec3Sub(applied.bodyImpulseNs,ideal.bodyImpulseNs)));
    const angularError=Math.max(vec3Length(roundingAngularImpulseNms),vec3Length(vec3Sub(applied.gasAngularImpulseNms,ideal.gasAngularImpulseNms)),vec3Length(vec3Sub(applied.bodyAngularImpulseNms,ideal.bodyAngularImpulseNms)));
    const appliedEnergyResidualJ=applied.gasWorkJ+applied.bodyWorkJ+heatObligationJ;
    const energyError=Math.max(Math.abs(appliedEnergyResidualJ),Math.abs(applied.gasWorkJ-ideal.gasWorkJ),Math.abs(applied.bodyWorkJ-ideal.bodyWorkJ));
    const budgets={roundingVelocityTolerance,momentumRelativeTolerance,angularRelativeTolerance,energyRelativeTolerance,
        linearImpulseNs:momentumRelativeTolerance*impulseScale,angularImpulseNms:angularRelativeTolerance*angularScale,energyJ:energyRelativeTolerance*energyScale};
    if(![linearError,angularError,energyError,appliedEnergyResidualJ,...Object.values(budgets)].every(finite)
        ||maximumRoundingVelocity>roundingVelocityTolerance||appliedMaximumClosingVelocity>velocityTolerance+roundingVelocityTolerance
        ||linearError>budgets.linearImpulseNs||angularError>budgets.angularImpulseNms||energyError>budgets.energyJ)
        throw new Error('Native f32 paired exchange exceeds its configured physical accuracy budget');
    return {gas:roundedGas,bodies:roundedBodies,receipt:{abi:1,mode:'terminal-paired-normal-impulses',gasCells:gas.length,bodies:bodies.length,contacts:constraints.length,
        sweeps,maximumClosingVelocity,appliedMaximumClosingVelocity,maximumRoundingVelocity,velocityTolerance,angularOriginMetres:origin,heatObligationJ,ideal,applied,
        idealEnergyResidualJ:energyResidual,appliedEnergyResidualJ,budgets,
        physicalScales:{linearImpulseNs:impulseScale,angularImpulseNms:angularScale,energyJ:energyScale},linearError,angularError,energyError,
        kineticRoundingJ:applied.gasWorkJ+applied.bodyWorkJ-ideal.gasWorkJ-ideal.bodyWorkJ,roundingImpulseNs,roundingAngularImpulseNms}};
}
