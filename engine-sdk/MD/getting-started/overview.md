---
title: Overview
description: What the WebGPU OS stack is, the five subsystems (engine, editor, Plauna, AGI, WebGPU OS), who each part is for, and where to go next.
updated: 2026-06-05
---

# Overview

This page explains what the stack is, who each part is for, and where to go next. Read it first if you are new to the project.

## The five subsystems

| Subsystem | What it is | Audience | Source |
| --- | --- | --- | --- |
| **Engine** | Browser-resident WebGPU runtime: GPU device, frame graph, ECS, rendering, simulation, networking, audio. | Engine/graphics/sim developers | `engine/` |
| **Editor** | Scene and asset authoring IDE built on the engine. | Content creators, tools developers | `editor/` |
| **Plauna** | Hybrid DOM/GPU UI framework and workbench (panels, widgets, surfaces, theming). | UI/app developers | `plauna/` |
| **AGI** | Reinforcement-learning "parasite rig" that learns to control humanoid ragdolls, plus a WebGPU tensor library and AGI Studio. | ML/animation developers | `agi/` |
| **WebGPU OS** | Composition glue: a GPU-first compositor, shell, kernel, package system, and app runtime that turns the above into a desktop-like OS in a browser tab. | App/package developers, end users | `webgpu-os/` |

## Design principles (shared across the stack)

- **Pure browser runtime** — no Node.js dependency, no build step required to run.
- **GPU-first** — heavy work runs on WebGPU compute; a single GPU device is shared.
- **ECS-driven** — state lives in components.
- **Modular** — each subsystem is independent and testable, consumed by the next as a library.
- **Composition, not forking** — `webgpu-os/` consumes `engine/`, `plauna/`, `agi/`, `editor/`; fixes go upstream, not into the glue layer.

## Who should read what

- **End users** of the OS: [WebGPU OS Overview](../webgpu-os/overview.md) → [App Catalog](../webgpu-os/app-catalog.md).
- **App / package developers**: [WebGPU OS Architecture](../webgpu-os/architecture.md), the kernel **API Reference**, and the [Security & Trust Model](../concepts/security-model.md).
- **Engine / UI / ML developers**: the relevant subsystem **Overview** + **Architecture** + **API Reference**.
- **Documentation contributors**: [Docs Style Guide](../contributing/docs-style-guide.md) and [Contribution Workflow](../contributing/doc-contribution-workflow.md).

## Next steps

1. [Install & Run](install.md) — get the stack serving locally.
2. [Quickstart](quickstart.md) — boot the OS and open your first app.
3. [Architecture Overview](../concepts/architecture-overview.md) — the big picture.
4. [Glossary](glossary.md) — terms used throughout these docs.
