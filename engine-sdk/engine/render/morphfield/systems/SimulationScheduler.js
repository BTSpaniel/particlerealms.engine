// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Fixed-step scheduler for external-encoder simulation domains. */
export class FixedStepSimulationScheduler {
  constructor(options = {}) {
    this.fixedStep = Number(options.fixedStep ?? (1 / 60));
    this.maxSubsteps = Math.max(1, options.maxSubsteps ?? 4);
    if (!Number.isFinite(this.fixedStep) || this.fixedStep <= 0) throw new RangeError('fixedStep must be positive');
    this.accumulator = 0; this.tick = 0; this.domains = new Map();
    this.stats = { frames: 0, steps: 0, droppedSeconds: 0, authoritativeSteps: 0, visualSteps: 0 };
  }

  registerDomain(descriptor) {
    if (!descriptor || typeof descriptor !== 'object') throw new TypeError('Simulation domain descriptor is required');
    const id = String(descriptor.id ?? '');
    if (!id) throw new Error('Simulation domain id is required');
    if (this.domains.has(id)) throw new Error(`Simulation domain ${id} is already registered`);
    if (typeof descriptor.encodeStep !== 'function') throw new TypeError(`Simulation domain ${id} requires encodeStep()`);
    const authority = descriptor.authority === 'visual' ? 'visual' : 'authoritative';
    const domain = {
      id, authority, encodeStep: descriptor.encodeStep,
      interpolate: typeof descriptor.interpolate === 'function' ? descriptor.interpolate : null,
      updateStride: Math.max(1, descriptor.updateStride ?? 1), enabled: descriptor.enabled !== false,
      revision: descriptor.revision >>> 0, lastTick: -1, boundsDirty: false,
    };
    this.domains.set(id, domain); return domain;
  }

  unregisterDomain(id) { return this.domains.delete(String(id)); }
  setEnabled(id, enabled) { const d = this._domain(id); d.enabled = Boolean(enabled); }
  setVisualStride(id, stride) { const d = this._domain(id); if (d.authority !== 'visual') throw new Error('Authoritative domains cannot reduce update cadence'); d.updateStride = Math.max(1, stride | 0); }

  reset(options = {}) {
    const tick = Number(options.tick ?? 0);
    const accumulator = Number(options.accumulator ?? 0);
    if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError('reset tick must be a non-negative safe integer');
    if (!Number.isFinite(accumulator) || accumulator < 0 || accumulator >= this.fixedStep) {
      throw new RangeError('reset accumulator must be finite and within one fixed step');
    }
    this.tick = tick;
    this.accumulator = accumulator;
    if (options.resetStats !== false) {
      this.stats = { frames: 0, steps: 0, droppedSeconds: 0, authoritativeSteps: 0, visualSteps: 0 };
    }
    for (const domain of this.domains.values()) {
      domain.lastTick = -1;
      domain.boundsDirty = false;
    }
    return this.getStats();
  }

  encodeFrame({ encoder, deltaTime, queries, qualityDecision, frameIndex = 0 }) {
    if (!encoder) throw new TypeError('Simulation frame requires the host command encoder');
    let dt = Number(deltaTime);
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('deltaTime must be finite and non-negative');
    dt = Math.min(dt, this.fixedStep * this.maxSubsteps * 2);
    this.accumulator += dt; this.stats.frames++;
    let steps = Math.min(this.maxSubsteps, Math.floor(this.accumulator / this.fixedStep));
    if (steps === this.maxSubsteps && this.accumulator >= this.fixedStep * (this.maxSubsteps + 1)) {
      const retained = this.accumulator % this.fixedStep;
      this.stats.droppedSeconds += this.accumulator - steps * this.fixedStep - retained;
      this.accumulator = steps * this.fixedStep + retained;
    }
    const changed = [];
    for (let stepIndex = 0; stepIndex < steps; stepIndex++) {
      for (const domain of this.domains.values()) {
        if (!domain.enabled) continue;
        const visualStride = domain.authority === 'visual'
          ? Math.max(domain.updateStride, qualityDecision?.updateStride ?? 1)
          : 1;
        if (this.tick % visualStride !== 0) continue;
        const result = domain.encodeStep({
          encoder, dt: this.fixedStep * visualStride, tick: this.tick,
          frameIndex, queries, authority: domain.authority,
        }) || {};
        domain.lastTick = this.tick;
        if (result.boundsDirty || result.revision !== undefined) {
          domain.boundsDirty = Boolean(result.boundsDirty);
          if (result.revision !== undefined) domain.revision = result.revision >>> 0;
          changed.push({ id: domain.id, boundsDirty: domain.boundsDirty, revision: domain.revision });
        }
        if (domain.authority === 'authoritative') this.stats.authoritativeSteps++; else this.stats.visualSteps++;
      }
      this.tick++; this.accumulator -= this.fixedStep; this.stats.steps++;
    }
    const alpha = Math.max(0, Math.min(1, this.accumulator / this.fixedStep));
    for (const domain of this.domains.values()) if (domain.enabled && domain.interpolate) domain.interpolate(alpha);
    return { steps, alpha, tick: this.tick, changed };
  }

  _domain(id) { const domain = this.domains.get(String(id)); if (!domain) throw new Error(`Unknown simulation domain ${id}`); return domain; }
  getStats() { return { ...this.stats, tick: this.tick, accumulator: this.accumulator, domains: this.domains.size }; }
}

/** Wrap an existing external-encoder simulation API without changing its name. */
export function createExternalEncoderAdapter({ id, authority = 'authoritative', encode, interpolate, updateStride = 1 }) {
  if (typeof encode !== 'function') throw new TypeError('External simulation adapter requires encode()');
  return { id, authority, updateStride, encodeStep: (context) => encode(context), interpolate };
}

/** Kinematic adapter that advances a caller-owned transform source. */
export function createKinematicAdapter({ id, sample, apply, authority = 'authoritative' }) {
  if (typeof sample !== 'function' || typeof apply !== 'function') throw new TypeError('Kinematic adapter requires sample() and apply()');
  return {
    id, authority,
    encodeStep({ dt, tick }) {
      const state = sample({ dt, tick }); apply(state, { dt, tick });
      return { boundsDirty: true, revision: state?.revision ?? tick + 1 };
    },
  };
}
