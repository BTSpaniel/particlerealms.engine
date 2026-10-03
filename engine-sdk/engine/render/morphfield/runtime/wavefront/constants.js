// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const WAVEFRONT_WORKGROUP_SIZE = 64;
export const WAVEFRONT_MAX_BOUNCES = 16;
export const WAVEFRONT_MAX_TRACE_STEPS = 256;

export const WAVEFRONT_RECORD_BYTES = Object.freeze({
  queueHeader: 16,
  ray: 32,
  hit: 48,
  shadow: 48,
  pathState: 32,
  accumulation: 16,
  frameUniform: 256,
  bounceUniform: 256,
  materialExtension: 16,
});

export const WAVEFRONT_OUTPUT_ENCODING = Object.freeze({
  format: "rgba32float",
  channels: "rgb=radiance-sum,a=sample-count",
  strideBytes: WAVEFRONT_RECORD_BYTES.accumulation,
});

export const WAVEFRONT_SCENE_BUFFER_ABI = Object.freeze({
  required: Object.freeze([
    "fieldletHeaders",
    "payloads",
    "resolvedCertificates",
    "materials",
    "programWords",
    "analyticParameters",
    "bounds",
  ]),
  resolvedCertificateRecords: Object.freeze(["surface", "medium", "motion", "collision"]),
  materialRecord: "three vec4<f32>: baseColor; roughness, metallic, compiler flags, IOR; emissive RGB",
  materialExtensionRecord: "vec4<f32>: transmissionFactor, ior, clearcoatFactor, clearcoatRoughness",
});

export const WAVEFRONT_LIMITATIONS = Object.freeze([
  "Only certified analytic-family Fieldlets are intersected; residual, kernel, and cached-surface families remain handled by their dedicated MorphField passes.",
  "The baseline intersection kernel traverses Fieldlets linearly. It consumes compiled bounds for ray intervals and certified step clamping, but does not yet consume the compiler's binary BVH arrays.",
  "The twelve-float base material ABI carries RGB emission and IOR; transmission and clearcoat use the optional four-float material-extension record, with absent records resolving to opaque dielectric defaults.",
  "Transmission is a specular dielectric interface. Rough reflection uses GGX VNDF; rough microfacet BTDF and nested-medium stacks are outside this module's contract.",
  "Directional and procedural sky lighting are supported. Image-based environment texture importance sampling is not part of this buffer-only compute module.",
]);

export function queueByteSize(capacity, recordBytes) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError("MorphField wavefront queue capacity must be a positive safe integer");
  }
  const bytes = WAVEFRONT_RECORD_BYTES.queueHeader + capacity * recordBytes;
  if (!Number.isSafeInteger(bytes)) throw new RangeError("MorphField wavefront queue byte size overflow");
  return bytes;
}

function finiteClamped(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

/**
 * Packs one extension record per material as
 * [transmissionFactor, ior, clearcoatFactor, clearcoatRoughness].
 */
export function packMaterialExtensions(descriptors = []) {
  if (!Array.isArray(descriptors)) {
    throw new TypeError("MorphField material extension descriptors must be an array");
  }
  const source = descriptors.length > 0 ? descriptors : [{}];
  const packed = new Float32Array(source.length * 4);
  source.forEach((descriptor, index) => {
    const material = descriptor && typeof descriptor === "object" ? descriptor : {};
    const extensions = material.extensions && typeof material.extensions === "object"
      ? material.extensions
      : {};
    const transmissionExtension = extensions.KHR_materials_transmission || {};
    const iorExtension = extensions.KHR_materials_ior || {};
    const clearcoatExtension = extensions.KHR_materials_clearcoat || {};
    packed.set([
      finiteClamped(
        material.transmissionFactor ?? transmissionExtension.transmissionFactor,
        0,
        0,
        1,
      ),
      finiteClamped(material.ior ?? iorExtension.ior, 1.5, 1.0001, 3),
      finiteClamped(
        material.clearcoatFactor ?? clearcoatExtension.clearcoatFactor,
        0,
        0,
        1,
      ),
      finiteClamped(
        material.clearcoatRoughness
          ?? material.clearcoatRoughnessFactor
          ?? clearcoatExtension.clearcoatRoughnessFactor,
        0.1,
        0.02,
        1,
      ),
    ], index * 4);
  });
  return packed;
}
