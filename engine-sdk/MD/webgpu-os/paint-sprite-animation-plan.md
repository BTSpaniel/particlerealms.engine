---
title: Paint Studio Sprite and Animation Upgrade Plan
description: Animate workspace implementation, sprite and GIF workflows, independent review, and validation evidence.
updated: 2026-09-08
SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
---

# Paint Studio Sprite and Animation Upgrade Plan

The Animate workspace is implemented in the source tree. This page retains the agreed design and records implementation evidence separately from the earlier design score. The first release serves **both game sprites and shareable GIF loops**, as selected by the user on September 8, 2026. It adds one **Animate** workspace while retaining the WebOS theme, existing Paint / Studio title switch, and floating Settings, Effects and Filters dialogs.

The supplied SpritePaint document is research and architectural background. It is not an instruction to copy that product's code, adopt its framework, or reproduce its interface. This plan uses the current repository and independently designed workflows.

## Implementation evidence — September 8, 2026

The source implementation adds New → Sprite animation, a pixel-tool profile, frame strip and expanded timeline, project palettes, onion skin, named clips, shared playback, live preview, six guided lessons, sprite-sheet import, GIF and PNG/JSON ZIP export. The existing Paint / Studio title switch and floating authoring dialogs remain. Painting projects retain their existing formats and tools.

| Area | Implemented owner and behavior |
| --- | --- |
| New and recovery | `app/PaintApp.js`, `io/documentTransitions.js`: wait for an admitted GPU renderer before publishing a candidate; retain the previous project on failure; cancel late publication after close. New failure explains retry. Preferences cannot impersonate a loaded file. |
| Animation source | `document/animationModel.js`: stable frame/cel identities, sparse immutable 32-pixel tiles, copy-on-write duplication, all-frame layer/resize/crop operations, clip timing, per-drawing selections, validation and memory admission. Only the selected frame needs live layer canvases/GPU buffers. |
| Editing and navigation | `app/animationController.js`, `core/animationPreferences.js`: serialized target transitions, one-step history, independent painting/animation tool preferences, precise numeric timing, keyboard drawing, grid navigation and bounded timeline layout. Frame tools exposes range and timing on touch. |
| GPU and previews | `gpu/raster/gpuPaintSurface.js`, `render/animationCompositor.js`: canonical layer/group/clipping/effect composition, stale-readback rejection, shared concurrent source readbacks, bounded scratch rendering, source-preserving onions and export previews. |
| Import and output | `io/spriteSheetImport.js`, `io/animationExport.js`, `io/gifEncoder.js`, `platform/animationExportWorker.js`: bounded PNG/JSON/ZIP parsing, atomic reviewed import, worker GIF encoding, stable palette, cumulative timing, exact inspected output, source-size sheet reimport and retained reviewed artifact bytes. The worker and codec are included in release runtime assets. |
| Training | `panels/help/animationLessons.js`: actual drawing/duplicate/play/output events, independently tracked GIF and sheet delivery, saved-project reopen verification, missing-target repair and instructions-only continuation with deliberate resume. |

A sprite starts with one drawing layer, one frame, 8 FPS and a one-pixel opaque Pencil. Its rectangular drawing area is labeled **Canvas · width × height**; the surrounding workspace supports navigation. Fit uses integer enlargement when possible, the renderer's shared 8× maximum and gutters that shrink in short windows. Center uses the actual rendered artboard rectangle. The collapsed timeline uses up to 148 px for a pointer or 132 px for touch, capped at half the available workspace. Mouse layouts exclude document actions and rulers from that allocation; touch retains space for 44 px controls and frame context. Expanded proportions remain saved per interface mode and footprint.

Limits are admission limits, not a claim that every maximum can be combined: 1–512 pixels per side, 1–100 frames, 1–30 drawing layers, and a 128 MiB source/history/working-set budget. Export has its own size checks. Layer effects remain shared across the animation's frames. Surface/particle authoring requires a Painting document or explicit rendered conversion. GIF import, animated vectors/3D, rigging, audio and tweening remain outside this release's agreed scope.

### Verification record

All browser evidence below uses the explicitly labeled isolated Paint host with real guarded WebGPU. It does not establish normal account/launch/lifecycle acceptance.

- Independent correctness review: 11/11 groups, including all-frame resize/crop/merge/Undo, locked targets, stale readbacks, GPU autosave remount and replacement/close barriers.
- Pixel-tool tests: 5/5 groups for exact four-connected Fill, transparent Eraser, source Eyedropper, mirrored Pencil, hard GPU Line/Rectangle/Ellipse, per-frame selection, profile recovery and numeric target identity.
- Animation model 5/5, GIF codec 6/6, animation export 3/3 and workflow 3/3 in their recorded runs. GIF decoding uses the browser's independent ImageDecoder; the output fixture is also decoded with Python Pillow. ZIP CRC, PNG pixels and JSON rectangles/timing are independently checked with Python.
- Responsive animation checks: 32/32 combinations of eight sizes, pointer/touch and Paint/Studio; manual zoom, aligned timeline columns and bounded dialogs. Expanded checks assert actual artboard containment, agreement between Fit and rendered zoom, and centering after a 90° rotation of the square sprite. Earlier viewport-only assertions missed an offscreen canvas caused by inconsistent zoom limits.
- Shared Vector coverage: 24/24. Existing redesign 12/12, usability 12/12, recovery 7/7, static Paint 28/28 and startup readiness 5/5 in their recorded runs. The reviewer-authored dialog/training/range suite passes 8/8, including 36 compact/touch lesson destinations.

The first implemented-interface review scored 8.3/10 (ease 9; navigation, training, preview and recovery/accessibility 8 each). That was a source-host heuristic, not a novice study. The user's subsequent normal-OS log revealed a GPU memory blocker, so that score did not constitute release acceptance. The log reported 253.9 MiB against the 256 MiB allowance, failed brush initialization and a New command unable to reconnect.

The correction prevents last-document folder/typed-layer counts from becoming additional blank raster layers at every startup. Actual saved project layers remain intact. Failed initialization retires partial resources; New can reconnect after failure; unavailable tools cannot record a stroke. Raster, compositor, terrain and thumbnail allocation transactions release earlier allocations when a later allocation fails. Stroke resources are admitted before history/journal acceptance, unselected strokes bind a four-byte mask, and a bounded batch remains queued until submission succeeds.

