// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * module-linker.js — turn an in-memory file map into runnable blob-URL modules.
 *
 * Loading an ES module from a `blob:` URL loses its path context, so relative
 * imports (`import './a.js'`) and `import.meta.url`-relative resolution break
 * (the blob has no directory). Following the es-module-shims technique, we
 * rewrite every relative / bundled import specifier in each JS module to the
 * `blob:` URL of its resolved target (created in dependency order), optionally
 * apply a code transform (the interposer prelude / shader healing), and return
 * a `path → blobURL` map plus a resolver for inline-module imports.
 *
 * Bare specifiers (`import 'three'`) may be resolved by the caller-provided
 * import resolver (import map / CDN fallback). Absolute/remote URLs are left
 * untouched.
 */

const JS_RE = /\.(m?js|jsx)$/i;

/**
 * Build blob-URL modules for every bundled JS file, with relative imports
 * rewritten to reference each other's blob URLs.
 *
 * @param {object} opts
 *   files     — Map<string, string|Uint8Array> of bundled files (keys normalised)
 *   transform — optional (code, { module, src, index, total }) => code
 *   onWarn    — optional (msg) => void
 * @returns {{
 *   urls: Map<string,string>,             // relPath → blob URL
 *   blobUrls: string[],                   // all created URLs (for revoke)
 *   resolve: (spec, importerRel) => string|null,  // for inline-module rewriting
 *   rewrite: (code, importerRel) => string,       // rewrite an inline module's imports
 *   revoke: () => void,
 * }}
 */
export function buildModuleBlobs({ files, transform = null, onWarn = null, resolveBare = null, resolveExternal = null, urlKind = 'blob' } = {}) {
    const urls = new Map();         // rel → module URL (blob: or data:)
    const blobUrls = [];            // created blob URLs (for revoke); empty for data:
    const visiting = new Set();     // cycle guard
    const mkUrl = urlKind === 'data' ? makeDataUrl : makeBlob;

    const text = (rel) => {
        const v = files?.get(rel);
        if (typeof v === 'string') return v;
        if (v == null) return null;
        try { return new TextDecoder().decode(v); } catch { return null; }
    };

    // Resolve a specifier to a URL: bundled file → its blob URL; bare specifier
    // → the import resolver (CDN / import map); remote/absolute → left as-is.
    const urlFor = (spec, importerRel) => {
        const dep = resolveSpec(spec, importerRel, files);
        if (dep) {
            const u = urls.get(dep);
            if (!u && onWarn) onWarn(`cyclic import: ${importerRel} → ${spec} (left unresolved)`);
            return u ?? null;
        }
        if (isBareSpecifier(spec)) return resolveBare ? (resolveBare(spec) ?? null) : null;
        if (isRelativeSpecifier(spec)) return resolveExternal ? (resolveExternal(spec, importerRel) ?? null) : null;
        return null;                                     // remote/absolute — valid as-is
    };

    // Recursively build a module (deps first) and return its blob URL.
    const build = (rel) => {
        if (urls.has(rel)) return urls.get(rel);
        if (visiting.has(rel)) return null;     // cycle — URL not ready yet
        if (!files?.has(rel)) return null;
        visiting.add(rel);

        const code = text(rel);
        if (code == null) { visiting.delete(rel); return null; }

        // 1. Build bundled dependencies first so their URLs exist for the rewrite.
        for (const spec of discoverSpecs(code)) {
            const dep = resolveSpec(spec, rel, files);
            if (dep) build(dep);
        }

        // 2. Rewrite this module's specifiers (bundled → blob, bare → CDN/map).
        const linked = rewriteSpecs(code, (spec) => urlFor(spec, rel));

        // 3. Apply the interposer/shader transform (module scope).
        let out = linked;
        if (typeof transform === 'function') {
            try { out = transform(linked, { module: true, src: rel, index: 0, total: 1 }) ?? linked; }
            catch { out = linked; }
        }

        const url = mkUrl(out);
        urls.set(rel, url);
        if (urlKind !== 'data') blobUrls.push(url);
        visiting.delete(rel);
        return url;
    };

    if (files && typeof files.forEach === 'function') {
        for (const rel of files.keys()) if (JS_RE.test(rel)) build(rel);
    }

    const resolve = (spec, importerRel) => urlFor(spec, importerRel);
    const rewrite = (code, importerRel) => rewriteSpecs(code, (spec) => urlFor(spec, importerRel));
    const revoke = () => { for (const u of blobUrls) { try { URL.revokeObjectURL(u); } catch {} } };

    return { urls, blobUrls, resolve, rewrite, revoke };
}

