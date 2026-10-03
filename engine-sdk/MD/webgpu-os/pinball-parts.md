---
title: Modular Pinball Parts
description: How engine contributors and table authors define reusable pinball parts, register aliases, and assemble a table without coupling mechanisms to one layout.
audience: engine contributors and table authors
updated: 2026-07-17
---

# Modular Pinball Parts

The pinball parts system turns each physical mechanism into a reusable, immutable part definition. This guide is for engine contributors who build parts and table authors who assemble those parts into a machine.

Use one implementation for each reusable part type. Create left, right, upper, or themed variants as independent instances in a table definition. Do not duplicate the implementation into folders such as `left-flipper/` and `right-flipper/`.

## Use canonical pinball names

Canonical names keep table definitions, editor tools, events, saves, and mods interoperable. Compatibility aliases accept familiar informal terms, but new code should use the canonical type.

| Informal term | Canonical part | Meaning |
| --- | --- | --- |
| flapper | `gate` | The current machine uses a spring-return one-way gate. A future route-selecting mechanism should use a separate `diverter` type. |
| twanger | `slingshot` | The compatibility alias resolves to the current switch, coil, and rubber slingshot package. |
| sensor | `sensor` | A switch-like input that reports contact, occupancy, position, or passage. |
| bouncer | `pop-bumper` | A pop bumper applies an active kick. Passive restitution remains a collider-surface property. |
| launcher | `plunger` | A manual, automatic, or combined ball-launch mechanism. |
| door | `door` | A powered lock or routing barrier. Use `gate` for a passive one-way flap. |
| drain | `sensor` and `trough` | A sensor detects the crossing. The trough owns ball inventory and serving. The `drain` alias resolves to the trough assembly. |
| flipper | `flipper` | The player-controlled bat and its mechanical state. |
| target | `standup-target` | A scoring target with a dedicated switch contract. |
| drop target | `drop-target` | A rectangular switch-backed target that moves below the playfield and resets through a coil. |
| target bank | `drop-target-bank` | A logical reference group for independent drop-target IDs and a shared reset coil. |
| spinner | `spinner` | A freely rotating metal blade that reports one switch pulse per revolution. |
| light | `insert` | An addressable playfield lamp or guidance insert. |

The public parts index keeps a narrow compatibility layer:

| Compatibility name | Canonical name |
| --- | --- |
| `createFlapperPart` | `createGatePart` |
| `createTwangerPart` | `createSlingshotPart` |
| `flapper`, `pinball.flapper` | `pinball.gate` |
| `twanger`, `pinball.twanger` | `pinball.slingshot` |
| `launcher`, `pinball.launcher` | `pinball.plunger` |
| `bumper`, `pinball.bumper` | `pinball.pop-bumper` |
| `target`, `pinball.target` | `pinball.standup-target` |
| `drop-target` | `pinball.drop-target` |
| `drop-bank` | `pinball.drop-target-bank` |
| `spinner` | `pinball.spinner` |
| `drain`, `pinball.drain` | `pinball.trough` |
| `light`, `lamp` | `pinball.insert` |

`pinball.sensor` remains canonical. The `twanger` alias resolves to `pinball.slingshot` for compatibility, even though authors may use the word for other mechanisms. New table definitions should state the intended canonical type. (Source: `webgpu-os/factory/apps/pinball/core/parts/index.js`.)

## Architecture and dependencies

The modular path has four stages:

```text
Reusable factory
  -> definePinballPart()
  -> PinballPartRegistry
  -> independent table part instances
  -> assemblePinballTable()
       |-> canonical parts, partsByType, and partManifest
       `-> compatibility segments, circles, flippers, shots, and zones
  -> instantiatePinballTableRuntime()
       `-> mutable solver records owned by their source parts
```

`definePinballPart()` owns the immutable authoring contract. `PinballPartRegistry` resolves canonical types and aliases to factories. A table creates independent instances through those factories. `assemblePinballTable()` validates and combines the instances into one frozen table contract. `instantiatePinballTableRuntime()` creates the mutable solver records, retaining a `partId` link to the authored owner. (Sources: `webgpu-os/factory/apps/pinball/core/parts/shared/PartDefinition.js`, `webgpu-os/factory/apps/pinball/core/parts/registry/PinballPartRegistry.js`, `webgpu-os/factory/apps/pinball/core/parts/assembly/PinballTableAssembler.js`, `webgpu-os/factory/apps/pinball/core/parts/assembly/PinballTableRuntime.js`.)

