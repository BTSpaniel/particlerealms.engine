// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WidgetStyleManager - Widget-specific styling system
 * Provides theme-based styling utilities for widgets and UI components
 */

import { ThemeManager } from '../style/ThemeManager.js';
import { adaptiveThemeFactory } from '../style/AdaptiveThemeFactory.js';
import { 
    zModalPanel, 
    zModalBackdrop, 
    zDropdown, 
    zTooltip,
    getStackingContextCSS 
} from '../style/LayerManager.js';

/**
 * WidgetStyleManager - Theme-aware widget styling system.
 *
 * Architecture pattern:
 * - Singleton pattern for consistent styling across the application
 * - Style caching for performance (memoization by widgetType:variant:theme)
 * - Theme integration with ThemeManager for dynamic theme switching
 * - Observer pattern for reactive style updates on theme changes
 * - Base token fallback for graceful degradation
 *
 * Features:
 * - Generates CSS styles based on theme tokens
 * - Supports multiple widget types (modal, tooltip, dropdown, etc.)
 * - Automatic cache invalidation on theme changes
 * - Token-based styling for consistency
 */
export class WidgetStyleManager {
    constructor() {
        this.themeManager = new ThemeManager();
        this.styleCache = new Map();
        this.observers = new Set();
        
        // Subscribe to theme changes
        this.themeManager.subscribe((newThemeId, oldThemeId) => {
            this.onThemeChange(newThemeId, oldThemeId);
        });
    }

    getThemeValue(tokens, key, fallback = undefined) {
        if (!tokens) {
            return fallback;
        }

        if (tokens[key] !== undefined) {
            return tokens[key];
        }

        if (tokens.roles && tokens.roles[key] !== undefined) {
            return tokens.roles[key];
        }

        if (tokens.semantic && tokens.semantic[key] !== undefined) {
            return tokens.semantic[key];
        }

        return fallback;
    }

    getPaletteColor(tokens, paletteName, shade = 500, fallback = undefined) {
        const palette = tokens?.colors?.[paletteName];
        if (palette && typeof palette === 'object') {
            if (palette[shade] !== undefined) {
                return palette[shade];
            }
            if (palette.default !== undefined) {
                return palette.default;
            }
        }

        return fallback;
    }

    getWidgetMetrics(tokens, widgetType, variant) {
        const components = tokens?.components || {};
        const widgetMetrics = components[widgetType];
        if (widgetMetrics) {
            return widgetMetrics;
        }

        if (widgetType === 'input' || widgetType === 'textarea' || widgetType === 'select') {
            return components.field || components.input || {};
        }

        if (widgetType === 'button') {
            return components.button || {};
        }

        if (widgetType === 'chip') {
            return components.chip || {};
        }

        if (widgetType === 'badge') {
            return components.badge || {};
        }

        if (widgetType === 'switch') {
            return components.switch || {};
        }

        if (widgetType === 'tooltip') {
            return components.tooltip || {};
        }

        return variant && components[variant] ? components[variant] : {};
    }

    buildThemeContext(widgetType, variant, theme) {
        if (theme && typeof theme === 'object' && theme.tokens) {
            return {
                ...theme,
                widgetType,
                variant
            };
        }

        const themeId = typeof theme === 'string'
            ? theme
            : theme?.id || this.themeManager.currentTheme;

        return this.themeManager.getResolvedTheme(themeId, {
            widgetType,
            variant
        });
    }

    mergeThemeTokens(baseTokens, themeTokens) {
        const merged = {
            ...baseTokens,
            ...themeTokens,
            colors: {
                ...(baseTokens.colors || {}),
                ...(themeTokens.colors || {})
            },
            spacing: {
                ...(baseTokens.spacing || {}),
                ...(themeTokens.spacing || {})
            },
            fontSizes: {
                ...(baseTokens.fontSizes || {}),
                ...(themeTokens.fontSizes || {})
            },
            fontWeights: {
                ...(baseTokens.fontWeights || {}),
                ...(themeTokens.fontWeights || {})
            },
            borderRadius: {
                ...(baseTokens.borderRadius || {}),
                ...(themeTokens.borderRadius || {})
            },
            shadows: {
                ...(baseTokens.shadows || {}),
                ...(themeTokens.shadows || {})
            },
            components: {
                ...(baseTokens.components || {}),
                ...(themeTokens.components || {})
            }
        };

        if (themeTokens.roles) {
            merged.roles = themeTokens.roles;
        }

        if (themeTokens.semantic) {
            merged.semantic = themeTokens.semantic;
        }

        return merged;
    }

    /**
     * Get widget styles based on type, variant, and current theme.
     *
     * Caching pattern for performance:
     * - Cache key format: widgetType:variant:theme
     * - Returns cached styles if available (O(1) lookup)
     * - Generates and caches new styles on cache miss
     * - Cache is cleared on theme changes to ensure consistency
     */
    getWidgetStyles(widgetType, variant = 'default', theme = null) {
        const themeKey = typeof theme === 'string'
            ? theme
            : theme?.id || theme?.themeId || this.themeManager.currentTheme;
        const cacheKey = `${widgetType}:${variant}:${themeKey}`;
        
        if (this.styleCache.has(cacheKey)) {
            return this.styleCache.get(cacheKey);
        }

        const styles = this.generateWidgetStyles(widgetType, variant, theme);
        this.styleCache.set(cacheKey, styles);
        return styles;
    }

