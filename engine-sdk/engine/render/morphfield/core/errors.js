// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export class MorphFieldError extends Error {
  constructor(code, message, details = undefined, options = undefined) {
    super(message, options);
    this.name = 'MorphFieldError';
    this.code = String(code || 'MORPHFIELD_ERROR');
    if (details !== undefined) this.details = details;
  }
}

export function failMorphField(code, message, details = undefined) {
  throw new MorphFieldError(code, message, details);
}

export function invariant(condition, code, message, details = undefined) {
  if (!condition) failMorphField(code, message, details);
}

export function asMorphFieldError(error, code, message, details = undefined) {
  if (error instanceof MorphFieldError) return error;
  return new MorphFieldError(code, message, details, { cause: error });
}

