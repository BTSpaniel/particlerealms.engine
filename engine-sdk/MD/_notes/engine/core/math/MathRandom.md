Seeded random number generation for deterministic simulations, procedural
generation, and networked games. Uses a xorshift128+ algorithm with 128-bit
state. Each `Random` instance is independent and serializable.

### Basic usage

```js
import { Random } from "engine/core/math/MathRandom.js";

// Create with seed (reproducible)
const rng = new Random(12345);

// Float in [0, 1)
const chance = rng.next();

// Integer in range
const roll = rng.nextInt(1, 7);      // 1-6 (d6)
const index = rng.nextInt(0, len);   // Array-safe

// Float in range
const radius = rng.nextRange(0.5, 2.0);
```

### Vectors and directions

```js
// Random unit vectors
const dir2D = rng.nextDirection2D();     // [x, y] on circle
const dir3D = rng.nextDirection3D();     // [x, y, z] on sphere

// Point in shapes
const inCircle = rng.nextInCircle(radius);
const inSphere = rng.nextInSphere(radius);
const onSphere = rng.nextOnSphere(radius);

// In hemisphere (for reflections)
const bounce = rng.nextInHemisphere(surfaceNormal);
```

### Procedural generation (seeded)

```js
// Same seed → same dungeon every time
function generateDungeon(seed) {
  const rng = new Random(seed);
  
  const roomCount = rng.nextInt(5, 15);
  const rooms = [];
  
  for (let i = 0; i < roomCount; i++) {
    rooms.push({
      x: rng.nextInt(0, 100),
      y: rng.nextInt(0, 100),
      width: rng.nextInt(3, 8),
      height: rng.nextInt(3, 8)
    });
  }
  
  return rooms;
}

// Reproduce exactly: generateDungeon(42) always returns same layout
```

### Shuffle and pick

```js
const deck = ['A♠', 'K♠', 'Q♠', 'J♠', ...];
rng.shuffle(deck);  // In-place Fisher-Yates

// Pick random element
const card = rng.pick(deck);

// Weighted pick
const loot = rng.weightedPick([
  { item: 'common', weight: 70 },
  { item: 'rare', weight: 25 },
  { item: 'legendary', weight: 5 }
]);
```

### Serialization (network sync)

```js
// Save state to send across network
const state = rng.serialize();  // { lo, hi }

// Restore on client
const clientRng = Random.deserialize(state);

// Both now produce identical sequences
```

### Gotchas

- **Don't use `Math.random()`**: It's not seeded and differs across browsers.
- **Seed 0**: Valid but produces a specific sequence; use larger seeds (timestamps,
  hashes) for variety.
- **Threading**: Each `Random` is NOT thread-safe; create per-thread instances
  with different seeds derived from a root RNG.

**See also:** [Math Library](/engine/math.md) · [MathVec3](./MathVec3.md)
