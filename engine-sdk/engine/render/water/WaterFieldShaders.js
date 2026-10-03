// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const WATER_FIELD_BINDING_ENTRIES = Object.freeze([
    Object.freeze({ binding: 0, visibility: 7, buffer: { type: 'uniform', minBindingSize: 64 } }),
    Object.freeze({ binding: 1, visibility: 7, sampler: { type: 'filtering' } }),
    ...Array.from({ length: 5 }, (_, i) => Object.freeze({ binding: i + 2, visibility: 7,
        texture: { sampleType: 'float', viewDimension: '2d-array', multisampled: false } })),
]);

export const WATER_FIELD_TYPES_WGSL = /* wgsl */`
struct WaterFieldFrame {
 epoch: vec4f, // coherent time, height gain, chop gain, reference height sigma
 quality: vec4u, // resolution, active layers, mip levels, analytic-cache flag
 lengths: vec4f,
 origin: vec4f,
}
struct WaterFieldSourceSample {
 displacement: vec3f,
 tangentX: vec3f,
 tangentZ: vec3f,
 velocity: vec3f,
}
struct WaterFieldSample {
 displacement: vec3f,
 tangentX: vec3f,
 tangentZ: vec3f,
 normal: vec3f,
 velocity: vec3f,
 jacobian: f32,
 unresolvedVariance: f32,
 breakingPotential: f32,
 compressionRate: f32,
 slopeMean: vec2f,
 slopeCovariance: vec3f,
 parameterSlopeCovariance: vec3f,
 depth: f32,
 current: vec2f,
 sourceCoordinate: vec2f,
 position: vec3f,
 residual: f32,
}
`;

export function waterFieldBindingsWGSL(group = 1) {
    if (!Number.isSafeInteger(group) || group < 0 || group > 3) throw new RangeError('Water field bind group must be in [0, 3].');
    return `${WATER_FIELD_TYPES_WGSL}
@group(${group}) @binding(0) var<uniform> waterFieldFrame: WaterFieldFrame;
@group(${group}) @binding(1) var waterFieldSampler: sampler;
@group(${group}) @binding(2) var waterFieldDisplacement: texture_2d_array<f32>;
@group(${group}) @binding(3) var waterFieldVelocity: texture_2d_array<f32>;
@group(${group}) @binding(4) var waterFieldTangentX: texture_2d_array<f32>;
@group(${group}) @binding(5) var waterFieldTangentZ: texture_2d_array<f32>;
@group(${group}) @binding(6) var waterFieldSlopeMoments: texture_2d_array<f32>;
`;
}

/** Explicit LOD makes this same sampling ABI legal in all shader stages.
 * The mip chain stores linear first/second moments, never encoded normals. */
