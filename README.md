# Particle Realms Platform — Engine v0.8.1-alpha

**A pure-browser WebGPU engine, editor, Plauna UI framework, AGI runtime, Playground, and WebGPU OS stack — native ES modules, Python tooling, and zero npm runtime dependencies.**

[![Engine v0.8.1-alpha](https://img.shields.io/badge/Engine-v0.8.1--alpha-38bdf8?style=flat-square)](https://github.com/BTSpaniel/particlerealms.engine)
[![Editor v0.6.0-alpha](https://img.shields.io/badge/Editor-v0.6.0--alpha-a78bfa?style=flat-square)](https://github.com/BTSpaniel/particlerealms.engine)
[![WebGPU](https://img.shields.io/badge/WebGPU-Native-10b981?style=flat-square)](https://www.w3.org/TR/webgpu/)
[![Zero npm](https://img.shields.io/badge/npm-runtime%20dependencies-zero-f59e0b?style=flat-square)](#)

**🌐 Live: [particlerealms.online](https://particlerealms.online/)**

**📦 Platform download:** [BTSpaniel/particlerealms.engine](https://github.com/BTSpaniel/particlerealms.engine)

**🌐 Optional master server:** [BTSpaniel/particlerealms.engine-master-server](https://github.com/BTSpaniel/particlerealms.engine-master-server) — discovery, admission, encrypted signaling, and TURN; it is not gameplay authority.

**🧭 Start here:** [Learn the Engine](https://particlerealms.online/learn/) · [Canonical starter](https://particlerealms.online/learn/starter/) · [Playground](https://particlerealms.online/playground/) · [Guide](https://particlerealms.online/guide/) · [API](https://particlerealms.online/api/)

**🧩 Chrome Companion:** [WebGPU OS Companion](https://chromewebstore.google.com/detail/webgpu-os-companion/pbibggeclfjpmmbfmjagmngefonepbjj) — an optional, permission-gated bridge for supported browser and OS capabilities. It does not add WebGPU support to an unsupported browser or device.

> Engine started **Nov 17, 2025** · Editor started **Dec 3, 2025**

---

## Overview

Particle Realms' first-party code is a from-scratch browser platform composed in this order: Engine → Editor → Plauna → AGI → WebGPU OS. The Engine provides the WebGPU runtime, ECS, rendering, simulation, physics, audio, networking, and world systems. The other subsystems consume that runtime rather than replacing it; the identified third-party runtimes below retain their original authorship.

Development uses browser-native ES modules served over HTTP. The Python release tool walks the real dependency graph and produces compressed single-file runtimes plus a self-contained public site. No npm or Node.js build step is required.

### Current platform upgrade

- **New public journey** — the homepage now routes visitors deliberately through Learn, Playground, WebGPU OS, the Chrome Companion, platform downloads, and the separate optional master server.
- **Engine Academy** — eight slow-autoplay, presentation-style chapters connect staged source to validation and runtime evidence. Only exact visible WGSL is compiled; source walkthroughs never receive fabricated particle output.
- **Canonical starter** — one complete application uses real public GPU, canvas-surface, ECS, Transform, and frame-step APIs, including capability fallback and device-loss handling.
- **Playground Observatory** — Gallery and Focus views add stable deep links, search, keyboard navigation, runtime/source receipts, State-First evidence, and the six-contract Render Surface Observatory.
- **Guide and API** — both use the shared crawler-readable documentation interface without iframe wrappers. Static Markdown, search data, symbol catalogs, JSONL feeds, and `llms*.txt` are generated from the repository.
- **Release completeness** — the platform bundle now verifies runtime workers, WASM, JSON/CSS/image sidecars, WebGPU OS factory assets, Academy dependencies, module edges, public-tree membership, and ZIP bytes before publication.

---

## Codebase

| Component | Files | Physical lines |
|-----------|------:|---------------:|
| **Engine** | 1,686 | 485,092 |
| **Editor** | 187 | 121,081 |
| **Plauna** | 165 | 88,613 |
| **AGI** | 263 | 50,909 |
| **WebGPU OS** | 1,403 | 426,968 |
| **Total** | **3,704** | **1,172,663** |

These are generated first-party metrics from `release/code-metrics.json` for the current platform build. Vendored code, generated/minified output, release artifacts, and `engine/sim/physics/` are excluded.

### Subsystems

| Subsystem | Files | Category |
|-----------|------:|----------|
| Rendering | 434 | Render |
| Particle Sim | 429 | Simulation |
| AI + AGI | 332 | Intelligence |
| Shaders & WGSL | 183 | Render |
| Math Library | 120 | Core |
| ECS | 116 | Core |
| Audio | 110 | Core |
| World | 85 | World |
| GPU Core | 81 | Core |
| Physics-owned source | 74 | Simulation |
| Voxel | 34 | World |

Subsystem categories overlap by design; a shader-backed simulation may be counted in both its simulation and rendering domains.

---

## Features

### GPU Core
- **VGPU abstraction** — makes raw WebGPU feel like 5 lines of code
- **Frame graph** — automatic resource management and pass scheduling
- **Compute pipeline** — first-class GPU compute with storage buffers, atomics, indirect dispatch
- **Shader composer** — modular WGSL shader system with hot-reload

### Rendering
- **HDR pipeline** — tonemap, bloom, film grain, vignette, chromatic aberration
- **PBR materials** — metallic-roughness workflow, normal/AO/emissive maps
- **Shadow system** — cascaded shadow maps, shadow atlas, PCF filtering
- **Post-processing** — TAA, FSR, FXAA, SSR, SSAO, SSGI, motion blur, god rays, lens flare
- **Volume rendering** — isosurface, volumetric clouds, underwater, atmospheric scattering
- **SDF rendering** — signed distance field raymarching, SDF billboards for particles
- **Debug visualization** — depth, normals, wireframe, overdraw, motion vectors

### Particle System
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

### Physics
- **PhysX WebIDL** — browser WASM integration for rigid bodies, joints, articulations, scene queries, mesh cooking, vehicles, and character controllers; provenance is documented below
- **GPU broadphase** — spatial hash on compute for collision detection
- **PBD solver** — position-based dynamics for soft bodies and ragdolls
- **MLS-MPM** — material point method for deformable solids
- **Voronoi fracture** — runtime mesh destruction with structural integrity
- **Cloth** — GPU cloth solver with wind interaction

### Audio
- **30+ synthesis nodes** — oscillators, filters, envelopes, effects, physical modeling
- **Visual node graph** — drag-and-drop patch editor in the browser
- **Spatial audio** — 3D positioned sources with distance attenuation, reverb zones
- **Physics-to-sound** — material impact mapping, thermal crackling, fluid splashes
- **Voice chat** — WebRTC voice with spatial positioning

### ECS
- **Archetype storage** — cache-friendly component layout
- **Systems pipeline** — ordered system execution with dependency tracking
- **Queries** — filtered iteration over entity sets
- **Events** — type-safe event bus for decoupled communication

### World
- **Voxel terrain** — chunked voxel world with GPU meshing and compression
- **Procedural generation** — biome system, thermal/wind erosion, tectonic simulation
- **Wind simulation** — GPU-driven wind field affecting particles, cloth, vegetation
- **Day/night cycle** — celestial bodies (sun, moon, stars), sky rendering, volumetric clouds

### AI + AGI
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
- **App ecosystem** — 44 indexed apps and 2 indexed mods are validated and compiled into the current platform bundle
- **Navi and AI Hub** — capability-gated model routing, task execution, signed Faculty packages, durable diagnostics, and explicit user approval boundaries
- **Chrome Companion** — the optional [WebGPU OS Companion](https://chromewebstore.google.com/detail/webgpu-os-companion/pbibggeclfjpmmbfmjagmngefonepbjj) connects separately approved browser sessions, packaged automation, tab audio, and user-configured AI providers
- **Network boundary** — the browser runtime owns gameplay state; the separate optional master server supplies discovery, admission, encrypted signaling, state-channel infrastructure, and TURN where configured

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

## Engine Academy

The Academy at [`/tests/learn/`](http://127.0.0.1:9001/tests/learn/) is an interactive presentation rather than a prerecorded video:

- Eight chapters cover the stack map, local serving, GPU capability acquisition, canvas surfaces, ECS state, an exact WGSL pipeline, frame ordering, and the Playground/OS hand-off.
- Source is written gradually while a virtual director highlights the active line, scrolls safely, and moves focus to validated output.
- Playback starts slowly, pauses for real user interaction, supports keyboard controls and transcripts, and respects reduced-motion preferences.
- PowerShell, file-tree, manifest, and JavaScript chapters display source-derived walkthroughs or validation receipts. They are not mislabeled as compiled demos.
- The GPU chapter sends the exact visible WGSL to `GPUShaderModule`; compilation messages, unsupported WebGPU, and device loss remain visible. No decorative particles are substituted.
- The [canonical starter](tests/learn/starter/) is a complete runnable application built only from verified public exports.

---

## Playground

The static release manifest currently exposes 31 focused studies through one shared Observatory shell. Development serving can additionally discover compatible demo modules directly from `tests/playground/src/demos/`.

Current studies include Particle Storm, N-Body Encounters, Reaction Atlas, Astral Sanctuary SDF, PBR Observatory, Double-Slit Atelier, Galaxy, Curl Noise, SPH Fluid, Cup Water, Living Formicarium, Actuated City Drive, MorphField, State Rasterizer, Mandelbrot, two Kuramoto paths, sandboxes, asset importing, and runtime telemetry.

The **Render Surface Observatory** demonstrates six real source contracts through one manager and GPU device: editable code, terminal output, interval-driven Canvas, static image, live Canvas video, and zero-copy WebGPU. Gallery and Focus views remain keyboard accessible, deep-linkable, searchable, and tied to source/runtime receipts.

---

## Architecture

### Tech Stack
- **Client:** Pure browser JavaScript (ES modules, WebGPU API)
- **Development server:** Python 3.11+ (`start_server.py`) serving the repository root over HTTP with the local runtime routes
- **Optional network service:** the separate [master-server repository](https://github.com/BTSpaniel/particlerealms.engine-master-server); it is infrastructure, not gameplay authority
- **Bundler:** Python (`bundle_engine.py`) — builds single-file runtimes and a verified static site with gzip, Brotli, Zstandard, and LZMA outputs
- **Zero npm** — no Node.js, no webpack, no build step for development

### Folder Structure
```
engine/                    # WebGPU runtime, ECS, rendering, simulation
├── core/                 # GPU abstraction, frame graph, math, profiler, scheduler
├── ecs/                  # Entity-component-system
├── render/               # Rendering pipeline, passes, materials, shaders, volumes
├── sim/                  # Particles, physics, fluids, cloth, AI, world sim
├── audio/                # Synthesis, spatial audio, voice chat
├── network/              # Endpoints, routes, replication, state channels
├── voxel/                # Voxel terrain, GPU meshing, compression
├── world/                # World systems, storage, zones
└── version.js            # Canonical version source

editor/                   # Visual scene and asset editor
├── js/                   # Editor modules, tools, asset editors
├── css/                  # Theme stylesheets
└── index.html            # Editor entry point

plauna/                   # Retained DOM/GPU UI framework
agi/                      # AGI Studio, tensors, model/runtime tooling
webgpu-os/                # Kernel, compositor, drivers, factory apps and mods

tests/                    # Public product surfaces
├── index.html            # Product homepage and launch pathways
├── learn/                # Academy plus canonical starter
├── playground/           # Observatory and focused engine studies
├── guide/                # Direct shared documentation interface
└── api/                  # Direct API interface

MD/                       # Canonical Markdown documentation and build tools
bundler/                  # Python graph, emitter, site and signing pipeline
start_server.py           # Development HTTP server
bundle_engine.py          # Release CLI
release/                  # Generated runtimes and self-contained site ZIPs
```

### Bundled Runtime

The latest verified `platform` build walked 2,847 modules with zero skipped and produced:

| Stage | Size |
|-------|------|
| Source graph | 41.53 MB |
| Minified runtime | 32.61 MB |
| Gzip | 7.84 MB |
| Brotli | 7.11 MB |
| **Zstandard** | **6.98 MB** |
| Self-contained site ZIP | 81.29 MB / 680 entries |

The release contract also validates 78 cross-subsystem sidecars, 35 WebGPU OS runtime/PWA assets, 56 canonical-starter Engine dependencies, 253 Playground module edges, 97 Academy module edges, and byte parity between staged files and archive members.

---

## Quick Start

```bash
# Clone
git clone https://github.com/BTSpaniel/particlerealms.engine.git
cd particlerealms.engine

# Serve the repository root with the project server
python start_server.py

# Open in a current Chrome/Edge build with WebGPU
# http://127.0.0.1:9001/tests/index.html
```

No package install or JavaScript build step is required for development.

| Surface | Local route |
|---------|-------------|
| Homepage | `http://127.0.0.1:9001/tests/index.html` |
| Engine Academy | `http://127.0.0.1:9001/tests/learn/` |
| Canonical starter | `http://127.0.0.1:9001/tests/learn/starter/` |
| Playground | `http://127.0.0.1:9001/tests/playground/` |
| Guide | `http://127.0.0.1:9001/tests/guide/` |
| API | `http://127.0.0.1:9001/tests/api/` |
| WebGPU OS | `http://127.0.0.1:9001/webgpu-os/` |

### Build Release Bundle

```bash
python bundle_engine.py --target platform --production --release --no-cache
```

Output goes to `release/` with the compressed platform runtime, manifest, metrics, validated static site, and `particle-platform-site.zip`. Use `--target engine` when only the Engine/SDK target is required.

### Rebuild Documentation and AI Discovery

```bash
python MD/tools/extract_api.py
python MD/tools/build_docs.py
python MD/tools/build_llms.py
python MD/tools/validate_docs.py
```

`MD/` is the documentation source of truth. The build emits human navigation/search data plus root discovery assets including `llms.txt`, `llms-full.txt`, `api-index.json`, `docs-chunks.jsonl`, `api-symbols.jsonl`, `robots.txt`, and `sitemap.xml`. The current generated feeds contain 3,428 bounded documentation chunks and 19,452 source-backed API-symbol records.

---

## Development Guidelines
- **No Node.js** — client code runs in pure browser ES modules
- **GPU-first** — prefer compute shaders for heavy simulation
- **ECS-driven** — all gameplay state lives in components
- **Explicit authority** — simulation, peer, and service authority must be declared by the owning subsystem; the optional master server is never assumed to own gameplay

---

## Third-party physics runtime

Particle Realms' browser PhysX integration uses the prebuilt [`physx-js-webidl` v2.7.3 release](https://github.com/fabmax/physx-js-webidl/releases/tag/v2.7.3) by Max Thiele (`fabmax`). That project provides JavaScript/WebAssembly bindings for NVIDIA PhysX 5.6.1.

The published [`physx-js-webidl.wasm`](https://github.com/BTSpaniel/particlerealms.engine/blob/main/physx-js-webidl.wasm) is an unmodified copy of the binary from [fabmax/physx-js-webidl](https://github.com/fabmax/physx-js-webidl). The vendored runtime used by the Engine lives at [`engine/sim/physics/physx-js-webidl.wasm`](engine/sim/physics/physx-js-webidl.wasm) and is deployed by the platform bundler where the browser and Editor can resolve it.

- **File size:** 5,347,727 bytes
- **SHA-256:** `7D4696E6273166308CE1F0DB5DD5AEE96C843B6E3722D96DB7E4422AA1FBEE1F`
- **Bindings license:** [MIT](https://github.com/fabmax/physx-js-webidl/blob/v2.7.3/LICENSE), Copyright © 2021 Max Thiele
- **Included PhysX notice:** [upstream v2.7.3 notice](https://github.com/fabmax/physx-js-webidl/blob/v2.7.3/NOTICE.md) and the repository's [`engine/sim/physics/NOTICE.md`](engine/sim/physics/NOTICE.md)
- **Project-wide notices:** [`NOTICE.md`](NOTICE.md)

Particle Realms' adapters and Engine integration are separate from these third-party artifacts. The bindings and included NVIDIA PhysX code retain their original authorship and license terms; they are not relicensed under `LicenseRef-ParticleRealms-Alpha`.

---

## License

Particle Realms first-party source and release artifacts use the custom [Source-Available Alpha License](LICENSE), referenced in source headers as [`LicenseRef-ParticleRealms-Alpha`](LICENSES/LicenseRef-ParticleRealms-Alpha.txt). It permits viewing, downloading, running, and modifying the alpha for personal evaluation and internal testing, but it is not an OSI-approved open-source license and does not permit commercial production, redistribution, sublicensing, sale, or competing hosted use without written permission.

Third-party components retain their own licenses. See [`NOTICE.md`](NOTICE.md) and the component-specific notices linked above.

---

**Particle Realms' first-party platform is built from scratch with WebGPU. Third-party components retain their original authorship and licenses.**
