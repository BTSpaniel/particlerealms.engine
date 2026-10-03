// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { setEntityComponentFromInspector } from "../EntityInspector.js";
import { renderInspectorSchema } from "../ui/InspectorControls.js";
import { degreesToRadians, radiansToDegrees } from "../../../core/math/UnitMath.js";

export function renderLightComponentEditor(doc, container, state) {
  const comp = state.pendingComponentValue || {};
  if (typeof comp.type !== "string") {
    comp.type = "point";
  }
  if (typeof comp.intensity !== "number" || !Number.isFinite(comp.intensity)) {
    comp.intensity = 1.5;
  }
  if (!Array.isArray(comp.color)) {
    comp.color = [1, 1, 1];
  }
  if (!Array.isArray(comp.direction)) {
    comp.direction = [0, -1, 0];
  }
  if (typeof comp.range !== "number" || !Number.isFinite(comp.range)) {
    comp.range = 10;
  }
  if (typeof comp.innerConeAngle !== "number" || !Number.isFinite(comp.innerConeAngle)) {
    comp.innerConeAngle = 0.3;
  }
  if (typeof comp.outerConeAngle !== "number" || !Number.isFinite(comp.outerConeAngle)) {
    comp.outerConeAngle = 0.5;
  }
  state.pendingComponentValue = comp;

  // Container for type-specific controls (will be rebuilt on type change)
  let typeSpecificContainer = null;

  function autoApply() {
    if (state && typeof state.applyPendingComponent === "function") {
      state.applyPendingComponent();
    }
  }

  function rebuildTypeSpecificControls() {
    if (typeSpecificContainer) {
      while (typeSpecificContainer.firstChild) {
        typeSpecificContainer.removeChild(typeSpecificContainer.firstChild);
      }
    }

    const lightType = comp.type;

    const schema = [];
    if (lightType === "directional" || lightType === "spot") {
      schema.push({
        title: "Direction",
        fields: [
          { type: "slider", label: "X", path: "direction.0", min: -1, max: 1, step: 0.01 },
          { type: "slider", label: "Y", path: "direction.1", min: -1, max: 1, step: 0.01 },
          { type: "slider", label: "Z", path: "direction.2", min: -1, max: 1, step: 0.01 },
        ],
      });
    }

    if (lightType === "spot") {
      schema.push({
        title: "Cone Angles",
        fields: [
          {
            type: "slider",
            label: "Inner (°)",
            min: 1,
            max: 90,
            step: 1,
            getValue: () => Math.round(radiansToDegrees(Number(comp.innerConeAngle) || 0.3)),
            setValue: (v) => {
              comp.innerConeAngle = degreesToRadians(Number(v) || 0);
              autoApply();
            },
          },
          {
            type: "slider",
            label: "Outer (°)",
            min: 1,
            max: 90,
            step: 1,
            getValue: () => Math.round(radiansToDegrees(Number(comp.outerConeAngle) || 0.5)),
            setValue: (v) => {
              comp.outerConeAngle = degreesToRadians(Number(v) || 0);
              autoApply();
            },
          },
        ],
      });
    }

    renderInspectorSchema(doc, typeSpecificContainer, schema, {
      model: comp,
      onApply: autoApply,
    });
  }

  const schema = [
    {
      title: "Light",
      fields: [
        {
          type: "select",
          label: "Type",
          path: "type",
          items: [
            { value: "point", label: "point" },
            { value: "directional", label: "directional" },
            { value: "spot", label: "spot" },
          ],
          setValue: (v) => {
            comp.type = v;
            rebuildTypeSpecificControls();
            autoApply();
          },
        },
        { type: "slider", label: "Intensity", path: "intensity", min: 0, max: 20, step: 0.1 },
        { type: "slider", label: "Range", path: "range", min: 0.1, max: 100, step: 0.1 },
      ],
    },
    {
      title: "Color",
      fields: [
        { type: "slider", label: "Red", path: "color.0", min: 0, max: 2, step: 0.01 },
        { type: "slider", label: "Green", path: "color.1", min: 0, max: 2, step: 0.01 },
        { type: "slider", label: "Blue", path: "color.2", min: 0, max: 2, step: 0.01 },
      ],
    },
  ];

  renderInspectorSchema(doc, container, schema, {
    model: comp,
    onApply: autoApply,
  });

  // Create container for type-specific controls
  typeSpecificContainer = doc.createElement("div");
  container.appendChild(typeSpecificContainer);

  // Build initial type-specific controls
  rebuildTypeSpecificControls();
}
