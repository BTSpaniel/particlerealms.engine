---
title: Writing Checklist
description: A pre-merge checklist that operationalizes the Docs Style Guide — audience and scope, structure, navigation, links, and accuracy.
updated: 2026-06-05
---

# Writing Checklist

Run through this before merging any documentation change. It operationalizes the [Docs Style Guide](docs-style-guide.md).

## Audience & scope

- [ ] The intro states **what** the page is and **who** it's for.
- [ ] The page is in the correct section and appears in `_config/nav.json` (or an auto-generated reference index).

## Structure & navigation

- [ ] Single H1; headings are ordered and meaningful.
- [ ] Cross-links to related pages; a "See also" / next-steps section exists.
- [ ] Internal links use relative `.md` paths and resolve in the viewer.

## Content quality

- [ ] Active voice, short sentences, short paragraphs.
- [ ] New terms are defined and added to the [Glossary](../getting-started/glossary.md).
- [ ] Claims about behavior cite a source file/section.

## Required sections (by page type)

- [ ] **Overview:** what/who, module map, next steps.
- [ ] **Guide/how-to:** prerequisites, numbered steps, at least one example.
- [ ] **Reference entry:** description, parameters, returns, errors, example. See [API Reference Standard](api-reference-standard.md).

## Examples

- [ ] At least one code/command example where relevant.
- [ ] Examples are runnable/accurate and tagged with a language.

## Diagrams

- [ ] Mermaid diagrams render; each has surrounding explanatory text and alt-text-equivalent context.

## Accessibility & style

- [ ] Descriptive link text (no "click here").
- [ ] No layout-relative references ("above"/"below").
- [ ] Inclusive, neutral language.

## Build verification

- [ ] `python tools/build_docs.py` passes (search index builds; nav paths resolve).
- [ ] `python tools/build_llms.py` regenerated root discovery files.
- [ ] `python tools/validate_docs.py` passes API, crawler, and wrapper contracts.
- [ ] If you touched the API reference, `python tools/extract_api.py` ran and external overlays under `_notes/` were reinjected below `<!-- HUMAN-NOTES -->`.
- [ ] (If using MkDocs) `mkdocs build --strict -f _config/mkdocs.yml` has no broken-link errors.

## Review

- [ ] A second contributor proofread the change.
