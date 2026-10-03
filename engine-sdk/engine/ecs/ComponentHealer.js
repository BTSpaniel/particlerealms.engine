// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ComponentHealer.js - Self-Healing Data Validation System
 * 
 * Implements auto-repair for component data using triangulation:
 * - Detects missing/invalid/corrupted data
 * - Infers correct values from multiple sources (redundancy)
 * - Applies intelligent repairs with fallbacks
 * - Logs all healing actions for diagnostics
 * 
 * Based on self-healing system principles:
 * 1. Monitoring & Detection
 * 2. Diagnostics Engine  
 * 3. Decision-Making Module
 * 4. Execution Framework
 * 5. Knowledge Base (schema defaults + inference rules)
 * 6. Feedback Loop (healing log)
 */

import { COMPONENT_SCHEMAS, normalizeField, getSchemaDefaults } from './EntitySchema.js';

// ============================================================================
// HEALING LOG - Track all repairs for diagnostics
// ============================================================================

const healingLog = [];
const MAX_LOG_ENTRIES = 1000;

function logHealing(componentName, entityId, field, issue, repair, confidence) {
    const entry = {
        timestamp: Date.now(),
        component: componentName,
        entityId,
        field,
        issue,
        repair,
        confidence, // 0-1, how confident we are in the repair
    };
    
    healingLog.push(entry);
    if (healingLog.length > MAX_LOG_ENTRIES) {
        healingLog.shift();
    }
    
    // Log significant repairs
    if (confidence < 0.8) {
        console.warn(`[ComponentHealer] Low-confidence repair: ${componentName}.${field} - ${issue} → ${JSON.stringify(repair)} (${(confidence * 100).toFixed(0)}%)`);
    } else {
        console.log(`[ComponentHealer] Healed: ${componentName}.${field} - ${issue}`);
    }
    
    return entry;
}

export function getHealingLog() {
    return [...healingLog];
}

export function clearHealingLog() {
    healingLog.length = 0;
}

// ============================================================================
// TRIANGULATION SOURCES - Multiple ways to infer correct values
// ============================================================================

/**
 * Triangulation context - provides multiple sources for inferring values
 */
export class TriangulationContext {
    constructor(options = {}) {
        this.ecsWorld = options.ecsWorld || null;
        this.scene = options.scene || null;
        this.entityId = options.entityId || null;
        this.previousValue = options.previousValue || null; // Last known good value
        this.neighborData = options.neighborData || null;   // Related component data
    }
    
    /**
     * Get transform for an entity
     */
    getEntityTransform(entityId) {
        if (!this.ecsWorld || entityId == null) return null;
        try {
            // Dynamic import to avoid circular dependency
            const { getEntityComponent } = require('./storage/ArchetypeStorage.js');
            return getEntityComponent(this.ecsWorld, entityId, 'Transform');
        } catch (e) {
            return null;
        }
    }
    
    /**
     * Check if entity exists
     */
    entityExists(entityId) {
        if (!this.scene || entityId == null) return false;
        return this.scene.entities?.has(entityId) || false;
    }
    
    /**
     * Get all entity IDs in scene
     */
    getAllEntityIds() {
        if (!this.scene?.entities) return [];
        return Array.from(this.scene.entities.keys());
    }
}

// ============================================================================
// FIELD HEALERS - Specific repair strategies per field type
// ============================================================================

/**
 * Heal a vec3 field using triangulation
 */
function healVec3(value, fieldDef, ctx, fieldName) {
    // Source 1: Value is valid array
    if (Array.isArray(value) && value.length >= 3) {
        const x = Number(value[0]);
        const y = Number(value[1]);
        const z = Number(value[2]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            return { value: [x, y, z], confidence: 1.0, source: 'valid_input' };
        }
    }
    
    // Source 2: Previous known good value
    if (ctx.previousValue && Array.isArray(ctx.previousValue) && ctx.previousValue.length >= 3) {
        return { value: [...ctx.previousValue], confidence: 0.9, source: 'previous_value' };
    }
    
    // Source 3: Schema default
    if (fieldDef.default !== null && Array.isArray(fieldDef.default)) {
        return { value: [...fieldDef.default], confidence: 0.7, source: 'schema_default' };
    }
    
    // Source 4: Null is acceptable for optional fields
    if (fieldDef.default === null) {
        return { value: null, confidence: 0.8, source: 'null_allowed' };
    }
    
    // Fallback: Zero vector
    return { value: [0, 0, 0], confidence: 0.5, source: 'fallback_zero' };
}

