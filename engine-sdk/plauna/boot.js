// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ============================================================================
 * PLAUNA ENGINE BOOTSTRAP
 * ============================================================================
 *
 * PlaunaDevShell is the main entry point for the Plauna UI system. It:
 *
 * 1. Initializes the rendering pipeline (WidgetRenderer, DOMRenderer)
 * 2. Loads and applies themes from plauna/themes/{id}/theme.json
 * 3. Sets up the workspace system for virtual desktops (optional GPU panels)
 * 4. Injects base CSS for the widget gallery/showcase
 * 5. Provides a public API for theme switching and widget rendering
 *
 * ARCHITECTURE FLOW:
 * - PlaunaDevShell.boot(root, options) → PlaunaDevShell instance
 * - _init() → loads styles, theme, workspace manager
 * - ThemeLoader applies CSS variables to :root
 * - WidgetRenderer converts UINode trees to DOM
 * - WorkspaceManager (optional) handles GPU-accelerated panels
 *
 * USAGE:
 *   const shell = await PlaunaDevShell.boot(document.body, { logger: console });
 *   shell.setTheme('dark');
 *   const element = shell.render(myUINode);
 *   document.body.appendChild(element);
 *
 * THEME SYSTEM:
 * - Themes live in plauna/themes/{id}/theme.json
 * - Themes can extend other themes via "extends": "parent"
 * - CSS variables are written to <style data-plauna-theme="1"> tags
 * - Per-session overrides can be applied via applyOverrides()
 *
 * WORKSPACE SYSTEM (OPTIONAL):
 * - Requires gpuDevice option for WebGPU support
 * - Creates virtual desktop layers for multi-panel layouts
 * - Supports DOM panels and GPU panels (WebGPU textures)
 * - Managed by WorkspaceManager class
 */

import { ThemeManager } from './style/ThemeManager.js';
import { widgetRenderer } from './widgets/WidgetRenderer.js';
import { widgets, getAllCategories, getAllWidgets, widgetRegistry } from './widgets/index.js';
import { themeLoader } from './themes/ThemeLoader.js';
import { readFileThemePreference, writeFileThemePreference } from './themes/ThemePreference.js';
import { WorkspaceManager } from './workspace/WorkspaceManager.js';

export class PlaunaDevShell {
    constructor(options = {}) {
        this.logger = options.logger || { info: console.log, warn: console.warn, error: console.error };
        this.themeManager = new ThemeManager();
        this.widgetRenderer = widgetRenderer;
        this.widgets = widgets;
        this.widgetRegistry = widgetRegistry;
        this._styleEl = null;
        this._currentTheme = 'dark';
        this._themeObservers = new Set();
        this._workspaceManager = null;
    }

    /**
     * Static factory — boot the engine and return a ready context.
     * @param {HTMLElement} root
     * @param {Object} options
     * @returns {PlaunaDevShell}
     */
    static async boot(root, options = {}) {
        const shell = new PlaunaDevShell(options);
        await shell._init(root, options);
        return shell;
    }

    /**
     * Initialize the Plauna engine.
     *
     * Initialization flow:
     * 1. Load base stylesheet (plauna.css)
     * 2. Inject widget base CSS (scoped to story preview cells)
     * 3. Inject modern primitive CSS overrides
     * 4. Create workspace container for virtual desktop layers
     * 5. Initialize WorkspaceManager if GPU device provided
     * 6. Determine initial theme (saved or system preference)
     * 7. Apply theme from themes/{id}/theme.json
     * 8. Pre-discover available themes in background
     *
     * @param {HTMLElement} root - Root DOM element
     * @param {Object} options - Configuration options
     */
    async _init(root, options = {}) {
        this._root = root;

        // Inject plauna.css stylesheet
        this._loadStylesheet();

        // Inject base widget styles (scoped to gallery preview cells)
        this._injectWidgetBaseCSS();
        this._injectModernPrimitiveCSS();

        // Create workspace container (for virtual desktop layers)
        const wsContainer = document.createElement('div');
        wsContainer.id = 'plauna-workspace-container';
        Object.assign(wsContainer.style, {
            position: 'absolute',
            inset: '0',
            zIndex: '1',
            pointerEvents: 'none',
        });
        root.appendChild(wsContainer);

        // Initialize workspace manager if GPU device is provided
        const { gpuDevice, gpuCanvas, gpuFormat } = this._resolveGpuOptions(options);
        if (gpuDevice) {
            this._workspaceManager = new WorkspaceManager({
                container: wsContainer,
                device: gpuDevice,
                format: gpuFormat || 'bgra8unorm',
                canvas: gpuCanvas,
                logger: this.logger,
            });
            await this._workspaceManager.init();
            this.logger.info('[PlaunaDevShell] WorkspaceManager initialized');
        }

        // Determine initial theme
        const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        const saved = this._getSavedTheme();
        this._currentTheme = saved || (prefersDark ? 'dark' : 'light');

        // Load + apply theme from themes/{id}/theme.json
        await this._applyTheme(this._currentTheme);

        // Pre-discover available themes in background (no await — non-blocking)
        themeLoader.discover();

        this.logger.info(`PlaunaDevShell booted (theme: ${this._currentTheme})`);
    }

