---
title: Math Contract
description: Contract for engine math values, matrix layout, quaternion order, WebGPU projection depth, units, tolerances, determinism, and WGSL parity.
updated: 2026-06-15
---

# Math Contract

This page defines the rules new engine, editor, Plauna, AGI, and WebGPU OS code must follow when it uses shared math. It locks the current runtime behavior before MathEngine grows beyond the existing modules.

The contract is based on the current source in `engine/core/math/`, `engine/render/CameraMath.js`, and `tests/math-invariants.html`.

## Source of truth

| Area | Canonical source | Notes |
| --- | --- | --- |
| Basic vectors, quaternions, and mat4 helpers | `engine/core/math/EngineMath.js` | Compatibility surface exported through `engine/core/math/index.js`, `engine/MathImports.js`, and `engine/EngineBootstrap.js`. |
| Extended matrices | `engine/core/math/MathMat.js` | Mat2/Mat3 and extended Mat4 helpers, including TRS compose/decompose. |
| Extended quaternions | `engine/core/math/MathQuat.js` | Quaternion creation, conversion, interpolation, comparison, and orientation helpers. |
| Camera projection/view composition | `engine/render/CameraMath.js` | Defaults to WebGPU projection depth for camera rendering. |
| Gate 0 invariant tests | `tests/math-invariants.html` | Browser ES module checks for decompose, inverse, look-at, WebGPU depth, quaternion, and camera finite output. |

New code should import from the narrow module it needs when possible. Broad app or compatibility surfaces may import from `engine/MathImports.js`.

## Value representation

| Value | Representation | Contract |
| --- | --- | --- |
| Scalar | JavaScript `number` | Use finite values unless the function explicitly documents non-finite handling. |
| Vec2 | `[x, y]` | Plain array unless a specific API documents a typed array. |
| Vec3 | `[x, y, z]` | Plain array. World up is `[0, 1, 0]` for camera helpers. |
| Vec4 | `[x, y, z, w]` | Plain array. |
| Quaternion | `[x, y, z, w]` | Identity is `[0, 0, 0, 1]`. `q` and `-q` represent the same orientation. |
| Mat3 | `Float32Array(9)` | Column-major. Translation-style 2D mat3 helpers store translation in the final column. |
| Mat4 | `Float32Array(16)` | Column-major. Translation lives at indices `12`, `13`, and `14`. |

Functions must not mutate input arrays unless the name or signature makes mutation explicit, such as `copy(out, value)`, `set(out, ...)`, `mat4Multiply(a, b, out)`, or `mat4MultiplyInto(out, a, b)`. Mutating the explicit `out` parameter is allowed. (Source: `engine/core/math/EngineMath.js`, `engine/core/math/MathMat.js`, `engine/core/math/MathQuat.js`.)

## Matrix layout and order

Mat4 values use column-major storage and column-vector transform semantics. The engine applies the rightmost matrix first.

```javascript
const viewProj = mat4Multiply(proj, view);
const clip = mat4TransformPoint(viewProj, worldPoint);
```

`viewProj = proj * view` is the camera contract used by `CameraMath.computeViewProjMatrix()`. The same order should be used in render tests and tools. (Source: `engine/render/CameraMath.js`.)

When composing transforms, use TRS helpers instead of manual index writes unless the code is a low-level math helper.

```javascript
const model = mat4FromRotationTranslationScale(rotation, translation, scale);
const { translation, rotation, scale } = mat4Decompose(model);
```

`mat4Decompose()` preserves translation and scale. If any scale axis is zero, near-zero, or non-finite, rotation is not recoverable, so it returns identity rotation `[0, 0, 0, 1]` instead of `NaN`. (Source: `engine/core/math/MathMat.js`; verified by `tests/math-invariants.html`.)

## Coordinate and camera rules

| Rule | Contract |
| --- | --- |
| World up | `[0, 1, 0]` for camera and look-at helpers. |
| Camera forward in view space | Negative Z. `mat4LookAt([0,0,5], [0,0,0], [0,1,0])` maps the target to negative Z. |
| Transform forward | `mat4GetForward()` treats forward as the negative local Z axis. |
| View-projection order | `proj * view`. |
| UI and DOM units | Keep DOM/CSS pixel math outside core engine math unless a DOM-specific adapter documents the conversion. |

The source currently has both render-facing camera helpers and generic matrix helpers. New camera code should use `engine/render/CameraMath.js` or the WebGPU projection helpers from `EngineMath.js` instead of reimplementing projection math. (Source: `engine/render/CameraMath.js`, `engine/core/math/EngineMath.js`.)

## Projection depth

WebGPU render paths must use the WebGPU projection helpers. These map clip-space Z into `[0, 1]`.

