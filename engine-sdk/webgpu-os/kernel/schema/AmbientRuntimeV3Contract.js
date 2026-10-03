// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { IncrementalSha256 } from '../../storage/IncrementalSha256.js';
import { normalizeAmbientRecipeControls } from './AmbientRecipeControls.js';
import { normalizeAmbientReaction } from '../../factory/apps/ambient-studio/AmbientReactionGraph.js';
import { assertAmbientNativeAppearanceFunctions, assertAmbientNativeInteractionFunctions } from './AmbientNativeAppearance.js';
import { finiteAmbientWaterCompilerFallback } from './AmbientFiniteWaterContract.js';

export const AMBIENT_RUNTIME_V3_PLAN_SCHEMA = 'particle-realms.ambient-runtime-plan.v3';
export const AMBIENT_RUNTIME_V3_PLAN_VERSION = 3;
export const AMBIENT_RUNTIME_V3_ABI = 'particle-realms.ambient-runtime.v3';
export const AMBIENT_RUNTIME_V3_ID = 'webgpu-os.kernel.ambient-runtime-v3';
export const AMBIENT_RUNTIME_V3_PROGRAM_SCHEMA = 'particle-realms.ambient-program.v3';
export const AMBIENT_RUNTIME_V3_FRAME_SCHEMA = 'particle-realms.ambient-frame.v3';
export const AMBIENT_RUNTIME_V3_UNIFORM_BYTES = 128;
export const AMBIENT_RUNTIME_V3_UNIFORM_FLOATS = AMBIENT_RUNTIME_V3_UNIFORM_BYTES / 4;

export const AMBIENT_RUNTIME_V3_LIMITS = deepFreeze({
    maxPlanBytes: 512 * 1024,
    maxProgramBytes: 96 * 1024,
    maxResources: 16,
    maxPasses: 16,
    maxPassEdges: 8,
    maxHistoryLength: 4,
    maxStorageBufferBytes: 4 * 1024 * 1024,
    maxLoopIterations: 128,
});

export const AMBIENT_RUNTIME_V3_EXECUTION_CLASSES = Object.freeze([
    'program',
    'fluid-ink',
    'metaball-chrome',
    'impulse-horizon',
    'temporal-field',
    'particle-field',
    'mesh-ocean',
]);

export const AMBIENT_RUNTIME_V3_FRAME_LAYOUT = deepFreeze([
    {
        field: 'resolutionTime',
        floatOffset: 0,
        byteOffset: 0,
        components: ['width', 'height', 'timeSeconds', 'deltaSeconds'],
    },
    {
        field: 'pointer',
        floatOffset: 4,
        byteOffset: 16,
        components: ['x', 'y', 'velocityX', 'velocityY'],
    },
    {
        field: 'pointerState',
        floatOffset: 8,
        byteOffset: 32,
        components: ['active', 'pressed', 'dwellSeconds', 'clickSerial'],
    },
    {
        field: 'clickActivity',
        floatOffset: 12,
        byteOffset: 48,
        components: ['clickX', 'clickY', 'clickAgeSeconds', 'activity'],
    },
    {
        field: 'accentPrimary',
        floatOffset: 16,
        byteOffset: 64,
        components: ['red', 'green', 'blue', 'reduceTransparency'],
    },
    {
        field: 'accentSecondary',
        floatOffset: 20,
        byteOffset: 80,
        components: ['red', 'green', 'blue', 'reserved'],
    },
    {
        field: 'tone',
        floatOffset: 24,
        byteOffset: 96,
        components: ['speed', 'intensity', 'exposure', 'saturation'],
    },
    {
        field: 'effects',
        floatOffset: 28,
        byteOffset: 112,
        components: ['pointerInfluence', 'activityInfluence', 'frameIndex', 'reducedMotion'],
    },
]);

export const AMBIENT_RUNTIME_V3_FRAME_FLOAT_OFFSETS = deepFreeze(
    Object.fromEntries(AMBIENT_RUNTIME_V3_FRAME_LAYOUT.map(field => [field.field, field.floatOffset])),
);
export const AMBIENT_RUNTIME_V3_FRAME_BYTE_OFFSETS = deepFreeze(
    Object.fromEntries(AMBIENT_RUNTIME_V3_FRAME_LAYOUT.map(field => [field.field, field.byteOffset])),
);

export const AMBIENT_RUNTIME_V3_FRAME_WGSL = [
    'struct AmbientV3Frame {',
    '  resolutionTime: vec4f,',
    '  pointer: vec4f,',
    '  pointerState: vec4f,',
    '  clickActivity: vec4f,',
    '  accentPrimary: vec4f,',
    '  accentSecondary: vec4f,',
    '  tone: vec4f,',
    '  effects: vec4f,',
    '}',
].join('\n');

/**
 * Shared, texture-independent presentation treatment for Ambient V3.
 *
 * The curve is adapted from the proven Playground density presenters, but it
 * lives in the kernel contract so curated programs and dedicated lanes receive
 * one deterministic treatment without importing test/demo code.
 */
