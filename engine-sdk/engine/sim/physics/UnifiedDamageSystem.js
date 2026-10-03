/**
 * UnifiedDamageSystem.js - Cross-System Damage Integration
 * 
 * Connects all destruction systems so everything affects everything:
 * - Particles damage voxels (erosion, accumulation)
 * - Particles damage meshes (impact fracture)
 * - Mesh debris creates voxel craters
 * - Voxel explosions affect mesh structures
 * 
 * Acts as the central hub for damage propagation between systems.
 */

import { MATERIAL } from '../../voxel/MaterialSchema.js';
import { legacyPrimeCoordinateXorHash3D } from '../../core/math/MathBits.js';
import { ConnectivityCompute } from './ConnectivityCompute.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Damage types */
export const DAMAGE_TYPE = {
    IMPACT: 'impact',           // Direct hit
    EXPLOSION: 'explosion',     // Radial blast
    EROSION: 'erosion',         // Gradual wear
    PIERCE: 'pierce',           // Penetrating
    CRUSH: 'crush',             // Compressive
    HEAT: 'heat',               // Fire/lava
    ACID: 'acid',               // Corrosive
};

/** Material resistances to damage types (multipliers, lower = more resistant) */
const MATERIAL_RESISTANCE = {
    // Material: { damageType: multiplier }
    stone: { impact: 0.8, explosion: 1.0, erosion: 0.5, pierce: 0.6, crush: 0.7, heat: 0.3, acid: 0.8 },
    dirt: { impact: 1.2, explosion: 1.5, erosion: 1.5, pierce: 1.0, crush: 1.5, heat: 0.5, acid: 1.2 },
    grass: { impact: 1.2, explosion: 1.5, erosion: 1.5, pierce: 1.0, crush: 1.5, heat: 2.0, acid: 1.5 },
    sand: { impact: 1.5, explosion: 2.0, erosion: 2.0, pierce: 1.2, crush: 2.0, heat: 0.2, acid: 0.5 },
    wood: { impact: 1.0, explosion: 1.2, erosion: 1.0, pierce: 0.8, crush: 1.0, heat: 3.0, acid: 1.5 },
    metal: { impact: 0.5, explosion: 0.7, erosion: 0.3, pierce: 0.4, crush: 0.3, heat: 0.5, acid: 1.5 },
    glass: { impact: 3.0, explosion: 3.0, erosion: 0.5, pierce: 2.0, crush: 3.0, heat: 0.8, acid: 0.3 },
    concrete: { impact: 0.7, explosion: 0.9, erosion: 0.4, pierce: 0.5, crush: 0.6, heat: 0.3, acid: 1.0 },
    default: { impact: 1.0, explosion: 1.0, erosion: 1.0, pierce: 1.0, crush: 1.0, heat: 1.0, acid: 1.0 },
};

/** Particle velocity thresholds for damage */
const VELOCITY_DAMAGE_THRESHOLD = 5.0;  // m/s - below this, no damage
const VELOCITY_MAX_DAMAGE = 30.0;       // m/s - at this, maximum damage

/** Mass thresholds */
const MASS_DAMAGE_MULTIPLIER = 0.1;     // Damage per kg of mass

// ============================================================================
// DAMAGE EVENT
// ============================================================================

/**
 * Represents a damage event that propagates through systems
 */
export class DamageEvent {
    constructor(options = {}) {
        this.type = options.type || DAMAGE_TYPE.IMPACT;
        this.position = options.position || [0, 0, 0];
        this.direction = options.direction || [0, -1, 0];
        this.radius = options.radius || 1.0;
        this.amount = options.amount || 1.0;
        this.source = options.source || null;      // What caused it
        this.sourceType = options.sourceType || 'unknown';  // 'particle', 'mesh', 'voxel', 'player'
        this.timestamp = performance.now();
        
        // Propagation tracking
        this.affectedVoxels = [];
        this.affectedMeshes = [];
        this.affectedParticles = [];
        this.spawnedParticles = [];
        this.spawnedDebris = [];
    }
}

// ============================================================================
// UNIFIED DAMAGE SYSTEM
// ============================================================================

/**
 * Central damage system that coordinates between all subsystems
 */
