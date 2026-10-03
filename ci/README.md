<!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel> -->
<!-- SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha -->

# Testing the SDK

[Live runs and results](https://github.com/BTSpaniel/particlerealms.engine/actions/workflows/sdk-ci.yml) · [Release validation](../SDK-VALIDATION.json) · [SDK quick start](../README.md)

**SDK CI runs on pushes, pull requests to `main`, and manual dispatch.** Each run is tied to its Git commit. Open a job for its summary and console log; download its artifact for individual test results and browser screenshots. Failures make the job red. Skipped and unexecuted tests are reported separately.

## What runs

| Job | Coverage | Environment |
| --- | --- | --- |
| Package integrity and Python tests | Every SDK file; source module graph; native asset hashes; compression/SRI/provenance; Template members and runtime; documentation navigation; selected shipped parser, emitter, transport, packaging, server and native-asset regression tests. | Windows Server 2022, Python 3.12.7, exact SDK dependency pins. |
| Browser tests (`off`) | Source and compiled Engine math/ECS/PhysX, Plauna interaction, Snapshot worker operations; extracted Template APIs; root and nested hosting, cleanup and loading diagnostics. | Ubuntu 24.04, pinned Playwright Chromium; no WebGPU requirement. |
| Browser tests (`software`) | CPU browser checks plus the shipped Engine rendering, Surface Field worker and Plauna scenarios with real WebGPU commands executed through a software adapter. | Ubuntu 24.04, Chromium with SwiftShader requested; reports record the observed adapter separately. |

Software WebGPU checks establish functional behavior, not hardware frame rates or complete device compatibility. Full OS, Editor, AGI, native Flow and hardware release acceptance remain recorded in the versioned release validation. This workflow does not relabel those historical results as new CI runs and does not rebuild native binaries or publish releases.

The strict SDK verifier also checks its recorded Python and native compression versions. Its Windows job uses the release baseline rather than bypassing those checks on a different environment. CI installs dependencies explicitly before tests; application development still requires no Node/npm setup.

## Run locally

From this repository's root, using the SDK's recorded Python 3.12.7 environment:

```powershell
python -m pip install -r engine-sdk/requirements-sdk.txt
python -B ci/verify_distribution.py --output test-results/distribution.json
python -B ci/run_python_tests.py --output test-results/python.json
```

For browser checks:

```powershell
python -m pip install -r ci/requirements-browser.txt
python -m playwright install chromium
python -B ci/browser_smoke.py --webgpu off --output test-results/browser-off.json
python -B ci/browser_smoke.py --webgpu software --output test-results/browser-software.json
```

On Linux, `python -m playwright install --with-deps chromium` also installs the browser's system libraries. To use an already installed Chromium locally, pass `--browser PATH`. Test servers bind only to localhost, isolate the SDK/Template serving roots, and reject application requests to outside origins. Generated reports stay in ignored `test-results/`; tests do not edit the inventoried SDK files.

## Reading results

- The README badge is the current `main` workflow result, not a static “passing” image.
- JSON reports contain the tested artifact identities and individual outcomes. Python tests also produce JUnit XML. Browser failures retain diagnostic data and screenshots when a page is available.
- GitHub keeps uploaded artifacts for 14 days. Release validation remains in Git for durable release evidence.
- A missing browser, missing adapter, failed assertion, broken import or unexpected resource request fails the applicable job. The CPU job explicitly records WebGPU as not run.

## Preparing the next release

1. Update the distribution through its bundler and refresh the real SDK/Template validation record. Keep sources, runtime manifests, native files and receipts together.
2. Push a branch and inspect all three CI jobs. Resolve failures before advancing `main`.
3. Run the hardware and native release acceptance appropriate to changed components; retain those measured results alongside the release.
4. Create a new version tag from the tested commit. Preserve previous release tags and assets. Attach the verified Template ZIP according to the release plan.

Keep the front page's release navigation stable. Expand these jobs as public capabilities and runnable examples are added, using actual operations and cleanup checks for each new subsystem.
