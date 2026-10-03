// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createPropertySection, addNumberRow, addSliderRow, createThemedBox, createThemedSlider } from "../ui/InspectorControls.js";
import { STATES, deriveColorFromElements } from "../../../sim/particles/ParticleEmitterSystem.js";
import { 
  createEmitterInspectorCard,
  getElementsForState,
} from "./spawner/index.js";
import { INSPECTOR_THEME } from "../ui/InspectorTheme.js";
import { byteRgbToHex } from "../../../core/math/MathColor.js";
import {
  readEditorSettings,
  writeEditorSettings,
} from "../../../../editor/js/storage/EditorPreferenceContracts.js";

export function initSpawnerInspectorPanel(doc, spawnerPanel, options = {}) {
  const getWorld = options?.getWorld || null;
  const spawnConfig = options?.spawn || null;
  const entitiesApi = options?.entitiesApi || null;

  const spawnModes = spawnConfig?.modes || [];
  const canSpawn = !!(spawnConfig?.onSpawn && spawnModes.length > 0);
  const setGhostOffset = typeof spawnConfig?.setGhostOffset === "function"
    ? spawnConfig.setGhostOffset
    : null;
  const setSpawnPreviewProps = typeof spawnConfig?.setSpawnPreviewProps === "function"
    ? spawnConfig.setSpawnPreviewProps
    : null;
  let selectedSpawnModeId = canSpawn && spawnModes[0] ? spawnModes[0].id : null;

  const spawnerState = {};

  function getSpawnerProps(modeId) {
    if (!modeId) {
      return { color: [1.0, 0.8, 0.3], scale: [1, 1, 1] };
    }
    if (!spawnerState[modeId]) {
      if (typeof modeId === "string" && modeId.startsWith("emitter_")) {
        const stateId = modeId.replace("emitter_", "");
        const stateDef = STATES[stateId] || STATES.gas;
        const lifetime = Array.isArray(stateDef.lifetime) ? stateDef.lifetime : [2.0, 5.0];
        const upSpeed = Array.isArray(stateDef.upSpeed) ? stateDef.upSpeed : [1.0, 3.0];
        
        // Get default elements for this state
        const elements = getElementsForState(stateId);
        
        // Derive initial color from elements
        const derived = deriveColorFromElements(elements.filter(e => e.enabled && e.power > 0));

        spawnerState[modeId] = {
          color: derived.color,
          scale: [1, 1, 1],
          emitter: {
            type: stateId,
            state: stateId,
            elements: elements,
            emitRate: stateDef.emitRate ?? 30,
            pointSize: stateDef.pointSize ?? 3.0,
            lifetimeMin: lifetime[0],
            lifetimeMax: lifetime[1],
            gravity: stateDef.gravity ?? 0.0,
            upSpeedMin: upSpeed[0],
            upSpeedMax: upSpeed[1],
            horizontalSpeed: stateDef.horizontalSpeed ?? 0.5,
          },
        };
      } else if (modeId === "cube") {
        spawnerState[modeId] = { color: [0.3, 0.8, 1.0], scale: [1, 1, 1] };
      } else if (modeId === "sphere") {
        spawnerState[modeId] = { color: [0.8, 0.3, 1.0], scale: [1, 1, 1] };
      } else if (modeId === "plane") {
        spawnerState[modeId] = { color: [1.0, 0.3, 0.8], scale: [3, 1, 3] };
      } else if (modeId === "particles") {
        spawnerState[modeId] = { color: [1.0, 1.0, 1.0], scale: [4, 1, 1] };
      } else {
        spawnerState[modeId] = { color: [1.0, 0.8, 0.3], scale: [1, 1, 1] };
      }
    }
    return spawnerState[modeId];
  }

  function clearPanel(panel) {
    while (panel.firstChild) {
      panel.removeChild(panel.firstChild);
    }
  }

  function renderSpawnerPanel() {
    clearPanel(spawnerPanel);
    if (!canSpawn) {
      const msg = doc.createElement("div");
      msg.textContent = "Spawner is not configured";
      spawnerPanel.appendChild(msg);
      return;
    }

    const container = doc.createElement("div");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = INSPECTOR_THEME.spacing.md;

    const spawnToolbar = doc.createElement("div");
    spawnToolbar.style.display = "flex";
    spawnToolbar.style.alignItems = "center";
    spawnToolbar.style.gap = INSPECTOR_THEME.spacing.md;
    spawnToolbar.style.padding = `${INSPECTOR_THEME.spacing.md} ${INSPECTOR_THEME.spacing.lg}`;
    spawnToolbar.style.borderBottom = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;
    spawnToolbar.style.background = INSPECTOR_THEME.colors.bg.secondary;
    spawnToolbar.style.boxShadow = INSPECTOR_THEME.shadow.sm;

    const spawnLabelGroup = doc.createElement("div");
    spawnLabelGroup.style.display = "flex";
    spawnLabelGroup.style.flexDirection = "column";
    spawnLabelGroup.style.gap = INSPECTOR_THEME.spacing.xs;
    spawnLabelGroup.style.minWidth = "110px";

    const spawnLabel = doc.createElement("div");
    spawnLabel.textContent = "Spawn";
    spawnLabel.style.fontSize = INSPECTOR_THEME.fontSize.lg;
    spawnLabel.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
    spawnLabel.style.color = INSPECTOR_THEME.colors.text.primary;
    spawnLabelGroup.appendChild(spawnLabel);

    const spawnHint = doc.createElement("div");
    spawnHint.textContent = "Choose a preset";
    spawnHint.style.fontSize = INSPECTOR_THEME.fontSize.sm;
    spawnHint.style.color = INSPECTOR_THEME.colors.text.secondary;
    spawnLabelGroup.appendChild(spawnHint);
    spawnToolbar.appendChild(spawnLabelGroup);

    const selectWrapper = doc.createElement("div");
    selectWrapper.style.flex = "1";
    selectWrapper.style.position = "relative";
    selectWrapper.style.display = "flex";
    selectWrapper.style.alignItems = "center";
    selectWrapper.style.background = INSPECTOR_THEME.colors.bg.primary;
    selectWrapper.style.border = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;
    selectWrapper.style.borderRadius = INSPECTOR_THEME.radius.md;
    selectWrapper.style.padding = `${INSPECTOR_THEME.spacing.xs} ${INSPECTOR_THEME.spacing.lg}`;
    selectWrapper.style.gap = INSPECTOR_THEME.spacing.sm;
    selectWrapper.style.cursor = "pointer";
    selectWrapper.style.zIndex = "1500";
    selectWrapper.tabIndex = 0;
    selectWrapper.setAttribute("role", "button");
    selectWrapper.setAttribute("aria-haspopup", "listbox");
    selectWrapper.setAttribute("aria-expanded", "false");

    const selectIcon = doc.createElement("span");
    selectIcon.textContent = "🧊";
    selectIcon.style.fontSize = INSPECTOR_THEME.fontSize.lg;
    selectIcon.style.opacity = "0.7";
    selectWrapper.appendChild(selectIcon);

    const selectedText = doc.createElement("div");
    selectedText.style.flex = "1";
    selectedText.style.fontSize = INSPECTOR_THEME.fontSize.md;
    selectedText.style.fontWeight = INSPECTOR_THEME.fontWeight.medium;
    selectedText.style.color = INSPECTOR_THEME.colors.text.primary;
    selectedText.style.whiteSpace = "nowrap";
    selectedText.style.overflow = "hidden";
    selectedText.style.textOverflow = "ellipsis";
    selectWrapper.appendChild(selectedText);

    const spawnSelect = doc.createElement("select");
    spawnSelect.style.display = "none";
    selectWrapper.appendChild(spawnSelect);
    for (let i = 0; i < spawnModes.length; i++) {
      const mode = spawnModes[i];
      if (!mode || !mode.id) {
        continue;
      }
      const opt = doc.createElement("option");
      opt.value = mode.id;
      opt.textContent = mode.label || mode.id;
      spawnSelect.appendChild(opt);
    }
    if (selectedSpawnModeId) {
      spawnSelect.value = selectedSpawnModeId;
    }

    const selectChevron = doc.createElement("span");
    selectChevron.textContent = "▾";
    selectChevron.style.fontSize = INSPECTOR_THEME.fontSize.lg;
    selectChevron.style.color = INSPECTOR_THEME.colors.text.secondary;
    selectChevron.style.pointerEvents = "none";
    selectWrapper.appendChild(selectChevron);

    const dropdownList = doc.createElement("div");
    dropdownList.style.position = "absolute";
    dropdownList.style.left = "0";
    dropdownList.style.right = "0";
    dropdownList.style.top = "calc(100% + 6px)";
    dropdownList.style.background = INSPECTOR_THEME.colors.bg.secondary;
    dropdownList.style.border = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;
    dropdownList.style.borderRadius = INSPECTOR_THEME.radius.md;
    dropdownList.style.boxShadow = INSPECTOR_THEME.shadow.md;
    dropdownList.style.display = "none";
    dropdownList.style.flexDirection = "column";
    dropdownList.style.maxHeight = "260px";
    dropdownList.style.overflowY = "auto";
    dropdownList.style.zIndex = "2000";

    const optionIconMap = {
      cube: "🧊",
      sphere: "⚪",
      plane: "📐",
      particles: "✨",
    };
    const stateIconMap = { gas: "💨", liquid: "💧", solid: "🧊", plasma: "⚡" };

    function getModeIcon(modeId) {
      if (typeof modeId === "string" && modeId.startsWith("emitter_")) {
        const stateId = modeId.replace("emitter_", "");
        return stateIconMap[stateId] || "✨";
      }
      return optionIconMap[modeId] || "🎯";
    }

    function getModeLabel(modeId) {
      const current = spawnModes.find((m) => m?.id === modeId);
      return current?.label || modeId || "Select preset";
    }

    selectedText.textContent = getModeLabel(spawnSelect.value || selectedSpawnModeId);

    function setDropdownOpen(open) {
      dropdownList.style.display = open ? "flex" : "none";
      selectWrapper.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        doc.addEventListener("mousedown", handleOutsideClick);
      } else {
        doc.removeEventListener("mousedown", handleOutsideClick);
      }
    }

    function handleOutsideClick(event) {
      if (!selectWrapper.contains(event.target)) {
        setDropdownOpen(false);
      }
    }

    function handleModeSelection(modeId) {
      setDropdownOpen(false);
      requestAnimationFrame(() => selectWrapper.blur());
      if (spawnSelect.value === modeId) {
        return;
      }
      spawnSelect.value = modeId;
      selectedText.textContent = getModeLabel(modeId);
      spawnSelect.onchange && spawnSelect.onchange();
    }

    for (let i = 0; i < spawnModes.length; i++) {
      const mode = spawnModes[i];
      if (!mode || !mode.id) continue;
      const option = doc.createElement("div");
      option.style.display = "flex";
      option.style.alignItems = "center";
      option.style.gap = INSPECTOR_THEME.spacing.sm;
      option.style.padding = `${INSPECTOR_THEME.spacing.sm} ${INSPECTOR_THEME.spacing.md}`;
      option.style.cursor = mode.disabled ? "not-allowed" : "pointer";
      option.style.opacity = mode.disabled ? "0.35" : "1";
      option.style.borderRadius = INSPECTOR_THEME.radius.sm;
      option.style.transition = INSPECTOR_THEME.transition;
      option.dataset.modeId = mode.id;
      if (mode.id === spawnSelect.value) {
        option.style.background = INSPECTOR_THEME.colors.bg.hover;
      }

      option.onmouseenter = () => {
        if (!mode.disabled) option.style.background = INSPECTOR_THEME.colors.bg.hover;
      };
      option.onmouseleave = () => {
        if (mode.id === spawnSelect.value) {
          option.style.background = INSPECTOR_THEME.colors.bg.hover;
        } else {
          option.style.background = "transparent";
        }
      };

      if (!mode.disabled) {
        option.onclick = (event) => {
          event.stopPropagation();
          handleModeSelection(mode.id);
        };
      }

      const icon = doc.createElement("span");
      icon.textContent = getModeIcon(mode.id);
      icon.style.fontSize = INSPECTOR_THEME.fontSize.lg;
      option.appendChild(icon);

      const texts = doc.createElement("div");
      texts.style.display = "flex";
      texts.style.flexDirection = "column";
      texts.style.flex = "1";
      texts.style.gap = "2px";

      const label = doc.createElement("span");
      label.textContent = mode.label || mode.id;
      label.style.fontSize = INSPECTOR_THEME.fontSize.md;
      label.style.color = INSPECTOR_THEME.colors.text.primary;
      texts.appendChild(label);

      const sub = doc.createElement("span");
      sub.textContent = mode.description || (mode.id.startsWith("emitter_") ? "Emitter preset" : "Shape preset");
      sub.style.fontSize = INSPECTOR_THEME.fontSize.xs;
      sub.style.color = INSPECTOR_THEME.colors.text.secondary;
      texts.appendChild(sub);

      option.appendChild(texts);
      dropdownList.appendChild(option);
    }

    selectWrapper.appendChild(dropdownList);

    selectWrapper.addEventListener("click", () => {
      const isOpen = dropdownList.style.display === "flex";
      setDropdownOpen(!isOpen);
    });

    selectWrapper.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const isOpen = dropdownList.style.display === "flex";
        setDropdownOpen(!isOpen);
      } else if (event.key === "Escape") {
        setDropdownOpen(false);
      }
    });

    spawnToolbar.appendChild(selectWrapper);

    const spawnButton = doc.createElement("button");
    spawnButton.textContent = "Spawn at last click";
    spawnButton.style.fontSize = INSPECTOR_THEME.fontSize.md;
    spawnButton.style.padding = `${INSPECTOR_THEME.spacing.sm} ${INSPECTOR_THEME.spacing.md}`;
    spawnButton.style.borderRadius = INSPECTOR_THEME.radius.sm;
    spawnButton.style.border = "none";
    spawnButton.style.cursor = "pointer";
    spawnButton.style.background = INSPECTOR_THEME.colors.semantic.success;
    spawnButton.style.color = INSPECTOR_THEME.colors.text.primary;
    spawnButton.style.fontWeight = INSPECTOR_THEME.fontWeight.medium;
    spawnToolbar.appendChild(spawnButton);

    container.appendChild(spawnToolbar);

    const spawnerSection = createPropertySection(doc, container, "Spawner");

    function refreshSpawnerProperties() {
      while (spawnerSection.firstChild) {
        spawnerSection.removeChild(spawnerSection.firstChild);
      }
      const modeId =
        selectedSpawnModeId || (spawnModes[0] && spawnModes[0].id) || null;
      if (!modeId) {
        return;
      }
      const props = getSpawnerProps(modeId);

      const updateGhostPreviewProps = () => {
        if (!setSpawnPreviewProps) {
          return;
        }
        const previewScale = Array.isArray(props.scale)
          ? [
              Number(props.scale[0]) || 1,
              Number(props.scale[1]) || 1,
              Number(props.scale[2]) || 1,
            ]
          : [1, 1, 1];
        const previewColor = Array.isArray(props.color)
          ? [
              Number(props.color[0]) || 0.5,
              Number(props.color[1]) || 0.5,
              Number(props.color[2]) || 0.5,
            ]
          : [0.5, 0.5, 0.5];
        setSpawnPreviewProps({ scale: previewScale, color: previewColor });
      };

      // ===== COLOR SECTION with preview swatch =====
      const colorBox = createThemedBox(doc, "🎨 Color");
      
      // Color preview row
      const colorPreviewRow = doc.createElement("div");
      colorPreviewRow.style.display = "flex";
      colorPreviewRow.style.alignItems = "center";
      colorPreviewRow.style.gap = INSPECTOR_THEME.spacing.md;
      colorPreviewRow.style.marginBottom = INSPECTOR_THEME.spacing.md;
      
      const colorPreview = doc.createElement("div");
      colorPreview.style.width = "48px";
      colorPreview.style.height = "48px";
      colorPreview.style.borderRadius = INSPECTOR_THEME.radius.lg;
      colorPreview.style.border = `2px solid ${INSPECTOR_THEME.colors.border.medium}`;
      colorPreview.style.boxShadow = INSPECTOR_THEME.shadow.md;
      colorPreview.style.flexShrink = "0";
      
      function updateColorPreview() {
        const r = Math.round(props.color[0] * 255);
        const g = Math.round(props.color[1] * 255);
        const b = Math.round(props.color[2] * 255);
        colorPreview.style.background = `rgb(${r}, ${g}, ${b})`;
        hexValue.textContent = byteRgbToHex(r, g, b).toUpperCase();
      }
      
      const colorInfo = doc.createElement("div");
      colorInfo.style.flex = "1";
      
      const hexValue = doc.createElement("div");
      hexValue.style.fontSize = INSPECTOR_THEME.fontSize.lg;
      hexValue.style.fontFamily = "monospace";
      hexValue.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
      hexValue.style.color = INSPECTOR_THEME.colors.text.primary;
      hexValue.style.marginBottom = INSPECTOR_THEME.spacing.xs;
      colorInfo.appendChild(hexValue);
      
      const rgbValue = doc.createElement("div");
      rgbValue.style.fontSize = INSPECTOR_THEME.fontSize.sm;
      rgbValue.style.color = INSPECTOR_THEME.colors.text.muted;
      rgbValue.textContent = "RGB Color";
      colorInfo.appendChild(rgbValue);
      
      colorPreviewRow.appendChild(colorPreview);
      colorPreviewRow.appendChild(colorInfo);
      colorBox.appendChild(colorPreviewRow);
      
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
        labelEl.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
        labelEl.style.color = accent;
        row.appendChild(labelEl);
        
        const slider = doc.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = "1";
        slider.step = "0.01";
        slider.value = String(props.color[index]);
        slider.style.flex = "1";
        slider.style.accentColor = accent;
        slider.style.cursor = "pointer";
        slider.oninput = () => {
          props.color[index] = parseFloat(slider.value);
          valueEl.textContent = Math.round(props.color[index] * 255);
          updateColorPreview();
          updateGhostPreviewProps();
        };
        row.appendChild(slider);
        
        const valueEl = doc.createElement("span");
        valueEl.textContent = Math.round(props.color[index] * 255);
        valueEl.style.width = "28px";
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
      colorBox.appendChild(colorSliders);
      
      updateColorPreview();
      spawnerSection.appendChild(colorBox);

      // ===== SCALE SECTION with compact sliders =====
      const scaleBox = createThemedBox(doc, "📏 Scale");
      
      const scaleGrid = doc.createElement("div");
      scaleGrid.style.display = "grid";
      scaleGrid.style.gridTemplateColumns = "1fr 1fr 1fr";
      scaleGrid.style.gap = INSPECTOR_THEME.spacing.md;
      
      function createScaleSlider(label, index) {
        const col = doc.createElement("div");
        col.style.display = "flex";
        col.style.flexDirection = "column";
        col.style.alignItems = "center";
        col.style.gap = INSPECTOR_THEME.spacing.xs;
        
        const labelEl = doc.createElement("span");
        labelEl.textContent = label;
        labelEl.style.fontSize = INSPECTOR_THEME.fontSize.sm;
        labelEl.style.color = INSPECTOR_THEME.colors.text.muted;
        col.appendChild(labelEl);
        
        const valueEl = doc.createElement("span");
        valueEl.textContent = props.scale[index].toFixed(1);
        valueEl.style.fontSize = INSPECTOR_THEME.fontSize.lg;
        valueEl.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
        valueEl.style.color = INSPECTOR_THEME.colors.text.primary;
        valueEl.style.fontFamily = "monospace";
        col.appendChild(valueEl);
        
        const slider = doc.createElement("input");
        slider.type = "range";
        slider.min = "0.1";
        slider.max = "10";
        slider.step = "0.1";
        slider.value = String(props.scale[index]);
        slider.style.width = "100%";
        slider.style.accentColor = INSPECTOR_THEME.colors.semantic.info;
        slider.style.cursor = "pointer";
        slider.oninput = () => {
          props.scale[index] = parseFloat(slider.value);
          valueEl.textContent = props.scale[index].toFixed(1);
          updateGhostPreviewProps();
        };
        col.appendChild(slider);
        
        return col;
      }
      
      scaleGrid.appendChild(createScaleSlider("X", 0));
      scaleGrid.appendChild(createScaleSlider("Y", 1));
      scaleGrid.appendChild(createScaleSlider("Z", 2));
      scaleBox.appendChild(scaleGrid);
      spawnerSection.appendChild(scaleBox);

      if (typeof modeId === "string" && modeId.startsWith("emitter_")) {
        const emitterCfg = props.emitter;
        if (emitterCfg) {
          // Read inspector mode from editor settings (localStorage fallback)
          let _savedMode = 'simple';
          try {
            const settings = readEditorSettings();
            _savedMode = settings?.emitter?.inspectorMode || 'simple';
          } catch (error) {
            console.warn('[SpawnerInspector] Editor settings rejected:', error?.code || error);
          }

          // Use the shared modular emitter card
          const emitterCard = createEmitterInspectorCard(doc, {
            emitterCfg,
            props,
            inspectorMode: _savedMode,
            onModeChange: (mode) => {
              try {
                const settings = readEditorSettings() || {};
                const next = {
                  ...settings,
                  emitter: { ...(settings.emitter || {}), inspectorMode: mode },
                };
                writeEditorSettings(next);
              } catch (error) {
                console.warn('[SpawnerInspector] Editor settings write blocked:', error?.code || error);
              }
            },
            sections: {
              header: true,
              elements: true,
              physics: true,
              aim: true,
            },
            setGhostOffset,
          });
          
          // Wrap in a container with margin
          const emitterWrapper = doc.createElement("div");
          emitterWrapper.style.marginTop = INSPECTOR_THEME.spacing.md;
          emitterWrapper.appendChild(emitterCard.element);
          spawnerSection.appendChild(emitterWrapper);
        }
      }
    }

    refreshSpawnerProperties();

    spawnSelect.onchange = function () {
      const value = spawnSelect.value;
      selectedSpawnModeId =
        value || (spawnModes.length > 0 ? spawnModes[0].id : null);
      refreshSpawnerProperties();
      if (spawnConfig && typeof spawnConfig.onSelect === "function") {
        try {
          spawnConfig.onSelect(selectedSpawnModeId);
        } catch (e) {
          console.error("InspectorPanel spawn onSelect error", e);
        }
      }
    };

    let spawnHoldTimeout = null;
    let spawnHoldInterval = null;

    function clearSpawnTimers() {
      if (spawnHoldTimeout !== null) {
        clearTimeout(spawnHoldTimeout);
        spawnHoldTimeout = null;
      }
      if (spawnHoldInterval !== null) {
        clearInterval(spawnHoldInterval);
        spawnHoldInterval = null;
      }
    }

    function performSpawn() {
      const world = getWorld && getWorld();
      if (!world) {
        return;
      }
      const modeId =
        selectedSpawnModeId || (spawnModes.length > 0 ? spawnModes[0].id : null);
      if (!modeId) {
        return;
      }
      const props = getSpawnerProps(modeId);
      // For emitter_* modes, allow the typed emitterCfg.type to drive the effect key
      // so users can create names like "fire_spark" directly from the inspector.
      if (typeof modeId === "string" && modeId.startsWith("emitter_")) {
        const emitterCfg = props && props.emitter;
        if (emitterCfg && typeof emitterCfg.type === "string" && emitterCfg.type.trim()) {
          props.type = emitterCfg.type.trim();
        } else {
          props.type = modeId.replace("emitter_", "");
        }
        const useAimDirection = emitterCfg.useAimDirection !== false;
        props.useAimDirection = useAimDirection;
        if (
          useAimDirection &&
          Array.isArray(emitterCfg?.direction) &&
          emitterCfg.direction.length >= 3
        ) {
          props.direction = [
            Number(emitterCfg.direction[0]) || 0,
            Number(emitterCfg.direction[1]) || 0,
            Number(emitterCfg.direction[2]) || 0,
          ];
        } else if (props.direction) {
          delete props.direction;
        }
      }
      try {
        spawnConfig.onSpawn(modeId, { world, spawnerProps: props });
      } catch (e) {
        console.error("InspectorPanel spawn handler error", e);
      }
      if (
        entitiesApi &&
        typeof entitiesApi.renderEntitiesPanel === "function"
      ) {
        entitiesApi.renderEntitiesPanel();
      }

      // Defocus the spawn select so it doesn't keep keyboard focus after spawning
      if (doc.activeElement === spawnSelect) {
        spawnSelect.blur();
      }
    }

    spawnButton.onmousedown = function () {
      performSpawn();
      clearSpawnTimers();
      spawnHoldTimeout = setTimeout(function () {
        spawnHoldTimeout = null;
        spawnHoldInterval = setInterval(function () {
          performSpawn();
        }, 100);
      }, 500);
    };

    spawnButton.onmouseup = function () {
      clearSpawnTimers();
    };

    spawnButton.onmouseleave = function () {
      clearSpawnTimers();
    };

    spawnButton.onblur = function () {
      clearSpawnTimers();
    };

    spawnButton.onkeydown = function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        performSpawn();
      }
    };

    spawnerPanel.appendChild(container);
  }

  return {
    renderSpawnerPanel,
  };
}
