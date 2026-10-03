// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { contentHashHex } from '../math/ChecksumMath.js';

const registriesByDevice = new WeakMap();
const stateByModule = new WeakMap();
const stateByRegistry = new WeakMap();
const NATIVE_PROMISE = Promise;
const NATIVE_PROMISE_RESOLVE = NATIVE_PROMISE.resolve;
const NATIVE_PROMISE_REJECT = NATIVE_PROMISE.reject;
const NATIVE_PROMISE_THEN = NATIVE_PROMISE.prototype.then;
const NATIVE_OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const NATIVE_ARRAY_PUSH = Array.prototype.push;
const NATIVE_ARRAY_SPLICE = Array.prototype.splice;
const NATIVE_ARRAY_FILTER = Array.prototype.filter;
const NATIVE_ARRAY_SLICE = Array.prototype.slice;
const NATIVE_SET_ADD = Set.prototype.add;
const NATIVE_SET_DELETE = Set.prototype.delete;
const NATIVE_SET_CLEAR = Set.prototype.clear;
const NATIVE_SET_HAS = Set.prototype.has;
const NATIVE_SET_FOR_EACH = Set.prototype.forEach;
const NATIVE_WEAK_MAP_GET = WeakMap.prototype.get;
const NATIVE_WEAK_MAP_SET = WeakMap.prototype.set;
const NATIVE_WEAK_MAP_DELETE = WeakMap.prototype.delete;
let diagnosticSequence = 0;

function diagnosticWeakMapGet(map, key) {
  return Reflect.apply(NATIVE_WEAK_MAP_GET, map, [key]);
}

function diagnosticWeakMapSet(map, key, value) {
  Reflect.apply(NATIVE_WEAK_MAP_SET, map, [key, value]);
}

function diagnosticWeakMapDelete(map, key) {
  return Reflect.apply(NATIVE_WEAK_MAP_DELETE, map, [key]);
}

function diagnosticRegistryState(registry) {
  return diagnosticWeakMapGet(stateByRegistry, registry) || null;
}

function writeDiagnosticRegistryMirror(registry, key, value) {
  try {
    Reflect.apply(NATIVE_OBJECT_DEFINE_PROPERTY, Object, [registry, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    }]);
  } catch (_) {}
}

function syncDiagnosticRecordMirror(registry, state) {
  const records = Reflect.apply(NATIVE_ARRAY_SLICE, state.records, []);
  try {
    Reflect.apply(
      NATIVE_ARRAY_SPLICE,
      state.recordsMirror,
      [0, state.recordsMirror.length, ...records],
    );
  } catch (_) { state.recordsMirror = records; }
  writeDiagnosticRegistryMirror(registry, '_records', state.recordsMirror);
}

function resolveDiagnosticPromise(value) {
  return Reflect.apply(NATIVE_PROMISE_RESOLVE, NATIVE_PROMISE, [value]);
}

function rejectDiagnosticPromise(error) {
  return Reflect.apply(NATIVE_PROMISE_REJECT, NATIVE_PROMISE, [error]);
}

function thenDiagnosticPromise(promise, onFulfilled, onRejected) {
  return Reflect.apply(NATIVE_PROMISE_THEN, promise, [onFulfilled, onRejected]);
}

function diagnosticRegistryDestroyError(state) {
  if (state.destroyError) return state.destroyError;
  const error = new Error('GPU shader diagnostic registry destroyed');
  error.name = 'AbortError';
  error.code = 'GPU_SHADER_DIAGNOSTIC_REGISTRY_DESTROYED';
  return error;
}

function assertDiagnosticRegistryAlive(
  registry,
  generation = diagnosticRegistryState(registry)?.generation,
) {
  const state = diagnosticRegistryState(registry);
  if (!state || state.destroyed || generation !== state.generation) {
    throw diagnosticRegistryDestroyError(state || { destroyError: null });
  }
}

function createDiagnosticRegistryOperation(registry) {
  const state = diagnosticRegistryState(registry);
  if (!state) return null;
  if (state.destroyed) throw diagnosticRegistryDestroyError(state);
  let cancelOperation;
  let cancelled = false;
  const cancellation = new NATIVE_PROMISE(resolve => { cancelOperation = resolve; });
  const operation = Object.freeze({
    registry,
    state,
    generation: state.generation,
    cancellation,
    cancel: Object.freeze({
      receiver: undefined,
      callable: error => {
        if (cancelled) return false;
        cancelled = true;
        cancelOperation(error);
        return true;
      },
    }),
  });
  Reflect.apply(NATIVE_SET_ADD, state.operations, [operation]);
  return operation;
}

function isDiagnosticRegistryOperationCurrent(operation) {
  if (!operation) return true;
  const { state } = operation;
  return !state.destroyed
    && operation.generation === state.generation
    && Reflect.apply(NATIVE_SET_HAS, state.operations, [operation]);
}

function assertDiagnosticRegistryOperationCurrent(operation) {
  if (!isDiagnosticRegistryOperationCurrent(operation)) {
    throw diagnosticRegistryDestroyError(operation.state);
  }
}

