<!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel> -->
<!-- SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha -->

# Particle Realms Engine

Build browser games, simulations, and interactive tools with **Particle Engine and Plauna UI**. Engine provides WebGPU rendering, ECS, native physics, audio, and networking. Plauna supplies the UI framework.

**Browser JavaScript. Python tooling. No npm application dependencies.**

[Release](https://github.com/BTSpaniel/particlerealms.engine/releases/tag/v0.8.1-alpha.1) · [Live platform](https://particlerealms.online/) · [Learn](https://particlerealms.online/learn/) · [Playground](https://particlerealms.online/playground/) · [Documentation](https://particlerealms.online/guide/)

## Choose your starting point

| Start with | Includes |
| --- | --- |
| **[Engine + Plauna SDK](engine-sdk/)** | Sources, compiled APIs, verified PhysX PE and compute assets, source/compiled examples, offline documentation, and Python rebuild tools. Clone this repository to get the SDK files. |
| **[Template.zip](Template.zip)** | The existing application starter with the full compiled Platform runtime, PhysX PE, local server, and OS/Plauna/Canvas launcher. Also available from the [release](https://github.com/BTSpaniel/particlerealms.engine/releases/tag/v0.8.1-alpha.1). |

The SDK's compiled runtime includes Engine and Plauna. The Template's compiled Platform runtime includes Engine, Editor, Plauna, AGI, and WebGPU OS. Full API documentation and rebuilding tools live in the SDK.

## Run the SDK

```powershell
git clone https://github.com/BTSpaniel/particlerealms.engine.git
cd particlerealms.engine/engine-sdk
python serve_sdk.py --port 9002 --isolate
```

Open **<http://127.0.0.1:9002/>** in a browser with a working WebGPU adapter. The landing page verifies the compiled runtime and links source examples, compiled examples, and offline documentation. Serving uses Python's standard library.

**Serve over HTTP.** Double-clicking `index.html` creates a `file://` origin, which blocks module scripts and runtime fetches. Public hosting requires HTTPS. `--isolate` enables the headers needed by threaded compute and `SharedArrayBuffer`.

The examples exercise rendering, ECS, real PhysX PE simulation, a Surface Field worker, and Plauna interaction. Each example reports its checks and provides a **Release resources** action.

Read the [SDK guide](engine-sdk/MD/guides/sdk-distribution.md), or open `MD/viewer/?doc=guides/sdk-distribution.md` on the SDK server.

## Start from Template.zip

Extract [Template.zip](Template.zip), open its `Template` directory, and run:

```powershell
python serve.py 9002
```

Open <http://127.0.0.1:9002/>. Windows users can run `launch.bat --port 9002`; the default Template port is 8000.

Choose **WebGPU OS**, **Plauna Showcase**, or **Blank Canvas**. Your application owns its canvas, frame loop, and resources. The included README explains the launcher, compiled APIs, hosting, and cleanup.

Keep the runtime, loader, styles, and native/worker dependencies together when copying the Template. Its loader verifies the runtime's decoded byte count and SHA-384 integrity before execution.

## Use Engine and Plauna

In an application at the SDK root, import the public source entry points:

```javascript
import { createWorld, createEntity } from './engine/EngineBootstrap.js';
import * as Plauna from './plauna/index.js';

const world = createWorld({ name: 'My application' });
const entity = createEntity(world);
```

For compiled mode, preserve the loader tag supplied by the SDK example or Template, then await its verified runtime:

```javascript
const PE = await globalThis.__PE_RUNTIME_READY;
const world = PE.createWorld({ name: 'My application' });
const entity = PE.createEntity(world);
const UI = PE.Plauna;
```

The Template also exposes `PE.Editor`, `PE.AGI`, and `PE.WebGPUOS`. OS boot is explicit. Use the shipped examples and documentation for subsystem-specific initialization and lifecycle ownership.

## Rebuild the SDK's JavaScript runtime

From `engine-sdk`, use the exact environment recorded in `sdk-build.json`. The baseline is **Python 3.12.7**, pinned dependencies, and **rjsmin 1.2.5**. Install prerequisites explicitly before working offline:

```powershell
python -m pip install -r requirements-sdk.txt
python bundle_engine.py --sdk-rebuild
```

Intermediate runtime files go to `build/runtime`; the rebuilt SDK goes to `build/engine-sdk`. Builds verify inputs and tools and do not download missing prerequisites.

Rebuilding JavaScript reuses the supplied, verified native WASM. Recompiling PhysX, Blast, Flow, or Rust kernels requires their separate toolchains. Private signing keys are not included or required. Signed-owner changes require an authorized replacement public package; the [SDK guide](engine-sdk/MD/guides/sdk-distribution.md) explains that boundary.

## Verification

The SDK's [manifest](engine-sdk/manifest.json) records exact file hashes, public entry points, build inputs, and tool identities. Runtime manifests and provenance bind the compiled bytes to their inputs. Git preserves the SDK bytes without line-ending conversion. [SDK-VALIDATION.json](SDK-VALIDATION.json) records the measured checks and Template checksum for this release.

Package checks cover root and nested hosting, source and compiled examples, workers, native physics, cleanup, unsupported-browser diagnostics, and offline rebuilding. Two builds in the pinned environment produced identical runtime bytes; a changed Engine CPU function executed in its rebuilt runtime. The release notes record the final Template size and checksum.

## License and attribution

Created by [Jake Wehmeier (BTSpaniel)](https://github.com/BTSpaniel). See [AUTHORS](AUTHORS).

First-party code uses the [source-available alpha license](LICENSE). Personal evaluation and internal testing are permitted. Commercial production, redistribution, sublicensing, sale, and competing hosted use require written permission. This is not an OSI-approved open-source license.

Third-party components retain their licenses and attribution. See [NOTICE.md](NOTICE.md), [NVIDIA PhysX](https://github.com/NVIDIA-Omniverse/PhysX), [fabmax/physx-js-webidl](https://github.com/fabmax/physx-js-webidl), and the standalone [PhysX PE distribution](https://github.com/BTSpaniel/Physx). Each package's native inventory identifies the exact supplied binaries.