export const WATER_FIELD_SAMPLE_WGSL = /* wgsl */`
fn waterFieldTrilinear(field: texture_2d_array<f32>, uv: vec2f, layer: i32, lod: f32) -> vec4f {
 let level = clamp(lod, 0.0, f32(waterFieldFrame.quality.z - 1u));
 return textureSampleLevel(field, waterFieldSampler, uv, layer, level);
}
fn waterFieldFinish(q: vec2f, d: vec3f, v: vec3f, deltaX: vec3f, deltaZ: vec3f, covariance: vec3f, breaking: f32, compression: f32, depth: f32, current: vec2f) -> WaterFieldSample {
 let tx = deltaX + vec3f(1.0, 0.0, 0.0); let tz = deltaZ + vec3f(0.0, 0.0, 1.0);
 let crossNormal = cross(tz, tx); let normal = crossNormal / max(length(crossNormal), 0.00001);
 let jacobian = tx.x * tz.z - tz.x * tx.z;
 // Pull the parameter-domain height-slope covariance through the resolved
 // horizontal map. This includes chopping instead of treating q as worldXZ.
 let invJ = 1.0 / max(abs(jacobian), 0.04);
 let a = vec2f(tz.z, -tx.z) * invJ; let b = vec2f(-tz.x, tx.x) * invJ;
 let xx = max(0.0, a.x*a.x*covariance.x + 2.0*a.x*a.y*covariance.y + a.y*a.y*covariance.z);
 let zz = max(0.0, b.x*b.x*covariance.x + 2.0*b.x*b.y*covariance.y + b.y*b.y*covariance.z);
 let xz = clamp(a.x*b.x*covariance.x + (a.x*b.y+a.y*b.x)*covariance.y + a.y*b.y*covariance.z, -sqrt(xx*zz), sqrt(xx*zz));
 let mean = -normal.xz / max(abs(normal.y), 0.04);
 return WaterFieldSample(d, tx, tz, normal, v, jacobian, xx + zz, clamp(breaking, 0.0, 1.0), compression, mean,
  vec3f(xx, xz, zz), covariance, depth, current, q, vec3f(q.x + d.x, d.y, q.y + d.z), 0.0);
}
fn waterFieldSampleGrad(q: vec2f, time: f32, dx: vec2f, dy: vec2f) -> WaterFieldSample {
 var displacement = vec3f(0.0); var velocity = vec3f(0.0); var deltaX = vec3f(0.0); var deltaZ = vec3f(0.0);
 var covariance = vec3f(0.0); var breaking = 0.0; var compression = 0.0;
 let dxLength = length(dx); let dyLength = length(dy);
 let major = select(dy, dx, dxLength >= dyLength); let majorLength = max(dxLength, dyLength);
 let minorLength = max(min(dxLength, dyLength), majorLength * 0.125);
 let anisotropy = majorLength / max(minorLength, 0.000001);
 // Isotropic footprints need one hardware-filtered tap. Oblique footprints
 // start at four taps and cap at eight along the pixel's major direction.
 let taps = select(1u, u32(clamp(ceil(anisotropy), 4.0, 8.0)), anisotropy > 1.2);
 let layerCount = select(3u, 1u, waterFieldFrame.quality.w != 0u);
 for (var layer = 0u; layer < layerCount; layer += 1u) {
  let domain = waterFieldFrame.lengths[layer]; let cell = domain / f32(waterFieldFrame.quality.x);
  let omitted = layer >= waterFieldFrame.quality.y;
  let lod = select(max(0.0, log2(max(minorLength, cell) / cell)), f32(waterFieldFrame.quality.z - 1u), omitted);
  var d = vec4f(0.0); var v = vec4f(0.0); var tx = vec4f(0.0); var tz = vec4f(0.0); var second = vec4f(0.0);
  for (var tap = 0u; tap < taps; tap += 1u) {
   let offset = major * ((f32(tap) + 0.5) / f32(taps) - 0.5);
   let uv = (q + offset - waterFieldFrame.origin.xy) / domain + vec2f(0.5) + vec2f(0.5 / f32(waterFieldFrame.quality.x));
   if (!omitted) {
    d += waterFieldTrilinear(waterFieldDisplacement, uv, i32(layer), lod);
    v += waterFieldTrilinear(waterFieldVelocity, uv, i32(layer + 3u), lod);
    tx += waterFieldTrilinear(waterFieldTangentX, uv, i32(layer + 6u), lod);
    tz += waterFieldTrilinear(waterFieldTangentZ, uv, i32(layer + 9u), lod);
   }
   second += waterFieldTrilinear(waterFieldSlopeMoments, uv, i32(layer + 12u), lod);
  }
  let scale = 1.0 / f32(taps); d *= scale; v *= scale; tx *= scale; tz *= scale; second *= scale;
  let heightGain = waterFieldFrame.epoch.y; let chopGain = heightGain * waterFieldFrame.epoch.z;
  displacement += d.xyz * vec3f(chopGain, heightGain, chopGain);
  velocity += v.xyz * vec3f(chopGain, heightGain, chopGain);
  compression += v.w * chopGain;
  deltaX += tx.xyz * vec3f(chopGain, heightGain, chopGain); deltaZ += tz.xyz * vec3f(chopGain, heightGain, chopGain);
  let xx = max(0.0, second.x - tx.w*tx.w); let zz = max(0.0, second.z - tz.w*tz.w);
  let xz = clamp(second.y - tx.w*tz.w, -sqrt(xx*zz), sqrt(xx*zz));
  covariance += vec3f(xx, xz, zz) * heightGain * heightGain; breaking = max(breaking, second.w);
 }
 let combinedJ = (1.0 + deltaX.x) * (1.0 + deltaZ.z) - deltaZ.x * deltaX.z;
 breaking = max(breaking, 1.0 - smoothstep(0.15, 0.75, combinedJ));
 return waterFieldFinish(q, displacement, velocity, deltaX, deltaZ, covariance, breaking, compression, waterFieldFrame.lengths.w, waterFieldFrame.origin.zw);
}
fn waterFieldSample(q: vec2f, time: f32, footprint: f32) -> WaterFieldSample {
 let width = max(0.0, footprint);
 return waterFieldSampleGrad(q, time, vec2f(width, 0.0), vec2f(0.0, width));
}
fn waterFieldWorldSample(worldXZ: vec2f, time: f32, footprint: f32) -> WaterFieldSample {
 var q = worldXZ;
 for (var iteration = 0u; iteration < 8u; iteration += 1u) {
  let s = waterFieldSample(q, time, footprint); let residual = s.position.xz - worldXZ;
  if (dot(residual, residual) < 0.00000001) { break; }
  let determinant = select(-max(abs(s.jacobian), 0.04), max(abs(s.jacobian), 0.04), s.jacobian >= 0.0);
  q -= clamp(vec2f(s.tangentZ.z*residual.x-s.tangentZ.x*residual.y, -s.tangentX.z*residual.x+s.tangentX.x*residual.y)/determinant, vec2f(-20.0), vec2f(20.0));
 }
 var result = waterFieldSample(q, time, footprint); result.residual = length(result.position.xz-worldXZ); return result;
}
fn waterFieldLocalSampleGrad(q: vec2f, time: f32, amplitude: f32, wavelength: f32, speed: f32, direction: f32, phase: f32, dx: vec2f, dy: vec2f) -> WaterFieldSample {
 let c = cos(direction); let s = sin(direction); let rotation = mat2x2f(c, -s, s, c);
 let scale = 8.0 / max(wavelength, 0.05); let referenceSigma = max(waterFieldFrame.epoch.w, 0.0001);
 let gain = max(amplitude, 0.0) / (1.41421356237 * referenceSigma);
 let local = rotation * q * scale + vec2f(phase * 1.27323954474 - speed * time * scale, 0.0);
 let sample = waterFieldSampleGrad(local, time, rotation * dx * scale, rotation * dy * scale);
 let inverse = transpose(rotation);
 let height = max(amplitude, 0.0) * tanh(sample.displacement.y*gain/max(amplitude, 0.00001));
 let heightDerivative = gain * (1.0-pow(tanh(sample.displacement.y*gain/max(amplitude, 0.00001)), 2.0));
 let horizontal = inverse * sample.displacement.xz * gain; let horizontalVelocity = inverse * sample.velocity.xz * gain;
 let derivative = mat2x2f(sample.tangentX.x-1.0, sample.tangentX.z, sample.tangentZ.x, sample.tangentZ.z-1.0);
 let mapped = inverse * derivative * rotation * (gain * scale);
 let heightGradient = inverse * vec2f(sample.tangentX.y, sample.tangentZ.y) * (heightDerivative * scale);
 let tx = vec3f(mapped[0].x, heightGradient.x, mapped[0].y); let tz = vec3f(mapped[1].x, heightGradient.y, mapped[1].y);
 let moment = mat2x2f(sample.parameterSlopeCovariance.x, sample.parameterSlopeCovariance.y, sample.parameterSlopeCovariance.y, sample.parameterSlopeCovariance.z);
 let transformed = inverse * moment * rotation * (heightDerivative * scale) * (heightDerivative * scale);
 let driftVelocity = -(sample.tangentX - vec3f(1.0, 0.0, 0.0)) * speed * scale;
 let driftHorizontal = inverse * driftVelocity.xz * gain;
 return waterFieldFinish(q, vec3f(horizontal.x, height, horizontal.y),
  vec3f(horizontalVelocity.x+driftHorizontal.x, (sample.velocity.y+driftVelocity.y)*heightDerivative, horizontalVelocity.y+driftHorizontal.y), tx, tz,
  vec3f(transformed[0].x, transformed[0].y, transformed[1].y), sample.breakingPotential, sample.compressionRate*gain*scale,
  sample.depth, inverse*sample.current/scale + inverse*vec2f(speed, 0.0));
}
fn waterFieldLocalSample(q: vec2f, time: f32, amplitude: f32, wavelength: f32, speed: f32, direction: f32, phase: f32) -> WaterFieldSample {
 return waterFieldLocalSampleGrad(q, time, amplitude, wavelength, speed, direction, phase, vec2f(0.0), vec2f(0.0));
}
`;

