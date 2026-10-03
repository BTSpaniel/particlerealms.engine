### ECS Architecture Pattern

The Entity Component System (ECS) separates data (Components) from behavior (Systems). Entities are lightweight IDs that group components. Systems query entities by component type and process them in bulk, enabling cache-friendly iteration and parallel execution.

**Example: Creating and querying entities**
```js
import { World } from 'engine/ecs/World.js';
import { Component } from 'engine/ecs/Component.js';
import { System } from 'engine/ecs/System.js';

// Define component types
class Position extends Component { x = 0; y = 0; z = 0; }
class Velocity extends Component { x = 0; y = 0; z = 0; }

// Create world and entities
const world = new World();
const player = world.createEntity();
player.add(new Position(0, 0, 0));
player.add(new Velocity(1, 0, 0));

// Movement system queries Position + Velocity
class MovementSystem extends System {
  query = [Position, Velocity];
  
  update(entities, dt) {
    for (const entity of entities) {
      const pos = entity.get(Position);
      const vel = entity.get(Velocity);
      pos.x += vel.x * dt;
      pos.y += vel.y * dt;
      pos.z += vel.z * dt;
    }
  }
}

world.addSystem(new MovementSystem());
world.update(0.016);  // Simulate 16ms frame
```

**See also:** [ECS v2](/engine/ecs.md) · [Engine Architecture](/engine/architecture.md)
