---
title: AGI Getting Started
description: Launch AGI Studio and start a training run, with the requirements and steps from the AGI README.
updated: 2026-06-05
---

# AGI Getting Started

Launch AGI Studio and start a training run. Based on `agi/README.md`. Assumes [Install & Run](../getting-started/install.md) is done.

## Requirements

- A current browser that exposes WebGPU on the machine. Verify both
  `navigator.gpu` and a successful `navigator.gpu.requestAdapter()` call.
- 8 GB RAM minimum (16 GB recommended); a dedicated GPU recommended.

## Launch AGI Studio

```bash
python start_server.py
# then browse to:
#   http://127.0.0.1:9001/agi/studio/
```

## First run

1. **Create or load a project** — click **New Project** in the header. The system initializes with default settings and configures the WebGPU device.
2. **Start training** — click **Start Training** in the viewport controls. The parasite rig injects into the ragdoll; metrics update live; training runs at 60 FPS.
3. **Save your model** — click **Save Model**; the model downloads as JSON. Load it later to continue.

## Default hyperparameters

| Parameter | Value |
| --- | --- |
| Learning rate | 3e-4 |
| Clip range | 0.2 |
| Gamma | 0.99 |
| Lambda (GAE) | 0.95 |
| Batch size | 64 |
| Buffer size | 2048 |

## Next steps

- [Training Guide](training-guide.md) — stages, tuning, troubleshooting.
- [AGI Architecture](architecture.md) — how the pieces connect.
- AGI **API Reference** — `core/RagdollController`, `brain/`, `tensor/`.
