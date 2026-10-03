---
title: RealmForge Electricity and Control Boards
description: Generate household wiring and CircuitLab boards, edit contacts and components, probe solved values, and test thermal and magnetic breaker protection in RealmForge.
audience: asset authors and simulation developers
updated: 2026-10-01
---

<!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel> -->
<!-- SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha -->

# RealmForge Electricity and Control Boards

RealmForge can generate household wiring and standalone low-voltage control
boards as reusable construction assets. This guide explains their operating
controls, saved state, editable connections, and simulation limits.

## Build a wired house

Open **Build**, enter a description, inspect the interpreted requirements and
preview, then build the selected result. Examples of supported text are:

```text
an 8 x 10 metre timber cottage with electrical wiring
a house with 230 V 50 Hz wiring and 3 outlets per room
a 12 V motor control board with 20 rows and split rails
a 5 V relay breadboard with continuous rails
```

Requests for house electricity, outlets, wall plates, breakers or Ethernet
select the household wiring profile. Supported options are:

| Option | Accepted values | Default |
| --- | --- | --- |
| Nominal AC voltage | 120 or 230 V RMS | 120 V RMS |
| Frequency | 50 or 60 Hz | 60 Hz |
| Outlets per room | 1–4 | 2 |
| Ethernet ports per room | 0–2 | 1 |

RMS means root mean square, the effective voltage of the modeled AC waveform.
The 120 V profile uses two opposed supply phases and a 240 V line-to-line
measurement. The 230 V profile uses one supply phase. The values are explicit
simulation choices; they do not select a regional installation standard.
Saved legacy builds retain their original generator and service definitions.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeBuildIntent.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeBuildFamilies.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeHouseWiringCircuit.js`.)

The generated assembly contains an external supply entry, a service panel,
main disconnect, branch breakers, room switches, ceiling lamps, outlets with
wall plates, conductors and hollow raceways. Outlet and data faceplates have
actual openings and contact pieces. Device placement respects measured room
polygons, door and window openings, and existing furniture. Power and data
routes use separate lanes and checked service penetrations. If no supported
route or clear mounting position exists, generation reports the failure.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeHouseWiring.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeHouseWiringLayout.js`.)

