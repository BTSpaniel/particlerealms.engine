// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const PLAYER_CSS = `
.pr-media{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--os-surface,#111827);color:var(--text-primary,#f3f4f6);font:14px system-ui,sans-serif;gap:10px;padding:12px;overflow:auto}
.pr-media button,.pr-media input,.pr-media select{font:inherit;color:inherit;border:1px solid var(--border-light,#374151);border-radius:7px;background:var(--os-surface-2,#1f2937);padding:8px;min-height:38px}
.pr-media button{cursor:pointer}.pr-media button:disabled{opacity:.45;cursor:default}.pr-media button:focus-visible,.pr-media input:focus-visible{outline:2px solid #38bdf8;outline-offset:2px}
.pr-media-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.pr-media-row>input[type=url],.pr-media-row>input[type=text]{flex:1;min-width:150px}.pr-media-heading{margin:0;font-size:17px}.pr-media-status{min-height:20px;font-size:12px;color:var(--text-secondary,#b8c4d4);overflow-wrap:anywhere}
.pr-player-stage{position:relative;flex:1;min-height:160px;display:flex;align-items:center;justify-content:center;background:#05070b;border-radius:10px;overflow:hidden}.pr-player-stage video,.pr-player-stage canvas{display:block;width:100%;height:100%;max-height:65vh;object-fit:contain}.pr-player-stage [hidden]{display:none!important}.pr-player-stage:fullscreen{border-radius:0}.pr-player-stage:fullscreen video,.pr-player-stage:fullscreen canvas{max-height:100vh}
.pr-player-captions{position:absolute;bottom:5%;left:5%;right:5%;text-align:center;white-space:pre-line;pointer-events:none;font-size:clamp(16px,2vw,25px);text-shadow:0 2px 2px #000,0 0 4px #000;font-weight:600}.pr-player-controls{display:flex;align-items:center;flex-wrap:wrap;gap:7px}.pr-player-controls input[type=range]{padding:0;min-height:30px;accent-color:#38bdf8}.pr-player-seek{flex:1;min-width:80px}.pr-player-volume{width:80px}.pr-player-time{font-size:12px;font-variant-numeric:tabular-nums}.pr-media-list{margin:0;padding:0;list-style:none;max-height:140px;overflow:auto;display:flex;flex-direction:column;gap:4px}.pr-media-list li{display:flex;gap:6px}.pr-media-list li>button:first-child{flex:1;text-align:left}.pr-media-list .active{border-color:#38bdf8}.pr-media-invite{width:100%;box-sizing:border-box;font:12px ui-monospace,monospace;overflow-wrap:anywhere}.pr-media-members{display:flex;flex-wrap:wrap;gap:6px}.pr-media-member{display:flex;align-items:center;gap:5px;padding:4px 8px;border:1px solid var(--border-light,#374151);border-radius:8px}.pr-media-member button{padding:3px 7px;min-height:28px}.pr-media-empty{padding:18px;text-align:center;color:#b8c4d4}.pr-media [hidden]{display:none!important}
`;

export function mediaElement(tag, attributes = {}, text = null) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
        if (name === 'className') node.className = value;
        else if (name in node) node[name] = value;
        else node.setAttribute(name, value);
    }
    if (text !== null) node.textContent = text;
    return node;
}

export function mediaTime(seconds) {
    const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    const minutes = Math.floor(value / 60), rest = String(value % 60).padStart(2, '0');
    return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** One set of transport controls for native, HLS and authored-codec playback. */
export class PlayerView {
    constructor(player, { onError = null, transport = true } = {}) {
        this.player = player;
        this.root = mediaElement('div', { className: 'pr-player-controls' });
        this._error = error => onError?.(error instanceof Error ? error.message : String(error));
        this._off = [];
        this.play = mediaElement('button', { title: 'Play or pause', 'aria-label': 'Play' }, 'Play');
        this.seek = mediaElement('input', { className: 'pr-player-seek', type: 'range', min: '0', max: '100', step: '.1', value: '0', 'aria-label': 'Playback position' });
        this.time = mediaElement('span', { className: 'pr-player-time' }, '0:00 / 0:00');
        this.volume = mediaElement('input', { className: 'pr-player-volume', type: 'range', min: '0', max: '1', step: '.01', value: String(player.volume), 'aria-label': 'Local volume' });
        this.mute = mediaElement('button', { 'aria-label': 'Mute local audio' }, 'Mute');
        this.rate = mediaElement('select', { 'aria-label': 'Playback speed' });
        for (const value of [.25, .5, .75, 1, 1.25, 1.5, 2]) this.rate.append(mediaElement('option', { value: String(value), selected: value === 1 }, `${value}×`));
        this.pip = mediaElement('button', { title: 'Picture in picture' }, 'PiP');
        this.fullscreen = mediaElement('button', { title: 'Fullscreen' }, 'Fullscreen');
        this.unlock = mediaElement('button', {}, 'Enable playback'); this.unlock.hidden = true;
        this.root.append(this.play, this.seek, this.time, this.mute, this.volume, this.rate, this.pip, this.fullscreen, this.unlock);
        this.play.onclick = () => { if (this.play.disabled) return; if (player.paused) player.play().catch(this._error); else player.pause(); };
        this.seek.onchange = () => { if (!this.seek.disabled) player.seek(Number(this.seek.value) / 100 * player.duration).catch(this._error); };
        this.volume.oninput = () => { if (this.volume.disabled) return; player.setMuted(false); player.setVolume(Number(this.volume.value)); };
        this.mute.onclick = () => { if (!this.mute.disabled) player.setMuted(!player.muted); };
        this.rate.onchange = () => { if (!this.rate.disabled) player.setRate(Number(this.rate.value)).catch(this._error); };
        this.pip.onclick = () => player.pictureInPicture().catch(this._error);
        this.fullscreen.onclick = () => player.fullscreen().catch(this._error);
        this.unlock.onclick = () => {
            if (this.unlock.disabled || !this._blocked) return;
            const source = player.source;
            player.play().then(() => { if (source === player.source) { this._blocked = false; this.update(); } }).catch(this._error);
        };
        for (const type of ['timeupdate', 'play', 'pause', 'source', 'cleared', 'loadedmetadata', 'loadeddata', 'emptied', 'resize', 'capabilities', 'error', 'ratechange', 'volumechange']) this._off.push(player.on(type, () => this.update()));
        this.setTransportEnabled(transport);
    }
    setTransportEnabled(enabled) { this._transport = !!enabled; this.update(); }
    blocked() { this._blocked = !!this.player.source; this._blockedSource = this.player.source; this.update(); }
    update() {
        const player = this.player, capabilities = player.capabilities;
        if (this._blockedSource !== player.source || !capabilities.hasSource || !player.paused) this._blocked = false;
        this.play.textContent = player.paused ? 'Play' : 'Pause';
        this.play.setAttribute('aria-label', this.play.textContent);
        this.play.disabled = !this._transport || !capabilities.play;
        this.seek.disabled = !this._transport || !capabilities.seek;
        if (!this.seek.matches(':active')) this.seek.value = String(player.duration ? player.position / player.duration * 100 : 0);
        this.time.textContent = `${mediaTime(player.position)} / ${mediaTime(player.duration)}`;
        this.rate.disabled = !this._transport || !capabilities.rate;
        this.rate.value = String(player.rate);
        this.pip.hidden = !capabilities.pip; this.pip.disabled = !capabilities.pip;
        this.fullscreen.hidden = !capabilities.fullscreen; this.fullscreen.disabled = !capabilities.fullscreen;
        this.unlock.hidden = !this._blocked;
        this.unlock.disabled = !capabilities.play;
        this.mute.disabled = !capabilities.ready; this.volume.disabled = !capabilities.ready;
        this.mute.textContent = player.muted ? 'Unmute' : 'Mute';
        if (!this.volume.matches(':active')) this.volume.value = String(player.volume);
    }
    dispose() { for (const off of this._off) off(); this._off = []; this.root.remove(); }
}
