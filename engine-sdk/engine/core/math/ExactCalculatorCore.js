// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// ExactCalculatorCore.js - bounded parsing and exact integer/rational arithmetic.

export const EXACT_CALCULATOR_CORE_VERSION = '1.0.0';
export const EXACT_VALUE_SCHEMA = 'particle-realms/exact-value/v1';
export const EXACT_AST_SCHEMA = 'particle-realms/exact-ast/v1';

export const DEFAULT_EXACT_CALCULATOR_LIMITS = Object.freeze({
  maxSourceLength: 4096,
  maxTokens: 1024,
  maxAstNodes: 1024,
  maxAstDepth: 1024,
  maxLiteralBits: 4096,
  maxExponentMagnitude: 1024,
  maxWorkSteps: 32768,
  maxResultBits: 8192,
  maxOutputLength: 16384,
});

export const ABSOLUTE_EXACT_CALCULATOR_LIMITS = Object.freeze({
  maxSourceLength: 65536,
  maxTokens: 8192,
  maxAstNodes: 8192,
  maxAstDepth: 1024,
  maxLiteralBits: 65536,
  maxExponentMagnitude: 16384,
  maxWorkSteps: 1000000,
  maxResultBits: 131072,
  maxOutputLength: 262144,
});

export const EXACT_CALCULATOR_ERROR_CODES = Object.freeze({
  INVALID_SOURCE: 'INVALID_SOURCE',
  INVALID_LIMIT: 'INVALID_LIMIT',
  SOURCE_LENGTH_EXCEEDED: 'SOURCE_LENGTH_EXCEEDED',
  TOKEN_LIMIT_EXCEEDED: 'TOKEN_LIMIT_EXCEEDED',
  INVALID_CHARACTER: 'INVALID_CHARACTER',
  INVALID_NUMBER: 'INVALID_NUMBER',
  EMPTY_EXPRESSION: 'EMPTY_EXPRESSION',
  UNEXPECTED_TOKEN: 'UNEXPECTED_TOKEN',
  EXPECTED_TOKEN: 'EXPECTED_TOKEN',
  AST_NODE_LIMIT_EXCEEDED: 'AST_NODE_LIMIT_EXCEEDED',
  AST_DEPTH_LIMIT_EXCEEDED: 'AST_DEPTH_LIMIT_EXCEEDED',
  INVALID_AST: 'INVALID_AST',
  LITERAL_BITS_EXCEEDED: 'LITERAL_BITS_EXCEEDED',
  EXPONENT_LIMIT_EXCEEDED: 'EXPONENT_LIMIT_EXCEEDED',
  EXPONENT_NOT_INTEGER: 'EXPONENT_NOT_INTEGER',
  DIVISION_BY_ZERO: 'DIVISION_BY_ZERO',
  INDETERMINATE_POWER: 'INDETERMINATE_POWER',
  WORK_LIMIT_EXCEEDED: 'WORK_LIMIT_EXCEEDED',
  RESULT_BITS_EXCEEDED: 'RESULT_BITS_EXCEEDED',
  OUTPUT_LIMIT_EXCEEDED: 'OUTPUT_LIMIT_EXCEEDED',
  UNSUPPORTED_OPERATOR: 'UNSUPPORTED_OPERATOR',
  INVALID_EXACT_VALUE: 'INVALID_EXACT_VALUE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

const LIMIT_KEYS = Object.freeze(Object.keys(DEFAULT_EXACT_CALCULATOR_LIMITS));
const ERROR_CODE_VALUES = Object.freeze(new Set(Object.values(EXACT_CALCULATOR_ERROR_CODES)));
const ERROR_STAGES = Object.freeze(new Set(['limits', 'tokenize', 'parse', 'validate', 'evaluate', 'serialize', 'internal']));
const BINARY_OPERATORS = Object.freeze(new Set(['+', '-', '*', '/', '^']));
const NUMBER_PATTERN = /^(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?)(\d+))?$/;
const DECIMAL_LOG2 = Math.log2(10);
const DECIMAL_BIT_BOUNDARY_CACHE = new Map();

function freezeSpan(span) {
  if (span === null || span === undefined) return null;
  const start = Number(span.start);
  const end = Number(span.end);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) return null;
  return Object.freeze({ start, end });
}

export class ExactCalculatorError extends Error {
  constructor(code, message, options = {}) {
    super(String(message));
    this.name = 'ExactCalculatorError';
    this.code = String(code);
    this.stage = String(options.stage ?? 'unknown');
    this.span = freezeSpan(options.span);
    this.details = Object.freeze({ ...(options.details ?? {}) });
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      stage: this.stage,
      span: this.span,
      details: this.details,
    };
  }
}

function fail(code, message, stage, span = null, details = {}) {
  throw new ExactCalculatorError(code, message, { stage, span, details });
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function snapshotLimitRecord(value, allowedKeys, label, unknownLabel) {
  if (!value || typeof value !== 'object') {
    fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_LIMIT, `${label} must be an object`, 'limits');
  }
  let arrayValue;
  let prototype;
  let descriptors;
  try {
    arrayValue = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_LIMIT, `${label} could not be inspected`, 'limits');
  }
  if (arrayValue) {
    fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_LIMIT, `${label} must be an object`, 'limits');
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_LIMIT, `${label} must be a plain object`, 'limits');
  }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== 'string')) {
    fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_LIMIT, `${label} must not contain symbol fields`, 'limits');
  }
  const snapshot = Object.create(null);
  for (const key of keys) {
    if (!allowedKeys.includes(key)) {
      fail(
        EXACT_CALCULATOR_ERROR_CODES.INVALID_LIMIT,
        `Unknown ${unknownLabel}: ${diagnosticExcerpt(key)}`,
        'limits',
        null,
        { key: diagnosticExcerpt(key), keyLength: key.length },
      );
    }
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !own(descriptor, 'value')) {
      fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_LIMIT, `${label}.${key} must be an enumerable data field`, 'limits');
    }
    Object.defineProperty(snapshot, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(snapshot);
}

/**
 * Resolve caller limits while retaining non-disableable process ceilings.
 * All values are finite safe integers. Only exponent magnitude may be zero.
 */
export function createExactCalculatorLimits(overrides = {}) {
  const fields = snapshotLimitRecord(
    overrides,
    LIMIT_KEYS,
    'Exact calculator limits',
    'exact calculator limit',
  );
  const resolved = {};
  for (const key of LIMIT_KEYS) {
    const value = own(fields, key) ? fields[key] : DEFAULT_EXACT_CALCULATOR_LIMITS[key];
    const minimum = key === 'maxExponentMagnitude' ? 0 : 1;
    const maximum = ABSOLUTE_EXACT_CALCULATOR_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      fail(
        EXACT_CALCULATOR_ERROR_CODES.INVALID_LIMIT,
        `${key} must be a safe integer from ${minimum} through ${maximum}`,
        'limits',
        null,
        { key, minimum, maximum },
      );
    }
    // Define an own data property so a polluted Object.prototype setter cannot
    // intercept a resource-boundary value.
    Object.defineProperty(resolved, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return Object.freeze(resolved);
}

function limitsFromOptions(options) {
  if (options === undefined) return DEFAULT_EXACT_CALCULATOR_LIMITS;
  const fields = snapshotLimitRecord(
    options,
    ['limits'],
    'Exact calculator options',
    'exact calculator option',
  );
  return createExactCalculatorLimits(own(fields, 'limits') ? (fields.limits ?? {}) : {});
}

function assertSource(source, limits) {
  if (typeof source !== 'string') {
    fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_SOURCE, 'Exact expression source must be a string', 'tokenize');
  }
  if (source.length > limits.maxSourceLength) {
    fail(
      EXACT_CALCULATOR_ERROR_CODES.SOURCE_LENGTH_EXCEEDED,
      `Exact expression exceeds ${limits.maxSourceLength} UTF-16 code units`,
      'tokenize',
      { start: limits.maxSourceLength, end: source.length },
      { actual: source.length, limit: limits.maxSourceLength },
    );
  }
}

