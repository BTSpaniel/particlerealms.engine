// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ZoneManager.js - World Zone Management System
 * 
 * Manages different zone types for gameplay:
 * - Saved zones: Persistent destruction that saves with the world
 * - Battle zones: Temporary destruction that resets on exit
 * - Safe zones: No destruction allowed
 * 
 * Also handles:
 * - Zone boundary particle containment
 * - Cross-zone material transfer
 * - Zone transitions and effects
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Zone types */
export const ZONE_TYPE = {
    PERSISTENT: 'persistent',   // Destruction persists forever
    BATTLE: 'battle',           // Resets when player leaves
    SAFE: 'safe',               // No destruction allowed
    INSTANCED: 'instanced',     // Per-player instance
};

/** Zone shapes */
export const ZONE_SHAPE = {
    BOX: 'box',
    SPHERE: 'sphere',
    CYLINDER: 'cylinder',
    POLYGON: 'polygon',  // 2D polygon extruded in Y
};

// ============================================================================
// ZONE CLASS
// ============================================================================

/**
 * Represents a single zone in the world
 */
export class Zone {
    constructor(id, options = {}) {
        this.id = id;
        this.name = options.name || `Zone_${id}`;
        this.type = options.type || ZONE_TYPE.PERSISTENT;
        this.shape = options.shape || ZONE_SHAPE.BOX;
        
        // Position and bounds
        this.center = options.center || [0, 0, 0];
        this.size = options.size || [100, 100, 100];  // For box
        this.radius = options.radius || 50;            // For sphere/cylinder
        this.height = options.height || 100;           // For cylinder
        this.polygon = options.polygon || null;        // For polygon [{x, z}, ...]
        
        // State
        this.active = true;
        this.playerInside = false;
        this.entryTime = 0;
        this.totalTimeInside = 0;
        
        // Destruction tracking (for battle zones)
        this.destructionState = null;  // Snapshot before destruction
        this.modifiedVoxels = new Map();  // key -> {original, current}
        this.spawnedParticles = [];
        this.spawnedFragments = [];
        
        // Containment settings
        this.containParticles = options.containParticles ?? false;
        this.particleBounce = options.particleBounce ?? 0.3;
        this.allowMaterialTransfer = options.allowMaterialTransfer ?? true;
        
        // Visual settings
        this.visible = options.visible ?? false;
        this.boundaryColor = options.boundaryColor || [0.2, 0.5, 1.0, 0.3];
        this.boundaryPulse = options.boundaryPulse ?? true;
        
        // Callbacks
        this.onEnter = options.onEnter || null;
        this.onExit = options.onExit || null;
        this.onReset = options.onReset || null;
    }
    
    /**
     * Check if a point is inside this zone
     * @param {number[]} point - [x, y, z]
     * @returns {boolean}
     */
    containsPoint(point) {
        const [px, py, pz] = point;
        const [cx, cy, cz] = this.center;
        
        switch (this.shape) {
            case ZONE_SHAPE.BOX: {
                const [sx, sy, sz] = this.size;
                return Math.abs(px - cx) <= sx / 2 &&
                       Math.abs(py - cy) <= sy / 2 &&
                       Math.abs(pz - cz) <= sz / 2;
            }
            
            case ZONE_SHAPE.SPHERE: {
                const dx = px - cx;
                const dy = py - cy;
                const dz = pz - cz;
                return dx * dx + dy * dy + dz * dz <= this.radius * this.radius;
            }
            
            case ZONE_SHAPE.CYLINDER: {
                const dx = px - cx;
                const dz = pz - cz;
                const inRadius = dx * dx + dz * dz <= this.radius * this.radius;
                const inHeight = Math.abs(py - cy) <= this.height / 2;
                return inRadius && inHeight;
            }
            
            case ZONE_SHAPE.POLYGON: {
                if (!this.polygon || this.polygon.length < 3) return false;
                // Check Y bounds first
                const halfHeight = (this.size?.[1] || this.height || 100) / 2;
                if (Math.abs(py - cy) > halfHeight) return false;
                // Point-in-polygon test (ray casting)
                return this._pointInPolygon(px, pz);
            }
            
            default:
                return false;
        }
    }
    
