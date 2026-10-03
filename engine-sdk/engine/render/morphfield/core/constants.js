// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const MORPHFIELD_SCHEMA_VERSION = Object.freeze({ major: 2, minor: 0 });

export const FIELDLET_FAMILY = Object.freeze({
  ANALYTIC: 0,
  SPARSE_RESIDUAL: 1,
  ORIENTED_KERNEL: 2,
  CACHED_SURFACE: 3,
});

export const FIELDLET_FAMILY_NAME = Object.freeze({
  [FIELDLET_FAMILY.ANALYTIC]: 'analytic',
  [FIELDLET_FAMILY.SPARSE_RESIDUAL]: 'sparse-residual',
  [FIELDLET_FAMILY.ORIENTED_KERNEL]: 'oriented-kernel',
  [FIELDLET_FAMILY.CACHED_SURFACE]: 'cached-surface',
});

export const FIELDLET_SUBTYPE = Object.freeze({
  ANALYTIC_PROGRAM: 0,
  ANALYTIC_MEDIUM: 1,
  SAMPLED_FIELD: 0,
  ANALYTIC_PLUS_RESIDUAL: 1,
  ANISOTROPIC_SAMPLES: 0,
  INDEXED_TRIANGLES: 0,
});

export const QUERY_KIND = Object.freeze({
  BOUND: 'bound',
  SURFACE: 'surface',
  MEDIUM: 'medium',
  MATERIAL: 'material',
  MOTION: 'motion',
  COLLISION: 'collision',
});

export const QUERY_MASK = Object.freeze({
  BOUND: 1 << 0,
  SURFACE: 1 << 1,
  MEDIUM: 1 << 2,
  MATERIAL: 1 << 3,
  MOTION: 1 << 4,
  COLLISION: 1 << 5,
  ALL: (1 << 6) - 1,
});

export const FIELDLET_FLAG = Object.freeze({
  DYNAMIC: 1 << 0,
  AUTHORITATIVE: 1 << 1,
  OPAQUE: 1 << 2,
  HAS_LOCAL_TRANSFORMS: 1 << 3,
  CERTIFIED_SURFACE: 1 << 4,
  CERTIFIED_MEDIUM: 1 << 5,
  CERTIFIED_MOTION: 1 << 6,
  CERTIFIED_COLLISION: 1 << 7,
  STREAMABLE: 1 << 8,
  DISPOSABLE_CACHE: 1 << 9,
});

export const META_LAYOUT = Object.freeze({
  SUBTYPE_BITS: 12,
  FAMILY_BITS: 4,
  QUERY_BITS: 6,
  FLAG_BITS: 10,
  SUBTYPE_SHIFT: 0,
  FAMILY_SHIFT: 12,
  QUERY_SHIFT: 16,
  FLAG_SHIFT: 22,
  SUBTYPE_MASK: 0x0fff,
  FAMILY_MASK: 0x000f,
  QUERY_MASK: 0x003f,
  FLAG_MASK: 0x03ff,
});

export const INVALID_REF = 0xffffffff;

export const FIELDLET_HEADER_BYTES = 16;
export const FIELDLET_HEADER_WORDS = 4;
export const CERTIFICATE_BUNDLE_BYTES = 16;
export const CERTIFICATE_RECORD_BYTES = 16;

export const FIELDLET_HEADER_WORD = Object.freeze({
  BOUNDS_REF: 0,
  PAYLOAD_REF: 1,
  META: 2,
  CERTIFICATE_REF: 3,
});

export const CERTIFICATE_BUNDLE_WORD = Object.freeze({
  SURFACE_REF: 0,
  MEDIUM_REF: 1,
  MOTION_REF: 2,
  COLLISION_REF: 3,
});

export const ANALYTIC_OPCODE = Object.freeze({
  SPHERE: 1,
  BOX: 2,
  CAPSULE: 3,
  UNION: 16,
  INTERSECTION: 17,
  DIFFERENCE: 18,
});

export const PAYLOAD_SHAPE = Object.freeze({
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

export const ANALYTIC_LIMITS = Object.freeze({
  MAX_PROGRAM_INSTRUCTIONS: 64,
  MAX_STACK_DEPTH: 32,
  MAX_SOURCE_DEPTH: 32,
  MAX_CSG_CHILDREN: 32,
});

// Runtime WGSL clamps analytic radii, box extents, and uniform scales to this
// value. Semantic inputs below the same floor would describe different source
// geometry on the CPU and GPU, so validation rejects them before compilation.
export const ANALYTIC_GPU_PARAMETER_MINIMUM = 1e-7;

export const NEXEL_LIMITS = Object.freeze({
  MAX_ID_LENGTH: 128,
  MAX_SCENE_ID_LENGTH: 128,
  MAX_NEXELS: 1_000_000,
  MAX_ARRAY_VALUES: 16_777_216,
  MAX_TRIANGLES: 5_000_000,
  MAX_ORIENTED_SAMPLES: 5_000_000,
});

export const SOURCE_KIND = Object.freeze({
  SPHERE: 'sphere',
  BOX: 'box',
  CAPSULE: 'capsule',
  CSG: 'csg',
  SAMPLED_FIELD: 'sampled-field',
  SPARSE_RESIDUAL: 'sparse-residual',
  ORIENTED_SAMPLES: 'oriented-samples',
  INDEXED_SURFACE: 'indexed-surface',
  MEDIUM: 'medium',
});

export const CSG_OPERATION = Object.freeze({
  UNION: 'union',
  INTERSECTION: 'intersection',
  DIFFERENCE: 'difference',
});

export const UPDATE_CLASS = Object.freeze({
  STATIC: 'static',
  LOW_CHURN: 'low-churn',
  DYNAMIC: 'dynamic',
  STREAMED: 'streamed',
});

export const TOPOLOGY_REQUIREMENT = Object.freeze({
  UNSPECIFIED: 'unspecified',
  CLOSED_2_MANIFOLD: 'closed-2-manifold',
  OPEN: 'open',
});

export const FEATURE_MODE = Object.freeze({
  SMOOTH: 'smooth',
  SHARP: 'sharp',
  NOISY: 'noisy',
});

export function queryMaskForKind(kind) {
  switch (kind) {
    case QUERY_KIND.BOUND: return QUERY_MASK.BOUND;
    case QUERY_KIND.SURFACE: return QUERY_MASK.SURFACE;
    case QUERY_KIND.MEDIUM: return QUERY_MASK.MEDIUM;
    case QUERY_KIND.MATERIAL: return QUERY_MASK.MATERIAL;
    case QUERY_KIND.MOTION: return QUERY_MASK.MOTION;
    case QUERY_KIND.COLLISION: return QUERY_MASK.COLLISION;
    default: throw new RangeError(`Unknown MorphField query kind: ${String(kind)}`);
  }
}
