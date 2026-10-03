---
title: Shared Test and Tool Queue
description: Order tests and tools by prerequisites, coordinate shared resources, and review queue decisions in HTML.
updated: 2026-09-12
---

<!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha -->

# Shared Test and Tool Queue

The global runners expand declared prerequisites, queue ready work, and acquire resource leases before starting it. A [repository resource lease](../getting-started/glossary.md#repository-tooling) holds a named shared or exclusive claim until job cleanup finishes. Participating queues under the same OS user coordinate across processes and checkouts. The HTML Queue tab explains what ran, what waited, and why.

## Plan and run

Run these commands from the repository root:

```powershell
# Inspect the complete prerequisite chain without executing it.
python tools/run_tools.py plan --id 'tool:MD/tools/build_llms.py'

# Automatically run the documentation validator before the discovery builder.
python tools/run_tools.py run --id 'tool:MD/tools/build_llms.py' --jobs 2

# Use the same queue for test suites.
python tools/run_tests.py plan --suite 'python:tests/tooling/test_scheduler.py'
python tools/run_tests.py run --suite 'python:tests/tooling/*' --jobs 2
```

`--jobs` sets the maximum number of admitted jobs, from 1 to 32; its default is 1. Resource policies can reduce actual concurrency. `--queue-timeout` bounds waiting for resource leases after prerequisites are ready, with a default of 300 seconds. `--timeout` separately bounds an admitted child process. `--dry-run` also prints the expanded plan.

The planner rejects missing executable prerequisites, cycles, duplicate selections, and invalid resource policies before starting any process. A prerequisite appears once per plan even when several jobs depend on it. Every prerequisite must pass. Failed, skipped, blocked, timed-out, errored, or unrun prerequisites block their dependents. Source imports, ownership, and ordinary `uses` relationships do not create execution dependencies.

Source: `tools/tooling/scheduling.py`, `tools/run_tools.py`, `tools/run_tests.py`.

## Declare scheduling policy

Use `scheduling` on a reviewed command, or the top-level ID-to-policy `scheduling` mapping in `tools/tooling/registry.json` for existing test adapters. Do not declare both for the same ID. For example, the existing discovery builder declares:

```json
{
  "dependsOn": ["tool:MD/tools/build_docs.py"],
  "resources": ["workspace:docs"]
}
```

| Field | Contract |
| --- | --- |
| `dependsOn` | Unique executable IDs that must pass first. The planner includes them even when they were not selected explicitly. |
| `parallelSafe` | Reviewed declaration that a job can share the host and workspace admission gates. Defaults to false. Commands with declared repository outputs cannot enable it. |
| `resources` | Named exclusive resources, such as `host:gpu`, `host:browser`, `host:port:9001`, or `workspace:docs`. Names are normalized and validated. Jobs must use the same name to coordinate. |
| `orchestrator` | Trusted coordination-only adapter that holds no resources and delegates resource-using work to queued children. Cannot combine with resources, parallel safety, or declared repository outputs. |

Unknown jobs and repository output writers acquire exclusive host and workspace gates. Reviewed parallel-safe jobs share those gates, so two compatible readers can overlap while an exclusive writer waits. Browser, GPU, and soak adapters also claim the host browser and GPU resources. Declared resource sets are acquired together; a waiting job releases partial acquisitions and does not occupy a worker slot.

Policies are execution contracts and are included in command digests. They do not make unreviewed discovered tools executable. Review side effects before marking a command parallel-safe. The scheduler cannot infer undeclared writes or resource use from arbitrary code.

A nested queue beneath a resource-holding job is blocked. It cannot borrow or bypass its parent's leases. Flatten prerequisites into one plan or use a reviewed coordination-only adapter. Existing platform regression harnesses that launch isolated nested runner fixtures use explicit orchestrator policies.

Source: `tools/tooling/registry.json`, `tools/tooling/catalog.py`, `tools/tooling/scheduling.py`, `tools/tooling/provenance.py`.

## Collision handling and stopping

The lock layer uses operating-system shared/exclusive file locks. Host locks are shared across participating checkouts for the same user. Workspace locks include the resolved workspace identity. Lock files remain in the user's `.particle-realms/tooling-locks-v1` directory; file existence is not evidence that a lease is held. Kernel-held locks determine ownership, and process exit releases them. The protocol does not steal locks based on age or recorded process IDs.

Each run atomically reserves a fresh or empty evidence directory. Two runners cannot claim the same directory. Queue snapshots replace complete JSON files; Windows replacements briefly retry when an open reader temporarily prevents replacement.

Fail-fast stops new admissions and preserves real outcomes for work already running. Cancellation signals active runners, stops admissions, and waits for their existing child-process cleanup before releasing leases. Cleanup reuses Windows job objects or POSIX process sessions. Worker and checkpoint errors also drain active work and leave terminal queue states. A blocked job has a queue record without an invented execution span.

Source: `tools/tooling/locks.py`, `tools/tooling/scheduling.py`, `tools/testing_platform/execution.py`, `tools/run_particle_matter_validation.py`.

## Read the HTML queue

Open the emitted `tools.html` over the repository HTTP server and select **Queue**. It shows prerequisite IDs, resource modes, wait reasons, queue time, state transitions, and links to actual recorded invocations. The ordinary testing report links to this shared viewer.

While a run is active, **Refresh queue snapshot** updates wait and resource states from the sibling `tool-queue.json`. Reload the report after completion, or import its latest `tool-trace.json`, to load new invocation evidence. Refresh alone does not add invocation records. Imported traces cannot start jobs or replace the queue. Malformed, oversized, or different-run queue snapshots are rejected while retaining the previous view.

| Artifact | Purpose |
| --- | --- |
| `tool-plan.json` | Expanded prerequisite graph, reviewed command contracts, and effective resource claims. |
| `tool-queue.json` | Current/final job states, wait reasons, timestamps, and bounded state-change history. |
| `run.json` | All selected and prerequisite results, including blocked or unrun jobs. |
| `tool-trace.json` | Execution evidence with queue identity, prerequisite IDs, resource claims, and queue time. |
| `tools.html` | Catalog, source relationships, observed invocations, and queue viewer. |

Source: `tools/tooling/reports.py`, `tools/tooling/viewer.html`, `tools/tooling/scheduling.py`.

## Scope and limits

Dependency ordering is local to a plan. Resource admission is cooperative across participating same-user queues. This is not a persistent service or a global FIFO queue. There is no guaranteed cross-process fairness, and a run is not automatically resumed after its parent process dies. Queue history retains at most 10,000 events and reports omitted events.

Manual commands, other OS users, and already-running browser workloads do not join automatically. A Python `host:gpu` lease does not reserve the physical GPU against those workloads. The OS's AI, compute, dependency, and GPU submission schedulers retain their existing scopes. Browser Web Locks use their own origin/storage scope and do not share this Python lock namespace. The existing storage performance lock remains inside its original harnesses; acquiring it again outside those harnesses would deadlock.

See the [runtime scheduling research](global-tooling-research.md) for the audited integration boundaries. Windows locking and descendant cleanup have direct runtime evidence in this implementation; POSIX support has not been exercised on this Windows host.

## See also

- [Shared tools and traces](global-tooling.md)
- [Global testing platform](global-testing.md)
- [Independent queue review](global-tooling-queue-review.md)
