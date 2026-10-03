// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WorkspaceSwitcher.js — HUD overlay for workspace switching.
 *
 * Architecture:
 * - Triggered by Ctrl+` (managed by WorkspaceManager)
 * - Shows thumbnails of all workspaces in grid layout
 * - Keyboard navigation with arrow keys
 * - Enter to switch to selected workspace
 * - Escape to close switcher
 *
 * UI pattern:
 * - Full-screen overlay with backdrop blur
 * - Centered card with workspace thumbnails
 * - Highlighted selection indicator
 * - CSS transitions for smooth show/hide
 *
 * Keyboard handling:
 * - Arrow keys: Navigate between workspaces
 * - Enter: Switch to selected workspace
 * - Escape: Close switcher without switching
 */

/**
 * WorkspaceSwitcher - HUD overlay for workspace navigation.
 *
 * HUD pattern:
 * - Full-screen overlay with backdrop blur
 * - Grid layout of workspace thumbnails
 * - Keyboard navigation support
 * - Smooth CSS transitions for show/hide
 */
export class WorkspaceSwitcher {
    /**
     * @param {Object} options
     * @param {HTMLElement} options.container
     * @param {WorkspaceManager} options.manager
     * @param {Function} [options.logger]
     */
    constructor(options) {
        this.container = options.container;
        this.manager   = options.manager;
        this.logger    = options.logger || { info: console.log, warn: console.warn, error: console.error };

        this.element   = null;
        this._visible  = false;
        this._selectedIndex = 0;
    }

    /**
     * Show the switcher overlay.
     *
     * Show pattern:
     * - Creates full-screen overlay element
     * - Backdrop blur for modern glassy effect
     * - Builds workspace thumbnail grid
     * - Animates in with opacity transition
     * - Sets up keyboard navigation handlers
     */
    show() {
        if (this._visible) return;
        this._visible = true;

        const el = document.createElement('div');
        el.id = 'plauna-workspace-switcher';
        el.className = 'plauna-workspace-switcher';
        Object.assign(el.style, {
            position:   'fixed',
            inset:      '0',
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display:    'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex:    '9999',
            opacity:    '0',
            transition: 'opacity 150ms ease',
        });

        const content = this._buildContent();
        el.appendChild(content);
        document.body.appendChild(el);
        this.element = el;

        // Animate in
        requestAnimationFrame(() => el.style.opacity = '1');

        // Set up keyboard nav
        this._setupKeyboardNav();
    }

    /**
     * Hide the switcher overlay.
     *
     * Hide pattern:
     * - Animates out with opacity transition
     * - Removes DOM element after transition completes
     * - Tears down keyboard navigation handlers
     */
    hide() {
        if (!this._visible) return;
        this._visible = false;

        if (this.element) {
            this.element.style.opacity = '0';
            setTimeout(() => {
                this.element?.remove();
                this.element = null;
            }, 150);
        }

        this._teardownKeyboardNav();
    }

    // ── Private ─────────────────────────────────────────────────────────────

    _buildContent() {
        const workspaces = this.manager.list();
        this._selectedIndex = workspaces.findIndex(ws => ws.id === this.manager._activeId);
        if (this._selectedIndex < 0) this._selectedIndex = 0;

        const container = document.createElement('div');
        Object.assign(container.style, {
            display:       'flex',
            flexDirection: 'column',
            gap:           '16px',
            padding:       '32px',
            background:    'var(--bg-secondary)',
            border:        '1px solid var(--border-medium)',
            borderRadius:  'var(--border-radius-xl)',
            boxShadow:     'var(--shadow-xl)',
            maxWidth:      '800px',
            maxHeight:     '80vh',
            overflowY:     'auto',
        });

        const header = document.createElement('div');
        header.textContent = 'Switch Workspace';
        Object.assign(header.style, {
            fontSize:   '18px',
            fontWeight: 'var(--font-weight-semibold)',
            color:      'var(--text-primary)',
        });
        container.appendChild(header);

        const grid = document.createElement('div');
        Object.assign(grid.style, {
            display:        'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap:            '12px',
        });

        workspaces.forEach((ws, idx) => {
            const card = this._buildWorkspaceCard(ws, idx);
            grid.appendChild(card);
        });

        container.appendChild(grid);

        const hint = document.createElement('div');
        hint.textContent = 'Arrow keys to navigate, Enter to switch, Esc to cancel';
        Object.assign(hint.style, {
            fontSize:   '12px',
            color:      'var(--text-tertiary)',
            textAlign:  'center',
            marginTop:  '8px',
        });
        container.appendChild(hint);

        return container;
    }

    _buildWorkspaceCard(ws, idx) {
        const card = document.createElement('div');
        const isSelected = idx === this._selectedIndex;

        Object.assign(card.style, {
            background: isSelected ? 'var(--color-primary)' : 'var(--bg-tertiary)',
            color:      isSelected ? '#fff' : 'var(--text-primary)',
            padding:     '16px',
            borderRadius: 'var(--border-radius-lg)',
            border:      isSelected ? '2px solid var(--color-primary)' : '1px solid var(--border-medium)',
            cursor:      'pointer',
            transition:  'all 100ms ease',
        });

        const name = document.createElement('div');
        name.textContent = ws.name;
        Object.assign(name.style, {
            fontSize:   '14px',
            fontWeight: 'var(--font-weight-semibold)',
            marginBottom: '4px',
        });
        card.appendChild(name);

        const meta = document.createElement('div');
        meta.textContent = `${ws.panelCount} panel${ws.panelCount !== 1 ? 's' : ''} · ${ws.layoutMode}`;
        Object.assign(meta.style, {
            fontSize:   '11px',
            opacity:    '0.8',
        });
        card.appendChild(meta);

        card.addEventListener('click', () => {
            this.manager.switchTo(ws.id);
            this.hide();
        });

        return card;
    }

    _setupKeyboardNav() {
        this._keydownHandler = e => {
            const workspaces = this.manager.list();
            if (e.key === 'Escape') {
                this.hide();
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                this._selectedIndex = (this._selectedIndex + 1) % workspaces.length;
                this._refreshSelection();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                this._selectedIndex = (this._selectedIndex - 1 + workspaces.length) % workspaces.length;
                this._refreshSelection();
            } else if (e.key === 'Enter') {
                const ws = workspaces[this._selectedIndex];
                if (ws) {
                    this.manager.switchTo(ws.id);
                    this.hide();
                }
            }
        };
        document.addEventListener('keydown', this._keydownHandler);
    }

    _teardownKeyboardNav() {
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
            this._keydownHandler = null;
        }
    }

    _refreshSelection() {
        if (!this.element) return;
        const cards = this.element.querySelectorAll('.plauna-workspace-switcher > div > div:nth-child(2) > div');
        cards.forEach((card, idx) => {
            const isSelected = idx === this._selectedIndex;
            card.style.background = isSelected ? 'var(--color-primary)' : 'var(--bg-tertiary)';
            card.style.color = isSelected ? '#fff' : 'var(--text-primary)';
            card.style.borderWidth = isSelected ? '2px' : '1px';
        });
    }
}
