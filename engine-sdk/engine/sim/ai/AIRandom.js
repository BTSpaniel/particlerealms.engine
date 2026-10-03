// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
    deterministicRngEntitySeed32,
    deterministicRngEntitySeed32V1,
    deterministicRngInteractionSeed32,
    deterministicRngInteractionSeed32V1,
    legacyDeterministicRngPositionSeed32,
    legacyDeterministicRngTickSeed32,
    legacyPcgAdvanceState32,
    legacyPcgHash32,
    legacyPcgOutput32,
} from '../../core/math/MathBits.js';

/**
 * AIRandom.js - Deterministic RNG Context for AI Systems
 * 
 * ⚠️ MULTIPLAYER CRITICAL: All AI random must go through this module.
 * This ensures all clients produce identical AI behavior given the same seed.
 * 
 * Usage:
 *   import { aiRng, setAIRngContext } from './AIRandom.js';
 *   
 *   // At start of each tick (server sends worldSeed + tick)
 *   setAIRngContext(worldSeed, currentTick);
 *   
 *   // In AI code - use aiRng helpers
 *   const damage = aiRng.intRange(10, 20);
 *   const shouldFlee = aiRng.chance(0.3);
 *   const target = aiRng.pick(enemies);
 */

// ============================================================================
// PCG HASH - Core deterministic random
// ============================================================================

function pcgHash(v) {
    return legacyPcgHash32(v);
}

// ============================================================================
// RNG STATE
// ============================================================================

let _worldSeed = 12345;
let _currentTick = 0;
let _state = pcgHash(_worldSeed);

/**
 * Set the global AI RNG context. Call this at the start of each game tick.
 * @param {number} worldSeed - World seed (shared by server)
 * @param {number} tick - Current game tick
 */
export function setAIRngContext(worldSeed, tick) {
    _worldSeed = worldSeed >>> 0;
    _currentTick = tick >>> 0;
    _state = legacyDeterministicRngTickSeed32(_worldSeed, _currentTick);
}

/**
 * Get RNG state for a specific entity (deterministic per entity+tick)
 * @param {number} entityId - Entity ID
 * @returns {number} RNG state for this entity
 */
export function getEntityRngState(entityId) {
    return deterministicRngEntitySeed32(_worldSeed, entityId, _currentTick);
}

/**
 * Get the replay-compatible v1 state that uses only the low u32 entity word.
 * @param {number} entityId - Legacy entity ID
 * @returns {number} Historical RNG state for this entity
 */
export function getEntityRngStateV1(entityId) {
    return deterministicRngEntitySeed32V1(_worldSeed, entityId, _currentTick);
}

/**
 * Get RNG state for a position (terrain, spawns, etc.)
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} z - Z coordinate
 * @returns {number} RNG state for this position
 */
export function getPositionRngState(x, y, z) {
    return legacyDeterministicRngPositionSeed32(_worldSeed, Math.floor(x), Math.floor(y), Math.floor(z));
}

/**
 * Get RNG state for interaction between two entities
 * @param {number} entityA - First entity
 * @param {number} entityB - Second entity
 * @returns {number} RNG state (order-independent)
 */
export function getInteractionRngState(entityA, entityB) {
    return deterministicRngInteractionSeed32(_worldSeed, entityA, entityB, _currentTick);
}

/**
 * Get the replay-compatible v1 interaction state for low-u32 identities.
 * @param {number} entityA - First legacy entity ID
 * @param {number} entityB - Second legacy entity ID
 * @returns {number} Historical order-independent interaction state
 */
export function getInteractionRngStateV1(entityA, entityB) {
    return deterministicRngInteractionSeed32V1(_worldSeed, entityA, entityB, _currentTick);
}

// ============================================================================
// CORE RNG FUNCTIONS
// ============================================================================

function nextState() {
    _state = legacyPcgAdvanceState32(_state);
    return legacyPcgOutput32(_state);
}

// ============================================================================
// AI RNG API - Use these in all AI code
// ============================================================================

