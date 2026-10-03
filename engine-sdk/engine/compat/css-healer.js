// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * css-healer.js — scope a guest app's CSS so it cannot style the OS shell.
 *
 * External WebGPU apps routinely style `html, body, canvas, *, :root` globally.
 * `scopeCss(css, scope)` rewrites every style rule so it only applies inside the
 * guest's realm container (e.g. `[data-engine-app="tempolux"]`):
 *
 *   html, body            →  [data-engine-app="id"]
 *   canvas                →  [data-engine-app="id"] canvas
 *   *                     →  [data-engine-app="id"] *
 *   .hud .row             →  [data-engine-app="id"] .hud .row
 *
 * At-rules are handled correctly: @media/@supports/@container/@layer/@scope have
 * their inner rules scoped; @keyframes/@font-face/@page/@property/@import are left
 * intact (their "selectors" are not element selectors).
 */

/** Scope a full stylesheet string to `scope` (a selector like `[data-engine-app="id"]`). */
export function scopeCss(css, scope) {
    if (!css || !scope) return css ?? '';
    return scopeBlock(String(css), scope);
}

/** Convenience: the canonical realm scope selector for an app id. */
export function scopeSelectorFor(appId) {
    return `[data-engine-app="${cssEscape(appId)}"]`;
}

// ── Internals ───────────────────────────────────────────────────────────────

const NESTED_AT = /^@(media|supports|container|layer|scope)\b/i;

function scopeBlock(css, scope) {
    let out = '';
    let i = 0;
    const n = css.length;

    while (i < n) {
        // Preserve comments verbatim.
        if (css[i] === '/' && css[i + 1] === '*') {
            const end = css.indexOf('*/', i + 2);
            const stop = end === -1 ? n : end + 2;
            out += css.slice(i, stop);
            i = stop;
            continue;
        }

        // Read the prelude up to the next '{' or '}'.
        let j = i;
        while (j < n && css[j] !== '{' && css[j] !== '}') {
            if (css[j] === '/' && css[j + 1] === '*') {
                const e = css.indexOf('*/', j + 2);
                j = e === -1 ? n : e + 2;
                continue;
            }
            if (css[j] === '"' || css[j] === "'") { j = skipString(css, j); continue; }
            j++;
        }

        if (j >= n) { out += css.slice(i); break; }

        if (css[j] === '}') {  // stray text / end of an outer block
            out += css.slice(i, j + 1);
            i = j + 1;
            continue;
        }

        // Found a block opening at j. Find its matching close.
        const prelude = css.slice(i, j);
        const blockStart = j + 1;
        let depth = 1;
        let k = blockStart;
        while (k < n && depth > 0) {
            if (css[k] === '/' && css[k + 1] === '*') {
                const e = css.indexOf('*/', k + 2);
                k = e === -1 ? n : e + 2;
                continue;
            }
            if (css[k] === '"' || css[k] === "'") { k = skipString(css, k); continue; }
            if (css[k] === '{') depth++;
            else if (css[k] === '}') depth--;
            k++;
        }
        const body = css.slice(blockStart, k - 1);
        const trimmed = prelude.trim();

        if (trimmed.startsWith('@')) {
            if (NESTED_AT.test(trimmed)) {
                out += prelude + '{' + scopeBlock(body, scope) + '}';
            } else {
                out += prelude + '{' + body + '}';  // @keyframes/@font-face/etc — leave as-is
            }
        } else {
            out += scopeSelectorList(prelude, scope) + '{' + body + '}';
        }
        i = k;
    }
    return out;
}

function scopeSelectorList(prelude, scope) {
    const lead = prelude.match(/^\s*/)[0];
    const selectors = splitTopLevel(prelude.trim(), ',');
    const scoped = selectors.map(sel => scopeSelector(sel.trim(), scope)).filter(Boolean);
    return lead + scoped.join(', ');
}

function scopeSelector(sel, scope) {
    if (!sel) return scope;
    // Leave already-scoped selectors alone (idempotent).
    if (sel.startsWith(scope)) return sel;
    // Replace a leading root-ish token with the scope itself.
    const m = sel.match(/^(:root|html|body)\b\s*/i);
    if (m) {
        const rest = sel.slice(m[0].length).trim();
        return rest ? `${scope} ${rest}` : scope;
    }
    if (sel === '*') return `${scope} *`;
    return `${scope} ${sel}`;
}

/** Split on `sep` only at top nesting level (ignores (), [], and strings). */
function splitTopLevel(str, sep) {
    const parts = [];
    let depth = 0;
    let last = 0;
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === '"' || c === "'") { i = skipString(str, i) - 1; continue; }
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
        else if (c === sep && depth === 0) { parts.push(str.slice(last, i)); last = i + 1; }
    }
    parts.push(str.slice(last));
    return parts;
}

/** Return the index just past the closing quote of the string starting at `idx`. */
function skipString(str, idx) {
    const quote = str[idx];
    let i = idx + 1;
    while (i < str.length) {
        if (str[i] === '\\') { i += 2; continue; }
        if (str[i] === quote) return i + 1;
        i++;
    }
    return str.length;
}

/** Minimal CSS.escape fallback for attribute-value building. */
function cssEscape(s) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\]/g, '\\$&');
}
