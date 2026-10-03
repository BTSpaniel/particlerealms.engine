// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { cloneStrictJson } from '../../../../../engine/core/schema/StrictJsonValue.js';
import { vec3Add, vec3Sub, vec3Scale, vec3Dot, vec3Cross, vec3Normalize, vec3Length, vec3Lerp, vec3RotateAxis } from '../../../../../engine/core/math/MathVec3.js';

const MODES = ['orbit', 'world', 'panorama'];
const KINDS = ['image-relief', 'panorama', 'captured', 'procedural'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const radians = value => value * Math.PI / 180;
function shape(value, keys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) throw new TypeError(`${label} requires exactly ${keys.join(', ')}`);
}
function scalar(value, min, max, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new TypeError(`${label} must be finite in [${min}, ${max}]`);
    return value;
}
function vector(value, label) {
    if (!Array.isArray(value) || value.length !== 3) throw new TypeError(`${label} needs three coordinates`);
    return value.map(number => scalar(number, -1e7, 1e7, label));
}
function eyeFor(rig, position = rig.position) { return vec3Add(position, vec3Scale(rig.up, rig.eyeHeight)); }
function validDirection(position, target, up, label) {
    const direction = vec3Sub(target, position);
    if (vec3Length(direction) < 1e-6 || vec3Length(vec3Cross(up, vec3Normalize(direction))) < 1e-6) throw new TypeError(`${label} must look away from its eye and not parallel to up`);
}
function inside(eye, bounds) { return !bounds || eye.every((value, axis) => value >= bounds.min[axis] && value <= bounds.max[axis]); }

/** Optional, data-only camera. Position is its base; eyeHeight offsets along up. */
export function createSpatialCameraRig(overrides = {}) {
    const input = cloneStrictJson(overrides, '$.cameraRig');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Camera rig overrides must be a data record');
    const mode = input.mode ?? 'world', kind = input.source?.kind ?? (mode === 'panorama' ? 'panorama' : 'captured');
    const defaults = { version: 1, mode, position: [0, 0, 0], target: [0, 0, 3.4], up: [0, 1, 0], unitScale: 1, eyeHeight: 0,
        near: .05, far: 100, bounds: null, intrinsics: null, path: null,
        source: { kind, confidence: kind === 'image-relief' ? .5 : 1, maxTranslation: kind === 'panorama' ? 0 : kind === 'image-relief' ? .15 : 100,
            maxYaw: kind === 'image-relief' ? 18 : 180, maxPitch: kind === 'image-relief' ? 12 : 85 },
        movement: { enabled: true, speed: 1.5, lookSensitivity: 90, dollySensitivity: .25 } };
    return normalizeSpatialCameraRig({ ...defaults, ...input, source: { ...defaults.source, ...input.source }, movement: { ...defaults.movement, ...input.movement } });
}

