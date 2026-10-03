// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/entity/SchemaRegistry.js — meaning from schemas, not numeric tricks
// (spec rule 3). Every schema/validator/policy is versioned (spec rule 5) so
// migrations can reference exact stamps. A schema declares a name, a version,
// and a validate(value) predicate; validation is structural (legality), never
// a claim of semantic truth — that comes from commit logic.

export class SchemaRegistry {
  constructor() {
    this._schemas = new Map(); // `${name}@${version}` → { name, version, validate }
  }

  /**
   * Register a versioned schema.
   * @param {string} name
   * @param {string} version
   * @param {(value:*)=>boolean} validate  true = structurally legal
   */
  register(name, version, validate) {
    if (typeof validate !== 'function') throw new TypeError('SchemaRegistry: validate must be a function');
    const key = `${name}@${version}`;
    this._schemas.set(key, Object.freeze({ name: String(name), version: String(version), validate }));
    return key;
  }

  /** Look up a schema by name + version, or null. */
  get(name, version) { return this._schemas.get(`${name}@${version}`) ?? null; }

  /**
   * Validate a value against a registered schema.
   * @returns {{ ok:boolean, reason:string|null }}
   */
  validate(name, version, value) {
    const schema = this.get(name, version);
    if (!schema) return { ok: false, reason: 'unknown-schema' };
    let ok = false;
    try { ok = !!schema.validate(value); } catch (_) { ok = false; }
    return { ok, reason: ok ? null : 'schema-violation' };
  }

  get size() { return this._schemas.size; }
}
