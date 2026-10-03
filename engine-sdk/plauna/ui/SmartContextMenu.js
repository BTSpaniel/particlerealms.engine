// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ============================================================================
 * PlaunaSmartContextMenu - Context-Aware Right-Click Menu
 * ============================================================================
 *
 * PlaunaSmartContextMenu provides a context-aware right-click menu that scans
 * the visual tree near the cursor and builds a smart action panel based on
 * nearby UI nodes.
 *
 * SCANNING ALGORITHM:
 * 1. On right-click, collectNearbyNodes() scans the visual tree around cursor
 * 2. Uses adaptive radius based on node density (shrinks when many nodes nearby)
 * 3. Scores each node based on type, role, text content, and distance
 * 4. Returns top N nodes within scan radius
 *
 * NODE SCORING:
 * - Inside node: +1000 + inset depth (prioritizes deeper inside)
 * - Has role: +22
 * - Has text content: +10
 * - Has className: +8
 * - Button type: +25
 * - Input type: +18
 * - Menu type: +15
 * - Small area: +6 (prefers compact elements)
 *
 * ADAPTIVE RADIUS:
 * - Base radius: 140px (configurable)
 * - Density >= 8: 48% of base (72px min)
 * - Density >= 6: 55% of base (80px min)
 * - Density >= 4: 65% of base (90px min)
 * - Density >= 2: 80% of base (112px min)
 * - Density < 2: 100% of base (140px)
 *
 * DOM FALLBACK:
 * - If visualTree is unavailable (e.g., in showcase shell), falls back to DOM scanning
 * - Uses element._plaunaNode back-reference set by WidgetRenderer
 * - Scans all elements in root and collects associated UINodes
 *
 * ACTION GENERATION:
 * - For each nearby node, generates contextual actions
 * - Actions include: inspect, copy text, copy ID, copy styles, toggle visibility
 * - Actions are sorted by relevance and displayed in a radial menu
 *
 * VISUAL FEEDBACK:
 * - Draws a scan ring around cursor during scanning
 * - Highlights nearby nodes with visual indicators
 * - Shows tie nodes (nodes with similar scores) with special styling
 *
 * INTEGRATION:
 * - Requires: app (PlaunaApp), root (DOM element), visualTree (optional)
 * - Optional: domRenderer (WidgetRenderer instance), console (logger)
 * - Configurable: radius, maxNearby, maxActions, enabled flag
 *
 * USAGE:
 *   const menu = new PlaunaSmartContextMenu({
 *       app: plaunaApp,
 *       root: document.body,
 *       visualTree: app.visualTree,
 *       domRenderer: app.domRenderer,
 *       radius: 140,
 *       maxNearby: 6,
 *       maxActions: 6
 *   });
 *   menu.enable();
 */

import { clamp } from '../../engine/core/math/MathScalar.js';
import { createSmartContextAssistDescriptor } from '../../webgpu-os/shared/SmartContextAssist.js';

export {
    SMART_CONTEXT_ASSIST_FORMAT,
    SMART_CONTEXT_ASSIST_VERSION,
    createSmartContextAssistDescriptor,
} from '../../webgpu-os/shared/SmartContextAssist.js';

function isFiniteNumber(value) {
    return Number.isFinite(value) && !Number.isNaN(value);
}

function normalizeLabel(value, fallback) {
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }
    return fallback;
}

function distanceToRectPoint(cursor, bounds) {
    const dx = Math.max(bounds.x - cursor.x, 0, cursor.x - (bounds.x + bounds.width));
    const dy = Math.max(bounds.y - cursor.y, 0, cursor.y - (bounds.y + bounds.height));
    return Math.hypot(dx, dy);
}

function distanceToRectEdge(cursor, bounds) {
    const left = cursor.x - bounds.x;
    const right = bounds.x + bounds.width - cursor.x;
    const top = cursor.y - bounds.y;
    const bottom = bounds.y + bounds.height - cursor.y;

    if (left >= 0 && right >= 0 && top >= 0 && bottom >= 0) {
        return {
            inside: true,
            inset: Math.min(left, right, top, bottom),
            distance: 0
        };
    }

    return {
        inside: false,
        inset: 0,
        distance: distanceToRectPoint(cursor, bounds)
    };
}

function getAdaptiveRadius(baseRadius, density) {
    if (density >= 8) return Math.max(72, Math.round(baseRadius * 0.48));
    if (density >= 6) return Math.max(80, Math.round(baseRadius * 0.55));
    if (density >= 4) return Math.max(92, Math.round(baseRadius * 0.64));
    if (density >= 3) return Math.max(104, Math.round(baseRadius * 0.76));
    if (density >= 2) return Math.max(116, Math.round(baseRadius * 0.86));
    return baseRadius;
}

function getTieGap(density) {
    if (density >= 8) return 14;
    if (density >= 6) return 16;
    if (density >= 4) return 18;
    return 24;
}

/**
 * PlaunaSmartContextMenu - Context-aware right-click menu.
 *
 * Context menu pattern:
 * - Scans visual tree near cursor on right-click
 * - Builds smart action panel based on nearby UI nodes
 * - Adaptive radius based on node density
 * - Node scoring for relevance ranking
 * - Visual feedback with scan ring and highlights
 *
 * Integration:
 * - Requires: app (PlaunaApp), root (DOM element), visualTree (optional)
 * - Optional: domRenderer (WidgetRenderer), console (logger)
 * - Configurable: radius, maxNearby, maxActions, enabled flag
 */
export class PlaunaSmartContextMenu {
    constructor(options = {}) {
        this.app = options.app || null;
        this.root = options.root || document;
        this.eventRoot = this.root && typeof this.root.addEventListener === 'function' ? this.root : document;
        this.visualTree = options.visualTree || null;
        this.domRenderer = options.domRenderer || null;
        this.console = options.console || console;
        this.radius = options.radius || 140;
        this.maxNearby = options.maxNearby || 6;
        this.maxActions = options.maxActions || 6;
        this.enabled = options.enabled !== false;
        this.getContextMode = typeof options.getContextMode === 'function'
            ? options.getContextMode
            : () => options.contextMode || 'developer';
        this.onPresenceChange = typeof options.onPresenceChange === 'function'
            ? options.onPresenceChange
            : null;
        this.onAssistRequest = typeof options.onAssistRequest === 'function'
            ? options.onAssistRequest
            : null;
        this.visible = false;
        this.context = null;
        this.selectedNode = null;
        this.overlay = null;
        this.panel = null;
        this.headerMeta = null;
        this.radiusChip = null;
        this.nearbyList = null;
        this.actionList = null;
        this.nodeDetails = null;
        this.cursorDot = null;
        this._boundContextMenu = this.handleContextMenu.bind(this);
        this._boundKeyDown = this.handleKeyDown.bind(this);
        this._boundPointerDown = this.handlePointerDown.bind(this);
        this._previousFocus = null;
        this._typeaheadBuffer = '';
        this._typeaheadTimer = null;

        if (typeof document !== 'undefined') {
            this.build();
            this.attach();
        }
    }

