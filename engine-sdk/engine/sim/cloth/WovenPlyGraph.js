// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Author independent ply chains. Mass and nominal tensile capacity are shared,
 * never copied, across the plies. Variation is an explicit estimated property,
 * deterministic in material coordinates, not random motion or a tear mask. */
export function createWovenPlyGraph(cloth, { plyCount = 3, twists = 4, direction = 1, strengthVariation = .15 } = {}) {
    if (!Number.isInteger(plyCount) || plyCount < 1 || plyCount > 6 || !Number.isFinite(twists) || twists < 0 || twists > 12
        || ![-1, 1].includes(direction) || !Number.isFinite(strengthVariation) || strengthVariation < 0 || strengthVariation > .5) throw new RangeError('Invalid physical yarn construction');
    const count = cloth.columns * cloth.rows * 2, particles = cloth.warp.flatMap((p, i) => [p, cloth.weft[i]]);
    const ids = new Map(particles.map((p, i) => [p, i])), P = plyCount;
    const restPositions = new Array(count * P);
    const radius = P === 1 ? cloth.radius : cloth.radius * Math.sin(Math.PI / P) / (1 + Math.sin(Math.PI / P));
    const offset = P === 1 ? 0 : cloth.radius - radius;
    const nodes = new Float32Array((count * P + 12) * 12), arcs = new Map();
    const length = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
    const position = id => restPositions[id];
    const normalize = v => { const l = Math.hypot(...v); return v.map(n => n / Math.max(l, 1e-12)); };
    const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
    for (const thread of cloth.threads) {
        let arc = 0;
        thread.particles.forEach((particle, index) => {
            if (index) arc += thread.edges[index - 1].constraint.restLength;
            arcs.set(particle, arc);
            const before = thread.particles[Math.max(0, index - 1)], after = thread.particles[Math.min(thread.particles.length - 1, index + 1)];
            const tangent = normalize(['x','y','z'].map(k => after[k] - before[k]));
            const normal = normalize(cross(tangent, thread.family === 'warp' ? [1,0,0] : [0,1,0])), binormal = cross(tangent, normal);
            const restTangent = normalize([0,1,2].map(k => cloth.rest[ids.get(after)][k] - cloth.rest[ids.get(before)][k]));
            const restNormal = normalize(cross(restTangent, thread.family === 'warp' ? [1,0,0] : [0,1,0])), restBinormal = cross(restTangent, restNormal);
            for (let ply = 0; ply < P; ply++) {
                const phase = direction * twists * arc * 2 * Math.PI + ply * 2 * Math.PI / P;
                const point = ['x','y','z'].map((key, axis) => particle[key] + offset * (Math.cos(phase) * normal[axis] + Math.sin(phase) * binormal[axis]));
                restPositions[ids.get(particle) * P + ply] = [0,1,2].map(axis => cloth.rest[ids.get(particle)][axis] + offset * (Math.cos(phase) * restNormal[axis] + Math.sin(phase) * restBinormal[axis]));
                nodes.set([...point, particle.invMass * P, ...point, radius, particle.vx, particle.vy, particle.vz, 0], (ids.get(particle) * P + ply) * 12);
            }
        });
    }
    const structural = new Set(cloth.edges.map(e => e.constraint)), crossing = new Set(cloth.crossings);
    const source = cloth.solver.constraints.filter(c => c.particleA && c.particleB);
    const sourceBends = source.filter(c => !structural.has(c) && !crossing.has(c));
    const ordered = [], colors = [], clones = new Map();
    const append = group => { colors.push([ordered.length, group.length]); ordered.push(...group); };
    const color = constraints => {
        const groups = [], occupied = [];
        for (const c of constraints) {
            const a = c.a, b = c.b; let i = occupied.findIndex(s => !s.has(a) && !s.has(b));
            if (i < 0) { i = groups.length; groups.push([]); occupied.push(new Set()); }
            occupied[i].add(a); occupied[i].add(b); groups[i].push(c);
        }
        groups.forEach(append);
    };
    const clone = (c, kind) => {
        const result = Array.from({length:P}, (_, ply) => {
            const a = ids.get(c.particleA) * P + ply, b = ids.get(c.particleB) * P + ply;
            return {a, b, kind, source:c, ply, rest:length(position(a),position(b)), compliance:c.compliance * P, broken:c.broken, dependencies:[]};
        }); clones.set(c, result); return result;
    };
    color([...structural].flatMap(c => clone(c, 0)));
    const edgeCount = ordered.length;
    color(sourceBends.flatMap(c => clone(c, 2)));
    const crossingOffset = ordered.length;
    append(cloth.crossings.flatMap(c => clone(c, 1)));
    const nodeEdges = new Map();
    for (const thread of cloth.threads) for (let ply = 0; ply < P; ply++) {
        thread.edges.forEach((edge, index) => {
            const link = clones.get(edge.constraint)[ply];
            link.previous = clones.get(thread.edges[Math.max(0,index-1)].constraint)[ply];
            link.next = clones.get(thread.edges[Math.min(thread.edges.length-1,index+1)].constraint)[ply];
            link.before = ids.get(thread.particles[Math.max(0,index-1)]) * P + ply;
            link.after = ids.get(thread.particles[Math.min(thread.particles.length-1,index+2)]) * P + ply;
            link.arc = arcs.get(edge.constraint.particleA);
            link.width = thread.family === 'warp' ? cloth.width / cloth.columns : cloth.height / cloth.rows;
            for (const id of [link.a,link.b]) { if(!nodeEdges.has(id))nodeEdges.set(id,[]);nodeEdges.get(id).push(link); }
            for (const bend of edge.dependents) clones.get(bend)[ply].dependencies.push(link);
        });
    }
    // Local inter-ply cohesion. Releasing either end of a severed segment frees
    // its own tip; these links never bridge across a cut along the yarn.
    const bindings = [];
    if(P>1)for(let node=0;node<count;node++)for(let ply=0;ply<(P===2?1:P);ply++) {
        const a=node*P+ply,b=node*P+(ply+1)%P;
        const dependencies=[...(nodeEdges.get(a)||[]),...(nodeEdges.get(b)||[])];
        while(dependencies.length<4)dependencies.push(dependencies.at(-1));
        bindings.push({a,b,kind:3,rest:length(position(a),position(b)),compliance:2e-6*P,dependencies});
    }
    color(bindings);
    const mapping = new Map(ordered.map((c,i)=>[c,i]));
    // The colorer keeps a bundle's disjoint plies consecutive, an ABI used by
    // the sheet proxy and surface/strand renderer.
    for(const c of structural){const copies=clones.get(c);if(copies.some((v,p)=>mapping.get(v)!==mapping.get(copies[0])+p))throw new Error('Noncontiguous ply bundle');}
    const data=new ArrayBuffer(ordered.length*64),words=new Uint32Array(data),floats=new Float32Array(data);
    const variation = id => { let x=Math.imul(id+1,0x45d9f3b);x=Math.imul(x^(x>>>16),0x45d9f3b);return .5+(x>>>0)/4294967296; };
    for(const c of structural){const copies=clones.get(c);let sum=0;copies.forEach(v=>{v.strength=1+strengthVariation*2*(variation(mapping.get(v))-1);sum+=v.strength;});copies.forEach(v=>v.strength/=sum);}
    ordered.forEach((c,i)=>{
        const d=c.dependencies.map(v=>mapping.get(v));
        words.set([c.a,c.b,c.kind===0?c.before:d[0]??0,c.kind===0?c.after:d[1]??0],i*16);
        let sign=0;
        if(c.kind===1){
            const grid=Math.floor(c.a/(2*P)),normal=[0,0,0];
            const point=id=>position((id*2)*P+c.ply).map((v,k)=>(v+position((id*2+1)*P+c.ply)[k])*.5);
            for(const cell of cloth.cells){if(!cell.indices.includes(grid))continue;const [a,b,,d]=cell.indices.map(point);
                const n=cross(d.map((v,k)=>v-a[k]),b.map((v,k)=>v-a[k]));for(let k=0;k<3;k++)normal[k]+=n[k];}
            const n=normalize(normal),a=position(c.a),b=position(c.b);sign=a.reduce((sum,v,k)=>sum+(v-b[k])*n[k],0);
        }
        floats.set([c.rest,c.compliance,0,c.kind===0?c.arc:sign],i*16+4);
        words.set([c.broken?1:0,c.kind,c.kind===0?mapping.get(c.previous):d[2]??0,c.kind===0?mapping.get(c.next):d[3]??0],i*16+8);
        floats.set([c.strength??0,(c.width??0)/P,0,0],i*16+12);
    });
    const cells=new Uint32Array(cloth.cells.length*8);
    cloth.cells.forEach((c,i)=>cells.set([...c.indices,...c.edges.map(e=>mapping.get(clones.get(e.constraint)[0]))],i*8));
    return {nodes,links:new Uint8Array(data),cells,colors,crossingOffset,edgeCount,plyCount:P,radius,twists,direction,strengthVariation};
}
