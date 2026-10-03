---
title: Particle Long-Range Solvers
description: Selection, configuration, implementation, and validation of the direct, FMM, PME, and experimental ESP particle-force backends.
updated: 2026-07-29
---

# Particle Long-Range Solvers

The particle simulation has four mutually exclusive long-range force backends. Use FMM for a large open domain, PME for a periodic domain, direct summation as the small-system accuracy oracle, and ESP only as an experimental periodic alternative. These systems accelerate the same content-dependent pair force as the existing N-body solver; they are unrelated to Pai, BLT, HIER, or Ouroboros model training. (Sources: `engine/sim/particles/ParticleNBody.js`, `engine/sim/particles/ParticleFMM.js`, `engine/sim/particles/ParticleMeshEwald.js`.)

## Choose a backend

| Backend | Boundary | Best fit | Main tradeoff |
| --- | --- | --- | --- |
| `direct` | Open | Small particle counts and reference validation | Exact softened pair sum, but quadratic work |
| `fmm` | Open | Large or spatially clustered particle sets | Approximate; current tree is uniform and capped at depth 5 |
| `pme` | Periodic | Uniform periodic particle sets | FFT/grid cost and periodic-image physics |
| `esp` | Periodic | Experiments with a smaller prolate-window grid | Wider grid assignment and real-space work can erase the FFT saving |

