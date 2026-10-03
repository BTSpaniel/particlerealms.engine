// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// ============================================================================
// SkeletalAnimation.js - CPU skeletal animation + skinning for imported models
//
// Evaluates glTF animations per-frame, computes joint world matrices,
// and skins vertex positions/normals/tangents on CPU. Updates the GPU vertex buffer
// via EntityMeshRenderer.
// ============================================================================

import {
    animationPlaybackStateReport,
    animationSampleChannelInto,
} from '../../core/math/AnimationTimeMath.js';
import {
    morphAttributeDeltasReport,
    morphWeightStateReport,
    morphedPositionBoundsReport,
    positionBoundsReport,
    skinnedPositionBoundsReport,
} from '../../core/math/MeshAttributeMath.js';

// ============================================================================
// ACTIVE INSTANCES
// ============================================================================

// meshKey -> SkinnedMeshInstance
const _instances = new Map();
// modelInstanceId -> ModelNodeAnimationInstance
const _nodeAnimationInstances = new Map();

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Register a skinned mesh for animation playback.
 * @param {string} meshKey - e.g. 'custom_<uuid>'
 * @param {Object} geo - { positions, normals, tangents, uvs, indices, joints, weights }
 * @param {Object} skeleton - { joints[], inverseBindMatrices, jointCount }
 * @param {Object[]} animations - Array of { name, channels[], duration }
 */
export function registerSkinnedMesh(meshKey, geo, skeleton, animations) {
    if (!geo.joints || !geo.weights || !skeleton) return;

    const instance = new SkinnedMeshInstance(meshKey, geo, skeleton, animations);
    _instances.set(meshKey, instance);
    console.log(`[SkeletalAnimation] Registered: ${meshKey} (${skeleton.jointCount} joints, ${animations?.length || 0} anims)`);
    return instance;
}

/**
 * Unregister a skinned mesh.
 */
export function unregisterSkinnedMesh(meshKey) {
    _instances.delete(meshKey);
}

/**
 * Get a skinned mesh instance.
 */
export function getSkinnedMesh(meshKey) {
    return _instances.get(meshKey) || null;
}

/**
 * Tick all active skinned meshes.
 * Call once per frame before rendering.
 * @param {number} dt - Delta time in seconds
 */
export function tickSkeletalAnimations(dt) {
    for (const instance of _nodeAnimationInstances.values()) {
        instance.tick(dt);
    }
    for (const instance of _instances.values()) {
        instance.tick(dt);
    }
}

/** Register ordinary glTF node animation once per model entity instance. */
export function registerModelNodeAnimation(modelInstanceId, graph, animations, playbackState = null) {
    if (typeof modelInstanceId !== 'string' || modelInstanceId.length === 0) {
        throw new TypeError('modelInstanceId must be a nonempty string');
    }
    const instance = new ModelNodeAnimationInstance(modelInstanceId, graph, animations, playbackState);
    if (!instance.hasAnimationChannels) {
        _nodeAnimationInstances.delete(modelInstanceId);
        return null;
    }
    _nodeAnimationInstances.set(modelInstanceId, instance);
    console.log(`[SkeletalAnimation] Registered node animation: ${modelInstanceId} (${instance.nodeCount} nodes, ${instance.animations.length} anims)`);
    return instance;
}

export function unregisterModelNodeAnimation(modelInstanceId) {
    return _nodeAnimationInstances.delete(modelInstanceId);
}

export function getModelNodeAnimation(modelInstanceId) {
    return _nodeAnimationInstances.get(modelInstanceId) || null;
}

export function getModelNodeAnimationState(modelInstanceId) {
    return _nodeAnimationInstances.get(modelInstanceId)?.getPlaybackState() || null;
}

export function getModelNodeAnimationDescriptor(modelInstanceId) {
    return _nodeAnimationInstances.get(modelInstanceId)?.getDescriptor() || null;
}

export function setModelNodeAnimationState(modelInstanceId, playbackState) {
    const instance = _nodeAnimationInstances.get(modelInstanceId);
    return instance ? instance.setPlaybackState(playbackState) : false;
}

export function getModelNodeWorldMatrix(modelInstanceId, nodeIndex) {
    return _nodeAnimationInstances.get(modelInstanceId)?.getNodeWorldMatrix(nodeIndex) || null;
}

export function getModelNodeAnimationKeys() {
    return Array.from(_nodeAnimationInstances.keys());
}

export function consumeModelNodeAnimationDirty(modelInstanceId) {
    const instance = _nodeAnimationInstances.get(modelInstanceId);
    if (!instance || !instance.dirty) return false;
    instance.dirty = false;
    return true;
}

export function bindSkinnedMeshNodeAnimation(meshKey, modelInstanceId) {
    const skinned = _instances.get(meshKey);
    const nodeAnimation = _nodeAnimationInstances.get(modelInstanceId);
    if (!skinned || !nodeAnimation) return false;
    return skinned.bindModelNodeAnimation(modelInstanceId, nodeAnimation);
}

/**
 * Check if a meshKey has skeletal animation.
 */
export function isSkinnedMesh(meshKey) {
    return _instances.has(meshKey);
}

/**
 * Get the current skinned positions/normals/tangents for a mesh.
 * Returns null if not a skinned mesh.
 */
export function getSkinnedGeometry(meshKey) {
    const inst = _instances.get(meshKey);
    if (!inst) return null;
    return { positions: inst.skinnedPositions, normals: inst.skinnedNormals, tangents: inst.skinnedTangents };
}

/**
 * Compute current local-space skinned bounds from bind vertices and live skin matrices.
 * This remains authoritative when GPU skinning intentionally leaves CPU outputs stale.
 */
export function getSkinnedBounds(meshKey) {
    const inst = _instances.get(meshKey);
    if (!inst) return null;
    return skinnedPositionBoundsReport(
        inst._positionSource(),
        inst.jointIndices,
        inst.jointWeights,
        inst.skinMatrices,
    );
}

/** Get the current bounds already refreshed by the animation/ragdoll tick. */
export function getCachedSkinnedBounds(meshKey) {
    return _instances.get(meshKey)?.currentBounds || null;
}

export function getMorphWeights(meshKey) {
    const inst = _instances.get(meshKey);
    return inst ? new Float32Array(inst.morphWeights) : null;
}

export function setMorphWeights(meshKey, weights) {
    const inst = _instances.get(meshKey);
    return inst ? inst.setMorphWeights(weights) : false;
}

export function getMorphTargetCount(meshKey) {
    return _instances.get(meshKey)?.morphTargetCount || 0;
}

function _modelMorphInstances(parts) {
    if (!Array.isArray(parts)) return [];
    const result = [];
    for (let index = 0; index < parts.length; index++) {
        const part = parts[index];
        const partIndex = Number.isInteger(part?.partIndex) ? part.partIndex : index;
        const instance = typeof part?.meshType === 'string' ? _instances.get(part.meshType) : null;
        if (instance?.morphTargetCount > 0) result.push({ partIndex, meshKey: part.meshType, instance });
    }
    return result;
}

export function getModelMorphState(parts) {
    return _modelMorphInstances(parts).map(({ partIndex, instance }) => ({
        partIndex,
        ...instance.getMorphControlState(),
    }));
}

export function getModelMorphDescriptor(parts) {
    const morphParts = _modelMorphInstances(parts);
    if (morphParts.length === 0) return null;
    return {
        state: getModelMorphState(parts),
        parts: morphParts.map(({ partIndex, meshKey, instance }) => ({
            partIndex,
            meshKey,
            name: instance.meshName || `Part ${partIndex + 1}`,
            targetNode: instance.morphTargetNode,
            mode: instance.morphControlMode,
            targets: instance.morphTargetNames.map((name, index) => ({
                index,
                name,
                weight: instance.morphWeights[index],
                manualWeight: instance.manualMorphWeights[index],
            })),
        })),
    };
}

export function setModelMorphState(parts, state) {
    const morphParts = _modelMorphInstances(parts);
    const expectedTargetCounts = new Map(
        morphParts.map(({ partIndex, instance }) => [partIndex, instance.morphTargetCount]),
    );
    const report = morphWeightStateReport(state, { expectedTargetCounts });
    if (!report.valid) return false;
    const byPart = new Map(morphParts.map((entry) => [entry.partIndex, entry.instance]));
    if (report.value.some((entry) => !byPart.get(entry.partIndex)?._morphWeightsValid(entry.weights))) return false;
    for (const entry of report.value) {
        if (!byPart.get(entry.partIndex).setMorphControlState(entry.mode, entry.weights)) return false;
    }
    return true;
}

/**
 * Get all registered skinned mesh keys.
 */
export function getSkinnedMeshKeys() {
    return Array.from(_instances.keys());
}

/**
 * Get per-bone capsule dimensions computed from vertex weights.
 * Returns cached data computed once at registration time.
 * @param {string} meshKey
 * @returns {Array<{radius: number, halfHeight: number}>|null}
 */
export function getBoneCapsules(meshKey) {
    const inst = _instances.get(meshKey);
    if (!inst || !inst.boneCapsules) return null;
    return inst.boneCapsules;
}

// ============================================================================
// ANIMATED BONE SHAPES — Primary API for visual overlay rendering
// ============================================================================
//
// ARCHITECTURE NOTE — VISUAL vs COLLISION:
//
//   VISUAL OVERLAY (this API):
//     Purpose: Show a semi-transparent "second skin" over the mesh so the user
//              can see the collision shape approximation.
//     Rendering: Instanced sphere/capsule MESHES drawn with additive blending.
//              Does NOT use raymarching — just standard rasterization.
//              Cost: one instanced draw call, trivial GPU load.
//     Data flow: getAnimatedBoneShapes() → Viewport.js → entityMeshRenderer
//
//   COLLISION (SDFColliderRenderer):
//     Purpose: Physics collision detection via GPU SDF raymarching.
//     Rendering: Fullscreen pass that raymarches ALL capsule SDFs per pixel.
//              Expensive (132 instances × 64 steps × per pixel) but required
//              for accurate collision queries.
//     Data flow: addShape() → GPU buffer → WGSL raymarcher
//
//   These are SEPARATE systems. The visual overlay is cheap and runs every frame.
//   The collision raymarcher only runs when physics needs collision data.
// ============================================================================

