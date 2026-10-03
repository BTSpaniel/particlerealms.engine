// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Fixed, finite page-local structure-of-arrays storage for Matter packets. */

import {
    cloneStrictJson,
    deepFreezeJson,
    isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';
import {
    MATTER_PACKET_STORE_SNAPSHOT_SCHEMA,
    MATTER_PACKET_STORE_SNAPSHOT_VERSION,
    createMatterPacketHandle,
    createMatterPacketProjection,
    validateMatterPacketProjection,
} from './MatterPacketContracts.js';

const STORE_KEYS = new Set(['schema', 'schemaVersion', 'pageSize', 'maxPages', 'pages']);
const PAGE_KEYS = new Set(['pageId', 'generations', 'activeWords', 'freeSlots', 'packets']);
const NUMERIC_CHANNELS = Object.freeze([
    'positionX', 'positionY', 'positionZ',
    'velocityX', 'velocityY', 'velocityZ',
    'massKg', 'representedVolumeM3',
    'angularX', 'angularY', 'angularZ',
    'thermalEnergyJ', 'elasticEnergyJ', 'subgridEnergyJ',
    'sourceRevision', 'representationRevision',
]);
const MAX_PAGE_SIZE = 1_048_576;
const MAX_PAGES = 65_536;

function fail(path, message) {
    throw new TypeError(`${path}: ${message}`);
}

function record(value, path) {
    if (!isPlainJsonObject(value)) fail(path, 'must be a plain object');
    return value;
}

function exactKeys(value, allowed, required, path) {
    record(value, path);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) fail(`${path}.${key}`, 'unknown field');
    }
    for (const key of required) {
        if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'is required');
    }
}

function positiveInteger(value, path, maximum) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
        fail(path, `must be a safe integer in [1, ${maximum}]`);
    }
    return value;
}

function integerArray(value, path, expectedLength, { minimum = 0, maximum = 0xffffffff } = {}) {
    if (!Array.isArray(value) || value.length !== expectedLength) {
        fail(path, `must contain exactly ${expectedLength} entries`);
    }
    value.forEach((entry, index) => {
        if (!Number.isSafeInteger(entry) || entry < minimum || entry > maximum) {
            fail(`${path}[${index}]`, `must be an integer in [${minimum}, ${maximum}]`);
        }
    });
}

function isActive(page, slot) {
    return (page.activeWords[slot >>> 5] & (1 << (slot & 31))) !== 0;
}

function setActive(page, slot, active) {
    const wordIndex = slot >>> 5;
    const mask = 1 << (slot & 31);
    if (active) page.activeWords[wordIndex] |= mask;
    else page.activeWords[wordIndex] &= ~mask;
}

function nextGeneration(current) {
    const next = (current + 1) >>> 0;
    return next === 0 ? 1 : next;
}

function createPage(pageId, pageSize) {
    const numeric = {};
    for (const channel of NUMERIC_CHANNELS) numeric[channel] = new Float64Array(pageSize);
    const freeSlots = [];
    for (let slot = pageSize - 1; slot >= 0; slot -= 1) freeSlots.push(slot);
    const generations = new Uint32Array(pageSize);
    generations.fill(1);
    return {
        pageId,
        numeric,
        generations,
        activeWords: new Uint32Array(Math.ceil(pageSize / 32)),
        freeSlots,
        regionIds: new Array(pageSize).fill(null),
        lineages: new Array(pageSize).fill(null),
        definitionIds: new Array(pageSize).fill(null),
        phases: new Array(pageSize).fill(null),
        componentIds: new Array(pageSize).fill(null),
        damageStates: new Array(pageSize).fill(null),
    };
}

function writeProjection(page, slot, packet) {
    const { numeric } = page;
    [numeric.positionX[slot], numeric.positionY[slot], numeric.positionZ[slot]] = packet.positionM;
    [numeric.velocityX[slot], numeric.velocityY[slot], numeric.velocityZ[slot]] = packet.velocityMPerS;
    numeric.massKg[slot] = packet.massKg;
    numeric.representedVolumeM3[slot] = packet.representedVolumeM3;
    [numeric.angularX[slot], numeric.angularY[slot], numeric.angularZ[slot]] = packet.angularMomentumKgM2PerS;
    numeric.thermalEnergyJ[slot] = packet.thermalEnergyJ;
    numeric.elasticEnergyJ[slot] = packet.elasticEnergyJ;
    numeric.subgridEnergyJ[slot] = packet.subgridEnergyJ;
    numeric.sourceRevision[slot] = packet.sourceRevision;
    numeric.representationRevision[slot] = packet.representationRevision;
    page.regionIds[slot] = packet.regionId;
    page.lineages[slot] = packet.lineage;
    page.definitionIds[slot] = packet.definitionId;
    page.phases[slot] = packet.phase;
    page.componentIds[slot] = packet.componentId;
    page.damageStates[slot] = packet.damageState;
}

