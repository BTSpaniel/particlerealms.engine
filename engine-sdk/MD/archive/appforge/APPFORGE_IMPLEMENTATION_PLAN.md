<!--
SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
-->

# APPFORGE IMPLEMENTATION PLAN

This document operationalizes `APPFORGE_SUPER_PLAN.md`.

It is the execution checklist for building AppForge into the current WebGPU OS
without replacing the existing kernel, app registry, package manager,
permissions, shell, or Plauna panel stack.

## 1. Execution Rules

- Preserve current WebGPU OS boot behavior at every phase.
- Keep `AppRegistry` as the app manifest registry.
- Add AppForge as a part registry and assembly layer.
- Keep the existing permission engine canonical.
- Keep current package trust and sandbox checks.
- Do not add Node.js, npm, or package-lock files.
- Use browser ES modules and Python tooling only.
- Do not edit vendored, generated, binary, or third-party paths.
- Add SPDX headers to new source files.
- Every phase must be independently testable before moving forward.

## 2. Phase Dependency Order

| Order | Phase | Depends On | Output |
|-------|-------|------------|--------|
| 0 | Baseline Guard | none | Known-good boot and command baseline |
| 1 | Registry Foundation | baseline | AppForge part registry |
| 2 | Tags And Scoring | registry | Deterministic semantic query engine |
| 3 | Service Container | registry | `ctx.services.get(id)` facade |
| 4 | Context Graph | services | Provides/consumes state graph |
| 5 | Command Objects | registry, services, context | Registered command contract |
| 6 | Layout Zones | registry, context | AppForge workspace zones |
| 7 | Blueprints And AppFactory | registry, tags, layout | Deterministic workspace assembly |
| 8 | Terminal Service | services, context, commands | Persistent terminal sessions |
| 9 | Package Exports | registry, permissions | AppForge package part exports |
| 10 | Timeline And Lenses | context, layout, commands | Replayable workspace history and alternate views |
| 11 | Visual Builder And Packs | all prior | User-facing composition tools |

Do not skip phases. Later phases may stub data fixtures only in tests, never in
runtime code.

## 2.1 Current Implementation Status

| Phase | Status | Evidence |
|-------|--------|----------|
| 1 Registry Foundation | Implemented | `webgpu-os/appforge/registry/`, `definitions/`, `adapters/`, `sdk/` |
| 2 Tags And Scoring | Implemented | `webgpu-os/appforge/tags/`, `scoring/` |
| 3 Service Container | Implemented | `webgpu-os/appforge/services/`, `kernel.services`, `kernel.appForgeServices` |
| 4 Context Graph | Implemented | `webgpu-os/appforge/context/`, `kernel.contextGraph`, `os.contextGraph` |
| 5 Command Objects | Implemented | Command helpers, `CommandBus.registerObject()`, pipelines, Notepad and Files batches, command tooling visibility |
| 6 Layout Zones | Implemented | `webgpu-os/appforge/layout/`, `kernel.layoutEngine`, `os.layoutEngine`, `os.workspaceHost`, persisted snapshots |
| 7 Blueprints And AppFactory | Implemented | `webgpu-os/appforge/blueprints/`, `kernel.appFactory`, `os.appFactory`, app-manifest panel import |
| 8 Terminal Service | Implemented | `webgpu-os/appforge/services/terminal/`, `kernel.terminalService`, `os.terminal`, terminal syscall bridge |
| 9 Package Exports | Implemented | `webgpu-os/appforge/packages/`, package manager validation/registration/remove/rollback hooks, manifest schema/docs |
| 10 Timeline And Lenses | Implemented | `webgpu-os/appforge/timeline/`, `webgpu-os/appforge/lenses/`, `kernel.timeline`, `kernel.lensRegistry`, `syscalls.appforge` |
| 11 Visual Builder And Packs | Implemented | `webgpu-os/appforge/builder/`, `webgpu-os/appforge/packs/`, `os.workspaceBuilder`, `os.starterPacks`, `os.appforge-builder` |

