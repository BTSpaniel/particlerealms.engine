// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * InspectorStyles.js - Shared styles for standalone inspector panels
 * 
 * Call injectInspectorStyles() before mounting any standalone panel
 * to ensure consistent styling (scrollbars, inputs, etc.)
 */

import { INSPECTOR_THEME } from "../ui/InspectorTheme.js";

let stylesInjected = false;

/**
 * Inject shared inspector styles into the document.
 * Safe to call multiple times - will only inject once.
 * @param {Document} doc - Document to inject styles into (default: document)
 */
export function injectInspectorStyles(doc = document) {
  if (typeof doc === "undefined" || !doc.head) {
    return;
  }

  const styleId = "engine-inspector-panel-styles";
  if (doc.getElementById(styleId)) {
    return;
  }

  const style = doc.createElement("style");
  style.id = styleId;
  style.textContent = `
/* Inspector Panel Shared Styles - Matches Editor Theme */
.inspector-panel {
  scrollbar-color: #27272a transparent;
  scrollbar-width: thin;
  background: ${INSPECTOR_THEME.colors.bg.secondary};
  color: ${INSPECTOR_THEME.colors.text.primary};
  font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: ${INSPECTOR_THEME.fontSize.lg};
}

.inspector-panel::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.inspector-panel::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 4px;
}

.inspector-panel::-webkit-scrollbar-thumb {
  background: #27272a;
  border-radius: 4px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

.inspector-panel::-webkit-scrollbar-thumb:hover {
  background: #3f3f46;
  border: 2px solid transparent;
  background-clip: padding-box;
}

.inspector-panel::-webkit-scrollbar-corner {
  background: transparent;
}

.inspector-panel,
.inspector-panel * {
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
}

.inspector-panel input,
.inspector-panel textarea {
  user-select: text;
  -webkit-user-select: text;
  -moz-user-select: text;
  -ms-user-select: text;
}

.inspector-panel input[type="number"]::-webkit-outer-spin-button,
.inspector-panel input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.inspector-panel input[type="number"] {
  -moz-appearance: textfield;
}

.inspector-panel select {
  background: ${INSPECTOR_THEME.colors.bg.primary};
  color: ${INSPECTOR_THEME.colors.text.primary};
  border: 1px solid ${INSPECTOR_THEME.colors.border.dark};
  border-radius: ${INSPECTOR_THEME.radius.sm};
  padding: ${INSPECTOR_THEME.spacing.xs} ${INSPECTOR_THEME.spacing.sm};
}

.inspector-panel .inspector-number-input {
  background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0.3));
  border: 1px solid ${INSPECTOR_THEME.colors.border.light};
  border-radius: ${INSPECTOR_THEME.radius.md};
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.03);
  background-image: repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 14px);
  background-size: 14px 100%;
}

.inspector-panel .inspector-number-group {
  background-image: repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 14px);
  background-size: 14px 100%;
}

.inspector-panel .inspector-slider-value {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid ${INSPECTOR_THEME.colors.border.dark};
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04);
  min-width: 48px;
  text-align: right;
}

.inspector-panel .inspector-slider {
  -webkit-appearance: none;
  appearance: none;
  height: 8px;
  border-radius: 999px;
  background: ${INSPECTOR_THEME.colors.border.dark};
  box-shadow: inset 0 0 0 1px ${INSPECTOR_THEME.colors.border.dark};
}

.inspector-panel .inspector-slider::-webkit-slider-runnable-track {
  height: 8px;
  border-radius: 999px;
}

.inspector-panel .inspector-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--slider-accent, ${INSPECTOR_THEME.colors.semantic.info});
  border: 2px solid #0a0a0f;
  box-shadow: 0 0 0 2px rgba(59,130,246,0.25), 0 2px 6px rgba(0,0,0,0.45);
  margin-top: -4px;
}

.inspector-panel .inspector-slider::-moz-range-track {
  height: 8px;
  border-radius: 999px;
  background: ${INSPECTOR_THEME.colors.border.dark};
}

.inspector-panel .inspector-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--slider-accent, ${INSPECTOR_THEME.colors.semantic.info});
  border: 2px solid #0a0a0f;
  box-shadow: 0 0 0 2px rgba(59,130,246,0.25), 0 2px 6px rgba(0,0,0,0.45);
}

.inspector-panel .inspector-slider-ticks {
  position: relative;
  width: 100%;
  height: 10px;
}

.inspector-panel .inspector-slider-track {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 2px;
  transform: translateY(-50%);
  background: ${INSPECTOR_THEME.colors.border.light};
  opacity: 0.35;
}

.inspector-panel .inspector-slider-tick {
  position: absolute;
  width: 2px;
  height: 10px;
  background: var(--slider-accent, ${INSPECTOR_THEME.colors.semantic.info});
  opacity: 0.75;
  transform: translateX(-1px);
}

.inspector-panel button {
  cursor: pointer;
}

/* Entity highlight pulse animation */
@keyframes entityPulse {
  0%, 100% {
    box-shadow: 0 0 8px rgba(59, 130, 246, 0.4), inset 0 0 12px rgba(59, 130, 246, 0.15);
  }
  50% {
    box-shadow: 0 0 16px rgba(59, 130, 246, 0.6), inset 0 0 20px rgba(59, 130, 246, 0.25);
  }
}

@keyframes entityGlow {
  0%, 100% {
    filter: brightness(1) drop-shadow(0 0 4px rgba(59, 130, 246, 0.5));
  }
  50% {
    filter: brightness(1.2) drop-shadow(0 0 12px rgba(59, 130, 246, 0.8));
  }
}
`;

  doc.head.appendChild(style);
  stylesInjected = true;
}

/**
 * Apply standard inspector panel container styles to a DOM element.
 * @param {HTMLElement} container - Element to style
 */
export function applyPanelContainerStyles(container) {
  if (!container) return;
  
  container.classList.add("inspector-panel");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.height = "100%";
  container.style.overflow = "hidden";
  container.style.background = INSPECTOR_THEME.colors.bg.secondary;
  container.style.color = INSPECTOR_THEME.colors.text.primary;
  container.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  container.style.fontSize = INSPECTOR_THEME.fontSize.lg;
}

/**
 * Check if inspector styles have been injected
 */
export function areStylesInjected() {
  return stylesInjected;
}
