---
title: CircuitLab Design and Board Generation
description: Research and implemented CircuitLab design inside RealmForge, with linked board generation, circuit inspection, measured traces, and breaker simulation.
audience: RealmForge developers and asset authors
updated: 2026-10-01
---

<!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel> -->
<!-- SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha -->

# CircuitLab Design and Board Generation

CircuitLab gives RealmForge authors one place to generate, wire, operate and
inspect a control board. The implemented workbench reuses the board compiler,
electrical runtime and permanent 3D viewport. It adds direct contact wiring,
component parameter and pin editing, linked selection, a triggered substep scope,
RF interchange with Smith Lab, a detached Test Bench, and a
protected DC board with thermal and magnetic breaker behavior. AVR boards now
execute compiled firmware through the same electrical clock. PCB routing remains
a separate extension.
(Sources: `modeler/electronics/RealmForgeCircuitLab.js`;
`modeler/electronics/RealmForgeCircuitLabBoardCreator.js`;
`modeler/electronics/RealmForgeCircuitInstruments.js`, relative to
`webgpu-os/apps/realmforge/`.)

## Foundation and resolved interface gaps

The original generator produced lamp, motor, and relay control boards. Their
definition records the supply, components, occupied contacts, jumpers, and
reference contacts. Compilation derives electrical nets from actual conductive
strips and passes them through the existing electrical solver. Generation creates
construction geometry, circuit resources, and stable lamp and motor presentation
bindings. CircuitLab generation version 2 saves validated selection bindings
for every component, contact and jumper segment, including the motor's shaft
and pointer. Version 1 output remains reproducible for saved legacy boards.
(Source: `webgpu-os/apps/realmforge/modeler/electronics/RealmForgeControlBoardAssemblies.js`.)

The previous editor changed jumpers through six contact selectors: side, row,
and hole for each endpoint. It shows component pins and connections as lists.
The editor lived in the scrolling Electricity and data utility panel alongside
controls, readouts, and explanation. CircuitLab now centers the real board
diagram, moves accepted measurements and controls to the inspector, and puts
observed traces in a drawer. The six selectors remain under Contact list.
These changes address source-review findings; no user study is claimed.
(Sources: `modeler/electronics/RealmForgeControlBoardEditor.js`;
`modeler/electrical/ui/RealmForgeUtilitiesPanel.js`, relative to
`webgpu-os/apps/realmforge/`.)

## Software research

The following features were checked in primary documentation on 1 October 2026.
The adaptations are design decisions inferred from those workflows.

