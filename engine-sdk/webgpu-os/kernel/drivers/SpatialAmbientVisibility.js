// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Conservative projected-footprint visibility, retaining elongated thin structures. */
export function projectedSpatialFootprint(geometry, id, camera, width, height, settings) {
    const at = id * 40, x = geometry[at] - camera.eye[0], y = geometry[at + 1] - camera.eye[1], z = geometry[at + 2] - camera.eye[2];
    const dot = a => a[0] * x + a[1] * y + a[2] * z;
    const depth = dot(camera.forward), cx = dot(camera.right), cy = dot(camera.up), faithful = settings.renderProfile === 'faithful';
    const size = faithful ? 1 : settings.size, scale = size * size, shutter = faithful ? 0 : settings.shutter * settings.shutter / 12;
    const vx = geometry[at + 32], vy = geometry[at + 33], vz = geometry[at + 34];
    const C = [geometry[at + 4] * scale + vx * vx * shutter, geometry[at + 5] * scale + vx * vy * shutter, geometry[at + 6] * scale + vx * vz * shutter,
        geometry[at + 7] * scale + vy * vy * shutter, geometry[at + 8] * scale + vy * vz * shutter, geometry[at + 9] * scale + vz * vz * shutter];
    if (!(depth > (camera.near ?? .06)) || depth > (camera.far ?? 100)) return { visible: false, reason: 'depth', depth, C };
    const sx = camera.fx * width / depth, sy = camera.fy * height / depth;
    const jx = camera.right.map((v, i) => sx * (v - camera.forward[i] * cx / depth));
    const jy = camera.up.map((v, i) => sy * (v - camera.forward[i] * cy / depth));
    const product = (a, b) => a[0] * (C[0] * b[0] + C[1] * b[1] + C[2] * b[2]) + a[1] * (C[1] * b[0] + C[3] * b[1] + C[4] * b[2]) + a[2] * (C[2] * b[0] + C[4] * b[1] + C[5] * b[2]);
    const aa = product(jx, jx) + .25, ab = product(jx, jy), bb = product(jy, jy) + .25;
    const middle = (aa + bb) / 2, spread = Math.sqrt(Math.max(0, (aa - bb) ** 2 / 4 + ab * ab));
    // Visibility uses the physical footprint before the antialiasing floor.
    const major = 3 * Math.sqrt(Math.max(0, middle + spread - .25)), minor = 3 * Math.sqrt(Math.max(0, middle - spread - .25));
    const px = (camera.cx + camera.fx * cx / depth) * width, py = (camera.cy - camera.fy * cy / depth) * height;
    const rx = 3 * Math.sqrt(Math.max(0, aa)), ry = 3 * Math.sqrt(Math.max(0, bb));
    const alpha = geometry[at + 15] * geometry[at + 3] * (faithful ? 1 : settings.opacity);
    const reason = alpha < .002 ? 'transparent' : px + rx < 0 || py + ry < 0 || px - rx > width || py - ry > height ? 'frustum'
        : major < (settings.lodPixelRadius ?? .18) && major < Math.max(minor * 4, .00001) ? 'subpixel' : null;
    return { visible: !reason, reason, depth, x: px, y: py, rx, ry, major, minor, C };
}

function inverseCovariance(C) {
    const [a, b, c, d, e, f] = C, A = d * f - e * e, B = c * e - b * f, D = a * f - c * c, E = b * c - a * e, F = a * d - b * b;
    const determinant = a * A + b * B + c * (b * e - c * d);
    return determinant > 1e-25 ? [A, B, b * e - c * d, D, E, F].map(v => v / determinant) : null;
}
/** Gaussian maximum-density distance on a tile-centre ray; stable ID resolves ties. */
export function spatialLocalDepth(point, inverse, ray, camera) {
    if (!inverse) return (point[0] - camera.eye[0]) * camera.forward[0] + (point[1] - camera.eye[1]) * camera.forward[1] + (point[2] - camera.eye[2]) * camera.forward[2];
    const [a, b, c, d, e, f] = inverse, q = [a * ray[0] + b * ray[1] + c * ray[2], b * ray[0] + d * ray[1] + e * ray[2], c * ray[0] + e * ray[1] + f * ray[2]];
    const denominator = ray[0] * q[0] + ray[1] * q[1] + ray[2] * q[2];
    return denominator > 1e-20 ? ((point[0] - camera.eye[0]) * q[0] + (point[1] - camera.eye[1]) * q[1] + (point[2] - camera.eye[2]) * q[2]) / denominator : 0;
}