    build() {
        if (this.overlay) return;

        this.injectStyles();

        this.overlay = document.createElement('div');
        this.overlay.id = 'plauna-smart-context-menu';
        this.overlay.style.cssText = [
            'position: fixed',
            'inset: 0',
            'z-index: 10050',
            'pointer-events: none',
            'display: none'
        ].join('; ');

        const ring = document.createElement('div');
        ring.style.cssText = [
            'position: fixed',
            'width: 0',
            'height: 0',
            'pointer-events: none',
            'border-radius: 50%'
        ].join('; ');
        this.cursorDot = ring;

        this.panel = document.createElement('div');
        this.panel.className = 'plauna-smart-context-menu__panel';
        this.panel.setAttribute('role', 'menu');
        this.panel.setAttribute('aria-label', 'Context menu');
        this.panel.style.cssText = [
            'position: fixed',
            'min-width: 260px',
            'max-width: min(360px, calc(100vw - 24px))',
            'pointer-events: auto',
            'display: flex',
            'flex-direction: column',
            'gap: 2px',
            'padding: 6px',
            'border-radius: 16px',
            'border: 1px solid rgba(255,255,255,0.10)',
            'background: rgba(14, 16, 26, 0.97)',
            'backdrop-filter: blur(24px) saturate(180%)',
            'box-shadow: 0 12px 48px rgba(0,0,0,0.65), 0 0 0 0.5px rgba(255,255,255,0.04)',
            'color: #f0f2f8',
            'font-family: inherit',
            'max-height: calc(100vh - 24px)',
            'overflow: hidden',
            'visibility: hidden',
            'opacity: 0',
            'transform: translateY(4px) scale(0.97)',
            'transition: opacity 160ms cubic-bezier(0.22,1,0.36,1), transform 160ms cubic-bezier(0.22,1,0.36,1), visibility 160ms ease'
        ].join('; ');

        const header = document.createElement('div');
        header.style.cssText = [
            'display: flex',
            'align-items: center',
            'justify-content: space-between',
            'gap: 10px',
            'padding: 5px 10px 3px'
        ].join('; ');

        const titleBlock = document.createElement('div');
        titleBlock.style.cssText = 'display: flex; flex-direction: column; gap: 1px; min-width: 0;';

        this.headerMeta = document.createElement('div');
        this.headerMeta.style.cssText = [
            'font-size: 11.5px',
            'font-weight: 600',
            'color: #f0f2f8',
            'white-space: nowrap',
            'overflow: hidden',
            'text-overflow: ellipsis'
        ].join('; ');

        titleBlock.appendChild(this.headerMeta);

        this.radiusChip = document.createElement('div');
        this.radiusChip.style.cssText = [
            'display: inline-flex',
            'align-items: center',
            'justify-content: center',
            'padding: 3px 8px',
            'border-radius: 999px',
            'border: 1px solid color-mix(in srgb, var(--os-accent, #5b7cff) 24%, transparent)',
            'background: color-mix(in srgb, var(--os-accent, #5b7cff) 9%, transparent)',
            'color: var(--text-primary, #f0f2f8)',
            'opacity: 0.85',
            'font-size: 10px',
            'font-weight: 600',
            'white-space: nowrap',
            'flex-shrink: 0'
        ].join('; ');

        header.appendChild(titleBlock);
        header.appendChild(this.radiusChip);

        this.nodeDetails = document.createElement('div');
        this.nodeDetails.style.cssText = [
            'display: flex',
            'flex-direction: column',
            'gap: 4px',
            'padding: 8px 10px',
            'border-radius: 10px',
            'background: rgba(255,255,255,0.04)',
            'border: 1px solid rgba(255,255,255,0.06)',
            'margin: 0 2px'
        ].join('; ');

        this.nearbyList = this.createSection('Nearby nodes');
        this.actionList = this.createSection('Actions');

        this.panel.appendChild(header);
        this.panel.appendChild(this.nodeDetails);
        this.panel.appendChild(this.nearbyList.wrapper);
        this.panel.appendChild(this.actionList.wrapper);

        this.overlay.appendChild(ring);
        this.overlay.appendChild(this.panel);
        document.body.appendChild(this.overlay);
    }

    injectStyles() {
        if (document.querySelector('style[data-plauna-smart-context-menu="1"]')) {
            return;
        }

        const style = document.createElement('style');
        style.setAttribute('data-plauna-smart-context-menu', '1');
        style.textContent = `
            .plauna-smart-context-menu__section {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            .plauna-smart-context-menu__section-title {
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 0.07em;
                text-transform: uppercase;
                color: rgba(255,255,255,0.28);
                padding: 5px 10px 1px;
            }

            .plauna-smart-context-menu__list {
                display: flex;
                flex-direction: column;
                gap: 1px;
            }

            .plauna-smart-context-menu__section:last-child {
                min-height: 0;
                overflow: hidden;
            }

            .plauna-smart-context-menu__section:last-child .plauna-smart-context-menu__list {
                min-height: 0;
                overflow-y: auto;
                overscroll-behavior: contain;
                scrollbar-width: thin;
            }

            .plauna-smart-context-menu__button {
                display: flex;
                align-items: center;
                gap: 10px;
                width: 100%;
                padding: 7px 10px;
                border: none;
                border-radius: 9px;
                background: transparent;
                color: #f0f2f8;
                text-align: left;
                cursor: pointer;
                font: inherit;
                transition: background 0.1s;
            }

            .plauna-smart-context-menu__button:hover {
                background: rgba(255,255,255,0.07);
            }

            .plauna-smart-context-menu__button:focus-visible {
                outline: 2px solid color-mix(in srgb, var(--os-accent, #5b7cff) 78%, white 10%);
                outline-offset: -2px;
                background: rgba(255,255,255,0.08);
            }

            .plauna-smart-context-menu__button[aria-disabled="true"] {
                opacity: 0.42;
                cursor: default;
            }

            .plauna-smart-context-menu__button--danger .plauna-smart-context-menu__button-title,
            .plauna-smart-context-menu__button--danger .plauna-smart-context-menu__button-icon {
                color: #ff9aa8;
            }

            .plauna-smart-context-menu__button--more {
                margin-top: 2px;
                border-top: 1px solid rgba(255,255,255,0.07);
                border-radius: 0 0 9px 9px;
            }

            .plauna-smart-context-menu__button-icon {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 22px;
                height: 22px;
                flex-shrink: 0;
                border-radius: 7px;
                background: rgba(255,255,255,0.07);
                color: #f0f2f8;
                font-size: 12px;
            }

            .plauna-smart-context-menu__button-body {
                display: flex;
                flex-direction: column;
                gap: 1px;
                min-width: 0;
                flex: 1;
            }

            .plauna-smart-context-menu__button-title {
                font-size: 12.5px;
                font-weight: 500;
                color: #f0f2f8;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .plauna-smart-context-menu__button-subtitle {
                font-size: 10.5px;
                color: rgba(255,255,255,0.38);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .plauna-smart-context-menu__button-badge {
                flex-shrink: 0;
                padding: 2px 7px;
                border-radius: 999px;
                background: color-mix(in srgb, var(--os-accent, #5b7cff) 15%, transparent);
                color: var(--text-primary, #f0f2f8);
                font-size: 10px;
                font-weight: 600;
            }

            .plauna-smart-context-menu__detail-pill {
                display: inline-flex;
                flex-direction: column;
                gap: 1px;
                min-width: 72px;
                padding: 6px 8px;
                border-radius: 8px;
                border: 1px solid rgba(255,255,255,0.07);
                background: rgba(255,255,255,0.03);
            }

            .plauna-smart-context-menu__detail-pill-label {
                font-size: 9px;
                font-weight: 700;
                letter-spacing: 0.06em;
                text-transform: uppercase;
                color: rgba(255,255,255,0.28);
            }

            .plauna-smart-context-menu__detail-pill-value {
                font-size: 11px;
                font-weight: 600;
                color: #f0f2f8;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .plauna-smart-context-menu__detail-pill--accent {
                border-color: color-mix(in srgb, var(--os-accent, #5b7cff) 24%, transparent);
                background: color-mix(in srgb, var(--os-accent, #5b7cff) 9%, transparent);
            }

            .plauna-smart-context-menu__detail-pill--success {
                border-color: rgba(34,197,94,0.22);
                background: rgba(34,197,94,0.08);
            }

            .plauna-smart-context-menu__detail-pill--warning {
                border-color: rgba(245,158,11,0.22);
                background: rgba(245,158,11,0.08);
            }

            .plauna-smart-context-menu__detail-pill--muted {
                opacity: 0.72;
            }

            .plauna-smart-context-menu__shortcut {
                flex-shrink: 0;
                margin-left: 8px;
                color: rgba(255,255,255,0.42);
                font-size: 10.5px;
                white-space: nowrap;
            }

            .plauna-smart-context-menu__separator {
                height: 1px;
                background: rgba(255,255,255,0.08);
                margin: 4px 7px;
            }

            .plauna-smart-context-menu__group-label {
                padding: 6px 10px 2px;
                color: rgba(255,255,255,0.35);
                font-size: 9.5px;
                font-weight: 700;
                letter-spacing: 0.07em;
                text-transform: uppercase;
            }
        `;
        document.head.appendChild(style);
    }

