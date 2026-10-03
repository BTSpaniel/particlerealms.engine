// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createSigner } from '../../../state/authority/Identity.js';
import { createWatchParty } from '../WatchParty.js';
import { createPartyInvite, parsePartyInvite, derivePartyInvite, hostFingerprint, partyInviteURL, makeJoinProof, verifyJoinProof, fromHex } from '../Invite.js';
import { normalizeHostState, normalizePacketMeta, signPartyEnvelope, verifyPartyEnvelope, normalizeSignal } from '../Protocol.js';
import { deriveOpaqueRoute } from '../../../network/crypto/OpaqueRoute.js';
import { sha256Hex } from '../../../network/crypto/Trust.js';
import { ParticleNetworkDaemon } from '../../../network/daemon/ParticleNetworkDaemon.js';
import { generateHpkeKeyPair } from '../../../network/crypto/Hpke.js';

const results = [];
function assert(condition, message) { if (!condition) throw new Error(message); }
async function check(name, callback) {
    try { await callback(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.stack || error.message }); }
    document.querySelector('#results').textContent = results.map(item => `${item.passed ? 'PASS' : 'FAIL'} ${item.name}${item.error ? '\n' + item.error : ''}`).join('\n');
}
async function rejects(callback, message) {
    let rejected = false;
    try { await callback(); } catch (_) { rejected = true; }
    assert(rejected, message);
}
async function waitFor(predicate, message, timeout = 12_000) {
    const deadline = performance.now() + timeout;
    while (!predicate()) {
        if (performance.now() > deadline) throw new Error(message);
        await new Promise(resolve => setTimeout(resolve, 30));
    }
}

// In-process authenticated rendezvous substitutes only server networking.
// Peer connections, RTP, SCTP, Web Crypto and signature checks remain native.
function rendezvous() {
    const sessions = new Map(), routes = new Map();
    let counter = 0;
    function notify(tag) {
        const entries = [...(routes.get(tag) || [])];
        for (const session of entries) queueMicrotask(() => session.emit({ type: 'peers', routeTag: tag,
            peers: entries.filter(peer => peer !== session).map(peer => ({ sessionId: peer.id })) }));
    }
    function deliver(sender, receiver, tag, message) {
        const copy = structuredClone(message);
        queueMicrotask(() => { if (!receiver.released) receiver.emit({ type: 'signal', routeTag: tag, fromSessionId: sender.id,
            senderIdentityKeyHex: sender.key, senderKeyId: '', message: copy }); });
        return true;
    }
    const factory = ({ deviceSigner, onEvent }) => {
        const session = { id: `local-${++counter}`, key: deviceSigner.publicKeyHex, tags: new Set(), emit: onEvent, released: false };
        sessions.set(session.id, session);
        const daemon = {
            getState: () => ({ state: 'connected', sessionId: session.id }),
            async attachRoute(secret) {
                const route = await deriveOpaqueRoute({ routeSecret: secret });
                session.tags.add(route.routeTag);
                let members = routes.get(route.routeTag);
                if (!members) routes.set(route.routeTag, members = new Set());
                members.add(session);
                notify(route.routeTag);
                return route;
            },
            detachRoute(tag) {
                session.tags.delete(tag);
                routes.get(tag)?.delete(session);
                notify(tag);
                return true;
            },
            discover(tag) { notify(tag); return true; },
            async signal(tag, message) {
                if (!session.tags.has(tag)) return false;
                let sent = false;
                for (const peer of routes.get(tag) || []) if (peer !== session) sent = deliver(session, peer, tag, message) || sent;
                return sent;
            },
            async signalToSession(tag, id, message) {
                const peer = sessions.get(id);
                return session.tags.has(tag) && peer?.tags.has(tag) ? deliver(session, peer, tag, message) : false;
            },
            async getTurnCredentials() {
                return { mode: 'direct', relayAvailable: false, expiresAt: Math.floor(Date.now() / 1000) + 3600,
                    iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] };
            },
        };
        return { daemon, release() {
            if (session.released) return;
            session.released = true;
            for (const tag of [...session.tags]) daemon.detachRoute(tag);
            sessions.delete(session.id);
        } };
    };
    return { factory, sessions, routes };
}

