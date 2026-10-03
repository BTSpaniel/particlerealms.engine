// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Optional listener observations. The session owns validation and provenance. */
export function mountListeningFeedbackPanel({ document, prefix, getState, onChange, onError }) {
    const container = document.getElementById(`${prefix}-listener-feedback`);
    const detailHost = document.getElementById(`${prefix}-more-feedback-host`);
    if (!container || !detailHost) return Object.freeze({ refresh() {}, flush() {} });
    container.replaceChildren(); detailHost.replaceChildren();
    const controls = new Map(), confidenceButtons = [];
    let session = null, trialIndex = null, values = defaults(), committed = defaults();
    function defaults() {
        return { confidence: null, clarity: null, smoothness: null, naturalness: null,
            questionProblems: [], audioProblems: [], anotherSound: '' };
    }
    function node(tag, text = null, id = null) {
        const element = document.createElement(tag);
        if (text !== null) element.textContent = text;
        if (id) element.id = `${prefix}-${id}`;
        return element;
    }
    const confidence = node('fieldset', null, 'confidence-group');
    confidence.className = 'listener-confidence';
    confidence.append(node('legend', 'How sure are you? (optional)'));
    const confidenceRow = node('div'); confidenceRow.className = 'listener-confidence-options';
    for (const [value, label] of [['guessing', 'Guessing'], ['unsure', 'Unsure'], ['sure', 'Sure']]) {
        const button = node('button', label); button.type = 'button'; button.className = 'secondary';
        button.dataset.confidence = value; button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => {
            if (!getState().canConfidence) return;
            values.confidence = values.confidence === value ? null : value;
            flush(); refresh();
        });
        confidenceButtons.push(button); confidenceRow.append(button);
    }
    confidence.append(confidenceRow); container.append(confidence);
    const details = node('details', null, 'more-feedback');
    details.className = 'listener-more-feedback';
    details.append(node('summary', 'More feedback (optional)'));
    details.append(node('p', 'Rate the sound or flag a problem. These notes do not change your correctness score.'));
    const ratings = node('div'); ratings.className = 'listener-ratings';
    for (const [key, label, labels] of [
        ['clarity', 'Clarity · How easy was it to understand?', ['Very hard', 'Hard', 'Mixed', 'Mostly clear', 'Very clear']],
        ['smoothness', 'Smoothness · How well did the sounds join?', ['Very broken', 'Often broken', 'Mixed', 'Mostly smooth', 'Smooth']],
        ['naturalness', 'Naturalness · How natural did it sound?', ['Very unnatural', 'Unnatural', 'Mixed', 'Mostly natural', 'Natural']],
    ]) {
        const field = node('label', label); field.htmlFor = `${prefix}-${key}`;
        const select = node('select', null, key);
        for (const [value, text] of [['', 'Not rated'], ...labels.map((text, index) => [String(index + 1), `${index + 1} · ${text}`])]) {
            const option = node('option', text); option.value = value; select.append(option);
        }
        select.addEventListener('change', () => { values[key] = select.value ? Number(select.value) : null; flush(); });
        controls.set(key, select); field.append(select); ratings.append(field);
    }
    details.append(ratings);
    for (const [key, title, kind, flags] of [
        ['questionProblems', 'Question problems', 'question', [['misleading-choices', 'Misleading choices'], ['another-sound', 'I heard another sound']]],
        ['audioProblems', 'Audio problems', 'audio', [['too-quiet', 'Too quiet'], ['clicking', 'Clicking'], ['cut-off', 'Cut off']]],
    ]) {
        const fieldset = node('fieldset'); fieldset.className = 'listener-flags'; fieldset.append(node('legend', title));
        const boxes = [];
        for (const [value, title] of flags) {
            const label = node('label'), box = node('input', null, `${kind}-${value}`);
            box.type = 'checkbox'; box.value = value;
            box.addEventListener('change', () => {
                values[key] = boxes.filter(item => item.checked).map(item => item.value);
                if (key === 'questionProblems' && !values.questionProblems.includes('another-sound')) {
                    values.anotherSound = ''; controls.get('anotherSound').value = '';
                }
                flush(); refresh();
            });
            label.append(box, document.createTextNode(title)); fieldset.append(label); boxes.push(box);
        }
        controls.set(key, boxes); details.append(fieldset);
    }
    const otherField = node('label', 'What else did you hear? (optional)');
    otherField.htmlFor = `${prefix}-another-sound`;
    const other = node('input', null, 'another-sound'); other.type = 'text'; other.maxLength = 200;
    other.autocomplete = 'off'; other.spellcheck = false;
    other.addEventListener('change', () => { values.anotherSound = other.value; flush(); });
    otherField.append(other); controls.set('anotherSound', other); details.append(otherField);
    const status = node('p', '', 'feedback-timing'); status.setAttribute('role', 'status'); details.append(status);
    detailHost.append(details);

    function flush() {
        const state = getState();
        if (!state.visible || session !== state.session || trialIndex !== state.trialIndex) return;
        values.anotherSound = other.value;
        const patch = Object.fromEntries(Object.entries(values).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(committed[key])));
        if (!Object.keys(patch).length) return;
        try {
            onChange(structuredClone(patch), state.trialIndex);
            committed = structuredClone(values);
            status.textContent = state.timing;
        } catch (error) {
            status.textContent = 'This feedback could not be saved. Your answer is unchanged.';
            console.warn('[ListeningFeedback]', error?.message ?? error);
            onError?.(error);
        }
    }
    function refresh() {
        const state = getState();
        if (session !== state.session || trialIndex !== state.trialIndex) {
            session = state.session; trialIndex = state.trialIndex; values = defaults(); committed = defaults();
            for (const key of ['clarity', 'smoothness', 'naturalness', 'anotherSound']) controls.get(key).value = '';
            for (const key of ['questionProblems', 'audioProblems']) for (const box of controls.get(key)) box.checked = false;
        }
        container.hidden = !state.visible || state.afterAnswer || !state.hasCompleted;
        detailHost.hidden = !state.visible;
        for (const button of confidenceButtons) {
            button.disabled = !state.canConfidence;
            button.setAttribute('aria-pressed', String(values.confidence === button.dataset.confidence));
        }
        for (const key of ['clarity', 'smoothness', 'naturalness']) controls.get(key).disabled = !state.canRate;
        for (const key of ['questionProblems', 'audioProblems']) for (const box of controls.get(key)) box.disabled = !state.canFlag;
        otherField.hidden = !values.questionProblems.includes('another-sound'); other.disabled = !state.canFlag;
        status.textContent = state.timing;
    }
    refresh();
    return Object.freeze({ refresh, flush });
}

