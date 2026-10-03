// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// ExactCalculationReceipt.js - content-addressed exact-arithmetic replay evidence.

import { canonicalSchemaValue } from '../schema/SchemaEvolutionRegistry.js';
import { encodeUtf8 } from './BufferMath.js';
import { contentHashHex } from './ChecksumMath.js';
import {
  DEFAULT_EXACT_CALCULATOR_LIMITS,
  EXACT_CALCULATOR_CORE_VERSION,
  createExactCalculatorLimits,
  evaluateExactAst,
  formatExactValue,
  parseExactExpression,
  serializeExactAst,
  serializeExactValue,
} from './ExactCalculatorCore.js';

export const EXACT_CALCULATION_RECEIPT_FORMAT = 'particle-realms/exact-calculation-receipt/v1';
export const EXACT_CALCULATION_RECEIPT_VERSION = 1;
export const EXACT_CALCULATION_RECEIPT_MAX_BYTES = 256 * 1024;
export const EXACT_CALCULATION_EPISTEMIC_STATUS = 'exact_arithmetic_evaluation';
export const EXACT_CALCULATION_PROOF_STATUS = 'not-a-formal-proof';

export const EXACT_CALCULATION_RECEIPT_ERROR_CODES = Object.freeze({
  INVALID_RECEIPT: 'INVALID_RECEIPT',
  RECEIPT_SIZE_EXCEEDED: 'RECEIPT_SIZE_EXCEEDED',
  REPLAY_FAILED: 'REPLAY_FAILED',
  CONTENT_MISMATCH: 'CONTENT_MISMATCH',
  ID_MISMATCH: 'ID_MISMATCH',
});

const HASH_DOMAIN = 'particle-realms.exact-calculation-receipt';
const HASH_VERSION = 'v1';
const RECEIPT_ID_PATTERN = /^math:sha256:[0-9a-f]{64}$/;
const MODE = 'exact-integer-rational';
const REPLAY_METHOD = 'deterministic-replay';
const EVALUATOR = `exact-calculator-core@${EXACT_CALCULATOR_CORE_VERSION}`;
const LIMIT_FIELDS = Object.freeze(Object.keys(DEFAULT_EXACT_CALCULATOR_LIMITS).sort());
const USAGE_FIELDS = Object.freeze([
  'sourceLength',
  'tokenCount',
  'nodeCount',
  'astDepth',
  'workSteps',
  'resultBits',
  'displayLength',
  'outputLength',
].sort());
const RECEIPT_FIELDS = Object.freeze([
  'format',
  'version',
  'id',
  'request',
  'statement',
  'result',
  'epistemicStatus',
  'assumptions',
  'verification',
  'usage',
].sort());

export class ExactCalculationReceiptError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ExactCalculationReceiptError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details = {}) {
  throw new ExactCalculationReceiptError(code, message, details);
}

function sameKeys(actual, expected) {
  if (actual.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index++) {
    if (actual[index] !== expected[index]) return false;
  }
  return true;
}

/** Snapshot enumerable data properties without retaining caller-owned objects. */
function snapshotRecord(value, expectedFields, label, { allowSubset = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, `${label} must be a plain object`);
  }
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, `${label} could not be inspected`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, `${label} must be a plain object`);
  }

  const descriptorKeys = Reflect.ownKeys(descriptors);
  if (descriptorKeys.some(key => typeof key !== 'string')) {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, `${label} must not contain symbol fields`);
  }
  const keys = descriptorKeys.sort();
  if (allowSubset) {
    if (keys.some(key => !expectedFields.includes(key))) {
      fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, `${label} contains an unknown field`);
    }
  } else if (!sameKeys(keys, expectedFields)) {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, `${label} has unknown or missing fields`);
  }

  // A null prototype keeps absent optional fields absent even when the host
  // realm's Object.prototype has been polluted.
  const snapshot = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, `${label}.${key} must be an enumerable data field`);
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function snapshotEmptyArray(value, label) {
  if (!Array.isArray(value)) {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, `${label} must be an array`);
  }
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, `${label} could not be inspected`);
  }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 1 || keys[0] !== 'length' || descriptors.length?.value !== 0) {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, `${label} must be empty`);
  }
  return Object.freeze([]);
}

