// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Workspace.js — Virtual desktop for panels.
 *
 * Architecture:
 * - Virtual desktop that holds an ordered list of panels
 * - DOM layer that sits over WebGPU canvas
 * - LayoutEngine for panel arrangement (fullscreen/float/split/tile)
 * - WorkspaceManager handles switching between workspaces via CSS transitions
 *
 * Lifecycle:
 * - mount(container): Creates DOM layer and mounts panels
 * - activate(): Shows workspace (opacity 1, pointer-events auto)
 * - deactivate(): Hides workspace (opacity 0, pointer-events none)
 * - CSS transitions for smooth workspace switching
 *
 * Panel management:
 * - addPanel(): Adds panel to workspace and mounts it
 * - removePanel(): Removes panel from workspace
 * - Layout applied automatically on mount and resize
 */

import { LayoutEngine, LayoutMode } from './PanelLayout.js';

let _workspaceSequence = 0;

function _newWorkspaceId() {
    return `workspace-${Date.now()}-${++_workspaceSequence}`;
}

/**
 * Workspace - Virtual desktop container.
 *
 * Virtual desktop pattern:
 * - Each workspace is a separate DOM layer
 * - Workspaces are stacked with CSS z-index
 * - Only one workspace active/visible at a time
 * - CSS opacity transitions for smooth switching
 * - Panels are mounted into workspace DOM layer
 */
export class Workspace {
    /**
     * @param {Object} options
     * @param {string} [options.id]
     * @param {string} [options.name='Workspace']
     * @param {string} [options.layout='float']
     */
    constructor(options = {}) {
        this.id      = options.id      || _newWorkspaceId();
        this.name    = options.name    || 'Workspace';
        this._layout = new LayoutEngine();
        this._layout.setMode(options.layout || 'float');

        this.panels    = [];
        this.element   = null;
        this._mounted  = false;
        this._observers = new Set();
    }

    get layout() { return this._layout; }
    get layoutMode() { return this._layout.mode; }

    setLayoutMode(mode) {
        this._layout.setMode(mode);
        this._applyLayout();
    }

    /**
     * Mount workspace into container element.
     *
     * Mounting pattern:
     * - Creates absolute-positioned DOM layer
     * - Sets up CSS transitions for smooth switching
     * - Mounts all panels into the workspace layer
     * - Applies initial layout
     * - Sets up resize handler for layout re-application
     *
     * CSS properties:
     * - opacity: 0 initially (activated via activate())
     * - pointer-events: none initially (enabled via activate())
     * - willChange: opacity, transform for GPU acceleration
     */
    mount(container) {
        if (this._mounted) return;
        this._mounted = true;

        const el = document.createElement('div');
        el.id = `plauna-workspace-${this.id}`;
        el.className = 'plauna-workspace';
        el.setAttribute('data-workspace-id', this.id);
        Object.assign(el.style, {
            position:   'absolute',
            inset:      '0',
            overflow:   'hidden',
            background: 'transparent',
            transition: 'opacity 250ms ease, transform 250ms ease',
            opacity:    '0',
            pointerEvents: 'none',
            willChange: 'opacity, transform',
        });

        this.element = el;
        container.appendChild(el);

        // Mount all panels
        this.panels.forEach(p => p.mount(el));

        // Apply initial layout
        requestAnimationFrame(() => this._applyLayout());

        // Re-apply layout on window resize
        this._resizeHandler = () => this._applyLayout();
        window.addEventListener('resize', this._resizeHandler);

        this._emit('mounted', this);
    }

    /**
     * Activate workspace (make visible and interactive).
     *
     * Activation pattern:
     * - Sets opacity to 1 for visibility
     * - Enables pointer-events for interaction
     * - Applies translateZ(0) for GPU layer promotion
     * - Emits 'activated' event for observers
     */
    activate() {
        if (!this.element) return;
        this.element.style.opacity = '1';
        this.element.style.pointerEvents = 'auto';
        this.element.style.transform = 'translateZ(0)';
        this._emit('activated', this);
    }

    /**
     * Deactivate workspace (hide and disable interaction).
     *
     * Deactivation pattern:
     * - Sets opacity to 0 for invisibility
     * - Disables pointer-events to prevent interaction
     * - Applies translateZ(-20px) for depth effect
     * - Emits 'deactivated' event for observers
     */
    deactivate() {
        if (!this.element) return;
        this.element.style.opacity = '0';
        this.element.style.pointerEvents = 'none';
        this.element.style.transform = 'translateZ(-20px)';
        this._emit('deactivated', this);
    }

    /**
     * Add a panel to this workspace.
     * @param {Panel} panel
     */
    addPanel(panel) {
        if (this.panels.includes(panel)) return;
        this.panels.push(panel);
        if (this._mounted && this.element) panel.mount(this.element);
        this._applyLayout();
        this._emit('panel-added', { workspace: this, panel });
    }

    /**
     * Remove a panel from this workspace.
     * @param {Panel} panel
     */
    removePanel(panel) {
        const idx = this.panels.indexOf(panel);
        if (idx === -1) return;
        this.panels.splice(idx, 1);
        panel.destroy();
        this._applyLayout();
        this._emit('panel-removed', { workspace: this, panel });
    }

    /**
     * Remove all panels.
     */
    clearPanels() {
        this.panels.forEach(p => p.destroy());
        this.panels = [];
        this._applyLayout();
        this._emit('panels-cleared', this);
    }

    /**
     * Get the currently focused panel (if any).
     */
    getFocusedPanel() {
        return this.panels.find(p => p.focused);
    }

    /**
     * Destroy this workspace and all its panels.
     */
    destroy() {
        window.removeEventListener('resize', this._resizeHandler);
        this.panels.forEach(p => p.destroy());
        this.panels = [];
        this.element?.remove();
        this.element = null;
        this._mounted = false;
        this._observers.clear();
    }

    // ── Private ─────────────────────────────────────────────────────────────

    _applyLayout() {
        if (!this.element || !this._mounted) return;
        const rect = this.element.getBoundingClientRect();
        this._layout.apply(this.panels, { width: rect.width, height: rect.height });
    }

    on(event, fn) {
        const entry = { event, fn };
        this._observers.add(entry);
        return () => this._observers.delete(entry);
    }

    _emit(event, data) {
        for (const entry of this._observers) {
            if (entry.event === event) {
                try { entry.fn(data); } catch { /* ignore */ }
            }
        }
    }

    toJSON() {
        return {
            id:          this.id,
            name:        this.name,
            layoutMode:  this.layoutMode,
            panelCount:  this.panels.length,
            panels:      this.panels.map(p => p.toJSON()),
        };
    }
}
