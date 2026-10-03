---
title: Install & Run
description: Prerequisites (a WebGPU browser and Python — no Node.js) and how to serve the stack and these docs locally without a compile step.
updated: 2026-06-05
---

# Install & Run

This page covers prerequisites and how to serve the stack and these docs locally. Everything runs in the browser — there is no compile step.

## Prerequisites

- **A current WebGPU-capable browser** — support depends on the browser release,
  operating system, GPU, and driver. Confirm that `navigator.gpu` exists and
  that `await navigator.gpu.requestAdapter()` returns an adapter. Localhost is
  treated as a secure context; deployed sites must use HTTPS.
- **Python 3.x** — used only to serve files over HTTP and to run the docs tooling. There is **no Node.js dependency**.
- **A dedicated GPU** is recommended for the engine, AGI training, and GPU-heavy apps.

## Platform downloads and the optional network service

- **Platform downloads:** [BTSpaniel/particlerealms.engine](https://github.com/BTSpaniel/particlerealms.engine)
  publishes browser-ready distribution artifacts, including the compressed
  `.gz` bundles. It is the public download repository, not the source tree used
  to generate this API reference.
- **Optional master server source:**
  [BTSpaniel/particlerealms.engine-master-server](https://github.com/BTSpaniel/particlerealms.engine-master-server)
  is a separate discovery, admission, encrypted-signaling, TURN, and trusted-node
  service. It is never gameplay authority and is not required to run the engine
  or Playground locally.

## Serve the project

The repository ships a static HTTP server. From the repository root (`C:\Coding\game`):

```bash
python start_server.py
```

Then open the relevant entry point in a WebGPU browser:

- **WebGPU OS** — `http://127.0.0.1:9001/webgpu-os/`
- **Editor** — `http://127.0.0.1:9001/editor/`
- **AGI Studio** — `http://127.0.0.1:9001/agi/studio/`
- **These docs (zero-build viewer)** — `http://127.0.0.1:9001/MD/viewer/`

> **Why a server?** The viewers and the OS load Markdown, JSON, and ES modules with `fetch()`/`import`, which browsers block from `file://` URLs. Always serve over HTTP.

## WebGPU compatibility and the Companion are different

WebGPU **compatibility mode** is a browser/adapter capability intended for
systems backed by older native graphics APIs. When available, it still appears
through the browser's WebGPU interfaces. It does not come from an extension and
may expose lower limits or fewer optional features, so rely on adapter, feature,
and limit checks instead of a browser-name test.

The [WebGPU OS Companion Chrome extension](https://chromewebstore.google.com/detail/webgpu-os-companion/pbibggeclfjpmmbfmjagmngefonepbjj)
is an optional bridge for approved browser controls, provider connectivity, and
other OS integrations. It cannot add WebGPU to an unsupported browser, GPU, or
driver. The engine and Playground use browser WebGPU directly; install the
Companion only for the OS features that explicitly request it.

## Set up the documentation tooling

The docs are plain Markdown, but a few Python helpers build derived artifacts. From `C:\Coding\game\MD`:

```bash
# 1. Vendor the viewer's front-end libs locally (offline, no CDN)
python tools/fetch_vendor.py

# 2. Generate the per-symbol API reference from source
python tools/extract_api.py

# 3. Build the search index and validate navigation
python tools/build_docs.py
```

After step 1, open `http://127.0.0.1:9001/MD/viewer/` to browse.

## Optional: MkDocs Material site

For the polished static-site experience:

```bash
pip install -r _config/requirements.txt
mkdocs serve -f _config/mkdocs.yml
```

See [Contribution Workflow](../contributing/doc-contribution-workflow.md) for the full build/lint pipeline.

## Troubleshooting

- **Blank page / CORS errors** — you opened a `file://` URL. Serve over HTTP instead.
- **"WebGPU not available"** — update your browser or enable WebGPU; verify with `navigator.gpu` in the console.
- **Viewer renders unstyled code / no diagrams** — run `python tools/fetch_vendor.py`. The viewer still works via its built-in fallback, but without syntax highlighting or Mermaid.

More in [FAQ & Troubleshooting](faq.md).
