// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PageTransition - Modern page/view blending for Plauna.
 *
 * Wraps the native View Transitions API (Level 1/2) where available and falls
 * back to CSS class/transition-based cross-fades for older browsers. Designed
 * for SPA "page" swaps, tab changes, and content fades inside a Plauna app.
 *
 * Usage:
 *   const pt = new PageTransition({ type: 'slide-left', duration: 350 });
 *   await pt.start(() => {
 *     // update the DOM here
 *   });
 */


import { DEFAULT_PRESET, DEFAULT_DURATION, DEFAULT_EASING, resolvePreset, keyframesForPreset, ensureStyleSheet, ALL_TYPES, directionToPreset } from './PageTransitionPresets.js';

const DEFAULTS = {
  type: DEFAULT_PRESET,
  direction: null,
  class: null,
  duration: DEFAULT_DURATION,
  easing: DEFAULT_EASING,
  reducedMotion: true,
  fallback: true,
  target: null,
  namespace: 'plauna-pt',
};

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function supportsViewTransitions() {
  return typeof document !== 'undefined' && typeof document.startViewTransition === 'function';
}

function supportsViewTransitionTypes() {
  if (!supportsViewTransitions()) return false;
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
  try {
    return CSS.supports('selector(:active-view-transition-type(a))');
  } catch (_) {
    return false;
  }
}

function isRecoverableViewTransitionError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return error?.name === 'AbortError'
    || message.includes('transition was skipped')
    || message.includes('transition skipped');
}

