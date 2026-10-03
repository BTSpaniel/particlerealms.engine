// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { generateNativeFittedBlock } from './fitted-blocks.js';

// Synchronous domain geometry runs inside the existing cancellable Factory job.
// Measurements stay in the request/result; diagnostic events never log them.
self.onmessage = event => {
  const { id, input } = event.data || {};
  try { self.postMessage({ id, result: generateNativeFittedBlock(input) }); }
  catch (error) { self.postMessage({ id, error: { name: error.name || 'Error', message: error.message || 'The fitting block could not be drafted from these inputs.' } }); }
};
