// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Backend-neutral execution policy for State-First simulations.
 *
 * This object owns selection, frame-boundary switching, and measured reports.
 * It deliberately does not own a CPU step function or GPU shader so the same
 * contract can be shared by every State-First simulation.
 */

export const STATE_FIRST_EXECUTION_BACKEND = Object.freeze({
  AUTO: 'auto',
  CPU: 'cpu',
  GPU_COMPUTE: 'gpu-compute',
  COMPARE: 'compare',
});

export const STATE_FIRST_PARITY_STATUS = Object.freeze({
  UNAVAILABLE: 'unavailable',
  PASS: 'pass',
  FAIL: 'fail',
  STALE: 'stale',
});

const VALID_BACKENDS = new Set(Object.values(STATE_FIRST_EXECUTION_BACKEND));

function normalizeBackend(value) {
  const backend = String(value ?? STATE_FIRST_EXECUTION_BACKEND.AUTO).trim().toLowerCase();
  if (!VALID_BACKENDS.has(backend)) {
    throw new RangeError(`Unknown State-First execution backend '${value}'`);
  }
  return backend;
}

function reasonText(value, fallback = null) {
  if (value == null) return fallback;
  const reason = String(value).trim();
  return reason || fallback;
}

function normalizeCapability(value, fallback, defaultUnavailableReason) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') {
    return Object.freeze({
      available: value,
      reason: value ? null : defaultUnavailableReason,
    });
  }
  if (typeof value !== 'object') throw new TypeError('State-First backend capabilities must be booleans or capability objects');
  const available = value.available === true;
  return Object.freeze({
    available,
    reason: available ? null : reasonText(value.reason, defaultUnavailableReason),
  });
}

function computeApiAvailable(device) {
  return Boolean(
    device
    && typeof device.createComputePipeline === 'function'
    && typeof device.createCommandEncoder === 'function'
    && device.queue
    && typeof device.queue.submit === 'function',
  );
}

function normalizeCapabilities(input = {}, previous = null) {
  if (input == null || typeof input !== 'object') throw new TypeError('State-First capabilities must be an object');
  const defaultCpu = previous?.cpu || Object.freeze({ available: true, reason: null });
  const defaultGpu = previous?.gpuCompute || Object.freeze({
    available: false,
    reason: 'No WebGPU compute capability was reported',
  });
  const cpuValue = input.cpu ?? input.cpuAvailable;
  let gpuValue = input.gpuCompute ?? input['gpu-compute'] ?? input.gpuComputeAvailable;
  if (gpuValue == null && Object.prototype.hasOwnProperty.call(input, 'device')) {
    gpuValue = {
      available: computeApiAvailable(input.device),
      reason: 'The supplied GPU device does not expose the required compute command API',
    };
  }
  const cpu = normalizeCapability(cpuValue, defaultCpu, 'CPU execution was reported unavailable');
  const gpuCompute = normalizeCapability(gpuValue, defaultGpu, 'GPU compute execution was reported unavailable');
  const compareAvailable = cpu.available && gpuCompute.available;
  const compareReason = compareAvailable
    ? null
    : [
      cpu.available ? null : `CPU: ${cpu.reason}`,
      gpuCompute.available ? null : `GPU compute: ${gpuCompute.reason}`,
    ].filter(Boolean).join('; ');
  return Object.freeze({
    cpu,
    gpuCompute,
    compare: Object.freeze({ available: compareAvailable, reason: compareReason }),
  });
}

function capabilitiesEqual(a, b) {
  return a.cpu.available === b.cpu.available
    && a.cpu.reason === b.cpu.reason
    && a.gpuCompute.available === b.gpuCompute.available
    && a.gpuCompute.reason === b.gpuCompute.reason;
}

function unavailableReason(label, capability) {
  return `${label} unavailable${capability.reason ? ` (${capability.reason})` : ''}`;
}

