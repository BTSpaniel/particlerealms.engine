<!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel> -->
<!-- SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha -->

# Testing the SDK

[Live runs and results](https://github.com/BTSpaniel/particlerealms.engine/actions/workflows/sdk-ci.yml) · [Release validation](../SDK-VALIDATION.json) · [SDK quick start](../README.md)

**SDK CI runs on pushes, pull requests to `main`, and manual dispatch.** Each run is tied to its Git commit. Open a job for its summary and console log; download its artifact for individual test results and browser screenshots. Failures make the job red. Skipped and unexecuted tests are reported separately.

## What runs

| Job | Coverage | Environment |
| --- | --- | --- |
| Package integrity and Python tests | Every SDK file; source module graph; native asset hashes; compression/SRI/provenance; Template members and runtime; documentation navigation; selected shipped parser, emitter, transport, packaging, server and native-asset regression tests. | Windows Server 2022, Python 3.12.7, exact SDK dependency pins. |
| Browser tests (`off`) | Exact approved Engine/Plauna Markdown examples; source and compiled math/ECS/PhysX, Plauna interaction, Snapshot workers; extracted Template APIs; root and nested hosting, cleanup and loading diagnostics. | Ubuntu 24.04, pinned Playwright Chromium; no WebGPU requirement. |
| Browser tests (`software`) | CPU checks, Engine rendering, Surface Field GPU transport, selected-object pixel readback, and the physics playground's native UI controls and persistence. Both runtime modes, root and nested hosting. | Ubuntu 24.04, Chromium with SwiftShader requested; reports record the observed adapter separately. |

Software WebGPU checks establish functional behavior, not hardware frame rates or complete device compatibility. Full OS, Editor, AGI, native Flow and hardware release acceptance remain recorded in the versioned release validation. This workflow does not relabel those historical results as new CI runs and does not rebuild native binaries or publish releases.

The strict SDK verifier also checks its recorded Python and native compression versions. Its Windows job uses the release baseline. The bundler resolves physical root paths, including Windows short-path aliases. CI installs dependencies explicitly before tests; application development still requires no Node/npm setup.

Browser tooling is pinned to Playwright 1.63.0 and its Chromium build. The harness selects [Chromium's full headless mode](https://playwright.dev/python/docs/browsers#chromium-new-headless-mode); software jobs explicitly select the [SwiftShader Vulkan driver](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/swiftshader.md). Each report records the actual browser version, launch arguments and adapter identity.

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

Browser jobs verify blocked page and worker network attempts. Passive browser-wide socket tracing catches requests made before a worker debugger attaches; reports retain socket URLs and counts, and incomplete traces fail validation.

## Reading results

- The README badge is the current `main` workflow result, not a static “passing” image.
- JSON reports contain the tested artifact identities and individual outcomes. Python tests also produce JUnit XML. Browser failures retain diagnostic data and screenshots when a page is available.
- GitHub keeps uploaded artifacts for 14 days. Release validation remains in Git for durable release evidence.
- A missing browser, missing adapter, failed assertion, broken import or unexpected resource request fails the applicable job. The CPU job explicitly records WebGPU as not run.

[Focused source regression results](../validation/local-source-checks.json) retain the measured selection pixels, resource cleanup, playground controls and documentation interactions. Their negative controls deliberately reproduce the old failures; hosted reports separately test the final compiled distribution.

[Extracted Template acceptance](../validation/template-upgrade.json) records root and nested hosting, all three launcher modes, compiled examples, native operations and cleanup. [Platform input rejection results](../validation/platform-input-rejections.json) record six actual damaged, changed or invalid-input failures before publication. These reports identify local acceptance separately from hosted CI.

## Manual release validation

Run [SDK release validation](https://github.com/BTSpaniel/particlerealms.engine/actions/workflows/sdk-release-validation.yml) from the Actions tab on the candidate branch. This workflow requires no signing keys and does not publish or move release tags.

| Job | Required evidence |
| --- | --- |
| Offline JavaScript rebuilding | Install the recorded prerequisites, block build networking, rebuild twice, compare runtime bytes and complete SDK directory inventories, then change a CPU function in a disposable copy and execute the changed compiled result. Reject missing inputs and corrupt native assets. Signed-package probes apply when the package actually contains signed owners. |
| Endurance, source and compiled | Execute the selection, persistence and worker checks; run 100 create/save/load/destroy scene cycles; continuously simulate and render for ten minutes. Fail on ownership mismatches, non-finite physics, worker failures, GPU errors or unexpected network/resource requests. |

The endurance report includes frame-time percentiles, available Chromium JavaScript heap measurements, browser, adapter, commit and runtime identities. Software adapter timings are labeled as software measurements; JavaScript heap estimates exclude native and GPU allocations. The reports do not claim unmeasured hardware performance or total memory usage.

```powershell
python -B ci/rebuild_acceptance.py --output test-results/rebuild
python -B ci/endurance.py --mode source --duration 600 --cycles 100 --output test-results/endurance-source.json
python -B ci/endurance.py --mode compiled --duration 600 --cycles 100 --output test-results/endurance-compiled.json
```

Use the same explicitly installed SDK and browser prerequisites as the commands above. Rebuilding writes only to a disposable SDK copy. No SDK ZIP is produced.

## Preparing the next release

1. Update the distribution through its bundler and refresh the real SDK/Template validation record. Keep sources, runtime manifests, native files and receipts together.
2. Push a branch and inspect all three CI jobs. Resolve failures before advancing `main`.
3. Run the manual release-validation workflow, plus hardware and native acceptance appropriate to changed components; retain the measured results alongside the release.
4. Create a new version tag from the tested commit. Preserve previous release tags and assets. Attach the verified Template ZIP according to the release plan.

Keep the front page's release navigation stable. Expand these jobs as public capabilities and runnable examples are added, using actual operations and cleanup checks for each new subsystem.