    /**
     * Inject base widget CSS for story preview cells.
     *
     * CSS injection pattern:
     * - Scoped to .plauna-story-preview class
     * - Provides baseline styles for all primitive widgets
     * - Uses design tokens for theme consistency
     * - Idempotent (checks for existing style element)
     * - Includes animations (skeleton shimmer, progress stripes)
     *
     * Widgets styled:
     * - Button, Badge, Avatar, Chip, Text, Progress, Skeleton
     * - Variant styles (primary, secondary, success, warning, error)
     * - Size variants (sm, lg)
     */
    _injectWidgetBaseCSS() {
        if (document.querySelector('style[data-plauna-widgets]')) return;
        const el = document.createElement('style');
        el.setAttribute('data-plauna-widgets', '1');
        el.textContent = `
/* Plauna widget base styles — scoped to story preview cells */
.plauna-story-preview button,
.plauna-story-preview [role="button"] {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-sm);
    padding: 8px 16px;
    background: var(--color-primary);
    color: #fff;
    border: none;
    border-radius: var(--border-radius-md);
    cursor: pointer;
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    min-width: 72px;
    min-height: 36px;
    transition: opacity 0.15s ease;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.plauna-story-preview button:hover { opacity: 0.88; }
.plauna-story-preview button[aria-disabled="true"],
.plauna-story-preview button[disabled] { opacity: 0.45; cursor: not-allowed; }

/* Badge */
.plauna-story-preview [data-widget="badge"] {
    display: inline-flex; align-items: center;
    padding: 2px 10px;
    background: var(--color-primary);
    color: #fff;
    border-radius: var(--border-radius-full);
    font-size: 12px;
    font-weight: 500;
}

/* Avatar */
.plauna-story-preview [data-widget="avatar"] {
    display: inline-flex; align-items: center; justify-content: center;
    width: 40px; height: 40px;
    border-radius: var(--border-radius-full);
    background: var(--color-primary);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    user-select: none;
}

/* Chip */
.plauna-story-preview [data-widget="chip"] {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-medium);
    border-radius: var(--border-radius-full);
    font-size: 13px;
    color: var(--text-primary);
}

/* Text */
.plauna-story-preview [data-widget="text"] {
    display: block;
    max-width: 100%;
    color: var(--text-primary);
    white-space: pre-wrap;
}
.plauna-story-preview [data-widget="text"][data-variant="heading-1"] {
    font-size: 32px;
    line-height: 1.1;
    font-weight: 700;
}
.plauna-story-preview [data-widget="text"][data-variant="caption"] {
    font-size: 12px;
    color: var(--text-secondary);
}
.plauna-story-preview [data-widget="text"][data-variant="code"] {
    font-family: monospace;
    font-size: 13px;
    padding: 8px 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-medium);
    border-radius: var(--border-radius-md);
}

/* Progress */
.plauna-story-preview [data-widget="progress"] {
    display: block;
    width: 220px; height: 12px;
    background: var(--bg-tertiary);
    border-radius: var(--border-radius-full);
    overflow: hidden;
}
.plauna-story-preview [data-widget="progress"] > * {
    height: 100%;
    background: var(--color-primary-500);
    border-radius: var(--border-radius-full);
}

/* Variant colors — buttons */
.plauna-story-preview button[data-variant="secondary"],
.plauna-story-preview [role="button"][data-variant="secondary"] {
    background: var(--bg-quaternary); color: var(--text-primary);
    border: 1px solid var(--border-medium); box-shadow: none;
}
.plauna-story-preview button[data-variant="ghost"],
.plauna-story-preview [role="button"][data-variant="ghost"] {
    background: transparent; color: var(--color-primary);
    border: 1px solid var(--color-primary); box-shadow: none;
}
.plauna-story-preview button[data-variant="success"]  { background: var(--color-success); }
.plauna-story-preview button[data-variant="warning"]  { background: var(--color-warning); color: #111; }
.plauna-story-preview button[data-variant="error"]    { background: var(--color-error); }

/* Variant colors — badges */
.plauna-story-preview [data-widget="badge"][data-variant="success"] { background: var(--color-success); }
.plauna-story-preview [data-widget="badge"][data-variant="warning"] { background: var(--color-warning); color: #111; }
.plauna-story-preview [data-widget="badge"][data-variant="error"]   { background: var(--color-error); }
.plauna-story-preview [data-widget="badge"][data-variant="secondary"] {
    background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border-medium);
}

/* Size variants */
.plauna-story-preview button[data-size="sm"] { padding: 4px 10px; font-size: 12px; min-height: 28px; }
.plauna-story-preview button[data-size="lg"] { padding: 12px 24px; font-size: 16px; min-height: 44px; }
.plauna-story-preview [data-widget="avatar"][data-size="sm"] { width: 28px; height: 28px; font-size: 11px; }
.plauna-story-preview [data-widget="avatar"][data-size="lg"] { width: 56px; height: 56px; font-size: 18px; }

/* Chip variants */
.plauna-story-preview [data-widget="chip"][data-variant="primary"]  {
    background: color-mix(in srgb, var(--color-primary) 15%, transparent);
    border-color: var(--color-primary); color: var(--color-primary);
}
.plauna-story-preview [data-widget="chip"][data-variant="success"]  {
    background: color-mix(in srgb, var(--color-success) 15%, transparent);
    border-color: var(--color-success); color: var(--color-success);
}
.plauna-story-preview [data-widget="chip"][data-variant="warning"]  {
    background: color-mix(in srgb, var(--color-warning) 15%, transparent);
    border-color: var(--color-warning); color: #c17f00;
}

/* Progress bar fill via width trick */
.plauna-story-preview [data-widget="progress"] > div { transition: width 0.3s ease; }
.plauna-story-preview [data-widget="progress"][data-variant="success"] > * { background: var(--color-success); }
.plauna-story-preview [data-widget="progress"][data-variant="warning"] > * { background: var(--color-warning); }

/* Skeleton */
.plauna-story-preview [data-widget="skeleton"] {
    display: block;
    overflow: hidden;
}
.plauna-story-preview [data-widget="skeleton"] > * {
    background-repeat: no-repeat;
    animation: skeletonShimmer 1.5s ease-in-out infinite;
}

@keyframes skeletonShimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}

@keyframes progressStriped {
    0% { background-position: 40px 0; }
    100% { background-position: 0 0; }
}

@keyframes progressIndeterminate {
    0% { left: -30%; }
    60% { left: 100%; }
    100% { left: 100%; }
}

@keyframes progressCircularIndeterminate {
    0% { stroke-dasharray: 1, 2; stroke-dashoffset: 0; }
    50% { stroke-dasharray: 90, 150; stroke-dashoffset: -35; }
    100% { stroke-dasharray: 90, 150; stroke-dashoffset: -124; }
}

/* Fallback for unknown widgets */
.plauna-story-preview > div,
.plauna-story-preview > span {
    color: var(--text-primary);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Workspace Panel Styles
   ───────────────────────────────────────────────────────────────────────────── */

/* Workspace container */
#plauna-workspace-container {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
}

/* Workspace layer */
.plauna-workspace {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: transparent;
    transition: opacity 250ms ease, transform 250ms ease;
    opacity: 0;
    pointer-events: none;
    will-change: opacity, transform;
}

/* Panel base */
.plauna-panel {
    position: absolute;
    background: var(--bg-secondary);
    border: 1px solid var(--border-medium);
    border-radius: var(--border-radius-lg);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    contain: layout style;
    will-change: transform;
}

/* Panel title bar */
.plauna-panel__titlebar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    height: 32px;
    flex-shrink: 0;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-light);
    user-select: none;
}

/* Panel title */
.plauna-panel__title {
    flex: 1;
    font-size: 12px;
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Panel content */
.plauna-panel__content {
    flex: 1;
    overflow: auto;
    position: relative;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Workspace Switcher Styles
   ───────────────────────────────────────────────────────────────────────────── */

.plauna-workspace-switcher {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    opacity: 0;
    transition: opacity 150ms ease;
}`;
        document.head.appendChild(el);
    }

