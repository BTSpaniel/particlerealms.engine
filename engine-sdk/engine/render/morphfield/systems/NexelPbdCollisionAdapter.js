// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { composeTransforms, normalizeTransform } from '../core/Transform.js';

const COLLIDER_KIND = Object.freeze({
  GROUND_PLANE: 'ground-plane',
  SPHERE: 'sphere',
});

function finite(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError(`${name} must be finite`);
  return Object.is(number, -0) ? 0 : number;
}

function descriptorsOf(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value.values === 'function') return value.values();
  throw new TypeError('Nexel PBD collision sync requires a descriptor array or scene');
}

function offsetsOf(descriptor, defaultContactOffset, defaultRestOffset) {
  const collision = descriptor?.collision;
  if (!collision || collision.enabled === false) {
    throw new RangeError(`Nexel ${descriptor?.id || '<unknown>'} is marked as a PBD collider without collision metadata`);
  }
  const contactOffset = finite(
    collision.contactOffset ?? collision.contactSlop ?? defaultContactOffset,
    `${descriptor.id}.collision.contactOffset`,
  );
  const restOffset = finite(
    collision.restOffset ?? defaultRestOffset,
    `${descriptor.id}.collision.restOffset`,
  );
  if (!(contactOffset > 0)) throw new RangeError(`${descriptor.id}.collision.contactOffset must be positive for OGC`);
  if (restOffset > contactOffset) {
    throw new RangeError(`${descriptor.id}.collision.restOffset must not exceed contactOffset`);
  }
  return { contactOffset, restOffset };
}

function colliderKindOf(descriptor) {
  return String(
    descriptor?.simulation?.pbdCollider
      ?? descriptor?.simulation?.collider
      ?? '',
  ).toLowerCase();
}

function combinedTransformOf(descriptor) {
  return composeTransforms(
    normalizeTransform(descriptor.transform, `${descriptor.id}.transform`),
    normalizeTransform(descriptor.source?.transform, `${descriptor.id}.source.transform`),
  );
}

function isAxisAligned(rotation) {
  return Math.abs(rotation[0]) <= 1e-8
    && Math.abs(rotation[1]) <= 1e-8
    && Math.abs(rotation[2]) <= 1e-8
    && Math.abs(Math.abs(rotation[3]) - 1) <= 1e-8;
}

/**
 * Compile semantic static Nexels into PBDSolver collider inputs. PBDSolver's
 * contactRadius remains a predictive OGC shell, while the solver geometry is
 * inset by contactOffset-restOffset so the rendered and collision surfaces
 * settle at the requested restOffset (zero by default).
 */
