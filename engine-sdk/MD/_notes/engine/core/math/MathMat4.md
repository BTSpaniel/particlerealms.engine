4×4 matrix operations for 3D transformations. Matrices are stored as 16-element
arrays in **column-major order** for WebGPU compatibility. Use the `*Into`
variants for zero-allocation matrix composition in hot paths.

### Basic transformations

```js
import {
  mat4, mat4Identity, mat4Translate, mat4Scale, mat4RotateY,
  mat4Multiply, mat4Perspective, mat4LookAt, mat4Inverse
} from "engine/core/math/MathMat4.js";

// Build a model matrix: T * R * S
const model = mat4Identity(mat4());
mat4Translate(model, model, [10, 0, 5]);   // Move to position
mat4RotateY(model, model, Math.PI / 4);    // 45° Y rotation
mat4Scale(model, model, [2, 2, 2]);        // Uniform scale

// Camera matrices
const view = mat4LookAt([0, 5, 10], [0, 0, 0], [0, 1, 0]);
const proj = mat4Perspective(Math.PI / 4, 16/9, 0.1, 1000);

// MVP for shader (projection * view * model)
const mvp = mat4();
mat4Multiply(mvp, proj, view);   // mvp = proj * view
mat4Multiply(mvp, mvp, model);   // mvp = proj * view * model
```

### Zero-allocation chain (hot loops)

```js
// Reuse the same output matrix instead of allocating
const temp = mat4();
const final = mat4();

function getTransform(entity, camera, output) {
  mat4Multiply(temp, camera.view, entity.localMatrix);
  mat4Multiply(output, camera.projection, temp);
  return output;
}

// In render loop (no GC pressure)
entities.forEach(e => {
  getTransform(e, camera, e.mvpMatrix);
  shader.setUniform('mvp', e.mvpMatrix);
});
```

### Common gotchas

- **Order matters**: `mat4Multiply(out, a, b)` means `out = a * b` (column-vectors,
  so transforms apply right-to-left when reading the chain).
- **Inverse**: `mat4Inverse(out, m)` returns `false` if singular; check before using.
- **Transpose**: Use `mat4Transpose` for normal matrices (lighting calculations).

**See also:** [MathVec3](./MathVec3.md) · [MathQuat](./MathQuat.md) · [Math Library](/engine/math.md)
