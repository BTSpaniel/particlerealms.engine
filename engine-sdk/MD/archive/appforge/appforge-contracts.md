---
title: AppForge Contracts
description: Public contracts for the AppForge registry, tags, services, context graph, command objects, layouts, blueprints, package exports, timeline, lenses, builder, and starter packs.
updated: 2026-06-12
---

# AppForge Contracts

AppForge is the deterministic assembly layer inside WebGPU OS. It does not
replace the kernel, shell, package manager, permission model, or current apps.
It registers reusable parts, scores them with tags, assembles blueprints into
workspace layouts, records workspace history, and exposes builder tooling.

Primary source files:

- `webgpu-os/appforge/definitions/index.js`
- `webgpu-os/appforge/registry/AppForgeRegistry.js`
- `webgpu-os/appforge/tags/index.js`
- `webgpu-os/appforge/scoring/index.js`
- `webgpu-os/appforge/services/ServiceContainer.js`
- `webgpu-os/appforge/context/ContextGraph.js`
- `webgpu-os/appforge/commands/commandObjects.js`
- `webgpu-os/appforge/layout/LayoutEngine.js`
- `webgpu-os/appforge/blueprints/AppFactory.js`
- `webgpu-os/appforge/packages/PackageExports.js`
- `webgpu-os/appforge/timeline/Timeline.js`
- `webgpu-os/appforge/lenses/LensRegistry.js`
- `webgpu-os/appforge/packs/StarterPacks.js`
- `webgpu-os/appforge/builder/WorkspaceBuilder.js`
- `webgpu-os/kernel/KernelBootstrap.js`
- `webgpu-os/kernel/Syscalls.js`

## Part Definition

Every registered part is a plain object. The shared definition validator accepts
these part types:

- `panel`
- `tool`
- `command`
- `service`
- `layout`
- `theme`
- `workflow`
- `blueprint`
- `package`

Required fields:

| Field | Meaning |
| --- | --- |
| `id` | Dot or dash namespaced ID that starts with a lowercase letter. |
| `type` | One of the supported AppForge part types. |
| `title` | Human-readable title. |
| `version` | Semver-like string. Defaults to `1.0.0` when omitted. |

Common optional fields:

| Field | Meaning |
| --- | --- |
| `description` | Human-readable summary. |
| `tags` | Namespaced semantic tags. |
| `provides` | Capabilities or outputs this part offers. |
| `consumes` | Context, service, or capability dependencies. |
| `permissions` | OS permissions this part needs. |
| `inputs` / `outputs` | Structured command or tool IO metadata. |
| `priority` | Numeric scoring tiebreaker. |
| `lifecycle` | Plain object describing lifecycle hooks or module entry data. |
| `source` | Provenance metadata such as app manifest, package export, or starter pack. |
| `metadata` | Part-specific metadata. |

Definitions are cloned on public reads. Callers should treat returned values as
snapshots, not live registry objects.

## Tags And Scoring

Tags use `namespace.value` form. Supported namespaces are:

- `domain`
- `action`
- `role`
- `data`
- `runtime`
- `risk`
- `surface`
- `permission`

Examples:

```json
[
  "domain.text",
  "action.edit",
  "role.text-editor",
  "runtime.gpu",
  "risk.low"
]
```

`AppForgeRegistry.query(criteria)` uses deterministic scoring from tags, type,
zone affinity, permissions, available context, co-occurrence data, and risk
filters. It returns scored candidates with explanation strings.

## Registry

`AppForgeRegistry` is the source of truth for reusable AppForge parts.

Public API:

```js
registry.register(definition);
registry.unregister(id);
registry.resolve(id);
registry.validate(definition);
registry.list(type);
registry.query(criteria);
registry.count(type);
```

Rules:

- Duplicate IDs are rejected unless the caller unregisters the prior part first.
- `resolve()` and `list()` return clones.
- `query()` returns scored results and never mutates the registry.
- Existing app manifests remain in `AppRegistry`; AppForge imports them as panel
  candidates with `source.kind = "appManifest"`.

## Service Container

`ServiceContainer` exposes existing kernel-owned services through stable IDs.

Public API:

```js
services.register(id, service, metadata);
services.unregister(id);
services.get(id);
services.require(id);
services.has(id);
services.list();
services.metadata(id);
```

Kernel-provided AppForge services include:

| ID | Backing owner |
| --- | --- |
| `os.appForgeRegistry` | `kernel.appForgeRegistry` |
| `os.commandBus` | `kernel.commandBus` |
| `os.contextGraph` | `kernel.contextGraph` |
| `os.layoutEngine` | `kernel.layoutEngine` |
| `os.appFactory` | `kernel.appFactory` |
| `os.terminal` | `kernel.terminalService` |
| `os.timeline` | `kernel.timeline` |
| `os.lenses` | `kernel.lensRegistry` |
| `os.starterPacks` | `kernel.starterPacks` |
| `os.workspaceBuilder` | `kernel.workspaceBuilder` |

## Context Graph

`ContextGraph` stores current OS context as directed nodes and edges. It is used
for active file, selection, project, shell cwd, process, theme, panel, registry,
layout, terminal, builder, and pack state.

Public API:

```js
contextGraph.setNode(id, value, metadata);
contextGraph.getNode(id);
contextGraph.hasNode(id);
contextGraph.deleteNode(id);
contextGraph.link(sourceId, targetId, relation);
contextGraph.unlink(sourceId, targetId, relation);
contextGraph.edgesFrom(id);
contextGraph.edgesTo(id);
contextGraph.invalidate(id, reason);
contextGraph.subscribe(id, callback);
contextGraph.snapshot();
```

Invalidations are microtask-batched. Tests that assert subscriber behavior
should wait for a tick before reading callback results.

## Command Objects

AppForge command objects promote local app actions into typed command contracts.

Required shape:

```js
{
  id: "notepad.save",
  type: "command",
  title: "Save",
  tags: ["domain.text", "action.save", "risk.low"],
  permissions: ["fs.write"],
  inputs: [{ name: "path", type: "string", required: true }],
  outputs: [{ name: "saved", type: "boolean" }],
  undo: "none",
  risk: "low",
  handler(ctx, input) {}
}
```

`CommandBus.registerObject()` validates the command object, wraps it in the
existing `CommandBus`, and exposes public metadata without the handler function.
Object pipelines intentionally require exact AppForge command object IDs.

## Layout

`LayoutEngine` owns serializable AppForge workspace state. It does not replace
the Desktop window manager. Existing floating windows still launch through the
current shell path.

Required zones:

- `top`
- `left`
- `center`
- `right`
- `bottom`
- `floating`
- `modal`
- `overlay`
- `status`

Public API:

```js
layout.snapshot();
layout.validate(state);
layout.restore(state);
layout.preview(nextState);
layout.addPanel(zone, panel, options);
layout.removePanel(panelId);
layout.movePanel(panelId, targetZone, options);
layout.setActivePanel(zone, panelId);
layout.updateZone(zone, patch);
layout.collapseZone(zone, collapsed);
layout.pinZone(zone, pinned);
layout.diff(currentState, proposedState);
layout.on(event, callback);
```

`WorkspaceHost` is the DOM adapter that exposes AppForge zones while keeping the
normal Desktop launch behavior intact.

## Blueprints And AppFactory

A blueprint is a `type: "blueprint"` part that declares workspace slots. Slots
can require exact parts, prefer optional parts, or select parts by wanted tags.

Slot shape:

```js
{
  id: "editor",
  title: "Editor",
  zone: "center",
  required: true,
  limit: 1,
  partTypes: ["panel"],
  requires: [],
  optional: [],
  wants: ["role.text-editor"],
  tagMode: "score"
}
```

`AppFactory.preview(profileId, context)` resolves a blueprint and returns
selections, permission summary, proposed workspace state, and layout diff without
mutating live state.

`AppFactory.create(profileId, context)` applies a valid preview to the live
layout engine.

## Terminal Service

`TerminalService` backs the Terminal panel with persistent sessions. Sessions
store session ID, cwd, pid, command, stdout/stderr records, exit state, history,
and timestamps. The Terminal app attaches to the service and runs commands
through the guarded syscall object attached to the session, not through raw
kernel syscalls.

Exposed syscall namespace: `syscalls.terminal`.

## Package Exports

`.prpkg` manifests may include AppForge exports:

```json
{
  "appforge": {
    "sandbox": "iframe",
    "permissions": ["files.read"],
    "tags": ["domain.tools"],
    "exports": {
      "panels": [],
      "tools": [],
      "commands": [],
      "services": [],
      "blueprints": [],
      "layouts": [],
      "themes": [],
      "workflows": [],
      "packages": []
    }
  }
}
```

