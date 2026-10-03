// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * source-loader.js — load a guest app's source from any supported origin.
 *
 * Supported `source` shapes:
 *   string                         → treated as raw HTML if it looks like HTML, else a URL
 *   { html }                       → raw HTML string
 *   { url, fetch? }                → remote fetch (CORS-aware; optional custom fetch)
 *   { file: File }                 → an imported File (uses .text())
 *   { files: Map|object, entry }   → an in-memory file map (folder/zip), entry = HTML path
 *   { vfsPath, storage }           → read from the OS VFS via a StorageManager
 *
 * Returns:
 *   { html, files: Map<string,string|ArrayBuffer>, baseUrl, sourceType, sourceHash }
 */

import { sha256Hex } from './profile-builder.js';

export async function loadSource(source, ctx = {}) {
    const fetchImpl = ctx.fetch ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);

    let html = null;
    let files = new Map();
    let baseUrl = null;
    let sourceType = 'single-file-html';

    if (typeof source === 'string') {
        if (looksLikeHtml(source)) { html = source; }
        else { html = await fetchText(source, fetchImpl); baseUrl = source; }
    } else if (source && typeof source === 'object') {
        if (typeof source.html === 'string') {
            html = source.html;
            baseUrl = source.baseUrl ?? null;
        } else if (source.file && typeof source.file.text === 'function') {
            html = await source.file.text();
            baseUrl = source.file.name ?? null;
        } else if (source.url) {
            html = await fetchText(source.url, source.fetch ?? fetchImpl);
            baseUrl = source.url;
        } else if (source.files) {
            files = toMap(source.files);
            const entry = source.entry ?? findEntryHtml(files);
            if (!entry) throw new Error('source.files provided but no entry HTML found');
            html = asString(files.get(entry));
            baseUrl = entry;
            sourceType = files.size > 1 ? 'multi-file-web' : 'single-file-html';
        } else if (source.vfsPath && source.storage) {
            const { html: h, files: f, entry } = await loadFromVfs(source.vfsPath, source.storage);
            html = h; files = f; baseUrl = entry;
            sourceType = f.size > 1 ? 'multi-file-web' : 'single-file-html';
        } else {
            throw new Error('Unrecognized compat source shape');
        }
    } else {
        throw new Error('compat source must be a string or object');
    }

    if (html == null) throw new Error('compat source produced no HTML');
    if (!files.size && baseUrl) files.set(baseUrl, html);

    const sourceHash = await sha256Hex(html);
    return { html, files, baseUrl, sourceType, sourceHash };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function looksLikeHtml(s) {
    return /^\s*<(!doctype|html|head|body|div|canvas|script|style)\b/i.test(s);
}

async function fetchText(url, fetchImpl) {
    if (!fetchImpl) throw new Error('no fetch available to load remote source');
    let res;
    try { res = await fetchImpl(url, { mode: 'cors', credentials: 'omit' }); }
    catch (e) {
        // A TypeError ("Failed to fetch") here almost always means the remote
        // server sent no Access-Control-Allow-Origin header — the browser
        // blocks reading the body and there is no client-side bypass.
        let host = url;
        try { host = new URL(url).host; } catch { /* keep raw */ }
        throw new Error(
            `Cannot load "${host}": the site does not allow cross-origin access (no CORS header). ` +
            `Save the page's HTML and import it as a file/folder instead, ` +
            `or host it somewhere that sends Access-Control-Allow-Origin. (${e.message})`
        );
    }
    if (!res.ok) throw new Error(`fetch ${url} → HTTP ${res.status}`);
    return res.text();
}

function toMap(filesObj) {
    if (filesObj instanceof Map) return new Map(filesObj);
    const m = new Map();
    for (const [k, v] of Object.entries(filesObj || {})) m.set(normalize(k), v);
    return m;
}

function findEntryHtml(files) {
    const keys = [...files.keys()];
    return keys.find(k => /(^|\/)index\.html?$/i.test(k))
        ?? keys.find(k => /\.html?$/i.test(k))
        ?? null;
}

async function loadFromVfs(vfsPath, storage) {
    const files = new Map();
    let entry = vfsPath;
    const stat = await storage.stat?.(vfsPath).catch(() => null);
    const isDir = stat?.type === 'dir' || vfsPath.endsWith('/');
    if (isDir) {
        const base = vfsPath.replace(/\/$/, '');
        const entries = await storage.listAll(base);
        for (const e of entries) {
            if (e.type && e.type !== 'file') continue;
            const rel = e.path.slice(base.length + 1);
            const content = await storage.read(e.path);
            if (content != null) files.set(normalize(rel), content);
        }
        entry = findEntryHtml(files);
        if (!entry) throw new Error(`no entry HTML in VFS folder ${vfsPath}`);
    } else {
        const content = await storage.read(vfsPath);
        if (content == null) throw new Error(`VFS file not found: ${vfsPath}`);
        files.set(normalize(vfsPath.split('/').pop()), content);
        entry = normalize(vfsPath.split('/').pop());
    }
    return { html: asString(files.get(entry)), files, entry };
}

function asString(v) {
    if (typeof v === 'string') return v;
    if (v instanceof ArrayBuffer) return new TextDecoder().decode(v);
    if (ArrayBuffer.isView(v)) return new TextDecoder().decode(v);
    return String(v ?? '');
}

function normalize(p) {
    return String(p ?? '').replace(/^\.?\//, '').replace(/\/+/g, '/');
}
