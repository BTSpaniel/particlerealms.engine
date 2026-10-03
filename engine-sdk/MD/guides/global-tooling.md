---
title: Shared Tool Catalog and Trace Viewer
description: Find repository and live OS tools, follow their declared relationships, and inspect recorded execution evidence.
updated: 2026-09-12
---

<!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha -->

# Shared Tool Catalog and Trace Viewer

Tool Atlas connects repository tooling, test and evaluation adapters, indexed OS programs, and exported live ToolDriver invocations. It separates their definitions from execution evidence and lets a reviewer follow connections back to source files and logs.

## Open the HTML viewer

Run from the repository root:

```powershell
python tools/run_tools.py audit
python start_server.py
```

The audit prints a `tmp/tooling/<run>/tools.html` location. Open that path under `http://127.0.0.1:9001/`. Each testing-platform audit or run also creates `tools.html` beside its existing `report.html`, with a Tool Atlas link in the testing report. Both viewers are standalone HTML with embedded data and no external assets.

Choose Programs, Tools, Evaluations, Test suites, or Source files. Select an entry to see declared incoming and outgoing connections. Each connected entry opens its own source, relationships, and recorded invocations. The Observed runs tab shows terminal outcomes, parent correlation when recorded, input snapshots, output metadata, and local evidence links. No execution evidence is shown as an explicit absence, not a passing result.

Source: `tools/tooling/catalog.py`, `tools/tooling/viewer.html`, `tools/tooling/reports.py`, and `tools/testing_platform/reports.py`.

## Shared commands

```powershell
# Inert discovery; the default action is audit.
python tools/run_tools.py list --category program
python tools/run_tools.py list --category evaluation --json
python tools/run_tools.py list --id 'tool:MD/tools/*'

# Inspect a reviewed command, including its declared effects, before execution.
python tools/run_tools.py run --id 'tool:MD/tools/build_docs.py' --dry-run

# Execute existing builders through the same isolated process/evidence runner.
python tools/run_tools.py run --id 'tool:MD/tools/build_docs.py' --id 'tool:MD/tools/build_llms.py'

# Existing suite IDs also work through the shared command interface.
python tools/run_tools.py run --id 'python:tests/tooling/test_catalog.py'
```

`run` requires an explicit `--id`, which can repeat or use a quoted glob. Unknown patterns, unreviewed tools, and runtime declarations cannot execute. The [shared queue](global-tooling-queue.md) expands prerequisites and coordinates resource leases across participating runs. Use `plan` to inspect the graph and `--jobs` to permit reviewed compatible work to overlap. The Queue tab explains waits and dependency outcomes. `--timeout`, `--fail-fast`, and `--output` retain bounded execution and fresh report directories. The original `tools/run_tests.py` command, profiles, suite IDs, JUnit handling, GPU gates, and Windows process cleanup remain available.

`tools/tooling/registry.json` contains the reviewed repository commands and additional declared relationships. The two initial command adapters reuse the documentation search/navigation builder and machine-discovery builder. Their registry entries disclose the generated files they rewrite. Discovering a Python entry point does not make it executable through this interface.

Source: `tools/run_tools.py`, `tools/testing_platform/execution.py`, `tools/tooling/registry.json`.

## Bring in live OS evidence

The existing kernel tool driver provides a data-only export:

```javascript
const trace = kernel.toolDriver.exportToolingTrace();
const blob = new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const download = document.createElement('a');
download.href = url;
download.download = 'runtime-tool-trace.json';
download.click();
setTimeout(() => URL.revokeObjectURL(url), 1000);
```

Use a trusted development context with the real `kernel` instance. Select the saved JSON using **Add OS or repository trace** in Tool Atlas. Importing does not call any tool, register a command, or alter permissions. An equivalent Python import creates a separate report:

```powershell
python tools/run_tools.py trace --trace-file tmp/tooling/runtime-tool-trace.json
```

