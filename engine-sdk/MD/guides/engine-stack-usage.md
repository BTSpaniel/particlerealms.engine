---
title: Engine Stack Usage Guide
description: The practical "how do I build with this?" guide — choosing a bundle, runtime loading, minimal apps, ECS/render/particle conventions, Plauna, AGI Core, the editor, and the release checklist.
updated: 2026-06-05
---

# Engine Stack Usage Guide

Version targets: Engine `0.8.1-alpha`, Editor `0.6.0-alpha`, Plauna `0.2.0-alpha`, AGI Core `0.1.0-alpha`.

This guide is the practical "how do I build with this?" document for the full stack:

- **Particle Engine**: WebGPU, ECS, rendering, particles, physics, audio, saves, gameplay systems.
- **Plauna**: retained-mode UI runtime for menus, HUDs, tools, dashboards, and editor-like panels.
- **AGI Core**: training/control utilities for neural, ragdoll, motion, and simulation agents.
- **Editor**: visual scene/project tool for authoring, inspecting, testing, and exporting.
- **Template**: a copyable starter app at `Template/`.

Use this guide when starting a new game, demo, tool, or prototype.

---

## 1. Which build should you use?

### Engine-only bundle

Use this for public demos, playground content, engine examples, and small games that do not need AGI/Plauna/editor APIs.

```powershell
python bundle_engine.py --target engine --no-cache
```

Output identity:

```js
window.PE.ENGINE_VERSION
window.PE.VERSION_BANNER
```

### Full platform bundle

Use this when you want Engine + Editor + Plauna + AGI Core in one runtime.

```powershell
python bundle_engine.py --target platform --production --no-cache
```

This adds:

```js
window.PE.AGI_CORE_VERSION
window.PE.PLAUNA_VERSION
window.PE.createPlaunaApp
window.PE.StudioApp
```

### Ad-hoc bundle

Use this for local experiments where you want Engine plus one optional layer.

```powershell
python bundle_engine.py --include-plauna --no-cache
python bundle_engine.py --include-agi --no-cache
python bundle_engine.py --include-agi --include-plauna --no-cache
```

---

## 2. Runtime loading pattern

For source-mode development, import from `engine/EngineBootstrap.js`.

```js
import {
  ENGINE_FULL,
  createWorld,
  createEntity,
  setEntityComponent,
  stepWorld,
} from '../engine/EngineBootstrap.js';

console.log(`Running ${ENGINE_FULL}`);
```

For generated release, Playground, Editor, and WebGPU OS pages, await the
shared compressed-runtime contract and use `window.PE`.

```js
const PE = await globalThis.__PE_RUNTIME_READY;
console.log(PE.VERSION_BANNER);
```

`bundle_engine.py` writes the external `release-runtime-loader.js` tag with the
exact gzip URL, decoded byte count, SHA-384 identity, asset base, and subsystem
base. The loader expands `*.min.js.gz`, rejects size or integrity mismatches,
executes the verified bytes from a CSP-approved Blob URL, and resolves
`__PE_RUNTIME_READY`. Do not replace it with inline source execution or publish
the oversized raw `*.min.js` file.

Rule: **playground/release pages should use compiled `PE` APIs, not direct `../../engine/...` source imports.**

---

## 3. Minimal Engine app

This is the smallest pattern for a browser app using EngineBootstrap.

```js
import {
  createWorld,
  createEntity,
  setEntityComponent,
  getEntityComponent,
  stepWorld,
  createTransform,
  createPhysicsBody,
} from '../engine/EngineBootstrap.js';

const world = createWorld({ name: 'ExampleWorld' });
const player = createEntity(world);

setEntityComponent(world, player, 'Transform', createTransform({
  position: [0, 1, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
}));

setEntityComponent(world, player, 'PhysicsBody', createPhysicsBody({
  mass: 1,
  velocity: [0, 0, 0],
}));

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;

  stepWorld(world, dt);

  const transform = getEntityComponent(world, player, 'Transform');
  console.log(transform.position);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

Recommended app layout:

```text
MyGame/
├── index.html
├── style.css
├── src/
│   ├── main.js
│   ├── Game.js
│   ├── Renderer.js
│   ├── ui.js
│   └── systems/
└── data/
```

---

## 4. WebGPU initialization pattern

Use raw WebGPU only when a high-level helper does not exist yet.

```js
async function initGpu(canvas) {
  if (!navigator.gpu) throw new Error('WebGPU is required');

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) throw new Error('No WebGPU adapter');

  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  });

  return { adapter, device, context, format };
}
```

Use a single long-lived `GPUDevice`. Recreate size-dependent textures on resize. Do not create pipelines every frame.

---

## 5. ECS conventions

Use components as plain serializable data.

```js
const Vehicle = {
  speed: 0,
  maxSpeed: 22,
  steering: 0,
  occupiedBy: null,
};

