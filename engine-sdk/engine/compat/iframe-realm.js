// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * iframe-realm.js — a hard-isolation execution root for UNTRUSTED guest apps.
 *
 * Unlike RuntimeRealm (light-DOM, shared OS origin — best-effort isolation), this
 * runs the guest inside a `sandbox="allow-scripts"` iframe WITHOUT
 * `allow-same-origin`, so it gets a unique opaque origin and cannot touch the OS
 * document, cookies, localStorage/IndexedDB, or kernel globals. It is a real
 * security boundary suitable for community/unverified packages and live remote
 * sites.
 *
 * The guest document is assembled self-contained (bundled JS → `data:` modules
 * with imports rewritten; bundled CSS/assets → inline/`data:` URLs) because
 * parent-origin blob URLs are unreachable from the opaque-origin iframe. A tiny
 * injected bridge routes window.open()/anchor navigations up to the host via
 * postMessage (the host opens them in the OS Browser).
 *
 * Trade-offs vs RuntimeRealm: no shared WebGPU device (the iframe requests its
 * own), and no direct syscall access (a postMessage RPC would be needed). Used
 * only when isolation is requested.
 */

import { buildModuleBlobs, buildImportResolver } from './module-linker.js';
import { byteSignature, formatMimeFromExtension } from '../core/math/FormatMath.js';

export class IframeRealm {
    constructor({ id, mount, profile, files = null, baseUrl = null, onError = null, onOpenWindow = null, bridge = null }) {
        this.id        = id;
        this._mount    = mount;
        this._profile  = profile ?? {};
        this._files    = files instanceof Map ? files : new Map();
        this._baseUrl  = baseUrl;
        this._onError  = onError;
        this._onOpenWindow = onOpenWindow;
        // Host capability bridge: { storage:{getAll,set,remove,clear}, net:{fetch} }.
        // Lets the sandboxed (opaque-origin) guest persist scoped storage and make
        // host-mediated network requests via postMessage RPC.
        this._bridge   = bridge;
        this.container = null;
        this.iframe    = null;
        this._onMessage = null;
        this._destroyed = false;
        this._model = null;
        this._cleanups = [];
        this._storageSnapshot = {};
        this._liveUrl   = null;
        this._usingProxy = false;
        this._isLive    = false;
        this._extFrameReady = false;
        this._pendingLiveNav = null;
        // True when this guest is a remote SPA shell loaded live (cross-origin ESM).
        // If such a site ALSO blocks framing, the HTML-injection proxy can't help
        // (its modules are still cross-origin) — we show an "open in new tab" panel.
        this._remoteShell = false;
        // Per-document RPC nonce. Bound to the trusted sandboxed srcdoc guest.
        // Cleared on live/proxy navigation so a remote document loaded into the
        // same contentWindow can no longer call host storage/net RPC methods.
        this._rpcToken  = null;
    }

    /** Generate an unguessable per-document RPC token. */
    _genRpcToken() {
        const cryptoApi = globalThis.crypto;
        if (!cryptoApi?.getRandomValues) return null;
        try {
            const buf = new Uint8Array(16);
            cryptoApi.getRandomValues(buf);
            return byteSignature(buf);
        } catch {
            return null;
        }
    }

    get baseUrl() { return this._baseUrl; }
    addCleanup(fn) { if (typeof fn === 'function') this._cleanups.push(fn); }

