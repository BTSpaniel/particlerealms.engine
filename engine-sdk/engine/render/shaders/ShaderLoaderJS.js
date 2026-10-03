// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { ShaderSources } from "./ShaderSources.js";

export function getShaderSource(name) {
  const code = ShaderSources[name];
  if (!code) {
    throw new Error(`Shader source not found: ${name}`);
  }
  return code;
}
