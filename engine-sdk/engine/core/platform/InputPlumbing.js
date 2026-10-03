// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

function resolveTargetElement(target) {
  if (!target) {
    if (typeof window !== "undefined") {
      return window;
    }
    throw new Error("InputPlumbing: target is required when window is not available");
  }

  if (typeof document !== "undefined" && typeof target === "string") {
    const el = document.querySelector(target);
    if (!el) {
      throw new Error(`InputPlumbing: no element found for selector '${target}'`);
    }
    return el;
  }

  return target;
}

function normalizePointerPosition(event, element) {
  if (!element || typeof element.getBoundingClientRect !== "function") {
    return {
      x: event.clientX,
      y: event.clientY,
      normalizedX: 0,
      normalizedY: 0,
    };
  }

  const rect = element.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const width = rect.width || 1;
  const height = rect.height || 1;

  return {
    x,
    y,
    normalizedX: x / width,
    normalizedY: y / height,
  };
}

function mapPointerEventType(type) {
  switch (type) {
    case "pointerdown":
      return "down";
    case "pointerup":
      return "up";
    case "pointermove":
      return "move";
    case "pointerenter":
      return "enter";
    case "pointerleave":
      return "leave";
    default:
      return type;
  }
}

export function installPointerAndKeyboardListeners(options = {}) {
  const target = resolveTargetElement(options.target || (typeof window !== "undefined" ? window : null));
  const onInputEvent = options.onInputEvent;

  if (typeof onInputEvent !== "function") {
    throw new Error("installPointerAndKeyboardListeners: onInputEvent callback is required");
  }

  const preventDefault = options.preventDefault !== false;
  const listeners = [];

  function addListener(element, type, handler, opts) {
    if (!element || !element.addEventListener) {
      return;
    }
    element.addEventListener(type, handler, opts);
    listeners.push({ element, type, handler, opts });
  }

  function handlePointerEvent(event) {
    const element = target === window ? event.target : target;
    const pos = normalizePointerPosition(event, element);

    const data = {
      device: "pointer",
      type: event.type,
      kind: mapPointerEventType(event.type),
      pointerType: event.pointerType,
      pointerId: event.pointerId,
      button: event.button,
      buttons: event.buttons,
      x: pos.x,
      y: pos.y,
      normalizedX: pos.normalizedX,
      normalizedY: pos.normalizedY,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      targetId: event.target && event.target.id ? event.target.id : null,
      timestamp: event.timeStamp,
    };

    if (preventDefault && typeof event.preventDefault === "function") {
      event.preventDefault();
    }

    onInputEvent(data);
  }

  function handleWheelEvent(event) {
    const element = target === window ? event.target : target;
    const pos = normalizePointerPosition(event, element);

    const data = {
      device: "wheel",
      type: "wheel",
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ,
      x: pos.x,
      y: pos.y,
      normalizedX: pos.normalizedX,
      normalizedY: pos.normalizedY,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      targetId: event.target && event.target.id ? event.target.id : null,
      timestamp: event.timeStamp,
    };

    if (preventDefault && typeof event.preventDefault === "function") {
      event.preventDefault();
    }

    onInputEvent(data);
  }

  function handleKeyEvent(event) {
    const data = {
      device: "keyboard",
      type: event.type,
      key: event.key,
      code: event.code,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      repeat: event.repeat,
      targetId: event.target && event.target.id ? event.target.id : null,
      timestamp: event.timeStamp,
    };

    if (preventDefault && typeof event.preventDefault === "function") {
      event.preventDefault();
    }

    onInputEvent(data);
  }

  // Pointer events on the target element (or window fallback)
  const pointerTarget = target || (typeof window !== "undefined" ? window : null);

  addListener(pointerTarget, "pointerdown", handlePointerEvent);
  addListener(pointerTarget, "pointerup", handlePointerEvent);
  addListener(pointerTarget, "pointermove", handlePointerEvent);
  addListener(pointerTarget, "pointerenter", handlePointerEvent);
  addListener(pointerTarget, "pointerleave", handlePointerEvent);

  // Wheel events
  addListener(pointerTarget, "wheel", handleWheelEvent, { passive: !preventDefault });

  // Keyboard events on window if available
  if (typeof window !== "undefined") {
    addListener(window, "keydown", handleKeyEvent);
    addListener(window, "keyup", handleKeyEvent);
  }

  function dispose() {
    for (const { element, type, handler, opts } of listeners) {
      if (element && element.removeEventListener) {
        element.removeEventListener(type, handler, opts);
      }
    }
    listeners.length = 0;
  }

  return {
    dispose,
  };
}
