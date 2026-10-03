// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  canonicalParticleStrings,
  deepFreezeParticleContract,
  particleEnum,
  particleIdentifier,
  particleInteger,
  particleRecord,
  particleRevision,
  particleSemver,
} from './ParticleRepresentationContracts.js';

export const PARTICLE_STATE_LAYOUT_SCHEMA = 'engine.morphfield.particle-state-layout';
export const PARTICLE_STATE_ENVELOPE_SCHEMA = 'engine.morphfield.particle-state-envelope';
export const PARTICLE_STATE_LAYOUT_VERSION = '1.0.0';
export const PARTICLE_STATE_ENVELOPE_VERSION = '1.0.0';

// The versioned packet layouts name the actual ParticleKinematicsPageCodec
// storage ABI. A core block owns one fixed 128-byte header followed by a
// capacity-padded u32x2 lane; ranked precision exceptions are separate u32x3
// records so their resident cost remains visible to the envelope.
export const PARTICLE_STATE_PAGE_CORE_BLOCK_FORMAT = 'page-header128-u32x2-v1';
export const PARTICLE_STATE_PAGE_EXCEPTION_BLOCK_FORMAT = 'page-ranked-u32x3-v1';

export const PARTICLE_REPRESENTATION_KINDS = Object.freeze([
  'raw',
  'packet',
  'interactive',
  'bonded',
  'hybrid-field',
  'moment',
  'procedural',
  'sleeping',
]);

export const PARTICLE_STATE_BLOCK_KINDS = Object.freeze([
  'core-kinematics',
  'sph-state',
  'bond-topology',
  'sparse-field',
  'proxy-descriptor',
  'residual-stream',
  'precision-exceptions',
  'projection-certificate',
  'wake-state',
  'visual-material',
]);

export const PARTICLE_STATE_AUTHORITY_ROLES = Object.freeze([
  'physical',
  'coupled-physical',
  'presentation-only',
]);

export const PARTICLE_STATE_LOSS_CLASSES = Object.freeze([
  'lossless',
  'bounded-near-lossless',
  'bounded-lossy',
  'visual-lossy',
]);

function layoutKey(representation, encoding, version) {
  return `${representation}/${encoding}@${version}`;
}

function normalizeBlockRule(input, index) {
  const block = particleRecord(input, `layout.blocks[${index}]`);
  const kind = particleEnum(block.kind, PARTICLE_STATE_BLOCK_KINDS, `layout.blocks[${index}].kind`);
  return {
    kind,
    format: particleIdentifier(block.format, `layout.blocks[${index}].format`),
    required: block.required === true,
    multiple: block.multiple === true,
    alignmentBytes: particleInteger(
      block.alignmentBytes ?? 4,
      `layout.blocks[${index}].alignmentBytes`,
      { minimum: 1, maximum: 4096 },
    ),
    minimumByteLength: particleInteger(
      block.minimumByteLength ?? 0,
      `layout.blocks[${index}].minimumByteLength`,
      { maximum: 0xffffffff },
    ),
    minimumBytesPerElement: particleInteger(
      block.minimumBytesPerElement ?? (kind === 'core-kinematics' ? 1 : 0),
      `layout.blocks[${index}].minimumBytesPerElement`,
      { maximum: 0xffffffff },
    ),
    fixedByteOverhead: particleInteger(
      block.fixedByteOverhead ?? 0,
      `layout.blocks[${index}].fixedByteOverhead`,
      { maximum: 0xffffffff },
    ),
    elementCapacityGranularity: particleInteger(
      block.elementCapacityGranularity ?? 1,
      `layout.blocks[${index}].elementCapacityGranularity`,
      { minimum: 1, maximum: 0xffffffff },
    ),
    maximumElementCount: particleInteger(
      block.maximumElementCount ?? 0xffffffff,
      `layout.blocks[${index}].maximumElementCount`,
      { maximum: 0xffffffff },
    ),
  };
}

