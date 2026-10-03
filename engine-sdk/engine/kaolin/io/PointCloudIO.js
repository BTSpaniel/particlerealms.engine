/**
 * PointCloudIO.js — Point cloud import/export (PLY, PCD, XYZ)
 *
 * Pure JS parsers/writers for point cloud formats.
 * Outputs: Float32Array positions (stride 3) + optional normals/colors.
 *
 * Compatible with:
 *   - PointCloudOps.js
 *   - MeshToPoints.js / PointsToMesh.js
 *   - Particle system (direct spawn from loaded points)
 */

import { parsePLY, writePLY } from './MeshIO.js';

// ============================================================================
// PLY POINT CLOUD (delegates to MeshIO for parsing, extracts points only)
// ============================================================================

/**
 * Load a point cloud from PLY (ArrayBuffer).
 * Ignores face data — returns only vertex positions + attributes.
 *
 * @param {ArrayBuffer} buffer
 * @returns {{ points: Float32Array, normals?: Float32Array, colors?: Float32Array, count: number }}
 */
export function parsePLYPointCloud(buffer) {
    const mesh = parsePLY(buffer);
    const result = {
        points: mesh.positions,
        count: (mesh.positions.length / 3) | 0,
    };
    if (mesh.normals) result.normals = mesh.normals;
    if (mesh.colors) result.colors = mesh.colors;
    return result;
}

/**
 * Write a point cloud to PLY format (ASCII string, no faces).
 *
 * @param {Float32Array} points  — stride 3
 * @param {Object}       options
 * @param {Float32Array} options.normals — stride 3
 * @param {Uint8Array}   options.colors  — stride 3 (RGB 0-255)
 * @returns {string}
 */
export function writePLYPointCloud(points, options = {}) {
    const normals = options.normals ?? null;
    const colors = options.colors ?? null;
    const numPoints = (points.length / 3) | 0;

    const lines = ['ply', 'format ascii 1.0', `element vertex ${numPoints}`];
    lines.push('property float x', 'property float y', 'property float z');
    if (normals) lines.push('property float nx', 'property float ny', 'property float nz');
    if (colors) lines.push('property uchar red', 'property uchar green', 'property uchar blue');
    lines.push('end_header');

    for (let i = 0; i < numPoints; i++) {
        let line = `${points[i*3].toFixed(6)} ${points[i*3+1].toFixed(6)} ${points[i*3+2].toFixed(6)}`;
        if (normals) line += ` ${normals[i*3].toFixed(6)} ${normals[i*3+1].toFixed(6)} ${normals[i*3+2].toFixed(6)}`;
        if (colors) line += ` ${colors[i*3]} ${colors[i*3+1]} ${colors[i*3+2]}`;
        lines.push(line);
    }

    return lines.join('\n') + '\n';
}


// ============================================================================
// XYZ FORMAT (simplest: one point per line, space-separated)
// ============================================================================

/**
 * Parse XYZ text format.
 * Each line: x y z [nx ny nz] [r g b]
 *
 * @param {string} text
 * @returns {{ points: Float32Array, normals?: Float32Array, colors?: Float32Array, count: number }}
 */
