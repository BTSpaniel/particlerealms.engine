// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  aggregateBounds,
  computeMeshBounds,
  makeBoxMesh,
  makeCylinderMesh,
  makeTaperedBoxMesh,
  translateMesh,
} from './VehicleProceduralGeometry.js';
import { SEDAN_2_PROFILE, resolveVehicleProfile } from './VehicleProfile.js';

export const SEDAN_VISUAL_PART_IDS = Object.freeze([
  'chassis', 'body_lower', 'hood', 'trunk_lid', 'roof',
  'front_bumper', 'rear_bumper', 'grille',
  'windshield', 'rear_window',
  'side_window_front_left', 'side_window_front_right',
  'side_window_rear_left', 'side_window_rear_right',
  'door_front_left', 'door_front_right', 'door_rear_left', 'door_rear_right',
  'mirror_left', 'mirror_right',
  'headlight_left', 'headlight_right', 'taillight_left', 'taillight_right',
  'seat_driver', 'seat_passenger', 'seat_rear', 'steering_wheel',
  'wheel_front_left', 'wheel_front_right', 'wheel_rear_left', 'wheel_rear_right',
]);

export const WHEEL_RADIUS = SEDAN_2_PROFILE.wheelRadius;

function axisAngleQuaternion(axis, angle) {
  const half = angle / 2;
  const sine = Math.sin(half);
  return [axis[0] * sine, axis[1] * sine, axis[2] * sine, Math.cos(half)];
}

function translatedBounds(bounds, position) {
  return {
    min: bounds.min.map((value, axis) => value + position[axis]),
    max: bounds.max.map((value, axis) => value + position[axis]),
  };
}

/**
 * Build the production Sedan 2.0 EngineModel. Every visible module has a
 * deterministic semantic node ID and the authored nose points toward +Z.
 */
