// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { cloneAndFreezeStrictJson } from '../../core/schema/StrictJsonValue.js';
import { hashIdSecure } from '../../state/util/canonical.js';
import { validateMatterDefinition } from '../contracts/MatterContracts.js';
import { createMatterDefinitionFromCompositeMaterial } from '../adapters/CompositeMaterialMatterAdapter.js';

const SECURE_HASH = /^sha256(?::256)?:[0-9a-f]{64}$/;

async function normalizeEntry(input, path) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(`${path}: must be an object`);
  }
  const entry = cloneAndFreezeStrictJson(input, path);
  for (const key of Object.keys(entry)) {
    if (!['definition', 'definitionHash'].includes(key)) throw new TypeError(`${path}.${key}: unknown field`);
  }
  validateMatterDefinition(entry.definition, `${path}.definition`);
  if (typeof entry.definitionHash !== 'string' || !SECURE_HASH.test(entry.definitionHash)) {
    throw new TypeError(`${path}.definitionHash: must be a SHA-256 content hash`);
  }
  const expectedHash = await hashIdSecure(entry.definition, {
    domain: 'engine.matter.definition',
    schemaVersion: entry.definition.schemaVersion,
  });
  const suppliedDigest = entry.definitionHash.slice(entry.definitionHash.lastIndexOf(':') + 1);
  const expectedDigest = expectedHash.slice(expectedHash.lastIndexOf(':') + 1);
  if (suppliedDigest !== expectedDigest) {
    throw new TypeError(`${path}.definitionHash: does not match the definition content`);
  }
  return entry;
}

/** Open definition catalog with immutable entries and deterministic iteration. */
export class EngineMatterCatalog {
  #byId = new Map();

  constructor(entries = []) {
    if (!Array.isArray(entries)) throw new TypeError('EngineMatterCatalog entries must be an array');
    if (entries.length > 0) {
      throw new TypeError('EngineMatterCatalog initial entries require await EngineMatterCatalog.create(entries)');
    }
  }

  static async create(entries = []) {
    if (!Array.isArray(entries)) throw new TypeError('EngineMatterCatalog entries must be an array');
    const catalog = new EngineMatterCatalog();
    for (const [index, entry] of entries.entries()) {
      await catalog.add(entry, `$.entries[${index}]`);
    }
    return catalog;
  }

  async add(entryInput, path = '$.entry') {
    const entry = await normalizeEntry(entryInput, path);
    if (this.#byId.has(entry.definition.id)) {
      throw new TypeError(`Matter definition '${entry.definition.id}' is already registered`);
    }
    this.#byId.set(entry.definition.id, entry);
    return this;
  }

  has(definitionId) {
    return this.#byId.has(String(definitionId));
  }

  get(definitionId) {
    return this.#byId.get(String(definitionId)) ?? null;
  }

  list() {
    return Object.freeze([...this.#byId.values()]
      .sort((left, right) => left.definition.id.localeCompare(right.definition.id)));
  }
}

/** Adapt, rather than duplicate, an existing composite-material catalog. */
export async function createEngineMatterCatalogFromCompositeCatalog(compositeCatalog) {
  if (!compositeCatalog || typeof compositeCatalog.list !== 'function') {
    throw new TypeError('Composite material catalog with list() is required');
  }
  const entries = [];
  for (const resource of compositeCatalog.list()) {
    entries.push(await createMatterDefinitionFromCompositeMaterial(resource));
  }
  return EngineMatterCatalog.create(entries);
}