function isDigit(character) {
  return character >= '0' && character <= '9';
}

function isWhitespace(character) {
  return /\s/u.test(character);
}

function diagnosticExcerpt(text, limit = 96) {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function token(type, raw, start, end) {
  return Object.freeze({ type, raw, span: Object.freeze({ start, end }) });
}

function tokenizeInternal(source, limits) {
  assertSource(source, limits);
  const tokens = [];
  const push = (type, raw, start, end) => {
    if (tokens.length >= limits.maxTokens) {
      fail(
        EXACT_CALCULATOR_ERROR_CODES.TOKEN_LIMIT_EXCEEDED,
        `Exact expression exceeds ${limits.maxTokens} tokens`,
        'tokenize',
        { start, end },
        { actual: tokens.length + 1, limit: limits.maxTokens },
      );
    }
    tokens.push(token(type, raw, start, end));
  };

  let cursor = 0;
  while (cursor < source.length) {
    const character = source[cursor];
    if (isWhitespace(character)) {
      cursor += 1;
      continue;
    }

    if (isDigit(character) || (character === '.' && isDigit(source[cursor + 1]))) {
      const start = cursor;
      if (character === '.') {
        cursor += 1;
        while (isDigit(source[cursor])) cursor += 1;
      } else {
        while (isDigit(source[cursor])) cursor += 1;
        if (source[cursor] === '.') {
          cursor += 1;
          while (isDigit(source[cursor])) cursor += 1;
        }
      }
      if (source[cursor] === 'e' || source[cursor] === 'E') {
        cursor += 1;
        if (source[cursor] === '+' || source[cursor] === '-') cursor += 1;
        const exponentStart = cursor;
        while (isDigit(source[cursor])) cursor += 1;
        if (cursor === exponentStart) {
          fail(
            EXACT_CALCULATOR_ERROR_CODES.INVALID_NUMBER,
            'Scientific notation requires exponent digits',
            'tokenize',
            { start, end: cursor },
          );
        }
      }
      if (source[cursor] === '.' || source[cursor] === 'e' || source[cursor] === 'E') {
        let malformedEnd = cursor + 1;
        while (isDigit(source[malformedEnd]) || source[malformedEnd] === '.') malformedEnd += 1;
        fail(
          EXACT_CALCULATOR_ERROR_CODES.INVALID_NUMBER,
          `Invalid exact number: ${diagnosticExcerpt(source.slice(start, malformedEnd))}`,
          'tokenize',
          { start, end: malformedEnd },
        );
      }
      const raw = source.slice(start, cursor);
      if (!NUMBER_PATTERN.test(raw)) {
        fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_NUMBER, `Invalid exact number: ${diagnosticExcerpt(raw)}`, 'tokenize', { start, end: cursor });
      }
      push('number', raw, start, cursor);
      continue;
    }

    if (BINARY_OPERATORS.has(character)) {
      push('operator', character, cursor, cursor + 1);
      cursor += 1;
      continue;
    }
    if (character === '(') {
      push('leftParen', character, cursor, cursor + 1);
      cursor += 1;
      continue;
    }
    if (character === ')') {
      push('rightParen', character, cursor, cursor + 1);
      cursor += 1;
      continue;
    }
    fail(
      EXACT_CALCULATOR_ERROR_CODES.INVALID_CHARACTER,
      `Unsupported character ${JSON.stringify(character)}`,
      'tokenize',
      { start: cursor, end: cursor + 1 },
      { character },
    );
  }

  tokens.push(token('eof', '', source.length, source.length));
  return Object.freeze(tokens);
}

export function tokenizeExactExpression(source, options = undefined) {
  return tokenizeInternal(source, limitsFromOptions(options));
}

function parseBoundedExponent(sign, digits, limits, span, stage) {
  if (!digits) return 0;
  const magnitudeText = digits.replace(/^0+(?=\d)/, '');
  const limitText = String(limits.maxExponentMagnitude);
  if (
    magnitudeText.length > limitText.length
    || (magnitudeText.length === limitText.length && magnitudeText > limitText)
  ) {
    fail(
      EXACT_CALCULATOR_ERROR_CODES.EXPONENT_LIMIT_EXCEEDED,
      `Exponent magnitude exceeds ${limits.maxExponentMagnitude}`,
      stage,
      span,
      { limit: limits.maxExponentMagnitude },
    );
  }
  const magnitude = Number(magnitudeText);
  return sign === '-' ? -magnitude : magnitude;
}

function minimumBitsForDecimalDigits(digitCount) {
  if (digitCount <= 1) return 1;
  return Math.floor((digitCount - 1) * DECIMAL_LOG2) + 1;
}

function decimalBitBoundary(bitLimit) {
  const cached = DECIMAL_BIT_BOUNDARY_CACHE.get(bitLimit);
  if (cached !== undefined) return cached;
  const boundary = (1n << BigInt(bitLimit)).toString(10);
  if (DECIMAL_BIT_BOUNDARY_CACHE.size >= 8) {
    DECIMAL_BIT_BOUNDARY_CACHE.delete(DECIMAL_BIT_BOUNDARY_CACHE.keys().next().value);
  }
  DECIMAL_BIT_BOUNDARY_CACHE.set(bitLimit, boundary);
  return boundary;
}

function conceptualDecimalAtLeast(coefficient, trailingZeros, boundary) {
  const digitCount = coefficient.length + trailingZeros;
  if (digitCount !== boundary.length) return digitCount > boundary.length;
  for (let index = 0; index < digitCount; index += 1) {
    const digit = index < coefficient.length ? coefficient[index] : '0';
    if (digit !== boundary[index]) return digit > boundary[index];
  }
  return true;
}

function assertDecimalMagnitudeFits(coefficient, trailingZeros, limits, span, stage, component) {
  const digitCount = coefficient.length + trailingZeros;
  if (
    minimumBitsForDecimalDigits(digitCount) > limits.maxLiteralBits
    || conceptualDecimalAtLeast(coefficient, trailingZeros, decimalBitBoundary(limits.maxLiteralBits))
  ) {
    fail(
      EXACT_CALCULATOR_ERROR_CODES.LITERAL_BITS_EXCEEDED,
      `${component} exceeds ${limits.maxLiteralBits} bits`,
      stage,
      span,
      { component, limit: limits.maxLiteralBits },
    );
  }
}

function assertCanonicalDecimalFits(coefficient, bitLimit, component) {
  if (
    minimumBitsForDecimalDigits(coefficient.length) > bitLimit
    || conceptualDecimalAtLeast(coefficient, 0, decimalBitBoundary(bitLimit))
  ) {
    fail(
      EXACT_CALCULATOR_ERROR_CODES.RESULT_BITS_EXCEEDED,
      `${component} exceeds ${bitLimit} bits`,
      'serialize',
      null,
      { component, limit: bitLimit },
    );
  }
}

