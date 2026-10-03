---
title: Source City Modeler Integration Plan
description: Source-backed, dependency-ordered plan for a dedicated RealmForge source-city document mode after standalone Save/Open acceptance.
audience: implementers, reviewers, and local operators
updated: 2026-09-26
status: source-city authoring, mounted Desktop, ground clearance, durable local movement, inhabitant inspection, wayfinding, source signs, captured-source inspector and passive captured-city map verified; optional first-person mouse-look capture approved but deferred and unimplemented while the original live-city integration resumes; full OS boot and live actor admission remain open
---

# Source City Modeler Integration Plan

The next integration is a dedicated source-city authoring mode inside RealmForge.
It must open, inspect, edit, save and preview the existing `design.source-city`
document without converting it into a ForgeSource assembly. This plan is for
implementation and review. Its offside preparation, manual persistence and
explicit session-level editing are implemented. The document owner now has a
separate opt-in city lifecycle, and a focused semantic controls component now
edits and inspects that genuine Session. An app-owned first-person preview peer
is now implemented and natively verified. A dedicated composed city panel is
implemented and verified with native saved-design reopening. The normal factory now
selects this mode when its launching host supplies the process/operator-bound city
presentation contract. Integrated factory/native verification is complete;
full Desktop boot remains a separate open gate.
The Asset Library now also creates a source-city asset from either reviewed
capture, with native Create/Save/fresh-page reopening verification.
Actual Desktop window launch, titlebar close decisions, minimize/restore and
saved-city process relaunch now pass a separate native integration gate.
Requested switching between existing accounts also passes a native gate that
protects unsaved decisions before revocation. Other profile mutations and
complete emergency-lock recovery remain outside that gate.
The genuine Start menu and taskbar now also pass a separate city integration
gate, including exact saved-city reopening. This is component integration,
not execution of `Desktop.mount()` or the complete OS startup sequence.
The subsequent opt-in mounted-shell composition now passes its own six-case
gate and complete native Setup-to-saved-city journey. Evidence and exact source
snapshots are recorded below; earlier component receipts are not substituted
for mounted-shell acceptance. Full OS boot and live NPC admission remain open.
The standalone city and its accepted Save/Open path remain usable.
The app-owned first-person city also has submitted-frame inhabitant identity and
destination labels, with native mouse, keyboard and resize verification.
Captured file and district signs now share that overlay, with an independent
local visibility control and genuine submitted-file selection priority.
The next independent ground-geometry and clearance-grid prerequisite is now
implemented and verified. The inspection camera shares those exact building
boxes; live bodies and NPC authority are not enabled by the grid.
The subsequent explicitly approved local simulation now renders two independent
moving inhabitants in this existing city, with Start/Stop and collision-resolved
CPU poses. Native visual and lifecycle verification are complete. This does not
activate autonomous NPC tasks or the live Realm actor host.
Read-only inhabitant inspection now also passes actual-app and native input
verification. Select either visible inhabitant to inspect real measured pose,
private task progress, saved arrival evidence and retained history. This uses
the same first-person renderer and does not enable tasks or new world authority.

Acceptance sections below retain the boundary at the time each component was
verified. The final normal-launch section supersedes earlier statements that
the factory route is still disabled; it does not retroactively turn component
tests into full Desktop boot evidence.

## Approved decision

The user approved this extension with "continue" on 2026-09-20. Extend
RealmForge's current empty-or-ForgeSource document contract with an explicit
source-city authoring mode. Keep its three entrypoints null,
retain manual saving, and require a genuine editor-owned preview connection
before enabling the new mode in the normal app. Existing assembly editing,
autosave policy and runtime behavior must remain unchanged.

This is distinct from enabling The Virtual Realm's unfinished live OS runtime.
It grants no filesystem discovery, new source capture, networking, remote-city
access, M1C admission, B4H/full-provider activation or Factory execution.
First Shard remains excluded from all scans and tests.

## Verified starting point

The accepted standalone workbench has real first-person rendering, source
selection, import roads, captured directories, labels, three appearance inputs
and manual source-bound Save/Open. Its last completed checkpoint passed 188
browser cases and 101 Python checks plus seven subtests. These are historical
acceptance results, not results for the proposed Modeler changes.

The saved document deliberately contains one authored design resource and a
source digest, not the captured metadata or executable geometry. Its asset and
resource IDs remain stable across saves. The source-city recipe compiler already
belongs to RealmForge. No second city generator or document store is needed.