function settleDiagnosticRegistryOperation(operation) {
  if (!operation) return false;
  return Reflect.apply(NATIVE_SET_DELETE, operation.state.operations, [operation]);
}

function awaitDiagnosticRegistryOperation(value, operation) {
  if (!operation) return resolveDiagnosticPromise(value);
  return new NATIVE_PROMISE((resolve, reject) => {
    thenDiagnosticPromise(resolveDiagnosticPromise(value), resolve, reject);
    thenDiagnosticPromise(operation.cancellation, reject, reject);
  });
}

function abortReason(signal) {
  const reason = signal ? Reflect.get(signal, 'reason') : null;
  if (reason) return reason;
  return new DOMException('Shader diagnostics cancelled', 'AbortError');
}

function assertDiagnosticCurrent(signal) {
  if (signal?.aborted) throw abortReason(signal);
}

function readDiagnosticValue(target, key, signal) {
  let value;
  try { value = Reflect.get(target, key); }
  finally { assertDiagnosticCurrent(signal); }
  return value;
}

function captureDiagnosticProperty(receiver, key) {
  let cursor = receiver;
  const visited = new Set();
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const descriptor = Reflect.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) {
      return Object.freeze({ receiver, key, descriptor: Object.freeze({ ...descriptor }) });
    }
    cursor = Reflect.getPrototypeOf(cursor);
  }
  return Object.freeze({ receiver, key, descriptor: null });
}

function readCapturedDiagnosticProperty(captured, signal) {
  const descriptor = captured.descriptor;
  if (!descriptor) {
    assertDiagnosticCurrent(signal);
    return undefined;
  }
  let value;
  try {
    value = 'value' in descriptor
      ? descriptor.value
      : (typeof descriptor.get === 'function'
        ? Reflect.apply(descriptor.get, captured.receiver, [])
        : undefined);
  } finally { assertDiagnosticCurrent(signal); }
  return value;
}

function captureDiagnosticCallableProperty(receiver, key, signal, optional = false) {
  const property = captureDiagnosticProperty(receiver, key);
  return readCapturedDiagnosticCallable(property, signal, optional);
}

function readCapturedDiagnosticCallable(property, signal, optional = false) {
  const callable = readCapturedDiagnosticProperty(property, signal);
  if (typeof callable !== 'function') {
    if (optional) return null;
    throw new TypeError(`Shader diagnostics require ${String(property.key)}()`);
  }
  return Object.freeze({ receiver: property.receiver, callable });
}

function captureDiagnosticOptionSlots(source) {
  const slots = {};
  for (const key of [
    'onDiagnostics', 'mapDiagnostic', 'sourceMap', 'signal', 'registry',
    'maxEntries', 'collectDiagnostics', 'generation', 'sourcePath', 'label',
  ]) slots[key] = captureDiagnosticProperty(source, key);
  return Object.freeze(slots);
}

function normalizeDiagnosticValue(value, signal, normalize = String) {
  let normalized;
  try { normalized = normalize(value); }
  finally { assertDiagnosticCurrent(signal); }
  return normalized;
}

function captureDiagnosticCallable(receiver, key, signal, optional = false) {
  assertDiagnosticCurrent(signal);
  const callable = readDiagnosticValue(receiver, key, signal);
  if (typeof callable !== 'function') {
    if (optional) return null;
    throw new TypeError(`Shader diagnostics require ${String(key)}()`);
  }
  assertDiagnosticCurrent(signal);
  return Object.freeze({ receiver, callable });
}

function captureAbortAuthorities(signal) {
  if (!signal) return null;
  const addAbortListenerProperty = captureDiagnosticProperty(signal, 'addEventListener');
  const removeAbortListenerProperty = captureDiagnosticProperty(signal, 'removeEventListener');
  const addAbortListener = readCapturedDiagnosticProperty(addAbortListenerProperty, null);
  const removeAbortListener = readCapturedDiagnosticProperty(removeAbortListenerProperty, null);
  if (typeof addAbortListener !== 'function' || typeof removeAbortListener !== 'function') {
    throw new TypeError('Shader diagnostics require abort listener authorities');
  }
  return Object.freeze({
    addAbortListener: Object.freeze({ receiver: signal, callable: addAbortListener }),
    removeAbortListener: Object.freeze({ receiver: signal, callable: removeAbortListener }),
  });
}

function stageDataSignalAuthorities(optionSlots) {
  const descriptor = optionSlots.signal?.descriptor;
  if (!descriptor || !('value' in descriptor)) {
    return Object.freeze({ known: false, signal: null, abortAuthorities: null });
  }
  const signal = descriptor.value || null;
  return Object.freeze({
    known: true,
    signal,
    abortAuthorities: captureAbortAuthorities(signal),
  });
}

