// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Session-only listening controls over existing authored synthesis parameters.
 * This module owns no model, device, audio, storage or training. The host must
 * replace its idle model in onApply, preserving pronunciation overrides and
 * unrelated options. Draft sliders are never an applied configuration receipt.
 */
import { DEFAULT_VOICE_MODEL_CONFIG } from '../model/ParticleVoiceModel.js';
import { DEFAULT_VOICE_PRESET, VOICE_PRESETS, getVoicePreset } from '../model/VoicePresets.js';

export const DEFAULT_VOICE_LAB_TUNING = Object.freeze({
    pitch: 100, breathiness: 100, hiss: 100, level: 100,
});

export const VOICE_LAB_TUNING_CONTROLS = Object.freeze([
    Object.freeze({ key: 'pitch', label: 'Pitch', min: 80, max: 140, step: 5,
        help: 'Lower or higher voice. Word speed and vowel geometry stay unchanged.' }),
    Object.freeze({ key: 'breathiness', label: 'Breathiness', min: 0, max: 300, step: 5,
        help: 'Airy texture during voiced sounds. Does not change breathing pauses.' }),
    Object.freeze({ key: 'hiss', label: 'Hiss strength', min: 50, max: 150, step: 5,
        help: 'Turbulence for sounds such as F and S. This is not an all-consonant clarity control.' }),
    Object.freeze({ key: 'level', label: 'Output level', min: 50, max: 120, step: 5,
        help: 'Target speech loudness. Start quietly; the existing output limiter remains enabled.' }),
]);

/** Validate exact numeric slider values and return an immutable applied candidate. */
export function createVoiceLabTuningSnapshot(values = DEFAULT_VOICE_LAB_TUNING, voicePreset = DEFAULT_VOICE_PRESET) {
    if (!values || typeof values !== 'object' || Array.isArray(values)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(values))) {
        throw new TypeError('Voice tuning requires a plain settings record.');
    }
    const descriptors = Object.getOwnPropertyDescriptors(values);
    const keys = Reflect.ownKeys(descriptors);
    if (Object.hasOwn(descriptors, 'schemaVersion')) {
        const schema = descriptors.schemaVersion.value;
        const permitted = ['schemaVersion', 'scope', 'experimental', 'values', 'actual'];
        if (schema === 2) permitted.push('voicePreset', 'basePreset');
        if (![1, 2].includes(schema) || keys.length !== permitted.length
            || keys.some((key) => !permitted.includes(key))
            || Object.values(descriptors).some((descriptor) => !Object.hasOwn(descriptor, 'value'))
            || descriptors.scope.value !== 'lab-session' || descriptors.experimental.value !== true) {
            throw new TypeError('Unsupported voice tuning snapshot.');
        }
        // Recompute effective controls from validated sliders and the known
        // preset. Imported receipts cannot inject arbitrary model parameters.
        return createVoiceLabTuningSnapshot(descriptors.values.value,
            schema === 1 ? DEFAULT_VOICE_PRESET : descriptors.voicePreset.value);
    }
    const preset = getVoicePreset(voicePreset);
    if (keys.length !== VOICE_LAB_TUNING_CONTROLS.length
        || keys.some((key) => !VOICE_LAB_TUNING_CONTROLS.some((control) => control.key === key))) {
        throw new TypeError('Voice tuning requires exactly pitch, breathiness, hiss and level.');
    }
    const validated = {};
    for (const control of VOICE_LAB_TUNING_CONTROLS) {
        const descriptor = descriptors[control.key];
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError('Voice tuning settings cannot use accessors.');
        }
        const value = descriptor.value;
        if (typeof value !== 'number' || !Number.isFinite(value)
            || value < control.min || value > control.max
            || (value - control.min) % control.step !== 0) {
            throw new RangeError(`${control.label} must be ${control.min}–${control.max}% in ${control.step}% steps.`);
        }
        validated[control.key] = value;
    }
    return Object.freeze({
        schemaVersion: 2, scope: 'lab-session', experimental: true,
        voicePreset: preset.id, basePreset: preset,
        values: Object.freeze(validated),
        actual: Object.freeze({
            model: Object.freeze({ ...preset.model, targetRms: DEFAULT_VOICE_MODEL_CONFIG.targetRms * (validated.level / 100) }),
            prosody: Object.freeze({ ...preset.prosody, baseF0Hz: preset.prosody.baseF0Hz * (validated.pitch / 100) }),
            articulation: Object.freeze({
                ...preset.articulation,
                voicedAspiration: preset.articulation.voicedAspiration * (validated.breathiness / 100),
                fricationAmplitude: preset.articulation.fricationAmplitude * (validated.hiss / 100),
            }),
        }),
    });
}

