// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/import/StlImporter.js — STL (binary + ASCII) → EngineModel.
//
// STL is CAD/printable part geometry: triangles only, no materials, no
// hierarchy, no declared units. We import geometry faithfully and leave the unit
// guess to the OrientationResolver / editor. Output is a single non-indexed
// primitive with per-vertex positions and face normals.

import { createEngineModel, createEngineMesh, createEnginePrimitive } from '../EngineModel.js';
import { aabbCenter } from '../../core/math/MathGeometry.js';

function asBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  throw new TypeError('StlImporter: expected bytes or string');
}

/** Heuristic: a valid binary STL length == 84 + 50 * triangleCount. */
function looksBinary(bytes) {
  if (bytes.length < 84) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tris = dv.getUint32(80, true);
  return bytes.length === 84 + tris * 50;
}

function importBinary(bytes, name) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tris = dv.getUint32(80, true);
  const positions = new Float32Array(tris * 9);
  const normals = new Float32Array(tris * 9);
  let o = 80 + 4;
  for (let t = 0; t < tris; t++) {
    const nx = dv.getFloat32(o, true), ny = dv.getFloat32(o + 4, true), nz = dv.getFloat32(o + 8, true);
    o += 12;
    for (let v = 0; v < 3; v++) {
      const base = t * 9 + v * 3;
      positions[base] = dv.getFloat32(o, true);
      positions[base + 1] = dv.getFloat32(o + 4, true);
      positions[base + 2] = dv.getFloat32(o + 8, true);
      normals[base] = nx; normals[base + 1] = ny; normals[base + 2] = nz;
      o += 12;
    }
    o += 2; // attribute byte count
  }
  return buildModel(positions, normals, name, 'stl');
}

function importAscii(text, name) {
  const positions = [];
  const normals = [];
  let curNormal = [0, 0, 0];
  const numRe = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (s.startsWith('facet normal')) {
      const n = s.match(numRe)?.map(Number) ?? [0, 0, 0];
      curNormal = [n[0] || 0, n[1] || 0, n[2] || 0];
    } else if (s.startsWith('vertex')) {
      const v = s.match(numRe)?.map(Number) ?? [0, 0, 0];
      positions.push(v[0] || 0, v[1] || 0, v[2] || 0);
      normals.push(curNormal[0], curNormal[1], curNormal[2]);
    }
  }
  return buildModel(new Float32Array(positions), new Float32Array(normals), name, 'stl');
}

function buildModel(positions, normals, name, format) {
  const model = createEngineModel({ name: name ?? 'stl', sourceFormat: format });
  const vertexCount = positions.length / 3;
  const bounds = computeBounds(positions);
  const prim = createEnginePrimitive({
    id: 'primitive:0:0', mesh: 'mesh:0', material: null,
    attributes: { position: positions, normal: normals }, indices: null, vertexCount, bounds,
  });
  model.primitives.push(prim);
  model.meshes.push(createEngineMesh({ id: 'mesh:0', name: name ?? 'stl', primitives: ['primitive:0:0'], bounds }));
  model.nodes.push({ id: 'node:0', name: name ?? 'stl', parent: null, children: [], translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], mesh: 'mesh:0', skin: null, extras: {} });
  model.bounds = bounds;
  model.metadata.stats = { triangles: vertexCount / 3, vertexCount };
  return model;
}

function computeBounds(positions) {
  if (positions.length === 0) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let c = 0; c < 3; c++) { const v = positions[i + c]; if (v < min[c]) min[c] = v; if (v > max[c]) max[c] = v; }
  }
  const center = aabbCenter({ min, max });
  return { min, max, center, radius: Math.hypot(...max.map((m, i) => m - center[i])) };
}

/** Import STL bytes or text into an EngineModel. */
export function importStl(data, opts = {}) {
  const bytes = asBytes(data);
  if (looksBinary(bytes)) return importBinary(bytes, opts.name);
  return importAscii(new TextDecoder().decode(bytes), opts.name);
}
