// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Stable top-level MorphField execution families. */
export const EXECUTION_FAMILY = Object.freeze({
  ANALYTIC: 0,
  SPARSE_RESIDUAL: 1,
  ORIENTED_KERNEL: 2,
  CACHED_SURFACE: 3,
});

export const SURFACE_EXTRACTOR = Object.freeze({
  DIRECT: 'direct-field',
  REGULAR_TRANSITION: 'regular-transition',
  MANIFOLD_DUAL: 'manifold-dual',
});

const CACHE_TRACE_THRESHOLD = 64;
const CACHE_SAMPLE_WINDOW = 45;
const CACHE_PROGRAM_THRESHOLD = 24;
const CACHE_STABILITY_FRAMES = 120;

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function sourceKind(nexel) {
  return String(nexel?.source?.kind || nexel?.source?.type || 'analytic').toLowerCase();
}

function hasSurfaceOnlyQueries(nexel) {
  const query = nexel?.queries;
  if (!query) return !nexel?.source?.medium;
  const medium = query.medium === true;
  const surface = query.surface !== false;
  return surface && !medium;
}

/**
 * Selects a single extractor for an entire connected seam domain.
 * The selector intentionally returns direct rendering when a requested topology
 * guarantee cannot be supported by certified Hermite data.
 */
export function selectSurfaceExtractor(intent = {}, capabilities = {}) {
  const topology = intent.topologyRequirement || 'unspecified';
  const featureMode = intent.featureMode || 'smooth';
  const updateClass = intent.updateClass || 'dynamic';
  const stable = updateClass === 'static' || updateClass === 'low-churn';
  const certifiedHermite = capabilities.certifiedHermite === true;

  if (topology === 'closed-2-manifold') {
    return stable && certifiedHermite
      ? SURFACE_EXTRACTOR.MANIFOLD_DUAL
      : SURFACE_EXTRACTOR.DIRECT;
  }
  if (featureMode === 'sharp' && stable && certifiedHermite) {
    return SURFACE_EXTRACTOR.MANIFOLD_DUAL;
  }
  return SURFACE_EXTRACTOR.REGULAR_TRANSITION;
}

/**
 * Deterministic representation planner. Source semantics and certificates are
 * authoritative; performance history can only promote an eligible surface to
 * a disposable cache.
 */
export class RepresentationPlanner {
  constructor(options = {}) {
    this.traceThreshold = options.traceThreshold ?? CACHE_TRACE_THRESHOLD;
    this.sampleWindow = options.sampleWindow ?? CACHE_SAMPLE_WINDOW;
    this.programThreshold = options.programThreshold ?? CACHE_PROGRAM_THRESHOLD;
    this.stabilityFrames = options.stabilityFrames ?? CACHE_STABILITY_FRAMES;
    this._history = new Map();
    this._decisions = new Map();
  }

  recordTraceSample(domainId, traceSteps, frameIndex) {
    const id = String(domainId);
    const history = this._history.get(id) || [];
    history.push({ steps: Math.max(0, finiteNumber(traceSteps)), frame: frameIndex >>> 0 });
    if (history.length > this.sampleWindow) history.splice(0, history.length - this.sampleWindow);
    this._history.set(id, history);
  }

  reset(domainId) {
    const id = String(domainId);
    this._history.delete(id);
    this._decisions.delete(id);
  }

  choose(nexel, context = {}) {
    if (!nexel || typeof nexel !== 'object') throw new TypeError('RepresentationPlanner.choose requires a Nexel descriptor');
    const id = String(nexel.id ?? '');
    if (!id) throw new Error('Nexel id is required for representation planning');
    const kind = sourceKind(nexel);
    const certificate = context.certificate || nexel.certificate || {};
    const memoryAvailable = context.memoryAvailable !== false;
    const updateClass = nexel.intent?.updateClass || 'dynamic';
    const stable = updateClass === 'static' || updateClass === 'low-churn';
    const stableFrames = Math.max(0, context.stableFrames | 0);
    const programLength = Math.max(0, context.programLength | 0);
    const history = this._history.get(id) || [];
    const traceP95 = percentile(history.map((entry) => entry.steps), 0.95);

    let family = EXECUTION_FAMILY.ANALYTIC;
    let reason = 'bounded analytic source';

    if (kind === 'oriented-samples' || kind === 'orientedkernels' || kind === 'kernels' || kind === 'point-cloud') {
      family = EXECUTION_FAMILY.ORIENTED_KERNEL;
      reason = 'semantic oriented-sample source';
    } else if (kind === 'sampled-field' || kind === 'sparse-residual' || kind === 'residual') {
      if (certificate.residualCertified !== true && certificate.certified !== true) {
        throw new Error(`Nexel ${id} uses a sampled residual without a compiler-derived certificate`);
      }
      if (context.hasCoarseResidentLevel !== true) {
        throw new Error(`Nexel ${id} has no certified always-resident coarse residual level`);
      }
      family = EXECUTION_FAMILY.SPARSE_RESIDUAL;
      reason = 'certified sparse residual hierarchy';
    } else if (kind === 'indexed-surface') {
      family = EXECUTION_FAMILY.CACHED_SURFACE;
      reason = 'authoritative indexed surface source';
    }

    const cacheEligible = family === EXECUTION_FAMILY.ANALYTIC
      && hasSurfaceOnlyQueries(nexel)
      && nexel.material?.opacity !== 0
      && (nexel.material?.alphaMode || 'opaque') === 'opaque'
      && stable
      && certificate.surfaceCertified === true
      && memoryAvailable;
    const expensive = programLength > this.programThreshold
      || (history.length >= this.sampleWindow && traceP95 > this.traceThreshold);
    const stableEnough = stableFrames >= this.stabilityFrames;

    if (cacheEligible && expensive && stableEnough) {
      const extractor = selectSurfaceExtractor(nexel.intent, {
        certifiedHermite: certificate.hermiteCertified === true,
      });
      if (extractor !== SURFACE_EXTRACTOR.DIRECT) {
        family = EXECUTION_FAMILY.CACHED_SURFACE;
        reason = `eligible stable surface promoted to ${extractor}`;
      } else {
        reason = 'topology request requires certified direct field fallback';
      }
    }

    const decision = Object.freeze({
      id,
      family,
      reason,
      extractor: family === EXECUTION_FAMILY.CACHED_SURFACE
        ? selectSurfaceExtractor(nexel.intent, { certifiedHermite: certificate.hermiteCertified === true })
        : SURFACE_EXTRACTOR.DIRECT,
      traceP95,
      samples: history.length,
      cacheEligible,
      stableFrames,
    });
    this._decisions.set(id, decision);
    return decision;
  }

  getDecision(domainId) {
    return this._decisions.get(String(domainId)) || null;
  }

  getTelemetry() {
    return Array.from(this._decisions.values(), (decision) => ({ ...decision }));
  }
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}
