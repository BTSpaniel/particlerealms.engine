---
title: Quickstart
description: Choose the Engine + Plauna SDK examples or boot WebGPU OS from the full Platform Template or development stack.
updated: 2026-10-03
---

# Quickstart

For the public **Engine + Plauna SDK**, follow [SDK setup](../guides/sdk-distribution.md#get-and-serve-the-sdk), then open its Engine and Plauna examples. The SDK does not include the full OS application entry point.

For the public **full Platform Template**, extract `Template.zip`, run `python serve.py 9001` inside `Template/`, open `http://127.0.0.1:9001/`, and choose **WebGPU OS**, **Plauna Showcase**, or **Blank Canvas**.

The remaining steps describe the **full development source repository**. They assume you have completed the development instructions in [Install & Run](install.md).

## 1. Boot the development OS

Serve the repo and open the OS:

```bash
python start_server.py
# then browse to:
#   http://127.0.0.1:9001/webgpu-os/
```

The boot loader shows progress (`Initializing kernel… → Discovering apps… → Loading mods… → Mounting desktop shell…`). When it finishes, `window.OS` is ready and the desktop appears.

## 2. Boot programmatically (embedding)

`webgpu-os/index.js` exports a side-effect-free boot function you can call yourself:

```javascript
import { bootWebGpuOS } from './webgpu-os/index.js';

const os = await bootWebGpuOS({
  canvasSelector:  '#os-gpu-canvas',
  desktopSelector: '#os-desktop',
  taskbarSelector: '#os-taskbar',
});

console.log(os.version);   // e.g. "0.1.0-phase1"
console.log(os.kernel);    // kernel services
console.log(os.desktop);   // shell / window manager
```

The thin `webgpu-os/boot.js` simply calls this on `DOMContentLoaded` for plain ES-module usage.

## 3. Open an app

Apps are discovered at runtime from `webgpu-os/apps/` (see `apps/index.json`). From the desktop, open the **Start Menu** and launch any app — for example **Terminal**, **Files**, or **Settings**. The full list is in the [App Catalog](../webgpu-os/app-catalog.md).

## 4. Run a security self-audit (optional)

Append `?securityAudit` to the URL (or set `window.__DEV__ = true`) to run the syscall-guard audit, capability-map drift check, and Security Doctor on boot. Results are logged to the console. See the [Security & Trust Model](../concepts/security-model.md).

```text
http://127.0.0.1:9001/webgpu-os/?securityAudit
```

## Where to go next

- Build an app/package: [WebGPU OS Architecture](../webgpu-os/architecture.md).
- Understand boot internals: [Boot Sequence](../concepts/boot-sequence.md).
- Understand GPU sharing across apps: [GPU Device Sharing](../concepts/gpu-device-sharing.md).
