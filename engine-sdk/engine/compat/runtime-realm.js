// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * runtime-realm.js — a controlled, scoped execution root for a guest app.
 *
 * Trusted same-origin guests (Mode A/B) reference elements via `document.*`, so
 * the realm is a SCOPED LIGHT-DOM container (`<div data-engine-app="id">`) rather
 * than a shadow root — `getElementById('c')` must still resolve. Isolation comes
 * from:
 *   • CSS scoping (css-healer) so guest styles can't touch the OS shell,
 *   • API interposition (Phase 5) so guest browser calls route through the engine,
 *   • DOM healing so required elements exist before scripts run.
 *
 * Scripts parsed by DOMParser are inert; the realm re-executes them in document
 * order: classic inline → fresh <script>; module inline → blob import(); src →
 * resolved against the package file map (blob) or left as a URL for the browser.
 */

import { scopeCss, scopeSelectorFor } from './css-healer.js';
import { healDom } from './dom-healer.js';
import { buildModuleBlobs, buildImportResolver } from './module-linker.js';
import { formatMimeFromExtension } from '../core/math/FormatMath.js';

export class RuntimeRealm {
    constructor({ id, mount, profile, files = null, baseUrl = null, onError = null, interpose = null }) {
        this.id        = id;
        this._mount    = mount;
        this._profile  = profile ?? {};
        this._files    = files instanceof Map ? files : new Map();
        this._baseUrl  = baseUrl;
        this._onError  = onError;
        this._interpose = interpose;     // async (realm) => void — installs API shims
        this._scope    = scopeSelectorFor(id);
        this.container = null;
        this._blobUrls = [];
        this._scriptEls = [];
        this._destroyed = false;
        this._model = null;
        this._transform = null;     // (code, { module, index, total }) => transformedCode
        this._cleanups = [];        // teardown hooks registered by interposers
    }

    /** The guest's original base URL (set for live/remote sources; null for local packages). */
    get baseUrl() { return this._baseUrl; }

    /** Register a code transform applied to every guest script before execution. */
    setScriptTransform(fn) { this._transform = typeof fn === 'function' ? fn : null; }

    /** Register a teardown hook run on destroy() (used by interposers). */
    addCleanup(fn) { if (typeof fn === 'function') this._cleanups.push(fn); }

    /** Number of classic (non-module) guest scripts. */
    get _classicCount() { return (this._model?.scripts ?? []).filter(s => !s.module && !s.src).length; }

    /** Build the scoped DOM (styles + healed body), ready for execute(). */
    build(model) {
        this._model = model;

        const container = document.createElement('div');
        container.className = 'engine-app';
        container.setAttribute('data-engine-app', this.id);
        container.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;';

        // Scoped styles: inline <style> AND bundled external stylesheets (so a
        // linked guest sheet can't escape scoping and style the OS shell). CSS
        // url(...) references to bundled assets are rewritten to blob URLs.
        const css = (model.styles ?? [])
            .map((s) => {
                let raw = s.inline ? s.code : this._readBundledText(s.href);
                if (!raw) return '';
                raw = this._rewriteCssUrls(raw);
                return scopeCss(raw, this._scope);
            })
            .filter(Boolean)
            .join('\n');
        if (css) {
            const styleEl = document.createElement('style');
            styleEl.setAttribute('data-engine-app-style', this.id);
            styleEl.textContent = css;
            container.appendChild(styleEl);
        }

        // Clone the guest body (scripts are inert/removed; we run them in execute()).
        if (model.doc?.body) {
            const bodyClone = document.importNode(model.doc.body, true);
            bodyClone.querySelectorAll('script').forEach(s => s.remove());
            while (bodyClone.firstChild) container.appendChild(bodyClone.firstChild);
        }

        // Ensure required elements exist BEFORE scripts run.
        if (this._profile.healing?.repairDom !== false) healDom(container, this._profile);
        this._rewriteExternalAttrs(container);

        // Revoke any blob URLs the asset-healer created for bundled references.
        if (model?._assetBlobs?.length) {
            this.addCleanup(() => {
                for (const u of model._assetBlobs) { try { URL.revokeObjectURL(u); } catch {} }
            });
        }

        this._mount.appendChild(container);
        this.container = container;
        return container;
    }

