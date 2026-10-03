// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createWorldInspectorModel } from "../WorldInspector.js";
import {
  createPropertySection,
  addSliderRow,
  addConfigRow,
  createThemedBox,
  createStatItem,
  createThemedCheckboxRow,
  createThemedSlider,
  renderInspectorSchema,
} from "../ui/InspectorControls.js";
import { INSPECTOR_THEME } from "../ui/InspectorTheme.js";
import { hexToRgb, rgbToHex } from "../../../core/math/MathColor.js";
import {
  readWorldEnvironment,
  readWorldPanelCollapse,
  readWorldPostprocess,
  writeWorldEnvironment,
  writeWorldPanelCollapse,
  writeWorldPostprocess,
} from "../../../../editor/js/storage/EditorPreferenceContracts.js";

export function initWorldInspectorPanel(doc, worldPanel, options = {}) {
  const getWorld =
    options && typeof options.getWorld === "function" ? options.getWorld : null;
  const renderConfig =
    options && typeof options.renderConfig === "object" ? options.renderConfig : null;
  const physicsConfig =
    options && typeof options.physicsConfig === "object" ? options.physicsConfig : null;
  const statsConfig =
    options && typeof options.statsConfig === "object" ? options.statsConfig : null;
  const emitterConfig =
    options && typeof options.emitterConfig === "object" ? options.emitterConfig : null;
  const engineConfig =
    options && typeof options.engineConfig === "object" ? options.engineConfig : null;
  const toolConfig =
    options && typeof options.toolConfig === "object" ? options.toolConfig : null;
  const environmentConfig =
    options && typeof options.environmentConfig === "object" ? options.environmentConfig : null;
  const postProcessConfig =
    options && typeof options.postProcessConfig === "object" ? options.postProcessConfig : null;
  const loadJSONFromStorage =
    options && typeof options.loadJSONFromStorage === "function"
      ? options.loadJSONFromStorage
      : function () {
          return null;
        };
  const saveJSONToStorage =
    options && typeof options.saveJSONToStorage === "function"
      ? options.saveJSONToStorage
      : function () {};
  const shaderStorageKey =
    options && typeof options.shaderStorageKey === "string"
      ? options.shaderStorageKey
      : null;
  const lightStorageKey =
    options && typeof options.lightStorageKey === "string"
      ? options.lightStorageKey
      : null;
  const physicsStorageKey =
    options && typeof options.physicsStorageKey === "string"
      ? options.physicsStorageKey
      : null;

  let worldSettingsHydrated = false;

  // Collapsed sections state (persisted)
  let collapsedSections = new Set();
  try {
    collapsedSections = new Set(readWorldPanelCollapse() || []);
  } catch (error) {
    console.warn('[WorldInspector] Collapsed-section state rejected:', error?.code || error);
  }

  function saveCollapsedState() {
    try {
      writeWorldPanelCollapse([...collapsedSections]);
    } catch (error) {
      console.warn('[WorldInspector] Collapsed-section write blocked:', error?.code || error);
    }
  }

  function clearPanel(panel) {
    while (panel.firstChild) {
      panel.removeChild(panel.firstChild);
    }
  }

  // ─── Collapsible section builder ───
  function createCollapsibleSection(icon, title, sectionId, options = {}) {
    const { titleColor, defaultCollapsed } = options;

    const wrapper = doc.createElement("div");
    Object.assign(wrapper.style, INSPECTOR_THEME.components.section.base);
    wrapper.style.overflow = "hidden";

    // Header row
    const header = doc.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = INSPECTOR_THEME.spacing.md;
    header.style.cursor = "pointer";
    header.style.userSelect = "none";
    header.style.padding = `${INSPECTOR_THEME.spacing.xs} 0`;

    // Chevron
    const chevron = doc.createElement("span");
    chevron.style.fontSize = "10px";
    chevron.style.color = INSPECTOR_THEME.colors.text.muted;
    chevron.style.transition = "transform 0.2s ease";
    chevron.style.display = "inline-block";
    chevron.style.width = "12px";
    chevron.style.textAlign = "center";
    header.appendChild(chevron);

    // Icon
    const iconEl = doc.createElement("span");
    iconEl.textContent = icon;
    iconEl.style.fontSize = INSPECTOR_THEME.fontSize.lg;
    header.appendChild(iconEl);

    // Title
    const titleEl = doc.createElement("span");
    titleEl.textContent = title;
    titleEl.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
    titleEl.style.color = titleColor || INSPECTOR_THEME.colors.text.accent;
    titleEl.style.fontSize = INSPECTOR_THEME.fontSize.lg;
    titleEl.style.flex = "1";
    header.appendChild(titleEl);

    wrapper.appendChild(header);

    // Content area
    const content = doc.createElement("div");
    content.style.marginTop = INSPECTOR_THEME.spacing.md;
    content.style.transition = "max-height 0.25s ease, opacity 0.2s ease";
    wrapper.appendChild(content);

    // Determine initial collapsed state
    const isCollapsed = collapsedSections.has(sectionId) || (defaultCollapsed && !collapsedSections.has("!" + sectionId));

    function setCollapsed(collapsed) {
      if (collapsed) {
        content.style.maxHeight = "0px";
        content.style.opacity = "0";
        content.style.overflow = "hidden";
        chevron.textContent = "▶";
        chevron.style.transform = "rotate(0deg)";
      } else {
        content.style.maxHeight = "4000px";
        content.style.opacity = "1";
        content.style.overflow = "visible";
        chevron.textContent = "▼";
        chevron.style.transform = "rotate(0deg)";
      }
    }

    setCollapsed(isCollapsed);

    header.onclick = () => {
      const nowCollapsed = content.style.opacity !== "0";
      setCollapsed(nowCollapsed);
      if (nowCollapsed) {
        collapsedSections.add(sectionId);
        collapsedSections.delete("!" + sectionId);
      } else {
        collapsedSections.delete(sectionId);
        if (defaultCollapsed) collapsedSections.add("!" + sectionId);
      }
      saveCollapsedState();
    };

    return { wrapper, content, header };
  }

  // ─── Color picker helper ───
  function createColorRow(label, r, g, b, onChange) {
    const row = doc.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = INSPECTOR_THEME.spacing.md;
    row.style.marginBottom = INSPECTOR_THEME.spacing.sm;

    const labelEl = doc.createElement("span");
    labelEl.textContent = label;
    labelEl.style.fontSize = INSPECTOR_THEME.fontSize.md;
    labelEl.style.color = INSPECTOR_THEME.colors.text.muted;
    labelEl.style.flex = "1";
    row.appendChild(labelEl);

    const picker = doc.createElement("input");
    picker.type = "color";
    picker.value = rgbToHex([r, g, b]);
    picker.style.width = "32px";
    picker.style.height = "22px";
    picker.style.border = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;
    picker.style.borderRadius = INSPECTOR_THEME.radius.sm;
    picker.style.background = "transparent";
    picker.style.cursor = "pointer";
    picker.style.padding = "0";

    const hexLabel = doc.createElement("span");
    hexLabel.textContent = picker.value;
    hexLabel.style.fontSize = INSPECTOR_THEME.fontSize.sm;
    hexLabel.style.color = INSPECTOR_THEME.colors.text.secondary;
    hexLabel.style.fontFamily = "monospace";
    hexLabel.style.minWidth = "60px";

    picker.oninput = () => {
      const hex = picker.value;
      hexLabel.textContent = hex;
      if (/^#?[a-f\d]{6}$/i.test(hex)) {
        const [cr, cg, cb] = hexToRgb(hex);
        onChange(cr, cg, cb);
        return;
      }
      const cr = parseInt(hex.slice(1, 3), 16) / 255;
      const cg = parseInt(hex.slice(3, 5), 16) / 255;
      const cb = parseInt(hex.slice(5, 7), 16) / 255;
      onChange(cr, cg, cb);
    };

    row.appendChild(picker);
    row.appendChild(hexLabel);
    return row;
  }

  function renderWorldPanel() {
    clearPanel(worldPanel);
    const world = getWorld && getWorld();
    if (!world) {
      const msg = doc.createElement("div");
      msg.textContent = "No world";
      worldPanel.appendChild(msg);
      return;
    }

    if (!worldSettingsHydrated && (renderConfig || physicsConfig)) {
      worldSettingsHydrated = true;
      if (
        shaderStorageKey &&
        renderConfig &&
        typeof renderConfig.getShaderState === "function" &&
        typeof renderConfig.setShaderState === "function"
      ) {
        const storedShader = loadJSONFromStorage(shaderStorageKey);
        if (storedShader && typeof storedShader === "object") {
          try {
            renderConfig.setShaderState(storedShader);
          } catch (e) {}
        }
      }
      if (
        lightStorageKey &&
        renderConfig &&
        typeof renderConfig.getLightState === "function" &&
        typeof renderConfig.setLightState === "function"
      ) {
        const storedLight = loadJSONFromStorage(lightStorageKey);
        if (storedLight && typeof storedLight === "object") {
          try {
            renderConfig.setLightState(storedLight);
          } catch (e) {}
        }
      }
      if (
        physicsStorageKey &&
        physicsConfig &&
        typeof physicsConfig.getPhysicsState === "function" &&
        typeof physicsConfig.setPhysicsState === "function"
      ) {
        const storedPhysics = loadJSONFromStorage(physicsStorageKey);
        if (storedPhysics && typeof storedPhysics === "object") {
          try {
            physicsConfig.setPhysicsState(storedPhysics);
          } catch (e) {}
        }
      }
      // Hydrate environment config from localStorage
      if (
        environmentConfig &&
        typeof environmentConfig.setEnvironmentState === "function"
      ) {
        try {
          const parsed = readWorldEnvironment();
          if (parsed && typeof parsed === "object") {
            environmentConfig.setEnvironmentState(parsed);
          }
        } catch (error) {
          console.warn('[WorldInspector] Environment state rejected:', error?.code || error);
        }
      }
      // Hydrate post-process config from localStorage
      if (
        postProcessConfig &&
        typeof postProcessConfig.setPostProcessState === "function"
      ) {
        try {
          const parsed = readWorldPostprocess();
          if (parsed && typeof parsed === "object") {
            postProcessConfig.setPostProcessState(parsed);
          }
        } catch (error) {
          console.warn('[WorldInspector] Post-process state rejected:', error?.code || error);
        }
      }
    }

    const model = createWorldInspectorModel(world, {});

    const container = doc.createElement("div");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = INSPECTOR_THEME.spacing.md;

    if (toolConfig && typeof toolConfig.getToolState === "function") {
      const toolState = toolConfig.getToolState();
      if (toolState && toolState.active && toolState.schema && toolState.model) {
        const title = toolState.title != null ? String(toolState.title) : "Tool";
        const toolBox = createThemedBox(doc, title, { titleColor: INSPECTOR_THEME.colors.text.accent });
        renderInspectorSchema(doc, toolBox, toolState.schema, {
          model: toolState.model,
          onApply: typeof toolState.onApply === "function" ? toolState.onApply : null,
        });
        container.appendChild(toolBox);
      }
    }

    // ════════════════════════════════════════════════════════════
    // 1. SHADER MODE + LIGHTING FEATURES
    // ════════════════════════════════════════════════════════════
    if (renderConfig && typeof renderConfig.getShaderState === "function") {
      const { wrapper: shaderWrapper, content: shaderContent } =
        createCollapsibleSection("🎨", "Shader Mode", "shader", {
          titleColor: INSPECTOR_THEME.colors.text.accent,
        });

      const state = renderConfig.getShaderState() || {};
      const modes = Array.isArray(renderConfig.modes)
        ? renderConfig.modes
        : [];

      const modeSelect = doc.createElement("select");
      modeSelect.style.width = "100%";
      modeSelect.style.marginBottom = INSPECTOR_THEME.spacing.md;
      modeSelect.style.padding = INSPECTOR_THEME.spacing.sm;
      modeSelect.style.background = INSPECTOR_THEME.colors.bg.secondary;
      modeSelect.style.color = INSPECTOR_THEME.colors.text.primary;
      modeSelect.style.border = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;
      modeSelect.style.borderRadius = INSPECTOR_THEME.radius.sm;
      modeSelect.style.fontSize = INSPECTOR_THEME.fontSize.md;
      for (let i = 0; i < modes.length; i++) {
        const m = modes[i];
        if (!m || !m.id) continue;
        const opt = doc.createElement("option");
        opt.value = m.id;
        opt.textContent = m.label || m.id;
        modeSelect.appendChild(opt);
      }
      const defaultMode =
        (state && state.shaderMode) || (modes[0] && modes[0].id) || "standard";
      modeSelect.value = defaultMode;
      modeSelect.onchange = function () {
        if (renderConfig.setShaderState) {
          renderConfig.setShaderState({ shaderMode: modeSelect.value });
        }
        if (
          shaderStorageKey &&
          typeof renderConfig.getShaderState === "function"
        ) {
          const latest = renderConfig.getShaderState() || {};
          saveJSONToStorage(shaderStorageKey, latest);
        }
      };
      shaderContent.appendChild(modeSelect);

      const featuresLabel = doc.createElement("div");
      featuresLabel.textContent = "Lighting Features";
      featuresLabel.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
      featuresLabel.style.fontSize = INSPECTOR_THEME.fontSize.md;
      featuresLabel.style.color = INSPECTOR_THEME.colors.text.secondary;
      featuresLabel.style.margin = `${INSPECTOR_THEME.spacing.sm} 0`;
      shaderContent.appendChild(featuresLabel);

      function addFeatureRow(parent, label, key, value) {
        const row = createThemedCheckboxRow(doc, label, value, (checked) => {
          if (renderConfig.setShaderState) {
            const patch = {};
            patch[key] = checked;
            renderConfig.setShaderState(patch);
          }
          if (
            shaderStorageKey &&
            typeof renderConfig.getShaderState === "function"
          ) {
            const latest = renderConfig.getShaderState() || {};
            saveJSONToStorage(shaderStorageKey, latest);
          }
        });
        parent.appendChild(row);
      }

      addFeatureRow(shaderContent, "Diffuse Lighting", "enableDiffuse", state.enableDiffuse);
      addFeatureRow(shaderContent, "Sun Light", "enableSun", state.enableSun);

      const fluidLabel = doc.createElement("div");
      fluidLabel.textContent = "Fluids & Volumetrics";
      fluidLabel.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
      fluidLabel.style.fontSize = INSPECTOR_THEME.fontSize.md;
      fluidLabel.style.color = INSPECTOR_THEME.colors.text.secondary;
      fluidLabel.style.margin = `${INSPECTOR_THEME.spacing.md} 0 ${INSPECTOR_THEME.spacing.sm} 0`;
      shaderContent.appendChild(fluidLabel);

      addFeatureRow(shaderContent, "Volumetric Smoke", "enableVolumeSmoke", state.enableVolumeSmoke);
      addFeatureRow(shaderContent, "Water Surface Pass", "enableWaterPass", state.enableWaterPass);
      addFeatureRow(shaderContent, "Show Fluid Bounds", "showFluidBounds", state.showFluidBounds);

      container.appendChild(shaderWrapper);
    }

    // ════════════════════════════════════════════════════════════
    // 2. ENVIRONMENT LIGHTING (sun, ambient, sky/floor)
    // ════════════════════════════════════════════════════════════
    if (environmentConfig && typeof environmentConfig.getEnvironmentState === "function") {
      const envState = environmentConfig.getEnvironmentState() || {};
      const { wrapper: envWrapper, content: envContent } =
        createCollapsibleSection("☀️", "Environment Lighting", "environment", {
          titleColor: INSPECTOR_THEME.colors.slider.light,
        });

      function saveEnv() {
        if (typeof environmentConfig.getEnvironmentState === "function") {
          try {
            writeWorldEnvironment(environmentConfig.getEnvironmentState());
          } catch (error) {
            console.warn('[WorldInspector] Environment write blocked:', error?.code || error);
          }
        }
      }

      // ── Sun ──
      const sunLabel = doc.createElement("div");
      sunLabel.textContent = "Sun";
      sunLabel.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
      sunLabel.style.fontSize = INSPECTOR_THEME.fontSize.md;
      sunLabel.style.color = INSPECTOR_THEME.colors.text.secondary;
      sunLabel.style.marginBottom = INSPECTOR_THEME.spacing.sm;
      envContent.appendChild(sunLabel);

      const sunEnabledRow = createThemedCheckboxRow(doc, "Enable Sun", envState.sunEnabled !== false, (checked) => {
        environmentConfig.setEnvironmentState({ sunEnabled: checked });
        saveEnv();
      });
      envContent.appendChild(sunEnabledRow);

      // Sun color picker
      envContent.appendChild(createColorRow("Sun Color",
        envState.sunColorR ?? 1.0, envState.sunColorG ?? 0.95, envState.sunColorB ?? 0.85,
        (r, g, b) => {
          environmentConfig.setEnvironmentState({ sunColorR: r, sunColorG: g, sunColorB: b });
          saveEnv();
        }
      ));

      // Sun intensity
      const { container: sunIntSlider } = createThemedSlider(doc, {
        label: "Sun Intensity",
        min: 0, max: 5, step: 0.05,
        value: envState.sunIntensity ?? 1.0,
        accent: INSPECTOR_THEME.colors.slider.light,
        precision: 2,
        onChange: (v) => {
          environmentConfig.setEnvironmentState({ sunIntensity: v });
          saveEnv();
        },
      });
      envContent.appendChild(sunIntSlider);

      // Sun direction X/Y/Z
      const dirFields = [
        { label: "Sun Dir X", key: "sunDirX", val: envState.sunDirX ?? 0.2, min: -1, max: 1 },
        { label: "Sun Dir Y", key: "sunDirY", val: envState.sunDirY ?? -1.0, min: -1, max: 1 },
        { label: "Sun Dir Z", key: "sunDirZ", val: envState.sunDirZ ?? 0.1, min: -1, max: 1 },
      ];
      for (const df of dirFields) {
        const { container: dirSlider } = createThemedSlider(doc, {
          label: df.label,
          min: df.min, max: df.max, step: 0.01,
          value: df.val,
          accent: INSPECTOR_THEME.colors.slider.light,
          precision: 2,
          onChange: (v) => {
            const patch = {};
            patch[df.key] = v;
            environmentConfig.setEnvironmentState(patch);
            saveEnv();
          },
        });
        envContent.appendChild(dirSlider);
      }

      // ── Ambient ──
      const ambientLabel = doc.createElement("div");
      ambientLabel.textContent = "Ambient";
      ambientLabel.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
      ambientLabel.style.fontSize = INSPECTOR_THEME.fontSize.md;
      ambientLabel.style.color = INSPECTOR_THEME.colors.text.secondary;
      ambientLabel.style.margin = `${INSPECTOR_THEME.spacing.md} 0 ${INSPECTOR_THEME.spacing.sm} 0`;
      envContent.appendChild(ambientLabel);

      // Ambient color
      envContent.appendChild(createColorRow("Ambient Color",
        envState.ambientColorR ?? 0.35, envState.ambientColorG ?? 0.38, envState.ambientColorB ?? 0.45,
        (r, g, b) => {
          environmentConfig.setEnvironmentState({ ambientColorR: r, ambientColorG: g, ambientColorB: b });
          saveEnv();
        }
      ));

      // Ambient intensity
      const { container: ambIntSlider } = createThemedSlider(doc, {
        label: "Ambient Intensity",
        min: 0, max: 3, step: 0.05,
        value: envState.ambientIntensity ?? 0.5,
        accent: INSPECTOR_THEME.colors.semantic.info,
        precision: 2,
        onChange: (v) => {
          environmentConfig.setEnvironmentState({ ambientIntensity: v });
          saveEnv();
        },
      });
      envContent.appendChild(ambIntSlider);

      // ── Sky / Floor ──
      const skyLabel = doc.createElement("div");
      skyLabel.textContent = "Sky & Floor";
      skyLabel.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
      skyLabel.style.fontSize = INSPECTOR_THEME.fontSize.md;
      skyLabel.style.color = INSPECTOR_THEME.colors.text.secondary;
      skyLabel.style.margin = `${INSPECTOR_THEME.spacing.md} 0 ${INSPECTOR_THEME.spacing.sm} 0`;
      envContent.appendChild(skyLabel);

      envContent.appendChild(createThemedCheckboxRow(doc, "Sky Color From Lighting", envState.skyColorFromLighting ?? false, (checked) => {
        environmentConfig.setEnvironmentState({ skyColorFromLighting: checked });
        saveEnv();
      }));
      envContent.appendChild(createThemedCheckboxRow(doc, "Solid Floor", envState.solidFloor ?? false, (checked) => {
        environmentConfig.setEnvironmentState({ solidFloor: checked });
        saveEnv();
      }));
      envContent.appendChild(createThemedCheckboxRow(doc, "Solid Floor in Play Mode", envState.solidFloorPlayMode ?? true, (checked) => {
        environmentConfig.setEnvironmentState({ solidFloorPlayMode: checked });
        saveEnv();
      }));
      envContent.appendChild(createThemedCheckboxRow(doc, "Ghost Camera", envState.cameraGhost ?? false, (checked) => {
        environmentConfig.setEnvironmentState({ cameraGhost: checked });
        saveEnv();
      }));

      container.appendChild(envWrapper);
    }

    // ════════════════════════════════════════════════════════════
    // 3. GLOBAL BRIGHTNESS
    // ════════════════════════════════════════════════════════════
    if (renderConfig && typeof renderConfig.getLightState === "function") {
      const { wrapper: lightWrapper, content: lightContent } =
        createCollapsibleSection("🔦", "Global Brightness", "brightness", {
          titleColor: INSPECTOR_THEME.colors.semantic.warning,
        });

      const state = renderConfig.getLightState() || {};
      const max =
        typeof renderConfig.lightMax === "number" && renderConfig.lightMax > 0
          ? renderConfig.lightMax
          : 20;
      const current =
        typeof state.intensity === "number" && Number.isFinite(state.intensity)
          ? state.intensity
          : 1.5;

      const { container: sliderContainer } = createThemedSlider(doc, {
        label: "Current Intensity",
        min: 0,
        max,
        step: 0.05,
        value: current,
        accent: INSPECTOR_THEME.colors.semantic.warning,
        precision: 2,
        snapPoints: [0, 0.25 * max, 0.5 * max, 0.75 * max, max],
        snapToPoints: false,
        formatValue: (v) => `${v.toFixed(2)} lx`,
        onChange: (v) => {
          if (typeof renderConfig.setLightState === "function") {
            renderConfig.setLightState({ intensity: v });
          }
          if (
            lightStorageKey &&
            typeof renderConfig.getLightState === "function"
          ) {
            const latest = renderConfig.getLightState() || {};
            saveJSONToStorage(lightStorageKey, latest);
          }
        },
      });
      lightContent.appendChild(sliderContainer);

      container.appendChild(lightWrapper);
    }

    // ════════════════════════════════════════════════════════════
    // 4. POST-PROCESSING
    // ════════════════════════════════════════════════════════════
    if (postProcessConfig && typeof postProcessConfig.getPostProcessState === "function") {
      const ppState = postProcessConfig.getPostProcessState() || {};
      const { wrapper: ppWrapper, content: ppContent } =
        createCollapsibleSection("⚡", "Post-Processing", "postprocess", {
          titleColor: INSPECTOR_THEME.colors.category.emitters,
        });

      function savePP() {
        if (typeof postProcessConfig.getPostProcessState === "function") {
          try {
            writeWorldPostprocess(postProcessConfig.getPostProcessState());
          } catch (error) {
            console.warn('[WorldInspector] Post-process write blocked:', error?.code || error);
          }
        }
      }

      // ── Bloom ──
      const bloomLabel = doc.createElement("div");
      bloomLabel.textContent = "Bloom";
      bloomLabel.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
      bloomLabel.style.fontSize = INSPECTOR_THEME.fontSize.md;
      bloomLabel.style.color = INSPECTOR_THEME.colors.text.secondary;
      bloomLabel.style.marginBottom = INSPECTOR_THEME.spacing.sm;
      ppContent.appendChild(bloomLabel);

      ppContent.appendChild(createThemedCheckboxRow(doc, "Enable Bloom", ppState.bloomEnabled !== false, (checked) => {
        postProcessConfig.setPostProcessState({ bloomEnabled: checked });
        savePP();
      }));

      const { container: bloomThreshSlider } = createThemedSlider(doc, {
        label: "Threshold",
        min: 0, max: 2, step: 0.01,
        value: ppState.bloomThreshold ?? 0.5,
        accent: INSPECTOR_THEME.colors.category.emitters,
        precision: 2,
        onChange: (v) => {
          postProcessConfig.setPostProcessState({ bloomThreshold: v });
          savePP();
        },
      });
      ppContent.appendChild(bloomThreshSlider);

      const { container: bloomIntSlider } = createThemedSlider(doc, {
        label: "Intensity",
        min: 0, max: 1, step: 0.01,
        value: ppState.bloomIntensity ?? 0.35,
        accent: INSPECTOR_THEME.colors.category.emitters,
        precision: 2,
        onChange: (v) => {
          postProcessConfig.setPostProcessState({ bloomIntensity: v });
          savePP();
        },
      });
      ppContent.appendChild(bloomIntSlider);

      // Bloom note
      const bloomNote = doc.createElement("div");
      bloomNote.textContent = "Bloom active in play mode only";
      bloomNote.style.fontSize = INSPECTOR_THEME.fontSize.xs;
      bloomNote.style.color = INSPECTOR_THEME.colors.text.muted;
      bloomNote.style.marginTop = INSPECTOR_THEME.spacing.xs;
      ppContent.appendChild(bloomNote);

      container.appendChild(ppWrapper);
    }

    // ════════════════════════════════════════════════════════════
    // 5. PERFORMANCE STATS (collapsed by default)
    // ════════════════════════════════════════════════════════════
    if (statsConfig && typeof statsConfig.getStats === "function") {
      const { wrapper: statsWrapper, content: statsContent } =
        createCollapsibleSection("📊", "Performance Stats", "stats", {
          titleColor: INSPECTOR_THEME.colors.text.accent,
          defaultCollapsed: true,
        });

      const statsGrid = doc.createElement("div");
      statsGrid.style.display = "grid";
      statsGrid.style.gridTemplateColumns = "1fr 1fr";
      statsGrid.style.gap = INSPECTOR_THEME.spacing.sm;
      statsGrid.id = "inspector-stats-grid";

      const stats = statsConfig.getStats();
      const fpsItem = createStatItem(doc, "FPS", stats.fps?.toFixed(1) || "0", INSPECTOR_THEME.colors.semantic.success);
      const simTimeScale = stats.simTimeScale ?? 1.0;
      const simScaleItem = createStatItem(doc, "Sim Scale", simTimeScale.toFixed(2), INSPECTOR_THEME.colors.semantic.info);
      const simFpsItem = createStatItem(doc, "Sim FPS", stats.simFps?.toFixed(1) || "0", INSPECTOR_THEME.colors.category.shapes);
      const liveCount = stats.particleLive || 0;
      const deadCount = stats.particleDead || 0;
      const particleText = `${liveCount.toLocaleString()} / ${deadCount.toLocaleString()}`;
      const particleItem = createStatItem(doc, "Particles", particleText, INSPECTOR_THEME.colors.semantic.warning);
      const entityItem = createStatItem(doc, "Entities", stats.entityCount?.toLocaleString() || "0", INSPECTOR_THEME.colors.category.shapes);
      const emitterItem = createStatItem(doc, "Emitters", stats.emitterCount?.toLocaleString() || "0", INSPECTOR_THEME.colors.semantic.error);

      statsGrid.appendChild(fpsItem.item);
      statsGrid.appendChild(simScaleItem.item);
      statsGrid.appendChild(simFpsItem.item);
      statsGrid.appendChild(particleItem.item);
      statsGrid.appendChild(entityItem.item);
      statsGrid.appendChild(emitterItem.item);
      statsContent.appendChild(statsGrid);
      
      // Add particle legend
      const particleLegend = doc.createElement("div");
      particleLegend.style.fontSize = INSPECTOR_THEME.fontSize.xs;
      particleLegend.style.color = INSPECTOR_THEME.colors.text.muted;
      particleLegend.style.marginTop = INSPECTOR_THEME.spacing.sm;
      particleLegend.style.textAlign = "center";
      particleLegend.textContent = "Particles: Live / Dead (reusable)";
      statsContent.appendChild(particleLegend);

      // Store references for live updates
      statsWrapper._fpsValue = fpsItem.valueEl;
      statsWrapper._simScaleValue = simScaleItem.valueEl;
      statsWrapper._simFpsValue = simFpsItem.valueEl;
      statsWrapper._particleValue = particleItem.valueEl;
      statsWrapper._entityValue = entityItem.valueEl;
      statsWrapper._emitterValue = emitterItem.valueEl;
      statsWrapper._getStats = statsConfig.getStats;
      statsWrapper._getEngineConfig = engineConfig?.getConfig || null;

      // Update stats every 100ms
      if (!statsWrapper._interval) {
        statsWrapper._interval = setInterval(() => {
          if (!doc.body.contains(statsWrapper)) {
            clearInterval(statsWrapper._interval);
            return;
          }
          const s = statsWrapper._getStats();
          if (statsWrapper._fpsValue) statsWrapper._fpsValue.textContent = s.fps?.toFixed(1) || "0";
          const simTimeScale = s.simTimeScale ?? 1.0;
          if (statsWrapper._simScaleValue) statsWrapper._simScaleValue.textContent = simTimeScale.toFixed(2);
          if (statsWrapper._simFpsValue) statsWrapper._simFpsValue.textContent = s.simFps?.toFixed(1) || "0";
          const live = s.particleLive || 0;
          const dead = s.particleDead || 0;
          if (statsWrapper._particleValue) statsWrapper._particleValue.textContent = `${live.toLocaleString()} / ${dead.toLocaleString()}`;
          if (statsWrapper._entityValue) statsWrapper._entityValue.textContent = s.entityCount?.toLocaleString() || "0";
          if (statsWrapper._emitterValue) statsWrapper._emitterValue.textContent = s.emitterCount?.toLocaleString() || "0";
        }, 100);
      }

      container.appendChild(statsWrapper);
    }

    // ════════════════════════════════════════════════════════════
    // 6. PHYSICS
    // ════════════════════════════════════════════════════════════
    if (physicsConfig && typeof physicsConfig.getPhysicsState === "function") {
      const { wrapper: physicsWrapper, content: physicsContent } =
        createCollapsibleSection("🧪", "Physics", "physics", {
          titleColor: INSPECTOR_THEME.colors.semantic.success,
        });

      const state = physicsConfig.getPhysicsState() || {};
      const enabled = state.enabled !== false;
      let gravityScale =
        typeof state.gravityScale === "number" &&
        Number.isFinite(state.gravityScale)
          ? state.gravityScale
          : 1;
      if (gravityScale < -1) gravityScale = -1;
      if (gravityScale > 1) gravityScale = 1;

      let staticFriction =
        typeof state.staticFriction === "number" &&
        Number.isFinite(state.staticFriction)
          ? state.staticFriction
          : 0.5;
      if (staticFriction < 0) staticFriction = 0;
      if (staticFriction > 2) staticFriction = 2;

      let dynamicFriction =
        typeof state.dynamicFriction === "number" &&
        Number.isFinite(state.dynamicFriction)
          ? state.dynamicFriction
          : staticFriction;
      if (dynamicFriction < 0) dynamicFriction = 0;
      if (dynamicFriction > 2) dynamicFriction = 2;

      let restitution =
        typeof state.restitution === "number" &&
        Number.isFinite(state.restitution)
          ? state.restitution
          : 0.5;
      if (restitution < 0) restitution = 0;
      if (restitution > 1) restitution = 1;

      let enabledCheckboxRef = null;
      const enabledRow = createThemedCheckboxRow(doc, "Enable Physics", enabled, (checked) => {
        if (typeof physicsConfig.setPhysicsState === "function") {
          physicsConfig.setPhysicsState({
            enabled: checked,
            gravityScale,
            staticFriction,
            dynamicFriction,
            restitution,
          });
        }
        if (
          physicsStorageKey &&
          typeof physicsConfig.getPhysicsState === "function"
        ) {
          const latest = physicsConfig.getPhysicsState() || {};
          saveJSONToStorage(physicsStorageKey, latest);
        }
      });
      enabledCheckboxRef = enabledRow.querySelector('input[type="checkbox"]');
      physicsContent.appendChild(enabledRow);

      const { container: gravitySlider } = createThemedSlider(doc, {
        label: "Gravity Scale (-1 to 1)",
        min: -1,
        max: 1,
        step: 0.05,
        value: gravityScale,
        accent: INSPECTOR_THEME.colors.semantic.success,
        onChange: (v) => {
          gravityScale = v;
          if (typeof physicsConfig.setPhysicsState === "function") {
            physicsConfig.setPhysicsState({
              enabled: enabledCheckboxRef?.checked ?? true,
              gravityScale: v,
              staticFriction,
              dynamicFriction,
              restitution,
            });
          }
          if (
            physicsStorageKey &&
            typeof physicsConfig.getPhysicsState === "function"
          ) {
            const latest = physicsConfig.getPhysicsState() || {};
            saveJSONToStorage(physicsStorageKey, latest);
          }
        }
      });
      physicsContent.appendChild(gravitySlider);

      // Debug visualization section
      const debugLabel = doc.createElement("div");
      debugLabel.textContent = "Debug Visualization";
      debugLabel.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
      debugLabel.style.fontSize = INSPECTOR_THEME.fontSize.md;
      debugLabel.style.color = INSPECTOR_THEME.colors.text.secondary;
      debugLabel.style.margin = `${INSPECTOR_THEME.spacing.md} 0 ${INSPECTOR_THEME.spacing.sm} 0`;
      physicsContent.appendChild(debugLabel);

      const _savePhysics = () => {
        if (physicsStorageKey && typeof physicsConfig.getPhysicsState === "function") {
          saveJSONToStorage(physicsStorageKey, physicsConfig.getPhysicsState() || {});
        }
      };
      const _setPhysics = (patch) => {
        if (typeof physicsConfig.setPhysicsState === "function") {
          physicsConfig.setPhysicsState(patch);
        }
        _savePhysics();
      };

      // ── Master toggle: Show Voxel Colliders (all diagnostic layers)
      const showVoxelWireframe = state.showVoxelWireframe || false;
      const voxelRow = createThemedCheckboxRow(doc, "Show Voxel Colliders", showVoxelWireframe, (checked) => {
        _setPhysics({ showVoxelWireframe: checked });
        subLayersWrapper.style.display = checked ? "block" : "none";
      });
      physicsContent.appendChild(voxelRow);

      // ── Sub-layer toggles (indented, shown only when master is on)
      const subLayersWrapper = doc.createElement("div");
      subLayersWrapper.style.display = showVoxelWireframe ? "block" : "none";
      subLayersWrapper.style.paddingLeft = "16px";
      subLayersWrapper.style.borderLeft = `2px solid ${INSPECTOR_THEME.colors.border.dark}`;
      subLayersWrapper.style.marginLeft = "6px";
      subLayersWrapper.style.marginBottom = INSPECTOR_THEME.spacing.sm;

      // Sub-layer helper: creates a colored dot + label row
      const _subRow = (label, dotColor, key, defaultOn) => {
        const checked = state[key] !== undefined ? !!state[key] : defaultOn;
        const row = createThemedCheckboxRow(doc, label, checked, (v) => _setPhysics({ [key]: v }));
        // Insert colored dot before label text
        const dot = doc.createElement("span");
        dot.style.display = "inline-block";
        dot.style.width = "8px";
        dot.style.height = "8px";
        dot.style.borderRadius = "50%";
        dot.style.background = dotColor;
        dot.style.flexShrink = "0";
        dot.style.marginRight = "4px";
        const span = row.querySelector("span");
        if (span) row.insertBefore(dot, span);
        subLayersWrapper.appendChild(row);
      };

      _subRow("Aura  (outer shell)",   "#29b6f6", "showAura",        true);   // light blue
      _subRow("Skin  (bone capsules)", "#ff8a65", "showSkin",        true);   // warm orange
      _subRow("Skeleton  (X-ray rig)", "#ffd54f", "showSkeleton",    true);   // gold
      _subRow("SDF Colliders (heavy)", "#ce93d8", "showSdfColliders", false); // purple — off by default

      physicsContent.appendChild(subLayersWrapper);

      // ── Bone direction arrows (separate from the layer system)
      const showBoneDirections = state.showBoneDirections !== false;
      const boneDirectionsRow = createThemedCheckboxRow(doc, "Show Bone Directions", showBoneDirections, (checked) => {
        _setPhysics({ showBoneDirections: checked });
      });
      physicsContent.appendChild(boneDirectionsRow);

      const frictionSection = createPropertySection(
        doc,
        physicsContent,
        "Material",
      );

      addSliderRow(
        doc,
        frictionSection,
        "Static Friction (0-2)",
        0,
        2,
        0.05,
        () => staticFriction,
        (v) => {
          staticFriction = v;
          if (typeof physicsConfig.setPhysicsState === "function") {
            physicsConfig.setPhysicsState({
              enabled: enabledCheckboxRef?.checked ?? true,
              gravityScale,
              staticFriction,
              dynamicFriction,
              restitution,
            });
          }
          if (
            physicsStorageKey &&
            typeof physicsConfig.getPhysicsState === "function"
          ) {
            const latest = physicsConfig.getPhysicsState() || {};
            saveJSONToStorage(physicsStorageKey, latest);
          }
        },
        { accent: INSPECTOR_THEME.colors.semantic.info },
      );

      addSliderRow(
        doc,
        frictionSection,
        "Dynamic Friction (0-2)",
        0,
        2,
        0.05,
        () => dynamicFriction,
        (v) => {
          dynamicFriction = v;
          if (typeof physicsConfig.setPhysicsState === "function") {
            physicsConfig.setPhysicsState({
              enabled: enabledCheckboxRef?.checked ?? true,
              gravityScale,
              staticFriction,
              dynamicFriction,
              restitution,
            });
          }
          if (
            physicsStorageKey &&
            typeof physicsConfig.getPhysicsState === "function"
          ) {
            const latest = physicsConfig.getPhysicsState() || {};
            saveJSONToStorage(physicsStorageKey, latest);
          }
        },
        { accent: INSPECTOR_THEME.colors.semantic.info },
      );

      addSliderRow(
        doc,
        frictionSection,
        "Restitution (0-1)",
        0,
        1,
        0.05,
        () => restitution,
        (v) => {
          restitution = v;
          if (typeof physicsConfig.setPhysicsState === "function") {
            physicsConfig.setPhysicsState({
              enabled: enabledCheckboxRef?.checked ?? true,
              gravityScale,
              staticFriction,
              dynamicFriction,
              restitution,
            });
          }
          if (
            physicsStorageKey &&
            typeof physicsConfig.getPhysicsState === "function"
          ) {
            const latest = physicsConfig.getPhysicsState() || {};
            saveJSONToStorage(physicsStorageKey, latest);
          }
        },
        { accent: INSPECTOR_THEME.colors.category.shapes },
      );

      container.appendChild(physicsWrapper);
    }

    // ════════════════════════════════════════════════════════════
    // 7. FLUID / SMOKE (collapsed by default, cleaned up bounds)
    // ════════════════════════════════════════════════════════════
    if (statsConfig && typeof statsConfig.getStats === "function") {
      const { wrapper: fluidWrapper, content: fluidContent } =
        createCollapsibleSection("💨", "Fluid / Smoke", "fluid", {
          titleColor: INSPECTOR_THEME.colors.category.shapes,
          defaultCollapsed: true,
        });

      const fluidGrid = doc.createElement("div");
      fluidGrid.style.display = "grid";
      fluidGrid.style.gridTemplateColumns = "1fr 1fr";
      fluidGrid.style.gap = INSPECTOR_THEME.spacing.sm;
      fluidGrid.style.fontSize = INSPECTOR_THEME.fontSize.sm;

      function createFluidStat(label, value, color) {
        const item = doc.createElement("div");
        item.style.display = "flex";
        item.style.justifyContent = "space-between";
        item.style.padding = `${INSPECTOR_THEME.spacing.xs} ${INSPECTOR_THEME.spacing.sm}`;
        item.style.background = INSPECTOR_THEME.colors.bg.primary;
        item.style.borderRadius = INSPECTOR_THEME.radius.sm;
        
        const labelEl = doc.createElement("span");
        labelEl.textContent = label;
        labelEl.style.color = INSPECTOR_THEME.colors.text.muted;
        
        const valueEl = doc.createElement("span");
        valueEl.textContent = value;
        valueEl.style.color = color || INSPECTOR_THEME.colors.text.primary;
        valueEl.style.fontWeight = INSPECTOR_THEME.fontWeight.medium;
        
        item.appendChild(labelEl);
        item.appendChild(valueEl);
        return { item, valueEl };
      }

      const stats = statsConfig.getStats();
      const gridItem = createFluidStat("Grid", `${stats.fluidGridSize || 0}³`, INSPECTOR_THEME.colors.semantic.info);
      const sourcesItem = createFluidStat("Sources", stats.fluidSourceCount || "0", INSPECTOR_THEME.colors.semantic.success);
      
      fluidGrid.appendChild(gridItem.item);
      fluidGrid.appendChild(sourcesItem.item);
      fluidContent.appendChild(fluidGrid);

      // Bounds display — show "Infinite" instead of raw -1e9..1e9
      const boundsDiv = doc.createElement("div");
      boundsDiv.style.fontSize = INSPECTOR_THEME.fontSize.xs;
      boundsDiv.style.color = INSPECTOR_THEME.colors.text.muted;
      boundsDiv.style.marginTop = INSPECTOR_THEME.spacing.sm;
      boundsDiv.style.fontFamily = "monospace";
      
      function formatBounds(min, max) {
        if (!min || !max) return "N/A";
        const isInfinite = (v) => Math.abs(v) > 1e8;
        if (isInfinite(min[0]) && isInfinite(max[0])) return "Infinite (no active fluid)";
        const fmt = (v) => v.toFixed(1);
        return `[${fmt(min[0])}, ${fmt(min[1])}, ${fmt(min[2])}] → [${fmt(max[0])}, ${fmt(max[1])}, ${fmt(max[2])}]`;
      }
      boundsDiv.textContent = `Bounds: ${formatBounds(stats.fluidWorldMin, stats.fluidWorldMax)}`;
      fluidContent.appendChild(boundsDiv);

      // Store refs for live update
      fluidWrapper._gridValue = gridItem.valueEl;
      fluidWrapper._sourcesValue = sourcesItem.valueEl;
      fluidWrapper._boundsDiv = boundsDiv;
      fluidWrapper._getStats = statsConfig.getStats;
      fluidWrapper._formatBounds = formatBounds;

      // Update fluid stats every 500ms
      if (!fluidWrapper._interval) {
        fluidWrapper._interval = setInterval(() => {
          if (!doc.body.contains(fluidWrapper)) {
            clearInterval(fluidWrapper._interval);
            return;
          }
          const s = fluidWrapper._getStats();
          if (fluidWrapper._gridValue) fluidWrapper._gridValue.textContent = `${s.fluidGridSize || 0}³`;
          if (fluidWrapper._sourcesValue) fluidWrapper._sourcesValue.textContent = s.fluidSourceCount || "0";
          if (fluidWrapper._boundsDiv) fluidWrapper._boundsDiv.textContent = `Bounds: ${fluidWrapper._formatBounds(s.fluidWorldMin, s.fluidWorldMax)}`;
        }, 500);
      }

      container.appendChild(fluidWrapper);
    }

    // ════════════════════════════════════════════════════════════
    // 8. ENGINE CONFIG (collapsed by default)
    // ════════════════════════════════════════════════════════════
    if (engineConfig && typeof engineConfig.getConfig === "function") {
      const { wrapper: configWrapper, content: configContent } =
        createCollapsibleSection("⚙️", "Engine Config", "engineconfig", {
          titleColor: INSPECTOR_THEME.colors.text.muted,
          defaultCollapsed: true,
        });

      const cfg = engineConfig.getConfig();

      // Helper to create snap slider rows
      function addSnapSliderRow(targetEl, label, value, snapPoints, onChange, options = {}) {
        const row = doc.createElement("div");
        row.style.marginBottom = INSPECTOR_THEME.spacing.md;

        const labelRow = doc.createElement("div");
        labelRow.style.display = "flex";
        labelRow.style.justifyContent = "space-between";
        labelRow.style.alignItems = "center";
        labelRow.style.marginBottom = INSPECTOR_THEME.spacing.sm;

        const labelEl = doc.createElement("span");
        labelEl.textContent = label;
        labelEl.style.fontSize = INSPECTOR_THEME.fontSize.md;
        labelEl.style.color = INSPECTOR_THEME.colors.text.muted;
        labelRow.appendChild(labelEl);

        const valueEl = doc.createElement("span");
        valueEl.textContent = options.format ? options.format(value) : String(value);
        valueEl.style.fontSize = INSPECTOR_THEME.fontSize.md;
        valueEl.style.color = INSPECTOR_THEME.colors.text.primary;
        valueEl.style.fontFamily = "monospace";
        valueEl.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
        labelRow.appendChild(valueEl);

        row.appendChild(labelRow);

        // Find closest snap point index for current value
        let closestIdx = 0;
        let closestDist = Math.abs(snapPoints[0] - value);
        for (let i = 1; i < snapPoints.length; i++) {
          const dist = Math.abs(snapPoints[i] - value);
          if (dist < closestDist) {
            closestDist = dist;
            closestIdx = i;
          }
        }

        // Slider container with tick marks
        const sliderContainer = doc.createElement("div");
        sliderContainer.style.position = "relative";
        sliderContainer.style.height = "24px";
        sliderContainer.style.marginBottom = "4px";

        // Tick marks track
        const tickTrack = doc.createElement("div");
        tickTrack.style.position = "absolute";
        tickTrack.style.top = "14px";
        tickTrack.style.left = "6px";
        tickTrack.style.right = "6px";
        tickTrack.style.height = "10px";
        tickTrack.style.display = "flex";
        tickTrack.style.justifyContent = "space-between";
        tickTrack.style.alignItems = "flex-start";
        tickTrack.style.pointerEvents = "none";

        for (let i = 0; i < snapPoints.length; i++) {
          const tick = doc.createElement("div");
          tick.style.width = "2px";
          tick.style.height = i === closestIdx ? "8px" : "4px";
          tick.style.background = i === closestIdx ? (options.accent || "#3b82f6") : "#27272a";
          tick.style.borderRadius = "1px";
          tick.style.transition = "all 0.15s";
          tickTrack.appendChild(tick);
        }
        sliderContainer.appendChild(tickTrack);

        // Slider input
        const slider = doc.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = String(snapPoints.length - 1);
        slider.step = "1";
        slider.value = String(closestIdx);
        slider.style.position = "absolute";
        slider.style.top = "0";
        slider.style.left = "0";
        slider.style.width = "100%";
        slider.style.height = "16px";
        slider.style.background = "transparent";
        slider.style.accentColor = options.accent || "#3b82f6";
        slider.style.cursor = "pointer";

        slider.oninput = () => {
          const idx = parseInt(slider.value);
          const snappedValue = snapPoints[idx];
          valueEl.textContent = options.format ? options.format(snappedValue) : String(snappedValue);
          onChange(snappedValue);
          
          // Update tick highlights
          const ticks = tickTrack.children;
          for (let i = 0; i < ticks.length; i++) {
            ticks[i].style.height = i === idx ? "8px" : "4px";
            ticks[i].style.background = i === idx ? (options.accent || "#3b82f6") : "#27272a";
          }
        };

        sliderContainer.appendChild(slider);
        row.appendChild(sliderContainer);

        // Snap point labels
        const labels = doc.createElement("div");
        labels.style.display = "flex";
        labels.style.justifyContent = "space-between";
        labels.style.fontSize = "8px";
        labels.style.color = "#52525b";
        labels.style.padding = "0 4px";
        
        const firstLabel = doc.createElement("span");
        firstLabel.textContent = options.format ? options.format(snapPoints[0]) : String(snapPoints[0]);
        labels.appendChild(firstLabel);

        const lastLabel = doc.createElement("span");
        lastLabel.textContent = options.format ? options.format(snapPoints[snapPoints.length - 1]) : String(snapPoints[snapPoints.length - 1]);
        labels.appendChild(lastLabel);

        row.appendChild(labels);

        targetEl.appendChild(row);
      }

      // Particle config
      const particleSection = doc.createElement("div");
      particleSection.style.marginBottom = INSPECTOR_THEME.spacing.md;
      const particleLabel = doc.createElement("div");
      particleLabel.textContent = "Particles";
      particleLabel.style.color = INSPECTOR_THEME.colors.text.accent;
      particleLabel.style.fontWeight = INSPECTOR_THEME.fontWeight.medium;
      particleLabel.style.marginBottom = INSPECTOR_THEME.spacing.sm;
      particleSection.appendChild(particleLabel);
      configContent.appendChild(particleSection);

      addSnapSliderRow(configContent, "Max Count", cfg.particles?.maxCount || 20000,
        [1000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000],
        (v) => engineConfig.setConfig?.("particles.maxCount", v),
        { accent: "#f97316", format: (v) => v >= 1000000 ? (v/1000000).toFixed(1) + "M" : v >= 1000 ? (v/1000) + "K" : v }
      );

      addSnapSliderRow(configContent, "Workgroup Size", cfg.particles?.workgroupSize || 256,
        [64, 128, 256, 512, 1024],
        (v) => engineConfig.setConfig?.("particles.workgroupSize", v),
        { accent: "#8b5cf6" }
      );

      // Advanced particle settings
      const advParticleSection = doc.createElement("div");
      advParticleSection.style.marginTop = INSPECTOR_THEME.spacing.md;
      advParticleSection.style.paddingTop = INSPECTOR_THEME.spacing.sm;
      advParticleSection.style.borderTop = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;
      
      const advParticleLabel = doc.createElement("div");
      advParticleLabel.textContent = "Advanced Particles";
      advParticleLabel.style.color = INSPECTOR_THEME.colors.text.accent;
      advParticleLabel.style.fontWeight = INSPECTOR_THEME.fontWeight.medium;
      advParticleLabel.style.marginBottom = INSPECTOR_THEME.spacing.sm;
      advParticleSection.appendChild(advParticleLabel);
      configContent.appendChild(advParticleSection);

      // Adaptive Quality checkbox
      const adaptiveRow = createThemedCheckboxRow(doc, "Adaptive Quality", cfg.particles?.adaptiveQuality ?? true, (checked) => {
        engineConfig.setConfig?.("particles.adaptiveQuality", checked);
      });
      configContent.appendChild(adaptiveRow);

      // Target FPS slider
      addSnapSliderRow(configContent, "Target FPS", cfg.particles?.targetFps || 60,
        [30, 45, 60, 90, 120, 144, 165, 240],
        (v) => engineConfig.setConfig?.("particles.targetFps", v),
        { accent: "#10b981", format: (v) => v + " fps" }
      );

      // Show Lines checkbox
      const showLinesRow = createThemedCheckboxRow(doc, "Show Lines", cfg.particles?.showLines ?? true, (checked) => {
        engineConfig.setConfig?.("particles.showLines", checked);
      });
      configContent.appendChild(showLinesRow);

      // Max Lines slider
      addSnapSliderRow(configContent, "Max Lines", cfg.particles?.maxLines || 100000,
        [10000, 25000, 50000, 100000, 250000, 500000, 1000000],
        (v) => engineConfig.setConfig?.("particles.maxLines", v),
        { accent: "#06b6d4", format: (v) => v >= 1000000 ? (v/1000000).toFixed(1) + "M" : (v/1000) + "K" }
      );

      // Connection Distance slider
      addSnapSliderRow(configContent, "Connection Distance", cfg.particles?.connectionDistance || 2.3,
        [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 8.0, 10.0],
        (v) => engineConfig.setConfig?.("particles.connectionDistance", v),
        { accent: "#f59e0b", format: (v) => v.toFixed(1) }
      );

      // Grid Dims slider
      addSnapSliderRow(configContent, "Grid Dims", cfg.particles?.gridDims || 64,
        [16, 24, 32, 48, 64, 96, 128],
        (v) => engineConfig.setConfig?.("particles.gridDims", v),
        { accent: "#a855f7", format: (v) => v + "³" }
      );

      // Room config
      const roomSection = doc.createElement("div");
      roomSection.style.marginTop = INSPECTOR_THEME.spacing.lg;
      const roomLabel = doc.createElement("div");
      roomLabel.textContent = "Room";
      roomLabel.style.color = INSPECTOR_THEME.colors.text.accent;
      roomLabel.style.fontWeight = INSPECTOR_THEME.fontWeight.medium;
      roomLabel.style.marginBottom = INSPECTOR_THEME.spacing.sm;
      roomSection.appendChild(roomLabel);
      configContent.appendChild(roomSection);

      addSnapSliderRow(configContent, "Room Size", cfg.roomSize || 50,
        [10, 25, 50, 75, 100, 150, 200, 300, 500],
        (v) => engineConfig.setConfig?.("roomSize", v),
        { accent: "#22c55e" }
      );

      // Simulation config
      const simSection = doc.createElement("div");
      simSection.style.marginTop = INSPECTOR_THEME.spacing.lg;
      const simLabel = doc.createElement("div");
      simLabel.textContent = "Simulation";
      simLabel.style.color = INSPECTOR_THEME.colors.text.accent;
      simLabel.style.fontWeight = INSPECTOR_THEME.fontWeight.medium;
      simLabel.style.marginBottom = INSPECTOR_THEME.spacing.sm;
      simSection.appendChild(simLabel);
      configContent.appendChild(simSection);

      addSnapSliderRow(configContent, "Sim Time Scale", cfg.simTimeScale ?? 1.0,
        [0.1, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 5.0],
        (v) => engineConfig.setConfig?.("simTimeScale", v),
        { accent: "#3b82f6", format: (v) => v.toFixed(2) + "x" }
      );

      // Note about restart
      const note = doc.createElement("div");
      note.textContent = "⚠️ Some changes require reload";
      note.style.fontSize = INSPECTOR_THEME.fontSize.sm;
      note.style.color = INSPECTOR_THEME.colors.semantic.warning;
      note.style.marginTop = INSPECTOR_THEME.spacing.md;
      configContent.appendChild(note);

      container.appendChild(configWrapper);
    }

    const pre = doc.createElement("pre");
    pre.textContent = JSON.stringify(model, null, 2);
    pre.style.display = "none"; // Hide JSON debug by default
    container.appendChild(pre);

    worldPanel.appendChild(container);
  }

  return {
    renderWorldPanel,
  };
}