function clearSlot(page, slot) {
    page.regionIds[slot] = null;
    page.lineages[slot] = null;
    page.definitionIds[slot] = null;
    page.phases[slot] = null;
    page.componentIds[slot] = null;
    page.damageStates[slot] = null;
    for (const channel of NUMERIC_CHANNELS) page.numeric[channel][slot] = 0;
}

function readProjection(page, slot) {
    const { numeric } = page;
    return createMatterPacketProjection({
        handle: {
            pageId: page.pageId,
            slot,
            generation: page.generations[slot],
        },
        regionId: page.regionIds[slot],
        lineage: page.lineages[slot],
        definitionId: page.definitionIds[slot],
        phase: page.phases[slot],
        componentId: page.componentIds[slot],
        damageState: page.damageStates[slot],
        sourceRevision: numeric.sourceRevision[slot],
        representationRevision: numeric.representationRevision[slot],
        positionM: [numeric.positionX[slot], numeric.positionY[slot], numeric.positionZ[slot]],
        velocityMPerS: [numeric.velocityX[slot], numeric.velocityY[slot], numeric.velocityZ[slot]],
        massKg: numeric.massKg[slot],
        representedVolumeM3: numeric.representedVolumeM3[slot],
        angularMomentumKgM2PerS: [numeric.angularX[slot], numeric.angularY[slot], numeric.angularZ[slot]],
        thermalEnergyJ: numeric.thermalEnergyJ[slot],
        elasticEnergyJ: numeric.elasticEnergyJ[slot],
        subgridEnergyJ: numeric.subgridEnergyJ[slot],
    });
}

