// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/chunks/ChunkLimits.js — size ceilings/defaults (network plan §27).

/** Network-wide hard ceiling for one logical chunk. Not the default — a ceiling. */
export const MAX_CHUNK_BYTES = 4 * 1024 * 1024; // 4 MB

/** Sensible default chunk size (§27: "512 KB-1 MB"). */
export const DEFAULT_CHUNK_BYTES = 768 * 1024;

/** Default transport fragment size (§27/§28; matches WebRTC DataChannel's assumed default `max-message-size`). */
export const DEFAULT_FRAGMENT_BYTES = 64 * 1024;

/** Experimental larger fragment size for trusted high-bandwidth links. */
export const MAX_FRAGMENT_BYTES = 256 * 1024;

/** Soft caps for non-bulk message classes (§27). */
export const CONTROL_MAX_BYTES = 64 * 1024;
export const MANIFEST_MAX_BYTES = 256 * 1024;
