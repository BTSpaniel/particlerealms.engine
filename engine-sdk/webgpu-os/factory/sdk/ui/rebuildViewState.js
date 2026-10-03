// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Create a DOM rebuild-state adapter from app-owned element resolvers.
 *
 * The shared helper owns only generic scroll/focus capture and restoration.
 * Callers retain their selectors, stable identity attributes, and snapshot
 * shape, which keeps app taxonomy out of the SDK and permits compatibility
 * wrappers around existing public APIs.
 */
export function createRebuildViewStateAdapter({
  scrollTargets = {},
  scrollCollections = {},
  focus = null,
  restoreAfterFocus = [],
} = {}) {
  const targets = normalizeScrollTargets(scrollTargets);
  const collections = normalizeScrollCollections(scrollCollections);
  const focusConfig = normalizeFocusConfig(focus);
  const postFocusTargets = normalizePostFocusTargets(restoreAfterFocus, targets);

  function capture(host) {
    if (!host) return null;
    const state = {};
    for (const [name, resolve] of targets) {
      state[name] = captureScrollPoint(resolve(host));
    }
    for (const collection of collections) {
      const entries = [];
      for (const item of toArray(collection.resolveItems(host))) {
        const key = collection.resolveKey(item);
        if (key == null) continue;
        entries.push([String(key), captureScrollPoint(collection.resolveTarget(item))]);
      }
      state[collection.name] = Object.fromEntries(entries);
    }
    if (focusConfig) state.focus = captureFocusIdentity(host, focusConfig);
    return state;
  }

  function restore(host, state) {
    if (!host || !state) return false;
    for (const [name, resolve] of targets) {
      applyScrollPoint(resolve(host), state[name]);
    }
    for (const collection of collections) {
      const saved = state[collection.name];
      for (const item of toArray(collection.resolveItems(host))) {
        const key = collection.resolveKey(item);
        if (key == null) continue;
        applyScrollPoint(collection.resolveTarget(item), saved?.[String(key)]);
      }
    }
    if (focusConfig) restoreFocusIdentity(host, state.focus, focusConfig);
    for (const name of postFocusTargets) {
      applyScrollPoint(targets.get(name)?.(host), state[name]);
    }
    return true;
  }

  return Object.freeze({ capture, restore });
}

function normalizeScrollTargets(value) {
  if (!value || typeof value !== 'object') throw new TypeError('scrollTargets must be an object');
  const targets = new Map();
  for (const [name, resolve] of Object.entries(value)) {
    if (typeof resolve !== 'function') throw new TypeError(`scroll target "${name}" must be a resolver function`);
    targets.set(name, resolve);
  }
  return targets;
}

function normalizeScrollCollections(value) {
  if (!value || typeof value !== 'object') throw new TypeError('scrollCollections must be an object');
  return Object.freeze(Object.entries(value).map(([name, definition]) => {
    if (typeof definition?.items !== 'function') {
      throw new TypeError(`scroll collection "${name}" must define items(host)`);
    }
    if (typeof definition?.key !== 'function') {
      throw new TypeError(`scroll collection "${name}" must define key(item)`);
    }
    if (definition.target != null && typeof definition.target !== 'function') {
      throw new TypeError(`scroll collection "${name}" target must be a function`);
    }
    return Object.freeze({
      name,
      resolveItems: definition.items,
      resolveKey: definition.key,
      resolveTarget: definition.target ?? (item => item),
    });
  }));
}

function normalizeFocusConfig(value) {
  if (value == null) return null;
  if (typeof value !== 'object') throw new TypeError('focus must be an object');
  const attributes = Object.freeze(Array.from(new Set(
    (Array.isArray(value.attributes) ? value.attributes : [])
      .filter(name => typeof name === 'string' && name.length),
  )));
  if (typeof value.captureScope !== 'undefined' && typeof value.captureScope !== 'function') {
    throw new TypeError('focus.captureScope must be a function');
  }
  if (typeof value.resolveScope !== 'undefined' && typeof value.resolveScope !== 'function') {
    throw new TypeError('focus.resolveScope must be a function');
  }
  return Object.freeze({
    attributes,
    captureScope: value.captureScope ?? null,
    resolveScope: value.resolveScope ?? null,
  });
}

function normalizePostFocusTargets(value, targets) {
  if (!Array.isArray(value)) throw new TypeError('restoreAfterFocus must be an array');
  return Object.freeze(Array.from(new Set(value.filter(name => targets.has(name)))));
}

function captureScrollPoint(element) {
  return element ? {
    top: nonNegativeFinite(element.scrollTop),
    left: nonNegativeFinite(element.scrollLeft),
  } : null;
}

function applyScrollPoint(element, point) {
  if (!element || !point) return false;
  element.scrollTop = nonNegativeFinite(point.top);
  element.scrollLeft = nonNegativeFinite(point.left);
  return true;
}

function nonNegativeFinite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function captureFocusIdentity(host, config) {
  let activeElement = host.getRootNode?.()?.activeElement ?? host.ownerDocument?.activeElement;
  while (activeElement?.shadowRoot?.activeElement) activeElement = activeElement.shadowRoot.activeElement;
  if (!activeElement || !host.contains?.(activeElement)) return null;
  const attributes = {};
  for (const name of config.attributes) {
    const value = activeElement.getAttribute?.(name);
    if (value != null && value !== '') attributes[name] = value;
  }
  if (!Object.keys(attributes).length) return null;
  const scope = config.captureScope?.(activeElement, host);
  return {
    ...(scope && typeof scope === 'object' && !Array.isArray(scope) ? scope : {}),
    tagName: activeElement.tagName?.toLowerCase?.() ?? '',
    attributes,
  };
}

function restoreFocusIdentity(host, identity, config) {
  if (typeof identity?.tagName !== 'string' || !/^[a-z][a-z0-9-]*$/.test(identity.tagName)) return false;
  const scope = config.resolveScope ? config.resolveScope(host, identity) : host;
  if (typeof scope?.querySelectorAll !== 'function') return false;
  let candidates;
  try {
    candidates = Array.from(scope.querySelectorAll(identity.tagName));
  } catch {
    return false;
  }
  const attributes = identity.attributes && typeof identity.attributes === 'object' && !Array.isArray(identity.attributes)
    ? Object.entries(identity.attributes)
    : [];
  if (!attributes.length || attributes.some(([name, value]) => !config.attributes.includes(name) || typeof value !== 'string')) {
    return false;
  }
  const replacement = candidates.find(candidate => attributes.every(
    ([name, value]) => candidate.getAttribute?.(name) === value,
  ));
  if (!replacement) return false;
  try {
    replacement.focus({ preventScroll: true });
  } catch {
    replacement.focus?.();
  }
  return true;
}

function toArray(value) {
  if (value == null) return [];
  try {
    return Array.from(value);
  } catch {
    return [];
  }
}

export default createRebuildViewStateAdapter;
