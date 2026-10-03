// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { crc32 } from '../../core/math/ChecksumMath.js';
import { createSurfaceFieldTopology } from './SurfaceFieldTopology.js';

const MAGIC = 0x31465350, HEADER = 32, MAX_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
function finiteTree(value, depth = 0) {
    if (depth > 32) throw new RangeError('Checkpoint nesting exceeds its budget');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new RangeError('Checkpoint contains a nonfinite number');
    if (value && typeof value === 'object') {
        if (ArrayBuffer.isView(value)) { for (const number of value) if (!Number.isFinite(number)) throw new RangeError('Checkpoint array contains a nonfinite number'); }
        else for (const child of Object.values(value)) finiteTree(child, depth + 1);
    }
}
function metadata(snapshot) {
    if (!snapshot || snapshot.schema !== 'engine.surface-fields' || snapshot.version !== 1 || snapshot.approximate || !(snapshot.fields instanceof Float32Array) || !(snapshot.solidEnergyJ instanceof Float64Array)) throw new TypeError('Checkpoint encoding requires an authoritative world snapshot');
    const topology = createSurfaceFieldTopology(snapshot.topology);
    if (topology.identity !== snapshot.topology.identity || snapshot.fields.length !== topology.count * 8 || snapshot.solidEnergyJ.length !== topology.count) throw new RangeError('Checkpoint topology does not match retained fields');
    finiteTree(snapshot);
    const { fields, solidEnergyJ, ...rest } = snapshot;
    return { ...rest, solidEnergyJ: [...solidEnergyJ] };
}

/** Channel-wise exact RLE of float bits, with JSON metadata retaining f64
 * owner state. A preview quantizes fields only and is always non-authoritative.
 * The advertised tolerance is an absolute per-channel bound in SI units. */
export function encodeSurfaceFieldCheckpoint(snapshot, { tolerance = 0 } = {}) {
    if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) throw new RangeError('Checkpoint tolerance must be in [0, 1]');
    const meta = metadata(snapshot), fields = snapshot.fields.slice();
    if (tolerance > 0) for (let i = 0; i < fields.length; i++) {
        const candidate = Math.fround(Math.round(fields[i] / tolerance) * tolerance);
        if (Math.abs(candidate - fields[i]) <= tolerance) fields[i] = candidate;
    }
    const bits = new Uint32Array(fields.buffer), runs = [], cells = fields.length / 8;
    for (let channel = 0; channel < 8; channel++) for (let cell = 0; cell < cells;) {
        const value = bits[cell * 8 + channel]; let length = 1;
        while (cell + length < cells && bits[(cell + length) * 8 + channel] === value) length++;
        runs.push(length, value); cell += length;
    }
    meta.approximate = tolerance > 0; meta.tolerance = tolerance;
    const json = encoder.encode(JSON.stringify(meta)), length = HEADER + json.length + runs.length * 4;
    if (length > MAX_BYTES) throw new RangeError('Checkpoint exceeds its byte budget');
    const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
    view.setUint32(0, MAGIC, true); view.setUint32(4, 1, true); view.setUint32(8, length, true);
    view.setUint32(12, json.length, true); view.setUint32(16, fields.length, true); view.setUint32(20, runs.length / 2, true);
    view.setUint32(24, tolerance > 0 ? 1 : 0, true); bytes.set(json, HEADER);
    runs.forEach((value, i) => view.setUint32(HEADER + json.length + i * 4, value, true));
    view.setUint32(28, crc32(bytes.subarray(HEADER)), true);
    return { bytes, approximate: tolerance > 0, tolerance, rawBytes: snapshot.fields.byteLength + snapshot.solidEnergyJ.byteLength + json.length, encodedBytes: length,
        counts: { runs: runs.length / 2 }, authoritative: tolerance === 0 };
}

export function decodeSurfaceFieldCheckpoint(input, { allowApproximate = false } = {}) {
    const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
    if (!bytes || bytes.length < HEADER || bytes.length > MAX_BYTES) throw new RangeError('Checkpoint is empty, truncated or oversized');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const length = view.getUint32(8, true), jsonLength = view.getUint32(12, true), fieldLength = view.getUint32(16, true), runCount = view.getUint32(20, true), flags = view.getUint32(24, true);
    if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== 1 || length !== bytes.length || flags > 1
        || jsonLength === 0 || jsonLength > length - HEADER || HEADER + jsonLength + runCount * 8 !== length || !fieldLength || fieldLength % 8 || fieldLength > 16 * 64 * 64 * 8) throw new RangeError('Invalid checkpoint envelope');
    if (flags && !allowApproximate) throw new RangeError('Approximate surface preview cannot resume an authoritative simulation');
    if (view.getUint32(28, true) !== crc32(bytes.subarray(HEADER))) throw new RangeError('Checkpoint checksum failed');
    let meta;
    try { meta = JSON.parse(decoder.decode(bytes.subarray(HEADER, HEADER + jsonLength))); }
    catch (error) { throw new TypeError('Checkpoint metadata is malformed', { cause: error }); }
    finiteTree(meta);
    if (meta.schema !== 'engine.surface-fields' || meta.version !== 1 || meta.approximate !== !!flags || !Number.isFinite(meta.tolerance) || meta.tolerance < 0 || meta.tolerance > 1 || !!meta.tolerance !== !!flags) throw new RangeError('Invalid checkpoint authority metadata');
    const topology = createSurfaceFieldTopology(meta.topology), cells = fieldLength / 8;
    if (topology.count !== cells || topology.identity !== meta.topology.identity || !Array.isArray(meta.solidEnergyJ) || meta.solidEnergyJ.length !== cells) throw new RangeError('Checkpoint topology identity failed');
    const fields = new Float32Array(fieldLength), bits = new Uint32Array(fields.buffer); let run = 0;
    for (let channel = 0; channel < 8; channel++) {
        let cell = 0;
        while (cell < cells) {
            if (run >= runCount) throw new RangeError('Checkpoint field stream is truncated');
            const offset = HEADER + jsonLength + run++ * 8, count = view.getUint32(offset, true), value = view.getUint32(offset + 4, true);
            if (!count || count > cells - cell) throw new RangeError('Checkpoint field run exceeds its channel');
            for (let k = 0; k < count; k++) bits[(cell + k) * 8 + channel] = value;
            cell += count;
        }
    }
    if (run !== runCount || !fields.every(value => Number.isFinite(value) && value >= 0)) throw new RangeError('Checkpoint contains trailing data or invalid surface fields');
    return { ...meta, fields, solidEnergyJ: new Float64Array(meta.solidEnergyJ) };
}
