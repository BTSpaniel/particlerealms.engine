<!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel> -->
<!-- SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha -->

<h1 align="center">Particle Realms Engine SDK</h1>

<p align="center">
  <a href="engine-sdk/">
    <img src="https://raw.githubusercontent.com/BTSpaniel/BTSpaniel/main/assets/engine-card.svg" width="420" alt="Particle Realms Engine: rendering, physics and world systems." />
  </a>
</p>

<p align="center">
  <strong>Build worlds in the browser.</strong><br />
  WebGPU rendering, ECS, native physics and Plauna UI on one foundation.<br />
  Browser ES modules. Python tooling. No npm application setup.
</p>

<p align="center">
  <a href="https://github.com/BTSpaniel/particlerealms.engine/actions/workflows/sdk-ci.yml"><img src="https://github.com/BTSpaniel/particlerealms.engine/actions/workflows/sdk-ci.yml/badge.svg?branch=main" alt="SDK CI" /></a>
  <a href="https://github.com/BTSpaniel/particlerealms.engine/releases"><img src="https://img.shields.io/github/v/release/BTSpaniel/particlerealms.engine?include_prereleases&amp;label=release&amp;color=6e7fe8" alt="Latest release, including prereleases" /></a>
</p>

<p align="center">
  <a href="#quick-start"><strong>Quick start</strong></a> &nbsp; · &nbsp;
  <a href="engine-sdk/MD/guides/sdk-distribution.md">SDK guide</a> &nbsp; · &nbsp;
  <a href="https://particlerealms.online/playground/">Live playground</a> &nbsp; · &nbsp;
  <a href="https://github.com/BTSpaniel/particlerealms.engine/releases">Releases</a> &nbsp; · &nbsp;
  <a href="ci/README.md">Tests</a>
</p>

## Quick start

Clone the SDK and start its included server:

```sh
git clone https://github.com/BTSpaniel/particlerealms.engine.git
cd particlerealms.engine/engine-sdk
python serve_sdk.py --port 9002 --isolate
```

Open **[http://127.0.0.1:9002/](http://127.0.0.1:9002/)** in a browser with WebGPU support. Python serves the SDK without additional packages. The landing page connects the documentation with runnable **Engine**, **worker** and **Plauna** examples in source and compiled modes.

Serve modules over **HTTP on localhost** or **HTTPS in deployment**. Opening `index.html` as a file causes CORS failures. `--isolate` supplies the headers needed by threaded compute.

## Choose your starting point

| Package | What you get |
| --- | --- |
| **[Engine + Plauna SDK](engine-sdk/)** | Public source modules, compiled APIs, PhysX PE and compute assets, examples, offline docs and rebuild tools. |
| **[Template.zip](Template.zip)** | Full compiled Platform runtime, PhysX PE, required runtime resources and a ready-to-run launcher. |

The SDK gives your application **Engine + Plauna**. The Template brings together **Engine → Editor → Plauna → AGI → WebGPU OS**, with **WebGPU OS**, **Plauna Showcase** and **Blank Canvas** launch modes.

To run the Template, extract it, enter `Template/` and run `python serve.py 9002` or `launch.bat --port 9002` on Windows. Open the same localhost URL as the SDK quick start.

Your application owns its canvas, frame loop and resources. Keep the supplied runtime, loader and native/worker assets together. Full source documentation and JavaScript rebuilding tools are in the SDK.

## Use the public APIs

For a module at the SDK root:

```javascript
import * as Engine from './engine/EngineBootstrap.js';

const world = Engine.createWorld({ name: 'My world' });
const entity = Engine.createEntity(world);
Engine.setEntityComponent(world, entity, 'Transform',
  Engine.createTransform({ position: [0, 2, 0] }));
```

Plauna's source entry point is [`plauna/index.js`](engine-sdk/plauna/index.js). The [shipped examples](engine-sdk/examples/scenarios.js) show an indexed render, native physics, worker operations and an interactive Plauna button, including cleanup.

For compiled mode, keep the supplied loader tag from the SDK example or Template and await its verified runtime:

```javascript
const PE = await globalThis.__PE_RUNTIME_READY;
const world = PE.createWorld({ name: 'My world' });
const entity = PE.createEntity(world);
const Plauna = PE.Plauna;
```

The full Platform Template additionally exposes `PE.Editor`, `PE.AGI` and `PE.WebGPUOS`. OS boot is explicit; use the included launcher or the subsystem's documented initialization.

## Rebuild the JavaScript runtime

From `engine-sdk/`, use the Python version and pinned tools recorded in [`sdk-build.json`](engine-sdk/sdk-build.json):

```sh
python -m pip install -r requirements-sdk.txt
python bundle_engine.py --sdk-rebuild
```

Outputs go to `build/runtime` and `build/engine-sdk`. Install prerequisites before working offline. JavaScript builds reuse the supplied, verified native WASM; native PhysX, Blast, Flow and Rust rebuilding uses separate toolchains. See the [SDK guide](engine-sdk/MD/guides/sdk-distribution.md) for rebuilding and signed-package requirements.

## Tests and documentation

**[SDK CI](https://github.com/BTSpaniel/particlerealms.engine/actions/workflows/sdk-ci.yml)** checks the distribution and Python/browser behavior on pushes and pull requests. The [test guide](ci/README.md) lists each job's scope, requirements and local commands. Browser and GPU coverage is reported per job.

[Release validation](SDK-VALIDATION.json) records the measured package checks, offline rebuilding and native/GPU acceptance for the shipped SDK and Template. The [SDK manifest](engine-sdk/manifest.json) records exact file hashes and build identities.

Browse the [SDK guide](engine-sdk/MD/guides/sdk-distribution.md) and [API index](engine-sdk/MD/api/index.md), or open `MD/viewer/` on the local SDK server. [Engine Academy](https://particlerealms.online/learn/) and the [Playground](https://particlerealms.online/playground/) provide online learning and live studies.

## Credits and license

Built by [Jake Wehmeier / BTSpaniel](https://github.com/BTSpaniel). [PhysX PE](https://github.com/BTSpaniel/Physx) provides the browser physics integration; upstream authors and licenses remain credited in [AUTHORS](AUTHORS) and [NOTICE.md](NOTICE.md).

First-party code is **[source-available alpha](LICENSE)**. Personal evaluation and internal testing are permitted; commercial production and redistribution require written permission. Included third-party components retain their own licenses.
