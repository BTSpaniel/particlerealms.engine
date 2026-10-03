// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { renderInspectorSchema } from "../ui/InspectorControls.js";
import { positiveSafeEntityHandleReport } from "../../../ecs/world/World.js";

export function renderCameraComponentEditor(doc, container, state) {
  const comp = state.pendingComponentValue || {};
  if (typeof comp.fov !== "number" || !Number.isFinite(comp.fov)) {
    comp.fov = 60;
  }
  if (typeof comp.near !== "number" || !Number.isFinite(comp.near)) {
    comp.near = 0.1;
  }
  if (typeof comp.far !== "number" || !Number.isFinite(comp.far)) {
    comp.far = 1000;
  }
  if (typeof comp.exposure !== "number" || !Number.isFinite(comp.exposure)) {
    comp.exposure = 1.0;
  }
  if (typeof comp.active !== "boolean") {
    comp.active = true;
  }
  if (typeof comp.projection !== "string") {
    comp.projection = "perspective";
  }
  if (typeof comp.mode !== "string") {
    comp.mode = "free";
  }
  state.pendingComponentValue = comp;

  function autoApply() {
    if (state && typeof state.applyPendingComponent === "function") {
      state.applyPendingComponent();
    }
  }

  const schema = [
    {
      title: "Camera",
      fields: [
        { type: "slider", label: "Field of View", path: "fov", min: 20, max: 120, step: 1 },
        { type: "number", label: "Near Clip", path: "near", step: 0.01 },
        { type: "number", label: "Far Clip", path: "far", step: 1 },
        { type: "slider", label: "Exposure", path: "exposure", min: 0, max: 5, step: 0.05 },
        { type: "checkbox", label: "Active", path: "active" },
        {
          type: "select",
          label: "Projection",
          path: "projection",
          items: [
            { value: "perspective", label: "perspective" },
            { value: "orthographic", label: "orthographic" },
          ],
        },
        { type: "text", label: "Mode", path: "mode" },
        {
          type: "number",
          label: "Target Entity",
          step: 1,
          getValue: () => {
            const report = positiveSafeEntityHandleReport(comp.targetEntity);
            return report.valid ? report.value : 0;
          },
          setValue: (v) => {
            const n = Number(v);
            const report = positiveSafeEntityHandleReport(n);
            comp.targetEntity = report.valid ? report.value : null;
            autoApply();
          },
        },
      ],
    },
  ];

  renderInspectorSchema(doc, container, schema, {
    model: comp,
    onApply: autoApply,
  });
}
