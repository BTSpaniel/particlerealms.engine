// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * html-ingestor.js — parse a guest HTML document into a structured model.
 *
 * Uses DOMParser (scripts parsed this way are INERT — they will not execute on
 * insertion), so we can safely inspect and relocate the DOM, then hand the
 * extracted scripts to the runtime realm to execute in controlled order.
 *
 * The returned model:
 * {
 *   doc,                       // the parsed Document (inert)
 *   title,
 *   scripts: [{ module, src, code, async, defer }],   // document order
 *   styles:  [{ inline, href, code }],                // document order
 *   links:   [{ rel, href }],
 *   canvases:[{ id, width, height }],
 *   assets:  string[],         // referenced asset URLs (img/src, etc.)
 * }
 */

export function parseHTML(html, baseUrl = null) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html ?? ''), 'text/html');

    const scripts = [];
    for (const s of doc.querySelectorAll('script')) {
        const type = (s.getAttribute('type') || '').toLowerCase();
        // Skip data blocks (e.g. application/json, importmap) — not executable JS.
        if (type && type !== 'module' && type !== 'text/javascript' && type !== 'application/javascript') {
            continue;
        }
        scripts.push({
            module: type === 'module',
            src:    s.getAttribute('src') || null,
            code:   s.textContent || '',
            async:  s.hasAttribute('async'),
            defer:  s.hasAttribute('defer'),
        });
    }

    const styles = [];
    for (const st of doc.querySelectorAll('style')) {
        styles.push({ inline: true, href: null, code: st.textContent || '' });
    }

    const links = [];
    for (const l of doc.querySelectorAll('link[rel]')) {
        const rel = (l.getAttribute('rel') || '').toLowerCase();
        const href = l.getAttribute('href') || '';
        links.push({ rel, href });
        if (rel.includes('stylesheet') && href) {
            styles.push({ inline: false, href, code: '' });
        }
    }

    const canvases = [];
    for (const c of doc.querySelectorAll('canvas')) {
        canvases.push({
            id: c.id || null,
            width: c.getAttribute('width') ? Number(c.getAttribute('width')) : null,
            height: c.getAttribute('height') ? Number(c.getAttribute('height')) : null,
        });
    }

    const assets = [];
    for (const el of doc.querySelectorAll('img[src], audio[src], video[src], source[src], track[src]')) {
        const src = el.getAttribute('src');
        if (src) assets.push(src);
    }

    return {
        doc,
        baseUrl,
        title: doc.title || null,
        scripts,
        styles,
        links,
        canvases,
        assets,
    };
}
