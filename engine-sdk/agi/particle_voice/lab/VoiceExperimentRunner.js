// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Bounded, persisted development experiments over the host's existing model.
 * Acceptance selects saved lab assets; it never changes the production voice.
 */
import { receiptHashOf, sha256HexOfBytes } from '../risk/ReceiptCrypto.js';
import { ListeningEvaluation, scoreTranscription, LISTENING_SCORING_VERSION } from './ListeningEvaluation.js';
import { voiceLabAudioIdentity, pronunciationTrace } from './VoiceLabDiagnostics.js';
import { G2PModel, textToPhonemeSequence } from '../frontend/G2PModel.js';
import { PronunciationLexicon, LETTER_NAMES } from '../frontend/PronunciationLexicon.js';
import { normalizeText } from '../frontend/TextNormalizer.js';
import { VOICE_EXPERIMENT_VARIANTS, applyVoiceExperimentControls, buildVoiceExperimentCapability } from './VoiceExperimentControls.js';
import { encodeVoiceLessonWav } from './VoiceLessonAudioArchive.js';
import { validateVoiceReferenceComparisons } from './VoiceExperimentStore.js';
import { Zip } from '../../../webgpu-os/packages/Zip.js';

export const VOICE_EXPERIMENT_SCHEMA = 'particle-voice-experiment/v1';
const SCORING = Object.freeze({ version: LISTENING_SCORING_VERSION,
    firstResponse: 'locked-before-replay', evaluator: 'human', exposure: 'candidate-blind-development',
    acceptance: 'paired-development-improvement-transfer-and-protected-exact-v1' });
const BANK = [
    ['key', 'key', 'development', true], ['tea', 'tea', 'development', true],
    ['cap', 'cap', 'transfer', true], ['tap', 'tap', 'transfer', false],
    ['coat', 'coat', 'transfer', false], ['tote', 'tote', 'transfer', false],
    ['cool', 'cool', 'transfer', true], ['tool', 'tool', 'transfer', false],
    ['keep', 'keep', 'manner-control', false], ['cheap', 'cheap', 'manner-control', false],
    ['goat', 'goat', 'voicing-control', false], ['sock', 'sock', 'coda-control', false],
    ['x', 'X', 'protected', true, 'EH2 K S'],
    ['numbers', 'I can see two green cups.', 'protected', true],
    ['moon', 'The moon is up.', 'connected', false],
    ['wet', 'My sock is wet.', 'connected', false],
    ['door', 'The key is by the door.', 'connected', false],
    ['here', 'Please wait here now.', 'connected', false],
    ['key-is', 'The key is here.', 'connected', false],
    ['key-ladder', 'Take the key to the door.', 'connected', false],
].map(([id, text, role, review, phones = null]) => Object.freeze({ id, text, role, review, phones }));
export const VOICE_EXPERIMENT_TARGETS = Object.freeze(BANK);
const clone = (value) => structuredClone(value);
const timestamp = () => new Date().toISOString();
const encode = (value) => new TextEncoder().encode(JSON.stringify(value, (_key, item) =>
    ArrayBuffer.isView(item) ? { arrayType: item.constructor.name, values: Array.from(item) } : item)).buffer;
function text(value, name, max = 2000) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TypeError(`${name} is required (maximum ${max} characters).`);
    return value.trim();
}
function aborted() { return new DOMException('Voice experiment cancelled.', 'AbortError'); }
const LETTER_G2P = new G2PModel({ lexicon: new PronunciationLexicon({ entries: LETTER_NAMES }) });
function planTarget(model, target) {
    // Preserve the exact classroom X, including terminal punctuation/prosody.
    // Bare explicit phones are a different timing condition and not this control.
    return target.id === 'x' ? model.planSequence(textToPhonemeSequence(normalizeText('x.'), { g2p: LETTER_G2P }))
        : model.plan(target.text);
}
function stableConfiguration(configuration) {
    // Tract allocation is lazy. Its measured settings are frozen independently
    // at the first successful render, not mistaken for an authored change.
    const { tract, ...settings } = configuration;
    return settings;
}
function jsonPlan(plan) {
    const { experiment, experimentMetadata, voiceExperiment, ...body } = plan;
    return JSON.parse(new TextDecoder().decode(encode(body)));
}

// Stored plan assets use this explicit, lossless typed-array representation.
// Resolve only the constructors emitted by the authored planner, never a name
// supplied as a property lookup on globalThis or an executable constructor.
function restoredPlan(value) {
    const types = { Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array };
    let nodes = 0;
    function restore(item, depth = 0) {
        if (++nodes > 2000000 || depth > 32) throw new RangeError('Saved plan exceeds structural limits.');
        if (item === null || typeof item !== 'object') return item;
        if (Array.isArray(item)) return item.map(entry => restore(entry, depth + 1));
        if (Object.hasOwn(item, 'arrayType')) {
            if (Object.keys(item).length !== 2 || !Object.hasOwn(types, item.arrayType)
                || !Array.isArray(item.values) || item.values.length > 768000
                || !item.values.every(value => typeof value === 'number' && Number.isFinite(value))) {
                throw new Error('Unsupported saved plan array.');
            }
            const result = new types[item.arrayType](item.values);
            if (!result.every((value, index) => value === item.values[index])) throw new Error('Saved plan array loses numeric precision.');
            return result;
        }
        return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, restore(entry, depth + 1)]));
    }
    return restore(value);
}

function validateTrialResponses(trial) {
    if (typeof trial.targetExposed !== 'boolean' || trial.plays.length > 1024 || trial.responses.length > 1024) {
        throw new Error('Invalid or oversized listening history.');
    }
    let priorTime = -Infinity, visible = false;
    for (const play of trial.plays) {
        const time = Date.parse(play?.at);
        if (!Number.isFinite(time) || time < priorTime || !['drained', 'stopped', 'error'].includes(play?.state)
            || typeof play.targetVisible !== 'boolean' || (visible && !play.targetVisible)
            || (play.targetVisible && !trial.targetExposed) || play.pcmHash !== trial.audioIdentity?.digest) {
            throw new Error('Invalid playback chronology, exposure or PCM binding.');
        }
        priorTime = time; visible ||= play.targetVisible;
    }
    let previousPlay = -1, responseTime = -Infinity, responseVisible = false;
    for (let index = 0; index < trial.responses.length; index++) {
        const answer = trial.responses[index], play = trial.plays[answer?.playIndex], time = Date.parse(answer?.at);
        if (!Number.isInteger(answer?.playIndex) || answer.playIndex <= previousPlay || play?.state !== 'drained'
            || answer.first !== (index === 0) || !Number.isFinite(time) || time < Date.parse(play.at) || time < responseTime
            || typeof answer.unclear !== 'boolean' || typeof answer.transcript !== 'string' || answer.transcript.length > 2000
            || (answer.unclear ? answer.transcript !== '' : !answer.transcript.trim())
            || !['human', 'automated-test'].includes(answer.evaluatorType)
            || typeof answer.listener !== 'string' || !answer.listener.trim() || answer.listener.length > 80
            || typeof answer.targetVisibleBeforeResponse !== 'boolean'
            || ((play.targetVisible || responseVisible) && !answer.targetVisibleBeforeResponse)
            || (answer.targetVisibleBeforeResponse && !trial.targetExposed)) {
            throw new Error('Invalid first-response, replay, evaluator or exposure history.');
        }
        const score = scoreTranscription(trial.text, answer.unclear ? '' : answer.transcript, { scoringVersion: SCORING.version });
        if (!answer.score || Object.keys(answer.score).length !== Object.keys(score).length
            || Object.keys(score).some(key => answer.score[key] !== score[key])) throw new Error('Saved response score differs from its raw transcription.');
        if (index === 0 && trial.plays.slice(0, answer.playIndex).some(entry => entry.state === 'drained')) {
            throw new Error('The first response followed an unrecorded completed replay.');
        }
        const nextPlay = trial.plays[answer.playIndex + 1];
        if (index === 0 && nextPlay && Date.parse(nextPlay.at) < time) throw new Error('Playback preceded the locked first response.');
        previousPlay = answer.playIndex; responseTime = time; responseVisible ||= answer.targetVisibleBeforeResponse;
    }
    if (!trial.responses.length && trial.plays.filter(play => play.state === 'drained').length > 1) {
        throw new Error('Multiple completed plays lack the required first answer.');
    }
    if (trial.state !== 'completed' && (trial.plays.length || trial.responses.length)) throw new Error('Unrendered trial has listening answers.');
}

