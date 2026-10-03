---
title: Virtual Realm Source City Workbench
description: First physical native-GPU city frame from an explicit project-source snapshot, with bounded provenance, lifecycle ownership, and a path toward walkable city integration.
audience: implementers, reviewers, and local operators
updated: 2026-09-20
status: standalone source-city rendering, navigation and inspectors, RealmForge recipe ownership, authored design editing and manual origin-local saved-design documents implemented; integrated live city and full runtime provider remain open
---

# Virtual Realm Source City Workbench

The first visible city is a standalone development workbench with read-only source data. It renders
real captured project metadata using the existing Virtual Realm native GPU drawing
implementation. It is not the injected-only OS application and does not complete
M2D-B4H, M1C runtime admission, or the full provider.

The user selected visible-city progress while the production provider remains
unfinished. This work runs beside the existing provider ledger, not through a
fabricated admission or a weakened startup contract.

## Open and reproduce

From the repository root, serve the exact preloaded module closure and snapshot:

```powershell
python -B tests/virtual-realm/run_source_city_workbench.py --serve 9018
```

Open `http://127.0.0.1:9018/tests/virtual-realm/source-city-workbench.html` in a
WebGPU-capable browser. The server binds loopback only. It has no directory
fallback and serves no source outside its explicit module closure and declared
assets. Restart this server after editing a source because its responses are
preloaded bytes.

Choose **Kernel city · 40 files** to open the separate expanded capture, or use
`source-city-workbench.html?inventory=kernel`. **Original city · 36 files**
returns to the original baseline. An ordinary profile-link activation awaits
GPU-session cleanup before navigating; these are separate page sessions, not
live inventory mutation. Modified link clicks retain ordinary browser behavior.
Unknown inventory query values fail visibly before snapshot loading or GPU startup.

Choose **Wide streets** to preview the source-bound authored design, or
**Original layout** to restore the exact original recipe. Both inventories
support both designs. Inventory links retain a selected preset; design links
retain the inventory. An ordinary link activation closes the previous GPU
session before loading the new document and returns to the entrance with no
building selected. Modified link clicks retain normal browser behavior.
The wide-design URLs are `source-city-workbench.html?design=wide` and
`source-city-workbench.html?inventory=kernel&design=wide`.
Unknown designs fail before any snapshot/design fetch or native startup.

The **City design** panel edits building width and row spacing in millimetres,
and height contribution on an integer scale where 1000 means 1×. Enter whole
numbers within the displayed ranges, then choose **Apply design**. Validation
and CPU compilation run before the current GPU session is closed. A successful
change returns to the entrance with no building selected; **Restore original**
returns to the V1 original layout, even when the page opened with Wide streets.
Applying the currently active values or restoring an already original city
does not rebuild its GPU session. Restore also resets unapplied input fields.

These controls change authored appearance, not source data. Unsaved custom designs
remain in memory: **Reopen city** retains the applied design, while reload
returns to the URL's preset and inventory/preset navigation discards custom
edits. An inventory link from a custom design opens that inventory's original
layout. The URL is not rewritten or treated as a saved custom document.
**Close GPU session** cancels a pending edit; a cancelled operation cannot
subsequently start a candidate or recovery view.

**Save applied design** stores the last successfully verified design through
RealmForge's document store and revision repository. Unsubmitted form text is
not saved, and Save does not rebuild the GPU scene. **Open saved design** reads
and validates the document, including its captured-source digest, before using
the existing design replacement lifecycle. Opening the current values is a GPU
no-op. Save/Open are manual; a new page still starts from its URL preset and does
not automatically load a document. Restore original changes the preview only.

There is one saved `.proasset` per inventory and source digest under
`/user/projects/realmforge/source-city-<inventory>-<digest>.proasset` in native
browser origin-private storage. The port and browser profile matter: the
development server at one origin does not share its saved designs with another
origin or profile. Browser eviction/clearing can remove local storage. No cloud
sync, account authorization, source refresh or world admission is implied.
Keep the page open during Save. Explicit GPU Close drains an accepted Save;
a pending Open is cancelled before scene replacement. The browser is warned
about navigation during document operations, but forced page/process termination
is not claimed to await JavaScript cleanup.

Run the native browser proof without a persistent preview:

```powershell
python -B tests/virtual-realm/run_source_city_workbench.py
```

The page supplies local first-person walking at 1.70 metres eye height, a
captured-file inspector, renderer diagnostics, and close/reopen controls.
Click or focus the canvas, use WASD to walk, and drag or use arrow keys to look.
Home or **Return to entrance** resets the view. Escape releases controls.
Changing focus, hiding the page or closing the session clears held input.
Click a building, or aim the crosshair and press Enter, to select its captured
file. The selected building glows lime. Choosing a file in the inspector uses the
same selection; clicking empty space or choosing **No building selected** clears
it. A drag beyond four CSS pixels looks around without selecting on release.
The **Captured connections** inspector lists **Imports** and **Imported by**
from the selected file's captured relationships. Blue roads are outgoing imports;
pink roads are incoming imports. **Trace** isolates one connection in pale gold.
**Show all connections** restores the directed view. **Inspect other file**
selects the other endpoint without moving your camera. Empty lists mean no
relationship was captured in this inventory, not that none exists elsewhere.
The **Directory scope** control browses flat directory records derived from the
captured paths. Coral outlines identify that directory's captured descendant
buildings. **Captured members** selects a real file without moving the camera.
Choosing **All captured files** removes parcel highlighting, not file or road
selection. Picking outside a chosen directory follows the new file's immediate
parent; picking while **All captured files** is active keeps that unscoped view.
**Show source labels** controls world-anchored file and district annotations.
It starts enabled and retains its setting across same-page close/reopen; opening
another inventory starts a new page with labels enabled. Labels do not intercept
canvas input. Full paths and captured metadata remain available in the inspector
when a name is shortened or its label is hidden by the visibility rules.
GPU picking, an eagle-eye view and a minimap remain unimplemented. Unavailable
native WebGPU is a visible failure, never a simulated success.

Open **RealmForge recipe build report** for the recipe identity and deterministic
source/output fingerprints. The report describes the original compiled scene;
walking, selecting a building or highlighting a directory does not rewrite it.
It remains available after closing the GPU session. This is an in-memory
diagnostic, not a saved RealmForge document or published asset.

## Flat implementation map

All paths below are relative to `tests/virtual-realm/` unless stated otherwise.

| Component | Responsibility | Explicitly excluded |
| --- | --- | --- |
| `build_source_city_snapshot.py` | Read the literal baseline 36 or optional kernel 40 files; capture byte hashes, size, lines and recognized in-inventory static imports | Recursive discovery, private storage, source-text publication |
| `source-city.snapshot.json` | Historical metadata snapshot with canonical SHA-256 | Live filesystem or runtime authority |
| `source-city-kernel.snapshot.json` | Separate versioned 40-file capture including four kernel sources | A replacement for the baseline or live kernel telemetry |
| `source-city-wide.design.json`, `source-city-kernel-wide.design.json` | Exact flat authored designs, each bound to its corresponding captured snapshot digest | Source membership, editor-save state, executable callbacks or authority |
| `webgpu-os/apps/realmforge/virtual-realm/RealmSourceCityRecipeCompiler.js` (repository-relative) | Own the opt-in deterministic source-city recipe, snapshot validation, scene compilation and diagnostic build report | M1C bake entry, RF-GE6 compiler, storage, publication or runtime activation |
| `webgpu-os/apps/realmforge/virtual-realm/RealmSourceCityDesignDocument.js` (repository-relative) | Strict `design.source-city` resource projection, existing document store and hash validation | Another compiler, runtime entrypoints, baked geometry |
| `webgpu-os/apps/realmforge/virtual-realm/RealmSourceCityDesignSession.js` (repository-relative) | Serialize explicit Save/Open through existing immutable revisions, history and head conflict guards | Autosave, Modeler session emulation, live-world authority |
| `webgpu-os/apps/realmforge/virtual-realm/RealmSourceCityDesignStorage.js` (repository-relative) | Fence genuine borrowed native storage to one exact design asset; drain admitted calls | Global OS initialization, filesystem version duplication, shared-manager shutdown |
| `RealmSourceCityScene.js` | Compatibility re-export of the original named/default compiler API | A second compiler implementation |
| `RealmNativeCityWorkbenchHost.js` | Own a genuine native device and existing kernel GPU services for this page | OS operator identity, live app dependencies, full provider |
| `RealmSourceCityRenderer.js` | Upload real scene buffers, invoke shared drawing code, own and release resources | An alternate admitted M2 presenter startup |
| `RealmSourceCityNavigation.js` | Bound horizontal movement and query real captured building footprints using Engine math | Physics character authority, flight or arbitrary teleport |
| `RealmSourceCityControls.js` | Canvas-scoped keyboard/drag input and focus/visibility cleanup | Global keyboard capture or pointer-lock requirement |
| `RealmSourceCitySelection.js` | Nearest clipped ray/box selection and immutable captured-file identity | GPU pixel readback, source-text access or world mutation |
| `RealmSourceCityRelations.js` | Immutable directed import projections over existing source and road bindings | New dependency discovery, live traffic, traversal permission |
| `RealmSourceCityDirectories.js` | Flat ancestor records, captured descendant totals and existing parcel-edge IDs derived from captured paths | Filesystem discovery, exclusive geographic districts, complete directory sizes |
| `RealmSourceCityWayfinding.js` | Immutable source-label catalog, camera projection, building-box visibility and deterministic decluttering | New source discovery, GPU text-depth or unseen-file markers |
| `RealmSourceCityWayfindingOverlay.js` | Reusable DOM annotations synchronized to submitted camera frames, visibility control and cleanup | Extra GPU resources, independent frame loop, source-text disclosure |
| `source-city-workbench.main.js` | Coordinate source loading, design editing, manual Save/Open, startup, verification and shutdown | Private source text, account authorization or external cities |
| `source-city-workbench.html` | Present the actual canvas and provenance inspector | Mock screenshots or simulated GPU status |
| `run_source_city_workbench.py` | Exact-route server and native integration evidence | Broad repository serving or an OS boot |