    /**
     * Generate widget styles based on theme tokens
     */
    generateWidgetStyles(widgetType, variant, theme) {
        const baseTokens = this.getBaseTokens();
        const currentTheme = this.buildThemeContext(widgetType, variant, theme);
        const adaptiveTokens = currentTheme
            ? adaptiveThemeFactory.createThemeTokens(currentTheme.tokens || currentTheme, {
                widgetType,
                variant,
                density: currentTheme.adaptive?.density || 'comfortable',
                themeId: currentTheme.id || currentTheme.themeId || this.themeManager.currentTheme
            })
            : null;
        const tokens = adaptiveTokens
            ? this.mergeThemeTokens(baseTokens, adaptiveTokens)
            : baseTokens;

        switch (widgetType) {
            case 'modal':
                return this.generateModalStyles(tokens, variant);
            case 'tooltip':
                return this.generateTooltipStyles(tokens, variant);
            case 'dropdown':
                return this.generateDropdownStyles(tokens, variant);
            case 'card':
                return this.generateCardStyles(tokens, variant);
            case 'avatar':
                return this.generateAvatarStyles(tokens, variant);
            case 'badge':
                return this.generateBadgeStyles(tokens, variant);
            case 'chip':
                return this.generateChipStyles(tokens, variant);
            case 'button':
                return this.generateButtonStyles(tokens, variant);
            case 'input':
                return this.generateFieldStyles(tokens, variant, 'input');
            case 'textarea':
                return this.generateFieldStyles(tokens, variant, 'textarea');
            case 'select':
                return this.generateSelectStyles(tokens, variant);
            case 'switch':
                return this.generateSwitchStyles(tokens, variant);
            case 'breadcrumb':
                return this.generateBreadcrumbStyles(tokens, variant);
            case 'pagination':
                return this.generatePaginationStyles(tokens, variant);
            case 'widget-container':
                return this.generateWidgetContainerStyles(tokens, variant);
            default:
                return this.generateDefaultStyles(tokens, variant);
        }
    }

    /**
     * Generate modal component styles
     */
    generateModalStyles(tokens, variant) {
        const sizes = {
            sm: { width: '320px', minHeight: '160px' },
            md: { width: '500px', minHeight: '280px' },
            lg: { width: '700px', minHeight: '400px' }
        };

        const size = sizes[variant] || sizes.md;
        const overlay = this.getThemeValue(tokens, 'overlay', 'rgba(0, 0, 0, 0.5)');
        const surface = this.getThemeValue(tokens, 'surface', 'rgba(30, 41, 59, 0.95)');
        const outline = this.getThemeValue(tokens, 'outline', 'rgba(99, 116, 141, 0.3)');
        const onSurface = this.getThemeValue(tokens, 'onSurface', this.getThemeValue(tokens, 'textPrimary', '#e4e4e7'));
        const onSurfaceVariant = this.getThemeValue(tokens, 'onSurfaceVariant', this.getThemeValue(tokens, 'textSecondary', '#94a3b8'));
        const surfaceHover = this.getThemeValue(tokens, 'surfaceHover', 'rgba(51, 65, 85, 0.5)');

        return {
            container: `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: ${overlay};
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 1000;
                opacity: 0;
                transition: opacity 200ms ease;
            `,
            panel: `
                position: relative;
                display: flex;
                flex-direction: column;
                background: ${surface};
                border: 1px solid ${outline};
                border-radius: ${tokens.borderRadius.lg || '12px'};
                width: ${size.width};
                min-height: ${size.minHeight};
                max-width: 90vw;
                max-height: 90vh;
                box-shadow: ${tokens.shadows.lg || '0 20px 25px -5px rgba(0, 0, 0, 0.1)'};
                transform: scale(0.95);
                transition: transform 200ms ease;
            `,
            header: `
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: ${tokens.spacing.lg || '24px'} ${tokens.spacing.lg || '24px'} ${tokens.spacing.md || '16px'} ${tokens.spacing.lg || '24px'};
                border-bottom: 1px solid ${outline};
            `,
            title: `
                margin: 0;
                font-size: ${tokens.fontSizes.lg || '18px'};
                font-weight: ${tokens.fontWeights.semibold || '600'};
                color: ${onSurface};
            `,
            closeButton: `
                display: flex;
                align-items: center;
                justify-content: center;
                width: 32px;
                height: 32px;
                border: none;
                background: transparent;
                color: ${onSurfaceVariant};
                border-radius: ${tokens.borderRadius.sm || '4px'};
                cursor: pointer;
                font-size: 20px;
                transition: all 150ms ease;
            `,
            closeButtonHover: `
                background: ${surfaceHover};
                color: ${onSurface};
            `,
            content: `
                padding: ${tokens.spacing.lg || '24px'};
                color: ${onSurface};
                font-size: ${tokens.fontSizes.md || '14px'};
                line-height: 1.5;
            `
        };
    }

    /**
     * Generate tooltip component styles
     */
    generateTooltipStyles(tokens, variant) {
        const surface = this.getThemeValue(tokens, 'tooltip', this.getThemeValue(tokens, 'surface', 'rgba(15, 23, 42, 0.95)'));
        const onSurface = this.getThemeValue(tokens, 'tooltipText', this.getThemeValue(tokens, 'onSurface', '#e4e4e7'));
        const outline = this.getThemeValue(tokens, 'tooltipBorder', this.getThemeValue(tokens, 'outline', 'rgba(99, 116, 141, 0.3)'));

        return {
            container: `
                position: absolute;
                z-index: 1001;
                padding: ${tokens.spacing.xs || '6px'} ${tokens.spacing.sm || '10px'};
                background: ${surface};
                color: ${onSurface};
                border: 1px solid ${outline};
                border-radius: ${tokens.borderRadius.sm || '4px'};
                font-size: ${tokens.fontSizes.sm || '12px'};
                font-weight: ${tokens.fontWeights.medium || '500'};
                white-space: nowrap;
                opacity: 0;
                transform: scale(0.8);
                transition: all 150ms ease;
                pointer-events: none;
            `,
            visible: `
                opacity: 1;
                transform: scale(1);
            `
        };
    }

