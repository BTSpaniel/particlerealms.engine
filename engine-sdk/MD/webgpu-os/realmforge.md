---
title: RealmForge v2 Workbench
description: Build reusable assets and product-level construction assemblies in the source-authoritative RealmForge v2 workbench.
audience: asset authors, simulation developers, AI-tool integrators, and security reviewers
updated: 2026-10-01
---

# RealmForge v2 Workbench

RealmForge is the default WebGPU OS workbench for `.proasset` 2.0.0 assets. Its
template-first workflow builds furniture, vehicles, characters, and buildings
from reusable semantic parts. It also combines an editable SystemGraph,
Engine-backed preview adapters, guarded AI operations, and trusted artifact
publication. This guide is for asset authors, simulation developers,
AI-tool integrators, and security reviewers. (Sources:
`webgpu-os/apps/realmforge/manifest.json`;
`webgpu-os/apps/realmforge/factory.js`;
`webgpu-os/apps/realmforge/document/constants.js`.)

## Open the v2 workbench

Launch **RealmForge** from the WebGPU OS app catalog. A true first launch creates
`/user/projects/realmforge/getting-started.proasset` from `Room.ChairDemo` and
enters the Modeler workbench. RealmForge restores a verified active document on
later launches. A recovery state takes precedence and opens the Recovery view.
(Source: `webgpu-os/apps/realmforge/factory.js`.)

Asset Home is an explicit library surface, not a first-launch gate. Select
**Library** in the workbench to create another asset, open a v2 asset, reopen a
recent asset, or preview a v1 migration. New and migrated documents enter the
Modeler only after their durable root reopens with the expected semantic
content hash. There is no v1 authoring workbench in the launch path. (Sources:
`webgpu-os/apps/realmforge/factory.js`;
`webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`;
`webgpu-os/apps/realmforge/ui/RealmForgeStartView.js`;
`webgpu-os/apps/realmforge/document/lifecycle/RealmForgeActiveDocument.js`.)

## Explore procedural designs

Select **Build** to open **Explore** in the workbench sidebar. **Discover**
starts with six varied cabin, cottage, and bungalow designs. Type `house` to
browse the house family, then add requirements such as `timber`, `one bedroom`,
or `single-slope roof`. Requested features stay fixed while unspecified
parameters vary. **Refine these designs** offers matching controls. Incomplete
words offer suggestions. Clear spelling mistakes resolve locally, with the
original and interpreted words shown. Other unmatched words produce labelled
**Approximate match** starting points that retain the supported requirements.
The sidebar lists the words those designs do not include. Select a preview
and press **Build shown design** to use that exact result. Recognized unsupported
features, conflicting requirements, and invalid dimensions still block building.
Choose **Houses**, **Rooms**, **Furniture**, **Decoration**, or **Electronics** to browse a category. Typing
a specific family, such as `office chair`, `table`, or `rug`, selects its
category. Controls follow the selected family: furniture exposes its supported
dimensions and finishes; houses expose rooms, roof, furnishing, and decoration.
Typing and browsing do not call AI or change the active asset. (Sources:
`webgpu-os/apps/realmforge/catalog/RealmForgeExploreQuery.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeExplorePanel.js`.)

Thumbnails render the generated construction pieces. Select a card to inspect
that exact assembly in the main viewport. **Exterior** and **Floor plan** show
the outside and a horizontal section through the rooms. Visible height edges
help distinguish furniture from floors with the same finish. The section is an
inspection view, not a dimensioned construction drawing. **Compare** keeps up
to two selected designs together. **More variations** browses another batch;
**More like this** varies unlocked parameters around the selected design.
Complete reusable designs retain their exact composition instead of varying
their pinned parameters. Custom control-board wiring is edited through the
Utilities contact editor, rather than **More like this**.
(Sources: `webgpu-os/apps/realmforge/ui/RealmForgePreparedBuildThumbnail.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeExplorePanel.js`.)

**Build selected** submits the already compiled preview through the guarded
Build controller. Auto Known builds reviewed combinations immediately; Review
opens the matching **Apply reviewed build** action. **Build options and
reusable patterns** contains the destination, seed, text builder, and definition
editor. The destination defaults to a new asset. **Explore this description
with AI Echo** transfers an
unfamiliar description to the explicit text builder; pressing its Build action
submits the AI request. (Sources:
`webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeBuildController.js`.)

The title and project navigator identify the assembly currently displayed.
A selected gallery design shows **Preview** in the title. Clicking the top
**Simulate** tab builds that exact selection as a new asset and opens it in
Simulate. The viewport **Simulate** button also requests physics playback.
Review mode and approximate matches still require **Apply**; unreviewed
definitions keep their existing review requirements. A failed or unavailable
build keeps the selected preview visible and reports the reason. The previously
opened asset remains available in the library. (Sources:
`webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeProceduralBuildPanel.js`;
`webgpu-os/apps/realmforge/factory.js`.)

**Save design** adds its resolved intent and pinned definition references to
the current account's **Saved** collection. Reopening regenerates the exact
design and checks those versions and their current review status. Saving a
favorite does not approve a reusable pattern. Missing versions remain errors;
Explore does not substitute newer definitions. Account changes and retired
requests cannot publish late results. (Sources:
`webgpu-os/apps/realmforge/catalog/RealmForgeExploreCollection.js`;
`webgpu-os/apps/realmforge/catalog/RealmForgeExploreController.js`.)

Explore waits 350 ms after typing and prepares one candidate at a time, giving
the selected and visible cards priority. The default cache limits are eight
prepared assemblies within an estimated 64 MiB and sixteen thumbnails within
an estimated 8 MiB. These estimates bound retained preview data; they are not
a measurement of total browser or GPU memory. The selected assembly stays
retained while other cards may release their full geometry. Selecting a released
card prepares that exact intent again before showing or building it. A design
larger than the gallery budget reports the limit and directs you to Build options.
Changing the request cancels obsolete work; hiding the sidebar suspends it.
The existing catalog remains available through **Browse all assets and
recipes**. Vehicle and character families remain in that catalog until they
gain the same procedural intent interface. (Sources:
`webgpu-os/apps/realmforge/catalog/RealmForgeExploreController.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeExplorePanel.js`;
`webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`.)

## Build from words

In **Build**, expand **Build options and reusable patterns** and use
**Build from words**. Enter, for example:

> A 6 × 8 metre timber cottage with one bedroom, a single-slope roof, and a front porch

Select a destination and press **Build**. **New asset** is the default and
publishes the complete generated design as a separate `.proasset`. **Edit this
generated design** explicitly replaces the previous generated design while
preserving unrelated document content. Each successful build adds one Undo
entry. Changing playback never changes the saved design. (Sources:
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeProceduralBuildPanel.js`;
`webgpu-os/apps/realmforge/document/lifecycle/RealmForgeActiveDocument.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeConstructionDocumentTransaction.js`.)

| Build mode | Behaviour |
| --- | --- |
| Auto Known, default | Resolve supported words, clear typos, and reviewed patterns locally. Exact supported combinations build without AI. A safe approximate design waits for **Build shown design** instead of committing automatically. |
| Review | Prepare a design and show its viewport preview. **Apply reviewed build** commits that exact prepared assembly. Unfamiliar descriptions can use the linked AI Echo route. |
| AI Explore | Ask Echo to interpret unfamiliar descriptions using registered family parameters. Try at most three candidates, validate locally, and construct the accepted result. A proposed reusable pattern stays pending until you review it. |

Interpretation shows resolved dimensions, layout, materials, roof, seed, and
defaults. For example, `white talbe` resolves to `white table`; `white table
blorptastic` previews a white table with `blorptastic` explicitly excluded.
The local matcher protects real dictionary words and custom pattern names;
it does not assume every unfamiliar word is a typo. A description without a
known family can browse starting points in the selected Explore category.
The text builder needs a known family or AI interpretation. Review without
an Echo connection can also prepare a safe local approximation for explicit
review. Conflicting requirements, impossible layouts, and capacity limits
cannot silently remove requested features. An unavailable Echo
connection reports a failure. Requests bind the active document revision and
are cancelled when their owner retires. Duplicate replies cannot apply twice.
The existing AI proposal **Apply / Reject / Revise** route remains separate.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeBuildIntent.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeBuildTextRecovery.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeBuildController.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeBuildEchoBridge.js`;
`webgpu-os/shared/realmforge-contracts/RealmForgeAIEchoContracts.js`.)

The house family supports rectangular homes with one to five floors. Single-floor dimensions are
metric: width 4–12 m, depth 4–16 m, wall height 2.4–3.6 m, and roof pitch 15–50°.
Choose studio, one-bedroom, or two-bedroom; timber or masonry walls; gable or
single-slope roof; natural, painted, white, red, or grey finish; and an optional
uncovered front porch. One-bedroom plans require at least 5 × 6 m; two-bedroom
plans require at least 6 × 7.4 m. The generator includes foundations, floors,
shared interior partitions, ceilings, doors, windows, and connected roof
members. **Log cabin** remains unsupported. Explicit plumbing
and wiring requests use the separate serviced-house workflow described in
**Add house plumbing and wiring**. (Sources:
`webgpu-os/apps/realmforge/construction/RealmForgeBuildIntent.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeProceduralHouse.js`.)

The names select real presets. **Cabin** starts as a 6 × 8 m timber studio with
a natural finish. **Cottage** starts as a 6 × 8 m one-bedroom masonry house with
a white finish and porch. **Bungalow** starts as an 8 × 10 m two-bedroom timber
house with a painted finish and porch. Explicit words override these defaults.
Equivalent descriptions with identical resolved intent, dependency versions,
and seed produce identical assemblies. (Source:
`webgpu-os/apps/realmforge/construction/RealmForgeBuildIntent.js`.)

### Build two to five floors

Try `a 9m by 10m two-storey timber cottage with two bedrooms, plumbing and electrical wiring`.
The selected room plan repeats on **each floor**: two bedrooms across five
floors means ten bedrooms. **Floors** and **Rooms per floor** make this visible
in the selected design. Choose **Floor plan**, then a floor to inspect its
actual compiled geometry. The main 3D viewport keeps the whole building visible.
Changing the inspected floor does not edit the asset or its playback state.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeBuildIntent.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeExplorePanel.js`;
`webgpu-os/apps/realmforge/ui/RealmForgePreparedBuildThumbnail.js`.)

Each floor has its own rooms, windows, ceiling and finished deck. A reserved
2.7 m stair hall contains two returning flights, a turn landing, handrails
and guards. Openings in upper decks, their framing and the lower ceilings
leave the stairs clear. The ground floor has the entrance and optional porch;
the top floor carries the roof. A 0.85 m zone between the lower ceiling and
the next finished floor accommodates floor framing and service routes.
These dimensions describe the gameplay assembly.
(Source: `webgpu-os/apps/realmforge/construction/RealmForgeMultistoreyHouse.js`.)

Windows in these multistorey plans follow the actual exterior edges of rooms.
Long living-room walls receive evenly spaced groups; shorter bedroom walls
receive a centered window. Repeated floors share window columns and a 2.05 m
head height. Bathroom windows have a higher 1.45 m sill. Openings leave at
least 0.30 m at corners and partitions and keep the rear service chase clear.
Stair-hall glazing sits beyond the flights. These are fixed rectangular
windows; the following catalog research describes future options.
The new plans also use versioned stud framing that clears each complete
opening, including high bathroom windows and openings in tall lower walls.
Earlier pinned pattern expansions retain their existing version.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeMultistoreyHouse.js`;
`webgpu-os/apps/realmforge/construction/patterns/StudWallPattern.js`.)

Multi-floor studio plans need at least 7 × 8 m, one-bedroom plans 8 × 8 m,
and two-bedroom plans 9 × 8 m. Width remains limited to 12 m and depth to
16 m. The complete design must fit the existing 20,000-piece budget; tall
masonry designs can exceed it. Unspecified dimensions increase to the
stair-hall minimum, and the built-in cottage uses timber as its multi-floor
default. Interpretation shows these choices. Explicit dimensions, materials
and custom pattern settings are preserved and rejected if they cannot fit.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeBuildFamilies.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeBuildIntent.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeMultistoreyHouse.js`.)

Plumbing adds a complete kitchen and bathroom on every floor. A reserved rear
chase carries shared cold-water, hot-water, sewer and electrical risers.
Branches connect each floor to those risers; the building keeps one external
connection for each service. Drains descend through the intervening floors
to the ground sewer outlet. Upper horizontal pipes must fit the service space
above the occupied room below. Legacy saved wiring uses a 24 V DC circuit with a 40 A main,
10 mm² riser conductors and independent 15 A room branches.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeMultilevelHouseServices.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeHouseServices.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeHousePlumbingFixtures.js`.)

New requests for electricity select the versioned household AC profile with
main and branch protection, room switches, ceiling lamps, outlets, wall plates
and passive Ethernet home runs. **Utilities** operates its circuit and saves
per-asset state. Standalone breadboards add low-voltage lamps, relays and
motors, with guarded jumper editing. See [Electricity and control boards](realmforge-electricity.md)
for profile controls, examples and modeling limits.

