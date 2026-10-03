// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { setEntityComponentFromInspector } from "../EntityInspector.js";
import { renderInspectorSchema } from "../ui/InspectorControls.js";
import { INSPECTOR_THEME } from "../ui/InspectorTheme.js";

/**
 * Physical Material Component Editor — renders preset dropdown + property sliders
 * for density, elasticity, hardness, brittleness, strength, friction, restitution,
 * deformable/breakable flags, fracture pattern, and damage status.
 */
export function renderPhysicalMaterialComponentEditor(doc, container, state) {
  const comp = state.pendingComponentValue || {};

  // Ensure defaults
  if (typeof comp.density !== "number") comp.density = 2500;
  if (typeof comp.elasticity !== "number") comp.elasticity = 0.08;
  if (typeof comp.hardness !== "number") comp.hardness = 0.80;
  if (typeof comp.tensileStrength !== "number") comp.tensileStrength = 0.50;
  if (typeof comp.brittleness !== "number") comp.brittleness = 0.75;
  if (typeof comp.friction !== "number") comp.friction = 0.65;
  if (typeof comp.restitution !== "number") comp.restitution = 0.10;
  if (typeof comp.deformable !== "boolean") comp.deformable = false;
  if (typeof comp.breakable !== "boolean") comp.breakable = true;
  if (typeof comp.fracturePattern !== "string") comp.fracturePattern = "RADIAL";
  if (typeof comp.maxFragments !== "number") comp.maxFragments = 10;
  if (typeof comp.damageThreshold !== "number") comp.damageThreshold = 0.50;
  if (typeof comp.currentDamage !== "number") comp.currentDamage = 0;
  state.pendingComponentValue = comp;

  function autoApply() {
    if (state && typeof state.applyPendingComponent === "function") {
      state.applyPendingComponent();
    }
  }

  // Preset selector (loads all values from preset)
  const presetKeys = [
    "steel","iron","aluminum","wood","rubber","glass",
    "stone","concrete","plastic","foam","ice","ceramic"
  ];
  const presetItems = presetKeys.map(k => ({
    value: k,
    label: k[0].toUpperCase() + k.slice(1),
  }));

  const schema = [
    {
      title: "Material Preset",
      fields: [
        {
          type: "select",
          label: "Preset",
          items: presetItems,
          getValue: () => comp._presetKey || "stone",
          setValue: async (v) => {
            try {
              const { createPhysicalMaterial } = await import(
                "../../../sim/physics/PhysicalMaterialPresets.js"
              );
              const preset = createPhysicalMaterial(v);
              // Preserve damage state
              preset.currentDamage = comp.currentDamage || 0;
              // Copy all preset values into comp
              Object.assign(comp, preset);
              state.pendingComponentValue = comp;
              autoApply();
              // Rebuild UI to reflect new values
              while (container.firstChild) container.removeChild(container.firstChild);
              renderPhysicalMaterialComponentEditor(doc, container, state);
            } catch (_) {
              comp._presetKey = v;
              autoApply();
            }
          },
        },
      ],
    },
    {
      title: "Surface",
      fields: [
        { type: "slider", label: "Friction", path: "friction", min: 0, max: 1, step: 0.05 },
        { type: "slider", label: "Restitution (Bounce)", path: "restitution", min: 0, max: 1, step: 0.05 },
      ],
    },
    {
      title: "Structural",
      fields: [
        { type: "slider", label: "Density (kg/m³)", path: "density", min: 1, max: 20000, step: 10 },
        { type: "slider", label: "Hardness", path: "hardness", min: 0, max: 1, step: 0.05 },
        { type: "slider", label: "Strength", path: "tensileStrength", min: 0, max: 1, step: 0.05 },
        { type: "slider", label: "Brittleness", path: "brittleness", min: 0, max: 1, step: 0.05 },
      ],
    },
    {
      title: "Deformation",
      fields: [
        { type: "slider", label: "Elasticity (Flex)", path: "elasticity", min: 0, max: 1, step: 0.05 },
        { type: "checkbox", label: "Deformable", path: "deformable" },
        { type: "checkbox", label: "Breakable", path: "breakable" },
      ],
    },
    {
      title: "Fracture",
      fields: [
        {
          type: "select",
          label: "Pattern",
          path: "fracturePattern",
          items: [
            { value: "SHATTER", label: "Shatter" },
            { value: "RADIAL", label: "Radial" },
            { value: "COLUMNAR", label: "Columnar" },
            { value: "BRICK", label: "Brick" },
          ],
        },
        { type: "slider", label: "Max Fragments", path: "maxFragments", min: 2, max: 32, step: 1 },
        { type: "slider", label: "Damage Threshold", path: "damageThreshold", min: 0, max: 1, step: 0.05 },
      ],
    },
  ];

  renderInspectorSchema(doc, container, schema, {
    model: comp,
    onApply: autoApply,
  });

  // Damage bar (read-only status)
  const dmg = comp.currentDamage || 0;
  const dmgPct = Math.round(dmg * 100);
  const barColor = dmg > 0.7 ? "#e44" : dmg > 0.3 ? "#ea4" : "#4a4";

  const statusSection = doc.createElement("div");
  statusSection.style.cssText = "padding:8px 12px;";
  statusSection.innerHTML = `
    <div style="font-size:11px;color:${INSPECTOR_THEME?.textMuted || '#999'};margin-bottom:4px;">
      Damage: ${dmgPct}%
    </div>
    <div style="background:#222;border-radius:3px;height:6px;overflow:hidden">
      <div style="background:${barColor};height:100%;width:${dmgPct}%;transition:width 0.3s"></div>
    </div>
  `;
  container.appendChild(statusSection);
}
