---
title: Virtual GPU (vGPU)
description: The shared GPU abstraction for the engine's default GPU path, with automatic caching, pooling, and resource management over raw WebGPU.
updated: 2026-06-05
---

# Virtual GPU (vGPU)

`VirtualGPU` is the shared abstraction for engine systems that use the default GPU path. It wraps raw WebGPU with automatic caching, pooling, and resource management.

> **This is the primary reusable service in the engine's GPU layer.** Most shared-device consumers use vGPU, while specialized systems can use an injected raw device through an explicit ownership path. The OS mediates the shared service (see [GPU Device Sharing](../concepts/gpu-device-sharing.md)). Sources: `engine/core/gpu/VirtualGPU.js`, `engine/render/WorldParticleRenderer.js`.

## Quick start

```javascript
import { getVGPU } from './engine/core/gpu/VirtualGPU.js';

// Initialize (once per app — returns singleton)
const vgpu = await getVGPU();

// Create a vertex buffer
const { buffer, id } = vgpu.buffer.create({ size: 1024, usage: 'vertex', label: 'myVertices' });

// Compile a WGSL shader (cached automatically)
const module = vgpu.shader.compile('triangle', `
  @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var pos = array(vec2f(0, 0.5), vec2f(-0.5, -0.5), vec2f(0.5, -0.5));
    return vec4f(pos[i], 0, 1);
  }
  @fragment fn fs() -> @location(0) vec4f { return vec4f(0.23, 0.74, 0.97, 1); }
`);

// Create a render pipeline — blend mode as a simple string
const pipeline = vgpu.pipeline.render({
  vertex: { module },
  fragment: { module },
  colorFormat: 'bgra8unorm',
  depthFormat: null,
  label: 'trianglePipeline'
});
```

No `GPUBufferUsage.VERTEX | COPY_DST` flags, no bind group layout descriptors, no pipeline layout boilerplate — vGPU handles it.

## Initialization

Three ways to get a vGPU instance:

```javascript
// 1. Singleton (recommended) — first call creates, later calls reuse
import { getVGPU, vgpu } from './engine/core/gpu/VirtualGPU.js';
const gpu = await getVGPU();
const same = vgpu();                      // synchronous access; throws if not initialized

// 2. Direct creation (not singleton)
const inst = await VirtualGPU.create({
  adapterOptions: { powerPreference: 'high-performance' },
  requiredFeatures: ['timestamp-query']
});

// 3. From an existing GPUDevice
const wrapped = VirtualGPU.fromDevice(myGpuDevice);
```

## The 6 core managers

Every vGPU instance exposes six manager objects — the primary API you'll use daily.

### `vgpu.buffer` — buffer management

Create, write, and manage GPU buffers with automatic usage-flag resolution and optional pooling.

```javascript
const { buffer, id } = vgpu.buffer.create({
  size: 4096,
  usage: 'storage',     // or 'vertex', 'index', 'uniform', 'storage|vertex', etc.
  label: 'particleData',
  pooled: true,         // optional: reuse from buffer pool
});
vgpu.buffer.write(buffer, new Float32Array([1, 2, 3, 4]));
vgpu.buffer.release(id);   // returns to pool if pooled
```

Usage strings map to WebGPU flags:

| String | WebGPU flags |
| --- | --- |
| `'vertex'` | `VERTEX \| COPY_DST` |
| `'index'` | `INDEX \| COPY_DST` |
| `'uniform'` | `UNIFORM \| COPY_DST` |
| `'storage'` | `STORAGE \| COPY_DST` |
| `'indirect'` | `INDIRECT \| COPY_DST \| STORAGE` |
| `'read'` | `MAP_READ \| COPY_DST` |
| `'write'` | `MAP_WRITE \| COPY_SRC` |
| `'map-read'` | `MAP_READ` |
| `'map-write'` | `MAP_WRITE` |
| `'storage\|vertex'` | Combined flags (pipe-separated) |

