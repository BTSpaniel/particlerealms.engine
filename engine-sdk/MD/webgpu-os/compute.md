---
title: OS Compute Service
description: Guarded compute jobs and inspection, application ownership, Paint and Files analysis, Office checksums, and system diagnostics.
updated: 2026-09-08
---

<!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha -->

# OS Compute Service

OS applications call `syscalls.compute` to run approved engine math jobs with bounded resources. The kernel supplies app identity, operator generation, and mount lifetime. Applications do not import engine internals or load arbitrary Wasm modules through this service.

Source: `webgpu-os/kernel/ComputeService.js`, `Syscalls.js`, `RuleGraph.js`.

## Declare permission and submit work

Declare `compute.execute` in the application manifest. The namespace exposes `capabilities`, `listOperations`, `copyFrom`, `readCopy`, `releaseBuffer`, `submit`, `wait`, `cancel`, and `releaseJob`. These are asynchronous methods in both native and isolated applications.

```javascript
const compute = syscalls.compute;
let bytes, job;
try {
    bytes = await compute.copyFrom(new TextEncoder().encode('Particle Realms'));
    job = await compute.submit('math.binary.crc32@1', {
        inputs: { bytes },
        policy: { backend: 'auto', outputLocation: 'cpu' },
    });
    const result = await compute.wait(job);
    console.log('CRC32:', result.value, 'backend:', result.backend);
} finally {
    if (job) await compute.releaseJob(job);
    if (bytes) await compute.releaseBuffer(bytes);
}
```

See [Managed Compute and WebAssembly](../engine/compute.md) for the versioned operation catalog, typed input names, backend policies, limits, and output lifetimes. `examples/compute/package/` contains a complete native package example: `manifest.json`, `index.js`, and `operations.js`. Import that folder with the existing AppForge/package workflow. Its application source uses only injected syscalls and relative packaged modules. The same UI runs standalone at `/examples/compute/index.html`.

### Shared SDK operation helper

Factory applications can import `hasComputeOperations` and `runComputeOperation` from `webgpu-os/factory/sdk/compute.js` or the SDK index. `hasComputeOperations(compute)` checks the injected facade's methods without probing deployment or starting a runtime. `runComputeOperation(compute, operation, { inputs, parameters, policy, signal })` accepts named typed-array inputs and returns `{ value, outputs, backend, metrics }` with independent typed arrays in `outputs`.

```javascript
import { runComputeOperation } from '/webgpu-os/factory/sdk/compute.js';

export async function checksumFile(syscalls, file, signal) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await runComputeOperation(syscalls.compute, 'math.binary.crc32@1', {
        inputs: { bytes }, signal,
    });
    return { checksum: result.value, backend: result.backend };
}
```

The helper defaults to `backend: 'auto'` and always requests CPU output. It copies inputs, submits and waits, reads output copies, then retires job and buffer handles in `finally`. An aborted signal cancels active work and raises `AbortError`. It creates no runtime and grants no permission. Applications still bound their input size and fence publication against selection, document, and mount changes.

Source: `webgpu-os/factory/sdk/compute.js` and `sdk/index.js`.

## Capabilities and authority

| Capability | Authority |
| --- | --- |
| `compute.execute` | Run approved jobs and access that mount's buffer/job tokens |
| `compute.inspect` | Read aggregate counters through `compute.stats()` and backend metadata through `compute.inspectCapabilities()` |
| `compute.manage` | Change acceleration through `compute.setAccelerationEnabled(boolean)`; reserved for trusted System Monitor |
| `gpu.compute` | Additional requirement when execution acquires the app's brokered GPU facade |

The runtime capability report distinguishes browser support, deployed artifacts, enabled acceleration, and owner limits. Browser support alone does not grant an application permission. A forced unsupported backend returns a typed error. `compute.manage` is checked by the rule graph, syscall principal restriction, and current package trust; an app cannot acquire it by choosing the System Monitor method name.

