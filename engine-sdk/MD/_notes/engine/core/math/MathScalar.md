Scalar (single number) math utilities: clamping, interpolation, stepping, and
common easing functions. These are pure functions that return new scalars.

### Basic range operations

```js
import {
  clamp, lerp, smoothStep, step, saturate,
  mapRange, wrap, pingPong
} from "engine/core/math/MathScalar.js";

// Clamp to range
const health = clamp(rawHealth, 0, 100);

// Linear interpolation (mix)
const current = lerp(start, end, t);  // t in [0, 1]

// Smooth step (Hermite, C1 continuous)
const smoothT = smoothStep(edge0, edge1, x);
const eased = lerp(start, end, smoothT);

// Step function (0 or 1)
const visible = step(threshold, value);  // 1 if value >= threshold

// Saturate (clamp01)
const t = saturate(unbounded);  // Clamp to [0, 1]
```

### Mapping and wrapping

```js
// Map from one range to another
const screenX = mapRange(worldX, -50, 50, 0, 1920);

// Wrap for circular values (angles, looped animations)
const angle = wrap(370, 0, 360);  // → 10
const index = wrap(i, 0, array.length);

// Ping-pong (triangle wave)
const bounce = pingPong(time, 1);  // 0→1→0→1...
```

### Easing functions

```js
import {
  easeInQuad, easeOutQuad, easeInOutQuad,
  easeInCubic, easeOutElastic, easeOutBounce
} from "engine/core/math/MathScalar.js";

// Animation with easing
const t = elapsed / duration;
const easedT = easeOutElastic(t);  // Overshoot then settle
const value = lerp(start, end, easedT);
```

### Gotchas

- **Division by zero**: `smoothStep` and `mapRange` handle equal edges gracefully
  (return 0 or start respectively), but check your inputs for logic errors.
- **Precision**: For very large `lerp` ranges, prefer the `*Precise` variants or
  use double precision temporaries.

**See also:** [Math Library](/engine/math.md)
