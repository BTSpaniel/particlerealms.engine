---
title: CircuitLab Analysis and Smith Lab Integration
description: Triggered electrical scope, detached DC and tolerance studies, cold breaker characterization and explicit Smith Lab RF interchange, with source-bound contracts and verification.
audience: RealmForge developers and circuit authors
updated: 2026-10-01
---

<!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel> -->
<!-- SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha -->

# CircuitLab Analysis and Smith Lab Integration

CircuitLab combines its board workspace with a triggered electrical scope,
detached Test Bench and explicit RF interchange. Scope observes the existing
utility owner's solved substeps. Test Bench solves copied DC operating points
and isolates cold breaker characterization. RF data imports an externally
supplied network and transfers its validated portable project into Smith Lab.
The source audit and primary-source research below informed the implementation.

## What Smith Lab can supply

Smith Lab is the installed `os.smith-lab` RF learning, matching and measurement
application. Its pure modules already provide complex impedance arithmetic,
frequency-indexed network datasets, matching synthesis, reproducible tolerance
analysis, engineering units, calculation ledgers and Touchstone interchange.
CircuitLab can reuse those modules without duplicating RF formulas or taking
over Smith's application state.
(Sources: `webgpu-os/apps/smith-lab/manifest.json`;
`webgpu-os/factory/apps/smith-lab/RFMath.js`;
`webgpu-os/factory/apps/smith-lab/MatchingEngine.js`;
`webgpu-os/factory/apps/smith-lab/Touchstone.js`.)

| Reuse | Existing interface | Integration boundary |
| --- | --- | --- |
| Impedance, reflection and reference changes | `createRfDataset()`, `analyzeRfDataset()`, `convertNetworkParameter()`, `renormalizeNetwork()` in `RFMath.js` | Begin with one-port or diagonal reflection. Transmission entries need transmission-specific interpretation. |
| Matching and tolerances | `solveMatchingProblem()`, `optimizeMatchingNetwork()`, `analyzeTolerance()` in `MatchingEngine.js` | Their specified series/shunt/line networks differ from an arbitrary breadboard terminal graph. |
| Measured RF files | `parseTouchstone()`, `serializeTouchstone()` in `Touchstone.js` | Exchange frequency, parameter type, ports and references. Keep source provenance in project JSON or a separate manifest. |
| Explanations and chart path | `buildCalculationLedger()` in `RFMath.js`; `buildMatchingPath()`, `sampleMatchingPath()` in `RFPath.js` | Explain the same evaluated network rather than drawing an unrelated path. |
| Safe engineering expressions | `parseRfQuantity()`, `parseComplexImpedance()` in `RFUnits.js` | Reuse dimensional validation; do not introduce `eval`. |
| Portable projects | `createSmithLabProjectExport()`, `normalizeSmithLabProjectExport()` in `SmithLabInterchange.js`, re-exported by `index.js` | Typed Measure navigation validates and copies the project before publication. |

Smith's Measure route accepts a versioned `import-project` action. Its receiver
validates the complete handoff, copies its buffers and publishes it only while
the mount and sandbox authority remain current. Cold and already mounted
receivers use the same contract; unmount or an authority change retires staged
imports. Smith workspace persistence saves interface state; datasets, imported
candidate metadata and ledgers belong to the portable project-export contract.
(Sources: `webgpu-os/factory/apps/smith-lab/index.js`;
`webgpu-os/factory/apps/smith-lab/SmithLabInterchange.js`.)

## Best immediate improvement: capture the solved substeps

The original utility clock advances at 240 ticks per simulated second. With the
current eight-substep configuration, each successful `stepCoupledSystem()` call returns eight immutable electrical
reports, each with its actual time, electrical step count, measurements and
protection state. This is 1,920 solved samples per simulated second, with a
nominal interval of 520.833 microseconds. UtilityRuntime publishes these original
reports in the additive `electricalCapture` result after the entire tick commits.
CircuitLab observes one selected circuit's substeps; the generic Instruments
constructor retains its completed-tick mode for existing callers.
(Sources: `engine/sim/electrical/CoupledElectricalSystem.js`;
`webgpu-os/apps/realmforge/modeler/electrical/RealmForgeElectricalRuntimeProjection.js`;
`webgpu-os/apps/realmforge/modeler/electrical/RealmForgeUtilityRuntime.js`;
`webgpu-os/apps/realmforge/modeler/electronics/RealmForgeCircuitInstruments.js`.)

The owner publishes the original reports only after every owned circuit and
final telemetry calculation succeed. A later circuit failure rolls back the
complete utility tick and publishes no capture batch. Scope observes one
selected circuit: saved circuit clocks can differ, and merging reports by array
index or the minimum owner time would mislabel samples. Capturing those reports
adds no solver and no simulation clock.
(Sources: `RealmForgeUtilityRuntime.step()` and `_rollback()`;
`RealmForgePhase7Projection.stepCircuit()` in
`webgpu-os/apps/realmforge/modeler/session/RealmForgePhase7Projection.js`.)

Single acquisition detects a sampled crossing inside an eight-report batch.
It pauses after that complete owner tick. The bounded Run scheduler checks
`playing` before another tick. A trigger timestamp names the observed sample,
rather than an invented time between samples.
(Source: `webgpu-os/apps/realmforge/modeler/electrical/ui/RealmForgeUtilitiesPanel.js`,
`_schedule()`.)

