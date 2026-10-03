// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { Zip } from '../../../webgpu-os/packages/Zip.js';
import { openIndexedDBTransaction } from '../../../webgpu-os/storage/IndexedDBTransaction.js';
import { canonicalizeForHash, sha256HexOf, sha256HexOfBytes } from '../risk/ReceiptCrypto.js';

export const VOICE_EXPERIMENT_BUNDLE_VERSION = 'particle-voice-experiment-bundle-v1';
export const VOICE_EXPERIMENT_LIMITS = Object.freeze({
    assetBytes: 32 * 1024 * 1024, totalAssetBytes: 128 * 1024 * 1024,
    bundleBytes: 196 * 1024 * 1024, manifestBytes: 64 * 1024 * 1024,
    recordBytes: 2 * 1024 * 1024, assets: 256, revisions: 512, referenceSeconds: 120,
});
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const HASH = /^[a-f0-9]{64}$/;
const STORE_SCHEMA = 'particle-voice-experiment-store-v1';
const MAX_DOCUMENT_BYTES = VOICE_EXPERIMENT_LIMITS.manifestBytes - 1024;

export function voiceExperimentCapabilities() {
    return Object.freeze({ indexedDB: !!globalThis.indexedDB, sha256: !!globalThis.crypto?.subtle,
        referenceDecode: !!(globalThis.AudioContext || globalThis.webkitAudioContext || globalThis.OfflineAudioContext) });
}

function identifier(value, label = 'id') {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value)) {
        throw new TypeError(`${label} must be 1–200 letters, digits, dots, underscores, colons or hyphens`);
    }
    return value;
}

// Reject lossy JSON coercions before hashing. Plans must explicitly serialize typed arrays.
function jsonSnapshot(value, maximumBytes = VOICE_EXPERIMENT_LIMITS.recordBytes) {
    const seen = new Set(); let nodes = 0;
    function visit(item, depth) {
        if (++nodes > 8000000 || depth > 32) throw new RangeError('Experiment JSON exceeds structural limits');
        if (item === null || typeof item === 'boolean' || typeof item === 'string') return;
        if (typeof item === 'number' && Number.isFinite(item)) return;
        if (!item || typeof item !== 'object' || (!Array.isArray(item)
            && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)) {
            throw new TypeError('Experiment data must contain only finite JSON values');
        }
        if (seen.has(item)) throw new TypeError('Experiment JSON must not contain cycles');
        seen.add(item);
        if (Array.isArray(item)) {
            for (let i = 0; i < item.length; i++) visit(item[i], depth + 1);
        } else {
            for (const key of Reflect.ownKeys(item)) {
                if (typeof key !== 'string') throw new TypeError('Experiment JSON cannot contain symbol keys');
                const descriptor = Object.getOwnPropertyDescriptor(item, key);
                if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError('Experiment JSON must contain plain data properties');
                visit(descriptor.value, depth + 1);
            }
        }
        seen.delete(item);
    }
    visit(value, 0);
    const text = JSON.stringify(value);
    if (encoder.encode(text).byteLength > maximumBytes) throw new RangeError('Experiment JSON exceeds byte limit');
    return JSON.parse(text);
}

