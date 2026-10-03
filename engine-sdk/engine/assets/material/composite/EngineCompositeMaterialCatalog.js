// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { validateEngineCompositeMaterialResource } from './CompositeMaterialContracts.js';
import { cloneStrictJson, deepFreezeJson } from '../../../core/schema/StrictJsonValue.js';
import {
    ENGINE_CONSTRUCTION_COMPOSITE_MATERIAL_ALIASES,
    ENGINE_CONSTRUCTION_COMPOSITE_MATERIAL_RESOURCES,
} from './ConstructionCompositeMaterialCatalog.js';

export const ENGINE_COMPOSITE_MATERIAL_RESOURCE_URLS = Object.freeze([
    new URL('./resources/material/element/metal/transition/gold.json', import.meta.url).href,
    new URL('./resources/material/element/metal/transition/copper.json', import.meta.url).href,
    new URL('./resources/material/alloy/copper/brass.json', import.meta.url).href,
    new URL('./resources/material/fiber/natural/bast/hemp.json', import.meta.url).href,
    new URL('./resources/material/polymer/elastomer/natural-rubber.json', import.meta.url).href,
    new URL('./resources/material/organic/wood/hardwood/oak.json', import.meta.url).href,
]);

const MATERIAL_ID = /^(?:builtin|rf)\.material\.[a-z0-9][a-z0-9.-]*$/;

export class EngineCompositeMaterialCatalog {
    #byId;
    #byPath;
    #aliases;
    #ordered;
    #provenanceInventory;
    #aliasInventory;

    constructor(resources, { aliases = {} } = {}) {
        if (!Array.isArray(resources) || resources.length === 0) {
            throw new TypeError('EngineCompositeMaterialCatalog requires material resources');
        }
        this.#byId = new Map();
        this.#byPath = new Map();
        this.#aliases = new Map();
        for (const [index, input] of resources.entries()) {
            const resource = deepFreezeJson(cloneStrictJson(input, `$.resources[${index}]`));
            validateEngineCompositeMaterialResource(resource, `$.resources[${index}]`);
            if (this.#byId.has(resource.id)) throw new TypeError(`Duplicate composite material ID '${resource.id}'`);
            if (this.#byPath.has(resource.logicalPath)) throw new TypeError(`Duplicate composite material path '${resource.logicalPath}'`);
            this.#byId.set(resource.id, resource);
            this.#byPath.set(resource.logicalPath, resource);
        }
        const aliasRecord = cloneStrictJson(aliases, '$.aliases');
        for (const [alias, canonicalId] of Object.entries(aliasRecord).sort(([left], [right]) => left.localeCompare(right))) {
            if (!MATERIAL_ID.test(alias)) throw new TypeError(`Invalid composite material alias '${alias}'`);
            if (this.#byId.has(alias)) throw new TypeError(`Composite material alias collides with resource '${alias}'`);
            if (typeof canonicalId !== 'string' || !MATERIAL_ID.test(canonicalId)) {
                throw new TypeError(`Invalid composite material alias target '${String(canonicalId)}'`);
            }
            if (!this.#byId.has(canonicalId)) {
                throw new TypeError(`Composite material alias '${alias}' targets missing resource '${canonicalId}'`);
            }
            this.#aliases.set(alias, canonicalId);
        }
        this.#ordered = Object.freeze([...this.#byId.values()].sort((a, b) => a.id.localeCompare(b.id)));
        this.#aliasInventory = deepFreezeJson([...this.#aliases.entries()].map(([alias, canonicalId]) => ({
            alias,
            canonicalId,
        })));
        this.#provenanceInventory = deepFreezeJson(this.#ordered.map(resource => ({
            materialId: resource.id,
            logicalPath: resource.logicalPath,
            sources: resource.sources.map(source => ({
                ...source,
                fields: Object.entries(resource.fieldSources)
                    .filter(([, sourceIds]) => sourceIds.includes(source.id))
                    .map(([fieldPath]) => fieldPath)
                    .sort(),
            })),
        })));
        Object.freeze(this);
    }

    get(id) {
        const requested = String(id);
        return this.#byId.get(this.#aliases.get(requested) ?? requested) ?? null;
    }
    getByPath(path) { return this.#byPath.get(String(path)) ?? null; }
    has(id) {
        const requested = String(id);
        return this.#byId.has(requested) || this.#aliases.has(requested);
    }
    canonicalId(id) {
        const requested = String(id);
        if (this.#byId.has(requested)) return requested;
        return this.#aliases.get(requested) ?? null;
    }
    list() { return this.#ordered; }
    ids() { return Object.freeze(this.#ordered.map(resource => resource.id)); }
    resolvableIds() { return Object.freeze([...this.ids(), ...this.#aliases.keys()].sort()); }
    aliasInventory() { return this.#aliasInventory; }
    provenanceInventory() { return this.#provenanceInventory; }
}

/** Browser-native JSON loader. Callers may inject an equivalent fetch boundary. */
export async function loadEngineCompositeMaterialCatalog({
    fetchImpl = globalThis.fetch,
    urls = ENGINE_COMPOSITE_MATERIAL_RESOURCE_URLS,
    includeConstruction = false,
} = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('Composite material catalog requires fetch');
    if (!Array.isArray(urls) || urls.length === 0) throw new TypeError('Composite material catalog URLs are required');
    const resources = [];
    for (const rawUrl of urls) {
        const url = String(rawUrl);
        const response = await fetchImpl(url, { cache: 'no-store' });
        if (!response?.ok) throw new Error(`Composite material resource load failed (${response?.status ?? 'no response'}): ${url}`);
        let value;
        try { value = await response.json(); }
        catch (error) { throw new Error(`Composite material resource is not valid JSON: ${url}`, { cause: error }); }
        resources.push(value);
    }
    if (typeof includeConstruction !== 'boolean') {
        throw new TypeError('includeConstruction must be boolean');
    }
    return new EngineCompositeMaterialCatalog(
        includeConstruction
            ? [...resources, ...ENGINE_CONSTRUCTION_COMPOSITE_MATERIAL_RESOURCES]
            : resources,
        { aliases: includeConstruction ? ENGINE_CONSTRUCTION_COMPOSITE_MATERIAL_ALIASES : {} },
    );
}

/** Load the legacy six-resource catalog plus the sourced v1.1 construction layer. */
export function loadEngineConstructionCompositeMaterialCatalog(options = {}) {
    return loadEngineCompositeMaterialCatalog({ ...options, includeConstruction: true });
}

export default loadEngineCompositeMaterialCatalog;
