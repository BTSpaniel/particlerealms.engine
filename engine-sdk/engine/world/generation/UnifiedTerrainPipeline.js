// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * UnifiedTerrainPipeline.js - Complete Procedural Geomorphology System
 * 
 * Orchestrates the full terrain generation and simulation pipeline:
 * 
 * 1. TECTONICS (Initialization Phase)
 *    - Clustered Convection plate simulation
 *    - JFA Voronoi for plate boundaries
 *    - Subduction/collision → bedrock heightmap
 * 
 * 2. HYDROLOGY (Real-time Simulation)
 *    - Momentum-based particle erosion
 *    - Meandering river formation
 *    - Sediment transport & deposition
 * 
 * 3. STRATIGRAPHY (LayerMap)
 *    - Multi-layer terrain storage
 *    - Per-material properties
 *    - Talus angle enforcement
 * 
 * 4. THERMAL EROSION (Real-time)
 *    - Material-specific slippage
 *    - Cliff formation
 *    - Scree slopes
 * 
 * Based on: Nick McDonald's research (Clustered Convection, SimpleHydrology, SoilMachine)
 */

import { LayerMap, MATERIAL_ID, MATERIAL_PROPERTIES } from './LayerMap.js';
import { HydraulicErosion } from './HydraulicErosion.js';
import { TectonicSimulation } from './TectonicSimulation.js';
import { ThermalErosion, TALUS_ANGLES } from './ThermalErosion.js';
import { WindSimulation } from '../../sim/world/WindSimulation.js';
import { WindErosion } from './WindErosion.js';
import { degreesToRadians } from '../../core/math/UnitMath.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG = {
    // World dimensions
    worldSize: 1024,
    gridResolution: 256,
    
    // Tectonic phase
    tectonics: {
        enabled: true,
        plateCount: 8,
        segmentCount: 8192,
        simulationSteps: 1000,  // Initial simulation
        mantleStrength: 5.0,
        viscosity: 0.8,
    },
    
    // Hydraulic erosion
    hydrology: {
        enabled: true,
        particlesPerFrame: 256,
        erosionRate: 0.3,
        depositionRate: 0.3,
        inertia: 0.3,  // Low = more meandering
    },
    
    // Thermal erosion
    thermal: {
        enabled: true,
        iterationsPerFrame: 2,
        transferRate: 0.5,
    },
    
    // Stratigraphy
    stratigraphy: {
        enabled: true,
        maxLayers: 16,
    },
    
    // Vegetation feedback
    vegetation: {
        enabled: true,
        growthRate: 0.01,
        waterBoost: 2.0,
    },
    
    // Wind simulation (LBM)
    wind: {
        enabled: true,
        gridSize: 256,
        tau: 0.6,
        speed: 0.1,
        angle: 45,  // degrees
    },
    
    // Wind erosion (aeolian)
    windErosion: {
        enabled: true,
        particleCount: 4096,
        abrasionRate: 0.01,
        suspensionRate: 0.02,
        depositionRate: 0.01,
        roughness: 0.5,
    },
};

// ============================================================================
// MAIN CLASS
// ============================================================================

/**
 * UnifiedTerrainPipeline - Orchestrates all terrain generation systems
 */
export class UnifiedTerrainPipeline {
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.device = null;
        this.initialized = false;
        
        // Sub-systems
        this.tectonics = null;
        this.hydrology = null;
        this.thermal = null;
        this.layerMap = null;
        this.wind = null;           // LBM wind simulation
        this.windErosion = null;    // Aeolian erosion
        
        // Shared textures
        this.heightmapTexture = null;
        this.materialMapTexture = null;
        this.vegetationTexture = null;
        this.waterFlowTexture = null;
        
        // State
        this.phase = 'idle';  // 'idle', 'tectonics', 'erosion', 'ready'
        this.tectonicProgress = 0;
        this.simulationTime = 0;
        
