// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathValidation.js - reusable finite, range, alignment, histogram, and probability reports.

const DEFAULT_TOLERANCE = 1e-9;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function finiteOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isNaN(number) ? fallback : number;
}

function arrayLikeLength(values, name) {
  if (!values || typeof values.length !== 'number') {
    return { valid: false, length: 0, error: `${name} must be array-like` };
  }
  const length = Math.trunc(values.length);
  if (length < 0 || length !== values.length) {
    return { valid: false, length: 0, error: `${name}.length must be a nonnegative integer` };
  }
  return { valid: true, length, error: '' };
}

function rangeBounds(min, max) {
  const a = boundOrDefault(min, 0);
  const b = boundOrDefault(max, a);
  return {
    min: Math.min(a, b),
    max: Math.max(a, b),
    reversed: a > b,
  };
}

function pushError(errors, message, limit) {
  if (errors.length < limit) errors.push(message);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function valueKind(value) {
  if (value === null) return 'null';
  if (ArrayBuffer.isView(value) || Array.isArray(value)) return 'array';
  return typeof value;
}

function schemaChildPath(path, key) {
  return typeof key === 'number' ? `${path}[${key}]` : `${path}.${key}`;
}

function schemaError(errors, path, message, limit) {
  pushError(errors, `${path}: ${message}`, limit);
}

function primitiveSchemaReport(valid, path, type, errors, details = {}) {
  return {
    valid,
    path,
    type,
    actualType: details.actualType ?? '',
    errors,
    ...details,
  };
}

export function finiteNumberReport(value, options = {}) {
  const allowInteger = options.integer === true;
  const allowNegativeZero = options.allowNegativeZero !== false;
  const bounds = options.min !== undefined || options.max !== undefined
    ? rangeBounds(options.min ?? -Infinity, options.max ?? Infinity)
    : null;
  const validType = typeof value === 'number';
  const finite = Number.isFinite(value);
  const integer = Number.isInteger(value);
  const negativeZero = Object.is(value, -0);
  const inRange = !bounds || (finite && value >= bounds.min && value <= bounds.max);
  const valid = validType && finite && (!allowInteger || integer) && (allowNegativeZero || !negativeZero) && inRange;

  return {
    valid,
    value,
    type: typeof value,
    finite,
    integer,
    negativeZero,
    min: bounds?.min ?? -Infinity,
    max: bounds?.max ?? Infinity,
    inRange,
    reason: valid
      ? 'valid'
      : (!validType ? 'not-number' : (!finite ? 'non-finite' : (allowInteger && !integer ? 'not-integer' : (!inRange ? 'out-of-range' : 'negative-zero')))),
  };
}

export function finiteArrayReport(values, options = {}) {
  const meta = arrayLikeLength(values, 'values');
  const maxErrors = Math.max(0, Math.trunc(finiteOrDefault(options.maxErrors, 16)));
  const errors = [];
  if (!meta.valid) {
    return {
      valid: false,
      count: 0,
      finiteCount: 0,
      nanCount: 0,
      infiniteCount: 0,
      nonNumberCount: 0,
      outOfRangeCount: 0,
      min: 0,
      max: 0,
      errors: [meta.error],
    };
  }

  const bounds = options.min !== undefined || options.max !== undefined
    ? rangeBounds(options.min ?? -Infinity, options.max ?? Infinity)
    : null;
  const expectedLength = options.expectedLength === undefined ? null : Math.trunc(finiteOrDefault(options.expectedLength, -1));
  const allowEmpty = options.allowEmpty === true;
  const integer = options.integer === true;
  let finiteCount = 0;
  let nanCount = 0;
  let infiniteCount = 0;
  let nonNumberCount = 0;
  let outOfRangeCount = 0;
  let nonIntegerCount = 0;
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < meta.length; i++) {
    const value = values[i];
    if (typeof value !== 'number') {
      nonNumberCount += 1;
      pushError(errors, `values[${i}] is not a number`, maxErrors);
      continue;
    }
    if (Number.isNaN(value)) {
      nanCount += 1;
      pushError(errors, `values[${i}] is NaN`, maxErrors);
      continue;
    }
    if (!Number.isFinite(value)) {
      infiniteCount += 1;
      pushError(errors, `values[${i}] is infinite`, maxErrors);
      continue;
    }
    if (integer && !Number.isInteger(value)) {
      nonIntegerCount += 1;
      pushError(errors, `values[${i}] is not an integer`, maxErrors);
    }
    if (bounds && (value < bounds.min || value > bounds.max)) {
      outOfRangeCount += 1;
      pushError(errors, `values[${i}] is outside [${bounds.min}, ${bounds.max}]`, maxErrors);
    }
    finiteCount += 1;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const lengthMatches = expectedLength === null || meta.length === expectedLength;
  if (!lengthMatches) pushError(errors, `values.length ${meta.length} !== expectedLength ${expectedLength}`, maxErrors);
  const nonEmpty = allowEmpty || meta.length > 0;
  if (!nonEmpty) pushError(errors, 'values must be non-empty', maxErrors);

  return {
    valid: nonEmpty && lengthMatches && finiteCount === meta.length && outOfRangeCount === 0 && nonIntegerCount === 0,
    count: meta.length,
    expectedLength,
    finiteCount,
    nanCount,
    infiniteCount,
    nonNumberCount,
    outOfRangeCount,
    nonIntegerCount,
    min: finiteCount > 0 ? min : 0,
    max: finiteCount > 0 ? max : 0,
    errors,
  };
}

export function rangeValidationReport(value, min, max, options = {}) {
  const bounds = rangeBounds(min, max);
  const inclusive = options.inclusive !== false;
  const finite = finiteNumber(value);
  const inRange = finite && (inclusive
    ? value >= bounds.min && value <= bounds.max
    : value > bounds.min && value < bounds.max);
  return {
    valid: inRange,
    value,
    finite,
    min: bounds.min,
    max: bounds.max,
    inclusive,
    reversed: bounds.reversed,
    span: bounds.max - bounds.min,
    inRange,
  };
}

export function alignmentReport(offset, alignment, options = {}) {
  const byteLength = finiteOrDefault(options.byteLength, 0);
  const baseOffset = finiteOrDefault(options.baseOffset, 0);
  const offsetValue = finiteOrDefault(offset, NaN);
  const alignmentValue = finiteOrDefault(alignment, NaN);
  const finite = Number.isFinite(offsetValue) && Number.isFinite(alignmentValue) && Number.isFinite(byteLength);
  const integer = Number.isInteger(offsetValue) && Number.isInteger(alignmentValue) && Number.isInteger(byteLength);
  const positiveAlignment = alignmentValue > 0;
  const relativeOffset = offsetValue - baseOffset;
  const aligned = finite && integer && positiveAlignment && relativeOffset >= 0 && relativeOffset % alignmentValue === 0;
  const padding = finite && integer && positiveAlignment
    ? (alignmentValue - (Math.max(0, relativeOffset) % alignmentValue)) % alignmentValue
    : 0;
  const endOffset = offsetValue + byteLength;

  return {
    valid: aligned && byteLength >= 0,
    offset: offsetValue,
    alignment: alignmentValue,
    baseOffset,
    byteLength,
    endOffset,
    finite,
    integer,
    positiveAlignment,
    aligned,
    padding,
    alignedOffset: offsetValue + padding,
  };
}

export function powerOfTwoReport(value) {
  const integer = Number.isInteger(value);
  const safeInteger = Number.isSafeInteger(value);
  const positive = safeInteger && value > 0;
  const powerOfTwo = positive && Number.isInteger(Math.log2(value));
  return {
    valid: powerOfTwo,
    value,
    integer,
    safeInteger,
    positive,
    powerOfTwo,
  };
}

export function histogramValidationReport(histogram, options = {}) {
  const meta = arrayLikeLength(histogram, 'histogram');
  const maxErrors = Math.max(0, Math.trunc(finiteOrDefault(options.maxErrors, 16)));
  const errors = [];
  if (!meta.valid) {
    return {
      valid: false,
      binCount: 0,
      sampleCount: 0,
      nonFiniteCount: 0,
      negativeCount: 0,
      nonIntegerCount: 0,
      zeroBinCount: 0,
      errors: [meta.error],
    };
  }

  const expectedBins = options.expectedBins === undefined ? null : Math.trunc(finiteOrDefault(options.expectedBins, -1));
  const requireInteger = options.integer !== false;
  const allowEmpty = options.allowEmpty === true;
  let sampleCount = 0;
  let nonFiniteCount = 0;
  let negativeCount = 0;
  let nonIntegerCount = 0;
  let zeroBinCount = 0;

  for (let i = 0; i < meta.length; i++) {
    const value = Number(histogram[i]);
    if (!Number.isFinite(value)) {
      nonFiniteCount += 1;
      pushError(errors, `histogram[${i}] is non-finite`, maxErrors);
      continue;
    }
    if (value < 0) {
      negativeCount += 1;
      pushError(errors, `histogram[${i}] is negative`, maxErrors);
    }
    if (requireInteger && !Number.isInteger(value)) {
      nonIntegerCount += 1;
      pushError(errors, `histogram[${i}] is not an integer`, maxErrors);
    }
    if (value === 0) zeroBinCount += 1;
    if (value > 0) sampleCount += value;
  }

  const binCountMatches = expectedBins === null || meta.length === expectedBins;
  if (!binCountMatches) pushError(errors, `histogram.length ${meta.length} !== expectedBins ${expectedBins}`, maxErrors);
  const nonEmpty = allowEmpty || sampleCount > 0;
  if (!nonEmpty) pushError(errors, 'histogram must have positive sample count', maxErrors);

  return {
    valid: nonEmpty && binCountMatches && nonFiniteCount === 0 && negativeCount === 0 && nonIntegerCount === 0,
    binCount: meta.length,
    expectedBins,
    sampleCount,
    nonFiniteCount,
    negativeCount,
    nonIntegerCount,
    zeroBinCount,
    errors,
  };
}

export function probabilityDistributionReport(probabilities, options = {}) {
  const meta = arrayLikeLength(probabilities, 'probabilities');
  const maxErrors = Math.max(0, Math.trunc(finiteOrDefault(options.maxErrors, 16)));
  const tolerance = Math.max(0, finiteOrDefault(options.tolerance, DEFAULT_TOLERANCE));
  const errors = [];
  if (!meta.valid) {
    return {
      valid: false,
      count: 0,
      sum: 0,
      sumError: 1,
      nonFiniteCount: 0,
      negativeCount: 0,
      aboveOneCount: 0,
      errors: [meta.error],
    };
  }

  const allowEmpty = options.allowEmpty === true;
  const expectedLength = options.expectedLength === undefined ? null : Math.trunc(finiteOrDefault(options.expectedLength, -1));
  let sum = 0;
  let nonFiniteCount = 0;
  let negativeCount = 0;
  let aboveOneCount = 0;

  for (let i = 0; i < meta.length; i++) {
    const value = Number(probabilities[i]);
    if (!Number.isFinite(value)) {
      nonFiniteCount += 1;
      pushError(errors, `probabilities[${i}] is non-finite`, maxErrors);
      continue;
    }
    if (value < -tolerance) {
      negativeCount += 1;
      pushError(errors, `probabilities[${i}] is negative`, maxErrors);
    }
    if (value > 1 + tolerance) {
      aboveOneCount += 1;
      pushError(errors, `probabilities[${i}] is above 1`, maxErrors);
    }
    sum += value;
  }

  const lengthMatches = expectedLength === null || meta.length === expectedLength;
  if (!lengthMatches) pushError(errors, `probabilities.length ${meta.length} !== expectedLength ${expectedLength}`, maxErrors);
  const nonEmpty = allowEmpty || meta.length > 0;
  if (!nonEmpty) pushError(errors, 'probabilities must be non-empty', maxErrors);
  const sumError = Math.abs(sum - 1);
  if (sumError > tolerance) pushError(errors, `probability sum drift ${sumError} exceeds tolerance ${tolerance}`, maxErrors);

  return {
    valid: nonEmpty && lengthMatches && nonFiniteCount === 0 && negativeCount === 0 && aboveOneCount === 0 && sumError <= tolerance,
    count: meta.length,
    expectedLength,
    sum,
    sumError,
    tolerance,
    nonFiniteCount,
    negativeCount,
    aboveOneCount,
    errors,
  };
}

export function typedArrayLayoutReport(view, options = {}) {
  const validView = ArrayBuffer.isView(view);
  const byteAlignment = Math.trunc(finiteOrDefault(options.byteAlignment, view?.BYTES_PER_ELEMENT ?? 1));
  const byteOffset = validView ? view.byteOffset : 0;
  const byteLength = validView ? view.byteLength : 0;
  const alignment = alignmentReport(byteOffset, byteAlignment, { byteLength });
  const elementMultiple = Math.max(1, Math.trunc(finiteOrDefault(options.elementMultiple, 1)));
  const length = validView ? view.length : 0;
  const lengthAligned = validView && length % elementMultiple === 0;

  return {
    valid: validView && alignment.valid && lengthAligned,
    isView: validView,
    constructorName: validView ? view.constructor.name : '',
    byteOffset,
    byteLength,
    length,
    bytesPerElement: validView ? view.BYTES_PER_ELEMENT : 0,
    byteAlignment,
    elementMultiple,
    lengthAligned,
    alignment,
  };
}

export function vectorValidationReport(values, options = {}) {
  const expectedLength = options.dimension ?? options.expectedLength ?? null;
  const tolerance = Math.max(0, finiteOrDefault(options.tolerance, 1e-6));
  const zeroTolerance = Math.max(0, finiteOrDefault(options.zeroTolerance, tolerance));
  const allowZero = options.allowZero !== false;
  const requireUnit = options.requireUnit === true || options.unit === true || options.normalized === true;
  const finiteOptions = {
    allowEmpty: options.allowEmpty,
    min: options.componentMin ?? options.min,
    max: options.componentMax ?? options.max,
    maxErrors: options.maxErrors,
  };
  if (expectedLength !== null) finiteOptions.expectedLength = expectedLength;
  const finite = finiteArrayReport(values, finiteOptions);
  let magnitudeSquared = 0;
  if (finite.count > 0) {
    for (let i = 0; i < finite.count; i += 1) {
      const value = Number(values[i]);
      if (Number.isFinite(value)) magnitudeSquared += value * value;
    }
  }
  const magnitude = Math.sqrt(magnitudeSquared);
  const unitLengthError = Math.abs(magnitude - 1);
  const zero = magnitude <= zeroTolerance;
  const normalized = finite.valid && unitLengthError <= tolerance;
  const errors = [...finite.errors];
  if (!allowZero && zero) pushError(errors, 'vector magnitude must be nonzero', Math.max(0, Math.trunc(finiteOrDefault(options.maxErrors, 16))));
  if (requireUnit && !normalized) pushError(errors, `vector magnitude ${magnitude} is outside unit tolerance ${tolerance}`, Math.max(0, Math.trunc(finiteOrDefault(options.maxErrors, 16))));

  return {
    valid: finite.valid && (allowZero || !zero) && (!requireUnit || normalized),
    dimension: finite.count,
    expectedLength,
    finite: finite.valid,
    finiteReport: finite,
    magnitudeSquared,
    magnitude,
    zero,
    normalized,
    unitLengthError,
    tolerance,
    zeroTolerance,
    requireUnit,
    allowZero,
    errors,
  };
}

export function unitVectorReport(values, options = {}) {
  return vectorValidationReport(values, {
    ...options,
    requireUnit: true,
    allowZero: false,
  });
}

function colorValuesFromInput(color) {
  if (ArrayBuffer.isView(color) || Array.isArray(color)) {
    return {
      values: Array.from(color),
      source: 'array',
      alphaProvided: color.length >= 4,
    };
  }
  if (color && typeof color === 'object') {
    const red = color.r ?? color.red;
    const green = color.g ?? color.green;
    const blue = color.b ?? color.blue;
    const alpha = color.a ?? color.alpha;
    return {
      values: alpha === undefined ? [red, green, blue] : [red, green, blue, alpha],
      source: 'object',
      alphaProvided: alpha !== undefined,
    };
  }
  return {
    values: [],
    source: 'invalid',
    alphaProvided: false,
  };
}

export function colorValidationReport(color, options = {}) {
  const mode = options.mode ?? (options.byte ? 'byte' : 'normalized');
  const byteMode = mode === 'byte' || mode === 'uint8';
  const min = finiteOrDefault(options.min, 0);
  const max = finiteOrDefault(options.max, byteMode ? 255 : 1);
  const alphaDefault = finiteOrDefault(options.alphaDefault, byteMode ? 255 : 1);
  const requireAlpha = options.requireAlpha === true;
  const maxErrors = Math.max(0, Math.trunc(finiteOrDefault(options.maxErrors, 16)));
  const input = colorValuesFromInput(color);
  const values = input.values.slice(0, 4);
  const errors = [];
  if (input.source === 'invalid') pushError(errors, 'color must be array-like or object-like', maxErrors);
  if (values.length !== 3 && values.length !== 4) pushError(errors, 'color must have 3 or 4 channels', maxErrors);
  if (requireAlpha && !input.alphaProvided) pushError(errors, 'alpha channel is required', maxErrors);
  if (!input.alphaProvided && values.length === 3) values.push(alphaDefault);

  const report = finiteArrayReport(values, {
    expectedLength: 4,
    min,
    max,
    allowEmpty: false,
    maxErrors,
  });
  for (const error of report.errors) pushError(errors, error.replaceAll('values', 'color'), maxErrors);

  return {
    valid: errors.length === 0 && report.valid,
    source: input.source,
    mode,
    byteMode,
    channelCount: values.length,
    alphaProvided: input.alphaProvided,
    alphaDefaulted: !input.alphaProvided && values.length === 4,
    min,
    max,
    values: Object.freeze(values),
    red: values[0] ?? 0,
    green: values[1] ?? 0,
    blue: values[2] ?? 0,
    alpha: values[3] ?? alphaDefault,
    finiteReport: report,
    errors,
  };
}

function schemaNodeReport(value, schema, path, options, depth) {
  const maxErrors = Math.max(0, Math.trunc(finiteOrDefault(options.maxErrors, 16)));
  const maxDepth = Math.max(0, Math.trunc(finiteOrDefault(options.maxDepth, 8)));
  const errors = [];
  if (!schema || typeof schema !== 'object') {
    schemaError(errors, path, 'schema must be an object', maxErrors);
    return primitiveSchemaReport(false, path, 'invalid-schema', errors, { actualType: valueKind(value) });
  }
  if (depth > maxDepth) {
    schemaError(errors, path, `schema depth exceeds maxDepth ${maxDepth}`, maxErrors);
    return primitiveSchemaReport(false, path, schema.type ?? 'unknown', errors, { actualType: valueKind(value) });
  }

  const type = schema.type ?? (schema.properties ? 'object' : (schema.items ? 'array' : 'any'));
  const actualType = valueKind(value);
  const childReports = [];
  const propertyReports = {};
  const itemReports = [];
  let valid = true;
  let missingRequiredCount = 0;
  let unexpectedPropertyCount = 0;

  if (schema.enum && Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, value))) {
    valid = false;
    schemaError(errors, path, 'value is not in enum', maxErrors);
  }

  if (type === 'any') {
    return primitiveSchemaReport(valid && errors.length === 0, path, type, errors, { actualType });
  }

  if (type === 'number' || type === 'integer') {
    const report = finiteNumberReport(value, {
      min: schema.min,
      max: schema.max,
      integer: type === 'integer' || schema.integer === true,
      allowNegativeZero: schema.allowNegativeZero,
    });
    valid = valid && report.valid;
    for (const error of report.valid ? [] : [report.reason]) schemaError(errors, path, error, maxErrors);
    return primitiveSchemaReport(valid && errors.length === 0, path, type, errors, { actualType, report });
  }

  if (type === 'string') {
    const minLength = schema.minLength === undefined ? 0 : Math.max(0, Math.trunc(finiteOrDefault(schema.minLength, 0)));
    const maxLength = schema.maxLength === undefined ? Infinity : Math.max(0, Math.trunc(finiteOrDefault(schema.maxLength, Infinity)));
    const stringValid = typeof value === 'string' && value.length >= minLength && value.length <= maxLength;
    if (!stringValid) schemaError(errors, path, `expected string length in [${minLength}, ${maxLength}]`, maxErrors);
    return primitiveSchemaReport(valid && stringValid && errors.length === 0, path, type, errors, {
      actualType,
      length: typeof value === 'string' ? value.length : 0,
      minLength,
      maxLength,
    });
  }

  if (type === 'boolean') {
    const booleanValid = typeof value === 'boolean';
    if (!booleanValid) schemaError(errors, path, 'expected boolean', maxErrors);
    return primitiveSchemaReport(valid && booleanValid && errors.length === 0, path, type, errors, { actualType });
  }

  if (type === 'finite-array') {
    const report = finiteArrayReport(value, schema);
    valid = valid && report.valid;
    for (const error of report.errors) schemaError(errors, path, error, maxErrors);
    return primitiveSchemaReport(valid && errors.length === 0, path, type, errors, { actualType, report });
  }

  if (type === 'unit-vector') {
    const report = unitVectorReport(value, schema);
    valid = valid && report.valid;
    for (const error of report.errors) schemaError(errors, path, error, maxErrors);
    return primitiveSchemaReport(valid && errors.length === 0, path, type, errors, { actualType, report });
  }

  if (type === 'color') {
    const report = colorValidationReport(value, schema);
    valid = valid && report.valid;
    for (const error of report.errors) schemaError(errors, path, error, maxErrors);
    return primitiveSchemaReport(valid && errors.length === 0, path, type, errors, { actualType, report });
  }

  if (type === 'probability') {
    const report = probabilityDistributionReport(value, schema);
    valid = valid && report.valid;
    for (const error of report.errors) schemaError(errors, path, error, maxErrors);
    return primitiveSchemaReport(valid && errors.length === 0, path, type, errors, { actualType, report });
  }

  if (type === 'histogram') {
    const report = histogramValidationReport(value, schema);
    valid = valid && report.valid;
    for (const error of report.errors) schemaError(errors, path, error, maxErrors);
    return primitiveSchemaReport(valid && errors.length === 0, path, type, errors, { actualType, report });
  }

  if (type === 'array') {
    const meta = arrayLikeLength(value, path);
    if (!meta.valid) {
      schemaError(errors, path, meta.error, maxErrors);
      return primitiveSchemaReport(false, path, type, errors, { actualType, itemReports });
    }
    const minLength = schema.minLength === undefined ? 0 : Math.max(0, Math.trunc(finiteOrDefault(schema.minLength, 0)));
    const maxLength = schema.maxLength === undefined ? Infinity : Math.max(0, Math.trunc(finiteOrDefault(schema.maxLength, Infinity)));
    const exactLength = schema.length === undefined ? null : Math.max(0, Math.trunc(finiteOrDefault(schema.length, -1)));
    if (meta.length < minLength) schemaError(errors, path, `array length ${meta.length} < minLength ${minLength}`, maxErrors);
    if (meta.length > maxLength) schemaError(errors, path, `array length ${meta.length} > maxLength ${maxLength}`, maxErrors);
    if (exactLength !== null && meta.length !== exactLength) schemaError(errors, path, `array length ${meta.length} !== length ${exactLength}`, maxErrors);
    if (schema.items) {
      for (let index = 0; index < meta.length; index++) {
        const child = schemaNodeReport(value[index], schema.items, schemaChildPath(path, index), options, depth + 1);
        itemReports.push(child);
        childReports.push(child);
        valid = valid && child.valid;
        for (const error of child.errors) pushError(errors, error, maxErrors);
      }
    }
    return {
      valid: valid && errors.length === 0,
      path,
      type,
      actualType,
      length: meta.length,
      minLength,
      maxLength,
      exactLength,
      itemReports,
      childReports,
      errors,
    };
  }

  if (type === 'object') {
    const objectValid = value !== null && typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value);
    if (!objectValid) {
      schemaError(errors, path, 'expected object', maxErrors);
      return primitiveSchemaReport(false, path, type, errors, { actualType, propertyReports });
    }
    const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!hasOwn(value, key)) {
        missingRequiredCount++;
        schemaError(errors, schemaChildPath(path, key), 'required property is missing', maxErrors);
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (!hasOwn(value, key)) {
        if (childSchema?.required === true && !required.includes(key)) {
          missingRequiredCount++;
          schemaError(errors, schemaChildPath(path, key), 'required property is missing', maxErrors);
        }
        continue;
      }
      const child = schemaNodeReport(value[key], childSchema, schemaChildPath(path, key), options, depth + 1);
      propertyReports[key] = child;
      childReports.push(child);
      valid = valid && child.valid;
      for (const error of child.errors) pushError(errors, error, maxErrors);
    }
    if (schema.allowUnknown === false) {
      for (const key of Object.keys(value)) {
        if (!hasOwn(properties, key)) {
          unexpectedPropertyCount++;
          schemaError(errors, schemaChildPath(path, key), 'unexpected property', maxErrors);
        }
      }
    }
    return {
      valid: valid && errors.length === 0,
      path,
      type,
      actualType,
      propertyReports,
      childReports,
      required,
      missingRequiredCount,
      unexpectedPropertyCount,
      errors,
    };
  }

  schemaError(errors, path, `unsupported schema type ${type}`, maxErrors);
  return primitiveSchemaReport(false, path, type, errors, { actualType });
}

