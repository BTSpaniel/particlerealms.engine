# AI Echo Engine Demo Workflow

This page describes the four-file Engine Demo delivery contract. Forge and
delivery use `particle-engine-v1`, the curated public Engine API. Its transport
retains the full-platform bundle, with multipart downloads for the standalone
starter. AI Echo enables explicit preview and export for this four-file format.
Adaptive projects with other entrypoints or file graphs still require package-v2
delivery and remain blocked. (Sources: `ArtifactStudio.js`, `factory.js`,
`DodadForge.js`, and `EngineDemoPackage.js` at the paths below.)

The intended workflow previews the exact accepted source revision and delivers
the same revision as a self-contained ZIP. ZIP
creation proves static admission, byte identity, provenance, and extraction
parity; only a successful explicit preview or release smoke proves live GPU
startup. The
workflow keeps model-authored source separate from trusted release runtime
bytes. It does not turn prompt guidance into tool or execution authority.

(Sources: `webgpu-os/apps/ai-echo/DynamicSkillEngine.js`,
`webgpu-os/apps/ai-echo/GuidanceFaculty.js`,
`webgpu-os/kernel/execution/DodadForge.js`.)

## Choose the correct path

Use ordinary Dodad Forge for a standalone HTML, CSS, and JavaScript artifact.
Use Engine Demo Builder when the requested artifact needs Particle Engine,
WebGPU, ECS, an engine simulation, or an explicitly requested full platform
API. A mounted repository change still belongs to Mounted Project Coder, and a
live OS surface change still belongs to Live Patch.

Engine Demo Builder is a dormant guidance Faculty. Discovery exposes bounded
metadata. A matching objective exposes its instructions. Recipes and delivery
details remain behind explicit resource URIs. None of those stages grants a
tool, accepts a preview, writes a file, executes code, or downloads an archive.

(Sources: `webgpu-os/apps/ai-echo/DynamicSkillEngine.js`,
`webgpu-os/apps/ai-echo/GuidanceFaculty.js`.)

## Authored project contract

The model authors the existing exact four-file graph:

```text
index.html
styles.css
app.js
dodad.behavior.json
```

An engine-backed project binds its runtime in `dodad.behavior.json`:

```json
{
  "format": "webgpu-os-dodad-behavior-v1",
  "family": "engine-demo",
  "entrypoint": "index.html",
  "runtime": { "profile": "particle-engine-v1" }
}
```

`particle-engine-v1` is the admission and delivery API profile. Its verified
gzip, manifest, provenance, loader, and Template delivery path exist together
today. The generated demo may use the Particle Engine public API contained in
that platform runtime without booting Editor, Plauna, AGI, or WebGPU OS.

The profile name does not select an Engine-only binary: the payload remains
`particle-platform.min.js.gz`. Private platform globals are removed before
authored code receives the public API. The retired `particle-platform-v1`
declaration is rejected; existing saved revisions are not silently rewritten.

The four authored files stay small enough to review and fingerprint. The model
does not emit a minified runtime, encoded binary, loader, server, or provenance
record into an artifact file. Preview and export attach that trusted material
after the authored revision passes its normal checks.

(Sources: `webgpu-os/kernel/execution/DodadForge.js`,
`engine/EngineBootstrap.js`, `engine/EngineEditorBootstrap.js`,
`release_targets.json`, `Template/assets/particle-platform.manifest.json`,
`Template/assets/particle-platform.provenance.json`.)

## Start from the verified runtime

Packaged `app.js` awaits `globalThis.__PE_RUNTIME_READY`, uses only the returned
reviewed public API membrane, and checks each export it intends to call. It must
show a useful failure state when the verified runtime, WebGPU, or a required
API is unavailable. It must not fall through to a CDN or to raw repository
imports that are absent from a release archive.

The repository loader enforces all of these runtime checks before `app.js`
receives the namespace:

1. Fetch the profile-matched gzip object with a bounded response.
2. Expand it with `DecompressionStream('gzip')` under an exact decoded-byte
   bound.
3. Verify SHA-384 over the decoded runtime.
4. Execute the verified bytes from a temporary Blob URL.
5. Require the compiled Particle Engine module registry.
6. Resolve `globalThis.__PE_RUNTIME_READY` with the reviewed public API
   membrane. The compiled module registry and private loader APIs remain hidden.

(Sources: `Template/assets/release-runtime-loader.js`,
`tests/playground/src/core/engine.js`.)

## Own the browser lifecycle

An engine demo must own its lifecycle instead of assuming that a successful
script load means the demo is healthy.

- Check `navigator.gpu` before allocation.
- Wait for a visible non-zero canvas.
- Use `runtime.initWebGpuCanvas` on the locally resolved public membrane when
  the recipe needs a WebGPU surface. That helper
  configures the canvas, observes DPR-aware resize, recreates its depth target,
  and exposes `dispose()`.
- Create bounded, labeled GPU resources only after runtime and canvas
  readiness.
- Keep one animation handle. Bound stale frame deltas and pause nonessential
  work while the document is hidden.
- On close, cancel animation, detach event listeners, disconnect owned
  observers, destroy owned buffers and textures, and dispose the canvas
  helper.

(Sources: `engine/core/gpu/WebGpuCanvasBootstrap.js`,
`engine/core/gpu/GpuInit.js`, `engine/core/AppBootstrap.js`.)

## Source-backed starter recipes

Recipes are study maps, not source-copy commands. AI Echo verifies every
selected public name against `engine/EngineBootstrap.js` and keeps the generated
demo smaller than the test or Playground source it studied.