/** Saved editable density ABI. The shader uses Cartesian density and the
 * CPU reference uses the same formula solely for explicit normalization. */
export const WATER_FIELD_DENSITY_WGSL = /* wgsl */`
fn waterFieldSpectralDensity(k: vec2f, wind: vec4f, spectrum: vec4f) -> f32 {
 let magnitude = length(k);
 if (magnitude < 6.28318530718 / spectrum.y || magnitude > 6.28318530718 / spectrum.x) { return 0.0; }
 let windLength = wind.x * wind.x / 9.80665;
 let alignment = dot(k / magnitude, vec2f(cos(wind.y), sin(wind.y)));
 let direction = 0.025 + 0.975 * pow(max(0.0, (1.0 + alignment) * 0.5), 16.0 - 14.7 * wind.z);
 return exp(-1.0 / (magnitude*magnitude*windLength*windLength) - magnitude*magnitude*wind.w*wind.w) * direction / pow(magnitude, 4.0);
}
`;

const KERNEL_UNIFORMS_WGSL = /* wgsl */`
struct WaterFieldKernelParams {
 grid: vec4u, // resolution, domain count, reserved, reserved
 epoch: vec4f, // time, normalization, chop, reference sigma
 wind: vec4f,
 spectrum: vec4f,
 flowOrigin: vec4f, // flowX, flowZ, originX, originZ
 lengths: vec4f,
}
@group(0) @binding(0) var<uniform> params: WaterFieldKernelParams;
`;