The existing `MathSignal.js` supplies `signalMean()`, `signalRms()`,
`signalPeakReport()`, `rfft()`, `rfftFrequencies()` and window helpers. A spectrum
requires a finite, contiguous, uniformly timed, power-of-two sample window.
Its display must state the interval, window, resolution and amplitude
normalization. The 960 Hz Nyquist limit is a sampling bound; it is not a claim
of demonstrated circuit bandwidth. Backward Euler affects amplitude and phase,
and an averaged PWM model does not contain switching ripple to recover.
(Sources: `engine/core/math/MathSignal.js`;
`engine/sim/electrical/ElectricalRuntime.js`.)

### Capture identity, triggers and reload

`UtilityRuntime.captureIdentity()` returns a stable per-owner source token and
an integer epoch. A successful reset or externally restored projection advances
the epoch immediately. A failed tick or reset preserves it. Instruments observes
this identity without waiting for another Step, so old samples retire when the
owner or epoch changes, including a replacement owner for the same document.

The normalized, read-only `captureStatus().source` and export manifest contain
the actual document ID, revision, content hash, assembly ID and circuit hashes.
Each `initialCheckpoint` entry records its circuit ID, selected saved checkpoint
ID and hash, and initial time and electrical step count. Checkpoint ID and hash
are both null when no saved checkpoint was selected. These fields identify the
capture's source; importing a supplied manifest does not independently prove
its authenticity.
(Sources: `RealmForgeUtilityRuntime.captureIdentity()`;
`RealmForgeCircuitCapture.js` source validator and `captureStatus()`.)

Every retained sample keeps its original `timeSeconds`, electrical `stepCount`,
owner `tick`, `epoch`, selected circuit ID, probe values and protection state.
Duplicate committed ticks add nothing. Missing reports mark a gap; missing
measurements remain absent. Batch validation completes before capture changes.
Timestamp checks allow floating-point subtraction error at large absolute
clocks without changing the reported times. Non-increasing or precision-collapsed
times reject explicitly.

Rising and falling thresholds require two finite contiguous observed values.
Protection trip and reset use the solver's `trippedThisStep` and `resetThisStep`
flags; open detects a sampled closed-to-open transition. A trip or reset latches
at the end of its substep and changes the contact for the following solve. The
trigger marker therefore identifies an observed event, not an interpolated
instant or a same-solve zero-current prediction.
(Sources: `RealmForgeCircuitCapture.captureBatch()` and `_crosses()`;
`engine/sim/electrical/ElectricalThermalProtection.js`.)

Single retains the requested pre-trigger history, crossing and post-trigger
samples, within the 10,000-sample capacity. Completed capture stays frozen even
if simulation later resumes. Reloadable capture JSON contains the exact CSV and
manifest. Loading it inspects frozen data separately from the live owner's
circuit and probes. Rolling capture or Clear restores that live context; Reset
retires the loaded view safely. A foreign captured probe cannot select an
unrelated live board component.
(Sources: `RealmForgeCircuitCapture.loadCapture()`, `clear()` and
`disarmTrigger()`; `RealmForgeCircuitLab.js` probe selection callback.)

### Measurement and spectrum contracts

Mean, RMS, AC RMS, minimum, maximum and peak-to-peak use retained finite values
and report both their count and the number of missing samples. AC RMS removes
the mean. Spectrum accepts all retained samples or an explicitly requested
latest window of 128, 256, 512, 1,024, 2,048, 4,096 or 8,192 samples in the UI.
It rejects a non-power-of-two window, missing values, a gap, mixed epochs or
nonuniform time. It never silently trims, pads or interpolates data.

Rectangular and Hann windows report their coherent gain. The one-sided spectrum
reports peak amplitude, normalized by sample count and coherent gain. Interior
bins are doubled; DC and Nyquist are not. Sample rate derives from the retained
timestamps, and metadata reports the actual window's start, end, count,
resolution and units. A large absolute clock can make that reported rate differ
slightly from the nominal 1,920 Hz schedule without changing the sample values.

CSV writes each original number with round-trip precision, including negative
zero, and keeps source/epoch columns and explicit gaps. Its manifest records
probes, units, trigger settings, interval and source checkpoint bindings. Reload
validates the schema, dimensions, source hashes, column order and sample order
before replacing the inspected capture.
(Source: `webgpu-os/apps/realmforge/modeler/electronics/RealmForgeCircuitCapture.js`,
`measure()`, `spectrum()`, `exportCapture()` and `loadCapture()`.)

## Detached Test Bench

The Test Bench tab contains DC sweep, Tolerance trials and Breaker trip times.
It runs copied experiments independently of Run/Pause/Step, Scope capture and
wiring review. Experiment switches affect only the copied request. A cancelled,
stale or failed run cannot publish provisional rows over the accepted result.
Changing the document/owner or resetting its epoch clears the view's accepted
result and retires pending work. The live utility clock and document transaction
history are not experiment clocks or result storage.
(Sources: `RealmForgeCircuitTestBenchView.js` `run()`, `refresh()` and `cancel()`;
`RealmForgeCircuitLab.js` `testBench` integration.)

