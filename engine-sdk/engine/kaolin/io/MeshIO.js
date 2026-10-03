/**
 * MeshIO.js — Programmatic mesh import/export (OBJ, PLY, STL)
 *
 * Pure JS parsers/writers for common mesh formats.
 * No dependencies — works with fetch() or FileReader in browser.
 *
 * All outputs use the Kaolin convention:
 *   positions: Float32Array stride 3
 *   indices:   Uint32Array stride 3
 *   normals:   Float32Array stride 3 (optional)
 *   uvs:       Float32Array stride 2 (optional)
 *
 * Compatible with:
 *   - MeshOps.js, MeshSubdivision.js, MeshTetrahedralize.js
 *   - Editor GLB loader (supplementary path for non-GLB formats)
 *   - EntityMeshRenderer
 */

// ============================================================================
// OBJ IMPORT
// ============================================================================

/**
 * Parse an OBJ string into mesh data.
 *
 * @param {string} objText — OBJ file content
 * @param {Object} options
 * @param {boolean} options.flipYZ — swap Y and Z axes (default false)
 * @returns {{ positions: Float32Array, indices: Uint32Array, normals?: Float32Array, uvs?: Float32Array }}
 */
export function parseOBJ(objText, options = {}) {
    const flipYZ = options.flipYZ ?? false;

    const positions = [];
    const normals = [];
    const uvs = [];
    const outPositions = [];
    const outNormals = [];
    const outUVs = [];
    const outIndices = [];
    const vertexMap = new Map();
    let vertexCount = 0;

    const lines = objText.split('\n');

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.length === 0 || line[0] === '#') continue;

        const parts = line.split(/\s+/);
        const cmd = parts[0];

        if (cmd === 'v') {
            let x = parseFloat(parts[1]) || 0;
            let y = parseFloat(parts[2]) || 0;
            let z = parseFloat(parts[3]) || 0;
            if (flipYZ) { const t = y; y = z; z = t; }
            positions.push(x, y, z);
        } else if (cmd === 'vn') {
            let x = parseFloat(parts[1]) || 0;
            let y = parseFloat(parts[2]) || 0;
            let z = parseFloat(parts[3]) || 0;
            if (flipYZ) { const t = y; y = z; z = t; }
            normals.push(x, y, z);
        } else if (cmd === 'vt') {
            uvs.push(parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0);
        } else if (cmd === 'f') {
            // Triangulate fan for faces with >3 vertices
            const faceVerts = [];
            for (let i = 1; i < parts.length; i++) {
                const key = parts[i];
                if (vertexMap.has(key)) {
                    faceVerts.push(vertexMap.get(key));
                } else {
                    const indices = key.split('/');
                    const vi = (parseInt(indices[0]) || 1) - 1;
                    const ti = indices.length > 1 && indices[1] ? (parseInt(indices[1]) || 1) - 1 : -1;
                    const ni = indices.length > 2 && indices[2] ? (parseInt(indices[2]) || 1) - 1 : -1;

                    outPositions.push(
                        positions[vi * 3] ?? 0,
                        positions[vi * 3 + 1] ?? 0,
                        positions[vi * 3 + 2] ?? 0
                    );

                    if (ni >= 0 && normals.length > 0) {
                        outNormals.push(
                            normals[ni * 3] ?? 0,
                            normals[ni * 3 + 1] ?? 0,
                            normals[ni * 3 + 2] ?? 0
                        );
                    }

                    if (ti >= 0 && uvs.length > 0) {
                        outUVs.push(uvs[ti * 2] ?? 0, uvs[ti * 2 + 1] ?? 0);
                    }

                    const idx = vertexCount++;
                    vertexMap.set(key, idx);
                    faceVerts.push(idx);
                }
            }

            // Fan triangulation
            for (let i = 1; i < faceVerts.length - 1; i++) {
                outIndices.push(faceVerts[0], faceVerts[i], faceVerts[i + 1]);
            }
        }
    }

    const result = {
        positions: new Float32Array(outPositions),
        indices: new Uint32Array(outIndices),
    };

    if (outNormals.length > 0) result.normals = new Float32Array(outNormals);
    if (outUVs.length > 0) result.uvs = new Float32Array(outUVs);

    return result;
}


// ============================================================================
// OBJ EXPORT
// ============================================================================

/**
 * Write mesh data to OBJ format string.
 *
 * @param {Float32Array} positions — stride 3
 * @param {Uint32Array}  indices   — stride 3
 * @param {Object}       options
 * @param {Float32Array} options.normals — stride 3
 * @param {Float32Array} options.uvs     — stride 2
 * @param {string}       options.name    — object name
 * @returns {string} — OBJ file content
 */