The production reuse point is `REALM_STATIC_GPU_DRAW_KERNEL` in
`webgpu-os/apps/the-virtual-realm/rendering/RealmStaticGpuPresenter.js`. Its five
operations create pipelines, create targets, release targets, encode passes and
produce camera-uniform bytes using existing Engine camera math.
They do not acquire devices, admit sources, issue authority, finish encoders, or
submit commands. The original presenter delegates to the same implementations.

The extraction preserves all original default descriptors and shaders. Only an
explicit `writableCamera === true` argument enables `COPY_DST` on the existing
camera uniform. The production static presenter omits it and keeps its original
mapped, uniform-only camera. A reverse-extraction source proof reconstructs the
original presenter, including its
unchanged admission, currentness, frame submission, status and cleanup logic.
No new presenter mode, app dependency, host binding version or production boot
registration was introduced.

### Opt-in RealmForge recipe ownership

`webgpu-os/apps/realmforge/virtual-realm/RealmSourceCityRecipeCompiler.js` owns
the actual source-city compiler. The workbench imports it directly. The old
`tests/virtual-realm/RealmSourceCityScene.js` exports the same compiler function
as its named and default exports, so existing callers retain their API and
scene shape. This is an opt-in authoring peer, not a second geometry generator.
No normal RealmForge, OS, bake or Genesis entry imports it automatically.

The frozen `REALM_SOURCE_CITY_RECIPE` descriptor identifies
`realmforge.source-city.neon@1`, the two existing inventory IDs, unchanged
40-file/512-relation/4,096-packet ceilings and the exact input/output kinds.
It fixes `runtimeActivation: false` and `publication: false`. It exposes no
editable parameters, callbacks, storage handle or renderer. Its digest identifies
the descriptor content, not the implementation source or an authenticated issuer.

`compileRealmSourceCityRecipe(capturedSnapshot)` compiles once using the existing
validator and recipe. It returns a frozen `{ scene, report }`. The `scene` keeps
the original workbench shape and defensive buffer-copy operation. The report is
plain immutable data: recipe ID and descriptor digest, captured snapshot digest,
all scene metadata hashed without the `copyBytes` function, counts and upload
size, and four ordered raw-byte SHA-256 records. Those records cover
`primitive-vertex`, `primitive-index`, `instance` and `material`. A final
`reportDigest` hashes the report payload without that digest field. Canonical
JSON uses the existing source-city sorted-key encoding; buffers use raw bytes.

```javascript
import { compileRealmSourceCityRecipe } from
  '/webgpu-os/apps/realmforge/virtual-realm/RealmSourceCityRecipeCompiler.js';

const { scene, report } = await compileRealmSourceCityRecipe(capturedSnapshot);
const originalInstances = scene.copyBytes('instance');
console.info(report.recipeId, report.reportDigest, originalInstances.byteLength);
```

The hashes support reproducibility and comparison, not source authentication,
currentness, GPU completion, permissions or admission. The report binds original
recipe output, not transient camera state or selection/trace/parcel material
changes. The workbench's existing renderer still performs all native work and
owns its resources. Recipe compilation performs no GPU, filesystem, network,
storage, clock, random, registry or publication operation.

The existing `BlueprintSchemas` and `RecipeValidator` validate legacy authoring
structure but do not certify captured-source identity or complete geometry.
`ProAssetWriter` writes a timestamped storage folder; it is not used here.
`RealmForgeBakeEntry` requires its accepted audience inputs and reviewed kits;
this snapshot cannot substitute for them. RF-GE6's projection compiler remains
planned. This handoff changes recipe ownership without claiming those separate
gate outcomes. (Sources: the compiler above;
`webgpu-os/apps/realmforge/blueprint/BlueprintSchemas.js`, `RecipeValidator.js`
and `ProAssetFormat.js`; `webgpu-os/apps/realmforge/virtual-realm/RealmForgeBakeEntry.js`;
[RF-GE6 blueprint](../rf-ge6-projection-world-kits.md).)

## Data-to-world recipe

### Versioned authored city designs

The opt-in compiler's `createRealmSourceCityDesignV1(input)` validates a complete
flat seven-field record: `kind`, `schemaVersion`, `recipeId`,
`sourceSnapshotDigest` and the three integer design parameters. Its kind is
`realmforge-source-city-design-v1`, schema version is 1 and recipe ID is
`realmforge.source-city.neon@2`. Own data properties are copied and frozen;
missing/extra fields, accessors, non-plain prototypes, coercible strings,
fractions, non-finite numbers and values outside the bounds are rejected.
Null-prototype records are accepted and copied into ordinary immutable records.

| Parameter | Inclusive bounds | Original default | Wide streets |
| --- | --- | --- | --- |
| `buildingWidthMillimetres` | 4,000–7,000 | 5,400 | 6,400 |
| `rowSpacingMillimetres` | 12,000–20,000 | 14,000 | 18,000 |
| `heightScalePermille` | 500–1,500 | 1,000 | 1,200 |

`compileRealmSourceCityRecipeV2(capturedSnapshot, design)` detaches the design
before its first asynchronous operation. It validates the existing source
snapshot and rejects a different `sourceSnapshotDigest` before generating
geometry. Both compiler versions use one geometry generator and one report
builder. V1 retains its descriptor, report and scene shape. V2 with the original
defaults produces exactly the same scene metadata and upload bytes as V1.
The separately versioned V2 report additionally includes `designDocument` and
`designDocumentDigest`; its final digest binds those fields as well.

Building width is the millimetre value divided by 1,000. Row centres are
`7 + rowIndex * (rowSpacingMillimetres / 1000)` metres; ground, grid and entrance
strips extend with the same spacing. Height is float32-rounded
`2 + min(24, sqrt(lineCount) * 0.45 * (heightScalePermille / 1000))` metres.
The scale affects only the line-count contribution, preserving the 2–26 m height
range. Roads attach 0.5 m ahead of the chosen building front face, using
`width / 2 + 0.5` instead of a fixed offset. They still represent only actual
captured imports. Parcel edges derive from the new footprints.

The largest width leaves separated building and parcel footprints at the
smallest spacing. The unchanged height cap bounds the worst-case valid scene
at 3,384 packets for 40 files and 512 three-segment imports, below the existing
4,096-packet limit. Numeric object IDs remain scene-local and can change when
floor bands or grid counts change. Source paths, content hashes and relation
identities remain the stable references. Existing navigation, picking, directory,
relation and label models consume the newly compiled geometry without a second
implementation.

```javascript
import { createRealmSourceCityDesignV1, compileRealmSourceCityRecipeV2,
  REALM_SOURCE_CITY_DESIGN_DEFAULTS } from
  '/webgpu-os/apps/realmforge/virtual-realm/RealmSourceCityRecipeCompiler.js';

const design = createRealmSourceCityDesignV1({
  kind: 'realmforge-source-city-design-v1',
  schemaVersion: 1,
  recipeId: 'realmforge.source-city.neon@2',
  sourceSnapshotDigest: capturedSnapshot.snapshotDigest,
  ...REALM_SOURCE_CITY_DESIGN_DEFAULTS,
  rowSpacingMillimetres: 18000,
});
const { scene, report } = await compileRealmSourceCityRecipeV2(capturedSnapshot, design);
console.info(report.designDocumentDigest, scene.drawPacketCount);
```

The preview loads one of two fixed JSON design files only when **Wide streets**
is selected. Refreshing a source capture does not silently retarget a design:
its source binding must be deliberately updated after review. This record is the
payload used by the separate `design.source-city` document adapter. The raw
record itself is not a `.proasset` envelope, M1C admission or RF-GE6 completion.
The compiler still adds no storage, live feed, publication or normal OS entry. Sources:
`RealmSourceCityRecipeCompiler.js`, `source-city-workbench.main.js` and the two
literal design JSON files in the implementation map.

### In-memory design editor lifecycle

The editor in `source-city-workbench.main.js` retains only the already fetched
capture and reuses `createRealmSourceCityDesignV1` and the existing V1/V2 recipe
compilers. It does not fetch a new inventory when a field changes. Input is
validated synchronously, then a detached draft is compiled and the pure
navigation, picking, relation and directory consumers are checked before the
old renderer is retired. Invalid input or a compilation failure leaves the
current scene/report and native resources intact. Unchanged effective parameters
are a no-op, including the original defaults under V1.

