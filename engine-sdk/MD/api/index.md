---
title: API Reference
description: Entry point to the stack's API — public entry points, the auto-generated per-symbol reference for each subsystem, and the curated public API maps.
updated: 2026-06-05
---

# API Reference

The stack's API is documented in two complementary forms:

- **Curated public API maps** — hand-authored tables of the common exports for each subsystem, on the [Capabilities](../guides/capabilities.md) page.
- **Auto-generated per-symbol reference** — generated from source by `tools/extract_api.py` and browsable per subsystem (use the sidebar **API Reference** groups, or the links below).

## Public entry points

| Surface | Import | Notes |
| --- | --- | --- |
| Engine (source) | `engine/EngineBootstrap.js` | All engine exports — math, ECS, render, sim, GPU, gameplay, saves. |
| Engine (compiled) | `window.PE` / `window.ParticleEngine` | After loading a built bundle. |
| Plauna | `plauna/index.js` | UI framework — app, widgets, services. |
| AGI Core | `agi/index.js` | Training, observations, rewards, brains, motion. |
| Editor | `editor/js/EditorApp.js` | Editor app orchestration + `ProjectManager.js`. |

See [Engine Stack Usage](../guides/engine-stack-usage.md) for source-mode vs bundle-mode loading patterns.

## Per-subsystem reference

Each subsystem ships a generated, per-file symbol reference (browse via the sidebar **API Reference** group under each section):

- **Engine** — [overview](../engine/index.md), reference under `engine/reference/`.
- **Editor** — [overview](../editor/index.md), reference under `editor/reference/`.
- **Plauna** — [overview](../plauna/index.md), reference under `plauna/reference/`.
- **AGI** — [overview](../agi/index.md), reference under `agi/reference/`.
- **WebGPU OS** — [overview](../webgpu-os/index.md), reference under `webgpu-os/reference/`.

> The reference is **hybrid**: signatures are regenerated from source on every run, while hand-authored notes below the `<!-- HUMAN-NOTES -->` marker are preserved. See the [API Reference Standard](../contributing/api-reference-standard.md).

## Machine-readable catalog

Agents and tools should start with [`api-index.json`](../api-index.json). It
combines all subsystem indexes and records the exact source path, source-server
import specifier, source SHA-256, detected exports, signatures, and summaries when the
source JSDoc provides them. Its `summaryCoverage` object quantifies missing
module and export prose instead of filling gaps with invented descriptions. The
per-subsystem `_index.json` files use the same record shape and remain
compatible with the documentation viewer. The catalog's `runtimeLoading`
contract distinguishes source mode from compiled mode: absolute module imports
assume `start_server.py` is serving the repository root, while the compact
production site may expose only generated bundles.

For incremental indexing, use [`api-symbols.jsonl`](../api-symbols.jsonl).
Each line contains one module or detected export and repeats the source path,
import specifier, and source hash required to verify its context. Use
[`docs-chunks.jsonl`](../docs-chunks.jsonl) when the task needs bounded prose
from guides and generated references without loading the full search index.
Both feeds have byte-identical copies at the site root and in `MD/`.

The catalog describes ES modules, not an HTTP API. Do not infer REST endpoints,
request schemas, or behavior that is absent from the linked source. Regenerate
the catalog with `python tools/extract_api.py` followed by
`python tools/build_llms.py`.
