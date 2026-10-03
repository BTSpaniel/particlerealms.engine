---
title: Managed Compute and WebAssembly
description: Owned asynchronous compute jobs, approved math operations, WebAssembly variants, memory limits, and reproducible builds.
updated: 2026-09-08
---

<!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha -->

# Managed Compute and WebAssembly

The engine compute runtime runs approved math operations in JavaScript workers, WebAssembly workers, or an injected WebGPU device lease. Engine hosts create a runtime and owner context; OS applications receive the same operational methods through guarded syscalls. Existing synchronous math exports remain available.

Source: `engine/core/compute/ComputeRuntime.js`, `ComputeOperations.js`, `WasmComputeProvider.js`, and `WebGpuComputeProvider.js`.

## Start a runtime

Serve the repository with `python start_server.py`. Open `/examples/compute/index.html` for an interactive example covering the first-release numeric, geometry, image, signal, audio, binary, and entropy operations. The example's reusable dataset and lifecycle helper live in `examples/compute/package/operations.js`. Query `listOperations()` for the current catalog, including later additions.

```javascript
import { createComputeRuntime } from '/engine/EngineBootstrap.js';

const runtime = createComputeRuntime();
const compute = runtime.createContext('my-engine-analysis');
let input, job;
try {
    input = await compute.copyFrom(new Float64Array([2, 4, 8]));
    job = await compute.submit('math.stats.summary@1', {
        inputs: { values: input },
        policy: { backend: 'auto', outputLocation: 'cpu' },
    });
    const result = await compute.wait(job);
    console.log(result.value.mean, result.backend, result.metrics);
} finally {
    if (job) await compute.releaseJob(job);
    if (input) await compute.releaseBuffer(input);
    await runtime.dispose();
}
```

`createContext(ownerId)` is a trusted host operation. Each live owner ID must be unique within its runtime. Importing the module starts no workers. Owner contexts expose async `capabilities`, `listOperations`, `copyFrom`, `readCopy`, `releaseBuffer`, `submit`, `wait`, `cancel`, and `releaseJob`. Applications must not receive the runtime object.

### Inspect without an owner

Trusted hosts can call `await runtime.inspectCapabilities({ signal })` before creating an owner context. The optional `signal` is an `AbortSignal`. Inspection runs the browser capability probes and reads the cached or fetched deployment manifest. It does not load compute kernel artifacts, start workers, reserve worker heaps, acquire a GPU lease, or create a compute owner. Small probe modules still execute to verify browser features.

The report includes `supported`, `deployed`, `enabled`, `permitted`, `backends`, `deploymentError`, and `operations`. Each operation is an independent copy of the approved descriptor's `id`, `name`, `domain`, `moduleId`, `inputs`, `precisions`, `defaultPrecision`, `backends`, `wasmVariants`, `gpuPrecisions`, `result`, and `comparison`. Diagnostic hosts can discover operation-specific backend and precision support without creating an execution owner. Registry changes appear in this list; browser support for a Wasm variant does not imply that every operation implements it.

Inspection has no `budget` field because no owner was selected. Use an owner's `capabilities()` when its CPU/GPU budgets are needed; that method delegates to the same inspection and adds the owner's limits and usage. Manifest failures appear as `deploymentError`; cancellation and runtime closure reject the inspection. Manifest loading has a provider-owned deadline, while the optional caller signal can stop that caller's wait earlier. Cancelling one caller does not cancel another caller sharing the metadata fetch. The OS adds its own bounded inspection lifecycle.

Source: `engine/core/compute/ComputeRuntime.js::inspectCapabilities`, `_capabilities`, `WasmCapabilities.js`, and `WasmComputeProvider.js::manifest`.

## Operation catalog

Every identifier includes `@1`. Inputs are owner-scoped buffer tokens created with `copyFrom`; the table names the typed arrays stored behind those tokens. Numeric inputs accept `Float32Array` or `Float64Array`; image and binary inputs accept `Uint8Array` or `Uint8ClampedArray`.