## 2.2 App-Owned Migration Strategy

Keep current apps in `webgpu-os/apps/<app>/` until their AppForge equivalents
are proven and the old app surfaces can be removed manually.

For each migration slice:

1. Keep the app manifest and existing launch entry working.
2. Add `webgpu-os/apps/<app>/appforge/` for that app's panels, tools,
   commands, services, workflows, and profiles.
3. Keep any old top-level AppForge files as re-export shims until manual
   cleanup removes them.
4. Promote shared code into `webgpu-os/appforge/` only after at least two apps
   need the same primitive.
5. Verify the app still launches through Desktop and the AppForge smoke runner
   still passes.

Migration order remains Files, Notepad, Terminal, Paint, then admin/system
apps. Files and Notepad are the first app-owned migration slices.

## 3. Phase 0: Baseline Guard

Purpose: prove the current OS still works before adding AppForge code.

### Deliverables

- Record current app manifest count from `webgpu-os/apps/index.json`.
- Record current OS boot entry points:
  - `webgpu-os/boot.js`
  - `webgpu-os/index.js`
  - `webgpu-os/kernel/KernelBootstrap.js`
- Record current launch path:
  - `KernelBootstrap.init()`
  - `appRegistry.discover()`
  - `packageManager.syncBuiltins()`
  - `modRegistry.discover()`
  - `Desktop.mount()`
- Add no source changes in this phase unless a baseline test already exists and
  needs a non-behavioral documentation update.

### Verification

```bash
python start_server.py
python bundle_engine.py --target webgpu-os
```

Manual browser checks:

- Desktop boots at `http://127.0.0.1:9001`.
- Files opens.
- Terminal opens.
- Notepad opens.
- Paint opens.
- Package manager opens.
- Permission manager opens.

Exit gate: current behavior is understood and reproducible.

## 4. Phase 1: Registry Foundation

Purpose: add the AppForge part registry without changing current app launch.

### New Folders And Files

- `webgpu-os/appforge/index.js`
- `webgpu-os/appforge/registry/AppForgeRegistry.js`
- `webgpu-os/appforge/registry/index.js`
- `webgpu-os/appforge/definitions/index.js`
- `webgpu-os/appforge/adapters/manifestAdapter.js`
- `webgpu-os/appforge/adapters/index.js`

### Required APIs

```js
AppForgeRegistry.register(definition);
AppForgeRegistry.unregister(id);
AppForgeRegistry.resolve(id);
AppForgeRegistry.query(criteria);
AppForgeRegistry.validate(definition);
AppForgeRegistry.list(type);
```

### Definition Types

Support these v1 types:

- `panel`
- `tool`
- `command`
- `service`
- `layout`
- `theme`
- `workflow`
- `blueprint`
- `package`

### Implementation Steps

1. Create `definitions/index.js` with allowed types, required fields, and shared
   validation helpers.
2. Create `registry/AppForgeRegistry.js` with in-memory maps by ID and type.
3. Reject duplicate IDs.
4. Reject unknown types.
5. Normalize arrays for `tags`, `provides`, `consumes`, and `permissions`.
6. Return cloned registry entries from public read APIs.
7. Create `adapters/manifestAdapter.js` that converts current app manifests
   into registry candidates without mutating the original manifest.
8. Export each component through its folder barrel, then through
   `webgpu-os/appforge/index.js`.
9. Wire nothing into boot yet except optional developer-only import tests.

### Acceptance Criteria

- Existing Desktop boot path is unchanged.
- Current app manifests can be adapted into AppForge candidates.
- Duplicate IDs fail loudly.
- Unknown part types fail loudly.
- Registry query order is stable.
- Public APIs do not expose mutable internal objects.

## 5. Phase 2: Tags And Scoring

Purpose: add deterministic semantic discovery.

### New Folders And Files

- `webgpu-os/appforge/tags/index.js`
- `webgpu-os/appforge/scoring/index.js`

