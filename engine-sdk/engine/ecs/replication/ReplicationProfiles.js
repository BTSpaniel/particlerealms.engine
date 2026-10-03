// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const REPLICATION_AUTHORITY = Object.freeze({
    LOCAL: 'local',
    HOST: 'host',
    OWNER: 'owner',
    LEASE: 'lease',
});
export const REPLICATION_STRATEGY = Object.freeze({
    NONE: 'none',
    STATE: 'state',
    INTERPOLATED: 'interpolated',
    EVENT: 'event',
    CRDT: 'crdt',
    SEMANTIC: 'semantic',
});

const profiles = new Map();

export function defineReplicationProfile(name, definition, options = {}) {
    const id = String(name ?? '');
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new TypeError(`Invalid replication profile: ${id}`);
    if (profiles.has(id) && options.replace !== true) throw new Error(`Replication profile already exists: ${id}`);
    const allowedComponents = definition.allowedComponents === '*'
        ? '*'
        : Object.freeze([...(definition.allowedComponents ?? [])].map(String));
    const profile = Object.freeze({
        name: id,
        channel: definition.channel ?? 'reliable',
        authority: definition.authority ?? REPLICATION_AUTHORITY.HOST,
        strategy: definition.strategy ?? REPLICATION_STRATEGY.STATE,
        projection: definition.projection ?? 'merge-patch',
        cadenceHz: boundedNumber(definition.cadenceHz, 0, 240, 20),
        interpolationMs: boundedNumber(definition.interpolationMs, 0, 2000, 100),
        priority: boundedNumber(definition.priority, -100, 100, 0),
        transport: definition.transport ?? 'particle-signal',
        allowedComponents,
        project: typeof definition.project === 'function' ? definition.project : null,
    });
    profiles.set(id, profile);
    return profile;
}

export function getReplicationProfile(name) {
    return profiles.get(String(name)) ?? null;
}

export function listReplicationProfiles() {
    return Object.freeze([...profiles.values()]);
}

export function resolveReplicationProfile(name, overrides = {}) {
    const profile = getReplicationProfile(name);
    if (!profile) throw new RangeError(`Unknown replication profile: ${name}`);
    return Object.freeze({ ...profile, ...overrides, name: profile.name });
}

export function profileAllowsComponent(profileOrName, componentName) {
    const profile = typeof profileOrName === 'string' ? getReplicationProfile(profileOrName) : profileOrName;
    if (!profile) return false;
    return profile.allowedComponents === '*' || profile.allowedComponents.includes(String(componentName));
}

export function createReplicationProjection(netReplicated, components, context = {}) {
    const profile = resolveReplicationProfile(netReplicated.profile, netReplicated);
    const selected = {};
    for (const [name, value] of Object.entries(components ?? {})) {
        if (profileAllowsComponent(profile, name)) selected[name] = jsonClone(value);
    }
    const data = profile.project ? profile.project(selected, context) : selected;
    return Object.freeze({
        netId: netReplicated.netId,
        stateChannelId: netReplicated.stateChannelId,
        profile: profile.name,
        strategy: profile.strategy,
        projection: profile.projection,
        cadenceHz: profile.cadenceHz,
        priority: profile.priority,
        data: jsonClone(data),
    });
}

defineReplicationProfile('local-only', {
    channel: 'reliable', authority: 'local', strategy: 'none', projection: 'snapshot', cadenceHz: 0, transport: 'in-process', allowedComponents: [],
});
defineReplicationProfile('reliable-state', {
    channel: 'reliable', strategy: 'state', projection: 'merge-patch', cadenceHz: 20, transport: 'mesh', allowedComponents: '*',
});
defineReplicationProfile('interpolated-transform', {
    channel: 'unreliable', strategy: 'interpolated', projection: 'snapshot', cadenceHz: 30, interpolationMs: 100,
    transport: 'mesh', allowedComponents: ['Transform'],
});
defineReplicationProfile('semantic-event', {
    channel: 'reliable', strategy: 'event', projection: 'event', cadenceHz: 20,
    transport: 'mesh', allowedComponents: '*',
});
defineReplicationProfile('crdt-shared', {
    channel: 'reliable', authority: 'owner', strategy: 'crdt', projection: 'event', cadenceHz: 10,
    transport: 'mesh', allowedComponents: '*',
});
defineReplicationProfile('gpu-semantic', {
    channel: 'reliable', authority: 'lease', strategy: 'semantic', projection: 'event', cadenceHz: 10,
    transport: 'mesh', allowedComponents: ['Transform', 'ParticleEmitter', 'MorphField'],
});
defineReplicationProfile('ui-state-channel', {
    channel: 'reliable', strategy: 'state', projection: 'merge-patch', cadenceHz: 20,
    transport: 'sse', allowedComponents: '*',
});

function boundedNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function jsonClone(value) {
    return JSON.parse(JSON.stringify(value));
}
