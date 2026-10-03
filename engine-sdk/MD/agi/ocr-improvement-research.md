---
title: Improving owned text and handwriting recognition
description: Primary research and measured next steps for the owned Engine, AGI and Factory text readers.
updated: 2026-09-28
# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
---

# Improving owned text and handwriting recognition

Research checked September 12, 2026. This recommendation combines primary research with inspection of the current Engine, AGI and Factory implementation. Research methods are references for owned implementations; no external recognition runtime or pretrained model is being added.

## Decision

Improve source pixels, sequence recognition and evaluation together. Keep the existing shared PDF extraction and review surfaces. Develop the recognizer centrally so customers can scan immediately without teaching letters or training a personal model.

Preserve source detail and word proportions in a versioned experimental path. The completed short continuation comparison below does not justify replacing the current preparation. The next controlled experiment should measure the new spatial stroke encoder against the current temporal reader, with matching input recipes. Wider context, richer character coverage and page layout follow those measurements. A bigger model trained on the same damaged or narrowly sampled inputs is not sufficient evidence of improvement.

## What the current code establishes

| Area | Verified implementation or observation | Consequence |
| --- | --- | --- |
| PDF and customer review | Notepad and Sewing share document extraction, OCR review, original-source preview and text correction. | Reuse them; do not introduce another PDF reader or customer training screen. |
| Printed text | `GlyphRecognizer.js` compares retained glyph features; joined-print processing can consider connected components and alternatives. Similarity remains explicitly uncalibrated. | More font examples help isolated glyphs, but cannot supply complete word or line context. |
| Small text on large pages | The current Factory scanner requests at most 1 million input pixels on its compute path and 4 million on its worker path. | Evaluate a low-resolution layout pass followed by higher-resolution source crops, so a whole-page downsample does not erase small labels. This crop pipeline is a proposal, not a completed feature. |
| Connected handwriting | `HandwritingSequenceRecognizer.js` has owned CTC, temporal context, GPU tensor operations and resumable AdamW. | The sequence foundation exists; reliable natural handwriting does not. |
| Input preparation | The original `handwritingPageWordPixels` thresholds photographed words to 0/255, caps content at 252 px and independently normalizes ink height. Sequence strips use a 256 × 32 frame. | Faint stroke detail and long-word proportions can be lost. New preparation must be versioned and old receipts retained. |
| Spatial learning | The new owned vertical stroke convolution passes gradient and GPU parity tests. Eight real training words are memorized exactly after 175 updates. | This proves trainability on those eight words only, with no unseen-writing accuracy claim. |
| Language coverage | The current 76-character training alphabet lacks several common English punctuation marks. The checked temporal configuration sees roughly 65 normalized horizontal pixels. | Longer words, punctuation and sentence context need separate improvements. |

The latest completed English adaptation selected epoch 9 of 12: **9,792/14,860 character edits (65.895% CER), 300/3,538 exact words**. Its handwritten subset has 66.5737% CER. The separate DHSD validation result is 47.1502%, compared with 46.6267% at the start of that adaptation. The existing frozen test partitions remain sealed. These are validation results for experimental weights, not production recognition claims or results for the new spatial frontend.

The first research-driven implementation is now present as `prepareHandwritingRaster`: grayscale strokes, 64/128/256/512-pixel width buckets, original-resolution bounded word crops and invertible source coordinates. Six preparation checks, fourteen CTC checks and full readback of both old and new prepared corpora pass. The new GNHK publication retains 32,495 training/validation annotations in 509 shards; unreadable markers and one over-budget source crop remain explicit. Old data and checkpoints are preserved. A preprocessing change is not itself an accuracy result.

Independent review found a subpixel-crop edge case where the shared matrix inverse returned its identity fallback. Preparation now rejects insufficient source resolution and verifies inverse mappings at every ink-support corner before publishing coordinates. The exact adversarial fixture passes. Auditing all 31,210 prepared training/validation rasters found no new rejection: maximum round-trip error was 0.001435 output pixels and 0.002084 source pixels. The existing 1,285 issue records remain intact; no held-out test source was opened.

## Completed short continuation comparison

Both arms started with the same selected v5 weights and fresh optimizer state, used the same 29,220 eligible training examples in the same order, and completed one epoch with 1,827 updates and an effective batch of 16. All 33 captured sources remained unchanged during both runs. Full validation denominators were retained; test partitions stayed sealed.

