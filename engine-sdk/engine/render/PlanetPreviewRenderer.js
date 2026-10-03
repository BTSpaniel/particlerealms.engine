// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { degreesToRadians } from '../core/math/UnitMath.js';

/**
 * PlanetPreviewRenderer.js - 3D Planet Globe Preview
 * 
 * Renders a rotating 3D globe showing:
 * - Procedural terrain based on world seed
 * - Explored region highlight (where player has been)
 * - Player position marker
 * - Atmosphere glow effect
 * 
 * Used for world save previews to show planetary scale.
 */

// Planet configuration (matches game's planet scale)
const PLANET_RADIUS_KM = 180000;  // 180,000 km radius (28× Earth)
const PREVIEW_SIZE = 384;
const GLOBE_RADIUS = 140;  // Pixels

// Terrain colors for procedural generation
const TERRAIN_COLORS = {
    ocean: [30, 80, 140],
    deepOcean: [20, 50, 100],
    beach: [210, 190, 150],
    grass: [60, 140, 60],
    forest: [30, 100, 40],
    mountain: [120, 110, 100],
    snow: [240, 245, 250],
    ice: [200, 230, 255],
    desert: [200, 180, 130],
    tundra: [150, 160, 140],
};

export class PlanetPreviewRenderer {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.width = PREVIEW_SIZE;
        this.height = Math.floor(PREVIEW_SIZE * 9 / 16);  // 16:9 aspect
        
        // Planet state
        this.rotation = 0;
        this.tilt = degreesToRadians(23.5);  // Axial tilt
        
