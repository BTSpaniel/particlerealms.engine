// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { liftDepthField, geometryFromCloud, validateCloud, unpackCloud, depthAt } from '../../factory/apps/ambient-studio/spatial/SpatialCore.js';
import { createSpatialDiorama, geometryFromSpatialScene } from '../../factory/apps/ambient-studio/spatial/SpatialDiorama.js';
import { SPATIAL_EXAMPLE } from '../../factory/apps/ambient-studio/spatial/SpatialExample.js';
import { readGaussianPLY, readSplat } from '../../factory/apps/ambient-studio/spatial/SpatialIO.js';
import * as Depth from '../../factory/apps/ambient-studio/spatial/DepthEngine.js';
import { prepareSpatialObjectEdits } from '../../factory/apps/ambient-studio/spatial/SpatialObjectEdits.js';
import { prepareSpatialVideoFrame } from './SpatialVideoPlayback.js';

/** Resolve operator-scoped bytes; no external URLs or executable project fields. */
export async function prepareSpatialAmbientAssets(plan, assetResolver, signal, preparation = {}) {
    const releases = [];
    const check = () => signal?.throwIfAborted();
    const descriptor = id => plan.assets.find(asset => asset.id === id);
    const bytes = async id => {
        check();
        const asset = descriptor(id);
        if (!asset || typeof assetResolver !== 'function') throw new Error(`Spatial asset resolver is unavailable for ${id}`);
        const value = await assetResolver(asset, { projectId: plan.projectId, signal });
        check();
        return value instanceof Blob ? value : new Blob([value], { type: asset.mediaType });
    };
    const image = async id => {
        const bitmap = await createImageBitmap(await bytes(id));
        releases.push(() => bitmap.close()); check(); return bitmap;
    };
    try {
        const s = plan.spatial, source = plan.source;
        let media = null, field = s.depthField ? Depth.deserialize(s.depthField) : null, cloud = s.cloud;
        const mediaKind = source.kind === 'cloud' && source.mediaAssetId ? descriptor(source.mediaAssetId)?.kind : source.kind;
        if (mediaKind === 'procedural' && s.source !== 'diorama') {
            media = await decodeEmbeddedExample(SPATIAL_EXAMPLE.image); releases.push(() => media.close()); check();
            const depth = await decodeEmbeddedExample(SPATIAL_EXAMPLE.depth); releases.push(() => depth.close()); check();
            field ??= Depth.makeField({ ...readScalarImage(depth, 640), kind: 'normalized-near', range: [0, 1], provenance: `${SPATIAL_EXAMPLE.provenance.source}. ${SPATIAL_EXAMPLE.provenance.depth}` });
        }
        else if (mediaKind === 'image') media = await image(source.mediaAssetId);
        else if (mediaKind === 'video') {
            const blob = await bytes(source.mediaAssetId), url = URL.createObjectURL(blob), video = document.createElement('video');
            video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto';
            releases.push(() => { video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); });
            await new Promise((resolve, reject) => {
                const done = error => { video.removeEventListener('loadeddata', ready); video.removeEventListener('error', fail); signal?.removeEventListener('abort', abort); clearTimeout(timer); error ? reject(error) : resolve(); };
                const ready = () => done(), fail = () => done(new Error('Spatial video could not decode')), abort = () => done(signal.reason ?? new DOMException('Aborted', 'AbortError'));
                const timer = setTimeout(() => done(new Error('Spatial video decode timed out')), 15000);
                video.addEventListener('loadeddata', ready); video.addEventListener('error', fail); signal?.addEventListener('abort', abort, { once: true }); video.src = url;
            });
            check();
            await prepareSpatialVideoFrame(video, s, signal);
            check(); media = video;
        }
        if (source.depthAssetId) {
            const asset = descriptor(source.depthAssetId), blob = await bytes(source.depthAssetId);
            if (asset.mediaType.includes('json')) field = Depth.deserialize(JSON.parse(await blob.text()));
            else if (asset.kind === 'image') {
                const map = readScalarImage(await image(source.depthAssetId));
                field = Depth.makeField({ ...map, kind: s.depthConvention === 'far-white' ? 'relative-depth' : 'normalized-near', provenance: 'Imported grayscale depth map' });
            } else {
                const values = decodeRawFloat32(await blob.arrayBuffer(), asset.dimensions.width, asset.dimensions.height);
                field = Depth.makeField({ width: asset.dimensions.width, height: asset.dimensions.height, values, kind: asset.metadata.depthKind ?? asset.metadata.kind ?? 'relative-inverse', K: asset.metadata.K, range: asset.metadata.range, units: asset.metadata.units, provenance: asset.metadata.provenance ?? 'Imported full precision depth' });
            }
        }
        if (source.confidenceAssetId) {
            if (!field) throw new TypeError('Confidence requires a depth field');
            const asset = descriptor(source.confidenceAssetId);
            const confidence = asset.kind === 'image' ? readScalarImage(await image(source.confidenceAssetId)) : { width: asset.dimensions.width, height: asset.dimensions.height, values: decodeRawFloat32(await (await bytes(asset.id)).arrayBuffer(), asset.dimensions.width, asset.dimensions.height) };
            if (confidence.width !== field.width || confidence.height !== field.height) throw new TypeError('Confidence and depth dimensions must match');
            if (confidence.values.some(value => value < 0 || value > 1)) throw new TypeError('Confidence must be in [0,1]');
            field = Depth.makeField({ ...field, confidence: confidence.values });
        }
        let maskImage = null, mask = null;
        if (source.maskAssetId ?? s.maskAsset) {
            const id = source.maskAssetId ?? s.maskAsset, asset = descriptor(id);
            if (asset.kind === 'image') { maskImage = await image(id); mask = readScalarImage(maskImage); }
            else { mask = { width: asset.dimensions.width, height: asset.dimensions.height, values: decodeRawFloat32(await (await bytes(id)).arrayBuffer(), asset.dimensions.width, asset.dimensions.height) }; maskImage = scalarCanvas(mask); }
        }
        if (source.cloudAssetId) {
            const asset = descriptor(source.cloudAssetId), data = await (await bytes(asset.id)).arrayBuffer();
            cloud = /\.ply$/i.test(asset.path) || /\.ply$/i.test(asset.name) || asset.mediaType.includes('ply') ? readGaussianPLY(data, 'Imported PLY', s.cloudFrame?.mode === 'metric' ? { origin: 'auto' } : {})
                : /\.splat$/i.test(asset.path) || /\.splat$/i.test(asset.name) ? readSplat(data) : validateCloud(JSON.parse(new TextDecoder().decode(data)));
        }
        const authoredScene = !cloud && source.kind === 'procedural' && s.source === 'diorama' && source.scene;
        if (!cloud && !authoredScene && source.kind === 'procedural' && s.source === 'diorama') cloud = createSpatialDiorama(s.count, source.seed);
        if (s.sequence && (!cloud || s.sequence.count !== cloud.count)) throw new TypeError('Motion sequence identities must match the resolved Gaussian cloud');
        const width = media?.videoWidth || media?.width || field?.width || 1280, height = media?.videoHeight || media?.height || field?.height || 720;
        const map = field ? { ...Depth.nearMap(field, { near: s.near, far: s.near + s.depth }), edgeAware: s.depthEdgeSampling } : null;
        // Source pixels belong to immutable capture coordinates. Object edits
        // move that pigment with the surface rather than reprojecting its UVs.
        const canonicalRaw = cloud && s.depthCamera && field?.K ? unpackCloud(cloud) : null;
        const objectEdits = cloud && s.objectEdits ? prepareSpatialObjectEdits(cloud, s.objectEdits, { groupBounds: preparation.groupBounds }) : null;
        if (objectEdits) cloud = validateCloud(objectEdits.cloud);
        const geometry = authoredScene ? geometryFromSpatialScene(source.scene, s.count, s.cloudFrame) : cloud ? geometryFromCloud(cloud, s.count, s.depthCamera ? field : null, null, s.cloudFrame) : liftDepthField(s, width / height, map, mask, source.seed);
        if (preparation.sourceIds) {
            geometry.sourceIds = Uint32Array.from(geometry.sourceIds, id => preparation.sourceIds[id]);
            geometry.phaseIds = geometry.sourceIds;
        }
        if (preparation.bounds && s.cloudFrame) {
            const { min, max } = preparation.bounds, origin = preparation.coordinateOrigin;
            geometry.center = min.map((x, axis) => ((x + max[axis]) * .5 + (origin[axis] - s.cloudFrame.origin[axis])) * s.cloudFrame.unitScale);
            geometry.baseDistance = Math.max(.001, ...max.map((x, axis) => x - min[axis])) * s.cloudFrame.unitScale;
        }
        if (s.sequence && objectEdits?.transforms.size) geometry.objectTransforms = objectEdits.transforms;
        if (cloud && s.depthCamera && field?.K) {
            // Reconstructed splats retain source-pixel identity even when their
            // canonical cloud is stored separately from the reference media.
            const [fx, fy, cx, cy] = field.K;
            geometry.tangentU = new Float32Array(geometry.count * 3);
            geometry.tangentV = new Float32Array(geometry.count * 3);
            for (let i = 0; i < geometry.count; i++) {
                const at = geometry.sourceIds[i] * 14, origin = cloud.origin, z = canonicalRaw[at + 2] + (origin?.[2] ?? 0);
                if (z <= 0) continue;
                // Intrinsics address the original capture-camera coordinates,
                // before either payload rebasing or selected-object edits.
                const u = ((canonicalRaw[at] + (origin?.[0] ?? 0)) * fx / z + cx + .5) / field.width;
                const v = (-(canonicalRaw[at + 1] + (origin?.[1] ?? 0)) * fy / z + cy + .5) / field.height;
                geometry.uv.set([u, v], i * 2);
                const surfaceDepth = z * geometry.normalization.scale * (objectEdits?.transforms.get(geometry.groups[i])?.scale ?? 1);
                geometry.tangentU[i * 3] = surfaceDepth * field.width / fx;
                geometry.tangentV[i * 3 + 1] = -surfaceDepth * field.height / fy;
                if (mask) geometry.mobility[i] = depthAt(mask, u, v);
            }
        }
        const plate = s.learnedPlate ? await image(s.learnedPlate) : null;
        const completionMask = s.completionMask ? await image(s.completionMask) : null;
        check();
        return { geometry, media, plate, completionMask, maskImage, width, height, field, dispose: () => releases.splice(0).reverse().forEach(release => release()) };
    } catch (error) { releases.reverse().forEach(release => release()); throw error; }
}

