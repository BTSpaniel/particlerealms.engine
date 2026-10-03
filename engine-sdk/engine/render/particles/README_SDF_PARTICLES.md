# Volumetric SDF Particle System

## Overview

The SDF (Signed Distance Field) particle renderer provides **true volumetric 3D particles** using raymarching. Unlike flat billboards, these particles have proper depth, lighting, and can be shaped as spheres, ellipsoids, capsules, or rounded boxes.

## Key Features

- **Raymarched Volumes**: Each particle is a raymarched 3D shape, not a flat sprite
- **Velocity-Stretched Ellipsoids**: Particles automatically stretch along velocity for motion blur
- **Volumetric Lighting**: Proper diffuse, ambient, rim, and subsurface scattering
- **Soft Edges**: Smooth density falloff for natural blending
- **Multiple Shapes**: Sphere, ellipsoid, capsule, rounded box, torus

## Usage

### Basic Setup

```javascript
import { createParticleSdfRenderer, createParticleSdfDataBindGroup } from './engine/render/particles/ParticleSdfRenderer.js';

// Create renderer
const sdfRenderer = await createParticleSdfRenderer({
    device: gpuDevice,
    format: 'bgra8unorm',
    blendMode: 'alpha'  // or 'additive' for fire/energy
});

// Create bind group (once per particle system)
const sdfBindGroup = createParticleSdfDataBindGroup(
    sdfRenderer,
    particleWorld.positionBuffer,
    particleWorld.metaBuffer,
    particleWorld.velocityBuffer
);

// Render
pass.setPipeline(sdfRenderer.pipeline);
pass.setBindGroup(0, sdfRenderer.frameBindGroup);
pass.setBindGroup(1, sdfBindGroup);
pass.draw(6, particleCount, 0, 0);
```

### Particle Data Format

The SDF renderer uses standard particle buffers:

**Position Buffer** (vec4):
- `xyz`: World position
- `w`: Age

**Meta Buffer** (vec4):
- `xyz`: RGB color
- `w`: Packed size (size * 1e4)

**Velocity Buffer** (vec4):
- `xyz`: Velocity vector
- `w`: Lifetime

### Shape Control

Shapes are automatically selected based on velocity:
- **Stationary particles** → Sphere
- **Moving particles** → Velocity-stretched ellipsoid

Stretch factor = `1.0 + speed * 0.15` (up to 2.5x)

### Presets

#### Smoke (Soft Volumetric Spheres)
```javascript
{
    size: 2.0,
    color: [0.6, 0.6, 0.65],
    blendMode: 'alpha',
    velocity: [0, 1.5, 0],  // Rising
    lifetime: 3.0
}
```

#### Fire (Additive Ellipsoids)
```javascript
{
    size: 1.5,
    color: [1.0, 0.5, 0.1],
    blendMode: 'additive',
    velocity: [0, 3.0, 0],  // Fast rising
    lifetime: 0.8
}
```

#### Steam (Large Soft Spheres)
```javascript
{
    size: 3.0,
    color: [0.95, 0.95, 1.0],
    blendMode: 'alpha',
    velocity: [0, 0.5, 0],  // Slow rise
    lifetime: 4.0
}
```

## Performance

- **24 raymarch steps** per particle
- **Conservative step size**: `d * 0.6` for quality
- **Early termination**: Stops at surface hit
- **Velocity-adaptive**: Only stretches when moving

Typical cost: ~1.5x flat billboard (but far more realistic)

## Comparison: SDF vs Billboard

| Feature | Billboard | SDF Raymarch |
|---------|-----------|--------------|
| Shape | Flat circle | 3D volume |
| Angles | Looks flat from side | Correct from all angles |
| Lighting | View-dependent fake | True 3D lighting |
| Motion blur | None | Velocity-stretched |
| Depth | 2D sprite | True volume |
| Cost | 1x (baseline) | ~1.5x |

## Advanced: Custom Shapes

To add new shapes, edit `particles_sdf_billboard.js`:

1. Add shape constant: `const SHAPE_CAPSULE: u32 = 2u;`
2. Add case to `mapScene()` function
3. Use SDF shape functions from `sdf/shapes` library

## Replacing Broken Fluid Renderer

If your volumetric smoke/fluid renderer is broken, use SDF particles instead:

```javascript
// OLD: Broken fluid voxel renderer
// const fluidRenderer = createFluidRenderer(...);

// NEW: Volumetric SDF particles
const smokeRenderer = await createParticleSdfRenderer({
    device,
    format,
    blendMode: 'alpha'
});

// Emit particles for smoke plumes
emitParticles({
    position: [x, y, z],
    velocity: [0, 2, 0],  // Rising
    size: 2.5,
    color: [0.6, 0.6, 0.7],
    lifetime: 3.0,
    count: 50
});
```

Result: Production-quality volumetric smoke without complex voxel grids.

## Troubleshooting

**Particles look flat**: Increase raymarch steps (edit shader: `maxSteps = 32`)

**Too transparent**: Increase density in shader: `result.density = 1.0 - smoothstep(0.0, shapeScale.x * 0.5, abs(d))`

**Performance issues**: Lower particle count or reduce raymarch steps

**No motion blur**: Check that velocity buffer has non-zero values

## See Also

- `sdf/shapes.js` - SDF primitive library
- `ParticleBillboardRenderer.js` - Original flat billboard renderer
- `EditorParticles.js` - Editor particle system integration
