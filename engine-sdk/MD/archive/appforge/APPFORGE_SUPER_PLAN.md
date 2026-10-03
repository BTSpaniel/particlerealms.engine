<!--
SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
-->

# APPFORGE SUPER PLAN

## 1. Executive Decision

AppForge OS should be implemented as a deterministic refactor layer over the
existing WebGPU OS stack, not as a replacement.

The repository already has the hard operating-system pieces that AppForge
needs:

- A kernel bootstrap and service owner.
- An app discovery and launch path.
- A package manager with trust, verification, rollback, and built-in sync.
- A permission system with default-deny syscall guards.
- A desktop shell with window hosting and app lifecycle.
- Plauna panels, workspaces, DOM/GPU panel primitives, and layout primitives.
- Many reusable apps and domain modules: Files, Terminal, Notepad, Paint,
  package managers, permission managers, log/service monitors, GPU demos,
  editor tools, and AGI tools.

The missing AppForge layer is a unified semantic runtime:

- A registry for all app-building parts.
- Namespaced tags and deterministic scoring.
- A context graph for provides/consumes wiring.
- A service container facade.
- An app factory that assembles blueprints into running workspaces.
- A zone layout system with docking, tabs, layout diffs, and restoration.
- First-class registered commands, tools, panels, services, workflows, themes,
  packages, and blueprints.

The guiding rule is simple: reuse the current OS primitives wherever they are
already correct, then refactor them into AppForge contracts.

## 2. Scan Basis

- Repository root: `C:\Coding\game`
- Git snapshot inspected: `5a4f69a`
- Worktree state during scan: dirty; existing user changes must be preserved.
- Attached briefing reviewed: AppForge tag-semantic deterministic assembly plan.
- Session memory found: `_windsurf/session_memory.md`
- Targeted scan: 35 core/app/source/doc files, 38 app manifests, and broad repo
  searches across `webgpu-os/`, `plauna/`, `editor/`, and `agi/`.

No runtime LLM planner should be added. AppForge selection must remain
deterministic, inspectable, and reproducible.

## 3. Current Codebase Map

### 3.1 OS Kernel And Runtime

- `[EXISTS]` `webgpu-os/kernel/KernelBootstrap.js`
  - Central kernel bootstrap and service owner.
  - Owns GPU initialization, scheduler, event bus, process table, permissions,
    virtual filesystem, surfaces, VRAM tracking, drivers, schema registry,
    package manager, trust store, theme engine, session store, tool driver,
    syscalls, and built-in commands.
  - This should become the backing runtime for AppForge services.

- `[EXISTS]` `webgpu-os/kernel/AppRegistry.js`
  - Discovers app manifests from `webgpu-os/apps/index.json`.
  - Validates app manifests and supports packaged app registration.
  - Current scope is app-level only.
  - AppForge needs a broader registry for every reusable part.

- `[EXISTS]` `webgpu-os/kernel/CommandBus.js`
  - Registers, aliases, dispatches, lists, and logs commands.
  - Already supports dot-namespaced command IDs and history.
  - Needs AppForge command object metadata: tags, inputs, outputs, permissions,
    undo behavior, risk, and pipeline compatibility.

- `[EXISTS]` `webgpu-os/kernel/Permissions.js`
  - Provides capability checks, manifest registration, grants, revokes,
    requests, audit logging, and persistence.
  - Should remain canonical.
  - AppForge permission names should map into this existing model.

- `[EXISTS]` `webgpu-os/packages/PackageManager.js`
  - Handles install, remove, update, verify, repair, rollback, built-in sync,
    trust tiers, execution policy, provenance, integrity, and package app
    registration.
  - Should be extended to export/import AppForge parts.

- `[EXISTS]` `webgpu-os/shell/PackageHostRealm.js`
  - Provides iframe-based isolation for untrusted packages.
  - Should become the sandbox foundation for AppForge package parts.

