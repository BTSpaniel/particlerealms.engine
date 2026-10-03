// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { mulberry32, weightedRandom, shuffle } from '../../core/math/MathRandom.js';
import { EARTH_GRAVITY, TAU } from '../../core/math/MathConstants.js';
import { clamp, smoothstep } from '../../core/math/MathScalar.js';
import { WATER_FIELD_TYPES_WGSL, WATER_FIELD_SAMPLE_WGSL } from './WaterFieldShaders.js';

/** A finite directional wind spectrum, evaluated directly rather than by FFT.
 * Generation is separate from evaluation: the explicit saved modes are the
 * authority after generation. Units are metres, radians and seconds.
 */
export const OCEAN_SPECTRUM_MODEL = 'finite-wind-spectrum-v1';
export const OCEAN_SPECTRUM_MAX_MODES = 64;
const MAX_HORIZONTAL_STEEPNESS = 0.80;

function bounded(value, name, minimum, maximum) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
        throw new RangeError(`Ocean spectrum ${name} must be finite in [${minimum}, ${maximum}].`);
    }
    return value;
}

/** Generate explicit modes by finite-spectrum quadrature with seeded phase.
 * Logarithmic wavenumber bands include the polar k² integration measure. Each
 * integrated band shares its energy among several stratified directions, so a
 * random coefficient cannot turn a broad wind spectrum into one dominant wave.
 * Total variance is normalized to the requested significant height. These are
 * generated defaults only; saved explicit modes remain the evaluation authority.
 */
export function generateOceanSpectrum(settings = {}) {
    const seed = settings.seed ?? 5471;
    const modeCount = settings.modeCount ?? 48;
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Ocean spectrum seed must be a uint32.');
    if (!Number.isSafeInteger(modeCount) || modeCount < 8 || modeCount > OCEAN_SPECTRUM_MAX_MODES) throw new RangeError('Ocean spectrum modeCount must be an integer in [8, 64].');
    const significantWaveHeight = bounded(settings.significantWaveHeight ?? 0.8, 'significantWaveHeight', 0, 20);
    const windSpeed = bounded(settings.windSpeed ?? 9, 'windSpeed', 0.5, 60);
    const windDirection = bounded(settings.windDirection ?? 0.15, 'windDirection', -TAU, TAU);
    const directionalSpread = bounded(settings.directionalSpread ?? 0.65, 'directionalSpread', 0, 1);
    const minimumWavelength = bounded(settings.minimumWavelength ?? 0.35, 'minimumWavelength', 0.1, 100);
    const maximumWavelength = bounded(settings.maximumWavelength ?? 80, 'maximumWavelength', 1, 1000);
    if (minimumWavelength >= maximumWavelength) throw new RangeError('Ocean spectrum wavelengths must increase.');
    const depth = bounded(settings.depth ?? 60, 'depth', 0.25, 10000);
    const choppiness = bounded(settings.choppiness ?? 0.8, 'choppiness', 0, 2);
    const damping = bounded(settings.shortWaveDamping ?? 0.035, 'shortWaveDamping', 0, 1);
    const rng = mulberry32(seed);
    const windLength = windSpeed * windSpeed / EARTH_GRAVITY;
    const minimumK = TAU / maximumWavelength;
    const logRange = Math.log(maximumWavelength / minimumWavelength);
    const spreadPower = 16 - directionalSpread * 14.7;
    const bandCount = Math.max(2, Math.floor(modeCount / 4));
    const bandWidth = logRange / bandCount;
    const quadratureBins = 64;
    const bands = [];
    let largestLogWeight = -Infinity;
    for (let band = 0; band < bandCount; band += 1) {
        const logs = Array.from({ length: quadratureBins }, (_, bin) => {
            const k = minimumK * Math.exp((band + (bin + .5) / quadratureBins) * bandWidth);
            const weight = -1 / ((k * windLength) ** 2) - 2 * Math.log(k) - (k * damping) ** 2;
            largestLogWeight = Math.max(largestLogWeight, weight);
            return weight;
        });
        bands.push(logs);
    }
    // Reuse engine weighted selection as a discrete inverse CDF. The fine bins
    // approximate continuous radial/directional density; quantile strata give
    // each band several directions instead of weighting one random direction.
    const directionBins = 256;
    const directionWeights = Array.from({ length: directionBins }, (_, bin) => {
        const angle = ((bin + .5) / directionBins * 2 - 1) * Math.PI;
        return .025 + .975 * Math.pow(Math.max(0, (1 + Math.cos(angle)) * .5), spreadPower);
    });
    const modes = [];
    for (let band = 0; band < bandCount; band += 1) {
        const weights = bands[band].map(weight => Math.exp(weight - largestLogWeight));
        const bandEnergy = weights.reduce((sum, weight) => sum + weight, 0) * bandWidth / quadratureBins;
        const count = Math.floor(modeCount / bandCount) + (band < modeCount % bandCount ? 1 : 0);
        const directions = shuffle(Array.from({ length: count }, (_, index) => index), rng);
        for (let index = 0; index < count; index += 1) {
            const radialBin = weightedRandom(weights, () => (index + rng()) / count);
            const k = minimumK * Math.exp((band + (radialBin + rng()) / quadratureBins) * bandWidth);
            const directionBin = weightedRandom(directionWeights, () => (directions[index] + rng()) / count);
            const angle = windDirection + ((directionBin + rng()) / directionBins * 2 - 1) * Math.PI;
            modes.push({ kx: k * Math.cos(angle), kz: k * Math.sin(angle), amplitude: Math.sqrt(2 * bandEnergy / count),
                phase: rng() * TAU, omega: Math.sqrt(EARTH_GRAVITY * k * Math.tanh(k * depth)), horizontalAmplitude: 0 });
        }
    }
    const variance = modes.reduce((sum, mode) => sum + mode.amplitude * mode.amplitude * .5, 0);
    const normalization = significantWaveHeight / (4 * Math.sqrt(Math.max(variance, Number.MIN_VALUE)));
    let steepness = 0;
    for (const mode of modes) {
        mode.amplitude *= normalization;
        steepness += Math.hypot(mode.kx, mode.kz) * mode.amplitude;
    }
    const actualChoppiness = Math.min(choppiness, MAX_HORIZONTAL_STEEPNESS / Math.max(steepness, 1e-12));
    for (const mode of modes) mode.horizontalAmplitude = mode.amplitude * actualChoppiness;
    return normalizeOceanSpectrum({ version: 1, model: OCEAN_SPECTRUM_MODEL,
        settings: { seed, modeCount, significantWaveHeight, windSpeed, windDirection, directionalSpread,
            minimumWavelength, maximumWavelength, depth, choppiness, shortWaveDamping: damping }, modes });
}

