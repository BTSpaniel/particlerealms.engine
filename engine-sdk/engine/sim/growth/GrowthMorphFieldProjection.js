// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { canonicalize } from '../../state/util/canonical.js';
import { NexelScene, normalizeNexelPatch } from '../../render/morphfield/core/NexelScene.js';
import { NEXEL_LIMITS } from '../../render/morphfield/core/constants.js';
import { normalizeNexelDescriptor } from '../../render/morphfield/core/validation.js';
import {
  compareGrowthIds,
  failGrowth,
  freezeGrowthJson,
  requireGrowthInteger,
} from './GrowthContracts.js';
import { normalizeGrowthState } from './GrowthState.js';

const DEFAULT_MATERIALS = Object.freeze({
  branch: Object.freeze({
    id: 'growth.material.wood', type: 'pbr', baseColorFactor: [0.28, 0.12, 0.045, 1],
    emissiveFactor: [0, 0, 0], metallicFactor: 0, roughnessFactor: 0.92,
  }),
  root: Object.freeze({
    id: 'growth.material.root', type: 'pbr', baseColorFactor: [0.2, 0.075, 0.025, 1],
    emissiveFactor: [0, 0, 0], metallicFactor: 0, roughnessFactor: 1,
  }),
  leaf: Object.freeze({
    id: 'growth.material.leaf', type: 'pbr', baseColorFactor: [0.12, 0.48, 0.1, 1],
    emissiveFactor: [0, 0, 0], metallicFactor: 0, roughnessFactor: 0.8,
  }),
  fruit: Object.freeze({
    id: 'growth.material.fruit', type: 'pbr', baseColorFactor: [0.72, 0.12, 0.04, 1],
    emissiveFactor: [0, 0, 0], metallicFactor: 0, roughnessFactor: 0.72,
  }),
  bud: Object.freeze({
    id: 'growth.material.bud', type: 'pbr', baseColorFactor: [0.35, 0.62, 0.16, 1],
    emissiveFactor: [0, 0, 0], metallicFactor: 0, roughnessFactor: 0.82,
  }),
});

function midpoint(start, end) {
  return [0, 1, 2].map(axis => Math.fround((start[axis] + end[axis]) * 0.5));
}

function quaternionFromPositiveY(direction) {
  const dot = Math.max(-1, Math.min(1, direction[1]));
  if (dot < -0.999999) return [1, 0, 0, 0];
  const quaternion = [direction[2], 0, -direction[0], 1 + dot];
  const length = Math.hypot(...quaternion);
  if (!(length > 1e-8)) return [0, 0, 0, 1];
  return quaternion.map(value => Math.fround(value / length));
}

function nexelId(family, entityId) {
  return `growth:${family}:${entityId}`;
}

function projectionOptions(options = {}) {
  return {
    includeBuds: options.includeBuds === true,
    materials: { ...DEFAULT_MATERIALS, ...(options.materials ?? {}) },
    collision: options.collision === true
      ? { enabled: true, contactOffset: options.contactOffset ?? 0.001, restOffset: 0, layer: options.collisionLayer ?? 0, mask: options.collisionMask ?? 0xffffffff }
      : null,
  };
}

export function growthEntityToNexelDescriptor(entity, family, _sourceRevision, options = {}) {
  const settings = projectionOptions(options);
  let source;
  let transform;
  if (family === 'branch' || family === 'root') {
    source = { kind: 'capsule', radius: entity.radius, halfHeight: entity.length * 0.5 };
    transform = { translation: midpoint(entity.start, entity.end), rotation: quaternionFromPositiveY(entity.direction), scale: 1 };
  } else {
    source = { kind: 'sphere', radius: family === 'bud' ? Math.max(0.006, entity.size ?? 0.02) : entity.size };
    transform = { translation: entity.position, rotation: [0, 0, 0, 1], scale: 1 };
  }
  return normalizeNexelDescriptor({
    id: nexelId(family, entity.id),
    source,
    transform,
    material: settings.materials[family],
    collision: settings.collision,
    simulation: {
      adapter: 'engine.growth.visual',
      authority: 'visual',
      entityId: entity.id,
      entityType: family,
      lineage: entity.lineage,
    },
    intent: {
      updateClass: 'low-churn',
      topologyRequirement: 'closed-2-manifold',
      featureMode: 'smooth',
      qualityImportance: family === 'branch' || family === 'root' ? 0.9 : 0.65,
      authoritative: false,
    },
  }, `growth.${family}.${entity.id}`);
}

