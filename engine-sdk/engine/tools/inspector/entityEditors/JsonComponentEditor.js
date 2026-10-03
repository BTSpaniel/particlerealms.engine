// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createPropertySection } from "../ui/InspectorControls.js";

export function renderJsonComponentEditor(doc, container, editor, value) {
  const section = createPropertySection(doc, container, "Raw Component JSON");
  let text = "";
  try {
    text = JSON.stringify(value, null, 2);
  } catch (e) {
    text = String(value);
  }
  editor.value = text;
  section.appendChild(editor);
}
