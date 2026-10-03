---
title: Install & Run
description: Choose the public Engine + Plauna SDK, full Platform Template, or development stack and serve the matching entry point over HTTP.
updated: 2026-10-03
---

# Install & Run

This page distinguishes the public SDK, compiled Template, and full development source tree. Applications run in the browser. The shipped SDK and Template are ready to serve; rebuilding their JavaScript is an optional workflow with pinned prerequisites.

## Prerequisites

- **A current WebGPU-capable browser** — support depends on the browser release,
  operating system, GPU, and driver. Confirm that `navigator.gpu` exists and
  that `await navigator.gpu.requestAdapter()` returns an adapter. Localhost is
  treated as a secure context; deployed sites must use HTTPS.
- **Python** — serves files over HTTP. SDK rebuilding requires the exact Python and dependency versions recorded in `sdk-build.json`; the initial baseline is Python 3.12.7. There is **no Node.js dependency**.
- **A dedicated GPU** is recommended for the engine, AGI training, and GPU-heavy apps.

## Public SDK and Template

- **Engine + Plauna SDK:** [BTSpaniel/particlerealms.engine](https://github.com/BTSpaniel/particlerealms.engine)
  contains public SDK sources, verified compiled runtime files, PhysX PE, examples,
  offline documentation, and Python rebuild tools under `engine-sdk/`.
- **Full Platform Template:** the same repository's `Template.zip` contains the
  compiled Engine, Editor, Plauna, AGI and WebGPU OS runtime with its launcher.
- **Optional master server source:**
  [BTSpaniel/particlerealms.engine-master-server](https://github.com/BTSpaniel/particlerealms.engine-master-server)
  is a separate discovery, admission, encrypted-signaling, TURN, and trusted-node
  service. It is never gameplay authority and is not required to run the engine
  or Playground locally.

Clone the SDK and start its included server:

```bash
git clone https://github.com/BTSpaniel/particlerealms.engine.git
cd particlerealms.engine/engine-sdk
python serve_sdk.py --port 9001 --isolate
```

Open `http://127.0.0.1:9001/` for the SDK landing page or `http://127.0.0.1:9001/MD/viewer/` for its offline documentation. Source and compiled Engine, worker and Plauna examples are linked from the landing page. `--isolate` adds the headers required for threaded compute. See [SDK distribution and rebuilding](../guides/sdk-distribution.md) for source imports, verified loader use, and rebuild instructions.

For the Template, extract `Template.zip`, enter `Template/`, and run `python serve.py 9001` or `launch.bat --port 9001` on Windows. Open the local root URL and select an OS, Plauna or Canvas mode.

## Serve the full development source tree

These entry points require the full development source tree with Editor, AGI and OS application files. They are not the base SDK's startup paths. From that tree's root:

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

## Documentation maintenance in the development tree

The SDK already contains its offline viewer and generated reference. Application developers do not need to rebuild these files or fetch libraries. Maintainers use Python helpers to refresh derived documentation from a matching source snapshot. From its `MD/` directory:

```bash
# 1. Explicitly refresh locally vendored viewer libraries (requires network)
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
- **Viewer renders unstyled code / no diagrams** — verify the SDK files against the release inventory. Maintainers can explicitly refresh vendor assets in the full development tree. The viewer also has a built-in fallback renderer.

More in [FAQ & Troubleshooting](faq.md).
