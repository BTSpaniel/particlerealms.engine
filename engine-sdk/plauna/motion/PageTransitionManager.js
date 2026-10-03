// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PageTransitionManager - Cross-document (MPA) view transition orchestration.
 *
 * This module runs on every page that opts in. It injects a shared stylesheet
 * containing the PageTransition presets and, on supported browsers, sets the
 * active view transition type for cross-document navigations via the pageswap
 * and pagereveal events.
 *
 * Pages can control their transition with a data attribute on the <html> element:
 *   <html data-transition-preset="etch">
 *   <html data-transition-preset="random">
 *   <html data-transition-preset="cycle">
 *
 * The default is the project's default preset (etch). If the attribute is absent
 * or the value is unknown, the default is used.
 */

import {
  DEFAULT_PRESET,
  DEFAULT_DURATION,
  DEFAULT_EASING,
  TYPES,
  SPECIAL_TYPES,
  resolvePreset,
  directionToPreset,
  ensureStyleSheet,
} from './PageTransitionPresets.js';
import {
  preparePageTransitionIntent,
  preparePageTransitionResolved,
} from './PageTransitionContracts.js';

const NAMESPACE = 'plauna-pt';
const CYCLE_KEY = 'plauna-pt-cross-cycle';
const NAVIGATION_KEY = 'plauna-pt-nav-intent';
const RESOLVED_KEY = 'plauna-pt-resolved';

const allConcrete = [...TYPES];

function getPagePreset() {
  const preset = document.documentElement?.dataset?.transitionPreset;
  if (preset && (TYPES.has(preset) || SPECIAL_TYPES.has(preset) || preset === 'direction' || preset === 'auto')) {
    return preset;
  }
  return DEFAULT_PRESET;
}

function getDirectionFromActivation(activation) {
  if (!activation) return null;
  const { from, entry, navigationType } = activation;
  try {
    if (typeof from?.index === 'number' && typeof entry?.index === 'number') {
      if (entry.index < from.index) return 'backward';
      if (entry.index > from.index) return 'forward';
      return 'reload';
    }
  } catch (_) {}
  if (navigationType === 'reload') return 'reload';
  if (navigationType === 'push') return 'forward';
  if (navigationType === 'traverse') return 'backward';
  return null;
}

function pickPreset(requested) {
  let state = { index: parseInt(sessionStorage.getItem(CYCLE_KEY) || '0', 10) || 0 };
  const resolved = resolvePreset(requested, state);
  sessionStorage.setItem(CYCLE_KEY, String(resolved.state.index));
  return resolved.name;
}

function resolveType(requested, intent, activation) {
  // Per-link preset wins over everything.
  if (intent && intent.preset) requested = intent.preset;

  // Per-link direction without a preset overrides the page's default.
  if (intent && intent.direction && !intent.preset) requested = 'direction';

  if (requested === 'direction' || requested === 'auto') {
    const dir = (intent && intent.direction) || getDirectionFromActivation(activation) || 'forward';
    return directionToPreset(dir);
  }

  if (TYPES.has(requested)) return requested;
  if (SPECIAL_TYPES.has(requested)) return pickPreset(requested);

  // If no preset was chosen, a per-link direction can resolve.
  if (intent && intent.direction) return directionToPreset(intent.direction);

  return DEFAULT_PRESET;
}

function getLinkIntent(event) {
  const a = event.target?.closest('a[href]');
  if (!a) return null;
  const { transitionPreset, transitionDirection, transitionMorph, transitionDuration, transitionEasing, transitionClass, transitionFocus } = a.dataset;
  if (!transitionPreset && !transitionDirection && !transitionMorph && !transitionDuration && !transitionEasing && !transitionClass && !transitionFocus) return null;
  return {
    preset: transitionPreset || null,
    direction: transitionDirection || null,
    morph: transitionMorph || null,
    duration: transitionDuration || null,
    easing: transitionEasing || null,
    class: transitionClass || null,
    focus: transitionFocus || null,
  };
}

function getStoredIntent() {
  try {
    const raw = sessionStorage.getItem(NAVIGATION_KEY);
    if (raw) return preparePageTransitionIntent(JSON.parse(raw));
  } catch (error) {
    console.warn('[PageTransitionManager] Ignoring invalid navigation intent:', error);
  }
  return null;
}

function storeIntent(intent) {
  try {
    sessionStorage.setItem(NAVIGATION_KEY, JSON.stringify(preparePageTransitionIntent(intent)));
  } catch (error) {
    console.warn('[PageTransitionManager] Failed to store navigation intent:', error);
  }
}

function clearIntent() {
  try {
    sessionStorage.removeItem(NAVIGATION_KEY);
  } catch (_) {}
}

function setResolved(meta) {
  try {
    sessionStorage.setItem(RESOLVED_KEY, JSON.stringify(preparePageTransitionResolved(meta)));
  } catch (error) {
    console.warn('[PageTransitionManager] Failed to store resolved transition:', error);
  }
}

function consumeResolved() {
  try {
    const raw = sessionStorage.getItem(RESOLVED_KEY);
    if (raw) {
      const prepared = preparePageTransitionResolved(JSON.parse(raw));
      sessionStorage.removeItem(RESOLVED_KEY);
      return prepared;
    }
  } catch (error) {
    console.warn('[PageTransitionManager] Ignoring invalid resolved transition:', error);
  }
  return { type: null, morphId: null, duration: null, easing: null, class: null, focus: null };
}