One edit operation owns the transition. It awaits the existing renderer and
host cleanup, installs the candidate scene/report/indexes, resets selection and
camera, and starts the existing renderer. File/directory options retain the
same source paths; their geometry projections and labels are rebuilt. Native
completion must pass before the edit revision advances. Each edit records its
phase, result or error in scalar diagnostics. Successful edits log their elapsed
duration.

Public `close()` cancels the edit ticket before delegating to `closeSession()`.
Every asynchronous edit boundary checks that ticket. After a late cancellation,
successful cleanup restores the prior CPU scene and inspection models without
opening a renderer; Reopen therefore uses the last accepted design. Internal replacement and
startup-failure cleanup use `closeSession()` without pretending to be a user
cancellation. A failed candidate startup can reopen the prior compiled design
only after successful cleanup and another current-ticket check. Cleanup failure
or explicit Close prevents automatic recovery; failure remains visible rather
than being reported as an applied design. A separate current-session check in
`verify()` prevents an older verification from restarting a replaced host.
These are workbench lifecycle rules, not new engine or runtime authority.

### Captured inputs and original mapping

The baseline inventory spans selected Engine, Virtual Realm rendering and
Virtual Realm runtime files. It contains 36 files and 49 recognized static import
relations. The optional kernel profile adds four named kernel files, retaining
49 recognized imports. Relationships are limited to imports whose two endpoints are both in
the literal inventory. Dynamic imports, re-exports, external dependencies, IPC
and networking are not represented as captured roads.

Each source record retains its repository path, SHA-256 of raw bytes, byte count,
line count and district. No source text, absolute user path or private file is
included. Capture time is explicit. The browser validates the snapshot digest
and relation identities before producing geometry.

| Visual element | Meaning | Origin |
| --- | --- | --- |
| One building per captured file | Real file identity, hash, size and line count | Captured metadata |
| Building height | Original: `2 + min(24, sqrt(lineCount) * 0.45)` metres; V2 scales the contribution before the cap | Authored mapping of captured line count |
| Cyan, violet, amber districts | Engine, rendering, runtime | Declared path classification |
| Rose kernel district in the 40-file profile | Four selected kernel source files | Explicit literal path classification, not active services |
| Mint road segments | Recognized static import from one captured file to another | Captured relationship with authored routing |
| Blue outgoing, pink incoming, pale-gold focused road | Selected captured dependency and direction | Inspector state, not traffic or execution |
| Coral parcel outlines | Captured files below the selected directory path | Derived membership with authored per-file outlines |
| World-anchored names and district signs | Captured basenames, line counts and district membership | Captured metadata with authored sign positions |
| Ground, grid, boulevard trim, outlines and floor bands | Visual composition and orientation | Authored scenery, not system objects |

The original-layout baseline's 1,117 draw packets include buildings, relation segments and scenery. They are
not 1,117 files or runtime entities. The directory slice appends 144 parcel edges
after the original 973 packets, retaining every original building and road ID.
Each packet has a distinct object identity and
a binding classified as `source-file`, `captured-import`, or `authored-scenery`.
The inspector reads the selected source record. Selection is a CPU geometry
query against the rendered boxes; it does not claim a GPU pixel pick.

The scene reuses `REALM_STATIC_UNIT_CUBE_TEMPLATE`, existing draw-packet instance
and material packers, and the existing sRGB-to-linear conversion. Upload buffers
are deterministic and returned by defensive copy. Scene records are frozen.

Refresh the bounded historical snapshot explicitly:

```powershell
python -B tests/virtual-realm/build_source_city_snapshot.py
python -B tests/virtual-realm/build_source_city_snapshot.py --check
python -B tests/virtual-realm/build_source_city_snapshot.py --profile kernel --check
```

To explicitly refresh only the separate kernel capture, run the same command
with `--profile kernel` and without `--check`. The default still writes only
the baseline. Refreshing either capture changes historical provenance and is
not an automatic filesystem watcher.

The capture tool reads only its literal inventory and the existing bundler
parser. It neither discovers directories nor follows dependency edges to expand
the capture. First Shard is excluded.

### Optional versioned kernel inventory

The separate inventory identity is
`virtual-realm-rendering-runtime-engine-kernel-40-v2`; its metadata wire remains
`realm-source-city-snapshot-v1`, schema version 1. The four additional literal
sources are `webgpu-os/kernel/GpuDeviceBroker.js`, `GpuFrameCoordinator.js`,
`GpuRuntimeCoordinator.js` and `SurfaceManager.js` in that same directory.
The browser accepts only those four kernel paths and the exact 40-path membership
pin for this profile. The capture tool owns the literal catalog. These checks
validate the reviewed shape; hashes do not provide external authentication or
prove that a historical capture is current.

These files' recognized static imports target sources outside this bounded
inventory. Their inspectors therefore show zero captured incoming/outgoing
imports; no kernel road is inferred from a service name or runtime relationship.
The native host already uses these services, but the new buildings represent
their captured source files, not running devices, queues, surfaces or frames.

In the original layout, the kernel buildings extend the main street at Z = 133 metres. Existing baseline
building positions and dimensions stay unchanged in the expanded profile.
The floor and grid extend, so object IDs are profile-local; cross-profile ID
equivalence is not promised. Kernel body/trim materials append at indices 14/15
only for this profile. Existing selection, trace and directory slots remain
unchanged. The same 40-file, 512-relation and 4,096-packet limits apply; no capacity
or production capability is widened. The wide design moves that kernel row to
Z = 169 metres without changing source membership. Source: `RealmSourceCityScene.js`,
`build_source_city_snapshot.py` and `source-city-workbench.main.js`.

## Native rendering and lifecycle

The developer host composes the existing `GpuRuntimeCoordinator`,
`GpuDeviceBroker`, `GpuPresentationCapabilityAdmission`, `SurfaceManager`,
`GpuFrameCoordinator`, `VRAMTracker` and Realm syscall adapter. The device,
capability probes, surface, queue submissions and completion observations are
native. The page does not manufacture a capability receipt or replace a native
GPU method.

Rendering uses the existing geometry, identity and ACES presentation passes,
including the pinned renderer formats and four-sample geometry targets. Normal
teardown releases 15 destroyable buffers/textures before closing the dedicated
host device. Pipelines, layouts, bind groups and shaders have no native destroy
operation; references are retired with the page session.

### First-person navigation and camera updates

`RealmSourceCityNavigation.js` owns a DOM-free inspection pose. It reuses Engine
`quatFromEuler`, `quatForward`, `quatRight`, `clamp`,
`sceneQueryAabbOverlapReport` and `sceneQuerySweptAabbReport`. The initial yaw is
pi radians, matching the original entrance view toward positive Z.

Walking is 4 metres per second, normalized across diagonal input. A simulation
step admits at most 0.05 seconds, so a stalled/background tab does not accumulate
a jump. Pitch is limited to ±1.45 radians and one look delta to ±0.35 radians.
Eye height stays fixed; looking up does not enable flight.

A conservative 0.7-metre-wide axis-aligned body uses the actual captured building
boxes, with 0.002-metre clearance. X-then-Z sweeps permit wall sliding. Ground
bounds keep the entire body within the authored floor. These are local geometric
inspection constraints, not a PhysX character, general collision simulation,
network travel permission, or live Realm traversal authority.

The existing `GpuFrameCoordinator` before-frame hook advances input before
continuous GPU work. Changed poses use the existing camera byte encoder and one
64-byte `scheduleTransfer` into the same camera buffer. No target, building buffer
or pipeline is recreated for movement. The transfer callback is synchronous;
its returned completion promise is retained, observed and drained before teardown.
At most one camera operation is pending. Intermediate poses can be coalesced;
the next frame submits the latest pose after completion.

Resize creates new targets using the current observer, not the original entrance
pose. `cameraRevision`, `cameraUploadCount` and `targetGeneration` are diagnostics
for the actual workbench; a queued upload is not itself proof of GPU completion.
Verification stops frame admission, clears held input, waits pending camera work
and then waits native completion before inspecting errors.

### Source-building selection and GPU highlight

`RealmSourceCitySelection.js` owns one nullable captured-file selection.
`selectPath`, `pick` and `snapshot` return immutable selection diagnostics.
File paths, object IDs and content hashes are matched to the existing
`source-file` bindings. Selecting a file never grants access to its contents.
Choosing the same file does not create a new selection revision.

Pointer positions are scaled from the canvas CSS bounds into the current render
target dimensions. The ray uses the renderer's uploaded camera pose, existing
`computeViewProjMatrix`, matrix inverse and vector transformation, and WebGPU
near/far clip coordinates 0 and 1. A zero-size swept AABB reuses the Engine's
parallel-safe intersection query. The nearest intersected building wins.
Box dimensions and centres match the float32 instance transforms. Roads, ground
and the small part of decorative trim outside the body are not selectable.
This is not an exact per-pixel object-ID readback or a general scene picker.

The scene compiles one additional lime material. `updateSelection` resolves the
existing object binding to its draw command and exported instance packing
layout. One scheduled transfer restores the old building's original four-byte
material index and assigns the new building's highlight material. It does not
change object IDs, disclosure flags, building transforms, draw counts, pipelines or
render targets. Highlighting allocates no additional native GPU resource.

