---
title: RealmForge object actions and animation
description: Research and implementation design for reusable object actions, animated lights, and a bottle with persistent contents.
updated: 2026-09-26
---

# RealmForge object actions and animation

RealmForge should let an asset carry named actions, animation clips, remembered
state, and explicit connections to physics. This page records source inspection
and primary-source research on 26 September 2026. The general object action
system below remains a design. The implemented storage preview described next
is a bounded first use of checked authored motion.

## Implemented storage action preview

**Storage → Preview placement → Watch the move** animates existing objects
between measured storage areas. It checks the complete sequence before playback:
open, retrieve, transport, orient, place and close. Doors use their registered
hinges; drawer trays and their measured contents move together. Blocked routes
produce visible failures. Play, pause, speed and scrubbing use a request-scoped
controller and the existing timeline value evaluator. Stop shows the final
arrangement; Apply is the existing guarded one-Undo transaction.

This preview owns only detached viewport matrices. It does not drive the
physics solver, move a player/NPC, or execute events while scrubbing. Source,
account and preview changes revoke it. Lamp controls, bottle opening and pill
release still require the general action and physics integration proposed below.
See [storage organization](realmforge.md#watch-a-storage-move).
(Sources: `webgpu-os/apps/realmforge/storage/RealmForgeStorageAction.js`,
`RealmForgeStorageActionPlayback.js`, `RealmForgeStoragePanel.js`.)

## How an object should work

An action is a named operation such as **Open lid**, **Shake out contents**, or
**Turn light on**. An animation describes motion or changing appearance over
time. State records what is true after that motion finishes. Physics supplies
contacts, forces, and free motion when an action needs them.

| Object | Actions | State to remember | Animation and physical response |
| --- | --- | --- | --- |
| Pill bottle | Open lid, close lid, shake, pour | Cap attachment, individual contained/released pill IDs, remaining count | Animate cap rotation/lift and bottle tilt/shake; released pills fall and collide |
| Lamp | On, off, dim, change colour | Switch state, brightness, colour | Move switch if present; animate both bulb emission and an actual scene light |
| Cabinet | Open, close, latch, pull out | Panel position and latch | Use the existing hinge/slide mechanism; an action can drive it toward a target |
| Book | Open, close, turn page | Reading position and existing book contents | Adapt the existing page presentation into the shared action interface |

Actions can start from a button, keyboard/controller binding, click on a part,
held-object use, an explicit timer, or a registered condition. Automatic idle,
blink, flicker, or machine cycles need an explicit trigger and bounded frequency.
An asset should never pour its contents merely because its preview loaded.

## What the researched systems provide

VRChat exposes parameter-driven controls through expression menus, including
buttons, toggles, submenus, and continuous controls. Its avatar layers combine
movement, gestures, actions, and effects. These are useful authoring patterns
for a simple action list with advanced parameters. They do not imply that a
RealmForge asset can execute a Unity Animator Controller unchanged.
Sources: [VRChat expression controls](https://creators.vrchat.com/avatars/expression-menu-and-controls/),
[VRChat playable layers](https://creators.vrchat.com/avatars/playable-layers/).

VRChat world objects also receive interaction, pickup, drop, and held-use events.
Animation events can call an allowed set of operations. For RealmForge, the
equivalent should be registered, validated commands at named clip markers.
Sources: [VRChat object events](https://creators.vrchat.com/worlds/udon/graph/event-nodes/),
[VRChat animation events](https://creators.vrchat.com/worlds/udon/animation-events/).

VRM Animation describes reusable humanoid bone, expression, and gaze animation.
It is an avatar animation format; a bottle's contents and action rules still
need an application runtime. Source:
[VRM Animation specification](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/README.md).

For portability, glTF's ratified `KHR_animation_pointer` can animate mutable
asset properties beyond the base format's transforms and morph weights.
`KHR_lights_punctual` defines point, spot, and directional light data. A light's
emissive surface and its illumination of other objects must both be supported
by the chosen renderer. Sources:
[KHR_animation_pointer](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_animation_pointer/README.md),
[KHR_lights_punctual](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_lights_punctual/README.md).

The current `KHR_interactivity` source specification is marked complete and
ratified. It defines behavior graphs, variables, events, and asset-property
operations for single-user experiences. It deliberately does not specify
multiplayer behavior or general UI presentation. Design a future verified
import/export subset around this standard; do not claim support merely because
an ordinary GLB imports. Source:
[KHR_interactivity specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_interactivity/Specification.adoc).

Persistent state also needs its own representation. VRChat distinguishes
transient network events from synchronized variables, which make current state
available to late joiners. RealmForge should likewise preserve current object
state independently of the animation that produced it. Networking remains a
later host integration. Source:
[VRChat network variables](https://creators.vrchat.com/worlds/udon/networking/variables/).

## Existing RealmForge foundations and gaps

| Existing owner | Verified capability | Required extension |
| --- | --- | --- |
| `modeler/animation/RealmForgeTimelineContracts.js` and `RealmForgeTimelineEvaluator.js` | Versioned clips/tracks, stable resource targets, interpolation, separate values/events/topology output | Stateful playback with event crossings, action transitions, property bindings and cancellation |
| `modeler/document/RealmForgePhase5DocumentProjection.js` | Durable `timeline.animation` resources and guarded authoring transactions | Persist action definitions and instance defaults alongside existing clips |
| `modeler/adapters/RealmForgeCoreAdapterRuntime.js` | Basic animation adapter stores clip selection, time, speed, playing and loop | Connect sampled channels to the authoritative object/renderer adapters |
| `engine/render/mesh/SkeletalAnimation.js` | Node clip playback with seek, loop, speed and pose evaluation | Reuse sampling; add action-level arbitration and selective blending where needed |
| `modeler/behavior/ForgeBehaviorRuntime.js` | Typed state, bounded execution, lifecycle handlers and validated commands | Connect actions to actual object effects through the existing simulation runtime |
| `modeler/runtime/RealmForgeRuntimeCommandContracts.js` | Bounded transform/material/particle/audio/mechanical/event command schemas | Typed light, clip, attachment and finite-content operations where missing |
| `construction/runtime/` | Existing hinge/slide interactions and native physical pose ownership | Coordinate action-driven mechanisms with manual dragging and dynamic bodies |
| `books/` | Persistent contents and a working authored page-turn presentation | Shared action adapter without losing marks or reading position |

Paths in this table are relative to `webgpu-os/apps/realmforge/`, except the
explicit `engine/` path. These foundations are not a complete object action
player. The stored timeline panel primarily displays timeline metadata; the
current evaluator's production RealmForge use includes export. The default
session system executor accepts the flagship-zone operation, and other
compiled behavior operations require additional executor/reducer integration.
Sources: `modeler/ui/ModelerPanel.js` (`_renderStoredTimelines`),
`modeler/session/ModelerSession.js` (`_executeDefaultSystemRuntimeStep`),
`modeler/runtime/RealmForgeSimulationZone.js` (`step`),
`export/RealmForgeSessionExport.js`.

Two physical/rendering gaps are especially important. The current Modeler
shader supplies studio lighting and surface emission; the engine's ECS
`LightManager` is not yet bound into that viewport. A glowing lamp therefore
does not establish that a room receives its light. Existing construction
articulation supports bounded revolute/prismatic motion, not a multi-turn
helical cap. Use explicit unwrapped turn/travel state for the cap action.
Sources: `modeler/viewport/ModelerViewport.js`,
`engine/render/LightManager.js`, `construction/ConstructionArticulationProfile.js`.

Existing construction snapshots expose telemetry rather than a full resumable
inventory of rigid-body poses and velocities. Durable action saves must include
those values for the detached cap and released pills. Reuse simulation-zone
checkpoint patterns, and add the missing physical-state capture/restore path.
Sources: `construction/runtime/RealmForgeConstructionPresetPhysics.js`
(`snapshot`, `reset`), `modeler/runtime/RealmForgeSimulationZone.js` (`snapshot`).

## Proposed authoring experience

Select an object and open **Actions**. Show named actions with a thumbnail,
current state, and any reason an action is unavailable. A bottle initially
offers **Open lid** and **Shake**; **Pour** explains that the lid must be removed.
After opening, **Pour** becomes available and the contents counter is visible.
A lamp presents an on/off toggle and brightness slider.

Use simple action cards first. Each card exposes target parts, trigger, clip,
duration/speed, loop policy, prerequisites, completion state, and interruption
behavior. An advanced view exposes transitions and clip markers using the
existing graph/timeline concepts. Grasp, cap, spout, pivot, and release anchors
should be selectable in the viewport.

Provide **Preview**, **Pause**, **Scrub**, **Reset**, and **Keep current state**.
Preview runs an isolated instance. Scrubbing samples poses without dispensing
extra objects or replaying sounds. Reset restores the preview snapshot.
Keeping a result commits one guarded, undoable state change. Ordinary playback
must not create a document Undo entry every frame.

Actions should also appear as capability badges in Explore cards. Selecting a
badge can preview that action on the same generated asset. Word concepts such
as “screw-top”, “dimmable”, and “shakeable” should resolve to reviewed component
and action definitions. Echo may propose a supported composition; existing
definition-review, budget, and transaction rules still apply. Unavailable
targets, operations, or requirements stay visible to the user.

## Runtime and persistence rules

1. Store versioned action definitions with stable action/clip/part/socket IDs,
   parameter types, allowed commands, dependencies, state transitions, and
   declared property ownership. Reuse existing resource envelopes and validation.
2. Keep reusable definition defaults separate from each instance's state. Store
   cap attachment, light settings, content identities, and action checkpoints
   without changing every other copy of the asset.
3. Let only one owner drive a body's physical pose at a time: animation through
   a kinematic target, a physical motor/grab, or free dynamics. Support motion in
   local coordinates beneath a held parent. Resolve property conflicts before
   starting an action; do not alternate animation and physics writes each frame.
4. Release a cap or pill at its current world pose with the owner's current
   velocity. Update attachment/collision policy and content membership together.
   Reattaching requires a valid socket/pose and an explicit supported operation.
   Preserve collisions while holding or shaking a bottle; the demo transform
   grab that removes its physics body is not an appropriate containment owner.
5. Process clip events crossed between consecutive ticks. The existing pure
   evaluator only returns events exactly at the sampled tick; direct render-time
   sampling can skip them. Identify each effect by action execution, loop and
   marker so pause/resume, retries, duplicate replies and seek cannot duplicate it.
6. Keep content conservation authoritative: every pill has one identity and is
   contained, in transfer, or released. Ordinary dispensing cannot increase the
   total. A cosmetic particle emitter must not be the source of inventory truth.
7. Check action scope, document/account identity, registered operations, target
   existence and budgets. Cancellation must release ownership and pending
   commands. Persisted checkpoints must not replay completed release events.

These are proposed rules. They require implementation and acceptance evidence;
the current command vocabulary alone does not establish working light control,
attachment transfer, finite dispensing, or network synchronization.

## First complete milestone

Build one reusable action controller with two reference assets: a lamp and a
pill bottle. Keep delivery inside RealmForge first.

| Piece | Deliverable |
| --- | --- |
| 1 | Versioned action contracts and strict binding to stable generated parts, clips and sockets |
| 2 | Play/pause/seek/reset controller, state transitions, event crossings and duplicate-effect prevention |
| 3 | Transform/material/light adapters and explicit animation/physics ownership |
| 4 | Lamp with on/off, dimming, colour and optional bounded flicker; actual illumination verified |
| 5 | Bottle with hollow body/neck collision geometry, removable cap, grasp/spout anchors and a finite set of pills |
| 6 | Open/close cap and shake/pour actions, with conserved release and interruption handling |
| 7 | Actions UI, preview isolation, instance persistence, Undo and existing catalog/Echo discovery |
| 8 | Native viewport, physical handoff, save/reopen and backward-compatibility acceptance gates |

For **Open lid**, animate the cap around the neck axis and lift according to
the authored screw motion, then detach at a named completion marker. A partial
opening is a real intermediate state. For **Shake out contents**, tilt/shake
the bottle and release only eligible contained pills through its actual open
mouth. Released pills use dynamic collision. Shaking a closed bottle can rattle
its contents; it cannot dispense them. Empty bottles remain empty. Reversing a
clip must not recreate pills that have already left.

Use actual cavity collision geometry, not a solid bottle collider that traps
everything or a visual shell through which pills leak. The first milestone may
use a validated compound cavity approximation with documented limits. Full
thread contact simulation and humanoid hand animation are later extensions.

## Acceptance gates

- Named actions operate on ordinary object parts with no humanoid skeleton.
- On/off and dimming change nearby illumination as well as the bulb appearance.
- Closed bottles do not dispense; open bottles dispense no more than their
  conserved contents. Released objects retain unique identities.
- Low frame rate, fast playback, loop boundaries, pause/resume and duplicate
  commands do not skip or duplicate release events.
- Scrub/preview/reset leave authored resources and inventory unchanged; explicit
  state commit creates one Undo entry and save/reopen restores the result.
- Interruptions at cap separation and pill release produce a valid state and no
  competing animation/physics pose writer.
- Save/reopen during a supported action restores its checkpoint, body poses and
  velocities, ownership and event sequence without replaying completed effects.
- Light, content and action budgets are explicit; capacity overruns cannot
  silently remove requested lamps, pills or tracks.
- Multiple copies have independent state. Missing targets and unsupported
  imported channels are reported rather than silently ignored.
- Existing timeline exports, construction playback, door/drawer interaction,
  book contents and independently derived generator fingerprints remain valid.

## See also

- [RealmForge modular workbench](realmforge.md)
- [RealmForge bake pipeline](virtual-realm/realmforge-pipeline.md)
- [Schema evolution](../concepts/schema-evolution.md)