    /** Install interposers (if any) then execute guest scripts in order. */
    async execute() {
        if (this._destroyed) return;
        if (typeof this._interpose === 'function') {
            try { await this._interpose(this); } catch (e) { this._report('interpose', e); }
        }
        // Link ES modules: rewrite relative imports → bundled blob URLs and bare
        // specifiers (`import 'three'`) → CDN/import-map URLs, applying the
        // interposer transform so external modules get the same shims as inline
        // code. Built unconditionally so single-file inline modules also resolve
        // bare imports (no bundled JS → no blobs created, just rewriting).
        try {
            this._linker = buildModuleBlobs({
                files: this._files,
                transform: (code, meta) => this._maybeTransform(code, meta),
                onWarn: (msg) => this._report('link', new Error(msg)),
                resolveBare: buildImportResolver(this._profile),
                resolveExternal: (spec, importerRel) => this._resolveExternalModule(spec, importerRel),
            });
            this._blobUrls.push(...this._linker.blobUrls);
        } catch (e) { this._report('link', e); this._linker = null; }
        const scripts = this._model?.scripts ?? [];
        for (let i = 0; i < scripts.length; i++) {
            if (this._destroyed) break;
            try { await this._runScript(scripts[i], i, scripts.length); }
            catch (e) { this._report('script', e); }
        }
    }

    /** Apply the interposer transform to inline guest code (not external src). */
    _maybeTransform(code, meta) {
        if (!this._transform || code == null) return code;
        try { return this._transform(code, meta) ?? code; }
        catch (e) { this._report('transform', e); return code; }
    }

    async _runScript(s, index = 0, total = 1) {
        if (s.module) {
            let url;
            let code = null;
            if (s.src) {
                // Prefer the pre-linked blob (imports rewritten + shims applied).
                const rel = this._fileRel(s.src) ?? String(s.src).replace(/^\.?\//, '');
                url = this._linker?.urls?.get(rel) ?? this._resolveSrc(s.src);
            } else {
                // Inline module: rewrite its relative imports to bundled blob URLs,
                // then apply the interposer transform.
                code = s.code;
                if (this._linker) code = this._linker.rewrite(code, this._baseUrl || '');
                code = this._maybeTransform(code, { module: true, index, total });
                code += `\n//# sourceURL=compat-${this.id}-inline-module-${index}.mjs`;
                url = this._blob(code, 'text/javascript');
            }
            try { await import(/* @vite-ignore */ url); }
            catch (e) {
                if (!s.src && this._shouldTraceScripts()) this._traceScriptFailure(e, s, index, total, code);
                this._report('script', e);
            }
            return;
        }
        // Classic script — recreate so it executes (inert clones do not run).
        const el = document.createElement('script');
        if (s.src) {
            el.src = this._resolveSrc(s.src);
            const done = new Promise((res) => { el.onload = res; el.onerror = res; });
            (this.container ?? document.head).appendChild(el);
            this._scriptEls.push(el);
            await done;
        } else {
            const code = this._maybeTransform(s.code, { module: false, index, total });
            el.textContent = this._classicCount > 1
                ? code
                : `try{(0,eval)(${safeJsString(code)});}catch(e){console.warn('[compat] skipped inline script:',e&&e.message?e.message:e);}`;
            (this.container ?? document.head).appendChild(el);
            this._scriptEls.push(el);
        }
    }

    /** Resolve a script/asset src against the package file map, else return as URL. */
    _resolveSrc(src) {
        const rel = this._fileRel(src);
        if (rel != null) return this._blob(this._files.get(rel), mimeFor(rel));
        return this._resolveExternalUrl(src); // absolute or remote — let the browser fetch it
    }

    _shouldTraceScripts() {
        try {
            return this._profile?.debug?.traceScripts === true
                || globalThis.__ENGINE_COMPAT_TRACE_SCRIPTS === true;
        } catch { return false; }
    }

    _traceScriptFailure(err, script, index, total, code) {
        try {
            const text = String(code ?? '');
            const lines = text.split(/\r?\n/);
            const stack = String(err?.stack ?? '');
            const m = stack.match(/:(\d+):(\d+)\)?(?:\n|$)/);
            const lineNo = m ? Number(m[1]) : null;
            const colNo = m ? Number(m[2]) : null;
            const around = [];
            if (lineNo && Number.isFinite(lineNo)) {
                const from = Math.max(1, lineNo - 6);
                const to = Math.min(lines.length, lineNo + 6);
                for (let n = from; n <= to; n++) around.push(`${n}:${n === lineNo ? '>' : ' '} ${lines[n - 1]}`);
            }
            const httpsHits = [];
            for (let i = 0; i < lines.length && httpsHits.length < 12; i++) {
                if (lines[i].includes('https')) httpsHits.push(`${i + 1}: ${lines[i].slice(0, 220)}`);
            }
            console.warn([
                `[compat:trace] module script failed`,
                `appId=${this.id}`,
                `script=${index + 1}/${total} module=${!!script?.module} src=${script?.src ?? ''}`,
                `message=${err?.message ?? String(err)}`,
                `parsed=${lineNo ?? '?'}:${colNo ?? '?'}`,
                `profile.isolation=${this._profile?.isolation ?? ''}`,
                `profile.sourceType=${this._profile?.sourceType ?? ''}`,
                `profile.liveSource=${this._profile?.liveSource ?? ''}`,
                `profile.uses=${JSON.stringify(this._profile?.uses ?? {})}`,
                `profile.gpu=${JSON.stringify(this._profile?.gpu ?? {})}`,
                `--- around parsed line ---`,
                ...(around.length ? around : ['(no parsed line found)']),
                `--- https hits in transformed module ---`,
                ...(httpsHits.length ? httpsHits : ['(none)']),
                `--- stack ---`,
                stack,
            ].join('\n'));
        } catch {}
    }

