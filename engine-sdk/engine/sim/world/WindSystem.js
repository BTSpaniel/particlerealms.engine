// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { legacyWindTurbulenceAxisHash32 } from '../../core/math/MathBits.js';
import { degreesToRadians } from '../../core/math/UnitMath.js';

/**
 * WindSystem.js - Global Wind Simulation
 * 
 * Provides wind data for vegetation, particles, cloth, etc.
 * Features gusts, turbulence, and directional wind
 */

export class WindSystem {
    constructor() {
        this.device = null;
        this.initialized = false;
        this.enabled = true;
        
        // Wind parameters
        this.direction = 45;  // degrees
        this.speed = 5.0;     // m/s
        this.gustFrequency = 0.5;
        this.gustStrength = 2.0;
        this.turbulence = 0.3;
        
        // Computed values
        this.windVector = [0, 0, 0];
        this.gustPhase = 0;
        this.time = 0;
        
        // GPU buffer for wind data
        this.windBuffer = null;
    }
    
    async init(device) {
        this.device = device;
        
        this.windBuffer = device.createBuffer({
            size: 48, // wind vector, gust, turbulence, time
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        this.initialized = true;
        this.updateWindVector();
    }
    
    updateWindVector() {
        const rad = degreesToRadians(Number(this.direction));
        this.windVector[0] = Math.cos(rad) * this.speed;
        this.windVector[1] = 0;
        this.windVector[2] = Math.sin(rad) * this.speed;
    }
    
    update(deltaTime) {
        if (!this.enabled) return;
        
        this.time += deltaTime;
        this.gustPhase += deltaTime * this.gustFrequency * Math.PI * 2;
        
        // Calculate current gust multiplier
        const gust = 1.0 + Math.sin(this.gustPhase) * this.gustStrength * 0.5;
        
        // Deterministic turbulence noise based on time (for multiplayer sync)
        const timeHash = Math.floor(this.time * 10);
        const hashX = legacyWindTurbulenceAxisHash32(timeHash, 'x');
        const hashZ = legacyWindTurbulenceAxisHash32(timeHash, 'z');
        const turbX = (hashX / 1000 - 0.5) * this.turbulence;
        const turbZ = (hashZ / 1000 - 0.5) * this.turbulence;
        
        this.updateUniforms(gust, turbX, turbZ);
    }
    
    updateUniforms(gust = 1.0, turbX = 0, turbZ = 0) {
        if (!this.initialized) return;
        
        const data = new Float32Array([
            this.windVector[0] * gust + turbX,
            this.windVector[1],
            this.windVector[2] * gust + turbZ,
            this.speed,
            gust,
            this.gustFrequency,
            this.gustStrength,
            this.turbulence,
            this.time,
            this.direction,
            0, 0,
        ]);
        
        this.device.queue.writeBuffer(this.windBuffer, 0, data);
    }
    
    getWindAt(x, y, z) {
        // Simple wind with height variation
        const heightFactor = Math.max(0, Math.min(1, y / 50));
        const gust = 1.0 + Math.sin(this.gustPhase + x * 0.1) * this.gustStrength * 0.5;
        
        return [
            this.windVector[0] * gust * heightFactor,
            0,
            this.windVector[2] * gust * heightFactor,
        ];
    }
    
    getWindBuffer() {
        return this.windBuffer;
    }
    
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.direction = parseFloat(cfg.direction) || 45;
        this.speed = parseFloat(cfg.speed) || 5.0;
        this.gustFrequency = parseFloat(cfg.gust_frequency) || 0.5;
        this.gustStrength = parseFloat(cfg.gust_strength) || 2.0;
        this.turbulence = parseFloat(cfg.turbulence) || 0.3;
        
        this.updateWindVector();
    }
    
    destroy() {
        this.windBuffer?.destroy();
        this.initialized = false;
    }
}

export default WindSystem;
