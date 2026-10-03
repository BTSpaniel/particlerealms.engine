// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Metric adult avatars. The body is one indexed branching surface; the rig is
 * the same EngineModel skin contract as imported glTF, not detached primitives.
 * Styles change geometry, not inferred identity. These are basic procedural
 * avatars, not scanned anatomy or a facial-expression/cloth simulation. */
import { createEngineModel, createEngineNode, createEngineMesh, createEnginePrimitive } from '../EngineModel.js';
import { buildHumanoidRig } from './HumanoidRigBuilder.js';
import { buildHands } from './HandRigBuilder.js';
import { HUMANOID_BONES } from './HumanoidRig.js';
import { buildBindPose, invert4 } from './SkinPose.js';
import { composeTRS, multiply, quatFromAxisAngle, quatMul } from '../vehicle/VehicleMath.js';
import { skinPrimitiveInterleaved } from '../rig/RagdollSkinning.js';
import { createEngineMaterial } from '../material/EngineMaterial.js';
import { vec3Cross, vec3Sub, vec3Dot } from '../../core/math/MathVec3.js';

export const PROCEDURAL_HUMANOID_VERSION = '1.0.0';
export const PROCEDURAL_HUMANOID_ENUMS = Object.freeze({ sex: ['male', 'female'], build: ['slim', 'average', 'athletic', 'broad'],
    style: ['natural', 'stylized'], skinTone: ['light', 'medium', 'dark'], hairStyle: ['short', 'bob', 'none'] });
export const PROCEDURAL_HUMANOID_RANGES = Object.freeze({ heightMeters: [1.45, 2.10], massKg: [45, 160],
    shoulderScale: [.85, 1.15], hipScale: [.85, 1.15], limbScale: [.85, 1.15] });
const KEYS = [...Object.keys(PROCEDURAL_HUMANOID_ENUMS), ...Object.keys(PROCEDURAL_HUMANOID_RANGES)];
const SKIN = { light: [.72, .48, .34], medium: [.48, .27, .16], dark: [.20, .10, .065] };
const COLORS = { shirt: [.13, .31, .46], trousers: [.16, .20, .25], shoes: [.075, .07, .065], hair: [.055, .034, .025], eye: [.04, .025, .019] };
const unit = v => { const n = Math.hypot(...v); if (!(n > 1e-12)) throw new Error('Humanoid geometry has a zero direction'); return v.map(x => x / n); };
const mean = points => [0, 1, 2].map(i => points.reduce((n, p) => n + p[i], 0) / points.length);
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

export function normalizeProceduralHumanoidParameters(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Humanoid parameters must be an object');
    for (const key of Object.keys(value)) if (!KEYS.includes(key)) throw new TypeError(`Unknown humanoid parameter '${key}'`);
    const sex = value.sex ?? 'male';
    const p = { sex, heightMeters: sex === 'female' ? 1.65 : 1.75, massKg: sex === 'female' ? 62 : 75,
        build: 'average', style: 'natural', shoulderScale: 1, hipScale: 1, limbScale: 1, skinTone: 'medium', hairStyle: 'short', ...value };
    for (const [key, values] of Object.entries(PROCEDURAL_HUMANOID_ENUMS)) if (!values.includes(p[key])) throw new TypeError(`Humanoid ${key} must be one of ${values.join(', ')}`);
    for (const [key, [min, max]] of Object.entries(PROCEDURAL_HUMANOID_RANGES)) if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max) throw new RangeError(`Humanoid ${key} must be within ${min}..${max}`);
    return p;
}

function boundsOf(positions) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) { min[i % 3] = Math.min(min[i % 3], positions[i]); max[i % 3] = Math.max(max[i % 3], positions[i]); }
    const center = lerp(min, max, .5); return { min, max, center, radius: Math.hypot(...vec3Sub(max, center)) };
}

