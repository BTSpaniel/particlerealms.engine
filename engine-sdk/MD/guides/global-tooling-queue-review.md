---
title: Shared Test and Tool Queue Review
description: Independent acceptance evidence, dependency and collision regressions, teardown checks, and limits of the shared execution queue.
updated: 2026-09-12
---

<!--
SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
-->

# Shared Test and Tool Queue Review

The independent reviewer rates the shared queue **8.5/10** for its documented cooperative scope on 2026-09-12. This review is for maintainers assessing dependency ordering, resource admission, process cleanup, existing runner compatibility, and the HTML Queue tab. It does not certify every repository workload or reserve hardware against programs outside the protocol.

The reviewer inspected the implementation and wrote adversarial scheduler tests using actual processes, operating-system file locks, child descendants, and controlled worker failures. Review reproduced two exceptional-cleanup defects and one late-preflight defect before the implementation was corrected. A later parallel run exposed test-fixture contention; that failed receipt remains retained, and the corrected final parallel run passes all 13 selected suites.

## Scoring rubric

| Area | Score | Evidence and remaining limit |
| --- | --- | --- |
| Dependency correctness and truthful outcomes | 2.2 / 2.5 | Entire prerequisite closures are validated before execution. Only passed prerequisites admit dependents. Missing dependencies, cycles, duplicates, invalid resource policies, and every nonpassing prerequisite state have regressions. Dependencies are explicit declarations. |
| Resource exclusion and concurrency | 2.2 / 2.5 | Actual concurrent CLI processes wait without colliding. Shared/exclusive locks coordinate across processes and checkouts. Worker limits allow compatible overlap. Participation and resource naming remain cooperative. |
| Failure, cancellation, and cleanup | 1.8 / 2.0 | Timeout, cancellation, interrupt, checkpoint error, and worker-error teardown checks pass. Windows descendants finish before logs and leases become reusable. POSIX behavior is implemented but unexercised on this host. |
| Traceability, viewer, and compatibility | 1.3 / 1.5 | Existing platform suites pass through the queue. Queue records retain dependencies, resources, reasons, and exact invocation links. Actual desktop/mobile inspection and hostile refresh checks pass. Refresh updates queue state separately from invocation evidence. |
| Maintainability and integration scope | 1.0 / 1.5 | Both CLIs share planning, scheduling, locks, reporting, and the existing process runner. Reviewed coordination adapters avoid nested lease deadlocks. There is no persistent service, global fairness guarantee, or automatic recovery after parent termination. |
| **Total** | **8.5 / 10.0** | **Accepted for the documented cooperative queue scope.** |

An unresolved false-green dependency, premature resource release, leaked lease, or nested execution deadlock would prevent acceptance at 8/10 regardless of the numerical total.

Sources: `tools/tooling/scheduling.py`, `tools/tooling/locks.py`, `tools/testing_platform/execution.py`, `tools/run_tests.py`, `tools/run_tools.py`, and `tools/tooling/viewer.html`.

## Recorded execution evidence

The final integrated receipt, `tmp/tooling/queue-accepted/run.json`, records **13/13 suites passed** with **245 passing Python case events**, including subtests. It completed at `2026-09-12T15:49:51.552855+00:00` with two worker slots. Its SHA-256 is `9ea3e79d8e0f227fd923bbe20c1be2c29c68b56006b4416f79344385d9244fbe`.

| Selection | Recorded passing case events |
| --- | --- |
| Five existing testing-platform regression files | 88 |
| Shared catalog | 20 |
| Shared CLI | 14 |
| Resource locks | 19 |
| Provenance | 45 |
| Shared viewer | 8 |
| Queue viewer | 4 |
| Windows receipt publication | 2 |
| Independent scheduler regressions | 45 |

These are assertion events preserved by the existing Python evidence adapter, not counts of unique production behaviors. Direct reruns overlap this coverage and do not add distinct tests.

The final queue records 13 passed jobs and 43 events, with no failed, skipped, blocked, or unrun result. All 13 invocation assessments report `matches-current` for the command contract, and every assessed source reports `matches-catalog`. These comparisons remain unsigned local observations, not authentication claims.

### Retained earlier evidence

The earlier core receipt, `tmp/tooling/queue-verification/run.json`, records 12/12 suites passed and 243 case events before adding the two publication tests. It completed at `2026-09-12T15:39:39.444727+00:00`; its SHA-256 is `f6d04f231e7263a8c64b29d81147eea06410a120a46bec17bf12d670bcfe71c1`.

The core queue records 12 completed jobs and 36 events. Two platform suites overlap from `15:38:11` until the first ends at `15:38:14`, demonstrating actual concurrency. The scheduler suite starts after both its catalog and lock prerequisites pass. The queue-viewer suite starts at `15:39:15.546108+00:00`, after its viewer prerequisite ends at `15:39:15.521637+00:00`.

The core discovery snapshot predates the scheduler's final output-reservation test. That suite's recorded input hash matches the executed file, while its assessment truthfully says `differs-from-catalog`. The 45 recorded scheduler events include the added test. The original catalog and receipt remain unchanged rather than rewriting this evidence of snapshot age.

A subsequent 13-suite run at `tmp/tooling/queue-verified-final/run.json` records 12 passed suites and one failed provenance test. The nested fixture requested the normal exclusive admission gate while an unrelated outer suite held a legitimate resource lease. Its 30-second parent timeout expired. The queue retained the failure; it did not report a pass or silently bypass the lock. The two new Windows receipt-publication tests passed in that run.

