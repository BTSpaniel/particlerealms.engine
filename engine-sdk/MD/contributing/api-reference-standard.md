---
title: API Reference Standard
description: The hybrid API reference standard — generated signatures from source plus hand-authored notes injected from a separate _notes/ overlay tree.
updated: 2026-06-05
---

# API Reference Standard

The reference is **hybrid**: `tools/extract_api.py` generates per-file signature stubs from source; contributors add prose and examples in a **separate `_notes/` overlay tree** that the extractor injects below the `<!-- HUMAN-NOTES -->` marker. This page defines the standard both halves follow.

## How generation works

- The extractor walks each subsystem's JS source and writes `MD/<subsystem>/reference/<module>.md` plus a `_index.json` consumed by the viewers.
- The **whole page is regenerated** every run (signatures *and* the Notes & Examples section), so the ~1700 reference files stay purely generated and can be rebuilt from scratch.
- Hand-authored notes live **outside** the pages in `MD/_notes/` and are injected on every run — so regenerating never clobbers your prose.

```bash
python tools/extract_api.py            # all subsystems
python tools/extract_api.py webgpu-os  # just one
python tools/build_docs.py             # refresh search index
python tools/build_bundle.py           # repack the single deploy bundle
```

## Hand-authored notes (the `_notes/` overlay)

There are two ways to add notes — see `MD/_notes/README.md` in the repo for the full guide.

**Per-page notes** — `_notes/<subsystem>/<module>.md` (the reference path with the `reference/` segment dropped). The file becomes the page's Notes & Examples body verbatim. Example: notes for `engine/reference/core/math/MathVec3.md` live in `_notes/engine/core/math/MathVec3.md`. Use normal relative links here.

**Shared blocks** — `_notes/_shared.json`. Write a block once and apply it to many pages via `applies` globs (matched against the reference path, e.g. `engine/reference/core/gpu/*`). This is how common context is authored **once** instead of copied onto every page. Because a shared block lands on pages at varying depths, use **docroot-absolute** links like `[Virtual GPU](/engine/vgpu.md)` (leading `/`).

A page's composed notes are its per-page overlay first, then every matching shared block. If nothing applies, a placeholder is shown.

## What a generated page contains

- File path and a **Source** link to the real file.
- The file-level description (from a leading `/** ... */` JSDoc, or leading `//` comments).
- **Classes** with their methods (signature + JSDoc summary).
- **Functions** with parameters (`@param`), return (`@returns`), and summary.
- **Constants** and **re-exports**.

## What contributors add (in the overlay)

Each non-trivial symbol should gain:

- **Purpose** — what it's for and when to use it (beyond the one-line summary).
- **Parameters** — full sentences. Booleans: "If `true`, do X; otherwise Y." Objects: describe each field.
- **Returns** — start with "The …" for objects ("The resolved trust profile."); booleans use "`true` if …; `false` otherwise."
- **Raises/errors** — what throws and when.
- **Example** — a short, runnable snippet with error handling where relevant.
- **See also** — related symbols/pages.

## Improve the source, improve the docs

Because file descriptions and `@param`/`@returns` come from JSDoc, the best way to improve a generated page is to **add JSDoc to the source** (upstream), then re-run the extractor. Per the project's composition rule, fix documentation at the source rather than only in the generated Markdown.

## Formatting

- All symbols in `code font`, matching source casing.
- One page per source file; one H3 per symbol.
- Keep examples self-contained and language-tagged.

## See also

- [Docs Style Guide](docs-style-guide.md)
- [Contribution Workflow](doc-contribution-workflow.md)
