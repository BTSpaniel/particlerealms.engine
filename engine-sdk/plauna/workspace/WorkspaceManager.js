// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ============================================================================
 * WorkspaceManager - Virtual Desktop Management
 * ============================================================================
 *
 * WorkspaceManager provides a virtual desktop system for Plauna, allowing
 * multiple workspaces with different layouts and panel configurations.
 *
 * WORKSPACE CONCEPT:
 * - A Workspace is a virtual desktop that holds panels
 * - Each workspace can have its own layout mode (fullscreen, float, split, tile)
 * - Workspaces are DOM layers stacked over the canvas
 * - Only one workspace is active/visible at a time
 *
 * PANEL TYPES:
 * - DOMPanel: Wrapper for Plauna widgets (div-based)
 * - GPUPanel: WebGPU texture panel (for GPU-accelerated content)
 *
 * LAYOUT MODES:
 * - fullscreen: One panel fills the entire workspace
 * - float: Draggable, resizable windows with z-order
 * - split: Recursive binary tree layout (like tmux/VS Code)
 * - tile: Auto-arranged grid layout
 *
 * COMPOSITOR:
 * - WorkspaceCompositor blits GPU panel textures to canvas swap chain
 * - Iterates visible GPU panels in z-order
 * - Required for GPU panel support
 *
 * SWITCHER:
 * - WorkspaceSwitcher provides HUD overlay (Ctrl+`)
 * - Shows thumbnails of all workspaces
 * - Keyboard navigation with arrow keys
 * - Enter to switch workspace
 *
 * SINGLE CONSTRAINT:
 * - Only one WebGPU canvas context allowed per page
 * - Only one GPUDevice instance shared across all workspaces
 * - GPU panels share the same device and canvas
 *
 * PUBLIC API:
 * - createWorkspace({ name, layout }): Create new workspace
 * - switchTo(id): Switch active workspace
 * - createPanel(type, options): Create panel in active workspace
 * - list(): List all workspaces
 * - activeWorkspace: Get currently active workspace
 *
 * INITIALIZATION:
 * - Requires: container (DOM element), device (WebGPU), canvas
 * - Optional: format (texture format), logger
 * - Must call initialize() before using
 *
 * KEYBOARD SHORTCUTS:
 * - Ctrl+`: Open workspace switcher
 * - Arrow keys: Navigate switcher
 * - Enter: Switch to selected workspace
 * - Escape: Close switcher
 *
 * USAGE:
 *   const manager = new WorkspaceManager({
 *       container: document.body,
 *       device: gpuDevice,
 *       canvas: canvasElement,
 *       format: 'bgra8unorm'
 *   });
 *   await manager.initialize();
 *   const ws = manager.createWorkspace({ name: 'Main', layout: 'float' });
 *   manager.switchTo(ws.id);
 *   manager.createPanel('dom', { title: 'Panel 1' });
 */

import { Workspace } from './Workspace.js';
import { WorkspaceCompositor } from './WorkspaceCompositor.js';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.js';
import { DOMPanel, GPUPanel } from './Panel.js';
import { PageTransition } from '../motion/PageTransition.js';

export class WorkspaceManager {
    /**
     * @param {Object} options
     * @param {HTMLElement} options.container — DOM element that holds workspace layers
     * @param {GPUDevice} options.device — WebGPU device (for GPU panels)
     * @param {string} [options.format='bgra8unorm']
     * @param {HTMLCanvasElement} options.canvas
     * @param {Function} [options.logger]
     */
    constructor(options) {
        this.container = options.container;
        this.device    = options.device;
        this.format    = options.format || 'bgra8unorm';
        this.canvas    = options.canvas;
        this.logger    = options.logger || { info: console.log, warn: console.warn, error: console.error };

        this.workspaces = new Map();
        this._activeId  = null;
        this._compositor = null;
        this._switcher = null;
        this._initialized = false;
        this._hasSwitched = false;
        this._pageTransition = new PageTransition({
            target: this.container,
            type: 'slide-left',
            duration: 260,
            reducedMotion: true
        });
    }

    get activeWorkspace() {
        return this.workspaces.get(this._activeId);
    }

    /**
     * Initialize the manager.
     *
     * Initialization pattern:
     * - Creates WorkspaceCompositor for GPU panel blitting
     * - Sets up keyboard shortcuts (Ctrl+` for switcher)
     * - Must be called before using the manager
     * - One-time initialization (idempotent)
     */
    async init() {
        if (this._initialized) return;

        // Create GPU compositor
        this._compositor = new WorkspaceCompositor({
            device: this.device,
            format: this.format,
            canvas: this.canvas,
            logger: this.logger,
        });
        await this._compositor.init();

        // Set up keyboard shortcuts for workspace switching
        this._setupKeyboardShortcuts();

        this._initialized = true;
        this.logger.info('[WorkspaceManager] Initialized');
    }

    /**
     * Create a new workspace.
     *
     * Workspace creation pattern:
     * - Instantiates Workspace with given options
     * - Mounts workspace into container DOM layer
     * - Sets up activation/deactivation event handlers
     * - Auto-activates if it's the first workspace
     *
     * @param {Object} options
     * @param {string} [options.name]
     * @param {string} [options.layout='float']
     * @returns {Workspace}
     */
    createWorkspace(options = {}) {
        const ws = new Workspace(options);
        this.workspaces.set(ws.id, ws);
        ws.mount(this.container);
        ws.on('activated', () => this._onWorkspaceActivated(ws));
        ws.on('deactivated', () => this._onWorkspaceDeactivated(ws));

        // If this is the first workspace, activate it
        if (this.workspaces.size === 1) {
            this.switchTo(ws.id);
        }

        this.logger.info(`[WorkspaceManager] Created workspace: ${ws.name}`);
        return ws;
    }

    /**
     * Switch to a workspace by id.
     *
     * Workspace switching pattern:
     * - Deactivates currently active workspace (if any)
     * - Activates target workspace
     * - Updates active ID tracking
     * - CSS transitions handle visual switching
     *
     * @param {string} id
     */
    async switchTo(id) {
        const ws = this.workspaces.get(id);
        if (!ws) {
            this.logger.warn(`[WorkspaceManager] Workspace not found: ${id}`);
            return;
        }

        const prev = this.activeWorkspace;
        if (this._activeId === id) return;

        // First activation is immediate so boot/panel creation is not blocked.
        if (!this._hasSwitched || !prev) {
            if (prev) prev.deactivate();
            ws.activate();
            this._activeId = id;
            this._hasSwitched = true;
            return;
        }

        // Subsequent switches use the View Transitions API for page-like blending.
        await this._pageTransition.start(() => {
            if (prev) prev.deactivate();
            ws.activate();
            this._activeId = id;
        });
    }

    /**
     * Remove a workspace.
     * @param {string} id
     */
    removeWorkspace(id) {
        const ws = this.workspaces.get(id);
        if (!ws) return;

        if (this._activeId === id) {
            // Switch to another workspace if available
            const next = Array.from(this.workspaces.values()).find(w => w.id !== id);
            if (next) this.switchTo(next.id);
            else this._activeId = null;
        }

        ws.destroy();
        this.workspaces.delete(id);
        this.logger.info(`[WorkspaceManager] Removed workspace: ${ws.name}`);
    }

    /**
     * Create a panel and add it to the active workspace.
     *
     * Panel creation pattern:
     * - Instantiates DOMPanel or GPUPanel based on type
     * - Adds panel to active workspace
     * - Workspace mounts the panel
     * - Returns panel instance for further configuration
     *
     * @param {'dom'|'gpu'} type
     * @param {Object} options — passed to DOMPanel or GPUPanel
     * @returns {Panel}
     */
    createPanel(type, options = {}) {
        const active = this.activeWorkspace;
        if (!active) {
            throw new Error('[WorkspaceManager] No active workspace to add panel to');
        }

        let panel;
        if (type === 'dom') {
            panel = new DOMPanel(options);
        } else if (type === 'gpu') {
            panel = new GPUPanel(options);
            if (this._compositor) {
                panel.initGPU(this.device, this.format);
            }
        } else {
            throw new Error(`[WorkspaceManager] Unknown panel type: ${type}`);
        }

        active.addPanel(panel);
        this.logger.info(`[WorkspaceManager] Created ${type} panel: ${panel.title}`);
        return panel;
    }

    /**
     * List all workspaces.
     * @returns {Object[]}
     */
    list() {
        return Array.from(this.workspaces.values()).map(ws => ws.toJSON());
    }

    /**
     * Get the compositor (for frame rendering).
     * @returns {WorkspaceCompositor|null}
     */
    getCompositor() {
        return this._compositor;
    }

    /**
     * Destroy the manager and all workspaces.
     */
    destroy() {
        this.workspaces.forEach(ws => ws.destroy());
        this.workspaces.clear();
        this._compositor?.destroy();
        this._compositor = null;
        this._initialized = false;
        this._activeId = null;
    }

    // ── Private ─────────────────────────────────────────────────────────────

    _onWorkspaceActivated(ws) {
        this._activeId = ws.id;
        this._emit('workspace-switched', ws);
    }

    _onWorkspaceDeactivated(ws) {
        // No-op
    }

    _setupKeyboardShortcuts() {
        // Ctrl+\` to open switcher
        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.key === '`') {
                e.preventDefault();
                this._openSwitcher();
            }
        });
    }

    _openSwitcher() {
        if (!this._switcher) {
            this._switcher = new WorkspaceSwitcher({
                container: document.body,
                manager: this,
                logger: this.logger,
            });
        }
        this._switcher.show();
    }

    on(event, fn) {
        this._observers = this._observers || new Map();
        const set = this._observers.get(event) || new Set();
        set.add(fn);
        this._observers.set(event, set);
        return () => set.delete(fn);
    }

    _emit(event, data) {
        const set = this._observers?.get(event);
        if (set) set.forEach(fn => { try { fn(data); } catch { /* ignore */ } });
    }
}