        // Stats
        this.stats = {
            tectonicSteps: 0,
            erosionParticles: 0,
            thermalIterations: 0,
            frameTimeMs: 0,
        };
        
        // Callbacks
        this.onPhaseChange = null;
        this.onProgress = null;
    }
    
    /**
     * Initialize all GPU resources and sub-systems
     * @param {GPUDevice} device 
     */
    async init(device) {
        this.device = device;
        const cfg = this.config;
        
        console.log('[UnifiedTerrainPipeline] Initializing...');
        
        // Create shared heightmap texture
        this.heightmapTexture = device.createTexture({
            label: 'Unified Heightmap',
            size: [cfg.gridResolution, cfg.gridResolution],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | 
                   GPUTextureUsage.STORAGE_BINDING |
                   GPUTextureUsage.COPY_SRC |
                   GPUTextureUsage.COPY_DST,
        });
        
        // Create material map
        this.materialMapTexture = device.createTexture({
            label: 'Material Map',
            size: [cfg.gridResolution, cfg.gridResolution],
            format: 'r32uint',
            usage: GPUTextureUsage.TEXTURE_BINDING | 
                   GPUTextureUsage.STORAGE_BINDING |
                   GPUTextureUsage.COPY_DST,
        });
        
        // Create vegetation texture
        this.vegetationTexture = device.createTexture({
            label: 'Vegetation Map',
            size: [cfg.gridResolution, cfg.gridResolution],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | 
                   GPUTextureUsage.STORAGE_BINDING |
                   GPUTextureUsage.COPY_DST,
        });
        
        // Create water flow accumulation texture
        this.waterFlowTexture = device.createTexture({
            label: 'Water Flow Map',
            size: [cfg.gridResolution, cfg.gridResolution],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | 
                   GPUTextureUsage.STORAGE_BINDING |
                   GPUTextureUsage.COPY_DST,
        });
        
        // Initialize sub-systems
        if (cfg.tectonics.enabled) {
            this.tectonics = new TectonicSimulation();
            this.tectonics.config = {
                ...this.tectonics.config,
                worldSize: cfg.worldSize,
                gridResolution: cfg.gridResolution,
                plateCount: cfg.tectonics.plateCount,
                segmentCount: cfg.tectonics.segmentCount,
                mantleStrength: cfg.tectonics.mantleStrength,
                viscosity: cfg.tectonics.viscosity,
            };
            await this.tectonics.init(device);
        }
        
        if (cfg.hydrology.enabled) {
            this.hydrology = new HydraulicErosion();
            this.hydrology.config = {
                ...this.hydrology.config,
                terrainSize: cfg.gridResolution,
                terrainScale: cfg.worldSize / cfg.gridResolution,
                erosionRate: cfg.hydrology.erosionRate,
                depositionRate: cfg.hydrology.depositionRate,
                inertia: cfg.hydrology.inertia,
            };
            await this.hydrology.init(device, this.heightmapTexture, this.vegetationTexture);
        }
        
        if (cfg.thermal.enabled) {
            this.thermal = new ThermalErosion();
            this.thermal.config = {
                ...this.thermal.config,
                gridSize: cfg.gridResolution,
                gridScale: cfg.worldSize / cfg.gridResolution,
                iterations: cfg.thermal.iterationsPerFrame,
                transferRate: cfg.thermal.transferRate,
            };
            await this.thermal.init(device, this.heightmapTexture, this.materialMapTexture);
        }
        
        if (cfg.stratigraphy.enabled) {
            this.layerMap = new LayerMap(cfg.gridResolution);
            await this.layerMap.init(device);
        }
        
        // Initialize wind simulation (LBM)
        if (cfg.wind?.enabled) {
            const angleRad = degreesToRadians(Number(cfg.wind.angle || 0));
            const speed = cfg.wind.speed || 0.1;
            this.wind = new WindSimulation({
                gridSizeX: cfg.wind.gridSize || cfg.gridResolution,
                gridSizeY: cfg.wind.gridSize || cfg.gridResolution,
                tau: cfg.wind.tau || 0.6,
                windSpeed: [Math.cos(angleRad) * speed, Math.sin(angleRad) * speed],
            });
            await this.wind.init(device, this.heightmapTexture);
            console.log('[UnifiedTerrainPipeline] Wind simulation (LBM) initialized');
        }
        
        // Initialize wind erosion (aeolian)
        if (cfg.windErosion?.enabled) {
            const angleRad = degreesToRadians(Number(cfg.wind?.angle || 0));
            const speed = cfg.wind?.speed || 0.1;
            this.windErosion = new WindErosion({
                gridSize: cfg.gridResolution,
                gridScale: cfg.worldSize / cfg.gridResolution,
                particleCount: cfg.windErosion.particleCount || 4096,
                windSpeed: [Math.cos(angleRad) * speed, Math.sin(angleRad) * speed],
                abrasionRate: cfg.windErosion.abrasionRate || 0.01,
                suspensionRate: cfg.windErosion.suspensionRate || 0.02,
                depositionRate: cfg.windErosion.depositionRate || 0.01,
                roughness: cfg.windErosion.roughness || 0.5,
            });
            await this.windErosion.init(device, this.heightmapTexture);
            console.log('[UnifiedTerrainPipeline] Wind erosion initialized');
        }
        
        this.initialized = true;
        this.phase = 'ready';
        console.log('[UnifiedTerrainPipeline] Initialized successfully');
    }
    
    /**
     * Generate initial terrain using tectonic simulation
     * This is a one-time initialization that runs many steps
     * @param {number} steps - Number of tectonic simulation steps
     * @param {Function} progressCallback - Called with progress (0-1)
     */
    async generateTectonicBase(steps = null, progressCallback = null) {
        if (!this.tectonics) {
            console.warn('[UnifiedTerrainPipeline] Tectonics not enabled');
            return;
        }
        
        const totalSteps = steps ?? this.config.tectonics.simulationSteps;
        this.phase = 'tectonics';
        this.tectonicProgress = 0;
        
        console.log(`[UnifiedTerrainPipeline] Running ${totalSteps} tectonic steps...`);
        
        // Initialize random plates
        this.tectonics.initializeRandom();
        
        // Run simulation in batches to avoid GPU timeout
        const batchSize = 10;
        for (let i = 0; i < totalSteps; i += batchSize) {
            const encoder = this.device.createCommandEncoder();
            
            for (let j = 0; j < batchSize && i + j < totalSteps; j++) {
                this.tectonics.step(encoder);
            }
            
            this.device.queue.submit([encoder.finish()]);
            await this.device.queue.onSubmittedWorkDone();
            
            this.tectonicProgress = (i + batchSize) / totalSteps;
            this.stats.tectonicSteps = i + batchSize;
            
            if (progressCallback) {
                progressCallback(this.tectonicProgress);
            }
            
            if (this.onProgress) {
                this.onProgress('tectonics', this.tectonicProgress);
            }
        }
        
        // Copy tectonic heightmap to shared heightmap
        const encoder = this.device.createCommandEncoder();
        encoder.copyTextureToTexture(
            { texture: this.tectonics.getHeightmapTexture() },
            { texture: this.heightmapTexture },
            [this.config.gridResolution, this.config.gridResolution]
        );
        this.device.queue.submit([encoder.finish()]);
        
        this.phase = 'ready';
        console.log('[UnifiedTerrainPipeline] Tectonic generation complete');
        
        if (this.onPhaseChange) {
            this.onPhaseChange('ready');
        }
    }
    
    /**
     * Run one frame of real-time erosion simulation
     * @param {GPUCommandEncoder} encoder 
     * @param {number} dt - Delta time
     * @param {Object} options - Per-frame options
     */
    stepErosion(encoder, dt, options = {}) {
        if (this.phase !== 'ready') return;
        
        const startTime = performance.now();
        
        // Hydraulic erosion
        if (this.hydrology && this.config.hydrology.enabled) {
            // Spawn rain particles
            const spawnCount = options.rainIntensity ?? this.config.hydrology.particlesPerFrame;
            if (spawnCount > 0) {
                // Spawn across terrain
                const halfSize = this.config.worldSize / 2;
                this.hydrology.spawnParticles(
                    encoder,
                    0,  // center X
                    0,  // center Z
                    halfSize,  // radius
                    spawnCount
                );
            }
            
            // Run erosion step
            this.hydrology.step(
                encoder,
                this.heightmapTexture.createView(),
                this.heightmapTexture
            );
            
            this.stats.erosionParticles += spawnCount;
        }
        
        // Thermal erosion
        if (this.thermal && this.config.thermal.enabled) {
            // Copy current heightmap to thermal system
            // (thermal uses ping-pong internally)
            this.thermal.step(encoder);
            
            // Copy result back
            encoder.copyTextureToTexture(
                { texture: this.thermal.getHeightmapTexture() },
                { texture: this.heightmapTexture },
                [this.config.gridResolution, this.config.gridResolution]
            );
            
            this.stats.thermalIterations += this.config.thermal.iterationsPerFrame;
        }
        
        this.simulationTime += dt;
        this.stats.frameTimeMs = performance.now() - startTime;
    }
    
    /**
     * Get the current heightmap for rendering
     */
    getHeightmapTexture() {
        return this.heightmapTexture;
    }
    
    /**
     * Get material map for rendering
     */
    getMaterialMapTexture() {
        return this.materialMapTexture;
    }
    
    /**
     * Get vegetation map
     */
    getVegetationTexture() {
        return this.vegetationTexture;
    }
    
    /**
     * Sample terrain height at world position (CPU-side, requires readback)
     * For real-time use, prefer GPU sampling in shaders
     */
    async sampleHeightAsync(worldX, worldZ) {
        // This would need a GPU readback - expensive
        // Better to use GPU sampling in render shaders
        console.warn('[UnifiedTerrainPipeline] CPU height sampling not implemented - use GPU');
        return 0;
    }
    
    /**
     * Set erosion parameters at runtime
     */
    setErosionParams(params) {
        if (this.hydrology) {
            this.hydrology.setConfig(params);
        }
    }
    
    /**
     * Set thermal erosion parameters
     */
    setThermalParams(params) {
        if (this.thermal) {
            this.thermal.setConfig(params);
        }
    }
    
    /**
     * Get current simulation statistics
     */
    getStats() {
        return {
            ...this.stats,
            phase: this.phase,
            simulationTime: this.simulationTime,
            tectonicProgress: this.tectonicProgress,
        };
    }
    
    /**
     * Reset simulation to initial state
     */
    reset() {
        this.simulationTime = 0;
        this.stats = {
            tectonicSteps: 0,
            erosionParticles: 0,
            thermalIterations: 0,
            frameTimeMs: 0,
        };
        
        if (this.hydrology) {
            this.hydrology.reset();
        }
        
        this.phase = 'ready';
    }
    
    /**
     * Destroy all GPU resources
     */
    destroy() {
        this.tectonics?.destroy();
        this.hydrology?.destroy();
        this.thermal?.destroy();
        this.layerMap?.destroy();
        
        this.heightmapTexture?.destroy();
        this.materialMapTexture?.destroy();
        this.vegetationTexture?.destroy();
        this.waterFlowTexture?.destroy();
        
        this.initialized = false;
        this.phase = 'idle';
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
    LayerMap,
    HydraulicErosion,
    TectonicSimulation,
    ThermalErosion,
    MATERIAL_ID,
    MATERIAL_PROPERTIES,
    TALUS_ANGLES,
};

export default UnifiedTerrainPipeline;
