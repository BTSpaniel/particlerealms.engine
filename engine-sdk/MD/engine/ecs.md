---
title: ECS v2
description: The Entity-Component-System core — worlds, generational entity IDs, data components, phased systems, archetype storage, component healing, prefabs, and snapshots.
updated: 2026-08-28
---

# ECS v2

Entity-Component-System architecture: **entities are IDs, components are data, systems are functions.** No inheritance and no scene graph — just fast, flat, data-oriented design.

## Quick example

```javascript
import { createWorld, createEntity, stepWorld } from './engine/ecs/world/World.js';
import { registerSystem } from './engine/ecs/systems/SystemRegistry.js';
import { setComponent, getComponent } from './engine/ecs/storage/ArchetypeStorage.js';

// 1. Create a world
const world = createWorld({ name: 'MyGame' });

// 2. Create entities (just numeric IDs)
const player = createEntity(world);
const enemy  = createEntity(world);

// 3. Attach components (plain data)
setComponent(world, player, 'Transform', {
  position: [0, 1, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1]
});

// 4. Register systems (functions that run each tick)
registerSystem(world, {
  name: 'GravitySystem',
  phase: 'physics',
  update(world, dt) {
    // Query and update entities with PhysicsBody components
  }
});

// 5. Step the simulation
stepWorld(world, 1 / 60);
```

## Core concepts

### Worlds

A **world** is a container for entities, components, and systems. Most apps use a single world, but you can create multiple for isolation (e.g. a UI world separate from gameplay).

```javascript
const world = createWorld({
  name: 'GameWorld',
  fixedDelta: 1 / 60,
  phases: ['prePhysics', 'physics', 'postPhysics', 'render', 'lateUpdate']
});
```

The world tracks:

- **`world.time`** — current tick count, elapsed time, fixed delta.
- **`world.systems`** — registered system list.
- **`world.metrics`** — per-system timing for profiling.
- **`world.config.phases`** — ordered execution phases.

### Entities

An entity is a **generational ID** — a 32-bit integer encoding an index and a generation counter. This prevents dangling references: if entity slot 5 is destroyed and reused, the old ID (generation 1) won't match the new occupant (generation 2).

```javascript
const id = createEntity(world);   // → 1048577 (index=1, gen=1)
destroyEntity(world, id);         // frees the slot
isEntityAlive(world, id);         // → false

const newId = createEntity(world); // reuses slot 1, but gen=2
isEntityAlive(world, id);          // → false (old gen doesn't match)
isEntityAlive(world, newId);       // → true
```

> **ID encoding:** the lower 20 bits are the entity index (max ~1M entities); the upper bits are the generation counter. Decode via `decodeEntityId(id)` → `{ index, generation }`.

### Components

Components are plain data objects attached to entities by name. The engine defines a standard schema in `EntitySchema.js` with normalization and validation:

| Component | Key fields | Purpose |
| --- | --- | --- |
| `Transform` | position, rotation, scale | Spatial placement |
| `PhysicsBody` | velocity, mass, type | Rigid body dynamics |
| `Collider` | shape, size, offset | Collision shapes |
| `Renderable` | meshId, materialId, visible | Visual representation |
| `Light` | type, color, intensity, range | Light sources |
| `Camera` | fov, near, far, projection | View configuration |
| `ParticleEmitter` | preset, rate, lifetime | Particle spawning |
| `NavAgent` | speed, radius, destination | AI pathfinding |
| `NetReplicated` | ownerId, priority | Network sync |

```javascript
// Set a component
setComponent(world, entityId, 'Light', {
  type: 'point',
  color: [1, 0.9, 0.7],
  intensity: 2.5,
  range: 15
});

// Get a component
const transform = getComponent(world, entityId, 'Transform');
console.log(transform.position); // → [0, 1, 0]

// Remove a component
removeComponent(world, entityId, 'Light');
```

### Systems

Systems are registered functions that execute each frame in a defined phase order. They process entities by querying for required components.

