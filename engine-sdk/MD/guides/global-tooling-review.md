---
title: Shared Tooling Foundation Review
description: Independent acceptance score, trace-integrity checks, compatibility evidence, and limits of the global tooling foundation.
updated: 2026-09-12
---

<!--
SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
-->

# Shared Tooling Foundation Review

The independent reviewer rates the shared tooling foundation **8.5/10**, meeting the requested minimum of 8/10 on 2026-09-12. This review covers the program/tool/test/evaluation catalog, recorded execution traces, inert trace imports, compatibility with the testing platform, and the Tool Atlas viewer. It does not certify every repository tool or claim complete runtime instrumentation.

The reviewer inspected the implementation, authored independent provenance and real-browser regressions, reproduced import defects, and checked the corrected final integrated run. An additional browser exercise used the actual repository catalog, actual recorded test runs, and an actual ToolDriver export. No significant correctness or authority-boundary defect remains in those exercised paths.

## Scoring rubric

| Area | Score | Evidence and remaining limit |
| --- | --- | --- |
| Identity, ownership, and evidence correctness | 2.7 / 3.0 | Stable definition IDs remain separate from invocation IDs and revisions. Collision rejection, context binding, typed evidence validation, and conflicting-import tests pass. Local records remain unsigned claims. |
| Traceability across repository and OS boundaries | 2.1 / 2.5 | Source snapshots, declared outputs, fresh logs, parent correlation across actual nested processes, and a runtime-tool-to-source bridge work. Runtime source metadata is optional and declared; the export does not observe every system boundary. |
| Discovery and scope completeness | 1.1 / 1.5 | Programs, tools, test suites, evaluations, source nodes, ownership, and declared relations share one catalog. Unreviewed tools remain discoverable without becoming executable. Automatic dependency discovery and reviewed command coverage remain limited. |
| Compatibility, isolation, and maintainability | 1.3 / 1.5 | Existing test IDs and runner behavior remain covered by all five platform regression suites. The implementation reuses the existing execution and ToolDriver history boundaries. POSIX process cleanup was not exercised on this Windows host. |
| Viewer usability and import safety | 1.3 / 1.5 | Real-browser tests cover relationship traversal, logs, hostile text, invalid metadata, conflicting records, merged ancestry cycles, and runtime export shapes. Final desktop/mobile checks pass. The HTML viewer inspects data; execution remains a Python command. |
| **Total** | **8.5 / 10.0** | **Accepted for the documented shared-foundation scope.** |

A significant unresolved false ownership claim, fabricated execution claim, accidental execution from discovery/import, or compatibility failure would prevent acceptance at 8/10 regardless of the numerical total.

Sources: `tools/tooling/`, `tools/run_tools.py`, `tools/run_tests.py`, `tools/testing_platform/execution.py`, `webgpu-os/kernel/ToolDriver.js`, and `webgpu-os/kernel/tools/ToolTraceExport.js`.

## Final execution evidence

The final integrated receipt is `tmp/tooling/verified-global-base/run.json`, completed at `2026-09-12T15:08:29.982448+00:00`. It records **12/12 selected suites passed**, with no skipped, blocked, failed, or unrun suite. Its SHA-256 is `98e2b641410cfe00a43bd604b0195494721703e49d2fc194c924704a720328e5`.

| Selection | Recorded evidence |
| --- | --- |
| Five existing testing-platform regression files | 88 passing Python case events, including subtests. This retains coverage of truthful outcomes, receipt validation, pytest evidence, process-tree cleanup, and the original CLI/report behavior. |
| Shared catalog regressions | 20 passing Python events. Identity collisions, ownership separation, inert discovery, and reviewed command contracts remain checked. |
| Shared CLI regressions | 14 passing Python events. Actual reviewed execution, inert audit/list/import, explicit selection, preserved previous evidence, and fail-fast behavior pass. |
| Independent provenance regressions | 45 passing Python events: 20 test methods plus 25 subtests. The actual nested CLI subprocess keeps its parent's trace and span correlation. |
| Independent viewer regressions | 8 passing real-browser tests, covering both repository and runtime-style reports. |
| Plauna workbench | Existing browser runner reports 3/3 passed. |
| ToolDriver trace export | Existing browser wrapper reports 10/10 passed, including revision changes, admission blocks, unknown mutation outcomes, omitted sensitive content, and bounded history. |
| AI Echo contracts | Existing deterministic evaluation reports 4/4 passed. |

The Python evidence totals **175 passing case events**. Browser and evaluation counts remain their child runners' reported contracts; they are not invented platform assertion totals. Repeated direct reviewer runs overlap this evidence and are not additional coverage.