export function normalizeSpatialCameraRig(value) {
    const rig = cloneStrictJson(value, '$.cameraRig');
    shape(rig, ['version', 'mode', 'position', 'target', 'up', 'unitScale', 'eyeHeight', 'near', 'far', 'bounds', 'intrinsics', 'path', 'source', 'movement'], 'Camera rig');
    if (rig.version !== 1 || !MODES.includes(rig.mode)) throw new TypeError('Unsupported camera rig version or mode');
    rig.position = vector(rig.position, 'Camera base position'); rig.target = vector(rig.target, 'Camera target'); rig.up = vector(rig.up, 'Camera up');
    const upLength = vec3Length(rig.up); if (upLength < 1e-6 || Math.abs(upLength - 1) > 1e-4) throw new TypeError('Camera up must be a unit vector');
    scalar(rig.unitScale, .000001, 1000000, 'Camera metres per scene unit'); scalar(rig.eyeHeight, -10000, 10000, 'Eye height');
    scalar(rig.near, .000001, 100000, 'Camera near'); scalar(rig.far, .000002, 10000000, 'Camera far');
    if (rig.far <= rig.near) throw new TypeError('Camera far must exceed near');
    if (rig.bounds !== null) {
        shape(rig.bounds, ['min', 'max'], 'Camera bounds'); rig.bounds.min = vector(rig.bounds.min, 'Camera bounds min'); rig.bounds.max = vector(rig.bounds.max, 'Camera bounds max');
        if (rig.bounds.min.some((value, axis) => value >= rig.bounds.max[axis])) throw new TypeError('Camera bounds need positive extents');
    }
    shape(rig.source, ['kind', 'confidence', 'maxTranslation', 'maxYaw', 'maxPitch'], 'Camera source coverage');
    if (!KINDS.includes(rig.source.kind)) throw new TypeError('Unsupported camera source kind');
    scalar(rig.source.confidence, 0, 1, 'Camera source confidence'); scalar(rig.source.maxTranslation, 0, 1000000, 'Camera translation envelope');
    scalar(rig.source.maxYaw, 0, 180, 'Camera yaw envelope'); scalar(rig.source.maxPitch, 0, 85, 'Camera pitch envelope');
    if (rig.mode === 'panorama' && rig.source.kind !== 'panorama') throw new TypeError('Panorama camera requires a panorama source');
    if (rig.source.kind === 'panorama' && (rig.mode !== 'panorama' || rig.source.maxTranslation !== 0)) throw new TypeError('Panorama cameras rotate without translation');
    shape(rig.movement, ['enabled', 'speed', 'lookSensitivity', 'dollySensitivity'], 'Camera movement');
    if (typeof rig.movement.enabled !== 'boolean') throw new TypeError('Camera movement enabled must be boolean');
    scalar(rig.movement.speed, 0, 1000, 'Camera speed'); scalar(rig.movement.lookSensitivity, 0, 720, 'Camera look sensitivity'); scalar(rig.movement.dollySensitivity, 0, 100, 'Camera dolly sensitivity');
    if (rig.intrinsics !== null) {
        shape(rig.intrinsics, ['fx', 'fy', 'cx', 'cy', 'width', 'height'], 'Camera intrinsics');
        for (const key of ['fx', 'fy']) scalar(rig.intrinsics[key], .000001, 1e7, `Camera ${key}`);
        for (const key of ['width', 'height']) { scalar(rig.intrinsics[key], 1, 65536, `Camera ${key}`); if (!Number.isInteger(rig.intrinsics[key])) throw new TypeError('Camera image dimensions must be integers'); }
        scalar(rig.intrinsics.cx, -65536, 65536, 'Camera cx'); scalar(rig.intrinsics.cy, -65536, 65536, 'Camera cy');
        if (rig.mode === 'panorama') throw new TypeError('Panorama look uses a viewer lens, not source pinhole intrinsics');
    }
    const eye = eyeFor(rig); validDirection(eye, rig.target, rig.up, 'Camera');
    if (!inside(eye, rig.bounds)) throw new TypeError('Saved camera eye is outside its bounds');
    if (rig.path !== null) {
        shape(rig.path, ['duration', 'loop', 'keyframes'], 'Camera path'); scalar(rig.path.duration, .01, 86400, 'Camera path duration');
        if (typeof rig.path.loop !== 'boolean' || !Array.isArray(rig.path.keyframes) || rig.path.keyframes.length < 2 || rig.path.keyframes.length > 64) throw new TypeError('Camera path needs 2–64 ordered keyframes');
        let previous = -1;
        for (const keyframe of rig.path.keyframes) {
            shape(keyframe, ['time', 'position', 'target'], 'Camera keyframe'); scalar(keyframe.time, 0, rig.path.duration, 'Camera keyframe time');
            if (keyframe.time <= previous) throw new TypeError('Camera path times must increase'); previous = keyframe.time;
            keyframe.position = vector(keyframe.position, 'Camera path position'); keyframe.target = vector(keyframe.target, 'Camera path target');
            const frameEye = eyeFor(rig, keyframe.position); validDirection(frameEye, keyframe.target, rig.up, 'Camera keyframe');
            if (!inside(frameEye, rig.bounds)) throw new TypeError('Camera path leaves its bounds');
            if (vec3Length(vec3Sub(keyframe.position, rig.position)) > rig.source.maxTranslation + 1e-8) throw new TypeError('Camera path leaves its source translation envelope');
            if (rig.mode === 'panorama' && vec3Length(vec3Sub(keyframe.position, rig.position)) > 1e-8) throw new TypeError('Panorama paths cannot translate');
        }
        const frames = rig.path.keyframes, first = frames[0], last = frames.at(-1);
        if (first.time !== 0 || last.time !== rig.path.duration) throw new TypeError('Camera path must start at zero and end at duration');
        if (rig.path.loop && (vec3Length(vec3Sub(first.position, last.position)) > 1e-8 || vec3Length(vec3Sub(first.target, last.target)) > 1e-8)) throw new TypeError('Looped camera path must close its pose');
        for (let i = 1; i < frames.length; i++) {
            const a = vec3Sub(frames[i - 1].target, eyeFor(rig, frames[i - 1].position)), b = vec3Sub(frames[i].target, eyeFor(rig, frames[i].position)), delta = vec3Sub(b, a), length = vec3Dot(delta, delta), t = length ? clamp(-vec3Dot(a, delta) / length, 0, 1) : 0;
            validDirection([0, 0, 0], vec3Lerp(a, b, t), rig.up, 'Interpolated camera path');
            const ah = vec3Sub(a, vec3Scale(rig.up, vec3Dot(a, rig.up))), bh = vec3Sub(b, vec3Scale(rig.up, vec3Dot(b, rig.up))), dh = vec3Sub(bh, ah), hl = vec3Dot(dh, dh), ht = hl ? clamp(-vec3Dot(ah, dh) / hl, 0, 1) : 0;
            if (vec3Length(vec3Lerp(ah, bh, ht)) < 1e-6) throw new TypeError('Interpolated camera path looks parallel to up');
        }
    }
    return rig;
}