function normalizeLayout(input) {
  const layout = particleRecord(input, 'layout');
  const representation = particleEnum(
    layout.representation,
    PARTICLE_REPRESENTATION_KINDS,
    'layout.representation',
  );
  const encoding = particleIdentifier(layout.encoding, 'layout.encoding');
  const version = particleSemver(layout.version ?? PARTICLE_STATE_LAYOUT_VERSION, 'layout.version');
  if (!Array.isArray(layout.blocks) || layout.blocks.length === 0) {
    throw new TypeError('layout.blocks must be a non-empty array');
  }
  const blocks = layout.blocks.map(normalizeBlockRule);
  const declaredKinds = new Set();
  for (const block of blocks) {
    if (declaredKinds.has(block.kind)) {
      throw new Error(`layout.blocks duplicates kind '${block.kind}'`);
    }
    declaredKinds.add(block.kind);
  }
  const authorityRole = particleEnum(
    layout.authorityRole,
    PARTICLE_STATE_AUTHORITY_ROLES,
    'layout.authorityRole',
  );
  const lossClass = particleEnum(
    layout.lossClass,
    PARTICLE_STATE_LOSS_CLASSES,
    'layout.lossClass',
  );
  return deepFreezeParticleContract({
    schema: PARTICLE_STATE_LAYOUT_SCHEMA,
    schemaVersion: PARTICLE_STATE_LAYOUT_VERSION,
    id: particleIdentifier(
      layout.id ?? `particle-state.${representation}.${encoding}.${version.replaceAll('.', '-')}`,
      'layout.id',
    ),
    representation,
    encoding,
    version,
    key: layoutKey(representation, encoding, version),
    authorityRole,
    lossClass,
    capabilities: canonicalParticleStrings(layout.capabilities ?? [], 'layout.capabilities'),
    compatibleSimulationAuthorities: canonicalParticleStrings(
      layout.compatibleSimulationAuthorities ?? [],
      'layout.compatibleSimulationAuthorities',
    ),
    blocks,
  });
}

function ruleMap(layout) {
  const result = new Map();
  for (const rule of layout.blocks) {
    const entries = result.get(rule.kind) ?? [];
    entries.push(rule);
    result.set(rule.kind, entries);
  }
  return result;
}

function normalizeEnvelopeBlock(input, index, layoutRules) {
  const block = particleRecord(input, `envelope.blocks[${index}]`);
  const kind = particleEnum(
    block.kind,
    PARTICLE_STATE_BLOCK_KINDS,
    `envelope.blocks[${index}].kind`,
  );
  const matchingRules = layoutRules.get(kind) ?? [];
  if (matchingRules.length === 0) {
    throw new Error(`Block kind '${kind}' is not admitted by the selected layout`);
  }
  const format = particleIdentifier(block.format, `envelope.blocks[${index}].format`);
  const rule = matchingRules.find(candidate => candidate.format === format);
  if (!rule) throw new Error(`Block '${kind}' format '${format}' is not admitted by the layout`);
  const byteOffset = particleInteger(block.byteOffset, `envelope.blocks[${index}].byteOffset`, {
    maximum: 0xffffffff,
  });
  const byteLength = particleInteger(block.byteLength, `envelope.blocks[${index}].byteLength`, {
    maximum: 0xffffffff,
  });
  const elementCount = particleInteger(
    block.elementCount ?? 1,
    `envelope.blocks[${index}].elementCount`,
    { maximum: 0xffffffff },
  );
  if (elementCount > rule.maximumElementCount) {
    throw new RangeError(`Block '${kind}' exceeds its layout element capacity`);
  }
  if (byteOffset % rule.alignmentBytes !== 0) {
    throw new RangeError(`Block '${kind}' byteOffset must align to ${rule.alignmentBytes} bytes`);
  }
  if (byteLength < rule.minimumByteLength) {
    throw new RangeError(`Block '${kind}' is shorter than its layout minimum`);
  }
  const paddedElementCount = Math.ceil(elementCount / rule.elementCapacityGranularity)
    * rule.elementCapacityGranularity;
  const minimumElementBytes = rule.fixedByteOverhead
    + paddedElementCount * rule.minimumBytesPerElement;
  if (!Number.isSafeInteger(minimumElementBytes) || minimumElementBytes > 0xffffffff) {
    throw new RangeError(`Block '${kind}' element byte requirement exceeds the u32 address range`);
  }
  if (byteLength < minimumElementBytes) {
    throw new RangeError(`Block '${kind}' is shorter than its per-element layout minimum`);
  }
  const end = byteOffset + byteLength;
  if (!Number.isSafeInteger(end) || end > 0xffffffff) {
    throw new RangeError(`Block '${kind}' byte range exceeds the u32 address range`);
  }
  return {
    id: particleIdentifier(block.id ?? `${kind}.${index}`, `envelope.blocks[${index}].id`),
    kind,
    format,
    byteOffset,
    byteLength,
    elementCount,
    checksum: block.checksum == null
      ? null
      : particleIdentifier(block.checksum, `envelope.blocks[${index}].checksum`),
  };
}

