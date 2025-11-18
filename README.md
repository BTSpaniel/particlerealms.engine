# Particle Engine

**A WebGPU-powered game engine with ECS architecture, Netcode, and Server Meshing.**

[![WebGPU](https://img.shields.io/badge/WebGPU-Enabled-green.svg)](https://www.w3.org/TR/webgpu/)
[![Python](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/)

---

## 🎯 Project Status

**Engine v2 is currently in active development.** The legacy v1 engine has been archived to `J:\game\old`. This repository contains the complete rewrite with modern architecture.

**Current Phase:** Planning & Architecture  
**Target:** Production-ready multiplayer game engine with 60 FPS @ 300k+ entities

---

## 🚀 Features

### Core Engine
- **Pure WebGPU Rendering** – GPU-driven rendering with compute shaders, no WebGL fallback
- **ECS v2 Architecture** – Clean entity-component-system with no scene graph pollution
- **Source-Style Netcode** – Client prediction, lag compensation, server authority
- **Server Meshing** – Seamless zone transitions with 100+ players per zone
- **Frame Graph** – Automatic resource management and pass scheduling

### Simulation Systems
- **GPU Particle System** – 100k+ particles with compute-based physics
- **Fluid Simulation** – Real-time fluid dynamics on GPU
- **Cloth Simulation** – Mass-spring cloth solver
- **Procedural Terrain** – Infinite terrain generation with biomes

### Networking
- **PlayerCmd Streams** – Tick-based input commands (client → server)
- **Snapshot Replication** – Delta-compressed state updates (server → client)
- **AOI System** – Area-of-interest filtering for bandwidth optimization
- **Zone Handoff** – <500ms seamless transitions between server zones
- **Ed25519 Signatures** – Cryptographic action verification

### Content & Modding
- **Resource System** – Hot-reloadable resource packages
- **Map System** – Maps as resources, independent of zone infrastructure
- **Modding API** – Sandboxed scripting layer (Python/JS)
- **Editor Tools** – In-engine inspector, profiler, and debug tools

---

## 🏗️ Architecture

### Tech Stack
- **Server:** Python 3.11+ (FastAPI, uvicorn, Redis)
- **Client:** Browser JavaScript (ES modules, WebGPU API)
- **No Node.js** – Pure browser runtime, no build step required for development

### Folder Structure
```
engine/                    # Engine v2 core
├── core/                 # WebGPU, frame graph, events
├── ecs/                  # Entity-component-system
├── render/               # Rendering pipeline (passes, materials, shaders)
├── sim/                  # Physics, world, particles, fluids, AI
├── net/                  # Netcode (protocol, client, server, replication)
├── audio/                # Audio & voice (SFX, WebRTC voice chat)
├── resources/            # Resource system (manifests, loader, runtime)
├── mod/                  # Modding layer (API, sandbox runtime)
├── ui/                   # Runtime UI (chat, speech bubbles, HUD)
├── tools/                # Inspector, profiler, debug tools
└── compat/               # Asset importers (glTF, VRM)

game/                     # Game implementation
├── server/               # Game server (FastAPI + netcode v2)
├── client/               # Game client (WebGPU + ECS)
└── assets/               # Game assets

editor/                   # Standalone editor application
├── js/                   # Editor core, tools, asset editors
└── assets/               # Editor-specific assets

```

## 🎮 Performance Targets

| Metric | Target |
|--------|--------|
| **FPS** | 60 FPS (mid-range GPU: RTX 3060) |
| **Entities** | 30,000+ per zone |
| **Players** | 100+ per zone |
| **Latency** | <100ms round-trip |
| **GPU Sims** | 120+ FPS (particles, fluids, cloth) |
| **Zone Handoff** | <500ms seamless transition |
| **Bandwidth** | <10 KB/s per player (compressed) |

## 🤝 Contributing

Engine v2 is currently in active development. Contributions are welcome once the core architecture stabilizes.

### Development Guidelines
- **No Node.js** – Client code must run in pure browser environment
- **GPU-first** – Prefer compute shaders for heavy simulation
- **ECS-driven** – All gameplay state lives in components
- **Server authority** – Client prediction only, server validates all actions

---


## 🙏 Acknowledgments

- **WebGPU Community** – For the next-gen graphics API

---

**Built with ❤️ for next-generation multiplayer experiences.**
