# Shader Effects Library

A comprehensive collection of reusable WGSL shader chunks for real-time rendering effects.

## Quick Start

```javascript
import { 
  fireTurbulenceWGSL, 
  electricityWGSL,
  voronoiWGSL 
} from "./ShaderSources.js";

const myShader = `
  ${fireTurbulenceWGSL}
  ${electricityWGSL}
  
  @fragment
  fn main() -> vec4<f32> {
    let fire = calculateFire(worldPos, time, baseColor, 1.0);
    return fire;
  }
`;
```

---

## Table of Contents

1. [Noise Functions](#noise-functions)
2. [SDF Primitives](#sdf-primitives)
3. [Shadows & Ambient Occlusion](#shadows--ambient-occlusion)
4. [Camera Utilities](#camera-utilities)
5. [Ray Intersection](#ray-intersection)
6. [Ray Tracing](#ray-tracing)
7. [Area Lighting](#area-lighting)
8. [Fire & Turbulence](#fire--turbulence)
9. [Magic Effects](#magic-effects)
10. [Electricity & Plasma](#electricity--plasma)
11. [Voronoi & Cellular](#voronoi--cellular)
12. [Temporal AA](#temporal-aa)
13. [Bloom](#bloom)

---

## Noise Functions

### `noise2d.js` / `noise3d.js`

Basic noise building blocks.

```wgsl
fn hash2d(p : vec2<f32>) -> f32
fn noise2d(p : vec2<f32>) -> f32
fn fbm2d(p : vec2<f32>, octaves : i32) -> f32

fn hash3d(p : vec3<f32>) -> f32
fn noise3d(p : vec3<f32>) -> f32
fn fbm3d(p : vec3<f32>, octaves : i32) -> f32
fn fbm3dRotated(p : vec3<f32>, octaves : i32) -> f32  // Reduces banding
fn domainWarp(p : vec3<f32>, strength : f32, scale : f32) -> vec3<f32>
```

---

## SDF Primitives

### `sdf_primitives.js`

Signed distance functions for raymarching.

### Primitives
```wgsl
fn sdSphere(p : vec3<f32>, r : f32) -> f32
fn sdBox(p : vec3<f32>, b : vec3<f32>) -> f32
fn sdPlane(p : vec3<f32>, n : vec3<f32>, h : f32) -> f32
fn sdCapsule(p : vec3<f32>, a : vec3<f32>, b : vec3<f32>, r : f32) -> f32
fn sdTorus(p : vec3<f32>, t : vec2<f32>) -> f32
fn sdRoundBox(p : vec3<f32>, b : vec3<f32>, r : f32) -> f32
```

### Operations
```wgsl
fn opUnion(d1 : f32, d2 : f32) -> f32
fn opSubtract(d1 : f32, d2 : f32) -> f32
fn opIntersect(d1 : f32, d2 : f32) -> f32
fn opSmoothUnion(d1 : f32, d2 : f32, k : f32) -> f32
fn opSmoothSubtract(d1 : f32, d2 : f32, k : f32) -> f32
fn opRound(d : f32, r : f32) -> f32
```

### Transforms
```wgsl
fn opTranslate(p : vec3<f32>, offset : vec3<f32>) -> vec3<f32>
fn opRotateY(p : vec3<f32>, angle : f32) -> vec3<f32>
fn opScale(p : vec3<f32>, s : f32) -> vec3<f32>
fn opRepeat(p : vec3<f32>, period : vec3<f32>) -> vec3<f32>
```

---

## Shadows & Ambient Occlusion

### `shadows_ao.js`

Soft shadows and ambient occlusion for raymarching.

```wgsl
// Soft shadows with penumbra
fn calcSoftShadow(ro : vec3<f32>, rd : vec3<f32>, mint : f32, maxt : f32, k : f32) -> f32

// Ambient occlusion
fn calcAO(pos : vec3<f32>, nor : vec3<f32>) -> f32
fn calcAOHighQuality(pos : vec3<f32>, nor : vec3<f32>, samples : i32) -> f32
```

**Usage:**
```wgsl
let shadow = calcSoftShadow(pos, lightDir, 0.01, 10.0, 8.0);
let ao = calcAO(pos, normal);
let lighting = diffuse * shadow * ao;
```

---

## Camera Utilities

### `camera_utils.js`

Camera matrix and ray generation.

```wgsl
// Build look-at camera matrix
fn getCameraMatrix(ro : vec3<f32>, ta : vec3<f32>, roll : f32) -> mat3x3<f32>

// Generate ray direction from screen UV
fn getRayDirection(uv : vec2<f32>, ro : vec3<f32>, ta : vec3<f32>, fov : f32) -> vec3<f32>

// Screen space utilities
fn screenToUV(fragCoord : vec2<f32>, resolution : vec2<f32>) -> vec2<f32>
fn linearizeDepth(depth : f32, near : f32, far : f32) -> f32
fn reconstructWorldPos(uv : vec2<f32>, depth : f32, invViewProj : mat4x4<f32>) -> vec3<f32>
```

---

## Ray Intersection

### `ray_intersect.js`

Analytic ray-primitive intersection tests.

```wgsl
struct RayHit {
  dist : f32,
  normal : vec3<f32>,
}

fn iPlane(ro, rd, planeNormal, planeDist) -> RayHit
fn iSphere(ro, rd, radius) -> RayHit
fn iBox(ro, rd, boxSize) -> RayHit
fn iRoundedBox(ro, rd, boxSize, radius) -> RayHit
fn iCylinder(ro, rd, pa, pb, radius) -> RayHit
fn iCapsule(ro, rd, pa, pb, radius) -> RayHit
fn iCone(ro, rd, pa, pb, ra, rb) -> RayHit
fn iEllipsoid(ro, rd, radii) -> RayHit
fn iTorus(ro, rd, majorRadius, minorRadius) -> RayHit
fn iTriangle(ro, rd, v0, v1, v2) -> RayHit
fn iQuad(ro, rd, v0, v1, v2, v3) -> RayHit
```

**Usage:**
```wgsl
let hit = iSphere(rayOrigin - spherePos, rayDir, 1.0);
if (hit.dist < MAX_RAY_DIST) {
  let hitPoint = rayOrigin + rayDir * hit.dist;
  let normal = hit.normal;
}
```

---

## Ray Tracing

### `ray_tracing.js`

Path tracing utilities, materials, and sampling.

### Random Sampling
```wgsl
fn randomFloat(seed : ptr<function, u32>) -> f32
fn sampleHemisphereCosine(normal, seed) -> vec3<f32>  // Diffuse
fn sampleGGX(normal, roughness, seed) -> vec3<f32>    // Specular
fn sampleDisk(seed) -> vec2<f32>                       // DOF
```

### Materials
```wgsl
const MAT_LAMBERTIAN : u32 = 0u;  // Diffuse
const MAT_METAL : u32 = 1u;       // Reflective
const MAT_DIELECTRIC : u32 = 2u;  // Glass
const MAT_EMISSIVE : u32 = 3u;    // Light

struct Material {
  albedo : vec3<f32>,
  matType : u32,
  roughness : f32,
  ior : f32,
  emission : vec3<f32>,
}

fn scatterRay(rayDir, normal, material, seed) -> vec3<f32>
fn getMaterialAttenuation(rayDir, normal, material) -> vec3<f32>
```

### Environment
```wgsl
fn sampleSkyGradient(rd, skyColor, horizonColor, groundColor) -> vec3<f32>
fn samplePhysicalSky(rd, sunDir, sunColor) -> vec3<f32>
```

### Utilities
```wgsl
fn fresnelSchlickRT(cosTheta, f0) -> f32
fn russianRoulette(throughput, seed) -> bool
fn toneMapACES(color) -> vec3<f32>
fn toneMapReinhard(color) -> vec3<f32>
```

---

## Area Lighting

### `area_lighting.js`

Physically-based area lights and soft shadows.

### Sphere Occlusion
```wgsl
// AO from spherical occluder
fn sphOcclusion(pos, nor, sph) -> f32
fn multiSphereOcclusion(pos, nor, spheres[], count) -> f32
```

### Soft Shadows
```wgsl
// Physically accurate soft shadow from sphere light + sphere occluder
fn sphAreaShadow(P, light, occluder) -> f32  // 0 = shadow, 1 = lit

// Faster approximation
fn sphSoftShadowSimple(P, lightPos, lightRadius, occCenter, occRadius) -> f32
```

### Area Lights
```wgsl
fn sphAreaLight(P, N, light) -> f32                    // Basic sphere light
fn sphAreaLightIntensity(P, N, light, intensity) -> f32 // With falloff
fn diskAreaLight(P, N, center, normal, radius) -> f32   // Disk light
```

### Ground Effects
```wgsl
fn floorOcclusion(P, N, floorY) -> f32   // Ground plane AO
fn contactShadow(P, floorY, radius) -> f32
```

---

## Fire & Turbulence

### `fire_turbulence.js`

Fire, flames, and turbulent motion effects.

### Turbulence
```wgsl
// Multi-octave position distortion
fn fireTurbulence(pos, time, octaves) -> vec3<f32>
fn fireTurbulenceFast(pos, time) -> vec3<f32>  // 3 octaves, faster
```

### Transforms
```wgsl
fn twistPosition(pos, twistRate) -> vec3<f32>      // Spiral rotation
fn expandUpward(pos, rate, minScale) -> vec3<f32>  // Fire spread
```

### Fire Shape
```wgsl
fn flameShapeSDF(pos, coneSlope, radius) -> f32  // Hollow cone
fn flameMask(sdf, softness) -> f32
```

### Colors
```wgsl
// Blackbody radiation: white → yellow → orange → red → black
fn fireColorGradient(heat) -> vec3<f32>

// Custom palette
fn fireColorCustom(heat, hotColor, midColor, coolColor) -> vec3<f32>

// Flickering
fn fireFlicker(pos, time, intensity) -> f32
```

### Complete Effect
```wgsl
fn calculateFire(worldPos, time, baseColor, emissiveIntensity) -> vec4<f32>
```

**Usage:**
```wgsl
let fire = calculateFire(worldPos, time, vec3(1.0, 0.5, 0.1), 2.0);
color = mix(sceneColor, fire.rgb, fire.a);
```

---

## Magic Effects

### `magic_effects.js`

Magical orbs, portals, shields, and energy effects.

### Patterns
```wgsl
fn energySwirl(pos, time, arms) -> f32        // Rotating arms
fn energyRings(pos, time, frequency, speed) -> f32
fn arcaneRunes(pos, time, symmetry) -> f32    // Geometric glyphs
fn hexPattern(pos, scale) -> f32              // Shield grid
```

### Sparkles
```wgsl
fn sparkleField(pos, time, threshold) -> f32  // Random glints (0 or 1)
fn sparkleSoft(pos, time, density) -> f32     // Soft sparkles
```

### Portal/Vortex
```wgsl
fn portalRing(pos, time, innerRadius, outerRadius) -> f32
fn vortexDistort(pos, center, strength, time) -> vec2<f32>
```

### Pulse
```wgsl
fn magicPulse(time, speed, minVal, maxVal) -> f32
fn magicPulseDouble(time, speed1, speed2) -> f32  // More organic
```

### Colors
```wgsl
fn hueShift(color, shift) -> vec3<f32>
fn rainbowColor(phase) -> vec3<f32>
fn mysticalColor(t, baseColor) -> vec3<f32>  // Cool magical tones
```

### Complete Effect
```wgsl
fn calculateMagicOrb(worldPos, viewDir, normal, time, baseColor, intensity) -> vec4<f32>
```

---

## Electricity & Plasma

### `electricity.js`

Lightning, plasma, and electrical effects.

### Simplex Noise
```wgsl
fn simplex3d(p) -> f32              // Single octave
fn simplexFbm(p, octaves) -> f32    // Multi-octave
fn electricNoise(p) -> f32          // Standard 4-octave
```

### Glow
```wgsl
fn plasmaGlow(dist, falloff) -> f32        // Sharp intensity
fn plasmaGlowInverse(dist, falloff) -> f32
fn electricGlow(dist, coreSize, glowSize) -> f32
```

### Colors
```wgsl
// Classic plasma intensification (x^4 color)
fn plasmaColor(intensity, baseColor) -> vec3<f32>

fn electricColor(dist, coreColor, coronaColor, coreSize) -> vec3<f32>
fn plasmaTemperature(temp) -> vec3<f32>  // Blue → white gradient
```

### Lightning
```wgsl
fn electricArc(uv, time, frequency, amplitude) -> f32
fn lightningBolt(uv, time, segments, branchProb) -> f32
fn arcBetweenPoints(uv, p1, p2, time, thickness) -> f32
```

### Fields
```wgsl
fn plasmaField(uv, time, scale) -> f32
fn horizontalPlasma(uv, time) -> f32     // Concentrated center
fn sphericalPlasma(pos, center, time, radius) -> f32
```

### Complete Effects
```wgsl
fn renderElectricity(uv, time, baseColor) -> vec3<f32>
fn renderElectricArc(uv, time, arcColor, glowColor) -> vec3<f32>
fn renderLightning(uv, time, boltColor) -> vec3<f32>
```

---

## Voronoi & Cellular

### `voronoi.js`

Cellular noise, organic patterns, and volumetric clouds.

### Voronoi
```wgsl
// Returns (distance, cellId)
fn voronoi2d(p, time) -> vec2<f32>

// Smooth blended edges (w = smoothness 0-1)
fn voronoiSmooth(p, w, time) -> vec2<f32>

// Cell edge detection
fn voronoiEdges(p, time) -> f32
```

### Rings
```wgsl
fn ringPattern(p, time, spacing, noiseAmount) -> f32
fn ringPatternSmooth(p, time, spacing, width) -> f32
```

### Coordinates
```wgsl
fn toPolar(v) -> vec2<f32>      // (angle, radius)
fn toCartesian(polar) -> vec2<f32>
```

### Combined Effects
```wgsl
fn portalTexture(p, time, fade) -> f32        // Voronoi + rings
fn energyRingsVoronoi(p, time, fade) -> f32
```

### Clouds
```wgsl
fn cloudDensity(p, time) -> f32
fn cloudSDF(p, time, radius) -> f32
fn cloudShading(depth, minLight, scale) -> f32
```

### Cylinder Mapping
```wgsl
fn cylinderUV(pos, height) -> vec2<f32>
fn cylinderSeamlessVoronoi(pos, height, time) -> f32  // No seam!
```

---

## Temporal AA

### `temporal_aa.js`

Temporal anti-aliasing utilities.

### Jitter Sequences
```wgsl
fn halton23(index) -> vec2<f32>          // [0,1] range
fn halton23Centered(index) -> vec2<f32>  // [-0.5, 0.5] range
fn r2Sequence(index) -> vec2<f32>        // Alternative sequence
```

### Color Space
```wgsl
fn rgb2YCoCg(rgb) -> vec3<f32>  // Better for clamping
fn yCoCg2Rgb(yCoCg) -> vec3<f32>
```

### Neighborhood Clamping
```wgsl
fn clipToBox(p, boxMin, boxMax) -> vec3<f32>
fn clampToNeighborhoodYCoCg(history, current, neighbors[]) -> vec3<f32>
```

### History Sampling
```wgsl
fn catmullRomWeights(t) -> vec4<f32>
fn catmullRomWeightsOptimized(t) -> vec3<f32>
```

### Reprojection
```wgsl
fn reprojectWorldPos(worldPos, prevViewProj) -> vec2<f32>
fn calcMotionVector(currentUV, worldPos, prevViewProj) -> vec2<f32>
fn isValidReproject(uv) -> bool
```

### Blending
```wgsl
fn taaBlend(current, history, blendFactor, isValid) -> vec3<f32>
fn velocityBasedBlend(velocity, baseBlend, scale) -> f32
fn luminanceBasedBlend(currLuma, histLuma, blend, threshold) -> f32
```

### Sharpening
```wgsl
fn sharpen3x3(center, neighbors[], sharpness) -> vec3<f32>
fn sharpenAdaptive(center, neighbors[], sharpness) -> vec3<f32>
```

---

## Bloom

### `bloom.js`

Multi-pass bloom post-processing.

### Shaders
- `bloomThresholdWGSL` - Extract bright pixels
- `bloomBlurWGSL` - Separable Gaussian blur
- `bloomCompositeWGSL` - Blend with original
- `bloomSinglePassWGSL` - Fast single-pass approximation

### Uniforms
```wgsl
struct BloomParams {
  threshold : f32,   // Brightness threshold
  softKnee : f32,    // Soft threshold transition
  intensity : f32,   // Bloom strength
  radius : f32,      // Blur radius (single-pass)
  texelSize : vec2<f32>,
  direction : vec2<f32>,  // Blur direction
}
```

---

## Anime Explosion

### `anime_explosion.js`

Stylized explosion effects with anime/manga aesthetics.

### Burst Shapes
```wgsl
fn spikyBurst(uv, spikes, sharpness) -> f32   // Star burst
fn explosionBurst(uv, time, phase) -> f32     // Irregular explosion
fn explosionCore(uv, phase) -> f32            // Bright center
```

### Impact Rays
```wgsl
fn impactRays(uv, rayCount, time, phase) -> f32     // Speed lines
fn dramaticRays(uv, rayCount, thickness, phase) -> f32  // Thick rays
```

### Shockwaves
```wgsl
fn shockwaveRing(uv, time, speed, thickness) -> f32
fn multiShockwave(uv, time, count) -> f32
fn distortedShockwave(uv, time) -> f32
```

### Anime Colors
```wgsl
// Discrete color banding (anime style)
fn animeColorBand(intensity, steps) -> f32

// Classic fire explosion: white → yellow → orange → red → black
fn animeExplosionColor(intensity, phase) -> vec3<f32>

// Energy blast: white → cyan → blue
fn energyBlastColor(intensity) -> vec3<f32>
```

### Debris & Sparks
```wgsl
fn debrisParticles(uv, time, count) -> f32  // Flying chunks
fn sparkTrails(uv, time, count) -> f32      // Bright spark lines
```

### Smoke
```wgsl
fn smokePuff(uv, center, size, time) -> f32
fn smokeColumn(uv, time, phase) -> f32
```

### Complete Effects
```wgsl
struct AnimeExplosionResult {
  color : vec3<f32>,
  alpha : f32,
  emission : f32,
}

// Full anime explosion with all elements
fn renderAnimeExplosion(uv, time, duration) -> AnimeExplosionResult

// Energy beam impact
fn renderEnergyBlast(uv, time) -> AnimeExplosionResult
```

**Usage:**
```wgsl
let explosion = renderAnimeExplosion(uv - explosionCenter, time, 1.0);
color = mix(sceneColor, explosion.color, explosion.alpha);
color += explosion.color * explosion.emission;  // Add bloom
```

---

## Quaternion Math

### `quaternion.js`

Full quaternion operations for skeletal animation.

### Basic Operations
```wgsl
fn quatConjugate(q) -> vec4      // Negate xyz
fn quatInverse(q) -> vec4        // Reverse rotation
fn quatMul(a, b) -> vec4         // Hamilton product
fn quatNormalize(q) -> vec4      // Unit quaternion
```

### Interpolation
```wgsl
fn quatNlerp(a, b, t) -> vec4    // Fast (normalized lerp)
fn quatSlerp(a, b, t) -> vec4    // Smooth (spherical lerp)
```

### Create from Axis-Angle
```wgsl
fn quatFromAxisAngle(axis, angle) -> vec4
fn quatRotateX(angle) -> vec4
fn quatRotateY(angle) -> vec4
fn quatRotateZ(angle) -> vec4
```

### Point Rotation
```wgsl
fn rotatePoint(p, center, q) -> vec3       // Around center
fn rotatePointOrigin(p, q) -> vec3         // Around origin
fn rotateDirection(dir, q) -> vec3         // Direction only
```

### Matrix Conversion
```wgsl
fn quatToMatrix(q, offset) -> mat4x4       // Model matrix
fn quatToMatrix3(q) -> mat3x3              // Rotation only
fn quatToMatrixInverse(q, offset) -> mat4x4  // Inverse
```

### Direction-Based
```wgsl
fn quatFromTo(fromDir, toDir) -> vec4      // Rotate between vectors
fn quatLookRotation(forward, up) -> vec4   // Look-at rotation
```

### Bone Chain
```wgsl
fn chainRotations(parent, child) -> vec4
fn localToWorldRotation(local, parentWorld) -> vec4
fn worldToLocalRotation(world, parentWorld) -> vec4
```

---

## Advanced Anime Techniques

These patterns are commonly used across anime shaders:

### Multi-Step Shading with Anti-Aliasing
```wgsl
// Smooth discrete bands with fwidth() for AA
fn multiStepAA(value : f32, levels : f32) -> f32 {
  let curLevel = value * levels;
  let aaf = fwidth(curLevel);
  let stepped = floor(curLevel);
  return mix(stepped, stepped + 1.0, smoothstep(1.0 - aaf, 1.0, fract(curLevel))) / levels;
}
```

### Soft Shadow with Step
```wgsl
fn softShadowStepped(ro, rd, mint, maxt, k) -> f32 {
  var res = 1.0;
  var t = mint;
  while (t < maxt) {
    let h = sceneSDF(ro + rd * t);
    if (h < 0.001) { return 0.0; }
    res = min(res, k * h / t);
    t += h;
  }
  return multiStep(res, 3.0);  // Quantize shadow
}
```

### SSS for Anime Skin
```wgsl
fn animeSkinSSS(ndotl : f32, sssRadius : f32) -> vec3 {
  let pndl = clamp(ndotl, 0.0, 1.0);
  let nndl = clamp(-ndotl, 0.0, 1.0);
  
  // Red-orange backscatter
  let sss = vec3(1.0, 0.1, 0.0) * 0.25 
          * (1.0 - pndl) * (1.0 - pndl) 
          * pow(1.0 - nndl, 3.0 / (sssRadius + 0.001));
  
  return vec3(pndl) + sss * clamp(sssRadius - 0.04, 0.0, 1.0);
}
```

### Voronoi Hair Highlights
```wgsl
fn animeHairHighlightVoronoi(uv, lightAngle, diffuse) -> f32 {
  let threshold = mix(0.0, 0.5, diffuse);
  let v = voronoiWithHide(uv, freq, rep, offset, 0.3);
  return smoothstep(threshold, threshold - 0.05, v);
}
```

### Eye Rendering Pattern
```wgsl
// 1. Sclera (white) - ellipsoid SDF
// 2. Iris - smaller ellipsoid with UV mapping
// 3. Pupil - even smaller ellipsoid
// 4. Highlight - offset sphere for catchlight
// 5. Eyelids - onion(ellipsoid) cut by spheres based on blink
// 6. Eyelashes - 2D curve extruded with thickness
```

### Facial Feature Outlines
```wgsl
// Bezier curves for brows, mouth, etc.
fn facialLine(uv, start, control, end, maxThick) -> f32 {
  let bezierResult = sdBezierCurve(uv, start, control, end);
  let dist = bezierResult.x;
  let t = bezierResult.y;
  let thickness = maxThick * 4.0 * t * (1.0 - t) * (1.0 - t);
  return smoothstep(thickness, thickness - 0.001, dist);
}
```

---

## Best Practices

### Combining Chunks
```wgsl
// Import what you need
${noise3dWGSL}
${fireTurbulenceWGSL}

// Functions are now available
let turbulence = fireTurbulenceFast(pos, time);
let noise = fbm3d(pos, 4);
```

### Avoiding Conflicts
- Each chunk uses unique function names
- Hash functions are suffixed (hash22v, hash13v, etc.)
- Constants use chunk-specific prefixes

### Performance Tips
1. Use `*Fast` variants when available
2. Reduce octave counts for distant objects
3. Use `textureLoad` instead of `textureSample` in conditionals
4. Precompute rotation matrices outside loops

---

## License

Patterns inspired by various Shadertoy shaders (MIT License).
All implementations are original WGSL rewrites.
