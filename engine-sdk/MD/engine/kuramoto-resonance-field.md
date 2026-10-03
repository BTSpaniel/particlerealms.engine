---
title: Kuramoto Resonance Field
description: The Playground's CPU and GPU Kuramoto laboratories, their exact mean-field dynamics, high-density HDR visualization, performance governors, controls, and scientific boundary.
updated: 2026-07-29
---

# Kuramoto Resonance Field

The Kuramoto Resonance Field demos turn collective phase synchronization into a large, interactive HDR sculpture. The CPU and GPU versions share the same five studies and renderer, but they integrate different numbers of real oscillators. Both report the integrated oscillator count separately from the stateless field-sample count.

- [Run the CPU demo](/tests/playground/?demo=kuramoto-cpu)
- [Run the GPU demo](/tests/playground/?demo=kuramoto-gpu)

## Mathematical model

For oscillator phase $\theta_i$, natural frequency $f_i$ in cycles per second, coupling $K$, and optional external drive $\lambda$, the demos integrate

$$
\frac{d\theta_i}{dt}
= 2\pi f_i
+ \frac{K}{N}\sum_j \sin(\theta_j-\theta_i)
+ \lambda\sin(2\pi f_d t-\theta_i).
$$

The complex order parameter

$$
Z_1 = \frac{1}{N}\sum_j e^{i\theta_j}=R_1e^{i\psi}
$$

measures first-harmonic synchronization. $R_1$ approaches zero for a distributed population and one for phase lock. The demos also report $R_2=|N^{-1}\sum_j e^{2i\theta_j}|$, which exposes two-cluster and standing-wave structure that can be hidden by $R_1$ alone.

Uniform global coupling has an exact linear-time reduction:

$$
\frac{K}{N}\sum_j\sin(\theta_j-\theta_i)
=K\left(\operatorname{Im}(Z_1)\cos\theta_i-\operatorname{Re}(Z_1)\sin\theta_i\right).
$$

