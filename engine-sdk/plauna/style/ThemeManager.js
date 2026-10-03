// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ThemeManager - Theme management system for Plauna.
 *
 * Theme management pattern:
 * - Provides theme registration and switching
 * - Supports custom token overrides
 * - Observer pattern for theme change notifications
 * - Deep merge strategy for token inheritance
 * - Pre-registered themes (light, dark)
 *
 * Architecture:
 * - themes: Map of registered theme definitions
 * - observers: Set of callback functions for change notifications
 * - customTokens: Map of custom token overrides
 * - currentTheme: Currently active theme ID
 */
import { tokens } from './DesignTokens.js';
import { adaptiveThemeFactory } from './AdaptiveThemeFactory.js';

export class ThemeManager {
    constructor() {
        this.currentTheme = 'light';
        this.themes = new Map();
        this.observers = new Set();
        this.customTokens = new Map();
        this.resolvedTheme = null;
        
        // Register default themes
        this.registerDefaultThemes();
    }

    // Register default themes
    registerDefaultThemes() {
        // Light theme
        this.registerTheme('light', {
            name: 'Light',
            description: 'Default light theme',
            tokens: {
                colors: {
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
                        inverse: '#f8fafc',
                        disabled: '#94a3b8'
                    },
                    primary: {
                        50: '#f0f9ff',
                        100: '#e0f2fe',
                        200: '#bae6fd',
                        300: '#7dd3fc',
                        400: '#38bdf8',
                        500: '#0ea5e9',
                        600: '#0284c7',
                        700: '#0369a1',
                        800: '#075985',
                        900: '#0c4a6e'
                    },
                    success: '#10b981',
                    warning: '#f59e0b',
                    error: '#ef4444',
                    info: '#3b82f6'
                },
                shadows: {
                    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
                }
            }
        });