### `vgpu.bindings` — layouts & bind groups

Define named layouts and create bind groups with caching and deduplication.

```javascript
const layout = vgpu.bindings.defineLayout('material', [
  { binding: 0, type: 'uniform', visibility: 'vertex|fragment' },
  { binding: 1, type: 'texture', visibility: 'fragment' },
  { binding: 2, type: 'sampler', visibility: 'fragment' },
]);

const group = vgpu.bindings.createGroup('material', [
  { binding: 0, resource: { buffer: uniformBuffer } },
  { binding: 1, resource: textureView },
  { binding: 2, resource: sampler },
], 'materialGroup');
```

Binding type strings: `'uniform'`, `'storage'`, `'read-storage'`, `'texture'`, `'sampler'`, `'storage-texture'`. The `'read-storage'` alias creates a WebGPU `read-only-storage` binding. Visibility strings are pipe-separated stage names: `'vertex'`, `'fragment'`, `'compute'`, `'vertex|fragment'`.

### `vgpu.shader` — shader compilation

Compile WGSL with automatic caching, preprocessor defines, and hot-reload support.

```javascript
const module = vgpu.shader.compile('myShader', wgslSource);          // cached by name
const hq = vgpu.shader.compile('myShader_hq', wgslSource, {          // with defines
  MAX_LIGHTS: 16, ENABLE_SHADOWS: 1
});
vgpu.shader.recompile('myShader', updatedSource);                    // hot reload (dev)

const info = await module.getCompilationInfo();
info.messages.forEach(m => console.warn(m.message));
```

### `vgpu.pipeline` — render & compute pipelines

Create and cache pipelines with simplified blend-state resolution.

```javascript
const pipeline = vgpu.pipeline.render({
  vertex: { module: vsModule, entryPoint: 'vs_main' },
  vertexLayout: [/* GPUVertexBufferLayout entries */],
  fragment: { module: fsModule, entryPoint: 'fs_main' },
  colorFormat: 'bgra8unorm',
  blend: 'alpha',
  depthFormat: 'depth24plus',
  depthWrite: true,
  depthCompare: 'less',
  topology: 'triangle-list',
  label: 'myPipeline'
});

const compute = vgpu.pipeline.compute({ module: csModule, entryPoint: 'main', label: 'physicsUpdate' });
const async  = await vgpu.pipeline.renderAsync({ /* same options */ });  // non-blocking
```

Blend strings: `'none'` (opaque), `'alpha'` (`src-alpha`, `one-minus-src-alpha`), `'additive'` (`src-alpha`, `one`), `'additive-full'` (`one`, `one`), and `'premultiplied'` (`one`, `one-minus-src-alpha`).

> **Automatic caching:** pipelines are keyed by their full configuration. Calling `vgpu.pipeline.render()` twice with identical options returns the cached pipeline instantly — zero GPU work.

### `vgpu.texture` — textures & samplers

```javascript
const { texture, view, id } = vgpu.texture.create({
  width: 512, height: 512, format: 'rgba8unorm',
  usage: 'render|texture',   // render target + sampleable
  label: 'colorTarget'
});
const sampler = vgpu.texture.sampler({ filter: 'linear', addressMode: 'repeat' });
vgpu.texture.release(id);
```

### `vgpu.command` — command encoding

```javascript
const encoder = vgpu.command.encoder('myPass');
// ... set up passes ...
vgpu.command.submit(encoder.finish());

// One-shot compute dispatch (encode, dispatch, submit)
vgpu.command.dispatchCompute({
  pipeline: computePipeline,
  bindGroups: [group0, group1],
  workgroups: [64, 1, 1],
  label: 'physicsStep'
});

vgpu.command.copyBuffer(srcBuffer, dstBuffer, 0, 0, 4096);
const data = await vgpu.command.readBuffer(gpuBuffer);   // GPU → CPU
```

