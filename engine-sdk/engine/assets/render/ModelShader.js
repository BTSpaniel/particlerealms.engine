// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/render/ModelShader.js — the default lit WGSL shader + pipeline
// for drawing an EngineModel's standard-layout primitives. Small and overridable:
// any engine system can grab LIT_MODEL_SHADER for a sensible default, or pass its
// own WGSL to createModelPipeline. The shader pairs with standardVertexLayout()
// (pos3 + nrm3 + uv2) and the 160-byte uniform block written by ModelGpu.

import { standardVertexLayout } from '../import/GpuUploader.js';

// Uniform block layout (std140-ish, 160 bytes): mvp(64) model(64) color(16) eye(16).
export const MODEL_UNIFORM_BYTES = 160;
export const MODEL_UNIFORM_FLOATS = 40;

/** A neutral physically-plausible lit shader with albedo floor + additive rim. */
export const LIT_MODEL_SHADER = `
struct U { mvp: mat4x4f, model: mat4x4f, color: vec4f, eye: vec4f }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
struct VO { @builtin(position) pos: vec4f, @location(0) nrm: vec3f, @location(1) uv: vec2f, @location(2) wpos: vec3f }
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f) -> VO {
  var o: VO;
  o.pos = u.mvp * vec4f(p, 1.0);
  o.nrm = (u.model * vec4f(n, 0.0)).xyz;
  o.uv = uv;
  o.wpos = (u.model * vec4f(p, 1.0)).xyz;
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let N = normalize(i.nrm);
  let V = normalize(u.eye.xyz - i.wpos);
  let albedo = max(u.color.rgb * textureSample(tex, samp, i.uv).rgb, vec3f(0.05));
  let key = max(dot(N, normalize(vec3f(0.5, 0.8, 0.4))), 0.0);
  let fill = max(dot(N, normalize(vec3f(-0.5, 0.25, -0.6))), 0.0) * 0.35;
  let amb = 0.38 + 0.22 * max(N.y, 0.0);
  let rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.5;
  let lit = albedo * (amb + key * 0.85 + fill) + vec3f(rim);
  return vec4f(lit, 1.0);
}`;

/**
 * Raster-safe Astral Sculpture Court lighting library.
 *
 * The chunk has no bindings or application-owned structs, so renderers can
 * compose it into their own WGSL while retaining their material, selection,
 * and picking contracts. `studioLight` preserves the original dielectric
 * asset-preview behavior; `studioMaterialLight` accepts authored metallic and
 * roughness values for richer editors such as RealmForge.
 */
