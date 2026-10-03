---
title: Galaxy Mythic Spiral Atlas
description: Architecture, art direction, performance policy, controls, and scientific limits of the adaptive WebGPU Galaxy playground demo.
updated: 2026-07-29
---

# Galaxy Mythic Spiral Atlas

Galaxy Mythic Spiral Atlas is an adaptive GPU orbital-tracer demo in the Playground. It combines observed spiral-galaxy structure with five deliberately enhanced fantasy studies. This page is for developers who tune its morphology, rendering, or performance governor.

An orbital tracer is a procedural sample that follows an analytic galactic orbit. The demo is not a self-gravitating N-body simulation, and it does not use FMM to approximate pairwise gravity. Its scientific content is limited to population distributions, differential rotation, a separate spiral-pattern speed, dust offsets, and transparent measurement semantics.

## Rendering pipeline

```text
packed 4-byte orbital state
  -> differential orbital update
  -> logarithmic arm and population classification
  -> semantic State-First population buckets
  -> exact-quota eight-plane density accumulation
  -> stellar emission - dust optical depth + nebular emission
  -> short motion-aware HDR history
  -> thresholded glow + hue-preserving ACES
```

Every active tracer stores two 16-bit angular values in one `u32`: orbital phase and epicyclic phase. One initialization bit distinguishes untouched allocation from live state. The compute shader advances this state before density selection, so the HUD's **simulated** count means actively updated orbital states. (Sources: `tests/playground/src/demos/galaxy.js`, `tests/playground/src/demos/galaxy/shaders.js`.)

The position model derives disk radius, vertical thickness, stellar family, luminosity, and structural variation from a stable integer identity. Disk stars follow a cored-to-flat rotation curve. Spiral arms use a logarithmic phase field whose pattern speed remains distinct from each star's orbital speed. Arm width increases outward, while segment masks and feathers prevent perfectly continuous ribbons. Selected studies add a bar, tidal wake, resonant ring, outer arc, or sparse polar veil. (Sources: `tests/playground/src/demos/galaxy/model.js`, `tests/playground/src/demos/galaxy/shaders.js`.)

## Light, dust, and color

The eight-plane atlas stores old stars, young stars, H-II emission, and dust in two atomic shards per family. Shards reduce avoidable contention without changing the resolved image. The resolve applies wavelength-dependent transmission:

```text
transmission = exp(-opticalDepth * extinctionColor)
```

Optical depth measures how strongly material attenuates light along a sampled path. This lets dust lanes darken stars instead of adding nearly black light to an additive target. A separate rim term adds faint scattered color. Young blue populations and coral or magenta H-II regions sit at different arm-phase offsets from dust. (Source: `tests/playground/src/demos/galaxy/shaders.js`.)

The palette is an enhanced visualization, not unaided human vision. It retains a warm old population, cooler young clusters, emission regions, and dark dust, then grades those components into each study's fantasy palette. The final pass blooms only energy above a threshold, adds rare background stars and core diffraction, and applies a hue-preserving ACES curve once at presentation. (Source: `tests/playground/src/demos/galaxy/shaders.js`.)

## Adaptive scale

The demo begins with one million active tracers and grows in allocation chunks. It has no configured particle-count ceiling. Growth ends only when measured pressure, the 32-bit identity range, or a recoverable WebGPU allocation failure requires it. Shaders compile before large buffers allocate, and size-dependent targets replace the previous target only after validation and out-of-memory scopes succeed. (Source: `tests/playground/src/demos/galaxy.js`.)

The fused pass simulates every active tracer and selects a spatially distributed subset for density work. Selection never falls below `160 / 256`, or 62.5%, and changes by at most one cohort per governor adjustment. A low-discrepancy permutation spreads a quota change across each 256-tracer block. It does not remove one visible contiguous population. The HUD says **selected**, because projection and frustum rejection occur after quota selection. (Sources: `tests/playground/src/demos/particleDensitySelection.js`, `tests/playground/src/demos/particleStormTuning.js`, `tests/playground/src/demos/galaxy.js`.)

GPU timestamps separate recurring clear, fused simulation-density work, resolve, history, and presentation. A recursive model estimates fixed, simulated-million, and selected-million costs. The governor waits for fresh samples, excludes reset and target-rebuild transients, and changes one quota slot per frame under pressure. Camera, study, and pointer discontinuities reject short-term history to prevent ghost trails. (Source: `tests/playground/src/demos/galaxy.js`.)