function invokeDiagnosticCallable(captured, args, signal) {
  assertDiagnosticCurrent(signal);
  let result;
  let callError = null;
  try { result = Reflect.apply(captured.callable, captured.receiver, args); }
  catch (error) { callError = error; }
  try { assertDiagnosticCurrent(signal); }
  catch (error) {
    thenDiagnosticPromise(resolveDiagnosticPromise(result), () => {}, () => {});
    throw error;
  }
  if (callError) throw callError;
  return result;
}

function captureDiagnosticSourceMapAuthority(slots, signal) {
  const sourceMap = readCapturedDiagnosticProperty(slots.sourceMap, signal);
  return sourceMap
    ? captureDiagnosticCallableProperty(sourceMap, 'mapLocation', signal, true)
    : null;
}

function captureDiagnosticOptionAuthorities(
  source, slots, signal, sourceMapCall = undefined,
) {
  const stableSourceMapCall = sourceMapCall === undefined
    ? captureDiagnosticSourceMapAuthority(slots, signal)
    : sourceMapCall;
  const mapDiagnostic = readCapturedDiagnosticProperty(slots.mapDiagnostic, signal);
  const onDiagnostics = readCapturedDiagnosticProperty(slots.onDiagnostics, signal);
  return Object.freeze({
    onDiagnosticsCall: typeof onDiagnostics === 'function'
      ? Object.freeze({ receiver: source, callable: onDiagnostics })
      : null,
    mapDiagnosticCall: typeof mapDiagnostic === 'function'
      ? Object.freeze({ receiver: source, callable: mapDiagnostic })
      : null,
    sourceMapCall: stableSourceMapCall,
  });
}

function snapshotDiagnosticOptions(options = {}, authoritySnapshot = null) {
  const source = options ?? {};
  let signal = authoritySnapshot?.signal ?? null;
  let abortAuthorities = authoritySnapshot?.abortAuthorities ?? null;
  let optionAuthorities;
  const optionSlots = authoritySnapshot?.optionSlots
    || captureDiagnosticOptionSlots(source);
  if (!authoritySnapshot) {
    const stagedSignal = stageDataSignalAuthorities(optionSlots);
    if (stagedSignal.known) {
      signal = stagedSignal.signal;
      abortAuthorities = stagedSignal.abortAuthorities;
      assertDiagnosticCurrent(signal);
      optionAuthorities = captureDiagnosticOptionAuthorities(source, optionSlots, signal);
    } else {
      // Capture every callback descriptor before invoking an accessor-backed
      // signal option, which is caller code and may replace sibling methods.
      optionAuthorities = captureDiagnosticOptionAuthorities(source, optionSlots, null);
      signal = readCapturedDiagnosticProperty(optionSlots.signal, null) || null;
      abortAuthorities = captureAbortAuthorities(signal);
      assertDiagnosticCurrent(signal);
    }
  } else {
    optionAuthorities = Object.freeze({
      onDiagnosticsCall: authoritySnapshot.onDiagnosticsCall,
      mapDiagnosticCall: authoritySnapshot.mapDiagnosticCall,
      sourceMapCall: authoritySnapshot.sourceMapCall,
    });
  }
  const snapshot = {
    signal,
    abortAuthorities,
    registry: authoritySnapshot?.registry
      ?? readCapturedDiagnosticProperty(optionSlots.registry, signal),
    maxEntries: authoritySnapshot?.maxEntries
      ?? readCapturedDiagnosticProperty(optionSlots.maxEntries, signal),
  };
  for (const key of [
    'collectDiagnostics', 'generation', 'sourcePath', 'label',
  ]) snapshot[key] = readCapturedDiagnosticProperty(optionSlots[key], signal);
  snapshot.generation = Number.isInteger(snapshot.generation) ? snapshot.generation : 0;
  snapshot.sourcePath = snapshot.sourcePath == null
    ? null
    : normalizeDiagnosticValue(snapshot.sourcePath, signal, String);
  snapshot.label = snapshot.label == null
    ? null
    : normalizeDiagnosticValue(snapshot.label, signal, String);
  snapshot.collectDiagnostics = snapshot.collectDiagnostics !== false;
  snapshot.onDiagnosticsCall = optionAuthorities.onDiagnosticsCall;
  snapshot.mapDiagnosticCall = optionAuthorities.mapDiagnosticCall;
  snapshot.sourceMapCall = optionAuthorities.sourceMapCall;
  return Object.freeze(snapshot);
}