    /** Build the sandboxed iframe and write the self-contained guest document. */
    async build(model) {
        this._model = model;
        // Fresh RPC nonce for this trusted sandboxed document.
        this._rpcToken = this._genRpcToken();

        // Hydrate the guest's persisted storage so its localStorage shim can serve
        // synchronous reads from the first line of script (then persist via RPC).
        try { this._storageSnapshot = (await this._bridge?.storage?.getAll?.()) ?? {}; }
        catch (e) { this._report('storage', e); this._storageSnapshot = {}; }

        const container = document.createElement('div');
        container.className = 'engine-app engine-app-isolated';
        container.setAttribute('data-engine-app', this.id);
        container.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;';

        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'border:0;width:100%;height:100%;display:block;background:#000';
        // Opaque origin (NO allow-same-origin) — the real isolation boundary.
        iframe.setAttribute('sandbox', 'allow-scripts allow-pointer-lock allow-modals allow-forms');
        iframe.setAttribute('allow', 'autoplay; fullscreen; xr-spatial-tracking; gamepad');
        iframe.setAttribute('referrerpolicy', 'no-referrer');

        // Decide sandbox vs. live (own-origin) embedding — see _liveLoadTarget for
        // the precedence. A wrapped cross-origin SPA (Vite/webpack) or any app that
        // needs a real origin (cookies / Web Locks / storage) loads LIVE; purely
        // local/bundled guests stay in the opaque-origin sandbox. Live loads render
        // a placeholder first and fall back to the extension proxy / "open in new
        // tab" panel if framing is blocked.
        const liveTarget = this._liveLoadTarget(model);
        if (liveTarget) {
            this._report('live-embed', new Error(`loading on own origin: ${liveTarget}`));
            iframe.srcdoc = this._loadingPlaceholder(liveTarget);
            this._pendingLiveNav = liveTarget;
        } else {
            iframe.srcdoc = this._composeDocument(model);
        }

        // For live-URL navigations: detect X-Frame-Options blocks and retry with proxy.
        // Mirrors BrowserApp._checkIfBlocked: read location.href after a short delay.
        //   • throws SecurityError  → cross-origin page loaded OK (do nothing)
        //   • returns chrome-error:// / about:blank → blocked → retry via proxy
        //   • returns the real URL   → loaded OK
        iframe.addEventListener('load', () => {
            if (!this._isLive || this._usingProxy || !this._liveUrl) return;
            // With the frame-unblocker extension active, content.js posts
            // __os_frame_start__ from every REAL page it renders. Its absence means
            // the frame is a chrome-error/neterror page (X-Frame-Options / CSP /
            // network fail) -> proxy it. BUT a heavy SPA can take seconds to boot and
            // post that signal, so we poll patiently (abort the moment it arrives)
            // instead of a single short timeout that false-positives into a proxy.
            if (this._extActive()) {
                let tries = 0;
                const check = () => {
                    if (this._usingProxy || this._destroyed) return;
                    if (this._extFrameReady) return;   // real page reported in → loaded fine
                    if (++tries >= 5) {
                        if (this._remoteShell) this._showUnembeddable(this._liveUrl);
                        else this._retryWithProxy(this._liveUrl);
                        return;
                    }
                    setTimeout(check, 1200);
                };
                setTimeout(check, 1200);   // ~6s budget for the SPA to boot
                return;
            }
            setTimeout(() => {
                if (this._usingProxy || this._destroyed) return;
                // No extension: reading contentWindow.location throws on a successfully
                // loaded CROSS-ORIGIN page (treat as loaded) and only reads a value for
                // a blocked chrome-error/about:blank frame.
                try {
                    const href = iframe.contentWindow?.location?.href ?? '';
                    const blocked = !href || href === 'about:blank'
                        || href.startsWith('chrome-error://')
                        || href.startsWith('about:neterror');
                    if (blocked) {
                        if (this._remoteShell) this._showUnembeddable(this._liveUrl);
                        else this._retryWithProxy(this._liveUrl);
                    }
                } catch { /* SecurityError = cross-origin page loaded fine */ }
            }, 800);
        });
        iframe.addEventListener('error', () => {
            if (this._isLive && !this._usingProxy && this._liveUrl) {
                if (this._remoteShell) this._showUnembeddable(this._liveUrl);
                else this._retryWithProxy(this._liveUrl);
            }
        });

        // Route hijacked navigations + capability RPC from the guest to the host.
        this._onMessage = (e) => {
            if (e.source !== iframe.contentWindow) return;
            const d = e.data;
            if (!d) return;
            if (d.type === '__os_frame_start__') {
                // content.js ran inside a REAL page our iframe rendered -> not blocked.
                this._extFrameReady = true;
                if (this._isLive && typeof d.href === 'string' && /^https?:/i.test(d.href)) {
                    this._liveUrl = d.href;
                }
                return;
            }
            if (d.__compatNav) {
                try {
                    const url = String(d.__compatNav);
                    const target = d.__navTarget ? String(d.__navTarget) : '';
                    // Always navigate inside the app's own iframe — keeps wrapped sites
                    // self-contained. _blank / _new targets stay in-panel too; the OS
                    // Browser is only opened if the host explicitly requests it via a
                    // separate onOpenWindow call (e.g. a trusted app's syscall).
                    this._navigateIframe(url);
                }
                catch (err) { this._report('navigation', err); }
            } else if (d.__compatRpc != null) {
                // RPC is only honoured for the original trusted sandboxed srcdoc
                // document, authenticated by the per-document nonce. Once the
                // guest navigates to a live/proxied URL the token is cleared, so
                // a remote page sharing this contentWindow cannot reach host RPC.
                if (this._isLive || this._usingProxy || !this._rpcToken || d.__compatToken !== this._rpcToken) {
                    try { this.iframe?.contentWindow?.postMessage({ __compatRpcResult: d.__compatRpc, ok: false, value: null, error: 'rpc disabled for this document' }, '*'); } catch {}
                    return;
                }
                this._handleRpc(d);
            }
        };
        window.addEventListener('message', this._onMessage);

        container.appendChild(iframe);
        this._mount.appendChild(container);
        this.container = container;
        this.iframe = iframe;
        return container;
    }

    /** Resolve once the guest document has loaded (scripts run on load). */
    async execute() {
        if (this._destroyed || !this.iframe) return;
        await new Promise((res) => {
            const done = () => res();
            this.iframe.addEventListener('load', done, { once: true });
            // srcdoc usually fires load quickly; guard against a missed event.
            setTimeout(done, 4000);
        });
        // A source-level meta-refresh is a redirect-to-remote wrapper: perform it as
        // a controlled navigation (which detects X-Frame blocks and proxies via the
        // extension) instead of letting the guest dead-end on a chrome-error frame.
        if (this._pendingLiveNav && !this._destroyed) {
            const u = this._pendingLiveNav;
            this._pendingLiveNav = null;
            this._navigateIframe(u);
        }
    }

    /** True when the frame-unblocker extension is present on this OS page. */
    _extActive() {
        return typeof window !== 'undefined' && window.__frameUnblockerActive === true;
    }

    // ── Capability RPC (host side) ────────────────────────────────────────────

    /** Service one RPC request from the guest, then post the result back. */
    _handleRpc(d) {
        const id = d.__compatRpc;
        const reply = (ok, value, error) => {
            try { this.iframe?.contentWindow?.postMessage({ __compatRpcResult: id, ok, value, error }, '*'); } catch {}
        };
        const fn = this._rpcMethod(d.method);
        if (!fn) { reply(false, null, `unknown method: ${d.method}`); return; }
        Promise.resolve()
            .then(() => fn(...(Array.isArray(d.args) ? d.args : [])))
            .then((v) => reply(true, v ?? null))
            .catch((e) => { this._report('rpc', e); reply(false, null, e?.message ?? String(e)); });
    }

    /** Allowlist of bridge methods the guest may call (nothing else is reachable). */
    _rpcMethod(method) {
        const b = this._bridge;
        if (!b) return null;
        switch (method) {
            case 'storage.getAll': return b.storage?.getAll?.bind(b.storage);
            case 'storage.set':    return b.storage?.set?.bind(b.storage);
            case 'storage.remove': return b.storage?.remove?.bind(b.storage);
            case 'storage.clear':  return b.storage?.clear?.bind(b.storage);
            case 'net.fetch':      return b.net?.fetch?.bind(b.net);
            case 'fx.publish':     return b.fx?.publish?.bind(b.fx);
            case 'theme.get':      return b.theme?.get?.bind(b.theme);
            default:               return null;
        }
    }