| Operation | Named inputs | Parameters | Result |
| --- | --- | --- | --- |
| `math.stats.summary@1` | `values` | None | Count, sum, mean, sample/population variance, minimum, maximum in `value` |
| `math.robust.compensated-sum@1` | `values` | None | Compensated sum report in `value` |
| `math.geometry.attribute-bounds@1` | `positions` | `componentCount`, default 3 | Attribute bounds report in `value` |
| `math.geometry.transform-points@1` | `positions`, `matrix` | None | `outputs.positions`; column-major 4×4 matrix and packed xyz input |
| `math.image.histogram@1` | `image` | `width`, `height`; optional `includeAlpha`, `includeLuminance`, `coefficients` | `outputs.r`, `g`, `b`, and enabled `a`/`luminance` histograms |
| `math.image.luminance@1` | `image` | `width`, `height`; optional `normalized`, `coefficients` | `outputs.luminance`, Float32 values |
| `math.image.document-analysis@1` | `image` | `width`, `height`; bounded segmentation options; `recognitionProfile`, default `printed` | Original-coordinate lines, glyphs, issues and transforms in `value`; grayscale, mask and 580-value glyph features in `outputs`; JavaScript worker |
| `math.matrix.multiply@1` | Float32 `a`, `b` | `rows`, `inner`, `columns` | Row-major Float32 `outputs.matrix`; JavaScript and scoped WebGPU |
| `math.signal.fft@1` | `real`; optional `imag` | None | `outputs.real`, `imag`; length zero or a power of two |
| `math.signal.ifft@1` | `real`, `imag` | None | `outputs.real`, `imag`; equal power-of-two lengths |
| `math.audio.waveform-peaks@1` | `samples` | `bucketCount` | Peak report in `value` |
| `math.audio.windowed-rms@1` | `samples` | `windowSize`, optional `hopSize` | Windowed RMS report in `value` |
| `math.binary.crc32@1` | `bytes` | Optional `previousCrc`, default 0 | CRC32 number in `value` |
| `math.binary.histogram@1` | `bytes` | None | `outputs.histogram`, 256 Uint32 counts |
| `math.compression.entropy@1` | `bytes` | Optional `symbolBits`, default 8 | Entropy estimate report in `value`; does not compress data |

`listOperations({ domain, moduleId })` returns operation descriptors with required inputs, default precision, supported precisions, Wasm variants, and the existing CPU exports defining the contract. Image dimensions must exactly match four RGBA bytes per pixel. Luminance uses encoded channel values; version one does not implement alpha weighting or linear-light conversion. Numeric reports preserve the existing math functions' NaN/Infinity behavior.

Each descriptor includes `result.value` report fields, `result.outputs` buffer element types and shape formulas, and `result.semantics`. `comparison.cpu` declares exact comparison with NaN and signed-zero rules, or the FFT absolute/relative tolerance. Eligible GPU operations also declare `comparison.webgpu`: absolute tolerance 0.0001 plus relative tolerance 0.00002 for finite, well-conditioned float32 inputs.

### Document analysis profiles

`math.image.document-analysis@1` accepts `recognitionProfile: 'printed' | 'handprint'`; omitted values retain printed behavior. The normalized parameter and canonical schema preserve this selection across workers and job identity. Both profiles use `DocumentImageMath.js`, the same original-coordinate transforms, and the existing pixel, glyph and memory limits. The parameter selects segmentation and feature geometry; it does not load a recognizer or authorize another model.

The handprint profile admits bounded, character-shaped isolated crops that occupy more of a small image than ordinary printed-page components. Solid artwork and horizontal ruling remain excluded. Features use the glyph's own height and baseline, matching Engine's genuine handprint dataset preparation. Geometrically supported, mutually matched disconnected strokes may form one candidate; component IDs and `handprint-overlapping-strokes` evidence survive, and `handprint-stroke-group` requires review. These are candidate groupings, not certified character identities.

Handprint word spacing can use separated groups of character advances or strongly consistent advances within a single word. Larger advance groups require corroborating ink gaps. The method appears in each line's `spacing` record. No vocabulary, expected transcription or numerical substitution determines spaces. Line geometry and source pixels remain intact. Factory separately selects its printed or handprint AGI model and retains profile-specific correction storage; see [the shared scanner](../webgpu-os/sewing-studio.md#project-owned-image-scanning).

Sources: `engine/core/math/DocumentImageMath.js`, `engine/core/text/HandprintDataset.js`, `ComputeOperations.js` and `schemas/operation-parameters.v1.schema.json`.