The before-frame callback retries the latest desired selection after any pending
transfer, so rapid changes are coalesced rather than lost. Verification drains
pending selection work and uploads the current selection before observing native
completion. Close drains selection work before resource release. Resizing keeps
the selected instance; reopening starts with no selection. After closing, the
inspector remains usable as metadata only, with no further GPU uploads.

### Captured import tracing

`RealmSourceCityRelations.js` exposes a frozen `project(path, relationId)`
operation. It validates original source identities, actual relation endpoints,
unique object IDs and the complete two- or three-segment road bindings produced
by the scene recipe. It returns the original immutable outgoing and incoming
records plus highlighted relation IDs, directions and existing road object IDs.
A focused relation must touch the selected file. Empty selection clears all
traces. The model does not fetch, discover dependencies or mutate the scene.

The inspector prints each captured `fromPath`, `toPath` and import specifier.
Direction is available as text as well as colour. Inspecting another endpoint
clears the old focused relation but leaves the first-person pose unchanged.
The relationship list preserves its scroll position while focusing a road;
switching files resets it. These controls remain local metadata operations.

The renderer reuses `updateSelection(path, relationId)` and its existing pending
transfer lifecycle. It restores old road material and Y-translation bytes from
the original scene, then overlays the desired trace. Directed traces are raised
0.2 metres; an isolated trace is raised 0.3 metres. These offsets are authored
visibility aids, not captured elevations or network activity. Multiple directed
roads can overlap; focusing one isolates its highlighted segments.

All edits are assembled in one bounded CPU copy of the original instance image
and uploaded with one `writeBuffer` operation to the existing instance buffer.
This stays within the port's unchanged 16-operation transfer limit even when
many roads change together. No additional native handle, draw packet, pipeline,
render target or frame loop is created. Only the material-index and road
Y-translation values differ from the original image; clearing restores both.
The upload is skipped only when both selected path and focused relation match.
Resize keeps the trace; reopening starts with no selection or focused relation.

### Captured-directory parcels

`RealmSourceCityDirectories.js` derives 14 flat ancestor records from the same
36 captured paths; eight directories directly contain captured files. Each
record has `path`, `parentPath`, direct and descendant file-path arrays, captured
byte length and captured line count. Children are linked by paths, not nested
managers. An ancestor total includes each captured descendant once. Totals do
not include uncaptured files, filesystem allocation, mounts or live changes.

`project(path)` returns the directory, parent, immediate children, original
immutable captured file records and exact parcel-edge object IDs. `project(null)`
returns all captured files and top-level directory records, with no highlighted
parcels. It does not fabricate a captured filesystem-root record. Unknown paths
and incomplete or mismatched parcel/source bindings reject.

Each building has four authored ground edges around its existing footprint.
Grouping uses path-segment ancestry, not a name-prefix match. It does not move
buildings or create a bounding rectangle around a whole directory: the current
street rows can interleave folders, so such a rectangle could enclose unrelated
files. Parcel outlines neither block walking nor become file pick targets.

The directory inspector supplies parent/child navigation, captured totals and
member selection. Choosing a directory keeps a selected descendant and its
focused road; choosing an unrelated directory clears both. An ordinary file
selection outside an explicit directory changes the scope to that file's parent.
The unscoped All view stays unscoped. These operations never move the camera,
hide buildings, read more source files or grant file access.

The renderer extends the same `updateSelection` operation with a third nullable
directory path. A directory-only change rebuilds the same bounded CPU instance
image with all three desired overlays: selected building, traced roads and
directory edges. Old parcel material bytes restore from the immutable original.
No-op detection includes all three keys. A single existing GPU upload commits
the result, with no extra native handles. Resize retains the directory; reopen
clears it. The diagnostic parcel count counts edges, not files.

Startup success requires an actual submitted frame, completed native queue work
and zero retained native errors. The page then monitors host and renderer health
at a bounded interval. A later failure stops rendering and changes visible
status; initial verification is not a perpetual guarantee.

Close stops frame admission, settles a pending first-frame wait, drains startup
so late results cannot escape shutdown, retires controls and the producer, drains
pending camera and selection transfers, observes pending
GPU work, releases resources inside the real broker job, releases the surface
and subscription, retires the receipt, and closes the dedicated host. It retains
cleanup failures. Device loss can prevent proof of individual native resource
destruction; abandonment is never labelled successful per-resource release.

The developer global exposes only `ready`, `snapshot`, `verify`, `close` and
`restart`. Their diagnostic results contain no device, queue, service or source-
access capability. This is not a claim of isolation from hostile same-origin
scripts.

### World-anchored source wayfinding

`RealmSourceCityWayfinding.js` builds one file label per captured source plus one
sign per populated district: 39 catalog records for the baseline and 44 for the
kernel inventory. It reuses the existing source-selection validator, Engine
camera matrices, vector mathematics and swept-AABB query. It neither reads more
files nor modifies scene packets, materials or GPU buffers.

File anchors sit within their actual building bodies at up to 3.3 metres height;
district signs sit above the boulevard four metres before the district's first
row. These are authored sign positions, not captured filesystem coordinates.
File labels show the basename, distance and captured line count. Single-line
district signs show the district name and its captured file count. Long file
names ellipsize; the inspector retains the full source path.

Visibility uses the submitted GPU camera pose and actual render-surface aspect,
then maps coordinates into the CSS viewport. Behind-camera, clipped, offscreen
and distant anchors are removed: file range is 55 metres and district range is
110 metres. An intervening captured building body hides an anchor. A file's own
body is ignored for its interior sign; roads, parcels and decorative trim are
not occluders. This is CPU anchor visibility, not per-glyph GPU depth testing.
The labels are DOM annotations over the genuine GPU scene, not GPU-rendered text.

Eligible selected files take priority, followed by district signs, then other
files, ordered by distance and stable identity. Selection never bypasses clipping,
range or occlusion. Fixed 216-by-38-pixel file panels and 180-by-28-pixel district
panels must fit inside an eight-pixel margin. Overlapping or touching panels are
suppressed; the HUD and crosshair also reserve space. At most eight file panels
and two district panels appear. Hidden annotations do not imply missing files.

The renderer emits a synchronous, frozen observation only after a successful
native frame submission, using that frame's uploaded pose and applied selection.
It does not claim GPU completion or scanout. `RealmSourceCityWayfindingOverlay.js`
caches unchanged camera/layout/selection inputs, reuses its DOM nodes and owns no timer, frame
loop or GPU resource. The native allocation remains 15 owned handles.
Closing or failing the renderer clears labels immediately; reopening replaces
the nodes. An annotation exception disables the observer and clears its display
without stopping native drawing. The checkbox remains a local presentation
setting, not a source-access permission. The visual overlay is `aria-hidden`;
the accessible inspector remains the textual source interface.

## Verification boundary

The native integration runner captures real canvas and page PNGs, checks the
canvas is nonuniform, observes zero native errors, closes the session, reopens it
on the same page, and closes it again. It binds the served bytes and tool sources
before and after the run. Screenshots establish physical rendering; source-data
tests separately establish the recipe and provenance invariants.

The initial fixed-view checkpoint used Chrome 153.0.8010.48 and the NVIDIA GeForce RTX 5070
Laptop GPU with ordinary browser GPU settings. Initial, resized and reopened
scenes rendered. Twenty browser scene tests passed. Early close before the real
snapshot response prevented host creation; resuming the original bytes and then
reopening succeeded. No browser/native errors or denied routes were reported.
All 117 source/tool bindings and 107 served-file hashes matched the final run.

At that fixed-view checkpoint, the focused presenter regressions passed 116/116. The combined
Python run passed 39/39: 22 presenter source/parity proofs, eight snapshot capture
proofs and nine workbench composition/lifecycle proofs. These are bounded results,
not whole-engine or integrated-city certification. Structural cancellation proofs
are not represented as native fault-injection tests.

Historical fixed-view native evidence is retained locally at
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-native-source-city-mk1l5szb/receipt.json`
(SHA-256 `f8ddc7792405a38605b35e11d7fd179e88ea085cc849f0b1145b79a6c3687a81`).
The same directory contains initial, resized and reopened canvas/page PNGs.
Its Python JUnit artifact is
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-city-combined-python-final.xml`
(SHA-256 `31999ab591e0f59a6349ba250e0c40100c3346d6037306e06e8d39d2adfbe813`).

### First-person movement checkpoint

The 2026-09-19 movement run passed all 20 scene cases and 18 navigation cases,
plus native keyboard/mouse walking and looking, focus-loss stopping, entrance
reset, moved-pose resize, close, same-page reopen and early-close checks.
Chrome 153.0.8010.48 used the NVIDIA GeForce RTX 5070 Laptop GPU with ordinary
GPU settings. During movement, 96 camera uploads retained target generation 1
and the same 15 owned handles. Only the deliberate resize created new targets.
The moved image was inspected; screenshots are actual rendered frames.

All 125 before/after source and tool bindings were unchanged and matched the
current files. All 115 served routes matched their corresponding source hashes.
There were zero denied routes, browser errors or native GPU errors. The module
closure is 111 modules. This remains bounded workbench evidence, not full-engine
or live-provider certification.

