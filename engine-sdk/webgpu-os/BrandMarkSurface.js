// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { mountParticleRealmsMark } from './BrandMark.js';

const HOST_SELECTOR = '[data-particle-realms-mark-host]';
const MOUNTED_ATTRIBUTE = 'data-particle-realms-mark-mounted';

/** Mount every declarative Particle Realms mark below a document or element. */
export function mountParticleRealmsMarkSurfaces(root = globalThis.document) {
    if (!root?.querySelectorAll) return Object.freeze([]);
    const mounted = [];
    for (const host of root.querySelectorAll(HOST_SELECTOR)) {
        if (host.hasAttribute(MOUNTED_ATTRIBUTE)) continue;
        try {
            const size = finiteDatasetNumber(host, 'particleRealmsSize', 42);
            const progress = finiteDatasetNumber(host, 'particleRealmsProgress', 100);
            const mark = mountParticleRealmsMark(host, {
                size,
                progress,
                outcome: host.dataset.particleRealmsOutcome || 'complete',
                animated: host.dataset.particleRealmsAnimated !== 'false',
                decorative: true,
            });
            host.setAttribute(MOUNTED_ATTRIBUTE, '');
            mounted.push(mark);
        } catch (error) {
            console.warn('[ParticleRealmsBrand] Mark surface could not be mounted.', error);
        }
    }
    return Object.freeze(mounted);
}

function finiteDatasetNumber(host, key, fallback) {
    const value = Number(host.dataset[key] ?? fallback);
    if (!Number.isFinite(value)) {
        throw new TypeError(`Particle Realms ${key} must be finite`);
    }
    return value;
}

function mountDocumentSurfaces() {
    mountParticleRealmsMarkSurfaces(document);
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountDocumentSurfaces, { once: true });
    } else {
        mountDocumentSurfaces();
    }
}