The existing house family supports one through five floors. Wiring accepts
at most 20 measured architectural rooms and follows their actual level heights.
Multi-storey houses still need space for the stair hall: the minimum width is
7 m for a studio layout, 8 m for one bedroom, or 9 m for two bedrooms, with a
minimum depth of 8 m. These bounds do not guarantee that every furnished or
serviced combination will fit. Apartment, hotel and business-specific wiring
layouts are not separate presets in this implementation.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeBuildFamilies.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeHouseWiringLayout.js`.)

## Operate electricity and data

Select **Utilities** in the Modeler workbench after building a wired house or
control board. Houses with ceiling lighting or the protected wiring profile measure a short initial supply sample
when entering **Simulate**. A restored electrical checkpoint retains its measured
power without advancing time. Utilities can remain closed while the lights operate.
Houses with the new
ceiling-lighting assemblies retain the active Mesh or SDF renderer; other
circuits use Mesh for local lamp illumination and measured motor poses.

1. Press **Run** for continuous circuit steps, **Pause** to stop, or **Step**
   for one fixed engine tick.
2. Change a switch to run a short measurement sample. The panel displays
   instantaneous voltage, power and breaker current where available.
3. In a house, use **Main disconnect** or the individual room light controls.
   New protected builds also provide **Circuit breaker box** with a separate
   Off/On control for every branch. This disconnects its outlets, lamps and
   attached appliance loads together. A room light switch controls only
   the lighting path.
   The optional room **overload test** enables an explicit load to exercise
   the modeled breaker. Turn that load off before using the breaker’s
   **Reset breaker** button. Protected builds require the main or branch handle
   to be Off and the native protection state to permit a reset. Reset leaves
   the handle Off; turning On alone never clears a trip.
4. Change an Ethernet patch checkbox to connect or disconnect that saved
   passive link.
5. Press **Save state** to commit the current operating state and close the
   panel. For ceiling-lighting or protected-wiring houses, **Hide** keeps electricity active and
   **Discard changes** restores the captured state. Other circuits use **Close**
   to discard unsaved operating changes and restore the captured state.

Save state creates one guarded Undo entry containing the circuit checkpoint,
switch values and data patch state. Motor position, velocity and electrical
state belong to that checkpoint. Measured lamp brightness history is also
saved, so reopening does not need an extra solver tick to light a saved-on lamp.
Save/reopen restores the checkpoint only
when it matches the exact circuit and owning assembly. Undo reverses the
state save; it does not delete the generated house. Account changes, stale
document heads and cancellation cannot redirect the save to another asset.
Read-only documents permit transient measurements but cannot save state or
edit board wiring.
(Sources: `webgpu-os/apps/realmforge/modeler/electrical/RealmForgeUtilityRuntime.js`;
`webgpu-os/apps/realmforge/modeler/electrical/ui/RealmForgeUtilitiesPanel.js`;
`webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`.)

## Three-way switches and wall dimmers

Generate a new house using a description such as:

```text
a cabin with recessed ceiling lights, three-way switches and wall dimmers
a cottage with three-way toggle switches, wall dimmers and initial brightness 50%
```

**Build → House additions → Ceiling lighting** also provides switch operation,
dimming and initial brightness controls. Three-way and dimmer options use
`lighting.schemaVersion:2`. Current protected wiring uses generator `7.0.0`;
stored wiring-schema-1 definitions retain generators `5.0.0` or `6.0.0` and
their original assemblies. Opening a saved house does not add hardware.

Each three-way circuit has two independently controlled SPDT switches, two
separate copper travelers, a common supply terminal and a switched lamp terminal.
Both switches selecting the same traveler powers the lamps, including when both
are down. Moving either switch changes that path. Outlets remain upstream of the
lighting controls. Main and room breakers still interrupt their respective loads.
The two-traveler topology follows the
[Leviton three-way wiring diagram](https://leviton.com/content/dam/leviton/residential/product_documents/instruction_sheet/RESI_DSL06_Instruction-Sheet_English.pdf).

In **Simulate**, aim at the visible switch or dimmer. Click, press **Space** or
**Enter**, or use its displayed **Toggle** button. The wheel and up/down arrow
keys select switch position or adjust dimmer brightness. **Alt + wheel** keeps
camera zoom. A nearby wall or other visible object blocks operation through it.
The Utilities panel provides the same buttons and a keyboard-accessible percentage
slider. Each new control saves a validated `realmforge.utility-control` action
binding with its actual part IDs. These are registered actions, not arbitrary
JavaScript execution or a new custom-script editor.

The house uses one dimmer per room lighting circuit, consistent with the ordinary
mechanical three-way topology in the
[Lutron wiring instructions](https://assets.lutron.com/a/documents/0301870.pdf).
Brightness from 0–100% controls a calibrated resistive equivalent in the existing
electrical solver. Measured lamp power drives illumination and diffuser emission;
the slider follows the same numeric value. This is an averaged load model, rather
than a phase-cut TRIAC waveform or a dimmer product's real heat rating. Numeric
settings and both switch positions persist in the existing guarded checkpoint.
Explicit **Save state** creates one Undo entry. **Hide** keeps the current transient
lighting active; **Discard changes** restores the captured controls. Leaving
the workspace without saving releases the preview owner.

Sources: `construction/RealmForgeLightingOptions.js`,
`construction/RealmForgeHouseWiringCircuit.js`,
`construction/RealmForgeHouseWiring.js`,
`modeler/electrical/RealmForgeUtilityRuntime.js`,
`modeler/electrical/ui/RealmForgeUtilitiesPanel.js`,
`modeler/viewport/ModelerViewport.js`, `modeler/ui/ModelerPanel.js` within
`webgpu-os/apps/realmforge/`; `engine/sim/electrical/ElectricalRuntime.js`.

## Protected breaker panel and conductors

New text requests for household electricity select `wiring.schemaVersion:2`.
The panel has a fixed protective front with openings for the main and branch
handles, covered incoming terminals, and up to 20 measured branch positions.
In **Simulate**, aim at a handle and click or use the wheel to select Off/On.
The same registered utility action operates the corresponding panel button.
On, Off and Tripped are distinct states. Main Off disconnects the downstream
house buses; the incoming service remains energized behind its fixed cover.
This distinction follows [Eaton's panel barrier guidance](https://www.eaton.com/content/dam/eaton/markets/for-safety-sake/files/time-to-meet-and-exceed-nec-408-3-panelboard-safety-requirements.pdf).
The explicit Off-before-reset interaction follows the household breaker states
described by [Schneider Electric](https://www.se.com/us/en/faqs/FA353467/).

Each protected route contains actual copper cores, separate annular polymer
insulation around each core, and an enclosing hollow PVC raceway. The raceway
provides the external protective layer; it is not an NM-B cable product model.
Legacy routes already had raceways, but did not have individual conductor
insulation. The new profile separates the larger service-feed conductor
dimensions from the room-branch dimensions. Geometry validation checks actual
paths, nesting and fit. Separate insulation and outer protection follow the
construction described in [Southwire's conductor specifications](https://www.southwire.com/wire-cable/building-wire/thhn-thwn-copper-silicone-free/p/22973285).

The protected circuit includes service-line resistance and one shared neutral
resistance derived from the physical routes and copper cross sections. Balanced
phase loads cancel at that neutral; unbalanced loads produce measured neutral
current and resistive heating. This remains a lumped circuit model.

The two native main protection poles retain their actual thermal state. A logical
common-trip interlock opens both phase feeds when either pole trips, at the next
240 Hz utility step. This models a shared disconnect with a bounded one-step
delay; it does not simulate a breaker's internal mechanical linkage. The runtime
keeps overloads present, so a continuing overload can trip again after reset.

These are reviewed simulation profiles. Conductor ampacity under installation
conditions, arc faults, ground-fault interruption, enclosure certifications,
and jurisdiction-specific installation compliance are not simulated. Protective
earth remains a recorded bonded-continuity path. Ordinary overcurrent trips are
not presented as GFCI or AFCI protection.

Preparation checks the complete design against the existing 16 MiB limit for
each saved JSON resource. An oversized request reports the affected resource
before Ready or Apply; it does not remove parts or requested features.

Sources: `construction/RealmForgeBuildFamilies.js`,
`construction/RealmForgeHouseWiring.js`,
`construction/RealmForgeHouseWiringLayout.js`,
`construction/RealmForgeHouseWiringCircuit.js`,
`modeler/electrical/RealmForgeUtilityRuntime.js`,
`modeler/electrical/ui/RealmForgeUtilitiesPanel.js`,
`modeler/ui/ModelerPanel.js` within `webgpu-os/apps/realmforge/`.

Ethernet is a passive eight-contact connection model. Each link records its
patch-panel port, destination jack, route length, pin map and four conductor
pairs. Patch controls persist continuity state. There is no packet traffic,
switching protocol, cable certification or Power over Ethernet (PoE) model.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeHouseWiringLayout.js`;
`webgpu-os/apps/realmforge/modeler/electrical/RealmForgeUtilityRuntime.js`.)

