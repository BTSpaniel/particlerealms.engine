/**
 * PhysXArticulations.js - PhysX Articulation Support
 * 
 * Articulations are optimized for chains of connected bodies like:
 * - Ropes and cables
 * - Ragdolls
 * - Robotic arms
 * - Vehicles (suspensions)
 * 
 * Per NVIDIA PhysX Best Practices:
 * "Articulations are much better at simulating articulated objects.
 * They can be used to model better ropes, bridges, vehicles, or ragdolls
 * out-of-the-box, without the need for workarounds."
 * 
 * Articulations provide:
 * - Better stability than joint chains
 * - Reduced jitter
 * - More accurate constraint solving
 * - Built-in tendon support for muscle simulation
 */

/**
 * Create a reduced coordinate articulation (PhysX 5.x)
 * @param {Object} world - Physics world
 * @param {Object} options - Articulation options
 * @returns {Object} Articulation handle
 */
export function createArticulation(world, options = {}) {
    if (!world || !world.module || !world.physics || !world.scene) {
        console.warn('[PhysXArticulations] World not ready');
        return null;
    }
    
    const PhysX = world.module;
    
    if (!PhysX.PxArticulationReducedCoordinate) {
        console.warn('[PhysXArticulations] Articulations not supported in this PhysX build');
        return null;
    }
    
    try {
        const articulation = world.physics.createArticulationReducedCoordinate();
        if (!articulation) {
            console.warn('[PhysXArticulations] Failed to create articulation');
            return null;
        }
        
        // Set solver iteration counts (articulations often need more)
        if (typeof articulation.setSolverIterationCounts === 'function') {
            const posIters = options.positionIterations || 16;
            const velIters = options.velocityIterations || 4;
            articulation.setSolverIterationCounts(posIters, velIters);
        }
        
        // Enable self-collision if requested
        if (options.selfCollision && typeof articulation.setArticulationFlag === 'function') {
            if (PhysX.PxArticulationFlagEnum && PhysX.PxArticulationFlagEnum.eDISABLE_SELF_COLLISION !== undefined) {
                articulation.setArticulationFlag(PhysX.PxArticulationFlagEnum.eDISABLE_SELF_COLLISION, !options.selfCollision);
            }
        }
        
        return {
            _articulation: articulation,
            links: [],
            world,
        };
    } catch (e) {
        console.error('[PhysXArticulations] Error creating articulation:', e);
        return null;
    }
}

/**
 * Create the root link of an articulation
 * @param {Object} articulation - Articulation handle
 * @param {Object} options - Link options (position, geometry, etc.)
 * @returns {Object} Link handle
 */
export function createRootLink(articulation, options = {}) {
    if (!articulation || !articulation._articulation) return null;
    
    const PhysX = articulation.world.module;
    const physics = articulation.world.physics;
    
    try {
        const pos = options.position || [0, 0, 0];
        const pxPos = new PhysX.PxVec3(pos[0], pos[1], pos[2]);
        const pose = new PhysX.PxTransform(pxPos, new PhysX.PxQuat(0, 0, 0, 1));
        
        const link = articulation._articulation.createLink(null, pose);
        if (!link) {
            PhysX.destroy(pxPos);
            PhysX.destroy(pose);
            return null;
        }
        
        // Attach shape if geometry provided
        if (options.geometry) {
            attachShapeToLink(articulation.world, link, options.geometry, options.material);
        }
        
        // Set mass properties
        if (PhysX.PxRigidBodyExt && typeof PhysX.PxRigidBodyExt.updateMassAndInertia === 'function') {
            const density = options.density || 1.0;
            PhysX.PxRigidBodyExt.updateMassAndInertia(link, density);
        }
        
        const linkHandle = {
            _link: link,
            index: articulation.links.length,
            isRoot: true,
        };
        articulation.links.push(linkHandle);
        
        PhysX.destroy(pxPos);
        PhysX.destroy(pose);
        
        return linkHandle;
    } catch (e) {
        console.error('[PhysXArticulations] Error creating root link:', e);
        return null;
    }
}

/**
 * Create a child link attached to a parent link
 * @param {Object} articulation - Articulation handle
 * @param {Object} parentLink - Parent link handle
 * @param {Object} options - Link and joint options
 * @returns {Object} Link handle
 */