    /**
     * Resolve a relative reference (href/src) to a bundled file path, trying the
     * literal path then resolution against the entry's directory. Null if remote,
     * absolute, or not bundled.
     */
    _fileRel(ref) {
        if (!ref || /^(https?:|blob:|data:|\/\/)/i.test(ref)) return null;
        const raw = String(ref).replace(/^\.?\//, '');
        if (this._files.has(raw)) return raw;
        const dir = (this._baseUrl || '').replace(/[^/]*$/, '');
        const joined = normalizePath(dir + raw);
        if (this._files.has(joined)) return joined;
        const clean = raw.replace(/[?#].*$/, '');
        if (clean !== raw && this._files.has(clean)) return clean;
        const cleanJoined = normalizePath(dir + clean);
        return cleanJoined !== joined && this._files.has(cleanJoined) ? cleanJoined : null;
    }

    /** Read a bundled text file (e.g. a linked stylesheet) as a string. */
    _readBundledText(ref) {
        const rel = this._fileRel(ref);
        if (rel == null) return null;
        const v = this._files.get(rel);
        if (typeof v === 'string') return v;
        try { return new TextDecoder().decode(v); } catch { return null; }
    }

    /**
     * Public: resolve a relative fetch ref to bundled file content + MIME type,
     * or null. Lets the fetch shim serve `fetch('data.json')` / wasm from the
     * package file map instead of hitting the network (and 404ing).
     */
    bundledFile(ref) {
        const rel = this._fileRel(ref);
        if (rel == null) return null;
        return { rel, content: this._files.get(rel), mime: mimeFor(rel) };
    }

    resolveExternalUrl(ref) {
        return this._resolveExternalUrl(ref);
    }

    /**
     * Public: resolve a Worker(url) reference to a runnable URL — preferring the
     * pre-linked module blob (imports rewritten + shims applied), else a blob of
     * the bundled file. Returns the original url when it isn't a bundled file.
     */
    resolveWorkerUrl(url) {
        const ref = (typeof URL !== 'undefined' && url instanceof URL) ? url.href : String(url ?? '');
        const rel = this._fileRel(ref);
        if (rel == null) return this._resolveExternalUrl(ref);
        if (this._linker?.urls?.has(rel)) return this._linker.urls.get(rel);
        return this._blob(this._files.get(rel), mimeFor(rel));
    }

    /** Rewrite CSS url(...) references to bundled assets into blob URLs. */
    _rewriteCssUrls(css) {
        if (!css) return css;
        return String(css).replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (full, q, ref) => {
            const rel = this._fileRel(ref.trim());
            if (rel == null) {
                const url = this._resolveExternalUrl(ref.trim());
                return url !== ref.trim() ? `url("${escapeCssString(url)}")` : full;
            }
            return `url(${q}${this._blob(this._files.get(rel), mimeFor(rel))}${q})`;
        });
    }

    _rewriteExternalAttrs(rootEl) {
        const els = rootEl.querySelectorAll?.('img[src], source[src], audio[src], video[src], track[src], image[href], use[href], a[href], area[href]');
        if (!els) return;
        for (const el of els) {
            const attr = el.hasAttribute('src') ? 'src' : 'href';
            const raw = el.getAttribute(attr);
            if (!raw || this._fileRel(raw) != null) continue;
            const url = this._resolveExternalUrl(raw);
            if (url !== raw) el.setAttribute(attr, url);
        }
    }

    _resolveExternalUrl(ref) {
        const raw = String(ref ?? '');
        if (!raw || raw[0] === '#' || /^[a-z][\w+.-]*:/i.test(raw)) return raw;
        const base = this._documentBaseUrl();
        if (!base) return raw;
        try { return new URL(raw, base).href; } catch { return raw; }
    }

    _documentBaseUrl() {
        const base = this._profile?.liveSource || this._baseUrl;
        return /^https?:\/\//i.test(String(base ?? '')) ? String(base) : null;
    }

    _resolveExternalModule(spec, importerRel) {
        const base = this._documentBaseUrl();
        if (!base) return null;
        try {
            const importer = importerRel ? new URL(importerRel, base).href : base;
            return new URL(String(spec), importer).href;
        } catch { return null; }
    }

    _blob(content, type) {
        const url = URL.createObjectURL(new Blob([content], { type }));
        this._blobUrls.push(url);
        return url;
    }

    _report(stage, err) {
        const info = { type: stage, message: err?.message ?? String(err), stack: err?.stack ?? null, appId: this.id };
        try { this._onError?.(info); } catch {}
        console.warn(`[compat:${this.id}] ${stage} error:`, err);
    }

    /** Lightweight DOM snapshot for recovery (Phase 7 extends this). */
    snapshot() {
        return {
            appId: this.id,
            time: (typeof performance !== 'undefined' ? performance.now() : Date.now()),
            html: this.container?.innerHTML ?? null,
            profileFormat: this._profile.format ?? null,
        };
    }

    destroy() {
        this._destroyed = true;
        for (const fn of this._cleanups) { try { fn(); } catch {} }
        this._cleanups = [];
        for (const el of this._scriptEls) { try { el.remove(); } catch {} }
        for (const url of this._blobUrls) { try { URL.revokeObjectURL(url); } catch {} }
        this._scriptEls = [];
        this._blobUrls = [];
        try { this.container?.remove(); } catch {}
        this.container = null;
    }
}

function normalizePath(p) {
    const segs = String(p ?? '').replace(/^\.?\//, '').split('/');
    const out = [];
    for (const s of segs) {
        if (s === '' || s === '.') continue;
        if (s === '..') { out.pop(); continue; }
        out.push(s);
    }
    return out.join('/');
}

function safeJsString(code) {
    return JSON.stringify(String(code ?? '')).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function escapeCssString(s) {
    return String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\d ').replace(/\n/g, '\\a ');
}

function mimeFor(rel) {
    return formatMimeFromExtension(rel, 'text/plain');
}