/** Display each observation independently, with its own collection timing. */
export function showListeningFeedbackSummary(document, report) {
    const host = document.getElementById('lesson-feedback-summary');
    if (!host) return;
    const body = host.querySelector('[data-feedback-results]');
    body.replaceChildren();
    const trials = new Map(), targets = new Map((report.results ?? []).map(result => [result.id, result.target]));
    for (const event of report.feedback?.events ?? []) {
        if (!trials.has(event.trialId)) trials.set(event.trialId, new Map());
        for (const [field, value] of Object.entries(event.patch)) trials.get(event.trialId).set(field, { value, event });
    }
    const names = { confidence: 'Confidence', clarity: 'Clarity', smoothness: 'Smoothness', naturalness: 'Naturalness',
        questionProblems: 'Question problems', audioProblems: 'Audio problems', anotherSound: 'Another sound heard' };
    let count = 0;
    for (const [id, fields] of trials) {
        const observations = [...fields].filter(([, { value }]) => value !== null && value !== '' && (!Array.isArray(value) || value.length));
        if (!observations.length) continue;
        const item = document.createElement('section'); item.className = 'listener-feedback-result';
        const heading = document.createElement('h4');
        heading.textContent = targets.get(id) ?? `Sound ${observations[0][1].event.trialIndex}`; item.append(heading);
        for (const [field, { value, event }] of observations) {
            const line = document.createElement('p');
            const text = Array.isArray(value) ? value.map(flag => flag.replaceAll('-', ' ')).join(', ')
                : typeof value === 'number' ? `${value}/5` : value;
            const timing = event.feedbackRevealed ? 'after answer shown' : 'before answer shown';
            line.textContent = `${names[field] ?? field}: ${text} · ${timing}${event.afterReplay ? ', after replay or retry' : ''}`;
            item.append(line);
        }
        body.append(item); count++;
    }
    host.hidden = count === 0;
    host.querySelector('summary').textContent = `Your sound feedback · ${count} sound${count === 1 ? '' : 's'}`;
}