## Shared JSON contracts

Sixteen canonical Draft 2020-12 documents live in `engine/core/compute/schemas/`. The family covers artifact manifests, handles, buffer descriptors, policies, operation discovery and parameters, normalized job requests, results, native-value projections, worker messages, package RPC requests/replies, capabilities, statistics, and protected preferences. Their IDs follow `https://particlerealms.online/schemas/compute/{name}.v1.schema.json`. IDs identify bundled documents; validation never fetches those URLs.

`ComputeContractSchemas.generated.js` is generated from those files for browser and worker imports. Python validates the same documents with `jsonschema`, using a closed local reference registry. `getComputeContract(name)` and `validateComputeContract(name, value)` are exported by the engine entry point. Names can be short names such as `handle`, canonical IDs, or supported JSON Pointer fragments. Schemas are immutable; validation returns `{ valid, errors }` without coercing the input. Neither helper creates a compute owner or grants authority.

Python's `multipleOf` checker uses exact decimal coefficient/exponent arithmetic to match the browser profile; it avoids binary-floating division rejecting `0.3` as a multiple of `0.1`. Other assertions use the independent Draft validator. The current compute contracts do not need `multipleOf`, but profile regressions cover its semantics.

Operation discovery adds `parameterSchema`, `requestSchema`, and `resultSchema`. Parameter schemas describe **effective controls** after the existing operation's defaults and coercions. The normalized job-request schema includes the separate operation argument and all resolved policy fields. Raw package RPC arguments have their own schema because they still permit omitted options, typed shape arrays, and null defaults. Existing bounded, ignored extension controls stay compatible; they do not become new operation features.

The engine's shared `JsonSchemaValidator` implements a tested Draft 2020-12 subset. Its supported keyword profile is authored in `engine/core/schema/json-schema-profile.json` and used by both validators' build gate. Unsupported assertion keywords fail the build. Local `$defs` and JSON Pointers, host-resolved references, composition and conditionals, own-property checks, type unions, bounds, enum/const and uniqueness are supported. `format` is an annotation in strict mode. Validation has explicit traversal, byte and evaluation limits. Compiled canonical validators capture their reference closure once; ordinary OS registry validation remains dynamic for legacy schema evolution.

JSON contracts validate metadata, not sample arrays or live memory. `projectComputeContractValue` produces a bounded validation-only projection: native arrays become intrinsic dtype/length/byte-count records; nonfinite numbers and signed zero use explicit markers. The original typed arrays, NaN, Infinity and negative zero stay native during execution and RPC. Forging a marker does not create a native buffer. Accessors, cycles and unsupported host values are rejected before projection.

Large native audio and document reports use `job-result#/$defs/envelope` during publication, after native output checks and existing memory admission. This avoids a second copy and an unrelated metadata-size limit. The full `job-result` schema remains available for explicit projected-report validation. Output names, element types and fixed declared dimensions are checked before publication; shape expressions in discovery remain descriptive text. Numerical parity, dimension products, alignment, pointer ranges, actual binary hashes/imports, owner generations, permissions and quotas remain separate runtime checks. Schemas do not authenticate executable artifacts.

Schema version 1, operation `@1`, Wasm ABI 1 and the protected preference's storage version are independent compatibility boundaries. This change preserves the nine operational methods and existing stored preference bytes. It adds no automatic ECS, quaternion, voxel or AI tensor kernels; those workflows must select an operation actually listed by the service.

Sources: `ComputeContracts.js`, `ComputeOperations.js`, `ComputeRuntime.js`, `engine/core/schema/JsonSchemaValidator.js`, and `bundler/compute_contracts.py`.

## Jobs, copies, and ownership

`copyFrom(typedArray)` copies caller data into runtime ownership and returns `{ id, generation }`. It does not detach the caller's array. `readCopy(bufferToken)` returns a new independent typed array. Neither function exposes WebAssembly linear memory. Tokens from other owners or previous generations are rejected.

`submit(operation, { inputs, parameters, policy })` returns a job token. `wait(job)` returns `{ outputs, value, backend, metrics }`; each `outputs` entry is another buffer token. Read or chain output buffers before releasing their job. `releaseJob(job)` cancels pending work, waits for settlement, and releases the job's outputs and report metadata. `releaseBuffer(buffer)` releases an individual buffer; job-held input references remain alive until execution settles.