Runtime IDs use `runtime-tool:<canonical name>`. Runtime ownership uses `program:<appId>`, allowing an exported tool to connect to an indexed app definition. Current registration metadata and invocation-time versions remain distinct. Completed calls can be succeeded, failed, blocked, or unknown; uncertain mutations stay unknown. Exports omit argument values and hashes, result content, error messages, and stacks. Retention limits and pending or omitted observations are included.

The export covers the existing ToolDriver boundary. It does not cover pre-driver ToolRouter rejections, all CommandBus activity, verifier calls, or effect-ledger reconciliation. Catalog ownership is descriptive and does not replace kernel permission checks.

Source: `webgpu-os/kernel/ToolDriver.js`, `webgpu-os/kernel/tools/ToolTraceExport.js`.

## Evidence and identity

| Record | Meaning |
| --- | --- |
| Stable definition ID | Existing suite ID, `tool:<repository path>`, `program:<appId>`, or runtime canonical tool name. Display names and revisions are separate. |
| Source revision | SHA-256 of the cataloged file bytes, or a runtime implementation/package hash when the registration supplies one. Missing metadata remains missing. |
| Declared connection | Authored manifest, reviewed adapter, or registry relationship. It does not prove an invocation occurred. |
| Invocation span | A unique trace/span identity, tool ID, command contract digest, boundary timestamps, outcome, and input/output metadata. Blocked admission is distinguished from process execution. |
| Repository input snapshots | Declared source/input bytes before and after the invocation, with changed paths visible. Each shared snapshot is bounded to 64 MiB per file. |
| Output snapshots | Fresh per-run logs and child receipts, plus declared repository outputs marked created, changed, unchanged, or unavailable. Unchanged existing output does not become proof of fresh generation. |
| Parent correlation | Repository child processes inherit `PR_TOOL_TRACE_ID` and `PR_TOOL_PARENT_SPAN_ID`. A nested shared runner uses those IDs. They are caller-supplied correlation, not authenticated ancestry. Runtime parents stay empty unless actually recorded. |
| Trace assessment | Compares a claimed command contract and available input hashes with the catalog snapshot. A match is not execution authenticity proof. All JSON remains unsigned and editable. |

The platform snapshots a declared subset, not every transitive import or file read. Matching before/after hashes cannot prove that a file remained unchanged throughout execution. Runtime exports describe argument and output sizes without their contents. Repository logs retain the original runner's content and should be reviewed before sharing.

The viewer rejects malformed invocation records, invalid digests, ancestry cycles, duplicate identities within an import, and conflicting records across imports. Imported names are rendered as text. Imported source and output paths never become active file links. An exact duplicate record is retained once.

Source: `tools/tooling/provenance.py`, `tools/tooling/viewer.html`.

## Extend the catalog

Keep tools in their owning source directories. Add a reviewed adapter to `tools/tooling/registry.json` only after checking the real entry point, arguments, working directory, effects, requirements, timeout, inputs, outputs, and evidence contract. Use `verifies` for explicit test/evaluation targets and `uses` for declared dependencies. Output relationships are marked declared, even when a later run observes changed bytes.

Tests continue to use `tools/testing_platform/suites.json` or existing inert discovery. Live tools continue to register through ToolDriver. Per-app protocol discovery, CommandBus, compute operations, and factory registries remain authoritative within their own domains. The shared catalog connects those boundaries; it does not copy their dispatch or permission logic.

## Validation

```powershell
python tools/run_tests.py run --suite 'python:tests/testing_platform/*' --suite 'python:tests/tooling/*' --suite 'browser:tests/navi/run_tooling_trace_export_tests.py'
```

The selected tests exercise real child processes, output changes, malformed imports, fail-fast, inert discovery, browser navigation, trace export, and compatibility with the original runner. Browser viewer regression tests require the existing Python Playwright package and an installed Chromium-family browser. Existing unrelated product failures remain listed in the testing audit.

## See also

- [Global testing platform](global-testing.md)
- [Shared test and tool queue](global-tooling-queue.md)
- [Global testing audit](global-testing-audit.md)
- [Research and runtime boundaries](global-tooling-research.md)
- [Independent platform review](global-tooling-review.md)
