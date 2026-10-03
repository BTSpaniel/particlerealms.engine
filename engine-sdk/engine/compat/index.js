// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * engine/compat/index.js — the Engine Compatibility namespace.
 *
 * `createCompat(ctx)` returns the `engine.compat` API used across the OS:
 *   await engine.compat.boot({ id, source, mount, mode, permissions });
 *
 * `ctx` wires the compat layer to the host engine/kernel (all optional):
 *   storage   — kernel.storageManager (profile/snapshot persistence)
 *   gpu       — host bridge with an explicit ownership policy, adapter facade,
 *               and mediated canvas configuration/release operations
 *   scheduler — engine frame scheduler (RAF interposition, Phase 5/6)
 *   validate  — async (profile) => { valid, errors }      (Phase 3)
 *   heal      — async ({ model, profile, files, appId })  (Phase 4)
 *   interpose — async ({ realm, profile, app, ctx })      (Phase 5)
 *   onError   — (info) => void
 *
 * Phases 3-7 register their hooks onto the same ctx, so this factory stays the
 * single, stable entry point as the pipeline grows.
 */

import { CompatBootloader, bootExternalApp } from './bootloader.js';
import { ProfileCache } from './profile-cache.js';
import { scanSource }   from './probe-scanner.js';
import { parseHTML }    from './html-ingestor.js';
import { loadSource }   from './source-loader.js';
import { buildProfile, mergeProfiles, sha256Hex } from './profile-builder.js';
import { scopeCss, scopeSelectorFor } from './css-healer.js';
import { healDom }      from './dom-healer.js';
import { validateProfile, compatSchemas } from './schema-registry.js';
import { runHealingPipeline } from './healing-pipeline.js';

export const COMPAT_VERSION = '0.1.0';

export function createCompat(ctx = {}) {
    const profileCache = ctx.profileCache ?? new ProfileCache(ctx.storage ?? null);
    // Default profile validation (Phase 3): structural schema + consistency rules.
    // Warnings are surfaced via onError but never block boot; structural errors do.
    const validate = ctx.validate ?? ((profile) => {
        const r = validateProfile(profile);
        if (r.warnings?.length) {
            try { ctx.onError?.({ appId: profile?.id, type: 'profile-warning', message: r.warnings.join('; ') }); } catch {}
        }
        return r;
    });
    // Default healing (Phase 4): ordered model/profile passes (gpu/lifecycle/error/
    // asset/shader). Mutates in place; never blocks boot.
    const heal = ctx.heal ?? ((healCtx) => { runHealingPipeline(healCtx); });
    const bootloader = new CompatBootloader({ ...ctx, profileCache, validate, heal });

    return {
        version: COMPAT_VERSION,
        bootloader,
        profileCache,

        /** Boot a guest app into a mount element. */
        boot: (options) => bootloader.boot(options),
        get:  (id) => bootloader.get(id),
        destroy: (id) => bootloader.destroy(id),
        destroyAll: () => bootloader.destroyAll(),

        /**
         * Forget all cached compat data for an app (profile, snapshots, index
         * entry) and tear down any running instance. Used on uninstall when the
         * user opts to also delete cached data.
         */
        async purge(id) {
            try { bootloader.destroy(id); } catch {}
            return profileCache.purge(id);
        },

        /**
         * Probe-only: load + parse + scan a source and return a fresh profile
         * WITHOUT executing it. Used by Package Studio to preview/auto-generate.
         */
        async probe(source, { id = 'preview', liveSource = null } = {}) {
            const loaded = await loadSource(source, ctx);
            const model  = parseHTML(loaded.html, loaded.baseUrl);
            const scan   = scanSource(model, loaded.files);
            const profile = buildProfile(id, scan, {
                sourceType: loaded.sourceType,
                sourceHash: loaded.sourceHash,
                liveSource,
            });
            return { profile, model, loaded };
        },

        /** Validate a profile (structural schema + consistency rules) without booting. */
        validateProfile,
        schemas: compatSchemas,
        /** Run the healing pipeline over { model, profile, files } (used by Studio previews). */
        runHealingPipeline,

        // Re-exported primitives (used by the compiler + later phases).
        scanSource, parseHTML, loadSource,
        buildProfile, mergeProfiles, sha256Hex,
        scopeCss, scopeSelectorFor, healDom,
    };
}

export { CompatBootloader, bootExternalApp, ProfileCache };
