---
title: Shared App UI
description: Theme-aware factory app surfaces, section headers, status badges, toolbar subtitles, and accessible integration without replacing app layouts.
updated: 2026-09-08
---

<!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha -->

# Shared App UI

The factory SDK provides the shared visual foundation for OS app windows. App authors use its surfaces, controls, headings, and status components while retaining each app's navigation, editor, canvas, layout, and resource lifecycle.

Source: `webgpu-os/factory/sdk/ui/index.js`, `tokens.js`, `styles.js`, and `components.js`.

## Initialize the mounted surface

Import the UI barrel and call `ui.ensureUI(container)` at mount time. It installs design tokens and component styles in the container's document or ShadowRoot. Injection is idempotent by style-tag presence, so a rebuilt ShadowRoot can receive the styles again. `ui.scope(node)` adds `fx-scope`; `ui.appShell()` already includes that scope.

Use `ui.injectAppCss(container, id, css)` for existing app-specific styles. It installs or updates the named stylesheet in the same root. Keep layout and interaction rules local to the app. The SDK import does not mount an app or start a compute runtime.

```javascript
import * as ui from '/webgpu-os/factory/sdk/ui/index.js';

export function mountWorkspace(container) {
    ui.ensureUI(container);
    const shell = ui.appShell({
        toolbar: ui.toolbar({ title: 'Workspace', subtitle: 'Documents and analysis' }),
    });
    shell.body.append(ui.card([
        ui.sectionHeader({
            eyebrow: 'Workspace', title: 'Documents',
            description: 'Choose a document to inspect its contents.',
        }),
        ui.emptyState({ hint: 'No document is selected.' }),
    ]));
    container.append(shell.root);
    return () => shell.root.remove();
}
```

This example owns only its DOM. An app with subscriptions, workers, timers, or pending syscalls must retain its existing teardown for those resources.

Source: `webgpu-os/factory/sdk/ui/index.js::ensureUI`, `injectAppCss`, `scope`, and `components.js::appShell`.

## Apply shared appearance to an existing layout

Three classes apply the common app appearance without introducing a layout model. They do not set `display`, dimensions, scrolling, flex/grid placement, or positioning. Add them to existing app elements after installing the SDK styles and providing an `fx-scope` ancestor.

| Class | Appearance | App responsibility |
| --- | --- | --- |
| `fx-workspace` | Theme background with subtle accent and dot decoration | Workspace dimensions, layout, scrolling, and content |
| `fx-panel` | Raised surface, thin accent-tinted border, rounded corners, faint grid, and shadow | Panel layout and padding |
| `fx-chrome-bar` | Theme surface, accent wash, border color, and bounded backdrop blur | Toolbar or header layout, spacing, and border placement |

The composed `fx-shell`, `fx-card`, and `fx-toolbar` components share these appearance rules and add their own layout behavior. For example, `fx-card` supplies padding while `fx-panel` leaves padding to its caller. Apps with existing canvas, terminal, media, or editor layouts can use the appearance classes without adopting `appShell()`.

Source: `webgpu-os/factory/sdk/ui/styles.js` surface and app-shell rules.

## Headings and toolbar identity

`sectionHeader({ eyebrow = '', title = '', description = '', meta = null })` returns a header containing an optional eyebrow, an `h2` title, optional description, and optional metadata. `meta` accepts text or a DOM node, including a status badge. Text wraps within narrow panels. Use the heading level in an appropriate page hierarchy; the component always creates an `h2`.

`toolbar({ title, icon, subtitle = '', start = [], end = [] })` returns the existing toolbar with optional secondary text beneath the title. Omitting `subtitle` retains the original title rendering. `start` and `end` contain controls or other nodes. A subtitle describes the app or current workspace; it does not replace the controls' accessible labels.

Source: `webgpu-os/factory/sdk/ui/components.js::sectionHeader` and `toolbar`.

## Explicit status text

`statusBadge(label = '', { state = 'unknown', detail = '', value = null })` returns a visible label and state. Its `aria-label` includes both and the optional detail; detail also appears as the tooltip. The component does not probe capabilities or infer state from color. The optional `value` supplies context-specific text, such as **Browser Supported** or **Acceleration On**, while `state` retains the semantic styling.

| State | Visible state text |
| --- | --- |
| `available` | Available |
| `unavailable` | Unavailable |
| `unknown` | Unknown |
| `disabled` | Disabled |
| `denied` | Not permitted |
| `missing` | Not deployed |
| `checking` | Checking |
| `error` | Error |

An unrecognized state becomes `unknown` and discards a custom value. Choose a value that accurately describes the supplied state; a label does not establish the underlying capability. For changing progress, the owning view can provide `role="status"` and `aria-live="polite"`. The badge itself is a noninteractive `span`.

The shared `computeStatus(state, { compact })` component applies these distinctions to actual compute reports. Its full layout uses compact backend cards with expandable status facts and one searchable operation catalog. **Browse operations** filters that catalog by backend. Operation disclosures show the reported inputs, precision and result contracts. A backend is ready only when support, deployment and enablement are all explicitly true. The compact layout summarizes platform readiness and the calling app's access. Missing data stays unknown, and inspection-only access is explained without presenting an unrequested permission as a failure.

Use `updateComputeStatus(host, state, options)` when replacing an existing report. It preserves search text and selection, backend filters, expanded details, keyboard focus, and host/ancestor scroll position across a refresh, including in ShadowRoots. `createComputeStatusReader(read, onChange)` supplies `{ report, loading, error, updatedAt }`, coalesces refreshes, retains the last successful report on transient failure, and suppresses callbacks after disposal. Dispose it when its owning app unmounts. A retained report is visibly marked stale when refresh fails.