### WebGPU triangle

Use `initWebGpuCanvas`, `createUniformBuffer`, and `updateBuffer` for a minimal
render pipeline. Follow the labeled pipeline, buffer, swap texture, render
pass, and queue submission structure in the Phase 1 example.

(Sources: `tests/phase1_webgpu/main.js`,
`engine/core/gpu/WebGpuCanvasBootstrap.js`,
`engine/core/gpu/GpuBuffer.js`.)

### ECS ring

Use `createWorld`, `createEntity`, `setEntityComponent`, `createTransform`,
`createQuery`, `forEachEntity`, `stepWorld`, `stepWorldFrame`, and
`destroyEntity` for a bounded entity simulation. The Phase 2 example shows the
world and query lifecycle.

(Sources: `tests/phase2_ecs/main.js`, `engine/EngineBootstrap.js`,
`engine/ecs/world/World.js`.)

### Standard room

Use the public canvas, mesh, room-rendering, and standard-camera helpers for a
depth-tested 3D scene. The Phase 3 example is the source for pipeline, depth,
camera, resize, and input behavior.

(Sources: `tests/phase3_rendering/main.js`,
`engine/render/scenes/StandardRoomRenderer.js`,
`engine/EngineBootstrap.js`.)

### Adaptive particle field

Use `createParticleSimWorld`, `stepParticleSimWorld`,
`destroyParticleSimWorld`, and `createParticleQualityManager` for a bounded
compute simulation. Particle Storm is the study source for labeled resources,
adaptive population, shader-first failure, frame headroom, and explicit
cleanup. A generated starter should not copy its large experimental surface.

(Sources: `tests/playground/src/demos/particleStorm.js`,
`engine/sim/particles/ParticleSimWorld.js`,
`engine/EngineBootstrap.js`.)

### Material sandbox 2D

Use `createSandboxMaterialCatalog`, `packSandboxCell`, `unpackSandboxCell`, and
`validateSandboxMaterialCatalog` when the demo needs the published packed-cell
contract. The Sandbox 2D source owns the full simulation design; a starter
should select one bounded interaction and one visible behavior scenario.

(Sources: `tests/playground/src/demos/sandbox2d.js`,
`tests/playground/src/demos/sandbox2d/runtime.js`,
`engine/EngineBootstrap.js`.)

## Preview and ZIP share one verified source identity

Preview and export use the same normalized immutable authored files and the
same `runtime.profile`. Preview is a live, disposable inspection of that graph;
it does not create an approval or acceptance token. Editing a file, changing
the profile, or swapping runtime identity invalidates the displayed preview.
Export independently revalidates the exact committed file hash and runtime kit.

The opaque preview has no network and exposes only the reviewed, sidecar-free
public API list. It does not mount PhysX or other release sidecars. The ZIP
includes the complete verified runtime kit and PhysX WASM for localhost use,
but v1 authored demos still cannot call private or sidecar-backed runtime APIs.

The trusted delivery kit adds the profile-matched runtime, manifest,
provenance identity, verified gzip loader, local launch instructions, and the
Python static server. It is release material, not model-authored content. The
ZIP must contain no CDN, npm, Node.js, remote import, or absolute repository
dependency.

The extracted project runs over HTTP, not `file://`. The server derived from
`Template/serve.py` supplies `Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Embedder-Policy: require-corp`, and
`X-Content-Type-Options: nosniff`.

The production build also publishes one immutable generic starter through
ordinary Cloudflare Pages static assets. Its logical download name is:

```text
/webgpu-os/assets/engine-demo/downloads/v1/particle-engine-demo-starter.zip
```

The adjacent `.transport.json` descriptor binds the ZIP's exact length and
SHA-256. When it exceeds the 25 MiB single-asset limit, the build ships ordered
16 MiB parts. The Starter ZIP button verifies each part and the complete ZIP
before preparing the download. Small ZIPs remain single files. The runtime kit
likewise reconstructs its gzip from the platform manifest's declared parts.
The seven logical kit files, runtime identity, and extracted ZIP contents stay
unchanged. Gzip transport is capped at 64 MiB and starter transport at 128 MiB;
the decoded runtime still has its separate 96 MiB bound.

Custom AI Echo demos are assembled and downloaded entirely in the browser;
they are not uploaded or assigned a public URL. The deployment uses no R2
bucket, Worker, server-side packager, npm service, or CDN runtime. Every physical
hosted file must still satisfy the 25 MiB hosting limit.

Before claiming a rendered release, the extracted ZIP is served on localhost
and checked for verified runtime readiness, the first rendered frame, a clean
console, resize, the primary behavior scenario, and the expected runtime
profile. Browser ZIP creation itself is reported only as deterministic and
integrity verified; it never implies that the target machine rendered a frame.

(Sources: `Template/assets/release-runtime-loader.js`, `Template/serve.py`,
`Template/README.md`, `engine/docs/sdk/runtime-bundle.md`.)

## Failure boundaries

The workflow stops without packaging when a required public API is absent, the
authored graph changes, the runtime profile is invalid, the runtime identity or
byte bounds do not match, or archive extraction differs from the package
receipt. A separate release claim also stops when its localhost smoke fails.
Guidance never converts those failures into approval and never silently falls
back to a remote runtime.

(Sources: `webgpu-os/apps/ai-echo/DynamicSkillEngine.js`,
`Template/assets/release-runtime-loader.js`,
`webgpu-os/kernel/execution/DodadForge.js`.)
