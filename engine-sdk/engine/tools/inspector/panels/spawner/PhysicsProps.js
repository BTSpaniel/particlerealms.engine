// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Physics properties grid component
 * Uses slider-based controls with value readouts to match element styling.
 */

import { INSPECTOR_THEME } from "../../ui/InspectorTheme.js";
import { SUBSTANCE_PRESETS, STATES, derivePhysicsProfile, deriveState, resolveSubstance } from "../../../../sim/particles/ParticleEmitterSystem.js";
import { getAllElements } from "../../../../sim/particles/ParticleElementTable.js";

export function createPhysicsProps(doc, { emitterCfg }) {
  const grid = doc.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "1fr 1fr";
  grid.style.gap = "8px";
  grid.style.fontSize = INSPECTOR_THEME.fontSize.md;

  const _refreshers = [];

  function addProp(label, getValue, setValue, options = {}) {
    const row = doc.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "8px";
    row.style.padding = "10px 12px";
    row.style.background = "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)";
    row.style.borderRadius = "8px";
    row.style.border = "1px solid rgba(255,255,255,0.04)";
    row.style.userSelect = "none";
    row.style.transition = "all 0.2s ease";
    row.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.02)";

    // Hover effect
    row.onmouseenter = () => {
      row.style.background = "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)";
      row.style.borderColor = "rgba(255,255,255,0.08)";
    };
    row.onmouseleave = () => {
      row.style.background = "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)";
      row.style.borderColor = "rgba(255,255,255,0.04)";
    };

    const labelEl = doc.createElement("span");
    labelEl.textContent = label;
    labelEl.style.color = "#94a3b8";
    labelEl.style.fontSize = "11px";
    labelEl.style.fontWeight = "500";
    labelEl.style.flex = "0 0 72px";
    labelEl.style.userSelect = "none";
    row.appendChild(labelEl);

    const min = typeof options.min === "number" ? options.min : 0;
    const max = typeof options.max === "number" ? options.max : 10;
    const step = typeof options.step === "number" ? options.step : 0.1;
    const precision = typeof options.precision === "number" ? options.precision : 2;
    const accent = options.accent || "#3b82f6";
    const help = typeof options.help === "string" ? options.help : "";

    if (help) {
      row.title = help;
    }

    // Slider container for custom styling
    const sliderContainer = doc.createElement("div");
    sliderContainer.style.flex = "1";
    sliderContainer.style.position = "relative";
    sliderContainer.style.height = "20px";
    sliderContainer.style.display = "flex";
    sliderContainer.style.alignItems = "center";

    const slider = doc.createElement("input");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(getValue());
    slider.className = "inspector-slider";
    slider.style.cssText = `
      width: 100%;
      height: 6px;
      border-radius: 3px;
      background: linear-gradient(90deg, ${accent}40 0%, rgba(255,255,255,0.08) 100%);
      outline: none;
      cursor: pointer;
      -webkit-appearance: none;
      appearance: none;
    `;
    slider.style.setProperty("--slider-accent", accent);
    slider.onmousedown = (e) => e.stopPropagation();
    slider.ontouchstart = (e) => e.stopPropagation();
    sliderContainer.appendChild(slider);
    row.appendChild(sliderContainer);

    const valueEl = doc.createElement("span");
    const initial = getValue();
    valueEl.textContent = typeof initial === "number" ? initial.toFixed(precision) : String(initial);
    valueEl.style.color = accent;
    valueEl.style.fontSize = "11px";
    valueEl.style.fontFamily = "'JetBrains Mono', monospace";
    valueEl.style.fontWeight = "600";
    valueEl.style.minWidth = "40px";
    valueEl.style.textAlign = "right";
    valueEl.style.userSelect = "none";
    valueEl.style.padding = "2px 6px";
    valueEl.style.background = "rgba(0,0,0,0.3)";
    valueEl.style.borderRadius = "4px";
    row.appendChild(valueEl);

    slider.oninput = () => {
      const v = parseFloat(slider.value);
      if (!Number.isFinite(v)) return;
      setValue(v);
      valueEl.textContent = v.toFixed(precision);
      // Update slider gradient to show progress
      const percent = ((v - min) / (max - min)) * 100;
      slider.style.background = `linear-gradient(90deg, ${accent} 0%, ${accent} ${percent}%, rgba(255,255,255,0.08) ${percent}%, rgba(255,255,255,0.08) 100%)`;
    };

    // Initial gradient
    const initPercent = ((getValue() - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(90deg, ${accent} 0%, ${accent} ${initPercent}%, rgba(255,255,255,0.08) ${initPercent}%, rgba(255,255,255,0.08) 100%)`;

    // Register refresher so slider can be updated when emitterCfg values change externally
    _refreshers.push(() => {
      const cur = getValue();
      slider.value = String(cur);
      valueEl.textContent = typeof cur === "number" ? cur.toFixed(precision) : String(cur);
      const pct = ((cur - min) / (max - min)) * 100;
      slider.style.background = `linear-gradient(90deg, ${accent} 0%, ${accent} ${pct}%, rgba(255,255,255,0.08) ${pct}%, rgba(255,255,255,0.08) 100%)`;
    });

    grid.appendChild(row);
  }

  addProp(
    "Spawn rate",
    () => emitterCfg.emitRate,
    (v) => {
      emitterCfg.emitRate = Math.max(1, v);
    },
    {
      min: 0,
      max: 500,
      step: 1,
      precision: 0,
      accent: "#f97316",
      help: "How many particles per second this emitter spawns.",
    },
  );

  addProp(
    "Size",
    () => emitterCfg.pointSize,
    (v) => {
      emitterCfg.pointSize = Math.max(0.1, v);
    },
    {
      min: 0.1,
      max: 10,
      step: 0.1,
      precision: 2,
      accent: "#3b82f6",
      help: "How big each particle appears on screen.",
    },
  );

  addProp(
    "Life min",
    () => emitterCfg.lifetimeMin,
    (v) => {
      emitterCfg.lifetimeMin = Math.max(0.1, v);
    },
    {
      min: 0,
      max: 120,
      step: 0.5,
      precision: 1,
      accent: "#22c55e",
      help: "Shortest time (seconds) a particle can live.",
    },
  );

  addProp(
    "Life max",
    () => emitterCfg.lifetimeMax,
    (v) => {
      emitterCfg.lifetimeMax = Math.max(0.1, v);
    },
    {
      min: 0,
      max: 120,
      step: 0.5,
      precision: 1,
      accent: "#22c55e",
      help: "Longest time (seconds) a particle can live.",
    },
  );

  addProp(
    "Gravity",
    () => emitterCfg.gravity,
    (v) => {
      emitterCfg.gravity = v;
    },
    {
      min: -20,
      max: 20,
      step: 0.1,
      precision: 2,
      accent: "#3b82f6",
      help: "Down / up pull. Negative = falls faster, positive = floats up.",
    },
  );

  addProp(
    "Rise min",
    () => emitterCfg.upSpeedMin,
    (v) => {
      emitterCfg.upSpeedMin = v;
    },
    {
      min: 0,
      max: 50,
      step: 0.1,
      precision: 2,
      accent: "#0ea5e9",
      help: "Slowest upward speed. Higher = rises faster.",
    },
  );

  addProp(
    "Rise max",
    () => emitterCfg.upSpeedMax,
    (v) => {
      emitterCfg.upSpeedMax = v;
    },
    {
      min: 0,
      max: 50,
      step: 0.1,
      precision: 2,
      accent: "#0ea5e9",
      help: "Fastest upward speed.",
    },
  );

  addProp(
    "Forward",
    () => emitterCfg.horizontalSpeed || 0,
    (v) => {
      emitterCfg.horizontalSpeed = v;
    },
    {
      min: 0,
      max: 50,
      step: 0.1,
      precision: 2,
      accent: "#a855f7",
      help: "Forward / outward speed away from the emitter.",
    },
  );

  // === PARTICLE PHYSICS PROPERTIES ===
  addProp(
    "Mass",
    () => emitterCfg.mass ?? 1.0,
    (v) => {
      emitterCfg.mass = Math.max(0.1, v);
    },
    {
      min: 0.1,
      max: 10,
      step: 0.1,
      precision: 2,
      accent: "#eab308",
      help: "Particle mass. Heavier = more affected by gravity, harder to push.",
    },
  );

  addProp(
    "Drag",
    () => emitterCfg.drag ?? 0.02,
    (v) => {
      emitterCfg.drag = Math.max(0, Math.min(1, v));
    },
    {
      min: 0,
      max: 1,
      step: 0.01,
      precision: 2,
      accent: "#06b6d4",
      help: "Air resistance. 0 = none (space), 1 = max (thick fluid).",
    },
  );

  addProp(
    "Bounce",
    () => emitterCfg.bounciness ?? 0.3,
    (v) => {
      emitterCfg.bounciness = Math.max(0, Math.min(1, v));
    },
    {
      min: 0,
      max: 1,
      step: 0.05,
      precision: 2,
      accent: "#22c55e",
      help: "Surface restitution. 0 = absorb impact, 1 = full bounce.",
    },
  );

  addProp(
    "Inherit Vel",
    () => emitterCfg.inheritVelocity ?? 0.0,
    (v) => {
      emitterCfg.inheritVelocity = Math.max(0, Math.min(1, v));
    },
    {
      min: 0,
      max: 1,
      step: 0.05,
      precision: 2,
      accent: "#8b5cf6",
      help: "How much emitter velocity transfers to spawned particles.",
    },
  );

  // Collision toggle (special handling for checkbox)
  const collisionRow = doc.createElement("div");
  collisionRow.style.display = "flex";
  collisionRow.style.alignItems = "center";
  collisionRow.style.gap = "8px";
  collisionRow.style.padding = "10px 12px";
  collisionRow.style.background = "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)";
  collisionRow.style.borderRadius = "8px";
  collisionRow.style.border = "1px solid rgba(255,255,255,0.04)";
  collisionRow.style.gridColumn = "span 2";
  collisionRow.title = "Whether particles collide with world geometry.";

  const collisionLabel = doc.createElement("span");
  collisionLabel.textContent = "Collision";
  collisionLabel.style.color = "#94a3b8";
  collisionLabel.style.fontSize = "11px";
  collisionLabel.style.fontWeight = "500";
  collisionLabel.style.flex = "1";
  collisionRow.appendChild(collisionLabel);

  const collisionToggle = doc.createElement("input");
  collisionToggle.type = "checkbox";
  collisionToggle.checked = emitterCfg.collisionEnabled !== false;
  collisionToggle.style.cssText = `
    width: 18px;
    height: 18px;
    cursor: pointer;
    accent-color: #22c55e;
  `;
  collisionToggle.onchange = () => {
    emitterCfg.collisionEnabled = collisionToggle.checked;
  };
  collisionRow.appendChild(collisionToggle);

  const collisionStatus = doc.createElement("span");
  collisionStatus.textContent = collisionToggle.checked ? "ON" : "OFF";
  collisionStatus.style.color = collisionToggle.checked ? "#22c55e" : "#64748b";
  collisionStatus.style.fontSize = "11px";
  collisionStatus.style.fontWeight = "600";
  collisionStatus.style.minWidth = "30px";
  collisionRow.appendChild(collisionStatus);

  collisionToggle.onchange = () => {
    emitterCfg.collisionEnabled = collisionToggle.checked;
    collisionStatus.textContent = collisionToggle.checked ? "ON" : "OFF";
    collisionStatus.style.color = collisionToggle.checked ? "#22c55e" : "#64748b";
  };

  grid.appendChild(collisionRow);

  function refresh() {
    for (const fn of _refreshers) fn();
    collisionToggle.checked = emitterCfg.collisionEnabled !== false;
    collisionStatus.textContent = collisionToggle.checked ? "ON" : "OFF";
    collisionStatus.style.color = collisionToggle.checked ? "#22c55e" : "#64748b";
  }

  return { element: grid, refresh };
}

// =============================================================================
// STATE BADGE CONFIG
// =============================================================================
const STATE_BADGE_CONFIG = {
  solid:  { icon: "❄️", color: "#22c55e", label: "Solid" },
  liquid: { icon: "💧", color: "#3b82f6", label: "Liquid" },
  gas:    { icon: "💨", color: "#6b7280", label: "Gas" },
  plasma: { icon: "⚡", color: "#a855f7", label: "Plasma" },
};

const PHYSICS_BADGE_CONFIG = {
  enableLJ:        { label: "LJ",   color: "#f97316", desc: "Lennard-Jones inter-particle forces" },
  enableEM:        { label: "EM",   color: "#a855f7", desc: "Electromagnetic (Coulomb + Lorentz)" },
  enableSPH:       { label: "SPH",  color: "#3b82f6", desc: "Smoothed-particle hydrodynamics" },
  enableNBody:     { label: "N-Body", color: "#eab308", desc: "N-body gravitational attraction" },
  enableChemistry: { label: "Chem", color: "#22c55e", desc: "Chemical bonding & reactions" },
  enableBlackbody: { label: "BB",   color: "#ef4444", desc: "Blackbody thermal radiation" },
};

const PERIODIC_ELEMENT_OPTIONS = Object.freeze(getAllElements().map((element) => Object.freeze({
  value: element.symbol,
  label: `${String(element.atomicNumber).padStart(3, "0")} · ${element.symbol} — ${element.name}`,
  title: `Atomic number ${element.atomicNumber}; mass ${element.mass}`,
})));

// Substance dropdown options. Elements are generated from the canonical
// Engine table so the Inspector and simulation cannot drift apart.
const SUBSTANCE_OPTIONS = [
  { value: "",     label: "🌬️ Air (Default)" },
  { value: "fire",  label: "🔥 Fire" },
  { value: "water", label: "💧 Water" },
  { value: "smoke", label: "💨 Smoke" },
  { value: "magic", label: "✨ Magic" },
  { value: "---",   label: "─── Elements ───", disabled: true },
  ...PERIODIC_ELEMENT_OPTIONS,
  { value: "----",  label: "─── Compounds ───", disabled: true },
  { value: "H2O",  label: "H₂O — Water" },
  { value: "CO2",  label: "CO₂ — Carbon Dioxide" },
  { value: "NaCl", label: "NaCl — Salt" },
  { value: "CH4",  label: "CH₄ — Methane" },
  { value: "SiO2", label: "SiO₂ — Silica" },
];

/**
 * Create the Matter / Substance section for the emitter inspector.
 * Shows substance dropdown, temperature slider, charge slider, state badge,
 * active physics badges, and conditional SPH params.
 * 
 * @param {Document} doc
 * @param {{ emitterCfg: Object }} options
 * @returns {{ element: HTMLElement, refresh: Function }}
 */
export function createMatterProps(doc, { emitterCfg, onProfileChange }) {
  const container = doc.createElement("div");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.gap = "10px";

  // State badge + physics badges row
  const badgeRow = doc.createElement("div");
  badgeRow.style.display = "flex";
  badgeRow.style.alignItems = "center";
  badgeRow.style.gap = "6px";
  badgeRow.style.flexWrap = "wrap";
  badgeRow.style.minHeight = "28px";
  container.appendChild(badgeRow);

  // SPH params container (hidden when not liquid)
  const sphContainer = doc.createElement("div");
  sphContainer.style.display = "none";
  sphContainer.style.marginTop = "4px";

  function refreshBadges() {
    while (badgeRow.firstChild) badgeRow.removeChild(badgeRow.firstChild);

    const profile = emitterCfg.physicsProfile;
    if (!profile || !profile.state) {
      const noBadge = doc.createElement("span");
      noBadge.textContent = "No substance selected";
      noBadge.style.fontSize = "11px";
      noBadge.style.color = "rgba(255,255,255,0.3)";
      noBadge.style.fontStyle = "italic";
      badgeRow.appendChild(noBadge);
      sphContainer.style.display = "none";
      return;
    }

    // State badge
    const stCfg = STATE_BADGE_CONFIG[profile.state] || STATE_BADGE_CONFIG.gas;
    const stateBadge = doc.createElement("span");
    stateBadge.textContent = `${stCfg.icon} ${stCfg.label}`;
    stateBadge.style.cssText = `
      font-size: 11px; font-weight: 700; padding: 3px 10px;
      border-radius: 20px; border: 1px solid ${stCfg.color}50;
      background: ${stCfg.color}20; color: ${stCfg.color};
      user-select: none;
    `;
    badgeRow.appendChild(stateBadge);

    // Physics system badges
    for (const [key, cfg] of Object.entries(PHYSICS_BADGE_CONFIG)) {
      if (!profile[key]) continue;
      const badge = doc.createElement("span");
      badge.textContent = cfg.label;
      badge.title = cfg.desc;
      badge.style.cssText = `
        font-size: 10px; font-weight: 700; padding: 2px 8px;
        border-radius: 12px; border: 1px solid ${cfg.color}40;
        background: ${cfg.color}15; color: ${cfg.color};
        user-select: none; cursor: help;
        letter-spacing: 0.03em;
      `;
      badgeRow.appendChild(badge);
    }

    // Show/hide SPH params
    sphContainer.style.display = profile.enableSPH ? "block" : "none";
  }

  function updateProfile() {
    const substance = emitterCfg.substance || null;
    const temp = emitterCfg.temperature ?? 293;
    emitterCfg.physicsProfile = derivePhysicsProfile(substance, temp);
    // Override charge if user set it manually
    if (emitterCfg.substanceCharge && Math.abs(emitterCfg.substanceCharge) > 0.01) {
      emitterCfg.physicsProfile.charge = emitterCfg.substanceCharge;
    }
    refreshBadges();
    if (typeof onProfileChange === "function") onProfileChange(emitterCfg.physicsProfile);
  }

  // === SUBSTANCE DROPDOWN ===
  const substanceRow = doc.createElement("div");
  substanceRow.style.display = "flex";
  substanceRow.style.alignItems = "center";
  substanceRow.style.gap = "8px";
  substanceRow.style.padding = "10px 12px";
  substanceRow.style.background = "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)";
  substanceRow.style.borderRadius = "8px";
  substanceRow.style.border = "1px solid rgba(255,255,255,0.04)";

  const substanceLabel = doc.createElement("span");
  substanceLabel.textContent = "Substance";
  substanceLabel.style.color = "#94a3b8";
  substanceLabel.style.fontSize = "11px";
  substanceLabel.style.fontWeight = "500";
  substanceLabel.style.flex = "0 0 72px";
  substanceRow.appendChild(substanceLabel);

  const substanceSelect = doc.createElement("select");
  substanceSelect.style.cssText = `
    flex: 1; padding: 4px 8px; font-size: 12px;
    background: rgba(0,0,0,0.4); color: #e2e8f0;
    border: 1px solid rgba(255,255,255,0.1); border-radius: 6px;
    outline: none; cursor: pointer;
    font-family: 'JetBrains Mono', monospace;
  `;
  for (const opt of SUBSTANCE_OPTIONS) {
    const option = doc.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.title) option.title = opt.title;
    if (opt.disabled) option.disabled = true;
    if ((emitterCfg.substance || "") === opt.value) option.selected = true;
    substanceSelect.appendChild(option);
  }
  substanceSelect.onchange = () => {
    const val = substanceSelect.value;
    emitterCfg.substance = val || null;
    // Auto-set temperature from substance preset if changing substance
    const resolved = resolveSubstance(val);
    if (resolved) {
      emitterCfg.temperature = resolved.temperature;
      if (tempSlider) {
        tempSlider.value = String(resolved.temperature);
        tempValue.textContent = Math.round(resolved.temperature) + "K";
        const pct = ((resolved.temperature - 1) / (15000 - 1)) * 100;
        tempSlider.style.background = `linear-gradient(90deg, #ef4444 0%, #ef4444 ${pct}%, rgba(255,255,255,0.08) ${pct}%, rgba(255,255,255,0.08) 100%)`;
      }
      // Auto-set charge
      if (chargeSlider) {
        emitterCfg.substanceCharge = resolved.charge;
        chargeSlider.value = String(resolved.charge);
        chargeValue.textContent = resolved.charge.toFixed(1);
      }
    }
    updateProfile();
    // Update render mode + phase to match derived state so simulation visuals change
    const profile = emitterCfg.physicsProfile;
    if (profile && profile.state) {
      emitterCfg.state = profile.state; // adapter maps to renderMode + state
      const phaseMap = { solid: 0, liquid: 1, gas: 2, plasma: 3 };
      emitterCfg.phase = phaseMap[profile.state] ?? 2;

      // Apply state-appropriate physics defaults so liquid falls, gas floats, etc.
      const stateDefaults = STATES[profile.state];
      if (stateDefaults) {
        if (stateDefaults.gravity != null) emitterCfg.gravity = stateDefaults.gravity;
        if (stateDefaults.mass != null) emitterCfg.mass = stateDefaults.mass;
        if (stateDefaults.drag != null) emitterCfg.drag = stateDefaults.drag;
        if (stateDefaults.upSpeed) {
          emitterCfg.upSpeedMin = stateDefaults.upSpeed[0];
          emitterCfg.upSpeedMax = stateDefaults.upSpeed[1];
        }
        if (stateDefaults.horizontalSpeed != null) emitterCfg.horizontalSpeed = stateDefaults.horizontalSpeed;
        if (stateDefaults.pointSize != null) emitterCfg.pointSize = stateDefaults.pointSize;
        if (stateDefaults.emitRate != null) emitterCfg.emitRate = stateDefaults.emitRate;
      }
    }
  };
  substanceSelect.onmousedown = (e) => e.stopPropagation();
  substanceRow.appendChild(substanceSelect);
  container.appendChild(substanceRow);

  // === TEMPERATURE SLIDER ===
  let tempSlider = null;
  let tempValue = null;
  {
    const row = doc.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "8px";
    row.style.padding = "10px 12px";
    row.style.background = "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)";
    row.style.borderRadius = "8px";
    row.style.border = "1px solid rgba(255,255,255,0.04)";
    row.title = "Temperature in Kelvin. Determines state of matter (solid/liquid/gas/plasma) based on element's melt and boil points.";

    const label = doc.createElement("span");
    label.textContent = "Temp (K)";
    label.style.color = "#94a3b8";
    label.style.fontSize = "11px";
    label.style.fontWeight = "500";
    label.style.flex = "0 0 72px";
    row.appendChild(label);

    const sliderWrap = doc.createElement("div");
    sliderWrap.style.flex = "1";
    sliderWrap.style.display = "flex";
    sliderWrap.style.alignItems = "center";

    tempSlider = doc.createElement("input");
    tempSlider.type = "range";
    tempSlider.min = "1";
    tempSlider.max = "15000";
    tempSlider.step = "1";
    tempSlider.value = String(emitterCfg.temperature ?? 293);
    tempSlider.className = "inspector-slider";
    const initTemp = emitterCfg.temperature ?? 293;
    const initPct = ((initTemp - 1) / (15000 - 1)) * 100;
    tempSlider.style.cssText = `
      width: 100%; height: 6px; border-radius: 3px;
      background: linear-gradient(90deg, #ef4444 0%, #ef4444 ${initPct}%, rgba(255,255,255,0.08) ${initPct}%, rgba(255,255,255,0.08) 100%);
      outline: none; cursor: pointer;
      -webkit-appearance: none; appearance: none;
    `;
    tempSlider.style.setProperty("--slider-accent", "#ef4444");
    tempSlider.oninput = () => {
      const v = parseInt(tempSlider.value, 10);
      if (!Number.isFinite(v)) return;
      emitterCfg.temperature = v;
      tempValue.textContent = v + "K";
      const pct = ((v - 1) / (15000 - 1)) * 100;
      tempSlider.style.background = `linear-gradient(90deg, #ef4444 0%, #ef4444 ${pct}%, rgba(255,255,255,0.08) ${pct}%, rgba(255,255,255,0.08) 100%)`;
      const prevState = emitterCfg.physicsProfile?.state;
      updateProfile();
      // Update render mode + phase to match derived state (temp changes state of matter)
      const profile = emitterCfg.physicsProfile;
      if (profile && profile.state) {
        emitterCfg.state = profile.state;
        const phaseMap = { solid: 0, liquid: 1, gas: 2, plasma: 3 };
        emitterCfg.phase = phaseMap[profile.state] ?? 2;

        // Apply physics defaults only when state actually changes (not every drag tick)
        if (profile.state !== prevState) {
          const stateDefaults = STATES[profile.state];
          if (stateDefaults) {
            if (stateDefaults.gravity != null) emitterCfg.gravity = stateDefaults.gravity;
            if (stateDefaults.mass != null) emitterCfg.mass = stateDefaults.mass;
            if (stateDefaults.drag != null) emitterCfg.drag = stateDefaults.drag;
            if (stateDefaults.upSpeed) {
              emitterCfg.upSpeedMin = stateDefaults.upSpeed[0];
              emitterCfg.upSpeedMax = stateDefaults.upSpeed[1];
            }
            if (stateDefaults.horizontalSpeed != null) emitterCfg.horizontalSpeed = stateDefaults.horizontalSpeed;
            if (stateDefaults.pointSize != null) emitterCfg.pointSize = stateDefaults.pointSize;
            if (stateDefaults.emitRate != null) emitterCfg.emitRate = stateDefaults.emitRate;
          }
        }
      }
    };
    tempSlider.onmousedown = (e) => e.stopPropagation();
    tempSlider.ontouchstart = (e) => e.stopPropagation();
    sliderWrap.appendChild(tempSlider);
    row.appendChild(sliderWrap);

    tempValue = doc.createElement("span");
    tempValue.textContent = (emitterCfg.temperature ?? 293) + "K";
    tempValue.style.cssText = `
      color: #ef4444; font-size: 11px;
      font-family: 'JetBrains Mono', monospace; font-weight: 600;
      min-width: 50px; text-align: right;
      padding: 2px 6px; background: rgba(0,0,0,0.3); border-radius: 4px;
    `;
    row.appendChild(tempValue);
    container.appendChild(row);
  }

  // === CHARGE SLIDER ===
  let chargeSlider = null;
  let chargeValue = null;
  {
    const row = doc.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "8px";
    row.style.padding = "10px 12px";
    row.style.background = "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)";
    row.style.borderRadius = "8px";
    row.style.border = "1px solid rgba(255,255,255,0.04)";
    row.title = "Electric charge per particle. Nonzero values enable electromagnetic forces.";

    const label = doc.createElement("span");
    label.textContent = "Charge";
    label.style.color = "#94a3b8";
    label.style.fontSize = "11px";
    label.style.fontWeight = "500";
    label.style.flex = "0 0 72px";
    row.appendChild(label);

    const sliderWrap = doc.createElement("div");
    sliderWrap.style.flex = "1";
    sliderWrap.style.display = "flex";
    sliderWrap.style.alignItems = "center";

    chargeSlider = doc.createElement("input");
    chargeSlider.type = "range";
    chargeSlider.min = "-4";
    chargeSlider.max = "4";
    chargeSlider.step = "0.1";
    chargeSlider.value = String(emitterCfg.substanceCharge ?? 0);
    chargeSlider.className = "inspector-slider";
    const initCharge = emitterCfg.substanceCharge ?? 0;
    const chargePct = ((initCharge + 4) / 8) * 100;
    chargeSlider.style.cssText = `
      width: 100%; height: 6px; border-radius: 3px;
      background: linear-gradient(90deg, #a855f7 0%, #a855f7 ${chargePct}%, rgba(255,255,255,0.08) ${chargePct}%, rgba(255,255,255,0.08) 100%);
      outline: none; cursor: pointer;
      -webkit-appearance: none; appearance: none;
    `;
    chargeSlider.style.setProperty("--slider-accent", "#a855f7");
    chargeSlider.oninput = () => {
      const v = parseFloat(chargeSlider.value);
      if (!Number.isFinite(v)) return;
      emitterCfg.substanceCharge = v;
      chargeValue.textContent = v.toFixed(1);
      const pct = ((v + 4) / 8) * 100;
      chargeSlider.style.background = `linear-gradient(90deg, #a855f7 0%, #a855f7 ${pct}%, rgba(255,255,255,0.08) ${pct}%, rgba(255,255,255,0.08) 100%)`;
      updateProfile();
    };
    chargeSlider.onmousedown = (e) => e.stopPropagation();
    chargeSlider.ontouchstart = (e) => e.stopPropagation();
    sliderWrap.appendChild(chargeSlider);
    row.appendChild(sliderWrap);

    chargeValue = doc.createElement("span");
    chargeValue.textContent = (emitterCfg.substanceCharge ?? 0).toFixed(1);
    chargeValue.style.cssText = `
      color: #a855f7; font-size: 11px;
      font-family: 'JetBrains Mono', monospace; font-weight: 600;
      min-width: 40px; text-align: right;
      padding: 2px 6px; background: rgba(0,0,0,0.3); border-radius: 4px;
    `;
    row.appendChild(chargeValue);
    container.appendChild(row);
  }

  // === SPH PARAMS (conditional) ===
  {
    const sphGrid = doc.createElement("div");
    sphGrid.style.display = "flex";
    sphGrid.style.flexDirection = "column";
    sphGrid.style.gap = "6px";

    function addSPHProp(label, getValue, setValue, opts = {}) {
      const row = doc.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "8px";
      row.style.padding = "10px 12px";
      row.style.background = "linear-gradient(180deg, rgba(59,130,246,0.06) 0%, rgba(59,130,246,0.02) 100%)";
      row.style.borderRadius = "8px";
      row.style.border = "1px solid rgba(59,130,246,0.1)";
      if (opts.help) row.title = opts.help;

      const lbl = doc.createElement("span");
      lbl.textContent = label;
      lbl.style.color = "#94a3b8";
      lbl.style.fontSize = "11px";
      lbl.style.fontWeight = "500";
      lbl.style.flex = "0 0 72px";
      lbl.style.userSelect = "none";
      row.appendChild(lbl);

      const sliderWrap = doc.createElement("div");
      sliderWrap.style.flex = "1";
      sliderWrap.style.display = "flex";
      sliderWrap.style.alignItems = "center";

      const accent = opts.accent || "#3b82f6";
      const min = opts.min ?? 0;
      const max = opts.max ?? 1;
      const step = opts.step ?? 0.01;
      const precision = opts.precision ?? 1;

      const sl = doc.createElement("input");
      sl.type = "range";
      sl.min = String(min);
      sl.max = String(max);
      sl.step = String(step);
      sl.value = String(getValue());
      sl.className = "inspector-slider";
      const initPct = ((getValue() - min) / (max - min)) * 100;
      sl.style.cssText = `
        width: 100%; height: 6px; border-radius: 3px;
        background: linear-gradient(90deg, ${accent} 0%, ${accent} ${initPct}%, rgba(255,255,255,0.08) ${initPct}%, rgba(255,255,255,0.08) 100%);
        outline: none; cursor: pointer;
        -webkit-appearance: none; appearance: none;
      `;
      sl.style.setProperty("--slider-accent", accent);
      sl.onmousedown = (e) => e.stopPropagation();
      sl.ontouchstart = (e) => e.stopPropagation();
      sliderWrap.appendChild(sl);
      row.appendChild(sliderWrap);

      const val = doc.createElement("span");
      val.textContent = getValue().toFixed(precision);
      val.style.cssText = `
        color: ${accent}; font-size: 11px;
        font-family: 'JetBrains Mono', monospace; font-weight: 600;
        min-width: 44px; text-align: right;
        padding: 2px 6px; background: rgba(0,0,0,0.3); border-radius: 4px;
        user-select: none;
      `;
      row.appendChild(val);

      sl.oninput = () => {
        const v = parseFloat(sl.value);
        if (!Number.isFinite(v)) return;
        setValue(v);
        val.textContent = v.toFixed(precision);
        const pct = ((v - min) / (max - min)) * 100;
        sl.style.background = `linear-gradient(90deg, ${accent} 0%, ${accent} ${pct}%, rgba(255,255,255,0.08) ${pct}%, rgba(255,255,255,0.08) 100%)`;
      };

      sphGrid.appendChild(row);
    }

    addSPHProp("Density", 
      () => emitterCfg.sphRestDensity ?? 1000,
      (v) => { emitterCfg.sphRestDensity = v; if (typeof onProfileChange === "function") onProfileChange(); },
      { min: 50, max: 5000, step: 50, precision: 0, accent: "#0ea5e9",
        help: "Rest density (kg/m³). Water ~1000, oil ~800, mercury ~13600. Higher = particles pack tighter before repelling." }
    );
    addSPHProp("Viscosity",
      () => emitterCfg.sphViscosity ?? 0.1,
      (v) => { emitterCfg.sphViscosity = v; if (typeof onProfileChange === "function") onProfileChange(); },
      { min: 0, max: 2, step: 0.01, precision: 2, accent: "#8b5cf6",
        help: "Viscosity. Water ~0.001, honey ~2.0, oil ~0.1. Higher = thicker, slower flow." }
    );

    sphContainer.appendChild(sphGrid);
  }
  container.appendChild(sphContainer);

  // Initial profile + badge render
  updateProfile();

  function refresh() {
    // Re-sync select value
    substanceSelect.value = emitterCfg.substance || "";
    if (tempSlider) tempSlider.value = String(emitterCfg.temperature ?? 293);
    if (tempValue) tempValue.textContent = (emitterCfg.temperature ?? 293) + "K";
    if (chargeSlider) chargeSlider.value = String(emitterCfg.substanceCharge ?? 0);
    if (chargeValue) chargeValue.textContent = (emitterCfg.substanceCharge ?? 0).toFixed(1);
    updateProfile();
  }

  return { element: container, refresh };
}
