// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * MovementPredictor.js - Player Movement Prediction for Chunk Prefetch
 * 
 * Predicts where the player will be in the near future and prioritizes
 * loading chunks in that direction.
 * 
 * Benefits:
 * - Chunks ready before player arrives
 * - Smoother exploration experience
 * - Reduces pop-in when moving fast
 * 
 * Algorithm:
 * - Track velocity over rolling window
 * - Extrapolate position 1-3 seconds ahead
 * - Boost priority for chunks in predicted path
 */

/**
 * MovementPredictor - Predicts player movement for chunk prefetch
 */
export class MovementPredictor {
    constructor() {
        this.enabled = true;
        
        // Position history for velocity calculation
        this.positionHistory = [];
        this.maxHistoryLength = 10;  // ~10 frames of history
        
        // Current state
        this.currentPosition = [0, 0, 0];
        this.velocity = [0, 0, 0];
        this.speed = 0;
        this.direction = [0, 0, 1];
        
        // Prediction settings
        this.predictionTimeSeconds = 2.0;  // How far ahead to predict
        this.minSpeedThreshold = 0.5;      // Min speed to enable prediction
        this.velocitySmoothingFactor = 0.3; // Lower = smoother
        
        // Predicted position
        this.predictedPosition = [0, 0, 0];
        this.predictedChunkX = 0;
        this.predictedChunkZ = 0;
        
        // Priority boost for predicted chunks
        this.predictionBoost = 20;  // Extra priority for chunks in predicted path
        this.predictionRadius = 3;  // Chunks around predicted position to boost
        
        // Stats
        this.stats = {
            avgSpeed: 0,
            predictionAccuracy: 0,
            boostApplied: 0,
        };
        
        // For accuracy tracking
        this.pastPredictions = [];
        this.maxPastPredictions = 30;
    }
    
    /**
     * Update with new player position
     * @param {Array} position - [x, y, z]
     * @param {number} deltaTime - Time since last update in seconds
     */
    update(position, deltaTime) {
        if (!this.enabled || deltaTime <= 0) return;
        
        // Store in history
        this.positionHistory.push({
            position: [...position],
            time: performance.now(),
        });
        
        // Trim history
        while (this.positionHistory.length > this.maxHistoryLength) {
            this.positionHistory.shift();
        }
        
        // Calculate velocity from history
        if (this.positionHistory.length >= 2) {
            const oldest = this.positionHistory[0];
            const newest = this.positionHistory[this.positionHistory.length - 1];
            const dt = (newest.time - oldest.time) / 1000;
            
            if (dt > 0.01) {
                const rawVelocity = [
                    (newest.position[0] - oldest.position[0]) / dt,
                    (newest.position[1] - oldest.position[1]) / dt,
                    (newest.position[2] - oldest.position[2]) / dt,
                ];
                
                // Smooth velocity
                this.velocity[0] += (rawVelocity[0] - this.velocity[0]) * this.velocitySmoothingFactor;
                this.velocity[1] += (rawVelocity[1] - this.velocity[1]) * this.velocitySmoothingFactor;
                this.velocity[2] += (rawVelocity[2] - this.velocity[2]) * this.velocitySmoothingFactor;
            }
        }
        
        // Update current state
        this.currentPosition = [...position];
        this.speed = Math.sqrt(
            this.velocity[0] ** 2 + 
            this.velocity[1] ** 2 + 
            this.velocity[2] ** 2
        );
        
        if (this.speed > 0.01) {
            this.direction = [
                this.velocity[0] / this.speed,
                this.velocity[1] / this.speed,
                this.velocity[2] / this.speed,
            ];
        }
        
        // Calculate predicted position
        this.predictedPosition = [
            position[0] + this.velocity[0] * this.predictionTimeSeconds,
            position[1] + this.velocity[1] * this.predictionTimeSeconds,
            position[2] + this.velocity[2] * this.predictionTimeSeconds,
        ];
        
        // Track stats
        this.stats.avgSpeed = this.stats.avgSpeed * 0.95 + this.speed * 0.05;
        
        // Track prediction accuracy
        this.trackAccuracy(position);
    }
    
    /**
     * Track prediction accuracy over time
     */
    trackAccuracy(actualPosition) {
        // Check past predictions
        const now = performance.now();
        
        // Remove old predictions and calculate accuracy
        let totalError = 0;
        let count = 0;
        
        this.pastPredictions = this.pastPredictions.filter(pred => {
            const age = now - pred.time;
            if (age >= pred.predictionTime * 1000) {
                // Prediction time has passed, check accuracy
                const error = Math.sqrt(
                    (actualPosition[0] - pred.predicted[0]) ** 2 +
                    (actualPosition[2] - pred.predicted[2]) ** 2
                );
                totalError += error;
                count++;
                return false;  // Remove
            }
            return true;  // Keep
        });
        
        if (count > 0) {
            const avgError = totalError / count;
            // Accuracy: 100% at 0 error, 0% at 100+ blocks error
            this.stats.predictionAccuracy = Math.max(0, 100 - avgError);
        }
        
        // Store current prediction for future accuracy check
        if (this.speed > this.minSpeedThreshold) {
            this.pastPredictions.push({
                time: now,
                predicted: [...this.predictedPosition],
                predictionTime: this.predictionTimeSeconds,
            });
            
            // Limit stored predictions
            while (this.pastPredictions.length > this.maxPastPredictions) {
                this.pastPredictions.shift();
            }
        }
    }
    
