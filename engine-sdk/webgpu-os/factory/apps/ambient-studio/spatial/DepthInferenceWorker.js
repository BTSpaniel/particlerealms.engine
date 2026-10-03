// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { makeField, serialize, consensusDepth } from './DepthEngine.js';
import { DEPTH_MODEL_ID, DEPTH_MODEL_REVISION } from './DepthEstimator.js';

const vendorRoot = new URL('../../../../../vendor/transformers/3.8.1/', import.meta.url);

/** Only local runtime files and model bytes handed to this worker may be read. */
function installedCache(modelFiles) {
    const files = new Map();
    for (const file of modelFiles) {
        if (typeof file?.path !== 'string' || file.path.includes('..') || file.path.includes('\\')) throw new TypeError('Invalid installed model path.');
        const path = file.path.replace(/^\/+/, '').replace(new RegExp(`^(?:models/)?${DEPTH_MODEL_ID}/`), '');
        if (!(file.bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(file.bytes)) throw new TypeError('Installed model data must be bytes.');
        if (files.has(path)) throw new TypeError('Duplicate installed model file.');
        files.set(path, { bytes: file.bytes, mime: file.mime ?? 'application/octet-stream' });
    }
    const read = request => {
        const url = new URL(typeof request === 'string' ? request : request.url, self.location.href);
        if (url.origin !== self.location.origin) throw new Error('Depth inference cannot access remote files.');
        const prefix = `/models/${DEPTH_MODEL_ID}/`;
        if (!url.pathname.startsWith(prefix)) return null;
        const file = files.get(decodeURIComponent(url.pathname.slice(prefix.length)));
        if (!file) return new Response('Model file was not installed.', { status: 404 });
        return new Response(file.bytes, { status: 200, headers: { 'Content-Type': file.mime } });
    };
    const nativeFetch = self.fetch.bind(self);
    self.fetch = (request, options) => {
        const local = read(request);
        if (local) return Promise.resolve(local);
        const url = new URL(typeof request === 'string' ? request : request.url, self.location.href);
        if (url.origin === vendorRoot.origin && url.pathname.startsWith(vendorRoot.pathname)) return nativeFetch(request, options);
        return Promise.reject(new Error('Depth inference may read only installed model data and the vendored runtime.'));
    };
    return { async match(request) { return read(request) ?? undefined; }, async put() { throw new Error('Installed model cache is read-only.'); } };
}

self.onmessage = async ({ data: { id, task, payload } }) => {
    const progress = message => self.postMessage({ id, type: 'progress', progress: message });
    let pipe;
    try {
        if (task !== 'estimate') throw new TypeError('Unknown inference task.');
        const cache = installedCache(payload.modelFiles);
        const { pipeline, RawImage, env } = await import(new URL('transformers.min.js', vendorRoot).href);
        env.allowRemoteModels = false;
        env.allowLocalModels = true;
        env.localModelPath = '/models/';
        env.useBrowserCache = false;
        env.useFSCache = false;
        env.useCustomCache = true;
        env.customCache = cache;
        env.backends.onnx.wasm.numThreads = 1;
        env.backends.onnx.wasm.proxy = false;
        env.backends.onnx.wasm.wasmPaths = vendorRoot.href;
        progress('Loading the installed quantized depth model…');
        pipe = await pipeline('depth-estimation', DEPTH_MODEL_ID, {
            revision: DEPTH_MODEL_REVISION, device: 'wasm', dtype: 'q8',
            progress_callback: value => progress({ status: value.status, progress: value.progress ?? null }),
        });
        const { width, height } = payload;
        const pixels = new Uint8ClampedArray(payload.pixels);
        const prediction = await pipe(new RawImage(pixels, width, height, 4));
        const tensor = prediction.predicted_depth;
        const w = tensor.dims.at(-1), h = tensor.dims.at(-2);
        let field = makeField({ width: w, height: h, values: new Float32Array(tensor.data), kind: 'relative-inverse',
            method: 'depth-anything-v2-small', provenance: `Depth Anything V2 Small / ${DEPTH_MODEL_REVISION}; single-frame relative inverse depth.` });
        let consensusReport = null;
        if (payload.ensemble) {
            progress('Checking horizontal-flip prediction agreement…');
            const flipped = new Uint8ClampedArray(pixels.length);
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                const from = (y * width + width - 1 - x) * 4;
                flipped.set(pixels.subarray(from, from + 4), (y * width + x) * 4);
            }
            const second = (await pipe(new RawImage(flipped, width, height, 4))).predicted_depth;
            if (second.dims.at(-1) !== w || second.dims.at(-2) !== h) throw new Error('Depth predictions have incompatible dimensions.');
            const mirror = new Float32Array(w * h);
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mirror[y * w + x] = second.data[y * w + w - 1 - x];
            const result = consensusDepth(field, [makeField({ ...field, values: mirror })]);
            field = result.field; consensusReport = result.report;
        }
        const [lo, hi] = field.range;
        if (!(hi > lo)) throw new Error('Depth model returned a degenerate prediction.');
        const preview = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < field.values.length; i++) {
            const value = Math.round(Math.max(0, Math.min(1, (field.values[i] - lo) / (hi - lo))) * 255);
            preview.set([value, value, value, 255], i * 4);
        }
        const result = { field: serialize(field), width: w, height: h, pixels: preview,
            rawDepth: field.values, rawConfidence: field.confidence, rawKind: field.kind,
            provenance: field.provenance, consensusReport, range: field.range };
        self.postMessage({ id, type: 'result', result });
    } catch (error) {
        self.postMessage({ id, type: 'error', error: String(error?.message ?? error) });
    } finally {
        await pipe?.dispose();
    }
};