Native evidence is at
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-native-source-city-_2gaovye/receipt.json`
(SHA-256 `2d09cdf7fc0f39628cacb3aa8b8ac21b8b8666ec2312ad8de7a28f8f48084ecb`).
That directory retains initial, moved, resized and reopened images and the exact
source manifests. The refreshed snapshot was captured at
`2026-09-19T19:55:02.32Z`, with digest
`sha256:8f93ae8ff60d71e10d11bbc71f2d12debe92d85c9dbaf04d6ebb057eb7c64160`.

The existing presenter browser regressions passed 116/116: generation 32,
protected startup 40, terminal cleanup 44. Receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-protected-startup-receipt-hgn16ese.json`
(SHA-256 `acb25e213dd7eeb62404b159f6d7fb74b98686d277eb47a6f4af236333c90ff3`).
The combined Python proof run passed 43/43: presenter 24, snapshot capture 8,
workbench composition/lifecycle 11. JUnit:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-movement-combined-python.xml`
(SHA-256 `9eaf2ab14ab8c05b5b75f0f59caa28221a5aaca22374098bbab206ff0a1ef41c`).
Structural lifecycle proofs are not claimed as native fault-injection coverage.

### Source-building selection checkpoint

The subsequent 2026-09-19 selection run passed 56/56 browser cases: scene 20,
navigation 18 and selection 18. Native interaction checks also passed: projected
facade clicks, repeat-selection no-op, drag without selection, sky clear,
crosshair/Enter selection, dropdown selection and rapid-key convergence, selection
retained on resize, selection cleared on reopen, clean close and early close.
Rapid inputs establish final-state convergence; they do not deliberately force
an overlapping pending transfer.

The native screenshot test measures a 16-by-16-pixel facade interior, excluding
HTML and HUD text. Selection changed all 256 pixels by at least eight channel
levels. After clearing, none differed from the original by that threshold.
Selection retained the same 15 handles and target generation 1. The selected
building's file path, content SHA and object ID matched the inspector.

Final native evidence:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-native-source-city-338v76hw/receipt.json`
(SHA-256 `c216f220c2df2408205965aeb7c4408b37627175bedbdd2cf8e9d67a35a828aa`).
The directory contains selected and cleared screenshots plus source manifests.
Chrome 153.0.8010.48 used the NVIDIA GeForce RTX 5070 Laptop GPU. The exact closure
is 114 modules; all 129 before/after/current source bindings and 119 served-route
hashes matched, with zero denied routes, browser errors or native GPU errors.

Combined Python checks passed 49/49: presenter 24, capture 8 and workbench 17.
JUnit: `C:/Users/btspa/AppData/Local/Temp/virtual-realm-selection-combined-python.xml`
(SHA-256 `c4d75be894055b4f744f2f23f6a6d6a871726bb82d77c593e841d1e11c81fe9e`).
Production presenter bytes and the historical source snapshot remained unchanged;
the earlier presenter browser checkpoint above was not re-run for this standalone
workbench slice. A preliminary exact-silhouette test expectation was corrected:
matrix rounding does not preserve an exact box-face ray. The final test checks
the Engine query on the exact slab and model rays one millimetre inside/outside,
without widening the picker or changing runtime code.

### Captured import tracing checkpoint

The 2026-09-20 run passed 74/74 browser cases: scene 20, navigation 18,
selection 18 and relations 18. Native controls verified outgoing/incoming lists,
captured endpoint/specifier identity, focus, repeated-focus no-op, Show all,
Inspect other file without camera movement, clearing, focused resize, clean
reopen, teardown and early close. The highest-degree captured file has ten
incident relationships and 27 road segments. Selecting it, switching to a
disjoint incident set and clearing all passed without changing the 15-handle
allocation or camera pose.

A 48-by-24-pixel road-only region changed 192 of 1,152 pixels when directed
traces appeared and 288 when one connection was focused, using a threshold of
eight channel levels. Show all restored the directed-view baseline; clearing
restored the original road baseline, with zero pixels exceeding that threshold.
These checks do not claim visibility of every overlapping road.

Final native receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-native-source-city-ersfhxgo/receipt.json`
(SHA-256 `e1b8bdcb04f74f755467d0f3326193d0c8f8a6bb5e6b92870395fa55cc589c7a`).
Chrome 153.0.8010.48 used the NVIDIA GeForce RTX 5070 Laptop GPU. The exact
closure has 117 modules. All 133 before/after/current source bindings and 123
served hashes matched. No browser/native errors or denied routes were reported.
Actual focused-road and page PNGs are retained with the receipt.

Combined Python verification passed 54/54: presenter 24, capture 8, workbench 22.
JUnit: `C:/Users/btspa/AppData/Local/Temp/virtual-realm-relations-combined-python-final.xml`
(SHA-256 `9ea7ba9bb7ae6953aa8ae8b6b3fc1875eca768829d4a0e66d5ceccd915c36b64`).
The presenter and historical snapshot stayed byte-identical. Snapshot `--check`
passed without recapture. The earlier presenter browser suite was not rerun.

The native run exposed a real integration failure before acceptance: separate
four-byte road writes exceeded the existing transfer port's 16-operation limit.
Two failed receipts remain in `virtual-realm-native-source-city-blicky8a` and
`virtual-realm-native-source-city-15s2eta0` under the same local Temp directory.
The fix assembles one complete immutable instance image and performs one native
write, rather than widening the port budget. The largest captured incident set
would previously require 55 individual writes. The scene's maximum 4,096
128-byte instances cap this image at 512 KiB, below the unchanged 16 MiB limit.
New structural and native regression cases retain this boundary.

### Captured-directory parcel checkpoint

The subsequent 2026-09-20 directory run passed 95/95 browser cases: scene 21,
navigation 18, selection 18, relations 18 and directories 20. The original
snapshot still contains 36 files and 49 imports. Derivation produces 14 flat
directory records and eight direct-file groups; the scene has 1,117 packets,
including 144 appended parcel edges.

Native controls verified exact captured membership and totals, parent links,
member selection, compatible-ancestor retention of file and road focus,
incompatible-directory clearing, actual facade selection outside the scope,
All preserving file/road selection, and file clearing that retains an explicit
directory. Camera pose and the 15 native handles stayed unchanged through these
operations. Resize retained the directory and focused road; reopening reset both.
The prior movement, selection, tracing, teardown and early-close checks passed.

A 48-by-20-pixel parcel-edge region changed 96 of 960 pixels by at least eight
channel levels when the math directory's three files were outlined. Choosing
All restored the original region with zero changed pixels at that threshold.
The actual screenshot was inspected. Math has 12 highlighted edges, Engine 40
and the captured runtime directory 52; these are edges, not extra source files.

Native receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-native-source-city-y1e8x7jl/receipt.json`
(SHA-256 `1415396cc262663593f20853a9fba9e26b8ecb2a4bc1946718084c34c54f7d9f`).
Chrome 153.0.8010.48 used the NVIDIA GeForce RTX 5070 Laptop GPU. All 137
before/after/current source bindings and 127 served hashes matched; the exact
closure contains 120 modules. No browser/native errors or denied routes occurred.
No runtime correction was required after the first directory native run.

Combined Python checks passed 58/58: presenter 24, capture 8 and workbench 26.
JUnit: `C:/Users/btspa/AppData/Local/Temp/virtual-realm-directories-combined-python-final.xml`
(SHA-256 `499fa0a3091124d72c19468a52c41e77786a35051fe7ab5bc23a7ba24b395abb`).
The source snapshot, production presenter and native host stayed unchanged.
Snapshot `--check` passed without recapture. These are standalone-workbench
results, not full-provider or whole-engine certification.

Browser scene cases live at `source-city-scene.test.html`; movement-model cases
live at `source-city-navigation.test.html`; selection-model cases live at
`source-city-selection.test.html`; directed relationship cases live at
`source-city-relations.test.html`; directory-model cases live at
`source-city-directories.test.html`; the separate inventory gate is
`source-city-kernel.test.html`; world-anchor cases are in
`source-city-wayfinding.test.html`; compiler-handoff and output-report cases
are in `source-city-recipe.test.html`; authored-input, parameter-corner and
default-preservation cases are in `source-city-design.test.html`. Capture tests are in
`test_source_city_snapshot.py` and `test_source_city_kernel_snapshot.py`.
Existing presenter regression commands remain:

```powershell
python -B tests/virtual-realm/run_protected_startup_browser.py generation protected terminal
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'
python -B -m pytest --noconftest -p no:cacheprovider -q tests/virtual-realm/test_m2db4h_gpu_presenter_generation_source.py tests/virtual-realm/test_source_city_snapshot.py tests/virtual-realm/test_source_city_kernel_snapshot.py tests/virtual-realm/test_source_city_workbench.py
```

### Versioned kernel-source checkpoint

The 2026-09-20 kernel profile captures 40 files and 49 imports. Its scene has
1,259 draw packets, 16 materials and 160 parcel edges. The flat directory model
has 15 records; `webgpu-os/kernel` contains exactly four captured files, 267,324
bytes and 5,747 lines, with 16 parcel edges. These totals describe the capture,
not the complete kernel directory or current running system.

