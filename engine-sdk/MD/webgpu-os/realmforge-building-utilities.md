---
title: RealmForge building programs and utilities
description: Versioned buildings, windows, lighting, heating, window cooling, ventilation, water and appliance connections.
updated: 2026-10-01
---

<!--
SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
-->

# RealmForge building programs and utilities

These modules extend generated houses with explicit units, operable windows and utility state. They describe bounded game assemblies and simulations. They do not certify a real building, electrical installation or plumbing design.

The source implementations and acceptance cases below are new. Runtime acceptance must use the current test receipt; a module being present is not evidence that its geometry, native articulation or UI has passed.

## Versioned building programs

`RealmForgeBuildingProgram.js` defines a `buildingProgram` modifier. `RealmForgeMultistoreyHouse.js` builds actual private entrance leaves, partition walls and a shared stair hall from it. The resulting metadata identifies buildings, floors, units, rooms, entrances and circulation edges separately. This follows the useful separation of spatial containers and physical elements in [buildingSMART's official building-storey model](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcBuildingStorey.htm). RealmForge does not claim IFC import, export or compliance from that correspondence.

| Program | Current bounded arrangement |
| --- | --- |
| Duplex | Two floors, one dwelling on each floor |
| Apartments | Two through five floors; one or two studio or one-bedroom units per floor |
| Hotel | Studio guest suites opening onto common internal access |
| Motel | Studio guest suites opening onto an exterior gallery; upper gallery guards |
| Business | Office suites with bathrooms and common access |

The shared hall reserves 2.7 metres of the building width. Suite dimensions are checked after subtracting this space. Two suites per floor use front and rear landing entrances. The current service envelope allows at most 20 private rooms. Larger requests fail with a capacity explanation; the compiler must not discard units or rooms.

With household wiring enabled, each floor also has two measured common landing zones outside the stairwell opening. Each zone owns a real branch breaker, switched lamp, requested outlets and passive Ethernet jacks. The building panel is placed in shared access. Gallery devices avoid the absent exterior wall. The wiring budget counts both private rooms and these shared zones, with a maximum of 20 spaces and the existing coupled circuit solver limit; a larger complete request is rejected rather than losing common services.

Serviced motels derive their raised entry steps from the actual common gallery floor edge. Their metadata identifies that circulation surface without inventing a front door. New building programs also retain a final structural graph whose explicit anchors reference real foundation products, including added crawlspace supports. Its result remains `not-run`; the presence of those anchors does not establish whole-building native simulation readiness or engineering capacity.

This is a narrow first set of commercial and multi-unit arrangements. It does not supply arbitrary towers, mixed retail occupancies, elevators, fire engineering or hotel back-of-house programs.

Example modifier:

```json
{
  "buildingProgram": {
    "schemaVersion": 1,
    "kind": "apartments",
    "unitsPerFloor": 2,
    "unitLayout": "studio"
  },
  "floorCount": 2
}
```

Sources: `webgpu-os/apps/realmforge/construction/RealmForgeBuildingProgram.js`, `RealmForgeMultistoreyHouse.js`, `RealmForgeMultilevelHouseServices.js`.

## Window shape, glazing and operation

The window modifier separates shape, operation and glazing. The [U.S. Department of Energy's window overview](https://www.energy.gov/energysaver/window-types-and-technologies) distinguishes these same design choices: a casement hinges at a side, an awning hinges at the top, and a sliding sash translates. These references inform the mechanism axes; they do not establish weather resistance, energy ratings or certification for generated assets.

| Field | Accepted values |
| --- | --- |
| `shape` | `rectangular`, `arched`, `round` |
| `operation` | `fixed`, `casement`, `awning`, `sliding` |
| `glazing` | `clear`, `stained` |
| `skylights` | `0`, `1`, `2` |

Window dimensions still come from the measured facade openings. Sliding is currently rectangular only. Curved profiles use actual pane and sash geometry with opaque corner infills inside the rectangular rough opening. Stained glazing creates separate coloured glass panes. It does not claim wavelength-dependent transmission, coloured caustics or a historical lead-came manufacturing method.

Operable leaves use the existing version-two revolute or prismatic construction joints, hardware and latch controls. Their requested sweep is checked against authored obstacles. The shape's convex pieces preserve real frame holes during clearance checks. Native opening behavior requires the mechanism acceptance gate in addition to geometry validation.

The skylight composer cuts measured ceiling and roof solids and adds a curb, light shaft and separate glass cap. [VELUX's installation references](https://www.veluxusa.com/help/installation-help/skylight-installation) distinguish deck-mounted and curb-mounted systems; this supports treating the curb and roof opening as separate geometry. The generated version does not reproduce a rated product or complete flashing/weatherproofing system. Its structural result retains explicit review requirements after roof cuts.

Sources: `RealmForgeWindowOptions.js`, `RealmForgeWindowGeometry.js`, `RealmForgeHouseWindows.js`, `RealmForgeWindowClearance.js`, `RealmForgeGeneratedMechanisms.js`, under `webgpu-os/apps/realmforge/construction/`.

## Whole-house water

`RealmForgeHouseWater.js` derives a supply and drain graph from actual authored fixture ports and pipe routes. It requires one external cold inlet, one external hot inlet and one sewer outlet. The current supply topology is a tree. Disconnected routes, repeated endpoints, cycles, unowned fixture connections and incomplete control manifests are rejected.

The [EPA's EPANET documentation](https://www.epa.gov/water-research/epanet) describes pipe flow, nodal pressure, valves and storage as separate hydraulic state, and identifies Darcy–Weisbach as a supported head-loss formulation. RealmForge uses its own bounded tree solver with that formulation; it does not embed EPANET or claim equivalent model coverage. Pipe length and bore come from the generated routes. The constant smooth-pipe roughness, reference water properties and fixture conductance are declared simulation assumptions.

The runtime exposes main and branch isolation valves, tap openings and hot-water mixing fractions. A bounded iterative solve reports failure without advancing state if it cannot converge. Drain flow conserves discharged volume through the authored tree. It is not a free-surface sewer solver.

The external hot-water storage model has a configured volume, cold inlet temperature, setpoint and heater power. It integrates well-mixed replacement and heating with an analytic energy balance, reporting stored heat and discharged heat. It does not simulate stratification, trapped air, water hammer, pipe-wall heat transfer, contamination or sewer treatment. The tank is a supply boundary model, not a newly modeled physical tank appliance inside the building.

`RealmForgeWaterPanel` provides preview, play, pause, reset and an explicit save. Its `design.water-state` checkpoint preserves controls, thermal state and cumulative supplied/drained volume separately from the generated assembly. Checkpoints bind to the exact water-model fingerprint. Account, document and selected-assembly guards prevent stale saves. Closing a preview does not save it; reset restores the state at panel opening.

Sources: `construction/RealmForgeHouseWater.js`, `construction/RealmForgeHouseUtilityOptions.js`, `modeler/RealmForgeWaterRuntime.js`, `modeler/RealmForgeWaterPanel.js` within `webgpu-os/apps/realmforge/`.

## Decks, sliding patio doors and bathroom mirrors

Build from words and Explore share **House additions** controls. Keep the
settings on **From words / saved design**, or choose **Customize additions**.
Lighting, outdoor spaces, bathroom fixtures and door movement have separate
groups. Options appear when their feature is enabled; switching it off keeps
the draft values for later. Words remain explicit constraints: a conflicting side, dimension,
plumbing exclusion or named immutable recipe fails visibly.

For example:

> A 6 × 8 metre timber cabin with a deck, sliding patio door, bathroom mirrors, working taps and flushable toilets with a sewer outlet.

The `outdoor` modifier describes one uncovered ground-floor timber deck and/or
one sliding patio door. Its placement uses measured room polygons, actual
facade spans and reserved circulation. The shell reserves and cuts the patio
opening before generating wall framing and finishes. The compiler reports
windows replaced by this opening; a requested individual window override must
still identify an existing opening. The deck has footings, posts, beams,
joists, planks, requested guards and steps to its actual raised walking surface.
Ground-floor additions also work with ordinary houses containing two through
five floors. Covered decks, balconies, rooftop platforms and shared apartment,
hotel or motel additions require further reviewed construction definitions.

The patio door has fixed and moving glazed panels, rails, rollers, handles and
an independent lock. Its prismatic connection uses the same native interaction
and persistence path as other sliding objects. The measured panel must complete
its declared travel without crossing unrelated parts. The
[Andersen gliding patio-door parts catalog](https://www.andersenwindows.com/-/media/Project/AndersenCorporation/AndersenWindows/AndersenWindows/files/technical-docs/parts-catalog/partscatalog-patiodoors-2002-present--200series-narrolinegliding.pdf)
informed the separate hardware roles; generated geometry is not a certified
Andersen product.

Bathroom mirrors attach above actual generated sinks. Choose rectangular or
round glass and wood, aluminium or no frame. The compiler rejects an unfit
mirror rather than shrinking it. Round mirrors require equal width and height.
Mesh and SDF viewports render a single reflected scene pass using a reflected
camera and mirror-plane clipping. At most four visible mirrors receive a scene
reflection per frame; capacity and rendering errors remain visible in Runtime.
Reflections are presentation and do not modify the document.

These explicit additions select `realmforge.design.composition@3.0.0`, or the
version 3 building-program generator for supported bathroom/water modifiers.
Historical composition versions and saved definitions retain their original
output. Reusable definitions preserve the complete options and still require
their separate review receipt before Auto Known admission.

Sources: `construction/RealmForgeOutdoorOptions.js`,
`construction/RealmForgeHouseOutdoorLayout.js`,
`construction/RealmForgeHouseOutdoor.js`,
`construction/RealmForgeDeckAssembly.js`,
`construction/RealmForgeHouseMirrors.js`,
`modeler/viewport/RealmForgeMirrorViewportRenderer.js`,
`modeler/ui/RealmForgeHomeDesignControls.js` within
`webgpu-os/apps/realmforge/`.

## North American ceiling lights and wall switches

Build from words and Explore expose **Ceiling lighting** inside
**House additions**. Choose recessed downlights or flush-mounted ceiling
fixtures, decorator rockers or traditional toggles, 2700/3000/4000 K light colour,
fixture diameter and one through four lights per room. The existing household
circuit supplies 120 V at 60 Hz; incompatible explicit voltage or frequency
requests fail visibly.

For example:

> A 6 × 8 metre timber cabin with recessed ceiling lights and decorator wall switches.

> A cottage with two flush mount ceiling lights per room, toggle switches and 4000 K lighting.

Recessed fixtures have circular openings through actual ceiling boards, separate
hollow housings, trim, diffusers, junction boxes and supports. Placement uses
measured ceiling surfaces, clear framing bays and service routes. It preserves
structural members and the retained board's sourced mass. Flush-mounted lights
hang below the ceiling with their own box and support. A complete design that
cannot fit all requested fixtures is rejected; the generator cannot drop lights.
All room and shared-landing lamps count toward the 32-light capacity.

The [HALO recessed-light specification](https://www.assets.cooperlighting.com/is/content/CLS/halo-hlb6-module-specsheet)
distinguishes body, lens, trim, ceiling opening and remote driver dimensions.
The [HALO flush-mount fixture reference](https://www.cooperlighting.com/global/brands/halo/1027619/hlc6-led-6-round-surface-mount-luminaire)
distinguishes mounting to a ceiling junction box from a large recessed cutout.
These inform the separate parts; RealmForge uses custom dimensions and does not
claim a certified reproduction or insulation-contact rating.

Wall controls have a white single-gang plate, a separate moving rocker or toggle
and a box. The 69.85 × 114.30 mm standard plate follows the
[Leviton wallplate size guide](https://leviton.com/content/dam/leviton/commercial-industrial/product_documents/solution_sheets/Wallplate%20Size%20Guide%20-%20Q-1289.pdf).
Room lamps are parallel loads downstream of the room's hot-side switch. Neutral
returns independently; opening the light switch leaves the room outlets
energized. Main isolation and branch protection use the same coupled circuit.
The existing resistor-load model reports electrical power; it does not simulate
a particular LED driver's waveform. Existing conductor dimensions remain metric
and are not relabeled as an AWG or installation-code specification.

Entering **Simulate** takes one short initial measurement for new ceiling-lighting
circuits. Click the moving rocker or toggle on the wall, or use its button,
mouse wheel or keyboard controls; a gesture samples the same electrical clock.
**Utilities → Run** continues measurements. Utilities
groups switches and measured lamp loads by room, with the main disconnect at
the top. **Circuit measurements & overload tests** contains detailed readings
and breaker resets. **Ethernet patch panel** holds passive port continuity.
Numeric readings update without replacing controls or moving keyboard focus. Build
previews do not run electricity. Saved checkpoints retain measured lamp state
without an extra tick when reopened.
Switch pose, diffuser glow and downward local lighting
follow that one runtime in Mesh and SDF. Local lights do not add a shadow-map or
global-illumination solver. **Save state** records the existing guarded utility
checkpoint; switching by itself does not edit the design or add an Undo entry.
Reopening a saved checkpoint restores controls and measured lamp state without
inventing new circuit time.

Stored `wiring.schemaVersion:1` with explicit `lighting.schemaVersion:1` selects
`realmforge.design.composition@5.0.0` or
`realmforge.building.program@5.0.0`. Reusable definitions retain complete lighting
options and dependency versions, with the existing separate review receipt.
Previous generator versions keep their original output. Generate a new design
to add these fixtures; opening an older asset does not retrofit it.
Stored wiring-schema-1 definitions with `lighting.schemaVersion:2` select generator `6.0.0` for real two-traveler
three-way circuits and separate wall dimmers. **House additions** provides
switch operation, dimming and initial brightness controls. These registered
button actions, numeric persistence and the calibrated electrical dimmer model
are described in [Electricity and control boards](realmforge-electricity.md#three-way-switches-and-wall-dimmers).
Current wired requests use `wiring.schemaVersion:2` and generator `7.0.0`,
which add a covered breaker panel, manual main/branch controls and individual
conductor insulation inside protective raceways. In Simulate, its visible panel
handles use the same click, wheel and keyboard controls as the wall switches.
See [Protected breaker panel and conductors](realmforge-electricity.md#protected-breaker-panel-and-conductors).
Chandeliers and emergency-lighting designs require further reviewed definitions.

Sources: `construction/RealmForgeLightingOptions.js`,
`construction/RealmForgeCeilingLighting.js`,
`construction/RealmForgeHouseWiring.js`,
`construction/RealmForgeHouseWiringCircuit.js`,
`modeler/electrical/RealmForgeUtilityRuntime.js`,
`modeler/electrical/ui/RealmForgeUtilitiesPanel.js`,
`modeler/ui/RealmForgeHomeDesignControls.js`,
`modeler/ui/ModelerPanel.js`,
`modeler/viewport/ModelerViewport.js`,
`modeler/viewport/RealmForgeSDFViewportRenderer.js` within
`webgpu-os/apps/realmforge/`.

## Heating, window cooling and bathroom ventilation

Build from words and Explore share **Heating, cooling & ventilation** in
**House additions**. Enable electric baseboards, electric radiators or recessed
underfloor heating, window air conditioners, and bathroom exhaust fans.
Set the equipment power, thermostat, humidity target and window AC count.
The preview shows these resolved settings and each room's circuit allocation.

For example:

> An 8 × 10 metre timber cabin with baseboard heaters, a window air conditioner, bathroom exhaust fans and thermostat 24 celsius.

> A cabin with 250 watts underfloor heating.

`climate.schemaVersion:1` opts into `realmforge.design.composition@8.0.0`, or
the version 8 building-program generator. Historical versions do not acquire
equipment when reopened. Complete climate settings and pinned dependencies
travel with reusable definitions through the existing review contract.
Unsupported boilers, hydronic radiators, gas furnaces, central ducted HVAC,
conflicting requirements and equipment that cannot fit remain visible errors.

Each requested room heater has physical parts and a control knob. Baseboard
placement reserves space around and in front of the case, preserves door
sweeps, and excludes electrical outlets above it. The
[Cadet baseboard installation manual](https://www.cadet.glendimplexamericas.com/sites/g/files/emiian441/files/downloads/13465_Owners_Manual_1.pdf)
informs those clearance roles. Radiators contain hollow metal sections but use
electric heat in this version. Underfloor mats occupy measured 2.5 mm underside
pockets in retained floorboards, with insulated heating traces. The remaining
board solids keep their cited source density and reduced mass. Mat coverage
must accommodate the requested power at the declared 200 W/m² design limit;
the compiler cannot shrink the requested load or overlap existing services.
This is a custom game assembly, without a certified floor-temperature analysis.

Window AC requires a clear rectangular single-hung or double-hung opening.
The composer adds a case, coil, compressor, support brackets, side seals and
sash retention. The occupied sash retains its stable part IDs and is fixed
around the installation. Other windows remain operable. Explicit incompatible
windows or screens are rejected. The
[GE window installation reference](https://products.geappliances.com/appliance/gea-support-search-content?contentId=39294)
informs the mounting, seal and retention roles; dimensions describe a custom
RealmForge unit rather than a reproduction of a rated product.

Each actual bathroom receives an exhaust fan with rotating blades, a hollow
duct through measured exterior wall cuts, an outdoor hood and a damper.
The flow is selected from the requested minimum and measured room area.
[HVI's bathroom exhaust guidance](https://www.hvi.org/resources/publications/bathroom-exhaust-fans/)
supports exhausting outdoors, a 50 CFM minimum for small rooms and approximately
one CFM per square foot for rooms up to 100 square feet. RealmForge records
the selected flow in metric units and rejects its bounded capacity overruns.
A fan exchanges humid indoor air with outdoor air; it is distinct from a
refrigerant dehumidifier and cannot dry a room below the incoming air's moisture
content by ventilation alone.

All equipment connects to distinct actual 120 V, 60 Hz outlets and the existing
protected room circuits. Default heaters use 750 W per room; the default AC
uses 650 W of electrical power. Climate and installed lighting must fit within
the declared 80% continuous allocation of the actual 15 A branch and each actual
main supply pole. The preview exposes both allocations. Higher explicit loads
fail before commit. Other switched appliances share that branch and can
trip its real simulated breaker. Turning the main or branch off, tripping it,
unplugging a device or turning its power off stops its effect.

In **Simulate**, use **Utilities** for room temperature, relative humidity,
thermostats, humidity targets and Off / Auto / On modes. Aim at the equipment
knob and use click, wheel or the universal object-action key bindings.
Thermostat wheel adjustment uses degrees Celsius; it does not change the camera.
Alt + wheel retains zoom. Fan and damper presentation follows actual power.
**Save state** stores the same guarded utility checkpoint with room heat and
moisture, targets and modes. Ordinary controls do not add Undo entries.

The room model uses authored envelope conductance and thermal mass. It accounts
for solved electrical energy from every committed circuit substep, cooling,
outdoor heat exchange, water vapour, removed condensate and surface condensation.
It reports heat and moisture balance residuals. It does not solve room airflow,
duct pressure, refrigerant cycles or occupant comfort. Outdoor air is an
explicit boundary; a connected whole-house makeup-air network is not modeled.
Saved state is bound to the exact assembly, account and electrical clock.
Failed circuit or climate advancement rolls back the whole batch.

Sources: `construction/RealmForgeClimateOptions.js`,
`construction/RealmForgeHouseClimate.js`,
`construction/RealmForgeAppliancePower.js`,
`modeler/climate/RealmForgeHouseClimateRuntime.js`,
`modeler/climate/RealmForgeClimateControls.js`,
`modeler/electrical/RealmForgeUtilityRuntime.js`,
`modeler/electrical/ui/RealmForgeUtilitiesPanel.js`,
`modeler/ui/RealmForgeHomeDesignControls.js` and
`modeler/viewport/ModelerViewport.js` within `webgpu-os/apps/realmforge/`.

## Door stops and piston closers

Build from words and Explore expose **Door movement** inside
**House additions**. Choose exterior doors or all compatible hinged house
doors, enable floor stops and/or automatic piston closers, and adjust opening
angle, spring preload, closing damping and final latch damping.

For example:

> A cabin with floor door stops at 85 degrees and automatic door closers.

A stop has a floor plate, post and rubber bumper placed against the actual
door's swing. Its angle also sets the native hinge limit. A closer has connected
jamb and leaf brackets, a hollow cylinder and a telescoping rod. Both rendered
pieces follow the same measured native door pose in Mesh and SDF. Closing uses
spring preload and extension with viscous damping. The last 15 degrees use a
separate latch setting; opening backcheck increases damping near the opening
limit. Backcheck cushions opening; the stop limits travel. This separation follows
the [LCN closer adjustment guide](https://kc.allegion.com/kb/article/how-do-you-adjust-a-door-closer/).
The exposed tube and rod follow the
[Wright tubular closer design](https://wrightproducts.com/products/light-duty-pneumatic-closer/v821awh).

In **Simulate**, open the door with its existing handle and door controls, then
release it. The native physics clock returns the door and engages its existing
latch. Manual opening retains spring resistance. An obstruction can stall the
return; the closer cannot teleport the door through it. Explicit Pause or panel
suspension stops the closer clock. Play or another manual operation can resume
it. Closing does not change the asset or add an Undo entry. Pause before saving
operating state: the existing mechanism checkpoint rejects an unsettled active
closer and preserves paused coordinates and lock state.

The force helper reuses the engine spring/damper and bounded-effort mathematics
used by the WebGPU OS Pinball plunger and flippers. Native physics remains the
single motion owner; no independent piston animation moves the door. The
Pinball renderer's measured-state approach informs the tube and rod presentation.

Explicit `doorControl.schemaVersion:1` selects
`realmforge.design.composition@4.0.0`, or
`realmforge.building.program@4.0.0`. Previous generator versions and saved
definitions retain their original output. Generate a new design to add this
hardware; opening an older asset does not silently retrofit it. Definitions
retain the complete settings and require their existing separate review receipt
before Auto Known admission. Requests for unsupported sliding-door or cabinet
closer mounts fail visibly.

This is a bounded tubular spring and damper model. It does not simulate internal
air or hydraulic flow, rubber deformation, a concealed rack-and-pinion closer,
or certified door forces and fire-door ratings.

Sources: `construction/RealmForgeDoorControlOptions.js`,
`construction/RealmForgeDoorControl.js`,
`construction/runtime/ConstructionDoorHardwareRuntime.js`,
`construction/runtime/RealmForgeConstructionPresetPhysics.js`,
`modeler/ui/RealmForgeHomeDesignControls.js` within
`webgpu-os/apps/realmforge/`; `engine/core/math/ConstraintMath.js`;
`webgpu-os/factory/apps/pinball/render/TableRenderer3D.js`.

## Working fixture streams and toilet flushing

Explicit working taps, sinks or flushable toilets use `waterSystem.schemaVersion:2`.
Their controls bind to the generated lever, shower mixer or flush button and
their streams use actual fixture outlet and waste locations. **Water** provides
tap opening, hot/cold mixing, supply and branch isolation, sewer availability,
and a **Flush** button for each toilet. A toilet has a finite 6 litre cistern
and a 4.8 litre discharge over three seconds, followed by a pressure-driven
refill. These are authored gameplay design values. They do not claim a product
rating or simulate the bowl siphon and its free surface.

In **Simulate**, clicking the actual faucet lever or shower mixer toggles that
fixture, and clicking the toilet's flush button starts one flush. The pointer
handler resolves the authored control part before attempting a physics grab.
Build selection and the hierarchy remain selection actions. Operating a fixture
starts local Water playback; saving its state remains explicit.

A blocked sewer refuses the flush. An unavailable supply prevents refill.
Repeated request IDs cannot duplicate a flush, and an active flush cannot be
stacked. Pausing and explicitly saving preserves cistern contents, pending
flush phase, thermal state and cumulative supply/drain volumes. Reopening
restores that checkpoint only against the same model fingerprint. This finite
discharge/refill distinction follows the
[Kohler tank operating guide](https://resources.kohler.com/onlinecatalog/pdf/1013091_5.pdf).
The house retains its actual water entries, hollow pipe routes and external
sewer outlet. It does not connect to the SPH playground.

Sources: `construction/RealmForgeHouseWater.js`,
`modeler/RealmForgeWaterRuntime.js`, `modeler/RealmForgeWaterPanel.js`,
`modeler/RealmForgeWaterFlowPresentation.js` within `webgpu-os/apps/realmforge/`.

## Generated appliance connections

`RealmForgeAppliancePower.js` finds existing appliance electrical inlets in generated room contents and assigns each one a distinct actual outlet in the same room. Missing appliances and insufficient outlets produce explicit errors. No additional appliances or sockets are invented to make a request succeed.

Each binding adds real plug and power switches plus its authored resistive design load to the same household circuit as the panel and branch breakers. Current, power and overload effects therefore come from the existing electrical engine. Fixture wattages are game-design assumptions, not manufacturer ratings. Refrigeration cycles, cooker thermostats, starting current and physical cord dynamics are outside this resistor-load contract.

Sources: `construction/RealmForgeAppliancePower.js`, `construction/RealmForgeHouseWiring.js`, `construction/RealmForgeHouseWiringCircuit.js` within `webgpu-os/apps/realmforge/`.

## Verification scope

The dedicated `tests/realmforge/building-utilities-expansion.test.js` suite checks unit and entrance ownership, real program compilation, water topology and conservation, isolation valves, thermal storage, checkpoint guards, shape mesh volumes, stained panes, requested window travel, skylight cuts and actual appliance solver power. These checks complement existing household wiring, generated mechanisms, construction transaction and legacy fingerprint suites.

Climate verification is separate: `climate-build.test.js` checks local and Echo
requirements, actual mount geometry, service openings, underfloor support and
clearance, electrical allocation, immutable definitions and guarded projection.
`house-climate-runtime.test.js` checks solved substep energy, thermostat and
humidity control, breaker shutdown, heat and moisture conservation, checkpoint
restoration and failed-step rollback. `climate-workbench.test.js` builds and
applies the same prepared house in the native viewport, starts its existing
Simulate owner and operates the rendered thermostat with the wheel. These
receipts do not establish every supported building combination or sustained
performance at the largest building size.

A CPU geometry pass alone does not establish native hinge motion, water-particle viewport presentation, save/reopen UI behavior or performance at the largest supported building. Keep those receipts separate, identify their exact source revision, and preserve failed results when making corrections.

## See also

- [RealmForge workbench](realmforge.md)
- [RealmForge improvement research](realmforge-improvement-research.md)
- [Object actions and animation](realmforge-object-actions.md)
