// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import * as Depth from './DepthEngine.js';
import * as Neural from './NeuralPlate.js';
import { fuseRGBDCapture } from './SpatialReconstruction.js';
import { prepareStereoCapture } from './SpatialCapturePreparation.js';
import { buildSpatialCloudHierarchy } from './SpatialCloudHierarchy.js';

/** Static module worker: all expensive preparation is provisional until the caller applies it. */
self.onmessage = async ({ data: { id, task, payload } }) => {
    const progress = value => self.postMessage({ id, type: 'progress', progress: value });
    try {
        let result;
        switch (task) {
            case 'refine': result = Depth.refineField(payload.field, payload.rgba, payload.options); break;
            case 'stereo': result = Depth.stereo({ ...payload, onProgress: progress }); break;
            case 'gaussians': result = Depth.gaussianCloud(payload.field, payload.rgba, payload.options); break;
            case 'cloud-hierarchy': result = buildSpatialCloudHierarchy(payload.cloud, payload.options); break;
            case 'consensus': result = Depth.consensusDepth(payload.field, payload.hypotheses, payload.options); break;
            case 'fuse': result = await fuseRGBDCapture(payload.capture, { ...payload.options, onProgress: progress }); break;
            case 'stereo-capture': result = await prepareStereoCapture(payload.capture, { ...payload.options, onProgress: progress }); break;
            case 'sequence': {
                if (!Array.isArray(payload.frames) || payload.frames.length < 2 || payload.frames.length > 24) throw new TypeError('Supply 2–24 registered depth frames.');
                const frames = [payload.frames[0]], reports = [];
                let time = frames[0].time;
                if (!Number.isFinite(time) || time < 0) throw new TypeError('Sequence times must be finite and increasing.');
                for (const frame of payload.frames.slice(1)) {
                    if (!Number.isFinite(frame.time) || frame.time <= time) throw new TypeError('Sequence times must be finite and increasing.');
                    const repaired = Depth.stabilizeFrame(frames.at(-1).field, frame.field, frame);
                    frames.push({ ...frame, field: repaired.field }); reports.push(repaired.report); time = frame.time;
                    progress({ frame: frames.length, total: payload.frames.length });
                }
                result = { frames, reports };
                break;
            }
            case 'complete': {
                Neural.deserialize(payload.model);
                result = { model: payload.model, pixels: Neural.complete(payload.input, payload.model) };
                break;
            }
            case 'train': {
                const options = payload.options ?? {};
                const steps = options.steps ?? 3500;
                if (!Number.isInteger(steps) || steps < 100 || steps > 12000) throw new TypeError('Training requires 100–12,000 integer steps.');
                const trainer = new Neural.Trainer(payload.input, options);
                while (trainer.stepCount < steps) {
                    trainer.step(Math.min(25, steps - trainer.stepCount));
                    if (trainer.stepCount % 50 === 0 || trainer.stepCount === steps) {
                        const record = trainer.record();
                        progress({ step: record.step, loss: record.validationMSE, history: trainer.history });
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                }
                const model = trainer.finish();
                result = { model, pixels: Neural.complete(payload.input, model) };
                break;
            }
            default: throw new TypeError(`Unknown spatial preparation task: ${String(task)}`);
        }
        self.postMessage({ id, type: 'result', result });
    } catch (error) {
        self.postMessage({ id, type: 'error', error: String(error?.message ?? error) });
    }
};
