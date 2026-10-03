---
title: Paint Studio Audit and Improvement Plan
description: Evidence-led UI, UX, reliability, and workflow improvements informed by Graphite.
updated: 2026-09-08
SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
---

# Paint Studio Audit and Improvement Plan

This document records the Paint Studio audit, the agreed improvement plan, and implementation verified on September 5–8, 2026. The user authorized the clean-room implementation after reviewing the initial plan. The changes use Paint's own document model, filter kernels, GPU ownership, and UI modules. Graphite supplied workflow references; no Graphite implementation, assets, branding, or dependencies were imported.

The implemented direction improves the existing Paint Studio and retains its raster, surface, material, and particle workflows. The September 6 redesign integrates the concurrently added shared vector workspace through its existing controller. Multiple-document sessions remain a conditional expansion.

The separate [sprite and animation upgrade record](paint-sprite-animation-plan.md) documents the implemented Animate workspace for game sprite sheets and shareable GIF loops, its real-GPU validation, and its separate review gate. The earlier Paint score on this page does not establish animation acceptance.

## Beginner usability improvements implemented September 8

The everyday Paint path now exposes **New, Undo, Redo, Save, Export and Learn** beside the document. Brush presets have a named launcher and tools have visible labels. Studio's tool grid adapts to the available width without overlapping labels. The existing Paint / Studio title switch, six workspaces, floating Settings/Effects/Filters and live WebOS appearance remain. Sources below are relative to `webgpu-os/factory/apps/paint/` unless otherwise noted.

| User task | Implemented behavior | Source owners |
| --- | --- | --- |
| Learn the basics | Six short lessons explain canvas creation, brushes, Undo, layers, effects and saving. Each opens real controls. Previous/Next and the lesson picker retain keyboard focus; progress persists as a UI preference. The last lesson separates editable Save from image Export. | `panels/help/learnPanel.js`, `app/commands.js`, `ui/workspace/workspaceState.js` |
| Create a canvas | New shows an aspect/transparency preview and preset dimensions. Advanced options start collapsed. Numeric/name drafts remain editable; commits update the preview without replacing the next field or the clicked button. An untouched bootstrap canvas no longer prompts to save nonexistent edits. Actual artwork still receives the existing replacement decision. | `panels/startup/panelsStartup.js`, `app/PaintApp.js`, `app/shortcuts.js` |
| Recover an edit | Common Undo/Redo follows the active Paint or Vector editor and accurately exposes availability. Vector uses the existing HistoryService and shared editor; its common export action produces SVG. | `app/vectorWorkspace.js`, `app/PaintApp.js`, `panels/panels.js` |
| Compare effects | The floating Effects dialog names the current Original/Effects preview above the stack. Editing, closing or leaving its target restores live effects. Workspace, tool and authoring changes validate comparison before rendering, including routes that assign a target directly. Comparison itself adds no history. | `panels/layers/layerEffects.js`, `panels/studio/floatingDialog.js`, `ui/workspace/workspaceState.js`, `app/PaintApp.js` |
| Preview an export | Export automatically produces the actual encoded image and byte count. Image changes invalidate stale previews immediately and coalesce refreshes. Encoding updates only preview controls, so a focused quality slider survives completion. Filename-only edits preserve the image; errors expose Retry. | `panels/file/fileDialog.js`, `io/fileFormats.js`, `app/PaintApp.js` |
| Work in a small window | Common actions wrap and remain available on compact mouse and touch layouts. Learn uses the existing floating-dialog bounds, keeps 44 px touch controls and leaves part of the canvas visible. Existing light/dark, accent, high-contrast and reduced-motion tokens remain authoritative. | `app/shell.js`, `ui/theme/redesignStyles.js`, `panels/studio/studioDialog.js` |

The guide is an action-linked reference, with saved lesson position. It does not claim to detect task completion or supply a practice sandbox. Some narrow tool labels still truncate; advanced authoring features require further learning.

### September 8 verification and review

**Final independent score: 8.00/10; acceptance met for the reviewed UI/UX scope.** Core ease, navigation, training, preview/feedback and recovery/accessibility each score 8.0. The reviewer closed B1/B2 and R1–R4 after the completed final usability, production, redesign and seven-group typed-recovery results. Earlier 5.75, 7.75 and 7.90 assessments remain in the review history; no score was rounded up for acceptance.

An independent subagent assessed the unchanged rubric: core ease 30%, navigation 20%, training 20%, preview/feedback 20%, recovery/accessibility 10%. Acceptance requires overall 8/10 and at least 8 in core ease, training and previews. The baseline scored **5.75/10**. The second review scored **7.75/10** and withheld acceptance for two concrete defects: New-field blur could replace the button being clicked, and workspace/tool changes could leave Original comparison active after its controls disappeared. Both routes were corrected and directly exercised before final review. Scorecards and the verification record are in `tmp/paint-usability-review-baseline-20260908.md`, `tmp/paint-usability-review-final-20260908.md` and `tmp/paint-usability-verification-20260908.json`.

The new `tests/paint-usability.html` exercises real GPU output, source preservation, automatic encoded previews, stale completion rejection, preview retry, draft/action identity, lesson routes/focus/persistence, active-editor history and all **eight footprints × two input types × two modes**. Original comparison checks use existing raster, mesh and particle targets and verify that the renderer returns to the effect display buffer across workspace, tool and authoring transitions. The existing production suite checks the complete New Save/Discard/Cancel/failure/recovery paths and centered prompt geometry.

Manual isolated-host checks created a 640 × 400 painting, drew a brush stroke, undid/redid it and confirmed the stroke in the automatic export preview. Pending Name and Height edits followed by a single pointer click on Create opened the expected save decision. Pending Width followed by a preset click worked once; Tab reached the next field; pending Name followed by Close worked once. Wide Paint/Studio, compact mouse, portrait touch and landscape touch fixtures were visually reviewed in WebOS themes.