/**
 * Get ANIMATED bone shapes for visual overlay rendering.
 * Returns current-frame bone positions/rotations with mesh-measured capsule sizes.
 * Uses the CURRENT animated worldMatrices so capsules track the animation exactly.
 *
 * This is the PRIMARY API for the visual bone overlay in Viewport.js.
 * Each bone returns:
 *   - pos: world position (midpoint between bone and first child)
 *   - rot: quaternion aligning Y-axis with bone direction
 *   - radius: mesh-measured perpendicular distance (90th percentile)
 *   - halfHeight: half the bone length minus radius
 *   - name: bone name for debug/classification
 *   - parentIndex: parent bone index (-1 for roots)
 *   - isTerminal: true for end/nub bones (skip rendering)
 *
 * @param {string} meshKey - e.g. 'custom_<uuid>'
 * @param {number[]} entityPos - [x,y,z] entity world position
 * @returns {Object|null} { shapes: [...], bodyHeight, shoulderWidth }
 */
export function getAnimatedBoneShapes(meshKey, entityPos) {
    const inst = _instances.get(meshKey);
    if (!inst) return null;

    // Recompute world matrices from current animated joint transforms.
    // tick() already called _computeSkinMatrices() this frame, but calling
    // again is harmless (idempotent) and ensures we're up to date.
    inst._computeSkinMatrices();

    const ex = entityPos[0] || 0, ey = entityPos[1] || 0, ez = entityPos[2] || 0;

    // Extract root scale from rootTransform matrix (column lengths of 3x3)
    const rt = inst.rootTransform;
    const sx = Math.sqrt(rt[0]*rt[0] + rt[1]*rt[1] + rt[2]*rt[2]);
    const sy = Math.sqrt(rt[4]*rt[4] + rt[5]*rt[5] + rt[6]*rt[6]);
    const sz = Math.sqrt(rt[8]*rt[8] + rt[9]*rt[9] + rt[10]*rt[10]);
    const uniformScale = Math.max(sx, sy, sz);

    // Build child map for bone hierarchy traversal
    const childMap = inst._getChildMap();

    // Extract per-bone world positions from animated worldMatrices
    const boneWorldPos = new Array(inst.jointCount);
    for (let i = 0; i < inst.jointCount; i++) {
        const o = i * 16;
        boneWorldPos[i] = [
            inst.worldMatrices[o + 12] + ex,
            inst.worldMatrices[o + 13] + ey,
            inst.worldMatrices[o + 14] + ez,
        ];
    }

    // Measure full body dimensions (head-to-feet, shoulder width)
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < inst.jointCount; i++) {
        const y = boneWorldPos[i][1];
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const bodyHeight = Math.max(0.5, maxY - minY);

    // Find shoulder width (distance between left/right shoulder or upper arm bones)
    let shoulderWidth = bodyHeight * 0.3; // fallback estimate
    for (let i = 0; i < inst.jointCount; i++) {
        const n = (inst.joints[i].name || '').toLowerCase();
        if (n.includes('left') && (n.includes('shoulder') || n.includes('upper_arm') || n.includes('upperarm'))) {
            for (let j = 0; j < inst.jointCount; j++) {
                const m = (inst.joints[j].name || '').toLowerCase();
                if (m.includes('right') && (m.includes('shoulder') || m.includes('upper_arm') || m.includes('upperarm'))) {
                    const dx = boneWorldPos[i][0] - boneWorldPos[j][0];
                    const dy = boneWorldPos[i][1] - boneWorldPos[j][1];
                    const dz = boneWorldPos[i][2] - boneWorldPos[j][2];
                    shoulderWidth = Math.sqrt(dx*dx + dy*dy + dz*dz);
                }
            }
        }
    }

    // Get cached capsule dimensions (computed once from mesh vertex weights)
    const caps = inst.boneCapsules || [];

    // Build output shapes
    const shapes = [];
    for (let i = 0; i < inst.jointCount; i++) {
        const joint = inst.joints[i];
        const name = joint.name || `joint_${i}`;

        // Skip terminal/end bones (they have no meaningful collision volume)
        if (_isTerminalBone(name)) continue;

        const wp = boneWorldPos[i];
        const children = childMap.get(i) || [];

        // Compute bone direction and length
        let childWP = null;
        let boneLen = 0.06;
        if (children.length > 0) {
            childWP = boneWorldPos[children[0]];
            const dx = childWP[0]-wp[0], dy = childWP[1]-wp[1], dz = childWP[2]-wp[2];
            boneLen = Math.sqrt(dx*dx + dy*dy + dz*dz);
        } else if (joint.parentIndex >= 0) {
            const pp = boneWorldPos[joint.parentIndex];
            const dx = wp[0]-pp[0], dy = wp[1]-pp[1], dz = wp[2]-pp[2];
            boneLen = Math.sqrt(dx*dx + dy*dy + dz*dz) * 0.5;
        }
        boneLen = Math.max(0.03, boneLen);

        // Capsule dimensions from mesh measurement (or fallback)
        let radius, halfHeight;
        if (caps[i] && caps[i].radius > 0.001) {
            radius = caps[i].radius * uniformScale;
            halfHeight = caps[i].halfHeight * uniformScale;
        } else {
            radius = boneLen * 0.25;
            halfHeight = Math.max(0, boneLen * 0.5 - radius);
        }

        // Cap radius to prevent oversized shapes
        const maxRadius = bodyHeight * 0.12;
        radius = Math.min(radius, maxRadius);

        // Head gets special treatment: sphere (halfHeight = 0), capped size
        const btype = _classifyBone(name);
        if (btype === 'head' && /head/i.test(name) && !/neck/i.test(name)) {
            radius = Math.min(bodyHeight * 0.09, Math.max(bodyHeight * 0.06, radius));
            halfHeight = 0;
        }

        // Midpoint position (center of capsule along bone)
        let posX = wp[0], posY = wp[1], posZ = wp[2];
        if (childWP) {
            posX = (wp[0] + childWP[0]) * 0.5;
            posY = (wp[1] + childWP[1]) * 0.5;
            posZ = (wp[2] + childWP[2]) * 0.5;
        }

        // Bone direction for capsule orientation
        let dirX = 0, dirY = 1, dirZ = 0;
        if (childWP) {
            const dx = childWP[0]-wp[0], dy = childWP[1]-wp[1], dz = childWP[2]-wp[2];
            const dl = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
            dirX = dx/dl; dirY = dy/dl; dirZ = dz/dl;
        } else if (joint.parentIndex >= 0) {
            const pp = boneWorldPos[joint.parentIndex];
            const dx = wp[0]-pp[0], dy = wp[1]-pp[1], dz = wp[2]-pp[2];
            const dl = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
            dirX = dx/dl; dirY = dy/dl; dirZ = dz/dl;
        }

        // Quaternion to align Y-axis with bone direction
        const rot = _quatFromDir(dirX, dirY, dirZ);

        shapes.push({
            pos: [posX, posY, posZ],
            rot,
            radius,
            halfHeight,
            boneLen,
            name,
            boneType: btype,
            parentIndex: joint.parentIndex,
        });
    }

    // Build raw skeleton joint data for ball-joint visualization.
    // Unlike 'shapes' (which are capsule midpoints with terminal bones filtered out),
    // 'joints' contains EVERY joint position including terminals. This lets Viewport.js
    // render small solid spheres at each joint and thin cylinders between parent→child.
    const joints = [];
    for (let i = 0; i < inst.jointCount; i++) {
        const joint = inst.joints[i];
        const wp = boneWorldPos[i];
        const children = childMap.get(i) || [];
        // Collect world positions of all children for bone sticks
        const childPositions = children.map(ci => boneWorldPos[ci].slice());
        joints.push({
            pos: wp.slice(),
            name: joint.name || `joint_${i}`,
            parentIndex: joint.parentIndex,
            childPositions,
            isTerminal: _isTerminalBone(joint.name),
        });
    }

    return { shapes, joints, bodyHeight, shoulderWidth, jointCount: inst.jointCount };
}

/**
 * Get bind-pose bone data WITHOUT modifying state (no ragdoll, no animation stop).
 * Used for edit-mode SDF collider visualization preview.
 * @param {string} meshKey
 * @param {number[]} entityPos - [x,y,z] entity world position
 * @returns {Object|null} { bones: [{index, parentIndex, worldPos, worldRot, childPositions, name}], jointCount, rootScale }
 */
export function getBindPoseBones(meshKey, entityPos) {
    const inst = _instances.get(meshKey);
    if (!inst) return null;

    // Compute current skin matrices (non-destructive — just recalcs)
    inst._computeSkinMatrices();

    const rt = inst.rootTransform;
    const sx = Math.sqrt(rt[0]*rt[0] + rt[1]*rt[1] + rt[2]*rt[2]);
    const sy = Math.sqrt(rt[4]*rt[4] + rt[5]*rt[5] + rt[6]*rt[6]);
    const sz = Math.sqrt(rt[8]*rt[8] + rt[9]*rt[9] + rt[10]*rt[10]);

    const ex = entityPos[0] || 0, ey = entityPos[1] || 0, ez = entityPos[2] || 0;
    const bones = [];
    const childMap = new Map();
    for (let i = 0; i < inst.jointCount; i++) {
        const pi = inst.joints[i].parentIndex;
        if (pi >= 0) {
            if (!childMap.has(pi)) childMap.set(pi, []);
            childMap.get(pi).push(i);
        }
    }

    for (let i = 0; i < inst.jointCount; i++) {
        const o = i * 16;
        const wx = inst.worldMatrices[o + 12] + ex;
        const wy = inst.worldMatrices[o + 13] + ey;
        const wz = inst.worldMatrices[o + 14] + ez;

        const m00 = inst.worldMatrices[o+0]/sx, m01 = inst.worldMatrices[o+4]/sy, m02 = inst.worldMatrices[o+8]/sz;
        const m10 = inst.worldMatrices[o+1]/sx, m11 = inst.worldMatrices[o+5]/sy, m12 = inst.worldMatrices[o+9]/sz;
        const m20 = inst.worldMatrices[o+2]/sx, m21 = inst.worldMatrices[o+6]/sy, m22 = inst.worldMatrices[o+10]/sz;
        const worldRot = _mat3ToQuat(m00, m01, m02, m10, m11, m12, m20, m21, m22);

        const children = childMap.get(i) || [];
        const childPositions = children.map(ci => {
            const co = ci * 16;
            return [
                inst.worldMatrices[co + 12] + ex,
                inst.worldMatrices[co + 13] + ey,
                inst.worldMatrices[co + 14] + ez,
            ];
        });

        bones.push({
            index: i,
            parentIndex: inst.joints[i].parentIndex,
            name: inst.joints[i].name || `joint_${i}`,
            worldPos: [wx, wy, wz],
            worldRot,
            childPositions,
        });
    }

    return { bones, jointCount: inst.jointCount, rootScale: [sx, sy, sz] };
}

