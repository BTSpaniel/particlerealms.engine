---
title: RealmForge usable interiors
description: Fill shelves, edit room contents, run object actions and save independent operating state.
updated: 2026-09-30
---

<!--
SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
-->

# RealmForge usable interiors

RealmForge uses one generated assembly for preview, Apply, construction playback and editing. Shelf contents and operating state retain their actual object identities. A preview changes presentation; Apply or Save creates the guarded document transaction.

## Find your tools

The command bar keeps the asset name, workspaces, Explorer and Inspector controls visible. The viewport toolbar sits above the model. **Fit view** frames the complete asset; **Project** opens the searchable hierarchy when needed. **Object tools** groups Books, Storage, Utilities, Actions, Water and diagnostic copying. Navi stays compact until its recipes or proposal review are opened.

In Explore, the selected design and its **Build selected** and **Open in Simulate** actions appear before the thumbnail gallery. Expand the design details to inspect requirements and save or compare it. Use arrow keys, Home and End to move keyboard focus among available preview cards; activate a card to select it.

Select a queued card to prepare that design next, after the current preparation
finishes. The progress bar shows completed candidates; a selected queued card
remains a preview request until its complete assembly is ready. Build stays
disabled during preparation. **Requested features** summarizes structured
choices such as lights, switches and window sizes. Saved searches match those
complete requirements, including lighting, decks, mirrors and door movement;
they do not substitute a simpler saved design.
Window defaults used for new generation do not hide existing saved designs.
Typing a window requirement filters that feature; choosing a full window profile
in Refine filters the complete profile.

**SDF is the default renderer.** Its status distinguishes the selected preference from what is actually drawing. Mesh remains visible while distance fields prepare or when SDF cannot render the current asset. Construction reveal can use Mesh to preserve exact per-piece visibility. The existing SDF renderer uses material colors and does not project UV textures; select Mesh when inspecting those textures.