| Software | Documented workflow | CircuitLab adaptation |
| --- | --- | --- |
| [Wokwi](https://docs.wokwi.com/guides/diagram-editor) | Direct part placement and wire editing on a board diagram. Its [debugger](https://docs.wokwi.com/guides/debugger) provides breakpoints and stepping for supported targets. | Put board interaction at the center. Reveal program debugging only when the selected device has an executing backend. |
| [KiCad](https://docs.kicad.org/9.0/en/eeschema/eeschema.html#cross-probing-from-the-pcb) | Cross-probing links schematic pins, PCB pads, and nets. Rule violations can be located in the design. | Keep selection and fault location linked across the board diagram, net inspector, and RealmForge geometry. |
| [LTspice](https://github.com/analogdevicesinc/ltspice-reference/blob/main/ai_ref/WAVEFORM-VIEWER-GUIDE.md) | Direct circuit probing opens voltage and current traces; waveform cursors support measurements. | Make Probe an explicit canvas tool. Add the selected measurement to a compact instrument drawer. |
| [Proteus VSM](https://www.labcenter.com/vsmstudio/) | Firmware breakpoints and schematic execution share debugging state for supported devices. | Keep one operation bar and coordinated time state when a verified firmware backend is introduced. |
| [Falstad CircuitJS](https://www.falstad.com/circuit/directions.html) | Circuit state is visible on the diagram; scope selection highlights the associated component. | Link measured values and traces to the selected component, with text and line-pattern cues as well as colour. |
| [Ripes](https://github.com/mortbopet/Ripes/blob/master/docs/introduction.md) | Registers, memory, instructions, and datapath views describe the same processor model. Simplified views reduce displayed detail. | Add processor detail through contextual views, keeping the same execution state and selected device. |

For the planned emulation extension, [Logisim evolution test vectors](https://github.com/logisim-evolution/logisim-evolution/blob/main/docs/test_vector.md)
and [Digital](https://github.com/hneemann/Digital) offer useful digital test and
timing workflows. [Renode](https://renode.readthedocs.io/en/latest/debugging/gdb.html)
documents system debugging with paused virtual time. These references do not
supply a browser emulator backend for RealmForge.

## Implemented CircuitLab workspace

The specialist workspace opens through **Object tools → CircuitLab** or the Electronics
facet. It retains the contextual modes and permanent 3D viewport. A supported
control-board asset opens the lab; otherwise, CircuitLab opens Create board.
(Sources: `modeler/studio/RealmForgeStudioFacetRegistry.js`;
`modeler/ui/RealmForgeModeAvailability.js`; `modeler/ui/ModelerPanel.js`.)

The footer holds Run or Pause, Step, simulated time and Save state; a separate
review bar holds Validate and preview and Apply reviewed wiring. It distinguishes
the wiring draft from the operating preview. A paused simulation does not imply that a wiring draft has
been applied. The step control names its unit: one existing fixed engine tick
for the present circuit runtime.

The central canvas opens as Board. It draws real contacts, five-hole strips,
the center gap, independent rail sections, component pins, and jumpers from the
current topology and definition. Net and 3D views expose related circuit and
construction objects. A click selects an object; Wire selects two available
endpoints; Escape cancels the unfinished connection. Occupied contacts remain
visible and explain why they cannot accept another pin.

A compact component list supports search and keyboard selection. The selection
inspector exposes component identity, pins, supported parameters, actual net
membership, and available measured values. Generated presets and supported
component models supply the editing vocabulary. Invalid edits remain repairable
drafts and cannot replace the accepted board.

Instruments remain available in the resizable drawer. The Scope tab moves the
same instrument nodes into a larger workspace and adds acquisition controls.
Named voltage, current and power traces capture all eight committed electrical
reports per successful utility tick, up to 10,000 samples. Selecting a trace
highlights its accepted live component. A foreign loaded capture remains
inspectable and its probes cannot select unrelated board geometry. The shared
cursor and value table retain original
timestamps and electrical step counts; missing values and skipped samples stay
explicit. Capture adds no solver or simulation clock.

Single supports rising/falling thresholds and actual protection trip, open and
reset events. Pre-trigger and post-trigger sample counts are bounded. The scope
marks the observed crossing and freezes the completed acquisition; the utility
clock pauses after its full owner tick. Mean, RMS, AC RMS and peak-to-peak use
retained finite samples. Spectrum uses an explicitly selected power-of-two
window, reports its sample rate and amplitude normalization, and rejects missing
or discontinuous input. Prepare capture export offers exact CSV, a source-bound
manifest and a reloadable frozen capture. Rolling capture restores the live
owner's circuit and probes after inspecting an imported capture. Reset and
owner replacement retire old capture epochs immediately. See the
[capture and spectrum contracts](realmforge-circuitlab-analysis-plan.md#capture-identity-triggers-and-reload)
for source bindings, protection timing and FFT normalization.
(Sources: `modeler/electronics/RealmForgeCircuitCapture.js`;
`modeler/electronics/RealmForgeCircuitAnalysisView.js`;
`modeler/electrical/RealmForgeUtilityRuntime.js`.)

RF data imports Touchstone or a portable Smith Lab project. It shows the actual
frequency range, port references and diagonal reflection data. Open in Smith
Lab transfers a validated portable project into Smith's Measure workspace.
Project JSON retains provenance and candidate metadata; Touchstone uses its
declared numerical precision. Multiport Z/Y reflection uses complete matrix
conversion; H/G and transmission interpretation require another model. Import
receipts hash the UTF-8 encoding of supplied text. This workflow analyzes externally supplied RF
data. Arbitrary-board AC solving remains a separate extension.
(Source: `webgpu-os/factory/apps/smith-lab/SmithLabInterchange.js`.)

Test Bench adds DC sweep, Tolerance trials and Breaker trip times beside Scope
and RF data. Its single-column workspace hides live component inspection and
wiring actions while retaining the utility owner's Run/Pause/Step footer.
Detached experiment switches remain inside the Bench setup. DC and tolerance
studies copy the accepted projected circuit,
material overrides and experiment controls. Every point creates and disposes
its own fresh authored runtime and solves a DC operating point. Saved
checkpoints identify provenance; their warm electrical or thermal state never
seeds a trial. The live board, utility clock, wiring draft and saved document
remain independent. Unsupported dynamic devices and coupled actuators expose
an eligibility reason rather than a simulated result.

Tolerance trials use independently sampled uniform relative variation and an
explicit unsigned 32-bit Mulberry32 seed. The requested trial count includes
failed solves in the sampled-yield denominator. Acceptance is optional and
uses one selected finite readout range. The core bounds runs to 257 sweep
points, 1,000 tolerance trials, eight varied parameters and 12 measurements;
the UI currently selects one readout. Result tables retain exact finite
numbers, failed rows and diagnostics. CSV, Manifest and Result JSON downloads
retain settings, source/epoch and effective-model fingerprints.

Breaker trip times characterizes a copied breaker in a separate constant DC
current-injection fixture. Each current starts cold with a closed contact,
including when the authored device initially opens. Results show actual
breaker current, sampled trip bounds, thermal/magnetic model prediction,
finite post-open current and right-censored time-limit rows. This tests the
authored model; it does not reproduce the original board's fault response or
establish a manufacturer's AC/DC curve, ambient calibration or arc-clearing
time. See the [Test Bench contracts](realmforge-circuitlab-analysis-plan.md#detached-test-bench)
for limits, exact source bindings and current acceptance. The Test Bench
increment passed 81 source-browser checks and all four source-native presets.
The pinned repaired runtime passed 11 compiled-export CPU checks, including
the ten Bench cases and a water-module import regression. A separate earlier
full-OS preview exposed a water-shader extraction error before public OS
readiness. The repaired runtime subsequently passed all nine actual compiled
OS/RealmForge preview gates, including reviewed board insertion and all three
Bench experiments with unchanged live status/time.
(Sources: `modeler/electronics/RealmForgeCircuitBench.js`;
`RealmForgeCircuitBreakerBench.js`; `RealmForgeCircuitTestBenchView.js`;
`modeler/electrical/RealmForgeUtilityRuntime.js` `benchSource()`.)

Validation feedback locates contacts and component paths when compilation
provides those identifiers. Advanced solver diagnostics remain expandable.
Narrow layouts stack the board and inspector. They retain selection, drafts,
probes and simulation state when a panel is hidden. Keyboard operation, visible focus,
readable metric units, theme tokens, and reduced motion apply throughout.

## Generate boards inside RealmForge

The initial generation flow uses the existing registered control-board family:

1. Choose Lamp, Motor, Relay or Breaker, then set 5, 12, or 24 V DC, 10 to 30 rows, and split or continuous rails.
2. Prepare a generated candidate through the existing guarded Build workflow.
3. Inspect the generated 3D assembly, then Insert reviewed board. Insertion retains the current document's generated resources.
4. Inspect the accepted board's contacts and circuit connectivity in CircuitLab. Make supported component and jumper edits, then Validate and preview the complete definition. Further edits retire the superseded preview.
5. Apply reviewed wiring through one existing construction transaction.
6. Run the accepted circuit, add probes, and explicitly save its operating checkpoint when desired.

For example, a 12 V motor board with 20 rows should open with its existing fuse,
MOSFET, pull-down, flyback diode, motor, and power switch. Selecting the MOSFET
should identify its gate, drain, source, board contacts, solved component values,
and generated part. Changing a jumper should invalidate the reviewed candidate;
Apply becomes available only after the new definition passes compilation.

The generator creates substrate, contact pieces, component geometry,
jumpers, and motor shaft/pointer geometry. CircuitLab reuses those outputs.
Moving between views must not silently regenerate the design or create another
electrical runtime. Authored definitions and stable IDs remain part of the saved
intent. Manual changes within the generated resource closure keep the existing
replacement protection.
(Sources: `modeler/electronics/RealmForgeControlBoardAssemblies.js`;
`modeler/electronics/RealmForgeControlBoardEditing.js`;
`construction/RealmForgeBuildController.js`;
`construction/RealmForgeConstructionDocumentTransaction.js`.)

Printed circuit boards are a separate extension. Existing PCB resources and
validation provide board, footprint, pad, via, trace, and rule records, but the
control-board generator produces breadboard assemblies. A PCB workflow needs
validated placement and copper routing before manufacturing outputs can be
offered. A 3D board image cannot establish that its electrical routes are valid.
(Sources: `modeler/electronics/RealmForgePcbContracts.js`;
`modeler/electronics/RealmForgeElectronicsValidation.js`.)

## Arduino and ATmega64A firmware

Create board includes Arduino Uno R3, classic Nano, Mega 2560 and an ATmega64A lab
carrier. Each generated module has its own physical body, headers and contacts
beside the breadboard. Wiring creates finite-resistance GPIO drivers in the
existing electrical solver. The included genuine AVR machine-code blink drives
`lamp.load` through D13, or PB0 on the ATmega64A carrier.
(Sources: `modeler/electronics/RealmForgeMicrocontrollerProfiles.js`;
`RealmForgeMicrocontrollerBoard.js`; `RealmForgeControlBoardAssemblies.js`.)

| Profile | MCU | Flash | SRAM | Fixed authored clock | Pin interface |
|---|---|---|---|---|---|
| Uno R3 | ATmega328P | 32 KiB | 2 KiB | 16 MHz, 5 V | 20 GPIO including six ADC inputs |
| Classic Nano | ATmega328P | 32 KiB | 2 KiB | 16 MHz, 5 V | 20 GPIO and two additional analog-only inputs |
| Mega 2560 | ATmega2560 | 256 KiB | 8 KiB | 16 MHz, 5 V | 70 GPIO including 16 ADC inputs, four USARTs |
| ATmega64A lab carrier | ATmega64A normal mode | 64 KiB | 4 KiB | 1 MHz internal RC, 5 V | 53 GPIO, eight ADC inputs, two USARTs |

The ATmega64A carrier is an authored interface, rather than an official Arduino
board. It selects normal mode with M103C unprogrammed; ATmega103 compatibility
mode is a different device configuration. Arduino mappings and body/header
coordinates are derived from official [Uno](https://docs.arduino.cc/hardware/uno-rev3/),
[Nano](https://docs.arduino.cc/hardware/nano/) and
[Mega](https://docs.arduino.cc/hardware/mega-2560/) documentation, pinouts, AVR core
variants and CAD archives. The [ATmega64A datasheet](https://ww1.microchip.com/downloads/en/DeviceDoc/Atmel-8160-8-bit-AVR-Microcontroller-ATmega64A-datasheet.pdf)
and Microchip device pack supply device facts. Nano A6/A7 remain analog-only.
The module uses a direct 5 V supply interface; USB converters, VIN regulators,
bootloaders and fuses are outside the current electrical model.

Use the Firmware tab to load a local Intel HEX file, inspect cycles, PC, pin
states and UART bytes, reset the selected microcontroller, or export its loaded
image. Arduino IDE's **Sketch → Export Compiled Binary** produces the standard
`.hex` image. Import that image, rather than `.with_bootloader`.
[Arduino documents the export recipes](https://docs.arduino.cc/arduino-cli/platform-specification/#recipes-to-export-compiled-binary).
ATmega64A requires a suitable AVR compiler target, such as AVR-GCC
`-mmcu=atmega64`; the stock Arduino AVR core does not supply an ATmega64A board.
Compilation happens outside RealmForge; loading executes the supplied machine
code locally using pinned, vendored [AVR8js 0.21.1](https://github.com/wokwi/avr8js).
(Sources: `RealmForgeMicrocontrollerView.js`; `RealmForgeAvrRuntime.js`;
`tools/vendor_avr8js.py`; `vendor/avr8js/0.21.1/provenance.json`.)

Loading and resetting are transient. **Review firmware change** combines the
image with the complete current wiring draft; **Apply reviewed firmware** saves
that exact candidate in one guarded Undo transaction. Reopening retains the
firmware and starts the CPU cold. Save state is disabled on MCU boards because
the backend's opaque warm CPU/peripheral rollback tokens are not serializable
electrical checkpoints. Invalid HEX and stale asynchronous file reads preserve
the accepted board and execution owner.
MCU Scope manifests use capture version 2 and include the actual loaded HEX,
controller and circuit identity, profile clock and electrical reset origin.
The document hash still identifies the accepted saved board. This additional
firmware provenance distinguishes an unsaved image from the saved source.
Ordinary board captures retain their version 1 format.
(Sources: `RealmForgeMicrocontrollerView.js`; `RealmForgeControlBoardEditing.js`;
`modeler/electrical/RealmForgeUtilityRuntime.js`.)

CPU cycles follow the board's fixed clock inside the existing eight electrical
substeps per 240 Hz owner tick. External feedback therefore samples at 1,920 Hz,
using the previous accepted solve. Fast GPIO edges, PWM and serial bit waveforms
are not resolved at CPU-cycle precision by the circuit solver. UART output is a
bounded byte trace. GPIO, single-ended ADC and asynchronous USART are modeled;
Uno/Nano and Mega also configure their timer/PWM and EEPROM peripherals. Legacy
ATmega64A timer operations stop with an explicit diagnostic. SPI/TWI buses,
sleep, self-programming, differential ADC, comparators and independent AREF
wiring are unsupported. Runtime capabilities report these limits.
GPIO output resistance (25 Ω) and pullup resistance (35 kΩ) are authored model
parameters. Port current limits, overheating and pin damage are not device
protection models.

The bridge samples actual supply voltage. It suspends and resets execution
outside the profile's supported running voltage range, then resumes from reset
when the supply returns. The current CPU input thresholds and ADC supply
reference use the authored 5 V interface. This is a declared model boundary;
the profile clock does not establish physical timing accuracy. Failed solves or
publication restore CPU buffers, pending peripheral events, cycle carry, traces
and electrical state together, before any capture is published.
If a supply reset splits an accepted owner tick, its eight-sample capture is
omitted rather than assigning one reset origin to mixed execution states.
The next stable tick resumes capture under the new source and epoch.
(Sources: `RealmForgeMicrocontrollerCircuitBridge.js`; `RealmForgeAvrRuntime.js`;
`engine/sim/electrical/CoupledElectricalSystem.js`;
`modeler/electrical/RealmForgeElectricalRuntimeProjection.js`.)

Focused checks use the repository's Python/browser runner:

```powershell
python tests/run_realmforge_procedural_build.py --suite microcontroller-profiles --suite avr-runtime --suite microcontroller-board --suite microcontroller-ui --cpu-only --output tmp/circuitlab-microcontroller-verification
python tools/vendor_avr8js.py --check
python tests/run_realmforge_circuitlab_native.py --preset arduino-uno-r3 --preset arduino-nano --preset arduino-mega-2560 --preset atmega64a --output tmp/circuitlab-microcontroller-native
```

## Simulation and emulation boundaries

CircuitLab exposes the existing circuit solver through the improved interface.
The protected DC preset adds opt-in thermal cooling, instantaneous magnetic
pickup, latched trips and manual Off-before-reset behavior. Switch contacts
use the engine's finite resistance model; SPDT supports NO/NC changeover.
Observed traces contain original electrical substeps from committed owner ticks
and disclose the capture interval.
The separate controller runtime supports
compiled ForgeBehavior with delayed I/O commits, but the current utility owner
does not run that controller. The Firmware tab instead owns an explicit AVR
instruction backend through the coupled electrical projection.
(Sources: `engine/sim/electrical/ElectricalRuntime.js`;
`modeler/electronics/RealmForgeControllerIoContracts.js`.)

The emulation surface obtains available operations from the
actual backend. Register, memory, code, clock, or graphics-command views appear
only when that backend supplies the associated state and operation. This keeps
the interface extensible without presenting non-executing controls.

The supplied N64 conversation suggests a future graphics-command workbench:
command decoding, edge stepping, and depth inspection. A complete N64 emulator
also needs CPU, RSP, memory, peripheral, timing, and video models. No such backend
was found in the reviewed RealmForge source. The pasted initial-depth packing
claim also needs correction: the RDP triangle command stores initial Z with
16 integer and 16 fractional bits. See the [SGI RDP command summary](https://hcs64.com/files/RDP_COMMANDS.pdf).

## Implementation blueprint

These eight pieces describe the delivered source layout. Generation version 2
and the protected DC preset extend the originally researched plan.

1. **NEW CircuitLab workspace:** `modeler/electronics/RealmForgeCircuitLab.js` and scoped styles. Mount the specialist canvas, inspector, and instrument hosts. Reuse the permanent RealmForge viewport and existing Electronics entry.
2. **NEW board diagram:** `modeler/electronics/RealmForgeCircuitBoardView.js`. Render topology and definitions; support direct endpoints, selection, pan, zoom, and keyboard access without owning circuit state.
3. **MODIFY board editing:** extend `RealmForgeControlBoardEditor.js` with supported definition edits and direct diagram interaction. Reuse `compileRealmForgeControlBoard()` and guarded editing callbacks.
4. **MODIFY inspection:** adapt existing component/net inspection for shared selection. Validate complete component/contact-to-part bindings from the generator; derive displayed values from accepted circuit telemetry.
5. **MODIFY generation entry:** expose the existing control-board presets and parameters through CircuitLab and publish complete validated selection bindings. Reuse deterministic IDs and canonical instance remapping, version changed generator output, and preserve saved legacy generation and edit guards.
6. **NEW instrument presentation:** add bounded time-series capture and plots of real runtime reports. Keep run/pause/step on the current utility owner.
7. **MODIFY session integration:** route control-board assets to CircuitLab, preserve wiring drafts and supported view state, and reuse checkpoint Save, close rollback, account/head invalidation, and disposal.
8. **MODIFY verification and docs:** add focused interaction and native-workbench cases, update the electricity guide after delivery, and record source-bound evidence. Preserve existing household utilities tests and behavior.

Diagnostics should record opening, draft invalidation, validation result,
preview replacement, Apply, run/pause, Save, rejection, and disposal. Measure
generation, validation, and capture costs at their boundaries. Keep steady
per-frame presentation free from verbose console output. Failed preparation
retains the existing accepted runtime. Failed Apply preserves the wiring draft;
revalidate and prepare a fresh candidate before retrying Apply.

## Acceptance checks

- Generate all four presets and verify that Board, Net, and 3D selections identify the same saved components and contacts.
- Add and remove a jumper with pointer and keyboard input. Verify occupied contacts, split rails, isolation errors, and stale-preview rejection.
- Run, pause, and single-step the actual circuit. Compare every displayed measurement and plot sample with its owning runtime report.
- Apply one wiring change with one Undo entry. Save and reopen one operating checkpoint with exact state and no invented extra tick.
- Close an unsaved operating preview and restore its captured state. Change account, asset, and document head while work is pending; reject stale results.
- Inspect desktop and narrow layouts, theme contrast, keyboard focus, accessible measurement tables, reduced motion, and retained hidden-panel state.
- Run existing control-board, utilities, electrical-panel, and relevant native lifecycle suites. Collect browser screenshots and real solver evidence.

Focused browser suites verify solver reports, wiring review and replacement,
one-Undo insertion, legacy regeneration, selection bindings, bounded cursor
samples, reset eligibility, keyboard tabs and read-only behavior. Native
workbench acceptance uses the actual ModelerPanel, viewport and trusted inputs;
its receipt distinguishes accepted operations from pending or failed checks.
(Sources: `tests/realmforge/circuitlab.test.js`;
`tests/realmforge/circuit-board-editor.test.js`;
`tests/realmforge/control-board.test.js`;
`tests/realmforge/phase7.switching-protection.test.js`.)

The initial board-workspace acceptance run on 1 October 2026 passed 165 focused browser cases across the
electrical core/devices, control-board generator, utilities, constraints,
utility panel, household breaker panel, diagram editor and CircuitLab suites. All four presets also
passed native WebGPU workbench acceptance with trusted input and no browser
errors. The native run checked exact Save/reopen checkpoints and actual part
selection. Lamp also covered Nets jumper selection linked to its actual 3D
segment, direct wiring, preview invalidation and one-Undo board
insertion. Breaker covered trip, Power-On reset rejection, decreasing thermal
memory while Off, and reset retaining Off. Desktop and narrow screenshots
verified at least 120 visible pixels of the physical board while Instruments
was open. The drawer and component editor share the available viewport space
without replacing the permanent 3D viewport.

Three additional initial board-workspace compiled-runtime smoke checks passed against that increment's final
bundle and its SHA384 integrity. They exercised the compiled CircuitLab APIs,
real breaker trip/cooling/Off-before-reset behavior, linked Nets jumper
selection, single-step capture and retained probe focus. Procedural generation
uses the canonical module-worker sidecar; the UI, document and solver APIs ran
from compiled exports without a source UI fallback.

The later substep acquisition core passed 12 focused browser cases with zero
browser errors, including sampled triggers, exact export/reload, large absolute
clocks and foreign capture retirement. Its source-bound receipt is
`tmp/circuit-capture/long-clock/results.json`. The completed analysis increment
also passed 206 distinct RealmForge browser cases, 66 Smith browser cases, seven
Smith static checks, current native acceptance for all four presets and six
compiled-export CPU checks with zero raw UI/RF source requests. See the
[analysis acceptance results](realmforge-circuitlab-analysis-plan.md#independent-acceptance-vectors)
for current receipts and desktop/narrow Scope evidence, and the
[aggregate analysis receipt](../../artifacts/circuitlab/analysis-verification-20261001.json)
for source bindings. The initial 165-case and three-smoke board results remain
historical; the six compiled checks verify the later analysis increment.

Those receipts precede the Test Bench extension. Its implemented DC/tolerance
and isolated breaker contracts passed 81 source-browser checks. The repaired
build passed 11 compiled-export CPU checks. See the [current Test Bench evidence](realmforge-circuitlab-analysis-plan.md#detached-test-bench).
All four [source-native presets](../../tmp/circuitlab-bench-native/final-layout-r04/results.json)
passed with unchanged source hashes. The separate r02 full-OS preview
[retains its blocked boot receipt](../../tmp/circuitlab-bench-preview/acceptance-r02-20261001/results.json);
the repaired build passed all nine [actual compiled OS preview gates](../../tmp/circuitlab-bench-preview/acceptance-r06-layout-20261001/results.json). The
separate staged preview represents a fresh-origin development desktop; it
does not activate an installed release or synchronize an existing consumer.

Reproduce the focused and native board checks from the repository root:

```powershell
python tests/run_realmforge_procedural_build.py --suite electrical-core --suite electrical-devices --suite control-board --suite utilities --suite utilities-constraints --suite utilities-panel --suite circuit-board-editor --suite circuitlab --cpu-only --output tmp/circuitlab-verification
python tests/run_realmforge_procedural_build.py --suite electrical-panel-ui --cpu-only --timeout 600 --output tmp/circuitlab-house-panel-verification
python tests/run_realmforge_circuitlab_native.py --output tmp/circuitlab-native-verification
```
(Source: `tests/run_realmforge_circuitlab_native.py`;
`tests/realmforge/utility-workbench.fixture.js`.)

## See also

- [CircuitLab analysis and Smith Lab integration plan](realmforge-circuitlab-analysis-plan.md)
- [Electricity and control boards](realmforge-electricity.md)
- [RealmForge workbench](realmforge.md)
- [RealmForge improvement research](realmforge-improvement-research.md)
- [Building programs and utilities](realmforge-building-utilities.md)