- `[EXISTS]` `webgpu-os/kernel/ThemeEngine.js`
  - Applies, previews, imports, exports, and emits theme changes.
  - Should be exposed as a registered theme service.

- `[EXISTS]` `webgpu-os/kernel/SurfaceManager.js`
  - Allocates WebGPU surfaces to panels and tracks VRAM quota.
  - Should back registered GPU panels.

- `[EXISTS]` `webgpu-os/kernel/ProcessTable.js`
  - Tracks running apps, panels, process-like metadata, and resource estimates.
  - Should back AppForge process/session visibility.

- `[EXISTS]` `webgpu-os/kernel/SearchManager.js`
  - Provides command palette search over apps, commands, and providers.
  - Should be reused for registry search and discovery.

- `[EXISTS]` `webgpu-os/kernel/ToolDriver.js`
  - Provides OS-native tool registration and execution for tool callers.
  - Should inform AppForge tool contract design.

### 3.2 Shell And Plauna

- `[EXISTS]` `webgpu-os/shell/Desktop.js`
  - Hosts app windows, launches apps, gates quarantine, applies manifest
    patches, creates panels, registers processes, wires syscalls, and releases
    app resources on close.
  - Current layout model is mostly floating desktop windows.
  - AppForge needs zones, tabs, docking, collapse, pinning, and layout diffs.

- `[EXISTS]` `plauna/workspace/Panel.js`
  - Provides `Panel`, `DOMPanel`, and `GPUPanel` lifecycle primitives.
  - Should become the base panel host contract.

- `[EXISTS]` `plauna/workspace/Workspace.js`
  - Holds panels and applies layout.
  - Should be extended or adapted into AppForge workspace state.

- `[EXISTS]` `plauna/workspace/PanelLayout.js`
  - Supports `fullscreen`, `float`, `split`, and `tile` layout modes.
  - Needs AppForge zones, dock splitters, tab groups, and persistence.

- `[EXISTS]` `plauna/core/registry.js`
  - Has a Plauna-specific registry for views, surfaces, templates, and
    factories.
  - Useful as precedent, but not sufficient as the AppForge part registry.

### 3.3 Existing Apps And Reusable Parts

- `[EXISTS]` `os.files`
  - File manager foundation for `core.fileTree`, `core.fileBrowser`,
    file-open flows, and workspace file context.

- `[REFACTOR]` `os.terminal`
  - Existing interactive kernel REPL window.
  - Should be split into a persistent terminal service plus one or more terminal
    panels.

- `[REFACTOR]` `os.notepad`
  - Rich internal workbench with tabs, menus, panels, project model, symbols,
    headings, tasks, search, status, and embedded terminal.
  - Should donate reusable text editor, outline, search, status bar, and command
    parts.

- `[REFACTOR]` `os.paint`
  - Rich creative app with tools, commands, panels, docks, brush engine, fill
    engine, gradient engine, selection engine, and transform engine.
  - Should donate creative tools and panels for the AppForge creative starter
    pack.

- `[EXISTS]` GPU demo apps
  - `os.particles`, `os.fractal`, and `os.pinball` demonstrate GPU panel
    launch and surface use.
  - Use them as GPU panel contract examples.

- `[EXISTS]` system apps
  - Package manager, package studio, permissions, storage manager, log viewer,
    service manager, command registry, settings, and control panel already map
    well to AppForge admin panels.

- `[REFACTOR]` editor and AGI subsystems
  - Existing panels and domain modules are useful for later packs.
  - They are more directly coupled than AppForge parts should be, so extract
    them after the registry and context graph exist.

## 4. Reuse Inventory

### 4.1 Core Services

Reuse the existing kernel services through an AppForge service facade:

- `appRegistry`
- `commandBus`
- `permissions`
- `packageManager`
- `themeManager`
- `surfaceManager`
- `processTable`
- `searchManager`
- `storageManager`
- `sessionStore`
- `toolDriver`
- `events`
- `syscalls`

