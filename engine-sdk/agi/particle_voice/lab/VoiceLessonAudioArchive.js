// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { Zip } from '../../../webgpu-os/packages/Zip.js';
import { openIndexedDBTransaction } from '../../../webgpu-os/storage/IndexedDBTransaction.js';
import { sha256HexOf, sha256HexOfBytes } from '../risk/ReceiptCrypto.js';

export const VOICE_LESSON_AUDIO_SCHEMA = 'particle-voice-lesson-audio-v1';
export const VOICE_LESSON_AUDIO_LIMITS = Object.freeze({
    clipBytes: 32 * 1024 * 1024, sessionBytes: 128 * 1024 * 1024,
    totalBytes: 512 * 1024 * 1024, sessions: 32, captures: 1024,
    reportBytes: 2 * 1024 * 1024, metadataBytes: 128 * 1024,
    recordBytes: 4 * 1024 * 1024,
});
const encoder = new TextEncoder();
const CAPTURE_STATUSES = new Set(['captured', 'drained', 'stopped', 'error']);
const FINAL_STATUSES = new Set(['completed', 'incomplete']);
const WAV_HEADER_BYTES = 58;
const timestamp = () => new Date().toISOString();

function identifier(value, label) {
    if (typeof value !== 'string' || !value.trim() || value.length > 300) throw new TypeError(`${label} must be a bounded nonempty string`);
    return value;
}

function snapshot(value, maximumBytes) {
    const seen = new Set(); let nodes = 0;
    function visit(item, depth) {
        if (++nodes > 1000000 || depth > 32) throw new RangeError('Audio archive JSON exceeds structural limits');
        if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
        if (typeof item === 'number' && Number.isFinite(item)) return;
        if (!item || typeof item !== 'object' || (!Array.isArray(item)
            && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)) {
            throw new TypeError('Audio archive metadata must contain only finite plain JSON values');
        }
        if (seen.has(item)) throw new TypeError('Audio archive JSON cannot contain cycles');
        seen.add(item);
        if (Array.isArray(item)) for (let index = 0; index < item.length; index++) visit(item[index], depth + 1);
        else for (const key of Reflect.ownKeys(item)) {
            const property = Object.getOwnPropertyDescriptor(item, key);
            if (typeof key !== 'string' || !property.enumerable || !('value' in property)) throw new TypeError('Audio archive JSON must contain plain data properties');
            visit(property.value, depth + 1);
        }
        seen.delete(item);
    }
    visit(value, 0);
    const json = JSON.stringify(value);
    if (encoder.encode(json).byteLength > maximumBytes) throw new RangeError('Audio archive JSON exceeds its storage limit');
    return JSON.parse(json);
}

async function hashBytes(bytes) {
    const hash = await sha256HexOfBytes(bytes);
    if (!hash) throw new Error('SHA-256 is required to save verifiable test audio');
    return hash;
}

/** IEEE float WAVEFORMATEX, including cbSize and fact for non-integer PCM.
 * https://learn.microsoft.com/en-us/windows/win32/api/mmreg/ns-mmreg-waveformatex
 * Preserve the model's binary32 samples, rate and amplitude; never normalize.
 */
export function encodeVoiceLessonWav(pcm, sampleRate) {
    if (!(pcm instanceof Float32Array) || !pcm.length) throw new TypeError('Test audio must be a nonempty Float32Array');
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Test audio requires its actual 8000–192000 Hz sample rate');
    if (pcm.byteLength + WAV_HEADER_BYTES > VOICE_LESSON_AUDIO_LIMITS.clipBytes) throw new RangeError('Test WAV exceeds the clip storage limit');
    const buffer = new ArrayBuffer(WAV_HEADER_BYTES + pcm.byteLength), view = new DataView(buffer);
    const ascii = (offset, value) => { for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index)); };
    ascii(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); ascii(8, 'WAVE');
    ascii(12, 'fmt '); view.setUint32(16, 18, true); view.setUint16(20, 3, true);
    view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true);
    view.setUint16(32, 4, true); view.setUint16(34, 32, true); view.setUint16(36, 0, true);
    ascii(38, 'fact'); view.setUint32(42, 4, true); view.setUint32(46, pcm.length, true);
    ascii(50, 'data'); view.setUint32(54, pcm.byteLength, true);
    // Reading integer bits avoids float conversion and preserves negative zero.
    const bits = new Uint32Array(pcm.buffer, pcm.byteOffset, pcm.length);
    for (let index = 0; index < pcm.length; index++) {
        if (!Number.isFinite(pcm[index])) throw new TypeError('Test audio contains a nonfinite sample');
        view.setUint32(WAV_HEADER_BYTES + index * 4, bits[index], true);
    }
    return buffer;
}

