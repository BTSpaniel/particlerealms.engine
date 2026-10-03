---
title: Global Tooling Catalog and Trace Design
description: Primary-source research and the repository's existing building blocks for shared tooling discovery and execution tracebacks.
updated: 2026-09-12
---

<!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha -->

# Global Tooling Catalog and Trace Design

The shared tooling platform separates programs, tool definitions, evaluation suites, and actual executions. This guide records the research behind that structure and the existing runtime systems it reuses.

## Design from primary sources

| Source | Applicable principle | Local decision |
| --- | --- | --- |
| [OpenLineage object model](https://openlineage.io/docs/spec/object-model/) | A design-time job description and a runtime execution event represent different observations. | Keep the declared catalog graph separate from execution spans. Discovering a script or tool never proves it ran. |
| [W3C PROV data model](https://www.w3.org/TR/prov-dm/) | Entities, activities, and responsible agents have distinct roles. Use and generation alone do not establish derivation. | Record ownership, source, dependencies, and observed invocation as different relationships. Do not infer output ancestry from imports or matching filenames. |
| [Backstage entity relations](https://backstage.io/docs/features/software-catalog/well-known-relations/) | Ownership, composition, API exposure, and dependencies have different meanings. Catalog ownership must not assign runtime authorization. | Programs can own tools and suites. These relationships describe responsibility and placement; the existing kernel remains responsible for permissions. |
| [Backstage descriptor format](https://backstage.io/docs/features/software-catalog/descriptor-format/) | Names and namespaces identify entities; the generated database UID is not a stable external reference. | Preserve native tool names in namespaced IDs, separate display names, and capture revision metadata on each invocation. |
| [OpenTelemetry traces](https://opentelemetry.io/docs/concepts/signals/traces/) | A span describes work with start/end times and context. Parent-child relations and links express particular causal relationships. | Store one observed span per completed ToolDriver invocation. Leave its parent empty when no parent was recorded. |
| [W3C Trace Context](https://www.w3.org/TR/trace-context/) | Trace and parent identifiers have precise sizes and propagation semantics. | Use nonzero hexadecimal correlation IDs, but do not claim W3C propagation, OTLP, OpenLineage, or PROV serialization conformance. |

These principles support a small local implementation: Python discovery and execution, browser runtime projections, and JSON files. They do not require a telemetry service, database, collector, Node.js package, or cloud account.

## Runtime systems to reuse

| Existing source | Role | Boundary |
| --- | --- | --- |
| `webgpu-os/kernel/ToolDriver.js` | Authoritative live tool registration, alias resolution, execution, and bounded content-free history. `list()` supplies metadata and `exportToolingTrace()` supplies the shared projection. | A successful handler return does not replace mutation readback verification. |
| `webgpu-os/kernel/tools/ToolTraceExport.js` | Projects retained history into `particle-realms.tooling-trace.v1`. | Exports metadata only. Importing this JSON does not register or execute a tool. |
| `webgpu-os/kernel/protocol/ToolRegistry.js` | Records tools an app declares for discovery. | This is not an execution or authorization registry. Declaring another tool does not establish its ownership. |
| `webgpu-os/kernel/tools/ToolRouter.js` | Guards AI tool calls through existing permission, schema, attestation, and result boundaries. | The trace exporter does not modify or bypass these controls. Rejections before `ToolDriver.execute()` are outside its scope. |
| `webgpu-os/kernel/ledger/ToolCallTrace.js` | Records effect intent and tracks acknowledgment, failure, and reconciliation. | Raw entries can contain arguments. They are not exported by the shared trace projection. Intent alone is not execution. |
| `webgpu-os/kernel/execution/RunEventStreamRegistry.js` | Supplies request-scoped, ordered live events with owner checks and explicit replay-gap errors. | Events are bounded and ephemeral. A missing sequence must remain visible as incomplete evidence. |
| `webgpu-os/kernel/execution/NaviToolResultContext.js` | Keeps large tool observations behind bounded request-local handles. | A result handle is not storage authority, a verified receipt, or proof of derivation. |
| `webgpu-os/factory/registry/index.js` | Registers factory parts, capabilities, provided/consumed contracts, and versions. | A factory part with type `tool` is not automatically a callable ToolDriver registration. |
| `webgpu-os/kernel/navi/builtins/BuiltInToolFaculties.js` | Declares built-in Faculty packages, tool groupings, and package evidence. | Preserve package versions and signed evidence boundaries. Bootstrap metadata alone is not current execution authority. |
| `engine/core/compute/ComputeOperations.js` | Defines versioned compute IDs, schemas, backends, and CPU/GPU comparison contracts. | Preserve IDs such as `math.matrix.multiply@1`; do not rename or duplicate the compute registry. |

## Runtime export

Use the existing kernel instance from trusted development code:

```javascript
const trace = kernel.toolDriver.exportToolingTrace();
const json = JSON.stringify(trace, null, 2);
```

The export includes `schema`, `scope`, `generatedAt`, a driver-instance `traceId`, `catalog.nodes`, `catalog.edges`, `spans`, and `limitations`. Tool IDs use `runtime-tool:<canonical registered name>`. Each span records its invocation-time version, publisher, implementation/package hashes when declared, caller, duration, and content-free argument/output sizes. Source links accept repository-relative paths without traversal or URL schemes. A declared source produces a `source:<path>` node and `defined-in` edge with its declared revision. These IDs match the repository catalog. The exporter does not fetch files or infer missing implementation locations.

Calls can be `succeeded`, `failed`, `blocked`, or `unknown`. A mutating handler that times out or throws can have an unknown completion state; the export preserves that fact. A blocked admission does not claim that its handler executed. The catalog contains current registrations and retained removed definitions, while historical spans keep the revision they actually invoked.

Argument values, argument hashes, returned values, error messages, stacks, and capability tokens are omitted. A plain hash of a short secret can still be guessed from candidate values, so the shared export excludes even the argument digests retained by the existing internal history.

The exporter reuses ToolDriver's entry and byte bounds. Its retention metadata reports completed observations omitted by eviction and started invocations without a completed row. It does not claim complete system history, effect reconciliation, authoritative mutation verification, or signed evidence. Request IDs are correlation labels; no parent-child causality is inferred from them.

Verify the integration with:

```bash
python tests/navi/run_tooling_trace_export_tests.py
```

The browser suite exercises the real ToolDriver and verifies ten contracts, including revision changes during execution, unknown mutation outcomes, admission blocks, exact identity, content omission, and history byte bounds. It does not claim live production workload or GPU coverage.

## Scheduling and resource coordination

The runtime already has several schedulers with different responsibilities. A shared testing queue should preserve those boundaries rather than replace them with another OS scheduler.

| Existing source | Coordination available | Scope and adapter boundary |
| --- | --- | --- |
| `webgpu-os/kernel/ToolDriver.js`, `executePlan()` | Runs read-only calls together, then mutations sequentially. | Ordering applies to one plan. Independent `execute()` or `executePlan()` calls do not share a global resource lock. |
| `webgpu-os/kernel/time/DependencyScheduler.js` and `ParallelTaskScheduler.js` | Dependency readiness, cycle rejection, concurrency limits, and failed-dependent blocking. | `TimeEngine` creates these per request. Missing dependency IDs need separate validation; readiness itself is not execution authority. |
| `webgpu-os/kernel/navi/NaviAgendaPlan.js` | Projects ready, snoozed, unavailable-dependency, and waiting-dependency states. | This is operator planning metadata. Its source explicitly does not dispatch or resume work. |
| `webgpu-os/kernel/ai-hub/AIDispatchScheduler.js` | Bounded queues, owner rotation, provider/route concurrency limits, cancellation, and queue deadlines. | `snapshot()`, `onStart`, and `onRelease` offer existing observation points for model calls. Prompts remain in closures. |
| `webgpu-os/kernel/ComputeService.js` and `engine/core/compute/ComputeRuntime.js` | Owner-scoped CPU/GPU memory limits, queue admission, fair owner selection, and cancellation. | `getStats()` already reports queue pressure and recent `queueMs`/`runMs` measurements. Admission covers this compute runtime, not all machine GPU users. |
| `engine/core/gpu/AsyncGPUWorkScheduler.js` | Ordered GPU command-buffer submission and completion fences. | Priority changes submission urgency while preserving queue order. It is not a host-wide GPU reservation. |
| `engine/state/consistency/SerializableQueue.js` | Declared read/write conflict detection for active transactions. | Conflicts reject admission for retry. This does not lock unrelated filesystem or browser operations. |
| `webgpu-os/kernel/navi/NaviFacultyService.js`, `NaviBackupRecoveryService.js`, and `NaviVfsOverlayService.js` | Named Web Locks around precise operation, backup, and VFS boundaries. | Preserve existing lock names and acquisition modes. A generic queue must not release a lock before its owning operation settles. |
| `webgpu-os/kernel/navi/NaviMicrophoneLease.js` | Conditional exclusive microphone acquisition. | Deliberately does not queue or steal ownership. A new operator start is required after a busy result. |

The [Web Locks specification](https://www.w3.org/TR/web-locks/) defines cooperative coordination between browser contexts sharing a storage bucket. Separate profiles and private browsing sessions have separate lock managers. A matching string in a Python file lock does not join that browser lock domain.

Repository workers can coordinate declared prerequisites and resource claims with other participating workers. They cannot guarantee that a manually launched process, editor, external browser profile, or unrelated application will leave a file or GPU idle. Queue reports must show this scope, their snapshot time, the reason work is waiting, and whether an operation actually started. Runtime queue adapters should report observations from the existing service hooks; importing their reports must remain inert.

Python's [executor shutdown contract](https://docs.python.org/3/library/concurrent.futures.html#concurrent.futures.Executor.shutdown) states that cancelling pending futures does not cancel work that is already running. The repository queue therefore signals its existing subprocess runners, waits for descendant cleanup, and releases resource leases only after each worker settles. This is an implementation decision based on that contract, verified by the independent cancellation and checkpoint-error tests in `tests/tooling/test_scheduler.py`.

The Tool Atlas Queue tab displays a `particle-realms.tooling-queue.v1` snapshot supplied to `write_tooling_report(..., queue=...)`. Each entry links its prerequisites, declared resources, wait reason, and retained queue events. A recorded invocation link appears only when its exact trace/span identity is present. Refresh reads the report's sibling `tool-queue.json`; it updates queue observations without starting work or fabricating execution records. Trace `attributes.scheduling` metadata is also visible in the invocation details. Sources: `tools/tooling/reports.py` and `tools/tooling/viewer.html`.

## See also

- [Global testing audit](global-testing-audit.md)
- [Security and trust model](../concepts/security-model.md)