    /**
     * Generate dropdown component styles
     */
    generateDropdownStyles(tokens, variant) {
        const surface = this.getThemeValue(tokens, 'surface', 'rgba(30, 41, 59, 0.95)');
        const outline = this.getThemeValue(tokens, 'outline', 'rgba(99, 116, 141, 0.3)');
        const onSurface = this.getThemeValue(tokens, 'onSurface', this.getThemeValue(tokens, 'textPrimary', '#e4e4e7'));
        const onSurfaceVariant = this.getThemeValue(tokens, 'onSurfaceVariant', this.getThemeValue(tokens, 'textSecondary', '#94a3b8'));
        const surfaceHover = this.getThemeValue(tokens, 'surfaceHover', 'rgba(51, 65, 85, 0.5)');

        return {
            container: `
                position: absolute;
                z-index: 1002;
                min-width: 180px;
                background: ${surface};
                border: 1px solid ${outline};
                border-radius: ${tokens.borderRadius.md || '8px'};
                box-shadow: ${tokens.shadows.lg || '0 20px 25px -5px rgba(0, 0, 0, 0.1)'};
                opacity: 0;
                transform: scale(0.95) translateY(-8px);
                transition: all 150ms ease;
                max-height: 300px;
                overflow-y: auto;
            `,
            menuItem: `
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: ${tokens.spacing.sm || '8px'} ${tokens.spacing.md || '12px'};
                color: ${onSurface};
                font-size: ${tokens.fontSizes.sm || '14px'};
                cursor: pointer;
                transition: background-color 150ms ease;
            `,
            menuItemHover: `
                background: ${surfaceHover};
            `,
            menuItemContent: `
                display: flex;
                align-items: center;
                gap: ${tokens.spacing.sm || '8px'};
            `,
            icon: `
                display: flex;
                align-items: center;
                font-size: ${tokens.fontSizes.md || '16px'};
                color: ${onSurfaceVariant};
            `,
            shortcut: `
                font-size: ${tokens.fontSizes.xs || '11px'};
                color: ${this.getThemeValue(tokens, 'textMuted', onSurfaceVariant)};
                margin-left: auto;
            `,
            divider: `
                height: 1px;
                background: ${outline};
                margin: ${tokens.spacing.xs || '4px'} 0;
            `
        };
    }

    /**
     * Generate card component styles
     */
    generateCardStyles(tokens, variant) {
        const surface = this.getThemeValue(tokens, 'surface', 'rgba(30, 41, 59, 0.95)');
        const outline = this.getThemeValue(tokens, 'outline', 'rgba(99, 116, 141, 0.3)');
        const onSurface = this.getThemeValue(tokens, 'onSurface', this.getThemeValue(tokens, 'textPrimary', '#e4e4e7'));
        const onSurfaceVariant = this.getThemeValue(tokens, 'onSurfaceVariant', this.getThemeValue(tokens, 'textSecondary', '#94a3b8'));
        const success = this.getThemeValue(tokens, 'success', '#10b981');

        return {
            container: `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: ${surface};
                border: 1px solid ${outline};
                border-radius: ${tokens.borderRadius.lg || '12px'};
                width: 320px;
                box-shadow: ${tokens.shadows.lg || '0 20px 25px -5px rgba(0, 0, 0, 0.1)'};
                overflow: hidden;
            `,
            image: `
                width: 100%;
                height: 160px;
                object-fit: cover;
            `,
            content: `
                padding: ${tokens.spacing.lg || '20px'};
            `,
            title: `
                margin: 0 0 ${tokens.spacing.sm || '12px'} 0;
                font-size: ${tokens.fontSizes.lg || '18px'};
                font-weight: ${tokens.fontWeights.semibold || '600'};
                color: ${onSurface};
            `,
            description: `
                margin: 0 0 ${tokens.spacing.md || '16px'} 0;
                font-size: ${tokens.fontSizes.sm || '14px'};
                color: ${onSurfaceVariant};
                line-height: 1.5;
            `,
            footer: `
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding-top: ${tokens.spacing.md || '16px'};
                border-top: 1px solid ${outline};
            `,
            price: `
                font-size: ${tokens.fontSizes.xl || '20px'};
                font-weight: ${tokens.fontWeights.bold || 'bold'};
                color: ${success};
            `,
            status: `
                font-size: ${tokens.fontSizes.xs || '12px'};
                color: ${this.getThemeValue(tokens, 'textMuted', onSurfaceVariant)};
                font-style: italic;
            `
        };
    }

