// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



/**

 * Spell Effect Pass - GPU-rendered spell visual effects

 * Now powered by vGPU driver

 * 

 * Renders active spell effects using GPU shaders for electricity, explosions,

 * magic swirls, etc. Draws as additive full-screen overlay.

 * 

 * Shaders are loaded from individual spellpack manifest effect.js files.

 * 

 * Usage:

 *   const spellPass = createSpellEffectPass(device, { format: 'bgra8unorm' });

 *   

 *   // In render loop:

 *   renderSpellEffects(spellPass, encoder, targetView, {

 *     viewProj, invViewProj, cameraPos, screenSize,

 *     activeSpells: [{ position, radius, color, effectType, phase, time }]

 *   });

 */



import { initVGPU } from '../../core/gpu/VirtualGPU.js';

import { collectGpuShaders } from "./spellpacks/index.js";

import { fullscreenQuadVertexWGSL } from "../shaders/modules/chunks/fullscreen_quad.js";

import { quadtreeWGSL } from "../shaders/modules/chunks/quadtree.js";

import { raymarchingModuleWGSL } from "../shaders/modules/chunks/raymarching.js";

import { noise3dWGSL } from "../shaders/modules/chunks/noise3d.js";

import { getFloat32ArraySize } from '../../core/gpu/WGSLStructSize.js';



const SPELL_UNIFORMS_STRUCT = `struct SpellEffectUniforms {

  viewProj : mat4x4<f32>,

  invViewProj : mat4x4<f32>,

  cameraPos : vec3<f32>,

  globalTime : f32,

  screenSize : vec2<f32>,

  spellCount : u32,

  _pad : u32,

}`;

const _spellUniformData = new Float32Array(getFloat32ArraySize(SPELL_UNIFORMS_STRUCT));



// Dynamic spell instance buffer - grows as needed

let _spellInstanceCapacity = 16; // Start small

let _spellInstanceData = new Float32Array(_spellInstanceCapacity * 16);



function ensureSpellInstanceCapacity(count) {

  if (count <= _spellInstanceCapacity) return;

  // Grow by 2x to amortize allocation cost

  while (_spellInstanceCapacity < count) {

    _spellInstanceCapacity *= 2;

  }

  _spellInstanceData = new Float32Array(_spellInstanceCapacity * 16);

}



// Effect type constants (must match shader)

export const EFFECT_TYPES = {

  FIRE: 0,

  ICE: 1,

  LIGHTNING: 2,

  ARCANE: 3,

  HOLY: 4,

  DARK: 5,

  NATURE: 6,

  WIND: 7,

};



// Spell type constants

export const SPELL_TYPES = {

  PROJECTILE: 0,

  BEAM: 1,

  AOE: 2,

  SHIELD: 3,

  BUFF: 4,

  DEBUFF: 5,

  SUMMON: 6,

  UTILITY: 7,

};



const MAX_ACTIVE_SPELLS = 16;



// SpellInstance struct size: 16 floats = 64 bytes

const SPELL_INSTANCE_SIZE = 64;



const debugSpellFrames = {

  comic: 0,

  particle: 0,

  other: 0,

};



// Backward-compatible named export used by engine/render/passes/index.js

export { createSpellEffectPass as SpellEffectPass };



/**

 * Compose the complete shader from manifest effect functions

 */

