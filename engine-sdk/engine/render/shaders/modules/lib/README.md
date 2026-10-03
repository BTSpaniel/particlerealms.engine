# Shader Library - Modular WGSL Chunks

Universal modular shader library for composing WGSL shaders from reusable chunks.

## Philosophy

Instead of copy-pasting shader code or creating monolithic shaders, this library provides:
- **Reusable chunks**: Small, focused WGSL functions that do one thing well
- **Automatic dependency resolution**: Import what you need, dependencies are resolved automatically
- **Multi-pass support**: Compose complex rendering pipelines from simple building blocks
- **Type safety**: All chunks are validated WGSL that can be composed safely

## Structure

```
lib/
├── noise/           # Noise functions (hash, value, fbm, curl)
├── depth/           # Depth utilities (linearize, reconstruct)
├── density/         # Density/falloff curves
├── lighting/        # Light scattering and phase functions
├── color/           # Color blending modes
├── distortion/      # UV/position warping (domain warp, curl)
├── math/            # Math utilities (interpolation, easing)
└── index.js         # Master index
```

## Quick Start

### Basic Usage

```javascript
import { ShaderComposer } from '../ShaderComposer.js';

const shader = ShaderComposer.compose({
  libs: ['noise/fbm', 'lighting/scatter'],
  vertex: myVertexWGSL,
  fragment: myFragmentWGSL
});
```

### Manual Import

```javascript
import { fbmWGSL, curlNoiseWGSL } from './lib/noise/index.js';
import { lightScatterWGSL } from './lib/lighting/index.js';

const shader = fbmWGSL + curlNoiseWGSL + lightScatterWGSL + myFragmentWGSL;
```

### Multi-Pass Rendering

```javascript
const passes = ShaderComposer.composeMultiPass({
  passes: [
    {
      name: 'depth',
      libs: ['depth/linearize'],
      vertex: depthVertexWGSL,
      fragment: depthFragmentWGSL,
      outputs: ['depthTexture']
    },
    {
      name: 'composite',
      libs: ['noise/fbm', 'lighting/scatter', 'color/blend'],
      vertex: compositeVertexWGSL,
      fragment: compositeFragmentWGSL,
      inputs: ['depthTexture']
    }
  ]
});
```

## Available Libraries

### Noise (`noise/`)

#### `noise/hash`
- `hash2d(p)` - 2D hash function
- `hash3d(p)` - 3D hash function
- `hash2dVec2(p)` - 2D hash returning vec2
- `hash3dVec3(p)` - 3D hash returning vec3
- `hashInt(n)` - Integer hash

#### `noise/value`
- `valueNoise2d(p)` - Smooth 2D value noise
- `valueNoise3d(p)` - Smooth 3D value noise
- `ridgedNoise2d(p)` - 2D ridged noise (sharp creases)
- `ridgedNoise3d(p)` - 3D ridged noise

#### `noise/fbm`
- `fbm2d(p, octaves)` - 2D Fractal Brownian Motion
- `fbm3d(p, octaves)` - 3D Fractal Brownian Motion
- `ridgedFbm2d(p, octaves)` - 2D ridged FBM (mountains)
- `ridgedFbm3d(p, octaves)` - 3D ridged FBM
- `turbulence2d(p, octaves)` - 2D turbulence (clouds)
- `turbulence3d(p, octaves)` - 3D turbulence

#### `noise/curl`
- `curl2d(p, epsilon)` - 2D curl noise (flow fields)
- `curl3d(p, epsilon)` - 3D curl noise (vorticity)
- `curlFbm2d(p, octaves, epsilon)` - Multi-octave curl
- `curlFbm3d(p, octaves, epsilon)` - Multi-octave 3D curl

### Depth (`depth/`)

#### `depth/linearize`
- `linearizeDepth(depth, near, far)` - OpenGL style
- `linearizeDepthWebGPU(depth, near, far)` - WebGPU [0,1]
- `normalizeLinearDepth(linearDepth, near, far)` - To [0,1]
- `logDepth(depth, far)` - Logarithmic depth
- `reverseLogDepth(logDepth, far)` - Reverse log depth

#### `depth/reconstruct`
- `reconstructViewPos(uv, depth, invProj)` - View-space position
- `reconstructWorldPos(uv, depth, invViewProj)` - World position
- `viewSpaceZ(depth, near, far)` - Fast view Z
- `reconstructViewPosFromRay(...)` - From camera ray

### Density (`density/`)

#### `density/falloff`
- `falloffLinear(dist, radius)` - Linear falloff
- `falloffQuadratic(dist, radius)` - Smooth falloff
- `falloffCubic(dist, radius)` - Smoother falloff
- `falloffSmoothstep(dist, inner, outer)` - S-curve
- `falloffExponential(dist, rate)` - Natural decay
- `falloffGaussian(dist, sigma)` - Gaussian distribution
- `falloffInverseSquare(dist, minDist)` - Physically accurate
- `falloffSoft(dist, inner, outer)` - Solid core + fade
- `falloffLayered(dist, layers, freq)` - Multi-layer density

### Lighting (`lighting/`)

