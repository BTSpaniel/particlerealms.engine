// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Original offline packaging for the Particle Realms tetrahedral cage ABI.
// Public research informs the algorithm; no vendor code or file format is used.
import {
  buildTetrahedralCageAsset,
  serializeTetrahedralCageAssetForGPU,
  TETRAHEDRAL_CAGE_ASSET_VERSION,
} from './TetrahedralCageAccel.js';

const MAGIC = new Uint8Array([80, 82, 84, 67, 65, 71, 69, 49]); // PRTCAGE1
const ALIGNMENT = 16;
const TYPES = Object.freeze({ f32: Float32Array, u32: Uint32Array });
const BLOCKS = Object.freeze({
  restCageVertices: ['f32', 4], tetrahedra: ['u32', 4],
  tetrahedronMetadata: ['u32', 4], microRoots: ['u32', 1],
  microTriangleRanges: ['u32', 4], microNodes: ['f32', 8],
  microTriangleOrder: ['u32', 1], microTriangles: ['f32', 12],
  microTriangleTetrahedronBarycentrics: ['f32', 12],
  microTriangleSourceBarycentrics: ['f32', 12], microTriangleMetadata: ['u32', 4],
});
const align = value => Math.ceil(value / ALIGNMENT) * ALIGNMENT;

/** Create a conforming six-tetrahedra-per-cell cage around finite mesh bounds. */
export function createGridTetrahedralCage(vertices, divisions = [1, 4, 1]) {
  if ((!Array.isArray(vertices) && !ArrayBuffer.isView(vertices))
      || vertices.length < 9 || vertices.length % 3 !== 0) {
    throw new TypeError('Grid cage requires flat xyz mesh vertices');
  }
  if (!Array.isArray(divisions) || divisions.length !== 3
      || divisions.some(value => !Number.isSafeInteger(value) || value < 1)
      || divisions.reduce((a, b) => a * b, 1) > 166666) {
    throw new RangeError('Grid divisions must be three positive integers producing at most 999996 tetrahedra');
  }
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < vertices.length; index++) {
    const value = vertices[index];
    if (!Number.isFinite(value)) throw new RangeError('Grid mesh vertices must be finite');
    const axis = index % 3;
    minimum[axis] = Math.min(minimum[axis], value);
    maximum[axis] = Math.max(maximum[axis], value);
  }
  const padding = Math.max(1e-6, Math.max(...maximum.map((value, axis) => value - minimum[axis])) * 1e-4);
  for (let axis = 0; axis < 3; axis++) { minimum[axis] -= padding; maximum[axis] += padding; }
  const [nx, ny, nz] = divisions;
  const indexOf = (x, y, z) => (z * (ny + 1) + y) * (nx + 1) + x;
  const cageVertices = new Float64Array((nx + 1) * (ny + 1) * (nz + 1) * 3);
  for (let z = 0; z <= nz; z++) for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
    const offset = indexOf(x, y, z) * 3;
    for (let axis = 0; axis < 3; axis++) {
      cageVertices[offset + axis] = minimum[axis]
        + (maximum[axis] - minimum[axis]) * [x / nx, y / ny, z / nz][axis];
    }
  }
  const tetrahedra = new Uint32Array(nx * ny * nz * 24);
  let cursor = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const a = indexOf(x, y, z), b = indexOf(x + 1, y, z);
    const c = indexOf(x, y + 1, z), d = indexOf(x + 1, y + 1, z);
    const e = indexOf(x, y, z + 1), f = indexOf(x + 1, y, z + 1);
    const g = indexOf(x, y + 1, z + 1), h = indexOf(x + 1, y + 1, z + 1);
    tetrahedra.set([a, b, d, h, a, d, c, h, a, c, g, h,
      a, g, e, h, a, e, f, h, a, f, b, h], cursor);
    cursor += 24;
  }
  return Object.freeze({ cageVertices, tetrahedra, divisions: Object.freeze([...divisions]) });
}