The Dimensional Foundry table is an assembly root, not a mechanism implementation. It supplies table metadata, ordered part instances, and the playfield-level compatibility settings required by the current simulator. (Source: `webgpu-os/factory/apps/pinball/core/tables/dimensional-foundry/index.js`.)

## Target folder contract

Keep shared contracts, registry behavior, assembly, reusable parts, and authored tables in separate folders:

```text
webgpu-os/factory/apps/pinball/core/
  parts/
    shared/
      PartDefinition.js
      PartFactoryValues.js
      PartGeometry.js
    registry/
      PinballPartRegistry.js
    assembly/
      PinballTableAssembler.js
      PinballTableRuntime.js
    backbox/
    ball/
    cabinet/
    coil/
      ElectromechanicalActuator.js
    display/
    door/
    drop-target/
    drop-target-bank/
    flipper/
    gate/
    gravity-well/
    insert/
    playfield/
    plunger/
    pop-bumper/
    rail/
    ramp/
    sensor/
    shot/
    slingshot/
    spinner/
    standup-target/
    switch/
    trough/
    wall/
    index.js
  tables/
    dimensional-foundry/
      backbox.js
      cabinet.js
      constants.js
      devices.js
      dimension-routes.js
      index.js
      lower-playfield.js
      machine.js
      objectives.js
      progression.js
      shooter-lane.js
```

Each reusable part folder exposes its public factory through `index.js`. The `coil` and `switch` folders are reusable electromechanical subcomponents used by mechanisms; the other folders define complete semantic parts. Slingshots compose a leaf switch and kick coil, pop bumpers compose a skirt switch and kick coil, targets compose a hit switch and optional powered-assist or reset coil, flippers compose a power coil and end-of-stroke switch, and the trough composes entry and serve switches with an eject coil. A complex part may split physics, visuals, mechanics, wiring, or runtime support into focused sibling modules. Other subsystems should import the folder's public entry rather than its internal files.

The shared definition accepts these concerns without forcing them into the table layout:

| Field | Purpose |
| --- | --- |
| `id` | Stable instance identity using lowercase words separated by underscores. |
| `type` | Canonical reusable type in the `pinball.part-name` form. |
| `version` | Positive schema version. The default is `1`. |
| `aliases` | Additional names attached to the part definition. |
| `physics` | Collision and physical parameters. |
| `visual` | Render-facing description. |
| `mechanics` | Moving or actuated mechanism data. |
| `wiring` | Connections between sensors, coils, lights, and controllers. |
| `runtime` | Initial runtime state. |
| `legacy` | Temporary records for established simulation and rendering collections. |
| `metadata` | Authoring information that does not belong to the other concerns. |

`definePinballPart()` validates the `pinball.*` type and stable instance ID, requires every standard facet, checks identity parity, rejects cyclic or non-finite authoring data, normalizes identity and aliases, and freezes the resulting authoring data. This validation runs before editor or mod data can enter an assembly. (Source: `webgpu-os/factory/apps/pinball/core/parts/shared/PartDefinition.js`.)

## Add a reusable part

Follow these steps to add a reusable part type:

1. Create `core/parts/<canonical-name>/`.
2. Export a factory that calls `definePinballPart()`.
3. Keep instance-specific position, wiring, visuals, and tuning in factory options.
4. Register the canonical `pinball.*` type with `PinballPartRegistry.register()`.
5. Add only deliberate compatibility aliases.
6. Re-export the public factory from `core/parts/index.js`.
7. Create table instances through `registry.create()`.

This spinner instance demonstrates the public contract:

```javascript
import {
    createSpinnerPart,
} from '../../parts/index.js';

const orbitSpinner = createSpinnerPart({
    id: 'spinner_orbit',
    physics: {
        center: [302, 302],
        laneDirection: [0, -1],
        width: 22,
    },
    visual: { width: 22, height: 19, thickness: 1.8 },
    mechanics: { pulsesPerRevolution: 1, score: 300 },
});
```