export function compileNexelPbdColliderSet(descriptorInput, {
  contactOffset = 0.002,
  restOffset = 0,
  friction = 0.36,
} = {}) {
  const defaultContactOffset = finite(contactOffset, 'contactOffset');
  const defaultRestOffset = finite(restOffset, 'restOffset');
  const defaultFriction = finite(friction, 'friction');
  if (!(defaultContactOffset > 0) || defaultRestOffset > defaultContactOffset) {
    throw new RangeError('Nexel PBD collision offsets require contactOffset > 0 and restOffset <= contactOffset');
  }
  if (defaultFriction < 0 || defaultFriction > 1) throw new RangeError('Nexel PBD friction must be within 0..1');

  let solverContactOffset = null;
  let ground = null;
  const spheres = [];
  const sourceIds = [];
  for (const descriptor of descriptorsOf(descriptorInput)) {
    const kind = colliderKindOf(descriptor);
    if (!Object.values(COLLIDER_KIND).includes(kind)) continue;
    const offsets = offsetsOf(descriptor, defaultContactOffset, defaultRestOffset);
    if (solverContactOffset === null) solverContactOffset = offsets.contactOffset;
    else if (Math.abs(solverContactOffset - offsets.contactOffset) > 1e-9) {
      throw new RangeError('One PBDSolver requires one shared contactOffset across its Nexel colliders');
    }
    const transform = combinedTransformOf(descriptor);
    const colliderFriction = finite(descriptor.simulation?.friction ?? defaultFriction, `${descriptor.id}.simulation.friction`);
    if (colliderFriction < 0 || colliderFriction > 1) {
      throw new RangeError(`${descriptor.id}.simulation.friction must be within 0..1`);
    }

    if (kind === COLLIDER_KIND.GROUND_PLANE) {
      if (ground) throw new RangeError('Nexel PBD collision set supports one authoritative ground plane');
      if (descriptor.source?.kind !== 'box' || !isAxisAligned(transform.rotation)) {
        throw new RangeError(`${descriptor.id} ground-plane collider must be an axis-aligned box Nexel`);
      }
      const halfY = finite(descriptor.source.halfExtents?.[1], `${descriptor.id}.source.halfExtents[1]`) * transform.scale;
      if (!(halfY > 0)) throw new RangeError(`${descriptor.id} ground-plane half extent must be positive`);
      const visualSurfaceY = transform.translation[1] + halfY;
      ground = Object.freeze({
        nexelId: descriptor.id,
        visualSurfaceY,
        solverSurfaceY: visualSurfaceY + offsets.restOffset - offsets.contactOffset,
        contactOffset: offsets.contactOffset,
        restOffset: offsets.restOffset,
        friction: colliderFriction,
      });
    } else {
      if (descriptor.source?.kind !== 'sphere') {
        throw new RangeError(`${descriptor.id} sphere collider must use a sphere Nexel source`);
      }
      const visualRadius = finite(descriptor.source.radius, `${descriptor.id}.source.radius`) * transform.scale;
      const solverRadius = visualRadius + offsets.restOffset - offsets.contactOffset;
      if (!(solverRadius > 0)) throw new RangeError(`${descriptor.id} inset sphere collider radius must remain positive`);
      spheres.push(Object.freeze({
        nexelId: descriptor.id,
        center: Object.freeze([...transform.translation]),
        visualRadius,
        solverRadius,
        contactOffset: offsets.contactOffset,
        restOffset: offsets.restOffset,
        friction: colliderFriction,
      }));
    }
    sourceIds.push(descriptor.id);
  }
  if (!ground && spheres.length === 0) throw new RangeError('No simulation.pbdCollider Nexels were supplied');
  return Object.freeze({
    contactOffset: solverContactOffset ?? defaultContactOffset,
    restOffset: defaultRestOffset,
    ground,
    spheres: Object.freeze(spheres),
    sourceIds: Object.freeze(sourceIds),
  });
}

/** Apply a compiled collider set without taking ownership of the solver. */
export function applyNexelPbdColliderSet(solver, colliderSet) {
  if (!solver || typeof solver.clearColliders !== 'function'
      || typeof solver.setContactParams !== 'function'
      || typeof solver.addSphereCollider !== 'function') {
    throw new TypeError('Nexel PBD collision adapter requires a compatible PBDSolver');
  }
  if (!colliderSet || !Array.isArray(colliderSet.spheres)) {
    throw new TypeError('A compiled Nexel PBD collider set is required');
  }
  solver.clearColliders();
  solver.setContactParams(colliderSet.contactOffset);
  solver.enableGroundCollision = Boolean(colliderSet.ground);
  if (colliderSet.ground) {
    solver.groundY = colliderSet.ground.solverSurfaceY;
    solver.friction = colliderSet.ground.friction;
  }
  for (const sphere of colliderSet.spheres) {
    solver.addSphereCollider(sphere.center, sphere.solverRadius, sphere.friction);
  }
  return colliderSet;
}

export class NexelPbdCollisionAdapter {
  constructor({ solver, contactOffset = 0.002, restOffset = 0, friction = 0.36 } = {}) {
    if (!solver) throw new TypeError('NexelPbdCollisionAdapter requires a solver');
    this.solver = solver;
    this.options = Object.freeze({ contactOffset, restOffset, friction });
    this.colliderSet = null;
    this.syncCount = 0;
  }

  sync(descriptors) {
    const next = compileNexelPbdColliderSet(descriptors, this.options);
    applyNexelPbdColliderSet(this.solver, next);
    this.colliderSet = next;
    this.syncCount += 1;
    return next;
  }

  getStats() {
    return Object.freeze({
      syncCount: this.syncCount,
      sourceIds: this.colliderSet?.sourceIds || Object.freeze([]),
      contactOffset: this.colliderSet?.contactOffset ?? this.options.contactOffset,
      restOffset: this.colliderSet?.restOffset ?? this.options.restOffset,
      sphereCount: this.colliderSet?.spheres.length || 0,
      hasGround: Boolean(this.colliderSet?.ground),
    });
  }
}

export function createNexelPbdCollisionAdapter(options) {
  return new NexelPbdCollisionAdapter(options);
}

export { COLLIDER_KIND as NEXEL_PBD_COLLIDER_KIND };