/**
 * Enable ragdoll mode for a skinned mesh.
 * Stops animation and returns bind-pose bone world positions + hierarchy
 * for creating physics bodies.
 * @param {string} meshKey
 * @param {number[]} entityPos - [x,y,z] entity world position
 * @returns {Object|null} { bones: [{index, parentIndex, worldPos, childPositions, name}], jointCount }
 */
export function enableRagdoll(meshKey, entityPos) {
    const inst = _instances.get(meshKey);
    if (!inst) return null;
    inst.playing = false;
    inst.ragdollMode = true;

    // Compute bind-pose world matrices
    inst._computeSkinMatrices();

    // Extract scale from rootTransform (column lengths of 3x3 rotation sub-matrix)
    const rt = inst.rootTransform;
    const sx = Math.sqrt(rt[0]*rt[0] + rt[1]*rt[1] + rt[2]*rt[2]);
    const sy = Math.sqrt(rt[4]*rt[4] + rt[5]*rt[5] + rt[6]*rt[6]);
    const sz = Math.sqrt(rt[8]*rt[8] + rt[9]*rt[9] + rt[10]*rt[10]);

    const ex = entityPos[0] || 0, ey = entityPos[1] || 0, ez = entityPos[2] || 0;
    const bones = [];
    const childMap = new Map(); // parentIdx -> [childIdx, ...]
    for (let i = 0; i < inst.jointCount; i++) {
        const pi = inst.joints[i].parentIndex;
        if (pi >= 0) {
            if (!childMap.has(pi)) childMap.set(pi, []);
            childMap.get(pi).push(i);
        }
    }

    for (let i = 0; i < inst.jointCount; i++) {
        const o = i * 16;
        const wx = inst.worldMatrices[o + 12] + ex;
        const wy = inst.worldMatrices[o + 13] + ey;
        const wz = inst.worldMatrices[o + 14] + ez;

        // Extract rotation quaternion from the bind-pose world matrix (removing scale)
        const m00 = inst.worldMatrices[o+0]/sx, m01 = inst.worldMatrices[o+4]/sy, m02 = inst.worldMatrices[o+8]/sz;
        const m10 = inst.worldMatrices[o+1]/sx, m11 = inst.worldMatrices[o+5]/sy, m12 = inst.worldMatrices[o+9]/sz;
        const m20 = inst.worldMatrices[o+2]/sx, m21 = inst.worldMatrices[o+6]/sy, m22 = inst.worldMatrices[o+10]/sz;
        const worldRot = _mat3ToQuat(m00, m01, m02, m10, m11, m12, m20, m21, m22);

        const children = childMap.get(i) || [];
        const childPositions = children.map(ci => {
            const co = ci * 16;
            return [
                inst.worldMatrices[co + 12] + ex,
                inst.worldMatrices[co + 13] + ey,
                inst.worldMatrices[co + 14] + ez,
            ];
        });

        bones.push({
            index: i,
            parentIndex: inst.joints[i].parentIndex,
            name: inst.joints[i].name || `joint_${i}`,
            worldPos: [wx, wy, wz],
            worldRot,
            childPositions,
        });
    }

    return { bones, jointCount: inst.jointCount, rootScale: [sx, sy, sz] };
}

/**
 * Update bone world matrices from ragdoll physics transforms, then reskin.
 * @param {string} meshKey
 * @param {Float32Array} boneWorldMatrices - jointCount * 16 column-major matrices
 */
export function setRagdollBoneTransforms(meshKey, boneWorldMatrices) {
    const inst = _instances.get(meshKey);
    if (!inst || !inst.ragdollMode) return;

    // Overwrite world matrices with physics-driven transforms
    inst.worldMatrices.set(boneWorldMatrices);

    // Recompute skin matrices: skinMatrix = worldMatrix * inverseBindMatrix
    for (let i = 0; i < inst.jointCount; i++) {
        _mat4Multiply(
            inst.worldMatrices, i * 16,
            inst.inverseBindMatrices, i * 16,
            inst.skinMatrices, i * 16
        );
    }

    // Diagnostic: log first 3 calls per mesh to verify ragdoll skinning
    if (!inst._ragdollSkinLogCount) inst._ragdollSkinLogCount = 0;
    inst._ragdollSkinLogCount++;
    if (inst._ragdollSkinLogCount <= 3 || inst._ragdollSkinLogCount % 300 === 1) {
        const hipsO = 0; // Hips = first bone
        const wm = inst.worldMatrices;
        const sm = inst.skinMatrices;
        const ibm = inst.inverseBindMatrices;
        console.log(`[RagdollSkin] meshKey=${meshKey} frame=${inst._ragdollSkinLogCount} joints=${inst.jointCount}`);
        console.log(`  Hips worldMat: rot=[${wm[hipsO].toFixed(4)},${wm[hipsO+5].toFixed(4)},${wm[hipsO+10].toFixed(4)}] trans=[${wm[hipsO+12].toFixed(4)},${wm[hipsO+13].toFixed(4)},${wm[hipsO+14].toFixed(4)}]`);
        console.log(`  Hips skinMat:  rot=[${sm[hipsO].toFixed(4)},${sm[hipsO+5].toFixed(4)},${sm[hipsO+10].toFixed(4)}] trans=[${sm[hipsO+12].toFixed(4)},${sm[hipsO+13].toFixed(4)},${sm[hipsO+14].toFixed(4)}]`);
        console.log(`  Hips IBM:      rot=[${ibm[hipsO].toFixed(4)},${ibm[hipsO+5].toFixed(4)},${ibm[hipsO+10].toFixed(4)}] trans=[${ibm[hipsO+12].toFixed(4)},${ibm[hipsO+13].toFixed(4)},${ibm[hipsO+14].toFixed(4)}]`);
        // Sample vertex 0
        const bp = inst.bindPositions;
        const sp = inst.skinnedPositions;
        console.log(`  Vertex0: bind=[${bp[0].toFixed(3)},${bp[1].toFixed(3)},${bp[2].toFixed(3)}] skinned=[${sp[0].toFixed(3)},${sp[1].toFixed(3)},${sp[2].toFixed(3)}]`);
        // Check second bone too (LeftUpLeg)
        if (inst.jointCount > 1) {
            const o2 = 16;
            console.log(`  Bone1 worldMat: rot=[${wm[o2].toFixed(4)},${wm[o2+5].toFixed(4)},${wm[o2+10].toFixed(4)}] trans=[${wm[o2+12].toFixed(4)},${wm[o2+13].toFixed(4)},${wm[o2+14].toFixed(4)}]`);
            console.log(`  Bone1 skinMat:  rot=[${sm[o2].toFixed(4)},${sm[o2+5].toFixed(4)},${sm[o2+10].toFixed(4)}] trans=[${sm[o2+12].toFixed(4)},${sm[o2+13].toFixed(4)},${sm[o2+14].toFixed(4)}]`);
        }
        // Also log rootTransform for comparison
        const rt = inst.rootTransform;
        console.log(`  rootTransform: rot=[${rt[0].toFixed(4)},${rt[5].toFixed(4)},${rt[10].toFixed(4)}] trans=[${rt[12].toFixed(4)},${rt[13].toFixed(4)},${rt[14].toFixed(4)}]`);
    }

    // Reskin vertices
    inst._skinVertices();
    inst._refreshBounds();
    inst.dirty = true;
}

/**
 * Disable ragdoll mode, resuming animation.
 */
export function disableRagdoll(meshKey) {
    const inst = _instances.get(meshKey);
    if (!inst) return;
    inst.ragdollMode = false;
    inst.playing = true;
    inst.animTime = 0;
}

// ============================================================================
// ORDINARY GLTF NODE ANIMATION INSTANCE
// ============================================================================