function decimalParts(raw, limits, span, stage) {
  if (raw.length > limits.maxSourceLength) {
    fail(
      EXACT_CALCULATOR_ERROR_CODES.SOURCE_LENGTH_EXCEEDED,
      `Exact literal exceeds ${limits.maxSourceLength} UTF-16 code units`,
      stage,
      span,
      { actual: raw.length, limit: limits.maxSourceLength },
    );
  }
  const match = NUMBER_PATTERN.exec(raw);
  if (!match) {
    fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_NUMBER, `Invalid exact number: ${diagnosticExcerpt(raw)}`, stage, span);
  }
  const integerDigits = match[1] ?? '0';
  const fractionDigits = match[1] === undefined ? match[3] : (match[2] ?? '');
  const exponentSign = match[4]?.startsWith('-') ? '-' : '+';
  const exponent = parseBoundedExponent(exponentSign, match[5], limits, span, stage);
  let coefficient = `${integerDigits}${fractionDigits}`.replace(/^0+(?=\d)/, '');
  let scale = fractionDigits.length - exponent;

  while (scale > 0 && coefficient.length > 1 && coefficient.endsWith('0')) {
    coefficient = coefficient.slice(0, -1);
    scale -= 1;
  }
  if (/^0+$/.test(coefficient)) return Object.freeze({ coefficient: '0', scale: 0 });

  assertDecimalMagnitudeFits(coefficient, Math.max(0, -scale), limits, span, stage, 'literal numerator');
  if (scale > 0) assertDecimalMagnitudeFits('1', scale, limits, span, stage, 'literal denominator');
  return Object.freeze({ coefficient, scale });
}

function parseInternal(source, limits) {
  const tokens = tokenizeInternal(source, limits);
  if (tokens.length === 1) {
    fail(EXACT_CALCULATOR_ERROR_CODES.EMPTY_EXPRESSION, 'Exact expression is empty', 'parse', { start: 0, end: source.length });
  }

  let nodeCount = 0;
  const depths = new WeakMap();
  const makeNode = (definition, childDepth = 0) => {
    nodeCount += 1;
    if (nodeCount > limits.maxAstNodes) {
      fail(
        EXACT_CALCULATOR_ERROR_CODES.AST_NODE_LIMIT_EXCEEDED,
        `Exact expression exceeds ${limits.maxAstNodes} AST nodes`,
        'parse',
        definition.span,
        { actual: nodeCount, limit: limits.maxAstNodes },
      );
    }
    const depth = childDepth + 1;
    if (depth > limits.maxAstDepth) {
      fail(
        EXACT_CALCULATOR_ERROR_CODES.AST_DEPTH_LIMIT_EXCEEDED,
        `Exact expression exceeds AST depth ${limits.maxAstDepth}`,
        'parse',
        definition.span,
        { actual: depth, limit: limits.maxAstDepth },
      );
    }
    const result = Object.freeze({ ...definition, span: freezeSpan(definition.span) });
    depths.set(result, depth);
    return result;
  };
  const depthOf = node => depths.get(node) ?? 0;
  const output = [];
  const operators = [];
  const binaryPrecedence = operator => (operator === '+' || operator === '-' ? 1 : (operator === '*' || operator === '/' ? 2 : 4));
  const applyOperator = entry => {
    if (entry.kind === 'unary') {
      const argument = output.pop();
      if (!argument) {
        fail(EXACT_CALCULATOR_ERROR_CODES.UNEXPECTED_TOKEN, 'Unary operator is missing an operand', 'parse', entry.span);
      }
      output.push(makeNode(
        { type: 'UnaryExpression', operator: entry.operator, argument, span: { start: entry.span.start, end: argument.span.end } },
        depthOf(argument),
      ));
      return;
    }
    const right = output.pop();
    const left = output.pop();
    if (!left || !right) {
      fail(EXACT_CALCULATOR_ERROR_CODES.UNEXPECTED_TOKEN, 'Binary operator is missing an operand', 'parse', entry.span);
    }
    output.push(makeNode(
      { type: 'BinaryExpression', operator: entry.operator, left, right, span: { start: left.span.start, end: right.span.end } },
      Math.max(depthOf(left), depthOf(right)),
    ));
  };
  const popForBinary = operator => {
    const precedence = binaryPrecedence(operator);
    const rightAssociative = operator === '^';
    while (operators.length > 0) {
      const top = operators[operators.length - 1];
      if (top.kind === 'leftParen') return;
      if (top.precedence < precedence || (rightAssociative && top.precedence === precedence)) return;
      applyOperator(operators.pop());
    }
  };
  const unexpected = next => fail(
    EXACT_CALCULATOR_ERROR_CODES.UNEXPECTED_TOKEN,
    next.type === 'eof' ? 'Unexpected end of exact expression' : `Unexpected token ${JSON.stringify(diagnosticExcerpt(next.raw))}`,
    'parse',
    next.span,
    { tokenType: next.type, token: diagnosticExcerpt(next.raw), tokenLength: next.raw.length },
  );

  let expectingOperand = true;
  for (let cursor = 0; cursor < tokens.length - 1; cursor += 1) {
    const next = tokens[cursor];
    if (next.type === 'number') {
      if (!expectingOperand) unexpected(next);
      decimalParts(next.raw, limits, next.span, 'parse');
      output.push(makeNode({ type: 'Literal', raw: next.raw, span: next.span }));
      expectingOperand = false;
      continue;
    }
    if (next.type === 'leftParen') {
      if (!expectingOperand) unexpected(next);
      operators.push({ kind: 'leftParen', span: next.span, outputDepth: output.length });
      expectingOperand = true;
      continue;
    }
    if (next.type === 'rightParen') {
      if (expectingOperand) unexpected(next);
      while (operators.length > 0 && operators[operators.length - 1].kind !== 'leftParen') {
        applyOperator(operators.pop());
      }
      const marker = operators.pop();
      if (!marker || marker.kind !== 'leftParen' || output.length !== marker.outputDepth + 1) unexpected(next);
      const expression = output.pop();
      output.push(makeNode(
        { type: 'GroupExpression', expression, span: { start: marker.span.start, end: next.span.end } },
        depthOf(expression),
      ));
      expectingOperand = false;
      continue;
    }
    if (next.type !== 'operator') unexpected(next);
    if (expectingOperand) {
      if (next.raw !== '+' && next.raw !== '-') unexpected(next);
      operators.push({ kind: 'unary', operator: next.raw, precedence: 3, span: next.span });
    } else {
      popForBinary(next.raw);
      operators.push({
        kind: 'binary',
        operator: next.raw,
        precedence: binaryPrecedence(next.raw),
        span: next.span,
      });
      expectingOperand = true;
    }
  }

  const end = tokens[tokens.length - 1];
  if (expectingOperand) unexpected(end);
  while (operators.length > 0) {
    const next = operators.pop();
    if (next.kind === 'leftParen') {
      fail(
        EXACT_CALCULATOR_ERROR_CODES.EXPECTED_TOKEN,
        'Expected closing parenthesis',
        'parse',
        end.span,
        { expected: 'rightParen', actual: 'eof' },
      );
    }
    applyOperator(next);
  }
  if (output.length !== 1) unexpected(end);
  const body = output[0];

  nodeCount += 1;
  const astDepth = depthOf(body) + 1;
  if (nodeCount > limits.maxAstNodes) {
    fail(
      EXACT_CALCULATOR_ERROR_CODES.AST_NODE_LIMIT_EXCEEDED,
      `Exact expression exceeds ${limits.maxAstNodes} AST nodes`,
      'parse',
      body.span,
      { actual: nodeCount, limit: limits.maxAstNodes },
    );
  }
  if (astDepth > limits.maxAstDepth) {
    fail(
      EXACT_CALCULATOR_ERROR_CODES.AST_DEPTH_LIMIT_EXCEEDED,
      `Exact expression exceeds AST depth ${limits.maxAstDepth}`,
      'parse',
      body.span,
      { actual: astDepth, limit: limits.maxAstDepth },
    );
  }
  return Object.freeze({
    type: 'ExactExpression',
    version: 1,
    sourceLength: source.length,
    body,
    span: Object.freeze({ start: 0, end: source.length }),
    stats: Object.freeze({ tokenCount: tokens.length - 1, nodeCount, astDepth }),
  });
}

