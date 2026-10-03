// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ShadowAtlas.js - Unified Shadow Depth Atlas
 *
 * Single shared depth texture that ALL shadow casters render into.
 * Inspired by Wicked Engine's shadow atlas architecture (2024):
 *   - One depth texture, one clear, one uninterrupted render pass
 *   - All geometry types (voxels, entities, particles, ropes) write sequentially
 *   - All fragment shaders sample from the same atlas
 *   - Comparison sampler for hardware PCF
 *
 * Replaces the separate shadow systems:
 *   - VoxelRenderer.shadowMapTexture  → ShadowAtlas.texture
 *   - ShadowMapPass.shadowTexture     → ShadowAtlas.texture
 *
 * Usage:
 *   const atlas = createShadowAtlas(device, { size: 2048 });
 *   atlas.beginFrame();
 *   atlas.addCaster(x, y, z, radius);  // for frustum fitting
 *   const lightVP = atlas.computeLightMatrix(sunDir);
 *   atlas.renderDepth(encoder, casters);  // all casters in one pass
 *   atlas.composite(encoder, ...);        // fullscreen darken
 *
 * Caster interface:
 *   { flush(pass: GPURenderPassEncoder, lightViewProj: Float32Array): void }
 */

// ============================================================================
// COMPOSITE SHADER (fullscreen shadow darken)
// ============================================================================