## Build and edit a control board

Open **Object tools → CircuitLab** in RealmForge. A supported board opens its Board,
Nets and 3D assembly views. Otherwise, CircuitLab opens **Create board**. Choose
Lamp, Motor, Relay or Breaker, 5, 12 or 24 V DC, 10–30 rows, split or continuous
rails, and a saved generation seed. **Generate preview** prepares real construction
geometry in the existing viewport. **Insert reviewed board** adds it in one Undo
entry, retaining existing authored and generated content. Create board starts
with a 12 V lamp board, 20 rows and split rails; the text Build default remains
10 rows. Supplies are limited to 0.5 A. Metric
contact spacing is 0.00254 m. The text Build phrases **control board**,
**breadboard**, **breakout board** and **breakout box** still select this family.
(Sources: `webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`;
`webgpu-os/apps/realmforge/modeler/electronics/RealmForgeCircuitLabBoardCreator.js`.)

Each numbered row has two separate five-contact strips. The center gap keeps
left and right strips disconnected. Power rails are separate from those
strips and from the rails on the opposite side. Split rails divide after
the middle row; a jumper is needed to join their halves. Contact IDs such as
`L.e.9` and `rail.L.positive.3` identify actual breadboard contacts.
(Source: `webgpu-os/apps/realmforge/modeler/electronics/RealmForgeControlBoardAssemblies.js`.)