    /**
     * Inject modern primitive CSS overrides.
     *
     * Modern pattern injection:
     * - Scoped to .plauna-story-preview class
     * - Uses !important to override base styles
     * - Modern UI patterns inspired by Material Design 3 and Apple HIG
     * - Soft gradients, glassy blur, larger radii, subtle elevation
     * - Clearer focus rings for accessibility
     *
     * Modern patterns applied:
     * - Buttons: Gradient backgrounds, backdrop blur, larger border-radius
     * - Badges: Softer backgrounds, glassy blur, refined shadows
     * - Avatars: Gradient backgrounds, hover elevation, border styling
     * - Chips: Alpha-transparent backgrounds, hover states
     * - Progress: Gradient fills, inset shadows for depth
     * - Tooltip: Glassy blur, refined shadows
     * - Input: Soft focus rings, hover elevation
     */
    _injectModernPrimitiveCSS() {
        if (document.querySelector('style[data-plauna-modern-primitives]')) return;

        const el = document.createElement('style');
        el.setAttribute('data-plauna-modern-primitives', '1');
        el.textContent = `
/* Plauna modern primitive overrides — scoped to story preview cells */
.plauna-story-preview button,
.plauna-story-preview [role="button"],
.plauna-story-preview .button {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    gap: var(--spacing-sm) !important;
    min-height: 40px !important;
    padding: 10px 16px !important;
    border-radius: 14px !important;
    border: 1px solid rgba(148, 163, 184, 0.18) !important;
    background: linear-gradient(180deg, rgba(59, 130, 246, 0.98), rgba(37, 99, 235, 0.94)) !important;
    color: #fff !important;
    box-shadow: 0 12px 28px rgba(37, 99, 235, 0.20), inset 0 1px 0 rgba(255, 255, 255, 0.14) !important;
    backdrop-filter: blur(14px) saturate(140%) !important;
    font-family: inherit !important;
    font-size: 14px !important;
    font-weight: 600 !important;
    letter-spacing: 0.01em !important;
    transition: transform 160ms ease, box-shadow 160ms ease, filter 160ms ease, opacity 160ms ease !important;
}
.plauna-story-preview button:hover:not(:disabled),
.plauna-story-preview [role="button"]:hover:not(:disabled),
.plauna-story-preview .button:hover:not(:disabled) {
    transform: translateY(-1px) !important;
    filter: saturate(1.05) !important;
    box-shadow: 0 16px 34px rgba(37, 99, 235, 0.26), 0 2px 0 rgba(255, 255, 255, 0.08) inset !important;
}
.plauna-story-preview button:active:not(:disabled),
.plauna-story-preview [role="button"]:active:not(:disabled),
.plauna-story-preview .button:active:not(:disabled) {
    transform: translateY(0) scale(0.99) !important;
}
.plauna-story-preview button:focus-visible,
.plauna-story-preview [role="button"]:focus-visible,
.plauna-story-preview .button:focus-visible {
    outline: 2px solid rgba(59, 130, 246, 0.55) !important;
    outline-offset: 2px !important;
}
.plauna-story-preview button[disabled],
.plauna-story-preview [role="button"][aria-disabled="true"],
.plauna-story-preview .button:disabled {
    opacity: 0.45 !important;
    filter: grayscale(0.15) !important;
    box-shadow: none !important;
}
.plauna-story-preview button[data-variant="secondary"],
.plauna-story-preview [role="button"][data-variant="secondary"],
.plauna-story-preview .button[data-variant="secondary"] {
    background: rgba(15, 23, 42, 0.06) !important;
    color: var(--text-primary) !important;
    border-color: rgba(148, 163, 184, 0.24) !important;
    box-shadow: none !important;
}
.plauna-story-preview button[data-variant="ghost"],
.plauna-story-preview [role="button"][data-variant="ghost"],
.plauna-story-preview .button[data-variant="ghost"] {
    background: transparent !important;
    color: var(--color-primary-500) !important;
    border-color: rgba(59, 130, 246, 0.24) !important;
    box-shadow: none !important;
}
.plauna-story-preview button[data-variant="success"],
.plauna-story-preview .button[data-variant="success"] {
    background: linear-gradient(180deg, rgba(16, 185, 129, 0.98), rgba(5, 150, 105, 0.94)) !important;
}
.plauna-story-preview button[data-variant="warning"],
.plauna-story-preview .button[data-variant="warning"] {
    background: linear-gradient(180deg, rgba(245, 158, 11, 0.98), rgba(217, 119, 6, 0.94)) !important;
    color: #111827 !important;
}
.plauna-story-preview button[data-variant="error"],
.plauna-story-preview .button[data-variant="error"] {
    background: linear-gradient(180deg, rgba(239, 68, 68, 0.98), rgba(220, 38, 38, 0.94)) !important;
}

.plauna-story-preview [data-widget="badge"],
.plauna-story-preview .badge {
    display: inline-flex !important;
    align-items: center !important;
    min-height: 24px !important;
    padding: 4px 10px !important;
    border-radius: 999px !important;
    border: 1px solid rgba(148, 163, 184, 0.22) !important;
    background: rgba(15, 23, 42, 0.06) !important;
    color: var(--text-primary) !important;
    font-size: 12px !important;
    font-weight: 600 !important;
    letter-spacing: 0.02em !important;
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08) !important;
    backdrop-filter: blur(10px) !important;
}
.plauna-story-preview [data-widget="badge"][data-variant="success"],
.plauna-story-preview .badge--success {
    background: rgba(16, 185, 129, 0.14) !important;
    color: #047857 !important;
    border-color: rgba(16, 185, 129, 0.28) !important;
}
.plauna-story-preview [data-widget="badge"][data-variant="warning"],
.plauna-story-preview .badge--warning {
    background: rgba(245, 158, 11, 0.14) !important;
    color: #92400e !important;
    border-color: rgba(245, 158, 11, 0.28) !important;
}
.plauna-story-preview [data-widget="badge"][data-variant="error"],
.plauna-story-preview .badge--error {
    background: rgba(239, 68, 68, 0.14) !important;
    color: #991b1b !important;
    border-color: rgba(239, 68, 68, 0.28) !important;
}

.plauna-story-preview [data-widget="avatar"],
.plauna-story-preview .avatar {
    border: 1px solid rgba(148, 163, 184, 0.24) !important;
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.10) !important;
    background: linear-gradient(180deg, rgba(59, 130, 246, 0.95), rgba(37, 99, 235, 0.92)) !important;
    color: #fff !important;
    transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease !important;
}
.plauna-story-preview [data-widget="avatar"]:hover,
.plauna-story-preview .avatar:hover {
    transform: translateY(-1px) scale(1.02) !important;
    box-shadow: 0 16px 30px rgba(15, 23, 42, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.12) !important;
}

.plauna-story-preview [data-widget="chip"],
.plauna-story-preview .chip {
    display: inline-flex !important;
    align-items: center !important;
    gap: 6px !important;
    padding: 6px 12px !important;
    border-radius: 999px !important;
    border: 1px solid rgba(148, 163, 184, 0.22) !important;
    background: rgba(15, 23, 42, 0.04) !important;
    color: var(--text-primary) !important;
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08) !important;
    backdrop-filter: blur(10px) saturate(140%) !important;
    transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease, background 160ms ease !important;
}
.plauna-story-preview [data-widget="chip"]:hover,
.plauna-story-preview .chip:hover {
    transform: translateY(-1px) !important;
    border-color: rgba(59, 130, 246, 0.28) !important;
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.12) !important;
}
.plauna-story-preview [data-widget="chip"][data-variant="primary"],
.plauna-story-preview .chip--primary {
    background: rgba(59, 130, 246, 0.12) !important;
    color: var(--color-primary-500) !important;
    border-color: rgba(59, 130, 246, 0.24) !important;
}
.plauna-story-preview [data-widget="chip"][data-variant="success"],
.plauna-story-preview .chip--success {
    background: rgba(16, 185, 129, 0.12) !important;
    color: var(--color-success) !important;
    border-color: rgba(16, 185, 129, 0.24) !important;
}
.plauna-story-preview [data-widget="chip"][data-variant="warning"],
.plauna-story-preview .chip--warning {
    background: rgba(245, 158, 11, 0.12) !important;
    color: #c17f00 !important;
    border-color: rgba(245, 158, 11, 0.24) !important;
}

.plauna-story-preview [data-widget="progress"],
.plauna-story-preview .progress {
    display: block !important;
    width: 220px !important;
    min-height: 14px !important;
    background: linear-gradient(180deg, rgba(148, 163, 184, 0.18), rgba(15, 23, 42, 0.06)) !important;
    border: 1px solid rgba(148, 163, 184, 0.18) !important;
    border-radius: 999px !important;
    overflow: hidden !important;
    box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.08), 0 10px 20px rgba(15, 23, 42, 0.08) !important;
}
.plauna-story-preview [data-widget="progress"] > *,
.plauna-story-preview .progress__fill {
    height: 100% !important;
    border-radius: 999px !important;
    background: linear-gradient(90deg, rgba(59, 130, 246, 0.96), rgba(99, 102, 241, 0.96)) !important;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18) !important;
}

.plauna-story-preview [data-widget="tooltip"],
.plauna-story-preview .tooltip {
    padding: 10px 14px !important;
    border-radius: 16px !important;
    background: rgba(15, 23, 42, 0.90) !important;
    color: #fff !important;
    border: 1px solid rgba(148, 163, 184, 0.22) !important;
    box-shadow: 0 24px 60px rgba(2, 6, 23, 0.30), inset 0 1px 0 rgba(255, 255, 255, 0.08) !important;
    backdrop-filter: blur(16px) saturate(140%) !important;
}
.plauna-story-preview .tooltip::before {
    background: rgba(15, 23, 42, 0.90) !important;
    border-color: rgba(148, 163, 184, 0.22) !important;
}

.plauna-story-preview .plauna-input-container {
    gap: 8px !important;
}
.plauna-story-preview .plauna-input-label {
    font-size: 12px !important;
    font-weight: 600 !important;
    color: var(--text-secondary) !important;
    letter-spacing: 0.01em !important;
}
.plauna-story-preview .plauna-input-wrapper {
    background: rgba(15, 23, 42, 0.04) !important;
    border: 1px solid rgba(148, 163, 184, 0.20) !important;
    border-radius: 14px !important;
    box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.08), 0 8px 18px rgba(15, 23, 42, 0.08) !important;
    transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease !important;
}
.plauna-story-preview .plauna-input-wrapper:focus-within {
    border-color: rgba(59, 130, 246, 0.55) !important;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.14), 0 12px 24px rgba(15, 23, 42, 0.10) !important;
    transform: translateY(-1px) !important;
}
.plauna-story-preview .plauna-input {
    background: transparent !important;
    color: var(--text-primary) !important;
    border: none !important;
    border-radius: 14px !important;
    padding: 12px 14px !important;
    font-size: 14px !important;
}
.plauna-story-preview .plauna-input::placeholder {
    color: var(--text-tertiary) !important;
}
.plauna-story-preview .plauna-input-helper {
    font-size: 12px !important;
    color: var(--text-secondary) !important;
}

/* Reworked form controls */
.plauna-story-preview [data-widget="search"],
.plauna-story-preview [data-widget="color"],
.plauna-story-preview [data-widget="date"],
.plauna-story-preview [data-widget="time"],
.plauna-story-preview [data-widget="tag"],
.plauna-story-preview [data-widget="textarea"],
.plauna-story-preview [data-widget="select"],
.plauna-story-preview [data-widget="checkbox"],
.plauna-story-preview [data-widget="radio"],
.plauna-story-preview [data-widget="switch"],
.plauna-story-preview [data-widget="slider"],
.plauna-story-preview [data-widget="rating"] {
    width: 100% !important;
    max-width: 100% !important;
    font-family: inherit !important;
}

.plauna-story-preview .plauna-search-container,
.plauna-story-preview .plauna-color-container,
.plauna-story-preview .plauna-date-container,
.plauna-story-preview .plauna-time-container,
.plauna-story-preview .plauna-tag-container,
.plauna-story-preview [data-widget="textarea"] [id$="-container"] {
    display: flex !important;
    flex-direction: column !important;
    gap: 8px !important;
    width: 100% !important;
    overflow: visible !important;
}

.plauna-story-preview .plauna-search-label,
.plauna-story-preview .plauna-color-label,
.plauna-story-preview .plauna-date-label,
.plauna-story-preview .plauna-time-label,
.plauna-story-preview .plauna-tag-label {
    font-size: 12px !important;
    font-weight: 700 !important;
    letter-spacing: 0.02em !important;
    color: var(--text-secondary) !important;
}

.plauna-story-preview .plauna-search-wrapper,
.plauna-story-preview .plauna-color-input-wrapper,
.plauna-story-preview .plauna-date-input-wrapper,
.plauna-story-preview .plauna-time-input-wrapper,
.plauna-story-preview .plauna-tag-wrapper,
.plauna-story-preview [data-widget="textarea"] [id$="-container"],
.plauna-story-preview [data-widget="select"] > [id$="-input"],
.plauna-story-preview [data-widget="checkbox"] > [id$="-input"],
.plauna-story-preview [data-widget="radio"] > [id$="-input"],
.plauna-story-preview [data-widget="switch"] > [id$="-input"],
.plauna-story-preview [data-widget="slider"] [id$="-track"] {
    position: relative !important;
    display: flex !important;
    align-items: center !important;
    gap: 10px !important;
    min-height: 44px !important;
    padding: 10px 12px !important;
    border-radius: 16px !important;
    border: 1px solid rgba(148, 163, 184, 0.20) !important;
    background: linear-gradient(180deg, rgba(15, 23, 42, 0.04), rgba(15, 23, 42, 0.02)) !important;
    box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.08), 0 10px 22px rgba(15, 23, 42, 0.08) !important;
    backdrop-filter: blur(14px) saturate(135%) !important;
    transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease !important;
}

.plauna-story-preview .plauna-search-wrapper:focus-within,
.plauna-story-preview .plauna-color-input-wrapper:focus-within,
.plauna-story-preview .plauna-date-input-wrapper:focus-within,
.plauna-story-preview .plauna-time-input-wrapper:focus-within,
.plauna-story-preview .plauna-tag-wrapper:focus-within,
.plauna-story-preview [data-widget="textarea"] [id$="-container"]:focus-within,
.plauna-story-preview [data-widget="select"] > [id$="-input"]:focus-within {
    border-color: rgba(59, 130, 246, 0.48) !important;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.14), 0 16px 28px rgba(15, 23, 42, 0.10) !important;
    transform: translateY(-1px) !important;
}

.plauna-story-preview .plauna-search-icon,
.plauna-story-preview .plauna-color-display {
    flex: 0 0 auto !important;
}

.plauna-story-preview .plauna-search-wrapper input[type="text"],
.plauna-story-preview .plauna-color-input-wrapper input[type="text"],
.plauna-story-preview .plauna-date-input-wrapper input[type="text"],
.plauna-story-preview .plauna-time-input-wrapper input[type="text"],
.plauna-story-preview .plauna-tag-input-wrapper input[type="text"],
.plauna-story-preview [data-widget="textarea"] textarea,
.plauna-story-preview [data-widget="select"] [id$="-dropdown"] input[type="text"] {
    width: 100% !important;
    min-width: 0 !important;
    border: none !important;
    outline: none !important;
    background: transparent !important;
    color: var(--text-primary) !important;
    font: inherit !important;
    font-size: 14px !important;
    box-shadow: none !important;
}

.plauna-story-preview .plauna-search-wrapper input[type="text"]::placeholder,
.plauna-story-preview .plauna-color-input-wrapper input[type="text"]::placeholder,
.plauna-story-preview .plauna-date-input-wrapper input[type="text"]::placeholder,
.plauna-story-preview .plauna-time-input-wrapper input[type="text"]::placeholder,
.plauna-story-preview .plauna-tag-input-wrapper input[type="text"]::placeholder,
.plauna-story-preview [data-widget="textarea"] textarea::placeholder,
.plauna-story-preview [data-widget="select"] [id$="-dropdown"] input[type="text"]::placeholder {
    color: var(--text-tertiary) !important;
}

.plauna-story-preview .plauna-search-wrapper button[type="button"] {
    flex: 0 0 auto !important;
}

.plauna-story-preview .plauna-search-clear,
.plauna-story-preview .plauna-date-container button,
.plauna-story-preview .plauna-time-container button,
.plauna-story-preview .plauna-tag-suggestions button,
.plauna-story-preview [data-widget="select"] [id$="-clear"],
.plauna-story-preview [data-widget="select"] [id$="-arrow"] {
    border: 1px solid rgba(148, 163, 184, 0.20) !important;
    background: rgba(15, 23, 42, 0.04) !important;
    color: var(--text-secondary) !important;
    border-radius: 12px !important;
    box-shadow: none !important;
}

.plauna-story-preview .plauna-color-presets button {
    border: 1px solid var(--preset-color, rgba(148, 163, 184, 0.22)) !important;
    background: var(--preset-color, rgba(148, 163, 184, 0.22)) !important;
    color: transparent !important;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12) !important;
}

.plauna-story-preview .plauna-color-presets button:hover {
    transform: translateY(-1px) scale(1.03) !important;
    filter: saturate(1.08) brightness(1.03) !important;
}

.plauna-story-preview .plauna-color-swatch {
    min-width: 112px !important;
    min-height: 64px !important;
    padding: 8px !important;
    border-radius: 20px !important;
    background: var(--swatch-color, rgba(148, 163, 184, 0.22)) !important;
    border-color: var(--swatch-color, rgba(148, 163, 184, 0.22)) !important;
    box-shadow: 0 14px 28px rgba(15, 23, 42, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.18) !important;
}
.plauna-story-preview .plauna-color-swatch:hover {
    transform: translateY(-1px) !important;
    filter: saturate(1.05) !important;
}
.plauna-story-preview .plauna-color-swatch .plauna-color-display {
    width: 100% !important;
    height: 100% !important;
    min-width: 44px !important;
    min-height: 44px !important;
    border-radius: 14px !important;
    border: none !important;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18) !important;
}

.plauna-story-preview .plauna-color-meta {
    display: flex !important;
    flex-direction: column !important;
    justify-content: center !important;
    gap: 4px !important;
    min-width: 0 !important;
}

.plauna-story-preview .plauna-color-caption {
    font-size: 11px !important;
    font-weight: 700 !important;
    letter-spacing: 0.08em !important;
    text-transform: uppercase !important;
    color: var(--text-tertiary) !important;
}

.plauna-story-preview .plauna-color-meta input[type="text"] {
    min-height: 42px !important;
}

.plauna-story-preview .plauna-search-suggestions,
.plauna-story-preview .plauna-tag-suggestions,
.plauna-story-preview .plauna-date-calendar,
.plauna-story-preview .plauna-time-clock,
.plauna-story-preview [data-widget="select"] [id$="-dropdown"] {
    margin-top: 8px !important;
    border: 1px solid rgba(148, 163, 184, 0.20) !important;
    border-radius: 16px !important;
    background: rgba(15, 23, 42, 0.92) !important;
    box-shadow: 0 24px 56px rgba(2, 6, 23, 0.24) !important;
    backdrop-filter: blur(18px) saturate(140%) !important;
    z-index: 9999 !important;
}

.plauna-story-preview .plauna-search-suggestions [data-suggestion],
.plauna-story-preview .plauna-tag-suggestions [data-suggestion],
.plauna-story-preview [data-widget="select"] [id$="-dropdown"] li {
    border-radius: 12px !important;
    margin: 4px 6px !important;
    padding: 10px 12px !important;
    color: rgba(248, 250, 252, 0.94) !important;
}

.plauna-story-preview .plauna-color-display {
    width: 24px !important;
    height: 24px !important;
    border-radius: 8px !important;
    border: 2px solid rgba(148, 163, 184, 0.30) !important;
    box-shadow: 0 8px 16px rgba(15, 23, 42, 0.10) !important;
}

.plauna-story-preview .plauna-color-presets {
    display: flex !important;
    flex-wrap: wrap !important;
    gap: 8px !important;
    padding: 10px !important;
    border-radius: 14px !important;
    border: 1px solid rgba(148, 163, 184, 0.16) !important;
    background: rgba(15, 23, 42, 0.03) !important;
}

.plauna-story-preview .plauna-date-calendar,
.plauna-story-preview .plauna-time-clock {
    padding: 8px !important;
}

.plauna-story-preview [data-widget="textarea"] textarea {
    min-height: 112px !important;
    resize: vertical !important;
}

.plauna-story-preview [data-widget="select"] > [id$="-input"] {
    justify-content: flex-start !important;
}

.plauna-story-preview [data-widget="select"] [id$="-value"] {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
}

.plauna-story-preview [data-widget="checkbox"] > [id$="-input"],
.plauna-story-preview [data-widget="radio"] > [id$="-input"] {
    flex: 0 0 auto !important;
    width: 24px !important;
    height: 24px !important;
    min-height: 24px !important;
    padding: 0 !important;
    justify-content: center !important;
}

.plauna-story-preview [data-widget="switch"] > [id$="-input"] {
    width: 48px !important;
    height: 26px !important;
    min-height: 26px !important;
    padding: 0 !important;
    border-radius: 999px !important;
}

.plauna-story-preview [data-widget="checkbox"] [id$="-checkmark"],
.plauna-story-preview [data-widget="radio"] [id$="-dot"],
.plauna-story-preview [data-widget="switch"] [id$="-thumb"] {
    pointer-events: none !important;
}

.plauna-story-preview [data-widget="slider"] {
    display: flex !important;
    align-items: center !important;
    gap: 12px !important;
}
.plauna-story-preview [data-widget="slider"] [id$="-track"] {
    flex: 1 1 auto !important;
    width: 100% !important;
    min-height: 18px !important;
    padding: 7px 0 !important;
    background: transparent !important;
    box-shadow: none !important;
    border: none !important;
}
.plauna-story-preview [data-widget="slider"] [id$="-track"]::before {
    content: '' !important;
    position: absolute !important;
    left: 0 !important;
    right: 0 !important;
    top: 50% !important;
    height: 6px !important;
    transform: translateY(-50%) !important;
    border-radius: 999px !important;
    background: linear-gradient(180deg, rgba(148, 163, 184, 0.18), rgba(15, 23, 42, 0.08)) !important;
}
.plauna-story-preview [data-widget="slider"] [id$="-fill"] {
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18) !important;
}
.plauna-story-preview [data-widget="slider"] [id$="-thumb"] {
    width: 22px !important;
    height: 22px !important;
    border: 2px solid rgba(255, 255, 255, 0.96) !important;
    box-shadow: 0 10px 20px rgba(15, 23, 42, 0.16) !important;
}

.plauna-story-preview [data-widget="rating"] {
    display: inline-flex !important;
    align-items: center !important;
    gap: 6px !important;
}
.plauna-story-preview [data-widget="rating"] button {
    width: 24px !important;
    height: 24px !important;
    min-height: 24px !important;
    padding: 0 !important;
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
}
.plauna-story-preview [data-widget="rating"] button svg {
    filter: drop-shadow(0 2px 4px rgba(15, 23, 42, 0.14)) !important;
}

@media (max-width: 768px) {
    .plauna-story-preview [data-widget="search"],
    .plauna-story-preview [data-widget="color"],
    .plauna-story-preview [data-widget="date"],
    .plauna-story-preview [data-widget="time"],
    .plauna-story-preview [data-widget="tag"],
    .plauna-story-preview [data-widget="textarea"],
    .plauna-story-preview [data-widget="select"],
    .plauna-story-preview [data-widget="checkbox"],
    .plauna-story-preview [data-widget="radio"],
    .plauna-story-preview [data-widget="switch"],
    .plauna-story-preview [data-widget="slider"],
    .plauna-story-preview [data-widget="rating"] {
        width: 100% !important;
    }

    .plauna-story-preview .plauna-search-wrapper,
    .plauna-story-preview .plauna-color-input-wrapper,
    .plauna-story-preview .plauna-date-input-wrapper,
    .plauna-story-preview .plauna-time-input-wrapper,
    .plauna-story-preview .plauna-tag-wrapper,
    .plauna-story-preview [data-widget="textarea"] [id$="-container"],
    .plauna-story-preview [data-widget="select"] > [id$="-input"] {
        min-height: 40px !important;
        padding: 8px 10px !important;
    }
}

@media (max-width: 768px) {
    .plauna-story-preview button,
    .plauna-story-preview [role="button"],
    .plauna-story-preview .button {
        min-height: 36px !important;
        padding: 8px 14px !important;
    }

    .plauna-story-preview [data-widget="progress"],
    .plauna-story-preview .progress {
        width: 100% !important;
    }
}
        `.trim();
        document.head.appendChild(el);
    }

