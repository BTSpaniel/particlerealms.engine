---
title: Sewing Studio v3 Integration Plan
description: Installed Factory and Engine integration, verification, and remaining work for the repackaged Sewing design studio.
updated: 2026-09-20
---

# Sewing Studio v3 Integration Plan

The Sewing upgrade supplied in `C:/Users/btspa/Downloads/sewing-v3/sewing` is installed in the local source app as **Create design**. It was adapted from our code by another AI. The hosted version now uses Factory editing, native project transactions and storage, and the scoped Engine WebGPU mesh surface. The source server serves these changes; a platform release bundle has not been rebuilt or deployed.

## Installed integration

- The adopted Start gallery offers the 13 supplied recipe families plus the native construction, quilt, accessory, fitted-block, and calibrated-import entries. Opening the gallery creates no saved example. Creating another design creates another make. Library, import/OCR, measurements, and recovery remain reachable without displaying a second design chooser.
- `studio-host.js` owns native project identities and verified saves. `studio/document.js` reconciles Pattern-desk edits before the same `project-controller.js` transaction publishes them. The designer and Pattern share annotations, cubic curves, original geometry, undo and saved revisions. Unsupported changes to recipe topology cancel visibly without publishing inconsistent geometry.
- `studio/model-bridge.js` translates the retained source into Factory paths. Curve control points stay in millimetres; sheet placement stays separate. Material roles, quantities, grainlines, folds, source edge marks, attached dimensions, panel instances and authored seam relationships are retained. Changes to derived panels and explicitly detached alterations follow the source recipe rules.
- `studio/factory-runtime.js` mounts `component.vectorEditor` and `component.meshPreview` through the existing compositor. Confirmed authored constructions render as one **Merged 3D assembly**; Explode and material filtering update that same Engine scene. Missing placement, stale seams and unconfirmed imports remain explicitly flat. Pattern and Engine selections stay synchronized. Physical contour meshing uses Factory; rendering uses Engine `ClothMeshRenderer` with WebOS-owned GPU surfaces, device generations and frame scheduling. Existing Kaolin normal calculation supports GLB output.
- All 13 adopted gallery families now carry enough source geometry, placement and seam information to use that merged assembly path. Shirt and tee each create six shell instances: two fronts, two back halves and two sleeves. Skirt creates four panel instances. Collar, stand, cuff, pocket and waistband pieces that lack attachment relationships remain visible as cutting or planning pieces instead of being placed arbitrarily. Shirt and tee split the sleeve cap at an authored notch. Their seam records declare 5.000 mm of front cap ease and 4.963868 mm of back cap ease. The Seams inspector shows the signed intentional ease and the unaccounted residual separately.
- **Weave / Smooth** decorates those same physical panel meshes with optional material appearance metadata. The Engine derives warp and weft from the retained millimetre chart and authored grain direction, applies its shared plain/twill/satin crossing rules and fiber appearance values, and fades subpixel thread detail. No second preview, canvas, renderer, simulation, or dependency is introduced. Appearance provenance survives assignment and save/load. Direct edits are marked as estimates. Foam, batting, inserts, and artwork remain smooth, while explicitly woven interfacing and structural records are eligible. This view does not change geometry, mechanics, cutting, or fit claims.
- SVG, DXF, printable PDFs, inventory and placed artwork use shared contour geometry. SVG and PDF retain editable source curves; basic DXF samples them at 0.05 drawing-unit tolerance. Paint exposes the same `vectorModelToDxf` exporter. Pixel drawings export unitless CAD coordinates; Sewing uses millimetres. DXF is not AAMA.
- `createMeshPreviewSurface.captureImage()` captures a fresh owned GPU frame and its drawing overlay through the Engine canvas codec. It rejects hidden or retired surfaces. This is a shared capability available to all mesh-surface consumers.
- The shared mesh surface also reports renderer diagnostics through a callback and `rendererdiagnostics` event. Sewing uses the requested/rendered woven counts to label preparation, active WebGPU shading, and the solid interactive fallback without polling.
- The designer uses Factory colors, typography, focus and motion preferences. Its size follows the OS window. Compact windows show one Pattern/Preview surface with an inspector overlay. Selection and camera state survive view changes. Original, Pattern, Preview, Make, Journal, Materials, and Measurements & fit preserve the exact `.gs-app` shell. Repeated edits retain mounted surfaces and cached contour meshes.
- The shared SurfaceManager preserves explicit positioning on disconnected mounting hosts. Previously a temporary empty computed style could replace an absolute preview host with relative positioning, leaving its GPU canvas zero-height. Expected owner cancellation also no longer appears as a failed Factory part.

