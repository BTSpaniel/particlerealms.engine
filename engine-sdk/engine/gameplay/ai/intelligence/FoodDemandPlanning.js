// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** A25 supply policy over an authoritative owner's detached snapshot.
 * This module proposes quantities. It never consumes seed or creates inventory.
 * The owner must compare snapshotRevision and reserve the commitment atomically
 * with planting; two proposals from the same snapshot cannot both be accepted.
 */
export const FOOD_DEMAND_FORMAT = 'particle-food-demand-v1';
export const FOOD_DEMAND_DEFAULTS = Object.freeze({
    enabled: true, coverageDays: 2, bufferUnits: 4, publicStockCeiling: 24,
    headroom: 12, maximumDelayMinutes: 1440, maximumYield: 7,
});

function count(value, name, maximum = 1_000_000) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new TypeError(`${name} must be a bounded nonnegative integer`);
    return value;
}
function identifier(value, name) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,159}$/.test(value)) throw new TypeError(`${name} requires an identifier`);
    return value;
}
function rows(value, name, max = 100_000) {
    if (!Array.isArray(value) || value.length > max) throw new TypeError(`${name} must be a bounded array`);
    return value;
}
function unique(values, name) {
    const seen = new Set();
    for (const value of values) {
        const id = identifier(value?.id, `${name}.id`);
        if (seen.has(id)) throw new TypeError(`${name} contains duplicate identities`);
        seen.add(id);
    }
    return seen;
}

export function normalizeFoodDemandPolicy(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some(key => !Object.hasOwn(FOOD_DEMAND_DEFAULTS, key))) throw new TypeError('Unsupported demand policy field');
    const policy = { ...FOOD_DEMAND_DEFAULTS, ...input };
    if (typeof policy.enabled !== 'boolean') throw new TypeError('Demand enabled must be boolean');
    for (const key of Object.keys(policy)) if (key !== 'enabled') count(policy[key], key);
    if (policy.maximumYield < 1) throw new RangeError('A crop must retain at least one grower meal');
    return Object.freeze(policy);
}

/**
 * Required snapshot: revision, minute, objectCount, objectLimit, residents,
 * sellers, food, reservations and commitments. Food is item identity based,
 * not stacks. Each seller declares its authorized public siteIds. The caller
 * owns the snapshot: this calculation is not an NPC perception provider.
 */
