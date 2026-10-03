---
title: AI & Accessibility
description: How this documentation stays safe and useful for both AI agents and humans — discovery files, agent boundaries, self-contained sections, metadata, and accessibility.
audience: contributors
updated: 2026-06-05
---

# AI & Accessibility

This documentation is built to be **AI-safe** (readable by and guiding to LLM agents) and **human-safe** (accessible, accurate, and clear). This page records those conventions. They draw on the emerging [llmstxt.org](https://llmstxt.org/) proposal, the [agents.md](https://agents.md/) convention, the [Diátaxis](https://diataxis.fr/) framework, and AI/RAG writing guidance. `llms.txt` is supplemental discovery metadata, not a replacement for canonical Markdown and source code.

## Making the docs AI-safe

### Discovery files (guide the AI to its places)

- **`/llms.txt`** — a curated, machine-readable index at the web root so agents can discover it without knowing the documentation layout. A portable copy also lives in `MD/`.
- **`llms-full.txt`** — the curated pages concatenated for full-context ingestion (the large generated reference is linked, not inlined).
- **`/api-index.json`** — an ES-module catalog with the source path, source-server import specifier, source hash, detected exports, and signatures. Summaries appear only where source JSDoc provides them; `summaryCoverage` quantifies the remaining gaps and `runtimeLoading` distinguishes repository source mode from compiled production mode.
- **`/docs-chunks.jsonl`** — bounded documentation chunks generated from the search index. Each UTF-8 line is an independent JSON object with source metadata, a stable chunk position, and a SHA-256 content hash.
- **`/api-symbols.jsonl`** — the API catalog flattened to one source-backed module or detected export per UTF-8 line. It preserves module paths, source imports, source hashes, signatures, and empty summaries when JSDoc has no description.
- **`/robots.txt` and `/sitemap.xml`** — crawler discovery files generated alongside the LLM indexes. Curated pages point to raw Markdown, API catalogs point to JSON, and bundled generated references use stable `/MD/viewer/?doc=...` URLs.
- **`AGENTS.md`** (at the `MD/` root) — a "README for agents": where things live, which commands to run, what may be changed, and the hard boundaries. AI agents should read it first.

Regenerate discovery files after content changes:

```bash
python tools/build_llms.py
python tools/validate_docs.py
```

`build_llms.py` refreshes both the `MD/` copies and the web-root discovery
files. It generates the canonical `https://particlerealms.online` sitemap by
default; pass `--site-url` and `--base-url` only for another deployment. The
validator rejects stale local ports, malformed or stale JSONL records, oversized
feeds, malformed enriched API indexes, known nonexistent GPU symbols, missing
root discovery files, and public wrappers that expose documentation only through
an iframe.

### Self-contained sections

LLMs retrieve **chunks**, not whole pages, and document order is not preserved. So each section must make sense in isolation:

- **Front-load context** — start a section by naming the subsystem/feature it concerns.
- Use **descriptive headings** that say what the section accomplishes.
- Avoid back-references like "as mentioned above," "now that you've," or "with everything configured."
- Include complete steps within a section rather than relying on earlier ones.

### Page metadata (frontmatter)

Pages may begin with a YAML frontmatter block. The viewer strips it (showing the description as a subtitle) and the build tools use it for richer search and freshness signals:

```yaml
---
title: Boot Sequence
description: How the WebGPU OS comes up, from the HTML page to a mounted desktop.
audience: app developers
updated: 2026-06-05
---
```

`title` and `description` improve retrieval; `updated` is a freshness signal valued by AI search.

### Verifiability over fluency

- Every behavioral claim must be **traceable to a source file** — cite it.
- The per-symbol API reference is **machine-extracted** and may lag the source; the generated banner marks it. Improve accuracy by editing **JSDoc upstream**, then regenerating.
- Prefer Markdown/HTML over PDFs; keep semantic structure (real headings, lists, tables) so crawlers and models parse it cleanly.

## Making the docs human-safe

### Accessibility

- **Descriptive link text** — never "click here".
- **Alt text** on every image; **text equivalents** near every diagram (a screen reader may not read a rendered SVG).
- **No layout-relative references** ("above"/"below"/"on the right") — refer to sections by name.
- Meaningful, ordered headings; sufficient color contrast in the dark theme.
- The viewer honors **`prefers-reduced-motion`**, exposes `aria-current`/`aria-expanded` on navigation, and provides a skip-link and keyboard shortcuts.

### Safety & accuracy

- **Never include secrets** (keys, tokens, passwords) in docs or examples.
- Parts of the reference are **auto-generated** — verify against the cited source before relying on them.
- Keep the [Security & Trust Model](../concepts/security-model.md) accurate; do not weaken or misstate capability/permission behavior.
- Curated pages link to their raw Markdown source. Generated references identify
  the repository source path and offer the bundled Markdown as a download; the
  source hash in `/api-index.json` exposes drift.

## Diátaxis alignment

This set roughly follows the four Diátaxis modes; keep new pages in the right mode:

| Mode | Purpose | Where |
| --- | --- | --- |
| Tutorial (learning) | Get a newcomer to a first success | `getting-started/`, `_templates/tutorial.md` |
| How-to (task) | Accomplish a specific goal | subsystem `getting-started.md`, guides |
| Reference (information) | Look up exact facts | `<subsystem>/reference/**` |
| Explanation (understanding) | Understand the "why" | `concepts/` |

## See also

- [Docs Style Guide](docs-style-guide.md)
- [API Reference Standard](api-reference-standard.md)
- [Contribution Workflow](doc-contribution-workflow.md)
- [`AGENTS.md`](../AGENTS.md)