async function validateReferenceEvidence(record, assets) {
    if (!Array.isArray(record.references) || record.references.length > 32
        || !Array.isArray(record.referenceAnnotations ?? []) || (record.referenceAnnotations?.length ?? 0) > 1024) {
        throw new Error('Invalid or oversized reference history.');
    }
    const hashPattern = /^[a-f0-9]{64}$/;
    for (const reference of record.references) {
        const authorization = reference?.authorization;
        if ((authorization !== true && !(typeof authorization === 'string' && authorization.trim() && authorization.length <= 2048))
            || typeof reference.transcript !== 'string' || !reference.transcript.trim() || reference.transcript.length > 8000
            || !hashPattern.test(reference.originalSha256) || !hashPattern.test(reference.pcmSha256)
            || !Number.isInteger(reference.sampleRate) || reference.sampleRate < 8000 || reference.sampleRate > 192000
            || !Number.isInteger(reference.sampleCount) || reference.sampleCount < 1 || reference.channels !== 1
            || reference.durationSeconds !== reference.sampleCount / reference.sampleRate || reference.durationSeconds > 120
            || !Array.isArray(reference.annotations) || reference.annotations.length !== 0) {
            throw new Error('Invalid reference authorization, transcript, timebase or inferred annotations.');
        }
        const original = assets.get(reference.originalAssetId), decoded = assets.get(reference.pcmAssetId);
        if (!original || !decoded || !(original.bytes instanceof ArrayBuffer) || !(decoded.bytes instanceof ArrayBuffer)
            || !original.bytes.byteLength || original.bytes.byteLength > 32 * 1024 * 1024
            || decoded.bytes.byteLength > 32 * 1024 * 1024 || decoded.bytes.byteLength !== reference.sampleCount * 4
            || original.role !== 'reference-original' || decoded.role !== 'reference-decoded-mono'
            || reference.originalAssetId !== `reference-original-${reference.originalSha256}`
            || reference.pcmAssetId !== `reference-pcm-${reference.pcmSha256}-${reference.sampleRate}`
            || decoded.encoding !== 'float32-le' || decoded.channels !== 1 || decoded.sampleRate !== reference.sampleRate
            || decoded.sampleCount !== reference.sampleCount
            || await sha256HexOfBytes(original.bytes) !== reference.originalSha256
            || await sha256HexOfBytes(decoded.bytes) !== reference.pcmSha256) {
            throw new Error('Reference assets do not match their authorized original and decoded PCM.');
        }
        const view = new DataView(decoded.bytes);
        let peak = 0, sum = 0, squares = 0, clipped = 0;
        for (let index = 0; index < reference.sampleCount; index++) {
            const sample = view.getFloat32(index * 4, true);
            if (!Number.isFinite(sample)) throw new Error('Reference PCM contains nonfinite samples.');
            peak = Math.max(peak, Math.abs(sample)); sum += sample; squares += sample * sample;
            if (Math.abs(sample) >= 0.999) clipped++;
        }
        const mono = reference.analysis?.mono;
        if (reference.analysis?.method !== 'sample-statistics-v1' || !mono || mono.peak !== peak
            || mono.clippedSamples !== clipped || mono.clippedFraction !== clipped / reference.sampleCount
            || mono.dcOffset !== sum / reference.sampleCount || mono.rms !== Math.sqrt(squares / reference.sampleCount)) {
            throw new Error('Reference sample measurements do not match the saved PCM.');
        }
        if (record.trials.some(trial => reference.transcript.toLowerCase().includes(trial.text.toLowerCase()) && !trial.targetExposed)) {
            throw new Error('A visible reference transcript was omitted from target exposure evidence.');
        }
    }
    const ids = new Set(); let previousTime = -Infinity;
    for (const annotation of record.referenceAnnotations ?? []) {
        const reference = record.references[annotation?.referenceIndex], at = Date.parse(annotation?.at);
        if (!Number.isInteger(annotation?.referenceIndex) || !reference || !Number.isFinite(at) || at < previousTime
            || typeof annotation.id !== 'string' || !annotation.id || annotation.id.length > 100 || ids.has(annotation.id)
            || annotation.referencePcmHash !== reference.pcmSha256 || annotation.sampleRate !== reference.sampleRate
            || annotation.origin !== 'manual-correction' || !['word', 'phone', 'event'].includes(annotation.type)
            || typeof annotation.label !== 'string' || !annotation.label.trim() || annotation.label.length > 120
            || !Number.isInteger(annotation.startSample) || !Number.isInteger(annotation.endSample)
            || annotation.startSample < 0 || annotation.endSample < annotation.startSample
            || annotation.endSample > reference.sampleCount || (annotation.type !== 'event' && annotation.startSample === annotation.endSample)
            || (annotation.confidence !== null && (!Number.isFinite(annotation.confidence) || annotation.confidence < 0 || annotation.confidence > 1))) {
            throw new Error('Manual reference annotation has invalid provenance, sample boundaries or confidence.');
        }
        ids.add(annotation.id); previousTime = at;
    }
}

export class VoiceExperimentRunner {
    constructor({ store, getModel, getConfiguration, getTuningSnapshot = () => null, onChange = () => {} }) {
        this.store = store;
        this.getModel = getModel;
        this.getConfiguration = getConfiguration;
        this.getTuningSnapshot = getTuningSnapshot;
        this.onChange = onChange;
        this._record = null;
        this._assets = new Map();
        this._running = false;
        this._mutation = false;
        this._controller = null;
        this._pause = false;
        this._lastReport = null;
    }