const SHADOW_COMPOSITE_SHADER = /* wgsl */`
diagnostic(off, derivative_uniformity);

struct Uniforms {
  invViewProj:    mat4x4<f32>,
  lightViewProj:  mat4x4<f32>,
  screenSize:     vec2<f32>,
  shadowBias:     f32,
  shadowStrength: f32,
  cameraPos:      vec3<f32>,
  maxDist:        f32,
  pcfSpread:      f32,
  _pad0:          f32,
  _pad1:          f32,
  _pad2:          f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var sceneDepth: texture_depth_2d;
@group(0) @binding(2) var shadowDepth: texture_depth_2d;
@group(0) @binding(3) var shadowSamp: sampler_comparison;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

// Sample shadow darkness at a world position using 4-tap rotated PCF.
// Returns 0.0 = fully lit, 1.0 = fully in shadow.
fn sampleShadow(wp: vec3<f32>, cosA: f32, sinA: f32, spread: vec2<f32>) -> f32 {
  let lc = u.lightViewProj * vec4<f32>(wp, 1.0);
  let ln = lc.xyz / lc.w;
  let suv = vec2<f32>(ln.x * 0.5 + 0.5, 1.0 - (ln.y * 0.5 + 0.5));
  if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) { return 0.0; }
  let rd: f32 = ln.z - u.shadowBias;
  // 4-tap rotated Poisson PCF (avoids module-scope const array — Dawn compat)
  let d0 = vec2<f32>(-0.94201, -0.39906);
  let d1 = vec2<f32>( 0.94558, -0.76890);
  let d2 = vec2<f32>(-0.09418, -0.92938);
  let d3 = vec2<f32>( 0.34495,  0.29387);
  var lit: f32 = 0.0;
  var r: vec2<f32>;
  r = vec2<f32>(d0.x * cosA - d0.y * sinA, d0.x * sinA + d0.y * cosA);
  lit += textureSampleCompare(shadowDepth, shadowSamp, suv + r * spread, rd);
  r = vec2<f32>(d1.x * cosA - d1.y * sinA, d1.x * sinA + d1.y * cosA);
  lit += textureSampleCompare(shadowDepth, shadowSamp, suv + r * spread, rd);
  r = vec2<f32>(d2.x * cosA - d2.y * sinA, d2.x * sinA + d2.y * cosA);
  lit += textureSampleCompare(shadowDepth, shadowSamp, suv + r * spread, rd);
  r = vec2<f32>(d3.x * cosA - d3.y * sinA, d3.x * sinA + d3.y * cosA);
  lit += textureSampleCompare(shadowDepth, shadowSamp, suv + r * spread, rd);
  return 1.0 - lit / 4.0;
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  var out: VSOut;
  out.position = vec4<f32>(pos[vi], 0.0, 1.0);
  out.uv = pos[vi] * 0.5 + 0.5;
  out.uv.y = 1.0 - out.uv.y;
  return out;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  let pixelCoord = vec2<i32>(input.uv * u.screenSize);
  let depth = textureLoad(sceneDepth, pixelCoord, 0);

  let clipX = input.uv.x * 2.0 - 1.0;
  let clipY = -(input.uv.y * 2.0 - 1.0);

  // Pre-compute PCF rotation + spread (shared by all shadow samples this pixel)
  let texelSize = 1.0 / vec2<f32>(textureDimensions(shadowDepth));
  let spread = texelSize * u.pcfSpread;
  let screenFrac = input.uv * u.screenSize;
  let angle = fract(sin(dot(screenFrac, vec2<f32>(12.9898, 78.233))) * 43758.5453) * 6.2832;
  let cosA = cos(angle);
  let sinA = sin(angle);

  // Reconstruct surface world position from depth buffer
  var surfacePos: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
  var hasSurface: bool = false;
  if (depth < 0.9999 && depth > 0.001) {
    let ndc = vec4<f32>(clipX, clipY, depth, 1.0);
    let worldH = u.invViewProj * ndc;
    surfacePos = worldH.xyz / worldH.w;
    hasSurface = true;
  }

  // Ray-intersect with ground plane y=0 — catches shadows behind
  // transparent entities whose depth occludes the ground in the depth buffer.
  var groundPos: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
  var hasGround: bool = false;
  let nearW = u.invViewProj * vec4<f32>(clipX, clipY, 0.0, 1.0);
  let farW  = u.invViewProj * vec4<f32>(clipX, clipY, 1.0, 1.0);
  let nearPt = nearW.xyz / nearW.w;
  let farPt  = farW.xyz / farW.w;
  let rayDir = farPt - nearPt;
  if (abs(rayDir.y) > 0.0001) {
    let t: f32 = -nearPt.y / rayDir.y;
    if (t > 0.0 && t < 1.0) {
      groundPos = nearPt + rayDir * t;
      hasGround = true;
    }
  }

  if (!hasSurface && !hasGround) { discard; }

  // Choose shadow source:
  // - If the depth buffer has a surface, shadow that surface only.
  //   Using the ground shadow here would bleed through opaque geometry.
  // - If no depth surface (sky / far-plane), fall back to the ground-plane
  //   ray-intersect so shadows still appear on the infinite ground.
  var darkness: f32 = 0.0;
  if (hasSurface) {
    let sd = surfacePos - u.cameraPos;
    let sDist: f32 = sqrt(dot(sd, sd));
    if (sDist < u.maxDist) {
      let sFade: f32 = 1.0 - smoothstep(u.maxDist * 0.7, u.maxDist, sDist);
      darkness = sampleShadow(surfacePos, cosA, sinA, spread) * sFade;
    }
  } else if (hasGround) {
    let gd = groundPos - u.cameraPos;
    let gDist: f32 = sqrt(dot(gd, gd));
    if (gDist < u.maxDist) {
      let gFade: f32 = 1.0 - smoothstep(u.maxDist * 0.7, u.maxDist, gDist);
      darkness = sampleShadow(groundPos, cosA, sinA, spread) * gFade;
    }
  }
  darkness *= u.shadowStrength;
  if (darkness < 0.001) { discard; }
  return vec4<f32>(0.0, 0.0, 0.0, darkness);
}
`;

// ============================================================================
// SHADOW ATLAS
// ============================================================================

// Pre-allocated scratch arrays for light matrix computation
const _casterBounds = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, count: 0 };
const _lightView = new Float32Array(16);
const _lightProj = new Float32Array(16);
const _lightViewProj = new Float32Array(16);
const _uniformData = new Float32Array(44); // 176 bytes / 4

// Default per-category shadow config (matches shadow-config.json)
const DEFAULT_SHADOW_CONFIG = {
  categories: {
    entity:   { label: 'Entity Meshes',      pcfSpread: 1.5, shadowBias: 0.003, shadowStrength: 0.85, enabled: true },
    particle: { label: 'Particle Effects',    pcfSpread: 4.0, shadowBias: 0.004, shadowStrength: 0.5,  enabled: true },
    rope:     { label: 'Rope / Chain Meshes', pcfSpread: 1.5, shadowBias: 0.002, shadowStrength: 0.8,  enabled: true },
  },
  global: { atlasSize: 4096, shadowRadius: 35, maxShadowDist: 120 },
};