export function createChildLink(articulation, parentLink, options = {}) {
    if (!articulation || !articulation._articulation || !parentLink || !parentLink._link) return null;
    
    const PhysX = articulation.world.module;
    const physics = articulation.world.physics;
    
    try {
        const pos = options.position || [0, 0, 0];
        const pxPos = new PhysX.PxVec3(pos[0], pos[1], pos[2]);
        const pose = new PhysX.PxTransform(pxPos, new PhysX.PxQuat(0, 0, 0, 1));
        
        const link = articulation._articulation.createLink(parentLink._link, pose);
        if (!link) {
            PhysX.destroy(pxPos);
            PhysX.destroy(pose);
            return null;
        }
        
        // Attach shape if geometry provided
        if (options.geometry) {
            attachShapeToLink(articulation.world, link, options.geometry, options.material);
        }
        
        // Set mass properties
        if (PhysX.PxRigidBodyExt && typeof PhysX.PxRigidBodyExt.updateMassAndInertia === 'function') {
            const density = options.density || 1.0;
            PhysX.PxRigidBodyExt.updateMassAndInertia(link, density);
        }
        
        // Configure joint
        const joint = link.getInboundJoint();
        if (joint) {
            configureArticulationJoint(PhysX, joint, options.joint || {});
        }
        
        const linkHandle = {
            _link: link,
            _joint: joint,
            index: articulation.links.length,
            isRoot: false,
            parent: parentLink,
        };
        articulation.links.push(linkHandle);
        
        PhysX.destroy(pxPos);
        PhysX.destroy(pose);
        
        return linkHandle;
    } catch (e) {
        console.error('[PhysXArticulations] Error creating child link:', e);
        return null;
    }
}

/**
 * Shortest-arc quaternion rotating the +X axis onto `v` ([x,y,z,w]).
 * Identity when v is missing/degenerate. Used to orient articulation joint
 * frames so eTWIST spins about the anatomical hinge/twist axis instead of
 * world X.
 */
function quatFromXAxisTo(v) {
    if (!Array.isArray(v)) return [0, 0, 0, 1];
    const l = Math.hypot(v[0] || 0, v[1] || 0, v[2] || 0);
    if (l < 1e-6) return [0, 0, 0, 1];
    const x = v[0] / l, y = v[1] / l, z = v[2] / l;
    const d = x; // dot([1,0,0], v)
    if (d > 0.99999) return [0, 0, 0, 1];
    if (d < -0.99999) return [0, 0, 1, 0]; // 180° about Z: +X → −X
    // axis = cross([1,0,0], v) = [0, −z, y]; w = 1 + dot
    const qx = 0, qy = -z, qz = y, qw = 1 + d;
    const n = Math.hypot(qx, qy, qz, qw);
    return [qx / n, qy / n, qz / n, qw / n];
}

/**
 * Quaternion for a FULL joint-frame basis: local X = `xAxis` (twist/bone
 * axis), local Y = `forward` orthogonalized against X, Z = X × Y. Used for
 * elliptical (anatomical) swing limits where the fwd/back plane must be
 * distinguished from the sideways plane — positive rotation about local Z
 * moves the bone (+X) toward +Y (forward flexion), so eSWING2 carries the
 * asymmetric fwd/back range and eSWING1 (about Y) the symmetric side range.
 * Falls back to `quatFromXAxisTo` when `forward` is missing/degenerate.
 */
function quatFromXForwardBasis(xAxis, forward) {
    if (!Array.isArray(xAxis) || !Array.isArray(forward)) return quatFromXAxisTo(xAxis);
    const xl = Math.hypot(xAxis[0], xAxis[1], xAxis[2]);
    if (xl < 1e-6) return quatFromXAxisTo(xAxis);
    const X = [xAxis[0] / xl, xAxis[1] / xl, xAxis[2] / xl];
    const d = forward[0] * X[0] + forward[1] * X[1] + forward[2] * X[2];
    let Y = [forward[0] - d * X[0], forward[1] - d * X[1], forward[2] - d * X[2]];
    const yl = Math.hypot(Y[0], Y[1], Y[2]);
    if (yl < 1e-6) return quatFromXAxisTo(xAxis);
    Y = [Y[0] / yl, Y[1] / yl, Y[2] / yl];
    const Z = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
    // Rotation matrix with columns X,Y,Z → quaternion (standard Shepperd).
    const m00 = X[0], m10 = X[1], m20 = X[2];
    const m01 = Y[0], m11 = Y[1], m21 = Y[2];
    const m02 = Z[0], m12 = Z[1], m22 = Z[2];
    const tr = m00 + m11 + m22;
    let qx, qy, qz, qw;
    if (tr > 0) {
        const s = Math.sqrt(tr + 1) * 2;
        qw = s / 4; qx = (m21 - m12) / s; qy = (m02 - m20) / s; qz = (m10 - m01) / s;
    } else if (m00 > m11 && m00 > m22) {
        const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
        qw = (m21 - m12) / s; qx = s / 4; qy = (m01 + m10) / s; qz = (m02 + m20) / s;
    } else if (m11 > m22) {
        const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
        qw = (m02 - m20) / s; qx = (m01 + m10) / s; qy = s / 4; qz = (m12 + m21) / s;
    } else {
        const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
        qw = (m10 - m01) / s; qx = (m02 + m20) / s; qy = (m12 + m21) / s; qz = s / 4;
    }
    const n = Math.hypot(qx, qy, qz, qw) || 1;
    return [qx / n, qy / n, qz / n, qw / n];
}