export function parseExactExpression(source, options = undefined) {
  return parseInternal(source, limitsFromOptions(options));
}

function readAstProperty(object, key, span = null) {
  try {
    return Reflect.get(object, key);
  } catch {
    fail(
      EXACT_CALCULATOR_ERROR_CODES.INVALID_AST,
      `Exact AST property ${key} could not be read`,
      'validate',
      span,
      { key },
    );
  }
}

function captureAstSpan(value, fallback = null) {
  if (!value || typeof value !== 'object') {
    fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_AST, 'Exact AST node has an invalid source span', 'validate', fallback);
  }
  const start = readAstProperty(value, 'start', fallback);
  const end = readAstProperty(value, 'end', fallback);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_AST, 'Exact AST node has an invalid source span', 'validate', fallback);
  }
  return Object.freeze({ start, end });
}

function validateAstInternal(ast, limits) {
  if (!ast || typeof ast !== 'object') {
    fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_AST, 'Expected an ExactExpression version 1 AST', 'validate');
  }
  const rootType = readAstProperty(ast, 'type');
  const rootVersion = readAstProperty(ast, 'version');
  if (rootType !== 'ExactExpression' || rootVersion !== 1) {
    fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_AST, 'Expected an ExactExpression version 1 AST', 'validate');
  }
  const sourceLength = readAstProperty(ast, 'sourceLength');
  const rootSpan = captureAstSpan(readAstProperty(ast, 'span'));
  if (!Number.isSafeInteger(sourceLength) || sourceLength < 0 || sourceLength > limits.maxSourceLength) {
    fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_AST, 'ExactExpression has an invalid sourceLength', 'validate', rootSpan);
  }
  if (rootSpan.start !== 0 || rootSpan.end !== sourceLength) {
    fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_AST, 'ExactExpression has an invalid root span', 'validate', rootSpan);
  }
  const rootBody = readAstProperty(ast, 'body', rootSpan);
  if (!rootBody || typeof rootBody !== 'object') {
    fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_AST, 'ExactExpression body is missing', 'validate', rootSpan);
  }

  let nodeCount = 1;
  let astDepth = 1;
  let literalCharacters = 0;
  const seen = new WeakSet([ast]);
  const snapshots = new Map();
  const stack = [{ node: rootBody, depth: 2, parentSpan: rootSpan, visited: false, capture: null }];
  while (stack.length > 0) {
    const entry = stack.pop();
    const { node, depth, parentSpan } = entry;
    if (entry.visited) {
      const capture = entry.capture;
      let snapshot = null;
      if (capture.type === 'Literal') {
        snapshot = Object.freeze({ type: capture.type, raw: capture.raw, span: capture.span });
      } else if (capture.type === 'GroupExpression') {
        snapshot = Object.freeze({
          type: capture.type,
          expression: snapshots.get(capture.expression),
          span: capture.span,
        });
      } else if (capture.type === 'UnaryExpression') {
        snapshot = Object.freeze({
          type: capture.type,
          operator: capture.operator,
          argument: snapshots.get(capture.argument),
          span: capture.span,
        });
      } else {
        snapshot = Object.freeze({
          type: capture.type,
          operator: capture.operator,
          left: snapshots.get(capture.left),
          right: snapshots.get(capture.right),
          span: capture.span,
        });
      }
      snapshots.set(node, snapshot);
      continue;
    }

    if (!node || typeof node !== 'object' || seen.has(node)) {
      fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_AST, 'Exact AST must be an acyclic tree', 'validate', parentSpan);
    }
    seen.add(node);
    nodeCount += 1;
    astDepth = Math.max(astDepth, depth);
    if (nodeCount > limits.maxAstNodes) {
      fail(
        EXACT_CALCULATOR_ERROR_CODES.AST_NODE_LIMIT_EXCEEDED,
        `Exact AST exceeds ${limits.maxAstNodes} nodes`,
        'validate',
        parentSpan,
        { actual: nodeCount, limit: limits.maxAstNodes },
      );
    }
    if (depth > limits.maxAstDepth) {
      fail(
        EXACT_CALCULATOR_ERROR_CODES.AST_DEPTH_LIMIT_EXCEEDED,
        `Exact AST exceeds depth ${limits.maxAstDepth}`,
        'validate',
        parentSpan,
        { actual: depth, limit: limits.maxAstDepth },
      );
    }
    const span = captureAstSpan(readAstProperty(node, 'span', parentSpan), parentSpan);
    if (span.start < parentSpan.start || span.end > parentSpan.end) {
      fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_AST, 'Exact AST node has an invalid source span', 'validate', span);
    }
    const type = readAstProperty(node, 'type', span);
    if (type === 'Literal') {
      const raw = readAstProperty(node, 'raw', span);
      if (typeof raw !== 'string') {
        fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_AST, 'Literal raw value must be a string', 'validate', span);
      }
      literalCharacters += raw.length;
      if (literalCharacters > sourceLength || span.end - span.start !== raw.length) {
        fail(
          EXACT_CALCULATOR_ERROR_CODES.INVALID_AST,
          'Literal text is inconsistent with ExactExpression source bounds',
          'validate',
          span,
          { literalCharacters, sourceLength },
        );
      }
      decimalParts(raw, limits, span, 'validate');
      stack.push({ node, depth, parentSpan, visited: true, capture: { type, raw, span } });
      continue;
    }
    if (type === 'GroupExpression') {
      const expression = readAstProperty(node, 'expression', span);
      if (!expression || typeof expression !== 'object') {
        fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_AST, 'GroupExpression child is missing', 'validate', span);
      }
      const capture = { type, expression, span };
      stack.push({ node, depth, parentSpan, visited: true, capture });
      stack.push({ node: expression, depth: depth + 1, parentSpan: span, visited: false, capture: null });
      continue;
    }
    if (type === 'UnaryExpression') {
      const operator = readAstProperty(node, 'operator', span);
      const argument = readAstProperty(node, 'argument', span);
      if ((operator !== '+' && operator !== '-') || !argument || typeof argument !== 'object') {
        fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_AST, 'UnaryExpression is malformed', 'validate', span);
      }
      const capture = { type, operator, argument, span };
      stack.push({ node, depth, parentSpan, visited: true, capture });
      stack.push({ node: argument, depth: depth + 1, parentSpan: span, visited: false, capture: null });
      continue;
    }
    if (type === 'BinaryExpression') {
      const operator = readAstProperty(node, 'operator', span);
      const left = readAstProperty(node, 'left', span);
      const right = readAstProperty(node, 'right', span);
      if (!BINARY_OPERATORS.has(operator) || !left || typeof left !== 'object' || !right || typeof right !== 'object') {
        fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_AST, 'BinaryExpression is malformed', 'validate', span);
      }
      const capture = { type, operator, left, right, span };
      stack.push({ node, depth, parentSpan, visited: true, capture });
      stack.push({ node: right, depth: depth + 1, parentSpan: span, visited: false, capture: null });
      stack.push({ node: left, depth: depth + 1, parentSpan: span, visited: false, capture: null });
      continue;
    }
    fail(
      EXACT_CALCULATOR_ERROR_CODES.INVALID_AST,
      'Unsupported exact AST node type',
      'validate',
      span,
      { receivedType: typeof type },
    );
  }
  const body = snapshots.get(rootBody);
  const snapshot = Object.freeze({
    type: 'ExactExpression',
    version: 1,
    sourceLength,
    body,
    span: rootSpan,
    stats: Object.freeze({ nodeCount, astDepth }),
  });
  return Object.freeze({ nodeCount, astDepth, ast: snapshot });
}