export class PageTransition {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.type = ALL_TYPES.has(this.options.type) ? this.options.type : DEFAULT_PRESET;
    this.direction = this.options.direction || null;
    this.class = this.options.class || null;
    this._presetState = { index: 0 };
    this.duration = Math.max(0, Number(this.options.duration) || DEFAULTS.duration);
    this.easing = this.options.easing || DEFAULTS.easing;
    this.reducedMotion = this.options.reducedMotion;
    this.target = this.options.target || null;
    this.namespace = this.options.namespace || DEFAULTS.namespace;
    this._runToken = 0;
    this._activeFallback = null;
    this._activeNative = null;
    this._ensureStyleSheet();
  }

  /**
   * Start a view transition. Calls `update` inside the transition callback,
   * passes an AbortSignal for cooperative async cancellation, then waits for
   * every browser-owned lifecycle promise to settle.
   * @param {Function} update - Mutates DOM; receives an optional AbortSignal.
   * @param {Object} opts - Optional overrides for this run.
   * @returns {Promise<{skipped: boolean, type: string}>}
   */
  async start(update, opts = {}) {
    if (typeof update !== 'function') {
      throw new TypeError('PageTransition.start requires an update function');
    }

    // Every start supersedes presentation work owned by the previous run. Do
    // this before the no-motion branches as they must also release an active
    // fallback animation immediately.
    const runToken = ++this._runToken;
    this._cancelFallbackRun(this._activeFallback);
    this._cancelNativeRun(this._activeNative);

    const options = { ...this.options, ...opts };
    const direction = opts.direction || this.direction;
    let requested = ALL_TYPES.has(opts.type) ? opts.type : this.type;
    if (direction && !opts.type) {
      requested = directionToPreset(direction);
    }
    const resolved = resolvePreset(requested, this._presetState);
    const type = resolved.name;
    this._presetState = resolved.state;
    const duration = opts.duration === undefined
      ? this.duration
      : Math.max(0, Number(opts.duration) || 0);
    const easing = opts.easing || this.easing;
    const className = opts.class || this.class || null;

    if (type === 'none') {
      await update();
      return { skipped: true, type: 'none' };
    }

    if (options.reducedMotion && prefersReducedMotion()) {
      await update();
      return { skipped: true, type };
    }

    const hasNative = supportsViewTransitions() && options.fallback !== 'only';
    const canType = type === 'cross-fade' || supportsViewTransitionTypes();

    if (hasNative && canType) {
      return this._nativeTransition(update, type, duration, easing, className, runToken);
    }

    if (options.fallback === 'only' || options.fallback === true || !hasNative || !canType) {
      return this._fallbackTransition(update, type, duration, easing, className, runToken);
    }

    await update();
    return { skipped: true, type: 'none' };
  }

  /** Cancel only presentation work owned by this transition instance. */
  cancel() {
    ++this._runToken;
    this._cancelFallbackRun(this._activeFallback);
    this._cancelNativeRun(this._activeNative);
  }

  /**
   * Native View Transitions API path.
   */
  async _nativeTransition(update, type, duration, easing, className, runToken) {
    const el = this._targetElement();
    const run = {
      token: runToken,
      transition: null,
      controller: typeof AbortController === 'function' ? new AbortController() : null,
      styles: [],
      cancelled: false,
      cleaned: false,
    };
    this._activeNative = run;

    const setRunStyle = (target, property, value) => {
      if (!target?.style) return;
      run.styles.push({
        target,
        property,
        value: target.style.getPropertyValue(property),
        priority: target.style.getPropertyPriority(property),
      });
      target.style.setProperty(property, value);
    };

    if (el) {
      setRunStyle(el, 'view-transition-name', 'root');
      if (className) setRunStyle(el, 'view-transition-class', className);
    }

    // Publish dynamic timing only for this run. The exact authored inline
    // values and priorities are restored during cleanup.
    const doc = document.documentElement;
    setRunStyle(doc, `--${this.namespace}-duration`, `${duration}ms`);
    setRunStyle(doc, `--${this.namespace}-easing`, easing);

    let updateStarted = false;
    let updateApplied = false;
    let updateError = null;
    const guardedUpdate = async () => {
      if (!this._isCurrentNativeRun(run)) return;
      updateStarted = true;
      try {
        await update(run.controller?.signal);
        updateApplied = true;
      } catch (error) {
        updateError = error;
        throw error;
      }
    };

    // For the default cross-fade we can use the Level 1 function form. For a
    // custom type we need Level 2 (types + active-view-transition-type); if
    // that is unavailable we use the Web Animations fallback so the requested
    // effect still runs.
    let transition;
    try {
      if (type === 'cross-fade') {
        transition = document.startViewTransition(guardedUpdate);
      } else {
        transition = document.startViewTransition({ update: guardedUpdate, types: [type] });
      }
    } catch (e) {
      this._cancelNativeRun(run);
      console.warn('[PageTransition] startViewTransition not supported, using Web Animations fallback:', e);
      if (updateError) throw updateError;
      if (updateStarted) return { skipped: true, type };
      return this._fallbackTransition(update, type, duration, easing, className, runToken);
    }
    run.transition = transition;

    // Attach every rejection handler synchronously. A skipped transition can
    // reject ready/finished before sequential awaits reach those promises.
    const lifecycle = ['ready', 'updateCallbackDone', 'finished'].map((phase) => {
      const promise = transition?.[phase];
      if (!promise || typeof promise.then !== 'function') {
        return Promise.resolve({ phase, status: 'fulfilled', error: null });
      }
      return Promise.resolve(promise).then(
        () => ({ phase, status: 'fulfilled', error: null }),
        (error) => ({ phase, status: 'rejected', error }),
      );
    });

    try {
      const results = await Promise.all(lifecycle);
      if (updateError) throw updateError;

      const unexpected = results.find(
        (result) => result.status === 'rejected'
          && !isRecoverableViewTransitionError(result.error)
      );
      if (unexpected) throw unexpected.error;

      const skipped = !updateApplied
        || !this._isCurrentNativeRun(run)
        || results.some((result) => result.status === 'rejected');
      return { skipped, type };
    } finally {
      this._cleanupNativeRun(run);
    }
  }

  /**
   * Fallback path using the Web Animations API. This gives us cross-browser
   * keyframe interpolation without the complexity of CSS class transition states.
   */
  async _fallbackTransition(update, type, duration, easing, className, runToken = this._runToken) {
    const el = this._targetElement();
    if (!el) {
      await update();
      return { skipped: true, type: 'none' };
    }
    if (typeof el.animate !== 'function') {
      if (runToken !== this._runToken) return { skipped: true, type };
      await update();
      return { skipped: true, type };
    }

    const run = {
      token: runToken,
      element: el,
      animations: new Set(),
      cancelled: false,
      cleaned: false,
    };
    this._activeFallback = run;

    const half = Math.max(16, duration / 2);
    const keyframes = keyframesForPreset(type);
    const outFrames = keyframes.out || [keyframes.outFrom, keyframes.outTo];
    const inFrames = keyframes.in || [keyframes.inFrom, keyframes.inTo];

    try {
      // Phase 1: animate out. Keyframe-owned transform origins stay inside the
      // animation effect; never write presentation state into authored styles.
      const outAnim = el.animate(
        outFrames,
        { duration: half, easing, fill: 'forwards' }
      );
      run.animations.add(outAnim);
      await outAnim.finished.catch(() => {});

      // A newer start cancels this animation and advances the token. The stale
      // run must not execute its DOM update after that cancellation settles.
      if (!this._isCurrentFallbackRun(run)) {
        return { skipped: true, type };
      }

      // Phase 2: keep the completed outgoing fill while the update settles,
      // then release it even when the update throws or rejects.
      try {
        await update();
      } finally {
        this._cancelFallbackAnimation(run, outAnim);
      }

      // An async update can be superseded while it is awaiting. Its side
      // effects cannot be rolled back generically, but it must not install a
      // stale incoming presentation over the newer run.
      if (!this._isCurrentFallbackRun(run)) {
        return { skipped: true, type };
      }

      // Phase 3: animate in, await completion, then cancel to reveal the
      // target's authored CSS. commitStyles() would permanently overwrite
      // opacity/transform/filter/clip-path with transition-only values.
      const inAnim = el.animate(
        inFrames,
        { duration: half, easing, fill: 'forwards' }
      );
      run.animations.add(inAnim);
      await inAnim.finished.catch(() => {});

      if (!this._isCurrentFallbackRun(run)) {
        return { skipped: true, type };
      }

      this._cancelFallbackAnimation(run, inAnim);
      return { skipped: false, type };
    } finally {
      this._cancelFallbackRun(run);
    }
  }

  _isCurrentFallbackRun(run) {
    return Boolean(
      run
      && !run.cancelled
      && !run.cleaned
      && run.token === this._runToken
      && this._activeFallback === run
    );
  }

  _isCurrentNativeRun(run) {
    return Boolean(
      run
      && !run.cancelled
      && !run.cleaned
      && run.token === this._runToken
      && this._activeNative === run
    );
  }

  _cleanupNativeRun(run) {
    if (!run || run.cleaned) return;
    run.cleaned = true;
    for (const entry of [...run.styles].reverse()) {
      try {
        if (entry.value) {
          entry.target.style.setProperty(entry.property, entry.value, entry.priority);
        } else {
          entry.target.style.removeProperty(entry.property);
        }
      } catch (_) {}
    }
    run.styles.length = 0;
    if (this._activeNative === run) this._activeNative = null;
  }

  _cancelNativeRun(run) {
    if (!run || run.cleaned) return;
    run.cancelled = true;
    try { run.controller?.abort(); } catch (_) {}
    try { run.transition?.skipTransition?.(); } catch (_) {}
    this._cleanupNativeRun(run);
  }

  _cancelFallbackAnimation(run, animation) {
    if (!animation) return;
    run?.animations?.delete(animation);
    try { animation.cancel(); } catch (_) {}
  }

  _cancelFallbackRun(run) {
    if (!run || run.cleaned) return;
    run.cancelled = true;
    for (const animation of run.animations) {
      try { animation.cancel(); } catch (_) {}
    }
    run.animations.clear();
    run.cleaned = true;
    if (this._activeFallback === run) this._activeFallback = null;
  }

  _targetElement() {
    if (this.target) {
      return typeof this.target === 'string' ? document.querySelector(this.target) : this.target;
    }
    return document.querySelector('[data-plauna-page]') || document.body;
  }

  /**
   * Build keyframes for a transition type for the Web Animations fallback.
   */
  _keyframesFor(type) {
    return keyframesForPreset(type);
  }

  /**
   * Inject a shared stylesheet for the View Transitions API pseudo-element tree.
   * Generates @keyframes and active-view-transition-type rules for every effect.
   */
  _ensureStyleSheet() {
    ensureStyleSheet(this.namespace);
  }
}

/**
 * Convenience function for one-off transitions.
 */
export function startPageTransition(update, options = {}) {
  const pt = new PageTransition(options);
  return pt.start(update);
}

export default PageTransition;