The kernel capture timestamp is `2026-09-20T12:58:52.166Z`; its canonical digest
is `sha256:4422cd6f939537a8f0bc1318bef8fcc3d50750c3c90e8fc35d430eb0a000136d`.
Its raw JSON SHA-256 is
`917456895214bbd3e6e6d61c1ae1093910805b8681bd504515ea6bd86b7f197a`.
The baseline JSON remains byte-identical. The new browser gate also compares
all four compiled baseline buffers against independent pre-change Web Crypto
hashes, not hashes produced by the modified compiler to define expectations.
Those pins preserve the original unit primitive, instance image and palette.

All 115 browser model cases passed: scene 21, navigation 18, selection 18,
relations 18, directories 20 and kernel inventory 20. Combined Python checks
passed 74/74: presenter 24, baseline capture 8, kernel capture 12 and workbench
composition/lifecycle 30. Final combined JUnit:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-kernel-combined-python-final.xml`
(SHA-256 `399c31394a92ba969dd275fef67cdeca101155becaf3c3582cbef6f294781802`).
Source capture checks passed for both profiles without rewriting the baseline.
The production presenter and native host remain unchanged.

The final native run also passed the complete existing city interactions and
early-close checks. Real W input moved from Z = -12 to 114.0844 metres in
31.515 seconds without replacing the camera pose. Kernel selection changed all
256 facade-region pixels by at least eight channel levels; clearing restored
all of them. Kernel parcel highlighting changed 48 of 960 region pixels;
clearing restored all of them. All four captured kernel members displayed their
real metadata and zero captured incident imports. Movement and selection kept
the same 15 native resources; resize, close and reopen passed.

Both ordinary inventory links produced a genuinely closed old-session snapshot
before the new document committed: observed event 7 preceded commit event 16.
The read-only observer did not wrap or replace the app's API. Each closed
snapshot showed all 15 resources released. The invalid-profile test rejected
before any snapshot request or host construction. These are bounded workbench
results, not a frame-rate target, full-provider or whole-engine certification.

Final native receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-native-source-city-wwjgj8kh/receipt.json`
(SHA-256 `db72e1d482196835fb016889d50cafed5fd2eaf778dcb13f079560584d0e18df`).
The same directory contains `kernel-building-selected-page.png` and the actual
canvas highlight/restore PNGs. The exact closure has 122 modules. All 141
before/after/current source bindings and 133 preloaded route hashes matched,
including two literal document-query aliases. There were no browser/native
errors or denied requests. Root independently rechecked the bindings and
inspected the kernel screenshot.

Three earlier failed integration receipts remain in local Temp directories
`virtual-realm-native-source-city-4ikt_gc7` (new test-harness mismatch and missing
query route), `virtual-realm-native-source-city-hhn_mqfg` (paused-navigation
instrumentation) and `virtual-realm-native-source-city-vfavdjhg` (a fixed-duration
keyboard check under concurrent GPU load). Corrections were confined to tests
and the preview server. Profile cleanup now uses ordinary navigation and event
ordering; input checks wait for the same movement thresholds within ten seconds.
No runtime threshold, production service or resource budget was weakened.

### World-anchored wayfinding checkpoint

The 2026-09-20 wayfinding run passed 135/135 browser cases: the previous 115
plus 20 source-label cases exercised against both genuine inventories. Combined
Python checks passed 79/79, plus seven subtests: presenter 24, baseline capture
eight, kernel capture 12 and workbench composition/lifecycle 35.
Both capture `--check` commands passed without rewriting either snapshot.
Scene buffers, the production presenter and the native host remain unchanged.

The native run independently derived source anchors and projected them with the
existing Engine camera matrix. It checked actual DOM bounds, names/counts,
clipping, distance, non-overlap, HUD exclusion, selected styling and click-through
to real buildings. Actual keyboard/mouse movement, resize, cached static frames,
the label toggle, close and reopen passed. Both enabled and disabled preferences
survived same-page reopen. The kernel walk covered 126.0844 metres in 31.531
seconds using real W input, without a substituted camera pose. The same 15 owned
native resources remained. These results do not establish a frame-rate target.

Existing GPU pixel-change proofs run with labels disabled, so DOM annotations
cannot masquerade as GPU highlight changes. Kernel facade selection changed
256/256 measured pixels and clearing restored them; parcel highlighting changed
48/960 and restored them. Native errors, browser errors and denied requests were
all zero. Root inspected the final kernel label screenshot for readable text,
selected styling and panel fit.

Final native receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-native-source-city-0fkm5el2/receipt.json`
(SHA-256 `ae863f8c6248c34be97f2a38921d9c2a454f05d8a258ab88fa476cc94853c7e5`).
The directory retains `baseline-labels-page.png` and
`kernel-label-selected-page.png`. Root independently matched all 146 raw
before/after/current bindings and 138 served-route hashes. The exact closure has
126 modules. Final combined Python JUnit:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-wayfinding-combined-python-final.xml`
(SHA-256 `251d32f53a292dfb7d6be97869866aefd9a3006a93d70a16cdfcd4e48185f737`).

The preliminary receipt in `virtual-realm-native-source-city-7p31gk3o` remains
as failed evidence. Two new test expectations incorrectly assumed a particular
unselected file label must survive district-priority decluttering. The model
test now separates selected-front visibility from selected-back occlusion, with
independent range/viewport checks. At the narrower kernel viewport, the native
test selects the genuine facade first when its unselected label is suppressed,
then physically clicks through the visible selected label. Runtime visibility
rules were not weakened. Review also corrected district-panel text overflow by
making the 28-pixel district signs single-line before the native runs.

### RealmForge recipe handoff checkpoint

The 2026-09-20 handoff passed 151/151 browser cases: scene 21, navigation 18,
selection 18, relations 18, directories 20, kernel 20, wayfinding 20 and recipe
16. The new gate uses both genuine captures and independent pre-move fingerprints
for every scene metadata field and all eight upload-buffer images. Reversing
only the module-path change, new descriptor/report wrapper and digest-helper
factoring reconstructs the original compiler SHA-256 exactly:
`e02a4e461574132b9a0e15227979fab2ebfc3628d995fe5d78ee670321ecf3ba`.
The compatibility module retains exactly its original named/default exports and
their function identity. Invalid inputs retain the original rejection behavior.

The recipe descriptor digest is
`sha256:f8b398869c96a1b3c31c230dee43c9d9fd93d6c3b517b0ba6e789d862b89aa56`.
Baseline scene metadata remains
`sha256:828a1d570224780c9b359c3e6a777b3e8bee3d402acc1f4a94c602227e7576cf`;
kernel metadata remains
`sha256:f27bc929bf86f175bfe1e3aa1e48c9ea60a08d14775a09de935de65e44e16c0f`.
The resulting report digests are
`sha256:cd9eb11b8b206d9aaa6f13e5acdf17f0250880ed20ff8c738af681aff3ea322c`
for baseline and
`sha256:851c4bc2596385957da68d07a090eed6d976ba5e1b31ad7b31ad3086f32eb7e6`
for kernel. These identify diagnostic content, not authenticated authority.

The single final native run passed both city profiles, all prior interactions,
the report disclosure, resize, close/reopen and early close. The runner rebuilt
expected reports independently from source metadata and raw scene bytes, not
from the report factory. Report contents and the DOM JSON stayed unchanged
through transient selection, movement and resource lifetimes. Real W input
covered 126.0004 metres in 31.5 seconds. The same 15 owned native resources were
retained; browser/native errors and denied routes were zero. Both capture checks
passed without recapture. The production presenter and native host are unchanged.

Final native receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-native-source-city-to3mj7a7/receipt.json`
(SHA-256 `ed548f4bc4bc2feeb3e52a6fdc66337c24a389138bd1fdb6eba3784f01bf2095`).
Root independently checked all 150 before/after/current source bindings and 142
served-route hashes. The exact closure has 129 modules and no directory fallback.
The same directory retains `kernel-label-selected-page.png`, visually reviewed
for preserved rendering and source-label legibility.

Combined Python checks passed 83/83 plus seven subtests: presenter 24, baseline
capture eight, kernel capture 12 and workbench 39. JUnit:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-recipe-combined-python-final.xml`
(SHA-256 `063fb3de5dce17a3db1c15a4cd6652bb65f322cc3224486f6f1d2db82a98090e`).
The kernel preview was restarted from the accepted bytes and its visible report
checked in the browser. This is bounded recipe/workbench acceptance, not a whole
OS build, complete RealmForge editor integration or full-provider certification.
Broad documentation/API regeneration is deferred to preserve the explicit
First Shard exclusion; changed files and relative documentation links are checked
directly without scanning that project.

### Authored city design checkpoint

The 2026-09-20 authored-design run passed 167/167 browser cases: the previous
151 plus 16 design cases. The new gate covers exact record validation, copy
before asynchronous work, source-snapshot binding, deterministic reports,
all eight parameter-bound corners against both genuine captures, geometry
clearances, picking/navigation and source-label compatibility. V2 with default
parameters preserves both complete V1 scene metadata records and all eight
upload-buffer images. Reverse extraction also reconstructs the prior V1 compiler
SHA-256 `fc67a97ea937654179fe83b043271b53e18a28065fbe4134c7f8aa5cc5c5b434`.

