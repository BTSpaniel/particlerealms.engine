// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { contentHashHex } from '../core/math/ChecksumMath.js';

/**
 * profile-builder.js — assemble & merge compatibility profiles.
 *
 * A profile is the durable description of what a guest app needs and how to heal
 * it. The static scanner produces a fresh profile; the cache may hold a saved one
 * from a previous version. `mergeProfiles` reuses known-good healing decisions
 * and layers in newly detected requirements.
 */

export const PROFILE_FORMAT = 'compat-profile-v1';

/**
 * Build a full profile from a static scan result.
 * @param {string} id
 * @param {{uses:object,dom:object,gpu:object}} scan — from scanSource()
 * @param {object} [opts] — { sourceType, sourceHash, liveSource }
 */
export function buildProfile(id, scan, opts = {}) {
    const uses = scan?.uses ?? {};
    return {
        format: PROFILE_FORMAT,
        id,
        sourceType: opts.sourceType ?? 'single-file-html',
        sourceHash: opts.sourceHash ?? null,
        liveSource: opts.liveSource ?? null,
        createdAt: new Date().toISOString(),
        uses: { ...uses },
        dom: { requiredElements: scan?.dom?.requiredElements ?? [] },
        gpu: { ...(scan?.gpu ?? {}) },
        healing: defaultHealing(scan),
        permissions: defaultPermissions(scan),
        // Import resolution for bare ES specifiers (`import 'three'`). `map` holds
        // explicit pins (exact or trailing-slash prefix); unmapped bare specifiers
        // fall back to `cdn` when healing.cdnImports !== false.
        imports: { map: {}, cdn: null },
    };
}

/**
 * Merge a saved profile with a freshly scanned one. Saved healing/permissions
 * decisions win (they were promoted as working); newly detected requirements and
 * `uses`/`gpu` flags are unioned in.
 */
export function mergeProfiles(saved, fresh) {
    if (!saved) return fresh;
    if (!fresh) return saved;
    return {
        ...fresh,
        createdAt: saved.createdAt ?? fresh.createdAt,
        // Isolation tier is a durable author/compile decision — keep it.
        isolation: fresh.isolation ?? saved.isolation,
        uses: { ...fresh.uses, ...orTrue(saved.uses, fresh.uses) },
        gpu:  { ...fresh.gpu, ...orTrue(saved.gpu, fresh.gpu) },
        dom:  { requiredElements: unionElements(saved.dom?.requiredElements, fresh.dom?.requiredElements) },
        healing: { ...fresh.healing, ...saved.healing },
        permissions: { ...fresh.permissions, ...saved.permissions },
        liveSource: fresh.liveSource ?? saved.liveSource ?? null,
        // Author-pinned import map wins; CDN base prefers a saved override.
        imports: {
            map: { ...(fresh.imports?.map ?? {}), ...(saved.imports?.map ?? {}) },
            cdn: saved.imports?.cdn ?? fresh.imports?.cdn ?? null,
        },
    };
}

/** Map a profile to a kernel/AppRegistry permission list (best-effort). */
export function profilePermissionList(profile) {
    const p = profile?.permissions ?? {};
    const out = [];
    if (p['gpu.render'] || p['gpu.compute']) out.push('gpu');
    if (p['gpu.compute']) out.push('gpu.compute');
    if (p['files.import'] || p['files.export']) out.push('storage.read');
    if (p['files.export']) out.push('storage.write');
    // Sandboxed localStorage/IndexedDB → persistent storage (read+write).
    if (p['storage.local']) { out.push('storage.read'); out.push('storage.write'); }
    if (p['network.fetch']) out.push('net.send');
    if (p['audio.play']) out.push('audio.play');
    if (p['clipboard.read']) out.push('clipboard.read');
    if (p['media.audio']) out.push('media.audio');
    if (p['media.video']) out.push('media.video');
    if (p['notifications']) out.push('notifications');
    return [...new Set(out)];
}

/** SHA-256 hex of a string (used for source/version hashing). */
export async function sha256Hex(str) {
    return contentHashHex(String(str ?? ''), 'SHA-256');
}

// ── Internals ───────────────────────────────────────────────────────────────

function defaultHealing(scan) {
    const u = scan?.uses ?? {};
    const g = scan?.gpu ?? {};
    return {
        repairDom: true,
        scopeCss: true,
        clampGpuLimits: !!u.webgpu,
        wrapQueueSubmit: !!u.webgpu,
        recoverOnContextLoss: !!u.webgpu,
        rewriteAssetUrls: true,
        safeStorage: !!u.localStorage,
        safeDownloads: !!u.fileExport,
        healShaders: !!(g.usesRenderPipelines || g.usesCompute),
        // Resolve unmapped bare ES imports via a CDN (esm.sh by default). Set
        // false to require every bare specifier to be pinned in imports.map.
        cdnImports: true,
    };
}

function defaultPermissions(scan) {
    const u = scan?.uses ?? {};
    const g = scan?.gpu ?? {};
    return {
        'gpu.render':  !!g.usesRenderPipelines || !!u.webgpu,
        'gpu.compute': !!g.usesCompute,
        'gpu.storageBuffers': !!g.usesStorageBuffers,
        'canvas.2d': !!u.canvas2d,
        'input.keyboard': !!u.keyboard,
        'input.pointer': !!u.pointer,
        'files.import': !!u.fileImport,
        'files.export': !!u.fileExport,
        // Sandboxed client-side persistence (localStorage/sessionStorage/IndexedDB).
        'storage.local': !!u.localStorage || !!u.indexedDB,
        'network.fetch': false, // default-deny egress; dev opts in explicitly
        'workers': !!u.workers,
        // WebAudio playback / worklets → routed through the OS audio mixer.
        'audio.play': !!u.audio || !!u.worklet,
        // navigator.clipboard / execCommand copy-paste.
        'clipboard.read': !!u.clipboard,
        // getUserMedia/getDisplayMedia is statically ambiguous (audio vs video),
        // so flag both for review — actual capture still needs a runtime gesture
        // + the permission prompt.
        'media.audio': !!u.getUserMedia,
        'media.video': !!u.getUserMedia,
        'notifications': !!u.notifications,
    };
}

function orTrue(a = {}, b = {}) {
    const out = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (typeof a[k] === 'boolean' || typeof b[k] === 'boolean') out[k] = !!a[k] || !!b[k];
        else out[k] = a[k] ?? b[k];
    }
    return out;
}

function unionElements(a = [], b = []) {
    const byId = new Map();
    for (const e of [...(a || []), ...(b || [])]) {
        if (!e?.id) continue;
        if (!byId.has(e.id)) byId.set(e.id, e);
    }
    return [...byId.values()];
}
