// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Panel.js — Base panel and two concrete flavours:
 *   DOMPanel  — a positioned <div> container for Plauna widgets / HTML content
 *   GPUPanel  — owns a GPUTexture render target; blitted to canvas by WorkspaceCompositor
 *
 * Lifecycle:  create → mount(container) → [resize / focus / show / hide] → destroy()
 */

let _nextId = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Base Panel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Panel - Base class for workspace panels.
 *
 * Architecture pattern:
 * - Abstract base class for DOMPanel and GPUPanel
 * - Lifecycle: create → mount → [resize/focus/show/hide] → destroy
 * - Observer pattern for event emission (move, resize, visibility, focus, blur)
 * - Position/size constraints with min-size enforcement
 * - Z-index management for panel stacking
 *
 * Panel types:
 * - DOMPanel: Renders Plauna widgets in DOM elements
 * - GPUPanel: Renders to WebGPU textures, composited by WorkspaceCompositor
 */
export class Panel {
    /**
     * @param {Object} options
     * @param {string}  [options.id]
     * @param {string}  [options.title='Panel']
     * @param {Object}  [options.position]   { x, y } in px (float mode)
     * @param {Object}  [options.size]       { width, height } in px
     * @param {Object}  [options.minSize]    { width, height } in px
     * @param {boolean} [options.resizable=true]
     * @param {boolean} [options.draggable=true]
     * @param {boolean} [options.closable=true]
     * @param {number}  [options.zIndex=1]
     */
    constructor(options = {}) {
        this.id        = options.id || `panel-${_nextId++}`;
        this.title     = options.title     || 'Panel';
        this.icon      = options.icon      || '';   // emoji glyph OR image/video URL (data:/http(s))
        this.accent    = options.accent    || null; // optional title-bar accent color (e.g. PWA theme_color)
        this.position  = options.position  || { x: 0, y: 0 };
        this.size      = options.size      || { width: 400, height: 300 };
        this.minSize   = options.minSize   || { width: 120, height: 80 };
        this.resizable = options.resizable !== false;
        this.draggable = options.draggable !== false;
        this.closable  = options.closable  !== false;
        this.zIndex    = options.zIndex    || 1;

        this.visible   = true;
        this.focused   = false;
        this._mounted  = false;
        this._observers = new Set();
    }

    /** @returns {'dom'|'gpu'} */
    get type() { return 'base'; }

    /**
     * Mount panel into container.
     *
     * Lifecycle hook called by Workspace.addPanel:
     * - Sets mounted flag to true
     * - Subclasses override to create DOM elements or GPU resources
     * - Called once per panel lifetime
     */
    mount(_container) {
        this._mounted = true;
    }

    /**
     * Destroy panel and release resources.
     *
     * Lifecycle cleanup:
     * - Sets mounted flag to false
     * - Clears all observers to prevent memory leaks
     * - Subclasses override to remove DOM elements or release GPU resources
     */
    destroy() {
        this._mounted = false;
        this._observers.clear();
    }

    show()  { this.visible = true;  this._emit('visibility', true);  }
    hide()  { this.visible = false; this._emit('visibility', false); }
    focus() { this.focused = true;  this._emit('focus', this);       }
    blur()  { this.focused = false; this._emit('blur',  this);       }

    /**
     * Update position (float layout).
     * @param {number} x
     * @param {number} y
     */
    moveTo(x, y) {
        this.position.x = x;
        this.position.y = y;
        this._emit('move', { x, y });
    }

    /**
     * Update size — both DOM and GPU subclasses override to respond.
     * @param {number} width
     * @param {number} height
     */
    resize(width, height) {
        width  = Math.max(width,  this.minSize.width);
        height = Math.max(height, this.minSize.height);
        this.size.width  = width;
        this.size.height = height;
        this._emit('resize', { width, height });
    }

    /** Subscribe to panel events. Returns an unsubscribe function. */
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
            id:       this.id,
            type:     this.type,
            title:    this.title,
            position: { ...this.position },
            size:     { ...this.size },
            visible:  this.visible,
            zIndex:   this.zIndex,
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DOMPanel — a Plauna widget / HTML div panel
// ─────────────────────────────────────────────────────────────────────────────

export class DOMPanel extends Panel {
    /**
     * @param {Object} options
     * @param {Function} [options.onMount]   (element) => void  — called with root <div>
     * @param {string}   [options.html]      — static HTML string to inject (simple use)
     * @param {string}   [options.className] — extra CSS class on the root div
     * @param {string}   [options.closeLabel='Close window'] — accessible close-action description
     */
    constructor(options = {}) {
        super(options);
        this._onMount  = options.onMount  || null;
        this._html     = options.html     || null;
        this._className = options.className || '';
        this.closeLabel = options.closeLabel || 'Close window';
        this.element   = null;
        this._dragState = null;
        this._resizeState = null;
        this._minimized      = false;
        this._maximized      = false;
        this._savedSize      = null;
        this._savedPosition  = null;
    }

