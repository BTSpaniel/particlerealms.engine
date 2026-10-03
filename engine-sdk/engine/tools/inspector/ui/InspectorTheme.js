// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * InspectorTheme.js - Unified theme system for all inspector panels
 * 
 * Provides consistent colors, spacing, and styling across all inspector UI.
 */

export const INSPECTOR_THEME = {
  // Color palette - matches editor dark-theme.css
  colors: {
    // Backgrounds
    bg: {
      primary: "#0c0c12",      // Main dark background
      secondary: "#08080c",    // Darker secondary
      tertiary: "#101018",     // Elevated
      card: "rgba(12, 12, 18, 0.85)",  // Card background with transparency
      hover: "rgba(255, 255, 255, 0.04)",  // Hover state
      active: "rgba(59, 130, 246, 0.12)",  // Active/selected state
      glow: "rgba(59, 130, 246, 0.08)",   // Subtle glow
    },
    
    // Borders
    border: {
      light: "#2a2a3a",        // Light border
      medium: "#27272a",       // Medium border
      dark: "#1e1e2e",         // Dark border
      accent: "#3b82f6",       // Accent border
    },
    
    // Text
    text: {
      primary: "#e4e4e7",      // Main text
      secondary: "#71717a",    // Secondary text
      muted: "#52525b",        // Muted text
      accent: "#60a5fa",       // Accent text
    },
    
    // Semantic colors
    semantic: {
      success: "#22c55e",      // Green
      warning: "#f59e0b",      // Amber
      error: "#ef4444",        // Red
      info: "#06b6d4",         // Cyan
    },
    
    // Category colors (for tabs, badges, etc.)
    category: {
      shapes: "#8b5cf6",       // Purple
      emitters: "#f97316",     // Orange
      lights: "#fbbf24",       // Yellow
      cameras: "#06b6d4",      // Cyan
      all: "#3b82f6",          // Blue
    },
    
    // Slider/control colors
    slider: {
      particles: "#f97316",    // Orange
      workgroup: "#8b5cf6",    // Purple
      room: "#22c55e",         // Green
      simulation: "#3b82f6",   // Blue
      physics: "#f59e0b",      // Amber
      light: "#fbbf24",        // Yellow
    },
  },

  // Spacing
  spacing: {
    xs: "2px",
    sm: "4px",
    md: "8px",
    lg: "12px",
    xl: "16px",
    xxl: "24px",
  },

  // Border radius
  radius: {
    sm: "4px",
    md: "6px",
    lg: "8px",
    xl: "12px",
    full: "999px",
  },

  // Font sizes
  fontSize: {
    xs: "9px",
    sm: "10px",
    md: "11px",
    lg: "12px",
    xl: "13px",
    xxl: "14px",
  },

  // Font weights
  fontWeight: {
    normal: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },

  // Transitions
  transition: "all 0.15s ease",

  // Global styles
  noSelect: {
    userSelect: "none",
    WebkitUserSelect: "none",
    MozUserSelect: "none",
    msUserSelect: "none",
  },

  // Box shadows
  shadow: {
    sm: "0 1px 3px rgba(0, 0, 0, 0.5)",
    md: "0 4px 16px rgba(0, 0, 0, 0.6)",
    lg: "0 8px 32px rgba(0, 0, 0, 0.7)",
    glow: "0 0 24px rgba(59, 130, 246, 0.25)",
    inset: "inset 0 1px 0 rgba(255,255,255,0.04)",
    sliderThumb: "0 2px 8px rgba(0,0,0,0.6), 0 0 0 2px rgba(255,255,255,0.1)",
  },

  effects: {
    glassBackground: "linear-gradient(145deg, rgba(16,16,24,0.92), rgba(8,8,12,0.95))",
    glassBorder: "1px solid rgba(255,255,255,0.06)",
    blur: "blur(12px)",
    cardGradient: "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%)",
    sliderTrack: "linear-gradient(90deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)",
    sectionDivider: "linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)",
  },

  // Component styles (reusable)
  components: {
    button: {
      base: {
        padding: "6px 10px",
        fontSize: "11px",
        fontWeight: "500",
        border: "1px solid transparent",
        borderRadius: "4px",
        cursor: "pointer",
        transition: "all 0.15s ease",
        boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
      },
      primary: {
        background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
        color: "#ffffff",
        border: "1px solid #3b82f6",
      },
      secondary: {
        background: "transparent",
        color: "#71717a",
        border: "1px solid #27272a",
      },
    },

    input: {
      base: {
        fontSize: "11px",
        padding: "6px 8px",
        background: "#0a0a0f",
        color: "#e4e4e7",
        border: "1px solid #27272a",
        borderRadius: "4px",
        transition: "all 0.15s ease",
      },
    },

    section: {
      base: {
        marginBottom: "12px",
        padding: "14px 16px",
        borderRadius: "10px",
        background: "linear-gradient(180deg, rgba(18,18,26,0.9) 0%, rgba(12,12,18,0.95) 100%)",
        border: "1px solid rgba(255,255,255,0.05)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.03)",
        transition: "all 0.2s ease",
      },
      header: {
        fontSize: "11px",
        fontWeight: "600",
        color: "#64748b",
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        marginBottom: "12px",
        paddingBottom: "8px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      },
    },

    row: {
      base: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 12px",
        marginBottom: "6px",
        borderRadius: "8px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.04)",
        transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
      },
      hover: {
        background: "rgba(255,255,255,0.05)",
        borderColor: "rgba(255,255,255,0.08)",
      },
    },

    label: {
      base: {
        fontSize: "10px",
        fontWeight: "600",
        color: "#52525b",
        marginBottom: "4px",
        userSelect: "none",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      },
    },

    slider: {
      base: {
        width: "100%",
        height: "4px",
        borderRadius: "2px",
        background: "#27272a",
      },
    },

    tab: {
      base: {
        padding: "4px 8px",
        fontSize: "10px",
        fontWeight: "500",
        border: "1px solid transparent",
        borderRadius: "4px",
        cursor: "pointer",
        background: "transparent",
        color: "#71717a",
        transition: "all 0.15s ease",
      },
      active: {
        background: "#3b82f6",
        color: "#ffffff",
        borderColor: "#3b82f6",
      },
    },

    card: {
      base: {
        background: "linear-gradient(180deg, rgba(16,16,24,0.95) 0%, rgba(10,10,14,0.98) 100%)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: "12px",
        padding: "16px",
        userSelect: "none",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
        transition: "all 0.2s ease",
        backdropFilter: "blur(8px)",
      },
    },

    badge: {
      base: {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "4px 10px",
        fontSize: "10px",
        fontWeight: "600",
        borderRadius: "4px",
        border: "1px solid",
      },
    },

    dropdown: {
      wrapper: {
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 12px",
        borderRadius: "6px",
        background: "#0f0f16",
        border: "1px solid #27272a",
        boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        cursor: "pointer",
        transition: "all 0.15s ease",
      },
      icon: {
        fontSize: "14px",
        opacity: "0.7",
      },
      text: {
        flex: "1",
        fontSize: "12px",
        fontWeight: "500",
        color: "#e4e4e7",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      },
      hint: {
        display: "block",
        fontSize: "10px",
        color: "#71717a",
        fontWeight: "500",
      },
      chevron: {
        fontSize: "12px",
        color: "#71717a",
        transition: "transform 0.15s ease",
      },
      list: {
        position: "absolute",
        left: "0",
        right: "0",
        top: "calc(100% + 4px)",
        borderRadius: "6px",
        border: "1px solid #27272a",
        background: "#0f0f16",
        boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
        display: "none",
        flexDirection: "column",
        maxHeight: "280px",
        overflowY: "auto",
        padding: "4px",
        zIndex: "1002",
      },
      option: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 10px",
        borderRadius: "4px",
        color: "#e4e4e7",
        fontSize: "11px",
        transition: "background 0.1s ease",
      },
    },
  },
};