function composeSpellShader() {

  const { shaderCode, effectFunctions } = collectGpuShaders();

  

  // Build dispatch switch based on collected effect functions

  const dispatchCases = [];

  const elementToType = { fire: 0, ice: 1, lightning: 2, arcane: 3, holy: 4, dark: 5, nature: 6, wind: 7 };

  

  for (const [element, fnName] of Object.entries(effectFunctions)) {

    const typeId = elementToType[element] ?? 0;

    dispatchCases.push(`    if (spell.effectType == ${typeId}u) {

      effectColor = ${fnName}(ro, rd, spell.position, spell.radius, spell.direction, spell.color, spell.intensity, spell.phase, spell.time, localUV, bounds);

    }`);

  }

  

  // Default fallback to fire-like effect

  const defaultEffect = effectFunctions.fire ? effectFunctions.fire : 'renderFireballEffect';

  

  const composedShader = /* wgsl */`

// ============ SPELL EFFECT TYPES ============

const EFFECT_FIRE : u32 = 0u;

const EFFECT_ICE : u32 = 1u;

const EFFECT_LIGHTNING : u32 = 2u;

const EFFECT_ARCANE : u32 = 3u;

const EFFECT_HOLY : u32 = 4u;

const EFFECT_DARK : u32 = 5u;

const EFFECT_NATURE : u32 = 6u;

const EFFECT_WIND : u32 = 7u;

const MAX_ACTIVE_SPELLS : u32 = 16u;



// ============ UNIFORMS ============

struct SpellInstance {

  position : vec3<f32>,

  radius : f32,

  direction : vec3<f32>,

  intensity : f32,

  color : vec3<f32>,

  spellType : u32,

  effectType : u32,

  phase : f32,

  time : f32,

  _pad : f32,

}



${SPELL_UNIFORMS_STRUCT}



@group(0) @binding(0) var<uniform> uniforms : SpellEffectUniforms;

@group(0) @binding(1) var<storage, read> spells : array<SpellInstance, 16>;



// ============ SHARED VOLUME HELPERS ============

${raymarchingModuleWGSL}

${noise3dWGSL}



// ============ VERTEX SHADER ============

${fullscreenQuadVertexWGSL}



// ============ QUADTREE HELPERS ============

${quadtreeWGSL}



// ============ EFFECT FUNCTIONS FROM MANIFESTS ============

${shaderCode}



// ============ HELPER FUNCTIONS ============

fn worldToScreen(worldPos : vec3<f32>) -> vec3<f32> {

  let clip = uniforms.viewProj * vec4<f32>(worldPos, 1.0);

  let ndc = clip.xyz / clip.w;

  // Convert NDC [-1,1] to UV [0,1] - NO Y flip to match vertex shader UV convention

  return vec3<f32>(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5, ndc.z);

}



// Calculate ray from screen UV

// NOTE: Vertex shader outputs UV in clip-space orientation (Y=0 at bottom, Y=1 at top)

// So we convert directly to NDC without Y flip

fn getRay(uv : vec2<f32>) -> vec3<f32> {

  // Convert UV [0,1] to NDC [-1,1] - NO Y flip since UV matches clip space

  let ndcX = uv.x * 2.0 - 1.0;

  let ndcY = uv.y * 2.0 - 1.0;

  

  // Unproject far point to world space

  let clipFar = vec4<f32>(ndcX, ndcY, 1.0, 1.0);

  var worldFar = uniforms.invViewProj * clipFar;

  worldFar = worldFar / worldFar.w;

  

  return normalize(worldFar.xyz - uniforms.cameraPos);

}



// Ray-sphere intersection (returns near and far t values)

fn raySphereIntersect(ro : vec3<f32>, rd : vec3<f32>, center : vec3<f32>, radius : f32) -> vec2<f32> {

  let oc = ro - center;

  let b = dot(oc, rd);

  let c = dot(oc, oc) - radius * radius;

  let h = b * b - c;

  

  if (h < 0.0) { return vec2<f32>(-1.0); }

  

  let sqrtH = sqrt(h);

  return vec2<f32>(-b - sqrtH, -b + sqrtH);

}



// Sphere distance for glow (IQ's method)

fn sphereDistance(ro : vec3<f32>, rd : vec3<f32>, center : vec3<f32>, radius : f32) -> f32 {

  let oc = ro - center;

  let b = dot(oc, rd);

  let h = dot(oc, oc) - b * b;

  return sqrt(max(0.0, h)) - radius;

}



// Simple hash for glow noise

fn glowHash(p : vec2<f32>) -> f32 {

  let p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);

  let dotP = dot(p3, p3.yzx + 33.33);

  return fract((p3.x + p3.y) * dotP);

}



// Cheap 2D noise for glow variation

fn glowNoise(p : vec2<f32>) -> f32 {

  let i = floor(p);

  let f = fract(p);

  let u = f * f * (3.0 - 2.0 * f);

  return mix(mix(glowHash(i), glowHash(i + vec2<f32>(1.0, 0.0)), u.x),

             mix(glowHash(i + vec2<f32>(0.0, 1.0)), glowHash(i + vec2<f32>(1.0, 1.0)), u.x), u.y);

}



// Spell type constants

const SPELL_PROJECTILE : u32 = 0u;

const SPELL_BEAM : u32 = 1u;

const SPELL_AOE : u32 = 2u;



// Calculate UV for beam-type spells (line from start to end)

fn getBeamUV(screenUV : vec2<f32>, startPos : vec3<f32>, endPos : vec3<f32>, beamWidth : f32) -> vec2<f32> {

  let startScreen = worldToScreen(startPos);

  let endScreen = worldToScreen(endPos);

  

  // Beam direction in screen space

  let beamDir = endScreen.xy - startScreen.xy;

  let beamLen = length(beamDir);

  if (beamLen < 0.001) { return vec2<f32>(-1.0); }

  

  let beamNorm = beamDir / beamLen;

  let beamPerp = vec2<f32>(-beamNorm.y, beamNorm.x);

  

  // Project screen point onto beam line

  let toPoint = screenUV - startScreen.xy;

  let alongBeam = dot(toPoint, beamNorm) / beamLen;  // 0 at start, 1 at end

  let perpDist = dot(toPoint, beamPerp) / beamWidth;  // Perpendicular distance

  

  return vec2<f32>(alongBeam, perpDist * 0.5 + 0.5);

}



// ============ FRAGMENT SHADER ============

@fragment

fn fs_spell_effect(input : FullscreenVSOut) -> @location(0) vec4<f32> {

  var totalColor = vec4<f32>(0.0);

  

  // Calculate ray from camera

  let ro = uniforms.cameraPos;

  let rd = getRay(input.uv);

  

  for (var i = 0u; i < uniforms.spellCount && i < MAX_ACTIVE_SPELLS; i = i + 1u) {

    let spell = spells[i];

    

    // Calculate localUV based on spell type

    var localUV = vec2<f32>(0.0);

    var screenDist = 0.0;

    var bounds = vec2<f32>(-1.0);

    

    if (spell.spellType == SPELL_BEAM) {

      // BEAM: Calculate UV along the beam line using world-space length stored in radius

      let dirNorm = normalize(spell.direction);

      let beamEnd = spell.position + dirNorm * spell.radius;

      let beamWidth = 0.15;  // Fixed screen-space width

      localUV = getBeamUV(input.uv, spell.position, beamEnd, beamWidth);

      

      // Skip if clearly outside beam bounds

      if (localUV.x < -0.2 || localUV.x > 1.2 || abs(localUV.y - 0.5) > 1.0) { continue; }

      

      screenDist = abs(localUV.y - 0.5);

    } else {

      // PROJECTILE/AOE: Use WORLD-SPACE ray-sphere intersection only

      // This ensures the volumetric effect is correctly positioned regardless of camera angle

      let toSpell = spell.position - ro;

      

      // Skip if spell is behind camera

      if (dot(toSpell, rd) < 0.0) { continue; }

      

      // Calculate ray-sphere intersection in world space

      bounds = raySphereIntersect(ro, rd, spell.position, spell.radius * 1.5);

      

      // Skip if ray doesn't hit the spell's bounding sphere

      if (bounds.x < 0.0 && bounds.y < 0.0) { continue; }

      

      // Calculate screen-space info only for legacy 2D effects (not used by volumetric shaders)

      let screenPos = worldToScreen(spell.position);

      let screenDiff = input.uv - screenPos.xy;

      let aspect = uniforms.screenSize.x / uniforms.screenSize.y;

      let correctedDiff = vec2<f32>(screenDiff.x * aspect, screenDiff.y);

      screenDist = length(correctedDiff);

      localUV = correctedDiff / (spell.radius * 0.15) * 0.5 + 0.5;

      

      // DO NOT early-exit based on screenDist for volumetric effects!

      // The ray-sphere intersection above is the correct 3D test.

      // Only skip if the ray truly misses the volume.

    }

    

    var effectColor = vec4<f32>(0.0);

    

    // Dispatch to manifest effect functions

${dispatchCases.length > 0 ? dispatchCases.join(' else ') : `    effectColor = vec4<f32>(spell.color, 0.5);`}

    

    // Add volumetric glow (only for light-emitting effects like fire)

    // Disabled for now for projectile spells; 3D volumetric shaders handle glow directly.

    let isLightEmitting = false;

    if (isLightEmitting && spell.spellType == SPELL_PROJECTILE && dot(rd, spell.position - ro) > 0.0) {

      let glowRadius = spell.radius * 0.5;

      let d = sphereDistance(ro, rd, spell.position, glowRadius);

      let falloffScale = 1.0 / max(spell.radius, 0.5);

      let glowAngle = atan2(rd.y, rd.x);

      let noiseCoord = vec2<f32>(glowAngle * 3.0 + spell.time * 2.0, d * 5.0 * falloffScale + spell.time);

      let n = glowNoise(noiseCoord * 8.0) * 0.5 + 0.5;

      let n2 = glowNoise(noiseCoord * 16.0 + 100.0) * 0.3 + 0.7;

      let noiseAmt = n * n2;

      var glow = vec3<f32>(0.0);

      glow += spell.color * 0.2 * exp(-4.0 * falloffScale * abs(d)) * step(0.0, d) * noiseAmt;

      glow += spell.color * 0.35 * exp(-12.0 * falloffScale * abs(d)) * (0.7 + noiseAmt * 0.3);

      glow += vec3<f32>(1.0, 0.9, 0.7) * 0.15 * exp(-60.0 * falloffScale * abs(d)) * n2;

      effectColor = vec4<f32>(effectColor.rgb + glow * 2.0, effectColor.a + length(glow) * 0.5);

    }

    

    totalColor = vec4<f32>(totalColor.rgb + effectColor.rgb * effectColor.a, max(totalColor.a, effectColor.a));

  }

  

  return totalColor;

}

`;



  return composedShader;

}



