// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { assertAmbientNativeAppearanceFunctions, extractAmbientWgslFunctions } from '../../../../kernel/schema/AmbientNativeAppearance.js';

export const SPATIAL_WATER_FOAM_VERSION = 1;
export const SPATIAL_WATER_FOAM_SOURCE = `
fn spatialFoamProduction(compression:f32,breaking:f32,height:f32,time:f32,settings:vec4f)->f32 {
 return settings.x*smoothstep(settings.y,settings.y+.12,max(0.0,compression));
}
fn spatialFoamTransport(current:vec2f,time:f32,drift:vec2f)->vec2f {return current+drift;}
fn spatialFoamDecay(coverage:f32,dt:f32,time:f32,lifetime:f32)->f32 {return coverage*exp(-dt/max(.05,lifetime));}
fn spatialFoamImpact(distance:f32,radius:f32,amount:f32,time:f32)->f32 {
 return waterFoamFiniteImpact(distance,radius,amount);
}`;

const signatures = [
    'spatialFoamProduction(compression:f32,breaking:f32,height:f32,time:f32,settings:vec4f)->f32',
    'spatialFoamTransport(current:vec2f,time:f32,drift:vec2f)->vec2f',
    'spatialFoamDecay(coverage:f32,dt:f32,time:f32,lifetime:f32)->f32',
    'spatialFoamImpact(distance:f32,radius:f32,amount:f32,time:f32)->f32',
];
export function normalizeSpatialWaterFoamSource(source) {
    if (typeof source !== 'string' || source.length > 16384) throw new TypeError('Water foam requires bounded saved function source.');
    assertAmbientNativeAppearanceFunctions(source);
    const functions = extractAmbientWgslFunctions(source);
    for (const signature of signatures) {
        const name = signature.slice(0, signature.indexOf('('));
        const fn = functions.find(value => value.name === name);
        if (!fn || fn.signature.replace(/\s+/g, '') !== `fn${signature}`) throw new TypeError(`Water foam requires ${signature}.`);
    }
    return source;
}

export const SPATIAL_WATER_FOAM_FIELDS = Object.freeze(['foamVersion', 'foamSourceWGSL', 'foamStrength', 'foamProduction', 'foamThreshold', 'foamLifetime', 'foamDriftX', 'foamDriftZ', 'foamImpactGain']);
export const SPATIAL_WATER_RESPONSE_SOURCE = 'fn spatialWaterContactAmount(kind:f32,strength:f32,time:f32,controls:vec4f)->f32{return max(0.0,strength)*select(controls.x,controls.y,kind>1.5);}';
export const SPATIAL_WATER_RESPONSE_FIELDS = Object.freeze(['waterResponseVersion', 'waterResponseSourceWGSL', 'waterClickGain', 'waterClickRadius', 'waterPointerGain']);
export function normalizeSpatialWaterResponseSource(source) {
    if (typeof source !== 'string' || source.length > 8192) throw new TypeError('Water response requires bounded saved source.');
    assertAmbientNativeAppearanceFunctions(source);
    const fn = extractAmbientWgslFunctions(source).find(value => value.name === 'spatialWaterContactAmount');
    if (!fn || fn.signature.replace(/\s+/g, '') !== 'fnspatialWaterContactAmount(kind:f32,strength:f32,time:f32,controls:vec4f)->f32') throw new TypeError('Invalid water contact response signature.');
    return source;
}