Stronger target-transition coverage also exposed GPU initialization outside the kernel's admitted execution window. Mesh vertex/index/reset buffers now initialize through mapped CPU writes and release partial allocations on failure. Depth initialization and pending paint flush before the renderer consumes their textures. The existing GPU frame queue admits terrain baking and typed-command replay, rejecting stale document/scene/source work and superseded replays. Autosave initialization registers its owned producer before restoring terrain; failure retains recovery data and propagates through candidate cleanup. Project-style typed replay also includes saved terrain stamps. GPU authority rules are unchanged. Sources: `gpu/resources/gpuLayerResources.js`, `gpu/painters/gpuDepthPainter.js`, `scene/scene3d.js`, `app/PaintApp.js`.

| Isolated browser suite | Passing checks/groups |
| --- | ---: |
| `paint-usability.html` | 12 on fresh startup; 11 on recovery, which skips the clean-start branch |
| `paint-clean-room-regressions.html` | 28 |
| `paint-ux-redesign.html` | 12 |
| `sewing-drawing-shared.html` | 24 |
| `paint-surface-tools.html` | 26 |
| `paint-material-volume.html` | 8 |
| `paint-usability-recovery.html` | 7 |
| `kernel/gpu-frame-coordinator.html` | 13 |

The seven recovery groups compare actual GPU height data, sculpt vertices and captured settings after a fresh app mount with saved terrain, mesh, depth and particle commands. They reject queued baking after source deletion/replacement, exercise failed/canceled terrain or command restoration and valid retry, reject superseded replays, and inject failures at later mesh allocations/mappings. Deliberate restore failures produce expected diagnostic error logs; the suite has no GPU validation errors.

The broader `factory/os-background-memory-lifecycle.html` needed its existing Paint test to await asynchronous `unmount()`. Paint's close implementation is unchanged from the scoped baseline. With the fixture corrected, Paint teardown checks complete, but the suite subsequently fails its unrelated operator-drain assertion. This broader suite is **not reported as passing**. Its one-line fixture change has a separate baseline, `tmp/paint-usability-lifecycle-baseline-20260908.zip`.

One 1024 × 768 two-effect latency sample measured a 0.31 ms median / 0.52 ms p95 input handler and 49.62 ms median / 85.83 ms p95 edit-to-derived-readback, with two long tasks totaling 862 ms including warmup. Other GPU review tabs were active. This is a recorded sample, not a controlled comparison with the September 6 measurements, a speedup claim or display/pen latency. Harness: `tests/paint-effect-latency.js`.

The evidence remains **isolated-host verification**. The reviewer independently inspected source and test coverage; its browser was unavailable, so live observations are explicitly attributed to the implementing agent. The score is an expert assessment, not a novice study or physical pen/touch/screen-reader certification. Full OS launch/lifecycle acceptance remains separate from these checks. No account prerequisites, external dependencies, project/effect schemas or OS theme implementation changed.

The scoped baseline is `tmp/paint-usability-baseline-20260908.zip`; the implementation review diff is `tmp/paint-usability-20260908.diff`. Concurrent repository changes and session-memory entries are preserved.

## Complete UI/UX redesign implemented September 6

The approved redesign is implemented in the production Paint app. It keeps live WebOS appearance tokens, existing document/effect formats, GPU ownership, history, and the preferences version-2 envelope. Graphite remains a workflow reference; no Graphite source, assets, or dependencies were added.

**New-document correction:** The reported save/discard prompt escaped the Paint window through native `showModal()`, and WebOS's global margin reset removed its default centering. It now reuses Paint's app-owned modal surface, with inherited WebOS typography, a centered scrolling card and 44 px decision buttons. Background controls in Paint are temporarily inert; the confirmation does not make the entire OS inert. Escape and Cancel retain the current painting and the New form. The replacement lock is acquired before awaiting recovery, preventing simultaneous prompts. Both confirmation and Save-first continuations settle when Paint closes. Sources: `io/documentTransitions.js`, `ui/theme/readabilityStyles.js`.

New shows progress while preparing the renderer and prevents repeated submission or closing during that operation. A renderer failure rolls back to the previous painting and displays retry guidance inside the New form. A successful document creation is not reported as failed because an unrelated preferences write failed. The New form uses artist-facing introductory copy. Sources: `app/commands.js`, `app/PaintApp.js`, `panels/startup/panelsStartup.js`.

This follow-up passes **28 production checks and 12 UX scenario groups** in the isolated real-GPU host. Added coverage exercises actual Create buttons through Discard, Cancel, Save-first cancellation, failed save and retry, renderer failure and retry, repeated activation, recovery and closing during Save first. Prompt geometry and font inheritance are checked inside an offset Paint window at four footprints with both input types; the existing redesign suite retains its 32 size/input/mode combinations. Discard already completed creation in the pre-fix isolated reproduction; a separate OS-only creation failure was not reproduced. Full OS launch/lifecycle acceptance remains separate. Scoped artifacts: `tmp/paint-new-project-baseline.zip`, `tmp/paint-new-project.diff`.

**Floating-dialog refinement:** At the user's request, Settings, Layer Effects and Filter Studio now open as floating dialogs. This supersedes their dock placement in the original redesign below. The existing controls and shared authoring dialog are reused; no effect, recipe or settings model was replaced. Menu commands, the inspector's Effects launcher and legacy panel commands use the same route. Layers and Properties retain their independent dock panes. Floating tools leave the canvas interactive, retain their scroll position during edits, and support dragging, desktop resizing, title-arrow movement and Alt+Arrow resizing. Escape closes the active dialog, and modal document dialogs take focus above floating tools. Touch dialogs remain bounded to half the workspace height in portrait or half its width in landscape. Sources: `panels/studio/floatingDialog.js`, `panels/studio/studioDialog.js`, `panels/layers/layerEffects.js`, `core/accessibility.js`.