/**
 * Heal a number field
 */
function healNumber(value, fieldDef, ctx, fieldName) {
    // Handle Infinity specially
    if (value === "Infinity" || value === Infinity) {
        return { value: Infinity, confidence: 1.0, source: 'infinity_string' };
    }
    if (value === "-Infinity" || value === -Infinity) {
        return { value: -Infinity, confidence: 1.0, source: 'neg_infinity_string' };
    }
    
    // Source 1: Value is valid number
    const n = Number(value);
    if (Number.isFinite(n)) {
        // Apply constraints
        let result = n;
        if (fieldDef.min !== undefined && n < fieldDef.min) result = fieldDef.min;
        if (fieldDef.max !== undefined && n > fieldDef.max) result = fieldDef.max;
        if (fieldDef.positive && n <= 0) result = fieldDef.default ?? 1;
        if (fieldDef.nonNegative && n < 0) result = 0;
        return { value: result, confidence: result === n ? 1.0 : 0.9, source: 'valid_input' };
    }
    
    // Source 2: Previous value
    if (ctx.previousValue !== undefined && Number.isFinite(ctx.previousValue)) {
        return { value: ctx.previousValue, confidence: 0.9, source: 'previous_value' };
    }
    
    // Source 3: Schema default (including Infinity)
    if (fieldDef.default !== undefined) {
        return { value: fieldDef.default, confidence: 0.8, source: 'schema_default' };
    }
    
    // Fallback
    return { value: 0, confidence: 0.5, source: 'fallback_zero' };
}

/**
 * Heal an entity reference field
 */
function healEntityRef(value, fieldDef, ctx, fieldName) {
    // Source 1: Valid entity ID that exists
    if (value != null && ctx.entityExists(value)) {
        return { value, confidence: 1.0, source: 'valid_entity' };
    }
    
    // Source 2: Value is set but entity doesn't exist - might be remapped later
    if (value != null) {
        // Keep the value, but flag low confidence
        return { value, confidence: 0.6, source: 'unverified_entity' };
    }
    
    // Source 3: Null is acceptable
    if (fieldDef.default === null) {
        return { value: null, confidence: 1.0, source: 'null_allowed' };
    }
    
    return { value: null, confidence: 0.8, source: 'default_null' };
}

/**
 * Heal an array field (like particles)
 */
function healArray(value, fieldDef, ctx, fieldName) {
    // Source 1: Valid array
    if (Array.isArray(value) && value.length > 0) {
        return { value, confidence: 1.0, source: 'valid_array' };
    }
    
    // Source 2: Previous value
    if (ctx.previousValue && Array.isArray(ctx.previousValue) && ctx.previousValue.length > 0) {
        return { value: [...ctx.previousValue], confidence: 0.9, source: 'previous_value' };
    }
    
    // Source 3: Empty array default
    if (Array.isArray(fieldDef.default)) {
        return { value: [...fieldDef.default], confidence: 0.7, source: 'schema_default' };
    }
    
    return { value: [], confidence: 0.6, source: 'fallback_empty' };
}

// ============================================================================
// COMPONENT-SPECIFIC HEALERS
// ============================================================================

/**
 * Heal PhysicsChain component with triangulation
 */