## Advanced subsystems

Beyond the six core managers, vGPU includes 20+ specialized modules as properties on the instance.

**Enhancement modules:** `vgpu.debug` (labels/markers), `vgpu.ring` (streaming uploads), `vgpu.profiler` (GPU timing), `vgpu.scheduler` (work scheduling), `vgpu.bundles` (render bundles), `vgpu.mipmap` (mipmap gen), `vgpu.queries` (occlusion/stats), `vgpu.warmup` (async pre-compile).

**Resource management:** `vgpu.readback` (non-blocking GPU→CPU), `vgpu.memory` (usage tracking/budgets), `vgpu.materials` (material bind groups), `vgpu.barriers` (resource transitions), `vgpu.quality` (dynamic resolution), `vgpu.renderStats` (draw calls, triangles).

**Advanced rendering (created on demand):** `vgpu.createRenderGraph()` (pass scheduling + resource aliasing), `await vgpu.createIndirectRenderer()` (GPU-driven indirect draws), `await vgpu.createHiZCulling(width, height)` (hierarchical-Z occlusion), `await vgpu.createStreamingManager(options)` (texture/mesh streaming), and `await vgpu.getDebugDraw()` (shared immediate-mode debug shapes). (Source: `engine/core/gpu/VirtualGPU.js`)

**Compute & shader utilities:** `vgpu.computeUtils` (reduction/scan/fill/copy), `vgpu.preprocessor` (WGSL macros/includes), `vgpu.reflection` (shader introspection), `vgpu.bindless`, `vgpu.multiQueue`, `vgpu.semaphores` (timeline sync).

## Common patterns

### Simple compute shader

```javascript
const { buffer: input }  = vgpu.buffer.create({ size: 4096, usage: 'storage', data: inputData });
const { buffer: output } = vgpu.buffer.create({ size: 4096, usage: 'storage' });

const module = vgpu.shader.compile('transform', `
  @group(0) @binding(0) var<storage, read> input: array<f32>;
  @group(0) @binding(1) var<storage, read_write> output: array<f32>;
  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3u) { output[gid.x] = input[gid.x] * 2.0; }
`);

const pipeline = vgpu.pipeline.compute({ module, entryPoint: 'main' });
vgpu.bindings.defineLayout('transform', [
  { binding: 0, type: 'read-storage', visibility: 'compute' },
  { binding: 1, type: 'storage', visibility: 'compute' },
]);
const group = vgpu.bindings.createGroup('transform', [
  { binding: 0, resource: { buffer: input } },
  { binding: 1, resource: { buffer: output } },
]);
vgpu.command.dispatchCompute({ pipeline, bindGroups: group, workgroups: [16] });
const result = new Float32Array(await vgpu.command.readBuffer(output));
```

### Frame lifecycle & stats

```javascript
vgpu.beginFrame();
// ... all rendering and compute work ...
vgpu.endFrame();

const stats = vgpu.getStats();
// → { buffer, bindings, shader, pipeline, texture, ring, bundles,
//     scheduler, warmup, leaks, memory, renderStats, quality,
//     bindless, multiQueue, readbackPending }
```

## Before & after

Creating a particle compute pipeline takes ~68 lines of raw WebGPU vs ~12 with vGPU — about **82% less code**, plus automatic caching, pooling, memory tracking, and debug labels for free.

## Device properties & cleanup

```javascript
vgpu.device       // GPUDevice
vgpu.queue        // GPUQueue
vgpu.adapter      // GPUAdapter
vgpu.limits       // maxBufferSize, maxComputeWorkgroupSizeX, etc.
vgpu.features     // supported features set
vgpu.capabilities // full capability info

vgpu.destroy();   // release the VGPU-owned resource graph
```

`destroy()` retires an explicitly VGPU-owned device wrapper. It never destroys a borrowed or shared device. (Source: `engine/core/gpu/VirtualGPU.js`)
