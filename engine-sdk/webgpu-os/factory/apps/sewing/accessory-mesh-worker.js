// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { createAccessoryPatternMeshes } from './accessory-meshes.js';

self.onmessage = ({ data }) => {
  const { id, input } = data;
  try { self.postMessage({ id, result: createAccessoryPatternMeshes(input.draft, input.options) }); }
  catch (error) { self.postMessage({ id, error: { name: error.name || 'Error', code: error.code, message: error.message || String(error) } }); }
};
