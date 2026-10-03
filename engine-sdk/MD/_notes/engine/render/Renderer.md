The main rendering pipeline manager. Handles frame submission, render passes,
pipeline state, and output to the canvas. All rendering goes through a
centralized `Renderer` instance that coordinates between shaders, meshes,
textures, and the GPU.

### Basic render loop

```js
import { Renderer } from "engine/render/Renderer.js";
import { Camera } from "engine/render/Camera.js";
import { Mesh } from "engine/render/Mesh.js";
import { Shader } from "engine/render/Shader.js";

const renderer = new Renderer(canvas);
const camera = new Camera({
  fov: 60,
  near: 0.1,
  far: 1000,
  position: [0, 5, 10]
});

// Create a simple mesh + shader
const mesh = Mesh.fromPrimitive("cube");
const shader = Shader.fromSource(vertexCode, fragmentCode);

// Render loop
function frame() {
  renderer.beginFrame();
  
  // Update camera
  camera.lookAt([0, 0, 0]);
  
  // Submit draw call
  renderer.draw({
    mesh,
    shader,
    uniforms: {
      uView: camera.viewMatrix,
      uProjection: camera.projectionMatrix,
      uColor: [1, 0, 0, 1]
    }
  });
  
  renderer.endFrame();
  requestAnimationFrame(frame);
}

frame();
```

### Render passes and post-processing

```js
// Multiple passes with dependencies
const gBufferPass = renderer.createPass("gbuffer", {
  colorAttachments: ["albedo", "normal", "depth"],
  depthAttachment: true
});

const lightingPass = renderer.createPass("lighting", {
  dependencies: [gBufferPass],
  inputs: { gbuffer: gBufferPass.output },
  output: "screen"
});

const bloomPass = renderer.createPass("bloom", {
  dependencies: [lightingPass],
  threshold: 1.0,
  iterations: 4
});

// Submit in order
renderer.submitPass(gBufferPass, sceneObjects);
renderer.submitPass(lightingPass, lights);
renderer.submitPass(bloomPass);
renderer.present();
```

### Pipeline state management

```js
// Caching pipeline states reduces GPU state changes
const opaquePipeline = renderer.getPipeline({
  shader: standardShader,
  blend: false,
  depthTest: true,
  depthWrite: true,
  cull: "back"
});

const transparentPipeline = renderer.getPipeline({
  shader: standardShader,
  blend: true,
  blendMode: "src-alpha-one-minus-src-alpha",
  depthTest: true,
  depthWrite: false,
  cull: "none"
});

// Sort and batch by pipeline for efficiency
opaqueObjects.sort((a, b) => a.pipeline.id - b.pipeline.id);
```

### Gotchas

- **Clear values**: Always specify clear color/depth — undefined values cause
  visual artifacts on some GPUs.
- **MSAA**: Configure on canvas creation, not per-frame. Changing sample count
  requires pipeline rebuild.
- **Resizing**: Call `renderer.resize()` on canvas resize to update framebuffers.
  Forgetting this causes stretched output or black screen.

**See also:** [Rendering](/engine/rendering.md) · [Shaders & WGSL](/engine/shaders.md) · [Camera](./Camera.md)
