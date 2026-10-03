Shaders define how vertices are transformed and fragments are colored.
The engine supports WGSL (WebGPU Shading Language) with automatic pipeline
layout generation and hot-reload during development.

### Creating shaders

```js
import { Shader } from "engine/render/Shader.js";

// From source strings
const shader = Shader.fromSource({
  vertex: `
    @builtin(position) position: vec4f,
    @location(0) normal: vec3f
  }`,
  fragment: `
    @location(0) albedo: vec4f
  `,
  code: wgslCode
});

// From file (auto-reloads in dev mode)
const pbrShader = await Shader.load("/shaders/pbr.wgsl");

// Predefined library shaders
const unlit = Shader.builtin("unlit-textured");
const standard = Shader.builtin("pbr-standard");
```

### Uniforms and bindings

```js
// Shader with uniform buffer
const shader = Shader.fromSource({
  code: `
    struct Scene {
      view: mat4x4f,
      projection: mat4x4f,
      cameraPos: vec3f
    }
    @binding(0) @group(0) var<uniform> scene: Scene;
    
    struct Material {
      baseColor: vec4f,
      roughness: f32,
      metallic: f32
    }
    @binding(0) @group(1) var<uniform> material: Material;
    @binding(1) @group(1) var baseTexture: texture_2d<f32>;
    @binding(2) @group(1) var textureSampler: sampler;
  `
});

// Set uniforms at draw time
renderer.draw({
  mesh,
  shader,
  uniforms: {
    scene: sceneBuffer,
    material: materialBuffer,
    baseTexture: albedoMap,
    textureSampler: linearSampler
  }
});
```

### Vertex attributes

```js
// Define input layout matching mesh vertex format
const shader = Shader.fromSource({
  vertexFormat: [
    { name: "position", type: "float32x3", location: 0 },
    { name: "normal", type: "float32x3", location: 1 },
    { name: "uv", type: "float32x2", location: 2 },
    { name: "color", type: "float32x4", location: 3 }
  ],
  code: wgslCode
});
```

### Hot reload (development)

```js
// Auto-reload on file change
const shader = await Shader.load("/shaders/custom.wgsl", {
  hotReload: true,
  onReload: (newShader) => {
    console.log("Shader reloaded");
    material.shader = newShader;
  }
});
```

### Compute shaders

```js
// General purpose GPU compute
const compute = Shader.compute({
  code: `
    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) id: vec3u) {
      let idx = id.x;
      if (idx >= arrayLength(&particles)) { return; }
      particles[idx].position += particles[idx].velocity;
    }
  `
});

// Dispatch
renderer.dispatch(compute, {
  workgroups: Math.ceil(particleCount / 64),
  bindings: { particles: particleBuffer }
});
```

### Gotchas

- **Binding groups**: Group 0 = scene (view/proj), Group 1 = material, Group 2 =
  object (model matrix). Stick to this convention for consistent caching.
- **Texture formats**: Check `texture.format` matches sampler type in WGSL.
  `texture_2d<f32>` needs float textures, `texture_2d<i32>` needs integer.
- **Derivatives**: `dpdx`, `dpdy`, `fwidth` only work in fragment shaders with
  uniform control flow — branching on interpolated values breaks derivatives.

**See also:** [Shaders & WGSL](/engine/shaders.md) · [Renderer](./Renderer.md) · [GpuTexture](./GpuTexture.md)