`cancel(job)` requests cancellation. CPU worker groups are terminated when needed to stop synchronous kernels. Cancellation cannot undo GPU commands already submitted, but prevents publication of cancelled results. `runtime.releaseOwner(ownerId)` revokes authority synchronously and returns a drain promise. `runtime.dispose()` revokes all owners and drains the runtime. After owner teardown, calls through its old context reject; host cleanup already owns resource retirement.

Source: `ComputeRuntime.js` owner, buffer, job, and cancellation methods; `WasmComputeProvider.js` worker-group teardown.

### Runtime diagnostics

Trusted hosts read `runtime.getStats()` for aggregate resource counters and bounded activity. The original counters remain: owners, buffers, retained job handles, queued/running jobs, worker count, CPU bytes, worker-heap reservations, retained GPU bytes, cumulative completed/failed/cancelled totals, backend counts, peak CPU allocation, and latest backend/error. Reading stats does not create an owner or start work. These counters describe managed resources, not physical process RSS or driver memory.

The additive `limits` object exposes the actual configured denominators:

| Field | Meaning |
| --- | --- |
| `cpuBytes`, `gpuBytes` | Global managed CPU and retained-GPU byte limits |
| `ownerCpuBytes`, `ownerGpuBytes` | Corresponding per-owner byte limits |
| `queuedJobsPerOwner` | Per-owner unsettled job limit, including a running job |
| `retainedJobsPerOwner` | Per-owner retained job-handle limit, including pending and completed jobs |
| `buffers`, `ownerBuffers` | Global and per-owner retained buffer-handle limits, including empty buffers and released inputs still held by jobs |
| `workers` | Configured worker ceiling after the hardware-concurrency bound |
| `concurrentJobs` | One active job at a time; a threaded job can use multiple workers |
| `defaultTimeoutMs` | Default submitted-job deadline |

`pressure.cpuRatio` and `gpuRatio` divide current usage by the corresponding global limit. `ownerQueuePeakRatio` reports the highest unsettled-job fraction among owners. `ownerRetainedPeakRatio` reports the highest retained-handle fraction, including pending handles. These aggregate peaks reveal no owner IDs. `queuedOwners`, `retainedJobs`, and `oldestQueuedMs` report the number of owners waiting, the number of settled jobs still retained, and the oldest queued wait; an empty queue has zero wait age.

`recentJobs` contains at most 24 entries, newest first. Each entry has `operation`, `requestedBackend`, `backend`, `precision`, `status`, `queueMs`, `runMs`, `totalMs`, `inputBytes`, `outputBytes`, `workers`, `finishedAt`, and `errorCode`. Successful entries record the backend whose result was published. Failed entries record the last selected backend when routing reached one; this does not assert that a kernel executed. `runMs` includes preparation, transport, calibration, and execution, rather than measuring only kernel time. `finishedAt` is Unix epoch time in milliseconds. Byte fields describe input/output buffers, excluding report metadata.

Unavailable measurements are `null`. For example, a cancelled queued job has no running duration, selected backend, output size, or worker count. A preparation failure has no successful output or worker measurement. Activity contains no owner IDs, buffer/job tokens, or input/output values, and every returned snapshot is independently copied.

`runtime.clearDiagnostics()` clears recent activity, `lastError`, and `lastBackend`, while preserving cumulative counters and live resources. A diagnostic epoch prevents older draining jobs from repopulating those cleared fields. The OS uses this trusted host method at operator transitions; it is not added to the nine operational owner-context methods.

Source: `engine/core/compute/ComputeRuntime.js::getStats`, `_recordJobDiagnostics`, `_settle`, and `clearDiagnostics`.

### Error categories

Errors carry a stable `code` and a human-readable `message`. The package RPC boundary preserves these fields. A failed job must still be released, or its owner disposed.