These builds use `realmforge-build-intent-v5`. Historical recipes retain
`realmforge.house.multistorey@1.0.0`; new mechanism-enabled designs select
`realmforge.house.multistorey@2.0.0`. The saved recipe includes floor count,
per-floor room assignments and services. In the existing-house controls,
choose the floor before its room; replacing an upstairs room preserves other
floors and unrelated authored content. Local known requests use the same
review, transaction, Undo and save paths as one-floor houses. Complete reusable
definitions use `realmforge-build-definition-v3` to retain floor count, room
assignments, services and explicit building options. Echo accepts the same
validated intent formats; it cannot approve its own reusable definition.
Explicit duplex, apartment, hotel, motel and business programs use a separate
versioned composition route. Their bounded unit layouts and common access are
described in [Building programs and utilities](realmforge-building-utilities.md).
Ordinary multi-storey houses retain the repeated dwelling layout.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeHouseRoomBuild.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeBuildEchoBridge.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeHouseRoomControls.js`.)

### Window catalog research and next steps

Generated houses now accept a bounded `windows` option separating operation,
shape, glazing and fixed skylights. Supported facade operations are fixed,
casement, awning and sliding; shapes are rectangular, arched and round; glazing
is clear or stained. Sliding requires rectangular openings. Skylights are fixed
and limited to two; requests for an opening skylight remain unsupported. These
options use measured openings and the complete-design generator, preserving
the historical window geometry when the option is absent. See
[Building programs and utilities](realmforge-building-utilities.md) for current
controls and limits. (Sources:
`webgpu-os/apps/realmforge/construction/RealmForgeWindowOptions.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeHouseWindows.js`.)

The broader research catalog separates operation, opening shape, glass and size.
Its remaining combinations are proposals, not additional implemented families.

| Choice | Proposed catalog options |
| --- | --- |
| Operation | Fixed, side-hinged casement, top-hinged awning, horizontal slider, single-hung, double-hung |
| Shape | Rectangle, square, circle, oval, arch, triangle, trapezoid |
| Grouping | Single, paired, transom, projecting bay, faceted bow |
| Glass | Clear, tinted, obscure/frosted, textured, patterned stained glass |
| Roof daylight | Fixed skylight, opening roof window, tubular sun tunnel |

These categories reflect the [Andersen window families](https://www.andersenwindows.com/windows-and-doors/windows)
and [specialty shapes](https://www.andersenwindows.com/windows-and-doors/windows/specialty-shape-windows).
Placement should combine interior room use and furniture clearance with
consistent exterior spacing and sightlines, as discussed in
[Marvin's architect guidance](https://www.marvin.com/blog/how-to-design-with-picture-windows).
The current placement rules are a bounded first step toward that catalog.

Store rough-opening dimensions, outer-frame dimensions and visible-glass
dimensions separately, in metres. An opening's nominal product size is not
automatically its clear glass area. For scale examples, VELUX lists roof
window sizes including 780 × 980, 780 × 1180 and 1140 × 1400 mm;
these are [manufacturer catalog examples](https://www.velux.co.uk/products/sizes),
not universal window standards.

Stained glass should compose colored panes and visible joining strips inside
a supported frame. The [V&A construction overview](https://www.vam.ac.uk/articles/stained-glass-an-introduction)
describes individual pieces held by lead cames. A colored material alone
does not establish colored light transmission in the renderer; that needs
separate rendering support and verification.

For a house description, show “sun roof → skylight” in the interpretation.
A skylight requires a genuine opening through the roof layers, surrounding
framing, flashing and a light shaft through an intervening ceiling. Roof
pitch and the chosen product must be compatible, following the distinction
in [VELUX installation guidance](https://www.veluxusa.com/help/installation-help/skylight-installation).
A [sun tunnel](https://www.velux.co.uk/products/sun-tunnels/sun-tunnels-for-sloped-roofs)
is a separate assembly with a roof collector, reflective tube and ceiling diffuser.

The current modifier implements bounded shaped glazing and stained pane
assemblies, plus fixed skylights with roof and ceiling openings. Custom numeric
window sizes, moving roof windows, bay/bow assemblies and sun tunnels remain
future work. New options must use the same versioned definitions,
real preview geometry, validation and review rules as other assemblies.

In Explore, a proposed **Windows** category should offer **Wall / Roof**,
then **Operation / Shape / Glass / Size**, with an explicit room or floor
target. Cards should show the compiled frame and its real opening in a wall
or roof sample. Available combinations must come from registered capabilities:
for example, introduce round and arched shapes as fixed windows before adding
their moving mechanisms. A glass choice should preserve the selected frame
and operation. Unsupported combinations stay visible in the interpretation
instead of silently becoming an ordinary rectangular window. This is a UI
and catalog proposal, not a claim that those filters are currently available.

### Furnish and decorate a house

Try `a warm furnished decorated timber cottage with one bedroom`, or choose
**Essentials** furnishing and **Simple** decoration in the house controls.
Essentials adds a bed and storage to bedrooms, a bed in a studio living area,
living furniture (sofa, table, two chairs, cabinet, and bookcase), and bathroom
storage. Simple decoration adds a rug and mounted framed artwork, plus a book
on the bookcase when that furnishing is present. Choose natural, warm, or cool
interior appearance. The selected design lists its actual contents. New cabinet
designs include hinged doors and catches; request drawers or shelves on rails
for pull-out cabinets. Essentials furnishing alone does not add appliances or
plumbing; those use the room and service options described below.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeHomeComposition.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeExplorePanel.js`.)

Placement uses the compiled room polygons, including concave rooms, and the
actual door/window openings. It reserves approaches and checks connected
walking space. If the complete set cannot fit, generation reports the failure
instead of dropping pieces or reducing their size. Loose furniture stays
physically separate from the house; artwork has an explicit wall mount.
**Floor plan** shows the furnished layout from the compiled geometry. Existing
v1 house definitions and generator identities remain available unchanged.
Preset furnished homes and furniture use v2 intents. Explicit custom contents
select `realmforge.design.composition@1.0.0`; intent versions, definition
versions and generator versions describe separate contracts.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeHomeComposition.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeBuildFamilies.js`;
`webgpu-os/apps/realmforge/ui/RealmForgePreparedBuildThumbnail.js`.)

### Generate a furnished room layout

Select **Rooms** in Explore, or type `bedroom`, `living room`, `dining room`,
`home office`, `kitchen`, or `bathroom`. For example, `a decorated 4m by 5m warm bedroom` creates a room
layout as its own editable asset. Refine the footprint, wall height, finish,
style, and decoration; browse variations; then build the selected preview.
**3D view** looks through the open top and **Floor plan** shows the compiled
interior section. The contents list shows which furnishings the preset includes.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeBuildFamilies.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeExplorePanel.js`.)

| Layout | Included furniture |
| --- | --- |
| Bedroom | Bed, tall cabinet and bedside table |
| Living room | Sofa, coffee table and bookcase |
| Dining room | Table, two chairs and sideboard cabinet |
| Home office | Desk-sized table, swivel office chair and bookcase |
| Kitchen | Cupboard counter, sink unit, cooker and refrigerator |
| Bathroom | Compact sink unit, toilet and shower |

Simple decoration adds a rug and mounted wall art, plus a book when the preset
has a suitable bookcase, table or counter. The generator places the complete
preset and checks access to its furniture and interaction anchors. Kitchen and
bathroom fixtures expose typed connection locations; a standalone room layout
does not automatically install house service networks or run appliances.
(Source: `webgpu-os/apps/realmforge/construction/RealmForgeRoomComposition.js`.)

Each layout has a floor, four walls and one central front entrance. Its top
stays open for inspection; there is no door leaf, window, or roof. Width and
depth are 3–8 m, and wall height is 2.4–3.2 m. Furniture must fit as a complete
set with entrance and walking clearances. A supported size can still fail if
the requested complete arrangement cannot fit. Generation does not discard
pieces to make it fit. Room layouts use the versioned
`realmforge.room.furnished@1.0.0` generator and retain the same prepared-preview,
review, save, construction-playback and Undo path as other builds.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeRoomComposition.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeHomeComposition.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeProceduralHouse.js`.)

A room layout built from Explore is a separate asset. To apply its furniture
inside an existing generated house, use the explicit selected-room workflow.
House requests such as `cottage with one bedroom` continue to select the house
floor plan. The six presets remain available when no custom contents are given.
For an explicit replacement roster, try `bedroom containing two chairs, a table
and a bookcase`, or enable the **Custom room contents** editor. Supported
relations include `books inside the bookcase`, `plant on the table`, and
`chairs facing the table`. An explicit empty roster keeps the room shell.

Custom contents retain quantities, dimensions, stable keys, optional rigid
placements and supported spatial relations. They are limited to 32 objects.
Every item must fit with the measured room, access and other objects. Missing
targets, ambiguous relations, unsupported members and impossible placements
remain errors; the compiler does not silently drop objects. A standalone room
has no window, so a request to face a window cannot succeed there. House-wide
rosters must identify actual rooms. Additional appliance families and standalone
room service networks remain outside these presets.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeBuildIntent.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeBuildContentsText.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeContentsContracts.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeContentsComposition.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeProceduralBuildPanel.js`.)

### Furnish a selected room in an existing house

Open a generated house to replace the furniture in one of its actual rooms.
The selected room receives a complete **Bedroom**, **Living room**, **Dining
room**, **Home office**, **Kitchen**, or **Bathroom** preset. Its existing
polygon, doors and windows determine where the furniture fits. A furniture-only
change preserves the house shell and every unselected room's contents,
connections and interaction anchors. Explicit service changes can also raise
the house and cut the required pipe or conduit openings.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeHouseRoomBuild.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeHouseRoomComposition.js`.)

1. In **Build**, expand **Build options and reusable patterns**, then
   **Rooms, plumbing and wiring in this house**. You can also choose
   **Object tools → Furnish room** to open these controls directly on the
   current editable generated house.
2. Choose the specific **Room in this house**. An existing bathroom accepts
   the **Bathroom** preset; other rooms offer the other five presets.
3. Choose a **Furniture preset**, **Finish**, **Furniture palette** and **Decoration**, or
   enable custom contents and edit the complete replacement roster.
4. Press **Preview room furnishing**. Review the full house floor-plan image
   and the prepared assembly in the viewport. Preview leaves the document
   unchanged.
5. Use **Apply room furnishing** in the room controls to commit that exact
   preview, or **Cancel** to discard it. Applying adds one Undo entry. Changing
   the selected room, inputs, account or document invalidates an obsolete
   preview.

The room browser shows the selected room's measured dimensions and floor,
with visual choices for its compatible complete presets. Each layout card
uses the same furniture fitter as the house generator. Its plan shows actual
fitted object bounds and access points, with the included objects and seat or
bed anchors. A failed fit remains visible with its reason; the browser does
not shrink furniture or remove requested objects to make a card succeed.
Layout inspection leaves the document and viewport unchanged. It is not a
prepared build: **Preview room furnishing** still checks the current document's
build recipe, authored geometry, dependencies, services and capacity before Apply.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeHouseRoomBuild.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeHouseRoomControls.js`.)

The room controls keep their room and floor header visible while scrolling,
with **Draft only**, **Preview ready**, or **Blocked · draft only**. One action
strip contains Preview, Apply and Cancel. Apply requires the current prepared
preview. On narrow windows, **Arrange**
shows the room controls and **View** shows the viewport. The compact **Renderer**
selector chooses the viewport renderer. (Sources:
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeHouseRoomControls.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeHouseRoomControlsStyles.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeWorkbenchStyles.js`;
`webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`.)

**Show this room** temporarily frames a whole-piece cutaway of the current or
prepared house. It hides complete pieces and uses the same visibility for
picking. **Show house** restores the previous camera,
assembly presentation, section and Project navigator. Draft moves appear in
3D after **Preview room furnishing**. These view controls do not edit the asset.
Opening **Storage**, **Actions** or **Water** retires pending and ready room
previews; preview the room again before applying it. (Sources:
`webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`;
`webgpu-os/apps/realmforge/modeler/viewport/ModelerViewport.js`.)

**Match house palette** reads the current document's House styles palette and
sets the furnishing style accordingly, including an applied appearance that
has not yet been saved to disk. The whole-house appearance still
controls its furniture materials and shading; this is not a separate room
paint or rendering profile. Custom contents show one complete custom layout.
Returning to preset browsing requires the explicit **Use a preset instead**
action, so browsing never silently discards a custom roster.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeHouseRoomBuild.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeHouseRoomControls.js`.)

**Place and arrange on map** creates an editable draft from a measured layout.
Conversion retains the complete roster and its actual component parameters,
and preserves every floor object's measured geometry and rigid position.
Dependent decorations are fitted again on measured support or storage, with
their position and relationship changes listed before Preview. For example,
a preset book on a bookcase can move into its measured shelving when that
bookcase has no declared top surface. Explicit custom support relationships
remain intact. An invalid conversion reports the reason and keeps the
original request. This does not resize furniture.