function captureCreationAuthorities(device, options = {}) {
  const source = options ?? {};
  // Freeze every caller-controlled authority descriptor before a host getter
  // can substitute any of them.
  const optionSlots = captureDiagnosticOptionSlots(source);
  const createShaderModuleProperty = captureDiagnosticProperty(
    device, 'createShaderModule',
  );
  const stagedSignal = stageDataSignalAuthorities(optionSlots);
  let signal = stagedSignal.known ? stagedSignal.signal : null;
  let abortAuthorities = stagedSignal.known ? stagedSignal.abortAuthorities : null;
  const authoritySignal = stagedSignal.known ? signal : null;
  if (stagedSignal.known) {
    assertDiagnosticCurrent(signal);
  }

  // Stage nested authority descriptors for data-backed options before invoking
  // any accessor-backed sibling option. This prevents mutually substituting
  // onDiagnostics, mapDiagnostic, source-map, and registry getters.
  const sourceMapDescriptor = optionSlots.sourceMap?.descriptor;
  const registryDescriptor = optionSlots.registry?.descriptor;
  const hasDataSourceMap = Boolean(sourceMapDescriptor && 'value' in sourceMapDescriptor);
  const hasDataRegistry = Boolean(registryDescriptor && 'value' in registryDescriptor);
  let sourceMap = hasDataSourceMap ? sourceMapDescriptor.value : null;
  let requestedRegistry = hasDataRegistry ? registryDescriptor.value : null;
  let sourceMapLocationProperty = sourceMap
    ? captureDiagnosticProperty(sourceMap, 'mapLocation')
    : null;
  let registryPublishProperty = requestedRegistry
    ? captureDiagnosticProperty(requestedRegistry, 'publish')
    : null;
  // Resolve the exact device callable once all data-backed option authorities
  // have their descriptors staged, but before invoking any remaining option
  // accessor or coercion that could substitute the device getter's result.
  const createShaderModule = readCapturedDiagnosticCallable(
    createShaderModuleProperty, authoritySignal,
  );
  if (!hasDataSourceMap) {
    sourceMap = readCapturedDiagnosticProperty(optionSlots.sourceMap, authoritySignal);
    sourceMapLocationProperty = sourceMap
      ? captureDiagnosticProperty(sourceMap, 'mapLocation')
      : null;
  }
  if (!hasDataRegistry) {
    requestedRegistry = readCapturedDiagnosticProperty(optionSlots.registry, authoritySignal);
    registryPublishProperty = requestedRegistry
      ? captureDiagnosticProperty(requestedRegistry, 'publish')
      : null;
  }
  const sourceMapCall = sourceMapLocationProperty
    ? readCapturedDiagnosticCallable(sourceMapLocationProperty, authoritySignal, true)
    : null;
  const requestedPublish = registryPublishProperty
    ? readCapturedDiagnosticCallable(registryPublishProperty, authoritySignal)
    : null;
  const optionAuthorities = captureDiagnosticOptionAuthorities(
    source, optionSlots, authoritySignal, sourceMapCall,
  );
  if (!stagedSignal.known) {
    // Accessor-backed signals are caller code. Invoke that getter only after
    // every diagnostic callback and publication authority is immutable.
    signal = readCapturedDiagnosticProperty(optionSlots.signal, null) || null;
    abortAuthorities = captureAbortAuthorities(signal);
  }
  assertDiagnosticCurrent(signal);
  const rawMaxEntries = readCapturedDiagnosticProperty(optionSlots.maxEntries, signal);
  const maxEntries = rawMaxEntries == null
    ? undefined
    : normalizeDiagnosticValue(rawMaxEntries, signal, Number);
  const registry = requestedRegistry || getGpuShaderDiagnosticRegistry(
    device, maxEntries === undefined ? {} : { maxEntries },
  );
  const publish = requestedPublish
    || captureDiagnosticCallable(registry, 'publish', signal);
  const optionSnapshot = snapshotDiagnosticOptions(source, Object.freeze({
    publish,
    registry,
    signal,
    abortAuthorities,
    optionSlots,
    maxEntries,
    ...optionAuthorities,
  }));
  assertDiagnosticCurrent(signal);
  return Object.freeze({
    createShaderModule,
    publish,
    registry,
    signal,
    abortAuthorities,
    optionSlots,
    maxEntries,
    optionSnapshot,
    ...optionAuthorities,
  });
}

function snapshotShaderDescriptor(descriptor, signal) {
  if (!descriptor || (typeof descriptor !== 'object' && typeof descriptor !== 'function')) {
    throw new TypeError('createCheckedShaderModule requires a descriptor');
  }
  let keys;
  try { keys = Reflect.ownKeys(descriptor); }
  finally { assertDiagnosticCurrent(signal); }
  const snapshot = {};
  for (const key of keys) {
    let property;
    try { property = Reflect.getOwnPropertyDescriptor(descriptor, key); }
    finally { assertDiagnosticCurrent(signal); }
    if (!property?.enumerable) continue;
    snapshot[key] = readDiagnosticValue(descriptor, key, signal);
  }
  if (typeof snapshot.code !== 'string') {
    throw new TypeError('createCheckedShaderModule requires WGSL descriptor.code');
  }
  snapshot.code = normalizeDiagnosticValue(snapshot.code, signal, String);
  if (snapshot.label != null) snapshot.label = normalizeDiagnosticValue(snapshot.label, signal, String);
  return Object.freeze(snapshot);
}

function snapshotDiagnosticMessages(source, signal) {
  if (source == null) return [];
  const iteratorMethod = captureDiagnosticCallable(source, Symbol.iterator, signal, true);
  if (!iteratorMethod) throw new TypeError('Shader diagnostic messages must be iterable');
  const iterator = invokeDiagnosticCallable(iteratorMethod, [], signal);
  const next = captureDiagnosticCallable(iterator, 'next', signal);
  const messages = [];
  while (true) {
    const step = invokeDiagnosticCallable(next, [], signal);
    if (Boolean(readDiagnosticValue(step, 'done', signal))) break;
    messages.push(readDiagnosticValue(step, 'value', signal));
  }
  return messages;
}

