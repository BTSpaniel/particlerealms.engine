---
title: FAQ & Troubleshooting
description: Common questions and fixes — Node.js, HTTP serving, browser support, and verifying WebGPU availability.
updated: 2026-10-03
---

# FAQ & Troubleshooting

Common questions and fixes. If something here is wrong or missing, follow the [Contribution Workflow](../contributing/doc-contribution-workflow.md) to update it.

## General

**Do I need Node.js or npm?**
No. The entire stack and the documentation tooling are pure browser + Python. There is no build step required to run anything.

**Why does everything need an HTTP server?**
Browsers block `fetch()` and ES-module `import` from `file://` URLs. Inside the public repository's `engine-sdk/`, run `python serve_sdk.py --port 9001` and open `http://127.0.0.1:9001/`. The full Platform Template uses `python serve.py 9001`; the full development source repository uses `python start_server.py`. See [Install & Run](install.md) for the appropriate entry points.

**Which browser do I need?**
Use a current browser release that exposes WebGPU on your operating system and GPU. Browser version alone is not proof of capability. Verify that `navigator.gpu` exists and that `await navigator.gpu.requestAdapter()` returns an adapter. Update the browser and GPU driver if either check fails.

**Does the WebGPU OS Companion enable WebGPU or compatibility mode?**
No. Compatibility mode belongs to the browser's WebGPU implementation. The optional Companion extension supplies approved browser and provider integrations for WebGPU OS; it cannot make an unsupported GPU/browser combination support WebGPU. The engine and Playground run without the Companion when browser WebGPU is available.

## WebGPU OS

**The boot loader is stuck or shows "Boot failed".**
Open the console. The boot sequence logs each phase. Common causes: WebGPU unavailable, shell root elements missing from the DOM, or an app/mod discovery error (these are logged as warnings and do not block boot).

**How do I see security posture?**
Boot with `?securityAudit` or set `window.__DEV__ = true`. This runs the syscall-guard audit, capability-map drift check, and Security Doctor, logging results. See [Security & Trust Model](../concepts/security-model.md).

**Where do apps live, and why aren't they bundled?**
Apps are discovered and fetched at runtime from `webgpu-os/apps/` (and mods from `mods/`). They are intentionally **not** bundled so they can be added/updated without rebuilding the OS.

## Documentation viewers

**The viewer shows "Could not load navigation".**
You opened the viewer from `file://`. Serve `MD/` over HTTP.

**Code blocks are unstyled and Mermaid diagrams don't render.**
The SDK ships its viewer libraries. Check the package inventory or restore missing files from the same release. Documentation maintainers in the full development source repository can explicitly refresh vendor assets with `python MD/tools/fetch_vendor.py`; this is not an SDK installation step. The viewer falls back to a built-in Markdown renderer so pages still load.

**A reference page says "(run extract_api.py)" in the sidebar.**
The API reference hasn't been generated yet. Run `python tools/extract_api.py` then `python tools/build_docs.py`.

**Search returns nothing / only titles.**
The search index isn't built. Run `python tools/build_docs.py` to create `_config/search-index.json`. Without it, the viewer falls back to title-only search.

## Engine / AGI

**AGI training won't progress.**
Confirm WebGPU support, verify 60 FPS physics, and review reward weights. See the [Training Guide](../agi/training-guide.md).

**Performance is poor.**
Close other tabs, reduce buffer sizes, disable debug visualizations, and check GPU utilization.