Numbered footprints match the arrangement object list. Select a floor object
in either view. Drag its footprint, or choose **Place on map** and click or tap
the destination. Ordinary clicks select objects without moving them. Map
snapping offers **Off**, **5 cm**, **10 cm**, and **25 cm** in house coordinates;
the default is 10 cm. Dragging retains the grabbed offset, and uses a stable
map transform while an invalid footprint extends beyond the room.
**Cancel map placement**, Escape, or pointer cancellation restores the start
of the current drag; it cannot restore a retired house or account draft.
Edit **X** and **Z** in metres, or use the clickable nudges and rotation
controls for precise movement. **Plan and movement help** explains the axes,
front arrow and keyboard nudges. Blank or invalid numbers show a field-specific
error; placement errors name the affected object and suggest a correction.
**Diagnostic details** retains the original fit diagnostic.
The plan has **Fit room**, **Fit all objects**, **Zoom in**, **Zoom out**, and
**Pan map** controls. Fit room returns to the measured room; Fit all objects frames
the complete roster, including a blocked object outside the room. Moving an
object does not automatically shrink or recenter the map. Pan map drags only
the view, even over furniture; directional pan buttons provide a click/tap
alternative. Escape cancels the current pan and restores its starting view.
Navigation changes neither the draft nor a ready Preview. Map zoom is bounded
from 50% to 800% of the chosen fit frame; page scrolling remains available.
On the focused map, **+ / −** zoom and **Home** fits the room. Arrow keys pan
the map background or Pan mode; a focused object retains its movement keys.

Blocked pinned layouts identify the affected numbered footprints. A nearby
object warning names both objects and the existing 9 cm clearance rule; an
opening warning outlines its reserved door or window zone. Wall-clearance
feedback uses the existing 13 cm room margin, including irregular room edges.
Floor/ceiling and walking-access failures have separate explanations. Access
failure marks the checked roster rather than guessing a single obstruction.
Fresh valid inspection clears the highlights. These are conservative measured
clearance checks; opening rectangles are reserved zones rather than hinge-sweep
measurements. Full Preview remains the complete-house validation.
These are house coordinates; the object's measured floor height stays fixed.
The other pinned floor objects retain their poses. Live layout inspection
checks the complete draft against room boundaries, opening zones, other
objects and access. A blocked move remains visible for correction; it cannot
reuse an earlier prepared Apply. **Revert arrangement draft** restores its initial
contents without changing the house.

**Customize object** opens the selected object's real controls in
**Custom room contents**. The fields come from registered family capabilities:
supported metric dimensions, finish, palette, chair variant, or bottle pill
count. Unsupported controls are absent; a chair cannot be resized using
arbitrary scale. **Use default** clears an individual override. Invalid values
remain visible and block inspection rather than being clamped silently.
**Advanced** retains raw parameter JSON, keys, quantities, support/storage
relationships, and pinned poses. Per-object settings override room defaults;
an applied whole-house appearance profile can override visible materials.

Choose a family under **Add object** to extend the complete roster. When a
preset is active, Add first measures and retains its existing objects and
support relationships. A changed recipe or roster needs a fresh
**Place and arrange on map** measurement before map movement; the old
placement projector does not accept changed dimensions or different objects.
Then use **Preview room furnishing** to validate the complete house.

In **Advanced**, **Pinned yaw (degrees)** displays the stored
heading. Changing it preserves the object's existing tilt; leaving it untouched
retains the full original rotation. (Sources:
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeRoomArrangementControls.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeContentsEditor.js`.)

The interaction follows the combined plan/properties approach described in
the [Sweet Home 3D guide](https://www.sweethome3d.com/users-guide/).
Click/tap placement and clickable nudges provide alternatives to dragging,
following [W3C guidance on dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html).
Explicit pan mode and zoom controls also follow
[Sweet Home 3D's navigation shortcuts](https://www.sweethome3d.com/blog/sweet-home-3d-shortcuts/).
These are design references, not a claim of full accessibility conformance.

Use **Preview room furnishing**, then **Apply room furnishing**, to commit the
complete arranged room. This is the existing room replacement operation:
the selected room's generated object identities and operating states are
recreated. Saved written books remain in the library; their old geometry
bindings may become detached. Other rooms and the house shell remain intact.
Undo restores the preceding room resources. Arrangement alone changes
neither the document nor the viewport camera or selection.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeHouseRoomBuild.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeHouseRoomControls.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeConstructionDocumentTransaction.js`;
`webgpu-os/apps/realmforge/books/RealmForgeBookDocument.js`.)

For example, select `bedroom-1`, choose **Home office**, a **White** finish and
**Cool** furniture palette, then preview the desk, office chair and bookcase in that room.
Other bedrooms and the living area retain their previous contents. A preset
must fit in full, including door, window, seat and bed approaches; an unfit
request fails without discarding pieces or changing the walls.
(Sources: `webgpu-os/apps/realmforge/modeler/ui/RealmForgeHouseRoomControls.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeProceduralBuildPanel.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeRoomComposition.js`.)

The saved recipe must reproduce the current generated assembly and all its
recorded resources exactly. Manual changes to generated geometry, materials,
plans or other owned resources block room replacement. Separate authored
objects remain intact when their measured bounds lie outside the selected
room's volume. Overlapping, animated or unmeasurable authored geometry blocks
the preview. Use an unchanged generated house, or move separate authored
objects clear of the room, before trying again.
(Source: `webgpu-os/apps/realmforge/construction/RealmForgeHouseRoomBuild.js`.)

Appearance bindings remain separate from those physical resources. Room
furnishing preserves the latest House styles profile and manual Texture Studio
assignments on surviving pieces. New furniture receives its corresponding
profile material. Undo restores the preceding furnished house and its
appearance together. (Sources:
`webgpu-os/apps/realmforge/construction/RealmForgeHouseRoomBuild.js`;
`webgpu-os/apps/realmforge/material/studio/RealmForgeTextureBindings.js`.)

Save the house asset to retain cumulative room assignments across reopening.
Furnishing another room preserves earlier assignments; selecting an already
assigned room replaces only that room's generated contents. These local edits
use `realmforge-build-intent-v3` and
`realmforge.home.room-layouts@1.0.0`, retaining the original v1 or v2 house
recipe. Adding explicit services uses `realmforge-build-intent-v4` and retains
the cumulative assignments; multiple floors use v5. Explicit custom rosters or
new building options select the separate complete-design generator. Echo can
propose all five validated intent formats and supported modifiers, under the
same explicit constraints and review guards. Editing an existing asset still
requires its explicit target and current document revision. **Use prepared
design parameters** in the pattern editor captures room assignments, services and supported
modifiers in a complete v3 definition; each new version requires its own review.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeBuildIntent.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeProceduralHouse.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeBuildEchoBridge.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeProceduralBuildPanel.js`.)

### Add house plumbing and wiring

Enter `cabin with plumbing and electricity` to prepare a house with explicit
service networks. To equip an existing generated house, open **Rooms, plumbing
and wiring in this house**, expand **House plumbing and wiring**, and select
**Water supply and drains** and/or **Electrical service**. Choose **Household
AC + Ethernet** or **Original 24 V DC service** under **Wiring system**.
A room selection is optional for a service-only
change. Press **Preview house services**, inspect the prepared result, then
**Apply house services**. Selecting a room as well uses **Preview room and
services** and **Apply room furnishing**. Both routes apply one exact prepared
assembly through the normal Undo and stale-request checks. Plumbing foundation
changes and measured shell openings require explicit review even in Auto Known.
(Sources: `webgpu-os/apps/realmforge/modeler/ui/RealmForgeHouseRoomControls.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeProceduralBuildPanel.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeHouseRoomBuild.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeBuildController.js`.)

Requesting plumbing completes the house's actual kitchen and bathroom before
routing services. It adds any missing counter, kitchen sink, cooker and
refrigerator, plus a bathroom sink, toilet and shower. Existing furnishings,
fixtures and room assignments stay in place. Placement first tries standard
sizes, then a compact set within the registered family ranges. If the complete
set cannot fit with the retained contents and walking access, preparation fails
instead of moving or discarding them. The preview records the chosen sizes.
To choose fixture appearance explicitly, use the **Kitchen** or **Bathroom**
room preset before adding plumbing.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeHousePlumbingFixtures.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeHouseServiceComposition.js`.)

The networks connect every generated fixture port to its matching room service point and
external endpoint. Cold water enters through a cold-water inlet; hot water has
a separate inlet representing an external heater. Every generated drain has
a downhill path to the external sewer outlet. The network records endpoint
positions, fixture paths and route ownership. It does not simulate a water
heater, supply pressure or sewage treatment.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeHouseServices.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeHouseRoomComposition.js`.)

Plumbing raises the existing house, porch and furnishings together onto open
concrete piers and beams. The generated foundation provides 0.9 m clearance
below its lowest beam. Exterior steps connect ground level to the measured
front-door threshold or porch: risers are at most 0.18 m, treads are 0.28 m,
and the top landing is 0.9 m deep. Local seat, bed and fixture anchors remain
attached to the same pieces. These are authored gameplay construction
dimensions, not a soil-bearing, structural-capacity or building-code approval.
Older houses do not acquire this foundation unless plumbing is requested.
(Source: `webgpu-os/apps/realmforge/construction/RealmForgeHouseServiceFoundation.js`.)

Cold-water and drain routes have hollow PVC geometry; hot-water routes use
copper. Pipe walls have real inner and outer surfaces, open end bores and
openings where connected branches meet. Measured route crossings cut openings
through the actual supported shell meshes and colliders. Unsupported cuts or
remaining obstructions fail preparation. Electrical conduit contains separate
copper positive and return conductors. The associated circuit is an explicit
24 V DC gameplay model, including resistive conductors and a breaker. Cooker
and refrigerator loads in that circuit are 120 W and 24 W equivalents. Their
fixture metadata's 3000 W and 150 W values are authored design assumptions,
not manufacturer ratings or an AC appliance simulation.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeHouseServiceComposition.js`;
`webgpu-os/apps/realmforge/construction/RealmForgePipeGeometry.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeServiceJunctionGeometry.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeServicePenetrations.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeHouseServices.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeFixtureComponents.js`.)

### Inspect water in a pipe

With a prepared or committed plumbed house, expand **Build options and reusable
patterns**. Under **Water in pipes**, choose a
**Water pipe route** and press **Start water**. The transparent pipe view shows
48 actual GPU particles in that selected route. **Pause**, **Resume water**,
**Reset** and **Stop** control this finite sample. Changing the selection alone
does not start simulation. The displayed elapsed time, outlet count and wall
contacts come from particle readback. Hiding the controls, changing the target,
or retiring its account stops the preview and releases its GPU resources.
(Sources: `webgpu-os/apps/realmforge/modeler/ui/RealmForgeProceduralBuildPanel.js`;
`webgpu-os/apps/realmforge/modeler/water/RealmForgePipeWaterPanel.js`.)

The preview reuses the engine's smoothed-particle hydrodynamics (SPH) solver
and neighbour grid. Gravity, particle interactions and a small initial inlet
velocity move the water inside the selected bore. It is a bounded single-route
test, without a pump, full hydraulic network solver or particle transfer through
T-junctions. Invalid bore/path combinations report an error. The service pipes
do not have rigid-body contact colliders; bore contact here belongs to the SPH
preview. Water playback never changes the saved construction assembly.
(Sources: `webgpu-os/apps/realmforge/modeler/water/RealmForgePipeWaterRuntime.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeHouseServiceComposition.js`.)

### Household pieces and interaction anchors

The procedural families now include basic and office chairs, tables, beds,
sofas, cabinets, bookcases, rugs, framed wall art, and books. For example, enter
`white table width 1.4 metres height 0.8 metres`. Dimensions are bounded per
family. Chairs preserve the existing authored basic/office geometry and expose
kind, finish, and appearance choices instead of unsupported dimensional
scaling. The pattern editor uses the same parameter definitions as the compiler.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeBuildFamilies.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeFurnitureComponents.js`.)

The fixture families add `kitchen counter`, `sink unit` (also `washbasin`),
`cooker` (also `stove` or `oven`), `refrigerator` (also `fridge`), `toilet` and
`shower`. Each has bounded dimensions, finish and style controls. Recognizable
parts include cupboard doors and handles, a hollow sink and faucet, cooker
burners and oven front, refrigerator doors, an open toilet bowl and seat, and
a shower tray, screens and head. Typed water, waste and electricity ports stay
owned by their physical pieces. Building a fixture alone does not simulate
heating, refrigeration, flushing or pressurized water.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeBuildFamilies.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeFixtureComponents.js`.)