    /**
     * Generate avatar component styles
     */
    generateAvatarStyles(tokens, variant) {
        const surface = this.getThemeValue(tokens, 'surface', 'rgba(30, 41, 59, 0.95)');
        const outline = this.getThemeValue(tokens, 'outline', 'rgba(99, 116, 141, 0.3)');
        const primary = this.getThemeValue(tokens, 'primary', '#3b82f6');
        const success = this.getThemeValue(tokens, 'success', '#10b981');
        const onSurface = this.getThemeValue(tokens, 'onSurface', this.getThemeValue(tokens, 'textPrimary', '#e4e4e7'));
        const onSurfaceVariant = this.getThemeValue(tokens, 'onSurfaceVariant', this.getThemeValue(tokens, 'textSecondary', '#94a3b8'));

        return {
            container: `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: ${surface};
                border: 1px solid ${outline};
                border-radius: ${tokens.borderRadius.lg || '12px'};
                padding: ${tokens.spacing.xl || '24px'};
                text-align: center;
                box-shadow: ${tokens.shadows.lg || '0 20px 25px -5px rgba(0, 0, 0, 0.1)'};
            `,
            avatar: `
                width: 60px;
                height: 60px;
                border-radius: 50%;
                background: ${primary};
                color: white;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: ${tokens.fontSizes.xl || '20px'};
                font-weight: ${tokens.fontWeights.bold || 'bold'};
                margin: 0 auto ${tokens.spacing.md || '16px'} auto;
            `,
            statusIndicator: `
                position: absolute;
                bottom: 25px;
                right: 25px;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: ${success};
                border: 2px solid ${surface};
            `,
            name: `
                font-size: ${tokens.fontSizes.sm || '14px'};
                color: ${onSurface};
                text-align: center;
                margin-bottom: ${tokens.spacing.xs || '4px'};
            `,
            statusText: `
                font-size: ${tokens.fontSizes.xs || '12px'};
                color: ${onSurfaceVariant};
                text-align: center;
            `
        };
    }

    /**
     * Generate breadcrumb component styles
     */
    generateBreadcrumbStyles(tokens, variant) {
        const surface = this.getThemeValue(tokens, 'surface', 'rgba(30, 41, 59, 0.95)');
        const outline = this.getThemeValue(tokens, 'outline', 'rgba(99, 116, 141, 0.3)');
        const onSurface = this.getThemeValue(tokens, 'onSurface', this.getThemeValue(tokens, 'textPrimary', '#e4e4e7'));
        const onSurfaceVariant = this.getThemeValue(tokens, 'onSurfaceVariant', this.getThemeValue(tokens, 'textSecondary', '#94a3b8'));
        const primary = this.getThemeValue(tokens, 'primary', '#3b82f6');
        const primaryHover = this.getThemeValue(tokens, 'primaryHover', '#2563eb');

        return {
            container: `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: ${surface};
                border: 1px solid ${outline};
                border-radius: ${tokens.borderRadius.lg || '12px'};
                padding: ${tokens.spacing.lg || '20px'};
                box-shadow: ${tokens.shadows.lg || '0 20px 25px -5px rgba(0, 0, 0, 0.1)'};
            `,
            item: `
                color: ${primary};
                font-size: ${tokens.fontSizes.sm || '14px'};
                cursor: pointer;
                transition: color 150ms ease;
            `,
            itemHover: `
                color: ${primaryHover};
            `,
            itemActive: `
                color: ${onSurface};
                cursor: default;
            `,
            separator: `
                color: ${this.getThemeValue(tokens, 'textMuted', onSurfaceVariant)};
                margin: 0 ${tokens.spacing.xs || '4px'};
            `
        };
    }

    /**
     * Generate pagination component styles
     */
    generatePaginationStyles(tokens, variant) {
        const surface = this.getThemeValue(tokens, 'surface', 'rgba(30, 41, 59, 0.95)');
        const outline = this.getThemeValue(tokens, 'outline', 'rgba(99, 116, 141, 0.3)');
        const onSurface = this.getThemeValue(tokens, 'onSurface', this.getThemeValue(tokens, 'textPrimary', '#e4e4e7'));
        const primary = this.getThemeValue(tokens, 'primary', '#3b82f6');
        const primaryHover = this.getThemeValue(tokens, 'primaryHover', '#2563eb');
        const surfaceHover = this.getThemeValue(tokens, 'surfaceHover', 'rgba(51, 65, 85, 0.5)');

        return {
            container: `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: ${surface};
                border: 1px solid ${outline};
                border-radius: ${tokens.borderRadius.lg || '12px'};
                padding: ${tokens.spacing.lg || '20px'};
                box-shadow: ${tokens.shadows.lg || '0 20px 25px -5px rgba(0, 0, 0, 0.1)'};
                display: flex;
                align-items: center;
                gap: ${tokens.spacing.sm || '8px'};
            `,
            button: `
                padding: ${tokens.spacing.xs || '6px'} ${tokens.spacing.sm || '10px'};
                background: transparent;
                color: ${onSurface};
                border: 1px solid ${outline};
                border-radius: ${tokens.borderRadius.sm || '4px'};
                cursor: pointer;
                font-size: ${tokens.fontSizes.sm || '14px'};
                transition: all 150ms ease;
            `,
            buttonHover: `
                background: ${surfaceHover};
                border-color: ${primaryHover};
            `,
            buttonActive: `
                background: ${primary};
                color: white;
                border-color: ${primary};
            `,
            buttonDisabled: `
                opacity: 0.5;
                cursor: not-allowed;
            `
        };
    }

    /**
     * Generate widget container styles
     */
    generateWidgetContainerStyles(tokens, variant) {
        const outline = this.getThemeValue(tokens, 'outline', 'rgba(99, 116, 141, 0.3)');
        const surfaceSecondary = this.getThemeValue(tokens, 'backgroundSecondary', this.getThemeValue(tokens, 'surfaceContainerLow', '#f9fafb'));

        return {
            container: `
                margin: ${tokens.spacing.lg || '24px'} 0;
                min-height: 100px;
                padding: ${tokens.spacing.lg || '20px'};
                border: 1px solid ${outline};
                border-radius: ${tokens.borderRadius.md || '8px'};
                background: ${surfaceSecondary};
            `
        };
    }

