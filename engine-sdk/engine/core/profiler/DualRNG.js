// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { legacyDualRngPositionHash3D } from '../math/MathBits.js';
import { mulberry32, splitmix32 } from '../math/MathRandom.js';

/**
 * DualRNG.js - Dual Random Number Generator System
 * 
 * Based on multiplayer sync best practices from Stack Exchange:
 * https://gamedev.stackexchange.com/questions/33152/
 * 
 * Key insight: "If you need random numbers outside of the sync-relevant 
 * calculations you need two RNGs, one which is synchronized, and one which is not.
 * This is because with every number you generate the seed changes, so for some 
 * results it must be called in the same order and with the same frequency."
 * 
 * Usage:
 * - syncRNG: For gameplay (world gen, AI, combat, physics) - MUST be deterministic
 * - visualRNG: For effects (particles, sounds, animations) - can be non-deterministic
 */

/**
 */

/**
 */

/**
 * Position-based hash for deterministic randomness at specific coordinates
 * Useful for terrain generation where you need same result for same position
 */
export function positionHash(x, y, z, seed = 0) {
    return legacyDualRngPositionHash3D(x, y, z, seed);
}

/**
 * DualRNG - Manages synchronized and visual RNGs
 */
export class DualRNG {
    constructor(syncSeed = 42069) {
        this.syncSeed = syncSeed;
        this.visualSeed = Date.now();  // Visual RNG can use current time
        
        // Synchronized RNG - for gameplay, must be deterministic
        this._syncRNG = mulberry32(syncSeed);
        this._syncCallCount = 0;
        
        // Visual RNG - for effects, doesn't need to sync
        this._visualRNG = splitmix32(this.visualSeed);
        this._visualCallCount = 0;
        
        // Logging for debugging sync issues
        this.logSyncCalls = false;
        this.syncCallLog = [];
    }
    
    /**
     * Reset synchronized RNG to initial state
     * Call this when resyncing with server
     */
    resetSync(seed = null) {
        if (seed !== null) {
            this.syncSeed = seed;
        }
        this._syncRNG = mulberry32(this.syncSeed);
        this._syncCallCount = 0;
        this.syncCallLog = [];
        console.log(`[DualRNG] Sync RNG reset with seed: ${this.syncSeed}`);
    }
    
    /**
     * Reset visual RNG (optional, for testing)
     */
    resetVisual(seed = null) {
        this.visualSeed = seed ?? Date.now();
        this._visualRNG = splitmix32(this.visualSeed);
        this._visualCallCount = 0;
    }
    
    // ========================================================================
    // SYNCHRONIZED RNG - Use for gameplay (world gen, AI, combat, loot)
    // ========================================================================
    
    /**
     * Get synchronized random number [0, 1)
     * MUST be called in same order on all clients!
     */
    sync() {
        this._syncCallCount++;
        const value = this._syncRNG();
        
        if (this.logSyncCalls && this.syncCallLog.length < 1000) {
            this.syncCallLog.push({ call: this._syncCallCount, value });
        }
        
        return value;
    }
    
    /**
     * Synchronized random integer in range [min, max] inclusive
     */
    syncInt(min, max) {
        return Math.floor(this.sync() * (max - min + 1)) + min;
    }
    
    /**
     * Synchronized random float in range [min, max)
     */
    syncFloat(min, max) {
        return this.sync() * (max - min) + min;
    }
    
    /**
     * Synchronized random boolean with given probability
     */
    syncBool(probability = 0.5) {
        return this.sync() < probability;
    }
    
    /**
     * Synchronized random item from array
     */
    syncChoice(array) {
        if (!array || array.length === 0) return undefined;
        return array[Math.floor(this.sync() * array.length)];
    }
    
