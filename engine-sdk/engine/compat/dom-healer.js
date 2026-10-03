// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * dom-healer.js — create DOM elements a guest app requires but that are missing.
 *
 * Many single-file WebGPU apps assume `<canvas id="c">`, an overlay `#ov`, a HUD
 * `#hud`, etc. already exist. The compatibility profile lists those in
 * `profile.dom.requiredElements`; this healer ensures each exists inside the
 * guest's realm container BEFORE the guest's scripts run, so `getElementById`
 * and friends resolve instead of throwing.
 */

/**
 * Ensure every `profile.dom.requiredElements` entry exists under `rootEl`.
 * @param {HTMLElement} rootEl — the guest realm container
 * @param {object} profile — compatibility profile
 * @returns {{ created: string[] }} ids that were created
 */
export function healDom(rootEl, profile) {
    const created = [];
    const required = profile?.dom?.requiredElements ?? [];
    for (const item of required) {
        const id = item?.id;
        if (!id) continue;
        if (rootEl.querySelector('#' + cssEscape(id))) continue;
        const el = document.createElement(item.tag || 'div');
        el.id = id;
        // Canvases get a sane default size so a guest that reads width/height
        // before configuring still gets non-zero dimensions.
        if ((item.tag || '').toLowerCase() === 'canvas') {
            if (!el.hasAttribute('width'))  el.width = item.width ?? 300;
            if (!el.hasAttribute('height')) el.height = item.height ?? 150;
        }
        rootEl.appendChild(el);
        created.push(id);
    }
    return { created };
}

function cssEscape(s) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return String(s).replace(/(["\\#.\[\]:>+~*^$|=()])/g, '\\$1');
}
