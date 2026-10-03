---
title: Smith Lab
description: Guided 2D and 3D Smith Chart learning, RF measurement analysis, and deterministic impedance-matching design in WebGPU OS.
updated: 2026-10-01
---

# Smith Lab

Smith Lab is the `os.smith-lab` RF learning and design application. It combines
an accessible Smith Chart academy, deterministic matching-network synthesis,
bounded Touchstone import, and synchronized SVG and WebGPU visualizations. The
same frequency, load, reference impedance, selected marker, and sampled
component path drive every visible result. (Source:
`webgpu-os/factory/apps/smith-lab/RFPath.js`)

The opening surface uses an original generated scientific-cinematic coax and
reflection-field illustration. It is stored with its exact prompt and SHA-256
provenance and is explicitly labeled as a not-to-scale concept visualization.
It never supplies chart coordinates or calculation results; the SVG, WebGPU,
and RF model remain authoritative.

## Start here

The opening screen separates three jobs instead of exposing every RF control at
once:

- **Learn the chart** opens seven interactive lessons covering traveling waves,
  reflections, impedance, Smith mapping, components, stubs, and measurements.
- **Match an impedance** accepts ordinary `R + jX`, frequency, reference
  impedance, and velocity factor values, then synthesizes and ranks matching
  networks.
- **Open measurement data** accepts Touchstone files or pasted frequency tables
  and converts them to one canonical frequency-indexed dataset.

Guided mode uses plain-language prompts and staged decisions. Engineer mode
exposes overlays, exact numerical results, optimization, preferred-value
snapping, and tolerance controls. A metric can be selected to inspect its
symbolic formula, substitutions, assumptions, result, and units.

## Synchronized workbench

The central workbench provides an accessible SVG Smith Chart with impedance,
admittance, and combined grids. Its marker supports pointer dragging and arrow
keys. The selected point is synchronized with normalized impedance, admittance,
reflection coefficient, phase, VSWR, return loss, mismatch loss, reflected
power, voltage extrema, wavelength, and electrical length.

A circuit strip shows each proposed element in source-to-load order and its
value or electrical length. Selecting an element seeks the transformation
timeline to that exact operation. The chart draws each impedance, admittance,
or line segment separately, while the right panel shows the current substituted
state and the calculated terminal residual. In manual design, the linked
Cartesian plot evaluates the selected network across the generated frequency
sweep. An imported dataset currently plots its original analyzed points.
Horizontal spacing follows the actual frequencies, including irregular sweeps;
nonfinite metrics break the line instead of becoming zero-valued points.
CircuitLab can thin rendered RF and spectrum points while keeping complete
numerical arrays for analysis and export.
(Sources: `webgpu-os/factory/apps/smith-lab/index.js`;
`SmithChartView.js` `renderCartesianPlot()`;
`webgpu-os/apps/realmforge/modeler/electronics/RealmForgeCircuitAnalysisView.js`.)

The path record stores the load, ordered transformation steps, exact sampled
impedance and admittance, normalized values, reflection coefficient, metrics,
formula, and terminal state. Lossless line samples preserve reflection
magnitude. Shunt-stub samples add the calculated branch susceptance in the
admittance domain. Exports include project JSON, chart SVG, 3D PNG, calculation
CSV, Touchstone 2.1, and a printable report.

## Physical and mathematical 3D

The physical RF view renders the current animated reflection coefficient as
separate incident, reflected, and total-voltage waves. It derives voltage and
current envelopes from the same complex reflection state, uses selected line
and stub electrical lengths, and adds energy-flow and voltage-stress cues.
Dragging changes orientation and the wheel changes zoom. The physical view uses
the supplied OS GPU facade and surface. Switching views destroys the inactive
3D runtime; returning recreates that view from the retained RF state.
A visible backend badge reports startup
and fallback state. The scene is explanatory rather than a validated
electromagnetic field solver. (Source:
`webgpu-os/factory/apps/smith-lab/SmithLab3D.js`)

Three mathematical views are separate from the engineering chart:

- **Calculated network path** lifts the exact per-element Smith trajectory into
  depth and colors impedance, admittance, and line operations separately.
- **Frequency tower** projects the evaluated sweep into a three-dimensional
  Smith trajectory and synchronizes its selected frequency marker.
- **Riemann view** maps the same calculated path onto the spherical complex
  plane as an optional lesson.

These mathematical views lazily create world-space triangle and line geometry,
then render it through the engine's WebGPU runtime with a perspective camera,
`depth24plus` depth testing, occlusion, orbit controls, and wheel zoom. Network
tubes are built from the exact per-element `RFPath` samples; frequency height
comes from the evaluated sweep; and the Riemann mesh uses stereographic mapping
of the calculated reflection coefficient. A painter-sorted Canvas perspective
renderer preserves the same geometry when WebGPU is unavailable. Reduced-motion
mode starts at a still frame while retaining direct manipulation. (Source:
`webgpu-os/factory/apps/smith-lab/SmithMath3DView.js`)

