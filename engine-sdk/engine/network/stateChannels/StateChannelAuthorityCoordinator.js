// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { hexToBytes } from '../../core/math/FormatMath.js';
import { computeFingerprint } from '../identity/NetworkIdentity.js';
import { makeEnvelope, PROTOCOL_VERSIONS, signEnvelope, verifyEnvelope } from '../protocol.js';

const CONTROL_TYPE = 'particle-state-channel-authority-v1';
const CONTROL_MESSAGE = Object.freeze({
    HEARTBEAT: 'STATE_AUTHORITY_HEARTBEAT',
    CHECKPOINT: 'STATE_AUTHORITY_CHECKPOINT',
    CLAIM: 'STATE_AUTHORITY_CLAIM',
});
const HEARTBEAT_MS = 2000;
const FAILOVER_MS = 7000;

function newerCheckpoint(candidate, current) {
    if (!current) return true;
    return candidate.fencingToken > current.fencingToken
        || (candidate.fencingToken === current.fencingToken && candidate.authorityEpoch > current.authorityEpoch)
        || (candidate.fencingToken === current.fencingToken && candidate.authorityEpoch === current.authorityEpoch
            && candidate.sequence > current.sequence);
}

function validCheckpoint(checkpoint, channelId) {
    if (!checkpoint || checkpoint.format !== 'particle-state-channel-checkpoint-v1'
        || checkpoint.channelId !== channelId || typeof checkpoint.authorityId !== 'string'
        || !Array.isArray(checkpoint.receipts)) return false;
    return ['revision', 'sequence', 'authorityEpoch', 'fencingToken'].every(
        field => Number.isSafeInteger(checkpoint[field]) && checkpoint[field] >= 0,
    );
}

/**
 * Browser authority lifecycle with signed heartbeats, replicated checkpoints,
 * deterministic takeover, and fencing. It never makes the discovery server an
 * authority and can be attached to any MeshStateChannelTransport.
 */
export class StateChannelAuthorityCoordinator {
    constructor({
        authority,
        transport,
        networkDriver,
        routeId,
        signer,
        nodeId,
        initialAuthorityPeerId,
        checkpointStore = null,
        eligiblePeerIds = null,
        heartbeatMs = HEARTBEAT_MS,
        failoverMs = FAILOVER_MS,
        logger = console,
    } = {}) {
        if (!authority?.checkpoint || !transport?.setAuthority || !networkDriver?.onMeshMessage) {
            throw new TypeError('State Channel authority coordinator requires authority, mesh transport, and NetworkDriver');
        }
        if (!signer?.secure || !nodeId || signer.fingerprint !== nodeId) {
            throw new Error('State Channel authority coordinator requires a secure bound device signer');
        }
        this.authority = authority;
        this.transport = transport;
        this.driver = networkDriver;
        this.routeId = String(routeId);
        this.signer = signer;
        this.nodeId = String(nodeId);
        this.channelId = authority.contract.id;
        this.currentAuthorityPeerId = String(initialAuthorityPeerId ?? nodeId);
        this.checkpointStore = checkpointStore;
        this.eligiblePeerIds = typeof eligiblePeerIds === 'function' ? eligiblePeerIds : null;
        this.heartbeatMs = Math.max(500, Number(heartbeatMs ?? HEARTBEAT_MS));
        this.failoverMs = Math.max(this.heartbeatMs * 2, Number(failoverMs ?? FAILOVER_MS));
        this.logger = logger ?? console;
        this.latestCheckpoint = null;
        this.lastHeartbeatAt = this.currentAuthorityPeerId === this.nodeId ? Date.now() : 0;
        this.controlSequence = 0;
        this.receivedControlSequences = new Map();
        this.timer = null;
        this.releaseMesh = null;
        this.releaseAuthority = null;
        this.running = false;
        this.isAuthority = false;
        this.routeAvailable = false;
    }