| Category | Representative codes | Meaning |
|---|---|---|
| Contract | `COMPUTE_INVALID_INPUT`, `COMPUTE_INVALID_POLICY`, `COMPUTE_UNKNOWN_OPERATION`, `COMPUTE_PRECISION_UNSUPPORTED` | Correct the request or select an eligible backend; results were not published. |
| Authority | `COMPUTE_INVALID_HANDLE`, `COMPUTE_OWNER_REVOKED`, `COMPUTE_GPU_INVALIDATED` | Ownership, lifetime, or GPU generation no longer permits access. |
| Admission | `COMPUTE_MEMORY_LIMIT`, `COMPUTE_QUEUE_FULL`, `COMPUTE_GPU_LIMIT` | Release resources, reduce the workload, or change host limits. |
| Availability | `COMPUTE_BACKEND_DISABLED`, `COMPUTE_BACKEND_UNAVAILABLE`, `COMPUTE_ARTIFACT_MISSING`, `COMPUTE_ARTIFACT_INVALID`, `COMPUTE_ABI_MISMATCH` | A requested implementation or its verified deployment is unavailable. |
| Execution | `COMPUTE_CANCELLED`, `COMPUTE_TIMEOUT`, `COMPUTE_WORKER_FAILED`, `COMPUTE_KERNEL_FAILED`, `COMPUTE_GPU_VALIDATION_FAILED` | Execution ended without publishing output; worker recovery permits later independent jobs. |

Source: `ComputeErrors.js`, `ComputeRuntime.js`, both providers, and `webgpu-os/shell/ComputeRpc.js`.

## Backend selection and precision

The `policy.backend` values are `auto`, `js`, `wasm-scalar`, `wasm-simd`, `wasm-threads`, `wasm-threads-simd`, and `webgpu`. Forced unsupported variants fail explicitly. Consult the operation descriptor's `wasmVariants`; not every operation has SIMD or a parallel implementation.

Both `inspectCapabilities().backends` and the owner's `capabilities().backends` contain a record for each explicit backend with separate `supported`, `deployed`, `enabled`, and `permitted` booleans. The existing aggregate fields remain available. The deployment field describes available manifest metadata and configured providers; artifact hashes and ABI are checked when an implementation loads. Browser support and deployment metadata do not grant OS permissions: the OS adds execution permission and GPU device availability for the exact calling application without acquiring a device lease.

For CPU-resident inputs and CPU output, `auto` first runs JavaScript. Inputs below 65,536 bytes stay on JavaScript. The first larger request in an operation/precision/input-size band measures eligible accelerated alternatives, including preparation and transport. This includes one eligible Wasm variant and, when a host configures GPU authority, supported `f32` point transforms or luminance on WebGPU. Later requests use an alternative only when its measured duration beat JavaScript by at least 10%. This is an observed calibration, not a guaranteed speedup. Missing or failing optional acceleration permits automatic JavaScript fallback. Forced backends retain explicit errors.

WebGPU implements point transforms, luminance and matrix multiplication, requires `precision: 'f32'`, and needs a trusted host lease. Choose `backend: 'webgpu'` explicitly for GPU work, or request `outputLocation: 'gpu'` with `auto`. Automatic point transforms can reuse eligible GPU-resident `f32` input handles directly without a CPU readback. Other operations retain their advertised `f64` or exact-integer contracts. Document segmentation is a JavaScript worker operation. Neither new operation has a WebAssembly implementation. Existing math tests define numerical tolerance and reduction behavior.

GPU luminance rejects coefficients whose float32 representation or maximum weighted byte sum would overflow, with `COMPUTE_PRECISION_UNSUPPORTED`. JavaScript and Wasm retain the wider reference arithmetic for those inputs; automatic selection can fall back to them.

The point-transform and luminance GPU kernels check conservative arithmetic error bounds before publishing outputs. Ill-conditioned cancellation, uncertain projective divide thresholds, or nonfinite arithmetic fail with `COMPUTE_PRECISION_UNSUPPORTED`. Each nonempty dispatch reads a four-byte validation status, reported as `metrics.gpuValidationReadbackBytes`; retained position data stays on the GPU.

Source: `ComputeRuntime.js::_runTask`, `ComputeOperations.js::COMPUTE_OPERATIONS`.

## WebAssembly variants and limits

Four first-party artifacts share ABI version 1: scalar, SIMD, threads, and threads+SIMD. Scalar/SIMD workers own private memories. Thread variants share one memory across a bounded worker group with disjoint stack and arena regions. Threaded kernels partition supported work and merge results; applications never receive the shared memory. SIMD operation support is declared separately from whether an artifact was compiled with SIMD enabled.

