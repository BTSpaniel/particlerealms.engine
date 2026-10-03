// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const COMMON_REFRESH_RATES = Object.freeze([
  24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 200, 240, 360,
]);

function finiteInterval(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 100 ? number : null;
}

function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function nearestRefreshRate(rate) {
  let best = COMMON_REFRESH_RATES[0];
  let error = Math.abs(rate - best);
  for (const candidate of COMMON_REFRESH_RATES) {
    const candidateError = Math.abs(rate - candidate);
    if (candidateError < error) {
      best = candidate;
      error = candidateError;
    }
  }
  return error / Math.max(best, 1) <= 0.06 ? best : rate;
}

/**
 * Robustly estimates the host display cadence from requestAnimationFrame
 * intervals. Missed callbacks are filtered before estimation, so a busy frame
 * does not incorrectly turn a 144 Hz display into a 72 Hz quality target.
 */
export class DisplayRefreshEstimator {
  constructor(options = {}) {
    this.historySize = Math.max(30, Math.floor(Number(options.historySize ?? 120)) || 120);
    this.minimumSamples = Math.min(
      this.historySize,
      Math.max(12, Math.floor(Number(options.minimumSamples ?? 30)) || 30),
    );
    this.minimumHz = Math.max(10, Number(options.minimumHz ?? 24));
    this.maximumHz = Math.max(this.minimumHz, Number(options.maximumHz ?? 360));
    this.hysteresisWindows = Math.max(1, Math.floor(Number(options.hysteresisWindows ?? 3)) || 3);
    this._samples = [];
    this._refreshHz = Number(options.initialHz ?? 60);
    this._candidateHz = this._refreshHz;
    this._candidateWindows = 0;
    this._changes = 0;
  }

  record(intervalMs) {
    const interval = finiteInterval(intervalMs);
    if (interval === null) return this.snapshot();
    this._samples.push(interval);
    if (this._samples.length > this.historySize) this._samples.shift();
    if (this._samples.length < this.minimumSamples) return this.snapshot();

    const sorted = [...this._samples].sort((a, b) => a - b);
    const base = percentile(sorted, 0.35);
    const filtered = sorted.filter(value => value <= base * 1.35);
    const cadence = percentile(filtered, 0.5) || base;
    const rawHz = Math.min(this.maximumHz, Math.max(this.minimumHz, 1000 / cadence));
    const candidateHz = nearestRefreshRate(rawHz);
    const sameCandidate = Math.abs(candidateHz - this._candidateHz) / Math.max(candidateHz, 1) < 0.025;
    this._candidateWindows = sameCandidate ? this._candidateWindows + 1 : 1;
    this._candidateHz = candidateHz;
    if (this._candidateWindows >= this.hysteresisWindows
        && Math.abs(candidateHz - this._refreshHz) / Math.max(candidateHz, 1) >= 0.025) {
      this._refreshHz = candidateHz;
      this._changes += 1;
      this._candidateWindows = 0;
    }
    return this.snapshot();
  }

  reset(initialHz = this._refreshHz) {
    this._samples.length = 0;
    this._refreshHz = Math.min(this.maximumHz, Math.max(this.minimumHz, Number(initialHz) || 60));
    this._candidateHz = this._refreshHz;
    this._candidateWindows = 0;
    this._changes = 0;
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      refreshHz: this._refreshHz,
      frameMs: 1000 / this._refreshHz,
      samples: this._samples.length,
      ready: this._samples.length >= this.minimumSamples,
      candidateHz: this._candidateHz,
      candidateWindows: this._candidateWindows,
      changes: this._changes,
    });
  }
}

export function createDisplayRefreshEstimator(options) {
  return new DisplayRefreshEstimator(options);
}