    async start(options = {}) {
        if (this.running) return this.status();
        this.running = true;
        if (options.startTransport !== false) await this.transport.start?.();
        const storedCheckpoint = await this.checkpointStore?.load?.(this.channelId) ?? null;
        this.latestCheckpoint = validCheckpoint(storedCheckpoint, this.channelId) ? storedCheckpoint : null;
        if (storedCheckpoint && !this.latestCheckpoint) {
            this.logger.warn?.(`[StateChannelAuthorityCoordinator][checkpoint][ignored] channel=${this.channelId} reason=invalid`);
        }
        if (this.latestCheckpoint) this.authority.restoreCheckpoint(this.latestCheckpoint);
        this.releaseAuthority = this.authority.subscribe(message => {
            if (this.isAuthority && message.kind === 'projection') void this.#publishCheckpoint();
        }, { replay: false });
        this.routeAvailable = this.#routeIsAvailable();
        if (this.routeAvailable) this.#bindMeshMessages();
        if (this.currentAuthorityPeerId === this.nodeId && this.routeAvailable) await this.#promote(false);
        else this.#demote(this.currentAuthorityPeerId);
        this.timer = setInterval(() => { void this.#tick(); }, this.heartbeatMs);
        return this.status();
    }

    status() {
        return Object.freeze({
            channelId: this.channelId,
            nodeId: this.nodeId,
            authorityPeerId: this.currentAuthorityPeerId,
            isAuthority: this.isAuthority,
            authorityEpoch: this.authority.authorityEpoch,
            fencingToken: this.authority.fencingToken,
            lastHeartbeatAt: this.lastHeartbeatAt,
            checkpointSequence: this.latestCheckpoint?.sequence ?? null,
            routeAvailable: this.routeAvailable,
        });
    }

    stop() {
        if (!this.running && !this.releaseMesh && !this.releaseAuthority) return false;
        this.running = false;
        if (this.timer != null) clearInterval(this.timer);
        this.timer = null;
        this.releaseMesh?.();
        this.releaseAuthority?.();
        this.releaseMesh = null;
        this.releaseAuthority = null;
        this.isAuthority = false;
        this.routeAvailable = false;
        this.transport.setAuthority(null);
        return true;
    }

    suspendRoute(reason = 'lifecycle') {
        if (!this.running) return false;
        if (this.isAuthority) {
            const checkpoint = this.authority.checkpoint();
            this.latestCheckpoint = checkpoint;
            void this.checkpointStore?.save?.(this.channelId, checkpoint);
        }
        this.isAuthority = false;
        this.routeAvailable = false;
        this.releaseMesh?.();
        this.releaseMesh = null;
        this.lastHeartbeatAt = Date.now();
        this.transport.setAuthority(null);
        this.logger.debug?.(`[StateChannelAuthorityCoordinator][suspend] channel=${this.channelId} reason=${reason}`);
        return true;
    }

    resumeRoute(reason = 'lifecycle') {
        if (!this.running) return false;
        this.routeAvailable = false;
        this.#bindMeshMessages();
        this.lastHeartbeatAt = Date.now();
        this.logger.debug?.(`[StateChannelAuthorityCoordinator][resume-pending] channel=${this.channelId} reason=${reason}`);
        return true;
    }

    destroy() {
        this.stop();
    }

    async #tick() {
        if (!this.running) return;
        const routeAvailable = this.#routeIsAvailable();
        if (!routeAvailable) {
            if (this.routeAvailable) {
                this.isAuthority = false;
                this.transport.setAuthority(null);
                this.lastHeartbeatAt = Date.now();
                this.logger.debug?.(`[StateChannelAuthorityCoordinator][suspend] channel=${this.channelId}`);
            }
            this.releaseMesh?.();
            this.releaseMesh = null;
            this.routeAvailable = false;
            return;
        }
        if (!this.routeAvailable) {
            this.#bindMeshMessages();
            this.routeAvailable = true;
            this.lastHeartbeatAt = Date.now();
            this.logger.debug?.(`[StateChannelAuthorityCoordinator][resume] channel=${this.channelId}`);
            return;
        }
        if (this.isAuthority) {
            await this.#broadcast(CONTROL_MESSAGE.HEARTBEAT, {
                authorityPeerId: this.nodeId,
                authorityEpoch: this.authority.authorityEpoch,
                fencingToken: this.authority.fencingToken,
            });
            this.lastHeartbeatAt = Date.now();
            return;
        }
        if (Date.now() - this.lastHeartbeatAt < this.failoverMs) return;
        const connected = this.eligiblePeerIds
            ? this.eligiblePeerIds()
            : this.driver.meshPeerIds(this.routeId);
        const candidate = [this.nodeId, ...connected].filter(Boolean).sort()[0];
        if (candidate === this.nodeId) await this.#promote(true);
    }

    #routeIsAvailable() {
        if (this.transport.destroyed || this.transport.suspended || this.transport.started === false) return false;
        if (typeof this.driver.meshStatus !== 'function') return true;
        return this.driver.meshStatus(this.routeId) != null;
    }

    #bindMeshMessages() {
        if (this.releaseMesh) return;
        this.releaseMesh = this.driver.onMeshMessage(this.routeId, (peerId, message) => {
            if (message?.type !== CONTROL_TYPE || message?.channelId !== this.channelId) return false;
            void this.#receiveControl(peerId, message);
            return true;
        });
    }

    async #promote(failover) {
        if (failover) {
            if (this.latestCheckpoint) this.authority.restoreCheckpoint(this.latestCheckpoint);
            const nextFence = Math.max(this.authority.fencingToken, this.latestCheckpoint?.fencingToken ?? 0) + 1;
            this.authority.transferAuthority({ authorityId: this.nodeId, fencingToken: nextFence });
        }
        this.currentAuthorityPeerId = this.nodeId;
        this.isAuthority = true;
        this.transport.setAuthority(this.authority);
        this.lastHeartbeatAt = Date.now();
        await this.#publishCheckpoint();
        if (failover) {
            await this.#broadcast(CONTROL_MESSAGE.CLAIM, {
                authorityPeerId: this.nodeId,
                authorityEpoch: this.authority.authorityEpoch,
                fencingToken: this.authority.fencingToken,
                checkpoint: this.latestCheckpoint,
            });
            this.logger.info?.(`[StateChannelAuthorityCoordinator][promote] channel=${this.channelId} fence=${this.authority.fencingToken}`);
        }
    }

    #demote(authorityPeerId) {
        this.currentAuthorityPeerId = String(authorityPeerId);
        this.isAuthority = false;
        this.transport.setAuthority(null);
        this.transport.setAuthorityPeerId(this.currentAuthorityPeerId);
    }

    async #publishCheckpoint() {
        const checkpoint = this.authority.checkpoint();
        this.latestCheckpoint = checkpoint;
        await this.checkpointStore?.save?.(this.channelId, checkpoint);
        await this.#broadcast(CONTROL_MESSAGE.CHECKPOINT, { checkpoint });
    }

    async #broadcast(kind, payload) {
        const signed = await signEnvelope(makeEnvelope({
            protocol: PROTOCOL_VERSIONS.NODE,
            type: kind,
            payload: {
                channelId: this.channelId,
                nodeId: this.nodeId,
                controlSequence: ++this.controlSequence,
                ...payload,
            },
        }), this.signer);
        this.driver.broadcastMeshMessage(this.routeId, {
            type: CONTROL_TYPE,
            channelId: this.channelId,
            signed,
        });
    }

    async #receiveControl(peerId, envelope) {
        const signed = envelope.signed;
        if (!(await this.#verifyControl(peerId, signed))) return;
        const { type, payload } = signed;
        if (type === CONTROL_MESSAGE.CHECKPOINT) {
            const checkpoint = payload.checkpoint;
            if (validCheckpoint(checkpoint, this.channelId) && newerCheckpoint(checkpoint, this.latestCheckpoint)) {
                this.latestCheckpoint = checkpoint;
                await this.checkpointStore?.save?.(this.channelId, checkpoint);
            }
            return;
        }
        if (type !== CONTROL_MESSAGE.HEARTBEAT && type !== CONTROL_MESSAGE.CLAIM) return;
        const incomingFence = Number(payload.fencingToken);
        const localFence = Number(this.authority.fencingToken);
        const wins = Number.isSafeInteger(incomingFence)
            && (incomingFence > localFence
                || (incomingFence === localFence && String(payload.authorityPeerId) < this.currentAuthorityPeerId));
        if (!wins && payload.authorityPeerId !== this.currentAuthorityPeerId) return;
        if (validCheckpoint(payload.checkpoint, this.channelId) && newerCheckpoint(payload.checkpoint, this.latestCheckpoint)) {
            this.latestCheckpoint = payload.checkpoint;
            await this.checkpointStore?.save?.(this.channelId, payload.checkpoint);
        }
        if (payload.authorityPeerId !== this.nodeId) this.#demote(payload.authorityPeerId);
        this.lastHeartbeatAt = Date.now();
    }

    async #verifyControl(peerId, signed) {
        try {
            const controlSequence = signed?.payload?.controlSequence;
            const previousControl = this.receivedControlSequences.get(peerId);
            const controlIsNewer = !previousControl
                || signed?.issuedAt > previousControl.issuedAt
                || (signed?.issuedAt === previousControl.issuedAt && controlSequence > previousControl.sequence);
            if (!signed || signed.protocol !== PROTOCOL_VERSIONS.NODE
                || !Object.values(CONTROL_MESSAGE).includes(signed.type)
                || signed.payload?.channelId !== this.channelId
                || signed.payload?.nodeId !== peerId
                || signed.signerFingerprint !== peerId
                || !Number.isSafeInteger(controlSequence)
                || !Number.isSafeInteger(signed.issuedAt)
                || !controlIsNewer
                || ((signed.type === CONTROL_MESSAGE.HEARTBEAT || signed.type === CONTROL_MESSAGE.CLAIM)
                    && signed.payload?.authorityPeerId !== peerId)) return false;
            if (Date.now() - signed.issuedAt > this.failoverMs * 2 || signed.issuedAt > Date.now() + 30_000) return false;
            const fingerprint = await computeFingerprint(hexToBytes(signed.signerPublicKeyHex));
            if (fingerprint !== peerId || !(await verifyEnvelope(signed))) return false;
            const verifiedPrevious = this.receivedControlSequences.get(peerId);
            if (verifiedPrevious && signed.issuedAt < verifiedPrevious.issuedAt) return false;
            if (verifiedPrevious && signed.issuedAt === verifiedPrevious.issuedAt
                && controlSequence <= verifiedPrevious.sequence) return false;
            this.receivedControlSequences.set(peerId, { issuedAt: signed.issuedAt, sequence: controlSequence });
            return true;
        } catch (_) {
            return false;
        }
    }
}