Rules:

- Export groups imply the part type when `type` is omitted.
- Exported part permissions must be declared in package `permissions` or
  `appforge.permissions`.
- Export IDs cannot replace parts owned by another package.
- Install validates exports after package verification and authorization.
- Failed registration restores prior same-package definitions.
- Remove and rollback unregister current exports; rollback registers exports
  from the rollback manifest.

See source path `webgpu-os/docs/PACKAGING.md` for package verification and
trust flow.

## Timeline

`Timeline` records workspace-level events:

- layout restores
- command dispatch metadata
- context invalidations
- package export changes
- lens activations
- builder draft/save/create events
- starter pack default enablement

Public API:

```js
timeline.record(type, payload, metadata);
timeline.events(criteria);
timeline.latest(count, criteria);
timeline.snapshot(criteria);
timeline.replay(targets, options);
timeline.replayLayout(layoutEngine, options);
timeline.subscribe(callback, options);
timeline.pause(callback);
timeline.clear();
```

Command events store command ID, caller, status, duration, timestamp, input
metadata, result metadata, and error text. They do not store raw command payloads
as the public contract.

## Lenses

`LensRegistry` derives alternate views from `ContextGraph.snapshot()` output.
Lens activation changes private lens view state; it does not replace or mutate
source context nodes.

Built-in lenses:

- `lens.workspace`
- `lens.terminal`
- `lens.packages`
- `lens.all`

Public API:

```js
lenses.register(definition);
lenses.unregister(id);
lenses.resolve(id);
lenses.list();
lenses.preview(id, options);
lenses.activate(id, options);
lenses.active();
lenses.on(event, callback);
```

## Starter Packs

`StarterPackRegistry` registers optional pack-owned parts. Built-in packs:

- `pack.core.files`
- `pack.core.text`
- `pack.core.terminal`
- `pack.creative.paint`
- `pack.admin.os`
- `pack.gpu.demos`

Rules:

- Packs register a `type: "package"` marker plus pack-owned parts.
- Every marker and part validates before registry mutation.
- Pack-owned IDs carry `source.kind = "starterPack"` and `source.packId`.
- Disabling a pack unregisters only pack-owned parts. It does not remove app
  manifests or other registry entries.

## Workspace Builder

`WorkspaceBuilder` is the service behind the AppForge Builder app.

Public API:

```js
builder.createDraft(options);
builder.currentDraft();
builder.validateBlueprint(blueprint);
builder.saveBlueprint(blueprint, options);
builder.previewBlueprint(blueprintOrId, context);
builder.createWorkspace(blueprintOrId, context);
builder.registrySnapshot(criteria);
builder.packList();
builder.packEnable(id);
builder.packDisable(id);
```

The Builder app (`webgpu-os/apps/appforge-builder/`) exposes starter pack
controls, registry browsing, blueprint JSON editing, preview, save, and
workspace creation.

## AppForge Syscalls

The `syscalls.appforge` namespace exposes read-oriented inspection plus guarded
builder and pack operations:

```js
appforge.available();
appforge.timelineSnapshot(criteria);
appforge.timelineEvents(criteria);
appforge.timelineLatest(count, criteria);
appforge.onTimeline(callback, options);
appforge.lensList();
appforge.lensResolve(id);
appforge.lensPreview(id, options);
appforge.lensActivate(id, options);
appforge.lensActive();
appforge.registrySnapshot(criteria);
appforge.builderCreateDraft(options);
appforge.builderCurrentDraft();
appforge.builderValidateBlueprint(blueprint);
appforge.builderSaveBlueprint(blueprint, options);
appforge.builderPreviewBlueprint(blueprintOrId, context);
appforge.builderCreateWorkspace(blueprintOrId, context);
appforge.packList();
appforge.packEnable(id);
appforge.packDisable(id);
```

Read methods are audit-open. Mutating builder and pack methods are guarded by
existing command capabilities in `guardSyscalls()`.

## Security Invariants

- Existing WebGPU OS permission names remain canonical.
- AppForge permission names and metadata do not bypass syscall guards.
- AppForge registry entries are metadata and handlers; runtime power still flows
  through guarded syscalls and kernel services.
- Package exports run through the existing package trust and verification path.
- Timeline replay is not exposed through `syscalls.appforge` because replay can
  mutate layout state.
- Runtime assembly is deterministic and auditable; no runtime LLM planner is
  part of the contract.
