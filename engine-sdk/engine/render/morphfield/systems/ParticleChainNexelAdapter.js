// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const DEFAULT_MATERIAL = Object.freeze({
  type: 'pbr',
  baseColorFactor: Object.freeze([0.62, 0.7, 0.82, 1]),
  roughnessFactor: 0.24,
  metallicFactor: 0.72,
});
const MAX_CHAIN_POINTS = 4096;

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError(`${label} must be finite`);
  return number;
}

function positive(value, label) {
  const number = finite(value, label);
  if (!(number > 0)) throw new RangeError(`${label} must be positive`);
  return number;
}

function point3(value, label) {
  const source = Array.isArray(value) || ArrayBuffer.isView(value)
    ? value
    : value && typeof value === 'object'
      ? [value.x ?? value.vx, value.y ?? value.vy, value.z ?? value.vz]
      : null;
  if (!source || source.length < 3) throw new TypeError(`${label} must be a three-component point`);
  return Object.freeze([
    finite(source[0], `${label}[0]`),
    finite(source[1], `${label}[1]`),
    finite(source[2], `${label}[2]`),
  ]);
}

function pointsFromSnapshot(snapshot) {
  const candidates = [snapshot?.positions, snapshot?.links, snapshot?.particles];
  const source = candidates.find(candidate => (
    (Array.isArray(candidate) || ArrayBuffer.isView(candidate)) && candidate.length > 0
  ));
  if (!Array.isArray(source) && !ArrayBuffer.isView(source)) {
    throw new TypeError('Particle-chain Nexel snapshot requires positions, links, or particles');
  }
  const values = ArrayBuffer.isView(source)
    ? (() => {
      if (source.length % 3 !== 0) throw new RangeError('Flat particle-chain position arrays must contain xyz triples');
      return Array.from({ length: source.length / 3 }, (_, index) => point3(source.subarray(index * 3, index * 3 + 3), `chain point ${index}`));
    })()
    : Array.from(source, (value, index) => point3(value, `chain point ${index}`));
  if (values.length < 2 || values.length > MAX_CHAIN_POINTS) {
    throw new RangeError(`Particle-chain Nexel snapshot requires 2..${MAX_CHAIN_POINTS} points`);
  }
  return Object.freeze(values);
}

function optionalPoints(source, expectedLength, label) {
  if (source === undefined || source === null) return null;
  if (!Array.isArray(source) && !ArrayBuffer.isView(source)) throw new TypeError(`${label} must be an array`);
  const values = ArrayBuffer.isView(source)
    ? (() => {
      if (source.length % 3 !== 0) throw new RangeError(`${label} flat arrays must contain xyz triples`);
      return Array.from({ length: source.length / 3 }, (_, index) => point3(source.subarray(index * 3, index * 3 + 3), `${label}[${index}]`));
    })()
    : Array.from(source, (value, index) => point3(value, `${label}[${index}]`));
  if (values.length !== expectedLength) throw new RangeError(`${label} must match the current point count`);
  return Object.freeze(values);
}

function quaternionFromY(direction) {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!(length > 1e-12)) return Object.freeze([0, 0, 0, 1]);
  const x = direction[0] / length;
  const y = direction[1] / length;
  const z = direction[2] / length;
  if (y < -0.999999) return Object.freeze([1, 0, 0, 0]);
  const rotation = [z, 0, -x, 1 + y];
  const rotationLength = Math.hypot(...rotation);
  return Object.freeze(rotation.map(value => value / rotationLength));
}

function velocityAt(index, points, previousPoints, velocities, duration) {
  if (velocities) return velocities[index];
  if (!previousPoints) return Object.freeze([0, 0, 0]);
  return Object.freeze(points[index].map((value, axis) => (
    (value - previousPoints[index][axis]) / duration
  )));
}

function average3(left, right) {
  return Object.freeze(left.map((value, axis) => (value + right[axis]) * 0.5));
}

