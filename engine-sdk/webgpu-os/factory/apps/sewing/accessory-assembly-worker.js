// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { prepareAccessoryAssembly } from './accessory-cloth.js';
self.onmessage = async ({ data }) => {
  try { self.postMessage({ id: data.id, result: await prepareAccessoryAssembly(data.input.draft, data.input.options) }); }
  catch (error) { console.debug('[Sewing][accessory-assembly][rejected]', error.code, JSON.stringify(error.details || null)); self.postMessage({ id: data.id, error: { name: error.name, code: error.code || 'ASSEMBLY_ERROR', message: error.message } }); }
};
