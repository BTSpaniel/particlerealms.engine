// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";
import { CAMERA_SCHEMA, normalizeBySchema, getSchemaDefaults } from "../EntitySchema.js";

const defaults = getSchemaDefaults(CAMERA_SCHEMA);

function normalize(input) {
  return normalizeBySchema(CAMERA_SCHEMA, input);
}

function validate(value) {
  const out = normalize(value);
  if (out.near >= out.far) {
    out.far = out.near + 0.01;
  }
  return out;
}

export const CameraDefinition = defineComponentType({
  name: "Camera",
  version: 1,
  schema: CAMERA_SCHEMA,
  defaults,
  normalize,
  validate,
});

export function createCamera(initial) {
  return CameraDefinition.create(initial);
}