#### `lighting/scatter`
- `phaseHG(cosTheta, g)` - Henyey-Greenstein phase
- `phaseRayleigh(cosTheta)` - Rayleigh scattering (atmosphere)
- `phaseMie(cosTheta, g)` - Mie scattering (fog)
- `phaseDualLobe(cosTheta, gFwd, gBack, weight)` - Forward+back
- `phaseAtmospheric(cosTheta, mieWeight)` - Combined atmospheric
- `inScattering(density, lightDir, viewDir, color, phase)` - In-scatter
- `transmittance(density, extinction, dist)` - Beer-Lambert
- `powderEffect(density, cosTheta, strength)` - Bright edges
- `multipleScattering(density, ambient, strength)` - Ambient bounce
- `fresnelSchlick(cosTheta, f0)` - Fresnel approximation

### Color (`color/`)

#### `color/blend`
- `blendNormal(base, blend, alpha)` - Standard alpha blend
- `blendAdd(base, blend, alpha)` - Additive
- `blendMultiply(base, blend, alpha)` - Multiply
- `blendScreen(base, blend, alpha)` - Screen
- `blendOverlay(base, blend, alpha)` - Overlay
- `blendSoftLight(base, blend, alpha)` - Soft light
- `blendHardLight(base, blend, alpha)` - Hard light
- `blendColorDodge(base, blend, alpha)` - Color dodge
- `blendColorBurn(base, blend, alpha)` - Color burn
- `blendLinearDodge(base, blend, alpha)` - Linear dodge
- `blendLinearBurn(base, blend, alpha)` - Linear burn
- `blendDifference(base, blend, alpha)` - Difference
- `blendExclusion(base, blend, alpha)` - Exclusion
- `blendPremultiplied(base, blend)` - Premultiplied alpha

### Distortion (`distortion/`)

#### `distortion/warp`
- `domainWarp2d(p, strength, octaves)` - 2D domain warp
- `domainWarp3d(p, strength, octaves)` - 3D domain warp
- `domainWarpLayered2d(p, strength, octaves, layers)` - Multi-layer warp
- `domainWarpDirectional2d(p, dir, strength, octaves)` - Directional warp
- `domainWarpSwirl2d(p, center, strength, octaves)` - Swirl distortion

### Math (`math/`)

#### `math/interpolation`
- `smoothstepCubic(edge0, edge1, x)` - Cubic hermite
- `smootherstep(edge0, edge1, x)` - Quintic
- `easeInQuad(t)` - Quadratic ease in
- `easeOutQuad(t)` - Quadratic ease out
- `easeInOutQuad(t)` - Quadratic ease in-out
- `easeInCubic(t)` - Cubic ease in
- `easeOutCubic(t)` - Cubic ease out
- `easeInOutCubic(t)` - Cubic ease in-out
- `easeInExpo(t)` - Exponential ease in
- `easeOutExpo(t)` - Exponential ease out
- `easeOutElastic(t)` - Elastic bounce
- `easeOutBounce(t)` - Bounce effect
- `remap(value, fromMin, fromMax, toMin, toMax)` - Remap range
- `remapClamped(...)` - Remap with clamping

## Examples

### Volumetric Smoke (Multi-Pass)

```javascript
// Pass 1: Depth pre-pass
const depthPass = ShaderComposer.compose({
  libs: ['depth/linearize'],
  vertex: smokeDepthVertexWGSL,
  fragment: smokeDepthFragmentWGSL
});

// Pass 2: Density + scattering
const compositePass = ShaderComposer.compose({
  libs: [
    'noise/fbm',
    'noise/curl',
    'density/falloff',
    'lighting/scatter',
    'color/blend'
  ],
  vertex: smokeVertexWGSL,
  fragment: smokeFragmentWGSL
});
```

### Particle Effects

```javascript
const particleShader = ShaderComposer.compose({
  libs: [
    'noise/fbm',
    'noise/curl',
    'density/falloff',
    'math/interpolation'
  ],
  vertex: particleVertexWGSL,
  fragment: particleFragmentWGSL
});
```

### Procedural Materials

```javascript
const materialShader = ShaderComposer.compose({
  libs: [
    'noise/fbm',
    'distortion/warp',
    'lighting/scatter',
    'color/blend'
  ],
  vertex: materialVertexWGSL,
  fragment: materialFragmentWGSL
});
```

## Best Practices

1. **Import only what you need** - Don't use `fullShaderLibWGSL`, import specific chunks
2. **Use ShaderComposer** - Automatic dependency resolution prevents duplicates
3. **Name your passes** - In multi-pass setups, clear names help debugging
4. **Reuse chunks** - Before writing custom WGSL, check if a chunk already exists
5. **Keep chunks small** - Each chunk should do one thing well

## Adding New Chunks

1. Create chunk file in appropriate category (e.g., `lib/noise/perlin.js`)
2. Export WGSL constant: `export const perlinWGSL = ...`
3. Add to category index (`lib/noise/index.js`)
4. Add to `ShaderComposer.js` LIBRARY_MAP
5. Add dependencies if needed

## Performance Notes

- **Dependency resolution is cheap** - Happens once at shader compilation
- **No runtime overhead** - All chunks are static WGSL strings
- **Dead code elimination** - WGSL compiler removes unused functions
- **Inline everything** - WGSL inlines small functions automatically