export function validateExactAst(ast, options = undefined) {
  const validation = validateAstInternal(ast, limitsFromOptions(options));
  return Object.freeze({ nodeCount: validation.nodeCount, astDepth: validation.astDepth });
}

class WorkBudget {
  constructor(limit, stage = 'evaluate') {
    this.limit = limit;
    this.stage = stage;
    this.used = 0;
  }

  spend(operation, span, amount = 1) {
    if (this.used + amount > this.limit) {
      fail(
        EXACT_CALCULATOR_ERROR_CODES.WORK_LIMIT_EXCEEDED,
        `Exact evaluation exceeds ${this.limit} work steps`,
        this.stage,
        span,
        { operation, used: this.used, requested: amount, limit: this.limit },
      );
    }
    this.used += amount;
  }
}

function absoluteBigInt(value) {
  return value < 0n ? -value : value;
}

function bigIntBits(value) {
  const magnitude = absoluteBigInt(value);
  return magnitude === 0n ? 1 : magnitude.toString(2).length;
}

function assertBigIntBits(value, limit, code, stage, span, component) {
  const bits = bigIntBits(value);
  if (bits > limit) {
    fail(code, `${component} exceeds ${limit} bits`, stage, span, { component, actual: bits, limit });
  }
  return bits;
}

function greatestCommonDivisor(left, right, budget, span) {
  let a = absoluteBigInt(left);
  let b = absoluteBigInt(right);
  while (b !== 0n) {
    budget.spend('gcd', span);
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function boundedMultiply(left, right, limit, code, component, budget, span) {
  if (left === 0n || right === 0n) {
    budget.spend('multiply', span);
    return 0n;
  }
  const minimumProductBits = bigIntBits(left) + bigIntBits(right) - 1;
  if (minimumProductBits > limit) {
    fail(code, `${component} would exceed ${limit} bits`, 'evaluate', span, { component, limit });
  }
  budget.spend('multiply', span);
  const result = left * right;
  assertBigIntBits(result, limit, code, 'evaluate', span, component);
  return result;
}

function boundedAdd(left, right, limit, budget, span) {
  budget.spend('add', span);
  const result = left + right;
  assertBigIntBits(
    result,
    limit,
    EXACT_CALCULATOR_ERROR_CODES.RESULT_BITS_EXCEEDED,
    'evaluate',
    span,
    'numerator',
  );
  return result;
}

function powUnsignedBigInt(base, exponent, bitLimit, code, component, budget, span) {
  let result = 1n;
  let factor = base;
  let remaining = exponent;
  while (remaining > 0) {
    if ((remaining & 1) === 1) {
      result = boundedMultiply(result, factor, bitLimit, code, component, budget, span);
    }
    remaining = Math.floor(remaining / 2);
    if (remaining > 0) {
      factor = boundedMultiply(factor, factor, bitLimit, code, component, budget, span);
    }
  }
  return result;
}

function integerValue(value) {
  return Object.freeze({ type: 'Integer', value });
}

function normalizedValue(numerator, denominator, limits, budget, span) {
  if (denominator === 0n) {
    fail(EXACT_CALCULATOR_ERROR_CODES.DIVISION_BY_ZERO, 'Division by zero is undefined', 'evaluate', span);
  }
  let normalizedNumerator = numerator;
  let normalizedDenominator = denominator;
  if (normalizedDenominator < 0n) {
    normalizedNumerator = -normalizedNumerator;
    normalizedDenominator = -normalizedDenominator;
  }
  if (normalizedNumerator === 0n) return integerValue(0n);
  if (normalizedDenominator === 1n) {
    assertBigIntBits(
      normalizedNumerator,
      limits.maxResultBits,
      EXACT_CALCULATOR_ERROR_CODES.RESULT_BITS_EXCEEDED,
      'evaluate',
      span,
      'integer',
    );
    return integerValue(normalizedNumerator);
  }
  const divisor = greatestCommonDivisor(normalizedNumerator, normalizedDenominator, budget, span);
  normalizedNumerator /= divisor;
  normalizedDenominator /= divisor;
  assertBigIntBits(
    normalizedNumerator,
    limits.maxResultBits,
    EXACT_CALCULATOR_ERROR_CODES.RESULT_BITS_EXCEEDED,
    'evaluate',
    span,
    'numerator',
  );
  assertBigIntBits(
    normalizedDenominator,
    limits.maxResultBits,
    EXACT_CALCULATOR_ERROR_CODES.RESULT_BITS_EXCEEDED,
    'evaluate',
    span,
    'denominator',
  );
  if (normalizedDenominator === 1n) return integerValue(normalizedNumerator);
  return Object.freeze({ type: 'Rational', numerator: normalizedNumerator, denominator: normalizedDenominator });
}

function valueParts(value) {
  return value.type === 'Integer'
    ? { numerator: value.value, denominator: 1n }
    : { numerator: value.numerator, denominator: value.denominator };
}

function parseLiteralValue(node, limits, budget) {
  const parts = decimalParts(node.raw, limits, node.span, 'evaluate');
  budget.spend('parse-literal', node.span);
  let numerator = BigInt(parts.coefficient);
  let denominator = 1n;
  if (parts.scale < 0) {
    const scale = powUnsignedBigInt(
      10n,
      -parts.scale,
      limits.maxLiteralBits,
      EXACT_CALCULATOR_ERROR_CODES.LITERAL_BITS_EXCEEDED,
      'literal numerator',
      budget,
      node.span,
    );
    numerator = boundedMultiply(
      numerator,
      scale,
      limits.maxLiteralBits,
      EXACT_CALCULATOR_ERROR_CODES.LITERAL_BITS_EXCEEDED,
      'literal numerator',
      budget,
      node.span,
    );
  } else if (parts.scale > 0) {
    denominator = powUnsignedBigInt(
      10n,
      parts.scale,
      limits.maxLiteralBits,
      EXACT_CALCULATOR_ERROR_CODES.LITERAL_BITS_EXCEEDED,
      'literal denominator',
      budget,
      node.span,
    );
  }
  assertBigIntBits(
    numerator,
    limits.maxLiteralBits,
    EXACT_CALCULATOR_ERROR_CODES.LITERAL_BITS_EXCEEDED,
    'evaluate',
    node.span,
    'literal numerator',
  );
  assertBigIntBits(
    denominator,
    limits.maxLiteralBits,
    EXACT_CALCULATOR_ERROR_CODES.LITERAL_BITS_EXCEEDED,
    'evaluate',
    node.span,
    'literal denominator',
  );
  return normalizedValue(numerator, denominator, limits, budget, node.span);
}

function negateValue(value, limits, budget, span) {
  budget.spend('negate', span);
  if (value.type === 'Integer') return integerValue(-value.value);
  return normalizedValue(-value.numerator, value.denominator, limits, budget, span);
}

function addValues(left, right, subtract, limits, budget, span) {
  const a = valueParts(left);
  const b = valueParts(right);
  const denominatorGcd = greatestCommonDivisor(a.denominator, b.denominator, budget, span);
  const leftScale = b.denominator / denominatorGcd;
  const rightScale = a.denominator / denominatorGcd;
  const leftNumerator = boundedMultiply(
    a.numerator,
    leftScale,
    limits.maxResultBits,
    EXACT_CALCULATOR_ERROR_CODES.RESULT_BITS_EXCEEDED,
    'left numerator',
    budget,
    span,
  );
  let rightNumerator = boundedMultiply(
    b.numerator,
    rightScale,
    limits.maxResultBits,
    EXACT_CALCULATOR_ERROR_CODES.RESULT_BITS_EXCEEDED,
    'right numerator',
    budget,
    span,
  );
  if (subtract) rightNumerator = -rightNumerator;
  const numerator = boundedAdd(leftNumerator, rightNumerator, limits.maxResultBits, budget, span);
  const denominator = boundedMultiply(
    a.denominator,
    leftScale,
    limits.maxResultBits,
    EXACT_CALCULATOR_ERROR_CODES.RESULT_BITS_EXCEEDED,
    'denominator',
    budget,
    span,
  );
  return normalizedValue(numerator, denominator, limits, budget, span);
}

function multiplyValues(left, right, limits, budget, span) {
  const a = valueParts(left);
  const b = valueParts(right);
  const firstDivisor = greatestCommonDivisor(a.numerator, b.denominator, budget, span);
  const secondDivisor = greatestCommonDivisor(b.numerator, a.denominator, budget, span);
  const numerator = boundedMultiply(
    a.numerator / firstDivisor,
    b.numerator / secondDivisor,
    limits.maxResultBits,
    EXACT_CALCULATOR_ERROR_CODES.RESULT_BITS_EXCEEDED,
    'numerator',
    budget,
    span,
  );
  const denominator = boundedMultiply(
    a.denominator / secondDivisor,
    b.denominator / firstDivisor,
    limits.maxResultBits,
    EXACT_CALCULATOR_ERROR_CODES.RESULT_BITS_EXCEEDED,
    'denominator',
    budget,
    span,
  );
  return normalizedValue(numerator, denominator, limits, budget, span);
}

function divideValues(left, right, limits, budget, span) {
  const a = valueParts(left);
  const b = valueParts(right);
  if (b.numerator === 0n) {
    fail(EXACT_CALCULATOR_ERROR_CODES.DIVISION_BY_ZERO, 'Division by zero is undefined', 'evaluate', span);
  }
  const firstDivisor = greatestCommonDivisor(a.numerator, b.numerator, budget, span);
  const secondDivisor = greatestCommonDivisor(b.denominator, a.denominator, budget, span);
  const numerator = boundedMultiply(
    a.numerator / firstDivisor,
    b.denominator / secondDivisor,
    limits.maxResultBits,
    EXACT_CALCULATOR_ERROR_CODES.RESULT_BITS_EXCEEDED,
    'numerator',
    budget,
    span,
  );
  const denominator = boundedMultiply(
    a.denominator / secondDivisor,
    b.numerator / firstDivisor,
    limits.maxResultBits,
    EXACT_CALCULATOR_ERROR_CODES.RESULT_BITS_EXCEEDED,
    'denominator',
    budget,
    span,
  );
  return normalizedValue(numerator, denominator, limits, budget, span);
}

function powerValue(base, exponentValue, limits, budget, span) {
  if (exponentValue.type !== 'Integer') {
    fail(EXACT_CALCULATOR_ERROR_CODES.EXPONENT_NOT_INTEGER, 'Exact powers require an integer exponent', 'evaluate', span);
  }
  const exponent = exponentValue.value;
  const magnitude = absoluteBigInt(exponent);
  if (magnitude > BigInt(limits.maxExponentMagnitude)) {
    fail(
      EXACT_CALCULATOR_ERROR_CODES.EXPONENT_LIMIT_EXCEEDED,
      `Exponent magnitude exceeds ${limits.maxExponentMagnitude}`,
      'evaluate',
      span,
      { limit: limits.maxExponentMagnitude },
    );
  }
  const baseParts = valueParts(base);
  if (baseParts.numerator === 0n && exponent === 0n) {
    fail(EXACT_CALCULATOR_ERROR_CODES.INDETERMINATE_POWER, 'Zero to the zero power is indeterminate', 'evaluate', span);
  }
  if (baseParts.numerator === 0n && exponent < 0n) {
    fail(EXACT_CALCULATOR_ERROR_CODES.DIVISION_BY_ZERO, 'Zero cannot be raised to a negative exponent', 'evaluate', span);
  }

  let factor = exponent < 0n
    ? normalizedValue(baseParts.denominator, baseParts.numerator, limits, budget, span)
    : base;
  let result = integerValue(1n);
  let remaining = Number(magnitude);
  while (remaining > 0) {
    if ((remaining & 1) === 1) result = multiplyValues(result, factor, limits, budget, span);
    remaining = Math.floor(remaining / 2);
    if (remaining > 0) factor = multiplyValues(factor, factor, limits, budget, span);
  }
  return result;
}

function evaluateBinary(operator, left, right, limits, budget, span) {
  if (operator === '+') return addValues(left, right, false, limits, budget, span);
  if (operator === '-') return addValues(left, right, true, limits, budget, span);
  if (operator === '*') return multiplyValues(left, right, limits, budget, span);
  if (operator === '/') return divideValues(left, right, limits, budget, span);
  if (operator === '^') return powerValue(left, right, limits, budget, span);
  fail(EXACT_CALCULATOR_ERROR_CODES.UNSUPPORTED_OPERATOR, `Unsupported exact operator: ${operator}`, 'evaluate', span, { operator });
}

function evaluateAstInternal(ast, limits) {
  const validation = validateAstInternal(ast, limits);
  const validatedAst = validation.ast;
  const budget = new WorkBudget(limits.maxWorkSteps);
  const values = new Map();
  const stack = [{ node: validatedAst.body, visited: false }];
  while (stack.length > 0) {
    const entry = stack.pop();
    const node = entry.node;
    if (!entry.visited) {
      stack.push({ node, visited: true });
      if (node.type === 'GroupExpression') stack.push({ node: node.expression, visited: false });
      else if (node.type === 'UnaryExpression') stack.push({ node: node.argument, visited: false });
      else if (node.type === 'BinaryExpression') {
        stack.push({ node: node.right, visited: false });
        stack.push({ node: node.left, visited: false });
      }
      continue;
    }

    if (node.type === 'Literal') {
      values.set(node, parseLiteralValue(node, limits, budget));
    } else if (node.type === 'GroupExpression') {
      const expression = values.get(node.expression);
      values.delete(node.expression);
      values.set(node, expression);
    } else if (node.type === 'UnaryExpression') {
      const argument = values.get(node.argument);
      values.delete(node.argument);
      values.set(node, node.operator === '+' ? (budget.spend('unary-plus', node.span), argument) : negateValue(argument, limits, budget, node.span));
    } else if (node.type === 'BinaryExpression') {
      const left = values.get(node.left);
      const right = values.get(node.right);
      values.delete(node.left);
      values.delete(node.right);
      values.set(node, evaluateBinary(node.operator, left, right, limits, budget, node.span));
    }
  }
  const value = values.get(validatedAst.body);
  values.clear();
  return Object.freeze({
    value,
    usage: Object.freeze({
      sourceLength: validatedAst.sourceLength,
      nodeCount: validation.nodeCount,
      astDepth: validation.astDepth,
      workSteps: budget.used,
      resultBits: value.type === 'Integer'
        ? bigIntBits(value.value)
        : Math.max(bigIntBits(value.numerator), bigIntBits(value.denominator)),
    }),
  });
}

export function evaluateExactAst(ast, options = undefined) {
  const limits = limitsFromOptions(options);
  const evaluated = evaluateAstInternal(ast, limits);
  const output = exactOutput(evaluated.value, limits);
  return Object.freeze({
    value: output.value,
    display: output.display,
    canonical: output.canonical,
    usage: Object.freeze({
      ...evaluated.usage,
      displayLength: output.display.length,
      outputLength: output.canonical.length,
    }),
  });
}

function canonicalIntegerText(value, component, limits, budget) {
  if (typeof value !== 'string') {
    fail(
      EXACT_CALCULATOR_ERROR_CODES.INVALID_EXACT_VALUE,
      `${component} must be a canonical decimal integer string`,
      'serialize',
    );
  }
  if (value.length > limits.maxOutputLength) {
    fail(
      EXACT_CALCULATOR_ERROR_CODES.OUTPUT_LIMIT_EXCEEDED,
      `${component} exceeds ${limits.maxOutputLength} UTF-16 code units`,
      'serialize',
      null,
      { component, actual: value.length, limit: limits.maxOutputLength },
    );
  }
  if (!/^-?(?:0|[1-9]\d*)$/.test(value) || value === '-0') {
    fail(
      EXACT_CALCULATOR_ERROR_CODES.INVALID_EXACT_VALUE,
      `${component} must be a canonical decimal integer string`,
      'serialize',
    );
  }
  const digits = value[0] === '-' ? value.slice(1) : value;
  assertCanonicalDecimalFits(digits, limits.maxResultBits, component);
  budget.spend('parse-canonical-integer', null);
  const parsed = BigInt(value);
  assertBigIntBits(
    parsed,
    limits.maxResultBits,
    EXACT_CALCULATOR_ERROR_CODES.RESULT_BITS_EXCEEDED,
    'serialize',
    null,
    component,
  );
  return parsed;
}

function readExactValueProperty(value, key) {
  try {
    return Reflect.get(value, key);
  } catch {
    fail(
      EXACT_CALCULATOR_ERROR_CODES.INVALID_EXACT_VALUE,
      `Exact value property ${key} could not be read`,
      'serialize',
      null,
      { key },
    );
  }
}

function validateExactValueInternal(value, limits, budget) {
  if (!value || typeof value !== 'object') {
    fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_EXACT_VALUE, 'Exact value must be an object', 'serialize');
  }
  const type = readExactValueProperty(value, 'type');
  if (type === 'Integer') {
    const integer = readExactValueProperty(value, 'value');
    canonicalIntegerText(integer, 'integer', limits, budget);
    return Object.freeze({ type, value: integer });
  }
  if (type === 'Rational') {
    const numeratorText = readExactValueProperty(value, 'numerator');
    const denominatorText = readExactValueProperty(value, 'denominator');
    const numerator = canonicalIntegerText(numeratorText, 'numerator', limits, budget);
    const denominator = canonicalIntegerText(denominatorText, 'denominator', limits, budget);
    if (numerator === 0n || denominator <= 1n) {
      fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_EXACT_VALUE, 'Rational value is not in canonical form', 'serialize');
    }
    if (greatestCommonDivisor(numerator, denominator, budget, null) !== 1n) {
      fail(EXACT_CALCULATOR_ERROR_CODES.INVALID_EXACT_VALUE, 'Rational value is not normalized', 'serialize');
    }
    return Object.freeze({ type, numerator: numeratorText, denominator: denominatorText });
  }
  fail(
    EXACT_CALCULATOR_ERROR_CODES.INVALID_EXACT_VALUE,
    'Unknown exact value type',
    'serialize',
    null,
    { receivedType: typeof type },
  );
}