function resolveBackend(requestedBackend, capabilities) {
  const cpu = capabilities.cpu;
  const gpu = capabilities.gpuCompute;
  if (requestedBackend === STATE_FIRST_EXECUTION_BACKEND.AUTO) {
    if (gpu.available) return { activeBackend: STATE_FIRST_EXECUTION_BACKEND.GPU_COMPUTE, comparisonEnabled: false, fallbackReason: null };
    if (cpu.available) return {
      activeBackend: STATE_FIRST_EXECUTION_BACKEND.CPU,
      comparisonEnabled: false,
      fallbackReason: `${unavailableReason('GPU compute', gpu)}; using CPU`,
    };
  } else if (requestedBackend === STATE_FIRST_EXECUTION_BACKEND.CPU) {
    if (cpu.available) return { activeBackend: STATE_FIRST_EXECUTION_BACKEND.CPU, comparisonEnabled: false, fallbackReason: null };
    if (gpu.available) return {
      activeBackend: STATE_FIRST_EXECUTION_BACKEND.GPU_COMPUTE,
      comparisonEnabled: false,
      fallbackReason: `${unavailableReason('CPU', cpu)}; using GPU compute`,
    };
  } else if (requestedBackend === STATE_FIRST_EXECUTION_BACKEND.GPU_COMPUTE) {
    if (gpu.available) return { activeBackend: STATE_FIRST_EXECUTION_BACKEND.GPU_COMPUTE, comparisonEnabled: false, fallbackReason: null };
    if (cpu.available) return {
      activeBackend: STATE_FIRST_EXECUTION_BACKEND.CPU,
      comparisonEnabled: false,
      fallbackReason: `${unavailableReason('GPU compute', gpu)}; using CPU`,
    };
  } else if (requestedBackend === STATE_FIRST_EXECUTION_BACKEND.COMPARE) {
    if (cpu.available && gpu.available) {
      return { activeBackend: STATE_FIRST_EXECUTION_BACKEND.GPU_COMPUTE, comparisonEnabled: true, fallbackReason: null };
    }
    if (gpu.available) return {
      activeBackend: STATE_FIRST_EXECUTION_BACKEND.GPU_COMPUTE,
      comparisonEnabled: false,
      fallbackReason: `${unavailableReason('CPU', cpu)}; comparison disabled`,
    };
    if (cpu.available) return {
      activeBackend: STATE_FIRST_EXECUTION_BACKEND.CPU,
      comparisonEnabled: false,
      fallbackReason: `${unavailableReason('GPU compute', gpu)}; comparison disabled`,
    };
  }
  return {
    activeBackend: null,
    comparisonEnabled: false,
    fallbackReason: `No State-First execution backend is available: ${unavailableReason('CPU', cpu)}; ${unavailableReason('GPU compute', gpu)}`,
  };
}

function selectionsEqual(a, b) {
  return a.activeBackend === b.activeBackend
    && a.comparisonEnabled === b.comparisonEnabled
    && a.fallbackReason === b.fallbackReason;
}

function optionalFinite(sample, key) {
  if (sample[key] == null) return null;
  const value = Number(sample[key]);
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`State-First telemetry '${key}' must be a non-negative finite number`);
  return value;
}

function optionalCount(sample, key) {
  const value = optionalFinite(sample, key);
  if (value == null) return null;
  if (!Number.isSafeInteger(value)) throw new RangeError(`State-First telemetry '${key}' must be a non-negative safe integer`);
  return value;
}

function emptyTelemetry(generation) {
  return Object.freeze({
    generation,
    sampleCount: 0,
    frameIndex: null,
    activeBackend: null,
    comparisonEnabled: false,
    frameTimeMs: null,
    cpuTimeMs: null,
    gpuTimeMs: null,
    simulationCpuMs: null,
    simulationGpuMs: null,
    fixedSteps: null,
    entityCount: null,
    simulatedCount: null,
    renderedCount: null,
  });
}

function unavailableParity(generation, reason = 'No CPU/GPU parity sample has been reported') {
  return Object.freeze({
    generation,
    status: STATE_FIRST_PARITY_STATUS.UNAVAILABLE,
    passed: null,
    reason,
    frameIndex: null,
    sampleCount: 0,
    fields: Object.freeze([]),
    maxAbsoluteError: null,
    meanAbsoluteError: null,
    rootMeanSquareError: null,
    tolerance: null,
    mismatchCount: null,
  });
}

