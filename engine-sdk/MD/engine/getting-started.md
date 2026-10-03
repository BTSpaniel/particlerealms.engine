---
title: Engine Getting Started
description: Bring the engine up in a browser and understand its bootstrap entry points and minimal frame flow.
updated: 2026-06-05
---

# Engine Getting Started

Bring the engine up in a browser and understand the bootstrap entry points. Assumes [Install & Run](../getting-started/install.md) is done.

## Prerequisites

- A current browser that exposes WebGPU on the machine. Verify both
  `navigator.gpu` and a successful `navigator.gpu.requestAdapter()` call.
- The repo served over HTTP (`python start_server.py`).

## Bootstrap entry points

Pick the bootstrap that matches your use case:

| Entry | Use when |
| --- | --- |
| `engine/EngineBootstrap.js` | You want the full engine runtime. |
| `engine/EngineEditorBootstrap.js` | You also want the editor + Plauna wired (`PE.Plauna`, `initializePlauna`). |
| `engine/core/AppBootstrap.js` | You're building an app-level entry. |

## Import maps

The engine groups imports into barrels so you can pull in a coherent set without long relative paths:

- `EngineImports.js` — engine-wide.
- `EcsImports.js` — ECS.
- `RenderImports.js` — rendering.
- `MathImports.js` — math.
- `ToolsImports.js` — dev tools.

## Minimal flow

The engine is GPU-first and ECS-driven, so a typical session:

1. Bootstrap the engine against a WebGPU canvas (acquires the device + frame pipeline).
2. Create or load an ECS **world**.
3. Spawn entities and attach components (see `engine/ecs/EntitySchema.js` for the component catalog).
4. Register systems (render, sim) that run each frame.
5. Start the frame loop — `render/` draws from ECS state; `sim/SimulationUpdate.js` advances simulation.

> **Note:** Exact function signatures are generated into the Engine **API Reference** by `tools/extract_api.py`. Run it, then browse `engine/reference/` for `EngineBootstrap`, `ecs/EntityManager`, `render/SceneRenderer`, and `sim/SimulationUpdate`.

## Where to look next

- Rendering: `engine/render/` — start with `SceneRenderer.js` and `DualModeRenderer.js`.
- Simulation: `engine/sim/SimulationUpdate.js`.
- ECS components: `engine/ecs/EntitySchema.js`.
- GPU layer: `engine/core/gpu/VirtualGPU.js`.

## See also

- [Engine Architecture](architecture.md).
- [Boot Sequence](../concepts/boot-sequence.md) (OS-level).
