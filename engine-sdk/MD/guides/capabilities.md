---
title: Capabilities — What You Can Build
description: A routing/decision map for the whole stack — which subsystem to use for each goal, public API maps (engine, Plauna, AGI), rendering/physics recipes, bundle targets, the editor module map, and AI editing rules.
updated: 2026-06-05
---

# Capabilities — What You Can Build

What the stack can actually build: browser-native WebGPU games, simulation sandboxes, tools, editors, UI systems, AI training experiments, and deployable single-file runtimes. Use this page to pick the right subsystem before writing code.

## Decision map

| Goal | Use | Primary files | Docs |
| --- | --- | --- | --- |
| WebGPU buffer/pipeline/compute work | vGPU | `engine/core/gpu/VirtualGPU.js` | [vGPU](../engine/vgpu.md) |
| Game state, entities, components | ECS | `engine/EcsImports.js`, `engine/ecs/` | [ECS v2](../engine/ecs.md) |
| Visual frame, render passes, debug views | Rendering | `engine/render/` | [Rendering](../engine/rendering.md) |
| Particles, fire, fluid, matter demos | Particle System | `engine/sim/particles/`, `engine/render/particles/` | [Particles](../engine/particles.md) |
| Menus, HUDs, app panels | Plauna | `plauna/index.js` | [Plauna](../plauna/overview.md) |
| Training, observations, rewards, neural agents | AGI Core | `agi/index.js` | [AGI](../agi/overview.md) |
| Scene authoring and inspection | Editor | `editor/js/EditorApp.js`, `editor/js/ProjectManager.js` | [Editor](../editor/overview.md) |
| New app / prototype | Template | `Template/index.html`, `Template/main.js` | [Template starter](#template-starter) |

Primary entry points: engine → `engine/EngineBootstrap.js` · compiled global → `window.PE` · Plauna → `plauna/index.js` · AGI → `agi/index.js` · editor → `editor/js/EditorApp.js` · template → `Template/`.

## What you can build

- **GPU simulation demos** — particles, fluids, boids, wave optics, ray/path tracing, reaction diffusion, sand, thermal systems, terrain, state-first rasterization, diagnostic scenes.
- **Living worlds** — ECS-driven worlds with items, rules, events, saves, AI state, perception, laws, factions, social graphs, and procedural simulation layers.
- **Physics sandboxes** — rigid bodies, GPU physics, PBD ragdolls, active rig controllers, cloth, rope, fluids, soft-body hooks, constraints, collision debug, PhysX-backed editor workflows.
- **Visual tools** — browser editor workflows with viewport, inspector, hierarchy, world settings, gizmos, particles, audio patches, materials, project saves, runtime debug modes.

## Core engine runtime

The engine exports a single public API through `engine/EngineBootstrap.js` (source mode) or `window.PE` (compiled bundle mode).

```javascript
import {
  ENGINE_FULL, createWorld, createEntity, setEntityComponent,
  createTransform, stepWorld, getVGPU,
} from '../../engine/EngineBootstrap.js';

const world = createWorld({ name: 'GameWorld' });
const player = createEntity(world);
setEntityComponent(world, player, 'Transform', createTransform({
  position: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1],
}));
stepWorld(world, 1 / 60);
console.log(ENGINE_FULL);
```

### Public engine API map

| Category | Common exports | Use for |
| --- | --- | --- |
| Version | `ENGINE_FULL`, `VERSION_BANNER`, `PLAUNA_FULL`, `AGI_CORE_FULL` | Runtime identity, diagnostics, release banners |
| Math | `vec3`, `quatIdentity`, `mat4PerspectiveRadWebGPU`, `clamp`, `lerp` | Transforms, camera math, simulation utilities |
| ECS | `createWorld`, `createEntity`, `setEntityComponent`, `stepWorld` | Entity state and system stepping |
| Gameplay | `EventGraph`, `RuleGraph`, `NPCBrain`, `SimulationManager` | World rules, events, perception, AI state |
| Saves | `SaveSystem`, `createLocalStorageAdapter`, `SAVE_SCHEMA_VERSION` | Local persistence and schema-aware saves |
| Animation | `MotionClip`, `MotionDataset`, `MotionMatcher`, `SkeletonHierarchy` | Motion matching, animation datasets, rig features |
| GPU | `VirtualGPU`, `getVGPU`, `vgpu`, `initVGPU` | WebGPU device, buffers, shaders, pipelines, compute |

Compiled runtime pattern:

```javascript
const PE = window.PE || window.ParticleEngine;
const { VERSION_BANNER, createWorld, createEntity, createPlaunaApp, AGI_CORE_FULL } = PE;
console.log(VERSION_BANNER, AGI_CORE_FULL);
```

## Rendering

Classic scene rendering plus experimental research paths (see [Rendering](../engine/rendering.md)):

- **Scene rendering** — entities, instancing, mesh segments, materials, lighting, shadows, debug visualizations.
- **Post-processing** — tonemapping, bloom, temporal reconstruction, FSR/TSR-style upscaling, depth/normal debug passes.
- **Path tracing** — engine-native path tracing foundation, ReSTIR GI experiments, guide buffers, temporal accumulation.
- **Spectral rendering** — coherent wave optics pass (double-slit demo).
- **State-first rendering** — CPU/GPU visibility, representation selection, temporal visibility, cluster expansion, GPU culling.
- **Proxy geometry** — ray portal proxy with TLAS/BLAS, SDF, billboard, impostor, octahedral cache tiers.

| Need | Start with | Notes |
| --- | --- | --- |
| Normal 3D scene | `engine/render/` + ECS transforms | Use existing passes before adding a new renderer |
| Experimental GI/path tracing | `ReSTIRGIPass` (via EngineBootstrap) | Playground demos consume it through compiled `PE` |
| Many simple visible objects | State-first rasterizer/culler APIs | Use representation selection + GPU culling |
| Debug visual output | Scene debug visualizer + editor view modes | Prefer debug modes over console-only diagnosis |

## Particles, matter, and fluids

Built for large GPU workloads and material behavior, not just sprites (see [Particles](../engine/particles.md)): high-count GPU particles (compaction, sorting, billboards, trails, decals, bonds, adaptive quality); matter states (solid/liquid/gas/plasma); thermal behavior (temperature, heat transfer, phase transitions); SPH fluids + volume fields; interaction (SDF collision, flocking/boids, terrain/sandbox demos).

```javascript
const emitter = {
  id: 'campfire', position: [0, 0.3, 0], rate: 700,
  phase: 'plasma', temperature: 1500, color: [1, 0.45, 0.08, 1],
};
```

## Physics and active bodies

Engine physics modules + PhysX integration + active-ragdoll architecture (see [Physics](../engine/physics.md) and [GPU Physics](../engine/gpu-physics.md)).

| Module | Use | Typical consumer |
| --- | --- | --- |
| `ActiveRigSchema.js` | Rig config, pose buffers, drive profiles | Physics controllers, animation bridges |
| `ActiveRigController.js` | Init/update active ragdoll (articulation/D6 fallback) | Gameplay characters, test harnesses |
| `BalanceController.js` | COM/support analysis, fallen/recovery states | Humanoid locomotion, debug readback |
| `MuscleLayer.js` | Intent-modulated drive stiffness/damping/max force | AI or player control authority |
| `RetargetGraph.js` | Animation → physics → render mapping | Animation import, rig display |

## Plauna UI runtime

The UI layer for game menus, HUDs, tools, dashboards, context menus, and editor-like panels (see [Plauna](../plauna/overview.md)).

```javascript
import { PLAUNA_FULL, createPlaunaApp, Panel, Text, Button } from '../../plauna/index.js';

const ui = createPlaunaApp({ root: document.getElementById('ui') });
const menu = new Panel('main-menu', { title: PLAUNA_FULL });
menu.add(new Text('title', 'Particle Realms'));
menu.add(new Button('play', 'Play'));
ui.mount(menu);
```

| Category | Exports | Use for |
| --- | --- | --- |
| App/Core | `createPlaunaApp`, `UINode`, `VisualTree`, `PlaunaModuleTester` | App shell, retained UI tree, diagnostics |
| Widgets | `Button`, `Panel`, `Text`, `Modal`, `Tooltip`, `Badge`, `Avatar`, `Progress` | HUDs, menus, settings, overlays |
| Forms | `Input`, `Checkbox`, `Radio`, `Switch`, `Select`, `Textarea`, `Slider`, `Rating` | Settings panels, inspectors, tools |
| Navigation/Data | `Tabs`, `Dropdown`, `Breadcrumb`, `Pagination`, `ListView`, `Card` | Multi-screen tools and dashboards |
| Utilities | `Notify`, `ToastManager`, `PlaunaConsole`, `WidgetShowcase`, `ParticleController` | Feedback, debug consoles, demos |

## AGI Core

The AI/training side: observation builders, rewards, curriculum, motion matching, neural/ragdoll experiments, and agent adapters (see [AGI](../agi/overview.md)).

```javascript
import { AGI_CORE_FULL, ObservationBuilder, RewardFunction, CurriculumManager, MotionMatchingTeacher } from '../../agi/index.js';

const observations = new ObservationBuilder({ includeContacts: true });
const rewards = new RewardFunction({ upright: 1.0, energyPenalty: 0.02 });
const curriculum = new CurriculumManager({ stages: ['stand', 'walk'] });
```

| Category | Exports | Use for |
| --- | --- | --- |
| Agent adapters | `PBDRagdollAgentAdapter` | Bridge ragdoll/body state to agent control |
| Brains | `PolicyNetwork`, `ValueNetwork`, `NetworkArchitecture`, `ExperienceBuffer`, `PPOTrainer` | Policy/value training loops, rollout storage |
| Training logic | `ObservationBuilder`, `RewardFunction`, `CurriculumManager`, `MotorController` | Observations, rewards, staged training, motor output |
| Motion | `MotionMatchingTeacher`, `RagdollController` | Teacher signals and body control |
| Studio/Scene | `StudioApp`, `TrainingScene`, `SceneRenderer`, `TrackingCamera`, `DebugVisualizer` | Interactive AGI Studio and visualization |
| Tensor | `ComputeGraph`, `GradientTape`, `TensorCache` | Compute graph and gradient utilities |

## Editor

A browser-native authoring tool for scenes, entities, materials, particles, audio, physics, settings, and project persistence (see [Editor](../editor/overview.md)).

| File | Role | Edit when |
| --- | --- | --- |
| `editor/js/EditorApp.js` | Main app orchestrator | Adding global lifecycle, systems, or panel coordination |
| `editor/js/ProjectManager.js` | Save/load/autosave | Changing project serialization or restore behavior |
| `editor/js/modules/EditorScene.js` | Scene/entity operations | Adding spawn, clone, delete, hierarchy behavior |
| `editor/js/modules/EditorParticles.js` | Particle integration | Adding particle authoring or per-frame updates |
| `editor/js/modules/EditorPhysics.js` | Physics tooling | Adding runtime physics controls or debug hooks |
| `editor/js/modules/EditorAudio.js` | Audio workflow | Adding audio preview, patches, or material sound rules |

## Bundled runtime

The Python bundler can generate an engine-only public runtime or a full platform runtime (see [Engine Stack Usage](engine-stack-usage.md)).

```bash
# Engine / public playground bundle
python bundle_engine.py --target engine --no-cache

# Full platform: Engine + Editor + Plauna + AGI Core
python bundle_engine.py --target platform --production --no-cache
```

| Target | Entries | Exposes | Use for |
| --- | --- | --- | --- |
| `engine` | `engine/EngineBootstrap.js` | `window.PE` engine APIs | Public site, playground, SDK, engine-only demos |
| `platform` | `engine/EngineEditorBootstrap.js`, `agi/index.js`, `plauna/index.js` | Engine + Editor + AGI + Plauna APIs | Internal tools, full platform previews |

## Template starter

Use `Template/` as the starter folder for new apps. Copy it, keep game-specific code local, and only promote reusable systems back into `engine/` after multiple projects need them.

```text
Template/
├── index.html
├── style.css
├── main.js
└── README.md
```

## AI editing rules for this stack

- Search for existing exports before adding new helpers.
- Use `engine/EngineBootstrap.js`, `plauna/index.js`, and `agi/index.js` as public entry points.
- Do **not** use `agi/studio/main.js` as a bundle entry — it auto-boots a DOM app.
- Use compiled `window.PE` APIs in playground/release pages, not direct source imports.
- Keep app-specific code in `Template/` copies or project folders until it is reusable.
- Add debug overlays/readbacks before changing complex physics, rendering, or AGI behavior.
