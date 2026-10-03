---
title: AGI
description: Section index for AGI — RL animation rigging with a WebGPU tensor library and AGI Studio (overview, architecture, getting started, training guide, API reference).
updated: 2026-09-12
---

# AGI

Reinforcement-learning animation rigging ("parasite rig") with a WebGPU tensor library and AGI Studio. Source: `agi/`.

## In this section

- [Overview](overview.md) — what AGI is and how the RL loop works.
- [Architecture](architecture.md) — tensor → brain → core → scene/rig → studio.
- [Getting Started](getting-started.md) — launch Studio and start training.
- [Training Guide](training-guide.md) — curriculum, tuning, troubleshooting.
- [Text and handwriting research](ocr-improvement-research.md) — source-pixel quality, owned model changes and controlled evaluation.
- [ParticleVoice Calibration](particle-voice-calibration.md) — saved listening audio, controlled comparisons and reference inspection.
- **API Reference** — per-file symbols from `agi/` (browse `agi/reference/`).

## Module map

```text
agi/
  core/      RagdollController, ObservationBuilder, MotorController, RewardFunction,
             CurriculumManager, MotionMatchingTeacher
  brain/     policy/value networks, PPO trainer, optimizers, losses, utils
  tensor/    WebGPU tensors + compute shaders (matmul/activation/reduction) + autodiff
  vision/    supervised glyph examples, corrections, evaluation and experimental temporal CTC
  rig/       parasite visuals (injection, tentacles, brain)
  scene/     training scene, ground, tracking camera, renderer, debug
  studio/    AGI Studio app (core, panels, editors, visualizers, tools)
  runtime/   runtime manager
  api/       Gym-compatible environment API
  adapters/  WebGPU/Python/WASM/Rust/C++
  loader/ config/ data/   model loading, hyperparameters/curriculum/rewards, data
```

## Document recognition and handwriting

