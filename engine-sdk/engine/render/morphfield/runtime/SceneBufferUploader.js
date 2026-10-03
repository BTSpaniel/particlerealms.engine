// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { bufferUsage } from "./capabilities.js";
import {
  ANALYTIC_GPU_PARAMETER_MINIMUM,
  ANALYTIC_LIMITS,
  ANALYTIC_OPCODE,
  FIELDLET_FAMILY as ABI_FIELDLET_FAMILY,
  FIELDLET_FLAG,
  FIELDLET_SUBTYPE as ABI_FIELDLET_SUBTYPE,
  INVALID_REF,
  MORPHFIELD_SCHEMA_VERSION,
  PAYLOAD_SHAPE,
  QUERY_MASK,
} from "../core/constants.js";
import {
  isCompilerProducedCompiledScene,
  verifyCompiledSceneProvenance,
} from "../core/MorphFieldCompiler.js";

export const FIELDLET_FAMILY = Object.freeze({
  ANALYTIC: 0,
  SPARSE_RESIDUAL: 1,
  ORIENTED_KERNEL: 2,
  CACHED_SURFACE: 3,
  RESIDUAL: 1,
  KERNEL: 2,
  SURFACE_CACHE: 3,
});

export const ANALYTIC_SUBTYPE = Object.freeze({
  SPHERE: 0,
  BOX: 1,
  CAPSULE: 2,
  CSG: 3,
  SAMPLED_FIELD: 4,
  SPARSE_RESIDUAL: 5,
  ORIENTED_SAMPLES: 6,
  INDEXED_SURFACE: 7,
  MEDIUM: 8,
});

export const FIELDLET_SUBTYPE = ANALYTIC_SUBTYPE;

export const QUERY_KIND = Object.freeze({
  BOUND: 0,
  SURFACE: 1,
  MEDIUM: 2,
  MATERIAL: 3,
  MOTION: 4,
  COLLISION: 5,
});

const ABSENT_REF = 0xFFFFFFFF;
const PAYLOAD_FLOATS = 16;
const MATERIAL_FLOATS = 12;
const ALL_QUERY_MASK = 0x3F;
const SPATIAL_RECORD_WORDS = 12;
const SPATIAL_RECORD_MAGIC = 0x4D464233;
const RUNTIME_DELTA_SCHEMA = "morphfield-runtime-delta";
const COMPILED_SCENE_SCHEMA = "morphfield-compiled-scene";

function pathValue(root, path) {
  let value = root;
  for (const part of path.split(".")) value = value?.[part];
  return value;
}