class ModelNodeAnimationInstance {
    constructor(modelInstanceId, graph, animations, playbackState = null) {
        if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.activeOrder)) {
            throw new TypeError('node animation graph is invalid');
        }
        this.modelInstanceId = modelInstanceId;
        this.nodeCount = graph.nodes.length;
        this.activeOrder = Array.from(graph.activeOrder);
        this.parents = new Int32Array(this.nodeCount).fill(-1);
        this.baseTranslations = new Float32Array(this.nodeCount * 3);
        this.baseRotations = new Float32Array(this.nodeCount * 4);
        this.baseScales = new Float32Array(this.nodeCount * 3);
        this.translations = new Float32Array(this.nodeCount * 3);
        this.rotations = new Float32Array(this.nodeCount * 4);
        this.scales = new Float32Array(this.nodeCount * 3);
        this.staticLocalMatrices = new Float32Array(this.nodeCount * 16);
        this.localMatrices = new Float32Array(this.nodeCount * 16);
        this.worldMatrices = new Float32Array(this.nodeCount * 16);
        this.matrixNodes = new Uint8Array(this.nodeCount);
        this.activeNodes = new Uint8Array(this.nodeCount);
        this._sampleScratch = new Float32Array(4);

        for (let nodeIndex = 0; nodeIndex < this.nodeCount; nodeIndex++) {
            const node = graph.nodes[nodeIndex];
            if (!node || node.nodeIndex !== nodeIndex || !Number.isInteger(node.parentIndex)
                || node.parentIndex < -1 || node.parentIndex >= this.nodeCount) {
                throw new TypeError(`node animation graph node ${nodeIndex} is invalid`);
            }
            this.parents[nodeIndex] = node.parentIndex;
            this._copyFiniteVector(node.translation, this.baseTranslations, nodeIndex * 3, 3, `node ${nodeIndex} translation`);
            this._copyFiniteVector(node.rotation, this.baseRotations, nodeIndex * 4, 4, `node ${nodeIndex} rotation`);
            this._copyFiniteVector(node.scale, this.baseScales, nodeIndex * 3, 3, `node ${nodeIndex} scale`);
            if (node.matrix !== null) {
                this._copyFiniteVector(node.matrix, this.staticLocalMatrices, nodeIndex * 16, 16, `node ${nodeIndex} matrix`);
                this.matrixNodes[nodeIndex] = 1;
            }
        }

        const seen = new Set();
        for (const nodeIndex of this.activeOrder) {
            if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= this.nodeCount || seen.has(nodeIndex)) {
                throw new TypeError('node animation active order is invalid');
            }
            const parentIndex = this.parents[nodeIndex];
            if (parentIndex >= 0 && !seen.has(parentIndex)) {
                throw new TypeError(`node animation parent ${parentIndex} must precede child ${nodeIndex}`);
            }
            seen.add(nodeIndex);
            this.activeNodes[nodeIndex] = 1;
        }

        const sourceAnimations = Array.isArray(animations) ? animations : [];
        this.animations = sourceAnimations.map((animation) => ({
            ...animation,
            _sourceChannelCount: Array.isArray(animation?.channels) ? animation.channels.length : 0,
            channels: (Array.isArray(animation?.channels) ? animation.channels : [])
                .filter((channel) => channel && ['translation', 'rotation', 'scale'].includes(channel.targetPath)
                    && this.activeNodes[channel.targetNode] === 1)
                .map((channel) => ({ ...channel, _lastIndex: 0 })),
        }));
        this.hasAnimationChannels = this.animations.some((animation) => animation._sourceChannelCount > 0);
        this.currentAnimIndex = 0;
        this.animTime = 0;
        this.playing = true;
        this.speed = 1;
        this.loop = true;
        this.dirty = true;
        this._resetPose();
        if (playbackState !== null && !this.setPlaybackState(playbackState)) {
            throw new TypeError('model animation playback state is invalid');
        }
        if (playbackState === null) this._sampleCurrentAnimation();
    }

    _copyFiniteVector(value, output, offset, length, label) {
        if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== length) {
            throw new TypeError(`${label} must contain ${length} values`);
        }
        for (let index = 0; index < length; index++) {
            if (!Number.isFinite(value[index])) throw new TypeError(`${label} must be finite`);
            output[offset + index] = value[index];
        }
    }

    _resetPose() {
        this.translations.set(this.baseTranslations);
        this.rotations.set(this.baseRotations);
        this.scales.set(this.baseScales);
    }

    _sampleCurrentAnimation() {
        this._resetPose();
        const animation = this.animations[this.currentAnimIndex];
        if (animation) {
            for (const channel of animation.channels) {
                const elementCount = channel.targetPath === 'rotation' ? 4 : 3;
                this._sampleScratch.fill(0);
                const report = _sampleChannelDirect(channel, this.animTime, this._sampleScratch, 0);
                if (!report?.valid) continue;
                const nodeOffset = channel.targetNode * elementCount;
                if (channel.targetPath === 'rotation') {
                    const length = Math.hypot(
                        this._sampleScratch[0], this._sampleScratch[1],
                        this._sampleScratch[2], this._sampleScratch[3],
                    );
                    if (!Number.isFinite(length) || length <= 1e-12) continue;
                    for (let axis = 0; axis < 4; axis++) this.rotations[nodeOffset + axis] = this._sampleScratch[axis] / length;
                } else {
                    const output = channel.targetPath === 'translation' ? this.translations : this.scales;
                    for (let axis = 0; axis < 3; axis++) output[nodeOffset + axis] = this._sampleScratch[axis];
                }
            }
        }
        this._computeWorldMatrices();
        this.dirty = true;
    }

    _computeWorldMatrices() {
        for (const nodeIndex of this.activeOrder) {
            const matrixOffset = nodeIndex * 16;
            if (this.matrixNodes[nodeIndex]) {
                this.localMatrices.set(this.staticLocalMatrices.subarray(matrixOffset, matrixOffset + 16), matrixOffset);
            } else {
                _trsToMatrix(
                    this.translations, nodeIndex * 3,
                    this.rotations, nodeIndex * 4,
                    this.scales, nodeIndex * 3,
                    this.localMatrices, matrixOffset,
                );
            }
            const parentIndex = this.parents[nodeIndex];
            if (parentIndex >= 0) {
                _mat4Multiply(
                    this.worldMatrices, parentIndex * 16,
                    this.localMatrices, matrixOffset,
                    this.worldMatrices, matrixOffset,
                );
            } else {
                this.worldMatrices.set(this.localMatrices.subarray(matrixOffset, matrixOffset + 16), matrixOffset);
            }
        }
    }

    tick(dt) {
        if (!this.playing || !Number.isFinite(dt)) return;
        const animation = this.animations[this.currentAnimIndex];
        if (!animation) return;
        const duration = Number(animation.duration);
        if (Number.isFinite(duration) && duration > 0) {
            const nextTime = this.animTime + dt * this.speed;
            if (this.loop) {
                this.animTime = ((nextTime % duration) + duration) % duration;
            } else {
                this.animTime = Math.min(duration, Math.max(0, nextTime));
                if (nextTime <= 0 || nextTime >= duration) this.playing = false;
            }
        } else {
            this.animTime = 0;
            this.playing = false;
        }
        this._sampleCurrentAnimation();
    }

    setAnimation(animationIndex, options = {}) {
        return this.setPlaybackState({
            clipIndex: animationIndex,
            time: options.time ?? 0,
            speed: options.speed ?? this.speed,
            playing: options.playing ?? this.playing,
            loop: options.loop ?? this.loop,
        });
    }

    seek(time) {
        if (!Number.isFinite(time)) return false;
        const duration = Number(this.animations[this.currentAnimIndex]?.duration);
        this.animTime = Number.isFinite(duration) && duration >= 0
            ? Math.min(duration, Math.max(0, time)) : Math.max(0, time);
        this._sampleCurrentAnimation();
        return true;
    }

    getPlaybackState() {
        return {
            clipIndex: this.currentAnimIndex,
            time: this.animTime,
            speed: this.speed,
            playing: this.playing,
            loop: this.loop,
        };
    }

    getDescriptor() {
        return {
            modelInstanceId: this.modelInstanceId,
            state: this.getPlaybackState(),
            clips: this.animations.map((animation, index) => ({
                index,
                name: typeof animation.name === 'string' && animation.name.length > 0
                    ? animation.name : `Clip ${index + 1}`,
                duration: Number.isFinite(animation.duration) && animation.duration >= 0 ? animation.duration : 0,
                channelCount: animation._sourceChannelCount,
            })),
        };
    }

    setPlaybackState(playbackState) {
        const report = animationPlaybackStateReport(playbackState, {
            clipDurations: this.animations.map((animation) => Number(animation.duration) || 0),
        });
        if (!report.valid) return false;
        const state = report.value;
        this.currentAnimIndex = state.clipIndex;
        this.animTime = state.time;
        this.speed = state.speed;
        this.playing = state.playing;
        this.loop = state.loop;
        this._sampleCurrentAnimation();
        return true;
    }

    getNodeWorldMatrix(nodeIndex) {
        if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= this.nodeCount || !this.activeNodes[nodeIndex]) return null;
        return this.worldMatrices.subarray(nodeIndex * 16, nodeIndex * 16 + 16);
    }
}

// ============================================================================
// SKINNED MESH INSTANCE
// ============================================================================