/**
 * Mount accessible controls into an empty, host-owned container.
 * onApply resolves only once the host has committed a fresh idle model. Preview
 * is separate so a playback failure cannot undo that configuration receipt.
 * Voice selection applies visible settings without autoplay. Slider edits remain
 * drafts until Apply, Apply and preview, or a voice selection commits them.
 * onApplyingChange gates host actions only during replacement, before preview.
 * Call refresh whenever host readiness, rendering or evaluation state changes.
 */
export function mountVoiceLabTuning({
    container, isBusy, isEvaluationActive, isReady, onApply, onPreview,
    onError = () => {}, onApplyingChange = () => {},
}) {
    if (!container?.ownerDocument || typeof container.append !== 'function'
        || container.childNodes.length !== 0) {
        throw new TypeError('Voice tuning requires an empty DOM container.');
    }
    for (const callback of [isBusy, isEvaluationActive, isReady, onApply, onError, onApplyingChange]) {
        if (typeof callback !== 'function') throw new TypeError('Voice tuning requires host lifecycle callbacks.');
    }
    if (onPreview !== undefined && typeof onPreview !== 'function') {
        throw new TypeError('Voice tuning preview must be a function.');
    }
    const document = container.ownerDocument;
    const listeners = new AbortController();
    let disposed = false;
    let applying = false;
    let committing = false;
    let applied = createVoiceLabTuningSnapshot();
    const inputs = new Map();
    const outputs = new Map();
    const root = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = 'Simple voice tuning · experimental';
    const introduction = document.createElement('p');
    introduction.textContent = 'Choosing a voice applies your settings immediately. Use Play preview to hear it. Fine-tuning changes use Apply.';
    root.append(legend, introduction);
    const voiceLabel = document.createElement('label');
    voiceLabel.textContent = 'Voice ';
    const voiceSelect = document.createElement('select');
    voiceSelect.name = 'voicePreset';
    voiceSelect.setAttribute('aria-label', 'Voice');
    for (const preset of VOICE_PRESETS) {
        const option = document.createElement('option');
        option.value = preset.id; option.textContent = preset.label;
        voiceSelect.append(option);
    }
    voiceSelect.value = applied.voicePreset;
    voiceLabel.append(voiceSelect); root.append(voiceLabel);
    const readinessHint = document.createElement('p');
    readinessHint.dataset.tuningReadiness = '';
    readinessHint.setAttribute('aria-live', 'polite');
    root.append(readinessHint);
    voiceSelect.addEventListener('change', () => {
        if (blocked()) { voiceSelect.value = applied.voicePreset; return; }
        if (voiceSelect.value !== applied.voicePreset) void commit();
    }, { signal: listeners.signal });
    const fineTuning = document.createElement('details');
    fineTuning.dataset.tuningFine = '';
    const fineSummary = document.createElement('summary');
    fineSummary.textContent = 'Fine tuning (optional)';
    const fineHelp = document.createElement('p');
    fineHelp.textContent = 'Sliders adjust the selected voice. 100% keeps its starting settings.';
    fineTuning.append(fineSummary, fineHelp);
    for (const control of VOICE_LAB_TUNING_CONTROLS) {
        const label = document.createElement('label');
        label.style.display = 'block';
        label.style.marginBlock = '0.8rem';
        const title = document.createElement('span');
        title.textContent = `${control.label} `;
        const input = document.createElement('input');
        input.type = 'range';
        input.name = control.key;
        input.min = String(control.min);
        input.max = String(control.max);
        input.step = String(control.step);
        input.value = String(applied.values[control.key]);
        input.setAttribute('aria-label', control.label);
        input.style.width = 'min(100%, 20rem)';
        const output = document.createElement('output');
        const help = document.createElement('small');
        help.textContent = control.help;
        help.style.display = 'block';
        label.append(title, input, output, help);
        fineTuning.append(label);
        inputs.set(control.key, input);
        outputs.set(control.key, output);
        input.addEventListener('input', () => {
            updateReadouts();
            if (!blocked()) status.textContent = 'Draft settings only. Apply them before listening.';
        }, { signal: listeners.signal });
    }
    const actions = document.createElement('div');
    const makeButton = (action, text) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.tuningAction = action;
        button.textContent = text;
        button.style.marginInlineEnd = '0.5rem';
        actions.append(button);
        return button;
    };
    const previewButton = onPreview ? makeButton('preview', 'Apply and preview') : null;
    const applyButton = makeButton('apply', 'Apply');
    const resetButton = makeButton('reset', 'Reset defaults');
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = `${applied.basePreset.label} is active.`;
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Actual applied parameters';
    const parameters = document.createElement('pre');
    details.append(summary, parameters);
    root.append(actions, status, fineTuning, details);
    container.append(root);

    function blocked() {
        return disposed || applying || isBusy() || isEvaluationActive() || !isReady();
    }

    function updateReadouts() {
        for (const control of VOICE_LAB_TUNING_CONTROLS) {
            const input = inputs.get(control.key);
            outputs.get(control.key).textContent = ` ${input.value}%`;
            input.setAttribute('aria-valuetext', `${input.value}% of authored ${control.label.toLowerCase()}`);
        }
    }

    function refresh() {
        const disabled = blocked();
        root.disabled = disabled;
        // Individual disabled states also make direct accessibility inspection
        // unambiguous; fieldset alone correctly blocks interaction in browsers.
        for (const input of inputs.values()) input.disabled = disabled;
        voiceSelect.disabled = disabled;
        readinessHint.hidden = isReady() && !isEvaluationActive() && !isBusy();
        readinessHint.textContent = !isReady() ? 'Choose Enable audio above to select and preview a voice.'
            : isEvaluationActive() ? 'Finish or end the listening test before changing the voice.'
                : 'Voice settings unlock when the current audio or comparison finishes.';
        for (const button of [applyButton, previewButton, resetButton]) {
            if (button) button.disabled = disabled;
        }
        parameters.textContent = JSON.stringify({ voicePreset: applied.voicePreset, actual: applied.actual }, null, 2);
        updateReadouts();
    }

    async function commit({ reset = false, preview = false } = {}) {
        if (blocked()) return;
        applying = true;
        committing = true;
        refresh();
        try {
            onApplyingChange(true);
            const values = reset ? DEFAULT_VOICE_LAB_TUNING
                : Object.fromEntries([...inputs].map(([key, input]) => [key, Number(input.value)]));
            const candidate = createVoiceLabTuningSnapshot(values, reset ? DEFAULT_VOICE_PRESET : voiceSelect.value);
            status.textContent = 'Applying voice settings…';
            await onApply(candidate);
            if (disposed) return;
            applied = candidate;
            voiceSelect.value = applied.voicePreset;
            for (const [key, input] of inputs) input.value = String(applied.values[key]);
            parameters.textContent = JSON.stringify({ voicePreset: applied.voicePreset, actual: applied.actual }, null, 2);
            status.textContent = `${applied.basePreset.label} is active.${reset ? ' Default settings restored.' : ''}`;
            committing = false;
            onApplyingChange(false);
            if (preview) {
                // The model replacement is committed before playback is begun.
                // Recheck host state after a potentially asynchronous replacement:
                // a new lesson must never receive an unrelated preview sound.
                if (isBusy() || isEvaluationActive() || !isReady()) {
                    status.textContent = 'Settings applied. Preview was skipped because the lab state changed; replay after the active activity ends.';
                    return;
                }
                await onPreview(applied);
            }
        } catch (error) {
            if (!disposed) {
                voiceSelect.value = applied.voicePreset;
                status.textContent = `Could not finish tuning or preview. ${applied.basePreset.label} is active.`;
                onError(error);
            }
        } finally {
            if (committing) { committing = false; onApplyingChange(false); }
            applying = false;
            if (!disposed) refresh();
        }
    }

    applyButton.addEventListener('click', () => { void commit(); }, { signal: listeners.signal });
    previewButton?.addEventListener('click', () => { void commit({ preview: true }); }, { signal: listeners.signal });
    resetButton.addEventListener('click', () => { void commit({ reset: true }); }, { signal: listeners.signal });
    refresh();
    return Object.freeze({
        refresh,
        get applying() { return committing; },
        snapshot: () => applied,
        dispose() {
            if (disposed) return;
            disposed = true;
            listeners.abort();
            root.remove();
        },
    });
}