export function decodeRawFloat32(buffer, width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width > 4096 || height > 4096 || width * height > 1048576 || buffer.byteLength !== width * height * 4) throw new TypeError('Raw Float32 dimensions or byte count are invalid');
    const view = new DataView(buffer), values = new Float32Array(width * height);
    for (let i = 0; i < values.length; i++) { values[i] = view.getFloat32(i * 4, true); if (!Number.isFinite(values[i])) throw new TypeError('Raw Float32 pixels must be finite; represent unsupported pixels with zero confidence'); }
    return values;
}
function readScalarImage(image, maxDimension = Infinity) {
    const scale = Math.min(1, maxDimension / image.width, maxDimension / image.height), canvas = makeCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale))), context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height); const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return { width: canvas.width, height: canvas.height, values: Float32Array.from({ length: rgba.length / 4 }, (_, i) => (rgba[i * 4] * .2126 + rgba[i * 4 + 1] * .7152 + rgba[i * 4 + 2] * .0722) / 255) };
}
function scalarCanvas(map) {
    const canvas = makeCanvas(map.width, map.height), context = canvas.getContext('2d'), pixels = context.createImageData(map.width, map.height);
    for (let i = 0; i < map.values.length; i++) { pixels.data.fill(Math.round(Math.max(0, Math.min(1, map.values[i])) * 255), i * 4, i * 4 + 3); pixels.data[i * 4 + 3] = 255; }
    context.putImageData(pixels, 0, 0); return canvas;
}
function decodeEmbeddedExample(dataURL) { const [header, encoded] = dataURL.split(','), mime = header.slice(5, header.indexOf(';')); return createImageBitmap(new Blob([Uint8Array.from(atob(encoded), character => character.charCodeAt(0))], { type: mime })); }
function makeCanvas(width, height) { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; }