class SkinnedMeshInstance {
    constructor(meshKey, geo, skeleton, animations) {
        this.meshKey = meshKey;
        this.meshName = typeof geo.name === 'string' && geo.name.length > 0 ? geo.name : meshKey;
        this.meshNodeIndex = Number.isInteger(geo.nodeIndex) ? geo.nodeIndex : null;
        this.modelNodeAnimationId = null;
        this.vertexCount = geo.positions.length / 3;

        // Bind-pose geometry (immutable reference)
        this.bindPositions = new Float32Array(geo.positions);
        this.bindNormals = new Float32Array(geo.normals);
        this.bindTangents = geo.tangents && geo.tangents.length >= this.vertexCount * 4
            ? new Float32Array(geo.tangents)
            : null;

        this.morphTargets = Array.isArray(geo.morphTargets)
            ? geo.morphTargets.map((target) => ({
                ...target,
                positions: target?.positions ? new Float32Array(target.positions) : null,
                normals: target?.normals ? new Float32Array(target.normals) : null,
                tangents: target?.tangents ? new Float32Array(target.tangents) : null,
            }))
            : [];
        this.morphTargetCount = this.morphTargets.length;
        this.morphTargetNode = Number.isInteger(geo.morphTargetNode) ? geo.morphTargetNode : null;
        this.morphTargetNames = Array.isArray(geo.morphTargetNames)
            ? geo.morphTargetNames.slice(0, this.morphTargetCount)
            : new Array(this.morphTargetCount).fill('').map((_, index) => `target_${index}`);
        const initialMorphWeights = geo.morphWeights ?? new Array(this.morphTargetCount).fill(0);
        if (initialMorphWeights.length !== this.morphTargetCount) {
            throw new TypeError('morph weight count must match morph target count');
        }
        this.baseMorphWeights = new Float32Array(initialMorphWeights);
        this.manualMorphWeights = new Float32Array(initialMorphWeights);
        this.morphWeights = new Float32Array(initialMorphWeights);
        this.morphControlMode = 'animated';
        this._morphSampleWeights = new Float32Array(this.morphWeights);
        this.morphedPositions = this.morphTargetCount ? new Float32Array(this.bindPositions.length) : null;
        this.morphedNormals = this.morphTargetCount ? new Float32Array(this.bindNormals.length) : null;
        this.morphedTangents = this.morphTargetCount && this.bindTangents
            ? new Float32Array(this.bindTangents.length)
            : null;

        // Per-vertex joint indices (4 per vertex) and weights (4 per vertex)
        this.jointIndices = new Uint16Array(geo.joints);
        this.jointWeights = new Float32Array(geo.weights);

        // Skeleton
        this.jointCount = skeleton.jointCount;
        this.joints = skeleton.joints;
        this.inverseBindMatrices = skeleton.inverseBindMatrices; // Float32Array, jointCount * 16

        // Animation
        this.animations = animations || [];
        this.currentAnimIndex = 0;
        this.animTime = 0;
        this.playing = true;
        this.speed = 1.0;
        this.loop = true;

        // Output buffers (written each frame)
        this.skinnedPositions = new Float32Array(geo.positions.length);
        this.skinnedNormals = new Float32Array(geo.normals.length);
        this.skinnedTangents = this.bindTangents ? new Float32Array(this.bindTangents.length) : null;

        // Joint matrices scratch space
        this.localMatrices = new Float32Array(this.jointCount * 16);
        this.worldMatrices = new Float32Array(this.jointCount * 16);
        this.skinMatrices = new Float32Array(this.jointCount * 16);  // world * inverseBindMatrix
        this._externalMeshInverse = new Float32Array(16);
        this._externalSkinScratch = new Float32Array(16);

        // Current joint local transforms (animated)
        this.jointTranslations = new Float32Array(this.jointCount * 3);
        this.jointRotations = new Float32Array(this.jointCount * 4);
        this.jointScales = new Float32Array(this.jointCount * 3);

        // Initialize with bind pose
        for (let i = 0; i < this.jointCount; i++) {
            const j = this.joints[i];
            this.jointTranslations[i*3] = j.translation[0];
            this.jointTranslations[i*3+1] = j.translation[1];
            this.jointTranslations[i*3+2] = j.translation[2];
            this.jointRotations[i*4] = j.rotation[0];
            this.jointRotations[i*4+1] = j.rotation[1];
            this.jointRotations[i*4+2] = j.rotation[2];
            this.jointRotations[i*4+3] = j.rotation[3];
            this.jointScales[i*3] = j.scale[0];
            this.jointScales[i*3+1] = j.scale[1];
            this.jointScales[i*3+2] = j.scale[2];
        }

        this.dirty = true;
        this.gpuSkinning = false; // when true, skip CPU _skinVertices() — GPU compute handles it
        this.currentBounds = null;

        // Build nodeIndex -> jointIndex lookup for animation channels
        this._nodeToJoint = new Map();
        for (let i = 0; i < this.jointCount; i++) {
            this._nodeToJoint.set(this.joints[i].nodeIndex, i);
        }

        // Derive the missing root transform (Armature / scene-root nodes above skeleton)
        // inverseBindMatrices encode the full scene-root → joint path, but our hierarchy
        // only has joints. For root joints (parentIndex == -1), the missing ancestor
        // transform = expectedWorld * inverse(localMatrix).
        this.rootTransform = new Float32Array(16);
        // Identity default
        this.rootTransform[0] = 1; this.rootTransform[5] = 1;
        this.rootTransform[10] = 1; this.rootTransform[15] = 1;
        this._deriveRootTransform();

        // Do initial skin pass
        this._computeSkinMatrices();
        if (!this._applyMorphTargets()) throw new TypeError('invalid morph target geometry or weights');
        this._skinVertices();
        this._refreshBounds();

        // Compute per-bone capsule dimensions from vertex weights (once, cached)
        this.boneCapsules = this._computeBoneCapsules();
    }

    /**
     * Compute per-bone capsule dimensions using vertex bone weights.
     * For each bone, finds all vertices influenced by it (weight > threshold),
     * transforms them into the bone's local space, and fits a capsule along
     * the bone→child axis using max perpendicular distance (radius) and
     * extent along the axis (halfHeight).
     * @returns {Array<{radius: number, halfHeight: number}>}
     */
    _computeBoneCapsules() {
        // Lower threshold captures more vertices for small bones (head, fingers, toes)
        const WEIGHT_THRESHOLD = 0.08;
        const MIN_RADIUS = 0.02;
        const MIN_HH = 0.01;
        const ji = this.jointIndices;
        const jw = this.jointWeights;
        const sp = this.skinnedPositions; // use skinned (world-scale) positions
        const vc = this.vertexCount;

        // For each bone, collect skinned vertex positions weighted by that bone
        const boneVerts = new Array(this.jointCount);
        for (let b = 0; b < this.jointCount; b++) boneVerts[b] = [];

        for (let v = 0; v < vc; v++) {
            const v4 = v * 4;
            const v3 = v * 3;
            const px = sp[v3], py = sp[v3 + 1], pz = sp[v3 + 2];
            for (let k = 0; k < 4; k++) {
                const w = jw[v4 + k];
                if (w < WEIGHT_THRESHOLD) continue;
                const boneIdx = ji[v4 + k];
                if (boneIdx < this.jointCount) {
                    boneVerts[boneIdx].push(px, py, pz);
                }
            }
        }

        // Extract bone world positions from world matrices
        const capsules = [];
        for (let b = 0; b < this.jointCount; b++) {
            const verts = boneVerts[b];
            const o = b * 16;
            const bx = this.worldMatrices[o + 12];
            const by = this.worldMatrices[o + 13];
            const bz = this.worldMatrices[o + 14];

            if (verts.length < 9) { // fewer than 3 vertices
                capsules.push({ radius: MIN_RADIUS * 2, halfHeight: MIN_HH });
                continue;
            }

            // Compute bone axis: bone→first child direction, or parent→bone for leaves
            let ax = 0, ay = 1, az = 0; // default up
            const bone = this.joints[b];
            const childMap = this._getChildMap();
            const children = childMap.get(b);
            if (children && children.length > 0) {
                const ci = children[0];
                const co = ci * 16;
                const cx = this.worldMatrices[co + 12] - bx;
                const cy = this.worldMatrices[co + 13] - by;
                const cz = this.worldMatrices[co + 14] - bz;
                const cl = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
                ax = cx / cl; ay = cy / cl; az = cz / cl;
            } else if (bone.parentIndex >= 0) {
                const po = bone.parentIndex * 16;
                const px = bx - this.worldMatrices[po + 12];
                const py = by - this.worldMatrices[po + 13];
                const pz = bz - this.worldMatrices[po + 14];
                const pl = Math.sqrt(px * px + py * py + pz * pz) || 1;
                ax = px / pl; ay = py / pl; az = pz / pl;
            }

            // For each influenced vertex, compute perpendicular distance to bone axis
            // and signed projection along axis
            const perpDists = [];
            let minProj = Infinity, maxProj = -Infinity;
            const nv = verts.length / 3;
            for (let i = 0; i < nv; i++) {
                const dx = verts[i * 3] - bx;
                const dy = verts[i * 3 + 1] - by;
                const dz = verts[i * 3 + 2] - bz;
                // Project onto bone axis
                const proj = dx * ax + dy * ay + dz * az;
                // Perpendicular distance
                const perpX = dx - proj * ax;
                const perpY = dy - proj * ay;
                const perpZ = dz - proj * az;
                const perpDist = Math.sqrt(perpX * perpX + perpY * perpY + perpZ * perpZ);
                perpDists.push(perpDist);
                if (proj < minProj) minProj = proj;
                if (proj > maxProj) maxProj = proj;
            }

            // Use 90th percentile perpendicular distance for radius (robust against outliers)
            perpDists.sort((a, c) => a - c);
            const p90Idx = Math.min(perpDists.length - 1, Math.floor(perpDists.length * 0.9));
            const p90Perp = perpDists[p90Idx];

            const radius = Math.max(MIN_RADIUS, p90Perp * 0.95);
            const axisLen = Math.max(0, maxProj - minProj);
            const halfHeight = Math.max(MIN_HH, axisLen * 0.5 - radius);
            capsules.push({ radius, halfHeight });
        }

        return capsules;
    }

    /** Build and cache child map (parentIdx -> [childIdx, ...]) */
    _getChildMap() {
        if (this._childMapCache) return this._childMapCache;
        const map = new Map();
        for (let i = 0; i < this.jointCount; i++) {
            const pi = this.joints[i].parentIndex;
            if (pi >= 0) {
                if (!map.has(pi)) map.set(pi, []);
                map.get(pi).push(i);
            }
        }
        this._childMapCache = map;
        return map;
    }

    hasActiveMorphs() {
        for (let index = 0; index < this.morphWeights.length; index++) {
            if (this.morphWeights[index] !== 0) return true;
        }
        return false;
    }

    _positionSource() {
        return this.morphTargetCount ? this.morphedPositions : this.bindPositions;
    }

    _normalSource() {
        return this.morphTargetCount ? this.morphedNormals : this.bindNormals;
    }

    _tangentSource() {
        return this.morphTargetCount ? this.morphedTangents : this.bindTangents;
    }

    _applyMorphTargets() {
        if (this.morphTargetCount === 0) return true;
        const positionReport = morphedPositionBoundsReport(
            this.bindPositions,
            this.morphTargets,
            this.morphWeights,
            { output: this.morphedPositions },
        );
        if (!positionReport.valid) return false;
        const normalReport = morphAttributeDeltasReport(
            this.bindNormals,
            this.morphTargets,
            this.morphWeights,
            { field: 'normals', baseStride: 3, deltaStride: 3, output: this.morphedNormals },
        );
        if (!normalReport.valid) return false;
        if (this.bindTangents) {
            const tangentReport = morphAttributeDeltasReport(
                this.bindTangents,
                this.morphTargets,
                this.morphWeights,
                {
                    field: 'tangents',
                    baseStride: 4,
                    deltaStride: 3,
                    deformedComponents: 3,
                    output: this.morphedTangents,
                },
            );
            if (!tangentReport.valid) return false;
        }
        return true;
    }

