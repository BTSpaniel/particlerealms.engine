---
title: Runtime Handoff, Realm Host, and Update Swarm
description: Warm and shadow iframe activation, secret-free runtime capsules, stable Realm network ownership, and the consent-bound Particle update swarm.
updated: 2026-08-24
---

# Runtime Handoff, Realm Host, and Update Swarm

This page documents how an installed release changes while the stable browser
document remains alive. It covers the iframe handoff protocol, the state that
may cross that boundary, the existing Realm network hosted by the stable
document, and update-swarm privacy modes.

## Why the runtime is an iframe

The stable host creates one same-origin iframe per release. A new document has a
new ES-module map, DOM, WebGPU objects, audio objects, workers, and closures, so
the old executable runtime can be shut down instead of patched in place.
Immutable release-qualified URLs keep Runtime A and Runtime B from resolving a
mixed module graph. (Sources:
`webgpu-os/platform/runtime-host/StableRuntimeHost.js`,
`webgpu-os/platform/runtime-host/SystemReleaseRegistryAdapter.js`, and
`webgpu-os/platform/runtime-host/ReleaseResourceRouter.js`.)

`ReleaseDescriptorV1.activationFloor` is the publisher-requested minimum
activation class, while `activationClass` is the effective class calculated
from that floor and the staged-site diff. Both fields are signed inside the TUF
target descriptor, both participate in the content-derived release identity,
and validation rejects any descriptor whose effective class is less
restrictive than its floor:

| Class | Build meaning | Current activation path |
| --- | --- | --- |
| `asset-live` | Only allowlisted asset suffixes changed. | Uses the verified iframe activation path. It is not an authorization to execute package commands. |
| `runtime-warm` | Executable/runtime files changed. | Uses the verified iframe activation path. |
| `runtime-shadow` | Kernel, storage, driver, collaboration, or network paths changed. | Uses a hidden candidate iframe, capsule import, health check, and commit. |
| `bootstrap-next-launch` | Stable-host change. | Not authorizable by the normal system-release builder; stable bootstrap deployment is separate. |

The stable host selects warm or shadow lifecycle behavior from the validated
effective class. `asset-live` currently takes the verified warm iframe path;
it is not an in-place executable-module replacement. Existing
`LivePatchService` keeps its narrow declarative UI/CSS role. (Sources:
`bundler/system_release.py`, `webgpu-os/system-release/contracts.js`, and
`webgpu-os/platform/runtime-host/StableRuntimeHost.js`.)

## Runtime host protocol

The host and guest use `RuntimeHostProtocolV1` over a dedicated MessagePort:

1. `HELLO` binds the exact `releaseId`, runtime epoch, role, and supported
   lifecycle messages.
2. `PREFLIGHT` checks Runtime B before Runtime A is frozen.
3. `FREEZE` stops new desktop and logical network admission in A.
4. `EXPORT_CAPSULE` asks A for bounded transferable application state.
5. `IMPORT_CAPSULE` restores that state into hidden B.
6. `HEALTH` must pass before and after the durable pointer commit.
7. `COMMIT` promotes B and its stable services.
8. `SHUTDOWN` tears down A after confirmation.
9. `RESUME` restores A when activation fails.

Every request is fenced by release ID, runtime epoch, request ID, timeout, and
structured-clone bounds. The runtime host holds a renewable release lease while
an iframe is open so cleanup cannot remove objects used by a live tab. (Sources:
`webgpu-os/platform/runtime-host/RuntimeHostProtocol.js`,
`webgpu-os/platform/runtime-host/RuntimeGuestEndpoint.js`, and
`webgpu-os/platform/runtime-host/StableRuntimeHost.js`.)

## Capsule boundary

