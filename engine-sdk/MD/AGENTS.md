# AGENTS.md — Guide for AI Agents Working on These Docs

> A "README for agents." If you are an AI assistant reading, navigating, or editing this documentation, **read this first.** It tells you where things live, what you may change, and the hard boundaries. This follows the [agents.md](https://agents.md/) convention and complements [`llms.txt`](llms.txt).

## Project overview

This `MD/` folder is the **single source of truth** for the WebGPU OS stack documentation. The stack has five subsystems: `engine`, `editor`, `plauna`, `agi`, and `webgpu-os`. Start at [`index.md`](index.md) for the human entry point and [`llms.txt`](llms.txt) for a curated machine index.

## Where things are (navigate here)

- **Curated, hand-authored prose:** `getting-started/`, `concepts/`, and each subsystem's `overview.md` / `architecture.md` / `getting-started.md` / `index.md`.
- **Generated API reference:** `<subsystem>/reference/**` — produced from source by `tools/extract_api.py`.
- **Navigation manifest:** `_config/nav.json` (the one place that defines curated nav for all viewers).
- **Tooling:** `tools/` (Python only — no Node).
- **Conventions:** `contributing/` (style guide, API standard, AI & accessibility, workflow).

## Commands (run from `MD/`)

```bash
python tools/extract_api.py     # regenerate API reference from source JS
python tools/build_docs.py      # rebuild search index + validate nav paths
python tools/build_llms.py      # regenerate llms.txt / llms-full.txt
python tools/fetch_vendor.py    # vendor viewer libs (network; ask the human first)
```

After editing Markdown, run `build_docs.py`. After touching source code that has reference pages, run `extract_api.py` then `build_docs.py`.

## What you MAY change

- Curated `.md` pages under `MD/` (follow the [style guide](contributing/docs-style-guide.md)).
- The **`Notes & Examples`** section (everything **below** the `<!-- HUMAN-NOTES -->` marker) in any generated reference page — this is preserved across regenerations.
- `_config/nav.json` when adding/removing curated pages.

## Hard boundaries (do NOT do these)

- **Do not edit generated content above `<!-- HUMAN-NOTES -->`** in `<subsystem>/reference/**` — it is overwritten on the next `extract_api.py` run. To fix a signature or description, **edit the JSDoc in the source file upstream**, then regenerate.
- **Do not edit files outside `MD/`** as part of docs work. The originals under `../docs/`, `../webgpu-os/docs/`, `../engine/docs/`, and per-component `.md` files are **read-only reference sources**. (The single exception, already made, is the `docs` app under `../webgpu-os/apps/docs/`.)
- **Do not invent APIs, file paths, or behavior.** Every claim about how something works must be verifiable against a source file — cite it (e.g. ``(Source: `webgpu-os/AUDIT.md` §4)``). If unsure, say so rather than guessing.
- **Do not auto-run** network or destructive commands (e.g. `fetch_vendor.py`, deletes) without explicit human approval.

## Code & writing style

- Active voice, short sentences, descriptive link text, alt text on images/diagrams. See [Docs Style Guide](contributing/docs-style-guide.md).
- Keep Markdown plain and standard (the zero-build viewer has only a minimal fallback parser).
- Make sections **self-contained**: front-load context, avoid "as mentioned above," so a chunk read in isolation still makes sense. See [AI & Accessibility](contributing/ai-and-accessibility.md).

## Security considerations

- **Never put secrets** (keys, tokens, passwords) in documentation or examples.
- The docs describe a real security/trust model; keep [Security & Trust Model](concepts/security-model.md) accurate and do not weaken or misstate capability/permission claims.
- Treat the generated reference as **machine-extracted**: it can lag the source. Verify against the cited source file before relying on it.

## Verify your work

- Run `python tools/build_docs.py` — it must exit 0 (all nav paths resolve).
- Open `viewer/` over HTTP and click through changed pages (no "Page not found").
- Run through the [Writing Checklist](contributing/writing-checklist.md).