function equalJson(a, b) { return JSON.stringify(canonicalizeForHash(a)) === JSON.stringify(canonicalizeForHash(b)); }
function jsonBytes(value) { return encoder.encode(JSON.stringify(value)).byteLength; }
function equalBytes(a, b) {
    if (!(a instanceof ArrayBuffer) || a.byteLength !== b.byteLength) return false;
    const left = new Uint8Array(a), right = new Uint8Array(b);
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
    return true;
}
async function hashJson(value) {
    const hash = await sha256HexOf(value);
    if (!hash) throw new Error('SHA-256 is required for experiment provenance');
    return hash;
}
async function hashBytes(bytes) {
    const hash = await sha256HexOfBytes(bytes);
    if (!hash) throw new Error('SHA-256 is required for experiment assets');
    return hash;
}
function assertRecord(record) {
    if (!record || Array.isArray(record) || typeof record !== 'object') throw new TypeError('Experiment record must be a JSON object');
    identifier(record.id, 'Experiment id');
}
function byteCopy(value) {
    if (!(value instanceof ArrayBuffer)) throw new TypeError('Asset bytes must be an ArrayBuffer');
    if (value.byteLength > VOICE_EXPERIMENT_LIMITS.assetBytes) throw new RangeError('Asset exceeds byte limit');
    return value.slice(0);
}
function assetDescriptor(asset, bytes, hash) {
    const { bytes: ignored, ...metadata } = asset;
    const descriptor = jsonSnapshot(metadata);
    identifier(descriptor.id, 'Asset id');
    if (typeof descriptor.mimeType !== 'string' || !descriptor.mimeType || descriptor.mimeType.length > 200) {
        throw new TypeError('Asset mimeType is required');
    }
    if (descriptor.sha256 !== undefined && descriptor.sha256 !== hash) throw new Error('Asset SHA-256 does not match its bytes');
    if (descriptor.id.startsWith('sha256:') && descriptor.id !== `sha256:${hash}`) throw new Error('Content-addressed asset id does not match its bytes');
    if (descriptor.byteLength !== undefined && descriptor.byteLength !== bytes.byteLength) throw new Error('Asset byteLength does not match its bytes');
    return { ...descriptor, sha256: hash, byteLength: bytes.byteLength };
}
async function prepareAssets(assets) {
    if (!Array.isArray(assets) || assets.length > VOICE_EXPERIMENT_LIMITS.assets) throw new RangeError('Invalid experiment asset count');
    // Snapshot all bytes and metadata before the first await to prevent caller races.
    const copies = assets.map(asset => {
        if (!asset || typeof asset !== 'object') throw new TypeError('Invalid experiment asset');
        const { bytes, ...metadata } = asset;
        return { ...jsonSnapshot(metadata), bytes: byteCopy(bytes) };
    });
    const ids = new Map(), prepared = [];
    let total = 0;
    for (const asset of copies) {
        const descriptor = assetDescriptor(asset, asset.bytes, await hashBytes(asset.bytes));
        if (ids.has(asset.id)) {
            if (!equalJson(ids.get(asset.id), descriptor)) throw new Error(`Conflicting duplicate asset id: ${asset.id}`);
            continue;
        }
        ids.set(asset.id, descriptor); total += asset.bytes.byteLength;
        if (total > VOICE_EXPERIMENT_LIMITS.totalAssetBytes) throw new RangeError('Experiment assets exceed total byte limit');
        prepared.push({ descriptor, bytes: asset.bytes });
    }
    return prepared;
}
function mergeAssets(previous, incoming) {
    const merged = new Map(previous.map(asset => [asset.id, asset]));
    for (const asset of incoming) {
        if (merged.has(asset.id) && !equalJson(merged.get(asset.id), asset)) throw new Error(`Immutable asset changed: ${asset.id}`);
        merged.set(asset.id, asset);
    }
    const assets = [...merged.values()];
    if (assets.length > VOICE_EXPERIMENT_LIMITS.assets
        || assets.reduce((sum, asset) => sum + asset.byteLength, 0) > VOICE_EXPERIMENT_LIMITS.totalAssetBytes) {
        throw new RangeError('Experiment assets exceed storage limits');
    }
    return assets;
}
function latest(document) { return document?.revisions.at(-1) ?? null; }

