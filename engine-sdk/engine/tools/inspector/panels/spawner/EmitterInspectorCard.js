// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * EmitterInspectorCard.js - Shared emitter property card component
 * 
 * Modular emitter editor used by both Spawner and Entities inspector panels.
 * Configurable sections: header, elements, physics, aim.
 */

import { STATES, ELEMENTS, getPresetList, applyPreset } from "../../../../sim/particles/ParticleEmitterSystem.js";
import { createPhysicsProps, createMatterProps } from "./PhysicsProps.js";
import { createGyroAimControl } from "./GyroAimControl.js";
import { INSPECTOR_THEME } from "../../ui/InspectorTheme.js";
import { byteRgbToHex, hexToRgb as mathHexToRgb } from "../../../../core/math/MathColor.js";
import { REGISTRY_ELEMENTS, ELEMENT_ALIASES, elementMixToEmitterConfig, metaSlidersToPhysics, elementMixToSpellParams } from "../../../../sim/particles/ParticleElementRegistry.js";

// Icons and colors for states and elements
export const STATE_ICONS = { gas: "💨", liquid: "💧", solid: "🧊", plasma: "⚡" };
export const STATE_COLORS = { gas: "#6b7280", liquid: "#3b82f6", solid: "#22c55e", plasma: "#a855f7" };
export const ELEMENT_ICONS = { fire: "🔥", water: "💧", magic: "✨", smoke: "💨" };
export const ELEMENT_COLORS = { fire: "#f97316", water: "#3b82f6", magic: "#a855f7", smoke: "#6b7280" };

/**
 * Create a modular emitter inspector card.
 * 
 * @param {Document} doc - The document to create elements in
 * @param {Object} options - Configuration options
 * @param {Object} options.emitterCfg - Emitter config object with properties to edit
 * @param {Object} [options.props] - Optional spawner props for color sync (has .color array)
 * @param {Object} [options.sections] - Which sections to show (default all true)
 * @param {boolean} [options.sections.header=true] - Show state badge + color preview
 * @param {boolean} [options.sections.elements=true] - Show element toggles with power sliders
 * @param {boolean} [options.sections.physics=true] - Show physics property grid
 * @param {boolean} [options.sections.aim=false] - Show aim controls (requires setGhostOffset)
 * @param {Function} [options.setGhostOffset] - Ghost offset setter for aim controls
 * @param {Function} [options.onColorChange] - Callback when derived color changes
 * @returns {{ element: HTMLElement, refresh: Function }}
 */