export function writeOBJ(positions, indices, options = {}) {
    const normals = options.normals ?? null;
    const uvs = options.uvs ?? null;
    const name = options.name ?? 'mesh';
    const numVerts = (positions.length / 3) | 0;
    const numFaces = (indices.length / 3) | 0;

    const lines = [`# Kaolin MeshIO Export`, `o ${name}`, ''];

    // Vertices
    for (let i = 0; i < numVerts; i++) {
        lines.push(`v ${positions[i*3].toFixed(6)} ${positions[i*3+1].toFixed(6)} ${positions[i*3+2].toFixed(6)}`);
    }

    // UVs
    if (uvs) {
        for (let i = 0; i < numVerts; i++) {
            lines.push(`vt ${uvs[i*2].toFixed(6)} ${uvs[i*2+1].toFixed(6)}`);
        }
    }

    // Normals
    if (normals) {
        for (let i = 0; i < numVerts; i++) {
            lines.push(`vn ${normals[i*3].toFixed(6)} ${normals[i*3+1].toFixed(6)} ${normals[i*3+2].toFixed(6)}`);
        }
    }

    lines.push('');

    // Faces (1-indexed)
    for (let f = 0; f < numFaces; f++) {
        const i0 = indices[f*3] + 1;
        const i1 = indices[f*3+1] + 1;
        const i2 = indices[f*3+2] + 1;

        if (normals && uvs) {
            lines.push(`f ${i0}/${i0}/${i0} ${i1}/${i1}/${i1} ${i2}/${i2}/${i2}`);
        } else if (normals) {
            lines.push(`f ${i0}//${i0} ${i1}//${i1} ${i2}//${i2}`);
        } else if (uvs) {
            lines.push(`f ${i0}/${i0} ${i1}/${i1} ${i2}/${i2}`);
        } else {
            lines.push(`f ${i0} ${i1} ${i2}`);
        }
    }

    return lines.join('\n') + '\n';
}


// ============================================================================
// PLY IMPORT (ASCII + BINARY LITTLE-ENDIAN)
// ============================================================================

/**
 * Parse a PLY file (ArrayBuffer) into mesh data.
 * Supports ASCII and binary_little_endian formats.
 *
 * @param {ArrayBuffer} buffer — raw file bytes
 * @returns {{ positions: Float32Array, indices: Uint32Array, normals?: Float32Array, colors?: Float32Array }}
 */
export function parsePLY(buffer) {
    const bytes = new Uint8Array(buffer);

    // Find end of header
    let headerEnd = 0;
    const decoder = new TextDecoder('ascii');
    const headerText = decoder.decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
    const headerEndIdx = headerText.indexOf('end_header');
    if (headerEndIdx < 0) return _emptyMesh();

    // Find actual byte offset of end_header line end
    headerEnd = headerEndIdx + 'end_header'.length;
    while (headerEnd < bytes.length && bytes[headerEnd] !== 10) headerEnd++;
    headerEnd++; // skip newline

    // Parse header
    const headerLines = headerText.substring(0, headerEndIdx).split('\n').map(l => l.trim());
    let format = 'ascii';
    let vertexCount = 0, faceCount = 0;
    const vertexProps = [];
    const faceProps = [];
    let inVertex = false, inFace = false;

    for (const line of headerLines) {
        if (line.startsWith('format')) {
            format = line.split(/\s+/)[1];
        } else if (line.startsWith('element vertex')) {
            vertexCount = parseInt(line.split(/\s+/)[2]) || 0;
            inVertex = true; inFace = false;
        } else if (line.startsWith('element face')) {
            faceCount = parseInt(line.split(/\s+/)[2]) || 0;
            inFace = true; inVertex = false;
        } else if (line.startsWith('property') && inVertex) {
            const parts = line.split(/\s+/);
            vertexProps.push({ type: parts[1], name: parts[2] });
        } else if (line.startsWith('property') && inFace) {
            // list property for face indices
            faceProps.push(line);
        }
    }

    if (format === 'ascii') {
        return _parsePLYAscii(headerText, headerEnd, bytes, vertexCount, faceCount, vertexProps);
    } else {
        return _parsePLYBinary(buffer, headerEnd, vertexCount, faceCount, vertexProps);
    }
}


// ============================================================================
// PLY EXPORT (ASCII)
// ============================================================================