State-First planning uses four aggregate stellar-family proxies plus one resolved field proxy. These bounded CPU descriptors represent old stars, young stars, H-II regions, dust, and the composed density field; individual orbital tracers remain authoritative packed GPU state and are never read back for bucket classification. The active profile supplies a quota ceiling of `256`, `224`, `192`, or `160` slots, while the existing one-slot governor smoothing and `160 / 256` floor remain in force. Bucket representations modulate continuous deposition energy rather than removing a stellar family, so a policy change cannot erase or recreate simulation state. Native policy preserves the original density response. (Sources: `tests/playground/src/demos/galaxy.js`, `tests/playground/src/demos/galaxy/model.js`, `tests/playground/src/demos/galaxy/shaders.js`.)

Memory telemetry includes live state, allocated-but-inactive state capacity, eight density planes, HDR targets, and timestamp resources. It is an estimate of resources owned by the demo, not whole-process GPU memory.

## Studies

| Key | Study | Composition |
| --- | --- | --- |
| `1` | Astral Crown | Four feathered sapphire arms cross an ivory-gold disk with coral nurseries and deep dust. |
| `2` | Void Cathedral | A cold barred spiral carries dark arches and a sparse bipolar ionization veil. |
| `3` | Dragonwake | Three loose ember arms shear into an asymmetric blue-violet tidal feather. |
| `4` | Seraphim Ring | Five pale-gold resonant feathers carry rose H-II knots into a turquoise halo. |
| `5` | Arcane Meridian | Two broad cyan-violet arms cross a molten core and dissolve into broken outer spurs. |

Study data lives in `GALAXY_STUDIES`. `validateGalaxyStudies()` rejects invalid arm count, pitch, radius, exposure, or camera values before the demo allocates GPU resources. (Source: `tests/playground/src/demos/galaxy/model.js`.)

## Controls

| Input | Action |
| --- | --- |
| `1`-`5` | Select and deterministically reset an authored study. |
| Left drag | Bend projected light around a local interactive gravity-lens effect. This is an art control, not a gravity solve. |
| Right drag | Orbit the camera and reject stale HDR history. |
| `Space` | Pause or resume orbital evolution while presentation remains live. |
| `R` | Reset the current study from its stable identity seed. |

## Research basis

- [NASA's NGC 3982 image and description](https://science.nasa.gov/missions/hubble/pinwheel-of-star-birth/) grounds the warm central population, blue young clusters, reddish star-forming regions, and obscuring dust lanes.
- [NASA's galaxy morphology guide](https://science.nasa.gov/universe/galaxies/types/) describes spiral disks, bulges, halos, bars, gas, dust, and population differences.
- [Dobbs and Baba's spiral-structure review](https://arxiv.org/abs/1407.5062) motivates treating arms as patterns that stars move through instead of rigid material ribbons.
- [Draine's interstellar-dust review](https://arxiv.org/abs/astro-ph/0312592) motivates absorption, scattering, and wavelength-dependent extinction.
- [Rendering Point Clouds with Compute Shaders](https://www.cg.tuwien.ac.at/research/publications/2021/SCHUETZ-2021-PCC/) motivates compute-density point rasterization at high sample counts.
- [Continuous Level of Detail for Point Clouds](https://www.cg.tuwien.ac.at/research/publications/2019/schuetz-2019-CLOD/) motivates distributed point-wise transitions rather than visible chunk removal.
- [Scalar Spatiotemporal Blue Noise Masks](https://research.nvidia.com/publication/2021-12_scalar-spatiotemporal-blue-noise-masks) motivates temporally stable changing sample sets.
- [ACES output-transform guidance](https://docs.acescentral.com/system-components/output-transforms/) motivates a scene-linear HDR pipeline followed by one display transform.
- [WGSL](https://gpuweb.github.io/gpuweb/wgsl/) defines the storage layout, integer atomics, and packing operations used by the implementation.

## See also

- [Particle System](particles.md)
- [Curl Noise Flow Atlas](curl-noise-flow-atlas.md)
- [Kuramoto Resonance Field](kuramoto-resonance-field.md)
- [Particle Long-Range Solvers](particle-long-range.md)
