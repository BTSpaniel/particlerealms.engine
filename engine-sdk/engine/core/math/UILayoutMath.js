// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// UILayoutMath.js - pure CSS/UI length, constraint, and responsive layout reports.

import { clamp, finiteNumber, mod } from './MathScalar.js';

const ABSOLUTE_LENGTH_TO_PX = Object.freeze({
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  pt: 96 / 72,
  pc: 16,
});

const CSS_LAYOUT_KEYWORDS = Object.freeze(new Set([
  'auto',
  'content',
  'min-content',
  'max-content',
  'fit-content',
  'stretch',
  'none',
]));

const CSS_LAYOUT_MATH_FUNCTIONS = Object.freeze(new Set([
  'calc',
  'min',
  'max',
  'clamp',
  'round',
  'mod',
  'rem',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'pow',
  'sqrt',
  'hypot',
  'log',
  'exp',
  'abs',
  'sign',
]));

const CSS_ROUNDING_STRATEGIES = Object.freeze(new Set([
  'nearest',
  'up',
  'down',
  'to-zero',
]));

const NUMERIC_VALUE_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z%]*)$/i;
const FLEX_TRACK_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)fr$/i;

function finiteNonnegative(value, fallback = 0) {
  const number = finiteNumber(value, fallback);
  return number >= 0 ? number : fallback;
}

