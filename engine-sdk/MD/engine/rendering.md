---
title: Rendering Pipeline
description: GPU-driven multi-pass rendering — frame structure, lighting, shader/debug modes, mesh rendering, half-res particle compositing, shadow atlas, and post-processing.
updated: 2026-08-03
---

# Rendering Pipeline

GPU-driven rendering with meshes, lights, materials, shader modes, and multi-pass compositing. All rendering is built on the [Virtual GPU (vGPU)](vgpu.md) abstraction.

## Frame structure

A typical frame (from `Viewport.js`) follows this pass order:

```text
1.  Update camera matrices (view, proj, viewProj, invViewProj)
2.  Upload frame uniforms (camera, time, lighting)
3.  [Debug] Particle debug pre-pass (if a particle-specific mode is active)
4.  [Debug] Particle depth pre-pass (if scene debug mode: depth/normals)
5.  Hybrid volume compute pass (density grid splatting)
6.  Main render pass:
      a. Entity mesh rendering (GPU instanced, dynamic lighting)
      b. Grid rendering (ground plane with sun + ambient)
      c. SDF collider visualization
      d. Cloth / Rope rendering
      e. Particle rendering (full-res or deferred half-res)
      f. Volumetric smoke rendering
      g. Gizmos, wireframes, debug overlays
7.  Depth buffer copy (for soft particles + debug viz)
8.  [Debug] Scene Debug Visualizer post-pass (depth/normals from the depth buffer)
9.  Shadow Atlas (unified depth → per-category composite)
10. Half-res particle composite (if deferred)
11. Distortion pass (heat haze)
12. SPH fluid surface pass (screen-space fluid rendering)
13. Bloom pass (emissive glow)
14. Tonemap pass (ACES + vignette)
15. Reconstruction (TSR/FSR/SVGF upscaling) + GPU submit
```

> Scene debug modes (steps 4, 8) skip all post-processing (steps 9–14) so the debug output is clean and unmodified.

## Lighting system

`LightManager` handles all lighting via a single GPU uniform buffer (832 bytes). It supports sun (directional), ambient, and dynamic point lights.

| Property | Default | Description |
| --- | --- | --- |
| `sunDirection` | `[0.2, -1.0, 0.1]` | FROM-light direction (steep overhead) |
| `sunColor` | `[1.0, 0.95, 0.85]` | Warm white sun |
| `sunIntensity` | `1.0` | Sun brightness multiplier |
| `ambientColor` | `[0.15, 0.15, 0.2]` | Cool ambient fill |
| `ambientIntensity` | `0.3` | Ambient brightness |
| `globalBrightness` | `1.85` | Final multiplier on all lighting |

> **Direction convention:** `sunDirection` is the FROM-light direction. The `EntityMeshRenderer` shader negates it internally (`normalize(-lighting.sunDirection)`). SDF/Cloth/Rope renderers receive the already-negated TO-light direction from the Viewport.

### Shader modes

Four debug modes controlled by `lightingMode` and `debugMode`:

| Mode | lightingMode | debugMode | Output |
| --- | --- | --- | --- |
| Standard | `dynamic` | `0` | Full sun + ambient + dynamic lights |
| Unlit | `unlit` | `0` | Albedo color only, no lighting |
| Normals | `dynamic` | `1` | World-space normals (`normal*0.5+0.5`) |
| Depth | `dynamic` | `2` | Distance-based depth gradient |

### Particle lighting integration

Particles interact with lighting three ways:

- **Receive** — particles sample sun + ambient from frame uniforms.
- **Emit** — hot particles (fire/plasma) become dynamic point lights via `ParticleLightEmission.js`.
- **Shadow/tint** — smoke dims sunlight (`particleSunShadow`); fire tints it warm (`particleSunTint`).

## Mesh rendering

Entity meshes are rendered by `EntityMeshRenderer`, which reads from ECS `Renderable` and `Transform` components. Each entity gets a per-object uniform buffer (its model matrix) and a bind group linking the uniform to the shader.

```javascript
const pipeline = vgpu.pipeline.render({
  vertex: { module: meshShader, entryPoint: 'vs_main', buffers: vertexLayouts },
  fragment: { module: meshShader, entryPoint: 'fs_main', targets: [{ format }] },
  depthStencil: true,
  label: 'EntityMesh'
});
```

### State-First representation capability floors