    /**
     * Point-in-polygon test using ray casting
     */
    _pointInPolygon(x, z) {
        const poly = this.polygon;
        let inside = false;
        
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x + this.center[0];
            const zi = poly[i].z + this.center[2];
            const xj = poly[j].x + this.center[0];
            const zj = poly[j].z + this.center[2];
            
            if (((zi > z) !== (zj > z)) &&
                (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) {
                inside = !inside;
            }
        }
        
        return inside;
    }
    
    /**
     * Get distance to zone boundary (negative = inside)
     * @param {number[]} point
     * @returns {number}
     */
    distanceToBoundary(point) {
        const [px, py, pz] = point;
        const [cx, cy, cz] = this.center;
        
        switch (this.shape) {
            case ZONE_SHAPE.BOX: {
                const [sx, sy, sz] = this.size;
                const dx = Math.abs(px - cx) - sx / 2;
                const dy = Math.abs(py - cy) - sy / 2;
                const dz = Math.abs(pz - cz) - sz / 2;
                
                // Outside: distance to nearest face
                if (dx > 0 || dy > 0 || dz > 0) {
                    return Math.sqrt(
                        Math.max(0, dx) ** 2 +
                        Math.max(0, dy) ** 2 +
                        Math.max(0, dz) ** 2
                    );
                }
                // Inside: negative distance to nearest face
                return Math.max(dx, dy, dz);
            }
            
            case ZONE_SHAPE.SPHERE: {
                const dx = px - cx;
                const dy = py - cy;
                const dz = pz - cz;
                return Math.sqrt(dx * dx + dy * dy + dz * dz) - this.radius;
            }
            
            case ZONE_SHAPE.CYLINDER: {
                const dx = px - cx;
                const dz = pz - cz;
                const radialDist = Math.sqrt(dx * dx + dz * dz) - this.radius;
                const verticalDist = Math.abs(py - cy) - this.height / 2;
                
                if (radialDist > 0 || verticalDist > 0) {
                    return Math.sqrt(
                        Math.max(0, radialDist) ** 2 +
                        Math.max(0, verticalDist) ** 2
                    );
                }
                return Math.max(radialDist, verticalDist);
            }
            
            default:
                return this.containsPoint(point) ? -1 : 1;
        }
    }
    
    /**
     * Clamp a point to stay inside the zone
     * @param {number[]} point
     * @returns {number[]}
     */
    clampPoint(point) {
        if (this.containsPoint(point)) return point;
        
        const [px, py, pz] = point;
        const [cx, cy, cz] = this.center;
        
        switch (this.shape) {
            case ZONE_SHAPE.BOX: {
                const [sx, sy, sz] = this.size;
                return [
                    Math.max(cx - sx / 2, Math.min(cx + sx / 2, px)),
                    Math.max(cy - sy / 2, Math.min(cy + sy / 2, py)),
                    Math.max(cz - sz / 2, Math.min(cz + sz / 2, pz)),
                ];
            }
            
            case ZONE_SHAPE.SPHERE: {
                const dx = px - cx;
                const dy = py - cy;
                const dz = pz - cz;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist === 0) return this.center;
                const scale = this.radius / dist;
                return [
                    cx + dx * scale,
                    cy + dy * scale,
                    cz + dz * scale,
                ];
            }
            
            case ZONE_SHAPE.CYLINDER: {
                const dx = px - cx;
                const dz = pz - cz;
                const radialDist = Math.sqrt(dx * dx + dz * dz);
                
                let nx = px, ny = py, nz = pz;
                
                if (radialDist > this.radius && radialDist > 0) {
                    const scale = this.radius / radialDist;
                    nx = cx + dx * scale;
                    nz = cz + dz * scale;
                }
                
                ny = Math.max(cy - this.height / 2, Math.min(cy + this.height / 2, py));
                
                return [nx, ny, nz];
            }
            
            default:
                return point;
        }
    }
    
    /**
     * Record voxel modification for potential reset
     */
    recordVoxelChange(x, y, z, originalMaterial, newMaterial) {
        const key = `${x},${y},${z}`;
        if (!this.modifiedVoxels.has(key)) {
            this.modifiedVoxels.set(key, {
                original: originalMaterial,
                current: newMaterial,
            });
        } else {
            this.modifiedVoxels.get(key).current = newMaterial;
        }
    }
    
    /**
     * Get all voxel modifications
     */
    getModifications() {
        return this.modifiedVoxels;
    }
    
    /**
     * Clear modification tracking
     */
    clearModifications() {
        this.modifiedVoxels.clear();
        this.spawnedParticles = [];
        this.spawnedFragments = [];
    }
}

