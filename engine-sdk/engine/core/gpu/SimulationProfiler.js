// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { statsMean } from '../math/MathStatistics.js';
import { GPUTimestampProfiler } from './GPUTimestampProfiler.js';

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Simulation-oriented compatibility view over GPUTimestampProfiler.
 * It owns no independent query set, resolve buffer, or mapped readback path.
 */
export class SimulationProfiler {
  constructor(device, options = {}) {
    this.device = device;
    this.maxQueries = options.maxQueries || 64;
    this.enabled = options.enabled !== false;
    this.historySize = options.historySize || 60;
    this.service = options.profiler || new GPUTimestampProfiler(device, {
      maxQueries: this.maxQueries,
      maxPendingReads: options.maxPendingReads,
      historySize: this.historySize,
      generation: options.generation,
    });
    this._ownsService = !options.profiler;
    this.results = new Map();
    this.history = new Map();
    this.frameCount = 0;
    this.initialized = false;
    this.supportsTimestamps = false;
    this._cpuSections = new Map();
    this._cpuDurations = new Map();
  }

  async initialize() {
    if (this.initialized) return this.supportsTimestamps;
    this.supportsTimestamps = this.enabled && this.service.isAvailable();
    this.initialized = true;
    return this.supportsTimestamps;
  }

  beginFrame(metadata = {}) {
    this.frameCount++;
    this._cpuSections.clear();
    this._cpuDurations.clear();
    return this.enabled ? this.service.beginFrame(metadata) : null;
  }

  addToPassDescriptor(name, descriptor = {}) {
    if (!this.enabled || !this.supportsTimestamps) return descriptor;
    return this.service.addToPassDescriptor(name, descriptor);
  }

  /**
   * Legacy section markers remain as a CPU fallback. WebGPU timestamp writes
   * must be declared on a pass descriptor, which profiledComputePass does.
   */
  beginSection(_encoder, name) {
    if (!this.enabled) return -1;
    this._cpuSections.set(String(name), nowMs());
    return this._cpuSections.size - 1;
  }

  endSection(_encoder, name) {
    const normalizedName = String(name);
    const start = this._cpuSections.get(normalizedName);
    if (start === undefined) return -1;
    this._cpuSections.delete(normalizedName);
    this._cpuDurations.set(normalizedName, Math.max(0, nowMs() - start));
    return this._cpuDurations.size - 1;
  }

  writeTimestamp(_encoder, label) {
    const normalizedLabel = String(label);
    if (normalizedLabel.endsWith('_start')) {
      return this.beginSection(null, normalizedLabel.slice(0, -6));
    }
    if (normalizedLabel.endsWith('_end')) {
      return this.endSection(null, normalizedLabel.slice(0, -4));
    }
    return -1;
  }

  resolve(encoder, metadata = {}) {
    if (!this.enabled || !this.supportsTimestamps) return false;
    return this.service.resolveAndRead(encoder, metadata);
  }

  markSubmitted(queue = this.device?.queue, metadata = {}) {
    return this.service.markSubmitted(queue, metadata);
  }

  async readResults() {
    let durations = new Map();
    if (this.enabled && this.supportsTimestamps) {
      const detailed = await this.service.getDetailedResults();
      durations = new Map(detailed.passes.map(pass => [pass.passName, pass.durationMs]));
    }
    if (durations.size === 0) durations = new Map(this._cpuDurations);

    for (const [name, durationMs] of durations) {
      if (!this.history.has(name)) this.history.set(name, []);
      const samples = this.history.get(name);
      samples.push(durationMs);
      if (samples.length > this.historySize) samples.shift();
    }
    this.results = durations;
    return new Map(durations);
  }

  getAverage(name) {
    const samples = this.history.get(name);
    return samples?.length ? statsMean(samples) : 0;
  }

  getStats(name) {
    const samples = this.history.get(name);
    if (!samples?.length) return { min: 0, max: 0, avg: 0, last: 0 };
    return {
      min: Math.min(...samples),
      max: Math.max(...samples),
      avg: statsMean(samples),
      last: samples[samples.length - 1],
    };
  }

  getAllStats() {
    return Object.fromEntries(Array.from(this.history.keys(), name => [name, this.getStats(name)]));
  }

  getReport() {
    const stats = this.getAllStats();
    const lines = ['=== Simulation Profiler Report ==='];
    for (const [name, sample] of Object.entries(stats)) {
      lines.push(`${name}: ${sample.avg.toFixed(3)}ms avg (${sample.min.toFixed(3)}-${sample.max.toFixed(3)}ms)`);
    }
    const total = Object.values(stats).reduce((sum, sample) => sum + sample.avg, 0);
    lines.push(`--- Total: ${total.toFixed(3)}ms ---`);
    return lines.join('\n');
  }

  reset() {
    this.results.clear();
    this.history.clear();
    this._cpuSections.clear();
    this._cpuDurations.clear();
  }

  destroy() {
    if (this._ownsService) this.service.destroy();
    this.reset();
    this.initialized = false;
    this.supportsTimestamps = false;
  }
}

export function profiledComputePass(profiler, encoder, name, encode) {
  const descriptor = profiler.addToPassDescriptor(name, { label: name });
  const pass = encoder.beginComputePass(descriptor);
  encode(pass);
  pass.end();
}

export function createSimulationProfiler(device, options = {}) {
  return new SimulationProfiler(device, options);
}

export const ProfileSections = {
  PARTICLE_SIM: 'particleSim',
  PARTICLE_COLLISION: 'particleCollision',
  GRID_CLEAR: 'gridClear',
  GRID_BIN: 'gridBin',
  GRID_COLLIDE: 'gridCollide',
  VOXEL_CLEAR: 'voxelClear',
  VOXEL_MESH: 'voxelMesh',
  VOXEL_COLLIDE: 'voxelCollide',
  ROPE_FORCES: 'ropeForces',
  ROPE_CONSTRAINTS: 'ropeConstraints',
  ROPE_ATTACHMENTS: 'ropeAttachments',
  ROPE_INTEGRATE: 'ropeIntegrate',
  ROPE_GEN_VERTS: 'ropeGenVerts',
  ROPE_GEN_INDICES: 'ropeGenIndices',
  ROPE_RENDER: 'ropeRender',
  FLUID_SPLAT: 'fluidSplat',
  FLUID_ADVECT: 'fluidAdvect',
  FLUID_PRESSURE: 'fluidPressure',
};

export default SimulationProfiler;