    /**
     * Get predicted chunk coordinates
     * @param {number} chunkSize 
     * @returns {Object} - { x, z }
     */
    getPredictedChunk(chunkSize = 32) {
        return {
            x: Math.floor(this.predictedPosition[0] / chunkSize),
            z: Math.floor(this.predictedPosition[2] / chunkSize),
        };
    }
    
    /**
     * Check if prediction is active (player moving fast enough)
     * @returns {boolean}
     */
    isPredictionActive() {
        return this.enabled && this.speed > this.minSpeedThreshold;
    }
    
    /**
     * Calculate priority boost for a chunk based on prediction
     * Uses cascaded prediction tiers for different time horizons
     * @param {number} chunkX 
     * @param {number} chunkZ 
     * @param {number} playerChunkX 
     * @param {number} playerChunkZ 
     * @param {number} chunkSize 
     * @returns {number} - Priority boost (0 if not in predicted path)
     */
    getChunkPriorityBoost(chunkX, chunkZ, playerChunkX, playerChunkZ, chunkSize = 32) {
        if (!this.isPredictionActive()) {
            return 0;
        }
        
        // === CASCADED PREDICTION TIERS ===
        // Tier 1: 0.5s ahead - highest priority (immediate path)
        // Tier 2: 1.0s ahead - high priority  
        // Tier 3: 2.0s ahead - medium priority
        // Tier 4: 3.0s ahead - low priority (prefetch)
        const tiers = [
            { time: 0.5, boost: this.predictionBoost * 1.0, radius: 1 },
            { time: 1.0, boost: this.predictionBoost * 0.7, radius: 2 },
            { time: 2.0, boost: this.predictionBoost * 0.4, radius: 3 },
            { time: 3.0, boost: this.predictionBoost * 0.2, radius: 4 },
        ];
        
        let maxBoost = 0;
        
        for (const tier of tiers) {
            // Calculate predicted position for this tier
            const predictedX = this.currentPosition[0] + this.velocity[0] * tier.time;
            const predictedZ = this.currentPosition[2] + this.velocity[2] * tier.time;
            const predChunkX = Math.floor(predictedX / chunkSize);
            const predChunkZ = Math.floor(predictedZ / chunkSize);
            
            // Distance from predicted position
            const dx = chunkX - predChunkX;
            const dz = chunkZ - predChunkZ;
            const dist = Math.sqrt(dx * dx + dz * dz);
            
            if (dist <= tier.radius) {
                // Also check if chunk is in front of player (in movement direction)
                const toChunkX = chunkX - playerChunkX;
                const toChunkZ = chunkZ - playerChunkZ;
                const dot = toChunkX * this.direction[0] + toChunkZ * this.direction[2];
                
                if (dot >= 0) {
                    // Boost decreases with distance from predicted center
                    const boost = tier.boost * (1 - dist / (tier.radius + 1));
                    maxBoost = Math.max(maxBoost, boost);
                }
            }
        }
        
        if (maxBoost > 0) {
            this.stats.boostApplied++;
        }
        
        return maxBoost;
    }
    
    /**
     * Get chunks that should be prioritized based on prediction
     * @param {number} playerChunkX 
     * @param {number} playerChunkZ 
     * @param {number} chunkSize 
     * @returns {Array} - [{x, z, boost}]
     */
    getPriorityChunks(playerChunkX, playerChunkZ, chunkSize = 32) {
        if (!this.isPredictionActive()) {
            return [];
        }
        
        const predicted = this.getPredictedChunk(chunkSize);
        const chunks = [];
        
        for (let dx = -this.predictionRadius; dx <= this.predictionRadius; dx++) {
            for (let dz = -this.predictionRadius; dz <= this.predictionRadius; dz++) {
                const cx = predicted.x + dx;
                const cz = predicted.z + dz;
                const boost = this.getChunkPriorityBoost(cx, cz, playerChunkX, playerChunkZ, chunkSize);
                
                if (boost > 0) {
                    chunks.push({ x: cx, z: cz, boost });
                }
            }
        }
        
        // Sort by boost (highest first)
        chunks.sort((a, b) => b.boost - a.boost);
        
        return chunks;
    }
    
    /**
     * Get current velocity
     * @returns {Array} - [vx, vy, vz]
     */
    getVelocity() {
        return [...this.velocity];
    }
    
    /**
     * Get movement direction (normalized)
     * @returns {Array} - [dx, dy, dz]
     */
    getDirection() {
        return [...this.direction];
    }
    
    /**
     * Get stats
     */
    getStats() {
        return {
            ...this.stats,
            speed: this.speed,
            isActive: this.isPredictionActive(),
            predictedChunk: this.getPredictedChunk(),
        };
    }
    
    /**
     * Reset state
     */
    reset() {
        this.positionHistory = [];
        this.velocity = [0, 0, 0];
        this.speed = 0;
        this.pastPredictions = [];
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [chunk_loading] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.prediction_enabled !== false;
        this.predictionTimeSeconds = parseFloat(cfg.prediction_time) || 2.0;
    }
}

export default MovementPredictor;