function normalizeSnapshot(snapshotInput) {
    const snapshot = cloneStrictJson(snapshotInput, '$.matterPacketStoreSnapshot');
    exactKeys(snapshot, STORE_KEYS, STORE_KEYS, '$.matterPacketStoreSnapshot');
    if (snapshot.schema !== MATTER_PACKET_STORE_SNAPSHOT_SCHEMA) {
        fail('$.matterPacketStoreSnapshot.schema', 'is unsupported');
    }
    if (snapshot.schemaVersion !== MATTER_PACKET_STORE_SNAPSHOT_VERSION) {
        fail('$.matterPacketStoreSnapshot.schemaVersion', 'is unsupported');
    }
    positiveInteger(snapshot.pageSize, '$.matterPacketStoreSnapshot.pageSize', MAX_PAGE_SIZE);
    positiveInteger(snapshot.maxPages, '$.matterPacketStoreSnapshot.maxPages', MAX_PAGES);
    if (!Number.isSafeInteger(snapshot.pageSize * snapshot.maxPages)) {
        fail('$.matterPacketStoreSnapshot', 'maximum slot capacity exceeds the safe integer range');
    }
    if (!Array.isArray(snapshot.pages) || snapshot.pages.length > snapshot.maxPages) {
        fail('$.matterPacketStoreSnapshot.pages', 'exceeds maxPages');
    }
    const activeWordCount = Math.ceil(snapshot.pageSize / 32);
    snapshot.pages.forEach((page, pageIndex) => {
        const path = `$.matterPacketStoreSnapshot.pages[${pageIndex}]`;
        exactKeys(page, PAGE_KEYS, PAGE_KEYS, path);
        if (page.pageId !== pageIndex) fail(`${path}.pageId`, 'must be contiguous and equal its page index');
        integerArray(page.generations, `${path}.generations`, snapshot.pageSize, { minimum: 1 });
        integerArray(page.activeWords, `${path}.activeWords`, activeWordCount);
        if (!Array.isArray(page.freeSlots)) fail(`${path}.freeSlots`, 'must be an array');
        if (!Array.isArray(page.packets)) fail(`${path}.packets`, 'must be an array');
        const activeSlots = new Set();
        page.packets.forEach((packet, packetIndex) => {
            const packetPath = `${path}.packets[${packetIndex}]`;
            validateMatterPacketProjection(packet, packetPath);
            if (packet.handle.pageId !== page.pageId) fail(`${packetPath}.handle.pageId`, 'does not match pageId');
            if (packet.handle.slot >= snapshot.pageSize) fail(`${packetPath}.handle.slot`, 'is outside the page');
            if (packet.handle.generation !== page.generations[packet.handle.slot]) {
                fail(`${packetPath}.handle.generation`, 'does not match the slot generation');
            }
            if (activeSlots.has(packet.handle.slot)) fail(`${packetPath}.handle.slot`, 'duplicates an active slot');
            activeSlots.add(packet.handle.slot);
        });
        const freeSlots = new Set();
        page.freeSlots.forEach((slot, freeIndex) => {
            if (!Number.isSafeInteger(slot) || slot < 0 || slot >= snapshot.pageSize) {
                fail(`${path}.freeSlots[${freeIndex}]`, 'is outside the page');
            }
            if (freeSlots.has(slot)) fail(`${path}.freeSlots[${freeIndex}]`, 'duplicates a free slot');
            if (activeSlots.has(slot)) fail(`${path}.freeSlots[${freeIndex}]`, 'is also active');
            freeSlots.add(slot);
        });
        if (activeSlots.size + freeSlots.size !== snapshot.pageSize) {
            fail(path, 'active and free slots do not cover the page exactly');
        }
        for (let slot = 0; slot < snapshot.pageSize; slot += 1) {
            const wordActive = (page.activeWords[slot >>> 5] & (1 << (slot & 31))) !== 0;
            if (wordActive !== activeSlots.has(slot)) fail(`${path}.activeWords`, 'does not match packet occupancy');
        }
        const unusedBits = activeWordCount * 32 - snapshot.pageSize;
        if (unusedBits > 0) {
            const validBits = 32 - unusedBits;
            const validMask = validBits === 32 ? 0xffffffff : (2 ** validBits) - 1;
            if ((page.activeWords[activeWordCount - 1] & ~validMask) !== 0) {
                fail(`${path}.activeWords`, 'sets bits beyond the page boundary');
            }
        }
    });
    return snapshot;
}

export class MatterPacketPageStore {
    #pageSize;
    #maxPages;
    #pages = [];
    #activeCount = 0;

