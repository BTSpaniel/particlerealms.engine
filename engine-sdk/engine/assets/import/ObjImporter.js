// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/import/ObjImporter.js — Wavefront OBJ (+ optional MTL) → EngineModel.
//
// OBJ is static geometry + simple material references. We preserve groups/objects
// and per-face material assignment by splitting into one primitive per material
// group. Polygons are triangulated (fan). MTL parsing is light (names + a few
// PBR-ish factors) and the full material decode happens in Phase 2.

import { createEngineModel, createEngineMesh, createEnginePrimitive } from '../EngineModel.js';
import { aabbCenter } from '../../core/math/MathGeometry.js';

function asText(data) {
  if (typeof data === 'string') return data;
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  throw new TypeError('ObjImporter: expected text or bytes');
}

/** Parse a minimal MTL into a map of name → material descriptor. */
export function parseMtl(text) {
  const out = new Map();
  let cur = null;
  for (const raw of asText(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [key, ...rest] = line.split(/\s+/);
    const val = rest.join(' ');
    if (key === 'newmtl') { cur = { name: val, baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1, textures: {}, raw: {} }; out.set(val, cur); }
    else if (!cur) continue;
    else if (key === 'Kd') { const n = val.split(/\s+/).map(Number); cur.baseColorFactor = [n[0] || 0, n[1] || 0, n[2] || 0, 1]; }
    else if (key === 'd') cur.baseColorFactor[3] = Number(val);
    else if (key === 'Ns') cur.roughnessFactor = Math.max(0, Math.min(1, 1 - (Number(val) || 0) / 1000));
    else if (key === 'map_Kd') cur.textures.baseColor = val;
    else if (key === 'map_Bump' || key === 'bump' || key === 'norm') cur.textures.normal = val;
    if (cur) cur.raw[key] = val;
  }
  return out;
}

/**
 * Import OBJ text/bytes into an EngineModel.
 * @param {string|Uint8Array} data OBJ source
 * @param {object} [opts] { name, mtl: Map|string (mtl source) }
 */
export function importObj(data, opts = {}) {
  const text = asText(data);
  const mtl = opts.mtl instanceof Map ? opts.mtl : (opts.mtl ? parseMtl(opts.mtl) : new Map());

  const positions = []; // flat xyz
  const normals = [];
  const uvs = [];
  const groups = new Map(); // materialName → { indices:[ {v,vt,vn} ] }
  let curMaterial = '__default__';
  const ensureGroup = (m) => { if (!groups.has(m)) groups.set(m, []); return groups.get(m); };

  const fix = (idx, len) => (idx < 0 ? len / 3 + idx : idx - 1); // OBJ is 1-based; negative = relative

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0];
    if (key === 'v') positions.push(+parts[1] || 0, +parts[2] || 0, +parts[3] || 0);
    else if (key === 'vn') normals.push(+parts[1] || 0, +parts[2] || 0, +parts[3] || 0);
    else if (key === 'vt') uvs.push(+parts[1] || 0, +parts[2] || 0);
    else if (key === 'usemtl') curMaterial = parts[1] || '__default__';
    else if (key === 'f') {
      const verts = parts.slice(1).map((tok) => {
        const [v, vt, vn] = tok.split('/');
        return {
          v: fix(parseInt(v, 10), positions.length),
          vt: vt ? fix(parseInt(vt, 10), uvs.length * 1.5) : -1,
          vn: vn ? fix(parseInt(vn, 10), normals.length) : -1,
        };
      });
      const group = ensureGroup(curMaterial);
      for (let i = 1; i < verts.length - 1; i++) { group.push(verts[0], verts[i], verts[i + 1]); } // fan triangulate
    }
  }

  const model = createEngineModel({ name: opts.name ?? 'obj', sourceFormat: 'obj' });

  // materials referenced by the OBJ
  const matNames = [...groups.keys()].filter((m) => m !== '__default__');
  matNames.forEach((m, i) => {
    const md = mtl.get(m);
    model.materials.push({ id: `material:${i}`, name: m, rawIndex: i, workflow: 'metallicRoughness', raw: md ?? null, baseColorFactor: md?.baseColorFactor, textures: md?.textures ?? {} });
  });
  const matId = (m) => { const i = matNames.indexOf(m); return i >= 0 ? `material:${i}` : null; };

  const primIds = [];
  let pi = 0;
  for (const [mname, tris] of groups) {
    if (tris.length === 0) continue;
    const pos = new Float32Array(tris.length * 3);
    const nrm = normals.length ? new Float32Array(tris.length * 3) : null;
    const uv = uvs.length ? new Float32Array(tris.length * 2) : null;
    tris.forEach((vert, k) => {
      pos[k * 3] = positions[vert.v * 3] || 0;
      pos[k * 3 + 1] = positions[vert.v * 3 + 1] || 0;
      pos[k * 3 + 2] = positions[vert.v * 3 + 2] || 0;
      if (nrm && vert.vn >= 0) { nrm[k * 3] = normals[vert.vn * 3] || 0; nrm[k * 3 + 1] = normals[vert.vn * 3 + 1] || 0; nrm[k * 3 + 2] = normals[vert.vn * 3 + 2] || 0; }
      if (uv && vert.vt >= 0) { uv[k * 2] = uvs[vert.vt * 2] || 0; uv[k * 2 + 1] = uvs[vert.vt * 2 + 1] || 0; }
    });
    const attributes = { position: pos };
    if (nrm) attributes.normal = nrm;
    if (uv) attributes.uv0 = uv;
    const id = `primitive:0:${pi++}`;
    const bounds = computeBounds(pos);
    model.primitives.push(createEnginePrimitive({ id, mesh: 'mesh:0', material: matId(mname), attributes, indices: null, vertexCount: tris.length, bounds }));
    primIds.push(id);
  }

  const bounds = unionBounds(model.primitives);
  model.meshes.push(createEngineMesh({ id: 'mesh:0', name: opts.name ?? 'obj', primitives: primIds, bounds }));
  model.nodes.push({ id: 'node:0', name: opts.name ?? 'obj', parent: null, children: [], translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], mesh: 'mesh:0', skin: null, extras: {} });
  model.bounds = bounds;
  model.metadata.stats = { primitives: primIds.length, materials: model.materials.length, vertices: positions.length / 3 };
  return model;
}

function computeBounds(positions) {
  if (!positions || positions.length === 0) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let c = 0; c < 3; c++) { const v = positions[i + c]; if (v < min[c]) min[c] = v; if (v > max[c]) max[c] = v; }
  const center = aabbCenter({ min, max });
  return { min, max, center, radius: Math.hypot(...max.map((m, i) => m - center[i])) };
}

function unionBounds(primitives) {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const p of primitives) { if (!p.bounds) continue; any = true; for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p.bounds.min[i]); max[i] = Math.max(max[i], p.bounds.max[i]); } }
  if (!any) return null;
  const center = aabbCenter({ min, max });
  return { min, max, center, radius: Math.hypot(...max.map((m, i) => m - center[i])) };
}