The floating-dialog follow-up passes **12 UX scenario groups and 24 production checks** in the isolated host. Each of the 32 size/input/mode combinations checks all three dialogs. Coverage includes live GPU effect pixels, Undo/Redo, exports, theme changes, numeric draft retention, dialog bounds, keyboard movement/resizing, document-modal priority, scroll preservation and focus returning to the launcher. Opening a dialog temporarily closes an originating compact drawer; closing the dialog restores that drawer for keyboard focus return. The scoped baseline and review diff are `tmp/paint-floating-dialogs-baseline.zip` and `tmp/paint-floating-dialogs.diff`.

**Title-switch refinement:** The user-facing mode names are now **Paint / Studio**, presented as a horizontal switch that also reads as the app title, **Paint Studio**. Paint selects the compact interface previously called Focused; the saved `focused` identifier and both layouts remain compatible. Native radio controls provide keyboard arrow selection and keep focus during updates. The title reflects the applied layout while a pointer gesture defers a change. Wide windows combine the title, menus and workspace navigation into one header row; compact windows keep the title visible beside the workspace dropdown. Touch targets remain at least 44 px. Duplicate tool/zoom/renderer badges are omitted from the header, with their existing toolbar, viewport and status surfaces retained. Sources: `app/shell.js`, `panels/panels.js`, `ui/theme/redesignStyles.js`.

| Area | Implemented behavior | Main source owners |
| --- | --- | --- |
| Interface modes | New users start in Focused. Studio is seeded from existing panel preferences, including older dock layouts. Each mode retains visibility, order, collapse state, compact dock state and inspector proportions. Switching modes preserves editing state and waits for active pointer gestures. | `ui/workspace/workspaceState.js`, `core/state.js` |
| Navigation | Paint, Vector, Surface, Materials, Particles and Render use a dropdown in Focused/compact windows and tabs in wide Studio. File, Edit, Layer, Effects, View, Studio and Help retain relocated commands and shortcuts. SVG export is in File and Vector options. Opening a panel does not change the reported workspace. | `app/shell.js`, `app/commands.js`, `app/vectorWorkspace.js` |
| Inspector | Layers starts at 40% of the wide inspector, above independently scrolling Properties/Effects. A keyboard/pointer divider adjusts the split. Compact drawers and touch sheets use keyboard-accessible tabs. Existing layer, surface, particle and assigned-material controls are reused; auxiliary panels remain in View. | `panels/dock/inspectorLayout.js`, `panelsDock.js`, `dockViewState.js` |
| Live effects | Ordinary Effects commands and recents add a whole-layer live effect and open its inspector. Add, bypass, reorder, remove, reset and parameter edits use metadata history. One slider gesture or numeric commit owns one entry; unchanged edits own none. Compare original bypasses the entire selected layer stack. Locked/unsupported targets and the 24-effect limit are enforced. | `panels/layers/layerEffects.js`, existing GPU effect stack |
| Recipes | Layer Effects / Recipes share the inspector. Editing, saved libraries, import/export and attaching recipes remain available. **Bake recipe into pixels** is separate and retains existing selection/channel behavior. The inspector names live and bake targets separately. | `panels/studio/studioDialog.js`, `filters/studio/filterStackModel.js`, `filters/gpuFilters.js` |
| Numeric editing | Shared sliders, editable numbers, units and reset controls cover toolbars, brush/surface settings, layer/material properties, effects and numeric graph parameters. Drafts commit on Enter/blur; Escape cancels. Invalid drafts are rejected, finite values are bounded and stepped, and normalized percentages display 0–100. Reset uses centralized application/filter defaults or the selected brush/substance preset. Focused controls survive rerendering and duplicate views synchronize. | `core/numericControl.js`, `core/liveControls.js`, `panels/shared/panelFields.js` |
| Responsive behavior | Fine-pointer windows below 1120 px wide or 600 px high get a compact desktop rail/drawer. Wide Focused uses a 56 px rail, Studio retains expanded tools, and the inspector is 312 px. Touch keeps 44 px targets, half-height portrait sheets and landscape side sheets. Short landscape touch windows combine navigation rows to leave usable inspector space. Manual zoom remains manual; F and Shift+F retain their focus functions. | `ui/layout/deviceProfiles.js`, `workspaceLayout.js`, `ui/theme/redesignStyles.js` |
| Graph interaction | Titles are at least 13 px; parameter/port labels at least 12 px. Hit targets are 28 px for pointers and 44 px for touch, with 12 px dots and aligned wires. Headers move with arrows/Shift; controls retain their own arrows. Selected outputs and valid targets are exposed; Escape cancels a pending connection first. Auto-layout, placement, drag bounds and saved coordinates account for enlarged nodes. Preview updates retain controls and use the acquired GPU canvas. | `ui/workspace/graphGeometry.js`, existing Brush/Shader graph models and editors |
| Feedback | Artist-facing operation messages and editing targets replace routine GPU/kernel/command identifiers. Recovery has its own badge and no longer overwrites normal feedback. Pointer coordinates update a visual readout without live-region announcements. Technical details remain in logs and Engine/Shader diagnostics. | `core/accessibility.js`, `app/PaintApp.js`, `tools/dispatcher.js` |

### September 6 verification

**227 reported checks across 16 browser suites pass** in the isolated production host. Counts are each suite's reported checks or scenario groups, not independent end-to-end journeys. The 11 new UX groups include the full **eight sizes × fine/coarse pointer × Focused/Studio matrix (32 combinations)**, real effect pixels, history ownership, recipe access, focused drafts, live materials, preset defaults, graph preview pixel readback, wire alignment, large-graph round-trip, keyboard movement/connections, independent inspector scrolling, divider control and tab focus retention.

