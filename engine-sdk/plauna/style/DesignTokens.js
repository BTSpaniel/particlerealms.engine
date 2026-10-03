// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { hexToRgb as mathHexToRgb } from '../../engine/core/math/MathColor.js';
import {
    DESIGN_TOKEN_SCHEMA,
    DESIGN_TOKEN_SCHEMA_VERSION,
    createDesignTokenExport,
    prepareDesignTokenDocument,
} from './DesignTokenContracts.js';

/**
 * ============================================================================
 * DesignTokens - Design System Token Management
 * ============================================================================
 *
 * DesignTokens provides a centralized token system for Plauna's styling.
 * It manages spacing, typography, color, and motion tokens following design
 * system best practices (similar to Material Design, Tailwind, etc.).
 *
 * TOKEN CATEGORIES:
 * - spacing: Size tokens (xs, sm, md, lg, xl, 2xl, etc.)
 * - typography: Font families, sizes, weights, line heights
 * - colors: Color palettes (primary, secondary, success, warning, error, etc.)
 * - motion: Animation durations, easings
 * - borderRadius: Border radius values (sm, md, lg, full)
 * - shadows: Shadow definitions (sm, md, lg, xl)
 * - zIndex: Z-index layer values
 *
 * TOKEN ACCESS PATTERNS:
 * - tokens.get('spacing.md') → Returns spacing medium value
 * - tokens.get('colors.primary') → Returns primary color
 * - tokens.get('typography.fontSizes.sm') → Returns small font size
 *
 * OBSERVER PATTERN:
 * - Observers can subscribe to token changes
 * - When a token changes, all observers are notified
 * - Used by WidgetStyleManager to regenerate styles on theme changes
 *
 * CACHING:
 * - Token lookups are cached for performance
 * - Cache is cleared when tokens are modified
 *
 * MERGE STRATEGY:
 * - Deep merge of token objects
 * - Custom tokens override default tokens
 * - Arrays are replaced (not merged)
 *
 * HELPER METHODS:
 * - multiplySpacing(path, multiplier): Scale a spacing token
 * - applyOpacity(path, opacity): Apply opacity to a color token
 *
 * DEFAULT TOKENS:
 * Defined at end of file with sensible defaults for a modern design system.
 * Can be overridden by passing customTokens to constructor.
 */

/**
 * DesignTokens - Design system token management.
 *
 * Token management pattern:
 * - Centralized token system for Plauna styling
 * - Manages spacing, typography, color, motion, borderRadius, shadows, zIndex
 * - Observer pattern for token change notifications
 * - Caching for performance optimization
 * - Deep merge strategy for token inheritance
 *
 * Architecture:
 * - tokens: Merged token object (defaults + custom)
 * - observers: Set of callback functions
 * - cache: Map of cached token lookups
 */
export class DesignTokens {
    constructor(customTokens = {}) {
        this.tokens = this.mergeTokens(DEFAULT_TOKENS, customTokens);
        this.observers = new Set();
        this.cache = new Map();
    }

    /**
     * Get a token value by path.
     *
     * Token access pattern:
     * - Supports dot notation (e.g., 'spacing.md')
     * - Returns cached value if available
     * - Falls back to defaultValue if token not found
     * - Caches result for subsequent lookups
     *
     * @param {string} path - Token path (e.g., 'spacing.md', 'colors.primary')
     * @param {*} defaultValue - Default value if token not found
     * @returns {*} Token value
     */
    get(path, defaultValue = undefined) {
        const cacheKey = `get_${path}`;
        
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        const legacyAliases = {
            'colors.primary': 'colors.primary.500',
            'colors.secondary': 'colors.secondary.500',
            'colors.accent': 'colors.accent.500',
            'colors.background': 'colors.background.primary',
            'colors.text': 'colors.text.primary',
            'colors.border': 'colors.border.medium',
            'colors.surface': 'colors.background.secondary',
            'fontSizes': 'fontSizes',
            'fontWeights': 'fontWeights',
            'borderRadius': 'borderRadius'
        };

        const resolvedPath = legacyAliases[path] || path;

        const value = this.getNestedValue(this.tokens, resolvedPath);
        const result = value !== undefined ? value : defaultValue;
        
        this.cache.set(cacheKey, result);
        return result;
    }

