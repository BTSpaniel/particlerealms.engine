# WebGPU Requirements

Particle Engine requires a browser and GPU stack with WebGPU support.

## Recommended Browsers

- Current Chrome
- Current Edge
- Other browsers with compatible WebGPU support

## Serving Requirements

Use HTTP or HTTPS for release testing. Some browser APIs, workers, WebAssembly files, and GPU features may not behave correctly from `file://` URLs.

## Common Issues

- WebGPU unavailable due to browser or GPU driver support.
- Incorrect MIME or content encoding for compressed bundles.
- WASM assets not hosted at the expected relative path.
- Worker scripts missing from the release assets directory.
