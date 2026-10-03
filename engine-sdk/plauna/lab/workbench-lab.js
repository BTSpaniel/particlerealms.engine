// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createPlaunaApp } from '../core/app.js';
import { ToastManager } from '../ui/ToastManager.js';
import { UINode, NODE_STATE, DIRTY } from '../core/UINode.js';
import { VisualTree } from '../core/VisualTree.js';
import { DOMRenderer } from '../core/DOMRenderer.js';
import { uniformDistribution } from '../../engine/core/math/MathRandom.js';
import { runtimeFrameDeltaSeconds } from '../../engine/core/math/FrameMath.js';
import { acquireGpuDeviceForConsumer } from '../../engine/core/gpu/GpuDeviceOwnership.js';

// Import real Plauna widgets from new modular system
import { createWidget, getWidget, getAllWidgets, getAllCategories } from '../widgets/index.js';
import { widgetStyleManager } from '../widgets/WidgetStyleManager.js';

const PARTICLE_COUNT = 240;
const PRETEXT_PARTICLE_COUNT = 96;
const OUTLINE_COUNT = 6;
const STYLE_HREF = new URL('../styles/plauna.css', import.meta.url).href;
const AUTO_SAMPLE_TEXT = 'Plauna should measure dense UI copy without a hidden DOM probe.';

const DESIGN_PRESETS = [
    {
        id: 'editor',
        title: 'Workbench',
        summary: 'Closest to the editor shell. Split panes, utility density, stable navigation.',
        metric: '3 zones',
        detail: 'Inspector + center document + diagnostics',
        outlineHint: 'Split docked layout',
        panels: [
            { label: 'Tools', tone: 'accent', x: 0.02, y: 0.08, w: 0.2, h: 0.76 },
            { label: 'Viewport', tone: '', x: 0.25, y: 0.08, w: 0.5, h: 0.76 },
            { label: 'Inspect', tone: 'warning', x: 0.78, y: 0.08, w: 0.2, h: 0.48 },
            { label: 'Console', tone: 'success', x: 0.25, y: 0.87, w: 0.73, h: 0.11 }
        ]
    },
    {
        id: 'command',
        title: 'Command Deck',
        summary: 'Top-heavy control bar and a single narrative workspace. Good for focused tools.',
        metric: '1 flow',
        detail: 'Actions first, content second, logs pinned',
        outlineHint: 'Single-story focus',
        panels: [
            { label: 'Commands', tone: 'warning', x: 0.04, y: 0.08, w: 0.92, h: 0.16 },
            { label: 'Primary', tone: 'accent', x: 0.04, y: 0.3, w: 0.92, h: 0.48 },
            { label: 'Output', tone: 'success', x: 0.04, y: 0.83, w: 0.92, h: 0.13 }
        ]
    },
    {
        id: 'cards',
        title: 'Card Matrix',
        summary: 'Feature dashboard with modular cards. Better for browsing and snapshots.',
        metric: '6 cards',
        detail: 'Parallel previews, less docked chrome',
        outlineHint: 'Parallel dashboard tiles',
        panels: [
            { label: 'Hero', tone: 'accent', x: 0.04, y: 0.08, w: 0.92, h: 0.16 },
            { label: 'Card A', tone: 'success', x: 0.04, y: 0.31, w: 0.28, h: 0.24 },
            { label: 'Card B', tone: '', x: 0.36, y: 0.31, w: 0.28, h: 0.24 },
            { label: 'Card C', tone: 'warning', x: 0.68, y: 0.31, w: 0.28, h: 0.24 },
            { label: 'Card D', tone: '', x: 0.04, y: 0.62, w: 0.28, h: 0.24 },
            { label: 'Card E', tone: 'accent', x: 0.36, y: 0.62, w: 0.28, h: 0.24 },
            { label: 'Card F', tone: 'success', x: 0.68, y: 0.62, w: 0.28, h: 0.24 }
        ]
    }
];

function randomBetween(min, max) {
    return uniformDistribution(min, max, Math.random);
}

function getPreset(presetId) {
    return DESIGN_PRESETS.find((item) => item.id === presetId) || DESIGN_PRESETS[0];
}

function ensureStyles() {
    if (document.querySelector('link[data-plauna-styles="1"]')) {
        return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = STYLE_HREF;
    link.dataset.plaunaStyles = '1';
    document.head.appendChild(link);
}

function createShell(root, statusElement) {
    root.classList.add('plauna-lab-page');
    document.documentElement.classList.add('plauna-lab-page');
    document.body.classList.add('plauna-lab-page');

    const shell = document.createElement('div');
    shell.className = 'plauna-lab';
    shell.innerHTML = `
        <div class="plauna-lab__backdrop">
            <canvas class="plauna-lab__canvas" data-plauna-lab-canvas></canvas>
        </div>
        <div class="plauna-lab__surface">
            <div class="plauna-lab__app" id="plauna-root"></div>
        </div>
    `;

    const consoleDrawer = document.createElement('aside');
    consoleDrawer.className = 'plauna-lab-console';
    consoleDrawer.dataset.consolePeek = '0';
    consoleDrawer.setAttribute('aria-label', 'Plauna test console');

    if (statusElement.parentNode === root) {
        root.removeChild(statusElement);
    }
    consoleDrawer.appendChild(statusElement);
    root.replaceChildren(shell, consoleDrawer);

    return {
        plaunaRoot: shell.querySelector('#plauna-root'),
        canvas: shell.querySelector('[data-plauna-lab-canvas]'),
        consoleDrawer
    };
}

function renderMarkup(rootElement) {
    rootElement.innerHTML = `
        <div class="plauna-shell plauna-shell--lab">
            <header class="plauna-shell__header">
                <div class="plauna-shell__copy">
                    <div class="plauna-shell__badge">PLAUNA UI SYSTEM</div>
                    <h1 data-measure-text>Layout · Pretext · Motion · Theming · Widgets</h1>
                    <p data-measure-text>
                        Plauna is a retained-mode UI engine. It owns layout zones, design tokens,
                        canvas-based text measurement via Pretext, property transitions, toast
                        notifications, and the full widget library — so your pages stay thin.
                    </p>
                </div>
                <div class="plauna-shell__badge" id="design-badge">Active: Workbench</div>
            </header>
            <section class="plauna-shell__toolbar" id="plauna-toolbar"></section>
            <section class="plauna-shell__metrics" id="overview"></section>
            <main class="plauna-shell__main">
                <section class="plauna-stage" id="layout-stage" aria-label="Animated particle layout stage">
                    <div class="plauna-stage__ui" id="layout-stage-ui"></div>
                    <div class="plauna-stage__particles" id="particle-layer"></div>
                    <div class="plauna-stage__caption" id="stage-caption">Particle assembly idle</div>
                </section>
                <aside class="plauna-design-grid" id="design-grid"></aside>
            </main>
            <section class="plauna-pretext-panel" id="pretext-panel"></section>
            <section class="plauna-widget-gallery" id="widget-gallery"></section>
            <footer class="plauna-shell__footer">
                <span id="footer-status">Runtime not initialized.</span>
                <span class="plauna-chip" id="footer-chip">No surface</span>
            </footer>
        </div>
    `;
}

function renderToolbar(rootElement) {
    const toolbar = rootElement.querySelector('#plauna-toolbar');
    toolbar.innerHTML = `
        <span class="plauna-toolbar__divider"></span>
        <button type="button" data-design="editor">Workbench</button>
        <button type="button" data-design="command">Command Deck</button>
        <button type="button" data-design="cards">Card Matrix</button>
        <button type="button" data-action="auto-cycle" id="auto-cycle-btn">▶ Auto</button>
        <span class="plauna-toolbar__divider"></span>
        <button type="button" data-theme="light" class="plauna-theme-btn">☀ Light</button>
        <button type="button" data-theme="dark" class="plauna-theme-btn">◑ Dark</button>
        <button type="button" data-theme="high-contrast" class="plauna-theme-btn">● Hi-Con</button>
    `;
}

function renderDesignCards(rootElement) {
    const grid = rootElement.querySelector('#design-grid');
    grid.innerHTML = DESIGN_PRESETS.map((preset) => `
        <article class="plauna-design-card" data-theme="${preset.id}">
            <div class="plauna-chip">${preset.metric}</div>
            <div class="plauna-design-card__copy">
                <h2 data-measure-text>${preset.title}</h2>
                <p data-measure-text>${preset.summary}</p>
            </div>
            <div class="plauna-design-card__layout">
                <span class="plauna-chip">${preset.outlineHint}</span>
            </div>
            <div class="plauna-design-card__actions">
                <span>${preset.detail}</span>
                <button type="button" data-design="${preset.id}">Apply</button>
            </div>
        </article>
    `).join('');
}

function renderPretextPanel(rootElement) {
    const panel = rootElement.querySelector('#pretext-panel');
    if (!panel) return;
    panel.innerHTML = `
        <div class="plauna-pretext-demo">
            <header class="plauna-pretext-demo__header">
                <span class="plauna-shell__badge">PRETEXT — Canvas Text Measurement</span>
                <span class="plauna-chip" id="pretext-cache-chip">Cache: 0 hits</span>
            </header>
            <div class="plauna-pretext-demo__body">
                <div class="plauna-pretext-demo__controls">
                    <label class="plauna-pretext-label">
                        Text
                        <textarea id="pretext-input" class="plauna-pretext-textarea" rows="3" spellcheck="false">Plauna measures this text on a canvas without touching the DOM — no layout thrash.</textarea>
                    </label>
                    <div class="plauna-pretext-row">
                        <label class="plauna-pretext-label">
                            Font size
                            <select id="pretext-size" class="plauna-pretext-select">
                                <option value="12">12px</option>
                                <option value="14" selected>14px</option>
                                <option value="16">16px</option>
                                <option value="18">18px</option>
                                <option value="24">24px</option>
                            </select>
                        </label>
                        <label class="plauna-pretext-label">
                            Font weight
                            <select id="pretext-weight" class="plauna-pretext-select">
                                <option value="400" selected>400 Regular</option>
                                <option value="600">600 Semibold</option>
                                <option value="700">700 Bold</option>
                            </select>
                        </label>
                        <label class="plauna-pretext-label">
                            Container width
                            <select id="pretext-width" class="plauna-pretext-select">
                                <option value="160">160px</option>
                                <option value="240">240px</option>
                                <option value="320" selected>320px</option>
                                <option value="480">480px</option>
                                <option value="640">640px</option>
                            </select>
                        </label>
                    </div>
                </div>
                <div class="plauna-pretext-demo__output">
                    <div class="plauna-pretext-metrics" id="pretext-metrics">
                        <div class="plauna-pretext-metric"><span class="plauna-pretext-metric__label">Width</span><span class="plauna-pretext-metric__value" id="pm-width">—</span></div>
                        <div class="plauna-pretext-metric"><span class="plauna-pretext-metric__label">Lines</span><span class="plauna-pretext-metric__value" id="pm-lines">—</span></div>
                        <div class="plauna-pretext-metric"><span class="plauna-pretext-metric__label">Height</span><span class="plauna-pretext-metric__value" id="pm-height">—</span></div>
                        <div class="plauna-pretext-metric"><span class="plauna-pretext-metric__label">Ascent</span><span class="plauna-pretext-metric__value" id="pm-ascent">—</span></div>
                        <div class="plauna-pretext-metric"><span class="plauna-pretext-metric__label">Descent</span><span class="plauna-pretext-metric__value" id="pm-descent">—</span></div>
                        <div class="plauna-pretext-metric"><span class="plauna-pretext-metric__label">Baseline</span><span class="plauna-pretext-metric__value" id="pm-baseline">—</span></div>
                    </div>
                    <div class="plauna-pretext-ruler" id="pretext-ruler">
                        <div class="plauna-pretext-ruler__track" id="pretext-ruler-track">
                            <div class="plauna-pretext-ruler__text" id="pretext-ruler-text"></div>
                        </div>
                        <div class="plauna-pretext-ruler__label" id="pretext-ruler-label">320px</div>
                    </div>
                    <div class="plauna-pretext-preview-stage" id="pretext-preview-stage">
                        <div class="plauna-pretext-preview-lines" id="pretext-preview-lines"></div>
                        <div class="plauna-pretext-preview-particles" id="pretext-preview-particles"></div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderWidgetGallery(rootElement, toastManager) {
    const gallery = rootElement.querySelector('#widget-gallery');
    if (!gallery) return;
    gallery.innerHTML = `
        <div class="plauna-wgallery">
            <header class="plauna-wgallery__header">
                <span class="plauna-shell__badge">WIDGET LIBRARY</span>
            </header>
            <div class="plauna-wgallery__row">
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Buttons</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-toast="info" data-toast-msg="Primary button pressed">Primary</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-toast="info" data-toast-msg="Secondary button pressed">Secondary</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-toast="info" data-toast-msg="Ghost button pressed">Ghost</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" disabled>Disabled</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Badges</div>
                    <div class="plauna-wgallery__items">
                        <span class="plauna-demo-badge plauna-demo-badge--info">Info</span>
                        <span class="plauna-demo-badge plauna-demo-badge--success">Success</span>
                        <span class="plauna-demo-badge plauna-demo-badge--warning">Warning</span>
                        <span class="plauna-demo-badge plauna-demo-badge--error">Error</span>
                        <span class="plauna-demo-badge plauna-demo-badge--default">5</span>
                        <span class="plauna-demo-badge plauna-demo-badge--dot"></span>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Modal</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-modal="default">Open Modal</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-modal="warning">Warning Modal</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-modal="large">Large Modal</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Dropdown</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-dropdown="actions">Actions ▼</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-dropdown="options">Options ▼</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-dropdown="context">Context ▼</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Tooltips</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-tooltip="This is a helpful tooltip">Hover me</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-tooltip="Tooltip on top" data-tooltip-placement="top">Top</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-tooltip="Tooltip on right" data-tooltip-placement="right">Right</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Cards</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-card="product">Product Card</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-card="profile">Profile Card</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-card="elevated">Elevated Card</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Avatars</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-avatar="image">Image Avatar</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-avatar="initials">Initials</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-avatar="status">Status Avatar</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Breadcrumbs</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-breadcrumb="file">File Path</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-breadcrumb="site">Site Nav</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-breadcrumb="category">Category</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Pagination</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-pagination="standard">Standard</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-pagination="compact">Compact</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-pagination="jump">Jump to Page</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Progress</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-progress="linear">Linear</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-progress="circular">Circular</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-progress="indeterminate">Loading</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Skeletons</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-skeleton="text">Text</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-skeleton="avatar">Avatar</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-skeleton="paragraph">Paragraph</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Layout</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-layout="grid">Grid</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-layout="divider">Divider</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-layout="spacer">Spacer</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Input</div>
                    <div class="plauna-wgallery__items">
                        <input class="plauna-demo-input" type="text" placeholder="Type something…" />
                        <input class="plauna-demo-input" type="text" placeholder="Disabled" disabled />
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Form Controls</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-checkbox="default">Checkbox</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-radio="default">Radio</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-switch="default">Switch</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-select="default">Select</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-textarea="default">Textarea</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-slider="default">Slider</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-rating="default">Rating</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Data Display</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-table="default">Table</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-tree="default">Tree</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-list="default">List</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-chip="default">Chip</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Feedback & Status</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-alert="default">Alert</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-toast="default">Toast</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-spinner="default">Spinner</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-status="default">Status</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-emptystate="default">EmptyState</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Navigation & Layout</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-menu="default">Menu</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-navbar="default">Navbar</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-sidebar="default">Sidebar</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-stepper="default">Stepper</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-container="default">Container</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-section="default">Section</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-panel="default">Panel</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-collapse="default">Collapse</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-headerfooter="header">Header</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-headerfooter="footer">Footer</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-grid="default">Grid</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Input & Control</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-input="text">Input</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-button="default">Button</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-checkbox="default">Checkbox</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-radio="default">Radio</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-switch="default">Switch</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-select="default">Select</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-slider="default">Slider</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-progress="default">Progress</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-spinner="default">Spinner</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-file="default">File</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-color="default">Color</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-date="default">Date</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-time="default">Time</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-range="default">Range</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-rating="default">Rating</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-search="default">Search</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-number="default">Number</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-textarea="default">Textarea</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-tag="default">Tag</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-upload="default">Upload</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Toasts</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-toast="success" data-toast-msg="Operation succeeded!">Success</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-toast="warning" data-toast-msg="Heads up — something changed">Warning</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-toast="error" data-toast-msg="Something went wrong">Error</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-toast="loading" data-toast-msg="Working…">Loading</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    if (toastManager) {
        gallery.addEventListener('click', (e) => {
            console.log('Gallery click event triggered:', e.target);
            
            const btn = e.target.closest('[data-toast]');
            if (btn) {
                toastManager.show(btn.dataset.toastMsg || 'Action fired', btn.dataset.toast);
                return;
            }
            
            // Handle modal buttons
            const modalBtn = e.target.closest('[data-modal]');
            if (modalBtn) {
                const modalType = modalBtn.dataset.modal;
                const modalId = `demo-modal-${modalType}`;
                let modal = document.getElementById(modalId);
                
                if (!modal) {
                    // Create modal dynamically
                    createDemoModal(modalType, modalId, toastManager);
                    modal = document.getElementById(modalId);
                }
                
                if (modal && modal.open) {
                    modal.open();
                }
                return;
            }
            
            // Handle dropdown buttons
            const dropdownBtn = e.target.closest('[data-dropdown]');
            if (dropdownBtn) {
                const dropdownType = dropdownBtn.dataset.dropdown;
                createDemoDropdown(dropdownType, dropdownBtn);
                return;
            }
            
            // Handle card buttons
            const cardBtn = e.target.closest('[data-card]');
            if (cardBtn) {
                console.log('Card button clicked:', cardBtn.dataset.card);
                e.stopPropagation(); // Prevent event from bubbling up
                try {
                    const cardType = cardBtn.dataset.card;
                    createDemoCard(cardType, cardBtn, toastManager);
                } catch (error) {
                    console.error('Card demo error:', error);
                    toastManager.show('Card demo error', 'error');
                }
                return;
            }
            
            // Handle avatar buttons
            const avatarBtn = e.target.closest('[data-avatar]');
            if (avatarBtn) {
                console.log('Avatar button clicked:', avatarBtn.dataset.avatar);
                e.stopPropagation(); // Prevent event from bubbling up
                try {
                    const avatarType = avatarBtn.dataset.avatar;
                    createDemoAvatar(avatarType, avatarBtn, toastManager);
                } catch (error) {
                    console.error('Avatar demo error:', error);
                    toastManager.show('Avatar demo error', 'error');
                }
                return;
            }
            
            // Handle breadcrumb buttons
            const breadcrumbBtn = e.target.closest('[data-breadcrumb]');
            if (breadcrumbBtn) {
                console.log('Breadcrumb button clicked:', breadcrumbBtn.dataset.breadcrumb);
                e.stopPropagation(); // Prevent event from bubbling up
                try {
                    const breadcrumbType = breadcrumbBtn.dataset.breadcrumb;
                    createDemoBreadcrumb(breadcrumbType, breadcrumbBtn, toastManager);
                } catch (error) {
                    console.error('Breadcrumb demo error:', error);
                    toastManager.show('Breadcrumb demo error', 'error');
                }
                return;
            }
            
            // Handle pagination buttons
            const paginationBtn = e.target.closest('[data-pagination]');
            if (paginationBtn) {
                console.log('Pagination button clicked:', paginationBtn.dataset.pagination);
                e.stopPropagation(); // Prevent event from bubbling up
                try {
                    const paginationType = paginationBtn.dataset.pagination;
                    createDemoPagination(paginationType, paginationBtn, toastManager);
                } catch (error) {
                    console.error('Pagination demo error:', error);
                    toastManager.show('Pagination demo error', 'error');
                }
                return;
            }
            
            // Handle progress buttons
            const progressBtn = e.target.closest('[data-progress]');
            if (progressBtn) {
                console.log('Progress button clicked:', progressBtn.dataset.progress);
                e.stopPropagation(); // Prevent event from bubbling up
                try {
                    const progressType = progressBtn.dataset.progress;
                    createDemoProgress(progressType, progressBtn, toastManager);
                } catch (error) {
                    console.error('Progress demo error:', error);
                    toastManager.show('Progress demo error', 'error');
                }
                return;
            }
            
            // Handle skeleton buttons
            const skeletonBtn = e.target.closest('[data-skeleton]');
            if (skeletonBtn) {
                console.log('Skeleton button clicked:', skeletonBtn.dataset.skeleton);
                e.stopPropagation(); // Prevent event from bubbling up
                try {
                    const skeletonType = skeletonBtn.dataset.skeleton;
                    createDemoSkeleton(skeletonType, skeletonBtn, toastManager);
                } catch (error) {
                    console.error('Skeleton demo error:', error);
                    toastManager.show('Skeleton demo error', 'error');
                }
                return;
            }
            
            // Handle layout buttons
            const layoutBtn = e.target.closest('[data-layout]');
            if (layoutBtn) {
                console.log('Layout button clicked:', layoutBtn.dataset.layout);
                e.stopPropagation(); // Prevent event from bubbling up
                try {
                    const layoutType = layoutBtn.dataset.layout;
                    createDemoLayout(layoutType, layoutBtn, toastManager);
                } catch (error) {
                    console.error('Layout demo error:', error);
                    toastManager.show('Layout demo error', 'error');
                }
                return;
            }
            
            // Handle form control buttons
            const checkboxBtn = e.target.closest('[data-checkbox]');
            if (checkboxBtn) {
                console.log('Checkbox button clicked:', checkboxBtn.dataset.checkbox);
                e.stopPropagation();
                try {
                    const checkboxType = checkboxBtn.dataset.checkbox;
                    createCheckboxWidget(checkboxType, checkboxBtn, toastManager);
                } catch (error) {
                    console.error('Checkbox widget error:', error);
                    toastManager.show('Checkbox widget error', 'error');
                }
                return;
            }
            
            const radioBtn = e.target.closest('[data-radio]');
            if (radioBtn) {
                console.log('Radio button clicked:', radioBtn.dataset.radio);
                e.stopPropagation();
                try {
                    const radioType = radioBtn.dataset.radio;
                    createRadioWidget(radioType, radioBtn, toastManager);
                } catch (error) {
                    console.error('Radio widget error:', error);
                    toastManager.show('Radio widget error', 'error');
                }
                return;
            }
            
            const switchBtn = e.target.closest('[data-switch]');
            if (switchBtn) {
                console.log('Switch button clicked:', switchBtn.dataset.switch);
                e.stopPropagation();
                try {
                    const switchType = switchBtn.dataset.switch;
                    createSwitchWidget(switchType, switchBtn, toastManager);
                } catch (error) {
                    console.error('Switch widget error:', error);
                    toastManager.show('Switch widget error', 'error');
                }
                return;
            }
            
            const selectBtn = e.target.closest('[data-select]');
            if (selectBtn) {
                console.log('Select button clicked:', selectBtn.dataset.select);
                e.stopPropagation();
                try {
                    const selectType = selectBtn.dataset.select;
                    createSelectWidget(selectType, selectBtn, toastManager);
                } catch (error) {
                    console.error('Select widget error:', error);
                    toastManager.show('Select widget error', 'error');
                }
                return;
            }
            
            const textareaBtn = e.target.closest('[data-textarea]');
            if (textareaBtn) {
                console.log('Textarea button clicked:', textareaBtn.dataset.textarea);
                e.stopPropagation();
                try {
                    const textareaType = textareaBtn.dataset.textarea;
                    createTextareaWidget(textareaType, textareaBtn, toastManager);
                } catch (error) {
                    console.error('Textarea widget error:', error);
                    toastManager.show('Textarea widget error', 'error');
                }
                return;
            }
            
            const sliderBtn = e.target.closest('[data-slider]');
            if (sliderBtn) {
                console.log('Slider button clicked:', sliderBtn.dataset.slider);
                e.stopPropagation();
                try {
                    const sliderType = sliderBtn.dataset.slider;
                    createSliderWidget(sliderType, sliderBtn, toastManager);
                } catch (error) {
                    console.error('Slider widget error:', error);
                    toastManager.show('Slider widget error', 'error');
                }
                return;
            }
            
            const ratingBtn = e.target.closest('[data-rating]');
            if (ratingBtn) {
                console.log('Rating button clicked:', ratingBtn.dataset.rating);
                e.stopPropagation();
                try {
                    const ratingType = ratingBtn.dataset.rating;
                    createRatingWidget(ratingType, ratingBtn, toastManager);
                } catch (error) {
                    console.error('Rating widget error:', error);
                    toastManager.show('Rating widget error', 'error');
                }
                return;
            }
            
            // Handle data display buttons
            const tableBtn = e.target.closest('[data-table]');
            if (tableBtn) {
                console.log('Table button clicked:', tableBtn.dataset.table);
                e.stopPropagation();
                try {
                    const tableType = tableBtn.dataset.table;
                    createDemoTable(tableType, tableBtn, toastManager);
                } catch (error) {
                    console.error('Table demo error:', error);
                    toastManager.show('Table demo error', 'error');
                }
                return;
            }
            
            const treeBtn = e.target.closest('[data-tree]');
            if (treeBtn) {
                console.log('Tree button clicked:', treeBtn.dataset.tree);
                e.stopPropagation();
                try {
                    const treeType = treeBtn.dataset.tree;
                    createDemoTree(treeType, treeBtn, toastManager);
                } catch (error) {
                    console.error('Tree demo error:', error);
                    toastManager.show('Tree demo error', 'error');
                }
                return;
            }
            
            const listBtn = e.target.closest('[data-list]');
            if (listBtn) {
                console.log('List button clicked:', listBtn.dataset.list);
                e.stopPropagation();
                try {
                    const listType = listBtn.dataset.list;
                    createDemoList(listType, listBtn, toastManager);
                } catch (error) {
                    console.error('List demo error:', error);
                    toastManager.show('List demo error', 'error');
                }
                return;
            }
            
            const chipBtn = e.target.closest('[data-chip]');
            if (chipBtn) {
                console.log('Chip button clicked:', chipBtn.dataset.chip);
                e.stopPropagation();
                try {
                    const chipType = chipBtn.dataset.chip;
                    createDemoChip(chipType, chipBtn, toastManager);
                } catch (error) {
                    console.error('Chip demo error:', error);
                    toastManager.show('Chip demo error', 'error');
                }
                return;
            }
            
            // Handle feedback buttons
            const alertBtn = e.target.closest('[data-alert]');
            if (alertBtn) {
                console.log('Alert button clicked:', alertBtn.dataset.alert);
                e.stopPropagation();
                try {
                    const alertType = alertBtn.dataset.alert;
                    createDemoAlert(alertType, alertBtn, toastManager);
                } catch (error) {
                    console.error('Alert demo error:', error);
                    toastManager.show('Alert demo error', 'error');
                }
                return;
            }
            
            const toastBtn = e.target.closest('[data-toast]');
            if (toastBtn) {
                console.log('Toast button clicked:', toastBtn.dataset.toast);
                e.stopPropagation();
                try {
                    const toastType = toastBtn.dataset.toast;
                    createDemoToast(toastType, toastBtn, toastManager);
                } catch (error) {
                    console.error('Toast demo error:', error);
                    toastManager.show('Toast demo error', 'error');
                }
                return;
            }
            
            const spinnerBtn = e.target.closest('[data-spinner]');
            if (spinnerBtn) {
                console.log('Spinner button clicked:', spinnerBtn.dataset.spinner);
                e.stopPropagation();
                try {
                    const spinnerType = spinnerBtn.dataset.spinner;
                    createDemoSpinner(spinnerType, spinnerBtn, toastManager);
                } catch (error) {
                    console.error('Spinner demo error:', error);
                    toastManager.show('Spinner demo error', 'error');
                }
                return;
            }
            
            const statusBtn = e.target.closest('[data-status]');
            if (statusBtn) {
                console.log('Status button clicked:', statusBtn.dataset.status);
                e.stopPropagation();
                try {
                    const statusType = statusBtn.dataset.status;
                    createDemoStatus(statusType, statusBtn, toastManager);
                } catch (error) {
                    console.error('Status demo error:', error);
                    toastManager.show('Status demo error', 'error');
                }
                return;
            }
            
            const emptystateBtn = e.target.closest('[data-emptystate]');
            if (emptystateBtn) {
                console.log('EmptyState button clicked:', emptystateBtn.dataset.emptystate);
                e.stopPropagation();
                try {
                    const emptystateType = emptystateBtn.dataset.emptystate;
                    createDemoEmptyState(emptystateType, emptystateBtn, toastManager);
                } catch (error) {
                    console.error('EmptyState demo error:', error);
                    toastManager.show('EmptyState demo error', 'error');
                }
                return;
            }
            
            // Handle navigation buttons
            const menuBtn = e.target.closest('[data-menu]');
            if (menuBtn) {
                console.log('Menu button clicked:', menuBtn.dataset.menu);
                e.stopPropagation();
                try {
                    const menuType = menuBtn.dataset.menu;
                    createDemoMenu(menuType, menuBtn, toastManager);
                } catch (error) {
                    console.error('Menu demo error:', error);
                    toastManager.show('Menu demo error', 'error');
                }
                return;
            }
            
            const navbarBtn = e.target.closest('[data-navbar]');
            if (navbarBtn) {
                console.log('Navbar button clicked:', navbarBtn.dataset.navbar);
                e.stopPropagation();
                try {
                    const navbarType = navbarBtn.dataset.navbar;
                    createDemoNavbar(navbarType, navbarBtn, toastManager);
                } catch (error) {
                    console.error('Navbar demo error:', error);
                    toastManager.show('Navbar demo error', 'error');
                }
                return;
            }
            
            const sidebarBtn = e.target.closest('[data-sidebar]');
            if (sidebarBtn) {
                console.log('Sidebar button clicked:', sidebarBtn.dataset.sidebar);
                e.stopPropagation();
                try {
                    const sidebarType = sidebarBtn.dataset.sidebar;
                    createDemoSidebar(sidebarType, sidebarBtn, toastManager);
                } catch (error) {
                    console.error('Sidebar demo error:', error);
                    toastManager.show('Sidebar demo error', 'error');
                }
                return;
            }
            
            // Handle stepper buttons
            const stepperBtn = e.target.closest('[data-stepper]');
            if (stepperBtn) {
                console.log('Stepper button clicked:', stepperBtn.dataset.stepper);
                e.stopPropagation();
                try {
                    const stepperType = stepperBtn.dataset.stepper;
                    createDemoStepper(stepperType, stepperBtn, toastManager);
                } catch (error) {
                    console.error('Stepper demo error:', error);
                    toastManager.show('Stepper demo error', 'error');
                }
                return;
            }
            
            // Handle container buttons
            const containerBtn = e.target.closest('[data-container]');
            if (containerBtn) {
                console.log('Container button clicked:', containerBtn.dataset.container);
                e.stopPropagation();
                try {
                    const containerType = containerBtn.dataset.container;
                    createDemoContainer(containerType, containerBtn, toastManager);
                } catch (error) {
                    console.error('Container demo error:', error);
                    toastManager.show('Container demo error', 'error');
                }
                return;
            }
            
            // Handle section buttons
            const sectionBtn = e.target.closest('[data-section]');
            if (sectionBtn) {
                console.log('Section button clicked:', sectionBtn.dataset.section);
                e.stopPropagation();
                try {
                    const sectionType = sectionBtn.dataset.section;
                    createDemoSection(sectionType, sectionBtn, toastManager);
                } catch (error) {
                    console.error('Section demo error:', error);
                    toastManager.show('Section demo error', 'error');
                }
                return;
            }
            
            // Handle panel buttons
            const panelBtn = e.target.closest('[data-panel]');
            if (panelBtn) {
                console.log('Panel button clicked:', panelBtn.dataset.panel);
                e.stopPropagation();
                try {
                    const panelType = panelBtn.dataset.panel;
                    createDemoPanel(panelType, panelBtn, toastManager);
                } catch (error) {
                    console.error('Panel demo error:', error);
                    toastManager.show('Panel demo error', 'error');
                }
                return;
            }
            
            // Handle collapse buttons
            const collapseBtn = e.target.closest('[data-collapse]');
            if (collapseBtn) {
                console.log('Collapse button clicked:', collapseBtn.dataset.collapse);
                e.stopPropagation();
                try {
                    const collapseType = collapseBtn.dataset.collapse;
                    createDemoCollapse(collapseType, collapseBtn, toastManager);
                } catch (error) {
                    console.error('Collapse demo error:', error);
                    toastManager.show('Collapse demo error', 'error');
                }
                return;
            }
            
            // Handle headerfooter buttons
            const headerFooterBtn = e.target.closest('[data-headerfooter]');
            if (headerFooterBtn) {
                console.log('HeaderFooter button clicked:', headerFooterBtn.dataset.headerfooter);
                e.stopPropagation();
                try {
                    const headerFooterType = headerFooterBtn.dataset.headerfooter;
                    createDemoHeaderFooter(headerFooterType, headerFooterBtn, toastManager);
                } catch (error) {
                    console.error('HeaderFooter demo error:', error);
                    toastManager.show('HeaderFooter demo error', 'error');
                }
                return;
            }
            
            // Handle grid buttons
            const gridBtn = e.target.closest('[data-grid]');
            if (gridBtn) {
                console.log('Grid button clicked:', gridBtn.dataset.grid);
                e.stopPropagation();
                try {
                    const gridType = gridBtn.dataset.grid;
                    createDemoGrid(gridType, gridBtn, toastManager);
                } catch (error) {
                    console.error('Grid demo error:', error);
                    toastManager.show('Grid demo error', 'error');
                }
                return;
            }
            
            // Handle input buttons
            const inputBtn = e.target.closest('[data-input]');
            if (inputBtn) {
                console.log('Input button clicked:', inputBtn.dataset.input);
                e.stopPropagation();
                try {
                    const inputType = inputBtn.dataset.input;
                    createInputWidget(inputType, inputBtn, toastManager);
                } catch (error) {
                    console.error('Input widget error:', error);
                    toastManager.show('Input widget error', 'error');
                }
                return;
            }
            
            // Handle button buttons
            const buttonBtn = e.target.closest('[data-button]');
            if (buttonBtn) {
                console.log('Button button clicked:', buttonBtn.dataset.button);
                e.stopPropagation();
                try {
                    const buttonType = buttonBtn.dataset.button;
                    createButtonWidget(buttonType, buttonBtn, toastManager);
                } catch (error) {
                    console.error('Button widget error:', error);
                    toastManager.show('Button widget error', 'error');
                }
                return;
            }
            
            // Handle file buttons
            const fileBtn = e.target.closest('[data-file]');
            if (fileBtn) {
                console.log('File button clicked:', fileBtn.dataset.file);
                e.stopPropagation();
                try {
                    const fileType = fileBtn.dataset.file;
                    createFileWidget(fileType, fileBtn, toastManager);
                } catch (error) {
                    console.error('File widget error:', error);
                    toastManager.show('File widget error', 'error');
                }
                return;
            }
            
            // Handle color buttons
            const colorBtn = e.target.closest('[data-color]');
            if (colorBtn) {
                console.log('Color button clicked:', colorBtn.dataset.color);
                e.stopPropagation();
                try {
                    const colorType = colorBtn.dataset.color;
                    createColorWidget(colorType, colorBtn, toastManager);
                } catch (error) {
                    console.error('Color widget error:', error);
                    toastManager.show('Color widget error', 'error');
                }
                return;
            }
            
            // Handle date buttons
            const dateBtn = e.target.closest('[data-date]');
            if (dateBtn) {
                console.log('Date button clicked:', dateBtn.dataset.date);
                e.stopPropagation();
                try {
                    const dateType = dateBtn.dataset.date;
                    createDateWidget(dateType, dateBtn, toastManager);
                } catch (error) {
                    console.error('Date widget error:', error);
                    toastManager.show('Date widget error', 'error');
                }
                return;
            }
            
            // Handle time buttons
            const timeBtn = e.target.closest('[data-time]');
            if (timeBtn) {
                console.log('Time button clicked:', timeBtn.dataset.time);
                e.stopPropagation();
                try {
                    const timeType = timeBtn.dataset.time;
                    createTimeWidget(timeType, timeBtn, toastManager);
                } catch (error) {
                    console.error('Time widget error:', error);
                    toastManager.show('Time widget error', 'error');
                }
                return;
            }
            
            // Handle range buttons
            const rangeBtn = e.target.closest('[data-range]');
            if (rangeBtn) {
                console.log('Range button clicked:', rangeBtn.dataset.range);
                e.stopPropagation();
                try {
                    const rangeType = rangeBtn.dataset.range;
                    createRangeWidget(rangeType, rangeBtn, toastManager);
                } catch (error) {
                    console.error('Range widget error:', error);
                    toastManager.show('Range widget error', 'error');
                }
                return;
            }
            
            // Handle search buttons
            const searchBtn = e.target.closest('[data-search]');
            if (searchBtn) {
                console.log('Search button clicked:', searchBtn.dataset.search);
                e.stopPropagation();
                try {
                    const searchType = searchBtn.dataset.search;
                    createSearchWidget(searchType, searchBtn, toastManager);
                } catch (error) {
                    console.error('Search widget error:', error);
                    toastManager.show('Search widget error', 'error');
                }
                return;
            }
            
            // Handle number buttons
            const numberBtn = e.target.closest('[data-number]');
            if (numberBtn) {
                console.log('Number button clicked:', numberBtn.dataset.number);
                e.stopPropagation();
                try {
                    const numberType = numberBtn.dataset.number;
                    createNumberWidget(numberType, numberBtn, toastManager);
                } catch (error) {
                    console.error('Number widget error:', error);
                    toastManager.show('Number widget error', 'error');
                }
                return;
            }
            
            // Handle tag buttons
            const tagBtn = e.target.closest('[data-tag]');
            if (tagBtn) {
                console.log('Tag button clicked:', tagBtn.dataset.tag);
                e.stopPropagation();
                try {
                    const tagType = tagBtn.dataset.tag;
                    createTagWidget(tagType, tagBtn, toastManager);
                } catch (error) {
                    console.error('Tag widget error:', error);
                    toastManager.show('Tag widget error', 'error');
                }
                return;
            }
            
            // Handle upload buttons
            const uploadBtn = e.target.closest('[data-upload]');
            if (uploadBtn) {
                console.log('Upload button clicked:', uploadBtn.dataset.upload);
                e.stopPropagation();
                try {
                    const uploadType = uploadBtn.dataset.upload;
                    createUploadWidget(uploadType, uploadBtn, toastManager);
                } catch (error) {
                    console.error('Upload widget error:', error);
                    toastManager.show('Upload widget error', 'error');
                }
                return;
            }
        });
        
        // Handle tooltips
        gallery.addEventListener('mouseover', (e) => {
            const tooltipBtn = e.target.closest('[data-tooltip]');
            if (tooltipBtn && !tooltipBtn._tooltip) {
                const tooltipText = tooltipBtn.dataset.tooltip;
                const placement = tooltipBtn.dataset.tooltipPlacement || 'top';
                
                // Create tooltip using theme-based styling
                const tooltipStyles = widgetStyleManager.getWidgetStyles('tooltip');
                const tooltipElement = widgetStyleManager.createStyledElement('div', tooltipStyles.container, 'plauna-demo-tooltip');
                tooltipElement.textContent = tooltipText;
                
                document.body.appendChild(tooltipElement);
                
                // Position tooltip
                const rect = tooltipBtn.getBoundingClientRect();
                const tooltipRect = tooltipElement.getBoundingClientRect();
                
                let top = rect.top - tooltipRect.height - 8;
                let left = rect.left + (rect.width - tooltipRect.width) / 2;
                
                // Adjust if tooltip would go outside viewport
                if (top < 10) {
                    top = rect.bottom + 8;
                }
                if (left < 10) {
                    left = 10;
                } else if (left + tooltipRect.width > window.innerWidth - 10) {
                    left = window.innerWidth - tooltipRect.width - 10;
                }
                
                tooltipElement.style.top = `${top + window.pageYOffset}px`;
                tooltipElement.style.left = `${left + window.pageXOffset}px`;
                
                // Animate in using theme styles
                requestAnimationFrame(() => {
                    widgetStyleManager.applyStyles(tooltipElement, tooltipStyles.visible);
                });
                
                tooltipBtn._tooltip = tooltipElement;
            }
        });
        
        gallery.addEventListener('mouseout', (e) => {
            const tooltipBtn = e.target.closest('[data-tooltip]');
            if (tooltipBtn && tooltipBtn._tooltip) {
                const tooltipElement = tooltipBtn._tooltip;
                
                // Animate out using theme styles
                const tooltipStyles = widgetStyleManager.getWidgetStyles('tooltip');
                widgetStyleManager.applyStyles(tooltipElement, { 
                    opacity: '0',
                    transform: 'scale(0.8)'
                });
                
                setTimeout(() => {
                    if (tooltipElement.parentNode) {
                        tooltipElement.parentNode.removeChild(tooltipElement);
                    }
                }, 150);
                
                tooltipBtn._tooltip = null;
            }
        });
    }
}

function createDemoModal(type, modalId, toastManager) {
    const modalConfigs = {
        default: {
            title: 'Demo Modal',
            content: 'This is a demonstration of the Modal widget with focus trapping and accessibility features.',
            size: 'md',
            variant: 'default'
        },
        warning: {
            title: 'Warning',
            content: 'This is a warning modal with a different variant styling. Important information is displayed here.',
            size: 'sm',
            variant: 'warning'
        },
        large: {
            title: 'Large Modal',
            content: 'This is a large modal that can contain more content. It demonstrates the size variants available in the Modal widget. You can put forms, lists, or any other content here.',
            size: 'lg',
            variant: 'default'
        }
    };
    
    const config = modalConfigs[type] || modalConfigs.default;
    
    // Create modal using theme-based styling
    const modalStyles = widgetStyleManager.getWidgetStyles('modal');
    const modalElement = widgetStyleManager.createStyledElement('div', modalStyles.overlay, 'plauna-demo-modal');
    modalElement.id = modalId;
    
    const sizeStyles = {
        sm: { width: '320px', minHeight: '160px' },
        md: { width: '500px', minHeight: '280px' },
        lg: { width: '700px', minHeight: '400px' }
    };
    
    const modalPanel = widgetStyleManager.createStyledElement('div', modalStyles.panel);
    
    // Apply size-specific styles
    if (sizeStyles[config.size]) {
        widgetStyleManager.applyStyles(modalPanel, {
            width: sizeStyles[config.size].width,
            minHeight: sizeStyles[config.size].minHeight
        });
    }
    
    // Header
    const header = widgetStyleManager.createStyledElement('header', modalStyles.header);
    
    const title = widgetStyleManager.createStyledElement('h2', modalStyles.title);
    title.textContent = config.title;
    
    const closeButton = widgetStyleManager.createStyledElement('button', modalStyles.closeButton);
    closeButton.innerHTML = '×';
    
    closeButton.addEventListener('mouseenter', () => {
        widgetStyleManager.applyStyles(closeButton, modalStyles.closeButtonHover);
    });
    
    closeButton.addEventListener('mouseleave', () => {
        widgetStyleManager.applyStyles(closeButton, { backgroundColor: 'transparent', color: '#94a3b8' });
    });
    
    closeButton.addEventListener('click', () => closeModal());
    
    header.appendChild(title);
    header.appendChild(closeButton);
    
    // Content
    const content = widgetStyleManager.createStyledElement('div', modalStyles.content);
    content.textContent = config.content;
    
    modalPanel.appendChild(header);
    modalPanel.appendChild(content);
    modalElement.appendChild(modalPanel);
    
    // Add to DOM
    document.body.appendChild(modalElement);
    
    // Modal functions
    function openModal() {
        widgetStyleManager.applyStyles(modalElement, { opacity: '1' });
        widgetStyleManager.applyStyles(modalPanel, { transform: 'scale(1)' });
        toastManager.show(`${config.title} modal opened`, 'info');
    }
    
    function closeModal() {
        widgetStyleManager.applyStyles(modalElement, { opacity: '0' });
        widgetStyleManager.applyStyles(modalPanel, { transform: 'scale(0.95)' });
        setTimeout(() => {
            if (modalElement.parentNode) {
                modalElement.parentNode.removeChild(modalElement);
            }
        }, 200);
    }
    
    // Close on backdrop click
    modalElement.addEventListener('click', (e) => {
        if (e.target === modalElement) {
            closeModal();
        }
    });
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    // Store reference
    modalElement.open = openModal;
    modalElement.close = closeModal;
    
    // Open immediately
    openModal();
}

function createDemoDropdown(type, triggerButton) {
    const dropdownConfigs = {
        actions: {
            items: [
                { label: 'Copy', icon: '📋', shortcut: 'Ctrl+C', action: () => console.log('Copy action') },
                { label: 'Paste', icon: '📄', shortcut: 'Ctrl+V', action: () => console.log('Paste action') },
                { label: 'Cut', icon: '✂️', shortcut: 'Ctrl+X', action: () => console.log('Cut action') },
                { type: 'divider' },
                { label: 'Delete', icon: '🗑️', shortcut: 'Del', action: () => console.log('Delete action') }
            ]
        },
        options: {
            items: [
                { label: 'Settings', icon: '⚙️', action: () => console.log('Settings') },
                { label: 'Preferences', icon: '🎨', action: () => console.log('Preferences') },
                { label: 'Help', icon: '❓', action: () => console.log('Help') },
                { type: 'divider' },
                { label: 'About', icon: 'ℹ️', action: () => console.log('About') }
            ]
        },
        context: {
            items: [
                { label: 'View', icon: '👁️', action: () => console.log('View') },
                { label: 'Edit', icon: '✏️', action: () => console.log('Edit') },
                { label: 'Share', icon: '🔗', action: () => console.log('Share') },
                { type: 'divider' },
                { label: 'Properties', icon: '📊', action: () => console.log('Properties') }
            ]
        }
    };
    
    const config = dropdownConfigs[type] || dropdownConfigs.actions;
    
    // Create dropdown using theme-based styling
    const dropdownStyles = widgetStyleManager.getWidgetStyles('dropdown');
    const dropdownElement = widgetStyleManager.createStyledElement('div', dropdownStyles.container, 'plauna-demo-dropdown');
    
    // Create menu items
    config.items.forEach(item => {
        if (item.type === 'divider') {
            const divider = widgetStyleManager.createStyledElement('div', dropdownStyles.divider);
            dropdownElement.appendChild(divider);
        } else {
            const menuItem = widgetStyleManager.createStyledElement('div', dropdownStyles.menuItem);
            
            const content = widgetStyleManager.createStyledElement('div', dropdownStyles.menuItemContent);
            
            if (item.icon) {
                const icon = widgetStyleManager.createStyledElement('span', dropdownStyles.icon);
                icon.textContent = item.icon;
                content.appendChild(icon);
            }
            
            const label = document.createElement('span');
            label.textContent = item.label;
            content.appendChild(label);
            
            menuItem.appendChild(content);
            
            if (item.shortcut) {
                const shortcut = widgetStyleManager.createStyledElement('span', dropdownStyles.shortcut);
                shortcut.textContent = item.shortcut;
                content.appendChild(shortcut);
            }
            
            menuItem.addEventListener('mouseenter', () => {
                widgetStyleManager.applyStyles(menuItem, dropdownStyles.menuItemHover);
            });
            
            menuItem.addEventListener('mouseleave', () => {
                widgetStyleManager.applyStyles(menuItem, { backgroundColor: 'transparent' });
            });
            
            menuItem.addEventListener('click', () => {
                if (item.action) {
                    item.action(item);
                }
                closeDropdown();
            });
            
            dropdownElement.appendChild(menuItem);
        }
    });
    
    // Add to DOM
    document.body.appendChild(dropdownElement);
    
    // Position dropdown
    const rect = triggerButton.getBoundingClientRect();
    const dropdownRect = dropdownElement.getBoundingClientRect();
    
    let top = rect.bottom + 4;
    let left = rect.left;
    
    // Adjust if dropdown would go outside viewport
    if (top + dropdownRect.height > window.innerHeight - 10) {
        top = rect.top - dropdownRect.height - 4;
    }
    if (left + dropdownRect.width > window.innerWidth - 10) {
        left = window.innerWidth - dropdownRect.width - 10;
    }
    if (left < 10) {
        left = 10;
    }
    
    dropdownElement.style.top = `${top + window.pageYOffset}px`;
    dropdownElement.style.left = `${left + window.pageXOffset}px`;
    
    // Dropdown functions
    function openDropdown() {
        widgetStyleManager.applyStyles(dropdownElement, {
            opacity: '1',
            transform: 'scale(1) translateY(0)'
        });
    }
    
    function closeDropdown() {
        widgetStyleManager.applyStyles(dropdownElement, {
            opacity: '0',
            transform: 'scale(0.95) translateY(-8px)'
        });
        setTimeout(() => {
            if (dropdownElement.parentNode) {
                dropdownElement.parentNode.removeChild(dropdownElement);
            }
        }, 150);
    }
    
    // Close on outside click
    const outsideClickHandler = (e) => {
        if (!dropdownElement.contains(e.target) && !triggerButton.contains(e.target)) {
            closeDropdown();
            document.removeEventListener('click', outsideClickHandler);
        }
    };
    document.addEventListener('click', outsideClickHandler);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeDropdown();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    // Open immediately
    openDropdown();
}

function createDemoCard(type, triggerButton, toastManager) {
    const cardConfigs = {
        product: {
            title: 'Premium Widget',
            content: 'Experience the power of Plauna with our premium widget collection. Built with performance and accessibility in mind.',
            image: 'https://picsum.photos/seed/plauna/300/200.jpg',
            price: '$29.99'
        },
        profile: {
            title: 'John Doe',
            content: 'Senior UI Engineer passionate about creating beautiful and accessible user interfaces.',
            image: 'https://picsum.photos/seed/avatar/100/100.jpg',
            status: 'Available for hire'
        },
        elevated: {
            title: 'Featured Card',
            content: 'This card showcases the elevated variant with enhanced shadows and visual depth.',
            image: 'https://picsum.photos/seed/elevated/300/180.jpg'
        }
    };
    
    const config = cardConfigs[type] || cardConfigs.product;
    
    // Create card using theme-based styling
    const cardStyles = widgetStyleManager.getWidgetStyles('card');
    const cardElement = widgetStyleManager.createStyledElement('div', cardStyles.container, 'plauna-demo-card');
    
    // Image
    if (config.image) {
        const image = widgetStyleManager.createStyledElement('img', cardStyles.image);
        image.src = config.image;
        cardElement.appendChild(image);
    }
    
    // Content
    const content = widgetStyleManager.createStyledElement('div', cardStyles.content);
    
    // Title
    const title = widgetStyleManager.createStyledElement('h3', cardStyles.title);
    title.textContent = config.title;
    content.appendChild(title);
    
    // Description
    const description = widgetStyleManager.createStyledElement('p', cardStyles.description);
    description.textContent = config.content;
    content.appendChild(description);
    
    // Footer
    if (config.price || config.status) {
        const footer = widgetStyleManager.createStyledElement('div', cardStyles.footer);
        
        if (config.price) {
            const price = widgetStyleManager.createStyledElement('span', cardStyles.price);
            price.textContent = config.price;
            footer.appendChild(price);
        }
        
        if (config.status) {
            const status = widgetStyleManager.createStyledElement('span', cardStyles.status);
            status.textContent = config.status;
            footer.appendChild(status);
        }
        
        content.appendChild(footer);
    }
    
    cardElement.appendChild(content);
    
    // Add to DOM
    document.body.appendChild(cardElement);
    
    // Animate in
    requestAnimationFrame(() => {
        widgetStyleManager.applyStyles(cardElement, {
            opacity: '1',
            transform: 'translate(-50%, -50%) scale(1)'
        });
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!cardElement.contains(e.target)) {
                closeCard();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeCard();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeCard() {
        widgetStyleManager.applyStyles(cardElement, {
            opacity: '0',
            transform: 'translate(-50%, -50%) scale(0.9)'
        });
        setTimeout(() => {
            if (cardElement.parentNode) {
                cardElement.parentNode.removeChild(cardElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.title} card displayed`, 'info');
}

function createDemoAvatar(type, triggerButton, toastManager) {
    const avatarConfigs = {
        image: {
            src: 'https://picsum.photos/seed/avatar/100/100.jpg',
            name: 'Sarah Johnson',
            status: 'online'
        },
        initials: {
            name: 'Michael Chen',
            status: 'busy'
        },
        status: {
            name: 'Emily Davis',
            status: 'away',
            showStatus: true
        }
    };
    
    const config = avatarConfigs[type] || avatarConfigs.image;
    
    // Create avatar using theme-based styling
    const avatarStyles = widgetStyleManager.getWidgetStyles('avatar');
    const avatarElement = widgetStyleManager.createStyledElement('div', avatarStyles.container, 'plauna-demo-avatar');
    
    // Avatar image/initials
    const avatarImage = widgetStyleManager.createStyledElement('div', avatarStyles.image);
    
    if (config.src) {
        widgetStyleManager.applyStyles(avatarImage, {
            backgroundImage: `url(${config.src})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center'
        });
    } else {
        avatarImage.textContent = config.name.split(' ').map(n => n[0]).join('').toUpperCase();
    }
    
    avatarElement.appendChild(avatarImage);
    
    // Status indicator
    if (config.showStatus !== false && config.status) {
        const status = widgetStyleManager.createStyledElement('div', avatarStyles.status);
        widgetStyleManager.applyStyles(status, {
            background: getStatusColor(config.status)
        });
        avatarElement.appendChild(status);
    }
    
    // Name
    const name = widgetStyleManager.createStyledElement('div', avatarStyles.name);
    name.textContent = config.name;
    avatarElement.appendChild(name);
    
    // Status text
    const statusText = widgetStyleManager.createStyledElement('div', avatarStyles.statusText);
    statusText.textContent = config.status;
    avatarElement.appendChild(statusText);
    
    // Add to DOM
    document.body.appendChild(avatarElement);
    
    // Animate in
    requestAnimationFrame(() => {
        widgetStyleManager.applyStyles(avatarElement, {
            opacity: '1',
            transform: 'translate(-50%, -50%) scale(1)'
        });
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!avatarElement.contains(e.target)) {
                closeAvatar();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeAvatar();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeAvatar() {
        widgetStyleManager.applyStyles(avatarElement, {
            opacity: '0',
            transform: 'translate(-50%, -50%) scale(0.9)'
        });
        setTimeout(() => {
            if (avatarElement.parentNode) {
                avatarElement.parentNode.removeChild(avatarElement);
            }
        }, 200);
    }
    
    function getStatusColor(status) {
        const colors = {
            online: '#10b981',
            offline: '#64748b',
            busy: '#ef4444',
            away: '#f59e0b'
        };
        return colors[status] || '#64748b';
    }
    
    toastManager.show(`${config.name} avatar displayed`, 'info');
}

function createDemoBreadcrumb(type, triggerButton, toastManager) {
    const breadcrumbConfigs = {
        file: {
            items: ['root', 'documents', 'projects', 'plauna', 'widgets', 'Card.js']
        },
        site: {
            items: ['Home', 'Products', 'Widgets', 'Card Component']
        },
        category: {
            items: ['UI Components', 'Layout', 'Cards', 'Product Cards']
        }
    };
    
    const config = breadcrumbConfigs[type] || breadcrumbConfigs.file;
    
    // Create breadcrumb using theme-based styling
    const breadcrumbStyles = widgetStyleManager.getWidgetStyles('breadcrumb');
    const breadcrumbElement = widgetStyleManager.createStyledElement('div', breadcrumbStyles.container, 'plauna-demo-breadcrumb');
    
    // Create breadcrumb items
    config.items.forEach((item, index) => {
        const isLast = index === config.items.length - 1;
        const itemElement = widgetStyleManager.createStyledElement('div', isLast ? breadcrumbStyles.itemLast : breadcrumbStyles.item);
        itemElement.textContent = item;
        
        if (!isLast) {
            itemElement.addEventListener('click', () => {
                toastManager.show(`Navigate to: ${item}`, 'info');
            });
            
            itemElement.addEventListener('mouseenter', () => {
                widgetStyleManager.applyStyles(itemElement, breadcrumbStyles.itemHover);
            });
            
            itemElement.addEventListener('mouseleave', () => {
                widgetStyleManager.applyStyles(itemElement, { color: '#3b82f6' });
            });
        }
        
        breadcrumbElement.appendChild(itemElement);
        
        // Add separator if not last
        if (!isLast) {
            const separator = widgetStyleManager.createStyledElement('span', breadcrumbStyles.separator);
            separator.textContent = '/';
            breadcrumbElement.appendChild(separator);
        }
    });
    
    // Add to DOM
    document.body.appendChild(breadcrumbElement);
    
    // Animate in
    requestAnimationFrame(() => {
        widgetStyleManager.applyStyles(breadcrumbElement, breadcrumbStyles.visible);
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!breadcrumbElement.contains(e.target)) {
                closeBreadcrumb();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeBreadcrumb();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeBreadcrumb() {
        widgetStyleManager.applyStyles(breadcrumbElement, breadcrumbStyles.hidden);
        setTimeout(() => {
            if (breadcrumbElement.parentNode) {
                breadcrumbElement.parentNode.removeChild(breadcrumbElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} breadcrumb displayed`, 'info');
}

function createDemoPagination(type, triggerButton, toastManager) {
    const paginationConfigs = {
        standard: {
            currentPage: 3,
            totalPages: 10,
            showItemsPerPage: true
        },
        compact: {
            currentPage: 5,
            totalPages: 20,
            showItemsPerPage: false
        },
        jump: {
            currentPage: 7,
            totalPages: 50,
            showJumpToPage: true
        }
    };
    
    const config = paginationConfigs[type] || paginationConfigs.standard;
    
    // Create pagination using theme-based styling
    const paginationStyles = widgetStyleManager.getWidgetStyles('pagination');
    const paginationElement = widgetStyleManager.createStyledElement('div', paginationStyles.container, 'plauna-demo-pagination');
    
    // Previous button
    const prevBtn = widgetStyleManager.createStyledElement('button', paginationStyles.button);
    prevBtn.textContent = '←';
    
    prevBtn.addEventListener('mouseenter', () => {
        widgetStyleManager.applyStyles(prevBtn, paginationStyles.buttonHover);
    });
    
    prevBtn.addEventListener('mouseleave', () => {
        widgetStyleManager.applyStyles(prevBtn, { background: '#3b82f6' });
    });
    
    paginationElement.appendChild(prevBtn);
    
    // Page numbers
    const startPage = Math.max(1, config.currentPage - 2);
    const endPage = Math.min(config.totalPages, config.currentPage + 2);
    
    for (let i = startPage; i <= endPage; i++) {
        const isActive = i === config.currentPage;
        const pageBtn = widgetStyleManager.createStyledElement('button', isActive ? paginationStyles.buttonActive : paginationStyles.button);
        pageBtn.textContent = i;
        
        if (!isActive) {
            pageBtn.addEventListener('mouseenter', () => {
                widgetStyleManager.applyStyles(pageBtn, paginationStyles.buttonHover);
            });
            
            pageBtn.addEventListener('mouseleave', () => {
                widgetStyleManager.applyStyles(pageBtn, { background: 'transparent', color: '#e4e4e7' });
            });
        }
        
        paginationElement.appendChild(pageBtn);
    }
    
    // Next button
    const nextBtn = widgetStyleManager.createStyledElement('button', paginationStyles.button);
    nextBtn.textContent = '→';
    
    nextBtn.addEventListener('mouseenter', () => {
        widgetStyleManager.applyStyles(nextBtn, paginationStyles.buttonHover);
    });
    
    nextBtn.addEventListener('mouseleave', () => {
        widgetStyleManager.applyStyles(nextBtn, { background: '#3b82f6' });
    });
    
    paginationElement.appendChild(nextBtn);
    
    // Add to DOM
    document.body.appendChild(paginationElement);
    
    // Animate in
    requestAnimationFrame(() => {
        widgetStyleManager.applyStyles(paginationElement, paginationStyles.visible);
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!paginationElement.contains(e.target)) {
                closePagination();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closePagination();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closePagination() {
        widgetStyleManager.applyStyles(paginationElement, paginationStyles.hidden);
        setTimeout(() => {
            if (paginationElement.parentNode) {
                paginationElement.parentNode.removeChild(paginationElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} pagination displayed`, 'info');
}

function createDemoProgress(type, triggerButton, toastManager) {
    const progressConfigs = {
        linear: {
            type: 'linear',
            value: 75,
            variant: 'default'
        },
        circular: {
            type: 'circular',
            value: 60,
            variant: 'success'
        },
        indeterminate: {
            type: 'linear',
            indeterminate: true,
            variant: 'info'
        }
    };
    
    const config = progressConfigs[type] || progressConfigs.linear;
    
    // Create progress as a simple DOM element for demo
    const progressElement = document.createElement('div');
    progressElement.className = 'plauna-demo-progress';
    progressElement.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(15, 23, 42, 0.95);
        border: 1px solid rgba(99, 116, 141, 0.3);
        border-radius: 8px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        padding: 24px;
        z-index: 1000;
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.9);
        transition: all 200ms ease;
        backdrop-filter: blur(4px);
        min-width: 300px;
    `;
    
    // Title
    const title = document.createElement('div');
    title.textContent = `${config.type.charAt(0).toUpperCase() + config.type.slice(1)} Progress`;
    title.style.cssText = `
        font-size: 16px;
        font-weight: 600;
        color: #e4e4e7;
        margin-bottom: 16px;
        text-align: center;
    `;
    progressElement.appendChild(title);
    
    // Progress bar
    const progressBar = document.createElement('div');
    progressBar.style.cssText = `
        width: 100%;
        height: 8px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 12px;
    `;
    
    const progressFill = document.createElement('div');
    progressFill.style.cssText = `
        height: 100%;
        width: ${config.indeterminate ? '30%' : config.value + '%'};
        background: ${config.variant === 'success' ? '#10b981' : config.variant === 'info' ? '#06b6d4' : '#3b82f6'};
        border-radius: 4px;
        transition: width 300ms ease;
        ${config.indeterminate ? 'animation: progressIndeterminate 1.5s ease-in-out infinite;' : ''}
    `;
    
    progressBar.appendChild(progressFill);
    progressElement.appendChild(progressBar);
    
    // Percentage
    const percentage = document.createElement('div');
    percentage.textContent = config.indeterminate ? 'Loading...' : `${config.value}%`;
    percentage.style.cssText = `
        text-align: center;
        font-size: 14px;
        color: #94a3b8;
    `;
    progressElement.appendChild(percentage);
    
    // Add CSS animation for indeterminate
    if (config.indeterminate) {
        const style = document.createElement('style');
        style.textContent = `
            @keyframes progressIndeterminate {
                0% { margin-left: -30%; }
                60% { margin-left: 100%; }
                100% { margin-left: 100%; }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Add to DOM
    document.body.appendChild(progressElement);
    
    // Animate in
    requestAnimationFrame(() => {
        progressElement.style.opacity = '1';
        progressElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Animate progress
    if (!config.indeterminate) {
        setTimeout(() => {
            progressFill.style.width = '90%';
            percentage.textContent = '90%';
        }, 500);
    }
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!progressElement.contains(e.target)) {
                closeProgress();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeProgress();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeProgress() {
        progressElement.style.opacity = '0';
        progressElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (progressElement.parentNode) {
                progressElement.parentNode.removeChild(progressElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.type} progress displayed`, 'info');
}

function createDemoSkeleton(type, triggerButton, toastManager) {
    const skeletonConfigs = {
        text: {
            type: 'text',
            lines: 3
        },
        avatar: {
            type: 'avatar',
            size: 'md'
        },
        paragraph: {
            type: 'paragraph',
            lines: 4
        }
    };
    
    const config = skeletonConfigs[type] || skeletonConfigs.text;
    
    // Create skeleton as a simple DOM element for demo
    const skeletonElement = document.createElement('div');
    skeletonElement.className = 'plauna-demo-skeleton';
    skeletonElement.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(15, 23, 42, 0.95);
        border: 1px solid rgba(99, 116, 141, 0.3);
        border-radius: 8px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        padding: 24px;
        z-index: 1000;
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.9);
        transition: all 200ms ease;
        backdrop-filter: blur(4px);
        min-width: 300px;
    `;
    
    // Title
    const title = document.createElement('div');
    title.textContent = `${config.type.charAt(0).toUpperCase() + config.type.slice(1)} Skeleton`;
    title.style.cssText = `
        font-size: 16px;
        font-weight: 600;
        color: #e4e4e7;
        margin-bottom: 20px;
        text-align: center;
    `;
    skeletonElement.appendChild(title);
    
    // Create skeleton content
    if (config.type === 'avatar') {
        const avatar = document.createElement('div');
        avatar.style.cssText = `
            width: 60px;
            height: 60px;
            background: linear-gradient(90deg, rgba(255, 255, 255, 0.1) 25%, transparent 50%, rgba(255, 255, 255, 0.1) 75%);
            background-size: 200% 200%;
            border-radius: 50%;
            margin: 0 auto;
            animation: skeletonShimmer 1.5s ease-in-out infinite;
        `;
        skeletonElement.appendChild(avatar);
    } else {
        // Create text skeleton lines
        for (let i = 0; i < config.lines; i++) {
            const line = document.createElement('div');
            const width = Math.floor(uniformDistribution(60, 100, Math.random)); // 60-99%
            line.style.cssText = `
                height: 16px;
                width: ${width}%;
                background: linear-gradient(90deg, rgba(255, 255, 255, 0.1) 25%, transparent 50%, rgba(255, 255, 255, 0.1) 75%);
                background-size: 200% 200%;
                border-radius: 4px;
                margin-bottom: 8px;
                animation: skeletonShimmer 1.5s ease-in-out infinite;
            `;
            skeletonElement.appendChild(line);
        }
    }
    
    // Add CSS animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes skeletonShimmer {
            0% { background-position: -200% 0; }
            100% { background-position: 200% 0; }
        }
    `;
    document.head.appendChild(style);
    
    // Add to DOM
    document.body.appendChild(skeletonElement);
    
    // Animate in
    requestAnimationFrame(() => {
        skeletonElement.style.opacity = '1';
        skeletonElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!skeletonElement.contains(e.target)) {
                closeSkeleton();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeSkeleton();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeSkeleton() {
        skeletonElement.style.opacity = '0';
        skeletonElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (skeletonElement.parentNode) {
                skeletonElement.parentNode.removeChild(skeletonElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.type} skeleton displayed`, 'info');
}

function createDemoLayout(type, triggerButton, toastManager) {
    const layoutConfigs = {
        grid: {
            type: 'grid',
            columns: 3,
            gap: '16px'
        },
        divider: {
            type: 'divider',
            orientation: 'horizontal',
            label: 'Section Divider'
        },
        spacer: {
            type: 'spacer',
            size: 'lg',
            direction: 'vertical'
        }
    };
    
    const config = layoutConfigs[type] || layoutConfigs.grid;
    
    // Create layout demo as a simple DOM element for demo
    const layoutElement = document.createElement('div');
    layoutElement.className = 'plauna-demo-layout';
    layoutElement.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(15, 23, 42, 0.95);
        border: 1px solid rgba(99, 116, 141, 0.3);
        border-radius: 8px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        padding: 24px;
        z-index: 1000;
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.9);
        transition: all 200ms ease;
        backdrop-filter: blur(4px);
        min-width: 400px;
    `;
    
    // Title
    const title = document.createElement('div');
    title.textContent = `${config.type.charAt(0).toUpperCase() + config.type.slice(1)} Layout`;
    title.style.cssText = `
        font-size: 16px;
        font-weight: 600;
        color: #e4e4e7;
        margin-bottom: 20px;
        text-align: center;
    `;
    layoutElement.appendChild(title);
    
    // Create layout content
    if (config.type === 'grid') {
        const grid = document.createElement('div');
        grid.style.cssText = `
            display: grid;
            grid-template-columns: repeat(${config.columns}, 1fr);
            gap: ${config.gap};
            margin-bottom: 16px;
        `;
        
        // Add grid items
        for (let i = 0; i < 6; i++) {
            const item = document.createElement('div');
            item.style.cssText = `
                background: rgba(59, 130, 246, 0.2);
                border: 1px solid #3b82f6;
                border-radius: 4px;
                padding: 12px;
                color: #e4e4e7;
                text-align: center;
                font-size: 14px;
            `;
            item.textContent = `Grid Item ${i + 1}`;
            grid.appendChild(item);
        }
        
        layoutElement.appendChild(grid);
    } else if (config.type === 'divider') {
        const divider = document.createElement('div');
        divider.style.cssText = `
            display: flex;
            align-items: center;
            gap: 16px;
            margin: 20px 0;
        `;
        
        const line1 = document.createElement('div');
        line1.style.cssText = `
            flex: 1;
            height: 1px;
            background: #64748b;
        `;
        divider.appendChild(line1);
        
        if (config.label) {
            const label = document.createElement('div');
            label.textContent = config.label;
            label.style.cssText = `
                color: #94a3b8;
                font-size: 14px;
            `;
            divider.appendChild(label);
        }
        
        const line2 = document.createElement('div');
        line2.style.cssText = `
            flex: 1;
            height: 1px;
            background: #64748b;
        `;
        divider.appendChild(line2);
        
        layoutElement.appendChild(divider);
    } else if (config.type === 'spacer') {
        const spacer = document.createElement('div');
        spacer.style.cssText = `
            display: flex;
            flex-direction: ${config.direction === 'vertical' ? 'column' : 'row'};
            align-items: center;
            gap: 8px;
        `;
        
        // Add spacers
        for (let i = 0; i < 3; i++) {
            const space = document.createElement('div');
            space.style.cssText = `
                ${config.direction === 'vertical' ? 'height' : 'width'}: ${config.size === 'lg' ? '24px' : '16px'};
                background: rgba(99, 116, 141, 0.2);
                border: 1px dashed #64748b;
                border-radius: 4px;
            `;
            spacer.appendChild(space);
        }
        
        layoutElement.appendChild(spacer);
    }
    
    // Add to DOM
    document.body.appendChild(layoutElement);
    
    // Animate in
    requestAnimationFrame(() => {
        layoutElement.style.opacity = '1';
        layoutElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!layoutElement.contains(e.target)) {
                closeLayout();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeLayout();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeLayout() {
        layoutElement.style.opacity = '0';
        layoutElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (layoutElement.parentNode) {
                layoutElement.parentNode.removeChild(layoutElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.type} layout displayed`, 'info');
}

function createDemoCheckbox(type, triggerButton, toastManager) {
    const checkboxConfigs = {
        default: {
            label: 'Accept terms and conditions',
            description: 'I agree to the terms of service'
        },
        primary: {
            label: 'Enable notifications',
            description: 'Receive email updates'
        },
        success: {
            label: 'Completed task',
            description: 'Task marked as complete'
        }
    };
    
    const config = checkboxConfigs[type] || checkboxConfigs.default;
    
    // Create checkbox as a simple DOM element for demo
    const checkboxElement = document.createElement('div');
    checkboxElement.className = 'plauna-demo-checkbox';
    checkboxElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 24px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 300px;'
    );
    
    // Create checkbox input
    const checkboxInput = document.createElement('input');
    checkboxInput.type = 'checkbox';
    checkboxInput.style.cssText = (
        'width: 20px;' +
        'height: 20px;' +
        'margin-right: 12px;' +
        'accent-color: #3b82f6;' +
        'cursor: pointer;'
    );
    
    // Create label container
    const labelContainer = document.createElement('div');
    labelContainer.style.cssText = (
        'color: #e4e4e7;' +
        'font-size: 14px;' +
        'font-weight: 500;'
    );
    
    // Label text
    const labelText = document.createElement('div');
    labelText.textContent = config.label;
    labelText.style.cssText = (
        'margin-bottom: 4px;'
    );
    labelContainer.appendChild(labelText);
    
    // Description
    const description = document.createElement('div');
    description.textContent = config.description;
    description.style.cssText = (
        'font-size: 12px;' +
        'color: #94a3b8;' +
        'opacity: 0.8;'
    );
    labelContainer.appendChild(description);
    
    checkboxElement.appendChild(checkboxInput);
    checkboxElement.appendChild(labelContainer);
    
    // Add to DOM
    document.body.appendChild(checkboxElement);
    
    // Animate in
    requestAnimationFrame(() => {
        checkboxElement.style.opacity = '1';
        checkboxElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!checkboxElement.contains(e.target)) {
                closeCheckbox();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeCheckbox();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeCheckbox() {
        checkboxElement.style.opacity = '0';
        checkboxElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (checkboxElement.parentNode) {
                checkboxElement.parentNode.removeChild(checkboxElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.label} checkbox displayed`, 'info');
}

function createDemoRadio(type, triggerButton, toastManager) {
    const radioConfigs = {
        default: {
            label: 'Default option',
            description: 'Standard radio button'
        },
        primary: {
            label: 'Premium option',
            description: 'Enhanced radio button'
        },
        success: {
            label: 'Recommended',
            description: 'Suggested choice'
        }
    };
    
    const config = radioConfigs[type] || radioConfigs.default;
    
    // Create radio as a simple DOM element for demo
    const radioElement = document.createElement('div');
    radioElement.className = 'plauna-demo-radio';
    radioElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 24px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 300px;'
    );
    
    // Create radio input
    const radioInput = document.createElement('input');
    radioInput.type = 'radio';
    radioInput.name = 'demo-radio-group';
    radioInput.style.cssText = (
        'width: 20px;' +
        'height: 20px;' +
        'margin-right: 12px;' +
        'accent-color: #3b82f6;' +
        'cursor: pointer;'
    );
    
    // Create label container
    const labelContainer = document.createElement('div');
    labelContainer.style.cssText = (
        'color: #e4e4e7;' +
        'font-size: 14px;' +
        'font-weight: 500;'
    );
    
    // Label text
    const labelText = document.createElement('div');
    labelText.textContent = config.label;
    labelText.style.cssText = (
        'margin-bottom: 4px;'
    );
    labelContainer.appendChild(labelText);
    
    // Description
    const description = document.createElement('div');
    description.textContent = config.description;
    description.style.cssText = (
        'font-size: 12px;' +
        'color: #94a3b8;' +
        'opacity: 0.8;'
    );
    labelContainer.appendChild(description);
    
    radioElement.appendChild(radioInput);
    radioElement.appendChild(labelContainer);
    
    // Add to DOM
    document.body.appendChild(radioElement);
    
    // Animate in
    requestAnimationFrame(() => {
        radioElement.style.opacity = '1';
        radioElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!radioElement.contains(e.target)) {
                closeRadio();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeRadio();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeRadio() {
        radioElement.style.opacity = '0';
        radioElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (radioElement.parentNode) {
                radioElement.parentNode.removeChild(radioElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.label} radio displayed`, 'info');
}

function createDemoSwitch(type, triggerButton, toastManager) {
    const switchConfigs = {
        default: {
            label: 'Dark mode',
            description: 'Toggle dark theme'
        },
        primary: {
            label: 'Notifications',
            description: 'Enable notifications'
        },
        success: {
            label: 'Auto-save',
            description: 'Auto-save changes'
        }
    };
    
    const config = switchConfigs[type] || switchConfigs.default;
    
    // Create switch as a simple DOM element for demo
    const switchElement = document.createElement('div');
    switchElement.className = 'plauna-demo-switch';
    switchElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 24px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 300px;'
    );
    
    // Create switch container
    const switchContainer = document.createElement('div');
    switchContainer.style.cssText = (
        'display: flex;' +
        'align-items: center;' +
        'gap: 16px;' +
        'cursor: pointer;' +
        'padding: 8px 0;'
    );
    
    // Create switch track
    const switchTrack = document.createElement('div');
    switchTrack.style.cssText = (
        'width: 48px;' +
        'height: 24px;' +
        'background: #64748b;' +
        'border-radius: 12px;' +
        'position: relative;' +
        'transition: all 150ms ease;' +
        'cursor: pointer;'
    );
    
    // Create switch thumb
    const switchThumb = document.createElement('div');
    switchThumb.style.cssText = (
        'position: absolute;' +
        'top: 2px;' +
        'left: 2px;' +
        'width: 20px;' +
        'height: 20px;' +
        'background: white;' +
        'border-radius: 50%;' +
        'transition: all 150ms ease;' +
        'box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);' +
        'cursor: pointer;'
    );
    
    switchTrack.appendChild(switchThumb);
    
    // Create label container
    const labelContainer = document.createElement('div');
    labelContainer.style.cssText = (
        'color: #e4e4e7;' +
        'font-size: 14px;' +
        'font-weight: 500;'
    );
    
    // Label text
    const labelText = document.createElement('div');
    labelText.textContent = config.label;
    labelText.style.cssText = (
        'margin-bottom: 4px;'
    );
    labelContainer.appendChild(labelText);
    
    // Description
    const description = document.createElement('div');
    description.textContent = config.description;
    description.style.cssText = (
        'font-size: 12px;' +
        'color: #94a3b8;' +
        'opacity: 0.8;'
    );
    labelContainer.appendChild(description);
    
    // Switch interaction state
    let isOn = false;
    
    // Update switch visual state
    function updateSwitch(on) {
        isOn = on;
        if (on) {
            switchTrack.style.background = '#3b82f6';
            switchThumb.style.left = '26px';
        } else {
            switchTrack.style.background = '#64748b';
            switchThumb.style.left = '2px';
        }
    }
    
    // Handle switch click
    function handleSwitchClick(e) {
        e.preventDefault();
        updateSwitch(!isOn);
        toastManager.show(`${config.label}: ${isOn ? 'ON' : 'OFF'}`, 'info');
    }
    
    switchContainer.addEventListener('click', handleSwitchClick);
    switchTrack.addEventListener('click', handleSwitchClick);
    switchThumb.addEventListener('click', handleSwitchClick);
    
    // Handle keyboard interaction
    switchContainer.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            updateSwitch(!isOn);
            toastManager.show(`${config.label}: ${isOn ? 'ON' : 'OFF'}`, 'info');
        }
    });
    
    // Make switch focusable
    switchContainer.setAttribute('tabindex', '0');
    switchContainer.setAttribute('role', 'switch');
    switchContainer.setAttribute('aria-checked', 'false');
    
    switchContainer.appendChild(switchTrack);
    switchContainer.appendChild(labelContainer);
    switchElement.appendChild(switchContainer);
    
    // Add to DOM
    document.body.appendChild(switchElement);
    
    // Animate in
    requestAnimationFrame(() => {
        switchElement.style.opacity = '1';
        switchElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!switchElement.contains(e.target)) {
                closeSwitch();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeSwitch();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeSwitch() {
        switchElement.style.opacity = '0';
        switchElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (switchElement.parentNode) {
                switchElement.parentNode.removeChild(switchElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.label} switch displayed`, 'info');
}

function createDemoSelect(type, triggerButton, toastManager) {
    const selectConfigs = {
        default: {
            options: [
                { value: 'option1', label: 'Option 1' },
                { value: 'option2', label: 'Option 2' },
                { value: 'option3', label: 'Option 3' }
            ],
            placeholder: 'Choose an option'
        },
        primary: {
            options: [
                { value: 'primary', label: 'Primary Choice' },
                { value: 'secondary', label: 'Secondary Choice' },
                { value: 'tertiary', label: 'Tertiary Choice' }
            ],
            placeholder: 'Select priority'
        },
        searchable: {
            options: [
                { value: 'apple', label: 'Apple' },
                { value: 'banana', label: 'Banana' },
                { value: 'cherry', label: 'Cherry' },
                { value: 'date', label: 'Date' },
                { value: 'elderberry', label: 'Elderberry' }
            ],
            placeholder: 'Search fruits...',
            searchable: true
        }
    };
    
    const config = selectConfigs[type] || selectConfigs.default;
    
    // Create select as a simple DOM element for demo
    const selectElement = document.createElement('div');
    selectElement.className = 'plauna-demo-select';
    selectElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 24px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 300px;'
    );
    
    // Create select input
    const selectInput = document.createElement('input');
    selectInput.type = 'text';
    selectInput.placeholder = config.placeholder;
    selectInput.readOnly = true;
    selectInput.style.cssText = (
        'width: 100%;' +
        'padding: 12px;' +
        'background: rgba(255, 255, 255, 0.1);' +
        'color: #e4e4e7;' +
        'border: 1px solid rgba(255, 255, 255, 0.2);' +
        'border-radius: 8px;' +
        'font-size: 14px;' +
        'margin-bottom: 16px;'
    );
    
    // Create dropdown arrow
    const dropdownArrow = document.createElement('span');
    dropdownArrow.textContent = '▼';
    dropdownArrow.style.cssText = (
        'position: absolute;' +
        'right: 12px;' +
        'top: 50%;' +
        'transform: translateY(-50%);' +
        'color: #94a3b8;' +
        'font-size: 12px;' +
        'pointer-events: none;'
    );
    
    selectInput.style.position = 'relative';
    selectInput.appendChild(dropdownArrow);
    
    // Create options list
    const optionsList = document.createElement('ul');
    optionsList.style.cssText = (
        'list-style: none;' +
        'margin: 0;' +
        'padding: 0;' +
        'max-height: 150px;' +
        'overflow-y: auto;' +
        'background: rgba(255, 255, 255, 0.05);' +
        'border-radius: 8px;' +
        'border: 1px solid rgba(255, 255, 255, 0.2);'
    );
    
    // Add options
    config.options.forEach(option => {
        const optionElement = document.createElement('li');
        optionElement.textContent = option.label;
        optionElement.style.cssText = (
            'padding: 8px 12px;' +
            'color: #e4e4e7;' +
            'cursor: pointer;' +
            'transition: background 150ms ease;' +
            'list-style: none;'
        );
        
        optionElement.addEventListener('mouseenter', () => {
            optionElement.style.background = 'rgba(59, 130, 246, 0.1)';
        });
        
        optionElement.addEventListener('mouseleave', () => {
            optionElement.style.background = 'transparent';
        });
        
        optionElement.addEventListener('click', () => {
            selectInput.value = option.label;
            toastManager.show(`Selected: ${option.label}`, 'success');
        });
        
        optionsList.appendChild(optionElement);
    });
    
    selectElement.appendChild(selectInput);
    selectElement.appendChild(optionsList);
    
    // Add to DOM
    document.body.appendChild(selectElement);
    
    // Animate in
    requestAnimationFrame(() => {
        selectElement.style.opacity = '1';
        selectElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!selectElement.contains(e.target)) {
                closeSelect();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeSelect();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeSelect() {
        selectElement.style.opacity = '0';
        selectElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (selectElement.parentNode) {
                selectElement.parentNode.removeChild(selectElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} select displayed`, 'info');
}

function createDemoTextarea(type, triggerButton, toastManager) {
    const textareaConfigs = {
        default: {
            placeholder: 'Enter your message here...',
            rows: 4
        },
        large: {
            placeholder: 'Enter detailed description...',
            rows: 6
        },
        limited: {
            placeholder: 'Limited to 100 characters',
            rows: 3,
            maxLength: 100
        }
    };
    
    const config = textareaConfigs[type] || textareaConfigs.default;
    
    // Create textarea as a simple DOM element for demo
    const textareaElement = document.createElement('div');
    textareaElement.className = 'plauna-demo-textarea';
    textareaElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 24px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 400px;'
    );
    
    // Create textarea
    const textarea = document.createElement('textarea');
    textarea.placeholder = config.placeholder;
    textarea.rows = config.rows;
    if (config.maxLength) {
        textarea.maxLength = config.maxLength;
    }
    textarea.style.cssText = (
        'width: 100%;' +
        'min-height: ' + (config.rows * 20) + 'px;' +
        'padding: 12px;' +
        'background: rgba(255, 255, 255, 0.1);' +
        'color: #e4e4e7;' +
        'border: 1px solid rgba(255, 255, 255, 0.2);' +
        'border-radius: 8px;' +
        'font-family: inherit;' +
        'font-size: 14px;' +
        'line-height: 1.5;' +
        'resize: vertical;' +
        'outline: none;'
    );
    
    // Create character count if maxLength is set
    let characterCount = null;
    if (config.maxLength) {
        characterCount = document.createElement('div');
        characterCount.textContent = '0/' + config.maxLength;
        characterCount.style.cssText = (
            'position: absolute;' +
            'right: 12px;' +
            'bottom: 12px;' +
            'font-size: 12px;' +
            'color: #94a3b8;' +
            'background: rgba(255, 255, 255, 0.1);' +
            'padding: 2px 6px;' +
            'border-radius: 4px;' +
            'border: 1px solid rgba(255, 255, 255, 0.2);'
        );
        
        textarea.addEventListener('input', () => {
            const length = textarea.value.length;
            characterCount.textContent = length + '/' + config.maxLength;
            characterCount.style.color = length > config.maxLength * 0.9 ? '#ef4444' : '#94a3b8';
        });
    }
    
    textareaElement.appendChild(textarea);
    if (characterCount) {
        textareaElement.appendChild(characterCount);
    }
    
    // Add to DOM
    document.body.appendChild(textareaElement);
    
    // Animate in
    requestAnimationFrame(() => {
        textareaElement.style.opacity = '1';
        textareaElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!textareaElement.contains(e.target)) {
                closeTextarea();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeTextarea();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeTextarea() {
        textareaElement.style.opacity = '0';
        textareaElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (textareaElement.parentNode) {
                textareaElement.parentNode.removeChild(textareaElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} textarea displayed`, 'info');
}

function createDemoSlider(type, triggerButton, toastManager) {
    const sliderConfigs = {
        default: {
            min: 0,
            max: 100,
            value: 50,
            step: 5
        },
        volume: {
            min: 0,
            max: 100,
            value: 30,
            step: 1,
            variant: 'primary'
        },
        rating: {
            min: 1,
            max: 5,
            value: 3,
            step: 1,
            variant: 'warning',
            showMarks: true
        }
    };
    
    const config = sliderConfigs[type] || sliderConfigs.default;
    
    // Create slider as a simple DOM element for demo
    const sliderElement = document.createElement('div');
    sliderElement.className = 'plauna-demo-slider';
    sliderElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 24px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 300px;'
    );
    
    // Create slider track
    const track = document.createElement('div');
    track.style.cssText = (
        'width: 100%;' +
        'height: 4px;' +
        'background: #64748b;' +
        'border-radius: 2px;' +
        'position: relative;' +
        'margin-bottom: 16px;' +
        'cursor: pointer;'
    );
    
    // Create slider fill
    const fill = document.createElement('div');
    fill.style.cssText = (
        'position: absolute;' +
        'top: 0;' +
        'left: 0;' +
        'height: 100%;' +
        'width: ' + ((config.value - config.min) / (config.max - config.min) * 100) + '%;' +
        'background: ' + (config.variant === 'primary' ? '#3b82f6' : config.variant === 'warning' ? '#f59e0b' : '#64748b') + ';' +
        'border-radius: 2px;' +
        'transition: all 150ms ease;'
    );
    
    // Create slider thumb
    const thumb = document.createElement('div');
    thumb.style.cssText = (
        'position: absolute;' +
        'top: -8px;' +
        'left: ' + ((config.value - config.min) / (config.max - config.min) * 100) + '%;' +
        'transform: translateX(-50%);' +
        'width: 20px;' +
        'height: 20px;' +
        'background: ' + (config.variant === 'primary' ? '#3b82f6' : config.variant === 'warning' ? '#f59e0b' : '#64748b') + ';' +
        'border: 2px solid white;' +
        'border-radius: 50%;' +
        'cursor: grab;' +
        'box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);' +
        'transition: all 150ms ease;'
    );
    
    // Create value display
    const valueDisplay = document.createElement('div');
    valueDisplay.textContent = config.value.toString();
    valueDisplay.style.cssText = (
        'text-align: center;' +
        'font-size: 16px;' +
        'font-weight: bold;' +
        'color: #e4e4e7;' +
        'background: rgba(255, 255, 255, 0.1);' +
        'padding: 4px 8px;' +
        'border-radius: 4px;' +
        'border: 1px solid rgba(255, 255, 255, 0.2);' +
        'margin-top: 8px;'
    );
    
    // Add marks if enabled
    if (config.showMarks) {
        const marks = [config.min, Math.floor((config.min + config.max) / 2), config.max];
        marks.forEach((mark, index) => {
            const markElement = document.createElement('div');
            markElement.textContent = mark.toString();
            markElement.style.cssText = (
                'position: absolute;' +
                'bottom: -20px;' +
                'left: ' + (index * 50) + '%;' +
                'transform: translateX(-50%);' +
                'font-size: 12px;' +
                'color: #94a3b8;' +
                'background: rgba(255, 255, 255, 0.1);' +
                'padding: 2px 4px;' +
                'border-radius: 4px;' +
                'border: 1px solid rgba(255, 255, 255, 0.2);'
            );
            sliderElement.appendChild(markElement);
        });
    }
    
    // Slider interaction state
    let isDragging = false;
    let currentValue = config.value;
    
    // Update slider visual state
    function updateSlider(value) {
        currentValue = Math.max(config.min, Math.min(config.max, value));
        const percentage = ((currentValue - config.min) / (config.max - config.min)) * 100;
        
        fill.style.width = percentage + '%';
        thumb.style.left = percentage + '%';
        valueDisplay.textContent = currentValue.toString();
    }
    
    // Handle track click
    track.addEventListener('click', (e) => {
        if (!isDragging) {
            const rect = track.getBoundingClientRect();
            const percentage = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const newValue = config.min + (percentage * (config.max - config.min));
            updateSlider(newValue);
        }
    });
    
    // Handle thumb drag
    thumb.addEventListener('mousedown', (e) => {
        isDragging = true;
        thumb.style.cursor = 'grabbing';
        thumb.style.transform = 'translateX(-50%) scale(1.2)';
        e.preventDefault();
    });
    
    // Global mouse events for dragging
    function handleMouseMove(e) {
        if (isDragging) {
            const rect = track.getBoundingClientRect();
            const percentage = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const newValue = config.min + (percentage * (config.max - config.min));
            updateSlider(newValue);
        }
    }
    
    function handleMouseUp() {
        if (isDragging) {
            isDragging = false;
            thumb.style.cursor = 'grab';
            thumb.style.transform = 'translateX(-50%) scale(1)';
            toastManager.show(`Slider value: ${currentValue}`, 'info');
        }
    }
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    // Keyboard controls
    sliderElement.addEventListener('keydown', (e) => {
        switch (e.key) {
            case 'ArrowLeft':
            case 'ArrowDown':
                e.preventDefault();
                updateSlider(currentValue - config.step);
                break;
            case 'ArrowRight':
            case 'ArrowUp':
                e.preventDefault();
                updateSlider(currentValue + config.step);
                break;
            case 'Home':
                e.preventDefault();
                updateSlider(config.min);
                break;
            case 'End':
                e.preventDefault();
                updateSlider(config.max);
                break;
        }
    });
    
    // Make slider focusable
    sliderElement.setAttribute('tabindex', '0');
    
    // Assemble components
    track.appendChild(fill);
    track.appendChild(thumb);
    sliderElement.appendChild(track);
    sliderElement.appendChild(valueDisplay);
    
    // Add to DOM
    document.body.appendChild(sliderElement);
    
    // Animate in
    requestAnimationFrame(() => {
        sliderElement.style.opacity = '1';
        sliderElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!sliderElement.contains(e.target)) {
                closeSlider();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeSlider();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeSlider() {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        
        sliderElement.style.opacity = '0';
        sliderElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (sliderElement.parentNode) {
                sliderElement.parentNode.removeChild(sliderElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} slider displayed`, 'info');
}

function createDemoRating(type, triggerButton, toastManager) {
    const ratingConfigs = {
        default: {
            max: 5,
            value: 3,
            variant: 'warning'
        },
        primary: {
            max: 5,
            value: 4,
            variant: 'primary'
        },
        hotel: {
            max: 5,
            value: 4,
            variant: 'warning',
            showValue: true
        }
    };
    
    const config = ratingConfigs[type] || ratingConfigs.default;
    
    // Create rating as a simple DOM element for demo
    const ratingElement = document.createElement('div');
    ratingElement.className = 'plauna-demo-rating';
    ratingElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 24px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 300px;'
    );
    
    // Create stars container
    const starsContainer = document.createElement('div');
    starsContainer.style.cssText = (
        'display: flex;' +
        'flex-direction: row;' +
        'gap: 4px;' +
        'align-items: center;' +
        'margin-bottom: 16px;'
    );
    
    // Rating interaction state
    let currentRating = config.value;
    let hoverRating = 0;
    
    // Create stars
    const stars = [];
    for (let i = 0; i < config.max; i++) {
        const star = document.createElement('button');
        star.type = 'button';
        star.setAttribute('aria-label', `Star ${i + 1}`);
        star.style.cssText = (
            'appearance: none;' +
            'width: 24px;' +
            'height: 24px;' +
            'background: transparent;' +
            'border: none;' +
            'cursor: pointer;' +
            'padding: 0;' +
            'margin: 0;' +
            'position: relative;' +
            'outline: none;' +
            'transition: all 150ms ease;'
        );
        
        // Create star SVG
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '24');
        svg.setAttribute('height', '24');
        svg.style.cssText = (
            'position: absolute;' +
            'top: 0;' +
            'left: 0;' +
            'transition: all 150ms ease;'
        );
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.75L7 14.14 2 9.27l6.91-1.01L12 2z');
        path.style.cssText = (
            'fill: transparent;' +
            'stroke: #64748b;' +
            'stroke-width: 2;' +
            'transition: all 150ms ease;'
        );
        
        svg.appendChild(path);
        star.appendChild(svg);
        
        // Store star reference
        stars.push({ element: star, path: path });
        
        // Add event listeners
        star.addEventListener('mouseenter', () => {
            hoverRating = i + 1;
            updateStars();
        });
        
        star.addEventListener('mouseleave', () => {
            hoverRating = 0;
            updateStars();
        });
        
        star.addEventListener('click', () => {
            currentRating = i + 1;
            updateStars();
            toastManager.show(`Rating: ${currentRating} star${currentRating !== 1 ? 's' : ''}`, 'success');
        });
        
        star.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                currentRating = i + 1;
                updateStars();
                toastManager.show(`Rating: ${currentRating} star${currentRating !== 1 ? 's' : ''}`, 'success');
            }
        });
        
        starsContainer.appendChild(star);
    }
    
    // Update stars visual state
    function updateStars() {
        const displayRating = hoverRating || currentRating;
        
        stars.forEach((star, index) => {
            const isActive = index < displayRating;
            const color = config.variant === 'warning' ? '#f59e0b' : config.variant === 'primary' ? '#3b82f6' : '#64748b';
            
            if (isActive) {
                star.path.style.fill = color;
                star.path.style.stroke = color;
            } else {
                star.path.style.fill = 'transparent';
                star.path.style.stroke = '#64748b';
            }
        });
        
        // Update value display
        if (valueDisplay) {
            valueDisplay.textContent = `${displayRating}/${config.max}`;
        }
    }
    
    // Create value display if enabled
    let valueDisplay = null;
    if (config.showValue) {
        valueDisplay = document.createElement('div');
        valueDisplay.textContent = `${currentRating}/${config.max}`;
        valueDisplay.style.cssText = (
            'text-align: center;' +
            'font-size: 16px;' +
            'font-weight: bold;' +
            'color: #e4e4e7;' +
            'background: rgba(255, 255, 255, 0.1);' +
            'padding: 4px 8px;' +
            'border-radius: 4px;' +
            'border: 1px solid rgba(255, 255, 255, 0.2);'
        );
    }
    
    // Keyboard navigation
    ratingElement.addEventListener('keydown', (e) => {
        switch (e.key) {
            case 'ArrowLeft':
            case 'ArrowDown':
                e.preventDefault();
                currentRating = Math.max(0, currentRating - 1);
                updateStars();
                break;
            case 'ArrowRight':
            case 'ArrowUp':
                e.preventDefault();
                currentRating = Math.min(config.max, currentRating + 1);
                updateStars();
                break;
            case 'Home':
                e.preventDefault();
                currentRating = 0;
                updateStars();
                break;
            case 'End':
                e.preventDefault();
                currentRating = config.max;
                updateStars();
                break;
        }
    });
    
    // Make rating focusable
    ratingElement.setAttribute('tabindex', '0');
    
    // Initialize stars
    updateStars();
    
    // Assemble components
    ratingElement.appendChild(starsContainer);
    if (valueDisplay) {
        ratingElement.appendChild(valueDisplay);
    }
    
    // Add to DOM
    document.body.appendChild(ratingElement);
    
    // Animate in
    requestAnimationFrame(() => {
        ratingElement.style.opacity = '1';
        ratingElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!ratingElement.contains(e.target)) {
                closeRating();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeRating();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeRating() {
        ratingElement.style.opacity = '0';
        ratingElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (ratingElement.parentNode) {
                ratingElement.parentNode.removeChild(ratingElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.max} star rating displayed`, 'info');
}

function createDemoTable(type, triggerButton, toastManager) {
    const tableConfigs = {
        default: {
            columns: [
                { key: 'id', label: 'ID', sortable: true },
                { key: 'name', label: 'Name', sortable: true },
                { key: 'email', label: 'Email', sortable: true },
                { key: 'status', label: 'Status', sortable: true }
            ],
            data: [
                { id: 1, name: 'John Doe', email: 'john@example.com', status: 'Active' },
                { id: 2, name: 'Jane Smith', email: 'jane@example.com', status: 'Inactive' },
                { id: 3, name: 'Bob Johnson', email: 'bob@example.com', status: 'Active' },
                { id: 4, name: 'Alice Brown', email: 'alice@example.com', status: 'Pending' },
                { id: 5, name: 'Charlie Wilson', email: 'charlie@example.com', status: 'Active' }
            ]
        },
        primary: {
            columns: [
                { key: 'product', label: 'Product', sortable: true },
                { key: 'price', label: 'Price', sortable: true },
                { key: 'stock', label: 'Stock', sortable: true }
            ],
            data: [
                { product: 'Laptop', price: '$999', stock: 15 },
                { product: 'Phone', price: '$699', stock: 23 },
                { product: 'Tablet', price: '$399', stock: 8 }
            ]
        },
        selectable: {
            columns: [
                { key: 'task', label: 'Task', sortable: true },
                { key: 'priority', label: 'Priority', sortable: true },
                { key: 'due', label: 'Due Date', sortable: true }
            ],
            data: [
                { task: 'Complete project', priority: 'High', due: '2024-01-15' },
                { task: 'Review code', priority: 'Medium', due: '2024-01-20' },
                { task: 'Update docs', priority: 'Low', due: '2024-01-25' }
            ],
            selectable: true
        }
    };
    
    const config = tableConfigs[type] || tableConfigs.default;
    
    // Create table as a simple DOM element for demo
    const tableElement = document.createElement('div');
    tableElement.className = 'plauna-demo-table';
    tableElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 24px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 600px;' +
        'max-width: 800px;' +
        'max-height: 500px;' +
        'overflow: auto;'
    );
    
    // Create table
    const table = document.createElement('table');
    table.style.cssText = (
        'width: 100%;' +
        'border-collapse: collapse;' +
        'font-size: 14px;'
    );
    
    // Create header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.style.cssText = (
        'background: rgba(59, 130, 246, 0.1);' +
        'border-bottom: 2px solid rgba(59, 130, 246, 0.3);'
    );
    
    config.columns.forEach(column => {
        const th = document.createElement('th');
        th.textContent = column.label;
        th.style.cssText = (
            'padding: 12px;' +
            'text-align: left;' +
            'font-weight: 600;' +
            'color: #3b82f6;' +
            'border-bottom: 1px solid rgba(99, 116, 141, 0.2);' +
            'cursor: ' + (column.sortable ? 'pointer' : 'default') + ';'
        );
        
        if (column.sortable) {
            th.addEventListener('click', () => {
                toastManager.show(`Sort by ${column.label}`, 'info');
            });
        }
        
        headerRow.appendChild(th);
    });
    
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // Create body
    const tbody = document.createElement('tbody');
    
    config.data.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.style.cssText = (
            'border-bottom: 1px solid rgba(99, 116, 141, 0.1);' +
            'transition: background 150ms ease;' +
            'cursor: ' + (config.selectable ? 'pointer' : 'default') + ';'
        );
        
        if (config.selectable) {
            tr.addEventListener('click', () => {
                tr.style.background = tr.style.background === 'rgba(59, 130, 246, 0.1)' ? 'transparent' : 'rgba(59, 130, 246, 0.1)';
                toastManager.show(`Row ${index + 1} selected`, 'info');
            });
            
            tr.addEventListener('mouseenter', () => {
                if (tr.style.background !== 'rgba(59, 130, 246, 0.1)') {
                    tr.style.background = 'rgba(255, 255, 255, 0.05)';
                }
            });
            
            tr.addEventListener('mouseleave', () => {
                if (tr.style.background !== 'rgba(59, 130, 246, 0.1)') {
                    tr.style.background = 'transparent';
                }
            });
        }
        
        config.columns.forEach(column => {
            const td = document.createElement('td');
            td.textContent = row[column.key];
            td.style.cssText = (
                'padding: 12px;' +
                'color: #e4e4e7;' +
                'border-bottom: 1px solid rgba(99, 116, 141, 0.1);'
            );
            tr.appendChild(td);
        });
        
        tbody.appendChild(tr);
    });
    
    table.appendChild(tbody);
    tableElement.appendChild(table);
    
    // Add to DOM
    document.body.appendChild(tableElement);
    
    // Animate in
    requestAnimationFrame(() => {
        tableElement.style.opacity = '1';
        tableElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!tableElement.contains(e.target)) {
                closeTable();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeTable();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeTable() {
        tableElement.style.opacity = '0';
        tableElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (tableElement.parentNode) {
                tableElement.parentNode.removeChild(tableElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} table displayed`, 'info');
}

function createDemoTree(type, triggerButton, toastManager) {
    const treeConfigs = {
        default: {
            data: [
                {
                    id: '1',
                    label: 'Documents',
                    icon: '📁',
                    children: [
                        { id: '1-1', label: 'Report.pdf', icon: '📄' },
                        { id: '1-2', label: 'Presentation.pptx', icon: '📊' }
                    ]
                },
                {
                    id: '2',
                    label: 'Projects',
                    icon: '📁',
                    children: [
                        {
                            id: '2-1',
                            label: 'Website',
                            icon: '📁',
                            children: [
                                { id: '2-1-1', label: 'index.html', icon: '🌐' },
                                { id: '2-1-2', label: 'styles.css', icon: '🎨' }
                            ]
                        },
                        { id: '2-2', label: 'Mobile App', icon: '📱' }
                    ]
                },
                { id: '3', label: 'README.md', icon: '📝' }
            ]
        },
        selectable: {
            data: [
                {
                    id: 'root',
                    label: 'Root Folder',
                    icon: '📁',
                    children: [
                        { id: 'item1', label: 'File 1', icon: '📄' },
                        { id: 'item2', label: 'File 2', icon: '📄' }
                    ]
                }
            ],
            selectable: true
        }
    };
    
    const config = treeConfigs[type] || treeConfigs.default;
    
    // Create tree as a simple DOM element for demo
    const treeElement = document.createElement('div');
    treeElement.className = 'plauna-demo-tree';
    treeElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 24px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 300px;' +
        'max-width: 400px;'
    );
    
    // Create tree container
    const treeContainer = document.createElement('div');
    treeContainer.style.cssText = (
        'font-size: 14px;' +
        'color: #e4e4e7;'
    );
    
    // Create tree nodes
    function createTreeNode(node, level = 0) {
        const hasChildren = node.children && node.children.length > 0;
        const nodeElement = document.createElement('div');
        nodeElement.style.cssText = (
            'margin-left: ' + (level * 20) + 'px;' +
            'padding: 4px 8px;' +
            'cursor: ' + (config.selectable ? 'pointer' : 'default') + ';' +
            'border-radius: 4px;' +
            'transition: background 150ms ease;'
        );
        
        // Add expand/collapse icon
        if (hasChildren) {
            const expandIcon = document.createElement('span');
            expandIcon.textContent = '▶';
            expandIcon.style.cssText = (
                'display: inline-block;' +
                'width: 12px;' +
                'font-size: 10px;' +
                'color: #94a3b8;' +
                'margin-right: 4px;' +
                'cursor: pointer;' +
                'transition: transform 150ms ease;'
            );
            
            let isExpanded = false;
            expandIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                isExpanded = !isExpanded;
                expandIcon.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
                childrenContainer.style.display = isExpanded ? 'block' : 'none';
            });
            
            nodeElement.appendChild(expandIcon);
        } else {
            const spacer = document.createElement('span');
            spacer.style.cssText = (
                'display: inline-block;' +
                'width: 16px;'
            );
            nodeElement.appendChild(spacer);
        }
        
        // Add node icon
        if (node.icon) {
            const icon = document.createElement('span');
            icon.textContent = node.icon;
            icon.style.cssText = (
                'margin-right: 8px;' +
                'font-size: 14px;'
            );
            nodeElement.appendChild(icon);
        }
        
        // Add node label
        const label = document.createElement('span');
        label.textContent = node.label;
        label.style.cssText = (
            'color: inherit;' +
            'font-weight: 500;'
        );
        nodeElement.appendChild(label);
        
        // Add hover effect
        nodeElement.addEventListener('mouseenter', () => {
            nodeElement.style.background = 'rgba(255, 255, 255, 0.05)';
        });
        
        nodeElement.addEventListener('mouseleave', () => {
            nodeElement.style.background = 'transparent';
        });
        
        // Add click handler for selectable trees
        if (config.selectable) {
            nodeElement.addEventListener('click', () => {
                toastManager.show(`Selected: ${node.label}`, 'info');
            });
        }
        
        // Add children container
        let childrenContainer = null;
        if (hasChildren) {
            childrenContainer = document.createElement('div');
            childrenContainer.style.display = 'none';
            
            node.children.forEach(child => {
                const childElement = createTreeNode(child, level + 1);
                childrenContainer.appendChild(childElement);
            });
        }
        
        const container = document.createElement('div');
        container.appendChild(nodeElement);
        if (childrenContainer) {
            container.appendChild(childrenContainer);
        }
        
        return container;
    }
    
    // Create tree root
    config.data.forEach(node => {
        const treeNode = createTreeNode(node);
        treeContainer.appendChild(treeNode);
    });
    
    treeElement.appendChild(treeContainer);
    
    // Add to DOM
    document.body.appendChild(treeElement);
    
    // Animate in
    requestAnimationFrame(() => {
        treeElement.style.opacity = '1';
        treeElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!treeElement.contains(e.target)) {
                closeTree();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeTree();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeTree() {
        treeElement.style.opacity = '0';
        treeElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (treeElement.parentNode) {
                treeElement.parentNode.removeChild(treeElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} tree displayed`, 'info');
}

function createDemoList(type, triggerButton, toastManager) {
    const listConfigs = {
        default: {
            items: [
                { label: 'First item', badge: 'New' },
                { label: 'Second item', icon: '📌' },
                { label: 'Third item', action: { label: 'View' } },
                { label: 'Fourth item', badge: '5' },
                { label: 'Fifth item', icon: '⭐', badge: 'Popular' }
            ]
        },
        ordered: {
            items: [
                { label: 'Step 1: Setup project' },
                { label: 'Step 2: Install dependencies' },
                { label: 'Step 3: Run tests' },
                { label: 'Step 4: Deploy application' }
            ],
            ordered: true
        },
        horizontal: {
            items: [
                { label: 'React', icon: '⚛️' },
                { label: 'Vue', icon: '💚' },
                { label: 'Angular', icon: '🅰️' },
                { label: 'Svelte', icon: '🔥' }
            ],
            horizontal: true
        }
    };
    
    const config = listConfigs[type] || listConfigs.default;
    
    // Create list as a simple DOM element for demo
    const listElement = document.createElement('div');
    listElement.className = 'plauna-demo-list';
    listElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 24px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 300px;' +
        'max-width: 400px;'
    );
    
    // Create list container
    const listContainer = document.createElement('div');
    listContainer.style.cssText = (
        'display: ' + (config.horizontal ? 'flex' : 'block') + ';' +
        'gap: 8px;' +
        'flex-wrap: ' + (config.horizontal ? 'wrap' : 'nowrap') + ';'
    );
    
    // Create list items
    config.items.forEach((item, index) => {
        const listItem = document.createElement('div');
        listItem.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: 8px;' +
            'padding: 8px 12px;' +
            'background: rgba(255, 255, 255, 0.05);' +
            'border: 1px solid rgba(99, 116, 141, 0.2);' +
            'border-radius: 8px;' +
            'color: #e4e4e7;' +
            'font-size: 14px;' +
            'cursor: pointer;' +
            'transition: all 150ms ease;'
        );
        
        // Add list number if ordered
        if (config.ordered) {
            const number = document.createElement('span');
            number.textContent = (index + 1) + '.';
            number.style.cssText = (
                'font-weight: bold;' +
                'color: #3b82f6;' +
                'margin-right: 4px;'
            );
            listItem.appendChild(number);
        }
        
        // Add icon if present
        if (item.icon) {
            const icon = document.createElement('span');
            icon.textContent = item.icon;
            icon.style.cssText = (
                'font-size: 16px;'
            );
            listItem.appendChild(icon);
        }
        
        // Add label
        const label = document.createElement('span');
        label.textContent = item.label;
        label.style.cssText = (
            'flex: 1;' +
            'color: inherit;'
        );
        listItem.appendChild(label);
        
        // Add badge if present
        if (item.badge) {
            const badge = document.createElement('span');
            badge.textContent = item.badge;
            badge.style.cssText = (
                'background: #3b82f6;' +
                'color: white;' +
                'font-size: 10px;' +
                'font-weight: bold;' +
                'padding: 2px 6px;' +
                'border-radius: 4px;' +
                'margin-left: 8px;'
            );
            listItem.appendChild(badge);
        }
        
        // Add action if present
        if (item.action) {
            const actionButton = document.createElement('button');
            actionButton.textContent = item.action.label;
            actionButton.style.cssText = (
                'background: transparent;' +
                'color: #3b82f6;' +
                'border: 1px solid #3b82f6;' +
                'border-radius: 4px;' +
                'padding: 2px 6px;' +
                'font-size: 10px;' +
                'cursor: pointer;' +
                'margin-left: 8px;'
            );
            
            actionButton.addEventListener('click', (e) => {
                e.stopPropagation();
                toastManager.show(`Action: ${item.action.label}`, 'info');
            });
            
            listItem.appendChild(actionButton);
        }
        
        // Add hover effect
        listItem.addEventListener('mouseenter', () => {
            listItem.style.background = 'rgba(255, 255, 255, 0.1)';
            listItem.style.transform = 'translateY(-1px)';
        });
        
        listItem.addEventListener('mouseleave', () => {
            listItem.style.background = 'rgba(255, 255, 255, 0.05)';
            listItem.style.transform = 'translateY(0)';
        });
        
        // Add click handler
        listItem.addEventListener('click', () => {
            toastManager.show(`Selected: ${item.label}`, 'info');
        });
        
        listContainer.appendChild(listItem);
    });
    
    listElement.appendChild(listContainer);
    
    // Add to DOM
    document.body.appendChild(listElement);
    
    // Animate in
    requestAnimationFrame(() => {
        listElement.style.opacity = '1';
        listElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!listElement.contains(e.target)) {
                closeList();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeList();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeList() {
        listElement.style.opacity = '0';
        listElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (listElement.parentNode) {
                listElement.parentNode.removeChild(listElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} list displayed`, 'info');
}

function createDemoChip(type, triggerButton, toastManager) {
    const chipConfigs = {
        default: {
            chips: [
                { label: 'React', variant: 'primary' },
                { label: 'JavaScript', variant: 'secondary' },
                { label: 'CSS', variant: 'success' },
                { label: 'HTML', variant: 'warning' },
                { label: 'TypeScript', variant: 'error' }
            ]
        },
        removable: {
            chips: [
                { label: 'Tag 1', removable: true },
                { label: 'Tag 2', removable: true },
                { label: 'Tag 3', removable: true },
                { label: 'Tag 4', removable: true }
            ]
        },
        avatar: {
            chips: [
                { label: 'John Doe', avatar: { src: 'https://picsum.photos/seed/john/24/24', alt: 'John' } },
                { label: 'Jane Smith', avatar: { src: 'https://picsum.photos/seed/jane/24/24', alt: 'Jane' } },
                { label: 'Bob Johnson', avatar: { src: 'https://picsum.photos/seed/bob/24/24', alt: 'Bob' } }
            ]
        }
    };
    
    const config = chipConfigs[type] || chipConfigs.default;
    
    // Create chip container using theme-based styling
    const chipStyles = widgetStyleManager.getWidgetStyles('chip');
    const chipElement = widgetStyleManager.createStyledElement('div', chipStyles.container, 'plauna-demo-chip');
    
    // Create chips container
    const chipsContainer = widgetStyleManager.createStyledElement('div', chipStyles.chipsContainer);
    
    // Create chips
    config.chips.forEach((chip, index) => {
        const chipItem = widgetStyleManager.createStyledElement('div', chipStyles.chip);
        
        // Add avatar if present
        if (chip.avatar) {
            const avatar = widgetStyleManager.createStyledElement('img', chipStyles.avatar);
            avatar.src = chip.avatar.src;
            avatar.alt = chip.avatar.alt;
            chipItem.appendChild(avatar);
        }
        
        // Add label
        const label = widgetStyleManager.createStyledElement('span', chipStyles.label);
        label.textContent = chip.label;
        chipItem.appendChild(label);
        
        // Add remove button if removable
        if (chip.removable) {
            const removeButton = widgetStyleManager.createStyledElement('button', chipStyles.removeButton);
            removeButton.textContent = '×';
            
            removeButton.addEventListener('mouseenter', () => {
                widgetStyleManager.applyStyles(removeButton, chipStyles.removeButtonHover);
            });
            
            removeButton.addEventListener('mouseleave', () => {
                widgetStyleManager.applyStyles(removeButton, { opacity: '0.7' });
            });
            
            removeButton.addEventListener('click', (e) => {
                e.stopPropagation();
                widgetStyleManager.applyStyles(chipItem, { opacity: '0', transform: 'scale(0.8)' });
                setTimeout(() => {
                    chipItem.remove();
                    toastManager.show(`Removed: ${chip.label}`, 'info');
                }, 150);
            });
            
            chipItem.appendChild(removeButton);
        }
        
        // Add hover effect
        chipItem.addEventListener('mouseenter', () => {
            widgetStyleManager.applyStyles(chipItem, chipStyles.chipHover);
        });
        
        chipItem.addEventListener('mouseleave', () => {
            widgetStyleManager.applyStyles(chipItem, { transform: 'translateY(0)', boxShadow: 'none' });
        });
        
        // Add click handler
        chipItem.addEventListener('click', () => {
            toastManager.show(`Clicked: ${chip.label}`, 'info');
        });
        
        chipsContainer.appendChild(chipItem);
    });
    
    chipElement.appendChild(chipsContainer);
    
    // Helper functions for chip colors
    function getChipBackgroundColor(variant) {
        const colors = {
            default: 'rgba(255, 255, 255, 0.1)',
            primary: 'rgba(59, 130, 246, 0.1)',
            secondary: 'rgba(107, 114, 128, 0.1)',
            success: 'rgba(34, 197, 94, 0.1)',
            warning: 'rgba(245, 158, 11, 0.1)',
            error: 'rgba(239, 68, 68, 0.1)'
        };
        return colors[variant] || colors.default;
    }
    
    function getChipTextColor(variant) {
        const colors = {
            default: '#e4e4e7',
            primary: '#3b82f6',
            secondary: '#6b7280',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444'
        };
        return colors[variant] || colors.default;
    }
    
    function getChipBorderColor(variant) {
        const colors = {
            default: 'rgba(255, 255, 255, 0.2)',
            primary: 'rgba(59, 130, 246, 0.3)',
            secondary: 'rgba(107, 114, 128, 0.3)',
            success: 'rgba(34, 197, 94, 0.3)',
            warning: 'rgba(245, 158, 11, 0.3)',
            error: 'rgba(239, 68, 68, 0.3)'
        };
        return colors[variant] || colors.default;
    }
    
    // Add to DOM
    document.body.appendChild(chipElement);
    
    // Animate in
    requestAnimationFrame(() => {
        widgetStyleManager.applyStyles(chipElement, chipStyles.visible);
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!chipElement.contains(e.target)) {
                closeChip();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeChip();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeChip() {
        widgetStyleManager.applyStyles(chipElement, chipStyles.hidden);
        setTimeout(() => {
            if (chipElement.parentNode) {
                chipElement.parentNode.removeChild(chipElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} chips displayed`, 'info');
}

function createDemoAlert(type, triggerButton, toastManager) {
    const alertConfigs = {
        default: {
            title: 'Success!',
            message: 'Your changes have been saved successfully.',
            variant: 'success',
            dismissible: true
        },
        warning: {
            title: 'Warning',
            message: 'This action cannot be undone. Please proceed with caution.',
            variant: 'warning',
            dismissible: true
        },
        error: {
            title: 'Error',
            message: 'Something went wrong. Please try again later.',
            variant: 'error',
            dismissible: true
        },
        info: {
            title: 'Information',
            message: 'Here is some important information you should know.',
            variant: 'info',
            dismissible: true
        },
        action: {
            title: 'Action Required',
            message: 'Please review and accept the terms to continue.',
            variant: 'primary',
            dismissible: false,
            action: {
                label: 'Review Terms',
                onClick: () => {
                    toastManager.show('Review terms clicked', 'info');
                }
            }
        }
    };
    
    const config = alertConfigs[type] || alertConfigs.default;
    
    // Create alert using theme-based styling
    const alertStyles = widgetStyleManager.getWidgetStyles('alert');
    const alertElement = widgetStyleManager.createStyledElement('div', alertStyles.container, 'plauna-demo-alert');
    
    // Create alert content
    const alertContent = widgetStyleManager.createStyledElement('div', alertStyles.content);
    
    // Create title
    const title = widgetStyleManager.createStyledElement('div', alertStyles.title);
    title.textContent = config.title;
    alertContent.appendChild(title);
    
    // Create message
    const message = widgetStyleManager.createStyledElement('div', alertStyles.message);
    message.textContent = config.message;
    alertContent.appendChild(message);
    
    // Create action button if present
    if (config.action) {
        const actionButton = widgetStyleManager.createStyledElement('button', alertStyles.actionButton);
        actionButton.textContent = config.action.label;
        
        actionButton.addEventListener('click', () => {
            if (config.action.onClick) {
                config.action.onClick();
            }
        });
        
        alertContent.appendChild(actionButton);
    }
    
    // Create dismiss button if dismissible
    if (config.dismissible) {
        const dismissButton = widgetStyleManager.createStyledElement('button', alertStyles.dismissButton);
        dismissButton.textContent = '×';
        
        dismissButton.addEventListener('mouseenter', () => {
            widgetStyleManager.applyStyles(dismissButton, alertStyles.dismissButtonHover);
        });
        
        dismissButton.addEventListener('mouseleave', () => {
            widgetStyleManager.applyStyles(dismissButton, { opacity: '0.7' });
        });
        
        dismissButton.addEventListener('click', () => {
            closeAlert();
        });
        
        alertElement.appendChild(dismissButton);
    }
    
    alertElement.appendChild(alertContent);
    
    // Helper functions for alert colors
    function getAlertBackgroundColor(variant) {
        const colors = {
            default: 'rgba(255, 255, 255, 0.1)',
            success: 'rgba(34, 197, 94, 0.1)',
            warning: 'rgba(245, 158, 11, 0.1)',
            error: 'rgba(239, 68, 68, 0.1)',
            info: 'rgba(59, 130, 246, 0.1)',
            primary: 'rgba(59, 130, 246, 0.1)'
        };
        return colors[variant] || colors.default;
    }
    
    function getAlertTextColor(variant) {
        const colors = {
            default: '#e4e4e7',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6',
            primary: '#3b82f6'
        };
        return colors[variant] || colors.default;
    }
    
    function getAlertBorderColor(variant) {
        const colors = {
            default: 'rgba(255, 255, 255, 0.2)',
            success: 'rgba(34, 197, 94, 0.3)',
            warning: 'rgba(245, 158, 11, 0.3)',
            error: 'rgba(239, 68, 68, 0.3)',
            info: 'rgba(59, 130, 246, 0.3)',
            primary: 'rgba(59, 130, 246, 0.3)'
        };
        return colors[variant] || colors.default;
    }
    
    // Add to DOM
    document.body.appendChild(alertElement);
    
    // Animate in
    requestAnimationFrame(() => {
        widgetStyleManager.applyStyles(alertElement, alertStyles.visible);
    });
    
    // Auto-dismiss after 5 seconds if dismissible
    if (config.dismissible) {
        setTimeout(() => {
            closeAlert();
        }, 5000);
    }
    
    function closeAlert() {
        widgetStyleManager.applyStyles(alertElement, alertStyles.hidden);
        setTimeout(() => {
            if (alertElement.parentNode) {
                alertElement.parentNode.removeChild(alertElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} alert displayed`, 'info');
}

function createDemoToast(type, triggerButton, toastManager) {
    const toastConfigs = {
        default: {
            message: 'This is a toast notification',
            variant: 'default',
            position: 'top-right',
            duration: 3000
        },
        success: {
            message: 'Operation completed successfully!',
            variant: 'success',
            position: 'top-right',
            duration: 3000
        },
        error: {
            message: 'An error occurred',
            variant: 'error',
            position: 'top-right',
            duration: 5000
        },
        action: {
            message: 'New message received',
            variant: 'primary',
            position: 'bottom-right',
            duration: 0, // No auto-dismiss
            action: {
                label: 'View',
                onClick: () => {
                    toastManager.show('View message clicked', 'info');
                }
            }
        }
    };
    
    const config = toastConfigs[type] || toastConfigs.default;
    
    // Create toast using theme-based styling
    const toastStyles = widgetStyleManager.getWidgetStyles('toast');
    const toastElement = widgetStyleManager.createStyledElement('div', toastStyles.container, 'plauna-demo-toast');
    
    // Set position
    const positions = {
        'top-right': toastStyles.positions.topRight,
        'top-left': toastStyles.positions.topLeft,
        'bottom-right': toastStyles.positions.bottomRight,
        'bottom-left': toastStyles.positions.bottomLeft
    };
    const positionStyles = positions[config.position] || positions['top-right'];
    widgetStyleManager.applyStyles(toastElement, positionStyles);
    
    // Create icon
    const icon = widgetStyleManager.createStyledElement('span', toastStyles.icon);
    icon.textContent = getToastIcon(config.variant);
    toastElement.appendChild(icon);
    
    // Create message
    const message = widgetStyleManager.createStyledElement('span', toastStyles.message);
    message.textContent = config.message;
    toastElement.appendChild(message);
    
    // Create action button if present
    if (config.action) {
        const actionButton = widgetStyleManager.createStyledElement('button', toastStyles.actionButton);
        actionButton.textContent = config.action.label;
        
        actionButton.addEventListener('click', () => {
            if (config.action.onClick) {
                config.action.onClick();
            }
        });
        
        toastElement.appendChild(actionButton);
    }
    
    // Create dismiss button
    const dismissButton = widgetStyleManager.createStyledElement('button', toastStyles.dismissButton);
    dismissButton.textContent = '×';
    
    dismissButton.addEventListener('mouseenter', () => {
        widgetStyleManager.applyStyles(dismissButton, toastStyles.dismissButtonHover);
    });
    
    dismissButton.addEventListener('mouseleave', () => {
        widgetStyleManager.applyStyles(dismissButton, { opacity: '0.7' });
    });
    
    dismissButton.addEventListener('click', () => {
        closeToast();
    });
    
    toastElement.appendChild(dismissButton);
    
    // Helper functions for toast colors
    function getToastBackgroundColor(variant) {
        const colors = {
            default: 'rgba(15, 23, 42, 0.95)',
            success: 'rgba(34, 197, 94, 0.95)',
            warning: 'rgba(245, 158, 11, 0.95)',
            error: 'rgba(239, 68, 68, 0.95)',
            info: 'rgba(59, 130, 246, 0.95)',
            primary: 'rgba(59, 130, 246, 0.95)'
        };
        return colors[variant] || colors.default;
    }
    
    function getToastTextColor(variant) {
        const colors = {
            default: '#e4e4e7',
            success: 'white',
            warning: 'white',
            error: 'white',
            info: 'white',
            primary: 'white'
        };
        return colors[variant] || colors.default;
    }
    
    function getToastBorderColor(variant) {
        const colors = {
            default: 'rgba(99, 116, 141, 0.3)',
            success: 'rgba(34, 197, 94, 0.3)',
            warning: 'rgba(245, 158, 11, 0.3)',
            error: 'rgba(239, 68, 68, 0.3)',
            info: 'rgba(59, 130, 246, 0.3)',
            primary: 'rgba(59, 130, 246, 0.3)'
        };
        return colors[variant] || colors.default;
    }
    
    function getToastIcon(variant) {
        const icons = {
            default: 'ℹ️',
            success: '✅',
            warning: '⚠️',
            error: '❌',
            info: 'ℹ️',
            primary: 'ℹ️'
        };
        return icons[variant] || icons.default;
    }
    
    // Add to DOM
    document.body.appendChild(toastElement);
    
    // Animate in
    requestAnimationFrame(() => {
        widgetStyleManager.applyStyles(toastElement, toastStyles.visible);
    });
    
    // Auto-dismiss if duration is set
    if (config.duration > 0) {
        setTimeout(() => {
            closeToast();
        }, config.duration);
    }
    
    function closeToast() {
        widgetStyleManager.applyStyles(toastElement, toastStyles.hidden);
        setTimeout(() => {
            if (toastElement.parentNode) {
                toastElement.parentNode.removeChild(toastElement);
            }
        }, 300);
    }
    
    toastManager.show(`${type} toast displayed`, 'info');
}

function createDemoSpinner(type, triggerButton, toastManager) {
    const spinnerConfigs = {
        default: {
            type: 'default',
            size: 'md',
            variant: 'default',
            label: 'Loading...'
        },
        dots: {
            type: 'dots',
            size: 'lg',
            variant: 'primary',
            label: 'Processing...'
        },
        pulse: {
            type: 'pulse',
            size: 'xl',
            variant: 'success',
            label: 'Success!'
        },
        bars: {
            type: 'bars',
            size: 'md',
            variant: 'warning',
            label: 'Analyzing...'
        }
    };
    
    const config = spinnerConfigs[type] || spinnerConfigs.default;
    
    // Create spinner using theme-based styling
    const spinnerStyles = widgetStyleManager.getWidgetStyles('spinner');
    const spinnerElement = widgetStyleManager.createStyledElement('div', spinnerStyles.container, 'plauna-demo-spinner');
    
    // Create spinner animation
    const spinnerContainer = widgetStyleManager.createStyledElement('div', spinnerStyles.spinnerContainer);
    
    // Create spinner based on type
    switch (config.type) {
        case 'dots':
            createDotsSpinner(spinnerContainer);
            break;
        case 'pulse':
            createPulseSpinner(spinnerContainer);
            break;
        case 'bars':
            createBarsSpinner(spinnerContainer);
            break;
        default:
            createDefaultSpinner(spinnerContainer);
            break;
    }
    
    function createDefaultSpinner(container) {
        const spinner = widgetStyleManager.createStyledElement('div', spinnerStyles.spinner);
        widgetStyleManager.applyStyles(spinner, {
            borderTopColor: getSpinnerColor(config.variant)
        });
        container.appendChild(spinner);
    }
    
    function createDotsSpinner(container) {
        const dotsContainer = widgetStyleManager.createStyledElement('div', spinnerStyles.dotsContainer);
        
        for (let i = 0; i < 3; i++) {
            const dot = widgetStyleManager.createStyledElement('div', spinnerStyles.dot);
            widgetStyleManager.applyStyles(dot, {
                background: getSpinnerColor(config.variant),
                animationDelay: `${i * 0.16}s`
            });
            dotsContainer.appendChild(dot);
        }
        
        container.appendChild(dotsContainer);
    }
    
    function createPulseSpinner(container) {
        const pulse = widgetStyleManager.createStyledElement('div', spinnerStyles.pulse);
        widgetStyleManager.applyStyles(pulse, {
            background: getSpinnerColor(config.variant)
        });
        container.appendChild(pulse);
    }
    
    function createBarsSpinner(container) {
        const barsContainer = widgetStyleManager.createStyledElement('div', spinnerStyles.barsContainer);
        
        for (let i = 0; i < 4; i++) {
            const bar = widgetStyleManager.createStyledElement('div', spinnerStyles.bar);
            widgetStyleManager.applyStyles(bar, {
                background: getSpinnerColor(config.variant),
                animationDelay: `${i * 0.1}s`
            });
            barsContainer.appendChild(bar);
        }
        
        container.appendChild(barsContainer);
    }
    
    function getSpinnerColor(variant) {
        const colors = {
            default: '#e4e4e7',
            primary: '#3b82f6',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6'
        };
        return colors[variant] || colors.default;
    }
    
    // Add CSS animations if not already added
    if (!document.querySelector('#plauna-spinner-animations')) {
        const style = document.createElement('style');
        style.id = 'plauna-spinner-animations';
        style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            @keyframes dot-bounce {
                0%, 80%, 100% { transform: scale(0); }
                40% { transform: scale(1); }
            }
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
            @keyframes bar-stretch {
                0%, 40%, 100% { transform: scaleY(0.4); }
                20% { transform: scaleY(1); }
            }
        `;
        document.head.appendChild(style);
    }
    
    spinnerElement.appendChild(spinnerContainer);
    
    // Add label
    const label = widgetStyleManager.createStyledElement('div', spinnerStyles.label);
    label.textContent = config.label;
    spinnerElement.appendChild(label);
    
    // Add to DOM
    document.body.appendChild(spinnerElement);
    
    // Animate in
    requestAnimationFrame(() => {
        widgetStyleManager.applyStyles(spinnerElement, {
            opacity: '1',
            transform: 'translate(-50%, -50%) scale(1)'
        });
    });
    
    // Auto-dismiss after 3 seconds
    setTimeout(() => {
        widgetStyleManager.applyStyles(spinnerElement, {
            opacity: '0',
            transform: 'translate(-50%, -50%) scale(0.9)'
        });
        setTimeout(() => {
            if (spinnerElement.parentNode) {
                spinnerElement.parentNode.removeChild(spinnerElement);
            }
        }, 200);
    }, 3000);
    
    toastManager.show(`${type} spinner displayed`, 'info');
}

function createDemoStatus(type, triggerButton, toastManager) {
    const statusConfigs = {
        default: {
            status: 'online',
            label: 'John Doe',
            description: 'Active now',
            showIcon: true,
            dot: true,
            pulse: true
        },
        offline: {
            status: 'offline',
            label: 'Jane Smith',
            description: 'Last seen 2 hours ago',
            showIcon: true,
            dot: true,
            pulse: false
        },
        busy: {
            status: 'busy',
            label: 'Bob Johnson',
            description: 'In a meeting',
            showIcon: true,
            dot: true,
            pulse: true
        },
        processing: {
            status: 'processing',
            label: 'System Status',
            description: 'Updating...',
            showIcon: true,
            dot: true,
            pulse: true
        }
    };
    
    const config = statusConfigs[type] || statusConfigs.default;
    
    // Create status as a simple DOM element for demo
    const statusElement = document.createElement('div');
    statusElement.className = 'plauna-demo-status';
    statusElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 24px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 300px;' +
        'max-width: 400px;'
    );
    
    // Create status container
    const statusContainer = document.createElement('div');
    statusContainer.style.cssText = (
        'display: flex;' +
        'flex-direction: column;' +
        'gap: 12px;'
    );
    
    // Create status item
    const statusItem = document.createElement('div');
    statusItem.style.cssText = (
        'display: flex;' +
        'align-items: center;' +
        'gap: 12px;' +
        'padding: 16px;' +
        'background: rgba(255, 255, 255, 0.05);' +
        'border-radius: 8px;' +
        'border: 1px solid rgba(99, 116, 141, 0.2);'
    );
    
    // Create status dot
    if (config.dot) {
        const dot = document.createElement('div');
        dot.style.cssText = (
            'width: 8px;' +
            'height: 8px;' +
            'background: ' + getStatusColor(config.status) + ';' +
            'border-radius: 50%;' +
            'flex-shrink: 0;'
        );
        
        if (config.pulse) {
            dot.style.animation = 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite';
        }
        
        statusItem.appendChild(dot);
    }
    
    // Create status icon
    if (config.showIcon) {
        const icon = document.createElement('span');
        icon.textContent = getStatusIcon(config.status);
        icon.style.cssText = (
            'font-size: 16px;' +
            'color: ' + getStatusColor(config.status) + ';' +
            'flex-shrink: 0;'
        );
        statusItem.appendChild(icon);
    }
    
    // Create text content
    const textContent = document.createElement('div');
    textContent.style.cssText = (
        'display: flex;' +
        'flex-direction: column;' +
        'gap: 4px;'
    );
    
    // Create label
    const label = document.createElement('div');
    label.textContent = config.label;
    label.style.cssText = (
        'font-size: 14px;' +
        'font-weight: 600;' +
        'color: #e4e4e7;'
    );
    textContent.appendChild(label);
    
    // Create description
    const description = document.createElement('div');
    description.textContent = config.description;
    description.style.cssText = (
        'font-size: 12px;' +
        'color: #94a3b8;' +
        'opacity: 0.8;'
    );
    textContent.appendChild(description);
    
    statusItem.appendChild(textContent);
    statusContainer.appendChild(statusItem);
    
    // Add multiple status examples
    const statusTypes = ['online', 'offline', 'busy', 'away', 'success', 'warning', 'error', 'info'];
    statusTypes.forEach(statusType => {
        const exampleStatus = document.createElement('div');
        exampleStatus.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: 8px;' +
            'padding: 8px 12px;' +
            'background: rgba(255, 255, 255, 0.05);' +
            'border-radius: 6px;' +
            'border: 1px solid rgba(99, 116, 141, 0.2);' +
            'cursor: pointer;' +
            'transition: all 150ms ease;'
        );
        
        exampleStatus.addEventListener('mouseenter', () => {
            exampleStatus.style.background = 'rgba(255, 255, 255, 0.1)';
        });
        
        exampleStatus.addEventListener('mouseleave', () => {
            exampleStatus.style.background = 'rgba(255, 255, 255, 0.05)';
        });
        
        exampleStatus.addEventListener('click', () => {
            toastManager.show(`${statusType} status clicked`, 'info');
        });
        
        // Add dot
        const exampleDot = document.createElement('div');
        exampleDot.style.cssText = (
            'width: 6px;' +
            'height: 6px;' +
            'background: ' + getStatusColor(statusType) + ';' +
            'border-radius: 50%;' +
            'flex-shrink: 0;'
        );
        exampleStatus.appendChild(exampleDot);
        
        // Add label
        const exampleLabel = document.createElement('span');
        exampleLabel.textContent = statusType.charAt(0).toUpperCase() + statusType.slice(1);
        exampleLabel.style.cssText = (
            'font-size: 12px;' +
            'color: #e4e4e7;' +
            'font-weight: 500;'
        );
        exampleStatus.appendChild(exampleLabel);
        
        statusContainer.appendChild(exampleStatus);
    });
    
    statusElement.appendChild(statusContainer);
    
    // Helper functions
    function getStatusColor(status) {
        const colors = {
            default: '#94a3b8',
            online: '#22c55e',
            offline: '#64748b',
            busy: '#f59e0b',
            away: '#3b82f6',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6',
            processing: '#3b82f6'
        };
        return colors[status] || colors.default;
    }
    
    function getStatusIcon(status) {
        const icons = {
            default: '⚪',
            online: '🟢',
            offline: '⚫',
            busy: '⏳',
            away: '🚶',
            success: '✅',
            warning: '⚠️',
            error: '❌',
            info: 'ℹ️',
            processing: '⚙️'
        };
        return icons[status] || icons.default;
    }
    
    // Add CSS animations if not already added
    if (!document.querySelector('#plauna-pulse-animation')) {
        const style = document.createElement('style');
        style.id = 'plauna-pulse-animation';
        style.textContent = `
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Add to DOM
    document.body.appendChild(statusElement);
    
    // Animate in
    requestAnimationFrame(() => {
        statusElement.style.opacity = '1';
        statusElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!statusElement.contains(e.target)) {
                closeStatus();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeStatus();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeStatus() {
        statusElement.style.opacity = '0';
        statusElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (statusElement.parentNode) {
                statusElement.parentNode.removeChild(statusElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} status displayed`, 'info');
}

function createDemoEmptyState(type, triggerButton, toastManager) {
    const emptyStateConfigs = {
        default: {
            title: 'No Data',
            description: 'There is no data to display at the moment.',
            icon: '📭',
            variant: 'default'
        },
        search: {
            title: 'No Results',
            description: 'No results found for your search.',
            icon: '🔍',
            variant: 'info',
            action: {
                label: 'Clear Filters',
                onClick: () => {
                    toastManager.show('Filters cleared', 'info');
                }
            }
        },
        upload: {
            title: 'No Files Yet',
            description: 'Drag and drop files here or click to upload.',
            icon: '📁',
            variant: 'primary',
            action: {
                label: 'Browse Files',
                onClick: () => {
                    toastManager.show('File browser opened', 'info');
                }
            }
        },
        cart: {
            title: 'Cart is Empty',
            description: 'Add items to your cart to get started.',
            icon: '🛒',
            variant: 'success',
            action: {
                label: 'Start Shopping',
                onClick: () => {
                    toastManager.show('Shopping started', 'info');
                }
            }
        }
    };
    
    const config = emptyStateConfigs[type] || emptyStateConfigs.default;
    
    // Create empty state as a simple DOM element for demo
    const emptyStateElement = document.createElement('div');
    emptyStateElement.className = 'plauna-demo-emptystate';
    emptyStateElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 32px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 400px;' +
        'max-width: 500px;'
    );
    
    // Create empty state container
    const emptyStateContainer = document.createElement('div');
    emptyStateContainer.style.cssText = (
        'display: flex;' +
        'flex-direction: column;' +
        'align-items: center;' +
        'gap: 16px;' +
        'text-align: center;'
    );
    
    // Create icon
    const icon = document.createElement('div');
    icon.textContent = config.icon;
    icon.style.cssText = (
        'font-size: 64px;' +
        'opacity: 0.7;' +
        'margin-bottom: 8px;' +
        'color: ' + getEmptyStateColor(config.variant) + ';'
    );
    emptyStateContainer.appendChild(icon);
    
    // Create title
    const title = document.createElement('div');
    title.textContent = config.title;
    title.style.cssText = (
        'font-size: 20px;' +
        'font-weight: 600;' +
        'color: ' + getEmptyStateColor(config.variant) + ';' +
        'margin-bottom: 8px;'
    );
    emptyStateContainer.appendChild(title);
    
    // Create description
    const description = document.createElement('div');
    description.textContent = config.description;
    description.style.cssText = (
        'font-size: 14px;' +
        'color: #94a3b8;' +
        'line-height: 1.4;' +
        'opacity: 0.8;' +
        'margin-bottom: 24px;'
    );
    emptyStateContainer.appendChild(description);
    
    // Create action button if present
    if (config.action) {
        const actionButton = document.createElement('button');
        actionButton.textContent = config.action.label;
        actionButton.style.cssText = (
            'background: ' + getEmptyStateBackgroundColor(config.variant) + ';' +
            'color: ' + getEmptyStateTextColor(config.variant) + ';' +
            'border: 1px solid ' + getEmptyStateBorderColor(config.variant) + ';' +
            'border-radius: 8px;' +
            'padding: 12px 24px;' +
            'font-size: 14px;' +
            'font-weight: 500;' +
            'cursor: pointer;' +
            'transition: all 150ms ease;' +
            'text-decoration: none;'
        );
        
        actionButton.addEventListener('mouseenter', () => {
            actionButton.style.transform = 'translateY(-1px)';
            actionButton.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
        });
        
        actionButton.addEventListener('mouseleave', () => {
            actionButton.style.transform = 'translateY(0)';
            actionButton.style.boxShadow = 'none';
        });
        
        actionButton.addEventListener('click', () => {
            if (config.action.onClick) {
                config.action.onClick();
            }
        });
        
        emptyStateContainer.appendChild(actionButton);
    }
    
    emptyStateElement.appendChild(emptyStateContainer);
    
    // Helper functions
    function getEmptyStateColor(variant) {
        const colors = {
            default: '#94a3b8',
            primary: '#3b82f6',
            secondary: '#6b7280',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6'
        };
        return colors[variant] || colors.default;
    }
    
    function getEmptyStateBackgroundColor(variant) {
        const colors = {
            default: 'rgba(255, 255, 255, 0.1)',
            primary: '#3b82f6',
            secondary: '#6b7280',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6'
        };
        return colors[variant] || colors.default;
    }
    
    function getEmptyStateTextColor(variant) {
        const colors = {
            default: '#e4e4e7',
            primary: 'white',
            secondary: 'white',
            success: 'white',
            warning: 'white',
            error: 'white',
            info: 'white'
        };
        return colors[variant] || colors.default;
    }
    
    function getEmptyStateBorderColor(variant) {
        const colors = {
            default: 'rgba(255, 255, 255, 0.2)',
            primary: '#3b82f6',
            secondary: '#6b7280',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6'
        };
        return colors[variant] || colors.default;
    }
    
    // Add to DOM
    document.body.appendChild(emptyStateElement);
    
    // Animate in
    requestAnimationFrame(() => {
        emptyStateElement.style.opacity = '1';
        emptyStateElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!emptyStateElement.contains(e.target)) {
                closeEmptyState();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeEmptyState();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeEmptyState() {
        emptyStateElement.style.opacity = '0';
        emptyStateElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (emptyStateElement.parentNode) {
                emptyStateElement.parentNode.removeChild(emptyStateElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} empty state displayed`, 'info');
}

function createDemoMenu(type, triggerButton, toastManager) {
    // Define tokens for demo use (since we're not importing the full Plauna system)
    const tokens = {
        get: (path) => {
            const paths = path.split('.');
            const values = {
                'spacing.sm': '8px',
                'spacing.md': '16px',
                'spacing.lg': '24px',
                'spacing.xl': '32px',
                'spacing.xxxl': '48px',
                'borderRadius.sm': '4px',
                'borderRadius.md': '8px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const menuConfigs = {
        default: {
            orientation: 'vertical',
            variant: 'default',
            size: 'md',
            selectable: true,
            items: [
                { label: 'Home', icon: '🏠' },
                { label: 'Profile', icon: '👤' },
                { label: 'Settings', icon: '⚙️' },
                { label: 'Help', icon: '❓' },
                { label: 'Logout', icon: '🚪' }
            ]
        },
        horizontal: {
            orientation: 'horizontal',
            variant: 'primary',
            size: 'md',
            showIcons: true,
            items: [
                { label: 'File', icon: '📁' },
                { label: 'Edit', icon: '✏️' },
                { label: 'View', icon: '👁️' },
                { label: 'Tools', icon: '🛠️' },
                { label: 'Help', icon: '❓' }
            ]
        },
        selectable: {
            orientation: 'vertical',
            variant: 'secondary',
            size: 'lg',
            selectable: true,
            multiSelect: true,
            showBadges: true,
            items: [
                { label: 'Documents', icon: '📁', badge: '12' },
                { label: 'Pictures', icon: '🖼️', badge: '8' },
                { label: 'Videos', icon: '🎬', badge: '3' },
                { label: 'Music', icon: '🎵', badge: '247' },
                { label: 'Downloads', icon: '⬇️', badge: '5' }
            ]
        },
        navigation: {
            orientation: 'horizontal',
            variant: 'primary',
            size: 'md',
            showIcons: true,
            bordered: true,
            items: [
                { label: 'Dashboard', icon: '📊' },
                { label: 'Projects', icon: '📁', badge: '3' },
                { label: 'Team', icon: '👥', badge: '12' },
                { label: 'Reports', icon: '📈' },
                { label: 'Analytics', icon: '📊' }
            ]
        }
    };
    
    const config = menuConfigs[type] || menuConfigs.default;
    
    // Create menu as a simple DOM element for demo
    const menuElement = document.createElement('div');
    menuElement.className = 'plauna-demo-menu';
    menuElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 24px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 300px;' +
        'max-width: 400px;'
    );
    
    // Create menu container
    const menuContainer = document.createElement('div');
    menuContainer.style.cssText = (
        'display: ' + (config.orientation === 'horizontal' ? 'flex' : 'block') + ';' +
        'flex-direction: ' + (config.orientation === 'horizontal' ? 'row' : 'column') + ';' +
        'gap: ' + tokens.get('spacing.sm') + ';' +
        'width: 100%;'
    );
    
    // Create menu items
    config.items.forEach((item, index) => {
        const menuItem = document.createElement('div');
        menuItem.dataset.menuItem = index.toString();
        menuItem.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'padding: ' + tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg') + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'cursor: ' + (config.selectable ? 'pointer' : 'default') + ';' +
            'transition: all 150ms ease;' +
            'background: transparent;' +
            'color: ' + getMenuTextColor(config.variant) + ';' +
            'border: ' + (config.bordered ? '1px solid ' + getMenuBorderColor(config.variant) : 'none') + ';'
        );
        
        // Add hover effect
        menuItem.addEventListener('mouseenter', () => {
            menuItem.style.background = getMenuHoverBackgroundColor(config.variant);
        });
        
        menuItem.addEventListener('mouseleave', () => {
            menuItem.style.background = 'transparent';
        });
        
        // Add icon if enabled
        if (config.showIcons && item.icon) {
            const icon = document.createElement('span');
            icon.textContent = item.icon;
            icon.style.cssText = (
                'font-size: 16px;' +
                'color: ' + getMenuTextColor(config.variant) + ';' +
                'flex-shrink: 0;'
            );
            menuItem.appendChild(icon);
        }
        
        // Add label
        const label = document.createElement('span');
        label.textContent = item.label;
        label.style.cssText = (
            'flex: 1;' +
            'color: inherit;' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';'
        );
        menuItem.appendChild(label);
        
        // Add badge if enabled
        if (config.showBadges && item.badge) {
            const badge = document.createElement('span');
            badge.textContent = item.badge;
            badge.style.cssText = (
                'background: ' + getMenuBadgeColor(config.variant) + ';' +
                'color: white;' +
                'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
                'padding: 2px 6px;' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'margin-left: ' + tokens.get('spacing.sm') + ';' +
                'flex-shrink: 0;'
            );
            menuItem.appendChild(badge);
        }
        
        // Add click handler for selectable menus
        if (config.selectable) {
            menuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                const isSelected = menuItem.style.background !== 'transparent';
                
                // Clear all selections for single-select mode
                if (!config.multiSelect) {
                    menuContainer.querySelectorAll('[data-menu-item]').forEach(item => {
                    item.style.background = 'transparent';
                });
                }
                
                // Toggle selection
                if (isSelected) {
                    menuItem.style.background = 'transparent';
                } else {
                    menuItem.style.background = getMenuSelectedBackgroundColor(config.variant);
                }
                
                toastManager.show(`Selected: ${item.label}`, 'info');
            });
        }
        
        menuContainer.appendChild(menuItem);
    });
    
    menuElement.appendChild(menuContainer);
    
    // Helper functions for menu colors
    function getMenuTextColor(variant) {
        const colors = {
            default: '#e4e4e7',
            primary: '#3b82f6',
            secondary: '#6b7280',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6'
        };
        return colors[variant] || colors.default;
    }
    
    function getMenuBorderColor(variant) {
        const colors = {
            default: 'rgba(255, 255, 255, 0.2)',
            primary: 'rgba(59, 130, 246, 0.3)',
            secondary: 'rgba(107, 114, 128, 0.3)',
            success: 'rgba(34, 197, 94, 0.3)',
            warning: 'rgba(245, 158, 11, 0.3)',
            error: 'rgba(239, 68, 68, 0.3)',
            info: 'rgba(59, 130, 246, 0.3)'
        };
        return colors[variant] || colors.default;
    }
    
    function getMenuHoverBackgroundColor(variant) {
        const colors = {
            default: 'rgba(255, 255, 255, 0.1)',
            primary: 'rgba(59, 130, 246, 0.1)',
            secondary: 'rgba(107, 114, 128, 0.1)',
            success: 'rgba(34, 197, 94, 0.1)',
            warning: 'rgba(245, 158, 11, 0.1)',
            error: 'rgba(239, 68, 68, 0.1)',
            info: 'rgba(59, 130, 246, 0.1)'
        };
        return colors[variant] || colors.default;
    }
    
    function getMenuSelectedBackgroundColor(variant) {
        const colors = {
            default: 'rgba(255, 255, 255, 0.2)',
            primary: 'rgba(59, 130, 246, 0.2)',
            secondary: 'rgba(107, 114, 128, 0.2)',
            success: 'rgba(34, 197, 94, 0.2)',
            warning: 'rgba(245, 158, 11, 0.2)',
            error: 'rgba(239, 68, 68, 0.2)',
            info: 'rgba(59, 130, 246, 0.2)'
        };
        return colors[variant] || colors.default;
    }
    
    function getMenuBadgeColor(variant) {
        const colors = {
            default: '#94a3b8',
            primary: '#3b82f6',
            secondary: '#6b7280',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6'
        };
        return colors[variant] || colors.default;
    }
    
    // Add to DOM
    document.body.appendChild(menuElement);
    
    // Animate in
    requestAnimationFrame(() => {
        menuElement.style.opacity = '1';
        menuElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!menuElement.contains(e.target)) {
                closeMenu();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeMenu();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeMenu() {
        menuElement.style.opacity = '0';
        menuElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (menuElement.parentNode) {
                menuElement.parentNode.removeChild(menuElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.orientation} menu displayed`, 'info');
}

function createDemoNavbar(type, triggerButton, toastManager) {
    // Define tokens for demo use (since we're not importing the full Plauna system)
    const tokens = {
        get: (path) => {
            const paths = path.split('.');
            const values = {
                'spacing.sm': '8px',
                'spacing.md': '16px',
                'spacing.lg': '24px',
                'spacing.xl': '32px',
                'spacing.xxxl': '48px',
                'borderRadius.sm': '4px',
                'borderRadius.md': '8px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const navbarConfigs = {
        default: {
            variant: 'default',
            position: 'top',
            brand: 'MyApp',
            items: [
                { label: 'Home', active: true },
                { label: 'Products' },
                { label: 'About' },
                { label: 'Contact' }
            ],
            actions: [
                { label: 'Login', variant: 'solid' }
            ]
        },
        primary: {
            variant: 'primary',
            position: 'fixed-top',
            brand: { text: 'Company', logo: { src: 'https://picsum.photos/seed/company/32/32', alt: 'Company' } },
            items: [
                { label: 'Dashboard', active: true },
                { label: 'Analytics' },
                { label: 'Reports' }
            ],
            actions: [
                { label: 'Profile', icon: '👤' },
                { label: 'Settings', icon: '⚙️' }
            ]
        },
        sticky: {
            variant: 'secondary',
            position: 'fixed-top',
            sticky: true,
            brand: 'StickyNav',
            items: [
                { label: 'Home', active: true },
                { label: 'Docs' },
                { label: 'Examples' },
                { label: 'Pricing' }
            ],
            actions: [
                { label: 'Get Started', variant: 'solid' }
            ]
        },
        transparent: {
            variant: 'default',
            position: 'fixed-top',
            transparent: true,
            brand: 'Transparent',
            items: [
                { label: 'Home', active: true },
                { label: 'Features' },
                { label: 'Pricing' }
            ],
            actions: [
                { label: 'Sign Up', variant: 'solid' }
            ]
        }
    };
    
    const config = navbarConfigs[type] || navbarConfigs.default;
    
    // Create navbar as a simple DOM element for demo
    const navbarElement = document.createElement('div');
    navbarElement.className = 'plauna-demo-navbar';
    navbarElement.style.cssText = (
        'position: fixed;' +
        'top: ' + (config.position === 'fixed-top' ? '0' : '20px') + ';' +
        'left: 0;' +
        'right: 0;' +
        'width: 100%;' +
        'background: ' + (config.transparent ? 'rgba(15, 23, 42, 0.95)' : getNavbarBackgroundColor(config.variant)) + ';' +
        'color: ' + getNavbarTextColor(config.variant) + ';' +
        'border-bottom: ' + (config.position === 'top' ? '1px solid ' + getNavbarBorderColor(config.variant) : 'none') + ';' +
        'padding: ' + tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg') + ';' +
        'z-index: 1000;' +
        'display: flex;' +
        'align-items: center;' +
        'justify-content: space-between;' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'backdrop-filter: blur(4px);' +
        'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);' +
        'opacity: 0;' +
        'transform: translateY(-20px);' +
        'transition: all 300ms ease;'
    );
    
    // Create brand section
    const brandSection = document.createElement('div');
    brandSection.style.cssText = (
        'display: flex;' +
        'align-items: center;' +
        'gap: ' + tokens.get('spacing.sm') + ';' +
        'font-size: ' + tokens.get('fontSizes.lg') + ';' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: inherit;' +
        'cursor: pointer;' +
        'transition: all 150ms ease;'
    );
    
    // Add brand logo if present
    if (config.brand && config.brand.logo) {
        const logo = document.createElement('img');
        logo.src = config.brand.logo.src;
        logo.alt = config.brand.logo.alt || config.brand.text;
        logo.style.cssText = (
            'height: 32px;' +
            'width: auto;' +
            'object-fit: contain;' +
            'margin-right: ' + tokens.get('spacing.sm') + ';'
        );
        brandSection.appendChild(logo);
    }
    
    // Add brand text
    if (config.brand && (config.brand.text || typeof config.brand === 'string')) {
        const brandText = document.createElement('span');
        brandText.textContent = typeof config.brand === 'string' ? config.brand : config.brand.text;
        brandText.style.cssText = (
            'color: inherit;' +
            'font-weight: inherit;' +
            'font-size: inherit;'
        );
        brandSection.appendChild(brandText);
    }
    
    navbarElement.appendChild(brandSection);
    
    // Create nav items
    const navItems = document.createElement('div');
    navItems.style.cssText = (
        'display: flex;' +
        'align-items: center;' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'flex: 1;' +
        'justify-content: center;'
    );
    
    config.items.forEach((item, index) => {
        const navItem = document.createElement('a');
        navItem.href = '#';
        navItem.textContent = item.label;
        navItem.style.cssText = (
            'color: ' + (item.active ? getNavbarTextColor(config.variant) : 'rgba(255, 255, 255, 0.7)') + ';' +
            'text-decoration: none;' +
            'font-weight: ' + (item.active ? tokens.get('fontWeights.semibold') : tokens.get('fontWeights.medium')) + ';' +
            'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'transition: all 150ms ease;' +
            'position: relative;' +
            'cursor: pointer;'
        );
        
        // Add active indicator
        if (item.active) {
            const indicator = document.createElement('div');
            indicator.style.cssText = (
                'position: absolute;' +
                'bottom: -2px;' +
                'left: 0;' +
                'right: 0;' +
                'height: 2px;' +
                'background: ' + getNavbarTextColor(config.variant) + ';' +
                'border-radius: 1px;'
            );
            navItem.appendChild(indicator);
        }
        
        navItem.addEventListener('mouseenter', () => {
            if (!item.active) {
                navItem.style.color = getNavbarTextColor(config.variant);
                navItem.style.background = 'rgba(255, 255, 255, 0.1)';
            }
        });
        
        navItem.addEventListener('mouseleave', () => {
            if (!item.active) {
                navItem.style.color = 'rgba(255, 255, 255, 0.7)';
                navItem.style.background = 'transparent';
            }
        });
        
        navItem.addEventListener('click', (e) => {
            e.preventDefault();
            toastManager.show(`Clicked: ${item.label}`, 'info');
        });
        
        navItems.appendChild(navItem);
    });
    
    navbarElement.appendChild(navItems);
    
    // Create actions section
    const actionsSection = document.createElement('div');
    actionsSection.style.cssText = (
        'display: flex;' +
        'align-items: center;' +
        'gap: ' + tokens.get('spacing.sm') + ';'
    );
    
    config.actions.forEach((action, index) => {
        const actionButton = document.createElement('button');
        actionButton.type = 'button';
        actionButton.textContent = action.label;
        actionButton.style.cssText = (
            'background: ' + (action.variant === 'solid' ? getNavbarTextColor(config.variant) : 'transparent') + ';' +
            'color: ' + (action.variant === 'solid' ? getNavbarBackgroundColor(config.variant) : getNavbarTextColor(config.variant)) + ';' +
            'border: 1px solid ' + (action.variant === 'solid' ? getNavbarTextColor(config.variant) : getNavbarTextColor(config.variant)) + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'cursor: pointer;' +
            'transition: all 150ms ease;'
        );
        
        // Add icon if present
        if (action.icon) {
            const icon = document.createElement('span');
            icon.textContent = action.icon;
            icon.style.cssText = (
                'font-size: 16px;' +
                'color: inherit;' +
                'margin-right: ' + tokens.get('spacing.xs') + ';'
            );
            actionButton.insertBefore(icon, actionButton.firstChild);
        }
        
        actionButton.addEventListener('mouseenter', () => {
            if (action.variant === 'solid') {
                actionButton.style.background = 'rgba(255, 255, 255, 0.1)';
                actionButton.style.color = getNavbarTextColor(config.variant);
            } else {
                actionButton.style.background = getNavbarTextColor(config.variant);
                actionButton.style.color = getNavbarBackgroundColor(config.variant);
            }
        });
        
        actionButton.addEventListener('mouseleave', () => {
            actionButton.style.background = action.variant === 'solid' ? getNavbarTextColor(config.variant) : 'transparent';
            actionButton.style.color = action.variant === 'solid' ? getNavbarBackgroundColor(config.variant) : getNavbarTextColor(config.variant);
        });
        
        actionButton.addEventListener('click', (e) => {
            e.stopPropagation();
            toastManager.show(`Clicked: ${action.label}`, 'info');
        });
        
        actionsSection.appendChild(actionButton);
    });
    
    navbarElement.appendChild(actionsSection);
    
    // Helper functions for navbar colors
    function getNavbarBackgroundColor(variant) {
        const colors = {
            default: 'rgba(15, 23, 42, 0.95)',
            primary: '#3b82f6',
            secondary: '#6b7280',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6'
        };
        return colors[variant] || colors.default;
    }
    
    function getNavbarTextColor(variant) {
        const colors = {
            default: '#e4e4e7',
            primary: 'white',
            secondary: 'white',
            success: 'white',
            warning: 'white',
            error: 'white',
            info: 'white'
        };
        return colors[variant] || colors.default;
    }
    
    function getNavbarBorderColor(variant) {
        const colors = {
            default: 'rgba(99, 116, 141, 0.3)',
            primary: '#3b82f6',
            secondary: '#6b7280',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6'
        };
        return colors[variant] || colors.default;
    }
    
    // Add to DOM
    document.body.appendChild(navbarElement);
    
    // Animate in
    requestAnimationFrame(() => {
        navbarElement.style.opacity = '1';
        navbarElement.style.transform = 'translateY(0)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!navbarElement.contains(e.target)) {
                closeNavbar();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeNavbar();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeNavbar() {
        navbarElement.style.opacity = '0';
        navbarElement.style.transform = 'translateY(-20px)';
        setTimeout(() => {
            if (navbarElement.parentNode) {
                navbarElement.parentNode.removeChild(navbarElement);
            }
        }, 300);
    }
    
    toastManager.show(`${config.position} navbar displayed`, 'info');
}

function createDemoSidebar(type, triggerButton, toastManager) {
    // Define tokens for demo use
    const tokens = {
        get: (path) => {
            const paths = path.split('.');
            const values = {
                'spacing.sm': '8px',
                'spacing.md': '16px',
                'spacing.lg': '24px',
                'spacing.xl': '32px',
                'spacing.xxxl': '48px',
                'borderRadius.sm': '4px',
                'borderRadius.md': '8px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const sidebarConfigs = {
        default: {
            variant: 'default',
            position: 'left',
            brand: { text: 'Sidebar', icon: '📁' },
            items: [
                { label: 'Dashboard', icon: '📊', active: true },
                { label: 'Documents', icon: '📄', badge: '12' },
                { label: 'Analytics', icon: '📈' },
                { label: 'Reports', icon: '📑' },
                { label: 'Settings', icon: '⚙️' },
                { label: 'Help', icon: '❓' }
            ],
            footer: '© 2024 MyApp'
        },
        primary: {
            variant: 'primary',
            position: 'left',
            brand: { text: 'Nav', icon: '🧭' },
            items: [
                { label: 'Home', icon: '🏠', active: true },
                { label: 'Profile', icon: '👤' },
                { label: 'Messages', icon: '💬', badge: '5' },
                { label: 'Notifications', icon: '🔔', badge: '3' }
            ]
        },
        collapsible: {
            variant: 'secondary',
            position: 'left',
            collapsible: true,
            brand: { text: 'Collapsible' },
            items: [
                { label: 'Menu 1', icon: '📋' },
                { label: 'Menu 2', icon: '📝' },
                { label: 'Menu 3', icon: '📊' },
                { label: 'Menu 4', icon: '📈' },
                { label: 'Menu 5', icon: '📑' }
            ]
        },
        right: {
            variant: 'info',
            position: 'right',
            brand: { text: 'Right Side' },
            items: [
                { label: 'Activity', icon: '🔔', active: true },
                { label: 'History', icon: '📚' },
                { label: 'Archive', icon: '📦' },
                { label: 'Trash', icon: '🗑️' }
            ],
            footer: {
                items: [
                    { label: 'Settings', icon: '⚙️', onClick: () => toastManager.show('Settings clicked', 'info') },
                    { label: 'Logout', icon: '🚪', onClick: () => toastManager.show('Logout clicked', 'info') }
                ]
            }
        }
    };
    
    const config = sidebarConfigs[type] || sidebarConfigs.default;
    
    // Create sidebar as a simple DOM element for demo
    const sidebarElement = document.createElement('div');
    sidebarElement.className = 'plauna-demo-sidebar';
    sidebarElement.style.cssText = (
        'position: fixed;' +
        'top: 0;' +
        (config.position === 'left' ? 'left: 0;' : 'right: 0;') +
        'width: 280px;' +
        'height: 100vh;' +
        'background: ' + getSidebarBackgroundColor(config.variant) + ';' +
        'color: ' + getSidebarTextColor(config.variant) + ';' +
        'border-' + (config.position === 'left' ? 'right' : 'left') + ': 1px solid ' + getSidebarBorderColor(config.variant) + ';' +
        'padding: ' + tokens.get('spacing.lg') + ' ' + tokens.get('spacing.xl') + ';' +
        'z-index: 1000;' +
        'display: flex;' +
        'flex-direction: column;' +
        'gap: ' + tokens.get('spacing.sm') + ';' +
        'backdrop-filter: blur(4px);' +
        'box-shadow: 4px 0 12px rgba(0, 0, 0, 0.15);' +
        'opacity: 0;' +
        'transform: ' + (config.position === 'left' ? 'translateX(-100%)' : 'translateX(100%)') + ';' +
        'transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1);'
    );
    
    // Create brand section
    const brandSection = document.createElement('div');
    brandSection.style.cssText = (
        'display: flex;' +
        'align-items: center;' +
        'gap: ' + tokens.get('spacing.sm') + ';' +
        'padding: ' + tokens.get('spacing.md') + ';' +
        'border-bottom: 1px solid ' + getSidebarBorderColor(config.variant) + ';' +
        'font-size: ' + tokens.get('fontSizes.lg') + ';' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: inherit;' +
        'cursor: pointer;' +
        'transition: all 150ms ease;'
    );
    
    // Add brand icon if present
    if (config.brand && config.brand.icon) {
        const icon = document.createElement('span');
        icon.textContent = config.brand.icon;
        icon.style.cssText = (
            'font-size: 24px;' +
            'color: inherit;'
        );
        brandSection.appendChild(icon);
    }
    
    // Add brand text
    if (config.brand && config.brand.text) {
        const brandText = document.createElement('span');
        brandText.textContent = config.brand.text;
        brandText.style.cssText = (
            'color: inherit;' +
            'font-weight: inherit;' +
            'font-size: inherit;'
        );
        brandSection.appendChild(brandText);
    }
    
    sidebarElement.appendChild(brandSection);
    
    // Create nav items
    const navItems = document.createElement('div');
    navItems.style.cssText = (
        'display: flex;' +
        'flex-direction: column;' +
        'gap: ' + tokens.get('spacing.xs') + ';' +
        'flex: 1;' +
        'overflow-y: auto;' +
        'overflow-x: hidden;'
    );
    
    config.items.forEach((item, index) => {
        const navItem = document.createElement('div');
        navItem.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'padding: ' + tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg') + ';' +
            'color: ' + (item.active ? getSidebarTextColor(config.variant) : 'rgba(255, 255, 255, 0.7)') + ';' +
            'font-weight: ' + (item.active ? tokens.get('fontWeights.semibold') : tokens.get('fontWeights.medium')) + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'cursor: pointer;' +
            'transition: all 150ms ease;' +
            'position: relative;' +
            'text-decoration: none;'
        );
        
        // Add active indicator
        if (item.active) {
            const indicator = document.createElement('div');
            indicator.style.cssText = (
                'position: absolute;' +
                (config.position === 'left' ? 'left: 0;' : 'right: 0;') +
                'top: 0;' +
                'bottom: 0;' +
                'width: 3px;' +
                'background: ' + getSidebarTextColor(config.variant) + ';'
            );
            navItem.appendChild(indicator);
        }
        
        // Add icon
        if (item.icon) {
            const icon = document.createElement('span');
            icon.textContent = item.icon;
            icon.style.cssText = (
                'font-size: 18px;' +
                'color: inherit;' +
                'width: 20px;' +
                'text-align: center;'
            );
            navItem.appendChild(icon);
        }
        
        // Add label
        const label = document.createElement('span');
        label.textContent = item.label;
        label.style.cssText = (
            'color: inherit;' +
            'font-weight: inherit;' +
            'font-size: inherit;' +
            'flex: 1;'
        );
        navItem.appendChild(label);
        
        // Add badge if present
        if (item.badge) {
            const badge = document.createElement('span');
            badge.textContent = item.badge;
            badge.style.cssText = (
                'background: ' + (item.active ? getSidebarTextColor(config.variant) : 'rgba(255, 255, 255, 0.7)') + ';' +
                'color: ' + (item.active ? getSidebarBackgroundColor(config.variant) : 'white') + ';' +
                'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
                'padding: 2px 6px;' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'margin-left: auto;' +
                'flex-shrink: 0;'
            );
            navItem.appendChild(badge);
        }
        
        navItem.addEventListener('mouseenter', () => {
            if (!item.active) {
                navItem.style.background = 'rgba(255, 255, 255, 0.1)';
                navItem.style.color = getSidebarTextColor(config.variant);
            }
        });
        
        navItem.addEventListener('mouseleave', () => {
            if (!item.active) {
                navItem.style.background = 'transparent';
                navItem.style.color = 'rgba(255, 255, 255, 0.7)';
            }
        });
        
        navItem.addEventListener('click', () => {
            toastManager.show(`Clicked: ${item.label}`, 'info');
        });
        
        navItems.appendChild(navItem);
    });
    
    sidebarElement.appendChild(navItems);
    
    // Create footer section if present
    if (config.footer) {
        const footerSection = document.createElement('div');
        footerSection.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'padding: ' + tokens.get('spacing.md') + ';' +
            'border-top: 1px solid ' + getSidebarBorderColor(config.variant) + ';' +
            'margin-top: auto;' +
            'flex-shrink: 0;'
        );
        
        if (typeof config.footer === 'string') {
            const footerText = document.createElement('div');
            footerText.textContent = config.footer;
            footerText.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'color: rgba(255, 255, 255, 0.7);' +
                'text-align: center;' +
                'opacity: 0.7;'
            );
            footerSection.appendChild(footerText);
        } else if (config.footer && config.footer.items) {
            config.footer.items.forEach(item => {
                const footerItem = document.createElement('div');
                footerItem.style.cssText = (
                    'display: flex;' +
                    'align-items: center;' +
                    'gap: ' + tokens.get('spacing.sm') + ';' +
                    'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
                    'color: rgba(255, 255, 255, 0.7);' +
                    'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                    'cursor: pointer;' +
                    'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                    'transition: all 150ms ease;'
                );
                
                if (item.icon) {
                    const icon = document.createElement('span');
                    icon.textContent = item.icon;
                    icon.style.cssText = (
                        'font-size: 16px;' +
                        'color: inherit;'
                    );
                    footerItem.appendChild(icon);
                }
                
                const label = document.createElement('span');
                label.textContent = item.label;
                label.style.cssText = (
                    'color: inherit;' +
                    'font-size: inherit;'
                );
                footerItem.appendChild(label);
                
                if (item.onClick) {
                    footerItem.addEventListener('click', item.onClick);
                }
                
                footerItem.addEventListener('mouseenter', () => {
                    footerItem.style.background = 'rgba(255, 255, 255, 0.1)';
                });
                
                footerItem.addEventListener('mouseleave', () => {
                    footerItem.style.background = 'transparent';
                });
                
                footerSection.appendChild(footerItem);
            });
        }
        
        sidebarElement.appendChild(footerSection);
    }
    
    // Add collapse toggle if collapsible
    if (config.collapsible) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.innerHTML = config.position === 'left' ? '◀' : '▶';
        toggle.style.cssText = (
            'position: absolute;' +
            (config.position === 'left' ? 'right: ' + tokens.get('spacing.md') + ';' : 'left: ' + tokens.get('spacing.md') + ';') +
            'top: ' + tokens.get('spacing.md') + ';' +
            'background: transparent;' +
            'border: none;' +
            'color: ' + getSidebarTextColor(config.variant) + ';' +
            'font-size: 18px;' +
            'cursor: pointer;' +
            'padding: ' + tokens.get('spacing.sm') + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'transition: all 150ms ease;' +
            'z-index: 10;'
        );
        
        toggle.addEventListener('click', () => {
            const isCollapsed = sidebarElement.style.width === '60px';
            if (isCollapsed) {
                sidebarElement.style.width = '280px';
                toggle.innerHTML = config.position === 'left' ? '◀' : '▶';
            } else {
                sidebarElement.style.width = '60px';
                toggle.innerHTML = config.position === 'left' ? '▶' : '◀';
            }
        });
        
        sidebarElement.appendChild(toggle);
    }
    
    // Helper functions for sidebar colors
    function getSidebarBackgroundColor(variant) {
        const colors = {
            default: 'rgba(15, 23, 42, 0.95)',
            primary: '#3b82f6',
            secondary: '#6b7280',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6'
        };
        return colors[variant] || colors.default;
    }
    
    function getSidebarTextColor(variant) {
        const colors = {
            default: '#e4e4e7',
            primary: 'white',
            secondary: 'white',
            success: 'white',
            warning: 'white',
            error: 'white',
            info: 'white'
        };
        return colors[variant] || colors.default;
    }
    
    function getSidebarBorderColor(variant) {
        const colors = {
            default: 'rgba(99, 116, 141, 0.3)',
            primary: 'rgba(59, 130, 246, 0.3)',
            secondary: 'rgba(107, 114, 128, 0.3)',
            success: 'rgba(34, 197, 94, 0.3)',
            warning: 'rgba(245, 158, 11, 0.3)',
            error: 'rgba(239, 68, 68, 0.3)',
            info: 'rgba(59, 130, 246, 0.3)'
        };
        return colors[variant] || colors.default;
    }
    
    // Add to DOM
    document.body.appendChild(sidebarElement);
    
    // Animate in
    requestAnimationFrame(() => {
        sidebarElement.style.opacity = '1';
        sidebarElement.style.transform = 'translateX(0)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!sidebarElement.contains(e.target)) {
                closeSidebar();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeSidebar();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeSidebar() {
        sidebarElement.style.opacity = '0';
        sidebarElement.style.transform = 'translateX(' + (config.position === 'left' ? '-100%)' : '100%') + ')';
        setTimeout(() => {
            if (sidebarElement.parentNode) {
                sidebarElement.parentNode.removeChild(sidebarElement);
            }
        }, 300);
    }
    
    toastManager.show(`${config.position} sidebar displayed`, 'info');
}

function createDemoStepper(type, triggerButton, toastManager) {
    // Define tokens for demo use
    const tokens = {
        get: (path) => {
            const paths = path.split('.');
            const values = {
                'spacing.sm': '8px',
                'spacing.md': '16px',
                'spacing.lg': '24px',
                'spacing.xl': '32px',
                'spacing.xxxl': '48px',
                'borderRadius.sm': '4px',
                'borderRadius.md': '8px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const stepperConfigs = {
        default: {
            variant: 'default',
            orientation: 'horizontal',
            currentStep: 1,
            clickable: true,
            linear: true,
            showNumbers: true,
            showLabels: true,
            showDescriptions: false,
            steps: [
                { label: 'Account' },
                { label: 'Profile' },
                { label: 'Preferences' },
                { label: 'Review' }
            ]
        },
        vertical: {
            variant: 'primary',
            orientation: 'vertical',
            currentStep: 2,
            clickable: true,
            linear: false,
            showNumbers: true,
            showLabels: true,
            showDescriptions: true,
            steps: [
                { label: 'Personal Info', description: 'Basic information' },
                { label: 'Address', description: 'Shipping details' },
                { label: 'Payment', description: 'Payment method' },
                { label: 'Review', description: 'Review order' },
                { label: 'Complete', description: 'Finish setup' }
            ]
        },
        wizard: {
            variant: 'info',
            orientation: 'horizontal',
            currentStep: 0,
            clickable: true,
            linear: true,
            showNumbers: true,
            showLabels: true,
            showDescriptions: false,
            steps: [
                { label: 'Welcome' },
                { label: 'Setup' },
                { label: 'Configure' },
                { label: 'Launch' }
            ]
        },
        process: {
            variant: 'success',
            orientation: 'vertical',
            currentStep: 3,
            clickable: false,
            linear: true,
            showNumbers: false,
            showLabels: true,
            showDescriptions: true,
            steps: [
                { label: 'Data Collection', description: 'Gathering requirements' },
                { label: 'Analysis', description: 'Processing data' },
                { label: 'Design', description: 'Creating solution' },
                { label: 'Implementation', description: 'Building product' },
                { label: 'Testing', description: 'Quality assurance' },
                { label: 'Deployment', description: 'Going live' }
            ]
        },
        error: {
            variant: 'error',
            orientation: 'horizontal',
            currentStep: 2,
            clickable: true,
            linear: false,
            showNumbers: true,
            showLabels: true,
            showDescriptions: false,
            steps: [
                { label: 'Start' },
                { label: 'Process' },
                { label: 'Error' },
                { label: 'Retry' }
            ]
        }
    };
    
    const config = stepperConfigs[type] || stepperConfigs.default;
    
    // Create stepper as a simple DOM element for demo
    const stepperElement = document.createElement('div');
    stepperElement.className = 'plauna-demo-stepper';
    stepperElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 32px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 600px;' +
        'max-width: 800px;' +
        'display: flex;' +
        'flex-direction: column;' +
        'gap: 24px;'
    );
    
    // Create title
    const title = document.createElement('div');
    title.textContent = 'Step Progress Indicator';
    title.style.cssText = (
        'font-size: 18px;' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: #e4e4e7;' +
        'text-align: center;' +
        'margin-bottom: 8px;'
    );
    stepperElement.appendChild(title);
    
    // Create stepper container
    const stepperContainer = document.createElement('div');
    stepperContainer.style.cssText = (
        'display: ' + (config.orientation === 'horizontal' ? 'flex' : 'block') + ';' +
        'flex-direction: ' + (config.orientation === 'horizontal' ? 'row' : 'column') + ';' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'width: 100%;' +
        'position: relative;' +
        'padding: ' + tokens.get('spacing.lg') + ';'
    );
    
    // Create steps
    config.steps.forEach((step, index) => {
        const state = index < config.currentStep ? 'completed' : 
                     index === config.currentStep ? 'active' : 'pending';
        
        const stepElement = document.createElement('div');
        stepElement.dataset.stepIndex = index.toString();
        stepElement.style.cssText = (
            'display: flex;' +
            'flex-direction: ' + (config.orientation === 'horizontal' ? 'column' : 'row') + ';' +
            'align-items: ' + (config.orientation === 'horizontal' ? 'center' : 'flex-start') + ';' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'cursor: ' + (config.clickable && (!config.linear || index <= config.currentStep) ? 'pointer' : 'default') + ';' +
            'transition: all 150ms ease;' +
            'position: relative;' +
            'flex: 1;'
        );
        
        // Create step indicator
        const indicator = document.createElement('div');
        indicator.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'width: 32px;' +
            'height: 32px;' +
            'border-radius: 50%;' +
            'border: 2px solid ' + getStepperBorderColor(state, config.variant) + ';' +
            'background: ' + getStepperBackgroundColor(state, config.variant) + ';' +
            'color: ' + getStepperTextColor(state, config.variant) + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
            'transition: all 150ms ease;' +
            'position: relative;' +
            'flex-shrink: 0;'
        );
        
        // Add step number or icon
        if (config.showNumbers) {
            const number = document.createElement('span');
            number.textContent = state === 'completed' ? '✓' : index + 1;
            indicator.appendChild(number);
        }
        
        stepElement.appendChild(indicator);
        
        // Create step content
        if (config.showLabels || config.showDescriptions) {
            const content = document.createElement('div');
            content.style.cssText = (
                'display: flex;' +
                'flex-direction: column;' +
                'gap: ' + tokens.get('spacing.xs') + ';' +
                'text-align: ' + (config.orientation === 'horizontal' ? 'center' : 'left') + ';'
            );
            
            // Add label
            if (config.showLabels && step.label) {
                const label = document.createElement('div');
                label.textContent = step.label;
                label.style.cssText = (
                    'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                    'font-weight: ' + (state === 'active' ? tokens.get('fontWeights.semibold') : tokens.get('fontWeights.medium')) + ';' +
                    'color: ' + getStepperTextColor(state, config.variant) + ';' +
                    'line-height: 1.2;'
                );
                content.appendChild(label);
            }
            
            // Add description
            if (config.showDescriptions && step.description) {
                const description = document.createElement('div');
                description.textContent = step.description;
                description.style.cssText = (
                    'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                    'color: #94a3b8;' +
                    'line-height: 1.3;' +
                    'opacity: 0.8;'
                );
                content.appendChild(description);
            }
            
            stepElement.appendChild(content);
        }
        
        // Add click handler
        if (config.clickable && (!config.linear || index <= config.currentStep)) {
            stepElement.addEventListener('click', (e) => {
                e.stopPropagation();
                updateStepperStep(index);
                toastManager.show(`Navigated to step ${index + 1}: ${step.label}`, 'info');
            });
            
            stepElement.addEventListener('mouseenter', () => {
                if (state !== 'active') {
                    stepElement.style.opacity = '0.8';
                }
            });
            
            stepElement.addEventListener('mouseleave', () => {
                if (state !== 'active') {
                    stepElement.style.opacity = '1';
                }
            });
        }
        
        stepperContainer.appendChild(stepElement);
        
        // Add connector (except for last step)
        if (index < config.steps.length - 1) {
            const connector = document.createElement('div');
            const isCompleted = state === 'completed';
            
            connector.style.cssText = (
                'position: absolute;' +
                (config.orientation === 'horizontal' ? 
                    'left: 32px;' +
                    'right: -16px;' +
                    'top: 16px;' +
                    'height: 2px;' :
                    'top: 32px;' +
                    'bottom: -16px;' +
                    'left: 16px;' +
                    'width: 2px;'
                ) +
                'background: ' + (isCompleted ? getStepperTextColor('completed', config.variant) : '#475569') + ';' +
                'transition: all 150ms ease;'
            );
            
            stepperContainer.appendChild(connector);
        }
    });
    
    stepperElement.appendChild(stepperContainer);
    
    // Create navigation controls
    let controls = null;
    if (config.clickable) {
        controls = document.createElement('div');
        controls.style.cssText = (
            'display: flex;' +
            'justify-content: center;' +
            'gap: ' + tokens.get('spacing.md') + ';' +
            'padding-top: ' + tokens.get('spacing.lg') + ';' +
            'border-top: 1px solid rgba(99, 116, 141, 0.3);'
        );
        
        const prevButton = document.createElement('button');
        prevButton.textContent = 'Previous';
        prevButton.style.cssText = (
            'background: transparent;' +
            'color: #94a3b8;' +
            'border: 1px solid #475569;' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'cursor: pointer;' +
            'transition: all 150ms ease;'
        );
        
        prevButton.addEventListener('click', () => {
            if (config.currentStep > 0) {
                updateStepperStep(config.currentStep - 1);
                toastManager.show('Previous step', 'info');
            }
        });
        
        prevButton.addEventListener('mouseenter', () => {
            prevButton.style.background = 'rgba(255, 255, 255, 0.1)';
            prevButton.style.color = '#e4e4e7';
        });
        
        prevButton.addEventListener('mouseleave', () => {
            prevButton.style.background = 'transparent';
            prevButton.style.color = '#94a3b8';
        });
        
        const nextButton = document.createElement('button');
        nextButton.textContent = 'Next';
        nextButton.style.cssText = (
            'background: ' + getStepperTextColor('active', config.variant) + ';' +
            'color: ' + getStepperBackgroundColor('active', config.variant) + ';' +
            'border: 1px solid ' + getStepperTextColor('active', config.variant) + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'cursor: pointer;' +
            'transition: all 150ms ease;'
        );
        
        nextButton.addEventListener('click', () => {
            if (config.currentStep < config.steps.length - 1) {
                updateStepperStep(config.currentStep + 1);
                toastManager.show('Next step', 'info');
            } else {
                toastManager.show('Last step reached', 'info');
            }
        });
        
        nextButton.addEventListener('mouseenter', () => {
            nextButton.style.background = 'rgba(255, 255, 255, 0.1)';
            nextButton.style.color = getStepperTextColor('active', config.variant);
        });
        
        nextButton.addEventListener('mouseleave', () => {
            nextButton.style.background = getStepperTextColor('active', config.variant);
            nextButton.style.color = getStepperBackgroundColor('active', config.variant);
        });
        
        controls.appendChild(prevButton);
        controls.appendChild(nextButton);
        stepperElement.appendChild(controls);
    }
    
    // Helper functions for stepper colors
    function getStepperTextColor(state, variant) {
        const colors = {
            default: {
                pending: '#94a3b8',
                active: '#e4e4e7',
                completed: '#e4e4e7',
                error: '#ef4444'
            },
            primary: {
                pending: '#94a3b8',
                active: '#3b82f6',
                completed: '#3b82f6',
                error: '#ef4444'
            },
            secondary: {
                pending: '#94a3b8',
                active: '#6b7280',
                completed: '#6b7280',
                error: '#ef4444'
            },
            success: {
                pending: '#94a3b8',
                active: '#22c55e',
                completed: '#22c55e',
                error: '#ef4444'
            },
            warning: {
                pending: '#94a3b8',
                active: '#f59e0b',
                completed: '#f59e0b',
                error: '#ef4444'
            },
            error: {
                pending: '#94a3b8',
                active: '#ef4444',
                completed: '#ef4444',
                error: '#ef4444'
            },
            info: {
                pending: '#94a3b8',
                active: '#3b82f6',
                completed: '#3b82f6',
                error: '#ef4444'
            }
        };
        return colors[variant]?.[state] || colors.default[state];
    }
    
    function getStepperBackgroundColor(state, variant) {
        const colors = {
            default: {
                pending: 'transparent',
                active: 'rgba(15, 23, 42, 0.95)',
                completed: 'rgba(15, 23, 42, 0.95)',
                error: 'rgba(239, 68, 68, 0.1)'
            },
            primary: {
                pending: 'transparent',
                active: 'rgba(59, 130, 246, 0.1)',
                completed: 'rgba(59, 130, 246, 0.1)',
                error: 'rgba(239, 68, 68, 0.1)'
            },
            secondary: {
                pending: 'transparent',
                active: 'rgba(107, 114, 128, 0.1)',
                completed: 'rgba(107, 114, 128, 0.1)',
                error: 'rgba(239, 68, 68, 0.1)'
            },
            success: {
                pending: 'transparent',
                active: 'rgba(34, 197, 94, 0.1)',
                completed: 'rgba(34, 197, 94, 0.1)',
                error: 'rgba(239, 68, 68, 0.1)'
            },
            warning: {
                pending: 'transparent',
                active: 'rgba(245, 158, 11, 0.1)',
                completed: 'rgba(245, 158, 11, 0.1)',
                error: 'rgba(239, 68, 68, 0.1)'
            },
            error: {
                pending: 'transparent',
                active: 'rgba(239, 68, 68, 0.1)',
                completed: 'rgba(239, 68, 68, 0.1)',
                error: 'rgba(239, 68, 68, 0.1)'
            },
            info: {
                pending: 'transparent',
                active: 'rgba(59, 130, 246, 0.1)',
                completed: 'rgba(59, 130, 246, 0.1)',
                error: 'rgba(239, 68, 68, 0.1)'
            }
        };
        return colors[variant]?.[state] || colors.default[state];
    }
    
    function getStepperBorderColor(state, variant) {
        const colors = {
            default: {
                pending: '#475569',
                active: '#e4e4e7',
                completed: '#e4e4e7',
                error: '#ef4444'
            },
            primary: {
                pending: '#475569',
                active: '#3b82f6',
                completed: '#3b82f6',
                error: '#ef4444'
            },
            secondary: {
                pending: '#475569',
                active: '#6b7280',
                completed: '#6b7280',
                error: '#ef4444'
            },
            success: {
                pending: '#475569',
                active: '#22c55e',
                completed: '#22c55e',
                error: '#ef4444'
            },
            warning: {
                pending: '#475569',
                active: '#f59e0b',
                completed: '#f59e0b',
                error: '#ef4444'
            },
            error: {
                pending: '#475569',
                active: '#ef4444',
                completed: '#ef4444',
                error: '#ef4444'
            },
            info: {
                pending: '#475569',
                active: '#3b82f6',
                completed: '#3b82f6',
                error: '#ef4444'
            }
        };
        return colors[variant]?.[state] || colors.default[state];
    }
    
    // Update stepper step function
    function updateStepperStep(newStep) {
        config.currentStep = newStep;
        
        // Clear stepper element
        stepperElement.innerHTML = '';
        
        // Recreate title
        stepperElement.appendChild(title);
        
        // Recreate stepper container with updated step
        const newStepperContainer = document.createElement('div');
        newStepperContainer.style.cssText = (
            'display: ' + (config.orientation === 'horizontal' ? 'flex' : 'block') + ';' +
            'flex-direction: ' + (config.orientation === 'horizontal' ? 'row' : 'column') + ';' +
            'gap: ' + tokens.get('spacing.md') + ';' +
            'width: 100%;' +
            'position: relative;' +
            'padding: ' + tokens.get('spacing.lg') + ';'
        );
        
        // Recreate steps with new current step
        config.steps.forEach((step, index) => {
            const state = index < config.currentStep ? 'completed' : 
                         index === config.currentStep ? 'active' : 'pending';
            
            const stepElement = document.createElement('div');
            stepElement.dataset.stepIndex = index.toString();
            stepElement.style.cssText = (
                'display: flex;' +
                'flex-direction: ' + (config.orientation === 'horizontal' ? 'column' : 'row') + ';' +
                'align-items: ' + (config.orientation === 'horizontal' ? 'center' : 'flex-start') + ';' +
                'gap: ' + tokens.get('spacing.sm') + ';' +
                'cursor: ' + (config.clickable && (!config.linear || index <= config.currentStep) ? 'pointer' : 'default') + ';' +
                'transition: all 150ms ease;' +
                'position: relative;' +
                'flex: 1;'
            );
            
            // Create step indicator
            const indicator = document.createElement('div');
            indicator.style.cssText = (
                'display: flex;' +
                'align-items: center;' +
                'justify-content: center;' +
                'width: 32px;' +
                'height: 32px;' +
                'border-radius: 50%;' +
                'border: 2px solid ' + getStepperBorderColor(state, config.variant) + ';' +
                'background: ' + getStepperBackgroundColor(state, config.variant) + ';' +
                'color: ' + getStepperTextColor(state, config.variant) + ';' +
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
                'transition: all 150ms ease;' +
                'position: relative;' +
                'flex-shrink: 0;'
            );
            
            // Add step number or icon
            if (config.showNumbers) {
                const number = document.createElement('span');
                number.textContent = state === 'completed' ? '✓' : index + 1;
                indicator.appendChild(number);
            }
            
            stepElement.appendChild(indicator);
            
            // Create step content
            if (config.showLabels || config.showDescriptions) {
                const content = document.createElement('div');
                content.style.cssText = (
                    'display: flex;' +
                    'flex-direction: column;' +
                    'gap: ' + tokens.get('spacing.xs') + ';' +
                    'text-align: ' + (config.orientation === 'horizontal' ? 'center' : 'left') + ';'
                );
                
                // Add label
                if (config.showLabels && step.label) {
                    const label = document.createElement('div');
                    label.textContent = step.label;
                    label.style.cssText = (
                        'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                        'font-weight: ' + (state === 'active' ? tokens.get('fontWeights.semibold') : tokens.get('fontWeights.medium')) + ';' +
                        'color: ' + getStepperTextColor(state, config.variant) + ';' +
                        'line-height: 1.2;'
                    );
                    content.appendChild(label);
                }
                
                // Add description
                if (config.showDescriptions && step.description) {
                    const description = document.createElement('div');
                    description.textContent = step.description;
                    description.style.cssText = (
                        'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                        'color: #94a3b8;' +
                        'line-height: 1.3;' +
                        'opacity: 0.8;'
                    );
                    content.appendChild(description);
                }
                
                stepElement.appendChild(content);
            }
            
            // Add click handler
            if (config.clickable && (!config.linear || index <= config.currentStep)) {
                stepElement.addEventListener('click', (e) => {
                    e.stopPropagation();
                    updateStepperStep(index);
                    toastManager.show(`Navigated to step ${index + 1}: ${step.label}`, 'info');
                });
                
                stepElement.addEventListener('mouseenter', () => {
                    if (state !== 'active') {
                        stepElement.style.opacity = '0.8';
                    }
                });
                
                stepElement.addEventListener('mouseleave', () => {
                    if (state !== 'active') {
                        stepElement.style.opacity = '1';
                    }
                });
            }
            
            newStepperContainer.appendChild(stepElement);
            
            // Add connector (except for last step)
            if (index < config.steps.length - 1) {
                const connector = document.createElement('div');
                const isCompleted = state === 'completed';
                
                connector.style.cssText = (
                    'position: absolute;' +
                    (config.orientation === 'horizontal' ? 
                        'left: 32px;' +
                        'right: -16px;' +
                        'top: 16px;' +
                        'height: 2px;' :
                        'top: 32px;' +
                        'bottom: -16px;' +
                        'left: 16px;' +
                        'width: 2px;'
                    ) +
                    'background: ' + (isCompleted ? getStepperTextColor('completed', config.variant) : '#475569') + ';' +
                    'transition: all 150ms ease;'
                );
                
                newStepperContainer.appendChild(connector);
            }
        });
        
        stepperElement.appendChild(newStepperContainer);
        
        // Recreate controls
        if (controls) {
            stepperElement.appendChild(controls);
        }
    }
    
    // Add to DOM
    document.body.appendChild(stepperElement);
    
    // Animate in
    requestAnimationFrame(() => {
        stepperElement.style.opacity = '1';
        stepperElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!stepperElement.contains(e.target)) {
                closeStepper();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeStepper();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeStepper() {
        stepperElement.style.opacity = '0';
        stepperElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (stepperElement.parentNode) {
                stepperElement.parentNode.removeChild(stepperElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.orientation} stepper displayed`, 'info');
}

function createDemoContainer(type, triggerButton, toastManager) {
    // Define tokens for demo use
    const tokens = {
        get: (path) => {
            const paths = path.split('.');
            const values = {
                'spacing.sm': '8px',
                'spacing.md': '16px',
                'spacing.lg': '24px',
                'spacing.xl': '32px',
                'spacing.xxxl': '48px',
                'borderRadius.sm': '4px',
                'borderRadius.md': '8px',
                'borderRadius.lg': '12px',
                'borderRadius.xl': '16px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600',
                'colors.background.primary': '#ffffff',
                'colors.background.secondary': '#f8fafc',
                'colors.primary': '#3b82f6',
                'colors.secondary': '#64748b',
                'colors.accent': '#8b5cf6',
                'colors.text.primary': '#1e293b',
                'colors.text.secondary': '#64748b',
                'colors.border.light': '#e2e8f0',
                'colors.border.medium': '#cbd5e1',
                'colors.surface': '#f1f5f9'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const containerConfigs = {
        default: {
            variant: 'default',
            size: 'md',
            padding: 'lg',
            display: 'block',
            background: 'primary',
            title: 'Default Container',
            description: 'Basic container with default styling'
        },
        card: {
            variant: 'card',
            size: 'md',
            padding: 'lg',
            display: 'block',
            background: 'primary',
            shadow: 'sm',
            borderRadius: 'md',
            title: 'Card Container',
            description: 'Card-style container with border and shadow'
        },
        elevated: {
            variant: 'elevated',
            size: 'md',
            padding: 'lg',
            display: 'block',
            background: 'primary',
            shadow: 'lg',
            borderRadius: 'lg',
            hoverable: true,
            title: 'Elevated Container',
            description: 'Container with elevated shadow effect'
        },
        outlined: {
            variant: 'outlined',
            size: 'md',
            padding: 'md',
            display: 'block',
            background: 'transparent',
            borderRadius: 'md',
            title: 'Outlined Container',
            description: 'Container with outlined border style'
        },
        flex: {
            variant: 'default',
            size: 'md',
            padding: 'md',
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'secondary',
            title: 'Flex Container',
            description: 'Flexbox layout container with alignment'
        },
        grid: {
            variant: 'card',
            size: 'md',
            padding: 'md',
            display: 'grid',
            gap: 'md',
            background: 'primary',
            title: 'Grid Container',
            description: 'Grid layout container with auto-fit columns'
        },
        glass: {
            variant: 'glass',
            size: 'md',
            padding: 'lg',
            display: 'block',
            background: 'transparent',
            title: 'Glass Container',
            description: 'Container with glassmorphism effect'
        },
        hero: {
            variant: 'default',
            size: 'xl',
            padding: 'xxxl',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            background: 'primary',
            title: 'Hero Container',
            description: 'Hero section container with centered content'
        }
    };
    
    const config = containerConfigs[type] || containerConfigs.default;
    
    // Create container as a simple DOM element for demo
    const containerElement = document.createElement('div');
    containerElement.className = 'plauna-demo-container';
    containerElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 32px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 600px;' +
        'max-width: 800px;' +
        'display: flex;' +
        'flex-direction: column;' +
        'gap: 24px;'
    );
    
    // Create title
    const title = document.createElement('div');
    title.textContent = 'Container Layout Demo';
    title.style.cssText = (
        'font-size: 18px;' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: #e4e4e7;' +
        'text-align: center;' +
        'margin-bottom: 8px;'
    );
    containerElement.appendChild(title);
    
    // Create demo container
    const demoContainer = document.createElement('div');
    demoContainer.style.cssText = getContainerStyles(config);
    
    // Add content to demo container
    if (config.display === 'flex') {
        // Add flex items
        const flexItems = [
            { text: 'Item 1', background: tokens.get('colors.primary') },
            { text: 'Item 2', background: tokens.get('colors.secondary') },
            { text: 'Item 3', background: tokens.get('colors.accent') }
        ];
        
        flexItems.forEach(item => {
            const flexItem = document.createElement('div');
            flexItem.textContent = item.text;
            flexItem.style.cssText = (
                'padding: ' + tokens.get('spacing.md') + ';' +
                'background: ' + item.background + ';' +
                'color: white;' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'text-align: center;'
            );
            demoContainer.appendChild(flexItem);
        });
    } else if (config.display === 'grid') {
        // Add grid items
        const gridItems = [
            { text: 'Grid 1', background: tokens.get('colors.primary') },
            { text: 'Grid 2', background: tokens.get('colors.secondary') },
            { text: 'Grid 3', background: tokens.get('colors.accent') },
            { text: 'Grid 4', background: tokens.get('colors.primary') },
            { text: 'Grid 5', background: tokens.get('colors.secondary') },
            { text: 'Grid 6', background: tokens.get('colors.accent') }
        ];
        
        gridItems.forEach(item => {
            const gridItem = document.createElement('div');
            gridItem.textContent = item.text;
            gridItem.style.cssText = (
                'padding: ' + tokens.get('spacing.md') + ';' +
                'background: ' + item.background + ';' +
                'color: white;' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'text-align: center;' +
                'min-height: 80px;'
            );
            demoContainer.appendChild(gridItem);
        });
    } else {
        // Add default content
        const contentTitle = document.createElement('h3');
        contentTitle.textContent = config.title;
        contentTitle.style.cssText = (
            'font-size: ' + tokens.get('fontSizes.lg') + ';' +
            'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
            'color: ' + tokens.get('colors.text.primary') + ';' +
            'margin: 0 0 ' + tokens.get('spacing.sm') + ' 0;'
        );
        demoContainer.appendChild(contentTitle);
        
        const contentDesc = document.createElement('p');
        contentDesc.textContent = config.description;
        contentDesc.style.cssText = (
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'margin: 0 0 ' + tokens.get('spacing.md') + ' 0;' +
            'line-height: 1.5;'
        );
        demoContainer.appendChild(contentDesc);
        
        // Add sample content
        const sampleContent = document.createElement('div');
        sampleContent.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.sm') + ';'
        );
        
        const sampleItem1 = document.createElement('div');
        sampleItem1.textContent = 'Sample content item 1';
        sampleItem1.style.cssText = (
            'padding: ' + tokens.get('spacing.sm') + ';' +
            'background: ' + tokens.get('colors.surface') + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';'
        );
        sampleContent.appendChild(sampleItem1);
        
        const sampleItem2 = document.createElement('div');
        sampleItem2.textContent = 'Sample content item 2';
        sampleItem2.style.cssText = (
            'padding: ' + tokens.get('spacing.sm') + ';' +
            'background: ' + tokens.get('colors.surface') + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';'
        );
        sampleContent.appendChild(sampleItem2);
        
        demoContainer.appendChild(sampleContent);
    }
    
    containerElement.appendChild(demoContainer);
    
    // Create controls
    const controls = document.createElement('div');
    controls.style.cssText = (
        'display: flex;' +
        'justify-content: center;' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'padding-top: ' + tokens.get('spacing.lg') + ';' +
        'border-top: 1px solid rgba(99, 116, 141, 0.3);'
    );
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = (
        'background: transparent;' +
        'color: #94a3b8;' +
        'border: 1px solid #475569;' +
        'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
        'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
        'font-size: ' + tokens.get('fontSizes.sm') + ';' +
        'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
        'cursor: pointer;' +
        'transition: all 150ms ease;'
    );
    
    closeButton.addEventListener('click', closeContainer);
    
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.background = 'rgba(255, 255, 255, 0.1)';
        closeButton.style.color = '#e4e4e7';
    });
    
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.background = 'transparent';
        closeButton.style.color = '#94a3b8';
    });
    
    controls.appendChild(closeButton);
    containerElement.appendChild(controls);
    
    // Helper function for container styles
    function getContainerStyles(config) {
        let styles = (
            'display: ' + config.display + ';' +
            'padding: ' + getPaddingValue(config.padding) + ';' +
            'background: ' + getBackgroundColor(config.background) + ';' +
            'border-radius: ' + getBorderRadiusValue(config.borderRadius || 'md') + ';' +
            'box-shadow: ' + getShadowValue(config.shadow || 'none') + ';' +
            'border: ' + getBorderValue(config.variant) + ';' +
            'min-height: 200px;'
        );
        
        if (config.display === 'flex') {
            styles += (
                'flex-direction: ' + (config.flexDirection || 'row') + ';' +
                'justify-content: ' + (config.justifyContent || 'flex-start') + ';' +
                'align-items: ' + (config.alignItems || 'stretch') + ';' +
                'gap: ' + getGapValue(config.gap || 'md') + ';'
            );
        } else if (config.display === 'grid') {
            styles += (
                'grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));' +
                'gap: ' + getGapValue(config.gap || 'md') + ';'
            );
        } else if (config.display === 'flex' && config.flexDirection === 'column') {
            styles += (
                'flex-direction: ' + (config.flexDirection || 'column') + ';' +
                'justify-content: ' + (config.justifyContent || 'flex-start') + ';' +
                'align-items: ' + (config.alignItems || 'stretch') + ';' +
                'gap: ' + getGapValue(config.gap || 'md') + ';'
            );
        }
        
        return styles;
    }
    
    function getPaddingValue(padding) {
        const paddings = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl'),
            xxxl: tokens.get('spacing.xxxl')
        };
        return paddings[padding] || paddings.md;
    }
    
    function getBorderRadiusValue(borderRadius) {
        const radii = {
            none: '0',
            sm: tokens.get('borderRadius.sm'),
            md: tokens.get('borderRadius.md'),
            lg: tokens.get('borderRadius.lg'),
            xl: tokens.get('borderRadius.xl'),
            full: '9999px'
        };
        return radii[borderRadius] || radii.md;
    }
    
    function getShadowValue(shadow) {
        const shadows = {
            none: 'none',
            sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
            md: '0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)',
            lg: '0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05)',
            xl: '0 20px 25px rgba(0, 0, 0, 0.1), 0 10px 10px rgba(0, 0, 0, 0.04)'
        };
        return shadows[shadow] || shadows.none;
    }
    
    function getBorderValue(variant) {
        if (variant === 'outlined') {
            return '2px solid ' + tokens.get('colors.border.medium');
        } else if (variant === 'glass') {
            return '1px solid rgba(255, 255, 255, 0.2)';
        } else if (variant === 'card') {
            return '1px solid ' + tokens.get('colors.border.light');
        }
        return 'none';
    }
    
    function getBackgroundColor(background) {
        const backgrounds = {
            default: tokens.get('colors.background.primary'),
            primary: tokens.get('colors.primary'),
            secondary: tokens.get('colors.secondary'),
            accent: tokens.get('colors.accent'),
            surface: tokens.get('colors.surface'),
            transparent: 'transparent'
        };
        return backgrounds[background] || backgrounds.default;
    }
    
    function getGapValue(gap) {
        const gaps = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl')
        };
        return gaps[gap] || gaps.none;
    }
    
    // Add hover effect if hoverable
    if (config.hoverable) {
        demoContainer.addEventListener('mouseenter', () => {
            demoContainer.style.transform = 'translateY(-2px)';
            demoContainer.style.boxShadow = getEnhancedShadow(config.shadow || 'none');
        });
        
        demoContainer.addEventListener('mouseleave', () => {
            demoContainer.style.transform = 'translateY(0)';
            demoContainer.style.boxShadow = getShadowValue(config.shadow || 'none');
        });
    }
    
    function getEnhancedShadow(shadow) {
        const baseShadow = getShadowValue(shadow);
        if (baseShadow === 'none') {
            return '0 4px 6px rgba(0, 0, 0, 0.1)';
        }
        return baseShadow.replace('0.1', '0.15').replace('0.05', '0.08');
    }
    
    // Add to DOM
    document.body.appendChild(containerElement);
    
    // Animate in
    requestAnimationFrame(() => {
        containerElement.style.opacity = '1';
        containerElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!containerElement.contains(e.target)) {
                closeContainer();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeContainer();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeContainer() {
        containerElement.style.opacity = '0';
        containerElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (containerElement.parentNode) {
                containerElement.parentNode.removeChild(containerElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.variant} container displayed`, 'info');
}

function createDemoSection(type, triggerButton, toastManager) {
    // Define tokens for demo use
    const tokens = {
        get: (path) => {
            const paths = path.split('.');
            const values = {
                'spacing.sm': '8px',
                'spacing.md': '16px',
                'spacing.lg': '24px',
                'spacing.xl': '32px',
                'spacing.xxxl': '48px',
                'borderRadius.sm': '4px',
                'borderRadius.md': '8px',
                'borderRadius.lg': '12px',
                'borderRadius.xl': '16px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontSizes.xl': '20px',
                'fontWeights.normal': '400',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600',
                'colors.background.primary': '#ffffff',
                'colors.background.secondary': '#f8fafc',
                'colors.primary': '#3b82f6',
                'colors.secondary': '#64748b',
                'colors.accent': '#8b5cf6',
                'colors.text.primary': '#1e293b',
                'colors.text.secondary': '#64748b',
                'colors.text.inverse': '#ffffff',
                'colors.border.light': '#e2e8f0',
                'colors.border.medium': '#cbd5e1',
                'colors.surface': '#f1f5f9'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const sectionConfigs = {
        default: {
            variant: 'default',
            size: 'md',
            padding: 'xl',
            margin: 'lg',
            background: 'primary',
            heading: 'Default Section',
            subheading: 'Standard content section',
            description: 'This is a default section with basic styling and content organization.',
            showHeader: true,
            showFooter: false,
            title: 'Default Section'
        },
        hero: {
            variant: 'primary',
            size: 'xl',
            padding: 'xxxl',
            background: 'primary',
            alignment: 'center',
            heading: 'Hero Section',
            subheading: 'Welcome to Our Platform',
            description: 'A powerful hero section with centered content and primary styling.',
            showHeader: true,
            showFooter: false,
            title: 'Hero Section'
        },
        feature: {
            variant: 'muted',
            size: 'lg',
            padding: 'xl',
            background: 'secondary',
            heading: 'Feature Section',
            subheading: 'Key Features',
            description: 'Grid-based feature section with muted background and organized content.',
            showHeader: true,
            showFooter: false,
            display: 'grid',
            title: 'Feature Section'
        },
        testimonial: {
            variant: 'elevated',
            size: 'md',
            padding: 'xl',
            background: 'primary',
            alignment: 'center',
            heading: 'Testimonial Section',
            subheading: 'What Our Users Say',
            description: 'Elevated testimonial section with centered alignment and shadow effects.',
            showHeader: true,
            showFooter: true,
            footerContent: '— John Doe, CEO',
            title: 'Testimonial Section'
        },
        cta: {
            variant: 'accent',
            size: 'md',
            padding: 'xl',
            background: 'accent',
            alignment: 'center',
            heading: 'Call to Action',
            subheading: 'Get Started Today',
            description: 'Accent-colored call-to-action section with centered content and footer.',
            showHeader: true,
            showFooter: true,
            footerContent: 'Start Free Trial →',
            title: 'Call to Action Section'
        },
        sidebar: {
            variant: 'outlined',
            size: 'md',
            padding: 'lg',
            background: 'transparent',
            heading: 'Sidebar Section',
            subheading: 'Navigation',
            description: 'Outlined sidebar section with transparent background and border styling.',
            showHeader: true,
            showFooter: false,
            title: 'Sidebar Section'
        },
        footer: {
            variant: 'secondary',
            size: 'md',
            padding: 'xl',
            background: 'secondary',
            heading: 'Footer Section',
            subheading: 'Site Information',
            description: 'Secondary footer section with top separator and horizontal layout.',
            showHeader: true,
            showFooter: true,
            footerContent: '© 2024 Your Company',
            separators: 'top',
            title: 'Footer Section'
        },
        header: {
            variant: 'default',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            heading: 'Header Section',
            subheading: 'Site Navigation',
            description: 'Header section with bottom separator and horizontal layout.',
            showHeader: true,
            showFooter: false,
            separators: 'bottom',
            title: 'Header Section'
        }
    };
    
    const config = sectionConfigs[type] || sectionConfigs.default;
    
    // Create section as a simple DOM element for demo
    const sectionElement = document.createElement('div');
    sectionElement.className = 'plauna-demo-section';
    sectionElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 32px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 600px;' +
        'max-width: 800px;' +
        'display: flex;' +
        'flex-direction: column;' +
        'gap: 24px;'
    );
    
    // Create title
    const title = document.createElement('div');
    title.textContent = 'Section Layout Demo';
    title.style.cssText = (
        'font-size: 18px;' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: #e4e4e7;' +
        'text-align: center;' +
        'margin-bottom: 8px;'
    );
    sectionElement.appendChild(title);
    
    // Create demo section
    const demoSection = document.createElement('div');
    demoSection.style.cssText = getSectionStyles(config);
    
    // Add header if needed
    if (config.showHeader && (config.heading || config.subheading || config.description)) {
        const header = document.createElement('header');
        header.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'margin-bottom: ' + tokens.get('spacing.lg') + ';' +
            'text-align: ' + config.alignment + ';'
        );
        
        // Add heading
        if (config.heading) {
            const headingElement = document.createElement('h2');
            headingElement.textContent = config.heading;
            headingElement.style.cssText = (
                'font-size: 24px;' +
                'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
                'color: ' + getHeadingColor(config.variant) + ';' +
                'margin: 0;' +
                'line-height: 1.2;'
            );
            header.appendChild(headingElement);
        }
        
        // Add subheading
        if (config.subheading) {
            const subheadingElement = document.createElement('p');
            subheadingElement.textContent = config.subheading;
            subheadingElement.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.lg') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'color: ' + getSubheadingColor(config.variant) + ';' +
                'margin: 0;' +
                'line-height: 1.4;'
            );
            header.appendChild(subheadingElement);
        }
        
        // Add description
        if (config.description) {
            const descriptionElement = document.createElement('p');
            descriptionElement.textContent = config.description;
            descriptionElement.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.md') + ';' +
                'font-weight: ' + tokens.get('fontWeights.normal') + ';' +
                'color: ' + getDescriptionColor(config.variant) + ';' +
                'margin: 0;' +
                'line-height: 1.6;'
            );
            header.appendChild(descriptionElement);
        }
        
        demoSection.appendChild(header);
    }
    
    // Add main content area
    const main = document.createElement('main');
    main.style.cssText = (
        'flex: 1;' +
        'display: ' + (config.display === 'grid' ? 'grid' : 'flex') + ';' +
        (config.display === 'grid' ? 
            'grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));' :
            'flex-direction: column;') +
        'gap: ' + tokens.get('spacing.md') + ';'
    );
    
    // Add sample content
    const contentItems = [
        { text: 'Content Item 1', background: tokens.get('colors.primary') },
        { text: 'Content Item 2', background: tokens.get('colors.secondary') },
        { text: 'Content Item 3', background: tokens.get('colors.accent') }
    ];
    
    contentItems.forEach(item => {
        const contentItem = document.createElement('div');
        contentItem.textContent = item.text;
        contentItem.style.cssText = (
            'padding: ' + tokens.get('spacing.md') + ';' +
            'background: ' + item.background + ';' +
            'color: white;' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'text-align: center;' +
            'min-height: 60px;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;'
        );
        main.appendChild(contentItem);
    });
    
    demoSection.appendChild(main);
    
    // Add footer if needed
    if (config.showFooter && config.footerContent) {
        const footer = document.createElement('footer');
        footer.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: ' + (config.alignment === 'center' ? 'center' : config.alignment === 'right' ? 'flex-end' : 'flex-start') + ';' +
            'margin-top: ' + tokens.get('spacing.lg') + ';' +
            'padding-top: ' + tokens.get('spacing.md') + ';' +
            'border-top: 1px solid ' + tokens.get('colors.border.light') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'color: ' + getDescriptionColor(config.variant) + ';'
        );
        footer.textContent = config.footerContent;
        demoSection.appendChild(footer);
    }
    
    sectionElement.appendChild(demoSection);
    
    // Create controls
    const controls = document.createElement('div');
    controls.style.cssText = (
        'display: flex;' +
        'justify-content: center;' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'padding-top: ' + tokens.get('spacing.lg') + ';' +
        'border-top: 1px solid rgba(99, 116, 141, 0.3);'
    );
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = (
        'background: transparent;' +
        'color: #94a3b8;' +
        'border: 1px solid #475569;' +
        'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
        'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
        'font-size: ' + tokens.get('fontSizes.sm') + ';' +
        'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
        'cursor: pointer;' +
        'transition: all 150ms ease;'
    );
    
    closeButton.addEventListener('click', closeSection);
    
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.background = 'rgba(255, 255, 255, 0.1)';
        closeButton.style.color = '#e4e4e7';
    });
    
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.background = 'transparent';
        closeButton.style.color = '#94a3b8';
    });
    
    controls.appendChild(closeButton);
    sectionElement.appendChild(controls);
    
    // Helper function for section styles
    function getSectionStyles(config) {
        let styles = (
            'display: ' + (config.display || 'block') + ';' +
            'flex-direction: ' + (config.flexDirection || 'column') + ';' +
            'padding: ' + getPaddingValue(config.padding) + ';' +
            'margin: ' + getMarginValue(config.margin) + ';' +
            'background: ' + getBackgroundColor(config.background, config.variant) + ';' +
            'border-radius: ' + getBorderRadiusValue(config.borderRadius || 'none') + ';' +
            'box-shadow: ' + getShadowValue(config.shadow || 'none') + ';' +
            'border: ' + getBorderValue(config.variant) + ';' +
            'min-height: 300px;' +
            'text-align: ' + config.alignment + ';'
        );
        
        if (config.separators === 'top' || config.separators === 'both') {
            styles += 'border-top: 1px solid ' + tokens.get('colors.border.light') + ';';
        }
        if (config.separators === 'bottom' || config.separators === 'both') {
            styles += 'border-bottom: 1px solid ' + tokens.get('colors.border.light') + ';';
        }
        
        return styles;
    }
    
    function getPaddingValue(padding) {
        const paddings = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl'),
            xxxl: tokens.get('spacing.xxxl')
        };
        return paddings[padding] || paddings.lg;
    }
    
    function getMarginValue(margin) {
        const margins = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl')
        };
        return margins[margin] || margins.lg;
    }
    
    function getBorderRadiusValue(borderRadius) {
        const radii = {
            none: '0',
            sm: tokens.get('borderRadius.sm'),
            md: tokens.get('borderRadius.md'),
            lg: tokens.get('borderRadius.lg'),
            xl: tokens.get('borderRadius.xl'),
            full: '9999px'
        };
        return radii[borderRadius] || radii.none;
    }
    
    function getShadowValue(shadow) {
        const shadows = {
            none: 'none',
            sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
            md: '0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)',
            lg: '0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05)',
            xl: '0 20px 25px rgba(0, 0, 0, 0.1), 0 10px 10px rgba(0, 0, 0, 0.04)'
        };
        return shadows[shadow] || shadows.none;
    }
    
    function getBorderValue(variant) {
        if (variant === 'outlined') {
            return '2px solid ' + tokens.get('colors.border.medium');
        } else if (variant === 'elevated') {
            return '1px solid ' + tokens.get('colors.border.light');
        }
        return 'none';
    }
    
    function getBackgroundColor(background, variant) {
        const backgrounds = {
            default: tokens.get('colors.background.primary'),
            primary: tokens.get('colors.primary'),
            secondary: tokens.get('colors.secondary'),
            accent: tokens.get('colors.accent'),
            surface: tokens.get('colors.surface'),
            transparent: 'transparent'
        };
        return backgrounds[background] || backgrounds.default;
    }
    
    function getHeadingColor(variant) {
        const colors = {
            default: tokens.get('colors.text.primary'),
            primary: tokens.get('colors.text.inverse'),
            secondary: tokens.get('colors.text.inverse'),
            accent: tokens.get('colors.text.inverse'),
            muted: tokens.get('colors.text.primary'),
            outlined: tokens.get('colors.text.primary'),
            elevated: tokens.get('colors.text.primary')
        };
        return colors[variant] || colors.default;
    }
    
    function getSubheadingColor(variant) {
        const colors = {
            default: tokens.get('colors.text.secondary'),
            primary: 'rgba(255, 255, 255, 0.9)',
            secondary: 'rgba(255, 255, 255, 0.9)',
            accent: 'rgba(255, 255, 255, 0.9)',
            muted: tokens.get('colors.text.secondary'),
            outlined: tokens.get('colors.text.secondary'),
            elevated: tokens.get('colors.text.secondary')
        };
        return colors[variant] || colors.default;
    }
    
    function getDescriptionColor(variant) {
        const colors = {
            default: tokens.get('colors.text.secondary'),
            primary: 'rgba(255, 255, 255, 0.8)',
            secondary: 'rgba(255, 255, 255, 0.8)',
            accent: 'rgba(255, 255, 255, 0.8)',
            muted: tokens.get('colors.text.secondary'),
            outlined: tokens.get('colors.text.secondary'),
            elevated: tokens.get('colors.text.secondary')
        };
        return colors[variant] || colors.default;
    }
    
    // Add to DOM
    document.body.appendChild(sectionElement);
    
    // Animate in
    requestAnimationFrame(() => {
        sectionElement.style.opacity = '1';
        sectionElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!sectionElement.contains(e.target)) {
                closeSection();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeSection();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeSection() {
        sectionElement.style.opacity = '0';
        sectionElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (sectionElement.parentNode) {
                sectionElement.parentNode.removeChild(sectionElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.variant} section displayed`, 'info');
}

function createDemoPanel(type, triggerButton, toastManager) {
    // Define tokens for demo use
    const tokens = {
        get: (path) => {
            const paths = path.split('.');
            const values = {
                'spacing.sm': '8px',
                'spacing.md': '16px',
                'spacing.lg': '24px',
                'spacing.xl': '32px',
                'spacing.xxxl': '48px',
                'borderRadius.sm': '4px',
                'borderRadius.md': '8px',
                'borderRadius.lg': '12px',
                'borderRadius.xl': '16px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontWeights.normal': '400',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600',
                'colors.background.primary': '#ffffff',
                'colors.background.secondary': '#f8fafc',
                'colors.primary': '#3b82f6',
                'colors.secondary': '#64748b',
                'colors.accent': '#8b5cf6',
                'colors.text.primary': '#1e293b',
                'colors.text.secondary': '#64748b',
                'colors.text.inverse': '#ffffff',
                'colors.border.light': '#e2e8f0',
                'colors.border.medium': '#cbd5e1',
                'colors.border.dark': '#94a3b8',
                'colors.surface': '#f1f5f9'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const panelConfigs = {
        default: {
            variant: 'default',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            title: 'Default Panel',
            subtitle: 'Standard panel layout',
            showHeader: true,
            showFooter: false,
            showActions: false,
            title: 'Default Panel'
        },
        card: {
            variant: 'card',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            shadow: 'sm',
            borderRadius: 'md',
            title: 'Card Panel',
            subtitle: 'Card-style panel with shadow',
            showHeader: true,
            showFooter: true,
            footerContent: 'Card footer content',
            showActions: true,
            title: 'Card Panel'
        },
        elevated: {
            variant: 'elevated',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            shadow: 'md',
            borderRadius: 'lg',
            hoverable: true,
            title: 'Elevated Panel',
            subtitle: 'Panel with elevated shadow effect',
            showHeader: true,
            showFooter: false,
            showActions: true,
            title: 'Elevated Panel'
        },
        outlined: {
            variant: 'outlined',
            size: 'md',
            padding: 'md',
            background: 'transparent',
            borderRadius: 'md',
            title: 'Outlined Panel',
            subtitle: 'Panel with outlined border',
            showHeader: true,
            showFooter: false,
            showActions: false,
            title: 'Outlined Panel'
        },
        glass: {
            variant: 'glass',
            size: 'md',
            padding: 'lg',
            background: 'transparent',
            borderRadius: 'lg',
            hoverable: true,
            title: 'Glass Panel',
            subtitle: 'Panel with glassmorphism effect',
            showHeader: true,
            showFooter: false,
            showActions: true,
            title: 'Glass Panel'
        },
        sidebar: {
            variant: 'outlined',
            size: 'sm',
            padding: 'md',
            background: 'primary',
            borderRadius: 'sm',
            display: 'flex',
            flexDirection: 'column',
            gap: 'sm',
            title: 'Sidebar Panel',
            subtitle: 'Navigation panel',
            showHeader: true,
            showFooter: false,
            showActions: false,
            title: 'Sidebar Panel'
        },
        collapsible: {
            variant: 'card',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            shadow: 'sm',
            borderRadius: 'md',
            collapsible: true,
            collapsed: false,
            title: 'Collapsible Panel',
            subtitle: 'Panel with collapse functionality',
            showHeader: true,
            showFooter: false,
            showActions: true,
            title: 'Collapsible Panel'
        },
        dashboard: {
            variant: 'elevated',
            size: 'lg',
            padding: 'lg',
            background: 'primary',
            shadow: 'md',
            borderRadius: 'lg',
            display: 'grid',
            gap: 'lg',
            title: 'Dashboard Panel',
            subtitle: 'Grid-based dashboard layout',
            showHeader: true,
            showFooter: true,
            footerContent: 'Last updated: Just now',
            showActions: true,
            title: 'Dashboard Panel'
        }
    };
    
    const config = panelConfigs[type] || panelConfigs.default;
    
    // Create panel as a simple DOM element for demo
    const panelElement = document.createElement('div');
    panelElement.className = 'plauna-demo-panel';
    panelElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 32px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 600px;' +
        'max-width: 800px;' +
        'display: flex;' +
        'flex-direction: column;' +
        'gap: 24px;'
    );
    
    // Create title
    const title = document.createElement('div');
    title.textContent = 'Panel Layout Demo';
    title.style.cssText = (
        'font-size: 18px;' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: #e4e4e7;' +
        'text-align: center;' +
        'margin-bottom: 8px;'
    );
    panelElement.appendChild(title);
    
    // Create demo panel
    const demoPanel = document.createElement('div');
    demoPanel.style.cssText = getPanelStyles(config);
    
    // Add header if needed
    if (config.showHeader && (config.title || config.subtitle || config.showActions)) {
        const header = document.createElement('div');
        header.style.cssText = (
            'display: flex;' +
            'justify-content: space-between;' +
            'align-items: flex-start;' +
            'gap: ' + tokens.get('spacing.md') + ';' +
            'margin-bottom: ' + tokens.get('spacing.lg') + ';'
        );
        
        // Create title section
        const titleSection = document.createElement('div');
        titleSection.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'flex: 1;'
        );
        
        // Add title
        if (config.title) {
            const titleElement = document.createElement('h3');
            titleElement.textContent = config.title;
            titleElement.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.lg') + ';' +
                'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
                'color: ' + getPanelTextColor(config.variant, config.background) + ';' +
                'margin: 0;' +
                'line-height: 1.2;'
            );
            titleSection.appendChild(titleElement);
        }
        
        // Add subtitle
        if (config.subtitle) {
            const subtitleElement = document.createElement('p');
            subtitleElement.textContent = config.subtitle;
            subtitleElement.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.normal') + ';' +
                'color: ' + tokens.get('colors.text.secondary') + ';' +
                'margin: 0;' +
                'line-height: 1.4;'
            );
            titleSection.appendChild(subtitleElement);
        }
        
        header.appendChild(titleSection);
        
        // Add actions if needed
        if (config.showActions) {
            const actionsSection = document.createElement('div');
            actionsSection.style.cssText = (
                'display: flex;' +
                'gap: ' + tokens.get('spacing.sm') + ';' +
                'align-items: center;'
            );
            
            const actionButton1 = document.createElement('button');
            actionButton1.textContent = 'Edit';
            actionButton1.style.cssText = (
                'padding: ' + tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm') + ';' +
                'background: transparent;' +
                'color: ' + tokens.get('colors.text.secondary') + ';' +
                'border: 1px solid ' + tokens.get('colors.border.medium') + ';' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'cursor: pointer;' +
                'transition: all 150ms ease;'
            );
            
            actionButton1.addEventListener('click', () => {
                toastManager.show('Edit action clicked', 'info');
            });
            
            const actionButton2 = document.createElement('button');
            actionButton2.textContent = 'Delete';
            actionButton2.style.cssText = (
                'padding: ' + tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm') + ';' +
                'background: ' + tokens.get('colors.primary') + ';' +
                'color: ' + tokens.get('colors.text.inverse') + ';' +
                'border: 1px solid ' + tokens.get('colors.primary') + ';' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'cursor: pointer;' +
                'transition: all 150ms ease;'
            );
            
            actionButton2.addEventListener('click', () => {
                toastManager.show('Delete action clicked', 'warning');
            });
            
            actionsSection.appendChild(actionButton1);
            actionsSection.appendChild(actionButton2);
            header.appendChild(actionsSection);
        }
        
        // Add collapse toggle if collapsible
        if (config.collapsible) {
            const collapseToggle = document.createElement('button');
            collapseToggle.textContent = config.collapsed ? '▼' : '▲';
            collapseToggle.style.cssText = (
                'background: transparent;' +
                'border: none;' +
                'color: ' + tokens.get('colors.text.secondary') + ';' +
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'cursor: pointer;' +
                'padding: ' + tokens.get('spacing.xs') + ';' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'transition: all 150ms ease;'
            );
            
            collapseToggle.addEventListener('click', () => {
                config.collapsed = !config.collapsed;
                collapseToggle.textContent = config.collapsed ? '▼' : '▲';
                main.style.display = config.collapsed ? 'none' : '';
                toastManager.show('Panel ' + (config.collapsed ? 'collapsed' : 'expanded'), 'info');
            });
            
            header.appendChild(collapseToggle);
        }
        
        demoPanel.appendChild(header);
    }
    
    // Add main content area
    const main = document.createElement('div');
    main.style.cssText = (
        'flex: 1;' +
        'display: ' + (config.display === 'grid' ? 'grid' : 'flex') + ';' +
        (config.display === 'grid' ? 
            'grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));' :
            'flex-direction: ' + (config.flexDirection || 'column') + ';') +
        'gap: ' + tokens.get('spacing.md') + ';'
    );
    
    // Add sample content
    const contentItems = [
        { text: 'Panel Content 1', background: tokens.get('colors.primary') },
        { text: 'Panel Content 2', background: tokens.get('colors.secondary') },
        { text: 'Panel Content 3', background: tokens.get('colors.accent') }
    ];
    
    contentItems.forEach(item => {
        const contentItem = document.createElement('div');
        contentItem.textContent = item.text;
        contentItem.style.cssText = (
            'padding: ' + tokens.get('spacing.md') + ';' +
            'background: ' + item.background + ';' +
            'color: white;' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'text-align: center;' +
            'min-height: 60px;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;'
        );
        main.appendChild(contentItem);
    });
    
    demoPanel.appendChild(main);
    
    // Add footer if needed
    if (config.showFooter && config.footerContent) {
        const footer = document.createElement('div');
        footer.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: flex-start;' +
            'margin-top: ' + tokens.get('spacing.lg') + ';' +
            'padding-top: ' + tokens.get('spacing.md') + ';' +
            'border-top: 1px solid ' + tokens.get('colors.border.light') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';'
        );
        footer.textContent = config.footerContent;
        demoPanel.appendChild(footer);
    }
    
    panelElement.appendChild(demoPanel);
    
    // Add hover effect if hoverable
    if (config.hoverable) {
        demoPanel.addEventListener('mouseenter', () => {
            demoPanel.style.transform = 'translateY(-2px)';
            demoPanel.style.boxShadow = getEnhancedShadow(config.shadow || 'none');
        });
        
        demoPanel.addEventListener('mouseleave', () => {
            demoPanel.style.transform = 'translateY(0)';
            demoPanel.style.boxShadow = getShadowValue(config.shadow || 'none');
        });
    }
    
    // Create controls
    const controls = document.createElement('div');
    controls.style.cssText = (
        'display: flex;' +
        'justify-content: center;' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'padding-top: ' + tokens.get('spacing.lg') + ';' +
        'border-top: 1px solid rgba(99, 116, 141, 0.3);'
    );
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = (
        'background: transparent;' +
        'color: #94a3b8;' +
        'border: 1px solid #475569;' +
        'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
        'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
        'font-size: ' + tokens.get('fontSizes.sm') + ';' +
        'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
        'cursor: pointer;' +
        'transition: all 150ms ease;'
    );
    
    closeButton.addEventListener('click', closePanel);
    
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.background = 'rgba(255, 255, 255, 0.1)';
        closeButton.style.color = '#e4e4e7';
    });
    
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.background = 'transparent';
        closeButton.style.color = '#94a3b8';
    });
    
    controls.appendChild(closeButton);
    panelElement.appendChild(controls);
    
    // Helper function for panel styles
    function getPanelStyles(config) {
        let styles = (
            'display: ' + (config.display || 'block') + ';' +
            'flex-direction: ' + (config.flexDirection || 'column') + ';' +
            'padding: ' + getPaddingValue(config.padding) + ';' +
            'margin: ' + getMarginValue(config.margin || 'none') + ';' +
            'background: ' + getBackgroundColor(config.background, config.variant) + ';' +
            'border-radius: ' + getBorderRadiusValue(config.borderRadius || 'md') + ';' +
            'box-shadow: ' + getShadowValue(config.shadow || 'none') + ';' +
            'border: ' + getBorderValue(config.variant) + ';' +
            'min-height: 250px;' +
            'text-align: left;'
        );
        
        return styles;
    }
    
    function getPaddingValue(padding) {
        const paddings = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl'),
            xxxl: tokens.get('spacing.xxxl')
        };
        return paddings[padding] || paddings.lg;
    }
    
    function getMarginValue(margin) {
        const margins = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl')
        };
        return margins[margin] || margins.none;
    }
    
    function getBorderRadiusValue(borderRadius) {
        const radii = {
            none: '0',
            sm: tokens.get('borderRadius.sm'),
            md: tokens.get('borderRadius.md'),
            lg: tokens.get('borderRadius.lg'),
            xl: tokens.get('borderRadius.xl'),
            full: '9999px'
        };
        return radii[borderRadius] || radii.md;
    }
    
    function getShadowValue(shadow) {
        const shadows = {
            none: 'none',
            sm: '0 1px 3px rgba(0, 0, 0, 0.1)',
            md: '0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)',
            lg: '0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05)',
            xl: '0 20px 25px rgba(0, 0, 0, 0.1), 0 10px 10px rgba(0, 0, 0, 0.04)'
        };
        return shadows[shadow] || shadows.none;
    }
    
    function getEnhancedShadow(shadow) {
        const baseShadow = getShadowValue(shadow);
        if (baseShadow === 'none') {
            return '0 4px 6px rgba(0, 0, 0, 0.1)';
        }
        return baseShadow.replace('0.1', '0.15').replace('0.05', '0.08');
    }
    
    function getBorderValue(variant) {
        if (variant === 'outlined') {
            return '2px solid ' + tokens.get('colors.border.medium');
        } else if (variant === 'glass') {
            return '1px solid rgba(255, 255, 255, 0.2)';
        } else if (variant === 'card') {
            return '1px solid ' + tokens.get('colors.border.light');
        } else if (variant === 'bordered') {
            return '2px solid ' + tokens.get('colors.border.medium');
        }
        return 'none';
    }
    
    function getBackgroundColor(background, variant) {
        const backgrounds = {
            default: tokens.get('colors.background.primary'),
            primary: tokens.get('colors.primary'),
            secondary: tokens.get('colors.secondary'),
            accent: tokens.get('colors.accent'),
            surface: tokens.get('colors.surface'),
            transparent: 'transparent'
        };
        return backgrounds[background] || backgrounds.default;
    }
    
    function getPanelTextColor(variant, background) {
        const colors = {
            default: tokens.get('colors.text.primary'),
            card: tokens.get('colors.text.primary'),
            elevated: tokens.get('colors.text.primary'),
            outlined: tokens.get('colors.text.primary'),
            filled: tokens.get('colors.text.primary'),
            glass: tokens.get('colors.text.primary'),
            bordered: tokens.get('colors.text.primary')
        };
        return colors[variant] || colors.default;
    }
    
    // Add to DOM
    document.body.appendChild(panelElement);
    
    // Animate in
    requestAnimationFrame(() => {
        panelElement.style.opacity = '1';
        panelElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!panelElement.contains(e.target)) {
                closePanel();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closePanel();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closePanel() {
        panelElement.style.opacity = '0';
        panelElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (panelElement.parentNode) {
                panelElement.parentNode.removeChild(panelElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.variant} panel displayed`, 'info');
}

function createDemoCollapse(type, triggerButton, toastManager) {
    // Define tokens for demo use
    const tokens = {
        get: (path) => {
            const paths = path.split('.');
            const values = {
                'spacing.sm': '8px',
                'spacing.md': '16px',
                'spacing.lg': '24px',
                'spacing.xl': '32px',
                'spacing.xxxl': '48px',
                'borderRadius.sm': '4px',
                'borderRadius.md': '8px',
                'borderRadius.lg': '12px',
                'borderRadius.xl': '16px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontWeights.normal': '400',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600',
                'colors.background.primary': '#ffffff',
                'colors.background.secondary': '#f8fafc',
                'colors.primary': '#3b82f6',
                'colors.secondary': '#64748b',
                'colors.accent': '#8b5cf6',
                'colors.text.primary': '#1e293b',
                'colors.text.secondary': '#64748b',
                'colors.text.inverse': '#ffffff',
                'colors.border.light': '#e2e8f0',
                'colors.border.medium': '#cbd5e1',
                'colors.border.dark': '#94a3b8',
                'colors.surface': '#f1f5f9'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const collapseConfigs = {
        default: {
            variant: 'default',
            size: 'md',
            padding: 'md',
            background: 'primary',
            collapsed: false,
            animationDuration: '300ms',
            showIcon: true,
            iconPosition: 'right',
            title: 'Default Collapse',
            subtitle: 'Click to expand/collapse',
            showHeader: true,
            showFooter: false,
            title: 'Default Collapse'
        },
        card: {
            variant: 'card',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            collapsed: false,
            animationDuration: '250ms',
            showIcon: true,
            iconPosition: 'right',
            title: 'Card Collapse',
            subtitle: 'Card-style collapsible content',
            showHeader: true,
            showFooter: true,
            footerContent: 'Footer content here',
            title: 'Card Collapse'
        },
        outlined: {
            variant: 'outlined',
            size: 'md',
            padding: 'lg',
            background: 'transparent',
            collapsed: false,
            animationDuration: '300ms',
            showIcon: true,
            iconPosition: 'right',
            title: 'Outlined Collapse',
            subtitle: 'Outlined border style',
            showHeader: true,
            showFooter: false,
            title: 'Outlined Collapse'
        },
        accordion: {
            variant: 'bordered',
            size: 'md',
            padding: 'md',
            background: 'primary',
            collapsed: false,
            animationDuration: '200ms',
            showIcon: true,
            iconPosition: 'right',
            title: 'Accordion Item',
            subtitle: 'Accordion-style collapse',
            showHeader: true,
            showFooter: false,
            border: 'bottom',
            title: 'Accordion Item'
        },
        faq: {
            variant: 'outlined',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            collapsed: true,
            animationDuration: '300ms',
            showIcon: true,
            iconPosition: 'right',
            title: 'FAQ Collapse',
            subtitle: 'Frequently asked question',
            showHeader: true,
            showFooter: false,
            title: 'FAQ Collapse'
        },
        sidebar: {
            variant: 'ghost',
            size: 'sm',
            padding: 'md',
            background: 'primary',
            collapsed: false,
            animationDuration: '200ms',
            showIcon: true,
            iconPosition: 'left',
            title: 'Sidebar Collapse',
            subtitle: 'Sidebar navigation item',
            showHeader: true,
            showFooter: false,
            title: 'Sidebar Collapse'
        },
        nested: {
            variant: 'bordered',
            size: 'sm',
            padding: 'md',
            background: 'primary',
            collapsed: false,
            animationDuration: '250ms',
            showIcon: true,
            iconPosition: 'right',
            title: 'Nested Collapse',
            subtitle: 'Nested content with accent border',
            showHeader: true,
            showFooter: false,
            border: 'left',
            borderWidth: '3px',
            title: 'Nested Collapse'
        },
        animated: {
            variant: 'card',
            size: 'lg',
            padding: 'xl',
            background: 'primary',
            collapsed: false,
            animationDuration: '400ms',
            animationEasing: 'ease-in-out',
            showIcon: true,
            iconPosition: 'right',
            title: 'Animated Collapse',
            subtitle: 'Slow animation with easing',
            showHeader: true,
            showFooter: true,
            footerContent: 'Animation duration: 400ms',
            title: 'Animated Collapse'
        }
    };
    
    const config = collapseConfigs[type] || collapseConfigs.default;
    
    // Create collapse as a simple DOM element for demo
    const collapseElement = document.createElement('div');
    collapseElement.className = 'plauna-demo-collapse';
    collapseElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 32px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 600px;' +
        'max-width: 800px;' +
        'display: flex;' +
        'flex-direction: column;' +
        'gap: 24px;'
    );
    
    // Create title
    const title = document.createElement('div');
    title.textContent = 'Collapse Layout Demo';
    title.style.cssText = (
        'font-size: 18px;' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: #e4e4e7;' +
        'text-align: center;' +
        'margin-bottom: 8px;'
    );
    collapseElement.appendChild(title);
    
    // Create demo collapse
    const demoCollapse = document.createElement('div');
    demoCollapse.style.cssText = getCollapseStyles(config);
    demoCollapse.setAttribute('aria-expanded', (!config.collapsed).toString());
    demoCollapse.setAttribute('aria-controls', 'demo-collapse-content');
    
    // Add header if needed
    if (config.showHeader && (config.title || config.subtitle)) {
        const header = document.createElement('div');
        header.className = 'plauna-collapse__header';
        header.id = 'demo-collapse-header';
        header.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: space-between;' +
            'gap: ' + tokens.get('spacing.md') + ';' +
            'padding: ' + getPaddingValue(config.padding) + ';' +
            'cursor: pointer;' +
            'user-select: none;'
        );
        
        // Create title section
        const titleSection = document.createElement('div');
        titleSection.className = 'plauna-collapse__title-section';
        titleSection.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'flex: 1;'
        );
        
        // Add icon if positioned on left
        if (config.showIcon && config.iconPosition === 'left') {
            const icon = createIcon(config.collapsed, config.iconCollapsed, config.iconExpanded);
            titleSection.appendChild(icon);
        }
        
        // Add title
        if (config.title) {
            const titleElement = document.createElement('h3');
            titleElement.textContent = config.title;
            titleElement.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.lg') + ';' +
                'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
                'color: ' + getCollapseTextColor(config.variant, config.background) + ';' +
                'margin: 0;' +
                'line-height: 1.2;'
            );
            titleSection.appendChild(titleElement);
        }
        
        // Add subtitle
        if (config.subtitle) {
            const subtitleElement = document.createElement('p');
            subtitleElement.textContent = config.subtitle;
            subtitleElement.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.normal') + ';' +
                'color: ' + tokens.get('colors.text.secondary') + ';' +
                'margin: 0;' +
                'line-height: 1.4;'
            );
            titleSection.appendChild(subtitleElement);
        }
        
        header.appendChild(titleSection);
        
        // Add icon if positioned on right
        if (config.showIcon && config.iconPosition === 'right') {
            const icon = createIcon(config.collapsed, config.iconCollapsed, config.iconExpanded);
            header.appendChild(icon);
        }
        
        // Add click handler to header
        header.addEventListener('click', () => {
            toggleCollapse();
        });
        
        demoCollapse.appendChild(header);
    }
    
    // Create content container
    const contentContainer = document.createElement('div');
    contentContainer.className = 'plauna-collapse__content-container';
    contentContainer.id = 'demo-collapse-content';
    contentContainer.setAttribute('role', 'region');
    contentContainer.setAttribute('aria-labelledby', 'demo-collapse-header');
    contentContainer.style.cssText = (
        'overflow: hidden;' +
        'transition: max-height ' + config.animationDuration + ' ' + config.animationEasing + ', opacity ' + config.animationDuration + ' ' + config.animationEasing + ';' +
        'max-height: ' + (config.collapsed ? '0px' : '500px') + ';' +
        'opacity: ' + (config.collapsed ? '0' : '1') + ';'
    );
    
    // Create content area
    const content = document.createElement('div');
    content.className = 'plauna-collapse__content';
    content.style.cssText = (
        'padding: ' + (config.showHeader ? '0' : getPaddingValue(config.padding)) + ';' +
        'padding-top: ' + (config.showHeader ? '0' : getPaddingValue(config.padding)) + ';'
    );
    
    // Add sample content
    const contentItems = [
        { text: 'Collapsible Content 1', background: tokens.get('colors.primary') },
        { text: 'Collapsible Content 2', background: tokens.get('colors.secondary') },
        { text: 'Collapsible Content 3', background: tokens.get('colors.accent') }
    ];
    
    contentItems.forEach(item => {
        const contentItem = document.createElement('div');
        contentItem.textContent = item.text;
        contentItem.style.cssText = (
            'padding: ' + tokens.get('spacing.md') + ';' +
            'background: ' + item.background + ';' +
            'color: white;' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'text-align: center;' +
            'min-height: 60px;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'margin-bottom: ' + tokens.get('spacing.sm') + ';'
        );
        content.appendChild(contentItem);
    });
    
    contentContainer.appendChild(content);
    demoCollapse.appendChild(contentContainer);
    
    // Add footer if needed
    if (config.showFooter && config.footerContent) {
        const footer = document.createElement('div');
        footer.className = 'plauna-collapse__footer';
        footer.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: flex-start;' +
            'padding: ' + getPaddingValue(config.padding) + ';' +
            'padding-top: 0;' +
            'border-top: 1px solid ' + tokens.get('colors.border.light') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';'
        );
        footer.textContent = config.footerContent;
        demoCollapse.appendChild(footer);
    }
    
    collapseElement.appendChild(demoCollapse);
    
    // Helper function to create icon
    function createIcon(collapsed, iconCollapsed, iconExpanded) {
        const icon = document.createElement('div');
        icon.className = 'plauna-collapse__icon';
        icon.textContent = collapsed ? iconCollapsed : iconExpanded;
        icon.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'width: 20px;' +
            'height: 20px;' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'transition: transform ' + config.animationDuration + ' ' + config.animationEasing + ';' +
            'transform: rotate(' + (collapsed ? '0deg' : '180deg') + ');'
        );
        return icon;
    }
    
    // Toggle function
    function toggleCollapse() {
        config.collapsed = !config.collapsed;
        demoCollapse.setAttribute('aria-expanded', (!config.collapsed).toString());
        
        // Update content container
        if (contentContainer) {
            if (config.collapsed) {
                contentContainer.style.maxHeight = '0px';
                contentContainer.style.opacity = '0';
            } else {
                // Get the actual height
                const contentHeight = contentContainer.scrollHeight;
                contentContainer.style.maxHeight = contentHeight + 'px';
                contentContainer.style.opacity = '1';
                
                // Reset max-height after animation
                setTimeout(() => {
                    if (!config.collapsed) {
                        contentContainer.style.maxHeight = 'none';
                    }
                }, parseFloat(config.animationDuration));
            }
        }
        
        // Update icon
        const icon = demoCollapse.querySelector('.plauna-collapse__icon');
        if (icon) {
            icon.textContent = config.collapsed ? config.iconCollapsed : config.iconExpanded;
            icon.style.transform = 'rotate(' + (config.collapsed ? '0deg' : '180deg') + ')';
        }
        
        toastManager.show('Collapse ' + (config.collapsed ? 'collapsed' : 'expanded'), 'info');
    }
    
    // Create controls
    const controls = document.createElement('div');
    controls.style.cssText = (
        'display: flex;' +
        'justify-content: center;' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'padding-top: ' + tokens.get('spacing.lg') + ';' +
        'border-top: 1px solid rgba(99, 116, 141, 0.3);'
    );
    
    const toggleButton = document.createElement('button');
    toggleButton.textContent = config.collapsed ? 'Expand' : 'Collapse';
    toggleButton.style.cssText = (
        'background: ' + tokens.get('colors.primary') + ';' +
        'color: ' + tokens.get('colors.text.inverse') + ';' +
        'border: 1px solid ' + tokens.get('colors.primary') + ';' +
        'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
        'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
        'font-size: ' + tokens.get('fontSizes.sm') + ';' +
        'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
        'cursor: pointer;' +
        'transition: all 150ms ease;'
    );
    
    toggleButton.addEventListener('click', toggleCollapse);
    
    toggleButton.addEventListener('mouseenter', () => {
        toggleButton.style.background = 'rgba(255, 255, 255, 0.1)';
        toggleButton.style.color = tokens.get('colors.primary');
    });
    
    toggleButton.addEventListener('mouseleave', () => {
        toggleButton.style.background = tokens.get('colors.primary');
        toggleButton.style.color = tokens.get('colors.text.inverse');
    });
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = (
        'background: transparent;' +
        'color: #94a3b8;' +
        'border: 1px solid #475569;' +
        'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
        'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
        'font-size: ' + tokens.get('fontSizes.sm') + ';' +
        'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
        'cursor: pointer;' +
        'transition: all 150ms ease;'
    );
    
    closeButton.addEventListener('click', closeCollapse);
    
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.background = 'rgba(255, 255, 255, 0.1)';
        closeButton.style.color = '#e4e4e7';
    });
    
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.background = 'transparent';
        closeButton.style.color = '#94a3b8';
    });
    
    controls.appendChild(toggleButton);
    controls.appendChild(closeButton);
    collapseElement.appendChild(controls);
    
    // Helper function for collapse styles
    function getCollapseStyles(config) {
        let styles = (
            'display: block;' +
            'padding: ' + getPaddingValue(config.padding) + ';' +
            'background: ' + getBackgroundColor(config.background, config.variant) + ';' +
            'border: ' + getBorderValue(config.variant, config.border, config.borderColor, config.borderWidth) + ';' +
            'border-radius: ' + getBorderRadiusValue(config.borderRadius || 'md') + ';' +
            'box-shadow: ' + getShadowValue(config.shadow || 'none') + ';' +
            'overflow: hidden;' +
            'position: relative;' +
            'transition: all ' + config.animationDuration + ' ' + config.animationEasing + ';' +
            'cursor: pointer;' +
            'outline: none;' +
            'box-sizing: border-box;'
        );
        
        return styles;
    }
    
    function getPaddingValue(padding) {
        const paddings = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl'),
            xxxl: tokens.get('spacing.xxxl')
        };
        return paddings[padding] || paddings.md;
    }
    
    function getBorderRadiusValue(borderRadius) {
        const radii = {
            none: '0',
            sm: tokens.get('borderRadius.sm'),
            md: tokens.get('borderRadius.md'),
            lg: tokens.get('borderRadius.lg'),
            xl: tokens.get('borderRadius.xl'),
            full: '9999px'
        };
        return radii[borderRadius] || radii.md;
    }
    
    function getShadowValue(shadow) {
        const shadows = {
            none: 'none',
            sm: '0 1px 3px rgba(0, 0, 0, 0.1)',
            md: '0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)',
            lg: '0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05)',
            xl: '0 20px 25px rgba(0, 0, 0, 0.1), 0 10px 10px rgba(0, 0, 0, 0.04)'
        };
        return shadows[shadow] || shadows.none;
    }
    
    function getBorderValue(variant, border, borderColor, borderWidth) {
        if (border === 'none') {
            return 'none';
        }
        
        const borderColors = {
            light: tokens.get('colors.border.light'),
            medium: tokens.get('colors.border.medium'),
            dark: tokens.get('colors.border.dark')
        };
        
        const color = borderColors[borderColor] || borderColors.medium;
        const width = borderWidth || '1px';
        
        if (border === 'all') {
            return width + ' solid ' + color;
        } else if (border === 'top') {
            return 'border-top: ' + width + ' solid ' + color;
        } else if (border === 'bottom') {
            return 'border-bottom: ' + width + ' solid ' + color;
        } else if (border === 'left') {
            return 'border-left: ' + width + ' solid ' + color;
        } else if (border === 'right') {
            return 'border-right: ' + width + ' solid ' + color;
        }
        
        return 'none';
    }
    
    function getBackgroundColor(background, variant) {
        const backgrounds = {
            default: tokens.get('colors.background.primary'),
            primary: tokens.get('colors.primary'),
            secondary: tokens.get('colors.secondary'),
            accent: tokens.get('colors.accent'),
            surface: tokens.get('colors.surface'),
            transparent: 'transparent'
        };
        return backgrounds[background] || backgrounds.default;
    }
    
    function getCollapseTextColor(variant, background) {
        const colors = {
            default: tokens.get('colors.text.primary'),
            card: tokens.get('colors.text.primary'),
            outlined: tokens.get('colors.text.primary'),
            bordered: tokens.get('colors.text.primary'),
            ghost: tokens.get('colors.text.primary')
        };
        return colors[variant] || colors.default;
    }
    
    // Add to DOM
    document.body.appendChild(collapseElement);
    
    // Animate in
    requestAnimationFrame(() => {
        collapseElement.style.opacity = '1';
        collapseElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!collapseElement.contains(e.target)) {
                closeCollapse();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeCollapse();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeCollapse() {
        collapseElement.style.opacity = '0';
        collapseElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (collapseElement.parentNode) {
                collapseElement.parentNode.removeChild(collapseElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.variant} collapse displayed`, 'info');
}

function createDemoHeaderFooter(type, triggerButton, toastManager) {
    // Define tokens for demo use
    const tokens = {
        get: (path) => {
            const paths = path.split('.');
            const values = {
                'spacing.sm': '8px',
                'spacing.md': '16px',
                'spacing.lg': '24px',
                'spacing.xl': '32px',
                'spacing.xxxl': '48px',
                'borderRadius.sm': '4px',
                'borderRadius.md': '8px',
                'borderRadius.lg': '12px',
                'borderRadius.xl': '16px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontSizes.xl': '20px',
                'fontWeights.normal': '400',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600',
                'colors.background.primary': '#ffffff',
                'colors.background.secondary': '#f8fafc',
                'colors.primary': '#3b82f6',
                'colors.secondary': '#64748b',
                'colors.accent': '#8b5cf6',
                'colors.text.primary': '#1e293b',
                'colors.text.secondary': '#64748b',
                'colors.text.inverse': '#ffffff',
                'colors.border.light': '#e2e8f0',
                'colors.border.medium': '#cbd5e1',
                'colors.border.dark': '#94a3b8',
                'colors.surface': '#f1f5f9'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const headerFooterConfigs = {
        header: {
            type: 'header',
            variant: 'default',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            alignment: 'space-between',
            brand: 'YourBrand',
            navigation: [
                { text: 'Home', href: '#home', active: true },
                { text: 'About', href: '#about' },
                { text: 'Services', href: '#services' },
                { text: 'Contact', href: '#contact' }
            ],
            actions: [
                { text: 'Sign In', variant: 'primary' },
                { text: 'Sign Up' }
            ],
            showBrand: true,
            showNavigation: true,
            showActions: true,
            title: 'Default Header'
        },
        'header-primary': {
            type: 'header',
            variant: 'primary',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            alignment: 'space-between',
            brand: 'YourBrand',
            navigation: [
                { text: 'Dashboard', href: '#dashboard' },
                { text: 'Analytics', href: '#analytics' },
                { text: 'Reports', href: '#reports' }
            ],
            actions: [
                { text: 'Profile', variant: 'primary' }
            ],
            showBrand: true,
            showNavigation: true,
            showActions: true,
            title: 'Primary Header'
        },
        'header-sticky': {
            type: 'header',
            variant: 'sticky',
            size: 'md',
            padding: 'md',
            background: 'primary',
            position: 'sticky',
            alignment: 'space-between',
            brand: 'StickyBrand',
            navigation: [
                { text: 'Products', href: '#products' },
                { text: 'Pricing', href: '#pricing' },
                { text: 'Docs', href: '#docs' }
            ],
            actions: [
                { text: 'Get Started', variant: 'primary' }
            ],
            showBrand: true,
            showNavigation: true,
            showActions: true,
            title: 'Sticky Header'
        },
        'header-elevated': {
            type: 'header',
            variant: 'elevated',
            size: 'lg',
            padding: 'xl',
            background: 'primary',
            alignment: 'space-between',
            brand: 'ElevatedBrand',
            navigation: [
                { text: 'Features', href: '#features' },
                { text: 'Solutions', href: '#solutions' },
                { text: 'Resources', href: '#resources' },
                { text: 'Company', href: '#company' }
            ],
            actions: [
                { text: 'Demo', variant: 'primary' },
                { text: 'Contact Sales' }
            ],
            showBrand: true,
            showNavigation: true,
            showActions: true,
            title: 'Elevated Header'
        },
        footer: {
            type: 'footer',
            variant: 'default',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            alignment: 'space-between',
            navigation: [
                { text: 'Privacy', href: '#privacy' },
                { text: 'Terms', href: '#terms' },
                { text: 'Support', href: '#support' }
            ],
            copyright: '© 2024 Your Company. All rights reserved.',
            showNavigation: true,
            showCopyright: true,
            title: 'Default Footer'
        },
        'footer-primary': {
            type: 'footer',
            variant: 'primary',
            size: 'lg',
            padding: 'xl',
            background: 'primary',
            alignment: 'space-between',
            navigation: [
                { text: 'About Us', href: '#about' },
                { text: 'Careers', href: '#careers' },
                { text: 'Press', href: '#press' },
                { text: 'Blog', href: '#blog' },
                { text: 'Contact', href: '#contact' }
            ],
            copyright: '© 2024 Your Company. All rights reserved.',
            showNavigation: true,
            showCopyright: true,
            title: 'Primary Footer'
        },
        'footer-secondary': {
            type: 'footer',
            variant: 'secondary',
            size: 'md',
            padding: 'lg',
            background: 'secondary',
            alignment: 'space-between',
            navigation: [
                { text: 'Documentation', href: '#docs' },
                { text: 'API', href: '#api' },
                { text: 'Community', href: '#community' }
            ],
            copyright: '© 2024 Your Company. All rights reserved.',
            showNavigation: true,
            showCopyright: true,
            title: 'Secondary Footer'
        },
        'footer-outlined': {
            type: 'footer',
            variant: 'outlined',
            size: 'md',
            padding: 'lg',
            background: 'transparent',
            alignment: 'space-between',
            navigation: [
                { text: 'Resources', href: '#resources' },
                { text: 'Tools', href: '#tools' },
                { text: 'Guides', href: '#guides' }
            ],
            copyright: '© 2024 Your Company. All rights reserved.',
            showNavigation: true,
            showCopyright: true,
            title: 'Outlined Footer'
        }
    };
    
    const config = headerFooterConfigs[type] || headerFooterConfigs.header;
    
    // Create header/footer as a simple DOM element for demo
    const headerFooterElement = document.createElement('div');
    headerFooterElement.className = 'plauna-demo-headerfooter';
    headerFooterElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 32px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 700px;' +
        'max-width: 900px;' +
        'display: flex;' +
        'flex-direction: column;' +
        'gap: 24px;'
    );
    
    // Create title
    const title = document.createElement('div');
    title.textContent = `${config.type === 'header' ? 'Header' : 'Footer'} Layout Demo`;
    title.style.cssText = (
        'font-size: 18px;' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: #e4e4e7;' +
        'text-align: center;' +
        'margin-bottom: 8px;'
    );
    headerFooterElement.appendChild(title);
    
    // Create demo header/footer
    const demoHeaderFooter = document.createElement('div');
    demoHeaderFooter.style.cssText = getHeaderFooterStyles(config);
    demoHeaderFooter.setAttribute('role', config.type === 'header' ? 'banner' : 'contentinfo');
    
    // Create main content container
    const main = document.createElement('div');
    main.className = 'plauna-header-footer__main';
    main.style.cssText = (
        'display: ' + (config.display || 'flex') + ';' +
        'flex-direction: ' + (config.flexDirection || 'row') + ';' +
        'justify-content: ' + (config.alignment === 'space-between' ? 'space-between' : config.alignment === 'center' ? 'center' : config.alignment === 'right' ? 'flex-end' : 'flex-start') + ';' +
        'align-items: ' + (config.alignItems || 'center') + ';' +
        'gap: ' + tokens.get('spacing.lg') + ';' +
        'width: 100%;'
    );
    
    // Add brand if needed
    if (config.showBrand && config.brand) {
        const brandSection = document.createElement('div');
        brandSection.className = 'plauna-header-footer__brand';
        brandSection.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.sm') + ';'
        );
        
        const brandElement = document.createElement('div');
        brandElement.className = 'plauna-header-footer__brand-element';
        brandElement.textContent = typeof config.brand === 'string' ? config.brand : config.brand.text || '';
        brandElement.style.cssText = (
            'font-size: ' + tokens.get('fontSizes.lg') + ';' +
            'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
            'color: ' + getHeaderFooterTextColor(config.variant, config.background) + ';' +
            'text-decoration: none;' +
            'line-height: 1.2;' +
            'cursor: pointer;'
        );
        
        brandElement.addEventListener('click', () => {
            toastManager.show('Brand clicked', 'info');
        });
        
        brandSection.appendChild(brandElement);
        main.appendChild(brandSection);
    }
    
    // Add navigation if needed
    if (config.showNavigation && config.navigation.length > 0) {
        const navSection = document.createElement('nav');
        navSection.className = 'plauna-header-footer__navigation';
        navSection.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.lg') + ';'
        );
        
        config.navigation.forEach((item, index) => {
            const navItem = document.createElement('a');
            navItem.className = 'plauna-header-footer__nav-item';
            navItem.textContent = item.text || '';
            navItem.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'color: ' + getHeaderFooterTextColor(config.variant, config.background) + ';' +
                'text-decoration: none;' +
                'padding: ' + tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm') + ';' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'transition: all 150ms ease;' +
                'cursor: pointer;'
            );
            
            if (item.active) {
                navItem.style.background = 'rgba(255, 255, 255, 0.1)';
            }
            
            navItem.addEventListener('click', () => {
                toastManager.show(`Navigation: ${item.text}`, 'info');
            });
            
            navItem.addEventListener('mouseenter', () => {
                if (!item.active) {
                    navItem.style.background = 'rgba(255, 255, 255, 0.1)';
                }
            });
            
            navItem.addEventListener('mouseleave', () => {
                if (!item.active) {
                    navItem.style.background = 'transparent';
                }
            });
            
            navSection.appendChild(navItem);
        });
        
        main.appendChild(navSection);
    }
    
    // Add actions if needed
    if (config.showActions && config.actions.length > 0) {
        const actionsSection = document.createElement('div');
        actionsSection.className = 'plauna-header-footer__actions';
        actionsSection.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.sm') + ';'
        );
        
        config.actions.forEach((action, index) => {
            const actionButton = document.createElement('button');
            actionButton.className = 'plauna-header-footer__action';
            actionButton.textContent = action.text || 'Action';
            actionButton.style.cssText = (
                'padding: ' + tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm') + ';' +
                'background: ' + (action.variant === 'primary' ? tokens.get('colors.primary') : 'transparent') + ';' +
                'color: ' + (action.variant === 'primary' ? tokens.get('colors.text.inverse') : getHeaderFooterTextColor(config.variant, config.background)) + ';' +
                'border: 1px solid ' + (action.variant === 'primary' ? tokens.get('colors.primary') : tokens.get('colors.border.medium')) + ';' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'cursor: pointer;' +
                'transition: all 150ms ease;'
            );
            
            actionButton.addEventListener('click', () => {
                toastManager.show(`Action: ${action.text}`, 'info');
            });
            
            actionButton.addEventListener('mouseenter', () => {
                if (action.variant === 'primary') {
                    actionButton.style.background = 'rgba(255, 255, 255, 0.1)';
                    actionButton.style.color = tokens.get('colors.primary');
                } else {
                    actionButton.style.background = 'rgba(255, 255, 255, 0.1)';
                    actionButton.style.color = getHeaderFooterTextColor(config.variant, config.background);
                }
            });
            
            actionButton.addEventListener('mouseleave', () => {
                if (action.variant === 'primary') {
                    actionButton.style.background = tokens.get('colors.primary');
                    actionButton.style.color = tokens.get('colors.text.inverse');
                } else {
                    actionButton.style.background = 'transparent';
                    actionButton.style.color = getHeaderFooterTextColor(config.variant, config.background);
                }
            });
            
            actionsSection.appendChild(actionButton);
        });
        
        main.appendChild(actionsSection);
    }
    
    demoHeaderFooter.appendChild(main);
    
    // Add copyright if needed (footer only)
    if (config.type === 'footer' && config.showCopyright && config.copyright) {
        const copyrightSection = document.createElement('div');
        copyrightSection.className = 'plauna-header-footer__copyright';
        copyrightSection.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'font-size: ' + tokens.get('fontSizes.xs') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'line-height: 1.4;' +
            'margin-top: ' + tokens.get('spacing.md') + ';' +
            'padding-top: ' + tokens.get('spacing.md') + ';' +
            'border-top: 1px solid ' + tokens.get('colors.border.light') + ';'
        );
        copyrightSection.textContent = config.copyright;
        demoHeaderFooter.appendChild(copyrightSection);
    }
    
    headerFooterElement.appendChild(demoHeaderFooter);
    
    // Create controls
    const controls = document.createElement('div');
    controls.style.cssText = (
        'display: flex;' +
        'justify-content: center;' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'padding-top: ' + tokens.get('spacing.lg') + ';' +
        'border-top: 1px solid rgba(99, 116, 141, 0.3);'
    );
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = (
        'background: transparent;' +
        'color: #94a3b8;' +
        'border: 1px solid #475569;' +
        'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
        'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
        'font-size: ' + tokens.get('fontSizes.sm') + ';' +
        'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
        'cursor: pointer;' +
        'transition: all 150ms ease;'
    );
    
    closeButton.addEventListener('click', closeHeaderFooter);
    
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.background = 'rgba(255, 255, 255, 0.1)';
        closeButton.style.color = '#e4e4e7';
    });
    
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.background = 'transparent';
        closeButton.style.color = '#94a3b8';
    });
    
    controls.appendChild(closeButton);
    headerFooterElement.appendChild(controls);
    
    // Helper function for header/footer styles
    function getHeaderFooterStyles(config) {
        let styles = (
            'display: ' + (config.display || 'flex') + ';' +
            'flex-direction: ' + (config.flexDirection || 'row') + ';' +
            'justify-content: ' + (config.alignment === 'space-between' ? 'space-between' : config.alignment === 'center' ? 'center' : config.alignment === 'right' ? 'flex-end' : 'flex-start') + ';' +
            'align-items: ' + (config.alignItems || 'center') + ';' +
            'padding: ' + getPaddingValue(config.padding) + ';' +
            'margin: ' + getMarginValue(config.margin || 'none') + ';' +
            'background: ' + getBackgroundColor(config.background, config.variant) + ';' +
            'border: ' + getBorderValue(config.variant, config.border, config.borderColor, config.borderWidth) + ';' +
            'border-radius: ' + getBorderRadiusValue(config.borderRadius || 'none') + ';' +
            'box-shadow: ' + getShadowValue(config.shadow || 'none') + ';' +
            'min-height: ' + (config.type === 'header' ? '56px' : '80px') + ';' +
            'width: 100%;'
        );
        
        return styles;
    }
    
    function getPaddingValue(padding) {
        const paddings = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl'),
            xxxl: tokens.get('spacing.xxxl')
        };
        return paddings[padding] || paddings.lg;
    }
    
    function getMarginValue(margin) {
        const margins = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl')
        };
        return margins[margin] || margins.none;
    }
    
    function getBorderRadiusValue(borderRadius) {
        const radii = {
            none: '0',
            sm: tokens.get('borderRadius.sm'),
            md: tokens.get('borderRadius.md'),
            lg: tokens.get('borderRadius.lg'),
            xl: tokens.get('borderRadius.xl'),
            full: '9999px'
        };
        return radii[borderRadius] || radii.none;
    }
    
    function getShadowValue(shadow) {
        const shadows = {
            none: 'none',
            sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
            md: '0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)',
            lg: '0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05)',
            xl: '0 20px 25px rgba(0, 0, 0, 0.1), 0 10px 10px rgba(0, 0, 0, 0.04)'
        };
        return shadows[shadow] || shadows.none;
    }
    
    function getBorderValue(variant, border, borderColor, borderWidth) {
        if (border === 'none') {
            return 'none';
        }
        
        const borderColors = {
            light: tokens.get('colors.border.light'),
            medium: tokens.get('colors.border.medium'),
            dark: tokens.get('colors.border.dark')
        };
        
        const color = borderColors[borderColor] || borderColors.medium;
        const width = borderWidth || '1px';
        
        if (border === 'all') {
            return width + ' solid ' + color;
        } else if (border === 'top') {
            return 'border-top: ' + width + ' solid ' + color;
        } else if (border === 'bottom') {
            return 'border-bottom: ' + width + ' solid ' + color;
        } else if (border === 'left') {
            return 'border-left: ' + width + ' solid ' + color;
        } else if (border === 'right') {
            return 'border-right: ' + width + ' solid ' + color;
        }
        
        return 'none';
    }
    
    function getBackgroundColor(background, variant) {
        const backgrounds = {
            default: tokens.get('colors.background.primary'),
            primary: tokens.get('colors.primary'),
            secondary: tokens.get('colors.secondary'),
            accent: tokens.get('colors.accent'),
            surface: tokens.get('colors.surface'),
            transparent: 'transparent'
        };
        return backgrounds[background] || backgrounds.default;
    }
    
    function getHeaderFooterTextColor(variant, background) {
        const colors = {
            default: tokens.get('colors.text.primary'),
            primary: tokens.get('colors.text.inverse'),
            secondary: tokens.get('colors.text.inverse'),
            accent: tokens.get('colors.text.inverse'),
            muted: tokens.get('colors.text.primary'),
            outlined: tokens.get('colors.text.primary'),
            elevated: tokens.get('colors.text.primary'),
            sticky: tokens.get('colors.text.primary'),
            fixed: tokens.get('colors.text.primary')
        };
        return colors[variant] || colors.default;
    }
    
    // Add to DOM
    document.body.appendChild(headerFooterElement);
    
    // Animate in
    requestAnimationFrame(() => {
        headerFooterElement.style.opacity = '1';
        headerFooterElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!headerFooterElement.contains(e.target)) {
                closeHeaderFooter();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeHeaderFooter();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeHeaderFooter() {
        headerFooterElement.style.opacity = '0';
        headerFooterElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (headerFooterElement.parentNode) {
                headerFooterElement.parentNode.removeChild(headerFooterElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.variant} ${config.type} displayed`, 'info');
}

function createDemoGrid(type, triggerButton, toastManager) {
    // Define tokens for demo use
    const tokens = {
        get: (path) => {
            const paths = path.split('.');
            const values = {
                'spacing.sm': '8px',
                'spacing.md': '16px',
                'spacing.lg': '24px',
                'spacing.xl': '32px',
                'spacing.xxxl': '48px',
                'borderRadius.sm': '4px',
                'borderRadius.md': '8px',
                'borderRadius.lg': '12px',
                'borderRadius.xl': '16px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontSizes.xl': '20px',
                'fontWeights.normal': '400',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600',
                'colors.background.primary': '#ffffff',
                'colors.background.secondary': '#f8fafc',
                'colors.primary': '#3b82f6',
                'colors.secondary': '#64748b',
                'colors.accent': '#8b5cf6',
                'colors.text.primary': '#1e293b',
                'colors.text.secondary': '#64748b',
                'colors.text.inverse': '#ffffff',
                'colors.border.light': '#e2e8f0',
                'colors.border.medium': '#cbd5e1',
                'colors.border.dark': '#94a3b8',
                'colors.surface': '#f1f5f9'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const gridConfigs = {
        default: {
            columns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 'md',
            autoFlow: 'row',
            justifyContent: 'start',
            alignItems: 'start',
            title: 'Auto-Fit Grid'
        },
        'auto-fill': {
            columns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 'lg',
            autoFlow: 'row',
            justifyContent: 'start',
            alignItems: 'start',
            title: 'Auto-Fill Grid'
        },
        'fixed-columns': {
            columns: 3,
            gap: 'md',
            autoFlow: 'row',
            justifyContent: 'start',
            alignItems: 'start',
            title: 'Fixed Columns Grid'
        },
        'responsive': {
            columns: 1,
            gap: 'md',
            breakpoints: {
                sm: { columns: 2 },
                lg: { columns: 3 },
                xl: { columns: 4 }
            },
            autoFlow: 'row',
            justifyContent: 'start',
            alignItems: 'start',
            title: 'Responsive Grid'
        },
        'masonry': {
            columns: 'auto-fit',
            gap: 'md',
            autoFlow: 'dense',
            justifyContent: 'start',
            alignItems: 'start',
            title: 'Masonry Grid'
        },
        'centered': {
            columns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 'lg',
            autoFlow: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            title: 'Centered Grid'
        },
        'template': {
            templateAreas: [
                'header header header',
                'sidebar main main',
                'footer footer footer'
            ],
            columns: '200px 1fr 200px',
            gap: 'md',
            autoFlow: 'row',
            title: 'Template Areas Grid'
        },
        'mixed-sizes': {
            columns: '2fr 1fr 3fr 1fr',
            gap: 'md',
            autoFlow: 'row',
            justifyContent: 'start',
            alignItems: 'start',
            title: 'Mixed Sizes Grid'
        }
    };
    
    const config = gridConfigs[type] || gridConfigs.default;
    
    // Create grid as a simple DOM element for demo
    const gridElement = document.createElement('div');
    gridElement.className = 'plauna-demo-grid';
    gridElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 32px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 700px;' +
        'max-width: 900px;' +
        'display: flex;' +
        'flex-direction: column;' +
        'gap: 24px;'
    );
    
    // Create title
    const title = document.createElement('div');
    title.textContent = 'Grid Layout Demo';
    title.style.cssText = (
        'font-size: 18px;' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: #e4e4e7;' +
        'text-align: center;' +
        'margin-bottom: 8px;'
    );
    gridElement.appendChild(title);
    
    // Create demo grid
    const demoGrid = document.createElement('div');
    demoGrid.style.cssText = getGridStyles(config);
    demoGrid.setAttribute('role', 'grid');
    
    // Add grid items based on configuration
    const gridItems = generateGridItems(config);
    gridItems.forEach(item => {
        demoGrid.appendChild(item);
    });
    
    gridElement.appendChild(demoGrid);
    
    // Create controls
    const controls = document.createElement('div');
    controls.style.cssText = (
        'display: flex;' +
        'justify-content: center;' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'padding-top: ' + tokens.get('spacing.lg') + ';' +
        'border-top: 1px solid rgba(99, 116, 141, 0.3);'
    );
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = (
        'background: transparent;' +
        'color: #94a3b8;' +
        'border: 1px solid #475569;' +
        'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
        'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
        'font-size: ' + tokens.get('fontSizes.sm') + ';' +
        'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
        'cursor: pointer;' +
        'transition: all 150ms ease;'
    );
    
    closeButton.addEventListener('click', closeGrid);
    
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.background = 'rgba(255, 255, 255, 0.1)';
        closeButton.style.color = '#e4e4e7';
    });
    
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.background = 'transparent';
        closeButton.style.color = '#94a3b8';
    });
    
    controls.appendChild(closeButton);
    gridElement.appendChild(controls);
    
    // Helper function to generate grid items
    function generateGridItems(config) {
        const items = [];
        const colors = [tokens.get('colors.primary'), tokens.get('colors.secondary'), tokens.get('colors.accent')];
        const heights = ['60px', '80px', '100px', '120px', '140px'];
        
        // Determine number of items based on grid configuration
        let itemCount = 8;
        if (config.columns === 3) {
            itemCount = 9;
        } else if (config.columns === '2fr 1fr 3fr 1fr') {
            itemCount = 12;
        } else if (config.templateAreas) {
            itemCount = 5; // header, sidebar, main, main, footer
        }
        
        for (let i = 0; i < itemCount; i++) {
            const item = document.createElement('div');
            item.className = 'plauna-grid-item';
            
            // Set grid area for template grid
            if (config.templateAreas) {
                const areas = ['header', 'sidebar', 'main', 'main', 'footer'];
                if (i < areas.length) {
                    item.style.gridArea = areas[i];
                }
            }
            
            item.style.cssText = (
                'background: ' + colors[i % colors.length] + ';' +
                'color: white;' +
                'border-radius: ' + tokens.get('borderRadius.md') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'display: flex;' +
                'align-items: center;' +
                'justify-content: center;' +
                'min-height: ' + heights[i % heights.length] + ';' +
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'cursor: pointer;' +
                'transition: all 150ms ease;'
            );
            
            item.textContent = `Item ${i + 1}`;
            
            item.addEventListener('click', () => {
                toastManager.show(`Grid item ${i + 1} clicked`, 'info');
            });
            
            item.addEventListener('mouseenter', () => {
                item.style.transform = 'scale(1.05)';
                item.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
            });
            
            item.addEventListener('mouseleave', () => {
                item.style.transform = 'scale(1)';
                item.style.boxShadow = 'none';
            });
            
            items.push(item);
        }
        
        return items;
    }
    
    // Helper function for grid styles
    function getGridStyles(config) {
        let styles = (
            'display: grid;' +
            'gap: ' + getGapValue(config.gap) + ';' +
            'grid-auto-flow: ' + config.autoFlow + ';' +
            'justify-content: ' + config.justifyContent + ';' +
            'align-items: ' + config.alignItems + ';' +
            'width: 100%;' +
            'min-height: 300px;'
        );
        
        if (config.columns) {
            if (typeof config.columns === 'number') {
                styles += 'grid-template-columns: repeat(' + config.columns + ', 1fr);';
            } else if (config.columns.includes('repeat')) {
                styles += 'grid-template-columns: ' + config.columns + ';';
            } else {
                styles += 'grid-template-columns: ' + config.columns + ';';
            }
        }
        
        if (config.rows) {
            if (typeof config.rows === 'number') {
                styles += 'grid-template-rows: repeat(' + config.rows + ', 1fr);';
            } else if (config.rows.includes('repeat')) {
                styles += 'grid-template-rows: ' + config.rows + ';';
            } else {
                styles += 'grid-template-rows: ' + config.rows + ';';
            }
        }
        
        if (config.templateAreas) {
            const areas = Array.isArray(config.templateAreas) 
                ? config.templateAreas.map(area => `"${area}"`).join(' ')
                : config.templateAreas;
            styles += 'grid-template-areas: ' + areas + ';';
        }
        
        return styles;
    }
    
    function getGapValue(gap) {
        const gaps = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl'),
            xxxl: tokens.get('spacing.xxxl')
        };
        return gaps[gap] || gaps.md;
    }
    
    // Add to DOM
    document.body.appendChild(gridElement);
    
    // Animate in
    requestAnimationFrame(() => {
        gridElement.style.opacity = '1';
        gridElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!gridElement.contains(e.target)) {
                closeGrid();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeGrid();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeGrid() {
        gridElement.style.opacity = '0';
        gridElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (gridElement.parentNode) {
                gridElement.parentNode.removeChild(gridElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.title} displayed`, 'info');
}

function createDemoColor(type, triggerButton, toastManager) {
    // Define tokens for demo use
    const tokens = {
        get: (path) => {
            const paths = path.split('.');
            const values = {
                'spacing.xs': '4px',
                'spacing.sm': '8px',
                'spacing.md': '16px',
                'spacing.lg': '24px',
                'spacing.xl': '32px',
                'spacing.xxxl': '48px',
                'borderRadius.sm': '4px',
                'borderRadius.md': '8px',
                'borderRadius.lg': '12px',
                'borderRadius.xl': '16px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontSizes.xl': '20px',
                'fontWeights.normal': '400',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600',
                'colors.background.primary': '#ffffff',
                'colors.background.secondary': '#f8fafc',
                'colors.primary': '#3b82f6',
                'colors.secondary': '#64748b',
                'colors.accent': '#8b5cf6',
                'colors.text.primary': '#1e293b',
                'colors.text.secondary': '#64748b',
                'colors.text.inverse': '#ffffff',
                'colors.border.light': '#e2e8f0',
                'colors.border.medium': '#cbd5e1',
                'colors.border.dark': '#94a3b8',
                'colors.surface': '#f1f5f9',
                'colors.success': '#10b981',
                'colors.warning': '#f59e0b',
                'colors.error': '#ef4444'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const colorConfigs = {
        default: {
            format: 'hex',
            alpha: false,
            showPresets: true,
            title: 'Color Picker Demo'
        },
        rgb: {
            format: 'rgb',
            alpha: false,
            showPresets: true,
            title: 'RGB Color Demo'
        },
        hsl: {
            format: 'hsl',
            alpha: false,
            showPresets: true,
            title: 'HSL Color Demo'
        },
        hsv: {
            format: 'hsv',
            alpha: false,
            showPresets: true,
            title: 'HSV Color Demo'
        },
        'with-alpha': {
            format: 'hex',
            alpha: true,
            showPresets: true,
            title: 'Color with Alpha Demo'
        },
        compact: {
            format: 'hex',
            alpha: false,
            showPresets: false,
            title: 'Compact Color Demo'
        }
    };
    
    const config = colorConfigs[type] || colorConfigs.default;
    
    // Create modal as a simple DOM element for demo
    const modalElement = document.createElement('div');
    modalElement.className = 'plauna-demo-modal';
    modalElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 32px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 500px;' +
        'max-width: 600px;' +
        'display: flex;' +
        'flex-direction: column;' +
        'gap: 24px;'
    );
    
    // Create title
    const title = document.createElement('div');
    title.textContent = config.title;
    title.style.cssText = (
        'font-size: 18px;' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: #e4e4e7;' +
        'text-align: center;' +
        'margin-bottom: 8px;'
    );
    modalElement.appendChild(title);
    
    // Create color container
    const colorContainer = document.createElement('div');
    colorContainer.style.cssText = (
        'display: flex;' +
        'flex-direction: column;' +
        'gap: ' + tokens.get('spacing.lg') + ';' +
        'padding: ' + tokens.get('spacing.lg') + ';' +
        'background: rgba(255, 255, 255, 0.05);' +
        'border-radius: ' + tokens.get('borderRadius.md') + ';' +
        'border: 1px solid rgba(99, 116, 141, 0.2);'
    );
    
    // Create color display
    const colorDisplay = document.createElement('div');
    colorDisplay.className = 'plauna-demo-color-display';
    colorDisplay.style.cssText = (
        'width: 100%;' +
        'height: 120px;' +
        'border-radius: ' + tokens.get('borderRadius.md') + ';' +
        'background: #3b82f6;' +
        'margin-bottom: ' + tokens.get('spacing.md') + ';' +
        'border: 2px solid ' + tokens.get('colors.border.medium') + ';'
    );
    
    // Create color controls
    const colorControls = document.createElement('div');
    colorControls.style.cssText = (
        'display: flex;' +
        'flex-direction: column;' +
        'gap: ' + tokens.get('spacing.md') + ';'
    );
    
    // Create color input wrapper
    const inputWrapper = document.createElement('div');
    inputWrapper.style.cssText = (
        'display: flex;' +
        'align-items: center;' +
        'gap: ' + tokens.get('spacing.sm') + ';'
    );
    
    // Create color swatch
    const colorSwatch = document.createElement('div');
    colorSwatch.style.cssText = (
        'width: 40px;' +
        'height: 40px;' +
        'border: 2px solid ' + tokens.get('colors.border.medium') + ';' +
        'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
        'background: #3b82f6;' +
        'cursor: pointer;' +
        'transition: all 150ms ease;'
    );
    
    // Create text input
    const colorInput = document.createElement('input');
    colorInput.type = 'text';
    colorInput.value = '#3b82f6';
    colorInput.placeholder = 'Enter color value';
    colorInput.style.cssText = (
        'flex: 1;' +
        'border: 1px solid ' + tokens.get('colors.border.medium') + ';' +
        'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
        'background: ' + tokens.get('colors.background.primary') + ';' +
        'color: ' + tokens.get('colors.text.primary') + ';' +
        'font-size: ' + tokens.get('fontSizes.sm') + ';' +
        'font-family: monospace;' +
        'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
        'outline: none;' +
        'transition: all 150ms ease;'
    );
    
    // Create format selector
    const formatSelect = document.createElement('select');
    formatSelect.style.cssText = (
        'border: 1px solid ' + tokens.get('colors.border.medium') + ';' +
        'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
        'background: ' + tokens.get('colors.background.primary') + ';' +
        'color: ' + tokens.get('colors.text.primary') + ';' +
        'font-size: ' + tokens.get('fontSizes.sm') + ';' +
        'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
        'outline: none;' +
        'cursor: pointer;'
    );
    
    // Add format options
    const formats = ['hex', 'rgb', 'hsl', 'hsv'];
    formats.forEach(format => {
        const option = document.createElement('option');
        option.value = format;
        option.textContent = format.toUpperCase();
        option.selected = format === config.format;
        formatSelect.appendChild(option);
    });
    
    inputWrapper.appendChild(colorSwatch);
    inputWrapper.appendChild(colorInput);
    inputWrapper.appendChild(formatSelect);
    colorControls.appendChild(inputWrapper);
    
    // Create color info
    const colorInfo = document.createElement('div');
    colorInfo.style.cssText = (
        'display: flex;' +
        'flex-wrap: wrap;' +
        'gap: ' + tokens.get('spacing.sm') + ';' +
        'padding: ' + tokens.get('spacing.sm') + ';' +
        'background: rgba(255, 255, 255, 0.05);' +
        'border-radius: ' + tokens.get('borderRadius.sm') + ';'
    );
    
    // Create color values display
    const colorValues = {
        hex: '#3b82f6',
        rgb: 'rgb(59, 130, 246)',
        hsl: 'hsl(217, 91%, 60%)',
        hsv: 'hsv(217, 76%, 96%)'
    };
    
    Object.entries(colorValues).forEach(([format, value]) => {
        const valueItem = document.createElement('div');
        valueItem.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'font-size: ' + tokens.get('fontSizes.xs') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';'
        );
        
        const label = document.createElement('div');
        label.textContent = format.toUpperCase() + ':';
        label.style.cssText = (
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'color: ' + tokens.get('colors.text.primary') + ';'
        );
        
        const valueElement = document.createElement('div');
        valueElement.textContent = value;
        valueElement.style.cssText = (
            'font-family: monospace;' +
            'color: ' + tokens.get('colors.text.primary') + ';'
        );
        
        valueItem.appendChild(label);
        valueItem.appendChild(valueElement);
        colorInfo.appendChild(valueItem);
    });
    
    // Create presets if enabled
    let presetsContainer = null;
    if (config.showPresets) {
        presetsContainer = document.createElement('div');
        presetsContainer.style.cssText = (
            'display: flex;' +
            'flex-wrap: wrap;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'padding: ' + tokens.get('spacing.sm') + ';' +
            'background: rgba(255, 255, 255, 0.05);' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';'
        );
        
        const presetColors = [
            '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff',
            '#ffff00', '#ff00ff', '#00ffff', '#ff8800', '#8800ff',
            '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#d4a5a5'
        ];
        
        presetColors.forEach(color => {
            const presetButton = document.createElement('button');
            presetButton.type = 'button';
            presetButton.style.cssText = (
                'width: 32px;' +
                'height: 32px;' +
                'border: 2px solid ' + tokens.get('colors.border.medium') + ';' +
                'border-radius: 4px;' +
                'background: ' + color + ';' +
                'cursor: pointer;' +
                'transition: all 150ms ease;'
            );
            
            presetButton.addEventListener('click', () => {
                updateColor(color);
            });
            
            presetButton.addEventListener('mouseenter', () => {
                presetButton.style.transform = 'scale(1.1)';
                presetButton.style.borderColor = tokens.get('colors.primary');
            });
            
            presetButton.addEventListener('mouseleave', () => {
                presetButton.style.transform = 'scale(1)';
                presetButton.style.borderColor = tokens.get('colors.border.medium');
            });
            
            presetsContainer.appendChild(presetButton);
        });
    }
    
    // Helper function to update color
    function updateColor(color) {
        colorDisplay.style.background = color;
        colorSwatch.style.background = color;
        colorInput.value = color;
        
        // Update color values
        const colorInfoItems = colorInfo.querySelectorAll('div > div');
        colorInfoItems.forEach(item => {
            const valueElement = item.querySelector('div:last-child');
            const labelElement = item.querySelector('div:first-child');
            
            if (!valueElement || !labelElement) return;
            
            const format = labelElement.textContent.toLowerCase().replace(':', '');
            
            switch (format) {
                case 'hex':
                    valueElement.textContent = color;
                    break;
                case 'rgb':
                    // Convert hex to RGB
                    const hex = color.replace('#', '');
                    const r = parseInt(hex.substr(0, 2), 16);
                    const g = parseInt(hex.substr(2, 2), 16);
                    const b = parseInt(hex.substr(4, 2), 16);
                    valueElement.textContent = `rgb(${r}, ${g}, ${b})`;
                    break;
                case 'hsl':
                    // Convert hex to HSL (simplified)
                    valueElement.textContent = 'hsl(217, 91%, 60%)';
                    break;
                case 'hsv':
                    // Convert hex to HSV (simplified)
                    valueElement.textContent = 'hsv(217, 76%, 96%)';
                    break;
            }
        });
    }
    
    // Event handlers
    colorInput.addEventListener('input', (e) => {
        const value = e.target.value;
        if (isValidColor(value)) {
            updateColor(value);
        }
    });
    
    colorSwatch.addEventListener('click', () => {
        // Simulate color picker
        const randomColor = '#' + Math.floor(uniformDistribution(0, 16777215, Math.random)).toString(16).padStart(6, '0');
        updateColor(randomColor);
    });
    
    formatSelect.addEventListener('change', (e) => {
        const format = e.target.value;
        // Update display based on format
        toastManager.show(`Format changed to ${format.toUpperCase()}`, 'info');
    });
    
    // Assemble container
    colorContainer.appendChild(colorDisplay);
    colorContainer.appendChild(colorControls);
    colorContainer.appendChild(colorInfo);
    
    if (presetsContainer) {
        colorContainer.appendChild(presetsContainer);
    }
    
    modalElement.appendChild(colorContainer);
    
    // Create controls
    const controls = document.createElement('div');
    controls.style.cssText = (
        'display: flex;' +
        'justify-content: center;' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'padding-top: ' + tokens.get('spacing.lg') + ';' +
        'border-top: 1px solid rgba(99, 116, 141, 0.3);'
    );
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = (
        'background: transparent;' +
        'color: #94a3b8;' +
        'border: 1px solid #475569;' +
        'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
        'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
        'font-size: ' + tokens.get('fontSizes.sm') + ';' +
        'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
        'cursor: pointer;' +
        'transition: all 150ms ease;'
    );
    
    closeButton.addEventListener('click', closeModal);
    
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.background = 'rgba(255, 255, 255, 0.1)';
        closeButton.style.color = '#e4e4e7';
    });
    
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.background = 'transparent';
        closeButton.style.color = '#94a3b8';
    });
    
    controls.appendChild(closeButton);
    modalElement.appendChild(controls);
    
    // Helper function to validate color
    function isValidColor(color) {
        const tempElement = document.createElement('div');
        tempElement.style.color = color;
        return tempElement.style.color !== '';
    }
    
    // Add to DOM
    document.body.appendChild(modalElement);
    
    // Animate in
    requestAnimationFrame(() => {
        modalElement.style.opacity = '1';
        modalElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!modalElement.contains(e.target)) {
                closeModal();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeModal() {
        modalElement.style.opacity = '0';
        modalElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (modalElement.parentNode) {
                modalElement.parentNode.removeChild(modalElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.title} displayed`, 'info');
}

function createDemoFile(type, triggerButton, toastManager) {
    // Define tokens for demo use
    const tokens = {
        get: (path) => {
            const paths = path.split('.');
            const values = {
                'spacing.xs': '4px',
                'spacing.sm': '8px',
                'spacing.md': '16px',
                'spacing.lg': '24px',
                'spacing.xl': '32px',
                'spacing.xxxl': '48px',
                'borderRadius.sm': '4px',
                'borderRadius.md': '8px',
                'borderRadius.lg': '12px',
                'borderRadius.xl': '16px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontSizes.xl': '20px',
                'fontWeights.normal': '400',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600',
                'colors.background.primary': '#ffffff',
                'colors.background.secondary': '#f8fafc',
                'colors.primary': '#3b82f6',
                'colors.secondary': '#64748b',
                'colors.accent': '#8b5cf6',
                'colors.text.primary': '#1e293b',
                'colors.text.secondary': '#64748b',
                'colors.text.inverse': '#ffffff',
                'colors.border.light': '#e2e8f0',
                'colors.border.medium': '#cbd5e1',
                'colors.border.dark': '#94a3b8',
                'colors.surface': '#f1f5f9',
                'colors.success': '#10b981',
                'colors.warning': '#f59e0b',
                'colors.error': '#ef4444'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const fileConfigs = {
        default: {
            multiple: false,
            maxFiles: 1,
            maxSize: 5 * 1024 * 1024, // 5MB
            accept: '*/*',
            showPreview: false,
            showProgress: false,
            title: 'File Upload Demo'
        },
        multiple: {
            multiple: true,
            maxFiles: 5,
            maxSize: 2 * 1024 * 1024, // 2MB
            accept: '*/*',
            showPreview: false,
            showProgress: true,
            title: 'Multiple File Upload Demo'
        },
        'image-upload': {
            multiple: true,
            maxFiles: 3,
            maxSize: 3 * 1024 * 1024, // 3MB
            accept: 'image/*',
            showPreview: true,
            showProgress: true,
            title: 'Image Upload Demo'
        }
    };
    
    const config = fileConfigs[type] || fileConfigs.default;
    
    // Create modal as a simple DOM element for demo
    const modalElement = document.createElement('div');
    modalElement.className = 'plauna-demo-modal';
    modalElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 32px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 600px;' +
        'max-width: 800px;' +
        'display: flex;' +
        'flex-direction: column;' +
        'gap: 24px;'
    );
    
    // Create title
    const title = document.createElement('div');
    title.textContent = config.title;
    title.style.cssText = (
        'font-size: 18px;' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: #e4e4e7;' +
        'text-align: center;' +
        'margin-bottom: 8px;'
    );
    modalElement.appendChild(title);
    
    // Create file upload container
    const uploadContainer = document.createElement('div');
    uploadContainer.style.cssText = (
        'display: flex;' +
        'flex-direction: column;' +
        'gap: ' + tokens.get('spacing.lg') + ';' +
        'padding: ' + tokens.get('spacing.lg') + ';' +
        'background: rgba(255, 255, 255, 0.05);' +
        'border-radius: ' + tokens.get('borderRadius.md') + ';' +
        'border: 1px solid rgba(99, 116, 141, 0.2);'
    );
    
    // Create demo file upload widget
    const fileUpload = document.createElement('div');
    fileUpload.className = 'plauna-demo-file-upload';
    fileUpload.style.cssText = (
        'border: 2px dashed ' + tokens.get('colors.border.medium') + ';' +
        'border-radius: ' + tokens.get('borderRadius.md') + ';' +
        'background: rgba(255, 255, 255, 0.05);' +
        'padding: ' + tokens.get('spacing.xl') + ';' +
        'text-align: center;' +
        'cursor: pointer;' +
        'position: relative;' +
        'min-height: 120px;' +
        'display: flex;' +
        'flex-direction: column;' +
        'align-items: center;' +
        'justify-content: center;' +
        'gap: ' + tokens.get('spacing.md') + ';'
    );
    
    // Upload icon
    const uploadIcon = document.createElement('div');
    uploadIcon.textContent = '📤';
    uploadIcon.style.cssText = (
        'font-size: 48px;' +
        'opacity: 0.6;' +
        'margin-bottom: ' + tokens.get('spacing.sm') + ';'
    );
    
    // Upload text
    const uploadText = document.createElement('div');
    uploadText.textContent = config.multiple ? 'Drag & drop files here or click to browse' : 'Drag & drop a file here or click to browse';
    uploadText.style.cssText = (
        'color: ' + tokens.get('colors.text.secondary') + ';' +
        'font-size: ' + tokens.get('fontSizes.sm') + ';' +
        'margin-bottom: ' + tokens.get('spacing.xs') + ';'
    );
    
    // Browse button
    const browseButton = document.createElement('button');
    browseButton.type = 'button';
    browseButton.textContent = 'Browse files';
    browseButton.style.cssText = (
        'background: ' + tokens.get('colors.primary') + ';' +
        'color: ' + tokens.get('colors.text.inverse') + ';' +
        'border: none;' +
        'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
        'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
        'font-size: ' + tokens.get('fontSizes.sm') + ';' +
        'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
        'cursor: pointer;' +
        'transition: all 150ms ease;'
    );
    
    browseButton.addEventListener('click', () => {
        // Simulate file selection
        const simulatedFiles = createSimulatedFiles(config);
        handleFileSelection(simulatedFiles);
    });
    
    browseButton.addEventListener('mouseenter', () => {
        browseButton.style.background = '#2563eb';
    });
    
    browseButton.addEventListener('mouseleave', () => {
        browseButton.style.background = tokens.get('colors.primary');
    });
    
    const uploadContent = document.createElement('div');
    uploadContent.appendChild(uploadIcon);
    uploadContent.appendChild(uploadText);
    uploadContent.appendChild(browseButton);
    fileUpload.appendChild(uploadContent);
    
    // Create files list
    const filesList = document.createElement('div');
    filesList.className = 'plauna-demo-files-list';
    filesList.style.cssText = (
        'display: flex;' +
        'flex-direction: column;' +
        'gap: ' + tokens.get('spacing.sm') + ';' +
        'max-height: 200px;' +
        'overflow-y: auto;' +
        'padding: 0 ' + tokens.get('spacing.sm') + ';'
    );
    
    // Helper functions
    function createSimulatedFiles(config) {
        const fileTypes = {
            'default': [
                { name: 'document.pdf', size: 1024 * 1024, type: 'application/pdf' },
                { name: 'image.jpg', size: 512 * 1024, type: 'image/jpeg' }
            ],
            'image-upload': [
                { name: 'photo.jpg', size: 800 * 1024, type: 'image/jpeg' },
                { name: 'screenshot.png', size: 400 * 1024, type: 'image/png' }
            ]
        };
        
        const files = fileTypes[type] || fileTypes.default;
        return files.map((file, index) => ({
            ...file,
            id: `demo-file-${index}`,
            lastModified: new Date(),
            uploaded: false
        }));
    }
    
    function handleFileSelection(files) {
        files.forEach(file => {
            createFileItem(file);
        });
        toastManager.show(`${files.length} file${files.length !== 1 ? 's' : ''} ready for upload`, 'success');
    }
    
    function createFileItem(file) {
        const fileItem = document.createElement('div');
        fileItem.className = 'plauna-demo-file-item';
        fileItem.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: space-between;' +
            'padding: ' + tokens.get('spacing.sm') + ';' +
            'background: rgba(255, 255, 255, 0.05);' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'border: 1px solid ' + tokens.get('colors.border.light') + ';'
        );
        
        // File info
        const fileInfo = document.createElement('div');
        fileInfo.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: 4px;' +
            'flex: 1;'
        );
        
        const fileName = document.createElement('div');
        fileName.textContent = file.name;
        fileName.style.cssText = (
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'color: ' + tokens.get('colors.text.primary') + ';' +
            'overflow: hidden;' +
            'text-overflow: ellipsis;' +
            'white-space: nowrap;'
        );
        
        const fileSize = document.createElement('div');
        fileSize.textContent = formatFileSize(file.size);
        fileSize.style.cssText = (
            'font-size: ' + tokens.get('fontSizes.xs') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';'
        );
        
        fileInfo.appendChild(fileName);
        fileInfo.appendChild(fileSize);
        
        // Remove button
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.textContent = '✕';
        removeButton.style.cssText = (
            'background: transparent;' +
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'border: 1px solid ' + tokens.get('colors.border.medium') + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'width: 24px;' +
            'height: 24px;' +
            'font-size: 12px;' +
            'cursor: pointer;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'transition: all 150ms ease;'
        );
        
        removeButton.addEventListener('click', () => {
            filesList.removeChild(fileItem);
            toastManager.show(`Removed ${file.name}`, 'info');
        });
        
        removeButton.addEventListener('mouseenter', () => {
            removeButton.style.background = 'rgba(239, 68, 68, 0.1)';
            removeButton.style.color = '#fca5a5';
        });
        
        removeButton.addEventListener('mouseleave', () => {
            removeButton.style.background = 'transparent';
            removeButton.style.color = tokens.get('colors.text.secondary');
        });
        
        fileItem.appendChild(fileInfo);
        fileItem.appendChild(removeButton);
        filesList.appendChild(fileItem);
    }
    
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    // Assemble container
    uploadContainer.appendChild(fileUpload);
    uploadContainer.appendChild(filesList);
    modalElement.appendChild(uploadContainer);
    
    // Create controls
    const controls = document.createElement('div');
    controls.style.cssText = (
        'display: flex;' +
        'justify-content: center;' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'padding-top: ' + tokens.get('spacing.lg') + ';' +
        'border-top: 1px solid rgba(99, 116, 141, 0.3);'
    );
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = (
        'background: transparent;' +
        'color: #94a3b8;' +
        'border: 1px solid #475569;' +
        'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
        'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
        'font-size: ' + tokens.get('fontSizes.sm') + ';' +
        'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
        'cursor: pointer;' +
        'transition: all 150ms ease;'
    );
    
    closeButton.addEventListener('click', closeModal);
    
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.background = 'rgba(255, 255, 255, 0.1)';
        closeButton.style.color = '#e4e4e7';
    });
    
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.background = 'transparent';
        closeButton.style.color = '#94a3b8';
    });
    
    controls.appendChild(closeButton);
    modalElement.appendChild(controls);
    
    // Add to DOM
    document.body.appendChild(modalElement);
    
    // Animate in
    requestAnimationFrame(() => {
        modalElement.style.opacity = '1';
        modalElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!modalElement.contains(e.target)) {
                closeModal();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeModal() {
        modalElement.style.opacity = '0';
        modalElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (modalElement.parentNode) {
                modalElement.parentNode.removeChild(modalElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.title} displayed`, 'info');
}

function createDemoDate(type, triggerButton, toastManager) {
    // Define tokens for demo use
    const tokens = {
        get: (path) => {
            const paths = path.split('.');
            const values = {
                'spacing.xs': '4px',
                'spacing.sm': '8px',
                'spacing.md': '16px',
                'spacing.lg': '24px',
                'spacing.xl': '32px',
                'spacing.xxxl': '48px',
                'borderRadius.sm': '4px',
                'borderRadius.md': '8px',
                'borderRadius.lg': '12px',
                'borderRadius.xl': '16px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontSizes.xl': '20px',
                'fontWeights.normal': '400',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600',
                'colors.background.primary': '#ffffff',
                'colors.background.secondary': '#f8fafc',
                'colors.primary': '#3b82f6',
                'colors.secondary': '#64748b',
                'colors.accent': '#8b5cf6',
                'colors.text.primary': '#1e293b',
                'colors.text.secondary': '#64748b',
                'colors.text.inverse': '#ffffff',
                'colors.border.light': '#e2e8f0',
                'colors.border.medium': '#cbd5e1',
                'colors.border.dark': '#94a3b8',
                'colors.surface': '#f1f5f9',
                'colors.success': '#10b981',
                'colors.warning': '#f59e0b',
                'colors.error': '#ef4444'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const buttonConfigs = {
        default: {
            variant: 'default',
            text: 'Default Button',
            title: 'Default Button Demo'
        },
        primary: {
            variant: 'primary',
            text: 'Primary Button',
            title: 'Primary Button Demo'
        },
        secondary: {
            variant: 'secondary',
            text: 'Secondary Button',
            title: 'Secondary Button Demo'
        },
        ghost: {
            variant: 'ghost',
            text: 'Ghost Button',
            title: 'Ghost Button Demo'
        },
        danger: {
            variant: 'danger',
            text: 'Danger Button',
            title: 'Danger Button Demo'
        },
        warning: {
            variant: 'warning',
            text: 'Warning Button',
            title: 'Warning Button Demo'
        },
        success: {
            variant: 'success',
            text: 'Success Button',
            title: 'Success Button Demo'
        },
        'with-icon': {
            variant: 'primary',
            text: 'With Icon',
            icon: '★',
            iconPosition: 'left',
            title: 'Button with Icon Demo'
        },
        'icon-only': {
            variant: 'ghost',
            text: '',
            icon: '⚙',
            iconPosition: 'only',
            title: 'Icon Only Button Demo'
        },
        loading: {
            variant: 'primary',
            text: 'Loading...',
            loading: true,
            title: 'Loading Button Demo'
        },
        disabled: {
            variant: 'primary',
            text: 'Disabled',
            disabled: true,
            title: 'Disabled Button Demo'
        },
        sizes: {
            variant: 'primary',
            text: 'Size Variants',
            title: 'Button Size Variants Demo'
        }
    };
    
    const config = buttonConfigs[type] || buttonConfigs.default;
    
    // Create modal as a simple DOM element for demo
    const modalElement = document.createElement('div');
    modalElement.className = 'plauna-demo-modal';
    modalElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 32px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 600px;' +
        'max-width: 700px;' +
        'display: flex;' +
        'flex-direction: column;' +
        'gap: 24px;'
    );
    
    // Create title
    const title = document.createElement('div');
    title.textContent = config.title;
    title.style.cssText = (
        'font-size: 18px;' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: #e4e4e7;' +
        'text-align: center;' +
        'margin-bottom: 8px;'
    );
    modalElement.appendChild(title);
    
    // Create button container
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = (
        'display: flex;' +
        'flex-direction: column;' +
        'gap: ' + tokens.get('spacing.lg') + ';' +
        'padding: ' + tokens.get('spacing.lg') + ';' +
        'background: rgba(255, 255, 255, 0.05);' +
        'border-radius: ' + tokens.get('borderRadius.md') + ';' +
        'border: 1px solid rgba(99, 116, 141, 0.2);'
    );
    
    // Create status display
    const statusDisplay = document.createElement('div');
    statusDisplay.style.cssText = (
        'padding: ' + tokens.get('spacing.sm') + ';' +
        'background: rgba(59, 130, 246, 0.1);' +
        'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
        'font-size: ' + tokens.get('fontSizes.sm') + ';' +
        'color: #93c5fd;' +
        'border: 1px solid rgba(59, 130, 246, 0.2);' +
        'min-height: 40px;' +
        'display: flex;' +
        'align-items: center;' +
        'justify-content: center;' +
        'text-align: center;'
    );
    statusDisplay.textContent = 'Click any button to see interactions...';
    modalElement.appendChild(statusDisplay);
    
    // Create buttons based on configuration
    const buttons = createButtons(config, tokens, toastManager, statusDisplay);
    buttons.forEach(button => buttonContainer.appendChild(button));
    
    modalElement.appendChild(buttonContainer);
    
    // Create controls
    const controls = document.createElement('div');
    controls.style.cssText = (
        'display: flex;' +
        'justify-content: center;' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'padding-top: ' + tokens.get('spacing.lg') + ';' +
        'border-top: 1px solid rgba(99, 116, 141, 0.3);'
    );
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = (
        'background: transparent;' +
        'color: #94a3b8;' +
        'border: 1px solid #475569;' +
        'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
        'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
        'font-size: ' + tokens.get('fontSizes.sm') + ';' +
        'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
        'cursor: pointer;' +
        'transition: all 150ms ease;'
    );
    
    closeButton.addEventListener('click', closeModal);
    
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.background = 'rgba(255, 255, 255, 0.1)';
        closeButton.style.color = '#e4e4e7';
    });
    
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.background = 'transparent';
        closeButton.style.color = '#94a3b8';
    });
    
    controls.appendChild(closeButton);
    modalElement.appendChild(controls);
    
    // Helper function to create buttons
    function createButtons(config, tokens, toastManager, statusDisplay) {
        const buttons = [];
        
        if (config.variant === 'sizes') {
            // Create size variants
            const sizes = ['sm', 'md', 'lg', 'xl'];
            sizes.forEach(size => {
                const button = createButtonElement({
                    ...config,
                    size,
                    text: `${size.toUpperCase()} Button`
                }, tokens, toastManager, statusDisplay);
                buttons.push(button);
            });
        } else {
            // Create single button
            const button = createButtonElement(config, tokens, toastManager, statusDisplay);
            buttons.push(button);
            
            // Add additional demo buttons for certain types
            if (config.variant === 'default') {
                // Add variant buttons
                ['primary', 'secondary', 'ghost', 'danger', 'warning', 'success'].forEach(variant => {
                    const variantButton = createButtonElement({
                        ...config,
                        variant,
                        text: variant.charAt(0).toUpperCase() + variant.slice(1)
                    }, tokens, toastManager, statusDisplay);
                    buttons.push(variantButton);
                });
            }
        }
        
        return buttons;
    }
    
    function createButtonElement(config, tokens, toastManager, statusDisplay) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = config.text;
        button.disabled = config.disabled || false;
        
        // Set styles
        button.style.cssText = getButtonStyles(config, tokens);
        
        // Add icon if provided
        if (config.icon) {
            const icon = document.createElement('span');
            icon.textContent = config.icon;
            icon.style.cssText = (
                'display: inline-flex;' +
                'align-items: center;' +
                'justify-content: center;' +
                'width: ' + tokens.get('fontSizes.md') + ';' +
                'height: ' + tokens.get('fontSizes.md') + ';' +
                'font-size: ' + tokens.get('fontSizes.md') + ';'
            );
            
            if (config.iconPosition === 'left') {
                button.insertBefore(icon, button.firstChild);
            } else if (config.iconPosition === 'right') {
                button.appendChild(icon);
            } else if (config.iconPosition === 'only') {
                button.textContent = '';
                button.appendChild(icon);
            }
        }
        
        // Add loading indicator
        if (config.loading) {
            button.innerHTML = '⟳ Loading...';
        }
        
        // Add event listeners
        button.addEventListener('click', () => {
            if (!config.disabled && !config.loading) {
                statusDisplay.textContent = `${config.variant || 'default'} button clicked!`;
                statusDisplay.style.background = 'rgba(16, 185, 129, 0.1)';
                statusDisplay.style.color = '#86efac';
                statusDisplay.style.borderColor = 'rgba(16, 185, 129, 0.2)';
                toastManager.show(`${config.text} clicked`, 'success');
            }
        });
        
        button.addEventListener('mouseenter', () => {
            if (!config.disabled && !config.loading) {
                statusDisplay.textContent = `Hovering over ${config.text}...`;
                statusDisplay.style.background = 'rgba(139, 92, 246, 0.1)';
                statusDisplay.style.color = '#c4b5fd';
                statusDisplay.style.borderColor = 'rgba(139, 92, 246, 0.2)';
            }
        });
        
        button.addEventListener('mouseleave', () => {
            if (!config.disabled && !config.loading) {
                statusDisplay.textContent = 'Click any button to see interactions...';
                statusDisplay.style.background = 'rgba(59, 130, 246, 0.1)';
                statusDisplay.style.color = '#93c5fd';
                statusDisplay.style.borderColor = 'rgba(59, 130, 246, 0.2)';
            }
        });
        
        button.addEventListener('focus', () => {
            if (!config.disabled && !config.loading) {
                statusDisplay.textContent = `${config.text} focused`;
                statusDisplay.style.background = 'rgba(59, 130, 246, 0.2)';
                statusDisplay.style.color = '#dbeafe';
                statusDisplay.style.borderColor = 'rgba(59, 130, 246, 0.3)';
            }
        });
        
        button.addEventListener('blur', () => {
            if (!config.disabled && !config.loading) {
                statusDisplay.textContent = 'Click any button to see interactions...';
                statusDisplay.style.background = 'rgba(59, 130, 246, 0.1)';
                statusDisplay.style.color = '#93c5fd';
                statusDisplay.style.borderColor = 'rgba(59, 130, 246, 0.2)';
            }
        });
        
        return button;
    }
    
    function getButtonStyles(config, tokens) {
        const variantStyles = getVariantStyles(config.variant, tokens);
        const sizeStyles = getSizeStyles(config.size || 'md', tokens);
        const stateStyles = getStateStyles(config, tokens);
        
        return (
            'font-family: inherit;' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'text-align: center;' +
            'text-decoration: none;' +
            'border: 1px solid transparent;' +
            'border-radius: ' + tokens.get('borderRadius.md') + ';' +
            'outline: none;' +
            'cursor: ' + (config.disabled ? 'not-allowed' : 'pointer') + ';' +
            'transition: all 150ms ease;' +
            'position: relative;' +
            'overflow: hidden;' +
            'user-select: none;' +
            'box-sizing: border-box;' +
            'display: inline-flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            variantStyles +
            sizeStyles +
            stateStyles
        );
    }
    
    function getVariantStyles(variant, tokens) {
        const variants = {
            default: (
                'background: ' + tokens.get('colors.background.primary') + ';' +
                'color: ' + tokens.get('colors.text.primary') + ';' +
                'border-color: ' + tokens.get('colors.border.medium') + ';'
            ),
            primary: (
                'background: ' + tokens.get('colors.primary') + ';' +
                'color: ' + tokens.get('colors.text.inverse') + ';' +
                'border-color: ' + tokens.get('colors.primary') + ';'
            ),
            secondary: (
                'background: ' + tokens.get('colors.secondary') + ';' +
                'color: ' + tokens.get('colors.text.inverse') + ';' +
                'border-color: ' + tokens.get('colors.secondary') + ';'
            ),
            ghost: (
                'background: transparent;' +
                'color: ' + tokens.get('colors.primary') + ';' +
                'border-color: ' + tokens.get('colors.primary') + ';'
            ),
            danger: (
                'background: #ef4444;' +
                'color: ' + tokens.get('colors.text.inverse') + ';' +
                'border-color: #ef4444;'
            ),
            warning: (
                'background: #f59e0b;' +
                'color: ' + tokens.get('colors.text.inverse') + ';' +
                'border-color: #f59e0b;'
            ),
            success: (
                'background: #10b981;' +
                'color: ' + tokens.get('colors.text.inverse') + ';' +
                'border-color: #10b981;'
            )
        };
        
        return variants[variant] || variants.default;
    }
    
    function getSizeStyles(size, tokens) {
        const sizes = {
            sm: (
                'padding: ' + tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm') + ';' +
                'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                'min-height: 28px;'
            ),
            md: (
                'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'min-height: 36px;'
            ),
            lg: (
                'padding: ' + tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg') + ';' +
                'font-size: ' + tokens.get('fontSizes.md') + ';' +
                'min-height: 44px;'
            ),
            xl: (
                'padding: ' + tokens.get('spacing.lg') + ' ' + tokens.get('spacing.xl') + ';' +
                'font-size: ' + tokens.get('fontSizes.lg') + ';' +
                'min-height: 52px;'
            )
        };
        
        return sizes[size] || sizes.md;
    }
    
    function getStateStyles(config, tokens) {
        let styles = '';
        
        if (config.disabled) {
            styles += (
                'opacity: 0.5;' +
                'cursor: not-allowed;' +
                'pointer-events: none;'
            );
        }
        
        if (config.loading) {
            styles += (
                'cursor: wait;' +
                'pointer-events: none;'
            );
        }
        
        return styles;
    }
    
    // Add to DOM
    document.body.appendChild(modalElement);
    
    // Animate in
    requestAnimationFrame(() => {
        modalElement.style.opacity = '1';
        modalElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!modalElement.contains(e.target)) {
                closeModal();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeModal() {
        modalElement.style.opacity = '0';
        modalElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (modalElement.parentNode) {
                modalElement.parentNode.removeChild(modalElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.title} displayed`, 'info');
}

function createDemoTime(type, triggerButton, toastManager) {
    // Get current theme
    const theme = createThemedModalStyles();
    
    // Simple Time demo
    const modalElement = document.createElement('div');
    modalElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: ' + theme.background + ';' +
        'border: 1px solid ' + theme.border + ';' +
        'border-radius: ' + theme.borderRadius.lg + ';' +
        'padding: ' + theme.spacing.xl + ';' +
        'z-index: 1000;' +
        'min-width: 400px;' +
        'text-align: center;' +
        'color: ' + theme.text + ';'
    );
    
    modalElement.innerHTML = `
        <h3 style="margin: 0 0 ${theme.spacing.lg} 0; color: ${theme.text}; font-size: ${theme.fontSizes.lg}; font-weight: ${theme.fontWeights.semibold};">Time Picker Demo</h3>
        <div style="margin: ${theme.spacing.lg} 0; font-size: 48px; font-family: monospace; color: ${theme.accent};">12:30 PM</div>
        <div style="margin: ${theme.spacing.lg} 0;">
            <button onclick="this.parentElement.parentElement.remove()" style="
                background: ${theme.accent};
                color: white;
                border: none;
                padding: ${theme.spacing.sm} ${theme.spacing.md};
                border-radius: ${theme.borderRadius.sm};
                cursor: pointer;
                font-size: ${theme.fontSizes.sm};
                font-weight: ${theme.fontWeights.medium};
                transition: background-color 150ms ease;
            " onmouseover="this.style.background='${theme.accentHover}'" onmouseout="this.style.background='${theme.accent}'">Close</button>
        </div>
    `;
    
    document.body.appendChild(modalElement);
    toastManager.show('Time demo displayed', 'info');
}

function createDemoRange(type, triggerButton, toastManager) {
    // Get current theme
    const theme = createThemedModalStyles();
    
    // Simple Range demo
    const modalElement = document.createElement('div');
    modalElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: ' + theme.background + ';' +
        'border: 1px solid ' + theme.border + ';' +
        'border-radius: ' + theme.borderRadius.lg + ';' +
        'padding: ' + theme.spacing.xl + ';' +
        'z-index: 1000;' +
        'min-width: 400px;' +
        'text-align: center;' +
        'color: ' + theme.text + ';'
    );
    
    modalElement.innerHTML = `
        <h3 style="margin: 0 0 ${theme.spacing.lg} 0; color: ${theme.text}; font-size: ${theme.fontSizes.lg}; font-weight: ${theme.fontWeights.semibold};">Range Slider Demo</h3>
        <div style="margin: ${theme.spacing.lg} 0;">
            <input type="range" min="0" max="100" value="50" style="width: 100%; accent-color: ${theme.accent};" />
            <div style="margin-top: ${theme.spacing.sm}; color: ${theme.textSecondary}; font-size: ${theme.fontSizes.sm};">Value: 50</div>
        </div>
        <div style="margin: ${theme.spacing.lg} 0;">
            <button onclick="this.parentElement.parentElement.remove()" style="
                background: ${theme.accent};
                color: white;
                border: none;
                padding: ${theme.spacing.sm} ${theme.spacing.md};
                border-radius: ${theme.borderRadius.sm};
                cursor: pointer;
                font-size: ${theme.fontSizes.sm};
                font-weight: ${theme.fontWeights.medium};
                transition: background-color 150ms ease;
            " onmouseover="this.style.background='${theme.accentHover}'" onmouseout="this.style.background='${theme.accent}'">Close</button>
        </div>
    `;
    
    document.body.appendChild(modalElement);
    toastManager.show('Range demo displayed', 'info');
}

function showWidgetDemo(widgetType, toastManager) {
    // Get widget class for metadata
    const widgetClass = getWidget(widgetType);
    const displayName = widgetClass ? widgetClass.name : widgetType.charAt(0).toUpperCase() + widgetType.slice(1);
    const description = widgetClass ? widgetClass.description : `Interactive ${widgetType} widget`;
    
    // Get modal styles from theme manager
    const modalStyles = widgetStyleManager.getWidgetStyles('modal', 'md');
    
    // Create modal container using theme styles
    const modalElement = widgetStyleManager.createStyledElement('div', modalStyles.container, 'plauna-widget-modal');
    
    // Create modal panel
    const modalPanel = widgetStyleManager.createStyledElement('div', modalStyles.panel);
    
    // Create header
    const header = widgetStyleManager.createStyledElement('header', modalStyles.header);
    
    // Create title
    const title = widgetStyleManager.createStyledElement('h2', modalStyles.title);
    title.textContent = `${displayName} Widget`;
    
    // Create description
    const descriptionElement = document.createElement('p');
    descriptionElement.textContent = description;
    descriptionElement.style.cssText = `
        margin: 0 0 24px 0;
        color: #a1a1aa;
        font-size: 14px;
    `;
    
    // Create close button
    const closeButton = widgetStyleManager.createStyledElement('button', modalStyles.closeButton);
    closeButton.innerHTML = '×';
    
    // Create widget container
    const widgetContainerStyles = widgetStyleManager.getWidgetStyles('widget-container');
    const widgetContainer = widgetStyleManager.createStyledElement('div', widgetContainerStyles.container, `${widgetType}-widget-container`);
    
    // Setup close button interactions
    closeButton.addEventListener('mouseenter', () => {
        widgetStyleManager.applyStyles(closeButton, modalStyles.closeButtonHover);
    });
    
    closeButton.addEventListener('mouseleave', () => {
        widgetStyleManager.applyStyles(closeButton, modalStyles.closeButton);
    });
    
    closeButton.addEventListener('click', () => {
        closeModal();
    });
    
    // Assemble modal
    header.appendChild(title);
    header.appendChild(descriptionElement);
    header.appendChild(closeButton);
    modalPanel.appendChild(header);
    modalPanel.appendChild(widgetContainer);
    modalElement.appendChild(modalPanel);
    
    // Add to DOM
    document.body.appendChild(modalElement);
    
    // Modal functions
    function openModal() {
        widgetStyleManager.applyStyles(modalElement, { opacity: '1' });
        widgetStyleManager.applyStyles(modalPanel, { transform: 'scale(1)' });
    }
    
    function closeModal() {
        widgetStyleManager.applyStyles(modalElement, { opacity: '0' });
        widgetStyleManager.applyStyles(modalPanel, { transform: 'scale(0.95)' });
        setTimeout(() => {
            if (modalElement.parentNode) {
                modalElement.parentNode.removeChild(modalElement);
            }
        }, 200);
    }
    
    // Close on background click
    modalElement.addEventListener('click', (e) => {
        if (e.target === modalElement) {
            closeModal();
        }
    });
    
    // Create widget instance using modular system
    try {
        const widgetOptions = getWidgetOptions(widgetType, toastManager);
        const widget = createWidget(widgetType, widgetContainer, widgetOptions);
        
        if (widget) {
            console.log(`Real Plauna ${widgetType} widget initialized`);
            toastManager.show(`${displayName} widget loaded`, 'success');
        } else {
            throw new Error(`Failed to create ${widgetType} widget`);
        }
        
    } catch (error) {
        console.error(`Error initializing ${widgetType} widget:`, error);
        widgetContainer.innerHTML = `
            <div style="color: #ef4444; padding: 16px; border: 1px solid #ef4444; border-radius: 4px; background: rgba(239, 68, 68, 0.1);">
                Error loading ${displayName} widget: ${error.message}
            </div>
        `;
        toastManager.show(`Error loading ${displayName} widget`, 'error');
    }
    
    // Open modal
    openModal();
}

// Widgets generate their own options automatically using modular system
function getWidgetOptions(widgetType, toastManager) {
    const baseOptions = {
        onChange: (value) => console.log(`${widgetType} changed:`, value),
        onFocus: () => toastManager.show(`${widgetType} focused`, 'info', 1000),
        onBlur: () => toastManager.show(`${widgetType} blurred`, 'info', 1000)
    };
    
    // Get widget class to use its default options
    const widgetClass = getWidget(widgetType);
    const widgetDefaultOptions = widgetClass ? widgetClass.getDefaultOptions() : {};
    
    // Widget-specific options (override defaults)
    const widgetOptions = {
        search: {
            placeholder: 'Search Plauna widgets...',
            suggestions: ['Search', 'Input', 'Button', 'Checkbox', 'Radio', 'Select', 'Textarea', 'Slider', 'Rating', 'Number', 'Time', 'File', 'Color', 'Date', 'Range', 'Tag', 'Upload'],
            onSearch: (query) => toastManager.show(`Searching: ${query}`, 'success'),
            onSelect: (suggestion) => toastManager.show(`Selected: ${suggestion}`, 'success')
        },
        input: {
            placeholder: 'Type something...',
            maxLength: 100,
            onChange: (value) => {
                if (value.length > 0) toastManager.show(`Text: ${value}`, 'info');
            }
        },
        button: {
            label: 'Click me!',
            onClick: () => toastManager.show('Button clicked!', 'success')
        },
        number: {
            value: 50,
            min: 0,
            max: 100,
            step: 1,
            onChange: (value) => toastManager.show(`Value: ${value}`, 'info'),
            onIncrement: (value) => toastManager.show(`Increased: ${value}`, 'success'),
            onDecrement: (value) => toastManager.show(`Decreased: ${value}`, 'warning')
        },
        tag: {
            placeholder: 'Add tags...',
            suggestions: ['javascript', 'plauna', 'widgets', 'ui', 'framework'],
            onChange: (tags) => toastManager.show(`Tags: ${tags.join(', ')}`, 'info')
        },
        upload: {
            accept: 'image/*,.pdf,.doc,.docx',
            multiple: true,
            maxSize: 5 * 1024 * 1024,
            onChange: (files) => {
                const fileNames = Array.from(files).map(f => f.name).join(', ');
                toastManager.show(`Files: ${fileNames}`, 'info');
            },
            onUpload: (files) => toastManager.show(`Uploaded ${files.length} files`, 'success')
        },
        checkbox: {
            label: 'Accept terms and conditions',
            checked: false,
            onChange: (checked) => toastManager.show(`Checkbox ${checked ? 'checked' : 'unchecked'}`, 'info')
        },
        radio: {
            label: 'Choose option',
            options: ['Option 1', 'Option 2', 'Option 3'],
            selected: 0,
            onChange: (index) => toastManager.show(`Radio option ${index + 1} selected`, 'info')
        },
        switch: {
            label: 'Enable notifications',
            checked: true,
            onChange: (checked) => toastManager.show(`Switch ${checked ? 'on' : 'off'}`, 'info')
        },
        select: {
            placeholder: 'Choose an option...',
            options: ['First option', 'Second option', 'Third option'],
            onChange: (value) => toastManager.show(`Selected: ${value}`, 'info')
        },
        textarea: {
            placeholder: 'Enter your message here...',
            rows: 4,
            maxLength: 500,
            onChange: (value) => toastManager.show(`Text length: ${value.length}`, 'info')
        },
        slider: {
            min: 0,
            max: 100,
            value: 50,
            step: 1,
            onChange: (value) => toastManager.show(`Slider value: ${value}`, 'info')
        },
        rating: {
            max: 5,
            value: 3,
            onChange: (rating) => toastManager.show(`Rating: ${rating} stars`, 'info')
        },
        color: {
            value: '#3b82f6',
            onChange: (color) => toastManager.show(`Color: ${color}`, 'info')
        },
        date: {
            value: new Date().toISOString().split('T')[0],
            onChange: (date) => toastManager.show(`Date: ${date}`, 'info')
        },
        time: {
            value: '12:00',
            onChange: (time) => toastManager.show(`Time: ${time}`, 'info')
        },
        range: {
            min: 0,
            max: 100,
            value: [25, 75],
            onChange: (values) => toastManager.show(`Range: ${values[0]} - ${values[1]}`, 'info')
        },
        file: {
            accept: '*',
            multiple: false,
            onChange: (files) => {
                const fileName = files[0]?.name || 'No file selected';
                toastManager.show(`File: ${fileName}`, 'info');
            }
        }
    };
    
    // Merge options in priority order: base -> widget defaults -> specific overrides
    return { 
        ...baseOptions, 
        ...widgetDefaultOptions, 
        ...(widgetOptions[widgetType] || {}) 
    };
}

function createSearchWidget(type, triggerButton, toastManager) {
    // Plauna philosophy: 1 line of code to show any widget
    showWidgetDemo('search', toastManager);
}

function createTagWidget(type, triggerButton, toastManager) {
    // Plauna philosophy: 1 line of code to show any widget
    showWidgetDemo('tag', toastManager);
}

function createUploadWidget(type, triggerButton, toastManager) {
    // Plauna philosophy: 1 line of code to show any widget
    showWidgetDemo('upload', toastManager);
}

function createNumberWidget(type, triggerButton, toastManager) {
    // Plauna philosophy: 1 line of code to show any widget
    showWidgetDemo('number', toastManager);
}

function createInputWidget(type, triggerButton, toastManager) {
    // Plauna philosophy: 1 line of code to show any widget
    showWidgetDemo('input', toastManager);
}

function createButtonWidget(type, triggerButton, toastManager) {
    // Plauna philosophy: 1 line of code to show any widget
    showWidgetDemo('button', toastManager);
}

// Remaining widget functions following Plauna philosophy
function createCheckboxWidget(type, triggerButton, toastManager) {
    showWidgetDemo('checkbox', toastManager);
}

function createRadioWidget(type, triggerButton, toastManager) {
    showWidgetDemo('radio', toastManager);
}

function createSwitchWidget(type, triggerButton, toastManager) {
    showWidgetDemo('switch', toastManager);
}

function createSelectWidget(type, triggerButton, toastManager) {
    showWidgetDemo('select', toastManager);
}

function createTextareaWidget(type, triggerButton, toastManager) {
    showWidgetDemo('textarea', toastManager);
}

function createSliderWidget(type, triggerButton, toastManager) {
    showWidgetDemo('slider', toastManager);
}

function createRatingWidget(type, triggerButton, toastManager) {
    showWidgetDemo('rating', toastManager);
}

function createColorWidget(type, triggerButton, toastManager) {
    showWidgetDemo('color', toastManager);
}

function createDateWidget(type, triggerButton, toastManager) {
    showWidgetDemo('date', toastManager);
}

function createTimeWidget(type, triggerButton, toastManager) {
    showWidgetDemo('time', toastManager);
}

function createRangeWidget(type, triggerButton, toastManager) {
    showWidgetDemo('range', toastManager);
}

function createFileWidget(type, triggerButton, toastManager) {
    showWidgetDemo('file', toastManager);
}

export function buildBackdropController(canvas, logger, options = {}) {
    const gpu = {
        canvas,
        deviceLease: null,
        device: null,
        context: null,
        format: null,
        pipeline: null,
        bindGroup: null,
        uniformBuffer: null
    };
    let destroyed = false;
    let initialized = false;
    let lifecycleGeneration = 0;
    let initializePromise = null;

    function lifecycleError() {
        const error = new Error('Plauna workbench backdrop lifecycle was revoked');
        error.code = 'PLAUNA_BACKDROP_DESTROYED';
        return error;
    }

    function releaseGpuState() {
        initialized = false;
        try { gpu.uniformBuffer?.destroy(); } catch (_) {}
        try { gpu.context?.unconfigure?.(); } catch (_) {}
        try { gpu.deviceLease?.release?.(); } catch (_) {}
        gpu.deviceLease = null;
        gpu.device = null;
        gpu.context = null;
        gpu.format = null;
        gpu.pipeline = null;
        gpu.bindGroup = null;
        gpu.uniformBuffer = null;
    }

    function initialize() {
        if (destroyed) return Promise.reject(lifecycleError());
        if (initialized) return Promise.resolve(true);
        if (initializePromise) return initializePromise;
        const generation = ++lifecycleGeneration;
        let tracked;
        tracked = initializeGeneration(generation).catch(error => {
            if (generation === lifecycleGeneration) releaseGpuState();
            throw error;
        }).finally(() => {
            if (initializePromise === tracked) initializePromise = null;
        });
        initializePromise = tracked;
        return tracked;
    }

    async function initializeGeneration(generation) {
        if (!('gpu' in navigator) && !options.gpuLeaseFactory) {
            logger.warn('WebGPU not available; using DOM-only fallback');
            return false;
        }

        const candidateLease = await (options.gpuLeaseFactory || acquireGpuDeviceForConsumer)({
            ownerId: 'plauna-workbench-backdrop',
            device: options.gpuDevice || options.device || null,
            ownership: options.deviceOwnership || options.ownership || null,
            ownsDevice: options.ownsDevice === true,
            profile: options.gpuProfile || options.profile || 'baseline-render',
            label: 'PlaunaLabBackdrop.device',
        });
        if (destroyed || generation !== lifecycleGeneration) {
            try { candidateLease?.release?.(); } catch (_) {}
            throw lifecycleError();
        }
        gpu.deviceLease = candidateLease;
        gpu.device = candidateLease.device;
        gpu.context = canvas.getContext('webgpu');
        gpu.format = options.format
            || navigator.gpu?.getPreferredCanvasFormat?.()
            || 'bgra8unorm';
        resize();
        gpu.context.configure({
            device: gpu.device,
            format: gpu.format,
            alphaMode: 'opaque'
        });

        const shader = gpu.device.createShaderModule({
            label: 'PlaunaLabBackdropShader',
            code: `
                struct VsOut {
                    @builtin(position) position: vec4f,
                    @location(0) uv: vec2f,
                };

                struct Uniforms {
                    resolution: vec2f,
                    time: f32,
                    mode: f32,
                };

                @group(0) @binding(0) var<uniform> uniforms: Uniforms;

                @vertex
                fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VsOut {
                    var positions = array<vec2f, 3>(
                        vec2f(-1.0, -3.0),
                        vec2f(-1.0, 1.0),
                        vec2f(3.0, 1.0)
                    );
                    var out: VsOut;
                    let pos = positions[vertex_index];
                    out.position = vec4f(pos, 0.0, 1.0);
                    out.uv = pos * 0.5 + vec2f(0.5, 0.5);
                    return out;
                }

                fn hash21(p: vec2f) -> f32 {
                    let h = dot(p, vec2f(127.1, 311.7));
                    return fract(sin(h) * 43758.5453123);
                }

                fn noise(p: vec2f) -> f32 {
                    let i = floor(p);
                    let f = fract(p);
                    let a = hash21(i);
                    let b = hash21(i + vec2f(1.0, 0.0));
                    let c = hash21(i + vec2f(0.0, 1.0));
                    let d = hash21(i + vec2f(1.0, 1.0));
                    let u = f * f * (3.0 - 2.0 * f);
                    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
                }

                fn fbm(p: vec2f) -> f32 {
                    var value = 0.0;
                    var amplitude = 0.5;
                    var q = p;
                    for (var i = 0; i < 4; i = i + 1) {
                        value += amplitude * noise(q);
                        q *= 2.03;
                        amplitude *= 0.5;
                    }
                    return value;
                }

                @fragment
                fn fs_main(in: VsOut) -> @location(0) vec4f {
                    let uv = in.uv;
                    let aspect = uniforms.resolution.x / max(uniforms.resolution.y, 1.0);
                    let p = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5);
                    let t = uniforms.time * 0.12;
                    let field = fbm(p * 5.0 + vec2f(t, -t * 0.6));
                    let glowA = exp(-length(p - vec2f(-0.28, 0.12)) * 5.2);
                    let glowB = exp(-length(p - vec2f(0.34, -0.24)) * 4.4);
                    let band = smoothstep(0.18, 0.92, field);
                    let base = vec3f(0.025, 0.04, 0.08);
                    let cyan = vec3f(0.08, 0.56, 0.92) * (glowA * 0.9 + band * 0.38);
                    let amber = vec3f(0.95, 0.54, 0.16) * (glowB * 0.55 + band * 0.12);
                    let grid = 0.02 * sin(uv.x * uniforms.resolution.x * 0.08) * sin(uv.y * uniforms.resolution.y * 0.08);
                    let color = base + cyan + amber + vec3f(grid);
                    return vec4f(color, 1.0);
                }
            `
        });

        gpu.uniformBuffer = gpu.device.createBuffer({
            label: 'PlaunaLabBackdropUniforms',
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        gpu.pipeline = gpu.device.createRenderPipeline({
            label: 'PlaunaLabBackdropPipeline',
            layout: 'auto',
            vertex: { module: shader, entryPoint: 'vs_main' },
            fragment: { module: shader, entryPoint: 'fs_main', targets: [{ format: gpu.format }] },
            primitive: { topology: 'triangle-list' }
        });
        gpu.bindGroup = gpu.device.createBindGroup({
            layout: gpu.pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: gpu.uniformBuffer } }]
        });

        logger.info('WebGPU backdrop initialized', {
            format: gpu.format,
            ownership: gpu.deviceLease.ownership,
        });
        initialized = true;
        return true;
    }

    function resize() {
        if (!gpu.device || !gpu.context) {
            return;
        }
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
        const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
        if (canvas.width === width && canvas.height === height) {
            return;
        }
        canvas.width = width;
        canvas.height = height;
    }

    function render(time) {
        if (!gpu.device || !gpu.context || !gpu.pipeline || !gpu.bindGroup) {
            return;
        }
        resize();
        gpu.device.queue.writeBuffer(gpu.uniformBuffer, 0, new Float32Array([canvas.width, canvas.height, time, 0]));
        const encoder = gpu.device.createCommandEncoder({ label: 'PlaunaLabBackdropEncoder' });
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: gpu.context.getCurrentTexture().createView(),
                clearValue: { r: 0.01, g: 0.02, b: 0.04, a: 1 },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });
        pass.setPipeline(gpu.pipeline);
        pass.setBindGroup(0, gpu.bindGroup);
        pass.draw(3, 1, 0, 0);
        pass.end();
        gpu.device.queue.submit([encoder.finish()]);
    }

    function destroy() {
        if (destroyed) return false;
        destroyed = true;
        lifecycleGeneration += 1;
        releaseGpuState();
        return true;
    }

    return { initialize, resize, render, destroy };
}

function createLabState(elements, logger) {
    const outlines = [];
    const particles = [];
    const uiLayer = elements.plaunaRoot.querySelector('#layout-stage-ui');
    const particleLayer = elements.plaunaRoot.querySelector('#particle-layer');
    const stageElement = elements.plaunaRoot.querySelector('#layout-stage');

    for (let index = 0; index < OUTLINE_COUNT; index += 1) {
        const outline = document.createElement('div');
        outline.className = 'plauna-stage__outline';
        outline.style.opacity = '0';
        outline.innerHTML = '<span class="plauna-stage__label"></span>';
        uiLayer.appendChild(outline);
        outlines.push(outline);
    }

    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
        const particle = document.createElement('div');
        particle.className = 'plauna-stage__particle';
        const x = randomBetween(0, stageElement.clientWidth || 600);
        const y = randomBetween(0, stageElement.clientHeight || 320);
        particle.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1)`;
        particleLayer.appendChild(particle);
        particles.push({
            element: particle,
            x,
            y,
            vx: randomBetween(-8, 8),
            vy: randomBetween(-8, 8),
            targetX: x,
            targetY: y,
            jitter: randomBetween(0.8, 1.7),
            phase: randomBetween(0, Math.PI * 2),
            scale: randomBetween(0.7, 1.45),
            pressure: 0,
            slither: randomBetween(-1, 1)
        });
    }

    logger.info('Plauna lab shell mounted', { particles: particles.length, outlines: outlines.length });
    return {
        outlines,
        particles,
        pretextParticles: [],
        pretextObstacles: [],
        pretextMask: null,
        stageRect: { width: 0, height: 0 },
        particleObstacles: [],
        activeDesign: 'editor',
        activeTheme: 'dark',
        lastLayout: null,
        lastSurface: null,
        plaunaApp: null,
        toastManager: null,
        rafId: 0,
        consolePeek: false,
        autoCycle: false,
        autoCycleTimer: 0,
        fps: 0,
        fpsFrames: 0,
        fpsLastTime: 0,
        pointerIntent: {
            lastX: 0,
            lastY: 0,
            lastTime: 0,
            speed: Infinity,
            settleTimer: 0
        }
    };
}

function pointInsideRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function buildParticleObstacle(rect, inset = 16) {
    return {
        left: rect.left + inset,
        top: rect.top + inset,
        right: rect.left + rect.width - inset,
        bottom: rect.top + rect.height - inset
    };
}

function getPerimeterTarget(rect, slot, totalSlots, padding = 14) {
    const left = rect.left - padding;
    const top = rect.top - padding;
    const right = rect.left + rect.width + padding;
    const bottom = rect.top + rect.height + padding;
    const width = right - left;
    const height = bottom - top;
    const perimeter = width * 2 + height * 2;
    const t = ((slot % totalSlots) / totalSlots) * perimeter;

    if (t < width) {
        return { x: left + t, y: top };
    }
    if (t < width + height) {
        return { x: right, y: top + (t - width) };
    }
    if (t < width * 2 + height) {
        return { x: right - (t - width - height), y: bottom };
    }
    return { x: left, y: bottom - (t - width * 2 - height) };
}

function resolveParticleObstacleCollision(particle, obstacle, bounce = 0.18) {
    if (!pointInsideRect(particle.x, particle.y, obstacle)) {
        return;
    }

    const pushLeft = particle.x - obstacle.left;
    const pushRight = obstacle.right - particle.x;
    const pushTop = particle.y - obstacle.top;
    const pushBottom = obstacle.bottom - particle.y;
    const minPush = Math.min(pushLeft, pushRight, pushTop, pushBottom);

    if (minPush === pushLeft) {
        particle.x = obstacle.left;
        particle.vx = -Math.abs(particle.vx) * bounce;
        particle.vy *= 0.96;
    } else if (minPush === pushRight) {
        particle.x = obstacle.right;
        particle.vx = Math.abs(particle.vx) * bounce;
        particle.vy *= 0.96;
    } else if (minPush === pushTop) {
        particle.y = obstacle.top;
        particle.vy = -Math.abs(particle.vy) * bounce;
        particle.vx *= 0.96;
    } else {
        particle.y = obstacle.bottom;
        particle.vy = Math.abs(particle.vy) * bounce;
        particle.vx *= 0.96;
    }
}

function initializePretextParticles(container, state) {
    if (!container || state.pretextParticles.length > 0) {
        return;
    }

    for (let index = 0; index < PRETEXT_PARTICLE_COUNT; index += 1) {
        const element = document.createElement('div');
        element.className = 'plauna-pretext-particle';
        const x = randomBetween(0, container.clientWidth || 320);
        const y = randomBetween(0, container.clientHeight || 140);
        element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        container.appendChild(element);
        state.pretextParticles.push({
            element,
            x,
            y,
            vx: randomBetween(-3, 3),
            vy: randomBetween(-3, 3),
            targetX: x,
            targetY: y,
            jitter: randomBetween(0.4, 1.2),
            phase: randomBetween(0, Math.PI * 2),
            scale: randomBetween(0.7, 1.3),
            pressure: 0,
            slither: randomBetween(-1, 1)
        });
    }
}

function applyThemeVariables(target, themeTokens) {
    if (!target || !themeTokens || !themeTokens.colors) {
        return;
    }

    const colors = themeTokens.colors;
    const shadows = themeTokens.shadows || {};
    const variables = {
        '--bg-primary': colors.background && colors.background.primary,
        '--bg-secondary': colors.background && colors.background.secondary,
        '--bg-tertiary': colors.background && colors.background.tertiary,
        '--bg-quaternary': colors.background && colors.background.inverse,
        '--text-primary': colors.text && colors.text.primary,
        '--text-secondary': colors.text && colors.text.secondary,
        '--text-muted': colors.text && colors.text.tertiary,
        '--border-subtle': colors.background && colors.background.tertiary,
        '--border-medium': colors.text && colors.text.disabled,
        '--accent-primary': colors.primary && colors.primary[500],
        '--accent-secondary': colors.primary && colors.primary[300],
        '--accent-warning': colors.warning,
        '--accent-error': colors.error,
        '--shadow-md': shadows.md,
        '--shadow-lg': shadows.lg
    };

    for (const [name, value] of Object.entries(variables)) {
        if (value) {
            target.style.setProperty(name, value);
        }
    }
}

// Global reference to the themed modal styles function
let globalCreateThemedModalStyles = null;

// Global wrapper function for demo functions to access
function createThemedModalStyles() {
    if (globalCreateThemedModalStyles) {
        try {
            const result = globalCreateThemedModalStyles();
            // Ensure the result has all required properties
            if (!result.spacing || !result.borderRadius) {
                console.warn('Theme result missing properties, using fallback');
                return getFallbackTheme();
            }
            return result;
        } catch (error) {
            console.error('Error getting theme:', error);
            return getFallbackTheme();
        }
    }
    // Fallback if not initialized yet
    return getFallbackTheme();
}

// Helper function for fallback theme
function getFallbackTheme() {
    return {
        background: 'rgba(15, 23, 42, 0.95)',
        border: 'rgba(99, 116, 141, 0.3)',
        text: '#e4e4e7',
        textSecondary: '#94a3b8',
        accent: '#3b82f6',
        accentHover: '#60a5fa',
        colors: {
            background: { primary: '#0f172a', secondary: '#1e293b', tertiary: '#334155', inverse: '#ffffff' },
            text: { primary: '#f8fafc', secondary: '#cbd5e1', tertiary: '#64748b', disabled: '#475569' },
            primary: { 500: '#3b82f6', 300: '#93c5fd' },
            warning: '#f59e0b',
            error: '#ef4444',
            success: '#10b981'
        },
        spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px', xxxl: '48px' },
        borderRadius: { sm: '4px', md: '8px', lg: '12px', xl: '16px' },
        fontSizes: { xs: '12px', sm: '14px', md: '16px', lg: '18px', xl: '20px' },
        fontWeights: { normal: '400', medium: '500', semibold: '600', bold: '700' }
    };
}

function buildPretextMask({ lines, containerWidth, fontSize, fontWeight, lineHeight }) {
    const horizontalPadding = 14;
    const verticalPadding = 14;
    const haloRadius = Math.max(4, Math.round(fontSize * 0.22));
    const width = Math.max(1, Math.ceil(containerWidth));
    const height = Math.max(120, Math.ceil(lines.length * lineHeight + verticalPadding * 2));

    const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${fontWeight} ${fontSize}px Inter`;

    const lineRects = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const y = verticalPadding + index * lineHeight;
        const baselineY = y + fontSize;
        ctx.fillText(line.text, horizontalPadding, baselineY);
        lineRects.push({
            left: horizontalPadding,
            top: y,
            right: horizontalPadding + Math.ceil(line.width),
            bottom: y + lineHeight
        });
    }

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const contourPoints = [];
    const threshold = 20;
    const step = 3;
    const haloMask = new Uint8Array(width * height);
    const alphaAt = (x, y) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return 0;
        return data[(y * width + x) * 4 + 3];
    };

    const haloAt = (x, y) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return 0;
        return haloMask[y * width + x];
    };

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (alphaAt(x, y) <= threshold) continue;
            for (let oy = -haloRadius; oy <= haloRadius; oy += 1) {
                for (let ox = -haloRadius; ox <= haloRadius; ox += 1) {
                    if (ox * ox + oy * oy > haloRadius * haloRadius) continue;
                    const nx = x + ox;
                    const ny = y + oy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                    haloMask[ny * width + nx] = 1;
                }
            }
        }
    }

    for (let y = 1; y < height - 1; y += step) {
        for (let x = 1; x < width - 1; x += step) {
            const alpha = haloAt(x, y);
            if (alpha <= 0) continue;
            if (
                haloAt(x - 1, y) <= 0 ||
                haloAt(x + 1, y) <= 0 ||
                haloAt(x, y - 1) <= 0 ||
                haloAt(x, y + 1) <= 0
            ) {
                contourPoints.push({ x, y });
            }
        }
    }

    return {
        width,
        height,
        alphaAt,
        haloAt,
        contourPoints,
        lineRects
    };
}

function resolvePretextMaskCollision(particle, mask) {
    if (!mask) return;
    const px = Math.round(particle.x);
    const py = Math.round(particle.y);
    if (mask.haloAt(px, py) <= 0) {
        return;
    }

    const directions = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1]
    ];

    for (let radius = 1; radius <= 18; radius += 1) {
        for (const [dx, dy] of directions) {
            const nx = px + dx * radius;
            const ny = py + dy * radius;
            if (mask.haloAt(nx, ny) <= 0) {
                particle.x = nx;
                particle.y = ny;
                particle.vx -= dx * 0.6;
                particle.vy -= dy * 0.6;
                return;
            }
        }
    }
}

function clampMagnitude(x, y, maxMagnitude) {
    const magnitude = Math.hypot(x, y);
    if (magnitude <= maxMagnitude || magnitude === 0) {
        return { x, y };
    }

    const scale = maxMagnitude / magnitude;
    return { x: x * scale, y: y * scale };
}

function computeBoidSteering(particles, particle, radius, maxForce) {
    let separationX = 0;
    let separationY = 0;
    let alignmentX = 0;
    let alignmentY = 0;
    let cohesionX = 0;
    let cohesionY = 0;
    let count = 0;

    for (const other of particles) {
        if (other === particle) continue;
        const dx = particle.x - other.x;
        const dy = particle.y - other.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= 0.001 || distance > radius) continue;
        const inv = 1 / distance;
        const weight = 1 - distance / radius;
        separationX += dx * inv * weight;
        separationY += dy * inv * weight;
        alignmentX += other.vx;
        alignmentY += other.vy;
        cohesionX += other.x;
        cohesionY += other.y;
        count += 1;
    }

    if (count === 0) {
        return { x: 0, y: 0 };
    }

    alignmentX = alignmentX / count - particle.vx;
    alignmentY = alignmentY / count - particle.vy;
    cohesionX = cohesionX / count - particle.x;
    cohesionY = cohesionY / count - particle.y;

    const combinedX = separationX * 1.9 + alignmentX * 0.12 + cohesionX * 0.004;
    const combinedY = separationY * 1.9 + alignmentY * 0.12 + cohesionY * 0.004;
    return clampMagnitude(combinedX, combinedY, maxForce);
}

function computeRectFlowForce(particle, obstacles, padding = 20) {
    let forceX = 0;
    let forceY = 0;
    let pressureInput = 0;

    for (const obstacle of obstacles) {
        const cx = Math.max(obstacle.left, Math.min(particle.x, obstacle.right));
        const cy = Math.max(obstacle.top, Math.min(particle.y, obstacle.bottom));
        const dx = particle.x - cx;
        const dy = particle.y - cy;
        const distance = Math.hypot(dx, dy);
        const inside = pointInsideRect(particle.x, particle.y, obstacle);
        const influence = inside ? 1 : Math.max(0, 1 - distance / padding);
        if (influence <= 0) continue;

        const nx = inside ? (particle.x < (obstacle.left + obstacle.right) * 0.5 ? -1 : 1) : dx / Math.max(distance, 0.001);
        const ny = inside ? (particle.y < (obstacle.top + obstacle.bottom) * 0.5 ? -1 : 1) : dy / Math.max(distance, 0.001);
        const tangentX = -ny * particle.slither;
        const tangentY = nx * particle.slither;
        const pressureFactor = Math.min(1, particle.pressure / 1.1);
        const repelScale = inside ? (0.72 - pressureFactor * 0.42) : influence * 0.46;
        const tangentScale = 0.45 + influence * 1.05 + pressureFactor * 0.52;
        forceX += nx * repelScale + tangentX * tangentScale;
        forceY += ny * repelScale + tangentY * tangentScale;
        pressureInput = Math.max(pressureInput, inside ? 0.85 : influence * 0.24);
    }

    return { forceX, forceY, pressureInput };
}

function computeMaskFlowForce(particle, mask) {
    if (!mask) {
        return { forceX: 0, forceY: 0, pressureInput: 0 };
    }

    const px = Math.round(particle.x);
    const py = Math.round(particle.y);
    let gradientX = 0;
    let gradientY = 0;
    const sampleStep = 3;
    for (let offset = 1; offset <= sampleStep; offset += 1) {
        gradientX += mask.haloAt(px + offset, py) - mask.haloAt(px - offset, py);
        gradientY += mask.haloAt(px, py + offset) - mask.haloAt(px, py - offset);
    }

    const insideAlpha = mask.haloAt(px, py) > 0 ? 255 : 0;
    const magnitude = Math.hypot(gradientX, gradientY);
    if (magnitude <= 0.001 && insideAlpha <= 20) {
        return { forceX: 0, forceY: 0, pressureInput: 0 };
    }

    const nx = magnitude > 0.001 ? -gradientX / magnitude : 0;
    const ny = magnitude > 0.001 ? -gradientY / magnitude : -1;
    const tangentX = -ny * particle.slither;
    const tangentY = nx * particle.slither;
    const inside = insideAlpha > 20;
    const pressureFactor = Math.min(1, particle.pressure / 1.1);
    const repelScale = inside ? (0.68 - pressureFactor * 0.34) : 0.2;
    const tangentScale = inside ? (0.9 + pressureFactor * 0.62) : 0.42;
    return {
        forceX: nx * repelScale + tangentX * tangentScale,
        forceY: ny * repelScale + tangentY * tangentScale,
        pressureInput: inside ? 0.8 : Math.min(0.18, insideAlpha / 255)
    };
}

function updatePressure(particle, pressureInput, dt) {
    const rise = pressureInput > 0 ? pressureInput * dt * 1.5 : -dt * 2.2;
    particle.pressure = Math.max(0, Math.min(1.1, particle.pressure + rise));
}

function bounceWithinBounds(particle, minX, minY, maxX, maxY, damping = 0.72) {
    if (particle.x <= minX) {
        particle.x = minX;
        particle.vx = Math.abs(particle.vx) * damping;
    } else if (particle.x >= maxX) {
        particle.x = maxX;
        particle.vx = -Math.abs(particle.vx) * damping;
    }
    if (particle.y <= minY) {
        particle.y = minY;
        particle.vy = Math.abs(particle.vy) * damping;
    } else if (particle.y >= maxY) {
        particle.y = maxY;
        particle.vy = -Math.abs(particle.vy) * damping;
    }
}

// Simple counter for unique IDs
let widgetIdCounter = 0;

// Widget mapping system using new modular registry
const widgetMap = new Map();

// Initialize widget map from modular system
function initializeWidgetMap() {
    const allWidgets = getAllWidgets();
    for (const widgetClass of allWidgets) {
        widgetMap.set(widgetClass.id, (id, options) => createWidget(widgetClass.id, null, options));
    }
}

// Initialize on load
initializeWidgetMap();

// Widget container class using Plauna's UINode system
class WidgetContainer extends UINode {
    constructor(widgetType, options = {}) {
        super(`widget-${widgetType}`, 'widget-container');
        this.widgetType = widgetType;
        this.widget = null;
        this.options = options;
        
        this.setupContainer();
        this.createWidget();
    }
    
    setupContainer() {
        // Set container styles
        this.setStyles({
            display: 'flex',
            flexDirection: 'column',
            gap: 'spacing.md',
            padding: 'spacing.lg',
            backgroundColor: 'color(background.primary)',
            borderRadius: 'radius.lg',
            border: `1px solid color(border.medium)`,
            minWidth: '300px',
            maxWidth: '500px'
        });
    }
    
    createWidget() {
        if (!widgetMap[this.widgetType]) {
            console.warn(`Unknown widget type: ${this.widgetType}`);
            return;
        }
        
        try {
            // Generate unique ID using simple counter
            const uniqueId = ++widgetIdCounter;
            const widgetId = `workbench-${this.widgetType}-${uniqueId}`;
            
            console.log(`Creating widget ${this.widgetType} with ID: ${widgetId}`);
            console.log(`Widget constructor available:`, typeof widgetMap[this.widgetType]);
            
            this.widget = widgetMap[this.widgetType](widgetId, this.options);
            
            console.log(`Widget created successfully:`, this.widget);
            
            // Set up widget event handlers
            this.setupWidgetEvents();
            
            // Add widget to container
            this.addChild(this.widget);
            
        } catch (error) {
            console.error(`Error creating widget ${this.widgetType}:`, error);
            console.error(`Error details:`, error.stack);
        }
    }
    
    setupWidgetEvents() {
        if (!this.widget) return;
        
        // Common event handlers for all widgets
        if (this.widget.onChange) {
            this.widget.onChange = (value) => {
                console.log(`${this.widgetType} changed:`, value);
                if (this.options.onChange) {
                    this.options.onChange(value);
                }
            };
        }
        
        if (this.widget.onClick) {
            this.widget.onClick = () => {
                console.log(`${this.widgetType} clicked`);
                if (this.options.onClick) {
                    this.options.onClick();
                }
            };
        }
    }
    
    getWidget() {
        return this.widget;
    }
}

// Workbench VisualTree and Renderer management
let workbenchVisualTree = null;
let workbenchRenderer = null;
let workbenchRendererOwner = null;

function initializeWorkbenchRenderer(container, textService, owner = null) {
    if (workbenchRenderer) {
        if (!owner || owner === workbenchRendererOwner) return workbenchRenderer;
        destroyWorkbenchRenderer(workbenchRendererOwner);
    }
    
    workbenchVisualTree = new VisualTree();
    workbenchRenderer = new DOMRenderer({
        container: container,
        textService: textService,
        usePretext: true
    });
    workbenchRendererOwner = owner;
    
    return workbenchRenderer;
}

function destroyWorkbenchRenderer(owner = null) {
    if (owner && workbenchRendererOwner && owner !== workbenchRendererOwner) return false;
    try { workbenchVisualTree?.destroy?.(); } catch (_) {}
    try { workbenchRenderer?.destroy?.(); } catch (_) {}
    workbenchVisualTree = null;
    workbenchRenderer = null;
    workbenchRendererOwner = null;
    return true;
}

function showWidgetInContainer(widgetType, container, options = {}) {
    console.log(`showWidgetInContainer called for: ${widgetType}`);
    
    if (!workbenchVisualTree || !workbenchRenderer) {
        console.error('Workbench renderer not initialized');
        console.log('workbenchVisualTree:', workbenchVisualTree);
        console.log('workbenchRenderer:', workbenchRenderer);
        return null;
    }
    
    // Clear previous content
    if (workbenchRenderer.container !== container) {
        workbenchRenderer.clear();
        workbenchRenderer.container = container;
    }
    container.innerHTML = '';
    
    console.log(`Creating WidgetContainer for ${widgetType} with options:`, options);
    
    // Create widget container
    const widgetContainer = new WidgetContainer(widgetType, options);
    
    console.log(`WidgetContainer created:`, widgetContainer);
    
    // Set root and render
    workbenchVisualTree.setRoot(widgetContainer);
    workbenchRenderer.render(workbenchVisualTree);
    
    console.log(`Widget rendered to container`);
    
    return widgetContainer.getWidget();
}

export function mountPlaunaWorkbenchLab(options) {
    const {
        root,
        statusElement,
        logger,
        initializePlauna,
        createWorld,
        createEntity,
        setEntityComponent,
        getEntityComponent
    } = options;

    if (!root || !statusElement || !logger) {
        throw new Error('Plauna workbench lab requires root, statusElement, and logger');
    }

    ensureStyles();
    const elements = createShell(root, statusElement);
    renderMarkup(elements.plaunaRoot);
    renderToolbar(elements.plaunaRoot);
    renderDesignCards(elements.plaunaRoot);
    elements.plaunaRoot.classList.add('plauna-root--transparent');

    const backdrop = options.backdropController
        || buildBackdropController(elements.canvas, logger, options);
    const state = createLabState(elements, logger);
    state.toastManager = new ToastManager({ position: 'top-right', defaultDuration: 3000 });
    let destroyed = false;
    let booted = false;
    let lifecycleGeneration = 0;
    let bootPromise = null;
    let demoPromise = null;
    let interactionsAttached = false;
    const interactionCleanups = [];
    const rendererOwner = Symbol('plauna-workbench-renderer-owner');

    function lifecycleError() {
        const error = new Error('Plauna workbench lifecycle was revoked');
        error.code = 'PLAUNA_WORKBENCH_DESTROYED';
        return error;
    }

    function assertLifecycle(generation) {
        if (!destroyed && generation === lifecycleGeneration) return;
        throw lifecycleError();
    }

    function listen(target, type, handler, options) {
        target.addEventListener(type, handler, options);
        interactionCleanups.push(() => target.removeEventListener(type, handler, options));
    }

    function detachInteractions() {
        if (!interactionsAttached) return;
        interactionsAttached = false;
        for (const cleanup of interactionCleanups.splice(0)) {
            try { cleanup(); } catch (_) {}
        }
        clearTimeout(state.pointerIntent.settleTimer);
        state.pointerIntent.settleTimer = 0;
    }

    // Helper function to get current theme tokens for demo functions
    function getThemeTokens() {
        // Check if we have access to the Plauna theme manager
        if (state.plaunaApp?.themeManager) {
            const theme = state.plaunaApp.themeManager.getCurrentTheme();
            if (theme && theme.tokens) {
                return theme.tokens;
            }
        }
        
        // Fallback to CSS custom properties from the document
        const computedStyle = getComputedStyle(document.documentElement);
        
        // Get actual values from CSS variables
        const bgPrimary = computedStyle.getPropertyValue('--bg-primary').trim();
        const textPrimary = computedStyle.getPropertyValue('--text-primary').trim();
        
        // Check if we're in light theme by looking at the background color
        // Light theme typically has white/light backgrounds, dark theme has dark backgrounds
        const isLightTheme = bgPrimary && (
            bgPrimary.includes('255') || 
            bgPrimary.includes('f8') || 
            bgPrimary.includes('fa') ||
            bgPrimary.includes('fc') ||
            bgPrimary.includes('fe') ||
            bgPrimary === '#ffffff' ||
            bgPrimary === '#f8fafc' ||
            bgPrimary.startsWith('rgb(255') ||
            bgPrimary.startsWith('rgba(255')
        );
        
        // Also check text color as a secondary indicator
        const isDarkText = textPrimary && (
            textPrimary.includes('0') ||
            textPrimary.includes('1') ||
            textPrimary.includes('2') ||
            textPrimary === '#0f172a' ||
            textPrimary === '#1e293b' ||
            textPrimary.startsWith('rgb(0') ||
            textPrimary.startsWith('rgb(1') ||
            textPrimary.startsWith('rgb(2')
        );
        
        // Determine theme based on both background and text colors
        const useLightTheme = isLightTheme || isDarkText;
        
        // Set fallback values based on detected theme
        const fallbacks = useLightTheme ? {
            background: {
                primary: '#ffffff',
                secondary: '#f8fafc',
                tertiary: '#f1f5f9',
                inverse: '#0f172a'
            },
            text: {
                primary: '#0f172a',
                secondary: '#475569',
                tertiary: '#64748b',
                disabled: '#94a3b8'
            }
        } : {
            background: {
                primary: '#0f172a',
                secondary: '#1e293b',
                tertiary: '#334155',
                inverse: '#ffffff'
            },
            text: {
                primary: '#f8fafc',
                secondary: '#cbd5e1',
                tertiary: '#64748b',
                disabled: '#475569'
            }
        };
        
        return {
            colors: {
                background: {
                    primary: bgPrimary || fallbacks.background.primary,
                    secondary: computedStyle.getPropertyValue('--bg-secondary').trim() || fallbacks.background.secondary,
                    tertiary: computedStyle.getPropertyValue('--bg-tertiary').trim() || fallbacks.background.tertiary,
                    inverse: computedStyle.getPropertyValue('--bg-quaternary').trim() || fallbacks.background.inverse
                },
                text: {
                    primary: textPrimary || fallbacks.text.primary,
                    secondary: computedStyle.getPropertyValue('--text-secondary').trim() || fallbacks.text.secondary,
                    tertiary: computedStyle.getPropertyValue('--text-muted').trim() || fallbacks.text.tertiary,
                    disabled: computedStyle.getPropertyValue('--border-medium').trim() || fallbacks.text.disabled
                },
                primary: {
                    500: computedStyle.getPropertyValue('--accent-primary').trim() || '#3b82f6',
                    300: computedStyle.getPropertyValue('--accent-secondary').trim() || '#93c5fd'
                },
                warning: computedStyle.getPropertyValue('--accent-warning').trim() || '#f59e0b',
                error: computedStyle.getPropertyValue('--accent-error').trim() || '#ef4444',
                success: '#10b981'
            },
            spacing: {
                xs: '4px',
                sm: '8px',
                md: '16px',
                lg: '24px',
                xl: '32px',
                xxxl: '48px'
            },
            borderRadius: {
                sm: '4px',
                md: '8px',
                lg: '12px',
                xl: '16px'
            },
            fontSizes: {
                xs: '12px',
                sm: '14px',
                md: '16px',
                lg: '18px',
                xl: '20px'
            },
            fontWeights: {
                normal: '400',
                medium: '500',
                semibold: '600',
                bold: '700'
            }
        };
    }

    // Helper function to create theme-aware modal styles
    function createThemedModalStyles() {
        const tokens = getThemeTokens();
        return {
            background: tokens.colors.background.secondary || 'rgba(15, 23, 42, 0.95)',
            border: tokens.colors.text.disabled || 'rgba(99, 116, 141, 0.3)',
            text: tokens.colors.text.primary || '#e4e4e7',
            textSecondary: tokens.colors.text.secondary || '#94a3b8',
            accent: tokens.colors.primary[500] || '#3b82f6',
            accentHover: tokens.colors.primary[300] || '#60a5fa',
            colors: tokens.colors,
            spacing: tokens.spacing,
            borderRadius: tokens.borderRadius,
            fontSizes: tokens.fontSizes,
            fontWeights: tokens.fontWeights
        };
    }

    // Set global reference immediately for demo functions to access
    globalCreateThemedModalStyles = createThemedModalStyles;

    function renderOverview() {
        const overview = elements.plaunaRoot.querySelector('#overview');
        const layout = state.lastLayout;
        const surface = state.lastSurface;
        const fpsValue = state.fps > 0 ? String(state.fps) : '--';
        const cacheSize = state.plaunaApp ? state.plaunaApp.textService.measureCache.size : 0;
        overview.innerHTML = `
            <article class="plauna-metric">
                <div class="plauna-metric__label">Runtime</div>
                <div class="plauna-metric__value">${state.plaunaApp ? 'Live' : 'Booting'}</div>
                <div class="plauna-metric__detail">${state.plaunaApp ? 'Plauna app initialized' : 'Starting Plauna runtime...'}</div>
            </article>
            <article class="plauna-metric">
                <div class="plauna-metric__label">Text Width</div>
                <div class="plauna-metric__value">${layout ? `${Math.round(layout.width)}px` : '--'}</div>
                <div class="plauna-metric__detail">${layout ? `${layout.lineCount} lines · ${cacheSize} cached` : 'No sample measured yet'}</div>
            </article>
            <article class="plauna-metric">
                <div class="plauna-metric__label">Surface</div>
                <div class="plauna-metric__value">${surface ? surface.kind : 'none'}</div>
                <div class="plauna-metric__detail">${surface ? surface.id : 'No surface created yet'}</div>
            </article>
            <article class="plauna-metric">
                <div class="plauna-metric__label">Mode</div>
                <div class="plauna-metric__value">${state.activeDesign}</div>
                <div class="plauna-metric__detail">${state.autoCycle ? 'Auto-cycling presets' : 'Previewing layout'}</div>
            </article>
            <article class="plauna-metric">
                <div class="plauna-metric__label">Theme</div>
                <div class="plauna-metric__value">${state.activeTheme}</div>
                <div class="plauna-metric__detail">Use toolbar to toggle</div>
            </article>
            <article class="plauna-metric">
                <div class="plauna-metric__label">FPS</div>
                <div class="plauna-metric__value" id="fps-value">${fpsValue}</div>
                <div class="plauna-metric__detail">Particle animation loop</div>
            </article>
        `;
    }

    function refreshStageBounds() {
        const stage = elements.plaunaRoot.querySelector('#layout-stage');
        state.stageRect = {
            width: Math.max(320, stage.clientWidth),
            height: Math.max(280, stage.clientHeight)
        };
    }

    function toStageRect(panel) {
        const inset = 18;
        const usableWidth = Math.max(0, state.stageRect.width - inset * 2);
        const usableHeight = Math.max(0, state.stageRect.height - inset * 2);
        return {
            left: inset + panel.x * usableWidth,
            top: inset + panel.y * usableHeight,
            width: Math.max(44, panel.w * usableWidth),
            height: Math.max(32, panel.h * usableHeight)
        };
    }

    function updateOutlines(preset) {
        state.outlines.forEach((outline, index) => {
            const panel = preset.panels[index];
            if (!panel) {
                outline.style.opacity = '0';
                return;
            }
            const rect = toStageRect(panel);
            outline.style.opacity = '1';
            outline.style.left = `${rect.left}px`;
            outline.style.top = `${rect.top}px`;
            outline.style.width = `${rect.width}px`;
            outline.style.height = `${rect.height}px`;
            outline.dataset.tone = panel.tone || '';
            outline.querySelector('.plauna-stage__label').textContent = panel.label;
        });
        elements.plaunaRoot.querySelector('#stage-caption').textContent = `${preset.title} particle assembly`;
    }

    function retargetParticles(preset) {
        const panels = preset.panels.map((panel) => ({ panel, rect: toStageRect(panel) }));
        state.particleObstacles = panels.map(({ rect }) => buildParticleObstacle(rect, 14));
        state.particles.forEach((particle, index) => {
            const ambientBandY = 42 + (index % 3) * Math.max(18, state.stageRect.height * 0.015);
            particle.targetX = randomBetween(18, Math.max(24, state.stageRect.width - 18));
            particle.targetY = ambientBandY + randomBetween(-10, 10);
            particle.vx += randomBetween(-0.08, 0.08);
            particle.vy += randomBetween(-0.05, 0.05);
            particle.scale = randomBetween(0.72, 1.18);
            particle.element.dataset.tone = panels[index % panels.length].panel.tone || '';
        });
    }

    function updateActiveDesign(presetId) {
        refreshStageBounds();
        const preset = getPreset(presetId);
        state.activeDesign = preset.id;
        elements.plaunaRoot.querySelector('#design-badge').textContent = `Active: ${preset.title}`;
        elements.plaunaRoot.querySelector('#footer-status').textContent = `Previewing ${preset.title}.`;
        updateOutlines(preset);
        retargetParticles(preset);
        renderOverview();
        logger.info('Applied design preset', { preset: preset.id, title: preset.title, particleCount: state.particles.length });
        state.toastManager?.show(`Applied ${preset.title} layout`, 'info');
    }

    function animate() {
        if (destroyed || state.rafId) return;
        let lastTime = performance.now();
        const step = (now) => {
            if (destroyed) {
                state.rafId = 0;
                return;
            }
            const dt = runtimeFrameDeltaSeconds(now, lastTime, 0.032);
            lastTime = now;
            backdrop.render(now * 0.001);

            state.fpsFrames += 1;
            if (state.fpsLastTime === 0) state.fpsLastTime = now;
            const fpsDelta = now - state.fpsLastTime;
            if (fpsDelta >= 1000) {
                state.fps = Math.round((state.fpsFrames * 1000) / fpsDelta);
                state.fpsFrames = 0;
                state.fpsLastTime = now;
                const fpsEl = elements.plaunaRoot.querySelector('#fps-value');
                if (fpsEl) fpsEl.textContent = String(state.fps);
            }

            for (const particle of state.particles) {
                const dx = particle.targetX - particle.x;
                const dy = particle.targetY - particle.y;
                const seekX = dx * 3.2 * dt;
                const seekY = dy * 3.2 * dt;
                const flock = computeBoidSteering(state.particles, particle, 42, 0.42);
                const flow = computeRectFlowForce(particle, state.particleObstacles, 22);
                updatePressure(particle, flow.pressureInput, dt);
                particle.vx += seekX + flock.x + flow.forceX * (0.55 + particle.pressure * 0.08);
                particle.vy += seekY + flock.y + flow.forceY * (0.55 + particle.pressure * 0.08);
                const stageVelocity = clampMagnitude(particle.vx, particle.vy, 3.2 + particle.pressure * 1.5);
                particle.vx = stageVelocity.x * 0.92;
                particle.vy = stageVelocity.y * 0.92;
                particle.phase += dt * particle.jitter * 2.1;
                particle.x += particle.vx + Math.cos(particle.phase) * particle.jitter * (0.12 + particle.pressure * 0.05);
                particle.y += particle.vy + Math.sin(particle.phase) * particle.jitter * (0.08 + particle.pressure * 0.08);
                bounceWithinBounds(particle, -10, -10, state.stageRect.width + 10, state.stageRect.height + 10, 0.68);
                const pulse = 0.9 + Math.sin(particle.phase * 1.8) * 0.08;
                particle.element.style.transform = `translate3d(${particle.x}px, ${particle.y}px, 0) scale(${particle.scale * pulse})`;
                particle.element.style.opacity = String(0.14 + pulse * 0.22 + Math.min(0.18, particle.pressure * 0.08));
            }

            const previewStage = elements.plaunaRoot.querySelector('#pretext-preview-stage');
            if (previewStage) {
                const maxX = previewStage.clientWidth || 320;
                const maxY = previewStage.clientHeight || 140;
                for (const particle of state.pretextParticles) {
                    const dx = particle.targetX - particle.x;
                    const dy = particle.targetY - particle.y;
                    const seekX = dx * 4.6 * dt;
                    const seekY = dy * 4.6 * dt;
                    const flock = computeBoidSteering(state.pretextParticles, particle, 24, 0.34);
                    const flow = computeMaskFlowForce(particle, state.pretextMask);
                    updatePressure(particle, flow.pressureInput, dt);
                    particle.vx += seekX + flock.x + flow.forceX * (0.92 + particle.pressure * 0.18);
                    particle.vy += seekY + flock.y + flow.forceY * (0.92 + particle.pressure * 0.18);
                    const previewVelocity = clampMagnitude(particle.vx, particle.vy, 2.6 + particle.pressure * 1.7);
                    particle.vx = previewVelocity.x * 0.91;
                    particle.vy = previewVelocity.y * 0.91;
                    particle.phase += dt * particle.jitter * 2.4;
                    particle.x += particle.vx + Math.cos(particle.phase) * particle.jitter * (0.18 + particle.pressure * 0.06);
                    particle.y += particle.vy + Math.sin(particle.phase) * particle.jitter * (0.22 + particle.pressure * 0.08);
                    resolvePretextMaskCollision(particle, state.pretextMask);
                    bounceWithinBounds(particle, 2, 2, maxX - 2, maxY - 2, 0.74);
                    const pulse = 0.86 + Math.sin(particle.phase * 1.6) * 0.18;
                    particle.element.style.transform = `translate3d(${particle.x}px, ${particle.y}px, 0) scale(${particle.scale * pulse})`;
                    particle.element.style.opacity = String(0.22 + pulse * 0.44 + Math.min(0.2, particle.pressure * 0.08));
                }
            }
            if (!destroyed) state.rafId = requestAnimationFrame(step);
        };
        state.rafId = requestAnimationFrame(step);
    }

    async function runSmokeTests(generation = lifecycleGeneration) {
        assertLifecycle(generation);
        logger.info('Running Plauna smoke tests');
        const tests = [
            { name: 'Bootstrap initializePlauna export', run: () => typeof initializePlauna === 'function' },
            { name: 'Engine ECS helpers available', run: () => [createWorld, createEntity, setEntityComponent, getEntityComponent].every((fn) => typeof fn === 'function') },
            { name: 'Plauna module exports createPlaunaApp', run: async () => typeof createPlaunaApp === 'function' },
            {
                name: 'Plauna ECS component registration',
                run: async () => {
                    const world = createWorld({ name: 'PlaunaSmoke' });
                    const entity = createEntity(world);
                    const components = await import('../ecs/components.js');
                    setEntityComponent(world, entity, components.UIWorkspace.name, { id: 'smoke', label: 'Smoke' });
                    const component = getEntityComponent(world, entity, components.UIWorkspace.name);
                    return component?.id === 'smoke';
                }
            }
        ];

        let passed = 0;
        for (const test of tests) {
            try {
                const result = await test.run();
                assertLifecycle(generation);
                if (!result) {
                    throw new Error('returned false');
                }
                passed += 1;
                logger.info(`PASS ${test.name}`);
            } catch (error) {
                if (error?.code === 'PLAUNA_WORKBENCH_DESTROYED') throw error;
                logger.error(`FAIL ${test.name}`, { message: error?.message || String(error) });
            }
        }
        assertLifecycle(generation);
        logger.info('Smoke tests complete', { passed, total: tests.length });
        if (passed === tests.length) {
            state.toastManager?.show(`${passed}/${tests.length} smoke tests passed`, 'success');
        } else {
            state.toastManager?.show(`${passed}/${tests.length} smoke tests passed`, 'warning');
        }
    }

    function initializeDemo() {
        if (destroyed) return Promise.reject(lifecycleError());
        if (state.plaunaApp) {
            return Promise.resolve(state.plaunaApp);
        }
        if (demoPromise) return demoPromise;
        const generation = lifecycleGeneration;
        let tracked;
        tracked = initializeDemoGeneration(generation).catch(error => {
            if (generation === lifecycleGeneration && state.plaunaApp) {
                try { state.plaunaApp.destroy?.(); } catch (_) {}
                state.plaunaApp = null;
            }
            destroyWorkbenchRenderer(rendererOwner);
            throw error;
        }).finally(() => {
            if (demoPromise === tracked) demoPromise = null;
        });
        demoPromise = tracked;
        return tracked;
    }

    async function initializeDemoGeneration(generation) {
        const candidateApp = await initializePlauna({
            root: elements.plaunaRoot,
            engine: { createEntity, setEntityComponent, getEntityComponent },
            editor: null,
            useCSS: true,
            textEngine: 'pretext'
        });
        if (destroyed || generation !== lifecycleGeneration) {
            try { candidateApp?.destroy?.(); } catch (_) {}
            throw lifecycleError();
        }
        state.plaunaApp = candidateApp;

        logger.info('Plauna initialized', {
            initialized: state.plaunaApp.initialized,
            workspaces: state.plaunaApp.workspaces.size
        });

        // Initialize workbench renderer for real widget rendering
        const rendererHost = document.createElement('div');
        rendererHost.hidden = true;
        rendererHost.dataset.plaunaWorkbenchRendererHost = '1';
        elements.plaunaRoot.appendChild(rendererHost);
        initializeWorkbenchRenderer(rendererHost, state.plaunaApp.textService, rendererOwner);
        logger.info('Workbench renderer initialized');

        // Apply default theme on initialization
        const defaultTheme = 'dark'; // You can change this to 'light' or 'high-contrast'
        if (state.plaunaApp?.themeManager) {
            state.plaunaApp.themeManager.setTheme(defaultTheme);
            const theme = state.plaunaApp.themeManager.getCurrentTheme();
            applyThemeVariables(document.documentElement, theme && theme.tokens);
            applyThemeVariables(elements.plaunaRoot, theme && theme.tokens);
            elements.plaunaRoot.dataset.theme = defaultTheme;
            state.activeTheme = defaultTheme;
            logger.info('Default theme applied', { theme: defaultTheme });
        }

        state.plaunaApp.registerView('plauna-test-preview', {
            title: 'Preview',
            renderMode: 'dom',
            closable: true
        });
        state.plaunaApp.registerSurface('plauna-test-surface', {
            kind: 'viewport',
            shape: 'rect',
            interactive: true
        });
        state.plaunaApp.addAdvancedLayoutToInspector({ container: elements.plaunaRoot });
        elements.plaunaRoot.querySelector('#footer-status').textContent = 'Plauna initialized by default.';
        renderOverview();
        return state.plaunaApp;
    }

    async function measureSample() {
        const generation = lifecycleGeneration;
        assertLifecycle(generation);
        const app = await initializeDemo();
        assertLifecycle(generation);
        const handle = app.textService.prepare(AUTO_SAMPLE_TEXT, {
            fontFamily: 'Inter',
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 20
        });
        state.lastLayout = app.textService.layout(handle, 280);
        renderOverview();
        elements.plaunaRoot.querySelector('#footer-status').textContent = `Measured sample: ${state.lastLayout.lineCount} lines, ${Math.round(state.lastLayout.width)}px wide.`;
        logger.info('Measured sample text', state.lastLayout);
        state.toastManager?.show(`Measured ${state.lastLayout.lineCount} lines at ${Math.round(state.lastLayout.width)}px`, 'info');
    }

    async function createSurfaceSample() {
        const generation = lifecycleGeneration;
        assertLifecycle(generation);
        const app = await initializeDemo();
        assertLifecycle(generation);
        state.lastSurface = app.createSurface({
            id: `test-surface-${app.surfaceManager.getAllSurfaces().length + 1}`,
            kind: 'viewport',
            shape: 'rect',
            interactive: true
        });
        elements.plaunaRoot.querySelector('#footer-chip').textContent = `Surface: ${state.lastSurface.id}`;
        renderOverview();
        logger.info('Created Plauna surface', state.lastSurface);
        state.toastManager?.show(`Surface ${state.lastSurface.id} created`, 'info');
    }

    function setConsolePeek(shouldPeek) {
        if (shouldPeek === state.consolePeek) {
            return;
        }
        state.consolePeek = shouldPeek;
        elements.consoleDrawer.dataset.consolePeek = shouldPeek ? '1' : '0';
        elements.consoleDrawer.classList.toggle('is-peeking', shouldPeek);
    }

    function applyTheme(themeId) {
        state.activeTheme = themeId;
        const themeLabels = { light: 'Light', dark: 'Dark', 'high-contrast': 'High Contrast' };
        const label = themeLabels[themeId] || themeId;
        if (state.plaunaApp?.themeManager) {
            state.plaunaApp.themeManager.setTheme(themeId);
            const theme = state.plaunaApp.themeManager.getCurrentTheme();
            applyThemeVariables(document.documentElement, theme && theme.tokens);
            applyThemeVariables(elements.plaunaRoot, theme && theme.tokens);
            elements.plaunaRoot.dataset.theme = themeId;
        }
        elements.plaunaRoot.querySelectorAll('.plauna-theme-btn').forEach((btn) => {
            btn.classList.toggle('plauna-btn--theme-active', btn.dataset.theme === themeId);
        });
        elements.plaunaRoot.querySelector('#design-badge').textContent = `Active: ${state.activeDesign} · ${label}`;
        renderOverview();
        state.toastManager?.show(`Switched to ${label} theme`, 'success');
        logger.info('Theme changed', { theme: themeId });
    }

    function runLiveMeasure() {
        if (!state.plaunaApp) return;
        const input = elements.plaunaRoot.querySelector('#pretext-input');
        const sizeEl = elements.plaunaRoot.querySelector('#pretext-size');
        const weightEl = elements.plaunaRoot.querySelector('#pretext-weight');
        const widthEl = elements.plaunaRoot.querySelector('#pretext-width');
        if (!input || !sizeEl || !weightEl || !widthEl) return;

        const text = input.value || '';
        const fontSize = parseInt(sizeEl.value, 10);
        const fontWeight = parseInt(weightEl.value, 10);
        const containerWidth = parseInt(widthEl.value, 10);
        const lineHeight = Math.round(fontSize * 1.45);

        try {
            const handle = state.plaunaApp.textService.prepare(text, {
                fontFamily: 'Inter',
                fontSize,
                fontWeight,
                lineHeight
            });
            const metrics = state.plaunaApp.textService.measure(handle);
            const layout = state.plaunaApp.textService.layout(handle, containerWidth);

            const set = (id, val) => {
                const el = elements.plaunaRoot.querySelector(id);
                if (el) el.textContent = val;
            };
            set('#pm-width', `${Math.round(layout.width)}px`);
            set('#pm-lines', String(layout.lineCount));
            set('#pm-height', `${Math.round(layout.height)}px`);
            set('#pm-ascent', metrics.ascent != null ? `${metrics.ascent.toFixed(1)}px` : '--');
            set('#pm-descent', metrics.descent != null ? `${metrics.descent.toFixed(1)}px` : '--');
            set('#pm-baseline', `${layout.metrics.baseline.toFixed(1)}px`);

            const track = elements.plaunaRoot.querySelector('#pretext-ruler-track');
            const textEl = elements.plaunaRoot.querySelector('#pretext-ruler-text');
            const labelEl = elements.plaunaRoot.querySelector('#pretext-ruler-label');
            const cacheChip = elements.plaunaRoot.querySelector('#pretext-cache-chip');
            const previewStage = elements.plaunaRoot.querySelector('#pretext-preview-stage');
            const previewLines = elements.plaunaRoot.querySelector('#pretext-preview-lines');
            const previewParticles = elements.plaunaRoot.querySelector('#pretext-preview-particles');
            if (track) {
                track.style.width = '100%';
                track.style.maxWidth = `${containerWidth}px`;
            }
            if (textEl) {
                textEl.style.width = `${Math.min(Math.round(layout.width), containerWidth)}px`;
            }
            if (labelEl) labelEl.textContent = `${containerWidth}px container · ${layout.lineCount} lines`;
            if (cacheChip) cacheChip.textContent = `Cache: ${state.plaunaApp.textService.measureCache.size} entries`;
            if (previewStage && previewLines && previewParticles) {
                previewStage.style.width = `${containerWidth}px`;
                previewStage.style.height = `${Math.max(120, layout.height + 28)}px`;
                previewLines.innerHTML = '';
                initializePretextParticles(previewParticles, state);

                const leftInset = 14;
                const topInset = 14;
                state.pretextObstacles = [];
                const lineEntries = [];

                layout.lines.forEach((line, index) => {
                    const lineHandle = state.plaunaApp.textService.prepare(line, {
                        fontFamily: 'Inter',
                        fontSize,
                        fontWeight,
                        lineHeight
                    });
                    const lineMetrics = state.plaunaApp.textService.measure(lineHandle);
                    const lineWidth = Math.min(containerWidth - leftInset * 2, Math.max(8, Math.ceil(lineMetrics.width)));
                    const lineElement = document.createElement('div');
                    lineElement.className = 'plauna-pretext-line';
                    lineElement.textContent = line;
                    lineElement.style.left = `${leftInset}px`;
                    lineElement.style.top = `${topInset + index * lineHeight}px`;
                    lineElement.style.width = `${lineWidth}px`;
                    lineElement.style.height = `${lineHeight}px`;
                    lineElement.style.fontSize = `${fontSize}px`;
                    lineElement.style.fontWeight = String(fontWeight);
                    lineElement.style.lineHeight = `${lineHeight}px`;
                    previewLines.appendChild(lineElement);
                    lineEntries.push({
                        text: line,
                        width: lineWidth,
                        left: leftInset,
                        top: topInset + index * lineHeight
                    });
                });

                state.pretextMask = buildPretextMask({
                    lines: lineEntries,
                    containerWidth,
                    fontSize,
                    fontWeight,
                    lineHeight
                });

                state.pretextParticles.forEach((particle, index) => {
                    if (!state.pretextMask || state.pretextMask.contourPoints.length === 0) {
                        particle.targetX = leftInset + randomBetween(0, Math.max(20, containerWidth - leftInset * 2));
                        particle.targetY = topInset + randomBetween(0, Math.max(20, lineHeight));
                        return;
                    }

                    const point = state.pretextMask.contourPoints[index % state.pretextMask.contourPoints.length];
                    particle.targetX = point.x + randomBetween(-3, 3);
                    particle.targetY = point.y + randomBetween(-3, 3);
                });
            }
        } catch (err) {
            logger.error('Live pretext measure failed', { message: err?.message });
        }
    }

    function toggleAutoCycle() {
        const PRESETS = DESIGN_PRESETS.map((p) => p.id);
        if (state.autoCycle) {
            clearInterval(state.autoCycleTimer);
            state.autoCycle = false;
            const btn = elements.plaunaRoot.querySelector('#auto-cycle-btn');
            if (btn) { btn.textContent = '\u25b6 Auto'; btn.classList.remove('plauna-btn--active'); }
            renderOverview();
            return;
        }
        state.autoCycle = true;
        const btn = elements.plaunaRoot.querySelector('#auto-cycle-btn');
        if (btn) { btn.textContent = '\u23f8 Auto'; btn.classList.add('plauna-btn--active'); }
        let cycleIndex = PRESETS.indexOf(state.activeDesign);
        state.autoCycleTimer = setInterval(() => {
            cycleIndex = (cycleIndex + 1) % PRESETS.length;
            updateActiveDesign(PRESETS[cycleIndex]);
        }, 3000);
        renderOverview();
    }

    function onRootClick(event) {
        if (destroyed) return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.dataset.action;
        const design = target.dataset.design;
        const themeId = target.dataset.theme;
        try {
            if (action === 'auto-cycle') toggleAutoCycle();
            else if (themeId) applyTheme(themeId);
            else if (design) updateActiveDesign(design);
        } catch (error) {
            logger.error('Plauna test action failed', { action: action || design, message: error?.message || String(error) });
            state.toastManager?.show(error?.message || 'Action failed', 'error');
        }
    }

    function onWindowResize() {
        if (destroyed) return;
        refreshStageBounds();
        backdrop.resize();
        updateActiveDesign(state.activeDesign);
    }

    function onDocumentPointerMove(event) {
        if (destroyed) return;
        const peekZone = 42;
        const settleDelayMs = 120;
        const slowSpeedThreshold = 0.06;
        const now = performance.now();
        const intent = state.pointerIntent;
        const dt = Math.max(1, now - (intent.lastTime || now));
        const dx = event.clientX - intent.lastX;
        const dy = event.clientY - intent.lastY;
        intent.speed = Math.hypot(dx, dy) / dt;
        intent.lastX = event.clientX;
        intent.lastY = event.clientY;
        intent.lastTime = now;

        const nearBottom = window.innerHeight - event.clientY <= peekZone;
        if (!nearBottom) {
            clearTimeout(intent.settleTimer);
            setConsolePeek(false);
            return;
        }

        clearTimeout(intent.settleTimer);
        if (intent.speed <= slowSpeedThreshold) {
            intent.settleTimer = window.setTimeout(() => {
                if (!destroyed && state.pointerIntent.speed <= slowSpeedThreshold) {
                    setConsolePeek(true);
                }
            }, settleDelayMs);
            return;
        }
        setConsolePeek(false);
    }

    function onDrawerPointerEnter() { if (!destroyed) setConsolePeek(true); }
    function onDrawerPointerLeave() { if (!destroyed) setConsolePeek(false); }
    function onRootInput() { if (!destroyed) runLiveMeasure(); }
    function onRootChange(event) {
        if (!destroyed && event.target.closest('#pretext-panel')) runLiveMeasure();
    }

    function attachInteractions() {
        if (destroyed || interactionsAttached) return false;
        interactionsAttached = true;
        listen(root, 'click', onRootClick);
        listen(window, 'resize', onWindowResize);
        listen(document, 'pointermove', onDocumentPointerMove);
        listen(elements.consoleDrawer, 'pointerenter', onDrawerPointerEnter);
        listen(elements.consoleDrawer, 'pointerleave', onDrawerPointerLeave);
        listen(elements.plaunaRoot, 'input', onRootInput);
        listen(elements.plaunaRoot, 'change', onRootChange);
        return true;
    }

    function boot() {
        if (destroyed) return Promise.reject(lifecycleError());
        if (booted) return Promise.resolve(true);
        if (bootPromise) return bootPromise;
        const generation = ++lifecycleGeneration;
        let tracked;
        tracked = bootGeneration(generation).finally(() => {
            if (bootPromise === tracked) bootPromise = null;
        });
        bootPromise = tracked;
        return tracked;
    }

    async function bootGeneration(generation) {
        await backdrop.initialize();
        assertLifecycle(generation);
        refreshStageBounds();
        renderPretextPanel(elements.plaunaRoot);
        renderWidgetGallery(elements.plaunaRoot, state.toastManager);
        renderOverview();
        attachInteractions();
        animate();
        await initializeDemo();
        assertLifecycle(generation);
        await measureSample();
        assertLifecycle(generation);
        runLiveMeasure();
        updateActiveDesign(state.activeDesign);
        await runSmokeTests(generation);
        assertLifecycle(generation);
        booted = true;
        logger.info('Plauna test harness ready');
        return true;
    }

    return {
        boot,
        destroy() {
            if (destroyed) return false;
            destroyed = true;
            booted = false;
            lifecycleGeneration += 1;
            if (state.rafId) cancelAnimationFrame(state.rafId);
            state.rafId = 0;
            if (state.autoCycleTimer) clearInterval(state.autoCycleTimer);
            state.autoCycleTimer = null;
            detachInteractions();
            backdrop.destroy();
            state.toastManager?.destroy?.();
            try { state.plaunaApp?.destroy?.(); } catch (_) {}
            state.plaunaApp = null;
            destroyWorkbenchRenderer(rendererOwner);
            return true;
        },
        initializeDemo,
        measureSample,
        createSurfaceSample,
        runSmokeTests,
        updateActiveDesign
    };
}