### Accepted source and fresh-state policy

`UtilityRuntime.benchSource(circuitResourceId)` copies an owned accepted circuit
and returns `source`, `epoch`, `circuitResourceId`, `circuit`,
`componentOverrides`, `inputs` and control descriptors. Inputs retain the
current effective controls and an empty reset map. The source uses the same
document, assembly, circuit and initial-checkpoint identity as Scope.
`normalizeRealmForgeCircuitSource()` is the shared source validator.

`fingerprintRealmForgeCircuitBenchSource()` separately hashes the effective
projected circuit, component overrides and experiment inputs. The original
circuit resource hash identifies the authored source; it does not substitute
for those effective-model bindings. Completed studies also retain the copied
baseline, controls, epoch and settings hash. A supplied source manifest is a
provenance declaration rather than independent proof of authenticity.
(Sources: `RealmForgeUtilityRuntime.benchSource()`;
`RealmForgeCircuitCapture.js` `normalizeRealmForgeCircuitSource` export;
`RealmForgeCircuitBench.js` source normalization and fingerprinting.)

DC requests use schema `realmforge.circuit.bench-request`, `version: 1`;
results use `realmforge.circuit.bench-result`. Their explicit policy is:

```json
{
  "initialState": "fresh-authored",
  "checkpointUse": "provenance-only",
  "analysis": "dc-operating-point",
  "advancesTime": false,
  "heating": false
}
```

Every point copies the baseline, applies that point's parameters, compiles and
creates a fresh electrical runtime, calls `initialize(inputs)`, and disposes
the runtime before another point. Saved snapshots, warm relay/protection memory
and a previous trial's state never seed the next solve. Result rows therefore
record `timeSeconds: 0` and `stepCount: 0`; this is an operating-point study,
not a settling-time or transient experiment. Authored initial-state settings
still apply to each fresh device. Bench parameters are not applied to accepted
wiring by a hidden document edit.
(Source: `RealmForgeCircuitBench.js` `runRealmForgeCircuitBench()` and `POLICY`.)

### DC sweeps, tolerances and yield

`catalogRealmForgeCircuitBench()` exposes a static parameter vocabulary and
component readouts. It admits DC supplies/sources, resistors, switches, relays,
MOSFETs, piecewise-linear diodes and contact resistance for fuses/breakers.
Coupled actuators and kinds requiring another analysis policy reject the
complete DC study; this includes time-dependent sources and storage devices.
A resistance supplied by a projected material override is omitted from varied
parameters with its reason. Parameter ranges come from the electrical contract
and retain dependent supply/relay bounds. Combined variations can still fail
compilation or solving, and those failures remain explicit rows.

A sweep varies one eligible parameter over 2–257 evenly spaced points with
exact requested endpoints. Stop must exceed start, and the range must fit the
parameter contract. Tolerance accepts 1–1,000 requested trials, 1–8 unique
varied parameters, `distribution: "uniform-relative"`, a seed in
`0..4294967295`, and fractions in `0..0.5`. The UI adds positive-nominal
parameters and expresses those fractions as 0–50 percent. The core supports
1–12 unique requested readouts; the current UI selects one.

Tolerance sorts `componentId:parameter` identities, then uses the existing
Mulberry32 generator for independent uniform draws. Each value is
`nominal × (1 + draw(-fraction, fraction))`. Identical source, input, seed and
settings reproduce the ordered trials, including parameter draws for failed
rows. It does not substitute Gaussian variation, a manufacturer distribution
or deterministic corner coverage.

Optional acceptance names one requested measurement and finite inclusive
minimum/maximum bounds. A failed solve fails that acceptance. Sampled yield is
passing requested trials divided by all requested trials, including failures;
without acceptance, yield and per-row pass assessment remain null. Numerical
summaries use finite solved readouts and report their count, minimum, maximum,
mean, median, 90th/95th percentiles and standard deviation. Failed values stay
null with diagnostics; they are not plotted or averaged as zero.
(Source: `RealmForgeCircuitBench.js` catalog, request normalization, trial loop
and summary generation; `RealmForgeCircuitTestBenchView.js` tolerance controls.)

### Isolated breaker model and sampling uncertainty

`runRealmForgeBreakerBench(benchSource, options, execution)` selects an accepted
breaker and copies its parameters into an isolated three-component DC fixture:
a constant current source, breaker and parallel burden resistor. The burden
keeps a finite path after the contact opens. Source current is compensated for
its closed-state share; results record both source current and actual measured
breaker current instead of treating them as equal.

Every row starts at zero thermal memory with a closed breaker. The manifest
records the authored `initialOpen` value separately from that explicit test
policy. Live material overrides, source controls, thermal memory and board
loads are retained as source context; they do not become the isolated fixture's
operating state. Fixture parameters and circuit hashes identify what was tested.

Defaults are current multiples `[1, 1.1, 1.25, 1.5, 2, 3]`, `h = 1/1920 s` and
a ten-second horizon per current. The core accepts 1–16 finite positive
multiples up to 100, `0 < h ≤ 0.1 s`, and `0 < maximumSeconds ≤ 120 s`, subject
to 100,000 transient substeps per row and 400,000 total budgeted steps. The
budget reserves one post-open observation per row. The UI bounds its time-limit
input to 50 seconds; a valid input can still exceed the combined step budget
and reject before solving. The actual horizon is `floor(maximumSeconds / h)`
substeps, not an interpolated extra sample.

