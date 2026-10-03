---
title: Curl Noise Flow Atlas
description: Architecture, controls, performance policy, and scientific scope of the adaptive WebGPU Curl Noise playground demo.
updated: 2026-07-29
---

# Curl Noise Flow Atlas

Curl Noise Flow Atlas is an adaptive GPU tracer demo in the Playground. It combines a shared periodic curl field with Particle Storm's high-count compute-density architecture and five authored flow studies.

The demo visualizes procedural incompressible-style flow. It is not a Navier-Stokes solver, fluid-pressure simulation, or claim of physically exact continuous incompressibility after texture filtering.

## Pipeline

```text
three-channel vector potential
  -> periodic discrete curl volume
  -> packed 8-byte tracer advection
  -> four semantic State-First cohort buckets
  -> exact-quota atomic density
  -> chromatic HDR resolve
  -> clamped 2-3 frame history
  -> thresholded glow + hue-preserving ACES
```

`ParticleNoiseTexture.js` bakes three decorrelated potential channels into an `rgba16float` 3D texture. A second compute pass reads periodic neighbors and writes the centered-difference curl into a separate volume. The shared stencil makes discrete divergence cancel on the bake lattice before half-float quantization. Trilinear interpolation can introduce residual divergence between texels, so the demo describes the result as procedural curl flow rather than exact computational fluid dynamics. (Source: `engine/sim/particles/ParticleNoiseTexture.js`.)

The bake limits unfiltered octaves to the volume's sample density and rejects configurations with fewer than two lattice samples per base-noise cell. At the default period of 16, a 64³ field uses two octaves, 128³ uses three, and 256³ uses four. Runtime work then becomes one filtered field lookup per tracer instead of repeated scalar-noise evaluations. The direct fallback in `ParticleSimWorld.js` uses the same three-component potential construction. (Sources: `engine/sim/particles/ParticleNoiseTexture.js`, `engine/sim/particles/ParticleSimWorld.js`.)

## Scaling model

Each tracer stores three bounded positions and normalized lifetime in two packed `u32` values. `pack2x16unorm` gives uniform precision across the fixed `[-16, 16]` domain. Velocity remains derived from the flow field, which keeps live state at 8 bytes without counting a retained or non-simulated tier as full dynamics. (Source: `tests/playground/src/demos/curl/shaders.js`.)

One compute invocation unpacks a tracer, samples and applies the field, advances lifetime, repacks state, projects the result, and optionally adds one integer contribution to one of eight density planes. Two-dimensional dispatch avoids the one-dimensional workgroup-count ceiling. State grows in adapter-probed chunks, shaders compile before large state allocation, and size-dependent targets commit only after asynchronous WebGPU validation and out-of-memory scopes succeed. A failed resize retains the last valid image. (Sources: `tests/playground/src/demos/curlNoise.js`, `tests/playground/src/demos/curl/shaders.js`.)

The governor has no configured particle-count ceiling. It grows until measured frame pressure, WebGPU's 32-bit identity space, or allocation failure stops it. Per-pass GPU timestamps separate fused simulation from resolve and presentation cost. Two timestamped empty markers distinguish the recurring density clear from transient state resets before the compute pass without replacing optimized `clearBuffer` commands with a slower compute clear. Reset and reactivation samples remain visible in telemetry but are excluded from governor learning. The governor also requires two fresh timestamp intervals before acting, so one cold sample cannot force a quality step. A frame-cadence fallback still calibrates on adapters without timestamp queries. The HUD reports estimated GPU memory because it includes state, density, HDR history, and both field volumes. (Source: `tests/playground/src/demos/curlNoise.js`.)

Under the State-First rasterizer policy, four authored emitter cohorts act as bounded semantic proxies for the packed GPU population. The demo submits one aggregate bucket plan per sampled frame; it never reads individual tracer state back to JavaScript or creates one CPU object per tracer. The selected `POINT`, `SPLAT`, `LINE`, `FIELD`, or `LOW_MESH` representation is packed into the existing uniform block and changes the density-deposition footprint and weight. It does not delete, freeze, or change the 8-byte simulation state. Native policy retains the original field-style deposition. (Sources: `tests/playground/src/demos/curlNoise.js`, `tests/playground/src/demos/curl/model.js`, `tests/playground/src/demos/curl/shaders.js`.)

