---
title: AI Echo Clicks and Clankers
description: Clean-room WebMCP discovery, verified semantic browser control, approval, receipts, and state synchronization for AI Echo.
updated: 2026-07-27
---

# AI Echo Clicks and Clankers

AI Echo supports a hybrid browser workflow. A person can keep using the visible
page, while the Navi can discover typed page actions or perform bounded semantic
controls through the WebGPU OS browser extension. WebMCP is the preferred path.
Semantic inspection and exact target actions are the fallback.

The implementation does not use Playwright, copy browser-agent source, evade bot
controls, export browser credentials, or expose an unrestricted JavaScript,
mouse, keyboard, or Chrome DevTools channel to a model. (Sources:
`webgpu-os/browser-extension/services/WebMCPBridgeRuntime.js` and
`webgpu-os/browser-extension/services/SemanticAutomationRuntime.js`.)

## Capability ladder

AI Echo chooses the narrowest available capability:

1. Discover a same-origin page tool with `browser.webmcp.discover`.
2. Review its untrusted name, description, input schema, annotations, origin,
   and exact descriptor hash.
3. Invoke that exact descriptor with `browser.webmcp.invoke` after one-use
   approval.
4. Use semantic snapshot, extract, focus, hover, scroll, click, type, bounded
   key, wait, and verify controls when the page exposes no suitable tool.
5. Use Live Patch only for a declared, reversible interface edit.
6. Keep raw browser JavaScript behind explicit developer mode and exact-hash
   approval.

The extension feature-detects the current `document.modelContext` API. It keeps
the older navigator location as a temporary compatibility branch. WebMCP remains
an experimental Community Group draft, so the browser-specific execution method
stays behind the extension adapter instead of becoming a durable Navi contract.
([WebMCP draft](https://webmachinelearning.github.io/webmcp/),
[Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api).)

## Discovery and invocation

Page-provided tools are untrusted resources. They do not enter the kernel tool
registry and their annotations never grant authority. Discovery applies strict
limits to tool count, text, schemas, JSON depth, and bridge bytes. It excludes
cross-origin tools and removes credentials from projected URLs.

Each descriptor hash covers the tool name, title, description, input schema,
origin, and annotations. Invocation performs a fresh discovery and requires one
exact matching name and descriptor hash. The extension binds the approval to the
tab, frame, Chrome document ID, origin, descriptor, and canonical argument hash.
A navigation, ambiguous tool, changed schema, changed metadata, expired grant,
or different arguments fails before dispatch. (Sources:
`webgpu-os/browser-extension/services/InjectionService.js` and
`webgpu-os/browser-bridge/BrowserBridgeClient.js`.)

The runtime redacts likely credentials and bounds returned JSON. AI Echo records
the result as untrusted. A timeout after invocation begins becomes
`outcome-unknown`; the task must inspect page or domain state before any retry.
(Sources: `webgpu-os/browser-extension/services/WebMCPBridgeRuntime.js` and
`webgpu-os/apps/ai-echo/AgentToolset.js`.)

## Semantic control

The semantic fallback exposes no raw screen coordinates. It identifies visible
targets by a selector or a bounded page-derived fingerprint. Click and hover
require a successful viewport hit test. Password fields, forms containing a
password, and credential, private, restricted, or system-secret surfaces remain
blocked.

Keyboard control accepts only navigation and control keys. Text entry uses the
separate typed-field operation. Every mutation returns target evidence, and AI
Echo performs an independent readback before recording success. Synthetic hover
and key events are marked `trustedInput: false`; the UI never represents them as
hardware input. (Source:
`webgpu-os/browser-extension/services/SemanticAutomationRuntime.js`.)

## React and stateful application synchronization

The application store remains canonical. The DOM and React tree are projections.
A WebMCP tool should read the latest store snapshot when execution begins, apply
one domain command, wait for the commit, and return the committed revision. It
should not close over render-time state.

```javascript
function registerCartTools(store, signal) {
  document.modelContext.registerTool({
    name: 'cart.setQuantity',
    description: 'Set one cart line quantity.',
    inputSchema: {
      type: 'object',
      properties: {
        lineId: { type: 'string' },
        quantity: { type: 'integer', minimum: 0 },
        expectedRevision: { type: 'integer', minimum: 0 },
        operationId: { type: 'string' }
      },
      required: ['lineId', 'quantity', 'expectedRevision', 'operationId'],
      additionalProperties: false
    },
    execute: async (input) => {
      const before = store.getSnapshot();
      if (before.revision !== input.expectedRevision) {
        return { ok: false, conflict: true, revision: before.revision };
      }
      const receipt = await store.dispatchAndWait({
        type: 'cart/setQuantity',
        lineId: input.lineId,
        quantity: input.quantity,
        operationId: input.operationId
      });
      return { ok: true, revision: store.getSnapshot().revision, receipt };
    }
  }, { signal });
}

function CartAgentTools({ store }) {
  React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  React.useEffect(() => {
    const controller = new AbortController();
    registerCartTools(store, controller.signal);
    return () => controller.abort();
  }, [store]);
  return null;
}
```

Use a stable store facade so React Strict Mode can register, clean up, and
register again without duplicating commands. Treat `toolchange` as an
invalidation notice and run a complete discovery again. An operation ID makes a
retry idempotent, while `expectedRevision` detects simultaneous human edits.
([React `useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore),
[React `useEffect`](https://react.dev/reference/react/useEffect).)

## Security boundary

- WebMCP discovery is same-origin only.
- Tool descriptions, schemas, page text, and results are prompt-injection
  surfaces.
- Read-only annotations are hints. Local ToolRouter policy remains authoritative.
- Every invocation uses mutation-grade review and one-use approval.
- Extension approval UI shows the exact tool, descriptor hash, argument hash,
  origin, tab, frame, and document.
- No default `debugger` permission is requested. Chrome makes that permission
  broad and non-optional, so hardware-level CDP input is not part of this
  Faculty. ([Chrome Debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger).)
- Raw JavaScript remains a separate developer-only Faculty.

## See also

- [AI Echo Live Patch](ai-echo-live-patch.md)
- [Navi Architecture and Delivery](navi-architecture-and-delivery.md)
- [Security and Trust Model](../concepts/security-model.md)
- [Chrome secure WebMCP tools](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- [WebMCP and server-side MCP](https://developer.chrome.com/docs/ai/webmcp/compare-mcp)