New day-dress generation uses recipe version 4: its symmetric cubic neckline has the requested physical depth. The earlier back control depth of 35 mm produced a 26.25 mm neckline and an invalid 10 mm offset. Existing saved shapes are preserved; explicit regeneration or curve editing creates an authored change.

Sources: `webgpu-os/factory/apps/sewing/studio-host.js`, `studio/document.js`, `studio/model-bridge.js`, `studio/preview-model.js`, `studio/native-adapter.js`, `studio/native-gallery.js`, `studio/woven-preview.js`, `studio/factory-runtime.js`, `material-appearance.js`, `material-profiles.js`, `project-controller.js`, and `projects.js`; `webgpu-os/factory/components/mesh/preview.js`, `mesh/gpu-preview.js`, `mesh/physicalMesh.js`, and `drawing/vectorModel.js`; `engine/render/mesh/ClothMeshRenderer.js`, `engine/sim/cloth/FiberMaterials.js`, and `webgpu-os/kernel/SurfaceManager.js`.

### Current boundaries

An arranged preview is not a cloth solve or a fit result. Panels without authored placement stay on the Pattern sheet and cutting list; they are not placed arbitrarily into an assembly. The adopted shirt, tee and skirt now have explicit shell instances and authored seam mappings, so Preview shows one merged shell for each. This establishes a coherent saved rest-shape arrangement and matched source edges. It does not establish body fit, sleeve mobility, closure construction, drape or fabric behavior. Printed artwork appears on the Pattern underlay; the Engine arrangement uses material colors. Source edge notches retain their supplied sampled-edge references; they are not reconstructed sewing features from an arbitrary PDF.

The 13 adopted gallery recipes preserve their source construction records and convert their active panel instances and seams into the Studio preview contract. They do not force curved designs into the older rectangular `sewing.construction.v1` schema. Native fitted blocks, connected constructions, quilts, accessories, traced PDFs and other imported patterns also open through the one Studio interface. A trace remains flat until the user confirms assembly relationships; the app does not infer a sewn object from a closed contour. Retired worktable modules remain on disk for compatibility and historical tests, but normal Sewing routes do not import or mount them. Bounded Engine cloth now settles the default lined tote and pouch fixtures and admits covered glove dynamics. Physical sample validation, complete garment/glove settling and fit, comprehensive cursive OCR, and a fully custom replacement for the shared PDF internals remain separate work that cannot be established by browser contracts alone.

### Reproduction

Run the browser installation contracts at `tests/sewing/studio-install.html` (add `?gpu=1` for a real scoped GPU fixture). The exhaustive adopted-gallery lifecycle is `tests/sewing/gallery-family-lifecycle.html`. It opens all 13 families through the actual app, changes a recipe dimension, checks every enabled seam against `abs(A - B - ease) <= max(0.5 mm, 0.1%)`, opens Pattern and Preview, exercises SVG, DXF, GLB and OBJ through the Factory runtime, saves through OS storage, and reopens the same revision. It passes **321/321** in both software fallback and scoped WebGPU modes. Shirt and tee additionally assert six shell instances, positive front/back cap ease and zero unaccounted cap difference; skirt asserts four shell instances.

`tests/sewing/native-creation-matrix.html` covers all 12 native construction, accessory, simple-template and fitted-block entries. It passes **152/152**, including create, edit, Preview, persistence, reopen, finite Engine meshes, SVG, DXF, GLB, OBJ, printable PDF and `.sewpkg` output with truthful assembled-versus-flat semantics. `tests/sewing/creation-entry-routes.html` passes **16/16**, and the optional PNG, CSV and tech-pack routes pass **7/7**. `tests/sewing/trace-import-lifecycle.html` passes **17/17** for an unchanged original PDF, empty initial trace, confirmed physical contour, flat preview, valid exports and saved-source reopening. The calibrated-import lifecycle passes **60/60** across SVG, DXF, GLB, OBJ and `.sewpkg`. These focused creation and import routes total **252/252** checks and distinguish a native authored assembly from a traced contour that has no confirmed sewing relationships.

