// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Dedicated bounded GPU lanes for Ambient Runtime V3 stateful recipes. */

import {
    AMBIENT_RUNTIME_V3_FRAME_WGSL,
    AMBIENT_RUNTIME_V3_PRESENT_WGSL,
} from '../schema/AmbientRuntimeV3Contract.js';
import { createAmbientCollectionParticleLane } from './AmbientCollectionParticleLane.js';
import { createAmbientOceanMeshLane } from './AmbientOceanMeshLane.js';
import { buildAmbientOceanMeshSources } from './AmbientOceanMeshShaders.js';
import { OCEAN_SPECTRUM_TYPES_WGSL, OCEAN_SPECTRUM_WATER_FIELD_TYPES_WGSL } from '../../../engine/render/water/OceanSpectrum.js';
import { ambientRecipeWgslConstants } from '../schema/AmbientRecipeControls.js';
import { AMBIENT_ART_WGSL } from '../schema/AmbientArtWGSL.js';
import { NATIVE_CHROME_ART, NATIVE_RIPPLE_ART, NATIVE_QUANTUM_ART } from './AmbientNativeSurfaceShaders.js';
import { applyAmbientNativeAppearance, applyAmbientNativeInteraction, extractAmbientWgslFunctions, AMBIENT_NATIVE_INTERACTION_SIGNATURES } from '../schema/AmbientNativeAppearance.js';

const BUFFER_USAGE_COPY_DST = globalThis.GPUBufferUsage?.COPY_DST ?? 0x0008;
const BUFFER_USAGE_STORAGE = globalThis.GPUBufferUsage?.STORAGE ?? 0x0080;
const TEXTURE_USAGE_TEXTURE_BINDING = globalThis.GPUTextureUsage?.TEXTURE_BINDING ?? 0x04;
const TEXTURE_USAGE_STORAGE_BINDING = globalThis.GPUTextureUsage?.STORAGE_BINDING ?? 0x08;
const TEXTURE_USAGE_RENDER_ATTACHMENT = globalThis.GPUTextureUsage?.RENDER_ATTACHMENT ?? 0x10;

const FRAME_WGSL = `${AMBIENT_RUNTIME_V3_FRAME_WGSL}
@group(0) @binding(0) var<uniform> ambientV3Frame: AmbientV3Frame;
`;

const FULLSCREEN_VERTEX_WGSL = `
struct AmbientV3LaneVertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}
@vertex fn ambientV3LaneVertex(@builtin(vertex_index) vertexIndex: u32) -> AmbientV3LaneVertexOut {
  let position = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0))[vertexIndex];
  var output: AmbientV3LaneVertexOut;
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = position * 0.5 + vec2f(0.5);
  return output;
}
`;

const LANE_SPECS = Object.freeze({
    'fluid-ink': Object.freeze({
        recipeId: 'flowing-ink', stateId: 'ink-field', colorId: 'ink-color', kind: 'texture', maxDimension: 512,
    }),
    'metaball-chrome': Object.freeze({
        recipeId: 'liquid-chrome', stateId: 'chrome-state', colorId: 'chrome-color', kind: 'buffer', itemCount: 32,
    }),
    'impulse-horizon': Object.freeze({
        recipeId: 'ripple-horizon', stateId: 'ripple-state', colorId: 'ripple-color', kind: 'buffer', itemCount: 256,
    }),
    'temporal-field': Object.freeze({
        recipeId: 'quantum-probability-field', stateId: 'observation-field', colorId: 'quantum-color', kind: 'texture', maxDimension: 512,
    }),
});

export function ambientRuntimeV3DedicatedLaneSpec(executionClass) {
    return LANE_SPECS[String(executionClass ?? '')] ?? null;
}