The real native run loaded Wide streets through ordinary links, selected an
actual facade, moved through the authored scene and switched between both
inventories while preserving the design choice. Each old session was observed
closed, with all 15 resources released, before the new document committed.
An unsupported design rejected before any JSON fetch or host construction.
The existing kernel walk, selection/relations/directories/labels, resize,
close/reopen and early-close proofs also passed. No browser/native errors or
denied routes occurred. Source captures, the production presenter and the native
host remain unchanged. No failed preliminary native run occurred in this slice.

The baseline wide design compiles to 1,230 draw packets and 158,984 upload bytes;
the kernel wide design compiles to 1,385 packets and 178,952 bytes. Their report
digests are respectively
`sha256:3475c8c9a33eda4e64ac174c4bf67f2a9f484e79dfb201fc8fb437f55989c6e0`
and `sha256:d36b6c29cfa9625d9f4f40dbc6a03a90f136037ef1c15fee3f025ed53e63c92b`.
The runner independently reconstructed report digests from the compiled scene
and checked every building body and import-road transform against captured source
records and literal design parameters. Wide streets changed 59,081
of 441,228 measured canvas pixels by at least eight channel levels; selection
changed all 256 facade-region pixels. Restoring Original layout produced zero
changes at that threshold. Separately, root checked that both saved complete
original/restored PNGs have the same raw SHA-256:
`720c3458489f44a768aa4a3e7bfea45fad70d9b16bb65666296813409b3ded71`.

Final native receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-native-source-city-vkobxmu1/receipt.json`
(SHA-256 `a1a89c69473c6a3ac6aacd3f50d5cdb60020f38318482d981e4f683af4c29539`).
Its directory retains `design-wide-page.png`, `design-wide-selected-page.png`
and `design-kernel-wide-page.png`. Root checked all 155 raw
before/after/current source bindings, 150 served-route hashes and 167 individual
case statuses, and visually inspected the native kernel-wide screenshot.
The exact closure contains 131 modules with no directory fallback.

Combined Python checks passed 87/87 plus seven subtests: presenter 24, baseline
capture eight, kernel capture 12 and workbench 43. Final JUnit:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-design-combined-python-final.xml`
(SHA-256 `e3827fc31d39d0b3716dbf8afc8be45ba257eea2e1e2d696303359dc22f9b13f`).
This accepts bounded authored inputs and preset rendering, not an interactive
design editor, saved RealmForge document, live source feed or provider admission.

### In-memory editor checkpoint

The 2026-09-20 editor run passed all 167 existing browser cases and the complete
native city suite with the new editor interactions. Combined Python verification
passed 93/93 plus seven subtests: presenter 24, baseline capture eight, kernel
capture 12 and workbench 49. The six added structural checks cover draft
validation, semantic no-ops, compile-before-close ordering, model replacement,
cancellation/recovery ordering and current-session verification. The V1/V2
compiler, both captures, native host and production presenter remain unchanged.

Native keyboard input and actual Apply/Restore buttons verified blank,
fractional and out-of-range rejection without changing the current report,
selection, camera or native allocation. Original and custom no-op Apply skip
rebuilds. A 6000/16000/900 custom design produces 1,076 packets and 139,272
upload bytes, with report digest
`sha256:1efe9dc8d350a698b89fde26661b80a87226f170a5d4ddcc539e53a94432518c`.
Independently checked body/road transforms, picking, labels, movement and
same-page close/reopen passed. A diagnostic observer saw all 15 previous
resources released before candidate startup. The URL remained unchanged.

Cancellation is a separate API-driven proof: an observer of real diagnostic
phases calls the original public Close method once during `compiling` and once
during `starting`, after the candidate report was installed. No compiler, GPU
method, promise or input handler is replaced. Both cases remain closed, retain
the prior accepted report/revision and reopen that accepted design. In the
startup case, the old renderer had released all 15 resources; the genuine new
host closed before its candidate renderer was allocated. This is not a claim
of physical-click timing coverage or cancellation at every possible startup
instruction. Candidate GPU failure and recovery-failure branches are
source-reviewed and structurally checked, not an injected native-fault matrix.

The custom design changed 40,346 of 441,228 measured canvas pixels by at least
eight channel levels. Root independently verified that original, invalid-draft
and restored-original complete PNGs all have raw SHA-256
`720c3458489f44a768aa4a3e7bfea45fad70d9b16bb65666296813409b3ded71`.
The final native receipt is
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-native-source-city-nqhrvmq1/receipt.json`
(SHA-256 `4fea0f2636c8230d7547cc726d1fec59dac055ddf2f0e24074f5a6a9ddbe7b9e`).
Root checked all 155 before/after/current source bindings, 150 served-route
hashes and 167 individual case statuses, and inspected `editor-custom-page.png`.
The closure remains 131 modules. Browser/native errors and denied routes are zero.
Final Python JUnit:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-editor-combined-python-final.xml`
(SHA-256 `bd9cf6ca700e333dec019849201f1a74bc80bf9a135499d3f7e2131a0630e4a4`).

Two failed test-instrumentation receipts remain in local Temp directories
`virtual-realm-native-source-city-zple46ib` and
`virtual-realm-native-source-city-o0u12e14`. The first sampled Reopen before
native startup verification completed; the second could not reliably catch the
compilation phase using CPU throttling. The final runner waits for genuine
completion and uses observed-phase public-API cancellation with no throttling.
Runtime bytes were unchanged between those runs and the final acceptance run.

## Next city slice and integration boundary