const hostSigner = await createSigner('party-test-host', { persistent: false, requireSecure: true });
const guestSigner = await createSigner('party-test-guest', { persistent: false, requireSecure: true });
const invite = await createPartyInvite(hostSigner.publicKeyHex);
const material = await derivePartyInvite(invite);
const partyId = 'a'.repeat(32);

await check('memory-only signer never touches IndexedDB and signs native challenges', async () => {
    const original = indexedDB.open.bind(indexedDB);
    let opens = 0;
    indexedDB.open = (...args) => { ++opens; return original(...args); };
    try {
        const signer = await createSigner('temporary-test', { persistent: false, requireSecure: true });
        const challenge = new TextEncoder().encode('party challenge');
        assert(!signer.persistent && signer.secure && opens === 0, 'Ephemeral signer accessed persisted identity storage');
        assert(await signer.verifyRaw(challenge, await signer.signRaw(challenge)), 'ECDSA sign/verify failed');
    } finally { indexedDB.open = original; }
});

await check('WP1 has exactly 52 payload characters, URL fragment, canonical trailing bits and pinned host', async () => {
    assert(invite.code.replace(/-/g, '').length === 55, 'WP1 length differs');
    assert(invite.fingerprint === await hostFingerprint(hostSigner.publicKeyHex), 'Host pin differs');
    assert(parsePartyInvite(partyInviteURL(invite.code)).code === invite.code, 'Invite URL did not round trip');
    assert(parsePartyInvite(invite.code.toLowerCase()).code === invite.code, 'Human lowercase normalization failed');
    const flat = invite.code.replace(/-/g, '');
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const index = alphabet.indexOf(flat.at(-1));
    await rejects(() => parsePartyInvite(flat.slice(0, -1) + alphabet[index | 1]), 'Unused trailing bits were accepted');
    await rejects(() => parsePartyInvite('WP1-123456'), 'Short guesses were accepted');
});

await check('HKDF separates rendezvous from admission proofs and binds claims', async () => {
    const claims = { partyId, inviteId: material.inviteId, guestKey: guestSigner.publicKeyHex, nonce: 'b'.repeat(32), challenge: 'c'.repeat(32) };
    const proof = await makeJoinProof(material, claims);
    assert(await verifyJoinProof(material, claims, proof), 'Valid invitation proof rejected');
    assert(!await verifyJoinProof(material, { ...claims, nonce: 'd'.repeat(32) }, proof), 'Proof replayed against another nonce');
    assert(material.routeSecret.length === 32 && material.routeTag.length === 64, 'Derived route has wrong size');
    assert(proof !== material.routeTag, 'Proof and route domains coincide');
});

await check('signed envelopes reject forged host, altered payload, wrong audience, expiry and oversized input', async () => {
    const envelope = await signPartyEnvelope(hostSigner, { kind: 'state', partyId, toKey: guestSigner.publicKeyHex, seq: 1, body: { value: 2 } });
    assert(await verifyPartyEnvelope(envelope, { partyId, fromKey: hostSigner.publicKeyHex, toKey: guestSigner.publicKeyHex }), 'Valid envelope failed');
    assert(!await verifyPartyEnvelope({ ...envelope, body: { value: 3 } }), 'Tampered body accepted');
    assert(!await verifyPartyEnvelope({ ...envelope, fromKey: guestSigner.publicKeyHex }), 'Host spoof accepted');
    assert(!await verifyPartyEnvelope(envelope, { toKey: hostSigner.publicKeyHex }), 'Wrong audience accepted');
    assert(!await verifyPartyEnvelope(envelope, { now: envelope.expiresAt }), 'Expired control accepted');
    assert(!await verifyPartyEnvelope({ ...envelope, unexpected: true }), 'Unknown wire fields accepted');
    await rejects(() => signPartyEnvelope(hostSigner, { kind: 'state', partyId, toKey: guestSigner.publicKeyHex, seq: 2, body: { large: 'x'.repeat(50_000) } }), 'Oversized payload accepted');
});

