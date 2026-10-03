// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { extractAmbientWgslFunctions } from './AmbientNativeAppearance.js';
import { WATER_FOAM_KERNELS_WGSL } from '../../../engine/render/water/WaterFoamKernels.js';

export const FINITE_WATER_RUNTIME_BEGIN = '/*@ambient-finite-runtime-begin*/';
export const FINITE_WATER_RUNTIME_END = '/*@ambient-finite-runtime-end*/';

/** Only a parsed saved declaration opts into the additional host resources. */
export function hasFiniteAmbientWaterState(source) {
    const fn = extractAmbientWgslFunctions(String(source ?? '')).find(value => value.name === 'ambientFiniteWaterStateVersion');
    if (!fn) return false;
    if (fn.signature.replace(/\s/g, '') !== 'fnambientFiniteWaterStateVersion()->u32' || !/^\s*return\s+1u\s*;\s*$/.test(fn.body)) {
        throw new TypeError('Unsupported saved finite water state version.');
    }
    return true;
}

/** Standalone compiler diagnostics remain valid without allocating resources.
 * Actual hosts replace this explicitly delimited ABI block with derived GPU
 * sampling. These names belong to the host, like its frame binding. */
export function finiteAmbientWaterCompilerFallback(source, flavor) {
    if (!hasFiniteAmbientWaterState(source)) return '';
    const names = new Set(extractAmbientWgslFunctions(source).map(value => value.name));
    for (const name of ['ambientFiniteSharedField', 'ambientFiniteWaterCoverage', 'ambientFiniteWaterFrame']) {
        if (names.has(name)) throw new TypeError(`Saved source redeclares host water helper ${name}.`);
    }
    return `${FINITE_WATER_RUNTIME_BEGIN}
${WATER_FOAM_KERNELS_WGSL}
fn ambientFiniteSharedField(q:vec2f,time:f32,footprint:f32)->WaterFieldSample {
 var field:WaterFieldSample;field.tangentX=vec3f(1,0,0);field.tangentZ=vec3f(0,0,1);field.normal=vec3f(0,1,0);field.jacobian=1.;field.sourceCoordinate=q;field.position=vec3f(q.x,0,q.y);return field;
}
fn ambientFiniteWaterCoverage(q:vec2f,time:f32,footprint:f32)->f32{return 0.;}
${flavor === 'v3' ? 'fn ambientFiniteWaterFrame()->AmbientV3Frame{return ambientV3Frame;}' : ''}
${FINITE_WATER_RUNTIME_END}`;
}