function awaitWithAbort(value, signal, abortAuthorities = null) {
  if (!signal) return resolveDiagnosticPromise(value);
  const authorities = abortAuthorities || captureAbortAuthorities(signal);
  const { addAbortListener, removeAbortListener } = authorities;
  const pending = resolveDiagnosticPromise(value);
  if (signal.aborted) {
    thenDiagnosticPromise(pending, () => {}, () => {});
    return rejectDiagnosticPromise(abortReason(signal));
  }
  return new NATIVE_PROMISE((resolve, reject) => {
    let settled = false;
    const removeListener = () => {
      try {
        Reflect.apply(removeAbortListener.callable, removeAbortListener.receiver, [
          'abort', onAbort,
        ]);
      } catch (_) {}
    };
    const finish = (callback, result) => {
      if (settled) return;
      settled = true;
      removeListener();
      callback(result);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      removeListener();
      let reason;
      try { reason = abortReason(signal); }
      catch (error) { reason = error; }
      reject(reason);
    };
    try {
      invokeDiagnosticCallable(
        addAbortListener, ['abort', onAbort, { once: true }], signal,
      );
    } catch (error) {
      thenDiagnosticPromise(pending, () => {}, () => {});
      finish(reject, error);
      return;
    }
    thenDiagnosticPromise(pending,
      result => finish(resolve, result),
      error => finish(reject, error),
    );
  });
}

function messageType(value) {
  return value === 'error' || value === 'warning' ? value : 'info';
}

function mappedMessage(message, options = {}, registryOperation = null) {
  const signal = options.signal || null;
  const assertCurrent = () => {
    assertDiagnosticCurrent(signal);
    assertDiagnosticRegistryOperationCurrent(registryOperation);
  };
  const readCurrent = key => {
    let value;
    try { value = readDiagnosticValue(message, key, signal); }
    finally { assertCurrent(); }
    return value;
  };
  const normalizeCurrent = (value, normalize) => {
    let normalized;
    try { normalized = normalizeDiagnosticValue(value, signal, normalize); }
    finally { assertCurrent(); }
    return normalized;
  };
  const invokeCurrent = (authority, args) => {
    assertCurrent();
    let result;
    try { result = invokeDiagnosticCallable(authority, args, signal); }
    finally { assertCurrent(); }
    return result;
  };
  assertCurrent();
  const values = {};
  for (const key of ['type', 'message', 'lineNum', 'linePos', 'offset', 'length']) {
    values[key] = readCurrent(key);
  }
  const base = {
    type: messageType(values.type),
    message: normalizeCurrent(values.message || '', String),
    line: Math.max(1, normalizeCurrent(values.lineNum, Number) || 1),
    column: Math.max(1, normalizeCurrent(values.linePos, Number) || 1),
    offset: Math.max(0, normalizeCurrent(values.offset, Number) || 0),
    length: Math.max(0, normalizeCurrent(values.length, Number) || 0),
    sourcePath: options.sourcePath || null,
  };
  try {
    let mapped = null;
    if (options.mapDiagnosticCall) {
      mapped = invokeCurrent(options.mapDiagnosticCall, [base]);
    }
    if (!mapped && options.sourceMapCall) {
      mapped = invokeCurrent(
        options.sourceMapCall, [base.line, base.column, base],
      );
    }
    let result;
    try { result = Object.freeze(mapped ? { ...base, ...mapped } : base); }
    finally { assertCurrent(); }
    return result;
  } catch (error) {
    assertCurrent();
    return Object.freeze({ ...base, mappingError: error?.message || String(error) });
  }
}

export class GpuShaderDiagnosticRegistry {
  constructor({ maxEntries = 256 } = {}) {
    const normalizedMaxEntries = Math.max(1, Math.floor(Number(maxEntries) || 256));
    this.maxEntries = normalizedMaxEntries;
    this._records = [];
    this._destroyed = false;
    this._device = null;
    this._generation = 0;
    diagnosticWeakMapSet(stateByRegistry, this, {
      destroyed: false,
      generation: 0,
      destroyError: null,
      maxEntries: normalizedMaxEntries,
      records: [],
      recordsMirror: this._records,
      device: null,
      operations: new Set(),
    });
  }

  _destroyError() {
    return diagnosticRegistryDestroyError(diagnosticRegistryState(this));
  }

  _assertAlive(generation = diagnosticRegistryState(this).generation) {
    assertDiagnosticRegistryAlive(this, generation);
  }

  _readValue(target, key, generation) {
    let value;
    try { value = Reflect.get(target, key); }
    finally { assertDiagnosticRegistryAlive(this, generation); }
    return value;
  }

