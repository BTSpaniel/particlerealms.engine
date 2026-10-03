// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { evaluateExactExpression } from '../../../../engine/core/math/ExactCalculatorCore.js';

const UNIT_META = Object.freeze({
    px: Object.freeze({ label: 'Pixels', suffix: 'px', pixelsPerUnit: () => 1 }),
    in: Object.freeze({ label: 'Inches', suffix: 'in', pixelsPerUnit: dpi => Math.max(1, Number(dpi) || 72) }),
    cm: Object.freeze({ label: 'Centimetres', suffix: 'cm', pixelsPerUnit: dpi => Math.max(1, Number(dpi) || 72) / 2.54 }),
    mm: Object.freeze({ label: 'Millimetres', suffix: 'mm', pixelsPerUnit: dpi => Math.max(1, Number(dpi) || 72) / 25.4 }),
});

export function measurementUnit(unit) {
    return UNIT_META[unit] ?? UNIT_META.px;
}

export function pixelsToUnits(pixels, dpi, unit = 'px') {
    return Number(pixels || 0) / measurementUnit(unit).pixelsPerUnit(dpi);
}

export function unitsToPixels(value, dpi, unit = 'px') {
    return Number(value || 0) * measurementUnit(unit).pixelsPerUnit(dpi);
}

export function formatMeasurement(pixels, dpi, unit = 'px', { suffix = true, precision = null } = {}) {
    const meta = measurementUnit(unit);
    const value = pixelsToUnits(pixels, dpi, unit);
    const digits = precision ?? (unit === 'px' ? 0 : value >= 100 ? 1 : value >= 10 ? 2 : 3);
    const text = new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value);
    return suffix ? `${text} ${meta.suffix}` : text;
}

export function documentMeasurements(document, unit = 'px') {
    const dpi = Math.max(1, Number(document?.dpi) || 72);
    const width = Math.max(1, Number(document?.width) || 1);
    const height = Math.max(1, Number(document?.height) || 1);
    return {
        unit: measurementUnit(unit),
        width,
        height,
        dpi,
        aspect: width / height,
        physicalWidth: formatMeasurement(width, dpi, unit),
        physicalHeight: formatMeasurement(height, dpi, unit),
        printWidthInches: pixelsToUnits(width, dpi, 'in'),
        printHeightInches: pixelsToUnits(height, dpi, 'in'),
    };
}

export function rulerStepPixels(zoom, dpi, unit) {
    const minimumScreenPixels = 72;
    const minimumUnits = minimumScreenPixels / Math.max(.01, Number(zoom) || 1) / measurementUnit(unit).pixelsPerUnit(dpi);
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(minimumUnits, .000001)));
    const normalized = minimumUnits / magnitude;
    const stepUnits = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return stepUnits * magnitude * measurementUnit(unit).pixelsPerUnit(dpi);
}

export function formatAspectRatio(width, height) {
    const w = Math.max(1, Math.round(Number(width) || 1));
    const h = Math.max(1, Math.round(Number(height) || 1));
    const divisor = greatestCommonDivisor(w, h);
    return `${w / divisor}:${h / divisor}`;
}

function greatestCommonDivisor(a, b) {
    let x = Math.abs(a);
    let y = Math.abs(b);
    while (y) [x, y] = [y, x % y];
    return x || 1;
}

const FRACTIONS = Object.freeze({ '¼': '1/4', '½': '1/2', '¾': '3/4', '⅐': '1/7', '⅑': '1/9', '⅒': '1/10', '⅓': '1/3', '⅔': '2/3', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8', '↉': '0/3' });
const LENGTH_FACTORS = Object.freeze({ mm: '1', cm: '10', in: '127/5' });

/** Parse physical lengths without display rounding. Exact rational strings are JSON-safe. */
export function parseLengthInput(input, { defaultUnit = 'mm', min = -Infinity, max = Infinity } = {}) {
  if (!Object.hasOwn(LENGTH_FACTORS, defaultUnit)) throw new TypeError('Length unit must be mm, cm or in');
  if (typeof min !== 'number' || typeof max !== 'number' || Number.isNaN(min) || Number.isNaN(max) || min > max) throw new TypeError('Invalid physical length range');
  if (typeof input !== 'string' && typeof input !== 'number') throw new TypeError('Enter a physical length');
  let source = String(input).trim();
  if (!source || source.length > 256) throw new TypeError('Enter a length of at most 256 characters');
  source = source.replace(/−/g, '-').replace(/⁄/g, '/').replace(/[\u00a0\u202f]/g, ' ');
  const suffix = source.match(/\s*(mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|in|inch(?:es)?|["″”])$/i);
  let unit = defaultUnit;
  if (suffix) {
    const token = suffix[1].toLowerCase();
    unit = token === 'mm' || token.startsWith('milli') ? 'mm' : token === 'cm' || token.startsWith('centi') ? 'cm' : 'in';
    source = source.slice(0, suffix.index).trim();
  }
  source = source.replace(/[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞↉]/g, value => ` ${FRACTIONS[value]}`).trim();
  const mixed = source.match(/^([+-]?)(\d+)(?:\s+|\s*-\s*)(\d+)\s*\/\s*(\d+)$/);
  let expression;
  if (mixed) {
    if (BigInt(mixed[4]) === 0n || BigInt(mixed[3]) >= BigInt(mixed[4])) throw new TypeError('A mixed fraction needs a nonzero denominator and a proper fraction');
    expression = `${mixed[1]}(${mixed[2]}+${mixed[3]}/${mixed[4]})`;
  } else if (/^[+-]?\s*\d+\s*\/\s*\d+$/.test(source)) expression = source;
  else if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d{1,3})?$/i.test(source)) expression = source;
  else throw new TypeError('Use a decimal or fraction followed by mm, cm or in');
  const exact = evaluateExactExpression(`(${expression})*(${LENGTH_FACTORS[unit]})`).value;
  const numerator = exact.type === 'Integer' ? exact.value : exact.numerator;
  const denominator = exact.type === 'Integer' ? '1' : exact.denominator;
  const valueMm = Number(numerator) / Number(denominator);
  if (!Number.isFinite(valueMm) || valueMm === 0 && BigInt(numerator) !== 0n || valueMm < min || valueMm > max) throw new RangeError('Length is outside the supported range');
  return { valueMm, exactMm: { numerator, denominator }, unit };
}

/** Formatting is presentation only; callers retain the unrounded millimetre value. */
export function formatPhysicalLength(valueMm, { unit = 'mm', precision = 2, suffix = true } = {}) {
  if (!Number.isFinite(valueMm) || !Object.hasOwn(LENGTH_FACTORS, unit)) throw new TypeError('Invalid physical length');
  return formatMeasurement(valueMm, 25.4, unit, { suffix, precision });
}
