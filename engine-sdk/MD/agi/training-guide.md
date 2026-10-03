---
title: AGI Training Guide
description: How to train the parasite rig from standing to full locomotion across seven curriculum stages, plus fixes for common problems.
updated: 2026-06-05
---

# AGI Training Guide

How to train the parasite rig from standing to full locomotion, and how to fix common problems. Condensed from `agi/README.md` and `agi/TRAINING_GUIDE.md`.

## Curriculum stages

Training uses curriculum learning with 7 progressive stages. The `CurriculumManager` advances automatically as criteria are met.

| # | Stage | Approx. time | Goal |
| --- | --- | --- | --- |
| 1 | Standing | 1–2 h | Stand upright for 10 s |
| 2 | Balance Recovery | 2–3 h | Recover from random perturbations |
| 3 | Walking Forward | 4–6 h | Walk at 1 m/s sustained |
| 4 | Directional Control | 6–8 h | Walk toward target positions |
| 5 | Obstacle Navigation | 8–12 h | Navigate around obstacles |
| 6 | Dynamic Terrain | 12–16 h | Walk on slopes up to 30° |
| 7 | Full Locomotion | 16–24 h | Run, jump, turn, crouch |

**Total:** ~24–72 h for complete mastery.

## The training loop

Each step:

1. `ObservationBuilder` reads the ragdoll into a 12D observation.
2. The policy network outputs a 17D action.
3. `MotorController` applies the action as bone impulses.
4. PBD physics advances; `RewardFunction` scores the result.
5. Experience is buffered (with GAE); `PPOTrainer` updates the policy.

## Tuning tips

- **Reward shaping** — adjust weights in `agi/config/` (or the Studio Reward editor). Increasing the uprightness weight helps early stages.
- **Buffer/batch size** — larger buffers stabilize updates but use more memory.
- **Curriculum pacing** — if a stage stalls, verify its advancement criteria before moving on.

## Troubleshooting

**Ragdoll not learning?**
- Confirm WebGPU is available in the browser.
- Verify physics is running at 60 FPS.
- Increase the uprightness reward weight.

**Performance issues?**
- Close other browser tabs.
- Reduce buffer size (default 2048).
- Disable debug visualizations.
- Check GPU utilization.

**Browser crashes?**
- Reduce buffer size.
- Clear the tensor cache.
- Save the model frequently.

## See also

- [AGI Getting Started](getting-started.md).
- [AGI Architecture](architecture.md).
- AGI **API Reference** — `core/RewardFunction`, `core/CurriculumManager`, `brain/trainers/`.