### Required Namespaces

- `domain.*`
- `action.*`
- `role.*`
- `data.*`
- `runtime.*`
- `risk.*`
- `surface.*`
- `permission.*`

### Implementation Steps

1. Add tag namespace validation.
2. Add canonical tag normalization.
3. Add registry validation hook for tags.
4. Add deterministic scorer.
5. Add score explanation output.
6. Add stable tie-break: explicit priority, then lexical ID.
7. Add zone affinity scoring but keep zone values data-only until Phase 6.
8. Add co-occurrence scoring input but default it to zero until timeline data
   exists.

### Acceptance Criteria

- Invalid tag namespaces are rejected.
- Equal candidates always sort in the same order.
- Score output includes machine-readable reasons.
- No runtime LLM or probabilistic choice is used.

## 6. Phase 3: Service Container

Purpose: expose existing kernel services through an AppForge facade.

### New Folders And Files

- `webgpu-os/appforge/services/ServiceContainer.js`
- `webgpu-os/appforge/services/kernelServices.js`
- `webgpu-os/appforge/services/index.js`

### Required APIs

```js
ServiceContainer.register(id, service, metadata);
ServiceContainer.get(id);
ServiceContainer.has(id);
ServiceContainer.list();
```

### Initial Service IDs

- `os.kernel`
- `os.events`
- `os.appRegistry`
- `os.commandBus`
- `os.permissions`
- `os.packageManager`
- `os.theme`
- `os.surfaceManager`
- `os.processTable`
- `os.search`
- `os.storage`
- `os.sessionStore`
- `os.toolDriver`

### Implementation Steps

1. Create a container that stores existing object references.
2. Register services during kernel initialization after the existing services
   are constructed.
3. Do not replace direct kernel access yet.
4. Add metadata for capability requirements and lifecycle.
5. Return service references through `get`, but return metadata copies through
   `list`.

### Acceptance Criteria

- `ctx.services.get("os.commandBus")` resolves to the existing command bus. `[DONE via ServiceContainer.get()]`
- `kernel.services.get("os.commandBus")` resolves to the existing command bus. `[DONE]`
- `kernel.appForgeServices` aliases the same container for explicit AppForge callers. `[DONE]`
- No existing syscall namespace is removed. `[DONE]`
- No service is duplicated. `[DONE]`

## 7. Phase 4: Context Graph

Purpose: track shared state and part dependencies.

### New Folders And Files

- `webgpu-os/appforge/context/ContextGraph.js`
- `webgpu-os/appforge/context/index.js`

### Required APIs

```js
ContextGraph.setNode(id, value, metadata);
ContextGraph.getNode(id);
ContextGraph.link(sourceId, targetId, relation);
ContextGraph.unlink(sourceId, targetId, relation);
ContextGraph.invalidate(id, reason);
ContextGraph.snapshot();
ContextGraph.subscribe(id, callback);
```

### Initial Node Types

- `project`
- `file`
- `selection`
- `terminal.session`
- `terminal.cwd`
- `process`
- `workspace`
- `panel`
- `theme`
- `package`

### Implementation Steps

1. Add graph nodes keyed by stable string IDs.
2. Add typed edges for `provides`, `consumes`, `dependsOn`, and `invalidates`.
3. Add subscription cleanup handles.
4. Add batched invalidation to prevent duplicate notifications.
5. Add snapshot cloning for diagnostics.
6. Connect theme changes to a `theme.current` node.
7. Connect app launch/close to workspace and panel nodes.

### Acceptance Criteria

- Updating a node notifies subscribers. `[DONE via invalidation queue]`
- Unsubscribed callbacks do not fire. `[DONE via cleanup handle]`
- Snapshots cannot mutate live graph state. `[DONE via cloned snapshots]`
- Existing app launches still work. `[VERIFY with bundle and browser smoke]`

## 8. Phase 5: Command Objects

Purpose: promote commands into registered AppForge parts.

### Files To Modify