The project-owned glyph learner is exported as `createGlyphRecognizer` from `agi/index.js`. It learns labeled pixel features supplied by Engine and supports scoped JavaScript/WebGPU scoring, explicit ambiguity, model import/export, cancellation and independent owners. Factory supplies the shared document scanner and review surface. See [Sewing image scanning](../webgpu-os/sewing-studio.md#project-owned-image-scanning) for the complete data flow and limitations.

Printed text and separated handprint use distinct shipped exemplar bases and correction stores. The handprint base is trained on genuine NIST EMNIST Balanced images, with 47 canonical classes; 15 classes combine upper and lower case. `handprintClassificationReport`, `chooseHandprintThresholds` and `evaluateHandprintRecognizer` distinguish classification accuracy from observed precision and coverage after withholding uncertain readings. Threshold selection uses validation images before the frozen model sees test images. The published source split is not verified as writer-disjoint. This does not establish connected handwriting recognition.

`createHandwritingSequenceRecognizer` is a separate experimental temporal neural learner. It uses the shared `TrainableDenseLayer`, which extends AGI's `Layer` and delegates GPU matrix products to `TensorOps`. Configurable dilated context, residual connections, a linear output stage and exact CTC gradients learn from complete word images. Each context stage has its own weights; word boundaries isolate neighboring features from other batch rows. It accepts an injected GPU device or the JavaScript reference. Importing the module does not acquire a GPU or start training. Developer training runs in a cancellable browser worker. It adds no external recognition runtime, pretrained weights or customer training workflow.

The optional `spatialEncoder` learns vertically shared stroke filters before the temporal encoder. Engine's `TensorSpatialMath` supplies bounded NHWC patch extraction, average pooling and their adjoints. The learned filter and its gradients use the same `TrainableDenseLayer` as the temporal network. Patch reductions larger than 4096 rows accumulate bounded GPU products; the original smaller-product execution path remains unchanged. This is a trainable feature extractor, with forward and backward GPU parity and finite-difference checks. It does not imply that a useful general handwriting model has been trained.

| Public API | Contract |
| --- | --- |
| `ctcLoss(logits, {steps, classes, target, blank})` | Bounded log-domain alignment loss and logit gradient; impossible alignments return `infeasible`. |
| `ctcGreedyDecode(logits, {steps, classes, blank})` | Collapses repeated activations and blanks without a vocabulary. Its score is not a calibrated probability. |
| `ctcPrefixBeamDecode(logits, {steps, classes, blank, beamWidth})` | Marginalizes alternate label alignments while retaining at most 32 prefixes over at most 256 steps. It returns an approximate search result, exact summed probability for that selected sequence, and its most likely alignment. No dictionary or supplied transcript influences recognition. |
| `transcriptEditCount(expected, actual)` | Case-sensitive Unicode code-point edit count; at most 4096 characters per input. |
| `createHandwritingSequenceRecognizer(options)` | Returns `trainBatch`, `predictBatch`, `exportModel`, `importModel`, `exportTrainingState`, `importTrainingState`, `getSummary` and `destroy`. Untrained recognition is rejected. |
| `createAdamW(parameters, settings)` | Shared voice/OCR optimizer with staged atomic updates, validated `exportState`/`importState`, `reset` and a measured moment-state byte count. Voice retains its original defaults and measured Float32 outputs; OCR explicitly uses zero weight decay. |
| `widenHandwritingSequenceModel(model, {seed, symmetryNoise})` | Doubles the hidden width of an owned trained model. Keeps source weights immutable, preserves spatial filters when present and retains provenance. It does not certify recognition quality. |
| `extendHandwritingSequenceAlphabet(model, additions, {seed, initialBias})` | Appends owned output classes while preserving encoder weights and original logits. New classes need training; adding classes changes normalized output probabilities. |

The sequence architecture accepts 1–128 unique labels, input width 1–1024, hidden width 2–128 and context radius 0–4. Optional `contextDilations` declares one to six stages, each with dilation 1–32. Omitting it preserves the original schema-version-1 architecture and exported model shape. Declaring it uses schema version 2 and binds the exact dilation list in saved model validation. A batch contains 1–32 sequences, each with 1–256 steps, and no more than 4096 steps in total. Inputs and updates must be finite. Cancellation prevents a partial optimizer update from publishing; callers retain ownership of an injected device. Models use `particle-realms.agi.temporal-ctc.v1`, validate architecture and weight dimensions on import, and carry their trained-step count. Predictions always require review. Their spans mark sequence activations, not verified source-character boundaries. `predictBatch` defaults to greedy decoding; callers can explicitly select `decoder: 'prefix-beam'` and `beamWidth` without modifying learned parameters.

Spatial models use schema version 3 and additionally bind their normalized spatial configuration and convolution weights. Supported spatial channels are 8, 16 or 32, strip widths 5, 9 or 17, height 32, and pooling heights 2, 4 or 8. The standalone input height remains fixed at 32. `exportTrainingState` binds the model to the shared Adam moment state under `particle-realms.agi.temporal-ctc-training.v1`. `importTrainingState` validates all parameter arrays, optimizer shapes, settings, moments and step counts before replacing live state. Actual CPU and GPU CTC continuation is bit-identical after JSON round-trip on the same backend. `importModel` is deliberately weights-only and starts fresh optimizer moments. Developer artifacts now include separately hashed optimizer state bound to the selected model hash; legacy weights-only continuation is explicitly identified in its receipt.

`normalizeHandwritingInk` uses Engine luminance and bilinear sampling to normalize an observed word's ink band. Its bounds come only from pixels, never from a transcript or vocabulary. It returns the original-to-normalized transform and retains blank margins and full-width source ink. It never changes the source byte array. The v3 developer recipe uses this transform, 26-pixel ink height, three temporal dilations `[1, 2, 4]`, and the existing CTC optimizer.

`tests/sewing/handwriting-ctc.html` passed fourteen browser contracts covering alignment sums, finite-difference gradients through temporal and spatial stages, actual TensorOps GPU parity, independent batch words, supervised learning, atomic cancellation and corrupted-checkpoint rejection, exact optimizer continuation, whole-writer partitioning and pixel normalization. `tests/agi/spatial-handwriting.html` passed six contracts including overlapping patch adjoints and a gradient reduction across 8193 patch rows. `tests/agi/adam-state.html` passed five shared-state contracts; the original voice R7 MLP, Conv1D, GAN, checkpoint, OPFS readback and GPU device-loss probe also passed. These are numerical and lifecycle checks, not natural-handwriting accuracy measurements.

`train-connected-handwriting.html` trains on original DHSD German handwritten place-name images, using a fixed 27/5/5 writer split and validation selection before loading test pixels. Optional English adaptation uses original GNHK photograph regions prepared by Engine. `HandwritingPageDataset` retains source quadrilaterals and supplied transcripts, applies bounded projective rectification and pixel-derived ink normalization, and publishes hash-verified pixel shards. Its prepared-corpus reader accepts only training and validation partitions and verifies the pinned index, shard checksums, source identities and row bounds. Original test photographs remain sealed. GNHK has no supplied writer identities: its partition is image-disjoint, not verified writer-disjoint. Unknown, unreadable and unsupported-character regions are counted separately; readable validation regions remain in the reported error denominator. No test transcript, dictionary or customer correction enters optimization.

### Measured developer experiments

These frozen receipts remain experimental. Character error rate (CER) counts case-sensitive insertions, deletions and substitutions. Full validation selects a revision before any final test evaluation. No candidate below has been registered for customer recognition.

| Experiment | Complete validation | Exact words | Selection and scope |
| --- | --- | --- | --- |
| v4 owned visual pretraining plus natural words, width 64 continuation | DHSD 5522 / 11843 characters, 46.627% CER | 12 / 803 | Selected epoch 17 of 23 full continuation epochs. Later full epochs did not beat it. |
| v4 width 128 controlled continuation | DHSD 5498 / 11843, 46.424% CER | 11 / 803 | Selected epoch 8 of 8. Same-eight-epoch width 64 comparison: 48.898% CER, 11 exact. Width helps modestly. |
| v5 English adaptation, width 64 | English 9792 / 14860, 65.895% CER; DHSD 5584 / 11843, 47.150% CER | English 300 / 3538; DHSD 4 / 803 | Selected epoch 9 of 12 by equal-weight mean CER. Starting English CER was 90.828%, 3 exact. All readable English validation words count. |

The English run learned from 4332 eligible DHSD words and 24891 eligible GNHK regions. Its English handwritten-only validation remains 66.574% CER (280 / 3365 exact); the printed subset is 54.994% (20 / 173). Performance is insufficient for dependable connected handwriting. The selected model hash is `5c32163ea050f69b98c0bdfa3fea557681ba63448cae5e2fef3cc869875ceb14`. Its receipt records all 25 captured source files unchanged, 12 completed epochs, a consistent terminal artifact, the frozen DHSD test and the unopened English test. These results predate the spatial frontend and shared optimizer extraction; they are not measurements of that new architecture.

Prepared English input contains 463 training photographs and 52 validation photographs, represented by 509 bounded shards. The pinned index hash is `7255787100caf2354945f8802060bb64f6de33de3414c5efe4800441a79ff6e2`. Data acquisition is covered by the original [GNHK dataset license](https://github.com/GoodNotes/GNHK-dataset); original source provenance, mirror limitations and byte hashes are recorded in `NOTICE.md` and the acquisition receipt. Python tooling only drives the browser or moves data; numerical image preparation, learning and recognition are JavaScript/WebGPU.

The fresh spatial encoder also passed the same eight-word natural-training sanity check as the earlier temporal model. With initialization seed 90127 and training-source selection seed 48231, it reached 8 / 8 exact words, zero edits over 114 characters, after 175 updates. Loss fell from 450.0917924301825 to 0.19341912444760861. All 31 captured sources remained unchanged. This confirms trainable spatial capacity on already-seen images; it measures no unseen-word improvement. Its sanity-only model hash is `e9b90e9f1b769a9f42ccc4be073231d6dcb874270439b1214c048dee55b1be83`.

The versioned `owned-handwriting-gray-aspect-v2` recipe in Engine `HandwritingRasterPreparation` now preserves grayscale and uses a common scale in rectified source-pixel coordinates. It does not establish real-world physical dimensions. It estimates paper background from a pixel histogram, subtracts it without binarizing or amplifying strokes, and fits observed support into 64, 128, 256 or 512 by 32 pixel buckets. Words exceeding the supported width return an explicit issue; they are not squeezed or clipped. Both original DHSD rasters and GNHK quadrilaterals use this function. GNHK v2 samples bounded original-resolution word crops instead of reducing the entire photograph. Saved transforms map output pixel-edge coordinates to the original source and back.

The original v1 recipe remains available unchanged. New grayscale shards preserve all 32495 source annotations and publish separately with index hash `aca5a3aebe1a50074ce7c4afced7b7b1e09283e7609b54f4dd61caceb20d2d49`. All fourteen captured preparation sources remained unchanged; 1284 unreadable source markers and one source-raster budget issue remain explicit. Six new browser contracts verify retained grayscale, long-word handling, blank/unsupported states, rotated/invertible coordinates, real full-resolution English crops, variable-width CPU/GPU parity and subpixel source rejection. These pixel and source contracts do not measure a new recognition model. The initial immutable shard provenance named the image-scale field `physicalScale`; that field is an output-to-rectified-source pixel ratio, with no physical calibration. Current output explicitly names it `rectifiedPixelScale` and declares those units.

`handwritingRasterTransformReport` checks the shared matrix inverse at all four observed ink-support corners before a source map is published, including the translation back into an original photograph. Support below one rectified source pixel is explicitly unsupported. This prevents the generic inverse's identity fallback for nearly singular matrices from masquerading as a valid crop map. The general Engine matrix inverse and its threshold remain unchanged.

The complete saved-corpus transform audit passes for all 32495 records, including all 31210 prepared rasters and 1285 recorded issues. No existing prepared raster is rejected by the new guard. Maximum round-trip error is 0.00143404 output pixels and 0.00208332 source pixels; the minimum observed support spans are 2 source pixels horizontally and 2.69917 vertically. Test sources remain unopened. The exact receipt is `tmp/handwriting/complete-source-transform-audit.json`.

### One-epoch preprocessing continuation comparison

The controlled pair starts both arms from the same v5 model, with fresh optimizer moments, 29220 intersected eligible training records (4332 DHSD and 24888 English), identical sorted source order and seeded shuffle, effective batch 16, and exactly 1827 updates per arm. Each completes within a six-minute phase budget. All 33 captured sources remain unchanged; both test partitions stay sealed. Validation retains every readable word, including unsupported preparation outcomes. The cohort hash is `957b2a37080958097811d91204e0c9d65ce73ceaecfa8399da29271122164cc8`.

| Input and learning phase | English CER / exact words | DHSD CER / exact words | Elapsed |
| --- | --- | --- | --- |
| v5 weights, original preparation | 65.895% / 300 of 3538 | 47.150% / 4 of 803 | Prior selected baseline |
| Same unchanged weights, grayscale preparation | 82.927% / 67 of 3538 | 56.236% / 2 of 803 | 61.197 seconds, zero optimizer updates |
| Original preparation, one matched continuation epoch | 64.919% / 344 of 3538 | 46.129% / 7 of 803 | 283.800 seconds |
| Grayscale preparation, one matched continuation epoch | 69.818% / 275 of 3538 | 54.091% / 1 of 803 | 277.541 seconds |

Grayscale retraining recovers much of the preprocessing-shift loss, but the original preparation remains better after this one epoch. Because the initial weights were trained on the original recipe, this measures short continuation behavior; it does not establish a from-scratch preprocessing winner. Neither arm is dependable connected handwriting. No candidate is registered. Exact comparison receipts are in `tmp/handwriting/gray-aspect-paired-comparison.json`, verified by `tests/sewing/compare_handwriting_preparation_runs.py`. Selected model hashes: original `c72d9c9379d9d1e1e756cc563ed1fa4bdcf74ebd85c1ba586c5bb328b7bce7b9`; grayscale `9a071d3ba4bd8ca71436c99178866bd3dc5fcf0c69097909c66e7e52911d12a1`.

The three temporal dilations cover 29 positions, about 65 normalized source pixels including the input strip. [SVTRv2](https://arxiv.org/abs/2411.15858) motivates aspect-sensitive sizing and CTC feature alignment for scene text; [Easter2.0](https://arxiv.org/abs/2205.14879) studies deeper convolutional context and augmentation for handwriting. Neither paper establishes this project's accuracy. Preprocessing-only evaluation with old weights must be identified as a distribution-shift diagnostic; matching training and a controlled old-recipe continuation are needed before claiming an improvement. Both domains retain all readable validation words in the denominator, including words the new preparation cannot process. Current generic augmentation and punctuation expansion are available but have not yet produced a validated natural-handwriting model.

`ctc-fit-diagnostic.html` preserves the default 128-image, already-seen training diagnostic. Explicit `artifact`, `partition=validation|test`, and `decoder=greedy|prefix-beam` query options evaluate a complete original writer partition with a hash-verified, immutable saved model. A decoder experiment must remain distinct from the model-selection receipt; neither may tune against test transcriptions.

Sources: `agi/vision/GlyphRecognizer.js`, `HandprintEvaluation.js`, `CtcMath.js`, `HandwritingSequenceRecognizer.js`, `engine/core/text/HandprintDataset.js` and `HandwritingSequenceDataset.js`. Original data provenance and reuse terms are recorded in repository `NOTICE.md`; the CTC formulation is from [Graves et al.](https://www.cs.toronto.edu/~graves/icml_2006.pdf).

## Related

- [GPU Device Sharing](../concepts/gpu-device-sharing.md) — the tensor library runs on the shared device.
- [Engine](../engine/index.md) — AGI is built on Engine v2.