The facade should avoid duplicating these systems. It should normalize access
through `ctx.services.get(id)`.

### 4.2 UI And Panel Hosting

Reuse:

- Plauna panel lifecycle.
- Desktop window creation and app launch.
- `SurfaceManager` for GPU panel surfaces.
- `WindowStateStore` and `WindowSizer` for window persistence and sizing.

Refactor:

- App launch should be able to host registered AppForge panels, not only app
  entry classes.
- Layout state should be AppForge workspace state, not only window geometry.

### 4.3 Files

Promote `os.files` into:

- `core.fileTree`
- `core.fileBrowser`
- `core.fileActions`
- `core.fileContext`

Expected tags:

- `domain.files`
- `action.browse`
- `action.open`
- `action.write`
- `role.navigator`
- `data.file`
- `data.directory`

Migration rule: keep `os.files` launchable from its current manifest while
AppForge-owned files live under `webgpu-os/apps/files/appforge/`. Top-level
legacy AppForge files should remain as re-export shims until the migrated parts
are proven and the old app surface is removed manually.

### 4.4 Terminal

Reuse current Terminal UI and command experience.

Refactor into:

- `os.terminal` service.
- `terminal.panel`.
- `terminal.session`.
- `terminal.outputStream`.
- `terminal.commandHistory`.

The service must track:

- `sessionId`
- `cwd`
- `pid`
- `command`
- `stdout`
- `stderr`
- `exitCode`
- `startedAt`
- `endedAt`

### 4.5 Notepad

Extract reusable parts:

- `core.textEditor`
- `core.markdownPreview`
- `core.outline`
- `core.projectSearch`
- `core.statusBar`
- `core.problemList`
- `core.documentTabs`

Refactor local commands into AppForge command objects.

Migration rule: keep `os.notepad` launchable from its current manifest while
AppForge-owned text editor, navigation, outline, status, output, tool, command,
and profile definitions live under `webgpu-os/apps/notepad/appforge/`. The old
top-level AppForge command file should stay as a re-export shim until manual
cleanup.

### 4.6 Paint

Extract reusable parts:

- `creative.canvas`
- `creative.toolPalette`
- `creative.brushEngine`
- `creative.fillEngine`
- `creative.gradientEngine`
- `creative.selectionEngine`
- `creative.transformEngine`
- `creative.layerPanel`
- `creative.colorPanel`

Refactor Paint tools into registered tools with typed inputs, outputs, tags,
permissions, and undo metadata.

### 4.7 Packages And Trust

Extend `.prpkg` to include AppForge exports:

- Registered panels.
- Registered tools.
- Registered commands.
- Registered services.
- Registered blueprints.
- Registered layouts.
- Registered themes.
- Permission declarations.
- Trust and sandbox policy.

Keep current trust, provenance, integrity, rollback, and execution-policy code.

## 5. Refactor And Build Matrix

| Area | Status | Decision |
|------|--------|----------|
| Kernel runtime | `[EXISTS]` | Reuse as backing runtime. |
| App registry | `[REFACTOR]` | Keep app discovery, add AppForge part registry. |
| Unified part registry | `[BUILD]` | Add registry for panels, tools, commands, services, layouts, themes, workflows, blueprints, packages. |
| Tag semantics | `[BUILD]` | Add namespaced tags and deterministic scoring. |
| Context graph | `[BUILD]` | Add directed dependency graph for provides/consumes. |
| Event bus | `[EXISTS]` | Reuse kernel events through scoped AppForge APIs. |
| Service container | `[REFACTOR]` | Wrap existing kernel services in `ctx.services.get(id)`. |
| Command bus | `[REFACTOR]` | Keep dispatch path, add command object metadata and pipelines. |
| Layout engine | `[REFACTOR]` | Extend Plauna/Desktop into zones, tabs, docking, splitters, and layout diffs. |
| App blueprints | `[BUILD]` | Add blueprint/profile manifests and AppFactory. |
| Terminal | `[REFACTOR]` | Split UI from persistent terminal service. |
| Permissions | `[REFACTOR]` | Keep canonical engine, add AppForge aliases. |
| Sandbox | `[REFACTOR]` | Extend PackageHostRealm with scoped events and service bridges. |
| Session timeline | `[BUILD]` | Add workspace timeline separate from credential/session store. |
| Lens system | `[BUILD]` | Add alternate registered views over shared context. |
| Visual workspace builder | `[BUILD]` | Build after registry, layout, and blueprints are stable. |
| Package ecosystem | `[REFACTOR]` | Extend `.prpkg` manifests for AppForge parts. |