await check('source whitelist excludes VFS paths and blob URLs; malformed RTC and media are rejected', async () => {
    const state = normalizeHostState({ sourceRevision: 1, itemId: 'movie-1', source: { kind: 'file', title: 'Local movie', privatePath: '/home/secret', url: 'blob:secret' },
        mode: 'restream', position: 2, paused: false, rate: 1, clock: Date.now(), secret: 'ignored' });
    assert(!JSON.stringify(state).includes('secret') && !JSON.stringify(state).includes('privatePath'), 'Private source fields leaked');
    await rejects(() => normalizeHostState({ ...state, source: { kind: 'url', url: 'blob:secret' }, mode: 'url' }), 'Blob URL was shared');
    await rejects(() => normalizeHostState({ ...state, itemId: 'C:\\Secret\\movie.mp4' }), 'Private filesystem item ID accepted');
    await rejects(() => normalizePacketMeta({ kind: 'video', sourceRevision: 1, sequence: -1, timestamp: 0, keyframe: true }), 'Negative codec sequence accepted');
    await rejects(() => normalizeSignal({ channel: 'content', admissionId: 'a'.repeat(32), offerId: 1, type: 'offer', data: { type: 'offer', sdp: 'junk' } }), 'Malformed SDP accepted');
});

await check('daemon session-directed API HPKE verifies and exposes authenticated sender identity', async () => {
    const server = { url: 'wss://localhost/v2/ws', serverKeyPin: '0'.repeat(64) };
    let received = null;
    const a = new ParticleNetworkDaemon({ server, deviceSigner: hostSigner });
    const b = new ParticleNetworkDaemon({ server, deviceSigner: guestSigner, onEvent: event => { if (event.type === 'signal') received = event; } });
    try {
        a.hpke = await generateHpkeKeyPair(); b.hpke = await generateHpkeKeyPair();
        a.state = b.state = 'connected'; a.sessionId = 'session-a'; b.sessionId = 'session-b';
        a.ws = b.ws = { close() {} };
        const route = await a.attachRoute(material.routeSecret); await b.attachRoute(material.routeSecret);
        a.routePeers.set(route.routeTag, new Map([['session-b', { sessionId: 'session-b', encryptionKeyHex: b.hpke.publicKeyHex, keyId: await sha256Hex(b.hpke.publicKeyRaw) }]]));
        a._send = (_protocol, type, payload) => { if (type === 'SIGNAL') void b._handleEncryptedSignal(payload); return true; };
        assert(!await a.signalToSession(route.routeTag, 'unknown', { from: hostSigner.publicKeyHex }), 'Unknown session accepted');
        assert(await a.signalToSession(route.routeTag, 'session-b', { from: hostSigner.publicKeyHex, value: 'authenticated' }), 'Directed signal failed');
        await waitFor(() => received, 'Encrypted signal was not received');
        assert(received.senderIdentityKeyHex === hostSigner.publicKeyHex && received.senderKeyId === await sha256Hex(fromHex(hostSigner.publicKeyHex, 65)), 'Verified sender key was omitted');
    } finally { a.destroy(); b.destroy(); }
});

