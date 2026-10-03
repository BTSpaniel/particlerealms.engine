# Runtime Bundle

The engine target builds from `engine/EngineBootstrap.js` and outputs the `particle-engine` runtime.

## Outputs

- `particle-engine.js`
- `particle-engine.min.js`
- `particle-engine.min.js.gz`
- `particle-engine.min.js.br` when Brotli support is available
- `particle-engine.min.js.zst` when Zstandard support is available
- `particle-engine.manifest.json`

## Manifest

The manifest records entry points, target metadata, module counts, compression sizes, and included source module paths.

## Runtime Dependencies

Some systems require additional runtime files that cannot be bundled directly into JavaScript, such as `physx-js-webidl.wasm` and `SnapshotWorker.js`.