| Experiment | English validation CER | Exact English words | DHSD validation CER |
| --- | ---: | ---: | ---: |
| Original v5 weights, original preparation | 65.8950% | 300 / 3,538 | 47.1502% |
| Same v5 weights, grayscale preparation, no training | 82.9273% | 67 / 3,538 | 56.2358% |
| One matched epoch, original preparation | **64.9192%** | **344 / 3,538** | **46.1285%** |
| One matched epoch, grayscale preparation | 69.8183% | 275 / 3,538 | 54.0910% |

The original-preparation arm completed in 283.800 seconds and grayscale in 277.541 seconds, both within their six-minute limits. Grayscale adaptation recovered part of the initial input-distribution regression, but remained worse than the original-preparation arm. This is a short continuation comparison from weights originally trained on the old recipe; it does not establish which preparation would win when trained from scratch. Neither candidate is dependable handwriting OCR, and neither was promoted to normal scanning. Receipt: `tmp/handwriting/gray-aspect-paired-comparison.json`, checked by `tests/sewing/compare_handwriting_preparation_runs.py`.

## Research that changes the implementation order

### Preserve proportions and improve CTC features

SVTRv2, published at ICCV 2025, combines multiple input sizes, feature rearrangement for CTC alignment and semantic guidance during training. Its guidance component can be removed for inference. It provides evidence that an efficient CTC recognizer can remain competitive when its visual features and input handling improve. Its scene-text results do not prove handwriting accuracy for this app. Our inference from the paper and code audit is to fix width handling before replacing the whole recognition stack. [SVTRv2 paper](https://arxiv.org/abs/2411.15858).

For the owned implementation, use a small set of aspect-preserving width buckets with explicit padding and valid sequence lengths. Preserve grayscale pixels and the source-to-crop transform. Report an over-wide or insufficient-resolution input explicitly instead of silently clipping letters. Apply the same recorded preprocessing at training and inference. Avoid choosing geometry from the transcript.

### Read connected sequences

Easter2.0 studies a convolutional handwriting reader with residual connections, CTC and training augmentation. It supports evaluating richer convolutional context without requiring an imported transformer. We should first compare the existing temporal reader with its new spatial frontend using matched data, then test wider contextual layers. Training-word composition, if introduced, must use training samples only. [Easter2.0](https://arxiv.org/abs/2205.14879).

PARSeq studies context-aware text recognition and identifies a risk in independent language-model correction: it can change a visually correct reading. This matters for pattern numbers, designer names and measurements. For Sewing, retain the raw visual reading and source span; any spelling or domain suggestion should be separate. A dictionary must not silently change `204`, `1/4`, `3/8` or a size label. [PARSeq](https://arxiv.org/abs/2207.06966).

TrOCR is a useful architectural reference for learned image features plus sequence decoding, but its official smallest published model has 62 million parameters. At four bytes per parameter, weights alone would occupy about 248 MB before activations and runtime overhead. That calculation supports starting with a smaller owned architecture rather than treating a large imported model as the default browser solution. Its IAM results are not directly comparable with our GNHK/DHSD validation. [Microsoft TrOCR model inventory](https://github.com/microsoft/unilm/blob/master/trocr/README.md?plain=1).

### Improve data without asking customers to train

Synthetic text is valuable for broadening printed fonts, weight, italics, spacing and image degradation. Oxford's work demonstrates whole-word training from generated text, rather than only isolated glyph examples. Extend our existing browser raster generator to render complete labeled words and sewing-specific strings; its current font inventory is not a comprehensive font benchmark. Synthetic script fonts must remain a separate evaluation category from real handwriting. [Oxford synthetic-text research and dataset](https://robots.ox.ac.uk/~vgg/data/text/).

The Windows Character Map idea is useful as a source of character examples: Microsoft describes selecting a font and browsing its characters. It does not provide transcribed photographs of handwriting. Our `GlyphRasterSource.js` already renders local font samples directly; inspecting Character Map pixels is unnecessary. Its default list contains four font families, and the sequence pretraining recipe requests eight. These are requested browser fonts, not verified counts of distinct installed fonts. [Microsoft Character Map documentation](https://support.microsoft.com/en-us/accessibility/windows/use-a-screen-reader-to-explore-and-navigate-different-keyboard-and-text-tools-in-windows).

Whole-word rendering matters because the shape displayed for a character can depend on its neighbors. OpenType supports ligatures and contextual glyph substitutions. Pasting isolated glyph images together will miss those shaped forms. Our proposed printed training expansion should render complete strings through the browser text engine, retain the requested font and rendered-image fingerprint, and measure unfamiliar font families separately. This is an implementation inference from the font specification, not a claim that font shaping alone solves OCR. [Microsoft OpenType substitution specification](https://learn.microsoft.com/en-us/typography/opentype/spec/gsub).

GNHK provides photographed English handwriting under CC-BY 4.0 and is already used in the developer experiment. Its real backgrounds and writing variation are more relevant to photographed notes than clean type alone. Our imported records lack writer identity, so our split is image-disjoint, not verified writer-disjoint. DHSD retains its verified writer split. Keep these limitations visible and evaluate unfamiliar words separately. [Original GNHK repository](https://github.com/GoodNotes/GNHK-dataset).

Do not infer dataset permission from a paper's availability. IAM's official page states non-commercial research use; it is not an automatically approved training source for a distributable product. Training-data licensing and model evaluation need separate records. [IAM dataset terms](https://fki.tic.heia-fr.ch/databases/iam-handwriting-database).

### Detect layout before reading a whole page

CRAFT models text regions and connections between characters to locate irregular text. This supports adding a learned region detector for difficult photos after the word reader improves. It does not require that our recognizer physically split every joined handwritten character. Detection and transcription are separate tasks. [CRAFT](https://arxiv.org/abs/1904.01941).

For paragraphs, VAN uses attention to follow text lines; DAN extends recognition to document text and layout tags. They show why page reading needs reading order and layout modeling beyond a short-word recognizer. The immediate owned path is source-linked lines and table regions, followed by longer sequence recognition. Full-page generative recognition is a later experiment. [VAN](https://arxiv.org/abs/2012.03868), [DAN](https://arxiv.org/abs/2203.12273).

### Measure whether uncertainty is useful

Neural scores are not automatically probabilities. Guo and colleagues demonstrate calibration failures and evaluate temperature scaling. That method is a candidate for a held-out calibration experiment on the learned classifier, not a guarantee for our sequence confidence or current cosine-similarity scores. Evaluate both error and the proportion of words retained at an acceptance threshold. [Calibration research](https://proceedings.mlr.press/v70/guo17a).

## Printed reader: context, batching and self-training (September 2026)

These changes affect the printed profile only. Handprint reading is unchanged.

- **Word-shape and line-geometry context.** In common sans-serif faces, `I`/`l`/`1`/`|`, `O`/`0`/`o` and case pairs such as `c`/`C` can have identical shapes, so no size-normalized feature can separate them. `webgpu-os/factory/components/ocr/context.js` runs after glyph matching. It can only select from a glyph's own top recognizer alternatives, within a bounded score gap. Each decision is recorded on the glyph as `context: { method, rule, recognized, changed }`. The rules use four kinds of evidence: runs of digits, lowercase or uppercase neighbours, the line's measured x-height against its cap height, and a mid-sentence rule. Mid-sentence changes are never auto-accepted. Word-initial `I`/`l` stays under review because telling "In" from "ln" needs a lexicon. Pass `recognize(image, { context: false })` to get the raw recognizer reading. (Source: `webgpu-os/factory/components/ocr/context.js`, `index.js`.)
- **Stacked marks.** Two similar small marks stacked in an otherwise empty column are now one colon or semicolon (`compoundEvidence: 'stacked-marks'`), not two periods. (Source: `engine/core/math/DocumentImageMath.js`.)
- **Fewer prototype-matrix uploads.** Each score job sends the whole prototype matrix (about 24 MB for the shipped 10,485 examples). `GlyphRecognizer` now sizes each batch against both the score-matrix byte budget and the shared matmul budget (`rows × inner × columns ≤ 1e9`), about 164 rows instead of 32. Direction passes start with a 32-row slice, so lines still appear progressively, then grow the slice. Touching-letter comparisons are grouped by whole parent glyph. `learnGlyph` forks the live model over shared immutable examples instead of exporting and revalidating the full bank. The shipped-base decoder uses one aligned `Float32Array` copy on little-endian hosts.
- **Session teaching in the Playground.** Selecting an amber letter in the Voice + OCR demo teaches it through the existing `learnGlyph`, then rescans. Lessons last only for the session.
- **Self-training loop.** `tests/sewing/ocr-self-training.html` repeats a loop: render known text, read it, learn the mistakes, then re-read held-out fonts it never mines. Lessons carry `provenance.kind: 'self-training-render'` (`learnGlyph(..., { origin: 'self-training', recipe })`). Shape-identical aliases and lines whose segmentation does not match the truth are skipped. A round that makes held-out reading worse is rolled back, and the loop halts after two rounds without gain. The page downloads a compact lesson pack and receipt. It never changes the shipped base.

Measured on one Windows Chrome device, headless:

| Measurement | Before | After |
| --- | --- | --- |
| Playground "Hello" sample | `HelIo from ParticIe ReaIms.`, 11 letters for review | Exact, 4 letters for review |
| Playground "details" sample | `pIease …`, `1 0..30` | `please …`, `1 0:30` (a word-gap error remains) |
| Dense 22-line page, 988 glyphs, GPU matching, warm | 9.7–10.2 s (old batching, same context code) | 4.3–4.7 s |
| `ocr-quality-benchmark.html`, 14 fixtures, CPU path | 5.24% exact CER, 3/14 exact texts, 1.03% wrongly accepted | 1.53% exact CER, 10/14 exact texts, 0.88% wrongly accepted |
| Shipped-base load (benchmark `modelPreparationMs`) | 1.66 s | 0.81 s |

These are synthetic canvases, not photographed documents. The self-training loop has not yet produced a held-out improvement. In the recorded run, lessons from unseen font families made held-out reading worse and were rolled back, so the loop's safety invariant held.

## Implementation and evaluation sequence

1. **Version the pixel preparation.** Preserve grayscale, proportions, source coordinates and old artifacts. Test long words, faint strokes, blank input, rotated quadrilaterals and training/inference parity.
2. **Measure the spatial encoder.** Use the same training and validation partitions, report each domain separately, and change one major factor at a time. A new preprocessing recipe needs matched training; reusing old weights alone is not the final comparison.
3. **Expand text coverage deliberately.** Add punctuation, fractions and measurement expressions from the training vocabulary. Keep exact case-sensitive, numeric and symbol metrics; report unsupported text in the denominator.
4. **Increase sequence context.** Compare bounded residual context and attention only after the lower-level ablation. Retain real GPU memory, time, cancellation and restart measurements.
5. **Add line and page detection.** Preserve source boxes, columns, reading order and table roles. Extract existing PDF text first; use pixel recognition when needed. Detect layout at bounded resolution, then read small text from original-resolution crops with overlapping edges and verified coordinate remapping.
6. **Choose customer thresholds from evidence.** Report character error, exact word/numeric accuracy, false accepted readings and coverage on fixed held-out data. Keep handwriting, printed type, script fonts and photographed labels separate.

The product workflow remains **Scan → review uncertain text → Save**. Recognition spans must point back to the original. Customers can correct a result without changing the recognizer. Calibrated acceptance should reduce unnecessary review, while unclear measurements and pattern identity remain visible checks.

## Scope boundaries

Photographs, fabric texture, repeated motifs, cutting contours and handwritten words require different outputs and tests. A detected image region is not garment recognition; a closed contour is not a verified cutting piece; a recognized arrow is not a confirmed grainline. Preserve those distinctions when adding visual capabilities.

The OCR and generation work described here uses owned JavaScript/WebGPU. Existing shared PDF.js/pdf-lib/fontkit and Engine Kaolin remain in the surrounding application. The app as a whole is not dependency-free.

## Local sources

- `agi/vision/GlyphRecognizer.js`, `HandwritingSequenceRecognizer.js`, `SpatialHandwritingEncoder.js`, `CtcMath.js`.
- `agi/tensor/TrainableDenseLayer.js`, `AdamOptimizer.js`; Engine `TensorSpatialMath.js`.
- `engine/core/text/GlyphRasterSource.js`, `HandwritingSequenceDataset.js`, `HandwritingPageDataset.js`, `HandwritingAugmentation.js`.
- `engine/core/text/HandwritingRasterPreparation.js` and its versioned `owned-handwriting-gray-aspect-v2` recipe.
- `webgpu-os/factory/components/ocr/`, `webgpu-os/factory/apps/notepad/pdf-document-surface.js`.
- [Sewing Studio implementation and verification](../webgpu-os/sewing-studio.md).