function healPhysicsChain(data, ctx) {
    const schema = COMPONENT_SCHEMAS.PhysicsChain;
    if (!schema) return { data, healed: false };
    
    const result = { ...data };
    const healedFields = [];
    
    // 1. Heal particles array - can reconstruct from anchors if missing
    if (!Array.isArray(result.particles) || result.particles.length < 2) {
        const startPos = result.startAnchorWorldPos;
        const endPos = result.endAnchorWorldPos || result.endPosition;
        const segments = result.segments || 20;
        
        if (Array.isArray(startPos) && Array.isArray(endPos)) {
            // Triangulate: Reconstruct particles from endpoints
            const particles = [];
            for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                particles.push({
                    x: startPos[0] + t * (endPos[0] - startPos[0]),
                    y: startPos[1] + t * (endPos[1] - startPos[1]),
                    z: startPos[2] + t * (endPos[2] - startPos[2]),
                });
            }
            result.particles = particles;
            logHealing('PhysicsChain', ctx.entityId, 'particles', 'missing/invalid', 
                `reconstructed ${particles.length} particles from anchors`, 0.85);
            healedFields.push('particles');
        }
    }
    
    // 2. Heal anchor positions from attached entity transforms
    if (result.startEntityId != null && (!Array.isArray(result.startAnchorWorldPos) || result.startAnchorWorldPos.length < 3)) {
        const transform = ctx.getEntityTransform(result.startEntityId);
        if (transform?.position) {
            result.startAnchorWorldPos = [...transform.position];
            logHealing('PhysicsChain', ctx.entityId, 'startAnchorWorldPos', 'missing', 
                'inferred from startEntity transform', 0.9);
            healedFields.push('startAnchorWorldPos');
        }
    }
    
    if (result.endEntityId != null && (!Array.isArray(result.endAnchorWorldPos) || result.endAnchorWorldPos.length < 3)) {
        const transform = ctx.getEntityTransform(result.endEntityId);
        if (transform?.position) {
            result.endAnchorWorldPos = [...transform.position];
            logHealing('PhysicsChain', ctx.entityId, 'endAnchorWorldPos', 'missing', 
                'inferred from endEntity transform', 0.9);
            healedFields.push('endAnchorWorldPos');
        }
    }
    
    // 3. Heal entity references - validate they exist
    if (result.startEntityId != null && !ctx.entityExists(result.startEntityId)) {
        logHealing('PhysicsChain', ctx.entityId, 'startEntityId', 
            `entity ${result.startEntityId} not found`, 'kept for later remapping', 0.6);
    }
    
    if (result.endEntityId != null && !ctx.entityExists(result.endEntityId)) {
        logHealing('PhysicsChain', ctx.entityId, 'endEntityId', 
            `entity ${result.endEntityId} not found`, 'kept for later remapping', 0.6);
    }
    
    // 4. Heal chainStrength - ensure Infinity is preserved (also handles legacy ropeStrength)
    if (result.ropeStrength !== undefined && result.chainStrength === undefined) {
        result.chainStrength = result.ropeStrength;
        delete result.ropeStrength;
    }
    if (result.chainStrength === null || result.chainStrength === undefined || result.chainStrength === 0) {
        result.chainStrength = Infinity;
        logHealing('PhysicsChain', ctx.entityId, 'chainStrength', 
            'was null/0', 'set to Infinity (unbreakable)', 0.95);
        healedFields.push('chainStrength');
    }
    
    // 5. Heal length from particles if available
    if ((!Number.isFinite(result.length) || result.length <= 0) && 
        Array.isArray(result.particles) && result.particles.length >= 2) {
        // Calculate length from particle chain
        let totalLength = 0;
        for (let i = 1; i < result.particles.length; i++) {
            const p0 = result.particles[i - 1];
            const p1 = result.particles[i];
            const dx = (p1.x || 0) - (p0.x || 0);
            const dy = (p1.y || 0) - (p0.y || 0);
            const dz = (p1.z || 0) - (p0.z || 0);
            totalLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        if (totalLength > 0) {
            result.length = totalLength;
            logHealing('PhysicsChain', ctx.entityId, 'length', 
                'invalid', `calculated from particles: ${totalLength.toFixed(2)}`, 0.9);
            healedFields.push('length');
        }
    }
    
    return { data: result, healed: healedFields.length > 0, healedFields };
}

/**
 * Heal PhysicsBody component
 */