/**
 * Write mesh data to PLY format (ASCII).
 *
 * @param {Float32Array} positions — stride 3
 * @param {Uint32Array}  indices   — stride 3
 * @param {Object}       options
 * @param {Float32Array} options.normals — stride 3
 * @param {Uint8Array}   options.colors  — stride 3 (RGB, 0-255)
 * @returns {string} — PLY file content
 */
export function writePLY(positions, indices, options = {}) {
    const normals = options.normals ?? null;
    const colors = options.colors ?? null;
    const numVerts = (positions.length / 3) | 0;
    const numFaces = (indices.length / 3) | 0;

    const lines = ['ply', 'format ascii 1.0', `element vertex ${numVerts}`];
    lines.push('property float x', 'property float y', 'property float z');
    if (normals) lines.push('property float nx', 'property float ny', 'property float nz');
    if (colors) lines.push('property uchar red', 'property uchar green', 'property uchar blue');
    lines.push(`element face ${numFaces}`, 'property list uchar int vertex_indices', 'end_header');

    for (let i = 0; i < numVerts; i++) {
        let line = `${positions[i*3].toFixed(6)} ${positions[i*3+1].toFixed(6)} ${positions[i*3+2].toFixed(6)}`;
        if (normals) line += ` ${normals[i*3].toFixed(6)} ${normals[i*3+1].toFixed(6)} ${normals[i*3+2].toFixed(6)}`;
        if (colors) line += ` ${colors[i*3]} ${colors[i*3+1]} ${colors[i*3+2]}`;
        lines.push(line);
    }

    for (let f = 0; f < numFaces; f++) {
        lines.push(`3 ${indices[f*3]} ${indices[f*3+1]} ${indices[f*3+2]}`);
    }

    return lines.join('\n') + '\n';
}


// ============================================================================
// STL IMPORT (ASCII + BINARY)
// ============================================================================

/**
 * Parse an STL file (ArrayBuffer) into mesh data.
 * Auto-detects ASCII vs binary.
 *
 * @param {ArrayBuffer} buffer — raw file bytes
 * @returns {{ positions: Float32Array, indices: Uint32Array, normals: Float32Array }}
 */
export function parseSTL(buffer) {
    const bytes = new Uint8Array(buffer);

    // Check if ASCII
    const header = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(80, bytes.length)));
    if (header.trimStart().startsWith('solid') && _looksLikeAsciiSTL(bytes)) {
        return _parseSTLAscii(buffer);
    }

    return _parseSTLBinary(buffer);
}


/**
 * Write mesh data to binary STL format.
 *
 * @param {Float32Array} positions — stride 3
 * @param {Uint32Array}  indices   — stride 3
 * @param {Float32Array} normals   — face normals stride 3 (optional, computed if missing)
 * @returns {ArrayBuffer}
 */
export function writeSTL(positions, indices, normals = null) {
    const numFaces = (indices.length / 3) | 0;

    // 80-byte header + 4-byte face count + 50 bytes per face
    const bufferSize = 84 + numFaces * 50;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // Header (80 bytes)
    const headerStr = 'Kaolin MeshIO STL Export';
    for (let i = 0; i < Math.min(headerStr.length, 80); i++) {
        view.setUint8(i, headerStr.charCodeAt(i));
    }

    // Face count
    view.setUint32(80, numFaces, true);

    let offset = 84;
    for (let f = 0; f < numFaces; f++) {
        const i0 = indices[f * 3] * 3;
        const i1 = indices[f * 3 + 1] * 3;
        const i2 = indices[f * 3 + 2] * 3;

        // Face normal
        let nx, ny, nz;
        if (normals) {
            nx = normals[f * 3]; ny = normals[f * 3 + 1]; nz = normals[f * 3 + 2];
        } else {
            const e1x = positions[i1] - positions[i0];
            const e1y = positions[i1 + 1] - positions[i0 + 1];
            const e1z = positions[i1 + 2] - positions[i0 + 2];
            const e2x = positions[i2] - positions[i0];
            const e2y = positions[i2 + 1] - positions[i0 + 1];
            const e2z = positions[i2 + 2] - positions[i0 + 2];
            nx = e1y * e2z - e1z * e2y;
            ny = e1z * e2x - e1x * e2z;
            nz = e1x * e2y - e1y * e2x;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (len > 1e-7) { nx /= len; ny /= len; nz /= len; }
        }

        view.setFloat32(offset, nx, true); offset += 4;
        view.setFloat32(offset, ny, true); offset += 4;
        view.setFloat32(offset, nz, true); offset += 4;

        // 3 vertices
        for (const vi of [i0, i1, i2]) {
            view.setFloat32(offset, positions[vi], true); offset += 4;
            view.setFloat32(offset, positions[vi + 1], true); offset += 4;
            view.setFloat32(offset, positions[vi + 2], true); offset += 4;
        }

        // Attribute byte count (unused)
        view.setUint16(offset, 0, true); offset += 2;
    }

    return buffer;
}


