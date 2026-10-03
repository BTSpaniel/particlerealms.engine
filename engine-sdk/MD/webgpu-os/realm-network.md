---
title: Realm Network
description: Architecture, contracts, security boundaries, V3 compatibility, verification, and deployment policy for the Realm Network.
updated: 2026-08-02
---

# Realm Network

The Realm Network adds portable identity, immutable content, resumable links,
semantic replication, offline branches, governance, bounded task exchange, and
safe Realm discovery to the WebGPU OS. It builds on the existing Particle
Network and keeps V1/V2 compatibility intact.

The implementation is complete through the local Realm Network Alpha gates.
The Raspberry Pi service is not deployed. Only the server owner performs that
single physical cutover. (Source: `Masterserver/REALM_NETWORK_V3_DELTA.md`.)

## Architecture

| Layer | Responsibility | Source |
|---|---|---|
| OS ownership | One `NetworkDriver` owns network lifecycle; `NetDriver` remains a compatibility adapter | `webgpu-os/drivers/NetworkDriver.js`, `webgpu-os/drivers/NetDriver.js` |
| Embedded endpoint | One leader tab owns the backbone; resident, supernode, witness, and authority are roles on the same browser endpoint | `engine/network/endpoint/ParticleEndpointRuntime.js`, `webgpu-os/drivers/EmbeddedParticleNode.js` |
| App boundary | `realm.*` syscalls expose feature state, contract metadata, verification, and Passport operations | `webgpu-os/kernel/Syscalls.js` |
| Protocol routing | Exact versioned descriptors negotiate State Channel, chunk, carrier, and DHT traffic; unknown versions fail closed | `engine/network/routes/RouteProtocolRegistry.js`, `engine/network/routes/OsNetworkSession.js` |
| Rollout control | Versioned flags keep experimental Realm features independent while the bounded endpoint runtime is enabled by default | `webgpu-os/drivers/RealmNetworkFeatureFlags.js` |
| Protocol modules | Identity, Chronicle, Capsules, links, authority, branches, governance, Accord, Atlas, Gate, Shield, and publishing | `engine/network/realm/` |
| Public contracts | Eighteen immutable V1 descriptors bind the public names to concrete implementations | `engine/network/realm/contracts.js` |
| Rendezvous service | Additive signed V3 admission, opaque rendezvous, default-on authenticated State Channel SSE, optional bounded Atlas, health, and metrics | `Masterserver/app/v3.py`, `Masterserver/app/state_channels.py` |
| Swarm content | Signed manifests drive bounded multi-provider chunk fetch, per-chunk verification, retry, cache, and provider announcement | `engine/network/chunks/SwarmFetchCoordinator.js`, `engine/network/chunks/ChunkCache.js` |
| Deployment | Source-bound receipt, checksummed archive, preflight, cutover, smoke, and rollback | `Masterserver/deployment/realm-network-v3/` |

The Masterserver remains ephemeral. It does not store Realm identity,
Chronicle, Capsules, branches, organizations, or durable Atlas data. (Source:
`Masterserver/app/v3_atlas.py`, `Masterserver/REALM_NETWORK_V3_DELTA.md`.)

## Public V1 contracts

The stable registry exports these exact names:

| Area | Contracts |
|---|---|
| Identity and history | `RealmPassportV1`, `RealmAddressV1`, `ChronicleEventV1` |
| Content and links | `RealmCapsuleV1`, `RealmLinkV1`, `PresenceV1`, `ContinuityV1`, `HealthSnapshotV1` |
| Authority and branches | `AuthorityLeaseV1`, `RealmBranchV1`, `MergeProposalV1` |
| Governance | `OrganizationV1`, `CapabilityGrantV1` |
| Bounded task exchange | `AccordTaskV1`, `ContextCapsuleV1`, `AccordResultV1` |
| Discovery and entry | `AtlasRecordV1`, `GatePlanV1` |

Importing `engine/network/realm/index.js` is inert. It creates no connection,
timer, store, worker, or database. (Source:
`tests/network/realm/realm-public-contracts.test.js`.)

## Guarded app API

Apps use kernel syscalls instead of importing engine internals. The catalog
contains metadata only; it never returns implementation functions or key
handles. Contract verification requires `realm.read`. Feature changes and
Passport mutations require `realm.manage`. (Source:
`webgpu-os/kernel/Syscalls.js`, `webgpu-os/kernel/RuleGraph.js`.)

```javascript
const catalog = syscalls.realm.contracts();
const address = await syscalls.realm.verifyContract(
  'RealmAddressV1',
  'realm://example/shared_space',
);

if (!address.valid) {
  throw new Error(address.reason);
}
```

Verification fails before dispatch when the contract's rollout feature is
disabled. Passport operations delegate to the existing `ProfileDriver`; the
Realm layer does not create a second private-key store. (Source:
`webgpu-os/drivers/NetworkDriver.js`, `webgpu-os/drivers/ProfileDriver.js`.)

