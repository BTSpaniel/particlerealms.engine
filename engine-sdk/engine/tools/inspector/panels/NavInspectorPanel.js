// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createNavInspectorModel } from "../NavInspector.js";
import { createPropertySection } from "../ui/InspectorControls.js";

export function initNavInspectorPanel(doc, navPanel, options = {}) {
  const getWorld =
    options && typeof options.getWorld === "function" ? options.getWorld : null;

  function clearPanel(panel) {
    while (panel.firstChild) {
      panel.removeChild(panel.firstChild);
    }
  }

  function renderNavPanel() {
    clearPanel(navPanel);
    const world = getWorld && getWorld();
    if (!world) {
      const msg = doc.createElement("div");
      msg.textContent = "No world";
      msg.style.fontSize = "11px";
      msg.style.color = "#9ca3af";
      navPanel.appendChild(msg);
      return;
    }

    const model = createNavInspectorModel(world);

    const section = createPropertySection(doc, navPanel, "Navigation Debug");

    const card = doc.createElement("div");
    card.style.background = "#0a0a0f";
    card.style.border = "1px solid #1e1e2e";
    card.style.borderRadius = "6px";
    card.style.padding = "8px 10px";
    card.style.fontSize = "11px";
    card.style.color = "#e5e7eb";
    card.style.overflowX = "auto";

    const pre = doc.createElement("pre");
    pre.textContent = JSON.stringify(model, null, 2);
    pre.style.margin = "0";
    pre.style.fontFamily = "monospace";
    pre.style.whiteSpace = "pre";

    card.appendChild(pre);
    section.appendChild(card);
  }

  return {
    renderNavPanel,
  };
}
