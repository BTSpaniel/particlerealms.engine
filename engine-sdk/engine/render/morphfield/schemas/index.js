// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  ANALYTIC_LIMITS,
  FIELDLET_FAMILY,
  FIELDLET_FAMILY_NAME,
  MORPHFIELD_SCHEMA_VERSION,
  QUERY_KIND,
  QUERY_MASK,
  SOURCE_KIND,
} from '../core/constants.js';
import {
  computeNexelQueryMask,
  countAnalyticInstructions,
  maximumAnalyticStackDepth,
  normalizeNexelDescriptor,
  planRepresentation,
} from '../core/validation.js';
import { inspectNexelCompilerFeasibility } from '../core/MorphFieldCompiler.js';
import {
  MORPHFIELD_JSON_SCHEMA_DIALECT,
  MORPHFIELD_SCHEMA_FILES,
  MORPHFIELD_SCHEMA_IDS,
} from './ids.js';

export * from './ids.js';

function deepFreeze(value, visited = new WeakSet()) {
  if (value === null || typeof value !== 'object' || visited.has(value)) return value;
  visited.add(value);
  for (const child of Object.values(value)) deepFreeze(child, visited);
  return Object.freeze(value);
}

export const NEXEL_COMPILER_MODE = Object.freeze({
  CERTIFIED_ANALYTIC_EXECUTION: 'certified-analytic-execution',
  CERTIFIED_FIELD_EXECUTION: 'certified-field-execution',
  CERTIFICATE_RECORD: 'certificate-record',
  PACKED_MARKER: 'packed-marker',
  UNAVAILABLE: 'unavailable',
});

export const NEXEL_GPU_QUERY_MODE = Object.freeze({
  CONSERVATIVE_BOUND: 'conservative-bound',
  CERTIFIED_SURFACE: 'certified-surface',
  MATERIAL_TABLE: 'material-table',
  CERTIFICATE_ENVELOPE: 'certificate-envelope',
  CERTIFICATE_MAJORANT: 'certificate-majorant',
  CERTIFIED_COLLISION: 'certified-collision',
  UNAVAILABLE: 'unavailable',
});

const QUALIFIED_SIMULATION_ADAPTERS = new Set(['particle-chain-nexel-snapshot']);

function createGpuQueryModes(overrides = {}) {
  return deepFreeze(Object.fromEntries(Object.values(QUERY_KIND).map(kind => [
    kind,
    overrides[kind] ?? NEXEL_GPU_QUERY_MODE.UNAVAILABLE,
  ])));
}

function executableQueries(gpuQueryModes) {
  return Object.values(QUERY_KIND).filter(
    kind => gpuQueryModes[kind] !== NEXEL_GPU_QUERY_MODE.UNAVAILABLE,
  );
}

const ALL_SURFACE_QUERIES = Object.freeze([
  QUERY_KIND.BOUND,
  QUERY_KIND.SURFACE,
  QUERY_KIND.MATERIAL,
  QUERY_KIND.MOTION,
  QUERY_KIND.COLLISION,
]);

const MEDIUM_QUERIES = Object.freeze([
  QUERY_KIND.BOUND,
  QUERY_KIND.MEDIUM,
  QUERY_KIND.MOTION,
]);

const ANALYTIC_SURFACE_GPU_QUERY_MODES = createGpuQueryModes({
  [QUERY_KIND.BOUND]: NEXEL_GPU_QUERY_MODE.CONSERVATIVE_BOUND,
  [QUERY_KIND.SURFACE]: NEXEL_GPU_QUERY_MODE.CERTIFIED_SURFACE,
  [QUERY_KIND.MATERIAL]: NEXEL_GPU_QUERY_MODE.MATERIAL_TABLE,
  [QUERY_KIND.MOTION]: NEXEL_GPU_QUERY_MODE.CERTIFICATE_ENVELOPE,
  [QUERY_KIND.COLLISION]: NEXEL_GPU_QUERY_MODE.CERTIFIED_COLLISION,
});

const MARKER_SURFACE_GPU_QUERY_MODES = createGpuQueryModes({
  [QUERY_KIND.BOUND]: NEXEL_GPU_QUERY_MODE.CONSERVATIVE_BOUND,
  [QUERY_KIND.MATERIAL]: NEXEL_GPU_QUERY_MODE.MATERIAL_TABLE,
  [QUERY_KIND.MOTION]: NEXEL_GPU_QUERY_MODE.CERTIFICATE_ENVELOPE,
});