/** Validate and copy saved modes without regenerating them from their metadata. */
export function normalizeOceanSpectrum(value) {
    if (!value || value.version !== 1 || value.model !== OCEAN_SPECTRUM_MODEL) throw new TypeError('Unsupported ocean spectrum model.');
    if (!Array.isArray(value.modes) || value.modes.length > OCEAN_SPECTRUM_MAX_MODES) throw new RangeError('Ocean spectrum requires at most 64 explicit modes.');
    let horizontalSteepness = 0;
    const modes = value.modes.map((mode, index) => {
        const kx = bounded(mode?.kx, `mode ${index} kx`, -TAU * 10, TAU * 10);
        const kz = bounded(mode?.kz, `mode ${index} kz`, -TAU * 10, TAU * 10);
        const k = Math.hypot(kx, kz);
        if (k < TAU / 1000 || k > TAU * 10 + 1e-8) throw new RangeError('Ocean spectrum mode wavelength is outside [0.1, 1000] metres.');
        const amplitude = bounded(mode.amplitude, `mode ${index} amplitude`, 0, 20);
        const phase = bounded(mode.phase, `mode ${index} phase`, -TAU * 100, TAU * 100);
        const omega = bounded(mode.omega, `mode ${index} omega`, 0, 100);
        const horizontalAmplitude = bounded(mode.horizontalAmplitude, `mode ${index} horizontalAmplitude`, 0, 20);
        horizontalSteepness += k * horizontalAmplitude;
        return Object.freeze({ kx, kz, amplitude, phase, omega, horizontalAmplitude });
    });
    if (horizontalSteepness > MAX_HORIZONTAL_STEEPNESS + 1e-7) throw new RangeError('Ocean horizontal displacement exceeds the invertible steepness bound.');
    // Settings are optional provenance, never the evaluator's hidden authority.
    const settings = value.settings === undefined ? undefined : Object.freeze({ ...value.settings });
    return Object.freeze({ version: 1, model: OCEAN_SPECTRUM_MODEL, ...(settings ? { settings } : {}),
        modes: Object.freeze(modes), horizontalSteepness });
}