function payloadByteLength(payload) {
  if (payload instanceof ArrayBuffer
      || (typeof SharedArrayBuffer !== 'undefined' && payload instanceof SharedArrayBuffer)) {
    return payload.byteLength;
  }
  if (ArrayBuffer.isView(payload)) return payload.byteLength;
  return null;
}

export const DEFAULT_PARTICLE_STATE_LAYOUTS = deepFreezeParticleContract([
  {
    id: 'particle-state.raw-f32.v1',
    representation: 'raw',
    encoding: 'f32-state',
    version: '1.0.0',
    authorityRole: 'physical',
    lossClass: 'lossless',
    capabilities: ['exact-kinematics', 'physical-authority'],
    compatibleSimulationAuthorities: ['particle-storm', 'uniform-gpu-pbf'],
    blocks: [
      {
        kind: 'core-kinematics', format: 'f32x8', required: true,
        alignmentBytes: 16, minimumByteLength: 32, minimumBytesPerElement: 32,
      },
      { kind: 'visual-material', format: 'material-v1', alignmentBytes: 4 },
      { kind: 'projection-certificate', format: 'projection-v1', alignmentBytes: 4 },
    ],
  },
  {
    id: 'particle-state.packet-page.v1',
    representation: 'packet',
    encoding: 'page-quantized',
    version: '1.0.0',
    authorityRole: 'coupled-physical',
    lossClass: 'bounded-near-lossless',
    capabilities: ['bounded-kinematics', 'precision-exceptions'],
    compatibleSimulationAuthorities: ['particle-storm', 'uniform-gpu-pbf'],
    blocks: [
      {
        kind: 'core-kinematics', format: PARTICLE_STATE_PAGE_CORE_BLOCK_FORMAT, required: true,
        alignmentBytes: 16, minimumByteLength: 1152, minimumBytesPerElement: 8,
        fixedByteOverhead: 128, elementCapacityGranularity: 128, maximumElementCount: 256,
      },
      {
        kind: 'precision-exceptions', format: PARTICLE_STATE_PAGE_EXCEPTION_BLOCK_FORMAT,
        alignmentBytes: 4, minimumBytesPerElement: 12, maximumElementCount: 256,
      },
      {
        kind: 'projection-certificate', format: 'projection-v1',
        alignmentBytes: 4, minimumByteLength: 4,
      },
    ],
  },
  {
    id: 'particle-state.interactive-sph.v1',
    representation: 'interactive',
    encoding: 'page-quantized-sph',
    version: '1.0.0',
    authorityRole: 'coupled-physical',
    lossClass: 'bounded-near-lossless',
    capabilities: ['bounded-kinematics', 'neighbor-physics', 'precision-exceptions'],
    compatibleSimulationAuthorities: ['uniform-gpu-pbf'],
    blocks: [
      {
        kind: 'core-kinematics', format: PARTICLE_STATE_PAGE_CORE_BLOCK_FORMAT, required: true,
        alignmentBytes: 16, minimumByteLength: 1152, minimumBytesPerElement: 8,
        fixedByteOverhead: 128, elementCapacityGranularity: 128, maximumElementCount: 256,
      },
      {
        kind: 'sph-state', format: 'sph-f32-v1', required: true,
        alignmentBytes: 16, minimumByteLength: 16,
      },
      {
        kind: 'wake-state', format: 'wake-v1', required: true,
        alignmentBytes: 4, minimumByteLength: 4,
      },
      {
        kind: 'precision-exceptions', format: PARTICLE_STATE_PAGE_EXCEPTION_BLOCK_FORMAT,
        alignmentBytes: 4, minimumBytesPerElement: 12, maximumElementCount: 256,
      },
      {
        kind: 'projection-certificate', format: 'projection-v1', required: true,
        alignmentBytes: 4, minimumByteLength: 4,
      },
    ],
  },
  {
    id: 'particle-state.bonded.v1',
    representation: 'bonded',
    encoding: 'page-quantized-bonds',
    version: '1.0.0',
    authorityRole: 'coupled-physical',
    lossClass: 'bounded-near-lossless',
    capabilities: ['bounded-kinematics', 'lossless-topology', 'precision-exceptions'],
    compatibleSimulationAuthorities: ['particle-storm'],
    blocks: [
      {
        kind: 'core-kinematics', format: PARTICLE_STATE_PAGE_CORE_BLOCK_FORMAT, required: true,
        alignmentBytes: 16, minimumByteLength: 1152, minimumBytesPerElement: 8,
        fixedByteOverhead: 128, elementCapacityGranularity: 128, maximumElementCount: 256,
      },
      {
        kind: 'bond-topology', format: 'bond-csr-v1', required: true,
        alignmentBytes: 4, minimumByteLength: 16,
      },
      {
        kind: 'precision-exceptions', format: PARTICLE_STATE_PAGE_EXCEPTION_BLOCK_FORMAT,
        alignmentBytes: 4, minimumBytesPerElement: 12, maximumElementCount: 256,
      },
      {
        kind: 'projection-certificate', format: 'projection-v1', required: true,
        alignmentBytes: 4, minimumByteLength: 4,
      },
    ],
  },
  {
    id: 'particle-state.hybrid-field.v1',
    representation: 'hybrid-field',
    encoding: 'sparse-field-residual',
    version: '1.0.0',
    authorityRole: 'coupled-physical',
    lossClass: 'bounded-lossy',
    capabilities: ['coarse-field-authority', 'residual-particles'],
    compatibleSimulationAuthorities: ['uniform-gpu-pbf'],
    blocks: [
      {
        kind: 'sparse-field', format: 'field-bricks-v1', required: true,
        alignmentBytes: 16, minimumByteLength: 16,
      },
      { kind: 'residual-stream', format: 'residual-particles-v1', alignmentBytes: 16 },
      { kind: 'precision-exceptions', format: 'exception-u16-v1', alignmentBytes: 4 },
      {
        kind: 'projection-certificate', format: 'projection-v1', required: true,
        alignmentBytes: 4, minimumByteLength: 4,
      },
    ],
  },
  ...['moment', 'procedural', 'sleeping'].map(representation => ({
    id: `particle-state.${representation}.v1`,
    representation,
    encoding: 'proxy-lift-v1',
    version: '1.0.0',
    authorityRole: 'presentation-only',
    lossClass: 'visual-lossy',
    capabilities: representation === 'sleeping'
      ? ['deterministic-expansion', 'wakeable']
      : ['deterministic-expansion'],
    compatibleSimulationAuthorities: ['particle-storm', 'uniform-gpu-pbf'],
    blocks: [
      {
        kind: 'proxy-descriptor', format: 'proxy-160b-v1', required: true,
        alignmentBytes: 16, minimumByteLength: 160,
      },
      { kind: 'residual-stream', format: 'residual-particles-v1', alignmentBytes: 16 },
      { kind: 'precision-exceptions', format: 'exception-u16-v1', alignmentBytes: 4 },
      {
        kind: 'wake-state', format: 'wake-v1', required: representation === 'sleeping',
        alignmentBytes: 4, minimumByteLength: 4,
      },
      { kind: 'visual-material', format: 'material-v1', alignmentBytes: 4 },
      {
        kind: 'projection-certificate', format: 'projection-v1', required: true,
        alignmentBytes: 4, minimumByteLength: 4,
      },
    ],
  })),
].map(normalizeLayout));