        // Noise for procedural terrain
        this.noiseCache = new Map();
    }
    
    /**
     * Generate planet preview showing explored region
     * @param {Map} chunks - Loaded chunks map
     * @param {number} seed - World seed for procedural terrain
     * @param {Object} options - Render options
     * @returns {string} Data URL of rendered preview
     */
    async generatePreview(chunks, seed = 12345, options = {}) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.ctx = this.canvas.getContext('2d');
        
        // Initialize noise with seed
        this.seed = seed;
        
        // Calculate explored region bounds
        const exploredBounds = this._calculateExploredBounds(chunks);
        
        // Clear canvas with space background
        this._drawSpaceBackground();
        
        // Draw the planet
        this._drawPlanet(exploredBounds, options);
        
        // Draw atmosphere glow
        this._drawAtmosphere();
        
        // Draw explored region indicator
        if (exploredBounds) {
            this._drawExploredIndicator(exploredBounds);
        }
        
        // Draw info overlay
        this._drawInfoOverlay(chunks, exploredBounds);
        
        return this.canvas.toDataURL('image/png');
    }
    
    /**
     * Calculate bounds of explored chunks in world coordinates
     */
    _calculateExploredBounds(chunks) {
        if (!chunks || chunks.size === 0) return null;
        
        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        
        for (const key of chunks.keys()) {
            const [cx, cy, cz] = key.split(',').map(Number);
            const worldX = cx * 32;  // CHUNK_SIZE
            const worldZ = cz * 32;
            
            minX = Math.min(minX, worldX);
            maxX = Math.max(maxX, worldX + 32);
            minZ = Math.min(minZ, worldZ);
            maxZ = Math.max(maxZ, worldZ + 32);
        }
        
        return { minX, maxX, minZ, maxZ };
    }
    
    /**
     * Draw starfield background
     */
    _drawSpaceBackground() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        
        // Dark space gradient
        const gradient = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w);
        gradient.addColorStop(0, '#0a0a18');
        gradient.addColorStop(1, '#000008');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
        
        // Stars
        const starCount = 150;
        for (let i = 0; i < starCount; i++) {
            const x = this._seededRandom(i * 3) * w;
            const y = this._seededRandom(i * 3 + 1) * h;
            const size = this._seededRandom(i * 3 + 2) * 1.5 + 0.5;
            const brightness = 0.3 + this._seededRandom(i * 7) * 0.7;
            
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${brightness})`;
            ctx.fill();
        }
    }
    
    /**
     * Draw the planet sphere with procedural terrain
     */
    _drawPlanet(exploredBounds, options = {}) {
        const ctx = this.ctx;
        const cx = this.width / 2;
        const cy = this.height / 2;
        const r = GLOBE_RADIUS;
        
        // Create offscreen canvas for sphere rendering
        const sphereCanvas = document.createElement('canvas');
        sphereCanvas.width = r * 2;
        sphereCanvas.height = r * 2;
        const sphereCtx = sphereCanvas.getContext('2d');
        const imageData = sphereCtx.createImageData(r * 2, r * 2);
        const data = imageData.data;
        
        // Render each pixel of the sphere
        for (let py = 0; py < r * 2; py++) {
            for (let px = 0; px < r * 2; px++) {
                const dx = px - r;
                const dy = py - r;
                const distSq = dx * dx + dy * dy;
                
                if (distSq > r * r) continue;
                
                // Calculate 3D position on sphere
                const z = Math.sqrt(r * r - distSq);
                
                // Normalize to get sphere surface point
                const nx = dx / r;
                const ny = dy / r;
                const nz = z / r;
                
                // Apply rotation
                const rotatedX = nx * Math.cos(this.rotation) + nz * Math.sin(this.rotation);
                const rotatedZ = -nx * Math.sin(this.rotation) + nz * Math.cos(this.rotation);
                
                // Convert to lat/lon
                const lat = Math.asin(ny);
                const lon = Math.atan2(rotatedX, rotatedZ);
                
                // Get terrain color at this position
                const color = this._getTerrainColor(lat, lon, exploredBounds);
                
                // Apply lighting (simple diffuse)
                const lightDir = { x: 0.5, y: -0.3, z: 0.8 };
                const lightLen = Math.sqrt(lightDir.x**2 + lightDir.y**2 + lightDir.z**2);
                lightDir.x /= lightLen; lightDir.y /= lightLen; lightDir.z /= lightLen;
                
                const dot = nx * lightDir.x + ny * lightDir.y + nz * lightDir.z;
                const lighting = Math.max(0.2, Math.min(1.0, dot * 0.6 + 0.5));
                
                // Apply fresnel rim lighting
                const rim = 1 - nz;
                const rimLight = Math.pow(rim, 3) * 0.3;
                
                const idx = (py * r * 2 + px) * 4;
                data[idx] = Math.min(255, color[0] * lighting + rimLight * 100);
                data[idx + 1] = Math.min(255, color[1] * lighting + rimLight * 150);
                data[idx + 2] = Math.min(255, color[2] * lighting + rimLight * 255);
                data[idx + 3] = 255;
            }
        }
        
        sphereCtx.putImageData(imageData, 0, 0);
        
        // Draw sphere to main canvas
        ctx.drawImage(sphereCanvas, cx - r, cy - r);
    }
    
    /**
     * Get terrain color based on lat/lon using procedural noise
     */
    _getTerrainColor(lat, lon, exploredBounds) {
        // Use simplex-like noise for terrain
        const scale1 = 3.0;
        const scale2 = 8.0;
        const scale3 = 20.0;
        
        const noise1 = this._noise2D(lon * scale1, lat * scale1);
        const noise2 = this._noise2D(lon * scale2, lat * scale2) * 0.5;
        const noise3 = this._noise2D(lon * scale3, lat * scale3) * 0.25;
        
        let elevation = (noise1 + noise2 + noise3) / 1.75;
        
        // Latitude-based temperature
        const absLat = Math.abs(lat);
        const temperature = 1.0 - absLat / (Math.PI / 2);
        
        // Determine biome
        let color;
        
        if (elevation < -0.1) {
            // Deep ocean
            color = TERRAIN_COLORS.deepOcean;
        } else if (elevation < 0.05) {
            // Ocean
            const t = (elevation + 0.1) / 0.15;
            color = this._lerpColor(TERRAIN_COLORS.deepOcean, TERRAIN_COLORS.ocean, t);
        } else if (elevation < 0.1) {
            // Beach/coast
            color = TERRAIN_COLORS.beach;
        } else if (elevation < 0.5) {
            // Land biomes based on temperature
            if (temperature < 0.2) {
                color = absLat > 1.2 ? TERRAIN_COLORS.ice : TERRAIN_COLORS.tundra;
            } else if (temperature < 0.4) {
                color = TERRAIN_COLORS.forest;
            } else if (temperature > 0.8) {
                color = TERRAIN_COLORS.desert;
            } else {
                color = TERRAIN_COLORS.grass;
            }
        } else if (elevation < 0.7) {
            // Mountains
            color = TERRAIN_COLORS.mountain;
        } else {
            // Snow caps
            color = TERRAIN_COLORS.snow;
        }
        
        // Check if this is in the explored region
        if (exploredBounds) {
            const worldX = lon * PLANET_RADIUS_KM;
            const worldZ = lat * PLANET_RADIUS_KM;
            
            // Scale down to match chunk coordinates
            const scaleFactor = 0.0001;  // Approximate scale
            const checkX = worldX * scaleFactor;
            const checkZ = worldZ * scaleFactor;
            
            const inExplored = 
                checkX >= exploredBounds.minX && checkX <= exploredBounds.maxX &&
                checkZ >= exploredBounds.minZ && checkZ <= exploredBounds.maxZ;
            
            if (inExplored) {
                // Highlight explored area with slight glow
                return [
                    Math.min(255, color[0] + 30),
                    Math.min(255, color[1] + 40),
                    Math.min(255, color[2] + 20)
                ];
            }
        }
        
        return color;
    }
    
    /**
     * Draw atmospheric glow around planet
     */
    _drawAtmosphere() {
        const ctx = this.ctx;
        const cx = this.width / 2;
        const cy = this.height / 2;
        const r = GLOBE_RADIUS;
        
        // Outer atmosphere glow
        const gradient = ctx.createRadialGradient(cx, cy, r * 0.95, cx, cy, r * 1.15);
        gradient.addColorStop(0, 'rgba(100, 180, 255, 0.3)');
        gradient.addColorStop(0.5, 'rgba(80, 150, 255, 0.15)');
        gradient.addColorStop(1, 'rgba(60, 120, 255, 0)');
        
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.15, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
    }
    
    /**
     * Draw indicator showing explored region on globe
     */
    _drawExploredIndicator(bounds) {
        const ctx = this.ctx;
        const cx = this.width / 2;
        const cy = this.height / 2;
        
        // Draw a marker/pin at approximate explored location
        const markerX = cx + 20;
        const markerY = cy - 30;
        
        // Pulsing glow effect
        ctx.beginPath();
        ctx.arc(markerX, markerY, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 100, 100, 0.6)';
        ctx.fill();
        
        ctx.beginPath();
        ctx.arc(markerX, markerY, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ff4444';
        ctx.fill();
        
        // "You are here" line
        ctx.strokeStyle = 'rgba(255, 100, 100, 0.8)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(markerX + 10, markerY);
        ctx.lineTo(markerX + 40, markerY - 20);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Label
        ctx.font = '10px "Space Grotesk", sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillText('You are here', markerX + 45, markerY - 16);
    }
    
    /**
     * Draw info overlay with world stats
     */
    _drawInfoOverlay(chunks, bounds) {
        const ctx = this.ctx;
        
        // Planet name/info in corner
        ctx.font = 'bold 14px "Space Grotesk", sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillText('PARTICLE REALMS', 12, 20);
        
        ctx.font = '10px "Space Grotesk", sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.fillText(`Planet Radius: ${(PLANET_RADIUS_KM / 1000).toFixed(0)}K km`, 12, 34);
        
        if (chunks && chunks.size > 0) {
            ctx.fillText(`Explored: ${chunks.size} chunks`, 12, 48);
        }
        
        if (bounds) {
            const exploredKm = Math.max(
                (bounds.maxX - bounds.minX) / 1000,
                (bounds.maxZ - bounds.minZ) / 1000
            ).toFixed(1);
            ctx.fillText(`Area: ~${exploredKm} km²`, 12, 62);
        }
        
        // Scale indicator
        const scaleY = this.height - 15;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.fillRect(this.width - 70, scaleY, 50, 2);
        ctx.font = '8px "Space Grotesk", sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fillText('~1000 km', this.width - 70, scaleY - 4);
    }
    
    /**
     * Simple 2D noise function
     */
    _noise2D(x, y) {
        const key = `${Math.floor(x * 100)},${Math.floor(y * 100)}`;
        if (this.noiseCache.has(key)) {
            return this.noiseCache.get(key);
        }
        
        // Simple hash-based noise
        const n = Math.sin(x * 12.9898 + y * 78.233 + this.seed) * 43758.5453;
        const value = n - Math.floor(n);
        const result = value * 2 - 1;
        
        this.noiseCache.set(key, result);
        if (this.noiseCache.size > 10000) {
            this.noiseCache.clear();
        }
        
        return result;
    }
    
    /**
     * Seeded random for consistent star placement
     */
    _seededRandom(n) {
        const x = Math.sin(n * 12.9898 + this.seed * 0.001) * 43758.5453;
        return x - Math.floor(x);
    }
    
    /**
     * Linear interpolate between two colors
     */
    _lerpColor(a, b, t) {
        return [
            Math.floor(a[0] + (b[0] - a[0]) * t),
            Math.floor(a[1] + (b[1] - a[1]) * t),
            Math.floor(a[2] + (b[2] - a[2]) * t)
        ];
    }
}

export default PlanetPreviewRenderer;
