---
title: AI Echo Live Patch
description: Clean-room, declarative, reversible live editing for WebGPU OS apps, shell surfaces, AI Echo, and extension-backed browser tabs.
updated: 2026-07-27
---

# AI Echo Live Patch

AI Echo Live Patch lets the resident Navi inspect and update a mounted interface
without rebuilding the OS. It edits registered WebGPU OS app surfaces, selected
shell surfaces, AI Echo itself, and browser tabs exposed by the WebGPU OS browser
extension.

Live Patch is not a raw JavaScript or unrestricted DOM tool. AI Echo proposes a
small versioned document. The kernel validates the document, creates a reversible
preview, verifies the visible result, and writes a receipt before an OS-surface
change becomes durable. (Source: `webgpu-os/kernel/live-patch/LivePatchService.js`.)

## Clean-room research boundary

The public behavior of
[`philholden/partialupdate`](https://github.com/philholden/partialupdate) informed
the product goal: a model can stream partial interface updates into named
regions instead of regenerating the entire application. Its public README shows
named insertion points and describes HTML, CSS, JavaScript, and SVG generation
in a multi-user chat environment. Its public protocol document describes a
streaming server-to-browser update channel. ([Public behavior](https://github.com/philholden/partialupdate/blob/main/README.md#L13-L77),
[public protocol](https://github.com/philholden/partialupdate/blob/main/spec.md#L8-L85).)

The upstream project also states that it is not hardened for production and is
intended for local development. It warns that malicious prompts can create
unbounded model loops and costs. ([Upstream warning](https://github.com/philholden/partialupdate/blob/main/README.md#L83-L94).)

WebGPU OS uses an independent design:

- It does not use upstream source code, prompts, delimiters, WebSocket messages,
  storage records, or client runtime.
- It does not execute model-generated JavaScript, event handlers, scripts, SVG,
  remote styles, or remote media.
- The kernel owns target selection, validation, preview, verification,
  persistence, rollback, and receipts.
- Existing Tool Firewall, capability, Faculty, and approval rules remain in
  force. A generated interface cannot grant itself authority.
- Browser editing uses packaged extension functions. It never sends a provider
  credential or reusable extension authority into the edited page.

The upstream repository is MIT licensed, but Live Patch remains a clean-room
WebGPU OS implementation under the repository's own source-available license.
([Upstream license](https://github.com/philholden/partialupdate/blob/main/LICENSE).)

Chrome's independent declarative-partial-update design likewise separates
scoped declarative updates and sanitization from explicitly unsafe script-capable
paths. Live Patch adopts that security distinction without adopting Chrome's
API or the upstream project runtime. ([Chrome design](https://developer.chrome.com/blog/declarative-partial-updates).)

## Architecture

The kernel service owns one `webgpu-os-live-patch-v1` contract. A complete edit
uses this sequence:

1. `live.surfaces` lists registered targets.
2. `live.inspect` returns a bounded, redacted structural snapshot.
3. `live.stage` validates a strict patch, records its pre-edit inspection, and
   binds the exact normalized operations and target fingerprint into the patch
   hash and approval payload.
4. `live.preview` rechecks the approved fingerprint immediately before applying
   the patch with an in-memory undo journal.
5. The service reads the surface back and verifies every operation.
6. The operator can inspect the visible preview.
7. `live.commit` compare-and-swaps the surface's causal head, then publishes the
   canonical patch and SHA-256 receipt as one compensated transaction.
8. `live.rollback` reverts the active edit, advances the same causal head, and
   records a rollback receipt.

### RealmForge-informed prepared activation

Live Patch adopts RealmForge's offside-prepare and last-good activation pattern
without importing RealmForge documents, scripts, or runtime authority. During
`live.stage`, the kernel treats the normalized operation list as pure input and
compiles a `webgpu-os-live-patch-candidate-v1` evidence record twice. The two
canonical results must be byte-identical. The candidate binds the operation
hash and semantic diff to the exact surface generation, precondition, expected
after-state, parent causal head, next `headRevision`, and browser document epochs
when the target is a browser tab. A remount, changed target, new head, or
non-deterministic compilation invalidates the candidate before activation.

A successful preview produces a hashed
`webgpu-os-live-patch-activation-v1` proof. It binds the staged patch hash,
candidate and operation hashes, surface generation, before-state and expected
and observed after-state hashes, causal base and revision, browser epochs,
verification hash, and preview time. AI Echo returns that immutable projection
as the commit payload. `live.commit` accepts only an exact canonical match to
the still-active verified preview and verifies the visible after-state again.
Changing one operation, selector, value, surface, generation, causal head, or
verification result requires a new stage and preview.

This follows the failure-containment principles used by RealmForge's
deterministic graph compiler, prepared runtime activation, and last-good
retention. Live Patch remains a separate declarative kernel contract. (Sources:
`webgpu-os/apps/realmforge/modeler/system-graph/RealmForgeSystemGraphCompiler.js`,
`webgpu-os/apps/realmforge/modeler/runtime/RealmForgeRuntimeController.js`, and
`webgpu-os/kernel/live-patch/LivePatchService.js`.)

The service rejects a commit unless the same patch has an active verified
preview. A mounted OS app receives committed patches again after remount through
the existing Patch Bus lifecycle. Browser-page patches are scoped to the current
page lifecycle and are not replayed after navigation. (Source:
`webgpu-os/kernel/live-patch/LivePatchService.js`.)

Web Locks serialize mutations to the same surface. A durable per-surface hash
chain adds compare-and-swap protection when different tabs stage different
patch IDs from the same base. Each patch and receipt bind the parent head,
revision, and resulting head. Only the first stale-base commit can advance that
head; later commits must inspect and stage again. BroadcastChannel notices
invalidate colliding local drafts and causal-head events reconcile every latest
patch state in chain order. A recovery launch can add
`?livePatchSafeMode=1` to suppress preview and replay while keeping authorized
rollback available.

## Surface identities

Live Patch accepts only these target forms:

| Surface | Meaning | Persistence |
| --- | --- | --- |
| `app:<appId>` | One mounted WebGPU OS app, including `app:os.ai-echo`. | Restored after app remount. |
| `shell:desktop` | The desktop content surface. | Restored after shell registration. |
| `shell:taskbar` | The taskbar surface. | Restored after shell registration. |
| `browser:<tabId>` | One tab exposed by the extension bridge. | Ends on navigation or tab close. |

Apps should mark durable edit points with a stable region name:

```html
<header data-live-region="header">...</header>
<main data-live-region="content">...</main>
<footer data-live-region="actions">...</footer>
```

AI Echo uses stable regions for its workspace shell, sidebar, conversation,
composer, and Settings surface. Region names survive normal child-layout changes
better than long CSS selectors. The inspector returns a region selector when one
is available. (Source: `webgpu-os/apps/ai-echo/factory.js` and
`webgpu-os/kernel/live-patch/LivePatchService.js`.)

App authors can protect a subtree explicitly:

```html
<section data-live-patch-lock>...</section>
```

The kernel also protects approval, elicitation, credential, password,
permission, private/restricted classifications, enabled `contenteditable`
regions, host inputs, text areas, selects, and other user-data boundaries. A
mutation is denied when its target contains a protected descendant, not only
when the target is protected itself. Nested registered surfaces are isolated
from their parent's inspection and mutation scope.

## Allowed operations

Each patch has an ID, title, rationale, one exact surface ID, and one to 40
operations. Unknown fields and unknown operations fail closed.

| Operation | Effect |
| --- | --- |
| `set-text` | Replace the target's children with plain text. |
| `set-attribute` | Set an allow-listed ARIA, role, title, tab index, or bounded state attribute. |
| `remove-attribute` | Remove one allow-listed attribute. |
| `add-class` | Add one validated class name. |
| `remove-class` | Remove one validated class name. |
| `set-style` | Set one allow-listed local style property with a validated value. |
| `append-markup` | Append sanitized structural markup on OS/app surfaces. Browser surfaces reject it. |
| `replace-content` | Replace children with sanitized structural markup on OS/app surfaces. Browser surfaces reject it. |
| `remove-node` | Remove a non-root, non-protected target on OS/app surfaces. Browser surfaces reject it. |
| `add-css` | Add ordinary, allow-listed CSS rules scoped to the exact surface. |

Every selector stays relative to the registered surface. Selectors cannot name
`html`, `body`, `:root`, a shadow host, or the surface ownership attribute. One
operation can match at most 40 nodes, and one patch can affect at most 160 nodes.
Inspection returns at most 400 projected elements and stops scanning after
1,600 candidates. A mounted OS surface is limited to 6,000 elements and 2 MiB
of reversible state. Text, markup, CSS, selectors, and metadata have independent
byte or character limits. (Source:
`webgpu-os/kernel/live-patch/LivePatchService.js`.)

### Example patch

This example changes one stable header and adds a local control. The control
emits a typed event; it does not call a tool directly.

```json
{
  "id": "live_dashboard_header_01",
  "title": "Clarify dashboard status",
  "rationale": "Put the current state and review action together.",
  "surfaceId": "app:os.dashboard",
  "operations": [
    {
      "op": "set-text",
      "region": "header",
      "text": "System status"
    },
    {
      "op": "append-markup",
      "region": "actions",
      "markup": "<button data-live-event=\"dashboard.review\">Review details</button>"
    }
  ]
}
```

## Markup, CSS, and event safety

On OS and app surfaces, sanitized markup supports structural text, layout, table, disclosure, buttons,
selects, and bounded checkbox, radio, and range controls. It does not accept
free-text fields. The sanitizer drops scripts, styles, frames, objects, embeds,
links, metadata, images, SVG, MathML, audio, video, templates, canvas, inline
handlers, arbitrary URLs, and unsupported attributes.

Generated controls may declare:

- `data-live-event` for a bounded local event name.
- `data-live-field` for a bounded form field name.
- `data-live-payload` for a small JSON value.

Click, change, and submit events enter a 200-entry in-memory event journal. AI
Echo can observe that journal through `live.events`. An event is an observation,
not permission to use a tool, access the network, read a secret, or mutate the
OS. A later action still crosses the normal Faculty and Tool Firewall boundary.
Only trusted user events from controls owned by the currently active OS/app patch are
recorded. Scripted `.click()` calls and synthetic events are rejected, and every
accepted event is explicitly marked `authoritative: false`.

Browser surfaces deliberately reject `append-markup` and `replace-content`.
An extension injected after a page has loaded cannot guarantee that its listener
runs before capture-phase listeners the host page already registered. Claiming
otherwise would create a false event-isolation boundary. Browser patches therefore
remain limited to bounded edits of existing text, attributes, classes, styles,
and scoped CSS. Generated browser controls must live in a separately owned
extension or OS surface rather than the host page DOM.

Live CSS accepts ordinary style rules only. It rejects imports, URLs, executable
legacy CSS, arbitrary at-rules, global selectors, unsupported declarations, and
style markup. Accepted rules are wrapped in a browser `@scope` rooted at the
exact `data-live-patch-surface` token. (Source:
`webgpu-os/kernel/live-patch/LivePatchService.js`.)

## AI Echo tools and approval behavior

AI Echo exposes eight Live Patch tools:

| Tool | Type | Risk behavior |
| --- | --- | --- |
| `live.surfaces` | Read | Lists editable surface projections. |
| `live.inspect` | Sensitive read | Returns bounded, redacted structure only after high-risk approval because rendered content can contain operator data. |
| `live.stage` | Mutation proposal | Validates, hashes, and returns the exact approval payload; it does not change the UI. |
| `live.preview` | Reversible mutation | Applies and verifies an undoable preview; high-risk approval is required because the live DOM changes immediately. |
| `live.commit` | Durable mutation | Requires a verified preview and high-risk approval policy. |
| `live.rollback` | Durable mutation | Reverts and records a high-risk rollback receipt. |
| `live.history` | Read | Lists committed or rolled-back patches. |
| `live.events` | Read | Lists bounded typed generated-control events. |

The descriptors declare application and device authority, data classes,
predicted effects, exact surface or patch parameters, and independent mutation
readback. They run through the same registered tool path as other AI Echo tools.
(Source: `webgpu-os/apps/ai-echo/AgentToolset.js`.)

`live.preview` accepts only the staged patch ID, hash, surface, precondition
fingerprint, and normalized operation list. AI Echo compares the canonical
approval payload byte-for-byte with the kernel's current draft before any DOM
change. Approval cannot be reused after changing a selector, value, surface, or
operation order. A verified preview then returns a separate immutable commit
payload. It includes the preview activation hash, candidate plan, surface
generation, causal base, next revision, and the same normalized operations.
`live.commit` re-reads the kernel preview and rejects any payload that is not an
exact canonical match.

A safe operator request can be direct:

> Inspect the AI Echo composer and make the provider row easier to scan. Show me
> a reversible preview first. Do not commit until I approve it.

For an existing app:

> Find the mounted Paint surface, inspect its toolbar regions, and preview a
> larger mobile-friendly brush control without changing canvas behavior.

## Storage, history, and recovery

Committed records are normal OS files and remain visible through the Files app:

```text
/user/live-patches/
  heads/
    <surface-id-hex>.json
  patches/
    live_<id>.json
  receipts/
    live_receipt_<id>.json
```

The patch record includes its format, version, operations, surface, author
context, lifecycle timestamps, verification result, causal parent/revision, and
hash. The receipt binds the action, patch hash, target, operation count, time,
causal transition, and SHA-256 of the exact stored patch bytes. The receipt and
patch are written before one compare-and-swap head advance publishes the
transition. A failed head advance restores or removes the patch and receipt and
restores the visible projection. Startup rejects a missing, tampered, orphaned,
or headless record. (Source:
`webgpu-os/kernel/live-patch/LivePatchService.js` and
`webgpu-os/storage/StorageManager.js`.)

Rollback preserves the record as `rolled-back` and adds a new receipt. It does
not erase history. The tree is visible to backup and storage-health tooling, but
ordinary app storage syscalls cannot write, move, copy, or delete these
kernel-owned control records.

Transient candidates are bounded before they enter the in-memory draft table:
64 staged patches and 8 MiB in total, with at most eight patches and 2 MiB per
surface. Durable startup and commit paths also enforce record, byte, per-surface,
and causal-head limits before allocating or replaying state. Restart clears
transient candidates; it never treats an unapproved draft as durable authority.

### Causal replay and last-good remount

Startup verifies every stored patch, receipt, and per-surface causal head before
replay. A patch is eligible only when the head authorizes its exact patch hash,
status, parent, `headRevision`, and resulting head hash. Replay orders committed
records by `headRevision`; file names and timestamps never choose the visible
state.

An OS-surface remount is a transactional activation. The service pins the root
and surface generation, removes the current Live Patch projection, reapplies the
authorized sequence, and verifies each patch. If preparation or activation
fails, it removes the partial candidate projection and restores the previous
complete projection. The failed surface enters quarantine while other surfaces
remain available. Global safe mode is reserved for unscoped corruption,
aggregate journal violations, or compensation whose outcome cannot be proven.
This is the DOM-safe counterpart of RealmForge's last-good runtime retention: it
preserves node and listener ownership instead of replacing the entire app root.
(Sources: `webgpu-os/kernel/live-patch/LivePatchService.js`,
`webgpu-os/apps/realmforge/modeler/runtime/RealmForgeRuntimeController.js`, and
`webgpu-os/apps/realmforge/modeler/session/ModelerSession.js`.)

Ordinary `/user` restore is not an authority-import path. Portable archives and
native-folder backups may contain `/user/live-patches/**` or
`/user/preferences/permissions.json` for recovery evidence, but merge and
replace restores skip those entries. Replace mode also preserves the active
copies instead of deleting their parent trees. Backup previews and restore
receipts report the protected entries that were skipped. A dedicated,
kernel-authorized recovery workflow must restore those control records. (Source:
`webgpu-os/storage/StorageManager.js`.)

Recycle Bin restore is also not an authority-import path. Trash metadata uses an
opaque item ID and an exact contained payload location; restore rejects forged
payload paths, root destinations, Recycle Bin destinations, Live Patch records,
and permission records before any overwrite. Ordinary storage syscalls cannot
write the Recycle Bin control tree or supply an unconfined restore destination.

## Browser extension boundary

An OS page cannot safely reach into an arbitrary browser tab by itself. Browser
surfaces therefore require the WebGPU OS browser extension and the extension
bridge.

The kernel sends the already validated, bounded patch to packaged extension
methods. Ordinary browser snapshot/click/type actions also use a packaged typed
semantic runtime instead of generated source strings; raw browser JavaScript is
separate and developer-gated. During staging, the extension hashes the exact matched target state for
every normalized operation and returns a
`webgpu-os-browser-live-target-precondition-v1` proof. The kernel binds that proof
to approval and sends it back with preview. The extension recalculates the proof,
then performs one final synchronous state comparison immediately before the
first mutation. A changed selector result, attribute, text value, node order, or
operation list fails closed.

The extension performs inspection, preview, verification, commit-state tracking,
and rollback inside the exact tab. Inspection is bounded and redacts protected
and restricted subtrees plus form-control values. Snapshot, extraction, wait,
verification, status, and Live Patch history are the only immediate read paths.
Semantic click/type, raw script or CSS, and every browser Live Patch mutation
create a redacted pending request in the extension-owned popup. The OS page
cannot list, approve, deny, mint, or consume grants. The operator approves one
exact action, then AI Echo retries it.

Each grant binds the canonical method and arguments, isolated relay session,
target origin, every target frame and Chrome document ID, and a 90-second
expiry. It is single-use and consumed before dispatch. The extension executes
against those document IDs, so a reload, navigation, frame replacement, changed
argument, or second call fails closed rather than retargeting the approval. The
popup shows hashes, byte counts, semantic action or patch inventory, origin,
and document identities without showing raw JavaScript, CSS, or patch bytes.
Pending approvals are bounded to eight per relay session and 40 globally.

The edited page receives no API key, extension credential store, reusable kernel
token, raw model JavaScript, or general extension API. The kernel requires the
exact protocol and target-proof capability handshake, so an older extension
asks the operator to reload or update instead of falling back to weaker
behavior. This uses Chrome's packaged
[`scripting` API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
and exact `documentIds`; raw JavaScript remains a separate developer-only Chrome
[`userScripts` API](https://developer.chrome.com/docs/extensions/reference/api/userScripts)
facility.

Large AI-only bridge calls use a separately bounded segmented transport. One
request may contain at most 64 MiB and 256 chunks; each session may reserve four
pending requests and the extension may hold 12 globally. Character, UTF-8 byte,
per-session, and global reservation limits are checked before allocation, and
reservations are released on cancellation, expiry, session replacement, tab
teardown, successful commit, or failure. Segmented messages cannot call the
injection service.

Browser patches are intentionally ephemeral across navigation. On invalidation,
the runtime reverses only mutations whose exact patch-owned after-state still
matches. Drifted host content is preserved, extension-owned styles and markers
are removed where ownership is still provable, and the history records
`outcome-unknown`. Removed nodes are never automatically reinserted during
navigation because absence alone cannot prove that the patch still owns the
state. A committed
browser patch still receives a durable OS receipt so the operator can review
what happened, but the kernel does not silently replay it into a different page.
(Source: `webgpu-os/kernel/live-patch/LivePatchService.js`,
`webgpu-os/browser-bridge/BrowserBridgeClient.js`, and the extension
`services/InjectionService.js` files.)

## Limits and non-goals

Live Patch changes the currently rendered interface. It is not a source-code
editor, package signer, deployment system, or substitute for a maintained app
change. Use the normal workspace tools when a change must alter application
source and ship in a package.

Live Patch also does not:

- bypass app permissions, operator approval, Faculty grants, or the Tool
  Firewall;
- inspect or edit cross-origin frames as part of an OS app surface;
- persist a browser-page mutation across navigation;
- insert generated markup into an arbitrary browser page DOM;
- remove a browser-page node whose absence could be confused with navigation;
- expose hidden provider reasoning, credentials, password values, or protected
  approval parameters;
- allow an app or generated control to self-authorize a later mutation;
- promise that a selector remains valid after an app redesign. Stable regions
  are the compatibility contract.

The extension prevents an OS page from authorizing an unapproved page mutation;
it does not make all same-origin page code trustworthy. Read-only bridge
services still rely on the exact configured OS origin, and ordinary
`window.postMessage` results remain page-visible. A fully compromised script on
that origin could forge how a response is presented even though it cannot
approve or consume the extension-owned mutation grant. A future authenticated
response channel would require a separately pinned extension key; Live Patch
does not claim that boundary today.

## Verification

The focused browser suite runs without Node.js or npm:

```bash
python tests/live-patch/run_live_patch_tests.py
```

It covers strict schemas, deterministic candidate compilation, unknown fields,
executable-operation rejection, relative selectors, staged and durable quotas,
aggregate byte/node/depth limits, markup and CSS sanitization, protected
descendants, stable regions, preview activation and exact commit approval,
after-state drift, rollback, single-write commit and receipt persistence,
`headRevision`-authorized restart replay, per-surface tamper quarantine, CAS
failure compensation, DOM/CSS drift, trusted typed local events, scoped CSS,
transactional last-good remount restoration, safe mode, cross-tab invalidation,
rollback lineage, exact browser target proofs, stale-extension rejection, DOM
position restoration, causal-head concurrency, nested-surface isolation,
editable-data redaction, browser runtime epochs, extension structural-overlap
rejection, fail-closed browser generated-DOM rejection, drift-aware SPA
invalidation, exact document-bound one-use approvals, semantic-mutation gating,
bounded pending/replay state, segmented-transport quotas and cleanup, strict
extension sender metadata, and a static check against dynamic JavaScript
execution primitives. The hardened service gate passes 60/60 assertions. AI Echo
integration passes 432/432 smoke assertions, storage boundary recovery passes
11/11, and atomic storage passes 10/10. (Source: `tests/live-patch/`,
`tests/run_ai_echo_smoke.py`, and `tests/storage-backup-boundary.test.js`.)

Real browser-page validation additionally requires the current WebGPU OS
extension loaded in Chrome or Edge.

The cross-tab design follows the browser's same-origin
[`Web Locks`](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) and
[`BroadcastChannel`](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API)
contracts. Generated-control trust checks use
[`Event.isTrusted`](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted),
and the sanitizer follows the principle that untrusted data must remain in safe
DOM/CSS contexts rather than executable contexts described by the
[OWASP DOM XSS guidance](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html).

## See also

- [Navi Architecture and Delivery](navi-architecture-and-delivery.md)
- [WebGPU OS Architecture](architecture.md)
- [Security and Trust Model](../concepts/security-model.md)
- [AppForge Contracts](appforge-contracts.md)