`tests/sewing/native-studio-adapter.html`, `construction-unified.html`, `construction-cloth.html`, `construction-settling.html`, `accessory-cloth.html`, `pattern-import.html`, `accessory-worktable.html`, `quilt-construction.html`, and `studio-record-pages.html` cover merged/flat preview semantics, numerical cloth gates and one-shell routes. `tests/sewing/mesh-preview-gpu.html` verifies shared rendering, capture, and ownership. The default lined-pocket tote converges in 89 steps at about 9.6 seconds; the lined pouch converges in 177 steps at about 16.7 seconds. Both record 60 stable steps within the unchanged 30-second gate. The full shared runner passes 23 pages with zero failures, including Notepad, Paint, PDF and Factory regressions. `tests/sewing/run_ui_review.py` checks dark/light themes, 1024×768, 720×520, and 44-pixel Make controls; its current scores are ease 9/10, onboarding 8/10, preview clarity 9/10, accessibility 9/10 and WebOS-theme coherence 9/10. Full WebOS verification opens `webgpu-os/app.html?app=os.sewing&session=demo`, exercising the actual kernel and embedded app. Fixture storage is temporary, not a real operator's account.

The following sections retain the original package review and broader integration targets. Findings in that review describe the supplied package before the changes above.

## What the package contains

Hash comparison against `webgpu-os/factory/apps/sewing/` found 53 matching original files and one changed original, `SewingApp.js`. Its four changes import the studio host, add navigation, change the opening route, and register the view renderer. New files contain the standalone page, its combined source, a generated module/stylesheet and an additive host adapter.

The package has 13 design families: crescent bag, round crossbody, bucket hat, day dress, tote, crossbody with flap, zip pouch, drawstring bag, four-patch quilt, zipped cushion, shirt, tee and skirt. Its useful additions include an illustrated design gallery, exact dimension controls, retained source curves, gathered frills, binding strips, construction openings, material inventories and artwork with a physical repeat size.

`studio/src/compiled.js` contains named source sections. `studio/build.py` wraps them into an importable module and a standalone HTML page. The adapting work also introduced independent history, vector editing, preview and export implementations so that this page can run on its own. Reconnecting those capabilities is the main integration task.

Sources: supplied `README-STUDIO.md`, `studio/review/SewingApp.js.patch`, `studio-host.js`, `studio/src/compiled.js`, `studio/build.py`.

## Original package verification

The review used Chrome, a temporary localhost server and temporary test storage. Browser work was serialized with the repository's performance lock. The supplied historical receipts were read as background, not counted as new test results.

| Check | Result |
| --- | --- |
| All 13 default design documents | Passed validation, JSON save/reopen and admission through current host vector/workspace validators. |
| SVG and DXF smoke checks | All defaults produced parseable SVG and nonempty DXF. This does not establish dimensional or manufacturing accuracy. |
| Actual Sewing/Factory host fixture | Supplied entry patch mounts, persists the document through the real shard repository, reaches Library and remounts. Storage is an in-memory test adapter, not a real operator vault. |
| Geometry handoff | Every returned draft lacks native construction relationships. All handoff commands are linear; four curve-based families lose live cubic editing. The complete source is retained separately in `studioSource`. |
| 720 × 520 browser | Two canvases are each 318.5 px wide; 31 of 37 visible buttons have at least one dimension below 44 px. |
| 720 × 520 embedded app inside a 1440 × 900 browser | Studio height is 900 px; the desktop inspector remains visible. |
| Dark appearance | The supplied studio retains its light background and text colors. |
| Default source execution | No unhandled page errors in the reviewed flows. |

Reproduce the review with `python tmp/sewing-v3-review/run_review.py`. It reads the supplied folder without changing it. Evidence and screenshots are in `tmp/sewing-v3-review/`; the source SHA-256 is recorded in `review-results.json`. The temporary evidence remains machine-local and is not a shipped app dependency.

## Findings from the original package