function controlsFor(spectrum, controls) {
    const settings = spectrum.settings ?? {};
    return {
        heightScale: bounded(controls.heightScale ?? 1, 'heightScale', 0, 8),
        windSpeed: bounded(controls.windSpeed ?? settings.windSpeed ?? 9, 'windSpeed', 0.5, 60),
        direction: bounded(controls.direction ?? settings.windDirection ?? 0.15, 'direction', -TAU, TAU),
        depth: bounded(controls.depth ?? settings.depth ?? 60, 'depth', 0.25, 10000),
        choppiness: bounded(controls.choppiness ?? settings.choppiness ?? 0.8, 'choppiness', 0, 2),
        baseWind: bounded(settings.windSpeed ?? 9, 'base windSpeed', 0.5, 60),
        baseDirection: bounded(settings.windDirection ?? 0.15, 'base direction', -TAU, TAU),
        baseDepth: bounded(settings.depth ?? 60, 'base depth', 0.25, 10000),
        baseChoppiness: bounded(settings.choppiness ?? 0.8, 'base choppiness', 0, 2),
    };
}

function adjustedModes(spectrum, controls) {
    const angle = controls.direction - controls.baseDirection, cosine = Math.cos(angle), sine = Math.sin(angle);
    let steepness = 0;
    const modes = spectrum.modes.map(mode => {
        const k = Math.hypot(mode.kx, mode.kz);
        const baseLength = controls.baseWind ** 2 / EARTH_GRAVITY, windLength = controls.windSpeed ** 2 / EARTH_GRAVITY;
        // Reweight the saved coefficients, preserving their phases and edits.
        // A bounded gain keeps abrupt weather changes finite without reseeding.
        const gain = Math.exp(clamp(0.5 * (1 / (k * baseLength) ** 2 - 1 / (k * windLength) ** 2), -Math.log(4), Math.log(4)));
        const amplitude = mode.amplitude * controls.heightScale * gain;
        const authoredHorizontal = controls.baseChoppiness > 0 ? mode.horizontalAmplitude / controls.baseChoppiness : mode.amplitude;
        const horizontalAmplitude = authoredHorizontal * controls.heightScale * gain * controls.choppiness;
        steepness += k * horizontalAmplitude;
        return { ...mode, kx: mode.kx * cosine - mode.kz * sine, kz: mode.kx * sine + mode.kz * cosine,
            amplitude, horizontalAmplitude, omega: mode.omega * Math.sqrt(Math.tanh(k * controls.depth) / Math.max(Math.tanh(k * controls.baseDepth), 0.00001)) };
    });
    const bound = Math.min(1, MAX_HORIZONTAL_STEEPNESS / Math.max(steepness, 0.00001));
    for (const mode of modes) mode.horizontalAmplitude *= bound;
    return modes;
}