This identity replaces an $O(N^2)$ pair loop with one $O(N)$ order-parameter reduction and one $O(N)$ integration pass. It is exact for the all-to-all, equal-weight model; it is not an approximation and does not apply unchanged to an arbitrary weighted network. The background and canonical model are covered by the [Kuramoto review by Acebrón et al.](https://doi.org/10.1103/RevModPhys.77.137).

## CPU path

The CPU demo uses `stepKuramotoMeanFieldDriven()` at a fixed 120 Hz simulation step. It computes $Z_1$, advances every active phase from the same immutable state, and swaps two typed-array views without copying the completed population. An adaptive governor changes the number of real CPU oscillators only after sustained timing evidence; it does not slow simulation time to hide load.

The original pairwise engine functions remain available for weighted or small networks. Their in-place output path snapshots its source, so reusing the input array cannot turn a simultaneous Euler step into an order-dependent update.

## GPU path

The GPU demo stores one `f32` phase per oscillator and starts with 1,048,576 active phases on a desktop adapter. Each fixed 120 Hz substep performs this sequence:

1. Integrate phases using the current reduced order parameter.
2. Accumulate partial $Z_1$ and $Z_2$ sums from the newly written phase buffer.
3. Complete the reduction before the next substep reads it.

Separate uniform buffers preserve the time and parameters for every encoded substep. A near-square two-dimensional dispatch avoids the 65,535-workgroup limit on one dispatch dimension without dispatching a mostly empty 4,096-wide row. A persistent readback ring samples only the small order-parameter result and rejects results from an earlier study generation. GPU timestamp queries, when supported, guide population growth using measured work instead of frame-rate guesses alone. Study resets initialize and copy only the active range; newly exposed ranges are initialized as the population grows.

The current desktop safety guard reserves at most $2^{24}$ real phases, subject to the adapter's storage-buffer limit. This is an implementation allocation guard, not a theoretical Kuramoto limit. GPU implementations at the same $2^{24}$ scale have been reported in the literature; see [Januszewski and Kostur's GPU Kuramoto implementation](https://arxiv.org/abs/0903.3852).

## High-density field renderer

The luminous field deliberately separates simulation state from display density. When field samples outnumber oscillators, repeated layers choose real oscillators by stable modulo identity; when oscillators outnumber samples, a rotating stratified mapping covers the complete population over time instead of permanently showing a low-index prefix. Each sample then derives an outer halo, interference membrane, inner resonator, or order core without storing another particle record. Increasing field samples therefore improves density and grain without falsely increasing the reported oscillator population.

The shared renderer uses the following pipeline:

1. A stateless compute pass projects samples into eight atomic-density planes: four visual materials with two contention shards each.
2. A fullscreen resolve reads each plane once into a compact HDR target, preserving cool, warm, violet, and gold structures. Texture-space glow in the presentation pass avoids another 32 density-buffer reads per HDR pixel.
3. A short, clamped history blend suppresses single-frame density noise while rejecting history after a phase kick or study reset.
4. A final pass applies bloom-like neighborhood energy, ACES tone mapping, and display conversion.

This follows the compute-density principle used by Particle Storm, but it does not copy Particle Storm's packed dynamic-state codecs, retained tiers, or cohort culling. Kuramoto phases remain `f32`, and field samples are regenerated every frame. A timestamp-driven field governor assigns the remaining frame budget after measured simulation work, while the simulation governors primarily react to their own measured costs. This prevents one slow visual pass from unnecessarily shrinking the real oscillator population. Reported field GPU time covers the timestamped compute, resolve, history, and presentation passes; WebGPU's native density-buffer clear is outside that query scope.

## Studies and controls

| Key | Study | What it demonstrates |
| --- | --- | --- |
| `1` | Freqora WaveVM | Frequency spread, phase coupling, and interference inspired by Freqora's public oscillator proof of concept. |
| `2` | Critical Synchronization | The transition from distributed phases to collective lock as $K$ crosses the population's effective threshold. |
| `3` | Forced Entrainment | Competition between natural-frequency spread and an external periodic drive. |
| `4` | Standing Wave | Two counter-rotating frequency populations, tracked with both $R_1$ and $R_2$. |
| `5` | Phase-Kick Recovery | Dephasing and recovery after an interactive impulse. |

Additional controls are shared by both versions:

- Mouse wheel adjusts coupling $K$.
- Shift + mouse wheel adjusts drive strength.
- Left click applies the same deterministic all-population phase-field force in both backends and rejects visual history.
- Space pauses or resumes integration.
- `R` resets the current study.

## Freqora attribution and scientific boundary

Study 1 credits [Freqora](https://github.com/colector1337-hub/Freqora) by Colector1337 (Michał Stankiewicz) and Grok (xAI). Its public `WaveVM` stores frequency, phase, amplitude, and waveform shape; `WaveVM::step` advances the globally coupled phases with explicit Euler and a direct nested pair loop, giving $O(N^2)$ work per step in that reference implementation. See the [source at the audited revision](https://github.com/colector1337-hub/Freqora/blob/a546789b13a9b944ac2dc0c4eb20cbdbb6a325ad/src/wave_vm.rs#L85-L112) and its [MIT software license](https://github.com/colector1337-hub/Freqora/blob/a546789b13a9b944ac2dc0c4eb20cbdbb6a325ad/LICENSE).

The demos simulate a classical phase-oscillator model. Their shells, colours, terms such as “resonance field,” and the central sculpture are an artistic mapping of phase, detuning, $R_1$, and $R_2$. They do not simulate matter-antimatter annihilation, quantum wave functions, gravity, vacuum energy, or a “Void” substrate, and they do not present those ideas as established physics. No mathematical matter-antimatter annihilation or “Void substrate” convergence model was found in the [public Freqora tree at the audited revision](https://github.com/colector1337-hub/Freqora/tree/a546789b13a9b944ac2dc0c4eb20cbdbb6a325ad).

## Key files

| File | Purpose |
| --- | --- |
| `engine/core/math/MathOscillator.js` | Pairwise and exact global mean-field CPU integrators. |
| `tests/playground/src/demos/kuramoto/model.js` | Shared studies, deterministic frequency distributions, metrics HUD, and attribution. |
| `tests/playground/src/demos/kuramoto/renderer.js` | Stateless atomic-density, HDR history, and ACES rendering pipeline. |
| `tests/playground/src/demos/kuramotoCpu.js` | Fixed-step adaptive CPU laboratory. |
| `tests/playground/src/demos/kuramotoGpu.js` | Multi-million-phase GPU integration and reduction pipeline. |

## See also

- [Particle System](particles.md)
- [Math Library](math.md)
- [Shaders and WGSL](shaders.md)