await check('negative admission rejects invalid proof, claimed key spoof, expired and rotated invites', async () => {
    const mesh = rendezvous();
    const host = createWatchParty({ daemonFactory: mesh.factory });
    try {
        await host.create();
        const current = host._invite;
        const challenge = host._challengeFor(guestSigner.publicKeyHex, 'b'.repeat(32));
        const claims = { partyId: host.partyId, inviteId: current.inviteId, guestKey: guestSigner.publicKeyHex, nonce: 'b'.repeat(32), challenge: challenge.value };
        const validBody = { ...claims, displayName: 'Negative guest', proof: await makeJoinProof(current, claims) };
        const wrap = body => signPartyEnvelope(guestSigner, { kind: 'join', partyId: host.partyId, toKey: host.hostKey, seq: 0, body });
        await host._admit(await wrap({ ...validBody, proof: '0'.repeat(64) }), 'unknown');
        assert(host.members.length === 1 && host._ownedRoutes.size === 1, 'Wrong HMAC created a reserved guest');
        await host._admit(await wrap({ ...validBody, guestKey: host.hostKey }), 'unknown');
        assert(host.members.length === 1, 'Claimed guest key was not bound to signature');
        current.expiresAt = Date.now() - 1;
        await host._admit(await wrap(validBody), 'unknown');
        assert(host.members.length === 1, 'Expired invitation admitted a new guest');
        current.expiresAt = Date.now() + 10_000;
        await host.rotateInvite();
        await host._admit(await wrap(validBody), 'unknown');
        assert(host.members.length === 1 && !host._ownedRoutes.has(current.routeTag), 'Rotated invitation admitted a new guest');
    } finally { await host.end(); }
});

await check('signed host descriptor cannot replace the WP1-pinned host key', async () => {
    const guest = createWatchParty();
    guest.role = 'guest'; guest.identity = guestSigner; guest._invite = material; guest._joinNonce = 'b'.repeat(32);
    const forged = await signPartyEnvelope(guestSigner, { kind: 'descriptor', partyId, toKey: '*', seq: 0, body: {
        hostKey: guestSigner.publicKeyHex, hostFingerprint: material.fingerprint, inviteId: material.inviteId, routeTag: material.routeTag,
        guestKey: guestSigner.publicKeyHex, guestNonce: guest._joinNonce, challengeExpiresAt: Date.now() + 90_000,
        challenge: 'c'.repeat(32), expiresAt: Date.now() + 60_000, displayName: 'Fake host', maxGuests: 5, sourceMode: 'restream',
    } });
    await guest._acceptDescriptor(forged, 'fake-host');
    assert(guest.hostKey === null && guest.partyId === null, 'A valid foreign signature replaced the pinned host');
    await guest.end();
});

await check('admission challenges bind each temporary identity and nonce and cannot create replay reservations', async () => {
    const mesh = rendezvous(); const host = createWatchParty({ daemonFactory: mesh.factory });
    try {
        await host.create();
        const nonce = 'b'.repeat(32), first = host._challengeFor(guestSigner.publicKeyHex, nonce);
        const second = host._challengeFor(hostSigner.publicKeyHex, nonce);
        const third = host._challengeFor(guestSigner.publicKeyHex, 'c'.repeat(32));
        assert(first.value !== second.value && first.value !== third.value, 'Host reused challenges across guest identities or nonces');
        const claims = { partyId: host.partyId, inviteId: host._invite.inviteId, guestKey: guestSigner.publicKeyHex, nonce, challenge: first.value };
        const body = { ...claims, proof: await makeJoinProof(host._invite, claims), displayName: 'Replay guest' };
        const request = await signPartyEnvelope(guestSigner, { kind: 'join', partyId: host.partyId, toKey: host.hostKey, seq: 0, body });
        let grants = 0; host._sendGrant = async () => { ++grants; return true; };
        await host._admit(request, 'unused-session');
        assert(first.consumed && host._peers.size === 1 && grants === 1, 'Valid challenge did not consume one reservation');
        await host._admit(request, 'unused-session');
        assert(host._peers.size === 1 && grants === 1, 'Consumed challenge replay issued another grant');
        await host._removePeer(host._peers.get(guestSigner.publicKeyHex), 'left', false);
        await host._admit(request, 'unused-session');
        assert(host._peers.size === 0, 'Consumed proof reopened a departed reservation');
    } finally { await host.end(); }
});