// ============================================================================
// HELPERS — FETCH
// ============================================================================

/**
 * Load a mesh from URL (auto-detects format from extension).
 *
 * @param {string} url
 * @returns {Promise<{ positions: Float32Array, indices: Uint32Array, normals?: Float32Array, uvs?: Float32Array }>}
 */
export async function loadMesh(url) {
    const ext = url.split('.').pop().toLowerCase();

    if (ext === 'obj') {
        const text = await (await fetch(url)).text();
        return parseOBJ(text);
    } else if (ext === 'ply') {
        const buffer = await (await fetch(url)).arrayBuffer();
        return parsePLY(buffer);
    } else if (ext === 'stl') {
        const buffer = await (await fetch(url)).arrayBuffer();
        return parseSTL(buffer);
    }

    throw new Error(`[MeshIO] Unsupported format: .${ext}`);
}

/**
 * Download mesh as a file (browser).
 */
export function downloadMesh(filename, data) {
    let blob;
    if (typeof data === 'string') {
        blob = new Blob([data], { type: 'text/plain' });
    } else {
        blob = new Blob([data], { type: 'application/octet-stream' });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}


// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function _emptyMesh() {
    return { positions: new Float32Array(0), indices: new Uint32Array(0) };
}

function _parsePLYAscii(headerText, headerEnd, bytes, vertexCount, faceCount, vertexProps) {
    const decoder = new TextDecoder('ascii');
    const bodyText = decoder.decode(bytes.subarray(headerEnd));
    const bodyLines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    const positions = new Float32Array(vertexCount * 3);
    let normals = null;
    let colors = null;

    const hasNx = vertexProps.some(p => p.name === 'nx');
    const hasR = vertexProps.some(p => p.name === 'red');
    if (hasNx) normals = new Float32Array(vertexCount * 3);
    if (hasR) colors = new Float32Array(vertexCount * 3);

    // Build property index map
    const propIdx = {};
    for (let i = 0; i < vertexProps.length; i++) propIdx[vertexProps[i].name] = i;

    for (let i = 0; i < vertexCount && i < bodyLines.length; i++) {
        const vals = bodyLines[i].split(/\s+/);
        positions[i * 3]     = parseFloat(vals[propIdx.x] ?? vals[0]) || 0;
        positions[i * 3 + 1] = parseFloat(vals[propIdx.y] ?? vals[1]) || 0;
        positions[i * 3 + 2] = parseFloat(vals[propIdx.z] ?? vals[2]) || 0;

        if (normals && propIdx.nx !== undefined) {
            normals[i * 3]     = parseFloat(vals[propIdx.nx]) || 0;
            normals[i * 3 + 1] = parseFloat(vals[propIdx.ny]) || 0;
            normals[i * 3 + 2] = parseFloat(vals[propIdx.nz]) || 0;
        }
        if (colors && propIdx.red !== undefined) {
            colors[i * 3]     = (parseFloat(vals[propIdx.red]) || 0) / 255;
            colors[i * 3 + 1] = (parseFloat(vals[propIdx.green]) || 0) / 255;
            colors[i * 3 + 2] = (parseFloat(vals[propIdx.blue]) || 0) / 255;
        }
    }

    const indices = [];
    for (let i = 0; i < faceCount; i++) {
        const lineIdx = vertexCount + i;
        if (lineIdx >= bodyLines.length) break;
        const vals = bodyLines[lineIdx].split(/\s+/).map(Number);
        const count = vals[0];
        // Fan triangulate
        for (let j = 1; j < count - 1; j++) {
            indices.push(vals[1], vals[j + 1], vals[j + 2]);
        }
    }

    const result = { positions, indices: new Uint32Array(indices) };
    if (normals) result.normals = normals;
    if (colors) result.colors = colors;
    return result;
}

