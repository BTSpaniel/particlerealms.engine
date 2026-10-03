---
title: Engine Overview
description: The pure-browser, GPU-first runtime foundation — WebGPU device, frame graph, ECS, rendering, simulation, networking, and audio.
updated: 2026-06-05
---

# Engine Overview

The engine (`engine/`) is the foundation of the whole stack: a **pure-browser, GPU-first** runtime providing the WebGPU device, frame graph, ECS, rendering, simulation, networking, and audio that every other subsystem builds on.

## What it provides

- A shared **WebGPU device** and frame pipeline (the OS's GPU service runs on this).
- An **ECS** for all runtime state.
- A **rendering** pipeline (passes, materials, shaders, lighting, post-processing, volumes).
- **Simulation** systems (physics, particles, fluids, cloth, AI, world).
- **Networking** (protocol, replication, client/server) and a **collab** mesh.
- **Audio**, **resources/assets**, a **modding** layer, runtime **UI**, and dev **tools**.

## Audience

Engine, graphics, and simulation developers. App developers usually consume the engine indirectly through the OS and Plauna; read this when you work on rendering, simulation, or low-level GPU code.

## Development principles

From `engine/README.md`:

- **Pure browser runtime** — no Node.js dependencies.
- **GPU-first** — prefer compute shaders for heavy simulation.
- **ECS-driven** — all state lives in components.
- **Modular** — each subsystem is independent and testable.

## Top-level modules

| Module | Path | Purpose |
| --- | --- | --- |
| Core | `engine/core/` | WebGPU device, frame graph/pipeline, math, memory, scheduler, platform, workers, save, profiling, `ResourceManager` |
| ECS | `engine/ecs/` | entities, components, systems, queries, storage, prefabs, world |
| Render | `engine/render/` | renderers, materials, passes, lighting, culling, post-process, SDF, volumes, particles |
| Sim | `engine/sim/` | physics, particles, fluids, cloth, AI, world simulation |
| Net | `engine/net/` | protocol, replication, client, server |
| Collab | `engine/collab/` | multi-user mesh: identity, integrity, presence, sync |
| Audio | `engine/audio/` | audio core, synth, spatial audio |
| Animation | `engine/animation/` | animation systems |
| Gameplay | `engine/gameplay/` | rules, events, AI, narrative, perception |
| Voxel / World | `engine/voxel/`, `engine/world/` | voxel and world systems |
| Resources | `engine/resources/` | resource/package system |
| Mod | `engine/mod/` | scripting API + sandbox |
| UI / Tools | `engine/ui/`, `engine/tools/` | runtime UI, inspector/profiler |
| Compat | `engine/compat/` | asset importers / compatibility |

## Entry points

- `engine/EngineBootstrap.js` — full engine bootstrap.
- `engine/EngineEditorBootstrap.js` — bootstrap that also wires the editor and Plauna (`PE.Plauna`).
- `engine/core/AppBootstrap.js` — app-level bootstrap.
- `engine/*Imports.js` — import maps (`EngineImports`, `EcsImports`, `RenderImports`, `MathImports`, `ToolsImports`).
- `engine/version.js` — version info.

## Next steps

- [Engine Architecture](architecture.md) — how the modules fit together.
- [Engine Getting Started](getting-started.md) — boot and render something.
- Engine **API Reference** — per-module symbol reference (run `tools/extract_api.py`).