/**
 * Apply theme styles to an element
 * @param {HTMLElement} el - Element to style
 * @param {Object} styles - Style object from theme
 */
export function applyThemeStyles(el, styles) {
  if (!el || !styles) return;
  Object.assign(el.style, styles);
}

/**
 * Create a themed button
 * @param {Document} doc - Document
 * @param {string} text - Button text
 * @param {string} variant - 'primary' or 'secondary'
 * @param {Function} onClick - Click handler
 * @returns {HTMLElement}
 */
export function createThemedButton(doc, text, variant = "primary", onClick) {
  const btn = doc.createElement("button");
  btn.textContent = text;
  
  const baseStyle = INSPECTOR_THEME.components.button.base;
  const variantStyle = INSPECTOR_THEME.components.button[variant] || INSPECTOR_THEME.components.button.primary;
  
  Object.assign(btn.style, baseStyle, variantStyle);
  
  if (onClick) btn.onclick = onClick;
  return btn;
}

/**
 * Create a themed input
 * @param {Document} doc - Document
 * @param {string} type - Input type
 * @returns {HTMLElement}
 */
export function createThemedInput(doc, type = "text") {
  const input = doc.createElement("input");
  input.type = type;
  Object.assign(input.style, INSPECTOR_THEME.components.input.base);
  return input;
}