- `webgpu-os/kernel/CommandBus.js`
- AppForge registry modules from Phase 1
- App command modules in migration order:
  - Notepad
  - Files
  - Terminal
  - Paint

### Command Shape

```js
{
  id: "file.open",
  title: "Open File",
  tags: ["domain.files", "action.open", "data.file"],
  permissions: ["fs.read"],
  inputs: [{ name: "path", type: "string", required: true }],
  outputs: [{ name: "file", type: "file" }],
  undo: "none",
  risk: "low",
  handler: async (ctx, input) => {}
}
```

### Implementation Steps

1. Add `CommandBus.registerObject(commandDefinition)`.
2. Keep existing string command registration working.
3. Validate command objects through AppForge definitions.
4. Dispatch object commands through the existing command log path.
5. Add command pipeline runner for registered commands only.
6. Migrate Notepad commands first.
7. Migrate Files commands second.
8. Migrate Terminal commands third.
9. Migrate Paint commands fourth.

### Acceptance Criteria

- Existing command IDs still dispatch. `[DONE: legacy register/dispatch path preserved]`
- Object commands dispatch through the same bus. `[DONE: registerObject wraps dispatch]`
- Unknown pipeline command IDs are rejected. `[DONE: runPipeline requires exact object command IDs]`
- Command logs include object command IDs. `[DONE: object commands use existing dispatch log]`
- Migrated commands include tags and permissions. `[DONE: Notepad and Files first command batches migrated]`

## 9. Phase 6: Layout Zones

Purpose: add AppForge workspace zones without breaking floating windows.

### Folders And Files To Add Or Modify

- `webgpu-os/appforge/layout/LayoutEngine.js`
- `webgpu-os/appforge/layout/WorkspaceState.js`
- `webgpu-os/appforge/layout/index.js`
- `plauna/workspace/PanelLayout.js`
- `plauna/workspace/Workspace.js`
- `webgpu-os/shell/Desktop.js`

### Required Zones

- `top`
- `left`
- `center`
- `right`
- `bottom`
- `floating`
- `modal`
- `overlay`
- `status`

### Implementation Steps

1. Add a data model for zones, tabs, panels, split weights, pin state, and
   collapsed state.
2. Add layout diff generation.
3. Add layout validation.
4. Add restore from saved layout state.
5. Add AppForge workspace host mode inside Desktop.
6. Keep current app windows using the current path.
7. Allow registered panels to mount into zones.

### Acceptance Criteria

- Existing floating Desktop windows still work.
- AppForge workspace can mount at least left, center, right, bottom, overlay,
  and status zones. `[DONE: WorkspaceHost]`
- Layout diff shows added, removed, moved, and resized panels. `[DONE: LayoutEngine.diff()]`
- Invalid zone IDs are rejected. `[DONE: WorkspaceState validation]`
- Existing floating Desktop windows still work. `[DONE: Desktop launch path unchanged]`
- Layout restore/save exists. `[DONE: kernel localStorage snapshot persistence]`

## 10. Phase 7: Blueprints And AppFactory

Purpose: assemble workspaces from semantic requirements.

### New Folders And Files

- `webgpu-os/appforge/blueprints/AppFactory.js`
- `webgpu-os/appforge/blueprints/blueprints.js`
- `webgpu-os/appforge/blueprints/index.js`

### Required APIs

```js
AppFactory.create(profileId, context);
AppFactory.preview(profileId, context);
AppFactory.diff(currentWorkspace, proposedWorkspace);
AppFactory.validateBlueprint(blueprint);
```

### Implementation Steps

1. Add blueprint schema.
2. Add required and optional part resolution.
3. Add tag-based zone wants.
4. Add deterministic candidate scoring.
5. Add permission preview.
6. Add failure explanation for missing required parts.
7. Add `profile.textEditing` as the first internal blueprint.

### Acceptance Criteria

- Text editing profile selects file tree, editor, outline, terminal, and status
  candidates when available.