function skeleton(p) {
    const h = p.heightMeters, stylized = p.style === 'stylized', headBase = (stylized ? .82 : .875) * h;
    const shoulderY = (stylized ? .75 : .79) * h, hipY = .515 * h * p.limbScale;
    const bulk = { slim: .84, average: 1, athletic: 1.08, broad: 1.20 }[p.build];
    const shoulder = h * (p.sex === 'female' ? .112 : .128) * p.shoulderScale * (p.build === 'athletic' ? 1.06 : 1);
    const hip = h * (p.sex === 'female' ? .102 : .092) * p.hipScale * bulk;
    const slots = [], bySlot = new Map();
    const add = (slot, parentSlot, position, end, radius, depth = radius * 2, width = radius * 2) => {
        const record = { slot, nodeId: `node:${slots.length}`, jointIndex: slots.length, parentSlot,
            bindPosition: position, endPosition: end, radiusMeters: radius, depthMeters: depth, widthMeters: width };
        slots.push(record); bySlot.set(slot, record); return record;
    };
    const trunk = (shoulderY - hipY), spineY = hipY + trunk * .28, chestY = hipY + trunk * .60;
    add('hips', null, [0, hipY, 0], [0, spineY, 0], hip * .78, hip * 1.4, hip * 2);
    add('spine', 'hips', [0, spineY, 0], [0, chestY, 0], h * .064 * bulk, h * .13 * bulk, h * .16 * bulk);
    add('chest', 'spine', [0, chestY, 0], [0, shoulderY - .025 * h, 0], h * .079 * bulk, h * .15 * bulk, shoulder * 1.9);
    add('upperChest', 'chest', [0, shoulderY - .025 * h, 0], [0, shoulderY + .025 * h, 0], h * .072, h * .14 * bulk, shoulder * 1.9);
    add('neck', 'upperChest', [0, shoulderY + .025 * h, 0], [0, headBase + .02 * h, 0], h * .029, h * .059);
    add('head', 'neck', [0, headBase + .02 * h, 0], [0, h - .018 * h, 0], h * (stylized ? .085 : .060), h * (stylized ? .16 : .115));
    add('headTip', 'head', [0, h - .018 * h, 0], [0, h, 0], h * .012);
    for (const side of ['left', 'right']) {
        const s = side === 'left' ? 1 : -1, elbowX = shoulder + .158 * h * p.limbScale, wristX = elbowX + .139 * h * p.limbScale;
        const upper = [s * shoulder, shoulderY, 0], elbow = [s * elbowX, shoulderY, -.003 * h], wrist = [s * wristX, shoulderY, 0];
        add(`${side}Shoulder`, 'upperChest', [s * shoulder * .37, shoulderY, 0], upper, h * .022, h * .056);
        add(`${side}UpperArm`, `${side}Shoulder`, upper, elbow, h * .037 * bulk, h * .069 * bulk);
        add(`${side}LowerArm`, `${side}UpperArm`, elbow, wrist, h * .028 * bulk, h * .053 * bulk);
        add(`${side}Hand`, `${side}LowerArm`, wrist, [s * (wristX + .049 * h), shoulderY, 0], h * .019, h * .048);
        const legX = hip * .54, kneeY = hipY * .53, ankleY = h * .045;
        add(`${side}UpperLeg`, 'hips', [s * legX, hipY - .005 * h, 0], [s * legX, kneeY, -.008 * h], h * .050 * bulk, h * .096 * bulk);
        add(`${side}LowerLeg`, `${side}UpperLeg`, [s * legX, kneeY, -.008 * h], [s * legX, ankleY, 0], h * .034 * bulk, h * .064 * bulk);
        add(`${side}Foot`, `${side}LowerLeg`, [s * legX, ankleY, 0], [s * legX, h * .027, h * .065], h * .027, h * .125, h * .058 * bulk);
        add(`${side}Toes`, `${side}Foot`, [s * legX, h * .027, h * .065], [s * legX, h * .023, h * .102], h * .017, h * .06, h * .057 * bulk);
        add(`${side}ToeTip`, `${side}Toes`, [s * legX, h * .023, h * .102], [s * legX, h * .023, h * .109], h * .01);
        for (const [index, finger] of ['index', 'middle', 'ring', 'pinky', 'thumb'].entries()) {
            const thumb = finger === 'thumb', z = thumb ? -.024 * h : (-1.5 + index) * .012 * h;
            const start = [s * (wristX + (thumb ? .024 : .049) * h), shoulderY, z];
            const total = h * ({ index: .043, middle: .047, ring: .044, pinky: .034, thumb: .034 }[finger]);
            const direction = thumb ? [s * .65, 0, -.76] : [s, 0, (index - 1.5) * .05];
            let parent = `${side}Hand`;
            for (let k = 0; k < 4; k++) {
                const fraction = [0, .45, .74, 1][k], next = [0, .45, .74, 1][Math.min(3, k + 1)];
                const position = start.map((v, a) => v + direction[a] * total * fraction), end = start.map((v, a) => v + direction[a] * total * next);
                const slot = `${side}${finger[0].toUpperCase()}${finger.slice(1)}${['Proximal', 'Intermediate', 'Distal', 'Tip'][k]}`;
                add(slot, parent, position, end, h * (thumb ? .0065 : .0052) * (1 - k * .13)); parent = slot;
            }
        }
    }
    return { slots, bySlot, h, shoulder, hip, hipY, shoulderY, headBase, bulk };
}

