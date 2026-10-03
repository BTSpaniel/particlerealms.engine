// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { resolveModule, sourceUrl, finishSuite } from '../resolver.js';
const {
  PARTICLE_KINEMATICS_LOGICAL_RECORD_BYTES,
  PARTICLE_KINEMATICS_PAGE_EXCEPTION_BYTES,
  PARTICLE_KINEMATICS_PAGE_HEADER_BYTES,
  PARTICLE_KINEMATICS_PAGE_PARTICLE_BYTES,
  PARTICLE_KINEMATICS_STATE_LAYOUT_ID,
  PARTICLE_STATE_PAGE_CORE_BLOCK_FORMAT,
  PARTICLE_STATE_PAGE_EXCEPTION_BLOCK_FORMAT,
  createParticleKinematicsPageStateRegistry,
  createParticleKinematicsStateContainer,
  encodeParticleKinematicsPage,
  readParticleKinematicsStateContainer,
} = await resolveModule("engine/matter/index.js", ["PARTICLE_KINEMATICS_LOGICAL_RECORD_BYTES", "PARTICLE_KINEMATICS_PAGE_EXCEPTION_BYTES", "PARTICLE_KINEMATICS_PAGE_HEADER_BYTES", "PARTICLE_KINEMATICS_PAGE_PARTICLE_BYTES", "PARTICLE_KINEMATICS_STATE_LAYOUT_ID", "PARTICLE_STATE_PAGE_CORE_BLOCK_FORMAT", "PARTICLE_STATE_PAGE_EXCEPTION_BLOCK_FORMAT", "createParticleKinematicsPageStateRegistry", "createParticleKinematicsStateContainer", "encodeParticleKinematicsPage", "readParticleKinematicsStateContainer"]);

const output = document.querySelector('#results');
const cases = [];
const passes = [];
const failures = [];

