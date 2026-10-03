# Hybrid Volumetric Rendering System

A unified system for rendering particles, meshes, and voxels as volumetric effects (smoke, water, fog).

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         INPUT SOURCES                            │
├──────────────┬──────────────┬──────────────┬───────────────────┤
│  Particles   │    Meshes    │   Voxels     │    Physics        │
│  (existing)  │  (vertices)  │  (density)   │   (MLS-MPM)       │
└──────┬───────┴──────┬───────┴──────┬───────┴────────┬──────────┘
       │              │              │                │
       ▼              ▼              ▼                ▼
┌─────────────────────────────────────────────────────────────────┐
│              HYBRID VOLUME SYSTEM                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Compute Shader: Splat particles → 3D Density Grid      │    │
│  │  Triple Buffered for smooth updates                      │    │
│  │  Dirty region tracking (only update what changed)        │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              UNIFIED VOLUME RENDERER                             │
├─────────────────┬─────────────────┬─────────────────────────────┤
│   SMOKE MODE    │   WATER MODE    │    DEBUG MODE               │
│   Absorption    │   Isosurface    │    Visualize density        │
│   Scattering    │   Refraction    │                             │
│   Shadows       │   Reflection    │                             │
└─────────────────┴─────────────────┴─────────────────────────────┘
```

## Quick Start

### Option 1: VolumeIntegration (Recommended)

```javascript
import { VolumeIntegration, VolumeRenderMode } from './volumes/index.js';

// Create and initialize
const volume = new VolumeIntegration(device, {
  format: 'bgra8unorm',
  width: 1920,
  height: 1080,
  gridResolution: 64,  // 64³ voxels
  volumeSize: 50,      // 50 world units
});
await volume.init();

// Connect particle system
volume.connectParticles('smoke', {
  positionBuffer: myParticlePositions,
  metaBuffer: myParticleMeta,
  velocityBuffer: myParticleVelocities,
  count: particleCount,
});

// Configure render mode
volume.configureSmokeMode({
  densityScale: 1.5,
  extinction: 2.0,
});
// OR
volume.configureWaterMode({
  isoThreshold: 0.3,
  refractionIndex: 1.33,
  reflectivity: 0.5,
});

// In render loop:
volume.update(encoder, camera);
volume.setSceneTextures(colorTexture, depthTexture);
volume.render(pass, colorTexture, depthTexture);
```

### Option 2: ParticleVolumeConnector (Auto-detection)

```javascript
import { createParticleVolumeConnector } from './volumes/index.js';

// Create connector
const connector = await createParticleVolumeConnector(device, {
  format: 'bgra8unorm',
  gridResolution: 64,
});

// Connect existing particle renderer (auto-detects buffers)
connector.connectRenderer('particles', particleRenderer);

// In render loop:
connector.update(encoder, camera);
connector.render(pass, sceneColor, sceneDepth);
```

### Option 3: Direct HybridVolumeSystem + UnifiedVolumeRenderer

```javascript
import { HybridVolumeSystem, UnifiedVolumeRenderer } from './volumes/index.js';

// Low-level control
const volumeSystem = new HybridVolumeSystem(device, options);
const volumeRenderer = new UnifiedVolumeRenderer(device, options);

await volumeSystem.init();
await volumeRenderer.init();

// Set particle data
volumeSystem.setParticleBuffers(positions, meta, velocities, count);

// Update grid (compute pass)
volumeSystem.update(encoder);

// Connect to renderer
volumeRenderer.setVolumeData(volumeSystem);
volumeRenderer.updateUniforms(camera);

// Render (render pass)
volumeRenderer.render(pass);
```

## Render Modes

### SMOKE (VolumeRenderMode.SMOKE)
- Beer-Lambert absorption
- Henyey-Greenstein phase function
- Light marching for shadows
- Multi-scattering approximation

### WATER (VolumeRenderMode.WATER)
- Isosurface extraction
- Fresnel reflection
- Refraction with scene sampling
- Specular highlights

### DEBUG_DENSITY (VolumeRenderMode.DEBUG_DENSITY)
- Visualize density grid
- Blue (low) to Red (high)

## Adding Meshes as Particles

```javascript
// Use mesh vertices as particle sources
volume.addMesh('character', {
  vertexBuffer: mesh.vertexBuffer,
  colorBuffer: mesh.colorBuffer,
  vertexCount: mesh.vertexCount,
});
```

## Configuration Options

### HybridVolumeSystem
- `gridResolution`: Grid size (default: 64)
- `volumeSize`: World space size (default: 50)
- `splatRadius`: Particle influence radius (default: 1.0)
- `densityScale`: Density multiplier (default: 1.0)
- `colorBlend`: Color contribution (default: 1.0)
- `tripleBuffer`: Use triple buffering (default: true)

### UnifiedVolumeRenderer
- `densityScale`: Visual density (default: 1.0)
- `extinction`: Light absorption (default: 2.0)
- `isoThreshold`: Water surface level (default: 0.3)
- `refractionIndex`: Water IOR (default: 1.33)
- `reflectivity`: Reflection amount (default: 0.5)
- `waterTint`: Water color tint (default: 0.5)

## Files

```
volumes/
├── index.js                    # Main exports
├── HybridVolumeSystem.js       # Core system (compute)
├── UnifiedVolumeRenderer.js    # Multi-mode renderer
├── VolumeIntegration.js        # Easy-use wrapper
├── ParticleVolumeConnector.js  # Auto-connect particles
├── SmokeVolumeRenderer.js      # Legacy smoke renderer
├── IsoSurfaceVolumeRenderer.js # Legacy isosurface
└── README.md                   # This file

shaders/modules/compute/
└── grid_splat.js               # Particle-to-grid compute shaders
```

## Performance Tips

1. **Grid Resolution**: 32³ for mobile, 64³ for desktop, 128³ for high-end
2. **Triple Buffering**: Reduces stalls, uses more memory
3. **Dirty Tracking**: Call `markDirty(pos, radius)` instead of full update
4. **LOD**: Use DualModeRenderer for distance-based particle/volume switching
