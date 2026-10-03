// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";

const defaults = {
  axes: {
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
  },
  buttons: {
    jump: false,
    sprint: false,
    primary: false,
    secondary: false,
  },
  lastUpdateTime: 0,
};

function normalizeAxes(srcAxes) {
  const a = srcAxes && typeof srcAxes === "object" ? srcAxes : {};
  function n(value) {
    const v = Number(value);
    return Number.isFinite(v) ? v : 0;
  }
  return {
    moveX: n(a.moveX),
    moveY: n(a.moveY),
    lookX: n(a.lookX),
    lookY: n(a.lookY),
  };
}

function normalizeButtons(srcButtons) {
  const b = srcButtons && typeof srcButtons === "object" ? srcButtons : {};
  function f(value) {
    return typeof value === "boolean" ? value : false;
  }
  return {
    jump: f(b.jump),
    sprint: f(b.sprint),
    primary: f(b.primary),
    secondary: f(b.secondary),
  };
}

function normalize(input) {
  const src = input && typeof input === "object" ? input : {};
  const timeValue = Number(src.lastUpdateTime);
  return {
    axes: normalizeAxes(src.axes),
    buttons: normalizeButtons(src.buttons),
    lastUpdateTime: Number.isFinite(timeValue)
      ? timeValue
      : defaults.lastUpdateTime,
  };
}

function validate(value) {
  return normalize(value);
}

export const InputDefinition = defineComponentType({
  name: "Input",
  version: 1,
  defaults,
  normalize,
  validate,
});

export function createInput(initial) {
  return InputDefinition.create(initial);
}