    _morphWeightsValid(weights) {
        if (!morphedPositionBoundsReport(this.bindPositions, this.morphTargets, weights).valid) return false;
        if (!morphAttributeDeltasReport(
            this.bindNormals,
            this.morphTargets,
            weights,
            { field: 'normals', baseStride: 3, deltaStride: 3 },
        ).valid) return false;
        return !this.bindTangents || morphAttributeDeltasReport(
            this.bindTangents,
            this.morphTargets,
            weights,
            { field: 'tangents', baseStride: 4, deltaStride: 3, deformedComponents: 3 },
        ).valid;
    }

    _refreshBounds() {
        const cpuGeometryCurrent = !this.gpuSkinning || this.hasActiveMorphs() || this.ragdollMode;
        const report = cpuGeometryCurrent
            ? positionBoundsReport(this.skinnedPositions)
            : skinnedPositionBoundsReport(
                this._positionSource(),
                this.jointIndices,
                this.jointWeights,
                this.skinMatrices,
            );
        if (report.valid) this.currentBounds = report;
        return report;
    }

    setMorphWeights(weights) {
        return this.setMorphControlState('manual', weights);
    }

    getMorphControlState() {
        return {
            mode: this.morphControlMode,
            weights: Array.from(this.manualMorphWeights),
        };
    }

    setMorphControlState(mode, weights) {
        if (mode !== 'animated' && mode !== 'manual') return false;
        const arrayLike = Array.isArray(weights) ||
            (ArrayBuffer.isView(weights) && !(weights instanceof DataView));
        if (!arrayLike || weights.length !== this.morphTargetCount || this.morphTargetCount === 0) return false;
        const candidate = new Float32Array(weights);
        if (!this._morphWeightsValid(candidate)) return false;
        this.manualMorphWeights.set(candidate);
        this.morphControlMode = mode;
        this.morphWeights.set(mode === 'manual' ? candidate : this.baseMorphWeights);
        if (mode === 'animated') {
            const animation = this.animations[this.currentAnimIndex];
            if (animation) this._sampleAnimation(animation, this.animTime, false);
        }
        if (!this._applyMorphTargets()) return false;
        this._skinVertices();
        this._refreshBounds();
        this.dirty = true;
        return true;
    }

    tick(dt) {
        const nodeAnimation = this.modelNodeAnimationId
            ? _nodeAnimationInstances.get(this.modelNodeAnimationId) : null;
        if (nodeAnimation) {
            const animation = this.animations[nodeAnimation.currentAnimIndex];
            this.currentAnimIndex = nodeAnimation.currentAnimIndex;
            this.animTime = nodeAnimation.animTime;
            this.playing = nodeAnimation.playing;
            this.loop = nodeAnimation.loop;
            this.speed = nodeAnimation.speed;
            const morphChanged = animation ? this._sampleAnimation(animation, this.animTime, false) : false;
            if (morphChanged && !this._applyMorphTargets()) return;
            if (!this._computeSkinMatricesFromNodeAnimation(nodeAnimation)) return;
            if (!this.gpuSkinning || this.hasActiveMorphs()) this._skinVertices();
            this._refreshBounds();
            this.dirty = true;
            return;
        }
        if (!this.playing || this.animations.length === 0) return;

        const anim = this.animations[this.currentAnimIndex];
        if (!anim || anim.duration <= 0) return;

        this.animTime += dt * this.speed;
        if (this.loop) {
            this.animTime = this.animTime % anim.duration;
        } else if (this.animTime > anim.duration) {
            this.animTime = anim.duration;
            this.playing = false;
        }

        // Sample animation channels, including packed morph target weights.
        const morphChanged = this._sampleAnimation(anim, this.animTime);
        if (morphChanged && !this._applyMorphTargets()) return;

        // Recompute skin matrices (always needed for bone shapes / ragdoll queries)
        this._computeSkinMatrices();

        // CPU skinning only when GPU compute isn't handling it
        if (!this.gpuSkinning || this.hasActiveMorphs()) {
            this._skinVertices();
        }
        this._refreshBounds();
        this.dirty = true;
    }

    // ========================================================================
    // ANIMATION SAMPLING
    // ========================================================================

    _sampleAnimation(anim, time, sampleJointTransforms = true) {
        const sampleMorph = this.morphControlMode === 'animated' && this.morphTargetCount > 0;
        if (sampleMorph) this._morphSampleWeights.set(this.baseMorphWeights);
        let morphChanged = false;
        for (const ch of anim.channels) {
            if (ch.targetPath === 'weights') {
                if (!sampleMorph ||
                    (this.morphTargetNode !== null && ch.targetNode !== this.morphTargetNode)) continue;
                _sampleMorphChannelDirect(ch, time, this._morphSampleWeights, this.morphTargetCount);
                continue;
            }
            if (!sampleJointTransforms) continue;
            const jointIdx = this._nodeToJoint.get(ch.targetNode);
            if (jointIdx === undefined) continue;

            switch (ch.targetPath) {
                case 'translation': {
                    const o = jointIdx * 3;
                    _sampleChannelDirect(ch, time, this.jointTranslations, o);
                    break;
                }
                case 'rotation': {
                    const o = jointIdx * 4;
                    _sampleChannelDirect(ch, time, this.jointRotations, o);
                    break;
                }
                case 'scale': {
                    const o = jointIdx * 3;
                    _sampleChannelDirect(ch, time, this.jointScales, o);
                    break;
                }
            }
        }
        if (sampleMorph && this._morphWeightsValid(this._morphSampleWeights)) {
            for (let index = 0; index < this.morphTargetCount; index++) {
                if (this.morphWeights[index] !== this._morphSampleWeights[index]) morphChanged = true;
            }
            this.morphWeights.set(this._morphSampleWeights);
        }
        return morphChanged;
    }

    bindModelNodeAnimation(modelInstanceId, nodeAnimation) {
        if (this.meshNodeIndex === null || !nodeAnimation.getNodeWorldMatrix(this.meshNodeIndex)) return false;
        for (const joint of this.joints) {
            if (!nodeAnimation.getNodeWorldMatrix(joint.nodeIndex)) return false;
        }
        this.modelNodeAnimationId = modelInstanceId;
        const animation = this.animations[nodeAnimation.currentAnimIndex];
        const morphChanged = animation ? this._sampleAnimation(animation, nodeAnimation.animTime, false) : false;
        if (morphChanged && !this._applyMorphTargets()) return false;
        if (!this._computeSkinMatricesFromNodeAnimation(nodeAnimation)) return false;
        this._skinVertices();
        this._refreshBounds();
        this.dirty = true;
        return true;
    }

    _computeSkinMatricesFromNodeAnimation(nodeAnimation) {
        const meshWorld = nodeAnimation.getNodeWorldMatrix(this.meshNodeIndex);
        if (!meshWorld || !_mat4Invert(meshWorld, this._externalMeshInverse)) return false;
        for (let jointIndex = 0; jointIndex < this.jointCount; jointIndex++) {
            const jointWorld = nodeAnimation.getNodeWorldMatrix(this.joints[jointIndex].nodeIndex);
            if (!jointWorld) return false;
            this.worldMatrices.set(jointWorld, jointIndex * 16);
            _mat4Multiply(
                jointWorld, 0,
                this.inverseBindMatrices, jointIndex * 16,
                this._externalSkinScratch, 0,
            );
            _mat4Multiply(
                this._externalMeshInverse, 0,
                this._externalSkinScratch, 0,
                this.skinMatrices, jointIndex * 16,
            );
        }
        return true;
    }

    // ========================================================================
    // MATRIX COMPUTATION
    // ========================================================================

    /**
     * Derive the non-joint ancestor transform (e.g. Armature node) that sits
     * above the skeleton root in the glTF scene graph.  The inverseBindMatrices
     * encode the full path from scene-root to joint, but our joint hierarchy
     * only tracks joint-to-joint parents.  For the first root joint we compute:
     *   expectedWorld = inverse(IBM[root])
     *   rootTransform  = expectedWorld * inverse(localMatrix[root])
     */
    _deriveRootTransform() {
        // Find first root joint
        let rootIdx = -1;
        for (let i = 0; i < this.jointCount; i++) {
            if (this.joints[i].parentIndex < 0) { rootIdx = i; break; }
        }
        if (rootIdx < 0) return;

        // Compute local matrix for root joint
        const localMat = new Float32Array(16);
        _trsToMatrix(
            this.jointTranslations, rootIdx * 3,
            this.jointRotations, rootIdx * 4,
            this.jointScales, rootIdx * 3,
            localMat, 0
        );

        // Expected world = inverse(inverseBindMatrix[rootIdx])
        const ibm = this.inverseBindMatrices.subarray(rootIdx * 16, rootIdx * 16 + 16);
        const expectedWorld = new Float32Array(16);
        _mat4Invert(ibm, expectedWorld);

        // inverse(localMat)
        const invLocal = new Float32Array(16);
        _mat4Invert(localMat, invLocal);

        // rootTransform = expectedWorld * inverse(localMat)
        const tmp = new Float32Array(16);
        _mat4Multiply(expectedWorld, 0, invLocal, 0, tmp, 0);
        this.rootTransform.set(tmp);
    }

    _computeSkinMatrices() {
        // 1. Compute local matrices from TRS
        for (let i = 0; i < this.jointCount; i++) {
            _trsToMatrix(
                this.jointTranslations, i * 3,
                this.jointRotations, i * 4,
                this.jointScales, i * 3,
                this.localMatrices, i * 16
            );
        }

        // 2. Compute world matrices by walking hierarchy
        for (let i = 0; i < this.jointCount; i++) {
            const parentIdx = this.joints[i].parentIndex;
            if (parentIdx < 0) {
                // Root joint: world = rootTransform * local
                _mat4Multiply(
                    this.rootTransform, 0,
                    this.localMatrices, i * 16,
                    this.worldMatrices, i * 16
                );
            } else {
                // world = parent.world * local
                _mat4Multiply(
                    this.worldMatrices, parentIdx * 16,
                    this.localMatrices, i * 16,
                    this.worldMatrices, i * 16
                );
            }
        }

        // 3. Compute skin matrices: skinMatrix = worldMatrix * inverseBindMatrix
        for (let i = 0; i < this.jointCount; i++) {
            _mat4Multiply(
                this.worldMatrices, i * 16,
                this.inverseBindMatrices, i * 16,
                this.skinMatrices, i * 16
            );
        }
    }