    /**
     * Generate default fallback styles
     */
    generateDefaultStyles(tokens, variant) {
        const surface = this.getThemeValue(tokens, 'surface', 'rgba(30, 41, 59, 0.95)');
        const outline = this.getThemeValue(tokens, 'outline', 'rgba(99, 116, 141, 0.3)');
        const onSurface = this.getThemeValue(tokens, 'onSurface', this.getThemeValue(tokens, 'textPrimary', '#e4e4e7'));

        return {
            container: `
                background: ${surface};
                color: ${onSurface};
                border: 1px solid ${outline};
                border-radius: ${tokens.borderRadius.md || '8px'};
                padding: ${tokens.spacing.md || '16px'};
            `
        };
    }

    generateBadgeStyles(tokens, variant) {
        const metrics = this.getWidgetMetrics(tokens, 'badge', variant);
        const surface = this.getThemeValue(tokens, 'surface', 'rgba(30, 41, 59, 0.95)');
        const onSurface = this.getThemeValue(tokens, 'onSurface', this.getThemeValue(tokens, 'textPrimary', '#e4e4e7'));
        const onSurfaceVariant = this.getThemeValue(tokens, 'onSurfaceVariant', this.getThemeValue(tokens, 'textSecondary', '#94a3b8'));
        const outline = this.getThemeValue(tokens, 'outline', 'rgba(99, 116, 141, 0.3)');
        const primary = this.getThemeValue(tokens, 'primary', '#3b82f6');
        const success = this.getThemeValue(tokens, 'success', '#10b981');
        const warning = this.getThemeValue(tokens, 'warning', '#f59e0b');
        const error = this.getThemeValue(tokens, 'error', '#ef4444');
        const info = this.getThemeValue(tokens, 'info', '#3b82f6');
        const variants = {
            default: { background: surface, color: onSurface, border: outline },
            primary: { background: this.getThemeValue(tokens, 'primaryContainer', primary), color: this.getThemeValue(tokens, 'onPrimaryContainer', '#ffffff'), border: primary },
            secondary: { background: this.getThemeValue(tokens, 'secondaryContainer', surface), color: this.getThemeValue(tokens, 'onSecondaryContainer', onSurface), border: this.getThemeValue(tokens, 'secondary', outline) },
            success: { background: this.getThemeValue(tokens, 'successContainer', success), color: this.getThemeValue(tokens, 'onSuccessContainer', '#ffffff'), border: success },
            warning: { background: this.getThemeValue(tokens, 'warningContainer', warning), color: this.getThemeValue(tokens, 'onWarningContainer', '#111827'), border: warning },
            error: { background: this.getThemeValue(tokens, 'errorContainer', error), color: this.getThemeValue(tokens, 'onErrorContainer', '#ffffff'), border: error },
            info: { background: this.getThemeValue(tokens, 'infoContainer', info), color: this.getThemeValue(tokens, 'onInfoContainer', '#ffffff'), border: info }
        };
        const resolved = variants[variant] || variants.default;

        return {
            container: `
                display: inline-flex;
                align-items: center;
                gap: ${metrics.gap || 4}px;
                min-height: ${Math.max(22, Math.round((metrics.paddingY || 6) * 2 + (metrics.fontSize || 12) * 0.9))}px;
                padding: ${metrics.paddingY || 6}px ${metrics.paddingX || 10}px;
                border-radius: ${metrics.radius || 9999}px;
                background: ${resolved.background};
                color: ${resolved.color};
                border: 1px solid ${resolved.border};
                font-size: ${metrics.fontSize || 12}px;
                font-weight: 600;
                line-height: 1;
                box-shadow: ${tokens.shadows.lg || '0 20px 25px -5px rgba(0, 0, 0, 0.1)'};
                backdrop-filter: saturate(1.08) blur(8px);
            `
        };
    }