Chairs, sofas and toilets carry **seat anchors** owned by their actual seat pieces.
Beds carry **lay-down anchors** on the mattress surface, with explicit head
direction and side approach. A bed narrower than 1.4 m has one anchor; wider
beds have two. Anchor frames follow translation, rotation, and supplied runtime
part poses. They survive save/reopen and appear in selected-design details.
These are interaction locations for later actor integration; creating a chair
or bed does not automatically seat or animate a character. The query APIs are
`projectRealmForgeSeatAnchors` and `projectRealmForgeLaydownAnchors`.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeSeatAnchors.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeFurnitureComponents.js`.)

The office chair has an independent seat swivel, five caster steering swivels,
and ten wheel axles. **Simulate** uses the construction physics runtime; drag a
part to apply forces. Motion comes from joints, forces, and contact. Static
gallery thumbnails do not animate. The procedural office chair does not include
the separate verified-furniture package's gas-lift height adjustment.
(Sources: `webgpu-os/apps/realmforge/construction/runtime/ConstructionArticulationProjection.js`;
`webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`;
`webgpu-os/apps/realmforge/modeler/viewport/ModelerViewport.js`.)

Open **Words and reusable patterns** to inspect mappings, try a phrase, or save
a new phrase with its supported parameters. Definitions are immutable versions
stored in the current account. **Approve reusable pattern** validates the
definition with the actual generator and records separate review evidence.
Editing a definition creates a new version that needs fresh review. **Try
phrase** on an earlier version selects that exact version; **Use latest
patterns** clears the selection. Saved assets retain the resolved parameters,
seed, generator version, concept hashes, and stock/joint/material dependency
hashes. **Use prepared design parameters** captures the full validated intent, including
custom room contents, building options and custom control-board contacts, in
`realmforge-build-definition-v3`. The template uses a request-supplied seed and
an exact generator pin. Earlier v1/v2 definitions continue to resolve through
their original profiles and versions. A named complete design cannot silently
accept conflicting parameter changes; create and review a new version.

OCR text can be pasted into the same description field. **Check words and
meanings** inspects the existing compiled spelling dictionary alongside the
current account's reviewed phrase mappings. A known spelling is not a building
capability. Only an exact reviewed definition supplies construction meaning;
pending patterns and ambiguous mappings remain visible. This does not retrain
OCR or pronunciation models. Workflow recipes remain guidance.
(Sources: `webgpu-os/apps/realmforge/construction/RealmForgeBuildLibrary.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeBuildIntent.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeBuildConceptCatalog.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeProceduralBuildPanel.js`.)

### Doors, catches and pull-out storage

New built-in designs use mechanism-enabled generator versions. House doors,
cabinet doors, kitchen and sink cupboard doors, refrigerator doors and the
oven front have bounded hinges and releasable catches. Door handles belong to
the moving panel. A `cabinet with drawers` or `pull-out cabinet` produces two
drawer trays with fronts, handles, paired rails, stops and catches. Open
bookcase shelves remain fixed. Pull-out storage currently applies to cabinets;
appliance and sink fronts remain hinged. The pattern editor exposes the same
hinged and pull-out choices. (Sources:
`webgpu-os/apps/realmforge/construction/RealmForgeGeneratedMechanisms.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeProceduralBuildPanel.js`.)

After construction playback, choose **Show complete** and return to **Build**
or **Simulate**. Point at a door, handle or drawer front. **Wheel up** opens it
gradually; **wheel down** closes it. The focus hint shows **Lock/Unlock**;
use that button or press **L** while the viewport has focus. A lock can engage
only near the measured closed position after its catch succeeds. Locked panels
reject wheel motion, dragging and grabs of their attached handle or parts.
Unlocking leaves the panel where it is; it does not automatically open it.

Open **Object tools → Action bindings** to change the shared object controls.
The same profile applies to authored house and cupboard doors, bedroom wardrobe
doors, window sashes, sliding panels and pull-out drawers. Electrical switches,
dimmers and breaker controls also use its direction, sensitivity and action keys.
By default, **O** opens or enables, **C** closes or disables, **L** locks or unlocks
a supported mechanism, **Enter** activates, and **↑ / ↓** increase or decrease.
The dialog can reverse or disable wheel actions, change sensitivity, remap or
disable individual keys, and reset defaults. Duplicate keys and camera movement
keys are rejected; **Space** remains reserved for camera movement. Aim prompts
reflect the current bindings. Explicit buttons and sliders remain usable when
wheel actions are disabled.

Bindings are account preferences, shared across assets and restored when
RealmForge reopens. They do not modify the asset or add an Undo entry. When
account storage is unavailable, changes stay active for the current session and
the status reports that they could not be saved. Changing bindings releases held
handles and old focus; it never replays an earlier gesture. Fixed shelves and
objects without an authored action remain ordinary geometry. Named discrete
animations retain their explicit **Actions** controls rather than repeating on
scroll. (Sources:
`webgpu-os/apps/realmforge/interactions/RealmForgeObjectInputBindings.js`;
`webgpu-os/apps/realmforge/interactions/RealmForgeObjectInputPreferences.js`;
`webgpu-os/apps/realmforge/modeler/viewport/RealmForgeArticulationFocusInput.js`;
`webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`;
`webgpu-os/apps/realmforge/factory.js`.)

Plain scrolling over other geometry keeps camera zoom. Hold **Alt** while
scrolling to zoom even over a panel. Modified wheel gestures, including browser
pinch zoom, retain their existing controls. In the editor, hover can target
distant geometry for inspection; when the canvas has pointer lock, focus uses
the central camera ray and a 3 m reach. The nearest visible surface must be hit,
so an intervening wall blocks the interaction. This does not grant a future
NPC or player permission to operate the object.

Wheel input works while paused and during simulation. With simulation paused,
you can also drag a built panel; bring it near closed and release to engage its
catch. The first interaction may need to prepare physics; the hint asks you to
try again when ready instead of replaying an old gesture. Motion is driven by forces and native constraints. A
freestanding cabinet remains movable, including while its doors are latched.
Other bodies retain their existing collision behavior. Cancelling a drag releases its force
without teleporting the panel back through an obstacle. These poses are
transient, including lock state; they do not edit the saved assembly. Reloading
or rebuilding the runtime resets that state. Moving focus away, changing
workspace, hiding the app or opening a design preview releases wheel targets.
Construction playback and Undo
retain their separate roles. (Sources:
`webgpu-os/apps/realmforge/construction/runtime/ConstructionMechanismRuntime.js`;
`webgpu-os/apps/realmforge/construction/runtime/RealmForgeConstructionPresetPhysics.js`;
`webgpu-os/apps/realmforge/modeler/viewport/ModelerViewport.js`.)

The input design draws on [Frictional Games' physical interaction design](https://frictionalgames.com/2010-09-lets-not-forget-about-physics/)
for forgiving whole-panel targeting and [VRChat's interaction prompts and proximity rules](https://creators.vrchat.com/worlds/components/vrc_pickup/)
for visible feedback and bounded camera targeting. The wheel mapping is
RealmForge's choice. It accounts for pixel, line and page deltas and leaves
modified gestures alone, following the browser's [wheel event contract](https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event).

Plumbed houses retain their pipe and wire meshes, service bindings and transforms
while their explicitly non-rigid service pieces stay outside the rigid-body
graph. This allows the house doors to run without inventing solid pipe colliders
that would fill the bores. Missing colliders on ordinary construction pieces
still fail physics readiness. (Source:
`webgpu-os/apps/realmforge/construction/runtime/RealmForgeConstructionPresetPhysics.js`.)

The compiler checks sampled opening envelopes, including handles, against
the rest of the authored design. Pipe and wire checks follow each centreline
span and its outside radius, including conductor offsets; empty space inside
a bent route's overall bounding box does not count as an obstruction.
A blocked requested travel fails visibly;
it does not shorten the limit or discard the panel. These are gameplay
mechanisms with unrated hardware capacities. Historical saved designs and
approved pattern versions keep their original geometry and generator. To
replace an older fixed-door design, use current patterns with **Edit this
generated design**, review its preview and apply the replacement. Unrelated
content is preserved. Changing a reusable definition requires a new version
and review. (Sources:
`webgpu-os/apps/realmforge/construction/RealmForgeBuildIntent.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeProceduralHouse.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeConstructionDocumentTransaction.js`.)

After a build, **Construct** shows pieces appearing in construction order.
Pause, change speed, scrub, or filter stages using the existing timeline.
**Show complete** stops playback and restores every piece. Picking respects the
visible pieces. Preview, commit, and playback use the same compiled assembly
and stable part IDs. (Sources:
`webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`;
`webgpu-os/apps/realmforge/modeler/viewport/ModelerViewport.js`.)

AI discovery exposes `os.realmforge.previewProceduralBuild` and the procedural
build-from-words workflow recipe. The tool returns local interpretation and bounded
compiler evidence without changing a document or approving a pattern. Echo
returns construction data through a separate request-correlated channel; it
cannot register executable generators. (Sources:
`webgpu-os/apps/realmforge/modeler/ai/RealmForgeConstructionAiTools.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeConstructionAiService.js`;
`webgpu-os/apps/realmforge/recipes/RealmForgeRecipes.js`.)

## Organize shelves, cupboards and drawers

Open an editable asset and select **Storage** in the viewport toolbar. Choose a
destination shelf, drawer or tabletop, select whole loose objects, and use
**Preview placement**. **Apply arrangement** commits the exact checked preview
as one Undo step. Save the asset through the normal Save command. To retrieve
an object, select it and choose a free tabletop or another storage area.
**Browse storage designs** offers low cupboards, tall cupboards, drawer units
and open bookcases through the existing Build gallery; browsing preserves the
current house. These presets use existing reviewed generator versions.
(Source: `webgpu-os/apps/realmforge/storage/RealmForgeStoragePanel.js`.)

The organizer measures the space between actual boards, backs, doors and tray
walls. It checks rotated part bounds, support, surrounding objects and the
insertion/retrieval path. It keeps a single accessible front row, preserves
object dimensions, and either places the complete selection or reports why it
cannot fit. Fixed legacy cupboard doors remain inaccessible until explicitly
upgraded. Mechanism-bearing furniture, occupied containers, wall-mounted
objects and connected utility fixtures cannot be moved through this organizer.
Open-surface placement searches at most one metre above the measured tabletop.
Assets with additional authored source geometry are rejected until those extra
shapes can participate in the same fit checks; they are never silently ignored.
(Source: `webgpu-os/apps/realmforge/storage/RealmForgeStorageGeometry.js`.)

**Add blank books** creates 1–24 independent books using the requested metric
dimensions, then fits the complete set around existing contents. Each book gets
a separate persistent content resource and scene binding. **Books** edits its
title, pages and markings. Rearranging an existing book retains its identity and
contents. Assembly, construction plan and BOM update together; rejected, stale,
cancelled and duplicate requests cannot apply another transaction. Existing
generator provenance is retained, so later regeneration detects manual storage
changes instead of silently discarding them.
(Source: `webgpu-os/apps/realmforge/storage/RealmForgeStorageDocument.js`.)

The shared inspection and planning APIs expose owner-relative storage frames,
approach/grasp/retrieval poses, and required door/drawer openings. Current owner
transforms can project anchors on a moving drawer. These are design and
interaction requirements; actor navigation, reach, reservations and action
execution must enforce them at runtime. This milestone does not make NPCs
autonomously fill houses. Geometry fit does not supply missing load ratings or
book-paper physics properties. Stored objects remain loose, without added
fasteners to the shelf or drawer.
(Sources: `webgpu-os/apps/realmforge/storage/RealmForgeStorageGeometry.js`;
`webgpu-os/apps/realmforge/storage/RealmForgeStorageDocument.js`.)

### Watch a storage move

After **Preview placement** for existing objects, **Watch the move** provides
**Play move**, **Pause**, **Stop**, playback speed and a progress slider. The
animation opens the required doors or drawer, retrieves the object, carries it
through a checked route, places it, and closes the storage again. Other objects
in an opening drawer follow the tray during this design preview. Each object
keeps its size and identity. New books must first be applied before they have an
existing starting position to animate.

The action compiler rechecks the exact placement plan, checks continuous motion
against measured geometry, and moves selected objects in order. Objects waiting
for their turn remain obstacles. Rotation happens at a checked staging position
outside the storage opening. The search is bounded to 16 moved objects, 12,000
parts, 256 route candidates, 512 motion intervals and 30 minutes of preview.
Conservative clearance or capacity failures disable the animation and explain
why; the final static arrangement remains separately reviewable.

Playback updates only the detached preview. Scrubbing does not execute events
or change the document. **Stop** displays the complete proposed arrangement;
**Apply arrangement** is still the single Undo transaction. Closing Storage or
changing the asset, account, preview or workspace mode revokes the action.
Hiding the app pauses playback. No animation starts automatically.

This is authored action preview, not a physical grab or actor task. It does not
grant a player or NPC access, reserve an object, move a character, supply missing
physical properties, or simulate forces. A future execution adapter must check
reach and custody and observe actual movement before reporting success.
(Sources: `webgpu-os/apps/realmforge/storage/RealmForgeStorageAction.js`;
`webgpu-os/apps/realmforge/storage/RealmForgeStorageActionPlayback.js`;
`webgpu-os/apps/realmforge/storage/RealmForgeStoragePanel.js`;
`webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`.)

## Create books with persistent contents

Open an editable asset, then choose **Books** in the Modeler toolbar. Book Studio
creates a custom book or imports a `.realmbook.json` archive. Each saved copy has
its own asset resource identity, title, author, description, subjects, page index,
reading position, and editable contents. **Save book** commits one document Undo
entry and saves through the active asset's existing storage path. **Save & close**
saves before leaving; unfinished edits remain visible if a save fails.

Use **Read / write flat** for precise editing or **3D book** to turn pages and
write directly on the visible surface. Select a cover, spine, or page in the left
contents list. Pen, highlight, erase, stain, scratch, and editable text blocks
belong to that surface. **Undo page mark** and **Redo page mark** preserve the
mark history until a new edit replaces its redo tail. Contents search indexes
editable text; it does not OCR handwriting or interpret drawings.

The 3D view uses thick paper, rigid covers, a shared sewn binding, and adjustable
page stiffness. Change page size, sheet thickness, and cover thickness in
millimetres under **Paper and cover**. Drag **Turn pages** to turn and curl a leaf,
use **Orbit** to inspect it, and scroll to zoom. Bending is an authored visual
model, not a calibrated paper simulation or native sheet collision solver.
Rendered and picked surfaces use the same deformed triangle geometry.

Use **Scene book** to associate the record with a specific generated book,
including copies in furnished rooms. The scene's existing decorative geometry
remains unchanged; the detailed editable book is shown in Book Studio. If the
scene object disappears, its contents remain as a detached book that can still
be edited or attached to another copy. Existing generated book definitions and
pinned examples are unchanged.

Imported archives retain original PNG backgrounds, ink checkpoints, text stamps,
mark identities, and undone operations. A supplied checksum is checked before
normalization. **Update printed backgrounds** deliberately redraws the printed
cover title and paper styling while retaining ink. **Export book** writes a
portable archive with its checksum. New books support up to 64 sheets / 128
writing pages. Archives are bounded to 64 MB; a saved book resource must fit the
existing 16 MiB JSON resource limit. Oversized or invalid data is rejected with
an explanation, not silently truncated. Account changes, stale documents, and
cancelled saves cannot commit to a different asset.

(Sources: `webgpu-os/apps/realmforge/books/RealmForgeBookStudio.js`;
`webgpu-os/apps/realmforge/books/RealmForgeBookCore.js`;
`webgpu-os/apps/realmforge/books/RealmForgeBookSurfaces.js`;
`webgpu-os/apps/realmforge/books/RealmForgeBookDocument.js`;
`webgpu-os/apps/realmforge/books/RealmForgeBookGeometry.js`;
`webgpu-os/apps/realmforge/books/RealmForgeBookPreview.js`.)

## Author a `.proasset` 2.0.0 document

RealmForge v2 uses `realmforge.proasset` with version `2.0.0`. The root manifest
references versioned resources by stable IDs, hashes, logical paths, authority,
and explicit entry points. Supported entry points are `assembly`,
`systemGraph`, and `defaultScenario`. Resource authority is one of `authored`,
`baked`, or `external-pinned`. (Sources:
`webgpu-os/apps/realmforge/document/constants.js`;
`webgpu-os/apps/realmforge/document/validation/ProAssetV2Validation.js`.)

Create a basic asset:

1. Open RealmForge. A first launch enters the integrated Getting Started
   workbench; a later launch restores the verified active asset.
2. Select **Library** when you want a different starting point. Asset Home
   immediately previews the first usable template in the same browsing
   workspace.
3. Browse or search until the integrated preview shows the desired starting
   point. Accept or edit the generated asset name and canonical slug.
4. Select **Use as New Asset**. RealmForge prepares and validates the candidate
   before publishing a root.
5. Edit ForgeSource, resource properties, or SystemGraph nodes in the Modeler.
6. Save. RealmForge serializes the semantic transaction, publishes resources,
   then publishes the root manifest last.

Document changes pass through one queued `RealmForgeDocumentStore`. Content
hashing excludes incidental timestamps and logical paths while retaining
resource identity, entry points, semantic JSON, and binary hashes. Persistent
history records forward and inverse transactions, so undo and redo survive a
reload. (Sources:
`webgpu-os/apps/realmforge/document/store/RealmForgeDocumentStore.js`;
`webgpu-os/apps/realmforge/document/hash/RealmForgeContentHash.js`;
`webgpu-os/apps/realmforge/document/history/RealmForgePersistentHistoryContracts.js`.)

Verified recipes do not replace `.proasset` authority. They bind four separate
immutable roots around it: `designRoot` identifies the selected design,
`evidenceRoot` identifies measurements and attestations, and `releaseRoot`
binds the exact design, evidence, dependencies, tools, policies, and validation
receipts. Runtime checkpoints remain transient unless an explicit evidence
capture records them. Resolution is ordered from the source snapshot through
approved corrections, selected configuration, instance overrides, compiled
projections, and finally transient runtime state. Derived or runtime facts
cannot promote themselves into design, regulatory, or as-built truth.
(Sources:
`webgpu-os/apps/realmforge/verified/RealmForgeVerifiedRecipeContracts.js`;
`webgpu-os/apps/realmforge/verified/RealmForgeEvidenceContracts.js`;
`webgpu-os/apps/realmforge/verified/RealmForgeLayerContracts.js`;
`webgpu-os/apps/realmforge/verified/RealmForgeReleaseContracts.js`.)

Verified capabilities enter the workbench through one source-bound rollout
registry. Its eleven phase flags default to off. Enabling a phase requires a
passed gate receipt bound to the exact source revision, source content hash,
runtime `planHash`, and rollout revision. Asset Home, Studio facets, and direct
template/package actions all re-authorize against the current binding, so a
stale or mismatched request fails closed instead of bypassing the gate. Legacy
compatibility cards and the Getting Started asset remain available, and a flag
change never migrates a saved document. (Sources:
`webgpu-os/apps/realmforge/rollout/RealmForgeVerifiedRealityRollout.js`;
`webgpu-os/apps/realmforge/catalog/RealmForgeLibraryEntryFacade.js`;
`webgpu-os/apps/realmforge/modeler/session/ModelerSession.js`.)

## Navigate the Modeler

The Modeler owns one semantic document and projects it into coordinated views.
Workspace layout, Focus Mode, and selection stay separate from semantic
history. The default shell keeps a searchable Add/Structure browser, a dominant
viewport, one contextual inspector, and a collapsed AI Echo prompt. Utility
surfaces remain closed until the user requests them. (Sources:
`webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeWorkbench.js`;
`webgpu-os/apps/realmforge/modeler/workspace/RealmForgeWorkspaceContracts.js`.)

| Mode | Purpose |
| --- | --- |
| Build | Assemble parts, edit parameters, and inspect compatible sockets. |
| Construct | Generate product-level patterns, inspect the BOM, and play the construction plan. This mode appears only for construction content. |
| Animate | Edit and preview animation when a rig or animation resource exists. |
| Simulate | Run supported physical or behavioral resources. |
| Review | Inspect validation, revisions, provenance, BOMs, and exports. |
| Advanced | Open SystemGraph, source evidence, and developer diagnostics. |

Switching workspace modes keeps the current asset and its Undo history.
Construct and Simulate use the assembly displayed in the viewport, even when
the resource inspector is showing a retained assembly from an earlier design.
The viewport's **Simulate** button enters Simulate and closes exclusive Water,
Actions, storage, and circuit editing tools before starting physics on the
current asset. The first click prepares physics after a loading frame and starts
automatically for the same asset and account. **Cancel start**, leaving Simulate,
suspending the app, or changing the document cancels that pending start.
**Copy Diag** records the assembly identifiers
and last mode transition when reporting a model mismatch. (Source:
`webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`.)

The mode resolver derives availability from document resources. Focus Mode
dims unrelated installed pieces and exposes compatible unoccupied sockets. It
does not write a semantic transaction. Large construction hierarchies group
content by storey, system, element, pattern, and product. Individual pieces
load only for an expanded page, search result, selection, or damage state.
(Sources:
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeModeAvailability.js`;
`webgpu-os/apps/realmforge/modeler/viewport/RealmForgeSemanticFocusProjection.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeConstructionHierarchyProjection.js`.)

