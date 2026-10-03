// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * healers/lifecycle-healer.js — ensure lifecycle healing flags are populated.
 *
 * These flags drive the interposers and the recovery layer (Phase 7): whether to
 * recover on GPU context loss, namespace storage, and route downloads safely.
 */

export function healLifecycle({ profile }, report) {
    const u = profile.uses ?? (profile.uses = {});
    const h = profile.healing ?? (profile.healing = {});

    if (h.recoverOnContextLoss == null) h.recoverOnContextLoss = !!u.webgpu;
    if (h.safeStorage == null)          h.safeStorage = !!u.localStorage;
    if (h.safeDownloads == null)        h.safeDownloads = !!u.fileExport;
    report.push('lifecycle: healing flags ensured');
}