function evaluate(modes, point, time, footprint, gradients = null) {
    const displacement = [0, 0, 0], tangentX = [1, 0, 0], tangentZ = [0, 0, 1], velocity = [0, 0, 0];
    let unresolvedVariance = 0;
    for (const mode of modes) {
        const k = Math.hypot(mode.kx, mode.kz), dx = mode.kx / k, dz = mode.kz / k;
        const phaseFootprint = gradients
            ? Math.max(Math.abs(mode.kx * gradients[0][0] + mode.kz * gradients[0][1]), Math.abs(mode.kx * gradients[1][0] + mode.kz * gradients[1][1]))
            : k * footprint;
        const resolved = 1 - smoothstep(0.55, 2.2, phaseFootprint);
        unresolvedVariance += 0.5 * (mode.amplitude * k) ** 2 * (1 - resolved * resolved);
        if (resolved <= 0) continue;
        const phase = mode.kx * point[0] + mode.kz * point[1] - mode.omega * time + mode.phase;
        const sine = Math.sin(phase), cosine = Math.cos(phase);
        const vertical = mode.amplitude * resolved, horizontal = mode.horizontalAmplitude * resolved;
        displacement[0] += horizontal * dx * cosine; displacement[1] += vertical * sine; displacement[2] += horizontal * dz * cosine;
        tangentX[0] -= horizontal * dx * mode.kx * sine; tangentX[1] += vertical * mode.kx * cosine; tangentX[2] -= horizontal * dz * mode.kx * sine;
        tangentZ[0] -= horizontal * dx * mode.kz * sine; tangentZ[1] += vertical * mode.kz * cosine; tangentZ[2] -= horizontal * dz * mode.kz * sine;
        velocity[0] += horizontal * dx * mode.omega * sine; velocity[1] -= vertical * mode.omega * cosine; velocity[2] += horizontal * dz * mode.omega * sine;
    }
    const normal = [tangentZ[1] * tangentX[2] - tangentZ[2] * tangentX[1],
        tangentZ[2] * tangentX[0] - tangentZ[0] * tangentX[2], tangentZ[0] * tangentX[1] - tangentZ[1] * tangentX[0]];
    const length = Math.hypot(...normal);
    for (let axis = 0; axis < 3; axis += 1) normal[axis] /= length;
    const jacobian = tangentX[0] * tangentZ[2] - tangentZ[0] * tangentX[2];
    return { displacement, tangentX, tangentZ, normal, velocity, jacobian, unresolvedVariance,
        sourceCoordinate: [...point], position: [point[0] + displacement[0], displacement[1], point[1] + displacement[2]], residual: 0 };
}

function sampleInputs(point, time, footprint) {
    if ((!Array.isArray(point) && !ArrayBuffer.isView(point)) || point.length !== 2) throw new TypeError('Ocean sample point must have two coordinates.');
    bounded(point[0], 'sample x', -1e6, 1e6); bounded(point[1], 'sample z', -1e6, 1e6);
    bounded(time, 'sample time', -1e6, 1e6); bounded(footprint, 'sample footprint', 0, 10000);
}

/** Parameter-domain query for mesh vertices. Position is q + displacement. */
export function sampleOceanSpectrum(spectrum, point, time, footprint = 0, controls = {}) {
    sampleInputs(point, time, footprint);
    return evaluate(adjustedModes(spectrum, controlsFor(spectrum, controls)), point, time, footprint);
}

/** Pixel-domain query using the projected phase derivative of each wave. A
 * long grazing footprint must not erase waves resolved across its short axis.
 * Derivatives are held constant while evaluating the analytic surface tangents.
 */
export function sampleOceanSpectrumGrad(spectrum, point, time, dx, dy, controls = {}) {
    sampleInputs(point, time, 0);
    for (const [label, value] of [['dx', dx], ['dy', dy]]) {
        if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== 2) throw new TypeError(`Ocean ${label} must have two coordinates.`);
        bounded(value[0], `${label} x`, -10000, 10000); bounded(value[1], `${label} z`, -10000, 10000);
    }
    return evaluate(adjustedModes(spectrum, controlsFor(spectrum, controls)), point, time, 0, [dx, dy]);
}

/** Invert the horizontal map before querying a world-XZ collision/foam point.
 * The globally bounded displacement derivative keeps this map one-to-one. A
 * bounded Newton solve exposes its residual rather than concealing precision.
 */
export function sampleOceanSpectrumWorld(spectrum, worldXZ, time, footprint = 0, controls = {}) {
    sampleInputs(worldXZ, time, footprint);
    const modes = adjustedModes(spectrum, controlsFor(spectrum, controls));
    const q = [...worldXZ];
    for (let iteration = 0; iteration < 8; iteration += 1) {
        const sample = evaluate(modes, q, time, footprint);
        const rx = sample.position[0] - worldXZ[0], rz = sample.position[2] - worldXZ[1];
        if (rx * rx + rz * rz <= 1e-12) break;
        const determinant = Math.max(sample.jacobian, 0.04);
        q[0] -= clamp((sample.tangentZ[2] * rx - sample.tangentZ[0] * rz) / determinant, -20, 20);
        q[1] -= clamp((-sample.tangentX[2] * rx + sample.tangentX[0] * rz) / determinant, -20, 20);
    }
    const sample = evaluate(modes, q, time, footprint);
    sample.residual = Math.hypot(sample.position[0] - worldXZ[0], sample.position[2] - worldXZ[1]);
    return sample;
}

