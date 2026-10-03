// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { stepParticleSimWorld } from '../../../sim/particles/ParticleSimWorld.js';
import { stepFluidSimWorld } from '../../../sim/fluids/FluidSimWorld.js';

function requireWorld(world, label) {
  if (!world || typeof world !== 'object') throw new TypeError(`${label} requires an initialized world`);
  return world;
}

/** Adapt the existing particle world to the shared host encoder. */
export function createParticleWorldAdapter(world, options = {}) {
  requireWorld(world, 'Particle adapter');
  return {
    id: String(options.id || 'particles'),
    authority: options.authority === 'visual' ? 'visual' : 'authoritative',
    updateStride: Math.max(1, options.updateStride ?? 1),
    encodeStep({ encoder, dt, tick, queries }) {
      const queryResult = typeof options.encodeQueries === 'function'
        ? options.encodeQueries({ encoder, world, queries, dt, tick })
        : null;
      const result = stepParticleSimWorld(world, dt, {
        ...(options.stepOptions || {}),
        encoder,
        frameSeed: options.frameSeed ? options.frameSeed(tick) : tick,
      });
      return {
        boundsDirty: options.boundsDirty !== false,
        revision: options.getRevision ? options.getRevision(world, tick) : tick + 1,
        queryResult,
        simulationResult: result,
      };
    },
    interpolate: typeof options.interpolate === 'function'
      ? (alpha) => options.interpolate(world, alpha)
      : null,
  };
}

/** Adapt the existing external-encoder fluid grid. */
export function createFluidWorldAdapter(world, options = {}) {
  requireWorld(world, 'Fluid adapter');
  return {
    id: String(options.id || 'fluid'),
    authority: options.authority === 'authoritative' ? 'authoritative' : 'visual',
    updateStride: Math.max(1, options.updateStride ?? 1),
    encodeStep({ encoder, dt, tick, queries }) {
      const queryResult = typeof options.encodeQueries === 'function'
        ? options.encodeQueries({ encoder, world, queries, dt, tick })
        : null;
      stepFluidSimWorld(world, dt, { ...(options.stepOptions || {}), encoder });
      return {
        boundsDirty: options.boundsDirty === true,
        revision: options.getRevision ? options.getRevision(world, tick) : tick + 1,
        queryResult,
      };
    },
    interpolate: typeof options.interpolate === 'function'
      ? (alpha) => options.interpolate(world, alpha)
      : null,
  };
}

/** Adapt an existing volume system exposing update(encoder, camera). */
export function createVolumeSystemAdapter(volumeSystem, options = {}) {
  if (!volumeSystem || typeof volumeSystem.update !== 'function') throw new TypeError('Volume adapter requires update(encoder, camera)');
  return {
    id: String(options.id || 'volume'), authority: 'visual', updateStride: Math.max(1, options.updateStride ?? 1),
    encodeStep({ encoder, dt, tick, queries }) {
      const camera = typeof options.getCamera === 'function' ? options.getCamera({ dt, tick }) : options.camera;
      if (typeof options.encodeQueries === 'function') options.encodeQueries({ encoder, volumeSystem, queries, dt, tick });
      volumeSystem.update(encoder, camera);
      return { boundsDirty: options.boundsDirty === true, revision: tick + 1 };
    },
  };
}

/**
 * Generic bridge for a caller-owned GPU simulation. It deliberately does not
 * invent domain-specific solver names or resource ownership.
 */
export function createGpuSimulationAdapter(descriptor) {
  if (!descriptor || typeof descriptor.encode !== 'function') throw new TypeError('GPU simulation adapter requires encode(context)');
  return {
    id: String(descriptor.id), authority: descriptor.authority === 'visual' ? 'visual' : 'authoritative',
    updateStride: Math.max(1, descriptor.updateStride ?? 1),
    encodeStep(context) { return descriptor.encode(context) || {}; },
    interpolate: typeof descriptor.interpolate === 'function' ? descriptor.interpolate : null,
  };
}