export function createShadowAtlas(device, options = {}) {
  const size = options.size || 4096;
  const format = 'depth32float';

  const texture = device.createTexture({
    size: { width: size, height: size, depthOrArrayLayers: 1 },
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    label: 'ShadowAtlas.depth',
  });
  const textureView = texture.createView();

  const comparisonSampler = device.createSampler({
    compare: 'less',
    magFilter: 'linear',
    minFilter: 'linear',
    label: 'ShadowAtlas.sampler',
  });

  // Composite pipeline
  const compositeModule = device.createShaderModule({
    label: 'ShadowAtlas.composite',
    code: SHADOW_COMPOSITE_SHADER,
  });
  compositeModule.getCompilationInfo?.().then(info => {
    for (const msg of info.messages) {
      const fn = msg.type === 'error' ? 'error' : 'warn';
      console[fn](`[ShadowAtlas shader ${msg.type}] line ${msg.lineNum}: ${msg.message}`);
    }
  });

  const compositeBindGroupLayout = device.createBindGroupLayout({
    label: 'ShadowAtlas.compositeLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
    ],
  });

  const uniformBuffer = device.createBuffer({
    label: 'ShadowAtlas.uniforms',
    size: 176, // 44 floats: added pcfSpread + padding
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const colorFormat = options.colorFormat || 'bgra8unorm';
  let compositePipeline = null;
  let _pipelineReady = false;

  // Use async pipeline creation — the sync version returns a non-null
  // but internally-invalid object when the shader fails to compile,
  // which causes per-frame WebGPU error spam that null guards can't catch.
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [compositeBindGroupLayout] });
  device.createRenderPipelineAsync({
    label: 'ShadowAtlas.compositePipeline',
    layout: pipelineLayout,
    vertex: { module: compositeModule, entryPoint: 'vs_main' },
    fragment: {
      module: compositeModule,
      entryPoint: 'fs_main',
      targets: [{
        format: colorFormat,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
  }).then(pipeline => {
    compositePipeline = pipeline;
    _pipelineReady = true;
    // Patch the atlas object (already returned by createShadowAtlas)
    atlas.compositePipeline = pipeline;
    atlas._pipelineReady = true;
    console.log('[ShadowAtlas] compositePipeline ready');
  }).catch(err => {
    console.error('[ShadowAtlas] compositePipeline FAILED:', err.message || err);
    _pipelineReady = false;
  });

  // Merge user config with defaults
  const cfg = options.shadowConfig || DEFAULT_SHADOW_CONFIG;
  const globalCfg = { ...DEFAULT_SHADOW_CONFIG.global, ...(cfg.global || {}) };
  const catDefs = { ...DEFAULT_SHADOW_CONFIG.categories };
  if (cfg.categories) {
    for (const [k, v] of Object.entries(cfg.categories)) {
      catDefs[k] = { ...(catDefs[k] || {}), ...v };
    }
  }

  // Build runtime category objects (each has a per-frame caster list)
  const _categories = {};
  for (const [k, v] of Object.entries(catDefs)) {
    _categories[k] = {
      label: v.label || k,
      pcfSpread: v.pcfSpread ?? 1.5,
      shadowBias: v.shadowBias ?? 0.003,
      shadowStrength: v.shadowStrength ?? 0.85,
      enabled: v.enabled !== false,
      _frameCasters: [], // cleared each frame
    };
  }

  const atlas = {
    device,
    size,
    texture,
    textureView,
    comparisonSampler,
    compositePipeline: null,
    _pipelineReady: false,
    compositeBindGroupLayout,
    uniformBuffer,
    colorFormat,

    // Global configuration
    shadowRadius: globalCfg.shadowRadius,
    maxShadowDist: globalCfg.maxShadowDist,

    // Per-category settings
    _categories,

    // Per-frame state
    _casterCount: 0,
    _lightViewProj: null,

    // Registered casters (legacy): Array<{ flush(pass, lightViewProj) }>
    _casters: [],
  };

  // Bind convenience methods so consumers don't need separate imports
  atlas._beginFrame     = () => beginFrame(atlas);
  atlas._addCaster      = (x, y, z, r) => addCaster(atlas, x, y, z, r);
  atlas._computeLightMatrix = (sunDir, cameraPos) => computeLightMatrix(atlas, sunDir, cameraPos);
  atlas._renderDepth    = (encoder, extra) => renderDepth(atlas, encoder, extra);
  atlas._composite      = (enc, out, sd, ivp, w, h, cp) => composite(atlas, enc, out, sd, ivp, w, h, cp);
  atlas._register       = (caster) => registerAtlasCaster(atlas, caster);
  atlas._unregister     = (caster) => unregisterAtlasCaster(atlas, caster);
  atlas._destroy        = () => destroyShadowAtlas(atlas);

  // Per-category API
  atlas._addCategoryCaster = (cat, caster) => addCategoryCaster(atlas, cat, caster);
  atlas._renderAndCompositeAll = (enc, out, sd, ivp, w, h, cp) => renderAndCompositeAll(atlas, enc, out, sd, ivp, w, h, cp);

  return atlas;
}

// ============================================================================
// PER-FRAME API
// ============================================================================

export function beginFrame(atlas) {
  atlas._casterCount = 0;
  atlas._lightViewProj = null;
  // Clear per-category caster lists
  for (const cat of Object.values(atlas._categories)) {
    cat._frameCasters.length = 0;
  }
  _casterBounds.count = 0;
  _casterBounds.minX = Infinity;
  _casterBounds.minY = Infinity;
  _casterBounds.minZ = Infinity;
  _casterBounds.maxX = -Infinity;
  _casterBounds.maxY = -Infinity;
  _casterBounds.maxZ = -Infinity;
}

export function addCaster(atlas, x, y, z, radius) {
  atlas._casterCount++;
  const b = _casterBounds;
  b.count++;
  if (x - radius < b.minX) b.minX = x - radius;
  if (y - radius < b.minY) b.minY = y - radius;
  if (z - radius < b.minZ) b.minZ = z - radius;
  if (x + radius > b.maxX) b.maxX = x + radius;
  if (y + radius > b.maxY) b.maxY = y + radius;
  if (z + radius > b.maxZ) b.maxZ = z + radius;
}

export function computeLightMatrix(atlas, sunDir, cameraPos) {
  // Normalize sun direction
  let sdx = sunDir[0], sdy = sunDir[1], sdz = sunDir[2];
  let sl = Math.sqrt(sdx * sdx + sdy * sdy + sdz * sdz) || 1;
  sdx /= sl; sdy /= sl; sdz /= sl;

  // Camera-centered shadow frustum: shadows cover the visible world
  // around the camera, not just where entities happen to be.
  const shadowRadius = atlas.shadowRadius || 35; // meters around camera
  const camX = cameraPos ? cameraPos[0] : 0;
  const camY = cameraPos ? cameraPos[1] : 5;
  const camZ = cameraPos ? cameraPos[2] : 0;

  // Start with camera-centered bounds on ground plane
  let minX = camX - shadowRadius;
  let maxX = camX + shadowRadius;
  let minZ = camZ - shadowRadius;
  let maxZ = camZ + shadowRadius;
  let minY = -0.1; // ground plane
  let maxY = Math.max(camY + 10, 20); // cover reasonable height

  // Merge entity caster bounds if any (so their shadows are always included)
  if (atlas._casterCount > 0) {
    const b = _casterBounds;
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY);
    maxY = Math.max(maxY, b.maxY);
    minZ = Math.min(minZ, b.minZ);
    maxZ = Math.max(maxZ, b.maxZ);
  }

  // Project top edges onto y=0 along sun direction so the
  // light frustum covers where shadows land on the ground.
  if (sdy < -0.01 && maxY > 0.1) {
    const projScale = maxY / (-sdy);
    const gx1 = minX + sdx * projScale;
    const gx2 = maxX + sdx * projScale;
    const gz1 = minZ + sdz * projScale;
    const gz2 = maxZ + sdz * projScale;
    minX = Math.min(minX, gx1, gx2);
    maxX = Math.max(maxX, gx1, gx2);
    minZ = Math.min(minZ, gz1, gz2);
    maxZ = Math.max(maxZ, gz1, gz2);
  }

  // Bounding sphere from expanded bounds
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  let radius = Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.5;
  radius = Math.max(radius, 3.0);

  // Light position: center - sunDir * distance (sun points downward, eye goes opposite)
  const dist = radius * 2;
  const lx = cx - sdx * dist;
  const ly = cy - sdy * dist;
  const lz = cz - sdz * dist;

  // lookAt: light → center
  _lookAt(lx, ly, lz, cx, cy, cz, _lightView);

  // Orthographic projection covering the bounding sphere + padding
  const pad = radius * 0.15;
  const r = radius + pad;
  _ortho(-r, r, -r, r, 0.1, radius * 4 + 0.1, _lightProj);

  // lightViewProj = proj * view
  _mulMat4(_lightProj, _lightView, _lightViewProj);

  atlas._lightViewProj = _lightViewProj;
  return _lightViewProj;
}

// ============================================================================
// CASTER REGISTRATION
// ============================================================================

export function registerAtlasCaster(atlas, caster) {
  if (!atlas || !caster) return;
  if (atlas._casters.indexOf(caster) === -1) {
    atlas._casters.push(caster);
  }
}

export function unregisterAtlasCaster(atlas, caster) {
  if (!atlas || !caster) return;
  const idx = atlas._casters.indexOf(caster);
  if (idx !== -1) atlas._casters.splice(idx, 1);
}

// ============================================================================
// PER-CATEGORY API
// ============================================================================

export function addCategoryCaster(atlas, categoryName, caster) {
  if (!atlas || !caster) return;
  let cat = atlas._categories[categoryName];
  if (!cat) {
    // Auto-create unknown category with sensible defaults
    cat = {
      label: categoryName,
      pcfSpread: 1.5, shadowBias: 0.003, shadowStrength: 0.85,
      enabled: true, _frameCasters: [],
    };
    atlas._categories[categoryName] = cat;
  }
  cat._frameCasters.push(caster);
}

export function renderAndCompositeAll(atlas, encoder, outputView, sceneDepthTexture, invViewProj, screenW, screenH, cameraPos) {
  if (!atlas._lightViewProj) return;

  for (const cat of Object.values(atlas._categories)) {
    if (!cat.enabled || cat._frameCasters.length === 0) continue;

    // --- Depth pass: clear + render this category's casters ---
    const depthPass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: atlas.textureView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    for (const c of cat._frameCasters) {
      c.flush(depthPass, atlas._lightViewProj);
    }
    depthPass.end();

    // --- Composite pass: blend this category's shadows onto output ---
    _uniformData.set(invViewProj, 0);
    _uniformData.set(atlas._lightViewProj, 16);
    _uniformData[32] = screenW;
    _uniformData[33] = screenH;
    _uniformData[34] = cat.shadowBias;
    _uniformData[35] = cat.shadowStrength;
    _uniformData[36] = cameraPos[0];
    _uniformData[37] = cameraPos[1];
    _uniformData[38] = cameraPos[2];
    _uniformData[39] = atlas.maxShadowDist;
    _uniformData[40] = cat.pcfSpread;
    atlas.device.queue.writeBuffer(atlas.uniformBuffer, 0, _uniformData);

    const bindGroup = atlas.device.createBindGroup({
      label: 'ShadowAtlas.compositeBindGroup',
      layout: atlas.compositeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: atlas.uniformBuffer } },
        { binding: 1, resource: sceneDepthTexture.createView({ aspect: 'depth-only' }) },
        { binding: 2, resource: atlas.textureView },
        { binding: 3, resource: atlas.comparisonSampler },
      ],
    });

    const compositePass = encoder.beginRenderPass({
      colorAttachments: [{
        view: outputView,
        loadOp: 'load',
        storeOp: 'store',
      }],
    });
    if (!atlas._pipelineReady || !atlas.compositePipeline) { compositePass.end(); continue; }
    compositePass.setPipeline(atlas.compositePipeline);
    compositePass.setBindGroup(0, bindGroup);
    compositePass.draw(3);
    compositePass.end();
  }
}

