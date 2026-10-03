// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { AMBIENT_RUNTIME_V3_FRAME_WGSL, AMBIENT_RUNTIME_V3_PRESENT_WGSL } from '../schema/AmbientRuntimeV3Contract.js';
import { normalizeAmbientRecipeControls, ambientRecipeWgslConstants } from '../schema/AmbientRecipeControls.js';
import { applyAmbientNativeAppearance } from '../schema/AmbientNativeAppearance.js';

const DEFINITIONS = Object.freeze({
    'particle-world': { mode: 0, colors: ['#6989ff', '#45dfc5', '#e9ccff'] },
    'stellar-drift': { mode: 1, colors: ['#8d9fff', '#b8c4ef', '#eddbbc'] },
    'vortex-bloom': { mode: 2, colors: ['#ec8dbc', '#897aff', '#91ece0'] },
});
const FRAME = `${AMBIENT_RUNTIME_V3_FRAME_WGSL}\n@group(0) @binding(0) var<uniform> frame: AmbientV3Frame;`;
const PRESENT = `${FRAME}\n${AMBIENT_RUNTIME_V3_PRESENT_WGSL}
@group(0) @binding(1) var colorField: texture_2d<f32>;
@vertex fn presentVertex(@builtin(vertex_index) id: u32) -> @builtin(position) vec4f {
 let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0)); return vec4f(p[id], 0.0, 1.0);
}
@fragment fn presentFragment(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
 let size = textureDimensions(colorField); let coordinate = clamp(vec2i(pixel.xy), vec2i(0), vec2i(size) - vec2i(1));
 let color = textureLoad(colorField, coordinate, 0).rgb;
 return vec4f(ambientV3Grade(color, pixel.xy / vec2f(size), pixel.xy, frame.tone.y, frame.tone.z, frame.tone.w), 1.0);
}`;

/** Draws source-equivalent instanced sprites through the existing V3 owner.
 * Positions are deterministic analytic functions of index, seed and time.
 * There is no CPU particle loop or separate animation/device lifecycle.
 */