function preserveFields(previous, current, fields, label) {
    for (const key of fields) if (!equalJson(previous[key] ?? null, current[key] ?? null)) throw new Error(`Immutable ${label} changed: ${key}`);
}
function preserveEntries(previous, current, label) {
    if (!Array.isArray(previous) || !Array.isArray(current) || current.length < previous.length
        || previous.some((item, index) => !equalJson(item, current[index]))) throw new Error(`${label} must be append-only`);
}
function preserveEvidence(previous, current) {
    if (previous.schemaVersion !== 'particle-voice-experiment/v1') return;
    preserveFields(previous, current, ['schemaVersion', 'id', 'manifest', 'manifestHash', 'createdAt', 'sourceReport', 'sourceReportHash'], 'experiment');
    if (previous.resolvedTractConfiguration != null) preserveFields(previous, current, ['resolvedTractConfiguration'], 'resolved tract configuration');
    if (!Array.isArray(previous.trials) || !Array.isArray(current.trials) || previous.trials.length !== current.trials.length) throw new Error('Frozen experiment trial set changed');
    previous.trials.forEach((trial, index) => {
        const next = current.trials[index];
        if (!next) throw new Error('Frozen trial is missing');
        preserveFields(trial, next, ['id', 'targetId', 'variantId', 'text', 'role', 'review', 'renderPath', 'phones', 'planHash', 'planAssetId', 'controlsAudit', 'order'], 'trial');
        if (trial.state === 'completed') preserveFields(trial, next, ['state', 'pcmAssetId', 'audioIdentity', 'metrics'], 'completed render');
        if (trial.targetExposed && !next.targetExposed) throw new Error('Trial exposure cannot be erased');
        for (const field of ['plays', 'responses']) preserveEntries(trial[field], next[field], `Trial ${field}`);
    });
    for (const field of ['observations', 'preferences', 'acceptance', 'references', 'errors']) preserveEntries(previous[field], current[field], field);
    preserveEntries(previous.referenceAnnotations ?? [], current.referenceAnnotations ?? [], 'referenceAnnotations');
    preserveEntries(previous.referenceComparisons ?? [], current.referenceComparisons ?? [], 'referenceComparisons');
}

/** Validate manual comparison receipts against the exact assets in that revision.
 * A validated, append-only prefix may be skipped when checking the next revision.
 * This verifies provenance and display settings, not acoustic correspondence.
 */
export async function validateVoiceReferenceComparisons(record, descriptors, startIndex = 0) {
    if (record.schemaVersion !== 'particle-voice-experiment/v1') return;
    const comparisons = record.referenceComparisons === undefined ? [] : record.referenceComparisons;
    if (!Array.isArray(comparisons) || comparisons.length > 128 || !Number.isInteger(startIndex)
        || startIndex < 0 || startIndex > comparisons.length) throw new Error('Invalid reference comparison history.');
    const assets = descriptors instanceof Map ? descriptors : new Map(descriptors.map(asset => [asset.id, asset]));
    const exactFields = (value, fields) => value && !Array.isArray(value) && typeof value === 'object'
        && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
    const regionValid = (region, source) => exactFields(region, ['startSample', 'endSample', 'anchorSample'])
        && [region.startSample, region.endSample, region.anchorSample].every(Number.isInteger)
        && region.startSample >= 0 && region.endSample > region.startSample && region.endSample <= source.sampleCount
        && region.endSample - region.startSample <= source.sampleRate * 10
        && region.anchorSample >= region.startSample && region.anchorSample < region.endSample;
    let previousTime = startIndex ? Date.parse(comparisons[startIndex - 1].at) : Date.parse(record.createdAt);
    for (let index = startIndex; index < comparisons.length; index++) {
        const entry = comparisons[index], at = Date.parse(entry?.at);
        const trial = record.trials?.find(item => item.id === entry?.trialId);
        const reference = record.references?.[entry?.referenceIndex];
        if (!exactFields(entry, ['schemaVersion', 'sequence', 'at', 'origin', 'manifestHash', 'trialId', 'referenceIndex',
            'generated', 'reference', 'analysis', 'alignmentEnabled', 'comparisonHash'])
            || entry.schemaVersion !== 'particle-voice-reference-comparison/v1' || entry.sequence !== index + 1
            || typeof entry.alignmentEnabled !== 'boolean'
            || entry.origin !== 'manual-inspection' || !Number.isFinite(at) || !Number.isFinite(previousTime) || at < previousTime
            || entry.manifestHash !== record.manifestHash || !Number.isInteger(entry.referenceIndex) || !reference
            || !trial || trial.state !== 'completed' || !trial.targetExposed) {
            throw new Error('Manual comparison has invalid history, target exposure or reference provenance.');
        }
        const generatedAsset = assets.get(trial.pcmAssetId), referenceAsset = assets.get(reference.pcmAssetId);
        const sources = [
            [entry.generated, generatedAsset, trial.pcmAssetId, trial.audioIdentity?.digest, 'particle-voice-pcm-f32le-v1'],
            [entry.reference, referenceAsset, reference.pcmAssetId, `sha256:${reference.pcmSha256}`, 'raw-f32le-sha256'],
        ];
        for (const [source, asset, assetId, pcmHash, identityEncoding] of sources) {
            const byteLength = asset?.byteLength ?? asset?.bytes?.byteLength;
            if (!exactFields(source, ['pcmAssetId', 'pcmHash', 'identityEncoding', 'sampleRate', 'sampleCount', 'region'])
                || !asset || source.pcmAssetId !== assetId || source.pcmHash !== pcmHash || !/^sha256:[a-f0-9]{64}$/.test(source.pcmHash)
                || source.identityEncoding !== identityEncoding || source.sampleRate !== asset.sampleRate
                || source.sampleCount !== asset.sampleCount || !Number.isInteger(source.sampleRate) || source.sampleRate < 8000
                || source.sampleRate > 192000 || !Number.isInteger(source.sampleCount) || source.sampleCount < 1
                || byteLength !== source.sampleCount * 4 || !regionValid(source.region, source)) {
                throw new Error('Manual comparison samples or anchors do not match their immutable PCM clock.');
            }
        }
        const analysis = entry.analysis;
        if (!exactFields(analysis, ['fftSize', 'hopSize', 'window', 'floorDb'])
            || ![512, 1024, 2048, 4096].includes(analysis.fftSize) || analysis.hopSize !== analysis.fftSize / 4
            || analysis.window !== 'hann' || analysis.floorDb !== -100) throw new Error('Unsupported reference analysis display settings.');
        const { comparisonHash, ...payload } = entry;
        if (comparisonHash !== `sha256:${await hashJson(payload)}`) throw new Error('Reference comparison receipt hash mismatch.');
        previousTime = at;
    }
}
function validateAssetReferences(record, descriptors) {
    if (record.schemaVersion !== 'particle-voice-experiment/v1') return;
    const ids = new Set(descriptors.map(asset => asset.id));
    if (!Array.isArray(record.trials)) throw new Error('Experiment trials are required');
    for (const trial of record.trials) {
        if (!ids.has(trial.planAssetId) || (trial.pcmAssetId !== null && !ids.has(trial.pcmAssetId))) throw new Error('Trial asset is missing');
    }
}