function test(name, operation) {
  cases.push({ name, operation });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function near(actual, expected, tolerance, message) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ${expected} +/- ${tolerance}, received ${actual}`);
  }
}

async function rejects(operation, pattern, message) {
  let error = null;
  try {
    await operation();
  } catch (candidate) {
    error = candidate;
  }
  if (!error || !pattern.test(error.message)) {
    throw new Error(`${message}: expected ${pattern}, received ${error?.message ?? 'no error'}`);
  }
}

function sourceParticles() {
  return [
    { positionM: [-1, 0.25, 0.5], velocityMPerS: [0.2, -0.1, 0.05], lifeSeconds: 1, active: true },
    { positionM: [0.5, 1.25, -0.5], velocityMPerS: [0.3, -0.05, 0.1], lifeSeconds: 2, active: true },
    { positionM: [2, -0.75, 1.5], velocityMPerS: [0.1, 0, 0], lifeSeconds: 3, active: false },
  ];
}

test('engine Matter barrel exposes a page codec bound to the truthful packet layout', () => {
  const registry = createParticleKinematicsPageStateRegistry();
  const layout = registry.resolve(PARTICLE_KINEMATICS_STATE_LAYOUT_ID);
  const core = layout.blocks.find(block => block.kind === 'core-kinematics');
  const exceptions = layout.blocks.find(block => block.kind === 'precision-exceptions');
  const projection = layout.blocks.find(block => block.kind === 'projection-certificate');
  assert(layout.authorityRole === 'coupled-physical'
    && layout.lossClass === 'bounded-near-lossless', 'page authority/loss class changed');
  assert(core.format === PARTICLE_STATE_PAGE_CORE_BLOCK_FORMAT
    && core.fixedByteOverhead === PARTICLE_KINEMATICS_PAGE_HEADER_BYTES
    && core.minimumBytesPerElement === PARTICLE_KINEMATICS_PAGE_PARTICLE_BYTES,
  'core layout does not describe header + u32x2 particle lanes');
  assert(exceptions.format === PARTICLE_STATE_PAGE_EXCEPTION_BLOCK_FORMAT
    && exceptions.minimumBytesPerElement === PARTICLE_KINEMATICS_PAGE_EXCEPTION_BYTES,
  'exception layout does not describe u32x3 records');
  assert(projection && !projection.required, 'supplemental projection evidence became mandatory');
});

test('registered encoder and decoder round-trip a 128-lane page with exact byte accounting', async () => {
  const registry = createParticleKinematicsPageStateRegistry();
  const particles = sourceParticles();
  const encoded = await registry.encode(PARTICLE_KINEMATICS_STATE_LAYOUT_ID, {
    particles,
    id: 'kinematics.roundtrip',
    sourceRevision: 7,
    codecOptions: { pageSize: 128, pageIndex: 4, generation: 7 },
  });
  const core = encoded.envelope.blocks.find(block => block.kind === 'core-kinematics');
  assert(core.byteLength === 128 + 128 * 8 && core.elementCount === particles.length,
    'core block capacity or sample accounting is wrong');
  assert(encoded.envelope.payloadByteLength === core.byteLength
    && encoded.payload.byteLength === core.byteLength,
  'resident page bytes are not exact');
  assert(encoded.envelope.logicalByteLength
    === particles.length * PARTICLE_KINEMATICS_LOGICAL_RECORD_BYTES,
  'logical f32x8 byte count is wrong');
  assert(encoded.envelope.authority.physical
    && encoded.envelope.lossClass === 'bounded-near-lossless',
  'envelope lost physical authority or loss class');
  const decoded = await registry.decode(encoded.envelope, encoded.payload);
  assert(decoded.particles.length === particles.length
    && decoded.page.headerWords.byteLength === 128, 'decoded page shape changed');
  for (let index = 0; index < particles.length; index += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      near(decoded.particles[index].positionM[axis], particles[index].positionM[axis], 0.01,
        `position ${index}:${axis}`);
      near(decoded.particles[index].velocityMPerS[axis], particles[index].velocityMPerS[axis], 0.01,
        `velocity ${index}:${axis}`);
    }
  }
});

test('ranked 12-byte exceptions occupy an independent validated envelope block', async () => {
  const registry = createParticleKinematicsPageStateRegistry();
  const particles = sourceParticles();
  const encoded = await registry.encode(PARTICLE_KINEMATICS_STATE_LAYOUT_ID, {
    particles,
    codecOptions: {
      pageSize: 128,
      pageIndex: 8,
      generation: 2,
      forcedExceptionSlots: [1],
    },
  });
  const core = encoded.envelope.blocks.find(block => block.kind === 'core-kinematics');
  const exceptions = encoded.envelope.blocks.find(block => block.kind === 'precision-exceptions');
  assert(exceptions.byteOffset === core.byteLength
    && exceptions.byteLength === PARTICLE_KINEMATICS_PAGE_EXCEPTION_BYTES
    && exceptions.elementCount === 1,
  'exception sidecar byte range is not exact');
  assert(encoded.envelope.payloadByteLength === 128 + 128 * 8 + 12,
    'sidecar resident bytes were hidden from the envelope');
  const decoded = await registry.decode(encoded.envelope, encoded.payload);
  assert(decoded.particles[1].exceptional && decoded.particles[1].sidecarRank === 0,
    'ranked exception was not reconstructed');
});

test('optional projection blocks preserve aligned bytes and certificate identity', async () => {
  const registry = createParticleKinematicsPageStateRegistry();
  const certificateBytes = new Uint8Array([7, 11, 13, 17, 19]);
  const encoded = await registry.encode(PARTICLE_KINEMATICS_STATE_LAYOUT_ID, {
    particles: sourceParticles(),
    certificateIds: ['projection.kinematics.7'],
    optionalBlocks: [{
      id: 'projection.payload',
      kind: 'projection-certificate',
      format: 'projection-v1',
      data: certificateBytes,
    }],
  });
  const projection = encoded.envelope.blocks.find(block => block.kind === 'projection-certificate');
  assert(projection.byteOffset % 4 === 0 && projection.byteLength === certificateBytes.byteLength,
    'optional projection placement is wrong');
  assert(encoded.envelope.certificateIds[0] === 'projection.kinematics.7',
    'certificate identity was dropped');
  const decoded = await registry.decode(encoded.envelope, encoded.payload);
  assert(decoded.optionalBlocks.length === 1
    && decoded.optionalBlocks[0].data.every((value, index) => value === certificateBytes[index]),
  'optional projection bytes changed during round-trip');
});

test('typed payload subviews decode without reading bytes outside their declared range', async () => {
  const registry = createParticleKinematicsPageStateRegistry();
  const page = encodeParticleKinematicsPage(sourceParticles(), { pageSize: 128 });
  const container = createParticleKinematicsStateContainer(registry, page);
  const backing = new Uint8Array(container.payload.byteLength + 9).fill(0xa5);
  backing.set(container.payload, 3);
  const subview = backing.subarray(3, 3 + container.payload.byteLength);
  const decoded = readParticleKinematicsStateContainer(registry, container.envelope, subview);
  assert(decoded.particles.length === sourceParticles().length
    && backing[0] === 0xa5 && backing.at(-1) === 0xa5,
  'typed subview boundaries were not respected');
});

test('payload length and post-envelope byte mutation fail closed', async () => {
  const registry = createParticleKinematicsPageStateRegistry();
  const encoded = await registry.encode(PARTICLE_KINEMATICS_STATE_LAYOUT_ID, sourceParticles());
  await rejects(
    () => registry.decode(encoded.envelope, encoded.payload.subarray(0, -1)),
    /payload length/i,
    'truncated payload was admitted',
  );
  const corrupt = encoded.payload.slice();
  corrupt[PARTICLE_KINEMATICS_PAGE_HEADER_BYTES + 2] ^= 0x80;
  await rejects(
    () => registry.decode(encoded.envelope, corrupt),
    /checksum/i,
    'mutated base lane was admitted',
  );
});

test('header and envelope exception disagreement fails closed', async () => {
  const registry = createParticleKinematicsPageStateRegistry();
  const encoded = await registry.encode(PARTICLE_KINEMATICS_STATE_LAYOUT_ID, sourceParticles());
  const extended = new Uint8Array(encoded.payload.byteLength + 12);
  extended.set(encoded.payload);
  const malformed = registry.createEnvelope({
    ...encoded.envelope,
    payloadByteLength: extended.byteLength,
    blocks: [
      ...encoded.envelope.blocks,
      {
        id: 'invented.exceptions',
        kind: 'precision-exceptions',
        format: PARTICLE_STATE_PAGE_EXCEPTION_BLOCK_FORMAT,
        byteOffset: encoded.payload.byteLength,
        byteLength: 12,
        elementCount: 1,
      },
    ],
  });
  await rejects(
    () => registry.decode(malformed, extended),
    /presence disagrees/i,
    'invented sidecar was admitted despite a zero exceptionCount header',
  );
});


const rows = [];
for (const entry of cases) {
 try { await entry.operation(); rows.push({name:entry.name, passed:true}); }
 catch (error) { rows.push({name:entry.name, passed:false, error:String(error?.stack || error)}); }
}
export const suiteResult = finishSuite('particle-codec', rows);
