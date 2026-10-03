// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Accessible, framework-free pane splitter shared by factory applications.
 *
 * Pointer movement emits preview values. A completed pointer, keyboard, or
 * reset interaction emits exactly one settled commit. Cancellation and destroy
 * restore the last committed value without publishing a commit.
 */

const ORIENTATIONS = new Set(['vertical', 'horizontal']);

export function normalizeSplitterOrientation(value = 'vertical') {
  const orientation = String(value || '').toLowerCase();
  if (!ORIENTATIONS.has(orientation)) {
    throw new TypeError(`Unsupported splitter orientation: ${value}`);
  }
  return orientation;
}

function finiteNumber(value, fallback, label) {
  const number = Number(value == null && fallback != null ? fallback : value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be a finite number.`);
  return number;
}

function optionalFunction(value, label) {
  if (value != null && typeof value !== 'function') {
    throw new TypeError(`${label} must be a function when provided.`);
  }
}

function positiveNumber(value, fallback, label) {
  const number = finiteNumber(value, fallback, label);
  if (number <= 0) throw new RangeError(`${label} must be greater than zero.`);
  return number;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function decimalPlaces(value) {
  const text = String(value).toLowerCase();
  if (text.includes('e-')) return Number(text.split('e-')[1]) || 0;
  return text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
}

function quantize(value, min, max, step, origin = min) {
  const precision = Math.min(12, Math.max(decimalPlaces(origin), decimalPlaces(step)));
  const stepped = origin + Math.round((value - origin) / step) * step;
  return clamp(Number(stepped.toFixed(precision)), min, max);
}

/**
 * Create a WAI-ARIA separator with pointer, keyboard, and reset behavior.
 *
 * @param {object} [options]
 * @param {'vertical'|'horizontal'} [options.orientation='vertical']
 * @param {string} [options.label='Resize panes']
 * @param {number} [options.value]
 * @param {number} [options.min=0]
 * @param {number} [options.max=100]
 * @param {number} [options.defaultValue]
 * @param {number} [options.step=1]
 * @param {number} [options.largeStep=10]
 * @param {1|-1} [options.direction=1] Maps positive pointer/arrow movement to values.
 * @param {(value:number)=>string} [options.formatValue]
 * @param {(value:number, detail:object)=>void} [options.onPreview]
 * @param {(value:number, detail:object)=>void} [options.onCommit]
 * @returns {HTMLElement}
 */
export function createAccessibleSplitter(options = {}) {
  optionalFunction(options.formatValue, 'formatValue');
  optionalFunction(options.onPreview, 'onPreview');
  optionalFunction(options.onCommit, 'onCommit');
  const orientation = normalizeSplitterOrientation(options.orientation);
  let min = finiteNumber(options.min, 0, 'min');
  let max = finiteNumber(options.max, 100, 'max');
  if (max < min) throw new RangeError('max must be greater than or equal to min.');

  const step = positiveNumber(options.step, 1, 'step');
  const largeStep = positiveNumber(options.largeStep, step * 10, 'largeStep');
  const direction = options.direction == null ? 1 : Number(options.direction);
  if (direction !== 1 && direction !== -1) {
    throw new RangeError('direction must be 1 or -1.');
  }

  let defaultValue = clamp(
    finiteNumber(options.defaultValue, options.value == null ? min : Number(options.value), 'defaultValue'),
    min,
    max,
  );
  let value = clamp(finiteNumber(options.value, defaultValue, 'value'), min, max);
  let committedValue = value;
  let activePointer = null;
  let destroyed = false;
  const listeners = [];

  const node = document.createElement('div');
  node.className = `fx-splitter fx-splitter--${orientation}`;
  node.tabIndex = 0;
  node.setAttribute('role', 'separator');
  node.setAttribute('aria-label', options.label || 'Resize panes');
  node.setAttribute('aria-orientation', orientation);

  function listen(type, handler, listenerOptions) {
    node.addEventListener(type, handler, listenerOptions);
    listeners.push(() => node.removeEventListener(type, handler, listenerOptions));
  }

  function syncAria() {
    node.setAttribute('aria-valuemin', String(min));
    node.setAttribute('aria-valuemax', String(max));
    node.setAttribute('aria-valuenow', String(value));
    if (typeof options.formatValue === 'function') {
      const valueText = options.formatValue(value);
      if (valueText == null || valueText === '') node.removeAttribute('aria-valuetext');
      else node.setAttribute('aria-valuetext', String(valueText));
    } else {
      node.removeAttribute('aria-valuetext');
    }
  }

  function callbackDetail(reason, previousValue, sourceEvent, nextCommittedValue = committedValue) {
    return Object.freeze({
      reason,
      orientation,
      previousValue,
      value,
      committedValue: nextCommittedValue,
      sourceEvent: sourceEvent || null,
    });
  }

  function preview(nextValue, reason, sourceEvent) {
    const next = clamp(nextValue, min, max);
    if (Object.is(next, value)) return false;
    const previousValue = value;
    value = next;
    syncAria();
    options.onPreview?.(value, callbackDetail(reason, previousValue, sourceEvent));
    return true;
  }

  function commit(reason, sourceEvent) {
    if (Object.is(value, committedValue)) return false;
    const previousValue = committedValue;
    committedValue = value;
    options.onCommit?.(value, callbackDetail(reason, previousValue, sourceEvent, committedValue));
    return true;
  }

  function previewAndCommit(nextValue, reason, sourceEvent) {
    preview(nextValue, reason, sourceEvent);
    commit(reason, sourceEvent);
  }

  function pointerCoordinate(event) {
    return orientation === 'vertical' ? Number(event.clientX) : Number(event.clientY);
  }

  function releasePointerCapture(pointerId) {
    try {
      if (node.hasPointerCapture?.(pointerId)) node.releasePointerCapture(pointerId);
    } catch (error) {
      console.debug('[Factory UI] Splitter pointer capture was already released.', error);
    }
  }

  function clearPointerState() {
    const pointer = activePointer;
    activePointer = null;
    node.classList.remove('fx-splitter--dragging');
    node.removeAttribute('data-dragging');
    return pointer;
  }

  function settlePointer(reason, event) {
    const pointer = clearPointerState();
    if (!pointer) return;
    releasePointerCapture(pointer.pointerId);
    commit(reason, event);
  }

  function cancelPointer({ restore = true, reason = 'cancel', sourceEvent = null } = {}) {
    const pointer = clearPointerState();
    if (!pointer) return false;
    releasePointerCapture(pointer.pointerId);
    if (restore) preview(committedValue, reason, sourceEvent);
    return true;
  }

  function onPointerDown(event) {
    if (destroyed || activePointer || event.button !== 0 || event.isPrimary === false) return;
    const coordinate = pointerCoordinate(event);
    if (!Number.isFinite(coordinate)) return;
    event.preventDefault();
    node.focus({ preventScroll: true });
    activePointer = {
      pointerId: event.pointerId,
      startCoordinate: coordinate,
      startValue: value,
    };
    node.classList.add('fx-splitter--dragging');
    node.setAttribute('data-dragging', 'true');
    try {
      node.setPointerCapture?.(event.pointerId);
    } catch (error) {
      console.debug('[Factory UI] Splitter could not capture the pointer.', error);
    }
  }

  function onPointerMove(event) {
    if (!activePointer || event.pointerId !== activePointer.pointerId) return;
    const coordinate = pointerCoordinate(event);
    if (!Number.isFinite(coordinate)) return;
    event.preventDefault();
    const delta = (coordinate - activePointer.startCoordinate) * direction;
    preview(quantize(activePointer.startValue + delta, min, max, step, activePointer.startValue), 'pointer', event);
  }

  function onPointerUp(event) {
    if (!activePointer || event.pointerId !== activePointer.pointerId) return;
    event.preventDefault();
    settlePointer('pointer', event);
  }

  function onPointerCancel(event) {
    if (!activePointer || event.pointerId !== activePointer.pointerId) return;
    cancelPointer({ restore: true, reason: 'pointer-cancel', sourceEvent: event });
  }

  function onLostPointerCapture(event) {
    if (!activePointer || event.pointerId !== activePointer.pointerId) return;
    settlePointer('lost-pointer-capture', event);
  }

  function onKeyDown(event) {
    if (destroyed || event.altKey || event.ctrlKey || event.metaKey) return;
    const decrementKey = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
    const incrementKey = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    let nextValue = null;
    if (event.key === decrementKey || event.key === incrementKey) {
      const amount = event.shiftKey ? largeStep : step;
      const physicalDirection = event.key === incrementKey ? 1 : -1;
      nextValue = quantize(value + amount * physicalDirection * direction, min, max, step, value);
    } else if (event.key === 'Home') {
      nextValue = min;
    } else if (event.key === 'End') {
      nextValue = max;
    }
    if (nextValue == null) return;
    event.preventDefault();
    previewAndCommit(nextValue, 'keyboard', event);
  }

  function onDoubleClick(event) {
    if (destroyed) return;
    event.preventDefault();
    cancelPointer({ restore: true, reason: 'double-click-cancel', sourceEvent: event });
    previewAndCommit(defaultValue, 'reset', event);
  }

  listen('pointerdown', onPointerDown);
  listen('pointermove', onPointerMove);
  listen('pointerup', onPointerUp);
  listen('pointercancel', onPointerCancel);
  listen('lostpointercapture', onLostPointerCapture);
  listen('keydown', onKeyDown);
  listen('dblclick', onDoubleClick);

  /** Update the value. With no callback flags this is an authoritative sync. */
  node.setValue = (nextValue, updateOptions = {}) => {
    if (destroyed) return value;
    const next = clamp(finiteNumber(nextValue, null, 'value'), min, max);
    const shouldPreview = updateOptions.preview === true;
    const shouldCommit = updateOptions.commit === true;
    const reason = updateOptions.reason || 'programmatic';
    cancelPointer({ restore: false, reason: `${reason}-cancel` });
    if (shouldPreview || shouldCommit) {
      if (shouldPreview) preview(next, reason, null);
      else {
        value = next;
        syncAria();
      }
      if (shouldCommit) commit(reason, null);
    } else {
      value = next;
      committedValue = next;
      syncAria();
    }
    return value;
  };

  node.setBounds = (bounds = {}) => {
    if (destroyed) return Object.freeze({ min, max, defaultValue, value });
    const nextMin = finiteNumber(bounds.min, min, 'min');
    const nextMax = finiteNumber(bounds.max, max, 'max');
    if (nextMax < nextMin) throw new RangeError('max must be greater than or equal to min.');
    const nextDefault = clamp(finiteNumber(bounds.defaultValue, defaultValue, 'defaultValue'), nextMin, nextMax);
    const nextValue = clamp(finiteNumber(bounds.value, value, 'value'), nextMin, nextMax);
    cancelPointer({ restore: true, reason: 'bounds-cancel' });
    min = nextMin;
    max = nextMax;
    defaultValue = nextDefault;
    value = nextValue;
    committedValue = nextValue;
    syncAria();
    return Object.freeze({ min, max, defaultValue, value });
  };

  node.cancelInteraction = ({ restore = true } = {}) => cancelPointer({
    restore,
    reason: 'programmatic-cancel',
  });

  node.destroy = () => {
    if (destroyed) return;
    cancelPointer({ restore: true, reason: 'destroy-cancel' });
    destroyed = true;
    while (listeners.length) listeners.pop()();
  };

  Object.defineProperties(node, {
    value: {
      configurable: true,
      get: () => value,
      set: nextValue => node.setValue(nextValue),
    },
    min: { configurable: true, get: () => min },
    max: { configurable: true, get: () => max },
    defaultValue: { configurable: true, get: () => defaultValue },
    orientation: { configurable: true, get: () => orientation },
  });

  syncAria();
  return node;
}
