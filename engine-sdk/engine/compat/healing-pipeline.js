// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * healing-pipeline.js — ordered pre-boot healing passes over a guest.
 *
 * Runs after probing and before the realm is built, mutating the parsed model
 * and the profile in place. Ordered per the compat spec: DOM/CSS scoping happen
 * in the realm itself; here we do the model/profile-level passes:
 *   GPU flags → lifecycle flags → error policy → asset URL rewrite → WGSL repair.
 *
 * Each pass is isolated (a throwing healer never aborts the others) and appends
 * to a human-readable report returned to the caller.
 */

import { healGpu }         from './healers/gpu-healer.js';
import { healLifecycle }   from './healers/lifecycle-healer.js';
import { healErrorPolicy } from './healers/error-healer.js';
import { healAssets }      from './healers/asset-healer.js';
import { healShaders }     from './healers/shader-healer.js';

const PASSES = [
    ['gpu',       healGpu],
    ['lifecycle', healLifecycle],
    ['error',     healErrorPolicy],
    ['asset',     healAssets],
    ['shader',    healShaders],
];

/**
 * @param {{ model, profile, files, appId }} ctxObj
 * @returns {{ profile, model, report: string[] }}
 */
export function runHealingPipeline(ctxObj) {
    const report = [];
    for (const [id, pass] of PASSES) {
        try { pass(ctxObj, report); }
        catch (e) { report.push(`${id}-healer error: ${e.message}`); }
    }
    return { profile: ctxObj.profile, model: ctxObj.model, report };
}
