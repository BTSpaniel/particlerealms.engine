// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PlaunaConsole - Main console system for Plauna
 * Integrates HtmlConsole with Plauna-specific features and debugging capabilities
 */

import { createHtmlConsole } from '../../engine/tools/console/HtmlConsole.js';
import { statsMean } from '../../engine/core/math/MathStatistics.js';
import { tokens } from '../style/DesignTokens.js';

class PlaunaConsoleInternal {
    constructor(options = {}) {
        this.config = {
            position: 'bottom-sheet',
            maxHeight: '30vh',
            maxLines: 500,
            mirrorToConsole: true,
            autoAttach: true,
            startCollapsed: true,
            handleHeight: 24,
            showTimestamps: true,
            collapseOnError: false,
            consoleHookFilter: defaultConsoleHookFilter,
            appearance: {},
            themeManager: null,
            useThemeTokens: true,
            ...options
        };

        this.htmlConsole = null;
        this.performanceMetrics = new Map();
        this.profilers = new Map();
        this.snapshots = [];
        this.initialized = false;
        this.themeUnsubscribe = null;
        this.styleElement = null;
        this.consoleHooksDetach = null;

        this.initialize();
    }

    getAppearance() {
        if (!this.config.useThemeTokens) {
            return {
                ...this.config.appearance
            };
        }

        const primary = tokens.get('colors.primary.500', '#0ea5e9');
        const primaryStrong = tokens.get('colors.primary.700', primary);
        const textSecondary = tokens.get('colors.text.secondary', '#475569');
        const textTertiary = tokens.get('colors.text.tertiary', '#64748b');
        const backgroundPrimary = tokens.get('colors.background.primary', '#ffffff');
        const backgroundSecondary = tokens.get('colors.background.secondary', '#f8fafc');
        const backgroundTertiary = tokens.get('colors.background.tertiary', '#f1f5f9');
        const inverseBackground = tokens.get('colors.background.inverse', '#0f172a');
        const inverseText = tokens.get('colors.text.inverse', '#f8fafc');
        const success = tokens.get('colors.success', '#10b981');
        const warning = tokens.get('colors.warning', '#f59e0b');
        const error = tokens.get('colors.error', '#ef4444');
        const fontFamily = tokens.get('typography.fontFamily.monospace', 'monospace');
        const fontSize = `${tokens.get('typography.scale.0', 12)}px`;
        const lineHeight = String(tokens.get('typography.lineHeight.normal', 1.4));
        const radius = `${tokens.get('radius.md', 8)}px`;
        const shadow = tokens.get('shadows.lg', 'none');
        const normalDuration = `${tokens.get('motion.duration.normal', 300) / 1000}s`;
        const easing = tokens.get('motion.easing.easeOut', 'cubic-bezier(0, 0, 0.2, 1)');
        const backdropFilter = 'blur(12px)';

        return {
            toggleBackground: backgroundSecondary,
            toggleTextColor: textSecondary,
            toggleBorderColor: primaryStrong,
            toggleHoverColor: primary,
            consoleBackground: inverseBackground,
            consoleTextColor: inverseText,
            consoleBorderColor: primary,
            fontFamily,
            fontSize,
            lineHeight,
            backdropFilter,
            hoverBackground: tokens.applyOpacity(primary, 0.12),
            timestampColor: textTertiary,
            infoColor: primary,
            warnColor: warning,
            errorColor: error,
            debugColor: success,
            dataBackground: tokens.applyOpacity(backgroundPrimary, 0.08),
            dataBorderColor: primary,
            dataTextColor: inverseText,
            scrollbarTrackColor: tokens.applyOpacity(backgroundTertiary, 0.35),
            scrollbarThumbColor: textTertiary,
            scrollbarThumbHoverColor: primary,
            panelPadding: `${tokens.get('spacing.sm', 8)}px ${tokens.get('spacing.md', 16)}px`,
            collapsedPadding: `0 ${tokens.get('spacing.md', 16)}px`,
            transitionDuration: normalDuration,
            transitionEasing: easing,
            radius,
            panelRadius: '0px',
            fadeSize: `${tokens.get('spacing.xl', 32)}px`,
            fadeOverlayColor: inverseBackground,
            shadow,
            primary,
            primaryStrong,
            textSecondary,
            ...this.config.appearance
        };
    }