await check('failed or throwing grant transport releases reserved peer and private route promptly', async () => {
    const mesh = rendezvous(); const host = createWatchParty({ daemonFactory: mesh.factory });
    try {
        await host.create(); const code = (await host.createInvite()).code;
        for (const failure of ['false', 'throw']) {
            const nonce = failure === 'false' ? 'b'.repeat(32) : 'c'.repeat(32);
            const challenge = host._challengeFor(guestSigner.publicKeyHex, nonce);
            const claims = { partyId: host.partyId, inviteId: host._invite.inviteId, guestKey: guestSigner.publicKeyHex, nonce, challenge: challenge.value };
            const request = await signPartyEnvelope(guestSigner, { kind: 'join', partyId: host.partyId, toKey: host.hostKey, seq: 0,
                body: { ...claims, proof: await makeJoinProof(host._invite, claims), displayName: 'Retry guest' } });
            host._sendGrant = async () => { if (failure === 'throw') throw new Error('Failed test transport'); return false; };
            if (failure === 'throw') await rejects(() => host._admit(request, 'unused-session'), 'Throwing grant transport lost its failure');
            else await host._admit(request, 'unused-session');
            assert(host._peers.size === 0 && host.members.length === 1 && host._ownedRoutes.size === 1, 'Grant failure leaked a reservation or route');
            assert(!host._blocked.has(guestSigner.publicKeyHex) && (await host.createInvite()).code === code, 'Grant failure blocked legitimate retry or rotated invitation');
        }
    } finally { await host.end(); }
});

await check('voluntary browser leave preserves active invitation and permits a new guest using the same code', async () => {
    const mesh = rendezvous(); const host = createWatchParty({ daemonFactory: mesh.factory });
    const a = createWatchParty({ daemonFactory: mesh.factory }), b = createWatchParty({ daemonFactory: mesh.factory });
    try {
        const invite = await host.create(); await a.join(invite.code); const oldKey = a.identity.publicKeyHex;
        b.options.identity = a.identity;
        await a.end();
        await waitFor(() => host.members.length === 1, 'Voluntary leave did not free its reservation');
        assert((await host.createInvite()).code === invite.code && !host._blocked.has(oldKey), 'Voluntary leave rotated invitation or blocked the departed identity');
        await b.join(invite.code);
        assert(host.members.length === 2 && b.status === 'joined', 'Active invitation could not be reused after voluntary leave');
    } finally { await Promise.allSettled([host.end(), a.end(), b.end()]); }
});

await check('ending a pending browser join cancels admission and frees its rendezvous route', async () => {
    const mesh = rendezvous();
    const guest = createWatchParty({ daemonFactory: mesh.factory });
    const pending = guest.join(invite.code).then(() => 'unexpected', error => error.code);
    await waitFor(() => guest.status === 'joining', 'Pending join did not initialize');
    await guest.end();
    assert(await pending === 'CANCELLED' && guest.status === 'ended', 'Cancelled join resumed or changed to error');
    assert(!guest.role && !guest.identity && mesh.sessions.size === 0 && guest._ownedRoutes.size === 0, 'Pending join leaked identity or route');
});