export class UnifiedDamageSystem {
    constructor() {
        // System references (set during init)
        this.chunkManager = null;
        this.fragmentManager = null;
        this.particleSystem = null;  // worldParticles array reference
        this.structuralSolver = null;
        this.connectivityCompute = null;  // GPU connectivity for floating piece detection
        
        // Damage history for replay/effects
        this.damageHistory = [];
        this.maxHistorySize = 1000;
        
        // Pending damage events (batched per frame)
        this.pendingEvents = [];
        
        // Callbacks
        this.onVoxelDamage = null;
        this.onMeshDamage = null;
        this.onParticleSpawn = null;
        this.onDebrisSpawn = null;
        
        // Config
        this.enabled = true;
        this.particleToVoxelEnabled = true;
        this.particleToMeshEnabled = true;
        this.meshToVoxelEnabled = true;
        this.voxelToMeshEnabled = true;
        this.chainReactionEnabled = true;
        
        // Stats
        this.stats = {
            eventsProcessed: 0,
            voxelsDestroyed: 0,
            meshesAffected: 0,
            particlesSpawned: 0,
        };
    }
    
    /**
     * Initialize with system references
     */
    init(options = {}) {
        this.chunkManager = options.chunkManager || null;
        this.fragmentManager = options.fragmentManager || null;
        this.particleSystem = options.particleSystem || null;
        this.structuralSolver = options.structuralSolver || null;
        this.connectivityCompute = options.connectivityCompute || null;
        
        console.log('[UnifiedDamageSystem] Initialized', {
            hasConnectivity: !!this.connectivityCompute
        });
    }
    
    /**
     * Initialize GPU connectivity (requires device)
     * @param {GPUDevice} device 
     */
    initGPUConnectivity(device) {
        if (device && !this.connectivityCompute) {
            this.connectivityCompute = new ConnectivityCompute(device, { gridSize: 32 });
            console.log('[UnifiedDamageSystem] GPU connectivity initialized');
        }
    }
    
    /**
     * Queue a damage event for processing
     * @param {DamageEvent|Object} event 
     */
    queueDamage(event) {
        if (!this.enabled) return;
        
        const damageEvent = event instanceof DamageEvent 
            ? event 
            : new DamageEvent(event);
        
        this.pendingEvents.push(damageEvent);
    }
    
    /**
     * Create explosion damage
     */
    createExplosion(center, radius, power, source = null) {
        this.queueDamage({
            type: DAMAGE_TYPE.EXPLOSION,
            position: center,
            direction: [0, 1, 0],
            radius: radius,
            amount: power,
            source: source,
            sourceType: 'explosion',
        });
    }
    
    /**
     * Process all pending damage events
     * @param {number} dt - Delta time
     */
    update(dt) {
        if (!this.enabled || this.pendingEvents.length === 0) return;
        
        // Process all pending events
        for (const event of this.pendingEvents) {
            this._processEvent(event);
            
            // Add to history
            this.damageHistory.push(event);
            if (this.damageHistory.length > this.maxHistorySize) {
                this.damageHistory.shift();
            }
            
            this.stats.eventsProcessed++;
        }
        
        // Clear pending
        this.pendingEvents = [];
    }
    
    /**
     * Check particle collisions and create damage events
     */
    checkParticleCollisions(particles) {
        if (!this.particleToVoxelEnabled && !this.particleToMeshEnabled) return;
        
        for (const particle of particles) {
            // Calculate velocity magnitude
            const speed = Math.sqrt(
                particle.vx * particle.vx +
                particle.vy * particle.vy +
                particle.vz * particle.vz
            );
            
            // Skip slow particles
            if (speed < VELOCITY_DAMAGE_THRESHOLD) continue;
            
            // Calculate damage based on velocity and mass
            const velocityFactor = Math.min(1, (speed - VELOCITY_DAMAGE_THRESHOLD) / 
                (VELOCITY_MAX_DAMAGE - VELOCITY_DAMAGE_THRESHOLD));
            const massFactor = (particle.mass || 1) * MASS_DAMAGE_MULTIPLIER;
            const damage = velocityFactor * massFactor;
            
            if (damage < 0.01) continue;
            
            // Create impact event
            const direction = speed > 0.1 ? [
                -particle.vx / speed,
                -particle.vy / speed,
                -particle.vz / speed,
            ] : [0, -1, 0];
            
            this.queueDamage({
                type: DAMAGE_TYPE.IMPACT,
                position: [particle.x, particle.y, particle.z],
                direction: direction,
                radius: 0.5,
                amount: damage,
                source: particle,
                sourceType: 'particle',
            });
        }
    }
    