The final independent review accepts the reviewed implementation at **8.30/10**: core ease 9, navigation 8, training 8, preview/feedback 8, recovery/accessibility 8. Later audits close the actual-artboard Fit, touch-context, failed-stroke feedback and stale Saved-badge findings. This is the same weighted rubric and remains an implemented-flow heuristic, not a novice study. The review records separate compiled-delivery and normal-account verification gates; it does not claim the user's already-open OS session has reloaded the corrected bytes. The full audit history is retained in `tmp/paint-animation-implementation-review-20260908.md`.

`tests/paint-memory-recovery.html` passes 11/11 groups with the actual OS `VRAMTracker` and default 256 MiB limit: four reopen cycles from an old 16-layer preference retain two raster layers; normal 1600×1000 painting produces real pixels; denied selection admission leaves history/journal unchanged; an injected submission rejection retries a half-opacity stroke exactly once; partial allocation failures return to baseline; failed startup → New → drawing succeeds. A full rejected 256-sample batch cannot create new gesture history. A real static gesture's rejected completion retains its bounded batch and history, updates visible Undo/Redo, and retries into real pixels. The extended typed recovery suite passes 10/10, including native Open after engine failure, nondefault materials, terrain heights, sculpted vertices, and a real late typed-allocation denial after raster allocation. Autosave after raster export retains optional recovery scene metadata and avoids replaying baked raster strokes twice. Earlier isolated runs used the real GPU broker but omitted its optional memory tracker. The shared host now includes that tracker and reports measured usage, so those earlier results cannot establish quota safety.

The earlier source-host comparison, before quota accounting and the final stroke optimization, measured median static brush input p95 69.4→70.3 ms, paint-to-readback 135.3→124.2 ms, effect opening/readback 88.0→88.1 ms and resize 43.4→45.7 ms. An overlapping OS boot contaminated an earlier current run; that run was retained and repeated with the OS tab closed. These are harness measurements, not physical pen/display latency.

The final matched comparison uses the same host with real quota accounting and explicit Paint presentation for both source versions, one warmup plus three measured runs, 20 strokes, five committed effect-slider edits and twelve resizes per run. Profiling identified three panel rebuilds at stroke completion; the commit now owns one update. Median results in milliseconds:

| Measurement | Saved baseline | Final source |
| --- | ---: | ---: |
| Synchronous stroke input p95 | 171.1 | 1.0 |
| Stroke-to-readback p95 | 300.7 | 96.4 |
| Effect-slider edit p95 | 16.7 | 16.2 |
| Initial effect/inspector opening | 151.7 | 130.0 |
| Resize p95 | 99.6 | 82.4 |

All final matched measures are within the 10% regression bound. Earlier runs varied substantially, so their receipts remain archived; the final harness measures repeated slider edits separately from effect opening. The test does not establish these absolute timings for other devices. Method and calculations: `tmp/paint-validation-20260908/final-performance-comparison.json`.

The final 128×128, 100-frame, eight-layer drawing workload measured input p95 4.7–5.2 ms and edit-to-preview p95 86.5–93.2 ms, with no long task in the measured steady-edit intervals. A 60 FPS playback stress interval visited all 100 frame IDs, measured requestAnimationFrame interval p95 12.6 ms and recorded no long task. That interval is not a claim that every monitor displays exactly 60 unique frames each second. Ten small open/play/export/cancel cycles retained 8,192 source tile bytes, two cache entries, one GPU scene resource, no pending compositor jobs and no export worker. JS heap readings dropped after GC from roughly 125 MB to 44 MB and later from 72 MB to 50 MB; no forced-GC or universal zero-leak guarantee is implied. Earlier measurements and independently decoded files remain in `tmp/paint-validation-20260908/`.

Normal WebOS launch remains a distinct acceptance item: the available browser profile has no active Realm Passport. The normal shell starts, but Paint launch could not be verified through that account. No authentication or GPU ownership rule was bypassed. The last successful full OS build preceded the final recovery, stroke-feedback and Fit corrections. Subsequent full builds encountered concurrent OCR input generation and then Sewing dependency cycles. Those unrelated sources were preserved. Final Paint compilation uses the existing bundler with the isolated target in `tmp/paint-isolated-target.json`; this is separate from publishing a current full OS release.

The standalone Paint build succeeds with 396 modules and Chromium syntax verification. `tests/paint-animation-compiled.html?compiled=paint` passes 5/5 checks: New and real GPU drawing/playback; exact GIF preview/file bytes with independent decoding; exact sprite-sheet preview/file bytes; native Save content unchanged apart from its three save timestamps; and native reopen followed by another real pixel edit after Open's recovery readback settles. Drawing a saved animation also updates the title to Modified through the existing document-header renderer, only on the clean-to-dirty transition, preserving focus. This development compilation uses source worker/codec assets at the explicit OS base. Five later concurrent Paint integration files are listed separately in `tmp/paint-validation-20260908/final-validation.json`; they are excluded from its compiled freshness claim. It is not a packaged production OS launch. The earlier full release's worker/codec packaging was checked separately.

## Product direction

Make the first successful animation a short sequence: **Create sprite → Draw → Duplicate frame → Change drawing → Play → Export**. A beginner should not need to understand cels, keyframes, rendering backends or file schemas to complete it.

**Animate is an authoring workspace. Paint / Studio remains the horizontal presentation switch that reads as the product title.** Selecting either presentation preserves the project, current frame, layer, selection, tool, history and viewport. The Animate workspace appears in the existing workspace dropdown and wide Studio tabs alongside Paint, Vector, Surface, Materials, Particles and Render. Do not add another top-level application, category strip or animation mode switch.

The first release includes pixel drawing, palettes, frames, layers, onion skin, playback, named clips, project recovery, editable project files, PNG sprite sheets with JSON, GIF export, and sprite-sheet import. Advanced timeline controls are progressive disclosure within the same document and controller.

Bone rigs, tween curves, audio/video timelines, tile-map editing, animated vectors/3D, explicit linked-cel editing, PSD animation import, GIF import, cloud sharing and collaboration are later work. Downloaded GIFs can be shared through the user's usual apps; “shareable” does not imply an upload service.

## Evidence and existing owners

