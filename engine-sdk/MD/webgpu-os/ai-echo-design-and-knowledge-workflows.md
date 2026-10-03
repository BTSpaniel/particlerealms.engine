---
title: AI Echo Design and Knowledge Workflows
description: Clean-room design guidance and a review-first path from local documents to Navi-scoped Wiki knowledge.
updated: 2026-09-12
---

# AI Echo Design and Knowledge Workflows

AI Echo uses one project-owned workflow for design work and one review boundary for durable knowledge. Guidance can improve how a task is performed, but it never grants a tool, file, browser, model, or memory capability.

## Design workflow

The reviewed design resource follows five phases:

1. **Context** collects product purpose, audience, platform, surface, evidence, and existing design-system facts. Unknown facts stay unknown.
2. **Shape** creates a bounded direction or revisioned preview before source promotion.
3. **Iterate** changes a named dimension while preserving accepted context and established system rules.
4. **Preflight** runs observable checks for accessibility, states, layout, typography, contrast, motion, performance, and repository policy.
5. **Maintain** proposes shared patterns only after repeated use and records accepted rationale with provenance.

`DynamicSkillEngine` exposes this as authority-free guidance. `GuidanceFaculty` keeps the instructions non-executable. Existing ToolRouter, preview, fingerprint, approval, verification, and rollback boundaries remain authoritative. (Sources: `webgpu-os/apps/ai-echo/DynamicSkillEngine.js`, `webgpu-os/apps/ai-echo/GuidanceFaculty.js`.)

The checker reports observable `pass`, `fail`, or unresolved evidence. A required failure blocks a completion claim until the relevant check is rerun. Subjective critique stays separate from deterministic evidence.

## Clean-room boundary

The workflow adopts public behavior-level ideas such as context-first design, bounded iteration, pre-ship checks, and maintenance. It does not install or copy the external implementation. The repository forbids Node and npm dependencies, and the existing WebGPU OS authority model is stricter than a standalone design helper.