    get type() { return 'dom'; }

    static _ensureOpenAnim() {
        if (document.getElementById('plauna-panel-open-anim')) return;
        const s = document.createElement('style');
        s.id = 'plauna-panel-open-anim';
        s.textContent = '@keyframes panel-open{from{opacity:0;transform:scale(0.95) translateY(8px)}to{opacity:1;transform:none}}';
        document.head.appendChild(s);
    }

    mount(container) {
        super.mount(container);
        DOMPanel._ensureOpenAnim();

        const el = document.createElement('div');
        el.id = `plauna-panel-${this.id}`;
        el.className = ['plauna-panel', 'plauna-panel--dom', this._className].filter(Boolean).join(' ');
        el.setAttribute('data-panel-id', this.id);

        Object.assign(el.style, {
            position:  'absolute',
            left:      `${this.position.x}px`,
            top:       `${this.position.y}px`,
            width:     `${this.size.width}px`,
            height:    `${this.size.height}px`,
            zIndex:    String(this.zIndex),
            display:   this.visible ? 'flex' : 'none',
            flexDirection: 'column',
            background:  'var(--bg-secondary)',
            border:      '1px solid var(--border-medium)',
            borderRadius: 'var(--border-radius-lg)',
            boxShadow:   'var(--shadow-lg)',
            overflow:    'hidden',
            contain:     'layout style paint',
            willChange:  'transform',
            animation:   'panel-open 0.20s cubic-bezier(0.22,1,0.36,1) both',
        });
        el.addEventListener('animationend', () => { el.style.animation = ''; }, { once: true });

        // Title bar
        const titleBar = this._buildTitleBar();
        this.titleBar = titleBar;
        el.appendChild(titleBar);

        // Content area
        const content = document.createElement('div');
        content.className = 'plauna-panel__content';
        Object.assign(content.style, {
            flex:               '1',
            overflow:           'auto',
            position:           'relative',
            willChange:         'scroll-position',
            overscrollBehavior: 'contain',
        });
        el.appendChild(content);

        // Resize handles — 4 corners + 4 edges. Each resizes from its own
        // side/corner; holding Shift resizes symmetrically about the center.
        if (this.resizable) this._buildResizeHandles(el);

        this.element = el;
        this.contentEl = content;
        container.appendChild(el);

        // Mount user content
        if (this._html) content.innerHTML = this._html;
        if (this._onMount) this._onMount(content);

        // Focus on click
        el.addEventListener('mousedown', () => this._emit('focus', this), true);

        this.on('resize', ({ width, height }) => this._applySize(width, height));
        this.on('move',   ({ x, y })          => this._applyPosition(x, y));
        this.on('visibility', v => { el.style.display = v ? 'flex' : 'none'; });

        // Live-rebuild titlebar when window-control settings change
        this._wcObserver = new MutationObserver(() => {
            if (!this.titleBar?.isConnected) return;
            const newBar = this._buildTitleBar();
            this.titleBar.replaceWith(newBar);
            this.titleBar = newBar;
        });
        this._wcObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-wc-position', 'data-wc-type', 'data-wc-show-minmax'],
        });
    }

    destroy() {
        this._wcObserver?.disconnect();
        this._wcObserver = null;
        this._hidePointerShield();
        this.element?.remove();
        this.element = null;
        super.destroy();
    }

    // ── Private ──────────────────────────────────────────────────────────────

    _buildTitleBar() {
        // Three independent axes — each settable separately or via OS preset
        const ds         = document.documentElement.dataset;
        const onRight    = (ds.wcPosition   ?? 'left')    === 'right';
        const useFlat    = (ds.wcType       ?? 'circles') === 'flat';
        const useArrow   = (ds.wcType       ?? 'circles') === 'arrow';
        const showMinMax = (ds.wcShowMinmax ?? 'true')    !== 'false';

        const bar = document.createElement('div');
        bar.className = 'plauna-panel__titlebar';
        Object.assign(bar.style, {
            display: 'flex', alignItems: 'center', gap: '0',
            padding: useFlat ? (onRight ? '0 0 0 10px' : '0') : '0 10px 0 8px',
            height: '32px', flexShrink: '0',
            // Optional per-app accent (e.g. PWA theme_color) tints the chrome;
            // otherwise fall back to the OS panel-chrome variable.
            background:   this.accent
                ? `linear-gradient(180deg, ${this.accent}, color-mix(in srgb, ${this.accent} 78%, #000))`
                : 'var(--os-panel-chrome)',
            borderBottom: '1px solid rgba(0,0,0,0.18)',
            userSelect:   'none',
            cursor:       this.draggable ? 'grab' : 'default',
        });

        // ── Shared action wires ────────────────────────────────────────────────
        const _wireClose = (b) => {
            b.setAttribute('aria-label', this.closeLabel);
            b.title = this.closeLabel;
            b.addEventListener('click', e => {
                e.stopPropagation(); this.hide(); this._emit('close', this);
            });
        };
        const _wireMin = (b) => b.addEventListener('click', e => {
            e.stopPropagation();
            // A real OS minimize hides the window to the taskbar/dock — not a
            // window-shade roll-up. When a host (the OS shell) listens for
            // 'minimize', delegate to it so it can hide + add a taskbar entry.
            // Only fall back to the local roll-up when running standalone with
            // no host handling minimize.
            const hasHost = [...this._observers].some(o => o.event === 'minimize');
            if (hasHost) { this._emit('minimize', this); return; }

            if (this._minimized) {
                this._minimized = false;
                if (this.contentEl) this.contentEl.style.display = '';
                this._setResizeHandlesVisible(true);
                if (this.element)   this.element.style.height    = `${this.size.height}px`;
            } else {
                this._minimized = true;
                if (this.contentEl) this.contentEl.style.display = 'none';
                this._setResizeHandlesVisible(false);
                if (this.element)   this.element.style.height    = '32px';
            }
        });
        const _wireMax = (b) => b.addEventListener('click', e => {
            e.stopPropagation(); this._toggleMaximize();
        });

        // ── Button factories ───────────────────────────────────────────────────

        // Circle (macOS / Linux / iOS) — color from CSS vars
        const mkCircle = (cssVar, symbol, cls) => {
            const b = document.createElement('button');
            b.className = `plauna-panel__wc-btn ${cls}`;
            b.title = cls.split('-').pop();
            Object.assign(b.style, {
                width: '12px', height: '12px', borderRadius: '50%',
                border: 'none', background: `var(${cssVar})`,
                cursor: 'pointer', padding: '0',
                fontSize: '8px', fontWeight: '700',
                color: 'transparent', lineHeight: '12px',
                textAlign: 'center', flexShrink: '0',
                transition: 'filter .1s, transform .1s', fontFamily: 'inherit',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25),inset 0 -1px 0 rgba(0,0,0,0.18),0 1px 3px rgba(0,0,0,0.3)',
            });
            b.addEventListener('mouseenter', () => { b.textContent = symbol; b.style.color = 'rgba(0,0,0,.65)'; b.style.filter = 'brightness(1.12)'; b.style.transform = 'scale(1.1)'; });
            b.addEventListener('mouseleave', () => { b.textContent = ''; b.style.color = 'transparent'; b.style.filter = ''; b.style.transform = ''; });
            return b;
        };

        // Flat rectangle (Windows) — close hover uses --os-dot-close so Color/Mono/Accent applies
        const mkRect = (symbol, cls) => {
            const b = document.createElement('button');
            b.className = `plauna-panel__wc-btn ${cls}`;
            b.title = cls.split('-').pop(); b.textContent = symbol;
            const isClose = cls.includes('close');
            Object.assign(b.style, {
                width: '46px', height: '32px', borderRadius: '0',
                border: 'none', background: 'transparent',
                cursor: 'pointer', padding: '0',
                fontSize: '12px', fontWeight: '400',
                color: 'rgba(255,255,255,0.72)', lineHeight: '32px',
                textAlign: 'center', flexShrink: '0',
                transition: 'background .1s, color .1s', fontFamily: 'inherit',
            });
            // Use --os-dot-close so the Color/Mono/Accent setting applies here too
            b.addEventListener('mouseenter', () => {
                b.style.background = isClose
                    ? getComputedStyle(document.documentElement).getPropertyValue('--os-dot-close').trim() || '#c42b1c'
                    : 'rgba(255,255,255,0.12)';
                b.style.color = '#fff';
            });
            b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; b.style.color = 'rgba(255,255,255,0.72)'; });
            return b;
        };

        // Back arrow (Android)
        const mkBack = () => {
            const b = document.createElement('button');
            b.className = 'plauna-panel__wc-btn plauna-panel__wc-close';
            b.title = 'Back'; b.textContent = '←';
            Object.assign(b.style, {
                width: '36px', height: '32px', border: 'none',
                background: 'transparent', color: 'rgba(255,255,255,0.85)',
                fontSize: '18px', cursor: 'pointer',
                borderRadius: '4px', transition: 'background .1s',
                fontFamily: 'inherit', marginRight: '6px',
            });
            b.addEventListener('mouseenter', () => { b.style.background = 'rgba(255,255,255,0.1)'; });
            b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
            return b;
        };

        // ── Title (shared) ─────────────────────────────────────────────────────
        const titleEl = document.createElement('span');
        titleEl.className = 'plauna-panel__title';
        titleEl.textContent = this.title;
        Object.assign(titleEl.style, {
            flex: '1', fontSize: '12px', fontWeight: '700',
            color: 'rgba(255,255,255,0.95)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            textShadow: '0 1px 2px rgba(0,0,0,0.35)', letterSpacing: '0.01em',
            padding: useArrow ? '0 0 0 4px' : '0',
            display: 'flex', alignItems: 'center', gap: '6px',
        });
        // Optional app icon (emoji or image/video) before the title text.
        const iconEl = this._buildTitleIcon();
        if (iconEl) titleEl.prepend(iconEl);

        // ── Compose layout from axes ───────────────────────────────────────────

        if (useArrow) {
            // Arrow type: [ ← ] [ Title ] — position axis ignored
            const backBtn = mkBack();
            if (this.closable) _wireClose(backBtn);
            bar.appendChild(backBtn);
            bar.appendChild(titleEl);

        } else {
            const btnGroup = document.createElement('div');
            btnGroup.className = 'plauna-panel__wc-group';
            Object.assign(btnGroup.style, {
                display: 'flex', alignItems: 'center',
                gap: useFlat ? '0' : '6px', flexShrink: '0',
                // On right: push group to far end; on left: give right margin
                [onRight ? 'marginLeft' : 'marginRight']: useFlat ? '0' : '8px',
            });

            if (useFlat) {
                // Flat: Windows button order — min, max come BEFORE close on right;
                //       reverse when on left so close is still the outermost
                if (onRight) {
                    if (showMinMax) { const b = mkRect('─', 'plauna-panel__wc-min'); _wireMin(b); btnGroup.appendChild(b); }
                    if (showMinMax) { const b = mkRect('□', 'plauna-panel__wc-max'); _wireMax(b); btnGroup.appendChild(b); }
                    if (this.closable) { const b = mkRect('✕', 'plauna-panel__wc-close'); _wireClose(b); btnGroup.appendChild(b); }
                } else {
                    if (this.closable) { const b = mkRect('✕', 'plauna-panel__wc-close'); _wireClose(b); btnGroup.appendChild(b); }
                    if (showMinMax) { const b = mkRect('□', 'plauna-panel__wc-max'); _wireMax(b); btnGroup.appendChild(b); }
                    if (showMinMax) { const b = mkRect('─', 'plauna-panel__wc-min'); _wireMin(b); btnGroup.appendChild(b); }
                }
            } else {
                // Circles: close always first (outermost edge), then min, max
                if (this.closable) { const b = mkCircle('--os-dot-close', '✕', 'plauna-panel__wc-close'); _wireClose(b); btnGroup.appendChild(b); }
                if (showMinMax) { const b = mkCircle('--os-dot-min', '–', 'plauna-panel__wc-min'); _wireMin(b); btnGroup.appendChild(b); }
                if (showMinMax) { const b = mkCircle('--os-dot-max', '+', 'plauna-panel__wc-max'); _wireMax(b); btnGroup.appendChild(b); }
            }

            if (onRight) {
                bar.appendChild(titleEl);
                bar.appendChild(btnGroup);
            } else {
                bar.appendChild(btnGroup);
                bar.appendChild(titleEl);
            }
        }

        if (this.draggable) {
            bar.addEventListener('mousedown', e => this._onDragStart(e));
            bar.addEventListener('dblclick',  e => {
                if (e.target.tagName === 'BUTTON') return;
                this._toggleMaximize();
            });
        }

        return bar;
    }

    /**
     * Build the title-bar icon element from `this.icon`, or null if none.
     * Accepts an emoji/glyph (rendered as text) or an image/video URL
     * (data:/blob:/http(s) with a known extension → <img>/<video>). Kept
     * self-contained so Plauna has no dependency on the host shell.
     */
    _buildTitleIcon() {
        const v = String(this.icon || '').trim();
        if (!v) return null;
        const isImg = /^(data:image\/|blob:)/i.test(v)
            || (/^https?:\/\//i.test(v) && /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)(\?|#|$)/i.test(v));
        const isVid = /^data:video\//i.test(v)
            || (/^https?:\/\//i.test(v) && /\.(webm|mp4|m4v|mov)(\?|#|$)/i.test(v));

        let el;
        if (isImg) {
            el = document.createElement('img');
            el.src = v; el.alt = ''; el.decoding = 'async'; el.draggable = false;
        } else if (isVid) {
            el = document.createElement('video');
            el.src = v; el.muted = true; el.autoplay = true; el.loop = true; el.playsInline = true;
            el.setAttribute('muted', ''); el.setAttribute('playsinline', '');
            try { el.disablePictureInPicture = true; } catch {}
        } else {
            el = document.createElement('span');
            el.textContent = v;            // emoji / glyph
            el.style.fontSize = '13px';
        }
        el.className = 'plauna-panel__title-icon';
        Object.assign(el.style, { flexShrink: '0', pointerEvents: 'none', lineHeight: '1' });
        if (isImg || isVid) {
            Object.assign(el.style, { width: '14px', height: '14px', objectFit: 'cover', borderRadius: '4px', display: 'block' });
            el.play?.().catch?.(() => {});
        }
        return el;
    }

    /** Update the title-bar icon and rebuild the bar in place. */
    setIcon(icon) {
        this.icon = icon || '';
        if (this.titleBar?.isConnected) {
            const newBar = this._buildTitleBar();
            this.titleBar.replaceWith(newBar);
            this.titleBar = newBar;
        }
    }

    _toggleMaximize() {
        if (this._maximized) {
            this._maximized = false;
            if (this._savedSize) {
                this.size.width  = this._savedSize.width;
                this.size.height = this._savedSize.height;
                this._applySize(this._savedSize.width, this._savedSize.height);
            }
            if (this._savedPosition) {
                this.position.x = this._savedPosition.x;
                this.position.y = this._savedPosition.y;
                this._applyPosition(this._savedPosition.x, this._savedPosition.y);
            }
            if (this.element) this.element.style.borderRadius = '';
        } else {
            this._maximized     = true;
            this._savedSize     = { ...this.size };
            this._savedPosition = { ...this.position };
            const container = this.element?.parentElement;
            const w = container?.clientWidth  ?? window.innerWidth;
            const h = container?.clientHeight ?? window.innerHeight;
            this.size.width  = w;
            this.size.height = h;
            this._applySize(w, h);
            this._applyPosition(0, 0);
            if (this.element) this.element.style.borderRadius = '0';
        }
        this._emit('maximize', { maximized: this._maximized });
        if (!this._maximized) this.ensureOnScreen();
    }

    maximize()        { if (!this._maximized) this._toggleMaximize(); }
    unmaximize()      { if (this._maximized)  this._toggleMaximize(); }
    get isMaximized() { return this._maximized; }

    /**
     * Clamp (x,y) so a reachable strip of the titlebar always stays inside the
     * work area — prevents dragging/restoring a window fully off-screen.
     */
    _clampToWorkArea(x, y) {
        // Use the live desktop container as the work area. Its height already
        // excludes the bottom taskbar (flex layout), so it's the true reachable box.
        const parent = this.element?.parentElement;
        const pr = parent ? parent.getBoundingClientRect() : null;
        const tb = parseInt(
            getComputedStyle(document.documentElement).getPropertyValue('--os-taskbar-h') || '0', 10) || 0;
        const vw = pr ? pr.width  : window.innerWidth;
        const vh = pr ? pr.height : (window.innerHeight - tb);
        const titleH = this.titleBar?.offsetHeight || 40;   // keep the WHOLE titlebar visible
        const MARGIN = 90;                                  // min reachable titlebar width on the sides
        const TOP_GAP = 6;                                  // small visible gap above the titlebar
        const w = this.size.width;
        return {
            // The titlebar's top stays a few px below the work-area top (edge always
            // visible), and its full height stays visible at the bottom too.
            x: Math.max(MARGIN - w, Math.min(vw - MARGIN, x)),
            y: Math.max(TOP_GAP,    Math.min(Math.max(TOP_GAP, vh - titleH), y)),
        };
    }

    /** Re-clamp into the visible work area (e.g. after a viewport/resolution change). */
    ensureOnScreen() {
        if (this._maximized) {
            const c = this.element?.parentElement;
            const w = c?.clientWidth  ?? window.innerWidth;
            const h = c?.clientHeight ?? window.innerHeight;
            this.size.width = w; this.size.height = h;
            this._applySize(w, h); this._applyPosition(0, 0);
            return;
        }
        const c = this.element?.parentElement;
        const maxW = Math.max(1, c?.clientWidth ?? window.innerWidth);
        const maxH = Math.max(1, c?.clientHeight ?? window.innerHeight);
        const nextW = Math.min(this.size.width, maxW);
        const nextH = Math.min(this.size.height, maxH);
        if (nextW !== this.size.width || nextH !== this.size.height) {
            this.size.width = nextW;
            this.size.height = nextH;
            this._applySize(nextW, nextH);
            this._emit('resize', { width: nextW, height: nextH });
        }
        const p = this._clampToWorkArea(this.position.x, this.position.y);
        if (p.x !== this.position.x || p.y !== this.position.y) {
            this.position.x = p.x; this.position.y = p.y;
            this._applyPosition(p.x, p.y);
            this._emit('move', { x: p.x, y: p.y });
        }
    }

    _applySize(width, height) {
        if (!this.element) return;
        this.element.style.width  = `${width}px`;
        this.element.style.height = `${height}px`;
    }

    _applyPosition(x, y) {
        if (!this.element) return;
        this.element.style.left = `${x}px`;
        this.element.style.top  = `${y}px`;
    }

    /**
     * Full-viewport transparent overlay installed for the duration of a drag or
     * resize. It sits above every window's content — crucially above guest
     * <iframe>s, which otherwise swallow mousemove/mouseup the moment the cursor
     * crosses them, freezing the gesture and making the window "jump" to catch up.
     * The shield keeps all pointer events flowing to the document listeners until
     * the gesture ends.
     */
    _showPointerShield(cursor) {
        if (this._pointerShield) { this._pointerShield.style.cursor = cursor || 'grabbing'; return; }
        const s = document.createElement('div');
        s.className = 'plauna-pointer-shield';
        Object.assign(s.style, {
            position: 'fixed', inset: '0', zIndex: '2147483647',
            cursor: cursor || 'grabbing', background: 'transparent',
        });
        document.body.appendChild(s);
        this._pointerShield = s;
    }

    _hidePointerShield() {
        this._pointerShield?.remove();
        this._pointerShield = null;
    }

    _onDragStart(e) {
        if (e.target.tagName === 'BUTTON') return;
        e.preventDefault();

        const startCX = e.clientX;
        const startCY = e.clientY;
        const origX   = this.position.x;
        const origY   = this.position.y;

        // Opt out of motion (reduced-motion) → rigid 1:1 drag, instant commit.
        const motion = document.documentElement.dataset.panelTilt !== 'off';
        if (!motion) {
            let fX = origX, fY = origY;
            const onMove = ev => {
                const want = this._clampToWorkArea(origX + (ev.clientX - startCX), origY + (ev.clientY - startCY));
                fX = want.x; fY = want.y;
                if (this.element) this.element.style.transform = `translate(${fX - origX}px,${fY - origY}px)`;
                this._emit('drag', { x: fX, y: fY, clientX: ev.clientX, clientY: ev.clientY });
            };
            const onUp = ev => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup',   onUp);
                this._hidePointerShield();
                if (this.element) { this.element.style.transform = ''; this.element.style.cursor = ''; }
                this.position.x = fX; this.position.y = fY;
                this._applyPosition(fX, fY);
                this._emit('move', { x: fX, y: fY, source: 'drag' });
                this._emit('dragend', { x: fX, y: fY, clientX: ev?.clientX ?? startCX, clientY: ev?.clientY ?? startCY });
            };
            if (this.element) this.element.style.cursor = 'grabbing';
            this._showPointerShield('grabbing');
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup',   onUp);
            return;
        }

        // ── Elastic "lift & drag" (physics-grab feel) ─────────────────────────
        // The panel springs toward the cursor target with a slight lag, lifts
        // toward the viewer while held, tilts toward the pull, and settles with
        // momentum on release — mirroring the editor's spring-damper object grab.
        let tgtDX = 0, tgtDY = 0;   // cursor-driven target delta
        let renX  = 0, renY  = 0;   // eased (rendered) delta — trails the target
        let tiltX = 0, tiltY = 0;
        let lift  = 0;              // 0..1 grab-lift amount
        let dragging = true;
        let rafId = 0;
        let lastClientX = startCX, lastClientY = startCY;

        const SPRING = 0.30, TILT_K = 0.18, LIFT_K = 0.20;
        const TOP_GAP = 6;   // keep the titlebar edge a few px below the work-area top

        if (this.element) {
            this.element.style.cursor     = 'grabbing';
            this.element.style.willChange = 'transform';
        }

        const apply = () => {
            // Spring the rendered delta toward the cursor target.
            renX += (tgtDX - renX) * SPRING;
            renY += (tgtDY - renY) * SPRING;

            // Stretch (trail behind the cursor) drives the tilt and feels physical.
            const sx = tgtDX - renX, sy = tgtDY - renY;
            const tgtTiltY = Math.max(-16, Math.min(16,  sx * 0.9));
            const tgtTiltX = Math.max(-16, Math.min(16, -sy * 0.9));
            tiltX += (tgtTiltX - tiltX) * TILT_K;
            tiltY += (tgtTiltY - tiltY) * TILT_K;

            lift += ((dragging ? 1 : 0) - lift) * LIFT_K;
            const scale = 1 + 0.03 * lift;

            // Hard floor: the rendered top can never rise above the work-area top
            // gap, so the lift/scale can never tuck the titlebar out of reach.
            const ry = Math.max(renY, TOP_GAP - origY);

            if (this.element) {
                this.element.style.transform =
                    `perspective(1400px) translate(${renX.toFixed(1)}px,${ry.toFixed(1)}px) ` +
                    `translateZ(${(42 * lift).toFixed(1)}px) ` +
                    `rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
                this.element.style.boxShadow = lift > 0.02
                    ? `0 ${(8 + 26 * lift).toFixed(0)}px ${(20 + 44 * lift).toFixed(0)}px rgba(0,0,0,${(0.22 + 0.26 * lift).toFixed(2)})`
                    : '';
            }

            // After release, let the spring settle into place, then commit once.
            if (!dragging && Math.hypot(tgtDX - renX, tgtDY - renY) < 0.4 && lift < 0.02) {
                const fX = origX + tgtDX, fY = origY + tgtDY;
                if (this.element) {
                    this.element.style.transform  = '';
                    this.element.style.boxShadow  = '';
                    this.element.style.cursor     = '';
                    this.element.style.willChange = '';
                }
                this.position.x = fX; this.position.y = fY;
                this._applyPosition(fX, fY);
                this._emit('move', { x: fX, y: fY, source: 'drag' });
                this._emit('dragend', { x: fX, y: fY, clientX: lastClientX, clientY: lastClientY });
                rafId = 0;
                return;
            }
            rafId = requestAnimationFrame(apply);
        };

        const onMove = ev => {
            lastClientX = ev.clientX; lastClientY = ev.clientY;
            const want = this._clampToWorkArea(origX + (ev.clientX - startCX), origY + (ev.clientY - startCY));
            tgtDX = want.x - origX;
            tgtDY = want.y - origY;
            this._emit('drag', { x: want.x, y: want.y, clientX: ev.clientX, clientY: ev.clientY });
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup',   onUp);
            this._hidePointerShield();
            dragging = false;   // spring settles into place (momentum), then commits
        };

        rafId = requestAnimationFrame(apply);
        this._showPointerShield('grabbing');
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
    }

    /**
     * Build the 8 resize handles (corners + edges) into the panel root. Each
     * carries a direction string (n/s/e/w combos) consumed by _onResizeStart.
     */
    _buildResizeHandles(el) {
        const defs = [
            { dir: 'nw', cursor: 'nw-resize', css: { top: '0',    left: '0',    width: '14px', height: '14px' } },
            { dir: 'ne', cursor: 'ne-resize', css: { top: '0',    right: '0',   width: '14px', height: '14px' } },
            { dir: 'sw', cursor: 'sw-resize', css: { bottom: '0', left: '0',    width: '14px', height: '14px' } },
            { dir: 'se', cursor: 'se-resize', css: { bottom: '0', right: '0',   width: '14px', height: '14px' } },
            { dir: 'n',  cursor: 'n-resize',  css: { top: '0',    left: '14px', right: '14px',  height: '6px' } },
            { dir: 's',  cursor: 's-resize',  css: { bottom: '0', left: '14px', right: '14px',  height: '6px' } },
            { dir: 'w',  cursor: 'w-resize',  css: { left: '0',   top: '14px',  bottom: '14px', width: '6px' } },
            { dir: 'e',  cursor: 'e-resize',  css: { right: '0',  top: '14px',  bottom: '14px', width: '6px' } },
        ];
        this._resizeHandles = [];
        for (const d of defs) {
            const h = document.createElement('div');
            h.className = `plauna-panel__resize-handle plauna-panel__resize-${d.dir}`;
            Object.assign(h.style, { position: 'absolute', zIndex: '10', cursor: d.cursor, touchAction: 'none' });
            Object.assign(h.style, d.css);
            h.addEventListener('mousedown', ev => this._onResizeStart(ev, d.dir, d.cursor));
            el.appendChild(h);
            this._resizeHandles.push(h);
        }
        // SE kept for minimize show/hide compatibility.
        this._rhEl = this._resizeHandles[3];
    }

    _setResizeHandlesVisible(v) {
        for (const h of (this._resizeHandles ?? [])) h.style.display = v ? '' : 'none';
    }

    /**
     * Resize from one edge/corner. `dir` is any combination of n/s/e/w.
     * Holding Shift resizes symmetrically about the window's center so all
     * sides change equally (the center stays fixed); otherwise the opposite
     * edge stays anchored.
     */
    _onResizeStart(e, dir = 'se', cursor = 'se-resize') {
        e.preventDefault();
        e.stopPropagation();
        // Resizing a maximized window transitions it back to a floating window.
        if (this._maximized) { this._maximized = false; if (this.element) this.element.style.borderRadius = ''; }
        const startW = this.size.width;
        const startH = this.size.height;
        const startX = this.position.x;
        const startY = this.position.y;
        const startCX = e.clientX;
        const startCY = e.clientY;
        const left   = dir.includes('w');
        const right  = dir.includes('e');
        const top    = dir.includes('n');
        const bottom = dir.includes('s');
        const minW = this.minSize.width;
        const minH = this.minSize.height;

        const onMove = ev => {
            const dx = ev.clientX - startCX;
            const dy = ev.clientY - startCY;
            let newW = startW, newH = startH, newX = startX, newY = startY;

            if (ev.shiftKey) {
                // Symmetric about the fixed center — opposite edges move equally.
                const cx = startX + startW / 2;
                const cy = startY + startH / 2;
                if (left || right) {
                    const s = right ? 1 : -1;
                    newW = Math.max(minW, startW + 2 * s * dx);
                    newX = cx - newW / 2;
                }
                if (top || bottom) {
                    const s = bottom ? 1 : -1;
                    newH = Math.max(minH, startH + 2 * s * dy);
                    newY = cy - newH / 2;
                }
            } else {
                if (right)  newW = Math.max(minW, startW + dx);
                if (bottom) newH = Math.max(minH, startH + dy);
                if (left)   { newW = Math.max(minW, startW - dx); newX = startX + (startW - newW); }
                if (top)    { newH = Math.max(minH, startH - dy); newY = startY + (startH - newH); }
            }

            this.size.width = newW; this.size.height = newH;
            this.position.x = newX; this.position.y = newY;
            this._applySize(newW, newH);
            this._applyPosition(newX, newY);
            this._emit('resize', { width: newW, height: newH });
            if (newX !== startX || newY !== startY) this._emit('move', { x: newX, y: newY });
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            this._hidePointerShield();
        };
        this._showPointerShield(cursor);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GPUPanel — owns a WebGPU texture render target
// ─────────────────────────────────────────────────────────────────────────────

export class GPUPanel extends Panel {
    /**
     * @param {Object} options
     * @param {Function} options.onRender  (renderPass, ctx) => void  — called each frame
     *   ctx = { device, format, width, height, texture, view }
     * @param {string}  [options.alphaMode='premultiplied']
     */
    constructor(options = {}) {
        super(options);
        this._onRender  = options.onRender  || null;
        this._alphaMode = options.alphaMode || 'premultiplied';

        this.texture    = null;
        this.view       = null;
        this._device    = null;
        this._format    = null;
        this._dirty     = true;
    }

    get type() { return 'gpu'; }

    /**
     * Called by WorkspaceCompositor to hand over the GPU device.
     * @param {GPUDevice} device
     * @param {string}    format
     */
    initGPU(device, format) {
        this._device = device;
        this._format = format;
        this._allocTexture();
    }

    mount(container) {
        super.mount(container);
        // GPU panels have a thin placeholder div for layout/focus purposes
        const el = document.createElement('div');
        el.id = `plauna-panel-${this.id}`;
        el.className = 'plauna-panel plauna-panel--gpu';
        el.setAttribute('data-panel-id', this.id);
        Object.assign(el.style, {
            position: 'absolute',
            left:     `${this.position.x}px`,
            top:      `${this.position.y}px`,
            width:    `${this.size.width}px`,
            height:   `${this.size.height}px`,
            zIndex:   String(this.zIndex),
            pointerEvents: 'none',
        });
        this.element = el;
        container.appendChild(el);

        this.on('resize', ({ width, height }) => {
            if (this.element) {
                this.element.style.width  = `${width}px`;
                this.element.style.height = `${height}px`;
            }
            this._allocTexture();
        });
        this.on('move', ({ x, y }) => {
            if (this.element) {
                this.element.style.left = `${x}px`;
                this.element.style.top  = `${y}px`;
            }
        });
    }

    /**
     * Called by WorkspaceCompositor each frame.
     * @param {GPUCommandEncoder} encoder
     * @returns {GPUTexture|null}
     */
    renderFrame(encoder) {
        if (!this._device || !this.texture || !this.visible) return null;
        if (!this._onRender) return this.texture;

        const renderPass = encoder.beginRenderPass({
            colorAttachments: [{
                view:       this.view,
                loadOp:     'clear',
                storeOp:    'store',
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
            }],
        });
        this._onRender(renderPass, {
            device:  this._device,
            format:  this._format,
            width:   this.size.width,
            height:  this.size.height,
            texture: this.texture,
            view:    this.view,
            encoder,
        });
        renderPass.end();
        return this.texture;
    }

    resize(width, height) {
        super.resize(width, height);
        this._dirty = true;
    }

    destroy() {
        this.texture?.destroy();
        this.texture = null;
        this.view = null;
        this.element?.remove();
        super.destroy();
    }

    // ── Private ──────────────────────────────────────────────────────────────

    _allocTexture() {
        if (!this._device) return;
        this.texture?.destroy();

        const w = Math.max(1, Math.round(this.size.width));
        const h = Math.max(1, Math.round(this.size.height));

        this.texture = this._device.createTexture({
            label:  `GPUPanel:${this.id}`,
            size:   [w, h],
            format: this._format || 'rgba8unorm',
            usage:  GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
        });
        this.view = this.texture.createView();
        this._dirty = false;
    }
}