    /**
     * Process a single damage event
     */
    _processEvent(event) {
        switch (event.sourceType) {
            case 'particle':
                this._handleParticleDamage(event);
                break;
            case 'mesh':
            case 'fragment':
                this._handleMeshDamage(event);
                break;
            case 'voxel':
            case 'explosion':
                this._handleExplosionDamage(event);
                break;
            default:
                this._handleGenericDamage(event);
        }
    }
    
    /**
     * Handle particle impacting voxels/meshes
     */
    _handleParticleDamage(event) {
        const [px, py, pz] = event.position;
        
        // Damage voxels
        if (this.particleToVoxelEnabled && this.chunkManager) {
            const affected = this._damageVoxelsInRadius(
                px, py, pz,
                event.radius,
                event.amount,
                event.type
            );
            event.affectedVoxels = affected;
        }
        
        // Damage mesh structures
        if (this.particleToMeshEnabled && this.structuralSolver) {
            this.structuralSolver.applyDamage(
                event.position,
                event.radius * 2,
                event.amount * 0.5,
                'linear'
            );
        }
    }
    
    /**
     * Handle mesh debris creating craters
     */
    _handleMeshDamage(event) {
        if (!this.meshToVoxelEnabled || !this.chunkManager) return;
        
        const [px, py, pz] = event.position;
        
        // Create crater in voxels
        const craterRadius = event.radius * event.amount;
        if (craterRadius > 0.5) {
            const removed = this._removeVoxelsSphere(px, py, pz, craterRadius);
            event.affectedVoxels = removed;
            
            // Spawn debris particles
            if (this.onParticleSpawn && removed.length > 0) {
                const particles = this._createDebrisParticles(removed, event.direction, event.amount);
                event.spawnedParticles = particles;
                this.onParticleSpawn(particles);
            }
        }
    }
    
    /**
     * Handle explosion damage to all systems
     */
    _handleExplosionDamage(event) {
        const [cx, cy, cz] = event.position;
        const radius = event.radius;
        const power = event.amount;
        
        // Damage voxels
        if (this.chunkManager) {
            const removed = this._removeVoxelsSphere(cx, cy, cz, radius * 0.7);
            event.affectedVoxels = removed;
            this.stats.voxelsDestroyed += removed.length;
            
            // Spawn explosion particles
            if (this.onParticleSpawn && removed.length > 0) {
                const particles = [];
                const maxParticles = Math.min(removed.length, 20);
                
                for (let i = 0; i < maxParticles; i++) {
                    const v = removed[i];
                    const dx = v.x - cx;
                    const dy = v.y - cy;
                    const dz = v.z - cz;
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
                    const speed = power * (1 - dist / radius) * 10;
                    
                    // Deterministic random based on voxel position (multiplayer sync)
                    const hash = legacyPrimeCoordinateXorHash3D(v.x, v.y, v.z);
                    const r1 = (hash % 1000) / 1000;
                    const r2 = ((hash * 31) % 1000) / 1000;
                    const r3 = ((hash * 37) % 1000) / 1000;
                    const r4 = ((hash * 41) % 1000) / 1000;
                    
                    particles.push({
                        x: v.x,
                        y: v.y,
                        z: v.z,
                        vx: (dx / dist) * speed + (r1 - 0.5) * 3,
                        vy: (dy / dist) * speed + r2 * 5,
                        vz: (dz / dist) * speed + (r3 - 0.5) * 3,
                        material: v.material,
                        life: 3 + r4 * 4,
                        mass: 1.0,
                        canAccumulate: true,
                    });
                }
                
                event.spawnedParticles = particles;
                this.onParticleSpawn(particles);
                this.stats.particlesSpawned += particles.length;
            }
        }
        
        // Damage mesh structures
        if (this.structuralSolver) {
            this.structuralSolver.applyDamage(
                event.position,
                radius * 1.5,
                power,
                'quadratic'
            );
            this.stats.meshesAffected++;
        }
        
        // Apply impulse to fragments
        if (this.fragmentManager) {
            for (const frag of this.fragmentManager.fragments) {
                const dx = frag.position[0] - cx;
                const dy = frag.position[1] - cy;
                const dz = frag.position[2] - cz;
                const distSq = dx * dx + dy * dy + dz * dz;
                
                if (distSq < radius * radius * 4) {
                    const dist = Math.sqrt(distSq) || 1;
                    const force = power * 100 * (1 - dist / (radius * 2));
                    const dir = [dx / dist, dy / dist, dz / dist];
                    
                    frag.velocity[0] += dir[0] * force / frag.mass;
                    frag.velocity[1] += dir[1] * force / frag.mass + 2;
                    frag.velocity[2] += dir[2] * force / frag.mass;
                    frag.sleeping = false;
                }
            }
        }
        
        // Chain reaction - check for explosive materials
        if (this.chainReactionEnabled) {
            this._checkChainReaction(event);
        }
    }
    
