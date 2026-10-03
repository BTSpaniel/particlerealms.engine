---
title: Global Testing Platform Review
description: Independent acceptance score, adversarial checks, execution evidence, and remaining repository defects.
updated: 2026-09-12
---

<!--
SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
-->

# Global Testing Platform Review

The independent reviewer rates the global testing platform **8.5/10** on 2026-09-12. This meets the requested minimum of 8/10 for the platform. The score assesses discovery, execution, evidence, and usability; it does not certify that every repository test passes or that every inventoried artifact is automated.

The reviewer inspected the implementation and existing harnesses, authored independent execution and browser-adapter regressions, ran them through the platform, and checked the final reports and viewer screenshots. The implementing agent corrected the defects identified during review. Final acceptance follows those corrections.

## Scoring rubric

| Area | Score | Basis and remaining limit |
| --- | --- | --- |
| Correctness and prevention of false passes | 2.7 / 3.0 | Missing, empty, contradictory, skipped, and failed evidence remains nonpassing. Typed and nested receipt checks, JUnit count checks, and nonzero browser-process rejection have negative tests and valid positive cases. Some legacy runners retain their own acceptance semantics. |
| Inventory and execution coverage | 1.5 / 2.0 | One catalog includes subsystem-owned tests, reviewed browser/evaluation adapters, and existing validation entry points. Numerous browser/manual artifacts still require reviewed adapters. |
| Isolation and resource cleanup | 1.4 / 1.5 | Real Windows child-process tests verify timeout cleanup, normal-exit cleanup, and immediate release of inherited log handles. POSIX cleanup is implemented but was not exercised on this Windows host. |
| Reproducibility and report honesty | 1.3 / 1.5 | Reports retain the complete selection, nonpassing states, exact commands, logs, fresh receipts, environment information, and declared-source hashes. They do not hash the complete production dependency graph. |
| Discoverability and viewer usability | 0.8 / 1.0 | The HTML viewer provides search, filters, pagination, commands, evidence links, and explicit scope labels. Desktop and mobile checks pass. Execution remains a Python command. |
| Maintainability and regression protection | 0.8 / 1.0 | The implementation reuses existing runners and separates discovery, execution, pytest evidence, and reporting. The custom pytest evidence adapter needs continued compatibility checks as pytest changes. |
| **Total** | **8.5 / 10.0** | **Accepted for the requested platform scope.** |

A significant unresolved false-pass or process-ownership defect would prevent acceptance at 8/10, regardless of the arithmetic score. No such defect remains in the exercised platform paths.

Sources: `tools/run_tests.py`, `tools/testing_platform/`, `tests/testing_platform/`, and `tests/navi/run_browser_status_page.py`.

## Final execution evidence

| Run | Recorded outcome | Scope |
| --- | --- | --- |
| `tmp/testing-platform/verified-platform/run.json` | **19/19 suites passed**, completed at `2026-09-12T14:36:57.806285+00:00` | Five browser/evaluation/integration selections and fourteen Python selections. Python child evidence contains 171 case events, including subtests. No failed, skipped, blocked, or unrun selected suite remains. |
| `tmp/testing-platform/reviewer-execution-v4/run.json` | **2/2 suites passed**, execution exit code 0 | Independent reviewer tests: browser adapter 5 events; execution 51 events, comprising 19 test methods and 32 subtests. These cases overlap the 19-suite run and must not be added to it as new coverage. |
| `tmp/testing-platform/smoke-final/run.json` | **11/12 suites passed; 1 failed** | The original smoke selection retains the existing schema-catalog failures. This remains a failed smoke run. |
| `tmp/testing-platform/integration-final/run.json` | **2/4 suites passed; 2 failed** | Existing Virtual Realm startup and descriptor-boundary problems remain visible. |
| `tmp/testing-platform/viewer-audit/viewer-check.json` | Search/details and filtering passed; zero page errors; no mobile page overflow | Browser exercise of the HTML report. The reviewer also inspected `viewer-desktop.png` and `viewer-mobile.png`. |
| `tmp/testing-platform/verified-platform/viewer-check.json` | Correct 19-result passing view; log link HTTP 200; zero page errors; no mobile page overflow | Final results-view exercise. The reviewer independently inspected the final desktop screenshot. |

