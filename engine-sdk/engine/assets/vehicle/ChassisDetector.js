// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/vehicle/ChassisDetector.js — identify the chassis + body parts
// (spec §11). The chassis is the largest non-wheel mesh; remaining meshes are
// categorized by name (glass/lights/doors) so segmentation and material edits
// (tint glass, emissive headlights, detach doors) can target them.

import { computeWorldMatrices, transformPoint } from './VehicleMath.js';

function meshLocalBounds(model, meshId) {
  const mesh = model.meshes.find((m) => m.id === meshId);
  if (!mesh) return null;
  let min = [Infinity, Infinity, Infinity]; let max = [-Infinity, -Infinity, -Infinity]; let any = false;
  for (const pid of mesh.primitives) {
    const prim = model.primitives.find((p) => p.id === pid);
    if (!prim?.bounds) continue;
    any = true;
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], prim.bounds.min[i]); max[i] = Math.max(max[i], prim.bounds.max[i]); }
  }
  return any ? { min, max } : null;
}

function worldVolume(matrix, local) {
  let min = [Infinity, Infinity, Infinity]; let max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const corner = [(i & 1) ? local.max[0] : local.min[0], (i & 2) ? local.max[1] : local.min[1], (i & 4) ? local.max[2] : local.min[2]];
    const w = transformPoint(matrix, corner);
    for (let c = 0; c < 3; c++) { if (w[c] < min[c]) min[c] = w[c]; if (w[c] > max[c]) max[c] = w[c]; }
  }
  return (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]);
}

/**
 * Identify chassis + body part nodes, excluding the given wheel node ids.
 * @returns {{ chassisNode:string|null, bodyNodes:string[], glassNodes:string[], lightNodes:string[], doorNodes:string[] }}
 */
export function detectChassis(model, wheelNodeIds = []) {
  const world = computeWorldMatrices(model);
  const wheels = new Set(wheelNodeIds);
  const bodyNodes = []; const glassNodes = []; const lightNodes = []; const doorNodes = [];
  let chassisNode = null; let bestVol = -1;

  for (const node of model.nodes || []) {
    if (!node.mesh || wheels.has(node.id)) continue;
    const name = (node.name || '').toLowerCase();
    if (/glass|window|windshield|windscreen/.test(name)) glassNodes.push(node.id);
    else if (/light|lamp|headlight|taillight/.test(name)) lightNodes.push(node.id);
    else if (/door/.test(name)) doorNodes.push(node.id);
    else bodyNodes.push(node.id);

    const local = meshLocalBounds(model, node.mesh);
    if (local) {
      const vol = worldVolume(world.get(node.id), local);
      if (vol > bestVol) { bestVol = vol; chassisNode = node.id; }
    }
  }
  return { chassisNode, bodyNodes, glassNodes, lightNodes, doorNodes };
}