The lamp preset has a switched resistive load. The motor preset uses a fuse,
MOSFET driver, gate pull-down and flyback diode, coupled to the engine’s DC
motor and rotary-axis solver. Its shaft and asymmetric pointer follow the
measured angle while the motor case remains stationary. The relay preset
keeps its coil and switched load in separate electrical domains, both within
the low-voltage profile. Its coil also has a flyback path. The Breaker preset
has a power switch, protected lamp, and switchable fault load. Custom definitions
allow at most one DC supply in each connected electrical domain; series or
parallel sources in the same domain are rejected. All presets use
the existing engine electrical solver.
(Sources: `webgpu-os/apps/realmforge/modeler/electronics/RealmForgeControlBoardAssemblies.js`;
`webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`;
`engine/sim/electrical/ElectricalRuntime.js`.)

**Board** draws the actual strips, rails, contacts, components and jumpers.
**Select** links the selected circuit object to its generated RealmForge part.
Selection in the 3D viewport returns to the same inspector. **Wire** connects
two available holes; Escape cancels a pending endpoint. Arrow keys move contact
focus; Enter or Space chooses the focused contact. Delete removes a selected
jumper. **Contact list** retains the side, row and hole selectors and named
jumper removal buttons. Occupied contacts reject another pin or endpoint.

Search the component list to edit a supported component's parameters and pin
contacts. Changes remain drafts until Apply. **Nets** lists actual compiled net
membership, including jumper unions. Component selection shows draft pin nets
beside voltage, current and power from the accepted operating circuit. The
**3D assembly** tab narrows CircuitLab to reveal the permanent viewport. Changing
views retains the draft, selection and probes. Legacy boards have no complete
part-selection links; their first reviewed wiring edit upgrades the generated
board to the explicit version 2 profile. Loading an old board alone preserves
its original generator output.

Press **Validate and preview** to compile the complete circuit and inspect the
resulting board. An occupied contact, unsupported component, invalid net or
broken relay isolation prevents Apply. Circuit controls pause and lock while
the detached wiring preview is shown. Editing again clears that preview.
Press **Apply reviewed wiring** to replace the generated board in one Undo
entry. Its saved intent retains the custom definition. Unrelated authored
content remains; manual changes inside the generated board’s resource closure
block replacement. Changing the board retires checkpoints tied to its old
circuit and assembly. **More like this** and reusable parameter-pattern
extraction decline a custom board rather than discard its jumper definition;
continue those changes through the contact editor.
(Sources: `webgpu-os/apps/realmforge/modeler/electronics/RealmForgeControlBoardEditor.js`;
`webgpu-os/apps/realmforge/modeler/electronics/RealmForgeCircuitBoardView.js`;
`webgpu-os/apps/realmforge/modeler/electronics/RealmForgeCircuitLab.js`;
`webgpu-os/apps/realmforge/modeler/electronics/RealmForgeControlBoardEditing.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeConstructionDocumentTransaction.js`.)

## CircuitLab probes and protection

Use **Probe** on a component for voltage, or **Probe V**, **Probe A** and
**Probe W** in its accepted-value inspector. Instruments retains up to 12 named
traces and 512 observed engine ticks. Run and Step use the current utility
runtime; Step advances exactly one fixed engine tick, including its electrical
substeps. Each trace uses its own vertical scale. Select a captured sample with
the cursor to read its exact reported time, owner tick and values in the table.
**Follow latest** returns to the newest sample. Capture discloses the last
observed interval; electrical substeps are not individually recorded. Missing
component readings remain gaps. Closing the unsaved circuit restores its
captured operating checkpoint; **Save state** records accepted operating state.
(Sources: `webgpu-os/apps/realmforge/modeler/electronics/RealmForgeCircuitInstruments.js`;
`webgpu-os/apps/realmforge/modeler/electrical/ui/RealmForgeUtilitiesPanel.js`;
`webgpu-os/apps/realmforge/modeler/electrical/RealmForgeUtilityRuntime.js`.)