`register(type, factory, { aliases, description })` rejects duplicate types and aliases. `create(typeOrAlias, options)` resolves the requested name, runs the factory, validates the result, and requires the factory to return the registered canonical type. (Source: `webgpu-os/factory/apps/pinball/core/parts/registry/PinballPartRegistry.js`.)

## Assemble a table

The table definition owns instance order. Keep that order intentional because the compatibility compiler preserves it.

```javascript
import { assemblePinballTable } from '../../parts/index.js';

const table = assemblePinballTable({
    id: 'example_table',
    version: 1,
    parts: [orbitSpinner],
    legacy: {
        width: 360,
        height: 740,
        ballRadius: 9,
        playfield: {},
        spawn: {},
        drain: {},
        ballSearch: {},
        shooterLane: {},
    },
    metadata: {
        title: 'Example Table',
    },
});
```

This example satisfies the assembly API. A playable table supplies the complete playfield, spawn, drain, ball-search, and shooter-lane settings expected by its simulation. The production Dimensional Foundry assembly lives in `webgpu-os/factory/apps/pinball/core/tables/dimensional-foundry/index.js`.

`assemblePinballTable()` requires a nonempty part list and unique part IDs. It returns a frozen `pinball.table` value with `parts`, `partsByType`, `partManifest`, `assemblyReport`, and compatibility collections. Use `partsByType` or the exported `partsOfType()` helper when new code needs semantic parts. (Source: `webgpu-os/factory/apps/pinball/core/parts/assembly/PinballTableAssembler.js`.)

## Understand the compatibility compiler

The compatibility compiler lets the modular authoring model coexist with the established simulator and renderers. Each part may temporarily publish records under `legacy.segments`, `legacy.circles`, `legacy.flippers`, `legacy.shots`, and `legacy.zones`. `assemblePinballTable()` concatenates those records in authored part order and exposes the resulting arrays on the table.

The compiler does not sort or regroup records. That rule preserves deterministic first-contact behavior in the current fixed-step simulation. It rejects duplicate part IDs, duplicate record IDs within a compatibility collection, invalid dimensions, and malformed required settings. (Source: `webgpu-os/factory/apps/pinball/core/parts/assembly/PinballTableAssembler.js`.)

Treat `legacy` as a migration boundary. New editor, mod, and tooling features should use canonical parts and their separated concerns. Existing consumers may continue to read the projected collections until they adopt the modular contract.

The runtime adapter follows the same boundary. It creates balls through the ball package, the compression-spring launcher through the plunger package, flippers through the flipper package, and solver collections through their semantic owners. Autofire actuator profiles read pulse, power, current, heating, return, travel, and damping values from each mechanism's named coil and mechanical facets. The simulation world receives the completed runtime rather than constructing table hardware itself. (Sources: `webgpu-os/factory/apps/pinball/core/parts/assembly/PinballTableRuntime.js`, `webgpu-os/factory/apps/pinball/core/PinballSimWorld.js`.)

## Build counted spinner and drop-target objectives

Use `pinball.spinner` for a pass-through lane mechanism. The part derives a horizontal axle from `center`, `laneDirection`, and `width`. Its blade spins around that axle in both directions. Ball speed along the lane adds signed angular velocity, mechanical damping coasts the blade, and `pulsesPerRevolution` converts accumulated rotation into switch facts. The default is one pulse per complete revolution. The sensor-only contact region does not create an invisible wall or block a shot. (Sources: `webgpu-os/factory/apps/pinball/core/parts/spinner/index.js`, `webgpu-os/factory/apps/pinball/core/PinballSimWorld.js`.)

Use one `pinball.drop-target` part per physical plate. Each part owns a rectangular visual, circle collision footprint, hit switch, optional impact coil, and reset coil. A successful hit closes the switch, drops the plate below the surface, and disables only that plate's collider. A target that is already down cannot score or block the ball again. (Sources: `webgpu-os/factory/apps/pinball/core/parts/drop-target/index.js`, `webgpu-os/factory/apps/pinball/core/parts/standup-target/index.js`.)