- Missing required parts return a clear error.
- Preview produces a layout plan without mutating live workspace.
- Create mutates only after validation succeeds.

## 11. Phase 8: Terminal Service

Purpose: turn Terminal into a persistent AppForge service.

### Files To Add Or Modify

- `webgpu-os/appforge/services/terminal/TerminalService.js`
- `webgpu-os/apps/terminal/index.js`
- `webgpu-os/kernel/ProcessTable.js`
- `webgpu-os/appforge/context/ContextGraph.js`

### Required State

- `sessionId`
- `cwd`
- `pid`
- `command`
- `stdout`
- `stderr`
- `exitCode`
- `startedAt`
- `endedAt`

### Implementation Steps

1. Extract command execution state from UI into service methods.
2. Keep current Terminal UI mounted through the existing app.
3. Register `os.terminal` service in the service container.
4. Register terminal session and cwd context nodes.
5. Add output stream subscription.
6. Connect process metadata to `ProcessTable`.
7. Register terminal commands as command objects.

### Acceptance Criteria

- Existing Terminal UI still works.
- Multiple panels can observe terminal session output.
- CWD updates context graph.
- Exit code is recorded for completed commands.

## 12. Phase 9: Package Exports

Purpose: let packages safely export AppForge parts.

### Files To Modify

- `webgpu-os/packages/PackageManager.js`
- `webgpu-os/kernel/schema/OsSchemas.js`
- `webgpu-os/docs/PACKAGING.md`
- `webgpu-os/docs/APP_MANIFEST_SPEC.md`

### Package Metadata

```js
{
  appforge: {
    exports: {
      panels: [],
      tools: [],
      commands: [],
      services: [],
      blueprints: [],
      layouts: [],
      themes: []
    },
    permissions: [],
    tags: [],
    sandbox: "iframe"
  }
}
```

### Implementation Steps

1. Extend package schema.
2. Validate AppForge exports after trust checks.
3. Register exports only after package authorization.
4. Roll back registry changes if installation fails.
5. Keep existing package app registration working.
6. Update package docs.

### Acceptance Criteria

- Existing package installs still work.
- Invalid AppForge exports fail safely.
- Failed export registration rolls back cleanly.
- Untrusted packages remain iframe-isolated.

### Implementation Notes

- `webgpu-os/appforge/packages/PackageExports.js` collects, validates,
  registers, unregisters, and restores package-owned AppForge exports.
- `PackageManager.install()` validates `manifest.appforge.exports` after package
  verification and before registration.
- `PackageManager.remove()` and `PackageManager.rollback()` unregister current
  exports; rollback registers exports from the rollback manifest.
- `PackageBuilder.buildV2()`, `exportPackageV2()`, and legacy `exportPackage()`
  preserve `manifest.appforge` metadata.

## 13. Phase 10: Timeline And Lenses

Purpose: record workspace history and support alternate views over context.

### New Folders And Files

- `webgpu-os/appforge/timeline/Timeline.js`
- `webgpu-os/appforge/timeline/index.js`
- `webgpu-os/appforge/lenses/LensRegistry.js`
- `webgpu-os/appforge/lenses/index.js`

### Implementation Steps

1. Record layout changes.
2. Record command execution events.
3. Record context graph invalidations.
4. Add timeline snapshot and replay APIs.
5. Add lens registration.
6. Add lens activation over existing context nodes.

### Acceptance Criteria

- Timeline can replay layout-level events.
- Command events include command ID, inputs metadata, result status, and
  timestamp.
- Lenses switch view state without replacing source context.

### Implementation Notes

- `Timeline` records layout restores, command dispatches, context invalidations,
  lens activations, and package export changes.
- `Timeline.replayLayout()` can replay recorded layout-level events into a
  `LayoutEngine` target without self-recording replay events.
- `CommandBus._log()` records command events with input/result metadata instead
  of raw command payloads.
- `LensRegistry` registers built-in workspace, terminal, package, and all-context
  lenses over `ContextGraph.snapshot()` output.