/**
 * Configure an articulation joint
 */
function configureArticulationJoint(PhysX, joint, options) {
    if (!joint) return;
    
    const jointType = options.type || 'spherical';
    
    // Set joint type
    if (typeof joint.setJointType === 'function' && PhysX.PxArticulationJointTypeEnum) {
        const typeMap = {
            'fixed': PhysX.PxArticulationJointTypeEnum.eFIX,
            'prismatic': PhysX.PxArticulationJointTypeEnum.ePRISMATIC,
            'revolute': PhysX.PxArticulationJointTypeEnum.eREVOLUTE,
            'spherical': PhysX.PxArticulationJointTypeEnum.eSPHERICAL,
        };
        const pxType = typeMap[jointType] ?? PhysX.PxArticulationJointTypeEnum.eSPHERICAL;
        joint.setJointType(pxType);
    }
    
    // Joint frame orientation: PhysX articulation axes are defined in the JOINT
    // FRAME — eTWIST is rotation about the frame's X axis. With identity frames
    // (the old behavior) every hinge bent about WORLD X regardless of anatomy,
    // which is why knees/elbows bent the wrong way. When the limits carry an
    // anatomical `axis` (hinge bend axis from JointLimits.hingeAxis, or the bone
    // twist axis for ball joints), rotate BOTH frames so local X aligns with it.
    // When they ALSO carry a `forward` direction (elliptical hips/shoulders),
    // build the full basis so local Y = anatomical forward — then eSWING2
    // (rotation about Z) is flexion/extension (asymmetric fwd/back range) and
    // eSWING1 (about Y=forward) is sideways abduction. Links are created with
    // identity world rotation at bind positions, so the same world-space quat
    // applies to both sides and the bind pose reads as joint angle 0.
    const frameQuat = options.limits?.forward
        ? quatFromXForwardBasis(options.limits?.axis, options.limits.forward)
        : quatFromXAxisTo(options.limits?.axis);
    
    // Set parent and child poses
    if (options.parentAnchor && typeof joint.setParentPose === 'function') {
        const anchor = options.parentAnchor;
        const pos = new PhysX.PxVec3(anchor[0] || 0, anchor[1] || 0, anchor[2] || 0);
        const pose = new PhysX.PxTransform(pos, new PhysX.PxQuat(frameQuat[0], frameQuat[1], frameQuat[2], frameQuat[3]));
        joint.setParentPose(pose);
        PhysX.destroy(pos);
        PhysX.destroy(pose);
    }
    
    if (options.childAnchor && typeof joint.setChildPose === 'function') {
        const anchor = options.childAnchor;
        const pos = new PhysX.PxVec3(anchor[0] || 0, anchor[1] || 0, anchor[2] || 0);
        const pose = new PhysX.PxTransform(pos, new PhysX.PxQuat(frameQuat[0], frameQuat[1], frameQuat[2], frameQuat[3]));
        joint.setChildPose(pose);
        PhysX.destroy(pos);
        PhysX.destroy(pose);
    }
    
    // Set joint limits if provided
    if (options.limits && PhysX.PxArticulationAxisEnum) {
        const setAxisLimit = (axisName, lowRad, highRad, motionType = 'limited') => {
            const axis = PhysX.PxArticulationAxisEnum[axisName];
            if (axis === undefined) return;
            if (typeof joint.setMotion === 'function' && PhysX.PxArticulationMotionEnum) {
                const pxMotion = PhysX.PxArticulationMotionEnum[`e${String(motionType).toUpperCase()}`]
                    || PhysX.PxArticulationMotionEnum.eLIMITED;
                joint.setMotion(axis, pxMotion);
            }
            // Actually push the limit VALUES — setting motion to eLIMITED without
            // setLimitParams leaves PhysX's default [0,0] range (a rigid axis).
            if (motionType === 'limited' && Number.isFinite(lowRad) && Number.isFinite(highRad)
                && typeof joint.setLimitParams === 'function' && PhysX.PxArticulationLimit) {
                const lim = new PhysX.PxArticulationLimit(lowRad, highRad);
                joint.setLimitParams(axis, lim);
                PhysX.destroy(lim);
            }
        };
        const D2R = Math.PI / 180;
        if (typeof options.limits.swingDeg === 'number' || typeof options.limits.twistDeg === 'number') {
            // Ragdoll-style ROM limits ({ swingDeg, twistDeg, axis } from
            // JointLimits / RagdollBuilder / RagdollSkinning bones).
            const swing = Math.max(1, options.limits.swingDeg ?? 45) * D2R;
            const twist = Math.max(1, options.limits.twistDeg ?? 30) * D2R;
            if (jointType === 'revolute') {
                // ONE-WAY hinge. JointLimits.hingeAxis() = normal of the
                // parent→joint→child bind plane, so positive rotation about it
                // folds the limb FURTHER into its natural (pre-bent) direction.
                // For a hinge, `twistDeg` IS the full flexion ROM
                // (deriveHingeLimit). A small 5° back-allowance keeps a nearly
                // straight bind pose from jamming; hyperextension stays blocked —
                // this is what stops knees/elbows bending the wrong way.
                setAxisLimit('eTWIST', -5 * D2R, twist);
            } else if (options.limits.forward
                && (typeof options.limits.maxFwdDeg === 'number' || typeof options.limits.maxBackDeg === 'number')) {
                // ELLIPTICAL ball (hips/shoulders — same asymmetric ranges
                // RagdollSkinning's swing cones use, and the same shape kool's
                // reference ragdoll configures via setupSpherical with distinct
                // per-axis lo/hi). A symmetric cone can't say "hip: 100° forward
                // flexion but only 20° back-extension" — this can.
                const fwd = Math.max(1, options.limits.maxFwdDeg ?? options.limits.swingDeg ?? 45) * D2R;
                const back = Math.max(1, options.limits.maxBackDeg ?? 20) * D2R;
                const side = Math.max(1, options.limits.maxSideDeg ?? options.limits.swingDeg ?? 45) * D2R;
                setAxisLimit('eSWING2', -back, fwd);   // flexion/extension (about Z; +moves bone toward forward)
                setAxisLimit('eSWING1', -side, side);  // abduction/adduction (about Y=forward)
                setAxisLimit('eTWIST', -twist, twist);
            } else {
                setAxisLimit('eSWING1', -swing, swing);
                setAxisLimit('eSWING2', -swing, swing);
                setAxisLimit('eTWIST', -twist, twist);
            }
        } else {
            // Per-axis format: { eTWIST: { motion, low|lower, high|upper }, ... }
            // (StickmanActiveRigAdapter uses lower/upper; accept both spellings.)
            const axes = ['eTWIST', 'eSWING1', 'eSWING2', 'eX', 'eY', 'eZ'];
            for (const axisName of axes) {
                const limit = options.limits[axisName];
                if (!limit) continue;
                setAxisLimit(axisName, limit.low ?? limit.lower, limit.high ?? limit.upper, limit.motion || 'limited');
            }
        }
    }
    
    if (options.drives && PhysX.PxArticulationAxisEnum && typeof joint.setDriveParams === 'function') {
        for (const [axisName, driveConfig] of Object.entries(options.drives)) {
            setArticulationAxisDrive(PhysX, joint, axisName, driveConfig);
        }
    } else if (options.stiffness !== undefined || options.damping !== undefined) {
        setArticulationAxisDrive(PhysX, joint, 'eTWIST', options);
    }
}