## RF calculation core

`RFMath.js` provides complex arithmetic, `Z ↔ Y ↔ Γ`, mismatch metrics,
lossless and lossy line transformations, lumped and distributed component
models, ABCD and S conversions, network cascading, parameter conversion, and
reference-impedance renormalization. `RFUnits.js` extends the existing safe
calculator parser; it does not use `eval`.

Accepted expressions include `1.085 GHz`, `36 - j74 ohm`,
`2*pi*1.085GHz*13.2nH`, `0.2195468 lambda`, `77 mm / 0.66`, and `-14 dB`.
Dimensional validation reports incompatible quantities rather than silently
coercing them.

Each primary conversion creates immutable ledger entries with a formula ID,
symbolic formula, substituted values, intermediate values, result, unit,
assumptions, and warnings. This deterministic ledger is the numerical authority
used by explanations and exports.

## Matching and tolerance automation

The solver enumerates both branches of two-element L networks, three-element π
and T candidates, open and short shunt stubs, and a quarter-wave transformer
when the load permits it. Candidates are evaluated through the common network
model, filtered for finite physical values, scored, and ranked.

Band optimization seeds bounded multi-start Nelder–Mead from synthesized
networks. It returns convergence evidence and the five best finite candidates.
Ranking priorities are balanced, broadest band, simplest and smallest.
E6 through E96 preferred-value snapping is available.

Tolerance analysis uses a fixed xorshift seed and 100–5,000 samples. The report
contains yield, minimum, median, 90th and 95th percentiles, worst case, and the
complete ordered envelope, so a run is reproducible from its project seed.

## Touchstone and datasets

`parseTouchstone(text, options)` accepts `.s1p`, `.s2p`, general `.sNp`, and
`.ts` sources. It supports RI, MA, and DB values; Hz, kHz, MHz, and GHz; S, Z,
Y, and two-port H/G parameters; full, lower, and upper matrices; two-port data
ordering; versioned keywords; comments; and per-port reference impedances.
Malformed or truncated input is rejected with diagnostics rather than repaired.

Imports are bounded to 16 ports, 250,000 frequency points, 2,000,000 complex
values, and 16 MiB of source text. The Measure workspace interprets diagonal
reflection ports in S/Z/Y data. Multiport Z/Y uses full matrix conversion before
reflection analysis; unsupported transmission interpretation and H/G input
require a separate model. `serializeTouchstone()` emits a
Touchstone 2.1 full-matrix dataset with complex values at 12 significant digits.
Source metadata and diagnostics stay in portable project JSON; the Touchstone
file does not serialize arbitrary project metadata.

The canonical `RfDataset` record contains frequencies, port count, parameter
kind, interleaved complex matrices, port references, source metadata, and parser
diagnostics. Manual points, pasted sweeps, analytical data, and imported
measurements use this same record.

## Public modules

| Interface | Purpose |
| --- | --- |
| `parseTouchstone()` / `serializeTouchstone()` | Bounded measurement interchange. |
| `createRfDataset()` / `analyzeRfDataset()` | Canonical RF records and synchronized metrics. |
| `convertNetworkParameter()` / `renormalizeNetwork()` | S/Z/Y conversion and port-reference changes. |
| `cascadeNetworks()` | Cascades ABCD records or aligned two-port datasets. |
| `solveMatchingProblem()` | Closed-form and deterministic topology enumeration. |
| `optimizeMatchingNetwork()` | Bounded multi-frequency candidate refinement. |
| `analyzeTolerance()` | Seeded tolerance yield and percentile evidence. |
| `buildCalculationLedger()` | Structured, exportable RF derivations. |
| `buildMatchingPath()` / `sampleMatchingPath()` | Exact per-element visual and explanatory RF states. |
| `normalizeRfArtifactDataset()` / `analyzeRfArtifactDataset()` | Copied, strictly validated S/Z/Y artifacts and diagonal reflection using complete multiport Z/Y conversion. |
| `importRfArtifact()` / `exportRfArtifactProject()` | Bounded file-text import receipts and provenance-preserving portable projects. |
| `createSmithLabHandoff()` / `normalizeSmithLabHandoff()` | Versioned, validated `import-project` navigation to Measure. |

The interchange interfaces live in
`webgpu-os/factory/apps/smith-lab/SmithLabInterchange.js`, independently of the
application UI. Strict artifact input requires finite complete matrices,
strictly increasing positive frequencies and positive finite real per-port
references. Source metadata and diagnostics are each bounded to 256 KiB. H/G,
transmission interpretation and ideal open/short limits reject in the current
finite-impedance reflection model.

The application itself retains the OS lifecycle contract:
`mount(root, syscalls)`, `unmount()`, and `getDebugSnapshot()`.

## CircuitLab interoperability