/**

 * Create the spell effect rendering pass

 */

export function createSpellEffectPass(device, options = {}) {

  const vgpu = initVGPU(device);

  const format = options.format || "bgra8unorm";

  

  // Compose shader from manifest effect functions

  const shaderCode = composeSpellShader();

  

  // Create shader module

  const shaderModule = vgpu.shader.compile('spellEffect', shaderCode);

  

  // Create buffers using vGPU

  const uniformBuffer = vgpu.buffer.create({ size: 256, usage: 'uniform', label: 'SpellEffectUniforms' }).buffer;

  const spellBuffer = vgpu.buffer.create({ size: MAX_ACTIVE_SPELLS * SPELL_INSTANCE_SIZE, usage: 'storage', label: 'SpellEffectSpells' }).buffer;

  

  // Bind group layout

  const bindGroupLayout = vgpu.bindings.defineLayout('spellEffect', [

    { binding: 0, type: 'uniform', visibility: 'fragment' },

    { binding: 1, type: 'read-storage', visibility: 'fragment' },

  ]);

  

  // Bind group

  const bindGroup = vgpu.bindings.createGroup(bindGroupLayout, [

    { binding: 0, buffer: uniformBuffer },

    { binding: 1, buffer: spellBuffer },

  ]);

  

  // Render pipeline with additive blending

  const pipeline = vgpu.pipeline.render({

    vertex: { module: shaderModule, entryPoint: 'vs_fullscreen' },

    fragment: { module: shaderModule, entryPoint: 'fs_spell_effect' },

    layouts: [bindGroupLayout],

    colorFormat: format,

    depthFormat: null,

    blend: {

      color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },

      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },

    },

    topology: 'triangle-list',

    label: 'SpellEffectPipeline'

  });

  

  return {

    pipeline,

    bindGroup,

    uniformBuffer,

    spellBuffer,

    device,

    vgpu,

  };

}



