---
title: Plauna Getting Started
description: Initialize Plauna and create UI, measure text, and manage surfaces, mirroring the examples in the Plauna README.
updated: 2026-06-05
---

# Plauna Getting Started

Initialize Plauna and create UI. This mirrors the examples in `plauna/README.md`. Assumes [Install & Run](../getting-started/install.md) is done.

## Initialize

Plauna bootstraps through the engine's editor bootstrap:

```javascript
import { initializePlauna } from './engine/EngineEditorBootstrap.js';

const plauna = await initializePlauna({
  root: document.getElementById('plauna-root'),
  getVGPU: () => viewport.vgpu,   // reuse the shared GPU device
  engine: window.ParticleEngine,
  editor: editorApp,              // optional
  useCSS: true,
  textEngine: 'pretext',
});
```

`PlaunaApp` options:

| Option | Meaning |
| --- | --- |
| `root` | DOM element for the Plauna root. |
| `getVGPU` | Function returning the VGPU instance to share. |
| `engine` | The engine instance. |
| `editor` | An `EditorApp` instance (optional). |
| `useCSS` | Load Plauna CSS (default `true`). |
| `textEngine` | Text engine to use (default `'pretext'`). |

## Measure text without the DOM

```javascript
const handle = plauna.textService.prepare('Hello, world!', {
  fontFamily: 'Inter', fontSize: 16, fontWeight: 400,
});
const layout = plauna.textService.layout(handle, 300, 24);
console.log(`Lines: ${layout.lineCount}, Height: ${layout.height}px`);
```

## Create a GPU surface

```javascript
const surface = plauna.createSurface({
  id: 'viewport-surface',
  kind: 'viewport',
  shape: 'rect',
  interactive: true,
});
```

## Enhance existing editor panels

```javascript
await plauna.enhanceExistingPanels(editorApp.panels);
```

## Choosing a rendering mode

- **DOM** for text-heavy, accessible UI.
- **DOM+GPU** for panels with GPU visuals.
- **GPU** for warped/particle-reactive, performance-critical UI.

## See also

- [Plauna Architecture](architecture.md).
- Plauna **API Reference** — `core/app`, `surface/`, `text/`, `widgets/`.