| Suite | Passing checks/groups |
| --- | ---: |
| `paint-clean-room-regressions.html` | 24 |
| `paint-ux-redesign.html` | 11 |
| `paint-responsive-layout.html` | 4 |
| `paint-focus-fit.html` | 5 |
| `paint-dock-view-state.html` | 4 |
| `paint-gpu-filters.html` | 35 |
| `paint-layer-compositor.html` | 43 |
| `paint-brush-presets.html` | 6 |
| `paint-canvas-surface.html` | 8 |
| `paint-material-volume.html` | 8 |
| `paint-selection-tools.html` | 8 |
| `paint-pasteboard.html` | 12 |
| `paint-surface-tools.html` | 26 |
| `paint-surface-hit.html` | 8 |
| `paint-fluid-adapter.html` | 1 |
| `sewing-drawing-shared.html` | 24 |

The production suite checks recovery/reload, export matching for PNG/JPEG/WebP/PSD and native packages, source preservation, failure rollback, light/dark/accent changes, high-contrast boundaries, reduced motion/transparency and unchanged OS appearance preferences. The manual review includes wide Focused/Studio, compact desktop, portrait/landscape touch sheets, WebOS light/high contrast and graph readability. `tests/paint-clean-room-layouts.html` now has separate **Review size**, **Input** and **WebOS appearance** selectors. The fixture previews appearance without saving OS settings.

The review found and fixed overflow from closed menus and status flex children, clipped content during drawer/wide transitions, insufficient landscape inspector height, fractional-step offsets from nonzero minima, lost numeric drafts during DOM replacement, and shader preview guards checking the canvas that surface acquisition had replaced. The last case is covered by a real GPU preview pixel check. Source import paths and new SPDX headers were checked against the scoped baseline.

### Effect-edit performance sample

`tests/paint-effect-latency.html` compares the saved pre-redesign Paint sources with the current sources using the same isolated host dependencies. The workload is a 1024 × 768 paint layer with Brightness/Contrast and Gaussian Blur, five warm-up edits and 30 measured edits, in Chrome 152 on Windows. GPU-derived output is explicitly read back after each edit. These figures measure edit-to-readback, **not pointer-to-display or physical pen latency**.

| Measurement | Scoped baseline | Redesign |
| --- | ---: | ---: |
| Input-handler median / p95 | 0.17 / 0.26 ms | 0.21 / 0.31 ms |
| Edit-to-readback median / p95 | 13.54 / 27.97 ms | 11.61 / 17.11 ms |
| Edit-to-readback maximum | 30.29 ms | 18.41 ms |
| Observed long tasks, including warm-up | 2, totaling 251 ms | 1, totaling 170 ms |

This single local comparison is encouraging but does not establish a general speedup or a large-document budget. The long-task observer includes first-edit setup and warm-up work. The previously identified global effect-cache invalidation behavior remains unchanged. Physical pen latency and full OS/compositor performance still need separate measurement.

### Compatibility, review and remaining acceptance

Optional `uiMode`, `workspaceId` and `modeLayouts` records live inside the existing preferences `ui` object. Graph layout migration markers and the selected custom brush identifier are also optional UI preferences. No project, effect, material or shared-vector format was changed. The baseline archive is `tmp/paint-ux-redesign-baseline-20260906-060252.zip`; the scoped diff and SHA-256 manifest are `tmp/paint-ux-redesign.diff` and `tmp/paint-ux-redesign-manifest.json`. Compare individual files before any rollback because concurrent work remains in the checkout.

**Full OS launch/account/compositor lifecycle acceptance remains pending** until the existing account prerequisites below are resolved. No account gate was changed or bypassed. These isolated-host results do not certify physical touch/pen hardware, screen-reader use, or formal contrast conformance. Documentation search, discovery files and the viewer bundle are rebuilt after this update. No commit or deployment is part of this work.

The sections below preserve the September 5 audit and earlier verification history; the September 6 tables above describe the completed redesign.

## Evidence and limits

On 2026-09-05, the local source OS at `http://127.0.0.1:9001/webgpu-os/` stopped at 48% with **Boot sequence interrupted**. The browser console reported `LegacyOperatorMigrationError: Legacy V1 authority remediation is incomplete; operator activation remains blocked`. Paint never mounted in that session. No identity state was reset and no migration gate was bypassed.

The production Paint app was subsequently mounted in `tests/paint-clean-room.html` using the real `GpuDeviceBroker`, `GpuFrameCoordinator`, guarded syscalls, and `SurfaceManager`. The test host stores disposable files in its own IndexedDB database and runs on a separate local origin. This enabled real GPU painting, effects, recovery, export, and visual checks without changing OS identity state. The OS account launch and compositor lifecycle remain unverified: a separate localhost attempt reported account switching in progress. Physical pen pressure/tilt, screen-reader behavior, and latency measurements require their own sessions.

| Baseline | Result | What it establishes |
| --- | --- | --- |
| `tests/paint-responsive-layout.html` | 5 reported checks pass | Profile selection, phone sheets, touch targets, and tablet layout in the existing fixture |
| `tests/paint-focus-fit.html` | 5 reported checks pass | Focus/panel CSS behavior and fit calculation, including invalid bounds |
| `tests/paint-dock-view-state.html` | 4 reported checks pass | Dock scroll, panel scroll, and focused-control restoration in the fixture |
| Graphite live editor | New-document flow and node overlay inspected at 1280 × 720 | Actual layout, optional graph view, and changing interaction hints |
| Paint in the OS shell | Blocked before app launch | Account launch and full OS lifecycle remain pending |
| Production Paint in isolated host | Mounted; drawn strokes, effects, thumbnails, recovery and exports verified | Working app evidence with real guarded GPU resources and isolated persistent files |

The first three rows were the initial 14-check baseline. The implementation run below expands that coverage; neither establishes device certification.

## Implemented changes and verified outcomes