Trip results retain the original trip report, sampled time and step, interval
`[max(0, tripTimeSeconds − h), tripTimeSeconds]`, and uncertainty `h`. Thermal
memory and magnetic pickup are evaluated at the end of a substep. The following
solve observes the open conductance and records its finite current and voltage
separately. Closed-current extrema include the actual measured trip sample;
post-open current has its own record. A timeout is right-censored at its
observed horizon, with null trip fields rather than an invented trip time.

The prediction uses the authored sampled backward-Euler heating law and
constant measured closed current. It retains thermal and magnetic step
predictions separately, including thermal equilibrium that never reaches the
threshold. This is a cold authored-model comparison. It is not a manufacturer's
certified curve, the original board's fault response, ambient calibration,
selectivity study or an arc-clearing model. An AC curve cannot be assigned to
this DC fixture without a new, explicit device model.
(Source: `RealmForgeCircuitBreakerBench.js` fixture, prediction, budget and row
contracts; `engine/sim/electrical/ElectricalThermalProtection.js`.)

### Test Bench exports and final acceptance

DC/tolerance exports provide exact finite CSV rows and a
`realmforge.circuit.bench-manifest` with source, epoch, baseline, fingerprints,
settings, summaries, columns, row count, CSV SHA-256 and complete-result hash.
Failed measurements leave empty cells and retain their diagnostics. The CSV
is bounded to 16 MiB and preserves round-trip numbers, including negative zero.
The UI separately offers the complete Result JSON. It has no Bench result
reload control; the Scope capture loader is a different contract.

Breaker export returns `breaker-model.csv` and `breaker-model.manifest.json`.
The `realmforge.circuit-breaker-bench-export` manifest retains the completed
result, unit-labelled columns, CSV bytes/row count and CSV, result and copied
breaker-model SHA-256 hashes. The result includes source bindings, fixture
hashes, predictions, trip intervals and post-open reports. Tables and plots can
round or thin presentation; exported result data remains authoritative.
The Bench workspace uses one column and hides live inspection and wiring
actions while retaining the utility owner's footer. Exact result rows keep
their request order. The breaker plot sorts a copied presentation array by
measured current, leaves time-limit gaps and marks finite trip observations;
a single trip remains visible. Short table cells stay on one line, while the
varied-value column can wrap inside the scrollable result region.
(Sources: `exportRealmForgeCircuitBench()`;
`exportRealmForgeBreakerBench()`; `RealmForgeCircuitTestBenchView.run()` and
`_renderResult()`; `RealmForgeCircuitLab.setView()`;
`RealmForgeCircuitAnalysisView._plot()`.)

The current Test Bench increment passed 81 distinct source-browser checks:
60 [core, breaker, capture and utility cases](../../tmp/circuit-bench-core/final-r04/results.json)
and 21 [CircuitLab, analysis and Bench interface cases](../../tmp/circuitlab-bench-ui-r05/results.json).
Six separate [water-extraction regressions](../../tmp/circuitlab-water-extraction/final-r04-frozen-r06/results.json)
also passed against readable and actually minified shader text and real module imports.
The repaired build also passed 11 [compiled-export CPU checks](../../tmp/circuitlab-bench-compiled-r06/results.json):
ten CircuitLab cases and one minified water-module import regression,
with zero browser errors and zero raw UI/Bench/solver/RF fallback requests.
The accepted runtime SHA-256 is
`b40879e1ae63e4329f3c6ddc4b09cbb3491f030d036e9b091b7103ede06016d7`;
56 checked source hashes matched the build and stayed stable during verification.
The immutable public-source capture contains 19,541 files. The original CLI
ran from an independent private working copy and completed cache revalidation
with exit code zero. Its 19,540 effective build inputs matched the frozen
capture before and after validation. The sole separately recorded generated
output, `tests/assets/code-metrics.json`, matches the artifact and private
release copies; its generated timestamp changed. All captured paths remain
hashed, and the original rejected output-change attempt is retained.
The staged guest uses this pinned integration. Later canonical Modeler changes
add Action bindings controls; current CircuitLab source/native/DOM checks cover
compatibility with those surrounding changes. CircuitLab's owning methods and
existing cleanup blocks are independently compared against the frozen version.
This does not establish equivalence of the whole Modeler file or test the new
Action bindings feature through the frozen guest.
These checks cover fresh-state invariance against saved warm checkpoints,
seed/order reproducibility, requested-trial yield with failed solves, stale
owner/cancellation exclusion, actual sampled breaker trip/open timing and exact
export bindings. All four [source-native presets](../../tmp/circuitlab-bench-native/final-layout-r04/results.json)
also passed with unchanged source hashes. Lamp exercised powered DC and
seeded tolerance runs; Breaker exercised sampled cold-model trips, exact
exports and owner isolation. The actual r02 compiled desktop
[retains a blocked boot receipt](../../tmp/circuitlab-bench-preview/acceptance-r02-20261001/results.json):
water-shader extraction failed before the public OS readiness gate completed.
The repaired runtime passed all nine [actual compiled OS preview gates](../../tmp/circuitlab-bench-preview/acceptance-r06-layout-20261001/results.json):
verified full OS boot, canonical disposable account setup, Library to empty
asset and reviewed board insertion, all three Bench experiments, narrower
desktop layout, no raw application fallback, and stable artifact/site/source
inventories. Each experiment published a fresh exact result while the live
utility status and time remained unchanged. The temporary test profile was
removed after verification. Four observed hosted Discovery CORS/WebSocket403
diagnostics are retained separately; no application exception or console error
occurred in the accepted route. These local checks do not establish external
Discovery availability. The earlier analysis receipts below precede these source changes.
The Bench verification record, `artifacts/circuitlab/bench-verification-20261001.json`,
binds the distinct source checks, immutable compiled inputs, current integration
comparison, native screenshots, actual OS route and validated documentation.

