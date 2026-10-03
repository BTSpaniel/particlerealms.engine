// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * healers/asset-healer.js — resolve bundled relative asset references.
 *
 * A multi-file guest references `<img src="logo.png">`, `<source src="clip.webm">`,
 * etc. Those relative URLs won't resolve inside the realm, so this pass rewrites
 * any reference present in the package `files` map to a blob URL. The created
 * URLs are recorded on `model._assetBlobs` so the realm revokes them on destroy.
 */

import { formatMimeFromExtension } from '../../core/math/FormatMath.js';

export function healAssets({ model, files }, report) {
    if (!model?.doc || !files || !files.size) return;
    const blobs = model._assetBlobs ?? (model._assetBlobs = []);
    let n = 0;

    const els = model.doc.querySelectorAll('img[src], source[src], audio[src], video[src], track[src], link[href]');
    for (const el of els) {
        const attr = el.hasAttribute('src') ? 'src' : 'href';
        const ref  = el.getAttribute(attr);
        if (!ref || /^(https?:|blob:|data:)/i.test(ref)) continue;
        const rel = ref.replace(/^\.?\//, '');
        if (!files.has(rel)) continue;
        const url = URL.createObjectURL(new Blob([files.get(rel)], { type: mimeFor(rel) }));
        blobs.push(url);
        el.setAttribute(attr, url);
        n++;
    }
    if (n) report.push(`asset: rewrote ${n} bundled reference(s) → blob`);
}

function mimeFor(rel) {
    return formatMimeFromExtension(rel, 'application/octet-stream');
}