function setArticulationAxisDrive(PhysX, joint, axisName, config = {}) {
    const axis = PhysX.PxArticulationAxisEnum[axisName] ?? PhysX.PxArticulationAxisEnum[`e${String(axisName).toUpperCase()}`];
    if (axis === undefined) return;
    try {
        const driveType = getArticulationDriveType(PhysX, config.driveMode);
        const driveParams = PhysX.PxArticulationDrive.length >= 4
            ? new PhysX.PxArticulationDrive(config.stiffness || 0, config.damping || 0, config.maxForce ?? config.forceLimit ?? 1000, driveType)
            : new PhysX.PxArticulationDrive();
        driveParams.stiffness = config.stiffness || 0;
        driveParams.damping = config.damping || 0;
        driveParams.maxForce = config.maxForce ?? config.forceLimit ?? 1000;
        if (driveParams.driveType !== undefined) driveParams.driveType = driveType;
        joint.setDriveParams(axis, driveParams);
        if (config.targetPosition !== undefined && typeof joint.setDriveTarget === 'function') joint.setDriveTarget(axis, config.targetPosition, true);
        if (config.targetVelocity !== undefined && typeof joint.setDriveVelocity === 'function') joint.setDriveVelocity(axis, config.targetVelocity, true);
        if (config.armature !== undefined && typeof joint.setArmature === 'function') joint.setArmature(axis, config.armature);
        PhysX.destroy(driveParams);
    } catch (_) {}
}

