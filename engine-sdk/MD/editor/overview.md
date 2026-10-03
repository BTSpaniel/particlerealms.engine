---
title: Editor Overview
description: The scene and asset authoring IDE built on the engine — viewport, dockable panels, project filesystem, gizmos, and material authoring.
updated: 2026-06-05
---

# Editor Overview

The editor (`editor/`) is the scene and asset authoring IDE built on the engine. It was the first major application on top of the runtime and established the panel/workbench and project-filesystem patterns that Plauna and the OS later generalized.

## What it provides

- A viewport for editing scenes against the engine's renderer.
- Dockable panels (inspector, hierarchy, asset/material tools).
- A project/filesystem abstraction (`editor/js/ProjectManager.js`).
- Gizmos, spawnables, and material authoring.

## Audience

Content creators authoring scenes/assets, and tools developers extending the editor.

## Layout

| Path | Purpose |
| --- | --- |
| `editor/index.html` | The editor shell page. |
| `editor/js/main.js` | Entry point. |
| `editor/js/EditorApp.js` | The main application class (large; orchestrates panels, viewport, project). |
| `editor/js/ProjectManager.js` | Project / filesystem abstraction. |
| `editor/js/components/` | UI components. |
| `editor/js/panels/` | Dockable editor panels. |
| `editor/js/viewport/` | The 3D viewport. |
| `editor/js/gizmos/` | Transform/manipulation gizmos. |
| `editor/js/spawnables/` | Spawnable entity definitions. |
| `editor/js/modules/` | Feature modules. |
| `editor/js/project/` | Project data/handling. |
| `editor/js/themes/` | Editor theming. |
| `editor/js/utils/` | Utilities. |
| `editor/js/workers/` | Web workers. |
| `editor/mats/` | Materials. |

## Relationship to the engine and Plauna

- The editor bootstraps through `engine/EngineEditorBootstrap.js`.
- Plauna can **enhance** existing editor panels without replacing them (`plauna.enhanceExistingPanels(...)`), sharing the same VGPU instance and ECS patterns. See [Plauna Overview](../plauna/overview.md).

## Next steps

- [Editor Architecture](architecture.md).
- [Editor Getting Started](getting-started.md).
- Editor **API Reference** — generated from `editor/js/` by `tools/extract_api.py`.