export const SCULPTURE_COURT_RASTER_LIGHTING_WGSL = /* wgsl */`
const PI = 3.14159265359;

fn safeNormalize(value: vec3f, fallback: vec3f) -> vec3f {
  let magnitude = length(value);
  return select(fallback, value / magnitude, magnitude > 1e-6);
}

fn pbrNeutral(colorInput: vec3f) -> vec3f {
  var color = max(colorInput, vec3f(0.0));
  let startCompression = 0.76;
  let darkest = min(color.r, min(color.g, color.b));
  let offset = select(0.04, darkest - 6.25 * darkest * darkest, darkest < 0.08);
  color -= vec3f(offset);
  let peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) { return color; }
  let distance = 1.0 - startCompression;
  let newPeak = 1.0 - distance * distance / (peak + distance - startCompression);
  color *= newPeak / max(peak, 1e-6);
  let desaturationAmount = 1.0 - 1.0 / (0.15 * (peak - newPeak) + 1.0);
  return mix(color, vec3f(newPeak), desaturationAmount);
}

fn linearToSrgb(color: vec3f) -> vec3f {
  let low = color * 12.92;
  let high = 1.055 * pow(max(color, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
  return select(low, high, color > vec3f(0.0031308));
}

fn environmentRadiance(direction: vec3f) -> vec3f {
  let height = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
  let zenith = vec3f(0.08, 0.16, 0.28);
  let horizon = vec3f(0.38, 0.42, 0.32);
  let ground = vec3f(0.035, 0.060, 0.028);
  let upper = mix(horizon, zenith, pow(height, 1.45));
  let lower = mix(ground, horizon * 0.42, smoothstep(-0.55, 0.05, direction.y));
  let sky = select(lower, upper, direction.y >= 0.0);
  let accentDirection = safeNormalize(vec3f(-0.45, 0.62, 0.64), vec3f(0.0, 1.0, 0.0));
  let horizonGlow = exp(-abs(direction.y) * 15.0) * horizon * 0.10;
  let windowAccent = pow(max(dot(direction, accentDirection), 0.0), 48.0) * vec3f(0.72, 0.58, 0.34);
  return sky + horizonGlow + windowAccent;
}

fn distributionGgx(noH: f32, roughness: f32) -> f32 {
  let alpha = roughness * roughness;
  let alpha2 = alpha * alpha;
  let denominator = noH * noH * (alpha2 - 1.0) + 1.0;
  return alpha2 / max(PI * denominator * denominator, 1e-5);
}

fn geometrySchlick(noX: f32, roughness: f32) -> f32 {
  let radius = roughness + 1.0;
  let k = radius * radius * 0.125;
  return noX / max(noX * (1.0 - k) + k, 1e-5);
}

fn fresnelSchlick(voH: f32, f0: vec3f) -> vec3f {
  return f0 + (vec3f(1.0) - f0) * pow(1.0 - voH, 5.0);
}

fn studioMaterialLight(normal: vec3f, view: vec3f, light: vec3f, radiance: vec3f,
                       albedo: vec3f, metallic: f32, roughness: f32) -> vec3f {
  let noL = max(dot(normal, light), 0.0);
  let noV = max(dot(normal, view), 0.0);
  let halfVector = safeNormalize(view + light, normal);
  let noH = max(dot(normal, halfVector), 0.0);
  let voH = max(dot(view, halfVector), 0.0);
  let f0 = mix(vec3f(0.04), albedo, metallic);
  let fresnel = fresnelSchlick(voH, f0);
  let specular = distributionGgx(noH, roughness)
    * geometrySchlick(noL, roughness) * geometrySchlick(noV, roughness)
    * fresnel / max(4.0 * noL * noV, 1e-4);
  let diffuse = (vec3f(1.0) - fresnel) * (1.0 - metallic) * albedo / PI;
  return (diffuse + specular) * radiance * noL;
}

fn studioLight(normal: vec3f, view: vec3f, light: vec3f, radiance: vec3f,
               albedo: vec3f, roughness: f32) -> vec3f {
  return studioMaterialLight(normal, view, light, radiance, albedo, 0.0, roughness);
}

fn studioEnvironment(normal: vec3f, view: vec3f, albedo: vec3f,
                     metallic: f32, roughness: f32, occlusion: f32) -> vec3f {
  let reflected = reflect(-view, normal);
  let noV = max(dot(normal, view), 0.0);
  let f0 = mix(vec3f(0.04), albedo, metallic);
  let fresnel = fresnelSchlick(noV, f0);
  let diffuse = (1.0 - metallic) * albedo * environmentRadiance(normal) * 0.58;
  let specular = environmentRadiance(reflected) * fresnel
    * (0.28 + (1.0 - roughness) * 0.44);
  return (diffuse + specular) * occlusion;
}

fn gradientNoise(pixel: vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(pixel, vec2f(0.06711056, 0.00583715))));
}
`;

/**
 * Gallery raster lighting derived from the Astral Sculpture Court studies:
 * warm broad key, restrained green-cyan fill, cool portal rim, park/studio
 * environment response, Khronos PBR Neutral, and stable one-LSB dithering.
 * It deliberately preserves the default renderer bind/uniform contract.
 */