function getArticulationDriveType(PhysX, driveMode = 'acceleration') {
    if (!PhysX.PxArticulationDriveTypeEnum) return undefined;
    if (driveMode === 'force') return PhysX.PxArticulationDriveTypeEnum.eFORCE;
    if (driveMode === 'none') return PhysX.PxArticulationDriveTypeEnum.eNONE;
    return PhysX.PxArticulationDriveTypeEnum.eACCELERATION;
}

/**
 * Attach a shape to an articulation link
 */
function attachShapeToLink(world, link, geometry, materialOptions) {
    const PhysX = world.module;
    const physics = world.physics;
    
    let pxGeometry = null;
    
    // Create geometry based on type
    if (geometry.type === 'sphere') {
        pxGeometry = new PhysX.PxSphereGeometry(geometry.radius || 0.5);
    } else if (geometry.type === 'capsule') {
        pxGeometry = new PhysX.PxCapsuleGeometry(geometry.radius || 0.25, geometry.halfHeight || 0.5);
    } else if (geometry.type === 'box') {
        const he = geometry.halfExtents || [0.5, 0.5, 0.5];
        pxGeometry = new PhysX.PxBoxGeometry(he[0], he[1], he[2]);
    } else {
        // Default to sphere
        pxGeometry = new PhysX.PxSphereGeometry(0.5);
    }
    
    // Create material
    const mat = materialOptions || {};
    const material = physics.createMaterial(
        mat.staticFriction || 0.5,
        mat.dynamicFriction || 0.5,
        mat.restitution || 0.25
    );
    
    // Create shape
    const shapeFlags = new PhysX.PxShapeFlags(
        PhysX.PxShapeFlagEnum.eSIMULATION_SHAPE | PhysX.PxShapeFlagEnum.eVISUALIZATION
    );
    const shape = physics.createShape(pxGeometry, material, true, shapeFlags);
    
    if (shape) {
        // CRITICAL: articulation link shapes MUST carry simulation filter data.
        // The scene's PassThroughFilterShader suppresses any pair where
        // (word0 & otherWord1) === 0 both ways — a shape left with default
        // zeroed filter data therefore collides with NOTHING (links fell
        // straight through static ground bodies). Use the world's default
        // filter data (layer 0x0001, mask 0xFFFF, solve-contact pair flags),
        // same as every regular body created via createBody().
        if (world.filterData && typeof shape.setSimulationFilterData === 'function') {
            shape.setSimulationFilterData(world.filterData);
        }
        // Local pose: a PxCapsuleGeometry's long axis is the shape's LOCAL X.
        // Without a local pose every bone capsule sticks out sideways from its
        // joint (not along the bone), interpenetrating its neighbors at spawn —
        // the resulting depenetration impulses violently twist the whole
        // ragdoll before it even starts falling. `geometry.localPose` lets the
        // caller place the capsule at the segment midpoint, rotated along the
        // bone direction.
        if (geometry.localPose && typeof shape.setLocalPose === 'function') {
            const lp = geometry.localPose;
            const p = lp.position || [0, 0, 0];
            const q = lp.rotation || [0, 0, 0, 1];
            const pxP = new PhysX.PxVec3(p[0], p[1], p[2]);
            const pxT = new PhysX.PxTransform(pxP, new PhysX.PxQuat(q[0], q[1], q[2], q[3]));
            shape.setLocalPose(pxT);
            PhysX.destroy(pxP);
            PhysX.destroy(pxT);
        }
        link.attachShape(shape);
        shape.release();
    }
    
    PhysX.destroy(pxGeometry);
    PhysX.destroy(shapeFlags);
    material.release();
}

