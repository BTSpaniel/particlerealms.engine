// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CSSGenerator - Runtime CSS generation from DesignTokens and LayerManager.
 *
 * CSS generation pattern:
 * - Generates CSS custom properties from design tokens
 * - Supports theme-based variable sets (bright/night)
 * - Caches generated CSS for performance
 * - Injects CSS into document via style tags
 * - Supports z-index layer variables
 *
 * Architecture:
 * - tokens: DesignTokens instance for token resolution
 * - layerValues: LayerManager z-index values
 * - generatedCSS: Map of cached CSS strings
 * - styleElement: DOM style element for CSS injection
 * - themes: Pre-defined theme variable sets
 */
import { tokens } from './DesignTokens.js';
import { 
  layerValues, 
  getStackingContextCSS 
} from './LayerManager.js';

export class CSSGenerator {
  constructor() {
    this.tokens = tokens;
    this.layerValues = layerValues;
    this.generatedCSS = new Map();
    this.styleElement = null;
    this.themes = {
      bright: {
        'bg-primary': '#ffffff',
        'bg-secondary': '#f8fafc',
        'bg-tertiary': '#f1f5f9',
        'bg-quaternary': '#e2e8f0',
        'text-primary': '#0f172a',
        'text-secondary': '#334155',
        'text-tertiary': '#64748b',
        'text-disabled': '#cbd5e1',
        'border-light': '#e2e8f0',
        'border-medium': '#cbd5e1',
        'border-dark': '#94a3b8',
        'border-subtle': '#f1f5f9',
        'color-primary-500': '#0ea5e9',
        'color-primary-600': '#0284c7',
        'color-success': '#10b981',
        'color-warning': '#f59e0b',
        'color-error': '#ef4444',
        'color-info': '#3b82f6',
        'input-bg': '#ffffff',
        'input-text': '#0f172a',
        'input-border': '#cbd5e1',
        'input-placeholder': '#94a3b8',
        'card-bg': '#ffffff',
        'card-border': '#e2e8f0',
        'card-shadow': '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
      },
      night: {
        'bg-primary': '#0a0a0f',
        'bg-secondary': '#0f0f17',
        'bg-tertiary': '#171723',
        'bg-quaternary': '#1f1f2e',
        'text-primary': '#e4e4e7',
        'text-secondary': '#d1d5db',
        'text-tertiary': '#9ca3af',
        'text-disabled': '#6b7280',
        'border-light': '#2a2a3a',
        'border-medium': '#3a3a4a',
        'border-dark': '#4a4a5a',
        'border-subtle': '#1a1a28',
        'color-primary-500': '#0ea5e9',
        'color-primary-600': '#0284c7',
        'color-success': '#10b981',
        'color-warning': '#f59e0b',
        'color-error': '#ef4444',
        'color-info': '#3b82f6',
        'input-bg': '#171723',
        'input-text': '#e4e4e7',
        'input-border': '#3a3a4a',
        'input-placeholder': '#9ca3af',
        'card-bg': '#0f0f17',
        'card-border': '#2a2a3a',
        'card-shadow': '0 10px 15px -3px rgba(0, 0, 0, 0.3)'
      }
    };
  }