export function projectGrowthStateToNexelDescriptors(stateInput, options = {}) {
  const state = normalizeGrowthState(stateInput);
  const settings = projectionOptions(options);
  const families = [
    ['branch', state.branches],
    ['root', state.roots],
    ['leaf', state.leaves.filter(entity => entity.active)],
    ['fruit', state.fruits.filter(entity => entity.active)],
  ];
  if (settings.includeBuds) families.push(['bud', state.buds.filter(entity => entity.state === 'active')]);
  const descriptors = [];
  for (const [family, entities] of families) {
    for (const entity of entities) descriptors.push(growthEntityToNexelDescriptor(entity, family, state.revision, options));
  }
  if (descriptors.length > NEXEL_LIMITS.MAX_NEXELS) {
    failGrowth('GROWTH_MORPHFIELD_LIMIT', `Growth projection exceeds ${NEXEL_LIMITS.MAX_NEXELS} Nexels`);
  }
  descriptors.sort((left, right) => compareGrowthIds(left.id, right.id));
  return Object.freeze(descriptors);
}

export function createGrowthNexelScene(stateInput, options = {}) {
  const state = normalizeGrowthState(stateInput);
  return new NexelScene({
    id: options.sceneId ?? `growth.${state.assetId}`,
    units: 'meters',
    revision: options.revision ?? state.revision,
    nexels: projectGrowthStateToNexelDescriptors(state, options),
  });
}

export function projectGrowthStateToNexelPatch(previousInput, nextInput, sceneRevision = null, options = {}) {
  if (sceneRevision !== null && typeof sceneRevision === 'object') {
    options = sceneRevision;
    sceneRevision = options.sceneRevision ?? null;
  }
  const previous = normalizeGrowthState(previousInput);
  const next = normalizeGrowthState(nextInput);
  if (previous.assetId !== next.assetId || previous.program.id !== next.program.id) {
    failGrowth('GROWTH_MORPHFIELD_IDENTITY', 'MorphField growth projection requires matching asset and program identity');
  }
  if (next.revision !== previous.revision + 1) {
    failGrowth('GROWTH_MORPHFIELD_CONTINUITY', 'MorphField growth projection requires consecutive state revisions');
  }
  const previousDescriptors = new Map(projectGrowthStateToNexelDescriptors(previous, options).map(entry => [entry.id, entry]));
  const nextDescriptors = new Map(projectGrowthStateToNexelDescriptors(next, options).map(entry => [entry.id, entry]));
  const remove = [...previousDescriptors.keys()].filter(id => !nextDescriptors.has(id)).sort(compareGrowthIds);
  const upsert = [...nextDescriptors.values()].filter(descriptor => {
    const before = previousDescriptors.get(descriptor.id);
    return !before || canonicalize(before) !== canonicalize(descriptor);
  }).sort((left, right) => compareGrowthIds(left.id, right.id));
  const currentSceneRevision = requireGrowthInteger(sceneRevision ?? previous.revision, 'current MorphField scene revision');
  if (currentSceneRevision >= Number.MAX_SAFE_INTEGER) {
    failGrowth('GROWTH_MORPHFIELD_REVISION_EXHAUSTED', 'MorphField scene revision cannot advance');
  }
  const revision = currentSceneRevision + 1;
  return normalizeNexelPatch({ revision, completeSnapshot: false, upsert, remove });
}

export function describeGrowthMorphFieldProjection(stateInput, options = {}) {
  const state = normalizeGrowthState(stateInput);
  const descriptors = projectGrowthStateToNexelDescriptors(state, options);
  return freezeGrowthJson({
    assetId: state.assetId,
    growthRevision: state.revision,
    growthStateHash: state.stateHash,
    environmentRevision: state.environmentRevision,
    nexelCount: descriptors.length,
    nexelIds: descriptors.map(descriptor => descriptor.id),
  }, '$.growthMorphFieldProjection');
}