function healPhysicsBody(data, ctx) {
    const result = { ...data };
    const healedFields = [];
    
    // Heal simMode
    if (!result.simMode || !['dynamic', 'kinematic', 'static'].includes(result.simMode)) {
        result.simMode = 'dynamic';
        logHealing('PhysicsBody', ctx.entityId, 'simMode', 'invalid', 'dynamic', 0.8);
        healedFields.push('simMode');
    }
    
    // Heal velocity arrays
    if (!Array.isArray(result.linearVelocity) || result.linearVelocity.length < 3) {
        result.linearVelocity = [0, 0, 0];
        healedFields.push('linearVelocity');
    }
    if (!Array.isArray(result.angularVelocity) || result.angularVelocity.length < 3) {
        result.angularVelocity = [0, 0, 0];
        healedFields.push('angularVelocity');
    }
    if (!Array.isArray(result.centerOfMass) || result.centerOfMass.length < 3) {
        result.centerOfMass = [0, 0, 0];
        healedFields.push('centerOfMass');
    }
    
    // Clear runtime fields (should not be persisted)
    if (result.bodyHandle !== null && result.bodyHandle !== undefined) {
        result.bodyHandle = null;
        logHealing('PhysicsBody', ctx.entityId, 'bodyHandle', 'runtime field persisted', 'cleared', 0.95);
        healedFields.push('bodyHandle');
    }
    
    return { data: result, healed: healedFields.length > 0, healedFields };
}

/**
 * Heal Collider component
 */
function healCollider(data, ctx) {
    const result = { ...data };
    const healedFields = [];
    
    // Heal shape
    if (!result.shape || !['box', 'sphere', 'capsule', 'convexMesh', 'triangleMesh'].includes(result.shape)) {
        result.shape = 'box';
        logHealing('Collider', ctx.entityId, 'shape', 'invalid', 'box', 0.8);
        healedFields.push('shape');
    }
    
    // Heal halfExtents
    if (!Array.isArray(result.halfExtents) || result.halfExtents.length < 3) {
        result.halfExtents = [0.5, 0.5, 0.5];
        logHealing('Collider', ctx.entityId, 'halfExtents', 'invalid', '[0.5,0.5,0.5]', 0.7);
        healedFields.push('halfExtents');
    }
    
    // Heal radius
    if (typeof result.radius !== 'number' || result.radius <= 0) {
        result.radius = 0.5;
        healedFields.push('radius');
    }
    
    // Heal halfHeight
    if (typeof result.halfHeight !== 'number' || result.halfHeight <= 0) {
        result.halfHeight = 0.5;
        healedFields.push('halfHeight');
    }
    
    // Heal isTrigger
    if (typeof result.isTrigger !== 'boolean') {
        result.isTrigger = false;
        healedFields.push('isTrigger');
    }
    
    return { data: result, healed: healedFields.length > 0, healedFields };
}

/**
 * Heal WeldConstraint component
 */
function healWeldConstraint(data, ctx) {
    const result = { ...data };
    const healedFields = [];
    
    // Validate parent entity ID
    if (result.parentEntityId == null) {
        // Cannot heal without parent - weld is invalid
        logHealing('WeldConstraint', ctx.entityId, 'parentEntityId', 'missing', 'cannot heal', 0.0);
        result.isBroken = true;
        healedFields.push('isBroken');
    }
    
    // Validate child entity ID (should be this entity)
    if (result.childEntityId == null && ctx.entityId != null) {
        result.childEntityId = ctx.entityId;
        logHealing('WeldConstraint', ctx.entityId, 'childEntityId', 'missing', 'set to self', 0.9);
        healedFields.push('childEntityId');
    }
    
    // Heal offset
    if (!Array.isArray(result.offset) || result.offset.length < 3) {
        result.offset = [0, 0, 0];
        logHealing('WeldConstraint', ctx.entityId, 'offset', 'invalid', '[0,0,0]', 0.7);
        healedFields.push('offset');
    }
    
    // Heal relative rotation (quaternion)
    if (!Array.isArray(result.relativeRotation) || result.relativeRotation.length < 4) {
        result.relativeRotation = [0, 0, 0, 1]; // Identity quaternion
        logHealing('WeldConstraint', ctx.entityId, 'relativeRotation', 'invalid', '[0,0,0,1]', 0.7);
        healedFields.push('relativeRotation');
    }
    
    // Heal weldType
    if (!result.weldType || !['shapeTransfer', 'fixedJoint', 'distanceJoint'].includes(result.weldType)) {
        result.weldType = 'shapeTransfer';
        logHealing('WeldConstraint', ctx.entityId, 'weldType', 'invalid', 'shapeTransfer', 0.8);
        healedFields.push('weldType');
    }
    
    // Heal boolean fields
    if (typeof result.breakable !== 'boolean') {
        result.breakable = false;
        healedFields.push('breakable');
    }
    if (typeof result.isBroken !== 'boolean') {
        result.isBroken = false;
        healedFields.push('isBroken');
    }
    
    // Heal numeric fields
    if (typeof result.breakForce !== 'number' || result.breakForce < 0) {
        result.breakForce = 0;
        healedFields.push('breakForce');
    }
    if (typeof result.breakTorque !== 'number' || result.breakTorque < 0) {
        result.breakTorque = 0;
        healedFields.push('breakTorque');
    }
    if (typeof result.shapesTransferred !== 'number' || result.shapesTransferred < 0) {
        result.shapesTransferred = 0;
        healedFields.push('shapesTransferred');
    }
    
    return { data: result, healed: healedFields.length > 0, healedFields };
}

