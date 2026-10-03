// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  PARTICLE_KINEMATICS_PAGE_CODEC_FORMAT,
  PARTICLE_KINEMATICS_PAGE_EXCEPTION_BYTES,
  PARTICLE_KINEMATICS_PAGE_HEADER_BYTES,
  PARTICLE_KINEMATICS_PAGE_PARTICLE_BYTES,
  decodeParticleKinematicsPage,
  encodeParticleKinematicsPage,
  readParticleKinematicsPageHeader,
  validateParticleKinematicsPage,
} from './ParticleKinematicsPageCodec.js';
import {
  ParticleStateLayoutRegistry,
  PARTICLE_STATE_PAGE_CORE_BLOCK_FORMAT,
  PARTICLE_STATE_PAGE_EXCEPTION_BLOCK_FORMAT,
  createParticleStateLayoutRegistry,
} from '../../render/morphfield/systems/ParticleStateLayout.js';

export const PARTICLE_KINEMATICS_STATE_LAYOUT_ID = 'particle-state.packet-page.v1';
export const PARTICLE_KINEMATICS_LOGICAL_RECORD_BYTES = 32;
export {
  PARTICLE_STATE_PAGE_CORE_BLOCK_FORMAT,
  PARTICLE_STATE_PAGE_EXCEPTION_BLOCK_FORMAT,
};

const CORE_BLOCK_KIND = 'core-kinematics';
const EXCEPTION_BLOCK_KIND = 'precision-exceptions';

export class ParticleKinematicsStateAdapterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ParticleKinematicsStateAdapterError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function adapterError(code, message, details) {
  return new ParticleKinematicsStateAdapterError(code, message, details);
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw adapterError('PARTICLE_KINEMATICS_STATE_INPUT', `${label} must be an object`);
  }
  return value;
}

function byteView(value, label) {
  if (value instanceof ArrayBuffer
      || (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer)) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw adapterError(
    'PARTICLE_KINEMATICS_STATE_PAYLOAD',
    `${label} must be an ArrayBuffer, SharedArrayBuffer, or typed array view`,
  );
}

function integer(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw adapterError(
      'PARTICLE_KINEMATICS_STATE_INTEGER',
      `${label} must be a safe integer in [${minimum}, ${maximum}]`,
    );
  }
  return value;
}

function alignUp(value, alignment) {
  const remainder = value % alignment;
  const aligned = remainder === 0 ? value : value + alignment - remainder;
  if (!Number.isSafeInteger(aligned) || aligned > 0xffffffff) {
    throw adapterError(
      'PARTICLE_KINEMATICS_STATE_CAPACITY',
      'Particle state payload exceeds the u32 address range',
    );
  }
  return aligned;
}