The **Project** control opens one searchable project navigator inside the 3D
viewport. Its virtualized rows can select semantic parts and resources while
assembled, exploded, and isolate presentations keep the complete asset in
spatial context. Search, scrolling, callout placement, input focus, and
presentation transforms remain workspace state; they never enter ForgeSource
or document history. The viewport uses the shared Engine render-surface path,
and a semantic DOM mirror preserves keyboard and assistive-technology access.
The tree has one Tab stop. Arrow keys navigate rows and parent/child groups;
**Home**, **End**, **Page Up** and **Page Down** move focus without selecting.
**Enter** or **Space** selects the focused item. Typing jumps to matching row
names. Search reveals matching descendants, then restores collapsed groups
when cleared. Rows and navigator buttons retain focus across redraws.
In **Assembly view**, the animation button names the next direction.
**Reverse** changes direction between the endpoints; at **Assembled** use
**Animate explode**, and at **Exploded** use **Animate assemble**. Scrubbing
pauses animation. Assembly dropdowns follow the current OS theme.
(Sources:
`webgpu-os/apps/realmforge/modeler/viewport/RealmForgeViewportProjectNavigator.js`;
`webgpu-os/apps/realmforge/modeler/viewport/ModelerViewport.js`;
`webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`.)

Asset compilation publishes ordered, monotonic loading checkpoints instead of
blocking the shell until the complete projection exists. The viewport can
reveal completed batches with its optional energy-print presentation while
identity and document authority remain unchanged. Each stage emits structured
counts and duration data to the browser console. **Copy Diagnostic** produces
one bounded, redacted report containing renderer, batching, loading, and
last-good state without copying source bytes or user content. (Sources:
`webgpu-os/apps/realmforge/modeler/session/RealmForgeLoadProgress.js`;
`webgpu-os/apps/realmforge/modeler/session/ModelerSession.js`;
`webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`.)

The responsive shell keeps stable pane ownership while changing full,
overlay, and compact-tab presentation modes. Keyboard focus, reduced motion,
and hidden-pane availability are expressed through semantic DOM and ARIA
state. (Sources:
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeWorkbench.js`;
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeWorkbenchStyles.js`.)

## Start from Asset Home

Asset Home is a thumbnail-first library. Search can cross labels, categories,
capabilities, sockets, parameters, and supported actions. The nine primary
categories are Examples, Furniture, Vehicles, Characters, Construction
Materials, Stock Products, Construction Patterns, Assemblies, and Buildings.
The legacy flipper, tree, and crate remain available as compatibility
templates. (Sources:
`webgpu-os/apps/realmforge/catalog/RealmForgeLibraryEntryFacade.js`;
`webgpu-os/apps/realmforge/ui/RealmForgeStartView.js`;
`webgpu-os/apps/realmforge/ui/RealmForgeTemplateThumbnail.js`.)

Asset Home selects the first usable template by default and renders its version,
parameters, capabilities, sockets, readiness, generated thumbnail, and primary
action in one persistent preview pane. Selecting another card updates that pane
without navigation or document mutation. At widths below 900 pixels the same
preview becomes an inline region instead of a separate route. RealmForge also
generates an editable name and canonical slug from the selected template, so
**Use as New Asset** can proceed directly. Insert into Current Asset uses the
guarded package or construction template transaction when that entry supports
insertion. (Sources:
`webgpu-os/apps/realmforge/catalog/RealmForgeLibraryEntryFacade.js`;
`webgpu-os/apps/realmforge/ui/RealmForgeStartView.js`;
`webgpu-os/apps/realmforge/ui/RealmForgeAppStyles.js`;
`webgpu-os/apps/realmforge/packages/RealmForgePackageCompiler.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeConstructionDocumentProjection.js`.)

## Compose reusable packages

RealmForge uses content-addressed `realmforge.module-package@1.0.0` and
`realmforge.template-package@1.0.0` records. Module packages own reusable parts,
slots, resources, parameters, and one-level variants. Template packages pin
their dependencies and compose module instances, bindings, attachments, and an
optional SystemGraph. An upgrade requires a separate preview and apply step.
(Sources:
`webgpu-os/apps/realmforge/packages/RealmForgePackageContracts.js`;
`webgpu-os/apps/realmforge/packages/RealmForgePackageRegistry.js`.)

Compilation expands one package through one guarded document transaction.
Generated resources retain `assembly.module-instance` provenance. Variant
resolution applies the base, then one named variant, then instance overrides.
Variant-of-variant chains fail validation. (Sources:
`webgpu-os/apps/realmforge/packages/RealmForgePackageCompiler.js`;
`webgpu-os/apps/realmforge/modeler/session/ModelerSession.js`.)

The verified runtime compiler resolves packages and document resources into one
immutable `RecipeRuntimePlan`. Its projections share one interface network,
compact semantic instance set, stable picking map, semantic connectivity,
rigid-cluster graph, moving-constraint graph, renderer batches, physics plan,
domain solvers, procedures, BOM, and validation targets. A single `planHash`
binds those projections. Plans are capability-keyed caches, not editable
authority. Domain-pack manifests register bounded schema, adapter, solver,
export, and test surfaces without allowing package JavaScript or creating a
second global registry. (Sources:
`webgpu-os/apps/realmforge/modeler/runtime-plan/RealmForgeInterfaceNetwork.js`;
`webgpu-os/apps/realmforge/modeler/runtime-plan/RealmForgeInterfaceNetworkAdapters.js`;
`webgpu-os/apps/realmforge/modeler/runtime-plan/RealmForgeSemanticInstanceSet.js`;
`webgpu-os/apps/realmforge/modeler/runtime-plan/RealmForgeDomainPackManifest.js`;
`webgpu-os/apps/realmforge/modeler/runtime-plan/RealmForgeRecipeRuntimePlan.js`.)

## Describe recipe asset anatomy