## Selection and rendering semantics

The demo always keeps at least `160 / 256`, or 62.5%, of active tracers eligible for density rasterization. It changes the quota by at most one cohort per adjustment. A low-discrepancy permutation distributes changes within each 256-tracer block, and stochastic integer weighting makes lifecycle fades gradual without fractional atomics. (Sources: `tests/playground/src/demos/particleStorm.js`, `tests/playground/src/demos/particleStormTuning.js`, `tests/playground/src/demos/curl/shaders.js`.)

The HUD calls this number **selected**, not rendered. Frustum rejection, camera direction, and lifecycle fading happen after selection, so no honest fixed percentage can guarantee that the same fraction contributes to visible pixels every frame.

The resolve normalizes material chromaticity separately from density. Hue-preserving ACES avoids turning dense complementary colors white. Thresholded glow blooms bright filaments without lifting the whole occupied region, while a short clamped history rejects camera, study, and pointer-force discontinuities. (Sources: `tests/playground/src/demos/curl/shaders.js`, `tests/playground/src/demos/curlNoise.js`.)

## Studies

| Key | Study | Composition |
| --- | --- | --- |
| `1` | Aurora Loom | Four narrow polar emitters rise through a translating field. |
| `2` | Vortex Cathedral | Two counter-rotating columns use nested, color-separated shells. |
| `3` | Braided Wake | Four narrow jets cross a moving analytic vortex pair. |
| `4` | Solar Bloom | A toroidal emitter unfolds around an orbital core. |
| `5` | Helicity Garden | Four shells expose coarse and fine rotational structure. |

The authored vortex primitives are divergence-free cross-product fields. Pointer interaction injects another localized vortex instead of a radial sink. (Sources: `tests/playground/src/demos/curl/model.js`, `tests/playground/src/demos/curl/shaders.js`.)

## Controls

| Input | Action |
| --- | --- |
| `1`-`5` | Select an authored study and reset its tracer field. |
| Left drag | Move a local vortex through the projected flow. |
| Right drag | Orbit the camera. |
| `Space` | Pause or resume simulation. Presentation remains live and the HUD says `SIM PAUSED`. |
| `R` | Reset the current study. |

Reset clears active and inactive allocated state. Reactivated ranges also clear before compute, so stale particles cannot reappear after pressure-driven retirement. Lifecycle fades and a visible paused spawn age avoid bulk disappearance. (Sources: `tests/playground/src/demos/curlNoise.js`, `tests/playground/src/demos/curl/shaders.js`.)

## Research basis

- [Curl-Noise for Procedural Fluid Flow](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf) defines curl of a vector potential, potential-space modulation, boundary treatment, and analytic vortex primitives.
- [Rendering Point Clouds with Compute Shaders](https://www.cg.tuwien.ac.at/research/publications/2021/SCHUETZ-2021-PCC/SCHUETZ-2021-PCC-paper.pdf) motivates compute-density point rasterization.
- [Continuous Level of Detail for Point Clouds](https://www.cg.tuwien.ac.at/research/publications/2019/schuetz-2019-CLOD/) motivates point-wise transitions instead of visible chunk changes.
- [Scalar Spatiotemporal Blue Noise Masks](https://research.nvidia.com/publication/2021-12_scalar-spatiotemporal-blue-noise-masks) motivates temporally stable changing sample sets.
- [High-Speed, Off-Screen Particles](https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-23-high-speed-screen-particles) describes reduced-resolution off-screen particle accumulation.
- [WGSL](https://gpuweb.github.io/gpuweb/wgsl/) defines the packing, texture, storage-buffer, and atomic operations used by the implementation.

## See also

- [Particle System](particles.md)
- [Kuramoto Resonance Field](kuramoto-resonance-field.md)
- [Particle Long-Range Solvers](particle-long-range.md)