  /**
   * Generate CSS custom properties from design tokens
   * @param {string} theme - Theme name ('bright' or 'night')
   * @returns {string} CSS custom properties declaration
   */
  generateTokensCSS(theme = 'bright') {
    const cacheKey = `tokens-${theme}`;
    if (this.generatedCSS.has(cacheKey)) {
      return this.generatedCSS.get(cacheKey);
    }

    const themeTokens = this.themes[theme] || this.themes.bright;
    const cssVars = [];

    // Add theme-specific variables
    Object.entries(themeTokens).forEach(([key, value]) => {
      cssVars.push(`--${key}: ${value};`);
    });

    // Z-Index layers
    Object.entries(this.layerValues).forEach(([key, value]) => {
      cssVars.push(`--${key}: ${value};`);
    });

    // Default spacing values
    const spacingValues = {
      'xs': '4px',
      'sm': '8px',
      'md': '12px',
      'lg': '16px',
      'xl': '24px',
      '2xl': '32px',
      '3xl': '48px'
    };
    Object.entries(spacingValues).forEach(([key, value]) => {
      cssVars.push(`--spacing-${key}: ${value};`);
    });

    // Default font sizes
    const fontSizes = {
      'xs': '12px',
      'sm': '14px',
      'md': '16px',
      'lg': '18px',
      'xl': '20px',
      '2xl': '24px'
    };
    Object.entries(fontSizes).forEach(([key, value]) => {
      cssVars.push(`--font-size-${key}: ${value};`);
    });

    // Font weights
    const fontWeights = {
      'normal': '400',
      'medium': '500',
      'semibold': '600',
      'bold': '700'
    };
    Object.entries(fontWeights).forEach(([key, value]) => {
      cssVars.push(`--font-weight-${key}: ${value};`);
    });

    // Line heights
    const lineHeights = {
      'tight': '1.2',
      'normal': '1.4',
      'relaxed': '1.6'
    };
    Object.entries(lineHeights).forEach(([key, value]) => {
      cssVars.push(`--line-height-${key}: ${value};`);
    });

    // Border radius
    const borderRadius = {
      'sm': '4px',
      'md': '6px',
      'lg': '8px',
      'xl': '12px',
      'full': '9999px'
    };
    Object.entries(borderRadius).forEach(([key, value]) => {
      cssVars.push(`--border-radius-${key}: ${value};`);
    });

    // Transitions
    const transitions = {
      'fast': '150ms ease',
      'base': '200ms ease',
      'slow': '300ms ease'
    };
    Object.entries(transitions).forEach(([key, value]) => {
      cssVars.push(`--transition-${key}: ${value};`);
    });

    // Shadows
    const shadows = {
      'sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      'md': '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
      'xl': '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
    };
    Object.entries(shadows).forEach(([key, value]) => {
      cssVars.push(`--shadow-${key}: ${value};`);
    });

    const css = `:root {\n  ${cssVars.join('\n  ')}\n}`;
    this.generatedCSS.set(cacheKey, css);
    return css;
  }

  /**
   * Generate theme-specific CSS selectors
   * @param {string} theme - Theme name
   * @returns {string} Theme CSS rules
   */
  generateThemeCSS(theme = 'bright') {
    const cacheKey = `theme-${theme}`;
    if (this.generatedCSS.has(cacheKey)) {
      return this.generatedCSS.get(cacheKey);
    }

    const themeTokens = this.themes[theme] || this.themes.bright;
    const selector = `[data-theme="${theme}"]`;
    
    const cssVars = [];
    Object.entries(themeTokens).forEach(([key, value]) => {
      cssVars.push(`--${key}: ${value};`);
    });

    const css = `${selector} {\n  ${cssVars.join('\n  ')}\n}`;
    this.generatedCSS.set(cacheKey, css);
    return css;
  }

  /**
   * Generate all CSS (tokens + themes)
   * @returns {string} Complete CSS
   */
  generateAllCSS() {
    const cacheKey = 'all-css';
    if (this.generatedCSS.has(cacheKey)) {
      return this.generatedCSS.get(cacheKey);
    }

    const parts = [
      this.generateTokensCSS('bright'),
      this.generateThemeCSS('bright'),
      this.generateThemeCSS('night')
    ];

    const css = parts.join('\n\n');
    this.generatedCSS.set(cacheKey, css);
    return css;
  }

  /**
   * Inject generated CSS into document
   * @param {string} theme - Theme name
   */
  injectCSS(theme = 'bright') {
    if (!this.styleElement) {
      this.styleElement = document.createElement('style');
      this.styleElement.setAttribute('data-plauna-generated', '1');
      document.head.appendChild(this.styleElement);
    }

    const css = this.generateAllCSS();
    this.styleElement.textContent = css;
  }

  /**
   * Get CSS as text without injecting
   * @returns {string} Complete CSS
   */
  getCSS() {
    return this.generateAllCSS();
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.generatedCSS.clear();
  }

  /**
   * Get all available tokens
   * @returns {Object} All tokens
   */
  getAllTokens() {
    return this.tokens.get();
  }

  /**
   * Get all layer values
   * @returns {Object} Layer values
   */
  getLayerValues() {
    return this.layerValues;
  }

  /**
   * Export tokens as JSON
   * @returns {string} JSON string
   */
  exportTokensJSON() {
    return this.tokens.export();
  }

  /**
   * Export CSS as downloadable file
   * @param {string} filename - Output filename
   */
  downloadCSS(filename = 'plauna-generated.css') {
    const css = this.getCSS();
    const blob = new Blob([css], { type: 'text/css' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}

// Export singleton instance
export const cssGenerator = new CSSGenerator();