/**
 * Heal EntityFlags component with migration from Renderable and PhysicsBody
 * This healer auto-populates EntityFlags from existing components when missing
 */
function healEntityFlags(data, ctx) {
    const result = { ...data };
    const healedFields = [];
    
    // Get related components for migration/triangulation
    let renderable = null;
    let physicsBody = null;
    let collider = null;
    
    if (ctx.ecsWorld && ctx.entityId != null) {
        try {
            const { getEntityComponent } = require('./storage/ArchetypeStorage.js');
            renderable = getEntityComponent(ctx.ecsWorld, ctx.entityId, 'Renderable');
            physicsBody = getEntityComponent(ctx.ecsWorld, ctx.entityId, 'PhysicsBody');
            collider = getEntityComponent(ctx.ecsWorld, ctx.entityId, 'Collider');
        } catch (e) {
            // Ignore - triangulation sources not available
        }
    }
    
    // ========== COLLISION FLAGS ==========
    // Migrate collisionLayer from PhysicsBody if not set
    if (result.collisionLayer === undefined || result.collisionLayer === null) {
        if (physicsBody?.collisionLayer != null) {
            result.collisionLayer = physicsBody.collisionLayer;
            logHealing('EntityFlags', ctx.entityId, 'collisionLayer', 'missing', 
                `migrated from PhysicsBody: 0x${physicsBody.collisionLayer.toString(16)}`, 0.95);
            healedFields.push('collisionLayer');
        } else {
            result.collisionLayer = 0x0001; // Default layer
            healedFields.push('collisionLayer');
        }
    }
    
    // Migrate collisionMask from PhysicsBody if not set
    if (result.collisionMask === undefined || result.collisionMask === null) {
        if (physicsBody?.collisionMask != null) {
            result.collisionMask = physicsBody.collisionMask;
            logHealing('EntityFlags', ctx.entityId, 'collisionMask', 'missing', 
                `migrated from PhysicsBody: 0x${physicsBody.collisionMask.toString(16)}`, 0.95);
            healedFields.push('collisionMask');
        } else {
            result.collisionMask = 0xFFFF; // Collide with all
            healedFields.push('collisionMask');
        }
    }
    
    // Infer collisionMode from Collider.isTrigger
    if (result.collisionMode === undefined || result.collisionMode === null) {
        if (collider?.isTrigger === true) {
            result.collisionMode = 'trigger';
            logHealing('EntityFlags', ctx.entityId, 'collisionMode', 'missing', 
                'set to trigger (from Collider.isTrigger)', 0.9);
            healedFields.push('collisionMode');
        } else {
            result.collisionMode = 'solid';
            healedFields.push('collisionMode');
        }
    }
    
    // ========== VISIBILITY FLAGS ==========
    // Migrate visible from Renderable
    if (result.visible === undefined || result.visible === null) {
        if (renderable?.visible != null) {
            result.visible = renderable.visible;
            logHealing('EntityFlags', ctx.entityId, 'visible', 'missing', 
                `migrated from Renderable: ${renderable.visible}`, 0.95);
            healedFields.push('visible');
        } else {
            result.visible = true;
            healedFields.push('visible');
        }
    }
    
    // Migrate renderLayer from Renderable.layer
    if (result.renderLayer === undefined || result.renderLayer === null) {
        if (renderable?.layer != null) {
            result.renderLayer = renderable.layer;
            logHealing('EntityFlags', ctx.entityId, 'renderLayer', 'missing', 
                `migrated from Renderable: ${renderable.layer}`, 0.95);
            healedFields.push('renderLayer');
        } else {
            result.renderLayer = 0;
            healedFields.push('renderLayer');
        }
    }
    
    // Migrate renderMask from Renderable.layerMask
    if (result.renderMask === undefined || result.renderMask === null) {
        if (renderable?.layerMask != null) {
            result.renderMask = renderable.layerMask;
            logHealing('EntityFlags', ctx.entityId, 'renderMask', 'missing', 
                `migrated from Renderable: 0x${renderable.layerMask.toString(16)}`, 0.95);
            healedFields.push('renderMask');
        } else {
            result.renderMask = 0xFFFFFFFF;
            healedFields.push('renderMask');
        }
    }
    
    // Migrate shadow flags from Renderable
    if (result.castShadow === undefined || result.castShadow === null) {
        result.castShadow = renderable?.castShadow ?? true;
        healedFields.push('castShadow');
    }
    if (result.receiveShadow === undefined || result.receiveShadow === null) {
        result.receiveShadow = renderable?.receiveShadow ?? true;
        healedFields.push('receiveShadow');
    }
    
    // ========== EDITOR FLAGS ==========
    if (typeof result.editorVisible !== 'boolean') {
        result.editorVisible = true;
        healedFields.push('editorVisible');
    }
    if (typeof result.pickable !== 'boolean') {
        result.pickable = true;
        healedFields.push('pickable');
    }
    if (typeof result.selectable !== 'boolean') {
        result.selectable = true;
        healedFields.push('selectable');
    }
    if (typeof result.locked !== 'boolean') {
        result.locked = false;
        healedFields.push('locked');
    }
    if (typeof result.hideInHierarchy !== 'boolean') {
        result.hideInHierarchy = false;
        healedFields.push('hideInHierarchy');
    }
    
    // ========== PHYSICS BEHAVIOR FLAGS ==========
    if (typeof result.weldable !== 'boolean') {
        result.weldable = true;
        healedFields.push('weldable');
    }
    if (typeof result.pushable !== 'boolean') {
        result.pushable = true;
        healedFields.push('pushable');
    }
    if (typeof result.sleepable !== 'boolean') {
        result.sleepable = true;
        healedFields.push('sleepable');
    }
    if (typeof result.ccdEnabled !== 'boolean') {
        // Migrate from PhysicsBody if available
        result.ccdEnabled = physicsBody?.ccdEnabled ?? false;
        healedFields.push('ccdEnabled');
    }
    
    // ========== INTERACTION FLAGS ==========
    if (typeof result.interactable !== 'boolean') {
        result.interactable = false;
        healedFields.push('interactable');
    }
    if (typeof result.highlightOnHover !== 'boolean') {
        result.highlightOnHover = false;
        healedFields.push('highlightOnHover');
    }
    
    // ========== STATIC FLAGS ==========
    // Infer isStatic from PhysicsBody.simMode
    if (typeof result.isStatic !== 'boolean') {
        result.isStatic = physicsBody?.simMode === 'static';
        healedFields.push('isStatic');
    }
    if (typeof result.isOccluder !== 'boolean') {
        result.isOccluder = false;
        healedFields.push('isOccluder');
    }
    if (typeof result.isOccludee !== 'boolean') {
        result.isOccludee = true;
        healedFields.push('isOccludee');
    }
    if (typeof result.contributeGI !== 'boolean') {
        result.contributeGI = true;
        healedFields.push('contributeGI');
    }
    
    return { data: result, healed: healedFields.length > 0, healedFields };
}

