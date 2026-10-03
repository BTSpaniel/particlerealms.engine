Camera defines the view into the scene: projection matrix (perspective or
orthographic) and view matrix (position/orientation). Cameras can be stationary,
following a target, or controlled by user input.

### Camera types

```js
import {
  PerspectiveCamera, OrthographicCamera,
  ArcballCamera, FollowCamera, FPSCamera
} from "engine/render/Camera.js";

// Standard perspective
const cam = new PerspectiveCamera({
  fov: 60 * Math.PI / 180,
  aspect: 16 / 9,
  near: 0.1,
  far: 1000
});

// Orthographic (2D games, isometric)
const iso = new OrthographicCamera({
  left: -10, right: 10,
  top: 10, bottom: -10,
  near: 0, far: 100
});

// Arcball (rotate around a target)
const arcball = new ArcballCamera({
  target: [0, 0, 0],
  distance: 10,
  minDistance: 2,
  maxDistance: 50
});

// Follow camera (smooth chase)
const follow = new FollowCamera({
  target: playerEntity,
  offset: [0, 5, -10],
  smoothness: 0.1
});

// FPS-style (mouse look + WASD)
const fps = new FPSCamera({
  position: [0, 1.6, 0],  // Eye height
  speed: 5,
  sensitivity: 0.002
});
```

### View and projection matrices

```js
// Get matrices for shaders
const viewMatrix = cam.viewMatrix;           // World-to-camera
const projMatrix = cam.projectionMatrix;     // Camera-to-clip
const viewProj = cam.viewProjectionMatrix;   // Combined
const inverseView = cam.inverseViewMatrix;   // Camera-to-world (for raycasting)

// Extract camera position from inverse view
const cameraPos = [inverseView[12], inverseView[13], inverseView[14]];
```

### Screen to world raycasting

```js
// Cast a ray from mouse position
const ray = cam.screenToWorldRay(mouseX, mouseY, viewportWidth, viewportHeight);
// ray.origin, ray.direction

// Intersect with ground plane (y = 0)
const t = -ray.origin[1] / ray.direction[1];
const hitPoint = [
  ray.origin[0] + ray.direction[0] * t,
  0,
  ray.origin[2] + ray.direction[2] * t
];
```

### Viewport and scissor

```js
// Split screen multiplayer
cam.setViewport({
  x: 0,      // Normalized 0-1
  y: 0,
  width: 0.5,
  height: 1.0
});

// Letterbox for cutscenes
cam.setScissor({
  x: 0,
  y: viewportHeight * 0.1,
  width: viewportWidth,
  height: viewportHeight * 0.8
});
```

### Gotchas

- **Aspect ratio**: Update on window resize or use `camera.aspect = canvas.width / canvas.height`.
- **Near/far precision**: Keep ratio small (`far/near < 10000`) to avoid z-fighting.
  Use logarithmic depth for large worlds.
- **Gimbal lock**: Arcball uses quaternions internally, but Euler-based cameras can
  flip at the poles — use quat-based rotation for full freedom.

**See also:** [Renderer](./Renderer.md) · [MathQuat](/engine/core/math/MathQuat.md) · [Rendering](/engine/rendering.md)