function requiredString(value, label, maximum = EXACT_CALCULATION_RECEIPT_MAX_BYTES) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, `${label} must be a bounded non-empty string`);
  }
  return value;
}

function nonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, `${label} must be a non-negative safe integer`);
  }
  return value;
}

function snapshotLimitOverrides(value) {
  if (value === undefined) return createExactCalculatorLimits({});
  const fields = snapshotRecord(value, LIMIT_FIELDS, 'Exact calculation limit overrides', { allowSubset: true });
  return createExactCalculatorLimits(fields);
}

function limitsFromCreationOptions(options) {
  if (options === undefined) return createExactCalculatorLimits({});
  const fields = snapshotRecord(options, ['limits'], 'Exact calculation receipt options', { allowSubset: true });
  return snapshotLimitOverrides(fields.limits);
}

function snapshotResolvedLimits(value) {
  const fields = snapshotRecord(value, LIMIT_FIELDS, 'receipt.request.limits');
  try {
    return createExactCalculatorLimits(fields);
  } catch (error) {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, 'receipt.request.limits is invalid', {
      causeCode: safeErrorCode(error),
    });
  }
}

function copyExactValue(value) {
  if (value.type === 'Integer') return Object.freeze({ type: 'Integer', value: value.value });
  return Object.freeze({
    type: 'Rational',
    numerator: value.numerator,
    denominator: value.denominator,
  });
}

function snapshotExactValue(value, limits) {
  const initial = snapshotRecord(value, ['denominator', 'numerator', 'type', 'value'], 'receipt.result.value', { allowSubset: true });
  let exact;
  if (initial.type === 'Integer') {
    if (!sameKeys(Object.keys(initial).sort(), ['type', 'value'])) {
      fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, 'receipt.result.value has invalid Integer fields');
    }
    exact = { type: initial.type, value: initial.value };
  } else if (initial.type === 'Rational') {
    if (!sameKeys(Object.keys(initial).sort(), ['denominator', 'numerator', 'type'])) {
      fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, 'receipt.result.value has invalid Rational fields');
    }
    exact = { type: initial.type, numerator: initial.numerator, denominator: initial.denominator };
  } else {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, 'receipt.result.value has an unsupported type');
  }
  try {
    serializeExactValue(exact, { limits });
  } catch (error) {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, 'receipt.result.value is not canonical', {
      causeCode: safeErrorCode(error),
    });
  }
  return copyExactValue(exact);
}

function copyUsage(usage, tokenCount) {
  // workSteps is part of the v1 replay identity. Any accounting change in the
  // exact core therefore requires an evaluator/receipt version bump.
  return Object.freeze({
    sourceLength: usage.sourceLength,
    tokenCount,
    nodeCount: usage.nodeCount,
    astDepth: usage.astDepth,
    workSteps: usage.workSteps,
    resultBits: usage.resultBits,
    displayLength: usage.displayLength,
    outputLength: usage.outputLength,
  });
}

function snapshotUsage(value) {
  const fields = snapshotRecord(value, USAGE_FIELDS, 'receipt.usage');
  return Object.freeze(Object.fromEntries(USAGE_FIELDS.map(key => [
    key,
    nonNegativeSafeInteger(fields[key], `receipt.usage.${key}`),
  ])));
}

function freezeBody({ source, limits, canonicalAst, value, canonical, display, usage }) {
  return Object.freeze({
    format: EXACT_CALCULATION_RECEIPT_FORMAT,
    version: EXACT_CALCULATION_RECEIPT_VERSION,
    request: Object.freeze({
      source,
      mode: MODE,
      limits: Object.freeze({ ...limits }),
    }),
    statement: Object.freeze({ canonicalAst }),
    result: Object.freeze({ value: copyExactValue(value), canonical, display }),
    epistemicStatus: EXACT_CALCULATION_EPISTEMIC_STATUS,
    assumptions: Object.freeze([]),
    verification: Object.freeze({
      method: REPLAY_METHOD,
      evaluator: EVALUATOR,
      proofStatus: EXACT_CALCULATION_PROOF_STATUS,
    }),
    usage,
  });
}

