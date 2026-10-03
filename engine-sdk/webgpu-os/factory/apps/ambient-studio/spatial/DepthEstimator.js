// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { SpatialJobClient } from './SpatialJobClient.js';

export const DEPTH_MODEL_ID = 'onnx-community/depth-anything-v2-small';
export const DEPTH_MODEL_REVISION = 'c70d1ddbcd93c9bda8098268cc3554adf5e8dd4f';
export const DEPTH_RUNTIME_VERSION = '3.8.1';

/** Inference consumes explicitly installed model bytes; it cannot download a model. */
export function createDepthEstimator({ getProjectToken = () => null } = {}) {
    const jobs = new SpatialJobClient({ getProjectToken, workerURL: new URL('./DepthInferenceWorker.js', import.meta.url) });
    return {
        estimate(imageData, { modelFiles, ensemble = false, onProgress, signal, projectToken = getProjectToken() } = {}) {
            if (!Array.isArray(modelFiles) || !modelFiles.length) return Promise.reject(new Error('Install the pinned depth model before estimating depth.'));
            const width = imageData?.width, height = imageData?.height;
            if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width * height > 4194304 || imageData.data?.length !== width * height * 4) {
                return Promise.reject(new TypeError('Depth source dimensions are invalid.'));
            }
            return jobs.run('estimate', { width, height, pixels: new Uint8ClampedArray(imageData.data), modelFiles, ensemble }, { onProgress, signal, projectToken });
        },
        cancel() { jobs.cancel(); },
        dispose() { jobs.dispose(); },
        get running() { return jobs.running; },
    };
}