export const WATER_FIELD_EVOLVE_WGSL = /* wgsl */`${KERNEL_UNIFORMS_WGSL}
@group(0) @binding(1) var<storage, read> seeds: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> frequencies: array<vec2f>;
fn waterFieldComplexMultiply(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x*b.x-a.y*b.y, a.x*b.y+a.y*b.x); }
fn waterFieldBandWeight(k: f32, layer: u32) -> f32 {
 let middle = smoothstep(0.55, 0.95, k); let short = smoothstep(4.4, 7.5, k);
 if (layer == 0u) { return 1.0-middle; } if (layer == 1u) { return middle*(1.0-short); } return middle*short;
}
@compute @workgroup_size(8, 8, 1)
fn waterFieldEvolve(@builtin(global_invocation_id) gid: vec3u) {
 let size = params.grid.x; if (gid.x >= size || gid.y >= size || gid.z >= 1u) { return; }
 let count = size*size; let pixel = gid.y*size+gid.x; let layer = params.grid.y;
 let seed = seeds[layer*count+pixel]; let k = seed.zw; let magnitude = length(k);
 let mirrorIndex = ((size-gid.y)%size)*size+(size-gid.x)%size;
 let mirror = seeds[layer*count+mirrorIndex];
 let step = 6.28318530718 / params.lengths[layer];
 let weight = waterFieldBandWeight(magnitude, layer);
 let valid = gid.x != size/2u && gid.y != size/2u;
 let densityA = max(0.0, waterFieldSpectralDensity(k, params.wind, params.spectrum));
 let densityB = max(0.0, waterFieldSpectralDensity(-k, params.wind, params.spectrum));
 let scale = f32(count)*params.epoch.y*step*sqrt(weight*0.25);
 let a0 = seed.xy * sqrt(densityA)*scale; let b0 = mirror.xy*vec2f(1.0, -1.0)*sqrt(densityB)*scale;
 let omega = sqrt(9.80665*magnitude*tanh(magnitude*params.spectrum.z)); let flowOmega = dot(k, params.flowOrigin.xy);
 let angleA = (-omega-flowOmega)*params.epoch.x+dot(k, params.flowOrigin.zw);
 let angleB = (omega-flowOmega)*params.epoch.x+dot(k, params.flowOrigin.zw);
 let a = waterFieldComplexMultiply(a0, vec2f(cos(angleA), sin(angleA)));
 let b = waterFieldComplexMultiply(b0, vec2f(cos(angleB), sin(angleB)));
 let h = select(vec2f(0.0), a+b, valid);
 let vy = select(vec2f(0.0), vec2f(a.y*(omega+flowOmega)-b.y*(omega-flowOmega), -a.x*(omega+flowOmega)+b.x*(omega-flowOmega)), valid);
 let direction = k/max(magnitude, 0.00001); let chop = params.epoch.z;
 let dx = vec2f(h.y, -h.x)*direction.x*chop; let dz = vec2f(h.y, -h.x)*direction.y*chop;
 let vx = vec2f(vy.y, -vy.x)*direction.x*chop; let vz = vec2f(vy.y, -vy.x)*direction.y*chop;
 var values = array<vec2f, 12>(dx, h, dz, vx, vy, vz, vec2f(0.0), vec2f(0.0), vec2f(0.0), vec2f(0.0), vec2f(0.0), vec2f(0.0));
 for (var channel = 0u; channel < 3u; channel += 1u) {
  let value = values[channel]; let imaginary = vec2f(-value.y, value.x);
  values[6u+channel] = imaginary*k.x;
  values[9u+channel] = imaginary*k.y;
 }
 for (var channel = 0u; channel < 6u; channel += 1u) {
  let a = values[channel*2u]; let b = values[channel*2u+1u];
  frequencies[channel*count+pixel] = vec2f(a.x-b.y, a.y+b.x);
 }
}
`;