    // ========================================================================
    // VERTEX SKINNING (CPU)
    // ========================================================================

    _skinVertices() {
        const bp = this._positionSource();
        const bn = this._normalSource();
        const bt = this._tangentSource();
        const sp = this.skinnedPositions;
        const sn = this.skinnedNormals;
        const st = this.skinnedTangents;
        const ji = this.jointIndices;
        const jw = this.jointWeights;
        const sm = this.skinMatrices;
        const vc = this.vertexCount;

        for (let v = 0; v < vc; v++) {
            const v3 = v * 3;
            const v4 = v * 4;

            const px = bp[v3], py = bp[v3+1], pz = bp[v3+2];
            const nx = bn[v3], ny = bn[v3+1], nz = bn[v3+2];
            const ti = v * 4;
            const hasTangents = bt && st;

            // Pre-load all 4 influences (unconditional — avoids branch misprediction)
            const w0 = jw[v4], w1 = jw[v4+1], w2 = jw[v4+2], w3 = jw[v4+3];
            const o0 = ji[v4] * 16, o1 = ji[v4+1] * 16, o2 = ji[v4+2] * 16, o3 = ji[v4+3] * 16;

            // Transform position by weighted skin matrices
            const sx = w0 * (sm[o0]*px + sm[o0+4]*py + sm[o0+8]*pz + sm[o0+12])
                      + w1 * (sm[o1]*px + sm[o1+4]*py + sm[o1+8]*pz + sm[o1+12])
                      + w2 * (sm[o2]*px + sm[o2+4]*py + sm[o2+8]*pz + sm[o2+12])
                      + w3 * (sm[o3]*px + sm[o3+4]*py + sm[o3+8]*pz + sm[o3+12]);
            const sy = w0 * (sm[o0+1]*px + sm[o0+5]*py + sm[o0+9]*pz + sm[o0+13])
                      + w1 * (sm[o1+1]*px + sm[o1+5]*py + sm[o1+9]*pz + sm[o1+13])
                      + w2 * (sm[o2+1]*px + sm[o2+5]*py + sm[o2+9]*pz + sm[o2+13])
                      + w3 * (sm[o3+1]*px + sm[o3+5]*py + sm[o3+9]*pz + sm[o3+13]);
            const sz = w0 * (sm[o0+2]*px + sm[o0+6]*py + sm[o0+10]*pz + sm[o0+14])
                      + w1 * (sm[o1+2]*px + sm[o1+6]*py + sm[o1+10]*pz + sm[o1+14])
                      + w2 * (sm[o2+2]*px + sm[o2+6]*py + sm[o2+10]*pz + sm[o2+14])
                      + w3 * (sm[o3+2]*px + sm[o3+6]*py + sm[o3+10]*pz + sm[o3+14]);

            sp[v3] = sx; sp[v3+1] = sy; sp[v3+2] = sz;

            // Transform normal by upper-3x3 (no translation)
            const snx = w0 * (sm[o0]*nx + sm[o0+4]*ny + sm[o0+8]*nz)
                       + w1 * (sm[o1]*nx + sm[o1+4]*ny + sm[o1+8]*nz)
                       + w2 * (sm[o2]*nx + sm[o2+4]*ny + sm[o2+8]*nz)
                       + w3 * (sm[o3]*nx + sm[o3+4]*ny + sm[o3+8]*nz);
            const sny = w0 * (sm[o0+1]*nx + sm[o0+5]*ny + sm[o0+9]*nz)
                       + w1 * (sm[o1+1]*nx + sm[o1+5]*ny + sm[o1+9]*nz)
                       + w2 * (sm[o2+1]*nx + sm[o2+5]*ny + sm[o2+9]*nz)
                       + w3 * (sm[o3+1]*nx + sm[o3+5]*ny + sm[o3+9]*nz);
            const snz = w0 * (sm[o0+2]*nx + sm[o0+6]*ny + sm[o0+10]*nz)
                       + w1 * (sm[o1+2]*nx + sm[o1+6]*ny + sm[o1+10]*nz)
                       + w2 * (sm[o2+2]*nx + sm[o2+6]*ny + sm[o2+10]*nz)
                       + w3 * (sm[o3+2]*nx + sm[o3+6]*ny + sm[o3+10]*nz);

            // Normalize skinned normal
            const nlen = Math.sqrt(snx*snx + sny*sny + snz*snz) || 1;
            sn[v3] = snx/nlen; sn[v3+1] = sny/nlen; sn[v3+2] = snz/nlen;

            if (hasTangents) {
                const tx = bt[ti], ty = bt[ti+1], tz = bt[ti+2];
                let stx = w0 * (sm[o0]*tx + sm[o0+4]*ty + sm[o0+8]*tz)
                        + w1 * (sm[o1]*tx + sm[o1+4]*ty + sm[o1+8]*tz)
                        + w2 * (sm[o2]*tx + sm[o2+4]*ty + sm[o2+8]*tz)
                        + w3 * (sm[o3]*tx + sm[o3+4]*ty + sm[o3+8]*tz);
                let sty = w0 * (sm[o0+1]*tx + sm[o0+5]*ty + sm[o0+9]*tz)
                        + w1 * (sm[o1+1]*tx + sm[o1+5]*ty + sm[o1+9]*tz)
                        + w2 * (sm[o2+1]*tx + sm[o2+5]*ty + sm[o2+9]*tz)
                        + w3 * (sm[o3+1]*tx + sm[o3+5]*ty + sm[o3+9]*tz);
                let stz = w0 * (sm[o0+2]*tx + sm[o0+6]*ty + sm[o0+10]*tz)
                        + w1 * (sm[o1+2]*tx + sm[o1+6]*ty + sm[o1+10]*tz)
                        + w2 * (sm[o2+2]*tx + sm[o2+6]*ty + sm[o2+10]*tz)
                        + w3 * (sm[o3+2]*tx + sm[o3+6]*ty + sm[o3+10]*tz);

                const tdot = stx * sn[v3] + sty * sn[v3+1] + stz * sn[v3+2];
                stx -= sn[v3] * tdot;
                sty -= sn[v3+1] * tdot;
                stz -= sn[v3+2] * tdot;
                const tlen = Math.sqrt(stx*stx + sty*sty + stz*stz) || 1;
                st[ti] = stx / tlen;
                st[ti+1] = sty / tlen;
                st[ti+2] = stz / tlen;
                st[ti+3] = bt[ti+3] < 0 ? -1 : 1;
            }
        }
    }
}

// ============================================================================
// ANIMATION CHANNEL SAMPLING
// ============================================================================

/**
 * Sample a channel and write the result directly into a target typed array.
 * Uses shared AnimationTimeMath interpolation while keeping the renderer's
 * typed-array output contract.
 */
function _sampleChannelDirect(channel, time, outArr, outOff) {
    const times = channel.times;
    const n = times.length;
    if (n === 0) return null;
    const stride = channel.targetPath === 'rotation' ? 4 : 3;
    const report = animationSampleChannelInto(times, channel.values, time, outArr, outOff, {
        elemCount: stride,
        hintIndex: channel._lastIndex || 0,
        interpolation: channel.interpolation || 'LINEAR',
        path: channel.targetPath,
    });
    if (report.bracket?.valid) channel._lastIndex = report.bracket.lowerIndex;
    return report;
}

function _sampleMorphChannelDirect(channel, time, outArr, targetCount) {
    const times = channel.times;
    if (!times || times.length === 0 || targetCount <= 0) return;
    const report = animationSampleChannelInto(times, channel.values, time, outArr, 0, {
        elemCount: targetCount,
        hintIndex: channel._lastIndex || 0,
        interpolation: channel.interpolation || 'LINEAR',
        path: 'weights',
    });
    if (report.bracket?.valid) channel._lastIndex = report.bracket.lowerIndex;
}

// Legacy wrappers kept for external callers (getAnimatedBoneShapes etc.)
function _sampleChannel(channel, time) {
    const stride = channel.targetPath === 'rotation' ? 4 : 3;
    const out = new Float32Array(stride);
    _sampleChannelDirect(channel, time, out, 0);
    return out;
}

function _getKeyframe(channel, index) {
    const stride = channel.targetPath === 'rotation' ? 4 : 3;
    const offset = index * stride;
    const result = [];
    for (let i = 0; i < stride; i++) {
        result.push(channel.values[offset + i]);
    }
    return result;
}

// ============================================================================
// MATRIX MATH
// ============================================================================

function _trsToMatrix(t, tOff, r, rOff, s, sOff, out, outOff) {
    // Quaternion to matrix with scale and translation
    const qx = r[rOff], qy = r[rOff+1], qz = r[rOff+2], qw = r[rOff+3];
    const sx = s[sOff], sy = s[sOff+1], sz = s[sOff+2];
    const tx = t[tOff], ty = t[tOff+1], tz = t[tOff+2];

    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2;
    const yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;

    out[outOff + 0] = (1 - (yy + zz)) * sx;
    out[outOff + 1] = (xy + wz) * sx;
    out[outOff + 2] = (xz - wy) * sx;
    out[outOff + 3] = 0;

    out[outOff + 4] = (xy - wz) * sy;
    out[outOff + 5] = (1 - (xx + zz)) * sy;
    out[outOff + 6] = (yz + wx) * sy;
    out[outOff + 7] = 0;

    out[outOff + 8] = (xz + wy) * sz;
    out[outOff + 9] = (yz - wx) * sz;
    out[outOff + 10] = (1 - (xx + yy)) * sz;
    out[outOff + 11] = 0;

    out[outOff + 12] = tx;
    out[outOff + 13] = ty;
    out[outOff + 14] = tz;
    out[outOff + 15] = 1;
}

