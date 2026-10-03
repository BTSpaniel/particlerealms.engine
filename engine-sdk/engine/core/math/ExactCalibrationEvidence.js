// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// ExactCalibrationEvidence.js - cold-path exact bindings for tuning/configuration records.

import { canonicalSchemaValue } from '../schema/SchemaEvolutionRegistry.js';
import { encodeUtf8 } from './BufferMath.js';
import { contentHashHex } from './ChecksumMath.js';
import { verifyExactCalculationReceipt } from './ExactCalculationReceipt.js';

export const EXACT_CALIBRATION_EVIDENCE_FORMAT = 'particle-realms/exact-calibration-evidence/v1';
export const EXACT_CALIBRATION_EVIDENCE_VERSION = 1;
export const EXACT_CALIBRATION_EVIDENCE_MAX_VALUES = 32;
export const EXACT_CALIBRATION_EVIDENCE_MAX_BYTES = 256 * 1024;
export const EXACT_CALIBRATION_EPISTEMIC_STATUS = 'exact-arithmetic-binding-only';

export const EXACT_CALIBRATION_AUTHORITY_BOUNDARY = Object.freeze({
  governorDecisionAuthority: false,
  gpuExecutionProof: false,
  physicsProof: false,
  runtimeMeasurementProof: false,
  simulationMutationAuthority: false,
});

export const EXACT_CALIBRATION_EVIDENCE_ERROR_CODES = Object.freeze({
  INVALID_EVIDENCE: 'INVALID_EVIDENCE',
  VALUE_LIMIT_EXCEEDED: 'VALUE_LIMIT_EXCEEDED',
  SIZE_LIMIT_EXCEEDED: 'SIZE_LIMIT_EXCEEDED',
  RECEIPT_INVALID: 'RECEIPT_INVALID',
  RECEIPT_SOURCE_MISMATCH: 'RECEIPT_SOURCE_MISMATCH',
  CONTENT_MISMATCH: 'CONTENT_MISMATCH',
  ID_MISMATCH: 'ID_MISMATCH',
});

const HASH_DOMAIN = 'particle-realms.exact-calibration-evidence';
const HASH_VERSION = 'v1';
const EVIDENCE_ID_PATTERN = /^calibration:sha256:[0-9a-f]{64}$/;
const VALUE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,95}$/;
const ROOT_FIELDS = Object.freeze([
  'authorityBoundary',
  'entries',
  'epistemicStatus',
  'format',
  'id',
  'scope',
  'subject',
  'version',
].sort());
const BOUNDARY_FIELDS = Object.freeze(Object.keys(EXACT_CALIBRATION_AUTHORITY_BOUNDARY).sort());

export class ExactCalibrationEvidenceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ExactCalibrationEvidenceError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

/** Return the canonical round-trip decimal text used to persist a finite Number. */
export function exactCalibrationNumberExpression(value, label = 'Exact calibration value') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.INVALID_EVIDENCE,
      `${label} must be a finite Number`);
  }
  return String(Object.is(value, -0) ? 0 : value);
}

function fail(code, message, details = {}) {
  throw new ExactCalibrationEvidenceError(code, message, details);
}

function sameKeys(left, right) {
  if (left.length !== right.length) return false;
  return left.every((key, index) => key === right[index]);
}

