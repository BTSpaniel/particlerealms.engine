// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * EntitySystem — lightweight entity registry used by LIFE narrative systems.
 *
 * This is intentionally a simple in-memory map. The ECS runtime lives in the
 * engine simulation layer; narrative modules just need a stable handle to the
 * active entity collection they are narrating.
 */
export class EntitySystem {
    constructor() {
        this._map = new Map();
    }

    add(id, entity) {
        this._map.set(id, entity);
        return entity;
    }

    get(id) {
        return this._map.get(id);
    }

    has(id) {
        return this._map.has(id);
    }

    remove(id) {
        this._map.delete(id);
    }

    ids() {
        return [...this._map.keys()];
    }

    all() {
        return [...this._map.values()];
    }

    addMemory(id, memory) {
        const entity = this._map.get(id);
        if (!entity) return false;
        if (!entity.memories) entity.memories = { keyMemories: [] };
        if (!entity.memories.keyMemories) entity.memories.keyMemories = [];
        entity.memories.keyMemories.push(memory);
        return true;
    }

    clear() {
        this._map.clear();
    }
}

export default EntitySystem;