function describeClip(clip) {
    const { bytes, references, ...descriptor } = clip;
    return descriptor;
}

function summarize(record) {
    return { id: record.id, mode: record.mode, title: record.title, status: record.status,
        createdAt: record.createdAt, updatedAt: record.updatedAt, captures: record.captures.length,
        clips: record.clips.length, audioBytes: record.clips.reduce((sum, clip) => sum + clip.byteLength, 0),
        unavailable: record.captures.filter(capture => !capture.clipId).length,
        unsettled: record.captures.filter(capture => capture.status === 'captured').length,
        hasReport: record.report !== null, reportHash: record.reportHash };
}

function sameBytes(left, right) {
    if (!(left instanceof ArrayBuffer) || left.byteLength !== right.byteLength) return false;
    const a = new Uint8Array(left), b = new Uint8Array(right);
    for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
    return true;
}

function validateRecord(record, limits) {
    snapshot(record, limits.recordBytes);
    if (record.schemaVersion !== VOICE_LESSON_AUDIO_SCHEMA || !['active', 'completed', 'incomplete'].includes(record.status)
        || !Array.isArray(record.captures) || record.captures.length > limits.captures || !Array.isArray(record.clips)) {
        throw new Error('Saved test audio session has an invalid structure');
    }
    if (record.privateProgress != null && (Array.isArray(record.privateProgress) || typeof record.privateProgress !== 'object'
        || !/^[a-f0-9]{64}$/.test(record.privateProgressHash))
        || record.privateProgress == null && record.privateProgressHash != null) throw new Error('Saved private test progress is invalid');
    const descriptors = new Map(); let bytes = 0;
    for (const clip of record.clips) {
        if (!/^[a-f0-9]{64}$/.test(clip.sha256) || !/^[a-f0-9]{64}$/.test(clip.pcmSha256)
            || clip.clipId !== `sha256:${clip.sha256}` || clip.path !== `audio/${clip.sha256}.wav`
            || descriptors.has(clip.clipId) || clip.channels !== 1 || clip.encoding !== 'ieee-float32-le'
            || !Number.isInteger(clip.sampleRate) || clip.sampleRate < 8000 || clip.sampleRate > 192000
            || !Number.isSafeInteger(clip.sampleCount) || clip.sampleCount < 1
            || clip.byteLength !== WAV_HEADER_BYTES + clip.sampleCount * 4 || clip.byteLength > limits.clipBytes) {
            throw new Error('Saved test WAV descriptor is invalid');
        }
        descriptors.set(clip.clipId, clip); bytes += clip.byteLength;
    }
    if (bytes > limits.sessionBytes) throw new RangeError('Saved test WAV assets exceed the session limit');
    const captureIds = new Set(), playIds = new Set();
    for (const capture of record.captures) {
        identifier(capture.captureId, 'Saved capture id'); identifier(capture.trialId, 'Saved trial id'); identifier(capture.playId, 'Saved play id');
        if (captureIds.has(capture.captureId) || playIds.has(capture.playId) || !CAPTURE_STATUSES.has(capture.status)) throw new Error('Saved test play identity or status is invalid');
        captureIds.add(capture.captureId); playIds.add(capture.playId);
        const clip = descriptors.get(capture.clipId);
        if (capture.clipId !== null && (!clip || capture.sampleRate !== clip.sampleRate || capture.sampleCount !== clip.sampleCount)) throw new Error('Saved test play has an invalid audio reference');
        if (capture.clipId === null && (capture.sampleRate !== null || capture.sampleCount !== null || capture.status === 'drained'
            || typeof capture.metadata?.unavailableReason !== 'string' || !capture.metadata.unavailableReason.trim())) throw new Error('Missing test audio has no valid unavailable reason');
        if (capture.status === 'captured' ? capture.playback !== null || capture.settledAt !== null
            : !capture.playback || !Number.isFinite(Date.parse(capture.settledAt))) throw new Error('Saved test play has an invalid completion receipt');
    }
}