function normalizeFrameIndex(value, previous) {
  if (value == null) return previous == null ? 0 : previous + 1;
  const frameIndex = Number(value);
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) throw new RangeError('State-First frame index must be a non-negative safe integer');
  if (previous != null && frameIndex <= previous) throw new RangeError(`State-First frame boundary ${frameIndex} must advance past ${previous}`);
  return frameIndex;
}

export class StateFirstExecutionBackend {
  constructor(options = {}) {
    this.label = reasonText(options.label, 'StateFirstExecutionBackend');
    this._requestedBackend = normalizeBackend(options.requestedBackend ?? options.requested);
    this._pendingRequest = null;
    this._capabilities = normalizeCapabilities(options.capabilities || options);
    this._pendingCapabilities = null;
    this._selection = Object.freeze(resolveBackend(this._requestedBackend, this._capabilities));
    this._generation = 1;
    this._frameIndex = null;
    this._lastBoundary = null;
    this._lastSwitch = Object.freeze({
      generation: this._generation,
      frameIndex: null,
      previousBackend: null,
      activeBackend: this._selection.activeBackend,
      requestedBackend: this._requestedBackend,
      reason: 'initial selection',
    });
    this._telemetry = emptyTelemetry(this._generation);
    this._parity = unavailableParity(this._generation);
  }

  get requestedBackend() { return this._requestedBackend; }

  get activeBackend() { return this._selection.activeBackend; }

  get generation() { return this._generation; }

  requestBackend(requestedBackend, reason = 'backend request') {
    const backend = normalizeBackend(requestedBackend);
    this._pendingRequest = Object.freeze({ backend, reason: reasonText(reason, 'backend request') });
    return Object.freeze({
      requestedBackend: backend,
      activeBackend: this._selection.activeBackend,
      appliesAtFrameBoundary: true,
      generation: this._generation,
    });
  }

  requestCapabilities(capabilities) {
    this._pendingCapabilities = normalizeCapabilities(capabilities, this._pendingCapabilities || this._capabilities);
    return this._pendingCapabilities;
  }

  beginFrame(frameIndex = null) {
    const nextFrameIndex = normalizeFrameIndex(frameIndex, this._frameIndex);
    const previousRequested = this._requestedBackend;
    const previousCapabilities = this._capabilities;
    const previousSelection = this._selection;
    const pendingRequest = this._pendingRequest;
    const capabilitiesConsumed = this._pendingCapabilities != null;
    if (this._pendingCapabilities) this._capabilities = this._pendingCapabilities;
    if (pendingRequest) this._requestedBackend = pendingRequest.backend;
    this._pendingCapabilities = null;
    this._pendingRequest = null;
    this._selection = Object.freeze(resolveBackend(this._requestedBackend, this._capabilities));
    const changed = previousRequested !== this._requestedBackend
      || !capabilitiesEqual(previousCapabilities, this._capabilities)
      || !selectionsEqual(previousSelection, this._selection);
    this._frameIndex = nextFrameIndex;
    if (changed) {
      this._generation += 1;
      this._lastSwitch = Object.freeze({
        generation: this._generation,
        frameIndex: this._frameIndex,
        previousBackend: previousSelection.activeBackend,
        activeBackend: this._selection.activeBackend,
        requestedBackend: this._requestedBackend,
        reason: pendingRequest?.reason || (capabilitiesConsumed ? 'capability change' : 'selection change'),
      });
      this._telemetry = emptyTelemetry(this._generation);
      this._parity = unavailableParity(this._generation, 'Backend generation changed; awaiting a new parity sample');
    }
    this._lastBoundary = Object.freeze({
      frameIndex: this._frameIndex,
      requestConsumed: pendingRequest != null,
      capabilitiesConsumed,
      changed,
    });
    return this.getSnapshot();
  }