function bodyFromReceipt(receipt) {
  return Object.freeze({
    format: receipt.format,
    version: receipt.version,
    request: receipt.request,
    statement: receipt.statement,
    result: receipt.result,
    epistemicStatus: receipt.epistemicStatus,
    assumptions: receipt.assumptions,
    verification: receipt.verification,
    usage: receipt.usage,
  });
}

function canonicalWithinSize(value, label) {
  let canonical;
  try {
    canonical = canonicalSchemaValue(value);
  } catch (error) {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, `${label} is not canonically serializable`, {
      causeCode: safeErrorCode(error),
    });
  }
  const byteLength = encodeUtf8(canonical).byteLength;
  if (byteLength > EXACT_CALCULATION_RECEIPT_MAX_BYTES) {
    fail(
      EXACT_CALCULATION_RECEIPT_ERROR_CODES.RECEIPT_SIZE_EXCEEDED,
      `${label} exceeds ${EXACT_CALCULATION_RECEIPT_MAX_BYTES} UTF-8 bytes`,
      { byteLength, limit: EXACT_CALCULATION_RECEIPT_MAX_BYTES },
    );
  }
  return canonical;
}

async function idForBody(body) {
  const canonical = canonicalWithinSize(body, 'Exact calculation receipt body');
  const digest = await contentHashHex(
    `${HASH_DOMAIN}\u0000${HASH_VERSION}\u0000${canonical}`,
    'SHA-256',
  );
  return `math:sha256:${digest}`;
}

function snapshotReceipt(receipt) {
  const root = snapshotRecord(receipt, RECEIPT_FIELDS, 'Exact calculation receipt');
  if (root.format !== EXACT_CALCULATION_RECEIPT_FORMAT || root.version !== EXACT_CALCULATION_RECEIPT_VERSION) {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, 'Exact calculation receipt format or version is unsupported');
  }
  if (typeof root.id !== 'string' || !RECEIPT_ID_PATTERN.test(root.id)) {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, 'Exact calculation receipt ID is invalid');
  }

  const request = snapshotRecord(root.request, ['limits', 'mode', 'source'], 'receipt.request');
  const limits = snapshotResolvedLimits(request.limits);
  const source = requiredString(request.source, 'receipt.request.source', limits.maxSourceLength);
  if (request.mode !== MODE) {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, 'receipt.request.mode is unsupported');
  }

  const statement = snapshotRecord(root.statement, ['canonicalAst'], 'receipt.statement');
  const canonicalAst = requiredString(statement.canonicalAst, 'receipt.statement.canonicalAst', limits.maxOutputLength);
  const result = snapshotRecord(root.result, ['canonical', 'display', 'value'], 'receipt.result');
  const value = snapshotExactValue(result.value, limits);
  const canonical = requiredString(result.canonical, 'receipt.result.canonical', limits.maxOutputLength);
  const display = requiredString(result.display, 'receipt.result.display', limits.maxOutputLength);
  let expectedCanonical;
  let expectedDisplay;
  try {
    expectedCanonical = serializeExactValue(value, { limits });
    expectedDisplay = formatExactValue(value, { limits });
  } catch (error) {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, 'receipt.result.value exceeds its declared limits', {
      causeCode: safeErrorCode(error),
    });
  }
  if (canonical !== expectedCanonical || display !== expectedDisplay) {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, 'receipt.result fields disagree');
  }

  if (root.epistemicStatus !== EXACT_CALCULATION_EPISTEMIC_STATUS) {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, 'receipt.epistemicStatus is unsupported');
  }
  const assumptions = snapshotEmptyArray(root.assumptions, 'receipt.assumptions');
  const verification = snapshotRecord(root.verification, ['evaluator', 'method', 'proofStatus'], 'receipt.verification');
  if (verification.method !== REPLAY_METHOD
    || verification.evaluator !== EVALUATOR
    || verification.proofStatus !== EXACT_CALCULATION_PROOF_STATUS) {
    fail(EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT, 'receipt.verification is unsupported');
  }
  const usage = snapshotUsage(root.usage);

  const snapshot = Object.freeze({
    format: root.format,
    version: root.version,
    id: root.id,
    request: Object.freeze({ source, mode: request.mode, limits: Object.freeze({ ...limits }) }),
    statement: Object.freeze({ canonicalAst }),
    result: Object.freeze({ value, canonical, display }),
    epistemicStatus: root.epistemicStatus,
    assumptions,
    verification: Object.freeze({ ...verification }),
    usage,
  });
  canonicalWithinSize(snapshot, 'Exact calculation receipt');
  return snapshot;
}