function snapshotRecord(value, label, expectedFields = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.INVALID_EVIDENCE, `${label} must be a plain object`);
  }
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.INVALID_EVIDENCE, `${label} could not be inspected`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.INVALID_EVIDENCE, `${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some(key => typeof key !== 'string')) {
    fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.INVALID_EVIDENCE, `${label} must not contain symbols`);
  }
  const keys = ownKeys.sort();
  if (expectedFields && !sameKeys(keys, expectedFields)) {
    fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.INVALID_EVIDENCE, `${label} has unknown or missing fields`);
  }
  const snapshot = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.INVALID_EVIDENCE, `${label}.${key} must be an enumerable data field`);
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function boundedString(value, label, maximum = 512) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.INVALID_EVIDENCE, `${label} must be a bounded non-empty string`);
  }
  return value;
}

function valueName(value, label) {
  if (typeof value !== 'string' || !VALUE_NAME_PATTERN.test(value)) {
    fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.INVALID_EVIDENCE, `${label} is invalid`);
  }
  return value;
}

function snapshotEntries(value) {
  if (!Array.isArray(value) || value.length === 0
      || value.length > EXACT_CALIBRATION_EVIDENCE_MAX_VALUES) {
    fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.VALUE_LIMIT_EXCEEDED,
      `Evidence entries must contain 1-${EXACT_CALIBRATION_EVIDENCE_MAX_VALUES} values`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expectedKeys = Array.from({ length: value.length }, (_, index) => String(index));
  expectedKeys.push('length');
  if (!sameKeys(Reflect.ownKeys(descriptors).map(String).sort(), expectedKeys.sort())) {
    fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.INVALID_EVIDENCE,
      'Evidence entries must be a dense array without extra properties');
  }
  const snapshots = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[index];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.INVALID_EVIDENCE,
        `evidence.entries[${index}] must be an enumerable data field`);
    }
    const entry = descriptor.value;
    const fields = snapshotRecord(entry, `evidence.entries[${index}]`, ['expression', 'name', 'receipt']);
    snapshots.push(Object.freeze({
      name: valueName(fields.name, `evidence.entries[${index}].name`),
      expression: boundedString(fields.expression, `evidence.entries[${index}].expression`, 4096),
      receipt: fields.receipt,
    }));
  }
  return snapshots;
}

function canonicalWithinLimit(value, label) {
  let canonical;
  try {
    canonical = canonicalSchemaValue(value);
  } catch (error) {
    fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.INVALID_EVIDENCE,
      `${label} is not canonically serializable`, { causeCode: error?.code ?? null });
  }
  const byteLength = encodeUtf8(canonical).byteLength;
  if (byteLength > EXACT_CALIBRATION_EVIDENCE_MAX_BYTES) {
    fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.SIZE_LIMIT_EXCEEDED,
      `${label} exceeds ${EXACT_CALIBRATION_EVIDENCE_MAX_BYTES} UTF-8 bytes`, { byteLength });
  }
  return canonical;
}

async function idForBody(body) {
  const canonical = canonicalWithinLimit(body, 'Exact calibration evidence body');
  const digest = await contentHashHex(`${HASH_DOMAIN}\u0000${HASH_VERSION}\u0000${canonical}`, 'SHA-256');
  return `calibration:sha256:${digest}`;
}

function snapshotBoundary(value) {
  const fields = snapshotRecord(value, 'evidence.authorityBoundary', BOUNDARY_FIELDS);
  for (const field of BOUNDARY_FIELDS) {
    if (fields[field] !== false) {
      fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.INVALID_EVIDENCE,
        `evidence.authorityBoundary.${field} must remain false`);
    }
  }
  return EXACT_CALIBRATION_AUTHORITY_BOUNDARY;
}

function snapshotCreationInput(definition) {
  const fields = snapshotRecord(definition, 'Exact calibration evidence definition', [
    'receipts', 'scope', 'subject', 'values',
  ]);
  const values = snapshotRecord(fields.values, 'Exact calibration values');
  const receipts = snapshotRecord(fields.receipts, 'Exact calibration receipts');
  const names = Object.keys(values).sort();
  if (names.length === 0 || names.length > EXACT_CALIBRATION_EVIDENCE_MAX_VALUES) {
    fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.VALUE_LIMIT_EXCEEDED,
      `Exact calibration values must contain 1-${EXACT_CALIBRATION_EVIDENCE_MAX_VALUES} entries`);
  }
  if (!sameKeys(names, Object.keys(receipts).sort())) {
    fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.INVALID_EVIDENCE,
      'Exact calibration values and receipts must have identical names');
  }
  return Object.freeze({
    scope: boundedString(fields.scope, 'Exact calibration scope', 160),
    subject: boundedString(fields.subject, 'Exact calibration subject', 512),
    entries: Object.freeze(names.map(name => Object.freeze({
      name: valueName(name, `Exact calibration value '${name}'`),
      expression: boundedString(values[name], `Exact calibration expression '${name}'`, 4096),
      receipt: receipts[name],
    }))),
  });
}

async function replayEntries(entries) {
  // Calling every verifier before awaiting snapshots all caller-owned receipts
  // synchronously, closing mutation races across this cold-path batch.
  const pending = entries.map(entry => verifyExactCalculationReceipt(entry.receipt));
  const verified = await Promise.all(pending);
  return Object.freeze(verified.map((result, index) => {
    const entry = entries[index];
    if (!result.ok) {
      fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.RECEIPT_INVALID,
        `Exact receipt '${entry.name}' failed deterministic replay`, {
          receiptCode: result.code,
          receiptReason: result.reason,
        });
    }
    if (result.receipt.request.source !== entry.expression) {
      fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.RECEIPT_SOURCE_MISMATCH,
        `Exact receipt '${entry.name}' does not bind its declared expression`);
    }
    return Object.freeze({
      name: entry.name,
      expression: entry.expression,
      receipt: result.receipt,
    });
  }));
}

function freezeEvidence(body, id) {
  const evidence = Object.freeze({ ...body, id });
  canonicalWithinLimit(evidence, 'Exact calibration evidence');
  return evidence;
}

/**
 * Bind caller-issued exact-calculation receipts to one offline tuning or
 * configuration record. This function never samples hardware, runs a GPU,
 * changes a governor, or mutates simulation state.
 */
export async function createExactCalibrationEvidence(definition) {
  const input = snapshotCreationInput(definition);
  const entries = await replayEntries(input.entries);
  const body = Object.freeze({
    format: EXACT_CALIBRATION_EVIDENCE_FORMAT,
    version: EXACT_CALIBRATION_EVIDENCE_VERSION,
    scope: input.scope,
    subject: input.subject,
    epistemicStatus: EXACT_CALIBRATION_EPISTEMIC_STATUS,
    authorityBoundary: EXACT_CALIBRATION_AUTHORITY_BOUNDARY,
    entries,
  });
  return freezeEvidence(body, await idForBody(body));
}

/** Canonically serialize one structurally and cryptographically valid record. */
export async function serializeExactCalibrationEvidence(evidence) {
  const verification = await verifyExactCalibrationEvidence(evidence);
  if (!verification.ok) {
    fail(verification.code, `Cannot serialize exact calibration evidence: ${verification.reason}`);
  }
  return canonicalWithinLimit(verification.evidence, 'Exact calibration evidence');
}

/**
 * Replay every nested exact receipt and verify the envelope's SHA-256 address.
 * Success proves arithmetic replay/content agreement only, never the claimed
 * origin of a measured value or execution of the configured algorithm.
 */
export async function verifyExactCalibrationEvidence(evidence) {
  try {
    const root = snapshotRecord(evidence, 'Exact calibration evidence', ROOT_FIELDS);
    if (root.format !== EXACT_CALIBRATION_EVIDENCE_FORMAT
        || root.version !== EXACT_CALIBRATION_EVIDENCE_VERSION
        || root.epistemicStatus !== EXACT_CALIBRATION_EPISTEMIC_STATUS
        || typeof root.id !== 'string' || !EVIDENCE_ID_PATTERN.test(root.id)) {
      fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.INVALID_EVIDENCE,
        'Exact calibration evidence format, version, status, or ID is invalid');
    }
    const scope = boundedString(root.scope, 'evidence.scope', 160);
    const subject = boundedString(root.subject, 'evidence.subject', 512);
    const boundary = snapshotBoundary(root.authorityBoundary);
    const candidateEntries = snapshotEntries(root.entries);
    for (let index = 1; index < candidateEntries.length; index++) {
      if (candidateEntries[index - 1].name >= candidateEntries[index].name) {
        fail(EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.INVALID_EVIDENCE,
          'Evidence entry names must be unique and sorted');
      }
    }
    const entries = await replayEntries(candidateEntries);
    const body = Object.freeze({
      format: root.format,
      version: root.version,
      scope,
      subject,
      epistemicStatus: root.epistemicStatus,
      authorityBoundary: boundary,
      entries,
    });
    const expectedId = await idForBody(body);
    if (root.id !== expectedId) {
      return Object.freeze({
        ok: false,
        code: EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.ID_MISMATCH,
        reason: 'evidence-id-mismatch',
      });
    }
    const verified = freezeEvidence(body, expectedId);
    return Object.freeze({
      ok: true,
      code: 'VERIFIED_EXACT_CALIBRATION_REPLAY',
      evidenceId: expectedId,
      evidence: verified,
      epistemicStatus: EXACT_CALIBRATION_EPISTEMIC_STATUS,
      authorityBoundary: boundary,
      diagnostics: Object.freeze({
        exactProvenance: true,
        nonAuthoritative: true,
        receiptCount: entries.length,
        receiptIds: Object.freeze(entries.map(entry => entry.receipt.id)),
        gpuDispatchObserved: false,
        physicsValidated: false,
        simulationMutationAuthorized: false,
      }),
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      code: error?.code ?? EXACT_CALIBRATION_EVIDENCE_ERROR_CODES.INVALID_EVIDENCE,
      reason: 'invalid-evidence',
    });
  }
}
