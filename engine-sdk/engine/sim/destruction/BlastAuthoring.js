// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { validateBlastGeometry } from './BlastGeometry.js';

const finite = value => Number.isFinite(value) && Number.isFinite(Math.fround(value));
function array(value, stride, name, optional = false) {
    if (optional && value == null) return null;
    if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || !value.length || value.length % stride
        || !Array.from(value).every(finite)) throw new RangeError(`Invalid Blast authoring ${name}`);
    return Array.from(value);
}

/** Synchronous native CPU/WASM Voronoi authoring of closed convex meshes.
 * Explicit sites make input deterministic. The returned plain data owns no WASM
 * memory; it can be retained, edited independently, or saved with an Engine scene.
 */
export class BlastAuthoring {
    constructor(module) {
        if (module?._pr_blast_authoring_abi?.() !== 1) throw new Error('PhysX PE Blast authoring ABI 1 is required');
        this.module = module;
    }

    fracture({ positions, normals = null, uvs = null, indices, sites, interiorMaterialId = 1000 } = {}) {
        const p = array(positions, 3, 'positions'), n = array(normals, 3, 'normals', true),
            uv = array(uvs, 2, 'UVs', true), ix = array(indices, 3, 'indices'), s = array(sites, 3, 'sites');
        const vertexCount = p.length / 3;
        if (vertexCount < 4 || (n && n.length !== p.length) || (uv && uv.length !== vertexCount * 2)
            || ix.some(index => !Number.isInteger(index) || index < 0 || index >= vertexCount)
            || s.length < 6 || s.length / 3 > 4096 || !Number.isInteger(interiorMaterialId)
            || interiorMaterialId < -2147483648 || interiorMaterialId > 2147483647)
            throw new RangeError('Invalid Blast authoring mesh, sites or interior material');
        const module = this.module, pointers = [];
        const allocate = bytes => {
            if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 0xffffffff) throw new RangeError('Blast authoring buffer exceeds WASM address space');
            const pointer = module._malloc(bytes);
            if (!pointer) throw new Error('Blast authoring allocation failed');
            pointers.push(pointer); return pointer;
        };
        const floats = values => {
            if (!values) return 0;
            const pointer = allocate(values.length * 4); module.HEAPF32.set(values, pointer / 4); return pointer;
        };
        let handle = 0;
        try {
            const pp = floats(p), np = floats(n), up = floats(uv), sp = floats(s), ip = allocate(ix.length * 4);
            module.HEAPU32.set(ix, ip / 4);
            handle = module._pr_blast_authoring_create(vertexCount, pp, np, up, ix.length, ip,
                s.length / 3, sp, interiorMaterialId);
            if (!handle) {
                const code = module._pr_blast_authoring_last_error();
                const reason = ({ 1: 'invalid buffers, attributes or convex hull capacity',
                    2: 'source must be a closed outward convex mesh with at most 255 geometric vertices',
                    3: 'Voronoi sites must be distinct and inside the source mesh',
                    4: 'upstream fracture failed', 51: 'invalid output volume or centroid',
                    52: 'missing output triangles', 53: 'degenerate output triangle', 54: 'invalid output attributes',
                    55: 'fracture chunk exceeds the PhysX 255-vertex hull capacity',
                    56: 'not every site produced a nonempty chunk', 57: 'fracture did not conserve volume',
                    6: 'inconsistent shared interface geometry' })[code] ?? 'invalid native output';
                throw new Error(`Native Blast rejected fracture: ${reason} (code ${code})`);
            }
            const header = allocate(16);
            if (module._pr_blast_authoring_counts(handle, header, 4) !== 0) throw new Error('Native Blast authoring count query failed');
            const [chunkCount, bondCount] = Array.from(module.HEAPU32.subarray(header / 4, header / 4 + 4));
            if (chunkCount < 2 || chunkCount > 4096 || bondCount < chunkCount - 1 || bondCount > 65536)
                throw new Error('Invalid native Blast authoring counts');
            const info = allocate(24), chunks = [];
            for (let chunk = 0; chunk < chunkCount; chunk++) {
                if (module._pr_blast_authoring_chunk(handle, chunk, info, info + 16) !== 0) throw new Error('Native Blast chunk query failed');
                const [x, y, z, volume] = Array.from(module.HEAPF32.subarray(info / 4, info / 4 + 4));
                const [vertices, triangles] = Array.from(module.HEAPU32.subarray(info / 4 + 4, info / 4 + 6));
                if (!vertices || vertices !== triangles * 3) throw new Error('Invalid native Blast mesh counts');
                const vertexPointer = allocate(vertices * 32), indexPointer = allocate(vertices * 4), materialPointer = allocate(triangles * 4);
                if (module._pr_blast_authoring_mesh(handle, chunk, vertexPointer, indexPointer, materialPointer, vertices, triangles) !== 0)
                    throw new Error('Native Blast mesh copy failed');
                const interleaved = module.HEAPF32.subarray(vertexPointer / 4, vertexPointer / 4 + vertices * 8);
                const geometry = { positions: [], normals: [], uvs: [],
                    indices: Array.from(module.HEAPU32.subarray(indexPointer / 4, indexPointer / 4 + vertices)),
                    materialIds: Array.from(new Int32Array(module.HEAPU32.buffer, materialPointer, triangles)) };
                for (let vertex = 0; vertex < vertices; vertex++) {
                    const offset = vertex * 8;
                    geometry.positions.push(...interleaved.subarray(offset, offset + 3));
                    geometry.normals.push(...interleaved.subarray(offset + 3, offset + 6));
                    geometry.uvs.push(...interleaved.subarray(offset + 6, offset + 8));
                }
                chunks.push(validateBlastGeometry({ position: [x, y, z], volume, geometry }));
                for (let i = 0; i < 3; i++) module._free(pointers.pop());
            }
            const pairsPointer = allocate(bondCount * 8), valuesPointer = allocate(bondCount * 28);
            if (module._pr_blast_authoring_bonds(handle, pairsPointer, valuesPointer, bondCount) !== bondCount)
                throw new Error('Native Blast bond copy failed');
            const pairValues = Array.from(module.HEAPU32.subarray(pairsPointer / 4, pairsPointer / 4 + bondCount * 2));
            const values = Array.from(module.HEAPF32.subarray(valuesPointer / 4, valuesPointer / 4 + bondCount * 7));
            const bonds = [], bondAreasM2 = [], bondCentroids = [], bondNormals = [];
            for (let i = 0; i < bondCount; i++) {
                bonds.push(pairValues.slice(i * 2, i * 2 + 2)); bondAreasM2.push(values[i * 7]);
                bondCentroids.push(values.slice(i * 7 + 1, i * 7 + 4)); bondNormals.push(values.slice(i * 7 + 4, i * 7 + 7));
            }
            return { format: 'particle-realms/blast-authoring', version: 1, chunks, bonds, bondAreasM2, bondCentroids, bondNormals };
        } finally {
            if (handle) module._pr_blast_authoring_destroy(handle);
            for (const pointer of pointers) module._free(pointer);
        }
    }
}