/** Ring lofts share boundary vertex indices at every branch. Skin weights are
 * assigned within anatomical chains, so a close opposite leg never steals them. */
class Surface {
    constructor(p, rig) { this.p = p; this.rig = rig; this.positions = []; this.indices = []; this.uvs = []; this.colors = []; this.joints = []; this.weights = []; }
    point(position, chain, color = 'skin') {
        const index = this.positions.length / 3; this.positions.push(...position);
        this.uvs.push(.5 + position[0] / (this.p.heightMeters * 2), position[1] / this.p.heightMeters);
        this.colors.push(...(color === 'skin' ? SKIN[this.p.skinTone] : COLORS[color]), 1);
        const candidates = chain.map(slot => this.rig.bySlot.get(slot)).filter(Boolean).map(bone => ({ bone, d: Math.hypot(...vec3Sub(position, bone.bindPosition)) }));
        candidates.sort((a, b) => a.d - b.d); const selected = candidates.slice(0, 4), raw = selected.map(v => 1 / Math.max(v.d, this.p.heightMeters * .006) ** 3), total = raw.reduce((a, b) => a + b, 0);
        for (let i = 0; i < 4; i++) { this.joints.push(selected[i]?.bone.jointIndex ?? selected[0].bone.jointIndex); this.weights.push(i < selected.length ? raw[i] / total : 0); }
        return index;
    }
    position(id) { return this.positions.slice(id * 3, id * 3 + 3); }
    ring(center, u, v, radiusU, radiusV, count, chain, color = 'skin') {
        return Array.from({ length: count }, (_, i) => { const a = i / count * Math.PI * 2;
            return this.point(center.map((x, j) => x + u[j] * Math.cos(a) * radiusU + v[j] * Math.sin(a) * radiusV), chain, color); });
    }
    triangle(a, b, c, outward) {
        const normal = vec3Cross(vec3Sub(this.position(b), this.position(a)), vec3Sub(this.position(c), this.position(a)));
        if (Math.hypot(...normal) < 1e-12) return;
        if (outward && vec3Dot(normal, outward) < 0) [b, c] = [c, b]; this.indices.push(a, b, c);
    }
    bridge(a, b) {
        const ca = mean(a.map(i => this.position(i))), cb = mean(b.map(i => this.position(i)));
        // Cross-section bases can change at a wrist, ankle or branch opening.
        // Match their actual perimeter directions before stitching; otherwise a
        // 90-degree index-phase difference twists a perfectly valid closed tube.
        let best = null, bestError = Infinity;
        for (const direction of [1, -1]) for (let offset = 0; offset < b.length; offset++) {
            const candidate = b.map((_, k) => b[(offset + direction * k + b.length * 2) % b.length]); let error = 0;
            for (let k = 0; k < a.length; k++) { const pa = vec3Sub(this.position(a[k]), ca), pb = vec3Sub(this.position(candidate[Math.floor(k * b.length / a.length)]), cb); error += vec3Dot(vec3Sub(pa, pb), vec3Sub(pa, pb)); }
            if (error < bestError) { bestError = error; best = candidate; }
        }
        b = best;
        let i = 0, j = 0;
        while (i < a.length || j < b.length) {
            const an = (i + 1) / a.length, bn = (j + 1) / b.length;
            const tri = an < bn - 1e-10 ? [a[i % a.length], b[j % b.length], a[(++i) % a.length]]
                : bn < an - 1e-10 ? [a[i % a.length], b[j % b.length], b[(++j) % b.length]] : null;
            if (tri) this.triangle(...tri, vec3Sub(mean(tri.map(k => this.position(k))), lerp(ca, cb, .5)));
            else { const ai = a[i % a.length], bi = b[j % b.length], aj = a[(i + 1) % a.length], bj = b[(j + 1) % b.length];
                this.triangle(ai, bi, bj, vec3Sub(mean([ai, bi, bj].map(k => this.position(k))), lerp(ca, cb, .5)));
                this.triangle(ai, bj, aj, vec3Sub(mean([ai, bj, aj].map(k => this.position(k))), lerp(ca, cb, .5))); i++; j++; }
        }
    }
    cap(ring, center, outward, chain, color) { const id = this.point(center, chain, color); for (let i = 0; i < ring.length; i++) this.triangle(id, ring[i], ring[(i + 1) % ring.length], outward); }
    tube(root, stations, direction, chain, color = 'skin') {
        const axis = unit(direction), u = Math.abs(axis[1]) < .9 ? [0, 1, 0] : [1, 0, 0], v = unit(vec3Cross(u, axis)); let ring = root;
        for (const station of stations) { const next = this.ring(station.center, u, v, station.radius, station.depth ?? station.radius, root.length, chain, color); this.bridge(ring, next); ring = next; }
        return ring;
    }
    finish() {
        // Removed shoulder patches leave interior grid points unused. Compact
        // them once so every exported vertex belongs to the indexed surface.
        const used = new Set(this.indices), remap = new Map(), arrays = { positions: [], uvs: [], colors: [], joints: [], weights: [] };
        for (let index = 0; index < this.positions.length / 3; index++) if (used.has(index)) {
            remap.set(index, arrays.positions.length / 3);
            for (const [name, width] of [['positions', 3], ['uvs', 2], ['colors', 4], ['joints', 4], ['weights', 4]]) arrays[name].push(...this[name].slice(index * width, index * width + width));
        }
        for (const [name, values] of Object.entries(arrays)) this[name] = values;
        this.indices = this.indices.map(index => remap.get(index));
        // Concave branch junctions cannot use a radial normal to choose winding.
        // Propagate orientation over actual shared edges, then choose the exterior
        // from signed volume. This also fails closed on a missing/nonmanifold edge.
        const edgeFaces = new Map(), triangles = this.indices.length / 3;
        for (let face = 0; face < triangles; face++) for (let corner = 0; corner < 3; corner++) {
            const a = this.indices[face * 3 + corner], b = this.indices[face * 3 + (corner + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`;
            if (!edgeFaces.has(key)) edgeFaces.set(key, []); edgeFaces.get(key).push({ face, direction: a < b ? 1 : -1 });
        }
        const neighbors = Array.from({ length: triangles }, () => []);
        for (const edge of edgeFaces.values()) { if (edge.length !== 2) throw new Error('Humanoid body has a nonmanifold branch edge');
            neighbors[edge[0].face].push({ face: edge[1].face, relation: -edge[0].direction * edge[1].direction });
            neighbors[edge[1].face].push({ face: edge[0].face, relation: -edge[0].direction * edge[1].direction }); }
        const orientation = new Int8Array(triangles), queue = [0]; orientation[0] = 1;
        for (let cursor = 0; cursor < queue.length; cursor++) for (const neighbor of neighbors[queue[cursor]]) {
            const direction = orientation[queue[cursor]] * neighbor.relation;
            if (!orientation[neighbor.face]) { orientation[neighbor.face] = direction; queue.push(neighbor.face); }
            else if (orientation[neighbor.face] !== direction) throw new Error('Humanoid body is not consistently orientable');
        }
        if (queue.length !== triangles) throw new Error('Humanoid body has a detached surface');
        for (let face = 0; face < triangles; face++) if (orientation[face] < 0) [this.indices[face * 3 + 1], this.indices[face * 3 + 2]] = [this.indices[face * 3 + 2], this.indices[face * 3 + 1]];
        let volume = 0; for (let face = 0; face < triangles; face++) { const a = this.position(this.indices[face * 3]), b = this.position(this.indices[face * 3 + 1]), c = this.position(this.indices[face * 3 + 2]); volume += vec3Dot(a, vec3Cross(b, c)) / 6; }
        if (!Number.isFinite(volume) || Math.abs(volume) < 1e-9) throw new Error('Humanoid body has no finite enclosed volume');
        if (volume < 0) for (let face = 0; face < triangles; face++) [this.indices[face * 3 + 1], this.indices[face * 3 + 2]] = [this.indices[face * 3 + 2], this.indices[face * 3 + 1]];
        const normals = new Float32Array(this.positions.length);
        for (let i = 0; i < this.indices.length; i += 3) { const ids = this.indices.slice(i, i + 3), n = vec3Cross(vec3Sub(this.position(ids[1]), this.position(ids[0])), vec3Sub(this.position(ids[2]), this.position(ids[0])));
            for (const id of ids) for (let a = 0; a < 3; a++) normals[id * 3 + a] += n[a]; }
        for (let i = 0; i < normals.length; i += 3) { const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]); if (length < 1e-12) throw new Error(`Humanoid vertex ${i / 3} has no surface normal`); for (let a = 0; a < 3; a++) normals[i + a] /= length; }
        return { positions: new Float32Array(this.positions), normals, uvs: new Float32Array(this.uvs), colors: new Float32Array(this.colors),
            indices: new Uint32Array(this.indices), joints: new Uint16Array(this.joints), weights: new Float32Array(this.weights), bounds: boundsOf(this.positions) };
    }
}

function buildBody(p, rig) {
    const { h, hip, hipY, shoulderY, shoulder, headBase, bulk } = rig, surface = new Surface(p, rig);
    const torsoChain = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head'];
    const levels = [hipY - .025 * h, hipY + .015 * h, hipY + (shoulderY - hipY) * .30,
        hipY + (shoulderY - hipY) * .57, shoulderY - .065 * h, shoulderY - .030 * h, shoulderY + .005 * h, shoulderY + .027 * h, headBase];
    const waist = h * (p.sex === 'female' ? .074 : .080) * bulk;
    const radii = [hip, hip * 1.01, waist, shoulder * .88, shoulder, shoulder, shoulder * .87, h * .034, h * .034];
    const depths = [hip * .72, hip * .74, h * .060 * bulk, h * .074 * bulk, h * .073 * bulk, h * .069 * bulk, h * .060, h * .030, h * .029];
    const rings = levels.map((y, i) => surface.ring([0, y, 0], [1, 0, 0], [0, 0, 1], radii[i], depths[i], 16, torsoChain, i < 2 ? 'trousers' : i < 7 ? 'shirt' : 'skin'));
    for (let band = 0; band < rings.length - 1; band++) for (let a = 0; a < 16; a++) {
        if ((band === 4 || band === 5) && (a >= 14 || a <= 1 || a >= 6 && a <= 9)) continue;
        const b = (a + 1) % 16, outward = [Math.cos((a + .5) / 16 * Math.PI * 2), 0, Math.sin((a + .5) / 16 * Math.PI * 2)];
        surface.triangle(rings[band][a], rings[band + 1][a], rings[band + 1][b], outward);
        surface.triangle(rings[band][a], rings[band + 1][b], rings[band][b], outward);
    }
    // Neck and face continue the torso surface. Nose, brow and jaw are shaped
    // directly in the shared rings, so they remain attached in every pose.
    let top = rings.at(-1); const stylized = p.style === 'stylized', faceHeight = h - headBase, headWidth = h * (stylized ? .086 : .061), headDepth = h * (stylized ? .073 : .055);
    const headStations = [[.06, .56, .60], [.20, .82, .79], [.36, .96, .96], [.52, 1, 1], [.68, .98, .98], [.84, .82, .85], [.96, .39, .43]];
    for (const [t, x, z] of headStations) {
        const ring = surface.ring([0, headBase + t * faceHeight, .004 * h], [1, 0, 0], [0, 0, 1], headWidth * x, headDepth * z, 32, ['neck', 'head'], 'skin');
        for (let i = 0; i < ring.length; i++) { const angle = i / 32 * Math.PI * 2, front = Math.max(0, Math.sin(angle));
            if (t >= .20 && t <= .52) surface.positions[ring[i] * 3 + 2] += h * .012 * front ** 12 * (t === .36 ? 1 : .35);
            const hair = p.hairStyle === 'short' ? t >= .68 && (front < .78 || t >= .84)
                : p.hairStyle === 'bob' ? t >= .20 && (front < .70 || t >= .84) : false;
            if (hair) { surface.colors.splice(ring[i] * 4, 3, ...COLORS.hair); surface.positions[ring[i] * 3] += Math.cos(angle) * h * (p.hairStyle === 'bob' ? .009 : .003);
                surface.positions[ring[i] * 3 + 2] += Math.sin(angle) * h * (p.hairStyle === 'bob' ? .010 : .003); }
            if (t === .52 && (i === 6 || i === 10)) surface.colors.splice(ring[i] * 4, 3, ...COLORS.eye);
        }
        surface.bridge(top, ring); top = ring;
    }
    surface.cap(top, [0, h, .004 * h], [0, 1, 0], ['head'], p.hairStyle === 'none' ? 'skin' : 'hair');
    for (const side of ['left', 'right']) {
        const s = side === 'left' ? 1 : -1, arm = [`${side}Shoulder`, `${side}UpperArm`, `${side}LowerArm`, `${side}Hand`];
        const arc = side === 'left' ? [14, 15, 0, 1, 2] : [6, 7, 8, 9, 10];
        const hole = [...arc.map(a => rings[4][a]), rings[5][arc.at(-1)], ...[...arc].reverse().map(a => rings[6][a]), rings[5][arc[0]]];
        const upper = rig.bySlot.get(`${side}UpperArm`), lower = rig.bySlot.get(`${side}LowerArm`), hand = rig.bySlot.get(`${side}Hand`);
        const armEnd = surface.tube(hole, [
            { center: [s * (shoulder + .018 * h), shoulderY, 0], radius: .038 * h * bulk, depth: .035 * h * bulk },
            { center: lerp(upper.bindPosition, lower.bindPosition, .45), radius: .036 * h * bulk, depth: .031 * h * bulk },
            { center: lower.bindPosition, radius: .026 * h * bulk, depth: .025 * h * bulk },
            { center: lerp(lower.bindPosition, hand.bindPosition, .45), radius: .027 * h * bulk, depth: .023 * h * bulk },
            { center: hand.bindPosition, radius: .017 * h, depth: .020 * h },
        ], [s, 0, 0], arm, 'skin');
        buildPalm(surface, rig, side, armEnd);
        const legChain = ['hips', `${side}UpperLeg`, `${side}LowerLeg`, `${side}Foot`, `${side}Toes`];
        const legArc = side === 'left' ? [12, 13, 14, 15, 0, 1, 2, 3, 4] : [4, 5, 6, 7, 8, 9, 10, 11, 12];
        const upperLeg = rig.bySlot.get(`${side}UpperLeg`), lowerLeg = rig.bySlot.get(`${side}LowerLeg`), foot = rig.bySlot.get(`${side}Foot`);
        let end = surface.tube(legArc.map(a => rings[0][a]), [
            { center: [upperLeg.bindPosition[0], hipY - .070 * h, 0], radius: .047 * h * bulk, depth: .050 * h * bulk },
            { center: lerp(upperLeg.bindPosition, lowerLeg.bindPosition, .55), radius: .044 * h * bulk, depth: .043 * h * bulk },
            { center: lowerLeg.bindPosition, radius: .031 * h * bulk, depth: .032 * h * bulk },
            { center: lerp(lowerLeg.bindPosition, foot.bindPosition, .45), radius: .033 * h * bulk, depth: .034 * h * bulk },
            { center: foot.bindPosition, radius: .022 * h, depth: .024 * h },
        ], [0, -1, 0], legChain, 'trousers');
        const toe = rig.bySlot.get(`${side}Toes`), shoeCenter = [foot.bindPosition[0], h * .026, h * .018];
        // Turn the surface onto the foot; the soles terminate exactly on y=0.
        const footRing = surface.ring(shoeCenter, [1, 0, 0], [0, 1, 0], .030 * h * bulk, .026 * h, 12, [`${side}Foot`, `${side}Toes`], 'shoes'); surface.bridge(end, footRing);
        end = surface.tube(footRing, [{ center: toe.bindPosition, radius: .025 * h, depth: .030 * h * bulk },
            { center: [foot.bindPosition[0], h * .025, h * .105], radius: .023 * h, depth: .027 * h * bulk }], [0, 0, 1], [`${side}Foot`, `${side}Toes`], 'shoes');
        surface.cap(end, [foot.bindPosition[0], h * .025, h * .111], [0, 0, 1], [`${side}Toes`], 'shoes');
    }
    return surface.finish();
}

function buildPalm(surface, rig, side, wristRing) {
    const { h, shoulderY } = rig, s = side === 'left' ? 1 : -1, hand = rig.bySlot.get(`${side}Hand`), wristX = Math.abs(hand.bindPosition[0]);
    const chain = [`${side}LowerArm`, `${side}Hand`], halfY = .010 * h, halfZ = .024 * h;
    const rectangle = x => { const top = [], bottom = []; for (let i = 0; i < 5; i++) { const z = -halfZ + i * halfZ / 2;
        top.push(surface.point([s * x, shoulderY + halfY, z], chain)); bottom.push(surface.point([s * x, shoulderY - halfY, z], chain)); }
        const positive = surface.point([s * x, shoulderY, halfZ], chain), negative = surface.point([s * x, shoulderY, -halfZ], chain);
        return { top, bottom, positive, negative, ring: [...top, positive, ...[...bottom].reverse(), negative] }; };
    const root = rectangle(wristX + .012 * h), end = rectangle(wristX + .049 * h); surface.bridge(wristRing, root.ring);
    // Top, bottom and positive side close the palm. Its negative side is the
    // actual opening for the thumb, and the distal face branches into fingers.
    for (let i = 0; i < 4; i++) for (const [face, outward] of [['top', [0, 1, 0]], ['bottom', [0, -1, 0]]]) {
        const a = root[face][i], b = end[face][i], c = end[face][i + 1], d = root[face][i + 1]; surface.triangle(a, b, c, outward); surface.triangle(a, c, d, outward); }
    for (const [a, b] of [[root.top[4], root.positive], [root.positive, root.bottom[4]]]) {
        const c = a === root.top[4] ? end.top[4] : end.positive, d = b === root.positive ? end.positive : end.bottom[4];
        surface.triangle(a, c, d, [0, 0, 1]); surface.triangle(a, d, b, [0, 0, 1]); }
    const thumbHole = [root.top[0], end.top[0], end.negative, end.bottom[0], root.bottom[0], root.negative];
    for (const [index, finger] of ['index', 'middle', 'ring', 'pinky', 'thumb'].entries()) {
        const name = finger[0].toUpperCase() + finger.slice(1), slots = ['Proximal', 'Intermediate', 'Distal', 'Tip'].map(j => `${side}${name}${j}`);
        const first = rig.bySlot.get(slots[0]), last = rig.bySlot.get(slots[3]), thumb = finger === 'thumb';
        const rootRing = thumb ? thumbHole : index === 0 ? [end.top[0], end.top[1], end.bottom[1], end.bottom[0], end.negative]
            : index === 3 ? [end.top[3], end.top[4], end.positive, end.bottom[4], end.bottom[3]]
                : [end.top[index], end.top[index + 1], end.bottom[index + 1], end.bottom[index]];
        const direction = vec3Sub(last.bindPosition, first.bindPosition), stages = slots.slice(1).map((slot, i) => ({ center: rig.bySlot.get(slot).bindPosition,
            radius: first.radiusMeters * [1, .82, .55][i], depth: first.radiusMeters * [.90, .79, .55][i] }));
        const lastRing = surface.tube(rootRing, stages, direction, [`${side}Hand`, ...slots.slice(0, 3)], 'skin');
        surface.cap(lastRing, last.bindPosition.map((v, a) => v + unit(direction)[a] * first.radiusMeters * .35), unit(direction), [slots[2]], 'skin');
    }
}

export function createProceduralHumanoid(parameters = {}, { id = 'procedural-humanoid', meshPartId = 'humanoid-body' } = {}) {
    const p = normalizeProceduralHumanoidParameters(parameters), rig = skeleton(p), mesh = buildBody(p, rig);
    const nodes = rig.slots.map(b => { const parent = b.parentSlot ? rig.bySlot.get(b.parentSlot) : null;
        return createEngineNode({ id: b.nodeId, name: b.slot, parent: parent?.nodeId ?? null, translation: parent ? vec3Sub(b.bindPosition, parent.bindPosition) : [...b.bindPosition],
            children: rig.slots.filter(child => child.parentSlot === b.slot).map(child => child.nodeId) }); });
    const meshId = `${id}:mesh`, primitiveId = `${id}:body`, skinId = `${id}:skin`;
    nodes.push(createEngineNode({ id: `node:${nodes.length}`, name: meshPartId, mesh: meshId, skin: skinId }));
    const primitive = createEnginePrimitive({ id: primitiveId, mesh: meshId, material: `${id}:material`, vertexCount: mesh.positions.length / 3,
        attributes: { position: mesh.positions, normal: mesh.normals, uv0: mesh.uvs, color: mesh.colors, joints: mesh.joints, weights: mesh.weights }, indices: mesh.indices, bounds: mesh.bounds });
    const joints = rig.slots.map(b => b.jointIndex), model = createEngineModel({ id, name: `${p.style === 'stylized' ? 'Stylized' : 'Natural'} adult ${p.sex === 'female' ? 'woman' : 'man'}`,
        sourceFormat: 'procedural-humanoid', nodes, meshes: [createEngineMesh({ id: meshId, primitives: [primitiveId], bounds: mesh.bounds })], primitives: [primitive],
        materials: [createEngineMaterial({ id: `${id}:material`, name: 'Procedural avatar colours', baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: .8 })],
        bounds: mesh.bounds, metadata: { proceduralHumanoid: { schemaVersion: 1, generatorVersion: PROCEDURAL_HUMANOID_VERSION, parameters: p,
            meshPartId, boneSlots: rig.slots, bodyBounds: mesh.bounds, topology: 'connected-indexed-body', fidelity: 'basic-procedural-avatar' } } });
    const bind = buildBindPose(model), inverseBindMatrices = new Float32Array(joints.length * 16);
    for (const joint of joints) { const inverse = invert4(bind.get(`node:${joint}`)); if (!inverse) throw new Error(`Humanoid joint ${joint} has a singular bind transform`); inverseBindMatrices.set(inverse, joint * 16); }
    model.skins = [{ id: skinId, joints, raw: { joints: [...joints], skeleton: 0 }, jointCount: joints.length, inverseBindMatrices }];
    model.skeletons = [{ id: `${id}:skeleton`, joints: [...joints], skeletonRoot: 'node:0' }];
    buildHumanoidRig(model);
    model.rigs.humanoid.bones = Object.fromEntries(HUMANOID_BONES.map(slot => [slot, rig.bySlot.get(slot).nodeId]));
    model.rigs.humanoid.unmapped = [];
    buildHands(model);
    // BoneMapper's broad head/hand patterns can classify finger/head-tip names
    // as extra candidates; the authored canonical map is exact and sufficient.
    model.rigs.humanoid.source = 'procedural'; model.rigs.humanoid.metadata.generatorVersion = PROCEDURAL_HUMANOID_VERSION;
    return { model, mesh, boneSlots: rig.slots, parameters: p };
}

/** Evaluate exact authored node hierarchy and Engine four-weight skinning.
 * Unspecified finger/tip nodes inherit the overridden physical parent matrix. */
export function deformProceduralHumanoid(model, { nodeWorld = new Map() } = {}) {
    if (!model?.metadata?.proceduralHumanoid || !(nodeWorld instanceof Map)) throw new TypeError('A generated humanoid model and nodeWorld Map are required');
    const byId = new Map(model.nodes.map(n => [n.id, n])), world = new Map(), visit = node => {
        if (world.has(node.id)) return world.get(node.id);
        const override = nodeWorld.get(node.id); if (override) { if (override.length !== 16 || Array.from(override).some(v => !Number.isFinite(v))) throw new TypeError(`Invalid humanoid world matrix for '${node.id}'`); world.set(node.id, new Float32Array(override)); return world.get(node.id); }
        const local = composeTRS(node.translation, node.rotation, node.scale), parent = node.parent ? byId.get(node.parent) : null;
        const matrix = parent ? multiply(visit(parent), local) : local; world.set(node.id, matrix); return matrix;
    }; model.nodes.forEach(visit);
    const bind = buildBindPose(model), skin = model.skins[0], frames = { R: [], pos: [], bind: [] };
    for (const index of skin.joints) { const current = world.get(`node:${index}`), rest = bind.get(`node:${index}`), relative = multiply(current, invert4(rest));
        frames.R.push([relative[0], relative[4], relative[8], relative[1], relative[5], relative[9], relative[2], relative[6], relative[10]]);
        frames.pos.push([current[12], current[13], current[14]]); frames.bind.push([rest[12], rest[13], rest[14]]); }
    const primitive = model.primitives[0], vertices = new Float32Array(primitive.vertexCount * 8);
    for (let i = 0; i < primitive.vertexCount; i++) { vertices[i * 8 + 6] = primitive.attributes.uv0[i * 2]; vertices[i * 8 + 7] = primitive.attributes.uv0[i * 2 + 1]; }
    skinPrimitiveInterleaved(primitive, frames, skin.jointCount, vertices); return { frames, vertices, nodeWorld: world };
}

/** Authored pose preview, independent of ragdoll state. Never changes bind data. */
export function sampleProceduralHumanoidPose(model, { kind = 'idle', timeSeconds = 0 } = {}) {
    if (!['idle', 'walk', 'sit', 't-pose'].includes(kind) || !Number.isFinite(timeSeconds)) throw new TypeError('Unknown humanoid pose or nonfinite time');
    const wave = Math.sin(timeSeconds * Math.PI * 2), rotations = new Map(), bones = model.rigs.humanoid.bones;
    for (const side of ['left', 'right']) {
        const sign = side === 'left' ? 1 : -1;
        if (kind !== 't-pose') rotations.set(bones[`${side}UpperArm`], quatMul(quatFromAxisAngle([1, 0, 0], kind === 'walk' ? -sign * wave * .28 : 0), quatFromAxisAngle([0, 0, 1], -sign * 1.30)));
        if (kind === 'walk' || kind === 'sit') { rotations.set(bones[`${side}UpperLeg`], quatFromAxisAngle([1, 0, 0], kind === 'sit' ? -Math.PI / 2 : sign * wave * .40));
            rotations.set(bones[`${side}LowerLeg`], quatFromAxisAngle([1, 0, 0], kind === 'sit' ? Math.PI / 2 : Math.max(0, -sign * wave) * .63)); }
    }
    const world = new Map(), byId = new Map(model.nodes.map(n => [n.id, n])), visit = node => {
        if (world.has(node.id)) return world.get(node.id); const parent = node.parent ? byId.get(node.parent) : null;
        const matrix = composeTRS(node.translation, rotations.get(node.id) ?? node.rotation, node.scale), result = parent ? multiply(visit(parent), matrix) : matrix;
        world.set(node.id, result); return result; }; model.nodes.forEach(visit); return deformProceduralHumanoid(model, { nodeWorld: world });
}