When you zoom out, procedural Mesh grain and surface speckles fade toward their average color as they become smaller than a pixel. Mesh and SDF render at twice the output width and height, then combine four scene samples per displayed pixel before edge smoothing. This reduces dotted patterns from tiny board bevels. The smoothing includes the contrast-weighted subpixel filter described in [NVIDIA's FXAA whitepaper](https://developer.download.nvidia.com/assets/gamedev/files/sdk/11/FXAA_WhitePaper.pdf). The active scene target has a 64 MiB budget; atomic resizing temporarily retains old and new targets, bounded at 128 MiB, in addition to the viewport's output depth. Large viewports or allocation failures retain ordinary-resolution smoothing, with direct rendering as the final fallback. Project Navigator text is drawn afterwards. Construction playback retains its exact staged-piece pixel masks.

SDF uses the same studio lights and display-color conventions as Mesh. Its baker counts shared triangle edges once and preserves valid thin-stock surfaces. Proven closed boxes and bounded convex solids use their actual surface planes and normals. Verified closed extruded profiles retain exact frame apertures and thin seals. This prevents coarse distance fields from rounding sheet edges, filling window openings, opening false roof joints or inventing curved bands on long beveled boards. Admission checks the uploaded triangles and closed topology; profiles with intersecting caps, cracks or taper retain sampled fields. Exact shapes share a trivial texture binding, supporting up to 4,096 geometry prototypes while retaining the existing 256 sampled-volume limit. These presentation changes do not simplify the saved geometry or change picking, dimensions, connections or Undo history.

Sources: `modeler/ui/ModelerPanel.js`, `modeler/ui/RealmForgeWorkbenchStyles.js`, `modeler/ui/RealmForgeExplorePanel.js`, `modeler/viewport/ModelerViewport.js`, `modeler/viewport/RealmForgeViewportAntialiasing.js`, `modeler/viewport/RealmForgeSDFViewportRenderer.js`, `modeler/viewport/RealmForgeSDFConvexGeometry.js`, plus `engine/render/sdf/SDFBakeCompute.js` and `engine/render/passes/FXAAPass.js` (repository root).

## Inspect an exploded assembly

Open **Assembly view** and choose a preset. **Overview** separates authored groups while keeping their pieces together. **Layers** stacks groups vertically using their measured bounds. **Connections** separates individual pieces using the authored connection graph. Each preset activates the exploded view and fits it into the viewport.

Choose **Automatic**, **Groups** or **Parts**, adjust **Spacing** from 0–200%, and choose an automatic or X/Y/Z direction. Automatic uses groups for an overview and individual parts when inspecting one group. Explicit axes stack the selected units in their original spatial order; at 100% spacing, valid measured bounds separate along that axis. Lower spacing interpolates toward home. These are inspection layouts, not a physical disassembly sequence.

To inspect one wall, cabinet or other authored group, select it in Project Navigator and set **Scope** to **Selected group**. Other groups stay assembled. The captured group remains the target when you select another item; choose Selected group again to retarget. A missing saved group is reported explicitly. Choose **Whole model** to return to the entire assembly.

Enable **Show home position guide lines** to trace separated pieces back to their assembled positions. Selecting a part or group narrows the guides to that selection. Large assemblies report omitted guides rather than drawing an unlimited overlay. **Fit exploded** frames the presented assembly; **Focus selected** frames a selected part or group. Adjusting the spacing slider preserves the camera. **Assemble** restores the original transforms and frames the assembled model while retaining the spacing preference.

Use **Assembly progress** to scrub from the assembled position at 0% to the selected exploded layout at 100%. **Spacing** still controls the final separation distance. **Animate explode** or **Animate assemble** starts the preview; **Pause** holds the current position. **Reverse** changes direction from that position. Choose 0.5×, 1× or 2× speed. The camera fits the complete exploded endpoint once at playback start, then stays still while parts move.

Scrubbing pauses the preview. Motion stops at either endpoint, when the viewport is suspended, or when the scene or layout changes. Simulation and construction playback must stop before assembly animation can run. Reduced-motion preferences retain manual scrubbing. Workspace save/reopen restores paused progress, direction and speed; it never starts animation automatically.

These controls change presentation only. Picking follows the displayed parts, and the source geometry, physical joints and Undo history retain their authored state. Workspace save/reopen restores the layout, spacing, axis, guides, captured group and selection. An exploded illustration does not establish a collision-free disassembly path.

The controls draw on [Autodesk Fusion's group levels, animated transformations and Restore Home](https://help.autodesk.com/cloudhelp/ENU/Fusion-Animate/files/ANI-TRANSFORM.htm) and [Onshape's adjustable translations, explode lines and intermediate-step preview](https://cad.onshape.com/help/Content/Assembly/exploded_views.htm). The continuous progress scrubber adapts these ideas to RealmForge's own connection graph and stable part identities.

Sources: `modeler/viewport/RealmForgeViewportProjectNavigator.js`, `modeler/viewport/ModelerViewport.js`, `modeler/ui/ModelerPanel.js`, and `modeler/workspace/RealmForgeWorkspaceContracts.js`.

## Simulate a selected design

Select an Explore card, then use either **Simulate** control. RealmForge waits for that selected design's preview if it is still loading, creates it as one new asset, and opens that asset in Simulate. The viewport control also starts playback. Duplicate clicks cannot create duplicate assets. Review mode, unfamiliar patterns and approximated descriptions still require their existing review and Apply step.

Background gallery preparation, unchanged-source recompilation and workspace saves retain the selected preview. Changing the description, active document or account retires its pending handoff. SDF and Mesh previews retain that same selected assembly; build the design before switching it to Voxel or Nexel. The heading and Project Navigator describe the same visible design.

While a native simulation runs, aim at a visible hinged door or sliding panel to use the mouse wheel, Open/Close and Lock/Unlock controls. The same controls work while paused. Locks, obstruction checks and measured physical movement still apply; operating a panel does not create a geometry-edit Undo entry.

Sources: `modeler/ui/ModelerPanel.js`, `modeler/viewport/ModelerViewport.js`, `tests/realmforge/explore-simulate-handoff.test.js`, and `tests/realmforge/mechanism-workbench.test.js`.

## Operate house door hardware

New houses use paired handles that turn together and retract a separate spring latch. Releasing **Hold handle** returns the handles and latch. The front entry also has an independent deadbolt with an interior thumbturn and exterior key cylinder. Interior and other passage doors have no deadbolt or invisible lock.

Aim at the door or its hardware in a prepared native simulation. Hold **Hold handle** with the mouse, Space or Enter to inspect the latch movement. Use the mouse wheel, **Open**, **Close**, or O/C to operate the leaf; these controls retract the spring latch before opening. **Lock deadbolt**, **Unlock deadbolt**, or L operates the entry bolt. A locked deadbolt keeps the door closed even while its handle turns. Locking an open door is refused. Controls work while paused, and interruption releases a held handle.

The door-hardware house generator is version `3.0.0`, selected by mechanism profile schema version `2`; current window designs wrap it with the newer composition generator described below. Previous house generator versions retain their original geometry and dependencies. To add this hardware to an older generated house, use **Edit this generated design** and prepare the updated design before applying it. New builds include the hardware by default. Saved operating state restores settled door coordinates and deadbolt state without baking actuator poses into the native rest geometry. Operating controls do not add design Undo entries; saving operating state uses the existing guarded object-state transaction.

Current-profile household wiring measures the actual finished floor, including a raised crawlspace foundation, before placing devices and routing cables. Its route checks use the doors' swept solids with padding between angular samples. A blocked complete design is refused; the compiler does not discard hardware or shorten the requested door travel.

The model uses a 60 mm backset, 140 mm separation between handle and deadbolt centers, 12.7 mm spring-latch travel and 25.4 mm deadbolt throw. The preparation dimensions follow [Schlage's B-Series and D-Series door preparation instructions](https://commercial.schlage.com/content/dam/allegion-us-2/web-files/schlage/installation-documents/Schlage_B-Series_and_D-Series_Door_Preparation_Instructions_108379.PDF); the bolt throw follows the [Schlage JD60 deadbolt specification](https://www.schlage.com/en/home/products/JD60FFF.html?bvstate=pg%3A2%2Fct%3Ar). Authored receiving pockets and strike openings provide clearance. The leaf uses the native physical hinge and catch. Handle and bolt motion is constrained gameplay actuation layered on measured leaf motion, without a fine force model of the lock internals. Rectangular gameplay bores are recorded explicitly; these models do not certify a real door or lock installation.

Sources: `construction/RealmForgeDoorHardware.js`, `construction/RealmForgeBuildFamilies.js`, `construction/RealmForgeBuildIntent.js`, `construction/RealmForgeHouseWiringLayout.js`, `construction/RealmForgeHouseWiring.js`, `construction/runtime/ConstructionDoorHardwareRuntime.js`, `construction/runtime/RealmForgeConstructionPresetPhysics.js`, `modeler/viewport/RealmForgeArticulationFocusInput.js`, `modeler/viewport/ModelerViewport.js`, and `modeler/ui/ModelerPanel.js`.

## Design and operate house windows

New house definitions use room-based proportions and window-options schema `2`, with double-hung windows, full insect screens and double Low-E glazing by default. Bathroom, bedroom and living-room openings have distinct sizes and sill heights. Explicit widths, heights and sill heights change the actual cuts, wall layers and framing; a design that cannot retain the requested openings is rejected.

Open **Build → Build options and patterns → Windows · sizes, screens & glass**, or the same window controls under Explore's **Refine these designs**. Keep **From description or saved design** to follow the words or a pinned pattern. Choose **Customize windows** for house-wide settings. After preparing a house, select **Selected individual window**, choose its measured opening, edit its settings and use **Use these settings for this window**. Preview again before applying. Individual overrides retain their opening IDs, including level prefixes in multi-storey buildings.

Supported types are fixed, horizontal sliding, single-hung, double-hung, outward casement, outward awning and inward tilt-and-turn. Rectangular, arched and round profiles have compatible options; incompatible shape, screen and travel combinations are rejected. Wood, vinyl and aluminium frames include separate sashes, sill, seals, glazing layers and spacers. Colonial and prairie grids support applied bars or actual divided glass cells. Hung windows have separate tracks and balance hardware. Casement and awning arms follow their measured native sash coordinates while retaining the authored arm length.

Prepare physics in Simulate, then aim at a sash or its hardware. Use the wheel, **Open**, **Close** and **Lock/Unlock** to operate that sash. Each double-hung sash has its own control. Tilt-and-turn exposes **Turn inward** and **Tilt inward**; close and latch the sash before changing modes. **Remove screen** hides the complete screen and retires its separate collision bodies. **Replace screen** restores them. A screen selector also serves fixed windows. Operating state saves sash coordinates, mode, lock and screen installation separately from the design's rest geometry. Return tilt-and-turn windows to their closed Turn mode before changing assembly connections through damage or repair.

Clear, tinted, frosted and stained appearances combine with one, two or three glass layers, Low-E coating and clear-solar, solar-tinted, reflective or frosted film. Mesh and SDF display transmitted colour, angle-dependent studio reflections and filtered insect mesh. These are optical previews, without true scene refraction or an HVAC simulation. The separate VLT, SHGC and U-factor values are explicitly estimated gameplay presets, not certified product ratings. Reflective privacy depends on lighting. Wood mass uses the selected Eastern Spruce condition; gaskets use the nominal density of [Shin-Etsu KE-951-U silicone](https://www.shinetsusilicone-global.com/guide/rubber/products/ke-951-u/), with authored rigid profiles.

Current house catalog definitions are version `4.0.0`; schema-2 windows select `realmforge.design.composition@2.0.0`. The earlier door-hardware house generator remains `3.0.0`. Historical definitions and schema-1 windows retain their exact output hashes and dependencies. Complete reusable window patterns keep every option and require the existing definition review before Auto Known can reuse them. AI previews list bounded dependency samples with complete inventory counts and a hash; previewing never grants build or pattern approval.

The component and control design follows [Andersen's grilles](https://www.andersenwindows.com/windows-and-doors/options-and-accessories/grilles) and [screens](https://www.andersenwindows.com/windows-and-doors/options-and-accessories/screens), [AmesburyTruth's casement hinge hardware](https://www.amesburytruth.com/products/windows/casement/hinges/maxim-hinges), [Roto's tilt-and-turn system](https://www.ftt.roto-frank.com/int-en/products/details/roto-nx/), [3M's film guidance](https://www.3m.com/3M/en_US/home-improvement-us/diywindowfilms/) and [NFRC's separate performance metrics](https://nfrc.org/). Generated assemblies are compatible gameplay designs rather than copies of certified manufacturer units.

Sources: `construction/RealmForgeWindowOptions.js`, `construction/RealmForgeWindowLayout.js`, `construction/RealmForgeHouseWindowAssemblies.js`, `construction/RealmForgeWindowMaterials.js`, `construction/runtime/ConstructionWindowHardwareRuntime.js`, `construction/runtime/RealmForgeConstructionPresetPhysics.js`, `interactions/RealmForgeObjectStateDocument.js`, `modeler/ui/RealmForgeWindowDesignControls.js`, `modeler/ui/ModelerPanel.js`, and `modeler/viewport/RealmForgeSDFViewportRenderer.js`.

## Fill a shelf or container

Open an editable bookcase, cabinet, basket or box and select **Object tools → Storage** above the viewport. Choose the measured storage areas and quantities of books, vases, figurines, photo frames, plants, baskets and boxes. Book ordering, orientation and gap controls use the same complete fit check as ordinary placement. Preview shows the complete candidate. Apply creates one Undo entry.

The organizer can use books already saved in the asset or imported RealmBook archives. It retains their page contents, ink, marks and bindings. It measures the saved closed book instead of stretching it to fit a shelf. A selection that cannot fit produces an explicit failure without adding a partial set. **Carry contents** moves a filled container as one checked group; the contained objects keep their IDs and relative frames.

Retrieval and return previews use actual openings and mechanism travel. A partly open drawer starts at its saved position. Another open drawer can obstruct retrieval. An open basket needs clearance over its measured rim; a shelf above it can still prevent removal.

Sources: `storage/RealmForgeStorageDocument.js`, `storage/RealmForgeStoragePanel.js`, `storage/RealmForgeStorageGeometry.js`, `storage/RealmForgeStorageAction.js`, and `construction/RealmForgeShelfProps.js`, relative to `webgpu-os/apps/realmforge/`.

## Specify room contents

Build from words accepts explicit rosters such as “bedroom containing two chairs, a table and a bookcase.” The **Custom contents** editor also accepts quantities, dimensions, support/containment, facing, adjacency and exact pinned placement. House-room editing targets a concrete measured room. Applying that roster preserves other rooms and the original shell.

For example, a roster can put books in a bookcase, a vase on a table, and a figurine in a box on that table. Placement checks the actual generated pieces, clearances, ceiling and walking access. Supported and contained gaps are limited to 2–50 mm. Requests outside a family's dimensions or current placement capabilities remain visible errors; no object is silently resized or omitted.

Supported object families and their parameter ranges come from the shared build catalog. OCR concepts and spelling recovery help interpret text; a new dictionary word alone does not register geometry. Echo uses the same structured compiler. Version-three reusable definitions retain complete design parameters, dependencies and separate review receipts. Changed definitions require fresh review before Auto Known can use them.

Sources: `construction/RealmForgeContentsContracts.js`, `construction/RealmForgeContentsComposition.js`, `construction/RealmForgeHouseRoomBuild.js`, `modeler/ui/RealmForgeContentsEditor.js`, `construction/RealmForgeBuildIntent.js`, and `construction/RealmForgeBuildLibrary.js`.

## Operate and save objects

Select **Object tools → Actions** above the viewport. The finite pill bottle has separate remove-lid, replace-lid and shake-out actions. It moves the existing lid and pills through a bounded authored timeline. Play, pause and scrub only preview the action. Keep completes it locally; Save persists its pose, semantic values and marker receipts as one Undo entry. Cancellation restores the starting pose. Completed markers cannot produce duplicate pills.

This is controlled object animation. Scripted shaking does not establish free physical pouring or fluid dynamics. Native door, window and drawer controls use their existing physical joints, locks and latches. Saved mechanism state includes moving handles and members; fresh physics restores the requested coordinates sequentially and waits for measured arrival.

The actor-use runtime supports reserve, approach, use and release against existing seat and bed anchors. It requires measured host movement, actor dimensions, reach, collision checks and a checked exit. The workbench adapter operates the existing Navi companion body when that host is available. It does not supply a complete humanoid animation or NPC navigation system automatically.

Existing beds and sofas that use generic foam or polyester retain their anchors, but missing sourced mass still blocks native preparation. The runtime reports the missing evidence. The native chair checks use physically fitting actor envelopes and retain refusal checks for oversized actors.

For a new build, choose **Selected foam + fabric (native use)** in **Bed and sofa upholstery**, or request “bed with sourced upholstery.” The explicit `carpenter-hpr11250pe-camira-xtreme-v1` profile assigns selected product grades to actual generated bed and sofa cushioning. It preserves the measured geometry, connections and seat or laydown anchors. Other textiles, including rugs, retain their existing unresolved mass.

The [Carpenter Tranquility HPR11250PE technical sheet](https://carpenter.com/wp-content/uploads/2023/02/Carpenter_Foams_july2022.pdf), January 2023, page 3, supplies a nominal density of 2.50 lb/ft³, approximately 40.046 kg/m³. It does not publish a density tolerance for this grade. The [Camira Xtreme YS TSR14 product information](https://content.camirafabrics.com/media/d1vjuqyi/xtreme_ys.pdf), page 4, supplies an areal mass of 310 g/m² ±5% and a minimum roll width of 1.4 m. The compiler records checked joined panels for wider cover faces. Fabric mass uses their net flat area; the visible rigid envelope thickness never becomes an invented fabric bulk density. Sewing thread and additional seam allowance need separate evidence.

Focused CPU checks verify complete nominal mass, native preparation readiness, preserved anchors, definition replay and room or house composition. This evidence does not establish actual native actor entry, lying or exit acceptance. The selected profile also does not simulate cushion compression or cloth deformation, measure production-batch mass, or certify mattress, seam or fire performance.

Sources: `interactions/RealmForgeObjectActionRuntime.js`, `interactions/RealmForgeObjectStateDocument.js`, `interactions/RealmForgeActorUseRuntime.js`, `interactions/RealmForgeInteractionsPanel.js`, `construction/RealmForgeBottleComponent.js`, `construction/RealmForgeUpholsteryProfiles.js`, `construction/RealmForgeUpholsteryComposition.js`, `construction/runtime/RealmForgeConstructionPresetPhysics.js`, `modeler/ui/RealmForgeProceduralBuildPanel.js`, `modeler/ui/ModelerPanel.js`, and `tests/realmforge/upholstery-composition.test.js`.

## Run household water

Generate a plumbed house with running water, then select **Water**. Operate actual fixture taps, mixing fractions and isolation valves. The bounded hydraulic graph reports flow, pressure, temperature and conserved supplied/drained volume. Blue route tracers show the solved flow along authored pipe paths. These tracers are presentation; the separate local pipe inspector remains the engine SPH particle path.

Save persists a water-model checkpoint independently of authored geometry. Reopening restores the controls, thermal state and volume totals. Changing the water model invalidates its old checkpoint. [Building programs and utilities](realmforge-building-utilities.md) describes the supported supply, drain, tank and appliance model boundaries.

Sources: `construction/RealmForgeHouseWater.js`, `modeler/RealmForgeWaterRuntime.js`, `modeler/RealmForgeWaterPanel.js`, and `modeler/RealmForgeWaterFlowPresentation.js`.

## Verification

The focused browser suites are `mixed-storage`, `contents-composition`, `object-interactions`, `storage-geometry`, `building-utilities-expansion`, `interior-workbench`, `interactions-native` and `windows-native`. CPU geometry/document checks, native PhysX/WebGPU checks and actual Chromium process-restart persistence are separate evidence. Read the current source-bound receipt before treating a capability as runtime accepted.

The native workbench checks retain the same visible parts across Build, Construct, Simulate and Review. Sparse matrix publication reuses the viewport's existing update path, so unchanged transforms do not trigger instance batch uploads. This does not establish a performance target for the largest furnished building.

Door-hardware checks independently derive historical assembly fingerprints, compile current furnished and service-equipped houses, verify strict hardware mappings, and test handle/latch/deadbolt independence. The native house workbench test operates the actual hinge and focused controls, commits one operating-state transaction, then reopens the saved lock. Trusted Chromium pointer tests separately exercise handle hold/release, deadbolt toggling and native opening/closing; they capture the rendered hardware and check narrow controls. Sources: `tests/realmforge/door-hardware-geometry.test.js`, `tests/realmforge/door-hardware-runtime.test.js`, `tests/realmforge/door-hardware-composition.test.js`, and `tests/realmforge/door-hardware-workbench.test.js`.

Sources: `tests/realmforge/interior-workbench.test.js`, `tests/realmforge/interactions-native.test.js`, `tests/realmforge/windows-native.test.js`, `tests/realmforge/catalog-restart.test.js`, `tests/run_realmforge_catalog_restart.py`, and `modeler/viewport/ModelerViewport.js`.

## See also

- [RealmForge workbench](realmforge.md)
- [Building programs and utilities](realmforge-building-utilities.md)
- [Electricity and control boards](realmforge-electricity.md)
- [Improvement research](realmforge-improvement-research.md)