Group targets by ID through `pinball.drop-target-bank`. The bank never contains or duplicates target geometry. It validates every referenced ID during runtime assembly, tracks the down set, publishes completion, waits for `resetOnCompleteSeconds`, and pulses its shared reset coil before raising all members. The same independent target can therefore participate in another bank or ordered rule without moving its physical part. This mirrors Mission Pinball Framework's separation between individual switch-backed drop targets and logical banks with shared reset coils. ([MPF drop targets](https://missionpinball.org/latest/mechs/targets/drop_targets/), [MPF drop-target banks](https://missionpinball.org/latest/config/drop_target_banks/).)

The Dimensional Foundry uses three existing left-side target footprints as a drop bank. The bank adds no new obstruction to the seven direct flipper shot cones. A sensor-only Flux spinner crosses the right return lane. The table-authored objective recipe counts 12 spinner revolutions and one complete three-target bank before Particle, Gravity, lock multiball, and Super Jackpot stages. `MissionSystem` compiles data-only event names, field filters, count fields, targets, and reward keys; it contains no Dimensional Foundry part IDs. Mission events expose objective-local `progress` and `target` values while `stageCount` keeps the seven-stage display accurate. (Sources: `webgpu-os/factory/apps/pinball/core/tables/dimensional-foundry/devices.js`, `webgpu-os/factory/apps/pinball/core/tables/dimensional-foundry/progression.js`, `webgpu-os/factory/apps/pinball/core/MissionSystem.js`, `webgpu-os/factory/apps/pinball/index.js`.)

## Author playable lower geometry

The Dimensional Foundry uses a 360 by 740 unit playfield with a 6.5 degree pitch. Its 2.056 height-to-width ratio leaves separate space for the lower guides, flipper sweep, visible drain approach, and trough. The ball keeps its 9 unit radius. (Sources: `webgpu-os/factory/apps/pinball/core/tables/dimensional-foundry/constants.js`, `webgpu-os/factory/apps/pinball/core/tables/dimensional-foundry/machine.js`.)

Validate moving mechanisms across their complete travel, not only at their rest and active endpoints. The Foundry regression suite samples both flippers through 120 intermediate poses. It checks the center ball corridor, the distance from each swept flipper capsule to every nearby sling and divider, interpolated outlane widths, and the shooter/apron seam. The authored drain sensors begin at y=710, below the resting flipper envelope, so a ball remains visible while it falls into the trough. (Sources: `webgpu-os/factory/apps/pinball/core/tables/dimensional-foundry/lower-playfield.js`, `webgpu-os/factory/apps/pinball/core/tables/dimensional-foundry/shooter-lane.js`, `tests/pinball-modern.html`.)

Do not let an upper orbit become a bowling gutter. The Foundry keeps real center and outlane drains, but mirrored two-piece rubber return guards now intercept the long left and right descents above the sling tips. A normal orbit return must reach its inlane, rebound up-table from the active sling, or cross the player-controlled flipper band before it can be consumed; an outlane remains reachable only from a lower-playfield deflection around the divider. The regression suite injects six formerly unsafe approaches, requires a collision with the authored guard, rejects every outlane-first result, and proves a playable return before any later unplayed center drain. (Sources: `webgpu-os/factory/apps/pinball/core/tables/dimensional-foundry/lower-playfield.js`, `webgpu-os/factory/apps/pinball/core/tables/dimensional-foundry/objectives.js`, `tests/pinball-modern.html`.)

Treat slingshots as side kickers, not central barricades. The Foundry's compact mirrored slings now occupy x=100–126 and x=234–260 instead of reaching inward to x=150 and x=210. Their raw central throat grows from 60 to 108 units; after both rubber envelopes and the 18-unit ball are accounted for, 80 units remain for aimed travel. For every major objective, the regression suite constructs straight launch segments from both active flipper tips, chooses the clearer source, requires at least four units of residual collider clearance, then fires a real simulated ball through the chosen cone. All seven entries must trigger without touching either sling. This complements the 120-pose flipper sweep test: one validates moving hardware, the other validates the player's actual shot fan. (Sources: `webgpu-os/factory/apps/pinball/core/tables/dimensional-foundry/lower-playfield.js`, `webgpu-os/factory/apps/pinball/core/tables/dimensional-foundry/objectives.js`, `tests/pinball-modern.html`.)

