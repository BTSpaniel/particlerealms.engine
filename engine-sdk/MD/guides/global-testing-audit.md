---
title: Global Testing Audit
description: Repository-wide test inventory, shared execution profiles, evidence contracts, and remaining automation gaps.
updated: 2026-09-12
---

<!--
SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
-->

# Global Testing Audit

The global testing platform inventories the repository and runs existing Python and browser tests through one command. It preserves each runner's acceptance conditions and records tests that still need an adapter. This audit is for maintainers deciding what a result proves and which coverage gaps to address next.

## Run the platform

Run these commands from the repository root:

```powershell
python tools/run_tests.py audit
python tools/run_tests.py list --profile smoke
python tools/run_tests.py doctor --profile smoke
python tools/run_tests.py run --profile smoke --output tmp/testing-platform/smoke
python tools/run_tests.py run --profile gpu --output tmp/testing-platform/gpu
python tools/run_tests.py run --profile diagnostic --output tmp/testing-platform/diagnostic
```

Use `list --json` for machine-readable suite metadata. Profiles include `python`, `browser`, `integration`, `eval`, `gpu`, `soak`, `diagnostic`, `release`, and `all`. An `all` run includes registered executable suites. Unadapted inventory entries remain visible; inventory membership does not execute an arbitrary file. The `release` profile includes the full Navi acceptance build, which writes release artifacts; select it deliberately when preparing a release.

The platform uses Python tooling and HTTP-served browser ES modules. Existing browser adapters use installed Chromium-family browsers, Python Playwright, or Python websocket-client. No Node project or npm build step is added.

(Source: `tools/run_tests.py`, `tools/testing_platform/catalog.py`, `tools/testing_platform/suites.json`.)

## Inventory method and scope

Discovery walks source files and uses test-directory and filename conventions. It parses Python test definitions and imports without importing test modules during the audit. It associates statically referenced browser scripts with registered pages. Explicit adapter entries bind reviewed command arguments, timeouts, requirements, and evidence contracts.

The scan includes tests outside the root `tests/` directory: `bundler/`, `Masterserver/`, `game2/`, `client/`, `server/`, `Life/`, `cardbattles/`, `jhc/`, and app-owned test directories. Both `game2/tests/test_schema_browser.py` and `game2/tests/test_schema_evolution.py` are discovered. The exclusions cover temporary/output/environment directories, vendored code, and the protected `engine/kaolin/` and `engine/sim/physics/` trees.

The final platform verification snapshot on 2026-09-12 contained 2,813 candidate artifacts and 323 executable suite entries, including 25 explicit adapters, 19 recognized Navi delegates, and 279 Python test files. The artifact categories included 878 browser pages, 18 evaluation files, 981 JavaScript test candidates, 325 Python runners, and 199 demonstrations. These are discovery counts, not independent assertions or passing results. There were 2,046 candidates needing adapter review. Regenerate the audit for current totals as adapters and tests change.

The candidate list intentionally exposes uncertainty. It distinguishes demonstrations and browser fixtures while retaining support files for traceability. Generated bundles under `tests/assets/` and archived pages are excluded. For example, `tests/index.html` is the product landing page; `tests/guide/`, `tests/playground/`, and the phase demonstration folders include interactive teaching material. A directory named tests does not make every page an acceptance gate. Entries marked `needs-adapter` require protocol review before automatic execution; they are not evidence that a product feature lacks tests.

(Source: `tools/testing_platform/catalog.py`; snapshot produced by its `discover()` function.)

## Existing harnesses reused

| Existing family | Evidence contract | Global treatment |
| --- | --- | --- |
| Navi status pages | Root terminal status plus exact positive assertion count and final summary | Reuse `tests/navi/run_browser_status_page.py` for reviewed pages and recognized wrappers. |
| RealmForge and Virtual Realm | DOM counts and immutable `__REALMFORGE_TEST_RESULT__` | Reuse `tests/realmforge/TestHarness.js`; preserve exact counts in selected adapters. |
| Protected Virtual Realm startup | Exact served-module inventory, separate browser targets, fixed counts, no skips, no unexpected errors | Reuse the dedicated CDP runner; preserve its source boundaries and failure witness. |
| Native Particle/Fluid GPU | Runner receipt, native page receipt, explicit GPU requirement, frame/cycle evidence | Use `--require-gpu` and a fresh receipt destination; keep GPU and soak profiles explicit. |
| Compute | Page-specific terminal element, operation parity, or Python/JavaScript schema comparison | Reuse dedicated transport-aware servers and pinned receipt schemas. |
| Factory package contracts | `UNTESTED`, `PARTIAL`, `FAILING`, `PASSING`, or `VERIFIED` grade plus checks | Retain existing contract APIs; a returned report alone is not a successful test. |
| AppForge smoke aggregation | `__APPFORGE_SMOKE_RUNNER__` with `ok` and child results | Inventory the existing aggregator; do not infer success from iframe navigation or page load. |