## 6. Public Interfaces To Add

### 6.1 Registry

```js
AppForgeRegistry.register(definition);
AppForgeRegistry.query(criteria);
AppForgeRegistry.resolve(id);
AppForgeRegistry.validate(definition);
AppForgeRegistry.unregister(id);
AppForgeRegistry.list(type);
```

Minimum definition shape:

```js
{
  id: "core.textEditor",
  type: "panel",
  title: "Text Editor",
  version: "1.0.0",
  tags: ["domain.text", "action.edit", "role.editor", "data.document"],
  provides: ["selection", "document"],
  consumes: ["file", "theme"],
  permissions: ["fs.read", "fs.write"],
  entry: "./parts/core/textEditor.js",
  lifecycle: {
    mount: "mount",
    unmount: "unmount"
  }
}
```

### 6.2 SDK Helpers

```js
definePanel(definition);
defineTool(definition);
defineCommand(definition);
defineService(definition);
defineBlueprint(definition);
```

These helpers must validate definitions before registration.

### 6.3 AppFactory

```js
AppFactory.create(profileId, context);
AppFactory.preview(profileId, context);
AppFactory.diff(currentWorkspace, proposedWorkspace);
AppFactory.validateBlueprint(blueprint);
```

Responsibilities:

- Load a blueprint/profile.
- Query registry candidates.
- Score candidates deterministically.
- Resolve required parts.
- Produce a workspace layout plan.
- Return a diff before mutating the running workspace.

### 6.4 ContextGraph

```js
ContextGraph.setNode(id, value, metadata);
ContextGraph.link(sourceId, targetId, relation);
ContextGraph.invalidate(id, reason);
ContextGraph.snapshot();
ContextGraph.subscribe(id, callback);
```

Required initial node types:

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

### 6.5 ServiceContainer

```js
ServiceContainer.register(id, service, metadata);
ServiceContainer.get(id);
ServiceContainer.has(id);
ServiceContainer.list();
```

Initial services should wrap existing kernel objects rather than create
duplicates.

### 6.6 Registered Command Shape

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

Command objects must support:

- Typed inputs and outputs.
- Permission requirements.
- Risk levels.
- Optional undo behavior.
- Pipeline compatibility.
- Audit logging through the existing command log.

## 7. Tag Model

### 7.1 Required Namespaces

Use these namespaces for v1:

- `domain.*`
- `action.*`
- `role.*`
- `data.*`
- `runtime.*`
- `risk.*`
- `surface.*`
- `permission.*`

Examples:

- `domain.files`
- `domain.text`
- `domain.paint`
- `domain.terminal`
- `action.open`
- `action.edit`
- `action.run`
- `role.navigator`
- `role.editor`
- `role.output`
- `data.file`
- `data.document`
- `runtime.gpu`
- `risk.low`
- `surface.window`

### 7.2 Scoring

Initial deterministic scoring:

1. Add points for exact tag intersection.
2. Add points for required `provides`.
3. Subtract points for missing required `consumes`.
4. Add a zone affinity bonus.
5. Add co-occurrence bonus from previous accepted layouts.
6. Subtract risk penalty when a safer equivalent exists.
7. Tie-break by explicit blueprint priority, then stable lexical ID.

The scorer must return an explanation object:

```js
{
  id: "core.fileTree",
  score: 42,
  reasons: [
    "matched domain.files",
    "matched role.navigator",
    "zone bonus left",
    "provides activeFile"
  ]
}
```

## 8. Layout Model

### 8.1 Zones

Initial zones:

- `top`
- `left`
- `center`
- `right`
- `bottom`
- `floating`
- `modal`
- `overlay`
- `status`

### 8.2 Zone Features

Each zone must support:

- Tabs.
- Split panes.
- Collapse.
- Pin.
- Resize.
- Saved layout state.
- Restore by profile.
- Diff preview before applying.

### 8.3 Desktop Integration

Desktop should continue to support existing floating app windows.

AppForge workspaces should be introduced as a hosted workspace mode. Existing
apps must continue to launch through their current manifests while AppForge
parts are migrated.

## 9. Blueprint Model

Blueprints define intended workspace composition. They do not hard-code every
panel when tags and required capabilities are enough.

Example:

```js
{
  id: "profile.textEditing",
  title: "Text Editing",
  tags: ["domain.text", "action.edit"],
  zones: {
    left: {
      wants: ["role.navigator", "domain.files"]
    },
    center: {
      wants: ["role.editor", "data.document"],
      requires: ["core.textEditor"]
    },
    right: {
      wants: ["role.inspector", "role.outline"]
    },
    bottom: {
      wants: ["domain.terminal", "role.output"]
    }
  }
}
```

Blueprints must support:

- Required parts.
- Optional parts.
- Tag-based wants.
- Zone preferences.
- Permission preview.
- Layout diff.
- Failure explanation when required parts are unavailable.

## 10. Terminal Refactor

The current Terminal app is useful, but AppForge needs terminal state as a
service.

Build:

- `os.terminal` service.
- `terminal.session` context node.
- `terminal.cwd` context node.
- `terminal.panel` registered panel.
- `terminal.runCommand` registered command.

Keep:

- Current terminal command UI.
- Existing kernel command access.
- Existing filesystem command behavior.

Add:

- Persistent session IDs.
- Working directory tracking.
- Process metadata in `ProcessTable`.
- Output stream subscriptions.
- Exit code tracking.
- Context graph updates.

## 11. Command Refactor

Current state:

- Kernel commands exist in `CommandBus`.
- Many app commands are local to app modules.

Refactor order:

1. Notepad commands.
2. Files commands.
3. Terminal commands.
4. Paint commands.
5. System manager commands.

Each migrated command must include:

- Stable ID.
- Title.
- Tags.
- Permissions.
- Inputs.
- Outputs.
- Risk.
- Undo policy.
- Handler.

Command pipelines should run only registered commands.

## 12. Permission Strategy

Do not replace the existing permission engine.

Add AppForge aliases:

| AppForge Alias | Canonical Capability |
|----------------|----------------------|
| `files.read` | `fs.read` or current file-read capability |
| `files.write` | `fs.write` or current file-write capability |
| `terminal.run` | terminal command capability |
| `gpu.surface` | `gpu.acquireSurface` |
| `packages.install` | package install capability |
| `theme.apply` | theme apply capability |

Alias resolution must happen before permission checks. Audit logs must record
both the alias and canonical capability.

## 13. Sandbox Strategy

Keep `PackageHostRealm` as the sandbox foundation.

Extend it with:

- Scoped event subscriptions.
- Safe service bridges.
- Permission-filtered command dispatch.
- Registry-visible package parts.
- Explicit denial for raw GPU access unless brokered by `SurfaceManager`.

Untrusted packages must stay iframe-isolated.

## 14. Package Strategy

Extend package metadata to include AppForge exports:

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

Package install must:

1. Verify integrity and trust.
2. Validate exported AppForge definitions.
3. Register allowed parts.
4. Reject invalid or over-permissioned parts.
5. Roll back registry changes if installation fails.

## 15. Starter Packs