const OUTPUT_BINDINGS_WGSL = /* wgsl */`
// One physical15-layer allocation exposes five independent3-layer sampled
// views. A single storage binding respects the portable four-storage limit.
@group(0) @binding(2) var waterFieldOutput: texture_storage_2d_array<rgba16float, write>;
fn waterFieldStore(p: vec2i, layer: i32, d: vec3f, v: vec3f, dx: vec3f, dz: vec3f, compression: f32) {
 let j = (1.0+dx.x)*(1.0+dz.z)-dz.x*dx.z;
 let breaking = (1.0-smoothstep(0.15, 0.75, j)) * smoothstep(0.0, 0.5, max(compression, 0.0)+max(d.y, 0.0));
 textureStore(waterFieldOutput, p, layer, vec4f(d, j)); textureStore(waterFieldOutput, p, layer+3, vec4f(v, compression));
 textureStore(waterFieldOutput, p, layer+6, vec4f(dx, dx.y)); textureStore(waterFieldOutput, p, layer+9, vec4f(dz, dz.y));
 textureStore(waterFieldOutput, p, layer+12, vec4f(dx.y*dx.y, dx.y*dz.y, dz.y*dz.y, breaking));
}
`;

export const WATER_FIELD_UNPACK_WGSL = /* wgsl */`${KERNEL_UNIFORMS_WGSL}
@group(0) @binding(1) var<storage, read> spatial: array<vec2f>;
${OUTPUT_BINDINGS_WGSL}
fn waterFieldSpatial(p: vec2u, layer: u32, channel: u32) -> f32 {
 let size = params.grid.x; let centered = (p + vec2u(size/2u)) % vec2u(size);
 let value = spatial[(channel/2u)*size*size+centered.y*size+centered.x];
 return select(value.y, value.x, channel%2u == 0u) / f32(size*size);
}
@compute @workgroup_size(8, 8, 1)
fn waterFieldUnpack(@builtin(global_invocation_id) gid: vec3u) {
 let size = params.grid.x; if (gid.x >= size || gid.y >= size || gid.z >= 1u) { return; }
 let p = gid.xy; let layer = params.grid.y;
 let d = vec3f(waterFieldSpatial(p, layer, 0u), waterFieldSpatial(p, layer, 1u), waterFieldSpatial(p, layer, 2u));
 let v = vec3f(waterFieldSpatial(p, layer, 3u), waterFieldSpatial(p, layer, 4u), waterFieldSpatial(p, layer, 5u));
 let dx = vec3f(waterFieldSpatial(p, layer, 6u), waterFieldSpatial(p, layer, 7u), waterFieldSpatial(p, layer, 8u));
 let dz = vec3f(waterFieldSpatial(p, layer, 9u), waterFieldSpatial(p, layer, 10u), waterFieldSpatial(p, layer, 11u));
 let left = (p + vec2u(size-1u, 0u))%vec2u(size); let right = (p + vec2u(1u, 0u))%vec2u(size);
 let back = (p + vec2u(0u, size-1u))%vec2u(size); let front = (p + vec2u(0u, 1u))%vec2u(size);
 let compression = -(waterFieldSpatial(right, layer, 3u)-waterFieldSpatial(left, layer, 3u)+waterFieldSpatial(front, layer, 5u)-waterFieldSpatial(back, layer, 5u))*f32(size)/(2.0*params.lengths[layer]);
 waterFieldStore(vec2i(p), i32(layer), d, v, dx, dz, compression);
}
`;

