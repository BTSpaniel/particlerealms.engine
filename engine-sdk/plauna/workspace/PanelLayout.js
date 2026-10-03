// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PanelLayout.js — Layout engine for arranging panels in a workspace.
 *
 * Modes:
 *   fullscreen — one panel fills the entire workspace
 *   float      — panels are free-position windows (drag/resize)
 *   split      — tmux/VS Code-style binary split tree (horizontal | vertical)
 *   tile       — auto-arranged fixed grid
 */

// ─────────────────────────────────────────────────────────────────────────────
// Layout Engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * LayoutEngine - Panel layout orchestration.
 *
 * Layout modes:
 * - fullscreen: First visible panel fills entire workspace
 * - float: Panels are free-position windows with drag/resize
 * - split: Binary tree layout (like tmux/VS Code) with recursive splits
 * - tile: Auto-arranged grid layout
 *
 * Architecture:
 * - Mode-based layout dispatch (apply() switches between modes)
 * - Split tree cached for efficiency (reused if panels unchanged)
 * - Z-index management for float mode (focused panel on top)
 * - Observer pattern for mode change notifications
 */
export class LayoutEngine {
    constructor() {
        this._mode = 'float';
        this._splitRoot = null; // SplitNode tree
        this._observer = null;
    }

    get mode() { return this._mode; }

    setMode(mode) {
        if (!['fullscreen', 'float', 'split', 'tile'].includes(mode)) return;
        this._mode = mode;
        this._emit('mode-changed', mode);
    }

    /** Apply layout to a list of panels. */
    apply(panels, containerRect) {
        const { width, height } = containerRect;

        switch (this._mode) {
            case 'fullscreen':
                this._applyFullscreen(panels, width, height);
                break;
            case 'float':
                this._applyFloat(panels);
                break;
            case 'split':
                this._applySplit(panels, width, height);
                break;
            case 'tile':
                this._applyTile(panels, width, height);
                break;
        }
    }

    // ── Fullscreen: first visible panel fills everything ─────────────────────

    _applyFullscreen(panels, width, height) {
        const p = panels.find(p => p.visible);
        if (!p) return;
        p.moveTo(0, 0);
        p.resize(width, height);
        p.zIndex = 1;
    }

    // ── Float: panels keep their manual position/size ────────────────────────

    _applyFloat(panels) {
        // No-op — panels are already positioned manually via drag/resize
        panels.forEach(p => {
            if (p.visible && p.focused) {
                p.zIndex = 10;
            } else if (p.visible) {
                p.zIndex = 1;
            }
        });
    }

    // ── Split: recursive binary tree layout ──────────────────────────────────

    _applySplit(panels, width, height) {
        // Build split tree if needed
        if (!this._splitRoot || this._splitRoot.panels !== panels) {
            this._buildSplitTree(panels);
        }
        if (!this._splitRoot) {
            this._applyFullscreen(panels, width, height);
            return;
        }
        this._traverseSplit(this._splitRoot, 0, 0, width, height);
    }

    _buildSplitTree(panels) {
        const visible = panels.filter(p => p.visible);
        if (visible.length <= 1) {
            this._splitRoot = null;
            return;
        }

        // Simple balanced split: alternate horizontal/vertical at each level
        this._splitRoot = this._splitRecursive(visible, 0);
        this._splitRoot.panels = panels; // cache reference
    }

    _splitRecursive(panels, depth) {
        if (panels.length === 1) {
            return { type: 'leaf', panel: panels[0] };
        }

        const isHorizontal = depth % 2 === 0;
        const mid = Math.ceil(panels.length / 2);
        const left  = this._splitRecursive(panels.slice(0, mid), depth + 1);
        const right = this._splitRecursive(panels.slice(mid), depth + 1);

        return {
            type: isHorizontal ? 'horizontal' : 'vertical',
            left,
            right,
        };
    }

    _traverseSplit(node, x, y, w, h) {
        if (node.type === 'leaf') {
            const p = node.panel;
            p.moveTo(x, y);
            p.resize(w, h);
            p.zIndex = 1;
            return;
        }

        const isHorizontal = node.type === 'horizontal';
        const ratio = 0.5; // 50/50 split (could be stored on node for drag-resize)

        if (isHorizontal) {
            const lw = w * ratio;
            const rw = w - lw;
            this._traverseSplit(node.left,  x,     y, lw, h);
            this._traverseSplit(node.right, x + lw, y, rw, h);
        } else {
            const lh = h * ratio;
            const rh = h - lh;
            this._traverseSplit(node.left,  x, y,     w, lh);
            this._traverseSplit(node.right, x, y + lh, w, rh);
        }
    }

    // ── Tile: fixed grid auto-layout ───────────────────────────────────────────

    _applyTile(panels, width, height) {
        const visible = panels.filter(p => p.visible);
        if (visible.length === 0) return;

        // Compute grid dimensions (as square as possible)
        const cols = Math.ceil(Math.sqrt(visible.length));
        const rows = Math.ceil(visible.length / cols);

        const cellW = width / cols;
        const cellH = height / rows;

        visible.forEach((p, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            p.moveTo(col * cellW, row * cellH);
            p.resize(cellW, cellH);
            p.zIndex = 1;
        });
    }

    // ── Events ───────────────────────────────────────────────────────────────

    on(event, fn) {
        if (!this._observer) this._observer = new Map();
        const set = this._observer.get(event) || new Set();
        set.add(fn);
        this._observer.set(event, set);
        return () => set.delete(fn);
    }

    _emit(event, data) {
        const set = this._observer?.get(event);
        if (set) set.forEach(fn => { try { fn(data); } catch { /* ignore */ } });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout mode constants
// ─────────────────────────────────────────────────────────────────────────────

export const LayoutMode = {
    FULLSCREEN: 'fullscreen',
    FLOAT:      'float',
    SPLIT:      'split',
    TILE:       'tile',
};