export class ParticleStateLayoutRegistry {
  constructor({ includeDefaults = true, layouts = [] } = {}) {
    this._layouts = new Map();
    this._ids = new Map();
    this._handlers = new Map();
    if (includeDefaults) {
      for (const layout of DEFAULT_PARTICLE_STATE_LAYOUTS) this.register(layout);
    }
    for (const layout of layouts) this.register(layout);
  }

  register(layoutInput, handlers = {}) {
    const layout = normalizeLayout(layoutInput);
    if (this._layouts.has(layout.key)) throw new Error(`Particle state layout '${layout.key}' exists`);
    if (this._ids.has(layout.id)) throw new Error(`Particle state layout id '${layout.id}' exists`);
    this._layouts.set(layout.key, layout);
    this._ids.set(layout.id, layout);
    this.bindCodec(layout.id, handlers);
    return layout;
  }

  bindCodec(reference, { encode = null, decode = null } = {}) {
    const layout = this.resolve(reference);
    if (encode != null && typeof encode !== 'function') throw new TypeError('encode must be a function');
    if (decode != null && typeof decode !== 'function') throw new TypeError('decode must be a function');
    const previous = this._handlers.get(layout.key) ?? { encode: null, decode: null };
    this._handlers.set(layout.key, {
      encode: encode ?? previous.encode,
      decode: decode ?? previous.decode,
    });
    return layout;
  }