| Issue | Implemented result | Evidence |
| --- | --- | --- |
| PNT-01, PNT-04 | Shortcuts respect text editing, native undo, IME, other app targets, vector surfaces and dialogs. Tab navigates; Shift+F toggles panels. Dialog focus wraps and returns. Menus support arrow/Home/End navigation. | Production regression checks cover text, composition, outside targets, Studio Escape, modal focus and menu navigation. |
| PNT-02 | New/Open/PSD share Save first / Discard / Cancel. Replacement captures the old pixels and scene and restores them if the new renderer fails. Save marks identity clean only after the file write succeeds. Busy dialogs prevent duplicate writes. | Cancel New, forced renderer rollback with pixel comparison, failed save, and Save first with an unrelated preference-write failure pass. Open/PSD use the same transition; their complete OS file-picker paths were not exercised. |
| PNT-03 | A persistent badge reports actual pending/saving/saved/error recovery state. Concurrent writes drain newer edits. Undo, redo and history jumps schedule recovery. Close flushes pending recovery before resource teardown. Restored recovery is labeled correctly. | Concurrent-write, failed-write, retry and close tests pass. Manual reload restores the drawn painting and live effect. Browser termination cannot guarantee completion of an asynchronous write. |
| PNT-05 | Raster layers now own editable live effects: add, change parameters/opacity, enable, reorder, remove, compare original, and undo/redo. Filter Studio can attach recipes; Bake remains explicit. Derived GPU buffers preserve source paint and reuse unchanged output. | Pixel assertions, cache/bypass checks, metadata undo/redo, PaintScene/package/GPU recovery round trips, and PNG/JPEG/WebP/PSD output checks pass. |
| PNT-06, PNT-08 | Desktop docks use 248/312 px proportions; common controls and subtle labels have clearer text. Panel headers align correctly across desktop/tablet/phone. Advanced surface controls use disclosure sections. Normal status copy is simpler. | Production app screenshots and DOM measurements at the sizes below. No blanket contrast-conformance claim. |
| PNT-07 | Hints describe the active tool and locked layer. Recovery status stays separate. Space-drag temporarily pans; wheel zoom begins from the current fit/manual zoom. Lost pointer capture finalizes the current gesture. | Live mouse drawing and navigation inspection; existing fit, selection and surface-coordinate regressions pass. Physical pen validation remains open. |
| PNT-09, discovered live | Out-of-frame GPU uploads/readbacks now use the existing broker's finite one-shot jobs. Initialization reports ready only after raster initialization succeeds. | Real guarded GPU startup, painting, effects, exports and rollback pass without GPU validation errors. Kernel authorization was not changed. |
| PNT-10, discovered live | Transparency checkerboard renders inside the output frame. Small GPU readbacks refresh layer thumbnails and the navigator without allocating full legacy canvases for GPU-only layers. | Transparent 800 × 500 painting inspected; effect and thumbnail pixels verified. Standard raster exports omit the checkerboard. |
| PNT-11, discovered in round trip | PSD subset parsing now uses the correct extra-data offset, Pascal-field alignment and layer order. Unsupported compression fails explicitly. | Exported PSD reads back the expected colors and top layer. This does not add support for arbitrary Photoshop files. |
| PNT-12, discovered in responsive review | Short landscape windows use the canvas-first layout even with a fine pointer. Tablet menus can open beyond their horizontal strip; tablet headers reserve space for 44 px controls. | The 844 × 390 review changed from a cramped three-pane layout to a usable canvas with side navigation; responsive regression passes. |

Brush and Shader libraries also support searching saved resources by name, author, description and tags. Existing graph editors and presets remain the authoring foundation.

### WebOS appearance makeover

The follow-up implementation replaces Paint's fixed mint/night chrome with live references to the WebOS appearance variables. `ui/theme/paintTheme.js` reuses the shared Factory tokens from `webgpu-os/factory/sdk/ui/tokens.js`, with the OS accent taking precedence. The existing `webgpu-os/kernel/ThemeEngine.js` and `webgpu-os/style.css` remain the appearance owners. No OS theme or preference code was changed.

Menus, tool controls, layer rows, panels, mobile navigation, dialogs, color controls and Studio editors now share the OS surface, text, accent and border hierarchy. Selected tools retain an outline/underline; layer selection retains a left marker. Layer visibility, lock and actions use the existing SVG icon system with descriptive accessible names and actual state. WebOS fonts, corner preferences, light/dark mode, high contrast, reduced motion and reduced transparency reach Paint. The code editor retains its monospace font.

The light-mode review reproduced and fixed unreadable Filter Studio descriptions and shader graph nodes caused by fixed dark backgrounds. It also exposed a color-picker geometry bug: swatch size variables were scoped only to the compact palette, producing full-width preset squares in the popover, and the preview grid collapsed its background chip. The popover now owns its swatch sizes and reserves space for both chips, with 44 px swatches on phone/tablet profiles. Artwork colors, color spectra and the neutral painting viewport remain independent of UI appearance.

The final accent comparison exposed an existing `core/dom.js` problem: assigning custom CSS properties through `Object.assign(node.style, ...)` did not declare them. The shared `el()` helper now uses `style.setProperty()` for custom properties while preserving normal style assignments. This restores the actual foreground swatch, authored node-category colors and shader-preview variables. The production regression verifies that the foreground indicator retains its artwork color when the OS accent changes.

The isolated host now loads the actual OS stylesheet and uses `ThemeEngine.preview()` for its **WebOS appearance** selector. Theme previews do not save OS preferences. After this makeover, **38 reported checks passed**: 24 production/GPU checks, 5 responsive, 5 focus/fit and 4 dock-state checks. The production suite includes live accent changes without remounting, light-mode panels/inputs/dialogs/filter information/graph nodes, color-picker geometry, OS font/corner/motion/transparency preferences, high-contrast boundaries, and unchanged source GPU pixels and saved OS settings. This is a follow-up run; the earlier 188-check run below is retained as historical evidence.

