// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SpellBook.js — local stub for the external spell book persistence system.
 */

function createBook() {
    const spells = new Map();
    const listeners = new Set();
    const notify = (event, data) => listeners.forEach(cb => cb(event, data));
    return {
        subscribe: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
        add: (spell) => { spells.set(spell.id, spell); notify('add', spell); },
        getSpell: (id) => spells.get(id) || null,
        getAll: () => [...spells.values()],
        delete: (id) => { spells.delete(id); notify('delete', id); },
    };
}

let _defaultBook = null;

export function getSpellBook() {
    if (!_defaultBook) _defaultBook = createBook();
    return _defaultBook;
}

export function initSpellBookWithPresets() {
    const book = createBook();
    // Seed with a minimal preset so the panels don't error on empty state.
    book.add({ id: 'fireball', name: 'Fireball', category: 'combat', params: { color: '#ff5500' } });
    return book;
}