/** Compile an authored mesh/cage, or a regular cage at an explicit LOD. */
export function compileTetrahedralCage(input, { divisions = [1, 4, 1], ...options } = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('Cage compiler requires a mesh record');
  if (Boolean(input.cageVertices) !== Boolean(input.tetrahedra)) {
    throw new TypeError('An authored cage requires both cageVertices and tetrahedra');
  }
  const cage = input.cageVertices ? input : createGridTetrahedralCage(input.vertices, divisions);
  const asset = buildTetrahedralCageAsset({ ...input, cageVertices: cage.cageVertices, tetrahedra: cage.tetrahedra }, options);
  return Object.freeze({ asset, packageData: serializeTetrahedralCageAssetForGPU(asset) });
}

/** Encode the original versioned .tcage container without JSON float conversion. */
export function encodeTetrahedralCagePackage(packageData, { metrics = null, source = null } = {}) {
  const blocks = [];
  let payloadBytes = 0;
  for (const [name, [type, stride]] of Object.entries(BLOCKS)) {
    const values = packageData?.[name];
    if (!(values instanceof TYPES[type]) || !values.length || values.length % stride) {
      throw new TypeError(`Cage package ${name} must be nonempty ${type} records of ${stride} words`);
    }
    blocks.push({ name, type, length: values.length, byteOffset: payloadBytes, byteLength: values.byteLength });
    payloadBytes += align(values.byteLength);
  }
  const header = new TextEncoder().encode(JSON.stringify({
    schema: 'particle-realms-tetrahedral-cage-package/v1',
    assetVersion: TETRAHEDRAL_CAGE_ASSET_VERSION,
    layout: packageData.layout, provenance: packageData.provenance, metrics, source,
    payloadBytes, blocks,
  }));
  const payloadOffset = align(16 + header.length);
  if (payloadOffset + payloadBytes > 0xffffffff) throw new RangeError('Cage package exceeds the v1 4 GiB container limit');
  const result = new Uint8Array(payloadOffset + payloadBytes);
  result.set(MAGIC);
  const view = new DataView(result.buffer);
  view.setUint32(8, header.length, true);
  view.setUint32(12, payloadOffset, true);
  result.set(header, 16);
  for (const block of blocks) {
    const values = packageData[block.name];
    result.set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength), payloadOffset + block.byteOffset);
  }
  return result;
}

/** Decode bounded blocks; the runtime additionally validates geometric topology. */
export function decodeTetrahedralCagePackage(data) {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data)
    : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
  if (!bytes || bytes.length < 16 || MAGIC.some((value, index) => bytes[index] !== value)) {
    throw new TypeError('Invalid Particle Realms tetrahedral cage container');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(8, true), payloadOffset = view.getUint32(12, true);
  if (payloadOffset !== align(16 + headerLength) || payloadOffset > bytes.length) {
    throw new RangeError('Cage package header length or payload alignment is invalid');
  }
  const header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(16, 16 + headerLength)));
  if (header.schema !== 'particle-realms-tetrahedral-cage-package/v1'
      || header.assetVersion !== TETRAHEDRAL_CAGE_ASSET_VERSION
      || !Array.isArray(header.blocks) || header.blocks.length !== Object.keys(BLOCKS).length
      || !Number.isSafeInteger(header.payloadBytes) || header.payloadBytes !== bytes.length - payloadOffset) {
    throw new RangeError('Unsupported or truncated cage package manifest');
  }
  const packageData = Object.create(null);
  let cursor = 0;
  for (const block of header.blocks) {
    const expected = BLOCKS[block.name];
    if (!Object.hasOwn(BLOCKS, block.name) || Object.hasOwn(packageData, block.name)
        || block.type !== expected[0] || !Number.isSafeInteger(block.length) || block.length < 1
        || block.length % expected[1] || block.byteLength !== block.length * 4
        || block.byteOffset !== cursor || cursor + block.byteLength > header.payloadBytes) {
      throw new RangeError(`Invalid cage package block ${String(block.name)}`);
    }
    const copy = bytes.slice(payloadOffset + cursor, payloadOffset + cursor + block.byteLength);
    packageData[block.name] = new TYPES[block.type](copy.buffer);
    cursor += align(block.byteLength);
  }
  if (cursor !== header.payloadBytes) throw new RangeError('Cage package contains unclaimed payload bytes');
  packageData.byteLength = header.blocks.reduce((sum, block) => sum + block.byteLength, 0);
  packageData.layout = header.layout;
  packageData.provenance = header.provenance;
  return Object.freeze({ packageData: Object.freeze(packageData), manifest: Object.freeze(header) });
}