The final Tool Atlas snapshot contains **50 programs, 401 tools, 324 test suites, 6 evaluations, and 3,003 source nodes**, connected by 1,560 declared edges. Two repository commands have reviewed executable adapters. Its `unreviewedTools` summary recorded 397 because it also counted one unreviewed program. A subsequent category-filter correction makes the current count 396; the implementing agent reran all 13 catalog test methods successfully. This summary correction does not alter execution eligibility or the retained 12-suite receipt. The existing testing adapters remain separately executable. Counts describe a working-tree snapshot, not immutable inventory targets.

Reproduce the exercised selection from the repository root:

```powershell
python tools/run_tests.py run --suite 'python:tests/testing_platform/*' --suite 'python:tests/tooling/*' --suite 'browser:tests/navi/run_tooling_trace_export_tests.py' --suite 'browser:plauna-workbench' --suite 'eval:ai-echo-contracts'
```

Sources: the final receipt, its child logs and JUnit files, `tests/tooling/`, and `tests/navi/run_tooling_trace_export_tests.py`. Run artifacts under `tmp/` are local evidence; the source-controlled tests provide the repeatable checks.

## Independent viewer acceptance

`tmp/tooling/verified-global-base/reviewer-viewer-check.json` records an independent exercise of the final `tools.html` over HTTP in a real browser. It checks program lookup and a source link, an actual recorded run and its log, then imports `tmp/tooling/runtime-tool-trace.json` and follows the runtime tool's declared source relation to the existing repository source node. All three inspected links return HTTP 200.

The imported invocation remains labelled as unsigned and unverified, with no imported evidence link enabled. The viewer contains 12 local observations before import and 13 observations after adding the one runtime record. There are zero page errors and no horizontal page overflow at 390 pixels. The reviewer inspected `reviewer-viewer-desktop.png` and `reviewer-viewer-mobile.png` from the same report directory.

## Corrections required by review

- **Silent ownership collisions:** declaring apps initially shared action IDs. The final catalog preserves each declaring owner and rejects incompatible category/source collisions.
- **Import validation drift:** the browser initially accepted malformed file digests and negative byte counts rejected by Python. Both import paths now validate those records.
- **Conflicting duplicate executions:** the browser initially kept the first record silently when an imported trace reused its identity with a different outcome. Conflicts now reject the import; identical duplicates remain a single record with their original provenance.
- **Ancestry across imports:** two separately valid imports could create a cycle when combined. The viewer now validates the merged ancestry before changing its records.
- **Ambiguous assessments:** assessment records initially omitted the trace ID. They now include both trace and span IDs, preserving identity when different traces reuse a span number.
- **Nested CLI correlation:** a new top-level trace ID initially replaced valid inherited correlation. Both CLIs now preserve valid caller correlation, verified with a real nested subprocess invocation.
- **Runtime report shape:** runtime exports use structured limitation metadata and content-free argument/output metadata. The shared viewer now accepts that documented shape and preserves its limitations.

The review also required separate command-contract and source-byte comparisons, before/after input observations, output freshness labels, nonzero hexadecimal invocation identities, and binding each final result to the context and command that began it. A matching command contract never implies matching source bytes or authenticated execution.

Sources: `tests/tooling/test_provenance.py`, `tests/tooling/test_viewer.py`, `tests/tooling/test_catalog.py`, `tools/tooling/provenance.py`, and `tools/tooling/viewer.html`.

## Remaining limits

The foundation records declared relationships and bounded invocation observations. It does not prove complete input dependencies, continuous file integrity, generated-output causality, signed provenance, or full environment reproducibility. Before/after equality is a boundary comparison. Imported records never grant execution authority. Source and command hashes serve different comparisons.

The runtime export covers retained completed `ToolDriver.execute()` calls. Router rejections before that boundary, CommandBus execution, verifier calls, and effect-ledger reconciliation are outside this export. Native runtime tool IDs stay separate from app action declarations. Missing source metadata remains unknown. A succeeded handler is not automatically verified mutation completion; unknown outcomes remain unknown.

The prior schema-catalog and Virtual Realm failures remain existing repository defects described in the [testing-platform review](global-testing-review.md). This successful foundation selection does not erase those failed receipts or certify unrelated GPU, hardware, long-running, deployed-service, or manual evaluation paths.

## See also

- [Shared tool catalog and trace viewer](global-tooling.md)
- [Design research and runtime boundaries](global-tooling-research.md)
- [Global testing platform review](global-testing-review.md)
- [Security and trust model](../concepts/security-model.md)