    createSection(title) {
        const wrapper = document.createElement('div');
        wrapper.className = 'plauna-smart-context-menu__section';

        const heading = document.createElement('div');
        heading.className = 'plauna-smart-context-menu__section-title';
        heading.textContent = title;

        const list = document.createElement('div');
        list.className = 'plauna-smart-context-menu__list';

        wrapper.appendChild(heading);
        wrapper.appendChild(list);

        return { wrapper, heading, list };
    }

    isDeveloperMode() {
        try {
            return this.getContextMode?.() !== 'runtime';
        } catch (error) {
            this.console?.warn?.('Smart context mode lookup failed', { message: error?.message || String(error) });
            return true;
        }
    }

    /**
     * Attach context menu event listeners.
     *
     * Attachment pattern:
     * - Registers contextmenu event handler (right-click)
     * - Registers keydown handler (Escape to dismiss)
     * - Registers pointerdown handler (click outside to dismiss)
     * - Uses capture phase for early event interception
     * - Idempotent (checks enabled flag before attaching)
     */
    attach() {
        if (!this.enabled || typeof document === 'undefined') return;
        this.eventRoot.addEventListener('contextmenu', this._boundContextMenu, true);
        this.eventRoot.addEventListener('keydown', this._boundKeyDown, true);
        this.eventRoot.addEventListener('pointerdown', this._boundPointerDown, true);
    }

    /**
     * Detach context menu event listeners.
     *
     * Detachment pattern:
     * - Removes all event listeners registered by attach()
     * - Uses capture phase to match attachment
     * - Cleans up event references
     */
    detach() {
        if (typeof document === 'undefined') return;
        this.eventRoot.removeEventListener('contextmenu', this._boundContextMenu, true);
        this.eventRoot.removeEventListener('keydown', this._boundKeyDown, true);
        this.eventRoot.removeEventListener('pointerdown', this._boundPointerDown, true);
    }

