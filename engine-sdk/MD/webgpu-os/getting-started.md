---
title: WebGPU OS Getting Started
description: Boot the OS in a browser and build a minimal capability-gated app.
updated: 2026-09-12
---

# WebGPU OS Getting Started

Boot the OS and build a minimal app. Assumes [Install & Run](../getting-started/install.md) is done.

## Boot the OS

```bash
python start_server.py
# then browse to:
#   http://127.0.0.1:9001/webgpu-os/
```

Or embed it (see [Quickstart](../getting-started/quickstart.md)):

```javascript
import { bootWebGpuOS } from './webgpu-os/index.js';
const os = await bootWebGpuOS();
```

## Open just one app

The app page runs one selected application using the same WebOS runtime and
normal app launcher. GPU surfaces, permissions, storage, dialogs and other
kernel services remain available behind it. The taskbar, wallpaper, desktop
effects and automatically opened shell apps are not mounted.

Open either session mode:

```text
/webgpu-os/app.html?app=os.calculator&session=demo
/webgpu-os/app.html?app=os.paint&session=profile
```

`demo` is the default. The page creates a browser-owned credentialless frame
and a real temporary Realm Passport. Its existing storage drivers use that
temporary partition. Demos in one top-level browser page share the partition;
reloading, navigating or closing that top-level page discards it. The saved
WebOS profile is separate. Automatic remote assistant connections, resident
network startup and the personal Companion bridge are unavailable in this mode.
Browsers without credentialless-frame support show an error and offer profile
mode; they do not fall back to saved storage.

`profile` uses the normal saved WebOS account and app data. If no account is
active, the existing account screen appears first. Selecting or creating a
profile opens the chosen app without restoring other windows. The page does
not overwrite the app's normal desktop window position or size.

For a same-origin homepage embed, use the same page:

```html
<iframe src="/webgpu-os/app.html?app=os.calculator&amp;session=demo"
        title="Calculator demo" width="100%" height="700"
        loading="lazy" allow="fullscreen"></iframe>
```

The public homepage lists the visible apps from `webgpu-os/apps/index.json`
and their manifests. Search or filter the catalogue, then choose an app to
open. Hidden shell overlays and background services are omitted. The catalogue
does not load the OS or application modules until an app is opened.

Most entries start in a temporary demo. Browser Bridge, Tab Manager and Request
Rules use a saved profile because the personal Companion bridge is unavailable
in temporary sessions. Their actions say **Open with profile**. The Virtual
Realm is marked **Coming soon** and has no launch action: its trusted world
runtime composition is not yet wired into the production OS. AI Echo needs
an AI provider, LLM Runtime needs a model, and SecureMesh needs a Realm network
connection; their cards explain that setup.

The homepage keeps one app open at a time. **Close app** removes the frame.
Both the catalogue and app page offer session selection. The app page also
provides restart and a link to open the app in the full OS. App features that
need another visible application should use the full OS.

After adding or changing a manifest, refresh the source homepage cards with
`python tools/generate_homepage_app_catalog.py`. Add `--check` to verify that
the cards are current without rewriting them. The normal website packager
regenerates its copy from the same manifests. Names and membership come from
the OS registry; `bundler/app_catalog.py` supplies concise descriptions and
setup notes.

For a custom host with a sized `#app` container, the source or shared compiled
runtime exposes the same option:

```javascript
import { bootWebGpuOS } from './webgpu-os/index.js';

const runtime = await bootWebGpuOS({
  singleAppId: 'os.paint',
  desktopSelector: '#app',
  session: 'profile',
  onAppState: ({ state, message }) => console.info(state, message),
});
```

`onAppState` reports `loading`, `profile`, `ready`, `error` or `closed`.
`ready` means the normal app mount completed; apps with asynchronous renderer
initialization retain their own renderer status. To close an owned runtime,
await `runtime.desktop.shutdownRuntimeHandoff('app-host-closed')`, destroy
`runtime.echoAvatarClient`, then await `runtime.kernel.stop()` using `finally`
to guarantee kernel cleanup.

The regular OS and platform builds include `app.html`, `app-boot.js` and
`app.css`. They reuse the same verified runtime bytes as the desktop; no
individual app build is required. The outer demo page keeps the compiled loader
inert until its temporary frame runs. A broken or outdated compiled runtime
fails visibly rather than importing source code as a fallback.

Static releases can deliver an oversized compressed runtime as ordered byte
parts. The loader checks each part's SHA-256, rejoins the original gzip, checks
the complete decoded runtime's size and SHA-384, then executes it once. The
homepage demo and desktop still use one shared compiled runtime; no per-app
bundles are produced. See [Shared runtime files on static hosting](installed-system-releases.md#shared-runtime-files-on-static-hosting)
for file limits and the whole-gzip compatibility path.

Sources: `webgpu-os/app-boot.js`, `webgpu-os/index.js`,
`webgpu-os/shell/Desktop.js`, `webgpu-os/kernel/KernelSession.js`,
`bundler/site.py`, `bundler/app_catalog.py`, `bundler/runtime_transport.py`,
and `tests/index.html`.

## Build a minimal app

1. **Create the folder** `webgpu-os/apps/hello/`.
2. **Add a manifest** `apps/hello/manifest.json`:

```json
{
  "id": "hello",
  "name": "Hello",
  "version": "0.1.0",
  "entry": "main.js",
  "surface": "window",
  "icon": "👋",
  "category": "utility",
  "permissions": ["ui.notify"]
}
```

3. **Add the entry module** `apps/hello/main.js` — default-export a class with `mount`:

```javascript
export default class HelloApp {
  async mount(root, syscalls) {
    root.innerHTML = '<h1 style="padding:16px">Hello, WebGPU OS</h1>';
    // syscalls are capability-gated; this requires "ui.notify"
    await syscalls.ui?.notify?.({ title: 'Hello', body: 'App mounted.' });
  }
  unmount() { /* clean up timers, GPU resources, listeners */ }
}
```

4. **Register it** — add `"hello"` to `webgpu-os/apps/index.json`.
5. **Reload** the OS. The app appears in the Start Menu and is discovered by `AppRegistry`.

## Key rules

- Declare **only** the permissions you use; they are checked by `guardSyscalls`. See [Security & Trust Model](../concepts/security-model.md).
- Treat GPU resources as reconstructable — handle the `device-lost` fan-out. See [GPU Device Sharing](../concepts/gpu-device-sharing.md).
- For distribution, package the app as a `.prpkg` v2 (`pkg-studio` / `PackageBuilder`).

## See also

- [Architecture](architecture.md) — the app entry contract and package pipeline.
- [App Catalog](app-catalog.md) — existing apps to learn from.
- `webgpu-os/templates/` — `template-app` / `template-mod` starters.
