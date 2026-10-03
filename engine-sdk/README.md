# Particle Engine SDK

Run `python serve_sdk.py --port 9001`, then open `http://127.0.0.1:9001/`. Use `--isolate` for threaded compute. Examples offer source and compiled modes.

Documentation: `MD/viewer/?doc=guides/sdk-distribution.md`. The physics inventory is `engine/sim/physics/runtime-manifest.json`.

Install `requirements-sdk.txt` in a Python 3.12.7 virtual environment and provide Chrome or Edge. Rebuild with `python bundle_engine.py --target engine --sdk-rebuild --no-cache`. Outputs are `build/runtime` and `build/engine-sdk`. Native WASM and signed packages are verified and reused; private signing keys are not distributed.