Thread variants require actual shared-memory support and cross-origin isolation. The development server already supplies COOP/COEP and `application/wasm`. Production headers and sidecar availability must also be verified. Scalar/JavaScript operation remains usable without shared-memory support.

Default CPU limits are 256 MiB per owner (`maxOwnerBytes`) and 512 MiB globally (`maxBytes`). Retained GPU outputs have separate 256 MiB owner (`maxOwnerGpuBytes`) and 512 MiB global (`maxGpuBytes`) limits. The owner capability report exposes `budget.usedBytes`, `maxBytes`, `gpuUsedBytes`, and `maxGpuBytes`. A job that exceeds GPU retention limits releases its new allocations before returning an error; earlier handles remain valid. Transient GPU resources remain subject to the host device broker's allocation limits.

Other defaults are 64 unsettled jobs per owner, 256 retained jobs per owner, and at most four workers, further bounded by available hardware concurrency. Buffer handles are separately limited to 1,024 per owner (`maxBuffersPerOwner`) and 4,096 globally (`maxBuffers`), including zero-byte buffers and released buffers still referenced by jobs. Owner capability reports include `budget.buffers` and `budget.maxBuffers`. The default deadline is 30 seconds; explicit job deadlines must be positive and no more than 300,000 milliseconds.

Policy and parameter controls have a combined 1 MiB bound, checked before cloning, with a maximum depth of 32 and 100,000 visited nodes. Policies accept only `backend`, `outputLocation`, `precision`, `timeoutMs`, and `priority`. Priority is `background` by default or `interactive`; applications cannot request the host's `render-critical` class. Controls must contain data-only plain objects, arrays, supported typed arrays, or ArrayBuffers. Accessors, cycles, shared control memory, Maps, Sets, and browser host objects are rejected. Typed control views are charged for their complete backing buffer. Retained controls and a bounded job-record allowance remain charged until the job is released, including after failure or cancellation.

Input storage, temporary copies, retained controls, and worker heap reservations participate in CPU admission. Buffer copying uses intrinsic typed-array identity and sizes rather than caller-overridable properties. GPU inputs that require CPU copies reserve their transfer allowance before readback. Physical process RSS and driver memory are not these counters.

Source: `ComputeRuntime.js` constructor and `_submit`; `WasmComputeProvider.js` memory layout and worker admission.

## Build and verify

The Python build entry invokes pinned Rust/Cargo tooling only when artifacts need rebuilding. Browser users do not install Rust, Node, or npm.

```bash
python -m pip install -r bundler/requirements.txt
rustup toolchain install nightly-2026-09-07 --profile minimal --component rust-src --target wasm32-unknown-unknown
python -m bundler.compute_contracts --check
python -m bundler.wasm
python -m bundler.wasm --check
python tests/compute/run_compute_operations.py
python tests/compute/run_compute_operations.py --page tests/kernel/compute-service.html
python tests/compute/run_compute_operations.py --page tests/compute/paint-compute.html
python tests/compute/run_compute_release_router.py
python tests/compute/run_compute_contracts.py
```

After authoring schema changes, run `python -m bundler.compute_contracts` to regenerate the browser metadata and supported profile. Normal `bundle_engine.py` builds and `--dry-run` both reject stale generated contracts before the JavaScript cache; dry runs do not write or regenerate them. The build also validates the actual Wasm manifest against the canonical artifact schema. This does not change the existing Rust source fingerprint or require recompilation when only JavaScript/schema sources change. The independent Python validator is pinned in `bundler/requirements.txt`; it is build tooling, not a browser dependency.

Release compute inventories include the canonical schema documents and generated worker dependencies. `run_compute_contracts.py` compares identical valid and invalid fixtures in the actual browser and Python, covering all 16 families and operation-specific references. `tests/compute/compute-runtime-contracts.html` adds actual execution, large audio reports and native boundary regression checks.

Use `python -m bundler.wasm --force` for a full rebuild. The build verifies ABI exports, allowed imports, memory limits, feature declarations, byte counts, and SHA-256 digests. The manifest records toolchain/source provenance. Production packaging includes the `.wasm` artifacts, manifest, raw worker entry, and worker module closure; copying only the JavaScript bundle is insufficient.

