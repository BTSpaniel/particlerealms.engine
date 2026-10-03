// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Shared expand-contract owner for structured browser key/value records. */

export const BROWSER_RECORD_SCHEMA_VERSION = 2;

export class BrowserRecordContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BrowserRecordContractError';
    this.code = code;
    this.details = details;
  }
}

const encoder = new TextEncoder();
const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function requireStorage(storage) {
  const selected = storage ?? globalThis.localStorage;
  if (!selected || typeof selected.getItem !== 'function'
    || typeof selected.setItem !== 'function' || typeof selected.removeItem !== 'function') {
    throw new BrowserRecordContractError('BROWSER_STORAGE_UNAVAILABLE', 'browser key/value storage is unavailable');
  }
  return selected;
}

function boundedRaw(raw, contract, medium) {
  if (raw === null) return null;
  if (typeof raw !== 'string' || encoder.encode(raw).byteLength > contract.maxBytes) {
    throw new BrowserRecordContractError(
      'CORRUPT_BROWSER_RECORD', `${contract.schema} ${medium} record exceeds its size limit`,
      { schema: contract.schema, medium },
    );
  }
  return raw;
}

function parse(raw, contract, medium) {
  try { return JSON.parse(boundedRaw(raw, contract, medium)); }
  catch (error) {
    if (error instanceof BrowserRecordContractError) throw error;
    throw new BrowserRecordContractError(
      'CORRUPT_BROWSER_RECORD', `${contract.schema} ${medium} record is not valid JSON`,
      { schema: contract.schema, medium, cause: error },
    );
  }
}

function validatePayload(value, contract, medium) {
  if (!contract.validate(value)) {
    throw new BrowserRecordContractError(
      'CORRUPT_BROWSER_RECORD', `${contract.schema} ${medium} payload is invalid`,
      { schema: contract.schema, medium },
    );
  }
  return value;
}

function readState(contract, storage) {
  const selected = requireStorage(storage);
  const legacyRaw = boundedRaw(selected.getItem(contract.legacyKey), contract, 'legacy-v1');
  const currentRaw = boundedRaw(selected.getItem(contract.currentKey), contract, 'current-v2');
  const legacy = legacyRaw === null ? null : {
    raw: legacyRaw,
    value: validatePayload(parse(legacyRaw, contract, 'legacy-v1'), contract, 'legacy-v1'),
  };
  let current = null;
  if (currentRaw !== null) {
    const record = parse(currentRaw, contract, 'current-v2');
    if (!isPlainObject(record) || record.schema !== contract.schema || !Number.isSafeInteger(record.schemaVersion)) {
      throw new BrowserRecordContractError(
        'CORRUPT_BROWSER_RECORD', `${contract.schema} current envelope is invalid`,
        { schema: contract.schema, medium: 'current-v2' },
      );
    }
    if (record.schemaVersion > BROWSER_RECORD_SCHEMA_VERSION) {
      throw new BrowserRecordContractError(
        'FUTURE_BROWSER_RECORD_VERSION',
        `${contract.schema} v${record.schemaVersion} is newer than supported v${BROWSER_RECORD_SCHEMA_VERSION}`,
        { schema: contract.schema, actualVersion: record.schemaVersion },
      );
    }
    if (record.schemaVersion !== BROWSER_RECORD_SCHEMA_VERSION || typeof record.legacySnapshot !== 'string') {
      throw new BrowserRecordContractError(
        'UNSUPPORTED_BROWSER_RECORD_VERSION', `${contract.schema} current key requires v${BROWSER_RECORD_SCHEMA_VERSION}`,
        { schema: contract.schema, actualVersion: record.schemaVersion },
      );
    }
    boundedRaw(record.legacySnapshot, contract, 'current-v2 legacy snapshot');
    const value = validatePayload(record[contract.payloadKey], contract, 'current-v2');
    if (JSON.stringify(value) !== record.legacySnapshot) {
      throw new BrowserRecordContractError(
        'CORRUPT_BROWSER_RECORD', `${contract.schema} current payload does not match its legacy snapshot`,
        { schema: contract.schema, medium: 'current-v2' },
      );
    }
    current = { legacySnapshot: record.legacySnapshot, value };
  }
  return { storage: selected, legacy, current };
}

export function createBrowserRecordContract({
  schema,
  legacyKey,
  currentKey = `${legacyKey}.v2`,
  payloadKey = 'value',
  validate,
  maxBytes = 4 * 1024 * 1024,
} = {}) {
  if (typeof schema !== 'string' || !schema || typeof legacyKey !== 'string' || !legacyKey
    || typeof currentKey !== 'string' || !currentKey || typeof payloadKey !== 'string' || !payloadKey
    || typeof validate !== 'function' || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('invalid browser record contract');
  }
  const contract = Object.freeze({ schema, legacyKey, currentKey, payloadKey, validate, maxBytes });

  return Object.freeze({
    ...contract,
    schemaVersion: BROWSER_RECORD_SCHEMA_VERSION,
    inspect(storage) { return readState(contract, storage); },
    read(storage) {
      const state = readState(contract, storage);
      if (state.current && state.legacy && state.current.legacySnapshot !== state.legacy.raw) {
        return clone(state.legacy.value);
      }
      const value = state.current?.value ?? state.legacy?.value ?? null;
      return value === null ? null : clone(value);
    },
    write(value, storage) {
      validatePayload(value, contract, 'write');
      const state = readState(contract, storage);
      const legacyJson = JSON.stringify(value);
      const currentJson = JSON.stringify({
        schema: contract.schema,
        schemaVersion: BROWSER_RECORD_SCHEMA_VERSION,
        [contract.payloadKey]: value,
        legacySnapshot: legacyJson,
      });
      boundedRaw(legacyJson, contract, 'legacy-v1');
      boundedRaw(currentJson, contract, 'current-v2');
      const previousLegacy = state.storage.getItem(contract.legacyKey);
      state.storage.setItem(contract.legacyKey, legacyJson);
      try {
        state.storage.setItem(contract.currentKey, currentJson);
      } catch (error) {
        try {
          if (previousLegacy === null) state.storage.removeItem(contract.legacyKey);
          else state.storage.setItem(contract.legacyKey, previousLegacy);
        } catch (_) {}
        throw error;
      }
      return clone(value);
    },
    remove(storage) {
      const state = readState(contract, storage);
      state.storage.removeItem(contract.legacyKey);
      state.storage.removeItem(contract.currentKey);
    },
  });
}
