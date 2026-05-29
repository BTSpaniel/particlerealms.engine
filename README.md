# Particle Engine v0.8.1

**A pure WebGPU game engine — 1,308 source files, 552K lines of code, zero dependencies.**

[![Engine v0.8.1-alpha](https://img.shields.io/badge/Engine-v0.8.1--alpha-38bdf8?style=flat-square)](https://github.com/BTSpaniel/ParticleEngine)
[![Editor v0.6.0-alpha](https://img.shields.io/badge/Editor-v0.6.0--alpha-a78bfa?style=flat-square)](https://github.com/BTSpaniel/ParticleEngine)
[![WebGPU](https://img.shields.io/badge/WebGPU-Native-10b981?style=flat-square)](https://www.w3.org/TR/webgpu/)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-f59e0b?style=flat-square)](#)

**🌐 Live: [particlerealms.online](https://particlerealms.online/)**

> Engine started **Nov 17, 2025** · Editor started **Dec 3, 2025** · ~3 months of active development

---

## Overview

Particle Engine is a from-scratch WebGPU game engine with an ECS architecture, GPU compute simulation pipeline, procedural audio, and a full visual editor. Everything runs in the browser with zero npm dependencies — pure ES modules, no build step required for development.

**Live demo:** The landing page runs a real-time WebGPU particle sandbox with 20K particles, 7 substance types, and density-grid physics.

---

## Codebase

| Component | Files | Lines |
|-----------|------:|------:|
| **Engine** | 1,136 | 445,507 |
| **Editor** | 172 | 107,035 |
| **Total** | **1,308** | **552,542** |

### Subsystems

| Subsystem | Files | Category |
|-----------|------:|----------|
| Particle Sim | 334 | Simulation |
| Rendering | 289 | Render |
| Shaders & WGSL | 110 | Render |
| Audio | 62 | Core |
| GPU Core | 55 | Core |
| Physics | 50 | Sim |
| World | 48 | World |
| ECS | 46 | Core |
| AI | 43 | Sim |
| Particle Render | 42 | Render |
| Math Library | 34 | Core |
| Voxel | 24 | World |

---

## Features

### GPU Core
- **VGPU abstraction** — makes raw WebGPU feel like 5 lines of code
- **Frame graph** — automatic resource management and pass scheduling
- **Compute pipeline** — first-class GPU compute with storage buffers, atomics, indirect dispatch
- **Shader composer** — modular WGSL shader system with hot-reload

### Rendering (289 files)
- **HDR pipeline** — tonemap, bloom, film grain, vignette, chromatic aberration
- **PBR materials** — metallic-roughness workflow, normal/AO/emissive maps
- **Shadow system** — cascaded shadow maps, shadow atlas, PCF filtering
- **Post-processing** — TAA, FSR, FXAA, SSR, SSAO, SSGI, motion blur, god rays, lens flare
- **Volume rendering** — isosurface, volumetric clouds, underwater, atmospheric scattering
- **SDF rendering** — signed distance field raymarching, SDF billboards for particles
- **Debug visualization** — depth, normals, wireframe, overdraw, motion vectors

### Particle System (334 + 42 files)
- **GPU compute simulation** — emit, alive-list compaction, physics, sorting per frame
- **Chemistry engine** — 50+ substance materials with reaction tables, thermal propagation
- **SPH fluid** — smoothed particle hydrodynamics with density/pressure kernels
- **Eulerian fluid** — grid-based density field with pressure forces
- **Bonds & constraints** — particle-to-particle bonds, rope physics, ribbon trails
- **N-body gravity** — O(N²) GPU gravitational interaction
- **Flocking** — boids cohesion/separation/alignment
- **SDF collision** — particles collide against arbitrary signed distance fields
- **Adaptive substep** — automatic timestep subdivision for stability
- **LOD** — emitter-level LOD with distance-based quality scaling

### Physics (50 files)
- **PhysX WebIDL** — PhysX WASM integration for rigid bodies, joints, articulations
- **GPU broadphase** — spatial hash on compute for collision detection
- **PBD solver** — position-based dynamics for soft bodies and ragdolls
- **MLS-MPM** — material point method for deformable solids
- **Voronoi fracture** — runtime mesh destruction with structural integrity
- **Cloth** — GPU cloth solver with wind interaction

### Audio (62 files)
- **30+ synthesis nodes** — oscillators, filters, envelopes, effects, physical modeling
- **Visual node graph** — drag-and-drop patch editor in the browser
- **Spatial audio** — 3D positioned sources with distance attenuation, reverb zones
- **Physics-to-sound** — material impact mapping, thermal crackling, fluid splashes
- **Voice chat** — WebRTC voice with spatial positioning

### ECS (46 files)
- **Archetype storage** — cache-friendly component layout
- **Systems pipeline** — ordered system execution with dependency tracking
- **Queries** — filtered iteration over entity sets
- **Events** — type-safe event bus for decoupled communication

### World (48 files)
- **Voxel terrain** — chunked voxel world with GPU meshing and compression
- **Procedural generation** — biome system, thermal/wind erosion, tectonic simulation
- **Wind simulation** — GPU-driven wind field affecting particles, cloth, vegetation
- **Day/night cycle** — celestial bodies (sun, moon, stars), sky rendering, volumetric clouds

### AI (43 files)
- **Behavior trees** — GPU-accelerated AI decision making
- **Navigation** — pathfinding, steering, flocking
- **TensorFlow.js** — optional ML integration via WASM/WebGPU backends

### Networking
- **Source-style netcode** — client prediction, lag compensation, server authority
- **Snapshot replication** — delta-compressed state updates
- **Ed25519 signatures** — cryptographic action verification
- **Collab** — real-time multi-user editing (25 files)

### WebGPU OS
A browser-based desktop environment built on the engine, served live at [particlerealms.online](https://particlerealms.online/):
- **Microkernel** — process table, app registry, sandboxed encrypted per-app storage (OPFS + IndexedDB), permissions, package/patch managers
- **Windowing** — Plauna DOM panels with drag/resize/maximize, plus a **GPU-native compositor** that renders live windows as 3D quads with per-window textures and input forwarding
- **Immersive Exposé** — middle-click parallax view; per-window adaptive-FPS live capture (HTML-in-Canvas → extension → Element Capture → native)
- **App ecosystem** — 33 built-in apps + a mod/patch bus, all compiled into the single platform bundle
- **Frame Unblocker extension** — optional MV3 extension that strips iframe-blocking headers so the browser app can embed any site

---

## Editor (v0.6.0-alpha)

Full visual editor running in the browser:
- **Inspector** — entity/component editor panels
- **Material editor** — PBR material authoring with live preview
- **Audio editor** — visual node-graph patch editor
- **Asset panel** — drag-and-drop asset management
- **Gizmos** — translation, rotation, scale handles
- **Dark theme** — custom CSS theme system

---

## Playground

17 interactive GPU compute demos:
- **Particle Storm** — 134M adaptive-quality particles with benchmark
- **N-Body Gravity** — 4K bodies with O(N²) GPU gravity
- **Reaction-Diffusion** — Gray-Scott 512² compute
- **SDF Raymarcher** — real-time sphere tracing + AO
- **PBR Lighting** — path-traced metallic sphere, GGX VNDF
- **Mandelbrot** — GPU fractal explorer + Julia mode
- **SPH Fluid** — 4K–12K 3D smoothed particle hydrodynamics
- **Boids Ecosystem** — 20K agents, colonies, elders, war chains
- **Wave Terrain** — infinite raymarched terrain, click wave sources
- **Ant Colony** — 50K ants, dual pheromone grids, emergent foraging highways
- **Sandbox 2D** — 512² falling sand (sand, water, fire, stone, oil, smoke, steam)
- **Water Bottle** — 3D raymarched glass bottle with sloshing liquid
- **Sandbox 3D** — 100K billboard particles, 3D falling sand with materials
- **Galaxy** — 500K stars, spiral arms, Keplerian orbits
- **Curl Noise** — 200K particles in 3D noise field
- **Thermal** — 300K particles, GPU phase transitions
- **Runtime Info** — animated stats + music

---

## Architecture

### Tech Stack
- **Client:** Pure browser JavaScript (ES modules, WebGPU API)
- **Server:** Python 3.11+ (FastAPI, uvicorn, Redis)
- **Bundler:** Python (`bundle_engine.py`) — builds single-file runtime with gzip/brotli/zstd compression
- **Zero npm** — no Node.js, no webpack, no build step for development

### Folder Structure
```
engine/                    # Engine core (1,136 files)
├── core/                 # GPU abstraction, frame graph, math, profiler, scheduler
├── ecs/                  # Entity-component-system
├── render/               # Rendering pipeline, passes, materials, shaders, volumes
├── sim/                  # Particles, physics, fluids, cloth, AI, world sim
├── audio/                # Synthesis, spatial audio, voice chat
├── net/                  # Netcode (protocol, client, server, replication)
├── collab/               # Real-time multi-user editing
├── tools/                # Inspector, gizmos, animation, rigging
├── voxel/                # Voxel terrain, GPU meshing, compression
├── world/                # World systems, storage, zones
├── resources/            # Resource system, asset loading
├── mod/                  # Modding API, sandbox runtime
├── ui/                   # Runtime UI, themes
└── version.js            # Canonical version source

editor/                   # Visual editor (172 files)
├── js/                   # Editor modules, tools, asset editors
├── css/                  # Theme stylesheets
└── index.html            # Editor entry point

tests/                    # Landing page, docs, playground
├── index.html            # Landing page with live WebGPU particle sandbox
├── playground/           # 12-demo GPU compute playground
├── guide/                # Documentation (architecture, rendering, audio, etc.)
├── api/                  # API reference
└── assets/               # Bundled runtime (.js, .min.js, .br, .zst)

server/                   # Game server (Python/FastAPI)
├── api/                  # REST endpoints (auth, assets, modules, TURN)
├── core/                 # Connection manager, session manager, module server
├── security/             # Ed25519 signing, Steam whitelist, crypto
└── game/                 # Entity sync, world state

game/                     # Game implementation
├── src/                  # Game client code
└── vendor/               # TensorFlow.js WASM binaries

bundle_engine.py          # Runtime bundler (builds single-file release)
```

### Bundled Runtime

The bundler (`bundle_engine.py`) walks the ES module dependency graph and produces a single self-contained runtime:

| Stage | Size |
|-------|------|
| Source | 13.06 MB (865 modules) |
| Minified | 9.90 MB |
| Gzip | 2.00 MB |
| Brotli | 1.72 MB |
| **Zstd** | **1.66 MB** |

---

## Quick Start

```bash
# Clone
git clone https://github.com/BTSpaniel/ParticleEngine.git
cd ParticleEngine
git checkout v0.8.1-dev

# Serve locally (any static server works)
python -m http.server 8000 -d tests

# Open in Chrome/Edge (WebGPU required)
# http://localhost:8000/
```

No install, no build step. Open the landing page to see the live particle sandbox, or navigate to `/playground/` for all 12 GPU demos.

### Build Release Bundle

```bash
python bundle_engine.py --target engine --production --release --no-cache
```

Output goes to `release/` with compressed runtime assets, a curated docs site, and an engine SDK package.

---

## Development Guidelines
- **No Node.js** — client code runs in pure browser ES modules
- **GPU-first** — prefer compute shaders for heavy simulation
- **ECS-driven** — all gameplay state lives in components
- **Server authority** — client prediction only, server validates all actions

---

## License

All rights reserved. This project is not open source.

---

**Built from scratch with WebGPU.**