    initialize() {
        if (this.initialized) return;
        try {
            // Create HtmlConsole with Plauna configuration
            this.htmlConsole = createHtmlConsole({
                id: 'plauna-console',
                maxLines: this.config.maxLines,
                mirrorToConsole: this.config.mirrorToConsole,
                tag: 'Plauna',
                maxHeight: this.config.maxHeight,
                startCollapsed: this.config.startCollapsed,
                handleHeight: this.config.handleHeight,
                consoleHookFilter: this.config.consoleHookFilter,
                appearance: this.getAppearance()
            });

            // Auto-attach console hooks if enabled
            if (this.config.autoAttach) {
                const detach = this.htmlConsole.attachConsoleHooks();
                this.consoleHooksDetach = typeof detach === 'function' ? detach : null;
            }

            // Set initial styling for Plauna console
            this.styleConsole();

            if (this.config.themeManager && typeof this.config.themeManager.subscribe === 'function') {
                this.themeUnsubscribe = this.config.themeManager.subscribe(() => this.styleConsole());
            } else if (this.config.useThemeTokens) {
                this.themeUnsubscribe = tokens.subscribe('*', () => this.styleConsole());
            }

            this.initialized = true;
            this.info('PlaunaConsole initialized');
        } catch (error) {
            this.detachConsoleHooks();
            throw error;
        }
    }

    styleConsole() {
        if (!this.htmlConsole.element) return;

        const wrapper = this.htmlConsole.wrapper;
        const toggleButton = this.htmlConsole.toggleButton;
        const appearance = this.getAppearance();

        if (wrapper) {
            wrapper.style.position = 'fixed';
            wrapper.style.left = '0';
            wrapper.style.right = '0';
            wrapper.style.bottom = '0';
            wrapper.style.zIndex = '9999';
            wrapper.style.pointerEvents = 'none';
        }

        if (toggleButton) {
            toggleButton.style.pointerEvents = 'auto';
            toggleButton.style.zIndex = '10000';
            toggleButton.style.borderRadius = `${appearance.radius} ${appearance.radius} 0 0`;
            toggleButton.style.boxShadow = appearance.shadow;
        }

        this.htmlConsole.element.style.pointerEvents = 'auto';
        this.htmlConsole.element.style.maxHeight = this.config.maxHeight;
        this.htmlConsole.element.style.width = '100%';
        this.htmlConsole.element.style.borderTop = `2px solid ${appearance.primary}`;
        this.htmlConsole.element.style.fontFamily = appearance.fontFamily;
        this.htmlConsole.element.style.fontSize = appearance.fontSize;
        this.htmlConsole.element.style.lineHeight = appearance.lineHeight;
        this.htmlConsole.element.style.color = appearance.consoleTextColor;
        this.htmlConsole.element.style.background = appearance.consoleBackground;
        this.htmlConsole.element.style.boxShadow = appearance.shadow;

        if (this.styleElement) {
            this.styleElement.remove();
        }

        this.styleElement = document.createElement('style');
        this.styleElement.textContent = `
            #plauna-console-wrapper {
                position: fixed;
                left: 0;
                right: 0;
                bottom: 0;
                z-index: 9999;
                pointer-events: none;
            }
            #plauna-console {
                background: ${appearance.consoleBackground} !important;
                color: ${appearance.consoleTextColor} !important;
                border-top: 2px solid ${appearance.primary} !important;
                backdrop-filter: ${appearance.backdropFilter} !important;
                max-height: ${this.config.maxHeight} !important;
                width: 100% !important;
                pointer-events: auto;
                font-family: ${appearance.fontFamily} !important;
                font-size: ${appearance.fontSize} !important;
                line-height: ${appearance.lineHeight} !important;
                box-shadow: ${appearance.shadow} !important;
            }
            #plauna-console .log-entry {
                border-left: 3px solid transparent;
                transition: all ${appearance.transitionDuration} ${appearance.transitionEasing};
            }
            #plauna-console .log-entry:hover {
                background: ${appearance.hoverBackground} !important;
                border-left-color: ${appearance.primary};
            }
            #plauna-console .log-performance {
                color: ${appearance.debugColor};
                font-weight: 600;
            }
            #plauna-console .log-uinode {
                color: ${appearance.primaryStrong};
                font-weight: 500;
            }
            #plauna-console .log-visualtree {
                color: ${appearance.warnColor};
                font-weight: 500;
            }
            #plauna-console-wrapper #plauna-console-toggle {
                background: ${appearance.toggleBackground} !important;
                border: 1px solid ${appearance.toggleBorderColor} !important;
                color: ${appearance.toggleTextColor} !important;
                font-weight: 600;
                pointer-events: auto;
                font-family: ${appearance.fontFamily} !important;
                box-shadow: ${appearance.shadow} !important;
            }
        `;
        document.head.appendChild(this.styleElement);
    }

