// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SceneRenderer.js - Scene rendering utilities
 * 
 * Helpers for rendering ECS entities and scene elements.
 */

import { drawMesh } from "./DrawHelpers.js";
import { mat4Identity, mat4Translate, mat4Scale, mat4FromRotationTranslation } from "../core/math/EngineMath.js";

function resolveEntityMesh(meshes, entry) {
  const meshTypes = {
    sphere: meshes.sphere,
    plane: meshes.plane,
    cylinder: meshes.cylinder,
    pillar: meshes.cylinder,
    cube: meshes.cube,
    ball: meshes.sphere,
  };
  return meshTypes[entry.type] || entry.mesh || meshes.cube;
}

function buildEntityModelMatrixFromTransform(t) {
  const p = t.position;
  const r = t.rotation;
  const s = t.scale;

  let model = r?.length >= 4
    ? mat4FromRotationTranslation(r, p)
    : mat4Translate(mat4Identity(), p[0], p[1], p[2]);

  if (s?.length >= 3) {
    const sx = Number.isFinite(s[0]) ? s[0] : 1;
    const sy = Number.isFinite(s[1]) ? s[1] : 1;
    const sz = Number.isFinite(s[2]) ? s[2] : 1;
    if (sx !== 1 || sy !== 1 || sz !== 1) {
      model = mat4Scale(model, sx, sy, sz);
    }
  }

  return model;
}

export function encodeEntitiesClusterCulling(options) {
  const {
    commandEncoder,
    viewProj,
    entities,
    meshes,
    getTransform,
  } = options;

  if (!commandEncoder || !viewProj || !entities || !meshes || typeof getTransform !== "function") {
    return;
  }

  const shared = new Set([meshes.cube, meshes.sphere, meshes.cylinder, meshes.plane]);
  const meshCounts = new Map();

  for (const entry of entities) {
    const mesh = resolveEntityMesh(meshes, entry);
    if (!mesh || shared.has(mesh)) continue;
    meshCounts.set(mesh, (meshCounts.get(mesh) || 0) + 1);
  }

  for (const entry of entities) {
    const t = getTransform(entry.entityId);
    if (!t || !t.position || t.position.length < 3) continue;

    const mesh = resolveEntityMesh(meshes, entry);
    if (!mesh || shared.has(mesh)) {
      continue;
    }

    if (meshCounts.get(mesh) !== 1) {
      continue;
    }

    const culler = mesh.indexedClusterCuller;
    if (!culler || typeof culler.encodeCulling !== "function" || !culler.hasGeometry || !culler.hasGeometry()) {
      continue;
    }

    const model = buildEntityModelMatrixFromTransform(t);
    culler.encodeCulling(commandEncoder, viewProj, model);
  }
}

/**
 * Render all spawned ECS entities.
 * @param {Object} options - Render options
 * @param {Object} options.renderPass - WebGPU render pass
 * @param {Array} options.entities - Spawned entities array
 * @param {Object} options.meshes - Mesh lookup { cube, sphere, cylinder, plane }
 * @param {Map} options.uniformBuffers - Entity uniform buffers
 * @param {Map} options.bindGroups - Entity bind groups
 * @param {Function} options.getTransform - Function to get entity transform
 * @param {Function} options.updateUniforms - Function to update uniforms
 * @param {number} options.lightCount - Current light count
 * @param {number|null} options.selectedEntityId - Selected entity for outline
 */
export function renderEntities(options) {
  const {
    renderPass,
    entities,
    meshes,
    uniformBuffers,
    bindGroups,
    getTransform,
    updateUniforms,
    lightCount,
    selectedEntityId,
  } = options;

  for (const entry of entities) {
    const t = getTransform(entry.entityId);
    if (!t || !t.position || t.position.length < 3) continue;

    const model = buildEntityModelMatrixFromTransform(t);

    const entityBuffer = uniformBuffers.get(entry.entityId);
    const entityBindGrp = bindGroups.get(entry.entityId);
    const mesh = resolveEntityMesh(meshes, entry);

    if (entityBuffer && entityBindGrp && mesh) {
      updateUniforms(entityBuffer, model, entry.color, lightCount);
      drawMesh(renderPass, mesh, entityBindGrp);

      // Selection outline
      if (selectedEntityId === entry.entityId) {
        const outlineModel = mat4Scale(model, 1.05, 1.05, 1.05);
        updateUniforms(entityBuffer, outlineModel, [3.0, 3.0, 0.8], lightCount, 0.75);

        const culler = mesh.indexedClusterCuller;
        if (culler && mesh.indexBuffer && mesh.indexCount > 0) {
          renderPass.setVertexBuffer(0, mesh.vertexBuffer);
          renderPass.setBindGroup(0, entityBindGrp);
          renderPass.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat || "uint16");
          renderPass.drawIndexed(mesh.indexCount, 1, 0, 0, 0);
        } else {
          drawMesh(renderPass, mesh, entityBindGrp);
        }
      }
    }
  }
}

/**
 * Render room geometry (floor, walls, ceiling).
 * @param {Object} options - Render options
 * @param {Object} options.renderPass - WebGPU render pass
 * @param {Object} options.room - Room meshes and bind groups
 * @param {Function} options.updateUniforms - Function to update uniforms
 * @param {number} options.lightCount - Current light count
 */
export function renderRoom(options) {
  const { renderPass, room, updateUniforms, lightCount } = options;
  const identity = mat4Identity();

  if (room.floorMesh && room.floorBindGroup) {
    updateUniforms(room.floorBuffer, identity, room.floorColor || [0.2, 1.0, 0.3], lightCount);
    drawMesh(renderPass, room.floorMesh, room.floorBindGroup);
  }
  
  if (room.wallsMesh && room.wallsBindGroup) {
    updateUniforms(room.wallsBuffer, identity, room.wallsColor || [0.3, 0.7, 1.0], lightCount);
    drawMesh(renderPass, room.wallsMesh, room.wallsBindGroup);
  }
  
  if (room.ceilingMesh && room.ceilingBindGroup) {
    updateUniforms(room.ceilingBuffer, identity, room.ceilingColor || [1.0, 1.0, 0.3], lightCount);
    drawMesh(renderPass, room.ceilingMesh, room.ceilingBindGroup);
  }
}

/**
 * Render a light cube at a position.
 * @param {Object} options - Render options
 */
export function renderLightCube(options) {
  const { renderPass, mesh, bindGroup, buffer, position, updateUniforms, lightCount } = options;
  
  const model = mat4Translate(mat4Identity(), position[0], position[1], position[2]);
  updateUniforms(buffer, model, [3.0, 3.0, 3.0], lightCount);
  drawMesh(renderPass, mesh, bindGroup);
}