/**
 * Add articulation to scene (must be called after all links are created)
 * @param {Object} articulation - Articulation handle
 */
export function addArticulationToScene(articulation) {
    if (!articulation || !articulation._articulation || !articulation.world.scene) return false;
    
    try {
        articulation.world.scene.addArticulation(articulation._articulation);
        console.log(`[PhysXArticulations] Added articulation with ${articulation.links.length} links`);
        return true;
    } catch (e) {
        console.error('[PhysXArticulations] Error adding articulation to scene:', e);
        return false;
    }
}

/**
 * Create a rope using articulations
 * Per NVIDIA: "Use spheres instead of capsules. A rope made of spheres will be more stable."
 * 
 * @param {Object} world - Physics world
 * @param {Array} startPos - Start position [x, y, z]
 * @param {Array} endPos - End position [x, y, z]
 * @param {number} segments - Number of rope segments
 * @param {Object} options - Rope options
 * @returns {Object} Articulation handle
 */
export function createRope(world, startPos, endPos, segments = 10, options = {}) {
    const articulation = createArticulation(world, {
        positionIterations: options.positionIterations || 16,
        velocityIterations: options.velocityIterations || 4,
        selfCollision: options.selfCollision !== false,
    });
    
    if (!articulation) return null;
    
    const radius = options.radius || 0.1;
    const density = options.density || 1.0;
    
    // Calculate segment length
    const dx = endPos[0] - startPos[0];
    const dy = endPos[1] - startPos[1];
    const dz = endPos[2] - startPos[2];
    const totalLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const segmentLength = totalLength / segments;
    
    // Direction vector
    const dirX = dx / totalLength;
    const dirY = dy / totalLength;
    const dirZ = dz / totalLength;
    
    let prevLink = null;
    
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const pos = [
            startPos[0] + dx * t,
            startPos[1] + dy * t,
            startPos[2] + dz * t,
        ];
        
        const linkOptions = {
            position: pos,
            geometry: { type: 'sphere', radius },
            density,
            joint: {
                type: 'spherical',
                parentAnchor: [segmentLength / 2 * dirX, segmentLength / 2 * dirY, segmentLength / 2 * dirZ],
                childAnchor: [-segmentLength / 2 * dirX, -segmentLength / 2 * dirY, -segmentLength / 2 * dirZ],
                stiffness: options.stiffness || 0,
                damping: options.damping || 10,
            },
        };
        
        let link;
        if (i === 0) {
            link = createRootLink(articulation, linkOptions);
            // Fix first link if requested
            if (options.fixStart) {
                // Root link is automatically the base - set it to fixed by not adding dynamics
            }
        } else {
            link = createChildLink(articulation, prevLink, linkOptions);
        }
        
        prevLink = link;
    }
    
    addArticulationToScene(articulation);
    
    return articulation;
}

/**
 * Update articulation link positions from simulation
 * @param {Object} articulation - Articulation handle
 * @returns {Array} Array of {position, rotation} for each link
 */
export function getArticulationLinkTransforms(articulation) {
    if (!articulation || !articulation.links) return [];
    
    const PhysX = articulation.world.module;
    const transforms = [];
    
    for (const linkHandle of articulation.links) {
        if (!linkHandle._link) continue;
        
        try {
            const pose = linkHandle._link.getGlobalPose();
            if (pose) {
                const p = pose.get_p();
                const q = pose.get_q();
                transforms.push({
                    position: [p.get_x(), p.get_y(), p.get_z()],
                    rotation: [q.get_x(), q.get_y(), q.get_z(), q.get_w()],
                });
            }
        } catch (_) {
            transforms.push({ position: [0, 0, 0], rotation: [0, 0, 0, 1] });
        }
    }
    
    return transforms;
}

/**
 * Destroy an articulation and clean up resources
 * @param {Object} articulation - Articulation handle
 */
export function destroyArticulation(articulation) {
    if (!articulation) return;
    
    try {
        if (articulation._articulation && articulation.world.scene) {
            articulation.world.scene.removeArticulation(articulation._articulation);
        }
        if (articulation._articulation) {
            articulation._articulation.release();
        }
    } catch (e) {
        console.warn('[PhysXArticulations] Error destroying articulation:', e);
    }
    
    articulation._articulation = null;
    articulation.links = [];
}