1. **Give each design its own identity.** The host selects the first project carrying a studio document and keeps that project in its save closure. Selecting a new construction replaces the inner document and saves into that same host project. New make, new design and save variation must use explicit project/draft identities. Ordinary opening must not automatically create an example crescent make. Existing saves themselves work; this is a workflow and identity problem.
2. **Keep recovery reachable.** The adapter overlays the whole app and makes the original navigation, error banner and recovery controls inert. An unreadable studio document sets `saveBlocked`, while the exit action and close guard require successful saving. Mount within the normal content area; preserve recovery access and allow leaving unreadable data without replacing it.
3. **Preserve accepted edits.** A reproduced 5 mm change to the crescent back panel is reset by `refreshDerived`, including its detached status. Imported piece placement is also repacked during refresh. Declare linked pieces and show their editing rules; retain independent alterations and placement. Only explicit regeneration or arranging should replace those values.
4. **Validate mappings before creating previews.** Removing `bag-gusset.v3map.source` passes supplied validation and parsing, then throws during meshing. Removing `dress-front.v3map.flare` also passes and produces 2,250 nonfinite position values. Require each mapping's fields, references and finite outputs before allocation or publishing a result.
5. **Use one physical curve definition.** Source curves are retained in SVG, while seam lengths, generated gussets, DXF and the handoff use fixed samples. Replace fixed sampling as manufacturing authority with shared curves and an explicit millimetre error tolerance. The zero-allowance SVG path replacement also needs object-based export so identical cutting/sewing paths cannot be confused.
6. **Retain material and sewing semantics.** Handoff cutting-list rows currently use the outer material name even for lining and other roles. Connections, hardware, openings, modifiers and construction steps need active native records, not just a retained source copy.
7. **Size and style for the OS window.** Replace viewport-height rules and browser-width media queries with host sizing and container queries. Use Factory theme tokens and controls, keeping artwork and fabric colors separate from UI colors.

Sources: supplied `studio-host.js:21–66`; `studio/src/compiled.js:304–318`, `759–767`, `992–1013`, `1061–1073`, `1093–1121`, `1161–1162`; generated `studio/studio.css:27–34`. The mapping, back-edit, layout and host-sizing cases were reproduced in the local review. The recovery and multiple-project cases are source-review findings requiring integration regressions.

## User experience to build

Keep **Library, My makes, Materials, Measurements** as the global navigation. The illustrated gallery becomes **Create design**, reachable from New make and the library. It displays templates; the pattern library continues to contain owned PDFs, scans, photographs, tags and completed makes. Remember the last library or make location.

An open design uses the existing stable header and **Original, Pattern, Preview, Make** views. Bring the package's curve, detail, artwork and sizing controls into one contextual inspector. Edge connections belong under Pattern/Seams. Make continues to mean the next physical sewing operation, with linked source instructions and saved progress.

Keep **Quick design** as a local, explicit recipe composer: choose a family, dimensions, layers and finishing details, preview affected pieces, then create a design. Its current implementation is rule-based. It should not imply arbitrary AI pattern generation. Example body presets remain marked examples and never overwrite saved people or measurement revisions.

At smaller window sizes show a position-preserving Pattern/Preview toggle whenever two canvases cannot each retain 420 px after controls. Use 44 px primary actions, keyboard/numeric equivalents for drags, visible focus and OS motion preferences. Keep instructions concise; put developer diagnostics behind an optional details control.

Sources for current reusable layout: `factory/apps/sewing/worktable-frame.js`, `draft-worktable.js`, `worktable.js`, `forms.js`, `styles.js`, relative to `webgpu-os/`.

## Ownership and file map

All paths in this target map are relative to `webgpu-os/factory/` unless an Engine path is stated. Proposed filenames describe remaining modularization targets; the installed file map is documented above.