    /**
     * Load the base Plauna stylesheet.
     *
     * Stylesheet loading pattern:
     * - Loads plauna.css from ./styles/ directory
     * - Uses import.meta.url for relative path resolution
     * - Idempotent (checks for existing link element)
     * - Graceful error handling (warns if stylesheet not found)
     * - Sets data attribute for identification
     */
    _loadStylesheet() {
        if (document.querySelector('link[data-plauna-styles]')) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = new URL('./styles/plauna.css', import.meta.url).href;
        link.setAttribute('data-plauna-styles', '1');
        link.onerror = () => this.logger.warn('plauna.css not found — skipping stylesheet load');
        document.head.appendChild(link);
    }

    /**
     * Apply a theme by ID.
     *
     * Theme application pattern:
     * - Delegates to ThemeLoader to load theme from themes/{id}/theme.json
     * - Handles theme extension via "extends" property
     * - Writes CSS variables to :root
     * - Falls back to 'dark' theme on error
     * - Notifies observers of theme change
     *
     * @param {string} themeId - Theme identifier
     */
    async _applyTheme(themeId) {
        try {
            await themeLoader.apply(themeId);
        } catch (err) {
            this.logger.warn(`Theme "${themeId}" failed to load, falling back to dark: ${err.message}`);
            if (themeId !== 'dark') await themeLoader.apply('dark').catch(() => {});
        }
        this._currentTheme = themeId;
        // Notify observers
        this._themeObservers.forEach(fn => fn(themeId));
    }