    // Core logging methods
    debug(message, data) {
        this.htmlConsole.debug(message, data);
    }

    info(message, data) {
        this.htmlConsole.info(message, data);
    }

    warn(message, data) {
        this.htmlConsole.warn(message, data);
    }

    error(message, data) {
        this.htmlConsole.error(message, data);
    }

    // Plauna-specific logging methods
    uinode(action, nodeId, data) {
        const message = `UINode ${action}: ${nodeId}`;
        this.htmlConsole.debug(message, data);
        
        // Add special class for UINode logs
        const lastEntry = this.htmlConsole.element.lastElementChild;
        if (lastEntry) {
            lastEntry.classList.add('log-uinode');
        }
    }

    visualtree(action, data) {
        const message = `VisualTree ${action}`;
        this.htmlConsole.debug(message, data);
        
        // Add special class for VisualTree logs
        const lastEntry = this.htmlConsole.element.lastElementChild;
        if (lastEntry) {
            lastEntry.classList.add('log-visualtree');
        }
    }

    performance(operation, time) {
        const message = `Performance: ${operation} took ${time.toFixed(2)}ms`;
        this.htmlConsole.debug(message);
        
        // Store performance metric
        if (!this.performanceMetrics.has(operation)) {
            this.performanceMetrics.set(operation, []);
        }
        this.performanceMetrics.get(operation).push({
            time,
            timestamp: Date.now()
        });

        // Add special class for performance logs
        const lastEntry = this.htmlConsole.element.lastElementChild;
        if (lastEntry) {
            lastEntry.classList.add('log-performance');
        }

        // Keep only last 100 metrics per operation
        const metrics = this.performanceMetrics.get(operation);
        if (metrics.length > 100) {
            metrics.shift();
        }
    }

    // Profiling methods
    profile(name) {
        this.profilers.set(name, performance.now());
        this.info(`Profile started: ${name}`);
    }

    profileEnd(name) {
        const startTime = this.profilers.get(name);
        if (startTime) {
            const endTime = performance.now();
            const duration = endTime - startTime;
            this.profilers.delete(name);
            this.performance(`Profile: ${name}`, duration);
        } else {
            this.warn(`Profile not found: ${name}`);
        }
    }

    // Inspection methods
    inspect(node) {
        if (!node) {
            this.error('Cannot inspect null/undefined node');
            return;
        }

        const inspection = {
            id: node.id,
            type: node.type,
            children: node.children.length,
            style: node.style,
            stateFlags: node.stateFlags,
            dirtyFlags: node.dirtyFlags,
            parent: node.parent?.id,
            textContent: node.textContent
        };

        this.info(`Inspecting UINode: ${node.id}`, inspection);
    }