export function buildSedanModel(AM, bodyColor = [0.7, 0.15, 0.15, 1], requestedProfile = SEDAN_2_PROFILE) {
  const profile = resolveVehicleProfile(requestedProfile);
  const { createEngineModel, createEngineNode, createEngineMesh, createEnginePrimitive, createEngineMaterial } = AM;
  const model = createEngineModel({
    id: `engine.vehicle.${profile.id}`,
    name: 'Sedan 2.0',
    metadata: {
      generator: 'engine.assets.vehicle.SedanProceduralModel',
      generatorVersion: '1.0.0',
      profileId: profile.id,
      profileKey: profile.key,
      vehicleProfile: profile,
      authoringBasis: profile.authoringBasis,
      stablePartIds: SEDAN_VISUAL_PART_IDS,
    },
  });
  const widthScale = profile.width / 1.8;
  const lengthScale = profile.length / 4.5;
  const heightScale = profile.height / 1.3;
  const material = {
    body: createEngineMaterial({ id: 'sedan.material.body', name: 'Body paint', baseColorFactor: bodyColor, roughnessFactor: 0.32, metallicFactor: 0.18 }),
    trim: createEngineMaterial({ id: 'sedan.material.trim', name: 'Exterior trim', baseColorFactor: [0.055, 0.06, 0.07, 1], roughnessFactor: 0.62 }),
    glass: createEngineMaterial({ id: 'sedan.material.glass', name: 'Automotive glass', baseColorFactor: [0.28, 0.48, 0.62, 0.58], alphaMode: 'blend', roughnessFactor: 0.08, metallicFactor: 0.1 }),
    tire: createEngineMaterial({ id: 'sedan.material.tire', name: 'Tire rubber', baseColorFactor: [0.035, 0.04, 0.045, 1], roughnessFactor: 0.92 }),
    rim: createEngineMaterial({ id: 'sedan.material.rim', name: 'Alloy wheel', baseColorFactor: [0.58, 0.62, 0.68, 1], roughnessFactor: 0.22, metallicFactor: 0.88 }),
    rotor: createEngineMaterial({ id: 'sedan.material.rotor', name: 'Brake rotor', baseColorFactor: [0.35, 0.37, 0.39, 1], roughnessFactor: 0.4, metallicFactor: 0.8 }),
    interior: createEngineMaterial({ id: 'sedan.material.interior', name: 'Interior', baseColorFactor: [0.12, 0.13, 0.15, 1], roughnessFactor: 0.82 }),
    headlight: createEngineMaterial({ id: 'sedan.material.headlight', name: 'Headlight', baseColorFactor: [1, 0.98, 0.82, 1], emissiveFactor: [0.9, 0.88, 0.7] }),
    taillight: createEngineMaterial({ id: 'sedan.material.taillight', name: 'Tail light', baseColorFactor: [0.9, 0.06, 0.035, 1], emissiveFactor: [0.55, 0.025, 0.01] }),
  };
  model.materials = Object.values(material);

  const nodes = [];
  const meshes = [];
  const primitives = [];
  const worldBounds = [];
  const root = createEngineNode({
    id: 'sedan.root',
    name: 'Sedan 2.0 (+Z forward)',
    parent: null,
    extras: { stableId: 'sedan.root', profileId: profile.id },
  });
  nodes.push(root);

  function addPart(id, translation, parts, { rotation = [0, 0, 0, 1], parent = root.id } = {}) {
    if (!SEDAN_VISUAL_PART_IDS.includes(id)) throw new Error(`Sedan part '${id}' is not in the stable inventory`);
    const meshId = `sedan.mesh.${id}`;
    const primitiveIds = [];
    parts.forEach((part, index) => {
      const primitiveId = `sedan.primitive.${id}.${index}`;
      const bounds = computeMeshBounds(part.geometry.position);
      primitives.push(createEnginePrimitive({
        id: primitiveId,
        mesh: meshId,
        material: part.materialId,
        attributes: {
          position: part.geometry.position,
          normal: part.geometry.normal,
          uv0: part.geometry.uv0,
        },
        indices: part.geometry.indices,
        vertexCount: part.geometry.vertexCount,
        bounds,
      }));
      primitiveIds.push(primitiveId);
      worldBounds.push(translatedBounds(bounds, translation));
    });
    meshes.push(createEngineMesh({ id: meshId, name: id, primitives: primitiveIds }));
    const node = createEngineNode({
      id: `sedan.part.${id}`,
      name: id,
      parent,
      translation,
      rotation,
      mesh: meshId,
      extras: { stableId: id, profileId: profile.id },
    });
    nodes.push(node);
    const parentNode = nodes.find(candidate => candidate.id === parent);
    parentNode?.children.push(node.id);
    return node;
  }

  const y = value => value * heightScale;
  addPart('chassis', [0, y(0.39), 0], [{
    geometry: makeBoxMesh([profile.width * 0.9, y(0.18), profile.length * 0.84]),
    materialId: material.trim.id,
  }]);
  addPart('body_lower', [0, y(0.66), 0], [{
    geometry: makeTaperedBoxMesh([profile.width, y(0.58), profile.length], {
      topWidth: profile.width * 0.96,
      frontInset: 0.12 * lengthScale,
      rearInset: 0.1 * lengthScale,
    }),
    materialId: material.body.id,
  }]);
  addPart('hood', [0, y(0.985), 1.52 * lengthScale], [{ geometry: makeTaperedBoxMesh([1.72 * widthScale, y(0.13), 1.15 * lengthScale], { topWidth: 1.62 * widthScale, frontInset: 0.06 * lengthScale }), materialId: material.body.id }]);
  addPart('trunk_lid', [0, y(0.99), -1.79 * lengthScale], [{ geometry: makeTaperedBoxMesh([1.7 * widthScale, y(0.14), 0.68 * lengthScale], { topWidth: 1.62 * widthScale, rearInset: 0.05 * lengthScale }), materialId: material.body.id }]);
  addPart('roof', [0, y(1.27), -0.16 * lengthScale], [{ geometry: makeTaperedBoxMesh([1.38 * widthScale, y(0.06), 1.48 * lengthScale], { topWidth: 1.31 * widthScale, frontInset: 0.04 * lengthScale, rearInset: 0.04 * lengthScale }), materialId: material.body.id }]);

  addPart('front_bumper', [0, y(0.48), profile.length / 2 - 0.06], [{ geometry: makeBoxMesh([profile.width, y(0.24), 0.12]), materialId: material.trim.id }]);
  addPart('rear_bumper', [0, y(0.48), -profile.length / 2 + 0.06], [{ geometry: makeBoxMesh([profile.width, y(0.24), 0.12]), materialId: material.trim.id }]);
  addPart('grille', [0, y(0.69), profile.length / 2 - 0.01], [{ geometry: makeBoxMesh([0.82 * widthScale, y(0.22), 0.02]), materialId: material.trim.id }]);

  addPart('windshield', [0, y(1.08), 0.91 * lengthScale], [{ geometry: makeBoxMesh([1.38 * widthScale, y(0.42), 0.035]), materialId: material.glass.id }], { rotation: axisAngleQuaternion([1, 0, 0], -0.42) });
  addPart('rear_window', [0, y(1.08), -1.2 * lengthScale], [{ geometry: makeBoxMesh([1.36 * widthScale, y(0.4), 0.035]), materialId: material.glass.id }], { rotation: axisAngleQuaternion([1, 0, 0], 0.43) });
  const sides = Object.freeze([{ sign: 1, name: 'left' }, { sign: -1, name: 'right' }]);
  for (const side of sides) {
    const x = side.sign * (profile.width / 2 - 0.015);
    addPart(`side_window_front_${side.name}`, [x, y(1.105), 0.32 * lengthScale], [{ geometry: makeBoxMesh([0.03, y(0.36), 0.72 * lengthScale]), materialId: material.glass.id }]);
  }
  for (const side of sides) {
    const x = side.sign * (profile.width / 2 - 0.015);
    addPart(`side_window_rear_${side.name}`, [x, y(1.105), -0.53 * lengthScale], [{ geometry: makeBoxMesh([0.03, y(0.36), 0.72 * lengthScale]), materialId: material.glass.id }]);
  }
  for (const side of sides) {
    const x = side.sign * (profile.width / 2 - 0.0175);
    addPart(`door_front_${side.name}`, [x, y(0.73), 0.32 * lengthScale], [{ geometry: makeBoxMesh([0.035, y(0.54), 0.79 * lengthScale]), materialId: material.body.id }]);
  }
  for (const side of sides) {
    const x = side.sign * (profile.width / 2 - 0.0175);
    addPart(`door_rear_${side.name}`, [x, y(0.73), -0.55 * lengthScale], [{ geometry: makeBoxMesh([0.035, y(0.54), 0.79 * lengthScale]), materialId: material.body.id }]);
  }
  for (const side of sides) {
    addPart(`mirror_${side.name}`, [side.sign * (profile.width / 2 - 0.06), y(1.04), 0.78 * lengthScale], [{ geometry: makeBoxMesh([0.12 * widthScale, y(0.08), 0.18 * lengthScale]), materialId: material.trim.id }]);
  }
  for (const side of sides) {
    addPart(`headlight_${side.name}`, [side.sign * 0.62 * widthScale, y(0.79), profile.length / 2 - 0.015], [{ geometry: makeBoxMesh([0.34 * widthScale, y(0.15), 0.03]), materialId: material.headlight.id }]);
  }
  for (const side of sides) {
    addPart(`taillight_${side.name}`, [side.sign * 0.63 * widthScale, y(0.79), -profile.length / 2 + 0.015], [{ geometry: makeBoxMesh([0.31 * widthScale, y(0.16), 0.03]), materialId: material.taillight.id }]);
  }

  addPart('seat_driver', [0.39 * widthScale, y(0.75), 0.16 * lengthScale], [{ geometry: makeBoxMesh([0.44 * widthScale, y(0.61), 0.5 * lengthScale]), materialId: material.interior.id }]);
  addPart('seat_passenger', [-0.39 * widthScale, y(0.75), 0.16 * lengthScale], [{ geometry: makeBoxMesh([0.44 * widthScale, y(0.61), 0.5 * lengthScale]), materialId: material.interior.id }]);
  addPart('seat_rear', [0, y(0.72), -0.76 * lengthScale], [{ geometry: makeBoxMesh([1.28 * widthScale, y(0.55), 0.54 * lengthScale]), materialId: material.interior.id }]);
  addPart('steering_wheel', [0.42 * widthScale, y(0.99), 0.48 * lengthScale], [{ geometry: makeCylinderMesh(0.16 * widthScale, 0.04, 18), materialId: material.interior.id }], { rotation: axisAngleQuaternion([0, 1, 0], Math.PI / 2) });

  for (const longitudinal of [1, -1]) {
    for (const lateral of [1, -1]) {
      const role = `${longitudinal > 0 ? 'front' : 'rear'}_${lateral > 0 ? 'left' : 'right'}`;
      const tire = makeCylinderMesh(profile.wheelRadius, profile.wheelWidth, 24);
      const rim = makeCylinderMesh(profile.wheelRadius * 0.59, profile.wheelWidth + 0.01, 18);
      const rotor = makeCylinderMesh(profile.wheelRadius * 0.42, profile.wheelWidth + 0.018, 16);
      const marker = translateMesh(makeBoxMesh([0.025, 0.04, 0.055]), [0, profile.wheelRadius * 0.78, 0]);
      addPart(`wheel_${role}`, [
        lateral * profile.track / 2,
        profile.wheelRadius,
        longitudinal * profile.wheelBase / 2,
      ], [
        { geometry: tire, materialId: material.tire.id },
        { geometry: rim, materialId: material.rim.id },
        { geometry: rotor, materialId: material.rotor.id },
        { geometry: marker, materialId: material.headlight.id },
      ]);
    }
  }

  const actualIds = nodes.slice(1).map(node => node.extras.stableId);
  if (actualIds.length !== SEDAN_VISUAL_PART_IDS.length
      || SEDAN_VISUAL_PART_IDS.some((id, index) => actualIds[index] !== id)) {
    throw new Error('Sedan procedural inventory diverged from its stable part contract');
  }
  model.nodes = nodes;
  model.meshes = meshes;
  model.primitives = primitives;
  model.bounds = aggregateBounds(worldBounds);
  model.importTransform = {
    ...(model.importTransform ?? {}),
    forwardAxis: '+Z',
    upAxis: '+Y',
  };
  return model;
}

// Compatibility alias used by Car Drive while it migrates to the production name.
export const buildCarModel = buildSedanModel;