At runtime, manifest reads are limited to 1 MiB of decoded body data before UTF-8 and JSON parsing. Artifact declarations must contain a positive safe-integer `byteLength` before any artifact fetch. `maxArtifactBytes` defaults to a hard ceiling of 16 MiB; a host can lower it through runtime options. This download limit is separate from the Wasm linear-memory limit. Artifact responses must contain exactly the declared decoded byte count. The reader cancels incomplete or oversized bodies and checks each streamed chunk before retaining it. Valid HTTP compression remains supported because encoded `Content-Length` is not mistaken for decoded size.

Provider-owned `manifestTimeoutMs` and `artifactTimeoutMs` default to 4,000 and 30,000 milliseconds and cover headers plus body reads. A host may configure positive integer values up to 300,000 milliseconds. Caller job deadlines remain independent. Resource timeouts return `COMPUTE_TIMEOUT`; malformed metadata, invalid byte declarations, oversized bodies, and length mismatches return `COMPUTE_ARTIFACT_INVALID`. Failed shared loads leave the cache retryable; successful manifest/module loads remain shared. Provider disposal aborts its outstanding fetches.

The runtime validates artifact filenames, hashes, features, memory bounds, imports, exports, and provenance fields before caching immutable manifest metadata. Artifact URLs must be canonical siblings of the host-selected manifest. Manifest and artifact redirects are rejected. Browser compilation validates the module; an additional ABI 1 layout check verifies function signatures, imported memory and stack/heap globals, and rejects start functions, data segments, tables and other unsupported layouts before worker instantiation. Metadata validation and SHA-256 matching do not independently authenticate the manifest: source mode relies on the host-selected origin, while installed releases use the existing verified release boundary.

Compute worker responses carry an enforcing CSP in the development server, static host metadata, and installed release router. The policy permits local module imports and Wasm while blocking worker network requests, nested workers, and JavaScript string evaluation. Workers need their own response policy, and `wasm-unsafe-eval` permits Wasm without granting JavaScript `unsafe-eval`. See [MDN worker CSP](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy) and [MDN Wasm CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src#unsafe_webassembly_execution).

Run `python tests/compute/run_compute_worker_security.py` for actual four-variant execution under that worker policy and negative network/evaluation/worker probes. `tests/compute/compute-admission.html` covers quota and control admission; `tests/compute/compute-provider-hardening.html` covers malformed metadata and ABI rejection. These pages run through `run_compute_operations.py`. The full OS shell policy remains report-only and needs its own deployment-wide enforcement gate.

`python tests/compute/run_compute_operations.py --page tests/compute/compute-telemetry.html` verifies operation discovery, resource pressure, copied/bounded history, operator diagnostic clearing, and real HTTP timeout/size/compression/retry cases. These fixtures use actual browser fetches and Wasm execution.

The release-router browser gate hashes and stages the canonical sidecar inventory into OPFS and the install registry, disables browser networking, and executes the cross-domain example fixtures and all four Wasm variants through the actual OS immutable-resource router. This checks installed resource delivery; it does not perform a signed full-OS installation or boot. Router responses include the embedder policy required by module workers in an isolated runtime.

Source: `bundler/wasm.py`, `engine/core/compute/kernels/rust-toolchain.toml`, `WasmComputeProvider.js` artifact validation.

## Host GPU integration

Pass `acquireGpu(ownerId)` to `createComputeRuntime` when a host supplies GPU authority. The resolved lease contains `device`, optional `release()`, a captured generation value or `generation()` getter, optional `frameBudgetBroker`, and `run(callback)` where required by the host. The OS supplies its exact app-scoped device facade. Synchronous allocation/write/encode/submit work runs inside the broker's finite `run` scope; asynchronous preparation and readback waits occur outside it. The shared frame-budget broker paces compute before submission. No additional device is requested by the compute provider.

GPU output handles keep data resident until an explicit `readCopy` or an implementation requires readback. Position-transform chains reuse retained position buffers directly. The current matrix implementation reads retained inputs back for validation and uploads them again; these copies are admitted against the CPU budget and reported in transfer metrics. Device-generation changes invalidate retained outputs. Broker accounting remains authoritative for OS GPU allocation admission.

## See also

- [OS Compute Service](../webgpu-os/compute.md)
- [Math Contract](math-contract.md)
- [Virtual GPU](vgpu.md)