Sources: `tests/navi/run_browser_status_page.py`, `tests/realmforge/TestHarness.js`, `tests/virtual-realm/run_protected_startup_browser.py`, `tests/run_particle_fluid_webgpu_smoke.py`, `tests/compute/run_compute_operations.py`, `tests/compute/run_compute_contracts.py`, `webgpu-os/factory/testing/index.js`, `webgpu-os/factory/testing/grades.js`, and `tests/appforge-smoke-runner.mjs`.

## Existing aggregate gates

The registry also admits the existing aggregate runners. They retain their working directories, child environments, ordering, and timeouts instead of flattening a release gate into unrelated commands.

| Suite ID | Existing command | Acceptance scope |
| --- | --- | --- |
| `integration:particle-matter-fast` | `python tools/run_particle_matter_validation.py --group fast` | Six static/browser child commands. Receipt requires all six selected, executed, and passed, with no unrun commands. |
| `integration:schema-static` | `python tools/run_schema_compatibility.py --static-only` | Four cross-subsystem command checks, including schema inventory, storage contracts, LLLM, and JHC. Omits checks flagged as browser. |
| `release:schema-full` | `python tools/run_schema_compatibility.py --full` | Twenty-four command checks, adding browser compatibility/storage waves and First Shard planning-pack validation. |
| `integration:morphfield-python` | `python tests/morphfield/run_python_tests.py` | Four schema freshness, conformance, shader, and HTTP-route commands; every child exit must succeed. |
| `release:navi-alpha` | `python tests/navi/run_navi_alpha_tests.py` | Thirty-seven serial gates with exact 2,748-assertion and two-structural-gate evidence, ending in the no-cache WebGPU OS build. |

Navi Alpha validates focused assertion summaries, phase aggregate summaries, import-audit output, and release manifest/site/archive consistency. It fails immediately on a failed child or count drift. One existing WebAuthn child requires Chrome at its fixed Windows installation path. It has no help-only command-line mode; invoking it begins acceptance execution. The platform keeps it in the opt-in `release` profile.

The schema and Particle Matter receipts count child commands. Those aggregate counts must not be presented as individual assertion counts or proof that every nested pytest case avoided a skip. Their original runners remain responsible for child evidence; direct Python suites expose case-level JUnit results separately. Registry source lists include the actual generic/dedicated entry script and directly declared child scripts for provenance.

(Sources: `tools/run_particle_matter_validation.py`, `tools/run_schema_compatibility.py`, `tests/morphfield/run_python_tests.py`, and `tests/navi/run_navi_alpha_tests.py`.)

## Findings that affect result trust

1. **A known failure must remain visible.** The Virtual Realm descriptor-boundary witness was recorded as failing in session memory on 2026-09-12. The registry gives it its own `diagnostic:virtual-realm-descriptor-gap` suite. It is not converted to an expected pass. Its current result comes from running the witness. Source: `tests/virtual-realm/run_protected_startup_browser.py` gate `descriptor-gap`.

2. **GPU absence can otherwise look green.** The native particle/fluid runner defaults to allowing a GPU skip with exit code zero. Both platform GPU and soak adapters set `--require-gpu` and validate a receipt with positive native case counts. Browser tests that deliberately disable GPU are classified as orchestration/contract tests and their notes say so. Sources: `tests/run_particle_fluid_webgpu_smoke.py`, `tests/kernel/run_gpu_frame_coordinator_tests.py`, and `tests/editor/run_editor_gpu_recovery.py`.

3. **Terminal status alone can be vacuous.** RealmForge `finish()` sets passed when there are no failing cases, including an empty or entirely skipped queue. Counted adapters require their exact passing count. Factory grading correctly labels zero checks `UNTESTED`; consumers must retain that meaning. Sources: `tests/realmforge/TestHarness.js` and `webgpu-os/factory/testing/grades.js`.

4. **Browser environments are not interchangeable.** The Navi direct-Chromium fallback disables GPU, and its simple server does not add cross-origin isolation headers. AudioWorklet/SharedArrayBuffer and real GPU suites use dedicated adapters that retain the necessary headers, gestures, flags, and cleanup. The protected Virtual Realm runner also has a deliberate served-source allowlist that must not be replaced with a broad server. Sources: `tests/navi/run_browser_status_page.py`, `tests/network/run_realm_browser_tests.py`, `tests/particle-voice/run_voice_production_streaming_tests.py`, and `tests/virtual-realm/run_protected_startup_browser.py`.

