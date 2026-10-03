---
title: Engine Getting Started
description: Bring the engine up in a browser and understand its bootstrap entry points and minimal frame flow.
updated: 2026-10-03
---

# Engine Getting Started

Start with the [Engine + Plauna SDK setup](../guides/sdk-distribution.md#get-and-serve-the-sdk), then open `examples/source.html?case=engine` or `examples/compiled.html?case=engine` on its local server. Both run the same ECS, native physics and rendering scenario. The [tested source and compiled snippets](../guides/sdk-distribution.md#use-source-modules-or-the-compiled-runtime) show a smaller first step with entity cleanup.

## Prerequisites

- A current browser that exposes WebGPU on the machine. Verify both
  `navigator.gpu` and a successful `navigator.gpu.requestAdapter()` call.
- The SDK served over HTTP from `engine-sdk/` with `python serve_sdk.py --port 9001`. The full development repository uses `python start_server.py` instead; its Editor and OS pages are separate from the base SDK.

## Bootstrap entry points

Pick the bootstrap that matches your use case:

| Entry | Use when |
| --- | --- |
| `engine/EngineBootstrap.js` | You want the full engine runtime. |
| `plauna/index.js` | You want the base SDK's UI APIs without requiring an Editor. |
| `engine/EngineEditorBootstrap.js` | You are using the full Platform or development stack and want Editor integration. |
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

> **API reference:** The SDK already includes its generated reference under `MD/engine/reference/`; open `MD/viewer/` on the SDK server. Documentation maintainers regenerate it with `MD/tools/extract_api.py` from the matching full source snapshot. Application setup does not require API extraction or downloading documentation libraries.

## Where to look next

- Rendering: `engine/render/` — start with `SceneRenderer.js` and `DualModeRenderer.js`.
- Simulation: `engine/sim/SimulationUpdate.js`.
- ECS components: `engine/ecs/EntitySchema.js`.
- GPU layer: `engine/core/gpu/VirtualGPU.js`.

## See also

- [Engine Architecture](architecture.md).
- [Boot Sequence](../concepts/boot-sequence.md) (OS-level).
