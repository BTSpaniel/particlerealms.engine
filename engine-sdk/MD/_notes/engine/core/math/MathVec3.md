A flat, allocation-conscious 3D vector library. Vectors are plain
`[x, y, z]` arrays (or typed arrays), **not** class instances — so they
serialize, pool, and pass to the GPU without conversion.

### Two calling conventions

Most operations come in two flavours:

- **Pure** — returns a new vector: `vec3Add(a, b)`.
- **`*Into`** — writes into an `out` array (zero allocation), ideal for hot
  loops: `vec3AddInto(out, a, b)`.

```js
import { vec3, vec3Add, vec3ScaleAndAdd, vec3Normalize } from "engine/core/math/MathVec3.js";

const a = vec3(1, 2, 3);
const b = vec3(0, 1, 0);

const sum = vec3Add(a, b);            // -> [1, 3, 3] (new array)

// hot path: integrate velocity into position without allocating
const pos = vec3(0, 0, 0);
const vel = vec3(0, 9.8, 0);
vec3ScaleAndAdd(pos, pos, vel, dt);   // pos += vel * dt, in place
```

### Gotchas

- `vec3Normalize` on a zero-length vector returns `NaN`s — use
  `vec3SafeNormalize(v, fallback)` when the input may be zero.
- Equality uses an epsilon (`vec3Equals`); use `vec3ExactEquals` only when you
  truly need bit-exact comparison.

**See also:** [Math Library](/engine/math.md)