// ============================================================================
// ZONE MANAGER
// ============================================================================

/**
 * Manages all zones in the world
 */
export class ZoneManager {
    constructor() {
        this.zones = new Map();
        this.activeZone = null;  // Zone player is currently in
        this.previousZone = null;
        
        // System references
        this.chunkManager = null;
        this.particleSystem = null;
        
        // Global settings
        this.defaultZoneType = ZONE_TYPE.PERSISTENT;
        this.transitionDuration = 0.5;  // Seconds
        
        // Callbacks
        this.onZoneEnter = null;
        this.onZoneExit = null;
        this.onZoneReset = null;
        
        this._nextZoneId = 1;
    }
    
    /**
     * Initialize with system references
     */
    init(options = {}) {
        this.chunkManager = options.chunkManager || null;
        this.particleSystem = options.particleSystem || null;
        console.log('[ZoneManager] Initialized');
    }
    
    /**
     * Create a new zone
     * @param {Object} options
     * @returns {Zone}
     */
    createZone(options = {}) {
        const id = options.id || this._nextZoneId++;
        const zone = new Zone(id, options);
        this.zones.set(id, zone);
        return zone;
    }
    
    /**
     * Remove a zone
     * @param {number|string} id
     */
    removeZone(id) {
        const zone = this.zones.get(id);
        if (zone) {
            if (this.activeZone === zone) {
                this._exitZone(zone);
            }
            this.zones.delete(id);
        }
    }
    
    /**
     * Get zone at position
     * @param {number[]} position
     * @returns {Zone|null}
     */
    getZoneAt(position) {
        for (const zone of this.zones.values()) {
            if (zone.active && zone.containsPoint(position)) {
                return zone;
            }
        }
        return null;
    }
    
    /**
     * Get all zones containing a position
     */
    getZonesAt(position) {
        const result = [];
        for (const zone of this.zones.values()) {
            if (zone.active && zone.containsPoint(position)) {
                result.push(zone);
            }
        }
        return result;
    }
    
    /**
     * Update zone states based on player position
     * @param {number[]} playerPos
     * @param {number} dt
     */
    update(playerPos, dt) {
        const currentZone = this.getZoneAt(playerPos);
        
        // Check for zone transition
        if (currentZone !== this.activeZone) {
            // Exit previous zone
            if (this.activeZone) {
                this._exitZone(this.activeZone);
            }
            
            // Enter new zone
            if (currentZone) {
                this._enterZone(currentZone);
            }
            
            this.previousZone = this.activeZone;
            this.activeZone = currentZone;
        }
        
        // Update active zone
        if (this.activeZone) {
            this.activeZone.totalTimeInside += dt;
        }
        
        // Contain particles in zones
        this._containParticles();
    }
    
    /**
     * Check if destruction is allowed at position
     * @param {number[]} position
     * @returns {boolean}
     */
    canDestroy(position) {
        const zone = this.getZoneAt(position);
        if (!zone) return true;  // Outside all zones - allow
        
        return zone.type !== ZONE_TYPE.SAFE;
    }
    
    /**
     * Record destruction in appropriate zone
     */
    recordDestruction(position, originalMaterial, newMaterial) {
        const zone = this.getZoneAt(position);
        if (zone && zone.type === ZONE_TYPE.BATTLE) {
            zone.recordVoxelChange(
                Math.floor(position[0]),
                Math.floor(position[1]),
                Math.floor(position[2]),
                originalMaterial,
                newMaterial
            );
        }
    }
    
