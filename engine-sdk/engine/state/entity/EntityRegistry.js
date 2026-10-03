// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/entity/EntityRegistry.js — versioned entity state (spec §4, rule 2).
//
// A mutable logical object is represented as a chain of immutable versions.
// The logical entity id stays stable; each version's id is the content hash of
// its canonical bytes. "Editing" creates a new version pointing at its parent —
// the old version is never mutated. This is what optimistic concurrency reads
// against: a transaction's readSet declares the version it expected, and the
// commit fails if the entity has since advanced (write-skew protection).

import { hashIdFast } from '../util/canonical.js';

export class EntityRegistry {
  constructor() {
    this._heads = new Map();     // entityID → current versionID
    this._versions = new Map();  // versionID → { entityID, versionID, previousVersion, content }
  }

  /** Current version id for an entity, or null if unknown. */
  head(entityID) { return this._heads.get(String(entityID)) ?? null; }

  /** Full version record by version id, or null. */
  version(versionID) { return this._versions.get(String(versionID)) ?? null; }

  /** True if the entity's head matches `expectedVersion` (optimistic read). */
  matchesVersion(entityID, expectedVersion) {
    if (expectedVersion == null) return !this._heads.has(String(entityID));
    return this.head(entityID) === String(expectedVersion);
  }

  /**
   * Create the first version of a new entity. Returns the version record.
   * @param {string} entityID stable logical id
   * @param {*} content       canonicalizable content
   */
  createEntity(entityID, content) {
    const eid = String(entityID);
    if (this._heads.has(eid)) throw new Error(`entity already exists: ${eid}`);
    return this._commitVersion(eid, content, null);
  }

  /**
   * Append a new immutable version. `expectedPrevious` (if given) must equal the
   * current head or the update is rejected (optimistic concurrency).
   * @returns {{ ok:boolean, version?:object, reason?:string }}
   */
  putVersion(entityID, content, expectedPrevious = undefined) {
    const eid = String(entityID);
    const head = this._heads.get(eid) ?? null;
    if (expectedPrevious !== undefined && String(expectedPrevious ?? '') !== String(head ?? '')) {
      return { ok: false, reason: 'version-conflict' };
    }
    return { ok: true, version: this._commitVersion(eid, content, head) };
  }

  _commitVersion(entityID, content, previousVersion) {
    const versionID = hashIdFast({ entityID, previousVersion, content }, { schemaVersion: 'entity-v1' });
    const record = Object.freeze({ entityID, versionID, previousVersion, content });
    this._versions.set(versionID, record);
    this._heads.set(entityID, versionID);
    return record;
  }

  /** All current head version ids, sorted (for state roots). */
  headIds() { return [...this._heads.values()].sort(); }
}