    _getSavedTheme() {
        return readFileThemePreference();
    }

    _saveTheme(id) {
        try { writeFileThemePreference(id); } catch { /* ignore */ }
    }

    _resolveGpuOptions(options) {
        // Extract GPU options for workspace manager (optional)
        return {
            gpuDevice: options.gpuDevice || options.device || null,
            gpuCanvas: options.gpuCanvas || options.canvas || null,
            gpuFormat: options.gpuFormat || options.format || null,
        };
    }

    // ── Public API ────────────────────────────────────────────────

    getTheme() { return this._currentTheme; }

    async setTheme(themeId) {
        await this._applyTheme(themeId);
        this._saveTheme(themeId);
    }

    async toggleTheme() {
        const next = this._currentTheme === 'dark' ? 'light' : 'dark';
        await this.setTheme(next);
        return next;
    }

    onThemeChange(fn) {
        this._themeObservers.add(fn);
        return () => this._themeObservers.delete(fn);
    }

    /** Returns metadata list for all registered themes. */
    async getAvailableThemes() {
        return themeLoader.listThemes();
    }

    /** Apply per-session CSS var overrides on top of the active theme. */
    applyOverrides(vars) {
        themeLoader.applyOverrides(vars);
    }

    clearOverrides() {
        themeLoader.clearOverrides();
    }

    /** Direct access to the loader for advanced use. */
    get themeLoader() { return themeLoader; }

    /** Workspace manager for virtual desktops / multi-panel layouts. */
    get workspaces() { return this._workspaceManager; }

    getAllWidgets() { return getAllWidgets(); }
    getAllCategories() { return getAllCategories(); }
    getWidget(id) { return this.widgetRegistry.get(id); }

    /**
     * Render a UINode instance to a DOM element.
     *
     * Rendering pattern:
     * - Delegates to WidgetRenderer to convert UINode tree to DOM
     * - This is the correct rendering path (avoids require() bug in widget.create())
     * - Returns root DOM element ready for insertion into document
     * - Handles both simple widgets and complex widget trees
     *
     * @param {UINode} uiNode - UINode instance to render
     * @returns {HTMLElement} Rendered DOM element
     */
    render(uiNode) {
        return this.widgetRenderer.render(uiNode);
    }
}
