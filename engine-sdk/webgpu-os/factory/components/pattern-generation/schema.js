// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Domains supply their own design catalog; Factory validates physical inputs. */
export function getPatternDesignSchema(id, designs) {
  if (!Array.isArray(designs)) throw new TypeError('Provide the pattern domain design catalog.');
  const design = designs.find(item => item.id === id);
  if (!design) throw new TypeError('Choose a supported pattern design. Saved patterns from a retired generator remain editable.');
  return design;
}

export function validatePatternGeneration(request = {}, design) {
  if (!design || request.design !== design.id || !Array.isArray(design.measurements)) throw new TypeError('The request does not match its pattern design.');
  const measurements = {};
  for (const field of design.measurements) {
    const value = request.measurements?.[field.id];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max) {
      throw new TypeError(`Enter ${field.label.toLowerCase()} in ${field.unit} (${field.min}–${field.max}).`);
    }
    measurements[field.id] = value;
  }
  const definitions = design.options || {}, options = {}, supplied = request.options || {};
  if (typeof supplied !== 'object' || Array.isArray(supplied)) throw new TypeError('Pattern options must be a named record.');
  for (const name of Object.keys(supplied)) if (!Object.hasOwn(definitions, name)) throw new TypeError(`Unsupported pattern option: ${name}`);
  for (const [name, field] of Object.entries(definitions)) {
    const value = Object.hasOwn(supplied, name) ? supplied[name] : field.default;
    if (value === undefined) continue;
    if (field.type === 'boolean' ? typeof value !== 'boolean' : field.type !== 'number' || typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max) {
      throw new TypeError(`Enter a supported value for ${(field.label || name).toLowerCase()}.`);
    }
    options[name] = value;
  }
  const seamAllowanceMm = request.seamAllowanceMm ?? 10;
  if (typeof seamAllowanceMm !== 'number' || !Number.isFinite(seamAllowanceMm) || seamAllowanceMm < 0 || seamAllowanceMm > 50) throw new RangeError('Seam allowance must be between 0 and 50 mm.');
  return { design: design.id, measurements, options, seamAllowanceMm };
}