The visual review covered desktop light/dark controls, Brush/Filter/Shader Studio and the color picker, plus phone light mode, tablet Ocean and compact Violet layouts. The existing eight-size selector remains available in `tests/paint-clean-room-layouts.html`. OS account launch, physical input, formal contrast measurements and large-document performance remain subject to the limits above. A separate pre-makeover archive is retained at `tmp/paint-webos-theme-baseline.zip`; compare individual files before restoring anything over concurrent work.

### Verification record

Before the WebOS appearance follow-up, all **188 reported checks across 14 browser suites passed** in the local in-app browser with WebGPU available. Counts refer to each suite's reported assertions, not independent end-to-end user journeys. The failure-injection regression intentionally logs its simulated storage and preference failures.

| Browser suite in `tests/` | Passing checks |
| --- | ---: |
| `paint-clean-room-regressions.html` | 19 |
| `paint-responsive-layout.html` | 5 |
| `paint-focus-fit.html` | 5 |
| `paint-dock-view-state.html` | 4 |
| `paint-brush-presets.html` | 6 |
| `paint-pasteboard.html` | 12 |
| `paint-gpu-filters.html` | 35 |
| `paint-layer-compositor.html` | 43 |
| `paint-canvas-surface.html` | 8 |
| `paint-material-volume.html` | 8 |
| `paint-selection-tools.html` | 8 |
| `paint-surface-tools.html` | 26 |
| `paint-surface-hit.html` | 8 |
| `paint-fluid-adapter.html` | 1 |

`tests/paint-clean-room-layouts.html` embeds the real Paint host at explicit dimensions so the review is reproducible even if browser viewport overrides are unavailable. The review measured no **Paint document page overflow** at 1920 × 1080, 1366 × 768, 1280 × 720, 1180 × 820, 820 × 1180, 796 × 511, 390 × 844 and 844 × 390. Tool strips and docks intentionally scroll. At 1180 × 820 the actual fine-pointer environment selected the desktop profile; the existing responsive fixture separately verifies coarse-pointer tablet selection.

The manual artwork was an 800 × 500 transparent document with three real mouse strokes and an Invert layer effect. The output frame, original/effected appearance, layer thumbnail, navigator, mobile panel access, and restored recovery were inspected. Large-document memory/latency and physical input behavior were not measured. The current effects cache uses a global paint revision, so a stroke can invalidate effects on other layers; measuring and tightening that invalidation is a performance follow-up.

### Review and rollback

Run `python start_server.py`, then open `/tests/paint-clean-room.html`, `/tests/paint-clean-room-layouts.html`, or `/tests/paint-clean-room-regressions.html` on that server. Regression and manual artwork use different IndexedDB databases. The host is a local development fixture, not an OS account or deployable replacement shell.

A pre-implementation archive is retained locally at `tmp/paint-renovation-20260905-baseline.zip`. Restore selected files only after comparing current changes: the Paint tree and wider checkout contain substantial pre-existing and concurrent work. Do not overwrite the tree wholesale. No commit or deployment was made by this work.

The remaining acceptance work is OS launch/lifecycle verification after its existing account prerequisites are resolved, physical pen and screen-reader testing, measured contrast and performance, and broader external PSD compatibility. Multiple-document sessions and richer procedural/vector expansion still require a separate product/model decision. These are explicit limits, not completed work.

## Existing foundations to reuse

| Area | Existing owners | Implication for the plan |
| --- | --- | --- |
| Shell and workspaces | `app/shell.js`, `ui/workspace/workspaceModel.js` | Improve the current task lenses and active-tool options |
| Responsive layout and theme | `ui/layout/workspaceLayout.js`, `deviceProfiles.js`, `responsiveStyles.js`, `ui/theme/paintTheme.js` | Keep one layout policy and one theme-token owner |
| Docks and panels | `panels/dock/`, `ui/panels/panelFactory.js` | Preserve focus, scrolling, and panel state when reorganizing controls |
| Tools and commands | `core/constants.js`, `app/commands.js`, `app/shortcuts.js`, `tools/dispatcher.js` | Reuse command/tool identities for buttons, shortcuts, help, and availability |
| Document and recovery | `document/documentModel.js`, `document/history.js`, `gpu/scene/gpuCommandJournal.js`, `io/projectStore.js` | Build safe transactions around the current document and journal |
| Advanced authoring | `tools/brush/nodes/`, `shaders/nodes/`, `filters/studio/filterStackModel.js` | Improve existing editors before introducing another graph system |
| File interchange | `io/io.js`, `fileFormats.js`, `paintSceneStore.js`, `psdCodec.js` | Verify existing formats and round trips before expanding the format list |

Paint source paths in this document are relative to `webgpu-os/factory/apps/paint/` unless another root is stated. The existing app uses browser ES modules, Python tooling, Plauna/OS integration, and GPU scene ownership.

## Initial issue register

The register below preserves the **pre-implementation baseline**. Use the implemented-outcomes table above for current resolution status.

**P1** means a substantial correctness, artwork-preservation, or interaction risk. **P2** means a usability improvement or capability gap. Priorities can change after reproduction. Code-confirmed behavior is not a claim that its full user impact has already been reproduced.