- `LensRegistry.activate()` updates private view state and does not replace or
  mutate source context graph nodes.
- `syscalls.appforge` exposes timeline read APIs and lens list/preview/activate
  APIs; layout replay remains service/internal because it mutates layout state.

## 14. Phase 11: Visual Builder And Starter Packs

Purpose: expose AppForge composition to users.

### Deliverables

- Visual workspace builder.
- Registry browser.
- Blueprint editor.
- Starter packs:
  - `pack.core.files`
  - `pack.core.text`
  - `pack.core.terminal`
  - `pack.creative.paint`
  - `pack.admin.os`
  - `pack.gpu.demos`

### Acceptance Criteria

- Builder can create a valid blueprint.
- Builder can preview layout diff.
- Starter packs register only valid parts.
- Packs can be disabled without breaking core OS boot.

### Implementation Notes

- `StarterPackRegistry` registers built-in pack manifests and validates every
  package marker and part definition before registry mutation.
- Built-in starter packs cover files, text, terminal, creative paint, admin OS,
  and GPU demos.
- `WorkspaceBuilder` creates draft blueprints, validates/saves blueprints through
  `AppFactory`, previews layout diffs, creates workspaces, browses registry
  parts, and exposes pack enable/disable controls.
- `kernel.starterPacks` is registered as `os.starterPacks`; `kernel.workspaceBuilder`
  is registered as `os.workspaceBuilder`.
- `syscalls.appforge` exposes registry browsing, blueprint draft/save/preview,
  workspace creation, and starter pack controls. Mutating methods are capability
  guarded.
- `webgpu-os/apps/appforge-builder/` provides the user-facing builder panel.

## 15. Global Test Matrix

Run after every phase:

```bash
python bundle_engine.py --target webgpu-os
```

Run after documentation or schema changes:

```bash
python MD/tools/build_docs.py
python MD/tools/build_llms.py
```

Manual smoke checks after phases that touch boot, shell, layout, packages, or
permissions:

```bash
python start_server.py
```

Browser checks:

- Desktop boots.
- Files launches.
- Terminal launches.
- Notepad launches.
- Paint launches.
- Package manager launches.
- Permissions manager launches.
- Existing app windows can open and close.

Security checks:

- Missing permissions block syscalls.
- Permission aliases cannot bypass canonical checks.
- Untrusted packages remain sandboxed.
- Raw GPU access remains brokered through `SurfaceManager`.

## 16. First Coding Sprint

Phase 1 through Phase 8 are implemented. Continue with Phase 9 Package Exports.

### Implemented Sprint Files