`RuntimeCapsuleV1` is JSON-only and limited to 4 MiB. It carries a capsule ID,
source release and runtime epoch, operator account/generation, optional Realm
event cursor, creation/expiry timestamps, and bounded state. Validation rejects
host objects, cycles, excessive depth/complexity, and field names associated
with passwords, credentials, cookies, private keys, access tokens, Passport
keys, or root keys. (Sources: `webgpu-os/system-release/contracts.js` and
`webgpu-os/platform/runtime-host/RuntimeHostProtocol.js`.)

The kernel handoff currently exports three projections:

- desktop application/window restoration state from `Desktop`;
- stable Realm client state and its replay cursor;
- stable media cursor and capability metadata, never tracks or browser handles.

The candidate must match the active account. Runtime B imports network cursor
state before desktop state, then reports health. DOM nodes, closures, GPU
resources, `AudioContext` objects, sockets, cryptographic keys, and browser
handles are not capsule data; Runtime B recreates them. (Sources:
`webgpu-os/platform/runtime-host/KernelRuntimeHandoff.js` and
`webgpu-os/shell/Desktop.js`.)

PWA launches are also host-owned rather than capsule-owned. `StableLaunchHost`
accepts the initial URL, shortcuts, deep links, and file-launch handles and
offers each launch to the authoritative active runtime over a bounded
MessagePort. A hidden candidate receives no launch until promotion. A launch
that was claimed but not acknowledged by a runtime is re-offered after that
runtime detaches; file handles remain in the stable document and the runtime
imports selected content through its scoped storage surface. (Sources:
`webgpu-os/platform/runtime-host/StableLaunchService.js` and
`webgpu-os/platform/StableLaunchClient.js`.)

## Commit and rollback

The old runtime stays retained while B starts hidden. The host begins a pending
activation, preflights B, freezes A, transfers the capsule, and requires B's
pre-commit health. It then atomically commits the release pointer, promotes B's
stable service bindings, commits B, checks health again, confirms boot, shows B,
and shuts down A. (Source:
`webgpu-os/platform/runtime-host/StableRuntimeHost.js`.)

If failure occurs before pointer commit, the host aborts the pending activation.
If failure occurs after commit, it restores the previous pointer. If stable
services were promoted, it promotes A's bindings again, sends `RESUME`, and
keeps A visible. Recovery becomes fail-stop only when durable rollback or A's
resume also fails. (Sources: `webgpu-os/platform/runtime-host/StableRuntimeHost.js`
and `webgpu-os/system-release/InstallRegistry.js`.)

This continuity exists only while the stable top-level document survives. A
navigation, tab/browser closure, process crash, page discard, or device restart
uses installed-release boot and durable recovery instead of live handoff.

## Stable Realm network ownership

`createStableRealmNetworkHost()` constructs the existing `NetworkDriver` in the
top document with physical startup deferred until an operator binds. It does
not create a replacement network or change the Masterserver. Release runtimes
receive a `StableNetworkClient` over the `realm-network` MessagePort. (Sources:
`webgpu-os/platform/network-host/StableNetworkHostFactory.js`,
`webgpu-os/platform/network-host/StableNetworkHost.js`, and
`webgpu-os/platform/network-host/StableNetworkClient.js`.)

The stable host binds a runtime claim only after its own `ProfileDriver`
refreshes and verifies the durable active Passport pointer. Operator changes
run the existing network participant's freeze, drain, bind, and resume phases.
Every runtime call is fenced by the account, immutable operator generation,
runtime epoch, and an authority epoch. An old runtime receives `REVOKED` and
cannot continue using stale handles. (Sources:
`webgpu-os/platform/network-host/RealmHostOperatorAuthority.js` and
`webgpu-os/platform/network-host/StableNetworkHost.js`.)

Owner IDs remain stable across a same-account release swap. The shadow runtime
may read status, prepare subscriptions, discover, and acquire an existing
logical mesh-session lease, but it cannot produce externally visible Realm
side effects before promotion. Bounded event topics retain cursored events for
handoff replay. A short grace period lets stable host handles move to the new
runtime before cleanup. An account switch revokes account owners and releases
their logical routes; a same-account release swap preserves the physical
driver. (Source: `webgpu-os/platform/network-host/StableNetworkHost.js`.)