1. Source-backed wayfinding, opt-in RealmForge recipe ownership and versioned
   authored design inputs and in-memory design controls are implemented. The
   preview can apply and restore designs without changing source membership.
   Manual source-bound Save/Open now uses the existing RealmForge document
   infrastructure and the approved
   [saved-design contract](#saved-design-contract-decision). Full Modeler editor
   registration remains separate from this standalone composition;
   do not silently promote a preview report into a published asset or admitted
   bake. Preserve both captured inventories, source identities and the
   metadata-only boundary. Keep network activity,
   IPC roads, SecureMesh stations and remote public shells unavailable until
   their real inputs and disclosure policies exist.
2. Complete the original owner/write/observation and full-provider ledger before
   integrating into the live OS app. Preserve M1C, frozen dependency records,
   lifecycle channels and fail-closed admission.

RealmForge now owns this opt-in development recipe; its editor/document and
admitted world-building integrations remain separate work. This is not a new
competing world engine. Sealed real-code glyphs, multiplayer bridges, published public
shells, local-only operations views and storylets retain their existing later
gates. No fake traffic, code or remote authority is added to make the city appear
more complete.

## Saved-design contract decision

The initial 2026-09-20 review identified the missing document type without
changing runtime code. The user subsequently approved the dedicated resource
family and manual Save/Open implementation. The six-piece sequence records
that approved scope; the implementation uses the separate document, session
and storage modules listed in the flat implementation map. Full Modeler and
runtime-provider integration are not prerequisites for this standalone save path.

### Existing contracts and the missing type

RealmForge already provides the document store and durable revision repository
needed for city designs. Before this slice the `.proasset` v2 resource-family
catalog was closed and contained neither `design` nor `recipe`. The approved
addition supplies `design`; the catalog remains closed. A raw seven-field source-city design is
not a resource envelope. Relabelling it as geometry, an assembly, a graph or a
receipt would give the wrong semantic meaning.

| Existing source | Reuse or constraint |
| --- | --- |
| `webgpu-os/apps/realmforge/document/constants.js` | `PROASSET_V2_RESOURCE_KINDS` retains all prior families and adds `design`. |
| `webgpu-os/apps/realmforge/document/validation/ProAssetV2Validation.js` | Validates envelope fields, type family, canonical resource identity, logical resource path, references and provenance. A source-city-specific decoder must additionally validate the design payload. |
| `webgpu-os/apps/realmforge/document/hash/RealmForgeContentHash.js` | Resource-envelope bytes contribute to resource and document hashes. Root manifest `extensions` do not contribute to semantic `contentHash`, so they must not hold the authoritative design. |
| `webgpu-os/apps/realmforge/document/store/RealmForgeDocumentStore.js` | Reuse transactions, revisions, semantic no-op detection and consistent persistence capture. Do not implement a parallel document/history store. |
| `webgpu-os/apps/realmforge/document/repository/RealmForgeRevisionRepository.js` | Reuse immutable resource/revision writes, verified receipts, head reopening and compare-and-swap publication. Pass both expected head commit ID and content hash. |
| `webgpu-os/apps/realmforge/document/draft/RealmForgeSourceDraftRepository.js` | Recovery generations and their expiry are not permanent saved designs. Do not use this as the canonical city-document repository. |
| `webgpu-os/apps/realmforge/document/persistence/RealmForgePersistenceCoordinator.js` | Includes autosave behavior; omit it from a manual-only first slice rather than accidentally enabling autosave. |
| `webgpu-os/apps/realmforge/document/lifecycle/RealmForgeActiveDocument.js` | Requires real Modeler prepare/activate/close/save and mutation-lease methods. Do not manufacture a session merely to satisfy this interface. Full Modeler integration remains later work. |

The existing `createRealmSourceCityDesignV1` factory in
`webgpu-os/apps/realmforge/virtual-realm/RealmSourceCityRecipeCompiler.js`
continues to own the exact seven-field payload. It must validate both save and
open, and the selected capture's digest must match before compilation. Saving
must not rewrite the capture, read source code or refresh a historical capture.

### Approved additive contract

The catalog adds the family `design`, with resource type `design.source-city`.
The `.proasset` v2 envelope, repository protocol and existing V1/V2
recipe interfaces are unchanged. The resource schema is
`realmforge.source-city.design`; `schemaVersion: "1.0.0"` on that outer envelope is distinct from the inner
design's integer `schemaVersion: 1`. The resource has authored authority,
canonical `rf.design.<uuid>` identity, logical path `design/source-city.json`, empty
references, explicit authoring provenance and the unchanged seven-field record
as `parameters`. All three document entrypoints remain null. There is no
assembly, runtime entrypoint, generated geometry or admitted bake in this asset.

An additive family preserves existing documents and their hashes. Older readers
that retain the older closed catalog reject new design documents; this addition
does not promise that those readers can open the new type. The new family does
not make arbitrary `design.*` payloads executable or admit a world resource.
The city adapter must reject unknown schema/type versions and extra or malformed
payload fields independently of generic envelope validation.

### Approved six-piece implementation sequence

1. **[MODIFY] Shared catalog and compatibility tests.** Add only the approved
   family in `document/constants.js`; verify existing envelope/hash behavior
   and rejection of other unknown families. Freeze the new source-city envelope
   contract in a separate opt-in adapter under the existing RealmForge
   `virtual-realm/` directory. Do not import it into the normal OS entrypoint.
2. **[NEW] Pure document projection.** Reuse the existing design factory,
   document store and canonical IDs. Preserve document/resource identity across
   edits and reopen. Implement exact decode, source binding and semantic no-op
   transactions; never duplicate the city compiler. Default original designs
   can save the equivalent V2 defaults without replacing the current V1 render.
3. **[NEW] Manual persistence composition.** Reuse the revision repository with
   genuine storage, fenced to dedicated source-city asset roots. Load the head
   before allocating a new document identity. Preserve both head expectations;
   a competing writer must cause a conflict, not automatic overwrite. Avoid
   Modeler session emulation, recovery publication, autosave and global OS boot.
4. **[MODIFY] Workbench Save/Open controls.** Save the last successfully applied
   design, not unvalidated form text or an in-flight candidate. Saving does not
   rebuild the GPU scene. Open validates persisted bytes and the current source
   binding, then uses the existing compile/preflight/close/install/boot path.
   Invalid, missing, corrupt or source-mismatched documents preserve the scene.
5. **[MODIFY] Native persistence acceptance.** Extend the guarded existing
   browser runner for real same-origin storage and fresh-page reopening. Keep
   the exact served-module allowlist, independent source bindings and current
   editor/renderer regressions. Do not substitute the RF in-memory test backend
   for durable-storage evidence.
6. **[MODIFY] Acceptance and handoff.** Record actual persistence results,
   unchanged native rendering and failure behavior in this guide, the roadmap
   and session memory. Saving is accepted only after native reopen, no-op,
   conflict and source-binding checks pass. Full RealmForge Modeler integration
   and the existing M1C/B4H/full-provider work remain separate gates.

The storage composition reuses `webgpu-os/storage/StorageManager.js`,
`webgpu-os/storage/OPFSDriver.js` and
`webgpu-os/storage/StorageCoordination.js`. It is origin-local development
storage, not account or operator authorization. The adapter dynamically imports
the existing page-owned singleton only on explicit Save/Open. It never invokes
global `StorageManager.init()`, mount restoration or trash cleanup. It forces
`versionHistory:false` and `requireCrossContext:true` while preserving native
compare-and-swap expectations. RealmForge owns revision history. Session Close
drains whole repository operations; adapter Close then drains admitted storage
calls and releases its local reference. Neither closes the borrowed singleton,
whose coordination allocations remain page-owned until page teardown. No worker
route is admitted because these operations do not require the storage worker.
A write is not reported cancelled after publication commits.

Keep applied-design identity, pending form values, persisted head identity and
GPU build-report identity distinct. An unchanged Save must verify the expected
head and produce no new semantic revision or publication. Save failure does not
retire the live city. Open is explicit: no automatic load, capture substitution,
repair, deletion, migration or network publication. Retain the exact saved
resource when compilation fails; a failed scene replacement must not silently
rewrite the saved document to the previous preview.

### Acceptance gates and rollback boundary

The existing scoped RealmForge repository/persistence tests use in-memory
storage. Their assertions help test repository semantics, but do not prove
native durable saving. The new slice must add these real-browser checks:

- Save an applied custom design, close the page and open it in a fresh page
  sharing the same genuine storage. Verify exact payload, source digest,
  document/resource identities and independently derived compiled output.
- Repeat an unchanged Save with no new document revision or root publication.
  A peer head change must still surface as a conflict.
- Compete from two independently opened documents and preserve the winning
  head; do not silently overwrite or merge the losing design.
- Reject malformed envelopes, unsupported versions and wrong source digests
  before retiring the current city. Preserve corrupt evidence without repair.
- Retain current invalid/no-op editor behavior, selection, labels, movement,
  restore, close/reopen and cancellation checks. Exercise drainage with a real
  outstanding save, without replacing the persistence implementation.

Log save/open entry, completion, unchanged results, conflicts, failures and
elapsed time through existing diagnostics without exposing native storage
handles. During implementation, rollback means leaving the new opt-in adapter
and controls disconnected while preserving the accepted in-memory editor.
Do not delete previously saved assets as a rollback action. First Shard,
live-source access, networking, public shells, runtime provider activation and
normal OS startup remain out of scope.

## Saved-design acceptance checkpoint

The approved manual document slice passed on 2026-09-20. All 167 existing browser
cases remain green, plus 21 design-document cases for 188/188 total. The new gate
pins the prior 24 resource families plus `design`, rejects an unknown family and
checks an existing geometry vector against independently computed Python hashes.
It verifies exact envelope/payload shape, detached inputs, both real capture
bindings, resource/document hashes, semantic no-ops, identity-preserving edits
and compiled-output equivalence. Its native cases use distinct synthetic digest
names solely for isolated persistence-boundary testing, not claims of rendered
source inventories. They verify real OPFS bytes, immutable revisions, linked
updates, fresh repository sessions, stale-writer rejection, missing documents,
corruption preservation, exact path/CAS guards and close drainage.

The visible-city proof uses the genuine baseline capture and actual controls.
It applies 6000 mm building width, 16000 mm row spacing and height scale 900,
leaves invalid `7001` text unapplied, and saves the accepted 6000 mm design without
changing GPU allocations or its build report. Repeating Save retains the same
document/resource IDs, revision, commit and content hash. A genuine page reload
changes `performance.timeOrigin`, destroys the old document context and starts
the original URL preset with no automatically opened saved session. Explicit
Open restores the exact custom report and saved identity, validated by independent
recipe/geometry checks. Repeated Open is a GPU no-op; Restore affects only the
preview, and a following Open restores the saved custom design. The runner
requires fresh storage-admission counts for each action, so a prior idle
`opened` status cannot satisfy a later click.

The reopened baseline has 1,076 packets, 139,272 upload bytes and report digest
`sha256:1efe9dc8d350a698b89fde26661b80a87226f170a5d4ddcc539e53a94432518c`.
Root inspected `saved-design-opened-page.png`. The final full native run also
passes the existing editor, native cancellation, original pixel restoration,
preset/profile switching, kernel walk, labels, selection, resize and shutdown
proofs. No browser errors or denied routes remain. The exact guarded closure is
169 modules, with zero unused/skipped dependencies; 194 source bindings and 189
served routes are retained in the receipt.

Final native receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-native-source-city-h04pvzco/receipt.json`
(SHA-256 `ee7b6ad71483ab1470075a4d0f55d9cde6ec852ad87078c54de36a64c28a4b91`).
Combined Python checks passed 101/101 plus seven subtests: presenter 24,
baseline capture eight, kernel capture 12 and workbench 57. All prior 49
workbench checks remain, with eight added save/document/storage proofs.
JUnit: `C:/Users/btspa/AppData/Local/Temp/virtual-realm-saved-design-python.xml`
(SHA-256 `b3e4da846f0a5c23041fd17a68fde3ff3816e8084eaab9be306311e022eff6a9`).

The preceding native receipt in `virtual-realm-native-source-city-jx5vg4ai`
records passing browser and Save/Open checks followed by four connection refusals
from the development server during a later preset module load. The server still
passed the subsequent early-close gate. The final runner increases only the
server connection backlog from Python's five to 64; assertions and exact routes
remain intact, and production bytes are unchanged between those two runs.

Review also corrected resource-entry conversion when opening a real repository
snapshot, and separated the last verified applied design from a temporarily
installed render candidate. Save cannot publish a candidate whose boot and
recovery failed. That failure-path safeguard is source-reviewed and structurally
tested; it is not a claim of an injected native GPU-failure matrix. Storage Close
drainage is exercised through the actual session API. The gate's stale peers are
independent repository sessions, not a claim of a multi-process concurrency
stress test. Browser eviction, forced process termination, full Modeler editor
integration and live-world admission remain outside this acceptance.

## See also

- [Proposed source-city Modeler integration](source-city-modeler-plan.md)
- [Implementation roadmap](implementation-roadmap.md)
- [Runtime foundation and provider ledger](m2-runtime-foundation.md)
- [M2A runtime composition](m2a-runtime-composition.md)