export const AMBIENT_RUNTIME_V3_PRESENT_WGSL = `
fn ambientV3PresentHash(pixel: vec2f) -> f32 {
  let triplet = fract(vec3f(pixel.xyx) * 0.1031);
  let mixed = triplet + dot(triplet, triplet.yzx + vec3f(33.33));
  return fract((mixed.x + mixed.y) * mixed.z);
}

fn ambientV3AcesScalar(value: f32) -> f32 {
  let positive = max(value, 0.0);
  return clamp(
    (positive * (2.51 * positive + 0.03))
      / (positive * (2.43 * positive + 0.59) + 0.14),
    0.0,
    1.0
  );
}

fn ambientV3AcesHuePreserving(color: vec3f) -> vec3f {
  let peak = max(color.r, max(color.g, color.b));
  return max(color, vec3f(0.0)) * (ambientV3AcesScalar(peak) / max(peak, 0.00001));
}

fn ambientV3Grade(
  source: vec3f,
  uv: vec2f,
  pixel: vec2f,
  intensity: f32,
  exposure: f32,
  saturation: f32
) -> vec3f {
  var hdr = max(source, vec3f(0.0)) * intensity * exp2(exposure);
  let luminance = dot(hdr, vec3f(0.2126, 0.7152, 0.0722));
  hdr = max(mix(vec3f(luminance), hdr, saturation), vec3f(0.0));
  let peak = max(hdr.r, max(hdr.g, hdr.b));
  hdr += vec3f(0.0015, 0.0045, 0.011) * (1.0 - smoothstep(0.004, 0.052, peak));
  var color = ambientV3AcesHuePreserving(hdr);
  let centered = uv * 2.0 - vec2f(1.0);
  color *= 1.0 - 0.11 * smoothstep(0.32, 1.48, dot(centered, centered));
  color += vec3f((ambientV3PresentHash(pixel) - 0.5) / 510.0);
  return clamp(color, vec3f(0.0), vec3f(1.0));
}
`.trim();

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/;
const ID_PATTERN = /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/;
const TOP_KEYS = Object.freeze([
    'schema', 'version', 'runtimeAbi', 'projectId', 'revision', 'contentHash',
    'recipeId', 'executionClass', 'program', 'resources', 'passes', 'settings',
    'accessibility', 'metadata',
]);
const PROGRAM_KEYS = Object.freeze(['schema', 'version', 'sourceWGSL']);
const SETTINGS_KEYS = Object.freeze([
    'clearColor', 'targetFps', 'maxDpr', 'maxPixelCount', 'interactive',
    'speed', 'intensity', 'exposure', 'saturation', 'pointerInfluence', 'activityInfluence',
]);
const ACCESSIBILITY_KEYS = Object.freeze(['reducedMotion', 'staticFallback']);
const FALLBACK_KEYS = Object.freeze(['type', 'color']);
const METADATA_KEYS = Object.freeze(['title', 'category', 'capabilities']);
const RESOURCE_KEYS = Object.freeze([
    'id', 'kind', 'format', 'size', 'usage', 'lifetime', 'historyLength', 'reset',
]);
const RESOURCE_SIZE_KEYS = Object.freeze(['scale', 'byteLength']);
const PASS_KEYS = Object.freeze(['id', 'kind', 'operation', 'reads', 'writes']);
const READ_KEYS = Object.freeze(['resourceId', 'historyOffset']);
const WRITE_KEYS = Object.freeze(['resourceId']);
const RESOURCE_KINDS = new Set(['texture-2d', 'storage-buffer']);
const TEXTURE_FORMATS = new Set(['rgba8unorm', 'rgba16float', 'rg16float', 'r16float', 'depth24plus']);
const TEXTURE_USAGES = new Set(['copy-dst', 'copy-src', 'render-attachment', 'storage-binding', 'texture-binding']);
const BUFFER_USAGES = new Set(['copy-dst', 'copy-src', 'storage']);
const RESOURCE_LIFETIMES = new Set(['frame', 'persistent']);
const RESOURCE_RESETS = new Set(['discard', 'zero', 'recipe']);
const PASS_KINDS = new Set(['compute', 'render', 'copy', 'present']);
const PASS_OPERATIONS = new Set(['simulate', 'render', 'copy', 'present', 'program']);
const CAPABILITIES = new Set([
    'pointer', 'pointer-events', 'activity', 'accent', 'history', 'offscreen',
    'camera-3d', 'parallax', 'occlusion', 'shadows', 'distortion',
]);
const PROGRAM_RESERVED_PATTERNS = Object.freeze([
    [/\bstruct\s+AmbientV3Frame\b/, 'the runtime-owned AmbientV3Frame structure'],
    [/\b(?:var|let|const)\s+ambientV3Frame\b/, 'the runtime-owned ambientV3Frame binding'],
    [/\bfn\s+ambientV3Vertex\b/, 'the runtime-owned ambientV3Vertex entry point'],
    [/\bfn\s+ambientV3Fragment\b/, 'the runtime-owned ambientV3Fragment entry point'],
    [/\bfn\s+ambientV3(?:PresentHash|AcesScalar|AcesHuePreserving|Grade)\b/, 'a runtime-owned Ambient V3 presentation helper'],
]);

function textureResource(id, scale, lifetime, historyLength, reset, usage = ['render-attachment', 'texture-binding']) {
    return {
        id,
        kind: 'texture-2d',
        format: 'rgba16float',
        size: { scale, byteLength: null },
        usage: [...usage].sort(),
        lifetime,
        historyLength,
        reset,
    };
}

function storageResource(id, byteLength, reset) {
    return {
        id,
        kind: 'storage-buffer',
        format: null,
        size: { scale: null, byteLength },
        usage: ['copy-dst', 'storage'],
        lifetime: 'persistent',
        historyLength: 1,
        reset,
    };
}

function read(resourceId, historyOffset = 0) {
    return { resourceId, historyOffset };
}

function write(resourceId) {
    return { resourceId };
}

function pass(id, kind, operation, reads = [], writes = []) {
    return { id, kind, operation, reads, writes };
}

function dedicatedTopology(stateResource, colorResource) {
    return {
        resources: [stateResource, colorResource],
        passes: [
            pass('simulate', 'compute', 'simulate', [
                read(stateResource.id, stateResource.historyLength > 1 ? 1 : 0),
            ], [write(stateResource.id)]),
            pass('render', 'render', 'render', [read(stateResource.id)], [write(colorResource.id)]),
            pass('present', 'present', 'present', [read(colorResource.id)], []),
        ],
    };
}

function makeRecipe(recipeId, title, category, executionClass, capabilities, topology) {
    return {
        recipeId,
        title,
        category,
        executionClass,
        capabilities: [...capabilities].sort(),
        resources: topology.resources,
        passes: topology.passes,
    };
}

const PROGRAM_TOPOLOGY = {
    resources: [],
    passes: [pass('present', 'present', 'program')],
};
const INK_TOPOLOGY = dedicatedTopology(
    textureResource('ink-field', 0.5, 'persistent', 2, 'zero', ['storage-binding', 'texture-binding']),
    textureResource('ink-color', 1, 'frame', 1, 'discard'),
);
const CHROME_TOPOLOGY = dedicatedTopology(
    storageResource('chrome-state', 4096, 'recipe'),
    textureResource('chrome-color', 1, 'frame', 1, 'discard'),
);
const RIPPLE_TOPOLOGY = dedicatedTopology(
    storageResource('ripple-state', 4096, 'zero'),
    textureResource('ripple-color', 1, 'frame', 1, 'discard'),
);
const QUANTUM_TOPOLOGY = dedicatedTopology(
    textureResource('observation-field', 0.5, 'persistent', 2, 'zero', ['storage-binding', 'texture-binding']),
    textureResource('quantum-color', 1, 'frame', 1, 'discard'),
);
const PARTICLE_FIELD_TOPOLOGY = {
    resources: [textureResource('particle-color', 1, 'frame', 1, 'discard')],
    passes: [pass('render', 'render', 'render', [], [write('particle-color')]), pass('present', 'present', 'present', [read('particle-color')], [])],
};

// Bounded micro-passes inside simulate share this explicit ownership graph.
// The shared frame and aligned substep uniforms are host metadata, as in the
// other lanes. No old recipe's resource identity or saved hash changes.
const OCEAN_PARTICLE_RESOURCES = ['ocean-particles-a', 'ocean-particles-b', 'ocean-predicted-a', 'ocean-predicted-b'];
const OCEAN_TOPOLOGY = {
    resources: [
        ...OCEAN_PARTICLE_RESOURCES.map(id => storageResource(id, 8192, 'zero')),
        storageResource('ocean-density', 2048, 'zero'),
        storageResource('ocean-impacts', 65536, 'zero'),
        storageResource('ocean-state-controls', 64, 'zero'),
        { ...textureResource('ocean-foam', null, 'persistent', 2, 'zero', ['copy-src', 'storage-binding', 'texture-binding']), size: { scale: null, byteLength: null, width: 128, height: 128 } },
        textureResource('ocean-color', 1, 'frame', 1, 'discard'),
        { ...textureResource('ocean-depth', 1, 'frame', 1, 'discard'), format: 'depth24plus' },
    ].map(resource => resource.kind === 'storage-buffer' ? { ...resource, usage: ['copy-dst', 'copy-src', 'storage'] } : resource),
    passes: [
        pass('simulate', 'compute', 'simulate', [...OCEAN_PARTICLE_RESOURCES, 'ocean-state-controls'].map(id => read(id)), [...OCEAN_PARTICLE_RESOURCES, 'ocean-density', 'ocean-impacts', 'ocean-state-controls'].map(id => write(id))),
        pass('foam', 'compute', 'simulate', [read('ocean-foam', 1), read('ocean-impacts')], [write('ocean-foam')]),
        pass('render', 'render', 'render', [read('ocean-foam'), read('ocean-particles-a'), read('ocean-particles-b'), read('ocean-density')], [write('ocean-color'), write('ocean-depth')]),
        pass('present', 'present', 'present', [read('ocean-color')]),
    ],
};