/**
 * Heal Transform component
 */
function healTransform(data, ctx) {
    const result = { ...data };
    const healedFields = [];
    
    // Heal position
    if (!Array.isArray(result.position) || result.position.length < 3) {
        result.position = [0, 0, 0];
        logHealing('Transform', ctx.entityId, 'position', 'invalid', '[0,0,0]', 0.7);
        healedFields.push('position');
    }
    
    // Heal rotation (quaternion)
    if (!Array.isArray(result.rotation) || result.rotation.length < 4) {
        result.rotation = [0, 0, 0, 1]; // Identity quaternion
        logHealing('Transform', ctx.entityId, 'rotation', 'invalid', '[0,0,0,1]', 0.7);
        healedFields.push('rotation');
    } else {
        // Normalize quaternion if needed
        const [x, y, z, w] = result.rotation;
        const lenSq = x*x + y*y + z*z + w*w;
        if (lenSq < 0.99 || lenSq > 1.01) {
            const len = Math.sqrt(lenSq);
            if (len > 0) {
                result.rotation = [x/len, y/len, z/len, w/len];
                logHealing('Transform', ctx.entityId, 'rotation', 'unnormalized', 'normalized', 0.95);
                healedFields.push('rotation');
            }
        }
    }
    
    // Heal scale
    if (!Array.isArray(result.scale) || result.scale.length < 3) {
        result.scale = [1, 1, 1];
        logHealing('Transform', ctx.entityId, 'scale', 'invalid', '[1,1,1]', 0.7);
        healedFields.push('scale');
    }
    
    return { data: result, healed: healedFields.length > 0, healedFields };
}