### Isolated compiled development preview

The preview workflow stages the exact accepted runtime and manifest through
`copy_webgpu_os_site()`, using an explicit artifact directory and a new output
directory. It verifies compressed transport, runtime integrity, shipped
sidecars and the deployed file inventory, then serves a separate localhost
origin with COOP/COEP and the repository's JavaScript/WASM MIME handling.
`/webgpu-os/runtime.html` is the compiled guest entry: its verified loader runs
before the real `boot.js` lifecycle. A standalone development guest starts the
full OS without claiming an installed release identity. Actual shell launch,
RealmForge board creation and Bench experiments require separate browser
acceptance; copying files or checking HTTP alone does not establish boot.

The stable `/webgpu-os/index.html` entry owns installation selection. At a
fresh origin with an empty registry, the shipped bounded legacy loader can
start the compiled preview. An existing active installation selects its own
verified release; replacing physical origin files does not switch that
pointer. Signed enrollment and activation require configured metadata,
provider and trust authorities. The CircuitLab preview does not synchronize
an active consumer, switch an installed registry, change existing user data,
generate release signing/trust keys, install an active release or publish a
deployment. A fresh-origin browser must use normal Realm Passport setup before
opening RealmForge. Browser acceptance creates a disposable local account
through canonical User Management, generating that account's profile keys
inside its temporary browser profile. It imports no real account or recovery
material, records no recovery secrets, and removes that test profile after
verification. This account setup is distinct from release enrollment.
First launch creates Getting Started and opens Modeler. Use Library to open
Asset Home, then create an empty asset and choose Object tools → CircuitLab.
The accepted preview uses the native titlebar maximize button. An earlier
[shortcut attempt](../../tmp/circuitlab-bench-preview/acceptance-r04-library-20261001/results.json)
exposed a separate OS Ctrl+Alt+Up command-logging circular-object exception;
that OS shortcut issue remains outside this CircuitLab change, and application
exceptions remain fatal in preview acceptance.
(Sources: `bundler/site.py` `copy_webgpu_os_site()`;
`webgpu-os/boot.js` `initializeRuntimeEntry()` and `connectRuntimeEntry()`;
`webgpu-os/bootstrap/boot.js`; `webgpu-os/system-release/InstallRegistry.js`;
`webgpu-os/system-release/SystemReleaseInstaller.js`.)

## Software workflows worth adopting

These primary sources were checked on 1 October 2026. The proposed adaptations
are engineering choices inferred from those workflows.

