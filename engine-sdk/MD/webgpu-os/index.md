---
title: WebGPU OS
description: Section index for the WebGPU OS, including the GPU-first platform and The Virtual Realm planning specification.
updated: 2026-09-21
---

# WebGPU OS

GPU-first compositor, shell, kernel, and package system that boots in a browser tab. Source: `webgpu-os/`.

## In this section

- [Overview](overview.md) — what it is, tier framing, subsystems.
- [Architecture](architecture.md) — kernel, shell, packages, storage, drivers, app contract.
- [Compute Service](compute.md) — guarded compute jobs, metadata inspection, Paint and Files analysis, Office checksums, and system diagnostics.
- [Shared App UI](app-ui.md) — theme-aware app surfaces, headings, status badges, toolbar identity, and accessibility.
- [Installed System Releases](installed-system-releases.md) — stable bootstrap, signed/encrypted releases, local installation, guarded update control, and rollback.
- [Runtime Handoff, Realm Host, and Update Swarm](runtime-handoff-and-update-swarm.md) — iframe A/B activation, secret-free capsules, stable Realm ownership, and swarm privacy modes.
- [Setup Center State and Migration](setup-center-state.md) — generation-fenced review state, three-way commit receipts, and conservative legacy precedence.
- [Realm Network](realm-network.md) — portable identity, content, resumable links, semantic replication, governance, discovery, V3 compatibility, and one-shot deployment policy.
- [The Virtual Realm](virtual-realm/index.md): full first-person living spatial-twin plan covering RealmForge bakes, real WebGPU OS projections, Code Matter, Cityforms, SecureMesh station, Storylets, privacy, implementation, and certification.
- [Navi Architecture and Delivery](navi-architecture-and-delivery.md) — persistent identity, cognition, Faculties, causal memory, bounded autonomy, Manifestations, and recovery gates.
- [AI Echo Live Patch](ai-echo-live-patch.md) — clean-room declarative, reversible live editing for OS apps, shell surfaces, AI Echo, and extension-backed browser tabs.
- [AI Echo Artifact Studio](ai-echo-artifact-studio.md) — file-backed, versioned work products with native, declarative, and opaque-sandbox previews beside the conversation.
- [AI Echo Clicks and Clankers](ai-echo-clicks-and-clankers.md) — clean-room WebMCP discovery, verified semantic browser control, exact approvals, receipts, and React state synchronization.
- [AppForge Contracts](appforge-contracts.md) — modular part registry, deterministic assembly, context graph, layout zones, package exports, timeline, lenses, starter packs, and builder contracts.
- [RealmForge v2 Workbench](realmforge.md) — template-first `.proasset` 2.0.0 authoring, product-level construction, simulation, guarded AI operations, migration, and trusted artifact publication.
- [SOUL browser learning and daily life](soul.md) — individual home routines, reviewed lessons, WebGPU training and measured population load.
- [Getting Started](getting-started.md) — boot the OS and build an app.
- [App Catalog](app-catalog.md) — all 50 built-in apps.
- **API Reference** — per-file symbols from `kernel/`, `shell/`, `packages/`, `storage/`, `drivers/`, `browser-bridge/`, `browser-extension/` (browse `webgpu-os/reference/`).

## Module map

```text
webgpu-os/
  index.js / boot.js   bootWebGpuOS entry
  kernel/    KernelBootstrap, Syscalls, AppRegistry, ModRegistry, Permissions,
             TrustStore, GpuDeviceBroker, VRAMTracker, ThemeEngine, VirtualFS, ...
  shell/     Desktop, Taskbar, StartMenu, StatusTray, DialogManager, NotificationCenter
  packages/  PackageManager, PackageLoader, PackageBuilder, PackageVerifier, UpdateManager, ...
  storage/   VirtualFS, SystemFS, OPFSDriver, IndexedDBDriver, MountDriver, AppSandbox
  appforge/  Definitions, registry, tags, scoring, services, context, commands,
             layout, blueprints, packages, timeline, lenses, packs, builder
  drivers/   AudioDriver, CryptoDriver, NetDriver, ProfileDriver, WebSurfaceDriver
  bootstrap/ stable installed-OS boot and recovery host
  system-release/ contracts, trust verification, acquisition, install registry, materializer
  platform/runtime-host/ iframe lifecycle, immutable resource router, capsule handoff
  platform/network-host/ stable Realm delegation and update-swarm acquisition
  browser-bridge/ browser-extension/   native browser integration + adblock
  apps/      50 runtime-discovered apps (apps/index.json)
```

## Related concepts

- [Boot Sequence](../concepts/boot-sequence.md)
- [GPU Device Sharing](../concepts/gpu-device-sharing.md)
- [Security & Trust Model](../concepts/security-model.md)
- [Data Flow](../concepts/data-flow.md)