Do not switch between open and periodic backends merely for speed. They solve different boundary-value problems. FMM is the primary upgrade path for Particle Realms scenes because those scenes normally use an open world. Published comparisons likewise show that workload distribution matters: FMM can benefit strongly inhomogeneous systems while mesh methods can remain better for uniform periodic systems. GPU crossover points depend on hardware, particle distribution, requested accuracy, and expansion order. (Sources: [Treecode and fast multipole method for N-body simulation with CUDA](https://arxiv.org/abs/1010.1482), [Adaptive fast multipole methods on the GPU](https://arxiv.org/abs/1205.4611), [FMM and PME comparison](https://pmc.ncbi.nlm.nih.gov/articles/PMC7660746/).)

## N-body encounter Playground

The [N-Body Encounters demo](../../tests/playground/?demo=nbody) separates gravitational accuracy from visual sampling. Full-precision macro bodies source and receive softened gravity through the open FMM backend. The 4,096-body Direct Reference uses a separate race-free tiled direct kick. A packed 12-byte tracer population responds to at most three moving cluster cores, but never contributes mass to either force solve. The HUD reports mutual bodies, active tracers, quota-selected tracers, allocated state, memory, solver timing, and FMM leaf diagnostics as separate quantities. (Sources: `tests/playground/src/demos/nBody.js`, `tests/playground/src/demos/nbody/shaders.js`.)

The tracer renderer reuses the Particle Storm exact-quota permutation. Every block of 256 active tracers contributes exactly `renderSlots` candidates, the quality floor remains 160 of 256 candidates, and the governor changes no more than one cohort per adjustment. Tracer state has no preset count ceiling. Allocation stops at available GPU memory, storage-binding limits, or the 32-bit identity limit. A learned cost model and separate GPU timestamps prevent expensive body solves from automatically thinning a cheap visual population. (Sources: `tests/playground/src/demos/particleDensitySelection.js`, `tests/playground/src/demos/particleStormTuning.js`, `tests/playground/src/demos/nBody.js`.)

The State-First adapter submits one aggregate proxy for each active authored gravitating system plus one restricted-tracer field proxy. This keeps bucket planning proportional to the number of semantic systems rather than the number of particles and avoids GPU readback. Raster profiles map to quota targets of `256`, `240`, `208`, `176`, or `160` slots; the target is still approached by at most one slot per governor adjustment and can never cross the 62.5% floor. Bucket representation changes presentation policy only. It cannot alter macro-body integration, tracer motion, allocation, or lifetime. (Sources: `tests/playground/src/demos/nBody.js`, `tests/playground/src/demos/nbody/model.js`.)

The authored encounter studies use deterministic truncated disk, Plummer, or cored Dehnen-like seeds. Restricted outer-disk tracers add low-mass visual resolution to bridges and counter-tails, following the restricted-particle approach used in foundational galaxy-encounter work. These tracers are an artistic collisionless approximation. Color families, dust, starburst light, and sparkle are rendering proxies rather than gas dynamics, radiative transfer, or star formation. (Sources: [Toomre and Toomre encounter models](https://www.giss.nasa.gov/pubs/abs/to03000u.html), `tests/playground/src/demos/nbody/model.js`, `tests/playground/src/demos/nbody/shaders.js`.)

The 65,536-body Apex study is an explicit stress mode. It uses a depth-5 uniform tree, a cored profile that reduces central leaf overload, and a 20 Hz force cadence while rendering between solves. The default study uses 8,192 mutual bodies at 60 Hz so hardware headroom can grow the visual tracer population into the millions. No cadence or count converts the current uniform tree into an adaptive FMM; inspect maximum leaf occupancy and clamped-body diagnostics when tuning clustered scenes. (Sources: `tests/playground/src/demos/nbody/model.js`, `engine/sim/particles/ParticleFMM.js`.)

## Configure a world

Select a backend when creating the world:

```js
const world = await createParticleSimWorld(gpuDevice, {
  maxParticles: 65_536,
  longRangeConfig: {
    backend: 'fmm',
    domainHalfExtent: 32,
    targetLeafOccupancy: 32,
    softening: 0.05,
    coupling: 1,
  },
});
```

Change it later through the public Engine API:

```js
configureParticleLongRange(world, {
  backend: 'pme',
  gridSize: 32,
  domainHalfExtent: 32,
  ewaldAlpha: 1.25,
  realCutoff: 2,
});

const state = getParticleLongRangeState(world);
```

`stepParticleSimWorld()` records exactly one selected long-range solver. Existing callers that use `enableNBody` continue to select the direct backend. Changing an immutable topology parameter such as FMM depth, mesh size, mesh window radius, or prolate bandwidth safely recreates only the long-range solver resources. ESP also recreates its precomputed split spectrum when the domain extent or real-space cutoff changes. (Source: `engine/sim/particles/ParticleSimWorld.js`.)

## FMM pipeline

The WebGPU FMM implementation performs the complete uniform-octree sequence:

1. Count and scatter particles into Morton-ordered leaves.
2. P2M: accumulate source strength and center information in each leaf.
3. M2M: translate child moments up the tree.
4. M2L: translate the 189-cell interaction list into first-order local fields.
5. L2L: propagate local fields to children.
6. L2P plus P2P: evaluate the local field and exact neighboring-leaf interactions.

The current clean implementation stores monopole source moments and first-order Cartesian local fields. It uses a uniform tree with depths 2 through 5, clamps particles to the configured open domain for tree assignment, preserves inactive-target/source semantics from the direct solver, supports caller-owned command encoders, and exposes pass, memory, scatter, and readback diagnostics. This is a working GPU baseline, not an adaptive or high-order production FMM. (Sources: `engine/sim/particles/ParticleFMM.js`, `engine/sim/particles/ParticleLongRangeMath.js`.)

## PME and experimental ESP

Both particle-mesh paths use an Ewald split: short-range complementary interactions under periodic minimum-image boundaries plus a reciprocal solve on a three-dimensional complex FFT grid. PME uses the conventional Gaussian split with cubic B-spline assignment. ESP numerically solves the even prolate-spheroidal Sturm-Liouville eigenproblem in an orthonormal Legendre basis, normalizes the resulting compact radial density, integrates its real-space complement, and precomputes its cosine-transform response for the spectral influence function. It also uses the prolate window for particle-grid assignment and deconvolves that window's measured response. (Sources: `engine/sim/particles/ParticleMeshEwald.js`, `engine/sim/particles/ParticleLongRangeMath.js`.)

The Phys.org result concerns **Ewald Summation with Prolates**, not FMM. The underlying paper reports lower grid, communication, and particle-grid costs at matched high accuracy in large MPI molecular-dynamics runs. This browser implementation tests the algorithmic idea on one WebGPU device; it does not reproduce the paper's distributed LAMMPS/GROMACS implementation or its performance claim. Current local evidence shows that ESP compiles and produces finite output, but the wider assignment window can make it slower than PME at small browser workloads. Keep `esp` labelled experimental until matched-error GPU timestamp benchmarks demonstrate a repeatable win. (Sources: [Accelerating Molecular Dynamics Simulations using Fast Ewald Summation with Prolates](https://arxiv.org/abs/2505.09727), [Phys.org summary](https://phys.org/news/2026-06-mathematicians-unleash-multifold-boost-supercomputer.html), `tests/playground/src/demos/prolateParticles.js`.)

WGSL core atomics support only `i32` and `u32`, so the particle-mesh deposition pass assigns one invocation to each grid cell and gathers nearby sorted particles instead of using unsupported floating-point atomic additions. The sort/scatter stages use integer atomics. (Sources: [WGSL atomic types](https://www.w3.org/TR/WGSL/#atomic-types), `engine/sim/particles/ParticleMeshEwald.js`.)

## Validate and benchmark

The Prolate Particle Lab is hidden from the normal menu by default while ESP remains research-grade, but its [direct Playground link](../../tests/playground/?demo=prolate-particles) remains available. It runs the real Engine exports and lets you compare direct, FMM, PME, and ESP backends, particle count, and FFT grid size. The HUD separates host command-recording duration from asynchronous queue-drain notification; neither value is shader-only GPU time. Use the direct-vs-FMM relative L2 comparison as a correctness signal, not a visual approximation. (Source: `tests/playground/src/demos/prolateParticles.js`.)

Open the [long-range invariant suite](../../tests/particle-long-range.html) for CPU layout and Morton tests, an analytic two-body direct test, numerical prolate-window checks, randomized GPU FMM comparison against a float64 direct oracle, and live PME/ESP finite-output and scatter checks. Always compare methods at equivalent error before making a performance decision. (Sources: `tests/particle-long-range.html`, `engine/sim/particles/ParticleLongRangeMath.js`.)

## Current limits

- FMM uses a uniform rather than adaptive octree and low-order expansions.
- FMM depth is capped at 5 to bound GPU memory and dispatch count.
- PME and ESP require a power-of-two grid from 8 through 64.
- PME and ESP model periodic images; FMM and direct do not.
- ESP's numerical PSWF split and assignment window are clean-room implementations of the published mathematical operators, not copied LAMMPS or GROMACS code.
- Reported browser queue-drain durations include previously queued work, driver scheduling, and notification delay.
- No backend is selected automatically from particle count because boundary semantics and the hardware-dependent crossover must remain explicit.

## See also

- [Particle System](particles.md)
- [Physics and Simulation](physics.md)
- [Virtual GPU](vgpu.md)