/**

 * Render active spell effects

 * 

 * @param {Object} pass - The spell effect pass object

 * @param {GPUCommandEncoder} encoder - Command encoder

 * @param {GPUTextureView} targetView - Render target view

 * @param {Object} options - Render options

 * @param {Float32Array} options.viewProj - View-projection matrix (16 floats)

 * @param {Float32Array} options.invViewProj - Inverse view-projection matrix (16 floats)

 * @param {Array} options.cameraPos - Camera position [x, y, z]

 * @param {number} options.time - Global time

 * @param {Array} options.screenSize - Screen dimensions [width, height]

 * @param {Array} options.activeSpells - Array of active spell objects

 */

export function renderSpellEffects(pass, encoder, targetView, options = {}) {

  const {

    viewProj,

    invViewProj,

    cameraPos = [0, 0, 0],

    time = 0,

    screenSize = [1920, 1080],

    activeSpells = [],

    debugSource = 'other',

  } = options;

  

  if (!viewProj || !invViewProj) {

    console.warn("[SpellEffectPass] Missing viewProj or invViewProj matrices");

    return;

  }

  

  const spellCount = Math.min(activeSpells.length, MAX_ACTIVE_SPELLS);

  

  if (spellCount === 0) {

    return; // Nothing to render

  }



  const src = debugSource === 'comic' || debugSource === 'particle' ? debugSource : 'other';

  if (debugSpellFrames[src] < 60) {

    try {

      // Enhanced debug: compute orthonormal basis for each spell (mirrors shader math)

      const spellsWithBasis = activeSpells.slice(0, spellCount).map((s, idx) => {

        const dir = s.direction || [0, 0, 1];

        const dirLen = Math.sqrt(dir[0]*dir[0] + dir[1]*dir[1] + dir[2]*dir[2]);

        

        // Normalize direction (fwd)

        const fwd = dirLen > 0.001 

          ? [dir[0]/dirLen, dir[1]/dirLen, dir[2]/dirLen] 

          : [0, 0, 1];

        

        // Choose upRef that's not parallel to fwd

        let upRef = [0, 1, 0];

        const dDotUp = Math.abs(fwd[0]*upRef[0] + fwd[1]*upRef[1] + fwd[2]*upRef[2]);

        if (dDotUp > 0.95) {

          upRef = [1, 0, 0];  // Use X-axis if fwd is nearly vertical

        }

        

        // right = cross(upRef, fwd)

        const right = [

          upRef[1]*fwd[2] - upRef[2]*fwd[1],

          upRef[2]*fwd[0] - upRef[0]*fwd[2],

          upRef[0]*fwd[1] - upRef[1]*fwd[0]

        ];

        const rightLen = Math.sqrt(right[0]*right[0] + right[1]*right[1] + right[2]*right[2]);

        if (rightLen > 0.001) {

          right[0] /= rightLen; right[1] /= rightLen; right[2] /= rightLen;

        }

        

        // up = cross(fwd, right)

        const up = [

          fwd[1]*right[2] - fwd[2]*right[1],

          fwd[2]*right[0] - fwd[0]*right[2],

          fwd[0]*right[1] - fwd[1]*right[0]

        ];

        

        return {

          idx,

          position: s.position,

          direction: dir,

          dirLen: dirLen.toFixed(4),

          basis: {

            fwd: fwd.map(v => v.toFixed(3)),

            right: right.map(v => v.toFixed(3)),

            up: up.map(v => v.toFixed(3)),

          },

          dDotUp: dDotUp.toFixed(3),

        };

      });

      

      const dbg = {

        frame: debugSpellFrames[src],

        spellCount,

        cameraPos: cameraPos.map(v => v.toFixed(2)),

        screenSize,

        source: src,

        spells: spellsWithBasis,

      };

      console.log('[SpellEffectPass][debug]', JSON.stringify(dbg));

    } catch (e) {

      console.warn('[SpellEffectPass] Debug logging error:', e);

    }

    debugSpellFrames[src]++;

  }

  

  // Build uniform data - reuse module-level buffer

  // Layout: viewProj (64) + invViewProj (64) + cameraPos (12) + time (4) + screenSize (8) + spellCount (4) + pad (4)

  _spellUniformData.set(viewProj, 0);             // 0-15: viewProj

  _spellUniformData.set(invViewProj, 16);         // 16-31: invViewProj

  _spellUniformData[32] = cameraPos[0];           // 32: cameraPos.x

  _spellUniformData[33] = cameraPos[1];           // 33: cameraPos.y

  _spellUniformData[34] = cameraPos[2];           // 34: cameraPos.z

  _spellUniformData[35] = time;                   // 35: globalTime

  _spellUniformData[36] = screenSize[0];          // 36: screenSize.x

  _spellUniformData[37] = screenSize[1];          // 37: screenSize.y

  

  // Pack spellCount as u32 bits into float

  const uint32View = new Uint32Array(_spellUniformData.buffer);

  uint32View[38] = spellCount;              // 38: spellCount (u32)

  uint32View[39] = 0;                       // 39: padding

  

  pass.device.queue.writeBuffer(pass.uniformBuffer, 0, _spellUniformData);

  

  // Build spell instance data - dynamic buffer grows as needed

  // Each spell: position(3) + radius(1) + direction(3) + intensity(1) + color(3) + spellType(1) + effectType(1) + phase(1) + time(1) + pad(1) = 16 floats

  ensureSpellInstanceCapacity(spellCount);

  const spellData = _spellInstanceData;

  const spellUint32 = new Uint32Array(spellData.buffer);

  

  for (let i = 0; i < spellCount; i++) {

    const spell = activeSpells[i];

    const offset = i * 16;

    

    const effectTypeValue = spell.effectType ?? EFFECT_TYPES.FIRE;

    

    // Position

    spellData[offset + 0] = spell.position?.[0] ?? 0;

    spellData[offset + 1] = spell.position?.[1] ?? 0;

    spellData[offset + 2] = spell.position?.[2] ?? 0;

    spellData[offset + 3] = spell.radius ?? 2.0;

    

    // Direction

    spellData[offset + 4] = spell.direction?.[0] ?? 0;

    spellData[offset + 5] = spell.direction?.[1] ?? 0;

    spellData[offset + 6] = spell.direction?.[2] ?? 1;

    spellData[offset + 7] = spell.intensity ?? 1.0;

    

    // Color

    spellData[offset + 8] = spell.color?.[0] ?? 1.0;

    spellData[offset + 9] = spell.color?.[1] ?? 0.5;

    spellData[offset + 10] = spell.color?.[2] ?? 0.1;

    

    // Types (as u32)

    spellUint32[offset + 11] = spell.spellType ?? SPELL_TYPES.PROJECTILE;

    spellUint32[offset + 12] = effectTypeValue;

    

    // Animation

    spellData[offset + 13] = spell.phase ?? 0.5;

    spellData[offset + 14] = spell.time ?? time;

    spellData[offset + 15] = 0; // padding

  }

  

  pass.device.queue.writeBuffer(pass.spellBuffer, 0, spellData);

  

  // Render pass

  const renderPass = encoder.beginRenderPass({

    colorAttachments: [{

      view: targetView,

      loadOp: "load",  // Keep existing content (additive overlay)

      storeOp: "store",

    }],

  });

  

  renderPass.setPipeline(pass.pipeline);

  renderPass.setBindGroup(0, pass.bindGroup);

  renderPass.draw(3, 1, 0, 0);  // Fullscreen triangle

  renderPass.end();

}