function _parsePLYBinary(buffer, headerEnd, vertexCount, faceCount, vertexProps) {
    const view = new DataView(buffer);
    let offset = headerEnd;

    // Calculate vertex stride
    const propSizes = { char: 1, uchar: 1, short: 2, ushort: 2, int: 4, uint: 4, float: 4, double: 8 };
    let vertexStride = 0;
    const propOffsets = {};
    for (const p of vertexProps) {
        propOffsets[p.name] = vertexStride;
        vertexStride += propSizes[p.type] || 4;
    }

    const positions = new Float32Array(vertexCount * 3);
    let normals = null;
    let colors = null;

    const hasNx = propOffsets.nx !== undefined;
    const hasR = propOffsets.red !== undefined;
    if (hasNx) normals = new Float32Array(vertexCount * 3);
    if (hasR) colors = new Float32Array(vertexCount * 3);

    for (let i = 0; i < vertexCount; i++) {
        const base = offset;
        positions[i * 3]     = view.getFloat32(base + propOffsets.x, true);
        positions[i * 3 + 1] = view.getFloat32(base + propOffsets.y, true);
        positions[i * 3 + 2] = view.getFloat32(base + propOffsets.z, true);

        if (normals) {
            normals[i * 3]     = view.getFloat32(base + propOffsets.nx, true);
            normals[i * 3 + 1] = view.getFloat32(base + propOffsets.ny, true);
            normals[i * 3 + 2] = view.getFloat32(base + propOffsets.nz, true);
        }
        if (colors) {
            colors[i * 3]     = view.getUint8(base + propOffsets.red) / 255;
            colors[i * 3 + 1] = view.getUint8(base + propOffsets.green) / 255;
            colors[i * 3 + 2] = view.getUint8(base + propOffsets.blue) / 255;
        }

        offset += vertexStride;
    }

    const indices = [];
    for (let f = 0; f < faceCount; f++) {
        const count = view.getUint8(offset); offset += 1;
        const faceVerts = [];
        for (let j = 0; j < count; j++) {
            faceVerts.push(view.getInt32(offset, true));
            offset += 4;
        }
        for (let j = 1; j < count - 1; j++) {
            indices.push(faceVerts[0], faceVerts[j], faceVerts[j + 1]);
        }
    }

    const result = { positions, indices: new Uint32Array(indices) };
    if (normals) result.normals = normals;
    if (colors) result.colors = colors;
    return result;
}

function _looksLikeAsciiSTL(bytes) {
    // Check first ~1000 bytes for 'facet' keyword
    const sample = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(1000, bytes.length)));
    return sample.includes('facet');
}

function _parseSTLAscii(buffer) {
    const text = new TextDecoder('ascii').decode(new Uint8Array(buffer));
    const positions = [];
    const normals = [];
    const indices = [];

    let currentNormal = [0, 0, 0];
    let vertCount = 0;
    const lines = text.split('\n');

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.startsWith('facet normal')) {
            const parts = line.split(/\s+/);
            currentNormal = [parseFloat(parts[2]) || 0, parseFloat(parts[3]) || 0, parseFloat(parts[4]) || 0];
        } else if (line.startsWith('vertex')) {
            const parts = line.split(/\s+/);
            positions.push(parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0, parseFloat(parts[3]) || 0);
            normals.push(currentNormal[0], currentNormal[1], currentNormal[2]);
            vertCount++;
        } else if (line.startsWith('endfacet')) {
            if (vertCount >= 3) {
                const base = vertCount - 3;
                indices.push(base, base + 1, base + 2);
            }
        }
    }

    return {
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
        normals: new Float32Array(normals),
    };
}

function _parseSTLBinary(buffer) {
    const view = new DataView(buffer);
    const numFaces = view.getUint32(80, true);

    const positions = new Float32Array(numFaces * 9);
    const normals = new Float32Array(numFaces * 3);
    const indices = new Uint32Array(numFaces * 3);

    let offset = 84;
    for (let f = 0; f < numFaces; f++) {
        normals[f * 3]     = view.getFloat32(offset, true); offset += 4;
        normals[f * 3 + 1] = view.getFloat32(offset, true); offset += 4;
        normals[f * 3 + 2] = view.getFloat32(offset, true); offset += 4;

        for (let v = 0; v < 3; v++) {
            const vi = f * 9 + v * 3;
            positions[vi]     = view.getFloat32(offset, true); offset += 4;
            positions[vi + 1] = view.getFloat32(offset, true); offset += 4;
            positions[vi + 2] = view.getFloat32(offset, true); offset += 4;
        }

        indices[f * 3]     = f * 3;
        indices[f * 3 + 1] = f * 3 + 1;
        indices[f * 3 + 2] = f * 3 + 2;

        offset += 2; // attribute byte count
    }

    return { positions, indices, normals };
}