    /**
     * Synchronized shuffle (Fisher-Yates)
     */
    syncShuffle(array) {
        const result = [...array];
        for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(this.sync() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }
    
    // ========================================================================
    // VISUAL RNG - Use for effects (particles, sounds, animations)
    // ========================================================================
    
    /**
     * Get visual random number [0, 1)
     * Does NOT need to sync across clients
     */
    visual() {
        this._visualCallCount++;
        return this._visualRNG();
    }
    
    /**
     * Visual random integer in range [min, max] inclusive
     */
    visualInt(min, max) {
        return Math.floor(this.visual() * (max - min + 1)) + min;
    }
    
    /**
     * Visual random float in range [min, max)
     */
    visualFloat(min, max) {
        return this.visual() * (max - min) + min;
    }
    
    /**
     * Visual random boolean
     */
    visualBool(probability = 0.5) {
        return this.visual() < probability;
    }
    
    /**
     * Visual random item from array
     */
    visualChoice(array) {
        if (!array || array.length === 0) return undefined;
        return array[Math.floor(this.visual() * array.length)];
    }
    
    // ========================================================================
    // POSITION-BASED RNG - For deterministic values at specific coordinates
    // ========================================================================
    
    /**
     * Get deterministic random value for a position
     * Same position always returns same value
     */
    atPosition(x, y, z) {
        return positionHash(x, y, z, this.syncSeed);
    }
    
    /**
     * Get deterministic int at position
     */
    intAtPosition(x, y, z, min, max) {
        return Math.floor(this.atPosition(x, y, z) * (max - min + 1)) + min;
    }
    
    /**
     * Get deterministic float at position
     */
    floatAtPosition(x, y, z, min, max) {
        return this.atPosition(x, y, z) * (max - min) + min;
    }
    
    /**
     * Get deterministic bool at position
     */
    boolAtPosition(x, y, z, probability = 0.5) {
        return this.atPosition(x, y, z) < probability;
    }
    
    // ========================================================================
    // DEBUGGING & SYNC VERIFICATION
    // ========================================================================
    
    /**
     * Get current state for sync verification
     */
    getState() {
        return {
            syncSeed: this.syncSeed,
            syncCallCount: this._syncCallCount,
            visualSeed: this.visualSeed,
            visualCallCount: this._visualCallCount,
        };
    }
    
    /**
     * Verify sync state matches another client
     */
    verifySyncState(otherState) {
        const match = this._syncCallCount === otherState.syncCallCount &&
                      this.syncSeed === otherState.syncSeed;
        
        if (!match) {
            console.warn(`[DualRNG] SYNC MISMATCH!`);
            console.warn(`  Local: seed=${this.syncSeed}, calls=${this._syncCallCount}`);
            console.warn(`  Remote: seed=${otherState.syncSeed}, calls=${otherState.syncCallCount}`);
        }
        
        return match;
    }
    
    /**
     * Enable call logging for debugging sync issues
     */
    enableLogging() {
        this.logSyncCalls = true;
        this.syncCallLog = [];
        console.log('[DualRNG] Sync call logging enabled');
    }
    
    /**
     * Get sync call log for comparison with other clients
     */
    getSyncLog() {
        return this.syncCallLog;
    }
    
    /**
     * Compare sync logs from two clients to find divergence point
     */
    static compareLogs(log1, log2) {
        const minLen = Math.min(log1.length, log2.length);
        
        for (let i = 0; i < minLen; i++) {
            if (log1[i].value !== log2[i].value) {
                console.warn(`[DualRNG] Logs diverge at call ${i + 1}:`);
                console.warn(`  Log1: ${log1[i].value}`);
                console.warn(`  Log2: ${log2[i].value}`);
                return i;
            }
        }
        
        if (log1.length !== log2.length) {
            console.warn(`[DualRNG] Logs have different lengths: ${log1.length} vs ${log2.length}`);
            return minLen;
        }
        
        console.log(`[DualRNG] Logs match perfectly (${minLen} calls)`);
        return -1;  // No divergence
    }
}

// Singleton instance for global use
let globalDualRNG = null;

/**
 * Get or create global DualRNG instance
 */
export function getGlobalRNG() {
    if (!globalDualRNG) {
        globalDualRNG = new DualRNG();
    }
    return globalDualRNG;
}

/**
 * Initialize global RNG with seed (call from game init)
 */
export function initGlobalRNG(seed) {
    globalDualRNG = new DualRNG(seed);
    console.log(`[DualRNG] Global RNG initialized with seed: ${seed}`);
    return globalDualRNG;
}

export default DualRNG;