export function parseXYZ(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && l[0] !== '#');
    const numPoints = lines.length;

    if (numPoints === 0) {
        return { points: new Float32Array(0), count: 0 };
    }

    // Detect format from first line
    const firstCols = lines[0].split(/\s+/).length;
    const hasNormals = firstCols >= 6;
    const hasColors = firstCols >= 9;

    const points = new Float32Array(numPoints * 3);
    let normals = hasNormals ? new Float32Array(numPoints * 3) : null;
    let colors = hasColors ? new Float32Array(numPoints * 3) : null;

    for (let i = 0; i < numPoints; i++) {
        const vals = lines[i].split(/\s+/);
        points[i * 3]     = parseFloat(vals[0]) || 0;
        points[i * 3 + 1] = parseFloat(vals[1]) || 0;
        points[i * 3 + 2] = parseFloat(vals[2]) || 0;

        if (normals && vals.length >= 6) {
            normals[i * 3]     = parseFloat(vals[3]) || 0;
            normals[i * 3 + 1] = parseFloat(vals[4]) || 0;
            normals[i * 3 + 2] = parseFloat(vals[5]) || 0;
        }

        if (colors && vals.length >= 9) {
            const r = parseFloat(vals[6]) || 0;
            const g = parseFloat(vals[7]) || 0;
            const b = parseFloat(vals[8]) || 0;
            // Detect if 0-1 or 0-255 range
            const scale = (r > 1 || g > 1 || b > 1) ? 1 / 255 : 1;
            colors[i * 3]     = r * scale;
            colors[i * 3 + 1] = g * scale;
            colors[i * 3 + 2] = b * scale;
        }
    }

    const result = { points, count: numPoints };
    if (normals) result.normals = normals;
    if (colors) result.colors = colors;
    return result;
}

/**
 * Write points to XYZ text format.
 *
 * @param {Float32Array} points  — stride 3
 * @param {Object}       options
 * @param {Float32Array} options.normals — stride 3
 * @param {Float32Array} options.colors  — stride 3 (0-1 range)
 * @returns {string}
 */
export function writeXYZ(points, options = {}) {
    const normals = options.normals ?? null;
    const colors = options.colors ?? null;
    const numPoints = (points.length / 3) | 0;
    const lines = [];

    for (let i = 0; i < numPoints; i++) {
        let line = `${points[i*3].toFixed(6)} ${points[i*3+1].toFixed(6)} ${points[i*3+2].toFixed(6)}`;
        if (normals) line += ` ${normals[i*3].toFixed(6)} ${normals[i*3+1].toFixed(6)} ${normals[i*3+2].toFixed(6)}`;
        if (colors) {
            line += ` ${Math.round(colors[i*3]*255)} ${Math.round(colors[i*3+1]*255)} ${Math.round(colors[i*3+2]*255)}`;
        }
        lines.push(line);
    }

    return lines.join('\n') + '\n';
}


// ============================================================================
// PCD FORMAT (Point Cloud Data — PCL format, ASCII subset)
// ============================================================================

/**
 * Parse PCD text format (ASCII only).
 *
 * @param {string} text
 * @returns {{ points: Float32Array, normals?: Float32Array, colors?: Float32Array, count: number }}
 */
export function parsePCD(text) {
    const lines = text.split('\n').map(l => l.trim());

    let numPoints = 0;
    let dataStart = 0;
    let fields = [];
    let dataFormat = 'ascii';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('FIELDS')) {
            fields = line.split(/\s+/).slice(1);
        } else if (line.startsWith('POINTS')) {
            numPoints = parseInt(line.split(/\s+/)[1]) || 0;
        } else if (line.startsWith('DATA')) {
            dataFormat = line.split(/\s+/)[1] || 'ascii';
            dataStart = i + 1;
            break;
        }
    }

    if (dataFormat !== 'ascii' || numPoints === 0) {
        return { points: new Float32Array(0), count: 0 };
    }

    // Map field names to indices
    const fieldIdx = {};
    for (let i = 0; i < fields.length; i++) fieldIdx[fields[i]] = i;

    const hasNormals = fieldIdx.normal_x !== undefined;
    const hasRGB = fieldIdx.rgb !== undefined;

    const points = new Float32Array(numPoints * 3);
    let normals = hasNormals ? new Float32Array(numPoints * 3) : null;
    let colors = hasRGB ? new Float32Array(numPoints * 3) : null;

    for (let i = 0; i < numPoints; i++) {
        const lineIdx = dataStart + i;
        if (lineIdx >= lines.length) break;

        const vals = lines[lineIdx].split(/\s+/);

        const xi = fieldIdx.x ?? 0;
        const yi = fieldIdx.y ?? 1;
        const zi = fieldIdx.z ?? 2;

        points[i * 3]     = parseFloat(vals[xi]) || 0;
        points[i * 3 + 1] = parseFloat(vals[yi]) || 0;
        points[i * 3 + 2] = parseFloat(vals[zi]) || 0;

        if (normals) {
            normals[i * 3]     = parseFloat(vals[fieldIdx.normal_x]) || 0;
            normals[i * 3 + 1] = parseFloat(vals[fieldIdx.normal_y]) || 0;
            normals[i * 3 + 2] = parseFloat(vals[fieldIdx.normal_z]) || 0;
        }

        if (colors && fieldIdx.rgb !== undefined) {
            // PCD RGB is packed as a float representing an int
            const rgbInt = parseInt(vals[fieldIdx.rgb]) || 0;
            colors[i * 3]     = ((rgbInt >> 16) & 0xFF) / 255;
            colors[i * 3 + 1] = ((rgbInt >> 8) & 0xFF) / 255;
            colors[i * 3 + 2] = (rgbInt & 0xFF) / 255;
        }
    }

    const result = { points, count: numPoints };
    if (normals) result.normals = normals;
    if (colors) result.colors = colors;
    return result;
}