export const AMBIENT_RUNTIME_V3_RECIPE_DEFINITIONS = deepFreeze({
    'aurora-curtains': makeRecipe(
        'aurora-curtains', 'Aurora Curtains', 'familiar', 'program',
        ['accent', 'camera-3d', 'occlusion', 'pointer'], PROGRAM_TOPOLOGY,
    ),
    'flowing-ink': makeRecipe(
        'flowing-ink', 'Flowing Ink', 'familiar', 'fluid-ink',
        ['accent', 'activity', 'history', 'offscreen', 'pointer'], INK_TOPOLOGY,
    ),
    'liquid-chrome': makeRecipe(
        'liquid-chrome', 'Liquid Chrome', 'familiar', 'metaball-chrome',
        ['accent', 'history', 'offscreen', 'pointer'], CHROME_TOPOLOGY,
    ),
    'deep-space-nebula': makeRecipe(
        'deep-space-nebula', 'Deep Space Nebula', 'familiar', 'program',
        ['accent', 'camera-3d', 'parallax', 'pointer'], PROGRAM_TOPOLOGY,
    ),
    'midnight-downpour': makeRecipe(
        'midnight-downpour', 'Midnight Downpour', 'familiar', 'program',
        ['accent', 'camera-3d', 'occlusion', 'parallax', 'pointer'], PROGRAM_TOPOLOGY,
    ),
    'ripple-horizon': makeRecipe(
        'ripple-horizon', 'Ripple Horizon', 'familiar', 'impulse-horizon',
        ['accent', 'history', 'offscreen', 'pointer', 'pointer-events'], RIPPLE_TOPOLOGY,
    ),
    'neural-lattice': makeRecipe(
        'neural-lattice', 'Neural Lattice', 'sci-fi', 'program',
        ['accent', 'activity', 'camera-3d', 'pointer'], PROGRAM_TOPOLOGY,
    ),
    'quantum-probability-field': makeRecipe(
        'quantum-probability-field', 'Quantum Probability Field', 'sci-fi', 'temporal-field',
        ['accent', 'distortion', 'history', 'offscreen', 'pointer'], QUANTUM_TOPOLOGY,
    ),
    'holographic-data-streams': makeRecipe(
        'holographic-data-streams', 'Holographic Data Streams', 'sci-fi', 'program',
        ['accent', 'activity', 'camera-3d', 'pointer'], PROGRAM_TOPOLOGY,
    ),
    'circuit-voxel-city': makeRecipe(
        'circuit-voxel-city', 'Circuit Voxel City', 'sci-fi', 'program',
        ['accent', 'camera-3d', 'occlusion', 'pointer', 'shadows'], PROGRAM_TOPOLOGY,
    ),
    'event-horizon': makeRecipe(
        'event-horizon', 'Event Horizon', 'sci-fi', 'program',
        ['accent', 'distortion', 'pointer'], PROGRAM_TOPOLOGY,
    ),
});

export const AMBIENT_RUNTIME_V3_RECIPE_IDS = Object.freeze(
    Object.keys(AMBIENT_RUNTIME_V3_RECIPE_DEFINITIONS),
);

// Preserve the original public eleven-recipe list. Collection programs use the
// same restricted ABI and topology; no new GPU binding or authority is added.
export const AMBIENT_RUNTIME_V3_COLLECTION_RECIPE_DEFINITIONS = deepFreeze(Object.fromEntries([
    ['pearlescent-silk', 'Pearlescent silk', 'familiar'],
    ['aurora-glass', 'Aurora glass', 'familiar'],
    ['liquid-metal', 'Liquid metal', 'familiar'],
    ['mineral-ink', 'Mineral ink', 'familiar'],
    ['moonlit-water', 'Moonlit water', 'familiar'],
    ['atmospheric-depth', 'Atmospheric depth', 'familiar'],
    ['rainlit-study', 'Rainlit study', 'familiar', true],
    ['sky-garden', 'Sky garden', 'familiar', true],
    ['rain-garden', 'Rain Garden', 'familiar'],
    ['neon-district', 'Neon rain district', 'familiar', true],
    ['orbital-observatory', 'Orbital observatory', 'sci-fi', true],
    ['broadcast-prism', 'Prism atmosphere', 'familiar', true],
    ['particle-world', 'Live particle world', 'sci-fi'],
    ['stellar-drift', 'Stellar drift', 'sci-fi'],
    ['vortex-bloom', 'Vortex bloom', 'sci-fi'],
    ['classic-wallpaper', 'Classic wallpaper graph', 'familiar'],
    ['mesh-ocean', 'Spectral mesh ocean', 'familiar'],
].map(([id, title, category, parallax]) => {
    if (id === 'mesh-ocean') return [id, makeRecipe(id, title, category, 'mesh-ocean', ['camera-3d', 'history', 'occlusion', 'offscreen', 'pointer', 'pointer-events'], OCEAN_TOPOLOGY)];
    const particles = ['particle-world', 'stellar-drift', 'vortex-bloom'].includes(id);
    return [id, makeRecipe(id, title, category, particles ? 'particle-field' : 'program', particles ? ['camera-3d', 'pointer'] : parallax ? ['parallax', 'pointer'] : ['pointer'], particles ? PARTICLE_FIELD_TOPOLOGY : PROGRAM_TOPOLOGY)];
})));

export const AMBIENT_RUNTIME_V3_COLLECTION_RECIPE_IDS = Object.freeze(Object.keys(AMBIENT_RUNTIME_V3_COLLECTION_RECIPE_DEFINITIONS));

export function ambientRuntimeV3RecipeDefinition(recipeId) {
    const id = String(recipeId ?? '');
    return AMBIENT_RUNTIME_V3_RECIPE_DEFINITIONS[id] ?? AMBIENT_RUNTIME_V3_COLLECTION_RECIPE_DEFINITIONS[id] ?? null;
}

export function createAmbientRuntimeV3Program(sourceWGSL) {
    const checked = validateAmbientRuntimeV3ProgramSource(sourceWGSL);
    if (!checked.ok) throw typedError(checked.code, checked.message);
    return deepFreeze({
        schema: AMBIENT_RUNTIME_V3_PROGRAM_SCHEMA,
        version: AMBIENT_RUNTIME_V3_PLAN_VERSION,
        sourceWGSL: checked.source,
    });
}

