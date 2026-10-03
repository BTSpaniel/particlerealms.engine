// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { cloneStrictJson } from '../../../../../engine/core/schema/StrictJsonValue.js';
import * as Depth from './DepthEngine.js';
import { validateRGBDCameraPose, validateRGBDCapture, fuseRGBDCapture, cameraRigFromRGBDCapture } from './SpatialReconstruction.js';

const MAX_BYTES = 96 * 1024 * 1024;
const MAX_PIXELS = 180000;
function shape(value, keys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) throw new TypeError(`${label} requires exactly ${keys.join(', ')}`);
}
function number(value, min, max, label, integer = false) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) throw new TypeError(`${label} must be ${integer ? 'an integer' : 'finite'} in [${min}, ${max}]`);
}
function rgbaRecord(value, bytes, label) {
    shape(value, ['encoding', 'data'], label);
    if (value.encoding !== 'rgba8-base64' || typeof value.data !== 'string' || value.data.length !== 4 * Math.ceil(bytes / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) throw new TypeError(`${label} must contain exactly one RGBA8 source pixel per declared image pixel`);
    // String length is checked before materializing any pixel storage.
    if (atob(value.data).length !== bytes) throw new TypeError(`${label} RGBA byte count mismatch`);
}
export function encodeStereoRGBA(value) {
    if (!(value instanceof Uint8Array || value instanceof Uint8ClampedArray) || !value.length || value.length > MAX_PIXELS * 4) throw new TypeError('Use a bounded original RGBA8 image');
    let text = ''; for (let offset = 0; offset < value.length; offset += 16384) text += String.fromCharCode(...value.subarray(offset, offset + 16384));
    return { encoding: 'rgba8-base64', data: btoa(text) };
}
function decodeRGBA(value) {
    const text = atob(value.data), pixels = new Uint8ClampedArray(text.length);
    for (let i = 0; i < text.length; i++) pixels[i] = text.charCodeAt(i);
    return pixels;
}
function intrinsics(value, width, height, label) {
    if (!Array.isArray(value) || value.length !== 4) throw new TypeError(`${label} needs fx, fy, cx, cy in original image pixels`);
    number(value[0], .000001, 1e7, `${label} fx`); number(value[1], .000001, 1e7, `${label} fy`);
    number(value[2], -width * 4, width * 4, `${label} cx`); number(value[3], -height * 4, height * 4, `${label} cy`);
}

/** Registered static stereo pairs, not arbitrary moving video or monocular scale. */
export function validateStereoCaptureManifest(value) {
    const capture = cloneStrictJson(value, '$.stereoCapture');
    shape(capture, ['format', 'version', 'staticScene', 'coordinateSystem', 'rectified', 'units', 'pairs'], 'Stereo capture');
    if (capture.format !== 'ambient.stereo-capture' || capture.version !== 1 || capture.staticScene !== true || capture.coordinateSystem !== 'opencv' || capture.rectified !== true || capture.units !== 'm') throw new TypeError('Use an ambient.stereo-capture v1 static, registered, rectified OpenCV capture in metres');
    if (!Array.isArray(capture.pairs) || capture.pairs.length < 1 || capture.pairs.length > 32) throw new TypeError('Use 1–32 registered stereo pairs');
    const ids = new Set(); let bytes = 0;
    for (const pair of capture.pairs) {
        shape(pair, ['id', 'name', 'width', 'height', 'left', 'right', 'intrinsics', 'rightIntrinsics', 'baseline', 'leftCameraToWorld', 'rightCameraToWorld', 'disparity'], 'Stereo pair');
        if (typeof pair.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(pair.id) || ids.has(pair.id)) throw new TypeError('Stereo pair IDs must be valid and unique'); ids.add(pair.id);
        if (typeof pair.name !== 'string' || pair.name.length > 100) throw new TypeError('Stereo pair name must be at most 100 characters');
        number(pair.width, 9, 2048, 'Stereo width', true); number(pair.height, 2, 2048, 'Stereo height', true);
        const pixels = pair.width * pair.height; if (pixels > MAX_PIXELS) throw new TypeError('Stereo image exceeds the existing 180,000-pixel engine budget');
        bytes += 4 * Math.ceil(pixels * 4 / 3) * 2; if (bytes > MAX_BYTES) throw new TypeError('Stereo capture exceeds 96 MiB before pixel allocation');
        rgbaRecord(pair.left, pixels * 4, 'Left source'); rgbaRecord(pair.right, pixels * 4, 'Right source');
        intrinsics(pair.intrinsics, pair.width, pair.height, 'Left intrinsics'); intrinsics(pair.rightIntrinsics, pair.width, pair.height, 'Right intrinsics');
        number(pair.baseline, .000001, 1000, 'Stereo baseline');
        pair.leftCameraToWorld = validateRGBDCameraPose(pair.leftCameraToWorld); pair.rightCameraToWorld = validateRGBDCameraPose(pair.rightCameraToWorld);
        const left = pair.leftCameraToWorld, right = pair.rightCameraToWorld;
        for (const index of [0, 1, 2, 4, 5, 6, 8, 9, 10]) if (Math.abs(left[index] - right[index]) > 1e-5) throw new TypeError('Rectified pair camera rotations must agree');
        const tolerance = Math.max(.00001, pair.baseline * .001);
        for (const [translation, axis] of [[3, 0], [7, 4], [11, 8]]) if (Math.abs(right[translation] - left[translation] - left[axis] * pair.baseline) > tolerance) throw new TypeError('Right pose must be one declared baseline along left-camera +X');
        for (const index of [0, 1, 3]) if (Math.abs(pair.intrinsics[index] - pair.rightIntrinsics[index]) > 1e-5) throw new TypeError('Rectified views must share fx, fy and cy');
        shape(pair.disparity, ['min', 'max', 'offset'], 'Disparity range'); number(pair.disparity.min, 0, 192, 'Minimum disparity', true); number(pair.disparity.max, 0, Math.min(192, pair.width - 5), 'Maximum disparity', true); number(pair.disparity.offset, -8192, 8192, 'Disparity principal-point offset');
        const candidates = pair.disparity.max - pair.disparity.min + 1;
        if (candidates < 4 || pixels * candidates > 14000000) throw new TypeError('Stereo search exceeds the existing bounded disparity volume');
        if (Math.abs(pair.disparity.offset - (pair.rightIntrinsics[2] - pair.intrinsics[2])) > 1e-5) throw new TypeError('Disparity offset must match rightCx minus leftCx');
    }
    return capture;
}

async function originalRGB(pixels, width, height) {
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : document.createElement('canvas'); canvas.width = width; canvas.height = height;
    canvas.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
    const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/png' }) : await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Original source PNG encoding failed')), 'image/png'));
    const data = new Uint8Array(await blob.arrayBuffer()); let text = '';
    for (let i = 0; i < data.length; i += 16384) text += String.fromCharCode(...data.subarray(i, i + 16384));
    return `data:image/png;base64,${btoa(text)}`;
}
function options(value) {
    const input = cloneStrictJson(value ?? {}, '$.fusionOptions');
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['budget', 'voxel', 'confidence'].includes(key))) throw new TypeError('Fusion options support budget, voxel and confidence');
    const result = { budget: 120000, voxel: .012, confidence: .15, ...input };
    number(result.budget, 100, 200000, 'Fusion budget', true); number(result.voxel, .000001, 2, 'Fusion voxel size'); number(result.confidence, 0, 1, 'Fusion confidence'); return result;
}

