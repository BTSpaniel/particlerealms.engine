---
title: Editor Getting Started
description: Launch the editor in a browser and learn where the viewport, panels, and project files live.
updated: 2026-06-05
---

# Editor Getting Started

Open the editor and learn where things live. Assumes [Install & Run](../getting-started/install.md) is done.

## Launch

```bash
python start_server.py
# then browse to:
#   http://127.0.0.1:9001/editor/
```

The page (`editor/index.html`) loads `js/main.js`, which constructs `EditorApp` and mounts the viewport and panels.

## Orientation

| You want to… | Look at |
| --- | --- |
| Understand the app shell | `editor/js/EditorApp.js` |
| Add/modify a panel | `editor/js/panels/` |
| Work on the 3D viewport | `editor/js/viewport/` |
| Add a placeable entity | `editor/js/spawnables/` |
| Manipulate transforms | `editor/js/gizmos/` |
| Handle projects/files | `editor/js/ProjectManager.js`, `editor/js/project/` |
| Author materials | `editor/mats/` |

## Extending the editor

- New features are typically added as **modules** (`editor/js/modules/`) or **panels** (`editor/js/panels/`).
- For hybrid DOM/GPU panel upgrades, enhance panels via Plauna (`plauna.enhanceExistingPanels`). See [Plauna Getting Started](../plauna/getting-started.md).

## See also

- [Editor Architecture](architecture.md).
- Editor **API Reference** (run `tools/extract_api.py`).
