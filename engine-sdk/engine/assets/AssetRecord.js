// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/AssetRecord.js — the registry's record for one source asset.
//
// The asset registry (not the filesystem) is the source of truth. Each record
// tracks the source content hash, a primary virtual path, redundant backup
// paths, the set of converted engine artifacts, and license metadata. Records
// are deduplicated by source hash; variants/conflicts are linked, never merged
// blindly (see AssetDeduper / AssetRegistry).

let _recordSeq = 0;

export const ASSET_TYPES = Object.freeze(['model', 'material', 'texture', 'animation', 'surface', 'audio', 'unknown']);

/**
 * Create an asset record.
 * @param {object} init
 * @returns {object}
 */
export function createAssetRecord(init = {}) {
  return {
    id: init.id ?? `asset_${init.type ?? 'model'}_${++_recordSeq}`,
    type: ASSET_TYPES.includes(init.type) ? init.type : 'model',
    name: init.name ?? 'Untitled Asset',
    virtualPath: init.virtualPath ?? null,

    sourceHash: init.sourceHash ?? null,   // 'sha256:...'
    sourceFormat: init.sourceFormat ?? null,

    primary: init.primary ?? null,          // virtual path of the primary source
    backups: init.backups ?? [],            // ordered fallback virtual paths

    converted: {
      engineModel: null,
      previewMesh: null,
      thumbnail: null,
      collider: null,
      sdf: null,
      materialPack: null,
      ...(init.converted ?? {}),
    },

    license: createLicenseBlock(init.license),

    tags: init.tags ?? [],
    folder: init.folder ?? '',

    // dedup relationships (see AssetDeduper.classify)
    duplicateOf: init.duplicateOf ?? null,  // id of canonical record if exact dup
    variants: init.variants ?? [],          // ids sharing mesh/source but differing
    conflictsWith: init.conflictsWith ?? [], // same name, different hash

    lastVerified: init.lastVerified ?? Date.now(),
  };
}

/**
 * License metadata is mandatory before import (unknown is allowed but flagged).
 * Marketplace assets are licensed, not sold — track it and warn on restricted.
 */
export function createLicenseBlock(init = {}) {
  init = init || {}; // tolerate an explicit null (default params only catch undefined)
  return {
    source: init.source ?? 'unknown',        // 'user' | 'Fab' | 'Sketchfab' | 'UnityAssetStore' | 'custom' | ...
    licenseType: init.licenseType ?? 'unknown',
    allowsCommercialUse: init.allowsCommercialUse ?? null,
    allowsEngineConversion: init.allowsEngineConversion ?? null,
    requiresAttribution: init.requiresAttribution ?? null,
    notes: init.notes ?? '',
  };
}

/** True if the license is unknown or explicitly disallows engine conversion. */
export function licenseNeedsReview(license) {
  if (!license) return true;
  if (license.licenseType === 'unknown' || license.source === 'unknown') return true;
  if (license.allowsEngineConversion === false) return true;
  return false;
}