State-First semantic sources may set `minimumVisibleRepresentation` on an
entity when their renderer does not implement every generic representation.
The planner still returns `NONE` for a hidden or out-of-frustum entity, but a
visible entity cannot fall below its declared floor. This prevents a quality
profile from asking an integration to draw a `POINT`, `SPLAT`, or `LINE` when
only a faithful mesh renderer exists.

Actuated City Drive declares `FULL_MESH` for its 13 rigged vehicles. State-First
continues to cull hidden cars, while every visible car uses the same body,
glass, lights, wheels, steering, and suspension renderer as Native mode. It
does not substitute chassis-sized boxes. (Sources:
`engine/render/state/StateFirstRasterizer.js`,
`tests/playground/src/demos/carDrive/index.js`.)

## Half-resolution particle compositing

Particles render at half resolution for performance, then composite onto the main scene:

1. The SDF shader outputs `vec4(litColor, alpha)` — non-premultiplied.
2. The SDF pipeline renders into a half-res `bgra8unorm` texture with alpha blend.
3. The half-res texture starts cleared to `(0,0,0,0)`; after alpha blend, RGB = lit × alpha (premultiplied).
4. The composite pass uses fully additive blend (`one + one`) onto the scene.

> **Implication:** with additive composite, particles can only *brighten* the scene, never darken it. Fire needs very low alpha (0.03–0.08) plus bright emission (2–5×) to avoid saturating the half-res buffer into a solid red wall.

## Grid renderer & shadow atlas

`GridRenderer.js` draws the ground plane as a solid fill (alpha 0.85) with sun + ambient lighting, receiving lighting from `LightManager` via `setLighting()` each frame.

`ShadowAtlas` provides unified shadow rendering: all casters (entities, ropes, particles) render into a shared 4096² depth texture, then shadows are composited per category with independent PCF, bias, and strength. Caster categories: `'entity'` (`EntityMeshRenderer.flushShadowDepth()`), `'rope'` (`RopeMeshRenderer` shadow pass), `'particle'` (`ParticleShadowCaster`, round billboard shadows).

## Debug visualization

A two-tier debug system, accessible via the editor's view-mode dropdown.

**Scene-wide modes (post-process)** read the actual hardware depth buffer (meshes + ropes) and composite with a particle depth color texture, via `SceneDebugVisualizerPass`:

| Mode | Technique | Output |
| --- | --- | --- |
| Depth Buffer | Linearize `texture_depth_2d` + particle depth composite | Grayscale: near=white, far=black |
| Normal Maps | Finite-difference world normals from composite depth | RGB = XYZ world-space normals |

> **Why two sources?** Particles use `depthWrite: false` (transparent billboards), so they never appear in the hardware depth buffer. The visualizer composites hardware depth (meshes/ropes) with a separate particle depth color texture, picking whichever is closer per pixel.

**Particle-specific modes (pre-pass)** render particles to a separate `rgba16float` texture using specialized renderers, displayed as a fullscreen overlay (all use circular billboard clipping, `dist > 1.0` discard): Albedo (`ParticleAlbedoRenderer`), Lighting Only (`ParticleLightingRenderer`), Velocity (`ParticleVelocityRenderer`), Age/Lifetime (`ParticleAgeRenderer`), Emissive (`ParticleEmissiveRenderer`), Size (`ParticleSizeRenderer`), Thermal (`ParticleThermalRenderer`, blackbody from temperature).

Other debug systems: `VGPUDebugDraw` (immediate-mode lines/boxes/spheres/frustums), gizmo renderers (editor), and wireframe collision debug.

## Key files

| File | Purpose |
| --- | --- |
| `render/LightManager.js` | Lighting uniforms, sun/ambient/dynamic lights |
| `render/mesh/EntityMeshRenderer.js` | GPU-instanced entity mesh rendering |
| `render/passes/ShadowAtlas.js` | Unified 4096² shadow depth atlas |
| `render/passes/SceneDebugVisualizerPass.js` | Scene depth + particle depth → debug viz |
| `render/passes/BloomPass.js` | Multi-pass bloom for emissive particles |
| `render/passes/TonemapPass.js` | ACES tonemapping + vignette |
| `render/passes/RenderPassManager.js` | Render target allocation, view-mode management |
| `render/particles/ParticleSdfRenderer.js` | SDF billboard particle rendering |
| `render/particles/ParticleHalfResComposite.js` | Half-res → full-res particle composite |
| `render/shaders/ShaderComposer.js` | Modular WGSL shader composition |
| `render/CameraMath.js` | View/projection matrix computation |