export async function createAmbientRuntimeV3DedicatedLane(options = {}) {
    const { device, format, plan, uniformBuffer } = options;
    if (plan?.executionClass === 'particle-field') return createAmbientCollectionParticleLane(options);
    if (plan?.executionClass === 'mesh-ocean') return createAmbientOceanMeshLane(options);
    const spec = ambientRuntimeV3DedicatedLaneSpec(plan?.executionClass);
    if (!spec || plan?.recipeId !== spec.recipeId) {
        throw typedError('AMBIENT_RUNTIME_V3_LANE_UNSUPPORTED', `No dedicated lane exists for '${String(plan?.executionClass ?? '')}/${String(plan?.recipeId ?? '')}'.`);
    }
    if (!device?.createShaderModule || !device?.createBindGroup || !uniformBuffer) {
        throw typedError('AMBIENT_RUNTIME_V3_GPU_UNAVAILABLE', 'Dedicated Ambient V3 lanes require shader, bind-group, and uniform-buffer support.');
    }
    const stateDescriptor = plan.resources.find(resource => resource.id === spec.stateId);
    const colorDescriptor = plan.resources.find(resource => resource.id === spec.colorId);
    if (!stateDescriptor || !colorDescriptor) {
        throw typedError('AMBIENT_RUNTIME_V3_RESOURCE_LAYOUT', `The '${plan.recipeId}' lane is missing its canonical state or color resource.`);
    }

    const modules = [];
    const sources = buildAmbientRuntimeV3LaneSources(plan);
    const computeModule = moduleFor(device, `${plan.recipeId}-simulate`, sources.compute);
    modules.push(computeModule);
    const renderModule = moduleFor(device, `${plan.recipeId}-render`, sources.render);
    modules.push(renderModule);
    const presentModule = moduleFor(device, `${plan.recipeId}-present`, PRESENT_SHADER);
    modules.push(presentModule);
    await validateModules(modules);
    // A deleted component may stop reading state. Keep the retained resource ABI
    // explicit instead of letting auto-layout drop that now-unused binding.
    const renderLayout = plan.appearance ? device.createPipelineLayout({ bindGroupLayouts: [device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: 3, buffer: { type: 'uniform' } },
        spec.kind === 'texture' ? { binding: 1, visibility: 3, texture: { sampleType: 'unfilterable-float' } } : { binding: 1, visibility: 3, buffer: { type: 'read-only-storage' } },
    ] })] }) : 'auto';
    const [computePipeline, renderPipeline, presentPipeline] = await Promise.all([
        computePipelineFor(device, computeModule, `${plan.recipeId}-simulate-pipeline`),
        renderPipelineFor(device, renderModule, `${plan.recipeId}-render-pipeline`, 'rgba16float', renderLayout),
        renderPipelineFor(device, presentModule, `${plan.recipeId}-present-pipeline`, format),
    ]);

    let disposed = false;
    let width = 0;
    let height = 0;
    let stateWidth = 0;
    let stateHeight = 0;
    let stateBuffers = [];
    let stateTextures = [];
    let colorTexture = null;
    let computeBindGroups = [];
    let renderBindGroups = [];
    let presentBindGroup = null;
    let historyIndex = 0;

    const releaseSizedResources = () => {
        for (const texture of stateTextures) { try { texture.destroy?.(); } catch {} }
        try { colorTexture?.destroy?.(); } catch {}
        stateTextures = [];
        colorTexture = null;
        computeBindGroups = [];
        renderBindGroups = [];
        presentBindGroup = null;
        width = 0;
        height = 0;
        stateWidth = 0;
        stateHeight = 0;
        historyIndex = 0;
    };

    const ensureBufferState = () => {
        if (stateBuffers.length) return;
        const minimumBytes = plan.executionClass === 'metaball-chrome' ? spec.itemCount * 32 : spec.itemCount * 2 * 8;
        const byteLength = Math.max(minimumBytes, Math.floor(Number(stateDescriptor.size?.byteLength) || 0));
        const buffer = device.createBuffer({
            label: `ambient-v3-${plan.recipeId}-persistent-state`,
            size: align(byteLength, 16),
            usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
        });
        stateBuffers = [buffer];
    };

    const rebuildBindings = () => {
        if (spec.kind === 'texture') {
            computeBindGroups = stateTextures.map((source, index) => device.createBindGroup({
                label: `ambient-v3-${plan.recipeId}-simulate-bind-${index}`,
                layout: computePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: source.createView() },
                    { binding: 2, resource: stateTextures[1 - index].createView() },
                ],
            }));
            renderBindGroups = stateTextures.map((texture, index) => device.createBindGroup({
                label: `ambient-v3-${plan.recipeId}-render-bind-${index}`,
                layout: renderPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: texture.createView() },
                ],
            }));
        } else {
            ensureBufferState();
            computeBindGroups = [device.createBindGroup({
                label: `ambient-v3-${plan.recipeId}-simulate-bind`,
                layout: computePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: stateBuffers[0] } },
                ],
            })];
            renderBindGroups = [device.createBindGroup({
                label: `ambient-v3-${plan.recipeId}-render-bind`,
                layout: renderPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: stateBuffers[0] } },
                ],
            })];
        }
        presentBindGroup = device.createBindGroup({
            label: `ambient-v3-${plan.recipeId}-present-bind`,
            layout: presentPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: uniformBuffer } },
                { binding: 1, resource: colorTexture.createView() },
            ],
        });
    };

    const resize = (nextWidth, nextHeight) => {
        if (disposed) return false;
        const boundedWidth = Math.max(2, Math.floor(Number(nextWidth) || 0));
        const boundedHeight = Math.max(2, Math.floor(Number(nextHeight) || 0));
        if (boundedWidth === width && boundedHeight === height && colorTexture) return false;
        releaseSizedResources();
        width = boundedWidth;
        height = boundedHeight;
        colorTexture = device.createTexture({
            label: `ambient-v3-${plan.recipeId}-frame-color`,
            size: { width, height, depthOrArrayLayers: 1 },
            format: colorDescriptor.format ?? 'rgba16float',
            usage: TEXTURE_USAGE_RENDER_ATTACHMENT | TEXTURE_USAGE_TEXTURE_BINDING,
        });
        if (spec.kind === 'texture') {
            const scale = bounded(stateDescriptor.size?.scale, 0.5, 0.0625, 1);
            stateWidth = Math.max(8, Math.min(spec.maxDimension, Math.floor(width * scale)));
            stateHeight = Math.max(8, Math.min(spec.maxDimension, Math.floor(height * scale)));
            stateTextures = [0, 1].map(index => device.createTexture({
                label: `ambient-v3-${plan.recipeId}-persistent-${index}`,
                size: { width: stateWidth, height: stateHeight, depthOrArrayLayers: 1 },
                format: stateDescriptor.format ?? 'rgba16float',
                usage: TEXTURE_USAGE_TEXTURE_BINDING | TEXTURE_USAGE_STORAGE_BINDING,
            }));
        } else ensureBufferState();
        rebuildBindings();
        return true;
    };

    const encode = (encoder, targetView, clearValue) => {
        if (disposed || !colorTexture || !targetView) return null;
        const destinationIndex = spec.kind === 'texture' ? 1 - historyIndex : 0;
        const computePass = encoder.beginComputePass({ label: `ambient-v3-${plan.recipeId}-simulate` });
        computePass.setPipeline(computePipeline);
        computePass.setBindGroup(0, computeBindGroups[historyIndex] ?? computeBindGroups[0]);
        if (spec.kind === 'texture') {
            computePass.dispatchWorkgroups(Math.ceil(stateWidth / 8), Math.ceil(stateHeight / 8));
        } else if (plan.executionClass === 'metaball-chrome') {
            computePass.dispatchWorkgroups(Math.ceil(spec.itemCount / 32));
        } else computePass.dispatchWorkgroups(Math.ceil(spec.itemCount / 64));
        computePass.end();

        const colorPass = encoder.beginRenderPass({
            label: `ambient-v3-${plan.recipeId}-render`,
            colorAttachments: [{
                view: colorTexture.createView(),
                clearValue,
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });
        colorPass.setPipeline(renderPipeline);
        colorPass.setBindGroup(0, renderBindGroups[destinationIndex] ?? renderBindGroups[0]);
        colorPass.draw(3);
        colorPass.end();

        const presentPass = encoder.beginRenderPass({
            label: `ambient-v3-${plan.recipeId}-present`,
            colorAttachments: [{ view: targetView, clearValue, loadOp: 'clear', storeOp: 'store' }],
        });
        presentPass.setPipeline(presentPipeline);
        presentPass.setBindGroup(0, presentBindGroup);
        presentPass.draw(3);
        presentPass.end();
        return () => { if (spec.kind === 'texture') historyIndex = destinationIndex; };
    };

    return Object.freeze({
        executionClass: plan.executionClass,
        recipeId: plan.recipeId,
        resize,
        encode,
        resourceCounts() {
            return Object.freeze({
                buffers: stateBuffers.length,
                textures: stateTextures.length + (colorTexture ? 1 : 0),
                persistentBuffers: stateBuffers.length,
                persistentTextures: stateTextures.length,
            });
        },
        dispose() {
            if (disposed) return false;
            disposed = true;
            releaseSizedResources();
            for (const buffer of stateBuffers) { try { buffer.destroy?.(); } catch {} }
            stateBuffers = [];
            return true;
        },
    });
}

/** Pure executable source projection also used by control and timing tests. */
export function buildAmbientRuntimeV3LaneSources(plan) {
    if (plan?.executionClass === 'mesh-ocean') return buildAmbientOceanMeshSources(plan, OCEAN_SPECTRUM_TYPES_WGSL);
    const spec = ambientRuntimeV3DedicatedLaneSpec(plan.executionClass);
    if (!spec || spec.recipeId !== plan.recipeId) throw new TypeError('Unsupported native lane source');
    let compute = computeShader(spec), render = renderShader(spec);
    const change = (stage, before, after) => {
        const source = stage === 'compute' ? compute : render;
        if (!source.includes(before)) throw new Error(`Native '${plan.recipeId}' ${stage} source changed at '${before.slice(0, 44)}'`);
        if (stage === 'compute') compute = source.replaceAll(before, after); else render = source.replaceAll(before, after);
    };
    // One speed-scaled clock and integration interval for every motion term.
    // The host already zeros elapsed/delta and unbinds input in reduced motion.
    const clock = source => source.replaceAll('ambientV3Frame.resolutionTime.z * ambientV3Frame.tone.x', 'artTime()')
        .replaceAll('ambientV3Frame.resolutionTime.z', 'artTime()')
        .replaceAll('min(ambientV3Frame.resolutionTime.w, 0.033)', 'artDelta()');
    compute = clock(compute); render = clock(render);
    if (plan.recipeId === 'flowing-ink') {
        change('compute', 'dt * 3.4', 'dt * (0.8 + art_viscosity * 5.0)');
        change('compute', 'velocity += confinement * dt;', 'velocity += confinement * dt * art_vorticity;');
        change('compute', 'idleCurl * dt * (0.027 + ambientV3Frame.clickActivity.w * 0.038)', 'idleCurl * dt * art_vorticity * (0.027 + ambientV3Frame.clickActivity.w * 0.038)');
        change('compute', 'let idleInk = sourceEnergyA + sourceEnergyB + sourceEnergyC;', 'let idleInk = (sourceEnergyA + sourceEnergyB + sourceEnergyC) * art_pigmentLoad;');
        change('compute', 'select(0.0, 0.48, ambientV3Frame.effects.z < 0.5)', 'select(0.0, 0.95, ambientV3Frame.effects.z < 0.5)');
        // Empty substrate has no hue. Mixing from its arbitrary zero chooses
        // opposite arcs at hue .5 and creates a visible seam between seeds.
        change('compute', 'hue = inkHueMix(hue, sourcePigmentTarget, sourcePigmentMix);', 'hue = select(inkHueMix(hue, sourcePigmentTarget, sourcePigmentMix), sourcePigmentTarget, startupSeed > 0.0);');
        change('compute', 'density += pigmentDeposit *', 'density += pigmentDeposit * art_pigmentLoad *');
        change('compute', 'let sourceEnergyA = exp(-dot(uv - sourceA, uv - sourceA) * 48.0);', 'let sourceDeltaA = uv - (vec2f(0.5) + (sourceA - vec2f(0.5)) * art_sourceSpread);\n  let sourceEnergyA = exp(-dot(sourceDeltaA, sourceDeltaA) * 48.0);');
        change('compute', 'let sourceEnergyB = exp(-dot(uv - sourceB, uv - sourceB) * 58.0);', 'let sourceDeltaB = uv - (vec2f(0.5) + (sourceB - vec2f(0.5)) * art_sourceSpread);\n  let sourceEnergyB = exp(-dot(sourceDeltaB, sourceDeltaB) * 58.0);');
        change('render', 'sigil * 0.22', 'sigil * 0.045');
        change('render', 'let density = smoothstep(0.008, 0.78, state.z);', 'let density = 1.0 - exp(-max(state.z - 0.004, 0.0) * 4.2);');
        change('render', '(0.27 + density * 0.62)', '(0.40 + density * 0.72)');
        change('render', 'let paperFiber = 0.5 + 0.5 * sin(input.uv.x * 1280.0 + sin(input.uv.y * 73.0) * 3.0);', 'let paperPhase = input.uv.x * 1280.0 + sin(input.uv.y * 73.0) * 3.0;\n  let paperFiber = 0.5 + 0.5 * sin(paperPhase) * (1.0 - smoothstep(0.8, 2.2, fwidth(paperPhase)));');
        render = INK_MARBLED_RENDER_SHADER;
    } else if (plan.recipeId === 'liquid-chrome') {
        change('compute', 'index < 10u', 'index < u32(art_bodies)');
        change('compute', 'index < 8u', 'index < u32(art_bodies)');
        change('compute', 'fract(fi * 0.6180339 + 0.13)', 'fract(fi / art_bodies + 0.13)');
        change('compute', '0.50 + sin(streamAngle) * 0.245', '0.50 + sin(streamAngle) * 0.245 / sqrt(art_cohesion)');
        change('compute', '0.51 + sin(streamAngle * 2.0) * 0.135', '0.51 + sin(streamAngle * 2.0) * 0.135 / sqrt(art_cohesion)');
        change('compute', '0.105 + chromeHash(fi + 17.0) * 0.028', '(0.112 + chromeHash(fi + 17.0) * 0.024) * sqrt(art_cohesion)');
        change('compute', 'position += velocity * dt * ambientV3Frame.tone.x;', 'position += velocity * dt;');
        change('compute', 'velocity * 0.994', 'velocity * exp(-dt * 0.36)');
    } else if (plan.recipeId === 'ripple-horizon') {
        change('compute', 'var velocity = (center.y + laplacian * dt * 72.0) * exp(-dt * 1.7);', 'var velocity = (center.y + laplacian * dt * 72.0) / (1.0 + dt * art_waveDamping * 1.7 + 144.0 * dt * dt);');
        change('compute', 'velocity += impulse * (0.8 + ambientV3Frame.clickActivity.w * ambientV3Frame.effects.y);', 'velocity += impulse * dt * art_rippleStrength * (3.0 + ambientV3Frame.clickActivity.w * ambientV3Frame.effects.y);');
        change('compute', 'ambientV3Frame.effects.x * 0.08;', 'ambientV3Frame.effects.x * dt * art_rippleStrength * 4.8;');
        change('render', '(wave * 0.055 + oceanWave * 0.038)', '(wave * 0.055 + oceanWave * 0.038) * art_waveHeight');
        change('render', 'let radialRing = exp(-abs(length(clickDelta) - ringRadius) * 110.0) * ringAlive;', 'let radialRing = exp(-abs(length(clickDelta) - ringRadius) * 110.0) * ringAlive * art_rippleStrength;');
    } else if (plan.recipeId === 'quantum-probability-field') {
        change('compute', '* dt * ambientV3Frame.tone.x;', '* dt;');
        change('compute', 'exp(-dt * (0.018 + (1.0 - dwell) * 0.046))', 'exp(-dt * art_decoherence * (0.018 + (1.0 - dwell) * 0.046))');
        change('compute', 'coherentEnvelope * dt * 0.12', 'coherentEnvelope * dt * 0.12 * art_coherence');
        change('compute', 'vortexEnvelope * dt * 0.032', 'vortexEnvelope * dt * 0.032 * art_coherence');
        change('render', 'max(state.z, 0.0) * 7.5', 'max(state.z, 0.0) * 2.2');
        change('render', '(pathA - pathB) * 124.0', '(pathA - pathB) * 124.0 * art_fringeScale');
        change('render', '(pathA - pathB) * 92.0', '(pathA - pathB) * 92.0 * art_fringeScale');
        change('render', '(0.42 + probability * 1.12)', '(0.16 + probability * 0.28)');
        change('render', '* probabilityEdge * 0.42;', '* probabilityEdge * 0.15;');
        change('render', 'roseWindow * probability * 0.08', 'roseWindow * probability * 0.018');
    }
    const artRender = { 'liquid-chrome': NATIVE_CHROME_ART, 'ripple-horizon': NATIVE_RIPPLE_ART, 'quantum-probability-field': NATIVE_QUANTUM_ART }[plan.recipeId];
    if (artRender) render = `${FRAME_WGSL}${FULLSCREEN_VERTEX_WGSL}${AMBIENT_ART_WGSL}${artRender}`;
    if (plan.recipeId === 'ripple-horizon') render = render.replace('let envelope=exp(-pow((radius-age*.075)*36.,2.))', 'let ringDistance=(radius-age*.075)*36.;\n   let envelope=exp(-ringDistance*ringDistance)');
    const header = `${ambientRecipeWgslConstants(plan.recipeId, plan.settings?.recipeControls)}\nfn artTime() -> f32 { return ambientV3Frame.resolutionTime.z * ambientV3Frame.tone.x; }\nfn artDelta() -> f32 { return min(ambientV3Frame.resolutionTime.w, 0.05) * ambientV3Frame.tone.x; }\n`;
    const interaction = factorNativeInteraction(plan.recipeId, compute);
    const interactionFunctions = applyAmbientNativeInteraction(interaction.functions, plan.interaction?.functionsWGSL, plan.recipeId);
    if (plan.recipeId === 'liquid-chrome' && extractAmbientWgslFunctions(interactionFunctions).some(fn => fn.name === 'ambientInteractionChromeResponse')) {
        interaction.compute = interaction.compute.replace('ambientChromeInteraction(position,velocity,dt,ambientV3Frame.pointer,ambientV3Frame.pointerState,ambientV3Frame.effects)', 'ambientInteractionChromeResponse(position,velocity,phase,index,dt,ambientV3Frame.resolutionTime.xy,ambientV3Frame.pointer,ambientV3Frame.pointerState,ambientV3Frame.clickActivity,ambientV3Frame.effects)');
    }
    const authoredRender = applyAmbientNativeAppearance(header + render, plan.appearance?.renderFunctions);
    // Function-only saved appearance has no authority over resource/type
    // declarations. Admit the engine's value struct only for its V2 evaluator;
    // historical/custom retained shaders keep their original compiled source.
    const finiteWaterTypes = /\bfn\s+ambientWaterSurfaceVersion\s*\(/.test(plan.appearance?.renderFunctions ?? '')
        ? OCEAN_SPECTRUM_WATER_FIELD_TYPES_WGSL : '';
    return Object.freeze({
        compute: header + interactionFunctions + '\n' + interaction.compute,
        render: finiteWaterTypes + authoredRender,
        interactionFunctions: interaction.functions,
        interactionFallback: interaction.fallback,
    });
}

/** Cut the existing interaction statements into value-only functions. Keeping
 * the original math in one place makes the legacy lane and new graph seed use
 * exactly the same default behavior. GPU writes and integration remain here. */
function factorNativeInteraction(recipeId, original) {
    let compute = original;
    const signatures = AMBIENT_NATIVE_INTERACTION_SIGNATURES[recipeId];
    const values = source => source.replaceAll('ambientV3Frame.', '').replaceAll('art_pigmentLoad', 'pigmentLoad').replaceAll('art_rippleStrength', 'rippleStrength');
    const cut = (begin, end, replacement) => {
        const start = compute.indexOf(begin), finish = compute.indexOf(end, start + begin.length);
        if (start < 0 || finish < 0 || compute.indexOf(begin, start + begin.length) >= 0) throw new Error(`Native interaction boundary changed for '${recipeId}'.`);
        const block = compute.slice(start, finish);
        compute = compute.slice(0, start) + replacement + '\n' + compute.slice(finish);
        return values(block);
    };
    const frameArgs = 'ambientV3Frame.pointer,ambientV3Frame.pointerState,ambientV3Frame.clickActivity,ambientV3Frame.effects';
    let functions, fallback;
    if (recipeId === 'flowing-ink') {
        const block = cut('  if (ambientV3Frame.pointerState.x > 0.5) {', '  let sourceA =', `  let interactionBefore=vec4f(velocity,density,hue);
  let interactionNext=ambientInkInteraction(uv,interactionBefore,dt,${frameArgs},art_pigmentLoad);
  let interactionState=select(interactionBefore,interactionNext,all(abs(interactionNext)<vec4f(1000000.0)));
  velocity=interactionState.xy; density=interactionState.z; hue=interactionState.w;`).replaceAll('inkHueMix', 'ambientInteractionHueMix');
        functions = `fn ambientInteractionHueMix(current:f32,targetHue:f32,amount:f32)->f32 {
  let shortestArc=fract(targetHue-current+0.5)-0.5; return fract(current+shortestArc*clamp(amount,0.0,1.0));
}
${signatures[0]} {var velocity=state.xy;var density=state.z;var hue=state.w;\n${block}\nreturn vec4f(velocity,density,hue);}`;
        fallback = `${signatures[0]} {return state;}`;
    } else if (recipeId === 'liquid-chrome') {
        const block = cut('  var pointerStretch = 0.0;', '  position += velocity * dt;', `  let interactionNext=ambientChromeInteraction(position,velocity,dt,ambientV3Frame.pointer,ambientV3Frame.pointerState,ambientV3Frame.effects);
  let interactionState=select(vec3f(velocity,0.0),interactionNext,all(abs(interactionNext)<vec3f(1000000.0)));
  velocity=clamp(interactionState.xy,vec2f(-4.0),vec2f(4.0));
  let pointerStretch=clamp(interactionState.z,0.0,8.0);`);
        functions = `${signatures[0]} {var velocity=initialVelocity;\n${block}\nreturn vec3f(velocity,pointerStretch);}`;
        fallback = `${signatures[0]} {return vec3f(initialVelocity,0.0);}`;
    } else if (recipeId === 'ripple-horizon') {
        const block = cut('  if (ambientV3Frame.clickActivity.z < 0.8) {', '  velocity += sin(x', `  let interactionNext=ambientRippleInteraction(x,velocity,dt,${frameArgs},art_rippleStrength);
  velocity=select(velocity,interactionNext,abs(interactionNext)<1000000.0);`);
        functions = `${signatures[0]} {var velocity=initialVelocity;\n${block}\nreturn velocity;}`;
        fallback = `${signatures[0]} {return initialVelocity;}`;
    } else {
        const dwell = cut('    let pointerSpeed = length(ambientV3Frame.pointer.zw);', '    amplitude *= exp', '    let interactionDwell=ambientQuantumDwell(ambientV3Frame.pointer,ambientV3Frame.pointerState);\n    let dwell=select(0.0,clamp(interactionDwell,0.0,1.0),abs(interactionDwell)<1000000.0);');
        const block = cut('  if (ambientV3Frame.pointerState.x > 0.5) {', '  let probability =', `  let interactionNext=ambientQuantumInteraction(uv,amplitude,dt,${frameArgs});
  amplitude=select(amplitude,interactionNext,all(abs(interactionNext)<vec2f(1000000.0)));`);
        functions = `${signatures[0]} {${dwell}\nreturn dwell;}\n${signatures[1]} {var amplitude=initialAmplitude;\n${block}\nreturn amplitude;}`;
        fallback = `${signatures[0]} {return 0.0;}\n${signatures[1]} {return initialAmplitude;}`;
    }
    return { compute, functions, fallback };
}

function computeShader(spec) {
    if (spec.recipeId === 'flowing-ink') return INK_COMPUTE_SHADER;
    if (spec.recipeId === 'liquid-chrome') return CHROME_COMPUTE_SHADER;
    if (spec.recipeId === 'ripple-horizon') return RIPPLE_COMPUTE_SHADER;
    return QUANTUM_COMPUTE_SHADER;
}

function renderShader(spec) {
    if (spec.recipeId === 'flowing-ink') return INK_RENDER_SHADER;
    if (spec.recipeId === 'liquid-chrome') return CHROME_SOLID_RENDER_SHADER;
    if (spec.recipeId === 'ripple-horizon') return RIPPLE_RENDER_SHADER;
    return QUANTUM_RENDER_SHADER;
}

const INK_COMPUTE_SHADER = `${FRAME_WGSL}
@group(0) @binding(1) var previousInk: texture_2d<f32>;
@group(0) @binding(2) var nextInk: texture_storage_2d<rgba16float, write>;
fn inkHueVector(hue: f32) -> vec2f {
  let angle = fract(hue) * 6.28318530718;
  return vec2f(cos(angle), sin(angle));
}
fn inkHueFromVector(value: vec2f) -> f32 {
  if (dot(value, value) < 0.000001) { return 0.0; }
  return fract(atan2(value.y, value.x) / 6.28318530718 + 1.0);
}
fn inkHueMix(current: f32, targetHue: f32, amount: f32) -> f32 {
  let shortestArc = fract(targetHue - current + 0.5) - 0.5;
  return fract(current + shortestArc * clamp(amount, 0.0, 1.0));
}
@compute @workgroup_size(8, 8)
fn simulateInk(@builtin(global_invocation_id) gid: vec3u) {
  let dimensions = textureDimensions(nextInk);
  if (gid.x >= dimensions.x || gid.y >= dimensions.y) { return; }
  let coordinate = vec2i(gid.xy);
  let uv = (vec2f(gid.xy) + vec2f(0.5)) / vec2f(dimensions);
  let prior = textureLoad(previousInk, coordinate, 0);
  let dt = min(ambientV3Frame.resolutionTime.w, 0.033);
  let limit = vec2i(dimensions) - vec2i(1);
  let backPosition = clamp(
    vec2f(gid.xy) - prior.xy * dt * vec2f(dimensions) * 0.72,
    vec2f(0.0),
    vec2f(limit)
  );
  let backBase = clamp(vec2i(floor(backPosition)), vec2i(0), limit);
  let backPart = fract(backPosition);
  let backX = min(backBase + vec2i(1, 0), limit);
  let backY = min(backBase + vec2i(0, 1), limit);
  let backXY = min(backBase + vec2i(1, 1), limit);
  let back00 = textureLoad(previousInk, backBase, 0);
  let back10 = textureLoad(previousInk, backX, 0);
  let back01 = textureLoad(previousInk, backY, 0);
  let back11 = textureLoad(previousInk, backXY, 0);
  let backLower = mix(back00, back10, backPart.x);
  let backUpper = mix(back01, back11, backPart.x);
  let advected = mix(backLower, backUpper, backPart.y);
  let advectedHueVector = mix(
    mix(inkHueVector(back00.w), inkHueVector(back10.w), backPart.x),
    mix(inkHueVector(back01.w), inkHueVector(back11.w), backPart.x),
    backPart.y
  );
  let advectedHue = inkHueFromVector(advectedHueVector);
  let left = textureLoad(previousInk, clamp(coordinate + vec2i(-1, 0), vec2i(0), limit), 0);
  let right = textureLoad(previousInk, clamp(coordinate + vec2i(1, 0), vec2i(0), limit), 0);
  let down = textureLoad(previousInk, clamp(coordinate + vec2i(0, -1), vec2i(0), limit), 0);
  let up = textureLoad(previousInk, clamp(coordinate + vec2i(0, 1), vec2i(0), limit), 0);
  let neighborhood = (left + right + down + up) * 0.25;
  let neighborhoodHue = inkHueFromVector(
    inkHueVector(left.w) + inkHueVector(right.w) + inkHueVector(down.w) + inkHueVector(up.w)
  );
  let diffusion = min(0.18, dt * 3.4);
  var velocity = mix(advected.xy, neighborhood.xy, diffusion) * exp(-dt * 0.52);
  var density = mix(advected.z, neighborhood.z, min(0.10, dt * 1.45)) * exp(-dt * 0.065);
  var hue = inkHueMix(advectedHue, neighborhoodHue, min(0.08, dt * 1.2));
  let densityGradient = vec2f(right.z - left.z, up.z - down.z);
  let velocityCurl = (right.y - left.y) - (up.x - down.x);
  let confinement = vec2f(-densityGradient.y, densityGradient.x)
    * (0.48 + min(abs(velocityCurl), 1.0) * 0.72);
  velocity += confinement * dt;
  density += abs(neighborhood.z - advected.z) * dt * 0.11;
  if (ambientV3Frame.pointerState.x > 0.5) {
    let delta = uv - ambientV3Frame.pointer.xy;
    let proximity = exp(-dot(delta, delta) * 120.0);
    let impulse = proximity * ambientV3Frame.effects.x;
    let pointerSpeed = clamp(length(ambientV3Frame.pointer.zw) * 0.32, 0.0, 1.0);
    let pointerDwell = smoothstep(0.12, 2.6, ambientV3Frame.pointerState.z);
    let pointerPressure = max(
      ambientV3Frame.pointerState.y,
      ambientV3Frame.clickActivity.w * ambientV3Frame.effects.y
    );
    let existingPigment = smoothstep(0.10, 1.10, density);
    let pointerPigmentTarget = fract(
      0.56
      + ambientV3Frame.pointer.x * 0.24
      + ambientV3Frame.pointer.y * 0.17
      + pointerSpeed * 0.32
      + pointerDwell * 0.11
      + pointerPressure * 0.19
      + existingPigment * 0.07
    );
    let depositionRate = 0.42 + pointerSpeed * 0.82 + pointerDwell * 0.24 + pointerPressure * 0.58;
    let pigmentDeposit = impulse * (1.0 - exp(-dt * depositionRate));
    velocity += (vec2f(-delta.y, delta.x) * 2.4 + ambientV3Frame.pointer.zw * 0.12) * impulse * dt;
    density += pigmentDeposit * (0.88 + pointerSpeed * 0.42 + pointerPressure * 0.54);
    hue = inkHueMix(
      hue,
      pointerPigmentTarget,
      clamp(pigmentDeposit * (1.35 + pointerSpeed * 0.55 + pointerDwell * 0.20), 0.0, 0.055)
    );
  }
  if (ambientV3Frame.clickActivity.z < 0.7) {
    let clickDelta = uv - ambientV3Frame.clickActivity.xy;
    let clickImpulse = exp(-dot(clickDelta, clickDelta) * 260.0)
      * (1.0 - ambientV3Frame.clickActivity.z / 0.7);
    let clickPigmentTarget = fract(
      0.08
      + ambientV3Frame.clickActivity.x * 0.31
      + ambientV3Frame.clickActivity.y * 0.23
      + ambientV3Frame.pointerState.w * 0.173
    );
    density += clickImpulse * dt * 1.35;
    hue = inkHueMix(hue, clickPigmentTarget, clamp(clickImpulse * dt * 0.72, 0.0, 0.032));
  }
  let sourceA = vec2f(0.32 + sin(ambientV3Frame.resolutionTime.z * 0.071) * 0.08, 0.54 + cos(ambientV3Frame.resolutionTime.z * 0.053) * 0.12);
  let sourceB = vec2f(0.68 + cos(ambientV3Frame.resolutionTime.z * 0.063) * 0.09, 0.43 + sin(ambientV3Frame.resolutionTime.z * 0.047) * 0.10);
  let sourceC = vec2f(0.50 + sin(ambientV3Frame.resolutionTime.z * 0.041) * 0.16, 0.70 + cos(ambientV3Frame.resolutionTime.z * 0.057) * 0.07);
  let sourceEnergyA = exp(-dot(uv - sourceA, uv - sourceA) * 48.0);
  let sourceEnergyB = exp(-dot(uv - sourceB, uv - sourceB) * 58.0);
  let sourceEnergyC = exp(-dot(uv - sourceC, uv - sourceC) * 72.0) * 0.62;
  let idleInk = sourceEnergyA + sourceEnergyB + sourceEnergyC;
  let startupSeed = select(0.0, 0.48, ambientV3Frame.effects.z < 0.5);
  density += idleInk * (startupSeed + dt * (0.115 + ambientV3Frame.clickActivity.w * ambientV3Frame.effects.y * 0.075));
  let sourcePigmentVector = inkHueVector(0.58) * sourceEnergyA
    + inkHueVector(0.82) * sourceEnergyB
    + inkHueVector(0.12) * sourceEnergyC;
  let sourcePigmentTarget = inkHueFromVector(sourcePigmentVector);
  let sourcePigmentMix = clamp(idleInk * (startupSeed * 0.72 + dt * 0.15), 0.0, 0.58);
  hue = inkHueMix(hue, sourcePigmentTarget, sourcePigmentMix);
  let idleCurl = vec2f(
    sin(uv.y * 11.0 + ambientV3Frame.resolutionTime.z * 0.21) + sin((uv.x + uv.y) * 17.0 - ambientV3Frame.resolutionTime.z * 0.13) * 0.42,
    cos(uv.x * 9.0 - ambientV3Frame.resolutionTime.z * 0.17) - cos((uv.x - uv.y) * 15.0 + ambientV3Frame.resolutionTime.z * 0.11) * 0.42
  );
  velocity += idleCurl * dt * (0.027 + ambientV3Frame.clickActivity.w * 0.038);
  textureStore(nextInk, coordinate, vec4f(clamp(velocity, vec2f(-1.0), vec2f(1.0)), clamp(density, 0.0, 1.5), hue));
}`;

const INK_MARBLED_RENDER_SHADER = `${FRAME_WGSL}${FULLSCREEN_VERTEX_WGSL}${AMBIENT_ART_WGSL}
@group(0) @binding(1) var inkField:texture_2d<f32>;
@fragment fn ambientV3LaneFragment(input:AmbientV3LaneVertexOut)->@location(0) vec4f {
 let dimensions=textureDimensions(inkField);
 let coordinate=clamp(vec2i(input.uv*vec2f(dimensions)),vec2i(0),vec2i(dimensions)-vec2i(1));
 let state=textureLoad(inkField,coordinate,0);
 let aspect=ambientV3Frame.resolutionTime.x/max(ambientV3Frame.resolutionTime.y,1.);
 let time=artTime();
 var p=(input.uv-vec2f(.5))*vec2f(aspect,1.)*3.4;
 p+=state.xy*.42;
 let curlA=p-vec2f(-.52,.36); let curlB=p-vec2f(.67,-.46);
 p+=artRotate(curlA,exp(-dot(curlA,curlA)*.9)*1.0)-curlA;
 p+=artRotate(curlB,-exp(-dot(curlB,curlB)*1.4)*.72)-curlB;
 let q=artWarp(p+vec2f(time*.009,-time*.006),time);
 let flow=artFbm2(q*1.6+vec2f(2.2,5.6));
 let veins=artFbm2(q*3.4+flow*vec2f(3.1,-2.7));
 let phase=q.y*.83+q.x*.24+flow*2.6+state.z*.18;
 let broad=.5+.5*sin(phase*3.4);
 var pigment=mix(vec3f(.006,.028,.047),vec3f(.015,.19,.20),smoothstep(.13,.62,broad));
 pigment=mix(pigment,ambientV3Frame.accentPrimary.rgb*.18,clamp(state.z*.065,0.,.075)*ambientV3Frame.accentPrimary.a);
 pigment=mix(pigment,vec3f(.022,.071,.12),smoothstep(.48,.70,veins));
 let chalk=smoothstep(.73,.91,broad)*smoothstep(.36,.65,flow);
 pigment=mix(pigment,vec3f(.68,.67,.54),chalk*.86);
 let mineral=smoothstep(.62,.78,veins)*(1.-smoothstep(.72,.95,broad));
 pigment=mix(pigment,vec3f(.42,.17,.044),mineral*.48);
 let linePhase=phase*28.+artNoise2(q*18.)*.75;
 let lineWidth=max(fwidth(linePhase)*.7,.02);
 let line=1.-smoothstep(.035,.035+lineWidth,abs(sin(linePhase)));
 let finePhase=phase*73.+veins*3.;
 let fine=(1.-smoothstep(.03,.03+max(fwidth(finePhase),.02),abs(sin(finePhase))))*.32;
 let shoreline=1.-smoothstep(.008,.055,abs(broad-.64));
 let seam=shoreline*(.42+.58*artNoise2(q*22.))+fine*chalk*.055;
 let grain=artHash21(floor(p*vec2f(420.,420.)));
 let gold=vec3f(.85,.52,.17)*(seam*(.35+.65*grain));
 let pearlescence=pow(clamp(1.-abs(dpdx(phase)*180.+dpdy(phase)*90.),0.,1.),3.)*.07;
 let structure=.68+.32*artNoise2(q*31.);
 let load=.62+.38*clamp(art_pigmentLoad,0.,1.4);
 let color=pigment*structure*load*(1.-line*.045)+gold+vec3f(.36,.54,.51)*pearlescence*chalk;
 let vignette=1.-smoothstep(.45,1.25,length((input.uv-.5)*vec2f(1.,.8)))*.22;
 return vec4f(color*vignette,1.);
}`;

const INK_RENDER_SHADER = `${FRAME_WGSL}${FULLSCREEN_VERTEX_WGSL}
@group(0) @binding(1) var inkField: texture_2d<f32>;
fn inkPigmentPalette(hue: f32, primary: vec3f, secondary: vec3f) -> vec3f {
  let angle = fract(hue) * 6.28318530718;
  let weightPrimary = pow(0.5 + 0.5 * cos(angle), 6.0);
  let weightTeal = pow(0.5 + 0.5 * cos(angle - 1.25663706144), 6.0);
  let weightSecondary = pow(0.5 + 0.5 * cos(angle - 2.51327412287), 6.0);
  let weightRose = pow(0.5 + 0.5 * cos(angle - 3.76991118431), 6.0);
  let weightAmber = pow(0.5 + 0.5 * cos(angle - 5.02654824574), 6.0);
  let weightSum = max(weightPrimary + weightTeal + weightSecondary + weightRose + weightAmber, 0.0001);
  return (
    primary * weightPrimary
    + vec3f(0.055, 0.86, 0.76) * weightTeal
    + secondary * weightSecondary
    + vec3f(1.0, 0.14, 0.46) * weightRose
    + vec3f(1.0, 0.54, 0.095) * weightAmber
  ) / weightSum;
}
fn inkSegmentDistance(point: vec2f, start: vec2f, finish: vec2f) -> f32 {
  let axis = finish - start;
  let projection = clamp(dot(point - start, axis) / max(dot(axis, axis), 0.0001), 0.0, 1.0);
  return length(point - (start + axis * projection));
}
fn inkAlchemySigil(point: vec2f, time: f32) -> f32 {
  let angle = time * 0.035;
  let rotated = vec2f(point.x * cos(angle) - point.y * sin(angle), point.x * sin(angle) + point.y * cos(angle));
  let radius = length(rotated);
  let outerRing = exp(-abs(radius - 0.275) * 115.0);
  let innerRing = exp(-abs(radius - 0.145) * 135.0);
  let triangleA = vec2f(0.0, -0.215);
  let triangleB = vec2f(-0.19, 0.13);
  let triangleC = vec2f(0.19, 0.13);
  let triangle = exp(-min(
    inkSegmentDistance(rotated, triangleA, triangleB),
    min(inkSegmentDistance(rotated, triangleB, triangleC), inkSegmentDistance(rotated, triangleC, triangleA))
  ) * 105.0);
  let spokes = pow(abs(cos(atan2(rotated.y, rotated.x) * 6.0)), 38.0)
    * smoothstep(0.15, 0.19, radius) * (1.0 - smoothstep(0.25, 0.29, radius));
  return outerRing * 0.55 + innerRing * 0.34 + triangle * 0.62 + spokes * 0.38;
}
@fragment fn ambientV3LaneFragment(input: AmbientV3LaneVertexOut) -> @location(0) vec4f {
  let dimensions = textureDimensions(inkField);
  let coordinate = clamp(vec2i(input.uv * vec2f(dimensions)), vec2i(0), vec2i(dimensions) - vec2i(1));
  let limit = vec2i(dimensions) - vec2i(1);
  let state = textureLoad(inkField, coordinate, 0);
  let leftDensity = textureLoad(inkField, clamp(coordinate + vec2i(-1, 0), vec2i(0), limit), 0).z;
  let rightDensity = textureLoad(inkField, clamp(coordinate + vec2i(1, 0), vec2i(0), limit), 0).z;
  let downDensity = textureLoad(inkField, clamp(coordinate + vec2i(0, -1), vec2i(0), limit), 0).z;
  let upDensity = textureLoad(inkField, clamp(coordinate + vec2i(0, 1), vec2i(0), limit), 0).z;
  let primary = ambientV3Frame.accentPrimary.rgb;
  let secondary = ambientV3Frame.accentSecondary.rgb;
  let huePhase = fract(state.w);
  let chroma = inkPigmentPalette(huePhase, primary, secondary);
  let density = smoothstep(0.008, 0.78, state.z);
  let densityGradient = vec2f(rightDensity - leftDensity, upDensity - downDensity);
  let edgeStrength = clamp(length(densityGradient) * 8.5, 0.0, 1.0);
  let densityLaplacian = leftDensity + rightDensity + downDensity + upDensity - 4.0 * state.z;
  let centered = input.uv - vec2f(0.5);
  let spiralRadius = max(length(centered), 0.001);
  let spiralAngle = atan2(centered.y, centered.x);
  let ambientThread = pow(0.5 + 0.5 * sin(spiralAngle * 3.0 - spiralRadius * 25.0 + ambientV3Frame.resolutionTime.z * 0.11), 10.0)
    * exp(-spiralRadius * 2.7);
  let folds = 0.72 + 0.28 * sin(input.uv.x * 17.0 + input.uv.y * 11.0 + state.x * 8.0 - state.y * 6.0);
  let paper = mix(vec3f(0.005, 0.009, 0.019), vec3f(0.024, 0.031, 0.054), input.uv.y);
  let paperFiber = 0.5 + 0.5 * sin(input.uv.x * 1280.0 + sin(input.uv.y * 73.0) * 3.0);
  let paperGrain = pow(paperFiber, 18.0) * (0.45 + 0.55 * sin(input.uv.y * 487.0));
  let cellularRidge = pow(0.5 + 0.5 * cos(state.z * 18.0 - state.w * 6.28318 + densityLaplacian * 42.0), 9.0);
  let backrun = exp(-abs(state.z - 0.24) * 24.0) * smoothstep(0.06, 0.42, abs(densityLaplacian) * 4.0);
  let suminagashi = pow(0.5 + 0.5 * sin(spiralRadius * 92.0 - spiralAngle * 5.0 + state.w * 9.0), 14.0)
    * density * smoothstep(0.08, 0.76, spiralRadius);
  let sigil = inkAlchemySigil(centered * vec2f(ambientV3Frame.resolutionTime.x / max(ambientV3Frame.resolutionTime.y, 1.0), 1.0), ambientV3Frame.resolutionTime.z)
    * smoothstep(0.055, 0.48, density);
  let flowSheen = 1.0 + min(length(state.xy) * 0.07, 0.08);
  let pigment = chroma * density * (0.27 + density * 0.62) * folds * flowSheen;
  let wetEdge = mix(chroma, vec3f(0.82, 0.95, 1.0), 0.42) * edgeStrength * (0.10 + density * 0.34);
  let reactionFilament = inkPigmentPalette(fract(huePhase + 0.31), primary, secondary)
    * cellularRidge * density * (0.035 + edgeStrength * 0.12);
  let idleCurrent = mix(primary, secondary, smoothstep(-0.5, 0.5, centered.x)) * ambientThread * 0.09;
  let mineralGold = vec3f(1.0, 0.53, 0.13) * (backrun * 0.17 + suminagashi * 0.11 + sigil * 0.22);
  let substrate = paper + vec3f(0.028, 0.042, 0.061) * paperGrain * (1.0 - density) * 0.12;
  let rawInk = substrate + idleCurrent + pigment + wetEdge + reactionFilament + mineralGold;
  let peak = max(rawInk.r, max(rawInk.g, rawInk.b));
  let highlightCompression = 1.0 / (1.0 + max(peak - 0.95, 0.0) * 0.72);
  return vec4f(rawInk * highlightCompression, 1.0);
}`;

const CHROME_COMPUTE_SHADER = `${FRAME_WGSL}
struct MetaballState { positionRadius: vec4f, velocityPhase: vec4f }
@group(0) @binding(1) var<storage, read_write> metaballs: array<MetaballState>;
fn chromeHash(value: f32) -> f32 { return fract(sin(value * 91.731) * 43758.5453); }
@compute @workgroup_size(32)
fn simulateChrome(@builtin(global_invocation_id) gid: vec3u) {
  let index = gid.x;
  if (index >= 32u) { return; }
  let fi = f32(index);
  let enabled = index < 10u;
  let bodyDroplet = index < 8u;
  let baseRadius = select(
    0.0,
    select(0.036 + chromeHash(fi + 17.0) * 0.022, 0.105 + chromeHash(fi + 17.0) * 0.028, bodyDroplet),
    enabled
  );
  let streamPosition = fract(fi * 0.6180339 + 0.13);
  let streamAngle = streamPosition * 6.2831853;
  let streamCenter = vec2f(
    0.50 + sin(streamAngle) * 0.245,
    0.51 + sin(streamAngle * 2.0) * 0.135
  );
  let dropletCenter = vec2f(0.5) + (vec2f(chromeHash(fi + 101.0), chromeHash(fi + 113.0)) - vec2f(0.5)) * 0.55;
  let orbitCenter = select(dropletCenter, streamCenter, bodyDroplet);
  let orbitRadius = select(0.075 + chromeHash(fi + 3.0) * 0.095, 0.018 + chromeHash(fi + 3.0) * 0.034, bodyDroplet);
  let orbitAspect = select(0.58 + chromeHash(fi + 127.0) * 0.28, 0.34 + chromeHash(fi + 127.0) * 0.30, bodyDroplet);
  if (ambientV3Frame.effects.z < 0.5) {
    let angle = fi * 2.399963;
    let orbit = vec2f(cos(angle) * orbitRadius, sin(angle) * orbitRadius * orbitAspect);
    metaballs[index].positionRadius = vec4f(orbitCenter + orbit, baseRadius, 0.0);
    metaballs[index].velocityPhase = vec4f(vec2f(-sin(angle), cos(angle)) * (0.015 + chromeHash(fi + 31.0) * 0.035), angle, chromeHash(fi + 47.0));
    return;
  }
  let dt = min(ambientV3Frame.resolutionTime.w, 0.033);
  var position = metaballs[index].positionRadius.xy;
  var velocity = metaballs[index].velocityPhase.xy;
  let phase = metaballs[index].velocityPhase.z;
  let orbitTarget = orbitCenter + vec2f(cos(phase) * orbitRadius, sin(phase) * orbitRadius * orbitAspect);
  let orbitForce = (orbitTarget - position) * (0.72 + chromeHash(fi + 61.0) * 0.44);
  let tangent = vec2f(-sin(phase), cos(phase));
  velocity += (orbitForce + tangent * 0.018) * dt;
  var pointerStretch = 0.0;
  if (ambientV3Frame.pointerState.x > 0.5) {
    let delta = ambientV3Frame.pointer.xy - position;
    let proximity = exp(-dot(delta, delta) * 9.0);
    let dwell = smoothstep(0.18, 2.8, ambientV3Frame.pointerState.z);
    pointerStretch = proximity * max(ambientV3Frame.pointerState.y, dwell) * ambientV3Frame.effects.x;
    velocity += delta * proximity * ambientV3Frame.effects.x * dt * (2.2 + pointerStretch * 2.6);
  }
  position += velocity * dt * ambientV3Frame.tone.x;
  if (position.x < 0.04 || position.x > 0.96) { velocity.x = -velocity.x; }
  if (position.y < 0.04 || position.y > 0.96) { velocity.y = -velocity.y; }
  position = clamp(position, vec2f(0.04), vec2f(0.96));
  metaballs[index].positionRadius = vec4f(
    position,
    baseRadius * (1.0 + pointerStretch * 0.72),
    metaballs[index].positionRadius.w
  );
  let phaseSpeed = 0.05 + chromeHash(fi + 79.0) * 0.16;
  metaballs[index].velocityPhase = vec4f(velocity * 0.994, phase + dt * phaseSpeed, metaballs[index].velocityPhase.w);
}`;

// A Gaussian implicit surface has a continuous height and field-gradient normal at
// every overlap. Its silhouette uses pixel derivatives, never a broad glow.
const CHROME_SOLID_RENDER_SHADER = `${FRAME_WGSL}${FULLSCREEN_VERTEX_WGSL}
struct MetaballState { positionRadius: vec4f, velocityPhase: vec4f }
@group(0) @binding(1) var<storage, read> metaballs: array<MetaballState>;
@fragment fn ambientV3LaneFragment(input: AmbientV3LaneVertexOut) -> @location(0) vec4f {
  let aspect = ambientV3Frame.resolutionTime.x / max(1.0, ambientV3Frame.resolutionTime.y);
  let framing = max(1.0, 1.42 / aspect);
  let point = (input.uv - vec2f(0.5)) * vec2f(aspect, 1.0) * framing;
  var field = 0.0;
  var gradient = vec2f(0.0);
  var weightedRadius = 0.0;
  for (var index = 0u; index < u32(art_bodies); index += 1u) {
    let ball = metaballs[index].positionRadius;
    let center = (ball.xy - vec2f(0.5)) * vec2f(1.55, 1.0);
    let delta = point - center;
    let variance = max(ball.z * ball.z * 1.6, 0.00001);
    let contribution = exp(-dot(delta, delta) / variance);
    field += contribution;
    gradient += contribution * (-2.0 / variance) * delta;
    weightedRadius += contribution * variance;
  }
  let threshold = 0.43;
  let edgeWidth = max(fwidth(field) * 0.7, 0.0001);
  let coverage = smoothstep(threshold - edgeWidth, threshold + edgeWidth, field);
  let radiusSquared = weightedRadius / max(field, 0.0001);
  let height = sqrt(max(radiusSquared * log(max(field / threshold, 1.00001)), 0.000001));
  let surfaceGradient = -radiusSquared * gradient / max(field, 0.0001);
  let normal = normalize(vec3f(surfaceGradient, 2.0 * height));
  let reflection = reflect(vec3f(0.0, 0.0, -1.0), normal);
  let roughness = art_metalRoughness;
  let blur = 0.025 + roughness * 0.38;
  let roof = smoothstep(-0.18 - blur, 0.30 + blur, reflection.y);
  let darkCard = 1.0 - smoothstep(0.20 - blur, 0.20 + blur, abs(reflection.y - 0.03));
  let strip = exp(-pow(abs((reflection.y - 0.54 + reflection.x * 0.22) / (0.065 + blur)), 4.0));
  let sideCard = exp(-pow(abs((reflection.x + 0.64) / (0.10 + blur)), 4.0));
  let lowerCard = exp(-pow(abs((reflection.y + 0.63) / (0.075 + blur)), 4.0));
  var environment = mix(vec3f(0.035, 0.043, 0.058), vec3f(0.52, 0.59, 0.67), roof);
  environment *= 1.0 - darkCard * 0.88;
  environment += vec3f(1.6, 1.66, 1.72) * strip;
  environment += vec3f(0.98, 0.83, 0.66) * sideCard * 0.9;
  environment += mix(vec3f(0.45, 0.62, 0.78), ambientV3Frame.accentPrimary.rgb, 0.10) * lowerCard;
  let fresnel = 0.91 + 0.09 * pow(1.0 - max(normal.z, 0.0), 5.0);
  let metal = environment * fresnel;
  let backdrop = mix(vec3f(0.006, 0.009, 0.015), vec3f(0.020, 0.027, 0.036), input.uv.y);
  let shadow = exp(-dot(point * vec2f(1.2, 3.5), point * vec2f(1.2, 3.5)) * 5.0) * 0.36;
  return vec4f(mix(backdrop * (1.0 - shadow), metal, coverage), 1.0);
}`;

const RIPPLE_COMPUTE_SHADER = `${FRAME_WGSL}
@group(0) @binding(1) var<storage, read_write> rippleState: array<vec2f>;
@compute @workgroup_size(64)
fn simulateRipple(@builtin(global_invocation_id) gid: vec3u) {
  let index = gid.x;
  if (index >= 256u) { return; }
  let frameIndex = u32(ambientV3Frame.effects.z);
  let destinationBase = (frameIndex & 1u) * 256u;
  let sourceBase = ((frameIndex + 1u) & 1u) * 256u;
  let left = sourceBase + max(index, 1u) - 1u;
  let right = sourceBase + min(index + 1u, 255u);
  let center = rippleState[sourceBase + index];
  let laplacian = rippleState[left].x + rippleState[right].x - 2.0 * center.x;
  let dt = min(ambientV3Frame.resolutionTime.w, 0.033);
  var velocity = (center.y + laplacian * dt * 72.0) * exp(-dt * 1.7);
  var height = center.x + velocity * dt;
  let x = (f32(index) + 0.5) / 256.0;
  if (ambientV3Frame.clickActivity.z < 0.8) {
    let clickDistance = (x - ambientV3Frame.clickActivity.x) * 48.0;
    let impulse = exp(-clickDistance * clickDistance) * (1.0 - ambientV3Frame.clickActivity.z / 0.8);
    velocity += impulse * (0.8 + ambientV3Frame.clickActivity.w * ambientV3Frame.effects.y);
  }
  if (ambientV3Frame.pointerState.y > 0.5) {
    let pointerDistance = (x - ambientV3Frame.pointer.x) * 64.0;
    velocity += exp(-pointerDistance * pointerDistance) * ambientV3Frame.effects.x * 0.08;
  }
  velocity += sin(x * 19.0 + ambientV3Frame.resolutionTime.z * 0.37) * dt * 0.0025;
  rippleState[destinationBase + index] = vec2f(clamp(height, -1.0, 1.0), clamp(velocity, -4.0, 4.0));
}`;

const RIPPLE_RENDER_SHADER = `${FRAME_WGSL}${FULLSCREEN_VERTEX_WGSL}
@group(0) @binding(1) var<storage, read> rippleState: array<vec2f>;
fn rippleHash(point: vec2f) -> f32 {
  return fract(sin(dot(point, vec2f(127.1, 311.7))) * 43758.5453);
}
@fragment fn ambientV3LaneFragment(input: AmbientV3LaneVertexOut) -> @location(0) vec4f {
  let frameIndex = u32(ambientV3Frame.effects.z);
  let base = (frameIndex & 1u) * 256u;
  let aspect = ambientV3Frame.resolutionTime.x / max(1.0, ambientV3Frame.resolutionTime.y);
  let clickDelta = (input.uv - ambientV3Frame.clickActivity.xy) * vec2f(aspect, 1.0);
  let ringRadius = ambientV3Frame.clickActivity.z * 0.34;
  let ringAlive = 1.0 - smoothstep(1.45, 2.4, ambientV3Frame.clickActivity.z);
  let radialRing = exp(-abs(length(clickDelta) - ringRadius) * 110.0) * ringAlive;
  let slitA = clickDelta - vec2f(0.065, 0.0);
  let slitB = clickDelta + vec2f(0.065, 0.0);
  let pathDifference = length(slitA) - length(slitB);
  let coherence = 0.5 + 0.5 * cos(pathDifference * 118.0 - ambientV3Frame.resolutionTime.z * 1.35);
  let interferenceRing = radialRing * mix(0.32, 1.0, coherence);
  let skyCoordinate = clamp(1.0 - input.uv.y, 0.0, 1.0);
  let sky = mix(vec3f(0.004, 0.009, 0.031), vec3f(0.025, 0.073, 0.125), pow(skyCoordinate, 1.45));
  let warmHorizon = vec3f(0.65, 0.23, 0.13) * exp(-abs(input.uv.y - 0.34) * 28.0) * 0.18;
  let moonPoint = (input.uv - vec2f(0.76, 0.16)) * vec2f(aspect, 1.0);
  let moon = exp(-dot(moonPoint, moonPoint) * 560.0);
  let smallMoonPoint = (input.uv - vec2f(0.84, 0.22)) * vec2f(aspect, 1.0);
  let smallMoon = exp(-dot(smallMoonPoint, smallMoonPoint) * 1900.0);
  let ringPoint = (input.uv - vec2f(0.50, 0.96)) * vec2f(aspect * 0.62, 1.0);
  let astralRingRadius = length(ringPoint);
  let ringworld = exp(-abs(astralRingRadius - 0.73) * 220.0) * smoothstep(-0.74, 0.12, ringPoint.y);
  let ringworldShadow = exp(-abs(astralRingRadius - 0.73) * 52.0) * smoothstep(-0.74, 0.12, ringPoint.y);
  let starCell = floor(input.uv * vec2f(420.0, 230.0));
  let starSeed = rippleHash(starCell);
  let starCore = pow(max(0.0, 1.0 - length(fract(input.uv * vec2f(420.0, 230.0)) - vec2f(0.5)) * 5.0), 7.0);
  let stars = vec3f(starCore * smoothstep(0.992, 0.9997, starSeed) * step(input.uv.y, 0.48));
  var color = sky + warmHorizon + stars + vec3f(0.42, 0.67, 0.92) * moon * 0.34
    + vec3f(0.72, 0.43, 0.92) * smallMoon * 0.24
    + vec3f(0.08, 0.28, 0.48) * ringworldShadow * 0.18
    + mix(vec3f(0.30, 0.72, 1.0), ambientV3Frame.accentPrimary.rgb, 0.35) * ringworld * 0.62;
  var horizonLight = 0.0;
  for (var layerIndex = 0u; layerIndex < 5u; layerIndex += 1u) {
    let layer = f32(layerIndex);
    let unwrappedX = input.uv.x + layer * 0.071 + sin(ambientV3Frame.resolutionTime.z * (0.019 + layer * 0.003)) * 0.018;
    let shiftedX = clamp(unwrappedX, 0.0, 0.999);
    let samplePosition = shiftedX * 255.0;
    let sampleIndex = min(254u, u32(floor(samplePosition)));
    let samplePart = fract(samplePosition);
    let sampleA = rippleState[base + sampleIndex].x;
    let sampleB = rippleState[base + sampleIndex + 1u].x;
    let wave = mix(sampleA, sampleB, samplePart);
    let nextWave = rippleState[base + min(sampleIndex + 2u, 255u)].x;
    let stateSlope = nextWave - wave;
    let depthFade = 1.0 - layer * 0.145;
    let worldX = (shiftedX - 0.5) * 13.0;
    let worldZ = layer * 1.72;
    let time = ambientV3Frame.resolutionTime.z * ambientV3Frame.tone.x;
    let waveA = sin(worldX * 0.52 + worldZ * 0.18 - time * 1.35);
    let waveB = 0.45 * sin(worldZ * 0.68 - worldX * 0.16 - time * 0.90);
    let waveC = 0.22 * cos(worldX * 0.95 + worldZ * 0.42 - time * 1.80);
    let oceanWave = waveA + waveB + waveC;
    let oceanSlope = 0.52 * cos(worldX * 0.52 + worldZ * 0.18 - time * 1.35)
      - 0.072 * cos(worldZ * 0.68 - worldX * 0.16 - time * 0.90)
      - 0.209 * sin(worldX * 0.95 + worldZ * 0.42 - time * 1.80);
    let slope = stateSlope * 42.0 + oceanSlope * 0.095;
    let ringDisplacement = interferenceRing * sin(layer * 1.7 + ambientV3Frame.clickActivity.z * 14.0) * 0.034 * depthFade;
    let horizon = 0.30 + layer * 0.105 + (wave * 0.055 + oceanWave * 0.038) * depthFade + ringDisplacement;
    let silhouette = smoothstep(horizon - 0.012, horizon + 0.018, input.uv.y);
    let waveNormal = normalize(vec3f(-slope, 0.30 + layer * 0.08, 1.0));
    let fresnel = pow(1.0 - max(dot(waveNormal, normalize(vec3f(0.0, 0.42, 1.0))), 0.0), 4.0);
    let reflectedSky = mix(ambientV3Frame.accentSecondary.rgb * 0.12, vec3f(0.32, 0.62, 0.88), fresnel);
    let underWater = mix(vec3f(0.006, 0.038, 0.082), ambientV3Frame.accentPrimary.rgb * 0.27, 0.24 + layer * 0.09);
    var layerColor = mix(underWater, reflectedSky, 0.16 + fresnel * 0.58);
    let causticA = abs(sin(worldX * 1.35 + worldZ * 0.72 - time * 0.64));
    let causticB = abs(sin(worldX * 0.83 - worldZ * 1.12 + time * 0.49));
    let caustic = pow(1.0 - abs(causticA - causticB), 18.0) * (1.0 - fresnel) * depthFade;
    let crestFoam = smoothstep(0.78, 1.32, waveA + waveB);
    let foam = max(smoothstep(0.035, 0.18, abs(slope)), crestFoam * 0.72) * (0.32 + interferenceRing * 0.68);
    layerColor += mix(ambientV3Frame.accentPrimary.rgb, vec3f(0.82, 0.94, 1.0), 0.58) * foam * 0.31;
    layerColor += vec3f(0.10, 0.68, 0.70) * caustic * 0.12;
    color = mix(color, layerColor, silhouette * (0.34 + layer * 0.105));
    horizonLight += exp(-abs(input.uv.y - horizon) * (150.0 - layer * 12.0)) * depthFade;
  }
  let waterMask = smoothstep(0.30, 0.40, input.uv.y);
  let waterDepth = clamp((input.uv.y - 0.30) / 0.70, 0.0, 1.0);
  let perspectiveX = (input.uv.x - 0.5) / max(0.12, waterDepth + 0.08);
  let surfaceTime = ambientV3Frame.resolutionTime.z * ambientV3Frame.tone.x;
  let microWave = 0.5 + 0.5 * sin(perspectiveX * 9.0 + 1.0 / max(waterDepth + 0.06, 0.06) * 3.4 - surfaceTime * 0.72);
  let crossWave = 0.5 + 0.5 * sin(perspectiveX * 5.3 - waterDepth * 31.0 + surfaceTime * 0.49);
  let chladni = pow(abs(sin(perspectiveX * 2.8) * sin(waterDepth * 28.0) - sin(perspectiveX * 5.6) * sin(waterDepth * 14.0)), 12.0);
  let moonRoad = exp(-abs(input.uv.x - 0.76) * (18.0 + waterDepth * 42.0))
    * pow(max(microWave * crossWave, 0.0), 5.0) * waterMask;
  let oceanBody = mix(vec3f(0.004, 0.024, 0.066), vec3f(0.015, 0.105, 0.145), waterDepth)
    + mix(ambientV3Frame.accentSecondary.rgb, ambientV3Frame.accentPrimary.rgb, microWave) * chladni * 0.045;
  color = mix(color, oceanBody + color * 0.42, waterMask * 0.46);
  color += mix(vec3f(0.52, 0.72, 0.94), vec3f(0.98, 0.70, 0.43), smallMoon) * moonRoad * 0.44;
  color += ambientV3Frame.accentPrimary.rgb * horizonLight * 0.36;
  color += mix(ambientV3Frame.accentPrimary.rgb, ambientV3Frame.accentSecondary.rgb, input.uv.y) * interferenceRing * 0.82;
  let glyphSpokes = pow(abs(cos(atan2(clickDelta.y, clickDelta.x) * 8.0)), 34.0) * radialRing;
  color += mix(vec3f(0.18, 0.92, 0.82), ambientV3Frame.accentPrimary.rgb, 0.42) * glyphSpokes * ringAlive * 0.58;
  let livingWake = exp(-dot(clickDelta * vec2f(1.2, 0.72), clickDelta * vec2f(1.2, 0.72)) * 34.0)
    * waterMask * ringAlive * (0.28 + chladni * 0.72);
  color += vec3f(0.06, 0.92, 0.78) * livingWake * 0.16;
  color += vec3f(0.09, 0.17, 0.25) * exp(-abs(input.uv.y - 0.49) * 23.0) * 0.11;
  return vec4f(color, 1.0);
}`;

const QUANTUM_COMPUTE_SHADER = `${FRAME_WGSL}
@group(0) @binding(1) var previousField: texture_2d<f32>;
@group(0) @binding(2) var nextField: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn simulateQuantum(@builtin(global_invocation_id) gid: vec3u) {
  let dimensions = textureDimensions(nextField);
  if (gid.x >= dimensions.x || gid.y >= dimensions.y) { return; }
  let coordinate = vec2i(gid.xy);
  let limit = vec2i(dimensions) - vec2i(1);
  let center = textureLoad(previousField, coordinate, 0);
  let left = textureLoad(previousField, clamp(coordinate + vec2i(-1, 0), vec2i(0), limit), 0);
  let right = textureLoad(previousField, clamp(coordinate + vec2i(1, 0), vec2i(0), limit), 0);
  let down = textureLoad(previousField, clamp(coordinate + vec2i(0, -1), vec2i(0), limit), 0);
  let up = textureLoad(previousField, clamp(coordinate + vec2i(0, 1), vec2i(0), limit), 0);
  let uv = (vec2f(gid.xy) + vec2f(0.5)) / vec2f(dimensions);
  let dt = min(ambientV3Frame.resolutionTime.w, 0.033);
  var amplitude = center.xy;
  if (ambientV3Frame.effects.z < 0.5) {
    let leftLobe = uv - vec2f(0.43, 0.5);
    let rightLobe = uv - vec2f(0.57, 0.5);
    let leftEnvelope = exp(-dot(leftLobe * vec2f(1.3, 1.0), leftLobe * vec2f(1.3, 1.0)) * 28.0);
    let rightEnvelope = exp(-dot(rightLobe * vec2f(1.3, 1.0), rightLobe * vec2f(1.3, 1.0)) * 28.0);
    amplitude = vec2f(leftEnvelope + rightEnvelope, (leftEnvelope - rightEnvelope) * 0.18);
  } else {
    let laplacian = left.xy + right.xy + down.xy + up.xy - 4.0 * center.xy;
    let phaseRate = 0.8 + 1.7 * sin(uv.x * 8.0) * cos(uv.y * 7.0);
    let rotated = vec2f(-amplitude.y, amplitude.x) * phaseRate;
    amplitude += (laplacian * 0.18 + rotated) * dt * ambientV3Frame.tone.x;
    let pointerSpeed = length(ambientV3Frame.pointer.zw);
    let dwell = smoothstep(0.22, 3.2, ambientV3Frame.pointerState.z) * (1.0 - smoothstep(0.08, 0.9, pointerSpeed));
    amplitude *= exp(-dt * (0.018 + (1.0 - dwell) * 0.046));
  }
  let sourceA = uv - vec2f(0.44, 0.51);
  let sourceB = uv - vec2f(0.56, 0.51);
  let coherentEnvelope = exp(-dot(sourceA, sourceA) * 190.0) + exp(-dot(sourceB, sourceB) * 190.0);
  let coherentPhase = ambientV3Frame.resolutionTime.z * 0.92;
  amplitude += vec2f(cos(coherentPhase), sin(coherentPhase)) * coherentEnvelope * dt * 0.12;
  let vortexTime = ambientV3Frame.resolutionTime.z * 0.083;
  let vortexA = uv - (vec2f(0.5) + vec2f(cos(vortexTime), sin(vortexTime)) * 0.17);
  let vortexB = uv - (vec2f(0.5) - vec2f(cos(vortexTime * 0.83), sin(vortexTime * 0.83)) * 0.17);
  let vortexPhase = atan2(vortexA.y, vortexA.x) - atan2(vortexB.y, vortexB.x);
  let vortexEnvelope = exp(-dot(vortexA, vortexA) * 28.0) + exp(-dot(vortexB, vortexB) * 28.0);
  amplitude += vec2f(cos(vortexPhase + coherentPhase * 0.31), sin(vortexPhase + coherentPhase * 0.31))
    * vortexEnvelope * dt * 0.032;
  if (ambientV3Frame.pointerState.x > 0.5) {
    let pointerDelta = uv - ambientV3Frame.pointer.xy;
    let pointerObservation = exp(-dot(pointerDelta, pointerDelta) * 115.0)
      * smoothstep(0.18, 2.8, ambientV3Frame.pointerState.z)
      * (1.0 - smoothstep(0.12, 1.1, length(ambientV3Frame.pointer.zw)));
    amplitude = mix(amplitude, vec2f(max(length(amplitude), 0.22), 0.0), pointerObservation * ambientV3Frame.effects.x * min(1.0, dt * 4.0));
  }
  if (ambientV3Frame.clickActivity.z < 0.45) {
    let delta = uv - ambientV3Frame.clickActivity.xy;
    let observation = exp(-dot(delta, delta) * 180.0) * (1.0 - ambientV3Frame.clickActivity.z / 0.45);
    amplitude = mix(amplitude, vec2f(length(amplitude), 0.0), observation);
  }
  let probability = dot(amplitude, amplitude);
  textureStore(nextField, coordinate, vec4f(clamp(amplitude, vec2f(-2.0), vec2f(2.0)), probability, atan2(amplitude.y, amplitude.x)));
}`;

const QUANTUM_RENDER_SHADER = `${FRAME_WGSL}${FULLSCREEN_VERTEX_WGSL}
@group(0) @binding(1) var probabilityField: texture_2d<f32>;
fn quantumBilinearState(uv: vec2f) -> vec4f {
  let dimensions = textureDimensions(probabilityField);
  let limit = vec2i(dimensions) - vec2i(1);
  let samplePosition = clamp(uv * vec2f(dimensions) - vec2f(0.5), vec2f(0.0), vec2f(limit));
  let base = clamp(vec2i(floor(samplePosition)), vec2i(0), limit);
  let part = fract(samplePosition);
  let x = min(base + vec2i(1, 0), limit);
  let y = min(base + vec2i(0, 1), limit);
  let xy = min(base + vec2i(1, 1), limit);
  let lower = mix(textureLoad(probabilityField, base, 0), textureLoad(probabilityField, x, 0), part.x);
  let upper = mix(textureLoad(probabilityField, y, 0), textureLoad(probabilityField, xy, 0), part.x);
  return mix(lower, upper, part.y);
}
fn quantumHash(point: vec2f) -> f32 {
  return fract(sin(dot(point, vec2f(127.1, 311.7))) * 43758.5453);
}
fn quantumNoise(point: vec2f) -> f32 {
  let cell = floor(point);
  let part = fract(point);
  let blend = part * part * (vec2f(3.0) - 2.0 * part);
  let lower = mix(quantumHash(cell), quantumHash(cell + vec2f(1.0, 0.0)), blend.x);
  let upper = mix(quantumHash(cell + vec2f(0.0, 1.0)), quantumHash(cell + vec2f(1.0, 1.0)), blend.x);
  return mix(lower, upper, blend.y);
}
fn quantumFog(point: vec2f, time: f32) -> f32 {
  var samplePoint = point;
  var weight = 0.56;
  var result = 0.0;
  for (var octave = 0; octave < 4; octave += 1) {
    result += quantumNoise(samplePoint + vec2f(time * (0.021 + weight * 0.014), -time * 0.017)) * weight;
    samplePoint = vec2f(samplePoint.y, -samplePoint.x) * 1.97 + vec2f(5.3, 2.7);
    weight *= 0.49;
  }
  return result;
}
fn quantumPhaseDelta(leftPhase: f32, rightPhase: f32) -> f32 {
  let difference = rightPhase - leftPhase;
  return atan2(sin(difference), cos(difference));
}
@fragment fn ambientV3LaneFragment(input: AmbientV3LaneVertexOut) -> @location(0) vec4f {
  let dimensions = textureDimensions(probabilityField);
  let coordinate = clamp(vec2i(input.uv * vec2f(dimensions)), vec2i(0), vec2i(dimensions) - vec2i(1));
  let limit = vec2i(dimensions) - vec2i(1);
  let state = quantumBilinearState(input.uv);
  let leftState = textureLoad(probabilityField, clamp(coordinate + vec2i(-1, 0), vec2i(0), limit), 0);
  let rightState = textureLoad(probabilityField, clamp(coordinate + vec2i(1, 0), vec2i(0), limit), 0);
  let downState = textureLoad(probabilityField, clamp(coordinate + vec2i(0, -1), vec2i(0), limit), 0);
  let upState = textureLoad(probabilityField, clamp(coordinate + vec2i(0, 1), vec2i(0), limit), 0);
  let probability = 1.0 - exp(-max(state.z, 0.0) * 7.5);
  let probabilityGradient = vec2f(rightState.z - leftState.z, upState.z - downState.z);
  let probabilityEdge = clamp(length(probabilityGradient) * 9.0, 0.0, 1.0);
  let interference = 0.5 + 0.5 * cos(state.w * 2.0 + ambientV3Frame.resolutionTime.z * 0.08);
  let phasePalette = 0.5 + 0.5 * sin(vec3f(state.w, state.w + 2.094, state.w + 4.188));
  let spectral = mix(
    mix(ambientV3Frame.accentSecondary.rgb, ambientV3Frame.accentPrimary.rgb, interference),
    phasePalette,
    0.42
  );
  let background = mix(vec3f(0.003, 0.006, 0.018), vec3f(0.014, 0.021, 0.052), input.uv.y);
  let time = ambientV3Frame.resolutionTime.z * ambientV3Frame.tone.x;
  let aspectPoint = vec2f(input.uv.x * ambientV3Frame.resolutionTime.x / max(1.0, ambientV3Frame.resolutionTime.y), input.uv.y);
  let fogPoint = aspectPoint * 2.65;
  let redFog = quantumFog(fogPoint + vec2f(0.026, -0.006), time);
  let greenFog = quantumFog(fogPoint, time);
  let blueFog = quantumFog(fogPoint - vec2f(0.026, -0.006), time);
  let neutralDensity = smoothstep(0.23, 0.79, greenFog);
  let neutralHaze = vec3f(redFog, greenFog, blueFog) * neutralDensity * vec3f(0.105, 0.112, 0.138);
  let uncertainty = abs(vec3f(redFog, greenFog, blueFog) - vec3f(greenFog)) * 0.33;
  let aspect = ambientV3Frame.resolutionTime.x / max(1.0, ambientV3Frame.resolutionTime.y);
  let centered = (input.uv - vec2f(0.5)) * vec2f(aspect, 1.0);
  let pathA = length(centered - vec2f(0.072, 0.0));
  let pathB = length(centered + vec2f(0.072, 0.0));
  let slitFringe = 0.5 + 0.5 * cos((pathA - pathB) * 124.0 + state.w * 1.7);
  let coherentEnvelope = exp(-dot(centered * vec2f(1.18, 0.82), centered * vec2f(1.18, 0.82)) * 5.2);
  let coherenceVeil = coherentEnvelope * (0.5 + 0.5 * cos((pathA - pathB) * 92.0 - time * 0.46));
  let probabilityRings = coherentEnvelope * pow(0.5 + 0.5 * cos(length(centered) * 43.0 - time * 0.72), 10.0);
  let islandContour = pow(0.5 + 0.5 * cos(probability * 26.0 - state.w * 2.0), 8.0);
  let phaseGradient = vec2f(
    quantumPhaseDelta(leftState.w, rightState.w),
    quantumPhaseDelta(downState.w, upState.w)
  );
  let vortexCore = smoothstep(1.25, 3.6, length(phaseGradient)) * smoothstep(0.015, 0.32, probability);
  let carpetA = pow(0.5 + 0.5 * cos(centered.x * 58.0 + centered.y * 17.0 - time * 0.52), 20.0);
  let carpetB = pow(0.5 + 0.5 * cos(centered.y * 47.0 - centered.x * 13.0 + time * 0.37), 22.0);
  let quantumCarpet = max(carpetA, carpetB) * coherentEnvelope;
  let signedWigner = 0.5 + 0.5 * sin((state.x - state.y) * 11.0 + state.w * 2.0);
  let roseWindow = pow(abs(cos(atan2(centered.y, centered.x) * 7.0 + state.w * 0.22)), 26.0)
    * exp(-abs(length(centered) - 0.27) * 18.0);
  let dispersed = mix(
    spectral,
    vec3f(spectral.b, spectral.r, spectral.g),
    slitFringe * probabilityEdge * 0.42
  );
  let resolved = dispersed * probability * (0.42 + probability * 1.12) * (0.74 + slitFringe * 0.38);
  let collapseEdge = mix(spectral, vec3f(0.88, 0.96, 1.0), 0.46) * probabilityEdge * 0.42;
  let observedMicrostructure = mix(ambientV3Frame.accentSecondary.rgb, vec3f(0.82, 0.93, 1.0), 0.52)
    * islandContour * probability * (0.025 + probabilityEdge * 0.09);
  let analyticCoherence = mix(ambientV3Frame.accentSecondary.rgb, ambientV3Frame.accentPrimary.rgb, slitFringe)
    * (coherenceVeil * 0.075 + probabilityRings * 0.055);
  let topologicalLight = mix(vec3f(0.12, 0.82, 1.0), vec3f(1.0, 0.18, 0.62), signedWigner)
    * (vortexCore * 0.36 + quantumCarpet * 0.045 + roseWindow * probability * 0.08);
  return vec4f(background + neutralHaze + uncertainty + analyticCoherence + resolved + collapseEdge + observedMicrostructure + topologicalLight, 1.0);
}`;

const PRESENT_SHADER = `${FRAME_WGSL}${FULLSCREEN_VERTEX_WGSL}
${AMBIENT_RUNTIME_V3_PRESENT_WGSL}
@group(0) @binding(1) var laneColor: texture_2d<f32>;
@fragment fn ambientV3LaneFragment(input: AmbientV3LaneVertexOut) -> @location(0) vec4f {
  let dimensions = textureDimensions(laneColor);
  let coordinate = clamp(vec2i(input.uv * vec2f(dimensions)), vec2i(0), vec2i(dimensions) - vec2i(1));
  let limit = vec2i(dimensions) - vec2i(1);
  let center = textureLoad(laneColor, coordinate, 0).rgb;
  let nearGlow = (
    textureLoad(laneColor, clamp(coordinate + vec2i(2, 1), vec2i(0), limit), 0).rgb
    + textureLoad(laneColor, clamp(coordinate + vec2i(-2, -1), vec2i(0), limit), 0).rgb
    + textureLoad(laneColor, clamp(coordinate + vec2i(1, -2), vec2i(0), limit), 0).rgb
    + textureLoad(laneColor, clamp(coordinate + vec2i(-1, 2), vec2i(0), limit), 0).rgb
  ) * 0.25;
  let farGlow = (
    textureLoad(laneColor, clamp(coordinate + vec2i(5, 3), vec2i(0), limit), 0).rgb
    + textureLoad(laneColor, clamp(coordinate + vec2i(-5, -3), vec2i(0), limit), 0).rgb
  ) * 0.5;
  var hdr = center
    + max(nearGlow - vec3f(0.18), vec3f(0.0)) * 0.16
    + max(farGlow - vec3f(0.31), vec3f(0.0)) * 0.052;
  let chromaOffset = max(1, i32(f32(dimensions.x) * 0.0011));
  hdr.r += textureLoad(laneColor, clamp(coordinate + vec2i(chromaOffset, 0), vec2i(0), limit), 0).r * 0.024;
  hdr.b += textureLoad(laneColor, clamp(coordinate - vec2i(chromaOffset, 0), vec2i(0), limit), 0).b * 0.024;
  let rgb = ambientV3Grade(
    hdr,
    input.uv,
    input.position.xy + vec2f(ambientV3Frame.effects.z * 0.17, ambientV3Frame.effects.z * 0.31),
    ambientV3Frame.tone.y,
    ambientV3Frame.tone.z,
    ambientV3Frame.tone.w
  );
  return vec4f(rgb, 1.0);
}`;

function moduleFor(device, label, code) {
    return device.createShaderModule({ label: `ambient-v3-${label}`, code });
}

function computePipelineFor(device, module, label) {
    const descriptor = { label: `ambient-v3-${label}`, layout: 'auto', compute: { module, entryPoint: computeEntryPoint(label) } };
    return device.createComputePipelineAsync
        ? device.createComputePipelineAsync(descriptor)
        : device.createComputePipeline(descriptor);
}

function renderPipelineFor(device, module, label, format, layout = 'auto') {
    const descriptor = {
        label: `ambient-v3-${label}`,
        layout,
        vertex: { module, entryPoint: 'ambientV3LaneVertex' },
        fragment: { module, entryPoint: 'ambientV3LaneFragment', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
    };
    return device.createRenderPipelineAsync
        ? device.createRenderPipelineAsync(descriptor)
        : device.createRenderPipeline(descriptor);
}

function computeEntryPoint(label) {
    if (label.startsWith('flowing-ink')) return 'simulateInk';
    if (label.startsWith('liquid-chrome')) return 'simulateChrome';
    if (label.startsWith('ripple-horizon')) return 'simulateRipple';
    return 'simulateQuantum';
}

async function validateModules(modules) {
    for (const module of modules) {
        if (typeof module?.getCompilationInfo !== 'function') continue;
        const diagnostics = await module.getCompilationInfo();
        const error = diagnostics.messages?.find(message => message.type === 'error');
        if (error) throw typedError('AMBIENT_RUNTIME_V3_SHADER_INVALID', String(error.message ?? 'Ambient V3 shader compilation failed.'));
    }
}

function align(value, alignment) {
    return Math.ceil(Math.max(alignment, value) / alignment) * alignment;
}

function bounded(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback));
}

function typedError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}
