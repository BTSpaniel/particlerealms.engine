---
title: Docs Style Guide
description: How to write docs for this project so they are clear, consistent, accessible, and easy for both AI tools and humans to read.
updated: 2026-06-05
---

# Docs Style Guide

How to write docs for this project so they are clear, consistent, accessible, and easy for both AI tools and humans to read.

## Voice and clarity

- **Active voice, present tense.** "The kernel guards syscalls," not "syscalls are guarded by the kernel."
- **One idea per sentence.** Prefer short sentences and short paragraphs (3–5 sentences).
- **Define terms on first use** and add them to the [Glossary](../getting-started/glossary.md).
- **Be specific.** Reference real file paths, functions, and symbols in `code font`.
- **No filler.** Every sentence should inform; cut marketing language.

## Inclusive language

- Use gender-neutral terms ("they/them", "the user").
- Avoid loaded metaphors. Prefer `allowlist`/`denylist` and `primary`/`secondary`.
- Avoid idioms that don't translate well.

## Accessibility

- **Descriptive link text** — link the thing, not "click here". Good: "see the [Boot Sequence](../concepts/boot-sequence.md)".
- **Alt text** on every image and diagram.
- **No layout-relative references** ("above"/"below"/"on the right") — refer to sections by name.
- **Meaningful headings** in order (don't skip levels).

## Structure

Every page should have:

1. An H1 title matching its purpose.
2. A one- or two-sentence intro stating what the page is and who it's for.
3. Body sections with descriptive H2/H3 headings.
4. At least one example where relevant.
5. A "See also" / next-steps section with cross-links.

Use the skeletons in `_templates/` (overview, guide, tutorial, api-entry).

## Formatting conventions

- **Code font** for files, functions, classes, symbols, and literal values: `kernel/Syscalls.js`, `mount()`, `fs.write`.
- **Fenced code blocks** with a language tag (` ```javascript `, ` ```bash `, ` ```json `, ` ```mermaid `).
- **Tables** for option/parameter/field lists.
- **Mermaid** for diagrams (see [Diagram Guide](diagram-guide.md)).
- Use relative links to other `.md` files so all three viewers resolve them.

## Citing source

When you state how something works, point at the source: ``(Source: `webgpu-os/AUDIT.md` §4)`` or a file path. This keeps docs verifiable and makes drift obvious.

## AI-readability

- Keep Markdown plain and standard (the zero-build viewer has only a minimal fallback parser).
- Prefer explicit tables and lists over prose for structured data.
- Put the most important information first.

## See also

- [Writing Checklist](writing-checklist.md)
- [Page Templates](page-templates.md)
- [API Reference Standard](api-reference-standard.md)