  recordTelemetry(sample = {}) {
    if (sample == null || typeof sample !== 'object') throw new TypeError('State-First telemetry sample must be an object');
    const sampleFrame = sample.frameIndex == null ? this._frameIndex : optionalCount(sample, 'frameIndex');
    this._telemetry = Object.freeze({
      generation: this._generation,
      sampleCount: this._telemetry.sampleCount + 1,
      frameIndex: sampleFrame,
      activeBackend: this._selection.activeBackend,
      comparisonEnabled: this._selection.comparisonEnabled,
      frameTimeMs: optionalFinite(sample, 'frameTimeMs'),
      cpuTimeMs: optionalFinite(sample, 'cpuTimeMs'),
      gpuTimeMs: optionalFinite(sample, 'gpuTimeMs'),
      simulationCpuMs: optionalFinite(sample, 'simulationCpuMs'),
      simulationGpuMs: optionalFinite(sample, 'simulationGpuMs'),
      fixedSteps: optionalCount(sample, 'fixedSteps'),
      entityCount: optionalCount(sample, 'entityCount'),
      simulatedCount: optionalCount(sample, 'simulatedCount'),
      renderedCount: optionalCount(sample, 'renderedCount'),
    });
    return this._telemetry;
  }

  reportParitySample(sample = null) {
    if (sample == null || sample.available === false) {
      this._parity = unavailableParity(this._generation, reasonText(sample?.reason, 'CPU/GPU parity sample is unavailable'));
      return this._parity;
    }
    if (typeof sample !== 'object') throw new TypeError('State-First parity sample must be an object');
    const sampleCount = optionalCount(sample, 'sampleCount') ?? optionalCount(sample, 'samples');
    if (!sampleCount) {
      this._parity = unavailableParity(this._generation, reasonText(sample.reason, 'CPU/GPU parity sample contains no comparisons'));
      return this._parity;
    }
    const maxAbsoluteError = optionalFinite(sample, 'maxAbsoluteError');
    const tolerance = optionalFinite(sample, 'tolerance');
    if (maxAbsoluteError == null || tolerance == null) {
      throw new TypeError('State-First parity samples require maxAbsoluteError and tolerance');
    }
    const sampleGeneration = sample.generation == null ? this._generation : optionalCount(sample, 'generation');
    const mismatchCount = optionalCount(sample, 'mismatchCount');
    const stale = sampleGeneration !== this._generation;
    const passed = !stale && maxAbsoluteError <= tolerance && (mismatchCount == null || mismatchCount === 0);
    const fields = sample.fields == null
      ? []
      : Array.from(new Set(Array.from(sample.fields, (field) => String(field))));
    this._parity = Object.freeze({
      generation: sampleGeneration,
      status: stale ? STATE_FIRST_PARITY_STATUS.STALE : (passed ? STATE_FIRST_PARITY_STATUS.PASS : STATE_FIRST_PARITY_STATUS.FAIL),
      passed: stale ? null : passed,
      reason: stale ? `Parity sample belongs to generation ${sampleGeneration}, current generation is ${this._generation}` : null,
      frameIndex: sample.frameIndex == null ? this._frameIndex : optionalCount(sample, 'frameIndex'),
      sampleCount,
      sampleStart: optionalCount(sample, 'sampleStart'),
      sampledEntities: optionalCount(sample, 'sampledEntities'),
      populationCount: optionalCount(sample, 'populationCount'),
      coverage: optionalFinite(sample, 'coverage'),
      fields: Object.freeze(fields),
      maxAbsoluteError,
      meanAbsoluteError: optionalFinite(sample, 'meanAbsoluteError'),
      rootMeanSquareError: optionalFinite(sample, 'rootMeanSquareError'),
      tolerance,
      mismatchCount,
    });
    return this._parity;
  }

  getTelemetrySnapshot() { return this._telemetry; }

  getParityReport() { return this._parity; }

  getSnapshot() {
    return Object.freeze({
      label: this.label,
      requestedBackend: this._requestedBackend,
      activeBackend: this._selection.activeBackend,
      comparisonEnabled: this._selection.comparisonEnabled,
      available: this._selection.activeBackend != null,
      fallbackReason: this._selection.fallbackReason,
      capabilities: this._capabilities,
      generation: this._generation,
      frameIndex: this._frameIndex,
      pendingRequestedBackend: this._pendingRequest?.backend || null,
      lastBoundary: this._lastBoundary,
      lastSwitch: this._lastSwitch,
      telemetry: this._telemetry,
      parity: this._parity,
    });
  }
}

export function createStateFirstExecutionBackend(options = {}) {
  return new StateFirstExecutionBackend(options);
}