async function verifySavedEvidence(record, limits) {
    validateRecord(record, limits);
    if (record.report !== null && await sha256HexOf(record.report) !== record.reportHash) {
        throw new Error('Saved test report failed its identity check');
    }
    if (record.privateProgress != null && await sha256HexOf(record.privateProgress) !== record.privateProgressHash) {
        throw new Error('Saved private test progress failed its identity check');
    }
}

/** Bounded local evidence storage. Uses no capture device, synthesis or playback.
 * Only exact copies of caller-supplied model output are saved. Storage failures
 * reject; callers must display them. Nothing is silently evicted or regenerated.
 */
export class VoiceLessonAudioArchive {
    constructor({ databaseName = 'particle-voice-lesson-audio-v1', limits = {} } = {}) {
        this.databaseName = identifier(databaseName, 'Audio archive database name');
        this.limits = { ...VOICE_LESSON_AUDIO_LIMITS };
        for (const [key, value] of Object.entries(limits)) {
            if (!(key in this.limits) || !Number.isSafeInteger(value) || value < 1 || value > this.limits[key]) {
                throw new RangeError('Audio archive limits may only lower the supported positive limits');
            }
            this.limits[key] = value;
        }
        this._database = null;
    }

    async _open() {
        if (!globalThis.indexedDB) throw new Error('Local storage is unavailable; test WAVs were not saved');
        if (!this._database) this._database = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.databaseName, 1); let abandoned = false;
            request.onupgradeneeded = () => {
                request.result.createObjectStore('sessions', { keyPath: 'id' });
                request.result.createObjectStore('clips', { keyPath: 'clipId' });
                request.result.createObjectStore('state', { keyPath: 'id' });
            };
            request.onsuccess = () => {
                if (abandoned) { request.result.close(); return; }
                request.result.onversionchange = () => { request.result.close(); this._database = null; };
                resolve(request.result);
            };
            request.onerror = () => { this._database = null; reject(request.error); };
            request.onblocked = () => { abandoned = true; this._database = null; reject(new Error('Audio archive storage is blocked by another tab')); };
        });
        return this._database;
    }

    async _write(id, change, incomingClip = null) {
        const database = await this._open();
        return new Promise((resolve, reject) => {
            const transaction = openIndexedDBTransaction(database, ['sessions', 'clips', 'state'], 'readwrite', { durability: 'strict' });
            const sessions = transaction.objectStore('sessions'), clips = transaction.objectStore('clips'), state = transaction.objectStore('state');
            let failure = null, output, remaining = incomingClip ? 3 : 2;
            const recordRequest = sessions.get(id), usageRequest = state.get('usage');
            const clipRequest = incomingClip ? clips.get(incomingClip.clipId) : null;
            const ready = () => {
                if (--remaining) return;
                try {
                    const usage = usageRequest.result ?? { id: 'usage', sessions: 0, audioBytes: 0 };
                    const hadClip = incomingClip && recordRequest.result?.clips.some(clip => clip.clipId === incomingClip.clipId);
                    const result = change(recordRequest.result ?? null, usage, clipRequest?.result ?? null);
                    const record = snapshot(result.record, this.limits.recordBytes);
                    if (incomingClip && !hadClip) {
                        const existing = clipRequest.result;
                        if (existing && !sameBytes(existing.bytes, incomingClip.bytes)) throw new Error('Stored test audio failed its content identity check');
                        if (!existing) usage.audioBytes += incomingClip.byteLength;
                        clips.put({ ...(existing ?? incomingClip), references: (existing?.references ?? 0) + 1 });
                    }
                    if (!recordRequest.result) usage.sessions++;
                    if (usage.sessions > this.limits.sessions) throw new RangeError('Saved test session limit reached; export and delete a selected old session to make room');
                    if (usage.audioBytes > this.limits.totalBytes) throw new RangeError('Saved test audio storage limit reached; export and delete a selected old session to make room');
                    sessions.put(record); state.put(usage); output = result.output ?? summarize(record);
                } catch (error) { failure = error; transaction.abort(); }
            };
            recordRequest.onsuccess = ready; usageRequest.onsuccess = ready;
            if (clipRequest) clipRequest.onsuccess = ready;
            transaction.oncomplete = () => resolve(structuredClone(output));
            transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Test audio storage write failed'));
        });
    }

    async startSession({ id = `voice-audio-${crypto.randomUUID()}`, mode, title = `${mode} listening audio`, metadata = {} } = {}) {
        identifier(id, 'Test session id'); identifier(mode, 'Test mode'); identifier(title, 'Test title');
        const evidence = snapshot(metadata, this.limits.metadataBytes), now = timestamp();
        await this._write(id, previous => {
            if (previous) throw new Error('Test audio session already exists');
            return { record: { schemaVersion: VOICE_LESSON_AUDIO_SCHEMA, id, mode, title, metadata: evidence,
                createdAt: now, updatedAt: now, status: 'active', captures: [], clips: [], report: null, reportHash: null, reportMetadata: {},
                privateProgress: null, privateProgressHash: null } };
        });
        return id;
    }

    async capture(sessionId, { trialId, playId = crypto.randomUUID(), pcm, sampleRate, metadata = {} } = {}) {
        identifier(sessionId, 'Test session id'); identifier(trialId, 'Trial id'); identifier(playId, 'Play id');
        const evidence = snapshot(metadata, this.limits.metadataBytes), capturedAt = timestamp();
        // Encoding runs before the first await, so later reuse/mutation of a
        // synthesis buffer cannot change the archived stimulus.
        const bytes = pcm === null ? null : encodeVoiceLessonWav(pcm, sampleRate);
        if (bytes && bytes.byteLength > this.limits.clipBytes) throw new RangeError('Test WAV exceeds the clip storage limit');
        if (!bytes && (sampleRate !== null || typeof evidence.unavailableReason !== 'string' || !evidence.unavailableReason.trim())) {
            throw new TypeError('Missing test audio requires a null sample rate and an explicit unavailableReason');
        }
        const captureId = `capture-${crypto.randomUUID()}`;
        let clip = null;
        if (bytes) {
            const wavSha256 = await hashBytes(bytes), pcmSha256 = await hashBytes(bytes.slice(WAV_HEADER_BYTES));
            clip = { clipId: `sha256:${wavSha256}`, sha256: wavSha256, pcmSha256, sampleRate,
                sampleCount: (bytes.byteLength - WAV_HEADER_BYTES) / 4, channels: 1, encoding: 'ieee-float32-le',
                byteLength: bytes.byteLength, path: `audio/${wavSha256}.wav`, mimeType: 'audio/wav', bytes };
        }
        return this._write(sessionId, record => {
            if (!record) throw new Error('Test audio session does not exist');
            if (FINAL_STATUSES.has(record.status)) throw new Error('Completed test audio is immutable; start a new session');
            if (record.captures.length >= this.limits.captures) throw new RangeError('Test play capture limit reached');
            if (record.captures.some(capture => capture.playId === playId)) throw new Error('Test play id is already captured');
            if (clip && !record.clips.some(item => item.clipId === clip.clipId)) record.clips.push(describeClip(clip));
            if (record.clips.reduce((sum, item) => sum + item.byteLength, 0) > this.limits.sessionBytes) throw new RangeError('This test session reached its saved audio limit');
            record.captures.push({ captureId, trialId, playId, clipId: clip?.clipId ?? null,
                sampleRate: clip?.sampleRate ?? null, sampleCount: clip?.sampleCount ?? null,
                status: 'captured', metadata: evidence, playback: null, capturedAt, settledAt: null });
            record.updatedAt = timestamp();
            return { record, output: { captureId, clipId: clip?.clipId ?? null } };
        }, clip);
    }

    async settle(sessionId, captureId, { status, metadata = {} } = {}) {
        identifier(sessionId, 'Test session id'); identifier(captureId, 'Capture id');
        if (!CAPTURE_STATUSES.has(status) || status === 'captured') throw new TypeError('Playback must settle as drained, stopped or error');
        const evidence = snapshot(metadata, this.limits.metadataBytes);
        return this._write(sessionId, record => {
            if (!record) throw new Error('Test audio session does not exist');
            const capture = record.captures.find(item => item.captureId === captureId);
            if (!capture) throw new Error('Captured test play does not exist');
            if (capture.status !== 'captured') {
                if (capture.status !== status || JSON.stringify(capture.playback) !== JSON.stringify(evidence)) throw new Error('A settled test play cannot be rewritten');
                return { record };
            }
            if (!capture.clipId && status === 'drained') throw new Error('Unavailable audio cannot be marked as a drained captured clip');
            capture.status = status; capture.playback = evidence; capture.settledAt = timestamp(); record.updatedAt = capture.settledAt;
            return { record };
        });
    }

    async saveReport(sessionId, report, { status = 'completed', metadata = {}, privateProgress = null } = {}) {
        identifier(sessionId, 'Test session id');
        if (status !== 'active' && !FINAL_STATUSES.has(status)) throw new TypeError('Test session status must be active, completed or incomplete');
        const original = snapshot(report, this.limits.reportBytes), evidence = snapshot(metadata, this.limits.metadataBytes);
        const progress = privateProgress === null ? null : snapshot(privateProgress, this.limits.reportBytes);
        if (!original || Array.isArray(original) || typeof original !== 'object') throw new TypeError('A test report must be a JSON object');
        if (progress !== null && (Array.isArray(progress) || typeof progress !== 'object')) throw new TypeError('Private test progress must be a JSON object');
        const reportHash = await sha256HexOf(original);
        if (!reportHash) throw new Error('SHA-256 is required to save verifiable test reports');
        const privateProgressHash = progress === null ? null : await sha256HexOf(progress);
        if (progress !== null && !privateProgressHash) throw new Error('SHA-256 is required to save verifiable private test progress');
        return this._write(sessionId, record => {
            if (!record) throw new Error('Test audio session does not exist');
            if (FINAL_STATUSES.has(record.status)) {
                if (record.reportHash !== reportHash || record.status !== status
                    || (record.privateProgressHash ?? null) !== privateProgressHash
                    || JSON.stringify(record.reportMetadata) !== JSON.stringify(evidence)) throw new Error('A completed test report cannot be rewritten');
                return { record };
            }
            record.report = original; record.reportHash = reportHash; record.reportMetadata = evidence;
            record.privateProgress = progress; record.privateProgressHash = privateProgressHash;
            record.status = status; record.updatedAt = timestamp();
            return { record };
        });
    }

    async _read(id, includeClips = false) {
        const database = await this._open();
        return new Promise((resolve, reject) => {
            const transaction = openIndexedDBTransaction(database, includeClips ? ['sessions', 'clips'] : ['sessions']);
            const request = transaction.objectStore('sessions').get(id), assets = []; let failure = null;
            request.onsuccess = () => {
                try {
                    if (includeClips && request.result) {
                        validateRecord(request.result, this.limits);
                        for (const descriptor of request.result.clips) {
                            const asset = transaction.objectStore('clips').get(descriptor.clipId);
                            asset.onsuccess = () => assets.push(asset.result ?? null);
                        }
                    }
                } catch (error) { failure = error; transaction.abort(); }
            };
            transaction.oncomplete = () => resolve({ record: request.result ?? null, assets });
            transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Saved test audio read failed'));
        });
    }

    async loadSession(id) {
        identifier(id, 'Test session id');
        const { record } = await this._read(id);
        if (!record) return null;
        await verifySavedEvidence(record, this.limits);
        return record;
    }

    async listSessions() {
        const database = await this._open();
        return new Promise((resolve, reject) => {
            const transaction = openIndexedDBTransaction(database, ['sessions']);
            const request = transaction.objectStore('sessions').getAll();
            transaction.oncomplete = () => {
                try { resolve(request.result.map(summarize).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))); }
                catch (error) { reject(error); }
            };
            transaction.onabort = () => reject(transaction.error ?? new Error('Saved test audio listing failed'));
        });
    }

    async exportSession(id) {
        identifier(id, 'Test session id');
        const { record, assets } = await this._read(id, true);
        if (!record) throw new Error('Saved test audio session does not exist');
        await verifySavedEvidence(record, this.limits);
        const files = {}, inventory = new Map(assets.filter(Boolean).map(asset => [asset.clipId, asset]));
        for (const descriptor of record.clips) {
            const asset = inventory.get(descriptor.clipId);
            if (!asset || !(asset.bytes instanceof ArrayBuffer) || asset.bytes.byteLength !== descriptor.byteLength
                || await hashBytes(asset.bytes) !== descriptor.sha256
                || await hashBytes(asset.bytes.slice(WAV_HEADER_BYTES)) !== descriptor.pcmSha256) {
                throw new Error('Saved test WAV is missing or corrupt; export stopped without regenerating audio');
            }
            const view = new DataView(asset.bytes);
            if (view.getUint16(20, true) !== 3 || view.getUint16(22, true) !== 1
                || view.getUint32(24, true) !== descriptor.sampleRate || view.getUint32(46, true) !== descriptor.sampleCount) {
                throw new Error('Saved test WAV sample clock does not match its manifest');
            }
            files[descriptor.path] = new Uint8Array(asset.bytes);
        }
        for (const capture of record.captures) if (capture.clipId && !inventory.has(capture.clipId)) throw new Error('Test play points to unavailable saved audio');
        const { report, ...session } = record;
        const reportText = report === null ? null : `${JSON.stringify(report, null, 2)}\n`;
        if (reportText !== null) files['report.json'] = reportText;
        const manifest = { ...session, exportedAt: timestamp(), reportPath: reportText === null ? null : 'report.json',
            reportFileSha256: reportText === null ? null : await hashBytes(encoder.encode(reportText)),
            audioScope: 'Exact synthesized mono model output before playback resampling; no microphone or speaker recording.',
            preservation: 'IEEE float32 WAV; actual model sample rate; no regeneration, trimming, normalization or resampling.',
            privateProgressScope: 'Private progress preserves unfinished evaluation responses while report.json withholds feedback. This archive contains intended answers; inspecting it affects later blind judgments.',
            playbackScope: 'drained means the playback owner reported completion; stopped/error may have played only part. captured has no confirmed playback outcome.',
            missingAudio: record.captures.length ? 'Trials without a matching capture have no saved PCM; consult report.json for unplayed/skipped items.'
                : 'No PCM was captured for this report. Historical audio is unavailable and has not been regenerated.',
            clips: record.clips };
        files['manifest.json'] = `${JSON.stringify(manifest, null, 2)}\n`;
        const bytes = await Zip.create(files, { compress: false });
        if (bytes.byteLength > this.limits.sessionBytes + this.limits.recordBytes + this.limits.reportBytes + 1024 * 1024) throw new RangeError('Test audio ZIP exceeds its export limit');
        return new Blob([bytes], { type: 'application/zip' });
    }

    /** Delete exactly one explicitly selected session and its unshared clips. */
    async deleteSession(id) {
        identifier(id, 'Test session id');
        const database = await this._open();
        return new Promise((resolve, reject) => {
            const transaction = openIndexedDBTransaction(database, ['sessions', 'clips', 'state'], 'readwrite', { durability: 'strict' });
            const sessions = transaction.objectStore('sessions'), clips = transaction.objectStore('clips'), state = transaction.objectStore('state');
            const request = sessions.getAll(), usageRequest = state.get('usage');
            let remaining = 2, failure = null, output = { id, deleted: false, releasedBytes: 0 };
            const fail = error => { failure = error; transaction.abort(); };
            const ready = () => {
                if (--remaining) return;
                try {
                    const records = request.result, record = records.find(item => item.id === id), usage = usageRequest.result;
                    if (!record) return;
                    const references = new Map(), sizes = new Map();
                    for (const saved of records) {
                        // Deletion remains available after an instance lowers its
                        // capture limits; validate against the supported bounds.
                        validateRecord(saved, VOICE_LESSON_AUDIO_LIMITS);
                        for (const descriptor of saved.clips) {
                            references.set(descriptor.clipId, (references.get(descriptor.clipId) ?? 0) + 1);
                            if (sizes.has(descriptor.clipId) && sizes.get(descriptor.clipId) !== descriptor.byteLength) throw new Error('Saved test audio descriptors disagree');
                            sizes.set(descriptor.clipId, descriptor.byteLength);
                        }
                    }
                    const storedBytes = [...sizes.values()].reduce((sum, size) => sum + size, 0);
                    if (!usage || !Number.isSafeInteger(usage.sessions) || usage.sessions !== records.length
                        || usage.sessions < 1 || usage.sessions > VOICE_LESSON_AUDIO_LIMITS.sessions
                        || !Number.isSafeInteger(usage.audioBytes) || usage.audioBytes !== storedBytes
                        || usage.audioBytes < 0 || usage.audioBytes > VOICE_LESSON_AUDIO_LIMITS.totalBytes) throw new Error('Test archive usage is inconsistent');
                    const retainedClips = [];
                    const removeValidated = () => {
                        const releasedBytes = retainedClips.reduce((sum, clip) => sum + (clip.references === 1 ? clip.byteLength : 0), 0);
                        if (releasedBytes > usage.audioBytes) throw new Error('Test archive released bytes exceed stored bytes');
                        sessions.delete(id);
                        for (const clip of retainedClips) {
                            if (clip.references === 1) clips.delete(clip.clipId);
                            else clips.put({ ...clip, references: clip.references - 1 });
                        }
                        state.put({ ...usage, sessions: usage.sessions - 1, audioBytes: usage.audioBytes - releasedBytes });
                        output = { id, deleted: true, releasedBytes };
                    };
                    if (!record.clips.length) removeValidated();
                    for (const descriptor of record.clips) {
                        const clipRequest = clips.get(descriptor.clipId);
                        clipRequest.onsuccess = () => {
                            try {
                                const clip = clipRequest.result;
                                if (!clip || !Number.isSafeInteger(clip.references) || clip.references !== references.get(descriptor.clipId)
                                    || !(clip.bytes instanceof ArrayBuffer) || clip.bytes.byteLength !== descriptor.byteLength
                                    || Object.keys(descriptor).some(key => clip[key] !== descriptor[key])) throw new Error('Saved test audio references or descriptors are inconsistent');
                                retainedClips.push(clip);
                                if (retainedClips.length === record.clips.length) removeValidated();
                            } catch (error) { fail(error); }
                        };
                    }
                } catch (error) { fail(error); }
            };
            request.onsuccess = ready; usageRequest.onsuccess = ready;
            transaction.oncomplete = () => resolve(output);
            transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Selected test session could not be deleted'));
        });
    }

    async close() {
        if (this._database) (await this._database).close();
        this._database = null;
    }
}