function _mat4Multiply(a, aOff, b, bOff, out, outOff) {
    // out = a * b (column-major, fully unrolled)
    const a0 = a[aOff], a1 = a[aOff+1], a2 = a[aOff+2], a3 = a[aOff+3];
    const a4 = a[aOff+4], a5 = a[aOff+5], a6 = a[aOff+6], a7 = a[aOff+7];
    const a8 = a[aOff+8], a9 = a[aOff+9], a10 = a[aOff+10], a11 = a[aOff+11];
    const a12 = a[aOff+12], a13 = a[aOff+13], a14 = a[aOff+14], a15 = a[aOff+15];

    let b0 = b[bOff], b1 = b[bOff+1], b2 = b[bOff+2], b3 = b[bOff+3];
    out[outOff]   = a0*b0 + a4*b1 + a8*b2 + a12*b3;
    out[outOff+1] = a1*b0 + a5*b1 + a9*b2 + a13*b3;
    out[outOff+2] = a2*b0 + a6*b1 + a10*b2 + a14*b3;
    out[outOff+3] = a3*b0 + a7*b1 + a11*b2 + a15*b3;

    b0 = b[bOff+4]; b1 = b[bOff+5]; b2 = b[bOff+6]; b3 = b[bOff+7];
    out[outOff+4] = a0*b0 + a4*b1 + a8*b2 + a12*b3;
    out[outOff+5] = a1*b0 + a5*b1 + a9*b2 + a13*b3;
    out[outOff+6] = a2*b0 + a6*b1 + a10*b2 + a14*b3;
    out[outOff+7] = a3*b0 + a7*b1 + a11*b2 + a15*b3;

    b0 = b[bOff+8]; b1 = b[bOff+9]; b2 = b[bOff+10]; b3 = b[bOff+11];
    out[outOff+8]  = a0*b0 + a4*b1 + a8*b2 + a12*b3;
    out[outOff+9]  = a1*b0 + a5*b1 + a9*b2 + a13*b3;
    out[outOff+10] = a2*b0 + a6*b1 + a10*b2 + a14*b3;
    out[outOff+11] = a3*b0 + a7*b1 + a11*b2 + a15*b3;

    b0 = b[bOff+12]; b1 = b[bOff+13]; b2 = b[bOff+14]; b3 = b[bOff+15];
    out[outOff+12] = a0*b0 + a4*b1 + a8*b2 + a12*b3;
    out[outOff+13] = a1*b0 + a5*b1 + a9*b2 + a13*b3;
    out[outOff+14] = a2*b0 + a6*b1 + a10*b2 + a14*b3;
    out[outOff+15] = a3*b0 + a7*b1 + a11*b2 + a15*b3;
}

function _mat3ToQuat(m00, m01, m02, m10, m11, m12, m20, m21, m22) {
    // Convert 3x3 rotation matrix to quaternion [x, y, z, w]
    const trace = m00 + m11 + m22;
    let qx, qy, qz, qw;
    if (trace > 0) {
        const s = 0.5 / Math.sqrt(trace + 1.0);
        qw = 0.25 / s;
        qx = (m21 - m12) * s;
        qy = (m02 - m20) * s;
        qz = (m10 - m01) * s;
    } else if (m00 > m11 && m00 > m22) {
        const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
        qw = (m21 - m12) / s;
        qx = 0.25 * s;
        qy = (m01 + m10) / s;
        qz = (m02 + m20) / s;
    } else if (m11 > m22) {
        const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
        qw = (m02 - m20) / s;
        qx = (m01 + m10) / s;
        qy = 0.25 * s;
        qz = (m12 + m21) / s;
    } else {
        const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
        qw = (m10 - m01) / s;
        qx = (m02 + m20) / s;
        qy = (m12 + m21) / s;
        qz = 0.25 * s;
    }
    const len = Math.sqrt(qx*qx + qy*qy + qz*qz + qw*qw) || 1;
    return [qx/len, qy/len, qz/len, qw/len];
}

// ============================================================================
// BONE CLASSIFICATION HELPERS (used by getAnimatedBoneShapes)
// ============================================================================

/**
 * Detect terminal/end bones that should be skipped for collision/visual.
 * These are leaf bones added by exporters (e.g. "LeftHand_End", "HeadTop_End").
 */
function _isTerminalBone(name) {
    if (!name) return false;
    if (/_end$/i.test(name) || /End$/.test(name) || /nub$/i.test(name)) return true;
    if (/head.*(front|top|back)/i.test(name)) return true;
    if (/eye/i.test(name)) return true;
    return false;
}

/**
 * Classify a bone by name into a body region.
 * Used to apply region-specific radius caps and sizing rules.
 * @returns {'root'|'spine'|'head'|'shoulder'|'elbow'|'hand'|'hip'|'knee'|'foot'|'extremity'|'default'}
 */
function _classifyBone(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('pelvis') || n.includes('hips') || n === 'root' || n.includes('root_bone')) return 'root';
    if (n.includes('spine') || n.includes('chest')) return 'spine';
    if (n.includes('neck') || n.includes('head')) return 'head';
    if (n.includes('shoulder') || n.includes('upper_arm') || n.includes('upperarm') || (n.includes('arm') && !n.includes('forearm') && !n.includes('fore_arm') && !n.includes('lower'))) return 'shoulder';
    if (n.includes('elbow') || n.includes('forearm') || n.includes('fore_arm') || n.includes('lower_arm') || n.includes('lowerarm')) return 'elbow';
    if (n.includes('wrist') || n.includes('hand')) return 'hand';
    if (n.includes('hip') || n.includes('upper_leg') || n.includes('upperleg') || n.includes('upleg') || n.includes('thigh')) return 'hip';
    if (n.includes('knee') || n.includes('lower_leg') || n.includes('lowerleg') || n.includes('shin') || n.includes('calf') || (n.includes('leg') && !n.includes('upleg') && !n.includes('upper'))) return 'knee';
    if (n.includes('ankle') || n.includes('foot')) return 'foot';
    if (n.includes('toe') || n.includes('finger')) return 'extremity';
    return 'default';
}

/**
 * Compute quaternion that aligns the Y-axis [0,1,0] with the given direction.
 * Used to orient capsule shapes along bone directions.
 * @returns {number[]} [qx, qy, qz, qw]
 */
function _quatFromDir(dx, dy, dz) {
    // from = [0,1,0], to = [dx,dy,dz]
    const dot = dy; // dot([0,1,0], [dx,dy,dz])
    if (dot > 0.9999) return [0, 0, 0, 1]; // already aligned
    if (dot < -0.9999) return [0, 0, 1, 0]; // 180° flip around Z
    // cross([0,1,0], [dx,dy,dz]) = [dz, 0, -dx]
    const cx = dz, cy = 0, cz = -dx;
    const w = 1 + dot;
    const len = Math.sqrt(cx*cx + cy*cy + cz*cz + w*w) || 1;
    return [cx/len, cy/len, cz/len, w/len];
}

function _mat4Invert(src, dst) {
    // 4x4 column-major matrix inversion
    const m = src;
    const s = (typeof src.byteOffset !== 'undefined') ? 0 : 0;
    const a00 = m[s+0], a01 = m[s+1], a02 = m[s+2], a03 = m[s+3];
    const a10 = m[s+4], a11 = m[s+5], a12 = m[s+6], a13 = m[s+7];
    const a20 = m[s+8], a21 = m[s+9], a22 = m[s+10], a23 = m[s+11];
    const a30 = m[s+12], a31 = m[s+13], a32 = m[s+14], a33 = m[s+15];

    const b00 = a00*a11 - a01*a10;
    const b01 = a00*a12 - a02*a10;
    const b02 = a00*a13 - a03*a10;
    const b03 = a01*a12 - a02*a11;
    const b04 = a01*a13 - a03*a11;
    const b05 = a02*a13 - a03*a12;
    const b06 = a20*a31 - a21*a30;
    const b07 = a20*a32 - a22*a30;
    const b08 = a20*a33 - a23*a30;
    const b09 = a21*a32 - a22*a31;
    const b10 = a21*a33 - a23*a31;
    const b11 = a22*a33 - a23*a32;

    let det = b00*b11 - b01*b10 + b02*b09 + b03*b08 - b04*b07 + b05*b06;
    if (Math.abs(det) < 1e-10) {
        // Singular — return identity
        dst.fill(0); dst[0] = 1; dst[5] = 1; dst[10] = 1; dst[15] = 1;
        return false;
    }
    det = 1.0 / det;

    dst[0]  = ( a11*b11 - a12*b10 + a13*b09) * det;
    dst[1]  = (-a01*b11 + a02*b10 - a03*b09) * det;
    dst[2]  = ( a31*b05 - a32*b04 + a33*b03) * det;
    dst[3]  = (-a21*b05 + a22*b04 - a23*b03) * det;
    dst[4]  = (-a10*b11 + a12*b08 - a13*b07) * det;
    dst[5]  = ( a00*b11 - a02*b08 + a03*b07) * det;
    dst[6]  = (-a30*b05 + a32*b02 - a33*b01) * det;
    dst[7]  = ( a20*b05 - a22*b02 + a23*b01) * det;
    dst[8]  = ( a10*b10 - a11*b08 + a13*b06) * det;
    dst[9]  = (-a00*b10 + a01*b08 - a03*b06) * det;
    dst[10] = ( a30*b04 - a31*b02 + a33*b00) * det;
    dst[11] = (-a20*b04 + a21*b02 - a23*b00) * det;
    dst[12] = (-a10*b09 + a11*b07 - a12*b06) * det;
    dst[13] = ( a00*b09 - a01*b07 + a02*b06) * det;
    dst[14] = (-a30*b03 + a31*b01 - a32*b00) * det;
    dst[15] = ( a20*b03 - a21*b01 + a22*b00) * det;
    return true;
}
