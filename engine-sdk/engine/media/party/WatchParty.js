// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createSigner } from '../../state/authority/Identity.js';
import { acquireParticleNetworkDaemon } from '../../network/daemon/ParticleNetworkDaemonRegistry.js';
import { particleIceConfigurationReport } from '../../network/daemon/ParticleNetworkDaemon.js';
import { defaultParticleMasterServers, loadParticleMasterServers } from '../../network/routes/MasterServerList.js';
import { sha256Hex } from '../../network/crypto/Trust.js';
import { PartyPeer } from './PartyPeer.js';
import { requirePartyCrypto, randomPartyId, createPartyInvite, parsePartyInvite, derivePartyInvite, hostFingerprint, partyInviteURL, makeJoinProof, verifyJoinProof, fromHex, toHex } from './Invite.js';
import { PARTY_PROTOCOL, MAX_GUESTS, MAX_PACKET_BYTES, boundedText, validKey, validId, safeInteger, normalizeHostState, normalizePacketMeta, normalizeSignal, signPartyEnvelope, verifyPartyEnvelope } from './Protocol.js';

const INVITE_TTL_MS = 24 * 60 * 60_000;
const MAX_INVITE_TTL_MS = 24 * 60 * 60_000;
const MEMBER_TTL_MS = 24 * 60 * 60_000;
const DIRECT_ICE = [ { urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' } ];

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function partyError(code, message) { return Object.assign(new Error(message), { code }); }

function nameOf(value) {
    if (!boundedText(value || 'Guest', 64)) throw new TypeError('Watch Party names must be at most 64 UTF-8 bytes');
    return value || 'Guest';
}

function selectServer(options) {
    const server = options.server || loadParticleMasterServers().find(candidate => candidate.enabled !== false
        && candidate.trust === 'pinned_particle_v2' && candidate.allowLegacyV1 !== true) || defaultParticleMasterServers()[0];
    const pins = server.serverKeyPins?.length ? server.serverKeyPins : [server.serverKeyPin];
    if (!server.url || server.allowLegacyV1 === true || !pins.every(pin => typeof (pin?.pin ?? pin) === 'string' && /^[0-9a-f]{64}$/i.test(pin?.pin ?? pin))) {
        throw partyError('UNPINNED_SERVER', 'Watch Party requires a pinned Particle V2 rendezvous');
    }
    return server;
}

/** Browser-only service; supplied daemonFactory is a transport integration/test seam. */
export function createWatchParty(options = {}) { return new WatchParty(options); }

export class WatchParty {
    constructor(options = {}) {
        this.options = options;
        this.displayName = nameOf(options.displayName);
        this.role = null;
        this.status = 'idle';
        this.partyId = null;
        this.identity = null;
        this.hostKey = null;
        this._listeners = new Map();
        this._peers = new Map();
        this._ownedRoutes = new Set();
        this._members = [];
        this._generation = 0;
        this._seq = 0;
        this._revision = 0;
        this._seen = new Map();
        this._blocked = new Set();
        this._inbound = Promise.resolve();
        this._outbound = Promise.resolve();
        this._pendingInbound = 0;
        this._discoverRate = new Map();
        this._admissionChallenges = new Map();
        this._packetSequences = new Map();
        this._pendingPackets = new Map();
        this._stream = null;
        this._hostState = null;
        this._invite = null;
        this._descriptor = null;
        this._lease = null;
        this._daemon = null;
        this._timer = null;
        this._joinWait = null;
        this._joinNonce = null;
        this._lastJoinAt = 0;
        this._lastDiscoverAt = 0;
        this._lastStateAt = 0;
        this._lastKeyRequestAt = 0;
        this._iceServers = DIRECT_ICE.map(server => ({ ...server }));
        this._iceStamp = '';
        this._clockOffset = 0;
        this._rotationQueue = Promise.resolve();
    }

    get members() { return this._members.map(member => ({ ...member })); }
    get state() { return this._hostState ? normalizeHostState(this._hostState) : null; }

    on(type, callback) {
        if (typeof callback !== 'function') throw new TypeError('An event callback is required');
        let listeners = this._listeners.get(type);
        if (!listeners) this._listeners.set(type, listeners = new Set());
        listeners.add(callback);
        return () => listeners.delete(callback);
    }

    _emit(type, data) {
        for (const callback of this._listeners.get(type) || []) {
            try { callback(data); } catch (error) { console.warn('[WatchParty] event callback failed', type, error); }
        }
    }

    _setStatus(status, reason) {
        this.status = status;
        console.debug('[WatchParty] status', status, this.role, reason || '');
        this._emit('status', { status, role: this.role, partyId: this.partyId, ...(reason ? { reason } : {}) });
    }

    _report(error) {
        if (error?.code === 'CANCELLED' && !this.role) return;
        const code = error?.code || 'PARTY_ERROR';
        console.warn('[WatchParty]', code, error?.message || String(error));
        this._emit('error', { code, message: error?.message || String(error) });
    }

    _checkGeneration(generation) {
        if (this._generation !== generation || !this.role) throw partyError('CANCELLED', 'Watch Party session ended');
    }

    async _initialize(role) {
        requirePartyCrypto();
        if (this.role || !['idle', 'ended', 'error'].includes(this.status)) throw partyError('ACTIVE_PARTY', 'End the current party before starting another');
        if (typeof RTCPeerConnection !== 'function') throw partyError('NO_WEBRTC', 'This browser does not support WebRTC');
        const generation = ++this._generation;
        this.role = role;
        this._setStatus('connecting');
        this._seen.clear();
        this._blocked.clear();
        this._packetSequences.clear();
        this._seq = this._revision = 0;
        this._lastJoinAt = this._lastStateAt = this._lastDiscoverAt = this._lastKeyRequestAt = 0;
        const identity = this.options.identity || await createSigner(`watchparty:${randomPartyId()}`, { persistent: false, requireSecure: true });
        this._checkGeneration(generation);
        this.identity = identity;
        if (!this.identity.secure || !validKey(this.identity.publicKeyHex) || typeof this.identity.signRaw !== 'function') {
            throw partyError('INSECURE_IDENTITY', 'Watch Party requires a secure ECDSA signing identity');
        }
        this._selfId = await sha256Hex(fromHex(this.identity.publicKeyHex, 65));
        this._checkGeneration(generation);
        const acquire = this.options.daemonFactory || acquireParticleNetworkDaemon;
        this._lease = acquire({ server: selectServer(this.options), deviceSigner: this.identity, preferV3: false,
            onEvent: event => { if (this._generation === generation) this._daemonEvent(event); } });
        this._daemon = this._lease.daemon;
        if (!this._daemon || typeof this._daemon.signalToSession !== 'function') throw new TypeError('Party rendezvous requires authenticated session-directed signaling');
        const initiallyConnected = this._daemon.getState().state === 'connected';
        this._networkWait = deferred();
        if (initiallyConnected) this._networkWait.resolve();
        const deadline = setTimeout(() => this._networkWait?.reject(partyError('RENDEZVOUS_TIMEOUT', 'The pinned rendezvous did not connect')), 30_000);
        try { await this._networkWait.promise; }
        finally { clearTimeout(deadline); this._networkWait = null; }
        this._checkGeneration(generation);
        await this._refreshIce(false);
        this._checkGeneration(generation);
        this._timer = setInterval(() => void this._tick().catch(error => this._report(error)), 1500);
        return generation;
    }

    async create() {
        this._assertIdle();
        try {
            const generation = await this._initialize('host');
            this.partyId = randomPartyId();
            this.hostKey = this.identity.publicKeyHex;
            this._members = [{ id: this._selfId, displayName: this.displayName, role: 'host', connected: true }];
            this._hostState = normalizeHostState({ sourceRevision: 0, itemId: '', source: { kind: 'file', title: '' }, mode: 'restream', position: 0, paused: true, rate: 1, clock: Date.now() });
            const invite = await this.rotateInvite();
            this._checkGeneration(generation);
            this._setStatus('hosting');
            this._memberEvent('created', this._selfId);
            return { partyId: this.partyId, ...invite };
        } catch (error) { await this._failedStart(error); throw error; }
    }

    async join(value) {
        this._assertIdle();
        const parsed = parsePartyInvite(value);
        try {
            const generation = await this._initialize('guest');
            this._invite = await derivePartyInvite(parsed);
            this._checkGeneration(generation);
            this._joinNonce = randomPartyId();
            await this._attachRoute(this._invite.routeSecret);
            this._checkGeneration(generation);
            this._joinWait = deferred();
            this._daemon.discover(this._invite.routeTag);
            this._setStatus('joining');
            await this._discover();
            const deadline = setTimeout(() => this._joinWait?.reject(partyError('JOIN_TIMEOUT', 'The host did not admit this invitation')), 45_000);
            try { await this._joinWait.promise; }
            finally { clearTimeout(deadline); this._joinWait = null; }
            this._checkGeneration(generation);
            return { partyId: this.partyId, members: this.members };
        } catch (error) { await this._failedStart(error); throw error; }
    }

    async _failedStart(error) {
        if (error?.code === 'CANCELLED' && !this.role) return;
        this._report(error);
        await this._cleanup();
        this._setStatus('error', error.code || 'PARTY_ERROR');
    }

    async createInvite() {
        this._requireHost();
        if (!this._invite || this._invite.expiresAt <= Date.now()) return this.rotateInvite();
        return this._publicInvite();
    }

    _publicInvite() {
        return { code: this._invite.code, url: partyInviteURL(this._invite.code, this.options.inviteBaseURL || globalThis.location.href), expiresAt: this._invite.expiresAt };
    }

    async rotateInvite() {
        this._requireHost();
        const generation = this._generation;
        this._rotationQueue = this._rotationQueue.catch(() => {}).then(() => {
            this._checkGeneration(generation);
            return this._rotateInvite();
        });
        return this._rotationQueue;
    }

    async _rotateInvite() {
        this._requireHost();
        const generation = this._generation;
        const old = this._invite;
        const ttl = this.options.inviteTtlMs ?? INVITE_TTL_MS;
        if (!safeInteger(ttl, MAX_INVITE_TTL_MS) || ttl < 60_000) throw new TypeError('Invitation TTL must be between one minute and 24 hours');
        const next = await derivePartyInvite(await createPartyInvite(this.hostKey));
        this._checkGeneration(generation);
        await this._attachRoute(next.routeSecret);
        this._checkGeneration(generation);
        this._invite = { ...next, expiresAt: Date.now() + ttl };
        this._daemon.discover(next.routeTag);
        if (old) this._detachRoute(old.routeTag);
        this._discoverRate.clear();
        this._admissionChallenges.clear();
        console.debug('[WatchParty] invitation rotated', this.partyId);
        const invite = this._publicInvite();
        this._emit('invite', invite);
        return invite;
    }

    _requireHost() {
        if (this.role !== 'host' || !this._daemon || !this.partyId) throw partyError('HOST_REQUIRED', 'Only the party host can perform this operation');
    }

    _assertIdle() {
        if (this.role || !['idle', 'ended', 'error'].includes(this.status)) throw partyError('ACTIVE_PARTY', 'End the current party before starting another');
    }

    async _attachRoute(secret) {
        const daemon = this._daemon, generation = this._generation;
        const route = await daemon.attachRoute(secret);
        if (generation !== this._generation || !this.role) {
            daemon.detachRoute(route.routeTag);
            throw partyError('CANCELLED', 'Watch Party session ended');
        }
        this._ownedRoutes.add(route.routeTag);
        return route;
    }

    _detachRoute(routeTag) {
        this._daemon?.detachRoute(routeTag);
        this._ownedRoutes.delete(routeTag);
    }

    _memberEvent(action, id) { this._emit('member', { action, id, members: this.members }); }

    _daemonEvent(event) {
        if (event.type === 'connected') {
            this._networkWait?.resolve();
            if (this._invite) this._daemon?.discover(this._invite.routeTag);
            for (const peer of this._peers.values()) {
                this._daemon?.discover(peer.routeTag);
                void this._announceReady(peer).catch(error => this._report(error));
            }
            return;
        }
        if (event.type === 'integrity-error') {
            const error = partyError('RENDEZVOUS_INTEGRITY', 'Pinned rendezvous authentication failed');
            this._networkWait?.reject(error);
            this._joinWait?.reject(error);
            this._report(error);
            if (!this._networkWait && !this._joinWait) void this.end('RENDEZVOUS_INTEGRITY');
            return;
        }
        if (['turn-credentials', 'ice-configuration'].includes(event.type)) {
            const { iceServers, expiresAt, mode, relayAvailable } = event;
            void this._applyIce({ iceServers, expiresAt, mode, relayAvailable }, true).catch(error => this._report(error));
            return;
        }
        if (event.type === 'ice-restart-needed') { void this._refreshIce(true).catch(error => this._report(error)); return; }
        if (event.type === 'peers') {
            if (this.role === 'guest' && event.routeTag === this._invite?.routeTag && !this._peers.size) void this._discover().catch(error => this._report(error));
            for (const peer of this._peers.values()) if (peer.routeTag === event.routeTag) void this._announceReady(peer).catch(error => this._report(error));
            return;
        }
        if (event.type !== 'signal' || this._pendingInbound >= 64) return;
        const generation = this._generation;
        ++this._pendingInbound;
        this._inbound = this._inbound.then(async () => {
            if (generation === this._generation && this.role) await this._handleRendezvous(event);
        }).catch(error => this._report(error)).finally(() => { --this._pendingInbound; });
    }

    async _refreshIce(restart) {
        const generation = this._generation;
        const result = await this._daemon?.getTurnCredentials?.({ force: restart });
        if (result && generation === this._generation) await this._applyIce(result, restart);
    }

    async _applyIce(input, restart = false) {
        const report = particleIceConfigurationReport(input);
        if (!report.valid || report.value.expiresAt * 1000 <= Date.now()) return false;
        const stamp = JSON.stringify(report.value.iceServers);
        if (stamp === this._iceStamp) return true;
        this._iceStamp = stamp;
        this._iceServers = report.value.iceServers;
        await Promise.all([...this._peers.values()].map(peer => peer.transport.updateIce(this._iceServers, restart)));
        this._emit('network', { mode: report.value.mode, relayAvailable: report.relayAvailable, expiresAt: report.value.expiresAt });
        return true;
    }

    async _discover() {
        if (this.role !== 'guest' || !this._invite || this._peers.size || !this._daemon) return;
        if (!validId(this._joinNonce)) return;
        if (Date.now() - this._lastDiscoverAt < 1500) return;
        this._lastDiscoverAt = Date.now();
        this._daemon.discover(this._invite.routeTag);
        await this._daemon.signal(this._invite.routeTag, { from: this.identity.publicKeyHex, protocol: PARTY_PROTOCOL,
            kind: 'discover', inviteId: this._invite.inviteId, nonce: this._joinNonce });
    }

    async _handleRendezvous(event) {
        const message = event.message;
        if (!message || !validKey(event.senderIdentityKeyHex) || message.from !== event.senderIdentityKeyHex) return;
        if (message.protocol === PARTY_PROTOCOL && message.kind === 'discover') {
            if (this.role !== 'host' || event.routeTag !== this._invite?.routeTag || message.inviteId !== this._invite.inviteId
                || !validId(message.nonce) || this._invite.expiresAt <= Date.now() || this._blocked.has(event.senderIdentityKeyHex)
                || this._peers.has(event.senderIdentityKeyHex)) return;
            const now = Date.now(), previous = this._discoverRate.get(event.senderIdentityKeyHex) || 0;
            if (now - previous < 1500) return;
            if (this._discoverRate.size >= 64) this._discoverRate.delete(this._discoverRate.keys().next().value);
            this._discoverRate.set(event.senderIdentityKeyHex, now);
            await this._sendDescriptor(event.fromSessionId, event.senderIdentityKeyHex, message.nonce);
            return;
        }
        const envelope = message.envelope;
        if (!envelope || envelope.fromKey !== event.senderIdentityKeyHex || this._blocked.has(envelope.fromKey)) return;
        if (!await verifyPartyEnvelope(envelope, { partyId: this.partyId, fromKey: event.senderIdentityKeyHex, toKey: this.identity.publicKeyHex })) return;
        if (envelope.kind === 'descriptor' && this.role === 'guest' && !this._peers.size) {
            if (event.routeTag === this._invite?.routeTag) await this._acceptDescriptor(envelope, event.fromSessionId);
            return;
        }
        if (!this._acceptReplay(envelope)) return;
        if (envelope.kind === 'join' && this.role === 'host') {
            if (event.routeTag === this._invite?.routeTag) await this._admit(envelope, event.fromSessionId);
            return;
        }
        if (envelope.kind === 'grant' && this.role === 'guest' && !this._peers.size) {
            if (event.routeTag === this._invite?.routeTag) await this._acceptGrant(envelope);
            return;
        }
        if (envelope.kind === 'reject' && this.role === 'guest' && envelope.fromKey === this.hostKey && !this._peers.size) {
            this._joinWait?.reject(partyError('JOIN_REJECTED', boundedText(envelope.body?.reason, 160) ? envelope.body.reason : 'The invitation cannot join this party'));
            return;
        }
        const peer = this._peers.get(envelope.fromKey);
        if (!peer || event.routeTag !== peer.routeTag || envelope.partyId !== this.partyId) return;
        peer.sessionId = event.fromSessionId;
        await this._handleMemberEnvelope(peer, envelope);
    }

    _acceptReplay(envelope) {
        const scope = envelope.kind === 'join' ? envelope.body?.nonce : envelope.body?.admissionId;
        const key = `${envelope.partyId}:${envelope.fromKey}:${validId(scope) ? scope : 'bootstrap'}`;
        let entry = this._seen.get(key);
        if (!entry) {
            if (this._seen.size >= 64) this._seen.delete(this._seen.keys().next().value);
            this._seen.set(key, entry = { highest: -1, sequences: new Set() });
        }
        if (entry.sequences.has(envelope.seq) || envelope.seq <= entry.highest - 256) return false;
        entry.highest = Math.max(entry.highest, envelope.seq);
        entry.sequences.add(envelope.seq);
        for (const seq of entry.sequences) if (seq <= entry.highest - 256) entry.sequences.delete(seq);
        return true;
    }

    _makeEnvelope(kind, toKey, body) {
        const generation = this._generation;
        this._outbound = this._outbound.catch(() => {}).then(async () => {
            this._checkGeneration(generation);
            if (this._seq >= Number.MAX_SAFE_INTEGER) throw partyError('SEQUENCE_EXHAUSTED', 'Party message counter exhausted');
            const envelope = await signPartyEnvelope(this.identity, { kind, partyId: this.partyId, toKey, body, seq: this._seq++ });
            this._checkGeneration(generation);
            return envelope;
        });
        return this._outbound;
    }

    _challengeFor(guestKey, nonce) {
        const key = `${guestKey}:${nonce}`;
        let challenge = this._admissionChallenges.get(key);
        if (!challenge || challenge.expiresAt <= Date.now() || challenge.consumed || challenge.inviteId !== this._invite.inviteId) {
            if (this._admissionChallenges.size >= 64) this._admissionChallenges.delete(this._admissionChallenges.keys().next().value);
            challenge = { value: randomPartyId(), guestKey, nonce, inviteId: this._invite.inviteId, expiresAt: Date.now() + 90_000, consumed: false };
            this._admissionChallenges.set(key, challenge);
        }
        return challenge;
    }

    async _sendDescriptor(sessionId, guestKey, nonce) {
        const invite = this._invite;
        const challenge = this._challengeFor(guestKey, nonce);
        const body = { hostKey: this.hostKey, hostFingerprint: invite.fingerprint, inviteId: invite.inviteId, routeTag: invite.routeTag,
            guestKey, guestNonce: nonce, challenge: challenge.value, challengeExpiresAt: challenge.expiresAt,
            expiresAt: invite.expiresAt, displayName: this.displayName, maxGuests: MAX_GUESTS, sourceMode: this._hostState.mode };
        const envelope = await this._makeEnvelope('descriptor', guestKey, body);
        if (invite !== this._invite) return;
        await this._daemon.signalToSession(invite.routeTag, sessionId, { from: this.hostKey, envelope });
    }

    async _acceptDescriptor(envelope, sessionId) {
        const body = envelope.body, invite = this._invite;
        if (!body || body.hostKey !== envelope.fromKey || body.hostFingerprint !== invite.fingerprint
            || await hostFingerprint(envelope.fromKey) !== invite.fingerprint || body.inviteId !== invite.inviteId || body.routeTag !== invite.routeTag
            || body.guestKey !== this.identity.publicKeyHex || body.guestNonce !== this._joinNonce
            || !safeInteger(body.challengeExpiresAt) || body.challengeExpiresAt <= Date.now() || body.challengeExpiresAt > Date.now() + 100_000
            || !validId(body.challenge) || !safeInteger(body.expiresAt) || body.expiresAt <= Date.now() || body.expiresAt > Date.now() + MAX_INVITE_TTL_MS + 10_000
            || !boundedText(body.displayName, 64) || body.maxGuests !== MAX_GUESTS || !['restream', 'url', 'custom'].includes(body.sourceMode)) return;
        if (this.hostKey && this.hostKey !== envelope.fromKey) return;
        this.hostKey = envelope.fromKey;
        this.partyId = envelope.partyId;
        this._descriptor = body;
        if (Date.now() - this._lastJoinAt < 1500) return;
        this._lastJoinAt = Date.now();
        const claims = { partyId: this.partyId, inviteId: invite.inviteId, guestKey: this.identity.publicKeyHex, nonce: this._joinNonce, challenge: body.challenge };
        const proof = await makeJoinProof(invite, claims);
        const request = await this._makeEnvelope('join', this.hostKey, { ...claims, proof, displayName: this.displayName });
        if (this._invite !== invite || !this._daemon || this.role !== 'guest') return;
        await this._daemon.signalToSession(invite.routeTag, sessionId, { from: this.identity.publicKeyHex, envelope: request });
    }

    async _admit(envelope, sessionId) {
        const body = envelope.body, invite = this._invite;
        if (!body || !invite || body.partyId !== this.partyId || body.inviteId !== invite.inviteId || body.guestKey !== envelope.fromKey
            || !validId(body.challenge) || !validId(body.nonce) || !boundedText(body.displayName, 64) || invite.expiresAt <= Date.now()) return;
        const challenge = this._admissionChallenges.get(`${envelope.fromKey}:${body.nonce}`);
        if (!challenge || challenge.value !== body.challenge || challenge.inviteId !== invite.inviteId
            || challenge.guestKey !== envelope.fromKey || challenge.nonce !== body.nonce || challenge.expiresAt <= Date.now() || challenge.consumed) return;
        const claims = { partyId: this.partyId, inviteId: invite.inviteId, guestKey: envelope.fromKey, nonce: body.nonce, challenge: body.challenge };
        if (!await verifyJoinProof(invite, claims, body.proof)) return;
        if (invite !== this._invite || invite.expiresAt <= Date.now()) return;
        const existing = this._peers.get(envelope.fromKey);
        if (existing) return;
        if (this._peers.size >= MAX_GUESTS) {
            const reject = await this._makeEnvelope('reject', envelope.fromKey, { reason: 'This party already has five guests' });
            await this._daemon.signalToSession(invite.routeTag, sessionId, { from: this.hostKey, envelope: reject });
            return;
        }
        const generation = this._generation;
        const participantId = await sha256Hex(fromHex(envelope.fromKey, 65));
        if (invite !== this._invite || invite.expiresAt <= Date.now()) return;
        if (this._admissionChallenges.get(`${envelope.fromKey}:${body.nonce}`) !== challenge || challenge.consumed || challenge.expiresAt <= Date.now()) return;
        challenge.consumed = true;
        const routeSecret = crypto.getRandomValues(new Uint8Array(32));
        const route = await this._attachRoute(routeSecret);
        this._checkGeneration(generation);
        if (invite !== this._invite || invite.expiresAt <= Date.now()) { this._detachRoute(route.routeTag); return; }
        // Admission is processed on one serialized inbound queue; reserve before signaling.
        const peer = this._createPeer({ publicKey: envelope.fromKey, id: participantId,
            displayName: body.displayName, admissionId: randomPartyId(), routeTag: route.routeTag, routeSecret,
            joinNonce: body.nonce, inviteId: invite.inviteId, challenge: challenge.value, expiresAt: Date.now() + MEMBER_TTL_MS });
        this._members.push({ id: peer.id, displayName: peer.displayName, role: 'viewer', connected: false });
        this._memberEvent('joined', peer.id);
        this._daemon.discover(peer.routeTag);
        try {
            if (!await this._sendGrant(peer, sessionId, invite.routeTag)) {
                await this._removePeer(peer, 'admission-failed', false);
                return;
            }
        } catch (error) {
            await this._removePeer(peer, 'admission-failed', false);
            throw error;
        }
        await this._broadcastMembers();
    }

    async _sendGrant(peer, sessionId, joinRoute) {
        const body = { admissionId: peer.admissionId, inviteId: peer.inviteId, challenge: peer.challenge, guestNonce: peer.joinNonce,
            participantId: peer.id, guestKey: peer.publicKey, hostKey: this.hostKey, role: 'viewer', displayName: peer.displayName,
            memberRouteSecret: toHex(peer.routeSecret), expiresAt: peer.expiresAt, members: this.members,
            snapshot: { state: this._hostState, revision: this._revision } };
        const grant = await this._makeEnvelope('grant', peer.publicKey, body);
        if (!this._daemon || this._peers.get(peer.publicKey) !== peer) return false;
        return this._daemon.signalToSession(joinRoute, sessionId, { from: this.hostKey, envelope: grant });
    }

    async _acceptGrant(envelope) {
        const body = envelope.body, descriptor = this._descriptor;
        if (!descriptor || envelope.fromKey !== this.hostKey || !body || body.hostKey !== this.hostKey || body.guestKey !== this.identity.publicKeyHex
            || body.participantId !== this._selfId || body.role !== 'viewer' || body.guestNonce !== this._joinNonce
            || body.inviteId !== this._invite.inviteId || body.challenge !== descriptor.challenge || !validId(body.admissionId)
            || !safeInteger(body.expiresAt) || body.expiresAt <= Date.now() || body.expiresAt > Date.now() + MEMBER_TTL_MS + 10_000) return;
        const generation = this._generation;
        const hostId = await sha256Hex(fromHex(this.hostKey, 65));
        this._checkGeneration(generation);
        const routeSecret = fromHex(body.memberRouteSecret, 32);
        const route = await this._attachRoute(routeSecret);
        this._checkGeneration(generation);
        const peer = this._createPeer({ publicKey: this.hostKey, id: hostId, displayName: descriptor.displayName,
            admissionId: body.admissionId, routeTag: route.routeTag, routeSecret, expiresAt: body.expiresAt });
        this._acceptMembers(body.members);
        this._acceptState(body.snapshot);
        this._daemon.discover(peer.routeTag);
        await this._announceReady(peer);
        this._detachRoute(this._invite.routeTag);
    }

    _createPeer(details) {
        const peer = { ...details, connected: false, started: false, sessionId: null, createdAt: Date.now(), lastReadyAt: 0, queue: Promise.resolve(), pending: 0 };
        peer.transport = new PartyPeer({ host: this.role === 'host', admissionId: peer.admissionId, iceServers: this._iceServers,
            sendSignal: signal => this._sendToPeer(peer, 'signal', normalizeSignal(signal)),
            onControl: envelope => this._receiveControl(peer, envelope),
            onPacket: (bytes, meta) => this._receivePacket(peer, bytes, meta),
            onStream: stream => this._emit('stream', { stream, participantId: peer.id }),
            onStatus: event => this._peerStatus(peer, event), onError: error => this._report(error),
        });
        this._peers.set(peer.publicKey, peer);
        if (this.role === 'host' && this._stream) void peer.transport.attachStream(this._stream).catch(error => this._report(error));
        return peer;
    }

    async _announceReady(peer) {
        if (this._peers.get(peer.publicKey) !== peer || Date.now() - peer.lastReadyAt < 1500) return;
        peer.lastReadyAt = Date.now();
        const envelope = await this._makeEnvelope('ready', peer.publicKey, { admissionId: peer.admissionId });
        if (!this._daemon || this._peers.get(peer.publicKey) !== peer) return;
        await this._daemon.signal(peer.routeTag, { from: this.identity.publicKeyHex, envelope });
    }

    async _sendToPeer(peer, kind, body, rendezvousOnly = false) {
        if (this._peers.get(peer.publicKey) !== peer || !this.role) return false;
        const envelope = await this._makeEnvelope(kind, peer.publicKey, { ...body, admissionId: peer.admissionId });
        if (this._peers.get(peer.publicKey) !== peer) return false;
        const message = { from: this.identity.publicKeyHex, envelope };
        // Initial SDP must survive the daemon's bounded signaling token bucket.
        // Once SCTP opens, the same signed protocol uses its reliable channel.
        const deadline = Date.now() + (rendezvousOnly ? 1000 : 5000);
        do {
            if (this._peers.get(peer.publicKey) !== peer || !this._daemon) return false;
            if (!rendezvousOnly && peer.transport.sendControl(envelope)) return true;
            if (peer.sessionId && await this._daemon.signalToSession(peer.routeTag, peer.sessionId, message)) return true;
            if (!peer.sessionId && await this._daemon.signal(peer.routeTag, message)) return true;
            await new Promise(resolve => setTimeout(resolve, 150));
        } while (Date.now() < deadline);
        return false;
    }

    _receiveControl(peer, envelope) {
        if (this._peers.get(peer.publicKey) !== peer || peer.pending >= 32) return;
        ++peer.pending;
        peer.queue = peer.queue.then(async () => {
            if (this._peers.get(peer.publicKey) !== peer || !this.role) return;
            if (!await verifyPartyEnvelope(envelope, { partyId: this.partyId, fromKey: peer.publicKey, toKey: this.identity.publicKeyHex })
                || !this._acceptReplay(envelope)) return;
            await this._handleMemberEnvelope(peer, envelope);
        }).catch(error => this._report(error)).finally(() => { --peer.pending; });
    }

    async _handleMemberEnvelope(peer, envelope) {
        if (peer.expiresAt <= Date.now()) return;
        const body = envelope.body;
        if (body?.admissionId !== peer.admissionId) return;
        if (envelope.kind === 'ready') {
            if (body?.admissionId !== peer.admissionId) return;
            if (this.role === 'host' && !peer.started) {
                peer.started = true;
                if (this._stream) await peer.transport.attachStream(this._stream);
                await peer.transport.start();
            }
        } else if (envelope.kind === 'signal') {
            await peer.transport.acceptSignal(body);
        } else if (envelope.kind === 'state' && this.role === 'guest' && peer.publicKey === this.hostKey) {
            this._acceptState(body);
        } else if (envelope.kind === 'members' && this.role === 'guest' && peer.publicKey === this.hostKey) {
            this._acceptMembers(body?.members);
        } else if (envelope.kind === 'key-request' && this.role === 'host' && safeInteger(body?.sourceRevision)) {
            if (Date.now() - (peer.lastKeyRequestAt || 0) < 1000) return;
            peer.lastKeyRequestAt = Date.now();
            this._emit('keyrequest', { participantId: peer.id, sourceRevision: body.sourceRevision });
        } else if (envelope.kind === 'ping' && this.role === 'host' && safeInteger(body?.clock)) {
            await this._sendToPeer(peer, 'pong', { clock: body.clock, hostClock: Date.now() });
        } else if (envelope.kind === 'pong' && this.role === 'guest' && safeInteger(body?.clock) && safeInteger(body?.hostClock)) {
            const rtt = Date.now() - body.clock;
            if (rtt >= 0 && rtt < 10_000) {
                this._clockOffset = body.hostClock - (body.clock + rtt / 2);
                this._emit('clock', { offset: this._clockOffset, rtt });
            }
        } else if (envelope.kind === 'leave' && this.role === 'host') {
            await this._removePeer(peer, 'left', false);
        } else if (['end', 'removed'].includes(envelope.kind) && this.role === 'guest' && peer.publicKey === this.hostKey) {
            await this._cleanup();
            this._setStatus('ended', envelope.kind === 'removed' ? 'REMOVED' : 'HOST_ENDED');
        }
    }

    _peerStatus(peer, event) {
        if (this._peers.get(peer.publicKey) !== peer) return;
        this._emit('peer', { participantId: peer.id, ...event });
        if (event.channel === 'control' && event.state === 'open') {
            peer.connected = true;
            const member = this._members.find(item => item.id === peer.id);
            if (member) member.connected = true;
            this._memberEvent('connected', peer.id);
            if (this.role === 'host') {
                void this._broadcastMembers().catch(error => this._report(error));
                void this._sendToPeer(peer, 'state', { state: this._hostState, revision: this._revision }).catch(error => this._report(error));
                this._emit('keyrequest', { participantId: peer.id, sourceRevision: this._hostState.sourceRevision });
            } else {
                this._setStatus('joined');
                this._joinWait?.resolve();
                void this._sendToPeer(peer, 'ping', { clock: Date.now() }).catch(error => this._report(error));
                void this.requestKeyframe(this._hostState?.sourceRevision || 0).catch(error => this._report(error));
            }
        } else if (event.channel === 'control' && event.state === 'closed') {
            peer.connected = false;
            const member = this._members.find(item => item.id === peer.id);
            if (member) member.connected = false;
            this._memberEvent('disconnected', peer.id);
        }
    }

    _acceptMembers(input) {
        if (!Array.isArray(input) || input.length < 1 || input.length > MAX_GUESTS + 1) return false;
        const seen = new Set();
        const members = [];
        for (const member of input) {
            if (!member || typeof member.id !== 'string' || !/^[0-9a-f]{64}$/.test(member.id) || seen.has(member.id)
                || !boundedText(member.displayName, 64) || !['host', 'viewer'].includes(member.role) || typeof member.connected !== 'boolean') return false;
            seen.add(member.id);
            members.push({ id: member.id, displayName: member.displayName, role: member.role, connected: member.connected });
        }
        const hostId = this._peers.get(this.hostKey)?.id;
        if (members.filter(member => member.role === 'host').length !== 1
            || !members.some(member => member.id === hostId && member.role === 'host')
            || !members.some(member => member.id === this._selfId)) return false;
        this._members = members;
        this._memberEvent('snapshot', this._selfId);
        return true;
    }

    async _broadcastMembers() {
        await Promise.all([...this._peers.values()].map(peer => this._sendToPeer(peer, 'members', { members: this.members })));
    }

    _acceptState(body) {
        if (!body || !safeInteger(body.revision) || body.revision < this._revision) return false;
        const state = normalizeHostState(body.state);
        if (this._hostState && state.sourceRevision < this._hostState.sourceRevision) return false;
        const changed = this._hostState?.sourceRevision !== state.sourceRevision;
        this._revision = body.revision;
        this._hostState = state;
        this._emit('control', { state, revision: body.revision, receivedAt: Date.now(), clockOffset: this._clockOffset });
        if (changed) {
            this._packetSequences.clear();
            void this.requestKeyframe(state.sourceRevision).catch(error => this._report(error));
        }
        for (const [kind, packet] of this._pendingPackets) {
            if (packet.meta.sourceRevision <= state.sourceRevision) {
                this._pendingPackets.delete(kind);
                if (packet.meta.sourceRevision === state.sourceRevision) this._receivePacket(packet.peer, packet.bytes, packet.meta);
            }
        }
        return true;
    }

    async attachStream(stream) {
        this._requireHost();
        if (stream !== null && (!(stream instanceof MediaStream) || stream.getTracks().length > 2
            || stream.getTracks().some(track => !['audio', 'video'].includes(track.kind)))) throw new TypeError('Restream accepts one video and one audio track');
        if (stream && ['audio', 'video'].some(kind => stream.getTracks().filter(track => track.kind === kind).length > 1)) throw new TypeError('Restream accepts at most one track of each kind');
        this._stream = stream;
        await Promise.all([...this._peers.values()].map(peer => peer.transport.attachStream(stream)));
        if (this._hostState) await this.sendHostState({ ...this._hostState, clock: Date.now() });
    }

    async sendHostState(input) {
        this._requireHost();
        const state = normalizeHostState(input);
        if (this._hostState && state.sourceRevision < this._hostState.sourceRevision) throw new TypeError('Source revision cannot move backwards');
        if (this._hostState && state.sourceRevision === this._hostState.sourceRevision
            && (state.itemId !== this._hostState.itemId || state.mode !== this._hostState.mode || state.source.kind !== this._hostState.source.kind
                || state.source.url !== this._hostState.source.url)) throw new TypeError('Changing source requires a new source revision');
        if (this._revision >= Number.MAX_SAFE_INTEGER) throw new Error('Playback revision counter exhausted');
        this._hostState = state;
        const revision = ++this._revision;
        this._lastStateAt = Date.now();
        await Promise.all([...this._peers.values()].map(peer => this._sendToPeer(peer, 'state', { state, revision })));
        this._emit('control', { state, revision, receivedAt: Date.now(), clockOffset: 0 });
        return { state, revision };
    }

    publishPacket(bytes, inputMeta) {
        this._requireHost();
        const meta = normalizePacketMeta(inputMeta);
        if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_PACKET_BYTES) throw new RangeError('Custom media packet is too large or empty');
        if (meta.sourceRevision !== this._hostState?.sourceRevision) return 0;
        let sent = 0;
        for (const peer of this._peers.values()) if (peer.transport.sendPacket(bytes, meta)) ++sent;
        return sent;
    }

    _receivePacket(peer, bytes, meta) {
        if (this.role !== 'guest' || peer.publicKey !== this.hostKey || this._peers.get(peer.publicKey) !== peer) return;
        const revision = this._hostState?.sourceRevision;
        if (revision === undefined || meta.sourceRevision > revision) {
            const others = [...this._pendingPackets].reduce((sum, [kind, value]) => sum + (kind === meta.kind ? 0 : value.bytes.length), 0);
            if (others + bytes.length <= MAX_PACKET_BYTES) this._pendingPackets.set(meta.kind, { peer, bytes, meta });
            return;
        }
        if (meta.sourceRevision !== revision) return;
        const last = this._packetSequences.get(meta.kind);
        if (last !== undefined && meta.sequence <= last) return;
        this._packetSequences.set(meta.kind, meta.sequence);
        this._emit('packet', { bytes, meta });
    }

    async requestKeyframe(sourceRevision = this._hostState?.sourceRevision || 0) {
        if (this.role !== 'guest' || !safeInteger(sourceRevision) || Date.now() - this._lastKeyRequestAt < 1000) return false;
        const peer = this._peers.get(this.hostKey);
        if (!peer) return false;
        this._lastKeyRequestAt = Date.now();
        return this._sendToPeer(peer, 'key-request', { sourceRevision });
    }

    async removeParticipant(id) {
        this._requireHost();
        const peer = [...this._peers.values()].find(candidate => candidate.id === id);
        if (!peer) return false;
        await this._sendToPeer(peer, 'removed', { admissionId: peer.admissionId }, true);
        await this._removePeer(peer, 'removed');
        await this.rotateInvite();
        return true;
    }

    async _removePeer(peer, action, block = true) {
        if (this._peers.get(peer.publicKey) !== peer) return;
        if (block) {
            this._blocked.add(peer.publicKey);
            if (this._blocked.size > 256) this._blocked.delete(this._blocked.keys().next().value);
        }
        this._peers.delete(peer.publicKey);
        peer.transport.close();
        this._detachRoute(peer.routeTag);
        this._members = this._members.filter(member => member.id !== peer.id);
        this._memberEvent(action, peer.id);
        await this._broadcastMembers();
    }

    async _tick() {
        if (!this.role || !this._daemon) return;
        if (this.role === 'guest' && !this._peers.size) { await this._discover(); return; }
        for (const peer of [...this._peers.values()]) {
            if (peer.expiresAt <= Date.now() || (!peer.connected && Date.now() - peer.createdAt > 45_000)) {
                if (this.role === 'host') await this._removePeer(peer, 'expired');
                else { this._joinWait?.reject(partyError('PEER_TIMEOUT', 'The host connection could not be established')); await this.end('PEER_TIMEOUT'); return; }
            } else if (!peer.connected) await this._announceReady(peer);
        }
        if (this.role === 'host' && this._hostState && Date.now() - this._lastStateAt >= 1500) {
            const elapsed = Math.max(0, (Date.now() - this._hostState.clock) / 1000);
            await this.sendHostState({ ...this._hostState, position: this._hostState.position + (this._hostState.paused ? 0 : elapsed * this._hostState.rate), clock: Date.now() });
        }
    }

    async end(reason = 'ENDED') {
        if (!this.role) { this._setStatus('ended', reason); return; }
        const kind = this.role === 'host' ? 'end' : 'leave';
        await Promise.allSettled([...this._peers.values()].map(peer => this._sendToPeer(peer, kind, {}, true)));
        this._joinWait?.reject(partyError('CANCELLED', 'Watch Party session ended'));
        await this._cleanup();
        this._setStatus('ended', reason);
    }

    async _cleanup() {
        ++this._generation;
        this._networkWait?.reject(partyError('CANCELLED', 'Watch Party session ended'));
        this._networkWait = null;
        clearInterval(this._timer);
        this._timer = null;
        for (const peer of this._peers.values()) peer.transport.close();
        this._peers.clear();
        for (const routeTag of this._ownedRoutes) this._daemon?.detachRoute(routeTag);
        this._ownedRoutes.clear();
        this._lease?.release();
        this._lease = this._daemon = null;
        this._pendingPackets.clear();
        this._seen.clear();
        this._discoverRate.clear();
        this._admissionChallenges.clear();
        this._blocked.clear();
        this._members = [];
        this._stream = this._invite = this._descriptor = this._hostState = null;
        this.identity = this.hostKey = this.partyId = null;
        this.role = null;
    }
}