Each backend record reports `supported`, `deployed`, `enabled`, and `permitted` independently. Execution permission reflects the calling app's actual `compute.execute` decision; WebGPU also requires `gpu.compute`. GPU enablement reflects the current kernel device state. Reading this report does not acquire a GPU lease. CPU and retained-GPU limits are separate; the operational `capabilities()` report includes `budget.gpuUsedBytes` and `budget.maxGpuBytes` for that owner's retained GPU outputs.

### Inspect without execution permission

An app with `compute.inspect` can call `await syscalls.compute.inspectCapabilities()` without declaring `compute.execute`. This method reads browser support and deployment manifest metadata without creating a compute owner, worker, job, managed buffer, or GPU lease. It returns the same backend state fields as operational `capabilities()`, but omits `budget`. A diagnostic app can inspect an enabled backend without requesting execution authority.

The report's `access` record describes execution, GPU, inspection, and administration decisions with `declared`, `granted`, `state`, and `reason` fields. An undeclared execution capability appears as **Not requested**, with a neutral **Monitoring access** explanation. A requested or explicitly revoked capability that is denied still appears as **Not permitted**. These labels explain existing authority; they do not grant permissions. Unknown metadata stays unknown.

The `operations` array contains the runtime's approved operation descriptors, including each operation's actual backends and precision contracts. The shared dashboard displays one searchable catalog with backend filters. **Browse operations** on a backend card selects its coverage; expand an operation to inspect its reported contract. SIMD, threading, and WebGPU coverage can differ from scalar coverage; a ready backend does not imply that it implements every operation.

Inspection requires a live mount and active operator. The service captures the exact mount and operator generation, applies a five-second deadline, and rechecks lifecycle and `compute.inspect` permission before publication. Mount closure, operator freeze, or timeout aborts the pending wait. The timeout returns `COMPUTE_TIMEOUT`. The provider's default four-second manifest deadline may resolve first as a report with `deploymentError: 'COMPUTE_TIMEOUT'`, preserving known browser support. The syscall takes no caller-selected owner or `AbortSignal`; the kernel owns cancellation. The underlying engine method is `runtime.inspectCapabilities({ signal })`.

Inspection may fetch the manifest, but does not download or instantiate compute kernels. Browser feature probes execute small local probe modules. A manifest error is reported separately as `deploymentError`; metadata inspection does not certify that every artifact will load or that every operation supports every backend. Execution still verifies its artifact and operation contract.

Source: `ComputeService.js::inspectCapabilities`, `_reportForApp`, `Syscalls.js` guarded compute namespace, and `engine/core/compute/ComputeRuntime.js::inspectCapabilities`.

Every operational call resolves an owner whose ID is generated by the kernel. Tokens are bound to this owner, not a caller-supplied app ID. The service checks the exact process-table entry and operator generation before and after asynchronous work. Closing a mount aborts its jobs; a late result cannot publish into a relaunched instance with the same app ID. Operator freeze revokes all owners before drain/bind/resume. Kernel shutdown awaits compute disposal.

Revoking `compute.execute` immediately retires the affected execution owners, cancels their jobs, and prevents pending reads or waits from publishing results. Revoking `gpu.compute` retires owners that requested a GPU lease. Permission decisions are rechecked after asynchronous work; audit mode does not preserve revoked compute authority. A later permission grant can create a fresh owner through the same facade only while its captured mount and operator remain current. Old tokens remain invalid. Terminal cancellation/release remains callable for cleanup; already-retired owners return without recreating authority.

Ownerless capability inspection admits at most four simultaneous requests per mount and 32 globally. Excess requests return `COMPUTE_QUOTA_DENIED`. Permission revocation, mount closure, and operator transitions abort pending inspection waits and release their admission slots.

Source: `ComputeService.js`, `Desktop.js` mount AbortSignal and close paths, `OperatorContext.js`, `Permissions.js`, and `CapabilityMap.js`.

## Isolated package transport

Installed isolated native packages use the existing opaque-origin `PackageHostRealm` and nonce-bound RPC bridge. Compute messages preserve ArrayBuffers, typed-array kinds, view offsets, NaN/Infinity numeric results, and structured error `name`, `code`, and `message` fields. Each binary/control message is bounded to 64 MiB, 100,000 visited nodes, and 32 nesting levels. Cycles, accessors, shared memory, and browser host objects are rejected.