  _snapshotRecord(record, generation) {
    const source = record ?? {};
    let keys;
    try { keys = Reflect.ownKeys(source); }
    finally { assertDiagnosticRegistryAlive(this, generation); }
    const properties = [];
    for (const key of keys) {
      let descriptor;
      try { descriptor = Reflect.getOwnPropertyDescriptor(source, key); }
      finally { assertDiagnosticRegistryAlive(this, generation); }
      if (!descriptor?.enumerable) continue;
      properties.push(Object.freeze({
        key,
        property: Object.freeze({
          receiver: source,
          key,
          descriptor: Object.freeze({ ...descriptor }),
        }),
      }));
    }
    const messagesProperty = properties.find(entry => entry.key === 'messages') || null;
    let rawMessages = [];
    if (messagesProperty) {
      try { rawMessages = readCapturedDiagnosticProperty(messagesProperty.property, null); }
      finally { assertDiagnosticRegistryAlive(this, generation); }
    }
    const messageIteration = this._stageMessages(rawMessages, generation);
    const snapshot = {};
    for (const entry of properties) {
      const value = entry.key === 'messages'
        ? rawMessages
        : (() => {
          try { return readCapturedDiagnosticProperty(entry.property, null); }
          finally { assertDiagnosticRegistryAlive(this, generation); }
        })();
      Object.defineProperty(snapshot, entry.key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      });
    }
    return Object.freeze({ snapshot, messageIteration });
  }

  _stageMessages(source, generation) {
    if (source == null) return [];
    let iteratorProperty;
    try { iteratorProperty = captureDiagnosticProperty(source, Symbol.iterator); }
    finally { assertDiagnosticRegistryAlive(this, generation); }
    let iteratorMethod;
    try { iteratorMethod = readCapturedDiagnosticProperty(iteratorProperty, null); }
    finally { assertDiagnosticRegistryAlive(this, generation); }
    if (typeof iteratorMethod !== 'function') {
      throw new TypeError('GPU shader diagnostic record messages must be iterable');
    }
    let iterator;
    try { iterator = Reflect.apply(iteratorMethod, source, []); }
    finally { assertDiagnosticRegistryAlive(this, generation); }
    let nextProperty;
    try { nextProperty = captureDiagnosticProperty(iterator, 'next'); }
    finally { assertDiagnosticRegistryAlive(this, generation); }
    let next;
    try { next = readCapturedDiagnosticProperty(nextProperty, null); }
    finally { assertDiagnosticRegistryAlive(this, generation); }
    if (typeof next !== 'function') {
      throw new TypeError('GPU shader diagnostic message iterator requires next()');
    }
    return Object.freeze({ iterator, next });
  }

  _snapshotMessages(source, generation, staged = null) {
    const iteration = staged || this._stageMessages(source, generation);
    if (Array.isArray(iteration)) return iteration;
    const { iterator, next } = iteration;
    const messages = [];
    while (true) {
      let step;
      try { step = Reflect.apply(next, iterator, []); }
      finally { assertDiagnosticRegistryAlive(this, generation); }
      if (Boolean(this._readValue(step, 'done', generation))) break;
      messages.push(this._readValue(step, 'value', generation));
    }
    return messages;
  }

  publish(record) {
    const state = diagnosticRegistryState(this);
    const generation = state.generation;
    assertDiagnosticRegistryAlive(this, generation);
    const staged = this._snapshotRecord(record, generation);
    const snapshot = staged.snapshot;
    const messages = this._snapshotMessages(
      snapshot.messages || [], generation, staged.messageIteration,
    );
    assertDiagnosticRegistryAlive(this, generation);
    const frozen = Object.freeze({
      ...snapshot,
      messages: Object.freeze(messages),
    });
    assertDiagnosticRegistryAlive(this, generation);
    Reflect.apply(NATIVE_ARRAY_PUSH, state.records, [frozen]);
    if (state.records.length > state.maxEntries) {
      Reflect.apply(
        NATIVE_ARRAY_SPLICE,
        state.records,
        [0, state.records.length - state.maxEntries],
      );
    }
    syncDiagnosticRecordMirror(this, state);
    return frozen;
  }

  list({ generation, type } = {}) {
    const state = diagnosticRegistryState(this);
    if (state.destroyed) return [];
    return Reflect.apply(NATIVE_ARRAY_FILTER, state.records, [record => (
      (generation === undefined || record.generation === generation)
      && (!type || record.messages.some(message => message.type === type))
    )]);
  }

  summary(options = {}) {
    const records = this.list(options);
    const summary = { modules: records.length, errors: 0, warnings: 0, info: 0 };
    for (const record of records) {
      for (const message of record.messages) {
        if (message.type === 'error') summary.errors += 1;
        else if (message.type === 'warning') summary.warnings += 1;
        else summary.info += 1;
      }
    }
    return Object.freeze(summary);
  }

  clear() {
    const state = diagnosticRegistryState(this);
    if (state.destroyed) return false;
    Reflect.apply(NATIVE_ARRAY_SPLICE, state.records, [0]);
    syncDiagnosticRecordMirror(this, state);
    return true;
  }

  destroy() {
    const state = diagnosticRegistryState(this);
    if (state.destroyed) return false;
    const destroyError = diagnosticRegistryDestroyError(state);
    const operations = [];
    Reflect.apply(NATIVE_SET_FOR_EACH, state.operations, [operation => {
      Reflect.apply(NATIVE_ARRAY_PUSH, operations, [operation]);
    }]);
    const device = state.device;
    state.destroyed = true;
    state.generation += 1;
    state.destroyError = destroyError;
    state.device = null;
    Reflect.apply(NATIVE_ARRAY_SPLICE, state.records, [0]);
    Reflect.apply(NATIVE_SET_CLEAR, state.operations, []);
    writeDiagnosticRegistryMirror(this, '_destroyed', true);
    writeDiagnosticRegistryMirror(this, '_generation', state.generation);
    writeDiagnosticRegistryMirror(this, '_device', null);
    syncDiagnosticRecordMirror(this, state);
    for (const operation of operations) {
      try {
        Reflect.apply(
          operation.cancel.callable, operation.cancel.receiver, [destroyError],
        );
      } catch (_) {}
    }
    if (device && diagnosticWeakMapGet(registriesByDevice, device) === this) {
      diagnosticWeakMapDelete(registriesByDevice, device);
    }
    return true;
  }
}