The protected DC preset authors a 0.15 A breaker with 0.4 A magnetic pickup,
0.01 A²·s thermal trip memory, a 2 s cooling time constant, and 0.05 Ω closed
contact resistance. Sustained excess current heats the thermal memory; a larger
overload trips sooner. Magnetic pickup trips at the configured current magnitude
without an intentional delay. Trips latch open. After tripping, set **Power**
Off and advance simulated cooling with Run or Step. Reset becomes available only
when the authored thermal and current thresholds permit it. Reset keeps Power
Off. An uncleared fault trips again when Power returns On. Current, contact
loss, thermal memory and the open/closed state come from the engine solver.

SPST switches and SPDT changeover switches support finite contact resistance;
SPDT true selects NO and false selects NC. These contact models do not simulate
mechanical bounce or arcing. Thermal cooling and magnetic pickup are opt-in
breaker parameters, so existing saved breakers retain their original behavior
and checkpoint shape. Trip decisions occur at the end of an electrical substep;
the next solve observes the open contact. The preset uses authored thresholds,
rather than a calibrated manufacturer's time-current curve.
(Sources: `engine/sim/electrical/ElectricalContracts.js`;
`engine/sim/electrical/ElectricalThermalProtection.js`;
`webgpu-os/apps/realmforge/modeler/electronics/RealmForgeControlBoardAssemblies.js`;
`webgpu-os/apps/realmforge/modeler/electrical/RealmForgeUtilityRuntime.js`.)

## Modeling boundaries

House circuits model shared supply poles, resistive lamps, explicit test loads,
switches and excess-current heating in breakers. Each room’s branch feed uses
one lumped loop resistance derived from route length and conductor area.
Socket taps are ideal connections to that branch; no appliance demand is
invented for an unused outlet. Protective earth continuity is recorded, but
earth-fault injection, residual-current devices (RCDs), arc faults, insulation
failure and regional compliance are outside this model. The generated values
and breaker curves do not certify a real installation.
(Source: `webgpu-os/apps/realmforge/construction/RealmForgeHouseWiringCircuit.js`.)

Local lamp lighting is driven by solved load power and has no shadow maps.
It is not a photometric lighting-design calculation. Board contacts and
components use simplified construction geometry; plugging pins into physical
spring contacts is not a native contact simulation. Board component values
are authored simulation examples, not validated replicas of specific products.
Household AC and breadboard DC are distinct typed interfaces. The current
board editor cannot connect household mains, Ethernet or PoE to its rails;
the relay preset does not grant a household connection.
(Sources: `webgpu-os/apps/realmforge/modeler/electrical/RealmForgeUtilityRuntime.js`;
`webgpu-os/apps/realmforge/modeler/electrical/ui/RealmForgeUtilitiesPanel.js`;
`webgpu-os/apps/realmforge/modeler/electronics/RealmForgeControlBoardAssemblies.js`.)

## Primary references

These references informed connection concepts. Their product specifications
are not the ratings of RealmForge’s authored example components.

- [Eaton load-center fundamentals](https://www.eaton.com/us/en-us/products/low-voltage-power-distribution-control-systems/loadcenters/load-center-fundamentals.html)
  describes service entry, branch protection, main disconnects and neutral/ground separation downstream.
- [Leviton residential networking](https://leviton.com/products/residential/networking)
  describes central structured-media enclosures, patching and room network outlets.
- [SparkFun’s breadboard anatomy guide](https://sparkfuneducation.com/how-to/how-to-use-a-breadboard.html)
  explains five-contact strips, the center gap, independent rails and split rails.
- [OMRON G5V-1 relay datasheet](https://omronfs.omron.com/en_US/ecb/products/pdf/en-g5v_1.pdf)
  documents separate coil and contact terminals and product-specific ratings.
- [Texas Instruments DRV8833 motor-driver documentation](https://www.ti.com/product/DRV8833)
  provides a primary reference for motor-driver bridges and winding-current control.
- [Belden RJ45 patch panels](https://www.belden.com/products/panels-patching-systems/rj45-patch-panels)
  illustrates the passive patch-panel role in structured cabling.

## See also

- [RealmForge workbench](realmforge.md)
- [WebGPU OS overview](overview.md)
