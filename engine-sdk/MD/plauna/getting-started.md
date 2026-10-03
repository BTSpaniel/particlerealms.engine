---
title: Plauna Getting Started
description: Create an interactive retained UI with the Engine + Plauna SDK, then release its resources.
updated: 2026-10-03
---
<!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel> -->
<!-- SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha -->

# Plauna Getting Started

Create a retained panel with a working counter using the base Engine + Plauna SDK. Follow [SDK setup](../guides/sdk-distribution.md#get-and-serve-the-sdk), then save an HTML page at the SDK root with the JavaScript below in a `<script type="module">` block. An Editor instance or GPU device is not required for this DOM example.

## Create and render the UI

`createPlaunaApp()` is asynchronous. Await the initialized app, set its retained root with `visualTree.setRoot()`, and render that tree with `domRenderer.render()`. Widget constructors take an ID and an options object. (Source: `plauna/core/app.js`, `plauna/core/VisualTree.js`, `plauna/core/DOMRenderer.js`, and `plauna/widgets/Primitive/`.)

<!-- sdk-example: plauna-source -->
```javascript
const Plauna = await import(new URL('./plauna/index.js', document.baseURI).href);
const root = document.createElement('section');
document.body.append(root);
const app = await Plauna.createPlaunaApp({
  root, useCSS: true, initialState: { clicks: 0 },
  enableModuleTester: false, enableDeveloperTools: false,
  enableSmartContextMenu: false, enableHotReload: false,
});
const menu = new Plauna.Panel('main-menu', { title: 'My application', closable: false, resizable: false });
const label = new Plauna.Text('title', { content: 'Particle Realms' });
const button = new Plauna.Button('counter', { text: 'Count: 0' });
button.setStyles({ fontSize: '15px', lineHeight: '22px', padding: '10px 16px', minHeight: '44px', minWidth: '92px', outline: null });
// DOMRenderer uses textContent for this simple retained button.
button.setContent('');
button.textContent = 'Count: 0';
button.addEventListener('click', () => {
  const count = app.stateStore.get('clicks') + 1;
  app.stateStore.set('clicks', count);
  button.textContent = `Count: ${count}`;
  app.domRenderer.updateNode(button);
});
menu.appendChild(label);
menu.appendChild(button);
app.visualTree.setRoot(menu);
app.domRenderer.render(app.visualTree);

let disposed = false;
function cleanup() {
  if (disposed) return;
  disposed = true;
  app.destroy();
  app.visualTree.destroy();
  root.remove();
}
```

Click **Count: 0** to update both the app's `StateStore` and the visible button. Call `cleanup()` when closing the UI; it releases this app, its owned retained tree, and the DOM section it created. Repeated calls are safe. Documentation acceptance executes this exact code, clicks the rendered button, and checks cleanup.

## Use the compiled namespace

Keep the verified loader tag from `examples/compiled.html`, including its runtime metadata. Await `globalThis.__PE_RUNTIME_READY`, then use the returned runtime's `Plauna` namespace in place of the source import. The complete source and compiled scenarios are available at `examples/source.html?case=plauna` and `examples/compiled.html?case=plauna`.

## Integrate with an existing application

| Option | Meaning |
| --- | --- |
| `root` | Required DOM element owned by the application. |
| `initialState` | Initial values for the app's state store. |
| `getVGPU` | Optional function returning an existing shared VGPU instance for GPU surfaces. |
| `engine` | Optional Engine integration. |
| `editor` | Optional Editor integration, available in the full Platform. |
| `useCSS` | Load Plauna's supplied styles. |
| `enableDeveloperTools`, `enableHotReload` | Development features; disabled in the standalone example. |

The full development stack can use `initializePlauna()` from `engine/EngineEditorBootstrap.js` to integrate with an existing Editor. That path assumes the Editor modules and instances are present; use `plauna/index.js` for the base SDK. Share a GPU device through `getVGPU` when adding a surface instead of creating a separate device for every UI panel.

For advanced text measurement and GPU surfaces, use the [Plauna API reference](reference/core/app.md) and [architecture guide](architecture.md). These operations build on an initialized app and any required shared GPU device.

## See also

- [SDK distribution and rebuilding](../guides/sdk-distribution.md)
- [Plauna architecture](architecture.md)
- [Plauna API reference](reference/core/app.md)
