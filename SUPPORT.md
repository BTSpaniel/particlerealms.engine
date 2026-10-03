# Support Policy

Particle Engine is currently released as a source-available alpha.

## What To Expect

- APIs may change between alpha builds.
- Some systems are experimental or partially documented.
- The public SDK includes Engine and Plauna UI. The compiled Platform Template also includes Editor, AGI and WebGPU OS.

## Best Supported Path

Clone the public SDK repository, enter `engine-sdk/`, and run `python serve_sdk.py --port 9002 --isolate`. Open `http://127.0.0.1:9002/` for source and compiled examples and the local documentation viewer.

For the full Platform starter, extract `Template.zip`, enter `Template/`, and run `python serve.py 9002`. Serve browser modules over HTTP or HTTPS; opening HTML files directly does not support their module and worker imports.
