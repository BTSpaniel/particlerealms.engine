// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const MAX_PLAYLIST_ITEMS = 1000;

function locationSource(value, base) {
    if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new Error('Invalid playlist source');
    const source = value.trim();
    if (/^\/(user|system|mounts)(\/|$)/.test(source)) return { path: source };
    if (/^[a-z][a-z\d+.-]*:/i.test(source)) {
        const url = new URL(source);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Playlist URLs must use HTTP or HTTPS');
        return { url: url.href };
    }
    if (base && /^https?:/i.test(base)) return locationSource(new URL(source, base).href);
    if (base && /^\/(user|system|mounts)(\/|$)/.test(base)) {
        const path = new URL(source, `https://vfs.invalid${base}`).pathname;
        return { path };
    }
    if (base && base.startsWith('/')) return locationSource(new URL(source, new URL(base, globalThis.location?.origin || 'https://localhost')).href);
    if (source.startsWith('/')) return { url: new URL(source, globalThis.location?.origin || 'https://localhost').href };
    throw new Error('Relative playlist entries require a source path or URL');
}

/** JSON or extended M3U import. HLS manifests belong to the HLS playback backend. */
export function parsePlaylist(text, { base = null, format = 'auto' } = {}) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > 1024 * 1024) throw new Error('Playlist exceeds 1 MiB');
    const clean = text.replace(/^\uFEFF/, '').trim();
    let raw, repeatMode = 'none';
    if (format === 'json' || (format === 'auto' && /^[\[{]/.test(clean))) {
        const decoded = JSON.parse(clean);
        raw = Array.isArray(decoded) ? decoded : decoded?.items;
        repeatMode = Array.isArray(decoded) ? 'none' : decoded.repeat || 'none';
        if (!Array.isArray(raw)) throw new Error('JSON playlist needs an items array');
    } else {
        if (/^#EXT-X-/m.test(clean)) throw new Error('This is an HLS manifest; open it as a video URL');
        raw = [];
        let title = '';
        for (const line of clean.split(/\r?\n/)) {
            if (line.startsWith('#PRREPEAT:')) repeatMode = line.slice(10).trim();
            else if (line.startsWith('#PRLOCAL:')) { raw.push(JSON.parse(decodeURIComponent(line.slice(9)))); title = ''; }
            else if (line.startsWith('#EXTINF:')) title = line.slice(line.indexOf(',') + 1).trim();
            else if (line.trim() && !line.startsWith('#')) { raw.push({ source: line.trim(), title }); title = ''; }
        }
    }
    if (!raw.length || raw.length > MAX_PLAYLIST_ITEMS) throw new Error('Playlist needs between 1 and 1000 entries');
    if (!['none', 'one', 'all'].includes(repeatMode)) throw new Error('Invalid playlist repeat mode');
    const items = raw.map((item, index) => {
        if (typeof item === 'string') item = { source: item };
        if (!item || typeof item !== 'object') throw new Error('Invalid playlist entry');
        if (item.requiresReselection === true) return { id: `item-${index + 1}`, title: String(item.title || item.fileName || 'Local video').slice(0, 256), fileName: String(item.fileName || '').slice(0, 256), size: Number.isSafeInteger(item.size) && item.size >= 0 ? item.size : null, requiresReselection: true };
        const input = item.source ?? item.url ?? item.path;
        const source = typeof input === 'object' && input ? locationSource(input.url ?? input.path, base) : locationSource(input, base);
        return { id: `item-${index + 1}`, title: String(item.title || `Video ${index + 1}`).slice(0, 256), ...source, ...(item.crossOrigin === 'anonymous' && source.url ? { crossOrigin: 'anonymous' } : {}) };
    });
    Object.defineProperty(items, 'repeatMode', { value: repeatMode });
    return items;
}

export class Playlist {
    constructor(items = []) { this.items = []; this.index = -1; this.repeatMode = 'none'; this._nextId = 0; this.replace(items); }
    replace(items) {
        if (!Array.isArray(items) || items.length > MAX_PLAYLIST_ITEMS) throw new Error('Invalid playlist');
        this.items = items.map((item, index) => ({ ...item, id: item.id || `item-${index + 1}` }));
        this.index = this.items.length ? 0 : -1;
        if (items.repeatMode) this.repeatMode = items.repeatMode;
        return this.current;
    }
    append(items) {
        if (!Array.isArray(items) || this.items.length + items.length > MAX_PLAYLIST_ITEMS) throw new Error('Playlist is full');
        for (const item of items) {
            let id = item.id;
            if (!id) { do { id = `local-${++this._nextId}`; } while (this.items.some(existing => existing.id === id)); }
            this.items.push({ ...item, id });
        }
        if (this.index < 0 && this.items.length) this.index = 0;
        return this.current;
    }
    select(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.items.length) throw new RangeError('Invalid playlist position');
        this.index = index; return this.current;
    }
    next({ ended = false } = {}) { return ended && this.repeatMode === 'one' ? this.current : this.index + 1 < this.items.length ? this.select(this.index + 1) : this.repeatMode === 'all' && this.items.length ? this.select(0) : null; }
    previous() { return this.index > 0 ? this.select(this.index - 1) : this.repeatMode === 'all' && this.items.length ? this.select(this.items.length - 1) : null; }
    reorder(from, to) {
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= this.items.length || to >= this.items.length) throw new RangeError('Invalid reorder position');
        const current = this.current, [item] = this.items.splice(from, 1); this.items.splice(to, 0, item); this.index = this.items.indexOf(current);
    }
    shuffle(random = Math.random) {
        const current = this.current;
        for (let index = this.items.length - 1; index > 0; index--) {
            const value = random(); if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Invalid shuffle randomness');
            const other = Math.floor(value * (index + 1)); [this.items[index], this.items[other]] = [this.items[other], this.items[index]];
        }
        this.index = this.items.indexOf(current);
    }
    _exportItems() { return this.items.map(({ title, url, path, blob, requiresReselection, fileName, size, crossOrigin }) => url || path ? { title, ...(url ? { url, ...(crossOrigin === 'anonymous' ? { crossOrigin } : {}) } : { path }) } : { title, fileName: blob?.name || fileName || title, size: blob?.size ?? size ?? null, requiresReselection: !!blob || !!requiresReselection }); }
    remove(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.items.length) return false;
        this.items.splice(index, 1);
        if (index < this.index) this.index--;
        this.index = Math.min(this.index, this.items.length - 1);
        return true;
    }
    get current() { return this.items[this.index] || null; }
    serialize() {
        return JSON.stringify({ version: 1, repeat: this.repeatMode, items: this._exportItems() }, null, 2);
    }
    serializeM3u() { return `#EXTM3U\n#PRREPEAT:${this.repeatMode}\n` + this._exportItems().map(item => `#EXTINF:-1,${String(item.title || 'Video').replace(/[\r\n]/g, ' ')}\n${item.requiresReselection ? '#PRLOCAL:' + encodeURIComponent(JSON.stringify(item)) : item.url || item.path}\n`).join(''); }
}