  resolve(reference) {
    if (typeof reference === 'string') {
      const result = this._ids.get(reference) ?? this._layouts.get(reference);
      if (!result) throw new Error(`Unknown particle state layout '${reference}'`);
      return result;
    }
    const input = particleRecord(reference, 'layout reference');
    if (input.layoutId != null || input.id != null) {
      return this.resolve(input.layoutId ?? input.id);
    }
    const key = layoutKey(
      particleEnum(input.representation, PARTICLE_REPRESENTATION_KINDS, 'reference.representation'),
      particleIdentifier(input.encoding, 'reference.encoding'),
      particleSemver(input.version, 'reference.version'),
    );
    const result = this._layouts.get(key);
    if (!result) throw new Error(`Unknown particle state layout '${key}'`);
    return result;
  }

  list({ representation = null, capability = null } = {}) {
    if (representation != null) {
      particleEnum(representation, PARTICLE_REPRESENTATION_KINDS, 'filter.representation');
    }
    if (capability != null) particleIdentifier(capability, 'filter.capability');
    return Object.freeze(Array.from(this._layouts.values()).filter(layout => (
      (representation == null || layout.representation === representation)
      && (capability == null || layout.capabilities.includes(capability))
    )).sort((left, right) => left.key.localeCompare(right.key)));
  }

  createEnvelope(input) {
    return createParticleStateEnvelope(this, input);
  }

  validateEnvelope(envelope) {
    return validateParticleStateEnvelope(this, envelope);
  }

  async encode(reference, source, context = {}) {
    const layout = this.resolve(reference);
    const handler = this._handlers.get(layout.key)?.encode;
    if (!handler) throw new Error(`Particle state layout '${layout.key}' has no encoder`);
    const result = particleRecord(await handler(source, context, layout), 'encoder result');
    const inferredLength = payloadByteLength(result.payload);
    const envelope = this.createEnvelope({
      ...result,
      layoutId: layout.id,
      payloadByteLength: result.payloadByteLength ?? inferredLength,
    });
    if (inferredLength != null && envelope.payloadByteLength !== inferredLength) {
      throw new RangeError('Encoded particle state payload length does not match its envelope');
    }
    return Object.freeze({ envelope, payload: result.payload ?? null });
  }

  async decode(envelopeInput, payload, context = {}) {
    const envelope = this.validateEnvelope(envelopeInput);
    const layout = this.resolve(envelope.layoutId);
    const handler = this._handlers.get(layout.key)?.decode;
    if (!handler) throw new Error(`Particle state layout '${layout.key}' has no decoder`);
    const actualLength = payloadByteLength(payload);
    if (actualLength != null && actualLength !== envelope.payloadByteLength) {
      throw new RangeError('Particle state payload length does not match its envelope');
    }
    return handler(payload, envelope, context, layout);
  }
}

export function createParticleStateLayoutRegistry(options = {}) {
  return new ParticleStateLayoutRegistry(options);
}