await check('native browser party: automatic admission, RTP audio/video, chunked packets, replay protection and rotation retention', async () => {
    const mesh = rendezvous();
    const host = createWatchParty({ displayName: 'Host', daemonFactory: mesh.factory });
    const guest = createWatchParty({ displayName: 'Browser guest', daemonFactory: mesh.factory });
    const media = document.createElement('video'); media.autoplay = true; media.muted = true; document.body.append(media);
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
    const context = canvas.getContext('2d');
    const draw = () => { context.fillStyle = '#e02020'; context.fillRect(0, 0, 64, 48); };
    draw();
    const videoTrack = canvas.captureStream(0).getVideoTracks()[0];
    const paintTimer = setInterval(() => { draw(); videoTrack.requestFrame(); }, 60);
    const audio = new AudioContext(); const oscillator = audio.createOscillator(); const destination = audio.createMediaStreamDestination();
    if (typeof audio.setSinkId === 'function') await audio.setSinkId({ type: 'none' });
    oscillator.connect(destination); oscillator.start(); await audio.resume();
    const stream = new MediaStream([videoTrack, ...destination.stream.getAudioTracks()]);
    const receiverAudio = new AudioContext();
    if (typeof receiverAudio.setSinkId === 'function') await receiverAudio.setSinkId({ type: 'none' });
    await receiverAudio.resume();
    const packets = [], controls = [];
    guest.on('stream', event => {
        if (event.stream) {
            if (media.srcObject !== event.stream) media.srcObject = event.stream;
            void media.play().catch(() => {});
        }
    });
    guest.on('packet', event => packets.push(event)); guest.on('control', event => controls.push(event));
    try {
        const created = await host.create();
        assert(!host.identity.persistent, 'Host party key persisted');
        await host.attachStream(stream);
        await guest.join(created.code);
        assert(host.members.length === 2 && guest.role === 'guest' && guest.status === 'joined', 'Automatic guest admission failed');
        await waitFor(() => media.readyState >= 2 && media.videoWidth === 64, 'Restreamed video did not render', 20_000);
        const guestPeer = guest._peers.get(host.hostKey);
        await waitFor(() => guestPeer.transport.stream.getAudioTracks().length === 1, 'Audio track missing');
        const stats = await guestPeer.transport.connections.get('content').pc.getStats();
        assert([...stats.values()].some(report => report.type === 'inbound-rtp' && report.kind === 'video' && report.bytesReceived > 0), 'Native video RTP did not arrive');
        assert([...stats.values()].some(report => report.type === 'inbound-rtp' && report.kind === 'audio' && report.bytesReceived > 0), 'Native audio RTP did not arrive');
        const receivedAudio = receiverAudio.createMediaStreamSource(new MediaStream(guestPeer.transport.stream.getAudioTracks()));
        const analyser = receiverAudio.createAnalyser(); receivedAudio.connect(analyser); analyser.connect(receiverAudio.destination);
        const samples = new Float32Array(analyser.fftSize);
        await waitFor(() => { analyser.getFloatTimeDomainData(samples); return samples.some(sample => Math.abs(sample) > 0.05); }, 'Decoded remote audio waveform remained silent');
        await host.sendHostState({ sourceRevision: 1, itemId: 'public-movie', source: { kind: 'url', url: 'https://example.com/movie.mp4', title: 'Shared source' },
            mode: 'url', position: 7, paused: true, rate: 1.25, clock: Date.now() });
        await waitFor(() => guest.state?.sourceRevision === 1, 'Signed URL state did not arrive');
        assert(guest.state.position === 7 && guest.state.mode === 'url', 'URL sync content differs');
        const hostPeer = host._peers.get(guest.identity.publicKeyHex);
        const configured = JSON.stringify(hostPeer.transport.connections.get('control').pc.getConfiguration().iceServers);
        assert(!await host._applyIce({ mode: 'direct', relayAvailable: false, expiresAt: Math.floor(Date.now() / 1000) + 3600,
            iceServers: [{ urls: 'stun:untrusted.invalid:3478' }] }, true), 'Unapproved ICE response accepted');
        assert(!await host._applyIce({ mode: 'direct', relayAvailable: false, expiresAt: Math.floor(Date.now() / 1000) - 1,
            iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }, true), 'Expired ICE response accepted');
        assert(JSON.stringify(hostPeer.transport.connections.get('control').pc.getConfiguration().iceServers) === configured, 'Invalid ICE response changed active PC');
        const bytes = Uint8Array.from({ length: 200_000 }, (_, index) => index & 255);
        await waitFor(() => guestPeer.transport.media?.readyState === 'open', 'Custom data channel did not open');
        assert(host.publishPacket(bytes, { kind: 'video', sourceRevision: 1, sequence: 0, timestamp: 7, keyframe: true }) === 1, 'Chunked packet not queued');
        await waitFor(() => packets.length === 1, 'Chunked custom packet did not arrive');
        assert(packets[0].bytes.length === bytes.length && packets[0].bytes.every((value, index) => value === bytes[index]), 'Chunk assembly corrupted content');
        host.publishPacket(bytes, { kind: 'video', sourceRevision: 1, sequence: 0, timestamp: 7, keyframe: true });
        await new Promise(resolve => setTimeout(resolve, 150));
        assert(packets.length === 1, 'Duplicate codec sequence delivered');
        assert(host.publishPacket(bytes, { kind: 'video', sourceRevision: 0, sequence: 1, timestamp: 7, keyframe: false }) === 0, 'Stale source packet sent');
        const before = guestPeer.transport.connections.get('content').pc;
        const hostBefore = host._peers.get(guest.identity.publicKeyHex).transport.connections.get('content').pc;
        const oldJoin = host._invite.routeTag;
        const rotations = await Promise.all([host.rotateInvite(), host.rotateInvite()]);
        const next = rotations[1];
        assert(rotations[0].code !== rotations[1].code && host._ownedRoutes.size === 2, 'Concurrent invite rotations leaked a join route');
        assert(next.code !== created.code && !host._ownedRoutes.has(oldJoin) && host.members.length === 2, 'Rotation retained old invitation or lost membership');
        assert(guestPeer.transport.connections.get('content').pc === before && before.connectionState === 'connected', 'Rotation replaced established content PC');
        const unsignedSpoof = await signPartyEnvelope(guest.identity, { kind: 'state', partyId: host.partyId, toKey: host.identity.publicKeyHex,
            seq: 10000, body: { state: { ...host.state, position: 500 }, revision: 500, admissionId: guestPeer.admissionId } });
        guestPeer.transport.sendControl(unsignedSpoof);
        await new Promise(resolve => setTimeout(resolve, 150));
        assert(host.state.position === 7, 'Viewer altered authoritative host state');
        await rejects(() => host.create(), 'Concurrent create accepted');
        assert(host.role === 'host' && host.members.length === 2, 'Rejected concurrent create destroyed current party');
        await host.removeParticipant(guest._selfId);
        assert(host.members.length === 1 && host._peers.size === 0 && hostBefore.connectionState === 'closed', 'Host removal did not close its own peer');
        await waitFor(() => guest.status === 'ended' || !guestPeer.connected, 'Guest removal was not observed');
    } finally {
        await Promise.allSettled([host.end(), guest.end()]);
        clearInterval(paintTimer); for (const track of stream.getTracks()) track.stop(); oscillator.stop(); await audio.close(); await receiverAudio.close(); media.remove();
        assert(mesh.sessions.size === 0 && host._ownedRoutes.size === 0 && guest._ownedRoutes.size === 0, 'Party cleanup leaked rendezvous routes');
    }
});