    generateChipStyles(tokens, variant) {
        const metrics = this.getWidgetMetrics(tokens, 'chip', variant);
        const surface = this.getThemeValue(tokens, 'surface', 'rgba(30, 41, 59, 0.95)');
        const onSurface = this.getThemeValue(tokens, 'onSurface', this.getThemeValue(tokens, 'textPrimary', '#e4e4e7'));
        const onSurfaceVariant = this.getThemeValue(tokens, 'onSurfaceVariant', this.getThemeValue(tokens, 'textSecondary', '#94a3b8'));
        const outline = this.getThemeValue(tokens, 'outline', 'rgba(99, 116, 141, 0.3)');
        const primary = this.getThemeValue(tokens, 'primary', '#3b82f6');
        const secondary = this.getThemeValue(tokens, 'secondary', '#475569');
        const success = this.getThemeValue(tokens, 'success', '#10b981');
        const warning = this.getThemeValue(tokens, 'warning', '#f59e0b');
        const error = this.getThemeValue(tokens, 'error', '#ef4444');
        const variants = {
            default: { background: this.getThemeValue(tokens, 'surfaceContainer', surface), color: onSurface, border: outline },
            primary: { background: this.getThemeValue(tokens, 'primaryContainer', primary), color: this.getThemeValue(tokens, 'onPrimaryContainer', '#ffffff'), border: primary },
            secondary: { background: this.getThemeValue(tokens, 'secondaryContainer', secondary), color: this.getThemeValue(tokens, 'onSecondaryContainer', onSurface), border: secondary },
            success: { background: this.getThemeValue(tokens, 'successContainer', success), color: this.getThemeValue(tokens, 'onSuccessContainer', '#ffffff'), border: success },
            warning: { background: this.getThemeValue(tokens, 'warningContainer', warning), color: this.getThemeValue(tokens, 'onWarningContainer', '#111827'), border: warning },
            error: { background: this.getThemeValue(tokens, 'errorContainer', error), color: this.getThemeValue(tokens, 'onErrorContainer', '#ffffff'), border: error }
        };
        const resolved = variants[variant] || variants.default;

        return {
            container: `
                display: inline-flex;
                align-items: center;
                gap: ${metrics.gap || 8}px;
                min-height: ${metrics.minHeight || 32}px;
                padding: ${metrics.paddingY || 8}px ${metrics.paddingX || 12}px;
                border-radius: ${metrics.radius || 9999}px;
                background: ${resolved.background};
                color: ${resolved.color};
                border: 1px solid ${resolved.border};
                font-size: ${metrics.fontSize || 14}px;
                font-weight: 600;
                line-height: 1;
                box-shadow: ${tokens.shadows.lg || '0 20px 25px -5px rgba(0, 0, 0, 0.1)'};
                backdrop-filter: saturate(1.08) blur(8px);
            `,
            avatar: `
                width: ${Math.max(16, Math.round((metrics.fontSize || 14) + 4))}px;
                height: ${Math.max(16, Math.round((metrics.fontSize || 14) + 4))}px;
                border-radius: 50%;
                background: ${this.getThemeValue(tokens, 'surfaceContainerHigh', surface)};
                color: ${onSurfaceVariant};
            `,
            removeButton: `
                width: ${Math.max(16, Math.round((metrics.fontSize || 14) + 4))}px;
                height: ${Math.max(16, Math.round((metrics.fontSize || 14) + 4))}px;
                border-radius: 50%;
                background: ${this.getThemeValue(tokens, 'stateLayerHover', 'rgba(148, 163, 184, 0.14)')};
                color: inherit;
                border: none;
                cursor: pointer;
            `
        };
    }

    generateButtonStyles(tokens, variant) {
        const metrics = this.getWidgetMetrics(tokens, 'button', variant);
        const surface = this.getThemeValue(tokens, 'surface', 'rgba(30, 41, 59, 0.95)');
        const onSurface = this.getThemeValue(tokens, 'onSurface', this.getThemeValue(tokens, 'textPrimary', '#e4e4e7'));
        const onPrimary = this.getThemeValue(tokens, 'onPrimary', '#ffffff');
        const primary = this.getThemeValue(tokens, 'primary', '#3b82f6');
        const outline = this.getThemeValue(tokens, 'outline', 'rgba(99, 116, 141, 0.3)');
        const surfaceHover = this.getThemeValue(tokens, 'surfaceHover', 'rgba(51, 65, 85, 0.5)');
        const baseBackground = this.getThemeValue(tokens, 'surfaceContainerHigh', surface);
        const variants = {
            default: { background: baseBackground, color: onSurface, border: outline },
            primary: { background: primary, color: onPrimary, border: primary },
            secondary: { background: this.getThemeValue(tokens, 'secondaryContainer', surface), color: this.getThemeValue(tokens, 'onSecondaryContainer', onSurface), border: this.getThemeValue(tokens, 'secondary', outline) },
            ghost: { background: 'transparent', color: onSurface, border: 'transparent' },
            danger: { background: this.getThemeValue(tokens, 'error', '#ef4444'), color: this.getThemeValue(tokens, 'onError', '#ffffff'), border: this.getThemeValue(tokens, 'error', '#ef4444') },
            warning: { background: this.getThemeValue(tokens, 'warning', '#f59e0b'), color: this.getThemeValue(tokens, 'onWarning', '#111827'), border: this.getThemeValue(tokens, 'warning', '#f59e0b') },
            success: { background: this.getThemeValue(tokens, 'success', '#10b981'), color: this.getThemeValue(tokens, 'onSuccess', '#ffffff'), border: this.getThemeValue(tokens, 'success', '#10b981') }
        };
        const resolved = variants[variant] || variants.default;

        return {
            container: `
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: ${metrics.gap || 8}px;
                min-height: ${metrics.minHeight || 40}px;
                padding: ${metrics.paddingY || 10}px ${metrics.paddingX || 14}px;
                border-radius: ${metrics.radius || 14}px;
                background: ${resolved.background};
                color: ${resolved.color};
                border: 1px solid ${resolved.border};
                font-size: ${metrics.fontSize || 14}px;
                font-weight: 600;
                line-height: 1;
                box-shadow: ${tokens.shadows.lg || '0 20px 25px -5px rgba(0, 0, 0, 0.1)'};
                transition: transform 150ms ease, background-color 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
            `,
            buttonHover: `
                background: ${resolved.background === 'transparent' ? surfaceHover : this.getThemeValue(tokens, 'surfaceHover', 'rgba(51, 65, 85, 0.5)')};
                box-shadow: ${tokens.shadows.lg || '0 20px 25px -5px rgba(0, 0, 0, 0.1)'};
            `,
            buttonActive: `
                transform: translateY(1px);
            `,
            buttonDisabled: `
                opacity: 0.5;
                cursor: not-allowed;
            `
        };
    }