Reviewed modular recipes use a shared component anatomy. It prevents a recipe
from flattening primary solids, mechanisms, connection media, accessories, and
appearance into an ambiguous parts list.

| Role | Requirement | Meaning |
| --- | --- | --- |
| `body` | Required | Closed solids that establish shape, mass, support, collision, and stable identity. |
| `interface` | Required | Sockets, holes, contact patches, insertion volumes, clearance envelopes, and replacement boundaries. |
| `functional` | Derived | Mechanisms, rigs, sensors, storage, and other capability-bearing systems. |
| `connector` | Derived | Fasteners, mortar, adhesive, weld, bearings, and other explicit joint products. |
| `attachment` | Optional | Replaceable accessories mounted through declared interfaces. |
| `finish` | Optional | Coatings, upholstery, glazing, and appearance overlays that preserve physical-material evidence. |
| `decorative` | Optional | Trim, badges, moldings, and seams that cannot satisfy physical readiness. |
| `behavior` | Derived | Animation, physics, vehicle, Life, interaction, or construction-task bindings. |

`Derived` means that the role becomes necessary when the requested capability
introduces it. It does not authorize a recipe to invent a connector or missing
evidence. The registry validates each role and includes the anatomy in both the
recipe resource and its AI Echo prompt fragment. (Sources:
`webgpu-os/apps/realmforge/recipes/ToolRecipeRegistry.js`;
`webgpu-os/apps/realmforge/recipes/RealmForgeRecipes.js`;
`webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`.)

## Separate materials, products, and instances

A construction material describes a substance and its sourced properties. A
stock product describes reusable geometry made from that material. An instance
is one installed brick, board, sheet, connector, or other piece. RealmForge
does not infer engineering values from appearance presets. Missing evidence
blocks only readiness that needs that evidence. (Sources:
`engine/assets/material/composite/ConstructionCompositeMaterialCatalog.js`;
`webgpu-os/apps/realmforge/material/RealmForgeMaterialContracts.js`;
`webgpu-os/apps/realmforge/construction/ConstructionStockProducts.js`.)