export function sampleSpatialCameraPath(rig, time = 0) {
    scalar(time, -1e12, 1e12, 'Camera path time');
    if (!rig.path) return { position: [...rig.position], target: [...rig.target] };
    const path = rig.path, t = path.loop ? ((time % path.duration) + path.duration) % path.duration : clamp(time, 0, path.duration), frames = path.keyframes;
    let index = frames.findIndex(frame => frame.time >= t); if (index < 0) index = frames.length - 1;
    const a = frames[Math.max(0, index - 1)], b = frames[index], u = a === b ? 0 : (t - a.time) / (b.time - a.time), ease = u * u * (3 - 2 * u);
    return { position: vec3Lerp(a.position, b.position, ease), target: vec3Lerp(a.target, b.target, ease) };
}

/** Matches the existing normalized image projection; calibrated lens stays saved. */
export function spatialCameraRigFor(settings, aspect, sourceAspect = aspect) {
    const rig = settings.cameraRig, pose = sampleSpatialCameraPath(rig, settings.cameraTime ?? 0), eye = eyeFor(rig, pose.position), target = pose.target;
    const forward = vec3Normalize(vec3Sub(target, eye)), right = vec3Normalize(vec3Cross(rig.up, forward)), up = vec3Cross(forward, right);
    const lens = rig.intrinsics, imageAspect = lens ? lens.width / lens.height : sourceAspect;
    const fit = rig.mode === 'panorama' || !lens && rig.source.kind !== 'image-relief' ? 1 : settings.fit === 'contain' ? Math.min(1, aspect / imageAspect) : Math.max(1, aspect / imageAspect);
    let fy = (lens ? lens.fy / lens.height : 1 / (2 * Math.tan(radians(settings.fov ?? 45) / 2))) * fit;
    const fx = fy / aspect * (lens ? lens.fx / lens.fy : 1), cx = (lens ? .5 + ((lens.cx + .5) / lens.width - .5) * fit * imageAspect / aspect : .5) + (settings.framingX ?? 0), cy = (lens ? .5 + ((lens.cy + .5) / lens.height - .5) * fit : .5) + (settings.framingY ?? 0);
    return { eye, position: [...pose.position], target: [...target], center: [...target], right, up, forward, fx, fy, cx, cy,
        distance: vec3Length(vec3Sub(target, eye)), aspect, yaw: Math.atan2(forward[0], forward[2]), pitch: Math.asin(clamp(vec3Dot(forward, rig.up), -1, 1)),
        mode: rig.mode, projection: settings.mediaProjection ?? (rig.mode === 'panorama' ? 'equirectangular' : 'perspective'), near: rig.near, far: rig.far, unitScale: rig.unitScale };
}