export const aiRng = {
    /**
     * Random float in [0, 1)
     * @returns {number}
     */
    float() {
        return nextState() / 4294967295;
    },
    
    /**
     * Random float in [min, max)
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    range(min, max) {
        return min + this.float() * (max - min);
    },
    
    /**
     * Random integer in [0, max)
     * @param {number} max - Exclusive maximum
     * @returns {number}
     */
    int(max) {
        return Math.floor(this.float() * max);
    },
    
    /**
     * Random integer in [min, max] (inclusive)
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    intRange(min, max) {
        return min + Math.floor(this.float() * (max - min + 1));
    },
    
    /**
     * Random boolean with probability
     * @param {number} probability - Chance of true (0-1)
     * @returns {boolean}
     */
    chance(probability) {
        return this.float() < probability;
    },
    
    /**
     * Pick random element from array
     * @param {Array} array
     * @returns {*}
     */
    pick(array) {
        if (!array || array.length === 0) return undefined;
        return array[this.int(array.length)];
    },
    
    /**
     * Pick random index from array
     * @param {Array} array
     * @returns {number}
     */
    pickIndex(array) {
        if (!array || array.length === 0) return -1;
        return this.int(array.length);
    },
    
    /**
     * Shuffle array in place (Fisher-Yates)
     * @param {Array} array
     * @returns {Array}
     */
    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = this.int(i + 1);
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    },
    
    /**
     * Weighted random selection
     * @param {Array} items
     * @param {Array} weights
     * @returns {*}
     */
    weighted(items, weights) {
        let total = 0;
        for (const w of weights) total += w;
        
        let r = this.float() * total;
        for (let i = 0; i < items.length; i++) {
            r -= weights[i];
            if (r <= 0) return items[i];
        }
        return items[items.length - 1];
    },
    
    /**
     * Weighted random from object {item: weight}
     * @param {Object} weightedItems
     * @returns {string} Selected key
     */
    weightedKey(weightedItems) {
        const keys = Object.keys(weightedItems);
        const weights = keys.map(k => weightedItems[k]);
        return this.weighted(keys, weights);
    },
    
    /**
     * Roll from a loot-table style array [{item, weight}, ...]
     * @param {Array} entries - Array of {item, weight} or {value, weight}
     * @returns {*} Selected item/value
     */
    rollTable(entries) {
        if (!entries || entries.length === 0) return undefined;
        
        let total = 0;
        for (const e of entries) total += (e.weight || 1);
        
        let r = this.float() * total;
        for (const entry of entries) {
            r -= (entry.weight || 1);
            if (r <= 0) return entry.item ?? entry.value ?? entry;
        }
        return entries[entries.length - 1].item ?? entries[entries.length - 1].value ?? entries[entries.length - 1];
    },
    
    /**
     * Random value from normal distribution
     * @param {number} mean
     * @param {number} stddev
     * @returns {number}
     */
    gaussian(mean = 0, stddev = 1) {
        const u1 = Math.max(this.float(), 1e-10);
        const u2 = this.float();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        return mean + stddev * z;
    },
    
    /**
     * Random direction on unit sphere
     * @returns {number[]} [x, y, z]
     */
    direction() {
        const x = this.gaussian();
        const y = this.gaussian();
        const z = this.gaussian();
        const len = Math.sqrt(x * x + y * y + z * z);
        return [x / len, y / len, z / len];
    },
    
    /**
     * Random 2D direction
     * @returns {number[]} [x, y]
     */
    direction2D() {
        const angle = this.float() * Math.PI * 2;
        return [Math.cos(angle), Math.sin(angle)];
    },
    
    /**
     * Random point in circle
     * @param {number} radius
     * @returns {number[]} [x, y]
     */
    inCircle(radius = 1) {
        const r = Math.sqrt(this.float()) * radius;
        const angle = this.float() * Math.PI * 2;
        return [r * Math.cos(angle), r * Math.sin(angle)];
    },
    
    /**
     * Random point in sphere
     * @param {number} radius
     * @returns {number[]} [x, y, z]
     */
    inSphere(radius = 1) {
        const r = Math.pow(this.float(), 1/3) * radius;
        const dir = this.direction();
        return [r * dir[0], r * dir[1], r * dir[2]];
    },
    
    /**
     * Generate unique ID (deterministic)
     * @param {string} prefix
     * @returns {string}
     */
    uniqueId(prefix = 'id') {
        const n = nextState();
        return `${prefix}_${_currentTick}_${n.toString(36)}`;
    },
};

// ============================================================================
// ENTITY-SPECIFIC RNG
// ============================================================================

function createEntityRngFromState(entityId, initialState) {
    let state = initialState;

    function next() {
        state = legacyPcgAdvanceState32(state);
        return legacyPcgOutput32(state);
    }
    
    return {
        float: () => next() / 4294967295,
        range: (min, max) => min + (next() / 4294967295) * (max - min),
        int: (max) => Math.floor((next() / 4294967295) * max),
        intRange: (min, max) => min + Math.floor((next() / 4294967295) * (max - min + 1)),
        chance: (p) => (next() / 4294967295) < p,
        pick: (arr) => arr && arr.length ? arr[Math.floor((next() / 4294967295) * arr.length)] : undefined,
        uniqueId: (prefix = 'id') => `${prefix}_${_currentTick}_${entityId}_${next().toString(36)}`,
    };
}

/**
 * Create a current v2 RNG stream for a specific safe entity handle.
 * @param {number} entityId - Positive Number-safe entity handle
 * @returns {Object} RNG with the same API as aiRng
 */
export function createEntityRng(entityId) {
    return createEntityRngFromState(entityId, getEntityRngState(entityId));
}

/**
 * Create an entity stream with the explicit historical v1 seed contract.
 * @param {number} entityId - Legacy entity ID
 * @returns {Object} RNG with the same API as aiRng
 */
export function createEntityRngV1(entityId) {
    return createEntityRngFromState(entityId, getEntityRngStateV1(entityId));
}

/**
 * Create RNG stream for a world position
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {Object} RNG with same API as aiRng
 */
export function createPositionRng(x, y, z) {
    let state = getPositionRngState(x, y, z);
    
    function next() {
        state = legacyPcgAdvanceState32(state);
        return legacyPcgOutput32(state);
    }
    
    return {
        float: () => next() / 4294967295,
        range: (min, max) => min + (next() / 4294967295) * (max - min),
        int: (max) => Math.floor((next() / 4294967295) * max),
        intRange: (min, max) => min + Math.floor((next() / 4294967295) * (max - min + 1)),
        chance: (p) => (next() / 4294967295) < p,
        pick: (arr) => arr && arr.length ? arr[Math.floor((next() / 4294967295) * arr.length)] : undefined,
    };
}

// ============================================================================
// EXPORTS
// ============================================================================

export { pcgHash };