| Use case | Helper |
| --- | --- |
| Perspective, radians | `mat4PerspectiveRadWebGPU()` |
| Perspective, degrees | `mat4PerspectiveDegWebGPU()` |
| Orthographic | `mat4OrthographicWebGPU()` |
| Camera default | `computePerspectiveProjection()` with default options |

The legacy helpers `mat4PerspectiveRad()`, `mat4PerspectiveDeg()`, and `mat4Orthographic()` use OpenGL-style `[-1, 1]` depth. They remain available for compatibility and explicit OpenGL-depth tests only. They must not be used in WebGPU render passes. (Source: `engine/core/math/EngineMath.js`; verified by `tests/math-invariants.html`.)

## Quaternion rules

Quaternions are `[x, y, z, w]`. Rotation quaternions should be normalized before use in transforms, interpolation, and camera code.

```javascript
const q = quatNormalize(quatFromAxisAngle([0, 1, 0], Math.PI / 3));
const m = mat4FromQuat(q);
const restored = quatNormalize(quatFromRotationMatrix(m));
```

`quatFromAxisAngle(axis, angle)` does not normalize `axis` for the caller. Pass a normalized axis or normalize the returned quaternion before using it as a rotation. `quatEquals()` and test assertions must treat `q` and `-q` as equivalent orientations. (Source: `engine/core/math/MathQuat.js`.)

## Units and ranges

| Category | Contract |
| --- | --- |
| Angles | Radians by default. Degree helpers include `Deg` in the name. |
| Time | Seconds for runtime simulation and animation math unless the caller documents milliseconds. |
| Color channels | Normalized linear values for renderer math unless a function explicitly says sRGB or packed format. |
| Depth | WebGPU render depth is `[0, 1]`. |
| Scale | Zero scale is valid as data, but rotation cannot be recovered from a collapsed axis. |

## Tolerance policy

Use `EPSILON` from `engine/core/math/MathConstants.js` as the default scalar tolerance. Use a wider tolerance only when the operation naturally accumulates error, such as matrix inverse, projection, or CPU/GPU parity checks.

| Check type | Default tolerance |
| --- | --- |
| Scalar/vector equality | `EPSILON` or `1e-6` |
| Matrix identity after inverse | `1e-4` unless a narrower bound is proven stable |
| Projection depth | `1e-5` for CPU-side invariant tests |
| Quaternion orientation | Compare absolute dot product near `1` so `q` and `-q` both pass |
| GPU parity | Define a per-test tolerance and state why it is wider than CPU tolerance |

Do not compare floats with exact equality except for sentinel values and intentional constants.

## Degenerate input policy

Math helpers should return finite, documented fallbacks for common degenerate inputs. Current examples:

| Input | Expected behavior |
| --- | --- |
| Zero-length quaternion normalization | Identity quaternion. |
| Singular matrix inverse | Identity matrix from current `mat4Inverse()` behavior. |
| Zero or near-zero TRS scale in `mat4Decompose()` | Preserve translation/scale, return identity rotation. |
| Zero-length look direction | Return identity or documented fallback in the relevant helper. |

If a function cannot produce a mathematically unique answer, document the fallback and add an invariant test. Do not return `NaN` for ordinary degenerate gameplay/editor data.

## Determinism and side effects

Core math modules must stay browser ES modules with no Node.js, npm, DOM, GPU device, network, or filesystem dependency. They should be worker-safe unless the module name or docs say otherwise.

Random and noise helpers must document their seed/source behavior. Deterministic systems should not call ambient random helpers unless they thread a seed or generator through the call.

## WGSL parity

Any math helper promoted as shader-safe needs a CPU/WGSL parity test before broad use. Parity tests should cover representative values and edge cases for:

- Quaternion rotate and normalize.
- Ray, AABB, plane, and triangle intersection.
- Packing and unpacking helpers.
- SDF primitives.
- Deterministic noise snapshots.

The JavaScript implementation remains the authoring source until a WGSL mirror is explicitly registered and parity-tested.

## Acceptance checklist

Before adding or changing shared math, verify:

- The function follows the value representation table.
- Matrix code uses column-major `Float32Array` storage and the established multiplication order.
- WebGPU render code uses WebGPU projection helpers.
- Degenerate inputs either return finite documented fallbacks or throw documented errors.
- Tests cover normal and edge cases in `tests/math-invariants.html` or a more specific browser test.
- Shader-safe code has or schedules a CPU/WGSL parity test.

## See also

- [Math Library](math.md)
- [Rendering](rendering.md)
- [Shaders & WGSL](shaders.md)
- [GPU Device Sharing](../concepts/gpu-device-sharing.md)