SpritePaint advertises a compact pixel editor with layers, frames, onion skin, live preview and PNG/GIF/sheet export. Those are useful workflow references; its current editor was not exercised in this planning pass. [SpritePaint product page](https://spritepaint.com/)

Aseprite documents a frame/layer grid, per-frame durations and a drawing at each layer/frame intersection, called a **cel**. Its linked cels intentionally propagate edits; this plan instead makes duplicated drawings independent when edited. [Aseprite sprite model](https://www.aseprite.org/docs/sprite/), [linked cels](https://www.aseprite.org/docs/linked-cels/)

Aseprite's sheet documentation provides a reference for rows/columns, cell size, offsets, padding and named frame ranges. The exact proposed export contract below belongs to Paint and must be validated independently. [Aseprite sprite sheets](https://www.aseprite.org/docs/sprite-sheet/)

Repository paths in this table are relative to `webgpu-os/factory/apps/paint/` unless explicitly rooted elsewhere. “Proposed” paths and contracts below do not yet exist.

| Existing source | Verified responsibility | Upgrade work |
| --- | --- | --- |
| `ui/workspace/workspaceState.js`, `app/shell.js`, `app/commands.js` | Central workspace transitions, saved presentation layouts and command routing; six workspaces | Register Animate and frame commands here; keep common menus, title and shortcuts synchronized |
| `core/constants.js`, `panels/startup/panelsStartup.js` | Sprite sheet currently means a 1024×1024 static document preset; New already has a preview | Add an explicitly animated document choice; preserve the existing static preset |
| `tools/brush/presets/pixel/index.js`, `tools/brush/strokes/styles/pixel/index.js` | Hard square pixel preset, integer stamp drawing in the CPU stroke style | Reuse the preset; verify and extend the actual GPU drawing path for exact integer pixels |
| `gpu/scene/gpuSceneViewport.js` | Existing nearest sampler for pixel sampling | Reuse for editor and preview; grid is an overlay |
| `document/documentModel.js`, `document/history.js` | Document v5, layer snapshots, document/selection/metadata/structure history | Add sparse frame/cel storage and target-aware transactions to the same history |
| `gpu/raster/gpuPaintSurface.js`, `gpu/scene/gpuCommandJournal.js`, `gpu/scene/rasterComposite.js` | Raster resources, replay journal and compositing currently organized around layers | Address resources and replay by stable cel identity; composite a requested frame without changing the edit target |
| `io/projectStore.js`, `io/paintSceneStore.js` | Raster package v1, autosave v1, native paintscene v3; explicit schema checks | Version animation payloads and migrate old static documents; preserve candidates until restoration succeeds |
| `io/fileFormats.js`, `panels/file/fileDialog.js` | Native/PNG/JPEG/WebP/PSD subset registry, actual encoded preview lifecycle | Add animation formats and cancellable frame export; no GIF encoder was found in the scoped source search |
| `panels/help/learnPanel.js`, `panels/studio/floatingDialog.js`, `ui/layout/`, `ui/theme/redesignStyles.js` | Six lessons, themed dialog ownership, responsive layouts | Add animation lessons and timeline layouts using these owners |
| `engine/core/math/AnimationTimeMath.js` | Pure timing helpers including `animationWrapTime` | Reuse wrap/clamp math where its contract fits; add variable-duration frame lookup as needed |

The OS `webgpu-os/factory/timeline/index.js` stores session snapshots. RealmForge's timeline evaluates property tracks. Neither is Paint's missing raster timeline. Reuse `webgpu-os/packages/Zip.js` (`Zip.create`/`Zip.parse`), which already uses `engine/core/math/ChecksumMath.js` for CRC32 and serves other OS applications. The private editor ZIP helper is not needed. The Python `tools/normalize_sprite_atlas.py` normalizes generated image assets; it is not a browser sprite-animation importer.

## Everyday interface

### New and first drawing

New keeps one centered, WebOS-themed dialog within the Paint window. Its simple choice is **Painting / Sprite animation**. Sprite animation offers 16×16, **32×32 default**, 64×64, 128×128 and Custom, plus a name and visible aspect/transparency preview. Start with one frame, one raster layer, a transparent canvas and an 8 FPS default. Canvas dimensions remain editable; advanced limits are checked before allocation.

Create applies the pixel preset at 1 px, full opacity/flow, square hard edges and no pressure-driven size or opacity. Existing painting preferences remain saved separately. Pencil, Eraser, Fill, Eyedropper, Line, Rectangle, Ellipse and Selection are labeled; X/Y mirror toggles live with pixel tool settings. Reuse existing tools and add pixel coverage only where needed. Fast strokes must fill intervening pixels; shapes and selection moves preview before committing.

Initialize the complete Animate tool profile on New sprite animation or an accepted static-to-animation conversion, rather than only changing the brush preset. Store subsequent animation tool preferences separately from ordinary painting preferences. Reopening an animation restores its animation profile with these defaults for missing fields; reopening a static painting restores the ordinary profile. Switching Paint/Animate within the same animated document or changing Paint/Studio presentation preserves the current tool and its settings. Artwork colors are document choices, never derived from a changed OS accent.

| Pixel tool | Initial Animate behavior | Observable result |
| --- | --- | --- |
| Pencil | Pixel preset, 1 px square, opaque source-over, full flow, hardness 1; size/opacity/flow pressure and tilt modulation off; integer coordinates and connected stroke coverage | Each covered pixel has the chosen color, without partially covered edge pixels |
| Eraser | Transparent erase, 1 px square, full removal, hard coverage; background-color erase and pressure modulation off | A click makes one source pixel fully transparent, regardless of the prior ordinary Paint eraser mode |
| Fill | `fillAntiAlias: false`, tolerance 0, contiguous four-connected region, growth 0, opacity 1, sample only the current drawing's source RGBA; respect the active binary selection | Filling a closed pencil outline changes only exactly matching interior pixels; diagonally touching regions stay separate and outside pixels gain no fringe |
| Eyedropper | 1×1 pixel, current drawing source (`current-layer`) before live effects; exclude onion/grid/checker/selection overlays. The source selector visibly says “This drawing”; “Visible artwork” is an explicit alternative using the current frame's derived composite | Sampling a filled pixel returns its original RGB; a fully transparent pixel reports “Transparent pixel” and leaves the selected drawing color unchanged |
| Line / Rectangle / Ellipse | 1 px solid outline, foreground color, no fill initially, opacity 1, integer geometry and binary pixel coverage; optional solid fill also has no antialiasing | Shapes add only solid colored or untouched pixels; preview and committed pixels agree |
| Selection / move | Rectangular selection initially, antialiasing off, feather 0, no implicit growth; integer move and nearest-neighbor scaling; binary masks for other exposed selection shapes | Moving a selected mark preserves its pixel colors/alpha without blur; fractional transforms require an explicit non-pixel option |
| Zoom | Largest integer enlargement fitting the new sprite, with 1×/2×/4×/8× controls and source dimensions labeled separately; nearest sampling at all scales | A 32×32 sprite still says “32×32 px” when enlarged; a smaller-than-source viewport can use an explicitly labeled fit-down view |

The GPU paths must honor these settings too; nearest viewport sampling cannot correct antialiased source pixels. These defaults extend the owners in `core/constants.js`, `tools/dispatcher.js`, the fill/shape/selection engines and `gpu/raster/gpuPaintSurface.js`. Existing ordinary Paint settings such as `fillAntiAlias: true` are retained in its separate profile.

Palette swatches show color names/hex values and a selected indicator beyond color. Reuse `panels/color/colorPicker.js` and the existing saved recent colors; add a small original starter palette and an ordered project palette of named hex colors. Add/remove/rename/reorder palette entries through the Palette popover; project palette changes use Undo. Import/export a versioned JSON color list with bounds/hex validation, preview and an explicit Replace palette action. Palette changes choose drawing colors; they do not silently recolor existing RGBA pixels or force an indexed document model.

There is no save prompt for the untouched bootstrap canvas. Replacing real work uses the existing Cancel / Discard changes / Save first decision, centered over the owning Paint window with focus trapped and returned. Save failure or cancellation leaves the original project and New draft intact. A single click after editing a field must still activate Create.

### Frame strip and advanced timeline

The default workspace uses the compact tool rail, canvas, existing Layers area and a shallow frame strip. Its first row has **Play/Pause, Previous, Next, Duplicate frame, Blank frame, Onion skin, Speed and Timeline**. Frames show a thumbnail, number and duration; the selected frame has a border and accessible state. “Frame 2 of 8 · Character” stays visible near the canvas. Horizontal scrolling belongs to the strip, never the whole page.

The **Timeline** toggle expands the same frame controller into Layers × Frames. The layer column reuses the existing layer renderer and replaces the ordinary layer list while expanded; there are not two independently selected layer lists. Properties remains available. Collapse restores the previous Layers layout, focus and scroll positions. Named clips and per-frame timing are available from the expanded timeline and **Edit → Animation**; basic drawing never depends on this expansion. Keep the seven top-level menus File, Edit, Layer, Effects, View, Studio and Help.

| Action | Exact scope and feedback |
| --- | --- |
| Duplicate frame | Insert after the current frame; copy every layer's drawing and duration; select the new frame. Later drawing changes affect only the duplicate |
| Blank frame | Insert an empty frame for all layers; retain layer definitions, choose the same active layer and select the new frame |
| Clear drawing | Clear only the selected layer in the current frame. The advanced cell menu calls this “Clear drawing on this frame” |
| Delete frame | Remove that frame across all layers, including its timing. Select the next surviving frame, or previous at the end. Keep at least one frame; offer Clear frame for the last frame |
| Reorder frame | Move the whole frame across all layers. Pointer drag and labeled Move earlier/later commands are equivalent |
| Add layer | Add one empty drawing on the current frame; every other frame is explicitly blank on that layer |
| Duplicate layer | Copy that layer's drawings across all frames; edits become independent. Label the scope before execution in the layer menu |
| Layer visibility, opacity, lock, blend and live effects | Apply to that layer across the animation. Properties/Effects says “All frames on this layer” |
| Painting, fill, selection move, clear and bake recipe | Affect only the current layer's drawing in the current frame. Destructive recipe action says “Bake recipe into this drawing”; selection/channel semantics remain intact |
| Crop/resize canvas | Affect all frames; show dimensions, anchor and a current-frame preview before one undoable commit |
| Merge layers / flatten | Process every frame consistently, with scope shown in the confirmation preview; never flatten only the active frame and lose the rest |

Every document mutation is one existing Undo transaction per gesture or command. Undo/Redo returns to the affected frame and layer before showing its result; frame reordering cannot redirect a stroke to a different cel. Layer locks prevent pixel edits and destructive layer/cel actions. Duplicate/Blank/Reorder frame preserve locked pixels and include all layers. Delete/Clear frame is unavailable when it would remove a nonblank drawing from a locked layer; name that layer and offer its Unlock control. Other all-frame destructive commands follow the same rule. A frame structural command is atomic; do not partially mutate unlocked layers and omit locked ones.

Selections belong to a frame/layer target. Switching targets hides that target's selection and restores the destination's own selection. A floating paste or uncommitted transform requires **Apply here / Discard preview / Stay** before switching; Escape discards only the preview. Active pointer gestures finish before requested mode/workspace/frame transitions. Opening a menu does not change the edit target.

### Playback, timing and preview

Play starts at the selected frame; Pause selects the currently displayed frame for editing. Previous/Next pause and select precisely one frame. A canvas pointer-down while playing pauses on the visible frame but does not also draw; the next gesture draws. An unobtrusive hint explains “Paused on frame 3. Draw to change it.” This avoids accidental marks on a moving target.

Playback uses elapsed monotonic time, accumulated durations and the admitted GPU frame queue, not a fixed interval increment. It skips overdue displays instead of slowing the animation; it never skips document frames during export. Hidden/minimized/suspended workspaces pause and retain their position; resume is explicit, so returning does not jump ahead. Switching away from Animate pauses. Playback itself never dirties a document or creates history.

**Speed** displays default FPS, 1–60, initially 8. Frames normally inherit `1000 / FPS` milliseconds. Advanced **Duration** sets an explicit override from 20–60,000 ms with a “Use default speed” reset. Changing Speed updates inheriting frames only and reports “6 frames use this speed; 2 have custom timing.” “Use this speed for all frames” removes overrides as one undoable action. Export stores resolved milliseconds; fractional precision remains internal until the target format requires rounding.

Named clips use a name and an explicit ordered list of stable frame IDs, initialized from the selected range. Reordering timeline frames updates clip order to timeline order; insertion inside a clip's span joins it, insertion outside does not. Deleting frames removes them from clips; empty clips are removed in the same Undo entry. Export and playback default to **Whole animation**. Choosing a clip visibly names it in both the transport and export range; no invisible stale selection determines export.

Resolve range and edit target together through the central transition controller:

| Transition | Range, target and feedback |
| --- | --- |
| Choose a clip | Pause; keep the selected frame if it belongs to the clip, otherwise select its first frame. Run the existing Apply here / Discard preview / Stay guard before moving; Stay leaves both range and frame unchanged |
| Play | Start at the selected member and loop through the active range in timeline order. If restoration supplies an outside/invalid edit target, resolve to the range's first valid frame using the same guard before starting |
| Previous / Next | Pause and step within the resolved active range, clamping at its ends; disable the unavailable direction with an accessible reason. Stepping does not wrap even though Play loops |
| Click or keyboard-select a frame outside the clip | Pause, change the range to Whole animation and select the requested frame after the target guard. Show “Whole animation · Frame N”; update both export-format ranges and invalidate their pending previews |
| Delete the selected clip or its last member | Fall back visibly to Whole animation. Retain the current frame if it survives; otherwise select the next surviving frame or the previous at the end. Invalidate any export preview for the deleted range and require a new review before Download |
| Undo/Redo targets a frame outside the active clip | Restore the affected valid frame/layer, pause, and show Whole animation. Playback/range preferences themselves do not create extra Undo entries |

For frames A/B/C/D with A selected, choosing clip B/C visibly selects B. Play shows B then C; Previous at B and Next at C are unavailable. Selecting A returns to Whole animation, so the next Play and both exporters use A/B/C/D. Deleting active clip B/C leaves the valid edit frame selected and reports Whole animation; deleting both member frames selects the next survivor and does the same. These transitions cancel stale export jobs rather than silently downloading a different range. Exporters consume one resolved ordered list of frame IDs captured with the reviewed revision.

**Onion skin** has a plain-language hint, “See the previous and next drawings while you edit.” Start with one previous and one next frame, visible-layer composite, with separate opacity controls in its popover. Color tints are optional and have “Previous”/“Next” labels. No wrapping across the animation ends by default. Hide onions during playback and exclude them from eyedropper source pixels, effects, thumbnails, saves and exports.

The editor offers a small **Preview** showing native 1× size, integer enlargement and checker/light/dark backgrounds. These backgrounds are explicitly “Preview background”; they do not change export transparency. One transport controls canvas and Preview. If there is no room, Preview opens as a bounded floating dialog using the existing owner/focus rules. The main canvas remains visible while adjusting animation settings.

### WebOS appearance and compact behavior

Use the current typography, surface, border, accent, focus, high-contrast and reduced-motion tokens. The title remains **Paint Studio**, with Paint and Studio as the horizontal switch. Icon-only compact controls keep tooltips and accessible labels. New Settings, Effects and Filters destinations remain floating dialogs as requested, not dock panels.

Wide fine-pointer layouts retain the existing 56 px Paint tool rail or Studio tools and 312 px inspector. The initial frame strip is 112 px high; its resizable expanded timeline starts at 25% of usable height. Timeline resizing has a keyboard-operable divider and always leaves at least half the usable workspace for the canvas. Below 1120 px width or 600 px height, use compact desktop behavior for fine pointers, not phone navigation.

Coarse-pointer layouts keep 44 px targets and a single contextual sheet. In portrait, the frame/settings sheet occupies at most half the workspace; in landscape use a side sheet. The compact transport and selected frame remain reachable when the sheet closes. Preview replaces the contextual sheet while open rather than stacking another obstruction. Timeline/inspector proportions and expansion state are saved per presentation and footprint class. Manual zoom/pan survives resize; fit recalculates only in fit mode. Keep F for canvas-only focus and Shift+F for panel visibility; an animation cannot become inaccessible because its timeline is hidden (View → Timeline always restores it).

Use a keyboard grid for the advanced timeline and roving focus for the strip. Arrows move frame focus, Enter selects, and Shift extends a contiguous frame selection only in the timeline. Editable names/numbers retain their arrow behavior. Space on the focused transport toggles Play; preserve the canvas's existing Space/pan behavior. Expose all commands through menus without requiring new global shortcuts. Announce committed changes and errors, not each playback frame, coordinate or slider sample. Reduced motion disables automatic preview playback; all animation requires explicit Play.

In the advanced grid, Left/Right moves focus between frame columns, Up/Down between layer rows, Home/End to the row's first/last frame. Focus movement alone does not change the editing target; Enter selects that frame/layer and applies the target guard. Shift+Left/Right extends the contiguous whole-frame selection from its anchor without changing the active drawing; Escape clears this range selection before leaving the grid. Labeled Move earlier/later buttons reorder the selected frame block. Grid handling precedes the global Move-tool arrow shortcut only when a grid cell has focus; text/number controls always keep their own keys. Collapse returns focus to the selected frame in the strip.

The proposed layout hierarchy is the same across four footprint/input states:

| Layout | Main view | Controls without obstructing drawing |
| --- | --- | --- |
| Wide desktop | Title/menus and common actions; tools + canvas + Layers/Properties; frame strip | Transport and Duplicate remain visible; Timeline expands into the layer/frame grid; Preview is a small native-size view |
| Compact desktop | Title/workspace dropdown; compact tools + canvas; frame strip | Play, Previous/Next and Duplicate stay visible. Blank/Onion/Speed/Timeline appear under one labeled Frame tools button in the contextual drawer |
| Portrait touch | Title/workspace dropdown; canvas; compact transport | Frames opens a sheet capped at half the workspace, with Layers/Frames/Properties tabs. Preview or Learn replaces this sheet rather than stacking over it |
| Landscape touch | Title/workspace dropdown; canvas + one side sheet | Transport remains outside the sheet; Frames/Layers/Properties share it. A visible close control and Escape return focus |

For keyboard drawing, expose **Keyboard drawing** in the canvas context controls. In that explicit mode, arrows move a visible integer pixel cursor, Shift moves 10 px, Enter stamps with Pencil/Eraser or applies Fill, and Escape exits this cursor mode. Announce the cursor position only on keyboard request/committed edits; X/Y fields give precise access. Outside that mode existing arrow/nudge behavior remains. This provides a way to complete the first-animation exercise without a pointer rather than claiming toolbar access alone makes drawing accessible.

## Learning and recovery

Add **Make your first animation** to the existing Learn dialog. It launches an original, tiny blinking-face practice project through the same New/replacement flow; it never draws into existing work. Users can also choose “Use my current animation.” Both paths clearly name the current practice/project target.

The six steps are: (1) create and draw, (2) duplicate, (3) turn on onion skin and change a drawing, (4) play and adjust speed, (5) export **both** delivery formats, (6) save the editable project and reopen it. Each step highlights a real control, explains one concept in one sentence and provides **Show me**, **Try it**, Back, Next and Skip. “Try it” performs the ordinary command only after the user's click. It does not mark a task complete just because the destination opened.

Lesson 5 contains two separately tracked subgoals, completable in either order:

| Subgoal | Real destination and expected result | Progress evidence |
| --- | --- | --- |
| Animated GIF | Export → Animated GIF; inspect the converted colors/background, then Play the encoded two-pose loop and Download | Encoded preview ready is “Prepared”; browser handoff is “Download started”; a successful writable-file completion is “File saved”. Preparation alone does not complete delivery. Offer Open downloaded GIF for independent visual confirmation |
| Game sprite sheet (PNG + JSON ZIP) | Export → Game sprite sheet; two 32×32 frames at default horizontal 1× produce a 64×32 PNG, plus matching two-frame metadata inside the ZIP | Track this format's preparation and delivery separately with the same truthful status wording. Offer Open exported sheet, reusing the ZIP/grid import preview, to see both frame rectangles and timing |

Delivering only one format leaves the other visibly incomplete. A browser download-start event satisfies the **download action**, never a claim that receipt on disk was verified. Lesson 6 requires the user to select and successfully reopen the native project; exported images cannot satisfy it.

Completion derives from actual project events: creation, changed pixels, duplicate operation, changed second frame, playback, the two separately identified delivery actions and native save/reopen. Bind these events to the lesson's document ID, stable source/duplicate frame IDs and the captured export revision/frame list. A successful export from another project does not advance this lesson. Editing after delivery retains an honestly dated “Exported earlier version” state; it does not claim the latest art was exported. A “Continue without completing” option is explicit. Progress and the selected lesson persist as preferences; restarting a lesson does not reset artwork. The guide is dismissible, resumes through Learn, and never covers its highlighted control. Keyboard users receive the same destination and focus return.

If a required frame/layer is deleted or another project replaces the lesson target, stop automatic advancement and show “This lesson's drawing is no longer available” with **Resume with this project**, **Start a new practice copy**, and **Continue without completing**. Resume previews the current project/frame assignment and asks the learner to select its source frame; it rebinds stable IDs and marks dependent duplicate/drawing/export/reopen goals incomplete until performed for the new target. Starting a practice copy uses the existing New/save/replacement guard and resets only this lesson's progress after successful candidate creation. Cancel/failed creation retains the old artwork and progress. If Undo restores the original target, offer Resume original lesson after validating its IDs; never silently redirect a lesson edit to a similarly numbered frame. A wholly different current project is named explicitly before Resume.

The guide includes short, actionable recovery hints beside the relevant step:

| Symptom | Hint and destination |
| --- | --- |
| Second frame looks unchanged / animation does not move | “Select Frame 2 and change its drawing; duplicated frames start identical.” Show Frame 2, or the missing-target repair choices if it was deleted |
| Nothing paints | Show the active layer/frame and lock state; “Unlock Character to draw” opens its lock control. If a selection excludes the cursor, offer Show selection / Deselect |
| Both frames appear changed | “Select each numbered frame to compare. Layer effects apply to every frame.” Show source-frame inspection and the labeled effect scope; an actual duplicate-edit leak fails acceptance |
| GIF colors or background changed | “GIF uses a smaller color palette and simpler transparency.” Open the actual GIF Inspect frames and background/dithering controls |
| Saved only an image | “Images share the result. Save a Paint project to keep frames and layers editable.” Open Save project, then the native-file reopen step |

Always distinguish **Saved in this browser** from **Project file saved**. A successful writable-file completion acknowledges only its captured revision; newer edits remain unsaved. With a browser download fallback, say **Project download started**, because receipt on disk is not observable; lesson completion requires selecting and reopening the file. Save/export failure leaves editing and retry available. Recovered projects show frame count, project name and timestamp before replacement. Failed GPU reconstruction keeps the saved candidate and current project until retry succeeds. New, Open, import and lesson creation share this recovery/replace flow; no second save system or competing modal is introduced.

## Document, history and renderer contracts

Introduce a proposed `document/animationModel.js` as a document extension, not a second application store. Keep existing document ID, dimensions, layer hierarchy and active layer. Add optional animation data with stable frame IDs, default FPS, per-frame duration overrides, clips and a sparse map from `(layerId, frameId)` to a cel reference or explicit blank. A cel is the editable drawing at that intersection. Frame IDs survive reorder; numeric positions are presentation only.

Layer metadata, masks and live-effect stacks are shared across frames in the first release. Raster pixels and per-drawing integer offsets belong to cels. Groups keep the existing hierarchy/compositing contract. Cel references can share immutable storage after duplication; the first edit takes an independent copy. Blank cels allocate no full-size bitmap. Explicit editable links between cels are out of scope, so ordinary Duplicate cannot modify another frame.

The active-frame adapter exposes the current cels to existing tools, while all-frame operations iterate through the animation model. Snapshot/restore, history entries, GPU journal records, effect cache keys, thumbnail jobs and asynchronous readbacks must include document generation and cel identity. Reordered/deleted frames or replaced projects reject stale completions. Undo retains only changed tiles/cel references and necessary metadata, using the existing history owner; never snapshot every frame for a pencil stroke.

Use one frame compositor for editor playback, preview, thumbnails and exports, including the existing group, clipping, mask and whole-layer effect behavior. Parameter changes invalidate affected frames; offscreen composites render lazily. Onion/selection/grid/cursor/guide overlays are a separate presentation pass. Keep source pixels distinct from derived effects and preserve the 24-effect limit. All frame replay, drawing and readback stay inside the existing admitted GPU ownership/lifecycle boundaries.

Memory admission estimates unique pixel data, Undo, active/neighbor GPU textures, cached composites and export buffers before allocation. Use sparse blank cels, copy-on-write storage, bounded caches and cancellation with cleanup. Initial tested target: 128×128, 100 frames, 8 raster layers; a 32×32, 8-frame, 2-layer project is the minimum complete acceptance fixture. These are test workloads, not claims of unlimited capacity. Provisional new-project bounds are 1–512 px per side, 1–100 frames and 1–30 layers, additionally constrained by a conservative measured resource budget. Show the exact offending limit with “Reduce dimensions,” “Export fewer frames” or “Save a copy”; never silently reduce resolution, delete frames or discard Undo to fit.

Static projects remain static until an explicit animation-creation command. Selecting Animate on a static document shows **Animate this painting** and **New sprite animation** with a preview. The first creates a separate animation candidate from supported raster/group content using the existing replacement/save decision; Cancel preserves the current project. For vector, surface, material or particle content, offer **Use rendered image as frame 1** with an explicit flattening explanation and preview. Keep the source project intact until the candidate is fully ready. Do not reinterpret the existing 1024×1024 sheet preset as multiple frames.

Within an animated project, the Paint workspace edits the selected drawing and shows frame context. Existing unsupported Vector/Surface/Materials/Particles creation commands show an adjacent reason and a **New painting** route; they must not silently create animated data the renderer cannot handle. Existing static documents retain all their authoring capabilities.

Use new native schema identifiers for animation: proposed `webgpu-os.paintscene.v4`, `webgpu-os.paintpkg.v2`, `webgpu-os.paintautosave.v2` and document v6. Keep the `.paintscene` extension. New readers accept all currently supported static versions and migrate without adding extra frames. Static-only saves retain the existing interoperable format when no new data is required. Older strict readers must reject animated files rather than open only frame 1. Package frames, cels, clips, palettes, timing and required raster/GPU recovery data; selection and active-frame editing context restore consistently. Browser autosave and explicit project files use the same encoding contract. Reject invalid references, cycles, dimensions, counts, lengths and non-finite timings before creating GPU resources.

## Game sprites and GIF delivery

The existing Export dialog adds two plain-language choices: **Game sprite sheet** and **Animated GIF**. Both show range/clip, dimensions, duration, transparency, estimated then actual byte size, and the actual export preview. PNG current frame remains available. Export uses an immutable revision: document edits invalidate pending previews, cancel obsolete jobs and require a fresh preview before Download. A completed download uses precisely the reviewed bytes and reports its revision; no stale preview can accompany newer content.

### Sprite sheet and import

Default to an untrimmed, unrotated horizontal strip (columns = exported frame count), integer scale 1×, 0 px padding, all visible layers and the whole animation. If the resulting sheet exceeds admitted image dimensions, show a proposed multirow layout with updated dimensions and require the user to review it; never silently rearrange the output. Advanced controls offer row/column layout, integer scale and padding with a visible cell-boundary preview. Empty frames occupy cells. Do not auto-trim frames and make sprites wobble around a moving origin.

Download one ZIP containing PNG and JSON, plus optional separate PNG/JSON downloads. Reuse `webgpu-os/packages/Zip.js` and verify the result independently with Python `zipfile`; no editor exporter rewrite is needed. Use fixed ASCII archive entry names (`sprite.png`, `sprite.json`) while the outer ZIP and JSON project name retain the user's name. The proposed versioned JSON contains image name and dimensions, source frame size, ordered frame IDs/rectangles, durations in milliseconds, clip names/frame IDs and a consistent center pivot in source pixels. The pivot is `(width / 2, height / 2)` measured from the top-left pixel edge; never infer it from opaque pixels. This is Paint's format, not a claim of universal engine compatibility.

Import accepts an image plus matching Paint JSON or a manually specified grid. Show frame count/order, source rectangles, dimensions, padding/offset and animated preview before **Import as animation**. Allow frame-count override so trailing empty grid cells are not automatically treated as content. Sheet pixels are flattened into one layer; original separate layers survive only in the project file. Import is a new candidate and follows the same safe replacement route. Validate mismatched sizes, out-of-bounds rectangles and invalid timing without changing the current project.

Paint JSON records export scale and source frame dimensions separately from sheet-pixel rectangles. Reimport defaults to original source dimensions when metadata proves an exact integer scale, sampling nearest; **Keep exported size** is an explicit alternative shown in the preview. A sheet without metadata keeps its chosen cell dimensions rather than guessing its original resolution. Export includes only clips intersecting the exported frame IDs and removes references to unexported frames; omit empty clips. Imported clip membership cannot point outside the imported frame list.

First-release verification includes reopening this exact exported sheet/JSON in Paint and rendering it through a small engine acceptance fixture using exported rectangles and timing. A general game-editor importer is not present in the reviewed code and is not silently assumed; an engine-wide asset UI is a separately scoped integration.

### GIF encoding and preview

Implement a bounded module-worker encoder in proposed `io/animation/`, using browser ES modules and in-tree code. No npm, Preact/Rollup replacement or borrowed SpritePaint implementation is required. Do not implement GIF by requesting an unsupported canvas MIME type: canvas encoding can fall back to PNG. [Canvas `toBlob` behavior](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)

The GIF codec milestone must implement palette quantization, indexed transparency, frame disposal, LZW, frame delays and looping, with fixtures decoded independently. GIF stores delays in hundredths of a second and uses color tables and a transparent index; its color and alpha representation is not PNG RGBA. [GIF89a specification](https://www.w3.org/Graphics/GIF/spec-gif89a.txt)

Default to whole animation, Loop, integer enlargement and no dithering for crisp sprites. Use a stable palette across the selected clip; offer dithering and background fill in Advanced. Preserve binary transparency for pixel art. If partial alpha is present, show **Transparent edges** or **Solid background** with the actual converted result; never imply exact RGBA fidelity. Quantize cumulative frame boundaries to GIF ticks to avoid accumulating timing error, report adjusted durations, and test browser playback at fast rates where viewers can differ. Frame export is never driven by screen-capture timing.

The export preview has two explicit states: **Animation** plays the actual encoded GIF Blob, and **Inspect frames** shows the encoder's exact palette/disposal-resolved output frames with actual encoded timings and Previous/Next. Pause switches to Inspect frames; Play restarts the encoded animation from frame 1. Decode fixtures independently to prove inspection pixels match the downloaded file. Reduced motion opens Inspect frames. This avoids promising a precise arbitrary seek/pause operation on a native animated image.

Encoding shows completed frames and Cancel. Canceled, failed, stale and closed-dialog jobs release workers, textures, readbacks and object URLs; Retry preserves settings. No network upload is needed. A failed GIF codec gate means GIF remains unreleased and the whole two-output release is not accepted; a PNG-only result does not satisfy the user's chosen scope.

## Implementation sequence

Each piece is a bounded milestone; future implementation should take a scoped baseline and preserve concurrent edits. Existing operation logging receives frame/cel IDs and timings, while user feedback stays artist-facing. Rollback means reverting only the implementation's owned changes or disabling the unreleased workspace without modifying saved projects.

1. **[MODIFY + NEW] Document foundation.** Add sparse animation data, exact command scopes, validation and format migrations to document/history/project owners. Build save/reopen, blank/duplicate and legacy fixtures before enabling UI.
2. **[MODIFY] Raster integration.** Adapt active cel resources, journal/replay, pixel tools, selection ownership, effects and all-frame operations. Prove exact GPU pixels, independent duplicate edits, one-step Undo and safe recovery.
3. **[NEW + REUSE] Timing and compositor.** Add frame lookup/playback, shared frame rendering, cache invalidation and bounded jobs. Reuse pure time helpers and GPU lifecycle ownership; prove paused/edit/export parity.
4. **[MODIFY + NEW] Animate UI.** Add New presets, workspace registration, frame strip, expanded timeline, named clips, scope labels and compact/touch layouts. Retain Paint/Studio and existing floating dialogs.
5. **[MODIFY + NEW] Game export/import.** Extend the existing Export dialog, sheet/JSON contract and grid import preview. Reuse the OS ZIP primitive and verify exported entries/CRC independently.
6. **[NEW + REUSE] GIF delivery.** Implement/validate the worker codec, format-specific preview and cancellation through the existing file UI. Cross-decode output in Python and browsers.
7. **[MODIFY] Learn and feedback.** Add the practice project, six event-backed lessons, contextual help, clear save/recovery states and accessible keyboard/focus behavior.
8. **[VALIDATE + DOCUMENT] Release review.** Run current Paint/shared Vector coverage plus animation suites, real pointer workflows and performance comparisons. Re-review every category, fix blockers, then update documentation and discovery/viewer artifacts.

## Validation and acceptance gate

All items below are **future implementation checks**, not results of this planning pass.

| Area | Required observable evidence |
| --- | --- |
| First success | From a fresh start, create 32×32, draw at 1 px, exact-fill the interior, erase one pixel to transparency and sample a source color with no blended fringe; duplicate, alter only frame 2, toggle onion skin, play, download GIF and sheet/JSON, save and reopen the editable project |
| Complete project | 32×32, 8 frames, 2 layers, one blank frame, custom durations and two clips; project round-trip preserves pixels/layers/IDs/timing/effects/palette; sheet import preserves composited pixels/frame order/durations |
| Command scope | Stroke, selection, fill, bake, clear, duplicate/delete/reorder, layer operations and all-frame resize each target exactly their labeled scope and Undo/Redo restores pixels and frame context |
| Rendering | Real GPU readback matches source/derived pixels; no onion, grid, guide, checker or selection overlay leaks into exports; preview and exported composites agree |
| Playback | Delayed frames, variable durations, the A/B/C/D outside-clip scenario, active-clip deletion, clamped stepping, pause-on-edit, visibility/suspend/resume and manual scrubbing behave deterministically; playback leaves history and dirty state unchanged |
| Numbers | Shared slider/number/reset behavior for FPS, durations, onion opacity, scale and grid import; Enter/blur/Escape, invalid drafts, clamping and no interrupted typing |
| Persistence | Static formats remain readable; animated files reject partial/invalid loads; interrupted save, canceled replacement, reload, GPU loss and retry never destroy the last valid project |
| GIF | Independently decoded transparency, disposal, blank frames, repeated frames, colors, loop and timing; palette/no-dither exactness for an in-palette fixture; quantized preview matches decoded bytes; cancellation and stale jobs clean up |
| Sheets | ZIP CRC/content verified with Python; JSON rectangles, counts, padding, scale, blank frames, pivot and timing verified; exact sheet/metadata consumed by Paint import and an engine acceptance fixture |
| Responsive | Existing eight sizes: 1280×720, 1366×768, 1920×1080, 796×511, 820×1180, 1180×820, 390×844, 844×390; both pointer types and both presentations, 32 cases. Reachable commands, visible canvas, no page overflow |
| Accessibility | Keyboard frame selection/reorder, layer navigation, names/numbers, dialog focus return and a first-animation workflow; light/dark accents, high contrast, reduced motion and 44 px touch targets |
| Learn | GIF-only delivery leaves sheet incomplete and vice versa; prepared/download-started/writable-file states remain distinct. Deleted/replaced targets expose the specified rebind/new-practice/skip choices, without advancing another project's progress; canceled repair preserves art/progress. Exercise native save/reopen, skip/restart/resume and failed output jobs |
| Performance | Same host/browser/GPU, three warm runs before/after: static Paint brush/effect/resize regression within 10%; 128×128/100-frame/8-layer animation; p95 input handler under 8 ms, edit-to-preview under 100 ms, no animation-owned main-thread task above 50 ms in steady editing/playback. Record cold shader/codec startup separately; memory reaches a bounded plateau across ten open/play/export/cancel/close cycles |
| Existing coverage | Extend `tests/paint-usability.js`, `paint-ux-redesign.js`, `paint-clean-room-regressions.js`, recovery and shared Vector suites; new animation document/GPU/export tests use actual modules rather than mirrored fake implementations |

Do not claim a reference product's maximum dimensions × layers × frames are safe simultaneously. Publish measured resource limits with the release. Full WebOS account/launch/lifecycle verification stays a distinct gate; the previous unrelated operator-drain fixture failure and account prerequisites do not disappear because an isolated Paint host passes.

Independent review uses a fixed rubric: **core ease 30%, navigation 20%, training 20%, preview/feedback 20%, recovery/accessibility 10%**. Require the weighted score **and every individual category to reach at least 8/10**, with no blocking data-loss, first-project or output-preview defect. Report scores without rounding a failing category upward.

For this planning pass, the reviewer scores the concrete proposed workflows and acceptance criteria. During implementation, score again against the running app, pointer/keyboard evidence, real files and measured results. A design review is not a novice study: a subsequent first-time-user check should recruit at least five users, aim for four to finish the core two-frame workflow without facilitator rescue within ten minutes, and record their ease ratings separately.

## Design review status

**Independent design review accepted on September 8, 2026: 10.00/10 on the fixed 25-checkpoint checklist.** Every category exceeds the required 8/10. This means all written-design checkpoints are specified; it is not a measured ease rating, a prediction of perfect usability or an implementation/test result.

| Category | Weight | Initial score | Final design score |
| --- | ---: | ---: | ---: |
| Core ease | 30% | 7 | 10 |
| Navigation | 20% | 9 | 10 |
| Training | 20% | 7 | 10 |
| Preview and feedback | 20% | 7 | 10 |
| Recovery and accessibility | 10% | 7 | 10 |
| Weighted total | 100% | **7.40** | **10.00** |

Independent reviewer Avicenna withheld acceptance at 7.40 because the other pixel tools could inherit antialiasing/background erasing, clip selection had unresolved playback targets, and the guide treated the two exports as alternatives. Revision 2 defines the complete tool profile, deterministic clip/target transitions, independently tracked delivery goals and missing-target repair. All three blockers closed. Grid-key ownership and sheet layout/reimport details were also resolved.

The unchanged rubric assigns 0/1/2 points to each of five checkpoints per category. All 25 now receive 2; future running-app evidence must be reviewed separately rather than inheriting this checklist score. Full score history, source observations and walkthroughs are recorded in `tmp/paint-sprite-animation-plan-review-20260908.md`, iteration 2. The reviewed proposal before this acceptance note has SHA-256 `bd02375f58101e42c69ac45f3e54016e854952b500e57572b3dd6bed06950049`. No application or test implementation was performed in this planning pass.

## See also

- [Paint Studio audit and implemented usability improvements](paint-studio-improvement-plan.md)
- [WebGPU OS overview](overview.md)