/** Uses the existing Census/SGM/LR stereo owner and calibrated RGB-D fusion. */
export async function prepareStereoCapture(value, { fuse = true, fusionOptions = {}, onProgress = () => {}, signal = null } = {}) {
    if (typeof fuse !== 'boolean') throw new TypeError('Stereo fuse must be boolean');
    const input = validateStereoCaptureManifest(value), fusion = options(fusionOptions), views = [], reports = [];
    for (let index = 0; index < input.pairs.length; index++) {
        signal?.throwIfAborted(); const pair = input.pairs[index], left = decodeRGBA(pair.left), right = decodeRGBA(pair.right);
        onProgress({ stage: 'stereo', pair: index + 1, total: input.pairs.length, id: pair.id });
        const reconstruction = Depth.stereo({ width: pair.width, height: pair.height, left, right, fx: pair.intrinsics[0], baseline: pair.baseline, K: pair.intrinsics, minDisparity: pair.disparity.min, maxDisparity: pair.disparity.max, offset: pair.disparity.offset,
            onProgress: progress => onProgress({ stage: 'stereo', pair: index + 1, total: input.pairs.length, id: pair.id, progress }) });
        signal?.throwIfAborted(); const field = reconstruction.field;
        // Transparency is absent observation; matching hidden RGB cannot add support.
        for (let i = 0; i < field.confidence.length; i++) {
            const x = i % pair.width, y = Math.floor(i / pair.width), match = Math.round(x - reconstruction.disparity[i]);
            if (left[i * 4 + 3] < 16 || match < 0 || match >= pair.width || right[(y * pair.width + match) * 4 + 3] < 16) { field.confidence[i] = 0; field.values[i] = 0; }
        }
        const serialized = Depth.serialize(field), rgb = await originalRGB(left, pair.width, pair.height); signal?.throwIfAborted();
        views.push({ id: pair.id, name: pair.name, width: pair.width, height: pair.height, rgb, depth: serialized.data, confidence: serialized.confidence, intrinsics: [...pair.intrinsics], cameraToWorld: [...pair.leftCameraToWorld], unitScale: 1 });
        reports.push({ id: pair.id, method: field.method, units: field.units, baseline: pair.baseline, intrinsics: [...pair.intrinsics], acceptedPixels: field.confidence.reduce((sum, confidence) => sum + Number(confidence > 0), 0), totalPixels: field.values.length, report: reconstruction.report });
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    const capture = validateRGBDCapture({ format: 'ambient.rgbd-capture', version: 1, staticScene: true, coordinateSystem: 'opencv', views,
        depthProvenance: 'Existing engine Census/SGM4 subpixel stereo with left-right/photometric checks; supplied registered pinhole calibration and metric baselines. No external neural model, estimated camera poses or unseen geometry.' });
    signal?.throwIfAborted();
    const fused = fuse ? await fuseRGBDCapture(capture, { ...fusion, signal, onProgress: progress => onProgress({ stage: 'fusion', ...progress }) }) : null;
    signal?.throwIfAborted();
    return { capture, ...(fused ? { cloud: fused.cloud, fusionReport: fused.report } : {}), cameraRig: cameraRigFromRGBDCapture(capture),
        report: { format: 'ambient.stereo-capture', pairs: reports, calibrationPreserved: true, units: 'm', method: 'existing-engine-stereo-and-rgbd-fusion', inferredPoses: false, filledUnseenSurfaces: false } };
}
