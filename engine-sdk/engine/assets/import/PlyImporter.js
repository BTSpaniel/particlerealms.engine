// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/import/PlyImporter.js — Stanford PLY (ASCII + binary LE) → EngineModel.
//
// PLY is a point/mesh utility format. We read the vertex element (position +
// optional normal/color) and the face element (triangulated), producing one
// indexed primitive. Big-endian binary is uncommon for web assets and is not
// supported here (the editor can flag it).

import { createEngineModel, createEngineMesh, createEnginePrimitive } from '../EngineModel.js';
import { aabbCenter } from '../../core/math/MathGeometry.js';

const PLY_TYPE_BYTES = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };

function asBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  throw new TypeError('PlyImporter: expected bytes or string');
}

function parseHeader(bytes) {
  // Find 'end_header\n'
  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const endIdx = text.indexOf('end_header');
  if (endIdx < 0) throw new Error('PlyImporter: no end_header');
  const headerEnd = text.indexOf('\n', endIdx) + 1;
  const headerLines = text.slice(0, headerEnd).split(/\r?\n/);
  let format = 'ascii';
  const elements = [];
  let cur = null;
  for (const line of headerLines) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'format') format = p[1];
    else if (p[0] === 'element') { cur = { name: p[1], count: parseInt(p[2], 10), props: [] }; elements.push(cur); }
    else if (p[0] === 'property' && cur) {
      if (p[1] === 'list') cur.props.push({ list: true, countType: p[2], itemType: p[3], name: p[4] });
      else cur.props.push({ list: false, type: p[1], name: p[2] });
    }
  }
  return { format, elements, headerEnd };
}

function readBinaryValue(dv, offset, type, le) {
  switch (type) {
    case 'char': case 'int8': return [dv.getInt8(offset), 1];
    case 'uchar': case 'uint8': return [dv.getUint8(offset), 1];
    case 'short': case 'int16': return [dv.getInt16(offset, le), 2];
    case 'ushort': case 'uint16': return [dv.getUint16(offset, le), 2];
    case 'int': case 'int32': return [dv.getInt32(offset, le), 4];
    case 'uint': case 'uint32': return [dv.getUint32(offset, le), 4];
    case 'float': case 'float32': return [dv.getFloat32(offset, le), 4];
    case 'double': case 'float64': return [dv.getFloat64(offset, le), 8];
    default: return [dv.getFloat32(offset, le), 4];
  }
}

export function importPly(data, opts = {}) {
  const bytes = asBytes(data);
  const { format, elements, headerEnd } = parseHeader(bytes);
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];

  const vertexEl = elements.find((e) => e.name === 'vertex');
  const faceEl = elements.find((e) => e.name === 'face');

  if (format === 'ascii') {
    const text = new TextDecoder().decode(bytes);
    const body = text.slice(text.indexOf('end_header'));
    const lines = body.split(/\r?\n/).slice(1).filter((l) => l.trim().length);
    let li = 0;
    for (let i = 0; i < (vertexEl?.count ?? 0); i++) {
      const nums = lines[li++].trim().split(/\s+/).map(Number);
      readVertexFromValues(vertexEl.props, nums, positions, normals, colors);
    }
    for (let i = 0; i < (faceEl?.count ?? 0); i++) {
      const nums = lines[li++].trim().split(/\s+/).map(Number);
      triangulateFace(nums.slice(1, nums[0] + 1), indices);
    }
  } else {
    const le = format === 'binary_little_endian';
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = headerEnd;
    for (let i = 0; i < (vertexEl?.count ?? 0); i++) {
      const values = [];
      for (const prop of vertexEl.props) { const [val, sz] = readBinaryValue(dv, offset, prop.type, le); values.push(val); offset += sz; }
      readVertexFromValues(vertexEl.props, values, positions, normals, colors);
    }
    for (let i = 0; i < (faceEl?.count ?? 0); i++) {
      const lp = faceEl.props[0];
      const [count, csz] = readBinaryValue(dv, offset, lp.countType, le); offset += csz;
      const face = [];
      for (let k = 0; k < count; k++) { const [idx, isz] = readBinaryValue(dv, offset, lp.itemType, le); face.push(idx); offset += isz; }
      triangulateFace(face, indices);
    }
  }

  const model = createEngineModel({ name: opts.name ?? 'ply', sourceFormat: 'ply' });
  const pos = new Float32Array(positions);
  const attributes = { position: pos };
  if (normals.length === positions.length) attributes.normal = new Float32Array(normals);
  if (colors.length) attributes.color = new Float32Array(colors);
  const idx = indices.length ? (positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)) : null;
  const bounds = computeBounds(pos);
  model.primitives.push(createEnginePrimitive({ id: 'primitive:0:0', mesh: 'mesh:0', material: null, attributes, indices: idx, vertexCount: positions.length / 3, bounds }));
  model.meshes.push(createEngineMesh({ id: 'mesh:0', name: opts.name ?? 'ply', primitives: ['primitive:0:0'], bounds }));
  model.nodes.push({ id: 'node:0', name: opts.name ?? 'ply', parent: null, children: [], translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], mesh: 'mesh:0', skin: null, extras: {} });
  model.bounds = bounds;
  model.metadata.stats = { vertices: positions.length / 3, triangles: indices.length / 3 };
  return model;
}

function readVertexFromValues(props, values, positions, normals, colors) {
  let nx = null, ny = null, nz = null, r = null, g = null, b = null;
  let x = 0, y = 0, z = 0;
  props.forEach((prop, i) => {
    const v = values[i];
    switch (prop.name) {
      case 'x': x = v; break; case 'y': y = v; break; case 'z': z = v; break;
      case 'nx': nx = v; break; case 'ny': ny = v; break; case 'nz': nz = v; break;
      case 'red': r = v; break; case 'green': g = v; break; case 'blue': b = v; break;
    }
  });
  positions.push(x, y, z);
  if (nx !== null) normals.push(nx, ny ?? 0, nz ?? 0);
  if (r !== null) colors.push((r > 1 ? r / 255 : r), (g > 1 ? g / 255 : g) ?? 0, (b > 1 ? b / 255 : b) ?? 0);
}

function triangulateFace(face, indices) {
  for (let i = 1; i < face.length - 1; i++) indices.push(face[0], face[i], face[i + 1]);
}

function computeBounds(positions) {
  if (!positions.length) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let c = 0; c < 3; c++) { const v = positions[i + c]; if (v < min[c]) min[c] = v; if (v > max[c]) max[c] = v; }
  const center = aabbCenter({ min, max });
  return { min, max, center, radius: Math.hypot(...max.map((m, i) => m - center[i])) };
}