/**
 * Build a resolver for BARE import specifiers (`three`, `@scope/pkg`, subpaths)
 * from a compat profile. Resolution order:
 *   1. exact match in `profile.imports.map`
 *   2. longest trailing-slash prefix match (`three/` → base) in the map
 *   3. CDN fallback `<cdn><spec>` when `profile.healing.cdnImports !== false`
 *      (default CDN https://esm.sh/, overridable via `profile.imports.cdn`)
 * Returns null when nothing matches (the import is left unresolved).
 */
export function buildImportResolver(profile) {
    const map = (profile?.imports?.map && typeof profile.imports.map === 'object') ? profile.imports.map : {};
    const cdnEnabled = profile?.healing?.cdnImports !== false;
    const cdnBase = cdnEnabled ? (validResolvedUrl(profile?.imports?.cdn) ?? 'https://esm.sh/') : null;
    // Prefix keys (ending in '/'), longest first for correct subpath matching.
    const prefixes = Object.keys(map).filter(k => k.endsWith('/')).sort((a, b) => b.length - a.length);

    return (spec) => {
        if (!spec) return null;
        if (Object.prototype.hasOwnProperty.call(map, spec)) return validResolvedUrl(map[spec]);
        for (const k of prefixes) if (spec.startsWith(k)) {
            const base = validResolvedUrl(map[k]);
            return base ? base + spec.slice(k.length) : null;
        }
        return (cdnBase && isPackageSpecifier(spec)) ? cdnBase + spec : null;
    };
}

function validResolvedUrl(value) {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    return v ? v : null;
}

/** A bare specifier: not relative (./ ../ /), not an absolute/remote URL. */
export function isBareSpecifier(spec) {
    if (!spec) return false;
    if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) return false;
    if (/^[a-z][\w+.-]*:/i.test(spec) || spec.startsWith('//')) return false;
    return true;
}