Keep one continuous collider at a physical boundary. The shooter inner rail ends where the lower right apron begins. Adjacent segments may share an endpoint, but they must not overlap for a positive length. Duplicate collinear colliders can resolve the same contact twice and force a ball sideways. (Sources: `webgpu-os/factory/apps/pinball/core/tables/dimensional-foundry/shooter-lane.js`, `webgpu-os/factory/apps/pinball/core/tables/dimensional-foundry/lower-playfield.js`.)

## Return drained balls through a physical machine

The Foundry never replaces a drained ball at the launcher in the same simulation step. Crossing a drain sensor removes the ball only from live-play physics and starts a `pinball.trough` transfer. The part owns an intake point, gravity-return polyline, four occupancy pockets, serve polyline, drain-fall time, roll time, settle time, eject pulse, and serve time. Its mutable runtime retains the ball ID, exact position, previous position, depth below the playfield, phase, and progress for every fixed step. (Sources: `webgpu-os/factory/apps/pinball/core/parts/trough/index.js`, `webgpu-os/factory/apps/pinball/core/tables/dimensional-foundry/machine.js`.)

The lifecycle is `drain-fall` to `trough-roll` to `trough-settle` to `serve-coil` to `feeder-rise` to `shooter-entry`. Entry closes the trough inventory, the powered ejector removes one stored ball, and a new live runtime is created only when the visible feeder reaches the authored spawn point. `BALL_DRAINED`, `TROUGH_BALL_ENTERED`, `TROUGH_COIL_FIRED`, and `BALL_SERVED` facts make the sequence observable to rules, audio, rendering, diagnostics, and mods. Ball-save and normal reserve rules wait for the same mechanism; game over waits until the final ball has physically settled. (Sources: `webgpu-os/factory/apps/pinball/core/PinballSimWorld.js`, `webgpu-os/factory/apps/pinball/core/PinballEventBus.js`.)