const MEDIUM_GPU_QUERY_MODES = createGpuQueryModes({
  [QUERY_KIND.BOUND]: NEXEL_GPU_QUERY_MODE.CONSERVATIVE_BOUND,
  [QUERY_KIND.MEDIUM]: NEXEL_GPU_QUERY_MODE.CERTIFICATE_MAJORANT,
  [QUERY_KIND.MOTION]: NEXEL_GPU_QUERY_MODE.CERTIFICATE_ENVELOPE,
});
const INDEXED_SURFACE_QUERIES = Object.freeze([
  QUERY_KIND.BOUND,
  QUERY_KIND.SURFACE,
  QUERY_KIND.MATERIAL,
  QUERY_KIND.MOTION,
]);

const SOURCE_EXECUTION = deepFreeze({
  [SOURCE_KIND.SPHERE]: {
    compilerMode: NEXEL_COMPILER_MODE.CERTIFIED_ANALYTIC_EXECUTION,
    renderer: 'direct-field',
    gpuQueryModes: ANALYTIC_SURFACE_GPU_QUERY_MODES,
    limitations: [],
  },
  [SOURCE_KIND.BOX]: {
    compilerMode: NEXEL_COMPILER_MODE.CERTIFIED_ANALYTIC_EXECUTION,
    renderer: 'direct-field',
    gpuQueryModes: ANALYTIC_SURFACE_GPU_QUERY_MODES,
    limitations: [],
  },
  [SOURCE_KIND.CAPSULE]: {
    compilerMode: NEXEL_COMPILER_MODE.CERTIFIED_ANALYTIC_EXECUTION,
    renderer: 'direct-field',
    gpuQueryModes: ANALYTIC_SURFACE_GPU_QUERY_MODES,
    limitations: [],
  },
  [SOURCE_KIND.CSG]: {
    compilerMode: NEXEL_COMPILER_MODE.CERTIFIED_ANALYTIC_EXECUTION,
    renderer: 'direct-field',
    gpuQueryModes: ANALYTIC_SURFACE_GPU_QUERY_MODES,
    limitations: ['Only hard union, intersection, and difference over analytic children are admitted.'],
  },
  [SOURCE_KIND.SAMPLED_FIELD]: {
    compilerMode: NEXEL_COMPILER_MODE.CERTIFIED_FIELD_EXECUTION,
    renderer: 'direct-field',
    gpuQueryModes: ANALYTIC_SURFACE_GPU_QUERY_MODES,
    limitations: ['Progressive wavefront traversal remains limited to certified analytic-family Fieldlets.'],
  },
  [SOURCE_KIND.SPARSE_RESIDUAL]: {
    compilerMode: NEXEL_COMPILER_MODE.CERTIFIED_FIELD_EXECUTION,
    renderer: 'direct-field',
    gpuQueryModes: ANALYTIC_SURFACE_GPU_QUERY_MODES,
    limitations: [
      'Progressive wavefront traversal remains limited to certified analytic-family Fieldlets.',
      'Streamed fine residual pages require the pinned certified coarse fallback before publication.',
    ],
  },
  [SOURCE_KIND.ORIENTED_SAMPLES]: {
    compilerMode: NEXEL_COMPILER_MODE.CERTIFICATE_RECORD,
    renderer: 'marker-only',
    gpuQueryModes: MARKER_SURFACE_GPU_QUERY_MODES,
    limitations: [
      'The oriented-kernel integration pass is marker-only.',
      'The CPU reference currently applies anisotropic radii in source axes; stored sample normals do not yet rotate the kernel frame.',
    ],
  },
  [SOURCE_KIND.INDEXED_SURFACE]: {
    compilerMode: NEXEL_COMPILER_MODE.PACKED_MARKER,
    renderer: 'marker-only',
    gpuQueryModes: MARKER_SURFACE_GPU_QUERY_MODES,
    limitations: ['Validated cached-surface raster publication is not integrated.'],
  },
  [SOURCE_KIND.MEDIUM]: {
    compilerMode: NEXEL_COMPILER_MODE.CERTIFICATE_RECORD,
    renderer: 'marker-only',
    gpuQueryModes: MEDIUM_GPU_QUERY_MODES,
    limitations: ['The medium certificate query is implemented; frame integration is marker-only.'],
  },
});

function potentialQueries(kind) {
  if (kind === SOURCE_KIND.MEDIUM) return MEDIUM_QUERIES;
  if (kind === SOURCE_KIND.INDEXED_SURFACE) return INDEXED_SURFACE_QUERIES;
  return ALL_SURFACE_QUERIES;
}