setEntityComponent(world, carId, 'Vehicle', Vehicle);
```

System pattern:

```js
function updateVehicles(world, dt) {
  for (const entity of world.entities || []) {
    const vehicle = getEntityComponent(world, entity, 'Vehicle');
    const transform = getEntityComponent(world, entity, 'Transform');
    if (!vehicle || !transform) continue;

    transform.position[0] += vehicle.speed * dt;
  }
}
```

Recommended phases:

```text
input -> ai -> physics -> simulation -> render -> ui -> late
```

Keep simulation state deterministic where possible. Keep DOM/UI state outside physics-critical loops.

---

## 6. Rendering conventions

For simple demos, render from compact state snapshots:

```js
const renderState = {
  camera: { position: [0, 8, 12], target: [0, 0, 0] },
  entities: [],
};

renderState.entities.push({
  id: player,
  kind: 'sphere',
  position: [0, 1, 0],
  radius: 0.5,
  color: [0.2, 0.7, 1.0, 1.0],
});
```

For large worlds:

- Use dirty flags for transforms/materials/bounds.
- Use culling before upload.
- Prefer packed typed arrays over per-entity object uploads.
- Use state-first representation selection for many simple entities.
- Avoid GPU readback in the frame loop unless it is delayed/asynchronous.

---

## 7. Particle system usage

Basic emitter data should be content-driven.

```js
const fireEmitter = {
  id: 'campfire',
  position: [0, 0.3, 0],
  rate: 700,
  lifetime: [0.7, 1.6],
  velocity: [0, 2.2, 0],
  spread: 0.55,
  phase: 'plasma',
  temperature: 1500,
  color: [1.0, 0.45, 0.08, 1.0],
};
```

Good particle app structure:

```text
src/particles/
├── emitters.js        # content presets
├── ParticleScene.js   # owns GPU state and update order
└── ParticleDebug.js   # overlays and counters
```

Rules:

- Keep presets in data modules.
- Keep GPU buffers owned by one system.
- Separate emitter authoring from simulation stepping.
- Add debug counters early: alive count, spawn count, upload bytes, frame ms.

---

## 8. Plauna UI usage

Use Plauna when you need retained UI, themed panels, menus, HUDs, inspectors, or app shells.

Source-mode import:

```js
import {
  PLAUNA_FULL,
  createPlaunaApp,
  Button,
  Panel,
  Text,
  Notify,
} from '../plauna/index.js';

console.log(`Plauna ${PLAUNA_FULL}`);
```

Bundle-mode usage:

```js
const {
  PLAUNA_FULL,
  createPlaunaApp,
  Button,
  Panel,
  Text,
  Notify,
} = window.PE;
```

Minimal Plauna mount:

```js
const app = createPlaunaApp({
  root: document.getElementById('ui'),
  theme: 'dark',
});

const panel = new Panel('main-menu', {
  title: 'Main Menu',
  layout: 'vertical',
});

panel.add(new Text('title', 'Particle Realms'));
panel.add(new Button('play', 'Play', {
  variant: 'primary',
  onClick: () => Notify.info('Starting game...'),
}));

app.mount(panel);
```

Recommended Plauna file layout:

```text
src/ui/
├── app-ui.js          # createPlaunaApp + root mount
├── screens/
│   ├── MainMenu.js
│   ├── Settings.js
│   └── PauseMenu.js
├── hud/
│   ├── StatusHud.js
│   └── DebugHud.js
└── theme.js
```

Plauna rules:

- Use Plauna for UI state, not physics state.
- Pass simulation snapshots into UI; do not let UI own simulation truth.
- Keep UI events as intents: `play`, `pause`, `openSettings`, `setQuality`.
- Avoid creating/destroying large UI trees every frame.

---

## 9. AGI Core usage

Use AGI Core for training agents, observation builders, rewards, motion teachers, and neural control experiments.

Source-mode import:

```js
import {
  AGI_CORE_FULL,
  ObservationBuilder,
  RewardFunction,
  CurriculumManager,
  MotionMatchingTeacher,
  PBDRagdollAgentAdapter,
} from '../agi/index.js';

console.log(`AGI Core ${AGI_CORE_FULL}`);
```

Bundle-mode usage:

```js
const {
  AGI_CORE_FULL,
  ObservationBuilder,
  RewardFunction,
  CurriculumManager,
  MotionMatchingTeacher,
} = window.PE;
```

Minimal training loop shape:

```js
const curriculum = new CurriculumManager({
  stages: ['stand', 'walk', 'recover'],
});

const observations = new ObservationBuilder({
  includeContacts: true,
  includeVelocities: true,
  includeIntent: true,
});

const rewards = new RewardFunction({
  alive: 0.1,
  upright: 1.0,
  targetVelocity: 0.8,
  energyPenalty: 0.02,
});