Sources: `RealmSourceCityDesignDocument.js`, `RealmSourceCityDesignSession.js`
and `RealmSourceCityRecipeCompiler.js` under
`webgpu-os/apps/realmforge/virtual-realm/`; see the
[Save/Open checkpoint](source-city-workbench.md#saved-design-acceptance-checkpoint).

## Existing integration path and gaps

Normal opening follows `RealmForgeApp.openAsset()` in
`webgpu-os/apps/realmforge/factory.js`, then
`RealmForgeActiveDocument._openAsset()` / `_prepareCandidate()`, then
`ModelerSession.prepareDocumentStore()` / `activateDocument()`. The app selects
its visible panel through `_showModeler()`. Preserve this ownership sequence;
do not mount a second independent persistence session inside the editor.

| System and exact source | Current behavior | Required change or reuse |
| --- | --- | --- |
| `webgpu-os/apps/realmforge/modeler/session/ModelerSession.js` | Default preparation still rejects a nonempty document without an assembly. A separate original editing token now admits city content, edits, history and manual lifecycle operations. | Connect this explicit route to the verified app lifecycle and preview; do not broaden default assembly preparation. |
| `webgpu-os/apps/realmforge/modeler/session/ModelerSessionState.js` | City content and recipe output have their own state lane; source drafts stay empty and assembly results stay null. | Reuse this state for a dedicated view without synthesizing source text, parts or a successful assembly result. |
| `webgpu-os/apps/realmforge/catalog/RealmForgeAssetCatalogProjection.js` | Generic resources already project without an assembly. A successful assembly compile result without an assembly entrypoint rejects. | Reuse generic projection with a null ForgeSource compile result; keep city scene/report in the city branch. |
| `webgpu-os/apps/realmforge/document/lifecycle/RealmForgeActiveDocument.js` | An explicit `sourceCityEditing: true` constructor option selects strict city preparation, manual persistence and no source/SystemGraph drafts. Default assembly behavior stays selected otherwise. | Connect the future focused view to this owner; retain explicit Save and close/discard decisions. |
| `webgpu-os/apps/realmforge/document/persistence/RealmForgePersistenceCoordinator.js` | The default automatic policy schedules store changes and shutdown publication. The opt-in city lifecycle now selects genuine initialized manual persistence. | Keep explicit Save and close/discard decisions in the future view; never emulate manual mode with an infinite timer. |
| `webgpu-os/apps/realmforge/modeler/ui/RealmForgeInspectorAdapterRegistry.js` | Presentation descriptors exist; editable kinds are currently closed to specific existing editors. | Add truthful city inspection and a dedicated bounded parameter editor. A presentation descriptor is not runtime authority. |
| `webgpu-os/apps/realmforge/modeler/ui/ModelerPanel.js` and `webgpu-os/apps/realmforge/factory.js` | The normal panel assumes the existing Modeler session and tools. | Select a focused city view/controller by the verified document kind. Disable inapplicable assembly/source/simulation/export operations explicitly. |
| `webgpu-os/apps/realmforge/modeler/viewport/ModelerViewport.js` | Owns a real app surface and GPU generation through `syscalls.gpu.acquireSurface` and `getDevice`. | Integrate the city through reviewed editor-owned presentation. The standalone native test host is not a production authority. |
| `webgpu-os/apps/realmforge/virtual-realm/RealmSourceCityDesignDocument.js` | Creates, validates and updates the exact design envelope using the real document store. | Reuse its payload validation, identities, semantic hashing and transaction semantics. |
| `webgpu-os/apps/realmforge/document/repository/RealmForgeRevisionRepository.js` | Verifies durable heads, immutable resources, history and guarded publication. | Reuse the editor's repository and storage, including both expected-head guards and verified-head transition leases. |

Registering `design` in another catalog cannot solve these gaps. The current
ResourceAdapter runtime is not a substitute for document-kind admission.
Likewise, importing `RealmSourceCityDesignSession` into the Modeler would create
the wrong storage ownership: that session intentionally borrows standalone
page storage rather than the app's supplied storage authority.

## Flat six-piece build sequence

1. **[NEW] Reviewed source availability.** Add an opt-in production-owned
   resolver for the two existing frozen captures, keyed by exact inventory and
   digest. Promote reviewed bytes without rescanning source or duplicating
   competing authorities; retain compatibility test routes and byte pins.
   Missing, unsupported or mismatched captures reject before document switch.
   No arbitrary URL/path lookup or `tests/` import enters production.
2. **[MODIFY] Source-city semantic mode.** Extend the actual session/state
   preparation path with exact design validation and the existing compiler.
   Keep city scene/report separate from ForgeSource results. Bind prepared work
   to the original store, snapshot and generation. Include edit/history and
   external replacement, not only initial Open. Unknown or mixed profiles reject.
3. **[MODIFY] Document-kind lifecycle policy.** Reuse ActiveDocument, the store,
   repository and app storage. City mode has no invented source/graph drafts and
   no automatic publication on edit or close. Drain accepted Save operations;
   unsaved close/switch requires an explicit save/discard decision. Preserve
   existing assembly autosave, recovery, no-op and shutdown semantics.
4. **[NEW/MODIFY] Focused city editor and preview connection.** Add a flat city
   panel/controller selected by the verified kind. Reuse the three bounds and
   source inspection models. Build the real app-owned preview integration and
   prove surface/frame/resource cleanup. Keep first-person browsing; add no
   remote overview or fake standalone-host injection into production.
5. **[MODIFY] Editing and durable identity.** Use the one active store for
   bounded parameter transactions and history. Preflight before accepting a
   candidate; keep invalid form text distinct from semantic content. Save/Open
   reuse real guarded publication. Preserve document/resource IDs, source
   digest and path when reopening the same asset; unchanged edits stay no-ops.
6. **[NEW/MODIFY] End-to-end acceptance and rollout.** Test genuine document
   switching and native preview, then enable the normal app route only after
   all required gates pass. Retain standalone regressions and old assembly
   behavior. Record actual evidence and limits in the roadmap and memory.

These are separate implementation pieces, not six new milestone names. The
original M0-M1C and M2 provider ledger remains unchanged. Each piece must be
complete and independently testable; an intermediate CPU gate is not a claim
that normal-app source-city editing is ready.

### First implementation gate

Implementation starts with reviewed source availability and genuine session
candidate preparation. Exercise both captures against the real document store
and catalog. The prepared city must retain its own compile report and exact
resource identity without mutating the current assembly or publishing storage.
Do not add a visible Open-in-RealmForge promise until the real lifecycle and
preview connection are ready. This order avoids exposing a button that merely
reaches the existing assembly-only rejection.

### Source and storage rules

The saved design's digest alone cannot reconstruct a city. Supply exactly the
matching reviewed capture and validate it with the existing recipe compiler.
The accepted historical fixtures remain at
`tests/virtual-realm/source-city.snapshot.json` and
`tests/virtual-realm/source-city-kernel.snapshot.json`. Production copies now
live under `webgpu-os/apps/realmforge/virtual-realm/captures/`, with exactly the
same bytes. The fixed production catalog pins their lengths and raw SHA-256
hashes; independent tests require byte equality with the historical fixtures.
These are immutable evidence copies, not two competing live capture producers.
No source was recaptured. The explicit inventory bounds remain 36 and 40 files.

The development preview at port 9018 and an OS served from another port have
different origin-private storage. Even on the same origin, app/operator-scoped
storage is not automatically the standalone page's storage authority. Never
claim the normal app can discover existing standalone saves by path alone.
First acceptance uses an explicitly selected design accessible through the
actual app storage. Cross-origin/operator import is a separate explicit transfer,
not a hidden copy, scan, migration or prerequisite to falsely simulate.

The resolver and preview must not infer permission from document content,
digests, source paths or remote city visibility. This mode authors a captured
city design. It does not admit the resulting scene into the live Virtual Realm.

### Manual save and last-good rules

In the proposed city mode, automatic save on edit and automatic publication on
close remain off. Closing drains already accepted saves. Unsaved semantic edits
require an explicit Save, Discard or Cancel choice when leaving the document.
Discard means relinquishing the unsaved in-memory version, never deleting the
last durable asset. Existing assembly policies do not change.

Do not report an accepted semantic edit as saved merely because compilation or
GPU drawing succeeded. Conversely, a device failure must not rewrite or delete
a verified saved design. Keep form draft, semantic store, durable head and
displayed preview identities separate; show when the preview is last-good or
unavailable. Validate/compile offside before changing semantic authority; late
or cancelled preparation must not activate itself.

## Acceptance matrix

The focused suite is implemented at
`tests/realmforge/source-city-modeler-document.test.js` with its browser entry
and HTML gate. Its first scope is offside preparation, not the entire matrix.
Reuse the existing harness and
genuine store/session classes; orchestration tests using an in-memory storage
backend are not durable-storage or native rendering evidence.

| Group | Required proof |
| --- | --- |
| Document kind | Exact city accepted in the new branch; existing empty and assembly cases unchanged; mixed/unknown documents reject. No assembly/part/source injection. |
| Source binding | Missing, wrong-digest and unsupported captures reject before active store/catalog/profile change. Both real reviewed captures compile with the saved design. |
| Edit/history | Bounds, invalid drafts, no-op edits, stable identities and source digest; undo/redo compiles the restored city and never enters ForgeSource mutation. |
| Currentness | Stale prepared stores, cancelled operations and external replacement preserve authority; late native work is released rather than displayed. |
| Persistence | Manual-only behavior, unchanged-save no publication, real Save/fresh reopen, stale peer rejection, accepted-write drainage and explicit dirty-close decisions. |
| Visible integration | Native assembly-to-city-to-assembly switching, first-person city preview, parameter edits, selection, resize, close/reopen, suspend/resume and device-loss behavior. |
| Storage boundary | Native evidence uses actual app storage. No success claim based on a different origin/profile or fabricated operator scope. |

Preserve the exact existing suites:
`tests/realmforge/phase2.modeler-document.test.js`,
`tests/realmforge/phase2.modeler-integration.test.js`,
`tests/realmforge/phase2.session-document.test.js`,
`tests/realmforge/phase2.active-document.test.js` and
`tests/realmforge/phase2.persistence.test.js`, plus every current source-city gate.
Extend regression coverage for any shared lifecycle change before enabling it.
Reconcile the exact module/test closure and source hashes at implementation
time; historical counts are not a substitute for running changed code.

## Observability, rollback and completion

Log document kind, source resolution, candidate preparation, activation,
parameter acceptance/rejection, manual publication, conflict, cancellation and
cleanup. Include generation, semantic revision and elapsed duration where
relevant. Expose bounded diagnostic records, not native handles or source text.

During construction, keep the normal app route disabled and retain the working
standalone city. If a gate fails, stop at that piece, preserve the previous
document and saved assets, and record the failed evidence. Never loosen the
old assembly validator, invent admission, or delete a user's design to make
the new mode appear functional.

Completion means a real RealmForge-owned city document, bounded edits, real
native preview and guarded app-storage Save/Open all pass together. It does
not mean the live Virtual Realm provider, networking, code-glyph disclosure,
multiplayer city bridges, local Operations View or RF-GE6 is complete.

## Preparation-only implementation

The first implementation has three flat owners:

- `virtual-realm/RealmSourceCityCaptureCatalog.js` owns the frozen two-capture
  descriptor map and exact production asset loading. `requireRealmSourceCityCapture`
  rejects unknown profiles or source digests before fetch. `loadRealmSourceCityCapture`
  uses the fixed module-relative URL, no credentials or redirects, an exact
  streaming byte ceiling and raw SHA-256 verification before parsing. It returns
  frozen historical metadata and performs no filesystem discovery.
- `virtual-realm/RealmSourceCityDocumentPreparation.js` exports
  `prepareRealmSourceCityDocumentStore(store, { inventory, signal })`. It requires
  the real `RealmForgeDocumentStore`, reuses the existing design decoder and V2
  compiler, and checks the exact original snapshot after asynchronous decoding,
  capture loading and compilation. Its frozen result contains the unchanged
  document identity, design, scene, build report and source evidence. It has no
  persistence or GPU side effects.
- `modeler/session/ModelerSession.js` exposes
  `prepareSourceCityDocumentStore(store, options)` and
  `readPreparedSourceCityDocument(token)`. Preparation uses the genuine catalog
  offside with a null ForgeSource result. Its private token binds the original
  session, candidate snapshot, active store and active snapshot. Reads reject
  copied, foreign, discarded, aborted or stale tokens. The existing
  `discardPreparedDocument()` releases the inert candidate.

All paths in this list are relative to `webgpu-os/apps/realmforge/`. Ordinary
`prepareDocumentStore()` remains unchanged and still rejects a design-only city
as a normal active document. Both activation routes reject preparation-only
city tokens before construction cancellation or document-switch side effects;
the private commit path also rejects them. No new route is wired into the app
factory or visible panel.

The public token and a previously returned report are historical inert data.
Only a fresh `readPreparedSourceCityDocument()` call checks currentness, and even
that does not guarantee currentness after subsequent asynchronous work. No
prepared result grants activation, runtime, storage or GPU authority.

This first checkpoint covered only preparation. The later semantic-editing
section records its distinct activation contract. Neither the inert token nor
this historical CPU-only checkpoint grants active-document authority.

### Preparation acceptance checkpoint

Accepted on 2026-09-20 after actual browser execution against the genuine
`ModelerSession`, document stores, catalog, compiler and both reviewed captures:

| Verification | Result and scope |
| --- | --- |
| New source-city Modeler gate | 20/20: capture loading, exact identity, offside compilation, cancellation, candidate/session changes, token ownership, activation denial and unchanged default preparation. |
| Existing Modeler regressions | 23/23: `phase2.modeler-document`, `phase2.modeler-integration` and `phase2.session-document`, without modifying their fixtures. |
| Existing source-city gates | 188/188 across all ten current gates, including the existing document gate's native origin-private storage checks. |
| Combined Python checks | 113 passed plus seven subtests: presenter source, both capture inventories, workbench and 12 new preparation structural checks. |
| Source integrity | 811 declared modules, no unresolved/cyclic/skipped dependencies; 837 before/after/current source bindings matched, with served bytes matched to the pre-run bindings. |
| Independent review | No actionable production/currentness/activation findings. |

The browser total is 231/231 across 14 gates, with no skipped or blocked cases,
denied routes or unexpected browser errors. The unchanged Modeler document
suite intentionally emits three transaction-error diagnostics for its three
stale-hash rejection cases. The runner retains their raw events and accepts only
those exact structured diagnostics and transaction IDs in that suite; any
missing, duplicate or additional error fails acceptance.

The first run exposed two mistakes in the new tests: an in-memory document
snapshot was passed as a durable manifest, and a legacy `setSource()` path was
incorrectly expected to set `documentMode` to `editable`. The fixtures now use
the real in-memory store constructor and preserve the actual previous mode.
Actual assembly activation still must yield `editable`. No production guard
or existing regression was weakened. Negative response fault injection is
labelled as diagnostic-only; successful capture preparation uses native HTTP.

Reproduce the browser gate with
`python -B tests/realmforge/run_source_city_modeler_document.py`. The runner
serves only its exact reviewed routes in an isolated browser profile; it does
not boot the OS, enumerate directories or read First Shard. Acceptance artifacts:

- Browser receipt: local temporary artifact
  `C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-modeler-0d39x4yl/receipt.json`,
  SHA-256 `f0247109d9e641226bc6bcd6ea5d95c20d2fe7ec91f0dc03cb5338948fc84323`.
- Python JUnit: local temporary artifact
  `C:/Users/btspa/AppData/Local/Temp/virtual-realm-modeler-preparation-python.xml`,
  SHA-256 `25f4eca3b31504a52c4c326fb5c0c5d83ba805cb41b1e56e83be6f038c5ab1ed`.
- The unsuccessful first receipt is retained at
  `C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-modeler-u_i9n1tc/receipt.json`.

This checkpoint does not repeat native city drawing/interaction acceptance or
prove active-editor persistence. The standalone main, HTML, design session and
recipe compiler retain their previous accepted hashes. The existing preview
was not restarted, reloaded or saved. At that checkpoint, ActiveDocument and
persistence policy were unchanged. The later manual-policy work below also
runs their full lifecycle regression gates.

## Manual persistence policy prerequisite

The explicit manual policy is implemented in
`webgpu-os/apps/realmforge/document/persistence/RealmForgePersistenceCoordinator.js`
and passed browser acceptance on 2026-09-20. This is an independently testable part of
the approved lifecycle piece, not Modeler activation. The existing shutdown path
publishes final edits automatically; a city must not enter that path until its
document-kind policy and user decisions are connected correctly.

`RealmForgePersistenceCoordinator.create()` accepts the closed
`publicationPolicy` option, either `automatic` (the unchanged default) or
`manual`. A private field holds the choice; the getter and immutable snapshot
report it. The manual branch reuses `RealmForgeSaveCoordinator` and the existing
guarded repository publisher. It does not introduce a second save queue,
document store or storage authority.

| Operation in manual mode | Implemented behavior |
| --- | --- |
| Create a new coordinator | Read existing authority, but do not schedule initial publication. |
| Edit, undo or redo the store | Report dirty state; do not request or schedule a save. |
| `flush({ reason })` | Admit explicit Save before its first await; reuse genuine capture, history, guarded publication and no-op behavior. Any custom reason still reports saving, not autosaving. |
| `revalidateDurableHead()` | Verify the disk head without scheduling unsaved edits or retrying a failed manual Save. An expected absent head is unchanged only when every previously known durable identity is null. Disappearance of a known head remains a conflict. |
| `whenSettled()` | Drain already-admitted manual Saves and any active publication without creating a retry. |
| `shutdown({ reason })` | Reject new admission, drain Saves accepted at the close call, then close only if clean. Unsaved content rejects with `RF_PERSISTENCE_UNSAVED` and leaves the coordinator open for a decision. |
| `shutdown({ reason, discardUnsaved: true })` | After accepted work settles, release the coordinator without publishing later edits. This neither reverts the in-memory store nor deletes the durable asset. |
| Unknown Save outcome | Preserve the failure and refuse retry, discard or close as successful completion. |

The `discardUnsaved` option is a strict boolean; `true` is valid only in manual
mode. A definitive failed Save can be discarded after it settles, but an
uncertain completion cannot. Ordinary rejected dirty close is a decision
request, not a new storage failure, and does not erase an earlier Save error.
The lifecycle owner must offer Save, Discard or Cancel and fence semantic edits
around that decision. The coordinator itself does not seal the document store
or display a prompt.

For an already-authorized real document store and repository:

```javascript
const persistence = await RealmForgePersistenceCoordinator.create({
    store,
    repository,
    publicationPolicy: 'manual',
});
await persistence.flush({ reason: 'source-city-user-save' });
await persistence.shutdown({ reason: 'source-city-close' });
```

The Save capture remains the latest semantic snapshot at the actual capture
boundary, not a promise of a button-time snapshot. An edit accepted after that
capture stays unsaved unless another explicit Save is admitted. A no-op Save
reports the existing known saved-head identity; it is not an implicit disk
refresh. Explicit revalidation and the unchanged compare-and-swap publisher
remain the external-change controls.

The new native gate is
`tests/realmforge/source-city-manual-persistence.test.js`, with its browser entry
and HTML. It uses actual origin-private browser storage and real repositories,
stores and coordinators. Its random digest-shaped asset paths are isolated test
namespaces, not filename/source-binding evidence. Design payloads use the real
reviewed captures. Failure injection and unknown-outcome diagnostics are
labelled negative tests, not claims of native process-crash recovery.

The expanded regression gate also exposed two older lifecycle issues. First,
the old shutdown assertion expected zero persistence listeners even while a
failed dirty document deliberately retained its Session recovery owner. The
exact pre-policy coordinator reproduced that failure. The test now requires
one recovery listener, a successful real Session Save with freshly reloaded
durable evidence, then a real close with zero listeners.

Second, unchanged-head verification cleared a failed Recent/Last Open write
warning. `RealmForgeActiveDocument` now remembers that error's origin and does
not clear it merely because the separate document head verifies. Existing
Save/Open/close error-clearing behavior and external-change handling remain
otherwise unchanged. The test explicitly waits for lifecycle work, revalidates
the head and requires the real wrapped profile error code/message, unchanged
profile evidence and the successful document publication. This is a warning
retention fix, not source-city activation or a new profile retry policy.

### Manual policy acceptance checkpoint

| Verification | Result and scope |
| --- | --- |
| New manual policy gate | 21/21 native browser cases using actual origin-private storage, including Save/reopen, no implicit writes, explicit discard, accepted-write drainage, failed Save recovery, external changes and expected initial head absence. |
| Existing lifecycle gates | 57/57 across Modeler document, integration, session, ActiveDocument and persistence. The ActiveDocument failure case now proves real recovery and retained profile warnings. |
| Source-city gates | 20/20 offside preparation and 188/188 existing city cases. |
| Python | 124 passed plus seven subtests, including 11 new policy/publication-boundary checks. |
| Source integrity | 817 exact declared modules; 843 source bindings unchanged before/after execution; 840 served routes, no excluded source reads or denied requests. |

The final total is 286/286 cases across 17 gates, with no skipped/blocked cases,
unexpected browser errors or cleanup failure. The three precisely classified
stale-hash diagnostics described above remain intentional and retained. The
runner's temporary-profile cleanup now retries transient Windows handle locks
only after validating its exact owned temporary directory; terminal failures
still fail the receipt. This does not delete or manage user browser profiles.

Reproduce with `python -B tests/realmforge/run_source_city_modeler_document.py`.
Final local acceptance artifacts:

- Browser receipt:
  `C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-modeler-z05fa2nr/receipt.json`,
  SHA-256 `1cf034ab95ae5b4bd2ada859af59b808cd56b98bf777b71defe1d2751b89fd46`.
- Python JUnit:
  `C:/Users/btspa/AppData/Local/Temp/virtual-realm-manual-persistence-python-final.xml`,
  SHA-256 `81c2cba7fa85d4d0fc599d0a9dd42717dd06e171696861c5d1432477501feb47`.
- The separate pre-policy coordinator diagnostic reproduced the old recovery
  listener assertion failure, not a passing suite:
  `C:/Users/btspa/AppData/Local/Temp/realmforge-active-document-baseline-lck0do7t/receipt.json`.

These results do not repeat native GPU drawing/interaction acceptance and do
not prove normal-app activation, live source access or active-editor storage.
The manual gate's real browser storage is an isolated test profile, not the
operator's saved city. The known repository publication method is byte-pinned
to its pre-change body; no publication/history/compare-and-swap rule changed.

This policy is reused by the explicit session mode and the opt-in ActiveDocument
lifecycle. City documents omit inapplicable source/SystemGraph draft recovery.
The normal app route remains disabled until genuine editor
preview and end-to-end activation pass. No existing city was activated, saved,
reloaded or changed by the policy prerequisite.

## Explicit source-city semantic editing

The actual `ModelerSession` now supports an opt-in city document independently
of its unchanged default assembly preparation. This implements semantic
authoring, not a second document store, standalone session embedded in the app,
or a production viewport. All production paths below remain under
`webgpu-os/apps/realmforge/`.

### Preparation and state ownership

`ModelerSession.prepareSourceCityEditingStore(store, { inventory, signal })`
reuses the accepted offside preparation and creates a distinct private token.
Its public kind is `source-city-editing`; the old `source-city` token remains
preparation-only and cannot activate. The new token binds the original session
state, active store/snapshot, candidate store/snapshot and cancellation signal.
Copied, foreign, discarded, changed or aborted candidates cannot activate.
Discarding a token also fences an activation already queued with that token.

Activation uses the existing `activateDocument({ store, prepared, persistence })`
operation. Supply the initialized result of
`await RealmForgePersistenceCoordinator.create({ store, repository,
publicationPolicy: 'manual' })`. A copied coordinator facade, an automatic or
closed coordinator, a different store, draft recovery, or city read-only mode
is rejected. This gate does not introduce city recovery-read-only behavior.

`ModelerSessionState.adoptSourceCityContent()` binds the real semantic
revision/hash to the immutable city design, scene and recipe report. Its
`sourceCity` lane is independent of ForgeSource:

- `documentKind` is `source-city`; `sourceCityState` exposes the prepared city.
- Source text remains empty, draft state remains `empty` with `ok: false`, and
  the ForgeSource result, compiled model and compiled revision remain null.
- Generic catalog projection uses the real snapshot and a null assembly result.
- Saved markers remain independent from content/history; workspace clocks are
  not reset by an edit. Public summary metadata excludes scene byte-copy methods.
- Phase 6/7/8 projections, SystemGraph plans and runtime objects are not invented
  for a design-only document. Source, draft, binary and assembly-runtime routes
  explicitly reject city documents, including relevant post-await mutations.

### Transactions, history and failure behavior

`updateSourceCityDesign(input, { actor, baseRevision, expectedContentHash,
signal })` accepts the existing complete V1 design record. The existing factory
validates and detaches its input before asynchronous work. Only the established
building width, row spacing and height scale are authorable; source digest,
recipe identity and strict envelope rules are not broadened.

The session captures its original store before queuing the operation. The
existing `updateRealmSourceCityDesignStore()` still performs one genuine
transaction with the original resource ID, path, base revision and resource
hash. Its optional precommit callback runs only after strict design decoding.
The city compiler, state validation and generic catalog projection all finish
before the store accepts a changed candidate. Cancellation, unavailable capture
or compilation failure leaves the store, history and previous city intact.

The shared preparation module now also exports
`prepareRealmSourceCityDocumentSnapshot(snapshot, { inventory, signal })` for
immutable store candidates. It shares one decoder/loading/compiler pipeline
with the existing store helper. It deliberately does not call `store.whenIdle()`:
inside a precommit validator that would wait on the transaction waiting for it.
The session remains responsible for store identity and final commit currentness.

Undo, redo and their guarded variants use the same candidate compiler before
history commit. Revisions increase while content hashes and geometry can return
to an earlier design. Exact no-op edits preserve snapshot, scene, report, history
and catalog identity and make no capture request. Nothing publishes automatically.

The revision-collision boundary preserves scene/report identity and rebinds
only semantic revision/snapshot metadata. The store's boundary receipt contains
a detached persistence copy, so live city state binds `store.snapshot()`, not
the receipt's clone. The browser case directly verifies this boundary; it does
not claim to have induced a native disk collision.

### Manual lifecycle behavior

Explicit `saveDurable()` reuses genuine publication and saved markers. Its city
branch refuses admission after close or a mutation lease, binds the original
store/coordinator across queue drainage, and cannot update a replacement session
after publication. A Save admitted before Close may complete and drain; a Save
requested after discard-close cannot publish.

`closeDocument()` drains already accepted edits and Saves. Dirty manual close
rejects with `RF_PERSISTENCE_UNSAVED` and preserves the open coordinator and
in-memory city for a decision. `closeDocument({ discardUnsaved: true })` is an
explicit city-only boolean policy; it drains accepted work and closes without
publishing later edits, deleting an asset or reverting the store. Ordinary
assembly close behavior remains separate. A refused dirty document switch
likewise retains its original open persistence owner.

`settleDocumentForActivation()` drains city persistence and refuses unsaved
content without calling implicit `flush()`. The existing external-replacement
operation gains an explicit city/no-draft branch: exact displaced identity,
independent candidate, verified durable head, publication lease and final
revalidation are still required. It does not create dummy draft callbacks or
publish the displaced city. Existing assembly replacement regressions remain.

### Remaining integration order

1. The genuine `RealmForgeActiveDocument` opt-in lifecycle now selects this city
   kind, creates initialized manual persistence and omits drafts. Explicit Save
   and discard-close are separate actions; the future UI must present them with
   Cancel before attempting a dirty document switch.
2. Compose the implemented city parameter/inspection controls with the actual
   editor-owned first-person preview, using this session's current scene and
   the real app surface/device lifetime. Prove old-frame retirement and cleanup.
3. Run native app-storage, document-switch and preview acceptance together;
   only then enable the normal factory/panel route. A CPU editing test page is
   not the delivered in-app city editor.

No source recapture, First Shard access, M1C/B4H admission, networking, live
Virtual Realm provider, Factory execution or operator-storage migration is
part of this semantic gate. The existing city at port 9018 stays untouched.

### Semantic editing acceptance checkpoint

Accepted on 2026-09-20 against the genuine session, store, catalog, compiler,
repositories and both fixed production captures:

| Verification | Result and scope |
| --- | --- |
| New editing gate | 28/28: original-token activation, both inventories, all three parameters, no-op identity, precommit failures/cancellation, guarded history, assembly preservation, manual Save/reopen/close, revision-only rebind and exact external replacement. |
| Existing browser gates | 286/286 unchanged cases across preparation, native manual persistence, five Phase 2 lifecycle gates and ten source-city gates. |
| Combined browser run | 314/314 across 18 gates; no skips, blocked cases, denied routes, unexpected browser errors or cleanup/transport failure. |
| Combined Python run | 136 passed plus seven subtests, including 12 new editing checks and preserved publication/default-preparation pins. |
| Source evidence | 819 declared modules with zero cycles/skips/unresolved imports; all 847 before/after/current hashes matched, with 833 file-backed served hashes and ten generated routes verified. |

The new gate uses actual sessions, stores and repositories with the existing
in-memory storage fixture to test orchestration. It does not claim app-storage
or native durability from that fixture. The separate 21-case manual policy gate
and existing design-document gate retain their actual origin-private browser
storage tests. Native city drawing/interaction was not rerun in this slice.

The first editing run passed 26/28. Its two fixture mistakes called nonexistent
`session.subscribe` rather than `onChange`, and used an unsupported transaction
actor rather than `user`; both were corrected without weakening production.
Review also found and fixed the Save-after-discard-close admission race. The
final tests cover both rejected late Save and admitted Save draining before close.

Three deliberate negative cases generate genuine Store rejection diagnostics:
aborted precommit edit, unavailable capture during edit, and unavailable capture
during undo. Each case observes exactly one narrowly matched logger record,
forwards every unexpected error and restores the logger in `finally`. The full
immutable records remain in the browser receipt's `expectedNegativeDiagnostics`.
The runner's original three stale-hash diagnostic rules remain unchanged. These
are retained expected errors, not a claim of zero raw error diagnostics.

Two existing Python assertions were adapted only to follow the new method
boundaries: inert preparation checks stop before the new editing methods, and
the design updater check still requires strict decoding before the added
optional precommit callback. All original behavioral assertions remain.

Reproduce browser acceptance with
`python -B tests/realmforge/run_source_city_modeler_document.py`. Final local
artifacts:

- Browser receipt:
  `C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-modeler-tb466gjz/receipt.json`,
  SHA-256 `983ec3d09bb50a4bdfa0e73d27a05f4e194f41e5fc9d950ac69bced9bff2b183`.
- Python JUnit:
  `C:/Users/btspa/AppData/Local/Temp/virtual-realm-modeler-editing-python-final.xml`,
  SHA-256 `6aee69ef18688323cf5e8c0f80394b135b67c32a4cd441f60342df0eb6393106`.
- Failed first editing receipt retained at
  `C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-modeler-r_nu04wb/receipt.json`.

The Session's accepted raw SHA-256 is
`62608f9410c61b7127d3ca50da53868099edbce52aa64bb25550b98aa15052bf`.
Default assembly preparation and its discriminator retain their earlier
independently measured body pins. ActiveDocument, persistence policy, the app
factory, standalone main/HTML/design session and recipe compiler were not
changed this turn. Broad documentation/API/SPDX generation remains excluded
because it would exceed the First Shard boundary; checks here are scoped.

## Opt-in ActiveDocument lifecycle

`webgpu-os/apps/realmforge/document/lifecycle/RealmForgeActiveDocument.js`
owns the new lifecycle path. `sourceCityEditing` is a strict boolean constructor
option, defaulting to `false`. The normal app factory and Modeler panel do not
set it. An explicit caller can use the existing real session and authorized
storage with this controller; no standalone page storage or GPU test host is
injected into production.

```javascript
const documents = await RealmForgeActiveDocument.create({
    session,
    storage,
    sourceCityEditing: true,
    autoOpenLast: false,
});
await documents.openAsset(selectedAssetPath);
await session.updateSourceCityDesign(nextDesign);
await documents.save();
await documents.closeActive();
```

Here `selectedAssetPath` must already identify a genuine verified design asset
in that supplied storage, and `nextDesign` is the existing complete V1 design
record. This example does not create a city, transfer a standalone save, discover
files or enable the normal app UI. Opted-in Last Open can reopen a verified city;
the default controller still refuses design-only city activation.

### Classification and candidate preparation

The flat helper
`virtual-realm/RealmSourceCityDocumentPolicy.js` exports
`resolveRealmSourceCityDocumentInventory(snapshot)`. It examines an existing
verified repository/store snapshot, returns null for non-city documents, and
reserves the exact `design.source-city` type. City records must match one of the
two existing fixed capture digests and pass the complete design-document decoder.
Mixed, malformed or unsupported city documents cannot fall back to an assembly
route. Classification has no fetch, compiler, storage-write or runtime effect.

The controller reuses `prepareSourceCityEditingStore()` for a city candidate,
then creates genuine initialized manual persistence. It entirely skips both
draft repositories, both draft coordinators and the composite draft coordinator.
Progress reports a captured-city projection, not rebuilt runtime projections.
The city active record exposes its kind, selected inventory and manual policy.

Existing verified-head handoff and publication-lease logic remain in use. The
current document's mutation lease and settlement barrier still protect a switch.
Prepared work is discarded on cancellation or candidate failure; late persistence
initialization is abandoned without publishing. The existing assembly path keeps
its draft recovery and automatic policy.

### Save, close and document switches

| Action | City behavior |
| --- | --- |
| `save()` / guarded Save | Reuse the one real Session publication path and Recent/Last Open profile evidence; repeated Save requests retain existing coalescing. |
| `closeActive()` | Drain accepted work; refuse unsaved content without releasing the controller or city. |
| `closeActive({ discardUnsaved: true })` | Explicitly discard unsaved in-memory ownership after accepted work settles, without publishing it or deleting the saved asset. |
| `shutdown()` | Retain the complete controller, profile and listeners when a still-open manual city cannot close. The user can still Save, resolve a conflict or explicitly discard. |
| `shutdown({ discardUnsaved: true })` | Apply the same explicit discard policy after the existing shutdown preflight; unresolved external authority still blocks close. |
| Direct Open of another asset | Clean city switches use the existing verified-head lease. Dirty city switches reject without an implicit Save or discard. |
| Cancel | Leave the retained document open; do not invoke a destructive action. No prompt or new decision enum is fabricated in this CPU lifecycle gate. |

`discardUnsaved` is a strict boolean and `true` must target the original active
city. The controller captures that candidate at request admission and rechecks
it after queued work. If an earlier Open replaces the document, discard rejects
without closing or detaching the replacement. Shutdown checks this before its
terminal cleanup, even when the replacement is an assembly.

To leave a dirty city, a caller explicitly Saves and then Opens, or explicitly
discard-closes and then Opens. This is not an atomic decision-assisted switch:
after an intentional discard-close, a failing subsequent Open leaves no active
document. In contrast, failure while directly preparing a destination leaves the
current city intact. The future UI must represent these choices truthfully.

Known external conflicts must be resolved before city close/discard. New asset
creation and v1 migration while a city is active, city Save As, external copies,
and city recovery activation/restoration are explicitly unsupported in this gate.
They reject before destination publication. Close the city before using unrelated
New/migration workflows. City copy and recovery need their own future contracts:
the current design has a fixed document name, exact envelope and no recovery
read-only mode. A restoration candidate is classified before `recoverRevision()`,
even when the controller's city option is disabled.

### External changes and observability

Clean external changes rebuild a fresh city through the same strict classifier,
compiler and manual owner. Dirty changes retain Mine and Disk and require the
existing current conflict token and explicit confirmation before reload. No
draft stand-in is created to satisfy the assembly replacement contract.

Candidate preparation now occurs inside the existing clean/explicit reload
failure boundary. If capture loading, strict decoding or cancellation prevents
replacement, the controller preserves the old document and refreshes actionable
conflict evidence. Previously a preparation failure could leave persistence
paused without a controller conflict token. The existing bounded conflict refresh
is reused; no second conflict protocol was added.

Existing progress, persistence/profile events and safe error logging report the
new path and refusals. No normal app, native preview, live source or broader realm
authority is activated by this opt-in controller.

### Lifecycle acceptance checkpoint

Accepted on 2026-09-20. The normal factory/panel remains disabled for city mode;
this checkpoint accepts the opt-in document owner, not the editor UI or preview.

| Verification | Result and scope |
| --- | --- |
| New lifecycle gate | 24/24: strict opt-in, both inventories, Last Open, manual-only edits, Save/no-op/coalescing, failed-root retry, retained profile warnings, close/discard/shutdown, both assembly-switch directions, invalid candidates, native cancellation, external changes and unsupported publication routes. |
| Existing browser gates | 314/314 retained across preparation, editing, native manual persistence, five Phase 2 gates and ten source-city gates. |
| Combined browser run | 338/338 across 19 gates; no skips, blocked cases, denied routes, unexpected browser errors or cleanup/transport failure. |
| Combined Python run | 149 passed plus seven subtests, including 13 lifecycle structural checks and all previous semantic/persistence/workbench checks. |
| Exact-source evidence | 822 declared modules, zero cycles/skipped/unresolved imports; 852 before/after/current source bindings matched. All 837 file-backed served routes and ten generated harness routes were checked. |

The lifecycle tests use genuine ActiveDocument, Session, Store, Repository and
PersistenceCoordinator implementations. Their existing in-memory storage fixture
provides controller orchestration and explicitly injected I/O-failure evidence,
not native app-storage durability. Capture fetches use real HTTP and the reviewed
production bytes. The unchanged manual-persistence and design-document gates
retain their native origin-private storage coverage. Native city drawing and the
running port-9018 workbench were not rerun or changed in this slice.

Case 6 proves a failed root write retains the previous durable head/profile and
open dirty city, followed by a real successful explicit retry. A later profile
write failure preserves the successfully saved document and keeps the exact
profile warning through public head revalidation. Case 12 checks both
city-to-assembly and assembly-to-saved-city transitions, including the stale
queued-discard refusal and stable session/listeners.

The initial run passed 21/24. Its independent-writer fixture incorrectly edited a
reopened store before initializing its persistence owner, triggering the genuine
initial-head-divergence protection. Initializing the owner first and then editing
and flushing fixed all three setup failures; no production check was weakened.
The final strengthened focused gate passed 24/24 before the combined run. Its
gate produced zero browser errors. Existing precisely classified stale-hash and
case-local editing diagnostics remain retained in the full receipt; the combined
result is not a claim of zero raw error diagnostics.

Two existing Python assertions now distinguish the opted-in ActiveDocument from
the still-disabled factory/panel. The default flag remains false, and the
standalone main, factory, Session, persistence coordinators and old active-document
browser gate retain their independently checked unchanged bytes.

Reproduce the combined browser run with
`python -B tests/realmforge/run_source_city_modeler_document.py`. Local evidence:

- Final receipt:
  `C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-modeler-yqn27puj/receipt.json`,
  SHA-256 `05ce3c545d3d02be25d13010b699df8b03559c8d86b1dc48e20df0c2b7ff97ab`.
- Before/after source manifests in that directory share SHA-256
  `8af21ce1cb7b851a3f6851d02741c218fc4aeddbc12e851d498952efe549a2cf`.
- Python JUnit:
  `C:/Users/btspa/AppData/Local/Temp/virtual-realm-modeler-lifecycle-python-final.xml`,
  SHA-256 `93a94b4e82b114845db5980f209e0ddba76821adf576bb9c8cca81a572603546`.
- Initial failed receipt retained at
  `C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-modeler-31e6d2au/receipt.json`.
- Final focused receipt retained at
  `C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-modeler-29jy21wa/receipt.json`.

Accepted ActiveDocument SHA-256 is
`dd9a2ee1ed7dd436b908a0fe57275ade23657420ebd9a30194fa42cb6a99cd2d`;
the new classification helper is
`4fc634347a78fbe7a2bc96c1d9e0ab4fa7e80a7e357e7bb5c58c832913a546ab`.
The runner adds only literal reviewed policy/test paths, keeps the existing
module inventory and diagnostic rules, and does not enumerate the repository.
Broad documentation/API/SPDX generation remains excluded by the First Shard
boundary; source headers, document links and whitespace were checked locally.

The following controls component continues this checkpoint. The genuine
editor-owned preview and final panel composition remain next. Keep the normal
app route disabled until app-storage, document-switch, frame retirement and
surface/device cleanup acceptance pass together. Do not repeat the completed
capture, semantic editing, manual policy or ActiveDocument gates as new planning
work, and do not treat this checkpoint as M1C/B4H/full-provider admission.

## Focused city semantic controls

`webgpu-os/apps/realmforge/virtual-realm/RealmSourceCityEditorControls.js` exports
`RealmSourceCityEditorControls`. It requires a genuine `ModelerSession`, not an
invented callback facade. It is a focused component for the future city panel,
not another document owner, a viewport, or an enabled normal-app route.

```javascript
const controls = new RealmSourceCityEditorControls({ session, logger });
controls.mount(container);
// The mounted form now operates on the existing Session's active city.
// During the containing view's teardown:
await controls.destroy();
```

Here `session` is the actual Session already owned by the app and its opted-in
ActiveDocument; `container` is the containing view's DOM element. The component
never creates a Session, repository, storage adapter, persistence owner, surface
or GPU device. An empty or assembly Session displays an unavailable city editor
without changing the document.

### Form, semantic and saved identities

The three metric fields reuse `REALM_SOURCE_CITY_RECIPE_V2.parameterLimits` and
`createRealmSourceCityDesignV1`. Text inputs with numeric input mode preserve
invalid form strings; explicit integer and range validation rejects empty,
fractional, exponential, nonnumeric and out-of-range values before a transaction.
The labels and input metadata expose the actual bounds. No units are guessed or
silently converted.

| Action or observation | Implemented behavior |
| --- | --- |
| Typing | Changes only local form strings. No compile, transaction, history entry or publication. |
| Apply design | Detaches the complete validated record at admission, binds the original Store/revision/hash, and calls the genuine guarded Session edit with a native cancellation signal. |
| Reset form | Discards unapplied text only and rereads the coherent current design. No semantic or durable mutation. |
| Undo / Redo | Uses the existing guarded Session history with actor `user`. Unapplied text must first be applied or reset; history never silently discards it. |
| External semantic edit | A pristine form refreshes. A changed form retains its text, becomes stale and cannot Apply until explicitly reset. |
| Document replacement | Resets fields and captured-file selection for the newly verified document; old city edits cannot enter a replacement Store. |
| Saved status | Shows actual content and saved revisions plus the Session dirty marker and manual policy. Apply and GPU output are never described as Save. |
| Captured file inspection | Lists only the current admitted scene's files and displays captured path/hash/line count/byte count/district/building ID via `textContent`. No file path is read or treated as authority. |

The public component methods are `mount`, `apply`, `resetForm`, `undo`, `redo`,
`selectFile`, `snapshot`, `whenIdle` and `destroy`. Mutation methods reject on
invalid, stale, busy, sealed or unavailable authority. DOM handlers present those
errors in a live status region. `snapshot()` separates immutable form strings,
form dirty/stale/valid status, current semantic/saved identity, selected captured
facts and projection currentness. It does not expose a mutable Store.

Save, Open and Save/Discard/Cancel close decisions remain the existing document
owner's responsibility. There are deliberately no duplicate Save/Close controls
or implicit form Apply in this component. A real Save elsewhere publishes only
the accepted semantic design, even while this form contains different text.
The final composed panel must make that distinction visible.

### Notification ordering and teardown

A Store commit can notify persistence before Session adopts its new city
projection. The controls require exact snapshot, revision and content-hash
agreement before rebinding or admitting edits. During that interval they retain
the prior coherent form/evidence, disable Apply/Reset/Undo/Redo and show a waiting
status. Retained report and content hashes come from the same city projection;
the newer Store hash is not paired with an older report. Reset cannot bypass
that check. Session's own queued guards remain the final mutation checks.

`destroy()` immediately removes the DOM and listeners and aborts pending Apply.
It drains accepted work before releasing retained form/scene/DOM references.
Already-admitted Undo/Redo have no cancellation API and are drained, not falsely
reported as cancelled. Teardown is idempotent, cannot update detached controls
after completion, and never closes or publishes the document. `whenIdle()`
settles the component's current operation even when that operation rejected;
the action's original promise still carries its failure. Logs report mount,
operation entry/settlement/error, reset, duration and teardown.

### Controls acceptance checkpoint

Accepted on 2026-09-20 (local project date). This is a tested production controls
component over the real Session, not a GPU preview or enabled normal app view.

| Verification | Result and scope |
| --- | --- |
| New controls gate | 18/18 genuine DOM cases: authority validation, both captures, exact bounds, invalid/local form isolation, real Apply/history/no-op, stale form and notification ordering, separate Save, inspection, replacement, busy admission and teardown/cancellation. |
| Combined browser run | 356/356 across 20 gates, retaining all 338 previous cases. Zero skips, blocked cases, denied routes or unexpected browser errors; final cleanup completed. |
| Combined Python run | 159 passed plus seven subtests; ten new structural checks and all 149 previous cases retained. |
| Exact-source audit | 825 declared modules; zero cycles/skipped/unresolved imports. All 857 before/after/current bindings matched; 841 file-backed served hashes plus ten reconstructed harness routes matched. |
| Native-input visual inspection | Desktop and 390-pixel viewport screenshots, accessible labels, no horizontal overflow; genuine Apply and captured-file selection, then distinct unapplied form values. This is DOM evidence, not GPU evidence. |

The tests reuse the existing genuine lifecycle fixture and exact negative Store
diagnostic observer through explicit test-only exports. Independently removing
only those export additions reconstructs both previously accepted test files'
exact hashes. No old case body, count or assertion was changed. The first focused
attempt failed because its matcher expected numeric DOMException code `20`;
Store diagnostics serialize the code as string `"20"`. Correcting that expected
value retained the exact matcher. All unexpected records still reach the browser
error gate. The final full receipt retains seven expected diagnostic records:
three original raw records, three editing-local records and one controls-local
aborted-transaction record. It is not a claim of zero raw error diagnostics.

Case 9 observes a genuine Store-to-Session projection interval, records its DOM
state inside a listener, then asserts outside the protected emitter. It proves
that the old form/report/hash stay paired and all mutation/reset actions are
disabled until coherent adoption. Case 17 proves immediate and in-capture Apply
cancellation plus idempotent teardown without publication or document closure.

The separate visual inspection used the same production bytes and real fixture
in an isolated browser, not the port-9018 preview. Native input applied 6100 mm,
selected the captured `engine/core/math/MathVec3.js`, then entered 6900 mm without
Apply. Design, semantic hash, report, saved revision and root publication count
remained unchanged during the latter edit. Three images were inspected at desktop
and narrow widths. All 769 QA source bindings matched, and 755 served hashes
including two exact generated routes were checked. Fixture cleanup closed the
controls and document owner with no active Session document, listeners or DOM
root. The storage fixture still proves orchestration only, not native app-storage
durability.

One `ConnectionAbortedError: [WinError 10053]` was emitted by the full regression
server while writing a response. All browser gates and cleanup passed, but the
generic handler did not identify the route or establish a cause. Its exact
traceback is retained as `server-diagnostic.txt` beside the final receipt. It was
not suppressed or relabelled as a zero-diagnostic run. Separate visual QA had no
browser errors, denied requests or cleanup failure.

Local evidence:

- Full browser receipt:
  `C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-modeler-ssnhjb92/receipt.json`,
  SHA-256 `186c349e29b9fee0639473d87050db039fcdc43dc004cd11962ec4e9134d86c1`.
- Before/after manifests share SHA-256
  `9cc41f95e74540e17610219ca36d31a0d98ae828bce5b6b66a71e905fd9fa803`.
- Python JUnit:
  `C:/Users/btspa/AppData/Local/Temp/virtual-realm-modeler-controls-python-final.xml`,
  SHA-256 `74c7d281f007b8780efb119713baa67df38e2c85724ba468e4536360f7528d41`.
- Visual receipt and three PNGs:
  `C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-controls-qa-86ef132490f84e45aa1bbe095a93486d/`,
  receipt SHA-256 `20f2f7df1307549cfd657f235ec88391bd962884e4e5e56cb5b11a56bff09f15`.
  Exact generated route bytes are retained as `served-main.js` and
  `served-page.html`; the script's ordinary text copy is not substituted for
  the actual served-byte evidence.
- Failed first receipt retained in `realmforge-source-city-modeler-hsp541fn`;
  final focused receipt retained in `realmforge-source-city-modeler-80wb71bw`
  under the same local Temp directory.

Accepted controls SHA-256 is
`47424f47758293a08bb7eae52ec1c15783837433fc0fc8bf7309d4f3322d4f0c`.
ActiveDocument, Session, compiler, captures, persistence owners, normal factory,
ModelerPanel and existing city preview are unchanged. Broad documentation/API
generation remains excluded by the First Shard boundary; changed source headers,
document links and whitespace were checked by exact path.

### App-owned preview: implementation and reuse boundary

The existing assembly `ModelerViewport.js` remains unchanged. Its ordinary
surface is not directly interchangeable with the city draw kernel's admitted
sRGB presentation view. The existing
`webgpu-os/apps/the-virtual-realm/runtime/RealmGpuPresentationSyscallAdapter.js`
already requests a receipt-bound surface and supplies the resource-release
interface used by the kernel. `webgpu-os/kernel/Syscalls.js` already exposes the
guarded presentation-receipt, transfer/job, app-owned surface and frame-producer
operations. Mapping this seam did not activate it or modify kernel authority.

`RealmSourceCityPreview.js` is a flat city viewport peer consuming the exact
current `Session.sourceCityState.scene`. Its shared production renderer reuses
`REALM_STATIC_GPU_DRAW_KERNEL` and `RealmStaticGpuResourceOwner`; navigation,
input, picking, relation tracing and directory projection now have production
ownership under `webgpu-os/apps/realmforge/virtual-realm/`. Historical test
imports are compatibility entries, not competing implementations. Production
does not import the developer workbench host, create a device or stop the
global frame loop. The host supplies the actual app GPU syscall namespace and
its trusted binding; document labels and source digests supply neither.

The presentation adapter's producer exposes `dispose`, not a suspend/update
method. The preview retires its complete owned rendering on suspension or
document replacement, then recreates it when appropriate. Preparation and
submitted-frame observations bind to the original Store, compiled scene and
preview generation; the adapter checks the admitted GPU generation. A metadata
rebind retaining the same scene does not rebuild geometry. Intermediate Store
notifications cannot label an old picture with a new semantic head.

`RealmSourceCityPreview` takes `{ session, gpuSyscalls, trustedBinding, logger }`.
The Session must be a genuine `ModelerSession`; the binding is detached into
immutable scalar fields. `mount(host)` creates a local first-person canvas and
status. `whenIdle()` drains setup, retirement and accepted inspection uploads;
it does not promise a rendered frame or native GPU completion. `snapshot()`
reports those states separately, including `lastFrame`, renderer telemetry and
cleanup outcome. `onChange(listener)` returns an unsubscribe function.

WASD, arrow keys, pointer drag, Enter, Home and Escape reuse the reviewed local
input model. Picking uses the last submitted camera, not an unsubmitted input
pose. `selectFile(path)` validates exact captured membership and serializes
selection requests so an earlier coalesced GPU upload cannot be reported as a
later file highlight. The view does not read source files or acquire traversal
permissions. Captured import roads remain distinct from live networking.

`suspend()` closes admission synchronously and waits for owned retirement;
`resume()` constructs a fresh renderer against the current scene. Neither
controls the shared frame coordinator. `destroy()` unsubscribes, disables input,
removes the view immediately and drains owned work. Repeated destruction returns
the same promise. These operations do not save or close the Session.

The shared renderer retains late asynchronous receipts and surfaces before
cleanup, retires its own producer, drains camera/selection uploads and releases
owned resources, surface and receipt. Cleanup has its own live cancellation
channel after ordinary work is retired. The developer compatibility wrapper
alone retains native queue-completion observations and its standalone loop.
Submission and resource-release reports are not native queue-completion proof.

Unavailable GPU admission remains an explicit unavailable preview. Device loss
does not fabricate per-resource destruction: unverified cleanup records failure,
blocks restart on that host, and remains visible to callers. A fresh trusted
host/preview is required after failed cleanup. A stale preparation's cleanup
failure also blocks a new scene rather than silently advancing ownership.

The native gate uses `tests/realmforge/RealmSourceCityNativeAppHost.js`: real
`createSyscalls`/`guardSyscalls`, `Permissions`, `ProcessTable`, admission,
broker, surfaces, frame coordinator and a native WebGPU device. The fixture
provides panel surface scoping without booting Desktop. Its separate-owner
sentinel checks that preview retirement does not stop unrelated producers.
This is app-scoped GPU service composition, not a normal Desktop launch or
native app-storage acceptance. The real Session/document-owner test fixture
still uses explicitly identified in-memory persistence orchestration.

The focused native gate now passes all 18 cases. Older fixtures that substitute
a canvas, ignore `init()` failure or call a private draw method are not
acceptance evidence.
Normal `factory.js`, `ModelerPanel.js` and assembly `ModelerViewport.js` remain
unchanged. The next integration is the composed city panel plus native
app-storage/switch/close acceptance, followed by normal-route enablement.

### App-owned preview acceptance evidence

The final focused native gate passes **18/18**, with no skipped/blocked cases,
unexpected browser errors or denied requests. The exact-source bindings before
and after the run match the served bytes. Receipt:
`C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-modeler-djkw8x7j/receipt.json`
(SHA-256 `e986441f9a93bb808f2ec9f1a2272a77174546c9c958eedb969a6d38854ee7b1`).
Test source SHA-256:
`7f65fe75965a890344c3f1daba428b0106afff4eeb8395d68c3e9019467bf2ea`.

The gate covers both frozen captures, submitted frames and separate native
queue completion, current GPU/preview generations, same-scene Save/no-op
retention, genuine design transactions and Undo/Redo, serialized selection,
independent-producer survival, suspension/edit/resume, city-to-city and
city-to-assembly replacement, actual resize, delayed real capability-result
cancellation/replacement, observer unsubscribe, reentrant/idempotent destroy,
and genuine native device loss. Normal retirement requires zero surfaces,
producers, active receipts, tracked buffers and tracked textures before terminal
host destruction. No synthetic renderer or successful GPU response supplies
those results.

The stationary device-loss case intentionally does not report successful
per-resource destruction. It records all 15 abandoned resource categories,
rejects preview destruction and prevents automatic recovery. Four exact
cleanup errors are retained: the producer cleanup rejection, unverified
individual resource destruction, `VR_M2DB2_PRODUCER_ACTIVE` during surface
release, and `VR_M2DB2_RESOURCES_ACTIVE` during receipt retirement. Kernel
retirement already leaves zero raw surfaces/producers/receipts in this measured
case, and the issued surface lookup returns null. Those counters do not prove
individual resource destruction. The shared loop remains running until the
test host closes it. Final host cleanup and the complete before/after snapshots
are retained in the native receipt. Four expected renderer error diagnostics
are matched only inside this loss case and retained; other errors stay fatal.

The first native smoke rendered **1,117 draw packets** on an NVIDIA GeForce
RTX 5070 Laptop GPU. It separately demonstrated 5 buffers and 10 textures
returning to zero while the independent producer continued. That smoke is
historical supporting evidence; the final 18-case gate is the acceptance run.

Standalone compatibility also passes its **188 browser cases** and actual
walking, editing, Save/Open, resize, restart, normal cleanup and early-close
walkthrough. Receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-native-source-city-0d_933cg/receipt.json`
(SHA-256 `f30e21f4828f72d39594ef1f26a71e7b5bccdfb49f256adab602131ce6b2c496`).
Its 175 declared modules, 200 before/after/current file bindings and 195 served
routes were verified; there were no browser errors or denied requests. This
used an isolated test origin, not the running port-9018 preview.

The nine-file Python regression passes **161 tests plus 7 subtests**, including
the 59 renderer/workbench structural checks. JUnit:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-modeler-preview-python-final.xml`
(SHA-256 `ef50a2beb7053ca4947d2dfe0086debafc77d041b3b33328550a6746d7c89ec3`).
All 12 preservation pins match, covering the factory, Session, ActiveDocument,
controls, compiler, standalone host/main/HTML and both captures in both
locations.

The complete combined run passes **374/374 browser cases across 21 gates**:
all previous 356 cases plus the new 18 native-preview cases. Receipt:
`C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-modeler-g0uqy068/receipt.json`
(SHA-256 `7ec8483838c64446dff6c4e84a0b2e0e01dbad7ac3c5bb80effeaed79e9b072c`).
There are 893 declared modules, 927 before/after/current source bindings and
921 served routes: 911 file-backed routes and 10 independently reconstructed
generated Phase 2 drivers. Both source-manifest hashes are
`4c027978ae9732ba50ec99fd3610551198a00c1402ee2303997c8f977d7ffd3b`.
The native closure retains the existing exactly reviewed four-module startup
cycle; it does not introduce another cycle. No unresolved or skipped modules
are accepted. There are no skipped/blocked cases, denied requests or unexpected
browser errors. Eleven expected negative diagnostics remain visible: the
previous seven document diagnostics and four device-loss renderer records.

One server response-write `ConnectionAbortedError: [WinError 10053]` occurred
during this full run. Its exact traceback is retained in `server-diagnostic.txt`
beside the receipt. The route and cause were not established. All browser gates,
source-binding checks and browser cleanup passed; this is not a claim of zero
server diagnostics.

Earlier failed native attempts remain available in the same Temp directory:
`realmforge-source-city-modeler-2qt6iiqa` (incorrect mutable test binding and
incorrect test-host mount/device coupling), `realmforge-source-city-modeler-5bya4u4h`
and `realmforge-source-city-modeler-5qq158mp` (test comparisons of frozen frame
dimensions against a later resized canvas). The fixtures now use the genuine
frozen binding and separate app-mount currentness from GPU generation. Resize
assertions require the intended target size and a same-callback canvas/frame
pair. No production validation or test tolerance was weakened to pass them.

Final component visual/input QA also passes, separately from the 374-case gate.
It composes the genuine preview and existing controls beside each other on an
isolated generated test page, explicitly labelled as not the normal OS panel.
Actual browser input focuses the canvas, walks with W, resets with Home and
applies a building width of 6,100 mm through the real form. Submitted camera
position moves from `[0, 1.7, -12]` to approximately `[0, 1.7, -9.9724]` before
Home resets it. Apply replaces renderer generation 1 with generation 2; preview
and controls agree on the new semantic hash without a Save write. The narrow
view waits for the intended native surface resize and a newer target generation
before capture. Both desktop and narrow screenshots were visually inspected:
the city is visible, controls and unsaved status are readable, and the narrow
layout stacks without horizontal overflow. These are component and native GPU
checks, not native app-storage durability or normal-panel acceptance.

QA evidence directory:
`C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-preview-qa-87efd8b56936414488e9179413a52324/`.
Its `receipt.json` SHA-256 is
`e0cc8a8fd7553f692b588d585a9f784bdd4e32c75d1ce026a299ee96082246e8`.
The exact generated served bytes and inspection script are retained beside it.
All 850 before/after/current file bindings and 836 served routes, including two
reconstructed generated routes, match. There are no browser errors or denied
requests. Final cleanup closes preview, controls and controller, removes the
root/listeners and returns native surfaces, producers, receipts, buffers and
textures to zero. Screenshot hashes:

- `desktop-applied.png`, 1400 x 1200:
  `4722d649807b317d7a496fad74137c0d0ede322f8b63be5542168f8bd0bd61e7`.
- `narrow-applied.png`, 375 x 1833 captured content:
  `7c7485f7167949fcb98b8e1b1dd86a18f8d4a65b234719e980cc83f4c0f3ba20`.

The next build is the dedicated flat city panel composing these accepted
controls and preview under the existing ActiveDocument owner. It must connect
explicit Save/Open and unsaved-close decisions to that owner, then verify native
app-scoped storage, document switching, host lifecycle and resource retirement
before enabling the factory's normal city route. No additional source capture
or duplicate document, renderer or persistence owner is required.

## Composed city panel

`webgpu-os/apps/realmforge/virtual-realm/RealmSourceCityPanel.js` composes the
accepted controls and preview around a supplied genuine
`RealmForgeActiveDocument`. It derives that owner's Session instead of creating
a second document, repository or persistence coordinator. Its constructor also
requires the existing app GPU namespace and frozen trusted binding. The normal
factory remains unchanged; this is an accepted component integration rather than
a normal OS launch.

The panel has `mount(host)`, `save()`, `openAsset(path)`, `closeDocument()`,
`resolveDecision(choice)`, `selectFile(path)`, `suspend()`, `resume()`,
`whenIdle()`, `snapshot()` and `destroy()`. It exposes the actual child controls
and preview, not alternative implementations. The layout places the first-person
city beside metric controls on wide surfaces and stacks them on narrow surfaces.
The toolbar contains an explicit app-storage path/slug, Open, Save applied design
and Close. It provides no assembly tools, automatic file discovery or source-code
execution. A non-city document keeps its existing editor ownership.

### Manual actions and decisions

Save publishes the accepted semantic design only. Unapplied form text remains
local and is not silently included in publication. Open and Close present an
inline Save/Discard/Cancel decision when either semantic content or form text is
unsaved. The decision retains the original document generation, revision, hash,
Store view and exact form strings. Stale decisions reject, while Cancel can
always clear an idle local decision even after the document becomes an assembly,
conflicted or suspended. Cancel does not alter storage or the document owner.

Save-and-leave requires Apply or Reset first when form text is unapplied. The
prompt tells the operator to Cancel to return to the form. Explicit Discard
relinquishes the unsaved version and form without deleting the last saved asset.
Save then Open, and discard-close then Open, are separate guarded operations,
not an atomic switch. A failed Save retains the decision and current document;
a failed Open after successful discard does not reconstruct discarded content.
The status also shows the owner's external conflict and nonfatal profile-write
warning. A successful durable Save must not hide a failed Recent/Last Open
metadata update. External conflict disables Save/Open/Close and both destructive
decision continuations; idle local Cancel remains available.

`RealmForgeActiveDocument.openAsset`, `saveGuarded` and `closeActive` now accept
an optional `expectedActive` precondition:

- Omitted: preserve existing callers' behavior.
- `null`: require no active owner and no Session document.
- `{ generation, contentRevision, contentHash }`: require that exact original
  owner generation and semantic head, plus current Session Store ownership.

The owner copies an exact plain three-field data record at admission and checks
it inside its existing operation queue before side effects. Accessors, extra
fields, malformed values and mismatches reject with `RF_ACTIVE_DOCUMENT_STALE`.
Guarded Open/Close delay construction cancellation until the guard passes.
The existing explicit-discard target check remains independent. This is a
precondition, not a new permission, lifecycle owner or general queue API.

### Selection and view lifetime

The captured-file dropdown requests the existing GPU selection upload. Successful
selection updates the inspector; preview picking updates the same inspector.
The panel reports pending uploads and prevents older completion from replacing
newer selection intent. It does not fetch the selected source file. Scene changes
invalidate previous selection identity.

Suspend retires the preview's own producer and resources without stopping the
shared frame loop or closing the document. Resume uses a local generation so
an older asynchronous completion cannot undo a later suspension. Destruction
immediately detaches UI listeners and aborts pending Open, drains already accepted
Save, and attempts cleanup of both children even if one fails. The idempotent
destroy promise never implicitly saves or closes the borrowed document owner.
Normal app host lifecycle wiring remains a separate integration requirement.

### Composed acceptance evidence

The complete regression passes **392/392 browser cases across 22 gates**. This
retains all 374 previous cases and adds 18 panel cases. The existing lifecycle
gate remains 24 cases, with additional assertions for copied decision bindings,
malformed/accessor records, stale queued Save/Open/Close after reopening the
same saved head, null-empty ownership and unchanged default behavior. Panel
coverage includes actual controls/preview composition, both captures, semantic
edits/history, manual Save with unapplied form text, failed Save retention,
profile-warning visibility, bidirectional GPU selection, Save/Discard/Cancel,
stale local decisions, paused Open cancellation, accepted Save drainage,
overlapping Resume/Suspend, an independent producer, and city/assembly/empty
transitions. Its document-storage fixture is still explicitly in-memory;
native durability is established by the separate walkthrough below.

Final combined receipt:
`C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-modeler-r29pcjzd/receipt.json`
(SHA-256 `232394b5e878aa29e87f5309e3a2ac18b4f01a29aa8dcddc28e09e5070236fe6`).
The 897-module closure retains only the previously reviewed four-module startup
cycle. All 933 before/after/current source bindings match. The 926 served routes
comprise 916 file-backed routes and ten independently reconstructed generated
drivers. Both manifest hashes are
`5dedd230121e8c507aad53c4296db6acdb709156357b6c6dcbd8b7b29fa7107d`.
There are no skipped/blocked cases, denied requests or unexpected browser
errors. The prior eleven expected negative diagnostics remain explicit. No
server traceback was observed in this final run.

The ten-file Python regression passes **172 tests plus seven subtests**. The
179-record JUnit report has no failures, errors or skips:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-modeler-panel-python-final.xml`
(SHA-256 `e3ff7e06b44fc94ecc08c900d23f4b9487e8b14443f1d2f579a3e8376a571e42`).
Eight new checks cover the panel's composition boundaries and three new checks
cover the queued owner precondition. Existing checks remain. Twelve preservation
pins match, including the factory, Session, persistence owners, controls, preview,
compiler, captures and standalone host/main/HTML. The prior ActiveDocument hash
is reproduced by reversing only the three approved API wrappers and two new
guard helpers; that is an exact change-boundary check, not a new pre-edit hash.

### Genuine account storage and fresh-page reopening

The reproducible native walkthrough is
`tests/realmforge/run_source_city_panel_native.py`. Its opt-in test host composes
the actual `ProfileDriver`, `OperatorContext` and owned `StorageManager` with the
original guarded RealmForge storage and GPU syscall namespaces. Identity uses
native WebCrypto and IndexedDB; account files use native OPFS. It creates an
isolated test identity only when the isolated origin has none, and does not
retain or log its recovery secret. Ordinary account-scoped storage activation
still occurs. No synthetic identity, filesystem adapter or persistence response
supplies the acceptance result.

The walkthrough performs real browser input on the actual panel: Apply 6,100 mm,
select a captured building, type 6,900 mm without applying, and Save. The durable
design remains 6,100 mm. Close requires a decision for the unapplied form; Cancel
retains it, and Reset restores the applied design. Explicit Open switches to the
40-file kernel city and back. It then destroys the panel, shuts down the document
owner, locks the operator context, closes owned storage/GPU services, and closes
that browser target. A different target at the same isolated origin restores
the actual identity and loads the identical asset ID, resource ID, revision,
content hash, commit ID, source digest and design, then submits a new genuine
GPU frame. This proves fresh-page persistence, not browser-process crash recovery
or cross-operator/origin transfer.

Both pages independently verify the actual module storage worker completes a
known hash equal to native WebCrypto, with no fallback, no pending tasks and a
live worker. The runner serves only the exact worker entry declared by
`StorageWorkerClient` and its checked import closure. An initial attempt reached
Save/reopen but correctly failed because this worker route was denied twice.
That failed receipt remains at
`C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-panel-native-_4_upjux/receipt.json`.
The fix added the exact test-server route; production storage was not modified.

Final native receipt:
`C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-panel-native-dqv7j39r/receipt.json`
(SHA-256 `c2350bd2ed91cb338b9670b0f557f51a70d6b5d9ee35bb85e7daaee986d6cd5f`).
All 874 before/after/current bindings and 858 served routes match: 856 file-backed
routes and two independently reconstructed generated routes. Both manifest
hashes are `799539358b4d24e0fda1af1b8c4a78e4f7da4d6d5859d454ca9c6b8cb978d1f2`.
There are no browser/native GPU errors or denied requests. Both terminal
cleanups have zero document listeners, surfaces, frame producers, capability
receipts, tracked buffers and textures, with the UI removed and operator locked.
The walkthrough has no additional regression-case count.

Desktop and narrow screenshots were visually inspected. The actual city,
manual-save status and form remain readable, and the narrow layout stacks
without document-level horizontal overflow. Evidence beside the native receipt:

- `desktop-saved.png`, 1400 x 1200:
  `09009d064e93008ad8f411d48230a5bd015489ccd47ee69682465f7f4fe41ac0`.
- `narrow-saved.png`, 375 x 2074 captured content from a 390 px viewport:
  `7959599cb5a03ba75c6e09c136b04df575a90d3569a5ca25c57a691798a1b6c8`.

### Normal-launch integration

The factory selects `RealmSourceCityPanel` for the verified `source-city` kind.
It retains the original `ModelerPanel` branch for assemblies. Both borrow the
same existing `RealmForgeActiveDocument` and `ModelerSession`. City mode remains
unavailable to an unbound legacy/embedded mount. The source-city branch adapts
visibility to `suspend`/`resume` and awaits the actual panel destruction promise.
(Source: `webgpu-os/apps/realmforge/factory.js`.)

The host contract is `sourceCityPresentation`, a frozen version-1 record with
`binding`, `signal` and `assertCurrent`. The binding is the exact frozen
`{appId, ownerId}` used by the accepted renderer. The owner derives from the
captured ProcessTable entry's immutable `instanceId`, not public process
inventory or document metadata. The launch captures the operator scope before
asynchronous preparation. Retirement disables city actions and presentation;
it does not transfer the existing document to another operator. Private GPU
owner tokens remain private, and guarded syscall admission remains authoritative.

The host-bound document owner forwards storage operations through a currentness
check around the original guarded namespace. It does not create another storage
manager, account or persistence policy. Already admitted operations settle;
revocation cannot authorize a later call against a replacement operator.

`prepareClose` drains accepted panel work and shows the existing Save/Discard/
Cancel decision for semantic changes or unapplied form text. Refusal preserves
the window, process and GPU owner. A successful close must finish the app's
actual `unmount` before Desktop retires that owner. Save and Discard close the
document; the operator can then close the window. Cancel keeps editing.
The existing DOM panel hides itself before emitting its titlebar-close event.
Desktop therefore immediately re-shows only that exact ready RealmForge panel
while the advisory close runs, so its decision remains visible. Other apps keep
their existing close behavior. Source checks cover this Desktop wiring; the
native factory tests do not boot the complete Desktop shell.
The same decision protects a dirty city from a destructive view transition.
An Asset Library button uses the existing Start view, not another browser or
document owner. City-to-city Open reuses the panel; city-to-assembly Open selects
the original assembly editor after the accepted operation settles.

Acceptance requires genuine factory mount, native GPU, actual account-backed
storage, close decisions, source/assembly switching, suspension and startup
cancellation. Full Desktop boot is a distinct claim: the isolated factory test
must not describe itself as a full OS launch. If operator authority is retired
while edits remain, preserve the inert in-memory document; do not silently save,
discard or revive it under another operator. Cross-operator recovery is not
introduced by this integration.
An abrupt retirement is not a normal clean close. The native test records the
renderer abandoning five buffers and ten textures after its authority expires;
surfaces, producers and capability receipts reach zero, but the preterminal
allocation counters do not prove individual resource destruction. The document
owner remains in memory, and shutdown refuses with
`RF_ACTIVE_DOCUMENT_EXTERNAL_RESOLUTION_REQUIRED`. Its final fixture-service
cleanup is recorded separately. This does not prove successful dirty account
switching: Desktop's wider `drainOperator` handling of a refused close is still
a separate coordination concern. No cross-operator recovery or silent discard
was added.
First Shard, the port-9018 preview and the live Virtual Realm provider remain
untouched. Broad documentation/API/SPDX generation and full OS bundling remain
outside the First-Shard-excluded verification scope.

### Normal-launch verification evidence

The 2026-09-21 frozen-source regression run passes 429 browser cases across
25 gates: the prior 392, 15 native factory cases, 12 host cases, and 10 unchanged
assembly-factory lifecycle cases. Each receipt has zero skipped or blocked
cases, zero denied routes and zero unexpected browser errors. These groups
have different evidence scopes; their counts must not imply that every case
uses native storage or the complete OS shell.

| Gate | Result | Evidence scope |
| --- | --- | --- |
| Existing source-city/editor regressions | 392/392 | Existing 22 gates, including native preview and composed panel tests; existing in-memory persistence fixtures remain labelled as such. |
| Normal factory city route | 15/15 | Actual `RealmForgeApp.mount`, native WebGPU, genuine guarded app storage, real ProfileDriver/OperatorContext/AppSandbox, editing, Save, switching, decisions, suspension, cancellation and retirement. |
| Original host lifetime | 12/12 | Genuine ProcessTable/OperatorContext/signals; controlled close/storage callbacks prove ordering, not GPU destruction or durable storage. |
| Existing assembly factory | 10/10 | Unchanged CPU/DOM lifecycle tests with their existing in-memory/orchestration fixture, not native GPU/storage evidence. |
| Focused Python source checks | 183 + 7 subtests | Eleven explicitly named files; 190 JUnit records, zero failures/errors/skips. Includes Desktop class-route and titlebar ordering, not full Desktop execution. |

Final receipts and independently checked before/after/current bindings:

- Native factory/host:
  `C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-factory-ux_xiewb/receipt.json`.
  SHA-256 `547abeda2a1db95633bbc5199d6f49982e019713d8e308ffc25ecf062b74ce1a`;
  1,319 source bindings, 1,299 served routes. Both source manifests:
  `41ea0fd6a2ebdaf02c0fee6e35460f969116573a681874dea1f2a40c955eb6aa`.
- Prior 392:
  `C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-modeler-rzf1anfi/receipt.json`.
  SHA-256 `84ac33eb8f91c07d42267e9a4bd7c6dd22cf174880be60ba8a65a4141f2b70b8`;
  939 source bindings, 932 served routes. One server-side
  `ConnectionAbortedError` traceback is preserved in `server-diagnostic.txt`;
  the initiating request is unknown. This is not a claim of zero server
  diagnostics.
- Unchanged assembly factory:
  `C:/Users/btspa/AppData/Local/Temp/realmforge-factory-legacy-nj7jjrvp/receipt.json`.
  SHA-256 `337a06a518003d2f9c600e8fbd445b5a6310db2c3e217d7463fce0a94f200066`;
  1,265 source bindings, 1,246 served routes. Five expected injected-quota
  diagnostics are retained: two repository, two persistence, one unmount.
- Python:
  `C:/Users/btspa/AppData/Local/Temp/virtual-realm-modeler-factory-python-final.xml`.
  SHA-256 `eb01f07df5cba452ee73358dc3525034ee8b80325a48bf4a754f85a828daaa01`;
  25.923 seconds.

The abrupt-retirement case separately retains two expected renderer cleanup
errors and one expected repository head-load error during refused shutdown.
Native GPU validation errors remain zero. Its receipt includes the exact
abandoned resources, retained document and shutdown error; it is not counted
as a clean resource-destruction case. Normal lifecycle cases retain their
zero-owned-resource, empty-UI and completed-document-cleanup assertions.

The existing native panel persistence walkthrough was rerun on the updated host:
`C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-panel-native-ukuj_yq1/receipt.json`,
SHA-256 `6254dfe58f92cc9a7367e8ecb8e131afe22dd1b7afec7ce8621c811aefd334e4`.
All 880 before/after/current bindings match; 864 routes are recorded with zero
denials or browser errors. A distinct browser target at the same isolated
origin restores the exact saved asset/resource/revision/hash/commit/source and
6,100 mm design. Both pages complete a real storage-worker digest equal to
WebCrypto and cleanly release their native resources before locking the
operator. This walkthrough adds no regression-case count.

The bounded native server loads the actual factory's reviewed static import
graph and the exact storage-worker route. Deferred import declarations are
recorded, not treated as executed; native physics and full Desktop boot are
not run. The legacy assembly gate additionally serves one exact declared
construction-worker import that its unchanged test already exercises.

Diagnostics that drove this slice are retained rather than rewritten as passes:
the initial native fixture lacked Desktop's genuine AppSandbox injection;
the retirement case exposed a clean Save no-op that needed a public host check;
and two passing runtime runs were rejected because bound source files changed
during execution. The final receipts above are from stable sources. Production
permissions and validation were not weakened to accommodate the fixtures.

### Actual factory visual inspection

The genuine native factory fixture was also driven with real browser input at
1400 x 1100. The city and semantic controls are visible together. Typing
6,900 mm without applying it, then choosing Close document, shows the decision
while keeping the city visible. Save-and-continue is disabled for unapplied
text; Cancel retains 6,900 mm. Both screenshots have no document-level
horizontal overflow. This is the actual factory view in its isolated native
host, not a mockup, full Desktop boot or additional regression case.

Evidence directory:
`C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-factory-visual-5y4beydr/`.

- `receipt.json`: SHA-256
  `d884aca0fd3cdf93eb29b80cbbce59296a612ccf04eed82ad9bc4497cbc53e72`.
- `factory-native-city.png`: SHA-256
  `b22ca5699b23430213359c18e4dc68c3763a4700b2655c0a85daafb41acd9b31`.
- `factory-close-decision.png`: SHA-256
  `bc43f32dbe4310a219668778bd656ab7326f33aa10dc906a53bf3b12d2138b45`.

All 1,317 before/after/current source bindings match, with 1,298 reconstructed
served routes and zero denied requests, browser errors or cleanup failures.
Both manifests hash to
`c7584035bfc09aa91dad876139ef41b18bd700d87b5eec83ea888de52eebfd0d`.
After inspection, actual factory unmount removes the view and its commands;
native surfaces, producers, receipts, buffers and textures are zero, and the
isolated operator is locked. The earlier visual-driver startup failure is
retained separately at
`C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-factory-visual-uk7_te3s/receipt.json`.
That driver omitted the real test harness DOM nodes and failed before factory
initialization; fixing its page did not alter the accepted runtime sources.

### Source-city creation from the Asset Library

The normal Asset Library has a separate **Create source city** control when
its original city host is available. The operator selects the reviewed baseline
capture (36 files) or kernel capture (40 files), enters a destination slug, and
explicitly creates the asset. Existing assembly New and its template library
keep their original behavior. The city control uses the existing capture catalog,
slug normalizer, Start-view action/cancellation handling and feedback surface.
(Source: `webgpu-os/apps/realmforge/ui/RealmForgeStartView.js`.)

The authored format is unchanged: the semantic document name remains
`Source City Design`, its design resource gets fresh identity, and all runtime
entrypoints remain null. The destination slug distinguishes assets. No arbitrary
source URL, source digest, semantic document name or replacement design payload
is accepted by this creation API.

`RealmForgeApp.newSourceCity({inventory, slug, path, assetPath, signal})` checks
the original host and mount, normalizes the destination, and binds cancellation
to the original host, mount and optional native caller signal. It captures the
original document generation/revision/hash before asynchronous work. A visible
dirty city or unapplied form first requires the existing Save/Discard/Cancel
decision. Creation does not resume automatically after that decision: resolve
it, then choose Create again. A clean city switches to the Library without
closing its document, so its form cannot receive new unapplied text during
candidate preparation. Failed preparation preserves that document.
(Source: `webgpu-os/apps/realmforge/factory.js`.)

`RealmForgeActiveDocument.newSourceCity({inventory, slug, assetPath, signal,
onProgress, expectedActive})` requires the existing explicit source-city opt-in.
It validates the fixed catalog choice and queued original-owner precondition,
then reuses the existing `_newAsset` candidate/publication/activation flow.
Only the source-city branch constructs the reviewed default design with
`createRealmSourceCityDesignStore`; ordinary assembly creation is unchanged.
The existing Session compiles the pinned capture before publication. The old
editable document's existing mutation lease covers settlement, initial
publication and activation, with repeated checks of its original semantic head.
Dirty or unresolved city authority is not silently saved or discarded.
(Source: `webgpu-os/apps/realmforge/document/lifecycle/RealmForgeActiveDocument.js`.)

**Create is one explicit initial publication**, not a temporary unsaved document.
It publishes revision zero once at the chosen unused destination. Later Apply,
Undo and Redo remain manual-save operations: they do not publish until Save.
Existing destinations are not overwritten. A prepublication failure leaves the
old document active without a new durable head. Publication and activation are
not atomic: a failure after a committed initial publication retains the
existing `RF_ACTIVE_DOCUMENT_CREATED_NOT_ACTIVATED` error and destination for
later Open. Cancellation of presentation after activation reports
`created-not-presented`; it does not delete a successfully created asset or claim
that its editor mounted.

A 16-case creation gate covers actual Library input, both captured inventories,
native frames, Apply/Save, failure/cancellation, dirty decisions, stale hosts,
original semantic-head races, assembly preservation and normal cleanup. A
separate native-input walkthrough proves fresh-page reopening of both new cities.
A truly fresh installation still follows its existing Getting Started flow;
an empty active Library in the isolated test means a real document was closed,
not that first-launch behavior was bypassed.

#### Using the creation entry

1. Open RealmForge's **Asset Library** with the original city-capable host.
2. Under **Create source city**, choose **Baseline** (36 captured files) or
   **Kernel** (40 captured files), then enter an unused city asset slug.
3. Choose **Create source city**. The initial design is published once and opens
   in the genuine first-person city editor.
4. Change the metric appearance parameters and choose **Apply design** to
   preview them. Choose **Save applied design** to publish those applied changes.
   Unapplied form text is not saved.
5. Reopen the saved asset through the same app-owned storage. This does not
   recapture its source or activate the live Virtual Realm.

#### Creation regression evidence

The 2026-09-21 frozen-source run passes **464 browser cases across 28 gates**:
392 existing city/editor cases, the existing 15 native factory and 12 host
cases, 16 new native creation cases, and 29 unchanged assembly/Library cases.
There are no skipped cases, denied routes or unexpected browser errors.
The existing labelled negative diagnostics remain retained; this is not a
claim of zero raw diagnostic events or native storage evidence for every gate.

| Evidence | Result | Scope |
| --- | --- | --- |
| Existing city/editor gates | 392/392 | Prior 22 gates rerun on the extended document owner. |
| Factory, host and creation | 43/43 | Genuine native factory/storage/GPU in the 15 factory and 16 creation cases; the 12 host cases retain their labelled controlled lifecycle callbacks. |
| Existing assembly and Library gates | 29/29 | Unchanged factory 10, Library facade 12 and integrated preview 7; CPU/DOM orchestration, not native storage/GPU proof. |
| Focused Python checks | 192 + 7 subtests | Twelve literal files; 199 JUnit records with zero failures, errors or skips. |

Final receipts, all independently checked against before/after/current sources:

- Existing 392:
  `C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-modeler-3sohygqx/receipt.json`.
  SHA-256 `15eb8241238195491f43285abcb653b0494d86e9b600cd6fc7dae3fdb157a987`;
  939 unchanged bindings, 932 reconstructed served routes. No server traceback
  was observed in this run's captured output.
- Factory/host/creation 43:
  `C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-factory-vrlb9ako/receipt.json`.
  SHA-256 `003ba219366aebcde327cafcc0a5b2a8052f906c9b5a5f3a1565ba92049081b0`;
  1,323 unchanged bindings, 1,302 served routes. Both manifests hash to
  `d4d7e46d402be4b2e3200ca3e605ef3a0253ceb49a933138af03efe8899b7940`.
  The postpublication-cancellation case retains the actual revision-zero
  commit/path and old active owner; it never claims that durable creation was
  rolled back.
- Existing assembly/Library 29:
  `C:/Users/btspa/AppData/Local/Temp/realmforge-factory-legacy-p3qfm5bs/receipt.json`.
  SHA-256 `c788757dcea95da2db2f50ca5897f625a0880de3a8a4290db89de59b0a64313e`;
  1,268 unchanged bindings, 1,252 served routes. The five original injected-quota
  diagnostics retain the exact two repository/two persistence/one unmount
  classification; both additional Library suites have no browser errors.
- Python:
  `C:/Users/btspa/AppData/Local/Temp/virtual-realm-city-creation-python-final.xml`.
  SHA-256 `ab0567118f8e296a0547f65edc41c71c28a0941b021355a32ad3198309abe2d5`;
  19.675 seconds. Eight new creation checks plus one exact inverse-preservation
  check were added; existing behavioral assertions were not weakened.

The inverse-preservation check reconstructs the precreation document owner
byte-for-byte, then retains the earlier pre-panel reconstruction. It does not
repin a historical file to hide drift. Session, design format, compiler,
persistence/save owners, panel, controls, preview, host, Desktop and both source
captures retain their previous production hashes. Only Start view, factory and
the document owner's explicit source-city creation branch changed production
behavior in this slice.

#### Native creation and fresh-page visual proof

The real browser-input walkthrough creates both inventories through the new
Library form. Each first durable head is revision zero with fresh identity.
Apply changes width to 6,100 mm for baseline and 6,200 mm for kernel without
publishing. Save publishes those applied values at revision one while retaining
unapplied 6,900 mm form text. Reset clears only that unapplied text.

After genuine factory/native cleanup and closing the first browser target, a
different target at the same isolated origin restores the account and actual
LastOpen kernel asset without seeding a document. Public UI Open then restores
baseline. Both match the exact saved asset/resource/revision/hash/commit/source,
design and projection report. Both pages also complete a real storage-worker
digest matching WebCrypto, without fallback or pending work.

Final evidence directory:
`C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-creation-native-e00pwdsz/`.

- `receipt.json`: SHA-256
  `fc40e44fbb39fb5b79b559e868f46d68b36f1bced85d14c4434fc5d01c4fefa2`.
- `library-create-baseline.png`: SHA-256
  `48261c41b309f6a5892193616f6687337a399575737ec03778933afcd2a42d66`.
- `created-baseline-saved.png`: SHA-256
  `f4a3810c87816c41fdb65fcb465f89dbe504abcdc5f5ea33833bb92b7529ad75`.
- `created-kernel-saved.png`: SHA-256
  `8535736cca463ffc829d56b9441d6350c030239199c2759d26c0b65fce0c3db6`.
- `fresh-page-created-baseline.png`: SHA-256
  `e6cc3d4aaddcd09c71f57e84231be5a84cb548e021c3bbbfe9981cdbb19ab4d9`.

All 1,320 before/after/current bindings match. Both manifests hash to
`ca893fe5cc1ae9612da722e2e9601349526aa55e045db4f2befa77d1f1b6ca4a`;
1,299 served routes are recorded. Browser/native errors, denied requests and
cleanup failures are zero. Both cleanups remove the factory root/commands,
close the document lifecycle, zero owned surfaces/producers/receipts/buffers/
textures, and lock the isolated operator. This walkthrough adds no regression
case count and does not prove process-crash or cross-operator recovery.

All four 1400 x 1100 screenshots were visually checked: the creation form and
complete city canvas/metric controls are readable, without document horizontal
overflow. The earlier passing walkthrough at
`C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-creation-native-ydpexl4p/`
is retained. Its intermediate save screenshots were scrolled to the lower
inspector; the final driver scrolls the actual panel to the top and waits for a
new matching-size submitted frame before capture. Only QA framing changed,
not production behavior or regression assertions.

This slice grants no new source scan, capture, runtime provider, filesystem
discovery, Factory execution or network authority. Full Desktop boot,
live-world integration and dirty account-switch recovery remain separate gates.

## Actual Desktop window integration

The 2026-09-22 gate constructs the genuine normal-mode `Desktop` and launches
RealmForge through its existing `_launchPanel` class-app route. It uses the
actual DOMPanel, process registration, sandbox, guarded storage/GPU services,
process/operator-bound host and editor. It does not call `Desktop.mount()` or
discover all applications. This is window-component integration, not full OS
boot, onboarding, taskbar integration or live Virtual Realm activation.
(Sources: `webgpu-os/shell/Desktop.js`,
`tests/realmforge/RealmSourceCityDesktopFixture.js` and
`tests/realmforge/RealmSourceCityNativeAppHost.js`.)

### Fixed hidden close decision

The real launcher stores a panel wrapper containing `el` and `domPanel`.
The old titlebar listener compared that wrapper directly with the DOM element.
Its attempt to reshow the editor therefore never ran after DOMPanel hid it.
The existing Save/Discard/Cancel decision was created in a hidden window.

The production fix compares both `entry.panel.domPanel` with the originating
DOMPanel and `entry.panel.el` with that panel's element. It retains the existing
ready/mount/close checks, synchronous reshow, asynchronous close request and
error logging. No save owner, cleanup order or unrelated launch path changes.
An inverse-preservation test replaces this one predicate with the old text and
reconstructs the exact preceding Desktop SHA-256
`e450b83621870886d68ff90de716d56d9fadd2e9525ecfcf41c60b4ce45ddf8d`.
(Sources: `Desktop._createPanel` and
`tests/virtual-realm/test_source_city_desktop.py`.)

The unchanged-production diagnostic passed five cases and failed five genuine
dirty-close visibility assertions. The fixed production run passes **10/10**:

1. Genuine Desktop/class-app/DOMPanel ownership and initial city creation.
2. Clean titlebar close, actual retirement and kernel-city LastOpen relaunch.
3. Applied dirty design: visible Close decision and lossless Cancel.
4. Unapplied form: visible decision, Save disabled and lossless Cancel.
5. Save decision publishes applied changes before a separate window Close.
6. Discard preserves the previous durable head before a separate Close.
7. Minimize releases presentation resources; restore retains the document.
8. Repeated Close retains one current decision.
9. A destroyed old panel's button cannot close a replacement app process.
10. Ordinary assembly editing and Desktop close preserve their existing path.

Save or Discard resolves the city document decision and returns to the Asset
Library. Closing that window requires a separate titlebar request. Cancel
retains the same process, document and unsaved state. None of these actions
silently applies or publishes unapplied form text.
(Source: `tests/realmforge/source-city-desktop.test.js`.)

### Evidence and cleanup semantics

The native Desktop fixture issues no parallel app or substitute presentation
host. Desktop itself owns those objects. Observations bind only after validating
the genuine current host and GPU owner. Cleanup refuses to retire its services
while a live process or unresolved editor decision remains. Tests explicitly
resolve only their isolated, randomly named assets during test cleanup.

Desktop intentionally forgets its allocation ledger after final retirement.
The recorded buffer/texture counts are then **null**, not zero. Individual GPU
release evidence comes from the retained actual renderer cleanup receipt:
disposed, not abandoned, no release errors, nonempty released kinds and no
abandoned kinds. Surfaces, frame producers, capabilities and commands must also
drain. A still-live minimized owner retains measurable zero allocation counts.

The Desktop runner serves only 1,476 exact static modules and the reviewed
assets. Its 13 deferred import declarations do not admit their targets. The
existing reviewed startup cycle remains unchanged. The ten-case receipt has
zero browser errors, denied routes or source-binding changes. The focused
Python run passes **198 tests plus 7 subtests** across 13 literal files.

- Pre-fix reproduction:
  `C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-desktop-l97c_zib/receipt.json`.
- Fixed ten-case native gate:
  `C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-desktop-euxqg9zz/receipt.json`.
- Python:
  `C:/Users/btspa/AppData/Local/Temp/virtual-realm-city-desktop-python-final.xml`.

An earlier browser attempt failed before test startup because Chrome's temporary
DevTools port file was inaccessible. Its zero-case receipt remains retained at
`C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-desktop-xjret88x/receipt.json`;
it is not counted as a successful gate.

The first fixed ten-case run at `realmforge-source-city-desktop-plw5y_zq`
also passed. Its bound `EchoGuidePresence.js` later changed in unrelated work.
The final ten-case run was repeated against current sources; the earlier
receipt remains historical, not proof of the subsequently changed dependency.

### Native Desktop walkthrough

`tests/realmforge/run_source_city_desktop_native.py` uses trusted browser input
to create the baseline city from the actual Library, Apply a 6,100 mm building
width, click the actual titlebar Close, inspect the visible decision, Cancel,
manually Save, Minimize, Restore, close cleanly and relaunch. Apply and Cancel
preserve the revision-zero durable head. Save publishes revision one. Automatic
LastOpen in the new app process restores the exact saved asset/resource IDs,
revision, commit, content hash, source digest, design and projection report.

Restore and Relaunch use explicitly labelled QA buttons that enter the real
Desktop event/launcher. This fixture does not mount the taskbar; the walkthrough
does not claim taskbar interaction or a full shell boot. Close and Minimize
use the actual DOMPanel titlebar buttons. The app observations wait for the
completed original process entry rather than mistaking its provisional mount
handoff object for the ready RealmForge class.

Final passing evidence:
`C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-desktop-native-ue_pjim3/receipt.json`.
Its SHA-256 is
`3ed1f9f4f22819fbd08c9fae025e6401fa32aaf501bd2948b13f8e82fded2e26`.
All 1,512 before/after/current source bindings match, with 1,489 served routes.
Browser errors, native GPU errors, cleanup failures and denied routes are zero.
The actual storage worker's SHA-256 matches WebCrypto, without fallback or
pending tasks. Both retired app instances retain successful individual renderer
cleanup evidence. Final cleanup unmounts Desktop, removes its process/window,
drains commands/surfaces/producers/capabilities and locks the isolated operator.
Forgotten GPU ledger counts remain null, not invented zero measurements.

The three 1500 x 1200 screenshots were visually inspected:

- `desktop-created-baseline.png`: readable first-person city and initial
  5,400 mm design at revision zero.
- `desktop-visible-close-decision.png`: visible Save/Discard/Cancel and the
  applied 6,100 mm city before publication.
- `desktop-reopened-baseline.png`: the same saved 6,100 mm design at revision
  one in a different app process.

The native walkthrough adds no regression-case count. Earlier diagnostic
receipts remain retained: `realmforge-source-city-desktop-native-67e9jibk`
exposed the test's premature minimize-animation assertion; `l0rqp_b0` and
`pkdzkx0f` exposed its premature ready-app observations. Only the QA wait and
observer were corrected. `wwoe1hso` rejected a concurrent unrelated
`EchoGuidePresence.js` change before launching a browser. These are not passing
runs or production defects hidden by test changes.

### Final Desktop regression checkpoint

The final 2026-09-22 checkpoint passes **474 individual browser cases across
29 gates**, plus **198 Python tests and 7 subtests**. The separate native-input
walkthrough passes but contributes zero regression cases. No cases are skipped.
The original labelled negative diagnostics remain retained: three stale-hash
events in the existing city gates and five injected-quota events in the legacy
assembly gate. There are no unexpected browser errors or denied routes.

| Final gate set | Cases | Before/after/current bindings | Served routes |
| --- | --- | --- | --- |
| Existing city/editor, 22 gates | 392/392 | 939 match | 932 |
| Factory/host/creation, 3 gates | 43/43 | 1,323 match | 1,302 |
| Existing assembly/Library, 3 gates | 29/29 | 1,268 match | 1,252 |
| Actual Desktop window, 1 gate | 10/10 | 1,510 match | 1,487 |
| Native Desktop input walkthrough | 0 counted | 1,512 match | 1,489 |

Final receipt identities under `C:/Users/btspa/AppData/Local/Temp/`:

- `realmforge-source-city-modeler-03_m0thg/receipt.json`:
  `4cbc69729e80d0d2209c2bb70497743c24dd98fc1b59178e3c5979e77ae097ee`.
- `realmforge-source-city-factory-u7dgopl1/receipt.json`:
  `fdd9fdb12d4cffdf1fa20984cb1667cf96722328c05b4ea3f20212fee3129369`.
- `realmforge-factory-legacy-sslv1muj/receipt.json`:
  `ae6fa757835b15bd40e235dfde3d66f53e8fe9d6955228c266265252893c8274`.
- `realmforge-source-city-desktop-euxqg9zz/receipt.json`:
  `b2abb5924ac3c9d895dd1585f449b6d429e0d7a4b4ed30b815f7120d1004aa84`.
- `virtual-realm-city-desktop-python-final.xml`:
  `06aadef1342951f3ddedaa986f9965ceeb3ac3e844251d924ef0cb1c4465043b`.
  The 205 JUnit records contain zero failures, errors or skips; duration is
  24.516 seconds.

The single production edit is `Desktop._createPanel`'s identity predicate.
The factory, Start view, document owner and both captured source assets retain
their preceding hashes. Tests extend the existing native fixture only through
an explicit Desktop mode; previous default/factory behavior passes its original
gates. The shared visual transport adds only an optional preflight callback,
whose default remains the existing factory preflight. Scoped SPDX, whitespace,
conflict-marker, final-newline and documentation-link checks pass. Broad API,
documentation-discovery and full bundle generation were not run because they
would exceed the First Shard exclusion boundary. No release, commit, user-data
deletion or existing-preview reload occurred.

## Requested account-switch integration

Ordinary requests to switch between existing profiles now prepare the current
RealmForge window before revoking its account. The shared public `operator.switch`
and `profile.switch` path calls `Desktop.prepareOperatorSwitch`, then the existing
Vault preparation, then the unchanged `OperatorContext.switch`. The implementation
reuses the actual editor's close decision, document owner and storage. It adds no
automatic Save, Discard, new document owner or delayed emergency revocation.
(Sources: `webgpu-os/kernel/Syscalls.js`, `webgpu-os/shell/Desktop.js` and
`webgpu-os/shell/RealmForgeSourceCityOperatorTransition.js`.)

### Flat preparation sequence

1. Capture the genuine current account and synchronously fence new RealmForge
   launches, including when no RealmForge process exists.
2. Await any already-admitted mount of the exact original process. Require its
   ready class app; a replacement or failed mount cannot inherit preparation.
3. Restore a minimized window and use the existing graceful close. A dirty
   design or unapplied form opens the existing visible decision and refuses the
   switch without advancing the account generation.
4. Save or Discard resolves the document; the operator explicitly retries the
   switch. Cancel retains the same editor, document and form. Unapplied text
   remains unsaved and keeps the Save-and-leave decision disabled.
5. A clean close finishes original-authority app and renderer cleanup before
   the existing Vault recovery callbacks and account revocation run.
6. Release the launch fence on refusal or completion. If the account retires
   while a mount or close is pending, retire that preparation promptly; the
   existing switching/frozen checks take over launch admission.

An overlapping request during active-account preparation receives
`RF_OPERATOR_SWITCH_BUSY`. A dirty decision
receives `RF_OPERATOR_SWITCH_DECISION_REQUIRED`. Diagnostics use the existing
console channel with `[RealmForge][operator-switch]` preparation, closure,
refusal and release events; they contain no document contents or profile keys.

### Failure and authority limits

This preparation is not an atomic transaction across all applications. If a
later Vault recovery callback fails, the old account remains active but an
already cleanly closed RealmForge window stays closed. A separate launch can
reopen its saved LastOpen document. An unresolved Vault callback is not forcibly
cancelled; account retirement releases the RealmForge launch fence and the
old request fails its scope check if that callback eventually settles.

Raw lock/switch retain immediate revocation. Emergency termination and profile
create/import/delete/update retain their existing behavior; profile mutations
already await their own Vault preparation before locking. The focused raw-lock
test covers only retirement of a paused original mount's preparation fence;
it is not clean-shutdown or unsaved-document recovery evidence for emergency
lock. No stale document is revived under another account. The actual renderer's
retained cleanup receipt proves ordinary clean resource disposal; forgotten
allocation counters are still unavailable, not zero.

The original `desktop-shell` boot participant is extracted mechanically into
`webgpu-os/shell/desktop/DesktopOperatorParticipant.js`. Kernel bootstrap and the
opt-in native fixture reuse that same participant. The fixture composes genuine
ProfileDriver, OperatorContext, OperatorVaultService, storage, Desktop and native
GPU services before initializing the account. Account creation is test setup
with no app open, not coverage of changing profiles while documents are dirty.
KernelBootstrap is bound as source evidence only, not executed or graph-walked.

### Native requested-switch acceptance

The final requested-switch gate passes **14/14 cases**, with zero browser
errors, native GPU errors or denied routes. All fourteen cases retain an active
account and a released preparation fence. All fourteen isolated cleanup records
show an unmounted Desktop, no live process, and zero surfaces, frame producers
and presentation capabilities. Test setup and cleanup operate only on isolated
test profiles and randomly named assets, not the operator's existing workbench.

The cases cover semantic and form-dirty refusal, both public switch aliases,
Cancel, explicit Save followed by a separate retry, Discard, exact saved-design
reopening after A-to-B-to-A, cleanup before `operator:changing`, minimized-window
restoration, empty-process launch admission, clean preclose admission, overlapping
requests, a later Vault preparation failure, original pending-mount drainage,
decision coalescing, pending-mount retirement under raw lock and ordinary
assembly preservation. Some cases exercise more than one of these behaviors.

The A-to-B isolation case verifies B's genuinely issued storage cannot read A's
city manifest. A fresh B account intentionally opens its own durable Getting
Started assembly; it is not an empty editor. Its path, clean head, document kind,
distinct asset/content identity, Recent list and LastOpen are checked before
returning to A and reopening the exact saved city hash and 6,100 mm design.

The first diagnostic run passed thirteen cases and failed an incorrect test
expectation that B would have no active document. Its fourteen cleanup records
were clean and the storage-isolation assertion already passed. The correction
asserts the real first-launch workspace without changing production or weakening
isolation. The diagnostic remains at
`C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-operator-transition-n0pjafj4/receipt.json`
(SHA-256 `55fc5371634625ec1092bd64d15d748778f0f0a3eb61a74c90def75c0943c2a7`).

Final evidence:

- `C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-operator-transition-1m3wv7hp/receipt.json`,
  SHA-256 `cc4e252f27de7a1419d3df39ab71b01549329088341a6cc54fea8306de027255`.
- Exactly 1,482 static modules, 16 deferred declarations, 1,493 served routes
  and 1,520 matching before/after/current source bindings. Deferred imports do
  not grant route admission. The current shell's extra model-identity catalog
  dependency was reviewed as one inert, import-free module before admission.
- Seven new Python checks plus the preceding regressions pass: **205 tests and
  7 subtests**, zero failures/errors/skips. Exact inverse checks retain the
  historical Desktop, Syscalls and KernelBootstrap hashes, including the prior
  titlebar-fix inverse; none was repinned to hide unrelated changes.

The new production helper is SHA-256
`aae699176f21c438dc2dce7b27eef7ccf2f89046585f7a84cd85de8d82dde1b4`.
The existing RealmForge factory, Start view, active-document owner and both source
captures retain their preceding hashes. No new source capture, Factory execution
or live-world provider was introduced. Broad API/docs-discovery and bundle
generators remain excluded because they exceed the First Shard scan boundary.
(Sources: `tests/realmforge/source-city-operator-transition.test.js`,
`tests/realmforge/run_source_city_operator_transition.py` and
`tests/virtual-realm/test_source_city_operator_transition.py`.)

### Final requested-switch regression checkpoint

The 2026-09-22 final rerun passes **488 individual browser cases across 30 gates**:
the preceding 474 cases plus the new fourteen requested-switch cases. No case
is skipped. The existing three stale-transaction and five injected-quota error
events remain explicitly classified in their original negative tests; there
are no unexpected errors or denied routes. Root independently checked all
before/after/current source bindings for each accepted receipt.

| Gate set | Cases | Matching bindings | Served routes |
| --- | --- | --- | --- |
| Existing city/editor, 22 gates | 392/392 | 945 | 938 |
| Factory/host/creation, 3 gates | 43/43 | 1,326 | 1,305 |
| Existing assembly/Library, 3 gates | 29/29 | 1,269 | 1,253 |
| Actual Desktop window | 10/10 | 1,515 | 1,492 |
| Requested existing-profile switching | 14/14 | 1,520 | 1,493 |

Receipts under `C:/Users/btspa/AppData/Local/Temp/`:

- `realmforge-source-city-modeler-lf7kkzzj/receipt.json`:
  `b5984aac53338c6fb572e67f2abf14a1b7654e9daa37c960ed5d112329bb703e`.
- `realmforge-source-city-factory-k0qau3f6/receipt.json`:
  `6890db2209fbbd8c5d505aeff436ca48c7cf8a5fcc43b388e0c48f23d8f0f38b`.
- `realmforge-factory-legacy-2i3rwqfq/receipt.json`:
  `947b9f9c4c9c5bfc1ac036ac1c5417df95a0ad36ac3dacbc293acb15fb0b59cc`.
- `realmforge-source-city-desktop-0o7o9mah/receipt.json`:
  `542bd025ae617f818eecb14a6a3af3101ab9f1f2f60aa311bd6a6f953e1ca6fb`.
- `realmforge-source-city-operator-transition-1m3wv7hp/receipt.json`:
  `cc4e252f27de7a1419d3df39ab71b01549329088341a6cc54fea8306de027255`.
- `virtual-realm-city-operator-python.xml`:
  `65f1897f6e6e69325c69b6e1dc5c4e82fc0003eb3b22a7b9392e1a77901fe81d`.

Scoped source hygiene and curated-plan links pass. Global generated API/discovery
files were not regenerated. Concurrent documentation validation reported stale
references for the modified Desktop/helper; global generated-doc validation is
therefore not claimed clean. Regeneration needs a separately reviewed bounded
path that preserves the First Shard exclusion. No existing preview was reloaded,
no user asset was saved or deleted, and no commit or deployment occurred.

### Actual Start and taskbar city integration

The accepted slice reuses the existing Desktop fixture and production Taskbar,
StartMenu, AppRegistry, RealmForge factory and source-city panel. It introduces
no alternate city editor or renderer. The `taskbar: true` fixture option loads
only the literal RealmForge manifest through the registry's strict loader,
mounts the real taskbar before process registration, and lets the real Start
menu emit the existing Desktop launch event. Global app discovery is excluded.

The tray observes real native frame timestamps through GpuFrameCoordinator's
existing callback and Engine FrameMath. This is an explicitly labelled measured
fixture adapter, not evidence for KernelBootstrap's complete frame loop.
Unchanged fixture calls remain opted out. Cleanup unmounts the real taskbar,
checks removal of its Start menu and frame subscriber, drains the native city
owner, and unregisters only the exact fixture-owned manifest.

The production correction is confined to
`webgpu-os/shell/taskbar/appButtons.js`: a `ui:close-panel` request no longer
clears the active/minimized indicator prematurely. RealmForge may retain its
window for a Save/Discard/Cancel decision. Actual focus, minimize, restore,
tray and process-removal notifications remain authoritative. Resident-assistant
window hiding still uses its existing minimize/tray notifications.

The eight-case browser gate covers Start search and Enter, both captured city
inventories, actual taskbar minimize/restore, dirty titlebar and shell-request
Cancel, manual Save followed by exact saved-city Start relaunch, existing-window
reselection without duplication, and complete taskbar teardown. The separate
native-input runner uses genuine Start/search, Library, editor, titlebar and
taskbar controls; it contains no substitute restore/relaunch buttons.

Sources: `tests/realmforge/RealmSourceCityDesktopFixture.js`,
`tests/realmforge/source-city-taskbar.test.js`,
`tests/realmforge/run_source_city_taskbar.py`,
`tests/realmforge/run_source_city_taskbar_native.py` and
`tests/virtual-realm/test_source_city_taskbar.py`.

Independent byte-level review reconstructs the exact prechange taskbar module
by restoring only the removed Close-request listener and its unused helper.
Current SHA-256 is
`71b0a36e024d086b8f20bd6cd891a7dd95dba5689489ca82e128be073d125e56`;
the reconstructed original is
`72de4b42861ecf2f18b6d58ac894aaf7b4e5ee0c16f07c9c5cf42c46e3447df0`.

Concurrent construction and System One changes added twelve literal static
dependencies to the existing factory/Desktop closure. The shared test inventory
admits only those individually reviewed paths. Import admission does not invoke
AI assistance, construction submission, live providers or global app discovery.
The two production stylesheets served for this gate, `style.css` and
`BrandMark.css`, introduce no further URL/import dependencies.

Native input exposed a test-transport defect: the exact-route server labelled
all non-HTML responses as JavaScript, so the admitted CSS was not applied.
`tests/virtual-realm/run_protected_startup_browser.py` now sends `text/css`
for admitted `.css` routes. Route/query/fragment rejection still precedes body
access; no route or filesystem access was broadened. The browser gate and native
walkthrough now check computed taskbar/menu styles. The production stylesheets
were not changed to compensate for the test server.

The final **8/8** Taskbar browser cases pass with zero skips, browser errors or
denied requests and unchanged source bindings during the run. Receipt:
`C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-taskbar-y7nb9m3n/receipt.json`,
SHA-256 `1fa1b10d3975dfc9bfccd79697b9c93ded2b21de068eed1e634beb942598e8df`.
Focused Python verification passes **24/24** across Taskbar, Desktop and native
host checks. Receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-city-taskbar-focused-python.xml`,
SHA-256 `c7a71db736cc5e872bc13fa0257804bb42e25f95fe0cef7612e3347f1d64ed31`.

The existing Desktop **10/10** and requested-account-transition **14/14**
browser suites also pass again with unchanged source bindings during each run,
zero unexpected browser errors and no denied routes. Their receipts under
`C:/Users/btspa/AppData/Local/Temp/` are:

- `realmforge-source-city-desktop-dyp68uf0/receipt.json`, SHA-256
  `3dd58a5ed55a59c2a364549c8f4c5c9900da23f96c14eec620cbd9a0aff53be8`.
- `realmforge-source-city-operator-transition-ch05v10s/receipt.json`, SHA-256
  `5c7f58769e8fae4b63074e3cb5277feffc10ed7dcb95d1909ea73ec4a256e713`.

These are **32 individual browser cases** across three gates, not a rerun of
the earlier entire 488-case checkpoint. The eight-case receipt binds 1,532
sources and contains eight complete cleanup records. A later independent
rehash found four concurrent files had changed since that run:
`engine/sim/PhysicsRuntimeDescriptor.js`,
`webgpu-os/apps/realmforge/construction/RealmForgeBuildController.js`,
`webgpu-os/apps/realmforge/construction/RealmForgeBuildIntent.js` and
`webgpu-os/apps/realmforge/modeler/ui/RealmForgeProceduralBuildPanel.js`.
Taskbar-owned bindings remained current. The receipt certifies its exact served
snapshot, not a globally frozen working tree or all later construction edits.
The Desktop receipt similarly has one later `RealmForgeBuildIntent.js` change;
its 1,527 before/after bindings match. The later account-transition receipt's
1,532 bindings match before, after and the independent closeout rehash.

The final native-input walkthrough also passes with unchanged source bindings,
four inspected screenshots and no browser/native errors, cleanup errors or
denied routes. It uses actual Start search and pointer input to launch
RealmForge, create the 36-building city through Library, apply a 6,100 mm building
width, cancel a dirty titlebar Close, manually save revision 1, minimize and
restore from its process button, cleanly close, then use Start again to reopen
the exact saved head/design/digests in a new process. No synthetic editor control
substitutes for those interactions. The runner's observation code does not edit
the document. Receipt:
`C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-taskbar-native-d7qofh3h/receipt.json`,
SHA-256 `136a2f9d416113a4474c7760b0db1f7dc73cc97b09f457e7ec8207a475303d7d`.
The final `taskbar-reopened-baseline.png` in that directory has SHA-256
`8a1e430d22f808b95d705ac72bfb09f8743260cde9a25600538a7f4c5c14d001`.

The native receipt retains 15 actual renderer-resource releases, zero abandoned
resources or release errors, zero live processes/surfaces/frame producers/
capability receipts, a stopped frame coordinator, removed Start menu, and zero
frame subscribers or registry entries. Forgotten allocation telemetry remains
unavailable, not invented zero-allocation evidence. This isolated layout does
not certify normal shell geometry: the window's lower edge overlaps part of the
tray in the fixture, while the city and required controls remain readable.
Normal Desktop layout belongs to the next mounted-shell gate.

Earlier diagnostic receipts remain retained, not overwritten as successes.
`realmforge-source-city-taskbar-xhg16ajy` passed the eight behaviors but detected
concurrent source changes; `realmforge-source-city-taskbar-native-zjdqkm0_`
passed the complete interaction sequence but detected `ModelerSession.js`
changing during its run. The final receipts replace those acceptance attempts,
not their diagnostic history.

The wider Python checkpoint reports **205 passed, 8 failed and 7 subtests
passed** across fifteen named files. The eight failures are retained, not skipped
or repinned: historical whole-file/inverse checks for ActiveDocument,
ModelerSession, Syscalls and KernelBootstrap, plus two creation checks tied to
the former direct-call spelling. Independent review confirms source-city
creation still performs its seven current-owner checks through the generalized
helper; this does not certify every concurrent construction change. The new
eight Taskbar Python checks pass. Receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-city-taskbar-python.xml`,
SHA-256 `e521b043cfcdb9285f30ea6914cd04aae772285497d1c6c06a48fd26982c36d7`.
The preceding 488-case and 205-test all-green totals remain historical results,
not a claim that the concurrently changed workspace is still byte-identical.

### Remaining integration boundary

At the preceding component checkpoint, Desktop startup and onboarding still
needed their own evidence. The accepted Start/taskbar component gate does not
certify the boot-time composition of those
components, global app discovery or KernelBootstrap's complete frame loop.
Dirty profile creation/import/deletion/update and complete emergency recovery
also remain separate work; the requested-switch result does not certify them.
Continue from the existing first-person city editor and Library creation route;
do not replace them with another standalone city workbench. The two captured
inventories remain frozen. First Shard, new discovery/capture, M1C/B4H provider
activation, Factory execution and connected-city networking remain excluded.

### Next bounded slice: mounted Desktop to the existing city

The next visible milestone is the current city editor after genuine normal-mode
`Desktop.mount()`. It is not another standalone workbench and does not require
activating the unfinished live Realm runtime. The implementation sequence is:

1. **Modify the native host composition.** Extend
   `tests/realmforge/RealmSourceCityNativeAppHost.js` with genuine PermissionPortal
   and SetupStateService integration using the existing storage, permissions,
   GPU and operator. Do not invent setup-complete state or replace real services
   with success-returning adapters.
2. **Add an opt-in mounted-shell fixture mode.** In
   `tests/realmforge/RealmSourceCityDesktopFixture.js`, let the unchanged actual
   `Desktop.mount()` own Plauna, Taskbar, dialogs, shortcuts, shell GPU preparation
   and teardown. Preserve all accepted fixture defaults and existing tests.
3. **Admit only exact startup dependencies.** Reuse the current reviewed-route
   runner. Review the genuine deferred Plauna entry plus Setup Center's literal
   manifest and factory route before serving them. Do not enable global app or
   mod discovery, broad import barrels, unrelated providers or First Shard.
4. **Verify genuine onboarding.** Use the real published operator generation,
   SetupStateService and `SetupOnboardingCoordinator`. Cover presentation,
   interruption/resumption and missing canonical-surface refusal. Existing
   controlled Setup Center tests supply assertions, not native startup proof.
5. **Repeat the accepted native city journey after mount.** Verify shell readiness
   and geometry, then Start, Library Create, visible first-person city, Apply,
   dirty Close/Cancel, Save and exact saved-city relaunch. Require real GPU-owner
   cleanup and preserve the two frozen source captures.
6. **Record the precise remaining boot boundary.** The complete `bootWebGpuOS`
   path still calls app and mod discovery unconditionally. Do not run it unchanged
   under this task's exclusions. A future closed-catalog boot contract or broader
   discovery scope needs a separate decision; it is not necessary for this
   mounted-Desktop milestone. The fixture frame adapter is not KernelBootstrap
   frame-loop evidence.

Sources: `webgpu-os/shell/Desktop.js` (`mount`, `_initPlauna`,
`_resolveSetupCenterSurface`), `webgpu-os/kernel/KernelBootstrap.js`
(`SetupStateService`, `mountPermissionPortal`),
`webgpu-os/kernel/setup/SetupOnboardingCoordinator.js` and
`webgpu-os/index.js` (`bootWebGpuOS`). No step in this next slice has been claimed
implemented or accepted by the Taskbar receipts.

### Mounted-shell implementation and verification checkpoint

The implementation and test code for the six-piece slice above are present in
the existing native host and Desktop fixture; final acceptance is recorded
separately below. `shellMount` and `mountedShell` are explicit opt-ins; accepted
constructor-only, taskbar and operator-transition fixture defaults remain.
The real SetupStateService participant is registered before operator activation,
and the operator activates before Desktop construction, matching the production
ordering. Genuine `Desktop.mount()` owns Plauna, both shell GPU preparations,
Taskbar, dialogs and shortcuts, and requests the kernel-owned PermissionPortal.
The native host retires that portal after Desktop teardown. Readiness requires
Plauna initialization and both GPU preparations to report ready, not merely a
resolved mount promise. Tests use the production shell/desktop/taskbar layout.

Only literal RealmForge and Setup Center manifests enter the isolated AppRegistry.
Setup Center's real legacy-panel part is validated in the real Registry; this is
a **registry-only Factory composition**, not `createFactory()` or Factory boot.
The genuine manifest is also registered with Permissions, as normal kernel
registry wiring does. No runtime grants or non-enforcing policy are used.
Five reviewed deferred entry bindings, including Plauna, and their individually
listed static dependencies are admitted; unrelated lazy tooling, transport activation,
global discovery and KernelBootstrap execution remain excluded.

Three production corrections were required:

- `Desktop.unmount()` releases and clears its existing Echo preference
  subscription. A later preference event must not mutate the retired Desktop or
  create an orphan Echo guide. The existing inverse-preservation test retains
  its historical Desktop hash by reversing the two added lines and the exact
  focus correction below, without repinning or normalizing the file.
- `SetupCenterApp._complete()` uses the existing `ui.closePanel()` request after
  successful setup completion. Its previous `ipc.emit('ui:close-panel', ...)`
  was namespaced by the IPC service and did not reach Desktop's close listener.
  The one-line correction does not bypass Desktop's ordinary close handling;
  an independent inverse check reconstructs prechange SHA-256
  `5476a2b0414d14a6bda5393e563bee1651f670161e43d7062e7bbf35e7836217`.
- Actual panel `mousedown` routes through the existing `_focusPanel()` only when
  ProcessTable still owns that exact DOMPanel. Previously it merely changed
  z-index, so real mounted windows could remain inactive in the taskbar after
  interaction. The constructor fixture's different listener order masked this.
  The shared focus path updates window focus and publishes the existing event;
  there is no recursive DOMPanel focus subscription or forced test CSS. Browser
  coverage includes active indication and a retired panel's inability to focus
  its replacement. Trusted pointer input supplies independent behavior proof.

The six-case browser gate is
`tests/realmforge/run_source_city_mounted_shell.py`. It covers missing canonical
surface refusal, real onboarding and styles, review persistence across Setup
Close/Start reopening, visible city Apply/Cancel/Save/relaunch, required review
completion and full teardown. An untouched or fully committed draft is correctly
discarded on last-client close; committed review state survives in a new draft.
Tests do not invent interrupted dirty-draft retention. Cleanup retains the
original Plauna object to verify destruction, not just reference removal.

`tests/realmforge/run_source_city_mounted_shell_native.py` reuses the accepted
trusted pointer/keyboard city journey. It adds actual Setup navigation, six
review checkboxes and Finish before Start/Library/city creation. Shared helpers
remain backwards-compatible. Mounted minimize checks the actual measured
pre-city shell counters, while final cleanup still requires zero retained
owners and a genuine renderer release receipt. The native helper files are
included in source bindings, including the executed screenshot/error helper.

Diagnostic history is retained under `C:/Users/btspa/AppData/Local/Temp/`:

- `realmforge-source-city-mounted-shell-0ei6n0sn/receipt.json`: missing Setup
  manifest-to-permissions registration in the new fixture. Policy correctly
  rejected `setup.read`; the city Save/relaunch case passed. Registration was
  corrected without bypassing enforcement.
- `realmforge-source-city-mounted-shell-iqgfs7fh/receipt.json`: **5/6** passed.
  The failing Finish/close case reproduced the production IPC routing defect.
  This is pre-fix evidence, not full mounted-shell acceptance.
- `realmforge-source-city-mounted-shell-3pwi3lwb/receipt.json`: no behavioral
  acceptance. Concurrent Explore imports changed during snapshot construction;
  the exact server rejected the unreviewed panel and thumbnail routes. The
  new panel also referenced a controller not yet present on disk. The generation
  task was notified; its files are preserved and are not replaced with stubs.
- `realmforge-source-city-mounted-shell-7pk_gj2t/receipt.json`: **4/6** passed,
  including the corrected Setup Finish/close. Both city-launch cases failed
  during a concurrent Explore integration snapshot; bindings changed during the
  run, so this is not a final acceptance receipt.
- `realmforge-source-city-mounted-shell-native-sm9r0uiw/receipt.json`: actual
  pointer input completed all six Setup reviews and Finish, recorded completion
  and closed the Setup process. Shell bounds meet at 1,132 px in the 1,500 by
  1,200 capture, without the prior tray overlap. Subsequent RealmForge launch
  visibly failed with `profile.read: no-matching-rule`. The new Explore scope
  callback queried guarded operator state without the manifest capability.
  This precise error and screenshot were sent to the owning generation task;
  no city-test permission grant or policy bypass was added. Native cleanup had
  no errors, but changed source bindings and failed city launch prevent acceptance.
- `realmforge-source-city-mounted-shell-ryf75hdc/receipt.json`: **6/6** behaviors
  pass, with six complete cleanup records, zero browser errors and no denied
  routes. ExploreController and RealmForgeBuildController changed during the
  run, so `allPassed` remains false. Receipt SHA-256:
  `be853ab4fe7f0009ed963afe8ce841f1464aec7dd4a7782cf7f37f925d734ebe`.
- `realmforge-source-city-mounted-shell-native-ix2hi300/receipt.json`: aborted
  before browser startup because ExplorePanel changed between preload and source
  binding. Receipt SHA-256:
  `d3cbe8db6f78a771c7fcb62fe612dbf83bc2054be3b5e96fadf54e4e1d4ee2e5`.
- `realmforge-source-city-mounted-shell-native-agwhsl_q/receipt.json`: genuine
  Setup completion, city creation, 6,100 mm Apply, dirty Close/Cancel and Save
  revision one passed. The taskbar active-indicator assertion then failed before
  minimize; this exposed the production focus wiring defect above. No browser
  or cleanup errors occurred. Source drift also prevents acceptance.
- `realmforge-source-city-mounted-shell-4xqdbm9q/receipt.json`: **6/6** behaviors
  passed after the focus correction, including retired-panel fencing. The bound
  Python test file changed while its new inverse assertion was finalized, so
  this is another diagnostic, not stable-source acceptance.
- `realmforge-source-city-mounted-shell-vctdjgn7/receipt.json`: the browser
  launcher encountered a Windows sharing/permission error reading the fresh
  profile's `DevToolsActivePort`, before any browser case. The original receipt
  is retained; retry uses another isolated profile, not the user's browser.
- `realmforge-source-city-mounted-shell-0ys7jjj2/receipt.json`: **6/6** behaviors
  passed, but `engine/core/gpu/GpuDevice.js` changed concurrently during this run.
  No change to that engine file belongs to this city slice; acceptance remains
  tied to independently stable snapshots.
- `realmforge-source-city-operator-transition-rgoaedt5/receipt.json`: **14/14**
  behaviors passed without browser errors or denied routes, but the separate
  voice task changed `webgpu-os/shared/NaviVoiceControls.js` during execution.
  Served bindings match the captured source; before/after bindings do not, so
  this remains diagnostic. SHA-256:
  `12bb7d2e1b545c212c5a1b2fbce333f4784b7c35d3ccb6833571865c6f9ddac4`.
- `realmforge-source-city-operator-transition-93gj61dh/receipt.json`: the single
  bounded retry again passed **14/14** behaviors with zero browser errors or
  denied routes. Voice sources stayed stable; concurrent furnishing work changed
  `RealmForgeBuildIntent.js` instead. Source stability is rejected, not waived.
  SHA-256 `e7de7c2d0e495bcf73143200a926fc8469cb37d22d580d3ccbaf9beedf5c0d73`.
  Further reruns stopped; this task does not hold up unrelated workspace work.

The generation task corrected its scope callback to use the existing
`sandbox.info()` authority; no extra profile capability was added. The final
stable-source checkpoint below required no additional permission grant, preview
workbench or provider activation.

The focused Python run passed **35/35** before the additional inverse/native
and focus checks. The final five-file run retained **44 passed, 2 failed**: the already-known
historical whole-file Syscalls and KernelBootstrap pins differ because of
concurrent work. They remain unchanged, visible failures. The two newly added
Setup inverse/native-binding checks and owned-panel focus check are included in
that final count. Receipt: `virtual-realm-city-mounted-shell-focus-python.xml`
under the temporary evidence directory, SHA-256
`a1eee3cf7a650011dca36d86d8d2987516547e91760d8303a43c88a092e57497`.
These counts must not be combined into a claim that the entire workspace is
green. Browser/native acceptance is recorded separately below. The six new
Explore/thumbnail static paths have now been individually reviewed and admitted;
the mounted gate has 1,542 exact modules and five deferred root bindings.
Fresh startup leaves Explore generation inactive behind the hidden Build dock;
source-city documents bypass the ordinary ModelerPanel. Import admission is not
certification of the parallel Explore feature.

### Mounted-shell acceptance

The final six-case gate passed **6/6**, with 1,586 unchanged before/after source
bindings, exact served bindings, six complete cleanup records, no failed,
skipped or blocked cases, zero browser errors and no denied requests:
`realmforge-source-city-mounted-shell-jq9oxc2h/receipt.json`, SHA-256
`f5f4bfff8561e19b9e98fd2534c3791b7ae3e5dfe93790e667df3b6f1f0d208a`.

Legacy regressions also pass on their own stable snapshots, with exact served
bindings, no skipped/blocked cases, browser errors or denied requests:

- Taskbar **8/8**, 1,538 bindings:
  `realmforge-source-city-taskbar-88nllz3f/receipt.json`, SHA-256
  `e67bb15b97c2d06c97ee243c3a90720c45087242053ed5028d852a382415cb77`.
- Desktop window **10/10**, 1,533 bindings:
  `realmforge-source-city-desktop-vbs4bj2s/receipt.json`, SHA-256
  `6fa8f3cbfc2ca8189a2818a81fa634165d1a2e3b39734d011ae05d6f8beaea20`.

The post-fix trusted-input journey passed with **1,591 unchanged before/after
source bindings**, zero browser errors, denied routes or cleanup failures:
`realmforge-source-city-mounted-shell-native-h9jcsyw9/receipt.json`, SHA-256
`f363a8dff2044c5f6e5f51e1a95c11639fd0343a5637f1e81591bee6ec21ee6d`.
It completed genuine Setup reviews and Finish, then Start, Library Create,
36-building first-person city presentation, 6,100 mm Apply, dirty Close/Cancel,
Save revision one, taskbar minimize/restore, titlebar Close and Start relaunch.
The reopened asset retains exact IDs, saved head, design, source digest and
content/report hashes in a new process. Six screenshots were visually inspected;
the actual production layout separates the window and taskbar without overlap.

Native teardown reports 15 actual renderer-resource releases, no abandonment or
release errors, zero processes/surfaces/frame producers/capability receipts,
stopped frames, removed Start menu, zero registered apps/frame subscribers,
cleared Plauna ownership and the permission portal disconnected with zero
prompts. Browser case 6 separately retains the original Plauna object and
verifies its destruction; clearing the native reference alone cannot prove it.
Forgotten allocation telemetry is unavailable, not evidence of zero allocations.
This is real mounted Desktop integration, not KernelBootstrap/full OS boot or
live Virtual Realm/NPC activation. A subsequent unrelated ExploreQuery correction
is not certified by this earlier snapshot; final regression receipts retain
their own exact bindings rather than silently relabelling that snapshot current.

Reopened-city screenshot: `realmforge-source-city-mounted-shell-native-h9jcsyw9/`
`taskbar-reopened-baseline.png`, SHA-256
`8f851a2ae4223d3b68e6183872d2dac6935679c0c330ef2436b3cb1dfc778fba`.

The final native replay also passes after the concurrent Query/GPU/voice edits:
`realmforge-source-city-mounted-shell-native-w0c5_j7u/receipt.json`, SHA-256
`229528f9b1f32059b326e070844dd6b315bc27634daecc17f2b4539c6714987f`.
All 1,591 before/after bindings match and independently match current files at
closeout inspection. The same complete interaction sequence, exact saved-city
identity, zero errors and teardown obligations pass. All six final screenshots
were inspected. Final reopened image SHA-256:
`6a08a6d33a523586d84adea1ceba640f0ca926b4baee35b1b922ee8eebd1ada4`.

Closeout: **24 browser cases accepted on stable individual snapshots**, plus the
complete native journey. The additional **14 operator-switch behaviors pass**,
but their source-stability gate is not accepted on this concurrently changing
workspace. These receipts are not one frozen latest-source acceptance set.
The focused Python status remains 44 passed and two visible historical-pin
failures. No full OS boot, live world/NPC activation, global docs regeneration
or workspace-wide clean build is claimed. The next live-city dependency is an
admitted world/actor host using the shared NPC interfaces below; the source-city
editor remains available without that runtime capability.

## Parallel NPC integration: shared logic and a future admitted actor host

The user linked the active **Plan NPC AI upgrade integration** task
(`codex://threads/01a0cb39-1a57-74d0-bb75-d0f425eef5d9`) on 2026-09-22.
Its approved first live target is two independent Virtual Realm program
inhabitants. The task has recorded its shared intelligence foundation and opt-in
adapters as implemented, including `ActorTaskRuntime`, `ActorGroundNavigation`,
`EffectLedger`, language/testimony evidence, SDK checkpoint storage and
`RealmProgramActorRuntime`. These are owner-reported foundation results, not a
claim of live city admission. Shared-core, source-baseline, language/evidence and
navigation-adapter work belongs to that task. This city task continues the existing RealmForge
presentation and host-integration sequence. Neither task should duplicate the
other's scheduler, definitions, persistence owner or simulation state.

| Owner | Responsibility and boundary |
| --- | --- |
| Shared engine NPC layer | Resumable bounded tasks, individual memory, registered methods and adapters to existing navigation/action primitives. It proposes work; it does not create Virtual Realm authority. |
| Virtual Realm host | Admitted actor identities and bodies, simulation time, traversable/collision geometry, permissions, authoritative effects, lifecycle and persistence. This remains a future host capability, not the inspection camera. |
| RealmForge/source-city editor | Source-bound design, approved captures, appearance editing and manual Save/Open. Presenting a building or import road does not grant filesystem access, execution or network travel. |
| Echo, OCR, Particle Voice and System One | Attributed communication, source-preserving observations, pronunciation and optional choice proposals through existing consent and budget boundaries. Local rules must work without models. |

The NPC task reports the current `RealmEngineAdapter` still refuses live
collision/navigation creation. Its reference simulations or adapter tests cannot
be reported as two live city inhabitants. The current first-person camera and
Echo's primary manifestation are not substitutes for two separate actor bodies.
Mounted-Desktop tests explicitly disable Echo's optional visual presence through
the real preference API on an isolated origin; they exercise no NPC authority.

The actor-host integration must retain these acceptance obligations:

1. Publish an explicit versioned host capability only after actor, navigation,
   collision and simulation prerequisites are admitted. Resolve the NPC task's
   final interfaces before implementation; do not invent a second service API.
   M1C/B4H and runtime/provider gates remain independent requirements.
2. Bind each actor, route, body pose, observation and pending effect to the live
   world/document/operator generation and relevant geometry/source revisions.
   Host time and seeded decisions, not rendering frame rate, own simulation.
3. Use measured collision-resolved poses for arrival. Missing, blocked or stale
   navigation/perception returns unavailable or a bounded failure, never an
   invented successful walk. Separate task acceptance, motion and goal completion.
4. Let actor A reach an identified public information surface, acquire permitted
   source-attributed content, and report to actor B. B retains testimony and its
   source, not a fabricated firsthand observation. Repeated reports are not
   independent corroboration; private observations and inventories stay private.
5. Retain stable effect identities, expected revisions and accepted receipts.
   Reconcile unknown outcomes before retrying. Pause, replacement, account change
   and disposal stop new motion/work and reject late results without undoing
   already committed effects or losing unresolved receipts.
6. Verify both inhabitants offline, independently, through the real host and
   visible bodies. Construction continues through RealmForge's validated build
   pipeline; no agent bypasses review, permission checks or source disclosure.

This is a recorded integration dependency, not a claim that NPCs or live
navigation are enabled. The two captured source inventories remain frozen;
First Shard and the existing port9018 preview remain untouched. The complete
mounted-shell and actor-host acceptance receipts must remain separately named.

## Ground geometry and clearance-grid prerequisite: accepted 2026-09-23

The source city now has one reusable ground/building projection and a separate
CPU-only clearance-grid compiler. This completes a bounded prerequisite for
the future actor host, not the M2E traversal gate or live NPC admission.

### Flat implementation pieces

1. **Shared geometry:** `RealmSourceCityGroundGeometry.js` under
   `webgpu-os/apps/realmforge/virtual-realm/` detaches and freezes the current
   workbench bounds and source-file solid boxes. Each obstacle retains its
   building object ID, captured path and captured SHA-256. It rejects invalid
   geometry and duplicate identities. Source metadata is not fetched anew.
2. **Existing camera reuse:** `RealmSourceCityNavigation.js` now consumes that
   projection and its explicit inspection clearance profile: 0.35 m half-width,
   1.7 m height and 0.002 m skin. Its four-method API, entrance, movement speed,
   turn/look limits, axis-separated sweeps, wall sliding and reset remain intact.
   An inverse source test reconstructs the exact pre-extraction implementation.
3. **Grid compilation:** `RealmSourceCityGroundNavigation.js` exports
   `compileRealmSourceCityGroundNavigation(compiled, options)`. It reuses Engine
   `createNavGrid`, `setCellWalkable` and `sceneQueryAabbOverlapReport`. The scene
   metadata, report and clearance are detached before asynchronous hashing.
   Computed report and scene-metadata hashes must match the report, and its
   source digest must match the scene. Different designs of one captured source
   therefore have different bindings. Compiler scene/report/upload generation
   and both source captures remain unchanged.
4. **Conservative occupancy:** A cell is walkable only when its entire footprint,
   expanded by the explicit body's half-width and skin, fits inside the ground
   X/Z extent and does not touch any source-file solid. The vertical interval is
   ground zero to body height. Edge and final partial cells remain blocked when
   not fully supported. The mask is a frozen plain array compatible with the
   existing Engine grid consumers, not a mutable typed-array escape.
5. **Evidence and integration:** The returned data binds the source snapshot,
   exact scene metadata and build report. Its own digest also includes geometry,
   clearance, cell size, occupancy and counts. Existing Engine Pathfinder tests
   use cardinal paths, explicitly reject blocked starts, and sweep every route
   segment against the real solid boxes. Existing workbench and downstream app
   runners admit only the shared geometry import; they do not activate the grid
   compiler or an NPC service automatically.
6. **Ownership remains separate:** No actor, body, timer, effect receipt,
   permission, runtime lease or provider registration is created. The shared
   `ActorGroundNavigation` remains the future route/arrival owner. The new
   artifact is not an alternate scheduler or movement implementation.

The compiler accepts a cell size greater than 0.01 m and at most 16 m, defaults
to 1 m and rejects more than 65,536 cells before grid allocation. Its explicit
clearance profile requires a positive half-width up to 10 m, positive height up
to 100 m, and skin from zero to 1 m. These are bounded artifact inputs, not a
universal NPC body specification. The default describes the existing camera.
The current recipe's aggregate X/Z bounds match its authored ground slab; this
policy does not infer floors in arbitrary scenes. All file boxes are grounded
solids. Decorative import roads, trim and parcel lines are not collision bodies,
doors, platforms or travel permissions.

Example using an already compiled, matching source-city recipe result:

```javascript
import { compileRealmSourceCityGroundNavigation } from
  './RealmSourceCityGroundNavigation.js';

const ground = await compileRealmSourceCityGroundNavigation(compiled, {
  cellSizeMetres: 1,
  clearance: { halfWidthMetres: 0.35, heightMetres: 1.7, skinMetres: 0.002 },
});
// ground.grid is geometry evidence, not a live actor/world capability.
```

`runtimeActivation` and `accessPolicyApplied` are both false. These diagnostic
content hashes are not signatures or authentication. This compiler verifies
scene/report consistency, not uploaded GPU bytes or admission of a re-authored
input. Explicit synthetic geometry in two corner-case tests is labelled as such.
Actual collision-resolved bodies, current world/operator revisions and access
filtering must still be supplied by the admitted host. Do not attach this mask
directly to a live actor and call those obligations satisfied.

### Verification evidence

The isolated CPU browser runner
`tests/virtual-realm/run_source_city_ground_navigation.py` passed **95/95**:

- Ground geometry/clearance: 24/24, including both frozen captures, all sixteen
  authored design extrema, independent content digest recomputation, stale and
  mismatched reports, mutation across awaits, grid/profile limits, complete-cell
  clearance, edge/corner fixtures and real Engine cardinal routes.
- Existing scene: 21/21; walking: 18/18; recipe: 16/16; design: 16/16.

Receipt: `C:/Users/btspa/AppData/Local/Temp/`
`virtual-realm-source-city-ground-navigation-u90ka4cw/receipt.json`, SHA-256
`b118f0c3ebf6683dc854c9a438d12acc3422c94af75bee5891e314e9ccfdb759`.
The exact closure contains 60 CPU modules, zero cycles/skips, 67 served routes,
and 112 unchanged before/after source bindings. Root independently compared all
112 hashes with current files at closeout. Zero browser errors and denied
requests. This is not GPU, full Desktop, full workspace or live actor evidence.

Focused Python verification passed **67/67**: eight new literal-source checks
and all 59 existing workbench checks. An initial inverse-camera check mistakenly
converted the original LF file to CRLF; correcting the test's newline handling
reconstructs the originally captured hash without repinning it. No production
fix was needed after browser verification. Prior unrelated historical-pin
failures documented in mounted-shell evidence have not been erased or retested
as part of this CPU slice.

First Shard and the existing port9018 preview remained untouched. No new capture,
global discovery, full app boot, global documentation/API regeneration, GPU
service, networking, NPC activation, deployment or commit ran in this slice.

### Next dependency, without duplicating the NPC task

1. Supply an independently owned, real collision-resolved body lease for each
   inhabitant, with synchronous measured `readPose`, `setIntent`, `step` and
   `stop` semantics expected by `ActorGroundNavigation`. Reuse the existing body
   wrapper and simulation owner; the camera and a pathfinding result are not
   bodies. Geometry/profile changes must retire stale routes.
2. Complete the versioned live world/actor host and its existing seven ports:
   self, perception, memory, meaning, navigation, actions and communication.
   Current owner checks, permissions, simulation ticks and durable authoritative
   effect receipts are required. Private checkpoint memory is not an atomic
   world-effect store. M1C/B4H and `RealmEngineAdapter` admission remain open;
   this geometry slice does not modify their denials or frozen contracts.
3. Connect the shared actor runtime to two visible independent inhabitants and
   verify the planned measured A-to-public-surface-to-B exchange. The simulation
   owner advances bodies while task receipts are pending; do not await an entire
   journey inside the shared task step and thereby stall the second actor.

New runtime authority requires its own explicit scoped admission decision.
Continue reusing the user-linked NPC task's interfaces and leave its shared
intelligence, SDK and runtime modules under that task's ownership.

## Next visible slice: local body simulation decision, 2026-09-23

**Status: approved by the user's “do it continue”; the bounded local-body slice
is implemented and verified.** The preceding planning turn made no production activation or
body implementation. The approved scope is one
opt-in local source-city simulation mode with two visible grounded kinematic
bodies. It uses the existing city, rather than creating another test-only city.
These first moving inhabitants demonstrate genuine collision-resolved body
poses and independent navigation, not autonomous NPC task execution, durable
world effects, or the completed live Virtual Realm.

**Recommended backend:** local CPU kinematic simulation using the existing
Engine swept-AABB primitive. Its authoritative state is the resolved simulated
body pose, not a requested target or a claimed native PhysX readback. Native
PhysX body allocation and post-step measurement are a different, larger scope
and are not implied by this approval request.

### Why this requires a distinct owner

`RealmSourceCityPreview` currently owns a first-person picture and inspection
controls. Its RAF updates the camera, not a simulation world. Its document data
and recipe reports explicitly remain inert. `RealmProgramActorRuntime` consumes
an admitted host but does not create bodies, collision geometry, simulation
ticks or authoritative effect storage. Adding capability names to a record
cannot provide those missing services.

The existing `createNaviLocomotionBodyRuntime` in
`webgpu-os/kernel/navi/NaviLocomotionBodyRuntime.js` is reusable around an actual
body. It does not allocate that body. The current construction provider in
`RealmForgeConstructionPresetPhysics.js` allocates native sphere bodies for
hovering Navi, proposes kinematic targets, and updates measured poses after its
world step. `RealmForgeNaviBodyHost` advertises hover only. It is not a grounded
source-city body provider, and the proposed mode must not rename its capability
or report a pending target as a measured arrival.

### Six approved flat build pieces

1. **Explicit local owner:** Add a versioned, opt-in local simulation owner under
   the existing source-city integration. Bind it to the process/operator,
   document store and exact head, scene/report and ground artifact/profile.
   Give it exactly two distinct transient body identities. It grants only local
   simulated movement and readback, never file access, network travel, task
   execution, document edits or a live Realm host capability.
2. **Real bounded body state:** Own two grounded kinematic box bodies against
   actual ground, file-building solids and each other. Reuse Engine overlap and
   swept-AABB primitives and extract shared sweep/clamp logic if needed instead
   of copying the camera solver. This is a deliberately limited flat-ground
   kinematic simulation, not PhysX capsule, slope, stair or rigid-body dynamics.
   Validate separated supported spawns; never teleport through blocked space.
3. **Shared motion and navigation:** Wrap the actual body owner through existing
   locomotion/navigation interfaces where their synchronous step/readback
   contracts are satisfied. Reuse `ActorGroundNavigation` and Engine Pathfinder,
   with bounded named local destinations and correct body clearance. No second
   planner or AI scheduler. Stable fixed simulation steps, not variable render
   deltas, own motion; pause discards accumulated catch-up time.
4. **Visible body projection:** Extend the existing city view with an explicit
   transient two-body rendering path sourced only from measured body poses.
   Preserve all captured buildings, static compiler bytes, source IDs and
   selection behavior. Reuse the existing GPU presentation owner and draw
   primitives; do not start a second device, global frame loop or fabricated
   source-file building. Retain first-person inspection as the browsing mode.
5. **Operator control and retirement:** Add explicit local simulation Start/Stop
   controls, off by default. Pause/stop both bodies synchronously on document or
   geometry replacement, process/operator retirement, preview suspension,
   visibility loss or close, before awaiting GPU/resource cleanup. Any exact
   document-head change, including persistence-only revision rebinding, stops
   this first version and requires a fresh start. No body-pose autosave.
6. **Acceptance:** Verify two independently measured visible bodies, bounded
   speed, building/edge/body-body nonpenetration, blocked routes, reached versus
   commanded destinations, and stop-before-release. Verify stale/late work,
   failed cleanup preventing replacement, fixed-step timing and unchanged
   authoring/Save/Open/inspection behavior. Retain actual native rendering
   evidence; CPU route success alone is not visible-body acceptance.

The implementation must use the smallest existing Engine interfaces satisfying
these semantics. Do not adapt a hover-only or delayed-readback body by lying
about supported modes or arrival. No vendor physics edits are authorized by
this proposal. The proposed local owner is new, so its concrete exported names
must be defined and tested at implementation rather than documented as existing.

### Exact lifecycle trap to cover

`RealmSourceCityPreview._sync()` intentionally retains the old picture while
Session source-city projection adoption catches up with the document snapshot.
`_isCurrent(active)` alone does not prove that current snapshot/revision/hash
correspondence. Existing input controls additionally require `_currentCity()`.
A future body tick must check the exact head and owner before every mutation,
not mistake a still-visible renderer for a current simulation authorization.

`ModelerSession` deliberately rebinds a persistence revision-collision boundary
without changing the compiled scene. Renderer reuse is correct there, but does
not automatically renew a body lease. This proposal chooses stop-and-restart
for that boundary to avoid implicit ownership migration in the first version.

### What approval does not enable

The live `RealmEngineAdapter` collision/navigation denials, M1C/B4H/full-provider
gates and existing sixteen app dependencies remain unchanged. No
`RealmProgramActorRuntime` host is fabricated, and no durable-effects capability
is advertised. Autonomous inspect-and-report behavior and attributed A-to-B
testimony still require the separate admitted actor host and real effect owner.
The two moving local bodies must be labelled accordingly in the UI/evidence.

First Shard, the two frozen inventories and the existing port9018 preview remain
untouched. No global source discovery, new capture, release rebuild, deployment,
networking or additional AI service is part of this decision. The preceding
planning turn performed read-only source/interface review and updated this plan
and session memory only. Its earlier 95-browser/67-Python results remain
historical; implementation evidence is recorded in the following section.

## Local inhabitants implementation, 2026-09-23

**Scope:** The approved local CPU body slice is implemented and natively verified
in the existing RealmForge source-city preview. This is
not the autonomous NPC task host or the live Virtual Realm.

### Flat module ownership

| Module under `webgpu-os/apps/realmforge/virtual-realm/` | Responsibility |
| --- | --- |
| `RealmSourceCityGroundCollision.js` | Shares the inspection camera's Engine swept-AABB axis solver and body bounds. |
| `RealmSourceCityLocalSimulation.js` | Owns two independent CPU kinematic bodies, fixed simulation steps and named local routes. |
| `RealmSourceCityLocalBodyProjection.js` | Converts measured poses into twelve transient draw packets, six solids per inhabitant. |
| `RealmSourceCityRenderer.js` | Draws those packets through the existing device, frame producer, draw kernel and depth targets. |
| `RealmSourceCityPreview.js` | Owns explicit Start/Stop controls, exact document-head binding, visibility and retirement. |

The camera reuses the extracted collision solver. Its inverse-source regression
still reconstructs the original pinned implementation; this slice does not
change inspection movement. The two frozen captures, static scene packet
bytes, source-file identities and recipe report remain unchanged.

### Body state and navigation

`createRealmSourceCityLocalSimulation({compiled, isCurrent, logger})` resolves to
only `step(deltaSeconds)`, `snapshot()` and `dispose()`. It prepares the verified
ground artifact, chooses separated supported spawn cells near the entrance,
then wraps each private body with existing `createNaviLocomotionBodyRuntime`
and `createActorGroundNavigation`. There is no second pathfinder or AI scheduler.
The two bodies follow separately named entrance/avenue return routes.

Each body is 1.7 m high with 0.35 m horizontal half-width. Actual resolved motion
is limited to 1.2 m/s and sweeps against buildings, ground edges and the other
body. Priority alternates deterministically each tick. The shared navigation
module reads the resolved pose to decide arrival; a requested destination is
never substituted for that readback. The local backend is explicitly
`cpu-kinematic-aabb`, not native PhysX. Slopes, stairs, rigid-body dynamics and
crowd deadlock avoidance are not provided. A blocked single-lane meeting may
stop both bodies; it must not report a false arrival.

Simulation advances at 60 fixed ticks per second. A call processes at most six
ticks and records discarded catch-up time. The preview bounds incoming RAF
elapsed time to 0.1 seconds. The simulation owns no timer and publishes passive,
frozen snapshots. Stopping synchronously clears both velocities and retires
their navigation and locomotion wrappers. Cleanup errors are retained, exposed
and prevent replacement, including failures before an acquired lease returns.

### Rendering and operator controls

Open a source-city document in the existing RealmForge city panel and select
**Start local inhabitants**. The cyan and orange silhouettes appear within the
same first-person city. **Stop inhabitants** removes their draws. Simulation is
off by default and never saves body poses or modifies the source capture.

The renderer lazily acquires exactly two additional owned buffers. Its extended
instance and material buffers retain the unchanged static prefixes. After the
first upload, motion transfers only twelve 128-byte body packets, 1,536 bytes,
not the entire city. Selection updates the static prefix in both instance
buffers without erasing the moving bodies. Stop synchronously clears desired
and visible body state. The renderer retains those two buffers for a possible
explicit restart and releases them with its normal verified GPU cleanup.
Submitted-frame metadata distinguishes the actual body generation and revision
from the latest simulated state; submission is not native queue completion.

Every mutation is bound to the exact Session document store, snapshot, revision,
content hash, scene/report and current preview owner. Any document-head change,
including a same-geometry persistence rebind, stops this version. Suspension,
hidden-document visibility, process/operator retirement and destruction also
stop it. Resume never implicitly restarts inhabitants. A delayed compilation or
upload cannot resurrect an earlier generation. Cleanup failure still attempts
independent GPU release and blocks replacing the failed owner.
An ordinary Save that preserves the exact Session head does not retire bodies;
the binding follows actual head identity, not the name of a toolbar action.

### Local-body verification evidence

The exact CPU browser runner `tests/virtual-realm/run_source_city_local_simulation.py`
passed **131/131**: 26 simulation cases, 10 body-projection cases, 24 ground-grid
cases and 71 existing scene, navigation, recipe and design cases. The real
captured cities demonstrate independent movement, return journeys and measured
speed limits. An explicitly synthetic narrow corridor exercises genuine bodies
meeting at 0.702 m separation without crossing or false arrival. Tests also cover
fixed-step equivalence, dropped catch-up time, stale owners, partial acquisition,
cleanup refusal and unchanged static bytes. These CPU tests alone are not
evidence of visible native GPU rendering.

Receipt: `C:/Users/btspa/AppData/Local/Temp/`
`virtual-realm-source-city-ground-navigation-93_kht3f/receipt.json`, SHA-256
`5ff1757ea74b7bda716d91699f2a5eefb06a96627614e7553e9c91123f7a1972`.
The reused temporary-folder prefix is historical; the receipt scope is explicitly
`source-city-local-cpu-bodies-and-projection`. It records 77 modules, 85 served
routes, 131 unchanged source bindings, zero browser errors and zero denied
requests. Root independently compared all 131 current hashes.

Focused Python checks passed **85/85**: ground geometry 8, local simulation 8,
workbench/renderer 60 and composed-panel boundaries 9. Renderer literal-source
checks were extended for the explicit optional body branch; historical pins
were not replaced.

The genuine factory/native-GPU integration gate
`tests/virtual-realm/run_source_city_local_simulation_preview.py` passed **8/8**.
It verifies default-off controls, two progressing poses and submitted body
revisions, selection and target resizing during motion, Stop and fresh restart,
changed geometry, ordinary Save preserving the exact head, actual revision-only
head rebinding, distinct saved-asset replacement, pending native-transfer
suspension and pending-hash destruction. Delay barriers forward real operations
and do not fabricate GPU objects or compilation results. Receipt:
`C:/Users/btspa/AppData/Local/Temp/`
`virtual-realm-source-city-local-simulation-preview-no7ww07h/receipt.json`.
All 1,364 source bindings remained stable, with zero browser errors or denied
requests. Nine newly encountered construction/presentation dependencies were
individually reviewed and explicitly admitted to the isolated server; no
directory wildcard or runtime authority was added.

The existing `source-city-factory` gate also passed **15/15**, with no browser
errors, denied requests or source drift. Receipt:
`C:/Users/btspa/AppData/Local/Temp/`
`realmforge-source-city-factory-q6fwqjx1/receipt.json`.
The older standalone Preview/Panel runner was **not executed**: its preflight
stopped before opening the unreviewed `webgpu-os/kernel/PermissionPortal.js`
dependency. That separate runner was not broadened and its 36 cases are not
counted here. Current app integration is established by the explicit factory
closure, not a claim that every legacy graph passes.

The final native trusted-input walkthrough also **passed**, with three inspected
screenshots: two visible inhabitants, measured progress and both absent after
Stop. Tick 9 to 54 moved both bodies approximately 0.538 m. The saved asset head
was unchanged. Native buffers, textures, surfaces, producers and capability
counts returned to zero after cleanup. There were no browser errors, denied
requests or cleanup failures, and all 1,367 source bindings remained stable.
Receipt: `C:/Users/btspa/AppData/Local/Temp/`
`virtual-realm-source-city-local-simulation-native-c_76q0zs/receipt.json`, SHA-256
`c5fcbfe4aa8bfadd793d5e2e533ed8ec8d978d8e7af4c4b3e31712130615530c`.
The three PNGs are in that same directory. An earlier native run passed behavior
and cleanup but correctly failed its overall stability check when concurrent
`RealmForgePreparedBuildThumbnail.js` edits changed a source binding. It remains
diagnostic evidence; the stable replay is the acceptance record.

Totals for this slice are **154 browser cases**, **85 Python checks**, and the
separate native visual journey. All six changed/new production module hashes
match the passing app integration's served bytes. Scoped license, whitespace
and conflict-marker checks passed for 22 files; the four relative document links
resolve. Global documentation/API discovery, full boot/bundle, First Shard,
port9018, deployment and commits were not performed. Earlier unrelated
whole-workspace pin failures were neither erased nor repinned.

## Local inhabitant movement controls, 2026-09-23

**Status: implemented and verified.** This bounded continuation adds explicit local movement commands to the
existing two-body city. It does not activate shared NPC tasks or install a live
Realm host. The local owner, collision solver, renderer and preview clock are
reused. Browser acceptance is recorded separately from the preceding body slice.

### Four flat implementation pieces

1. **Existing body owner:** Extend `RealmSourceCityLocalSimulation` with a
   synchronous, validated `command()` entry. Keep one retained route per body,
   measured arrival, independent motion, fixed steps and current-owner checks.
2. **Existing preview:** Add `commandLocalInhabitant()` and one control row per
   body. Reuse the existing tick and upload path. Fence and retire row listeners
   with their simulation generation; do not give old controls a successor body.
3. **Verification:** Extend the existing CPU and genuine factory/native browser
   gates for independent pause, named destinations, held arrival, patrol resume,
   repeated replacement, malformed input and lifecycle retirement.
4. **Documentation:** Record the movement API and remaining shared-task boundary
   here and in session memory. Do not edit the shared NPC engine or SDK.

### Operator behavior and API

After **Start local inhabitants**, each body has **Go to entrance**, **Go to
avenue**, **Pause** and **Resume patrol**. A manual destination holds when the
body actually reaches it. It never automatically reverses into a new patrol.
Pausing one body leaves the other body independent; normal body-body collision
can still block a route. Resume patrol restores that body's back-and-forth route.
Stop, head replacement, suspension, visibility loss and close retain their
existing whole-owner retirement behavior. Commands do not edit or save the city.

```javascript
// On an already running, current RealmSourceCityPreview instance:
preview.commandLocalInhabitant({
    actorId: 'local-city-inhabitant-a',
    action: 'go-to',
    destination: 'entrance',
});
preview.commandLocalInhabitant({ actorId: 'local-city-inhabitant-a', action: 'pause' });
preview.commandLocalInhabitant({ actorId: 'local-city-inhabitant-a', action: 'patrol' });
```

Only the two actual actor identities and the two named local destinations are
accepted. Arbitrary coordinates, unknown actions and extra command fields are
not movement authority. Body snapshots distinguish `movementMode` (`patrol`,
`manual` or `paused`) from measured navigation `status`. An accepted command
increments the simulation revision without inventing an elapsed tick. Malformed
requests leave a current body's movement unchanged; lost ownership still stops
the simulation. The returned value
is a local simulation snapshot, not a durable action receipt or a GPU-completion
acknowledgement. Presentation follows through the existing preview tick.

Sources: `webgpu-os/apps/realmforge/virtual-realm/RealmSourceCityLocalSimulation.js`
and `RealmSourceCityPreview.js` in the same directory.

### Movement-control acceptance evidence

The completed slice passed **165/165 browser cases**: 139 CPU cases (34 body
simulation, 10 body projection and 95 existing geometry/city regressions),
11 real app/native-GPU integration cases and 15 existing factory regressions.
Focused Python checks passed **86/86**. Independent source review found no
remaining blocker. No shared NPC, engine navigation or renderer production
module was changed for this slice.

The CPU tests cover measured manual arrival, holding without repeated completion,
independent pause/resume, returning to the real entrance, malformed/accessor
requests without mutation, stale/disposed owners, 300 repeated commands without
retained-route exhaustion, callback reentrancy and failed-cleanup evidence.
App tests exercise the actual controls, inactive/pending/retired rejection,
detached old buttons after restart, selection/resize, exact-head changes and
suspend/destroy while real preparation or GPU transfer is pending.

The separate native trusted-input walkthrough also passed. All six screenshots
were inspected: initial bodies, progress, A paused while B moves, A held at its
entrance, patrol resumed and both absent after Stop. The entrance pose stayed
identical from tick 268 through 314. The saved asset head was unchanged. Final
native surface, frame-producer, capability, buffer and texture counts were zero.
There were no browser errors, denied requests or cleanup failures.

All receipt paths below are beneath `C:/Users/btspa/AppData/Local/Temp/`:

- CPU: `virtual-realm-source-city-ground-navigation-llydefr1/receipt.json`,
  SHA-256 `f6ec759bff0d34ca32aae3aa8361960b4f74af7cba3272792697f9467754c82c`.
  All 131 bindings stayed unchanged and were independently rehashed.
- App integration: `virtual-realm-source-city-local-simulation-preview-kxbq7na1/receipt.json`,
  SHA-256 `2cf4985d87714a6df952d3a5734d5b36f15a2e266989b93b4a4b3fd4a3495f9f`.
  All 1,375 bindings stayed unchanged; both modified production modules match
  the accepted served bytes.
- Native walkthrough: `virtual-realm-source-city-local-simulation-native-iujb24ff/receipt.json`,
  SHA-256 `e745440a98763c1e21cd518ea3e8cf3f945fccb0138f8902eaaa8763ff073239`.
  All 1,378 bindings stayed unchanged. The six PNGs are beside the receipt.
- Existing factory: `realmforge-source-city-factory-_iyc2lp8/receipt.json`,
  SHA-256 `819cca9789c7864dad1f2168f5cb84570095945b8149f1fea0551558162945ae`.

The initial app run passed 8/11 because three new assertions incorrectly looked
for an error code in `Error.message`. The corrected assertions check the exact
`Error.code`; production did not change. The diagnostic receipt remains at
`virtual-realm-source-city-local-simulation-preview-z1so2ny1/receipt.json`.
Before browser startup, the exact server inventory also required review of
11 newly imported concurrent construction, UI, math and inert ambient-contract
files. Each was read and individually admitted; no directory wildcard, dynamic
discovery or runtime authority was introduced. The resulting factory static
closure has 1,339 modules, with its existing deferred declarations unexecuted.

Scoped license/whitespace/conflict checks and Python runner compilation passed.
The four relative documentation links resolve. Both frozen capture pairs retain
their original hashes. First Shard, port9018, global documentation/API generation,
full OS boot/bundle, deployment and commits were not performed. Historical
unrelated pin failures were neither erased nor repinned.

### Why shared task admission remains separate

The source review found no navigation-only exemption in
`engine/gameplay/ai/intelligence/ActorTaskRuntime.js`. Even a registered `move`
operation prepares navigation and then executes through `EffectLedger`.
`EffectLedger.js` requires its actions owner to authorize and atomically record
the domain change and durable receipt against the expected revision. An
in-memory route map or private checkpoint journal does not meet that contract.
`RealmProgramActorRuntime.js` also requires the `durable-effects` host capability.

These controls therefore expose actual local movement without claiming NPC
task admission. The next shared-task implementation needs a real durable action
owner, exact actor/world scope, interruption and uncertain-reply reconciliation,
plus the remaining seven-port host composition. It must keep advancing real
bodies while asynchronous task work is pending. No new owner is admitted merely
by naming these capabilities, and no automatic tasks are started by these controls.

### Durable local movement tasks: implemented and verified

The user's subsequent “do it continue” approves this bounded extension to the
two existing local bodies. The six pieces have passed focused acceptance,
not full live-Realm admission. Each body has its own `ActorTaskRuntime` and
private checkpoint. `RealmProgramActorRuntime` and live-provider gates stay off.
The earlier movement-controls receipts do not verify this new durable authority.

1. **Local task scope:** Bind operator, exact document head, geometry digest,
   world incarnation, owner generation, actor and body. Admit only the existing
   registered movement method and the two named destinations. A body's direct
   patrol/manual owner and its task owner must be mutually exclusive.
2. **Durable movement owner:** Use genuine AppSandbox conditional transactions
   to atomically commit an authorized movement lease and its pending receipt at
   the expected revision. Actor/task/intent identity binds an immutable payload.
   Private interpreter checkpoints remain separate from authoritative effects.
3. **Measured body lease:** Add a narrow internal route-lease interface over the
   existing navigation and collision owner. Today's public `command()` does not
   expose prepared-route ownership; fabricating a ready route around it is not
   sufficient. Activate only a committed lease. Complete it only after measured
   arrival by its exact body in its exact world.
4. **Seven real ports:** Compose self, local perception, checkpoint memory,
   bounded intent meaning, genuine navigation, authoritative actions and explicit
   communication denial for this movement-only gate. Keep optional care methods
   absent. Do not advertise capabilities before their owners exist.
5. **Independent scheduling:** Keep physical fixed steps running during async
   interpreter/storage work. A pending move leaves the interpreter blocked on
   its effect, not the body frozen. Reconcile receipts and obtain fresh admission
   before advancing the method. Do not await a journey inside a physical tick.
6. **Lifecycle and UI acceptance:** Test independent actors, duplicate intents,
   lost replies, storage refusal, competing owners, pause/cancel, exact-head
   retirement and reload recovery. Show pending, arrived, interrupted and uncertain
   states truthfully. Direct controls cannot bypass an active task lease.

The required port interfaces are concrete:

| Port | Existing runtime requirement satisfied by the local owner |
| --- | --- |
| `self` | `read()` returns the exact actor and authoritative effect revision; any included pose is measured. |
| `perception` | `observe(context)` reports only permitted local body, anchor and world facts. |
| `memory` | `read()` and verified `write(checkpoint)` reuse `ActorCheckpointStore`; its optional archive methods remain distinct from effect storage. |
| `meaning` | `resolve(intent)` accepts only the supported exact method, destinations and constraints. |
| `navigation` | `resolveTarget(context)` returns a genuinely prepared actor/body/world-bound route, without granting motion. |
| `actions` | `admitTask`, `executeOnce`, `readReceipt` and `suspendTask` belong to one authoritative movement owner. Suspend stops motion synchronously before any persistence await. |
| `communication` | Mandatory `prepare(context)` explicitly denies unsupported communication; the movement gate sends no messages. |

AppSandbox provides exact-token, multi-record conditional transactions and
synchronous scope checks at the commit boundary. It does not atomically commit
an in-memory body pose. The durable domain change is acceptance of a movement
lease, followed by separately committed measured completion, not a promise that
an entire physical journey is atomic. Require genuine available storage and
verified commit/readback; the null-sandbox facade has callable no-op methods.
This reuses AppSandbox's existing operator-scoped AES-GCM record path and legacy
identity-derived key. It does not introduce secret-vault enrollment or claim a
stronger confidentiality model than the existing storage owner.

The implementation preserves these recovery rules:

- A lost reply reconciles the same intent. An absent receipt means uncertainty,
  never permission to redispatch.
- Pause or revocation stops motion synchronously. Persist interruption only
  while authorized; failed persistence must not invent a rejection.
- Late committed completion does not reactivate a paused or cancelled task.
- A world reset creates a new incarnation. Old tasks cannot acquire new bodies
  merely because textual actor identifiers match.
- Reopen restores the interpreter paused and requires receipt reconciliation
  and fresh admission. This first version never resumes motion silently.
- A cleanup failure blocks replacement and retains its evidence.

Sources: `engine/gameplay/ai/intelligence/ActorTaskRuntime.js`, `EffectLedger.js`
and `ActorGroundNavigation.js`; `webgpu-os/factory/sdk/ActorCheckpointStore.js`;
`webgpu-os/storage/AppSandbox.js`. This implementation leaves shared NPC production
under its existing task's ownership.

#### Flat implementation ownership

The new peers remain unnested under
`webgpu-os/apps/realmforge/virtual-realm/`:

- `RealmSourceCityMovementJournal.js` owns durable admission, immutable effects,
  pending receipts and separately certified arrival. Its single bounded record
  retains at most 128 tasks for one operator and saved city. A genuine exclusive
  Web Lock prevents concurrent live owners of that record. Ciphertext-token CAS,
  strict durability and exact readback remain required even with the lock.
- `RealmSourceCityLocalTasks.js` composes two instances of the shared interpreter,
  one per actor, with seven explicit ports. It reuses `ActorCheckpointStore` for
  private checkpoints and archives, never as the authoritative movement journal.
- `RealmSourceCityLocalSimulation.js` adds `acquireTaskBody`. Acquisition stops
  direct movement before route preparation. A retained genuine navigation route
  cannot start until its exact committed token is verified. Arrival evidence is
  measured; releasing the lease leaves that body paused.
- `RealmSourceCityPreview.js` owns explicit Enable, task destination, Pause,
  Cancel and Reconcile controls. Existing body ticks and GPU uploads continue
  independently of asynchronous task work. The factory and Panel pass through
  the existing operator sandbox; they do not allocate another storage owner.

The supported method is exactly `return-to-anchor@1`, with one movement step and
only that actor's entrance or avenue destination. There is no communication,
care interruption, autonomous goal selection, Factory execution or remote-city
authority in this gate. The communication port explicitly reports unsupported;
care ports are absent. Nothing is advertised as a complete live actor host.

#### Stable storage and changing physical worlds

The durable journal and checkpoint keys use the operator and stable asset
identity. A new local simulation task owner creates a fresh world-incarnation
identifier. Admission and immutable intent bind that incarnation, exact document
head, geometry digest, owner generation, actor and body. Matching actor names
are not proof that an old physical world survived.

Opening an exclusive new journal interrupts retained pending leases; it never
replays them. A rejected interruption says `physicalOutcome: not-certified`,
not that a prior body definitely never arrived. Completed receipts remain
immutable. Restored nonterminal checkpoints are paused, reconciled and held;
their old task cannot acquire the new world's body. Cancel closes that retained
private task before a new operator-issued request. A missing authoritative
receipt remains uncertain and does not authorize redispatch.

Body retirement is synchronous. Ordinary Stop can still persist its interruption
while the same app, operator and document head remain authorized. Actual account
or head revocation forbids those writes too; cleanup then records the unresolved
state rather than manufacturing a successful storage result. Failed cleanup
blocks replacing the local owner. The shared sandbox is never closed by a task.

The first genuine completion snapshot is retained across later physical ticks
and Pause/Cancel. This prevents a second readback, with a later tick or suspended
phase, from changing an already certified receipt. Async completion cannot
reactivate a cancelled or paused interpreter.

#### Operator workflow

1. Open the existing source-city asset in RealmForge and start local inhabitants.
2. Select **Enable saved movement tasks**. Unsupported or unavailable operator
   storage leaves ordinary city rendering and direct movement available.
3. Select **Task: entrance** or **Task: avenue** for either inhabitant. Its direct
   movement controls stay disabled while the task holds the body lease.
4. Read the separate task status. Pending means accepted but not yet certified
   arrived. Completion requires actual collision-resolved arrival and its saved
   receipt, not merely successful route planning.
5. Pause or Cancel stops that inhabitant immediately. Reconcile reads the same
   authoritative receipt; it does not start another journey. Assign a new task
   only after the previous one is terminal and its effects are settled.

The gate deliberately stops at its retained journal capacity. It does not erase
receipts or silently recycle task identifiers. A later bounded archival design
must preserve immutable identity and recovery evidence before increasing this
capacity.

#### Acceptance evidence

The genuine encrypted-storage and task-composition gate passes 28/28 cases:
20 journal cases and eight shared-interpreter/body integration cases. It uses
real IndexedDB, WebCrypto, Web Locks and the actual CPU collision bodies. Its
entry-only static closure has 111 bound sources and 86 served routes; it does
not traverse the unrelated RealmForge app or allocate a GPU. Receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-city-movement-journal-pwk2d4py/receipt.json`,
SHA-256 `daec2108062e0750c45e61672314136f3b0cd2ec707062d00212dc00453de5f7`.
All bindings stayed unchanged, with no browser errors or denied requests.

That gate found and fixed one local integration issue: an injected body-stop
failure could reject before the shared interpreter awaited retirement, because
it first saves the checkpoint. The local suspension port now observes its
rejected promise immediately while returning the same rejection to the eventual
caller. This preserves cleanup failure without editing the shared NPC runtime.
The first `ird30qqp` receipt is retained as diagnostic evidence, not acceptance.

The body/navigation/projection gate passes 151/151 against the final body-lease
implementation: 46 simulation, 10 projection and 95 existing ground, scene,
navigation, recipe and design cases. It has 131 unchanged source bindings and
85 served routes. Receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-city-ground-navigation-kgaurxnf/receipt.json`,
SHA-256 `5d190bed9c63ddcbf729fd9ac060f710df3a789bc0c638f3490513c9ddb3bbbf`.

The actual-app durable-task gate passes 8/8 with genuine operator storage and
native GPU presentation. It covers independent measured arrivals, cancellation,
direct-control exclusion, Stop/Start paused recovery, new incarnation, Pause and
Reconcile, head retirement, detached controls, unavailable storage and refused
writes. All 1,400 source bindings stayed unchanged; there were no browser errors
or denied requests. Receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-city-local-tasks-preview-lst_hg3h/receipt.json`,
SHA-256 `044c93e9e6ca0ae886ccd2af9ffa42b149ab72ed09d8da50a54b18a4cb690643`.

Native trusted-input acceptance also passes, separately from the original 187 browser
assertions. Four screenshots show both saved tasks moving, A cancelled while B
continues, B's certified arrival, and both bodies removed after Stop. The actual
rendered frame's body generation and revision are checked against the measured
simulation. A remains at its cancellation pose while B finishes. The saved city
head is unchanged; final surfaces, frame producers, capabilities, native buffers
and textures are zero. There are no browser errors, cleanup failures or denied
requests, and all served/source bindings match. Receipt and four inspected PNGs:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-city-local-tasks-native-gifa4g0u/receipt.json`,
SHA-256 `4e91640a05c24e517ad8efe17dd92f581ded3a676983b945c12d0c4a97a5ff64`.

The earlier native `niwaghlu` receipt passed behavior and cleanup but failed
source stability during a concurrent unrelated RealmForge panel edit. It remains
diagnostic evidence; only the stable rerun above is accepted. The earlier app
`8zw9hr7q` run precedes the final local suspension/UI-status refinements and is
superseded by `lst_hg3h`.

The previously deferred local-preview and factory regressions were replayed
after the concurrent RealmForge construction task released its stable source
checkpoint. Fresh exact import preflight still admits 1,363 static modules and
records 11 deferred declarations without executing them. Both suites pass with
unchanged source bindings, matching served bytes, no browser errors and no
denied requests:

- Local-preview: **11/11**, 1,399 source bindings. Receipt
  `C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-city-local-simulation-preview-ss5n2l1g/receipt.json`,
  SHA-256 `a7f4a84e130f32eea57899fd4279f55dfd4fbaee503d8cfa1bbf91958737189e`.
- Factory: **15/15**, 1,395 source bindings. Receipt
  `C:/Users/btspa/AppData/Local/Temp/realmforge-source-city-factory-kkhit1mu/receipt.json`,
  SHA-256 `056e4c39fb15870d7e1631e52660e5a677bcca9dc021712754a529a55c2bb2d5`.

These 26 cases are additional to the earlier 187, not a rerun of the same case
identities. The six city production files remain byte-identical to the accepted
native screenshot run. All 111 journal-gate bindings and all 131 body-gate
bindings also remain unchanged. Ten shared construction/geometry/modeler modules
changed after the earlier eight-case task-app run, so that suite was also
replayed against fresh sources: **8/8 passed**, all 1,400 bindings unchanged,
matching served bytes, no browser errors or denied requests. Current task-app
receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-city-local-tasks-preview-3zmzuo_d/receipt.json`,
SHA-256 `03df9e502606de872645d37a1b0da50c24dbfa43c89ebc8177bbbf473534d90c`.

The resulting current scoped total is **213/213 browser cases**: 151 body and
supporting cases, 28 journal/composition cases, 8 task-app cases, 11 local-preview
cases and 15 factory cases. Repeated runs are not counted twice. All 96 Python
cases pass again. The four native screenshots remain evidence of the earlier
native run with unchanged city code; this follow-up does not claim new images
or a fresh full-OS run. No production code was edited for these regressions.

The five scoped Python suites pass 96/96. Five Python runner compilations and
24 source/test SPDX, whitespace and conflict-marker checks pass. Both baseline
and kernel capture pairs are unchanged. No full OS boot, live actor admission,
First Shard scan/read, port-9018 reload, global documentation generation, bundle,
commit or deployment was performed. Global discovery regeneration is deferred
to its coordinated owner; this plan's local links are checked separately.

### Read-only inhabitant inspection

The user's next continuation approved the five-piece inspector proposal. Its
implementation extends the same first-person source city. It does not introduce
another renderer, autonomous behavior or live-host admission. The preceding
213-case acceptance records remain historical evidence for the earlier slice;
the inspector's own verification is recorded separately below.

#### Flat implementation and ownership

The city modules remain peers under `webgpu-os/apps/realmforge/virtual-realm/`.
No engine, shared NPC SDK or live actor-runtime authority is added.

| Peer | Responsibility |
| --- | --- |
| `RealmSourceCityLocalBodyProjection.js` | Decode the two silhouettes' twelve solid parts from exact packed f32 matrices and object IDs; preserve actor/body identity. |
| `RealmSourceCityRenderer.js` | Publish immutable geometry from the body projection actually used in the submitted frame, with generation, revision and physical tick. |
| `RealmSourceCitySelection.js` | Add nonmutating `pickTarget` beside existing building-only selection; intersect exact submitted solids with the same clipped camera ray and Engine slab query. |
| `RealmSourceCityLocalTasks.js` | Read real private checkpoints/archives and authoritative journal receipts into a detached, read-only inspection result. |
| `RealmSourceCityPreview.js` | Own selected actor/body/world identity, asynchronous read lifetime, existing input integration and generation-bound Inspect controls. |
| `RealmSourceCityInhabitantInspector.js` | Render text-only evidence and history, with Refresh/Clear actions; own no simulation, storage, selection or clock. |
| `RealmSourceCityMovementJournal.js` | Export its existing 128-task limit; preserve admission, persistence, recovery and receipt behavior. |

Picking transforms the clipped near/far ray into each submitted solid's local
space using Engine matrix math. It does not use the wider collision body or
invent geometry from an unsubmitted simulation pose. A nearer captured building
occludes an inhabitant; equal-depth building/body ties belong to the building.
Only buildings and the twelve silhouette solids are inspection targets. Roads,
ground and tiny building trim outside the existing box are not new pick targets.
The legacy building-only `pick` and `selectPath` APIs remain available.

The submitted-data path uses strict detached JSON copying before validation;
accessors cannot run while a target frame is inspected. Actor/body identities,
matrix finiteness, f32 representation, invertibility, object IDs, exact record
keys and the two-body/six-part bounds are checked. Camera projection and clip
range remain the renderer's existing profile.

#### Evidence is not execution

`readInspection({ actorId })` validates the exact operator scope and returns
head/geometry/world identity, selected actor/body, current interpreter checkpoint, bounded retained
task rows and actual journal counts. A row separates `privateTask`,
`authoritativeReceipt`, `admission`, `targetRef`, `privateSource` and
`belongsToCurrentIncarnation`. Missing receipts remain unknown; a pending
receipt means accepted movement, not certified arrival.

Current private task state and physical pose come from their live owners. Saved
receipt/history values are a separate read sample. The inspector does not turn
interpreter progress into physical proof. A completed arrival from an earlier
world is explicitly labelled historical in both the headline and history, never
presented as proof about the replacement body with the same textual actor ID.

The read path verifies the encrypted actor journal before collecting individual
receipts. It reuses `ActorCheckpointStore.readArchivedTask` through a separate
reader that closes in `finally`; an archive I/O failure cannot poison the live
checkpoint writer. No reconcile, propose, admit, resume, movement command,
conditional write, document publication or task activation is performed by
inspection. Task changes schedule a fresh read after accepted work settles;
Refresh repeats only the read, including after an explicit read error.

The retained authoritative journal is still capped at **128 tasks across this
city**, not 128 per actor. Private history and the current private task can add
rows to the read-only union, bounded by the existing private-history limit.
Nothing is pruned, recycled or silently evicted. The UI shows the journal's
actual used capacity and the no-automatic-eviction policy.

#### Selection, lifecycle and controls

In the existing RealmForge city, Start local inhabitants, then click a visible
silhouette or use that actor's **Inspect** button. The button is a normal native
keyboard-focusable control. Inspection also works before saved tasks are
enabled and does not enable them. Existing movement/task controls remain the
only way to request those operations. The inspector shows identity, measured
metric position/tick, movement mode/status, named destination, current task,
saved effect evidence and retained history.

Building and inhabitant selection are mutually exclusive. Valid file selection
publishes its serialized GPU-highlight queue before delivering diagnostic or UI
callbacks. Inhabitant selection retains its own intent revision so a newer
callback selection cannot be overwritten by the older caller. Invalid actor or
file requests preserve the existing selection.

Every asynchronous read rechecks the exact selected object, actor/body owner,
operator scope, document store/head, world generation and task owner. Scope
callbacks are followed by another owner check. Concurrent task progress rejects
an inconsistent sample with `INSPECTION_BUSY`; retired ownership rejects with
`INSPECTION_STALE`. Late completions cannot populate a newer inspector.

Stop, replacement head, suspension, process retirement and disposal clear the
selection. The hidden inspector also clears private field text and retained
history from the DOM. Detached Inspect buttons have aborted generation-bound
listeners and cannot select successor bodies. Retirement invalidates reads
synchronously and drains task ownership before closing the native renderer;
`whenIdle` drains pending inspection reads before preview destruction completes.

#### Inspector acceptance evidence

Implementation and independent boundary review are complete. Focused CPU browser
acceptance passes **184/184**: 59 local simulation/projection, 30 selection and
95 existing scene/navigation/recipe/design checks. All 134 source bindings remain
unchanged and current. Receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-city-ground-navigation-7odwni32/receipt.json`,
SHA-256 `6ba2dae90f9970949e16bdda1fd63fb4b8a271e8272b3a289f6dd6335b42e443`.

The genuine encrypted journal/task gate passes **40/40**, including twelve new
read-only inspector cases. The final 2026-09-26 CPU-only refresh uses the frozen
snapshot, with 135 unchanged source bindings and 87 matching served routes, no
browser errors or denied routes. It allocates no GPU resources. Receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-city-movement-journal-kuhp6ir4/receipt.json`,
SHA-256 `d1a7f1f8e6420bb07c43830c3dffd95850b3e3de25ef217783aac256a1f5f0a8`.
The earlier `5fgnprp6` 40-case receipt remains stable evidence for its own run;
the final refresh also includes the subsequently revised graph-inventory helper.

The actual-app inspector gate passes **8/8** against the frozen source snapshot,
including native submitted geometry, real encrypted history, zero conditional
writes during inspection, detached controls, head replacement, app suspension,
process retirement and selection changes from synchronous callbacks. All
1,426 source bindings stayed unchanged; served bytes match, with no browser
errors, denied routes, failed or skipped cases. Receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-city-inhabitant-inspection-sc9tx_id/receipt.json`,
SHA-256 `8538a6be3ec6a7e385abe6a2ea4ffd6405a8cf67f12bae1db5e4054c183524c4`.

The separate native walkthrough passes real mouse selection of A and native
reverse-Tab/Enter selection of B. It enables saved tasks through real controls,
observes accepted pending movement, cancels that task, then records measured
return-to-entrance completion while retaining the cancelled receipt in history.
Stop clears selection; the saved document head is unchanged. Final native
surfaces, frame producers, active capability receipts, buffers and textures are
zero; the operator is locked and the actual app is destroyed. All 1,430 source
bindings stayed unchanged. There are no browser errors, cleanup failures or
denied requests. Three screenshots were inspected, showing the current selection,
pending movement and completed/cancelled history without horizontal overflow.
This walkthrough is not counted as additional numbered browser cases. Receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-city-inhabitant-inspection-native-xa2q7mht/receipt.json`,
SHA-256 `d73f8bba279d0e33f5b0044689e08dc76747038cc8e0f2768d5a0e10f0e1e3f9`.

Both runs use the existing genuine factory, native renderer, encrypted operator
storage and shared performance-run lock. Their exact source snapshot is
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-inspector-source-a0b511f298014ce79c7bf9da709a174e`.
Seven inspector-related production modules still match the working tree on
2026-09-26. Unrelated later construction edits are not claimed to be included.
The isolated Python package deliberately omits bundler CLI initialization and
its recursive bootstrap discovery. It runs the unchanged direct parser/graph
modules, with 22 additional, individually reviewed Python helper dependencies
copied beyond the earlier source-bound inventory; it does not test the
bundler CLI. The snapshot copied only admitted individual paths, not a repository
or directory tree. No First Shard capture or access is introduced.

Review corrections include callback selection ordering, historical receipt
wording, target labels, strict submitted-record copying and private DOM clearing.
The first CPU getter-boundary failure and transport-start failure are retained
as diagnostics. A first journal run passed behavior but observed a concurrent
Python runner edit; only the stable rerun above is accepted.
The earlier native `afza56l6` and `rgrh7h44` receipts remain diagnostic failures,
not acceptance. The first encountered a disabled control after body retirement;
the second confirmed mouse picking but found missing Enter text in the native
test driver. The accepted driver sends actual Enter text and uses the genuine
host's normal resize path to show the full inspector. It does not call selection
methods or synthesize DOM click events to pass native interaction checks.

The remaining frozen-source regressions were rerun on 2026-09-26. All served
bytes match their unchanged source bindings, with no browser errors, denied
routes, failed or skipped cases:

| Gate | Passing cases | Bound sources | Receipt directory under the same temporary root |
| --- | --- | --- | --- |
| Existing saved-task app | 8/8 | 1,427 | `virtual-realm-source-city-local-tasks-preview-12rrcth1` |
| Existing local-inhabitant preview | 11/11 | 1,426 | `virtual-realm-source-city-local-simulation-preview-dwz_yf0n` |
| Existing source-city factory | 15/15 | 1,422 | `realmforge-source-city-factory-rduehyvn` |

The respective `receipt.json` SHA-256 values are
`ce1ac4ad737770c472a6ef1b76d1b24df08c7a9a34db05c7f35f69b332df6990`,
`e610600aa4ec5b9a1d9d1e4863d43dd7bb02207f0fa0d39f0c032418faa5d5a6`
and `cbf740da2f8e27d3d6f26beec33d4ec396197b09a5f3285d3ea9e188f12acf25`.

Current scoped acceptance totals **266/266 browser cases**: 184 CPU scene/body/
selection cases, 40 encrypted journal cases, 8 inspector-app cases, 8 existing
saved-task cases, 11 local-preview cases and 15 factory cases. Repeated runs and
the native walkthrough are not counted again. The six focused Python suites
pass **104/104**, and six Python compilations pass in the same snapshot. Missing
test-only files were admitted individually before that Python rerun; existing
source-bound files were not overwritten. Initial missing-fixture failures are
not counted as acceptance.

Scoped source/test SPDX, whitespace and conflict-marker checks pass for the
28-file review set. Local plan links are checked separately. Global docs/API
index regeneration remains deferred because it would broaden discovery beyond
the admitted paths and overlap concurrent ownership. No full OS boot, live actor
admission, First Shard scan/read, port-9018 reload, bundle, commit or deployment
was performed. This acceptance covers the source city and exact frozen app
closure, not unrelated concurrent construction changes or the complete live
Virtual Realm.

Automatic storylets, care goals, multi-user presence, SecureMesh travel and full
live-Realm execution remain separate roadmap decisions.

### Selected-inhabitant wayfinding

The next user continuation approved this five-piece proposal. It is implemented
in the existing first-person city. Its acceptance is recorded separately from
the preceding inspector results.

1. Promote the existing source-city wayfinding projection and overlay from their
   current test/workbench location into flat production peers, retaining
   compatibility exports. Reuse clipping, building occlusion and label budgets.
2. Expose an additive read-only destination projection from the local body's
   genuine private anchor map, with actor/body/geometry/generation identity.
   Do not call navigation `resolveTarget` merely to obtain label coordinates:
   that operation allocates a retained route.
3. Add at most two annotations for the selected actor: identity at its submitted
   packed head geometry, and its actual named destination. Label metric distance
   as straight-line distance, not route length or certified arrival.
4. Attach the pointer-transparent, text-only overlay to the existing submitted
   frame and selection lifetime. Reuse the current viewport and clock. Prepared,
   paused, active and historical destinations must remain distinguishable.
5. Verify both actors, building occlusion, clipping, resize, direct/saved task
   movement and stale ownership. Native input must demonstrate a label following
   the actual drawn body, with no additional storage writes or physical actions.

#### Flat modules and submitted-frame identity

`RealmSourceCityWayfinding.js` and `RealmSourceCityWayfindingOverlay.js` are now
production peers under `webgpu-os/apps/realmforge/virtual-realm/`. The former
workbench paths are compatibility reexports, not duplicate implementations.
Default file/district labels, clipping, CPU building-box occlusion, decluttering
and the ten-label budget remain available. The initial city Preview selected
the selected-only profile. The captured-source signs slice now composes source
signs with at most one inhabitant and one destination label.

`RealmSourceCityLocalSimulation.readDestinations()` passively reads the existing
private anchor map. Its frozen result includes generation, geometry digest,
revision, tick, actor/body identity, anchor, phase and optional task/lease IDs.
It invokes no currentness callbacks, resolves no routes, and changes no state.
The Preview owns currentness and captures this observation with the same body
snapshot, before pumping any task work.

`RealmSourceCityLocalBodyProjection` strictly copies destination data and checks
it against the supplied generation, geometry digest, body identities, revision
and tick. The renderer carries that immutable metadata through the existing
body transfer. `lastFrame.localDestinations` describes the same upload as
`lastFrame.localBodies`; a live simulation read is never substituted for older
submitted geometry. A repeated body revision cannot replace its destination
metadata. Existing callers can omit destination data without changing GPU bytes.

The identity anchor is the exact packed head-center matrix translation. The
destination anchor is the genuine ground coordinate, without an invented visual
height. An offscreen or occluded point is suppressed rather than moved into view.
Identity distance means straight-line distance from the camera. Destination
distance means ground-center-to-target straight-line distance from the inhabitant.
Neither is route length or certified arrival. Occlusion uses the existing CPU
building boxes, not GPU depth or a new readback path.

#### Visible status and lifecycle

Start local inhabitants, then select a silhouette or its keyboard-accessible
Inspect control. The labels are pointer-transparent. Their position updates
through the existing submitted-frame notifications, including movement with a
stationary camera and normal surface resize. There is no second animation loop.
The Preview has no crosshair, so its overlay does not reserve an imaginary
crosshair rectangle; the workbench's existing reservation remains the default.

Destination phases distinguish `active`, `prepared`, `paused`, `arrived` and
`historical`. A newly held task body can retain a prior patrol anchor, explicitly
historical and without task/lease identity. A cancelled task releases its lease;
the actual stopped body's retained destination is then paused with null task and
lease IDs, not an active task. `arrived` is body-state evidence, not a substitute
for the inspector's authoritative saved completion receipt. Old-world encrypted
task-history rows are not inputs to the overlay.

The cache includes annotation data, dimensions and camera state. Selection
replacement, Clear, building selection, Stop, head replacement, suspension and
retirement clear annotations and private DOM text. A scope callback that selects
a successor causes the older update to reread selection rather than clear the
successor's labels. Projection errors clear the overlay and report diagnostics;
they do not create movement, persistence or native-renderer authority.

#### Wayfinding verification

The focused CPU/browser run passes **222/222** across eight gates: 52 local
simulation cases, 17 body-projection cases, 30 selection cases, 28 wayfinding
cases and 95 existing ground/scene/navigation/recipe/design cases. The first run
found that the general RealmForge normalizer invokes getters. The destination
input now reuses Engine's existing strict data copier; the getter test passes
without invoking the callback. That first run remains diagnostic evidence.

Accepted CPU receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-city-ground-navigation-y2xxuiz4/receipt.json`.
SHA-256 `2e1bc923ebfc04f2bd3e62463f549bdd74cd195acfb5577e7a875a8d9d4220d5`;
127 source bindings are unchanged and all 94 served routes match. No browser
errors, skipped cases or denied routes occurred. All six focused Python suites
pass **106/106**, with six successful compile checks.
The genuine encrypted journal gate also passes **40/40** with 135 stable source
bindings and 87 matching served routes. Receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-city-movement-journal-1dw7nmj7/receipt.json`,
SHA-256 `9fbf2010c4754174f57ec8a58bd44126734365488bb9c65aefb0beb6454c4bf5`.
This is CPU-only encrypted storage/task verification and allocates no GPU.
The source snapshot is
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-wayfinding-source-e9b9104e91bd4358a40a2fd67e65c191`.
It contains individually admitted paths and deliberately omits bundler package
initialization/CLI discovery. The final actual-app gate passes **11/11**, including
both selected identities, moving and paused task destinations, cancelled lease
release, normal resize, unchanged storage/document head and lifecycle clearing.
All 1,428 source bindings are stable; 1,382 served routes match. Receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-city-inhabitant-inspection-n99jdj3n/receipt.json`,
SHA-256 `3eda2f16c9f009c409701109e63b1e752d921103fb72b46b6ff55fa32583496c`.

The native walkthrough also passes real pointer selection of A, reverse-Tab/Enter
selection of B, pointer-transparent labels and normal surface resize from 420 to
360 CSS pixels high. Identity anchors equal the submitted head matrix; destination
coordinates and phases equal submitted metadata. Three screenshots were visually
reviewed: both selected identities are readable, and the final entrance marker
shows its explicit phase and distance. The document head is unchanged. Stop
clears annotations; app destruction leaves zero native surfaces, frame producers,
active capability receipts, buffers and textures. There are no browser errors,
denied requests or cleanup failures. All 1,432 bindings are stable and 1,384 served
routes match. Receipt:
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-city-inhabitant-inspection-native-kevvfb3d/receipt.json`,
SHA-256 `afc9669e185a042f5d6a2757139b8121d687fbe889684443376ccc13bc6673d4`.

Current scoped acceptance is **273/273 browser cases** (222 CPU/projection,
40 encrypted journal and 11 actual-app), plus the separate native walkthrough
and **106/106 Python tests**. Repeated runs and historical suites are not counted
again. The first app receipt `gla_z_zt` is diagnostic: ten cases passed, but its
960-pixel resize remained under the fixture's existing viewport cap, so no resize
occurred. That run also saw a test-runner source change. The final 540-pixel
resize case and stable rerun supersede it without weakening production checks.

All six changed production peers match the tested snapshot. Scoped checks pass
for 23 source/test files, six Python runners and four local plan links. Full OS
boot, shared NPC/Engine activation and unrelated concurrent construction changes
are not covered by this gate. Global docs/API discovery regeneration remains
deferred to coordinated ownership and the First Shard exclusion. The user's
port-9018 preview was not navigated or reloaded. The shared GPU slot was released
after the final app run; no further native jobs remain queued for this slice.

### Captured-source city signs

The subsequent user continuation approved and implemented the source-sign slice
in the app-owned first-person city. It reuses the existing frozen captured-file
and district catalog, not a new scanner, world generator or source-text reader.
The following five pieces preserve the previous inhabitant-label behavior:

1. `RealmSourceCityWayfinding.project` accepts a boolean `sourceLabelsEnabled`
   mask, defaulting to true. The catalog remains immutable and source visibility
   cannot remove the selected inhabitant or destination candidates.
2. `RealmSourceCityWayfindingOverlay` exposes an independent source-sign setter
   and snapshot field. Its frame update accepts source visibility and current
   private annotations together. The projection cache binds both values to the
   submitted camera, selection, surface and CSS viewport dimensions.
3. `RealmSourceCityPreview` owns the local **Show captured file and district
   signs** checkbox. It defaults on, requires a real boolean, survives replacement
   of that Preview's renderer and is not saved in the document or task journal.
   Changing it starts no bodies, routes or tasks and changes no GPU owner.
4. The Preview opts into self-contained sign styles. District colors match the
   workbench; the selected captured file has a green highlight. The workbench's
   existing CSS remains the default for its compatibility import. Label elements
   remain text-only and pointer-transparent, including their children.
5. Focused tests exercise source-only visibility, preserved inhabitant labels,
   genuine captured metadata, actual submitted selection, normal resize,
   reentrant host retirement, unchanged storage and complete label cleanup.

Source files retain their genuine existing anchors, basename, captured line
count and camera distance. District signs retain captured membership counts.
No label claims that the capture is a live filesystem view. The overlay does not
fetch source text, reveal uncaptured content, grant access or draw synthetic code.

The ten-label total, eight-file and two-district caps remain. Eligible selected
inhabitant and destination labels take priority, followed by the selected file,
districts and other files. Selection priority uses `lastFrame.selectedFilePath`,
not a newer pending UI selection. Existing near/far clipping, viewport margins,
distance limits, CPU building-box occlusion and decluttering remain unchanged.
The source-file anchor's own building remains its only occlusion exception.

Source signs update even when no inhabitants are running. They require the
current captured scene, submitted frame, connected Preview root and visible
document. Hidden-page notification clears them even without a local body owner.
Stop and Clear erase selected-inhabitant evidence but may retain valid source
signs. Head retirement, suspension and destruction remove all signs. `clear()`
also erases captured text and identity attributes from detached label nodes;
reuse creates visible labels again from the frozen catalog.

Source visibility and private annotations are published atomically. Calling a
separate source visibility setter before replacing revoked private annotations
could replay stale display data during diagnostics. The Preview instead makes
one frame update after rechecking current scene and owner identity. Its checkbox
listener uses the existing abort controller and is removed at destruction.

#### Source-sign verification

The frozen CPU browser gate passes **226/226**: 69 simulation/body-projection,
30 selection, 32 wayfinding and 95 ground/scene/navigation/recipe/design cases.
The six focused Python suites pass **108/108**; six suites and six runners compile.
The encrypted journal regression passes **40/40**, and the actual-app gate passes
**14/14**, for **280 unique browser cases**. The separate native input walkthrough
also passes; repeated runs and native actions are not added to that case total.
This is focused source-city acceptance, not full OS startup or live Realm admission.

The CPU receipt is
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-city-ground-navigation-ig34gsoh/receipt.json`,
SHA-256 `cada33fec774aa75cb11dccde080a7e62a5666016624fcc6ace41d56b60a88f2`.
All 127 source bindings are stable and all 94 served routes match. The unchanged
encrypted journal regression also passes **40/40**, with 135 stable bindings and
87 matching served routes. Its receipt is
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-city-movement-journal-mffljivs/receipt.json`,
SHA-256 `bbaab51be38bba357eba3e29f7d249e21d58af3648913a54e52f5673d5501d16`.
Neither run has skips, browser errors or denied routes.

The final actual-app receipt is
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-city-inhabitant-inspection-vlay6wes/receipt.json`,
SHA-256 `8c70ee18d2b7d12d153cd7f85bddba3120c03b5210b911c9a49e650e5b05221b`.
All 1,428 bindings are stable and all 1,382 served routes match. The native receipt is
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-city-inhabitant-inspection-native-kzenyd55/receipt.json`,
SHA-256 `3050ab6a06bf2f595c7dde2ec5ae603898223909840b1481e0737d1b65ad4ffe`.
All 1,432 bindings are stable and all 1,384 served routes match. Independent review
also compared those bindings against the frozen copy. Both receipts have zero
browser errors, denied routes and cleanup failures.

Native input turns the actual camera, clicks the genuine projected building,
and verifies submitted selection of `engine/core/math/EngineMath.js`: 396 captured
lines, its exact scene anchor, green selected styling, bounded text and pointer
transparency. Real checkbox pointer and Space input toggle only source signs;
inhabitant selection, reverse-Tab/Enter, resize and task inspection remain valid.
Stop removes private annotations while retaining eligible source signs. The
saved document head is unchanged. Destruction leaves no root, surfaces, frame
producers, active capability receipts, buffers or textures; the operator is locked.

Four PNGs beside the native receipt were visually reviewed:
`city-captured-source-signs.png`, `city-inhabitant-pointer-inspection.png`,
`city-inhabitant-pending-movement.png` and `city-inhabitant-certified-history.png`.
They show readable district and inhabitant/destination signs. The first PNG
contains a replacement entrance-camera presentation, not the selected-file frame
recorded by the native assertions. It is therefore not selected-filename or
green-highlight pixel evidence. Those behaviors are verified by input and DOM
checks. The subsequent capture-integrity continuation diagnoses this gap;
the original image is not retroactively treated as selected-file evidence.

The earlier `virtual-realm-source-city-inhabitant-inspection-ldvoni92` run is
diagnostic only. Its first 12 cases passed, but case 13 waited for a file sign in
a narrow entrance view where only district signs were eligible. The final test
uses genuine canvas ArrowRight input to reveal the selected building, releases
the key in `finally`, and returns Home. No production clipping, timeout or
selection requirement was weakened. The final 14-case receipt supersedes it.

The exact source snapshot is
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-signs-source-5788d0150b6d45d1b50a2b798bff9864`.
It individually copies the prior admitted inventory and refreshes only the
13 changed source/test/runner files. It does not recursively discover source
paths or include bundler initialization. Missing Python-only test fixtures were
copied at their known literal paths. This preserves the prior app closure and
does not claim to cover unrelated concurrent construction or physics changes.
All three changed production peers match the frozen copy. Scoped checks pass
for 13 source/test files and four local plan links. Global documentation/API
discovery generation remains deferred to the admitted-path boundary and shared
ownership. First Shard and the user's port-9018 page remain untouched.
The shared GPU slot was released after the native walkthrough; no city GPU job
remains running or queued for this slice. Other construction and physics work
was not modified or represented as covered by this frozen acceptance.

#### Capture-integrity continuation

The next continuation changes only the native verification runner and its Python
checks, not production city rendering or lifecycle policy. New before/after
assertions reveal that the full-page screenshot path can replace the app's
Preview during capture. Diagnostic `bvk915ul` records selected frame 16 in
Preview generation 1 before capture, then unselected frame 5 in generation 3.
The recorded retirement/preparation matches the existing factory visibility
suspend/resume path. No document visibility event or GPU error was recorded;
a transient root-size change is a hypothesis, not directly measured evidence.

The runner now reuses `run_source_city_workbench.capture_canvas()`, which takes
viewport-only canvas-region and page images. It does not weaken the factory's
visibility checks, preserve a retired renderer or restore selection artificially.
The scoped `capture_current_city()` wrapper waits for genuine GPU completion,
two animation frames and GPU completion again. It compares Preview/renderer
generations, content hash, selected file, camera pose and selected actor/body
generation before and after each image pair. The source-sign image additionally
checks exact visible labels and viewport dimensions across capture. Animation
frames offer presentation opportunities; the saved bitmap still requires review.

Diagnostic `g2h4ra9d` confirms the viewport-only source image preserves generation
1, camera and selected metadata; its canvas PNG visibly shows the highlighted
`EngineMath.js` building and genuine 396-line sign. The later still-full-page
inhabitant capture suspends that simulation and causes the next native control
to reject. Both failed whole-run receipts are retained as diagnostics, not
accepted walkthroughs. All four accepted image sites now use the viewport-only
wrapper. The complete native retry passes in
`virtual-realm-source-city-inhabitant-inspection-native-5hakcvaw/receipt.json`
under the same temporary evidence root, SHA-256
`2e652270198d4b87ae52b586a4b22510b982999b088d1da180d557d34561c0f3`.
All four before/after identities retain Preview and renderer generation 1, exact
camera and selected owner. Four canvas PNGs were visually reviewed: the selected
EngineMath.js building and genuine 396-line sign are readable, along with both
inhabitant identities and the entrance destination. Each canvas image has a
hash-bound viewport page sibling. Saved head and cleanup checks pass, with no
browser errors or denied routes. This closes the prior visual evidence gap; it
does not certify the subsequent source-inspector implementation.
Two durable Python checks pin capture ordering, identity guards and viewport-only
helper reuse. The six focused suites now pass **110/110**.

### Captured connections and directory inspection

**Status: implemented and accepted.** The user explicitly approved the five-piece
inspector build. Captured import and directory inspection now runs in the actual
RealmForge city panel.
This is a bounded visible-city continuation of source inspection, not acceptance
of integrated M2G, live networking, remote-city access or a new runtime provider.
The implementation reuses the following five-piece design. Final acceptance
results are recorded separately and must not be inferred from prior city gates.

The reusable production models already exist in
`webgpu-os/apps/realmforge/virtual-realm/RealmSourceCityRelations.js` and
`RealmSourceCityDirectories.js`. Their `project()` operations validate captured
membership and original road/parcel bindings. `RealmSourceCityRenderer.js`
already accepts `updateSelection(path, relationId, directoryPath)` and builds
file, directed-road, focused-road and parcel overlays through its existing
bounded instance upload. Before this slice, `RealmSourceCityPreview.selectFile()`
passed only the file path; `RealmSourceCityEditorControls.js` shows captured file facts
and the total import count, but not the connection or directory controls.
Do not rebuild these models, the roads, or the renderer to close that UI gap.

The approved build has five pieces, in dependency order:

1. **[NEW/MODIFY] Flat captured-inspection display.** Add one display-only peer
   alongside `RealmSourceCityEditorControls.js`, reusing both production models.
   Show incoming/outgoing endpoints, captured import specifiers, directory
   parent/children, captured totals and member files with text direction cues.
   Bind the display to the original admitted scene; never fetch or discover files.
   Keep appearance editing with EditorControls and persistence with its owner.
   Report bounded projection rejection without logging captured source contents.

2. **[MODIFY] Preview-owned selection serialization.** Extend the existing
   `RealmSourceCityPreview` selection path to reconcile file, relation and
   directory together before `renderer.updateSelection(path, relationId, directoryPath)`.
   Only `active.selectionTail` serializes uploads; retain owner/current-scene
   checks before and after them, and do not bypass renderer coalescing safeguards.
   Separate requested, uploaded and submitted state; extend submitted-frame
   scalar evidence if reporting road/scope visibility, never relabel an old frame.
   Preserve first-person pose, submitted-camera picking and inhabitant exclusion.

3. **[MODIFY] Panel-owned action routing and settlement.** Compose the display
   in `RealmSourceCityPanel.js`; reuse `_assertReady`, `_capture`, `_current`,
   `_selectionSerial`, `_selectionPending` and `_previewChanged` for every action.
   Panel validates the captured document and publishes only current settlement;
   Preview owns the upload queue, and the display owns no second queue or store.
   Add Trace, Show all connections, Inspect endpoint, directory and All actions.
   Recover displayed selection from accepted Preview state after rejection;
   preserve pending decisions, conflict checks and ordinary Save/Close behavior.

4. **[MODIFY] Current-owner lifetime and local state.** Extend existing Preview
   invalidation/retirement and Panel teardown to erase retired inspection data.
   Reject queued or detached controls after store/scene replacement, suspension,
   close, GPU unavailability or destruction; resume/reopen starts unselected.
   Keep same-scene metadata rebinding and resize behavior consistent with today.
   Preserve source-sign ownership, hidden-page cleanup and private inhabitant
   label retirement; picking a file must not restore an old inhabitant selection.
   Add no task commands, clocks, semantic edits, publication or network grants.

5. **[MODIFY] Focused acceptance and rollback.** Extend existing model, Preview,
   Panel and actual-app gates rather than introduce a parallel test host.
   Cover reconciliation, serialized rapid actions, invalid membership, stale
   controls, retirement, no-op uploads and original road/parcel byte restoration.
   Verify unchanged camera, document/hash/history, storage writes and task state.
   Obtain submitted-frame-bound visual evidence with readable text direction cues.
   If acceptance fails, withdraw only the new inspector wiring and owned changes;
   preserve existing file selection, source signs, inhabitants and authoring.

#### Selection behavior and acceptance boundary

Reuse the [captured import and directory behavior](source-city-workbench.md#captured-import-tracing).
A focused relation must touch the selected file. Inspecting another endpoint
clears the old focus without moving the camera. Choosing a directory retains a
selected descendant and its focused relation; an unrelated directory clears
both. Selecting a file outside an explicit directory follows its immediate
parent. All captured files removes only directory scope, and the unscoped view
stays unscoped on file selection. Empty file selection clears road tracing.
Do not filter out buildings or reinterpret parcel edges as collision geometry.

Acceptance must distinguish incoming/outgoing traces from a focused trace and
count highlighted parcel edges, not invent a file count from renderer telemetry.
The retained UI must expose direction as text and remain keyboard operable.
Rapid actions must settle to one coherent file/relation/directory tuple; old
owners must neither upload nor publish into successors. Capture the verified
submitted tuple with the corresponding visible frame instead of treating upload
settlement or an older screenshot as presentation evidence. Passing this slice
does not claim full OS boot, live source refresh, file/code disclosure, IPC
traffic, traversal permission, autonomous tasks or Factory execution.

#### Implemented ownership and observable state

`RealmSourceCitySourceInspector.js` is a flat, text-only display peer. It builds
the existing immutable Relations and Directories models once per scene, shows
genuine endpoints/specifiers and captured byte/line totals, and delegates typed
actions to Panel. It performs no fetch, source discovery, GPU operation, task
command or persistence operation. Unchanged frame notifications do not rebuild
its DOM. Focus-only changes preserve relation rows and scroll position.

Preview now exposes `focusRelation()` and `selectDirectory()` beside the existing
`selectFile()`. All three validate against the latest accepted requested tuple
and append one frozen complete tuple to the original `active.selectionTail`.
The renderer's existing bounded upload remains the only selection transfer.
Uploaded file, relation and directory publish together; the renderer carries
those three scalar identities in its actual submitted-frame observation. The
inspector displays that submitted tuple, not the requested or merely uploaded
one. Pending transfers or a frame/upload mismatch disable its controls.

Panel reserves its settlement promise before invoking Preview synchronously.
This both protects reentrant observers and preserves ordering between a Panel
file request and a newer direct inhabitant request in the same JavaScript turn.
Settlement is guarded by the original document/store, Panel lifecycle generation,
Preview generation and selection serial. A native directory change first captures
the requested option, then restores the submitted option until a matching frame
arrives. A pending or rejected request cannot masquerade as the displayed scope.

Retirement clears the complete tuple, submitted frame and captured display.
Aborted listeners, exact scene/epoch checks and connected-node checks fence old
buttons; retained detached nodes lose their text, values and identity attributes.
Source actions exclude the prior selected inhabitant but do not stop, command,
enable or persist simulation/tasks. Selecting an inhabitant clears file/road
selection through the same queue and can retain an explicit directory scope.
The camera remains first person and unchanged by source inspection.

The new actual-app gate has 11 cases and reuses the genuine factory, encrypted
sandbox and native renderer. It covers model/packet agreement, incoming/outgoing
focus, endpoint navigation, directory reconciliation, no-op upload counts,
unchanged camera/head/tasks and zero observed conditional storage writes, rapid
and reentrant tuples, mixed file/inhabitant ordering, invalid membership,
replacement/suspension, stale DOM and terminal host retirement. The native
walkthrough uses trusted pointer/keyboard input, observes all public sandbox
mutation routes without replacing their implementation, and reuses viewport-only
capture and genuine teardown. Final acceptance follows.

#### Inspector acceptance and retained evidence

All **99 current browser cases** pass: source inspector 11, existing inhabitant
inspection 14, Modeler Preview 18, Modeler Panel 18, Relations 18 and Directories
20. There are no failures, skips, blocked cases, browser errors or denied routes.
The six focused Python suites pass **119/119**. Their new assertions also pin
native-input routing, viewport capture, original-owner retirement and mutation
observer restoration. Native walkthroughs and historical/repeated gates are
not added to the 99-case total.

Receipts below are under `C:/Users/btspa/AppData/Local/Temp/`. Every named run has
stable before/after source bindings and matching served source bytes. Generated
driver/page and static-inventory routes are recorded separately, not invented
on-disk source bindings.

| Receipt directory | Coverage | Source bindings / served routes | Receipt SHA-256 |
| --- | --- | --- | --- |
| `virtual-realm-source-city-source-inspection-xghd7z7i` | Inspector 11 | 1,430 / 1,383 | `a805fe3b917393a4d108787bae667d0269e43d611d4fe17b4c8dd3647fd84a1a` |
| `virtual-realm-source-city-inhabitant-inspection-45cj890r` | Inhabitant 14 | 1,429 / 1,383 | `63ca4b436d957f0148078f7966e7a5ca126c91bb1cc98776f7898dbda5215b31` |
| `virtual-realm-source-city-inspector-regressions-g8_faojv` | Preview 18 + Panel 18 | 951 / 930 | `25e221a8ff026b3d5430436952d67377f19a82add432fef7ae40f55b502caec4` |
| `virtual-realm-source-city-inspector-models-r65n2fs6` | Relations 18 + Directories 20 | 50 / 33 | `d4b3b4cbb1f117c1d52e474b112a04c1794ae4b7ce79f4d06414705a3cc08740` |
| `virtual-realm-source-city-source-inspection-native-n1hhk0b_` | Separate trusted-input walkthrough | 1,435 / 1,385 | `94172fc3276e77b1f6c8efbc287d3cf1cd302395368d16263811a26f6b215a44` |

Each directory contains `receipt.json` and source-binding records. The native
walkthrough clicks the actual captured member, traces the EngineMath.js to
UnitMath.js import, uses reverse-Tab/Enter for Show all, inspects the endpoint,
focuses its incoming relation, chooses `engine/core/math` through the native
directory dropdown, returns to All and clears through the original file control.
All observed action events are trusted. Scope contains three captured files,
48,190 bytes, 1,260 lines and twelve authored parcel edges, not a claim about the
complete live directory. The complete submitted tuple agrees across Preview,
renderer, frame and inspector throughout.

Forwarding observers record **zero calls** to all seven public AppSandbox
mutation routes and its underlying `_commitDataMutation`. Camera pose, document
object/head/hash, undo/redo counts, form values, local simulation/task state and
task controls remain unchanged. The observers restore their original descriptors
before Close. Close legitimately destroys and removes the actual Panel; the QA
driver checks the retained disposed owner, its closed Preview, null current app
panel, absent scene/document and erased detached controls. Full fixture teardown
then reports an absent root, locked operator and zero surfaces, frame producers,
active capability receipts, buffers, textures or native/logger errors.

The final five PNGs are `city-captured-import-focus-canvas.png` and its `-page.png`
sibling, `city-captured-directory-and-import-canvas.png` and its `-page.png`
sibling, and `city-captured-source-inspector.png`. Both canvas images and the
inspector page were visually reviewed: selection/parcel highlights and genuine
source signs are visible; incoming endpoint/specifier text, directory totals
and the three member controls are readable. Canvas and inspector views are
separate genuine viewport captures, not a composite. Their before/after identity,
camera and submitted metadata remain unchanged; PNG hashes are receipt-bound.

Native diagnostic `virtual-realm-source-city-source-inspection-native-vysotar3`
passed all inspection actions and zero-write checks, but its final QA observation
incorrectly dereferenced the current Panel after Close had removed it. Recovery
cleanup passed. The corrected runner retains the original owner only for
observation and never restores a disposed Panel. The passing `n1hhk0b_` receipt
supersedes this diagnostic; production Close behavior was not changed.

The frozen source root is
`C:/Users/btspa/AppData/Local/Temp/virtual-realm-source-inspection-source-daa79504d7c04ad1825105f6d2b5ce61`.
Only individually admitted literal paths were copied. It preserves the prior
unrelated app closure rather than incorporating concurrent construction/physics
edits. All four changed production peers match the accepted frozen copy.
Preview/Panel regressions reuse the existing static-only factory graph; no lazy
vendor import or bundler bootstrap discovery was added. Scoped SPDX, whitespace,
conflict-marker, Python compile and five local plan-link checks pass. Shared
global documentation/API generation remains deferred to admitted-path and
concurrent-ownership boundaries. The final GPU batch exited and released its lock.
First Shard and the user's port-9018 preview remain untouched.

### Passive captured-city map

**Status: approved by the user's subsequent "continue" on 2026-09-26;
implemented and verified in focused browser, Python and native gates.**
The captured source inspector is complete. Its old approval did not authorize
this map; the new continuation approved this separate five-piece proposal.
The visible addition is a passive orientation map inside the existing RealmForge
source-city editor, alongside the first-person preview. It shows the current
captured city's building footprints, submitted observer position and heading,
selected building, and captured directory membership. It cannot move the camera
or command anything. All existing source inspection controls remain authoritative
for selection; the map has no click-to-select or click-to-travel behavior.

This is an extension of the captured-document editor, not the live
owner-private Operations View or acceptance of M2F. The map receives only the
same reviewed capture already compiled for the active app-owned document. It
does not establish local Realm ownership from a source path, scene kind, digest,
DOM state or authenticated account alone. Actual Operations View still requires
the [M2F policy, authority and private-bake gates](m2-runtime-foundation.md#m2f-owner-private-operations-view-and-minimap).
No foreign-city, public-shell or actor input is added to this editor map.

#### Reuse and exact impact boundary

All production paths in this table are relative to
`webgpu-os/apps/realmforge/virtual-realm/` unless stated otherwise.

| Existing source | Reuse and constraint |
| --- | --- |
| `RealmSourceCityGroundGeometry.js`, `projectRealmSourceCityGroundGeometry(scene)` | Reuse validated scene bounds and copied file-building AABBs for X/Z footprints. Roads and parcel marks are not solids. Do not scan source files or derive a second city layout. |
| `RealmSourceCityDirectories.js`, `createRealmSourceCityDirectories(scene).project(path)` | Reuse exact captured descendant membership for directory emphasis. Do not invent a contiguous directory region or an access boundary around scattered buildings. |
| `RealmSourceCityRenderer.js`, `onFrameSubmitted` | Already emits detached position, orientation, camera revision, target generation and the three source-selection identities. No renderer, GPU buffer, surface or frame-producer change is planned. Submission is not proof of GPU completion or display scanout. |
| `RealmSourceCityPreview.js`, `snapshot()` and `onChange()` | Already expose current scene identity, projection currentness, generations and `lastFrame`. Do not use desired navigation pose or requested selection as displayed state. No new Preview API or clock is planned. |
| `RealmSourceCityPanel.js`, `_render()` and `destroy()` | Reuse the existing visible/current-scene gate and lifecycle subscription. Compose and retire the map here, without changing selection ordering, document ownership, Save/Close or actor controls. |
| `engine/core/math/MathQuat.js`, `quatForward()` | Reuse the Engine's camera-forward convention. Project its X/Z components; do not guess heading from quaternion components or screen coordinates. |

`RealmSourceCityWayfinding.js` remains the perspective/occlusion-limited sign
projector. Its visible labels are not the complete captured inventory and must
not be used to populate the map. No equivalent top-down map was found in these
reviewed city peers. The two new paths below were absent at proposal time.
Existing ground, directory, renderer and lifecycle implementations are reused,
not copied into competing owners.

#### Five-piece build blueprint

1. **[NEW] Bounded map projection.** Add the flat peer
   `RealmSourceCityMapProjection.js`. Cache geometry and directory models once
   per exact scene. Produce detached X/Z footprints and a frame-bound observer
   marker using the existing geometry and quaternion functions. Keep aspect
   ratio, label local axes explicitly, and reject invalid pose or membership.
   No DOM, I/O, callbacks, authority, mutable city state or timer belongs here.
2. **[NEW] Passive map display.** Add the flat peer `RealmSourceCityMap.js`.
   Use a bounded inline SVG and a text equivalent, with distinct observer,
   selected-building and directory-member styling that does not rely on color.
   Label it "Captured source layout" and state its limited reviewed inventory.
   Expose only display `update`, `snapshot`, `clear` and `destroy` operations.
   No input actions, links, remote resource references or per-frame live-region
   announcements. Log lifecycle, rejection and rebuild timing, not every frame.
3. **[MODIFY] Existing Panel composition.** Mount the map beside or immediately
   beneath the preview, before long authoring controls; stack on narrow windows.
   Feed the exact current scene and whitelisted submitted fields via `_render()`.
   Cache static geometry separately from changing pose/selection. Clear on
   hidden, suspended, retired, unavailable or mismatched owners; destroy before
   root removal. Preserve pending source selections and first-person input.
4. **[NEW/MODIFY] Focused verification.** Add `source-city-map.test.js`,
   `.main.js` and `.test.html` under `tests/virtual-realm/`, extending the existing
   exact-route runner rather than adding another server. Cover both captures,
   coordinate/heading correctness, submitted selection, retirement and reuse.
   Reuse actual-app fixtures and native input/capture helpers to prove that
   walking updates the map while inspection remains read-only.
5. **[MODIFY] Evidence and handoff.** Record actual focused browser/Python results,
   source bindings and genuine viewport screenshots in this plan and memory.
   Verify same-scene/frame identity around capture, cleanup and unchanged
   document/task state. Preserve the user's port-9018 preview and First Shard
   exclusion. If acceptance fails, withdraw only the new map peers/wiring;
   keep the accepted city, inspector and first-person renderer intact.

#### Display semantics and acceptance

The map uses one stable local X/Z orientation, with positive X to the right and
positive Z toward the top. Uniform scaling preserves building proportions;
letterboxing is preferable to stretching. Include a metric scale, not invented
geographic north. The observer arrow comes from the
submitted quaternion's horizontal forward vector. Missing, invalid or degenerate
pose data makes the map unavailable; it must not display a guessed direction.
Use a concise legend and text position/selection summary. These are captured
building footprints, not the complete PC, a navigation mesh or traversable cells.

Panel must copy only the display fields needed for the submitted pose, selection
and original-owner/frame identity. Do not forward the complete frame record's
inhabitants or destinations to the display. The pure projector's existing scene
input is not a new authority input. Cache static geometry by the exact compiled
scene, never the source capture digest alone: a design edit can change footprints
without changing that digest. Clear the previous scene before publishing its
replacement. Repeated unchanged frames must not rebuild static DOM or announce
the observer's coordinates continuously to assistive technology.

The current submitted file/directory identities control emphasis. A pending
request cannot move a marker or highlight before the corresponding frame.
Focused import identity remains owned by the accepted inspector and renderer;
this first map does not draw roads. In particular, do not draw straight lines
between import endpoints and misrepresent them as the actual compiled roads.
No new source capture, source text, Matrix glyphs, network traffic, IPC events,
station, permission boundary, actor location or task destination is inferred.

Acceptance must cover both existing 36-file and 40-file captures, negative
coordinates, aspect changes, four cardinal headings and pitched poses. A same-
scene static catalog must not be rebuilt for each frame. Directory selection
emphasizes exactly its captured members without hiding the rest of the city.
Design edits with the same source digest must rebuild the geometry correctly.
Unknown selections, mismatched frame ownership and stale callbacks reject or
clear without mutating the valid successor's display. Hidden-page, minimize,
document replacement, suspension, device failure and close erase retained map
text/geometry/identity attributes. Resume waits for a new current submitted frame.

Actual-app checks must preserve camera behavior, selection queue semantics,
document identity/head/history, form drafts, local simulation and task controls.
Native walking and turning must change the displayed pose in agreement with the
same renderer frame; merely reading the navigation controller is insufficient.
Static directory/file inspection must leave camera and task state unchanged.
Observe zero storage mutation calls caused by map display. The map must allocate
no GPU resources or additional animation loop, and teardown must release its DOM
and references. Reuse viewport-only screenshots with exact before/after identity
checks; do not reintroduce full-page capture's Preview replacement diagnostic.

The two flat map peers and Panel wiring are implemented. Production review
identified and fixed a reentrant Panel render race: an older refresh must not
clear a newer map after the source inspector notifies a callback. Focused browser
and native acceptance now pass; exact evidence is recorded separately from review.
Pointer-lock/input comfort remains a later visible slice, not an unannounced
addition to this scope.

#### Implemented map ownership and data flow

`createRealmSourceCityMapProjection(scene)` returns a frozen `catalog` and
`project(frame)`. The catalog holds copied bounds, file footprints, one padded
X/Z view box and a metric scale. Projection copies exactly nine input fields:
`previewGeneration`, `rendererGeneration`, `frameCount`, `cameraRevision`,
`targetGeneration`, `positionMetres`, `orientationQuaternion`,
`selectedFilePath` and `selectedDirectoryPath`. It adds only its display kind,
observer projection and captured directory member paths. Extra frame fields,
accessors, invalid coordinates, unknown membership and undefined horizontal
heading reject. The compiler and existing Panel own scene admission; this pure
projection is not an ownership credential or a live Realm snapshot.

`RealmSourceCityMap` mounts a passive SVG beneath Preview in the same column.
Its text summary includes actual X/Z position and normalized heading, a metric
scale, selected file and captured directory count. Uniform SVG scaling preserves
proportions. Selected buildings use a thicker filled outline; directory members
use dashed outlines. All buildings remain visible. No pointer/keyboard actions,
links, animation loop, source fetch, actor input or GPU allocation is added.

Panel supplies copied submitted fields behind its existing visible/current-scene
check, additionally excluding closing/closed document owners. `_renderSerial`
prevents an older refresh from publishing after a reentrant child notification.
Map records original generation/frame watermarks and refuses older or conflicting
submissions. Scene replacement rebuilds static geometry; same-scene pose and
selection updates retain SVG building nodes. Identical visual state performs no
DOM update even as the observed frame count advances. Clear scrubs retained SVG
text and attributes, drops catalog/projection references, and keeps only weak
scene identity and numeric stale-frame guards. A cleared map needs a fresh frame
before rebuilding. Destroy also erases its root and removes those guards.

The separate native runner reuses the genuine factory, exact-route server,
trusted input helpers and forwarding storage observers. Walking deliberately
changes pose; all other captured document/form/task invariants remain checked.
Selection and resize must preserve that resulting pose and selection. Dedicated
map captures assert that the complete display is inside the viewport and bind
before/after map identity. Native screenshots and browser gate totals remain
separate evidence categories.

#### Accepted verification and retained evidence

Current focused verification passes **86 unique browser cases**: 25 map,
11 source inspector, 18 Preview, 18 Panel and 14 inhabitant-inspection cases.
The map gate exercises both genuine 36-file and 40-file captures, including
actual-app composition, camera input, exact submitted selection, same-digest
design changes, suspension and host retirement. The reentrant inspector case
uses the real app and forwards the real update before invoking public suspension.
No passing diagnostic or repeated case is added to the total.

Eight focused Python suites pass **128/128**. Six owned Python files compile;
all 12 owned source/test files pass scoped SPDX, whitespace and conflict checks.
The native-runner structural checks also preserve key release, revision
convergence, viewport-only capture and original-owner teardown.

The separate native walkthrough passes genuine ArrowRight, Home and W input.
Turning changes the normalized heading; walking advances the submitted Z pose
from -12 m to approximately -11.1664 m. The map uses that exact renderer frame,
not the navigation request. File and parent-directory selection then preserve
the settled pose. The selected `engine/core/math/EngineMath.js` building and
exactly three captured directory members are highlighted. Geometry rebuild count
remains one through walking, selection and resize. Both 1500-by-1800 and
920-by-1600 viewport checks preserve scene, selection and pose.

All eight observed sandbox mutation routes remain at zero. Saved document head,
history, form drafts, local tasks and simulation state stay unchanged. Clean
Close erases text and attributes from all 83 retained map nodes and removes the
root/catalog/projection. Final app teardown leaves zero surfaces, frame producers,
active capability receipts, buffers and textures; the operator is locked.
Browser, native, cleanup and denied-route error lists are empty.

Two canvas images, their viewport page images and two dedicated map viewport
images are retained. Visual inspection confirms the first-person city, highlighted
building, passive footprint layout, observer arrow, dashed directory membership
and wrapped text at both tested widths. The map deliberately shows the entire
elongated capture without stretching it; it has no pan/zoom controls or roads.
All captures bind unchanged owner/camera/selection/map identity before and after
GPU completion and presentation opportunities. Screenshot timing is not a claim
of measured display scanout.

All receipt paths below are beneath `C:/Users/btspa/AppData/Local/Temp/`.

| Gate | Receipt suffix | SHA-256 |
| --- | --- | --- |
| Map 25/25 | `virtual-realm-source-city-map-ivbzrrav/receipt.json` | `1b817017fbebb9bb038ad7d7b04c916f2021d0ad34e663efbb41cd6b3fb94ffa` |
| Source inspector 11/11 | `virtual-realm-source-city-source-inspection-my1yp45h/receipt.json` | `71bb462a8891aaa36f4fd7471bad3e3e78cf2bf69faa336cb3d2ed05c87d7b6e` |
| Preview and Panel 18+18 | `virtual-realm-source-city-map-regressions-i_aggzka/receipt.json` | `230204082967a8e3955068bff8afc330e87a733bfc1702b010716e0da8c5f2c5` |
| Inhabitant inspection 14/14 | `virtual-realm-source-city-inhabitant-inspection-_c1e1iok/receipt.json` | `6e5e272cf70a3a6d71a3540b243182527ae53d073ea5b9235291fbaad9121152` |
| Native input and six PNGs, separate from case totals | `virtual-realm-source-city-map-native-37rs47jk/receipt.json` | `8353de809faa88dec88d075d3f4cc87b0e9f7279398b6a9b9112add6b666ac4e` |

The accepted source snapshot is
`virtual-realm-map-source-a357780dc9cb4efda54aaf6f2a48fea1` beneath the same
temporary root. It copies individually admitted literal files from the preceding
accepted snapshot and overlays this slice's exact owned paths. It preserves the
accepted unrelated closure, not concurrent construction/physics edits. No broad
repository copy, First Shard scan, bundler bootstrap or CLI discovery occurs.
Before/after bindings and served digests match. All three changed production
files match the current workspace and frozen source. Native evidence binds
1,439 files and 1,387 served routes, including the reviewed generated test entry.

Diagnostic receipts are retained, not counted as acceptance. Map `m4n8qxt6`
compared a later frame against a baseline taken before an awaited storage read;
`pw1irpya` compared initial renderer orientation with the first navigation upload.
The final test takes the exact submitted baseline at the appropriate point,
without epsilon comparisons or weakened production validation. Native `q5ssb1zq`
failed before fixture context initialized and reported a browser-shutdown timeout;
its original cause was masked and is not inferred. Native `95wk7ns_` exposed a
test baseline taken before the last queued walking upload. The final native
runner reuses the existing navigation/renderer convergence rule and also waits
for that revision in `lastFrame` after key release. It preserves original failure
text and traceback before cleanup. Production input and rendering are unchanged.

The GPU jobs have exited and the shared slot has been released to the authorized
RealmForge coordination task. First Shard and the user's port-9018 preview remain
untouched. Scoped plan-link checks replace global discovery regeneration for this
turn; global docs/API generation remains deferred to exact-admission and shared
ownership boundaries. This accepts the five-piece editor map, not M2F, full OS
boot, live provider integration or a complete-PC city. Input comfort was the
next visible proposal; it is now deferred while the original live-city
integration resumes.

### Next proposed slice: optional first-person mouse-look capture

**Status: deferred on 2026-09-26; not implemented.** The user approved this
optional proposal, then asked to return to the original live-city slice.
Implementation was interrupted before any Controls changes. The original
[piece-3 owner/write continuation](m2-runtime-foundation.md#protected-head-observation-and-writer-ownership-decision)
is active again. Mouse-look is not a prerequisite and must not displace that
integration. The accepted source-city editor, inspector and map are preserved.

The following records the proposal as originally reviewed. The user continued after
map acceptance and the general suggestion to improve input comfort. This section
defines the previously unspecified cursor-capture behavior before its build
approval. No production source, runtime gate, browser setting or local preview
changes as part of this planning step. Historical map acceptance remains intact.

The visible change is an explicit **Enable mouse look** button inside the
existing RealmForge city Preview. After a successful browser pointer lock, moving
the mouse looks around without holding a button or reaching the screen edge.
Escape returns the pointer to normal use. Default click-to-inspect, drag-to-look,
WASD, arrows, Home and keyboard inspection remain available when unlocked.
Capture is optional and starts off; opening, resuming or clicking the city itself
must not silently capture the pointer. This is not a camera-mode switch.

#### Current code and reuse boundary

`RealmSourceCityControls.js` currently owns canvas-focused key input, sticky
drag-versus-click classification, pointer capture during drag, focus/visibility
cleanup and `tick`, `suspend`, `close`. `RealmSourceCityNavigation.js` already
provides bounded `lookBy`, collision-resolved `step` and entrance `reset`.
Retain its four-metres-per-second walk, eye height, pitch/delta limits and current
mouse sensitivity. No sprint, flight, smoothing, rebinding, inversion setting,
gamepad, touch-look or persistent preference is included in this first slice.

`RealmSourceCityPreview.js` creates one Controls owner per fresh canvas. Its
`_invalidate` and `_retire` close that owner, while `_tick` forwards navigation
through the existing Renderer. Reuse these hooks for ownership and retirement.
The standalone workbench calls the same Controls through a compatibility export;
an opt-in option must preserve that caller's current behavior without editing or
reloading the user's port-9018 page.

The Engine's `engine/tools/input/StandardInputController.js` has private
`exitOwnedPointerLock` and `createLegacyPointerLockWatch` helpers. Its public
`attachInputListeners` also owns global keys, right-button hold-to-look, zoom,
editing and camera-mode callbacks. It is not a compatible replacement for the
city's focused input owner. Do not attach it wholesale, copy its controller or
change its other consumers. Extend the existing city Controls and reuse its
navigation methods rather than create another camera/input subsystem.

The [W3C Pointer Lock specification](https://w3c.github.io/pointerlock/) separates
asynchronous lock requests, observed ownership and relative mouse movement.
Request acceptance is not proof of an active lock. Browser policy can reject a
request, and a user exit must remain available. The implementation must observe
the real owning canvas and must not change browser permissions, iframe policy,
fullscreen or keyboard-lock behavior to obtain capture.

#### Five-piece build blueprint

1. **[MODIFY] Existing Controls ownership.** Extend
   `webgpu-os/apps/realmforge/virtual-realm/RealmSourceCityControls.js` with opt-in
   request/release and a detached input-status snapshot. Keep default callers
   unchanged. Publish pending ownership before diagnostics/callbacks; confirm
   acquisition from the browser. Log request, acquired, released, rejected and
   closed transitions, including settlement duration, never every mouse event.
2. **[MODIFY] Existing Preview UI.** Extend
   `webgpu-os/apps/realmforge/virtual-realm/RealmSourceCityPreview.js` with the
   explicit button, accessible state text and Escape instructions. In its trusted
   activation handler, synchronously focus the current canvas, recheck owner and
   visibility, then request before any await. Gate on the actual current,
   visible, focused, presenting canvas. Reuse its AbortController and owner
   lifecycle; never auto-recapture on resume or change document/actor state.
3. **[MODIFY] Input and inspection routing.** In the same two peers, send one
   relative-mouse event stream through existing `navigation.lookBy`; exclude the
   unlocked drag path while locked. Reuse center picking for locked click/Enter.
   Preserve unlocked drag thresholds, pointer picking and keyboard behavior.
   Release only the exact owned lock and clear held keys/deltas on every exit.
4. **[NEW/MODIFY] Focused gates and native evidence.** Add a bounded
   `source-city-input` browser gate and matching Python/native runners under
   `tests/virtual-realm/`, reusing the existing exact-route app fixtures and
   transport. Cover ownership races, fallback and unchanged default controls.
   Verify real capture, relative motion, Escape, submitted map/camera agreement,
   read-only document state and complete teardown; no substituted DOM authority.
5. **[MODIFY] Evidence and handoff.** Record actual results, source bindings,
   screenshots and limitations in this plan and session memory. Re-run relevant
   Navigation, Preview/Panel, source-inspector and map regressions under the shared
   test lock. If acceptance fails, withdraw only this optional input extension;
   preserve the accepted city, map, captured inspector and default controls.

#### Required ownership and fallback behavior

The proposed state must distinguish unlocked, requesting, actually locked,
unavailable and closed. Status cannot infer capture from a resolved promise,
requested flag, hidden CSS cursor or a synthetic event. Check the original canvas
and current Preview after every asynchronous settlement and reentrant callback.
Another canvas's lock must neither be acquired over nor released by city cleanup.

Escape may be consumed by the browser without a canvas keydown. The browser's
lock-change event must therefore clear held keys, drag state and input timestamps.
Canvas/window blur, hidden page, disabled/currentness loss, suspension, head or
scene replacement, GPU unavailability and close must stop input and release the
owned lock without waiting for another animation frame. Resumption stays unlocked.
A late success for a retired request must not restore its UI/input or release a
successor's lock. Fresh canvases per Preview are retained; do not reuse a retired
canvas as the identity of a replacement.

Promise-returning and legacy event-only requests need explicit lifecycle
handling. Do not abort all observers while an outstanding request can still
acquire. A timeout is not proof that the browser cannot acquire later. Freeze the
supported-browser behavior from genuine observations during implementation;
unsupported capture must produce a nonfatal status and retain normal controls,
not weaken teardown or silently add automatic retries. A denied input request
must not be reported as GPU failure or retire an otherwise valid city.

No raw/unadjusted-movement request, global keyboard capture, automatic pointer
lock, fullscreen, mouse-speed setting, storage permission or live Realm authority
is added. Retain existing focus ownership so typing in fields cannot move the
camera. The map still follows actual submitted pose; capture state does not grant
filesystem access, actor admission, network traversal or Operations View access.

#### Verification route and acceptance limits

Reuse the sticky drag/click structural checks in
`tests/virtual-realm/test_source_city_workbench.py`, the native keyboard/drag/focus
walkthrough in `run_source_city_workbench.py`, genuine factory/Preview fixtures
in `tests/realmforge/source-city-modeler-preview.test.js`, and the submitted-camera
convergence, forwarding mutation counters, viewport captures and cleanup rules in
`tests/virtual-realm/run_source_city_map_native.py`. Extend their existing runners
or focused wrappers, not a second server or a new Renderer.

The current native factory runner launches headless Chrome. Genuine pointer-lock
support in that configuration is **not yet verified**. The positive test must
observe `document.pointerLockElement` equal to the real canvas, actual lock-change
events and trusted relative movement changing the submitted frame. Synthetic
events may exercise validation but cannot establish browser capture. A replaced
DOM property, fake request result or delayed promise alone cannot certify a
browser ownership race.

For pending-request retirement, initiate the real request from trusted input,
then synchronously retire the actual Preview and record request/retirement/lock
event order. Observe eventual release and unchanged successor state. Check a
foreign canvas separately. Release every pressed key and genuine owned lock in
test cleanup even when assertions fail. The native final state must include no
owned pointer lock, live controls/listeners, surfaces, frame producers or GPU
allocations; saved head and all eight observed storage mutation counts stay
unchanged. Actual late acquisition must not be claimed if only an already-owned
lock was observed before retirement.

If the available native harness cannot genuinely acquire or release a lock, keep
that acceptance gap explicit and request an interactive verification route.
Do not alter headless flags, fake capture or count skipped cases as passing.
The proposed scope adds only browser interaction, not a new OS capability or
versioned runtime lease. M0-M1C, B4H/full-provider, M2E/M2F and live multiplayer
remain their existing independent gates. First Shard and port-9018 stay excluded.

### Remaining world and NPC gates

The implemented local task owner adds operator-issued durable movement over the
two measured local bodies. Its focused acceptance does not satisfy live actor
host admission, remote-world permissions or autonomous behavior. The existing
`RealmProgramActorRuntime`, shared NPC engine/SDK,
`RealmEngineAdapter` denials, M1C/B4H/full-provider gates and sixteen app
dependencies are unchanged. Networking, remote-city access, autonomous tasks,
general world effects and Factory execution remain outside this local slice.

## See also

- [Current source-city workbench and evidence](source-city-workbench.md)
- [Virtual Realm implementation roadmap](implementation-roadmap.md)
- [Existing runtime foundation and provider ledger](m2-runtime-foundation.md)