function familyForSource(kind) {
  switch (kind) {
    case SOURCE_KIND.SPHERE:
    case SOURCE_KIND.BOX:
    case SOURCE_KIND.CAPSULE:
    case SOURCE_KIND.CSG:
    case SOURCE_KIND.MEDIUM: return FIELDLET_FAMILY.ANALYTIC;
    case SOURCE_KIND.SAMPLED_FIELD:
    case SOURCE_KIND.SPARSE_RESIDUAL: return FIELDLET_FAMILY.SPARSE_RESIDUAL;
    case SOURCE_KIND.ORIENTED_SAMPLES: return FIELDLET_FAMILY.ORIENTED_KERNEL;
    case SOURCE_KIND.INDEXED_SURFACE: return FIELDLET_FAMILY.CACHED_SURFACE;
    default: throw new RangeError(`Unknown Nexel source kind: ${String(kind)}`);
  }
}

function descriptorLimitations(descriptor) {
  const limitations = [];
  if (descriptor.source.kind === SOURCE_KIND.CSG) {
    const instructionCount = countAnalyticInstructions(descriptor.source);
    const stackDepth = maximumAnalyticStackDepth(descriptor.source);
    if (instructionCount > ANALYTIC_LIMITS.MAX_PROGRAM_INSTRUCTIONS) {
      limitations.push(`Analytic CSG requires ${instructionCount} instructions; the GPU program limit is ${ANALYTIC_LIMITS.MAX_PROGRAM_INSTRUCTIONS}.`);
    }
    if (stackDepth > ANALYTIC_LIMITS.MAX_STACK_DEPTH) {
      limitations.push(`Analytic CSG requires a ${stackDepth}-value stack; the GPU stack limit is ${ANALYTIC_LIMITS.MAX_STACK_DEPTH}.`);
    }
  }
  if (descriptor.material.type !== 'pbr') {
    limitations.push(`Material type ${descriptor.material.type || '(empty)'} is normalized but the direct-field shader currently executes its PBR parameter path.`);
  }
  if (descriptor.material.baseColorTexture || descriptor.material.normalTexture
      || descriptor.material.metallicRoughnessTexture || descriptor.material.emissiveTexture) {
    limitations.push('Material texture references are preserved but are not sampled by the direct-field renderer.');
  }
  if (descriptor.material.baseColorFactor[3] < 1) {
    limitations.push('Surface alpha is preserved but bounded transparency/OIT is not integrated.');
  }
  if (descriptor.material.pipelineTag) {
    limitations.push('The material pipelineTag is preserved but does not select a MorphField shader path.');
  }
  if (descriptor.motion) {
    limitations.push('Motion bounds and typed queries are implemented; rendered geometry and G-buffer motion vectors do not yet consume semantic motion.');
  }
  if (descriptor.simulation && !QUALIFIED_SIMULATION_ADAPTERS.has(descriptor.simulation.adapter)) {
    limitations.push(
      `Unqualified opaque simulation adapter ${JSON.stringify(descriptor.simulation.adapter)} is preserved as semantic metadata; no MorphField compiler, GPU-query, renderer, or lifecycle integration is claimed.`,
    );
  }
  return limitations;
}

const sourceCapabilities = Object.values(SOURCE_KIND).map((kind) => {
  const family = familyForSource(kind);
  const execution = SOURCE_EXECUTION[kind];
  return deepFreeze({
    kind,
    family,
    familyName: FIELDLET_FAMILY_NAME[family],
    semanticAdmission: true,
    cpuReference: true,
    cpuReferenceMode: kind === SOURCE_KIND.ORIENTED_SAMPLES ? 'source-axis-only' : 'complete',
    compiler: true,
    compilerMode: execution.compilerMode,
    renderer: execution.renderer,
    potentialQueries: [...potentialQueries(kind)],
    gpuQueries: executableQueries(execution.gpuQueryModes),
    gpuQueryModes: execution.gpuQueryModes,
    limitations: [...execution.limitations],
  });
});

export const NEXEL_CAPABILITY_PROFILE = deepFreeze({
  $schema: MORPHFIELD_SCHEMA_IDS.capabilityProfile,
  schema: 'morphfield-nexel-capabilities',
  version: { ...MORPHFIELD_SCHEMA_VERSION },
  jsonSchemaDialect: MORPHFIELD_JSON_SCHEMA_DIALECT,
  fieldletFamilies: Object.entries(FIELDLET_FAMILY_NAME).map(([id, name]) => ({ id: Number(id), name })),
  queryKinds: Object.values(QUERY_KIND),
  sourceKinds: sourceCapabilities,
  invariants: [
    'Nexel is semantic; execution-family selection is compiler-owned.',
    'Compiler-derived certificates are never accepted from authored JSON.',
    'Binary Fieldlet, certificate, query, and GPU-buffer layouts are ABI contracts rather than JSON instances.',
    'CPU reference result objects and 64-byte GPU query records are distinct contracts; a shared query name does not imply identical result shape.',
    'A marker-only renderer status is not a claim of live family execution.',
    'compilerMode distinguishes certified analytic execution, certified sampled-field execution, certificate-only compilation, and packed markers.',
    'gpuQueryModes declares one explicit mode for every typed query; unavailable is never implied by omission.',
    'fullyGpuExecutable is retained as an exact compatibility alias of fullyCurrentRendererExecutable.',
    'Descriptor inspection reports implementation coverage only; it never claims qualification against a particular GPUDevice.',
  ],
});