The five platform regression files contribute 88 Python case events within the final 19-suite run. These are test and subtest events, not a count of every assertion executed inside them. Delegated runners retain their own evidence; the platform does not invent normalized assertion totals for them.

The final run's inventory contains **2,813 source artifacts and 323 executable suites**, including 279 Python file suites and 25 explicit registry entries. It marks **2,046 artifacts as needing an adapter**. Those artifacts are not 2,046 independent failing tests. Counts describe the recorded snapshot and can change with the working tree.

Receipt SHA-256 identities:

- Final 19-suite receipt: `d3e3542db17bbfb3d250b2ffd5cea735b4f4921bbf600a1eaf088555cf445308`.
- Independent reviewer receipt: `152a83b43bef8c6b3ee26286a0843ddb37aa254bde76b8bc41a2e9a875379bdd`.

These receipts are local run artifacts under `tmp/`; the repository regression tests and their commands remain the reproducible acceptance checks. Run the platform's own regressions from the repository root:

```powershell
python tools/run_tests.py run --suite 'python:tests/testing_platform/*'
```

## Defects corrected during review

- **Receipt false passes:** status-only receipts, numeric values standing in for Boolean status, zero executed work, and contradictory nested counts could initially pass. The final validator requires typed, positive, coherent evidence and preserves failures and skips.
- **JUnit false passes and subtest drift:** contradictory suite totals were initially accepted. Strict checks then exposed pytest 9's built-in subtest XML count mismatch. The platform now records actual pytest report events, including subtests and setup, teardown, and collection errors, without suppressing those events.
- **Browser process failure:** the shared direct-Chromium fallback initially accepted a passing DOM from a nonzero browser process. It now rejects that outcome. The regression uses real child processes producing controlled DOM output, including a valid zero-exit counterpart.
- **Windows descendant teardown:** closing a job, and later observing its active-process count reach zero, could precede release of a child's inherited log handles. Live API inspection reproduced that ordering. The final implementation retains process handles, terminates the owned job, and waits for process termination before returning. Immediate temporary-directory cleanup now passes.
- **Package-name collision:** JHC's local `tools` package initially shadowed the pytest evidence plugin. The plugin now uses its unambiguous module path with an explicit search path. The final JHC selection passes.

The reviewer also corrected a test fixture that imposed a short Python-startup deadline. The final timeout witness waits for a real descendant-start acknowledgement before beginning its timeout. It still verifies an actual timeout and actual process termination.

Sources: `tools/testing_platform/execution.py`, `tools/testing_platform/pytest_evidence.py`, `tools/testing_platform/catalog.py`, `tests/testing_platform/test_execution.py`, `tests/testing_platform/test_browser_adapter.py`, and `tests/testing_platform/test_pytest_evidence.py`.

## Existing repository defects and limits

The schema-catalog suite records **20 passing and 2 failing cases**. The failures are `test_repository_catalog_and_json_inventory_are_valid` and `test_formal_schemas_cannot_escape_catalog_ownership`. The platform keeps this suite in smoke and retains its failed result. Source: `tests/test_schema_contract_catalog.py` and the smoke receipt.

The Virtual Realm protected-startup selection fails its existing import-order source-graph assertion, `len(graph.modules) == 83`. The failing branch's actual module count is not printed in the retained log. The descriptor-boundary witness separately records **0/1 passing**, with an effect expected to be zero but observed as one. A legacy temporary-browser-profile cleanup error also appears in the retained diagnostic logs. These failures require their own production or harness work; the global platform does not weaken those checks. Sources: `tests/virtual-realm/run_protected_startup_browser.py` and the integration receipt.

Unadapted pages, human listening judgment, OCR quality, hardware-dependent GPU work, long soaks, deployed services, and release-wide execution are not certified by the 19-suite selection. Measurement completion is not automatically a performance or model-quality pass. The inventory is a discovery audit, not a line-by-line correctness review of every test body.

Existing Playwright-backed adapters retain their optional Python package and bundled driver dependency. The platform adds no Node project or npm build step. Package installation, remote-service readiness, every browser/driver combination, and POSIX process behavior were outside this acceptance run.

## See also

- [Global Testing Platform](global-testing.md)
- [Global Testing Audit](global-testing-audit.md)
- [Docs Style Guide](../contributing/docs-style-guide.md)