Use **New Material** to create an overlay from a catalog substance. Appearance
changes and unsourced values remain visibly authored estimates. Use **New Stock
Product** to choose its form, metric dimensions, tolerances, material,
orientation, cut behavior, collider, and canonical sockets. Both workflows
commit through one guarded history transaction. (Sources:
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeMaterialStockAuthoring.js`;
`webgpu-os/apps/realmforge/modeler/session/ModelerSession.js`.)

Procedural finish resources generate content-addressed, tileable base-colour,
normal, metallic, roughness, and occlusion maps from registered deterministic
generators. A finish overlay references a physical material; it never copies
or completes missing physical evidence. The viewport binds generated normal
maps through its shared material projection. (Sources:
`engine/assets/material/procedural/ProceduralPbrTexture.js`;
`webgpu-os/apps/realmforge/material/RealmForgeProceduralPbr.js`;
`webgpu-os/apps/realmforge/modeler/viewport/ModelerViewport.js`.)

Repeated fired-clay and mineral products also receive a stable per-instance
tint and roughness offset from their semantic identity. This appearance-only
variation keeps brick and mortar from looking cloned without changing
dimensions, contact, mass, sourced material evidence, batch membership, or draw
count. The same stable ID reproduces the same finish after reload. (Source:
`webgpu-os/apps/realmforge/modeler/viewport/ModelerViewport.js`.)

### Texture Studio

Open **Object tools → Textures** to generate and inspect procedural surface
maps. The panel stays nonmodal so you can select another piece in the viewport
or Project navigator while it is open. Choose one of 16 material patterns and a
**Realistic**, **Stylized**, or **Clean** starting style. Each preset explains its
pattern and surface steps.
Adjust the seed, color, pattern density, variation, roughness, metalness,
normal strength, crevice shading, UV repeat, and rotation. The four map tabs
show actual base color, normal, packed metal/roughness, and occlusion pixels.
Use the 3 × 3 preview and seam guides to inspect tiling. (Sources:
`webgpu-os/apps/realmforge/material/studio/RealmForgeTextureRecipes.js`;
`webgpu-os/apps/realmforge/material/studio/RealmForgeTextureStudio.js`;
`webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`.)

Pattern density is enabled for the seven patterns that support it: wood,
plywood, OSB, brushed metal, woven fabric, ribbed rubber, and block tread.
For other patterns, use **Mapping & output → Repeat U / Repeat V** to change
their density across the object. (Sources:
`engine/assets/material/procedural/ProceduralPbrTexture.js`;
`webgpu-os/apps/realmforge/material/studio/RealmForgeTextureStudio.js`.)

For example, select a house wall in the viewport or Project navigator, open
Textures, choose **Wood**, adjust its grain density, and use **Apply material**.
Apply targets either the selected piece or all pieces sharing its displayed
material. It switches the viewport to **Mesh**, which displays complete authored
UV texture maps. SDF supports mapped analytic faces as described under House
styles below. Opening the studio leaves the
active asset and renderer unchanged. An uncommitted design preview cannot apply
textures to the asset behind it. Close the studio to return to the asset.
(Sources: `webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`;
`webgpu-os/apps/realmforge/modeler/viewport/ModelerViewport.js`.)

Apply generates four hashed texture resources, one visual material, and stable
part assignments in one guarded transaction and one Undo entry. Save/reopen
retains the recipe, seed, mapping, and assignments in the account-scoped asset.
The render projection preserves original geometry, picking IDs, construction
products, and physical evidence. Cancellation, changed document heads, or changed
account ownership cannot publish pending work. Deleted targets retain dormant
assignments and cannot transfer their appearance to another piece. (Sources:
`webgpu-os/apps/realmforge/material/studio/RealmForgeTextureBindings.js`;
`webgpu-os/apps/realmforge/modeler/session/ModelerSession.js`;
`webgpu-os/apps/realmforge/modeler/session/RealmForgePhase6Projection.js`.)

**Save recipe** downloads versioned JSON; **Load recipe** accepts strict data-only
recipes up to 16 KiB. Each map has a separate PNG export at the selected 128,
256, 512, or 1024 pixel output size. Preview generation uses 128 pixels to keep
editing responsive. Output is deterministic for an identical descriptor and
generator version; preview and export use the same existing generator. Normal
strength in this generator depends on output resolution, so compare final maps
at their intended size. This first studio does not add texture painting,
displacement geometry, image synthesis, or a programmable node editor. Its
occlusion map approximates crevices rather than baking surrounding geometry.
(Sources: `engine/assets/material/procedural/ProceduralPbrTexture.js`;
`webgpu-os/apps/realmforge/material/studio/RealmForgeTextureStudio.js`.)

The **Texture Studio** rendering demo in the Components Playground reuses this
editor and provides a live WebGPU plane/sphere preview with all four maps.
Open `/tests/playground/?demo=texture-studio&view=focus` over HTTP. The demo can
export maps and recipes; it does not mutate a RealmForge asset. (Sources:
`tests/playground/src/demos/manifest.js`;
`tests/playground/src/demos/textureStudio/index.js`.)

The editor follows the coordinate, pattern, color, surface, and preview workflow
described by [Blender's Noise Texture documentation](https://docs.blender.org/manual/en/4.0/render/shader_nodes/textures/noise.html)
and [Adobe's material preview controls](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/workspace/3d-view/material-properties).
Base color uses sRGB; normal, occlusion, and packed roughness/metalness use linear
data, with roughness in green and metalness in blue, following
[Khronos glTF material semantics](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#materials).
The Realistic style coordinates these channels as a starting point; realistic
appearance also depends on lighting, scale, and the object. Stylized changes the
recipe, without introducing a toon lighting shader.

### House styles

Open an editable generated house, then choose **Object tools → House styles**.
This modal studio contains keyboard focus and blocks background workbench
commands. **Escape** closes it. Closing returns focus to the visible launcher,
or to the **Object tools** summary if that launcher is hidden.
Compare **Realistic**, **Soft cartoon**, **Cel cartoon**, **Comic**, and
**Low poly** on that same house. Architecture remains a separate choice: a
cottage, cabin, or bungalow can use any of these visual profiles.
**Design another house** returns to Build. (Sources:
`webgpu-os/apps/realmforge/material/studio/RealmForgeHouseStyleStudio.js`;
`webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js`.)

Choose a **Natural**, **Warm**, or **Cool** palette, surface variation, seed,
and map resolution. Edit walls, roof, trim, doors, window frames, floors, and
furniture independently using the existing Texture Studio. **Use palette**
removes that role's override. Glass, screens, door hardware, wiring, pipes,
and utility equipment keep their authored materials. Surface variation changes
procedural colors and detail; it does not damage the house. (Sources:
`webgpu-os/apps/realmforge/material/studio/RealmForgeHouseAppearanceProfiles.js`;
`webgpu-os/apps/realmforge/material/studio/RealmForgeHouseAppearance.js`.)

The appearance controls include light bands, shadow softness and cutoff,
color steps, saturation, surface detail, shaded color, and outline width and
color. Comparison cards use the same frozen camera and seed, with 128-pixel
material maps. The selected preview uses the requested output resolution.
**Original house** restores the current document's appearance for comparison,
including applied changes that have not yet been saved to disk;
**Selected style** shows the pending appearance. Preview changes no document
resources or Undo history. (Sources:
`webgpu-os/apps/realmforge/material/studio/RealmForgeHouseStyleStudio.js`;
`webgpu-os/apps/realmforge/modeler/session/ModelerSession.js`.)

**Apply to whole house** commits the full versioned profile, role recipes, generated
map hashes, materials, and stable part assignments in one guarded transaction
and one Undo entry. Save/reopen retains the appearance in the account-scoped
asset. **Save profile** and **Load profile** exchange strict data-only JSON up
to 16 KiB. A changed account, asset, document head, or target invalidates pending
work. Doors, openings, physical products, construction order, plumbing,
wiring, geometry used for picking, and interaction anchors retain their
original authority. (Sources:
`webgpu-os/apps/realmforge/material/studio/RealmForgeTextureBindings.js`;
`webgpu-os/apps/realmforge/modeler/session/ModelerSession.js`.)

Mesh and SDF share the house lighting profile. SDF samples the same base-color,
normal, packed metal/roughness, and occlusion maps on supported analytic box,
convex, and extruded faces with affine authored UVs. Curved mapped surfaces and
non-affine seams use an explicit Mesh fallback instead of discarding their
maps. **Low poly** uses a simplified, flat-normal display mesh through Mesh;
the original meshes remain authoritative for picking and physics. Applying
or previewing a style preserves the requested renderer mode. The renderer
status explains an effective fallback. (Sources:
`webgpu-os/apps/realmforge/modeler/viewport/ModelerViewport.js`;
`webgpu-os/apps/realmforge/modeler/viewport/RealmForgeSDFViewportRenderer.js`;
`webgpu-os/apps/realmforge/modeler/viewport/RealmForgeHouseStyleShading.js`.)

Generated maps upload full mip chains, averaging base colors in linear light
and renormalizing normal maps. Minification filters reduce distant texture
noise. Semantic outlines use screen-pixel width and merge members of the same
house role, so they emphasize silhouettes and openings without tracing every
stud or brick. The lighting controls follow the separation of shading, shade
color, and outline parameters in the
[VRM MToon specification](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_materials_mtoon-1.0/README.md).
These are render appearances rather than new building systems. (Sources:
`webgpu-os/apps/realmforge/modeler/viewport/RealmForgeTextureMipChain.js`;
`webgpu-os/apps/realmforge/modeler/viewport/RealmForgeHouseOutline.js`.)

Build from words and Explore also understand supported appearance requirements,
for example `a soft cartoon cottage with warm exterior palette`,
`a comic cabin with 2 px outlines`, and `a low poly bungalow`.
Known phrases run locally.
Their prepared output contains the complete verified appearance, so the first
build also creates one transaction. Explore's small cards are labeled
**palette preview**; House styles provides full material comparisons.
Conflicting styles and unsupported architecture stay visible for clarification.
Equivalent wording, resolved profile, seed, and dependency versions produce
identical output. (Sources:
`webgpu-os/apps/realmforge/construction/RealmForgeHouseAppearanceText.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeBuildIntent.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeProceduralHouse.js`;
`webgpu-os/apps/realmforge/ui/RealmForgePreparedBuildThumbnail.js`.)

Expanded stock products can declare box, sphere, capsule, and convex-envelope
colliders. They can also declare sourced net volume and mass, running-clearance
envelopes, tool-gated insertion volumes, and named physical slots. The runtime
uses net volume for density-derived mass instead of treating every collider
envelope as solid material. (Sources:
`webgpu-os/apps/realmforge/construction/ConstructionResources.js`;
`webgpu-os/apps/realmforge/construction/runtime/RealmForgeConstructionPresetPhysics.js`.)

ForgeSource is not limited to cuboids. Its registered primitive set includes
box, tapered box, sphere, cylinder, hollow cylinder, cone, capsule, torus, and
plane. `tapered-box` adds `topWidth`, `frontInset`, and `rearInset` while keeping
deterministic geometry keys and validated positive profiles. Compilation and
runtime projection reuse registered production geometry generators instead of
accepting package-supplied JavaScript. (Sources:
`webgpu-os/apps/realmforge/modeler/lang/ForgeSource.js`;
`webgpu-os/apps/realmforge/modeler/compile/AssemblyCompiler.js`;
`webgpu-os/apps/realmforge/modeler/adapters/RealmForgeCoreAdapterRuntime.js`.)

## Build and play construction assemblies

`assembly.modular@1.0.0` stores compact logical product instances and joins.
Stable IDs derive from pattern identity, role, and logical coordinates instead
of loop order. Pattern resources cover running and stack masonry bonds, stud
walls, joist grids, rafter runs, sheet grids, and beam grids. Openings generate
the affected cuts and framing instead of acting as viewport-only holes.
(Sources:
`webgpu-os/apps/realmforge/construction/ConstructionResources.js`;
`webgpu-os/apps/realmforge/construction/ConstructionPatterns.js`.)

Construct mode plays the same deterministic task plan that `Human.Basic` can
consume. Tasks express stock requirements, dependencies, placement frames,
capabilities, connections, and temporary support. The BOM reports counts,
lengths, areas, volumes, resolved masses, waste, product and material hashes,
and one deterministic result hash. (Sources:
`webgpu-os/apps/realmforge/construction/runtime/ConstructionPlanPlayback.js`;
`webgpu-os/apps/realmforge/construction/runtime/ConstructionPlanBridge.js`;
`webgpu-os/apps/realmforge/modeler/character/RealmForgeHumanContracts.js`.)

Installed pieces keep semantic identity while rendering in prototype batches.
Construction joins form adaptive connectivity islands. Added joins merge
islands. Removed joins recompute only the affected region. Detached regions
project to one compound dynamic body when the public physics capability is
available. (Sources:
`webgpu-os/apps/realmforge/construction/runtime/ConstructionInstanceBatchPlan.js`;
`webgpu-os/apps/realmforge/construction/runtime/ConstructionIslandGraph.js`;
`webgpu-os/apps/realmforge/construction/runtime/ConstructionPhysicsProjection.js`.)

Large deterministic house generation runs in a dedicated module worker while
the shell continues to paint measured loading stages and accept input. The
worker imports the pure construction transaction boundary rather than the
physics-dependent document projection. Its release closure is audited exactly:
a missing dependency, an unreviewed extra dependency, or changed module bytes
fails packaging and origin verification. This keeps the construction worker
small and prevents the protected simulation implementation from entering its
dependency graph. (Sources:
`webgpu-os/apps/realmforge/construction/RealmForgeConstructionGenerationWorker.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeConstructionGenerationClient.js`;
`webgpu-os/apps/realmforge/construction/RealmForgeConstructionDocumentTransaction.js`;
`bundler/site.py`; `bundler/origin_verifier.py`.)

Mesh, Voxel, SDF, and Nexel views consume the same stable semantic instance IDs and
prototype batches. Geometry is interleaved and validated once per prototype,
selection changes use uniforms instead of rewriting instance buffers, and
frame uniforms are uploaded as one slab. Strict cuboid voxel products use an
analytic projection; unsupported topology falls back without changing semantic
authority. The SDF view uses the public Engine `SDFBakeCompute` path to bake one
bounded `r32float` distance volume per geometry prototype, then raymarches all
matching instances in one prototype/material batch. SDF requires an initialized
WebGPU viewport, supports 16 to 40 cells per axis and at most 256 prototypes,
and fails closed to the last-good renderer. It derives material factors but does
not project UV textures. Projection caches are invalidated by content and
renderer state, so switching renderers does not regenerate unchanged products.
(Sources:
`webgpu-os/apps/realmforge/modeler/viewport/ModelerViewport.js`;
`webgpu-os/apps/realmforge/modeler/viewport/RealmForgeModularAssemblyViewportModel.js`;
`webgpu-os/apps/realmforge/modeler/viewport/RealmForgeVoxelViewportProjection.js`;
`webgpu-os/apps/realmforge/modeler/viewport/RealmForgeSDFViewportRenderer.js`.)

The runtime keeps semantic connectivity, rigid clusters, and moving
constraints separate. Fixed joins union only rigid regions. Runtime-policy
slots create public revolute constraints for swivels and wheels. Directly
constrained bodies suppress pair collision; a failed constraint rebuilds the
affected topology so detached bodies collide again. Bounded broadphase and
OBB/SAT review report required contact, permitted insertion, running-clearance
violations, and forbidden solid overlap. Readiness reports gravity, contact,
articulation, and sourced load-failure evidence separately. (Sources:
`webgpu-os/apps/realmforge/construction/runtime/ConstructionArticulationProjection.js`;
`webgpu-os/apps/realmforge/construction/runtime/ConstructionCollisionValidation.js`;
`webgpu-os/apps/realmforge/construction/runtime/RealmForgeConstructionPresetPhysics.js`.)

The collision review is also the strict solid detector for installed products.
A bounded sweep-and-prune broadphase feeds a 15-axis OBB/SAT narrowphase. Solid
overlap fails unless exact joint and slot evidence classifies it as fastener
insertion, cast-in embedment, or an authored press fit. Insertion methods
require an explicit connector instance. Wood-to-wood welds fail, and mortar or
adhesive joins require an explicit material reference. Missing contact frames,
medium geometry, joint methods, or endpoint evidence remain diagnostics rather
than implicit permission. (Source:
`webgpu-os/apps/realmforge/construction/runtime/ConstructionCollisionValidation.js`.)

Validated mortar, adhesive, and weld joins can render as derived, filled
connection-media geometry. Standard, close, and high masonry detail project
the exact mortar gap with a distinct concave, V, grapevine, or flush filled
mesh. Pinned bond patterns restore joints compacted out of the fixed runtime
graph, while first-class weep vents keep their intentional head-joint openings
clear. Each proxy has a stable presentation ID, picks back to its semantic
connection, and joins a prototype batch by medium kind, shape, and tooling
profile. The cache does not add products, assembly instances, joins, or BOM
lines. Exact geometry that cannot be derived produces a visible diagnostic
instead of a guessed fill.
(Sources:
`webgpu-os/apps/realmforge/construction/runtime/RealmForgeMortarDetailProjection.js`;
`webgpu-os/apps/realmforge/construction/runtime/RealmForgeConnectionMediumProjection.js`.)

The optional structural result is a **Structural gameplay preview**. It uses
the public Engine structural solver, preserves authored mass and capacity
evidence, and fails closed when required evidence is missing. It is heuristic
and is not an engineering analysis. (Source:
`webgpu-os/apps/realmforge/construction/runtime/RealmForgeStructuralGameplayProjection.js`.)

## Use the starter templates

The construction catalog includes `Chair.Basic` 1.1, `Chair.Office` 2.1,
`Room.ChairDemo`, `House.Small.Hybrid`, and `House.Small.LoadBearing`. The house
starters use a 6 by 8 metre footprint, 2.4 metre wall height, 30 degree gable
roof, one exterior door, and four windows. Bricks, boards, sheets, fasteners,
ties, openings, roof products, and other installed products remain separately
selectable. (Source:
`webgpu-os/apps/realmforge/construction/ConstructionExamples.js`.)

The immutable package registry retains `Chair.Office` 2.0, `Cart.Basic` 1.0,
and `Car.Sedan` 2.0 packages for exact saved references. Chair 2.1, Cart 1.1,
and Sedan 2.1 are additive pinned packages. Package versions never advance
implicitly. (Source:
`webgpu-os/apps/realmforge/packages/RealmForgeBuiltInPackages.js`.)

The broader library also includes `Cart.Basic` 1.1, `Car.Sedan` 2.1,
`Humanoid.Mannequin`, and `Human.Basic`. Vehicle rigs retain wheel, steering,
drive, braking, light, seat, and door roles. `Human.Basic` adds locomotion,
interaction sockets, sensors, inventory, carry capability, and bounded Life
state to the mannequin-derived actor. (Sources:
`webgpu-os/apps/realmforge/examples/RealmForgeMobilityCharacterExamples.js`;
`webgpu-os/apps/realmforge/modeler/vehicle/RealmForgeVehicleRigContracts.js`;
`webgpu-os/apps/realmforge/modeler/character/RealmForgeHumanContracts.js`.)

`Chair.Basic` compiles as one fixed gravity-ready cluster with fitted joinery.
`Chair.Office` remains one selectable asset while its seat, five caster forks,
and ten wheel cores retain explicit moving constraints. Its default 65 mm
twin-wheel casters expose a 50–80 mm range, separate glass-filled nylon cores
and polyurethane treads, running-clearance envelopes, press-fit stem evidence,
17 rigid clusters, and 16 public revolute constraints. `Cart.Basic` 1.1 uses a
profiled tapered chassis and bed, a capsule handle, reusable axle modules, and
four rotary wheel modules. `Car.Sedan` 2.1 uses a profiled tapered shell, hood,
trunk, and cabin while preserving its stable body and wheel-corner roles. Its
authoring basis is right-handed, Y-up, and +Z-forward; the Vehicle2 adapter
performs the basis conversion at the public physics boundary. The same
boundary configures and reads back PhysX Vehicle2 differential torque and
clutch-speed ratios before claiming exact FWD, RWD, or AWD readiness; a missing
ratio or validation method fails closed. (Sources:
`webgpu-os/apps/realmforge/construction/ConstructionExamples.js`;
`webgpu-os/apps/realmforge/examples/RealmForgeMobilityCharacterExamples.js`;
`webgpu-os/apps/realmforge/packages/RealmForgeBuiltInPackages.js`;
`engine/assets/vehicle/VehicleProfile.js`;
`engine/assets/vehicle/VehiclePublicRuntime.js`;
`engine/assets/vehicle/SedanProceduralModel.js`;
`webgpu-os/apps/realmforge/modeler/vehicle/RealmForgeVehicleRigContracts.js`.)

Both verified house projections include explicit 38 × 140 mm lumber, joist
hangers, rafter seats, truss clips, hurricane ties, angles, straps, blocking,
gussets, connector plates, matching nails and screws, and complete fascia,
soffit, gutter, and downpipe systems. Every roof coordinate resolves stable
compact connector and per-hole fastener identities with exact insertion
volumes and tool sets. Engineering, manufacturing, purchasing, installation,
service, and simulation BOM views derive from one pinned projection. Missing
connector capacities and jurisdiction evidence stay visibly unsupported; the
preflight never claims approval, compliance, or certification. (Sources:
`webgpu-os/apps/realmforge/construction/ConstructionStockProducts.js`;
`webgpu-os/apps/realmforge/construction/verified/RealmForgeVerifiedHousePhase8.js`;
`webgpu-os/apps/realmforge/construction/verified/RealmForgeVerifiedHouseSlice.js`.)

## Compile and simulate supported systems

Assembly compilation derives preview geometry from ForgeSource and shared
Engine primitives. SystemGraph compilation validates node types, typed ports,
rates, fan-in, cycles, resource bindings, and deterministic plan identity
before activation. A failed candidate leaves the previous compiled plan and
preview active. (Sources:
`webgpu-os/apps/realmforge/modeler/compile/AssemblyCompiler.js`;
`webgpu-os/apps/realmforge/modeler/system-graph/RealmForgeSystemGraphCompiler.js`;
`webgpu-os/apps/realmforge/modeler/runtime/RealmForgeRuntimeController.js`.)

RealmForge registers resource adapters for core assets, electrical systems,
reconstruction, rope, living growth, particles, MorphField, sensors,
telemetry, scenarios, cloth, soft bodies, wire systems, and audio patches.
Each adapter reports its actual capabilities. Unsupported activation,
snapshot, patch, bake, replay, GPU, or device operations fail explicitly; an
inspector-only resource never claims live runtime authority. (Sources:
`webgpu-os/apps/realmforge/modeler/adapters/RealmForgeAdapterRegistry.js`;
`webgpu-os/apps/realmforge/modeler/phase9/RealmForgePhase9ResourceAdapters.js`.)

The electronics domain pack reuses that same adapter and runtime-plan boundary
for boards, pads, vias, traces, zones, footprints, harness wires, splices,
shields, routed connections, bounded controller peripherals, and reduced-order
motors. Controller I/O is driven only by precompiled ForgeBehavior, uses a
seeded deterministic runtime, and crosses an explicit integer next-tick
feedback boundary rather than creating a hidden algebraic loop. Its validation separates
electrical-rule, physical-clearance, continuity, current, thermal, mechanical,
and evidence readiness. External comparison results can be attached as
evidence, but they do not become native simulation authority. (Sources:
`webgpu-os/apps/realmforge/modeler/electronics/RealmForgeElectronicsDomainPack.js`;
`webgpu-os/apps/realmforge/modeler/electronics/RealmForgeControllerIoContracts.js`;
`webgpu-os/apps/realmforge/modeler/electronics/RealmForgePcbContracts.js`;
`webgpu-os/apps/realmforge/modeler/electronics/RealmForgeHarnessContracts.js`;
`webgpu-os/apps/realmforge/modeler/electronics/RealmForgeReducedMotorContracts.js`;
`webgpu-os/apps/realmforge/modeler/electronics/RealmForgeElectronicsValidation.js`.)

## Use guarded AI operations

RealmForge exposes read-only resources under `os.realmforge://` and registers
caller-scoped OS commands and tools. AI mutations use the same guarded session
transactions and persistent history as UI edits. The bridge checks the
expected document revision and content hash both before and after asynchronous
work. It does not expose JavaScript approval authority. (Sources:
`webgpu-os/apps/realmforge/modeler/ai/RealmForgePhase9AiCommandBridge.js`;
`webgpu-os/apps/realmforge/factory.js`;
`webgpu-os/apps/realmforge/modeler/script/RealmForgeJavaScriptApprovalRegistry.js`.)

Equivalent reconstruction edits now converge through the registered manual
`os.realmforge.resource.add` command and the command-backed AI
`applyTransaction` tool. They produce identical semantic operations, history
envelopes, resources, and deterministic content hashes. Route-owned provenance
remains deliberately distinct: the user and AI actors, transaction UUIDs, and
timestamps are not caller-selectable parity fields. Unknown provenance fields
are rejected by the closed AI mutation schema. (Sources:
`tests/realmforge/reconstruction-manual-ai-parity.test.js`;
`webgpu-os/apps/realmforge/modeler/ai/RealmForgePhase9AiCommandBridge.js`;
`webgpu-os/kernel/tools/ToolCallSchemaValidator.js`.)

RealmForge sends model execution to AI Echo. The first prompt for an asset opens
a linked AI Echo conversation under **RealmForge Contracts**. Later revisions
of the same asset continue that conversation. **New chat** creates another
linked conversation for the asset, while a different asset receives a separate
conversation. Durable AI Echo replies and run status return to RealmForge as
guarded events. A reply never applies a document mutation by itself. Both apps
use the neutral shared contract rather than importing each other. (Sources:
`webgpu-os/shared/realmforge-contracts/RealmForgeAIEchoContracts.js`;
`webgpu-os/apps/ai-echo/RealmForgeTaskHandoff.js` compatibility facade;
`webgpu-os/apps/ai-echo/factory.js`;
`webgpu-os/apps/realmforge/factory.js`.)

AI requests use `realmforge-ai-request-v1`. Reviewed proposals use
`realmforge-ai-proposal-v1` and bind the expected revision, content hash, and
`planHash`. Preview is read-only. Apply, Reject, and Revise remain explicit user
decisions. Apply executes one undoable `ModelerSession` transaction, and stale
proposals fail closed. (Source:
`webgpu-os/apps/realmforge/modeler/ai/RealmForgeAiProposalContracts.js`.)

Reviewed recipes are guidance, not capabilities. The current tool registry
must contain every referenced tool before a recipe can execute. Recipe access
does not grant file, script, storage, or simulation authority. (Sources:
`webgpu-os/apps/realmforge/recipes/ToolRecipeRegistry.js`;
`webgpu-os/apps/realmforge/recipes/RealmForgeRecipes.js`.)

Furniture, vehicle, roof, material, package, regeneration, validation, damage,
and repair recipes all begin with a non-mutating preview. A recipe preview
reports generated pieces, joins, rigid clusters, articulations, collisions,
BOM and mass deltas, performance cost, readiness, and affected stable IDs.
Only the normal guarded proposal path can apply the reviewed result. (Source:
`webgpu-os/apps/realmforge/recipes/RealmForgeRecipes.js`.)

## Publish artifacts with provenance

Exports capture their source from the active session instead of accepting a
caller-authored model or provenance record. RealmForge supports static mesh
artifacts, transform and skeletal/morph animation, topology bakes,
topology-changing frame sequences, telemetry traces, and checkpoints when the
selected source satisfies that mode's contract. (Sources:
`webgpu-os/apps/realmforge/export/RealmForgeSessionExport.js`;
`webgpu-os/apps/realmforge/export/RealmForgeArtifactExportPipeline.js`.)