function checksum(bytes) {
  let hash = 0x811c9dc5;
  for (const value of bytes) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32.${hash.toString(16).padStart(8, '0')}`;
}

function wordsFromBytes(bytes, label) {
  if (bytes.byteLength % 4 !== 0) {
    throw adapterError(
      'PARTICLE_KINEMATICS_STATE_WORD_ALIGNMENT',
      `${label} byte length must be divisible by four`,
    );
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Uint32Array(copy.buffer);
}

function requireRegistry(registry) {
  if (!(registry instanceof ParticleStateLayoutRegistry)) {
    throw new TypeError('Particle kinematics state adaptation requires a ParticleStateLayoutRegistry');
  }
  return registry;
}

function resolvePageLayout(registry) {
  const layout = requireRegistry(registry).resolve(PARTICLE_KINEMATICS_STATE_LAYOUT_ID);
  const coreRule = layout.blocks.find(rule => rule.kind === CORE_BLOCK_KIND);
  const exceptionRule = layout.blocks.find(rule => rule.kind === EXCEPTION_BLOCK_KIND);
  if (layout.representation !== 'packet'
      || layout.encoding !== 'page-quantized'
      || layout.authorityRole !== 'coupled-physical'
      || layout.lossClass !== 'bounded-near-lossless'
      || coreRule?.format !== PARTICLE_STATE_PAGE_CORE_BLOCK_FORMAT
      || coreRule.fixedByteOverhead !== PARTICLE_KINEMATICS_PAGE_HEADER_BYTES
      || coreRule.minimumBytesPerElement !== PARTICLE_KINEMATICS_PAGE_PARTICLE_BYTES
      || exceptionRule?.format !== PARTICLE_STATE_PAGE_EXCEPTION_BLOCK_FORMAT
      || exceptionRule.minimumBytesPerElement !== PARTICLE_KINEMATICS_PAGE_EXCEPTION_BYTES) {
    throw adapterError(
      'PARTICLE_KINEMATICS_STATE_LAYOUT',
      `Layout '${PARTICLE_KINEMATICS_STATE_LAYOUT_ID}' is incompatible with the page codec ABI`,
    );
  }
  return layout;
}

function validatedPageHeader(encodedPage) {
  const page = record(encodedPage, 'encodedPage');
  if (page.format != null && page.format !== PARTICLE_KINEMATICS_PAGE_CODEC_FORMAT) {
    throw adapterError(
      'PARTICLE_KINEMATICS_STATE_PAGE_FORMAT',
      `Encoded page format '${page.format}' is unsupported`,
    );
  }
  const validation = validateParticleKinematicsPage(page);
  if (!validation.valid) {
    throw adapterError(
      validation.code ?? 'PARTICLE_KINEMATICS_STATE_PAGE_INVALID',
      `Encoded page failed validation: ${validation.message || 'invalid page'}`,
      { validation },
    );
  }
  return readParticleKinematicsPageHeader(page);
}

function normalizeOptionalBlocks(layout, optionalBlocks) {
  if (!Array.isArray(optionalBlocks)) {
    throw adapterError(
      'PARTICLE_KINEMATICS_STATE_OPTIONAL_BLOCKS',
      'optionalBlocks must be an array',
    );
  }
  return optionalBlocks.map((input, index) => {
    const block = record(input, `optionalBlocks[${index}]`);
    if (block.kind === CORE_BLOCK_KIND || block.kind === EXCEPTION_BLOCK_KIND) {
      throw adapterError(
        'PARTICLE_KINEMATICS_STATE_RESERVED_BLOCK',
        `optionalBlocks[${index}] cannot replace codec-owned block '${block.kind}'`,
      );
    }
    if (block.byteOffset != null || block.byteLength != null) {
      throw adapterError(
        'PARTICLE_KINEMATICS_STATE_BLOCK_PLACEMENT',
        'The state adapter owns optional block offsets and byte lengths',
      );
    }
    const rule = layout.blocks.find(candidate => candidate.kind === block.kind);
    if (!rule || (block.format != null && block.format !== rule.format)) {
      throw adapterError(
        'PARTICLE_KINEMATICS_STATE_OPTIONAL_FORMAT',
        `Optional block '${block.kind ?? index}' is not admitted by the packet layout`,
      );
    }
    const source = byteView(block.data, `optionalBlocks[${index}].data`);
    if (source.byteLength === 0) {
      throw adapterError(
        'PARTICLE_KINEMATICS_STATE_OPTIONAL_LENGTH',
        `Optional block '${block.kind}' cannot be empty`,
      );
    }
    const data = source.slice();
    const computedChecksum = checksum(data);
    if (block.checksum != null && block.checksum !== computedChecksum) {
      throw adapterError(
        'PARTICLE_KINEMATICS_STATE_CHECKSUM',
        `Optional block '${block.kind}' checksum does not match its data`,
      );
    }
    return {
      id: block.id ?? `optional.${index}.${block.kind}`,
      kind: block.kind,
      format: rule.format,
      alignmentBytes: rule.alignmentBytes,
      elementCount: integer(block.elementCount ?? 1, `optionalBlocks[${index}].elementCount`, {
        maximum: 0xffffffff,
      }),
      checksum: computedChecksum,
      data,
    };
  });
}

function verifyBlockChecksum(block, bytes) {
  const actual = checksum(bytes);
  if (block.checksum == null || block.checksum !== actual) {
    throw adapterError(
      'PARTICLE_KINEMATICS_STATE_CHECKSUM',
      `Block '${block.id}' checksum is missing or does not match its payload`,
      { expected: block.checksum ?? null, actual },
    );
  }
}

/**
 * Pack an already encoded page into the versioned ParticleStateEnvelope ABI.
 * The core block contains header + padded base lane; the exception block and
 * caller-supplied layout blocks retain independent byte accounting.
 */
export function createParticleKinematicsStateContainer(registry, encodedPage, options = {}) {
  const layout = resolvePageLayout(registry);
  const header = validatedPageHeader(encodedPage);
  const coreLength = PARTICLE_KINEMATICS_PAGE_HEADER_BYTES
    + header.pageSize * PARTICLE_KINEMATICS_PAGE_PARTICLE_BYTES;
  const exceptionLength = header.exceptionCount * PARTICLE_KINEMATICS_PAGE_EXCEPTION_BYTES;
  if (encodedPage.headerWords.byteLength + encodedPage.particleWords.byteLength !== coreLength
      || encodedPage.exceptionWords.byteLength !== exceptionLength) {
    throw adapterError(
      'PARTICLE_KINEMATICS_STATE_PAGE_LENGTH',
      'Encoded page byte lengths disagree with its validated header',
    );
  }
  const optional = normalizeOptionalBlocks(layout, options.optionalBlocks ?? []);
  const placements = [];
  let cursor = coreLength;
  if (exceptionLength > 0) {
    placements.push({
      id: 'kinematics.exceptions',
      kind: EXCEPTION_BLOCK_KIND,
      format: PARTICLE_STATE_PAGE_EXCEPTION_BLOCK_FORMAT,
      byteOffset: cursor,
      byteLength: exceptionLength,
      elementCount: header.exceptionCount,
      data: byteView(encodedPage.exceptionWords, 'encodedPage.exceptionWords'),
    });
    cursor += exceptionLength;
  }
  for (const block of optional) {
    cursor = alignUp(cursor, block.alignmentBytes);
    placements.push({
      ...block,
      byteOffset: cursor,
      byteLength: block.data.byteLength,
    });
    cursor += block.data.byteLength;
    if (!Number.isSafeInteger(cursor) || cursor > 0xffffffff) {
      throw adapterError(
        'PARTICLE_KINEMATICS_STATE_CAPACITY',
        'Particle state payload exceeds the u32 address range',
      );
    }
  }
  const payload = new Uint8Array(cursor);
  payload.set(byteView(encodedPage.headerWords, 'encodedPage.headerWords'), 0);
  payload.set(byteView(encodedPage.particleWords, 'encodedPage.particleWords'),
    PARTICLE_KINEMATICS_PAGE_HEADER_BYTES);
  for (const placement of placements) payload.set(placement.data, placement.byteOffset);

  const coreBytes = payload.subarray(0, coreLength);
  const blocks = [{
    id: 'kinematics.page',
    kind: CORE_BLOCK_KIND,
    format: PARTICLE_STATE_PAGE_CORE_BLOCK_FORMAT,
    byteOffset: 0,
    byteLength: coreLength,
    elementCount: header.particleCount,
    checksum: checksum(coreBytes),
  }, ...placements.map(({ data: _data, alignmentBytes: _alignment, ...placement }) => ({
    ...placement,
    checksum: placement.checksum ?? checksum(payload.subarray(
      placement.byteOffset,
      placement.byteOffset + placement.byteLength,
    )),
  }))];
  const minimumLogicalLength = header.particleCount * PARTICLE_KINEMATICS_LOGICAL_RECORD_BYTES
    + optional.reduce((sum, block) => sum + block.data.byteLength, 0);
  const logicalByteLength = options.logicalByteLength == null
    ? minimumLogicalLength
    : integer(options.logicalByteLength, 'options.logicalByteLength');
  if (logicalByteLength < minimumLogicalLength) {
    throw adapterError(
      'PARTICLE_KINEMATICS_STATE_LOGICAL_LENGTH',
      'logicalByteLength understates decoded particle and optional block data',
      { logicalByteLength, minimumLogicalLength },
    );
  }
  const envelope = registry.createEnvelope({
    id: options.id ?? `particle.kinematics.page.${header.pageIndex}.${header.generation}`,
    layoutId: PARTICLE_KINEMATICS_STATE_LAYOUT_ID,
    sourceRevision: options.sourceRevision ?? header.generation,
    representationRevision: options.representationRevision ?? header.generation,
    sampleCount: header.particleCount,
    logicalByteLength,
    payloadByteLength: payload.byteLength,
    blocks,
    certificateIds: options.certificateIds ?? [],
  });
  return Object.freeze({ envelope, payload });
}

/** Validate and unpack a page envelope. Any byte, count, or sidecar mismatch fails closed. */
export function readParticleKinematicsStateContainer(registry, envelopeInput, payloadInput) {
  resolvePageLayout(registry);
  const envelope = registry.validateEnvelope(envelopeInput);
  if (envelope.layoutId !== PARTICLE_KINEMATICS_STATE_LAYOUT_ID) {
    throw adapterError(
      'PARTICLE_KINEMATICS_STATE_LAYOUT',
      `Envelope layout '${envelope.layoutId}' is not a particle kinematics page`,
    );
  }
  const payload = byteView(payloadInput, 'payload');
  if (payload.byteLength !== envelope.payloadByteLength) {
    throw adapterError(
      'PARTICLE_KINEMATICS_STATE_PAYLOAD_LENGTH',
      'Payload byte length does not match its particle state envelope',
      { expected: envelope.payloadByteLength, actual: payload.byteLength },
    );
  }
  const core = envelope.blocks.find(block => block.kind === CORE_BLOCK_KIND);
  if (!core || core.format !== PARTICLE_STATE_PAGE_CORE_BLOCK_FORMAT
      || core.byteLength < PARTICLE_KINEMATICS_PAGE_HEADER_BYTES) {
    throw adapterError(
      'PARTICLE_KINEMATICS_STATE_CORE_BLOCK',
      'Envelope has no compatible particle page core block',
    );
  }
  const coreBytes = payload.subarray(core.byteOffset, core.byteOffset + core.byteLength);
  verifyBlockChecksum(core, coreBytes);
  const headerWords = wordsFromBytes(
    coreBytes.subarray(0, PARTICLE_KINEMATICS_PAGE_HEADER_BYTES),
    'particle page header',
  );
  const header = readParticleKinematicsPageHeader({
    headerWords,
    particleWords: new Uint32Array(0),
    exceptionWords: new Uint32Array(0),
  });
  const expectedCoreLength = PARTICLE_KINEMATICS_PAGE_HEADER_BYTES
    + header.pageSize * PARTICLE_KINEMATICS_PAGE_PARTICLE_BYTES;
  if (core.byteLength !== expectedCoreLength
      || core.elementCount !== header.particleCount
      || envelope.sampleCount !== header.particleCount) {
    throw adapterError(
      'PARTICLE_KINEMATICS_STATE_CORE_LENGTH',
      'Core block length or sample count disagrees with the page header',
      { expectedCoreLength, actualCoreLength: core.byteLength },
    );
  }
  const particleWords = wordsFromBytes(
    coreBytes.subarray(PARTICLE_KINEMATICS_PAGE_HEADER_BYTES),
    'particle page lane',
  );
  const exceptionBlocks = envelope.blocks.filter(block => block.kind === EXCEPTION_BLOCK_KIND);
  const expectedExceptionLength = header.exceptionCount * PARTICLE_KINEMATICS_PAGE_EXCEPTION_BYTES;
  if ((header.exceptionCount === 0 && exceptionBlocks.length !== 0)
      || (header.exceptionCount > 0 && exceptionBlocks.length !== 1)) {
    throw adapterError(
      'PARTICLE_KINEMATICS_STATE_EXCEPTION_BLOCK',
      'Exception block presence disagrees with the page header',
    );
  }
  let exceptionWords = new Uint32Array(0);
  if (header.exceptionCount > 0) {
    const block = exceptionBlocks[0];
    if (block.format !== PARTICLE_STATE_PAGE_EXCEPTION_BLOCK_FORMAT
        || block.byteLength !== expectedExceptionLength
        || block.elementCount !== header.exceptionCount) {
      throw adapterError(
        'PARTICLE_KINEMATICS_STATE_EXCEPTION_LENGTH',
        'Exception block length or element count disagrees with the page header',
      );
    }
    const bytes = payload.subarray(block.byteOffset, block.byteOffset + block.byteLength);
    verifyBlockChecksum(block, bytes);
    exceptionWords = wordsFromBytes(bytes, 'particle page exceptions');
  }
  const optionalBlocks = envelope.blocks
    .filter(block => block.kind !== CORE_BLOCK_KIND && block.kind !== EXCEPTION_BLOCK_KIND)
    .map(block => {
      const data = payload.slice(block.byteOffset, block.byteOffset + block.byteLength);
      verifyBlockChecksum(block, data);
      return Object.freeze({ ...block, data });
    });
  const page = Object.freeze({
    format: PARTICLE_KINEMATICS_PAGE_CODEC_FORMAT,
    headerWords,
    particleWords,
    exceptionWords,
  });
  const validation = validateParticleKinematicsPage(page);
  if (!validation.valid) {
    throw adapterError(
      validation.code ?? 'PARTICLE_KINEMATICS_STATE_PAGE_INVALID',
      `Envelope page failed validation: ${validation.message || 'invalid page'}`,
      { validation },
    );
  }
  return Object.freeze({
    envelope,
    page,
    particles: decodeParticleKinematicsPage(page),
    optionalBlocks: Object.freeze(optionalBlocks),
  });
}

function encoderInput(source) {
  if (Array.isArray(source)) return { particles: source };
  return record(source, 'particle kinematics encoder source');
}

/** Bind the real 8/12-byte page codec to the default packet state layout. */
export function bindParticleKinematicsPageStateCodec(registry) {
  resolvePageLayout(registry);
  registry.bindCodec(PARTICLE_KINEMATICS_STATE_LAYOUT_ID, {
    encode: (source, context = {}) => {
      const input = encoderInput(source);
      const page = input.encodedPage ?? encodeParticleKinematicsPage(input.particles, {
        ...(context.codecOptions ?? {}),
        ...(input.codecOptions ?? {}),
      });
      const container = createParticleKinematicsStateContainer(registry, page, {
        id: input.id ?? context.id,
        sourceRevision: input.sourceRevision ?? context.sourceRevision,
        representationRevision: input.representationRevision ?? context.representationRevision,
        logicalByteLength: input.logicalByteLength ?? context.logicalByteLength,
        optionalBlocks: input.optionalBlocks ?? context.optionalBlocks ?? [],
        certificateIds: input.certificateIds ?? context.certificateIds ?? [],
      });
      return { ...container.envelope, payload: container.payload };
    },
    decode: (payload, envelope) => readParticleKinematicsStateContainer(
      registry,
      envelope,
      payload,
    ),
  });
  return registry;
}

/** Create a default ParticleStateLayoutRegistry with the page codec attached. */
export function createParticleKinematicsPageStateRegistry(options = {}) {
  return bindParticleKinematicsPageStateCodec(createParticleStateLayoutRegistry(options));
}

export default createParticleKinematicsPageStateRegistry;