function getPageMeta() {
  const html = document.documentElement;
  return {
    duration: html?.dataset?.transitionDuration || null,
    easing: html?.dataset?.transitionEasing || null,
    class: html?.dataset?.transitionClass || null,
    focus: html?.dataset?.transitionFocus || null,
  };
}

function parseDuration(value) {
  const str = String(value || '').trim().toLowerCase();
  if (!str) return null;
  const ms = str.match(/^([\d.]+)\s*ms$/);
  if (ms) return Math.max(0, parseFloat(ms[1]));
  const s = str.match(/^([\d.]+)\s*s$/);
  if (s) return Math.max(0, parseFloat(s[1]) * 1000);
  const raw = parseFloat(str);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return null;
}

function resolveDuration(intent, pageMeta) {
  return parseDuration(intent?.duration || pageMeta?.duration) || DEFAULT_DURATION;
}

function resolveEasing(intent, pageMeta) {
  return intent?.easing || pageMeta?.easing || DEFAULT_EASING;
}

function resolveClass(intent, pageMeta) {
  return intent?.class || pageMeta?.class || null;
}

function resolveFocus(intent, pageMeta) {
  const value = intent?.focus || pageMeta?.focus || null;
  if (value === null || value === undefined) return null;
  return value === '' || value === 'true' ? 'h1' : value;
}

function resolveMeta(intent, activation) {
  const pageMeta = getPageMeta();
  const type = resolveType(getPagePreset(), intent, activation);
  const duration = resolveDuration(intent, pageMeta);
  const easing = resolveEasing(intent, pageMeta);
  const className = resolveClass(intent, pageMeta);
  const focus = resolveFocus(intent, pageMeta);
  const morphId = intent?.morph || null;
  return { type, duration, easing, class: className, focus, morphId };
}

function applyTypeToTransition(viewTransition, type) {
  if (viewTransition && viewTransition.types) {
    try {
      if (typeof viewTransition.types.clear === 'function') viewTransition.types.clear();
      if (typeof viewTransition.types.add === 'function') viewTransition.types.add(type);
    } catch (_) {}
  }
}

function applyTransitionVars(duration, easing) {
  if (duration) document.documentElement.style.setProperty(`--${NAMESPACE}-duration`, `${duration}ms`);
  if (easing) document.documentElement.style.setProperty(`--${NAMESPACE}-easing`, easing);
}

function applyViewTransitionClass(className) {
  if (className) document.documentElement.style.setProperty('view-transition-class', className);
}

function applyMorphName(morphId, className) {
  if (!morphId) return;
  const el = document.querySelector(`[data-transition-morph="${morphId}"]`);
  if (!el) return;
  el.style.viewTransitionName = `morph-${morphId}`;
  if (className) el.style.setProperty('view-transition-class', className);
}

function scheduleFocus(viewTransition, selector) {
  if (!viewTransition || !selector || typeof viewTransition.finished?.then !== 'function') return;
  viewTransition.finished.then(() => {
    const el = document.querySelector(selector);
    if (!el) return;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  }).catch(() => {});
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function init() {
  if (typeof document === 'undefined') return;

  // Make the shared transition stylesheet available. This is the same stylesheet
  // PageTransition uses for same-document transitions, so both SPA and MPA paths
  // share the same keyframes and active-view-transition-type rules.
  ensureStyleSheet(NAMESPACE);

  // Default cross-document duration matches the existing site CSS timing.
  document.documentElement.style.setProperty(`--${NAMESPACE}-duration`, `${DEFAULT_DURATION}ms`);

  // Capture per-link transition intent before navigation so pageswap/pagereveal
  // can use data-transition-preset, data-transition-direction,
  // data-transition-morph, data-transition-duration, data-transition-easing,
  // data-transition-class, and data-transition-focus attributes on the clicked <a>.
  document.addEventListener('click', (e) => {
    const intent = getLinkIntent(e);
    if (intent) storeIntent(intent);
    else clearIntent();
  }, true);

  // pageswap fires on the outgoing page. Resolve the concrete preset from the
  // page default, per-link intent, and NavigationActivation direction.
  window.addEventListener('pageswap', (e) => {
    if (!e.viewTransition) return;
    if (prefersReducedMotion()) return;
    const intent = getStoredIntent();
    const meta = resolveMeta(intent, e.activation);
    if (meta.type === 'none') {
      try { e.viewTransition.skipTransition(); } catch (_) {}
      clearIntent();
      setResolved(meta);
      return;
    }
    applyTransitionVars(meta.duration, meta.easing);
    applyViewTransitionClass(meta.class);
    applyMorphName(meta.morphId, meta.class);
    clearIntent();
    setResolved(meta);
    applyTypeToTransition(e.viewTransition, meta.type);
  });

  // pagereveal fires on the incoming page. Use the resolved type from pageswap.
  // If the browser didn't fire pageswap, fall back to the current page's preset.
  window.addEventListener('pagereveal', (e) => {
    if (!e.viewTransition) return;
    if (prefersReducedMotion()) return;
    let meta = consumeResolved();
    if (!meta.type) {
      meta = resolveMeta(null, e.activation);
    }
    if (meta.type === 'none') {
      try { e.viewTransition.skipTransition(); } catch (_) {}
      return;
    }
    applyTransitionVars(meta.duration, meta.easing);
    applyViewTransitionClass(meta.class);
    applyMorphName(meta.morphId, meta.class);
    applyTypeToTransition(e.viewTransition, meta.type);
    scheduleFocus(e.viewTransition, meta.focus);
  });
}

init();