The implemented host covers methods delegated through `StableNetworkHost`,
including the canonical Realm, mesh, chunk, carrier, discovery, and bounded
agent transport surfaces.

`StableMediaHost` adds the corresponding account-, generation-, release-,
runtime-, application-, conversation-, and peer-scoped logical transport
boundary. A shadow runtime may acquire an existing logical transport but cannot
create or send through it until promotion; same-account promotion preserves the
host adapter and replays bounded cursored events, while an account switch closes
the old account's transports. The protocol rejects keys, ports, browser handles,
and named secret material. (Sources:
`webgpu-os/platform/media-host/StableMediaHost.js` and
`webgpu-os/platform/media-host/StableMediaClient.js`.)

The default media adapter is intentionally reported as `runtime-owned-media`.
SecureMesh `MediaCore` and `CoWatchTransport` still own their current
`RTCPeerConnection`, capture streams, signed signaling, trust, and membership
checks. Consequently audio, video, screen, and co-watch continuity is reported
as unsupported until those call sites are moved behind a reviewed adapter that
preserves the existing Passport and block/membership enforcement. No browser
media handle is placed in a capsule and the system does not claim continuity it
cannot provide.

## Particle update swarm

`UpdateSwarmAcquirer` adapts the existing signed Particle chunk transport. TUF
verification happens first. A Particle manifest must then bind its object ID to
the exact encrypted package hash, use `system-release` scope, request only
`release.fetch`, and match every TUF-bound piece hash and size. Peers can supply
bytes but cannot change release trust, metadata, activation, or logical
contents. Origin acquisition remains the fallback. (Source:
`webgpu-os/platform/network-host/UpdateSwarmAcquirer.js`.)

| Mode | Consent | Privacy statement |
| --- | --- | --- |
| `origin-only` | Default; no swarm consent. | The configured origin sees the request. No peer seeding occurs. |
| `relay-only-swarm` | Explicit relay opt-in. | Peer traffic is constrained to relay-only transport, but relay infrastructure can observe connection metadata. |
| `direct-swarm` | Explicit direct opt-in. | Direct WebRTC peer addresses are visible to peers; this is pseudonymous, not IP-anonymous. |

Verified pieces stream directly into the OPFS acquisition journal. Swarm
failure, missing network support, or a missing Particle manifest falls back to
the signed origin when configured. Seeding requires both `seedWhileOpen` and a
stable-host policy created with `allowOfficialSeeding: true`; the default is
false. The implementation never claims browser-closed seeding. Service workers
do not own a persistent WebRTC seeder, and license approval remains an external
release-policy decision. (Source:
`webgpu-os/platform/network-host/UpdateSwarmAcquirer.js`.)

## Security invariants

- A shadow runtime cannot send, signal, mutate network configuration, or open
  new externally visible routes before promotion.
- A runtime cannot select an arbitrary account by posting an account ID.
- Signing authority crosses the MessagePort only as a non-transferable bounded
  handle; private key material is not cloned into the runtime.
- Cursors provide bounded replay, not unlimited history. Expired cursors require
  callers to refresh an authoritative snapshot.
- A swarm peer is an untrusted byte source. Only signed metadata and local hash
  verification establish release trust.
- Live handoff is not crash persistence and is not a substitute for rollback.

(Sources: `webgpu-os/platform/network-host/StableNetworkHost.js`,
`webgpu-os/platform/network-host/StableNetworkClient.js`, and
`webgpu-os/platform/runtime-host/StableRuntimeHost.js`.)

## See also

- [Installed System Releases](installed-system-releases.md)
- [Setup Center State and Migration](setup-center-state.md)
- [Realm Network](realm-network.md)
- [Operator, SecureMesh, and Agent Boundaries](operator-securemesh.md)
