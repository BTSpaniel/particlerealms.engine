---
title: Math Library
description: 350+ pure, array-based, WebGPU-aligned math functions — vectors, matrices, quaternions, geometric primitives, GPU data packing, curves, color, and noise.
updated: 2026-06-05
---

# Math Library

350+ pure functions for vectors, matrices, quaternions, geometric primitives, GPU data packing, and interpolation. All exported via `EngineBootstrap.js` and `MathImports.js`.

## Design philosophy

- **Pure functions** — no classes, no mutation of inputs; every function returns a new value.
- **Array-based** — vectors are `[x, y, z]`, quaternions are `[x, y, z, w]`, matrices are `Float32Array(16)`.
- **WebGPU-aligned** — projection matrices use a `[0, 1]` Z-range (not `[-1, 1]` like OpenGL).
- **No dependencies** — self-contained, no external math libraries.

For binding rules around matrix layout, multiplication order, quaternion order, projection depth, tolerance, and CPU/WGSL parity, see the [Math Contract](math-contract.md).

## Module map

| Module | Functions | Purpose |
| --- | --- | --- |
| `MathVec3.js` | ~30 | 3D vectors: add, sub, scale, dot, cross, normalize, lerp, reflect, project, smoothDamp |
| `MathVec2.js` | ~12 | 2D vectors: add, sub, scale, dot, length, normalize, lerp, distance |
| `MathQuat.js` | ~15 | Quaternions: slerp, fromAxisAngle, fromEuler, lookAt, multiply, inverse |
| `MathMat4.js` | ~15 | 4×4 matrices: perspective, orthographic, lookAt, inverse, multiply, fromRotationTranslation |
| `MathScalar.js` | ~8 | Scalar: clamp, lerp, smoothstep, saturate, inverseLerp, remap |
| `MathRay.js` | ~20 | Rays: create, intersect (sphere, AABB, plane, triangle, capsule, OBB), transform |
| `MathPlane.js` | ~20 | Planes: create, distance, project, intersect (ray, segment, plane), transform |
| `MathLine3.js` | ~15 | Line segments: create, closest point (to point, segment, ray), distance |
| `MathRect2.js` | ~25 | 2D rectangles: create, contains, intersects, merge, grow, clamp |
| `MathDualQuat.js` | ~20 | Dual quaternions: create, multiply, sclerp, transform point, toMat4 (DQS skinning) |
| `MathPacking.js` | ~20 | GPU packing: half-float, UNORM/SNORM, RGB9E5, R11G11B10F, octahedral normals |
| `MathGeometry.js` | ~20 | Geometry helpers: AABB, sphere, frustum, distance calculations |
| `MathColor.js` | ~10 | Color: HSL↔RGB, temperature→RGB, sRGB↔linear |
| `MathCurves.js` | ~15 | Curves: bezier, catmull-rom, hermite, arc-length parameterization |
| `MathNoise.js` | ~10 | Noise: simplex2D/3D, perlin, FBM, curl noise |

## Quick examples

### Vectors

```javascript
import { vec3, vec3Add, vec3Normalize, vec3Cross, vec3Dot } from './engine/MathImports.js';

const a = vec3(1, 0, 0);
const b = vec3(0, 1, 0);
const sum = vec3Add(a, b);     // → [1, 1, 0]
const up  = vec3Cross(a, b);   // → [0, 0, 1]
const dot = vec3Dot(a, b);     // → 0
const n   = vec3Normalize(sum); // → [0.707, 0.707, 0]
```

### Matrices

```javascript
import { mat4PerspectiveRadWebGPU, mat4LookAt, mat4Multiply } from './engine/MathImports.js';

// WebGPU projection (Z range [0,1])
const proj = mat4PerspectiveRadWebGPU(Math.PI / 4, 16 / 9, 0.1, 1000);
const view = mat4LookAt([0, 5, 10], [0, 0, 0], [0, 1, 0]);
const vp   = mat4Multiply(proj, view);
```

### GPU packing

```javascript
import { floatToHalf, packOctNormal, packRGB9E5 } from './engine/core/math/MathPacking.js';

const half = floatToHalf(3.14);            // → uint16
const oct  = packOctNormal([0, 1, 0]);     // → [sn8, sn8]
const hdr  = packRGB9E5([5.0, 2.0, 0.1]);  // → uint32
```

### Ray intersection

```javascript
import { rayCreate, rayIntersectSphere } from './engine/core/math/MathRay.js';

const ray = rayCreate([0, 0, 5], [0, 0, -1]);
const hit = rayIntersectSphere(ray, [0, 0, 0], 1.0);
// → { t: 4.0, point: [0,0,1], normal: [0,0,1] } or null
```
