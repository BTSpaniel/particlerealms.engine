# Engine v2 Core

This directory contains the core engine implementation for Particle Engine v2.

## Structure

- **`core/`** - WebGPU core, frame graph, platform integration
- **`ecs/`** - Entity-component-system architecture
- **`render/`** - Rendering pipeline (passes, materials, shaders)
- **`sim/`** - Simulation systems (physics, particles, fluids, AI)
- **`net/`** - Networking (protocol, replication, client/server)
- **`audio/`** - Audio and voice systems
- **`resources/`** - Resource system (FiveM/MTA-style packages)
- **`mod/`** - Modding layer (scripting API and sandbox)
- **`ui/`** - Runtime UI components
- **`tools/`** - Development tools (inspector, profiler)
- **`compat/`** - Asset importers and compatibility layer

## Development Guidelines

- **Pure browser runtime** - No Node.js dependencies
- **GPU-first** - Prefer compute shaders for heavy simulation
- **ECS-driven** - All state lives in components
- **Modular** - Each subsystem is independent and testable

## Getting Started

See the main [README.md](../README.md) and [Enginev2plan.md](../_windsurf/Enginev2plan.md) for the complete development plan.