function basis(rig) {
    const eye = eyeFor(rig), direction = vec3Sub(rig.target, eye), forward = vec3Normalize(direction), right = vec3Normalize(vec3Cross(rig.up, forward));
    return { eye, forward, right, distance: vec3Length(direction) };
}
function constrainTranslation(rig, position, target, reference = rig) {
    const delta = vec3Sub(position, reference.position), envelope = rig.source.maxTranslation, length = vec3Length(delta);
    if (length > envelope) { const corrected = vec3Add(reference.position, vec3Scale(delta, envelope / length)), change = vec3Sub(corrected, position); position = corrected; target = vec3Add(target, change); }
    if (rig.bounds) {
        const eye = eyeFor(rig, position), bounded = eye.map((value, axis) => clamp(value, rig.bounds.min[axis], rig.bounds.max[axis])), change = vec3Sub(bounded, eye);
        position = vec3Add(position, change); target = vec3Add(target, change);
    }
    return { position, target };
}

/** Pure UI/gesture actions. No movement is secretly written into a document. */
export function applyCameraRigAction(value, action, amount = 1, { reference = value } = {}) {
    const rig = normalizeSpatialCameraRig(value), origin = normalizeSpatialCameraRig(reference); scalar(amount, -10000, 10000, 'Camera action amount');
    if (action === 'reset') return origin;
    const { eye, forward, right, distance } = basis(rig);
    if (action === 'look-left' || action === 'look-right' || action === 'look-up' || action === 'look-down') {
        const yaw = action === 'look-left' || action === 'look-right', sign = action === 'look-left' || action === 'look-down' ? -1 : 1, axis = yaw ? rig.up : right;
        const limit = yaw ? rig.source.maxYaw : rig.source.maxPitch, angle = radians(clamp(sign * amount, -limit, limit)), rotated = vec3RotateAxis(forward, axis, yaw ? angle : -angle);
        const base = basis(origin), horizontal = vec3Normalize(vec3Sub(rotated, vec3Scale(rig.up, vec3Dot(rotated, rig.up)))), baseHorizontal = vec3Normalize(vec3Sub(base.forward, vec3Scale(rig.up, vec3Dot(base.forward, rig.up))));
        const signedYaw = Math.atan2(vec3Dot(vec3Cross(baseHorizontal, horizontal), rig.up), vec3Dot(baseHorizontal, horizontal)), pitch = Math.asin(clamp(vec3Dot(rotated, rig.up), -1, 1)), basePitch = Math.asin(clamp(vec3Dot(base.forward, rig.up), -1, 1));
        const heading = vec3RotateAxis(baseHorizontal, rig.up, clamp(signedYaw, -radians(rig.source.maxYaw), radians(rig.source.maxYaw))), elevation = clamp(pitch, Math.max(-radians(85), basePitch - radians(rig.source.maxPitch)), Math.min(radians(85), basePitch + radians(rig.source.maxPitch))), direction = vec3Add(vec3Scale(heading, Math.cos(elevation)), vec3Scale(rig.up, Math.sin(elevation)));
        if (rig.mode === 'orbit') {
            const movedEye = vec3Sub(rig.target, vec3Scale(direction, distance)), position = vec3Sub(movedEye, vec3Scale(rig.up, rig.eyeHeight));
            Object.assign(rig, constrainTranslation(rig, position, rig.target, origin));
        }
        else rig.target = vec3Add(eye, vec3Scale(direction, distance));
    } else if (['truck-left', 'truck-right', 'dolly-forward', 'dolly-back', 'raise', 'lower'].includes(action)) {
        if (rig.mode === 'panorama') return rig;
        const axis = action.startsWith('truck') ? right : action.startsWith('dolly') ? forward : rig.up, sign = ['truck-left', 'dolly-back', 'lower'].includes(action) ? -1 : 1;
        const delta = vec3Scale(axis, amount * sign), position = vec3Add(rig.position, delta), target = vec3Add(rig.target, delta);
        Object.assign(rig, constrainTranslation(rig, position, target, origin));
    } else if (action === 'eye-height') {
        const change = vec3Scale(rig.up, amount - rig.eyeHeight); rig.eyeHeight = amount; rig.target = vec3Add(rig.target, change);
    } else throw new TypeError(`Unsupported camera action '${action}'`);
    rig.path = null;
    return normalizeSpatialCameraRig(rig);
}

