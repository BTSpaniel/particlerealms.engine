---
title: Global Testing Platform
description: Discover, select, run, and review repository tests and evaluations with one Python command.
updated: 2026-09-12
---

<!--
SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
-->

# Global Testing Platform

Use `python tools/run_tests.py` from the repository root to run the smoke profile. The platform discovers first-party tests across the working tree, reuses reviewed browser and evaluation runners, and produces a searchable report with commands, logs, source identities, and explicit incomplete results.

The [global testing audit](global-testing-audit.md) explains the existing harnesses, known failures, and evaluation limits. An inventory entry is not an assertion, and an unexecuted suite is not a pass.

Every audit and run also emits the [shared Tool Atlas](global-tooling.md), linked from the report. It connects the selected suites to source, tools, programs, and recorded invocation evidence. The original testing report and CLI remain available.

## First run

```powershell
python tools/run_tests.py audit
python tools/run_tests.py list --profile smoke
python tools/run_tests.py doctor --profile smoke
python tools/run_tests.py run --profile smoke
```

Each audit or execution prints its report location under `tmp/testing-platform/`. Open `report.html` to search source artifacts, inspect executable suites, or review the selected run. The report is self-contained and uses no external assets. It can be opened directly or through the repository's development server. Existing test pages still run over HTTP through their original runners.

The catalog and reports use Python's standard library. Python test suites require pytest. Browser suites require an installed Chrome, Edge, or Chromium; some existing adapters additionally require the Python Playwright or websocket-client package. The platform does not install packages or introduce a Node/npm build step. Existing Playwright-backed tests retain Playwright's bundled driver runtime. `doctor` reports declared missing prerequisites, but does not prove GPU or remote-service availability.

## Choose a scope

```powershell
# Inspect commands without launching any tests.
python tools/run_tests.py run --profile browser --dry-run

# Run all discovered Python test files, one isolated process per file.
python tools/run_tests.py run --profile python

# Select exact suite IDs or quoted globs from list output.
python tools/run_tests.py run --suite 'python:Masterserver/tests/test_config.py'
python tools/run_tests.py run --suite 'python:tests/testing_platform/*'

# Combine profiles, or narrow by subsystem/kind.
python tools/run_tests.py run --profile browser --profile eval
python tools/run_tests.py list --subsystem virtual-realm --json

# Review and execute resource-intensive or known diagnostic work explicitly.
python tools/run_tests.py list --profile gpu
python tools/run_tests.py run --profile diagnostic
```

| Profile | Scope |
| --- | --- |
| `smoke` | Platform regressions plus selected cross-stack schema, browser, and AI Echo contracts. Existing product failures remain failures. |
| `python` | Discovered Python test files, including subsystem-owned suites outside `tests/`. |
| `browser` | Verified browser adapters. These include logic tests using controlled resources. |
| `eval` | Reviewed evaluation and measurement runners; read their notes before interpreting success. |
| `gpu` | Dedicated native GPU checks that retain their original environment and acceptance requirements. |
| `soak` | Bounded repeated native GPU workloads. |
| `integration` | Reviewed multi-component validation runners. |
| `release` | Packaged or umbrella release checks; these can rebuild artifacts and take substantially longer. |
| `diagnostic` | The known strict Virtual Realm descriptor-boundary witness. A reproduced failure remains red. |
| `all` | Every executable adapter in the current catalog, including diagnostics and resource-intensive profiles. It does not mean every source artifact has an adapter. |

Multiple profiles are combined; kind/subsystem filters narrow the selection. Exact suite patterns are checked individually: a typo produces an error even when another pattern matches. With no profile or explicit filters, `run` and `doctor` use smoke; `list` shows the complete executable catalog. `audit` always inventories the complete first-party candidate surface.

Suites use the [shared dependency and resource queue](global-tooling-queue.md). The default is one admitted job. `--jobs 2` permits reviewed compatible work to overlap; unknown jobs, writers, and browser/GPU work retain conservative resource gates. Declared prerequisites are included automatically and must pass first. Each child has its own process, declared working directory, bounded timeout, and fresh evidence destination. On Windows, a job object owns descendants; on POSIX, a process session does. Finishing, timing out, or interrupting a suite closes its descendants before releasing its resource leases.