export const WATER_FIELD_ANALYTIC_CACHE_WGSL = /* wgsl */`${WATER_FIELD_TYPES_WGSL}${KERNEL_UNIFORMS_WGSL}
${OUTPUT_BINDINGS_WGSL}
@compute @workgroup_size(8, 8, 1)
fn waterFieldCacheAnalytic(@builtin(global_invocation_id) gid: vec3u) {
 let size = params.grid.x; if (gid.x >= size || gid.y >= size || gid.z >= 3u) { return; }
 if (gid.z != 0u) { waterFieldStore(vec2i(gid.xy), i32(gid.z), vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0), 0.0); return; }
 let q = (vec2f(gid.xy)/f32(size)-vec2f(0.5))*params.lengths.x+params.flowOrigin.zw;
 let value = waterFieldSourceSample(q, params.epoch.x); let epsilon = params.lengths.x/f32(size)*0.5;
 let vx0 = waterFieldSourceSample(q-vec2f(epsilon, 0.0), params.epoch.x).velocity.x;
 let vx1 = waterFieldSourceSample(q+vec2f(epsilon, 0.0), params.epoch.x).velocity.x;
 let vz0 = waterFieldSourceSample(q-vec2f(0.0, epsilon), params.epoch.x).velocity.z;
 let vz1 = waterFieldSourceSample(q+vec2f(0.0, epsilon), params.epoch.x).velocity.z;
 waterFieldStore(vec2i(gid.xy), 0, value.displacement, value.velocity, value.tangentX-vec3f(1.0,0.0,0.0), value.tangentZ-vec3f(0.0,0.0,1.0), -(vx1-vx0+vz1-vz0)/(2.0*epsilon));
}
`;

export const WATER_FIELD_MIP_WGSL = /* wgsl */`
struct WaterFieldMipParams { extent: vec4u, padding: vec4u, }
@group(0) @binding(0) var<uniform> params: WaterFieldMipParams;
@group(0) @binding(1) var source: texture_2d_array<f32>;
@group(0) @binding(2) var mipOutput: texture_storage_2d_array<rgba16float, write>;
@compute @workgroup_size(8, 8, 1)
fn waterFieldMip(@builtin(global_invocation_id) gid: vec3u) {
 if (gid.x >= params.extent.x || gid.y >= params.extent.y || gid.z >= params.extent.z) { return; }
 let p = vec2i(gid.xy*2u); let layer = i32(gid.z);
 let value = (textureLoad(source,p,layer,0)+textureLoad(source,p+vec2i(1,0),layer,0)+textureLoad(source,p+vec2i(0,1),layer,0)+textureLoad(source,p+vec2i(1,1),layer,0))*0.25;
 textureStore(mipOutput,vec2i(gid.xy),layer,value);
}
`;