| Work | Existing owner and concrete change |
| --- | --- |
| Gallery and navigation | Modify `apps/sewing/drafting.js`, `SewingApp.js`, `worktable-frame.js` and `styles.js`. Add `apps/sewing/design-gallery.js` for the adopted illustrations and recipe cards if it keeps the existing modules focused. |
| Package admission | Add `apps/sewing/studio-import.js` as a bounded `.garment.json` codec. Reuse the shared file chooser, Sewing asset storage and `validateWorkspace`; preserve source bytes and return a conversion report. |
| Native records | Extend `apps/sewing/model.js`, `construction-record.js` and `record-links.js`. Use existing projects, drafts, original assets and immutable authored revisions. |
| Recipe implementations | Extend `apps/sewing/construction.js`, `quilt-construction.js` and existing generation workers. Extract new curved recipes into `apps/sewing/curved-construction.js`; reuse matching existing tote/pouch/pillow/quilt implementations. Keep the existing native fitted-block adapter. |
| Curves and editing | Reuse `components/drawing/vectorModel.js`, `vectorGeometry.js`, `vectorEditor.js` and `editTransaction.js`. Add generic missing node/feature controls there so Paint consumes the same implementation. |
| Sewing relationships | Extend Sewing's existing `geometry.js`, `construction-record.js` and `construction.js` for ordered edge intervals, allowances, notches, derived dependencies and detached alterations. |
| Preview and meshing | Reuse `components/mesh/contourMesh.js`, `physicalMesh.js`, `preview.js` and `gpu-preview.js`; Sewing supplies physical placement maps and construction connections. |
| Cloth | Extend `apps/sewing/construction-cloth.js` over `engine/sim/cloth/triangular/`. The package's simple floor-contact study is a visual reference; its assumptions do not establish Engine cloth validation. |
| Artwork | Add physical-repeat surface support to the existing shared drawing/mesh rendering contracts. Sewing stores material placement; Paint can author artwork through the same generic capability. |
| History, saves and packages | Reuse `apps/sewing/project-controller.js`, `store.js`, `repository-shards.js`, `storage-portable.js` and Factory history. |
| Documents and print | Keep `apps/notepad/index.js` as the shared PDF/OCR/print entry. Extend its exports for missing generic output options. Adapt optional DXF/OBJ/GLB writers into the existing relevant shared codec owners after checking those owners for equivalents. |

The authoring boundary remains `sdk/index.js`. New reusable surfaces register through the existing `components/studio-parts.js`; there is no second app registry or composition framework.

## Data and geometry contract

Use the existing native vector model as the authored outline. Convert source lines to `L` and cubic segments to `C`, preserving stable piece/node/edge IDs and keeping their local coordinates in millimetres. Store layout as a separate transform. Render sampling is derived; it never changes the cutting or seam dimensions.

Current `sewing.construction.v1` panels and their mesher are rectangular. Add a versioned construction reader supporting a discriminated rectangle/contour panel. A contour panel references the canonical path and a validated placement map; it must not be treated as its bounding rectangle. Keep the v1 reader intact. Convert a record by writing and verifying a new revision before publishing it. Preserve the older revision.

Connections need ordered edge intervals, direction, intentional ease, matching marks and confirmed/authored provenance. Curved boundaries may span several named segments. Material roles, cut instances, folds and explicit cut dimensions must survive conversion without counting derived allowance paths as extra pieces. Openings, turning gaps, straps and closures require declared assembly operations and physical meaning.

Treat lining, gussets, frills and binding as dependencies. A user can edit the controlling parameter or explicitly detach an eligible derived piece. A detached alteration remains authored across unrelated changes. Regeneration produces a new revision; the changes tray identifies affected pieces and any incompatible alterations before commit.

All authoring passes through the existing project controller's begin/preview/commit/cancel operations with an expected base revision. One drag or typed change commits one undo entry. Meshes, layouts and simulations carry `sourceRevision`; cancelled or late jobs cannot publish into another revision, make or operator.

`.garment.json` import preserves the original as an asset and creates an independently editable native design. Keep unsupported fields in retained provenance, and list unmapped capabilities. Do not advertise a lossless conversion until live geometry, relationships, materials, instructions and revisions round-trip. Existing `.sewpkg` and folder backups include the new records and declared dependencies through their current remapping/chunking paths.

Sources: `apps/sewing/model.js`, `construction-record.js`, `construction.js`, `project-controller.js`, `repository-shards.js`, `storage-portable.js`; `components/drawing/vectorModel.js`, `vectorGeometry.js`; `components/mesh/physicalMesh.js`.

## Implementation sequence and completion gates