        // Dark theme
        this.registerTheme('dark', {
            name: 'Dark',
            description: 'Dark theme for low-light environments',
            tokens: {
                colors: {
                    background: {
                        primary: '#0f172a',
                        secondary: '#1e293b',
                        tertiary: '#334155',
                        inverse: '#f8fafc'
                    },
                    text: {
                        primary: '#f8fafc',
                        secondary: '#cbd5e1',
                        tertiary: '#94a3b8',
                        inverse: '#0f172a',
                        disabled: '#64748b'
                    },
                    primary: {
                        50: '#0c4a6e',
                        100: '#075985',
                        200: '#0369a1',
                        300: '#0284c7',
                        400: '#0ea5e9',
                        500: '#38bdf8',
                        600: '#7dd3fc',
                        700: '#bae6fd',
                        800: '#e0f2fe',
                        900: '#f0f9ff'
                    },
                    success: '#10b981',
                    warning: '#f59e0b',
                    error: '#ef4444',
                    info: '#3b82f6'
                },
                shadows: {
                    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.3)',
                    md: '0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -1px rgba(0, 0, 0, 0.3)',
                    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -2px rgba(0, 0, 0, 0.3)',
                    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 10px 10px -5px rgba(0, 0, 0, 0.3)'
                }
            }
        });

        // High contrast theme
        this.registerTheme('high-contrast', {
            name: 'High Contrast',
            description: 'High contrast theme for accessibility',
            tokens: {
                colors: {
                    background: {
                        primary: '#000000',
                        secondary: '#1a1a1a',
                        tertiary: '#333333',
                        inverse: '#ffffff'
                    },
                    text: {
                        primary: '#ffffff',
                        secondary: '#ffffff',
                        tertiary: '#ffffff',
                        inverse: '#000000',
                        disabled: '#999999'
                    },
                    primary: {
                        50: '#ffffff',
                        100: '#ffffff',
                        200: '#ffffff',
                        300: '#ffffff',
                        400: '#ffffff',
                        500: '#ffffff',
                        600: '#ffffff',
                        700: '#ffffff',
                        800: '#ffffff',
                        900: '#ffffff'
                    },
                    success: '#00ff00',
                    warning: '#ffff00',
                    error: '#ff0000',
                    info: '#00ffff'
                },
                shadows: {
                    sm: '0 1px 2px 0 rgba(255, 255, 255, 0.2)',
                    md: '0 4px 6px -1px rgba(255, 255, 255, 0.3), 0 2px 4px -1px rgba(255, 255, 255, 0.2)',
                    lg: '0 10px 15px -3px rgba(255, 255, 255, 0.3), 0 4px 6px -2px rgba(255, 255, 255, 0.2)',
                    xl: '0 20px 25px -5px rgba(255, 255, 255, 0.3), 0 10px 10px -5px rgba(255, 255, 255, 0.2)'
                }
            }
        });
    }

    // Register a new theme
    registerTheme(id, theme) {
        this.themes.set(id, {
            id,
            name: theme.name || id,
            description: theme.description || '',
            tokens: theme.tokens || {},
            customTokens: theme.customTokens || {},
            extends: theme.extends || null
        });
    }

    // Get theme by ID
    getTheme(id) {
        return this.themes.get(id);
    }

    // Get all themes
    getAllThemes() {
        return Array.from(this.themes.values());
    }

    // Get current theme
    getCurrentTheme() {
        return this.resolvedTheme || this.getTheme(this.currentTheme);
    }

    // Get resolved theme tokens for a theme/context pair
    getResolvedTheme(themeId = this.currentTheme, context = {}) {
        const theme = this.getTheme(themeId);
        if (!theme) {
            return null;
        }

        const rawTokens = theme.rawTokens || theme.tokens || {};
        const resolvedTokens = adaptiveThemeFactory.createThemeTokens(
            {
                ...theme,
                tokens: rawTokens
            },
            {
                ...context,
                themeId,
                density: context.density || 'comfortable'
            }
        );

        return {
            ...theme,
            tokens: resolvedTokens,
            rawTokens
        };
    }

    // Set current theme
    setTheme(themeId) {
        const theme = this.getTheme(themeId);
        if (!theme) {
            console.error(`Theme not found: ${themeId}`);
            return false;
        }

        const oldThemeId = this.currentTheme;
        this.currentTheme = themeId;

        // Apply theme tokens
        this.applyTheme(theme);

        // Notify observers
        this.notifyObservers(themeId, oldThemeId);

        return true;
    }

    // Apply theme tokens
    applyTheme(theme) {
        // Start with base tokens
        const mergedTokens = { ...tokens.tokens };
        const rawTokens = theme.rawTokens || theme.tokens || {};

        // Apply extended theme if specified
        if (theme.extends) {
            const extendedTheme = this.getTheme(theme.extends);
            if (extendedTheme) {
                this.mergeTokens(mergedTokens, extendedTheme.rawTokens || extendedTheme.tokens || {});
            }
        }

        // Apply theme tokens
        this.mergeTokens(mergedTokens, rawTokens);

        // Apply custom tokens
        this.mergeTokens(mergedTokens, theme.customTokens);

        const resolvedTheme = adaptiveThemeFactory.createThemeTokens(
            {
                ...theme,
                tokens: mergedTokens,
                rawTokens
            },
            {
                themeId: theme.id,
                density: 'comfortable'
            }
        );

        // Update tokens in the design token system
        tokens.tokens = resolvedTheme;
        tokens.clearCache();

        // Apply global custom tokens on top of the resolved theme so they are preserved
        for (const [path, value] of this.customTokens) {
            tokens.set(path, value);
        }

        if (typeof document !== 'undefined' && document.documentElement) {
            const root = document.documentElement;
            root.dataset.theme = theme.id || this.currentTheme;

            adaptiveThemeFactory.applyToElement(root, tokens.tokens, {
                themeId: theme.id,
                density: 'comfortable'
            });
        }

        this.resolvedTheme = {
            ...theme,
            tokens: tokens.tokens,
            rawTokens
        };

        return tokens.tokens;
    }

    // Merge tokens recursively
    mergeTokens(target, source) {
        for (const [key, value] of Object.entries(source)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                if (!target[key]) {
                    target[key] = {};
                }
                this.mergeTokens(target[key], value);
            } else {
                target[key] = value;
            }
        }
    }

    // Subscribe to theme changes
    subscribe(callback) {
        this.observers.add(callback);
        
        // Return unsubscribe function
        return () => this.observers.delete(callback);
    }

    // Notify observers of theme change
    notifyObservers(newThemeId, oldThemeId) {
        for (const callback of this.observers) {
            try {
                callback(newThemeId, oldThemeId);
            } catch (error) {
                console.error('Error in theme observer:', error);
            }
        }
    }

    // Create custom theme
    createCustomTheme(id, baseThemeId, customizations = {}) {
        const baseTheme = this.getTheme(baseThemeId);
        if (!baseTheme) {
            console.error(`Base theme not found: ${baseThemeId}`);
            return null;
        }

        const customTheme = {
            id,
            name: customizations.name || `Custom ${baseTheme.name}`,
            description: customizations.description || `Custom theme based on ${baseTheme.name}`,
            extends: baseThemeId,
            tokens: customizations.tokens || {},
            customTokens: customizations.customTokens || {}
        };

        this.registerTheme(id, customTheme);
        return customTheme;
    }

    // Set custom token
    setCustomToken(path, value) {
        this.customTokens.set(path, value);
        tokens.set(path, value);
        tokens.clearCache();
    }

    // Get custom token
    getCustomToken(path) {
        return this.customTokens.get(path);
    }

    // Remove custom token
    removeCustomToken(path) {
        this.customTokens.delete(path);
        // Note: We don't remove from tokens.tokens as it might be part of a theme
    }

    // Clear custom tokens
    clearCustomTokens() {
        this.customTokens.clear();
        // Reapply current theme to reset tokens
        const currentTheme = this.getCurrentTheme();
        if (currentTheme) {
            this.applyTheme(currentTheme);
        }
    }

    // Export theme
    exportTheme(themeId) {
        const theme = this.getTheme(themeId);
        if (!theme) return null;

        return {
            id: theme.id,
            name: theme.name,
            description: theme.description,
            extends: theme.extends,
            tokens: theme.tokens,
            customTokens: theme.customTokens
        };
    }

    // Import theme
    importTheme(themeData) {
        if (!themeData.id) {
            console.error('Theme data must have an id');
            return false;
        }

        this.registerTheme(themeData.id, themeData);
        return true;
    }

    // Get theme preview
    getThemePreview(themeId) {
        const theme = this.getTheme(themeId);
        if (!theme) return null;

        // Get key tokens for preview
        const preview = {
            id: theme.id,
            name: theme.name,
            description: theme.description,
            colors: {
                background: tokens.get(`colors.background.primary`),
                text: tokens.get(`colors.text.primary`),
                primary: tokens.get(`colors.primary.500`),
                success: tokens.get(`colors.success`),
                warning: tokens.get(`colors.warning`),
                error: tokens.get(`colors.error`)
            },
            shadows: {
                md: tokens.get('shadows.md')
            }
        };

        return preview;
    }

    // Detect system theme preference
    detectSystemTheme() {
        if (typeof window !== 'undefined' && window.matchMedia) {
            const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
            return darkModeQuery.matches ? 'dark' : 'light';
        }
        return 'light';
    }

    // Auto-detect and apply system theme
    applySystemTheme() {
        const systemTheme = this.detectSystemTheme();
        return this.setTheme(systemTheme);
    }

    // Watch for system theme changes
    watchSystemTheme() {
        if (typeof window !== 'undefined' && window.matchMedia) {
            const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
            
            darkModeQuery.addEventListener('change', (e) => {
                const newTheme = e.matches ? 'dark' : 'light';
                this.setTheme(newTheme);
            });

            return () => {
                darkModeQuery.removeEventListener('change', this.handleSystemThemeChange);
            };
        }
        
        return () => {}; // No-op cleanup function
    }

    // Get theme statistics
    getThemeStats() {
        const stats = {
            totalThemes: this.themes.size,
            currentTheme: this.currentTheme,
            customTokens: this.customTokens.size,
            observers: this.observers.size
        };

        // Count theme types
        const themeTypes = {
            builtIn: 0,
            custom: 0,
            extended: 0
        };

        for (const theme of this.themes.values()) {
            if (theme.extends) {
                themeTypes.extended++;
            } else if (['light', 'dark', 'high-contrast'].includes(theme.id)) {
                themeTypes.builtIn++;
            } else {
                themeTypes.custom++;
            }
        }

        stats.themeTypes = themeTypes;
        return stats;
    }

    // Validate theme
    validateTheme(themeData) {
        const errors = [];

        if (!themeData.id) {
            errors.push('Theme must have an id');
        }

        if (!themeData.tokens) {
            errors.push('Theme must have tokens');
        }

        if (themeData.extends && !this.getTheme(themeData.extends)) {
            errors.push(`Extended theme not found: ${themeData.extends}`);
        }

        // Validate required token paths
        const requiredPaths = [
            'colors.background.primary',
            'colors.text.primary',
            'colors.primary.500'
        ];

        if (themeData.tokens && themeData.tokens.colors) {
            for (const path of requiredPaths) {
                const parts = path.split('.');
                let current = themeData.tokens;
                
                for (const part of parts) {
                    if (!current[part]) {
                        errors.push(`Missing required token: ${path}`);
                        break;
                    }
                    current = current[part];
                }
            }
        }

        return errors;
    }

    // Remove theme
    removeTheme(themeId) {
        if (['light', 'dark', 'high-contrast'].includes(themeId)) {
            console.error('Cannot remove built-in themes');
            return false;
        }

        if (this.currentTheme === themeId) {
            console.error('Cannot remove currently active theme');
            return false;
        }

        return this.themes.delete(themeId);
    }

    // Reset to defaults
    reset() {
        this.currentTheme = 'light';
        this.customTokens.clear();
        this.applyTheme(this.getTheme('light'));
    }

    // Destroy
    destroy() {
        this.observers.clear();
        this.customTokens.clear();
        this.themes.clear();
    }
}

