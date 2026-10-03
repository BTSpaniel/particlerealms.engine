// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/index.js — public barrel for the Particle Global OS Network Layer.
//
// See C:\Users\btspa\.windsurf\plans\particle-network-layer-2bf6f0.md for the
// full plan. Phase 1 (protocol foundation): versioned envelopes, canonical
// signing, and profile/device/membership identity + route capabilities on
// top of the existing engine/collab (P2P) and engine/state (CSE) modules.
//
// Build status: [x] Phase 0 audit  [x] Phase 1 protocol foundation
//               [x] Phase 2 dynamic routes + master server list
//               [x] Phase 2b live Masterserver signaling client (transport/MasterServerClient.js)
//               [x] Phase 3 invites & trust groups   [x] Phase 4 group crypto
//               [x] Phase 5 peer tickets  [x] Phase 6 sync manager/workstations, now WIRED to
//                   live transport (syncManager/SyncTransport.js broadcasts/merges workstation
//                   CRDT ops over an attached route's MasterServerClient.signal(), gated by
//                   SyncManager.shouldSync()) — demoed live in factory/apps/network-manager's
//                   Routes tab
//               [x] Phase 7 chunks  [x] Phase 8 carrier layer  [x] Phase 9 DHT-lite (future/low-priority scope),
//                   with a concrete BootstrapSource adapter for the browser extension's resident
//                   cert vault at webgpu-os/drivers/ResidentBootstrapSource.js (OS-layer glue,
//                   per this module's no-webgpu-os-dependency rule — read-only, honestly scoped
//                   to "remembered identity", not live background reachability)

export * from './protocol.js';
export * from './crypto/index.js';
export * from './daemon/index.js';
export * from './identity/NetworkIdentity.js';
export * from './capability/RouteCapability.js';
export * from './routes/index.js';
export * from './transport/index.js';
export * from './invites/index.js';
export * from './groupLedger/index.js';
export * from './groupCrypto/index.js';
export * from './peerTickets/index.js';
export * from './syncManager/index.js';
export * from './workstation/index.js';
export * from './chunks/index.js';
export * from './carrier/index.js';
export * from './dht/index.js';
export * from './realm/index.js';
export * from './stateChannels/index.js';
export * from './endpoint/index.js';
