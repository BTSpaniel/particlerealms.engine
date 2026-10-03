// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/syncManager/SyncCategory.js — sync categories + target scopes
// (network plan §20 Sync Manager).

/** What a synced value may fan out to. */
export const SYNC_SCOPE = Object.freeze({
  DEVICE_ONLY: 'device_only',
  MY_DEVICES: 'my_devices',
  SELECTED_DEVICES: 'selected_devices',
  PRIVATE_GROUP: 'private_group',
  PUBLIC_PROFILE: 'public_profile',
});

/** The category groupings a profile's Sync Manager governs (network plan §20). */
export const SYNC_CATEGORIES = Object.freeze([
  'profile', 'desktop', 'apps', 'files', 'worlds', 'ai', 'developer',
]);
