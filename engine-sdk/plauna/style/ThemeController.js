// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ThemeController - Runtime theme management and switching.
 *
 * Theme switching pattern:
 * - Manages bright/night theme switching with live CSS updates
 * - Persists theme preference to localStorage
 * - Listens to system theme preference (prefers-color-scheme)
 * - Observer pattern for theme change notifications
 * - Applies theme via data-theme attribute and CSS variables
 *
 * Features:
 * - Auto-switch based on system preference
 * - Manual theme switching with setTheme()
 * - Theme persistence across sessions
 * - Observer notifications for reactive updates
 */
import { cssGenerator } from './CSSGenerator.js';
import {
  COLOR_MODE_STORAGE_KEY,
  readColorModePreference,
  writeColorModePreference,
} from '../themes/ThemePreference.js';

export class ThemeController {
  constructor() {
    this.currentTheme = 'bright';
    this.observers = new Set();
    this.storageKey = COLOR_MODE_STORAGE_KEY;
    
    this.loadSavedTheme();
    this.setupSystemThemeListener();
  }

  /**
   * Load saved theme from localStorage.
   *
   * Persistence pattern:
   * - Reads theme preference from localStorage
   * - Validates theme value (bright or night)
   * - Falls back to 'bright' if invalid or unavailable
   * - Gracefully handles localStorage errors
   */
  loadSavedTheme() {
    try {
      const saved = readColorModePreference();
      if (saved) this.currentTheme = saved;
    } catch (e) {
      // localStorage not available
    }
  }

  /**
   * Save theme preference to localStorage
   */
  saveTheme() {
    try {
      writeColorModePreference(this.currentTheme);
    } catch (e) {
      // localStorage not available
    }
  }

  /**
   * Setup system theme listener (prefers-color-scheme)
   */
  setupSystemThemeListener() {
    if (window.matchMedia) {
      const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      darkModeQuery.addEventListener('change', (e) => {
        if (!readColorModePreference()) {
          // Only auto-switch if user hasn't set a preference
          this.setTheme(e.matches ? 'night' : 'bright');
        }
      });
    }
  }

  /**
   * Set the current theme.
   *
   * Theme switching pattern:
   * - Validates theme value (bright or night)
   * - Skips if already set to same theme
   * - Updates currentTheme state
   * - Applies theme to DOM (data-theme attribute + CSS variables)
   * - Persists to localStorage
   * - Notifies observers of change
   *
   * @param {string} theme - 'bright' or 'night'
   */
  setTheme(theme) {
    if (theme !== 'bright' && theme !== 'night') {
      console.warn(`Invalid theme: ${theme}. Using 'bright'.`);
      theme = 'bright';
    }

    if (this.currentTheme === theme) {
      return; // No change
    }

    this.currentTheme = theme;
    this.applyTheme();
    this.saveTheme();
    this.notifyObservers();
  }

  /**
   * Apply theme to DOM and CSS
   */
  applyTheme() {
    // Set data-theme attribute on root element
    const root = document.documentElement;
    root.setAttribute('data-theme', this.currentTheme);

    // Update CSS variables
    cssGenerator.injectCSS(this.currentTheme);
  }

  /**
   * Get current theme
   * @returns {string} Current theme name
   */
  getTheme() {
    return this.currentTheme;
  }

  /**
   * Toggle between bright and night themes
   */
  toggleTheme() {
    this.setTheme(this.currentTheme === 'bright' ? 'night' : 'bright');
  }

  /**
   * Subscribe to theme changes
   * @param {Function} callback - Called when theme changes
   * @returns {Function} Unsubscribe function
   */
  subscribe(callback) {
    this.observers.add(callback);
    return () => this.observers.delete(callback);
  }

  /**
   * Notify all observers of theme change
   */
  notifyObservers() {
    this.observers.forEach(callback => {
      try {
        callback(this.currentTheme);
      } catch (e) {
        console.error('Theme observer error:', e);
      }
    });
  }

  /**
   * Get all available themes
   * @returns {Array<string>} Theme names
   */
  getAvailableThemes() {
    return ['bright', 'night'];
  }

  /**
   * Check if theme is dark
   * @returns {boolean}
   */
  isDark() {
    return this.currentTheme === 'night';
  }

  /**
   * Check if theme is light
   * @returns {boolean}
   */
  isLight() {
    return this.currentTheme === 'bright';
  }

  /**
   * Get theme-specific CSS variable value
   * @param {string} variableName - CSS variable name (without --)
   * @returns {string} CSS variable value
   */
  getTokenValue(variableName) {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(`--${variableName}`)
      .trim();
    return value;
  }

  /**
   * Initialize theme system
   */
  initialize() {
    this.applyTheme();
  }
}

// Export singleton instance
export const themeController = new ThemeController();
