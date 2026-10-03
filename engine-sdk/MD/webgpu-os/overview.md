---
title: WebGPU OS Overview
description: The composition layer that turns the engine, Plauna, AGI, and editor into a GPU-first, desktop-like OS that boots in a single browser tab.
updated: 2026-08-22
---

# WebGPU OS Overview

WebGPU OS (`webgpu-os/`) is the composition layer that turns the engine, Plauna, AGI, and editor into a **GPU-first, desktop-like OS that boots in a single browser tab**. It provides a kernel, a shell, a signed package system, storage, drivers, and a runtime app catalog.

> **Composition, not forking:** the OS consumes `engine/`, `plauna/`, `agi/`, and `editor/` as libraries. Fixes go upstream, not into the glue layer. (Source: `webgpu-os/AUDIT.md` §4.)

## What it is (and isn't)

- **Is:** a secure, GPU-accelerated **app platform** with a web-native developer experience — closer to OS.js + WebContainers + WASI than to a native game launcher.
- **Isn't:** a Steam-class native-game platform. Browser sandboxing rules out native overlays/input. (Source: `AUDIT.md` §1.)

## Tier 1 today

The current implementation is **Tier 1 — browser-resident**. Tier 2 (Rust + Wasmtime/WASI host wrapping Dawn/wgpu) is a documented migration path; Tier 3 (native microkernel) is research-only. See [Architecture Overview](../concepts/architecture-overview.md) for the tier framing and the stable Tier 2 migration contract.

## Subsystems

| Subsystem | Path | Purpose |
| --- | --- | --- |
| Kernel | `webgpu-os/kernel/` | syscalls, scheduling, GPU mediation, trust, permissions, theming, surfaces, logging, FS |
| Shell | `webgpu-os/shell/` | desktop, taskbar, start menu, windows, dialogs, notifications |
| Packages | `webgpu-os/packages/` | `.prpkg` build/sign/verify/install/update, capability map |
| Storage | `webgpu-os/storage/` | virtual FS over OPFS/IndexedDB/cache/mounts, per-app sandbox |
| Drivers | `webgpu-os/drivers/` | audio, crypto, net, profile, web-surface |
| Browser bridge / extension | `webgpu-os/browser-bridge/`, `browser-extension/` | native browser integration + adblock relay |
| Apps | `webgpu-os/apps/` | 44 runtime-discovered apps (see [App Catalog](app-catalog.md)) |
| AppForge | `webgpu-os/appforge/` | deterministic part registry, tags, services, context graph, commands, layouts, blueprints, packages, timeline, lenses, starter packs, and builder |

## Key documents (read-only sources)

- `webgpu-os/AUDIT.md` — asset inventory, tiers, folder layout, security model.
- `webgpu-os/ROADMAP.md` — phased delivery plan.
- `webgpu-os/RESEARCH.md` — source research.
- `webgpu-os/docs/` — `ARCHITECTURE`, `PACKAGING`, `PERMISSIONS_MODEL`, `APP_MANIFEST_SPEC`.
- [AppForge Contracts](appforge-contracts.md) — modular public contracts layered over the current kernel, package, permission, app, and Plauna systems.

## Next steps

- [Architecture](architecture.md) — kernel, shell, packages, storage.
- [AppForge Contracts](appforge-contracts.md) — deterministic registry, assembly, context, layout, package export, timeline, lens, pack, and builder contracts.
- [Getting Started](getting-started.md) — boot and build an app.
- [App Catalog](app-catalog.md) — every shipped app.
- WebGPU OS **API Reference** — generated from `kernel/`, `shell/`, `packages/`, `storage/`, `drivers/`.