- `webgpu-os/appforge/registry/AppForgeRegistry.js`
- `webgpu-os/appforge/registry/index.js`
- `webgpu-os/appforge/definitions/index.js`
- `webgpu-os/appforge/adapters/manifestAdapter.js`
- `webgpu-os/appforge/adapters/index.js`
- `webgpu-os/appforge/tags/index.js`
- `webgpu-os/appforge/scoring/index.js`
- `webgpu-os/appforge/sdk/index.js`
- `webgpu-os/appforge/services/ServiceContainer.js`
- `webgpu-os/appforge/services/kernelServices.js`
- `webgpu-os/appforge/services/terminal/TerminalService.js`
- `webgpu-os/appforge/services/terminal/index.js`
- `webgpu-os/appforge/services/index.js`
- `webgpu-os/appforge/context/ContextGraph.js`
- `webgpu-os/appforge/context/index.js`
- `webgpu-os/appforge/commands/commandObjects.js`
- `webgpu-os/appforge/commands/pipelines.js`
- `webgpu-os/appforge/commands/index.js`
- `webgpu-os/appforge/layout/WorkspaceState.js`
- `webgpu-os/appforge/layout/LayoutEngine.js`
- `webgpu-os/appforge/layout/WorkspaceHost.js`
- `webgpu-os/appforge/layout/index.js`
- `webgpu-os/appforge/blueprints/AppFactory.js`
- `webgpu-os/appforge/blueprints/blueprints.js`
- `webgpu-os/appforge/blueprints/index.js`
- `webgpu-os/appforge/packages/PackageExports.js`
- `webgpu-os/appforge/packages/index.js`
- `webgpu-os/appforge/timeline/Timeline.js`
- `webgpu-os/appforge/timeline/index.js`
- `webgpu-os/appforge/lenses/LensRegistry.js`
- `webgpu-os/appforge/lenses/index.js`
- `webgpu-os/appforge/packs/StarterPacks.js`
- `webgpu-os/appforge/packs/index.js`
- `webgpu-os/appforge/builder/WorkspaceBuilder.js`
- `webgpu-os/appforge/builder/index.js`
- `webgpu-os/appforge/index.js`
- `webgpu-os/apps/appforge-builder/manifest.json`
- `webgpu-os/apps/appforge-builder/index.js`
- `webgpu-os/apps/notepad/appforgeCommands.js`
- `webgpu-os/apps/notepad/appforge/commands.js`
- `webgpu-os/apps/notepad/appforge/parts.js`
- `webgpu-os/apps/notepad/appforge/index.js`
- `webgpu-os/apps/files/appforgeCommands.js`
- `webgpu-os/apps/files/appforge/commands.js`
- `webgpu-os/apps/files/appforge/parts.js`
- `webgpu-os/apps/files/appforge/index.js`

### Optional Future Hardening

- Wire `tests/appforge-smoke-runner.html` into CI or a Python browser
  automation command if the repo adopts a shared browser-test harness.

### Active Non-Goals

- Do not remove the existing Desktop floating-window launch behavior.
- Do not alter permissions behavior.

### Current Done Evidence

- Registry can register, resolve, query, list, validate, and unregister parts.
- Tags are validated.
- Scoring is deterministic.
- Current app manifests can be adapted into registry candidates.
- Existing WebGPU OS boot remains unchanged.
- Kernel services are available through `kernel.services` and
  `kernel.appForgeServices`.
- Shared context is available through `kernel.contextGraph` and
  `kernel.services.get("os.contextGraph")`.
- AppForge command objects can be registered through `CommandBus.registerObject()`
  and `syscalls.cmd.registerObject()`.
- Exact-ID command-object pipelines can be executed through
  `CommandBus.runPipeline()`.
- OS command tooling surfaces AppForge object metadata, risk, undo, tags, and
  permissions.
- AppForge layout state validates required zones, tracks panels/tabs/splits,
  produces diffs, restores snapshots, and is exposed through
  `kernel.layoutEngine` / `os.layoutEngine`.
- Desktop mounts an AppForge workspace host that exposes all required zones
  through `kernel.appForgeWorkspaceHost` / `os.workspaceHost` while preserving
  current floating-window launches.
- AppFactory validates blueprint schemas, previews layout diffs without
  mutation, creates only after validation succeeds, and exposes permission
  previews.
- `profile.textEditing` deterministically selects Files, Notepad, and Terminal
  candidates when registered.
- Discovered app manifests are imported into `os.appForgeRegistry` as panel
  candidates after normal app discovery.
- Terminal state is backed by `os.terminal` with persistent sessions, cwd,
  pid/exit metadata, stdout/stderr streams, output subscriptions, and context
  graph updates.
- Terminal registers AppForge command objects for create, run, and clear session
  flows.
- Public AppForge contracts are documented in `MD/webgpu-os/appforge-contracts.md`.
- AppForge Contracts is linked from the curated docs nav, WebGPU OS overview,
  section index, and architecture page.
- `python MD\tools\build_docs.py`, `python MD\tools\build_llms.py`, and
  `PYTHONIOENCODING=utf-8 python bundle_engine.py --target webgpu-os` pass.
- Local HTTP checks return 200 for `/`, `/webgpu-os/index.html`, and
  `/webgpu-os/apps/appforge-builder/manifest.json`.