export function createSpatialCpuVisibility(count, local = false) {
    const columns = local ? 4 : 1, rows = local ? 4 : 1, tileCount = columns * rows;
    const order = new Uint32Array(Math.max(1, count * tileCount)), projected = new Array(count), lists = Array.from({ length: tileCount }, () => []), localKeys = new Float64Array(count);
    return { order, encode(geometry, camera, width, height, settings, globalOrder) {
        const reasons = { depth: 0, transparent: 0, frustum: 0, subpixel: 0 }; let visible = 0, offset = 0;
        lists.forEach(list => { list.length = 0; });
        for (let i = 0; i < count; i++) {
            const p = projectedSpatialFootprint(geometry, i, camera, width, height, settings); projected[i] = p;
            if (!p.visible) { reasons[p.reason]++; continue; } visible++;
            if (!local) continue;
            p.inverse = inverseCovariance(p.C);
            const x0 = Math.max(0, Math.min(columns - 1, Math.floor((p.x - p.rx) / width * columns))), x1 = Math.max(0, Math.min(columns - 1, Math.floor((p.x + p.rx) / width * columns)));
            const y0 = Math.max(0, Math.min(rows - 1, Math.floor((p.y - p.ry) / height * rows))), y1 = Math.max(0, Math.min(rows - 1, Math.floor((p.y + p.ry) / height * rows)));
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) lists[y * columns + x].push(i);
        }
        if (!local) { for (const id of globalOrder) if (projected[id]?.visible) order[offset++] = id; return { count: offset, visible, culled: count - visible, reasons, tiles: null }; }
        const tiles = [];
        for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
            const left = Math.floor(x * width / columns), top = Math.floor(y * height / rows), right = Math.floor((x + 1) * width / columns), bottom = Math.floor((y + 1) * height / rows);
            const u = (left + right) / (2 * width), v = (top + bottom) / (2 * height), ray = camera.forward.map((value, axis) => value + camera.right[axis] * (u - camera.cx) / camera.fx + camera.up[axis] * (camera.cy - v) / camera.fy);
            const list = lists[y * columns + x];
            for (const id of list) localKeys[id] = spatialLocalDepth(geometry.subarray(id * 40, id * 40 + 3), projected[id].inverse, ray, camera);
            list.sort((a, b) => localKeys[b] - localKeys[a] || a - b);
            const first = offset; for (const id of list) order[offset++] = id;
            if (right > left && bottom > top && list.length) tiles.push({ x: left, y: top, width: right - left, height: bottom - top, first, count: list.length });
        }
        return { count: offset, visible, culled: count - visible, reasons, tiles };
    } };
}

/** Same branch-pivot rotation is used for Gaussian geometry and mesh vertices. */
export function spatialWindAngle(wind, offset, time) {
    const flexibility = wind[offset + 3], phase = wind[offset + 4], amplitude = wind[offset + 5], frequency = wind[offset + 6];
    return flexibility * amplitude * (Math.sin(time * frequency + phase) * .72 + Math.sin(time * frequency * .43 + phase * 1.7) * .28);
}
export function rotateSpatialWind(vector, angle, direction) {
    const ax = -Math.sin(direction), az = Math.cos(direction), c = Math.cos(angle), s = Math.sin(angle), projection = ax * vector[0] + az * vector[2];
    return [vector[0] * c - az * vector[1] * s + ax * projection * (1 - c), vector[1] * c + (az * vector[0] - ax * vector[2]) * s, vector[2] * c + ax * vector[1] * s + az * projection * (1 - c)];
}
export function applySpatialTreeWind(geometry, wind, time) {
    if (!wind) return;
    for (let i = 0; i < geometry.length / 40; i++) {
        const offset = i * 8, at = i * 40, angle = spatialWindAngle(wind, offset, time); if (Math.abs(angle) < 1e-9) continue;
        const direction = wind[offset + 7], point = rotateSpatialWind([geometry[at] - wind[offset], geometry[at + 1] - wind[offset + 1], geometry[at + 2] - wind[offset + 2]], angle, direction);
        geometry.set(point.map((v, axis) => v + wind[offset + axis]), at);
        geometry.set(rotateSpatialWind(geometry.subarray(at + 24, at + 27), angle, direction), at + 24);
        const columns = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(v => rotateSpatialWind(v, angle, direction));
        const C = [geometry[at + 4], geometry[at + 5], geometry[at + 6], geometry[at + 7], geometry[at + 8], geometry[at + 9]];
        const product = (a, b) => a[0] * (C[0] * b[0] + C[1] * b[1] + C[2] * b[2]) + a[1] * (C[1] * b[0] + C[3] * b[1] + C[4] * b[2]) + a[2] * (C[2] * b[0] + C[4] * b[1] + C[5] * b[2]);
        const row = axis => columns.map(column => column[axis]);
        geometry.set([product(row(0), row(0)), product(row(0), row(1)), product(row(0), row(2)), product(row(1), row(1)), product(row(1), row(2)), product(row(2), row(2))], at + 4);
    }
}