Each package realm admits eight concurrent operational compute RPC calls and two reserved cancellation/release calls. Admission and available capability guards run before the host creates an additional binary copy. Saturated requests fail with `COMPUTE_QUOTA_DENIED`, and settlement releases the slot. Browser message delivery itself still performs structured cloning; these host limits do not control the browser's internal message queue.

`readCopy` returns an independent typed array, and `copyFrom` copies the app's input. These boundaries make ownership clear but still incur copying cost. The service does not expose raw GPU buffers, Wasm instances, or linear-memory objects across package RPC. An app can store its data as managed buffers and chain jobs using tokens to avoid repeated app/host transfers.

Source: `webgpu-os/shell/ComputeRpc.js` and `PackageHostRealm.js`.

### Versioned compute schemas

Kernel schema initialization explicitly registers the engine's immutable compute definitions under `os.compute.{name}` version `1` and their canonical schema IDs. Both aliases reference the same object. Repeated registration is idempotent; conflicting definitions are rejected before any alias is installed. No network schema lookup or executable schema code is allowed. The existing OS validator import remains compatible with its legacy DSL while sharing the repaired validation implementation.

The service validates capability and statistics reports before returning them, and validates protected preferences on load and before authorized writes. RPC request metadata is checked after nonce, admission and permission checks, before invoking compute. Method-specific arity and control shapes are validated without converting native binary data to JSON. Responses use a small `rpc-response#/$defs/envelope` receipt after the existing bounded native-wire validator accepts the complete value. Large valid replies therefore do not incur a second recursive metadata copy.