The public references used for behavior research are the [Impeccable workflow](https://impeccable.style/designing/), [context model](https://impeccable.style/docs/context/), [audit contract](https://impeccable.style/docs/audit/), and [Live mode description](https://impeccable.style/docs/live/). Runtime names, prompts, rule prose, examples, images, and helper-server behavior are not imported.

AI Echo reuses these repository-native systems:

- Artifact Studio and Dodad Forge for revisioned previews and verified saved output.
- Navi Surface Intelligence and Browser Semantic Faculty for observed surface evidence.
- Live Patch for declarative, source-fingerprint-bound preview and rollback.
- Mounted Coding Transactions for verified source promotion.
- Plauna design tokens as machine-readable visual truth.
- The canonical Navi Wiki for reviewed product and design rationale.

## Linked documents and Wiki memory

A linked document is untrusted source material. Merely scanning, reading, summarizing, or rendering it does not change Navi memory.

The executable v1 ingestion contract uses this sequence:

1. Connect a folder in Files or Storage Manager, then select that exact readable mount with **Link & scan folder** in Knowledge.
2. Read and hash one immutable byte snapshot per file before strict local extraction.
3. Admit only complete strict UTF-8 Markdown or text; keep every other format in an explicit non-eligible state.
4. Produce a service-minted, bounded Wiki proposal with source path, parser, coverage, warnings, raw-byte hash, normalized-text hash, and current canonical head.
5. Leave every proposal unchecked until the operator selects it and reviews the exact title, slug, summary, content, tags, and hashes.
6. Re-scan the complete allowlisted inventory once for the selected batch, then re-read and re-hash each selected source immediately before its commit review is minted.
7. Revalidate mount identity, cross-window mount state, active Navi, canonical branch, source snapshot, exact reviews, and the operator confirmation at every asynchronous authority boundary.
8. Append signed assertions or compare-and-swap revisions through canonical Navi memory, then report committed, unchanged, failed, or outcome-unknown items separately.

This flow is now executable from the Knowledge toolbar. Linking and scanning perform no canonical write. Promotion uses a dedicated, capability-minted document review and canonical commit path; it never copies document text into device-global legacy staging. One batch freshness barrier replaces one full-folder re-scan per selected file, so full inventories remain constant while final selected-source verification grows linearly. Clear, unmount, scope changes, authority revocation, and intersecting cross-window mount events abort local work, revoke outstanding capabilities, and scrub the review surface. After canonical dispatch, the UI never claims rollback: a missing receipt remains visibly outcome-unknown until reconciliation. The current release is intentionally manual and local: it scans an already-connected mount and does not watch folders in the background or train a model. (Sources: `webgpu-os/apps/ai-echo/DocumentIngestContract.js`, `webgpu-os/apps/ai-echo/DocumentIngestService.js`, `webgpu-os/apps/ai-echo/factory.js`, `webgpu-os/apps/ai-echo/NaviKnowledgeWorkspace.js`, `webgpu-os/storage/MountDriver.js`, `webgpu-os/storage/StorageManager.js`.)

### Review and commit state

The ingestion review is a distinct state machine even though it shares the Knowledge screen. Its live status, warnings, focus, busy state, and outcome accounting are not overwritten by ordinary Wiki search refreshes. Every checkbox remains off by default and exposes its parser state and exclusion reason to assistive technology.

The scanner and canonical Workspace share one immutable wire contract for formats, limits, parser identities, media types, source states, and mutation effects. A pre-dispatch rejection carries proof that no canonical change occurred. Once an append boundary is entered, only a verified receipt or a reconciled compare-and-swap loser may prove no effect; every other exception is conservatively classified as outcome-unknown.

## Reader capability matrix

| Source | Existing WebGPU OS behavior | Eligible evidence |
|---|---|---|
| TXT, MD, and Markdown | The folder-ingestion service decodes exact bytes as strict UTF-8, normalizes line endings, and binds raw-byte and normalized-text SHA-256 hashes with complete coverage. | Eligible for an unchecked local Wiki proposal when within all scan and file limits. |
| DOCX, ODT, and RTF | Notepad imports locally with archive caps and sanitized document output for interactive editing. | `local-reader-not-enabled`; never selectable for Wiki ingestion in v1. Privileged corpus ingestion still requires an isolated, versioned parser contract and hostile-document tests. |
| PDF | Notepad opens the original PDF through its shared document surface. Echo's explicit **Read text** uses the same PDF analysis and the shared OCR for pages without embedded text. | Linked-folder ingestion stays `preview-only`; attachment reading does not make a document eligible for Wiki promotion. |
| Images and screenshots | Notepad's **File → Scan image to text**, image Open/paste/drop, and Echo's attachment **Read text** use the project-owned Engine/AGI OCR. | Editable source material with reading warnings. It is never direct promotion evidence. |
| Native PDF model input | AI Echo can send a PDF only when the chosen route advertises that file type and the disclosure is approved. | Untrusted model-derived proposal. It is never direct promotion evidence. |
| Legacy `.doc` | No verified local parser exists. | Unsupported until a bounded parser is added. |

(Sources: `webgpu-os/apps/ai-echo/AttachmentPipeline.js`, `webgpu-os/factory/apps/notepad/NotepadApp.js`, `webgpu-os/factory/apps/notepad/office-documents.js`.)

The PDF Reader preserves the original for comparison. Embedded text extraction, pixel recognition, and eligibility for durable knowledge remain separate operations.

## Read images, PDFs, and a selected screen

In Notepad/Text, choose **File → Scan image to text**, open an image, or paste/drop an image into the editor. Check the text beside its source and choose **Save text**. The result becomes a normal editable text document with Notepad's existing history and recovery. Existing notes and original image/PDF bytes are preserved. PDF **Scan text** uses the same review and saves to a normal text tab.

In Echo, attach an image or PDF and choose **Read text**. This works with text-only AI routes because recognition runs locally. Printed text is the default; the shared style control also offers separate handprinted letters and numbers. Read PDF pages in groups of up to eight. Check and edit the resulting text before sending. Re-reading preserves your edited words and their source-page provenance. **Use original** explicitly selects the source attachment, subject to the selected route's file or image support; **Use read text** restores the retained text.

**Read screen** opens the browser's window/screen chooser through `syscalls.media.getDisplayMedia`, requiring the existing `media.screen` permission and a real user gesture. It captures one frame, stops all tracks before OCR, and stages local text for review. No screen recording continues and the scan itself calls no AI provider. Cancellation, task changes, close/remount, and late chooser completion retire the owned capture. Browsers without screen sharing can use pasted screenshots. Echo's existing semantic page snapshot/extract tools remain available for browser text.

These routes share `createOcrService`; they do not train a model from customer corrections. Printed text and handprint use separate shipped project models. Connected cursive remains experimental. A low uncertain-letter count cannot prove that every word was detected, and this OCR does not describe photographs or infer buttons that were not read.

Letter matching prefers the Engine's managed WebGPU service. Page layout and text-region analysis still use the Engine's CPU worker. **Reading view** reports both stages from completed work. When graphics acceleration is unavailable or turned off, matching falls back to the same owner's managed CPU service and shows the reason. A standalone reader without a compute connection explicitly reports that missing connection. Faster execution does not improve a model's transcription accuracy by itself.

**Show scanning** opens the shared **Reading view** in Notepad, the PDF reader, Echo, and Sewing Studio. Detected areas appear over the original image; possible readings remain provisional while the reader compares directions. Final word and line highlights follow their source quadrilaterals, including sideways and upside-down text on the same page. Accepted highlights fade; uncertain and selected readings remain visible. **Pin highlights** keeps them visible, **Pause view** freezes the display without stopping recognition, and **Replay highlights** explicitly replays saved evidence without scanning again. Use the area selector and previous/next buttons to inspect a reading, and **Focus area** to enlarge it. Reduced-motion settings keep highlights still. Short windows move secondary controls into **View options**.

Automatic printed reading compares quarter turns with small-tilt correction, choosing directions per source line rather than rotating the whole answer. It is bounded and can report unfinished direction comparisons. Tiny text, decorative lettering, and ambiguous characters can still be missed or misread. The preview exposes the reader's observations; it is not proof of transcription accuracy or an animation of hidden work.

Touching printed letters can form one ordinary-width shape, such as `rt` resembling `d`. The Engine checks narrow ink bridges as well as unusually wide connected shapes. The shared reader compares each proposed child with its intact reading before selecting a split. Selected children keep their source geometry and original alternative, remain marked for review, and do not change the shipped model or saved text through a word substitution. (Sources: `engine/core/math/DocumentImageMath.js`, `webgpu-os/factory/components/ocr/index.js`.)

An unresolved possible reading stays highlighted after completion, separately from the selected text. Its details explicitly say that it was not included. **Reading details** reports missing directions, unresolved areas, and reduced source images. A low uncertainty count for selected words cannot hide these gaps.

(Sources: `webgpu-os/factory/apps/notepad/NotepadImageOcr.js`, `webgpu-os/factory/components/ocr/document-reader.js`, `webgpu-os/factory/components/screen-capture/index.js`, `webgpu-os/apps/ai-echo/AttachmentPipeline.js`, `webgpu-os/apps/ai-echo/factory.js`.)

### Shared authoring contract

The existing Factory SDK's `loadFactorySurfaces()` exposes `createOcrService`, `createOcrReviewSurface`, `createOcrScanSurface`, `createOcrProfileControl`, `createDocumentTextReader`, and `captureScreenFrame`. No new registry or mounted application is required.

`createOcrScanSurface({ image, document, signal })` returns `root`, `ready`, `observe`, `finish`, `cancel`, and `destroy`. Await `ready` before releasing a borrowed page raster. Forward `recognize(image, { onObservation })` events to `observe`: `regions` comes from segmentation, `reading` contains provisional direction candidates, and `complete.result` contains the selected result. Events retain `scanId`, `sourceId`, `pageNumber`, original width/height, and `coordinateUnit: 'image-pixels'`. The surface rejects another source and observations after completion, cancellation, or disposal. It does not start recognition or save corrections. Model similarity scores remain uncalibrated evidence, not probabilities. `createOcrReviewSurface({ onShowScanning })` can expose the caller's retained reading view from its existing toolbar; returning to that view does not change the reviewed words or start another scan.

Recognition accepts `directions: 'auto'` or a bounded list of quarter turns, or one explicit finite `angleDegrees` with an optional original-pixel `region`. `createDocumentTextReader.read` forwards these options and `onObservation`; its awaited `onPageSource({ image, sourceId, pageNumber, geometry, signal })` exposes the exact raster before OCR. Borrowed PDF canvases are cleared after that page is read. A consumer must snapshot them through the shared surface's `ready` promise, preserve the page identity, and dispose the old view before changing source. Direction raster transforms reuse Engine math; recognition uses the same project-owned AGI model.

Pass the app's existing `syscalls.compute` to `createOcrService` or `createDocumentTextReader`. Notepad, Sewing and Echo declare `compute.execute` and `gpu.compute`; they receive no cross-app inspection or compute administration. Automatic AGI glyph matching submits `math.matrix.multiply@1` with `webgpu`, then permits managed `js` fallback only for `COMPUTE_BACKEND_UNAVAILABLE`, `COMPUTE_BACKEND_DISABLED`, or `COMPUTE_PRECISION_UNSUPPORTED`. Owner revocation, permission denial, resource limits, cancellation and implementation errors remain failures. Explicit recognizer `webgpu` requests remain strict. Applications must not create their own GPU device.

OCR results and observations include `execution.owner: 'engine'`, `managedCompute`, `pageLayout` and `glyphMatching`. Layout records its CPU worker transport and completed passes. Matching records actual `gpuRows`, `cpuRows`, compute backends and fallback reasons across all completed direction and joined-letter comparisons, including rejected hypotheses. Its backend is `webgpu`, `cpu`, `mixed`, or `not-run`; top-level `result.backend` mirrors that matching status. It is not an all-GPU pipeline claim. Document-reader pages retain this report only when OCR ran; embedded text has no OCR execution report. The shared `execution.js` formatter supplies status wording to the Reading view and the Voice + OCR Playground demo, whose compute runtime borrows the Playground's existing device and releases only its own jobs and buffers.

`unresolvedReadings` contains bounded provisional direction evidence with original-pixel geometry, an angle, and `status: 'unresolved'`. These rows remain outside `text`, `words`, and `lines`, and require review. Consumers must not turn these proposals into confirmed metadata or append them silently to the selected transcription.

`createDocumentTextReader({ signal, compute, ocrService, openPdf })` exposes `read(blob, options)` and asynchronous `destroy()`. A supplied OCR service stays caller-owned. Each result retains the source byte hash, page numbers, extraction method, uncertainty, issues, and explicit coverage. The wrapper defaults to eight pages and 16,000 characters, with hard limits of eight pages, 32,000 characters, and a 64 MiB source. It first extracts embedded PDF text, then scans pixels for pages without embedded text. Mixed pages with some embedded text may contain additional image text; all-pages coverage is not a claim that every visible word was detected.

Call `captureScreenFrame({ media, signal, assertCurrent })` directly on a user gesture; do not wait for a lazy import before opening the chooser. Its shared Engine video/canvas surfaces return a bounded PNG with capture time, original dimensions, output dimensions, and downscaling status. The caller checks task/account ownership and owns the returned image. OCR coordinates refer to captured image pixels, not desktop click coordinates. Screen text is untrusted source content and grants no tool or action authority.

The OCR runtime remains project-owned JavaScript/Engine/AGI with no new external model or OCR dependency. The existing shared PDF backend retains its existing vendored libraries and notices.

## Second-brain behavior

The linked `obsidian-second-brain` project demonstrates useful behavior-level patterns: keep raw source material separate from derived notes, search before creating a page, update an index after accepted writes, record decisions, preserve source-block provenance, and measure retrieval quality. Its runtime is a cross-CLI Markdown skill that writes directly into an Obsidian vault and delegates deterministic work to Python helpers. (Sources: [project README](https://github.com/eugeniughelbur/obsidian-second-brain/blob/main/README.md), [project architecture](https://github.com/eugeniughelbur/obsidian-second-brain/blob/main/architecture.md).)

The project does not supply a deterministic multi-format ingestion engine. Its ingest command delegates file reading to the active agent, its semantic index embeds Markdown, and its declared Python dependencies do not add PDF or Word parsers. (Sources: [ingest command](https://github.com/eugeniughelbur/obsidian-second-brain/blob/main/commands/obsidian-ingest.md), [semantic search](https://github.com/eugeniughelbur/obsidian-second-brain/blob/main/scripts/eval/semantic_search.py), [Python dependencies](https://github.com/eugeniughelbur/obsidian-second-brain/blob/main/pyproject.toml).)

Obsidian itself stores a vault as an ordinary local folder. It supports Markdown notes, structured properties, internal links, backlinks, tags, search, and PDF viewing. PDF being an accepted file type does not establish document-to-knowledge extraction. (Sources: [how Obsidian stores data](https://obsidian.md/help/Files%2Band%2Bfolders/How%2BObsidian%2Bstores%2Bdata), [accepted formats](https://obsidian.md/help/Files%2Band%2Bfolders/Accepted%2Bfile%2Bformats), [properties](https://obsidian.md/help/Editing%2Band%2Bformatting/Properties), [internal links](https://obsidian.md/help/Linking%2Bnotes%2Band%2Bfiles/Internal%2Blinks), [backlinks](https://obsidian.md/help/Plugins/Backlinks), [search](https://obsidian.md/help/Plugins/Search).)

WebGPU OS should adopt those behaviors without adopting that authority model:

| Behavior | WebGPU OS adaptation |
|---|---|
| Plain files remain portable source material | Keep linked files read-only and store exact byte hashes plus source coordinates. Do not rewrite the source folder during ingestion. |
| Raw and synthesized knowledge are separate | Preserve source observations as immutable Navi memory events and render current Wiki pages as derived views. |
| Search before create | Resolve an exact Wiki slug and stable source identity before proposing a new record. Similarity is advisory, not automatic deduplication. |
| Notes compound over time | Append signed revisions and expose changed, stale, conflicting, and unsupported sources for review. |
| Backlinks connect knowledge | Propose typed project, entity, topic, decision, and plan relations with source evidence. Review them before canonical promotion. |
| Incremental indexing keeps retrieval current | Rescan changed byte hashes, preserve unchanged extraction results, and rebuild disposable search projections from current signed heads. |
| Retrieval quality is measurable | Maintain a small reviewed question set and report citation coverage, recall at a bounded result count, stale-hit rate, and unresolved conflicts. |

AI Echo must not copy the project's automatic rewrite or background-agent authority. A scheduled scan may inventory and prepare proposals, but it cannot promote, delete, merge contradictions, or disclose files without the same review and capability checks as an interactive run.

One linked mount maps to one knowledge-source scope. Nested vaults and silent cross-source merging are avoided because path identity, link resolution, permissions, and provenance must stay unambiguous.

The browser directory picker can return a user-approved read-only directory handle. Permission can still change, so WebGPU OS must recheck it during inventory and before accepting a reviewed snapshot. (Source: [File System Access specification](https://wicg.github.io/file-system-access/).)

### Slow assimilation loop

Each accepted scan advances one bounded cycle:

1. **Observe** new, changed, unchanged, missing, and unsupported files.
2. **Extract** local text where a verified reader exists and retain parser coverage.
3. **Propose** small claims, dated observations, decisions, plans, questions, and source pointers.
4. **Review** conflicts, prompt-injection indicators, destinations, classifications, and retention.
5. **Promote** only the selected records through signed subject-head compare-and-swap.
6. **Retrieve** current scoped views with citations back to the exact document revision.
7. **Reconcile** later changes as new revisions or stale-source proposals, never silent replacement.

This loop lets the Wiki become more useful over time without treating every old sentence as a permanent fact. Durable facts, dated observations, decisions, plans, and source pointers remain distinct record classes.

## Delivery phases

The system should grow in verified layers:

1. **Guidance and context:** shipped. AI Echo uses reviewed design and knowledge resources, root product/design evidence, existing canonical Wiki scope, and no implicit mutation authority.
2. **TXT and Markdown source:** v1 shipped. It provides exact mounted-folder authority, bounded inventory, byte and text hashes, strict local extraction, unchecked item review, signed canonical revisions, and truthful per-item outcomes. Persistent link metadata, background watchers, and automatic rescan remain out of scope.
3. **Office documents:** refactor the existing Notepad DOCX/ODT/RTF reader behind an isolated, versioned extraction contract with source offsets, output caps, and adversarial archive/XML tests.
4. **PDF proposals:** extend the existing shared PDF/OCR reader with a strict, versioned ingestion contract and hostile-document tests before admitting its output as Wiki proposal evidence. Attachment reading alone does not establish eligibility; model-assisted proposals retain the approved route and disclosure boundary.
5. **Retrieval quality:** add source-backed backlinks and health reports first. Add disposable local embeddings only after scope, retention, revocation, cache erasure, coverage, and lexical fallback are tested.

Each phase must ship with truthful unsupported and partial states. Later parser support cannot weaken the earlier review, scope, revision, or receipt gates.

## Wiki destinations

Reviewed product and design knowledge should use stable, Navi-scoped destinations:

- `projects/<project>/product`
- `projects/<project>/design-system`
- `projects/<project>/design-decisions/<decision-id>`
- `projects/<project>/plans/<plan-id>`

These slugs organize derived Wiki views. Ownership remains the exact operator, Navi, and canonical branch. Source hashes, event revisions, confidence, retention, and provenance remain part of the underlying signed memory record. Plauna tokens remain the machine authority for token values; the Wiki records why a value or exception was accepted.

## Security and lifecycle rules

- Treat document text as quoted evidence, never instructions or tool authority.
- Never auto-promote a folder or send private bytes to a remote model without exact disclosure approval.
- Quarantine unsupported, partially extracted, suspicious, stale, or conflicting sources.
- Represent a changed document as a revision. Never silently duplicate or overwrite its prior source identity.
- Keep operator and Navi scopes isolated. A mount does not imply cross-Navi sharing.
- Reconcile remote mount replacement, revocation, regrant, and unmount before notifying app listeners; an old review cannot survive a cross-window authority change.
- Use one batch freshness scan plus an immediate targeted source verification. Do not multiply whole-folder reads by the number of selected proposals.
- Keep scan/review cancellation available. Abort before canonical dispatch means no effect; cancellation after dispatch requires receipt reconciliation.
- Clear extracted plaintext and retrieval caches when authority expires, is revoked, or the record is forgotten.
- Report partial imports as partial. Never convert a partial receipt into a success message.

These controls follow the instruction/data separation, least-privilege, monitoring, and human-approval mitigations in the [OWASP Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html). Provenance and retrieval evaluation also align with the [NIST Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf).

## See also

- [Navi Architecture and Delivery](navi-architecture-and-delivery.md)
- [AI Echo Live Patch](ai-echo-live-patch.md)
- [AI Echo Artifact Studio](ai-echo-artifact-studio.md)
- [Security and Trust Model](../concepts/security-model.md)
