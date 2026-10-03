<!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel> -->
<!-- SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha -->

# Testing the SDK

[Live runs and results](https://github.com/BTSpaniel/particlerealms.engine/actions/workflows/sdk-ci.yml) · [Release validation](../SDK-VALIDATION.json) · [SDK quick start](../README.md)

**SDK CI runs on pushes, pull requests to `main`, and manual dispatch.** Each run is tied to its Git commit. Open a job for its summary and console log; download its artifact for individual test results and browser screenshots. Failures make the job red. Skipped and unexecuted tests are reported separately.

## What runs

| Job | Coverage | Environment |
| --- | --- | --- |
| Package integrity and API changes | Every SDK file; source graph; native hashes; compression/SRI/provenance; unchanged Template; docs navigation; public exports, declarations, tools, sizes and protected bytes against `v0.8.1-alpha.1`. | Windows Server 2022, Python 3.12.7, exact SDK pins. |
| Portable Python | Fixture-based parser, emitter, graph reuse, paths, transport, server, packaging and rejection tests; unittest and pytest identities retained. | Windows Server 2022, Ubuntu 24.04 and macOS 14; Python 3.12.7, pinned pytest. |
| Chromium parser and public CPU contracts | Actual Engine/Plauna source census and dependency analysis; original ES module and canonical body grammar; complete compiled runtime classic grammar; fixed native source/emitted/minified oracles; shared public CPU/DOM assertions and cleanup. | Ubuntu 24.04; pinned Chromium, WebGPU disabled. |
| Windows candidate | Offline recorded Engine + Plauna recipe in a disposable SDK; source/compiled contracts at root/nested URLs; parser corpus and semantic oracles; provenance for actual built artifacts. | Qualified Windows Python/compression baseline; verified supplied WASM, no signing keys or native compilers. |
| Browser tests (`off`) | Exact approved Engine/Plauna Markdown examples; source and compiled math/ECS/PhysX, Plauna interaction, Snapshot workers; extracted Template APIs; root and nested hosting, cleanup and loading diagnostics. | Ubuntu 24.04, pinned Playwright Chromium; no WebGPU requirement. |
| Browser tests (`software`) | CPU checks, Engine rendering, Surface Field GPU transport, selected-object pixel readback, and the physics playground's native UI controls and persistence. Both runtime modes, root and nested hosting. | Ubuntu 24.04, Chromium with SwiftShader requested; reports record the observed adapter separately. |
| Required code-validation evidence | Every required report must pass with the same commit, workflow/run/attempt, recipe and checked-in SDK/Template identity. Candidate reports must agree on the rebuilt package. | Always runs, including after upstream failure; missing evidence fails. |

Software WebGPU checks establish functional behavior, not hardware frame rates or complete device compatibility. Full OS, Editor, AGI, native Flow and hardware release acceptance remain recorded in the versioned release validation. This workflow does not relabel those historical results as new CI runs and does not rebuild native binaries or publish releases.

The strict SDK verifier also checks its recorded Python and native compression versions. Its Windows job uses the release baseline. The bundler resolves physical root paths, including Windows short-path aliases. CI installs dependencies explicitly before tests; application development still requires no Node/npm setup.

Browser tooling is pinned to Playwright 1.63.0 and its Chromium build. The harness selects [Chromium's full headless mode](https://playwright.dev/python/docs/browsers#chromium-new-headless-mode); software jobs explicitly select the [SwiftShader Vulkan driver](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/swiftshader.md). Each report records the actual browser version, launch arguments and adapter identity.

## Run locally

From this repository's root, using the SDK's recorded Python 3.12.7 environment:

```powershell
python -m pip install -r engine-sdk/requirements-sdk.txt
python -m pip install -r ci/requirements-tests.txt
python -B ci/verify_distribution.py --output test-results/distribution.json
python -B ci/run_python_tests.py --output test-results/python.json
```

For browser checks:

```powershell
python -m pip install -r ci/requirements-browser.txt
python -m playwright install chromium
python -B ci/parser_tests.py --output test-results/parser.json
python -B ci/sdk_tests.py --output test-results/sdk-tests.json
python -B ci/browser_smoke.py --webgpu off --output test-results/browser-off.json
python -B ci/browser_smoke.py --webgpu software --output test-results/browser-software.json
```

Build and test a disposable candidate on the recorded Windows baseline:

```powershell
python -B ci/candidate_build.py --output test-results/candidate
python -B ci/sdk_tests.py --sdk test-results/candidate/engine-sdk --output test-results/candidate-sdk-tests.json
python -B ci/parser_tests.py --sdk test-results/candidate/engine-sdk --output test-results/candidate-parser.json
```

The candidate controller uses canonical `--stage-dir` packaging, verifies the supplied SDK descriptor and native inputs, and blocks build networking. Its destination must be fresh. Runtime, SDK, metrics and cache outputs remain inside staging; source fixtures and consumers are not synchronized. Failed admission produces no verified candidate receipt.

On Linux, `python -m playwright install --with-deps chromium` also installs the browser's system libraries. The SDK and browser smoke controllers accept `--browser PATH` for an already installed Chromium; parser checks use the pinned Playwright browser. Test servers bind only to localhost, isolate the SDK/Template serving roots, and reject application requests to outside origins. Generated reports stay in ignored `test-results/`; tests do not edit the inventoried SDK files.

Browser jobs verify blocked page and worker network attempts. Passive browser-wide socket tracing catches requests made before a worker debugger attaches; reports retain socket URLs and counts, and incomplete traces fail validation.

## Reading results

- The README badge is the current `main` workflow result, not a static “passing” image.
- JSON reports contain the tested artifact identities and individual outcomes. Python tests also produce JUnit XML. Browser failures retain diagnostic data and screenshots when a page is available.
- Download `code-validation-results` and open `coverage.html` for the aggregate, then open its linked original reports. Individual job artifacts contain JSON/JUnit, logs and screenshots. The aggregate retains those originals and their hashes; it does not infer success from a job badge.
- Individual artifacts remain available for 14 days; aggregate evidence for 30 days. Historical release validation remains in Git.
- A missing browser, missing adapter, failed assertion, broken import or unexpected resource request fails the applicable job. The CPU job explicitly records WebGPU as not run.

Required suites reject zero execution, duplicate or missing case identities, skips and unfinished cleanup. Unix runners exercise symlink rejection cases; Windows reports their privilege-dependent exclusion explicitly. The public profile ships only the fixtures and module dependencies needed by its approved cases. Compiled cases use the delivered loader and `PE.requireModule()`; absent modules or exports fail without source fallback. Controlled CPU resource-contract checks are labeled separately from native GPU operations.

The bundler's parser/scanner identify dependency and export contracts; Chromium validates JavaScript grammar separately. The source census checks original ES module syntax, including top-level `await`, and canonical emitted bodies. Parse-only probes prevent static dependencies from loading and stop before any supplied body executes; malformed source and undeclared-export controls must produce actual `SyntaxError`. [Module creation parses before dependency loading](https://html.spec.whatwg.org/multipage/webappapis.html#creating-a-module-script). The complete delivered runtime files separately receive classic-script grammar checks. Behavior oracles execute original ES modules, emitted code and minified code against independent expected values. The production census records each first-party delivered Engine/Plauna module and its hash. This is not a hardware performance qualification.

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
2. Push a branch and inspect every required job plus the final aggregation gate. Resolve failures before advancing `main`.
3. Run the manual release-validation workflow, plus hardware and native acceptance appropriate to changed components; retain the measured results alongside the release.
4. Validate release preparation with `python tools/release.py --help`. Supply an explicit future version, exact tested commit, notes and the aggregate's original required reports. The tool verifies package identities and permits `Template.zip` as the release asset. Default validation makes no release API writes. Explicit draft preparation is separate from publication. Existing versions and mismatched asset hashes are rejected.

The manual [SDK release preparation workflow](../.github/workflows/sdk-release.yml) validates by default and prepares a draft only when explicitly requested. The allowed release download remains `Template.zip`; the SDK stays ordinary repository files. Carry the accepted Template unchanged unless a replacement includes matching full Platform donor and acceptance evidence. GitHub provenance attestations describe files actually built by the Windows candidate job, rather than merely copied release assets.

Keep the front page's release navigation stable. Expand these jobs as public capabilities and runnable examples are added, using actual operations and cleanup checks for each new subsystem.
