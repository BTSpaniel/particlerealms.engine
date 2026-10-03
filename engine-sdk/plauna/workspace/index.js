// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * plauna/workspace — Virtual desktop / multi-panel system for Plauna.
 *
 * Exported classes:
 *   - Panel, DOMPanel, GPUPanel
 *   - Workspace
 *   - WorkspaceManager
 *   - WorkspaceCompositor
 *   - WorkspaceSwitcher
 *   - LayoutEngine, LayoutMode
 */

export { Panel, DOMPanel, GPUPanel } from './Panel.js';
export { LayoutEngine, LayoutMode } from './PanelLayout.js';
export { Workspace } from './Workspace.js';
export { WorkspaceCompositor } from './WorkspaceCompositor.js';
export { WorkspaceManager } from './WorkspaceManager.js';
export { WorkspaceSwitcher } from './WorkspaceSwitcher.js';