Build starter packs after the registry, context graph, layout engine, and
blueprint system are stable.

Initial packs:

- `pack.core.files`
  - File tree, file browser, file commands, storage panels.

- `pack.core.text`
  - Text editor, markdown preview, outline, search, status, document tabs.

- `pack.core.terminal`
  - Terminal service, terminal panel, output stream, command history.

- `pack.creative.paint`
  - Canvas, tools, brush engine, fill engine, gradient engine, selection,
    layers, color panels.

- `pack.admin.os`
  - Package manager, permissions, logs, service manager, command registry,
    settings.

- `pack.gpu.demos`
  - Particles, fractal, pinball, GPU surface examples.

## 16. Implementation Phases

### Phase 1: Registry Foundation

- Add AppForge registry module.
- Add schema validation for all part types.
- Add tag namespace validator.
- Add manifest adapter for current apps.
- Add registry inspector view using existing system UI patterns.
- Register current apps as blueprint or panel candidates.

Acceptance:

- Duplicate IDs are rejected.
- Invalid tags are rejected.
- Current app manifests can be adapted without breaking existing launch.
- Registry queries return deterministic results.

### Phase 2: Services And Context

- Add service container facade over kernel services.
- Add context graph.
- Add provides/consumes metadata.
- Add invalidation and subscription APIs.

Acceptance:

- Existing kernel services are accessible through `ctx.services.get(id)`.
- Context graph can represent active file, selection, terminal cwd, theme, and
  workspace.
- Invalidating a node notifies subscribers exactly once per change.

### Phase 3: Command Objects

- Extend `CommandBus` to accept registered command objects.
- Migrate Notepad, Files, Terminal, and Paint commands in that order.
- Add command pipeline runner.

Acceptance:

- Existing command dispatch still works.
- Migrated commands include tags and permissions.
- Pipelines reject unknown commands.

### Phase 4: Layout Engine

- Extend Plauna/Desktop layout into AppForge zones.
- Add tab groups, splitters, collapse, pinning, and saved state.
- Add layout diff preview.

Acceptance:

- Existing floating windows still work.
- AppForge workspace can mount left, center, right, bottom, overlay, and status
  zones.
- Layout diff can preview changes before applying.

### Phase 5: AppFactory And Blueprints

- Add blueprint/profile schemas.
- Add deterministic part selection.
- Add scoring explanation output.
- Add permission preview.

Acceptance:

- A text editing profile assembles file tree, editor, outline, terminal, and
  status parts.
- Missing required parts produce a clear failure explanation.
- Equivalent candidates tie-break deterministically.

### Phase 6: Terminal Service

- Extract terminal service from Terminal app.
- Add persistent sessions, cwd, output streams, pid, and exit code.
- Register terminal commands and context nodes.

Acceptance:

- Existing Terminal UI still works.
- Multiple terminal panels can attach to terminal sessions.
- CWD changes update the context graph.

### Phase 7: Package Exports

- Extend `.prpkg` metadata for AppForge exports.
- Validate exported parts during install.
- Register parts after package authorization.
- Roll back registry changes on failed install.

Acceptance:

- Existing package installs still work.
- Packages can export commands and panels.
- Invalid AppForge exports fail safely.

### Phase 8: Timeline, Lenses, Builder, Packs

- Add session timeline for workspace/app actions.
- Add lens registry for alternate views over context.
- Add visual workspace builder.
- Add starter packs.

Acceptance:

- Timeline can replay layout and command-level events.
- Lenses can switch views without replacing source context.
- Workspace builder produces valid blueprint output.

## 17. Test Plan

### 17.1 Static Tests

- Registry rejects duplicate IDs.
- Registry rejects invalid part types.
- Registry rejects invalid tag namespaces.
- Manifest adapter converts current app manifests.
- Permission aliases resolve to canonical capabilities.
- Package exports validate before registration.

### 17.2 Unit Tests