This follows a gravity trough and solenoid ejector rather than hidden air propulsion. Real and simulated modern troughs use a drain/input switch, occupied ball positions, and an eject coil that pushes a ball into the plunger lane. Hidden routes may use authored travel time, but visible travel remains continuous; the regression suite rejects any fixed-step disappearance or position jump. See [Visual Pinball Engine troughs and drains](https://docs.visualpinball.org/creators-guide/manual/mechanisms/troughs.html) and its warning that [visible teleportation breaks natural ball flow](https://docs.visualpinball.org/creators-guide/manual/mechanisms/teleporters.html).

Both render paths expose the same mechanism through an under-apron service window: paired steel return rails, four pockets, copper eject coil, feeder rails, and the moving steel ball. The HDR path also assembles the surrounding machine from authored parts: deep chassis, full playfield glass, glass channels, lockdown bar, coin-door hardware, start button, four cabinet legs and leveling feet. A separate `pinball.environment` package owns the polished machine-room floor, backdrop, presentation ribs, materials, and accent, keeping non-gameplay staging editable without nesting it into the cabinet or table physics. (Sources: `webgpu-os/factory/apps/pinball/core/parts/cabinet/index.js`, `webgpu-os/factory/apps/pinball/core/parts/environment/index.js`, `webgpu-os/factory/apps/pinball/core/tables/dimensional-foundry/cabinet.js`, `webgpu-os/factory/apps/pinball/core/tables/dimensional-foundry/environment.js`, `webgpu-os/factory/apps/pinball/render/TableRenderer3D.js`, `webgpu-os/factory/apps/pinball/render/PlayfieldRenderer2D.js`.)

## Build active rollover sockets, not decorative rings

Every shooter-lane ring is a two-part assembly. A `pinball.sensor` owns the circular under-playfield trigger, debounced leaf switch, output signals, score, sequence index, and bank membership. A paired `pinball.insert` owns the recessed socket, addressable RGB lamp, pulse timing, latch state, and the exact sensor ID that drives it. The table assembly contains eight independent switch/insert pairs; the renderer no longer invents their positions. (Sources: `webgpu-os/factory/apps/pinball/core/tables/dimensional-foundry/shooter-lane.js`, `webgpu-os/factory/apps/pinball/core/parts/sensor/index.js`, `webgpu-os/factory/apps/pinball/core/parts/insert/index.js`.)

At 240 Hz, the simulation tests each ball against the authored trigger and publishes `SWITCH_CHANGED` facts for close and open edges. A shooter rollover closure latches its linked lamp, scores 150 points, emits `ROLLOVER`, and reports bank progress. Closing all eight awards 2,500 points, emits `ROLLOVER_BANK`, flashes the complete bank for 1.15 seconds, then returns every lamp to its armed dark state. Ball removal forces open any occupied switch so a drain, lock, or reset cannot leave phantom contacts. (Sources: `webgpu-os/factory/apps/pinball/core/PinballSimWorld.js`, `webgpu-os/factory/apps/pinball/core/PinballEventBus.js`.)

The same mutable insert records drive the HDR/PBR torus and LED center, the Canvas fallback, spatial switch clicks, rising lamp tones, bank chord, particles, bloom, and HUD bank callout. Reduced-motion mode removes the animated lamp oscillation while preserving immediate state changes and readable illumination. Mods and editor tools can therefore move, recolor, re-address, or regroup a rollover by editing its parts; no renderer-only coordinate must be synchronized. (Sources: `webgpu-os/factory/apps/pinball/render/TableRenderer3D.js`, `webgpu-os/factory/apps/pinball/render/PlayfieldRenderer2D.js`, `webgpu-os/factory/apps/pinball/audio/PinballAudio.js`, `webgpu-os/factory/apps/pinball/index.js`.)

## Adapt phone and tablet play

Keep one table simulation across every screen. `PinballResponsive.js` selects a presentation from the mounted app rectangle, not the browser viewport. This distinction keeps phone rotation, tablet split-screen, and a resized WebGPU OS window on the same authority. The available compositions are handset portrait, handset landscape, tablet portrait, tablet landscape, standard window, and desktop cockpit. None of them change part coordinates, collision geometry, objectives, or 240 Hz physics. (Sources: `webgpu-os/factory/apps/pinball/ui/PinballResponsive.js`, `webgpu-os/factory/apps/pinball/index.js`.)

Handset portrait uses a compact score and objective header, then gives the remaining height to the table. Handset landscape moves score and objective content to one side rail and cabinet actions to the other, preserving the portrait machine's aspect ratio instead of stretching it. Tablet layouts retain more status fields while keeping the player display outside the flipper reaction area. The handheld `mobile-player` camera uses a steeper fixed authored pose so the long playfield stays readable without tracking the ball or changing angles during multiball. (Sources: `webgpu-os/factory/apps/pinball/ui/PinballBackboxDisplay.js`, `webgpu-os/factory/apps/pinball/render/camera/CameraRailCatalog.js`, `webgpu-os/factory/apps/pinball/render/camera/PinballCameraDirector.js`.)

Touch-first layouts expose full lower-screen left and right flipper regions plus the analog pull-and-release shooter lane. They also expose Shift, forward Nudge, Pause, and Help as 44 by 44 CSS pixel actions. Secondary display, Cinema Focus, and settings actions move behind Pause and Help on small touch screens. A hybrid tablet promotes the cabinet to touch presentation after a real touch pointer arrives, while keyboard and pointer controls remain active. The shell uses `safe-area-inset-*` values for camera housings, rounded corners, system bars, and gesture regions. (Sources: `webgpu-os/factory/apps/pinball/core/PinballInput.js`, `webgpu-os/factory/apps/pinball/index.js`, `webgpu-os/index.html`.)

The design follows Apple's 44 point game-control target and safe-area guidance, Android's requirement to adapt games across runtime window and input changes, and WCAG 2.2 target-spacing rules. ([Apple game design](https://developer.apple.com/design/human-interface-guidelines/designing-for-games), [Apple adaptable layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Android games for all screens](https://developer.android.com/games/develop/all-screens), [Android edge-to-edge insets](https://developer.android.com/develop/ui/views/layout/edge-to-edge), [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum).)

## Keep camera motion readable

The camera package separates authored content, spline evaluation, state policy, and projection:

```text
render/camera/
  CameraRailCatalog.js
  CameraRail.js
  PinballCameraDirector.js
  TableCamera.js
```

Human play uses a stable authored view. Scoring events, locks, bumpers, jackpots, extra balls, and multiball do not change the player's preset, lens, or angle. Attract mode may use the deterministic 22 second closed rail, and game over may use the 2.8 second one-shot pullback. Reduced-motion mode keeps the selected view fixed. (Sources: `webgpu-os/factory/apps/pinball/render/camera/CameraRailCatalog.js`, `webgpu-os/factory/apps/pinball/render/camera/PinballCameraDirector.js`.)

`TableCamera` fits the cabinet into the current HUD-safe viewport, then damps eye, target, field of view, and lens shift independently. It builds a new view matrix from the resulting physical pose each frame. It never interpolates matrices. The top view uses a playfield-relative stable up vector to avoid roll flips. (Source: `webgpu-os/factory/apps/pinball/render/camera/TableCamera.js`.)

The OS app requests full-size window sizing. At 1280 by 720 and larger gameplay viewports, the cockpit layout places mission and mechanism panels on the outer edges so they do not consume vertical table space. (Sources: `webgpu-os/apps/pinball/manifest.json`, `webgpu-os/factory/apps/pinball/factory.js`, `webgpu-os/factory/apps/pinball/index.js`.)

## Author the cabinet backbox and player display

Treat the cabinet head and its content as separate reusable parts. A `pinball.backbox` owns the physical enclosure, LCD aperture, speaker bays, bezel, service hinge, materials, and table-relative mount. A `pinball.display` owns the resolution-independent logical LCD, its data channels, field order, labels, palette, and full/compact mode policy. The Dimensional Foundry assembles one of each in `tables/dimensional-foundry/backbox.js`; the PBR renderer and DOM player display consume those same immutable parts. Moving the backbox, replacing LCD technology, relabeling a field, or creating another table therefore does not require editing the app shell. (Sources: `webgpu-os/factory/apps/pinball/core/parts/backbox/index.js`, `webgpu-os/factory/apps/pinball/core/parts/display/index.js`, `webgpu-os/factory/apps/pinball/ui/PinballBackboxDisplay.js`.)

The primary LCD uses a base score slide with Player 1 score, Grand Champion score, ball reserve, dimension, reactor state, live-ball and safety rules, and the current objective. Machine awards temporarily take priority as animated callout slides, then reveal the current score slide again. This follows Mission Pinball Framework's logical-display model and its priority slide stack, where the normal score slide carries score and ball/player context and higher-priority events temporarily replace it. ([MPF logical displays](https://missionpinball.org/latest/mc/displays/), [MPF slide priorities](https://missionpinball.org/latest/mc/slides/).)

In a cockpit-sized window the display occupies the unused left cabinet rail. Staged, attract, paused, and game-over states show the complete backbox. Live human play automatically compacts it to score and objective so it cannot cover the playfield. The cabinet control can hide or restore it entirely; renderer insets are recalculated from the actual visible panel rather than a duplicated table coordinate. Narrow windows scale the same logical fields into a top status strip. Presentation breakpoints remain CSS tokens, while machine identity, data fields, state policy, physical dimensions, and mounting coordinates remain authored part data.

## Use Cinema Focus as a staged-ball presentation

Cinema Focus is a manual presentation action, not a live-ball tracking camera. Press `C` while the ball is staged to run one deterministic 5.2 second centerline push and return. The move keeps the lower playfield readable, carries smoothly back into the normal table composition, and does not orbit, roll, follow the ball, or react to scoring events. Once the ball is live, the gameplay camera remains stable. Reduced-motion mode suppresses the Cinema Focus move. (Sources: `webgpu-os/factory/apps/pinball/index.js`, `webgpu-os/factory/apps/pinball/render/camera/PinballCameraDirector.js`, `webgpu-os/factory/apps/pinball/render/camera/CameraRailCatalog.js`.)

The fixed `Oblique` preset is separate from Cinema Focus. `Oblique` is a persistent authored table view; it does not start the timed rail or opt the player into automatic camera motion. The design follows [Visual Pinball Engine camera framing](https://docs.visualpinball.org/creators-guide/editor/advanced/camera-settings.html), [Unreal Engine VCam RigRail controls](https://dev.epicgames.com/documentation/unreal-engine/unreal-vcam-tools-and-configuration-in-unreal-engine?lang=en-US), [Unity Cinemachine spline paths](https://docs.unity.cn/Packages/com.unity.cinemachine%403.1/manual/CinemachineUsingSplinePaths.html), and [Xbox guidance for camera motion and reduced-motion controls](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/117).

## Research and see also

- [Stern standard playfield glass](https://shop.sternpinball.com/products/high-definition-playfield-glass) provides a physical 21 by 43 inch reference envelope.
- [Pinball Makers playfield sizes](https://pinballmakers.com/wiki/index.php?title=Playfield_Sizes) collects common full-size playfield dimensions.
- [Visual Pinball Engine camera settings](https://docs.visualpinball.org/creators-guide/editor/advanced/camera-settings.html) treats distance, field of view, inclination, and framing as one authored setup.
- [Unreal Engine camera rigs](https://dev.epicgames.com/documentation/en-us/unreal-engine/camera-rigs?application_version=4.27) documents rail-mounted camera motion.
- [Unity Cinemachine spline dolly](https://docs.unity.cn/Packages/com.unity.cinemachine%403.0/manual/CinemachineSplineDolly.html) documents authored spline position and automatic dolly movement.
- [Xbox accessibility guidance for motion](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/117) explains why automatic camera motion needs a reduced-motion alternative.
- [Apple game design guidance](https://developer.apple.com/design/human-interface-guidelines/designing-for-games) defines touch target and safe-area expectations for iPhone and iPad games.
- [Android games for all screens](https://developer.android.com/games/develop/all-screens) covers phone, tablet, foldable, keyboard, mouse, controller, and touch adaptation.
- [Android edge-to-edge guidance](https://developer.android.com/develop/ui/views/layout/edge-to-edge) explains system-bar, display-cutout, and gesture insets.
- [WCAG 2.2 target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) defines minimum pointer target sizing and spacing exceptions.
- [Visual Pinball Engine component architecture](https://docs.visualpinball.org/creators-guide/editor/unity-components.html) separates main, collider, mesh, and animation components.
- [Mission Pinball Framework switches](https://missionpinball.org/latest/mechs/switches/) defines switch roles and active/inactive state.
- [Mission Pinball Framework spinners](https://missionpinball.org/latest/mechs/spinners/) defines one switch closure per rotation and counted spinner objectives.
- [Mission Pinball Framework drop targets](https://missionpinball.org/latest/mechs/targets/drop_targets/) separates target switches from reset and knockdown coils.
- [Mission Pinball Framework drop-target banks](https://missionpinball.org/latest/config/drop_target_banks/) groups independent targets and defines shared reset timing.
- [Mission Pinball Framework flippers](https://missionpinball.org/latest/config/flippers/) describes activation switches, coils, and end-of-stroke switches.
- [Mission Pinball Framework ball devices](https://missionpinball.org/latest/config/ball_devices/) describes ball inventory, capture, eject, and routing contracts.
- [Mission Pinball Framework autofire coils](https://missionpinball.org/latest/mechs/autofire_coils/) covers low-latency switch-to-coil mechanisms.
- [Mission Pinball Framework slingshots](https://missionpinball.org/latest/mechs/slingshots/) describes the switch, coil, and rubber assembly.
- [Mission Pinball Framework display types](https://missionpinball.org/latest/mc/displays/types/) covers segment, DMD, RGB DMD, and modern LCD hardware.
- [Mission Pinball Framework logical displays](https://missionpinball.org/latest/mc/displays/) separates resolution-independent display content from physical output hardware.
- [Mission Pinball Framework slide priorities](https://missionpinball.org/latest/mc/slides/) documents the persistent score slide and temporary higher-priority mode or warning slides.
- [Visual Pinball Engine troughs](https://docs.visualpinball.org/creators-guide/manual/mechanisms/troughs.html) covers drain, storage, and serve mechanisms.
- [App Catalog](app-catalog.md) describes Dimensional Pinball as a built-in WebGPU OS app.
- [WebGPU OS Architecture](architecture.md) explains the surrounding OS runtime.