export async function createAmbientCollectionParticleLane({ device, format, plan, uniformBuffer }) {
    const definition = DEFINITIONS[plan?.recipeId];
    if (!definition || plan.executionClass !== 'particle-field') throw new TypeError('Unknown native collection particle field');
    const controls = normalizeAmbientRecipeControls(plan.recipeId, plan.settings.recipeControls);
    const particleModule = device.createShaderModule({ label: `${plan.recipeId}-particles`, code: buildAmbientCollectionParticleSource(plan) });
    const presentModule = device.createShaderModule({ label: `${plan.recipeId}-present`, code: buildAmbientCollectionParticlePresentSource(plan) });
    for (const module of [particleModule, presentModule]) {
        const info = await module.getCompilationInfo();
        const errors = info.messages.filter(message => message.type === 'error');
        if (errors.length) throw new Error(errors.map(message => message.message).join('; '));
    }
    const particleLayout = plan.appearance ? device.createPipelineLayout({ bindGroupLayouts: [device.createBindGroupLayout({ entries: [{ binding: 0, visibility: 3, buffer: { type: 'uniform' } }] })] }) : 'auto';
    const presentLayout = plan.appearance ? device.createPipelineLayout({ bindGroupLayouts: [device.createBindGroupLayout({ entries: [{ binding: 0, visibility: 3, buffer: { type: 'uniform' } }, { binding: 1, visibility: 2, texture: { sampleType: 'unfilterable-float' } }] })] }) : 'auto';
    const particlePipeline = await device.createRenderPipelineAsync({
        label: `${plan.recipeId}-particle-pipeline`, layout: particleLayout,
        vertex: { module: particleModule, entryPoint: 'particleVertex' },
        fragment: { module: particleModule, entryPoint: 'particleFragment', targets: [{ format: 'rgba16float', blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } }] },
        primitive: { topology: 'triangle-list' },
    });
    const presentPipeline = await device.createRenderPipelineAsync({ layout: presentLayout, vertex: { module: presentModule, entryPoint: 'presentVertex' }, fragment: { module: presentModule, entryPoint: 'presentFragment', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
    const particleBind = device.createBindGroup({ layout: particlePipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
    let colorTexture = null, presentBind = null, width = 0, height = 0, disposed = false;
    return Object.freeze({
        executionClass: plan.executionClass, recipeId: plan.recipeId,
        resize(nextWidth, nextHeight) {
            if (disposed) return false;
            const w = Math.max(2, Math.floor(Number(nextWidth) || 2)); const h = Math.max(2, Math.floor(Number(nextHeight) || 2));
            if (w === width && h === height && colorTexture) return false;
            colorTexture?.destroy(); width = w; height = h;
            colorTexture = device.createTexture({ label: `${plan.recipeId}-color`, size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
            presentBind = device.createBindGroup({ layout: presentPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniformBuffer } }, { binding: 1, resource: colorTexture.createView() }] });
            return true;
        },
        encode(encoder, targetView, clearValue) {
            if (disposed || !colorTexture || !targetView) return null;
            const particles = encoder.beginRenderPass({ label: `${plan.recipeId}-render`, colorAttachments: [{ view: colorTexture.createView(), clearValue, loadOp: 'clear', storeOp: 'store' }] });
            particles.setPipeline(particlePipeline); particles.setBindGroup(0, particleBind); particles.draw(6, controls.population); particles.end();
            const present = encoder.beginRenderPass({ label: `${plan.recipeId}-present`, colorAttachments: [{ view: targetView, clearValue, loadOp: 'clear', storeOp: 'store' }] });
            present.setPipeline(presentPipeline); present.setBindGroup(0, presentBind); present.draw(3); present.end();
            return null;
        },
        resourceCounts: () => Object.freeze({ buffers: 0, textures: colorTexture ? 1 : 0, persistentBuffers: 0, persistentTextures: 0 }),
        dispose() { if (disposed) return false; disposed = true; colorTexture?.destroy(); colorTexture = null; presentBind = null; return true; },
    });
}

export function buildAmbientCollectionParticleSource(plan) {
    const { mode, colors } = DEFINITIONS[plan.recipeId] ?? {};
    if (!colors) throw new TypeError('Unknown collection particle source');
    const source = `${FRAME}\n${ambientRecipeWgslConstants(plan.recipeId, plan.settings?.recipeControls)}
struct ParticleVertexOut { @builtin(position) position: vec4f, @location(0) local: vec2f, @location(1) hue: f32, @location(2) sparkle: f32, @location(3) flare: f32, }
fn particleHash(index: f32) -> f32 {
 var bits = u32(index) + 7314u; bits = (bits ^ (bits >> 16u)) * 2246822519u;
 bits = (bits ^ (bits >> 13u)) * 3266489917u; bits ^= bits >> 16u;
 return f32(bits & 16777215u) / 16777216.0;
}
@vertex fn particleVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> ParticleVertexOut {
 let id = f32(instance); let r = particleHash(id + 1.0); let a = particleHash(id + 71.0) * 6.2831853;
 let z = particleHash(id + 303.0) * 2.0 - 1.0;
 let time = select(frame.resolutionTime.z * frame.tone.x, 0.0, frame.effects.w > 0.5);
 var visibility = 1.0;
 var position: vec3f;
 ${mode === 1 ? `let phase = fract(particleHash(id + 411.0) + time * 0.19 / art_travelDepth);
 visibility = smoothstep(0.0, 0.08, phase) * (1.0 - smoothstep(0.84, 1.0, phase));
 let x = (particleHash(id + 37.0) - 0.5) * 15.0 * art_fieldScale;
 let band = x * 0.26 + sin(x * 0.72) * 0.34;
 let y = select(band + z * abs(z) * 1.4, z * 6.0, particleHash(id + 91.0) < 0.26);
 position = vec3f(x, y * art_fieldScale, (0.5 - phase) * art_travelDepth);` : mode === 2 ? `let ribbon = f32(instance % 7u);
 let angle = a + time * 0.095 + ribbon * 0.17;
 let petal = cos(angle * art_petalTwist + ribbon * 0.44 + time * 0.07);
 let radius = (0.36 + ribbon * 0.30 + petal * (0.25 + ribbon * 0.025) + (r-0.5)*0.32 + sin(angle*7.0+ribbon*1.7)*0.055) * art_fieldScale;
 let fold = sin(angle * art_petalTwist + ribbon * 0.44 + time * 0.07);
 position = vec3f(cos(angle) * radius, sin(angle) * radius * 0.86, fold * (0.3 + ribbon * 0.12));
 position += vec3f(z * 0.022, z * 0.022, z * 0.025);` : `let radius = (0.045 + pow(r, 0.72) * 3.8) * art_fieldScale;
 let arm = f32(instance % 5u) * 1.256637;
 let scatter = (particleHash(id + 193.0) - 0.5) * (0.22 + r * 1.2) * (0.6 + 0.4*sin(a*3.0+radius));
 let angle = arm + log(radius + 0.12) * 1.9 + scatter + time * (0.055 + 0.11 / (0.9 + radius));
 position = vec3f(cos(angle) * radius, z * art_discThickness * (0.18 + r * 0.75), sin(angle) * radius);`}
 let tilt = ${mode === 1 ? '0.0' : mode === 2 ? '0.18' : '0.72'};
 let tilted = vec2f(cos(tilt) * position.y - sin(tilt) * position.z, sin(tilt) * position.y + cos(tilt) * position.z);
 position = vec3f(position.x, tilted);
 let aspect = frame.resolutionTime.x / max(frame.resolutionTime.y, 1.0);
 let framing = ${mode === 1 ? '1.0' : 'max(1.0, 1.08 / aspect)'};
 let depth = 6.5 + position.z;
 visibility *= smoothstep(0.5, 1.4, depth);
 let perspective = ${mode === 0 ? '3.9' : '4.5'} / max(0.5, depth);
 var projected = position.xy * perspective / (vec2f(${mode === 1 ? '1.95' : '2.65'} * aspect, ${mode === 1 ? '1.95' : '2.65'}) * framing);
 ${mode === 0 ? 'projected = vec2f(projected.x * 0.94 - projected.y * 0.28, projected.x * 0.28 + projected.y * 0.94);' : ''}
 let pointer = vec2f(frame.pointer.x * 2.0 - 1.0, 1.0 - frame.pointer.y * 2.0);
 let delta = pointer - projected;
 let response = exp(-dot(delta * vec2f(aspect, 1.0), delta * vec2f(aspect, 1.0)) * 6.0) * frame.pointerState.x * frame.effects.x * (1.0 - frame.effects.w) * art_attraction;
 let center = projected + delta * response * 0.16;
 let corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
 let corner = corners[vertex]; let rarity = particleHash(id + 809.0);
 let flare = pow(rarity, 80.0);
 let radiusPx = (1.9 + flare * 5.0 + abs(position.z) * 0.13) * (0.45 + perspective * 0.55);
 var output: ParticleVertexOut;
 ${mode === 2 ? `let tangent = vec2f(-sin(angle),cos(angle));
 let across = vec2f(tangent.y,-tangent.x);
 let footprint = tangent * corner.x * radiusPx * 4.4 + across * corner.y * radiusPx * 1.4;
 output.position = vec4f(center + footprint / frame.resolutionTime.xy, 0.0, 1.0);` : 'output.position = vec4f(center + corner * radiusPx * 3.0 / frame.resolutionTime.xy, 0.0, 1.0);'}
 output.local = corner; output.hue = ${mode === 2 ? 'clamp(ribbon / 7.0 + sin(a * 3.0) * 0.16, 0.0, 1.0)' : mode === 0 ? 'clamp(r * 0.85 + particleHash(id + 111.0) * 0.18, 0.0, 1.0)' : 'particleHash(id + 111.0)'};
 output.sparkle = (0.55 + 1.7 * rarity * rarity) * visibility; output.flare = flare;
 return output;
}
@fragment fn particleFragment(input: ParticleVertexOut) -> @location(0) vec4f {
 let radius = dot(input.local, input.local); if (radius > 1.0) { discard; }
 let halo = exp(-radius * 5.0) * ${mode === 2 ? '0.26' : '0.12'};
 let core = exp(-radius * (24.0 + input.flare * 48.0));
 let spike = exp(-abs(input.local.x * input.local.y) * 180.0) * exp(-radius * 8.0) * input.flare * 0.12;
 let tint = ${mode === 0 ? 'mix(vec3f(1.0, 0.67, 0.28), mix(vec3f(0.16, 0.59, 0.78), vec3f(0.64, 0.84, 1.0), input.hue), smoothstep(0.12, 0.58, input.hue))' : mode === 2 ? 'mix(mix(vec3f(0.12, 0.48, 0.59), vec3f(0.69, 0.27, 0.36), input.hue), vec3f(1.0, 0.73, 0.35), smoothstep(0.55, 0.9, input.hue))' : `mix(mix(${rgb(colors[0])}, ${rgb(colors[1])}, input.hue), ${rgb(colors[2])}, pow(input.hue, 6.0))`};
 return vec4f(tint * (halo + core * 0.65 + spike) * input.sparkle, 0.0);
}`;
    return applyAmbientNativeAppearance(source, plan.appearance?.renderFunctions);
}

/** Low-frequency light is rendered in the existing resolve, underneath the
 * individual stars. It supplies atmosphere without a second scene or texture. */
export function buildAmbientCollectionParticlePresentSource(plan) {
    const mode = DEFINITIONS[plan.recipeId]?.mode;
    if (mode === undefined) throw new TypeError('Unknown collection particle atmosphere');
    const helpers = `
fn dustHash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1,311.7))) * 43758.5453); }
fn dustNoise(p: vec2f) -> f32 {
 let i = floor(p); let f = fract(p); let w = f*f*(3.0-2.0*f);
 return mix(mix(dustHash(i), dustHash(i+vec2f(1,0)), w.x), mix(dustHash(i+vec2f(0,1)), dustHash(i+vec2f(1,1)), w.x), w.y);
}
fn dustField(p0: vec2f) -> f32 {
 var p = p0; var v = 0.0; var a = 0.5;
 for (var i=0; i<5; i++) { v += dustNoise(p)*a; p = vec2f(p.x*1.71-p.y*1.23,p.x*1.23+p.y*1.71)+3.1; a *= 0.48; }
 return v;
}
fn particleAtmosphere(uv: vec2f) -> vec3f {
 let aspect = frame.resolutionTime.x / max(frame.resolutionTime.y,1.0);
 let p = (uv - 0.5) * vec2f(aspect,1.0);
 let time = select(frame.resolutionTime.z * frame.tone.x, 0.0, frame.effects.w>0.5);
 let n = dustField(p*5.0 + vec2f(time*0.014,0.0));
 ${mode === 1 ? `let band = exp(-pow(abs((p.y+p.x*0.26+sin(p.x*3.0)*0.055)/(0.055+n*0.12)),2.0));
 let clumps = smoothstep(0.2,0.78,dustField(p*8.0+vec2f(n*3.0,2.0)));
 let rift = smoothstep(0.31,0.57,dustField(p*12.0+vec2f(n*2.0,-3.0)));
 return vec3f(0.0015,0.003,0.008) + mix(vec3f(0.065,0.09,0.16),vec3f(0.28,0.16,0.09),clumps)*band*clumps*rift*0.9;` : mode === 0 ? `let q = vec2f(p.x*0.94-p.y*0.28,p.x*0.28+p.y*0.94);
 let core = exp(-dot(q*vec2f(1.0,2.8),q*vec2f(1.0,2.8))*55.0);
 let dust = exp(-dot(q*vec2f(1.0,2.1),q*vec2f(1.0,2.1))*9.0);
 return vec3f(0.001,0.003,0.008)+vec3f(0.38,0.2,0.065)*core*0.28+vec3f(0.023,0.058,0.08)*dust*n;` : `let glow = exp(-dot(p,p)*9.0);
 return vec3f(0.002,0.004,0.007) + mix(vec3f(0.01,0.042,0.049),vec3f(0.09,0.023,0.032),smoothstep(-0.3,0.4,p.x))*glow*n;`}
}`;
    const source = PRESENT.replace('@fragment fn presentFragment', `${ambientRecipeWgslConstants(plan.recipeId, plan.settings?.recipeControls)}\n${helpers}\n@fragment fn presentFragment`)
        .replace('let color = textureLoad(colorField, coordinate, 0).rgb;', 'let color = textureLoad(colorField, coordinate, 0).rgb + particleAtmosphere(pixel.xy / vec2f(size));');
    return applyAmbientNativeAppearance(source, plan.appearance?.presentFunctions);
}

function rgb(color) { return `vec3f(${[1, 3, 5].map(offset => (parseInt(color.slice(offset, offset + 2), 16) / 255).toFixed(6)).join(', ')})`; }