- Tag intersection scoring.
- Zone affinity scoring.
- Co-occurrence scoring.
- Stable tie-breaking.
- Context graph invalidation.
- Service container lookup.
- Command object validation.
- Command pipeline execution.
- Layout diff and restore.

### 17.3 Integration Tests

Serve the OS through HTTP:

```bash
python start_server.py
```

Verify:

- Desktop boots.
- Current apps still launch.
- Files opens.
- Terminal runs existing commands.
- Notepad opens and saves documents.
- Paint launches and tools still work.
- Package manager still installs trusted packages.
- Permission prompts still use default-deny behavior.

### 17.4 Regression Commands

Run after implementation phases that touch docs, manifests, packages, or OS
boot:

```bash
python bundle_engine.py --target webgpu-os
python MD/tools/build_docs.py
python MD/tools/build_llms.py
```

### 17.5 Security Tests

- Untrusted packages remain iframe-isolated.
- Missing permissions block syscalls.
- AppForge aliases cannot bypass canonical permissions.
- Package install rolls back failed AppForge registrations.
- Raw GPU access remains brokered by `SurfaceManager`.

## 18. Risks And Controls

| Risk | Control |
|------|---------|
| Registry duplicates current app registry | Keep `AppRegistry` for apps; AppForge registry references apps and parts. |
| Tags become vague | Enforce namespace validation and typed schemas. |
| Blueprint assembly becomes unpredictable | Use deterministic scoring and explanation output. |
| Permissions drift | Keep existing permission engine canonical. |
| Layout rewrite breaks Desktop | Introduce AppForge workspace mode alongside current floating windows. |
| Terminal refactor breaks existing REPL | Keep current Terminal UI and extract service behind it. |
| Packages bypass safety | Validate exports after trust checks and before registration. |
| Sandbox bridge leaks power | Use scoped services, permission-filtered commands, and no raw GPU in iframe realm. |

## 19. Immediate Next Work

Phase 1 through Phase 11 foundations now exist as modular AppForge folders.

Public AppForge contract docs now exist under `MD/webgpu-os/` and are linked
from the curated WebGPU OS docs navigation. Local HTTP checks prove the OS
entry point and AppForge Builder manifest resolve from `python start_server.py`.
Headless Chrome CDP QA proves Desktop boot, AppForge Builder launch, starter
pack disable/enable, blueprint preview, save, and workspace create. A
full app catalog launch smoke now proves all 39 discovered app manifests mount
through the Desktop event path with no hard console errors or exceptions. The
prior Plauna `Panel.js` validation retry warning was traced to simulated random
hot-reload validation and fixed by making Plauna hot reload use deterministic
content hashing plus real browser module/CSS validation.

Package install/update UI hardening now has a repeatable smoke harness at
`tests/appforge-package-ui-smoke.html`. It generates AppForge-export package
fixtures in-browser, installs v1 through Package Manager file install, updates
to v2 through the same UI path, verifies same-package AppForge export
replacement, rolls back through the Package Manager UI, then removes the package
and verifies the package-owned AppForge exports are unregistered.
`tests/appforge-smoke-runner.html` runs the package smoke and catalog launch
smoke sequentially as the aggregate AppForge browser smoke entry point. The
runner and both individual smokes are linked from `tests/index.html` under
Operational QA.

Implemented foundation deliverables:

1. `webgpu-os/appforge/registry/AppForgeRegistry.js`
2. `webgpu-os/appforge/tags/index.js`
3. `webgpu-os/appforge/scoring/index.js`
4. `webgpu-os/appforge/definitions/index.js`
5. `webgpu-os/appforge/adapters/manifestAdapter.js`
6. `webgpu-os/appforge/sdk/index.js`
7. `webgpu-os/appforge/services/ServiceContainer.js`
8. `webgpu-os/appforge/services/kernelServices.js`
9. `webgpu-os/appforge/context/ContextGraph.js`
10. `webgpu-os/appforge/commands/commandObjects.js`
11. `webgpu-os/appforge/commands/pipelines.js`
12. `webgpu-os/apps/notepad/appforgeCommands.js`
13. `webgpu-os/apps/notepad/appforge/commands.js`
14. `webgpu-os/apps/notepad/appforge/parts.js`
15. `webgpu-os/apps/notepad/appforge/index.js`
16. `webgpu-os/apps/files/appforgeCommands.js`
17. `webgpu-os/apps/files/appforge/commands.js`
18. `webgpu-os/apps/files/appforge/parts.js`
19. `webgpu-os/apps/files/appforge/index.js`
20. Command registry AppForge metadata visibility.
21. `webgpu-os/appforge/layout/WorkspaceState.js`
22. `webgpu-os/appforge/layout/LayoutEngine.js`
23. `webgpu-os/appforge/layout/WorkspaceHost.js`
24. Desktop AppForge workspace host mode.
25. AppForge layout snapshot persistence.
26. `webgpu-os/appforge/blueprints/AppFactory.js`
27. `webgpu-os/appforge/blueprints/blueprints.js`
28. `webgpu-os/appforge/blueprints/index.js`
29. `profile.textEditing` blueprint.
30. AppForge manifest panel import after app discovery.
31. `webgpu-os/appforge/services/terminal/TerminalService.js`
32. `webgpu-os/appforge/services/terminal/index.js`
33. `kernel.terminalService` / `os.terminal`.
34. Terminal syscall bridge for session-backed UI access.
35. Terminal command objects for session create, run, and clear.
36. `webgpu-os/appforge/packages/PackageExports.js`
37. `webgpu-os/appforge/packages/index.js`
38. Package-manager install, remove, rollback, and export hooks for
    `manifest.appforge.exports`.
39. AppForge package export schemas and docs.
40. `webgpu-os/appforge/timeline/Timeline.js`
41. `webgpu-os/appforge/timeline/index.js`
42. `webgpu-os/appforge/lenses/LensRegistry.js`
43. `webgpu-os/appforge/lenses/index.js`
44. `kernel.timeline` / `os.timeline`.
45. `kernel.lensRegistry` / `os.lenses`.
46. `syscalls.appforge` read and lens activation surface.
47. `webgpu-os/appforge/packs/StarterPacks.js`
48. `webgpu-os/appforge/packs/index.js`
49. `webgpu-os/appforge/builder/WorkspaceBuilder.js`
50. `webgpu-os/appforge/builder/index.js`
51. `kernel.starterPacks` / `os.starterPacks`.
52. `kernel.workspaceBuilder` / `os.workspaceBuilder`.
53. `webgpu-os/apps/appforge-builder/manifest.json`
54. `webgpu-os/apps/appforge-builder/index.js`
55. `webgpu-os/appforge/index.js`
56. `tests/appforge-package-ui-smoke.html`
57. `tests/appforge-package-ui-smoke.mjs`
58. `tests/appforge-catalog-launch-smoke.html`
59. `tests/appforge-catalog-launch-smoke.mjs`
60. `tests/appforge-smoke-runner.html`
61. `tests/appforge-smoke-runner.mjs`

Optional future hardening:

1. Continue app-owned migrations with Terminal, then Paint.
2. Wire `tests/appforge-smoke-runner.html` into CI or a Python browser
   automation command if the repo adopts a shared browser-test harness.

The AppForge path itself is now proven through module, HTTP, docs, bundle, and
real browser CDP checks.

## 20. Final Decision

AppForge OS is viable as a refactor of the current WebGPU OS stack.

Build it in layers:

1. Registry.
2. Tags.
3. Services.
4. Context.
5. Commands.
6. Layout.
7. Blueprints.
8. Packages.
9. Timeline and builder.

Do not duplicate the current kernel, app registry, permission engine, package
manager, shell, or Plauna panel system. Promote them into AppForge contracts and
extend only where the current architecture lacks the deterministic semantic
assembly model.