    generateFieldStyles(tokens, variant, fieldType = 'input') {
        const metrics = this.getWidgetMetrics(tokens, fieldType, variant);
        const background = this.getThemeValue(tokens, 'inputBg', this.getThemeValue(tokens, 'surfaceContainerLowest', this.getThemeValue(tokens, 'surface', 'rgba(30, 41, 59, 0.95)')));
        const color = this.getThemeValue(tokens, 'inputText', this.getThemeValue(tokens, 'onSurface', this.getThemeValue(tokens, 'textPrimary', '#e4e4e7')));
        const border = this.getThemeValue(tokens, 'inputBorder', this.getThemeValue(tokens, 'outlineVariant', this.getThemeValue(tokens, 'border', 'rgba(99, 116, 141, 0.3)')));
        const focusBorder = this.getThemeValue(tokens, 'fieldFocusBorder', this.getThemeValue(tokens, 'primary', '#3b82f6'));
        const placeholder = this.getThemeValue(tokens, 'inputPlaceholder', this.getThemeValue(tokens, 'textMuted', '#64748b'));

        return {
            container: `
                display: flex;
                flex-direction: column;
                gap: ${tokens.spacing.xs || '4px'};
            `,
            input: `
                width: 100%;
                min-height: ${metrics.minHeight || 40}px;
                padding: ${metrics.paddingY || 10}px ${metrics.paddingX || 12}px;
                border-radius: ${metrics.radius || 12}px;
                background: ${background};
                color: ${color};
                border: 1px solid ${border};
                font-size: ${metrics.fontSize || 14}px;
                font-family: inherit;
                line-height: ${metrics.lineHeight || 1.4};
                outline: none;
                box-shadow: ${tokens.shadows.lg || '0 20px 25px -5px rgba(0, 0, 0, 0.1)'};
                transition: border-color 150ms ease, box-shadow 150ms ease, background-color 150ms ease;
            `,
            inputFocus: `
                border-color: ${focusBorder};
                box-shadow: 0 0 0 3px ${this.getThemeValue(tokens, 'stateLayer', 'rgba(59, 130, 246, 0.16)')};
            `,
            label: `
                font-size: ${tokens.fontSizes.xs || '12px'};
                font-weight: ${tokens.fontWeights.semibold || '600'};
                color: ${this.getThemeValue(tokens, 'textSecondary', this.getThemeValue(tokens, 'onSurfaceVariant', '#94a3b8'))};
            `,
            helper: `
                font-size: ${tokens.fontSizes.xs || '12px'};
                color: ${this.getThemeValue(tokens, 'textMuted', placeholder)};
            `,
            error: `
                font-size: ${tokens.fontSizes.xs || '12px'};
                color: ${this.getThemeValue(tokens, 'error', '#ef4444')};
            `,
            textarea: `
                min-height: ${metrics.minHeight || 96}px;
                resize: vertical;
            `
        };
    }

    generateSelectStyles(tokens, variant) {
        const metrics = this.getWidgetMetrics(tokens, 'select', variant);
        const panelBg = this.getThemeValue(tokens, 'selectPanelBg', this.getThemeValue(tokens, 'surfaceContainerHighest', this.getThemeValue(tokens, 'surface', 'rgba(30, 41, 59, 0.95)')));
        const panelBorder = this.getThemeValue(tokens, 'selectPanelBorder', this.getThemeValue(tokens, 'outlineVariant', this.getThemeValue(tokens, 'border', 'rgba(99, 116, 141, 0.3)')));
        const onSurface = this.getThemeValue(tokens, 'onSurface', this.getThemeValue(tokens, 'textPrimary', '#e4e4e7'));
        const onSurfaceVariant = this.getThemeValue(tokens, 'onSurfaceVariant', this.getThemeValue(tokens, 'textSecondary', '#94a3b8'));
        const optionHover = this.getThemeValue(tokens, 'selectOptionHover', this.getThemeValue(tokens, 'surfaceHover', 'rgba(51, 65, 85, 0.5)'));
        const optionSelected = this.getThemeValue(tokens, 'selectOptionSelected', this.getThemeValue(tokens, 'primaryContainer', '#dbeafe'));
        const optionSelectedText = this.getThemeValue(tokens, 'selectOptionSelectedFg', this.getThemeValue(tokens, 'onPrimaryContainer', '#ffffff'));

        return {
            container: `
                display: flex;
                flex-direction: column;
                gap: ${tokens.spacing.xs || '4px'};
            `,
            select: `
                width: 100%;
                min-height: ${metrics.minHeight || 40}px;
                padding: ${metrics.paddingY || 10}px ${metrics.paddingX || 12}px;
                border-radius: ${metrics.radius || 12}px;
                background: ${this.getThemeValue(tokens, 'fieldBg', panelBg)};
                color: ${onSurface};
                border: 1px solid ${panelBorder};
                font-size: ${metrics.fontSize || 14}px;
                outline: none;
                box-shadow: ${tokens.shadows.lg || '0 20px 25px -5px rgba(0, 0, 0, 0.1)'};
            `,
            dropdown: `
                background: ${panelBg};
                border: 1px solid ${panelBorder};
                border-radius: ${metrics.dropdownRadius || 16}px;
                box-shadow: ${tokens.shadows.lg || '0 20px 25px -5px rgba(0, 0, 0, 0.1)'};
            `,
            option: `
                padding: ${metrics.optionPaddingY || 8}px ${metrics.optionPaddingX || 12}px;
                color: ${onSurface};
            `,
            optionHover: `
                background: ${optionHover};
            `,
            optionSelected: `
                background: ${optionSelected};
                color: ${optionSelectedText};
            `,
            arrow: `
                color: ${onSurfaceVariant};
            `,
            searchInput: `
                background: ${this.getThemeValue(tokens, 'fieldBg', panelBg)};
                color: ${onSurface};
                border: 1px solid ${panelBorder};
            `,
            clearButton: `
                background: ${this.getThemeValue(tokens, 'stateLayerHover', 'rgba(148, 163, 184, 0.14)')};
                color: ${onSurfaceVariant};
            `
        };
    }