function trainStep(agent, world, dt) {
  const obs = observations.build(agent, world);
  const action = agent.policy.predict(obs);

  agent.applyAction(action, dt);
  world.step(dt);

  const reward = rewards.evaluate(agent, world);
  agent.learn({ obs, action, reward });

  curriculum.update(agent, reward);
}
```

AGI rules:

- Keep `agi/index.js` side-effect free.
- Do not use `agi/studio/main.js` as a bundle entry; it auto-boots a DOM app.
- Keep observations explicit and versioned.
- Keep rewards readable and decomposed.
- Log training metrics every episode, not every frame.
- Avoid blocking GPU readback in training loops.

---

## 10. Editor workflow

Use the editor for authoring, inspection, debugging, and visual iteration.

Recommended workflow:

1. Open `editor/index.html` locally or from the release site.
2. Create or load a project.
3. Place entities, colliders, lights, particle emitters, and audio nodes.
4. Use viewport debug modes to inspect depth, normals, albedo, velocity, thermal state, and bounds.
5. Save/export the scene.
6. Load the exported data in your game runtime.

Editor-side concepts:

```text
EditorApp       -> owns app lifecycle, ECS world, panels
ProjectManager  -> save/load/autosave
Viewport        -> camera, render passes, debug views
Inspector       -> selected entity component editor
WorldPanel      -> global lighting/physics/render settings
EditorParticles -> particle system integration
EditorAudio     -> procedural audio preview/authoring
```

When extending the editor:

- Register new component schemas first.
- Add inspector UI only after the data shape is stable.
- Keep editor-only convenience data separate from runtime data.
- Make exports deterministic and schema-versioned.

---

## 11. Template folder usage

The `Template/` folder is a starter app. Copy it for a new project:

```powershell
Copy-Item -Recurse C:\Coding\game\Template C:\Coding\game\MyPrototype
```

Then edit:

```text
MyPrototype/
├── index.html   # page shell
├── style.css    # app styling
└── main.js      # app loop and engine imports
```

If using source-mode imports, paths are relative to the new folder. If the copy lives beside `engine/`, use:

```js
import { createWorld } from '../engine/EngineBootstrap.js';
```

If the copy is deployed with a compiled bundle, use:

```js
const PE = window.PE || window.ParticleEngine;
const { createWorld } = PE;
```

---

## 12. Project starter template

Use this as the recommended new app shape:

```js
import {
  ENGINE_FULL,
  createWorld,
  createEntity,
  setEntityComponent,
  createTransform,
  stepWorld,
} from '../engine/EngineBootstrap.js';

class GameApp {
  constructor({ canvas }) {
    this.canvas = canvas;
    this.world = createWorld({ name: 'GameApp' });
    this.running = false;
    this.lastTime = 0;
  }

  async init() {
    console.log(`Booting ${ENGINE_FULL}`);
    this.player = createEntity(this.world);
    setEntityComponent(this.world, this.player, 'Transform', createTransform({
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    }));
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  frame = (now) => {
    if (!this.running) return;
    const dt = Math.min((now - this.lastTime) / 1000, 1 / 30);
    this.lastTime = now;

    this.update(dt);
    this.render();

    requestAnimationFrame(this.frame);
  };

  update(dt) {
    stepWorld(this.world, dt);
  }

  render() {
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(this.canvas.width / 2, this.canvas.height / 2, 16, 0, Math.PI * 2);
    ctx.fill();
  }
}

const canvas = document.querySelector('canvas');
const app = new GameApp({ canvas });
await app.init();
app.start();
```

---

## 13. What to build first

For a new game:

1. Start with `Template/`.
2. Add ECS data for player/world/items.
3. Add a simple renderer before complex effects.
4. Add Plauna UI screens after the game loop exists.
5. Add saves once data shapes stabilize.
6. Add AGI Core only when you have an agent, observations, rewards, and a repeatable scenario.
7. Move reusable systems back into `engine/` only after two projects need them.

For a new engine demo:

1. Start in `tests/playground/index.html` only if it belongs in the public demo suite.
2. Use compiled `PE` APIs for playground runtime paths.
3. Keep new engine modules under `engine/` and export them from `EngineBootstrap.js`.
4. Rebundle with `python bundle_engine.py --target engine --no-cache`.

For a new UI/tool:

1. Start with Plauna screen components.
2. Keep commands/events separate from visual widgets.
3. Use the editor only for workflows that need scene or asset authoring.

---

## 14. Release checklist

Before publishing:

```powershell
python bundle_engine.py --target engine --no-cache
python bundle_engine.py --target platform --production --no-cache
```

Then check:

- `release/site/index.html` loads.
- `release/site/playground/` loads the compressed bundle.
- `release/site/assets/` contains the selected compressed runtime.
- Version banner reports the expected Engine, Editor, Plauna, and AGI Core versions.
- No playground code imports directly from `../../engine`.
- Editor remains accessible from utility links, but Playground is the primary public CTA.

---

## 15. Design rules for this repository

- Prefer existing engine exports before adding new duplicate helpers.
- Keep app-specific content outside `engine/` until it is reusable.
- Keep public bundle entrypoints side-effect free.
- Prefer data-driven configuration for entities, UI screens, emitters, and training scenarios.
- Avoid frame-loop allocations in rendering and simulation.
- Add debug readbacks and overlays before changing complex physics or neural logic.
- Use the main play/runtime path for active-body validation, not old preview-only paths.