System Monitor, GPU Manager, and Control Panel share these components; see [OS Compute Service](compute.md) for permissions, refresh behavior, and the inspection lifecycle. A status component grants no execution authority.

Source: `webgpu-os/factory/sdk/ui/components.js::statusBadge` and `computeStatus.js`.

## System Monitor task manager

System Monitor presents six views: Overview, Processes, Resources, GPU, Compute, and Alerts. Desktop windows use a persistent sidebar. Narrow windows use horizontal navigation and give process details their own view, with a Close action that restores the selected process button. The tab controls support arrow keys, Home, End, and Enter. The default window is 1100 × 740 design pixels; the OS window sizer adapts it to the available desktop.

The layout takes inspiration from [TMOG's task-manager approach](https://tmog.org/): resource history beside application evidence, a distinction between zero and unavailable readings, and actions bound to process instances. Colors identify plotted series, selection, readiness, or explicit threshold warnings. The monitor adds no decorative glow or animated interpolation between measured samples.

### Measurement scope

These readings describe the WebGPU OS browser session, not every process on the host computer:

- Frame cadence is the reciprocal of the reported OS frame rate. The kernel uses up to 60 uncapped frame intervals and refreshes its report at least once per second of received frames. Simulation time steps retain their existing cap. A report carries its own sample timestamp; repeatedly reading it does not make it fresh.
- JavaScript heap usage is used heap divided by the reported heap limit. Allocated heap is labeled separately. These values are not physical RAM or per-app resident memory.
- CPU and per-app memory require fresh, explicitly measured provider metadata. The legacy RAF-count and DOM/shared-heap estimates remain available to compatible callers, but the monitor does not present them as measured usage.
- Network and disk include only app I/O recorded by the OS. Missing instrumentation is unavailable, not zero activity. Real recorded zeroes remain zeroes.
- Compute reports managed jobs, reservations, workers, and retained outputs. GPU limits are device capacities, not current utilization. See [OS Compute Service](compute.md) for execution and ownership contracts.

Histories store timestamps and nullable samples. Charts place samples by elapsed time, preserve gaps, and label their scale. CPU, heap, and frame alerts are threshold policies over available readings; an empty alert list does not establish overall system health. Process details and exports include the reported source, state, and sample timestamp.

### Controls and lifecycle

On a browser origin without an active account, launching an app opens the existing Realm Passport account screen. Choose, create, or import an account there, then launch the app after activation. A locked account is not an account switch: the taskbar and launch messages distinguish missing accounts, initialization, an actual switch, and activation failure. A separate localhost port has its own browser storage, so a preview does not automatically inherit the account from another local address.

The update interval is 0.5, 1, 2, or 5 seconds, with a 1-second default. This control applies to the current monitor session. The former unused persistent refresh setting is no longer advertised. **Pause updates** stops automatic sampling; **Refresh** takes one sample while paused without restarting polling. Hidden or suspended windows stop sampling, and unmount disposes timers, chart work, observers, and pending UI publication. Compute inspection stays lazy and uses the shared metadata reader; explicit Refresh bypasses its ordinary cache interval.

Processes can be filtered and sorted by name, measured CPU, memory bytes, recorded network/disk rates, uptime, and state. Unavailable numeric readings sort last in either direction. Stable instance keys preserve focus through updates and prevent a relaunched app from inheriting selection.

**End** requires confirmation and the existing `os.process.terminate` permission. System Monitor captures `instanceId`, rechecks its own mount and the selected process after confirmation, and calls `terminateProcess(appId, {force: true, expectedInstanceId})`. The kernel rejects a replacement with `PROCESS_INSTANCE_CHANGED` before teardown. Older callers may omit the optional identity field; System Monitor requires it for safe interactive actions.

**Export** downloads JSON with `schemaVersion: 1`, scope `webgpu-os-session`, sampling configuration, the current snapshot, alerts, and timestamped histories. Process records are selected cloneable fields; raw process handles are excluded. Export errors are visible. Blob URLs are released after the download has started or when the monitor unmounts.

Source: `webgpu-os/factory/apps/sysmon/SysMonApp.js`, `styles.js`, `telemetry.js`, `charts.js`, `webgpu-os/kernel/ProcessTable.js`, `KernelBootstrap.js`, `Syscalls.js`, and `webgpu-os/shell/Desktop.js`.

## Theme and accessibility

Semantic `--fx-*` tokens reference the active OS surface, text, accent, font, radius, and animation variables. App code can use `ui.token('accent')`, which returns `var(--fx-accent)`, or use CSS custom properties directly. Theme-derived border and status inks keep the shared appearance responsive to dark and light themes. Avoid hardcoding a separate palette in each app.

The shared stylesheet honors these accessibility settings:

- OS reduced transparency through `.theme-reduce-transparency`, including a ShadowRoot host context, removes workspace/panel decoration and chrome blur. The `prefers-reduced-transparency` media preference applies the same treatment within `fx-scope`.
- `prefers-reduced-motion` removes scoped transitions and reduces scoped animation duration and iteration count.
- Forced colors use system Canvas, CanvasText, Highlight, and HighlightText colors for shared surfaces and selected controls, while removing decorative images, shadows, and blur.
- Buttons retain visible keyboard focus styling. Status badges retain explicit state text, and section titles and metadata can wrap.

These are shared component behaviors, not a substitute for checking the app's own keyboard navigation, labels, focus restoration, content contrast, resizing, and teardown. Preserve controls and hit targets when applying appearance classes.

Source: `webgpu-os/factory/sdk/ui/tokens.js`, `styles.js` accessibility media rules, and `controls.js`.

## See also

- [OS Compute Service](compute.md)
- [OS Architecture](architecture.md)
- [AppForge Contracts](appforge-contracts.md)
- [Getting Started](getting-started.md)