// ============================================================================
// RENDER (legacy — single pass, all casters together)
// ============================================================================

export function renderDepth(atlas, encoder, extraCasters) {
  if (!atlas._lightViewProj || atlas._casterCount === 0) return;

  const pass = encoder.beginRenderPass({
    colorAttachments: [],
    depthStencilAttachment: {
      view: atlas.textureView,
      depthClearValue: 1.0,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });

  // Registered casters
  for (let i = 0; i < atlas._casters.length; i++) {
    const c = atlas._casters[i];
    if (c && typeof c.flush === 'function') {
      c.flush(pass, atlas._lightViewProj);
    }
  }

  // Extra one-shot casters passed this frame
  if (extraCasters) {
    for (let i = 0; i < extraCasters.length; i++) {
      const c = extraCasters[i];
      if (c && typeof c.flush === 'function') {
        c.flush(pass, atlas._lightViewProj);
      }
    }
  }

  pass.end();
}

export function composite(atlas, encoder, outputView, sceneDepthTexture, invViewProj, screenW, screenH, cameraPos) {
  if (!atlas._lightViewProj || atlas._casterCount === 0) return;

  // Upload uniforms
  _uniformData.set(invViewProj, 0);               // [0..15]  invViewProj
  _uniformData.set(atlas._lightViewProj, 16);      // [16..31] lightViewProj
  _uniformData[32] = screenW;                      // [32] screenSize.x
  _uniformData[33] = screenH;                      // [33] screenSize.y
  _uniformData[34] = atlas.shadowBias;             // [34] shadowBias
  _uniformData[35] = atlas.shadowStrength;         // [35] shadowStrength
  _uniformData[36] = cameraPos[0];                 // [36] cameraPos.x
  _uniformData[37] = cameraPos[1];                 // [37] cameraPos.y
  _uniformData[38] = cameraPos[2];                 // [38] cameraPos.z
  _uniformData[39] = atlas.maxShadowDist;          // [39] maxDist
  _uniformData[40] = atlas.shadowPcfSpread ?? 1.5;  // [40] pcfSpread
  atlas.device.queue.writeBuffer(atlas.uniformBuffer, 0, _uniformData);

  const bindGroup = atlas.device.createBindGroup({
    label: 'ShadowAtlas.compositeBindGroup',
    layout: atlas.compositeBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: atlas.uniformBuffer } },
      { binding: 1, resource: sceneDepthTexture.createView({ aspect: 'depth-only' }) },
      { binding: 2, resource: atlas.textureView },
      { binding: 3, resource: atlas.comparisonSampler },
    ],
  });

  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: outputView,
      loadOp: 'load',
      storeOp: 'store',
    }],
  });
  if (!atlas._pipelineReady || !atlas.compositePipeline) { pass.end(); return; }
  pass.setPipeline(atlas.compositePipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
}