function publicValue(value) {
  if (value.type === 'Integer') return Object.freeze({ type: 'Integer', value: value.value.toString(10) });
  return Object.freeze({
    type: 'Rational',
    numerator: value.numerator.toString(10),
    denominator: value.denominator.toString(10),
  });
}

function exactOutput(value, limits) {
  const external = publicValue(value);
  const canonical = checkOutputLength(JSON.stringify(canonicalObject(external)), limits);
  const display = checkOutputLength(
    value.type === 'Integer'
      ? value.value.toString(10)
      : `${value.numerator.toString(10)}/${value.denominator.toString(10)}`,
    limits,
  );
  return Object.freeze({ value: external, display, canonical });
}

function canonicalObject(value) {
  if (value.type === 'Integer') {
    return Object.freeze({ schema: EXACT_VALUE_SCHEMA, type: 'Integer', value: value.value });
  }
  return Object.freeze({
    schema: EXACT_VALUE_SCHEMA,
    type: 'Rational',
    numerator: value.numerator,
    denominator: value.denominator,
  });
}

function checkOutputLength(output, limits) {
  if (output.length > limits.maxOutputLength) {
    fail(
      EXACT_CALCULATOR_ERROR_CODES.OUTPUT_LIMIT_EXCEEDED,
      `Exact output exceeds ${limits.maxOutputLength} UTF-16 code units`,
      'serialize',
      null,
      { actual: output.length, limit: limits.maxOutputLength },
    );
  }
  return output;
}

