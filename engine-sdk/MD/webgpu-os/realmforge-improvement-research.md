---
title: RealmForge improvement research
description: Source-checked gaps, external research, and a staged path from generated assemblies to usable furnished spaces.
audience: RealmForge developers, asset authors, and AI-tool integrators
updated: 2026-10-01
---

# RealmForge improvement research

This assessment records the RealmForge baseline and procedural-scene, interaction, accessibility, and simulation references checked on 26 September 2026. The implementation follow-up below distinguishes delivered changes from the remaining roadmap. The original research alone is not runtime acceptance evidence.

## Implementation follow-up

The household electricity milestone extends the existing circuit solver and guarded construction pipeline. See [Electricity and control boards](realmforge-electricity.md) for generated service entry, main/branch protection, switched lamps, outlets, wall plates, passive Ethernet patching, breadboard topology, motors, jumper editing and per-asset state. New typed requests and Explore variants retain the complete wiring profile. Echo candidates accept the same validated v1–v5 intent formats and supported modifiers, with explicit-constraint and request/account guards. Complete reusable designs use `realmforge-build-definition-v3`; historical v1/v2 definitions remain available with their original generator pins.

Room-fitting diagnostics now distinguish invalid candidates, retained-access failure, sampled-search failure and search-budget exhaustion. Native mechanism controls have Open/Close, measured opening, a requested-opening slider, keyboard targeting and wheel sensitivity. GLB export now retains supported material groups, PBR/unlit appearance, embedded images, UV transforms, skins, morphs and animations. Unsupported appearance features fail explicitly.

Sources: `construction/RealmForgeHomeComposition.js`, `construction/RealmForgeBuildController.js`, `construction/RealmForgeBuildEchoBridge.js`, `modeler/viewport/RealmForgeArticulationFocusInput.js`, `modeler/electrical/RealmForgeUtilityRuntime.js`, `export/GLBAppearance.js`, and `export/GLBWriter.js`.

The September 29 implementation adds [usable interiors](realmforge-interiors.md): mixed shelf filling with saved books, checked filled-container transport, editable room rosters, finite bottle actions, separate object state, and a measured actor-use adapter. [Building programs and utilities](realmforge-building-utilities.md) adds bounded multi-unit programs, window operation/shape/glazing, fixed skylights, hydraulic fixture networks and actual appliance loads. Reusable definition version three retains the complete design, and Explore prioritizes visible/selected candidates within byte budgets. Consult the current runtime receipts for acceptance; this research table below remains the historical baseline.

Glass optics, automatic humanoid navigation/animation, unrestricted commercial programs and largest-building performance targets remain beyond those bounded capabilities. Whole-house flow tracers are separate from local SPH. Passive Ethernet continuity does not provide packet networking or PoE.

## Life-sim building interfaces: October 1 follow-up

EA's [The Sims 4 Gallery guide](https://help.ea.com/en/articles/the-sims/the-sims-4/gallery/) describes room and lot browsing, filtering, placement and saved-library reuse. Its [official player guide](https://cdn-assets-ts4.pulse.ea.com/Guide/TheSims4_Players_Guide.pdf) introduces complete Styled Rooms and selecting their individual contents. These patterns suggest showing a useful furnished result before asking people to edit its parameters.