| ID | Priority and evidence | Finding | Proposed response and proof |
| --- | --- | --- | --- |
| PNT-01 | P1, source-confirmed routing | `PaintApp.bindEvents()` registers capture-phase `keydown` on `document`. `handleShortcut()` checks that the app exists, but does not exclude editable inputs, composition, or another focused app. It intercepts Tab, tool letters, and Ctrl/Cmd+Z. | Scope routing to the active Paint context. Let text fields own typing, undo, and Tab traversal. Reproduce in document names, layer names, shader text, dialogs, and another OS app. |
| PNT-02 | P1, source-confirmed replacement paths | `createDocumentOnce()` clears autosave; `createNewDocument()` clears history and replaces the document. `openProjectFile()` and `importPsdFile()` also replace the document. No dirty-document decision is present in the inspected command and import paths. | Add one shared Save / Discard / Cancel transition and stage replacement until decoding and required preparation succeed. Test cancellation and decode/GPU/storage failures against disposable artwork. |
| PNT-03 | P1, source-confirmed reporting gap; close-loss impact needs reproduction | Autosave waits 1200 ms. `unmount()` cancels its timer before GPU teardown. `persistAutosave()` only changes visible status on success. The settings recovery card is always styled `good` and derives its message from `document.dirty`, not a successful write. | Track pending/saving/saved/failed states from real persistence outcomes. Coordinate app close with a durable checkpoint through the existing lifecycle. Test immediate close, slow writes, failed writes, and edits arriving during a save. |
| PNT-04 | P1, source-confirmed dispatch omission; modal behavior needs reproduction | The Escape handler covers color, menus, file, about, and new-document UI, but does not check `showStudioDialog`. It can fall through to clearing the artwork selection. | Use topmost-dialog handling, focus containment and restoration, and explicit cancellation. Verify Escape in Settings, Brush, Filter, and Shader Studio without changing artwork. |
| PNT-05 | P2, confirmed capability distinction | `applyFilterStack()` applies stages to the active GPU raster and journals the operation. The editable recipe describes how to apply effects; it is not a persistent per-layer live-effect stack. | First make Apply behavior clear. Then design editable layer effects with preview, bypass, reorder, reset, serialization, and undo using the existing filter registry. |
| PNT-06 | P2, layout hypothesis from source | Desktop profiles allocate 292 px to tools and 320 px to the inspector. At 1280 px, that leaves 668 px before other viewport allowances. Several style rules use 9–11 px text. | Measure the real app before changing sizes. Study a narrow tool shelf with optional detailed controls, clearer typography, and preserved touch targets. Do not call source arithmetic a measured visible-canvas size. |
| PNT-07 | P2, source-confirmed discoverability gap | The shell initializes its status help with a fixed list of file/history shortcuts. Graphite changes hints with tool and interaction state. | Derive useful hints from the active tool and gesture state: pan, constrain, cancel, sample, selection modifiers, and applicable layer target. Keep save state separate from transient hints. |
| PNT-08 | P2, source-confirmed wording | Startup/about/settings copy exposes phrases such as GPU contracts, PaintScene resources, and backend state alongside artist tasks. | Lead ordinary flows with Create, Paint, Select, Adjust, Lift, and Export. Keep technical details accessible in diagnostics where they help explain a failure. |

Primary source anchors: `app/PaintApp.js` (`bindEvents`, `unmount`, `persistAutosave`); `app/shortcuts.js` (`handleShortcut`); `app/commands.js` (`createDocumentOnce`, `createNewDocument`); `io/io.js` (`openProjectFile`, `importPsdFile`); `panels/studio/studioDialog.js` (`settingsStudio`); `filters/gpuFilters.js` (`applyFilterStack`); `app/shell.js` (`buildStatusBar`); `ui/layout/deviceProfiles.js`; `core/styles.js`.

## What Graphite teaches us

Graphite's current documented strength is vector and procedural design. Its manual describes its raster brush as a limited prototype with bugs and performance issues. It is therefore a useful workflow reference, but it does not establish a brush-quality target for Paint. [Graphite features and limitations](https://graphite.art/learn/introduction/features-and-limitations/).

Graphite's tools expose operations over a node-based document. Its Svelte/TypeScript frontend presents backend state and sends changes to a Rust backend compiled to WebAssembly. The transferable principle is one authoritative model with multiple editing views. Paint can apply that principle through its existing document, command journal, GPU resources, and panel contracts. Graphite's frontend build stack conflicts with this repository's no-Node/no-npm constraint. [Graphite repository](https://github.com/GraphiteEditor/Graphite), [frontend architecture](https://github.com/GraphiteEditor/Graphite/tree/master/frontend).

| Graphite pattern | Adaptation for Paint | Scope |
| --- | --- | --- |
| Active-tool controls and a narrow tool shelf | Keep frequent controls near the canvas; reveal detailed brush/surface controls on demand | Early UI study |
| Persistent Layers and Properties regions | Study simultaneous layer context and relevant properties on wide windows; retain sheets on phones | Validate against current docks |
| Hints that change during an interaction | Show modifiers, cancel actions, and the current editable target | Early interaction improvement |
| Optional graph overlay with artwork still visible | Make Brush/Shader graph entry discoverable and keep preview visible; regular painting remains direct | Improve existing graph editors |
| Nondestructive effects and procedural parameters | Start with a layer effect stack and reusable presets | Later model and GPU work |
| Document tabs and unsaved markers | First strengthen dirty-state and safe replacement; assess real multiple-document sessions separately | Reliability first, tabs later |
| Detailed snapping controls | Evaluate guides, snapping, selection bounds, and precise transforms within Paint's existing tools | After core reliability |