export const SCULPTURE_COURT_MODEL_SHADER = `
${SCULPTURE_COURT_RASTER_LIGHTING_WGSL}
struct U { mvp: mat4x4f, model: mat4x4f, color: vec4f, eye: vec4f }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
struct VO { @builtin(position) pos: vec4f, @location(0) nrm: vec3f, @location(1) uv: vec2f, @location(2) wpos: vec3f }

@vertex fn vs(@location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f) -> VO {
  var output: VO;
  output.pos = u.mvp * vec4f(position, 1.0);
  output.nrm = (u.model * vec4f(normal, 0.0)).xyz;
  output.uv = uv;
  output.wpos = (u.model * vec4f(position, 1.0)).xyz;
  return output;
}

@fragment fn fs(input: VO) -> @location(0) vec4f {
  let view = safeNormalize(u.eye.xyz - input.wpos, vec3f(0.0, 0.0, 1.0));
  let geometricNormal = safeNormalize(input.nrm, vec3f(0.0, 1.0, 0.0));
  let normal = select(-geometricNormal, geometricNormal, dot(geometricNormal, view) >= 0.0);
  let albedo = max(u.color.rgb * textureSample(tex, samp, input.uv).rgb, vec3f(0.012));
  let roughness = 0.36 + 0.16 * (1.0 - max(albedo.r, max(albedo.g, albedo.b)));
  let key = studioLight(normal, view, safeNormalize(vec3f(-0.55, 0.78, 0.30), normal), vec3f(3.15, 2.72, 2.05), albedo, roughness);
  let fill = studioLight(normal, view, safeNormalize(vec3f(0.82, 0.30, 0.34), normal), vec3f(0.48, 0.82, 0.66), albedo, roughness);
  let rim = studioLight(normal, view, safeNormalize(vec3f(0.10, 0.42, -0.90), normal), vec3f(0.62, 0.86, 1.24), albedo, max(0.24, roughness * 0.72));
  let environment = studioEnvironment(normal, view, albedo, 0.0, roughness, 1.0);
  let linearColor = (key + fill + rim + environment) * 1.04;
  var encoded = linearToSrgb(clamp(pbrNeutral(linearColor), vec3f(0.0), vec3f(1.0)));
  let dither = (gradientNoise(input.pos.xy) - 0.5) / 255.0;
  encoded = clamp(encoded + vec3f(dither), vec3f(0.0), vec3f(1.0));
  return vec4f(encoded, 1.0);
}`;

/** Full-screen gallery/park environment paired with the sculpture shader. */
export const SCULPTURE_COURT_BACKDROP_SHADER = `
${SCULPTURE_COURT_RASTER_LIGHTING_WGSL}
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) index: u32) -> VO {
  let positions = array<vec2f,3>(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0));
  var output: VO;
  output.pos = vec4f(positions[index], 0.999999, 1.0);
  output.uv = positions[index] * 0.5 + 0.5;
  return output;
}
@fragment fn fs(input: VO) -> @location(0) vec4f {
  let uv = input.uv;
  let horizon = smoothstep(0.26, 0.66, uv.y);
  let upper = mix(vec3f(0.055, 0.072, 0.105), vec3f(0.012, 0.025, 0.055), horizon);
  let floor = mix(vec3f(0.020, 0.032, 0.027), vec3f(0.078, 0.074, 0.058), smoothstep(0.0, 0.34, uv.y));
  let base = select(floor, upper, uv.y > 0.34);
  let warmWindow = exp(-dot((uv - vec2f(0.18, 0.62)) / vec2f(0.24, 0.42), (uv - vec2f(0.18, 0.62)) / vec2f(0.24, 0.42))) * vec3f(0.22, 0.14, 0.055);
  let coolPortal = exp(-dot((uv - vec2f(0.84, 0.56)) / vec2f(0.22, 0.36), (uv - vec2f(0.84, 0.56)) / vec2f(0.22, 0.36))) * vec3f(0.035, 0.11, 0.16);
  let centered = uv * 2.0 - 1.0;
  let vignette = 1.0 - smoothstep(0.58, 1.42, length(centered)) * 0.42;
  let linearColor = (base + warmWindow + coolPortal) * vignette;
  var encoded = linearToSrgb(clamp(pbrNeutral(linearColor), vec3f(0.0), vec3f(1.0)));
  encoded = clamp(encoded + vec3f((gradientNoise(input.pos.xy) - 0.5) / 255.0), vec3f(0.0), vec3f(1.0));
  return vec4f(encoded, 1.0);
}`;

/**
 * Build the render pipeline for EngineModel primitives.
 * @param {GPUDevice} device
 * @param {object} opts { format, depthFormat?, wgsl?, label?, cullMode? }
 * @returns {{ pipeline: GPURenderPipeline, shader: GPUShaderModule, depthFormat: string }}
 */
export function createModelPipeline(device, opts = {}) {
  const format = opts.format;
  if (!format) throw new Error('createModelPipeline: opts.format (swapchain format) is required');
  const depthFormat = opts.depthFormat ?? 'depth24plus';
  const shader = device.createShaderModule({ code: opts.wgsl ?? LIT_MODEL_SHADER, label: opts.label ?? 'asset-model-shader' });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: shader, entryPoint: 'vs', buffers: [standardVertexLayout()] },
    fragment: { module: shader, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: opts.cullMode ?? 'none' },
    depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'less' },
  });
  return { pipeline, shader, depthFormat };
}
