# Engine SDK Quickstart

Particle Engine is distributed as a browser-native WebGPU runtime.

## Build The SDK

```bash
python bundle_engine.py --target engine --production --release --no-cache
```

## Serve The Release Site

Serve the generated `release/site/` folder with any static HTTP server.

```bash
python -m http.server 8000 -d release/site
```

Open `http://localhost:8000/` in a WebGPU-capable browser.

## Use The Runtime Bundle

The generated runtime files are available in `release/engine-sdk/dist/` and `release/site/assets/`.

Use the gzip bundle for broad browser compatibility, or serve the best compressed artifact with the correct content encoding.