export function getGpuShaderDiagnosticRegistry(device, options = {}) {
  if (!device || (typeof device !== 'object' && typeof device !== 'function')) {
    throw new TypeError('GPU shader diagnostics require a GPUDevice');
  }
  const source = options ?? {};
  const rawMaxEntries = Reflect.get(source, 'maxEntries');
  const maxEntries = rawMaxEntries == null ? 256 : Number(rawMaxEntries);
  let registry = diagnosticWeakMapGet(registriesByDevice, device);
  if (registry && diagnosticRegistryState(registry)?.destroyed) {
    diagnosticWeakMapDelete(registriesByDevice, device);
    registry = null;
  }
  if (!registry) {
    registry = new GpuShaderDiagnosticRegistry({ maxEntries });
    diagnosticRegistryState(registry).device = device;
    writeDiagnosticRegistryMirror(registry, '_device', device);
    diagnosticWeakMapSet(registriesByDevice, device, registry);
  }
  return registry;
}

async function collectCompilationInfo(
  module, descriptor, options, registry, authorities, registryOperation = null,
) {
  const signal = options.signal || null;
  const code = descriptor.code;
  let sourceHash = null;
  try {
    sourceHash = await awaitDiagnosticRegistryOperation(
      awaitWithAbort(contentHashHex(code), signal, options.abortAuthorities),
      registryOperation,
    );
    assertDiagnosticRegistryOperationCurrent(registryOperation);
  } catch (error) {
    assertDiagnosticRegistryOperationCurrent(registryOperation);
    if (signal?.aborted || error?.name === 'AbortError') return null;
  }
  let messages = [];
  try {
    assertDiagnosticRegistryOperationCurrent(registryOperation);
    if (signal?.aborted) return null;
    const info = authorities.getCompilationInfo
      ? await awaitDiagnosticRegistryOperation(
        awaitWithAbort(invokeDiagnosticCallable(
          authorities.getCompilationInfo, [], signal,
        ), signal, options.abortAuthorities),
        registryOperation,
      )
      : { messages: [] };
    assertDiagnosticRegistryOperationCurrent(registryOperation);
    assertDiagnosticCurrent(signal);
    const rawMessages = readDiagnosticValue(info || {}, 'messages', signal) || [];
    assertDiagnosticRegistryOperationCurrent(registryOperation);
    const rawMessageSnapshots = snapshotDiagnosticMessages(rawMessages, signal);
    messages = [];
    for (const message of rawMessageSnapshots) {
      assertDiagnosticRegistryOperationCurrent(registryOperation);
      messages.push(mappedMessage(message, options, registryOperation));
      assertDiagnosticRegistryOperationCurrent(registryOperation);
    }
    assertDiagnosticRegistryOperationCurrent(registryOperation);
  } catch (error) {
    assertDiagnosticRegistryOperationCurrent(registryOperation);
    if (signal?.aborted || error?.name === 'AbortError') return null;
    messages = [Object.freeze({
      type: 'error',
      message: `getCompilationInfo failed: ${error?.message || String(error)}`,
      line: 1,
      column: 1,
      offset: 0,
      length: 0,
      sourcePath: options.sourcePath || null,
    })];
  }
  if (signal?.aborted) return null;
  assertDiagnosticCurrent(signal);
  assertDiagnosticRegistryOperationCurrent(registryOperation);
  const record = invokeDiagnosticCallable(authorities.publish, [{
    id: ++diagnosticSequence,
    label: descriptor.label || options.label || 'shader-module',
    generation: Number.isInteger(options.generation) ? options.generation : 0,
    sourceHash,
    sourcePath: options.sourcePath || null,
    collectedAt: Date.now(),
    messages,
    hasErrors: messages.some(message => message.type === 'error'),
    hasWarnings: messages.some(message => message.type === 'warning'),
  }], signal);
  assertDiagnosticRegistryOperationCurrent(registryOperation);
  if (options.onDiagnosticsCall) {
    invokeDiagnosticCallable(options.onDiagnosticsCall, [record], signal);
    assertDiagnosticRegistryOperationCurrent(registryOperation);
  }
  return record;
}