    destroy() {
        if (this.visible) this._emitPresence('close', this.context);
        this.detach();
        clearTimeout(this._typeaheadTimer);
        if (this.overlay?.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;
        this.panel = null;
        this.context = null;
        this.onPresenceChange = null;
        this.onAssistRequest = null;
    }

    handleContextMenu(event) {
        if (!this.enabled || !this.overlay) return;
        if (event.defaultPrevented) return;
        if (event.target && this.panel?.contains(event.target)) return;
        // App-owned object menus opt out before this capture-phase handler can
        // claim the event.  They still prevent the browser menu themselves,
        // while the OS smart panel is dismissed if it was already visible.
        if (event.target?.closest?.('[data-smart-context="ignore"]')) {
            this.hide();
            return;
        }

        event.preventDefault();
        const context = this.createContext(event);
        this.show(event.clientX, event.clientY, context);
    }

    handlePointerDown(event) {
        if (!this.visible || !this.panel) return;
        if (event.button !== 0) return;
        if (this.panel.contains(event.target)) return;
        this.hide();
    }

    handleKeyDown(event) {
        if (!this.visible) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            this.hide({ restoreFocus: true });
            return;
        }
        if (event.key === 'Tab') {
            this.hide();
            return;
        }

        const items = this.getEnabledMenuItems();
        if (!items.length) return;
        const current = document.activeElement;
        let index = items.indexOf(current);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            index = index < 0 ? (delta > 0 ? -1 : 0) : index;
            items[(index + delta + items.length) % items.length].focus();
            return;
        }
        if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            items[event.key === 'Home' ? 0 : items.length - 1].focus();
            return;
        }
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            this._typeaheadBuffer += event.key.toLocaleLowerCase();
            clearTimeout(this._typeaheadTimer);
            this._typeaheadTimer = window.setTimeout(() => { this._typeaheadBuffer = ''; }, 650);
            const match = items.find((item) => (item.dataset.actionLabel || '').toLocaleLowerCase().startsWith(this._typeaheadBuffer));
            if (match) {
                event.preventDefault();
                match.focus();
            }
        }
    }

    getEnabledMenuItems() {
        return [...(this.actionList?.list?.querySelectorAll?.('[role="menuitem"]') || [])]
            .filter((item) => item.getAttribute('aria-disabled') !== 'true');
    }

    /**
     * Create context menu data from right-click event.
     *
     * Context creation pattern:
     * - Extracts cursor position from event
     * - Finds target node from event target
     * - Scans for nearby nodes using adaptive radius
     * - Selects primary node (target or top nearby)
     * - Builds contextual actions for nodes
     *
     * @param {Event} event - Right-click event
     * @returns {Object} Context data with cursor, targetNode, primaryNode, nearbyNodes, actions
     */
    createContext(event) {
        const cursor = {
            x: event.clientX,
            y: event.clientY
        };

        const targetNode = this.findNodeFromEvent(event.target) || null;
        const scan = this.collectNearbyNodes(cursor);
        const nearbyNodes = scan.nodes.slice(0, this.maxNearby);
        const primaryNode = targetNode || nearbyNodes[0]?.node || null;
        const editingContext = this.captureEditingContext(event.target);
        const editingActions = this.buildEditingActions(editingContext);
        const actions = [...editingActions, ...this.buildActions(primaryNode, nearbyNodes, cursor)];

        return {
            cursor,
            domTarget: event.target || null,
            targetNode,
            primaryNode,
            nearbyNodes,
            actions,
            editingContext,
            editingActions,
            expanded: false,
            density: scan.density,
            baseRadius: this.radius,
            activeRadius: scan.activeRadius,
            tieGap: scan.tieGap
        };
    }

    captureEditingContext(target) {
        const element = target?.closest?.('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]') || null;
        const input = element && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) ? element : null;
        const editable = Boolean(element && !element.disabled && !element.readOnly);
        const selection = document.getSelection?.() || null;
        const selectedText = input
            ? String(input.value || '').slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)
            : String(selection?.toString?.() || '');
        let range = null;
        if (!input && selection?.rangeCount && element?.contains?.(selection.anchorNode)) {
            try { range = selection.getRangeAt(0).cloneRange(); } catch (_) {}
        }
        return { target, element, input, editable, selection, range, selectedText };
    }

    buildEditingActions(context) {
        if (!context) return [];
        const actions = [];
        if (context.selectedText) {
            actions.push({
                icon: '⧉', label: 'Copy', shortcut: 'Ctrl+C', placement: 'primary', group: 'Edit',
                run: () => this.copyText(context.selectedText),
            });
        }
        if (context.editable && context.selectedText) {
            actions.push({
                icon: '✂', label: 'Cut', shortcut: 'Ctrl+X', placement: 'primary', group: 'Edit',
                run: async () => {
                    const copied = await this.copyText(context.selectedText);
                    if (copied) this.replaceEditingSelection(context, '');
                },
            });
        }
        if (context.editable) {
            actions.push({
                icon: '▣', label: 'Paste', shortcut: 'Ctrl+V', placement: 'primary', group: 'Edit',
                run: async () => this.replaceEditingSelection(context, await navigator.clipboard.readText()),
            }, {
                icon: '↶', label: 'Undo', shortcut: 'Ctrl+Z', placement: 'more', group: 'Edit',
                run: () => this.runEditingCommand(context, 'undo'),
            }, {
                icon: '↷', label: 'Redo', shortcut: 'Ctrl+Y', placement: 'more', group: 'Edit',
                run: () => this.runEditingCommand(context, 'redo'),
            }, {
                icon: '▧', label: 'Select all', shortcut: 'Ctrl+A', placement: 'more', group: 'Edit',
                run: () => this.selectAllEditingContent(context),
            });
        }
        return actions;
    }

    replaceEditingSelection(context, text) {
        const value = String(text ?? '');
        const element = context?.element;
        if (!element || !context.editable) return;
        element.focus?.();
        if (context.input) {
            const start = context.input.selectionStart ?? context.input.value.length;
            const end = context.input.selectionEnd ?? start;
            context.input.setRangeText(value, start, end, 'end');
            context.input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
            return;
        }
        const selection = document.getSelection?.();
        if (selection && context.range) {
            selection.removeAllRanges();
            selection.addRange(context.range);
        }
        if (!document.execCommand?.('insertText', false, value)) {
            const range = selection?.rangeCount ? selection.getRangeAt(0) : context.range;
            if (!range) return;
            range.deleteContents();
            const node = document.createTextNode(value);
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
            selection?.removeAllRanges();
            selection?.addRange(range);
        }
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    }

    runEditingCommand(context, command) {
        context?.element?.focus?.();
        try { document.execCommand?.(command, false); } catch (error) {
            this.console?.warn?.(`Editing ${command} failed`, { message: error?.message || String(error) });
        }
    }

    selectAllEditingContent(context) {
        const element = context?.element;
        if (!element) return;
        element.focus?.();
        if (context.input) {
            context.input.select();
            return;
        }
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = document.getSelection?.();
        selection?.removeAllRanges();
        selection?.addRange(range);
    }

    findNodeFromEvent(target) {
        let current = target;
        while (current) {
            if (current._plaunaNode) {
                return current._plaunaNode;
            }
            current = current.parentElement;
        }
        return null;
    }

    getNodeBounds(node) {
        if (!node) return null;

        const domElement = this.domRenderer?.getDOMElement?.(node);
        if (domElement && typeof domElement.getBoundingClientRect === 'function' && domElement.isConnected) {
            const rect = domElement.getBoundingClientRect();
            if (rect.width > 0 || rect.height > 0) {
                return {
                    x: rect.left,
                    y: rect.top,
                    width: rect.width,
                    height: rect.height,
                    source: 'dom'
                };
            }
        }

        const box = node.layoutBox || {};
        if (isFiniteNumber(box.x) && isFiniteNumber(box.y) && isFiniteNumber(box.width) && isFiniteNumber(box.height) && (box.width > 0 || box.height > 0)) {
            return {
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
                source: 'layout'
            };
        }

        return null;
    }

    getNodeCenter(bounds) {
        return {
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height / 2
        };
    }

    /**
     * Collect nearby nodes from visual tree or DOM.
     *
     * Scanning algorithm:
     * - Uses adaptive radius based on node density
     * - Falls back to DOM scanning if visualTree unavailable
     * - Scores each node based on type, role, text, and distance
     * - Returns top N nodes within scan radius
     *
     * @param {Object} cursor - Cursor position {x, y}
     * @param {UINode} [excludeNode] - Node to exclude from results
     * @returns {Object} Scan results with nodes, density, activeRadius, tieGap
     */
    collectNearbyNodes(cursor, excludeNode = null) {
        const results = [];
        const treeRoot = this.visualTree?.getRoot?.() || this.visualTree?.root || null;
        const domRoot = this.root && typeof this.root.querySelectorAll === 'function' ? this.root : null;

        if (!treeRoot && !domRoot) return { nodes: [], density: 0, activeRadius: this.radius, tieGap: 24 };

        const baseRadius = this.radius;
        const scanRadius = baseRadius * 1.2;

        const pushCandidate = (node) => {
            if (!node || node === excludeNode) return;
            if (node.type === 'node') return;

            const bounds = this.getNodeBounds(node);
            if (!bounds) return;

            const edge = distanceToRectEdge(cursor, bounds);
            const distance = edge.inside ? 0 : edge.distance;
            if (distance > scanRadius) return;

            const score = this.scoreNode(node, bounds, cursor, edge);
            results.push({
                node,
                bounds,
                distance,
                score,
                label: this.describeNode(node),
                hint: this.describeNodeHint(node)
            });
        };

        if (treeRoot && this.visualTree && typeof this.visualTree.traverse === 'function') {
            this.visualTree.traverse((node) => pushCandidate(node), treeRoot);
        } else if (domRoot) {
            const visited = new Set();
            const domNodes = domRoot.querySelectorAll('*');
            domNodes.forEach((element) => {
                const node = element._plaunaNode || null;
                if (!node || visited.has(node)) return;
                visited.add(node);
                pushCandidate(node);
            });
        }

        results.sort((a, b) => b.score - a.score || a.distance - b.distance);

        const density = results.length;
        const activeRadius = getAdaptiveRadius(baseRadius, density);
        const tieGap = getTieGap(density);
        const borderSlack = Math.max(12, Math.round(activeRadius * 0.18));

        const filtered = results.filter((entry) => entry.distance <= activeRadius);
        if (filtered.length >= 2) return { nodes: filtered, density, activeRadius, tieGap };

        const topResult = results[0] || null;
        const tieRadius = Math.max(activeRadius + borderSlack, baseRadius * 0.85, topResult ? topResult.distance + borderSlack : 0);
        const ties = results.filter((entry) => {
            if (entry.distance <= tieRadius) {
                return true;
            }

            if (!topResult) {
                return false;
            }

            return topResult.score - entry.score <= tieGap && entry.distance <= baseRadius;
        });

        if (ties.length > 0) {
            return { nodes: ties.slice(0, this.maxNearby), density, activeRadius, tieGap };
        }

        return { nodes: results.slice(0, this.maxNearby), density, activeRadius, tieGap };
    }

    scoreNode(node, bounds, cursor, edge) {
        let score = edge.inside ? 1000 + edge.inset : Math.max(0, this.radius - edge.distance);

        if (node.role) score += 22;
        if (node.textContent && String(node.textContent).trim()) score += 10;
        if (node.className) score += 8;
        if (node.type === 'button' || node.role === 'button') score += 25;
        if (node.type === 'input' || node.type === 'textarea' || node.type === 'select') score += 18;
        if (node.type === 'menu' || node.role === 'menu') score += 15;
        if (bounds.width * bounds.height < 1200) score += 6;

        return score;
    }

    describeNode(node) {
        const label = normalizeLabel(node.ariaLabel, '');
        if (label) return label;

        const text = normalizeLabel(node.textContent, '');
        if (text) return text.length > 32 ? `${text.slice(0, 29)}…` : text;

        if (node.title) return node.title;
        if (node.name) return node.name;
        return `${node.type || 'node'}${node.id ? `#${node.id}` : ''}`;
    }

    describeNodeHint(node) {
        const parts = [];
        if (node.id) parts.push(`#${node.id}`);
        if (node.type) parts.push(node.type);
        if (node.role) parts.push(`role:${node.role}`);
        if (node.variant) parts.push(`variant:${node.variant}`);
        if (node.size) parts.push(`size:${node.size}`);
        if (node.status) parts.push(`status:${node.status}`);
        if (node.shape) parts.push(`shape:${node.shape}`);
        if (typeof node.loading === 'boolean' && node.loading) parts.push('loading');
        if (typeof node.disabled === 'boolean' && node.disabled) parts.push('disabled');
        if (typeof node.removable === 'boolean' && node.removable) parts.push('removable');
        if (node.className) parts.push(`.${node.className}`);
        return parts.join(' · ');
    }

    /**
     * Extract type-aware detail items for the smart context panel.
     *
     * Returns a list of metadata pills that adapt to node type:
     * - Type/Role/ID: always shown for identification
     * - Variant/Size/Status: shown when present for styling/state context
     * - Profile-specific: name, showStatus, imageLoaded, imageError for avatars
     * - Widget-specific: content (buttons), label (chips), value (inputs)
     * - Accessibility: alt, fallback, ariaLabel for screen readers
     * - Geometry: bounds summary for debugging layout
     *
     * Each pill has a tone (accent/success/warning/muted) for semantic meaning:
     * - accent: primary fields (type, variant, profile)
     * - success: positive states (online, image loaded)
     * - warning: caution states (busy, image error, loading)
     * - muted: neutral metadata
     */
    getNodeDetailItems(node) {
        if (!node) return [];

        const items = [];
        const push = (label, value, tone = 'muted') => {
            if (value === undefined || value === null || value === '') return;
            items.push({ label, value: String(value), tone });
        };

        push('Type', node.type || 'node', 'accent');
        if (node.role) push('Role', node.role);
        if (node.id) push('ID', `#${node.id}`);
        if (node.variant) push('Variant', node.variant, 'accent');
        if (node.size) push('Size', node.size);
        if (node.content) push('Content', node.content, 'accent');
        if (node.label) push('Label', node.label, 'accent');
        if (node.status) {
            const tone = node.status === 'online' || node.status === 'active' ? 'success' : node.status === 'busy' || node.status === 'away' ? 'warning' : 'accent';
            push('Status', node.status, tone);
        }
        if (typeof node.loading === 'boolean') push('Loading', node.loading ? 'yes' : 'no', node.loading ? 'warning' : 'muted');
        if (typeof node.disabled === 'boolean') push('Disabled', node.disabled ? 'yes' : 'no', node.disabled ? 'warning' : 'muted');
        if (typeof node.removable === 'boolean') push('Removable', node.removable ? 'yes' : 'no', node.removable ? 'accent' : 'muted');
        if (node.name) push('Profile', node.name, 'accent');
        if (typeof node.showStatus === 'boolean') push('Status dot', node.showStatus ? 'visible' : 'hidden');
        if (typeof node.imageLoaded === 'boolean') push('Image loaded', node.imageLoaded ? 'yes' : 'no', node.imageLoaded ? 'success' : 'warning');
        if (typeof node.imageError === 'boolean') push('Image error', node.imageError ? 'yes' : 'no', node.imageError ? 'warning' : 'muted');
        if (node.textContent && String(node.textContent).trim()) {
            const text = String(node.textContent).trim();
            push('Text', text.length > 30 ? `${text.slice(0, 27)}…` : text);
        }
        if (node.shape) push('Shape', node.shape);
        if (node.fallback) push('Fallback', node.fallback);
        if (node.alt) push('Alt', node.alt);
        if (node.icon) push('Icon', node.icon);
        if (node.iconPosition) push('Icon pos', node.iconPosition);
        if (node.value !== undefined && node.value !== null && node.value !== '') push('Value', String(node.value));
        if (node.src) push('Image', this.summarizeSource(node.src));
        if (node.ariaLabel) push('ARIA', node.ariaLabel);

        return items;
    }

    summarizeSource(src) {
        const text = String(src || '').trim();
        if (!text) return '';
        try {
            const baseHref = typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost/';
            const url = new URL(text, baseHref);
            return `${url.protocol}//${url.hostname}${url.pathname}`;
        } catch {
            return text.length > 34 ? `${text.slice(0, 31)}…` : text;
        }
    }

    /**
     * Create a modern detail pill for the context panel.
     *
     * Renders a two-line pill component with:
     * - Label: uppercase, small, muted color for category
     * - Value: medium weight, primary color, truncated with ellipsis
     * - Tone-based styling for semantic meaning
     *
     * Pills are flex items that wrap in the metadata section,
     * creating a dense but readable information grid.
     */
    createDetailPill(label, value, tone = 'muted') {
        const pill = document.createElement('span');
        pill.className = `plauna-smart-context-menu__detail-pill plauna-smart-context-menu__detail-pill--${tone}`;

        const labelEl = document.createElement('span');
        labelEl.className = 'plauna-smart-context-menu__detail-pill-label';
        labelEl.textContent = label;

        const valueEl = document.createElement('span');
        valueEl.className = 'plauna-smart-context-menu__detail-pill-value';
        valueEl.textContent = value;

        pill.appendChild(labelEl);
        pill.appendChild(valueEl);
        return pill;
    }

    /**
     * Extract a serializable node snapshot for debugging.
     *
     * Returns a plain object containing the most relevant node properties:
     * - Identification: id, type, role, name
     * - Display: summary (human-readable), hint (technical details)
     * - Styling: variant, size, status, shape
     * - Widget data: content, label, alt, fallback
     * - State: loading, disabled, removable
     * - Geometry: bounds (x, y, width, height)
     *
     * This snapshot is used by the "Copy node snapshot" action to
     * provide developers with a complete view of the node's state
     * for debugging and inspection.
     */
    getNodeSnapshot(node) {
        if (!node) return null;

        const bounds = this.getNodeBounds(node);
        return {
            id: node.id || null,
            type: node.type || null,
            role: node.role || null,
            name: node.name || null,
            summary: this.describeNode(node),
            hint: this.describeNodeHint(node),
            variant: node.variant || null,
            size: node.size || null,
            content: node.content || null,
            label: node.label || null,
            status: node.status || null,
            shape: node.shape || null,
            alt: node.alt || null,
            fallback: node.fallback || null,
            loading: typeof node.loading === 'boolean' ? node.loading : null,
            disabled: typeof node.disabled === 'boolean' ? node.disabled : null,
            removable: typeof node.removable === 'boolean' ? node.removable : null,
            bounds: bounds ? {
                x: Math.round(bounds.x),
                y: Math.round(bounds.y),
                width: Math.round(bounds.width),
                height: Math.round(bounds.height)
            } : null
        };
    }

    buildActions(node, nearbyNodes, cursor) {
        const actions = [];

        if (this.onAssistRequest) {
            actions.push({
                icon: '✦',
                label: 'Ask Echo about this',
                subtitle: 'Prefill a safe semantic review. Nothing runs automatically.',
                placement: 'primary',
                group: 'Assist',
                run: () => this.requestContextAssist(
                    this.context?.primaryNode ?? node,
                    this.context?.cursor ?? cursor,
                ),
            });
        }

        if (!this.isDeveloperMode()) return actions;

        if (node) {
            actions.push({
                icon: '🔍',
                label: 'Inspect node',
                subtitle: this.describeNodeHint(node),
                placement: 'more',
                group: 'Developer',
                run: () => this.inspectNode(node)
            });

            /**
             * Copy node snapshot action.
             *
             * Provides a copyable JSON snapshot of the node's current state,
             * useful for debugging, issue reporting, and understanding the
             * visual tree structure at a point in time.
             */
            actions.push({
                icon: '🪪',
                label: 'Copy node snapshot',
                subtitle: 'Copy the visible profile/button/chip metadata',
                placement: 'more',
                group: 'Developer',
                run: () => this.copyText(JSON.stringify(this.getNodeSnapshot(node), null, 2))
            });

            actions.push({
                icon: '📍',
                label: 'Highlight node',
                subtitle: 'Temporarily outline the target',
                placement: 'more',
                group: 'Developer',
                run: () => this.highlightNode(node)
            });

            actions.push({
                icon: '👆',
                label: 'Focus / activate',
                subtitle: this.getActivationHint(node),
                placement: 'more',
                group: 'Developer',
                run: () => this.activateNode(node)
            });

            actions.push({
                icon: '📋',
                label: 'Copy node id',
                subtitle: node.id || 'No id available',
                placement: 'more',
                group: 'Developer',
                run: () => this.copyText(node.id || '')
            });
        }

        actions.push({
            icon: '🧭',
            label: 'Log nearby nodes',
            subtitle: `${nearbyNodes.length} node(s) within ${this.radius}px`,
            placement: 'more',
            group: 'Developer',
            run: () => this.logNearbyNodes(nearbyNodes)
        });

        actions.push({
            icon: '🔄',
            label: 'Refresh UI',
            subtitle: 'Force a visual update',
            placement: 'more',
            group: 'Developer',
            run: () => this.app?.forceRefresh?.()
        });

        actions.push({
            icon: '✕',
            label: 'Close menu',
            subtitle: 'Dismiss the smart context panel',
            placement: 'more',
            group: 'Developer',
            run: () => this.hide()
        });

        return actions;
    }

    requestContextAssist(node = null, cursor = null) {
        if (!this.onAssistRequest) return false;
        return this.onAssistRequest(createSmartContextAssistDescriptor(node, cursor));
    }

    getActivationHint(node) {
        if (!node) return 'No target';
        if (node.type === 'button' || node.role === 'button') return 'Click the target button';
        if (node.type === 'input' || node.type === 'textarea' || node.type === 'select') return 'Focus the field';
        if (node.type === 'menu' || node.role === 'menuitem') return 'Open or select menu item';
        return 'Try to focus or reveal the node';
    }

    inspectNode(node) {
        try {
            this.console?.inspect?.(node);
        } catch (error) {
            this.console?.error?.('Smart context inspect failed', { message: error?.message || String(error) });
        }
    }

    highlightNode(node) {
        const domElement = this.domRenderer?.getDOMElement?.(node);
        if (!domElement) {
            this.console?.warn?.('No DOM element available to highlight', { id: node?.id, type: node?.type });
            return;
        }

        const previousOutline = domElement.style.outline;
        const previousOffset = domElement.style.outlineOffset;
        domElement.style.outline = '2px solid var(--color-primary-500)';
        domElement.style.outlineOffset = '2px';
        this.console?.info?.('Highlighted node', { id: node.id, type: node.type });

        window.setTimeout(() => {
            domElement.style.outline = previousOutline;
            domElement.style.outlineOffset = previousOffset;
        }, 1200);
    }

    activateNode(node) {
        const domElement = this.domRenderer?.getDOMElement?.(node);
        if (domElement && typeof domElement.focus === 'function') {
            domElement.focus();
            if (typeof domElement.click === 'function' && (node.type === 'button' || node.role === 'button')) {
                domElement.click();
            }
            this.console?.info?.('Activated node', { id: node.id, type: node.type });
            return;
        }

        if (node?.role === 'button' || node?.type === 'button') {
            this.console?.info?.('Button-like node selected', { id: node.id, type: node.type });
            return;
        }

        this.console?.warn?.('No activation path available for node', { id: node?.id, type: node?.type });
    }

    async copyText(text) {
        if (!text) {
            this.console?.warn?.('Nothing to copy');
            return false;
        }

        try {
            await navigator.clipboard.writeText(text);
            this.console?.info?.('Copied text to clipboard', { text });
            return true;
        } catch (error) {
            this.console?.warn?.('Clipboard copy failed', { text, message: error?.message || String(error) });
            return false;
        }
    }

    logNearbyNodes(nearbyNodes) {
        const payload = nearbyNodes.map((entry) => ({
            id: entry.node.id,
            type: entry.node.type,
            label: entry.label,
            hint: entry.hint,
            distance: Math.round(entry.distance),
            score: Math.round(entry.score)
        }));
        this.console?.info?.('Nearby nodes', payload);
    }

    render(context) {
        this.context = context;
        this.selectedNode = context.primaryNode || null;
        const developerMode = this.isDeveloperMode();
        const presentation = context.presentation || null;

        const density = context.density ?? 0;
        this.overlay.dataset.contextMode = developerMode ? 'developer' : 'runtime';
        this.radiusChip.style.display = developerMode ? '' : 'none';
        this.radiusChip.textContent = density > 0 ? `${density} nearby` : 'Desktop';
        this.headerMeta.textContent = presentation?.title || (context.targetNode
            ? this.describeNode(context.targetNode)
            : context.nearbyNodes.length > 0
                ? `${context.nearbyNodes.length} element${context.nearbyNodes.length > 1 ? 's' : ''} in range`
                : 'Desktop');
        this.nodeDetails.style.display = developerMode ? '' : 'none';
        this.nodeDetails.replaceChildren();
        if (developerMode) {
            const detailsTitle = document.createElement('div');
            detailsTitle.style.cssText = 'font-size: 12px; font-weight: 600; color: #f0f2f8;';
            detailsTitle.textContent = context.primaryNode ? this.describeNode(context.primaryNode) : 'Desktop';

            const detailsSub = document.createElement('div');
            detailsSub.style.cssText = 'font-size: 10.5px; color: rgba(255,255,255,0.35);';
            detailsSub.textContent = context.primaryNode
                ? this.describeNodeHint(context.primaryNode)
                : 'Right-click anywhere for quick actions';

            const detailsMeta = document.createElement('div');
            detailsMeta.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px;';

            if (context.primaryNode) {
                // Show coordinates badge for debugging layout
                const coords = document.createElement('span');
                coords.className = 'plauna-smart-context-menu__button-badge';
                const bounds = this.getNodeBounds(context.primaryNode);
                coords.textContent = bounds
                    ? `${Math.round(bounds.x)}, ${Math.round(bounds.y)} · ${Math.round(bounds.width)}×${Math.round(bounds.height)}`
                    : 'No bounds';
                detailsMeta.appendChild(coords);

                // Render type-aware detail pills for rich metadata display
                this.getNodeDetailItems(context.primaryNode).forEach((item) => {
                    detailsMeta.appendChild(this.createDetailPill(item.label, item.value, item.tone));
                });
            } else {
                // Show helpful tip when no target node is selected
                const emptyPill = this.createDetailPill('Tip', 'Use a widget target for richer context', 'muted');
                detailsMeta.appendChild(emptyPill);
            }

            this.nodeDetails.appendChild(detailsTitle);
            this.nodeDetails.appendChild(detailsSub);
            this.nodeDetails.appendChild(detailsMeta);
        }

        this.nearbyList.list.innerHTML = '';
        this.nearbyList.wrapper.style.display = developerMode && context.nearbyNodes.length ? '' : 'none';
        if (developerMode && context.nearbyNodes.length > 0) {
            context.nearbyNodes.forEach((entry, index) => {
                const button = this.createNodeButton(entry, index, (node) => {
                    this.selectedNode = node;
                    this.context.primaryNode = node;
                    this.render(this.context);
                });
                this.nearbyList.list.appendChild(button);
            });
        }

        this.actionList.list.innerHTML = '';
        this.actionList.heading.style.display = developerMode ? '' : 'none';
        const { visible, hiddenCount } = this.resolveVisibleActions(context);
        let previousGroup = null;
        visible.forEach((action) => {
            if (action.type === 'separator') {
                this.actionList.list.appendChild(this.createActionButton(action));
                previousGroup = null;
                return;
            }
            if (context.expanded && action.group && action.group !== previousGroup) {
                if (previousGroup) this.actionList.list.appendChild(this.createActionButton({ type: 'separator' }));
                const group = document.createElement('div');
                group.className = 'plauna-smart-context-menu__group-label';
                group.textContent = action.group;
                this.actionList.list.appendChild(group);
                previousGroup = action.group;
            }
            this.actionList.list.appendChild(this.createActionButton(action));
        });
        if (hiddenCount > 0 && !context.expanded) {
            this.actionList.list.appendChild(this.createActionButton({
                icon: '↗',
                label: 'Show more options',
                shortcut: 'Shift+F10',
                keepOpen: true,
                moreButton: true,
                run: () => {
                    context.expanded = true;
                    this.render(context);
                    this.positionPanel(context.cursor.x, context.cursor.y, { focusFirst: true });
                },
            }));
        }
    }

    resolveVisibleActions(context) {
        const primary = [];
        const more = [];
        let automaticPrimaryCount = 0;
        for (const action of context.actions || []) {
            if (!action || action.type === 'separator') continue;
            const placement = action.placement || (automaticPrimaryCount < this.maxActions ? 'primary' : 'more');
            if (placement === 'more') more.push(action);
            else {
                primary.push(action);
                if (!action.placement) automaticPrimaryCount += 1;
            }
        }
        return {
            visible: context.expanded ? [...primary, ...more] : primary,
            hiddenCount: more.length,
        };
    }

    createNodeButton(entry, index, selectNode) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'plauna-smart-context-menu__button';
        button.dataset.nodeId = entry.node.id || '';
        button.addEventListener('click', () => selectNode(entry.node));

        const icon = document.createElement('span');
        icon.className = 'plauna-smart-context-menu__button-icon';
        icon.textContent = String(index + 1);

        const body = document.createElement('span');
        body.className = 'plauna-smart-context-menu__button-body';

        const title = document.createElement('span');
        title.className = 'plauna-smart-context-menu__button-title';
        title.textContent = entry.label;

        const subtitle = document.createElement('span');
        subtitle.className = 'plauna-smart-context-menu__button-subtitle';
        subtitle.textContent = `${entry.hint} · ${Math.round(entry.distance)}px away`;

        const badge = document.createElement('span');
        badge.className = 'plauna-smart-context-menu__button-badge';
        badge.textContent = `${Math.round(entry.score)} score`;

        body.appendChild(title);
        body.appendChild(subtitle);
        button.appendChild(icon);
        button.appendChild(body);
        button.appendChild(badge);
        return button;
    }

    createActionButton(action) {
        if (action.type === 'separator') {
            const sep = document.createElement('div');
            sep.className = 'plauna-smart-context-menu__separator';
            sep.setAttribute('role', 'separator');
            return sep;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'plauna-smart-context-menu__button';
        if (action.danger) button.classList.add('plauna-smart-context-menu__button--danger');
        if (action.moreButton) button.classList.add('plauna-smart-context-menu__button--more');
        button.setAttribute('role', 'menuitem');
        button.tabIndex = -1;
        button.dataset.actionLabel = action.label || '';
        if (action.disabled) button.setAttribute('aria-disabled', 'true');
        button.addEventListener('click', async () => {
            if (action.disabled) return;
            try {
                await action.run?.();
                this.console?.info?.('Smart context action executed', { label: action.label, subtitle: action.subtitle });
                if (!action.keepOpen) this.hide();
            } catch (error) {
                this.console?.warn?.('Smart context action failed', { label: action.label, message: error?.message || String(error) });
                if (!action.keepOpen) this.hide();
            }
        });

        const icon = document.createElement('span');
        icon.className = 'plauna-smart-context-menu__button-icon';
        icon.textContent = action.icon || '•';

        const body = document.createElement('span');
        body.className = 'plauna-smart-context-menu__button-body';

        const title = document.createElement('span');
        title.className = 'plauna-smart-context-menu__button-title';
        title.textContent = action.label;

        const subtitle = document.createElement('span');
        subtitle.className = 'plauna-smart-context-menu__button-subtitle';
        subtitle.textContent = action.subtitle || '';

        body.appendChild(title);
        body.appendChild(subtitle);
        button.appendChild(icon);
        button.appendChild(body);
        if (action.shortcut) {
            const shortcut = document.createElement('span');
            shortcut.className = 'plauna-smart-context-menu__shortcut';
            shortcut.textContent = action.shortcut;
            button.appendChild(shortcut);
        }
        return button;
    }

    show(x, y, context) {
        if (!this.overlay || !this.panel) return;
        if (!context) context = this.createContext({ clientX: x, clientY: y, target: null });

        this._previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

        this.render(context);

        if (this.cursorDot && this.isDeveloperMode()) {
            const activeRadius = context.activeRadius ?? this.radius;
            const diameter = activeRadius * 2;
            this.cursorDot.style.left = `${x - activeRadius}px`;
            this.cursorDot.style.top = `${y - activeRadius}px`;
            this.cursorDot.style.width = `${diameter}px`;
            this.cursorDot.style.height = `${diameter}px`;
            this.cursorDot.style.border = '1px solid color-mix(in srgb, var(--os-accent, #5b7cff) 38%, transparent)';
            this.cursorDot.style.boxShadow = '0 0 0 1px color-mix(in srgb, var(--os-accent, #5b7cff) 13%, transparent)';
            this.cursorDot.style.background = 'radial-gradient(circle, color-mix(in srgb, var(--os-accent, #5b7cff) 8%, transparent) 0%, transparent 70%)';
            this.cursorDot.style.opacity = '1';
        } else if (this.cursorDot) {
            this.cursorDot.style.opacity = '0';
            this.cursorDot.style.width = '0';
            this.cursorDot.style.height = '0';
        }

        this.overlay.style.display = 'block';
        this.panel.style.visibility = 'hidden';
        this.panel.style.opacity = '0';
        this.panel.style.transform = 'translateY(4px) scale(0.97)';

        this.visible = true;

        requestAnimationFrame(() => {
            this.positionPanel(x, y, { focusFirst: true });
            this._emitPresence('open', context, { x, y });
        });

        this.console?.info?.('Smart context menu opened', {
            baseRadius: this.radius,
            activeRadius: context.activeRadius ?? this.radius,
            density: context.density ?? 0,
            nearbyCount: context.nearbyNodes.length,
            target: context.primaryNode ? { id: context.primaryNode.id, type: context.primaryNode.type } : null
        });
    }

    positionPanel(x, y, { focusFirst = false } = {}) {
        if (!this.panel) return;
        const panelRect = this.panel.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const offset = 14;
        let left = x + offset;
        let top = y + offset;
        if (left + panelRect.width > viewportWidth - 12) left = Math.max(12, x - panelRect.width - offset);
        if (top + panelRect.height > viewportHeight - 12) top = Math.max(12, y - panelRect.height - offset);
        this.panel.style.left = `${clamp(left, 12, Math.max(12, viewportWidth - panelRect.width - 12))}px`;
        this.panel.style.top = `${clamp(top, 12, Math.max(12, viewportHeight - panelRect.height - 12))}px`;
        this.panel.style.visibility = 'visible';
        this.panel.style.opacity = '1';
        this.panel.style.transform = 'translateY(0) scale(1)';
        if (focusFirst) this.getEnabledMenuItems()[0]?.focus();
    }

    hide({ restoreFocus = false } = {}) {
        if (!this.overlay || !this.panel) return;
        const previousContext = this.context;
        const wasVisible = this.visible;
        clearTimeout(this._typeaheadTimer);
        this._typeaheadBuffer = '';
        this.visible = false;
        this.panel.style.opacity = '0';
        this.panel.style.transform = 'translateY(4px) scale(0.97)';
        this.panel.style.visibility = 'hidden';
        if (this.cursorDot) {
            this.cursorDot.style.opacity = '0';
            this.cursorDot.style.width = '0';
            this.cursorDot.style.height = '0';
        }
        this.overlay.style.display = 'none';
        this.context = null;
        this.selectedNode = null;
        if (wasVisible) this._emitPresence('close', previousContext);
        if (restoreFocus && this._previousFocus?.isConnected) this._previousFocus.focus?.();
        this._previousFocus = null;
    }

    _emitPresence(phase, context = null, cursor = null) {
        if (!this.onPresenceChange) return;
        const panelRect = phase === 'open' && this.panel
            ? this.panel.getBoundingClientRect()
            : null;
        const primary = context?.primaryNode ?? null;
        const detail = Object.freeze({
            phase: phase === 'open' ? 'open' : 'close',
            cursor: cursor ? Object.freeze({ x: Number(cursor.x) || 0, y: Number(cursor.y) || 0 }) : null,
            anchor: panelRect ? Object.freeze({
                x: panelRect.x,
                y: panelRect.y,
                width: panelRect.width,
                height: panelRect.height,
            }) : null,
            target: primary ? Object.freeze({
                id: String(primary.id ?? '').slice(0, 160),
                type: String(primary.type ?? primary.role ?? '').slice(0, 80),
            }) : null,
        });
        try { this.onPresenceChange(detail); }
        catch (error) {
            this.console?.warn?.('Smart context presence callback failed', {
                message: error?.message || String(error),
            });
        }
    }

    toggle(x, y, context) {
        if (this.visible) {
            this.hide();
        } else {
            this.show(x, y, context);
        }
    }

    refresh() {
        if (this.visible && this.context) {
            this.render(this.context);
        }
    }
}