/** Trusted value-only ABI. Callers own their resources and saved function code. */
export const OCEAN_SPECTRUM_TYPES_WGSL = /* wgsl */`
struct OceanSpectrumSample {
 displacement: vec3f,
 tangentX: vec3f,
 tangentZ: vec3f,
 normal: vec3f,
 velocity: vec3f,
 jacobian: f32,
 unresolvedVariance: f32,
 sourceCoordinate: vec2f,
 position: vec3f,
 residual: f32,
}
`;

/** Resource-free sampling uses the same value ABI and covariance pullback as
 * the texture cache. Default source generation below remains byte-identical. */
export const OCEAN_SPECTRUM_WATER_FIELD_TYPES_WGSL = WATER_FIELD_TYPES_WGSL.match(/struct WaterFieldSample\s*\{[^]*?\n\}/)?.[0];
const WATER_FIELD_FINISH_WGSL = WATER_FIELD_SAMPLE_WGSL.match(/fn waterFieldFinish\([^]*?\n\}/)?.[0];
if (!OCEAN_SPECTRUM_WATER_FIELD_TYPES_WGSL || !WATER_FIELD_FINISH_WGSL) throw new Error('Canonical water sample source is unavailable.');

/** Generate function-only, resource-free source from the explicit saved modes.
 * Save this source with the graph; reopening must not regenerate custom code.
 */
