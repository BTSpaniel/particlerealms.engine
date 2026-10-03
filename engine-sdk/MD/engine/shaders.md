---
title: Shaders & WGSL
description: The modular WGSL shader system — organization, ShaderComposer, the WGSL preprocessor, shader reflection, compilation via vGPU, and common patterns.
updated: 2026-06-05
---

# Shaders & WGSL

A modular WGSL shader system with composition, preprocessing, a shared library of reusable modules, and the `ShaderComposer` for assembling complex shaders from parts.

## Shader organization

```text
engine/render/shaders/
├── ShaderComposer.js       ← assembles shaders from modules
├── ShaderLoader.js         ← file-based shader loading
├── ShaderSchema.js         ← shader metadata and validation
├── ShaderSources.js        ← inline shader source strings
├── WgslPreprocessor.js     ← #define, #if, #include preprocessing
├── core/                   ← core shader modules (lighting, transforms)
├── modules/
│   ├── core/               ← e.g. particles_sdf_billboard.js, phase_vfx.js
│   ├── passes/             ← fullscreen post-process & debug pass shaders
│   └── lib/                ← reusable WGSL function libraries (density, depth)
├── materials/              ← material shaders (PBR, unlit, etc.)
├── effects/                ← post-process effect shaders
└── debug/                  ← debug visualization shaders
```

## ShaderComposer

`ShaderComposer` assembles complex shaders from a library of reusable WGSL modules. Modules are registered by name and injected at compile time, avoiding duplicate functions (e.g. lighting) across shaders.

```javascript
import { ShaderComposer } from './engine/render/shaders/ShaderComposer.js';

const source = ShaderComposer.compose({
  libs: ['particles/phase_vfx', 'lighting/pbr'],
  main: myShaderCode
});
```

The composer resolves the `LIBRARY_MAP` to inject WGSL function definitions before your main code.

## WGSL preprocessor

`WGSLPreprocessor` supports C-style directives before compilation:

```wgsl
#define MAX_LIGHTS 16
#define ENABLE_SHADOWS

#if ENABLE_SHADOWS
  // shadow mapping code included
#endif
```

```javascript
vgpu.shader.compile('lit', source, { MAX_LIGHTS: 8, ENABLE_SHADOWS: 1 });
```

## Shader reflection

`VGPUShaderReflection` parses WGSL source to extract bind group layouts, struct definitions, and entry points, enabling automatic pipeline-layout generation from shader source.

## Compilation via vGPU

All shader compilation goes through `vgpu.shader` (see [Virtual GPU](vgpu.md)):

```javascript
const module = vgpu.shader.compile('name', wgslCode);   // compile + cache
vgpu.shader.recompile('name', updatedCode);             // hot reload (dev)
const info = await module.getCompilationInfo();         // check errors
```

> **Important:** use `textureSampleLevel(..., 0.0)` instead of `textureSample()` in compute shaders and non-uniform control flow — WebGPU validation rejects `textureSample` outside uniform control flow.

## Common pattern: billboard circle clipping

Particle debug shaders render billboard quads with vertices `(-1,-1)`..`(1,1)`. The fragment shader must discard corners to produce circular particles:

```wgsl
let dist = length(input.localPos);
if (dist > 1.0) { discard; }          // hard circle clip
let falloff = falloffGaussian(dist, 0.8);
if (falloff < 0.01) { discard; }      // soft edge
```

> Without the hard clip, `falloffGaussian(1.414, 0.8) ≈ 0.21` still passes the 0.01 threshold, making particles appear as squares.