export function validateAmbientRuntimeV3ProgramSource(value) {
    const source = String(value ?? '').trim();
    if (!source) return programFailure('AMBIENT_RUNTIME_V3_PROGRAM_EMPTY', 'Ambient V3 program source is empty.');
    if (new TextEncoder().encode(source).byteLength > AMBIENT_RUNTIME_V3_LIMITS.maxProgramBytes) {
        return programFailure('AMBIENT_RUNTIME_V3_PROGRAM_TOO_LARGE', 'Ambient V3 program source exceeds 96 KiB.');
    }
    const signature = /\bfn\s+paintAmbient\s*\(\s*uv\s*:\s*vec2f\s*,\s*frame\s*:\s*AmbientV3Frame\s*\)\s*->\s*vec4f\b/g;
    const signatures = source.match(signature) ?? [];
    if (signatures.length !== 1) {
        return programFailure(
            'AMBIENT_RUNTIME_V3_PROGRAM_CONTRACT',
            'Define exactly one fn paintAmbient(uv: vec2f, frame: AmbientV3Frame) -> vec4f.',
        );
    }
    const forbidden = [
        [/@(?:vertex|fragment|compute)\b/, 'shader entry points'],
        [/@group\s*\(/, 'bind groups'],
        [/@binding\s*\(/, 'bindings'],
        [/\bvar\s*<\s*(?:storage|workgroup|uniform|private|handle)/, 'module-scope GPU address spaces'],
        [/\b(?:texture|sampler|atomic)[A-Za-z0-9_]*\b/, 'textures, samplers, or atomics'],
        [/\b(?:enable|requires|diagnostic|const_assert|override)\b/, 'module directives'],
        [/\b(?:loop|while)\s*(?:\{|\()/, 'unbounded loops'],
        [/\b(?:textureStore|workgroupBarrier|storageBarrier|discard)\b/, 'runtime-owned side effects'],
    ];
    for (const [pattern, feature] of forbidden) {
        if (pattern.test(source)) {
            return programFailure('AMBIENT_RUNTIME_V3_PROGRAM_FORBIDDEN', 'Ambient V3 programs cannot declare ' + feature + '.');
        }
    }
    for (const [pattern, feature] of PROGRAM_RESERVED_PATTERNS) {
        if (pattern.test(source)) {
            return programFailure('AMBIENT_RUNTIME_V3_PROGRAM_RESERVED', 'Ambient V3 programs cannot redeclare ' + feature + '.');
        }
    }
    const loops = validateBoundedForLoops(source);
    if (!loops.ok) return loops;
    if (!balancedDelimiters(source)) {
        return programFailure('AMBIENT_RUNTIME_V3_PROGRAM_INVALID', 'Ambient V3 program delimiters are unbalanced.');
    }
    return Object.freeze({ ok: true, source, code: null, message: '' });
}

export function buildAmbientRuntimeV3ProgramSource(authoredSource, contentHash = '', { recipeId = null } = {}) {
    const checked = validateAmbientRuntimeV3ProgramSource(authoredSource);
    if (!checked.ok) throw typedError(checked.code, checked.message);
    const label = HASH_PATTERN.test(String(contentHash ?? '')) ? '// Plan ' + contentHash : '// Unhashed preview';
    return [
        '// particle-realms.ambient-runtime-program-harness.v3',
        label,
        AMBIENT_RUNTIME_V3_FRAME_WGSL,
        '@group(0) @binding(0) var<uniform> ambientV3Frame: AmbientV3Frame;',
        AMBIENT_RUNTIME_V3_PRESENT_WGSL,
        checked.source,
        ...(finiteAmbientWaterCompilerFallback(checked.source, 'v3') ? [finiteAmbientWaterCompilerFallback(checked.source, 'v3')] : []),
        'struct AmbientV3VertexOut {',
        '  @builtin(position) position: vec4f,',
        '  @location(0) uv: vec2f,',
        '}',
        '@vertex fn ambientV3Vertex(@builtin(vertex_index) vertexIndex: u32) -> AmbientV3VertexOut {',
        '  let position = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0))[vertexIndex];',
        '  var output: AmbientV3VertexOut;',
        '  output.position = vec4f(position, 0.0, 1.0);',
        '  output.uv = position * 0.5 + vec2f(0.5);',
        '  return output;',
        '}',
        '@fragment fn ambientV3Fragment(input: AmbientV3VertexOut) -> @location(0) vec4f {',
        '  let painted = paintAmbient(input.uv, ambientV3Frame);',
        ...(recipeId === 'classic-wallpaper' ? ['  let rgb = clamp(painted.rgb, vec3f(0.0), vec3f(1.0));'] : [
        '  let rgb = ambientV3Grade(',
        '    painted.rgb,',
        '    input.uv,',
        '    input.position.xy + vec2f(ambientV3Frame.effects.z * 0.17, ambientV3Frame.effects.z * 0.31),',
        '    ambientV3Frame.tone.y,',
        '    ambientV3Frame.tone.z,',
        '    ambientV3Frame.tone.w',
        '  );']),
        '  return vec4f(rgb, clamp(painted.a, 0.0, 1.0));',
        '}',
    ].join('\n');
}

export function createAmbientRuntimeV3Plan(source = {}) {
    if (!isPlainObject(source)) throw new TypeError('Ambient V3 plan source must be a plain object');
    const recipe = ambientRuntimeV3RecipeDefinition(source.recipeId);
    if (!recipe) throw typedError('AMBIENT_RUNTIME_V3_RECIPE', 'Ambient V3 recipeId is unsupported.');
    const executionClass = source.executionClass ?? recipe.executionClass;
    const settingsSource = isPlainObject(source.settings) ? source.settings : {};
    const clearColor = settingsSource.clearColor ?? '#05070c';
    const metadataSource = isPlainObject(source.metadata) ? source.metadata : {};
    const accessibilitySource = isPlainObject(source.accessibility) ? source.accessibility : {};
    const fallbackSource = isPlainObject(accessibilitySource.staticFallback)
        ? accessibilitySource.staticFallback
        : {};
    let program = source.program ?? null;
    if (executionClass === 'program') {
        if (typeof program === 'string') program = createAmbientRuntimeV3Program(program);
        else if (isPlainObject(program)
            && Object.keys(program).length === 1
            && typeof program.sourceWGSL === 'string') {
            program = createAmbientRuntimeV3Program(program.sourceWGSL);
        } else program = cloneJson(program);
    }
    const plan = {
        schema: AMBIENT_RUNTIME_V3_PLAN_SCHEMA,
        version: AMBIENT_RUNTIME_V3_PLAN_VERSION,
        runtimeAbi: AMBIENT_RUNTIME_V3_ABI,
        projectId: source.projectId ?? recipe.recipeId,
        revision: source.revision ?? 0,
        contentHash: '',
        recipeId: recipe.recipeId,
        executionClass,
        program,
        ...(source.reaction === undefined ? {} : { reaction: normalizeAmbientReaction(source.reaction) }),
        ...(source.appearance === undefined ? {} : { appearance: cloneJson(source.appearance) }),
        ...(source.interaction === undefined ? {} : { interaction: cloneJson(source.interaction) }),
        resources: cloneJson(source.resources ?? recipe.resources),
        passes: cloneJson(source.passes ?? recipe.passes),
        settings: {
            clearColor,
            targetFps: settingsSource.targetFps ?? 60,
            maxDpr: settingsSource.maxDpr ?? 2,
            maxPixelCount: settingsSource.maxPixelCount ?? 8_294_400,
            interactive: settingsSource.interactive ?? recipe.capabilities.includes('pointer'),
            speed: settingsSource.speed ?? 1,
            intensity: settingsSource.intensity ?? 1,
            exposure: settingsSource.exposure ?? 0,
            saturation: settingsSource.saturation ?? 1,
            pointerInfluence: settingsSource.pointerInfluence ?? (recipe.capabilities.includes('pointer') ? 0.35 : 0),
            activityInfluence: settingsSource.activityInfluence ?? (recipe.capabilities.includes('activity') ? 0.5 : 0),
            ...(settingsSource.renderScale === undefined ? {} : { renderScale: settingsSource.renderScale }),
            ...(settingsSource.motionPaused === undefined ? {} : { motionPaused: settingsSource.motionPaused }),
            ...(settingsSource.recipeControls === undefined ? {} : { recipeControls: cloneJson(settingsSource.recipeControls) }),
        },
        accessibility: {
            reducedMotion: accessibilitySource.reducedMotion ?? 'pause',
            staticFallback: {
                type: fallbackSource.type ?? 'css',
                color: fallbackSource.color ?? clearColor,
            },
        },
        metadata: {
            title: metadataSource.title ?? recipe.title,
            category: metadataSource.category ?? recipe.category,
            capabilities: cloneJson(metadataSource.capabilities ?? recipe.capabilities),
        },
    };
    plan.contentHash = ambientRuntimeV3PlanHash(plan);
    const checked = validateAmbientRuntimeV3Plan(plan);
    if (!checked.ok) throw typedError(checked.code, checked.message);
    return checked.plan;
}

export function validateAmbientRuntimeV3Plan(value) {
    try {
        assertPlainObject(value, 'plan');
        assertExactKeys(value, [...TOP_KEYS, ...(value.appearance === undefined ? [] : ['appearance']), ...(value.interaction === undefined ? [] : ['interaction']), ...(value.reaction === undefined ? [] : ['reaction'])], 'plan');
        const encoded = new TextEncoder().encode(JSON.stringify(value));
        if (encoded.byteLength > AMBIENT_RUNTIME_V3_LIMITS.maxPlanBytes) {
            throw new RangeError('plan exceeds the 512 KiB limit');
        }
        if (value.schema !== AMBIENT_RUNTIME_V3_PLAN_SCHEMA
            || value.version !== AMBIENT_RUNTIME_V3_PLAN_VERSION) {
            return failure('AMBIENT_RUNTIME_V3_PLAN_SCHEMA', 'Ambient V3 plan schema or version is unsupported.');
        }
        if (value.runtimeAbi !== AMBIENT_RUNTIME_V3_ABI) {
            return failure('AMBIENT_RUNTIME_V3_PLAN_ABI', 'Ambient V3 runtime ABI is unsupported.');
        }
        assertId(value.projectId, 'plan.projectId');
        if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
            throw new RangeError('plan.revision must be a nonnegative safe integer');
        }
        const recipe = ambientRuntimeV3RecipeDefinition(value.recipeId);
        if (!recipe) throw new TypeError('plan.recipeId is unsupported');
        if (!AMBIENT_RUNTIME_V3_EXECUTION_CLASSES.includes(value.executionClass)) {
            throw new TypeError('plan.executionClass is unsupported');
        }
        if (value.executionClass !== recipe.executionClass) {
            throw new TypeError('plan.executionClass does not match its recipe');
        }
        assertProgram(value.program, value.executionClass);
        if (value.executionClass === 'mesh-ocean' && !value.appearance?.renderFunctions) throw new TypeError('Mesh oceans require their saved wave, material and simulation functions.');
        if (value.reaction !== undefined && canonicalAmbientRuntimeV3Json(normalizeAmbientReaction(value.reaction)) !== canonicalAmbientRuntimeV3Json(value.reaction)) throw new TypeError('Reaction config must use its canonical bounded form.');
        if (value.appearance !== undefined) {
            if (value.executionClass === 'program') throw new TypeError('Program recipes author paintAmbient directly.');
            assertPlainObject(value.appearance, 'plan.appearance');
            assertExactKeys(value.appearance, ['renderFunctions', ...(value.appearance.presentFunctions === undefined ? [] : ['presentFunctions'])], 'plan.appearance');
            assertAmbientNativeAppearanceFunctions(value.appearance.renderFunctions);
            if (value.appearance.presentFunctions !== undefined) {
                if (value.executionClass !== 'particle-field') throw new TypeError('Only particle fields expose present functions.');
                assertAmbientNativeAppearanceFunctions(value.appearance.presentFunctions);
            }
        }
        if (value.interaction !== undefined) {
            assertPlainObject(value.interaction, 'plan.interaction');
            assertExactKeys(value.interaction, ['functionsWGSL'], 'plan.interaction');
            assertAmbientNativeInteractionFunctions(value.interaction.functionsWGSL, value.recipeId);
        }
        assertSettings(value.settings, recipe);
        assertAccessibility(value.accessibility);
        assertMetadata(value.metadata, recipe);
        assertResourcesAndPasses(value.resources, value.passes, recipe);
        if (!HASH_PATTERN.test(String(value.contentHash ?? ''))) {
            return failure('AMBIENT_RUNTIME_V3_PLAN_HASH', 'Ambient V3 plan contentHash is invalid.');
        }
        const expectedHash = ambientRuntimeV3PlanHash(value);
        if (value.contentHash !== expectedHash) {
            return failure('AMBIENT_RUNTIME_V3_PLAN_HASH_MISMATCH', 'Ambient V3 plan contentHash does not match its canonical payload.');
        }
        const plan = deepFreeze(cloneJson(value));
        return Object.freeze({
            ok: true,
            plan,
            execution: resolveAmbientRuntimeV3Execution(plan),
            code: null,
            message: '',
        });
    } catch (error) {
        return failure('AMBIENT_RUNTIME_V3_PLAN_INVALID', error?.message ?? String(error));
    }
}

export function resolveAmbientRuntimeV3Execution(plan) {
    const resources = Array.isArray(plan?.resources) ? plan.resources : [];
    const passes = Array.isArray(plan?.passes) ? plan.passes : [];
    return deepFreeze({
        runtimeId: AMBIENT_RUNTIME_V3_ID,
        runtimeAbi: AMBIENT_RUNTIME_V3_ABI,
        recipeId: plan?.recipeId ?? null,
        executionClass: plan?.executionClass ?? null,
        program: plan?.executionClass === 'program',
        dedicated: plan?.executionClass !== 'program',
        resourceIds: resources.map(resource => resource.id),
        persistentResourceIds: resources.filter(resource => resource.lifetime === 'persistent').map(resource => resource.id),
        transientResourceIds: resources.filter(resource => resource.lifetime === 'frame').map(resource => resource.id),
        orderedPassIds: passes.map(item => item.id),
        passOperations: passes.map(item => item.operation),
        presentPassId: passes.find(item => item.kind === 'present')?.id ?? null,
        usesHistory: resources.some(resource => resource.historyLength > 1),
        capabilities: [...(plan?.metadata?.capabilities ?? [])],
    });
}

export function canonicalAmbientRuntimeV3Json(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('Canonical JSON forbids non-finite numbers');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return '[' + value.map(canonicalAmbientRuntimeV3Json).join(',') + ']';
    if (!isPlainObject(value)) throw new TypeError('Canonical JSON accepts only plain objects');
    return '{' + Object.keys(value).sort().map(key => (
        JSON.stringify(key) + ':' + canonicalAmbientRuntimeV3Json(value[key])
    )).join(',') + '}';
}

export function ambientRuntimeV3PlanHash(value) {
    if (!isPlainObject(value)) throw new TypeError('Ambient V3 plan hash input must be a plain object');
    const payload = { ...value };
    delete payload.contentHash;
    const hasher = new IncrementalSha256();
    hasher.update(new TextEncoder().encode(canonicalAmbientRuntimeV3Json(payload)));
    return 'sha256:' + hasher.hex();
}

export function normalizeAmbientRuntimeV3FrameInputs(value = {}) {
    const source = isPlainObject(value) ? value : {};
    const resolutionTime = vector4(source.resolutionTime, [1, 1, 0, 0]);
    const pointer = vector4(source.pointer, [-1, -1, 0, 0]);
    const pointerState = vector4(source.pointerState, [0, 0, 0, 0]);
    const clickActivity = vector4(source.clickActivity, [-1, -1, 60, 0]);
    const accentPrimary = vector4(source.accentPrimary, [0.36, 0.49, 1, 0]);
    const accentSecondary = vector4(source.accentSecondary, [0.12, 0.82, 0.71, 0]);
    const tone = vector4(source.tone, [1, 1, 0, 1]);
    const effects = vector4(source.effects, [0.35, 0, 0, 0]);
    return deepFreeze({
        resolutionTime: [
            finiteClamped(resolutionTime[0], 1, 32768, 1),
            finiteClamped(resolutionTime[1], 1, 32768, 1),
            finiteClamped(resolutionTime[2], 0, 16_777_215, 0),
            finiteClamped(resolutionTime[3], 0, 0.25, 0),
        ],
        pointer: [
            finiteClamped(pointer[0], -1, 1, -1),
            finiteClamped(pointer[1], -1, 1, -1),
            finiteClamped(pointer[2], -64, 64, 0),
            finiteClamped(pointer[3], -64, 64, 0),
        ],
        pointerState: [
            flag(pointerState[0]),
            flag(pointerState[1]),
            finiteClamped(pointerState[2], 0, 60, 0),
            f32Integer(pointerState[3]),
        ],
        clickActivity: [
            finiteClamped(clickActivity[0], -1, 1, -1),
            finiteClamped(clickActivity[1], -1, 1, -1),
            finiteClamped(clickActivity[2], 0, 60, 60),
            finiteClamped(clickActivity[3], 0, 1, 0),
        ],
        accentPrimary: [
            finiteClamped(accentPrimary[0], 0, 1, 0.36),
            finiteClamped(accentPrimary[1], 0, 1, 0.49),
            finiteClamped(accentPrimary[2], 0, 1, 1),
            flag(accentPrimary[3]),
        ],
        accentSecondary: [
            finiteClamped(accentSecondary[0], 0, 1, 0.12),
            finiteClamped(accentSecondary[1], 0, 1, 0.82),
            finiteClamped(accentSecondary[2], 0, 1, 0.71),
            0,
        ],
        tone: [
            finiteClamped(tone[0], 0, 4, 1),
            finiteClamped(tone[1], 0, 2, 1),
            finiteClamped(tone[2], -4, 4, 0),
            finiteClamped(tone[3], 0, 3, 1),
        ],
        effects: [
            finiteClamped(effects[0], 0, 1, 0.35),
            finiteClamped(effects[1], 0, 1, 0),
            f32Integer(effects[2]),
            flag(effects[3]),
        ],
    });
}

export function packAmbientRuntimeV3FrameInputs(value = {}, target = null) {
    const normalized = normalizeAmbientRuntimeV3FrameInputs(value);
    let output;
    if (target == null) output = new Float32Array(AMBIENT_RUNTIME_V3_UNIFORM_FLOATS);
    else if (target instanceof Float32Array) {
        if (target.length < AMBIENT_RUNTIME_V3_UNIFORM_FLOATS) {
            throw new RangeError('Ambient V3 frame target Float32Array is smaller than 32 floats');
        }
        output = target;
    } else if (target instanceof ArrayBuffer) {
        if (target.byteLength < AMBIENT_RUNTIME_V3_UNIFORM_BYTES) {
            throw new RangeError('Ambient V3 frame target ArrayBuffer is smaller than 128 bytes');
        }
        output = new Float32Array(target, 0, AMBIENT_RUNTIME_V3_UNIFORM_FLOATS);
    } else {
        throw new TypeError('Ambient V3 frame target must be a Float32Array or ArrayBuffer');
    }
    for (const field of AMBIENT_RUNTIME_V3_FRAME_LAYOUT) {
        output.set(normalized[field.field], field.floatOffset);
    }
    return output;
}

function assertProgram(program, executionClass) {
    if (executionClass !== 'program') {
        if (program !== null) throw new TypeError('dedicated Ambient V3 plans require program=null');
        return;
    }
    assertPlainObject(program, 'plan.program');
    assertExactKeys(program, PROGRAM_KEYS, 'plan.program');
    if (program.schema !== AMBIENT_RUNTIME_V3_PROGRAM_SCHEMA
        || program.version !== AMBIENT_RUNTIME_V3_PLAN_VERSION) {
        throw new TypeError('plan.program schema or version is unsupported');
    }
    const checked = validateAmbientRuntimeV3ProgramSource(program.sourceWGSL);
    if (!checked.ok) throw typedError(checked.code, 'plan.program: ' + checked.message);
    if (checked.source !== program.sourceWGSL) throw new TypeError('plan.program.sourceWGSL is not canonical');
}

function assertSettings(value, recipe) {
    assertPlainObject(value, 'plan.settings');
    assertExactKeys(value, [...SETTINGS_KEYS, ...['renderScale', 'recipeControls', 'motionPaused'].filter(key => Object.hasOwn(value, key))], 'plan.settings');
    if (Object.hasOwn(value, 'motionPaused') && typeof value.motionPaused !== 'boolean') throw new TypeError('plan.settings.motionPaused must be boolean');
    if (Object.hasOwn(value, 'renderScale')) boundedNumber(value.renderScale, .1, 1, 'plan.settings.renderScale');
    if (Object.hasOwn(value, 'recipeControls')) {
        if (recipe.executionClass === 'program') throw new TypeError('Program recipe controls must be compiled into its authored source');
        normalizeAmbientRecipeControls(recipe.recipeId, value.recipeControls, { strict: true });
    }
    if (!COLOR_PATTERN.test(String(value.clearColor ?? ''))) throw new TypeError('plan.settings.clearColor must be #rrggbb');
    boundedInteger(value.targetFps, 1, 60, 'plan.settings.targetFps');
    boundedNumber(value.maxDpr, 0.5, 4, 'plan.settings.maxDpr');
    boundedInteger(value.maxPixelCount, 4, 67_108_864, 'plan.settings.maxPixelCount');
    if (typeof value.interactive !== 'boolean') throw new TypeError('plan.settings.interactive must be boolean');
    if (!value.interactive && value.pointerInfluence !== 0) {
        throw new TypeError('non-interactive plans cannot retain pointer influence');
    }
    boundedNumber(value.speed, 0, 4, 'plan.settings.speed');
    boundedNumber(value.intensity, 0, 2, 'plan.settings.intensity');
    boundedNumber(value.exposure, -4, 4, 'plan.settings.exposure');
    boundedNumber(value.saturation, 0, 3, 'plan.settings.saturation');
    boundedNumber(value.pointerInfluence, 0, 1, 'plan.settings.pointerInfluence');
    boundedNumber(value.activityInfluence, 0, 1, 'plan.settings.activityInfluence');
    if (!recipe.capabilities.includes('activity') && value.activityInfluence !== 0) {
        throw new TypeError('plan.settings.activityInfluence requires an activity-capable recipe');
    }
}

function assertAccessibility(value) {
    assertPlainObject(value, 'plan.accessibility');
    assertExactKeys(value, ACCESSIBILITY_KEYS, 'plan.accessibility');
    if (!['pause', 'static'].includes(value.reducedMotion)) {
        throw new TypeError('plan.accessibility.reducedMotion is unsupported');
    }
    assertPlainObject(value.staticFallback, 'plan.accessibility.staticFallback');
    assertExactKeys(value.staticFallback, FALLBACK_KEYS, 'plan.accessibility.staticFallback');
    if (value.staticFallback.type !== 'css' || !COLOR_PATTERN.test(String(value.staticFallback.color ?? ''))) {
        throw new TypeError('plan.accessibility.staticFallback is invalid');
    }
}

function assertMetadata(value, recipe) {
    assertPlainObject(value, 'plan.metadata');
    assertExactKeys(value, METADATA_KEYS, 'plan.metadata');
    boundedText(value.title, 1, 128, 'plan.metadata.title');
    if (value.category !== recipe.category) throw new TypeError('plan.metadata.category does not match its recipe');
    assertSortedUniqueStrings(value.capabilities, CAPABILITIES, 'plan.metadata.capabilities');
    if (canonicalAmbientRuntimeV3Json(value.capabilities)
        !== canonicalAmbientRuntimeV3Json(recipe.capabilities)) {
        throw new TypeError('plan.metadata.capabilities do not match their recipe');
    }
}

function assertResourcesAndPasses(resources, passes, recipe) {
    if (!Array.isArray(resources) || resources.length > AMBIENT_RUNTIME_V3_LIMITS.maxResources) {
        throw new RangeError('plan.resources exceeds the bounded resource count');
    }
    const resourcesById = new Map();
    resources.forEach((resource, index) => {
        assertResource(resource, index);
        if (resourcesById.has(resource.id)) throw new TypeError('plan.resources contains a duplicate id');
        resourcesById.set(resource.id, resource);
    });
    if (!Array.isArray(passes) || passes.length < 1 || passes.length > AMBIENT_RUNTIME_V3_LIMITS.maxPasses) {
        throw new RangeError('plan.passes must contain a bounded non-empty pass list');
    }
    const passIds = new Set();
    const referencedResources = new Set();
    let presentCount = 0;
    passes.forEach((item, index) => {
        assertPass(item, index, resourcesById, referencedResources);
        if (passIds.has(item.id)) throw new TypeError('plan.passes contains a duplicate id');
        passIds.add(item.id);
        if (item.kind === 'present') {
            presentCount++;
            if (index !== passes.length - 1) throw new TypeError('the present pass must be last');
        }
    });
    if (presentCount !== 1) throw new TypeError('plan.passes requires exactly one present pass');
    for (const resource of resources) {
        if (!referencedResources.has(resource.id)) throw new TypeError('plan resource ' + resource.id + ' is unused');
    }
    if (recipe.executionClass === 'program') {
        if (resources.length !== 0 || passes.length !== 1
            || passes[0].kind !== 'present' || passes[0].operation !== 'program'
            || passes[0].reads.length || passes[0].writes.length) {
            throw new TypeError('program recipes require one direct program present pass and no resources');
        }
    } else if (resources.length < 1 || passes.length < 2 || passes.at(-1).reads.length !== 1) {
        throw new TypeError('dedicated recipes require resources, multiple passes, and one presented resource');
    }
    if (canonicalAmbientRuntimeV3Json(resources) !== canonicalAmbientRuntimeV3Json(recipe.resources)
        || canonicalAmbientRuntimeV3Json(passes) !== canonicalAmbientRuntimeV3Json(recipe.passes)) {
        throw new TypeError('plan resources or passes do not match the canonical recipe topology');
    }
}

function assertResource(value, index) {
    const label = 'plan.resources[' + index + ']';
    assertPlainObject(value, label);
    assertExactKeys(value, RESOURCE_KEYS, label);
    assertId(value.id, label + '.id');
    if (!RESOURCE_KINDS.has(value.kind)) throw new TypeError(label + '.kind is unsupported');
    assertPlainObject(value.size, label + '.size');
    const fixedTexture = value.kind === 'texture-2d' && value.size.width !== undefined;
    assertExactKeys(value.size, [...RESOURCE_SIZE_KEYS, ...(fixedTexture ? ['width', 'height'] : [])], label + '.size');
    if (!RESOURCE_LIFETIMES.has(value.lifetime)) throw new TypeError(label + '.lifetime is unsupported');
    boundedInteger(value.historyLength, 1, AMBIENT_RUNTIME_V3_LIMITS.maxHistoryLength, label + '.historyLength');
    if (!RESOURCE_RESETS.has(value.reset)) throw new TypeError(label + '.reset is unsupported');
    if (value.lifetime === 'frame' && (value.historyLength !== 1 || value.reset !== 'discard')) {
        throw new TypeError(label + ' frame resources require historyLength=1 and reset=discard');
    }
    if (value.lifetime === 'persistent' && value.reset === 'discard') {
        throw new TypeError(label + ' persistent resources require an explicit reset');
    }
    if (value.kind === 'texture-2d') {
        if (!TEXTURE_FORMATS.has(value.format)) throw new TypeError(label + '.format is unsupported');
        if (fixedTexture) {
            if (value.size.scale !== null) throw new TypeError(label + ' fixed textures require scale=null');
            boundedInteger(value.size.width, 8, 2048, label + '.size.width');
            boundedInteger(value.size.height, 8, 2048, label + '.size.height');
        } else boundedNumber(value.size.scale, 0.125, 1, label + '.size.scale');
        if (value.size.byteLength !== null) throw new TypeError(label + '.size.byteLength must be null for textures');
        assertSortedUniqueStrings(value.usage, TEXTURE_USAGES, label + '.usage');
        if (value.format === 'depth24plus' && (!value.usage.includes('render-attachment') || value.usage.includes('storage-binding'))) throw new TypeError(label + ' depth textures require a render attachment and cannot be storage textures');
        if (!value.usage.includes('texture-binding')
            || !value.usage.some(usage => ['render-attachment', 'storage-binding', 'copy-dst'].includes(usage))) {
            throw new TypeError(label + '.usage must support sampling and writing');
        }
    } else {
        if (value.format !== null || value.size.scale !== null) {
            throw new TypeError(label + ' storage buffers require format=null and scale=null');
        }
        boundedInteger(value.size.byteLength, 16, AMBIENT_RUNTIME_V3_LIMITS.maxStorageBufferBytes, label + '.size.byteLength');
        if (value.size.byteLength % 16 !== 0) throw new TypeError(label + '.size.byteLength must be 16-byte aligned');
        assertSortedUniqueStrings(value.usage, BUFFER_USAGES, label + '.usage');
        if (!value.usage.includes('storage')) throw new TypeError(label + '.usage must include storage');
        if (value.historyLength !== 1) throw new TypeError(label + ' storage buffers do not support texture history rings');
    }
}

function assertPass(value, index, resourcesById, referencedResources) {
    const label = 'plan.passes[' + index + ']';
    assertPlainObject(value, label);
    assertExactKeys(value, PASS_KEYS, label);
    assertId(value.id, label + '.id');
    if (!PASS_KINDS.has(value.kind)) throw new TypeError(label + '.kind is unsupported');
    if (!PASS_OPERATIONS.has(value.operation)) throw new TypeError(label + '.operation is unsupported');
    const expectedOperation = {
        compute: 'simulate',
        render: 'render',
        copy: 'copy',
    }[value.kind];
    if (expectedOperation && value.operation !== expectedOperation) {
        throw new TypeError(label + '.operation does not match its pass kind');
    }
    if (value.kind === 'present' && !['present', 'program'].includes(value.operation)) {
        throw new TypeError(label + '.operation does not match a present pass');
    }
    if (!Array.isArray(value.reads) || value.reads.length > AMBIENT_RUNTIME_V3_LIMITS.maxPassEdges
        || !Array.isArray(value.writes) || value.writes.length > AMBIENT_RUNTIME_V3_LIMITS.maxPassEdges) {
        throw new RangeError(label + ' exceeds the bounded pass edge count');
    }
    const reads = new Set();
    for (const edge of value.reads) {
        assertPlainObject(edge, label + '.reads[]');
        assertExactKeys(edge, READ_KEYS, label + '.reads[]');
        const resource = resourcesById.get(edge.resourceId);
        if (!resource) throw new TypeError(label + ' reads an unknown resource');
        boundedInteger(edge.historyOffset, 0, resource.historyLength - 1, label + '.reads[].historyOffset');
        if (edge.historyOffset > 0 && resource.lifetime !== 'persistent') {
            throw new TypeError(label + ' history reads require a persistent resource');
        }
        const key = edge.resourceId + ':' + edge.historyOffset;
        if (reads.has(key)) throw new TypeError(label + ' repeats a read edge');
        reads.add(key);
        referencedResources.add(edge.resourceId);
    }
    const writes = new Set();
    for (const edge of value.writes) {
        assertPlainObject(edge, label + '.writes[]');
        assertExactKeys(edge, WRITE_KEYS, label + '.writes[]');
        const resource = resourcesById.get(edge.resourceId);
        if (!resource) throw new TypeError(label + ' writes an unknown resource');
        if (writes.has(edge.resourceId)) throw new TypeError(label + ' repeats a write edge');
        if (resource.kind === 'texture-2d' && reads.has(edge.resourceId + ':0')) {
            throw new TypeError(label + ' cannot sample and write the same current texture');
        }
        writes.add(edge.resourceId);
        referencedResources.add(edge.resourceId);
    }
    if (value.kind === 'present' && value.writes.length !== 0) throw new TypeError(label + ' present pass cannot write a plan resource');
    if (value.kind !== 'present' && value.writes.length === 0) throw new TypeError(label + ' requires an output resource');
    if (value.kind === 'copy' && (value.reads.length !== 1 || value.writes.length !== 1)) {
        throw new TypeError(label + ' copy pass requires one read and one write');
    }
}

function validateBoundedForLoops(source) {
    const recognized = [...source.matchAll(
        /\bfor\s*\(\s*var\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\d+)u?\s*;\s*\1\s*<\s*(\d+)u?\s*;\s*\1\s*\+=\s*(\d+)u?\s*\)/g,
    )];
    const total = (source.match(/\bfor\s*\(/g) ?? []).length;
    if (recognized.length !== total) {
        return programFailure('AMBIENT_RUNTIME_V3_PROGRAM_FORBIDDEN', 'Ambient V3 for-loops require literal increasing bounds.');
    }
    for (const loop of recognized) {
        const start = Number(loop[2]);
        const end = Number(loop[3]);
        const step = Number(loop[4]);
        const iterations = step > 0 ? Math.ceil(Math.max(0, end - start) / step) : Infinity;
        if (!Number.isSafeInteger(iterations) || iterations > AMBIENT_RUNTIME_V3_LIMITS.maxLoopIterations) {
            return programFailure(
                'AMBIENT_RUNTIME_V3_PROGRAM_FORBIDDEN',
                'Ambient V3 for-loops are limited to ' + AMBIENT_RUNTIME_V3_LIMITS.maxLoopIterations + ' iterations.',
            );
        }
    }
    return Object.freeze({ ok: true, source, code: null, message: '' });
}

function balancedDelimiters(source) {
    const stack = [];
    const pairs = { ')': '(', ']': '[', '}': '{' };
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    for (let index = 0; index < source.length; index++) {
        const char = source[index];
        const next = source[index + 1];
        if (lineComment) {
            if (char === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (char === '*' && next === '/') { blockComment = false; index++; }
            continue;
        }
        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = null;
            continue;
        }
        if (char === '/' && next === '/') { lineComment = true; index++; continue; }
        if (char === '/' && next === '*') { blockComment = true; index++; continue; }
        if (char === '"' || char === "'") { quote = char; continue; }
        if ('([{'.includes(char)) stack.push(char);
        else if (')]}'.includes(char) && stack.pop() !== pairs[char]) return false;
    }
    return !quote && !blockComment && stack.length === 0;
}

function assertSortedUniqueStrings(value, allowed, label) {
    if (!Array.isArray(value) || value.length < 1) throw new TypeError(label + ' must be a non-empty array');
    const seen = new Set();
    let previous = null;
    for (const item of value) {
        if (typeof item !== 'string' || !allowed.has(item)) throw new TypeError(label + ' contains an unsupported value');
        if (seen.has(item)) throw new TypeError(label + ' contains a duplicate value');
        if (previous !== null && previous.localeCompare(item) > 0) throw new TypeError(label + ' must be sorted');
        previous = item;
        seen.add(item);
    }
}

function assertId(value, label) {
    if (!ID_PATTERN.test(String(value ?? '')) || String(value).length > 96) throw new TypeError(label + ' is invalid');
}

function boundedText(value, minimum, maximum, label) {
    if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
        throw new TypeError(label + ' has an invalid length');
    }
}

function boundedNumber(value, minimum, maximum, label) {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new RangeError(label + ' is outside the supported range');
    }
}

function boundedInteger(value, minimum, maximum, label) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new RangeError(label + ' is outside the supported integer range');
    }
}

function vector4(value, fallback) {
    if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return [...fallback];
    return [value[0], value[1], value[2], value[3]];
}

function finiteClamped(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function flag(value) {
    return value === true || Number(value) > 0 ? 1 : 0;
}

function f32Integer(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(16_777_215, Math.max(0, Math.floor(number)));
}

function assertPlainObject(value, label) {
    if (!isPlainObject(value)) throw new TypeError(label + ' must be a plain object');
}

function assertExactKeys(value, expected, label) {
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
        throw new TypeError(label + ' contains unknown or missing fields');
    }
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function typedError(code, message) {
    const error = new TypeError(message);
    error.code = code;
    return error;
}

function programFailure(code, message) {
    return Object.freeze({ ok: false, source: null, code, message });
}

function failure(code, message) {
    return Object.freeze({ ok: false, plan: null, execution: null, code, message });
}