    /**
     * Set a token value by path.
     *
     * Token mutation pattern:
     * - Sets token value using dot notation
     * - Clears cache to invalidate stale values
     * - Notifies observers of token change
     * - Provides old value for comparison
     *
     * @param {string} path - Token path (e.g., 'spacing.md')
     * @param {*} value - New token value
     */
    set(path, value) {
        const oldValue = this.get(path);
        this.setNestedValue(this.tokens, path, value);
        
        // Clear cache
        this.clearCache();
        
        // Notify observers
        this.notifyObservers(path, value, oldValue);
    }

    // Merge tokens
    mergeTokens(target, source) {
        const result = { ...target };
        
        for (const [key, value] of Object.entries(source)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                result[key] = this.mergeTokens(result[key] || {}, value);
            } else {
                result[key] = value;
            }
        }
        
        return result;
    }

    // Get nested value
    getNestedValue(obj, path) {
        const parts = path.split('.');
        let current = obj;
        
        for (const part of parts) {
            if (current === null || current === undefined) {
                return undefined;
            }
            current = current[part];
        }
        
        return current;
    }

    // Set nested value
    setNestedValue(obj, path, value) {
        const parts = path.split('.');
        let current = obj;
        
        // Navigate to parent of target
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            
            if (!(part in current) || typeof current[part] !== 'object') {
                current[part] = {};
            }
            
            current = current[part];
        }
        
        // Set the final value
        current[parts[parts.length - 1]] = value;
    }

    // Subscribe to token changes
    subscribe(path, callback) {
        const observer = { path, callback };
        this.observers.add(observer);
        
        // Return unsubscribe function
        return () => this.observers.delete(observer);
    }

    // Notify observers of changes
    notifyObservers(path, newValue, oldValue) {
        for (const observer of this.observers) {
            if (this.pathMatches(observer.path, path)) {
                try {
                    observer.callback(newValue, oldValue, path);
                } catch (error) {
                    console.error(`Error in token observer for ${path}:`, error);
                }
            }
        }
    }

    // Check if path matches observer path (supports wildcards)
    pathMatches(observerPath, changedPath) {
        if (observerPath === changedPath) return true;
        if (observerPath.endsWith('*')) {
            const prefix = observerPath.slice(0, -1);
            return changedPath.startsWith(prefix);
        }
        return false;
    }

    // Clear cache
    clearCache() {
        this.cache.clear();
    }

    // Get all tokens as flat object
    getAllTokens(prefix = '', result = {}) {
        const obj = prefix ? this.getNestedValue(this.tokens, prefix) : this.tokens;
        
        for (const [key, value] of Object.entries(obj)) {
            const fullPath = prefix ? `${prefix}.${key}` : key;
            
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                this.getAllTokens(fullPath, result);
            } else {
                result[fullPath] = value;
            }
        }
        
        return result;
    }

    // Apply theme
    applyTheme(themeName) {
        const theme = this.get(`themes.${themeName}`);
        if (theme) {
            this.tokens = this.mergeTokens(this.tokens, theme);
            this.clearCache();
            this.notifyObservers('*', theme, null);
        }
    }

    // Create token reference (for computed values)
    createTokenReference(path) {
        return () => this.get(path);
    }

    // Validate tokens
    validate() {
        const errors = [];
        
        // Check required tokens
        const requiredPaths = [
            'spacing.xs', 'spacing.sm', 'spacing.md', 'spacing.lg', 'spacing.xl',
            'typography.scale',
            'colors.primary', 'colors.background', 'colors.text'
        ];
        
        for (const path of requiredPaths) {
            if (this.get(path) === undefined) {
                errors.push(`Missing required token: ${path}`);
            }
        }
        
        // Check token types
        const typeChecks = {
            'spacing.xs': 'number',
            'colors.primary': 'string',
            'typography.scale': 'object'
        };
        
        for (const [path, expectedType] of Object.entries(typeChecks)) {
            const value = this.get(path);
            if (value !== undefined && typeof value !== expectedType) {
                errors.push(`Token ${path} should be ${expectedType}, got ${typeof value}`);
            }
        }
        
        return errors;
    }

    // Export tokens
    export() {
        return JSON.stringify(createDesignTokenExport({
            schema: DESIGN_TOKEN_SCHEMA,
            schemaVersion: DESIGN_TOKEN_SCHEMA_VERSION,
            tokens: this.tokens,
        }), null, 2);
    }

    // Import tokens
    import(tokenJson) {
        try {
            const parsed = typeof tokenJson === 'string' ? JSON.parse(tokenJson) : tokenJson;
            const candidate = prepareDesignTokenDocument(parsed).tokens;
            const validator = Object.create(DesignTokens.prototype);
            validator.tokens = candidate;
            validator.cache = new Map();
            const errors = validator.validate();
            if (errors.length > 0) throw new Error(`Invalid design tokens: ${errors.join('; ')}`);
            this.tokens = candidate;
            this.clearCache();
            this.notifyObservers('*', candidate, null);
            return true;
        } catch (error) {
            console.error('Failed to import tokens:', error);
            return false;
        }
    }

    // Get computed token (with calculations)
    getComputed(path, ...args) {
        const cacheKey = `computed_${path}_${args.join('_')}`;
        
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        let result;
        
        switch (path) {
            case 'spacing.multiply':
                result = this.multiplySpacing(args[0], args[1]);
                break;
            case 'typography.fontSize':
                result = this.getFontSize(args[0]);
                break;
            case 'colors.opacity':
                result = this.applyOpacity(args[0], args[1]);
                break;
            default:
                result = this.get(path);
        }
        
        this.cache.set(cacheKey, result);
        return result;
    }

    // Multiply spacing scale
    multiplySpacing(base, multiplier) {
        const baseSpacing = this.get(`spacing.${base}`, 0);
        return baseSpacing * multiplier;
    }

    // Get font size from scale
    getFontSize(scaleIndex) {
        const scale = this.get('typography.scale', []);
        return scale[Math.min(scaleIndex, scale.length - 1)] || 16;
    }

    // ComputedStyle compatibility helpers
    spacing(size) {
        return this.get(`spacing.${size}`, 0);
    }

    typography(path) {
        return this.get(`typography.${path}`);
    }

    color(path) {
        return this.get(`colors.${path}`);
    }

    radius(size) {
        return this.get(`radius.${size}`, 0);
    }

    shadow(size) {
        return this.get(`shadows.${size}`, 'none');
    }

    zIndex(layer) {
        return this.get(`zIndex.${layer}`, undefined);
    }

    // Apply opacity to color
    applyOpacity(color, opacity) {
        // Simple hex color opacity application
        if (color.startsWith('#')) {
            const hex = color.slice(1);
            if (/^[a-f\d]{6}$/i.test(hex)) {
                const [r, g, b] = mathHexToRgb(hex);
                return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${opacity})`;
            }

            const r = parseInt(hex.substr(0, 2), 16);
            const g = parseInt(hex.substr(2, 2), 16);
            const b = parseInt(hex.substr(4, 2), 16);
            
            return `rgba(${r}, ${g}, ${b}, ${opacity})`;
        }
        
        return color;
    }

    // Destroy
    destroy() {
        this.observers.clear();
        this.cache.clear();
    }
}

// Default tokens following Material Design and Apple HIG patterns
const DEFAULT_TOKENS = {
    // Spacing scale (8dp base)
    spacing: {
        xs: 4,    // 0.5x
        sm: 8,    // 1x
        md: 16,   // 2x
        lg: 24,   // 3x
        xl: 32,   // 4x
        xxl: 48,  // 6x
        xxxl: 64  // 8x
    },

    // Typography scale
    typography: {
        scale: [12, 14, 16, 18, 24, 32, 48, 64],
        fontFamily: {
            primary: '"Inter", system-ui, -apple-system, sans-serif',
            monospace: '"JetBrains Mono", "SF Mono", monospace',
            display: '"Inter Display", system-ui, -apple-system, sans-serif'
        },
        fontWeight: {
            light: 300,
            regular: 400,
            medium: 500,
            semibold: 600,
            bold: 700,
            extrabold: 800
        },
        lineHeight: {
            tight: 1.2,
            normal: 1.4,
            relaxed: 1.6
        }
    },

    // Color system
    colors: {
        // Primary colors
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

        // Secondary colors
        secondary: {
            50: '#f8fafc',
            100: '#e2e8f0',
            200: '#cbd5e1',
            300: '#94a3b8',
            400: '#64748b',
            500: '#475569',
            600: '#334155',
            700: '#1e293b',
            800: '#0f172a',
            900: '#020617'
        },

        // Accent colors
        accent: {
            50: '#f5f3ff',
            100: '#ede9fe',
            200: '#ddd6fe',
            300: '#c4b5fd',
            400: '#a78bfa',
            500: '#8b5cf6',
            600: '#7c3aed',
            700: '#6d28d9',
            800: '#5b21b6',
            900: '#4c1d95'
        },
        
        // Semantic colors
        background: {
            primary: '#ffffff',
            secondary: '#f8fafc',
            tertiary: '#f1f5f9',
            disabled: '#f1f5f9',
            inverse: '#0f172a'
        },
        
        text: {
            primary: '#0f172a',
            secondary: '#475569',
            tertiary: '#64748b',
            muted: '#64748b',
            inverse: '#f8fafc',
            disabled: '#94a3b8'
        },

        border: {
            light: '#e2e8f0',
            medium: '#cbd5e1',
            dark: '#94a3b8',
            disabled: '#e2e8f0'
        },

        surface: '#ffffff',
        
        // Status colors
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
        info: '#3b82f6'
    },

    // Border radius scale
    radius: {
        none: 0,
        sm: 4,
        md: 8,
        lg: 12,
        xl: 16,
        full: 9999
    },

    borderRadius: {
        none: '0px',
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        full: '9999px'
    },

    fontSizes: {
        xs: '12px',
        sm: '14px',
        md: '16px',
        lg: '18px',
        xl: '20px',
        '2xl': '24px',
        '3xl': '32px',
        '4xl': '48px'
    },

    fontWeights: {
        light: 300,
        normal: 400,
        medium: 500,
        semibold: 600,
        bold: 700,
        extrabold: 800
    },

    // Shadow system
    shadows: {
        sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
    },

    // Motion/animation
    motion: {
        duration: {
            fast: 150,
            normal: 300,
            slow: 500
        },
        easing: {
            ease: 'cubic-bezier(0.4, 0, 0.2, 1)',
            easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
            easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
            easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)'
        }
    },

    // Z-index scale
    zIndex: {
        base: 0,
        raised: 10,
        dropdown: 1000,
        sticky: 1100,
        modal: 1200,
        popover: 1300,
        tooltip: 1400,
        notification: 1500
    },

    // Breakpoints
    breakpoints: {
        sm: 640,
        md: 768,
        lg: 1024,
        xl: 1280,
        xxl: 1536
    },

    // Component-specific tokens
    components: {
        button: {
            height: {
                sm: 32,
                md: 40,
                lg: 48
            },
            padding: {
                sm: '8px 16px',
                md: '12px 24px',
                lg: '16px 32px'
            }
        },
        
        input: {
            height: {
                sm: 32,
                md: 40,
                lg: 48
            },
            padding: '8px 12px'
        },
        
        card: {
            padding: '24px',
            radius: '12px',
            shadow: 'md'
        }
    },

    // Themes
    themes: {
        light: {
            colors: {
                background: {
                    primary: '#ffffff',
                    secondary: '#f8fafc'
                },
                text: {
                    primary: '#0f172a',
                    secondary: '#475569'
                }
            }
        },
        
        dark: {
            colors: {
                background: {
                    primary: '#0f172a',
                    secondary: '#1e293b'
                },
                text: {
                    primary: '#f8fafc',
                    secondary: '#cbd5e1'
                }
            }
        }
    }
};

// Create default instance
export const tokens = new DesignTokens();

// Utility functions for working with tokens
export const TokenUtils = {
    // Get spacing value
    spacing(size) {
        return tokens.get(`spacing.${size}`, 0);
    },

    // Get typography value
    typography(path) {
        return tokens.get(`typography.${path}`);
    },

    // Get color value
    color(path) {
        return tokens.get(`colors.${path}`);
    },

    // Get radius value
    radius(size) {
        return tokens.get(`radius.${size}`, 0);
    },

    // Get shadow value
    shadow(size) {
        return tokens.get(`shadows.${size}`, 'none');
    },

    // Get motion value
    motion(path) {
        return tokens.get(`motion.${path}`);
    },

    // Create responsive spacing
    responsiveSpacing(baseSize, breakpoint) {
        const multiplier = tokens.get(`breakpoints.${breakpoint}`, 1) / 768; // Normalize to md
        return tokens.multiplySpacing(baseSize, multiplier);
    },

    // Create color with opacity
    colorWithOpacity(colorPath, opacity) {
        const color = tokens.get(`colors.${colorPath}`);
        return tokens.applyOpacity(color, opacity);
    }
};