export const MORPHFIELD_SCHEMA_CATALOG = deepFreeze(Object.entries(MORPHFIELD_SCHEMA_IDS).map(([name, id]) => ({
  name,
  id,
  file: MORPHFIELD_SCHEMA_FILES[name],
  dialect: MORPHFIELD_JSON_SCHEMA_DIALECT,
})));

const QUERY_MASK_BY_KIND = Object.freeze({
  [QUERY_KIND.BOUND]: QUERY_MASK.BOUND,
  [QUERY_KIND.SURFACE]: QUERY_MASK.SURFACE,
  [QUERY_KIND.MEDIUM]: QUERY_MASK.MEDIUM,
  [QUERY_KIND.MATERIAL]: QUERY_MASK.MATERIAL,
  [QUERY_KIND.MOTION]: QUERY_MASK.MOTION,
  [QUERY_KIND.COLLISION]: QUERY_MASK.COLLISION,
});

/**
 * Normalize one semantic Nexel and report the execution/query capabilities the
 * current R2 implementation can honestly provide for it.
 */
export function inspectNexelCapabilities(input) {
  const descriptor = normalizeNexelDescriptor(input);
  const plan = planRepresentation(descriptor.source);
  const queryMask = computeNexelQueryMask(descriptor);
  const profile = sourceCapabilities.find(candidate => candidate.kind === descriptor.source.kind);
  if (!profile || profile.family !== plan.family) {
    throw new Error(`MorphField capability profile drift for ${descriptor.source.kind}`);
  }
  const queries = Object.values(QUERY_KIND).filter(kind => (queryMask & QUERY_MASK_BY_KIND[kind]) !== 0);
  const descriptorGaps = descriptorLimitations(descriptor);
  const compilerFeasibility = inspectNexelCompilerFeasibility(descriptor);
  if (!compilerFeasibility.feasible) {
    descriptorGaps.push(
      `Compiler admission failed (${compilerFeasibility.code}): ${compilerFeasibility.message}`,
    );
  }
  const compilerMode = compilerFeasibility.feasible
    ? profile.compilerMode
    : NEXEL_COMPILER_MODE.UNAVAILABLE;
  const querySet = new Set(queries);
  const gpuQueryModes = createGpuQueryModes(Object.fromEntries(Object.values(QUERY_KIND).map(kind => [
    kind,
    compilerFeasibility.feasible && querySet.has(kind)
      ? profile.gpuQueryModes[kind]
      : NEXEL_GPU_QUERY_MODE.UNAVAILABLE,
  ])));
  const gpuQueries = queries.filter(kind => gpuQueryModes[kind] !== NEXEL_GPU_QUERY_MODE.UNAVAILABLE);
  const unavailableGpuQueries = queries.filter(kind => gpuQueryModes[kind] === NEXEL_GPU_QUERY_MODE.UNAVAILABLE);
  const limitations = [...profile.limitations, ...descriptorGaps];
  const fullyCurrentRendererExecutable = (
    compilerMode === NEXEL_COMPILER_MODE.CERTIFIED_ANALYTIC_EXECUTION
      || compilerMode === NEXEL_COMPILER_MODE.CERTIFIED_FIELD_EXECUTION
  )
    && profile.renderer === 'direct-field'
    && unavailableGpuQueries.length === 0
    && descriptorGaps.length === 0;
  return deepFreeze({
    $schema: MORPHFIELD_SCHEMA_IDS.capabilityReport,
    schema: 'morphfield-nexel-capability-report',
    version: { ...MORPHFIELD_SCHEMA_VERSION },
    qualificationScope: 'semantic-descriptor',
    deviceQualification: 'not-evaluated',
    nexelId: descriptor.id,
    sourceKind: descriptor.source.kind,
    fieldletFamily: plan.family,
    fieldletFamilyName: FIELDLET_FAMILY_NAME[plan.family],
    representationReason: plan.reason,
    compilerMode,
    queryMask,
    queries,
    gpuQueries,
    unavailableGpuQueries,
    gpuQueryModes,
    renderer: profile.renderer,
    fullyGpuExecutable: fullyCurrentRendererExecutable,
    fullyCurrentRendererExecutable,
    limitations,
    canonicalDescriptor: descriptor,
  });
}
