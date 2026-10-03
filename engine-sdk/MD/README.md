# WebGPU OS Documentation (`MD/`)

This folder is the **single source of truth** for the whole stack's documentation: plain Markdown that AI tools read directly, rendered for humans by three viewers that all read these same files.

- **Start reading:** [`index.md`](index.md) (the docs home).
- **Style & process:** [`contributing/docs-style-guide.md`](contributing/docs-style-guide.md) and [`contributing/doc-contribution-workflow.md`](contributing/doc-contribution-workflow.md).

## Three viewers, one source

1. **Zero-build HTML viewer** — serve the repo and open `MD/viewer/` (e.g. `http://127.0.0.1:9001/MD/viewer/`). No build step.
2. **MkDocs Material** — `pip install -r _config/requirements.txt && mkdocs serve -f _config/mkdocs.yml`.
3. **`docs` app in WebGPU OS** — open **Docs** from the OS Start Menu (embeds the same viewer).

## Layout

```text
MD/
  index.md            docs home
  getting-started/    overview, install, quickstart, glossary, faq
  concepts/           whole-stack: architecture, history, boot, gpu-sharing, security, data-flow
  engine/ editor/ plauna/ agi/ webgpu-os/
                      per-subsystem overview/architecture/getting-started/index
                      + reference/ (generated API reference)
  contributing/       docs standards
  _config/            nav.json, mkdocs.yml, requirements.txt, search-index.json
  _templates/         page skeletons
  viewer/             zero-build HTML viewer (index.html, viewer.js, viewer.css)
  assets/vendor/      offline marked / highlight.js / mermaid
  tools/              fetch_vendor.py, build_docs.py, extract_api.py
```

## Regenerate derived artifacts

Run from `MD/` (Python only — no Node):

```bash
python tools/fetch_vendor.py    # one-time: vendor viewer libs offline
python tools/extract_api.py     # (re)generate API reference from source
python tools/build_docs.py      # rebuild search index + validate nav
```

> Existing docs under `../docs/`, `../webgpu-os/docs/`, `../engine/docs/`, and per-component `.md` files are **read-only reference sources**; new documentation lives here.