export function exactValueToCanonicalObject(value, options = undefined) {
  const limits = limitsFromOptions(options);
  const budget = new WorkBudget(limits.maxWorkSteps, 'serialize');
  return canonicalObject(validateExactValueInternal(value, limits, budget));
}

export function serializeExactValue(value, options = undefined) {
  const limits = limitsFromOptions(options);
  const budget = new WorkBudget(limits.maxWorkSteps, 'serialize');
  const output = JSON.stringify(canonicalObject(validateExactValueInternal(value, limits, budget)));
  return checkOutputLength(output, limits);
}

export function formatExactValue(value, options = undefined) {
  const limits = limitsFromOptions(options);
  const budget = new WorkBudget(limits.maxWorkSteps, 'serialize');
  const exact = validateExactValueInternal(value, limits, budget);
  const output = exact.type === 'Integer'
    ? exact.value
    : `${exact.numerator}/${exact.denominator}`;
  return checkOutputLength(output, limits);
}

function canonicalAstObject(ast) {
  const objects = new Map();
  const stack = [{ node: ast.body, visited: false }];
  while (stack.length > 0) {
    const entry = stack.pop();
    const node = entry.node;
    if (!entry.visited) {
      stack.push({ node, visited: true });
      if (node.type === 'GroupExpression') stack.push({ node: node.expression, visited: false });
      else if (node.type === 'UnaryExpression') stack.push({ node: node.argument, visited: false });
      else if (node.type === 'BinaryExpression') {
        stack.push({ node: node.right, visited: false });
        stack.push({ node: node.left, visited: false });
      }
      continue;
    }
    if (node.type === 'Literal') objects.set(node, Object.freeze({ type: 'Literal', raw: node.raw }));
    else if (node.type === 'GroupExpression') {
      objects.set(node, Object.freeze({ type: 'GroupExpression', expression: objects.get(node.expression) }));
    } else if (node.type === 'UnaryExpression') {
      objects.set(node, Object.freeze({ type: 'UnaryExpression', operator: node.operator, argument: objects.get(node.argument) }));
    } else if (node.type === 'BinaryExpression') {
      objects.set(node, Object.freeze({
        type: 'BinaryExpression',
        operator: node.operator,
        left: objects.get(node.left),
        right: objects.get(node.right),
      }));
    }
  }
  return Object.freeze({ schema: EXACT_AST_SCHEMA, type: 'ExactExpression', body: objects.get(ast.body) });
}

