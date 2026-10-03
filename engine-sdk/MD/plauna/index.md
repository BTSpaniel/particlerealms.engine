---
title: Plauna
description: Section index for Plauna — the hybrid DOM/GPU UI framework and workbench (overview, architecture, getting started, API reference).
updated: 2026-06-05
---

# Plauna

Hybrid DOM/GPU UI framework and workbench. Source: `plauna/`.

## In this section

- [Overview](overview.md) — features, rendering modes, module map.
- [Architecture](architecture.md) — the state → visual tree → DOM/GPU pipeline.
- [Getting Started](getting-started.md) — initialize, measure text, create surfaces.
- **API Reference** — per-file symbols from `plauna/` (browse `plauna/reference/`).

## Module map

```text
plauna/
  core/         app (PlaunaApp), UINode, VisualTree, DOMRenderer, BindingEngine,
                StateStore, DirtyGraph, registry, events, ModuleTester
  layout/       layout engine
  surface/      GPU surface management
  workspace/    workspaces, panels, splitters, compositor, switcher
  widgets/      UI atoms (Primitive, Form, Navigation, DataViews, Layout, Feedback)
  text/         DOM-free text measurement/layout
  input/        input handling
  motion/       animation/motion
  themes/ style/ styles/   design tokens + CSS
  particle/     VGPU bridge for GPU UI
  notifications/ toasts/notifications
  console/      dev REPL / system console
  showcase/ lab/  demos + experiments
  editor/ ecs/   editor integration + UI components
```

## Related

- [WebGPU OS](../webgpu-os/index.md) — the shell built on Plauna workspaces.
- [GPU Device Sharing](../concepts/gpu-device-sharing.md).