    /**
     * Handle generic damage
     */
    _handleGenericDamage(event) {
        // Apply to both voxels and structures
        if (this.chunkManager) {
            this._damageVoxelsInRadius(
                event.position[0],
                event.position[1],
                event.position[2],
                event.radius,
                event.amount,
                event.type
            );
        }
        
        if (this.structuralSolver) {
            this.structuralSolver.applyDamage(
                event.position,
                event.radius,
                event.amount,
                'linear'
            );
        }
    }
    
    /**
     * Damage voxels in a radius
     * @returns {Array} Affected voxel positions
     */
    _damageVoxelsInRadius(cx, cy, cz, radius, amount, damageType) {
        if (!this.chunkManager) return [];
        
        const cm = this.chunkManager;
        const affected = [];
        const radiusSq = radius * radius;
        
        const minX = Math.floor(cx - radius);
        const maxX = Math.ceil(cx + radius);
        const minY = Math.floor(cy - radius);
        const maxY = Math.ceil(cy + radius);
        const minZ = Math.floor(cz - radius);
        const maxZ = Math.ceil(cz + radius);
        
        for (let z = minZ; z <= maxZ; z++) {
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    const dx = x + 0.5 - cx;
                    const dy = y + 0.5 - cy;
                    const dz = z + 0.5 - cz;
                    const distSq = dx * dx + dy * dy + dz * dz;
                    
                    if (distSq > radiusSq) continue;
                    
                    const material = cm.getVoxel(x, y, z);
                    if (material === MATERIAL.AIR) continue;
                    
                    // Calculate damage with resistance
                    const materialName = this._getMaterialName(material);
                    const resistance = MATERIAL_RESISTANCE[materialName] || MATERIAL_RESISTANCE.default;
                    const resistanceMult = resistance[damageType] || 1.0;
                    
                    const dist = Math.sqrt(distSq);
                    const falloff = 1 - dist / radius;
                    const effectiveDamage = amount * falloff * resistanceMult;
                    
                    // Deterministic destruction based on position hash (multiplayer sync)
                    const damageHash = legacyPrimeCoordinateXorHash3D(x, y, z);
                    if ((damageHash % 1000) / 1000 < effectiveDamage) {
                        cm.setVoxel(x, y, z, MATERIAL.AIR);
                        affected.push({ x, y, z, material });
                    }
                }
            }
        }
        
        return affected;
    }
    
    /**
     * Remove voxels in sphere (guaranteed removal)
     */
    _removeVoxelsSphere(cx, cy, cz, radius) {
        if (!this.chunkManager) return [];
        
        const cm = this.chunkManager;
        const removed = [];
        const radiusSq = radius * radius;
        
        const minX = Math.floor(cx - radius);
        const maxX = Math.ceil(cx + radius);
        const minY = Math.floor(cy - radius);
        const maxY = Math.ceil(cy + radius);
        const minZ = Math.floor(cz - radius);
        const maxZ = Math.ceil(cz + radius);
        
        for (let z = minZ; z <= maxZ; z++) {
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    const dx = x + 0.5 - cx;
                    const dy = y + 0.5 - cy;
                    const dz = z + 0.5 - cz;
                    
                    if (dx * dx + dy * dy + dz * dz > radiusSq) continue;
                    
                    const material = cm.getVoxel(x, y, z);
                    if (material !== MATERIAL.AIR) {
                        cm.setVoxel(x, y, z, MATERIAL.AIR);
                        removed.push({ x, y, z, material });
                    }
                }
            }
        }
        
        return removed;
    }
    
    /**
     * Create debris particles from removed voxels
     */
    _createDebrisParticles(voxels, direction, force) {
        const particles = [];
        const count = Math.min(voxels.length, 10);
        
        for (let i = 0; i < count; i++) {
            const v = voxels[i];
            // Deterministic random based on position (multiplayer sync)
            const mineHash = legacyPrimeCoordinateXorHash3D(v.x, v.y, v.z);
            const mr1 = (mineHash % 1000) / 1000;
            const mr2 = ((mineHash * 31) % 1000) / 1000;
            const mr3 = ((mineHash * 37) % 1000) / 1000;
            const mr4 = ((mineHash * 41) % 1000) / 1000;
            
            particles.push({
                x: v.x + 0.5,
                y: v.y + 0.5,
                z: v.z + 0.5,
                vx: direction[0] * force * 2 + (mr1 - 0.5) * 2,
                vy: direction[1] * force * 2 + mr2 * 3,
                vz: direction[2] * force * 2 + (mr3 - 0.5) * 2,
                material: v.material,
                life: 4 + mr4 * 3,
                mass: 1.5,
                canAccumulate: true,
            });
        }
        
        return particles;
    }
    
    /**
     * Check for chain reaction explosions
     */
    _checkChainReaction(event) {
        if (!this.chunkManager) return;
        
        const cm = this.chunkManager;
        const [cx, cy, cz] = event.position;
        const checkRadius = event.radius * 1.5;
        
        // Look for explosive materials (MAGMA, ENERGY)
        const explosiveMaterials = [MATERIAL.MAGMA, MATERIAL.ENERGY];
        
        for (const voxel of event.affectedVoxels) {
            // Check neighbors for explosives
            const neighbors = [
                [voxel.x + 1, voxel.y, voxel.z],
                [voxel.x - 1, voxel.y, voxel.z],
                [voxel.x, voxel.y + 1, voxel.z],
                [voxel.x, voxel.y - 1, voxel.z],
                [voxel.x, voxel.y, voxel.z + 1],
                [voxel.x, voxel.y, voxel.z - 1],
            ];
            
            for (const [nx, ny, nz] of neighbors) {
                const mat = cm.getVoxel(nx, ny, nz);
                if (explosiveMaterials.includes(mat)) {
                    // Trigger secondary explosion (delayed)
                    setTimeout(() => {
                        this.createExplosion(
                            [nx + 0.5, ny + 0.5, nz + 0.5],
                            event.radius * 0.7,
                            event.amount * 0.6,
                            'chain_reaction'
                        );
                    // Deterministic delay based on position
                    const delayHash = legacyPrimeCoordinateXorHash3D(event.position[0], event.position[1], event.position[2]);
                    }, 50 + (delayHash % 100));
                }
            }
        }
    }
    
    /**
     * Get material name from ID
     */
    _getMaterialName(materialId) {
        for (const [name, id] of Object.entries(MATERIAL)) {
            if (id === materialId) return name.toLowerCase();
        }
        return 'default';
    }
    
    /**
     * Get damage history for replay
     */
    getHistory(maxEvents = 100) {
        return this.damageHistory.slice(-maxEvents);
    }
    
    /**
     * Clear damage history
     */
    clearHistory() {
        this.damageHistory = [];
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [unified_damage] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.showDamageNumbers = cfg.show_damage_numbers !== false;
        this.screenShake = cfg.screen_shake !== false;
        this.invincibilityTime = parseFloat(cfg.invincibility_time) || 0.5;
    }
}

export default UnifiedDamageSystem;