## Reports and exit codes

```powershell
python tools/run_tests.py run --profile smoke --fail-fast --output tmp/testing-platform/my-smoke
```

Choose a new or empty output directory. Reusing old output is rejected, so a stale receipt cannot satisfy a new run.

| Artifact | Meaning |
| --- | --- |
| `inventory.json` | Timestamped source catalog, file hashes, suite configurations, and automated audit findings. |
| `run.json` | Complete selected and prerequisite list, statuses, commands, source hashes, timing, environment identity, and log paths. Updated on queue state changes. |
| `tool-plan.json` / `tool-queue.json` | Expanded execution graph and queue states, including resource claims and wait reasons. |
| `junit.xml` | One case per selected suite for CI ingestion. Assertion-level results remain in the child evidence. |
| `report.html` | Searchable run results, suite inventory, source catalog, and audit findings. |
| `suites/<id-hash>/` | Full stdout/stderr, individual result JSON, and fresh child JUnit or receipt when the adapter provides it. |

`passed` means the declared adapter's evidence contract succeeded. `failed`, `error`, and `timed_out` are unsuccessful. `blocked` means a declared prerequisite is missing or no cases ran. `skipped` remains incomplete even if some cases passed. `not_run` includes work left by fail-fast or interruption. The complete selected list stays in the report in every case.

Execution exits **0 only when every selected suite passed**, **1 for a failed or incomplete run**, **2 for configuration/readiness errors**, and **130 for interruption**. Audit, list, and dry-run commands can exit zero because those operations completed; they do not create passing test evidence. CI must use the execution exit code as well as the aggregate JUnit report: JUnit represents blocked/unrun work as skipped cases.

The platform's pytest adapter records each emitted unittest/pytest subtest explicitly, along with setup, call, teardown, and collection failures. This avoids pytest versions whose built-in JUnit counts subtests in totals without emitting corresponding rows. Skips and expected failures remain visible. Ambient `PYTEST_ADDOPTS` and `PYTEST_PLUGINS` are removed so they cannot silently change the declared selection.

Source hashes identify the declared tests, pages, and runners. They do not certify the entire production dependency graph. Machine information and the Git revision/dirty state are included separately; the report never treats a dirty checkout as identical to a clean commit.

## Extend the platform

Python discovery parses source without importing or running tests. Test files with `test_` functions/methods receive isolated pytest suites; the catalog supplies subsystem-specific Python paths and explicit plugins. Support files, fixtures, examples, and unreviewed browser protocols stay visible with their own classification.

For a custom browser, integration, or evaluation adapter, add an entry to `tools/testing_platform/suites.json`. Reuse an existing authoritative runner and declare:

- A stable `id`, `name`, `kind`, `profiles`, and all relevant source `paths`.
- Python `argv` arguments, a repository-relative `cwd`, and `timeoutSeconds`.
- Required Python module names, `browser`, and any `file:<repository-path>` prerequisites.
- An evidence contract: `junit`, `receipt`, or a reviewed authoritative `exit-code` runner.
- Notes stating what success establishes, including native GPU, controlled-resource, measurement-only, or human-evaluation limits.

Receipt adapters additionally declare their output argument, exact status type/value, schema where available, required field types, positive minimum counts, and nonempty evidence fields. The platform rejects missing, malformed, empty, contradictory, or skipped evidence. An exit-code adapter delegates detailed assertions to its reviewed runner; its report does not invent an assertion count.

Run the platform regression suites and regenerate the audit after an adapter change:

```powershell
python tools/run_tests.py run --suite 'python:tests/testing_platform/*'
python tools/run_tests.py audit
```

Sources: `tools/run_tests.py`, `tools/testing_platform/catalog.py`, `tools/testing_platform/execution.py`, `tools/testing_platform/reports.py`, and `tools/testing_platform/suites.json`.

## See also

- [Global Testing Audit](global-testing-audit.md)
- [Independent Platform Review](global-testing-review.md)
- [Install and Run](../getting-started/install.md)
- [Engine Stack Usage](engine-stack-usage.md)
