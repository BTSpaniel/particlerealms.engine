---
title: Plauna Overview
description: The browser-first hybrid DOM/GPU UI framework and workbench — DOM-free text, GPU surfaces, a dockable workspace, and ECS-driven UI state.
updated: 2026-06-05
---

# Plauna Overview

Plauna (`plauna/`) is a browser-first **hybrid DOM/GPU UI framework** and workbench. It extends the engine with advanced UI: DOM-free text measurement, GPU surfaces, a dockable workspace, and ECS-driven UI state. It is the compositor/window-manager foundation the WebGPU OS shell is built on.

## What it provides

From `plauna/README.md`:

- **Hybrid rendering** — DOM, DOM+GPU, and pure-GPU modes.
- **Text engine** — DOM-free text measurement/layout (Pretext-style).
- **Surface graph** — GPU-accelerated surfaces with clipping, warping, composition.
- **Workbench layout** — dockable panels, tabs, splitters, floating windows.
- **ECS integration** — a dedicated UI world with component-driven state.
- **Zero dependencies** — pure ES modules, no build step.

## Audience

UI and app developers. OS shell developers depend on Plauna's workspace/surface/widget systems.

## Rendering modes

| Mode | Use for |
| --- | --- |
| **DOM** | Standard UI (inspector, forms, menus); full CSS/accessibility/text editing. |
| **DOM+GPU** | Viewports with GPU overlays; DOM structure + GPU visuals. |
| **GPU** | Warped/particle-reactive UI; pure WGSL rendering for performance-critical visuals. |

## Module map

| Module | Path | Purpose |
| --- | --- | --- |
| Core | `plauna/core/` | `app`, `UINode`, `VisualTree`, `DOMRenderer`, `BindingEngine`, `StateStore`, `DirtyGraph`, `registry`, `events`, `ModuleTester` |
| Layout | `plauna/layout/` | layout engine |
| Surface | `plauna/surface/` | GPU surface management |
| Workspace | `plauna/workspace/` | workspaces, panels, splitters, compositor, switcher |
| Widgets | `plauna/widgets/` | UI atoms (Primitive, Form, Navigation, DataViews, Layout, Feedback) |
| Text | `plauna/text/` | DOM-free text measurement/layout |
| Input | `plauna/input/` | input devices/handling |
| Motion | `plauna/motion/` | animation/motion |
| Themes / Style | `plauna/themes/`, `plauna/style/`, `plauna/styles/` | design tokens + CSS |
| Particle | `plauna/particle/` | VGPU bridge for GPU UI |
| Notifications | `plauna/notifications/` | notification system / toasts |
| Console | `plauna/console/` | dev REPL / system console |
| Showcase / Lab | `plauna/showcase/`, `plauna/lab/` | demos / experiments |
| Editor / ECS | `plauna/editor/`, `plauna/ecs/` | editor integration, UI components |

## UI ECS components

Plauna defines UI components that integrate with the engine's ECS: `UIRoot`, `UIWorkspace`, `UIZone`, `UIView`, `UILayout`, `UISurface`, `UIText`.

## Next steps

- [Plauna Architecture](architecture.md).
- [Plauna Getting Started](getting-started.md).
- Plauna **API Reference** — generated from `plauna/` by `tools/extract_api.py`.