/**
 * Write points to PCD ASCII format.
 *
 * @param {Float32Array} points — stride 3
 * @param {Object}       options
 * @param {Float32Array} options.normals — stride 3
 * @returns {string}
 */
export function writePCD(points, options = {}) {
    const normals = options.normals ?? null;
    const numPoints = (points.length / 3) | 0;

    const fields = ['x', 'y', 'z'];
    const sizes = ['4', '4', '4'];
    const types = ['F', 'F', 'F'];
    const counts = ['1', '1', '1'];

    if (normals) {
        fields.push('normal_x', 'normal_y', 'normal_z');
        sizes.push('4', '4', '4');
        types.push('F', 'F', 'F');
        counts.push('1', '1', '1');
    }

    const header = [
        '# .PCD v0.7 - Kaolin PointCloudIO Export',
        'VERSION 0.7',
        `FIELDS ${fields.join(' ')}`,
        `SIZE ${sizes.join(' ')}`,
        `TYPE ${types.join(' ')}`,
        `COUNT ${counts.join(' ')}`,
        `WIDTH ${numPoints}`,
        'HEIGHT 1',
        'VIEWPOINT 0 0 0 1 0 0 0',
        `POINTS ${numPoints}`,
        'DATA ascii',
    ];

    const dataLines = [];
    for (let i = 0; i < numPoints; i++) {
        let line = `${points[i*3].toFixed(6)} ${points[i*3+1].toFixed(6)} ${points[i*3+2].toFixed(6)}`;
        if (normals) {
            line += ` ${normals[i*3].toFixed(6)} ${normals[i*3+1].toFixed(6)} ${normals[i*3+2].toFixed(6)}`;
        }
        dataLines.push(line);
    }

    return header.join('\n') + '\n' + dataLines.join('\n') + '\n';
}


// ============================================================================
// AUTO-DETECT LOADER
// ============================================================================

/**
 * Load a point cloud from URL (auto-detects format from extension).
 *
 * @param {string} url
 * @returns {Promise<{ points: Float32Array, normals?: Float32Array, colors?: Float32Array, count: number }>}
 */
export async function loadPointCloud(url) {
    const ext = url.split('.').pop().toLowerCase();

    if (ext === 'ply') {
        const buffer = await (await fetch(url)).arrayBuffer();
        return parsePLYPointCloud(buffer);
    } else if (ext === 'xyz') {
        const text = await (await fetch(url)).text();
        return parseXYZ(text);
    } else if (ext === 'pcd') {
        const text = await (await fetch(url)).text();
        return parsePCD(text);
    }

    throw new Error(`[PointCloudIO] Unsupported format: .${ext}`);
}