function safeErrorCode(error) {
  try {
    const code = error?.code;
    return typeof code === 'string' && code.length <= 128 ? code : null;
  } catch {
    return null;
  }
}

function safeCauseCode(error) {
  try {
    const nested = error?.details?.causeCode;
    if (typeof nested === 'string' && nested.length <= 128) return nested;
  } catch {
    return null;
  }
  return safeErrorCode(error);
}

function failure(code, reason, error = undefined) {
  return Object.freeze({
    ok: false,
    code,
    reason,
    causeCode: safeCauseCode(error),
  });
}

/**
 * Issue an unsigned, content-addressed receipt for one bounded exact expression.
 * The receipt records deterministic replay evidence, not a formal proof or a
 * producer signature.
 */
export async function createExactCalculationReceipt(source, options = undefined) {
  const limits = limitsFromCreationOptions(options);
  const ast = parseExactExpression(source, { limits });
  const evaluated = evaluateExactAst(ast, { limits });
  const body = freezeBody({
    source,
    limits,
    canonicalAst: serializeExactAst(ast, { limits }),
    value: evaluated.value,
    canonical: evaluated.canonical,
    display: evaluated.display,
    usage: copyUsage(evaluated.usage, ast.stats.tokenCount),
  });
  const id = await idForBody(body);
  const receipt = Object.freeze({ ...body, id });
  canonicalWithinSize(receipt, 'Exact calculation receipt');
  return receipt;
}

/** Canonically serialize a structurally valid receipt, including its ID. */
export function serializeExactCalculationReceipt(receipt) {
  return canonicalWithinSize(snapshotReceipt(receipt), 'Exact calculation receipt');
}

/**
 * Replay a receipt under its recorded absolute-bounded limits. Successful
 * verification proves byte-for-byte replay agreement only; `proofStatus`
 * remains `not-a-formal-proof`.
 */
export async function verifyExactCalculationReceipt(receipt) {
  let candidate;
  try {
    // Snapshot every untrusted descriptor before the first await so caller
    // mutation cannot change what this verification operation observes.
    candidate = snapshotReceipt(receipt);
  } catch (error) {
    return failure(
      safeErrorCode(error) ?? EXACT_CALCULATION_RECEIPT_ERROR_CODES.INVALID_RECEIPT,
      'invalid-receipt',
      error,
    );
  }

  let expected;
  try {
    expected = await createExactCalculationReceipt(candidate.request.source, {
      limits: candidate.request.limits,
    });
  } catch (error) {
    return failure(EXACT_CALCULATION_RECEIPT_ERROR_CODES.REPLAY_FAILED, 'replay-failed', error);
  }

  const candidateBody = canonicalSchemaValue(bodyFromReceipt(candidate));
  const expectedBody = canonicalSchemaValue(bodyFromReceipt(expected));
  if (candidateBody !== expectedBody) {
    return failure(EXACT_CALCULATION_RECEIPT_ERROR_CODES.CONTENT_MISMATCH, 'replayed-content-mismatch');
  }
  if (candidate.id !== expected.id) {
    return failure(EXACT_CALCULATION_RECEIPT_ERROR_CODES.ID_MISMATCH, 'receipt-id-mismatch');
  }
  return Object.freeze({
    ok: true,
    code: 'VERIFIED_EXACT_REPLAY',
    receiptId: expected.id,
    receipt: expected,
    epistemicStatus: EXACT_CALCULATION_EPISTEMIC_STATUS,
    proofStatus: EXACT_CALCULATION_PROOF_STATUS,
  });
}