    // Snapshot management
    snapshot(tag, data) {
        const snapshot = {
            tag,
            timestamp: Date.now(),
            data
        };

        this.snapshots.push(snapshot);
        this.htmlConsole.addSnapshot(tag, data);

        // Keep only last 50 snapshots
        if (this.snapshots.length > 50) {
            this.snapshots.shift();
        }
    }

    // Console control methods
    clear() {
        this.htmlConsole.clear();
        this.performanceMetrics.clear();
        this.profilers.clear();
        this.snapshots = [];
        this.info('Console cleared');
    }

    setVisible(visible) {
        this.htmlConsole.setVisible(visible);
    }

    diagnosticTail(limit = 120) {
        return this.htmlConsole?.diagnosticTail?.(limit) ?? [];
    }

    // Export methods
    export() {
        const exportData = {
            timestamp: new Date().toISOString(),
            performanceMetrics: Object.fromEntries(this.performanceMetrics),
            snapshots: this.snapshots,
            config: this.config
        };

        return JSON.stringify(exportData, null, 2);
    }

    // Performance reporting
    getPerformanceReport() {
        const report = {};
        
        for (const [operation, metrics] of this.performanceMetrics) {
            if (metrics.length > 0) {
                const times = metrics.map(m => m.time);
                const total = times.reduce((sum, time) => sum + time, 0);
                const avg = statsMean(times);
                const min = Math.min(...times);
                const max = Math.max(...times);
                
                report[operation] = {
                    count: metrics.length,
                    total: total.toFixed(2),
                    average: avg.toFixed(2),
                    min: min.toFixed(2),
                    max: max.toFixed(2),
                    lastMetric: metrics[metrics.length - 1].timestamp
                };
            }
        }

        return report;
    }

    // Utility methods
    getTime() {
        return new Date().toISOString().slice(11, 23);
    }

    detachConsoleHooks() {
        const detach = this.consoleHooksDetach;
        this.consoleHooksDetach = null;
        if (typeof detach === 'function') detach();
    }

    // Cleanup
    destroy() {
        this.detachConsoleHooks();

        if (typeof this.themeUnsubscribe === 'function') {
            this.themeUnsubscribe();
            this.themeUnsubscribe = null;
        }
        
        this.clear();
        this.initialized = false;
    }
}

function defaultConsoleHookFilter(level, args) {
    const first = args?.[0];
    return typeof first !== 'string' || !first.startsWith('[LLM Runtime]');
}

// Singleton instance
let plaunaConsoleInstance = null;

export function createPlaunaConsole(options = {}) {
    if (!plaunaConsoleInstance) {
        plaunaConsoleInstance = new PlaunaConsoleInternal(options);
    }
    return plaunaConsoleInstance;
}

export function getPlaunaConsole() {
    return plaunaConsoleInstance;
}

// Convenience exports for direct access
export const PlaunaConsole = {
    debug: (message, data) => plaunaConsoleInstance?.debug(message, data),
    info: (message, data) => plaunaConsoleInstance?.info(message, data),
    warn: (message, data) => plaunaConsoleInstance?.warn(message, data),
    error: (message, data) => plaunaConsoleInstance?.error(message, data),
    uinode: (action, nodeId, data) => plaunaConsoleInstance?.uinode(action, nodeId, data),
    visualtree: (action, data) => plaunaConsoleInstance?.visualtree(action, data),
    performance: (operation, time) => plaunaConsoleInstance?.performance(operation, time),
    profile: (name) => plaunaConsoleInstance?.profile(name),
    profileEnd: (name) => plaunaConsoleInstance?.profileEnd(name),
    inspect: (node) => plaunaConsoleInstance?.inspect(node),
    snapshot: (tag, data) => plaunaConsoleInstance?.snapshot(tag, data),
    clear: () => plaunaConsoleInstance?.clear(),
    setVisible: (visible) => plaunaConsoleInstance?.setVisible(visible),
    export: () => plaunaConsoleInstance?.export(),
    diagnosticTail: (limit = 120) => plaunaConsoleInstance?.diagnosticTail(limit) ?? [],
    getPerformanceReport: () => plaunaConsoleInstance?.getPerformanceReport()
};