- Headless Chrome CDP QA proves Desktop boot, AppForge Builder launch through
  Start Menu search, starter pack disable/enable, blueprint preview, save, and
  workspace create.
- Browser QA found no AppForge unavailable/error state.
- Plauna hot reload now uses deterministic content hashing and real browser
  module/CSS validation instead of simulated random file-change/validation
  failures; the prior `Panel.js` validation retry warning is fixed.
- Representative browser app launch QA proves Files, Terminal, Notepad, Paint,
  Package Manager, and Permissions mount through the Desktop launch path with no
  hard console issues.
- `tests/appforge-package-ui-smoke.html` proves Package Manager file-install UI
  handles AppForge-export packages: v1 install, v2 update/replacement, rollback,
  and remove all preserve the expected AppForge registry state.
- `tests/index.html` links the AppForge package UI smoke from the Operational QA
  section, and a Chrome CDP pass verifies navigating through that card reaches a
  passing smoke result.
- `tests/appforge-catalog-launch-smoke.html` proves all 39 discovered app
  manifests launch through the Desktop event path and mount as panels or
  overlays.
- A Chrome CDP catalog pass verifies the 39-app sweep with no hard console
  errors or exceptions.
- `tests/appforge-smoke-runner.html` runs the AppForge package UI smoke and the
  39-app catalog launch smoke sequentially, and a Chrome CDP pass verifies the
  aggregate 2-smoke runner result.
- `os.fractal` now guards zero-size canvas frames before `createImageData()`,
  preventing headless/early-layout launch exceptions.
- `os.files` declares the `cmd` permission required by its AppForge command
  object registration path, eliminating the guarded `cmd.register` warning.
- `os.files` now has an app-owned AppForge module folder with command objects,
  reusable file panel/tool definitions, and a modular Files workspace profile;
  the previous top-level `appforgeCommands.js` remains as a compatibility shim.
- `os.notepad` now has an app-owned AppForge module folder with command
  objects, reusable text editor/navigation/outline/status/output part
  definitions, and a modular Notepad workspace profile; the previous top-level
  `appforgeCommands.js` remains as a compatibility shim.
- Terminal UI now subscribes to the service stream and sends commands through
  `terminal.runCommand()` while retaining a fallback path.
- Packages can export AppForge parts through `manifest.appforge.exports` after
  package verification and authorization.
- Failed AppForge package export registration restores prior same-package
  definitions.
- Package removal and rollback unregister current AppForge exports, and rollback
  registers exports from the rollback manifest.
- Timeline records layout restores, command dispatch metadata, context
  invalidations, package export changes, and lens activations.
- Timeline can replay layout-level events into a `LayoutEngine` target.
- Lenses can derive alternate views from context snapshots without mutating
  source context graph nodes.
- Starter packs register only validated package and blueprint definitions.
- WorkspaceBuilder can create valid blueprint drafts, save them through
  AppFactory, and preview layout diffs.
- AppForge Builder app is discoverable through the OS app manifest index.

## 17. Stop Conditions

Stop implementation and reassess if any of these happen:

- Existing OS boot breaks.
- Current app manifests can no longer load.
- AppRegistry behavior changes unintentionally.
- Permission checks become less strict.
- Package trust checks are bypassed.
- Registry requires runtime LLM selection.
- Layout work starts before registry and tags pass validation.
- Terminal UI is broken before TerminalService is complete.

## 18. Definition Of Done

AppForge v1 is complete when:

- AppForge registry is the source of truth for reusable parts.
- Current apps can coexist with registered parts.
- Commands, services, panels, tools, blueprints, layouts, packages, and themes
  can be registered.
- Tag scoring is deterministic and explainable.
- A text editing blueprint can assemble a working workspace.
- Terminal is available as both a service and panel.
- Packages can export AppForge parts safely.
- Permissions remain canonical and default-deny.
- Existing WebGPU OS apps still launch.
- Docs describe the public AppForge contracts.