export function createOceanSpectrumWGSL(value, expressions = {}, options = {}) {
    if (options.waterFieldSample !== undefined && typeof options.waterFieldSample !== 'boolean') throw new TypeError('waterFieldSample must be boolean.');
    const spectrum = normalizeOceanSpectrum(value);
    const defaults = controlsFor(spectrum, {});
    const number = value => `${Number(value).toPrecision(17)}${Number(value).toPrecision(17).includes('.') || Number(value).toPrecision(17).includes('e') ? '' : '.0'}`;
    const expression = name => {
        const source = expressions[name] ?? number(defaults[name]);
        if (typeof source !== 'string' || source.length > 240 || /[;{}\n\r]/.test(source.replace(/\{\{param:[A-Za-z_]\w*\}\}/g, '0.0'))) throw new TypeError(`Ocean ${name} requires one bounded numeric source expression.`);
        return source;
    };
    const current = expressions.current ?? 'vec2f(0.0)';
    if (options.waterFieldSample && (typeof current !== 'string' || current.length > 240 || /[;{}\n\r]/.test(current.replace(/\{\{param:[A-Za-z_]\w*\}\}/g, '0.0')))) throw new TypeError('Ocean current requires one bounded vec2f source expression.');
    const timeScale = expressions.timeScale ?? '1.0';
    if (options.waterFieldSample && (typeof timeScale !== 'string' || timeScale.length > 240 || /[;{}\n\r]/.test(timeScale.replace(/\{\{param:[A-Za-z_]\w*\}\}/g, '0.0')))) throw new TypeError('Ocean timeScale requires one bounded numeric source expression.');
    const cases = spectrum.modes.map((mode, index) => ` case ${index}u: { return mat2x4f(vec4f(${[mode.kx, mode.kz, mode.amplitude, mode.phase].map(number).join(', ')}), vec4f(${number(mode.omega)}, ${number(mode.horizontalAmplitude)}, 0.0, 0.0)); }`).join('\n');
    const source = /* wgsl */`
fn oceanSpectrumMode(index: u32) -> mat2x4f {
 switch index {
${cases}
 default: { return mat2x4f(vec4f(0.0), vec4f(0.0)); }
 }
}

fn oceanSpectrumControls() -> mat2x4f {
 return mat2x4f(vec4f(clamp(${expression('heightScale')}, 0.0, 8.0), clamp(${expression('windSpeed')}, 0.5, 60.0), clamp(${expression('direction')}, -6.28318530718, 6.28318530718), clamp(${expression('depth')}, 0.25, 10000.0)),
  vec4f(clamp(${expression('choppiness')}, 0.0, 2.0), ${number(defaults.baseWind)}, ${number(defaults.baseDirection)}, ${number(defaults.baseDepth)}));
}
fn oceanSpectrumAdjustedMode(index: u32, controls: mat2x4f) -> mat2x4f {
 let mode = oceanSpectrumMode(index); let wave = mode[0]; let dynamics = mode[1]; let k = length(wave.xy);
 if (k <= 0.0) { return mode; }
 let angle = controls[0].z - controls[1].z; let cosine = cos(angle); let sine = sin(angle);
 let baseLength = controls[1].y * controls[1].y / ${number(EARTH_GRAVITY)};
 let windLength = controls[0].y * controls[0].y / ${number(EARTH_GRAVITY)};
 let gain = exp(clamp(0.5 * (1.0 / (k * k * baseLength * baseLength) - 1.0 / (k * k * windLength * windLength)), -1.38629436112, 1.38629436112));
 let height = wave.z * controls[0].x * gain;
 let horizontal = ${defaults.baseChoppiness > 0 ? `dynamics.y / ${number(defaults.baseChoppiness)}` : 'wave.z'} * controls[0].x * gain * controls[1].x;
 let omega = dynamics.x * sqrt(tanh(k * controls[0].w) / max(tanh(k * controls[1].w), 0.00001));
 return mat2x4f(vec4f(wave.x * cosine - wave.y * sine, wave.x * sine + wave.y * cosine, height, wave.w), vec4f(omega, horizontal, 0.0, 0.0));
}
fn oceanSpectrumEvaluate(point: vec2f, time: f32, footprint: vec4f, isotropic: f32) -> OceanSpectrumSample {
 var displacement = vec3f(0.0); var tangentX = vec3f(1.0, 0.0, 0.0); var tangentZ = vec3f(0.0, 0.0, 1.0);
 var velocity = vec3f(0.0); var variance = 0.0;
 let controls = oceanSpectrumControls(); var steepness = 0.0;
 for (var i = 0u; i < ${spectrum.modes.length}u; i += 1u) {
  let mode = oceanSpectrumAdjustedMode(i, controls); steepness += length(mode[0].xy) * mode[1].y;
 }
 let chopBound = min(1.0, 0.80 / max(steepness, 0.00001));
 for (var i = 0u; i < ${spectrum.modes.length}u; i += 1u) {
  let mode = oceanSpectrumAdjustedMode(i, controls); let wave = mode[0]; let dynamics = mode[1];
  let k = length(wave.xy); if (k <= 0.0) { continue; }
  let direction = wave.xy / k;
  let phaseFootprint = mix(max(abs(dot(wave.xy, footprint.xy)), abs(dot(wave.xy, footprint.zw))), k * max(abs(footprint.x), abs(footprint.w)), isotropic);
  let resolved = 1.0 - smoothstep(0.55, 2.2, phaseFootprint);
  variance += 0.5 * wave.z * wave.z * k * k * (1.0 - resolved * resolved);
  if (resolved <= 0.0) { continue; }
  let phase = dot(point, wave.xy) - dynamics.x * time + wave.w;
  let sine = sin(phase); let cosine = cos(phase);
  let vertical = wave.z * resolved; let horizontal = dynamics.y * resolved * chopBound;
  displacement += vec3f(horizontal * direction.x * cosine, vertical * sine, horizontal * direction.y * cosine);
  tangentX += vec3f(-horizontal * direction.x * wave.x * sine, vertical * wave.x * cosine, -horizontal * direction.y * wave.x * sine);
  tangentZ += vec3f(-horizontal * direction.x * wave.y * sine, vertical * wave.y * cosine, -horizontal * direction.y * wave.y * sine);
  velocity += vec3f(horizontal * direction.x * dynamics.x * sine, -vertical * dynamics.x * cosine, horizontal * direction.y * dynamics.x * sine);
 }
 let normal = normalize(cross(tangentZ, tangentX));
 let jacobian = tangentX.x * tangentZ.z - tangentZ.x * tangentX.z;
 return OceanSpectrumSample(displacement, tangentX, tangentZ, normal, velocity, jacobian, variance, point, vec3f(point.x + displacement.x, displacement.y, point.y + displacement.z), 0.0);
}
fn oceanSpectrumSample(point: vec2f, time: f32, footprint: f32) -> OceanSpectrumSample {
 let width = max(footprint, 0.0);
 return oceanSpectrumEvaluate(point, time, vec4f(width, 0.0, 0.0, width), 1.0);
}
fn oceanSpectrumSampleGrad(point: vec2f, time: f32, dx: vec2f, dy: vec2f) -> OceanSpectrumSample {
 return oceanSpectrumEvaluate(point, time, vec4f(dx, dy), 0.0);
}
fn oceanSpectrumWorldSample(worldXZ: vec2f, time: f32, footprint: f32) -> OceanSpectrumSample {
 var q = worldXZ;
 for (var iteration = 0; iteration < 8; iteration += 1) {
  let sample = oceanSpectrumSample(q, time, footprint);
  let residual = sample.position.xz - worldXZ;
  if (dot(residual, residual) <= 0.000000000001) { break; }
  let determinant = max(sample.jacobian, 0.04);
  let step = vec2f(sample.tangentZ.z * residual.x - sample.tangentZ.x * residual.y, -sample.tangentX.z * residual.x + sample.tangentX.x * residual.y) / determinant;
  q -= clamp(step, vec2f(-20.0), vec2f(20.0));
 }
 var result = oceanSpectrumSample(q, time, footprint);
 result.residual = length(result.position.xz - worldXZ);
 return result;
}
`;
    if (!options.waterFieldSample) return source;
    // Add second moments and the derivative of the same horizontal Jacobian in
    // the existing mode loop. There is no second wave family or finite-difference
    // resampling; phase filtering and all saved coefficient authority are shared.
    return WATER_FIELD_FINISH_WGSL + '\n' + source.replaceAll('OceanSpectrumSample', 'WaterFieldSample')
        .replace('var velocity = vec3f(0.0); var variance = 0.0;', 'var velocity=vec3f(0.0);var variance=0.0;var covariance=vec3f(0.0);var tangentRateX=vec3f(0.0);var tangentRateZ=vec3f(0.0);')
        .replace('variance += 0.5 * wave.z * wave.z * k * k * (1.0 - resolved * resolved);', 'let unresolved=0.5*wave.z*wave.z*(1.0-resolved*resolved);variance+=unresolved*k*k;covariance+=unresolved*vec3f(wave.x*wave.x,wave.x*wave.y,wave.y*wave.y);')
        .replace('let phase = dot(point, wave.xy) - dynamics.x * time + wave.w;', `let angularRate=dynamics.x*clamp(${timeScale},0.0,3.0)+dot(wave.xy,${current});
  let phase=dot(point,wave.xy)-angularRate*time+wave.w;`)
        .replace('velocity += vec3f(horizontal * direction.x * dynamics.x * sine, -vertical * dynamics.x * cosine, horizontal * direction.y * dynamics.x * sine);', `velocity+=vec3f(horizontal*direction.x*angularRate*sine,-vertical*angularRate*cosine,horizontal*direction.y*angularRate*sine);
  tangentRateX+=vec3f(horizontal*direction.x*wave.x*angularRate*cosine,vertical*wave.x*angularRate*sine,horizontal*direction.y*wave.x*angularRate*cosine);
  tangentRateZ+=vec3f(horizontal*direction.x*wave.y*angularRate*cosine,vertical*wave.y*angularRate*sine,horizontal*direction.y*wave.y*angularRate*cosine);`)
        .replace('return WaterFieldSample(displacement, tangentX, tangentZ, normal, velocity, jacobian, variance, point, vec3f(point.x + displacement.x, displacement.y, point.y + displacement.z), 0.0);', `let compression=-(tangentRateX.x*tangentZ.z+tangentX.x*tangentRateZ.z-tangentRateZ.x*tangentX.z-tangentZ.x*tangentRateX.z);
 let breaking=(1.0-smoothstep(0.15,0.75,jacobian))*smoothstep(0.0,0.5,max(compression,0.0)+max(displacement.y,0.0));
 return waterFieldFinish(point,displacement,velocity,tangentX-vec3f(1.0,0.0,0.0),tangentZ-vec3f(0.0,0.0,1.0),covariance,breaking,compression,controls[0].w,${current});`);
}