export function planFoodDemand(snapshot, inputPolicy = {}) {
    const policy = normalizeFoodDemandPolicy(inputPolicy);
    if (!snapshot || typeof snapshot !== 'object') throw new TypeError('Food demand requires an owner snapshot');
    const revision = count(snapshot.revision, 'revision', Number.MAX_SAFE_INTEGER);
    const minute = count(snapshot.minute, 'minute', Number.MAX_SAFE_INTEGER - 3_000_000);
    const objectCount = count(snapshot.objectCount, 'objectCount');
    const objectLimit = count(snapshot.objectLimit, 'objectLimit');
    const residents = rows(snapshot.residents, 'residents');
    const sellers = rows(snapshot.sellers, 'sellers');
    const food = rows(snapshot.food, 'food');
    const reservations = rows(snapshot.reservations, 'reservations');
    const commitments = rows(snapshot.commitments, 'commitments');
    unique(residents, 'residents'); unique(sellers, 'sellers'); unique(food, 'food'); unique(commitments, 'commitments');
    if (food.length > objectCount) throw new RangeError('Food identities exceed authoritative object count');
    const sellerSites = new Map(sellers.map(seller => [seller.id,
        new Set(rows(seller.siteIds, 'seller.siteIds').map(id => identifier(id, 'seller.siteId')))]));
    const reserved = new Set();
    for (const reservation of reservations) {
        if (!['reserved', 'settled', 'cancelled', 'expired'].includes(reservation?.status)) throw new TypeError('Unknown reservation state');
        for (const id of rows(reservation.itemIds, 'reservation.itemIds')) {
            identifier(id, 'reservation.itemId');
            if (reservation.status === 'reserved') reserved.add(id);
        }
    }
    let publicStock = 0;
    for (const item of food) {
        if (item.privateTo || item.containerId || item.carriedBy || reserved.has(item.id)) continue;
        if (item.need !== 'hunger' || item.relief !== 50 || item.saleAllowed !== true) continue;
        if (sellerSites.get(item.ownerId)?.has(item.siteId)) publicStock += 1;
    }
    let incomingPublic = 0, overduePublic = 0, reservedCreationSlots = 0;
    const growingFarms = new Set();
    for (const commitment of commitments) {
        if (!['growing', 'harvested'].includes(commitment.phase)) throw new TypeError('Unknown crop commitment phase');
        const units = count(commitment.units, 'commitment.units');
        if (units < 1 || commitment.publicUnits !== units - 1) throw new TypeError('Commitment must retain exactly one grower meal');
        const at = count(commitment.atMinute, 'commitment.atMinute', minute);
        const growMinutes = count(commitment.growMinutes, 'commitment.growMinutes');
        const farmId = identifier(commitment.farmId, 'commitment.farmId');
        if (commitment.phase === 'growing') {
            if (growingFarms.has(farmId)) throw new TypeError('Farm has duplicate growing commitments');
            growingFarms.add(farmId);
            reservedCreationSlots += units + 1;
        }
        if (minute <= at + growMinutes + policy.maximumDelayMinutes) incomingPublic += commitment.publicUnits;
        else overduePublic += commitment.publicUnits;
    }
    const customers = residents.filter(resident => {
        if (typeof resident.role !== 'string' || !resident.role.length) throw new TypeError('Resident role is required');
        return resident.role !== 'farmer';
    }).length;
    const target = Math.min(customers * policy.coverageDays + policy.bufferUnits, policy.publicStockCeiling);
    const gap = Math.max(0, target - publicStock - incomingPublic);
    const creationRoom = Math.max(0, objectLimit - objectCount - reservedCreationSlots - policy.headroom);
    const nextBatchUnits = Math.min(policy.maximumYield, policy.enabled ? 1 + gap : policy.maximumYield,
        Math.max(0, creationRoom - 1));
    return Object.freeze({ format: FOOD_DEMAND_FORMAT, snapshotRevision: revision, minute,
        customers, target, publicStock, incomingPublic, overduePublic, gap, reservedCreationSlots,
        creationRoom, nextBatchUnits, nextPublicUnits: Math.max(0, nextBatchUnits - 1),
        status: nextBatchUnits > 0 ? 'proposed' : 'capacity-unavailable', grantsAuthority: false });
}

/** Capture accepted quantity inputs for owner-side admission, never a receipt. */
export function proposePlanting({ snapshot, policy, actorId, farmId, basketId, intentId, growMinutes }) {
    for (const [key, value] of Object.entries({ actorId, farmId, basketId, intentId })) identifier(value, key);
    count(growMinutes, 'growMinutes');
    if (!snapshot?.residents?.some(actor => actor.id === actorId && actor.role === 'farmer')) {
        throw new TypeError('Planting requires a registered grower');
    }
    const demand = planFoodDemand(snapshot, policy);
    if (snapshot.commitments.some(value => value.farmId === farmId)) {
        return Object.freeze({ status: 'existing-commitment', grantsAuthority: false });
    }
    if (demand.nextBatchUnits < 1) return demand;
    return Object.freeze({ format: 'particle-planting-proposal-v1', status: 'proposed', grantsAuthority: false,
        actorId, farmId, basketId, intentId, expectedRevision: snapshot.revision,
        commitment: Object.freeze({ id: intentId, actorId, farmId, basketId, atMinute: snapshot.minute,
            growMinutes, units: demand.nextBatchUnits, publicUnits: demand.nextPublicUnits, phase: 'growing' }) });
}