/** Create synchronously, then collect browser compiler diagnostics asynchronously. */
export function createCheckedShaderModule(device, descriptor, options = {}) {
  if (!device) throw new TypeError('createCheckedShaderModule requires a GPUDevice');
  const creationAuthorities = captureCreationAuthorities(device, options);
  const stableOptions = creationAuthorities.optionSnapshot;
  const signal = stableOptions.signal;
  const stableDescriptor = snapshotShaderDescriptor(descriptor, signal);
  const registry = creationAuthorities.registry;
  const module = invokeDiagnosticCallable(
    creationAuthorities.createShaderModule, [stableDescriptor], signal,
  );
  const getCompilationInfo = captureDiagnosticCallable(
    module,
    'getCompilationInfo',
    signal,
    true,
  );
  const authorities = Object.freeze({
    getCompilationInfo,
    publish: creationAuthorities.publish,
  });
  let registryOperation = null;
  let compilation;
  if (!stableOptions.collectDiagnostics) compilation = resolveDiagnosticPromise(null);
  else {
    try {
      registryOperation = createDiagnosticRegistryOperation(registry);
      const backend = collectCompilationInfo(
        module, stableDescriptor, stableOptions, registry, authorities, registryOperation,
      );
      compilation = registryOperation
        ? new NATIVE_PROMISE((resolve, reject) => {
          thenDiagnosticPromise(resolveDiagnosticPromise(backend), value => {
            if (!isDiagnosticRegistryOperationCurrent(registryOperation)) {
              const error = diagnosticRegistryDestroyError(registryOperation.state);
              settleDiagnosticRegistryOperation(registryOperation);
              reject(error);
              return;
            }
            settleDiagnosticRegistryOperation(registryOperation);
            resolve(value);
          }, error => {
            if (!isDiagnosticRegistryOperationCurrent(registryOperation)) {
              error = diagnosticRegistryDestroyError(registryOperation.state);
            }
            settleDiagnosticRegistryOperation(registryOperation);
            reject(error);
          });
        })
        : backend;
    } catch (error) { compilation = rejectDiagnosticPromise(error); }
  }
  thenDiagnosticPromise(compilation, () => {}, () => {});
  diagnosticWeakMapSet(stateByModule, module, Object.freeze({
    registry, compilation, signal, descriptor: stableDescriptor, options: stableOptions,
    getCompilationInfo,
  }));
  return module;
}

export function getCheckedShaderCompilation(module) {
  return diagnosticWeakMapGet(stateByModule, module)?.compilation || null;
}

async function assertCheckedShaderModuleInternal(module, options = {}) {
  const state = diagnosticWeakMapGet(stateByModule, module);
  const detachedGetCompilationInfoProperty = state
    ? null
    : captureDiagnosticProperty(module, 'getCompilationInfo');
  const detachedGetCompilationInfo = detachedGetCompilationInfoProperty
    ? readCapturedDiagnosticCallable(
      detachedGetCompilationInfoProperty, null, true,
    )
    : null;
  const stableOptions = snapshotDiagnosticOptions(options);
  const signal = stableOptions.signal;
  assertDiagnosticCurrent(signal);
  let record = state
    ? await awaitWithAbort(state.compilation, signal, stableOptions.abortAuthorities)
    : null;
  assertDiagnosticCurrent(signal);
  if (!record && !state) {
    if (!detachedGetCompilationInfo) return null;
    const info = await awaitWithAbort(invokeDiagnosticCallable(
      detachedGetCompilationInfo, [], signal,
    ), signal, stableOptions.abortAuthorities);
    assertDiagnosticCurrent(signal);
    const rawMessages = readDiagnosticValue(info || {}, 'messages', signal) || [];
    const messages = snapshotDiagnosticMessages(rawMessages, signal)
      .map(message => mappedMessage(message, stableOptions));
    record = Object.freeze({
      label: stableOptions.label || 'shader-module',
      generation: stableOptions.generation,
      messages,
      hasErrors: messages.some(message => message.type === 'error'),
      hasWarnings: messages.some(message => message.type === 'warning'),
    });
  }
  if (record?.hasErrors) {
    const error = new Error(record.messages
      .filter(message => message.type === 'error')
      .map(message => `${message.sourcePath || record.label}:${message.line}:${message.column} ${message.message}`)
      .join('\n'));
    error.code = 'GPU_SHADER_COMPILATION_FAILED';
    error.diagnostics = record;
    throw error;
  }
  return record;
}

export function assertCheckedShaderModule(module, options = {}) {
  const assertion = assertCheckedShaderModuleInternal(module, options);
  thenDiagnosticPromise(assertion, () => {}, () => {});
  return assertion;
}