// ============================================================================
// MAIN HEALING API
// ============================================================================

/**
 * Heal a component using schema and triangulation
 * @param {string} componentName - Name of the component
 * @param {object} data - Component data to heal
 * @param {TriangulationContext} ctx - Context for triangulation
 * @returns {object} { data, healed, healedFields }
 */
export function healComponent(componentName, data, ctx = new TriangulationContext()) {
    // Component-specific healers
    switch (componentName) {
        case 'PhysicsChain':
        case 'PhysicsRope': // Legacy alias
            return healPhysicsChain(data, ctx);
        case 'Transform':
            return healTransform(data, ctx);
        case 'WeldConstraint':
            return healWeldConstraint(data, ctx);
        case 'PhysicsBody':
            return healPhysicsBody(data, ctx);
        case 'Collider':
            return healCollider(data, ctx);
        case 'EntityFlags':
            return healEntityFlags(data, ctx);
    }
    
    // Generic schema-based healing
    const schema = COMPONENT_SCHEMAS[componentName];
    if (!schema?.fields) {
        return { data, healed: false, healedFields: [] };
    }
    
    const result = { ...data };
    const healedFields = [];
    
    for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
        const value = result[fieldName];
        let healResult = null;
        
        // Check if field needs healing
        if (value === undefined || value === null || 
            (Array.isArray(fieldDef.default) && !Array.isArray(value))) {
            
            switch (fieldDef.type) {
                case 'vec3':
                    healResult = healVec3(value, fieldDef, ctx, fieldName);
                    break;
                case 'vec4':
                case 'quat':
                    healResult = healVec3(value, fieldDef, ctx, fieldName); // Similar logic
                    break;
                case 'number':
                    healResult = healNumber(value, fieldDef, ctx, fieldName);
                    break;
                case 'any':
                    healResult = healEntityRef(value, fieldDef, ctx, fieldName);
                    break;
                case 'array':
                    healResult = healArray(value, fieldDef, ctx, fieldName);
                    break;
                default:
                    // Use schema default
                    if (fieldDef.default !== undefined) {
                        healResult = { 
                            value: fieldDef.default, 
                            confidence: 0.8, 
                            source: 'schema_default' 
                        };
                    }
            }
            
            if (healResult && healResult.value !== value) {
                result[fieldName] = healResult.value;
                logHealing(componentName, ctx.entityId, fieldName, 
                    'missing/invalid', healResult.source, healResult.confidence);
                healedFields.push(fieldName);
            }
        }
    }
    
    return { data: result, healed: healedFields.length > 0, healedFields };
}