/**

 * Map spell element to effect type

 */

export function spellElementToEffectType(element) {

  const mapping = {

    fire: EFFECT_TYPES.FIRE,

    ice: EFFECT_TYPES.ICE,

    frost: EFFECT_TYPES.ICE,

    lightning: EFFECT_TYPES.LIGHTNING,

    electric: EFFECT_TYPES.LIGHTNING,

    arcane: EFFECT_TYPES.ARCANE,

    magic: EFFECT_TYPES.ARCANE,

    holy: EFFECT_TYPES.HOLY,

    light: EFFECT_TYPES.HOLY,

    dark: EFFECT_TYPES.DARK,

    shadow: EFFECT_TYPES.DARK,

    nature: EFFECT_TYPES.NATURE,

    earth: EFFECT_TYPES.NATURE,

    wind: EFFECT_TYPES.WIND,

    air: EFFECT_TYPES.WIND,

  };

  

  return mapping[element?.toLowerCase()] ?? EFFECT_TYPES.FIRE;

}



/**

 * Convert a spell config to a renderable spell instance

 */

export function spellConfigToInstance(spellConfig, position, time, phase = 0.5) {

  return {

    position,

    radius: (spellConfig.size ?? 1.0) * 2.0,

    direction: spellConfig.direction ?? [0, 0, 1],

    intensity: spellConfig.intensity ?? 1.0,

    color: spellConfig.coreColor ?? spellConfig.color ?? [1, 0.5, 0.1],

    spellType: SPELL_TYPES[spellConfig.type?.toUpperCase()] ?? SPELL_TYPES.PROJECTILE,

    effectType: spellElementToEffectType(spellConfig.element),

    phase,

    time,

  };

}