5. **Generated receipts need unique destinations.** Some dedicated runners default to fixed, dated paths under `tmp/`. Registered receipt adapters receive a new path in the current run's output directory and validate the newly written result. This prevents an old file from being mistaken for current evidence. Sources: `tests/compute/run_compute_contracts.py` and `tests/run_webgpu_os_boot_performance.py`.

6. **Python browser tests can skip at import time.** `game2/tests/test_schema_browser.py` calls `pytest.importorskip('playwright.sync_api')`; other Python test files also depend on optional packages. A zero process exit does not by itself prove every selected test executed. The global report must expose missing requirements and skips rather than claiming full coverage. Source: `game2/tests/test_schema_browser.py`.

7. **Many pages use local result conventions.** Some report `#result.dataset.result`, others `#results.dataset.status`, root attributes, a custom global, downloadable JSON, or only visual state. Substring matches against source HTML can mistake a literal for executed evidence. Unreviewed pages stay in the inventory until an adapter validates their actual terminal DOM or receipt. Examples: `tests/agi/tensor-matmul.js`, `tests/agi/glyph-recognizer.js`, `tests/appforge-smoke-runner.mjs`, and `tests/paint-static-performance.js`.

## Evaluation and benchmark meaning

| Evaluation | What a successful run establishes | What remains a separate claim |
| --- | --- | --- |
| AI Echo Phase 8.40 deterministic mode | Bounded receipt schema, exact UTF-8 accounting, reconstruction, concurrency, and calculator adoption evidence | Overall assistant quality or general prompt savings |
| AI Echo timed mode | Forty-one alternating samples per comparison; independently checked p50/p95 summaries | Positive speed savings; the runner deliberately does not require them |
| Compute routing benchmark | Numeric parity and correct application of the measured 90-percent routing policy | A universal runtime or speed threshold across devices |
| Voice listening model tests | Thirty-nine synthetic state-machine and evaluation-accounting contracts | Human listening intelligibility or acoustic recognition accuracy |
| Voice matmul risk gate | GPU parity and the page's projected 30-percent headroom threshold | Portable performance on all browsers, drivers, and GPUs |
| Packaged OS boot observations | Empty-context cold/warm readiness, no recorded boot errors, and timing observations | Authenticated-account boot performance or a latency service target |
| OCR quality benchmark | Frozen-model fixture execution, error metrics, provenance, and runtime failures | A quality pass threshold; `qualityPassThreshold` is explicitly null |
| OCR joined-print evaluation | Fixed authored-pixel corpus measurements and completion | Real handwriting accuracy; authored pixels are not collected handwriting |
| RealmForge generation benchmarks | Generation, serialization, size, and optional fingerprint observations | A regression budget; several pages publish passed after collecting measurements |

Sources: `tests/run_ai_echo_phase840_benchmark.py`, `tests/compute/compute-benchmark.js`, `tests/particle-voice/generated-listening-evaluation.html`, `agi/particle_voice/risk/matmul-bench.html`, `tests/run_webgpu_os_boot_performance.py`, `tests/sewing/ocr-quality-benchmark.js`, `tests/sewing/ocr-joined-evaluation.js`, and `tests/realmforge/construction-generation.benchmark.html`.

The OCR pages remain available as manual evaluation tools. The quality benchmark requires a Run interaction and reports measurements without inventing a score threshold. Paint performance pages also need dedicated receipt adapters: they emit JSON and can optionally POST artifacts to a specially configured local server. They are not automatically admitted through a generic status-page runner.

## Remaining coverage work

Use the generated inventory to prioritize adapters for unregistered RealmForge/Virtual Realm pages, Sewing/OCR, Factory/AppForge, older AGI tensor pages, and app-owned suites. Reuse a family's existing protocol and server before adding a runner. Record whether a suite uses native resources, controlled resources, human judgment, optional packages, a deployed bundle, or a live service.

A reviewed adapter should declare the exact command and timeout, preserve process exit status, collect a fresh result, reject missing/empty terminal evidence, and make skips or missing prerequisites visible. Measurement-only evaluations need their scope stated in the suite notes. Any future quality threshold needs an explicit corpus and acceptance policy rather than a threshold inferred from current results.

The platform unifies discovery and execution evidence. It does not make the unexecuted inventory pass, convert visual inspection into assertions, or certify every subsystem from a representative smoke run.

## See also

- [Global Testing Platform](global-testing.md)
- [Independent Platform Review](global-testing-review.md)
- [Engine Stack Usage](engine-stack-usage.md)
- [Capabilities](capabilities.md)
- [Documentation Workflow](../contributing/doc-contribution-workflow.md)
