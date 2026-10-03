---
title: Editor
description: Section index for the editor — scene and asset authoring IDE built on the engine (overview, architecture, getting started, API reference).
updated: 2026-06-05
---

# Editor

Scene and asset authoring IDE built on the engine. Source: `editor/`.

## In this section

- [Overview](overview.md) — what the editor is and its layout.
- [Architecture](architecture.md) — `EditorApp` orchestration and integration points.
- [Getting Started](getting-started.md) — launch and orientation.
- **API Reference** — per-file symbols from `editor/js/` (browse `editor/reference/`).

## Module map

```text
editor/
  index.html         editor shell page
  js/
    main.js          entry point
    EditorApp.js     main application class
    ProjectManager.js project/filesystem abstraction
    components/      UI components
    panels/          dockable panels
    viewport/        3D viewport
    gizmos/          transform gizmos
    spawnables/      placeable entity templates
    modules/         feature modules
    project/         project data/handling
    themes/          editor themes
    utils/           utilities
    workers/         web workers
  mats/              materials
```

## Related

- [Plauna](../plauna/index.md) — the UI framework that enhances editor panels.
- [Engine](../engine/index.md) — the runtime the editor renders with.
