// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Shared fail-closed contract for Ambient Studio's pure PaintShader source. */

import { finiteAmbientWaterCompilerFallback } from './AmbientFiniteWaterContract.js';

export const AMBIENT_PROGRAM_MAX_SOURCE_BYTES = 64 * 1024;
export const AMBIENT_PROGRAM_PLAN_SCHEMA = 'particle-realms.ambient-plan.v1';
export const AMBIENT_PROGRAM_UNIFORM_BYTES = 64;

export function validateAmbientProgramSource(value) {
    const source = String(value ?? '').trim();
    if (!source) return failure('AMBIENT_PROGRAM_EMPTY', 'Wallpaper shader code is empty.');
    if (new TextEncoder().encode(source).byteLength > AMBIENT_PROGRAM_MAX_SOURCE_BYTES) {
        return failure('AMBIENT_PROGRAM_TOO_LARGE', 'Wallpaper shader code exceeds 64 KiB.');
    }
    if (!/\bfn\s+paintShader\s*\(\s*color\s*:\s*vec4f\s*,\s*uv\s*:\s*vec2f\s*,\s*depth\s*:\s*f32\s*,\s*time\s*:\s*f32\s*\)\s*->\s*vec4f\b/.test(source)) {
        return failure('AMBIENT_PROGRAM_CONTRACT', 'Define fn paintShader(color: vec4f, uv: vec2f, depth: f32, time: f32) -> vec4f.');
    }
    const forbidden = [
        [/@(?:vertex|fragment|compute)\b/, 'shader entry points'],
        [/@group\s*\(/, 'bind groups'],
        [/@binding\s*\(/, 'bindings'],
        [/var\s*<\s*(?:storage|workgroup|uniform)/, 'storage, workgroup, or uniform variables'],
        [/\b(?:enable|requires)\s+/, 'shader extensions'],
        [/\b(?:loop|while)\s*(?:\{|\()/, 'unbounded loops'],
        [/\b(?:textureStore|workgroupBarrier|storageBarrier)\s*\(/, 'storage side effects'],
    ];
    for (const [pattern, feature] of forbidden) {
        if (pattern.test(source)) return failure('AMBIENT_PROGRAM_FORBIDDEN', `Wallpaper shaders cannot declare ${feature}.`);
    }
    const loopResult = validateBoundedForLoops(source);
    if (!loopResult.ok) return loopResult;
    return Object.freeze({ ok: true, source });
}

/** Assemble the OS-owned entry points around one validated pure function. */
export function buildAmbientProgramSource(authoredSource, contentHash = '') {
    const checked = validateAmbientProgramSource(authoredSource);
    if (!checked.ok) throw typedError(checked.code, checked.message);
    const projectLabel = /^sha256:[a-f0-9]{64}$/.test(String(contentHash)) ? `\n// Project ${contentHash}` : '';
    return `// particle-realms.ambient-program-harness.v1${projectLabel}
${checked.source}${finiteAmbientWaterCompilerFallback(checked.source, 'program') ? '\n' + finiteAmbientWaterCompilerFallback(checked.source, 'program') : ''}

struct AmbientUniforms {
  viewportTime: vec4f,
  pointer: vec4f,
  tone: vec4f,
  background: vec4f,
}
@group(0) @binding(0) var<uniform> ambientUniforms: AmbientUniforms;
struct AmbientVertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}
@vertex fn ambientVertex(@builtin(vertex_index) vertexIndex: u32) -> AmbientVertexOut {
  let position = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0))[vertexIndex];
  var output: AmbientVertexOut;
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = position * 0.5 + vec2f(0.5);
  return output;
}
@fragment fn ambientFragment(input: AmbientVertexOut) -> @location(0) vec4f {
  let viewport = max(ambientUniforms.viewportTime.xy, vec2f(1.0));
  let aspect = viewport.x / viewport.y;
  let elapsed = ambientUniforms.viewportTime.z;
  let shaderTime = elapsed * ambientUniforms.tone.x;
  let screenUv = input.uv;
  let shaderUv = vec2f((screenUv.x - 0.5) * aspect + 0.5, screenUv.y);
  let drift = vec2f(cos(shaderTime * 0.17), sin(shaderTime * 0.13)) * 0.16;
  let fieldDelta = vec2f((screenUv.x - 0.5) * aspect, screenUv.y - 0.5) - drift;
  let field = exp(-dot(fieldDelta, fieldDelta) * 2.8);
  let pointerDelta = vec2f((screenUv.x - ambientUniforms.pointer.x) * aspect, screenUv.y - ambientUniforms.pointer.y);
  let pointerGlow = exp(-dot(pointerDelta, pointerDelta) * 18.0) * ambientUniforms.pointer.z * ambientUniforms.pointer.w;
  let baseRgb = ambientUniforms.background.rgb + vec3f(0.05, 0.16, 0.20) * field + vec3f(0.18, 0.42, 0.38) * pointerGlow;
  let depth = clamp(1.0 - length(fieldDelta), 0.0, 1.0);
  let authored = paintShader(vec4f(baseRgb, 1.0), shaderUv, depth, shaderTime);
  var rgb = mix(baseRgb, authored.rgb, clamp(authored.a, 0.0, 1.0));
  rgb *= exp2(ambientUniforms.tone.z) * ambientUniforms.tone.y;
  let luminance = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
  rgb = mix(vec3f(luminance), rgb, ambientUniforms.tone.w);
  return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), 1.0);
}`;
}

function validateBoundedForLoops(source) {
    const loops = [...source.matchAll(/\bfor\s*\(\s*var\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\d+)u?\s*;\s*\1\s*<\s*(\d+)u?\s*;\s*\1\s*\+=\s*(\d+)u?\s*\)/g)];
    const total = (source.match(/\bfor\s*\(/g) ?? []).length;
    if (loops.length !== total) {
        return failure('AMBIENT_PROGRAM_FORBIDDEN', 'Wallpaper shader loops require a literal increasing bound.');
    }
    for (const loop of loops) {
        const start = Number(loop[2]);
        const end = Number(loop[3]);
        const step = Number(loop[4]);
        const iterations = step > 0 ? Math.ceil(Math.max(0, end - start) / step) : Infinity;
        if (!Number.isSafeInteger(iterations) || iterations > 96) {
            return failure('AMBIENT_PROGRAM_FORBIDDEN', 'Wallpaper shader loops are limited to 96 iterations.');
        }
    }
    return Object.freeze({ ok: true });
}

function failure(code, message) {
    return Object.freeze({ ok: false, code, message });
}

function typedError(code, message) {
    const error = new TypeError(message);
    error.code = code;
    return error;
}