function linkAngularVelocity(start, end, previousStart, previousEnd, duration) {
  if (!previousStart || !previousEnd) return Object.freeze([0, 0, 0]);
  const current = end.map((value, axis) => value - start[axis]);
  const previous = previousEnd.map((value, axis) => value - previousStart[axis]);
  const currentLength = Math.hypot(...current);
  const previousLength = Math.hypot(...previous);
  if (!(currentLength > 1e-12) || !(previousLength > 1e-12)) return Object.freeze([0, 0, 0]);
  const a = previous.map(value => value / previousLength);
  const b = current.map(value => value / currentLength);
  const cross = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const crossLength = Math.hypot(...cross);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const angle = Math.atan2(crossLength, dot);
  if (!(crossLength > 1e-12) || !(angle > 0)) return Object.freeze([0, 0, 0]);
  const speed = angle / duration;
  return Object.freeze(cross.map(value => value / crossLength * speed));
}

function stableChainId(value) {
  const id = String(value ?? '').trim();
  if (!id || Array.from(id).length > 80 || /[\u0000-\u001f\u007f]/u.test(id)) {
    throw new RangeError('Particle-chain Nexel id must be a non-empty stable string of at most 80 characters');
  }
  return id;
}

function collisionDescriptor(value) {
  if (value === false || value?.enabled === false) return false;
  const source = value === true || value === undefined ? {} : value;
  if (!source || typeof source !== 'object') throw new TypeError('Particle-chain collision must be a boolean or object');
  const contactOffset = Math.max(0, finite(source.contactOffset ?? source.contactSlop ?? 0.002, 'collision.contactOffset'));
  const restOffset = finite(source.restOffset ?? 0, 'collision.restOffset');
  if (restOffset > contactOffset) throw new RangeError('collision.restOffset must not exceed collision.contactOffset');
  return Object.freeze({
    contactOffset,
    restOffset,
    contactSlop: contactOffset,
    layer: Math.max(0, Math.min(31, Math.trunc(finite(source.layer ?? 0, 'collision.layer')))),
    mask: Number(source.mask ?? 0xffffffff) >>> 0,
  });
}

function simulationMetadata({ chainId, role, index, authority, sourceRevision }) {
  return Object.freeze({
    adapter: 'particle-chain-nexel-snapshot',
    chainId,
    role,
    index,
    authority,
    sourceRevision,
  });
}

/**
 * Convert a caller-owned particle-chain snapshot into stable sphere/capsule
 * Nexels. The simulation remains authoritative; this adapter performs no
 * stepping, GPU readback, queue submission, or resource ownership transfer.
 *
 * Editor PhysicsChain component `links`, CPU PBD `particles`, and ordinary
 * `[x,y,z]` arrays intentionally share this one input contract.
 */