CircuitLab reuses the pure RF math, datasets and Touchstone modules. Its current
DC board runtime is a separate time-domain owner. Open in Smith Lab sends a
typed `import-project` action to Measure. The receiver validates and copies the
portable project, and rejects stale mount or sandbox authority before
publication. Imported source, candidate and ledger metadata remain in Project
JSON; they do not execute arbitrary candidate networks. RF-derived point values
stay out of the browser-global interface persistence mirror. See the
[CircuitLab analysis and integration plan](realmforge-circuitlab-analysis-plan.md)
for the implemented Scope/RF workflow and audited boundaries.
(Sources: `webgpu-os/factory/apps/smith-lab/index.js`;
`webgpu-os/factory/apps/smith-lab/SmithLabInterchange.js`;
`webgpu-os/apps/realmforge/modeler/electronics/RealmForgeControlBoardAssemblies.js`.)

CircuitLab's Test Bench is a separate DC experiment owner. Its fresh operating
points, Mulberry32 uniform-relative tolerance trials and cold breaker fixture
do not invoke Smith's RF matching/tolerance evaluator or become a frequency
response. Smith retains its existing xorshift RF tolerance policy and network
models. Bench CSV/manifest exports use their own source and model bindings;
Open in Smith Lab continues to transfer only a validated portable RF project.
See the [detached Test Bench contracts](realmforge-circuitlab-analysis-plan.md#detached-test-bench).
The new Bench increment passed 81 source-browser checks and all four
[source-native presets](../../tmp/circuitlab-bench-native/final-layout-r04/results.json).
The repaired build passed 11 compiled-export CPU checks, including the ten
CircuitLab cases and one water-module import regression.
Its actual r02 full-OS preview boot was blocked by water-shader extraction;
the repaired build subsequently passed all nine actual compiled OS/RealmForge
preview gates, including board generation and the three detached Bench modes.
The accepted route recorded no application exception or console error;
hosted Discovery transport diagnostics remain separately retained. The RF results
below belong to the preceding analysis increment.
(Sources: `webgpu-os/apps/realmforge/modeler/electronics/RealmForgeCircuitBench.js`;
`RealmForgeCircuitBreakerBench.js`; `RealmForgeCircuitTestBenchView.js`;
`webgpu-os/factory/apps/smith-lab/MatchingEngine.js`.)

The shared text importer accepts Touchstone 1.0, 1.1, 2.0 and 2.1, RF dataset
JSON and portable project JSON. Its receipt records format, file name, UTF-8
byte count and SHA-256 of the supplied text encoded as UTF-8. File input is
decoded before this step; the receipt identifies that text rather than an
original file's encoding. Original source fields remain intact, with bounded
appended receipt and provenance records. Imported candidate and ledger metadata
survive Project JSON export without becoming an executing matching network.
(Source: `SmithLabInterchange.importRfArtifact()` and
`exportRfArtifactProject()`; `index.js` `importProject()`.)

## Verification

The deterministic browser suite is `tests/smith-lab.html`. It covers Smith
boundaries, round-trip transformations, half-wavelength periodicity, unit
parsing, the corrected dual-stub fixture for `100 + j100 Ω` on `50 Ω`, stored
source-to-load stub topology, matching-path equivalence and line invariants,
Touchstone parsing and export, renormalization, matching synthesis, optimizer
determinism, tolerance reproducibility, responsive mounting, cleanup, and live
WGSL compilation. The application is also included in normal WebGPU OS app
discovery and release bundling.

The 1 October 2026 CircuitLab interchange acceptance passed 66 Smith browser
cases: 15 receiving/interchange, six navigation, 17 schema and 28 lifecycle
checks, plus seven static checks. This verifies the shared portable contracts
and receiving lifecycle. Six additional compiled-export CircuitLab checks
passed, including typed RF handoff to the actual Smith Measure receiver,
coupled multiport conversion and irregular frequency spacing. They recorded
zero raw UI/RF source requests and stable build/source bindings. The
[aggregate analysis receipt](../../artifacts/circuitlab/analysis-verification-20261001.json)
and [CircuitLab analysis guide](realmforge-circuitlab-analysis-plan.md#independent-acceptance-vectors)
record the separate RealmForge, native and compiled results. The canonical
procedural worker is an ES-module sidecar; the tested application and RF APIs
ran from compiled exports. Verification did not synchronize active consumers,
install an active runtime or publish a release.

## Engineering references

The line direction, constant-reflection-magnitude rotation, standing-wave
envelope, admittance-chart relationship, and shunt-stub construction follow the
[MIT 6.013 transmission-line treatment](https://web.mit.edu/6.013_book/www/chapter14/14.6.html).
The separation of incident and reflected traveling waves and the distributed
line model also follow the
[Keysight S-parameter design note](https://www.keysight.com/us/en/assets/7018-06743/application-notes/5952-1087.pdf).
These sources define the engineering behavior; all shipped prose, code, and
visual assets are original.