// Theme utility functions
export const ThemeUtils = {
    // Create theme manager
    create() {
        return new ThemeManager();
    },

    // Get default theme
    getDefaultTheme() {
        return 'light';
    },

    // Get dark theme
    getDarkTheme() {
        return 'dark';
    },

    // Get high contrast theme
    getHighContrastTheme() {
        return 'high-contrast';
    },

    // Check if theme is dark
    isDarkTheme(themeId) {
        return themeId === 'dark' || themeId === 'high-contrast';
    },

    // Check if theme is high contrast
    isHighContrastTheme(themeId) {
        return themeId === 'high-contrast';
    },

    // Get theme contrast ratio (simplified)
    getContrastRatio(themeId) {
        if (themeId === 'high-contrast') {
            return 21; // Maximum contrast
        }
        return 4.5; // WCAG AA standard
    },

    // Create theme variant
    createVariant(baseThemeId, variantName, modifications) {
        const manager = new ThemeManager();
        return manager.createCustomTheme(
            `${baseThemeId}-${variantName}`,
            baseThemeId,
            modifications
        );
    },

    // Apply theme to DOM
    applyToDOM(themeId) {
        const manager = new ThemeManager();
        manager.setTheme(themeId);
        
        // Apply theme class to body
        if (typeof document !== 'undefined') {
            document.body.className = document.body.className.replace(/theme-\w+/g, '');
            document.body.classList.add(`theme-${themeId}`);
        }
    }
};