    /**
     * Reset a battle zone to original state
     */
    resetZone(zoneId) {
        const zone = this.zones.get(zoneId);
        if (!zone || zone.type !== ZONE_TYPE.BATTLE) return;
        
        if (!this.chunkManager) return;
        
        // Restore all modified voxels
        for (const [key, data] of zone.modifiedVoxels) {
            const [x, y, z] = key.split(',').map(Number);
            this.chunkManager.setVoxel(x, y, z, data.original);
        }
        
        // Remove spawned particles
        if (this.particleSystem) {
            for (const particle of zone.spawnedParticles) {
                const idx = this.particleSystem.indexOf(particle);
                if (idx >= 0) {
                    this.particleSystem.splice(idx, 1);
                }
            }
        }
        
        // Clear tracking
        zone.clearModifications();
        
        // Callback
        if (zone.onReset) zone.onReset(zone);
        if (this.onZoneReset) this.onZoneReset(zone);
        
        console.log(`[ZoneManager] Reset zone ${zone.name}`);
    }
    
    /**
     * Handle entering a zone
     */
    _enterZone(zone) {
        zone.playerInside = true;
        zone.entryTime = performance.now();
        
        if (zone.onEnter) zone.onEnter(zone);
        if (this.onZoneEnter) this.onZoneEnter(zone);
        
        console.log(`[ZoneManager] Entered zone ${zone.name} (${zone.type})`);
    }
    
    /**
     * Handle exiting a zone
     */
    _exitZone(zone) {
        zone.playerInside = false;
        
        // Auto-reset battle zones on exit
        if (zone.type === ZONE_TYPE.BATTLE) {
            this.resetZone(zone.id);
        }
        
        if (zone.onExit) zone.onExit(zone);
        if (this.onZoneExit) this.onZoneExit(zone);
        
        console.log(`[ZoneManager] Exited zone ${zone.name}`);
    }
    
    /**
     * Contain particles within their zones
     */
    _containParticles() {
        if (!this.particleSystem) return;
        
        for (const particle of this.particleSystem) {
            const pos = [particle.x, particle.y, particle.z];
            
            for (const zone of this.zones.values()) {
                if (!zone.containParticles || !zone.active) continue;
                
                const dist = zone.distanceToBoundary(pos);
                
                // If inside containment zone and trying to leave
                if (dist > -0.5 && dist < 0.5) {
                    // Near boundary - check if moving outward
                    const nextPos = [
                        particle.x + particle.vx * 0.016,
                        particle.y + particle.vy * 0.016,
                        particle.z + particle.vz * 0.016,
                    ];
                    
                    if (!zone.containsPoint(nextPos)) {
                        // Bounce back
                        const clamped = zone.clampPoint(pos);
                        particle.x = clamped[0];
                        particle.y = clamped[1];
                        particle.z = clamped[2];
                        
                        // Reflect velocity (simple)
                        particle.vx *= -zone.particleBounce;
                        particle.vy *= -zone.particleBounce;
                        particle.vz *= -zone.particleBounce;
                    }
                }
            }
        }
    }
    
    /**
     * Create a battle arena zone
     */
    createBattleArena(center, radius, name = 'Battle Arena') {
        return this.createZone({
            name: name,
            type: ZONE_TYPE.BATTLE,
            shape: ZONE_SHAPE.CYLINDER,
            center: center,
            radius: radius,
            height: radius * 2,
            containParticles: true,
            visible: true,
        });
    }
    
    /**
     * Create a safe zone
     */
    createSafeZone(center, size, name = 'Safe Zone') {
        return this.createZone({
            name: name,
            type: ZONE_TYPE.SAFE,
            shape: ZONE_SHAPE.BOX,
            center: center,
            size: size,
            visible: true,
            boundaryColor: [0.2, 1.0, 0.3, 0.2],
        });
    }
    
    /**
     * Get zone visualization data for rendering
     */
    getVisualizationData() {
        const result = [];
        
        for (const zone of this.zones.values()) {
            if (!zone.visible || !zone.active) continue;
            
            result.push({
                id: zone.id,
                name: zone.name,
                type: zone.type,
                shape: zone.shape,
                center: zone.center,
                size: zone.size,
                radius: zone.radius,
                height: zone.height,
                color: zone.boundaryColor,
                playerInside: zone.playerInside,
            });
        }
        
        return result;
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [zone_manager] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.maxZones = parseInt(cfg.max_zones) || 32;
        this.updateRate = parseFloat(cfg.update_rate) || 10;
    }
}

export default ZoneManager;
