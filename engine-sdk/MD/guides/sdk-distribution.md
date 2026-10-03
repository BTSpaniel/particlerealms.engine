---
title: SDK Distribution and Rebuilding
description: Build applications and rebuild the JavaScript runtime from an extracted Engine or Platform SDK.
updated: 2026-10-03
---
<!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel> -->
<!-- SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha -->

# SDK Distribution and Rebuilding

The public Engine SDK release supplies the Engine runtime and Plauna UI for browser applications. The Platform SDK is a locally produced packaging profile that adds the Editor, AGI, and WebGPU OS public entry points. The public compiled Platform download is `Template.zip`. Each SDK profile includes canonical sources, verified runtime assets, runnable examples, documentation, and Python rebuild tools. The full development repository's default Engine target remains Engine-only; selecting `--include-plauna` builds the base release with UI. Read `manifest.json` for the exact entry points and subsystem flags of a package. (Source: `release_targets.json`, `bundler/config.py`, and `bundler/sdk.py`.)

## Get and serve the SDK

The public Engine + Plauna SDK is committed as ordinary files in [BTSpaniel/particlerealms.engine](https://github.com/BTSpaniel/particlerealms.engine). Clone that repository, then enter its `engine-sdk/` directory:

```bash
git clone https://github.com/BTSpaniel/particlerealms.engine.git
cd particlerealms.engine/engine-sdk
python serve_sdk.py --port 9001
```

`Template.zip` is the separate download for the full compiled Platform launcher. Extract it, enter `Template/`, and run `python serve.py 9001`. The public release does not require a separate SDK ZIP. A locally built SDK directory uses the same `serve_sdk.py` command.

Open `http://127.0.0.1:9001/`. The landing page checks the compiled runtime and links every supported example. Browser ES modules require HTTP; opening an HTML file with `file://` does not work. WebGPU requires a supported browser and a secure context. Localhost is suitable for local development.

For workloads that need `SharedArrayBuffer` or threaded compute, enable cross-origin isolation:

```bash
python serve_sdk.py --port 9001 --isolate
```

The server binds only `127.0.0.1`, serves JavaScript and WebAssembly with their correct MIME types, and rejects resolved paths outside the selected SDK root. `--isolate` adds COOP `same-origin`, COEP `require-corp`, and CORP `same-origin`. Production hosting must supply equivalent headers when threaded compute is enabled. Serve every runtime component from the SDK inventory; compressed and multipart loader artifacts must keep their filenames and bytes.

## Use source modules or the compiled runtime

Save application HTML at the SDK root and put application JavaScript in a `<script type="module">` or a module loaded by that page. The examples below resolve imports from that page's URL, so they also work when the entire SDK is hosted below a URL prefix. Source imports resolve from the package's canonical subsystem paths:

<!-- sdk-example: engine-source -->
```javascript
const Engine = await import(new URL('./engine/EngineBootstrap.js', document.baseURI).href);

const world = Engine.createWorld({ name: 'My application' });
const entity = Engine.createEntity(world);
Engine.setEntityComponent(world, entity, 'Transform',
  Engine.createTransform({ position: [0, 2, 0] }));

let disposed = false;
function cleanup() {
  if (disposed) return;
  disposed = true;
  Engine.destroyEntity(world, entity);
}
```

Call `cleanup()` when your application stops using this example. It creates only an ECS entity; rendering and native physics are demonstrated together in `examples/source.html?case=engine`. The source and compiled examples in this section are executed directly from these Markdown fences during documentation acceptance.

Some canonical Platform modules import from browser-root subsystem paths. When serving source modules below a nested URL, load `examples/source-importmap.js` as a classic script before your application module. It maps `/engine/`, `/editor/`, `/plauna/`, `/agi/`, and `/webgpu-os/` to the SDK directory containing that helper. The source examples and their OS iframe already load it before importing modules. Canonical source bytes stay unchanged; module workers use their own relative import closures.

The generated compiled example page includes the verified loader tag for its runtime manifest. Reuse that generated tag, adjusting its relative paths when the application moves. Wait for the loader before calling public APIs:

<!-- sdk-example: engine-compiled -->
```javascript
if (!globalThis.__PE_RUNTIME_READY) throw new Error('Load the SDK runtime loader first');
const Engine = await globalThis.__PE_RUNTIME_READY;
const world = Engine.createWorld({ name: 'My application' });
const entity = Engine.createEntity(world);
Engine.setEntityComponent(world, entity, 'Transform',
  Engine.createTransform({ position: [0, 2, 0] }));

let disposed = false;
function cleanup() {
  if (disposed) return;
  disposed = true;
  Engine.destroyEntity(world, entity);
}
```

The verified loader checks compiled transport integrity before it exposes this runtime. Copying only the minified JavaScript file omits the manifest, executor, compression parts, and external assets that its deployed contract requires.

| Capability | Source entry point | Compiled public surface |
| --- | --- | --- |
| Engine ECS, math, rendering and simulation | `engine/EngineBootstrap.js` | Flat exports on the resolved runtime; grouped exports such as `SurfaceFields` and `particlePhysXPhysicsWorld` |
| Editor application | `engine/EngineEditorBootstrap.js` | `EditorApp`, `ProjectManager`, and `Editor` |
| Editor project persistence | `editor/js/modules/ProjectStorage.js` | `runtime.Editor.createProject`, `saveProject`, `loadProject`, and `deleteProject` |
| Plauna retained UI | `plauna/index.js` | `runtime.Plauna` |
| AGI computation | `agi/index.js` | `runtime.AGI`, including `ComputeGraph` |
| WebGPU OS | `webgpu-os/index.js` | `runtime.WebGPUOS`, including `bootWebGpuOS` |

The Engine profile exposes Engine public APIs and includes `runtime.Plauna` when its manifest sets `include_plauna`. The Platform profile exposes every row. Internal loader registries are not application interfaces. Use the canonical API documentation for a module's current capability and experimental status; inclusion in an SDK does not promote an experimental API to a stable contract. Source: `engine/EngineBootstrap.js`, `engine/EngineEditorBootstrap.js`, `plauna/index.js`, `agi/index.js`, `webgpu-os/index.js`, and `bundler/builder.py`.

## Run the examples and release resources

`examples/source.html?case=engine` and `examples/compiled.html?case=engine` run the same Engine scenario through their respective public surfaces. Change `case` to `worker`, `plauna`, `editor`, `agi`, or `os`. Plauna works in the base Engine + Plauna release and the Platform SDK. Editor, AGI, and OS require the Platform SDK. The landing page shows examples for the namespaces declared by its runtime manifest.

The Engine example creates an ECS entity, simulates its native PhysX body, and renders its transform with Engine mesh helpers. The worker example performs a water brush, real GPU transport, and a checkpoint round trip. Plauna verifies a DOM click against its retained UI and `StateStore`. Editor saves, reopens, updates, and reopens one real IndexedDB project. AGI executes WebGPU vector addition through `ComputeGraph`, then runs a dependent scaling node.

The OS example starts only after the **Boot local app** action. It creates a credentialless iframe, boots an actual temporary demo session, and mounts a strict local app manifest through the existing registry. This keeps the kernel's demo isolation and profile admission requirements intact. Use a browser that supports credentialless iframes. Source: `webgpu-os/kernel/KernelSession.js` and `sdk/examples/scenarios.js`.

Each page exposes a bounded `window.__SDK_EXAMPLE_RESULT__` receipt. A successful operation sets `status` to `passed` with its measured checks. `window.__SDK_EXAMPLE_CLEANUP__()` returns an awaitable, idempotent cleanup result; the **Release resources** button calls it. Worker and GPU resources are released, the example Editor project is deleted, and the OS app and kernel are shut down. Cleanup does not delete other Editor projects or the normal OS profile.

## Rebuild the JavaScript runtime

Use the exact Python version recorded in `sdk-build.json` under `tools.python`. The initial SDK baseline is Python 3.12.7. Match the native compressor environment under `tools.nativeCompression`: the compiled and runtime zlib versions and the Python standard-library LZMA2/XZ backend. Install the package versions pinned in `requirements-sdk.txt`, including the minifier and compression libraries.

Rebuild preflight verifies these Python, package, and compressor identities before writing build outputs. Browser acceptance also requires an installed Chromium browser, such as Chrome or Edge. Installation is an explicit preparation step; rebuilding does not download missing tools.

```bash
python -m pip install -r requirements-sdk.txt
python bundle_engine.py --sdk-rebuild --sdk-no-archive
```

The SDK descriptor selects the profile, pinned minifier, verified native assets, and supplied public signed packages. Intermediate runtime artifacts are written under `build/runtime`; the complete rebuilt distribution is written under `build/engine-sdk` or `build/platform-sdk`. `--sdk-no-archive` produces the SDK directory without a separate SDK ZIP. Rebuild mode rejects conflicting output and consumer-sync options before writing artifacts. Source: `bundler/cli.py` and `bundler/sdk.py`.

This workflow rebuilds the JavaScript runtime. It verifies and reuses supplied native WebAssembly binaries. Recompiling PhysX, Blast, Flow, or Rust kernels requires their separate native toolchains and is outside the default SDK rebuild.

Private signing keys are not included or required. Existing signed packages remain subject to signature, validity, payload, and signed-owner source checks. If a change affects signed-owner inputs, obtain an authorized replacement signed package before rebuilding. Rebuild mode cannot silently re-sign a changed owner or refresh an invalid package.

For a Platform SDK change to signed-owner sources, obtain a complete replacement public registry from an authorized publisher outside the extracted SDK. The registry must have a current valid signature from an admitted root, verified payloads, and owner identities matching the changed sources. Preserve the exact supplied JSON or JavaScript assignment bytes, save them as `replacement-official-packages.json`, and supply that file explicitly:

```bash
python bundle_engine.py --sdk-rebuild --sdk-no-archive --no-cache --production --sdk-packages replacement-official-packages.json
```

`--sdk-packages` is available only for Platform rebuilding; Engine rebuilding rejects it. The original shipped registry remains untouched. Inline package containers are supported. A `containerRef` may resolve only to an existing verified sidecar under the local SDK root or `dist/`; it does not look beside an external replacement registry. This procedure supplies public signed bytes without private keys, signing, fallback refresh, trust overrides, or downloads.

To produce a new SDK from the **full development repository**, select the target explicitly. These producer commands require that repository's complete inputs; they are not setup commands for the public `particlerealms.engine` checkout. Use `--sdk-rebuild` above when working from the public SDK:

```bash
python bundle_engine.py --target engine --sdk-only --sdk-no-archive
python bundle_engine.py --target engine --include-plauna --sdk-only --sdk-no-archive --production
python bundle_engine.py --target platform --sdk-only --sdk-no-archive --production
```

Platform SDK packaging reuses the existing engine-demo runtime kit contract. It requires a production runtime named `particle-platform`, eager initialization, and the canonical Platform entry set: `engine/EngineEditorBootstrap.js`, `agi/index.js`, `plauna/index.js`, `webgpu-os/index.js`, and the generated OS content registry. Selecting `--target platform` supplies the name, eager mode, subsystem flags, and entry points; add `--production` as shown. Keep these target settings when packaging the SDK. The kit validator checks the candidate runtime, verified loader, manifest, and native PhysX bytes before publication. Source: `release_targets.json`, `bundler/config.py`, and `bundler/site.py` `_validate_engine_demo_runtime_kit()`.

`--sdk-only` builds verified runtime artifacts and the selected SDK while skipping website generation and implicit Template synchronization. Standard target defaults remain available for existing release workflows. SDK receipts inventory package files, public entry points, build inputs, tool versions, and validation results. A missing or modified package file invalidates SDK cache acceptance.

## See also

- [Engine getting started](../engine/getting-started.md)
- [Engine stack usage](engine-stack-usage.md)
- [Managed compute and WebAssembly](../engine/compute.md)
- [Surface Fields and Surface Lab](../engine/surface-fields.md)
- [Security and trust model](../concepts/security-model.md)
- [Boot sequence](../concepts/boot-sequence.md)