function serializeCanonicalAstInternal(ast, limits) {
  const fragments = [];
  let outputLength = 0;
  const append = fragment => {
    outputLength += fragment.length;
    if (outputLength > limits.maxOutputLength) {
      fail(
        EXACT_CALCULATOR_ERROR_CODES.OUTPUT_LIMIT_EXCEEDED,
        `Exact output exceeds ${limits.maxOutputLength} UTF-16 code units`,
        'serialize',
        null,
        { actual: outputLength, limit: limits.maxOutputLength },
      );
    }
    fragments.push(fragment);
  };
  const stack = [
    '}',
    ast.body,
    `{"schema":${JSON.stringify(EXACT_AST_SCHEMA)},"type":"ExactExpression","body":`,
  ];
  while (stack.length > 0) {
    const item = stack.pop();
    if (typeof item === 'string') {
      append(item);
      continue;
    }
    if (item.type === 'Literal') {
      append(`{"type":"Literal","raw":${JSON.stringify(item.raw)}}`);
    } else if (item.type === 'GroupExpression') {
      stack.push('}', item.expression, '{"type":"GroupExpression","expression":');
    } else if (item.type === 'UnaryExpression') {
      stack.push('}', item.argument, `{"type":"UnaryExpression","operator":${JSON.stringify(item.operator)},"argument":`);
    } else if (item.type === 'BinaryExpression') {
      stack.push(
        '}',
        item.right,
        ',"right":',
        item.left,
        `{"type":"BinaryExpression","operator":${JSON.stringify(item.operator)},"left":`,
      );
    }
  }
  return fragments.join('');
}

export function exactAstToCanonicalObject(ast, options = undefined) {
  const limits = limitsFromOptions(options);
  const validation = validateAstInternal(ast, limits);
  return canonicalAstObject(validation.ast);
}

export function serializeExactAst(ast, options = undefined) {
  const limits = limitsFromOptions(options);
  const validation = validateAstInternal(ast, limits);
  return serializeCanonicalAstInternal(validation.ast, limits);
}

export function evaluateExactExpression(source, options = undefined) {
  const limits = limitsFromOptions(options);
  const ast = parseInternal(source, limits);
  const evaluated = evaluateAstInternal(ast, limits);
  const output = exactOutput(evaluated.value, limits);
  return Object.freeze({
    ok: true,
    version: EXACT_CALCULATOR_CORE_VERSION,
    value: output.value,
    display: output.display,
    canonical: output.canonical,
    usage: Object.freeze({
      sourceLength: ast.sourceLength,
      tokenCount: ast.stats.tokenCount,
      nodeCount: evaluated.usage.nodeCount,
      astDepth: evaluated.usage.astDepth,
      workSteps: evaluated.usage.workSteps,
      resultBits: evaluated.usage.resultBits,
      displayLength: output.display.length,
      outputLength: output.canonical.length,
    }),
  });
}

function safeErrorDetails(value) {
  if (!value || typeof value !== 'object') return Object.freeze({});
  try {
    const keys = Object.keys(value).sort();
    if (keys.length > 32) return null;
    const details = {};
    for (const key of keys) {
      if (key.length > 64) return null;
      const item = Reflect.get(value, key);
      if (item === null || typeof item === 'boolean') details[key] = item;
      else if (typeof item === 'number' && Number.isFinite(item)) details[key] = item;
      else if (typeof item === 'string' && item.length <= 512) details[key] = item;
      else return null;
    }
    return Object.freeze(details);
  } catch {
    return null;
  }
}

function safeStructuredError(error) {
  try {
    const code = Reflect.get(error, 'code');
    const message = Reflect.get(error, 'message');
    const stage = Reflect.get(error, 'stage');
    const spanValue = Reflect.get(error, 'span');
    const details = safeErrorDetails(Reflect.get(error, 'details'));
    if (!ERROR_CODE_VALUES.has(code) || typeof message !== 'string' || message.length > 1024 || !ERROR_STAGES.has(stage) || details === null) {
      return null;
    }
    let span = null;
    if (spanValue !== null) {
      if (!spanValue || typeof spanValue !== 'object') return null;
      const start = Reflect.get(spanValue, 'start');
      const end = Reflect.get(spanValue, 'end');
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) return null;
      span = Object.freeze({ start, end });
    }
    return Object.freeze({ name: 'ExactCalculatorError', code, message, stage, span, details });
  } catch {
    return null;
  }
}

function safeUnexpectedErrorMessage(error) {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return 'Unexpected exact calculator failure';
  try {
    const candidate = Reflect.get(error, 'message');
    return typeof candidate === 'string' && candidate.length <= 1024
      ? candidate
      : 'Unexpected exact calculator failure';
  } catch {
    return 'Unexpected exact calculator failure';
  }
}

export function tryEvaluateExactExpression(source, options = undefined) {
  try {
    return evaluateExactExpression(source, options);
  } catch (error) {
    let structured = false;
    try {
      structured = error instanceof ExactCalculatorError;
    } catch {
      structured = false;
    }
    const captured = structured ? safeStructuredError(error) : null;
    const errorRecord = captured ?? Object.freeze({
      name: 'ExactCalculatorError',
      code: EXACT_CALCULATOR_ERROR_CODES.INTERNAL_ERROR,
      message: safeUnexpectedErrorMessage(error),
      stage: 'internal',
      span: null,
      details: Object.freeze({}),
    });
    return Object.freeze({
      ok: false,
      version: EXACT_CALCULATOR_CORE_VERSION,
      error: errorRecord,
    });
  }
}