/** Standalone lab storage. Does not instantiate an OS kernel, sandbox or audio session. */
export class VoiceExperimentStore {
    constructor({ databaseName = 'particle-voice-experiments-v1' } = {}) {
        if (typeof databaseName !== 'string' || !databaseName || databaseName.length > 200) throw new TypeError('Invalid database name');
        this.databaseName = databaseName;
        this._database = null;
        this._validatedDocuments = new Map();
    }

    _remember(document, byteLength = jsonBytes(document)) {
        this._validatedDocuments.delete(document.id);
        this._validatedDocuments.set(document.id, { document, byteLength, assetsByteLength: jsonBytes(document.assets) });
        // Most lab sessions need one active experiment and its source report.
        while (this._validatedDocuments.size > 4) this._validatedDocuments.delete(this._validatedDocuments.keys().next().value);
    }

    async _open() {
        if (!globalThis.indexedDB) throw new Error('IndexedDB is unavailable for experiment persistence');
        if (!this._database) this._database = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.databaseName, 1);
            let abandoned = false;
            request.onupgradeneeded = () => {
                request.result.createObjectStore('experiments', { keyPath: 'id' });
                request.result.createObjectStore('blobs', { keyPath: 'sha256' });
            };
            request.onsuccess = () => {
                if (abandoned) { request.result.close(); return; }
                request.result.onversionchange = () => { request.result.close(); this._database = null; };
                resolve(request.result);
            };
            request.onerror = () => { this._database = null; reject(request.error); };
            request.onblocked = () => { abandoned = true; this._database = null; reject(new Error('Experiment database upgrade is blocked by another tab')); };
        });
        return this._database;
    }

    async _read(id) {
        const database = await this._open();
        return new Promise((resolve, reject) => {
            const transaction = openIndexedDBTransaction(database, ['experiments']);
            const request = transaction.objectStore('experiments').get(id);
            transaction.oncomplete = () => resolve(request.result ?? null);
            transaction.onabort = () => reject(transaction.error ?? new Error('Experiment read aborted'));
        });
    }

    async _commit(document, prepared, expectedReceiptHash) {
        const database = await this._open();
        return new Promise((resolve, reject) => {
            const transaction = openIndexedDBTransaction(database, ['experiments', 'blobs'], 'readwrite', { durability: 'strict' });
            let failure = null;
            const fail = error => { failure = error; transaction.abort(); };
            const records = transaction.objectStore('experiments'), blobs = transaction.objectStore('blobs');
            const request = records.get(document.id);
            request.onsuccess = () => {
                try {
                    if ((latest(request.result)?.receipt.receiptHash ?? null) !== expectedReceiptHash) {
                        throw new Error('Experiment changed concurrently; reload before saving');
                    }
                    records.put(document);
                    for (const asset of new Map(prepared.map(item => [item.descriptor.sha256, item])).values()) {
                        const existing = blobs.get(asset.descriptor.sha256);
                        existing.onsuccess = () => {
                            if (existing.result && !equalBytes(existing.result.bytes, asset.bytes)) fail(new Error('Stored content-addressed blob is corrupt'));
                            else if (!existing.result) blobs.add({ sha256: asset.descriptor.sha256, bytes: asset.bytes });
                        };
                    }
                } catch (error) { fail(error); }
            };
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Experiment write aborted'));
        });
    }

    async saveExperiment(record, assets = []) {
        const snapshot = jsonSnapshot(record); assertRecord(snapshot);
        const preparing = prepareAssets(assets);
        const cached = this._validatedDocuments.get(snapshot.id);
        const [prepared, previous, recordHash] = await Promise.all([preparing, cached?.document ?? this._read(snapshot.id), hashJson(snapshot)]);
        const allAssets = mergeAssets(previous?.assets ?? [], prepared.map(item => item.descriptor));
        const prior = latest(previous);
        if (previous) { if (!cached) await validateDocument(previous); preserveEvidence(prior.record, snapshot); }
        validateAssetReferences(snapshot, allAssets);
        await validateVoiceReferenceComparisons(snapshot, allAssets, prior?.record.referenceComparisons?.length ?? 0);
        if (prior?.receipt.recordHash === recordHash && equalJson(previous.assets, allAssets)) {
            try { await this._commit(previous, prepared, prior.receipt.receiptHash); }
            catch (error) { this._validatedDocuments.delete(snapshot.id); throw error; }
            return structuredClone(prior.receipt);
        }
        const revision = (prior?.receipt.revision ?? 0) + 1;
        if (revision > VOICE_EXPERIMENT_LIMITS.revisions) throw new RangeError('Experiment revision limit reached');
        const receipt = { id: snapshot.id, revision, recordHash, assetIds: allAssets.map(asset => asset.id),
            assetHashes: allAssets.map(asset => asset.sha256), previousReceiptHash: prior?.receipt.receiptHash ?? null,
            updatedAt: new Date().toISOString() };
        receipt.receiptHash = await hashJson(receipt);
        const entry = { record: snapshot, receipt };
        const document = { schema: STORE_SCHEMA, id: snapshot.id, assets: allAssets,
            revisions: [...(previous?.revisions ?? []), entry] };
        // Previous entries are private, already validated snapshots. Append the
        // new entry without rehashing/copying every historic plan at each play.
        const byteLength = previous ? (cached?.byteLength ?? jsonBytes(previous))
            - (cached?.assetsByteLength ?? jsonBytes(previous.assets)) + jsonBytes(allAssets) + jsonBytes(entry) + 1
            : jsonBytes(document);
        if (byteLength > MAX_DOCUMENT_BYTES) throw new RangeError('Experiment history exceeds byte limit');
        try { await this._commit(document, prepared, prior?.receipt.receiptHash ?? null); }
        catch (error) { this._validatedDocuments.delete(snapshot.id); throw error; }
        this._remember(document, byteLength);
        return structuredClone(receipt);
    }

    async _assets(descriptors) {
        const database = await this._open();
        const values = await new Promise((resolve, reject) => {
            const transaction = openIndexedDBTransaction(database, ['blobs']);
            const requests = descriptors.map(asset => transaction.objectStore('blobs').get(asset.sha256));
            transaction.oncomplete = () => resolve(requests.map(request => request.result));
            transaction.onabort = () => reject(transaction.error ?? new Error('Experiment asset read aborted'));
        });
        const assets = [];
        for (let i = 0; i < descriptors.length; i++) {
            const bytes = values[i]?.bytes, descriptor = descriptors[i];
            if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== descriptor.byteLength
                || await hashBytes(bytes) !== descriptor.sha256) throw new Error(`Stored asset is missing or corrupt: ${descriptor.id}`);
            assets.push({ ...structuredClone(descriptor), bytes });
        }
        return assets;
    }

    async loadExperiment(id, { revision = null } = {}) {
        identifier(id, 'Experiment id');
        const document = await this._read(id);
        if (!document) return null;
        await validateDocument(document);
        if (revision !== null && (!Number.isInteger(revision) || revision < 1)) throw new RangeError('Invalid experiment revision');
        const entry = revision === null ? latest(document) : document.revisions[revision - 1];
        if (!entry) throw new RangeError('Experiment revision does not exist');
        const ids = new Set(entry.receipt.assetIds);
        const assets = await this._assets(document.assets.filter(asset => ids.has(asset.id)));
        this._remember(document);
        return { record: structuredClone(entry.record), receipt: structuredClone(entry.receipt),
            revisions: document.revisions.map(item => structuredClone(item.receipt)), assets };
    }

    async listExperiments() {
        const database = await this._open();
        const documents = await new Promise((resolve, reject) => {
            const transaction = openIndexedDBTransaction(database, ['experiments']);
            const request = transaction.objectStore('experiments').getAll();
            transaction.oncomplete = () => resolve(request.result);
            transaction.onabort = () => reject(transaction.error ?? new Error('Experiment listing aborted'));
        });
        return documents.map(document => {
            const entry = latest(document);
            return { ...entry.receipt, schemaVersion: entry.record.schemaVersion ?? null,
                title: String(entry.record.title ?? entry.record.label ?? entry.record.id) };
        }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    }

    async exportExperiment(id) {
        identifier(id, 'Experiment id');
        const document = await this._read(id);
        if (!document) throw new Error('Experiment does not exist');
        await validateDocument(document);
        const assets = await this._assets(document.assets);
        const manifest = { version: VOICE_EXPERIMENT_BUNDLE_VERSION, document, documentHash: await hashJson(document) };
        const files = { 'manifest.json': JSON.stringify(manifest) };
        for (const asset of assets) files[`assets/${asset.sha256}.bin`] = new Uint8Array(asset.bytes);
        const bytes = await Zip.create(files, { compress: false });
        if (bytes.byteLength > VOICE_EXPERIMENT_LIMITS.bundleBytes) throw new RangeError('Experiment bundle exceeds byte limit');
        return new Blob([bytes], { type: 'application/zip' });
    }

    async importExperiment(blob) {
        if (!(blob instanceof Blob) || blob.size > VOICE_EXPERIMENT_LIMITS.bundleBytes) throw new RangeError('Invalid or oversized experiment bundle');
        const files = await Zip.parse(new Uint8Array(await blob.arrayBuffer()), { maxFiles: VOICE_EXPERIMENT_LIMITS.assets + 1,
            maxTotalBytes: VOICE_EXPERIMENT_LIMITS.totalAssetBytes + VOICE_EXPERIMENT_LIMITS.manifestBytes,
            maxEntryBytes: Math.max(VOICE_EXPERIMENT_LIMITS.assetBytes, VOICE_EXPERIMENT_LIMITS.manifestBytes) });
        const manifestBytes = files.get('manifest.json');
        if (!manifestBytes || manifestBytes.byteLength > VOICE_EXPERIMENT_LIMITS.manifestBytes) throw new Error('Invalid experiment manifest');
        const manifest = jsonSnapshot(JSON.parse(decoder.decode(manifestBytes)), VOICE_EXPERIMENT_LIMITS.manifestBytes);
        if (manifest.version !== VOICE_EXPERIMENT_BUNDLE_VERSION || !manifest.document
            || await hashJson(manifest.document) !== manifest.documentHash) throw new Error('Experiment manifest version or hash is invalid');
        const document = manifest.document;
        await validateDocument(document);
        const expectedPaths = new Set(['manifest.json']), prepared = [];
        for (const descriptor of document.assets) {
            const path = `assets/${descriptor.sha256}.bin`; expectedPaths.add(path);
            const bytes = files.get(path);
            if (!bytes || bytes.byteLength !== descriptor.byteLength || await hashBytes(bytes) !== descriptor.sha256) {
                throw new Error(`Bundle asset is missing or corrupt: ${descriptor.id}`);
            }
            prepared.push({ descriptor, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
        }
        if (files.size !== expectedPaths.size || [...files.keys()].some(path => !expectedPaths.has(path))) throw new Error('Bundle contains undeclared files');
        // Verification above completes before even opening a write transaction.
        const existing = await this._read(document.id);
        if (existing) {
            await validateDocument(existing);
            for (let i = 0; i < Math.min(existing.revisions.length, document.revisions.length); i++) {
                if (existing.revisions[i].receipt.receiptHash !== document.revisions[i].receipt.receiptHash) {
                    throw new Error('Imported experiment conflicts with local revision history');
                }
            }
            mergeAssets(existing.assets, document.assets);
            if (existing.revisions.length >= document.revisions.length) {
                await this._assets(existing.assets);
                this._remember(existing);
                return document.id;
            }
        }
        try { await this._commit(document, prepared, latest(existing)?.receipt.receiptHash ?? null); }
        catch (error) { this._validatedDocuments.delete(document.id); throw error; }
        this._remember(document);
        return document.id;
    }

    async close() {
        if (this._database) (await this._database).close();
        this._database = null;
        this._validatedDocuments.clear();
    }
}

async function validateDocument(document) {
    jsonSnapshot(document, MAX_DOCUMENT_BYTES);
    if (document.schema !== STORE_SCHEMA || !Array.isArray(document.assets) || !Array.isArray(document.revisions)
        || document.revisions.length < 1 || document.revisions.length > VOICE_EXPERIMENT_LIMITS.revisions) throw new Error('Invalid experiment document');
    identifier(document.id, 'Experiment id');
    const assets = new Map();
    for (const asset of document.assets) {
        identifier(asset.id, 'Asset id');
        if (assets.has(asset.id) || !HASH.test(asset.sha256) || (asset.id.startsWith('sha256:') && asset.id !== `sha256:${asset.sha256}`)
            || !Number.isInteger(asset.byteLength) || asset.byteLength < 0
            || asset.byteLength > VOICE_EXPERIMENT_LIMITS.assetBytes || typeof asset.mimeType !== 'string'
            || !asset.mimeType || asset.mimeType.length > 200) throw new Error('Invalid experiment asset descriptor');
        assets.set(asset.id, asset);
    }
    mergeAssets([], document.assets);
    let previousHash = null, previousIds = [];
    for (let i = 0; i < document.revisions.length; i++) {
        const { record, receipt } = document.revisions[i];
        assertRecord(record); jsonSnapshot(record);
        if (!receipt || record.id !== document.id || receipt.id !== document.id || receipt.revision !== i + 1
            || receipt.previousReceiptHash !== previousHash || !Array.isArray(receipt.assetIds) || !Array.isArray(receipt.assetHashes)
            || receipt.assetHashes.length !== receipt.assetIds.length || new Set(receipt.assetIds).size !== receipt.assetIds.length
            || previousIds.some((id, index) => receipt.assetIds[index] !== id)
            || typeof receipt.updatedAt !== 'string' || !Number.isFinite(Date.parse(receipt.updatedAt))) throw new Error('Invalid experiment revision chain');
        for (let j = 0; j < receipt.assetIds.length; j++) {
            if (!assets.has(receipt.assetIds[j]) || assets.get(receipt.assetIds[j]).sha256 !== receipt.assetHashes[j]) throw new Error('Revision asset reference is invalid');
        }
        validateAssetReferences(record, receipt.assetIds.map(id => assets.get(id)));
        if (i > 0) preserveEvidence(document.revisions[i - 1].record, record);
        await validateVoiceReferenceComparisons(record, receipt.assetIds.map(id => assets.get(id)),
            i ? document.revisions[i - 1].record.referenceComparisons?.length ?? 0 : 0);
        if (await hashJson(record) !== receipt.recordHash) throw new Error('Experiment record hash mismatch');
        const { receiptHash, ...payload } = receipt;
        if (await hashJson(payload) !== receiptHash) throw new Error('Experiment receipt hash mismatch');
        previousHash = receiptHash; previousIds = receipt.assetIds;
    }
    if (!equalJson(previousIds, document.assets.map(asset => asset.id))) throw new Error('Experiment has unreferenced or reordered assets');
}

/** Authorized file-only import; caller owns decoding context and any playback. */
export async function decodeVoiceReference(file, { audioContext, transcript, authorization } = {}) {
    if (authorization !== true && !(typeof authorization === 'string' && authorization.trim() && authorization.length <= 2048)) {
        throw new TypeError('Explicit recording authorization is required');
    }
    if (typeof transcript !== 'string' || !transcript.trim() || transcript.length > 8000) throw new TypeError('A bounded reference transcript is required');
    if (!(file instanceof Blob) || file.size < 1 || file.size > VOICE_EXPERIMENT_LIMITS.assetBytes) throw new RangeError('Invalid or oversized reference file');
    if (!audioContext || typeof audioContext.decodeAudioData !== 'function') throw new TypeError('An existing audio decoding context is required');
    const originalBytes = await file.arrayBuffer();
    const originalHash = await hashBytes(originalBytes);
    // decodeAudioData can detach its input and resamples to the supplied context's rate.
    const decoded = await audioContext.decodeAudioData(originalBytes.slice(0));
    const { length, sampleRate, numberOfChannels } = decoded;
    if (!Number.isInteger(length) || length < 1 || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000
        || !Number.isInteger(numberOfChannels) || numberOfChannels < 1 || numberOfChannels > 8
        || length / sampleRate > VOICE_EXPERIMENT_LIMITS.referenceSeconds || length * 4 > VOICE_EXPERIMENT_LIMITS.assetBytes) {
        throw new RangeError('Decoded reference exceeds duration, rate, channel or sample limits');
    }
    const channels = Array.from({ length: numberOfChannels }, (_, channel) => decoded.getChannelData(channel));
    const monoBytes = new ArrayBuffer(length * 4), view = new DataView(monoBytes);
    let originalPeak = 0, originalClipped = 0, originalSum = 0, monoPeak = 0, monoClipped = 0, monoSum = 0, monoSquares = 0;
    for (let i = 0; i < length; i++) {
        let sum = 0;
        for (const channel of channels) {
            const sample = channel[i];
            if (!Number.isFinite(sample)) throw new Error('Decoded reference contains nonfinite samples');
            originalPeak = Math.max(originalPeak, Math.abs(sample));
            if (Math.abs(sample) >= 0.999) originalClipped++;
            originalSum += sample; sum += sample;
        }
        const mono = Math.fround(sum / numberOfChannels);
        view.setFloat32(i * 4, mono, true);
        monoPeak = Math.max(monoPeak, Math.abs(mono)); monoSum += mono; monoSquares += mono * mono;
        if (Math.abs(mono) >= 0.999) monoClipped++;
    }
    const pcmHash = await hashBytes(monoBytes), originalAssetId = `reference-original-${originalHash}`, pcmAssetId = `reference-pcm-${pcmHash}-${sampleRate}`;
    const analysis = { method: 'sample-statistics-v1', decodedChannels: numberOfChannels,
        originalDecoded: { peak: originalPeak, clippedSamples: originalClipped, clippedFraction: originalClipped / (length * numberOfChannels), dcOffset: originalSum / (length * numberOfChannels) },
        mono: { peak: monoPeak, clippedSamples: monoClipped, clippedFraction: monoClipped / length, dcOffset: monoSum / length, rms: Math.sqrt(monoSquares / length) } };
    return {
        assets: [
            { id: originalAssetId, bytes: originalBytes, mimeType: file.type || 'application/octet-stream', role: 'reference-original', sha256: originalHash },
            { id: pcmAssetId, bytes: monoBytes, mimeType: 'application/octet-stream', role: 'reference-decoded-mono', sha256: pcmHash,
                encoding: 'float32-le', sampleRate, channels: 1, sampleCount: length },
        ],
        reference: { originalAssetId, pcmAssetId, originalSha256: originalHash, pcmSha256: pcmHash,
            filename: typeof file.name === 'string' ? file.name : '', transcript, authorization,
            sampleRate, channels: 1, sampleCount: length, durationSeconds: length / sampleRate,
            decoding: 'browser decodeAudioData at supplied context rate; arithmetic channel mean; no trimming or normalization',
            analysis, annotations: [] },
    };
}
