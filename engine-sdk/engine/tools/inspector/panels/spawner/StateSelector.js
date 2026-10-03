// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * State of Matter display component (Gas, Liquid, Solid, Plasma)
 * Read-only - shows the current state without allowing changes
 */
import { STATES } from "../../../../sim/particles/ParticleEmitterSystem.js";

const STATE_ICONS = { gas: "💨", liquid: "💧", solid: "🧊", plasma: "⚡" };
const STATE_COLORS = { 
  gas: "#6b7280",      // gray
  liquid: "#3b82f6",   // blue  
  solid: "#22c55e",    // green
  plasma: "#a855f7"    // purple
};

export function createStateSelector(doc, { state }) {
  const container = doc.createElement("div");
  container.style.marginBottom = "12px";

  const label = doc.createElement("div");
  label.textContent = "State of Matter";
  label.style.fontSize = "10px";
  label.style.color = "#9ca3af";
  label.style.marginBottom = "6px";
  label.style.userSelect = "none";
  container.appendChild(label);

  let currentState = state;

  // Single badge showing the current state
  const badge = doc.createElement("div");
  badge.style.display = "inline-flex";
  badge.style.alignItems = "center";
  badge.style.gap = "6px";
  badge.style.padding = "6px 12px";
  badge.style.fontSize = "12px";
  badge.style.fontWeight = "600";
  badge.style.borderRadius = "6px";
  badge.style.border = "1px solid";
  badge.style.userSelect = "none";

  function updateBadge() {
    const stateDef = STATES[currentState] || STATES.gas;
    const icon = STATE_ICONS[currentState] || "💨";
    const color = STATE_COLORS[currentState] || "#6b7280";
    
    badge.textContent = `${icon} ${stateDef.label}`;
    badge.style.background = `${color}20`;  // 20% opacity
    badge.style.color = color;
    badge.style.borderColor = `${color}60`; // 60% opacity
  }

  updateBadge();
  container.appendChild(badge);

  return {
    element: container,
    getState: () => currentState,
    setState: (s) => {
      currentState = s;
      updateBadge();
    },
  };
}

export { STATE_ICONS };