export function schemaValidationReport(value, schema, options = {}) {
  return schemaNodeReport(value, schema, options.path ?? '$', options, 0);
}

export function assertValidationReport(report, message = 'validation failed') {
  if (!report || report.valid !== true) {
    const details = Array.isArray(report?.errors) && report.errors.length > 0 ? `: ${report.errors.join('; ')}` : '';
    throw new RangeError(`${message}${details}`);
  }
  return report;
}

export function assertFiniteArray(values, options = {}) {
  return assertValidationReport(finiteArrayReport(values, options), options.message ?? 'finite array validation failed');
}

export function assertUnitVector(values, options = {}) {
  return assertValidationReport(unitVectorReport(values, options), options.message ?? 'unit vector validation failed');
}

export function assertColor(color, options = {}) {
  return assertValidationReport(colorValidationReport(color, options), options.message ?? 'color validation failed');
}

export function assertSchema(value, schema, options = {}) {
  return assertValidationReport(schemaValidationReport(value, schema, options), options.message ?? 'schema validation failed');
}

export default {
  finiteNumberReport,
  finiteArrayReport,
  rangeValidationReport,
  alignmentReport,
  powerOfTwoReport,
  histogramValidationReport,
  probabilityDistributionReport,
  typedArrayLayoutReport,
  vectorValidationReport,
  unitVectorReport,
  colorValidationReport,
  schemaValidationReport,
  assertValidationReport,
  assertFiniteArray,
  assertUnitVector,
  assertColor,
  assertSchema,
};