| Reference | Verified behavior | CircuitLab improvement |
| --- | --- | --- |
| [KiCad simulation](https://docs.kicad.org/9.0/en/eeschema/eeschema.html#simulation) | Separate operating-point, DC sweep, AC and transient analyses; component tuning, saved setups and CSV export. | Give each analysis a clear job, retained settings and exact data export. Keep trial parameter changes separate from applying the board definition. |
| [ngspice control language](https://ngspice.sourceforge.io/ngspice-control-language-tutorial.html) | Reset before a DC run after transient, separately numbered simulation plots, parameter loops and data-file export. | State the initial-state policy and keep detached results separate from the live utility owner. Fresh authored trials provide the current reproducible DC policy. |
| [Keysight trigger setup](https://helpfiles.keysight.com/csg/d9300a/Help/Infiniium-UG/Content/Topics/Triggering/a_triggering.htm) | Threshold/edge triggering and acquisition history around a trigger. | Add Armed, Triggered and Complete states, bounded pre-trigger history, post-trigger samples and Single acquisition. |
| [Wokwi analyzer](https://docs.wokwi.com/parts/wokwi-logic-analyzer) | Digital transitions, level/edge triggers and bounded captures with [VCD export](https://docs.wokwi.com/guides/logic-analyzer). | Use event tracks for observed switch/protection changes. MCU logic and protocol decoding require a live execution backend first. |
| [ADI tolerance analysis](https://www.analog.com/en/resources/technical-articles/how-to-model-statistical-tolerance-analysis.html) and [repeatable sampling](https://www.analog.com/en/resources/technical-articles/random-numbers-in-ltspice.html) | Statistical component variation; seeded repeatability and explicit corner alternatives. | Record the seed and distribution. Distinguish sampled yield from deterministic corner checks. |
| [Eaton protection studies](https://www.eaton.com/us/en-us/software/utility-solutions/software-modules/protective-device-module.html) and [ABB selectivity](https://new.abb.com/low-voltage/solutions/selectivity/basic-concepts/selectivity-techniques) | Time-current plots and coordinated protective-device behavior. | Compare modeled cold/warm overload, fault and cooling runs. Show measured trip/open order and “no trip within horizon.” |
| [Touchstone 2.1](https://ibis.org/touchstone_ver2.1/touchstone_ver2_1.pdf) | Frequency-indexed n-port parameters with parameter type, formats and reference impedances. | Reuse Smith's validated dataset and parser/serializer for RF interchange. Keep transient scope data in its own capture format. |

## RF interchange and model eligibility

An existing canonical interface can describe an explicitly specified ideal
one-port load. This browser ES-module example describes a 50 ohm resistor at two
frequencies; it does not claim to measure or simulate a complete board:

```javascript
import { createRfDataset, analyzeRfDataset } from '/webgpu-os/factory/apps/smith-lab/RFMath.js';
const dataset = createRfDataset({
  ports: 1, parameter: 'Z', frequenciesHz: [1e6, 2e6],
  values: new Float64Array([50, 0, 50, 0]), references: [50],
  source: { kind: 'authored-model', description: 'Ideal 50 ohm resistor' },
  diagnostics: [],
});
console.log(analyzeRfDataset(dataset, { row: 0, column: 0 }));
```

An actual analysis artifact must additionally bind its source document revision,
content hash, board identity, terminal pair, model assumptions, reference
impedance and frequency settings. Copy typed-array buffers at the boundary;
freezing their containing record does not make their values immutable. Keep
visualization budgets below parser limits and retain all exported numerical
values independently of plot decimation.
(Sources: `RFMath.createRfDataset()`;
`RealmForgeControlBoardEditing.js` ownership guards.)

`createRfDataset()` alone is not a complete input validator. Its checks cover
positive frequencies, port bounds and buffer length. The implemented
`normalizeRfArtifactDataset()` boundary additionally requires finite complex
values, strictly increasing positive frequencies, positive finite real per-port
references and complete matrices. It accepts S, Z and Y parameters, copies
typed-array buffers, and bounds source metadata and diagnostics to 256 KiB each.
For multiport Z/Y, reflection analysis first converts the complete matrix to S;
using scalar Zii would ignore coupling. Transmission interpretation, H/G and
ideal open/short limits require a separate model and reject explicitly.
(Sources: `RFMath.createRfDataset()`;
`SmithLabInterchange.js` artifact normalization and reflection analysis;
`Touchstone.js` parsing limits.)

The shared importer accepts Touchstone 1.0, 1.1, 2.0 and 2.1, dataset JSON or
portable project JSON. Its receipt records the format, file name, UTF-8 byte
count and SHA-256 of the exact imported text encoded as UTF-8. File input is
decoded with `File.text()` first; this receipt does not claim to preserve an
original file's byte encoding or byte-order marker. Receipts and appended
provenance retain the original dataset source fields. Import receipt and
provenance chains are each bounded to 16 records. Async file reads and hashing
publish only while the request generation, utility owner and epoch stay current.
(Sources: `SmithLabInterchange.importRfArtifact()`;
`RealmForgeCircuitAnalysisView._readFile()` and `loadRfText()`.)

Current Touchstone serialization emits complex values to 12 significant digits
and does not serialize arbitrary `dataset.source` or diagnostics. Use a declared
numerical round-trip tolerance and retain provenance in portable project JSON
or an accompanying manifest. A transient CSV export has a separate exact-value
contract.
(Source: `webgpu-os/factory/apps/smith-lab/Touchstone.js`.)

RF plots use the actual frequency values for horizontal spacing, including
irregularly sampled data. A nonfinite metric breaks the plotted line rather
than becoming zero or connecting across the missing value. CircuitLab may thin
the points drawn in its spectrum and RF plots to limit rendering work; analysis,
cursor values and exports retain the complete numerical arrays. Rendered line
coordinates and labels are presentation values, not a replacement dataset.
(Sources: `RealmForgeCircuitAnalysisView._plot()`;
`webgpu-os/factory/apps/smith-lab/SmithChartView.js` `renderCartesianPlot()`.)

The current board definition remains `low-voltage-dc`. Its allowed kinds exclude
capacitors, standalone inductors and AC sources, even though the engine supports
those devices. Generation metadata version 2 adds construction selection
bindings; it does not enable AC authoring. Arbitrary-board small-signal AC needs
a new analysis backend and operating-point rules. Smith's ordered matching
evaluator cannot replace that terminal-net solver or infer an RF model for a
motor, breaker, relay or nonlinear device.
(Sources: `RealmForgeControlBoardAssemblies.js`;
`engine/sim/electrical/ElectricalContracts.js`;
`RFMath.evaluateMatchingNetwork()`.)

Breaker studies should record their modeled parameters, current clamp, initial
thermal state, timestep and observation horizon. Manufacturer curves need a
versioned device-specific source before becoming presets. Schneider documents
[different magnetic pickup levels for AC and DC](https://productinfo.se.com/powerpactb/viewer/5bce08269f49a5000167f0dd/5bce08789f49a5000167f42d/r/Thermal-MagneticProtectionForCircui-D1A7B183),
so a generic AC curve cannot be silently assigned to the current DC demonstrator.

## Initial eight-piece analysis implementation

1. **MODIFY successful report publication.** Extend the utility owner to publish the original selected circuit's committed reports after complete transaction success. Include circuit identity, exact timestamps, electrical steps, owner tick and interval. Preserve the existing Step return behavior and rollback authority.
2. **MODIFY bounded scope capture.** Extend Instruments and its existing store with an explicitly bounded higher-resolution mode, up to 10,000 raw samples and the existing 12 probes. Identify capture epochs, reject duplicate samples and preserve absent values as gaps. Keep capture independent of rendering.
3. **NEW trigger state.** Add sampled rising/falling thresholds and actual protection events, bounded pre/post history and explicit acquisition states. Freeze completed capture independently of simulation. Single stops after the full owner tick; update the scheduler before enabling that interaction.
4. **MODIFY scope presentation and measurements.** Keep the exact shared cursor, interval, units, retained duration and trigger marker visible. Preserve stable probe controls and linked selection. Reuse MathSignal RMS/mean/peaks and validated spectrum windows.
5. **NEW exact capture export.** Export original timestamps and numerical values to CSV, plus a source-bound capture manifest. Record probes, units, schedule, trigger settings and initial checkpoint identity. Use round-trip serialization rather than display-rounded values.
6. **NEW RF file workspace.** Reuse Smith's parser and public dataset/project validators for externally supplied data. Display actual frequencies, ports, parameter type, references and diagnostics. Begin with one-port/diagonal reflection, and reject unsupported interpretation rather than inventing impedance.
7. **MODIFY explicit Smith handoff.** The typed Measure receiving action accepts a validated portable project. Project JSON and Touchstone export retain their separate precision/provenance contracts. Staged imports are guarded across mount/account changes and both applications keep their storage ownership.
8. **MODIFY verification and documentation.** Verify exact substep counts, rollback exclusion, sampled triggers, scheduler stop, capture retirement, RMS/spectrum, focus/cursor stability and export/import equivalence. Use the actual native workbench to confirm no competing clock or document mutation.

Each piece reuses an existing owner or adds an explicitly missing capability.
`RealmForgeCircuitCapture.js` owns acquisition processing over the existing
telemetry store. `RealmForgeCircuitAnalysisView.js` supplies Scope and RF data
controls. `SmithLabInterchange.js` extracts and extends the original portable
contracts without importing the application UI into CircuitLab.

## Independent acceptance vectors

| Check | Expected evidence |
| --- | --- |
| One successful utility Step | One owner tick and eight original reports; final sample matches the existing final telemetry. |
| RC: 5 V step, 1,000 ohm, 10 microfarad, h = 1/1920 s | Backward-Euler sample 20 equals 3.1887967471925283 V. |
| RL: 5 V, 10 ohm, 0.1 henry, same h | Sample 20 equals 0.3188796747192528 A. |
| RC rising trigger at 3 V | First sampled crossing is step 19; Single stops after step 24 at the completed owner tick. |
| 512 real samples of 3 + 2 sin(2 pi 15 t), 1,920 samples/s | Mean 3 V, RMS sqrt(11) V, AC RMS sqrt(2) V; fundamental bin 4 and amplitude 2 V. |
| Failed later circuit in a utility tick | No reports from the rolled-back tick enter capture. |
| Gap, reset or head replacement | No invented zero values; spectrum rejects invalid windows; old owner captures cannot acquire new-owner data. |
| Actual checkpoint at 1,000,000 seconds | Original increasing timestamps survive capture, exact export/reload, uniform FFT validation, Save and checkpoint reopen. |
| Actual checkpoint at 1e18 seconds with collapsed timestamps | Capture rejects before retaining any sample, even if the solver returned success. |
| RF round trip | Project JSON retains source provenance; Touchstone retains network values/references within its declared numerical tolerance. Unsupported or future schemas reject. |

Focused browser suites exercise these vectors against the real circuit solver.
RC/RL expectations follow the original backward-Euler recurrence; the sinusoid
uses four complete cycles in the stated window. Additional cases cover foreign
capture retirement, exact export/reload, native scheduler stop, copied RF
buffers, diagonal multiport conversion and current receiving authority.
(Sources: `tests/realmforge/phase7.mna-transient.test.js`;
`tests/realmforge/phase7.switching-protection.test.js`;
`tests/realmforge/utility-substep-publication.test.js`;
`tests/realmforge/circuit-capture.test.js`;
`tests/realmforge/circuit-analysis-ui.test.js`;
`tests/smith-lab-interchange.test.js`; `engine/core/math/MathSignal.js`.)

The final focused capture run passed **12 of 12 cases** with zero browser errors
in CPU-only browser mode. It includes the actual million-second checkpoint,
exact source-bound export/reload, foreign artifact recovery and precision-collapse
rejection. Its receipt is `tmp/circuit-capture/long-clock/results.json`; the
accompanying `source-sha256.json` pins the capture, Instruments, fixture and math
sources. This result verifies acquisition and numerical contracts; broader UI,
native WebGPU and compiled-runtime acceptance use their separate receipts.

The final source acceptance on 1 October 2026 passed **206 distinct RealmForge
browser cases**, **66 Smith Lab browser cases** and **seven Smith Lab static
checks**. These include 16 CircuitLab/analysis UI cases, source-bound capture,
copied RF interchange, receiving authority, navigation, schema and lifecycle
checks. The Smith browser count comprises 15 receiving/interchange, six
navigation, 17 schema and 28 lifecycle cases.

All four generated presets—Lamp, Motor, Relay and Breaker—also passed the
current native WebGPU workbench run with trusted input and no browser errors.
Lamp exercised Scope and RF data, real measurements, exact substeps, export and
reload controls, and file selection. The native run also retained linked
selection, one-owner Run/Pause/Step, wiring preview guards, exact checkpoint
Save/reopen and breaker Off-before-reset behavior. Its
[native acceptance receipt](../../tmp/circuitlab-analysis-native-finished/results.json)
records the accepted checks and source hashes, with no source changes during
the run. Inspect the actual [desktop Scope screenshot](../../artifacts/circuitlab/analysis-20261001-lamp-desktop-scope.png),
[narrow Scope screenshot](../../artifacts/circuitlab/analysis-20261001-lamp-narrow-scope.png)
and [RF data screenshot](../../artifacts/circuitlab/analysis-20261001-lamp-desktop-rf-data.png).

The earlier 165 browser and three compiled smoke checks described in the
[board design guide](realmforge-circuitlab-design.md#acceptance-checks) belong
to the initial board increment.

The analysis increment separately passed **six compiled-export CPU checks**
with zero browser errors and zero raw UI or RF source requests. They exercised
actual eight-report RC acquisition, Single at step 19 with the completed tick
ending at step 24, exact export validation, the independent 512-sample sine,
stable probe focus and typed RF transfer into Smith Measure. The tested runtime
SHA-256 is `9ddcee4538467d69bc2a79242dd36f93df18def81335a98a36bf1611b1e9ee84`;
all 15 checked source hashes matched the build and stayed stable during
verification. The [compiled receipt](../../tmp/circuitlab-analysis-compiled/results.json)
records manifest integrity and numerical evidence.

The canonical procedural generation module worker remains a shipped ES-module
sidecar. All exercised UI, document, solver, acquisition and RF APIs came from
compiled `PE.requireModule()` exports. These CPU checks verify compiled
behavior; native WebGPU presentation uses the separate four-preset run. The
acceptance builds did not synchronize active consumers, install an active
runtime or publish a release. The [aggregate analysis receipt](../../artifacts/circuitlab/analysis-verification-20261001.json)
collects browser, native, compiled and documentation results.

Reproduce this focused check from the repository root:

```powershell
python tests/run_realmforge_procedural_build.py --suite circuit-capture --cpu-only --output tmp/circuit-capture-verification
python tests/run_realmforge_circuitlab_native.py --output tmp/circuitlab-analysis-native-verification
```

## Use the analysis workspace

1. Open Object tools → CircuitLab on a supported board. Select a component and add a voltage, current or power probe.
2. Choose Scope. Run or Step uses the existing utility clock; one successful Step adds eight original electrical reports.
3. Choose a trigger and probe, then set the threshold and pre/post sample counts. Single arms the acquisition and starts Run. Complete freezes capture and pauses after its full owner tick.
4. Choose a spectrum window and sample count, then Measure & spectrum. Measurements disclose missing values; a spectrum requires a finite, contiguous window of the requested size.
5. Prepare capture export, then download CSV, Manifest or Reloadable capture. Load saved capture inspects its frozen values. Rolling capture restores the current owner's circuit and probes before acquiring new samples.
6. Choose RF data. Import Touchstone or Smith project JSON from a file or pasted text. Inspect the actual references, frequencies and reflection port. Open in Smith Lab sends the validated portable project; download links offer Project JSON and Touchstone independently.
7. Choose Test Bench. Select a DC sweep, seeded tolerance study or cold breaker experiment. Set the detached experiment switches and bounded settings, then Run experiment. Inspect the completed rows and download CSV, Manifest or Result JSON to retain exact results and source bindings.

Reset and owner replacement retire active captures. RF imports do not mutate the
board or manufacture a frequency response from its transient scope.
(Sources: `RealmForgeCircuitLab.js`; `RealmForgeCircuitAnalysisView.js`;
`RealmForgeCircuitCapture.js`; `SmithLabInterchange.js`.)

## Follow-up research priorities

After the implemented detached DC/tolerance and cold breaker studies, research
explicit warm-state protection trials, original-board fault fixtures,
device-specific manufacturer comparison data, and versioned RLC/stimulus board
authoring. General AC solving needs a new backend. AVR instruction execution
now shares the live UtilityRuntime clock; see the [Arduino and ATmega64A firmware workflow](realmforge-circuitlab-design.md#arduino-and-atmega64a-firmware).
Cycle-resolved external buses, protocol decoding and warm CPU checkpoints still
need further implementation. The separate ForgeBehavior controller I/O remains
in domain-pack tests. Contact bounce, arcing and welding require new physical models.
(Sources: `RealmForgeControllerIoRuntime.js` and
`tests/realmforge/electronics-domain-pack.test.js`;
`engine/sim/electrical/ElectricalRuntime.js`.)

## See also

- [CircuitLab design and board generation](realmforge-circuitlab-design.md)
- [Electricity and control boards](realmforge-electricity.md)
- [Smith Lab](smith-lab.md)