```javascript
registerSystem(world, {
  name: 'MovementSystem',
  phase: 'physics',            // which phase to run in
  order: 10,                   // priority within phase (lower = earlier)
  updateKind: 'tick',          // 'tick' (fixed), 'frame' (variable), or 'both'
  after: ['InputSystem'],      // dependency ordering
  before: ['CollisionSystem'], // must run before these

  init(world, system) {
    // called once when registered
    system.state = { moveSpeed: 5.0 };
  },

  update(world, dt, system) {
    // called every tick — do your work here
  },

  teardown(world, system) {
    // called when the system is unregistered
  }
});
```

## Execution phases

Systems are grouped into phases that execute in order. The default phases are:

| Phase | Purpose | Typical systems |
| --- | --- | --- |
| `prePhysics` | Input processing, AI decisions | InputSystem, AISystem |
| `physics` | Physics simulation, movement | PhysicsSystem, MovementSystem |
| `postPhysics` | Collision response, constraints | CollisionSystem, ConstraintSystem |
| `render` | Prepare render data | CameraSystem, LightSystem |
| `lateUpdate` | Cleanup, UI sync | AnimationSystem, UISync |

Two step functions exist:

- **`stepWorld(world, dt)`** — runs all `tick`-kind systems (fixed timestep).
- **`stepWorldFrame(world, dt)`** — runs all `frame`-kind systems (variable timestep).

## Archetype storage

Components are stored in **archetype-based storage** (`ArchetypeStorage.js`). Entities with the same set of components are grouped together for cache-friendly iteration. The storage handles:

- **Component add/remove** — moves entities between archetypes.
- **Query matching** — finds all entities with a given component set.
- **Sparse-set indexing** — O(1) component access by entity ID.

## Component healing

`ComponentHealer.js` validates and repairs component data using the schemas in `EntitySchema.js`. It normalizes vectors, clamps values, and fills missing fields with defaults. This makes save/load robust — corrupted or outdated save data is automatically healed.

## Entity lifecycle

```javascript
// 1. Create
const id = createEntity(world);

// 2. Add components
setComponent(world, id, 'Transform', { position: [0, 0, 0] });
setComponent(world, id, 'Renderable', { meshId: 'cube' });

// 3. Systems process it each frame automatically

// 4. Delete with full cleanup (GPU buffers, selections, etc.)
deleteEntity({
  ecsWorld: world,
  entityId: id,
  spawnedEntities,
  uniformBuffers,
  bindGroups
});
```

## Prefabs

`PrefabRegistry.js` defines reusable entity templates (spawnables) with pre-configured components and SDF collision shapes:

```javascript
const entity = spawnPrefab(world, 'torch', {
  position: [5, 0, 3],
  scale: [0.5, 0.5, 0.5]
});
// Automatically gets: Transform, Renderable, Light, ParticleEmitter, Collider
// Plus an SDF collision shape (sphere/box/cylinder) for particle interaction
```

## World snapshots

The current snapshot API captures and restores bounded debug, time, config, and
entity-table state. It does not serialize archetype component columns, logical
clock/RNG state, systems, or native descriptors, so it is not yet a complete
save, rewind, or rollback boundary:

```javascript
const snapshot = captureWorldSnapshot(world, { maxEntities: 1000 });
restoreWorldFromSnapshot(world, snapshot);
```

Complete component persistence, atomic restore, structural command barriers,
chunk queries, dirty generations, and stable identity are planned and gated in
the [Genesis Ecology Engine and ECS plan](genesis-ecology-engine-plan.md).

## Key files

| File | Purpose |
| --- | --- |
| `ecs/world/World.js` | `createWorld`, `createEntity`, `stepWorld`, `stepWorldFrame` |
| `ecs/systems/SystemRegistry.js` | `registerSystem`, phase scheduling, dependency ordering |
| `ecs/storage/ArchetypeStorage.js` | Archetype component arrays, entity locations, and swap removal |
| `ecs/EntitySchema.js` | Component schemas with types and normalization |
| `ecs/ComponentHealer.js` | Auto-repair invalid component data |
| `ecs/EntityManager.js` | High-level entity deletion with GPU cleanup |
| `ecs/prefabs/PrefabRegistry.js` | Spawnable entity templates with SDF shapes |