## V3 selection and downgrade policy

The Masterserver source and r7 deployment environment advertise V3 by default.
The client first verifies the pinned signed V2 advertisement. If that valid
advertisement has no V3 marker, the client selects V2. If it advertises V3,
the client commits to V3 and verifies the complete V3 endpoint set, manifest,
pin, and signatures. Any V3 integrity failure stops the connection and never
downgrades to V2 or V1. A separate legacy V1 server entry is tried only as an
availability fallback when the preferred V3/V2 entry cannot be acquired; it is
not an integrity-error fallback. (Source:
`engine/network/daemon/ParticleNetworkPreferredDaemon.js`,
`engine/network/routes/MasterServerList.js`, `engine/network/crypto/Trust.js`,
`Masterserver/app/config.py`.)

V3 uses `particle-session/3` for admission and session proof, plus
`particle-rendezvous/3` for opaque route attachment, discovery, and directed
rendezvous. A signed V3 manifest also advertises
`particle-state-channel/1`, its short-lived lease endpoint, and its SSE/HTTP
base URL. HPKE context uses the V3-specific `particle-rendezvous/3` domain.
(Source: `engine/network/daemon/ParticleNetworkDaemon.js`,
`Masterserver/app/protocol.py`, `Masterserver/app/trust.py`.)

## Embedded resident and supernode roles

Every enabled WebGPU OS browser profile starts an embedded Particle node. The
node owns one mesh identity and one route set. `resident` describes its
availability. `supernode`, `witness`, and `authority` are elected or assigned
roles on the same node, not separate networks or installations. Browser locks
or a renewable lease ensure only one tab holds the external backbone while
followers remain ready to take over. The user can explicitly opt out by
disabling the resident node setting. (Source:
`webgpu-os/drivers/EmbeddedParticleNode.js`,
`webgpu-os/drivers/NetworkDriver.js`.)

`ParticleEndpointRuntime` unifies discovery providers, route transports,
reachability, and roles around that same node. It does not create another
peer graph or identity store. `RouteProtocolRegistry` routes exact versioned
protocol envelopes over an acquired route and rejects unknown or malformed
versions before legacy handlers can see them. (Source:
`engine/network/endpoint/ParticleEndpointRuntime.js`,
`engine/network/routes/RouteProtocolRegistry.js`,
`engine/network/routes/OsNetworkSession.js`.)

Backbone availability is not app membership. App and room namespaces remain
cold until the app acquires a route lease. Local consumers reference-count one
session, and the last consumer releases it. A hidden, frozen, or page-hidden
tab yields both its Web Lock and WebRTC routes so a visible client can become
the host. The browser may discard a page without a final unload callback, so
authority safety comes from replicated checkpoints, heartbeat expiry, and
strictly newer fencing rather than unload cleanup. (Source:
`engine/network/routes/RouteSessionManager.js`,
`engine/network/stateChannels/MeshStateChannelTransport.js`,
`engine/network/stateChannels/StateChannelAuthorityCoordinator.js`.)

