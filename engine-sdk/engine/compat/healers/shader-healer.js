// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * healers/shader-healer.js — migrate deprecated WGSL attribute syntax.
 *
 * Older WGSL used `[[stage(...)]]` / `[[group(x), binding(y)]]` / `[[location(n)]]`
 * / `[[builtin(...)]]`, which modern WebGPU rejects. This pass rewrites those
 * tokens to the current `@stage` / `@group @binding` / `@location` / `@builtin`
 * forms inside inline guest scripts. The patterns are WGSL-specific and do not
 * occur in normal JS, so the rewrite is safe. Gated by `profile.healing.healShaders`.
 */

const MIGRATIONS = [
    [/\[\[\s*stage\(vertex\)\s*\]\]/g,                              '@vertex'],
    [/\[\[\s*stage\(fragment\)\s*\]\]/g,                            '@fragment'],
    [/\[\[\s*stage\(compute\)\s*\]\]/g,                             '@compute'],
    [/\[\[\s*location\((\d+)\)\s*\]\]/g,                            '@location($1)'],
    [/\[\[\s*builtin\(([a-zA-Z_]+)\)\s*\]\]/g,                      '@builtin($1)'],
    [/\[\[\s*group\((\d+)\)\s*,?\s*binding\((\d+)\)\s*\]\]/g,       '@group($1) @binding($2)'],
    [/\[\[\s*binding\((\d+)\)\s*,?\s*group\((\d+)\)\s*\]\]/g,       '@group($2) @binding($1)'],
];

export function healShaders({ model, profile }, report) {
    if (!profile?.healing?.healShaders) return;
    let changed = 0;
    for (const s of model?.scripts ?? []) {
        if (!s.code || s.src) continue;
        let code = s.code;
        let touched = false;
        for (const [re, rep] of MIGRATIONS) {
            if (re.test(code)) { code = code.replace(re, rep); touched = true; }
        }
        if (touched) { s.code = code; changed++; }
    }
    if (changed) report.push(`shader: migrated deprecated WGSL attributes in ${changed} script(s)`);
}