await check('concurrent admission reserves exactly five guests and rejects the sixth without host approval', async () => {
    const mesh = rendezvous();
    const host = createWatchParty({ displayName: 'Capacity host', daemonFactory: mesh.factory });
    const guests = Array.from({ length: 6 }, (_, index) => createWatchParty({ displayName: `Guest ${index + 1}`, daemonFactory: mesh.factory }));
    try {
        const invite = await host.create();
        const joined = await Promise.allSettled(guests.map(guest => guest.join(invite.code)));
        assert(joined.filter(result => result.status === 'fulfilled').length === 5 && joined.filter(result => result.status === 'rejected').length === 1, 'Admission limit failed under concurrent joins');
        assert(host._peers.size === 5 && host.members.length === 6, 'Host membership exceeded five guests');
        assert(host._ownedRoutes.size === 6, 'Per-member private rendezvous route count differs');
    } finally {
        await Promise.allSettled([host.end(), ...guests.map(guest => guest.end())]);
        assert(mesh.sessions.size === 0, 'Concurrent party cleanup leaked sessions');
    }
});

window.partyTestResults = results;
document.documentElement.dataset.testStatus = results.every(result => result.passed) ? 'passed' : 'failed';
document.documentElement.dataset.testSummary = `${results.filter(result => result.passed).length}/${results.length} Watch Party tests passed`;