/** Persist the actual inspected pose, accounting for the saved eye-height offset. */
export function saveSpatialCameraView(value, camera) {
    const rig = normalizeSpatialCameraRig(value), eye = vector(camera.eye, 'Inspected camera eye'), target = vector(camera.target ?? camera.center, 'Inspected camera target');
    const position = vec3Sub(eye, vec3Scale(rig.up, rig.eyeHeight));
    if (rig.mode === 'panorama' && vec3Length(vec3Sub(position, rig.position)) > 1e-8) throw new TypeError('An inspected panorama pose cannot translate');
    Object.assign(rig, { position, target }); rig.path = null;
    return normalizeSpatialCameraRig(rig);
}

export function spatialCameraCoverage(value) {
    const rig = normalizeSpatialCameraRig(value), source = rig.source;
    return { kind: source.kind, label: { 'image-relief': 'Single-view depth relief', panorama: '360° panoramic view', captured: 'Captured 3D scene', procedural: 'Procedural 3D scene' }[source.kind],
        confidence: source.confidence, translation: rig.mode !== 'panorama' && source.maxTranslation > 0, maxTranslation: source.maxTranslation, maxYaw: source.maxYaw, maxPitch: source.maxPitch,
        observedGeometry: source.kind === 'captured', generatedGeometry: source.kind === 'procedural', rotationalOnly: source.kind === 'panorama',
        message: source.kind === 'image-relief' ? 'Only source-visible surfaces are known; movement stays inside the authored coverage envelope.' : source.kind === 'panorama' ? 'Look around from the capture point. Translation is disabled.' : source.kind === 'captured' ? 'Coverage follows the imported capture; unseen surfaces remain unknown.' : 'Geometry is authored in three dimensions and can be inspected around its bounds.' };
}

export function normalizeSpatialCloudFrame(value) {
    const frame = cloneStrictJson(value, '$.cloudFrame'); shape(frame, ['version', 'mode', 'unitScale', 'origin'], 'Cloud frame');
    if (frame.version !== 1 || frame.mode !== 'metric') throw new TypeError('Unsupported cloud frame');
    scalar(frame.unitScale, .000001, 1000000, 'Cloud unit scale'); frame.origin = vector(frame.origin, 'Cloud origin'); return frame;
}

/** Fit measured world bounds without normalizing or stretching their geometry. */
export function fitSpatialCameraRig(bounds, { fov = 45, aspect = 16 / 9, sourceKind = 'captured', unitScale = 1, eyeHeight = 0, mode = 'world', padding = 1.12 } = {}) {
    const volume = cloneStrictJson(bounds, '$.cameraBounds'); shape(volume, ['min', 'max'], 'Scene bounds');
    vector(volume.min, 'Scene min'); vector(volume.max, 'Scene max');
    if (volume.min.some((value, axis) => value > volume.max[axis])) throw new TypeError('Scene bounds are inverted');
    scalar(fov, 5, 150, 'Camera fit field of view'); scalar(aspect, .01, 100, 'Camera fit aspect'); scalar(padding, 1, 4, 'Camera fit padding');
    const center = vec3Lerp(volume.min, volume.max, .5), half = vec3Scale(vec3Sub(volume.max, volume.min), .5), span = Math.max(...half) * 2;
    if (span < 1e-6) throw new TypeError('Cannot fit a scene without measured extents');
    const tan = Math.tan(radians(fov) / 2), distance = padding * Math.max(half[1] / tan, half[0] / (tan * aspect)) + half[2];
    const eye = [center[0], center[1], center[2] - Math.max(distance, span * .1)], position = vec3Sub(eye, [0, eyeHeight, 0]);
    return createSpatialCameraRig({ mode, position, target: center, eyeHeight, unitScale,
        near: Math.max(.00001, span / 1000), far: Math.max(distance + span * 4, .001),
        source: { kind: sourceKind, maxTranslation: sourceKind === 'panorama' ? 0 : span * (sourceKind === 'image-relief' ? .025 : .5) } });
}