    generateSwitchStyles(tokens, variant) {
        const metrics = this.getWidgetMetrics(tokens, 'switch', variant);
        const trackOff = this.getThemeValue(tokens, 'switchTrackOff', this.getThemeValue(tokens, 'surfaceContainerHigh', 'rgba(148, 163, 184, 0.22)'));
        const trackOn = this.getThemeValue(tokens, 'switchTrackOn', this.getThemeValue(tokens, 'primary', '#3b82f6'));
        const thumbOff = this.getThemeValue(tokens, 'switchThumbOff', this.getThemeValue(tokens, 'onSurfaceVariant', '#94a3b8'));
        const thumbOn = this.getThemeValue(tokens, 'switchThumbOn', this.getThemeValue(tokens, 'onPrimary', '#ffffff'));

        return {
            container: `
                display: inline-flex;
                align-items: center;
                gap: ${metrics.gap || 8}px;
                cursor: pointer;
            `,
            track: `
                width: ${metrics.trackWidth || 44}px;
                height: ${metrics.trackHeight || 22}px;
                border-radius: ${metrics.radius || 9999}px;
                background: ${trackOff};
                border: 1px solid ${this.getThemeValue(tokens, 'outlineVariant', 'rgba(99, 116, 141, 0.3)')};
                box-shadow: ${metrics.shadow || '0 20px 25px -5px rgba(0, 0, 0, 0.1)'};
            `,
            trackChecked: `
                background: ${trackOn};
            `,
            thumb: `
                width: ${metrics.thumbSize || 18}px;
                height: ${metrics.thumbSize || 18}px;
                border-radius: 50%;
                background: ${thumbOff};
                box-shadow: ${metrics.shadow || '0 20px 25px -5px rgba(0, 0, 0, 0.1)'};
            `,
            thumbChecked: `
                background: ${thumbOn};
            `,
            label: `
                color: ${this.getThemeValue(tokens, 'onSurface', this.getThemeValue(tokens, 'textPrimary', '#e4e4e7'))};
                font-size: ${metrics.fontSize || 14}px;
                font-weight: ${tokens.fontWeights.semibold || '600'};
            `,
            description: `
                color: ${this.getThemeValue(tokens, 'textMuted', this.getThemeValue(tokens, 'onSurfaceVariant', '#94a3b8'))};
                font-size: ${tokens.fontSizes.xs || '12px'};
            `
        };
    }

    /**
     * Get base tokens as fallback.
     *
     * Fallback pattern for graceful degradation:
     * - Provides default values when theme tokens are unavailable
     * - Ensures widgets render even without a theme
     * - Covers all token categories (colors, spacing, typography, etc.)
     * - Used as starting point, then merged with theme-specific tokens
     */
    getBaseTokens() {
        return {
            colors: {
                surface: 'rgba(30, 41, 59, 0.95)',
                text: '#e4e4e7',
                textSecondary: '#94a3b8',
                textMuted: '#64748b',
                border: 'rgba(99, 116, 141, 0.3)',
                primary: '#3b82f6',
                primaryHover: '#2563eb',
                success: '#10b981',
                backgroundSecondary: '#f9fafb',
                surfaceHover: 'rgba(51, 65, 85, 0.5)',
                overlay: 'rgba(0, 0, 0, 0.5)',
                tooltip: 'rgba(15, 23, 42, 0.95)'
            },
            spacing: {
                xs: '4px',
                sm: '8px',
                md: '12px',
                lg: '16px',
                xl: '20px',
                xxl: '24px'
            },
            fontSizes: {
                xs: '11px',
                sm: '12px',
                md: '14px',
                lg: '18px',
                xl: '20px'
            },
            fontWeights: {
                medium: '500',
                semibold: '600',
                bold: 'bold'
            },
            borderRadius: {
                sm: '4px',
                md: '8px',
                lg: '12px'
            },
            shadows: {
                lg: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
            }
        };
    }

    /**
     * Apply styles to element
     */
    applyStyles(element, styleObject) {
        if (typeof styleObject === 'string') {
            element.style.cssText = styleObject;
        } else if (typeof styleObject === 'object') {
            Object.assign(element.style, styleObject);
        }
    }

    /**
     * Create styled element
     */
    createStyledElement(tagName, styles, className = '') {
        const element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        this.applyStyles(element, styles);
        return element;
    }

    /**
     * Handle theme changes.
     *
     * Reactive update pattern:
     * - Clears style cache to force regeneration with new theme
     * - Notifies all observers of theme change
     * - Observers can re-render with new styles
     * - Error handling for observer failures
     */
    onThemeChange(newThemeId, oldThemeId) {
        // Clear style cache when theme changes
        this.styleCache.clear();
        
        // Notify observers
        for (const callback of this.observers) {
            try {
                callback(newThemeId, oldThemeId);
            } catch (error) {
                console.error('Error in WidgetStyleManager observer:', error);
            }
        }
    }

    /**
     * Subscribe to style changes
     */
    subscribe(callback) {
        this.observers.add(callback);
        return () => this.observers.delete(callback);
    }

    /**
     * Clear style cache
     */
    clearCache() {
        this.styleCache.clear();
    }
}

// Export singleton instance
/**
 * Singleton export for WidgetStyleManager.
 *
 * Ensures a single instance is used throughout the application:
 * - Consistent style caching across all components
 * - Single theme subscription point
 * - Centralized style generation
 */
export const widgetStyleManager = new WidgetStyleManager();