The August 2026 [Sims FreePlay interface trial](https://www.ea.com/games/the-sims/the-sims-freeplay/news/build-mode-and-home-store-refresh-faq) separates Furnish from Construct, groups color variants within an item card, combines search with category filters, and keeps camera, floor and wall controls available. That article describes a limited FreePlay trial, not a universal Sims 4 release. [Paralives](https://www.paralives.com/) advertises gridless construction, resizable objects and color/texture customization; RealmForge should retain measured metric dimensions and valid access when adapting those ideas.

The resulting RealmForge step is a contextual room browser over the existing fitter. **Object tools → Furnish room** opens the current house's room controls. Compatible preset cards show actual fitted footprints, contents, approaches and anchors; blocked layouts keep their specific diagnostics. Palette matching reads the latest saved house appearance. An explicit action switches custom contents back to presets. Browsing creates no transaction or AI call, and full Preview remains responsible for recipe, dependency, service and capacity admission before the existing one-Undo Apply.

Sources: `construction/RealmForgeHouseRoomBuild.js`, `modeler/ui/RealmForgeHouseRoomControls.js`, `modeler/ui/RealmForgeProceduralBuildPanel.js`, and `modeler/ui/ModelerPanel.js`. See [Furnish a room in an existing house](realmforge.md) for the current controls. Whole-house shading and furniture appearance remain global; this step does not claim independently painted shared walls.

The arrangement follow-up adds a selected-room measured plan, metric position fields, click-operated movement and rotation, and keyboard footprint selection. It derives a complete custom draft from the actual fitted objects and pins floor siblings at their measured poses. Dependent decorations refit on measured support/storage; the changed poses and relationships are listed. Full Preview and the existing room replacement Apply remain required. This authoring operation regenerates the selected room's object identities and operating states; it is not transport of live objects. Written book documents remain in the library even when their previous geometry binding detaches.

The metric fields and click-operated movement provide an alternative to precise pointer gestures. W3C distinguishes [single-pointer dragging alternatives](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) from keyboard access, and its [spinbutton guidance](https://www.w3.org/WAI/ARIA/apg/patterns/spinbutton/) preserves ordinary numeric text editing. These inform the controls; they do not establish a complete accessibility audit.

Further work should add saved custom room layouts through immutable dependencies and review receipts, room reshaping with recalculated framing, openings and services, and transport/editing of existing objects under stable identity and state preservation. A movable decorative object and a room that changes a shared structural wall need different admission paths.

## Preserve the working foundations

RealmForge already has deterministic versioned generation, measured room and storage fit checks, guarded previews and transactions, book contents and marks, native door/drawer interaction, and seat/laydown anchors. Explore already has categories, six-candidate batches, refinements, comparison, favorites, spelling recovery, worker generation, cancellation, and bounded caches. These are extension points, not missing features to rebuild.

Pipe inspection already uses real engine SPH. It is not a scripted particle path. Current multi-floor houses already have stair geometry, room-aware window placement and shared service routes. The gaps concern the scope and connection of these capabilities.

Sources: `webgpu-os/apps/realmforge/catalog/RealmForgeExploreController.js`, `construction/RealmForgeProceduralHouse.js`, `construction/RealmForgeMultistoreyHouse.js`, `construction/RealmForgeMultilevelHouseServices.js`, `construction/RealmForgeSeatAnchors.js`, `storage/RealmForgeStorageGeometry.js`, and `modeler/water/RealmForgePipeWaterRuntime.js`. Unless a full path is given below, source paths are relative to `webgpu-os/apps/realmforge/`.

## Ranked improvements from the September 26 baseline

This table records the original priorities, not the current implementation status. The follow-up and linked feature guides describe the bounded capabilities now present. Runtime acceptance remains a separate check.

| Priority | Baseline gap | Planned result |
| --- | --- | --- |
| 1 | The furnishing search reports failure to fit when its 18,000-attempt budget expires. Door opening has wheel/drag input but no equivalent Open/Close controls. | Distinguish search exhaustion from demonstrated invalidity; add accessible opening controls, measured opening, and specific target names. |
| 2 | Door lock and pose state are transient. General object action execution and resumable physical state are incomplete. | Versioned state per placed object; shared action execution with reliable events, cancellation, and one physical pose owner. |
| 3 | Seat/bed and storage anchors describe geometry but do not authorize or execute actor use. Moving an occupied container is rejected. | Reserve, approach, use, and release operations; explicit containment/support relationships and checked transport of filled containers. |
| 4 | Furnished-room families use fixed item rosters. Local v3-v5 capabilities exceed Echo and reusable-definition v1/v2 support. | Editable contents, quantities and spatial relationships; one capability description shared by local parsing, UI and Echo. |
| 5 | The Modeler uses studio lighting and surface emission. Utility routes do not provide complete running household behavior. | Lamps illuminate nearby surfaces; switches and taps affect actual supported utility state; local particles show visible water. |
| 6 | Multi-storey houses repeat one dwelling layout per floor. Apartment/hotel/motel programs are explicitly unsupported. | Building, floor, unit and room identities with shared circulation and independent unit services. Start with a duplex. |
| 7 | The broader window catalog is researched but not implemented in generated houses. | Separate window operation, shape, size/sill and glazing; then add roof openings and skylight assemblies. |
| 8 | The GLB writer omits materials/textures; larger furnished buildings need measured performance work. | Appearance-preserving export, dependency-aware reuse, byte-aware preview budgets, sparse pose uploads and accelerated picking. |

## Immediate usability and diagnostic fixes

The baseline room fitter returned the same failure for exhausted samples and its search budget. It now reports invalid requested geometry, retained-access failure, sampled-search failure and budget exhaustion separately. Exhausting the supported search still does not prove that no continuous placement exists. Keep these diagnostics when extending explicit rosters, and never silently discard required items. Sources: `construction/RealmForgeHomeComposition.js`; `construction/RealmForgeContentsComposition.js`.

Keep wheel opening, and add Open, Close and a measured opening slider through the same native mechanism controls. Expose target selection through a keyboard-operable interactions list. Add input remapping and wheel sensitivity. Name targets such as “Upper drawer” or “Bedroom door” from authored identities, and highlight the active moving panel. Distinguish locked, blocked, preparing, and out-of-reach feedback. Current generic Door/Drawer labels can conceal an intentional target change when a pointer crosses another panel.

The controls now include Open/Close, keyboard targeting and a requested-opening slider. W3C treats keyboard access and single-pointer alternatives as separate requirements; its slider guidance supplies familiar arrow-key and endpoint behavior. These remain design references, not a completed RealmForge accessibility audit. Sources: `modeler/viewport/RealmForgeArticulationFocusInput.js`, `modeler/viewport/ModelerViewport.js`, `modeler/ui/ModelerPanel.js`; [W3C keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html), [dragging alternatives](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), [slider pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/), and [remappable controls](https://gameaccessibilityguidelines.com/allow-controls-to-be-remapped-reconfigured/).

## Persistent objects and reusable actions

Separate reusable design defaults from the state of each placed copy. A cabinet instance should retain its lock, supported opening state and contents without changing every cabinet made from the same definition. Include stable object identity, definition version and a state revision. Restore containment and attachment relationships before physical poses. Keep authoring Undo separate from ordinary simulation state; an explicit state commit may create an authoring transaction, while preview and scrubbing remain non-authoritative.

The existing timeline supports nine lane families. Its evaluator is a pure sampler, with events emitted only at an exactly sampled tick. General playback needs to process events crossed between ticks and identify effects by execution and marker so retries, loops, seeking and resume cannot duplicate a released object. Reuse these contracts rather than creating another animation format. There must be one owner of each body's pose: a physical motor/grab, a supported kinematic animation, or free dynamics. Handoff preserves pose and velocity.

The lamp and bottle milestone in [Object actions and animation](realmforge-object-actions.md) already describes the right reference cases. Opening a cap must detach the same cap; pouring must transfer existing contents rather than emit unlimited new pills. Saved checkpoints must not replay completed releases. This requires durable capture/restore using existing internal pose capture where applicable, not only the existing telemetry snapshots. Sources: `construction/runtime/RealmForgeConstructionPresetPhysics.js:2266`, `:2440`, `:3543`; `modeler/animation/RealmForgeTimelineContracts.js:25`; `modeler/animation/RealmForgeTimelineEvaluator.js:107`; `storage/RealmForgeStorageAction.js:360`.

Epic's animation notifications demonstrate timed effects and bounded action intervals. Godot's save guidance illustrates explicit persistence and ordered restoration of nested objects. These inform the design without replacing the existing browser runtime. References: [Animation Notifies](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-notifies-in-unreal-engine), [saving game state](https://docs.godotengine.org/en/stable/tutorials/io/saving_games.html).

## Usable seats, storage and contents

Define a shared interaction lifecycle: find, reserve, approach, use, release. Check actor dimensions, reach, access, an available approach path and the current object revision. A claim expires or is released when interrupted. Two actors cannot both own one seat or retrieve the same book. Seat and laydown anchors already provide the geometric starting point; a future actor adapter must supply movement and execution authority.

Preserve object identity through containment and support relationships. The organizer now plans checked transport of supported filled containers, including their retained contents. This design action preview is not evidence of general live physical tipping, shaking or dropping. Those require their own physical ownership and separation rules. See [Usable interiors](realmforge-interiors.md). Sources: `construction/RealmForgeSeatAnchors.js`; `storage/RealmForgeStorageGeometry.js`; `storage/RealmForgeStorageAction.js`.

[Epic Smart Objects](https://dev.epicgames.com/documentation/en-us/unreal-engine/smart-objects-in-unreal-engine---overview) separates reusable interaction definitions from runtime slots, claims and use. That is a useful model for the existing RealmForge anchors. It does not supply our actor navigation, animations or world permissions automatically.

## Editable rooms, language and discovery

Explicit room rosters now accept descriptions such as “bedroom containing two chairs, a table and a bookcase,” with bounded `inside`, `on`, `facing` and adjacency relations. The editor also records quantities, dimensions and pinned rigid placements. Measured room fit, support, collision, relations and requested quantities remain hard constraints. A requested window must actually exist. Empty, malformed or unknown list segments require clarification; an explicit empty roster is a separate supported choice. More general prose and soft placement preferences remain future work.

Custom rosters are opt-in; absent contents preserve the existing preset route. Complete v3 definitions retain the entire validated intent, including per-room assignments, services, custom control boards and supported building modifiers. Definition version three is distinct from intent version three. Echo accepts supported v1–v5 intents through the same validators, exact constraints and three-candidate limit. It cannot register executable generators or approve a reusable definition. Sources: `construction/RealmForgeContentsContracts.js`; `construction/RealmForgeBuildContentsText.js`; `construction/RealmForgeBuildIntent.js`; `construction/RealmForgeBuildController.js`; `construction/RealmForgeBuildEchoBridge.js`.

**Check words and meanings** reuses the existing OCR spelling resource and concept registry. Only exact reviewed account-library definitions provide construction semantics. Dictionary membership, pending definitions and ambiguous meanings remain distinguishable. Saving a new complete design does not grant Auto Known approval; editing requires another immutable version and review receipt. Sources: `construction/RealmForgeBuildConceptCatalog.js`; `construction/RealmForgeBuildLibrary.js`; `modeler/ui/RealmForgeProceduralBuildPanel.js`.

Extend the existing Explore sidebar with room/object subcategories, removable requirement chips and “keep this part” controls. Add card explanations such as “all requested features included,” “approximate: no bay window,” and supported behavior badges. Keep exact generated previews and explicit approximate-build review. Unknown words must remain visible; a dictionary entry alone cannot create new geometry, physics or actions.

[Infinigen Indoors](https://arxiv.org/html/2406.11824v1) demonstrates semantic relations, quantity, support, orientation and accessibility constraints. [ProcTHOR](https://procthor.allenai.org/) combines varied layouts with interactive objects. The transferable idea is explicit, validated composition. Neither research project establishes that a fully constrained furnished house can be generated interactively within this browser's current budget.

## Utilities, light and building expansion

The Modeler's shader adds emission to fixed studio lighting; it does not bind the engine's scene LightManager into the viewport. Add a bounded point/spot light adapter, with intensity, range, switch/dimmer state and actual nearby illumination. Check exposure and color consistency rather than using a glowing bulb as the sole success criterion. Sources: `modeler/viewport/ModelerViewport.js:386`, `:441`; `engine/render/LightManager.js`; [KHR_lights_punctual](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_lights_punctual/README.md).

Add glass transmission separately from alpha transparency. Thin window glass and thick bottle glass have different optical behavior. Khronos distinguishes transmission from thickness-dependent refraction and absorption; colored light on other surfaces still needs separate rendering support. Reference: [transmission and volume](https://github.khronos.org/glTF-Tutorials/AddingMaterialExtensions/AddingMaterialExtensions_003_TransmissionAndVolume.html).

Existing plumbing includes hollow routes, ports, drain fall checks and opening audits. The selected-route water runtime supports 32–64 real SPH particles and up to 20 m of route. New opt-in house utilities add household AC, appliance loads and a bounded hydraulic network; legacy electrical recipes retain their earlier model. Whole-house flow visualization and local SPH remain separate. See [Electricity and control boards](realmforge-electricity.md) and [Building programs and utilities](realmforge-building-utilities.md) for the actual equations, controls and limits. Sources: `construction/RealmForgeHouseServices.js`; `construction/RealmForgeHouseWater.js`; `construction/RealmForgeHouseWiring.js`; `modeler/water/RealmForgePipeWaterRuntime.js`.

Hollow collision support already exists for pipe ring sectors and basin walls with pierced bottoms. Reuse it where appropriate and add actual passage/drop tests for each new container family. Do not assume every hollow-looking mesh has the correct physical cavity. Source: `construction/RealmForgeFixtureComponents.js:16`, `:107`.

[EPA EPANET](https://www.epa.gov/water-research/epanet) provides a reference for pressurized node/link networks and valves/tanks; [EPA SWMM](https://www.epa.gov/water-research/storm-water-management-model-swmm) covers drainage and sanitary networks. Use their network-modeling approach to inform a bounded gameplay model; keep local visible fluid effects as a separate, coupled layer. This proposed split is our recommendation and does not establish engineering or building-code validity.

Building programs now opt into distinct units, entrances and shared circulation for bounded duplex, apartment, hotel, motel and business layouts. Ordinary multi-storey houses still use the repeated dwelling plan. The new program is not an unrestricted commercial floor planner; measured dimensions, floor/unit counts and utility capacities remain constraints. Sources: `construction/RealmForgeBuildingProgram.js`; `construction/RealmForgeMultistoreyHouse.js`; `construction/RealmForgeBuildIntent.js`; [buildingSMART IfcSpace](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcSpace.htm).

The bounded [window catalog](realmforge.md#window-catalog-research-and-next-steps) now separates fixed/casement/awning/sliding operation, rectangular/arched/round shapes and clear/stained glazing. Sliding requires rectangular openings. Fixed skylights cut the actual roof and ceiling; opening skylights remain unsupported. Custom sizes, bay/bow assemblies and sun tunnels remain future work. Stained pane geometry, optical transmission and colored light on other surfaces are separate rendering milestones. Sources: `construction/RealmForgeWindowOptions.js`; `construction/RealmForgeHouseWindows.js`; `construction/RealmForgeBuildIntent.js`.

## Performance, interoperability and acceptance

Measure a furnished house at one, three and five floors before changing budgets. Record typing-to-first-preview latency, generation stages, retained bytes, input-pick latency, active bodies and frame time. Generation already runs in a worker. Explore serializes preparation, cancels obsolete requests and prioritizes selected/visible cards. Its default count limits also enforce estimated 64 MiB prepared-data and 8 MiB thumbnail budgets. Evicted cards are prepared again on selection; the selected exact assembly remains owned through preview and Build. These estimates are not whole-browser or GPU-memory measurements. Sources: `construction/RealmForgeProceduralHouse.js`; `catalog/RealmForgeExploreController.js`; `catalog/RealmForgeExploreMemory.js`; `modeler/ui/RealmForgeExplorePanel.js`.

The focus picker scans nodes and triangle candidates, then runs again after physics refreshes. Reuse `engine/core/math/AabbBvh.js` for broadphase/ray queries if the benchmark warrants it, with refitting for moving parts and preserved visibility/occlusion. This is an identified scaling risk, not a measured performance regression. SideFX's dependency-based invalidation offers a model for rebuilding only changed generation work. Sources: `modeler/viewport/RealmForgeArticulationFocusInput.js:16`; `modeler/ui/ModelerPanel.js:9470`; [SideFX incremental cooking](https://www.sidefx.com/docs/houdini/tops/cooking.html).

Physics already supports sleeping and active-actor readback. The avoidable work to measure is downstream: RealmForge builds matrices for every supplied node, then the viewport marks all instance data dirty and uploads its batches. Carry changed stable part IDs into sparse matrix/batch updates before increasing furnished-building budgets. Do not edit the protected physics bindings for this. Sources: `construction/runtime/RealmForgeConstructionPresetPhysics.js:3279`; `modeler/viewport/ModelerViewport.js:3732`, `:4834`; `engine/sim/physics/PhysXPhysicsWorld.js:836`; [PhysX active actors](https://nvidia-omniverse.github.io/PhysX/physx/5.4.1/docs/RigidBodyDynamics.html#active-actors).

The GLB path now retains supported material groups, PBR/unlit appearance, embedded textures and UV transforms alongside skins, morphs and animation. Unsupported appearance fails explicitly. Continue independent validator and external-viewer checks as coverage expands. Construction JSON sidecars and the native document retain a different role from visual GLB data. Sources: `export/GLBAppearance.js`; `export/GLBWriter.js`; `export/RealmForgeSessionExport.js`; [Khronos glTF Validator](https://github.com/KhronosGroup/glTF-Validator).

The current Khronos registry lists `KHR_interactivity`, `KHR_animation_pointer` and `KHR_lights_punctual` as ratified. Plan a tested export/import subset and show what geometry, materials, animations, lights and behavior survive each target. An ordinary GLB export is not proof of interactive behavior, physics or RealmForge state portability. Keep native source and state authoritative when the destination lacks a capability. References: [Khronos extension registry](https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md), [interactivity specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_interactivity/Specification.adoc).

The recommended furnished-room milestone should pass these checks:

1. Keyboard, tap and wheel controls operate the same measured door/drawer.
2. Save/reopen restores two independently placed copies with different states.
3. A lamp changes nearby illumination, and its switch state persists.
4. Book identity, marks and placement survive a cabinet retrieval and return.
5. A filled tray conserves its contents through a supported move and interruption.
6. Actor claims reject double occupancy and release cleanly on cancellation.
7. Low frame rate, seek and duplicate action requests do not duplicate effects.
8. Fit failures distinguish invalidity, sampled-search failure and budget exhaustion.

The existing 165-test interaction/storage receipt remains scoped historical evidence at `tmp/realmforge-mechanism-controls/verification.json`. It does not prove these proposed capabilities. Future acceptance should bind receipts to source/dependency versions and keep failed runs visible.

The catalog restart harness uses two sequential browser processes sharing one profile and origin, with actual account storage and asset reopening. Its fixtures cover reviewed complete definitions and saved designs, plus a filled shelf with marked books, finite object state and a water checkpoint. Archive checks preserve every book value and PNG while ignoring JSON object insertion order; each archive checksum is checked against its original serialized payload before normalization. A fixture's existence is not a passing receipt. Sources: `tests/run_realmforge_catalog_restart.py`; `tests/realmforge/catalog-restart.test.js`.

## See also

- [RealmForge workbench](realmforge.md)
- [Object actions and animation](realmforge-object-actions.md)
- [RealmForge bake pipeline](virtual-realm/realmforge-pipeline.md)
- [Genesis Ecology expansion](realmforge-genesis-ecology.md)
