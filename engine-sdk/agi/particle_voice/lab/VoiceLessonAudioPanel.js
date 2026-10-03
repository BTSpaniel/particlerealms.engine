// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Local audio saving is independent of listening/scoring success. */
export function mountVoiceLessonAudioPanel({ document, archive, isBlocked, onError = () => {} }) {
    const el = id => document.getElementById(id);
    const handles = new WeakMap(), latest = new Map(), urls = new Set();
    const events = new AbortController();
    let sessions = [], pending = 0, listing = false, disposed = false, exporting = false;
    let lastError = '', selectedSignature = '', deleteId = null;

    function refresh() {
        if (disposed) return;
        const blocked = isBlocked() || pending > 0 || exporting;
        for (const [id, kind] of [['lesson-audio-download', 'classroom'], ['evaluation-audio-download', 'evaluation']]) {
            const button = el(id), handle = latest.get(kind);
            if (button) button.disabled = blocked || !handle?.persisted;
        }
        const picker = el('saved-audio-select');
        if (picker) {
            const signature = JSON.stringify(sessions.map(item => [item.id, item.updatedAt, item.status, item.captures, item.clips]));
            if (selectedSignature !== signature) {
                const previous = picker.value;
                picker.replaceChildren(...(sessions.length ? sessions : [{ id: '', title: 'No saved audio yet' }]).map(item => {
                    const option = document.createElement('option'); option.value = item.id;
                    const date = item.createdAt ? new Date(item.createdAt).toLocaleString() : '';
                    option.textContent = item.id ? `${item.title || item.mode} · ${date} · ${item.status === 'active' ? 'unfinished snapshot' : item.status}` : item.title;
                    return option;
                }));
                if (sessions.some(item => item.id === previous)) picker.value = previous;
                selectedSignature = signature;
            }
            picker.disabled = blocked || !sessions.length;
        }
        for (const id of ['saved-audio-download', 'saved-audio-delete']) {
            if (el(id)) el(id).disabled = blocked || !picker?.value;
        }
        if (el('saved-audio-confirm-delete')) el('saved-audio-confirm-delete').disabled = blocked;
        if (el('saved-audio-delete-confirmation')) el('saved-audio-delete-confirmation').hidden = !deleteId;
        const message = lastError || (pending ? 'Saving audio and results…'
            : exporting ? 'Preparing your WAV download…'
                : sessions.length ? 'Audio and results saved in this browser. Download a ZIP to keep a separate copy.'
                    : 'Test audio will save here automatically. Download it after finishing or ending a test.');
        for (const id of ['lesson-audio-status', 'evaluation-audio-status']) if (el(id)) {
            el(id).textContent = message;
            el(id).dataset.state = lastError ? 'error' : 'saved';
        }
    }
    async function refreshList() {
        if (disposed || listing) return;
        listing = true;
        try { sessions = await archive.listSessions(); }
        catch (error) { reportFailure(error); }
        finally { listing = false; refresh(); }
    }
    function reportFailure(error) {
        lastError = 'Some audio or results could not be saved. Your listening answers still count. Free storage or download the saved files; missing clips are not regenerated.';
        console.warn('[VoiceLessonAudio]', error?.message ?? error);
        try { onError(error); } catch { /* Observer errors must not change listening results. */ }
        refresh();
    }
    function track(action) {
        pending += 1; refresh();
        return Promise.resolve().then(action).catch(error => { reportFailure(error); return null; }).finally(() => {
            pending -= 1;
            if (!pending) void refreshList();
            refresh();
        });
    }
    function start(session, { kind = 'classroom', metadata = {} } = {}) {
        if (disposed || !session || handles.has(session)) return;
        const handle = { id: `voice-listening-${crypto.randomUUID()}`, persisted: false, tail: null };
        handles.set(session, handle); latest.set(kind, handle);
        const snapshot = structuredClone(metadata);
        handle.tail = track(async () => {
            await archive.startSession({ id: handle.id, mode: session.mode ?? kind,
                title: kind === 'evaluation' ? 'Held-out listening evaluation' : kind === 'warmup' ? 'Unscored warmup' : `${session.mode} listening test`,
                metadata: { ...snapshot, kind, audioStage: 'model-output-before-playback-resampling',
                    microphoneRecording: false, heldOut: kind === 'evaluation', tuneAgainstThisCorpus: kind !== 'evaluation' } });
            handle.persisted = true;
            return handle.id;
        });
    }
    function forSession(session, action) {
        const handle = handles.get(session);
        if (!handle || disposed) return Promise.resolve(null);
        // Preserve click order through asynchronous hashing and IndexedDB writes.
        // track contains failures, so an unavailable clip cannot poison later answers.
        const previous = handle.tail;
        handle.tail = track(async () => {
            await previous;
            if (!handle.persisted) throw new Error('The audio session could not be created.');
            return action(handle.id);
        });
        return handle.tail;
    }
    function capture(session, input) {
        const snapshot = { ...input, pcm: input.pcm?.slice() ?? null, metadata: structuredClone(input.metadata ?? {}) };
        return forSession(session, id => archive.capture(id, snapshot));
    }
    function settle(session, captureId, details) {
        if (!captureId) return Promise.resolve(null);
        const snapshot = structuredClone(details);
        return forSession(session, id => archive.settle(id, captureId, snapshot));
    }
    function checkpoint(session, report, options = {}) {
        const snapshot = structuredClone(report), savedOptions = structuredClone(options);
        return forSession(session, id => archive.saveReport(id, snapshot, savedOptions));
    }
    async function download(id) {
        if (disposed || isBlocked() || pending || exporting || !id) return;
        exporting = true; refresh();
        try {
            const blob = await archive.exportSession(id);
            if (disposed) return;
            const url = URL.createObjectURL(blob); urls.add(url);
            const link = document.createElement('a'); link.href = url; link.download = `${id}-audio-and-results.zip`;
            document.body.append(link); link.click(); link.remove();
            setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 1000);
        } catch (error) { reportFailure(error); }
        finally { exporting = false; refresh(); }
    }
    function listen(id, callback) {
        el(id)?.addEventListener('click', () => { void Promise.resolve().then(callback).catch(reportFailure); }, { signal: events.signal });
    }
    listen('lesson-audio-download', () => download(latest.get('classroom')?.id));
    listen('evaluation-audio-download', () => download(latest.get('evaluation')?.id));
    listen('saved-audio-download', () => download(el('saved-audio-select')?.value));
    listen('saved-audio-delete', () => {
        if (isBlocked() || pending || exporting) return;
        deleteId = el('saved-audio-select')?.value || null; refresh();
    });
    listen('saved-audio-cancel-delete', () => { deleteId = null; refresh(); });
    listen('saved-audio-confirm-delete', () => {
        if (isBlocked() || pending || exporting || !deleteId) return;
        const id = deleteId; deleteId = null;
        return track(async () => {
            await archive.deleteSession(id);
            for (const handle of latest.values()) if (handle.id === id) handle.persisted = false;
            lastError = '';
        });
    });
    el('saved-audio-select')?.addEventListener('change', () => { deleteId = null; refresh(); }, { signal: events.signal });
    el('saved-test-audio')?.addEventListener('toggle', () => { if (el('saved-test-audio').open) void refreshList(); }, { signal: events.signal });
    void refreshList();
    return Object.freeze({ start, capture, settle, checkpoint, refresh,
        dispose() {
            if (disposed) return;
            disposed = true; events.abort();
            for (const url of urls) URL.revokeObjectURL(url);
            urls.clear(); void archive.close().catch(error => { console.warn('[VoiceLessonAudio] Close failed', error?.message ?? error); });
        },
    });
}