This separation matches the namespace model described by the
[libp2p rendezvous protocol](https://libp2p.io/docs/rendezvous/): peers register
and discover within an application-specific namespace instead of treating
ambient peer discovery as automatic subscription to every application.

A static Cloudflare upload can serve and boot the browser OS, but static assets
cannot mint TURN credentials or coordinate Internet rendezvous. The current r7
deployment keeps those duties in the Particle Masterserver. A future
Cloudflare-native replacement would still be server-side infrastructure, such
as a Worker plus Durable Objects, and TURN secrets must remain backend-only.
See [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/),
[Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
and [Cloudflare TURN credential generation](https://developers.cloudflare.com/realtime/turn/generate-credentials/).

The browser endpoint starts with the OS, but route membership remains lazy.
No app, room, game, document, voice, or State Channel route opens until a
visible app acquires it. A fully open client may then accept compatible
protocol traffic, provide verified chunks, or hold a temporary supernode role.
A suspended or closed page releases those benefits instead of pretending to
be an always-on host. (Source: `engine/network/routes/RouteSessionManager.js`,
`engine/network/endpoint/ParticleEndpointRuntime.js`.)

The mesh begins full for small rooms, becomes a bounded neighbor mesh as it
grows, and elects two through five supernodes for larger rooms. Remote role
claims are signed and expire, but election ranking uses locally observed
latency, uptime, reconnect count, relay use, and connection state. A peer
cannot promote itself by claiming a high score. (Source:
`engine/collab/CollabCore.js`, `engine/collab/CollabMeshTopology.js`,
`engine/network/routes/NodeRoleProtocol.js`.)

## Discovery, health, and bounded resources

The endpoint can discover peers through signed Masterserver rendezvous,
route-scoped DHT records, direct peer tickets, or already connected peers.
Peer tickets contain identity and dialing hints, not private keys, and expire.
`ReachabilityProjection` reports only observed transport facts such as direct,
relay, local, or offline state. It never treats a device fingerprint as
cryptographic identity. (Source: `webgpu-os/drivers/NetworkDriver.js`,
`engine/network/realm/health/ReachabilityProjection.js`.)

Atlas records are signed, opaque, TTL-bound, and stored only in process
memory. Optional node propagation carries bounded signed records over the
existing authenticated node mesh. The server enforces global and per-scope
record limits, payload and frame limits, request rates, queue bytes, queue
frames, fanout, session count, and proof deadlines. (Source:
`Masterserver/app/v3_atlas.py`, `Masterserver/app/node_mesh.py`,
`Masterserver/app/config.py`.)

`GET /v3/status` reports readiness reasons without exposing route secrets,
identity material, payloads, or credentials. Protected Prometheus metrics
cover admission, sessions, rendezvous, Atlas, queues, resource use, and node
propagation. (Source: `Masterserver/app/health.py`,
`Masterserver/app/metrics.py`.)

Signed chunk manifests cap object size and chunk count. `SwarmFetchCoordinator`
discovers multiple providers per hash, runs bounded parallel lanes, penalizes
failed providers, verifies every returned size and hash, and assembles bytes in
manifest order. `ChunkCache` is an in-memory bounded least-recently-used cache;
valid cached chunks can be served and announced through the existing DHT route.
(Source: `engine/network/chunks/Manifest.js`,
`engine/network/chunks/SwarmFetchCoordinator.js`,
`engine/network/chunks/ChunkCache.js`.)

## Clean-room concepts adapted from Iroh

R7 borrows architecture concepts, not Iroh source code or Rust dependencies.
The shared ideas are composable endpoint protocols, exact protocol-version
negotiation, scoped gossip topics, shareable dialing tickets, and verified
content-addressed transfer. Particle implements them with browser WebRTC,
WebOS device keys, signed manifests, route-scoped DHT discovery, and SHA-256
chunk verification. See the Iroh documentation for
[protocol routing](https://docs.iroh.computer/concepts/protocols),
[scoped gossip](https://docs.iroh.computer/connecting/gossip),
[tickets](https://docs.iroh.computer/concepts/tickets), and
[verified blobs](https://docs.iroh.computer/protocols/blobs).

Gossip and fingerprints remain hints. Gossip spreads bounded discovery and
role observations but does not establish authority. A device fingerprint may
help continuity scoring but cannot replace a signature from the profile's
device key. State Channel authority still requires a route-bound lease,
validated intent, revision, epoch, and fencing token. (Source:
`engine/network/routes/RouteProtocolRegistry.js`,
`engine/network/stateChannels/StateChannelAuthorityCoordinator.js`,
`engine/network/chunks/SwarmFetchCoordinator.js`.)

## Local verification receipt

The frozen Alpha server contract is
`realm-network-r7-alpha-2026-08-02`. The r7 local evidence includes:

- Masterserver suite: 233/233 passed.
- Signed V3 browser flow: 5/5 passed.
- Embedded V3 runtime and guarded syscall checks: 29/29 and 6/6 passed.
- Embedded R7 endpoint, reachability, SSE lease, and swarm gate: 8/8 passed.
- Explicit no-TURN compatibility gate: 13/13 passed.
- Mesh evidence checks: 11/11 passed; focused State Channel server tests: 3/3.
- State Channel browser behavior: 6/6 passed.
- Local V3 load gate: 128 clients, 2,432/2,432 relays, 20.063 seconds.
- WebGPU OS release bundle: 2,104 modules, zero skipped, 1,422 static files,
  53 verified embedded packages, CRC-verified ZIP, and SHA-384 integrity
  metadata.

These tests use loopback services only. They do not contact the Raspberry Pi.
(Source: `Masterserver/REALM_NETWORK_V3_DELTA.md`,
`tests/network/run_local_v3_browser_gate.py`,
`tests/network/run_local_v3_128_gate.py`.)

## One-shot server cutover

The deployment archive does not contain signing keys. Persistent keys stay
under `/etc/particle-masterserver/`. The handoff provides a non-mutating
preflight, staged backup, atomic application swap, environment delta, service
restart, V1/V2/V3 and State Channel SSE smoke tests, and rollback. Setting
`PARTICLE_ADVERTISE_V3=false` hides V3 and its SSE lease/transport routes while
V1/V2 remain operational.
(Source: `Masterserver/deployment/realm-network-v3/RUNBOOK.md`.)

The server owner must review and run the cutover commands. Post-cutover Pi
load evidence and production acceptance remain user-operated gates.

## See also

- [Security & Trust Model](../concepts/security-model.md)
- [WebGPU OS Architecture](architecture.md)
- [Glossary](../getting-started/glossary.md)
