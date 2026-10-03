---
title: System One decision models
description: Configure System One models, budgeted Action Assist, RealmForge Build Assist and host-controlled Game Director decisions.
updated: 2026-09-22
---

# System One decision models

System One models evaluate explicit questions over supplied context. They return
typed decisions and probabilities rather than conversational text. This guide
explains how to connect a compatible model to AI Echo's optional Decision Assist.

**System One** is the category; **Decision Assist** describes the feature.
Jev is one model family, not the category itself. A decision model runs alongside
the selected chat model: it does not retrain that model, upgrade its weights or
guarantee better answers. See [TypeSafe's System One definition](https://docs.typesafe.ai/concepts/system-one).

## Choose a provider

| Provider | Model examples | Transport |
| --- | --- | --- |
| TypeSafe native | `jev-latest`, `jev-preview`, `jev-1.13.0` | Updated WebGPU OS Companion, TypeSafe key |
| OpenRouter | `~typesafe/jev-latest`, `typesafe/jev-1.13` | Updated Companion or browser-direct, OpenRouter key |
| Compatible custom endpoint, Kev | `kev-latest`, or an advertised serving alias | Explicitly approved `/v1` API base, compatible server already running |
| Compatible custom endpoint, Decider | Model ID advertised by the server | Explicitly approved `/v1` API base, compatible server already running |

The leading `~` belongs to OpenRouter's latest alias. The native and
OpenRouter version identifiers are not interchangeable.
Native requests use `https://api.typesafe.ai/v1/systemone`.
OpenRouter requests use `https://openrouter.ai/api/alpha/decisions`,
not `/chat/completions`. The OpenRouter endpoint is an alpha API.

Sources: [TypeSafe API](https://docs.typesafe.ai/api),
[TypeSafe models](https://docs.typesafe.ai/models),
[OpenRouter Jev](https://openrouter.ai/typesafe/jev-1.13/),
[OpenRouter latest alias](https://openrouter.ai/~typesafe/jev-latest/),
[OpenRouter OpenAPI contract](https://openrouter.ai/openapi.json).
Implementation: `webgpu-os/browser-extension/services/AIProviderCatalog.js`,
`ProviderProtocol.js`, `AIProviderService.js`, and
`webgpu-os/kernel/ai-hub/DirectProviderBridge.js`.

## Configure AI Echo

1. Reload the updated app and, when using it, the updated Companion.
2. Open AI Echo Settings, then Connection.
3. Find **System One** and select TypeSafe native, OpenRouter Decisions or a
   compatible custom endpoint. The model badge reflects your selection.
4. Use **Manage key**. Native TypeSafe requires Companion with its AI service
   enabled. Browser-direct OpenRouter shows an inline session-only key field.
   **Check setup** reads provider support and credential availability without
   paid inference; it does not authenticate the key against the remote provider.
5. Choose a model ID. Native discovery lists the authenticated TypeSafe
   aliases. OpenRouter's chat catalog may omit Jev; an explicit Decisions ID
   still works without a chat-catalog entry.
6. For a custom endpoint, choose its model family, enter its API base, and
   explicitly approve that endpoint. Discover or enter its served model ID.
   Choosing a family does not install a model or start a server. Custom keys are
   optional and share the existing custom-provider credential slot.
7. Choose the help to enable: routing advice, answer review, Action Assist,
   Build Assist or Game Director. All are off by default.
8. For Action, Build or Game modes, use **Use priced Jev 1.13** to pin the
   selected provider's reviewed model version. Review the spending limits.
   Explicitly allow page sharing for browser actions, or app sharing for
   app, build and game decisions. Save Connection settings.

These options make additional inference requests and disclose
the current user text to the selected service. Review additionally discloses
the completed answer. No TypeSafe key is required when OpenRouter is selected.
Companion and browser-direct credentials remain separate. Hosted providers may
charge for these requests. A self-hosted model is not automatically free under
the routing policy: unknown pricing stays unknown.

### Self-hosted endpoint requirements

Custom System One requests use the approved API base plus `/systemone`, for
example `http://127.0.0.1:8008/v1/systemone` for a Kev server on port 8008.
Enter its API base, such as `http://127.0.0.1:8008/v1`, in the UI.
Normal endpoint validation, explicit approval and revocation still apply.
HTTP is allowed only for loopback. Browser-direct HTTP loopback is restricted
to an OS page itself running on localhost; the production HTTPS OS should use
Companion or a user-controlled HTTPS proxy. Browser-direct endpoints also need
working CORS, including authorization preflight when a key is configured.

Kev includes CORS handling, but its optional authentication can reject browser
preflight requests. Decider's reference server does not configure CORS or
authentication. Use Companion for local access or configure a secure CORS proxy;
do not expose an unauthenticated server to the public internet. These server
requirements come from [Kev's server source](https://github.com/jaredpalmer/kev/blob/c4e3340307d2ed4d42be8304a76f1bc621ab8d19/kev/serve.py)
and [Decider's server source](https://github.com/Mapika/decider/blob/7557fe058e0b31ffcf754b7c5bb31a452454ce89/decider/serve.py).

Discovery reads the server's advertised models; it does not prove inference
quality or install checkpoints. The returned model identity is retained even
when the server reports a different name from the requested alias.

Routing advice only changes the workload family used to rank eligible models.
The existing kernel still selects and authorizes the route. Manual routing
does not call System One for route advice. Attachment-bearing, sensitive and
source-code inputs skip advisory routing.

Answer review reports relevance, clarity and explicit acknowledgement of
uncertainty. It does not verify facts, prove tool execution, authorize actions,
rewrite the answer or automatically retry a task. Attached, sensitive,
source-code and reported tool-executing tasks skip review. Low confidence,
missing credentials, cancellation and provider failures leave existing
routing and checks in place.

Free-only Smart policy excludes paid decisions. A pinned, reviewed model can
now use budget-reserved routing and review under known-price and bounded-budget
policies. Unpriced aliases and compatible custom servers still skip those
policies; they remain available for legacy routing/review without those
constraints. There is no automatic cross-provider retry.

Sources: `webgpu-os/kernel/ai-hub/JevAssistance.js`,
`webgpu-os/apps/ai-echo/JevSettingsPanel.js`, `factory.js`,
and `webgpu-os/kernel/ai-hub/ModelCapabilityRegistry.js`.

## Three workflow modes

System One selects from code-owned choices. It cannot invent tool arguments,
grant permissions or declare a task complete. Existing chat planning remains
available when a decision is unavailable, uncertain, waiting or escalated.

| Mode | Implemented scope | Authority and verification |
| --- | --- | --- |
| Action Assist | AI Echo browser text inspection, scrolling and same-origin link navigation; a host adapter for other app workflows | Existing tool admission, approvals and execution; fresh page and exact target checks |
| Build Assist | RealmForge template review, workspace inspection, preview inspection and diagnostic recommendations | Read-only recommendation; applying a template or proposal still uses the normal reviewed workflow |
| Game Director | Event-driven host adapter for encounter, NPC and pacing choices | Host-approved candidates, current rules and revision, host commit and independent state verification |

### Action Assist

AI Echo builds at most 16 choices from a successful semantic browser snapshot
observed within the last 15 seconds. It excludes protected, disabled and editable
targets, blocking challenges, foreign-origin navigation and common consequential
actions. The provider receives scrubbed labels, the page origin and title, and
the task objective, not selectors, execution arguments, URL query strings or
screenshots. Credential-like objectives are refused before inference.

The selected opaque ID maps back to one exact code-owned operation. The normal
planner validator, tool authorization and execution path remain mandatory.
The browser adapter rechecks the page-state fingerprint and exact target before
acting. After a successful assisted operation, Echo requests a fresh snapshot
through its tools without spending another planning-model call. Neither model
confidence nor a provider's completion claim proves an action happened.

This initial scope does not automate arbitrary buttons, typing, form submission,
payments, credentials, JavaScript or native movement. A stale page or settings
change invalidates its selection. The ordinary planner handles unsupported
workflows under its existing controls.

Sources: `webgpu-os/kernel/execution/SystemOneActionPlanner.js`,
`TwoPassPlannerFinalizer.js`, and `webgpu-os/apps/ai-echo/AgentToolset.js`.

### Build Assist

The live RealmForge tool catalog includes `os.realmforge.recommendBuildStep`
when the app-scoped decision API is available. Echo can call it with an
`objective`. It shares revision and compilation-status metadata, counts of
diagnostics and available template labels, not source text or diagnostic bodies.
It recommends an existing read-only inspection or template review step.

Recommendations carry their expected document revision and content hash.
Changing the draft or document, revoking consent, cancelling the task or
unmounting RealmForge invalidates pending advice. A selected template is a
review pointer, not an instruction to apply it. Build Assist does not add
unsupported modeling operations or bypass existing proposal approval.

Sources: `webgpu-os/apps/realmforge/modeler/ai/RealmForgeBuildAssist.js` and
`webgpu-os/apps/realmforge/factory.js`.

### Game Director and other app workflows

`SystemOneGameDirector` and `SystemOneAppActionAssist` are reusable app-host
adapters in `webgpu-os/factory/sdk/SystemOneGameDirector.js`. They are not
automatically attached to every existing game. A game or app must supply its
own bounded state, legal candidates and authoritative implementation.

The host provides `getOptions`, `assertHostAuthority`, `getRevision`,
`getRulesVersion`, `getState`, `getCandidates`, `isCandidateAllowed`,
`applyCandidate` and `verifyApplied`, plus its app-scoped `aiHub` and stable
`taskId`. `getOptions` supplies reviewed settings and sharing consent.
`applyCandidate` must compare its `expectedRevision` and call `assertCurrent`
at its actual commit boundary. `verifyApplied` must inspect authoritative state
independently and return exactly `true` before the adapter reports `applied`.

Call `onEvent({ id, kind, sequence }, { signal })` for meaningful events.
Game kinds are `encounter`, `npc` and `pacing`; app Action Assist uses `action`.
The controller rejects replayed IDs, non-monotonic sequences, concurrent
decisions and rate-limit violations. The default minimum interval is one second,
not a call per frame. `dispose()` cancels its pending decision. Rules, settings,
provider, policy or state changes invalidate in-flight choices. Unknown commit
outcomes consume the event and are not automatically retried.

The host retains engine rules, physics, exact arithmetic and legal state
transitions. Audit metadata includes the event, revision, rules version,
candidate and provider request identity; it is not a substitute for a durable
game-state log. `tests/system-one-consumers.test.js` contains executable game
and app host fixtures using the production adapters.

## Sharing, spending and usage

The three workflow modes require separate explicit consent for page content
and app content. Changing provider or endpoint clears those sharing opt-ins.
The common decision helper rejects credential-like state and candidate text
before capability, key or inference requests. This pattern filter is not a
complete personal-data detector: hosts must still minimize and redact their
own snapshots. Non-standard privacy contexts skip assistance.

Budgeted decisions require `jev-1.13.0` on TypeSafe or `typesafe/jev-1.13` on
OpenRouter. The exact dated OpenRouter pin `typesafe/jev-1.13-20260917` is also
reviewed. OpenRouter's version alias may return that exact dated identity;
other dates and versions are not accepted through a wildcard.
See the [OpenRouter response example](https://openrouter.ai/blog/tutorials/jev-vs-llm-when-to-use-each/).
Latest aliases and custom servers do not have a reviewed price for
these modes. The reviewed price is $0.042 per million input tokens and no
output-token charge. Cheap does not mean free or unlimited.
Sources: [TypeSafe model pricing](https://docs.typesafe.ai/models),
[OpenRouter Jev 1.13](https://openrouter.ai/typesafe/jev-1.13/).

Default limits are $0.001 per decision, $0.05 per day and 24 decisions per
stable app task. Limits use integer millionths of a US dollar. AI Hub reserves
a conservative estimate before dispatch under a cross-tab lock. Its ledger
is persistent, operator-profile scoped and shared across app callers. It
stores accounting identifiers and costs, not prompts, page content or keys.
Per-task counts survive midnight. Unresolved reservations remain charged after
reload, cancellation or the change of day; undispatched cancellations release
their reservation. Missing locks, corrupt storage or failed persistence refuse
new calls instead of silently resetting the budget.
The ledger bounds storage at 10,000 retained charge rows and 10,000 task
identities per profile. Reaching capacity fails closed; there is no automatic
reset or user-facing uncertain-charge reconciliation control in this version.

Usage receipts separate the conservative charged estimate from actual
token-based or provider-reported cost. The estimate is not a provider invoice
or a guarantee against provider misbilling. A changed returned model identity
blocks further calls to that priced route until accounting is reviewed.
Global Smart policy is also enforced. A Smart daily cap needs current global
usage; decision charges may be counted conservatively again when they already
appear in that total. Unknown usage does not disable the cap.

Sources: `webgpu-os/kernel/ai-hub/SystemOneBudget.js`, `JevAssistance.js`,
`AIService.js`, `webgpu-os/kernel/Syscalls.js`, and
`webgpu-os/apps/ai-echo/JevSettingsPanel.js`.

### Confidence is model-specific

The threshold filters the selected model's reported confidence. A value of
`0.75` does not mean a decision is 75% likely to be correct. Kev adjusts Choice
confidence relative to a uniform baseline; Decider uses the largest probability.
Their Score confidence formulas also differ. Validate and tune thresholds on
representative data before relying on advice. Missing or malformed typed
answers are rejected, not converted into successful reviews.

Sources: [Kev answer implementation](https://github.com/jaredpalmer/kev/blob/c4e3340307d2ed4d42be8304a76f1bc621ab8d19/kev/api.py),
[Decider answer implementation](https://github.com/Mapika/decider/blob/7557fe058e0b31ffcf754b7c5bb31a452454ce89/decider/systemone.py).

### Other System One families

[Bespoke Nimble](https://github.com/bespokelabsai/nimble) and
[Laya](https://huggingface.co/convaiinnovations/laya) belong to the broader
decision-model ecosystem but do not expose a verified drop-in TypeSafe HTTP
contract in this integration. They are not offered as working adapters.
Nimble uses a different enum/bool schema; Laya exposes Python inference APIs
and warns that the published model needs domain tuning and calibration.
An endpoint is supported here only if it implements the validated
Choice/Score/Noul contract. No OpenRouter availability is implied for these
families, Kev or Decider.

## Submit typed questions from an app

Workflow integrations use `syscalls.aiHub.decideSystemOne` with an enabled mode,
explicit sharing consent, a stable task ID, redacted state and a finite
`candidates` list. It returns advice and accounting receipts, never execution
authority. `scope: 'page'` and `scope: 'app'` require the matching sharing
consent; Build Assist and Game Director accept only app scope.

The lower-level typed API remains available for explicit evaluations by apps
with the existing AI Hub permission. The following example is not an
automatically budgeted workflow call:

```javascript
const result = await syscalls.aiHub.request({
    task: 'evaluate-feedback',
    provider: 'openrouter',
    model: '~typesafe/jev-latest',
    systemOne: {
        state: { feedback: 'The editor is clear, but saving takes too long.' },
        questions: {
            topic: {
                type: 'choice',
                instructions: 'Which area needs attention?',
                criteria: { usability: 'Clarity and navigation', performance: 'Speed' },
            },
            clarity: {
                type: 'score',
                instructions: 'How clear is this feedback?',
                criteria: ['Unclear', 'Partly clear', 'Clear'],
            },
            actionable: {
                type: 'noul',
                instructions: 'Does this feedback identify an actionable problem?',
            },
        },
    },
});
console.log(result.answers, result.usage);
```

For native TypeSafe, change `provider` to `typesafe` and `model` to
`jev-latest`. For an already approved compatible server, use `provider: 'custom'`,
its `baseUrl` and its advertised model ID. State and instructions can contain text or JSON context.
Choice supports 1–255 options. Score supports 2–10 ordered levels. Noul
returns a probability from 0 to 1.

Requests reject chat messages, streaming, tools, generation parameters, output
schemas and chat provider requirements. Responses retain typed answers,
probability distributions, returned model identity and usage. Results remain
untrusted model predictions. Known Jev, Kev and Decider identities and explicit
System One catalog entries are excluded from ordinary chat and general cognition
model pools even if other catalog metadata incorrectly marks them as chat.
The legacy `jev` settings key is retained so saved opt-ins and Jev aliases
survive the category rename without a destructive migration.

Sources: `webgpu-os/kernel/ai-hub/RequestNormalizer.js`, `AIService.js`,
`ResultBroker.js`, and the shared `ProviderProtocol.js`.

## Verification

`tests/typesafe-jev.html` exercises native and OpenRouter request contracts,
both Companion source variants, browser-direct dispatch, cancellation,
failure status, credentials, cost attribution and settings. Its provider
responses are controlled test fixtures, not evidence of paid live inference.
`tests/system-one.html` adds custom endpoint, compatible model, catalog isolation,
approval, settings and strict-response regressions. The AI Echo routing suite
separately checks that advice cannot replace kernel route authority.

`tests/system-one-decision-budget.html` tests durable reservations, profile
isolation, concurrent callers, limits, model identity, sensitive-state refusal,
cancellation and queued consent revocation. `tests/system-one-actions.html`
tests browser candidate narrowing, stale observations, exact target binding
and ordinary tool-plan construction. `tests/system-one-consumers.html` tests
RealmForge registration, app workflows and authoritative game-host commits.
Run them with `python tests/navi/run_system_one_tests.py --suite all`.
The runner blocks external traffic. These regressions do not measure live-model
success rates, latency or real total task cost; those need an explicitly
budgeted representative benchmark before widening browser actions.

## See also

- [WebGPU OS architecture](architecture.md)
- [Navi architecture and delivery](navi-architecture-and-delivery.md)
- [Security and trust model](../concepts/security-model.md)