These structural checks supplement exact mount/operator ownership, revocation, pending-call quotas, memory accounting and native binary validation. Schema validity cannot authorize a syscall or make a stale handle usable. The nine operational methods, nonce-bound wire fields and three-field preference storage format remain compatible. See [Shared JSON contracts](../engine/compute.md#shared-json-contracts) for canonical files, projection semantics, versions and build commands.

Sources: `webgpu-os/kernel/schema/ComputeSchemas.js`, `OsSchemas.js`, `ComputeService.js`, `ComputePreferences.js`, and `webgpu-os/shell/ComputeRpc.js`.

## Paint: Analyze Image

In Paint Studio, choose **Effects → Analyze Image**. Paint reuses its raster export composite, including current GPU raster data and enabled layer effects. The report shows red, green, blue, alpha, and luminance histograms and mean channel intensities. Analysis does not alter the document or add an undo entry.

Results belong to the captured document, mount, autosave revision, and GPU scene revision. Paint discards results when those change and retires the input, output, and job handles. The report opens inside Paint's own application window; it does not make other OS apps inert.

Source: `webgpu-os/factory/apps/paint/app/imageAnalysis.js`, `app/PaintApp.js`, and `io/io.js`.

## Files: Analyze File

Select a non-trashed file in Files and choose **Analyze File** in its details. The explicit action reads the selected file's bytes and reports CRC-32, a 256-bin byte histogram, entropy in bits per byte, distinct bytes, the most frequent byte, and the backends used. Selecting a file alone does not start compute analysis. Existing file previews retain their own behavior.

Analysis accepts files up to 32 MiB and checks the limit before the read when size metadata is available, then again against the returned Blob. **Cancel**, selection changes, relevant storage events, and unmount cancel the current analysis. Results are fenced against mount, selection, preview generation, and entry revision; storage revisions are compared before and after work when `storage.stat` is available. Detected changes prevent publication of the captured report.

Files declares `compute.execute` and uses the shared SDK helper for CRC-32, histogram, and entropy jobs. The action is disabled when the facade is absent. Permission, memory-budget, read, and execution failures appear in the analysis panel with available error codes. Every job and input/output handle is retired. Analysis does not modify the file.

Source: `webgpu-os/factory/apps/files/fileAnalysis.js`, `FilesApp.js`, and `webgpu-os/apps/files/factory.js`.

## Notepad: Office archive verification

Notepad passes its injected compute facade and current open-operation signal through the existing asynchronous DOCX/ODT import path. Relevant expanded ZIP entries of at least 256 KiB use `math.binary.crc32@1` before XML parsing. Smaller entries and imports without a complete compute facade retain the existing JavaScript CRC table. RTF and text import paths retain their existing behavior.

CRC values must exactly match the archive's expected checksum. A mismatch still returns the existing `DOCUMENT_IMPORT_PARSE_FAILED` integrity error. If an available facade rejects permission, memory admission, or execution, import reports failure; it does not silently accept unchecked content or retry through the synchronous path. Cancellation remains `AbortError`. Starting another document operation or closing Notepad cancels verification and prevents a late document insertion. Existing archive expansion, size, XML, and sanitization limits still apply.

Source: `webgpu-os/factory/apps/notepad/office-documents.js::parseOfficeArchive`, `NotepadApp.js::_openNote`, `_importDocumentFile`, and `webgpu-os/apps/notepad/factory.js`.

## System Monitor: Compute

System Monitor's **Compute** tab groups current jobs, workers, held memory, and completion totals into summary cards. Scheduler and memory panels show concurrency, queued owners, queue age, retained job handles, per-client limits, CPU and retained-GPU budgets, and peak CPU allocation. Worker heaps are already included in the CPU total and are not added twice. These are managed resource counters, not measured physical process RSS or physical VRAM usage. Rendering, physics, and dedicated app workers report through their own systems.

The overview distinguishes idle service, active work and unavailable telemetry. Memory budget bars use binary units: 536,870,912 bytes is **512 MiB**. Additional allocation details stay in a disclosure, while recent activity appears before the backend catalog. Missing measurements remain unknown. A failed statistics read is visible rather than appearing as an idle service with zero usage.

**Recent activity** retains at most 24 finished jobs. Expand a job to inspect its requested and selected backend, precision, queue and execution wall time, input/output sizes, worker count, and error code. The runtime keeps no input contents, owner IDs, or reusable handles in this history. Operator freeze clears the history and latest diagnostics; runtime cumulative counters remain. Opening the monitor creates no test workload. An empty history and zero workers are normal before an application submits work.

`compute.stats()` also reports `limits` and `pressure`, including CPU/GPU usage ratios, the highest owner queue/retention ratio, owners waiting, settled retained jobs, and the oldest queued job age. Queue admission counts unsettled jobs; retention admission counts every unreleased job handle. These limits are distinct from the displayed number of settled retained jobs.

Source: `webgpu-os/factory/apps/sysmon/computeView.js`, `SysMonApp.js`, `telemetry.js`, and `engine/core/compute/ComputeRuntime.js::getStats`.

### Operator acceleration preference

**Allow acceleration** saves the current operator's preference through the guarded `compute.setAccelerationEnabled(boolean)` syscall. Disabling it makes automatic jobs use JavaScript; forced accelerated requests fail explicitly. Existing work may finish normally. The toggle does not change an operation's requested precision.

The kernel stores a versioned preference in an account-bound encrypted sandbox with the reserved identifier `kernel:compute-preferences`. Ordinary packages cannot register that identifier. The preference defaults to enabled for a new operator and is restored during operator bind before compute resumes. It is not stored in app-controlled local storage or exposed as a Files entry.

The save is serialized and uses a strict version check. It rechecks the exact mount, operator generation, permission, and trusted System Monitor principal before applying the committed value. Failed saves leave the running setting unchanged and display an error. Capability reports include a cached `preference` record with its scope, state, persistence status, effective value, and error code; routine inspection does not reread storage. The UI disables administration until the host reports an actual administration grant, and while storage is known to be unavailable. A failed save permits a retry when storage recovers.

Persistence belongs to this browser's origin and operator account; it is not a portable backup. A corrupt or unsupported record is preserved and reported as an error, with the enabled default used on load. Subsequent saves reject the corrupt record instead of silently replacing it. Storage failures and strict-version conflicts remain visible and retryable when the underlying condition is resolved.

Source: `webgpu-os/kernel/ComputePreferences.js`, `ComputeService.js`, `Permissions.js::describeCapability`, and `Syscalls.js`.

### GPU Manager and Control Panel

GPU Manager's **Capabilities** tab leads with the same compact backend grid and searchable operation catalog, followed by adapter features and device limits. Control Panel's operations dashboard shows current compute counters, a compact readiness summary, and an **Open System Monitor** action. These views declare `compute.inspect`; they do not need `compute.execute` to display metadata.

GPU Manager and System Monitor also display GPU device status separately from browser WebGPU support. A supported browser can still have an unacquired, initializing, lost, recovering, or degraded device; an active device requires actual device admission. Missing support metadata remains unknown.

All three views reuse `computeStatus`, `updateComputeStatus`, and `createComputeStatusReader` from the shared SDK UI. The reader coalesces pending requests, limits ordinary metadata refreshes to one per 15 seconds, and suppresses late view updates after disposal. Explicit **Refresh** in System Monitor and GPU Manager bypasses this interval; **Resume live refresh** in Control Panel requests current metadata immediately. If a refresh fails, it retains the previous report with an explicit stale-report warning and its last successful timestamp. Search text, backend filters, expanded details, keyboard focus, and scroll position survive refreshes, including inside ShadowRoots.

The active view requests refreshes; opening an unrelated tab does not start compute work. System Monitor can force a metadata refresh after changing acceleration. Status text distinguishes unsupported browser features, missing deployment, paused acceleration, unavailable devices, unrequested or denied permission, unknown state, and inspection errors. Cards reflow from three columns to two and one as their container narrows, using the shared theme and accessibility settings.

Source: `webgpu-os/factory/sdk/ui/computeStatus.js`, `factory/apps/gpu-manager/GpuManagerApp.js`, `factory/apps/control-panel/ControlPanelApp.js`, and `liveOpsView.js`.

## Validation and troubleshooting

Run `python tests/compute/run_compute_operations.py --page tests/kernel/compute-service.html`. The browser suite covers undeclared and revoked capabilities, foreign handles, mount replacement, operator transitions, binary/error RPC in an actual opaque iframe, real JavaScript/Wasm jobs, Paint report rendering and stale-result cleanup, and actual GPU execution through the application broker with frame pacing.

`python tests/compute/run_compute_operations.py --page tests/kernel/compute-preferences.html` exercises encrypted IndexedDB persistence, account separation, reserved-namespace rejection, failed and stale writes, corruption preservation, and disposal during bind. The `tests/compute/compute-dashboard.html` and `tests/compute/compute-diagnostics.html` pages cover shared status rendering, refresh recovery, real job telemetry in apps, permission labels, and focus/scroll preservation.

`python tests/compute/run_compute_operations.py --page tests/compute/paint-compute.html` exercises the complete Paint app's menu action and real GPU image snapshot. `python tests/compute/run_compute_operations.py --page tests/compute/compute-app-adoption.html` checks Files analysis and revision/cancellation handling, Office CRC parity and corruption rejection, and closed-app cleanup with real worker jobs. `python tests/compute/run_compute_release_router.py` stages the canonical compute sidecars into verified OPFS/install-registry records and executes the cross-domain example fixtures and four Wasm variants through the actual OS release router with browser networking disabled. This focused delivery gate does not perform a signed full-system installation or boot.

For missing Wasm artifacts, verify `python -m bundler.wasm --check` and the manifest/worker paths in the release. For unavailable thread variants, inspect actual `crossOriginIsolated` and capability-probe results in the deployed context. For queue or memory errors, release completed jobs and buffers before retrying. GPU generation loss requires new output handles; existing retained GPU data cannot survive a replaced device.

Installed release routing rehashes executable and manifest File snapshots before serving them, including conditional, HEAD and byte-range requests. Same-size corruption fails closed before background reconciliation runs. Compute worker routes also enforce their own CSP. This protects delivery through the installed router; it does not replace signed installation or establish that a production host has deployed the new source configuration. Sources: `platform/runtime-host/ReleaseResourceRouter.js`, `_headers`, and `tests/system-release-reconciliation.test.js`.

## See also

- [Managed Compute and WebAssembly](../engine/compute.md)
- [Shared App UI](app-ui.md)
- [OS Architecture](architecture.md)
- [Security and Trust Model](../concepts/security-model.md)