1. **Admission and persistence.** Implement the source-preserving codec and native record extensions. Prove two different new makes, selected-project reopening, variation identity, source recovery, invalid-mapping rejection, quota/conflict handling, operator isolation and portable import/export. Do not change the startup route as part of admission.
2. **Gallery and native workspace layout.** Adopt the gallery and contextual controls within existing navigation. Preserve library intake, PDF/OCR, measurements and Make progress. Verify 720 × 520 inside a larger browser, multiple windows, dark/light/high-contrast appearance, keyboard operation and reduced motion.
3. **Crescent end-to-end.** Preserve cubic outlines and map gusset/lining/material/step dependencies. Edit depth and curves, preview changes, detach a back alteration, undo, reopen and export through the same native draft. This milestone includes validated contour meshes and an assembled arrangement; dynamic cloth settling belongs to step 6. Use this as the first complete design integration.
4. **Remaining design families.** Add round bag and bucket hat, then crossbody/drawstring and the loose dress. Before mapping overlapping tote/pouch/pillow/quilt families to current owners, compare cutting dimensions, quantities, connections and instructions. Preserve distinct recipe versions wherever they differ; matching family names do not establish equivalent construction. Preserve existing shirt/tee/skirt and fitted-block capabilities; the package's older independent garment visualization cannot become a claim of geometric fit.
5. **Details and artwork.** Add gathered frills, binding, per-edge finishes, openings and physical-repeat artwork. Keep artwork separate from cutting quantities. Previewing, numeric entry, pointer editing, save/reopen and undo must refer to the same geometry and material roles.
6. **Engine assembly and exports.** Generate meshes from the actual contours, attach confirmed seam intervals and measured/declared materials, and use existing Engine cancellation/resource budgets. Keep arrangement, cloth settling and physical fitting distinct. All SVG/PDF/DXF and mesh export adapters read the current revision and reject invalid outputs.
7. **Release verification.** Exercise the full library-to-Make walkthrough and simultaneous Notepad/Paint/Files/mesh consumers. Complete recovery, migration, generation cancellation and physical-dimension regressions before changing the default customer experience. Publish an independent usability review; every agreed category must reach at least 8/10 for the implemented workflows.

For physical geometry, retain the earlier plan's analytic-length tolerance `max(0.1 mm, 0.1%)` and paired-seam tolerance `max(0.5 mm, 0.1%)` after intentional ease. Include strongly curved legal inputs, zero allowance, compound contours, extreme recipe parameters and altered linked pieces. Assert actual exported dimensions and reopened geometry, not just nonempty files. Verify A4/Letter/full-size output, selected pieces, calibration square, both-axis test bars and page identifiers through the shared print pipeline.

Family-specific cloth settling and real sewn/fit observations remain independent gates. No physical sample has been supplied. A good-looking arranged preview cannot satisfy those gates or retire existing glove/cursive-OCR work.

## Dependency boundary

This integration adds no external runtime dependency or model download. Its hosted renderer uses our shared Engine and the already-present Kaolin normal utility. Packaging and browser test tooling use Python, outside the app runtime. The supplied Node smoke runner is not used; no Node/npm build was added.

The existing shared PDF implementation still loads locally vendored PDF.js in `apps/notepad/pdf-runtime.js`, and its vector export loads pdf-lib/fontkit in `pdf-vector-export.js`. The earlier requirement for an entirely custom PDF backend is therefore **not yet satisfied by the current checkout**. Retain the shared Notepad API and track replacement of those internals as a separate shared document task, including existing layered/scanned PDF regressions. The new studio package does not resolve that dependency requirement. Do not claim the entire app or Engine is dependency-free.

## Independent review

Two read-only agents reviewed domain correctness and host/UI integration. They supported adopting the gallery, recipes and controls through our existing services, and identified the mapping, regeneration, identity, recovery and layout issues captured here. The visual reviewer rated the desktop composition 8/10. Its supplied-host scores were ease 6/10, WebOS/accessibility 5/10, Factory reuse 3/10, data/workflow 5/10 and preview integration 6/10. These are judgments about the adaptation before integration; they are not measured user-study results or scores for completed proposed changes.

The reviewer then assessed this proposed integration plan: architecture/Factory reuse **9/10**, UX/accessibility **8/10**, data/recovery **9/10**, sewing correctness **8/10**, and feasibility/verification **8/10**. The two requested clarifications, assembled arrangement versus cloth settling and explicit comparison of overlapping recipes, are included in steps 3 and 4. These scores meet the planning threshold; implemented usability still requires its own review.

## See also

- [Sewing Studio and Shared Factory Surfaces](sewing-studio.md)
- [Factory SDK](../../webgpu-os/factory/sdk/index.js)
- [Shared project controller](../../webgpu-os/factory/apps/sewing/project-controller.js)
