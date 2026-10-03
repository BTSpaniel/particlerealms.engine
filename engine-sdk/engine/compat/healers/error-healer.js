// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * healers/error-healer.js — enable scoped error capture for the guest.
 *
 * Marks the profile so the bootloader installs error/unhandledrejection capture
 * (Phase 7's recovery layer reads `healing.captureErrors`). Kept as its own pass
 * so the recovery policy can grow independently.
 */

export function healErrorPolicy({ profile }, report) {
    const h = profile.healing ?? (profile.healing = {});
    if (h.captureErrors == null) h.captureErrors = true;
    report.push('error: capture enabled');
}
