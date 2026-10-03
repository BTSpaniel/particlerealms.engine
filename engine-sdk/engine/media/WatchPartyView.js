// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { PlayerView, mediaElement, PLAYER_CSS } from './PlayerView.js';
import { LiveCodecSender, LiveCodecReceiver } from './LiveCodecSession.js';
import { Playlist, parsePlaylist } from './Playlist.js';

const VIDEO_ACCEPT = 'video/*,audio/*,.prv,.h264,.264,.m1v,.m2v,.ivf';
const isVfsPath = path => /^\/(user|system|mounts)(\/|$)/.test(path);
const VIEW_CSS = `
.pr-media-heading{font-size:21px}.pr-media>label{display:flex;gap:8px;align-items:center}.pr-media input[type=checkbox]{min-height:18px;width:18px;height:18px;padding:0;margin:0;flex:none}.pr-player-welcome{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:9px;text-align:center;padding:25px;background:#080d17;color:#b8c4d4}.pr-player-welcome strong{font-size:20px;color:#f3f4f6}.pr-player-stage:has(.pr-player-welcome:not([hidden])) video{visibility:hidden}.pr-media-party{border:1px solid #374151;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:10px}.pr-media-party summary{font-size:16px;font-weight:600;cursor:pointer;margin-bottom:10px}.pr-media-party>.pr-media-row{margin-top:8px}.pr-media-source-title{font-size:12px;color:#b8c4d4;overflow-wrap:anywhere}.pr-media-drop{outline:2px dashed #38bdf8;outline-offset:-4px}.pr-media-library{display:flex;flex-direction:column;gap:8px}
`;