The fixture correction supplies the existing `ResourceLocks` class with a private temporary `host_directory` inside test processes and their nested CLI shims. It preserves actual kernel locking and the two-process collision handshake. Production lock defaults, admission rules, and environment handling are unchanged. The corrected scheduler and provenance files then passed **40 test methods and 50 subtests in 8.33 seconds**, followed by the successful final 13-suite run. The failed parallel receipt remains available for comparison.

### Reproduce the selection

Reproduce the integrated selection from the repository root:

```powershell
python tools/run_tests.py run --suite 'python:tests/testing_platform/*' --suite 'python:tests/tooling/*' --jobs 2
```

Sources: the retained receipts and child JUnit/log files; `tests/tooling/test_scheduler.py`, `tests/tooling/test_provenance.py`, `tests/tooling/test_locks.py`, and `tests/tooling/test_receipt_publish.py`. Artifacts under `tmp/` are local evidence. The source-controlled tests provide repeatable checks.

## Adversarial checks and corrections

- **Preflight before any launch:** a later job's malformed resource name initially survived planning. The complete resource sets now validate during graph construction, before an earlier valid job can start.
- **Truthful prerequisite success:** failed, errored, blocked, skipped, timed-out, and unrun prerequisites all block transitive dependents. Independent branches continue. Blocked jobs receive queue records without invented invocation spans.
- **Actual collision prevention:** two Python CLI processes share one fixture lock namespace and one exclusive resource. A child also claims an exclusive file as a collision witness. The second queue records resource waiting, starts only after the first releases, and both retain passed results.
- **Bounded concurrency and fail-fast:** barrier-synchronized workers demonstrate two concurrent admissions without exceeding the configured limit. Fail-fast stops new admissions while preserving outcomes for already-running work.
- **Cleanup before reuse:** real child descendants inherit log handles. Timeout, explicit cancellation, and main-thread interruption must release those handles before a conflicting follow-up can rename the log. These checks pass on Windows.
- **Checkpoint and worker errors:** an initial callback error left stale active queue rows. Another exceptional path stopped draining after the first worker error and abandoned a later lease. Common completion handling now drains every active future, releases every lease, and terminalizes pending records before the final notification.
- **Nested execution:** inherited active-lease markers block nested queues before lock acquisition. Reviewed coordination-only adapters hold no leases and can delegate to child queues. Tests do not grant general lease inheritance or bypass authority.
- **Evidence-directory ownership:** simultaneous processes race to reserve the same output directory. Exactly one owns it, and the retained owner record matches the successful process.
- **Atomic Windows publication:** actual reader handles deny replacement temporarily or persistently. Temporary denial retries and succeeds after release. Persistent denial raises within the bounded retry period, preserves the last valid JSON, and removes the temporary file.

Sources: `tests/tooling/test_scheduler.py`, `tests/tooling/test_receipt_publish.py`, `tools/tooling/scheduling.py`, and `tools/run_particle_matter_validation.py`.

The explicit cancellation and cleanup checks follow Python's documented distinction between cancelling pending futures and stopping running processes. Executor cancellation alone does not terminate active work. See the official [future cancellation documentation](https://docs.python.org/3/library/concurrent.futures.html) and [subprocess timeout handling](https://docs.python.org/3/library/subprocess.html).

## Actual HTML acceptance

`tmp/tooling/queue-verification/qa-browser.json` records a real-browser exercise of the completed 12-job report over HTTP. It checks the actual resource list and retained dependency wait, follows a prerequisite to its exact invocation, opens an actual log and declared source file with HTTP 200 responses, and refreshes the local queue snapshot. Refresh preserves the 12 already-loaded invocation records.

There are zero page errors and no horizontal page overflow at 390 pixels. The reviewer inspected `qa-desktop.png` and `qa-mobile.png` in the same directory. The browser check acquired and released the shared admission/workspace gates and exclusive browser/GPU resources. Four queue-viewer regressions additionally exercise malformed snapshots, hostile text, bounded refresh, and exact trace/span linking.

Source: `tests/tooling/test_queue_viewer.py`, `tools/tooling/viewer.html`, and the retained browser QA artifact.

## Remaining limits

The queue coordinates participating processes for the same OS user. Manual commands, other users, live browser workloads, and undeclared resource use remain outside this protocol. A named GPU lease does not reserve the physical GPU. Source imports and ownership relations do not imply execution dependencies.

Reviewed `parallelSafe` and `orchestrator` policies are trusted declarations. A coordination-only adapter must delegate resource-using work to queued children. Unknown jobs and declared repository output writers retain conservative exclusive gates. Exact resource names must agree across participating commands.

Dependency order is local to each plan. Cross-process admission has no FIFO or starvation guarantee. There is no automatic persistent resumption. A resource timeout remains a visible blocked outcome and may reflect ordinary capacity pressure. Event history is bounded and reports omissions.

The existing browser/runtime schedulers and legacy storage performance lock keep their original scopes. Browser Web Locks do not share this Python lock namespace. This review does not certify POSIX teardown, unrelated hardware/evaluation paths, or every legacy repository suite. Previously recorded schema-catalog and Virtual Realm defects remain described in the [testing-platform review](global-testing-review.md).

## See also

- [Shared test and tool queue](global-tooling-queue.md)
- [Shared tooling foundation review](global-tooling-review.md)
- [Global testing platform review](global-testing-review.md)
- [Runtime scheduling research and boundaries](global-tooling-research.md)
