// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * LayerManager - Semantic z-index management system.
 *
 * Z-index management pattern:
 * - Centralized z-index constants organized by stacking context
 * - Arithmetic relationships for self-documenting code
 * - Prevents z-index wars by providing semantic layer names
 * - Uses isolation: isolate for stacking context isolation
 *
 * Stacking contexts (lowest to highest):
 * - Layout: backdrop, surface, widget gallery
 * - Modal: backdrop, panel
 * - Dropdown: backdrop, dropdown
 * - Tooltip
 * - Notification: toast, alert
 *
 * Arithmetic pattern:
 * - base = 0
 * - above = 1
 * - below = -1
 * - Each layer is defined relative to the previous layer
 */

// Utils for arithmetic z-index relationships
const base = 0;
const above = 1;
const below = -1;

// Page Layout Context
export const zLayoutBackdrop = base;
export const zLayoutSurface = above + zLayoutBackdrop;
export const zLayoutWidgetGallery = above + zLayoutSurface;

// Modal Context
export const zModalBackdrop = above + zLayoutWidgetGallery;
export const zModalPanel = above + zModalBackdrop;

// Dropdown/Popover Context
export const zDropdownBackdrop = above + zLayoutWidgetGallery;
export const zDropdown = above + zDropdownBackdrop;

// Tooltip Context
export const zTooltip = above + zModalPanel;

// Notification Context
export const zNotificationToast = above + zTooltip;
export const zNotificationAlert = above + zNotificationToast;

// Export as object for CSS variable mapping
export const layerValues = {
  'z-layout-backdrop': zLayoutBackdrop,
  'z-layout-surface': zLayoutSurface,
  'z-layout-widget-gallery': zLayoutWidgetGallery,
  'z-modal-backdrop': zModalBackdrop,
  'z-modal-panel': zModalPanel,
  'z-dropdown-backdrop': zDropdownBackdrop,
  'z-dropdown': zDropdown,
  'z-tooltip': zTooltip,
  'z-notification-toast': zNotificationToast,
  'z-notification-alert': zNotificationAlert
};

/**
 * Create CSS for stacking context isolation.
 *
 * Stacking context pattern:
 * - Uses isolation: isolate to create new stacking context
 * - Prevents side effects from parent stacking contexts
 * - Returns CSS object with isolation and z-index
 *
 * @param {string} layerName - Name of the layer (e.g., 'z-modal-panel')
 * @returns {Object} CSS object with isolation and z-index
 */
export function getStackingContextCSS(layerName) {
  return {
    isolation: 'isolate',
    zIndex: layerValues[layerName] || 'auto'
  };
}

/**
 * Get z-index value for a layer
 * @param {string} layerName - Name of the layer
 * @returns {number} Z-index value
 */
export function getLayerZIndex(layerName) {
  return layerValues[layerName] || 0;
}

/**
 * Get all layer values as CSS custom properties
 * @returns {string} CSS custom property declarations
 */
export function getLayerCSSVariables() {
  return Object.entries(layerValues)
    .map(([name, value]) => `--${name}: ${value};`)
    .join('\n  ');
}