The interface and input-hint patterns are documented in [Graphite Interface](https://graphite.art/learn/interface/). Tool controls, document identity, navigation, and the optional graph are documented in [Graphite Document panel](https://graphite.art/learn/interface/document-panel/). The live editor visibly changed both controls and hints when its Node Graph view opened during this review. Its displayed shortcut differed from the manual, so shortcuts must be checked against the live version rather than copied from documentation.

Recommendations are design inferences from those sources. This plan does not import Graphite code, branding, or dependencies. A future code-reuse proposal should identify the exact component, revision, dependencies, and attribution separately.

## Eight ordered work packages

1. **Establish the live audit baseline [REVIEW].** Use a working OS session or an existing sanctioned test environment; record the boot prerequisite separately. Walk Create → Paint → Select/Transform → Layers → Adjust → Save/Reload → Export, plus Paint → Lift → Materials → Simulate. Capture screenshots and reproducible findings at each state. Output: issue register with expected/actual behavior, severity, source owner, evidence, and uncertainty.
2. **Protect input and artwork [MODIFY].** Address PNT-01 through PNT-04 in the current shortcut, command, dialog, persistence, and lifecycle owners. Preserve the current document until replacement is accepted and ready. Output: reliable typing, dialog cancellation, dirty-work decisions, and truthful recovery state, with focused behavioral regressions.
3. **Improve visual hierarchy [MODIFY].** Compare the actual shell with two layout studies: compact tools plus optional settings, and the current dock layout with revised proportions. Use restrained chrome, consistent icons/spacing, legible labels, obvious selection/disabled/focus states, and a clear artboard boundary. Output: reviewed desktop and compact layouts with measured canvas space and no hidden controls.
4. **Clarify tools, layers, and workspaces [MODIFY].** Show what tool is active, what layer/channel it edits, and why an operation is unavailable. Use context-sensitive options, hints, layer actions, and useful empty states. Reuse tool definitions, workspace models, panel factories, and command IDs. Output: the same task can be completed through menu, toolbar, and shortcut without divergent behavior.
5. **Audit navigation, accessibility, and drawing feel [MODIFY].** Exercise fit/100% zoom, pan, selection bounds, snapping, resize, keyboard traversal, focus visibility, touch sheets, and pen gestures. Measure pressure, coalesced samples, interpolation, pointer capture, and cancellation on real hardware where available. Output: stable canvas coordinates and reachable controls across the supported input matrix.
6. **Add editable effects incrementally [DESIGN, THEN MODIFY].** Define per-layer effect ownership, source preservation, preview evaluation, cache invalidation, serialization/versioning, and history before extending the existing filter-stack model. Start with a small set of real filters and explicit Apply/Bake semantics. Output: modify or bypass an earlier effect after later edits, undo/redo, save/reload, and export consistently.
7. **Improve advanced authoring and interchange [MODIFY; EXPANSIONS CONDITIONAL].** Improve search, presets, preview, validation, and consistent interactions in existing Brush/Shader editors. Test PaintScene and supported PSD/raster round trips, including typed layers and transparency. Evaluate multi-document sessions, editable vectors, and richer procedural operations only after their user value and model costs are documented.
8. **Verify and maintain the research backlog [REVIEW].** Run relevant regressions throughout each package and repeat the live task matrix at completion. Compare screenshots, capture GPU validation errors and latency on named hardware, and update the issue register with resolved/rejected/deferred outcomes. Output: evidence for each accepted improvement and an ordered next batch rather than a growing feature wish list.

Package 1 supplies the visual evidence for package 3. Package 2 precedes risky authoring expansion. Package 6 requires a model review before implementation. Package 8 runs alongside the work as well as at the end. Each implementation batch should be a small, reviewable change within these packages.

## Acceptance matrix for the full audit

| Dimension | Cases and pass conditions |
| --- | --- |
| Window sizes | 1920 × 1080, 1366 × 768, 1280 × 720; compact 796 × 511; tablet 820 × 1180 and landscape; phone 390 × 844 and landscape. No unintended overlap, unreachable action, or page overflow. Preserve manual zoom during resize. |
| Text and focus | Type tool-shortcut letters and numbers in every field; edit shader code; use IME; Tab/Shift+Tab; use input-local undo; switch to another OS app. No unintended artwork command. |
| Document safety | New/Open/PSD replacement with dirty artwork; Cancel; failed decode; failed storage; close within 1200 ms; edits during a pending save; reopen. Last recoverable work survives and messages match outcomes. |
| Layer states | Empty, locked, hidden, grouped, clipped, masked, raster, and typed layers. Target and command availability remain clear; undo restores structure and content. |
| Tool behavior | Brush/eraser/fill, selection/transform, color sampling, pressure/tilt, pointer cancellation, temporary pan, and zoom while navigating. Preview, hit testing, and visible artwork agree. |
| Files | Save and reload PaintScene; export PNG/JPEG/WebP and scene preview; exercise the supported PSD subset. Dimensions, transparency, names, layer properties, and typed resources match the format's stated scope. |
| Performance | Record document size, layers, brush, browser, GPU, pointer-to-present latency, CPU long tasks, frame time, and readback use. Set budgets from this baseline; never present an unmeasured 60 FPS claim. |
| Accessibility | Semantic names, visible focus, logical navigation, dialog focus/return, selected state beyond color, legible text, and usable touch controls. Measure contrast on rendered states. |

Reuse relevant existing suites for brush presets, selection, pasteboard, surface hit testing/tools, canvas surface, material volume, layer compositing, GPU filters, fluid adapter, responsive layout, dock state, and focus/fit. Add behavior tests only where they cover a real gap. Component fixtures do not establish OS lifecycle, physical pen behavior, or full GPU editing correctness.

## Research as work progresses

For each proposed improvement, record: the user's task, our observed failure or friction, a primary reference, the transferable pattern, existing Paint code to reuse, model/performance cost, and a measurable acceptance test. Distinguish **live observed**, **source confirmed**, **hypothesis**, and **future feature**.

Research the next unresolved question when it affects a decision. Graphite is the first reference; brush feel and pen ergonomics may need a painting-focused primary reference in later work. Revisit priority after each reproduced failure or completed workflow. Preserve the substantial uncommitted work already present in this checkout.

## See also

- [WebGPU OS overview](overview.md)
- [Particle Studio integration map](particle-studio-integration-map.md)
- [Particle Studio test plan](particle-studio-test-plan.md)
- [Graphite user manual](https://graphite.art/learn/)
- [Graphite source repository](https://github.com/GraphiteEditor/Graphite)