    snapshot() { return this._record ? clone(this._record) : null; }
    _idle() { if (this._running || this._mutation) throw new Error('Finish the active experiment operation first.'); }
    _trial(id) {
        const trial = this._record?.trials.find((entry) => entry.id === id);
        if (!trial) throw new Error('Unknown experiment trial.');
        return trial;
    }
    async _save(assets = []) {
        this._record.updatedAt = timestamp();
        await this.store.saveExperiment(this._record, assets);
        for (const asset of assets) this._assets.set(asset.id, clone(asset));
        console.info('[ParticleVoice][experiment][checkpoint]', this._record.id, this._record.state,
            this._record.trials.filter((trial) => trial.state === 'completed').length);
        try { this.onChange(this.snapshot()); }
        catch (error) { console.warn('[ParticleVoice][experiment][notification-failed]', error); }
    }
    async _asset(bytes, mimeType, metadata = {}) {
        const hash = await sha256HexOfBytes(bytes);
        if (!hash) throw new Error('WebCrypto is required for reproducible experiments.');
        return { id: `sha256:${hash}`, bytes, mimeType, ...metadata };
    }
    async _edit(change) {
        this._idle();
        this._mutation = true;
        const before = this.snapshot();
        try {
            const result = await change();
            await this._save();
            return clone(result);
        } catch (error) { this._record = before; throw error; }
        finally { this._mutation = false; }
    }

    /** Validate and deduplicate the unmodified human report before saving it. */
    async archiveReport(report) {
        ListeningEvaluation.repeatPractice(report, { listener: 'Saved experiment source', selection: 'answered' });
        const hash = await receiptHashOf(report);
        const id = `voice-report-${hash.slice(7)}`;
        const record = { schemaVersion: 'particle-voice-source-report/v1', id, state: 'archived',
            label: `${report.mode} listening results`, createdAt: timestamp(), updatedAt: timestamp(), reportHash: hash, report: clone(report) };
        const existing = await this.store.loadExperiment(id);
        if (!existing) await this.store.saveExperiment(record, []);
        this._lastReport = clone(report);
        return id;
    }

    async create({ report = this._lastReport, seed = crypto.getRandomValues(new Uint32Array(1))[0], label = 'K release and vowel entry' } = {}) {
        this._idle();
        if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('Experiment order requires a uint32 seed.');
        const model = this.getModel();
        if (!model) throw new Error('Start audio to initialize the existing voice model first.');
        this._mutation = true;
        const previousRecord = this.snapshot();
        const previousAssets = this._assets;
        try {
            if (!report) {
                const archived = (await this.store.listExperiments()).find(item => item.schemaVersion === 'particle-voice-source-report/v1');
                if (archived) report = (await this.store.loadExperiment(archived.id)).record.report;
            }
            if (report) await this.archiveReport(report);
            const configuration = clone(this.getConfiguration());
            const manifest = { schemaVersion: 'particle-voice-experiment-manifest/v1',
                purpose: 'Discriminate K release location and voiced-vowel entry carryover',
                baselineConfiguration: configuration, baselineConfigurationHash: await receiptHashOf(stableConfiguration(configuration)),
                tuning: clone(this.getTuningSnapshot()), capability: buildVoiceExperimentCapability(model),
                scoring: SCORING, scoringHash: await receiptHashOf(SCORING),
                targets: clone(BANK), targetHash: await receiptHashOf(BANK),
                variants: clone(VOICE_EXPERIMENT_VARIANTS), controlsHash: await receiptHashOf(VOICE_EXPERIMENT_VARIANTS),
                seed, randomization: 'sha256-seed-trial-order-v1',
                seedScope: 'review-order-only; synthesis retains authored deterministic reset',
                renderPath: 'existing-model-renderPhysiology', playbackPath: 'existing-VoicePlayback-worklet',
                frozenFactors: ['pronunciation', 'voice', 'F0', 'duration', 'gain-policy', 'renderer', 'scoring'],
                budget: { maxTrials: 80, maxAudioSeconds: 300, maxAssetBytes: 128 * 1024 * 1024 },
                finalAcceptanceSetAccess: false, productionPromotion: false,
                accent: 'Existing authored English lexicon; no new accent or voice enrollment',
                referenceStatus: 'optional-user-supplied; no reference alignment or training inferred' };
            const trials = [];
            const assets = [];
            for (const target of BANK) {
                const base = planTarget(model, target);
                for (const variant of VOICE_EXPERIMENT_VARIANTS) {
                    const plan = applyVoiceExperimentControls(base, variant.controls);
                    const snapshot = jsonPlan(plan);
                    const asset = await this._asset(encode(snapshot), 'application/json', { kind: 'planned-controls' });
                    assets.push(asset);
                    trials.push({ id: `${target.id}:${variant.id}`, targetId: target.id, variantId: variant.id,
                        text: target.text, role: target.role, review: target.review, state: 'queued',
                        renderPath: target.id === 'x' ? 'authored-letter-name' : 'text-plan',
                        phones: pronunciationTrace(plan.sequence, plan.wordBoundaries),
                        controlsAudit: clone(plan.voiceExperiment ?? null),
                        planHash: await receiptHashOf(snapshot), planAssetId: asset.id,
                        order: await receiptHashOf({ seed, targetId: target.id, variantId: variant.id }),
                        audioIdentity: null, pcmAssetId: null, metrics: null, error: null,
                        targetExposed: false, plays: [], responses: [] });
                }
            }
            if (trials.length > manifest.budget.maxTrials) throw new Error('Experiment exceeds its frozen trial budget.');
            this._assets = new Map();
            this._record = { schemaVersion: VOICE_EXPERIMENT_SCHEMA, id: `voice-experiment-${crypto.randomUUID()}`,
                label: text(label, 'Experiment label', 100), createdAt: timestamp(), updatedAt: timestamp(), state: 'queued',
                manifest, manifestHash: await receiptHashOf(manifest), trials,
                sourceReport: report ? clone(report) : null, sourceReportHash: report ? await receiptHashOf(report) : null,
                observations: report ? [{ kind: 'imported-listening-report', reportHash: await receiptHashOf(report),
                    interpretation: 'Original responses retained; no automatic phonetic diagnosis or learning' }] : [],
                hypotheses: [{ id: 'k-release-entry', status: 'untested',
                    text: 'Release location and/or voiced entry trajectory may contribute to key/tea confusion.' }],
                preferences: [], acceptance: [], acceptedVariantId: 'baseline', previousVariantId: null,
                resolvedTractConfiguration: configuration.tract ?? null,
                references: [], referenceAnnotations: [], referenceComparisons: [], errors: [] };
            await this._save(assets);
            return this.snapshot();
        } catch (error) {
            this._record = previousRecord;
            this._assets = previousAssets;
            throw error;
        } finally { this._mutation = false; }
    }