export function createParticleStateEnvelope(registry, input) {
  if (!(registry instanceof ParticleStateLayoutRegistry)) {
    throw new TypeError('createParticleStateEnvelope requires a ParticleStateLayoutRegistry');
  }
  const envelope = particleRecord(input, 'envelope');
  const layout = registry.resolve(envelope.layoutId ?? envelope.layout ?? envelope);
  if (!Array.isArray(envelope.blocks)) throw new TypeError('envelope.blocks must be an array');
  const rules = ruleMap(layout);
  const blocks = envelope.blocks.map((block, index) => normalizeEnvelopeBlock(block, index, rules));
  const counts = new Map();
  const blockIds = new Set();
  for (const block of blocks) {
    if (blockIds.has(block.id)) throw new Error(`Duplicate particle state block id '${block.id}'`);
    blockIds.add(block.id);
    counts.set(block.kind, (counts.get(block.kind) ?? 0) + 1);
  }
  for (const rule of layout.blocks) {
    const count = counts.get(rule.kind) ?? 0;
    if (rule.required && count === 0) throw new Error(`Required block '${rule.kind}' is missing`);
    if (!rule.multiple && count > 1) throw new Error(`Block '${rule.kind}' cannot occur more than once`);
  }
  const ordered = [...blocks].sort((left, right) => left.byteOffset - right.byteOffset || (
    left.id.localeCompare(right.id)
  ));
  let previousEnd = 0;
  for (const block of ordered) {
    if (block.byteOffset < previousEnd) throw new Error(`Block '${block.id}' overlaps another block`);
    previousEnd = block.byteOffset + block.byteLength;
  }
  const payloadLength = particleInteger(
    envelope.payloadByteLength,
    'envelope.payloadByteLength',
    { maximum: 0xffffffff },
  );
  if (previousEnd > payloadLength) throw new RangeError('Particle state block exceeds payload length');
  const logicalByteLength = particleInteger(
    envelope.logicalByteLength ?? payloadLength,
    'envelope.logicalByteLength',
    { maximum: Number.MAX_SAFE_INTEGER },
  );
  const sampleCount = particleInteger(envelope.sampleCount, 'envelope.sampleCount', {
    maximum: 0xffffffff,
  });
  const requiredCoreRule = layout.blocks.find(rule => (
    rule.kind === 'core-kinematics' && rule.required
  ));
  if (requiredCoreRule) {
    const representedSamples = blocks
      .filter(block => (
        block.kind === requiredCoreRule.kind && block.format === requiredCoreRule.format
      ))
      .reduce((sum, block) => sum + block.elementCount, 0);
    if (!Number.isSafeInteger(representedSamples) || representedSamples !== sampleCount) {
      throw new RangeError('Core-kinematics elementCount must equal envelope.sampleCount');
    }
  }
  if (sampleCount > 0) {
    for (const rule of layout.blocks) {
      if (!rule.required) continue;
      const requiredBytes = blocks
        .filter(block => block.kind === rule.kind && block.format === rule.format)
        .reduce((sum, block) => sum + block.byteLength, 0);
      if (requiredBytes === 0) {
        throw new RangeError(`Required block '${rule.kind}' cannot be empty for a non-empty state`);
      }
    }
  }
  return deepFreezeParticleContract({
    schema: PARTICLE_STATE_ENVELOPE_SCHEMA,
    schemaVersion: PARTICLE_STATE_ENVELOPE_VERSION,
    id: particleIdentifier(envelope.id, 'envelope.id'),
    layoutId: layout.id,
    layoutKey: layout.key,
    layoutVersion: layout.version,
    representation: layout.representation,
    encoding: layout.encoding,
    lossClass: layout.lossClass,
    sourceRevision: particleRevision(envelope.sourceRevision, 'envelope.sourceRevision'),
    representationRevision: particleRevision(
      envelope.representationRevision ?? 0,
      'envelope.representationRevision',
    ),
    sampleCount,
    logicalByteLength,
    payloadByteLength: payloadLength,
    compressionRatio: payloadLength === 0
      ? (logicalByteLength === 0 ? 1 : Number.POSITIVE_INFINITY)
      : logicalByteLength / payloadLength,
    blocks: ordered,
    certificateIds: canonicalParticleStrings(envelope.certificateIds ?? [], 'envelope.certificateIds'),
    authority: {
      role: layout.authorityRole,
      physical: layout.authorityRole !== 'presentation-only',
      presentationOnly: layout.authorityRole === 'presentation-only',
    },
  });
}

export function validateParticleStateEnvelope(registry, envelope) {
  const input = particleRecord(envelope, 'envelope');
  if (input.schema !== PARTICLE_STATE_ENVELOPE_SCHEMA
      || input.schemaVersion !== PARTICLE_STATE_ENVELOPE_VERSION) {
    throw new Error('Unsupported particle state envelope schema or version');
  }
  const normalized = createParticleStateEnvelope(registry, input);
  if (normalized.layoutId !== input.layoutId
      || normalized.representation !== input.representation
      || normalized.encoding !== input.encoding
      || normalized.layoutVersion !== input.layoutVersion) {
    throw new Error('Particle state envelope layout identity is inconsistent');
  }
  return normalized;
}

export default ParticleStateLayoutRegistry;