/** One media library and player with optional host-authoritative Watch Party. */
export class WatchPartyView {
    constructor({ root, player, createParty, guestOnly = false, displayName = '', initialCode = '', readFile = null, writeFile = null, resumeAudio = null, partyAvailable = true, onPlayerChange = null } = {}) {
        this.root = root; this.player = player; this._createParty = createParty; this._guestOnly = guestOnly;
        this._readFile = readFile; this._writeFile = writeFile; this._resumeAudio = resumeAudio; this._partyAvailable = partyAvailable;
        this._onPlayerChange = onPlayerChange;
        this._code = initialCode; this._revision = 0; this._controlGeneration = 0; this._off = []; this._disposed = false;
        this._queue = new Playlist(); this._loadGeneration = 0; this._exports = new Map();
        this._build(displayName); this._bindPlayer();
    }
    _build(name) {
        const style = mediaElement('style', {}, PLAYER_CSS + VIEW_CSS); this.root.append(style);
        this.element = mediaElement('section', { className: 'pr-media', 'aria-label': 'Video Player' });
        this.element.append(mediaElement('h1', { className: 'pr-media-heading' }, 'Video Player'));
        this._partyBox = mediaElement('details', { className: 'pr-media-party', open: this._guestOnly || !!this._code });
        this._partyBox.append(mediaElement('summary', {}, 'Watch Party'));
        this._joinRow = mediaElement('div', { className: 'pr-media-row' });
        this._name = mediaElement('input', { type: 'text', maxLength: 64, value: name, placeholder: 'Your display name', 'aria-label': 'Display name', autocomplete: 'nickname' });
        this._invite = mediaElement('input', { type: 'text', value: this._code, placeholder: 'Invite code or link', 'aria-label': 'Invite code', autocomplete: 'off', spellcheck: false });
        this._join = mediaElement('button', {}, 'Join'); this._join.onclick = () => this.join().catch(error => this._status(error.message));
        this._invite.onkeydown = event => { if (event.key === 'Enter') this._join.click(); };
        this._name.onkeydown = event => { if (event.key === 'Enter' && this._invite.value) this._join.click(); };
        this._joinRow.append(this._name, this._invite, this._join);
        this._hostRow = mediaElement('div', { className: 'pr-media-row' }); this._hostRow.hidden = this._guestOnly;
        this._mode = mediaElement('select', { 'aria-label': 'Sharing mode' });
        for (const [value, label] of [['restream', 'Restream video to friends'], ['url', 'Play the same URL'], ['custom', 'Experimental authored codec (360p)']]) this._mode.append(mediaElement('option', { value }, label));
        this._host = mediaElement('button', {}, 'Start Watch Party'); this._host.onclick = () => this.create().catch(error => this._status(error.message));
        this._hostRow.append(this._mode, this._host);
        this._codecMode = mediaElement('select', { 'aria-label': 'Authored codec mode', hidden: true });
        this._codecMode.append(mediaElement('option', { value: 'lossless' }, 'Lossless tile/delta'), mediaElement('option', { value: 'lossy' }, 'Lossy experimental transform'));
        this._hostRow.insertBefore(this._codecMode, this._host);
        this._mode.onchange = () => { this._codecMode.hidden = this._mode.value !== 'custom'; if (this.party?.role === 'host') this._attachSource().catch(error => this._status(error.message)); };
        this._codecMode.onchange = () => { if (this.party?.role === 'host') this._attachSource().catch(error => this._status(error.message)); };
        this._sourceRow = mediaElement('div', { className: 'pr-media-row' }); this._sourceRow.hidden = this._guestOnly;
        this._url = mediaElement('input', { type: 'text', placeholder: this._readFile ? 'Video URL or /user/file path' : 'Direct video or HLS URL', 'aria-label': 'Video source' });
        const open = mediaElement('button', {}, 'Open');
        open.onclick = () => this._openLocation().catch(error => this._status(error.message));
        const add = mediaElement('button', {}, 'Add to queue'); add.onclick = () => this._openLocation(true).catch(error => this._status(error.message));
        this._url.onkeydown = event => { if (event.key === 'Enter') open.click(); };
        const local = mediaElement('button', {}, 'Local files');
        const file = mediaElement('input', { type: 'file', accept: VIDEO_ACCEPT, multiple: true, hidden: true });
        this._localInput = file;
        local.onclick = () => file.click();
        file.onchange = () => { if (file.files.length) this._addSources([...file.files].map(blob => ({ blob, title: blob.name }))).catch(error => this._status(error.message)); file.value = ''; };
        this._sourceRow.append(this._url, open, add, local, file);
        this._sharingRow = mediaElement('label', { className: 'pr-media-status', hidden: this._guestOnly });
        this._sharing = mediaElement('input', { type: 'checkbox' });
        this._sharingRow.append(this._sharing, document.createTextNode(' Enable restreaming for remote URLs (requires server CORS permission; reopen after changing)'));
        this._queueBox = mediaElement('section', { className: 'pr-media-library', 'aria-label': 'Playlist', hidden: this._guestOnly });
        const queueControls = mediaElement('div', { className: 'pr-media-row' });
        const previous = mediaElement('button', {}, 'Previous'), next = mediaElement('button', {}, 'Next'), shuffle = mediaElement('button', {}, 'Shuffle');
        this._previous = previous; this._next = next; this._shuffle = shuffle;
        previous.onclick = () => this._advanceQueue(-1); next.onclick = () => this._advanceQueue(1); shuffle.onclick = () => { if (this._libraryAllowed()) { this._queue.shuffle(); this._renderQueue(); } };
        this._repeat = mediaElement('select', { 'aria-label': 'Repeat playlist' });
        for (const [value, label] of [['none', 'Repeat off'], ['one', 'Repeat video'], ['all', 'Repeat playlist']]) this._repeat.append(mediaElement('option', { value }, label));
        this._repeat.onchange = () => { if (this._libraryAllowed()) this._queue.repeatMode = this._repeat.value; };
        const importButton = mediaElement('button', {}, 'Import playlist'), playlistFile = mediaElement('input', { type: 'file', accept: '.json,.m3u', hidden: true });
        importButton.onclick = () => playlistFile.click();
        playlistFile.onchange = async () => { try { if (playlistFile.files[0]) await this._replace(parsePlaylist(await playlistFile.files[0].text())); } catch (error) { this._status(error.message); } playlistFile.value = ''; };
        const captions = mediaElement('button', {}, 'Subtitles'), captionFile = mediaElement('input', { type: 'file', accept: '.srt,.vtt', hidden: true });
        captions.onclick = () => captionFile.click(); captionFile.onchange = () => { if (this._libraryAllowed() && captionFile.files[0]) this.player.loadSubtitles(captionFile.files[0]).catch(error => this._status(error.message)); captionFile.value = ''; };
        this._captionsButton = captions;
        this._exportJson = mediaElement('button', {}, 'Export playlist'); this._exportJson.onclick = () => this._export('json');
        this._exportM3u = mediaElement('button', {}, 'Export M3U'); this._exportM3u.onclick = () => this._export('m3u');
        this._clearQueue = mediaElement('button', {}, 'Clear playlist'); this._clearQueue.onclick = () => this._replace([]).catch(error => this._status(error.message));
        queueControls.append(previous, next, shuffle, this._repeat, importButton, playlistFile, captions, captionFile, this._exportJson, this._exportM3u, this._clearQueue);
        this._queueList = mediaElement('ol', { className: 'pr-media-list', 'aria-label': 'Playlist items' });
        this._reselectFile = mediaElement('input', { type: 'file', accept: VIDEO_ACCEPT, hidden: true });
        this._reselectFile.onchange = () => {
            const item = this._queue.current, blob = this._reselectFile.files[0]; this._reselectFile.value = '';
            if (!this._libraryAllowed() || !blob || !item?.requiresReselection) return;
            if (item.fileName && item.fileName !== blob.name) { this._status(`Select ${item.fileName}`); return; }
            item.blob = blob; item.requiresReselection = false; this._loadQueue().catch(error => this._status(error.message));
        };
        this._queueBox.append(queueControls, this._queueList, this._reselectFile);
        if (this._readFile && this._writeFile) {
            const saveRow = mediaElement('div', { className: 'pr-media-row' });
            this._savePath = mediaElement('input', { type: 'text', value: '/user/video-playlist.json', 'aria-label': 'OS playlist save path' });
            const save = mediaElement('button', {}, 'Save to OS'), restore = mediaElement('button', {}, 'Open saved playlist');
            save.onclick = async () => { try { this._assertLibrary(); if (!isVfsPath(this._savePath.value.trim())) throw new Error('Choose an OS file path'); await this._writeFile(this._savePath.value.trim(), this._queue.serialize()); this._status(`Playlist saved to ${this._savePath.value.trim()}`); } catch (error) { this._status(error.message); } };
            restore.onclick = async () => { try { this._assertLibrary(); if (!isVfsPath(this._savePath.value.trim())) throw new Error('Choose an OS file path'); await this._replace(parsePlaylist(await (await this._readFile(this._savePath.value.trim())).text(), { base: this._savePath.value.trim() })); } catch (error) { this._status(error.message); } };
            saveRow.append(this._savePath, save, restore); this._queueBox.append(saveRow);
        }
        this._view = new PlayerView(this.player, { onError: message => this._status(message), transport: !this._guestOnly });
        this._customAudio = mediaElement('button', {}, 'Enable custom audio'); this._customAudio.hidden = true;
        this._customAudio.onclick = () => this._receiver?.enableAudio().then(() => { this._customAudio.hidden = true; }).catch(error => this._status(error.message));
        this._inviteBox = mediaElement('div'); this._inviteBox.hidden = true;
        this._shareText = mediaElement('input', { className: 'pr-media-invite', type: 'text', readOnly: true, 'aria-label': 'Shareable invite link' });
        const inviteRow = mediaElement('div', { className: 'pr-media-row' });
        this._copyLink = mediaElement('button', {}, 'Copy link'); this._copyLink.onclick = () => this._copy(this._shareText.value);
        this._copyCode = mediaElement('button', {}, 'Copy code'); this._copyCode.onclick = () => this._copy(this._currentInvite?.code || this._code);
        this._rotate = mediaElement('button', {}, 'Revoke and replace invite'); this._rotate.onclick = () => this._rotateInvite().catch(error => this._status(error.message));
        this._end = mediaElement('button', {}, 'Leave'); this._end.onclick = () => this.end().catch(error => this._status(error.message));
        inviteRow.append(this._copyLink, this._copyCode, this._rotate, this._end); this._inviteBox.append(this._shareText, inviteRow);
        this._cancel = mediaElement('button', { hidden: true }, 'Cancel connection'); this._cancel.onclick = () => this.end().catch(error => this._status(error.message));
        this._members = mediaElement('div', { className: 'pr-media-members', 'aria-label': 'Party participants' });
        this._message = mediaElement('div', { className: 'pr-media-status', role: 'status' }, this._guestOnly ? 'Enter your display name and select Join. The host controls the video.' : 'Open a file, drop videos here, or paste a video URL. Watch Party supports you and five viewers.');
        this._metrics = mediaElement('div', { className: 'pr-media-status', hidden: true });
        this._sourceTitle = mediaElement('div', { className: 'pr-media-source-title' });
        this._empty = mediaElement('div', { className: 'pr-player-welcome' });
        this._empty.append(mediaElement('strong', {}, this._guestOnly ? 'Watch together' : 'Open a video'), mediaElement('span', {}, this._guestOnly ? 'Join with your name and invitation below.' : 'Choose Local files, drop a video here, or paste a URL above.'));
        this.player.element.append(this._empty);
        this._partyBox.append(this._joinRow, this._hostRow, this._cancel, this._customAudio, this._inviteBox, this._members, this._metrics);
        if (!this._partyAvailable) this._partyBox.append(mediaElement('p', { className: 'pr-media-status' }, 'Watch Party needs HTTPS, Web Crypto, and WebRTC. Local playback is available.'));
        if (this._guestOnly) this.element.append(this._partyBox);
        this.element.append(this._sourceRow, this._sharingRow, this._sourceTitle, this.player.element, this._view.root, this._queueBox);
        if (!this._guestOnly) this.element.append(this._partyBox);
        this.element.append(this._message);
        this.root.append(this.element); this._style = style;
        this.element.ondragover = event => { if (this._libraryAllowed() && event.dataTransfer?.types.includes('Files')) { event.preventDefault(); this.element.classList.add('pr-media-drop'); } };
        this.element.ondragleave = event => { if (!this.element.contains(event.relatedTarget)) this.element.classList.remove('pr-media-drop'); };
        this.element.ondrop = event => { this.element.classList.remove('pr-media-drop'); if (!this._libraryAllowed() || !event.dataTransfer?.files.length) return; event.preventDefault(); this._addSources([...event.dataTransfer.files].map(blob => ({ blob, title: blob.name }))).catch(error => this._status(error.message)); };
        this._updateLibrary(); this._renderQueue();
    }
    _libraryAllowed() { return !this._disposed && !this._ending && !this._guestOnly && !this._joining && this.party?.role !== 'guest' && !this._releaseLease; }
    _assertLibrary() {
        if (!this._libraryAllowed()) throw new Error(this._releaseLease ? 'Change this video in its original SecureMesh window' : 'Only the host can change the party video');
    }
    _updateLibrary() {
        const allowed = this._libraryAllowed(), guest = this._guestOnly || this._joining || this.party?.role === 'guest';
        this._sourceRow.hidden = !allowed; this._sharingRow.hidden = !allowed; this._queueBox.hidden = !allowed;
        this._hostRow.hidden = guest;
        this._host.disabled = !this._partyAvailable || this._ending || !!this.party || !this.player.source;
        this._join.disabled = !this._partyAvailable || this._ending || !!this.party || !!this._releaseLease;
        this._view.setTransportEnabled(!guest && !this._ending);
        this._empty.hidden = (this._ownedPlayer || this.player).capabilities.ready;
        this._empty.firstChild.textContent = this._releaseLease ? 'Video shared from SecureMesh' : guest ? 'Watch together' : 'Open a video';
        this._empty.lastChild.textContent = this._releaseLease ? this.party?.role === 'host' ? 'The source remains in SecureMesh. Use this player for playback and invitations.' : 'The source stays in SecureMesh. Start Watch Party to restream it here.' : guest ? 'Enter your name and select Join in Watch Party.' : 'Choose Local files, drop a video here, or paste a URL above.';
        this._cancel.hidden = !this.party || !this._inviteBox.hidden; this._cancel.disabled = !!this._ending;
        this._sourceTitle.textContent = this.player.source?.title || '';
        this._captionsButton.disabled = !allowed || !this.player.source;
    }
    openParty() { this._partyBox.open = true; this._name.focus(); }
    async _openLocation(appendOnly = false) {
        this._assertLibrary(); const location = this._url.value.trim(); if (!location) return;
        if (/\.(json|m3u)(?:$|[?#])/i.test(location)) {
            let text;
            if (isVfsPath(location)) { if (!this._readFile) throw new Error('OS files are available inside WebGPU OS'); text = await (await this._readFile(location)).text(); }
            else { const url = new URL(location, globalThis.location.href); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Playlist URLs must use HTTP or HTTPS'); const response = await fetch(url.href); if (!response.ok) throw new Error(`Playlist request failed (${response.status})`); text = await response.text(); }
            return this._replace(parsePlaylist(text, { base: location }));
        }
        if (isVfsPath(location) && !this._readFile) throw new Error('OS files are available inside WebGPU OS');
        return this._addSources([{ ...(isVfsPath(location) ? { path: location } : { url: location, ...(this._sharing.checked ? { crossOrigin: 'anonymous' } : {}) }), title: location.split('/').pop() }], { select: !appendOnly });
    }
    async _replace(items) {
        this._assertLibrary(); this._queue.replace(items); this._renderQueue();
        console.debug('[VideoPlayerUI] playlist replaced', { items: items.length });
        if (this._queue.current) await this._loadQueue();
        else { ++this._loadGeneration; this.player.clear(); this._status('Playlist cleared. Open a video to start.'); }
    }
    _export(format) {
        try {
            this._assertLibrary(); if (!this._queue.items.length) throw new Error('The playlist is empty');
            const url = URL.createObjectURL(new Blob([format === 'm3u' ? this._queue.serializeM3u() : this._queue.serialize()], { type: format === 'm3u' ? 'audio/x-mpegurl' : 'application/json' }));
            mediaElement('a', { href: url, download: `playlist.${format}` }).click();
            this._exports.set(url, setTimeout(() => { URL.revokeObjectURL(url); this._exports.delete(url); }, 1000));
            this._status('Playlist exported. Temporary local files require reselection when imported.');
        } catch (error) { this._status(error.message); }
    }
    _status(message) { if (!this._disposed) this._message.textContent = message || ''; }
    _copy(value) {
        if (!navigator.clipboard?.writeText) { this._shareText.focus(); this._shareText.select(); this._status('Select and copy the invite'); return; }
        navigator.clipboard.writeText(value).then(() => this._status('Invite copied')).catch(() => { this._shareText.focus(); this._shareText.select(); this._status('Select and copy the invite'); });
    }
    _bindPlayer() {
        for (const off of this._playerOff || []) off();
        this._playerOff = [this.player.on('error', error => this._status(error.message)), this.player.on('disposed', () => this.end())];
        for (const type of ['source', 'cleared', 'loadedmetadata', 'loadeddata', 'resize', 'capabilities', 'error']) this._playerOff.push(this.player.on(type, () => this._updateLibrary()));
        this._playerOff.push(this.player.on('cleared', () => { if (this.party?.role === 'host') this.end().catch(error => this._status(error.message)); }));
        for (const type of ['play', 'pause', 'ratechange']) this._playerOff.push(this.player.on(type, () => this._sendState()));
        this._playerOff.push(this.player.on('play', () => {
            if (this.party?.role === 'host' && this._mode.value !== 'url' && !this._capture && !this._sender && !this._attaching) this._attachSource().catch(error => this._status(error.message));
        }));
        this._playerOff.push(this.player.on('source', () => {
            if (this.party?.role === 'host') this._attachSource().catch(error => this._status(error.message));
        }));
        this._playerOff.push(this.player.on('seeked', () => {
            if (this.party?.role === 'host' && this._mode.value === 'custom') this._attachSource().catch(error => this._status(error.message));
            else this._sendState();
        }));
        this._playerOff.push(this.player.on('subtitles', () => { if (this.party?.role === 'host') this._attachSource().catch(error => this._status(error.message)); }));
        this._playerOff.push(this.player.on('ended', () => { if (!this._releaseLease && this.party?.role !== 'guest') this._advanceQueue(1, true); }));
    }
    /** A same-owner lease keeps the original player in its existing OS window. */
    async useSharedPlayer(lease) {
        if (this.party || this._releaseLease) await this.end();
        ++this._loadGeneration; this.player.clear();
        this._ownedPlayer = this.player;
        this._previewAudio = { volume: this.player.volume, muted: this.player.muted };
        this.player = lease.player; this._releaseLease = lease.release;
        this._offRevoke = lease.onRevoke?.(() => { this.end(); this._status('The source player closed; this party ended'); });
        this._view.dispose(); this._view = new PlayerView(this.player, { onError: message => this._status(message) });
        this.element.insertBefore(this._view.root, this._queueBox);
        this._bindPlayer();
        this._onPlayerChange?.(this.player);
        this._updateLibrary(); this.openParty();
        this._status(`Sharing ${this.player.source?.title || 'the current video'} from SecureMesh. Select Start Watch Party.`);
    }
    async _load(source) {
        return this._addSources([source instanceof Blob ? { blob: source, title: source.name || 'Local video' } : source]);
    }
    async _addSources(sources, { select = true } = {}) {
        this._assertLibrary();
        console.debug('[VideoPlayerUI] sources added', { items: sources.length, select });
        const index = this._queue.items.length; this._queue.append(sources);
        if (select && sources.length) this._queue.select(index); this._renderQueue();
        if (sources.length && (select || !index)) return this._loadQueue();
    }
    async _loadQueue() {
        if (!this._libraryAllowed() || !this._queue.current) return;
        if (this._queue.current.requiresReselection) { this.player.clear(); this._status(`Select ${this._queue.current.fileName || 'the local video'} in the host playlist to reselect it`); return; }
        const generation = ++this._loadGeneration;
        this._status('Loading video…');
        if (!await this.player.load(this._queue.current) || generation !== this._loadGeneration || this._disposed) return;
        this._renderQueue(); this._status(this.player.source?.title || 'Video ready');
        await this._resumeAudio?.();
        if (generation !== this._loadGeneration || !this._libraryAllowed()) return;
        try { await this.player.play(); } catch { this._view.blocked(); this._status('Press Enable playback to start'); }
    }
    _advanceQueue(direction, ended = false) { if (!this._libraryAllowed()) return; if (direction > 0 ? this._queue.next({ ended }) : this._queue.previous()) { this._renderQueue(); this._loadQueue().catch(error => this._status(error.message)); } }
    _renderQueue() {
        this._queueList.replaceChildren(); this._repeat.value = this._queue.repeatMode;
        const count = this._queue.items.length;
        this._previous.disabled = !count; this._next.disabled = !count; this._shuffle.disabled = count < 2;
        this._repeat.disabled = !count; this._exportJson.disabled = !count; this._exportM3u.disabled = !count; this._clearQueue.disabled = !count;
        this._queue.items.forEach((item, index) => {
            const row = mediaElement('li'), select = mediaElement('button', { className: index === this._queue.index ? 'active' : '' }, item.title || `Video ${index + 1}`);
            select.onclick = () => { if (!this._libraryAllowed()) return; this._queue.select(index); this._renderQueue(); if (item.requiresReselection) this._reselectFile.click(); else this._loadQueue().catch(error => this._status(error.message)); };
            const up = mediaElement('button', { disabled: !index, 'aria-label': 'Move video up' }, '↑'), down = mediaElement('button', { disabled: index === this._queue.items.length - 1, 'aria-label': 'Move video down' }, '↓');
            up.onclick = () => { if (this._libraryAllowed()) { this._queue.reorder(index, index - 1); this._renderQueue(); } }; down.onclick = () => { if (this._libraryAllowed()) { this._queue.reorder(index, index + 1); this._renderQueue(); } };
            const remove = mediaElement('button', { 'aria-label': `Remove ${item.title || 'video'}` }, '×');
            remove.onclick = () => { if (!this._libraryAllowed()) return; const current = index === this._queue.index; this._queue.remove(index); this._renderQueue(); if (current) { if (this._queue.current) this._loadQueue().catch(error => this._status(error.message)); else { ++this._loadGeneration; this.player.clear(); } } };
            row.append(select, up, down, remove); this._queueList.append(row);
        });
    }
    _makeParty() {
        if (!this._partyAvailable || !this._createParty) throw new Error('Watch Party requires HTTPS, Web Crypto, and WebRTC');
        if (this._disposed) throw new Error('The player closed');
        const displayName = this._name.value.trim().replace(/\s+/g, ' ');
        if (!displayName) { this._name.focus(); throw new Error('Enter a display name'); }
        if (this.party || this._ending) throw new Error('Leave the current party first');
        this.party = this._createParty({ displayName, sourceMode: this._mode.value === 'url' ? 'url' : 'restream', inviteTtlMs: 24 * 60 * 60 * 1000 });
        this._off.push(this.party.on('status', event => {
            if (event.status === 'ended' || event.status === 'error') { this.end().then(() => this._status(event.reason || 'Party ended')).catch(error => this._status(error.message)); return; }
            this._status(event.reason || event.status);
            this._updateLibrary();
            this._rotate.hidden = event.role !== 'host'; this._end.textContent = event.role === 'host' ? 'End party' : 'Leave';
            this._mode.disabled = event.role === 'guest'; this._codecMode.disabled = event.role === 'guest';
        }));
        this._off.push(this.party.on('invite', invite => { this._currentInvite = invite; this._showInvite(); }));
        this._off.push(this.party.on('member', event => { this._renderMembers(event.members); if (this.party?.role === 'host') this._sendState(); }));
        this._off.push(this.party.on('error', event => this._status(event.message)));
        this._off.push(this.party.on('stream', event => this._remoteStream(event).catch(error => this._status(error.message))));
        this._off.push(this.party.on('control', event => this._control(event).catch(error => this._status(error.message))));
        this._off.push(this.party.on('packet', event => {
            if (this.party?.role !== 'guest' || event.meta.sourceRevision !== this._remoteRevision) return;
            if (!this._receiver) this._receiver = this._newReceiver();
            try { this._receiver.packet(event); } catch (error) { this._status(error.message); }
        }));
        return this.party;
    }
    async create() {
        if (this._guestOnly) throw new Error('An invitation opens this player in viewer mode');
        if (!this.player.source) throw new Error('Open a video before starting a Watch Party');
        const party = this._makeParty();
        this.openParty(); this._updateLibrary();
        this._status('Creating party…');
        try {
            await party.create(); if (this._disposed || party !== this.party) return;
            const invite = await party.createInvite(); if (this._disposed || party !== this.party) return;
            this._currentInvite = invite; this._showInvite();
            if (this.player.source) await this._attachSource();
            if (this._disposed || party !== this.party) return;
            this._heartbeat = setInterval(() => this._sendState(), 1000);
            this._status('Party ready. Share the invite link or code. It expires in 24 hours.');
        } catch (error) { if (party === this.party) await this.end(); throw error; }
    }
    async join() {
        const code = this._invite.value.trim(); if (!code) throw new Error('Enter an invite code');
        if (this._releaseLease) throw new Error('End the shared source before joining another party');
        this._code = code; const party = this._makeParty(); this._joining = true;
        ++this._loadGeneration; this.player.clear(); this._updateLibrary(); this._partyBox.open = true; this._status('Joining party…');
        try {
            await party.join(code); if (this._disposed || party !== this.party) return;
            this._inviteBox.hidden = false; this._rotate.hidden = true;
            this._shareText.value = code; this._view.setTransportEnabled(false);
            this._updateLibrary();
            this._status('Joined. The host controls playback; your volume stays local.');
        } catch (error) { if (party === this.party) await this.end(); throw error; }
    }
    _showInvite() {
        this._inviteBox.hidden = false; this._shareText.value = this._currentInvite.url;
        this._code = this._currentInvite.code;
        this._updateLibrary();
    }
    async _rotateInvite() { const party = this.party; if (party?.role !== 'host') throw new Error('Only the host can replace invitations'); const invite = await party.rotateInvite(); if (party !== this.party || this._disposed) return; this._currentInvite = invite; this._showInvite(); this._status('Previous invite revoked. Existing participants remain connected.'); }
    _renderMembers(members) {
        this._members.replaceChildren();
        for (const member of members || []) {
            const row = mediaElement('span', { className: 'pr-media-member' }, `${member.displayName}${member.role === 'host' ? ' · host' : ''}`);
            if (this.party?.role === 'host' && member.role !== 'host') {
                const remove = mediaElement('button', { 'aria-label': `Remove ${member.displayName}` }, '×');
                remove.onclick = () => this.party.removeParticipant(member.id).then(() => this._status('Participant removed and previous invite revoked. Share the replacement invite.')).catch(error => this._status(error.message));
                row.append(remove);
            }
            this._members.append(row);
        }
    }
    async _attachSource() {
        if (this._attaching) { this._attachAgain = true; return; }
        if (this.party?.role !== 'host' || !this.player.source) return;
        this._attaching = true; const party = this.party;
        try {
            this._sender?.stop(); this._sender = null;
            if (this._capture) this.player.releaseCapture(this._capture);
            this._capture = null;
            if (this._ownedPlayer) { this._ownedPlayer.clear(); this._updateLibrary(); }
            const source = this.player.source, wasPaused = this.player.paused, mode = this._mode.value, codecMode = this._codecMode.value;
            const current = () => party === this.party && !this._disposed && source === this.player.source && mode === this._mode.value && codecMode === this._codecMode.value;
            if (mode === 'url' && (!source.url || !/^https?:/i.test(source.url))) throw new Error('Same-URL sharing requires a URL every participant can access');
            this._revision++; this._itemId = crypto.randomUUID();
            this._sendState();
            if (mode !== 'url') {
                await this.player.play(); if (!current()) { this._attachAgain = true; return; }
                if (mode === 'custom') {
                    await party.attachStream(null);
                    if (!current()) { this._attachAgain = true; return; }
                    const sender = this._sender = new LiveCodecSender(this.player, party, { sourceRevision: this._revision, mode: codecMode, onError: message => this._status(message), onStats: stats => this._showMetrics(stats) });
                    await sender.start();
                    if (!current()) { sender.stop(); if (this._sender === sender) this._sender = null; this._attachAgain = true; return; }
                } else {
                    const capture = await this.player.captureStream();
                    if (!current()) { this.player.releaseCapture(capture); this._attachAgain = true; return; }
                    this._capture = capture; await party.attachStream(capture);
                    if (!current()) { this.player.releaseCapture(capture); if (this._capture === capture) this._capture = null; this._attachAgain = true; return; }
                    const preview = this._ownedPlayer;
                    if (preview) {
                        await preview.load({ stream: capture, title: source.title });
                        if (!current() || preview !== this._ownedPlayer) return;
                        preview.setMuted(true); preview.play().then(() => this._updateLibrary()).catch(() => {});
                    }
                }
            } else await party.attachStream(null);
            if (!current()) { this._attachAgain = true; return; }
            if (wasPaused && mode !== 'url') this.player.pause();
            this._sendState();
        } finally {
            this._attaching = false;
            if (this._attachAgain) { this._attachAgain = false; if (this.party?.role === 'host' && !this._disposed) this._attachSource().catch(error => this._status(error.message)); }
        }
    }
    _sendState() {
        if (this.party?.role !== 'host' || !this.player.source) return;
        const source = this.player.source, mode = this._mode.value;
        const shared = { kind: source.kind === 'url' ? 'url' : source.kind === 'custom' ? 'custom' : 'file', title: source.title.slice(0, 60) };
        if (mode === 'url' && /^https?:/i.test(source.url || '')) shared.url = source.url;
        this.party.sendHostState({ sourceRevision: this._revision, itemId: this._itemId || 'initial', source: shared, mode,
            position: this.player.position, paused: this.player.paused, rate: this.player.rate, clock: Date.now() }).catch(error => this._status(error.message));
    }
    async _remoteStream({ stream }) {
        if (this.party?.role !== 'guest') return;
        this._incomingStream = stream;
        if (this._remoteMode && this._remoteMode !== 'restream') return;
        const party = this.party, generation = this._controlGeneration;
        this._receiver?.dispose(); this._receiver = null; this._customAudio.hidden = true;
        await this.player.load({ stream, title: 'Watch Party' });
        if (party !== this.party || generation !== this._controlGeneration || this._disposed || this._remoteMode && this._remoteMode !== 'restream') return;
        try { await this.player.play(); } catch { this._view.blocked(); this._status('Press Enable playback to hear the party'); }
    }
    async _control({ state, clockOffset = 0 }) {
        if (this.party?.role !== 'guest') return;
        const generation = ++this._controlGeneration;
        const previousMode = this._remoteMode;
        const changed = this._remoteRevision !== state.sourceRevision;
        this._remoteRevision = state.sourceRevision;
        this._remoteMode = state.mode;
        if (state.mode === 'custom') {
            if (changed) { this.player.clear(); if (this._receiver) this._receiver.reset(); else this._receiver = this._newReceiver(); }
            this._customAudio.hidden = !!this._receiver?.audioEnabled; this._status(`${state.source.title || 'Video'} · experimental authored codec`); return;
        }
        this._receiver?.dispose(); this._receiver = null; this._customAudio.hidden = true; this._metrics.hidden = true;
        if (state.mode !== 'url') {
            if (this._incomingStream && (previousMode !== 'restream' || this.player.video.srcObject !== this._incomingStream)) await this._remoteStream({ stream: this._incomingStream });
            if (generation !== this._controlGeneration || this._disposed) return;
            this._status(`${state.source.title || 'Video'} · host restream`); return;
        }
        if (changed || this.player.source?.url !== state.source.url) await this.player.load({ url: state.source.url, title: state.source.title });
        if (generation !== this._controlGeneration || this._disposed) return;
        const elapsed = state.paused ? 0 : Math.max(0, Math.min(10, (Date.now() + clockOffset - state.clock) / 1000));
        const target = state.position + elapsed * state.rate;
        const drift = target - this.player.position;
        if (Math.abs(drift) > 1.5 || state.paused) await this.player.seek(target);
        if (generation !== this._controlGeneration || this._disposed || this.party?.role !== 'guest') return;
        await this.player.setRate(Math.abs(drift) > .15 && Math.abs(drift) <= 1.5 ? state.rate * (drift > 0 ? 1.06 : .94) : state.rate);
        if (generation !== this._controlGeneration || this._disposed || this.party?.role !== 'guest') return;
        if (state.paused) this.player.pause();
        else try { await this.player.play(); } catch { this._view.blocked(); }
        this._status(`${state.source.title || 'Video'} · synchronized URL`);
    }
    end() {
        if (this._endPromise) return this._endPromise;
        this._ending = true; this._updateLibrary();
        this._endPromise = Promise.resolve().then(() => this._finishParty()).finally(() => { this._ending = false; this._endPromise = null; this._updateLibrary(); });
        return this._endPromise;
    }
    async _finishParty() {
        const party = this.party, wasGuest = this._joining || party?.role === 'guest'; this.party = null; this._joining = false;
        ++this._loadGeneration;
        clearInterval(this._heartbeat); this._controlGeneration++;
        this._sender?.stop(); this._sender = null; this._receiver?.dispose(); this._receiver = null;
        if (this._capture) this.player.releaseCapture(this._capture); this._capture = null;
        for (const off of this._off) off(); this._off = [];
        try { if (party) await party.end(); }
        finally {
            this._inviteBox.hidden = true; this._members.replaceChildren(); this._customAudio.hidden = true;
            this._host.disabled = false; this._join.disabled = false; this._view.setTransportEnabled(!this._guestOnly);
            if (this._guestOnly || wasGuest) this.player.clear();
            if (this._releaseLease) {
                this._offRevoke?.(); this._offRevoke = null; this._releaseLease(); this._releaseLease = null;
                this.player = this._ownedPlayer; this._ownedPlayer = null; this.player.clear();
                if (this._previewAudio) { this.player.setVolume(this._previewAudio.volume); this.player.setMuted(this._previewAudio.muted); this._previewAudio = null; }
                this._view.dispose(); this._view = new PlayerView(this.player, { onError: message => this._status(message), transport: !this._guestOnly });
                this.element.insertBefore(this._view.root, this._queueBox); this._bindPlayer();
                this._onPlayerChange?.(this.player);
            }
            this._remoteRevision = null; this._remoteMode = null; this._incomingStream = null; this._metrics.hidden = true; this._attachAgain = false;
            this._queueBox.hidden = this._guestOnly || !!this._releaseLease; this._mode.disabled = false; this._codecMode.disabled = false;
            this._updateLibrary();
            this._status('Party ended');
        }
    }
    _newReceiver() {
        return new LiveCodecReceiver(this.player, { onKeyframe: () => this.party?.requestKeyframe(this._remoteRevision).catch(error => this._status(error.message)), onError: message => this._status(message), onStats: stats => this._showMetrics(stats) });
    }
    _showMetrics(stats) {
        this._view.update(); this._updateLibrary();
        this._metrics.hidden = false;
        this._metrics.textContent = `Packets ${stats.encodedBytes ?? stats.decodedBytes} B · worker ${Math.round(stats.encodeMs ?? stats.decodeMs)} ms · queue ${stats.queueLength} · accounted buffers ${stats.bufferBytes} B · dropped frames ${stats.droppedFrames} / packets ${stats.droppedPackets} · A/V drift ${stats.avDriftMs === null ? 'unmeasured' : Math.round(stats.avDriftMs) + ' ms'}`;
    }
    async dispose() {
        this._disposed = true; ++this._loadGeneration;
        try { await this.end(); }
        finally {
            for (const off of this._playerOff || []) off(); this._view.dispose();
            this._offRevoke?.(); this._releaseLease?.();
            (this._ownedPlayer || this.player).dispose();
            for (const [url, timer] of this._exports) { clearTimeout(timer); URL.revokeObjectURL(url); } this._exports.clear();
            this.element.remove(); this._style.remove();
            console.debug('[VideoPlayerUI] disposed');
        }
    }
}