// ============================================================================
// CLEANUP
// ============================================================================

export function destroyShadowAtlas(atlas) {
  if (!atlas) return;
  if (atlas.texture) atlas.texture.destroy();
  if (atlas.uniformBuffer) atlas.uniformBuffer.destroy();
  atlas.texture = null;
  atlas.textureView = null;
  atlas._casters.length = 0;
}

// ============================================================================
// MATRIX HELPERS (zero-alloc, write to pre-allocated arrays)
// ============================================================================

function _lookAt(ex, ey, ez, tx, ty, tz, out) {
  let fx = tx - ex, fy = ty - ey, fz = tz - ez;
  let fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  // up = [0,1,0], handle degenerate case
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(fy) > 0.99) { ux = 0; uy = 0; uz = 1; }
  let sx = fy * uz - fz * uy, sy = fz * ux - fx * uz, sz = fx * uy - fy * ux;
  let sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
  sx /= sl; sy /= sl; sz /= sl;
  ux = sy * fz - sz * fy; uy = sz * fx - sx * fz; uz = sx * fy - sy * fx;
  out[0] = sx;  out[1] = ux;  out[2]  = -fx; out[3]  = 0;
  out[4] = sy;  out[5] = uy;  out[6]  = -fy; out[7]  = 0;
  out[8] = sz;  out[9] = uz;  out[10] = -fz; out[11] = 0;
  out[12] = -(sx * ex + sy * ey + sz * ez);
  out[13] = -(ux * ex + uy * ey + uz * ez);
  out[14] =  (fx * ex + fy * ey + fz * ez);
  out[15] = 1;
}

function _ortho(l, r, b, t, n, f, out) {
  out[0] = 2/(r-l); out[1] = 0;          out[2] = 0;             out[3] = 0;
  out[4] = 0;       out[5] = 2/(t-b);    out[6] = 0;             out[7] = 0;
  out[8] = 0;       out[9] = 0;          out[10]= -1/(f-n);      out[11]= 0;
  out[12]= -(r+l)/(r-l);
  out[13]= -(t+b)/(t-b);
  out[14]= -n/(f-n);
  out[15]= 1;
}

function _mulMat4(a, b, out) {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[i * 4 + j] =
        a[j] * b[i * 4] + a[4 + j] * b[i * 4 + 1] +
        a[8 + j] * b[i * 4 + 2] + a[12 + j] * b[i * 4 + 3];
    }
  }
}
