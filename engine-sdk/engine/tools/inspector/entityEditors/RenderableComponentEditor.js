// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { INSPECTOR_THEME } from "../ui/InspectorTheme.js";
import { bindNumberInput, bindTextInput } from "../ui/InspectorControls.js";
import { rgbToHex } from "../../../core/math/MathColor.js";

export function renderRenderableComponentEditor(doc, container, state) {
  const comp = state.pendingComponentValue || {};
  if (!Array.isArray(comp.tintColor)) {
    comp.tintColor = [1, 1, 1, 1];
  }
  if (typeof comp.layer !== "number" || !Number.isFinite(comp.layer)) {
    comp.layer = 0;
  }
  if (typeof comp.visible !== "boolean") {
    comp.visible = true;
  }
  if (typeof comp.castShadow !== "boolean") {
    comp.castShadow = true;
  }
  if (typeof comp.receiveShadow !== "boolean") {
    comp.receiveShadow = true;
  }
  state.pendingComponentValue = comp;

  function autoApply() {
    if (state && typeof state.applyPendingComponent === "function") {
      state.applyPendingComponent();
    }
  }

  // Main wrapper
  const wrapper = doc.createElement("div");
  wrapper.style.padding = INSPECTOR_THEME.spacing.md;

  // Header
  const titleRow = doc.createElement("div");
  titleRow.style.display = "flex";
  titleRow.style.alignItems = "center";
  titleRow.style.gap = INSPECTOR_THEME.spacing.sm;
  titleRow.style.marginBottom = INSPECTOR_THEME.spacing.lg;
  titleRow.style.paddingBottom = INSPECTOR_THEME.spacing.sm;
  titleRow.style.borderBottom = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;

  const titleIcon = doc.createElement("span");
  titleIcon.textContent = "🎨";
  titleIcon.style.fontSize = "16px";
  titleRow.appendChild(titleIcon);

  const title = doc.createElement("span");
  title.textContent = "Renderable";
  title.style.fontSize = INSPECTOR_THEME.fontSize.lg;
  title.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
  title.style.color = INSPECTOR_THEME.colors.text.primary;
  titleRow.appendChild(title);

  wrapper.appendChild(titleRow);

  // ===== VISIBILITY TOGGLES =====
  const visSection = doc.createElement("div");
  visSection.style.marginBottom = INSPECTOR_THEME.spacing.lg;
  
  const visHeader = doc.createElement("div");
  visHeader.style.fontSize = INSPECTOR_THEME.fontSize.sm;
  visHeader.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
  visHeader.style.color = INSPECTOR_THEME.colors.text.secondary;
  visHeader.style.textTransform = "uppercase";
  visHeader.style.letterSpacing = "0.05em";
  visHeader.style.marginBottom = INSPECTOR_THEME.spacing.sm;
  visHeader.textContent = "👁️ Visibility";
  visSection.appendChild(visHeader);

  const toggleGrid = doc.createElement("div");
  toggleGrid.style.display = "grid";
  toggleGrid.style.gridTemplateColumns = "1fr 1fr 1fr";
  toggleGrid.style.gap = INSPECTOR_THEME.spacing.sm;

  function createToggle(label, icon, getValue, setValue) {
    const btn = doc.createElement("button");
    btn.style.display = "flex";
    btn.style.flexDirection = "column";
    btn.style.alignItems = "center";
    btn.style.gap = INSPECTOR_THEME.spacing.xs;
    btn.style.padding = INSPECTOR_THEME.spacing.sm;
    btn.style.border = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;
    btn.style.borderRadius = INSPECTOR_THEME.radius.sm;
    btn.style.cursor = "pointer";
    btn.style.transition = "all 0.15s";
    btn.style.fontSize = "18px";

    function updateStyle() {
      if (getValue()) {
        btn.style.background = INSPECTOR_THEME.colors.semantic.success + "20";
        btn.style.borderColor = INSPECTOR_THEME.colors.semantic.success;
        btn.style.color = INSPECTOR_THEME.colors.text.primary;
      } else {
        btn.style.background = INSPECTOR_THEME.colors.bg.primary;
        btn.style.borderColor = INSPECTOR_THEME.colors.border.dark;
        btn.style.color = INSPECTOR_THEME.colors.text.muted;
      }
    }

    const iconEl = doc.createElement("span");
    iconEl.textContent = icon;
    btn.appendChild(iconEl);

    const labelEl = doc.createElement("span");
    labelEl.textContent = label;
    labelEl.style.fontSize = INSPECTOR_THEME.fontSize.xs;
    labelEl.style.fontWeight = INSPECTOR_THEME.fontWeight.medium;
    btn.appendChild(labelEl);

    btn.addEventListener("click", () => {
      setValue(!getValue());
      updateStyle();
      autoApply();
    });

    updateStyle();
    return btn;
  }

  toggleGrid.appendChild(createToggle("Visible", "👁️", () => comp.visible, (v) => { comp.visible = v; }));
  toggleGrid.appendChild(createToggle("Cast", "🌑", () => comp.castShadow, (v) => { comp.castShadow = v; }));
  toggleGrid.appendChild(createToggle("Receive", "🌓", () => comp.receiveShadow, (v) => { comp.receiveShadow = v; }));

  visSection.appendChild(toggleGrid);
  wrapper.appendChild(visSection);

  // ===== COLOR SECTION with preview swatch =====
  const colorSection = doc.createElement("div");
  colorSection.style.marginBottom = INSPECTOR_THEME.spacing.lg;
  colorSection.style.padding = INSPECTOR_THEME.spacing.md;
  colorSection.style.background = INSPECTOR_THEME.colors.bg.secondary;
  colorSection.style.borderRadius = INSPECTOR_THEME.radius.md;
  colorSection.style.border = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;

  const colorHeader = doc.createElement("div");
  colorHeader.style.fontSize = INSPECTOR_THEME.fontSize.sm;
  colorHeader.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
  colorHeader.style.color = INSPECTOR_THEME.colors.text.secondary;
  colorHeader.style.textTransform = "uppercase";
  colorHeader.style.letterSpacing = "0.05em";
  colorHeader.style.marginBottom = INSPECTOR_THEME.spacing.md;
  colorHeader.textContent = "🎨 Tint Color";
  colorSection.appendChild(colorHeader);

  // Color preview row
  const colorPreviewRow = doc.createElement("div");
  colorPreviewRow.style.display = "flex";
  colorPreviewRow.style.alignItems = "center";
  colorPreviewRow.style.gap = INSPECTOR_THEME.spacing.md;
  colorPreviewRow.style.marginBottom = INSPECTOR_THEME.spacing.md;

  const colorPreview = doc.createElement("div");
  colorPreview.style.width = "56px";
  colorPreview.style.height = "56px";
  colorPreview.style.borderRadius = INSPECTOR_THEME.radius.lg;
  colorPreview.style.border = `2px solid ${INSPECTOR_THEME.colors.border.medium}`;
  colorPreview.style.boxShadow = INSPECTOR_THEME.shadow.md;
  colorPreview.style.flexShrink = "0";

  const hexValue = doc.createElement("div");
  hexValue.style.fontSize = INSPECTOR_THEME.fontSize.xl;
  hexValue.style.fontFamily = "monospace";
  hexValue.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
  hexValue.style.color = INSPECTOR_THEME.colors.text.primary;

  function updateColorPreview() {
    const r = Math.round(Math.min(1, Math.max(0, comp.tintColor[0])) * 255);
    const g = Math.round(Math.min(1, Math.max(0, comp.tintColor[1])) * 255);
    const b = Math.round(Math.min(1, Math.max(0, comp.tintColor[2])) * 255);
    const a = Math.min(1, Math.max(0, comp.tintColor[3]));
    colorPreview.style.background = `rgba(${r}, ${g}, ${b}, ${a})`;
    hexValue.textContent = rgbToHex(comp.tintColor).toUpperCase();
  }

  const colorInfo = doc.createElement("div");
  colorInfo.style.flex = "1";
  colorInfo.appendChild(hexValue);

  const rgbLabel = doc.createElement("div");
  rgbLabel.style.fontSize = INSPECTOR_THEME.fontSize.sm;
  rgbLabel.style.color = INSPECTOR_THEME.colors.text.muted;
  rgbLabel.textContent = "RGBA Color";
  colorInfo.appendChild(rgbLabel);

  colorPreviewRow.appendChild(colorPreview);
  colorPreviewRow.appendChild(colorInfo);
  colorSection.appendChild(colorPreviewRow);

  // RGB sliders
  const colorSliders = doc.createElement("div");
  colorSliders.style.display = "flex";
  colorSliders.style.flexDirection = "column";
  colorSliders.style.gap = INSPECTOR_THEME.spacing.sm;

  function createColorSlider(label, index, accent) {
    const row = doc.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = INSPECTOR_THEME.spacing.md;

    const labelEl = doc.createElement("span");
    labelEl.textContent = label;
    labelEl.style.width = "16px";
    labelEl.style.fontSize = INSPECTOR_THEME.fontSize.md;
    labelEl.style.fontWeight = INSPECTOR_THEME.fontWeight.bold;
    labelEl.style.color = accent;
    row.appendChild(labelEl);

    const slider = doc.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.01";
    slider.value = String(comp.tintColor[index]);
    slider.style.flex = "1";
    slider.style.accentColor = accent;
    slider.style.cursor = "pointer";
    slider.oninput = () => {
      comp.tintColor[index] = parseFloat(slider.value);
      valueEl.textContent = Math.round(comp.tintColor[index] * 255);
      updateColorPreview();
      autoApply();
    };
    row.appendChild(slider);

    const valueEl = doc.createElement("span");
    valueEl.textContent = Math.round(comp.tintColor[index] * 255);
    valueEl.style.width = "32px";
    valueEl.style.textAlign = "right";
    valueEl.style.fontSize = INSPECTOR_THEME.fontSize.md;
    valueEl.style.fontFamily = "monospace";
    valueEl.style.color = INSPECTOR_THEME.colors.text.primary;
    row.appendChild(valueEl);

    return row;
  }

  colorSliders.appendChild(createColorSlider("R", 0, "#ef4444"));
  colorSliders.appendChild(createColorSlider("G", 1, "#22c55e"));
  colorSliders.appendChild(createColorSlider("B", 2, "#3b82f6"));
  colorSliders.appendChild(createColorSlider("A", 3, "#a855f7"));
  colorSection.appendChild(colorSliders);

  updateColorPreview();
  wrapper.appendChild(colorSection);

  // ===== LAYER SECTION =====
  const layerSection = doc.createElement("div");
  layerSection.style.marginBottom = INSPECTOR_THEME.spacing.md;

  const layerHeader = doc.createElement("div");
  layerHeader.style.fontSize = INSPECTOR_THEME.fontSize.sm;
  layerHeader.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
  layerHeader.style.color = INSPECTOR_THEME.colors.text.secondary;
  layerHeader.style.textTransform = "uppercase";
  layerHeader.style.letterSpacing = "0.05em";
  layerHeader.style.marginBottom = INSPECTOR_THEME.spacing.sm;
  layerHeader.textContent = "📚 Layer";
  layerSection.appendChild(layerHeader);

  const layerRow = doc.createElement("div");
  layerRow.style.display = "flex";
  layerRow.style.gap = INSPECTOR_THEME.spacing.sm;

  const layerInput = doc.createElement("input");
  layerInput.type = "number";
  layerInput.min = "0";
  layerInput.value = String(comp.layer);
  layerInput.style.flex = "1";
  layerInput.style.padding = `${INSPECTOR_THEME.spacing.sm} ${INSPECTOR_THEME.spacing.md}`;
  layerInput.style.background = INSPECTOR_THEME.colors.bg.primary;
  layerInput.style.border = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;
  layerInput.style.borderRadius = INSPECTOR_THEME.radius.sm;
  layerInput.style.color = INSPECTOR_THEME.colors.text.primary;
  layerInput.style.fontSize = INSPECTOR_THEME.fontSize.md;
  layerInput.style.fontFamily = "monospace";

  bindNumberInput(layerInput, {
    getValue: () => Number(comp.layer) || 0,
    setValue: (v) => {
      const n = Math.max(0, Math.round(v));
      comp.layer = n;
      autoApply();
    },
    precision: 0,
    min: 0,
    commitOn: "change",
  });

  layerRow.appendChild(layerInput);
  layerSection.appendChild(layerRow);
  wrapper.appendChild(layerSection);

  // ===== MESH/MATERIAL IDS =====
  const idsSection = doc.createElement("div");

  const idsHeader = doc.createElement("div");
  idsHeader.style.fontSize = INSPECTOR_THEME.fontSize.sm;
  idsHeader.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
  idsHeader.style.color = INSPECTOR_THEME.colors.text.secondary;
  idsHeader.style.textTransform = "uppercase";
  idsHeader.style.letterSpacing = "0.05em";
  idsHeader.style.marginBottom = INSPECTOR_THEME.spacing.sm;
  idsHeader.textContent = "🔗 References";
  idsSection.appendChild(idsHeader);

  function createIdRow(label, getValue, setValue) {
    const row = doc.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = INSPECTOR_THEME.spacing.sm;
    row.style.marginBottom = INSPECTOR_THEME.spacing.sm;

    const labelEl = doc.createElement("span");
    labelEl.textContent = label;
    labelEl.style.width = "70px";
    labelEl.style.fontSize = INSPECTOR_THEME.fontSize.sm;
    labelEl.style.color = INSPECTOR_THEME.colors.text.muted;
    row.appendChild(labelEl);

    const input = doc.createElement("input");
    input.type = "text";
    input.value = getValue() || "";
    input.placeholder = "none";
    input.style.flex = "1";
    input.style.padding = `${INSPECTOR_THEME.spacing.xs} ${INSPECTOR_THEME.spacing.sm}`;
    input.style.background = INSPECTOR_THEME.colors.bg.primary;
    input.style.border = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;
    input.style.borderRadius = INSPECTOR_THEME.radius.sm;
    input.style.color = INSPECTOR_THEME.colors.text.primary;
    input.style.fontSize = INSPECTOR_THEME.fontSize.sm;
    input.style.fontFamily = "monospace";

    bindTextInput(input, {
      getValue: () => getValue() || "",
      setValue: (v) => {
        const next = String(v ?? "").trim();
        setValue(next ? next : null);
        autoApply();
      },
      commitOn: "change",
    });
    row.appendChild(input);

    return row;
  }

  idsSection.appendChild(createIdRow("Mesh", () => comp.meshId, (v) => { comp.meshId = v; }));
  idsSection.appendChild(createIdRow("Material", () => comp.materialId, (v) => { comp.materialId = v; }));
  wrapper.appendChild(idsSection);

  container.appendChild(wrapper);
}
