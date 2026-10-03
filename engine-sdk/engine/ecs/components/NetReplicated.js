// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from './ComponentRegistry.js';
import {
    REPLICATION_AUTHORITY,
    getReplicationProfile,
    resolveReplicationProfile,
} from '../replication/ReplicationProfiles.js';

const defaults = Object.freeze({
    netId: null,
    channel: 'reliable',
    interestMask: 0xffffffff,
    dirtyFlags: 0,
    profile: 'reliable-state',
    authority: REPLICATION_AUTHORITY.HOST,
    authorityId: null,
    stateChannelId: null,
    strategy: 'state',
    projection: 'merge-patch',
    cadenceHz: 20,
    interpolationMs: 100,
    priority: 0,
    transport: 'particle-signal',
});

function normalize(input) {
    const source = input && typeof input === 'object' ? input : {};
    const profileName = getReplicationProfile(source.profile) ? source.profile : defaults.profile;
    const profile = resolveReplicationProfile(profileName);
    return {
        netId: source.netId == null ? null : String(source.netId),
        channel: source.channel === 'unreliable' ? 'unreliable' : profile.channel,
        interestMask: unsigned(source.interestMask, defaults.interestMask),
        dirtyFlags: unsigned(source.dirtyFlags, defaults.dirtyFlags),
        profile: profileName,
        authority: validAuthority(source.authority) ? source.authority : profile.authority,
        authorityId: source.authorityId == null ? null : String(source.authorityId),
        stateChannelId: source.stateChannelId == null ? null : String(source.stateChannelId),
        strategy: profile.strategy,
        projection: profile.projection,
        cadenceHz: bounded(source.cadenceHz, 0, 240, profile.cadenceHz),
        interpolationMs: bounded(source.interpolationMs, 0, 2000, profile.interpolationMs),
        priority: bounded(source.priority, -100, 100, profile.priority),
        transport: profile.transport,
    };
}

function validate(value) {
    return normalize(value);
}

export const NetReplicatedDefinition = defineComponentType({
    name: 'NetReplicated',
    version: 2,
    defaults,
    normalize,
    validate,
    migrate(data) {
        return normalize(data);
    },
});

export function createNetReplicated(initial) {
    return NetReplicatedDefinition.create(initial);
}

function unsigned(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number >>> 0 : fallback;
}

function bounded(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function validAuthority(value) {
    return Object.values(REPLICATION_AUTHORITY).includes(value);
}