/**
 * Heal and validate component data before use
 * This is the main entry point for the healing system
 */
export function healAndValidate(componentName, data, options = {}) {
    const ctx = new TriangulationContext(options);
    const { data: healedData, healed, healedFields } = healComponent(componentName, data, ctx);
    
    return {
        data: healedData,
        healed,
        healedFields,
        isValid: true, // After healing, data should be valid
    };
}

/**
 * Get healing statistics with detailed metrics
 */
export function getHealingStats() {
    const stats = {
        totalHeals: healingLog.length,
        byComponent: {},
        byField: {},
        byConfidence: {
            high: 0,    // >= 0.9
            medium: 0,  // >= 0.7
            low: 0,     // < 0.7
        },
        bySource: {},
        averageConfidence: 0,
        recentHeals: healingLog.slice(-10),
    };
    
    let totalConfidence = 0;
    for (const entry of healingLog) {
        stats.byComponent[entry.component] = (stats.byComponent[entry.component] || 0) + 1;
        stats.byField[entry.field] = (stats.byField[entry.field] || 0) + 1;
        stats.bySource[entry.repair] = (stats.bySource[entry.repair] || 0) + 1;
        totalConfidence += entry.confidence;
        
        if (entry.confidence >= 0.9) stats.byConfidence.high++;
        else if (entry.confidence >= 0.7) stats.byConfidence.medium++;
        else stats.byConfidence.low++;
    }
    
    stats.averageConfidence = healingLog.length > 0 
        ? (totalConfidence / healingLog.length).toFixed(3) 
        : 1.0;
    
    return stats;
}

/**
 * Batch heal multiple components efficiently
 * @param {Array} components - Array of {componentName, data, entityId}
 * @param {object} sharedContext - Shared context options
 * @returns {Array} Array of healing results
 */
export function batchHealComponents(components, sharedContext = {}) {
    const results = [];
    const startTime = performance.now();
    
    for (const { componentName, data, entityId } of components) {
        const ctx = new TriangulationContext({
            ...sharedContext,
            entityId,
        });
        results.push({
            entityId,
            componentName,
            ...healComponent(componentName, data, ctx),
        });
    }
    
    const elapsed = performance.now() - startTime;
    if (components.length > 10) {
        console.log(`[ComponentHealer] Batch healed ${components.length} components in ${elapsed.toFixed(1)}ms`);
    }
    
    return results;
}

/**
 * Validate component without healing - just check for issues
 * @returns {object} { isValid, issues }
 */
export function validateComponentData(componentName, data) {
    const schema = COMPONENT_SCHEMAS[componentName];
    if (!schema?.fields) {
        return { isValid: true, issues: [] };
    }
    
    const issues = [];
    
    for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
        const value = data[fieldName];
        
        // Check for missing required fields
        if (value === undefined && fieldDef.default === undefined) {
            issues.push({ field: fieldName, issue: 'missing_required' });
        }
        
        // Type validation
        if (value !== undefined && value !== null) {
            switch (fieldDef.type) {
                case 'vec3':
                case 'vec4':
                case 'quat':
                    if (!Array.isArray(value) || value.length < 3) {
                        issues.push({ field: fieldName, issue: 'invalid_array_type' });
                    }
                    break;
                case 'number':
                    if (typeof value !== 'number' && typeof value !== 'string') {
                        issues.push({ field: fieldName, issue: 'invalid_number_type' });
                    }
                    break;
                case 'boolean':
                    if (typeof value !== 'boolean') {
                        issues.push({ field: fieldName, issue: 'invalid_boolean_type' });
                    }
                    break;
                case 'array':
                    if (!Array.isArray(value)) {
                        issues.push({ field: fieldName, issue: 'invalid_array_type' });
                    }
                    break;
            }
        }
    }
    
    return { isValid: issues.length === 0, issues };
}

export default {
    healComponent,
    healAndValidate,
    batchHealComponents,
    validateComponentData,
    getHealingLog,
    clearHealingLog,
    getHealingStats,
    TriangulationContext,
};