    // ── Document assembly ─────────────────────────────────────────────────────

    _composeDocument(model) {
        const linker = buildModuleBlobs({
            files: this._files,
            transform: null,                  // no host shims inside the sandbox
            urlKind: 'data',                  // parent blob: URLs unreachable here
            resolveBare: buildImportResolver(this._profile),
            resolveExternal: (spec, importerRel) => this._resolveExternalModule(spec, importerRel),
            onWarn: (msg) => this._report('link', new Error(msg)),
        });

        // Head: preserve safe original metadata/link/style markup for live pages.
        let headHtml = '';
        if (model.doc?.head) {
            const head = model.doc.head.cloneNode(true);
            head.querySelectorAll('script').forEach((s) => s.remove());
            // Capture + strip a meta-refresh redirect so it doesn't fire blindly
            // inside the sandbox; it's replayed as a controlled live nav in execute().
            const meta = head.querySelector('meta[http-equiv="refresh" i]');
            if (meta) {
                const c = meta.getAttribute('content') || '';
                const mm = /url\s*=\s*['"]?([^'";]+)/i.exec(c);
                if (mm && mm[1]) { this._pendingLiveNav = this._resolveExternalUrl(mm[1].trim()); meta.remove(); }
            }
            this._rewriteAssetAttrs(head);
            headHtml = head.innerHTML;
        }
        const htmlAttrs = safeAttrs(model.doc?.documentElement);
        const bodyAttrs = safeAttrs(model.doc?.body);
        const baseHref = this._documentBaseUrl();
        const baseTag = baseHref ? `<base href="${escapeAttr(baseHref)}">` : '';

        // Head: inline + bundled CSS (no scoping needed — fully isolated), with
        // url(...) refs rewritten to data: URLs.
        const css = (model.styles ?? [])
            .map((s) => {
                const raw = s.inline ? s.code : this._readText(s.href);
                return raw ? this._rewriteCssUrls(raw) : '';
            })
            .filter(Boolean)
            .join('\n');

        // Body: clone, strip scripts, rewrite asset references to data: URLs.
        let bodyHtml = '';
        if (model.doc?.body) {
            const clone = model.doc.body.cloneNode(true);
            clone.querySelectorAll('script').forEach((s) => s.remove());
            this._rewriteAssetAttrs(clone);
            bodyHtml = clone.innerHTML;
        }

        // Scripts in document order.
        const scriptTags = (model.scripts ?? []).map((s) => this._scriptTag(s, linker)).join('\n');

        const title = escapeHtml(model.title || this.id);

        return `<!doctype html><html${htmlAttrs}><head><meta charset="utf-8">`
            + `<meta name="viewport" content="width=device-width,initial-scale=1">`
            + `<title>${title}</title>`
            + baseTag
            + headHtml
            + `<style>html,body{margin:0;height:100%;overflow:auto;min-height:100%}</style>`
            + (css ? `<style>${css}</style>` : '')
            + this._hostThemeStyle()
            // Capability bridge FIRST (defines persisted storage + host fetch),
            // then the navigation bridge, then opaque-origin shims — all before
            // any guest script runs.
            + this._capabilityBridgeScript()
            + this._navBridgeScript()
            + this._originShimScript()
            + `</head><body${bodyAttrs}>${bodyHtml}${scriptTags}</body></html>`;
    }

    /**
     * Injected before guest scripts: a postMessage-RPC client that backs a
     * synchronous localStorage/sessionStorage shim (hydrated from the host's
     * per-app encrypted store, persisted asynchronously) and a host-mediated
     * fetch (so the sandboxed app's connections are routed + permissioned).
     */
    _capabilityBridgeScript() {
        if (!this._bridge) return '';
        // Escape `<` so a stored value containing `</script>` can't break out.
        const snapshot = JSON.stringify(this._storageSnapshot ?? {}).replace(/</g, '\\u003c');
        const net = !!this._bridge.net?.fetch;
        const token = JSON.stringify(this._rpcToken ?? '');
        return `<script>(function(){
            var PENDING={}, SEQ=0; var TOKEN=${token};
            function rpc(method,args){ return new Promise(function(res,rej){
                var id=++SEQ; PENDING[id]={res:res,rej:rej};
                try{ parent.postMessage({__compatRpc:id, __compatToken:TOKEN, method:method, args:args||[]}, '*'); }catch(e){ rej(e); }
            }); }
            window.addEventListener('message', function(e){
                var d=e.data; if(!d || d.__compatRpcResult==null) return;
                var p=PENDING[d.__compatRpcResult]; if(!p) return; delete PENDING[d.__compatRpcResult];
                if(d.ok) p.res(d.value); else p.rej(new Error(d.error||'rpc error'));
            });
            function b64ToBytes(b){ var s=atob(b||''); var a=new Uint8Array(s.length); for(var i=0;i<s.length;i++)a[i]=s.charCodeAt(i); return a; }

            // Persisted (localStorage) + ephemeral (sessionStorage) Web Storage.
            function makeStorage(data, persist){
                var store = data || {};
                var api = {
                    getItem:function(k){ k=String(k); return Object.prototype.hasOwnProperty.call(store,k)?store[k]:null; },
                    setItem:function(k,v){ k=String(k); store[k]=String(v); if(persist) rpc('storage.set',[k,store[k]]).catch(function(){}); },
                    removeItem:function(k){ k=String(k); if(k in store){ delete store[k]; if(persist) rpc('storage.remove',[k]).catch(function(){}); } },
                    clear:function(){ for(var k in store) delete store[k]; if(persist) rpc('storage.clear',[]).catch(function(){}); },
                    key:function(i){ var ks=Object.keys(store); return i<ks.length?ks[i]:null; },
                    get length(){ return Object.keys(store).length; }
                };
                return api;
            }
            try { Object.defineProperty(window,'localStorage',{ value: makeStorage(${snapshot}, true), configurable:true }); }catch(e){}
            try { Object.defineProperty(window,'sessionStorage',{ value: makeStorage({}, false), configurable:true }); }catch(e){}

            // document.cookie THROWS in an opaque-origin sandbox (no allow-same-origin).
            // Third-party scripts (analytics, bot/fraud detection) read it defensively
            // and crash with an uncaught SecurityError. Shim an in-memory cookie jar so
            // they round-trip writes and degrade gracefully instead of throwing.
            try {
                var _ck = {};
                Object.defineProperty(document, 'cookie', {
                    configurable: true,
                    get: function(){ return Object.keys(_ck).map(function(k){ return k+'='+_ck[k]; }).join('; '); },
                    set: function(s){ try { var p=String(s).split(';')[0]; var i=p.indexOf('='); if(i>-1){ _ck[p.slice(0,i).trim()] = p.slice(i+1).trim(); } } catch(e){} }
                });
            } catch(e){}

            ${net ? `try {
                var _nativeFetch = (typeof window.fetch === 'function') ? window.fetch.bind(window) : null;
                function dataUrlToResponse(u){
                    var comma = u.indexOf(','); if (comma < 0) throw new Error('bad data url');
                    var meta = u.slice(5, comma), body = u.slice(comma + 1);
                    var mime = (meta.split(';')[0]) || 'application/octet-stream';
                    var bytes;
                    if (/;base64/i.test(meta)) { bytes = b64ToBytes(body); }
                    else { var s = decodeURIComponent(body); bytes = new Uint8Array(s.length); for (var i=0;i<s.length;i++) bytes[i] = s.charCodeAt(i); }
                    return new Response(bytes, { status:200, statusText:'OK', headers:{'content-type':mime} });
                }
                window.fetch = function(input, init){
                    var url = (typeof input==='string') ? input : (input && input.url) || String(input||'');
                    try { url = new URL(url, document.baseURI || location.href).href; } catch(e) {}
                    // data:/blob: are document-LOCAL. The host net.fetch RPC only speaks
                    // http(s); routing local URLs through it breaks embedded assets
                    // (e.g. GLTF/Draco buffers, inlined fonts) and in-document blob URLs.
                    // Decode data: here; serve blob: from the native fetch (same document).
                    if (/^data:/i.test(url)) { try { return Promise.resolve(dataUrlToResponse(url)); } catch(e){ return Promise.reject(e); } }
                    if (/^blob:/i.test(url) && _nativeFetch) { return _nativeFetch(input, init); }
                    var i = init ? { method:init.method, headers:init.headers, body:(typeof init.body==='string'?init.body:undefined) } : undefined;
                    return rpc('net.fetch',[url, i]).then(function(r){
                        return new Response(b64ToBytes(r.bodyB64), { status:r.status||200, statusText:r.statusText||'', headers:r.headers||{} });
                    });
                };
            } catch(e){}` : ''}

            ${this._bridge.fx?.publish ? `try {
                // FX bridge: a guest drives the desktop ambient "vibe".
                window.os = window.os || {};
                window.os.fx = {
                    publish: function(frame){ try { return rpc('fx.publish',[frame]); } catch(e){ return Promise.resolve(null); } }
                };
            } catch(e){}` : ''}

            ${(this._bridge.theme?.get && this._profile?.adoptHostTheme) ? `try {
                // Adopt host theme tokens: expose --host-* vars + native color-scheme.
                rpc('theme.get',[]).then(function(t){
                    if(!t) return; var r=document.documentElement;
                    var set=function(k,v){ try{ if(v) r.style.setProperty(k,v); }catch(e){} };
                    set('--host-accent', t.accent); set('--host-bg', t.bg); set('--host-fg', t.fg);
                    set('--host-font', t.font); set('--host-radius', t.radius);
                    try { r.style.colorScheme = t.colorScheme || 'dark'; } catch(e){}
                }).catch(function(){});
            } catch(e){}` : ''}
        })();</script>`;
    }

    /**
     * Conservative "blend with the OS" stylesheet, injected only when the guest
     * opts in via profile.adoptHostTheme. It sets a native dark color-scheme and
     * tints selection/scrollbars with the host accent (populated at runtime by the
     * bridge script). It deliberately does NOT restyle the guest's own layout —
     * forcing a full theme onto a third-party site usually breaks it.
     */
    _hostThemeStyle() {
        if (!this._profile?.adoptHostTheme) return '';
        return `<style id="__os_host_theme">`
            + `:root{color-scheme:dark}`
            + `::selection{background:var(--host-accent,#5b7cff);color:#fff}`
            + `::-webkit-scrollbar-thumb{background:var(--host-accent,#5b7cff);border-radius:8px}`
            + `</style>`;
    }

    _scriptTag(s, linker) {
        if (s.module) {
            if (s.src) {
                const rel = this._fileRel(s.src) ?? String(s.src).replace(/^\.?\//, '');
                const url = linker.urls.get(rel) ?? this._resolveExternalUrl(s.src);
                return `<script type="module" src="${escapeAttr(url)}"></script>`;
            }
            const code = linker.rewrite(s.code, this._baseUrl || '');
            const url = `data:text/javascript;base64,${b64FromString(code)}`;
            return `<script type="module">import(${JSON.stringify(url)}).catch(function(e){try{console.warn('[compat] skipped module script:',e&&e.message?e.message:e);}catch(_){}});</script>`;
        }
        if (s.src) {
            const rel = this._fileRel(s.src) ?? String(s.src).replace(/^\.?\//, '');
            const file = this._files.get(rel);
            const url = file != null ? this._dataUrl(rel, file) : this._resolveExternalUrl(s.src);
            return `<script src="${escapeAttr(url)}"></script>`;
        }
        return `<script>try{(0,eval)(${safeJsString(s.code ?? '')});}catch(e){try{console.warn('[compat] skipped inline script:',e&&e.message?e.message:e);}catch(_){}}</script>`;
    }

    /** Injected first: route window.open + anchor + programmatic navigations to the host. */
    _navBridgeScript() {
        const id = JSON.stringify(this.id);
        return `<script>(function(){
            function abs(u){ try{ return new URL(String(u), document.baseURI || location.href).href; }catch(e){ return String(u); } }
            function send(u,t){ try{ parent.postMessage({__compatNav:abs(u),__navTarget:t||'',__id:${id}}, '*'); }catch(e){} }
            try { window.open = function(u,t){ send(u, t||'_blank'); return null; }; } catch(e){}
            // Route programmatic same-frame navigations (location.assign/replace) to
            // the host so live targets that block iframing are proxied via the
            // extension instead of dead-ending on a chrome-error frame. (Direct
            // \`location.href = ...\` assignment is not interceptable in JS; sites that
            // use it are caught by the host's post-load block detection.)
            try {
                var _assign  = window.location.assign.bind(window.location);
                var _replace = window.location.replace.bind(window.location);
                window.location.assign  = function(u){ try{ send(u,''); }catch(e){ _assign(u); } };
                window.location.replace = function(u){ try{ send(u,''); }catch(e){ _replace(u); } };
            } catch(e){}
            document.addEventListener('click', function(e){
                var a = e.target && e.target.closest && e.target.closest('a[href]');
                if(!a) return;
                var raw = a.getAttribute('href') || '';
                if(!raw || raw.charAt(0)==='#') return;
                if(/^\\s*javascript:/i.test(raw)){ e.preventDefault(); e.stopPropagation(); return; }
                e.preventDefault(); e.stopPropagation();
                send(a.href, a.getAttribute('target')||'');
            }, true);
        })();</script>`;
    }

    /**
     * Graceful-degradation shims for guests that STAY sandboxed (opaque origin).
     * An opaque origin makes the browser DENY `document.cookie` and the Web Locks
     * API (`navigator.locks`) with a SecurityError. Apps that can't switch to live
     * embedding would otherwise crash on those throws. We install best-effort,
     * in-page replacements (non-persistent) so reads/writes no-op instead of
     * throwing. Injected before any guest script; harmless on live frames (which
     * never load this srcdoc) and a no-op where the native APIs already work.
     */
    _originShimScript() {
        return `<script>(function(){'use strict';
            try {
                var needLocks = false;
                try { if (!navigator.locks || typeof navigator.locks.request !== 'function') needLocks = true; }
                catch (e) { needLocks = true; }
                if (needLocks) {
                    var _q = Object.create(null);
                    var locks = {
                        request: function(name, opts, cb){
                            if (typeof opts === 'function'){ cb = opts; opts = {}; }
                            opts = opts || {};
                            if (opts.signal && opts.signal.aborted) return Promise.reject(new DOMException('AbortError','AbortError'));
                            var lock = { name: name, mode: opts.mode || 'exclusive' };
                            if (opts.ifAvailable && _q[name]) return Promise.resolve(cb(null));
                            var prev = _q[name] || Promise.resolve();
                            var release; var gate = new Promise(function(res){ release = res; });
                            _q[name] = prev.then(function(){ return gate; });
                            return prev.then(function(){
                                return Promise.resolve().then(function(){ return cb(lock); })
                                    .finally(function(){ release(); });
                            });
                        },
                        query: function(){ return Promise.resolve({ held: [], pending: [] }); }
                    };
                    try { Object.defineProperty(navigator, 'locks', { value: locks, configurable: true }); }
                    catch (e) { try { navigator.locks = locks; } catch (e2) {} }
                }
            } catch (e) {}
            try {
                var throws = false;
                try { void document.cookie; } catch (e) { throws = true; }
                if (throws) {
                    var jar = '';
                    Object.defineProperty(document, 'cookie', {
                        configurable: true,
                        get: function(){ return jar; },
                        set: function(v){
                            try {
                                var pair = String(v).split(';')[0];
                                if (!pair || pair.indexOf('=') < 0) return;
                                var k = pair.split('=')[0];
                                jar = jar.split('; ').filter(Boolean)
                                    .filter(function(c){ return c.split('=')[0] !== k; })
                                    .concat(pair).join('; ');
                            } catch (e) {}
                        }
                    });
                }
            } catch (e) {}
        })();</script>`;
    }

    /**
     * Navigate this app's own iframe to a new URL (same-frame navigation).
     * Drops the sandboxed srcdoc and loads the live URL so the user stays
     * inside the same panel rather than popping the OS Browser.
     *
     * Live http(s) URLs stay sandboxed (allow-scripts). A CROSS-ORIGIN live page
     * additionally gets allow-same-origin so it functions as a real site (its
     * ESM/CSS/cookies/storage work on ITS OWN origin) — it still cannot reach the
     * OS document/storage because that origin differs from the OS. OS-origin and
     * proxied content never receive allow-same-origin (see _setSandbox).
     */
    _navigateIframe(url) {
        if (!this.iframe || this._destroyed) return;
        try {
            const isLive = /^https?:/i.test(url);
            if (isLive) {
                this._liveUrl    = url;
                this._usingProxy = false;
            }
            // Leaving the trusted sandboxed document — revoke host RPC access.
            this._rpcToken = null;
            // New navigation: clear the frame-ready flag so block detection is fresh.
            this._extFrameReady = false;
            // A live CROSS-ORIGIN page gets allow-same-origin so it functions like a
            // real site (its ESM/CSS/cookies work). This is safe: the page receives
            // its OWN origin, which is different from the OS, so it still cannot reach
            // the OS document, storage, or kernel globals. Same-origin-as-OS targets
            // are NEVER granted it (that would let them strip their own sandbox).
            const crossOrigin = isLive && this._isCrossOriginToOS(url);
            this._setSandbox(crossOrigin);
            // Isolated embed mode: a credentialless frame embeds cross-origin
            // sites even under OS cross-origin-isolation (COEP), cookielessly.
            // Opt-in; only meaningful for live cross-origin loads.
            this._setCredentialless(crossOrigin && this._credentiallessRequested());
            this.iframe.removeAttribute('srcdoc');
            this.iframe.src = url;
            this._isLive = true;
        } catch (e) { this._report('navigate', e); }
    }

    /** Is `url` cross-origin to the OS document? (false on parse failure — fail safe.) */
    _isCrossOriginToOS(url) {
        try { return new URL(url, location.href).origin !== location.origin; }
        catch { return false; }
    }

    /**
     * Credentialless ("isolated") embedding mode. A `<iframe credentialless>`
     * loads in an ephemeral, cookieless context, which lets the OS embed
     * cross-origin sites EVEN when the OS page is cross-origin isolated
     * (COEP: require-corp — needed for SharedArrayBuffer / hi-res timers), at the
     * cost of no shared login/cookies inside the frame.
     *
     * Opt-in (default OFF to preserve logged-in sessions): set
     * `globalThis.__OS_EMBED_CREDENTIALLESS__ = true` (OS settings) or a per-app
     * `profile.credentialless`. No-op where the attribute is unsupported.
     */
    _credentiallessRequested() {
        if (this._profile?.credentialless != null) return !!this._profile.credentialless;
        return !!globalThis.__OS_EMBED_CREDENTIALLESS__;
    }

    _setCredentialless(on) {
        if (!this.iframe) return;
        try { if (!('credentialless' in HTMLIFrameElement.prototype)) return; }
        catch { return; }
        try {
            this.iframe.credentialless = !!on;
            if (!on) this.iframe.removeAttribute('credentialless');
        } catch {
            try {
                if (on) this.iframe.setAttribute('credentialless', '');
                else this.iframe.removeAttribute('credentialless');
            } catch { /* unsupported */ }
        }
    }

    /**
     * Set the iframe sandbox. `allow-same-origin` is added ONLY for live
     * cross-origin documents (so third-party sites work); it is always withheld
     * from the trusted srcdoc wrapper and from any OS-origin proxy/srcdoc content
     * (where allow-scripts + allow-same-origin would defeat the sandbox).
     */
    _setSandbox(allowSameOrigin) {
        if (!this.iframe) return;
        const base = 'allow-scripts allow-pointer-lock allow-modals allow-forms';
        this.iframe.setAttribute('sandbox', allowSameOrigin ? `${base} allow-same-origin` : base);
    }

    /** The live site URL backing this guest, if it was sourced from a remote URL. */
    _liveShellUrl() {
        const ls = this._profile?.liveSource;
        if (typeof ls === 'string' && /^https?:/i.test(ls)) return ls;
        if (typeof this._baseUrl === 'string' && /^https?:/i.test(this._baseUrl)) return this._baseUrl;
        return null;
    }

    /**
     * Decide whether to load this guest LIVE on its own origin (so cookies, the
     * Web Locks API, storage and same-origin requests all work) instead of
     * composing it into the opaque-origin sandbox. Returns the URL to load live,
     * or null to stay sandboxed.
     *
     * Precedence (the "fallback order"):
     *   0. Explicit opt-out — profile.preferLive === false → always sandbox.
     *   1. Explicit opt-in  — profile.preferLive === true OR global
     *      __OS_EMBED_PREFER_LIVE__ → load the cross-origin live base.
     *   2. Remote-shell heuristic — cross-origin EXTERNAL ESM entry that cannot
     *      run sandboxed at all (sets _remoteShell so a framing block goes
     *      straight to the unembeddable panel, since the HTML proxy can't help).
     *   3. Auto-detect — a cross-origin liveSource whose page entry is an ES
     *      module needs a real origin even if its assets are ALSO bundled
     *      locally (e.g. player3.gg). Proxy fallback still applies if blocked.
     *
     * Runtime fallback after this (in build()'s load handler) is unchanged:
     *   live → framing blocked → extension proxy → proxy fails → "open in new tab".
     */
    _liveLoadTarget(model) {
        // (0) explicit opt-out wins — force the sandboxed srcdoc path.
        if (this._profile?.preferLive === false) return null;

        const live = this._documentBaseUrl();
        const liveCross = !!live && this._isCrossOriginToOS(live);

        // (1) explicit opt-in (per-app flag or global OS setting).
        if (liveCross && (this._profile?.preferLive === true || globalThis.__OS_EMBED_PREFER_LIVE__)) {
            return live;
        }
        // (2) remote-shell heuristic — can't run sandboxed; proxy can't help either.
        const shell = this._remoteShellTarget(model);
        if (shell) { this._remoteShell = true; return shell; }
        // (3) auto-detect: cross-origin module app that needs its own origin.
        if (liveCross && this._entryIsModule(model)) return live;
        return null;
    }

    /**
     * True if any of the page's scripts that resolve to the live origin is an ES
     * module — even when also bundled locally. Such an app is origin-bound
     * (cookies / Web Locks / storage) and must run live, not in an opaque sandbox.
     */
    _entryIsModule(model) {
        const live = this._documentBaseUrl();
        if (!live) return false;
        let liveOrigin; try { liveOrigin = new URL(live).origin; } catch { return false; }
        for (const s of (model?.scripts ?? [])) {
            if (!s.module || !s.src) continue;
            let abs; try { abs = new URL(s.src, live); } catch { continue; }
            if (abs.origin === liveOrigin) return true;
        }
        return false;
    }

    /**
     * Returns the live URL to load when this packaged guest is really a remote
     * SPA shell — i.e. it was sourced from a live URL AND its entry pulls in a
     * cross-origin ES MODULE script (which a null-origin sandbox cannot execute).
     * Bundled apps (local entry) and CDN-with-CORS classic scripts are unaffected.
     */
    _remoteShellTarget(model) {
        // The authoritative remote base for this guest (profile.liveSource || baseUrl,
        // only if absolute http(s)). It's null for purely-local/bundled packages —
        // which are never remote shells. It's also the SAME base the srcdoc <base>
        // uses, so root-relative asset URLs (e.g. "/assets/index-*.js") resolve here
        // exactly as the browser resolves them inside the frame.
        const live = this._documentBaseUrl();
        if (!live) return null;
        let liveOrigin; try { liveOrigin = new URL(live).origin; } catch { return null; }
        let osOrigin = ''; try { osOrigin = location.origin; } catch {}
        if (liveOrigin === osOrigin) return null;   // OS-hosted, not a third-party site

        // Look for an external (non-bundled) ES MODULE script that resolves to the
        // remote site — it CANNOT execute in the opaque-origin sandbox (modules need
        // CORS; a null-origin initiator makes even the site's own server cross-origin).
        // A genuinely-bundled app instead ships its OWN local module entry → keep it
        // sandboxed even if it also pulls a lib from a CDN.
        let found = false;
        let hasBundledModule = false;
        for (const s of (model?.scripts ?? [])) {
            if (!s.src || !s.module) continue;
            if (this._fileRel(s.src) != null) { hasBundledModule = true; continue; }
            let abs; try { abs = new URL(s.src, live); } catch { continue; }
            if (abs.origin === liveOrigin) found = true;
        }
        if (!found || hasBundledModule) return null;
        return live;   // load the real page (its own origin → ESM/CSS/cookies work)
    }

    /** Minimal "loading…" srcdoc shown while the live site is fetched. */
    _loadingPlaceholder(url) {
        let host = url; try { host = new URL(url).host; } catch {}
        return `<!doctype html><meta charset="utf-8">`
            + `<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;`
            + `font:14px/1.5 system-ui,sans-serif;background:#0b0e14;color:#8b94a7">`
            + `Loading ${escapeHtml(host)}…</body>`;
    }

    /**
     * Fall back when a site blocks iframe embedding (X-Frame-Options / CSP).
     *
     * The frame-unblocker EXTENSION is the proxy: its privileged service worker
     * fetches the page (CORS-free, no Sec-Fetch:iframe) and returns the stripped
     * HTML, which we inject as srcdoc. When the extension is present we use ONLY
     * it — no same-origin server proxy. On failure we surface a clear in-frame
     * message rather than dead-ending on a chrome-error frame.
     *
     * Only when the extension is ABSENT do we fall back to a same-origin server
     * proxy at /api/proxy (production hosts that run one).
     */
    _retryWithProxy(url) {
        if (this._usingProxy || !this.iframe || this._destroyed) return;
        this._usingProxy = true;
        // Proxied/live document is not the trusted guest — revoke host RPC access.
        this._rpcToken = null;
        // Proxy content is served from the OS origin (extension srcdoc or /api/proxy),
        // so it must NEVER get allow-same-origin — that would let it strip the sandbox
        // and reach the OS document. Drop it back to the opaque-origin policy.
        this._setSandbox(false);

        if (this._extActive()) {
            _extProxyFetchHtml(url).then((html) => {
                if (!this.iframe || this._destroyed) return;
                if (html) {
                    this.iframe.removeAttribute('src');
                    this.iframe.srcdoc = html;
                } else {
                    this._report('proxy', new Error(`Extension proxy returned no HTML for ${url}`));
                    this._showProxyError(url);
                }
            }).catch((e) => {
                if (!this.iframe || this._destroyed) return;
                this._report('proxy', e);
                this._showProxyError(url);
            });
            return;
        }

        try {
            this.iframe.removeAttribute('srcdoc');
            this.iframe.src = `${_proxyBase()}/api/proxy?url=${encodeURIComponent(url)}`;
        } catch (e) { this._report('proxy', e); }
    }

    /**
     * Terminal fallback for a remote SPA shell that BOTH blocks framing AND loads
     * as cross-origin ESM — neither the sandbox, a live frame, nor the HTML-injection
     * proxy can run it. Render a host-document panel (NOT inside the sandboxed frame)
     * with a real-tab launcher: a top-level tab has no framing restriction, so the
     * site loads normally there.
     */
    _showUnembeddable(url) {
        if (!this.container || this._destroyed || this._usingProxy) return;
        this._usingProxy = true;   // terminal state — stop further block-detection loops
        let host = url; try { host = new URL(url).host; } catch {}
        try { this.iframe?.remove(); } catch {}
        this.iframe = null;
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;'
            + 'align-items:center;justify-content:center;gap:14px;padding:28px;text-align:center;'
            + 'font:14px/1.6 system-ui,sans-serif;background:#0b0e14;color:#cdd6e4;';
        const msg = document.createElement('div');
        msg.style.cssText = 'max-width:34rem;color:#9aa4ba;';
        msg.textContent = `${host} blocks embedding (X-Frame-Options) and loads as a cross-origin app, `
            + `so it can't run inside the OS sandbox.`;
        const btn = document.createElement('button');
        btn.textContent = `Open ${host} in a new tab`;
        btn.style.cssText = 'padding:9px 18px;border-radius:9px;border:1px solid #2a3350;'
            + 'background:#5b7cff;color:#fff;cursor:pointer;font:inherit;font-weight:600;';
        btn.addEventListener('click', () => {
            try { window.open(url, '_blank', 'noopener,noreferrer'); }
            catch { try { this._onOpenWindow?.(url, { via: 'unembeddable' }); } catch {} }
        });
        wrap.append(msg, btn);
        this.container.appendChild(wrap);
    }

    /** Render a clean in-frame message when the extension proxy can't load a URL. */
    _showProxyError(url) {
        if (!this.iframe || this._destroyed) return;
        let host = url;
        try { host = new URL(url).host; } catch {}
        const msg = `Couldn't load ${escapeHtml(host)} — the site blocks embedding and the `
            + `extension proxy could not fetch it.`;
        try {
            this.iframe.removeAttribute('src');
            this.iframe.srcdoc = `<!doctype html><meta charset="utf-8">`
                + `<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;`
                + `font:14px/1.5 system-ui,sans-serif;background:#0b0e14;color:#cdd6e4;text-align:center;padding:24px">`
                + `<div>${msg}</div></body>`;
        } catch (e) { this._report('proxy', e); }
    }

    // ── Bundled-file helpers ──────────────────────────────────────────────────

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

    _readText(ref) {
        const rel = this._fileRel(ref);
        if (rel == null) return null;
        const v = this._files.get(rel);
        if (typeof v === 'string') return v;
        try { return new TextDecoder().decode(v); } catch { return null; }
    }

    _dataUrl(rel, content) {
        const mime = mimeFor(rel);
        if (typeof content === 'string') {
            return `data:${mime};base64,${b64FromString(content)}`;
        }
        return `data:${mime};base64,${b64FromBytes(content)}`;
    }

    _rewriteAssetAttrs(rootEl) {
        const els = rootEl.querySelectorAll('img[src], source[src], audio[src], video[src], track[src], image[href], use[href]');
        for (const el of els) {
            const attr = el.hasAttribute('src') ? 'src' : 'href';
            const raw = el.getAttribute(attr);
            const rel = this._fileRel(raw);
            if (rel != null) el.setAttribute(attr, this._dataUrl(rel, this._files.get(rel)));
            else {
                const url = this._resolveExternalUrl(raw);
                if (url !== raw) el.setAttribute(attr, url);
            }
        }
    }

    _rewriteCssUrls(css) {
        if (!css) return css;
        return String(css).replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (full, q, ref) => {
            const rel = this._fileRel(ref.trim());
            if (rel == null) {
                const url = this._resolveExternalUrl(ref.trim());
                return url !== ref.trim() ? `url("${escapeCssString(url)}")` : full;
            }
            return `url(${q}${this._dataUrl(rel, this._files.get(rel))}${q})`;
        });
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

    _report(stage, err) {
        const info = { type: stage, message: err?.message ?? String(err), appId: this.id };
        try { this._onError?.(info); } catch {}
    }

    snapshot() {
        return { appId: this.id, isolated: true, time: (typeof performance !== 'undefined' ? performance.now() : Date.now()) };
    }

    destroy() {
        this._destroyed = true;
        for (const fn of this._cleanups) { try { fn(); } catch {} }
        this._cleanups = [];
        if (this._onMessage) { try { window.removeEventListener('message', this._onMessage); } catch {} }
        this._onMessage = null;
        try { this.iframe?.remove(); } catch {}
        try { this.container?.remove(); } catch {}
        this.iframe = null;
        this.container = null;
    }
}

// ── helpers ─────────────────────────────────────────────────────────────────

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

function b64FromString(str) {
    try {
        const bytes = new TextEncoder().encode(String(str));
        return b64FromBytes(bytes);
    } catch { return btoa(unescape(encodeURIComponent(String(str)))); }
}

function b64FromBytes(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < arr.length; i += chunk) {
        bin += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
    }
    return btoa(bin);
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function escapeAttr(s) {
    return String(s ?? '').replace(/"/g, '&quot;');
}

function safeAttrs(el) {
    if (!el?.attributes) return '';
    const out = [];
    for (const a of el.attributes) {
        const n = String(a.name || '').toLowerCase();
        if (!/^(id|class|lang|dir|style|data-[\w:-]+|aria-[\w:-]+)$/.test(n)) continue;
        out.push(` ${n}="${escapeAttr(a.value)}"`);
    }
    return out.join('');
}

/** Prevent inline script content from closing the <script> element early. */
function safeInline(code) {
    return String(code ?? '').replace(/<\/(script)/gi, '<\\/$1');
}

function safeJsString(code) {
    return JSON.stringify(String(code ?? '')).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function escapeCssString(s) {
    return String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\d ').replace(/\n/g, '\\a ');
}

/**
 * Fetch a URL's HTML via the browser extension proxy bridge (__os_proxy_request__).
 * Returns the HTML string on success, or null on timeout / failure.
 */
let _proxyRequestSequence = 0;

function _makeProxyRequestId() {
    const cryptoApi = globalThis.crypto;
    try {
        if (typeof cryptoApi?.randomUUID === 'function') {
            return '_iframe_proxy_' + cryptoApi.randomUUID();
        }
        if (typeof cryptoApi?.getRandomValues === 'function') {
            const buf = new Uint8Array(16);
            cryptoApi.getRandomValues(buf);
            return '_iframe_proxy_' + byteSignature(buf);
        }
    } catch {}
    return '_iframe_proxy_' + Date.now() + '_' + (++_proxyRequestSequence);
}

function _extProxyFetchHtml(url, timeoutMs = 12000) {
    return new Promise((resolve) => {
        if (typeof window === 'undefined') return resolve(null);
        const reqId = _makeProxyRequestId();
        let settled = false;
        const onMsg = (e) => {
            if (e.source !== window || e.data?.type !== '__os_proxy_response__' || e.data.reqId !== reqId) return;
            settled = true;
            window.removeEventListener('message', onMsg);
            resolve(e.data.ok && e.data.html ? e.data.html : null);
        };
        window.addEventListener('message', onMsg);
        try { window.postMessage({ type: '__os_proxy_request__', url, reqId }, '*'); }
        catch { window.removeEventListener('message', onMsg); return resolve(null); }
        setTimeout(() => {
            if (!settled) { window.removeEventListener('message', onMsg); resolve(null); }
        }, timeoutMs);
    });
}

function _proxyBase() {
    try {
        const p = window.location.port;
        if (p === '8080' || p === '5500' || p === '3000' || p === '') return 'http://localhost:9001';
        return window.location.origin;
    } catch { return 'http://localhost:9001'; }
}

function mimeFor(rel) {
    return formatMimeFromExtension(rel, 'application/octet-stream');
}