export function createEmitterInspectorCard(doc, options = {}) {
  const { emitterCfg, props, setGhostOffset, onColorChange, onCreateSpell } = options;
  
  // Section visibility defaults
  const sections = {
    header: true,
    elements: true,
    physics: true,
    matter: true,
    aim: false,
    ...options.sections,
  };

  if (!emitterCfg) {
    const empty = doc.createElement("div");
    empty.textContent = "No emitter configuration available.";
    empty.style.fontSize = INSPECTOR_THEME.fontSize.md;
    empty.style.color = INSPECTOR_THEME.colors.text.secondary;
    empty.style.padding = INSPECTOR_THEME.spacing.lg;
    return { element: empty, refresh: () => {} };
  }

  // Ensure elements array exists
  if (!emitterCfg.elements) {
    emitterCfg.elements = [
      { id: "fire", enabled: false, power: 0.0 },
      { id: "smoke", enabled: false, power: 0.0 },
      { id: "water", enabled: false, power: 0.0 },
      { id: "magic", enabled: false, power: 0.0 },
    ];
  }
  if (!emitterCfg.state) {
    emitterCfg.state = "gas";
  }
  if (typeof emitterCfg.useAimDirection !== "boolean") {
    emitterCfg.useAimDirection = true;
  }

  // Root card container
  const card = doc.createElement("div");
  Object.assign(card.style, INSPECTOR_THEME.components.card.base);

  let colorPreview = null;
  let colorEndPreview = null;
  let colorStartInput = null;
  let colorEndInput = null;
  let colorModeLabel = null;
  let opacitySlider = null;
  let opacityDisplay = null;
  let resetLink = null;

  // Ensure color fields exist
  if (typeof emitterCfg._colorOverride !== "boolean") emitterCfg._colorOverride = false;
  if (typeof emitterCfg.opacity !== "number") emitterCfg.opacity = 1.0;

  function vec3ToHex(c) {
    return byteRgbToHex((c[0] ?? 1) * 255, (c[1] ?? 1) * 255, (c[2] ?? 1) * 255);
  }
  function hexToVec3(hex) {
    if (/^#?[a-f\d]{6}$/i.test(hex)) return mathHexToRgb(hex);
    return [
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255,
    ];
  }

  // === COLOR PREVIEW (UI swatch + adapter sync) ===
  // This function reads emitterCfg.color and updates the UI swatches + syncs to the adapter.
  // IMPORTANT: It does NOT derive color from elements — that's done by syncElementsFromGrid()
  // via elementMixToEmitterConfig() in ParticleElementRegistry.js. This function only READS
  // the already-derived values. Previously it used legacy derive functions that didn't understand
  // element combinations, causing water+ice to show fire colors. (Bug fix Feb 2026)
  //
  // Color pipeline: UI element grid → syncElementsFromGrid → elementMixToEmitterConfig
  //   → emitterCfg.color → updateColorPreview → adapter.color → emit.color (in engine)
  //   → stepEmitters: singleMeta[0..2] = emitterColor → GPU metaBuffer
  //   → SDF shader: uMeta[ii].xyz → input.color → volumetric lit output
  //   → half-res texture → ParticleHalfResComposite → scene
  function updateColorPreview() {
    let startColor, endColor;

    if (emitterCfg._colorOverride && emitterCfg.color) {
      startColor = emitterCfg.color;
      endColor = emitterCfg.colorEnd || emitterCfg.color;
      console.log(`[TRACE updateColorPreview] CUSTOM mode: color=[${startColor}]`);
    } else {
      // Use the values already on emitterCfg — these were set by syncElementsFromGrid
      // via elementMixToEmitterConfig (which handles combos, byproducts, etc.).
      // Do NOT re-derive with legacy functions — they don't know about combos/registry.
      startColor = emitterCfg.color || [1, 1, 1];
      endColor = emitterCfg.colorEnd || startColor;
      console.log(`[TRACE updateColorPreview] FROM ELEMENTS: color=[${startColor}] temp=${emitterCfg.temperature}K matIdx=${emitterCfg.materialIndex}`);
    }

    // Update start color swatch
    if (colorPreview) {
      const r = Math.round(startColor[0] * 255);
      const g = Math.round(startColor[1] * 255);
      const b = Math.round(startColor[2] * 255);
      colorPreview.style.background = `rgb(${r}, ${g}, ${b})`;
    }
    // Update end color swatch
    if (colorEndPreview) {
      const r = Math.round(endColor[0] * 255);
      const g = Math.round(endColor[1] * 255);
      const b = Math.round(endColor[2] * 255);
      colorEndPreview.style.background = `rgb(${r}, ${g}, ${b})`;
    }
    // Sync hidden color inputs
    if (colorStartInput) colorStartInput.value = vec3ToHex(startColor);
    if (colorEndInput) colorEndInput.value = vec3ToHex(endColor);

    // Mode label + reset link visibility
    if (colorModeLabel) {
      colorModeLabel.textContent = emitterCfg._colorOverride ? "custom" : "from elements";
      colorModeLabel.style.color = emitterCfg._colorOverride ? "#f59e0b" : "rgba(255,255,255,0.3)";
    }
    if (resetLink) {
      resetLink.style.display = emitterCfg._colorOverride ? "inline" : "none";
    }

    // Sync to props if provided
    if (props && Array.isArray(props.color) && props.color.length >= 3) {
      props.color[0] = startColor[0];
      props.color[1] = startColor[1];
      props.color[2] = startColor[2];
    }

    if (typeof onColorChange === "function") {
      onColorChange(startColor);
    }
  }

  // ============ PRESET SELECTOR ============
  const presetSection = doc.createElement("div");
  presetSection.style.marginBottom = INSPECTOR_THEME.spacing.lg;
  presetSection.style.paddingBottom = INSPECTOR_THEME.spacing.md;
  presetSection.style.borderBottom = `1px solid ${INSPECTOR_THEME.colors.border.light}`;

  const presetRow = doc.createElement("div");
  presetRow.style.display = "flex";
  presetRow.style.alignItems = "center";
  presetRow.style.gap = INSPECTOR_THEME.spacing.md;

  const presetLabel = doc.createElement("span");
  presetLabel.textContent = "Preset";
  presetLabel.style.fontSize = INSPECTOR_THEME.fontSize.sm;
  presetLabel.style.fontWeight = "700";
  presetLabel.style.color = "#64748b";
  presetLabel.style.letterSpacing = "0.05em";
  presetLabel.style.textTransform = "uppercase";
  presetLabel.style.minWidth = "50px";
  presetLabel.style.userSelect = "none";
  presetRow.appendChild(presetLabel);

  const presetSelect = doc.createElement("select");
  presetSelect.style.flex = "1";
  presetSelect.style.background = INSPECTOR_THEME.colors.bg.primary;
  presetSelect.style.color = INSPECTOR_THEME.colors.text.primary;
  presetSelect.style.border = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;
  presetSelect.style.borderRadius = INSPECTOR_THEME.radius.sm;
  presetSelect.style.padding = `${INSPECTOR_THEME.spacing.sm} ${INSPECTOR_THEME.spacing.md}`;
  presetSelect.style.fontSize = INSPECTOR_THEME.fontSize.md;
  presetSelect.style.cursor = "pointer";
  presetSelect.style.outline = "none";

  const groups = getPresetList();
  for (const group of groups) {
    const optgroup = doc.createElement("optgroup");
    optgroup.label = group.category;
    for (const p of group.presets) {
      const opt = doc.createElement("option");
      opt.value = p.key;
      opt.textContent = `${p.icon} ${p.label}`;
      presetSelect.appendChild(opt);
    }
    presetSelect.appendChild(optgroup);
  }

  // Set current preset value
  presetSelect.value = emitterCfg._activePreset || "custom";

  presetSelect.onchange = () => {
    const key = presetSelect.value;
    applyPreset(emitterCfg, key);
    // Reset color override so new preset's element colors take effect
    emitterCfg._colorOverride = false;
    refresh();
  };

  presetRow.appendChild(presetSelect);
  presetSection.appendChild(presetRow);
  card.appendChild(presetSection);

  // ============ SIMPLE/ADVANCED TOGGLE ============
  // Read initial mode from options or default to 'simple'
  let inspectorMode = options.inspectorMode || "simple";
  const simpleModeContainer = doc.createElement("div");
  const advancedModeContainer = doc.createElement("div");

  function setInspectorMode(mode) {
    inspectorMode = mode;
    simpleModeContainer.style.display = mode === "simple" ? "block" : "none";
    advancedModeContainer.style.display = mode === "advanced" ? "block" : "none";
    modeToggleBtn.textContent = mode === "simple" ? "🔧 Show Advanced" : "🎯 Show Simple";
    modeToggleBtn.title = mode === "simple"
      ? "Switch to advanced mode with full control over every parameter"
      : "Switch to simple mode with easy presets and element mixing";
    // Persist via callback if provided
    if (typeof options.onModeChange === "function") {
      options.onModeChange(mode);
    }
  }

  const modeToggleRow = doc.createElement("div");
  modeToggleRow.style.cssText = `
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 16px; padding-bottom: 12px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  `;

  const modeToggleBtn = doc.createElement("button");
  modeToggleBtn.style.cssText = `
    padding: 6px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.04); color: #94a3b8; font-size: 12px; font-weight: 600;
    cursor: pointer; transition: all 0.2s ease; user-select: none;
  `;
  modeToggleBtn.onmouseenter = () => { modeToggleBtn.style.background = "rgba(59,130,246,0.15)"; modeToggleBtn.style.borderColor = "#3b82f6"; modeToggleBtn.style.color = "#3b82f6"; };
  modeToggleBtn.onmouseleave = () => { modeToggleBtn.style.background = "rgba(255,255,255,0.04)"; modeToggleBtn.style.borderColor = "rgba(255,255,255,0.12)"; modeToggleBtn.style.color = "#94a3b8"; };
  modeToggleBtn.onclick = () => {
    setInspectorMode(inspectorMode === "simple" ? "advanced" : "simple");
  };
  modeToggleRow.appendChild(modeToggleBtn);
  card.appendChild(modeToggleRow);

  // ============ SIMPLE MODE ============
  {
    const REGISTRY_ELEMENT_LIST = Object.values(REGISTRY_ELEMENTS);

    // Element grid: 2-column grid of element cards with power dots
    const gridSection = doc.createElement("div");
    gridSection.style.marginBottom = "16px";

    const gridLabel = doc.createElement("div");
    gridLabel.textContent = "ELEMENT MIX";
    gridLabel.style.cssText = `
      font-size: 10px; font-weight: 700; color: #64748b; letter-spacing: 0.08em;
      text-transform: uppercase; margin-bottom: 10px; user-select: none;
    `;
    gridSection.appendChild(gridLabel);

    const grid = doc.createElement("div");
    grid.style.cssText = `
      display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
    `;

    const elementCards = new Map();

    function syncElementsFromGrid() {
      // Build elements array from grid state (primary elements only)
      const newElements = [];
      for (const [elemId, cardState] of elementCards) {
        newElements.push({
          id: elemId === "arcane" ? "magic" : elemId,
          enabled: cardState.power > 0,
          power: cardState.power,
        });
      }

      // Derive config from element mix using unified registry
      const registryElements = newElements.map(e => ({
        id: ELEMENT_ALIASES[e.id] || e.id,
        power: e.power,
        enabled: e.enabled,
      }));
      const derived = elementMixToEmitterConfig(registryElements);

      // Build final elements: primary + auto-byproducts (e.g., fire → smoke trail)
      const finalElements = newElements.filter(e => e.power > 0 || e.enabled);
      if (derived.byproducts) {
        for (const bp of derived.byproducts) {
          finalElements.push({
            id: bp.id,       // e.g., "smoke", "steam"
            enabled: true,
            power: bp.power,
            _autoByproduct: true,  // Flag so Advanced Mode knows this was auto-generated
          });
        }
      }
      emitterCfg.elements = finalElements;

      // Apply derived values to emitter
      if (!emitterCfg._colorOverride) {
        emitterCfg.color = derived.color;
        emitterCfg.colorEnd = derived.colorEnd;
        emitterCfg.temperature = derived.temperature;
        emitterCfg.materialIndex = derived.materialIndex;
      }

      // Pipeline trace: UI → emitterCfg
      console.log(
        `[EmitterCard] syncElements:`,
        `primary=[${finalElements.filter(e=>!e._autoByproduct).map(e=>`${e.id}(${e.power.toFixed(2)})`).join(',')}]`,
        `byproducts=[${(derived.byproducts||[]).map(b=>`${b.id}(${b.power.toFixed(2)}) from ${b.source}`).join(',')}]`,
        `→ matIdx=${derived.materialIndex}`,
        `temp=${derived.temperature}K`,
        `combo=${derived.combinationName || 'none'}`,
        `color=[${derived.color.map(c=>c.toFixed(2)).join(',')}]`
      );

      updateColorPreview();
      updateCombinationPreview(registryElements, derived);
    }

    function createElementCard(elemDef) {
      const elemId = elemDef.id;
      // Find initial power from existing emitterCfg.elements
      const existing = (emitterCfg.elements || []).find(
        e => e.id === elemId || ELEMENT_ALIASES[e.id] === elemId || e.id === (elemId === "arcane" ? "magic" : elemId)
      );
      let power = existing ? (existing.power || 0) : 0;

      const cardEl = doc.createElement("div");
      cardEl.style.cssText = `
        display: flex; align-items: center; gap: 6px; padding: 8px 10px;
        background: ${power > 0 ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.2)"};
        border: 1px solid ${power > 0 ? `rgba(${Math.round(elemDef.color[0]*255)},${Math.round(elemDef.color[1]*255)},${Math.round(elemDef.color[2]*255)},0.3)` : "rgba(255,255,255,0.04)"};
        border-radius: 8px; cursor: pointer; transition: all 0.2s ease; user-select: none;
      `;

      const icon = doc.createElement("span");
      icon.textContent = elemDef.icon;
      icon.style.fontSize = "14px";
      cardEl.appendChild(icon);

      const label = doc.createElement("span");
      label.textContent = elemDef.label;
      label.style.cssText = `font-size: 11px; font-weight: 600; color: ${power > 0 ? "#e2e8f0" : "#64748b"}; flex: 1;`;
      cardEl.appendChild(label);

      // Power dots (5 dots)
      const dotsContainer = doc.createElement("div");
      dotsContainer.style.cssText = "display: flex; gap: 3px;";
      const dots = [];
      const dotCount = 5;
      const colorHex = `rgb(${Math.round(elemDef.color[0]*255)},${Math.round(elemDef.color[1]*255)},${Math.round(elemDef.color[2]*255)})`;
      for (let i = 0; i < dotCount; i++) {
        const dot = doc.createElement("div");
        const filled = power > 0 && (i + 1) / dotCount <= power + 0.01;
        dot.style.cssText = `
          width: 8px; height: 8px; border-radius: 50%;
          background: ${filled ? colorHex : "rgba(255,255,255,0.08)"};
          border: 1px solid ${filled ? colorHex : "rgba(255,255,255,0.12)"};
          transition: all 0.15s ease; cursor: pointer;
        `;
        dot.onclick = (e) => {
          e.stopPropagation();
          const clickedPower = (i + 1) / dotCount;
          // Toggle: if clicking the same dot level, turn off
          if (Math.abs(state.power - clickedPower) < 0.01) {
            state.power = 0;
          } else {
            state.power = clickedPower;
          }
          updateCardVisuals();
          syncElementsFromGrid();
        };
        dots.push(dot);
        dotsContainer.appendChild(dot);
      }
      cardEl.appendChild(dotsContainer);

      // Click on card body = toggle on/off (0.6 default or 0)
      cardEl.onclick = () => {
        state.power = state.power > 0 ? 0 : 0.6;
        updateCardVisuals();
        syncElementsFromGrid();
      };

      const state = { power };

      function updateCardVisuals() {
        const p = state.power;
        const active = p > 0;
        cardEl.style.background = active ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.2)";
        cardEl.style.borderColor = active
          ? `rgba(${Math.round(elemDef.color[0]*255)},${Math.round(elemDef.color[1]*255)},${Math.round(elemDef.color[2]*255)},0.3)`
          : "rgba(255,255,255,0.04)";
        label.style.color = active ? "#e2e8f0" : "#64748b";
        for (let i = 0; i < dotCount; i++) {
          const filled = active && (i + 1) / dotCount <= p + 0.01;
          dots[i].style.background = filled ? colorHex : "rgba(255,255,255,0.08)";
          dots[i].style.borderColor = filled ? colorHex : "rgba(255,255,255,0.12)";
        }
      }

      elementCards.set(elemId, state);
      return cardEl;
    }

    for (const elemDef of REGISTRY_ELEMENT_LIST) {
      grid.appendChild(createElementCard(elemDef));
    }
    gridSection.appendChild(grid);
    simpleModeContainer.appendChild(gridSection);

    // Combination preview
    const comboPreview = doc.createElement("div");
    comboPreview.style.cssText = `
      padding: 10px 12px; background: rgba(255,255,255,0.02); border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.04); margin-bottom: 16px;
      font-size: 12px; color: #94a3b8; min-height: 40px;
      display: flex; flex-direction: column; gap: 6px;
    `;
    const comboTitle = doc.createElement("div");
    comboTitle.style.cssText = "font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;";
    comboTitle.textContent = "RESULT";
    comboPreview.appendChild(comboTitle);

    const comboBody = doc.createElement("div");
    comboBody.style.cssText = "display: flex; align-items: center; gap: 8px; flex-wrap: wrap;";
    comboPreview.appendChild(comboBody);

    const comboAutoTags = doc.createElement("div");
    comboAutoTags.style.cssText = "display: flex; gap: 4px; flex-wrap: wrap;";
    comboPreview.appendChild(comboAutoTags);

    function updateCombinationPreview(registryElements, derived) {
      const active = registryElements.filter(e => e.power > 0);
      comboBody.innerHTML = "";
      comboAutoTags.innerHTML = "";

      if (active.length === 0) {
        comboBody.textContent = "Select elements to mix";
        return;
      }

      // Show active element icons
      const elemText = active.map(e => {
        const def = REGISTRY_ELEMENTS[e.id];
        return def ? `${def.icon} ${def.label}` : e.id;
      }).join(" + ");

      if (derived.combinationName) {
        comboBody.innerHTML = `<span style="font-weight:600;color:#e2e8f0;">${elemText}</span> <span style="color:#3b82f6;font-weight:700;">→ ${derived.combinationName}</span>`;
      } else {
        comboBody.innerHTML = `<span style="font-weight:600;color:#e2e8f0;">${elemText}</span>`;
      }

      // Color swatches
      const startSwatch = doc.createElement("div");
      const r = Math.round(derived.color[0] * 255), g = Math.round(derived.color[1] * 255), b = Math.round(derived.color[2] * 255);
      startSwatch.style.cssText = `width: 16px; height: 16px; border-radius: 4px; background: rgb(${r},${g},${b}); border: 1px solid rgba(255,255,255,0.15);`;
      comboBody.appendChild(startSwatch);

      const endSwatch = doc.createElement("div");
      const r2 = Math.round(derived.colorEnd[0] * 255), g2 = Math.round(derived.colorEnd[1] * 255), b2 = Math.round(derived.colorEnd[2] * 255);
      endSwatch.style.cssText = `width: 16px; height: 16px; border-radius: 4px; background: rgb(${r2},${g2},${b2}); border: 1px solid rgba(255,255,255,0.15);`;
      comboBody.appendChild(endSwatch);

      const tempBadge = doc.createElement("span");
      tempBadge.textContent = `${derived.temperature}K`;
      tempBadge.style.cssText = `font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; background: rgba(239,68,68,0.15); color: #ef4444;`;
      comboBody.appendChild(tempBadge);

      // Auto-derived physics badges
      if (derived.temperature >= 5000) addTag("Plasma", "#a855f7");
      else if (derived.temperature >= 373) addTag("Gas", "#6b7280");
      else if (derived.temperature >= 273) addTag("Liquid", "#3b82f6");
      else addTag("Solid", "#22c55e");

      if (derived.temperature >= 800) addTag("Blackbody", "#ef4444");

      // Show auto-byproducts (smoke from fire, steam from fire+water, etc.)
      if (derived.byproducts && derived.byproducts.length > 0) {
        for (const bp of derived.byproducts) {
          const bpR = Math.round(bp.color[0] * 255), bpG = Math.round(bp.color[1] * 255), bpB = Math.round(bp.color[2] * 255);
          addTag(`${bp.icon} ${bp.label}`, `rgb(${bpR},${bpG},${bpB})`);
        }
        // Add byproduct explanation row
        const bpDesc = doc.createElement("div");
        bpDesc.style.cssText = "font-size: 9px; color: rgba(255,255,255,0.35); font-style: italic; width: 100%; margin-top: 2px;";
        bpDesc.textContent = derived.byproducts.map(bp => `${bp.icon} ${bp.description}`).join(" · ");
        comboAutoTags.appendChild(bpDesc);
      }

      function addTag(text, color) {
        const tag = doc.createElement("span");
        tag.textContent = text;
        tag.style.cssText = `font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 10px; background: ${color}15; color: ${color}; border: 1px solid ${color}30;`;
        comboAutoTags.appendChild(tag);
      }
    }

    simpleModeContainer.appendChild(comboPreview);

    // Meta-sliders section
    const metaSection = doc.createElement("div");
    metaSection.style.cssText = "margin-bottom: 16px;";

    const metaLabel = doc.createElement("div");
    metaLabel.textContent = "QUICK SETTINGS";
    metaLabel.style.cssText = `
      font-size: 10px; font-weight: 700; color: #64748b; letter-spacing: 0.08em;
      text-transform: uppercase; margin-bottom: 10px; user-select: none;
    `;
    metaSection.appendChild(metaLabel);

    // Reverse-derive metaValues from current emitterCfg advanced settings
    // so quick settings reflect saved state (forward: emitRate = 5 + i*495, pointSize = 1 + i*7, etc.)
    const _clamp01 = v => Math.max(0, Math.min(1, v));
    const _initIntensity = _clamp01(
      (((emitterCfg.emitRate ?? 153) - 5) / 495 + ((emitterCfg.pointSize ?? 3.1) - 1) / 7) / 2
    );
    const _initSpread = _clamp01(
      (((emitterCfg.horizontalSpeed ?? 1.5) / 5) + (((emitterCfg.upSpeedMax ?? emitterCfg.riseMax ?? 3.4) - 1) / 8)) / 2
    );
    const _initLifetime = _clamp01(
      (((emitterCfg.lifetimeMin ?? 3.2) - 0.3) / 9.7 + ((emitterCfg.lifetimeMax ?? 9.35) - 0.5) / 29.5) / 2
    );
    const metaValues = {
      intensity: _initIntensity,
      spread: _initSpread,
      lifetime: _initLifetime,
    };

    function applyMetaSliders() {
      const physics = metaSlidersToPhysics(metaValues);
      emitterCfg.emitRate = physics.emitRate;
      emitterCfg.pointSize = physics.pointSize;
      emitterCfg.horizontalSpeed = physics.horizontalSpeed;
      emitterCfg.riseMin = physics.upSpeedMin;
      emitterCfg.riseMax = physics.upSpeedMax;
      emitterCfg.lifetimeMin = physics.lifetimeMin;
      emitterCfg.lifetimeMax = physics.lifetimeMax;
    }

    function addMetaSlider(label, key, accent) {
      const row = doc.createElement("div");
      row.style.cssText = `
        display: flex; align-items: center; gap: 8px; padding: 8px 12px;
        background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%);
        border-radius: 8px; border: 1px solid rgba(255,255,255,0.04); margin-bottom: 6px;
      `;
      const lbl = doc.createElement("span");
      lbl.textContent = label;
      lbl.style.cssText = `font-size: 11px; font-weight: 500; color: #94a3b8; flex: 0 0 72px; user-select: none;`;
      row.appendChild(lbl);

      const slider = doc.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "1";
      slider.step = "0.02";
      slider.value = String(metaValues[key]);
      const pct = metaValues[key] * 100;
      slider.style.cssText = `
        flex: 1; height: 6px; border-radius: 3px;
        background: linear-gradient(90deg, ${accent} 0%, ${accent} ${pct}%, rgba(255,255,255,0.08) ${pct}%, rgba(255,255,255,0.08) 100%);
        outline: none; cursor: pointer; -webkit-appearance: none; appearance: none;
      `;
      slider.oninput = () => {
        metaValues[key] = parseFloat(slider.value);
        const p = metaValues[key] * 100;
        slider.style.background = `linear-gradient(90deg, ${accent} 0%, ${accent} ${p}%, rgba(255,255,255,0.08) ${p}%, rgba(255,255,255,0.08) 100%)`;
        val.textContent = metaValues[key] < 0.33 ? "Low" : metaValues[key] < 0.66 ? "Medium" : "High";
        applyMetaSliders();
      };
      slider.onmousedown = (e) => e.stopPropagation();
      slider.ontouchstart = (e) => e.stopPropagation();
      row.appendChild(slider);

      const val = doc.createElement("span");
      val.textContent = metaValues[key] < 0.33 ? "Low" : metaValues[key] < 0.66 ? "Medium" : "High";
      val.style.cssText = `
        font-size: 10px; font-weight: 600; color: ${accent}; min-width: 44px; text-align: right;
        padding: 2px 6px; background: rgba(0,0,0,0.3); border-radius: 4px;
        font-family: 'JetBrains Mono', monospace;
      `;
      row.appendChild(val);

      metaSection.appendChild(row);
    }

    addMetaSlider("Intensity", "intensity", "#f97316");
    addMetaSlider("Spread", "spread", "#3b82f6");
    addMetaSlider("Lifetime", "lifetime", "#22c55e");

    simpleModeContainer.appendChild(metaSection);

    // "Create Spell From This" button
    const spellBtnRow = doc.createElement("div");
    spellBtnRow.style.cssText = "display: flex; justify-content: center; margin-top: 8px;";

    const spellBtn = doc.createElement("button");
    spellBtn.textContent = "✨ Create Spell From This";
    spellBtn.style.cssText = `
      padding: 8px 20px; border-radius: 8px; border: 1px solid rgba(168,85,247,0.3);
      background: rgba(168,85,247,0.1); color: #a855f7; font-size: 12px; font-weight: 600;
      cursor: pointer; transition: all 0.2s ease; user-select: none;
    `;
    spellBtn.onmouseenter = () => { spellBtn.style.background = "rgba(168,85,247,0.25)"; spellBtn.style.borderColor = "#a855f7"; };
    spellBtn.onmouseleave = () => { spellBtn.style.background = "rgba(168,85,247,0.1)"; spellBtn.style.borderColor = "rgba(168,85,247,0.3)"; };
    spellBtn.onclick = () => {
      // Gather active elements from grid
      const activeEls = [];
      for (const [elemId, state] of elementCards) {
        if (state.power > 0) {
          activeEls.push({ id: elemId, power: state.power, enabled: true });
        }
      }
      if (typeof onCreateSpell === 'function') {
        // Call the auto-blending spell composer (creates multi-layer child emitters)
        // See SpellEffectComposer.js for the composition engine and EditorParticles.js
        // createComposedSpellEffect() for the entity creation handler.
        onCreateSpell(activeEls, { ...emitterCfg });
        // Visual feedback
        spellBtn.textContent = '✅ Spell Layers Created!';
        spellBtn.style.borderColor = '#22c55e';
        spellBtn.style.color = '#22c55e';
        setTimeout(() => {
          spellBtn.textContent = '✨ Create Spell From This';
          spellBtn.style.borderColor = 'rgba(168,85,247,0.3)';
          spellBtn.style.color = '#a855f7';
        }, 2000);
      } else {
        // Fallback: dispatch event for any external listeners
        const spellParams = elementMixToSpellParams(activeEls);
        const event = new CustomEvent('createSpellFromEmitter', {
          detail: { spellParams, elements: activeEls },
          bubbles: true,
        });
        card.dispatchEvent(event);
      }
    };
    spellBtnRow.appendChild(spellBtn);
    simpleModeContainer.appendChild(spellBtnRow);

    // Initial sync
    const initRegistryElements = (emitterCfg.elements || []).map(e => ({
      id: ELEMENT_ALIASES[e.id] || e.id,
      power: e.power || 0,
      enabled: e.enabled !== false,
    }));
    const initDerived = elementMixToEmitterConfig(initRegistryElements);
    updateCombinationPreview(initRegistryElements, initDerived);
  }

  card.appendChild(simpleModeContainer);
  card.appendChild(advancedModeContainer);

  // Set initial mode
  setInspectorMode(inspectorMode);

  // ============ HEADER SECTION ============
  let refreshStateBadge = null;
  if (sections.header) {
    const headerRow = doc.createElement("div");
    headerRow.style.display = "flex";
    headerRow.style.alignItems = "center";
    headerRow.style.justifyContent = "space-between";
    headerRow.style.marginBottom = INSPECTOR_THEME.spacing.lg;
    headerRow.style.paddingBottom = INSPECTOR_THEME.spacing.md;
    headerRow.style.borderBottom = `1px solid ${INSPECTOR_THEME.colors.border.light}`;

    // State badge (left side) — updated dynamically via refreshStateBadge()
    const stateBadge = doc.createElement("div");
    Object.assign(stateBadge.style, INSPECTOR_THEME.components.badge.base);
    refreshStateBadge = () => {
      const stId = emitterCfg.physicsProfile?.state || emitterCfg.state || "gas";
      const sDef = STATES[stId] || STATES.gas;
      const sCol = STATE_COLORS[stId] || INSPECTOR_THEME.colors.text.muted;
      stateBadge.style.background = `${sCol}25`;
      stateBadge.style.color = sCol;
      stateBadge.style.borderColor = `${sCol}50`;
      stateBadge.textContent = `${STATE_ICONS[stId] || "💨"} ${sDef.label || stId}`;
    };
    refreshStateBadge();
    headerRow.appendChild(stateBadge);

    // Color section (right side) — interactive start + end color pickers
    const colorBox = doc.createElement("div");
    colorBox.style.display = "flex";
    colorBox.style.alignItems = "center";
    colorBox.style.gap = "8px";

    const colorLabel = doc.createElement("span");
    colorLabel.textContent = "Color";
    colorLabel.style.fontSize = INSPECTOR_THEME.fontSize.sm;
    colorLabel.style.color = INSPECTOR_THEME.colors.text.muted;
    colorBox.appendChild(colorLabel);

    // --- Start color swatch (clickable) ---
    colorPreview = doc.createElement("div");
    colorPreview.style.width = "32px";
    colorPreview.style.height = "32px";
    colorPreview.style.borderRadius = INSPECTOR_THEME.radius.lg;
    colorPreview.style.border = `2px solid ${INSPECTOR_THEME.colors.border.medium}`;
    colorPreview.style.boxShadow = INSPECTOR_THEME.shadow.md;
    colorPreview.style.cursor = "pointer";
    colorPreview.style.transition = "transform 0.15s ease, box-shadow 0.15s ease";
    colorPreview.title = "Start Color — click to customize";
    colorPreview.onmouseenter = () => { colorPreview.style.transform = "scale(1.1)"; colorPreview.style.boxShadow = "0 0 8px rgba(255,255,255,0.2)"; };
    colorPreview.onmouseleave = () => { colorPreview.style.transform = "scale(1)"; colorPreview.style.boxShadow = INSPECTOR_THEME.shadow.md; };

    colorStartInput = doc.createElement("input");
    colorStartInput.type = "color";
    colorStartInput.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
    colorStartInput.oninput = () => {
      emitterCfg._colorOverride = true;
      emitterCfg.color = hexToVec3(colorStartInput.value);
      if (!emitterCfg.colorEnd) emitterCfg.colorEnd = [...emitterCfg.color];
      updateColorPreview();
    };
    colorPreview.onclick = () => colorStartInput.click();

    const startWrap = doc.createElement("div");
    startWrap.style.position = "relative";
    startWrap.appendChild(colorPreview);
    startWrap.appendChild(colorStartInput);
    colorBox.appendChild(startWrap);

    // Arrow between start → end
    const arrow = doc.createElement("span");
    arrow.textContent = "→";
    arrow.style.color = "rgba(255,255,255,0.25)";
    arrow.style.fontSize = "12px";
    arrow.style.userSelect = "none";
    colorBox.appendChild(arrow);

    // --- End color swatch (clickable) ---
    colorEndPreview = doc.createElement("div");
    colorEndPreview.style.width = "32px";
    colorEndPreview.style.height = "32px";
    colorEndPreview.style.borderRadius = INSPECTOR_THEME.radius.lg;
    colorEndPreview.style.border = `2px solid ${INSPECTOR_THEME.colors.border.medium}`;
    colorEndPreview.style.boxShadow = INSPECTOR_THEME.shadow.md;
    colorEndPreview.style.cursor = "pointer";
    colorEndPreview.style.transition = "transform 0.15s ease, box-shadow 0.15s ease";
    colorEndPreview.title = "End Color — click to customize";
    colorEndPreview.onmouseenter = () => { colorEndPreview.style.transform = "scale(1.1)"; colorEndPreview.style.boxShadow = "0 0 8px rgba(255,255,255,0.2)"; };
    colorEndPreview.onmouseleave = () => { colorEndPreview.style.transform = "scale(1)"; colorEndPreview.style.boxShadow = INSPECTOR_THEME.shadow.md; };

    colorEndInput = doc.createElement("input");
    colorEndInput.type = "color";
    colorEndInput.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
    colorEndInput.oninput = () => {
      emitterCfg._colorOverride = true;
      if (!emitterCfg.color) emitterCfg.color = [1, 1, 1];
      emitterCfg.colorEnd = hexToVec3(colorEndInput.value);
      updateColorPreview();
    };
    colorEndPreview.onclick = () => colorEndInput.click();

    const endWrap = doc.createElement("div");
    endWrap.style.position = "relative";
    endWrap.appendChild(colorEndPreview);
    endWrap.appendChild(colorEndInput);
    colorBox.appendChild(endWrap);

    headerRow.appendChild(colorBox);
    advancedModeContainer.appendChild(headerRow);

    // --- Color mode label + reset link + opacity ---
    const colorInfoRow = doc.createElement("div");
    colorInfoRow.style.display = "flex";
    colorInfoRow.style.alignItems = "center";
    colorInfoRow.style.justifyContent = "flex-end";
    colorInfoRow.style.gap = "8px";
    colorInfoRow.style.marginTop = "-8px";
    colorInfoRow.style.marginBottom = "12px";
    colorInfoRow.style.paddingRight = "2px";

    colorModeLabel = doc.createElement("span");
    colorModeLabel.style.fontSize = "10px";
    colorModeLabel.style.fontStyle = "italic";
    colorModeLabel.style.transition = "color 0.2s ease";
    colorInfoRow.appendChild(colorModeLabel);

    resetLink = doc.createElement("span");
    resetLink.textContent = "reset";
    resetLink.style.fontSize = "10px";
    resetLink.style.color = "#3b82f6";
    resetLink.style.cursor = "pointer";
    resetLink.style.textDecoration = "underline";
    resetLink.style.display = emitterCfg._colorOverride ? "inline" : "none";
    resetLink.title = "Reset to element-derived colors";
    resetLink.onclick = () => {
      emitterCfg._colorOverride = false;
      resetLink.style.display = "none";
      updateColorPreview();
    };
    colorInfoRow.appendChild(resetLink);

    // Opacity slider
    const opacitySep = doc.createElement("span");
    opacitySep.textContent = "·";
    opacitySep.style.color = "rgba(255,255,255,0.15)";
    opacitySep.style.fontSize = "10px";
    colorInfoRow.appendChild(opacitySep);

    const opacityLabel = doc.createElement("span");
    opacityLabel.textContent = "Opacity";
    opacityLabel.style.fontSize = "10px";
    opacityLabel.style.color = "rgba(255,255,255,0.35)";
    colorInfoRow.appendChild(opacityLabel);

    opacitySlider = doc.createElement("input");
    opacitySlider.type = "range";
    opacitySlider.min = "0";
    opacitySlider.max = "1";
    opacitySlider.step = "0.05";
    opacitySlider.value = emitterCfg.opacity ?? 1.0;
    opacitySlider.style.cssText = "width:50px;height:4px;cursor:pointer;-webkit-appearance:none;appearance:none;background:rgba(255,255,255,0.15);border-radius:2px;outline:none;";
    opacitySlider.oninput = () => {
      emitterCfg.opacity = parseFloat(opacitySlider.value);
      if (opacityDisplay) opacityDisplay.textContent = emitterCfg.opacity.toFixed(2);
    };
    opacitySlider.onmousedown = (e) => e.stopPropagation();
    colorInfoRow.appendChild(opacitySlider);

    opacityDisplay = doc.createElement("span");
    opacityDisplay.textContent = (emitterCfg.opacity ?? 1.0).toFixed(2);
    opacityDisplay.style.fontSize = "10px";
    opacityDisplay.style.fontFamily = "'JetBrains Mono', monospace";
    opacityDisplay.style.color = "rgba(255,255,255,0.4)";
    opacityDisplay.style.minWidth = "28px";
    colorInfoRow.appendChild(opacityDisplay);

    advancedModeContainer.appendChild(colorInfoRow);
  }

  // ============ ELEMENTS SECTION ============
  let elementsList = null;
  
  function renderElementRows() {
    if (!elementsList) return;
    
    while (elementsList.firstChild) {
      elementsList.removeChild(elementsList.firstChild);
    }

    for (let i = 0; i < emitterCfg.elements.length; i++) {
      const elem = emitterCfg.elements[i];
      const elemDef = ELEMENTS[elem.id];
      if (!elemDef) continue;
      const color = ELEMENT_COLORS[elem.id];

      const row = doc.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "10px";
      row.style.padding = "10px 14px";
      row.style.background = elem.enabled 
        ? `linear-gradient(135deg, ${color}12 0%, transparent 100%)`
        : "rgba(255,255,255,0.02)";
      row.style.borderRadius = "10px";
      row.style.border = `1px solid ${elem.enabled ? color + '30' : 'rgba(255,255,255,0.04)'}`;
      row.style.borderLeft = `3px solid ${elem.enabled ? color : 'rgba(255,255,255,0.1)'}`;
      row.style.transition = "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)";
      row.style.boxShadow = elem.enabled ? `0 4px 12px ${color}15` : "none";
      row.dataset.index = i;

      // Hover effect
      row.onmouseenter = () => {
        if (!elem.enabled) {
          row.style.background = "rgba(255,255,255,0.04)";
          row.style.borderColor = "rgba(255,255,255,0.08)";
        }
      };
      row.onmouseleave = () => {
        if (!elem.enabled) {
          row.style.background = "rgba(255,255,255,0.02)";
          row.style.borderColor = "rgba(255,255,255,0.04)";
        }
      };

      // Drag handle
      const handle = doc.createElement("span");
      handle.textContent = "⋮⋮";
      handle.style.color = "rgba(255,255,255,0.25)";
      handle.style.cursor = "grab";
      handle.style.userSelect = "none";
      handle.style.fontSize = "12px";
      handle.style.letterSpacing = "-2px";
      handle.style.transition = "color 0.15s ease";
      handle.draggable = true;
      handle.ondragstart = (e) => {
        e.dataTransfer.setData("text/plain", i.toString());
        row.style.opacity = "0.5";
        row.style.transform = "scale(0.98)";
      };
      handle.ondragend = () => { 
        row.style.opacity = "1"; 
        row.style.transform = "scale(1)";
      };
      handle.onmouseenter = () => { handle.style.color = "rgba(255,255,255,0.5)"; };
      handle.onmouseleave = () => { handle.style.color = "rgba(255,255,255,0.25)"; };
      row.appendChild(handle);

      // Custom checkbox
      const checkboxWrapper = doc.createElement("label");
      checkboxWrapper.style.position = "relative";
      checkboxWrapper.style.width = "18px";
      checkboxWrapper.style.height = "18px";
      checkboxWrapper.style.cursor = "pointer";

      const checkbox = doc.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = elem.enabled;
      checkbox.style.cssText = `
        position: absolute;
        opacity: 0;
        width: 100%;
        height: 100%;
        cursor: pointer;
        margin: 0;
      `;
      
      const checkboxVisual = doc.createElement("div");
      checkboxVisual.style.cssText = `
        width: 18px;
        height: 18px;
        border-radius: 5px;
        border: 2px solid ${elem.enabled ? color : 'rgba(255,255,255,0.2)'};
        background: ${elem.enabled ? color : 'transparent'};
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
      checkboxVisual.innerHTML = elem.enabled ? '<span style="color:#fff;font-size:11px;">✓</span>' : '';

      checkbox.onchange = () => {
        elem.enabled = checkbox.checked;
        row.style.background = elem.enabled 
          ? `linear-gradient(135deg, ${color}12 0%, transparent 100%)`
          : "rgba(255,255,255,0.02)";
        row.style.border = `1px solid ${elem.enabled ? color + '30' : 'rgba(255,255,255,0.04)'}`;
        row.style.borderLeft = `3px solid ${elem.enabled ? color : 'rgba(255,255,255,0.1)'}`;
        row.style.boxShadow = elem.enabled ? `0 4px 12px ${color}15` : "none";
        label.style.color = elem.enabled ? color : "#64748b";
        checkboxVisual.style.border = `2px solid ${elem.enabled ? color : 'rgba(255,255,255,0.2)'}`;
        checkboxVisual.style.background = elem.enabled ? color : 'transparent';
        checkboxVisual.innerHTML = elem.enabled ? '<span style="color:#fff;font-size:11px;">✓</span>' : '';
        updateColorPreview();
      };
      checkbox.onmousedown = (e) => e.stopPropagation();
      checkboxWrapper.appendChild(checkbox);
      checkboxWrapper.appendChild(checkboxVisual);
      row.appendChild(checkboxWrapper);

      // Icon + Label
      const label = doc.createElement("span");
      label.innerHTML = `<span style="margin-right:6px;">${ELEMENT_ICONS[elem.id] || ""}</span>${elemDef.label}`;
      label.style.flex = "1";
      label.style.color = elem.enabled ? color : "#64748b";
      label.style.fontSize = "13px";
      label.style.fontWeight = "600";
      label.style.transition = "color 0.2s ease";
      row.appendChild(label);

      // Power slider with custom styling
      const sliderContainer = doc.createElement("div");
      sliderContainer.style.width = "70px";
      sliderContainer.style.position = "relative";

      const slider = doc.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "1";
      slider.step = "0.05";
      slider.value = elem.power;
      slider.className = "inspector-slider";
      const pct = elem.power * 100;
      slider.style.cssText = `
        width: 100%;
        height: 6px;
        border-radius: 3px;
        background: linear-gradient(90deg, ${color} 0%, ${color} ${pct}%, rgba(255,255,255,0.1) ${pct}%, rgba(255,255,255,0.1) 100%);
        outline: none;
        cursor: pointer;
        -webkit-appearance: none;
        appearance: none;
      `;
      slider.style.setProperty("--slider-accent", color);
      slider.oninput = () => {
        elem.power = parseFloat(slider.value);
        const p = elem.power * 100;
        slider.style.background = `linear-gradient(90deg, ${color} 0%, ${color} ${p}%, rgba(255,255,255,0.1) ${p}%, rgba(255,255,255,0.1) 100%)`;
        powerDisplay.textContent = elem.power.toFixed(2);
        updateColorPreview();
      };
      slider.onmousedown = (e) => e.stopPropagation();
      slider.ontouchstart = (e) => e.stopPropagation();
      sliderContainer.appendChild(slider);
      row.appendChild(sliderContainer);

      // Power display with pill style
      const powerDisplay = doc.createElement("span");
      powerDisplay.textContent = elem.power.toFixed(2);
      powerDisplay.style.cssText = `
        color: ${color};
        font-size: 11px;
        font-family: 'JetBrains Mono', monospace;
        font-weight: 600;
        min-width: 36px;
        text-align: right;
        padding: 3px 8px;
        background: rgba(0,0,0,0.4);
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.05);
      `;
      row.appendChild(powerDisplay);

      // Remove element button
      const removeBtn = doc.createElement("span");
      removeBtn.textContent = "×";
      removeBtn.title = "Remove element";
      removeBtn.style.cssText = `
        color: rgba(255,255,255,0.15); font-size: 14px; cursor: pointer; user-select: none;
        width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
        border-radius: 4px; transition: all 0.15s ease; flex-shrink: 0;
      `;
      removeBtn.onmouseenter = () => { removeBtn.style.color = "#ef4444"; removeBtn.style.background = "rgba(239,68,68,0.15)"; };
      removeBtn.onmouseleave = () => { removeBtn.style.color = "rgba(255,255,255,0.15)"; removeBtn.style.background = "transparent"; };
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        if (emitterCfg.elements.length <= 1) return; // Keep at least 1 element
        emitterCfg.elements.splice(i, 1);
        renderElementRows();
        updateColorPreview();
      };
      row.appendChild(removeBtn);

      // Drop target for drag-and-drop reordering
      row.ondragover = (e) => { e.preventDefault(); row.style.borderTop = "2px solid #3b82f6"; };
      row.ondragleave = () => { row.style.borderTop = "none"; };
      row.ondrop = (e) => {
        e.preventDefault();
        row.style.borderTop = "none";
        const fromIdx = parseInt(e.dataTransfer.getData("text/plain"));
        const toIdx = i;
        if (fromIdx !== toIdx) {
          const moved = emitterCfg.elements.splice(fromIdx, 1)[0];
          emitterCfg.elements.splice(toIdx, 0, moved);
          renderElementRows();
          updateColorPreview();
        }
      };

      elementsList.appendChild(row);
    }
  }

  if (sections.elements) {
    const elementsSection = doc.createElement("div");
    elementsSection.style.marginBottom = "20px";

    const elementsHeader = doc.createElement("div");
    elementsHeader.style.display = "flex";
    elementsHeader.style.alignItems = "center";
    elementsHeader.style.justifyContent = "space-between";
    elementsHeader.style.marginBottom = "12px";
    elementsHeader.style.paddingBottom = "10px";
    elementsHeader.style.borderBottom = "1px solid rgba(255,255,255,0.06)";

    const elementsLabel = doc.createElement("span");
    elementsLabel.textContent = "Elements";
    elementsLabel.style.fontSize = "11px";
    elementsLabel.style.fontWeight = "700";
    elementsLabel.style.color = "#64748b";
    elementsLabel.style.letterSpacing = "0.05em";
    elementsLabel.style.textTransform = "uppercase";
    elementsHeader.appendChild(elementsLabel);

    const elementsRight = doc.createElement("div");
    elementsRight.style.display = "flex";
    elementsRight.style.alignItems = "center";
    elementsRight.style.gap = "8px";

    const dragHint = doc.createElement("span");
    dragHint.innerHTML = '<span style="opacity:0.5;margin-right:4px;">⋮⋮</span> drag to reorder';
    dragHint.style.fontSize = "10px";
    dragHint.style.color = "rgba(255,255,255,0.3)";
    dragHint.style.fontWeight = "500";
    elementsRight.appendChild(dragHint);

    // Add Element button
    const addElementBtn = doc.createElement("button");
    addElementBtn.textContent = "+";
    addElementBtn.title = "Add element";
    addElementBtn.style.cssText = `
      width: 22px; height: 22px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.5); font-size: 14px;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: all 0.15s ease; line-height: 1; padding: 0;
    `;
    addElementBtn.onmouseenter = () => { addElementBtn.style.background = "rgba(59,130,246,0.2)"; addElementBtn.style.borderColor = "#3b82f6"; addElementBtn.style.color = "#3b82f6"; };
    addElementBtn.onmouseleave = () => { addElementBtn.style.background = "rgba(255,255,255,0.05)"; addElementBtn.style.borderColor = "rgba(255,255,255,0.1)"; addElementBtn.style.color = "rgba(255,255,255,0.5)"; };
    addElementBtn.onclick = (e) => {
      e.stopPropagation();
      // Find elements not in list
      const existingIds = new Set(emitterCfg.elements.map(el => el.id));
      const available = Object.keys(ELEMENTS).filter(id => !existingIds.has(id));
      if (available.length === 0) {
        addElementBtn.style.animation = "none"; // All elements already added
        return;
      }
      // Create dropdown
      const dropdown = doc.createElement("div");
      dropdown.style.cssText = `
        position: absolute; right: 0; top: 100%; z-index: 100;
        background: #1a1a2e; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.6); padding: 4px; min-width: 120px;
      `;
      for (const id of available) {
        const elemDef = ELEMENTS[id];
        const opt = doc.createElement("div");
        opt.textContent = `${ELEMENT_ICONS[id] || ""} ${elemDef.label}`;
        opt.style.cssText = `
          padding: 6px 10px; cursor: pointer; border-radius: 6px; font-size: 12px;
          color: ${ELEMENT_COLORS[id] || "#ccc"}; transition: background 0.1s ease;
        `;
        opt.onmouseenter = () => { opt.style.background = "rgba(255,255,255,0.08)"; };
        opt.onmouseleave = () => { opt.style.background = "transparent"; };
        opt.onclick = (ev) => {
          ev.stopPropagation();
          emitterCfg.elements.push({ id, enabled: true, power: 0.5 });
          dropdown.remove();
          renderElementRows();
          updateColorPreview();
        };
        dropdown.appendChild(opt);
      }
      // Close on outside click
      const closeDropdown = (ev) => { if (!dropdown.contains(ev.target)) { dropdown.remove(); doc.removeEventListener("click", closeDropdown); } };
      setTimeout(() => doc.addEventListener("click", closeDropdown), 0);
      addElementBtn.parentElement.style.position = "relative";
      addElementBtn.parentElement.appendChild(dropdown);
    };
    elementsRight.appendChild(addElementBtn);

    elementsHeader.appendChild(elementsRight);

    elementsSection.appendChild(elementsHeader);

    elementsList = doc.createElement("div");
    elementsList.style.display = "flex";
    elementsList.style.flexDirection = "column";
    elementsList.style.gap = "8px";

    renderElementRows();
    elementsSection.appendChild(elementsList);
    advancedModeContainer.appendChild(elementsSection);
  }

  // Initial color preview update
  updateColorPreview();

  // ============ PHYSICS SECTION ============
  let physicsGrid = null;
  if (sections.physics) {
    const propsSection = doc.createElement("div");
    propsSection.style.marginTop = "8px";
    propsSection.style.paddingTop = "16px";
    propsSection.style.borderTop = "1px solid rgba(255,255,255,0.06)";

    const propsLabel = doc.createElement("div");
    propsLabel.textContent = "Physics";
    propsLabel.style.fontSize = "11px";
    propsLabel.style.fontWeight = "700";
    propsLabel.style.color = "#64748b";
    propsLabel.style.letterSpacing = "0.05em";
    propsLabel.style.textTransform = "uppercase";
    propsLabel.style.marginBottom = "14px";
    propsLabel.style.paddingBottom = "10px";
    propsLabel.style.borderBottom = "1px solid rgba(255,255,255,0.06)";
    propsLabel.style.userSelect = "none";
    propsSection.appendChild(propsLabel);

    physicsGrid = createPhysicsProps(doc, { emitterCfg });
    propsSection.appendChild(physicsGrid.element);

    advancedModeContainer.appendChild(propsSection);
  }

  // ============ MATTER / SUBSTANCE SECTION ============
  let matterRefresh = null;
  if (sections.matter) {
    const matterSection = doc.createElement("div");
    matterSection.style.marginTop = "8px";
    matterSection.style.paddingTop = "16px";
    matterSection.style.borderTop = "1px solid rgba(255,255,255,0.06)";

    const matterLabel = doc.createElement("div");
    matterLabel.textContent = "Matter";
    matterLabel.style.fontSize = "11px";
    matterLabel.style.fontWeight = "700";
    matterLabel.style.color = "#64748b";
    matterLabel.style.letterSpacing = "0.05em";
    matterLabel.style.textTransform = "uppercase";
    matterLabel.style.marginBottom = "14px";
    matterLabel.style.paddingBottom = "10px";
    matterLabel.style.borderBottom = "1px solid rgba(255,255,255,0.06)";
    matterLabel.style.userSelect = "none";
    matterSection.appendChild(matterLabel);

    const matter = createMatterProps(doc, { emitterCfg, onProfileChange: () => {
      if (refreshStateBadge) refreshStateBadge();
      if (physicsGrid && physicsGrid.refresh) physicsGrid.refresh();
    }});
    matterSection.appendChild(matter.element);
    matterRefresh = matter.refresh;

    advancedModeContainer.appendChild(matterSection);
  }

  // ============ AIM SECTION ============
  if (sections.aim && createGyroAimControl) {
    const aimSection = doc.createElement("div");
    
    const aimLabel = doc.createElement("div");
    aimLabel.textContent = "Aim";
    aimLabel.style.fontSize = "11px";
    aimLabel.style.fontWeight = "600";
    aimLabel.style.color = "#94a3b8";
    aimLabel.style.margin = "8px 0 6px";
    aimLabel.style.userSelect = "none";
    aimSection.appendChild(aimLabel);

    const gyro = createGyroAimControl(doc, {
      emitterCfg,
      setGhostOffset,
    });
    if (gyro && gyro.element) {
      aimSection.appendChild(gyro.element);
    }

    const aimToggleRow = doc.createElement("label");
    aimToggleRow.style.display = "flex";
    aimToggleRow.style.alignItems = "center";
    aimToggleRow.style.gap = "6px";
    aimToggleRow.style.marginTop = "4px";
    aimToggleRow.style.fontSize = "10px";
    aimToggleRow.style.color = "#9ca3af";
    aimToggleRow.style.userSelect = "none";

    const aimCheckbox = doc.createElement("input");
    aimCheckbox.type = "checkbox";
    aimCheckbox.checked = emitterCfg.useAimDirection !== false;
    aimCheckbox.style.margin = "0";
    aimCheckbox.onchange = () => {
      emitterCfg.useAimDirection = aimCheckbox.checked;
    };
    aimToggleRow.appendChild(aimCheckbox);

    const aimToggleLabel = doc.createElement("span");
    aimToggleLabel.textContent = "Use aim for velocity";
    aimToggleRow.appendChild(aimToggleLabel);

    aimSection.appendChild(aimToggleRow);
    advancedModeContainer.appendChild(aimSection);
  }

  // Refresh function to re-render element rows (e.g., after external state change)
  function refresh() {
    renderElementRows();
    updateColorPreview();
    if (matterRefresh) matterRefresh();
    if (typeof refreshStateBadge === "function") refreshStateBadge();
    // Sync preset selector
    if (presetSelect) {
      presetSelect.value = emitterCfg._activePreset || "custom";
    }
  }

  return { element: card, refresh };
}