export function isRelativeSpecifier(spec) {
    return !!spec && (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/'));
}

export function isPackageSpecifier(spec) {
    if (!spec || typeof spec !== 'string') return false;
    if (/^[a-z][\w+.-]*:/i.test(spec) || spec.startsWith('//')) return false;
    if (spec.startsWith('.') || spec.startsWith('/')) return false;
    if (spec.startsWith('@')) return /^@[a-z0-9._~-]+\/[a-z0-9._~-]+(?:\/.*)?$/i.test(spec);
    return /^[a-z0-9._~-]+(?:\/.*)?$/i.test(spec) && !spec.includes('..');
}

// ── Specifier discovery + rewriting ───────────────────────────────────────────

// Static `... from 'x'`, side-effect `import 'x'`, and string-literal dynamic
// `import('x')`. The scanner skips strings/comments/templates so ordinary text
// like `'export.foo.from'` or `'import'` is never treated as module syntax.
/** Collect every (string-literal) import specifier from module code. */
export function discoverSpecs(code) {
    return findSpecifiers(String(code)).map(m => m.spec);
}

/**
 * Replace import specifiers using `urlFor(spec)`. When it returns a falsy value
 * the original specifier is kept (bare/remote/cyclic).
 */
export function rewriteSpecs(code, urlFor) {
    const src = String(code);
    const matches = findSpecifiers(src);
    if (!matches.length) return src;
    let out = '';
    let pos = 0;
    for (const m of matches) {
        const url = urlFor(m.spec);
        if (!url) continue;
        out += src.slice(pos, m.start) + escapeSpecifier(url, m.quote);
        pos = m.end;
    }
    return pos ? out + src.slice(pos) : src;
}

function findSpecifiers(code) {
    const out = [];
    for (let i = 0; i < code.length;) {
        const ch = code[i];
        if (ch === '"' || ch === "'") { i = skipString(code, i); continue; }
        if (ch === '`') { i = skipTemplate(code, i); continue; }
        if (ch === '/' && code[i + 1] === '/') { i = skipLineComment(code, i); continue; }
        if (ch === '/' && code[i + 1] === '*') { i = skipBlockComment(code, i); continue; }
        if (ch === '/' && canStartRegex(code, i)) {
            const next = skipRegexLiteral(code, i);
            if (next > i) { i = next; continue; }
        }
        if (isWordAt(code, i, 'import') && prevNonSpace(code, i) !== '.') {
            const m = readImportSpecifier(code, i + 6);
            if (m) out.push(m);
            i += 6;
            continue;
        }
        if (isWordAt(code, i, 'export')) {
            const m = readExportSpecifier(code, i + 6);
            if (m) out.push(m);
            i += 6;
            continue;
        }
        i++;
    }
    return out;
}

function readImportSpecifier(code, i) {
    i = skipSpaceAndComments(code, i);
    if (code[i] === '.') return null;
    if (code[i] === '(') {
        const s = readStringLiteral(code, skipSpaceAndComments(code, i + 1));
        return s;
    }
    const side = readStringLiteral(code, i);
    if (side) return side;
    return readFromSpecifier(code, i);
}

function readExportSpecifier(code, i) {
    i = skipSpaceAndComments(code, i);
    if (code[i] === '*' || code[i] === '{') return readFromSpecifier(code, i);
    if (isWordAt(code, i, 'type')) {
        const next = skipSpaceAndComments(code, i + 4);
        if (code[next] === '*' || code[next] === '{') return readFromSpecifier(code, next);
    }
    return null;
}

function readFromSpecifier(code, i) {
    for (let p = i; p < code.length;) {
        const ch = code[p];
        if (ch === ';') return null;
        if (ch === '"' || ch === "'") { p = skipString(code, p); continue; }
        if (ch === '`') { p = skipTemplate(code, p); continue; }
        if (ch === '/' && code[p + 1] === '/') { p = skipLineComment(code, p); continue; }
        if (ch === '/' && code[p + 1] === '*') { p = skipBlockComment(code, p); continue; }
        if (ch === '/' && canStartRegex(code, p)) {
            const next = skipRegexLiteral(code, p);
            if (next > p) { p = next; continue; }
        }
        if (isWordAt(code, p, 'from')) {
            const s = readStringLiteral(code, skipSpaceAndComments(code, p + 4));
            if (s) return s;
        }
        p++;
    }
    return null;
}

function readStringLiteral(code, i) {
    const q = code[i];
    if (q !== '"' && q !== "'") return null;
    let value = '';
    for (let p = i + 1; p < code.length; p++) {
        const ch = code[p];
        if (ch === '\\') {
            value += ch + (code[p + 1] ?? '');
            p++;
            continue;
        }
        if (ch === q) return { start: i + 1, end: p, quote: q, spec: value };
        value += ch;
    }
    return null;
}

function skipSpaceAndComments(code, i) {
    for (let p = i; p < code.length;) {
        if (/\s/.test(code[p])) { p++; continue; }
        if (code[p] === '/' && code[p + 1] === '/') { p = skipLineComment(code, p); continue; }
        if (code[p] === '/' && code[p + 1] === '*') { p = skipBlockComment(code, p); continue; }
        return p;
    }
    return code.length;
}

function skipString(code, i) {
    const q = code[i];
    for (let p = i + 1; p < code.length; p++) {
        if (code[p] === '\\') { p++; continue; }
        if (code[p] === q) return p + 1;
    }
    return code.length;
}

function skipTemplate(code, i) {
    for (let p = i + 1; p < code.length; p++) {
        if (code[p] === '\\') { p++; continue; }
        if (code[p] === '`') return p + 1;
    }
    return code.length;
}

function skipLineComment(code, i) {
    const n = code.indexOf('\n', i + 2);
    return n < 0 ? code.length : n + 1;
}

function skipBlockComment(code, i) {
    const n = code.indexOf('*/', i + 2);
    return n < 0 ? code.length : n + 2;
}

function skipRegexLiteral(code, i) {
    let inClass = false;
    for (let p = i + 1; p < code.length; p++) {
        const ch = code[p];
        if (ch === '\n' || ch === '\r') return i;
        if (ch === '\\') { p++; continue; }
        if (ch === '[') { inClass = true; continue; }
        if (ch === ']') { inClass = false; continue; }
        if (ch === '/' && !inClass) {
            p++;
            while (/[a-z]/i.test(code[p] || '')) p++;
            return p;
        }
    }
    return i;
}

function canStartRegex(code, i) {
    let p = i - 1;
    while (p >= 0 && /\s/.test(code[p])) p--;
    if (p < 0) return true;
    if ('({[=,:;!?&|+-*~%^<>'.includes(code[p])) return true;
    const w = readPrevWord(code, p);
    return /^(return|throw|case|delete|void|typeof|instanceof|in|of|yield|await|else|do)$/.test(w);
}

function readPrevWord(code, end) {
    let p = end;
    while (p >= 0 && isIdent(code[p])) p--;
    return code.slice(p + 1, end + 1);
}

function prevNonSpace(code, i) {
    let p = i - 1;
    while (p >= 0 && /\s/.test(code[p])) p--;
    return p >= 0 ? code[p] : '';
}

function escapeSpecifier(value, quote) {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(new RegExp(quote === '"' ? '"' : "'", 'g'), `\\${quote}`)
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function isWordAt(code, i, word) {
    return code.slice(i, i + word.length) === word
        && !isIdent(code[i - 1] || '')
        && !isIdent(code[i + word.length] || '');
}

function isIdent(ch) {
    return /[A-Za-z0-9_$]/.test(ch);
}

// ── Path resolution ───────────────────────────────────────────────────────────

/**
 * Resolve an import specifier to a bundled file path, or null when it is bare
 * (no leading ./ ../ or /) or absolute/remote. Tries the literal path, then
 * `.js`/`.mjs`, then `/index.js`.
 */
export function resolveSpec(spec, importerRel, files) {
    if (!spec || !files) return null;
    if (/^[a-z][\w+.-]*:/i.test(spec) || spec.startsWith('//')) return null; // remote/absolute URL
    const isRelative = spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/');
    if (!isRelative) return null;                                            // bare specifier

    const base = spec.startsWith('/') ? '' : dirOf(importerRel || '');
    const joined = normalize(spec.startsWith('/') ? spec.slice(1) : join(base, spec));
    const candidates = [joined];
    if (!/\.[a-z0-9]+$/i.test(joined)) candidates.push(joined + '.js', joined + '.mjs');
    candidates.push(join(joined, 'index.js'), join(joined, 'index.mjs'));
    for (const c of candidates) { const n = normalize(c); if (files.has(n)) return n; }
    return null;
}

function makeBlob(code) {
    return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
}

/**
 * Encode a module as a UTF-8-safe base64 data: URL. Used for the iframe-sandbox
 * tier where parent-origin blob URLs are unreachable from the opaque-origin
 * guest, but data: URLs are (and support cross-module absolute imports).
 */
function makeDataUrl(code) {
    let b64;
    try {
        const bytes = new TextEncoder().encode(String(code));
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        b64 = btoa(bin);
    } catch {
        b64 = btoa(unescape(encodeURIComponent(String(code))));
    }
    return `data:text/javascript;base64,${b64}`;
}

function dirOf(rel) {
    const i = String(rel).lastIndexOf('/');
    return i < 0 ? '' : rel.slice(0, i);
}

function join(base, rel) {
    if (!base) return rel;
    return `${base}/${rel}`;
}

function normalize(p) {
    const segs = String(p ?? '').replace(/^\.?\//, '').split('/');
    const out = [];
    for (const s of segs) {
        if (s === '' || s === '.') continue;
        if (s === '..') { out.pop(); continue; }
        out.push(s);
    }
    return out.join('/');
}
