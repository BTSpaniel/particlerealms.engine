Quaternions for 3D rotations — compact, interpolation-friendly, and gimbal-lock
free. Stored as `[x, y, z, w]`. Use `quatMultiply` to compose rotations and
`slerp` for smooth interpolation.

### Creating rotations

```js
import {
  quat, quatFromEuler, quatFromAxisAngle, quatFromMat4,
  quatMultiply, quatSlerp, quatGetAxisAngle
} from "engine/core/math/MathQuat.js";

// From Euler angles (YXZ order: yaw, pitch, roll)
const rotY = quatFromEuler(quat(), 0, Math.PI / 2, 0);

// From axis-angle
const rotAxis = quatFromAxisAngle(quat(), [0, 1, 0], Math.PI / 4);

// From a look-at matrix (character facing)
const lookRot = quatFromMat4(quat(), lookAtMatrix);
```

### Composing and interpolating

```js
// Compose: apply 90° Y then 45° X
const y90 = quatFromEuler(quat(), 0, Math.PI/2, 0);
const x45 = quatFromEuler(quat(), Math.PI/4, 0, 0);
const combined = quatMultiply(quat(), y90, x45);  // combined = y90 * x45

// Smooth rotation over time
const start = quatFromEuler(quat(), 0, 0, 0);
const end = quatFromEuler(quat(), 0, Math.PI, 0);
const current = quat();

function update(dt) {
  progress += dt * speed;
  quatSlerp(current, start, end, Math.min(progress, 1));
  applyRotation(current);
}
```

### Converting to/from other representations

```js
// Quaternion → rotation matrix
import { mat4FromQuat } from "engine/core/math/MathMat4.js";
const rotMatrix = mat4FromQuat(mat4(), myQuat);

// Quaternion → axis-angle (for debug UI)
const [axis, angle] = quatGetAxisAngle(myQuat);
console.log(`Rotation: ${angle} radians around [${axis}]`);
```

### Gotchas

- **Normalization**: Always normalize after many operations; `quatNormalize` is cheap.
- **Shortest path**: `slerp` takes the shortest arc; for long spins, add multiples
  of 2π to the target angle first.
- **Gimbal lock**: Quaternions avoid it, but converting FROM Euler can still hit
  singularities at ±90° pitch — prefer quat-from-axis or keep state as quat.

**See also:** [MathVec3](./MathVec3.md) · [MathMat4](./MathMat4.md) · [Math Library](/engine/math.md)