/**
 * Create a themed label
 * @param {Document} doc - Document
 * @param {string} text - Label text
 * @returns {HTMLElement}
 */
export function createThemedLabel(doc, text) {
  const label = doc.createElement("div");
  label.textContent = text;
  Object.assign(label.style, INSPECTOR_THEME.components.label.base);
  return label;
}

/**
 * Create a themed section header
 * @param {Document} doc - Document
 * @param {string} text - Header text
 * @param {string} icon - Optional emoji icon
 * @returns {HTMLElement}
 */
export function createThemedSectionHeader(doc, text, icon = "") {
  const header = doc.createElement("div");
  header.textContent = icon ? `${icon} ${text}` : text;
  header.style.fontSize = INSPECTOR_THEME.fontSize.md;
  header.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
  header.style.color = INSPECTOR_THEME.colors.text.accent;
  header.style.marginBottom = INSPECTOR_THEME.spacing.md;
  header.style.userSelect = "none";
  return header;
}

/**
 * Create a themed tab button
 * @param {Document} doc - Document
 * @param {string} text - Tab text
 * @param {boolean} isActive - Is tab active
 * @param {Function} onClick - Click handler
 * @returns {HTMLElement}
 */
export function createThemedTab(doc, text, isActive = false, onClick) {
  const tab = doc.createElement("button");
  tab.textContent = text;
  
  const baseStyle = INSPECTOR_THEME.components.tab.base;
  const activeStyle = isActive ? INSPECTOR_THEME.components.tab.active : {};
  
  Object.assign(tab.style, baseStyle, activeStyle);
  
  if (onClick) tab.onclick = onClick;
  return tab;
}

/**
 * Create a themed badge
 * @param {Document} doc - Document
 * @param {string} text - Badge text
 * @param {string} color - Color key from theme.colors.category or theme.colors.semantic
 * @returns {HTMLElement}
 */
export function createThemedBadge(doc, text, color = "info") {
  const badge = doc.createElement("div");
  badge.textContent = text;
  
  const colorValue = INSPECTOR_THEME.colors.category[color] || 
                     INSPECTOR_THEME.colors.semantic[color] || 
                     INSPECTOR_THEME.colors.text.accent;
  
  Object.assign(badge.style, INSPECTOR_THEME.components.badge.base);
  badge.style.background = `${colorValue}25`;
  badge.style.color = colorValue;
  badge.style.borderColor = `${colorValue}50`;
  
  return badge;
}