    constructor({ pageSize = 256, maxPages = 16 } = {}) {
        this.#pageSize = positiveInteger(pageSize, '$.pageSize', MAX_PAGE_SIZE);
        this.#maxPages = positiveInteger(maxPages, '$.maxPages', MAX_PAGES);
        if (!Number.isSafeInteger(this.#pageSize * this.#maxPages)) {
            fail('$', 'maximum slot capacity exceeds the safe integer range');
        }
    }

    get pageSize() { return this.#pageSize; }
    get maxPages() { return this.#maxPages; }
    get allocatedPages() { return this.#pages.length; }
    get activeCount() { return this.#activeCount; }
    get allocatedSlotCapacity() { return this.#pages.length * this.#pageSize; }
    get maximumSlotCapacity() { return this.#maxPages * this.#pageSize; }
    get freeSlotCount() { return this.maximumSlotCapacity - this.#activeCount; }

    allocate(packetInput) {
        if (this.#activeCount >= this.maximumSlotCapacity) return null;
        let page = this.#pages.find(candidate => candidate.freeSlots.length > 0);
        if (!page) {
            if (this.#pages.length >= this.#maxPages) return null;
            page = createPage(this.#pages.length, this.#pageSize);
            this.#pages.push(page);
        }
        const slot = page.freeSlots[page.freeSlots.length - 1];
        const handle = createMatterPacketHandle({
            pageId: page.pageId,
            slot,
            generation: page.generations[slot],
        });
        const packet = createMatterPacketProjection({ ...packetInput, handle });
        page.freeSlots.pop();
        writeProjection(page, slot, packet);
        setActive(page, slot, true);
        this.#activeCount += 1;
        return handle;
    }

    lookup(handleInput) {
        let handle;
        try {
            handle = createMatterPacketHandle(handleInput);
        } catch (error) {
            return Object.freeze({ status: 'invalid', error });
        }
        const page = this.#pages[handle.pageId];
        if (!page || handle.slot >= this.#pageSize) return Object.freeze({ status: 'stale', handle });
        if (page.generations[handle.slot] !== handle.generation || !isActive(page, handle.slot)) {
            return Object.freeze({ status: 'stale', handle });
        }
        return Object.freeze({ status: 'ok', handle, packet: readProjection(page, handle.slot) });
    }

    update(handleInput, packetInput) {
        const lookup = this.lookup(handleInput);
        if (lookup.status !== 'ok') return lookup;
        const packet = createMatterPacketProjection({
            ...packetInput,
            handle: lookup.handle,
        });
        const page = this.#pages[lookup.handle.pageId];
        writeProjection(page, lookup.handle.slot, packet);
        return Object.freeze({ status: 'ok', handle: lookup.handle, packet: readProjection(page, lookup.handle.slot) });
    }

    release(handleInput) {
        const lookup = this.lookup(handleInput);
        if (lookup.status !== 'ok') return lookup;
        const { pageId, slot } = lookup.handle;
        const page = this.#pages[pageId];
        setActive(page, slot, false);
        clearSlot(page, slot);
        page.generations[slot] = nextGeneration(page.generations[slot]);
        page.freeSlots.push(slot);
        this.#activeCount -= 1;
        return Object.freeze({ status: 'ok', handle: lookup.handle, packet: lookup.packet });
    }

    list() {
        const packets = [];
        for (const page of this.#pages) {
            for (let slot = 0; slot < this.#pageSize; slot += 1) {
                if (isActive(page, slot)) packets.push(readProjection(page, slot));
            }
        }
        return Object.freeze(packets);
    }

    snapshot() {
        const pages = this.#pages.map(page => {
            const packets = [];
            for (let slot = 0; slot < this.#pageSize; slot += 1) {
                if (isActive(page, slot)) packets.push(readProjection(page, slot));
            }
            return {
                pageId: page.pageId,
                generations: Array.from(page.generations),
                activeWords: Array.from(page.activeWords),
                freeSlots: [...page.freeSlots],
                packets,
            };
        });
        return deepFreezeJson({
            schema: MATTER_PACKET_STORE_SNAPSHOT_SCHEMA,
            schemaVersion: MATTER_PACKET_STORE_SNAPSHOT_VERSION,
            pageSize: this.#pageSize,
            maxPages: this.#maxPages,
            pages,
        }, '$.matterPacketStoreSnapshot');
    }

    restore(snapshotInput) {
        const snapshot = normalizeSnapshot(snapshotInput);
        const pages = snapshot.pages.map(pageSnapshot => {
            const page = createPage(pageSnapshot.pageId, snapshot.pageSize);
            page.generations.set(pageSnapshot.generations);
            page.activeWords.set(pageSnapshot.activeWords);
            page.freeSlots = [...pageSnapshot.freeSlots];
            for (const packet of pageSnapshot.packets) writeProjection(page, packet.handle.slot, packet);
            return page;
        });
        const activeCount = snapshot.pages.reduce((total, page) => total + page.packets.length, 0);
        this.#pageSize = snapshot.pageSize;
        this.#maxPages = snapshot.maxPages;
        this.#pages = pages;
        this.#activeCount = activeCount;
        return this;
    }

    estimatedResidentBytes() {
        let bytes = 0;
        for (const page of this.#pages) {
            for (const channel of NUMERIC_CHANNELS) bytes += page.numeric[channel].byteLength;
            bytes += page.generations.byteLength + page.activeWords.byteLength;
            for (let slot = 0; slot < this.#pageSize; slot += 1) {
                if (!isActive(page, slot)) continue;
                bytes += 2 * JSON.stringify({
                    regionId: page.regionIds[slot],
                    lineage: page.lineages[slot],
                    definitionId: page.definitionIds[slot],
                    phase: page.phases[slot],
                    componentId: page.componentIds[slot],
                    damageState: page.damageStates[slot],
                }).length;
            }
        }
        return bytes;
    }

    clear() {
        this.#pages = [];
        this.#activeCount = 0;
    }
}

export function validateMatterPacketStoreSnapshot(value) {
    normalizeSnapshot(value);
    return true;
}
