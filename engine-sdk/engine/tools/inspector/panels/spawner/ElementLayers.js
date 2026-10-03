// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Element layers component with checkboxes, sliders, and drag-to-reorder
 */
import { ELEMENTS, deriveColorFromElements } from "../../../../sim/particles/ParticleEmitterSystem.js";

const ELEMENT_ICONS = { fire: "🔥", water: "💧", magic: "✨", smoke: "💨" };
const ELEMENT_COLORS = { fire: "#f97316", water: "#3b82f6", magic: "#a855f7", smoke: "#6b7280" };

export function createElementLayers(doc, { elements, onChange }) {
  const container = doc.createElement("div");
  container.style.marginBottom = "12px";

  const label = doc.createElement("div");
  label.textContent = "Elements (drag ≡ to reorder)";
  label.style.fontSize = "10px";
  label.style.color = "#9ca3af";
  label.style.marginBottom = "6px";
  container.appendChild(label);

  const list = doc.createElement("div");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "4px";
  container.appendChild(list);

  // Color preview
  const previewRow = doc.createElement("div");
  previewRow.style.display = "flex";
  previewRow.style.alignItems = "center";
  previewRow.style.gap = "8px";
  previewRow.style.marginTop = "8px";

  const previewLabel = doc.createElement("span");
  previewLabel.textContent = "Color:";
  previewLabel.style.color = "#9ca3af";
  previewLabel.style.fontSize = "10px";
  previewRow.appendChild(previewLabel);

  const colorSwatch = doc.createElement("div");
  colorSwatch.style.width = "60px";
  colorSwatch.style.height = "20px";
  colorSwatch.style.borderRadius = "3px";
  colorSwatch.style.border = "1px solid #334155";
  previewRow.appendChild(colorSwatch);

  container.appendChild(previewRow);

  function updateColorPreview() {
    const active = elements.filter(e => e.enabled && e.power > 0);
    const derived = deriveColorFromElements(active);
    const r = Math.round(derived.color[0] * 255);
    const g = Math.round(derived.color[1] * 255);
    const b = Math.round(derived.color[2] * 255);
    colorSwatch.style.background = `rgb(${r}, ${g}, ${b})`;
    if (onChange) onChange(derived);
  }

  function renderRows() {
    while (list.firstChild) list.removeChild(list.firstChild);

    for (let i = 0; i < elements.length; i++) {
      const elem = elements[i];
      const elemDef = ELEMENTS[elem.id];
      if (!elemDef) continue;

      const row = doc.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "6px";
      row.style.padding = "4px 6px";
      row.style.background = "#0a0a0f";
      row.style.borderRadius = "3px";

      // Drag handle
      const handle = doc.createElement("span");
      handle.textContent = "≡";
      handle.style.color = "#52525b";
      handle.style.cursor = "grab";
      handle.style.userSelect = "none";
      handle.draggable = true;
      handle.ondragstart = (e) => {
        e.dataTransfer.setData("text/plain", i.toString());
        row.style.opacity = "0.5";
      };
      handle.ondragend = () => { row.style.opacity = "1"; };
      row.appendChild(handle);

      // Checkbox
      const checkbox = doc.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = elem.enabled;
      checkbox.onchange = () => {
        elem.enabled = checkbox.checked;
        labelSpan.style.color = elem.enabled ? ELEMENT_COLORS[elem.id] : "#52525b";
        updateColorPreview();
      };
      checkbox.onmousedown = (e) => e.stopPropagation();
      row.appendChild(checkbox);

      // Label
      const labelSpan = doc.createElement("span");
      labelSpan.textContent = `${ELEMENT_ICONS[elem.id] || ""} ${elemDef.label}`;
      labelSpan.style.flex = "1";
      labelSpan.style.color = elem.enabled ? ELEMENT_COLORS[elem.id] : "#4b5563";
      labelSpan.style.fontSize = "11px";
      row.appendChild(labelSpan);

      // Slider
      const slider = doc.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "1";
      slider.step = "0.05";
      slider.value = elem.power;
      slider.style.width = "60px";
      slider.style.accentColor = ELEMENT_COLORS[elem.id];
      slider.oninput = () => {
        elem.power = parseFloat(slider.value);
        powerDisplay.textContent = elem.power.toFixed(2);
        updateColorPreview();
      };
      slider.onmousedown = (e) => e.stopPropagation();
      slider.ontouchstart = (e) => e.stopPropagation();
      row.appendChild(slider);

      // Power display
      const powerDisplay = doc.createElement("span");
      powerDisplay.textContent = elem.power.toFixed(2);
      powerDisplay.style.color = "#e5e7eb";
      powerDisplay.style.fontSize = "10px";
      powerDisplay.style.fontFamily = "monospace";
      powerDisplay.style.width = "32px";
      powerDisplay.style.textAlign = "right";
      row.appendChild(powerDisplay);

      // Drop events
      row.ondragover = (e) => {
        e.preventDefault();
        row.style.borderTop = "2px solid #3b82f6";
      };
      row.ondragleave = () => { row.style.borderTop = "none"; };
      row.ondrop = (e) => {
        e.preventDefault();
        row.style.borderTop = "none";
        const fromIdx = parseInt(e.dataTransfer.getData("text/plain"));
        if (fromIdx !== i) {
          const moved = elements.splice(fromIdx, 1)[0];
          elements.splice(i, 0, moved);
          renderRows();
          updateColorPreview();
        }
      };

      list.appendChild(row);
    }
  }

  renderRows();
  updateColorPreview();

  return {
    element: container,
    refresh: renderRows,
    updateColor: updateColorPreview,
  };
}

export { ELEMENT_ICONS, ELEMENT_COLORS };
