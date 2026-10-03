# API reference notes overlay

Hand-authored notes for the **generated** API reference live here, *outside* the
generated pages, so the ~1700 files under `MD/<subsystem>/reference/` stay purely
generated (regenerable from scratch) while your prose is never clobbered.

`tools/extract_api.py` injects matching notes below the `<!-- HUMAN-NOTES -->`
marker on every run.

## Two kinds of notes

### 1. Per-page notes — `_notes/<subsystem>/<module>.md`

Notes for **one** reference page. The path mirrors the reference path with the
`reference/` segment dropped:

| Reference page | Overlay file |
| --- | --- |
| `engine/reference/math/Vec3.md` | `_notes/engine/math/Vec3.md` |
| `webgpu-os/reference/packages/AppCompiler.md` | `_notes/webgpu-os/packages/AppCompiler.md` |

The file content becomes the **Notes & Examples** body verbatim (write Markdown —
it may include its own `###` headings, code blocks, etc.). Use normal relative
links (the page depth is known).

### 2. Shared blocks — `_notes/_shared.json`

Write a block **once** and apply it to **many** pages via `applies` globs. This is
how you avoid rewriting the same context on every page.

```json
{
  "blocks": [
    {
      "id": "gpu-device-sharing",
      "title": "Shared GPU device",
      "applies": ["engine/reference/*/gpu/*", "webgpu-os/reference/drivers/*"],
      "body": "Markdown … use /docroot-absolute.md links here."
    }
  ]
}
```

- `applies` globs are matched (`fnmatch`) against the page's reference path, e.g.
  `engine/reference/core/gpu/VirtualGPU`. Note `*` matches across `/`, so
  `agi/reference/*` covers every AGI reference page at any depth.
- Because a shared block lands on pages at **different depths**, use
  **docroot-absolute** links: `[Virtual GPU](/engine/vgpu.md)` (leading `/`).
- A page's composed notes are: its per-page overlay first, then every matching
  shared block, in file order. If nothing applies, a placeholder is shown.

## Workflow

```bash
# add/edit notes here, then regenerate the reference pages:
python tools/extract_api.py        # injects overlay + shared notes
python tools/build_docs.py         # refresh search index
python tools/build_bundle.py       # repack the single deploy bundle
```

This directory is authoring-only — it is **not** served or bundled.

See [API Reference Standard](../contributing/api-reference-standard.md).