function finitePositive(value, fallback = 1) {
  const number = finiteNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function finiteMaybeInfinity(value, fallback = Infinity) {
  const number = Number(value);
  return Number.isFinite(number) || number === Infinity ? number : fallback;
}

function viewportFromContext(context = {}) {
  const viewport = context.viewport || context.layoutViewport || context.visualViewport || context;
  const width = finiteNumber(viewport.width ?? viewport.viewportWidth ?? viewport.inlineSize, 0);
  const height = finiteNumber(viewport.height ?? viewport.viewportHeight ?? viewport.blockSize, 0);
  return { width, height };
}

function visualViewportFromContext(context = {}) {
  const viewport = context.visualViewport || context.viewport || context;
  const fallbackViewport = viewportFromContext(context.layoutViewport || context);
  return {
    width: finiteNonnegative(viewport.width ?? viewport.visualWidth, fallbackViewport.width),
    height: finiteNonnegative(viewport.height ?? viewport.visualHeight, fallbackViewport.height),
    offsetLeft: finiteNumber(viewport.offsetLeft ?? viewport.left, 0),
    offsetTop: finiteNumber(viewport.offsetTop ?? viewport.top, 0),
    pageLeft: finiteNumber(viewport.pageLeft ?? viewport.x, 0),
    pageTop: finiteNumber(viewport.pageTop ?? viewport.y, 0),
    scale: finitePositive(viewport.scale, 1),
  };
}

function safeAreaSourceFromContext(context = {}) {
  return context.safeAreaInsets || context.safeArea || context.insets || context;
}

function safeAreaInsetValue(source = {}, side = 'top') {
  const pascal = side[0].toUpperCase() + side.slice(1);
  return finiteNonnegative(
    source[side] ??
    source[`safeAreaInset${pascal}`] ??
    source[`safe-area-inset-${side}`] ??
    source[`safeArea${pascal}`],
    0
  );
}

function safeAreaInsetsFromContext(context = {}) {
  const source = safeAreaSourceFromContext(context);
  return {
    top: safeAreaInsetValue(source, 'top'),
    right: safeAreaInsetValue(source, 'right'),
    bottom: safeAreaInsetValue(source, 'bottom'),
    left: safeAreaInsetValue(source, 'left'),
  };
}

function viewportForPrefix(context = {}, prefix = '') {
  if (prefix === 's') return viewportFromContext(context.smallViewport || context.small || context);
  if (prefix === 'l') return viewportFromContext(context.largeViewport || context.large || context);
  if (prefix === 'd') return viewportFromContext(context.dynamicViewport || context.dynamic || context);
  return viewportFromContext(context);
}

function inlineBlockViewport(context = {}, prefix = '') {
  const viewport = viewportForPrefix(context, prefix);
  const writingMode = String(context.writingMode || 'horizontal-tb').toLowerCase();
  const vertical = writingMode.startsWith('vertical') || writingMode.startsWith('sideways');
  return {
    inlineSize: vertical ? viewport.height : viewport.width,
    blockSize: vertical ? viewport.width : viewport.height,
  };
}

function splitFunctionArguments(source) {
  const args = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      args.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(source.slice(start).trim());
  return args.filter((arg) => arg.length > 0);
}

function splitTopLevelTokens(source) {
  const tokens = [];
  let depth = 0;
  let bracketDepth = 0;
  let start = 0;
  const push = (end) => {
    const token = source.slice(start, end).trim();
    if (token) tokens.push(token);
  };
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '(' && bracketDepth === 0) depth += 1;
    else if (char === ')' && bracketDepth === 0) depth -= 1;
    else if (char === '[' && depth === 0) bracketDepth += 1;
    else if (char === ']' && depth === 0) bracketDepth -= 1;
    else if (/\s/.test(char) && depth === 0 && bracketDepth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(source.length);
  return tokens;
}

function isLineNameToken(token) {
  const text = String(token || '').trim();
  return text.startsWith('[') && text.endsWith(']');
}

function findMatchingParen(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function substituteCssVariables(source, context = {}) {
  const variables = context.variables || context.cssVariables || {};
  let result = '';
  for (let i = 0; i < source.length;) {
    if (source.slice(i, i + 4).toLowerCase() === 'var(') {
      const end = findMatchingParen(source, i + 3);
      if (end < 0) {
        result += source.slice(i);
        break;
      }
      const inner = source.slice(i + 4, end);
      const [name, fallback] = splitFunctionArguments(inner);
      const key = String(name || '').trim();
      const value = variables[key] ?? variables[key.replace(/^--/, '')];
      result += value !== undefined ? String(value) : String(fallback || '0px');
      i = end + 1;
    } else if (source.slice(i, i + 4).toLowerCase() === 'env(') {
      const end = findMatchingParen(source, i + 3);
      if (end < 0) {
        result += source.slice(i);
        break;
      }
      const inner = source.slice(i + 4, end);
      const [name, fallback] = splitFunctionArguments(inner);
      const value = cssEnvironmentValue(name, context, fallback);
      result += value;
      i = end + 1;
    } else {
      result += source[i];
      i += 1;
    }
  }
  return result;
}

function cssEnvironmentValue(name, context = {}, fallback = '0px') {
  const normalizedName = String(name || '').trim().toLowerCase();
  const insets = safeAreaInsetsFromContext(context);
  switch (normalizedName) {
    case 'safe-area-inset-top': return `${insets.top}px`;
    case 'safe-area-inset-right': return `${insets.right}px`;
    case 'safe-area-inset-bottom': return `${insets.bottom}px`;
    case 'safe-area-inset-left': return `${insets.left}px`;
    default: return String(fallback || '0px');
  }
}

function fontUnitScale(unit, context = {}) {
  switch (unit) {
    case 'em': return finitePositive(context.fontSize, 16);
    case 'rem': return finitePositive(context.rootFontSize, 16);
    case 'ex': return finitePositive(context.xHeight, finitePositive(context.fontSize, 16) * 0.5);
    case 'rex': return finitePositive(context.rootXHeight, finitePositive(context.rootFontSize, 16) * 0.5);
    case 'cap': return finitePositive(context.capHeight, finitePositive(context.fontSize, 16) * 0.7);
    case 'rcap': return finitePositive(context.rootCapHeight, finitePositive(context.rootFontSize, 16) * 0.7);
    case 'ch': return finitePositive(context.chWidth, finitePositive(context.fontSize, 16) * 0.5);
    case 'rch': return finitePositive(context.rootChWidth, finitePositive(context.rootFontSize, 16) * 0.5);
    case 'ic': return finitePositive(context.icWidth, finitePositive(context.fontSize, 16));
    case 'ric': return finitePositive(context.rootIcWidth, finitePositive(context.rootFontSize, 16));
    case 'lh': return finitePositive(context.lineHeight, finitePositive(context.fontSize, 16) * 1.2);
    case 'rlh': return finitePositive(context.rootLineHeight, finitePositive(context.rootFontSize, 16) * 1.2);
    default: return Number.NaN;
  }
}

function viewportUnitScale(unit, context = {}) {
  const match = /^([sld]?)(vw|vh|vmin|vmax|vi|vb)$/.exec(unit);
  if (!match) return Number.NaN;
  const [, prefix, baseUnit] = match;
  const viewport = viewportForPrefix(context, prefix);
  const logical = inlineBlockViewport(context, prefix);
  switch (baseUnit) {
    case 'vw': return viewport.width / 100;
    case 'vh': return viewport.height / 100;
    case 'vmin': return Math.min(viewport.width, viewport.height) / 100;
    case 'vmax': return Math.max(viewport.width, viewport.height) / 100;
    case 'vi': return logical.inlineSize / 100;
    case 'vb': return logical.blockSize / 100;
    default: return Number.NaN;
  }
}

function primitiveLengthReport(numericValue, unit, context = {}) {
  const normalizedUnit = unit === '' ? '' : String(unit || 'px').toLowerCase();
  let dimension = 'length';
  let scale = ABSOLUTE_LENGTH_TO_PX[normalizedUnit];
  let basis = null;
  let relative = false;
  let absolute = scale !== undefined;
  let viewportRelative = false;
  let fontRelative = false;

  if (normalizedUnit === '') {
    dimension = 'number';
    scale = 1;
    absolute = false;
  } else if (normalizedUnit === '%') {
    dimension = 'percentage';
    basis = finiteMaybeInfinity(context.percentageBasis ?? context.basis ?? context.containerSize, Number.NaN);
    scale = Number.isFinite(basis) ? basis / 100 : Number.NaN;
    relative = true;
  } else if (scale === undefined) {
    const fontScale = fontUnitScale(normalizedUnit, context);
    if (Number.isFinite(fontScale)) {
      scale = fontScale;
      relative = true;
      fontRelative = true;
    } else {
      const vpScale = viewportUnitScale(normalizedUnit, context);
      if (Number.isFinite(vpScale)) {
        scale = vpScale;
        relative = true;
        viewportRelative = true;
      }
    }
  }

  const valid = Number.isFinite(numericValue) && Number.isFinite(scale);
  return {
    valid,
    resolved: valid,
    kind: dimension,
    unit: normalizedUnit || null,
    value: numericValue,
    px: valid ? numericValue * scale : Number.NaN,
    scaleToPx: scale,
    basis,
    absolute,
    relative,
    viewportRelative,
    fontRelative,
  };
}

function parsePrimitiveLengthToken(token, context = {}, defaultUnit = 'px') {
  const match = NUMERIC_VALUE_RE.exec(String(token).trim());
  if (!match) {
    return {
      valid: false,
      resolved: false,
      kind: 'invalid',
      value: Number.NaN,
      unit: null,
      px: Number.NaN,
      error: 'invalid-token',
    };
  }
  return primitiveLengthReport(Number(match[1]), match[2] || defaultUnit, context);
}

function resolvedLengthLike(report) {
  return report?.valid && report?.resolved &&
    (report.kind === 'length' || report.kind === 'percentage') &&
    Number.isFinite(report.px);
}

function compatibleAdditiveReports(left, right) {
  return left.kind === right.kind || (resolvedLengthLike(left) && resolvedLengthLike(right));
}

function additiveResultKind(left, right) {
  if (left.kind === right.kind) return left.kind;
  if (resolvedLengthLike(left) && resolvedLengthLike(right)) return 'length';
  return 'invalid';
}

function compatibleResolvedReports(reports) {
  if (reports.length === 0) return false;
  if (reports.every((report) => report.kind === reports[0].kind)) return true;
  return reports.every(resolvedLengthLike);
}

function invalidReport(error, extra = {}) {
  return {
    valid: false,
    resolved: false,
    kind: 'invalid',
    value: Number.NaN,
    unit: null,
    px: Number.NaN,
    error,
    ...extra,
  };
}

function numberMathReport(value, extra = {}) {
  const valid = Number.isFinite(value) || value === Infinity || value === -Infinity;
  return {
    valid,
    resolved: valid,
    kind: valid ? 'number' : 'invalid',
    unit: null,
    value,
    px: value,
    ...extra,
  };
}

function cssNumericConstantReport(name) {
  switch (String(name || '').toLowerCase()) {
    case 'e': return numberMathReport(Math.E, { constant: 'e' });
    case 'pi': return numberMathReport(Math.PI, { constant: 'pi' });
    case 'infinity': return numberMathReport(Infinity, { constant: 'infinity' });
    case 'nan': return invalidReport('nan-constant', { constant: 'NaN' });
    default: return null;
  }
}

function mathResultFromPx(templateReports, px, extra = {}) {
  const valid = Number.isFinite(px);
  const sameKind = templateReports.length > 0 &&
    templateReports.every((report) => report.kind === templateReports[0].kind);
  const lengthLike = templateReports.length > 0 && templateReports.every(resolvedLengthLike);
  const kind = sameKind ? templateReports[0].kind : (lengthLike ? 'length' : 'number');
  if (kind === 'number') return numberMathReport(px, extra);

  const template = sameKind ? templateReports[0] : null;
  const scale = Number.isFinite(template?.scaleToPx) && Math.abs(template.scaleToPx) > Number.EPSILON
    ? template.scaleToPx
    : 1;
  return {
    valid,
    resolved: valid,
    kind: valid ? kind : 'invalid',
    unit: sameKind ? (template?.unit ?? null) : 'px',
    value: valid ? px / scale : Number.NaN,
    px: valid ? px : Number.NaN,
    scaleToPx: sameKind ? template?.scaleToPx : 1,
    basis: sameKind ? template?.basis : null,
    absolute: sameKind ? template?.absolute : true,
    relative: sameKind ? template?.relative : false,
    viewportRelative: sameKind ? template?.viewportRelative : false,
    fontRelative: sameKind ? template?.fontRelative : false,
    ...extra,
  };
}

function finiteResolvedReports(reports) {
  return reports.every((report) => report.valid && report.resolved && Number.isFinite(report.px));
}

function roundToStep(strategy, value, step) {
  const ratio = value / step;
  switch (strategy) {
    case 'up': return Math.ceil(ratio) * step;
    case 'down': return Math.floor(ratio) * step;
    case 'to-zero': return (ratio < 0 ? Math.ceil(ratio) : Math.floor(ratio)) * step;
    case 'nearest':
    default: return Math.round(ratio) * step;
  }
}

function remValue(value, step) {
  return value - step * Math.trunc(value / step);
}

function resolveCssMathFunction(functionName, reports, options = {}) {
  const args = reports.map((report) => report);
  const meta = { functionName, args };

  if (functionName === 'calc') {
    if (args.length !== 1) return invalidReport('invalid-calc-arity', meta);
    return args[0].valid ? { ...args[0], ...meta } : invalidReport(args[0].error || 'invalid-calc-argument', meta);
  }

  if (functionName === 'min' || functionName === 'max') {
    const valid = args.length > 0 && finiteResolvedReports(args) && compatibleResolvedReports(args);
    if (!valid) return invalidReport('invalid-minmax-arguments', meta);
    const values = args.map((arg) => arg.px);
    return mathResultFromPx(args, functionName === 'min' ? Math.min(...values) : Math.max(...values), meta);
  }

  if (functionName === 'clamp') {
    const valid = args.length === 3 && finiteResolvedReports(args) && compatibleResolvedReports(args);
    if (!valid) return invalidReport('invalid-clamp-arguments', meta);
    return {
      ...mathResultFromPx(args, clamp(args[1].px, args[0].px, args[2].px), meta),
      min: args[0].px,
      value: args[1].px,
      max: args[2].px,
    };
  }

  if (functionName === 'abs') {
    if (args.length !== 1 || !finiteResolvedReports(args)) return invalidReport('invalid-abs-argument', meta);
    return mathResultFromPx(args, Math.abs(args[0].px), meta);
  }

  if (functionName === 'sign') {
    if (args.length !== 1 || !finiteResolvedReports(args)) return invalidReport('invalid-sign-argument', meta);
    return numberMathReport(Math.sign(args[0].px), meta);
  }

  if (functionName === 'round') {
    const strategy = options.strategy || 'nearest';
    const valueReport = args[0];
    const stepReport = args[1] ?? (valueReport?.kind === 'number' ? numberMathReport(1) : null);
    const valid = (args.length === 1 || args.length === 2) &&
      valueReport &&
      stepReport &&
      finiteResolvedReports([valueReport, stepReport]) &&
      compatibleResolvedReports([valueReport, stepReport]) &&
      stepReport.px > Number.EPSILON;
    if (!valid) return invalidReport('invalid-round-arguments', { ...meta, strategy });
    return mathResultFromPx([valueReport, stepReport], roundToStep(strategy, valueReport.px, stepReport.px), { ...meta, strategy });
  }

  if (functionName === 'mod' || functionName === 'rem') {
    const valid = args.length === 2 &&
      finiteResolvedReports(args) &&
      compatibleResolvedReports(args) &&
      Math.abs(args[1].px) > Number.EPSILON;
    if (!valid) return invalidReport(`invalid-${functionName}-arguments`, meta);
    const px = functionName === 'mod'
      ? mod(args[0].px, args[1].px)
      : remValue(args[0].px, args[1].px);
    return mathResultFromPx(args, px, meta);
  }

  const numberArgs = args.every((arg) => arg.valid && arg.resolved && arg.kind === 'number' && Number.isFinite(arg.px));
  if (!numberArgs) return invalidReport('number-arguments-required', meta);
  const values = args.map((arg) => arg.px);
  let value = Number.NaN;

  switch (functionName) {
    case 'sin':
      if (values.length === 1) value = Math.sin(values[0]);
      break;
    case 'cos':
      if (values.length === 1) value = Math.cos(values[0]);
      break;
    case 'tan':
      if (values.length === 1) value = Math.tan(values[0]);
      break;
    case 'asin':
      if (values.length === 1) value = Math.asin(values[0]);
      break;
    case 'acos':
      if (values.length === 1) value = Math.acos(values[0]);
      break;
    case 'atan':
      if (values.length === 1) value = Math.atan(values[0]);
      break;
    case 'atan2':
      if (values.length === 2) value = Math.atan2(values[0], values[1]);
      break;
    case 'pow':
      if (values.length === 2) value = Math.pow(values[0], values[1]);
      break;
    case 'sqrt':
      if (values.length === 1) value = Math.sqrt(values[0]);
      break;
    case 'hypot':
      if (values.length > 0) value = Math.hypot(...values);
      break;
    case 'log':
      if (values.length === 1) value = Math.log(values[0]);
      else if (values.length === 2 && values[1] > 0 && values[1] !== 1) value = Math.log(values[0]) / Math.log(values[1]);
      break;
    case 'exp':
      if (values.length === 1) value = Math.exp(values[0]);
      break;
    default:
      return invalidReport('unsupported-css-math-function', meta);
  }

  return Number.isFinite(value)
    ? numberMathReport(value, meta)
    : invalidReport(`invalid-${functionName}-result`, meta);
}

function combineNumeric(left, right, operator) {
  if (!left.valid || !right.valid) return { valid: false, resolved: false, kind: 'invalid', px: Number.NaN, error: 'invalid-operand' };
  if (operator === '+' || operator === '-') {
    if (!compatibleAdditiveReports(left, right)) return { valid: false, resolved: false, kind: 'invalid', px: Number.NaN, error: 'incompatible-addition' };
    const sign = operator === '+' ? 1 : -1;
    const kind = additiveResultKind(left, right);
    return {
      valid: true,
      resolved: true,
      kind,
      px: left.px + sign * right.px,
      value: kind === 'number' ? left.px + sign * right.px : Number.NaN,
    };
  }
  if (operator === '*') {
    if (left.kind === 'number' && right.kind !== 'number') return { ...right, px: right.px * left.px };
    if (right.kind === 'number' && left.kind !== 'number') return { ...left, px: left.px * right.px };
    if (left.kind === 'number' && right.kind === 'number') return { valid: true, resolved: true, kind: 'number', px: left.px * right.px, value: left.px * right.px };
    return { valid: false, resolved: false, kind: 'invalid', px: Number.NaN, error: 'invalid-multiplication' };
  }
  if (operator === '/') {
    if (right.kind !== 'number' || Math.abs(right.px) <= Number.EPSILON) return { valid: false, resolved: false, kind: 'invalid', px: Number.NaN, error: 'invalid-division' };
    return { ...left, px: left.px / right.px, value: left.kind === 'number' ? left.px / right.px : Number.NaN };
  }
  return { valid: false, resolved: false, kind: 'invalid', px: Number.NaN, error: 'unknown-operator' };
}

function tokenizeExpression(source, context = {}) {
  const tokens = [];
  const text = substituteCssVariables(source, context).trim();
  for (let i = 0; i < text.length;) {
    const char = text[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if ('+-*/(),'.includes(char)) {
      tokens.push({ type: 'operator', value: char });
      i += 1;
      continue;
    }
    const match = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:[a-zA-Z%]+)?/i.exec(text.slice(i));
    if (match) {
      tokens.push({ type: 'value', value: match[0] });
      i += match[0].length;
      continue;
    }
    const identifier = /^[a-zA-Z_][a-zA-Z0-9_-]*/.exec(text.slice(i));
    if (identifier) {
      tokens.push({ type: 'identifier', value: identifier[0] });
      i += identifier[0].length;
      continue;
    }
    if (!match) return { valid: false, tokens, error: `unexpected-token:${char}` };
  }
  return { valid: true, tokens };
}

function evaluateExpression(source, context = {}) {
  const substituted = substituteCssVariables(source, context);
  const tokenized = tokenizeExpression(substituted, context);
  if (!tokenized.valid) return { valid: false, resolved: false, kind: 'invalid', px: Number.NaN, error: tokenized.error };
  const tokens = tokenized.tokens;
  let index = 0;

  function peek() {
    return tokens[index] || null;
  }

  function consume(value = null) {
    const token = tokens[index] || null;
    if (value !== null && token?.value !== value) return null;
    index += 1;
    return token;
  }

  function parseFactor() {
    const token = peek();
    if (!token) return { valid: false, resolved: false, kind: 'invalid', px: Number.NaN, error: 'unexpected-end' };
    if (token.value === '+') {
      consume('+');
      return parseFactor();
    }
    if (token.value === '-') {
      consume('-');
      const value = parseFactor();
      return { ...value, px: -value.px, value: Number.isFinite(value.value) ? -value.value : value.value };
    }
    if (token.value === '(') {
      consume('(');
      const value = parseAdditive();
      if (!consume(')')) return { valid: false, resolved: false, kind: 'invalid', px: Number.NaN, error: 'missing-close-paren' };
      return value;
    }
    if (token.type === 'identifier') {
      const name = consume().value.toLowerCase();
      if (peek()?.value === '(') return parseFunctionCall(name);
      const constant = cssNumericConstantReport(name);
      return constant || invalidReport('unknown-identifier', { identifier: name });
    }
    consume();
    return parsePrimitiveLengthToken(token.value, context, '');
  }

  function parseFunctionCall(name) {
    if (!CSS_LAYOUT_MATH_FUNCTIONS.has(name)) return invalidReport('unsupported-css-math-function', { functionName: name });
    consume('(');
    let strategy = 'nearest';
    if (name === 'round' && peek()?.type === 'identifier' && CSS_ROUNDING_STRATEGIES.has(peek().value.toLowerCase())) {
      const next = tokens[index + 1] || null;
      if (next?.value === ',') {
        strategy = consume().value.toLowerCase();
        consume(',');
      }
    }
    const args = [];
    if (peek()?.value !== ')') {
      while (peek()) {
        args.push(parseAdditive());
        if (peek()?.value === ',') {
          consume(',');
          continue;
        }
        break;
      }
    }
    if (!consume(')')) return invalidReport('missing-close-paren', { functionName: name, args });
    return resolveCssMathFunction(name, args, { strategy });
  }

  function parseMultiplicative() {
    let left = parseFactor();
    while (peek()?.value === '*' || peek()?.value === '/') {
      const operator = consume().value;
      left = combineNumeric(left, parseFactor(), operator);
    }
    return left;
  }

  function parseAdditive() {
    let left = parseMultiplicative();
    while (peek()?.value === '+' || peek()?.value === '-') {
      const operator = consume().value;
      left = combineNumeric(left, parseMultiplicative(), operator);
    }
    return left;
  }

  const result = parseAdditive();
  if (index !== tokens.length) return { valid: false, resolved: false, kind: 'invalid', px: Number.NaN, error: 'trailing-tokens' };
  return { ...result, expression: source, substitutedExpression: substituted };
}

function parseFunction(value) {
  const text = String(value).trim();
  const open = text.indexOf('(');
  if (open <= 0 || !text.endsWith(')')) return null;
  return {
    name: text.slice(0, open).trim().toLowerCase(),
    body: text.slice(open + 1, -1).trim(),
  };
}

function parseFlexTrackToken(value) {
  const match = FLEX_TRACK_RE.exec(String(value || '').trim());
  if (!match) return null;
  const flexFactor = finiteNumber(Number(match[1]), Number.NaN);
  return {
    valid: Number.isFinite(flexFactor) && flexFactor >= 0,
    kind: 'flex',
    unit: 'fr',
    flexFactor,
    raw: String(value),
  };
}

function intrinsicContribution(options = {}, index = 0) {
  const tracks = options.trackIntrinsicSizes || options.intrinsicTracks || options.trackContributions || [];
  const source = Array.isArray(tracks) ? (tracks[index] || {}) : tracks;
  const minContent = Math.max(0, finiteNumber(
    source.minContentSize ?? source.minContent ?? options.minContentSize ?? options.minContent,
    0
  ));
  const maxContent = Math.max(minContent, finiteNumber(
    source.maxContentSize ?? source.maxContent ?? options.maxContentSize ?? options.maxContent,
    minContent
  ));
  const autoMinimum = Math.max(0, finiteNumber(
    source.autoMinimumSize ?? source.autoMinimum ?? source.minimumSize ?? source.minSize ?? options.autoMinimumSize,
    minContent
  ));
  return {
    minContent,
    maxContent,
    autoMinimum,
  };
}

function breadthBaseSize(breadth, contribution) {
  if (!breadth.valid) return Number.NaN;
  if (breadth.kind === 'fixed') return breadth.px;
  if (breadth.kind === 'intrinsic') {
    if (breadth.keyword === 'min-content') return contribution.minContent;
    if (breadth.keyword === 'max-content') return contribution.maxContent;
    if (breadth.keyword === 'auto') return contribution.autoMinimum;
  }
  if (breadth.kind === 'fit-content') return contribution.autoMinimum;
  if (breadth.kind === 'flex') return 0;
  return Number.NaN;
}

function breadthGrowthLimit(breadth, contribution) {
  if (!breadth.valid) return Number.NaN;
  if (breadth.kind === 'fixed') return breadth.px;
  if (breadth.kind === 'intrinsic') {
    if (breadth.keyword === 'min-content') return contribution.minContent;
    if (breadth.keyword === 'max-content') return contribution.maxContent;
    if (breadth.keyword === 'auto') return contribution.maxContent;
  }
  if (breadth.kind === 'fit-content') {
    return Math.max(contribution.autoMinimum, Math.min(breadth.limit, contribution.maxContent));
  }
  if (breadth.kind === 'flex') return Infinity;
  return Number.NaN;
}

function parseTrackBreadth(value, context = {}, options = {}, index = 0) {
  const raw = String(value ?? '').trim();
  const lower = raw.toLowerCase();
  const contribution = intrinsicContribution(options, index);
  const flex = parseFlexTrackToken(raw);
  if (flex) return flex;

  if (lower === 'auto' || lower === 'min-content' || lower === 'max-content') {
    return {
      valid: true,
      kind: 'intrinsic',
      keyword: lower,
      raw,
    };
  }

  const fn = parseFunction(raw);
  if (fn?.name === 'fit-content') {
    const argument = splitFunctionArguments(fn.body)[0] ?? '0px';
    const limitReport = uiLayoutValueReport(argument, context);
    const limit = limitReport.resolved ? Math.max(0, limitReport.px) : Infinity;
    return {
      valid: limitReport.valid,
      kind: 'fit-content',
      raw,
      argument,
      limit,
      limitReport,
      contribution,
    };
  }

  const report = uiLayoutValueReport(raw, context);
  return {
    valid: report.valid && report.resolved && Number.isFinite(report.px) && report.px >= 0,
    kind: 'fixed',
    raw,
    px: report.px,
    valueReport: report,
  };
}

function parseGridTrack(value, context = {}, options = {}, index = 0) {
  if (value && typeof value === 'object' && value.invalidRepeat) {
    return {
      valid: false,
      index,
      raw: value.raw,
      trackType: 'repeat',
      error: value.error,
      minFunction: { valid: false, kind: 'invalid' },
      maxFunction: { valid: false, kind: 'invalid' },
      contribution: intrinsicContribution(options, index),
      baseSize: Number.NaN,
      growthLimit: Number.NaN,
      flexFactor: 0,
      flexible: false,
      intrinsic: false,
      fixed: false,
    };
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const min = value.min ?? value.minTrack ?? value.base ?? value.size ?? 'auto';
    const max = value.max ?? value.maxTrack ?? value.limit ?? value.size ?? min;
    return parseGridTrack(`minmax(${min}, ${max})`, context, options, index);
  }

  const raw = String(value ?? '').trim();
  const contribution = intrinsicContribution(options, index);
  const fn = parseFunction(raw);
  let minFunction;
  let maxFunction;
  let trackType = 'single';

  if (fn?.name === 'minmax') {
    const args = splitFunctionArguments(fn.body);
    minFunction = parseTrackBreadth(args[0] ?? 'auto', context, options, index);
    maxFunction = parseTrackBreadth(args[1] ?? args[0] ?? 'auto', context, options, index);
    trackType = 'minmax';
    if (minFunction.kind === 'flex') {
      minFunction = { ...minFunction, valid: false, error: 'flex-min-invalid' };
    }
  } else if (fn?.name === 'fit-content') {
    const fit = parseTrackBreadth(raw, context, options, index);
    minFunction = { valid: true, kind: 'intrinsic', keyword: 'auto', raw: 'auto' };
    maxFunction = fit;
    trackType = 'fit-content';
  } else {
    const breadth = parseTrackBreadth(raw, context, options, index);
    if (breadth.kind === 'flex') {
      minFunction = { valid: true, kind: 'intrinsic', keyword: 'auto', raw: 'auto' };
      maxFunction = breadth;
      trackType = 'flex';
    } else {
      minFunction = breadth;
      maxFunction = breadth.kind === 'intrinsic' && breadth.keyword === 'auto'
        ? { ...breadth }
        : breadth;
      trackType = breadth.kind;
    }
  }

  const baseSize = Math.max(0, breadthBaseSize(minFunction, contribution));
  const rawGrowthLimit = breadthGrowthLimit(maxFunction, contribution);
  const growthLimit = Number.isFinite(rawGrowthLimit)
    ? Math.max(baseSize, rawGrowthLimit)
    : rawGrowthLimit;
  const flexible = maxFunction.kind === 'flex';
  return {
    valid: Boolean(minFunction.valid && maxFunction.valid && Number.isFinite(baseSize)),
    index,
    raw,
    trackType,
    minFunction,
    maxFunction,
    contribution,
    baseSize,
    growthLimit,
    flexFactor: flexible ? maxFunction.flexFactor : 0,
    flexible,
    intrinsic: minFunction.kind === 'intrinsic' || maxFunction.kind === 'intrinsic' || maxFunction.kind === 'fit-content',
    fixed: Number.isFinite(growthLimit) && !flexible,
  };
}

function expandRepeatTrackToken(token, context = {}, options = {}) {
  const fn = parseFunction(token);
  if (fn?.name !== 'repeat') return [token];
  const args = splitFunctionArguments(fn.body);
  const repeatCount = Number.parseInt(args[0], 10);
  const body = args.slice(1).join(', ');
  if (!Number.isInteger(repeatCount) || repeatCount < 1 || repeatCount > finiteNumber(options.maxRepeatCount, 256)) {
    return [{ raw: token, invalidRepeat: true, error: 'unsupported-repeat-count' }];
  }
  const bodyTokens = normalizeGridTrackList(body, context, options);
  const expanded = [];
  for (let i = 0; i < repeatCount; i += 1) {
    expanded.push(...bodyTokens);
  }
  return expanded;
}

function normalizeGridTrackList(trackList, context = {}, options = {}) {
  if (Array.isArray(trackList)) {
    return trackList.flatMap((track) => typeof track === 'string'
      ? expandRepeatTrackToken(track, context, options)
      : [track]
    );
  }
  const text = String(trackList ?? '').trim();
  if (!text || text.toLowerCase() === 'none') return [];
  const tokens = splitTopLevelTokens(text).filter((token) => !isLineNameToken(token));
  return tokens.flatMap((token) => expandRepeatTrackToken(token, context, options));
}

function fixedGridTrackSize(track) {
  if (track.flexible) return track.baseSize;
  return Number.isFinite(track.growthLimit) ? track.growthLimit : track.baseSize;
}

function findDefiniteGridFlexFraction(tracks, availableSize, gutterTotal) {
  const frozen = new Set();
  const flexibleTracks = tracks.filter((track) => track.flexible);
  if (flexibleTracks.length === 0) return 0;

  for (let pass = 0; pass <= flexibleTracks.length; pass += 1) {
    const fixedSize = tracks.reduce((sum, track) => {
      if (!track.flexible || frozen.has(track.index)) return sum + fixedGridTrackSize(track);
      return sum;
    }, 0);
    const unfrozen = flexibleTracks.filter((track) => !frozen.has(track.index));
    if (unfrozen.length === 0) return 0;
    const flexFactorSum = unfrozen.reduce((sum, track) => sum + track.flexFactor, 0);
    const leftover = Math.max(0, availableSize - gutterTotal - fixedSize);
    const hypothetical = leftover / Math.max(1, flexFactorSum);
    const underBase = unfrozen.filter((track) => hypothetical * track.flexFactor < track.baseSize);
    if (underBase.length === 0) return hypothetical;
    underBase.forEach((track) => frozen.add(track.index));
  }

  return 0;
}

function resolveFunctionValue(text, context = {}) {
  const fn = parseFunction(text);
  if (!fn) return null;
  if (fn.name === 'calc') return evaluateExpression(fn.body, context);

  const args = splitFunctionArguments(fn.body);
  if (fn.name === 'min' || fn.name === 'max') {
    const reports = args.map((arg) => uiLayoutValueReport(arg, context));
    const valid = reports.length > 0 && reports.every((report) => report.valid && report.resolved);
    const compatible = compatibleResolvedReports(reports);
    const values = reports.map((report) => report.px);
    return {
      valid: valid && compatible,
      resolved: valid && compatible,
      kind: compatible && reports.every((report) => report.kind === reports[0]?.kind) ? reports[0]?.kind : 'length',
      functionName: fn.name,
      args: reports,
      px: valid && compatible ? (fn.name === 'min' ? Math.min(...values) : Math.max(...values)) : Number.NaN,
    };
  }

  if (fn.name === 'clamp') {
    const reports = args.map((arg) => uiLayoutValueReport(arg, context));
    const valid = reports.length === 3 && reports.every((report) => report.valid && report.resolved) &&
      compatibleResolvedReports(reports);
    const sameKind = reports.every((report) => report.kind === reports[0]?.kind);
    return {
      valid,
      resolved: valid,
      kind: valid && sameKind ? reports[0]?.kind : 'length',
      functionName: fn.name,
      args: reports,
      min: reports[0]?.px ?? Number.NaN,
      value: reports[1]?.px ?? Number.NaN,
      max: reports[2]?.px ?? Number.NaN,
      px: valid ? clamp(reports[1].px, reports[0].px, reports[2].px) : Number.NaN,
    };
  }

  if (fn.name === 'fit-content') {
    const argument = args[0] ?? '0px';
    const report = uiFitContentReport({
      availableSize: context.availableSize ?? context.containerSize,
      minContentSize: context.minContentSize ?? 0,
      maxContentSize: context.maxContentSize ?? Infinity,
      fitContentLimit: argument,
      context,
    });
    return {
      valid: report.valid,
      resolved: report.valid,
      kind: 'length',
      functionName: fn.name,
      fitContent: report,
      px: report.usedSize,
    };
  }

  if (CSS_LAYOUT_MATH_FUNCTIONS.has(fn.name)) return evaluateExpression(text, context);
  return null;
}

export function uiCssUnitMetadata(unit, context = {}) {
  const normalizedUnit = String(unit || '').trim().toLowerCase();
  if (normalizedUnit === '') {
    return { valid: true, unit: null, kind: 'number', scaleToPx: 1, absolute: false, relative: false };
  }
  const sample = primitiveLengthReport(1, normalizedUnit, context);
  return {
    valid: sample.valid || normalizedUnit === '%' || CSS_LAYOUT_KEYWORDS.has(normalizedUnit),
    unit: normalizedUnit,
    kind: CSS_LAYOUT_KEYWORDS.has(normalizedUnit) ? 'keyword' : sample.kind,
    scaleToPx: sample.scaleToPx,
    basis: sample.basis,
    absolute: sample.absolute,
    relative: sample.relative,
    viewportRelative: sample.viewportRelative,
    fontRelative: sample.fontRelative,
  };
}

export function uiCssMathFunctionReport(value, context = {}) {
  const source = String(value ?? '').trim();
  const fn = parseFunction(source);
  if (!fn) return invalidReport('not-a-css-function', { source, functionName: null, valueReport: null });
  const supported = CSS_LAYOUT_MATH_FUNCTIONS.has(fn.name);
  const valueReport = uiLayoutValueReport(source, context);
  return {
    valid: supported && valueReport.valid,
    resolved: supported && valueReport.resolved,
    supported,
    source,
    functionName: fn.name,
    args: valueReport.args || splitFunctionArguments(fn.body),
    kind: supported ? valueReport.kind : 'invalid',
    unit: supported ? (valueReport.unit ?? null) : null,
    value: supported ? valueReport.value : Number.NaN,
    px: supported ? valueReport.px : Number.NaN,
    valueReport,
    error: supported ? valueReport.error : 'unsupported-css-math-function',
  };
}

export function uiLayoutValueReport(value, context = {}) {
  if (typeof value === 'number') return primitiveLengthReport(value, 'px', context);
  if (value && typeof value === 'object') {
    if ('px' in value) return primitiveLengthReport(Number(value.px), 'px', context);
    if ('value' in value || 'unit' in value) return primitiveLengthReport(Number(value.value ?? 0), value.unit || 'px', context);
  }

  const text = String(value ?? '').trim();
  const lower = text.toLowerCase();
  if (CSS_LAYOUT_KEYWORDS.has(lower)) {
    return {
      valid: true,
      resolved: false,
      kind: 'keyword',
      keyword: lower,
      value: text,
      px: Number.NaN,
    };
  }

  if (lower.startsWith('var(') || lower.startsWith('env(')) {
    return uiLayoutValueReport(substituteCssVariables(text, context), context);
  }

  const functionReport = resolveFunctionValue(text, context);
  if (functionReport) return functionReport;
  return parsePrimitiveLengthToken(text, context);
}

export function uiPercentageBasisReport(value, basis, options = {}) {
  const report = uiLayoutValueReport(value, { ...options, percentageBasis: basis });
  const percentText = typeof value === 'string' && value.trim().endsWith('%') ? Number.parseFloat(value) : Number.NaN;
  return {
    valid: report.valid && report.resolved && Number.isFinite(Number(basis)),
    basis: Number(basis),
    percent: Number.isFinite(percentText) ? percentText : Number.NaN,
    ratio: Number.isFinite(percentText) ? percentText / 100 : Number.NaN,
    px: report.px,
    valueReport: report,
  };
}

export function uiViewportUnitReport(value, viewport = {}, options = {}) {
  const context = { ...options, viewport };
  const report = uiLayoutValueReport(value, context);
  return {
    valid: report.valid && report.resolved,
    viewport: viewportFromContext(context),
    valueReport: report,
    px: report.px,
  };
}

export function uiSafeAreaInsetReport(insets = {}, options = {}) {
  const context = { ...options, safeAreaInsets: insets.safeAreaInsets || insets.safeArea || insets };
  const normalized = safeAreaInsetsFromContext(context);
  const direction = String(options.direction || options.dir || 'ltr').toLowerCase();
  const inlineStart = direction === 'rtl' ? normalized.right : normalized.left;
  const inlineEnd = direction === 'rtl' ? normalized.left : normalized.right;
  const maxInset = Math.max(normalized.top, normalized.right, normalized.bottom, normalized.left);
  return {
    valid: true,
    ...normalized,
    inlineStart,
    inlineEnd,
    blockStart: normalized.top,
    blockEnd: normalized.bottom,
    maxInset,
    hasInsets: maxInset > 0,
    cssEnvironment: {
      'safe-area-inset-top': `${normalized.top}px`,
      'safe-area-inset-right': `${normalized.right}px`,
      'safe-area-inset-bottom': `${normalized.bottom}px`,
      'safe-area-inset-left': `${normalized.left}px`,
    },
  };
}

export function uiVisualViewportReport(observed = {}, options = {}) {
  const context = { ...options, ...(observed.context || {}) };
  const visualViewport = visualViewportFromContext({
    ...context,
    visualViewport: observed.visualViewport || observed,
    layoutViewport: observed.layoutViewport || options.layoutViewport || context.layoutViewport,
  });
  const layoutViewport = viewportFromContext(observed.layoutViewport || options.layoutViewport || context);
  const safeArea = uiSafeAreaInsetReport(observed.safeAreaInsets || observed.safeArea || options.safeAreaInsets || options.safeArea || {});
  const usableWidth = Math.max(0, visualViewport.width - safeArea.left - safeArea.right);
  const usableHeight = Math.max(0, visualViewport.height - safeArea.top - safeArea.bottom);
  return {
    valid: visualViewport.width > 0 && visualViewport.height > 0,
    visualViewport,
    layoutViewport,
    safeArea,
    usableWidth,
    usableHeight,
    scaledWidth: visualViewport.width * visualViewport.scale,
    scaledHeight: visualViewport.height * visualViewport.scale,
    offsetLeft: visualViewport.offsetLeft,
    offsetTop: visualViewport.offsetTop,
    pageLeft: visualViewport.pageLeft,
    pageTop: visualViewport.pageTop,
    scale: visualViewport.scale,
  };
}

export function uiLayoutClampReport(value, minValue, maxValue, context = {}) {
  const valueReport = uiLayoutValueReport(value, context);
  const minReport = uiLayoutValueReport(minValue, context);
  const maxReport = uiLayoutValueReport(maxValue, context);
  const valid = valueReport.valid && valueReport.resolved &&
    minReport.valid && minReport.resolved &&
    maxReport.valid && maxReport.resolved;
  return {
    valid,
    value: valueReport.px,
    min: minReport.px,
    max: maxReport.px,
    px: valid ? clamp(valueReport.px, minReport.px, maxReport.px) : Number.NaN,
    clamped: valid ? valueReport.px < minReport.px || valueReport.px > maxReport.px : false,
    valueReport,
    minReport,
    maxReport,
  };
}

export function uiBoxConstraintReport(style = {}, context = {}) {
  const axis = String(context.axis || 'width');
  const availableSize = finiteMaybeInfinity(context.availableSize ?? context.containerSize, Infinity);
  const minName = axis === 'height' ? 'minHeight' : 'minWidth';
  const maxName = axis === 'height' ? 'maxHeight' : 'maxWidth';
  const preferredName = axis === 'height' ? 'height' : 'width';
  const minReport = uiLayoutValueReport(style[minName] ?? 0, { ...context, percentageBasis: availableSize });
  const maxInput = style[maxName] === undefined || style[maxName] === 'none' ? Infinity : style[maxName];
  const maxReport = maxInput === Infinity
    ? { valid: true, resolved: true, kind: 'length', px: Infinity }
    : uiLayoutValueReport(maxInput, { ...context, percentageBasis: availableSize });
  const preferredInput = style[preferredName] ?? style.size ?? availableSize;
  const preferredReport = uiLayoutValueReport(preferredInput, { ...context, percentageBasis: availableSize });
  const preferredPx = preferredReport.resolved ? preferredReport.px : availableSize;
  const minPx = minReport.resolved ? minReport.px : 0;
  const maxPx = maxReport.resolved ? maxReport.px : Infinity;
  const valid = minReport.valid && maxReport.valid && preferredReport.valid && minPx <= maxPx;
  const usedSize = valid ? clamp(preferredPx, minPx, maxPx) : Number.NaN;
  return {
    valid,
    axis,
    min: minPx,
    max: maxPx,
    preferred: preferredPx,
    usedSize,
    satisfiesPreferred: valid && preferredPx >= minPx && preferredPx <= maxPx,
    tight: valid && minPx === maxPx,
    loose: valid && maxPx - minPx > Math.max(1, minPx * 0.5),
    availableSize,
    minReport,
    maxReport,
    preferredReport,
  };
}

export function uiFlexBasisReport(style = {}, context = {}) {
  const direction = String(context.direction || style.flexDirection || 'row').toLowerCase();
  const mainAxis = direction.includes('column') ? 'height' : 'width';
  const availableSize = context.availableSize ?? context.containerSize;
  const definiteBasis = Number.isFinite(Number(availableSize));
  const flexBasis = style.flexBasis ?? style['flex-basis'] ?? 'auto';
  const basisText = String(flexBasis).trim().toLowerCase();

  if (basisText === 'content') {
    return { valid: true, resolved: false, basisType: 'content', mainAxis, flexBasis, usedSize: Number.NaN };
  }

  if (basisText === 'auto') {
    const mainSizeValue = style[mainAxis];
    const mainReport = mainSizeValue === undefined
      ? { valid: true, resolved: false, keyword: 'content', px: Number.NaN }
      : uiLayoutValueReport(mainSizeValue, { ...context, percentageBasis: availableSize });
    return {
      valid: mainReport.valid,
      resolved: mainReport.resolved,
      basisType: mainReport.resolved ? 'main-size' : 'content',
      mainAxis,
      flexBasis,
      usedSize: mainReport.resolved ? mainReport.px : Number.NaN,
      mainSizeReport: mainReport,
    };
  }

  const valueReport = uiLayoutValueReport(flexBasis, { ...context, percentageBasis: availableSize });
  const percentageWithIndefiniteBasis = typeof flexBasis === 'string' && flexBasis.trim().endsWith('%') && !definiteBasis;
  return {
    valid: percentageWithIndefiniteBasis ? true : valueReport.valid,
    resolved: valueReport.resolved && !percentageWithIndefiniteBasis,
    basisType: percentageWithIndefiniteBasis ? 'content' : 'length',
    mainAxis,
    flexBasis,
    usedSize: valueReport.resolved && !percentageWithIndefiniteBasis ? valueReport.px : Number.NaN,
    valueReport,
    indefinitePercentageBasis: percentageWithIndefiniteBasis,
  };
}

export function uiFitContentReport(options = {}) {
  const context = options.context || options;
  const availableSize = finiteMaybeInfinity(options.availableSize ?? options.stretchSize ?? context.availableSize, Infinity);
  const minContentSize = Math.max(0, finiteNumber(options.minContentSize ?? options.minContent, 0));
  const maxContentSize = Math.max(minContentSize, finiteMaybeInfinity(options.maxContentSize ?? options.maxContent, Infinity));
  const limitValue = options.fitContentLimit ?? options.limit ?? availableSize;
  const limitReport = uiLayoutValueReport(limitValue, { ...context, percentageBasis: availableSize });
  const limit = limitReport.resolved ? limitReport.px : availableSize;
  const usedSize = Math.min(maxContentSize, Math.max(minContentSize, limit));
  return {
    valid: limitReport.valid && minContentSize <= maxContentSize,
    minContentSize,
    maxContentSize,
    availableSize,
    limit,
    usedSize,
    clampedByMinContent: usedSize === minContentSize && limit < minContentSize,
    clampedByMaxContent: usedSize === maxContentSize && limit > maxContentSize,
    limitReport,
  };
}

export function uiIntrinsicSizePolicyReport(value = 'auto', options = {}) {
  const context = options.context || options;
  const availableSize = finiteMaybeInfinity(options.availableSize ?? options.stretchSize ?? context.availableSize, Infinity);
  const minContentSize = Math.max(0, finiteNumber(options.minContentSize ?? options.minContent, 0));
  const maxContentSize = Math.max(minContentSize, finiteMaybeInfinity(options.maxContentSize ?? options.maxContent, minContentSize));
  const autoSize = Math.max(0, finiteMaybeInfinity(options.autoSize ?? options.automaticSize, Number.isFinite(availableSize) ? availableSize : maxContentSize));
  const text = String(value ?? 'auto').trim();
  const lower = text.toLowerCase();
  const fn = parseFunction(text);

  let keyword = lower;
  let usedSize = Number.NaN;
  let valueReport = null;
  let fitContent = null;
  let resolved = true;
  let reason = null;

  if (lower === 'min-content') {
    usedSize = minContentSize;
  } else if (lower === 'max-content') {
    usedSize = maxContentSize;
  } else if (lower === 'fit-content' || fn?.name === 'fit-content') {
    keyword = 'fit-content';
    fitContent = fn?.name === 'fit-content'
      ? uiFitContentReport({
        availableSize,
        minContentSize,
        maxContentSize,
        fitContentLimit: splitFunctionArguments(fn.body)[0] ?? availableSize,
        context,
      })
      : uiFitContentReport({ availableSize, minContentSize, maxContentSize, context });
    usedSize = fitContent.usedSize;
    valueReport = fitContent.limitReport;
  } else if (lower === 'stretch') {
    usedSize = Number.isFinite(availableSize) ? availableSize : maxContentSize;
    resolved = Number.isFinite(usedSize);
    reason = resolved ? null : 'indefinite-stretch-size';
  } else if (lower === 'auto' || lower === 'content') {
    usedSize = autoSize;
    keyword = lower;
  } else {
    valueReport = uiLayoutValueReport(text, { ...context, percentageBasis: availableSize });
    usedSize = valueReport.resolved ? Math.max(0, valueReport.px) : Number.NaN;
    keyword = valueReport.valid ? 'length' : 'invalid';
  }

  const valid = keyword !== 'invalid' &&
    (valueReport ? valueReport.valid : true) &&
    (fitContent ? fitContent.valid : true) &&
    (!resolved || Number.isFinite(usedSize));
  return {
    valid,
    resolved,
    value: text,
    keyword,
    minContentSize,
    maxContentSize,
    availableSize,
    autoSize,
    usedSize,
    clampedByMinContent: valid && usedSize === minContentSize && usedSize < maxContentSize,
    clampedByMaxContent: valid && usedSize === maxContentSize && usedSize > minContentSize,
    fitContent,
    valueReport,
    reason,
  };
}

export function uiGridTrackSizingReport(trackList = [], options = {}) {
  const availableSize = finiteMaybeInfinity(options.availableSize ?? options.containerSize, Infinity);
  const context = { ...options, percentageBasis: availableSize, availableSize };
  const axis = String(options.axis || 'inline');
  const rawTracks = normalizeGridTrackList(trackList, context, options);
  const gapReport = uiLayoutValueReport(options.gap ?? options.columnGap ?? options.rowGap ?? 0, context);
  const gap = gapReport.resolved ? Math.max(0, gapReport.px) : 0;
  const tracks = rawTracks.map((track, index) => parseGridTrack(track, context, options, index));
  const validTracks = tracks.every((track) => track.valid);
  const gutterTotal = Math.max(0, tracks.length - 1) * gap;
  const finiteAvailable = Number.isFinite(availableSize);
  let flexFraction = 0;

  const nonFlexibleSize = tracks.reduce((sum, track) => {
    if (track.flexible) return sum;
    const used = Number.isFinite(track.growthLimit) ? track.growthLimit : track.baseSize;
    return sum + (Number.isFinite(used) ? used : 0);
  }, 0);
  const flexBaseSize = tracks.reduce((sum, track) => sum + (track.flexible ? track.baseSize : 0), 0);
  const flexFactorSum = tracks.reduce((sum, track) => sum + (track.flexible ? track.flexFactor : 0), 0);

  if (flexFactorSum > 0) {
    if (finiteAvailable) {
      flexFraction = findDefiniteGridFlexFraction(tracks, availableSize, gutterTotal);
    } else {
      flexFraction = tracks.reduce((maxFraction, track) => {
        if (!track.flexible) return maxFraction;
        const maxContent = track.contribution.maxContent;
        const factor = Math.max(track.flexFactor, 1);
        return Math.max(maxFraction, maxContent / factor);
      }, 0);
    }
  }

  const sizedTracks = tracks.map((track) => {
    const finalSize = track.flexible
      ? Math.max(track.baseSize, flexFraction * track.flexFactor)
      : (Number.isFinite(track.growthLimit) ? track.growthLimit : track.baseSize);
    return {
      ...track,
      finalSize,
      clampedByGrowthLimit: Number.isFinite(track.growthLimit) && finalSize === track.growthLimit && finalSize > track.baseSize,
    };
  });

  const totalBaseSize = tracks.reduce((sum, track) => sum + (Number.isFinite(track.baseSize) ? track.baseSize : 0), 0) + gutterTotal;
  const totalUsedSize = sizedTracks.reduce((sum, track) => sum + (Number.isFinite(track.finalSize) ? track.finalSize : 0), 0) + gutterTotal;
  const lineOffsets = [0];
  let cursor = 0;
  for (let i = 0; i < sizedTracks.length; i += 1) {
    cursor += sizedTracks[i].finalSize;
    lineOffsets.push(cursor);
    if (i < sizedTracks.length - 1) cursor += gap;
  }

  return {
    valid: validTracks && gapReport.valid,
    axis,
    availableSize,
    finiteAvailable,
    gap,
    gutterTotal,
    trackCount: sizedTracks.length,
    tracks: sizedTracks,
    totalBaseSize,
    totalUsedSize,
    freeSpace: finiteAvailable ? Math.max(0, availableSize - totalUsedSize) : Infinity,
    overflow: finiteAvailable ? Math.max(0, totalUsedSize - availableSize) : 0,
    flexFactorSum,
    flexFraction,
    nonFlexibleSize,
    flexBaseSize,
    lineOffsets,
    gapReport,
  };
}

export function uiResponsiveStepReport(value, steps = [], options = {}) {
  const current = finiteNumber(value, 0);
  const sorted = [...steps].map((step, index) => {
    if (typeof step === 'number') return { min: step, max: Infinity, label: String(step), index };
    return {
      min: finiteMaybeInfinity(step.min ?? step.from ?? -Infinity, -Infinity),
      max: finiteMaybeInfinity(step.max ?? step.to ?? Infinity, Infinity),
      label: step.label ?? step.name ?? String(index),
      value: step.value,
      index,
    };
  }).sort((a, b) => a.min - b.min || a.index - b.index);
  const matches = sorted.filter((step) => current >= step.min && current < step.max);
  const selected = options.lastMatch === false ? matches[0] ?? null : matches[matches.length - 1] ?? null;
  return {
    valid: sorted.length > 0,
    value: current,
    selected,
    selectedIndex: selected?.index ?? -1,
    selectedLabel: selected?.label ?? null,
    matches,
    stepCount: sorted.length,
  };
}