export function createParticleChainNexelDescriptors(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('Particle-chain Nexel snapshot is required');
  const chainId = stableChainId(options.id ?? snapshot.id ?? snapshot.entityId ?? 'chain');
  const points = pointsFromSnapshot(snapshot);
  const duration = positive(options.validDuration ?? snapshot.validDuration ?? (1 / 60), 'validDuration');
  const previousPoints = optionalPoints(options.previousPositions ?? snapshot.previousPositions, points.length, 'previousPositions');
  const velocities = optionalPoints(options.velocities ?? snapshot.velocities, points.length, 'velocities');
  const nodeRadius = positive(options.nodeRadius ?? snapshot.nodeRadius ?? snapshot.linkRadius ?? 0.08, 'nodeRadius');
  const linkRadius = positive(options.linkRadius ?? snapshot.linkRadius ?? nodeRadius * 0.62, 'linkRadius');
  const includeNodes = options.includeNodes !== false;
  const includeLinks = options.includeLinks !== false;
  if (!includeNodes && !includeLinks) throw new RangeError('Particle-chain Nexel adapter must emit nodes, links, or both');
  const material = options.material ?? snapshot.material ?? DEFAULT_MATERIAL;
  const collision = collisionDescriptor(options.collision ?? snapshot.collision ?? true);
  const authority = (options.authority ?? snapshot.authority) === 'authoritative' ? 'authoritative' : 'visual';
  const sourceRevision = finite(options.sourceRevision ?? snapshot.revision ?? 0, 'sourceRevision');
  if (!Number.isSafeInteger(sourceRevision) || sourceRevision < 0) {
    throw new RangeError('sourceRevision must be a non-negative safe integer');
  }
  const pointVelocities = points.map((_, index) => velocityAt(index, points, previousPoints, velocities, duration));
  const descriptors = [];

  if (includeNodes) {
    for (let index = 0; index < points.length; index += 1) {
      descriptors.push(Object.freeze({
        id: `${chainId}:node:${String(index).padStart(4, '0')}`,
        source: Object.freeze({ kind: 'sphere', radius: nodeRadius }),
        transform: Object.freeze({ translation: points[index] }),
        material,
        motion: Object.freeze({ velocity: pointVelocities[index], validDuration: duration }),
        collision,
        simulation: simulationMetadata({ chainId, role: 'node', index, authority, sourceRevision }),
        intent: Object.freeze({ updateClass: 'dynamic', authoritative: authority === 'authoritative', qualityImportance: 0.9 }),
      }));
    }
  }

  if (includeLinks) {
    for (let index = 0; index + 1 < points.length; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      const delta = end.map((value, axis) => value - start[axis]);
      const length = Math.hypot(...delta);
      if (!(length > 1e-9)) throw new RangeError(`Particle-chain link ${index} has coincident endpoints`);
      const angularVelocity = linkAngularVelocity(
        start,
        end,
        previousPoints?.[index],
        previousPoints?.[index + 1],
        duration,
      );
      descriptors.push(Object.freeze({
        id: `${chainId}:link:${String(index).padStart(4, '0')}`,
        source: Object.freeze({ kind: 'capsule', radius: linkRadius, halfHeight: Math.max(0, length * 0.5 - linkRadius) }),
        transform: Object.freeze({ translation: average3(start, end), rotation: quaternionFromY(delta) }),
        material,
        motion: Object.freeze({
          velocity: average3(pointVelocities[index], pointVelocities[index + 1]),
          angularVelocity,
          validDuration: duration,
        }),
        collision,
        simulation: Object.freeze({
          ...simulationMetadata({ chainId, role: 'link', index, authority: 'visual', sourceRevision }),
          sourceAuthority: authority,
          motionModel: 'rigid-link-envelope',
          collisionRole: 'queryable-visual-skin',
        }),
        intent: Object.freeze({ updateClass: 'dynamic', authoritative: false, qualityImportance: 0.82 }),
      }));
    }
  }
  return Object.freeze(descriptors);
}

/** Build an incremental scene patch while preserving stable chain IDs. */
export function createParticleChainNexelPatch(scene, snapshot, options = {}) {
  if (!scene || typeof scene.values !== 'function' || typeof scene.createPatch !== 'function') {
    throw new TypeError('Particle-chain Nexel patch requires a MorphField scene');
  }
  const upsert = createParticleChainNexelDescriptors(snapshot, options);
  const chainId = upsert[0]?.simulation?.chainId;
  const nextIds = new Set(upsert.map(descriptor => descriptor.id));
  const remove = scene.values()
    .filter(descriptor => descriptor.simulation?.adapter === 'particle-chain-nexel-snapshot'
      && descriptor.simulation?.chainId === chainId
      && !nextIds.has(descriptor.id))
    .map(descriptor => descriptor.id);
  return scene.createPatch({ upsert, remove });
}

export const PARTICLE_CHAIN_NEXEL_LIMITS = Object.freeze({ maxPoints: MAX_CHAIN_POINTS });