function firstValue(root, paths) {
  for (const path of paths) {
    const value = pathValue(root, path);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function typed(value, Type, name) {
  if (value === undefined || value === null) return null;
  if (value instanceof Type) return new Type(value);
  if (ArrayBuffer.isView(value)) {
    if (value.byteOffset % Type.BYTES_PER_ELEMENT !== 0
        || value.byteLength % Type.BYTES_PER_ELEMENT !== 0) {
      throw new RangeError(`MorphField: ${name} is not aligned for ${Type.name}`);
    }
    return new Type(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  if (value instanceof ArrayBuffer) return new Type(value.slice(0));
  if (Array.isArray(value)) return Type.from(value);
  throw new TypeError(`MorphField: ${name} must be an array or typed array`);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

const FLOAT32_BIT_VALUE = new Float32Array(1);
const FLOAT32_BIT_WORD = new Uint32Array(FLOAT32_BIT_VALUE.buffer);

function float32Bits(value) {
  FLOAT32_BIT_VALUE[0] = finite(value, 0);
  return FLOAT32_BIT_WORD[0] >>> 0;
}

function collisionOffsets(collision) {
  const contactOffset = Math.max(0, finite(collision?.contactOffset ?? collision?.contactSlop, 0.001));
  const restOffset = finite(collision?.restOffset, 0);
  if (restOffset > contactOffset) {
    throw new RangeError("MorphField: collision restOffset must not exceed contactOffset");
  }
  return { contactOffset, restOffset };
}

function collisionMetadataRecord(collision, restOffset) {
  return [
    1,
    Math.max(0, Math.min(31, Math.trunc(finite(collision?.layer, 0)))),
    Number(collision?.mask ?? 0xffffffff) >>> 0,
    float32Bits(restOffset),
  ];
}

function vector(value, length, fallback) {
  const source = ArrayBuffer.isView(value) || Array.isArray(value) ? value : fallback;
  return Array.from({ length }, (_, i) => finite(source?.[i], fallback[i]));
}

function uniformScale(transform) {
  const scale = transform?.scale;
  if (scale === undefined) return 1;
  if (typeof scale === "number") return Math.abs(finite(scale, 1)) || 1;
  const xyz = vector(scale, 3, [1, 1, 1]).map(Math.abs);
  const tolerance = Math.max(1e-6, Math.max(...xyz) * 1e-5);
  if (Math.abs(xyz[0] - xyz[1]) > tolerance || Math.abs(xyz[0] - xyz[2]) > tolerance) {
    throw new RangeError("MorphField: runtime analytic Fieldlets require a uniform scale");
  }
  return xyz[0] || 1;
}

function subtypeOf(fieldlet) {
  const numeric = Number(fieldlet.subtype ?? fieldlet.header?.subtype);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric < 4096) return numeric;
  const source = fieldlet.source || fieldlet.geometry || fieldlet;
  const type = String(source.type || source.primitive || fieldlet.type || "sphere").toLowerCase();
  if (type === "sphere" || type === "sdf-sphere") return ANALYTIC_SUBTYPE.SPHERE;
  if (type === "box" || type === "cube" || type === "sdf-box") return ANALYTIC_SUBTYPE.BOX;
  if (type === "capsule" || type === "sdf-capsule") return ANALYTIC_SUBTYPE.CAPSULE;
  throw new RangeError(`MorphField: unsupported runtime analytic subtype ${type}`);
}

function familyOf(fieldlet) {
  const value = fieldlet.family ?? fieldlet.header?.family;
  if (Number.isInteger(Number(value))) return Number(value);
  const family = String(value || "analytic").toLowerCase();
  if (family === "analytic" || family === "field") return FIELDLET_FAMILY.ANALYTIC;
  if (family === "residual" || family === "sparse-residual") return FIELDLET_FAMILY.RESIDUAL;
  if (family === "kernel" || family === "oriented-kernel") return FIELDLET_FAMILY.KERNEL;
  if (family === "surface" || family === "surface-cache" || family === "cached-surface") return FIELDLET_FAMILY.SURFACE_CACHE;
  throw new RangeError(`MorphField: unknown Fieldlet family ${family}`);
}

function normalizeMaterial(material = {}) {
  const base = vector(material.baseColorFactor || material.baseColor || material.color, 4, [0.72, 0.74, 0.8, 1]);
  const emission = vector(material.emissiveFactor || material.emissionColor, 3, [0, 0, 0]);
  const emissionScale = Math.max(0, finite(material.emissiveStrength ?? material.emissiveIntensity, 1));
  const roughness = material.roughnessFactor ?? material.roughness;
  const metallic = material.metallicFactor ?? material.metallic ?? material.metalness;
  let flags = 0;
  if (base[3] >= 0.999) flags |= 1;
  if (emission.some(value => value * emissionScale > 0)) flags |= 1 << 1;
  return [
    base[0], base[1], base[2], base[3],
    Math.max(0.02, Math.min(1, finite(roughness, 0.45))),
    Math.max(0, Math.min(1, finite(metallic, 0))),
    flags,
    Math.max(1.0001, finite(material.ior, 1.5)),
    Math.max(0, emission[0] * emissionScale),
    Math.max(0, emission[1] * emissionScale),
    Math.max(0, emission[2] * emissionScale),
    0,
  ];
}

function materialTable(scene, fieldlets) {
  const source = Array.isArray(scene.materials) ? scene.materials : [];
  const descriptors = source.length > 0 ? source.map((entry) => ({ ...entry })) : [{}];
  const entries = descriptors.map(normalizeMaterial);
  for (const fieldlet of fieldlets) {
    if (fieldlet.material && !Number.isInteger(fieldlet.materialIndex)) {
      fieldlet.__runtimeMaterialIndex = entries.length;
      descriptors.push({ ...fieldlet.material });
      entries.push(normalizeMaterial(fieldlet.material));
    }
  }
  return Object.freeze({
    data: Float32Array.from(entries.flat()),
    descriptors,
  });
}

function fieldletBounds(fieldlet, subtype, center, scale) {
  const explicit = fieldlet.bounds || fieldlet.header?.bounds;
  if (explicit) {
    const minimumSource = explicit.min || explicit.minimum || explicit.slice?.(0, 3);
    const maximumSource = explicit.max || explicit.maximum || explicit.slice?.(3, 6);
    if ((!Array.isArray(minimumSource) && !ArrayBuffer.isView(minimumSource))
        || (!Array.isArray(maximumSource) && !ArrayBuffer.isView(maximumSource))
        || minimumSource.length < 3 || maximumSource.length < 3) {
      throw new TypeError("MorphField: explicit Fieldlet bounds require three-component min and max vectors");
    }
    const min = Array.from({ length: 3 }, (_, axis) => Number(minimumSource[axis]));
    const max = Array.from({ length: 3 }, (_, axis) => Number(maximumSource[axis]));
    if (![...min, ...max].every(Number.isFinite)) {
      throw new RangeError("MorphField: explicit Fieldlet bounds must be finite");
    }
    return [...min, 0, ...max, 0];
  }
  const source = fieldlet.source || fieldlet.geometry || fieldlet;
  let extent;
  if (subtype === ANALYTIC_SUBTYPE.SPHERE) {
    const radius = Math.abs(finite(source.radius ?? fieldlet.radius, 1)) * scale;
    extent = [radius, radius, radius];
  } else if (subtype === ANALYTIC_SUBTYPE.BOX) {
    const half = vector(source.halfExtents || source.halfSize || fieldlet.halfExtents, 3, [1, 1, 1]);
    extent = half.map((value) => Math.abs(value) * scale * 1.733);
  } else {
    const radius = Math.abs(finite(source.radius ?? fieldlet.radius, 0.5));
    const halfHeight = Math.abs(finite(source.halfHeight ?? fieldlet.halfHeight, 1));
    const outer = (radius + halfHeight) * scale;
    extent = [outer, outer, outer];
  }
  return [
    center[0] - extent[0], center[1] - extent[1], center[2] - extent[2], 0,
    center[0] + extent[0], center[1] + extent[1], center[2] + extent[2], 0,
  ];
}

function objectSceneToCanonical(scene) {
  const fieldlets = Array.isArray(scene.fieldlets)
    ? scene.fieldlets.map((entry) => ({ ...entry }))
    : Array.isArray(scene.nexels)
      ? scene.nexels.map((entry) => ({ ...entry }))
      : [];
  const headers = new Uint32Array(Math.max(1, fieldlets.length) * 4);
  const bounds = new Float32Array(Math.max(1, fieldlets.length) * 8);
  const payloads = new Float32Array(Math.max(1, fieldlets.length) * PAYLOAD_FLOATS);
  const bundles = new Uint32Array(Math.max(1, fieldlets.length) * 4);
  bundles.fill(ABSENT_REF);
  const surfaceCertificates = new Float32Array(Math.max(1, fieldlets.length) * 4);
  const mediumCertificates = new Float32Array(4);
  const motionCertificates = new Float32Array(4);
  const collisionCertificates = new Float32Array(Math.max(1, fieldlets.length) * 4);
  const collisionMetadata = new Uint32Array(Math.max(1, fieldlets.length) * 4);
  const programWords = new Uint32Array(2);
  const analyticParameters = new Float32Array(16);
  const materialRecords = materialTable(scene, fieldlets);
  const materials = materialRecords.data;
  const ids = [];

  fieldlets.forEach((fieldlet, index) => {
    const family = familyOf(fieldlet);
    const subtype = subtypeOf(fieldlet);
    if (family !== FIELDLET_FAMILY.ANALYTIC) {
      throw new RangeError("MorphField runtime currently renders non-analytic families only when a compiled runtime payload is supplied");
    }
    const source = fieldlet.source || fieldlet.geometry || fieldlet;
    const transform = fieldlet.transform || {};
    const center = vector(transform.position || source.center || fieldlet.position, 3, [0, 0, 0]);
    const rotation = vector(transform.rotation || transform.quaternion || fieldlet.rotation, 4, [0, 0, 0, 1]);
    const scale = uniformScale(transform);
    const queryMask = Number(fieldlet.queryMask ?? ALL_QUERY_MASK) & ALL_QUERY_MASK;
    const flags = Number(fieldlet.flags ?? 0) & 0x3FF;
    const meta = (subtype & 0xFFF) | ((family & 0xF) << 12) | (queryMask << 16) | (flags << 22);
    const headerOffset = index * 4;
    headers.set([index, index, meta >>> 0, index], headerOffset);
    bounds.set(fieldletBounds(fieldlet, subtype, center, scale), index * 8);

    const payloadOffset = index * PAYLOAD_FLOATS;
    let radius = 0;
    if (subtype === ANALYTIC_SUBTYPE.SPHERE || subtype === ANALYTIC_SUBTYPE.CAPSULE) {
      radius = Math.abs(finite(source.radius ?? fieldlet.radius, subtype === ANALYTIC_SUBTYPE.SPHERE ? 1 : 0.5)) * scale;
    }
    payloads.set([center[0], center[1], center[2], radius], payloadOffset);
    if (subtype === ANALYTIC_SUBTYPE.SPHERE) {
      payloads.set([radius, radius, radius, subtype], payloadOffset + 4);
    } else if (subtype === ANALYTIC_SUBTYPE.BOX) {
      const half = vector(source.halfExtents || source.halfSize || fieldlet.halfExtents, 3, [1, 1, 1]).map((value) => Math.abs(value) * scale);
      payloads.set([half[0], half[1], half[2], subtype], payloadOffset + 4);
    } else {
      const halfHeight = Math.abs(finite(source.halfHeight ?? fieldlet.halfHeight, 1)) * scale;
      payloads.set([
        radius,
        halfHeight,
        radius,
        subtype,
      ], payloadOffset + 4);
    }
    payloads.set(rotation, payloadOffset + 8);
    const materialIndex = Number.isInteger(fieldlet.materialIndex)
      ? fieldlet.materialIndex
      : (fieldlet.__runtimeMaterialIndex ?? 0);
    payloads.set([
      Math.max(0, Math.floor(finite(fieldlet.programOffset, 0))),
      Math.max(0, Math.floor(finite(fieldlet.programLength, 0))),
      materialIndex,
      queryMask,
    ], payloadOffset + 12);

    bundles.set([index, ABSENT_REF, ABSENT_REF, index], index * 4);
    const certificate = fieldlet.surfaceCertificate || fieldlet.certificate || {};
    surfaceCertificates.set([
      Math.max(0, finite(certificate.fieldValueErrorMax, 0)),
      Math.max(1e-6, finite(certificate.lipschitzMax, 1)),
      Math.max(1e-6, finite(certificate.fallbackBand, 0.001)),
      Math.max(0, finite(certificate.motionRadiusMax, 0)),
    ], index * 4);
    const collision = fieldlet.collision && fieldlet.collision !== true ? fieldlet.collision : fieldlet.collision ? {} : null;
    if (collision) {
      const offsets = collisionOffsets(collision);
      collisionCertificates.set([
        surfaceCertificates[index * 4],
        surfaceCertificates[index * 4 + 1],
        offsets.contactOffset,
        surfaceCertificates[index * 4 + 3],
      ], index * 4);
      collisionMetadata.set(collisionMetadataRecord(collision, offsets.restOffset), index * 4);
    } else {
      collisionCertificates.set([0, 1, 0, 0], index * 4);
    }
    ids.push(String(fieldlet.id ?? index));
  });

  return {
    sceneId: String(scene.sceneId ?? scene.id ?? "scene"),
    revision: Math.max(0, Math.floor(finite(scene.revision, 0))),
    sourceCrc32: Number(scene.sourceCrc32 ?? 0) >>> 0,
    fieldletCount: fieldlets.length,
    fieldletHeaders: headers,
    bounds,
    payloads,
    certificateBundles: bundles,
    surfaceCertificates,
    mediumCertificates,
    motionCertificates,
    collisionCertificates,
    collisionMetadata,
    resolvedSurfaceCertificates: new Float32Array(surfaceCertificates),
    resolvedCertificates: (() => {
      const records = new Float32Array(Math.max(1, fieldlets.length) * 16);
      for (let index = 0; index < Math.max(1, fieldlets.length); index += 1) {
        records.set(surfaceCertificates.subarray(index * 4, index * 4 + 4), index * 16);
        records.set(collisionCertificates.subarray(index * 4, index * 4 + 4), index * 16 + 12);
      }
      return records;
    })(),
    programWords,
    analyticParameters,
    materials,
    bvhNodes: new Float32Array(8),
    bvhIndices: new Uint32Array(1),
    bvhRoot: ABSENT_REF,
    ids,
    materialDescriptors: materialRecords.descriptors,
    objectFieldlets: fieldlets,
  };
}

function canonicalTypedScene(scene) {
  const runtime = scene.runtime || scene.gpuData || scene;
  const headerSource = firstValue(runtime, ["fieldletHeaders", "headers", "fieldlets.headers"]);
  if (headerSource === undefined) return null;
  const headers = typed(headerSource, Uint32Array, "fieldletHeaders");
  if (headers.length % 4 !== 0) throw new RangeError("MorphField: Fieldlet headers must contain four u32 values per record");
  const count = Math.floor(Number(runtime.fieldletCount ?? scene.fieldletCount ?? headers.length / 4));
  if (count < 0 || count * 4 > headers.length) throw new RangeError("MorphField: invalid Fieldlet count");
  const bounds = typed(firstValue(runtime, ["bounds", "boundRecords", "fieldlets.bounds"]) || new Float32Array(Math.max(1, count) * 8), Float32Array, "bounds");
  const payloads = typed(firstValue(runtime, ["payloads", "payloadRecords", "fieldlets.payloads"]) || new Float32Array(Math.max(1, count) * PAYLOAD_FLOATS), Float32Array, "payloads");
  const bundles = typed(firstValue(runtime, ["certificateBundles", "certificates.bundles"]) || new Uint32Array(Math.max(1, count) * 4).fill(ABSENT_REF), Uint32Array, "certificateBundles");
  const certificates = typed(firstValue(runtime, ["surfaceCertificates", "certificates.surface", "certificates"]) || new Float32Array(Math.max(1, count) * 4), Float32Array, "surfaceCertificates");
  const mediumCertificates = typed(firstValue(runtime, ["mediumCertificates", "certificates.medium"]) || new Float32Array(4), Float32Array, "mediumCertificates");
  const motionCertificates = typed(firstValue(runtime, ["motionCertificates", "certificates.motion"]) || new Float32Array(4), Float32Array, "motionCertificates");
  const collisionCertificates = typed(firstValue(runtime, ["collisionCertificates", "certificates.collision"]) || new Float32Array(4), Float32Array, "collisionCertificates");
  const descriptorSource = Array.isArray(scene.descriptors)
    ? scene.descriptors
    : Array.isArray(scene.sceneSnapshot?.nexels)
      ? scene.sceneSnapshot.nexels
      : [];
  const packedCollisionMetadata = typed(
    firstValue(runtime, ["collisionMetadata", "collision.metadata"]),
    Uint32Array,
    "collisionMetadata",
  );
  const collisionMetadata = packedCollisionMetadata || new Uint32Array(Math.max(1, count) * 4);
  for (let index = 0; index < count; index += 1) {
    const collision = descriptorSource[index]?.collision;
    if (!collision) continue;
    const offsets = collisionOffsets(collision);
    collisionMetadata.set(collisionMetadataRecord(collision, offsets.restOffset), index * 4);
  }
  const programWords = typed(firstValue(runtime, ["programWords", "analytic.programWords"]) || new Uint32Array(2), Uint32Array, "programWords");
  const analyticParameters = typed(firstValue(runtime, ["analyticParameters", "analytic.parameters"]) || new Float32Array(16), Float32Array, "analyticParameters");
  const materials = typed(firstValue(runtime, ["materials", "materialRecords"]) || Float32Array.from(normalizeMaterial()), Float32Array, "materials");
  // The device-independent compiler publishes `bvhBounds` and `bvhMetadata`.
  // Keep the older runtime aliases for compatibility, but never replace valid
  // compiled arrays with the one-node fallback merely because their public
  // names differ from the upload-buffer labels.
  const bvhNodes = typed(firstValue(runtime, ["bvhNodes", "bvhBounds", "bvh.nodes", "bvh.bounds"]) || new Float32Array(8), Float32Array, "bvhNodes");
  const bvhIndices = typed(firstValue(runtime, ["bvhIndices", "bvhMetadata", "bvh.indices", "bvh.metadata"]) || new Uint32Array(Math.max(1, count)), Uint32Array, "bvhIndices");
  const bvhRootValue = Number(firstValue(runtime, ["bvhRoot", "bvh.root"]) ?? ABSENT_REF);
  const bvhRoot = Number.isInteger(bvhRootValue) && bvhRootValue >= 0 && bvhRootValue <= ABSENT_REF
    ? bvhRootValue
    : ABSENT_REF;
  if (bounds.length % 8 !== 0 || payloads.length % PAYLOAD_FLOATS !== 0
      || bundles.length % 4 !== 0 || certificates.length % 4 !== 0
      || mediumCertificates.length % 4 !== 0 || motionCertificates.length % 4 !== 0 || collisionCertificates.length % 4 !== 0
      || collisionMetadata.length % 4 !== 0 || collisionMetadata.length < Math.max(1, count) * 4
      || materials.length % MATERIAL_FLOATS !== 0 || bvhNodes.length % 8 !== 0
      || programWords.length % 2 !== 0 || analyticParameters.length % 16 !== 0) {
    throw new RangeError("MorphField: compiled runtime arrays do not match their fixed record strides");
  }
  const safeHeaders = headers.length > 0 ? headers : new Uint32Array(4);
  const safeBundles = bundles.length > 0 ? bundles : new Uint32Array(4).fill(ABSENT_REF);
  const safeCertificates = certificates.length > 0 ? certificates : new Float32Array(4);
  const resolvedSurfaceCertificates = new Float32Array(Math.max(1, count) * 4);
  const resolvedCertificates = new Float32Array(Math.max(1, count) * 16);
  const collisionCertificatePresent = new Uint8Array(Math.max(1, count));
  for (let index = 0; index < count; index += 1) {
    const bundleRef = safeHeaders[index * 4 + 3];
    const bundleBase = bundleRef < safeBundles.length / 4 ? bundleRef * 4 : -1;
    const surfaceRef = bundleBase >= 0 ? safeBundles[bundleBase] : ABSENT_REF;
    const mediumRef = bundleBase >= 0 ? safeBundles[bundleBase + 1] : ABSENT_REF;
    const motionRef = bundleBase >= 0 ? safeBundles[bundleBase + 2] : ABSENT_REF;
    const collisionRef = bundleBase >= 0 ? safeBundles[bundleBase + 3] : ABSENT_REF;
    if (surfaceRef !== ABSENT_REF && surfaceRef < safeCertificates.length / 4) {
      resolvedSurfaceCertificates.set(safeCertificates.subarray(surfaceRef * 4, surfaceRef * 4 + 4), index * 4);
    } else {
      resolvedSurfaceCertificates.set([0, 1, 0.001, 0], index * 4);
    }
    resolvedCertificates.set(resolvedSurfaceCertificates.subarray(index * 4, index * 4 + 4), index * 16);
    if (mediumRef !== ABSENT_REF && mediumRef < mediumCertificates.length / 4) {
      resolvedCertificates.set(mediumCertificates.subarray(mediumRef * 4, mediumRef * 4 + 4), index * 16 + 4);
    }
    if (motionRef !== ABSENT_REF && motionRef < motionCertificates.length / 4) {
      resolvedCertificates.set(motionCertificates.subarray(motionRef * 4, motionRef * 4 + 4), index * 16 + 8);
    }
    if (collisionRef !== ABSENT_REF && collisionRef < collisionCertificates.length / 4) {
      const collisionCertificate = collisionCertificates.subarray(collisionRef * 4, collisionRef * 4 + 4);
      if (!Number.isFinite(collisionCertificate[0]) || collisionCertificate[0] < 0
          || !Number.isFinite(collisionCertificate[1]) || collisionCertificate[1] <= 0
          || !Number.isFinite(collisionCertificate[2]) || collisionCertificate[2] < 0
          || !Number.isFinite(collisionCertificate[3]) || collisionCertificate[3] < 0) {
        throw new RangeError(`MorphField: collision certificate record ${collisionRef} is invalid`);
      }
      resolvedCertificates.set(collisionCertificate, index * 16 + 12);
      collisionCertificatePresent[index] = 1;
    } else {
      resolvedCertificates.set([0, 1, 0, 0], index * 16 + 12);
    }
  }
  const collisionMetadataFloats = new Float32Array(
    collisionMetadata.buffer,
    collisionMetadata.byteOffset,
    collisionMetadata.length,
  );
  for (let index = 0; index < count; index += 1) {
    const metadataBase = index * 4;
    const enabled = collisionMetadata[metadataBase];
    const layer = collisionMetadata[metadataBase + 1];
    const restOffset = collisionMetadataFloats[metadataBase + 3];
    const contactOffset = resolvedCertificates[index * 16 + 14];
    if (enabled > 1 || layer > 31 || !Number.isFinite(restOffset) || restOffset > contactOffset
        || (enabled === 1 && collisionCertificatePresent[index] === 0)) {
      throw new RangeError(`MorphField: collision metadata record ${index} is invalid`);
    }
  }
  return {
    sceneId: String(scene.sceneId ?? runtime.sceneId ?? "scene"),
    revision: Math.max(0, Math.floor(finite(scene.revision ?? runtime.revision, 0))),
    sourceCrc32: Number(scene.sourceCrc32 ?? runtime.sourceCrc32 ?? 0) >>> 0,
    fieldletCount: count,
    fieldletHeaders: safeHeaders,
    bounds: bounds.length > 0 ? bounds : new Float32Array(8),
    payloads: payloads.length > 0 ? payloads : new Float32Array(PAYLOAD_FLOATS),
    certificateBundles: safeBundles,
    surfaceCertificates: safeCertificates,
    mediumCertificates: mediumCertificates.length > 0 ? mediumCertificates : new Float32Array(4),
    motionCertificates: motionCertificates.length > 0 ? motionCertificates : new Float32Array(4),
    collisionCertificates: collisionCertificates.length > 0 ? collisionCertificates : new Float32Array(4),
    collisionMetadata,
    resolvedSurfaceCertificates,
    resolvedCertificates,
    programWords: programWords.length > 0 ? programWords : new Uint32Array(2),
    analyticParameters: analyticParameters.length > 0 ? analyticParameters : new Float32Array(16),
    materials: materials.length > 0 ? materials : Float32Array.from(normalizeMaterial()),
    bvhNodes: bvhNodes.length > 0 ? bvhNodes : new Float32Array(8),
    bvhIndices: bvhIndices.length > 0 ? bvhIndices : new Uint32Array(1),
    bvhRoot,
    ids: Array.isArray(scene.ids) ? [...scene.ids] : [],
    materialDescriptors: Array.isArray(scene.materialDescriptors)
      ? scene.materialDescriptors.map((entry) => ({ ...entry }))
      : [],
    objectFieldlets: Array.isArray(scene.fieldlets) ? scene.fieldlets.map((entry) => ({ ...entry })) : null,
  };
}

function validateMaterialRecords(materials) {
  for (let offset = 0; offset < materials.length; offset += 1) {
    if (!Number.isFinite(materials[offset])) {
      const record = Math.floor(offset / MATERIAL_FLOATS);
      const component = offset % MATERIAL_FLOATS;
      throw new RangeError(`MorphField: material record ${record} component ${component} is non-finite`);
    }
  }
}

function requiredCompiledArray(scene, names, Type, label) {
  const runtime = scene.runtime || scene.gpuData || scene;
  const value = firstValue(runtime, names);
  if (!(value instanceof Type)) {
    throw new TypeError(`MorphField: compiled ${label} must be a ${Type.name}`);
  }
  return value;
}

function validateFiniteRecordPool(pool, stride, label, predicate) {
  if (pool.length % stride !== 0) {
    throw new RangeError(`MorphField: compiled ${label} length ${pool.length} is not divisible by ${stride}`);
  }
  for (let record = 0; record < pool.length / stride; record += 1) {
    const base = record * stride;
    for (let component = 0; component < stride; component += 1) {
      if (!Number.isFinite(pool[base + component])) {
        throw new RangeError(`MorphField: ${label} record ${record} component ${component} is non-finite`);
      }
    }
    if (predicate && !predicate(pool, base)) {
      throw new RangeError(`MorphField: ${label} record ${record} violates its ABI domain`);
    }
  }
}

function validReference(reference, count) {
  return reference === INVALID_REF || reference < count;
}

function validateAnalyticProgram(words, parameters, offset, length, fieldletIndex) {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length)
      || length <= 0 || length > ANALYTIC_LIMITS.MAX_PROGRAM_INSTRUCTIONS
      || (offset + length) * 2 > words.length) {
    throw new RangeError(`MorphField: Fieldlet ${fieldletIndex} analytic program range is invalid`);
  }
  let depth = 0;
  let maximumDepth = 0;
  for (let instruction = 0; instruction < length; instruction += 1) {
    const word = (offset + instruction) * 2;
    const opcode = words[word];
    const operand = words[word + 1];
    if (opcode === ANALYTIC_OPCODE.SPHERE
        || opcode === ANALYTIC_OPCODE.BOX
        || opcode === ANALYTIC_OPCODE.CAPSULE) {
      if (operand >= parameters.length / 16) {
        throw new RangeError(`MorphField: Fieldlet ${fieldletIndex} analytic parameter ref ${operand} is invalid`);
      }
      depth += 1;
    } else if (opcode === ANALYTIC_OPCODE.UNION
        || opcode === ANALYTIC_OPCODE.INTERSECTION
        || opcode === ANALYTIC_OPCODE.DIFFERENCE) {
      if (operand !== 0 || depth < 2) {
        throw new RangeError(`MorphField: Fieldlet ${fieldletIndex} analytic instruction ${instruction} underflows or has a non-zero operand`);
      }
      depth -= 1;
    } else {
      throw new RangeError(`MorphField: Fieldlet ${fieldletIndex} uses unknown analytic opcode ${opcode}`);
    }
    maximumDepth = Math.max(maximumDepth, depth);
    if (maximumDepth > ANALYTIC_LIMITS.MAX_STACK_DEPTH) {
      throw new RangeError(`MorphField: Fieldlet ${fieldletIndex} exceeds the analytic stack limit`);
    }
  }
  if (depth !== 1) {
    throw new RangeError(`MorphField: Fieldlet ${fieldletIndex} analytic program leaves ${depth} stack values`);
  }
}

function validateGridFieldData(words, parameters, headerRef, subtype, fieldletIndex) {
  if (!Number.isInteger(headerRef) || headerRef < 0) {
    throw new RangeError(`MorphField: Fieldlet ${fieldletIndex} grid header ref is invalid`);
  }
  const base = headerRef * 4;
  if (base + 31 >= parameters.length) {
    throw new RangeError(`MorphField: Fieldlet ${fieldletIndex} grid header exceeds field parameters`);
  }
  const dimensions = [parameters[base], parameters[base + 1], parameters[base + 2]];
  const expectedKind = subtype === ABI_FIELDLET_SUBTYPE.ANALYTIC_PLUS_RESIDUAL ? 1 : 0;
  if (dimensions.some(value => !Number.isInteger(value) || value < 2 || value > 2048)
      || parameters[base + 3] !== expectedKind) {
    throw new RangeError(`MorphField: Fieldlet ${fieldletIndex} grid dimensions/kind are invalid`);
  }
  const valueCount = parameters[base + 7];
  const valuesRef = parameters[base + 11];
  const expectedValues = dimensions[0] * dimensions[1] * dimensions[2];
  if (!Number.isInteger(valueCount) || valueCount !== expectedValues
      || !Number.isInteger(valuesRef) || valuesRef < 0
      || valuesRef * 4 + valueCount > parameters.length) {
    throw new RangeError(`MorphField: Fieldlet ${fieldletIndex} grid sample range is invalid`);
  }
  for (let axis = 0; axis < 3; axis += 1) {
    if (!(parameters[base + 4 + axis] < parameters[base + 8 + axis])) {
      throw new RangeError(`MorphField: Fieldlet ${fieldletIndex} grid bounds are invalid`);
    }
  }
  const scale = parameters[base + 15];
  const quaternionLengthSquared = parameters[base + 16] ** 2
    + parameters[base + 17] ** 2
    + parameters[base + 18] ** 2
    + parameters[base + 19] ** 2;
  if (!(scale >= ANALYTIC_GPU_PARAMETER_MINIMUM) || !(quaternionLengthSquared > 1e-12)) {
    throw new RangeError(`MorphField: Fieldlet ${fieldletIndex} grid transform is invalid`);
  }
  const baseProgramOffset = parameters[base + 20];
  const baseProgramLength = parameters[base + 21];
  if (expectedKind === 0) {
    if (baseProgramOffset !== -1 || baseProgramLength !== 0) {
      throw new RangeError(`MorphField: Fieldlet ${fieldletIndex} sampled field unexpectedly has a base program`);
    }
    return null;
  }
  validateAnalyticProgram(words, parameters, baseProgramOffset, baseProgramLength, fieldletIndex);
  return Object.freeze({ offset: baseProgramOffset, length: baseProgramLength });
}

/**
 * Validate the compiler-to-runtime binary contract without granting runtime
 * trust.  This is intentionally useful for diagnostics and fuzzing; renderer
 * activation separately requires the private compiler-origin registry.
 */
export function validateCompiledSceneAbi(scene) {
  if (!scene || typeof scene !== "object") {
    throw new TypeError("MorphField: a compiled scene object is required");
  }
  if (scene.schema !== COMPILED_SCENE_SCHEMA
      || scene.version?.major !== MORPHFIELD_SCHEMA_VERSION.major
      || scene.version?.minor !== MORPHFIELD_SCHEMA_VERSION.minor) {
    throw new RangeError(`MorphField: unsupported compiled scene schema/version ${String(scene.schema)} ${String(scene.version?.major)}.${String(scene.version?.minor)}`);
  }
  if (!Number.isSafeInteger(scene.revision) || scene.revision < 0
      || !Number.isInteger(scene.sourceCrc32) || scene.sourceCrc32 < 0 || scene.sourceCrc32 > 0xffffffff) {
    throw new RangeError("MorphField: compiled scene revision/sourceCrc32 provenance is invalid");
  }
  const count = Number(scene.fieldletCount);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("MorphField: compiled Fieldlet count must be a non-negative safe integer");
  }
  const headers = requiredCompiledArray(scene, ["fieldletHeaders"], Uint32Array, "fieldletHeaders");
  const bounds = requiredCompiledArray(scene, ["bounds"], Float32Array, "bounds");
  const payloads = requiredCompiledArray(scene, ["payloads"], Float32Array, "payloads");
  const bundles = requiredCompiledArray(scene, ["certificateBundles"], Uint32Array, "certificateBundles");
  const surface = requiredCompiledArray(scene, ["surfaceCertificates"], Float32Array, "surfaceCertificates");
  const medium = requiredCompiledArray(scene, ["mediumCertificates"], Float32Array, "mediumCertificates");
  const motion = requiredCompiledArray(scene, ["motionCertificates"], Float32Array, "motionCertificates");
  const collision = requiredCompiledArray(scene, ["collisionCertificates"], Float32Array, "collisionCertificates");
  const words = requiredCompiledArray(scene, ["programWords"], Uint32Array, "programWords");
  const parameters = requiredCompiledArray(scene, ["analyticParameters"], Float32Array, "analyticParameters");
  const materials = requiredCompiledArray(scene, ["materials"], Float32Array, "materials");
  const bvhBounds = requiredCompiledArray(scene, ["bvhBounds", "bvhNodes"], Float32Array, "bvhBounds");
  const bvhMetadata = requiredCompiledArray(scene, ["bvhMetadata", "bvhIndices"], Uint32Array, "bvhMetadata");
  if (headers.length !== count * 4 || bounds.length !== count * 8
      || payloads.length !== count * PAYLOAD_FLOATS || bundles.length !== count * 4
      || words.length % 2 !== 0 || parameters.length % 16 !== 0
      || materials.length % MATERIAL_FLOATS !== 0 || bvhBounds.length % 8 !== 0
      || bvhMetadata.length % 4 !== 0 || bvhBounds.length / 8 !== bvhMetadata.length / 4) {
    throw new RangeError("MorphField: compiled scene arrays do not match the declared ABI counts/strides");
  }
  if (!Array.isArray(scene.ids) || scene.ids.length !== count
      || new Set(scene.ids).size !== count || scene.ids.some(id => typeof id !== "string")) {
    throw new RangeError("MorphField: compiled scene ids must uniquely cover every Fieldlet");
  }
  if (!scene.idToIndex || typeof scene.idToIndex !== "object"
      || Object.keys(scene.idToIndex).length !== count
      || scene.ids.some((id, index) => !Object.prototype.hasOwnProperty.call(scene.idToIndex, id)
        || scene.idToIndex[id] !== index)) {
    throw new RangeError("MorphField: compiled idToIndex must exactly map every stable id to its packed Fieldlet index");
  }
  validateFiniteRecordPool(bounds, 8, "bound");
  for (let bound = 0; bound < bounds.length / 8; bound += 1) {
    const base = bound * 8;
    for (let axis = 0; axis < 3; axis += 1) {
      if (bounds[base + axis] > bounds[base + 4 + axis]) {
        throw new RangeError(`MorphField: bound ${bound} has an inverted axis ${axis}`);
      }
    }
    if (bounds[base + 3] !== 0 || bounds[base + 7] !== 0) {
      throw new RangeError(`MorphField: bound ${bound} has non-zero ABI padding`);
    }
  }
  validateFiniteRecordPool(payloads, PAYLOAD_FLOATS, "payload");
  validateFiniteRecordPool(parameters, 16, "analytic parameter");
  validateFiniteRecordPool(materials, MATERIAL_FLOATS, "material", (pool, base) => (
    pool[base] >= 0 && pool[base] <= 1
      && pool[base + 1] >= 0 && pool[base + 1] <= 1
      && pool[base + 2] >= 0 && pool[base + 2] <= 1
      && pool[base + 3] >= 0 && pool[base + 3] <= 1
      && pool[base + 4] >= 0.02 && pool[base + 4] <= 1
      && pool[base + 5] >= 0 && pool[base + 5] <= 1
      && Number.isInteger(pool[base + 6]) && pool[base + 6] >= 0
      && pool[base + 7] > 1
      && pool[base + 8] >= 0 && pool[base + 9] >= 0 && pool[base + 10] >= 0
      && pool[base + 11] === 0
  ));
  validateFiniteRecordPool(surface, 4, "surface certificate", (pool, base) => (
    pool[base] >= 0 && pool[base + 1] > 0 && pool[base + 2] >= 0 && pool[base + 3] >= 0
  ));
  validateFiniteRecordPool(medium, 4, "medium certificate", (pool, base) => (
    pool[base] >= 0 && pool[base + 1] >= 0 && pool[base + 2] >= 0 && pool[base + 3] >= 0
  ));
  validateFiniteRecordPool(motion, 4, "motion certificate", (pool, base) => (
    pool[base] >= 0 && pool[base + 1] >= 0 && pool[base + 2] >= 0 && pool[base + 3] >= 0
  ));
  validateFiniteRecordPool(collision, 4, "collision certificate", (pool, base) => (
    pool[base] >= 0 && pool[base + 1] > 0 && pool[base + 2] >= 0 && pool[base + 3] >= 0
  ));

  const certificatePools = [surface, medium, motion, collision];
  const certificateQueryBits = [QUERY_MASK.SURFACE, QUERY_MASK.MEDIUM, QUERY_MASK.MOTION, QUERY_MASK.COLLISION];
  const certificateFlags = [
    FIELDLET_FLAG.CERTIFIED_SURFACE,
    FIELDLET_FLAG.CERTIFIED_MEDIUM,
    FIELDLET_FLAG.CERTIFIED_MOTION,
    FIELDLET_FLAG.CERTIFIED_COLLISION,
  ];
  const materialCount = materials.length / MATERIAL_FLOATS;
  const familySubtypeMaximum = [
    ABI_FIELDLET_SUBTYPE.ANALYTIC_MEDIUM,
    ABI_FIELDLET_SUBTYPE.ANALYTIC_PLUS_RESIDUAL,
    ABI_FIELDLET_SUBTYPE.ANISOTROPIC_SAMPLES,
    ABI_FIELDLET_SUBTYPE.INDEXED_TRIANGLES,
  ];
  const programCoverage = new Uint8Array(words.length / 2);
  for (let fieldlet = 0; fieldlet < count; fieldlet += 1) {
    const headerBase = fieldlet * 4;
    const boundsRef = headers[headerBase];
    const payloadRef = headers[headerBase + 1];
    const meta = headers[headerBase + 2];
    const bundleRef = headers[headerBase + 3];
    if (boundsRef !== fieldlet || payloadRef !== fieldlet || bundleRef !== fieldlet
        || boundsRef >= bounds.length / 8 || payloadRef >= payloads.length / PAYLOAD_FLOATS
        || bundleRef >= bundles.length / 4) {
      throw new RangeError(`MorphField: Fieldlet ${fieldlet} contains an out-of-range boundsRef, payloadRef, or certificateRef`);
    }
    const subtype = meta & 0xFFF;
    const family = (meta >>> 12) & 0xF;
    const queryMask = (meta >>> 16) & 0x3F;
    const flags = (meta >>> 22) & 0x3FF;
    if (family > ABI_FIELDLET_FAMILY.CACHED_SURFACE || subtype > familySubtypeMaximum[family]
        || (queryMask & QUERY_MASK.BOUND) === 0) {
      throw new RangeError(`MorphField: Fieldlet ${fieldlet} family/subtype/query mask is inconsistent`);
    }
    const payloadBase = payloadRef * PAYLOAD_FLOATS;
    const shape = payloads[payloadBase + 7];
    const programOffset = payloads[payloadBase + 12];
    const programLength = payloads[payloadBase + 13];
    const materialIndex = payloads[payloadBase + 14];
    if (!Number.isInteger(shape) || !Number.isInteger(materialIndex) || materialIndex < 0
        || materialIndex >= materialCount || payloads[payloadBase + 15] !== queryMask) {
      throw new RangeError(`MorphField: Fieldlet ${fieldlet} payload shape/material/query metadata is invalid`);
    }
    const validShape = (family === ABI_FIELDLET_FAMILY.ANALYTIC
        && ((subtype === ABI_FIELDLET_SUBTYPE.ANALYTIC_PROGRAM && shape >= PAYLOAD_SHAPE.SPHERE && shape <= PAYLOAD_SHAPE.CSG)
          || (subtype === ABI_FIELDLET_SUBTYPE.ANALYTIC_MEDIUM && shape === PAYLOAD_SHAPE.MEDIUM)))
      || (family === ABI_FIELDLET_FAMILY.SPARSE_RESIDUAL
        && ((subtype === ABI_FIELDLET_SUBTYPE.SAMPLED_FIELD && shape === PAYLOAD_SHAPE.SAMPLED_FIELD)
          || (subtype === ABI_FIELDLET_SUBTYPE.ANALYTIC_PLUS_RESIDUAL && shape === PAYLOAD_SHAPE.SPARSE_RESIDUAL)))
      || (family === ABI_FIELDLET_FAMILY.ORIENTED_KERNEL && shape === PAYLOAD_SHAPE.ORIENTED_SAMPLES)
      || (family === ABI_FIELDLET_FAMILY.CACHED_SURFACE && shape === PAYLOAD_SHAPE.INDEXED_SURFACE);
    if (!validShape) throw new RangeError(`MorphField: Fieldlet ${fieldlet} payload shape is inconsistent with its family/subtype`);
    const isMedium = family === ABI_FIELDLET_FAMILY.ANALYTIC
      && subtype === ABI_FIELDLET_SUBTYPE.ANALYTIC_MEDIUM;
    if (isMedium
      ? ((queryMask & QUERY_MASK.MEDIUM) === 0
        || (queryMask & (QUERY_MASK.SURFACE | QUERY_MASK.MATERIAL | QUERY_MASK.COLLISION)) !== 0)
      : ((queryMask & (QUERY_MASK.SURFACE | QUERY_MASK.MATERIAL))
          !== (QUERY_MASK.SURFACE | QUERY_MASK.MATERIAL)
        || (queryMask & QUERY_MASK.MEDIUM) !== 0)) {
      throw new RangeError(`MorphField: Fieldlet ${fieldlet} query mask is inconsistent with its representation`);
    }
    if (family === ABI_FIELDLET_FAMILY.SPARSE_RESIDUAL) {
      if (programLength !== 0) {
        throw new RangeError(`MorphField: Fieldlet ${fieldlet} residual payload length must be zero`);
      }
      const baseProgram = validateGridFieldData(words, parameters, programOffset, subtype, fieldlet);
      if (baseProgram) {
        for (let instruction = baseProgram.offset; instruction < baseProgram.offset + baseProgram.length; instruction += 1) {
          if (programCoverage[instruction]) {
            throw new RangeError(`MorphField: Fieldlet ${fieldlet} residual base program overlaps another Fieldlet range`);
          }
          programCoverage[instruction] = 1;
        }
      }
    } else if (programLength === 0) {
      if (programOffset !== -1 || (family === ABI_FIELDLET_FAMILY.ANALYTIC
          && subtype === ABI_FIELDLET_SUBTYPE.ANALYTIC_PROGRAM && shape === PAYLOAD_SHAPE.CSG)) {
        throw new RangeError(`MorphField: Fieldlet ${fieldlet} direct/program payload range is inconsistent`);
      }
    } else {
      if (family !== ABI_FIELDLET_FAMILY.ANALYTIC
          || subtype !== ABI_FIELDLET_SUBTYPE.ANALYTIC_PROGRAM || shape !== PAYLOAD_SHAPE.CSG) {
        throw new RangeError(`MorphField: Fieldlet ${fieldlet} assigns an analytic program to an unsupported representation`);
      }
      validateAnalyticProgram(words, parameters, programOffset, programLength, fieldlet);
      for (let instruction = programOffset; instruction < programOffset + programLength; instruction += 1) {
        if (programCoverage[instruction]) {
          throw new RangeError(`MorphField: Fieldlet ${fieldlet} analytic program overlaps another Fieldlet range`);
        }
        programCoverage[instruction] = 1;
      }
    }
    const bundleBase = bundleRef * 4;
    for (let slot = 0; slot < 4; slot += 1) {
      const reference = bundles[bundleBase + slot];
      if (!validReference(reference, certificatePools[slot].length / 4)) {
        throw new RangeError(`MorphField: Fieldlet ${fieldlet} certificate bundle slot ${slot} has invalid ref ${reference}`);
      }
      const present = reference !== INVALID_REF;
      if (Boolean(flags & certificateFlags[slot]) !== present
          || (present && (queryMask & certificateQueryBits[slot]) === 0)) {
        throw new RangeError(`MorphField: Fieldlet ${fieldlet} certificate flags/query mask do not match bundle slot ${slot}`);
      }
    }
  }
  if (programCoverage.some(value => value === 0)) {
    throw new RangeError("MorphField: analytic programWords contain an unreferenced instruction");
  }
  return true;
}

export function normalizeCompiledScene(scene) {
  if (!scene || typeof scene !== "object") throw new TypeError("MorphField.setScene: a compiled scene is required");
  validateCompiledSceneAbi(scene);
  const canonical = canonicalTypedScene(scene);
  if (!canonical) throw new TypeError("MorphField: compiled scene is missing its typed Fieldlet ABI");
  if (!isCompilerProducedCompiledScene(scene) && !verifyCompiledSceneProvenance(scene)) {
    throw new TypeError("MorphField: renderer activation requires compiler-produced or byte-identical provenance-qualified ABI data; authored/modified Fieldlets and certificates are not trusted");
  }
  validateMaterialRecords(canonical.materials);
  const spatial = packSpatialRecords(canonical);
  return { ...canonical, spatialRecords: spatial.data, spatialStats: spatial.stats };
}

function byteView(data) {
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function align4(value) {
  return Math.max(16, (value + 3) & ~3);
}

function certifiedSurfaceEnvelope(canonical) {
  let errorMax = 0;
  let lipschitzMax = 1;
  let fallbackBand = 0;
  let certifiedCount = 0;
  for (let index = 0; index < canonical.fieldletCount; index += 1) {
    const family = (canonical.fieldletHeaders[index * 4 + 2] >>> 12) & 0xF;
    const metadata = canonical.fieldletHeaders[index * 4 + 2];
    const flags = (metadata >>> 22) & 0x3ff;
    if ((flags & FIELDLET_FLAG.CERTIFIED_SURFACE) === 0) continue;
    const base = index * 4;
    const error = canonical.resolvedSurfaceCertificates[base];
    const lipschitz = canonical.resolvedSurfaceCertificates[base + 1];
    const fallback = canonical.resolvedSurfaceCertificates[base + 2];
    if (!Number.isFinite(error) || !Number.isFinite(lipschitz) || !Number.isFinite(fallback)
        || error < 0 || lipschitz <= 0 || fallback < 0) continue;
    errorMax = Math.max(errorMax, error);
    lipschitzMax = Math.max(lipschitzMax, lipschitz);
    fallbackBand = Math.max(fallbackBand, fallback);
    certifiedCount += 1;
  }
  return Object.freeze({ errorMax, lipschitzMax, fallbackBand, certifiedCount });
}

function validateFieldletBounds(canonical) {
  const boundCount = canonical.bounds.length / 8;
  for (let boundIndex = 0; boundIndex < boundCount; boundIndex += 1) {
    const base = boundIndex * 8;
    for (let component = 0; component < 8; component += 1) {
      if (!Number.isFinite(canonical.bounds[base + component])) {
        throw new RangeError(`MorphField: bound ${boundIndex} contains a non-finite component`);
      }
    }
    for (let axis = 0; axis < 3; axis += 1) {
      if (canonical.bounds[base + axis] > canonical.bounds[base + 4 + axis]) {
        throw new RangeError(`MorphField: bound ${boundIndex} has an inverted axis ${axis}`);
      }
    }
  }
  for (let fieldletIndex = 0; fieldletIndex < canonical.fieldletCount; fieldletIndex += 1) {
    const boundsRef = canonical.fieldletHeaders[fieldletIndex * 4];
    if (boundsRef >= boundCount) {
      throw new RangeError(`MorphField: Fieldlet ${fieldletIndex} boundsRef ${boundsRef} is outside ${boundCount} bounds`);
    }
  }
  return boundCount;
}

function validatePackedBvh(canonical) {
  const nodeCount = canonical.bvhNodes.length / 8;
  const boundCount = validateFieldletBounds(canonical);
  const root = Number(canonical.bvhRoot);
  if (!Number.isInteger(root) || root < 0 || root >= nodeCount
      || nodeCount < 1 || canonical.bvhIndices.length !== nodeCount * 4) {
    return Object.freeze({ usable: false, nodeCount: 0, root: ABSENT_REF, depth: 0, reason: "absent" });
  }
  const reached = new Uint8Array(nodeCount);
  const leaves = new Uint8Array(Math.max(1, canonical.fieldletCount));
  for (let fieldletIndex = 0; fieldletIndex < canonical.fieldletCount; fieldletIndex += 1) {
    const boundsRef = canonical.fieldletHeaders[fieldletIndex * 4];
    if (boundsRef >= boundCount) {
      return Object.freeze({ usable: false, nodeCount: 0, root: ABSENT_REF, depth: 0, reason: "invalid-bounds-ref" });
    }
  }
  const containsBounds = (outerOffset, inner, innerOffset) => {
    for (let axis = 0; axis < 3; axis += 1) {
      if (canonical.bvhNodes[outerOffset + axis] > inner[innerOffset + axis]
          || canonical.bvhNodes[outerOffset + 4 + axis] < inner[innerOffset + 4 + axis]) return false;
    }
    return true;
  };
  const stack = [{ node: root, depth: 1 }];
  let maximumDepth = 0;
  let reachedCount = 0;
  while (stack.length > 0) {
    const { node, depth } = stack.pop();
    if (node < 0 || node >= nodeCount || reached[node]) {
      return Object.freeze({ usable: false, nodeCount: 0, root: ABSENT_REF, depth: 0, reason: "invalid-topology" });
    }
    reached[node] = 1;
    reachedCount += 1;
    maximumDepth = Math.max(maximumDepth, depth);
    const boundBase = node * 8;
    const minimum = canonical.bvhNodes.subarray(boundBase, boundBase + 3);
    const maximum = canonical.bvhNodes.subarray(boundBase + 4, boundBase + 7);
    if (![...minimum, ...maximum].every(Number.isFinite)
        || minimum.some((value, axis) => value > maximum[axis])) {
      return Object.freeze({ usable: false, nodeCount: 0, root: ABSENT_REF, depth: 0, reason: "invalid-bounds" });
    }
    const metaBase = node * 4;
    const left = canonical.bvhIndices[metaBase];
    const right = canonical.bvhIndices[metaBase + 1];
    const sourceIndex = canonical.bvhIndices[metaBase + 2];
    const isLeaf = canonical.bvhIndices[metaBase + 3];
    if (isLeaf === 1) {
      if (left !== ABSENT_REF || right !== ABSENT_REF || sourceIndex >= canonical.fieldletCount
          || leaves[sourceIndex]) {
        return Object.freeze({ usable: false, nodeCount: 0, root: ABSENT_REF, depth: 0, reason: "invalid-leaf" });
      }
      const boundsRef = canonical.fieldletHeaders[sourceIndex * 4];
      if (!containsBounds(boundBase, canonical.bounds, boundsRef * 8)) {
        return Object.freeze({ usable: false, nodeCount: 0, root: ABSENT_REF, depth: 0, reason: "leaf-does-not-enclose-fieldlet" });
      }
      leaves[sourceIndex] = 1;
    } else if (isLeaf === 0) {
      if (left >= nodeCount || right >= nodeCount || left === node || right === node
          || sourceIndex !== ABSENT_REF) {
        return Object.freeze({ usable: false, nodeCount: 0, root: ABSENT_REF, depth: 0, reason: "invalid-branch" });
      }
      stack.push({ node: right, depth: depth + 1 }, { node: left, depth: depth + 1 });
    } else {
      return Object.freeze({ usable: false, nodeCount: 0, root: ABSENT_REF, depth: 0, reason: "invalid-kind" });
    }
  }
  const leafCount = leaves.reduce((sum, value) => sum + value, 0);
  if (reachedCount !== nodeCount || leafCount !== canonical.fieldletCount) {
    return Object.freeze({ usable: false, nodeCount: 0, root: ABSENT_REF, depth: 0, reason: "incomplete" });
  }
  for (let node = 0; node < nodeCount; node += 1) {
    const metaBase = node * 4;
    if (canonical.bvhIndices[metaBase + 3] === 1) continue;
    const outerOffset = node * 8;
    const leftOffset = canonical.bvhIndices[metaBase] * 8;
    const rightOffset = canonical.bvhIndices[metaBase + 1] * 8;
    if (!containsBounds(outerOffset, canonical.bvhNodes, leftOffset)
        || !containsBounds(outerOffset, canonical.bvhNodes, rightOffset)) {
      return Object.freeze({ usable: false, nodeCount: 0, root: ABSENT_REF, depth: 0, reason: "branch-does-not-enclose-children" });
    }
  }
  return Object.freeze({ usable: true, nodeCount, root, depth: maximumDepth, reason: "validated" });
}

/**
 * Pack Fieldlet bounds, compiler BVH nodes, per-Fieldlet collision metadata,
 * and one validated scene trailer in a single storage binding. WebGPU
 * guarantees only eight storage buffers per shader stage on the portable
 * baseline, so tracing and queries cannot add separate spatial or collision
 * bindings to the existing scene ABI.
 */
export function packSpatialRecords(canonical) {
  const boundCount = canonical.bounds.length / 8;
  const bvh = validatePackedBvh(canonical);
  const envelope = certifiedSurfaceEnvelope(canonical);
  const collisionMetadataCount = canonical.fieldletCount;
  const collisionMetadataOffset = boundCount + bvh.nodeCount;
  const recordCount = collisionMetadataOffset + collisionMetadataCount + 1;
  const bytes = new ArrayBuffer(recordCount * SPATIAL_RECORD_WORDS * 4);
  const floats = new Float32Array(bytes);
  const words = new Uint32Array(bytes);
  for (let index = 0; index < boundCount; index += 1) {
    const sourceBase = index * 8;
    const targetBase = index * SPATIAL_RECORD_WORDS;
    floats.set(canonical.bounds.subarray(sourceBase, sourceBase + 3), targetBase);
    words[targetBase + 3] = ABSENT_REF;
    floats.set(canonical.bounds.subarray(sourceBase + 4, sourceBase + 7), targetBase + 4);
    words[targetBase + 7] = 0;
  }
  // Thread every validated node to the next node outside its subtree. The
  // compiler BVH may use any deterministic node ordering, so derive ropes
  // from child references instead of assuming pre-order indices. The escape
  // occupies the otherwise-padding fourth word of each 48-byte record; the
  // canonical left/right/source/kind metadata remains unchanged.
  const escapeIndices = new Uint32Array(bvh.nodeCount).fill(ABSENT_REF);
  if (bvh.usable) {
    const pending = [{ node: bvh.root, escape: ABSENT_REF }];
    while (pending.length > 0) {
      const { node, escape } = pending.pop();
      escapeIndices[node] = escape;
      const metaBase = node * 4;
      if (canonical.bvhIndices[metaBase + 3] === 0) {
        const left = canonical.bvhIndices[metaBase];
        const right = canonical.bvhIndices[metaBase + 1];
        pending.push({ node: right, escape }, { node: left, escape: right });
      }
    }
  }
  for (let index = 0; index < bvh.nodeCount; index += 1) {
    const sourceBoundBase = index * 8;
    const sourceMetaBase = index * 4;
    const targetBase = (boundCount + index) * SPATIAL_RECORD_WORDS;
    floats.set(canonical.bvhNodes.subarray(sourceBoundBase, sourceBoundBase + 3), targetBase);
    words[targetBase + 3] = escapeIndices[index];
    floats.set(canonical.bvhNodes.subarray(sourceBoundBase + 4, sourceBoundBase + 7), targetBase + 4);
    words[targetBase + 7] = 0;
    words.set(canonical.bvhIndices.subarray(sourceMetaBase, sourceMetaBase + 4), targetBase + 8);
  }
  // Collision metadata shares the spatial storage binding so the query
  // pipeline remains within WebGPU's portable eight-storage-buffer limit.
  // The final vec4<u32> of each SpatialRecord stores enabled/layer/mask and
  // the f32 restOffset bits. The scene trailer remains the final record.
  for (let index = 0; index < collisionMetadataCount; index += 1) {
    const targetBase = (collisionMetadataOffset + index) * SPATIAL_RECORD_WORDS;
    words[targetBase + 3] = ABSENT_REF;
    words[targetBase + 7] = 0;
    words.set(canonical.collisionMetadata.subarray(index * 4, index * 4 + 4), targetBase + 8);
  }
  const trailerBase = (recordCount - 1) * SPATIAL_RECORD_WORDS;
  floats[trailerBase] = envelope.errorMax;
  floats[trailerBase + 1] = envelope.lipschitzMax;
  floats[trailerBase + 2] = envelope.fallbackBand;
  words[trailerBase + 3] = ABSENT_REF;
  words[trailerBase + 8] = boundCount;
  words[trailerBase + 9] = bvh.nodeCount;
  words[trailerBase + 10] = bvh.root;
  words[trailerBase + 11] = SPATIAL_RECORD_MAGIC;
  return Object.freeze({
    data: words,
    stats: Object.freeze({
      mode: bvh.usable ? "bvh" : "linear",
      reason: bvh.reason,
      boundCount,
      nodeCount: bvh.nodeCount,
      collisionMetadataOffset,
      collisionMetadataCount,
      root: bvh.root,
      depth: bvh.depth,
      traversal: bvh.usable ? "threaded" : "linear",
      certifiedCount: envelope.certifiedCount,
      bytes: words.byteLength,
    }),
  });
}

function sceneBufferEntries(canonical) {
  return {
    fieldletHeaders: canonical.fieldletHeaders,
    bounds: canonical.bounds,
    payloads: canonical.payloads,
    certificateBundles: canonical.certificateBundles,
    surfaceCertificates: canonical.surfaceCertificates,
    resolvedSurfaceCertificates: canonical.resolvedSurfaceCertificates,
    resolvedCertificates: canonical.resolvedCertificates,
    programWords: canonical.programWords,
    analyticParameters: canonical.analyticParameters,
    materials: canonical.materials,
    spatialRecords: canonical.spatialRecords,
  };
}

function canonicalLayoutSignature(canonical) {
  return {
    fieldletCount: canonical.fieldletCount,
    fieldletHeaders: canonical.fieldletHeaders.byteLength,
    bounds: canonical.bounds.byteLength,
    payloads: canonical.payloads.byteLength,
    certificateBundles: canonical.certificateBundles.byteLength,
    surfaceCertificates: canonical.surfaceCertificates.byteLength,
    mediumCertificates: canonical.mediumCertificates.byteLength,
    motionCertificates: canonical.motionCertificates.byteLength,
    collisionCertificates: canonical.collisionCertificates.byteLength,
    programWords: canonical.programWords.byteLength,
    analyticParameters: canonical.analyticParameters.byteLength,
    materials: canonical.materials.byteLength,
    bvhBounds: canonical.bvhNodes.byteLength,
    bvhMetadata: canonical.bvhIndices.byteLength,
  };
}

function sameLayout(left, right) {
  return left && Object.entries(right).every(([name, value]) => Number(left[name]) === value);
}

function sameTypedArray(left, right) {
  if (left?.constructor !== right?.constructor || left?.length !== right?.length) return false;
  for (let index = 0; index < left.length; index += 1) if (!Object.is(left[index], right[index])) return false;
  return true;
}

function normalizedIndices(value, maximum, name) {
  if (!Array.isArray(value)) return null;
  const result = [];
  let previous = -1;
  for (const entry of value) {
    const index = Number(entry);
    if (!Number.isInteger(index) || index < 0 || index >= maximum || index <= previous) return null;
    result.push(index);
    previous = index;
  }
  return result;
}

function indexRanges(indices, stride) {
  const ranges = [];
  for (const index of indices) {
    const start = index * stride;
    const last = ranges.at(-1);
    if (last && last.end === start) last.end += stride;
    else ranges.push({ start, end: start + stride });
  }
  return ranges;
}

function normalizedElementRanges(value, maximum, name) {
  if (!Array.isArray(value)) return null;
  const source = [];
  for (const entry of value) {
    const start = Number(entry?.offset);
    const length = Number(entry?.length);
    if (!Number.isInteger(start) || start < 0 || !Number.isInteger(length) || length <= 0 || start + length > maximum) {
      return null;
    }
    source.push({ start, end: start + length });
  }
  source.sort((a, b) => a.start - b.start || a.end - b.end);
  const result = [];
  for (const range of source) {
    const last = result.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else result.push({ ...range });
  }
  return result;
}

function changesStayInside(current, next, ranges) {
  if (current.constructor !== next.constructor || current.length !== next.length) return false;
  let rangeIndex = 0;
  for (let index = 0; index < current.length; index += 1) {
    while (rangeIndex < ranges.length && index >= ranges[rangeIndex].end) rangeIndex += 1;
    if (!Object.is(current[index], next[index])
        && (rangeIndex >= ranges.length || index < ranges[rangeIndex].start)) return false;
  }
  return true;
}

function idsEqual(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function compatibleSceneEntries(buffers, currentEntries, nextEntries) {
  return Boolean(buffers && currentEntries)
    && Object.entries(nextEntries).every(([name, data]) => (
      buffers[name]
      && currentEntries[name]?.constructor === data.constructor
      && currentEntries[name].byteLength === data.byteLength
    ));
}

export class SceneBufferUploader {
  constructor(device, tracker, capabilities) {
    this.device = device;
    this.tracker = tracker;
    this.capabilities = capabilities;
    this.buffers = null;
    this.canonical = null;
    this.tainted = false;
    this.lastPublication = Object.freeze({ mode: "none", bytesWritten: 0, writeCount: 0, reallocated: false, tainted: false });
  }

  upload(scene) {
    const canonical = normalizeCompiledScene(scene);
    return this._replaceBuffers(canonical);
  }

  // Renderer bootstrap needs allocated bindings before the host supplies a
  // compiled scene.  This path is deliberately private to the uploader and
  // can represent only zero Fieldlets, so it cannot manufacture a certified
  // surface or collision query from authored objects.
  uploadEmpty() {
    const empty = objectSceneToCanonical({
      id: "morphfield-runtime-empty",
      revision: 0,
      fieldlets: [],
    });
    validateMaterialRecords(empty.materials);
    const spatial = packSpatialRecords(empty);
    return this._replaceBuffers({ ...empty, spatialRecords: spatial.data, spatialStats: spatial.stats });
  }

  _replaceBuffers(canonical) {
    const entries = sceneBufferEntries(canonical);
    const replacement = {};
    try {
      for (const [name, data] of Object.entries(entries)) replacement[name] = this._uploadBuffer(name, data);
    } catch (error) {
      for (const buffer of Object.values(replacement)) this.tracker.release(buffer);
      throw error;
    }
    const previous = this.buffers;
    this.buffers = replacement;
    this.canonical = canonical;
    this.tainted = false;
    if (previous) for (const buffer of Object.values(previous)) this.tracker.release(buffer);
    this.lastPublication = Object.freeze({
      mode: "full-replacement",
      bytesWritten: Object.values(entries).reduce((sum, data) => sum + data.byteLength, 0),
      writeCount: Object.keys(entries).length,
      reallocated: true,
      tainted: false,
    });
    return canonical;
  }

  _recoverInPlacePublication(canonical, error, attemptedMode, bytesWritten, writeCount) {
    this.tainted = true;
    try {
      const recovered = this._replaceBuffers(canonical);
      const recovery = this.lastPublication;
      this.lastPublication = Object.freeze({
        mode: "full-replacement-recovery",
        attemptedMode,
        bytesWritten: bytesWritten + recovery.bytesWritten,
        writeCount: writeCount + recovery.writeCount,
        recoveryBytesWritten: recovery.bytesWritten,
        recoveryWriteCount: recovery.writeCount,
        reallocated: true,
        tainted: false,
      });
      return Object.freeze({
        canonical: recovered,
        ...this.lastPublication,
        deltaFallbackReason: `${attemptedMode}-write-failed`,
      });
    } catch (recoveryError) {
      const poisonedBuffers = this.buffers;
      this.buffers = null;
      this.tainted = true;
      let cleanupError = null;
      if (poisonedBuffers) {
        for (const buffer of Object.values(poisonedBuffers)) {
          try {
            this.tracker.release(buffer);
          } catch (releaseError) {
            cleanupError ||= releaseError;
          }
        }
      }
      this.lastPublication = Object.freeze({
        mode: `${attemptedMode}-failed-closed`,
        bytesWritten,
        writeCount,
        reallocated: false,
        tainted: true,
      });
      const publicationError = error instanceof Error
        ? error
        : new Error(`MorphField: ${attemptedMode} publication failed: ${String(error)}`);
      try {
        Object.defineProperty(publicationError, "recoveryError", {
          configurable: true,
          value: recoveryError,
        });
      } catch {}
      if (cleanupError) {
        try {
          Object.defineProperty(publicationError, "cleanupError", {
            configurable: true,
            value: cleanupError,
          });
        } catch {}
      }
      throw publicationError;
    }
  }

  update(scene, runtimeDelta = null) {
    const canonical = normalizeCompiledScene(scene);
    const currentEntries = this.canonical ? sceneBufferEntries(this.canonical) : null;
    const nextEntries = sceneBufferEntries(canonical);
    const compatible = !this.tainted && compatibleSceneEntries(this.buffers, currentEntries, nextEntries);
    if (runtimeDelta && compatible) {
      const incremental = this._publishRuntimeDelta(canonical, runtimeDelta, currentEntries, nextEntries);
      if (incremental) return incremental;
    }
    if (!compatible) return Object.freeze({
      canonical: this._replaceBuffers(canonical),
      reallocated: true,
      ...this.lastPublication,
      deltaFallbackReason: runtimeDelta ? "incompatible-buffer-layout" : null,
    });
    let bytesWritten = 0;
    let writeCount = 0;
    try {
      for (const [name, data] of Object.entries(nextEntries)) {
        if (data.byteLength > 0) {
          this.device.queue.writeBuffer(this.buffers[name], 0, byteView(data));
          bytesWritten += data.byteLength;
          writeCount += 1;
        }
      }
    } catch (error) {
      return this._recoverInPlacePublication(canonical, error, "full-in-place", bytesWritten, writeCount);
    }
    this.canonical = canonical;
    this.lastPublication = Object.freeze({ mode: "full-in-place", bytesWritten, writeCount, reallocated: false, tainted: false });
    return Object.freeze({
      canonical,
      reallocated: false,
      ...this.lastPublication,
      deltaFallbackReason: runtimeDelta ? "runtime-delta-validation-failed" : null,
    });
  }

  _publishRuntimeDelta(canonical, delta, currentEntries, nextEntries) {
    const current = this.canonical;
    if (delta?.schema !== RUNTIME_DELTA_SCHEMA || delta.mode !== "stable-analytic"
        || delta.sceneId !== current.sceneId || canonical.sceneId !== current.sceneId
        || delta.baseRevision !== current.revision || delta.revision !== canonical.revision
        || delta.baselineSourceCrc32 !== current.sourceCrc32 || delta.sourceCrc32 !== canonical.sourceCrc32
        || !sameLayout(delta.baselineLayout, canonicalLayoutSignature(current))
        || !sameLayout(delta.baselineLayout, canonicalLayoutSignature(canonical))
        || !idsEqual(current.ids, canonical.ids)) return null;

    const fieldlets = normalizedIndices(delta.fieldletIndices, canonical.fieldletCount, "fieldletIndices");
    const surface = normalizedIndices(delta.certificateRecords?.surface, canonical.surfaceCertificates.length / 4, "surfaceCertificates");
    const medium = normalizedIndices(delta.certificateRecords?.medium, canonical.mediumCertificates.length / 4, "mediumCertificates");
    const motion = normalizedIndices(delta.certificateRecords?.motion, canonical.motionCertificates.length / 4, "motionCertificates");
    const collision = normalizedIndices(delta.certificateRecords?.collision, canonical.collisionCertificates.length / 4, "collisionCertificates");
    const parameters = normalizedIndices(delta.analyticParameterIndices, canonical.analyticParameters.length / 16, "analyticParameterIndices");
    const bvhNodes = normalizedIndices(delta.bvhNodeIndices, canonical.bvhNodes.length / 8, "bvhNodeIndices");
    const program = normalizedElementRanges(delta.programRanges, canonical.programWords.length, "programRanges");
    if (!fieldlets || !surface || !medium || !motion || !collision || !parameters || !bvhNodes || !program) return null;

    const fieldlet4 = indexRanges(fieldlets, 4);
    const fieldlet8 = indexRanges(fieldlets, 8);
    const fieldlet16 = indexRanges(fieldlets, 16);
    const surface4 = indexRanges(surface, 4);
    const medium4 = indexRanges(medium, 4);
    const motion4 = indexRanges(motion, 4);
    const collision4 = indexRanges(collision, 4);
    const parameter16 = indexRanges(parameters, 16);
    const bvh8 = indexRanges(bvhNodes, 8);
    if (!changesStayInside(current.fieldletHeaders, canonical.fieldletHeaders, fieldlet4)
        || !changesStayInside(current.bounds, canonical.bounds, fieldlet8)
        || !changesStayInside(current.payloads, canonical.payloads, fieldlet16)
        || !changesStayInside(current.certificateBundles, canonical.certificateBundles, fieldlet4)
        || !changesStayInside(current.surfaceCertificates, canonical.surfaceCertificates, surface4)
        || !changesStayInside(current.mediumCertificates, canonical.mediumCertificates, medium4)
        || !changesStayInside(current.motionCertificates, canonical.motionCertificates, motion4)
        || !changesStayInside(current.collisionCertificates, canonical.collisionCertificates, collision4)
        || !changesStayInside(current.resolvedSurfaceCertificates, canonical.resolvedSurfaceCertificates, fieldlet4)
        || !changesStayInside(current.resolvedCertificates, canonical.resolvedCertificates, fieldlet16)
        || !changesStayInside(current.collisionMetadata, canonical.collisionMetadata, fieldlet4)
        || !changesStayInside(current.programWords, canonical.programWords, program)
        || !changesStayInside(current.analyticParameters, canonical.analyticParameters, parameter16)
        || !sameTypedArray(current.materials, canonical.materials)
        || !changesStayInside(current.bvhNodes, canonical.bvhNodes, bvh8)
        || !sameTypedArray(current.bvhIndices, canonical.bvhIndices)) return null;

    const boundCount = canonical.bounds.length / 8;
    const spatialIndices = new Set([canonical.spatialRecords.length / SPATIAL_RECORD_WORDS - 1]);
    for (const fieldletIndex of fieldlets) {
      const boundsRef = canonical.fieldletHeaders[fieldletIndex * 4];
      if (boundsRef >= boundCount) return null;
      spatialIndices.add(boundsRef);
      spatialIndices.add(canonical.spatialStats.collisionMetadataOffset + fieldletIndex);
    }
    for (const nodeIndex of bvhNodes) spatialIndices.add(boundCount + nodeIndex);
    const spatialRanges = indexRanges([...spatialIndices].sort((a, b) => a - b), SPATIAL_RECORD_WORDS);
    if (!changesStayInside(current.spatialRecords, canonical.spatialRecords, spatialRanges)) return null;

    const writes = [
      ["fieldletHeaders", fieldlet4],
      ["bounds", fieldlet8],
      ["payloads", fieldlet16],
      ["certificateBundles", fieldlet4],
      ["surfaceCertificates", surface4],
      ["resolvedSurfaceCertificates", fieldlet4],
      ["resolvedCertificates", fieldlet16],
      ["programWords", program],
      ["analyticParameters", parameter16],
      ["spatialRecords", spatialRanges],
    ];
    let bytesWritten = 0;
    let writeCount = 0;
    try {
      for (const [name, ranges] of writes) {
        const currentData = currentEntries[name];
        const nextData = nextEntries[name];
        for (const range of ranges) {
          let differs = false;
          for (let index = range.start; index < range.end; index += 1) {
            if (!Object.is(currentData[index], nextData[index])) { differs = true; break; }
          }
          if (!differs) continue;
          const slice = nextData.subarray(range.start, range.end);
          const byteOffset = range.start * nextData.BYTES_PER_ELEMENT;
          this.device.queue.writeBuffer(this.buffers[name], byteOffset, byteView(slice));
          bytesWritten += slice.byteLength;
          writeCount += 1;
        }
      }
    } catch (error) {
      return this._recoverInPlacePublication(canonical, error, "incremental-stable-analytic", bytesWritten, writeCount);
    }
    this.canonical = canonical;
    this.lastPublication = Object.freeze({
      mode: "incremental-stable-analytic",
      bytesWritten,
      writeCount,
      reallocated: false,
      tainted: false,
      touchedFieldlets: fieldlets.length,
      touchedBvhNodes: bvhNodes.length,
    });
    return Object.freeze({ canonical, ...this.lastPublication, deltaFallbackReason: null });
  }

  mergePatch(patch) {
    if (!this.canonical) throw new Error("MorphField.applyPatch: setScene must be called first");
    if (!patch || typeof patch !== "object") throw new TypeError("MorphField.applyPatch: a compiled patch is required");
    const snapshot = patch.compiledScene || patch.scene || patch.snapshot;
    const directSnapshot = patch.runtime || patch.gpuData || patch.fieldletHeaders || patch.headers ? patch : null;
    const payload = snapshot || directSnapshot;
    const revisionValue = patch.revision ?? payload?.revision;
    const completeSnapshot = patch.completeSnapshot === true;
    const expectedRevision = this.canonical.revision + 1;
    if (!Number.isInteger(revisionValue) || revisionValue < 0) {
      throw new RangeError("MorphField.applyPatch: patch revision must be a non-negative integer");
    }
    const revision = revisionValue;
    if (completeSnapshot ? revision <= this.canonical.revision : revision !== expectedRevision) {
      const kind = revision < expectedRevision ? "stale" : "skipped";
      throw new RangeError(`MorphField.applyPatch: ${kind} revision ${revision}; expected ${completeSnapshot ? `greater than ${this.canonical.revision}` : expectedRevision}`);
    }
    if (payload) {
      if (!Number.isInteger(payload.revision) || payload.revision < 0) {
        throw new RangeError("MorphField.applyPatch: compiled payload revision must be a non-negative integer");
      }
      if (payload.revision !== revision) {
        throw new RangeError("MorphField.applyPatch: compiled payload revision does not match its patch envelope");
      }
    }
    const payloadSceneId = payload?.sceneId ?? payload?.id;
    if (payloadSceneId !== undefined && String(payloadSceneId) !== this.canonical.sceneId) {
      throw new RangeError(`MorphField.applyPatch: compiled payload scene ${String(payloadSceneId)} does not match ${this.canonical.sceneId}`);
    }
    if (payload) return payload;
    if (!this.canonical.objectFieldlets) {
      throw new Error("MorphField.applyPatch: incremental object patches require object-backed compiled Fieldlets");
    }
    const byId = new Map(this.canonical.objectFieldlets.map((entry, index) => [String(entry.id ?? index), { ...entry }]));
    for (const id of patch.remove || patch.removed || []) byId.delete(String(id?.id ?? id));
    for (const entry of patch.upsert || patch.upserts || []) {
      if (!entry || entry.id === undefined) throw new TypeError("MorphField.applyPatch: every upsert needs a stable id");
      byId.set(String(entry.id), { ...entry });
    }
    return { revision, fieldlets: Array.from(byId.values()), materials: patch.materials };
  }

  release() {
    if (this.buffers) {
      for (const buffer of Object.values(this.buffers)) this.tracker.release(buffer);
    }
    this.buffers = null;
    this.tainted = false;
  }

  getStats() {
    const canonical = this.canonical;
    return {
      revision: canonical?.revision ?? 0,
      fieldletCount: canonical?.fieldletCount ?? 0,
      materialCount: canonical ? canonical.materials.length / MATERIAL_FLOATS : 0,
      bvhNodeCount: canonical ? canonical.bvhNodes.length / 8 : 0,
      spatial: canonical?.spatialStats || null,
      publication: this.lastPublication,
      tainted: this.tainted,
      usable: Boolean(this.buffers) && !this.tainted,
      uploadedBytes: canonical ? [
        canonical.fieldletHeaders,
        canonical.bounds,
        canonical.payloads,
        canonical.certificateBundles,
        canonical.surfaceCertificates,
        canonical.resolvedSurfaceCertificates,
        canonical.resolvedCertificates,
        canonical.programWords,
        canonical.analyticParameters,
        canonical.materials,
        canonical.spatialRecords,
      ].reduce((total, data) => total + data.byteLength, 0) : 0,
    };
  }

  _uploadBuffer(name, data) {
    const size = align4(data.byteLength);
    if (size > this.capabilities.limits.maxStorageBufferBindingSize) {
      throw new RangeError(`MorphField: ${name} exceeds maxStorageBufferBindingSize`);
    }
    const buffer = this.tracker.own(this.device.createBuffer({
      label: `MorphField.${name}`,
      size,
      usage: bufferUsage("STORAGE", "COPY_DST", "COPY_SRC"),
    }), { kind: "scene-buffer", label: name, bytes: size });
    try {
      if (data.byteLength > 0) this.device.queue.writeBuffer(buffer, 0, byteView(data));
      return buffer;
    } catch (error) {
      this.tracker.release(buffer);
      throw error;
    }
  }
}
