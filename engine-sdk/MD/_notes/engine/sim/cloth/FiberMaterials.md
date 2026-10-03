### Woven surface appearance

`FIBER_MATERIALS` and `WEAVE_TYPES` are shared by the Woven Playground and retained Engine mesh previews. `normalizeWovenAppearance()` validates a visual descriptor with a supported fiber and weave, finite warp/weft density in threads per millimetre, grain angle, colors, and authored/sourced/measured/estimated provenance. The descriptor does not provide measured cloth response curves.

```js
import { normalizeWovenAppearance } from '/engine/sim/cloth/FiberMaterials.js';

const appearance = normalizeWovenAppearance({
  kind: 'woven',
  weave: 'twill',
  fiber: 'cotton',
  warpThreadsPerMm: 0.7,
  weftThreadsPerMm: 0.65,
  grainDegrees: 90,
  warpColor: [0.15, 0.25, 0.36, 1],
  weftColor: [0.56, 0.66, 0.73, 1],
  provenance: { status: 'sourced', source: 'Supplier weave specification' },
});
```

Pass appearance evidence through the application record. Keep physical material response in the triangular cloth material contract.