    async _validateRecord(record, assetInput = this._assets) {
        if (record?.schemaVersion !== VOICE_EXPERIMENT_SCHEMA || !Array.isArray(record.trials)
            || record.trials.length !== BANK.length * VOICE_EXPERIMENT_VARIANTS.length
            || !['queued', 'running', 'paused', 'completed', 'cancelled', 'failed'].includes(record.state)
            || !VOICE_EXPERIMENT_VARIANTS.some(variant => variant.id === record.acceptedVariantId)
            || (record.previousVariantId !== null && !VOICE_EXPERIMENT_VARIANTS.some(variant => variant.id === record.previousVariantId))) {
            throw new Error('Unsupported or incomplete experiment schema.');
        }
        const manifest = record.manifest;
        if (manifest?.schemaVersion !== 'particle-voice-experiment-manifest/v1'
            || !Number.isInteger(manifest.seed) || manifest.seed < 0 || manifest.seed > 0xffffffff
            || manifest.randomization !== 'sha256-seed-trial-order-v1'
            || manifest.renderPath !== 'existing-model-renderPhysiology' || manifest.playbackPath !== 'existing-VoicePlayback-worklet'
            || manifest.finalAcceptanceSetAccess !== false
            || await receiptHashOf(manifest) !== record.manifestHash
            || await receiptHashOf(stableConfiguration(manifest.baselineConfiguration)) !== manifest.baselineConfigurationHash
            || await receiptHashOf(manifest.targets) !== manifest.targetHash
            || await receiptHashOf(manifest.variants) !== manifest.controlsHash
            || await receiptHashOf(manifest.scoring) !== manifest.scoringHash
            || await receiptHashOf(manifest.targets) !== await receiptHashOf(BANK)
            || await receiptHashOf(manifest.variants) !== await receiptHashOf(VOICE_EXPERIMENT_VARIANTS)
            || await receiptHashOf(manifest.scoring) !== await receiptHashOf(SCORING)
            || manifest.budget.maxTrials !== 80 || manifest.budget.maxAudioSeconds !== 300
            || manifest.budget.maxAssetBytes !== 128 * 1024 * 1024 || manifest.productionPromotion !== false) {
            throw new Error('Frozen experiment, scoring, controls or execution limits do not match this runner.');
        }
        if (record.sourceReport !== null) {
            ListeningEvaluation.repeatPractice(record.sourceReport, { listener: 'Saved experiment source', selection: 'answered' });
            if (await receiptHashOf(record.sourceReport) !== record.sourceReportHash) throw new Error('Source listening report hash changed.');
        } else if (record.sourceReportHash !== null) throw new Error('Source report hash has no report.');
        const assets = assetInput instanceof Map ? assetInput : new Map(assetInput.map(asset => [asset.id, asset]));
        if (assets.size > 256) throw new Error('Too many saved experiment assets.');
        const parsedPlans = new Map(), checkedAssets = new Set(), pcmIdentities = new Map();
        const getAsset = async (id, kind) => {
            const asset = assets.get(id);
            if (!asset || asset.kind !== kind || !(asset.bytes instanceof ArrayBuffer)
                || asset.bytes.byteLength > 32 * 1024 * 1024) throw new Error('Missing or invalid experiment asset.');
            if (!checkedAssets.has(id)) {
                if (`sha256:${await sha256HexOfBytes(asset.bytes)}` !== id) throw new Error('Saved asset hash does not match its bytes.');
                checkedAssets.add(id);
            }
            return asset;
        };
        const readPlan = async trial => {
            const asset = await getAsset(trial.planAssetId, 'planned-controls');
            if (!parsedPlans.has(asset.id)) {
                const snapshot = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(asset.bytes));
                parsedPlans.set(asset.id, { snapshot, hash: await receiptHashOf(snapshot), plan: restoredPlan(snapshot) });
            }
            const saved = parsedPlans.get(asset.id);
            if (saved.hash !== trial.planHash) throw new Error('Trial plan hash does not match its saved plan asset.');
            return saved.plan;
        };
        const ids = new Set();
        for (const trial of record.trials) {
            const target = BANK.find((item) => item.id === trial.targetId);
            const variant = VOICE_EXPERIMENT_VARIANTS.find((item) => item.id === trial.variantId);
            if (!target || !variant || trial.id !== `${target.id}:${variant.id}` || ids.has(trial.id)
                || trial.text !== target.text || trial.role !== target.role || trial.review !== target.review
                || trial.renderPath !== (target.id === 'x' ? 'authored-letter-name' : target.phones ? 'explicit-phones' : 'text-plan')
                || trial.order !== await receiptHashOf({ seed: manifest.seed, targetId: target.id, variantId: variant.id })
                || !Array.isArray(trial.plays) || !Array.isArray(trial.responses)
                || !['queued', 'completed', 'failed'].includes(trial.state)) throw new Error('Trial does not match the frozen manifest.');
            ids.add(trial.id);
            validateTrialResponses(trial);
            const plan = await readPlan(trial);
            if (await receiptHashOf(pronunciationTrace(plan.sequence, plan.wordBoundaries)) !== await receiptHashOf(trial.phones)) {
                throw new Error('Pronunciation trace does not match the frozen plan.');
            }
            const base = record.trials.find(item => item.targetId === target.id && item.variantId === 'baseline');
            if (!base) throw new Error('Candidate is missing its frozen baseline.');
            const basePlan = await readPlan(base);
            if (target.id === 'x' ? basePlan.normalized !== null
                : target.phones ? basePlan.normalized !== null : basePlan.normalized?.raw !== target.text) {
                throw new Error('Baseline plan text does not match its frozen target.');
            }
            if (target.id === 'x' && await receiptHashOf(basePlan.sequence)
                !== await receiptHashOf(textToPhonemeSequence(normalizeText('x.'), { g2p: LETTER_G2P }))) {
                throw new Error('Protected X plan differs from the recognized alphabet pronunciation and timing context.');
            }
            const expected = applyVoiceExperimentControls(basePlan, variant.controls);
            if (await receiptHashOf(jsonPlan(expected)) !== trial.planHash
                || await receiptHashOf(expected.voiceExperiment) !== await receiptHashOf(trial.controlsAudit)) {
                throw new Error('Candidate plan or control audit differs from its declared intervention.');
            }
            if (trial.state === 'completed') {
                const asset = await getAsset(trial.pcmAssetId, 'rendered-pcm');
                if (asset.bytes.byteLength % 4 || asset.sampleRate !== plan.physiology.sampleRate
                    || asset.sampleCount !== asset.bytes.byteLength / 4 || !asset.sampleCount) throw new Error('Stored PCM timebase differs from the plan.');
                if (!pcmIdentities.has(asset.id)) {
                    const pcm = new Float32Array(asset.bytes);
                    let peak = 0, sumSquares = 0;
                    for (const sample of pcm) { peak = Math.max(peak, Math.abs(sample)); sumSquares += sample * sample; }
                    pcmIdentities.set(asset.id, { identity: await voiceLabAudioIdentity({ pcm, sampleRate: asset.sampleRate }),
                        peak, rms: Math.sqrt(sumSquares / pcm.length) });
                }
                const { identity, peak, rms } = pcmIdentities.get(asset.id);
                const chunkSamples = manifest.baselineConfiguration?.model?.chunkSamples;
                const expectedChunks = Math.ceil(plan.physiology.totalFrames / (chunkSamples * plan.physiology.frameRateHz / asset.sampleRate));
                if (identity.status !== 'available' || await receiptHashOf(identity) !== await receiptHashOf(trial.audioIdentity)
                    || peak > 1 || peak === 0 || peak !== trial.metrics?.peak || rms !== trial.metrics?.rms
                    || trial.metrics?.sampleCount !== asset.sampleCount
                    || trial.metrics.durationSeconds !== asset.sampleCount / asset.sampleRate
                    || trial.metrics.chunks !== expectedChunks || asset.sampleCount !== expectedChunks * chunkSamples) {
                    throw new Error('Completed trial PCM identity or metrics are inconsistent.');
                }
            } else if (trial.pcmAssetId !== null || trial.audioIdentity !== null || trial.metrics !== null) {
                throw new Error('Uncompleted trial cannot contain accepted render assets or metrics.');
            }
        }
        for (const trial of record.trials) {
            if (trial.metrics?.reusedFrom) {
                const source = record.trials.find(item => item.id === trial.metrics.reusedFrom);
                if (!source || source.id === trial.id || source.state !== 'completed'
                    || source.planHash !== trial.planHash || source.pcmAssetId !== trial.pcmAssetId) throw new Error('Invalid cached-render provenance.');
            }
            if (record.trials.some(other => other.targetId === trial.targetId && other.targetExposed !== trial.targetExposed)) {
                throw new Error('Inspection exposure is inconsistent across variants of the same target.');
            }
        }
        await validateReferenceEvidence(record, assets);
        await validateVoiceReferenceComparisons(record, assets);
        if (!Array.isArray(record.acceptance) || record.acceptance.length > 256) throw new Error('Invalid acceptance history.');
        let selected = 'baseline', previous = null, receiptTime = -Infinity;
        for (const receipt of record.acceptance) {
            const at = Date.parse(receipt?.at);
            if (!Number.isFinite(at) || at < receiptTime || receipt.from !== selected
                || !VOICE_EXPERIMENT_VARIANTS.some(variant => variant.id === receipt.to)
                || receipt.manifestHash !== record.manifestHash || receipt.productionChanged !== false
                || typeof receipt.reason !== 'string' || !receipt.reason.trim() || receipt.reason.length > 2000) {
                throw new Error('Acceptance receipt does not follow the saved selection history.');
            }
            if (receipt.action === 'accept-lab-candidate') {
                if (receipt.to === 'baseline' || receipt.policy !== SCORING.acceptance
                    || !Array.isArray(receipt.responseCounts) || receipt.responseCounts.length !== record.trials.length) {
                    throw new Error('Acceptance requires an exact saved response-prefix manifest.');
                }
                const atAcceptance = { ...record, trials: record.trials.map((trial, index) => {
                    const prefix = receipt.responseCounts[index];
                    if (prefix?.id !== trial.id || !Number.isInteger(prefix.count) || prefix.count < 0 || prefix.count > trial.responses.length) {
                        throw new Error('Invalid historical acceptance response count.');
                    }
                    const responses = trial.responses.slice(0, prefix.count);
                    if (responses.some(response => Date.parse(response.at) > at)) throw new Error('A later response cannot justify an earlier acceptance.');
                    return { ...trial, responses };
                }) };
                const evidence = atAcceptance.trials.map(trial => ({ id: trial.id, pcm: trial.audioIdentity, responses: trial.responses }));
                if (await receiptHashOf(evidence) !== receipt.evidenceHash
                    || !VoiceExperimentRunner.prototype.acceptanceStatus.call({ _record: atAcceptance }, receipt.to).passed) {
                    throw new Error('Acceptance evidence fails its frozen paired-listening policy.');
                }
                previous = selected; selected = receipt.to;
            } else if (receipt.action === 'rollback-lab-candidate' && previous !== null && receipt.to === previous) {
                selected = previous; previous = null;
            } else throw new Error('Invalid acceptance or rollback action.');
            receiptTime = at;
        }
        if (record.acceptedVariantId !== selected || record.previousVariantId !== previous) {
            throw new Error('Selected candidate has no matching acceptance or rollback receipt.');
        }
    }

    async load(id) {
        this._idle();
        this._mutation = true;
        try {
            const saved = await this.store.loadExperiment(id);
            if (!saved) throw new Error('Saved experiment was not found.');
            await this._validateRecord(saved.record, saved.assets);
            this._record = clone(saved.record);
            this._assets = new Map(saved.assets.map((asset) => [asset.id, asset]));
            if (this._record.state === 'running') { this._record.state = 'paused'; await this._save(); }
            this.onChange(this.snapshot());
            return this.snapshot();
        } finally { this._mutation = false; }
    }

    pause() { if (this._running) this._pause = true; }
    cancel() { if (this._running) this._controller.abort(); }

    async run() {
        this._idle();
        if (!this._record) throw new Error('Create or load an experiment first.');
        this._running = true;
        this._pause = false;
        const controller = new AbortController();
        this._controller = controller;
        try {
            await this._validateRecord(this._record);
            const model = this.getModel();
            if (!model || await receiptHashOf(stableConfiguration(this.getConfiguration())) !== this._record.manifest.baselineConfigurationHash
                || await receiptHashOf(this.getTuningSnapshot()) !== await receiptHashOf(this._record.manifest.tuning)) {
                throw new Error('The active voice configuration differs from the frozen baseline. Restore it or create a new experiment.');
            }
            this._record.state = 'running';
            await this._save();
            for (const trial of this._record.trials) {
                if (controller.signal.aborted) throw aborted();
                if (this._pause) break;
                if (trial.state === 'completed') continue;
                const target = BANK.find((item) => item.id === trial.targetId);
                const variant = VOICE_EXPERIMENT_VARIANTS.find((item) => item.id === trial.variantId);
                const beforeTrial = clone(trial);
                try {
                    const base = planTarget(model, target);
                    const plan = applyVoiceExperimentControls(base, variant.controls);
                    if (await receiptHashOf(jsonPlan(plan)) !== trial.planHash) throw new Error('Pronunciation or planned controls changed since the baseline was frozen.');
                    const cached = this._record.trials.find((other) => other.state === 'completed' && other.planHash === trial.planHash);
                    if (cached) {
                        Object.assign(trial, { state: 'completed', pcmAssetId: cached.pcmAssetId,
                            audioIdentity: clone(cached.audioIdentity), metrics: { ...clone(cached.metrics), reusedFrom: cached.id }, error: null });
                        await this._save();
                        continue;
                    }
                    const rendered = await model.renderPhysiology(plan.physiology, { signal: controller.signal });
                    const resolvedTract = this.getConfiguration().tract;
                    if (!resolvedTract) throw new Error('The renderer did not expose its resolved tract settings.');
                    if (this._record.resolvedTractConfiguration
                        && await receiptHashOf(resolvedTract) !== await receiptHashOf(this._record.resolvedTractConfiguration)) {
                        throw new Error('Resolved tract settings differ from the frozen render baseline.');
                    }
                    this._record.resolvedTractConfiguration ??= clone(resolvedTract);
                    const identity = await voiceLabAudioIdentity(rendered, { signal: controller.signal });
                    if (identity.status !== 'available' || !rendered.pcm.length) throw new Error('Rendered audio failed finite-sample or identity screening.');
                    let peak = 0;
                    let sumSquares = 0;
                    for (const sample of rendered.pcm) { peak = Math.max(peak, Math.abs(sample)); sumSquares += sample * sample; }
                    if (peak > 1 || peak === 0) throw new Error('Rendered audio is clipped or silent.');
                    const asset = await this._asset(rendered.pcm.slice().buffer, 'application/x-particle-voice-f32le',
                        { kind: 'rendered-pcm', sampleRate: rendered.sampleRate, sampleCount: rendered.pcm.length });
                    const used = [...this._assets.values()].reduce((sum, item) => sum + item.bytes.byteLength, 0);
                    const seconds = this._record.trials.filter((item) => item.metrics && !item.metrics.reusedFrom)
                        .reduce((sum, item) => sum + item.metrics.durationSeconds, 0);
                    if (used + asset.bytes.byteLength > this._record.manifest.budget.maxAssetBytes
                        || seconds + rendered.pcm.length / rendered.sampleRate > this._record.manifest.budget.maxAudioSeconds) throw new Error('Frozen audio/storage budget exhausted.');
                    Object.assign(trial, { state: 'completed', pcmAssetId: asset.id, audioIdentity: identity, error: null,
                        metrics: { peak, rms: Math.sqrt(sumSquares / rendered.pcm.length),
                            durationSeconds: rendered.pcm.length / rendered.sampleRate, sampleCount: rendered.pcm.length,
                            chunks: rendered.chunks, rawPeak: rendered.rawPeak, rawRms: rendered.rawRms,
                            appliedGain: rendered.appliedGain, diagnostics: clone(rendered.diagnostics), reusedFrom: null } });
                    await this._save([asset]);
                } catch (error) {
                    if (controller.signal.aborted || error.name === 'AbortError') throw error;
                    Object.assign(trial, beforeTrial);
                    trial.state = 'failed';
                    trial.error = { message: String(error.message), at: timestamp() };
                    this._record.errors.push({ trialId: trial.id, ...trial.error });
                    console.warn('[ParticleVoice][experiment][candidate-failed]', trial.id, error.message);
                    await this._save();
                }
                // Cooperatively return the event loop between bounded GPU submissions.
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
            this._record.state = this._pause ? 'paused' : this._record.trials.some((trial) => trial.state !== 'completed') ? 'failed' : 'completed';
        } catch (error) {
            this._record.state = controller.signal.aborted ? 'cancelled' : 'failed';
            if (!controller.signal.aborted) this._record.errors.push({ at: timestamp(), message: String(error.message) });
        } finally {
            this._running = false;
            this._controller = null;
            await this._save();
        }
        return this.snapshot();
    }

    reviewQueue() {
        return (this._record?.trials ?? []).filter((trial) => trial.review && trial.state === 'completed')
            .sort((a, b) => a.order.localeCompare(b.order)).map((trial) => trial.id);
    }
    async audio(trialId) {
        const trial = this._trial(trialId);
        if (trial.state !== 'completed') throw new Error('This trial has no completed audio.');
        const asset = this._assets.get(trial.pcmAssetId);
        if (!asset || `sha256:${await sha256HexOfBytes(asset.bytes)}` !== trial.pcmAssetId) throw new Error('Stored PCM failed integrity validation.');
        const result = { pcm: new Float32Array(asset.bytes.slice(0)), sampleRate: asset.sampleRate };
        if ((await voiceLabAudioIdentity(result)).digest !== trial.audioIdentity.digest) throw new Error('Stored audio identity no longer matches its trial.');
        return result;
    }

    /** Standard WAV review files; the existing experiment ZIP remains the restore format. */
    async exportAudio() {
        this._idle();
        if (!this._record) throw new Error('Open a saved comparison first.');
        this._mutation = true;
        try {
            const record = this.snapshot(), files = {}, clips = new Map(), assets = [];
            const reportBytes = encode(record);
            files['report.json'] = reportBytes;
            for (const trial of record.trials) {
                if (trial.state !== 'completed' || clips.has(trial.pcmAssetId)) continue;
                const audio = await this.audio(trial.id);
                const wav = new Uint8Array(encodeVoiceLessonWav(audio.pcm, audio.sampleRate));
                const hash = await sha256HexOfBytes(wav), path = `audio/${hash}.wav`;
                files[path] = wav;
                clips.set(trial.pcmAssetId, { path, wavSha256: hash, sampleRate: audio.sampleRate,
                    sampleCount: audio.pcm.length, audioIdentity: trial.audioIdentity });
            }
            // Retain plans and reference originals, with explicit paths back to their asset IDs.
            for (const asset of this._assets.values()) {
                if (asset.kind === 'rendered-pcm') continue;
                const bytes = new Uint8Array(asset.bytes), hash = await sha256HexOfBytes(bytes);
                if (asset.id.startsWith('sha256:') && asset.id !== `sha256:${hash}`) throw new Error('Saved comparison asset failed its hash check.');
                const path = `assets/${hash}${asset.mimeType === 'application/json' ? '.json' : '.bin'}`;
                files[path] = bytes.slice();
                assets.push({ id: asset.id, path, sha256: hash, mimeType: asset.mimeType });
            }
            const references = [];
            for (const reference of record.references ?? []) {
                const asset = this._assets.get(reference.pcmAssetId);
                if (!asset || await sha256HexOfBytes(asset.bytes) !== reference.pcmSha256) throw new Error('Reference audio failed its hash check.');
                const bytes = new Uint8Array(encodeVoiceLessonWav(new Float32Array(asset.bytes), reference.sampleRate));
                const hash = await sha256HexOfBytes(bytes), path = `references/${hash}.wav`;
                files[path] = bytes;
                references.push({ ...reference, wavPath: path, wavSha256: hash });
            }
            const manifest = { schemaVersion: 'particle-voice-comparison-wav-v1', experimentId: record.id,
                audioStage: 'model-output-before-playback-resampling', microphoneRecording: false,
                reportPath: 'report.json', reportSha256: await sha256HexOfBytes(reportBytes),
                trials: record.trials.map(trial => ({ trialId: trial.id, targetId: trial.targetId,
                    variantId: trial.variantId, state: trial.state, pcmAssetId: trial.pcmAssetId,
                    audio: clips.get(trial.pcmAssetId) ?? null, plays: trial.plays, responses: trial.responses,
                    unavailableReason: trial.state === 'completed' ? null : 'not-rendered-successfully' })),
                assets, references,
                notes: ['WAV samples preserve saved float32 model output without normalization or resampling.',
                    'A rendered clip does not establish that playback completed; check each play receipt.',
                    'Use the separate experiment bundle to restore this comparison in Speech Studio.'],
            };
            files['manifest.json'] = JSON.stringify(manifest, null, 2);
            files['README.txt'] = 'Open report.json for targets, answers, settings and scores. manifest.json maps every trial and replay to its WAV.\nIdentical audio shares a file. Interrupted plays do not prove that the entire clip was heard.\nThese files preserve generated model audio, not microphone or speaker output.\n';
            return new Blob([await Zip.create(files)], { type: 'application/zip' });
        } finally { this._mutation = false; }
    }

    async recordPlay(trialId, receipt) {
        return this._edit(() => {
        const trial = this._trial(trialId);
        if (trial.state !== 'completed') throw new Error('Only completed candidates may be played.');
        if (!trial.responses.length && trial.plays.some((play) => play.state === 'drained')) throw new Error('Record the first answer before replaying.');
        if (!['drained', 'stopped', 'error'].includes(receipt?.state)) throw new Error('A completed, stopped or failed playback receipt is required.');
        trial.plays.push({ at: timestamp(), ...clone(receipt), targetVisible: trial.targetExposed, pcmHash: trial.audioIdentity.digest });
        return trial.plays.at(-1);
        });
    }

    async respond(trialId, { transcript = '', unclear = false, evaluatorType = 'human', listener = 'Local listener' }) {
        return this._edit(() => {
        const trial = this._trial(trialId);
        const play = trial.plays.at(-1);
        if (!play || play.state !== 'drained' || trial.responses.some((answer) => answer.playIndex === trial.plays.length - 1)) throw new Error('Finish a new playback before recording an answer.');
        if (!['human', 'automated-test'].includes(evaluatorType)) throw new Error('Choose a supported evaluator type.');
        if (!unclear) text(transcript, 'What you heard');
        else if (transcript) throw new Error('An unclear abstention cannot also contain a transcript.');
        const response = { at: timestamp(), transcript, unclear, evaluatorType, listener: text(listener, 'Listener', 80),
            playIndex: trial.plays.length - 1, first: trial.responses.length === 0,
            targetVisibleBeforeResponse: trial.targetExposed || play.targetVisible,
            score: scoreTranscription(trial.text, unclear ? '' : transcript, { scoringVersion: SCORING.version }) };
        trial.responses.push(response);
        return response;
        });
    }

    async inspect(trialId) {
        return this._edit(() => {
        const selected = this._trial(trialId);
        this._exposeTrial(selected);
        return selected;
        });
    }

    _exposeTrial(selected) {
        for (const trial of this._record.trials) {
            if (trial.targetId === selected.targetId || trial.text.toLowerCase() === selected.text.toLowerCase()) trial.targetExposed = true;
        }
    }

    /** Explicit inspection only: return the frozen intended controls, not a replan. */
    async inspectPlan(trialId) {
        return this._edit(async () => {
            const trial = this._trial(trialId), asset = this._assets.get(trial.planAssetId);
            if (!asset || asset.kind !== 'planned-controls' || !(asset.bytes instanceof ArrayBuffer)
                || `sha256:${await sha256HexOfBytes(asset.bytes)}` !== trial.planAssetId) {
                throw new Error('Frozen inspection plan failed asset integrity validation.');
            }
            const snapshot = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(asset.bytes));
            if (await receiptHashOf(snapshot) !== trial.planHash) throw new Error('Frozen inspection plan hash changed.');
            const plan = restoredPlan(snapshot);
            this._exposeTrial(trial);
            return { trial, plan };
        });
    }

    /** Latest saved manual view for this pair; earlier views remain in the report. */
    referenceComparison(trialId, referenceIndex) {
        this._trial(trialId);
        if (!Number.isInteger(referenceIndex) || !this._record?.references[referenceIndex]) throw new Error('Select a saved reference.');
        return clone((this._record.referenceComparisons ?? []).findLast(entry =>
            entry.trialId === trialId && entry.referenceIndex === referenceIndex) ?? null);
    }

    /** Save manual sample selection and alignment anchors without making a hearing judgment. */
    async setReferenceComparison({ trialId, referenceIndex, generatedRegion, referenceRegion, alignmentEnabled,
        analysis = { fftSize: 1024, hopSize: 256, window: 'hann', floorDb: -100 } }) {
        // Snapshot caller-owned selection before any hashing or checkpoint await.
        const selection = clone({ generatedRegion, referenceRegion, analysis });
        return this._edit(async () => {
            const trial = this._trial(trialId), reference = this._record.references[referenceIndex];
            if (trial.state !== 'completed' || !Number.isInteger(referenceIndex) || !reference) {
                throw new Error('Choose a completed generated clip and a saved reference.');
            }
            const generatedAsset = this._assets.get(trial.pcmAssetId);
            if (!generatedAsset) throw new Error('Generated comparison PCM is unavailable.');
            const history = this._record.referenceComparisons ?? [];
            const at = new Date(Math.max(Date.now(), Date.parse(history.at(-1)?.at ?? this._record.createdAt))).toISOString();
            const entry = { schemaVersion: 'particle-voice-reference-comparison/v1', sequence: history.length + 1, at,
                origin: 'manual-inspection', manifestHash: this._record.manifestHash, trialId, referenceIndex, alignmentEnabled,
                generated: { pcmAssetId: trial.pcmAssetId, pcmHash: trial.audioIdentity.digest,
                    identityEncoding: 'particle-voice-pcm-f32le-v1', sampleRate: generatedAsset.sampleRate,
                    sampleCount: generatedAsset.sampleCount, region: selection.generatedRegion },
                reference: { pcmAssetId: reference.pcmAssetId, pcmHash: `sha256:${reference.pcmSha256}`,
                    identityEncoding: 'raw-f32le-sha256', sampleRate: reference.sampleRate,
                    sampleCount: reference.sampleCount, region: selection.referenceRegion }, analysis: selection.analysis };
            entry.comparisonHash = await receiptHashOf(entry);
            this._exposeTrial(trial);
            this._record.referenceComparisons = [...history, entry];
            await validateVoiceReferenceComparisons(this._record, this._assets, history.length);
            return entry;
        });
    }

    async preference({ leftTrialId, rightTrialId, choice, dimension, evaluatorType = 'human', listener = 'Local listener' }) {
        return this._edit(() => {
        const left = this._trial(leftTrialId);
        const right = this._trial(rightTrialId);
        if (left.targetId !== right.targetId || left.id === right.id || !left.responses.length || !right.responses.length) throw new Error('Preference needs two answered candidates for the same target.');
        if (!['left', 'right', 'tie', 'neither'].includes(choice) || !['clarity', 'naturalness'].includes(dimension)
            || !['human', 'automated-test'].includes(evaluatorType)) throw new Error('Invalid preference choice or evaluator.');
        this._record.preferences.push({ at: timestamp(), leftTrialId, rightTrialId, choice, dimension, evaluatorType, listener: text(listener, 'Listener', 80) });
        return this._record.preferences.at(-1);
        });
    }

    acceptanceStatus(variantId) {
        if (!this._record || !VOICE_EXPERIMENT_VARIANTS.some((variant) => variant.id === variantId) || variantId === 'baseline') return { passed: false, reasons: ['Choose an experimental candidate.'] };
        const reasons = [];
        if (this._record.trials.some((trial) => trial.state !== 'completed')) reasons.push('Complete all engineering renders.');
        const firstHuman = (trial) => {
            try { validateTrialResponses(trial); } catch { return null; }
            const answer = trial?.responses[0];
            return answer?.evaluatorType === 'human' && !answer.targetVisibleBeforeResponse ? answer : null;
        };
        const pairs = BANK.filter((target) => target.review).map((target) => ({ target,
            base: firstHuman(this._record.trials.find((trial) => trial.targetId === target.id && trial.variantId === 'baseline')),
            candidate: firstHuman(this._record.trials.find((trial) => trial.targetId === target.id && trial.variantId === variantId)) }));
        if (pairs.some((pair) => !pair.base || !pair.candidate || pair.base.listener !== pair.candidate.listener)) reasons.push('Matched first human responses are required for key, tea, cap, cool, X and the number sentence.');
        const dev = pairs.filter((pair) => pair.target.role === 'development');
        const exact = (answer) => answer && !answer.unclear && answer.score.errors === 0;
        const keyPair = dev.find(pair => pair.target.id === 'key');
        const baselineKey = this._record.trials.find(trial => trial.targetId === 'key' && trial.variantId === 'baseline');
        const candidateKey = this._record.trials.find(trial => trial.targetId === 'key' && trial.variantId === variantId);
        const activeControl = candidateKey?.controlsAudit?.baselineBypass === false
            && Array.isArray(candidateKey.controlsAudit.applied) && candidateKey.controlsAudit.applied.some(operation => operation.stopPhone >= 0
                && ['kReleaseJunctionOffset', 'kVowelEntryBlend'].includes(operation.controlId));
        if (!keyPair?.base || exact(keyPair.base) || !exact(keyPair.candidate) || !activeControl
            || !candidateKey.audioIdentity?.digest || candidateKey.audioIdentity.digest === baselineKey?.audioIdentity?.digest) {
            reasons.push('Recover the missed key target with an applied K intervention and changed PCM; improved answers to unchanged tea audio are not a repair.');
        }
        if (dev.some((pair) => exact(pair.base) && !exact(pair.candidate))) reasons.push('A previously correct development target regressed.');
        if (pairs.filter((pair) => ['transfer', 'protected'].includes(pair.target.role)).some((pair) => !exact(pair.base) || !exact(pair.candidate))) reasons.push('Both baseline and candidate must pass the selected transfer and protected controls.');
        return { passed: reasons.length === 0, reasons, policy: SCORING.acceptance, scope: 'saved-lab-candidate-only' };
    }

    async accept(variantId, { reason }) {
        return this._edit(async () => {
        const status = this.acceptanceStatus(variantId);
        if (!status.passed) throw new Error(status.reasons.join(' '));
        const receipt = { at: timestamp(), action: 'accept-lab-candidate', from: this._record.acceptedVariantId,
            to: variantId, reason: text(reason, 'Acceptance reason'), manifestHash: this._record.manifestHash,
            responseCounts: this._record.trials.map(trial => ({ id: trial.id, count: trial.responses.length })),
            evidenceHash: await receiptHashOf(this._record.trials.map((trial) => ({ id: trial.id, pcm: trial.audioIdentity, responses: trial.responses }))),
            policy: status.policy, productionChanged: false };
        this._record.previousVariantId = receipt.from;
        this._record.acceptedVariantId = variantId;
        this._record.acceptance.push(receipt);
        return receipt;
        });
    }

    async rollback({ reason }) {
        return this._edit(async () => {
        if (!this._record?.previousVariantId) throw new Error('There is no accepted lab revision to roll back.');
        for (const trial of this._record.trials.filter((item) => item.variantId === this._record.previousVariantId)) await this.audio(trial.id);
        const receipt = { at: timestamp(), action: 'rollback-lab-candidate', from: this._record.acceptedVariantId,
            to: this._record.previousVariantId, reason: text(reason, 'Rollback reason'), manifestHash: this._record.manifestHash, productionChanged: false };
        this._record.acceptedVariantId = receipt.to;
        this._record.previousVariantId = null;
        this._record.acceptance.push(receipt);
        return receipt;
        });
    }

    async addReference(reference) {
        this._idle();
        if (!this._record) throw new Error('Create or load an experiment first.');
        const { assets, reference: metadata } = reference;
        if (!Array.isArray(assets) || !assets.length) throw new Error('Reference import requires original and decoded assets.');
        if (!metadata?.authorization || !metadata.transcript) throw new Error('Reference authorization and transcript are required.');
        this._mutation = true;
        const before = this.snapshot();
        try {
            this._record.references.push(clone(metadata));
            // Imported target transcripts are already visible to this reviewer.
            for (const trial of this._record.trials) {
                if (metadata.transcript.toLowerCase().includes(trial.text.toLowerCase())) trial.targetExposed = true;
            }
            await this._save(assets);
            return clone(metadata);
        } catch (error) { this._record = before; throw error; }
        finally { this._mutation = false; }
    }

    async referenceAudio(index) {
        return this._edit(async () => {
        const reference = this._record?.references[index];
        if (!reference || !Number.isInteger(index)) throw new Error('Select a saved reference.');
        const asset = this._assets.get(reference.pcmAssetId);
        if (!asset || await sha256HexOfBytes(asset.bytes) !== reference.pcmSha256
            || asset.bytes.byteLength !== reference.sampleCount * 4) throw new Error('Reference PCM failed integrity validation.');
        const pcm = new Float32Array(reference.sampleCount);
        const view = new DataView(asset.bytes);
        for (let i = 0; i < pcm.length; i++) pcm[i] = view.getFloat32(i * 4, true);
        for (const trial of this._record.trials) {
            if (reference.transcript.toLowerCase().includes(trial.text.toLowerCase())) trial.targetExposed = true;
        }
        return { pcm, sampleRate: reference.sampleRate };
        });
    }

    async annotateReference(index, { label, type, startSample, endSample, confidence = null, origin }) {
        return this._edit(() => {
            const reference = this._record?.references[index];
            if (!reference || !Number.isInteger(index)) throw new Error('Select a saved reference.');
            if (!['word', 'phone', 'event'].includes(type) || origin !== 'manual-correction'
                || !Number.isInteger(startSample) || !Number.isInteger(endSample)
                || startSample < 0 || endSample < startSample || endSample > reference.sampleCount
                || (type !== 'event' && endSample === startSample)
                || (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1))) {
                throw new Error('Reference boundaries must use valid original reference sample positions and confidence.');
            }
            const annotation = { id: crypto.randomUUID(), at: timestamp(), referenceIndex: index,
                referencePcmHash: reference.pcmSha256, sampleRate: reference.sampleRate,
                label: text(label, 'Annotation label', 120), type, startSample, endSample, confidence, origin };
            this._record.referenceAnnotations ??= [];
            this._record.referenceAnnotations.push(annotation);
            return annotation;
        });
    }
}