Publication writes to an immutable destination, verifies artifact bytes, and
accepts only the storage layer's exact atomic commit evidence. The final
receipt binds the source head, selected resources, graph or compiled plan,
adapter versions, settings, migration and script evidence, artifact hashes,
and provenance. The encrypted receipt store is an append-only discovery index;
it cannot turn a completed artifact publication into a different authority.
(Sources:
`webgpu-os/apps/realmforge/export/RealmForgeArtifactProvenance.js`;
`webgpu-os/apps/realmforge/export/RealmForgeReceiptContracts.js`;
`webgpu-os/apps/realmforge/export/EncryptedReceiptStore.js`.)

Construction `.proasset` exports preserve packages, stable instance IDs,
patterns, joins, plans, provenance, and BOMs. glTF export uses
`EXT_mesh_gpu_instancing` when the target supports it and writes stable mapping
and BOM sidecars. Shared-node or flattened fallbacks remain deterministic. OBJ
and STL are flattened compiled artifacts; export does not write one resource
file per installed brick. (Sources:
`webgpu-os/apps/realmforge/construction/export/ConstructionStructuredExport.js`;
`webgpu-os/apps/realmforge/export/GLBWriter.js`.)

A reviewed release manifest can be signed only after its roots, dependency
locks, validation receipts, limitations, and readiness are internally
consistent. The release publisher delegates signing to the existing OS
identity service and requires persistent signing by default. Signing does not
self-approve, self-pin, or make a publisher trusted. The trust adapter verifies
certificate chains, expiry, rotation, revocation, pinning, and exact manifest
bytes through the OS trust store. Private package libraries store only verified
immutable releases and require explicit dependency-upgrade previews. (Sources:
`webgpu-os/apps/realmforge/release/RealmForgeReleasePublisher.js`;
`webgpu-os/apps/realmforge/release/RealmForgeReleaseTrustAdapter.js`;
`webgpu-os/apps/realmforge/release/RealmForgePrivatePackageLibrary.js`.)

## Migrate v1 without changing the source

The v1 reader is retained only as an explicit migration path. Preview reads,
validates, fingerprints, and summarizes the v1 source without writing. A
migration requires explicit confirmation and a separate unoccupied v2
destination. It archives every exact v1 source byte under the new asset's
migration evidence, publishes a copy-on-write v2 root, reopens that root, and
checks the prepared content hash before activation. The original v1 path is
never the publication root. (Sources:
`webgpu-os/apps/realmforge/document/migration/RealmForgeV1Migration.js`;
`webgpu-os/apps/realmforge/document/migration/RealmForgeV1MigrationContracts.js`;
`webgpu-os/apps/realmforge/document/lifecycle/RealmForgeActiveDocument.js`.)

Migration evidence includes the source root hash, exact archive hashes, a
migration manifest, a migration receipt, and a reference stored in the v2
document extension. This evidence makes rollback and independent recovery of
the original v1 bytes possible without rewriting them. (Sources:
`webgpu-os/apps/realmforge/document/migration/RealmForgeV1Migration.js`;
`webgpu-os/apps/realmforge/document/repository/RealmForgeRevisionRepository.js`.)

## Import source evidence through the Source Gateway

The Source Gateway is a guarded inspect, normalize, source-lock, candidate,
preview-diff, and apply pipeline. It preserves the exact supplied bytes and
never fetches referenced URIs or executes source code. Byte, nesting, time,
record, geometry, URI, and license budgets are checked before a candidate can
enter a document transaction. Preview is pure, and Apply requires its exact
preview token. Unchanged reimport produces an empty semantic diff; corrections
either rebase deterministically or remain explicit orphans. (Sources:
`webgpu-os/apps/realmforge/import/RealmForgeSourceGatewayContracts.js`;
`webgpu-os/apps/realmforge/import/RealmForgeSourceGateway.js`.)

Browser-native mesh import remains available. Bounded semantic adapters cover
neutral Fusion bundles, an explicit AP242 subset, an IFC semantic subset, IDS
requirements, and KiCad schematic and board records in that order. Each adapter
records source mappings, unsupported records, and semantic loss. Raw Fusion
archives and unsupported CAD entities remain unavailable unless an isolated
optional converter supplies a neutral content-addressed bundle; they never
become a RealmForge launch dependency. (Source:
`webgpu-os/apps/realmforge/import/RealmForgeSourceGatewaySemanticAdapters.js`.)

## Recover safely

RealmForge publishes manifests last. A missing or corrupt head can fall back to
the last verified commit without overwriting evidence. External clean changes
reload; external dirty changes enter an explicit conflict workflow. Immediate
close waits for queued persistence, and unmount closes the active view,
adapters, audio ownership, receipt store, registration scopes, listeners,
timers, and GPU projections. (Sources:
`webgpu-os/apps/realmforge/document/repository/RealmForgeRevisionRepository.js`;
`webgpu-os/apps/realmforge/document/recovery/RealmForgeRecoveryRepository.js`;
`webgpu-os/apps/realmforge/document/lifecycle/RealmForgeActiveDocument.js`;
`webgpu-os/apps/realmforge/factory.js`.)

ForgeSource and SystemGraph recovery use independent immutable heads. Exact
invalid source bytes and compiler-rejected graph candidates with their
diagnostics survive immediate full app teardown and fresh reopen while the
last-good semantic revision, content hash, preview, graph plan, and history stay
active. Rejected graph bytes participate in external-conflict identity and are
rebased into Save As, Save Copy, or Keep Mine destinations. An
`applied-unsaved` graph sidecar is never copied or replayed when the destination
semantic snapshot already contains that accepted graph change. Candidate graph
and diagnostic payloads are bounded before recursive normalization, and final
external replacement binds the exact graph-draft hash as well as its revision
and state. (Sources:
`webgpu-os/apps/realmforge/document/draft/RealmForgeSystemGraphDraftContracts.js`;
`webgpu-os/apps/realmforge/document/draft/RealmForgeCompositeDraftPersistenceCoordinator.js`;
`webgpu-os/apps/realmforge/modeler/session/ModelerSession.js`;
`tests/realmforge/invalid-draft-reopen.acceptance.test.js`.)

## Verify a release

Run the repository tooling from the repository root:

```bash
python bundle_engine.py --target webgpu-os --dry-run --no-site
python add_spdx_headers.py
python scripts/verify_realmforge_phase10_release.py
```

After source and curated documentation stop changing, regenerate and validate
the documentation from `MD/`:

```bash
python MD/tools/extract_api.py webgpu-os
python MD/tools/build_docs.py
python MD/tools/build_llms.py
python MD/tools/validate_docs.py
```

The complete release additionally requires a source-bound browser receipt,
zero high or critical Security Doctor findings, the full WebGPU OS bundle, and
the cumulative RealmForge verifier. A dry bundle or isolated unit test is not
release evidence by itself. (Sources: `webgpu-os/kernel/SecurityDoctor.js`;
`bundle_engine.py`; `scripts/verify_realmforge_phase10_release.py`.)

## Current boundaries

- Device-dependent audio and GPU presentation state are reconstructable, not
  document authority.
- Unsupported adapter capabilities remain explicit failures.
- Structural gameplay previews are heuristic and are not engineering analyses.
- Missing sourced material properties remain missing; appearance never satisfies
  physical or structural readiness.
- Exact FWD, RWD, and AWD simulation requires the public PhysX Vehicle2
  differential ratio and axle-validation surface. Missing methods or rejected
  readback leave simulation unavailable rather than falling back silently.
- JavaScript execution requires separate user-owned approval and is never an
  AI capability.
- Topology-changing growth cannot be labeled as ordinary GLB animation.
- Receipt discovery is not artifact publication authority.

(Sources:
`webgpu-os/apps/realmforge/modeler/phase9/RealmForgePhase9ResourceAdapters.js`;
`webgpu-os/apps/realmforge/construction/runtime/RealmForgeStructuralGameplayProjection.js`;
`webgpu-os/apps/realmforge/material/RealmForgeMaterialContracts.js`;
`webgpu-os/apps/realmforge/modeler/script/RealmForgeJavaScriptApprovalRegistry.js`;
`webgpu-os/apps/realmforge/export/RealmForgeSessionExport.js`;
`webgpu-os/apps/realmforge/export/EncryptedReceiptStore.js`.)

## Genesis Ecology expansion (planned)

RealmForge will author product and factory genomes, parts, interfaces,
developmental grammars, regulation, homeostasis, reaction ecology, role and
cultural topology, constructive operations, and audience-safe world bindings.
Candidates remain data-only until compiled, evaluated, externally authorized,
and atomically activated. Verified assemblies can be recursively packaged as
immutable parts. This M2+ expansion uses a separate domain pack and package
generation and does not reopen the accepted Virtual Realm M0-M1C boundary. See
[RealmForge Genesis Ecology](realmforge-genesis-ecology.md).

## See also

- [Usable interiors and shelf filling](realmforge-interiors.md)
- [Building programs and utilities](realmforge-building-utilities.md)
- [Electricity and control boards](realmforge-electricity.md)
- [Improvement research and priorities](realmforge-improvement-research.md)
- [Object actions and animation research](realmforge-object-actions.md)
- [WebGPU OS Architecture](architecture.md)
- [App Catalog](app-catalog.md)
- [Security and Trust Model](../concepts/security-model.md)
- [Schema Evolution](../concepts/schema-evolution.md)
- [RealmForge Genesis Ecology](realmforge-genesis-ecology.md)
- [Virtual Realm RealmForge Bake Pipeline](virtual-realm/realmforge-pipeline.md)
