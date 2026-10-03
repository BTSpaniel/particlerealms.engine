// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * StandardInputController - Unified keyboard/mouse input handling for 3D scenes
 * Handles camera controls, entity selection, spawning, and grabbing.
 */

import { inputRadialDeadzoneReport } from "../../core/math/InputSignalMath.js";
import { clamp } from "../../core/math/MathScalar.js";
import { finiteNumberReport } from "../../core/math/MathValidation.js";

export const STANDARD_INPUT_LIMITS = Object.freeze({
  defaultGamepadDeadzone: 0.15,
  defaultGamepadLookDeadzone: 0.15,
  defaultGamepadButtonThreshold: 0.5,
  maxGamepadIndex: 15,
  maxGamepadAxisIndex: 31,
  maxGamepadButtonIndex: 63,
  maxGamepadHapticDurationMs: 5000,
  maxGamepadHapticDelayMs: 5000,
  maxWheelDelta: 1e6,
  maxActionCount: 16,
  maxBindingsPerAction: 8,
  maxBindingLength: 64,
  maxPressedBindings: 128,
});

export const DEFAULT_STANDARD_INPUT_ACTION_MAP = Object.freeze({
  moveForward: Object.freeze(["KeyW"]),
  moveBackward: Object.freeze(["KeyS"]),
  moveLeft: Object.freeze(["KeyA"]),
  moveRight: Object.freeze(["KeyD"]),
  moveUp: Object.freeze(["Space", "button:0"]),
  moveDown: Object.freeze(["ControlLeft", "ControlRight", "button:1"]),
  sprint: Object.freeze(["ShiftLeft", "ShiftRight", "button:10"]),
  cameraFirstPerson: Object.freeze(["Digit1"]),
  cameraThirdPerson: Object.freeze(["Digit2"]),
  deleteSelected: Object.freeze(["Delete"]),
  ghostForward: Object.freeze(["ArrowUp"]),
  ghostBackward: Object.freeze(["ArrowDown"]),
  ghostLeft: Object.freeze(["ArrowLeft"]),
  ghostRight: Object.freeze(["ArrowRight"]),
  ghostUp: Object.freeze(["key:+"]),
  ghostDown: Object.freeze(["key:-"]),
});

const STANDARD_INPUT_ACTIONS = Object.freeze(Object.keys(DEFAULT_STANDARD_INPUT_ACTION_MAP));
const STANDARD_INPUT_ACTION_SET = new Set(STANDARD_INPUT_ACTIONS);
const LEGACY_POINTER_LOCK_WATCH_MS = 1000;

function inputBindingValid(binding) {
  if (typeof binding !== "string" || binding.length === 0 ||
      binding.length > STANDARD_INPUT_LIMITS.maxBindingLength) return false;
  if (binding.startsWith("key:")) {
    const character = binding.slice(4);
    return character.length > 0 && character.length <= 16 && !/[\u0000-\u001f\u007f]/.test(character);
  }
  if (binding.startsWith("button:")) {
    const index = Number(binding.slice(7));
    return Number.isSafeInteger(index) && index >= 0 && index <= STANDARD_INPUT_LIMITS.maxGamepadButtonIndex;
  }
  return /^[A-Za-z][A-Za-z0-9]*$/.test(binding);
}

export function standardInputActionMapReport(actionMap, options = {}) {
  const object = actionMap !== null && typeof actionMap === "object" &&
    !Array.isArray(actionMap) && !ArrayBuffer.isView(actionMap);
  const entries = object ? Object.entries(actionMap) : [];
  const unknownActions = entries.map(([action]) => action).filter((action) => !STANDARD_INPUT_ACTION_SET.has(action));
  const missingActions = STANDARD_INPUT_ACTIONS.filter((action) => !Object.hasOwn(actionMap ?? {}, action));
  const invalidBindings = [];
  const duplicateBindings = [];
  const owners = new Map();
  const normalized = {};
  for (const action of STANDARD_INPUT_ACTIONS) {
    const bindings = object ? actionMap[action] : null;
    if (!Array.isArray(bindings) || bindings.length === 0 ||
        bindings.length > STANDARD_INPUT_LIMITS.maxBindingsPerAction) {
      invalidBindings.push({ action, binding: null });
      continue;
    }
    const unique = [];
    const seen = new Set();
    for (const binding of bindings) {
      if (!inputBindingValid(binding)) {
        invalidBindings.push({ action, binding });
        continue;
      }
      if (seen.has(binding)) {
        duplicateBindings.push({ action, binding });
        continue;
      }
      seen.add(binding);
      unique.push(binding);
      const bindingOwners = owners.get(binding) ?? [];
      bindingOwners.push(action);
      owners.set(binding, bindingOwners);
    }
    normalized[action] = Object.freeze(unique);
  }
  const conflicts = Array.from(owners, ([binding, actions]) => ({ binding, actions: Object.freeze(actions) }))
    .filter((entry) => entry.actions.length > 1);
  const structural = object && entries.length <= STANDARD_INPUT_LIMITS.maxActionCount &&
    unknownActions.length === 0 && missingActions.length === 0 && invalidBindings.length === 0 &&
    duplicateBindings.length === 0;
  const conflictFree = conflicts.length === 0;
  const valid = structural && (conflictFree || options.allowConflicts === true);
  return {
    valid,
    structural,
    conflictFree,
    object,
    actionCount: entries.length,
    unknownActions: Object.freeze(unknownActions),
    missingActions: Object.freeze(missingActions),
    invalidBindings: Object.freeze(invalidBindings),
    duplicateBindings: Object.freeze(duplicateBindings),
    conflicts: Object.freeze(conflicts),
    actionMap: valid ? Object.freeze(normalized) : null,
  };
}

export function standardInputActionStateReport(actionMap, pressedBindings) {
  const map = standardInputActionMapReport(actionMap, { allowConflicts: true });
  const pressed = pressedBindings instanceof Set ? Array.from(pressedBindings) : pressedBindings;
  const validPressed = Array.isArray(pressed) && pressed.length <= STANDARD_INPUT_LIMITS.maxPressedBindings &&
    pressed.every(inputBindingValid);
  if (!map.valid || !validPressed) return { valid: false, map, validPressed, actions: null };
  const pressedSet = new Set(pressed);
  const actions = {};
  for (const action of STANDARD_INPUT_ACTIONS) {
    actions[action] = map.actionMap[action].some((binding) => pressedSet.has(binding));
  }
  return {
    valid: true,
    map,
    validPressed,
    pressedBindings: Object.freeze(Array.from(pressedSet)),
    actions: Object.freeze(actions),
  };
}

function syncStandardInputActions(ctrl) {
  const state = standardInputActionStateReport(ctrl.actionMap, ctrl.pressedBindings);
  if (!state.valid) return false;
  ctrl.actions = { ...state.actions };
  ctrl.keys.w = state.actions.moveForward;
  ctrl.keys.s = state.actions.moveBackward;
  ctrl.keys.a = state.actions.moveLeft;
  ctrl.keys.d = state.actions.moveRight;
  ctrl.keys[" "] = state.actions.moveUp;
  ctrl.keys.Control = state.actions.moveDown;
  ctrl.keys.Shift = state.actions.sprint;
  return true;
}

export function rebindStandardInputAction(ctrl, action, bindings, options = {}) {
  if (!ctrl || typeof ctrl !== "object" || !STANDARD_INPUT_ACTION_SET.has(action)) {
    return { valid: false, reason: "invalid-controller-or-action" };
  }
  const candidate = { ...ctrl.actionMap, [action]: bindings };
  const report = standardInputActionMapReport(candidate, options);
  if (!report.valid) return { ...report, reason: report.conflictFree ? "invalid-action-map" : "binding-conflict" };
  ctrl.actionMap = report.actionMap;
  if (!syncStandardInputActions(ctrl)) return { valid: false, reason: "invalid-pressed-state" };
  return { ...report, action, bindings: report.actionMap[action] };
}

export function standardGamepadMovementReport(gamepad, options = {}) {
  const object = gamepad !== null && typeof gamepad === "object";
  const connected = object && gamepad.connected !== false;
  const axesLike = connected && gamepad.axes !== null && typeof gamepad.axes === "object";
  const horizontalAxis = finiteNumberReport(options.horizontalAxis ?? 0, {
    integer: true,
    min: 0,
    max: STANDARD_INPUT_LIMITS.maxGamepadAxisIndex,
  });
  const forwardAxis = finiteNumberReport(options.forwardAxis ?? 1, {
    integer: true,
    min: 0,
    max: STANDARD_INPUT_LIMITS.maxGamepadAxisIndex,
  });
  if (!axesLike || !horizontalAxis.valid || !forwardAxis.valid) {
    return { valid: false, object, connected, axesLike, horizontalAxis, forwardAxis };
  }
  const radial = inputRadialDeadzoneReport([
    gamepad.axes[horizontalAxis.value],
    gamepad.axes[forwardAxis.value],
  ], {
    dimension: 2,
    deadzone: options.deadzone ?? STANDARD_INPUT_LIMITS.defaultGamepadDeadzone,
    outerDeadzone: options.outerDeadzone ?? 0,
    gamma: options.gamma ?? 1,
  });
  if (!radial.valid) {
    return { valid: false, object, connected, axesLike, horizontalAxis, forwardAxis, radial };
  }
  const movementAxes = Object.freeze([-radial.value[0], 0, -radial.value[1]]);
  return {
    valid: true,
    object,
    connected,
    axesLike,
    horizontalAxis,
    forwardAxis,
    radial,
    movementAxes,
    gamepadIndex: Number.isSafeInteger(gamepad.index) ? gamepad.index : null,
    gamepadId: typeof gamepad.id === "string" ? gamepad.id : "",
  };
}

export function standardGamepadButtonReport(button, options = {}) {
  const object = button !== null && typeof button === "object";
  const numeric = typeof button === "number";
  const value = finiteNumberReport(numeric ? button : button?.value, { min: 0, max: 1 });
  const threshold = finiteNumberReport(
    options.threshold ?? STANDARD_INPUT_LIMITS.defaultGamepadButtonThreshold,
    { min: 0, max: 1 },
  );
  const pressedValid = numeric || button?.pressed === undefined || typeof button.pressed === "boolean";
  const touchedValid = numeric || button?.touched === undefined || typeof button.touched === "boolean";
  const valid = (numeric || object) && value.valid && threshold.valid && pressedValid && touchedValid;
  const pressed = valid && (button?.pressed === true || value.value >= threshold.value);
  return {
    valid,
    object,
    numeric,
    value,
    threshold,
    pressedValid,
    touchedValid,
    pressed,
    touched: valid && button?.touched === true,
  };
}

export function standardInputWheelZoomReport(currentDelta, eventDelta) {
  const current = finiteNumberReport(currentDelta, {
    min: -STANDARD_INPUT_LIMITS.maxWheelDelta,
    max: STANDARD_INPUT_LIMITS.maxWheelDelta,
  });
  const incoming = finiteNumberReport(eventDelta, {
    min: -STANDARD_INPUT_LIMITS.maxWheelDelta,
    max: STANDARD_INPUT_LIMITS.maxWheelDelta,
  });
  if (!current.valid || !incoming.valid) return { valid: false, current, incoming };
  const raw = current.value + incoming.value;
  return {
    valid: true,
    current,
    incoming,
    raw,
    value: clamp(raw, -STANDARD_INPUT_LIMITS.maxWheelDelta, STANDARD_INPUT_LIMITS.maxWheelDelta),
    saturated: Math.abs(raw) > STANDARD_INPUT_LIMITS.maxWheelDelta,
  };
}

export function standardGamepadHapticEffectReport(gamepad, options = {}) {
  const object = gamepad !== null && typeof gamepad === "object";
  const duration = finiteNumberReport(options.duration ?? 100, {
    min: 0,
    max: STANDARD_INPUT_LIMITS.maxGamepadHapticDurationMs,
  });
  const startDelay = finiteNumberReport(options.startDelay ?? 0, {
    min: 0,
    max: STANDARD_INPUT_LIMITS.maxGamepadHapticDelayMs,
  });
  const weakMagnitude = finiteNumberReport(options.weakMagnitude ?? 1, { min: 0, max: 1 });
  const strongMagnitude = finiteNumberReport(options.strongMagnitude ?? 1, { min: 0, max: 1 });
  const actuator = object ? gamepad.vibrationActuator ?? gamepad.hapticActuators?.[0] ?? null : null;
  const supported = typeof actuator?.playEffect === "function";
  const valid = object && duration.valid && startDelay.valid && weakMagnitude.valid && strongMagnitude.valid;
  return {
    valid,
    object,
    supported,
    actuator,
    effect: valid ? Object.freeze({
      duration: duration.value,
      startDelay: startDelay.value,
      weakMagnitude: weakMagnitude.value,
      strongMagnitude: strongMagnitude.value,
    }) : null,
    duration,
    startDelay,
    weakMagnitude,
    strongMagnitude,
  };
}

export async function playStandardGamepadHaptics(gamepad, options = {}) {
  const report = standardGamepadHapticEffectReport(gamepad, options);
  if (!report.valid || !report.supported) return { ...report, played: false };
  try {
    const result = await report.actuator.playEffect("dual-rumble", report.effect);
    return { ...report, played: result !== "preempted", result };
  } catch (error) {
    return { ...report, played: false, error };
  }
}

export function standardGamepadInputReport(gamepad, options = {}) {
  const movement = standardGamepadMovementReport(gamepad, options);
  const lookHorizontalAxis = finiteNumberReport(options.lookHorizontalAxis ?? 2, {
    integer: true,
    min: 0,
    max: STANDARD_INPUT_LIMITS.maxGamepadAxisIndex,
  });
  const lookVerticalAxis = finiteNumberReport(options.lookVerticalAxis ?? 3, {
    integer: true,
    min: 0,
    max: STANDARD_INPUT_LIMITS.maxGamepadAxisIndex,
  });
  const invertLookX = options.invertLookX ?? false;
  const invertLookY = options.invertLookY ?? false;
  const inversionValid = typeof invertLookX === "boolean" && typeof invertLookY === "boolean";
  const axesLength = Number.isSafeInteger(gamepad?.axes?.length) ? gamepad.axes.length : 0;
  const lookAvailable = lookHorizontalAxis.valid && lookVerticalAxis.valid &&
    lookHorizontalAxis.value < axesLength && lookVerticalAxis.value < axesLength;
  const look = inputRadialDeadzoneReport(lookAvailable ? [
    gamepad.axes[lookHorizontalAxis.value],
    gamepad.axes[lookVerticalAxis.value],
  ] : [0, 0], {
    dimension: 2,
    deadzone: options.lookDeadzone ?? STANDARD_INPUT_LIMITS.defaultGamepadLookDeadzone,
    outerDeadzone: options.lookOuterDeadzone ?? 0,
    gamma: options.lookGamma ?? 1,
  });
  const lookAxes = look.valid && inversionValid ? Object.freeze([
    look.value[0] * (invertLookX ? -1 : 1),
    look.value[1] * (invertLookY ? -1 : 1),
  ]) : null;
  const buttonsLike = gamepad?.buttons === undefined ||
    (gamepad.buttons !== null && typeof gamepad.buttons === "object" &&
      Number.isSafeInteger(gamepad.buttons.length) && gamepad.buttons.length >= 0 &&
      gamepad.buttons.length <= STANDARD_INPUT_LIMITS.maxGamepadButtonIndex + 1);
  const buttonReports = [];
  const pressedBindings = [];
  if (buttonsLike && gamepad?.buttons) {
    for (let index = 0; index < gamepad.buttons.length; index += 1) {
      const button = standardGamepadButtonReport(gamepad.buttons[index], {
        threshold: options.buttonThreshold,
      });
      buttonReports.push(button);
      if (button.valid && button.pressed) pressedBindings.push(`button:${index}`);
    }
  }
  const leftTriggerIndex = finiteNumberReport(options.leftTriggerButton ?? 6, {
    integer: true, min: 0, max: STANDARD_INPUT_LIMITS.maxGamepadButtonIndex,
  });
  const rightTriggerIndex = finiteNumberReport(options.rightTriggerButton ?? 7, {
    integer: true, min: 0, max: STANDARD_INPUT_LIMITS.maxGamepadButtonIndex,
  });
  const leftTrigger = standardGamepadButtonReport(
    buttonsLike && leftTriggerIndex.valid ? gamepad?.buttons?.[leftTriggerIndex.value] ?? 0 : NaN,
    { threshold: options.buttonThreshold },
  );
  const rightTrigger = standardGamepadButtonReport(
    buttonsLike && rightTriggerIndex.valid ? gamepad?.buttons?.[rightTriggerIndex.value] ?? 0 : NaN,
    { threshold: options.buttonThreshold },
  );
  const haptics = standardGamepadHapticEffectReport(gamepad, options.haptics);
  const standardMapping = gamepad?.mapping === "standard";
  const mappingValid = options.requireStandardMapping !== true || standardMapping;
  const buttonsValid = buttonsLike && buttonReports.every((button) => button.valid);
  const valid = movement.valid && lookHorizontalAxis.valid && lookVerticalAxis.valid && look.valid &&
    inversionValid && buttonsValid && leftTriggerIndex.valid && rightTriggerIndex.valid &&
    leftTrigger.valid && rightTrigger.valid && haptics.valid && mappingValid;
  return {
    valid,
    movement,
    movementAxes: movement.valid ? movement.movementAxes : null,
    look,
    lookAxes,
    lookAvailable,
    lookHorizontalAxis,
    lookVerticalAxis,
    inversionValid,
    buttonsLike,
    buttonsValid,
    buttonReports: Object.freeze(buttonReports),
    pressedBindings: Object.freeze(pressedBindings),
    leftTrigger,
    rightTrigger,
    triggerValues: valid ? Object.freeze([leftTrigger.value.value, rightTrigger.value.value]) : null,
    haptics,
    standardMapping,
    mappingValid,
    gamepadIndex: movement.gamepadIndex,
    gamepadId: movement.gamepadId,
  };
}

function clearInputGamepadState(ctrl) {
  for (const binding of ctrl._gamepadPressedBindings ?? []) ctrl.pressedBindings?.delete(binding);
  ctrl._gamepadPressedBindings = new Set();
  ctrl.movementAxes = [0, 0, 0];
  ctrl.lookAxes = [0, 0];
  ctrl.triggerValues = [0, 0];
  ctrl.zoomAxis = 0;
  ctrl.gamepadHapticsSupported = false;
  syncStandardInputActions(ctrl);
}

function exitOwnedPointerLock(ctrl) {
  const ownerDocument = ctrl.canvas?.ownerDocument ?? globalThis.document;
  const pointerElement = ownerDocument?.pointerLockElement ?? ownerDocument?.mozPointerLockElement;
  if (pointerElement !== ctrl.canvas) return false;
  const exitPointerLock = ownerDocument.exitPointerLock ?? ownerDocument.mozExitPointerLock;
  exitPointerLock?.call(ownerDocument);
  return typeof exitPointerLock === 'function';
}

function createLegacyPointerLockWatch(ctrl, attachment) {
  const ownerDocument = ctrl.canvas?.ownerDocument ?? globalThis.document;
  const scheduleTimeout = ownerDocument?.defaultView?.setTimeout?.bind(ownerDocument.defaultView) ??
    globalThis.setTimeout?.bind(globalThis);
  const cancelTimeout = ownerDocument?.defaultView?.clearTimeout?.bind(ownerDocument.defaultView) ??
    globalThis.clearTimeout?.bind(globalThis);
  if (typeof ownerDocument?.addEventListener !== 'function' ||
      typeof ownerDocument?.removeEventListener !== 'function' ||
      typeof scheduleTimeout !== 'function' || typeof cancelTimeout !== 'function') return null;

  let settled = false;
  let timeout = null;
  const finish = () => {
    if (settled) return false;
    settled = true;
    if (timeout !== null) cancelTimeout(timeout);
    ownerDocument.removeEventListener('pointerlockchange', onChange);
    ownerDocument.removeEventListener('mozpointerlockchange', onChange);
    ownerDocument.removeEventListener('pointerlockerror', onError);
    ownerDocument.removeEventListener('mozpointerlockerror', onError);
    attachment.pointerLockWatches.delete(finish);
    return true;
  };
  const onChange = () => {
    const pointerElement = ownerDocument.pointerLockElement ?? ownerDocument.mozPointerLockElement;
    if (pointerElement !== ctrl.canvas) return;
    const activeAttachment = ctrl._listenerAttachment ?? null;
    finish();
    if (attachment.detached && activeAttachment === null) exitOwnedPointerLock(ctrl);
  };
  const onError = () => {
    const ownsAttachment = ctrl._listenerAttachment === attachment && !attachment.detached;
    finish();
    if (ownsAttachment) ctrl.mouseDown = false;
  };
  const onTimeout = () => {
    const ownsAttachment = ctrl._listenerAttachment === attachment && !attachment.detached;
    finish();
    if (ownsAttachment) ctrl.mouseDown = false;
  };

  try {
    ownerDocument.addEventListener('pointerlockchange', onChange);
    ownerDocument.addEventListener('mozpointerlockchange', onChange);
    ownerDocument.addEventListener('pointerlockerror', onError);
    ownerDocument.addEventListener('mozpointerlockerror', onError);
    timeout = scheduleTimeout(onTimeout, LEGACY_POINTER_LOCK_WATCH_MS);
    attachment.pointerLockWatches.add(finish);
    return finish;
  } catch (error) {
    try { finish(); }
    catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Legacy pointer-lock watch registration and rollback failed',
      );
    }
    throw error;
  }
}

export function pollInputGamepad(ctrl, gamepads = undefined) {
  if (!ctrl || typeof ctrl !== "object") return { valid: false, reason: "invalid-controller" };
  const source = gamepads ?? globalThis.navigator?.getGamepads?.() ?? [];
  if (source === null || typeof source !== "object") {
    clearInputGamepadState(ctrl);
    ctrl.gamepadConnected = false;
    return { valid: false, reason: "invalid-gamepad-list" };
  }
  const preferred = ctrl.gamepadIndex;
  let gamepad = preferred === null ? null : source[preferred];
  if (!gamepad) {
    for (let index = 0; index < source.length; index++) {
      if (source[index]?.connected !== false) {
        gamepad = source[index];
        break;
      }
    }
  }
  if (!gamepad) {
    clearInputGamepadState(ctrl);
    ctrl.gamepadConnected = false;
    ctrl.gamepadId = "";
    return {
      valid: true,
      connected: false,
      movementAxes: ctrl.movementAxes,
      lookAxes: ctrl.lookAxes,
      triggerValues: ctrl.triggerValues,
    };
  }
  const report = standardGamepadInputReport(gamepad, {
    horizontalAxis: ctrl.gamepadHorizontalAxis,
    forwardAxis: ctrl.gamepadForwardAxis,
    deadzone: ctrl.gamepadDeadzone,
    outerDeadzone: ctrl.gamepadOuterDeadzone,
    gamma: ctrl.gamepadResponseGamma,
    lookHorizontalAxis: ctrl.gamepadLookHorizontalAxis,
    lookVerticalAxis: ctrl.gamepadLookVerticalAxis,
    lookDeadzone: ctrl.gamepadLookDeadzone,
    lookOuterDeadzone: ctrl.gamepadLookOuterDeadzone,
    lookGamma: ctrl.gamepadLookResponseGamma,
    invertLookX: ctrl.gamepadInvertLookX,
    invertLookY: ctrl.gamepadInvertLookY,
    buttonThreshold: ctrl.gamepadButtonThreshold,
  });
  if (!report.valid) {
    clearInputGamepadState(ctrl);
    ctrl.gamepadConnected = false;
    return report;
  }
  for (const binding of ctrl._gamepadPressedBindings) ctrl.pressedBindings.delete(binding);
  ctrl._gamepadPressedBindings = new Set(report.pressedBindings);
  for (const binding of ctrl._gamepadPressedBindings) ctrl.pressedBindings.add(binding);
  ctrl.movementAxes = [...report.movementAxes];
  ctrl.lookAxes = [...report.lookAxes];
  ctrl.triggerValues = [...report.triggerValues];
  ctrl.zoomAxis = report.triggerValues[0] - report.triggerValues[1];
  ctrl.gamepadHapticsSupported = report.haptics.supported;
  ctrl.gamepadConnected = true;
  ctrl.gamepadIndex = report.gamepadIndex;
  ctrl.gamepadId = report.gamepadId;
  syncStandardInputActions(ctrl);
  return report;
}

/**
 * Create an input controller state object.
 */
export function createInputController(options = {}) {
  const canvas = options.canvas;
  if (!canvas) throw new Error("createInputController: canvas required");

  const requestedActionMap = options.actionMap === undefined
    ? DEFAULT_STANDARD_INPUT_ACTION_MAP
    : { ...DEFAULT_STANDARD_INPUT_ACTION_MAP, ...options.actionMap };
  const actionMap = standardInputActionMapReport(requestedActionMap, {
    allowConflicts: options.allowActionConflicts === true,
  });
  if (!actionMap.valid) throw new RangeError("createInputController: invalid action map");

  return {
    canvas,
    // Keyboard state
    keys: {},

    actionMap: actionMap.actionMap,

    actions: Object.fromEntries(STANDARD_INPUT_ACTIONS.map((action) => [action, false])),

    pressedBindings: new Set(),

    _pressedTokensByCode: new Map(),

    // Shaped local movement axes: right, vertical, forward.

    movementAxes: [0, 0, 0],

    lookAxes: [0, 0],

    triggerValues: [0, 0],

    zoomAxis: 0,

    zoomDelta: 0,

    gamepadHapticsSupported: false,

    _gamepadPressedBindings: new Set(),

    gamepadConnected: false,

    gamepadId: "",

    gamepadIndex: Number.isSafeInteger(options.gamepadIndex) &&
      options.gamepadIndex >= 0 && options.gamepadIndex <= STANDARD_INPUT_LIMITS.maxGamepadIndex
      ? options.gamepadIndex
      : null,

    gamepadHorizontalAxis: options.gamepadHorizontalAxis ?? 0,

    gamepadForwardAxis: options.gamepadForwardAxis ?? 1,

    gamepadDeadzone: options.gamepadDeadzone ?? STANDARD_INPUT_LIMITS.defaultGamepadDeadzone,

    gamepadOuterDeadzone: options.gamepadOuterDeadzone ?? 0,

    gamepadResponseGamma: options.gamepadResponseGamma ?? 1,

    gamepadLookHorizontalAxis: options.gamepadLookHorizontalAxis ?? 2,

    gamepadLookVerticalAxis: options.gamepadLookVerticalAxis ?? 3,

    gamepadLookDeadzone: options.gamepadLookDeadzone ?? STANDARD_INPUT_LIMITS.defaultGamepadLookDeadzone,

    gamepadLookOuterDeadzone: options.gamepadLookOuterDeadzone ?? 0,

    gamepadLookResponseGamma: options.gamepadLookResponseGamma ?? 1,

    gamepadInvertLookX: options.gamepadInvertLookX ?? false,

    gamepadInvertLookY: options.gamepadInvertLookY ?? false,

    gamepadButtonThreshold: options.gamepadButtonThreshold ?? STANDARD_INPUT_LIMITS.defaultGamepadButtonThreshold,
    // Mouse state
    mouseDown: false,
    mouseX: 0,
    mouseY: 0,
    mouseDeltaX: 0,
    mouseDeltaY: 0,
    lastMouseClientX: 0,
    lastMouseClientY: 0,
    // Ghost/spawn offset
    ghostOffset: [0, 0, 0],
    ghostMoveSpeed: options.ghostMoveSpeed || 0.5,
    // Callbacks (set by consumer)
    onCameraModeChange: null,
    onDeleteSelected: null,
    onGhostMove: null,
    onEntityPick: null,
    onWorldPick: null,
    onGrabStart: null,
    onGrabRelease: null,
    acceptKeyboardEvent: null,
    // Cleanup
    _listeners: [],
    _listenerAttachment: null,
  };
}

/**
 * Attach input listeners to the controller.
 * Returns an attachment-scoped cleanup function. Renewing a controller retires
 * its previous attachment, and stale cleanup functions cannot affect the owner.
 */
export function attachInputListeners(ctrl, callbacks = {}) {
  const { canvas } = ctrl;
  const mergedCallbacks = {
    onCameraModeChange: callbacks.onCameraModeChange || ctrl.onCameraModeChange,
    onDeleteSelected: callbacks.onDeleteSelected || ctrl.onDeleteSelected,
    onGhostMove: callbacks.onGhostMove || ctrl.onGhostMove,
    onEntityPick: callbacks.onEntityPick || ctrl.onEntityPick,
    onWorldPick: callbacks.onWorldPick || ctrl.onWorldPick,
    onGrabStart: callbacks.onGrabStart || ctrl.onGrabStart,
    onGrabRelease: callbacks.onGrabRelease || ctrl.onGrabRelease,
    acceptKeyboardEvent: callbacks.acceptKeyboardEvent || ctrl.acceptKeyboardEvent,
  };
  if (ctrl._listenerAttachment || (Array.isArray(ctrl._listeners) && ctrl._listeners.length > 0)) {
    detachInputListeners(ctrl);
  }

  const attachment = { detached: false, listeners: [], pointerLockWatches: new Set() };
  ctrl._listenerAttachment = attachment;
  ctrl._detached = false;
  ctrl._listeners = attachment.listeners;

  // Merge callbacks after retiring the previous attachment, whose teardown clears them.
  Object.assign(ctrl, mergedCallbacks);
  const ownsAttachment = () => ctrl._listenerAttachment === attachment && !attachment.detached;

  // Keydown handler
  const onKeyDown = (e) => {
    if (!ownsAttachment()) return;
    const target = e.target;
    const isTextInput = target && (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    );

    if (isTextInput) return;
    if (ctrl.acceptKeyboardEvent && ctrl.acceptKeyboardEvent(e) === false) return;
    ctrl.keys[e.key] = true;

    const eventTokens = [e.code, `key:${e.key}`].filter(inputBindingValid);
    const previousTokens = ctrl._pressedTokensByCode.get(e.code) ?? [];
    for (const token of previousTokens) ctrl.pressedBindings.delete(token);
    for (const token of eventTokens) ctrl.pressedBindings.add(token);
    ctrl._pressedTokensByCode.set(e.code, eventTokens);
    if (!syncStandardInputActions(ctrl)) return;
    const eventState = standardInputActionStateReport(ctrl.actionMap, eventTokens);
    if (!eventState.valid) return;
    const triggered = eventState.actions;

    // Delete key
    if (triggered.deleteSelected) {
      if (ctrl.onDeleteSelected) ctrl.onDeleteSelected();
      return;
    }

    // Ghost movement with arrow keys
    let ghostMoved = false;
    const speed = ctrl.ghostMoveSpeed;

    if (triggered.ghostForward) { ctrl.ghostOffset[2] -= speed; ghostMoved = true; }
    if (triggered.ghostBackward) { ctrl.ghostOffset[2] += speed; ghostMoved = true; }
    if (triggered.ghostLeft) { ctrl.ghostOffset[0] -= speed; ghostMoved = true; }
    if (triggered.ghostRight) { ctrl.ghostOffset[0] += speed; ghostMoved = true; }
    if (triggered.ghostUp) { ctrl.ghostOffset[1] += speed; ghostMoved = true; }
    if (triggered.ghostDown) { ctrl.ghostOffset[1] -= speed; ghostMoved = true; }

    if (ghostMoved && ctrl.onGhostMove) {
      ctrl.onGhostMove([...ctrl.ghostOffset]);
    }

    // Camera mode switching
    if (triggered.cameraFirstPerson && ctrl.onCameraModeChange) {
      ctrl.onCameraModeChange(1);
    }
    if (triggered.cameraThirdPerson && ctrl.onCameraModeChange) {
      ctrl.onCameraModeChange(2);
    }
  };

  const onKeyUp = (e) => {
    if (!ownsAttachment()) return;
    ctrl.keys[e.key] = false;
    const eventTokens = ctrl._pressedTokensByCode.get(e.code) ?? [e.code, `key:${e.key}`];
    for (const token of eventTokens) ctrl.pressedBindings.delete(token);
    ctrl._pressedTokensByCode.delete(e.code);
    syncStandardInputActions(ctrl);
  };

  const onBlur = () => {
    if (!ownsAttachment()) return;
    ctrl.pressedBindings.clear();
    ctrl._pressedTokensByCode.clear();
    for (const key of Object.keys(ctrl.keys)) ctrl.keys[key] = false;
    syncStandardInputActions(ctrl);
  };

  // Mouse handlers
  const onMouseDown = (e) => {
    if (!ownsAttachment()) return;
    if (e.button === 2) {
      // Right mouse button - camera rotation
      ctrl.mouseDown = true;
      ctrl.mouseX = e.clientX;
      ctrl.mouseY = e.clientY;
      canvas.requestPointerLock = canvas.requestPointerLock || canvas.mozRequestPointerLock;
      if (canvas.requestPointerLock) {
        for (const cancelWatch of [...attachment.pointerLockWatches]) cancelWatch();
        const cancelLegacyWatch = createLegacyPointerLockWatch(ctrl, attachment);
        let request;
        try {
          request = canvas.requestPointerLock();
        } catch (error) {
          cancelLegacyWatch?.();
          ctrl.mouseDown = false;
          throw error;
        }
        if (request && typeof request.then === 'function') {
          cancelLegacyWatch?.();
          Promise.resolve(request).then(() => {
            if (!ownsAttachment()) exitOwnedPointerLock(ctrl);
          }, () => {
            if (ownsAttachment()) ctrl.mouseDown = false;
          });
        }
      }
    } else if (e.button === 0) {
      // Left mouse button - entity pick/grab
      ctrl.lastMouseClientX = e.clientX;
      ctrl.lastMouseClientY = e.clientY;
      if (ctrl.onEntityPick) {
        ctrl.onEntityPick(e.clientX, e.clientY);
      }
    }
  };

  const onMouseMove = (e) => {
    if (!ownsAttachment()) return;
    ctrl.lastMouseClientX = e.clientX;
    ctrl.lastMouseClientY = e.clientY;

    if (ctrl.mouseDown) {
      const isLocked = document.pointerLockElement === canvas ||
                       document.mozPointerLockElement === canvas;
      if (isLocked) {
        ctrl.mouseDeltaX = e.movementX || 0;
        ctrl.mouseDeltaY = e.movementY || 0;
      } else {
        ctrl.mouseDeltaX = e.clientX - ctrl.mouseX;
        ctrl.mouseDeltaY = e.clientY - ctrl.mouseY;
        ctrl.mouseX = e.clientX;
        ctrl.mouseY = e.clientY;
      }
    }
  };

  const onMouseUp = (e) => {
    if (!ownsAttachment()) return;
    if (e.button === 2) {
      ctrl.mouseDown = false;
      const isLocked = document.pointerLockElement === canvas ||
                       document.mozPointerLockElement === canvas;
      if (isLocked) {
        document.exitPointerLock = document.exitPointerLock || document.mozExitPointerLock;
        document.exitPointerLock();
      }
    } else if (e.button === 0) {
      if (ctrl.onGrabRelease) ctrl.onGrabRelease();
    }
  };

  const onWheel = (e) => {
    if (!ownsAttachment()) return;
    const report = standardInputWheelZoomReport(ctrl.zoomDelta, e.deltaY);
    if (!report.valid) return;
    ctrl.zoomDelta = report.value;
    if (typeof e.preventDefault === "function") e.preventDefault();
  };

  const onContextMenu = (e) => {
    if (ownsAttachment()) e.preventDefault();
  };

  const onClick = (e) => {
    if (!ownsAttachment()) return;
    // Reset ghost offset on new pick
    ctrl.ghostOffset[0] = 0;
    ctrl.ghostOffset[1] = 0;
    ctrl.ghostOffset[2] = 0;
    if (ctrl.onWorldPick) {
      ctrl.onWorldPick(e.clientX, e.clientY);
    }
  };

  const listen = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    attachment.listeners.push([event, handler, target, options]);
  };
  try {
    listen(window, "keydown", onKeyDown);
    listen(window, "keyup", onKeyUp);
    listen(window, "blur", onBlur);
    listen(canvas, "mousedown", onMouseDown);
    listen(canvas, "mousemove", onMouseMove);
    listen(canvas, "mouseup", onMouseUp);
    listen(canvas, "wheel", onWheel, { passive: false });
    listen(canvas, "contextmenu", onContextMenu);
    listen(canvas, "click", onClick);
  } catch (registrationError) {
    try { detachInputListeners(ctrl, attachment); }
    catch (cleanupError) {
      throw new AggregateError(
        [registrationError, cleanupError],
        'Standard input listener registration and rollback failed',
      );
    }
    throw registrationError;
  }

  return () => detachInputListeners(ctrl, attachment);
}

/**
 * Remove the active input attachment. The optional ownership argument is used
 * by cleanup closures so an older closure cannot detach a replacement.
 */
export function detachInputListeners(ctrl, expectedAttachment = undefined) {
  const activeAttachment = ctrl?._listenerAttachment ?? null;
  if (expectedAttachment !== undefined && activeAttachment !== expectedAttachment) return false;

  const errors = [];
  const listeners = activeAttachment
    ? activeAttachment.listeners
    : (Array.isArray(ctrl?._listeners) ? ctrl._listeners : []);
  if (activeAttachment) activeAttachment.detached = true;
  ctrl._listenerAttachment = null;
  ctrl._listeners = [];
  ctrl._detached = true;

  for (const [event, handler, target, options] of listeners) {
    try { target.removeEventListener(event, handler, options); }
    catch (error) { errors.push(error); }
  }
  try { ctrl.pressedBindings?.clear(); }
  catch (error) { errors.push(error); }
  try { ctrl._pressedTokensByCode?.clear(); }
  catch (error) { errors.push(error); }
  try {
    if (ctrl.keys) for (const key of Object.keys(ctrl.keys)) ctrl.keys[key] = false;
  } catch (error) {
    errors.push(error);
  }
  try { clearInputGamepadState(ctrl); }
  catch (error) { errors.push(error); }
  try {
    exitOwnedPointerLock(ctrl);
  } catch (error) { errors.push(error); }
  try {
    ctrl.mouseDown = false;
    ctrl.mouseDeltaX = 0;
    ctrl.mouseDeltaY = 0;
  } catch (error) { errors.push(error); }
  try { ctrl.zoomDelta = 0; }
  catch (error) { errors.push(error); }
  for (const callback of [
    'onCameraModeChange',
    'onDeleteSelected',
    'onGhostMove',
    'onEntityPick',
    'onWorldPick',
    'onGrabStart',
    'onGrabRelease',
    'acceptKeyboardEvent',
  ]) {
    try { ctrl[callback] = null; }
    catch (error) { errors.push(error); }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Standard input listener cleanup failed');
  }
  return true;
}

/**
 * Reset mouse deltas after consuming them for camera update.
 */
export function consumeMouseDelta(ctrl) {
  const dx = ctrl.mouseDeltaX;
  const dy = ctrl.mouseDeltaY;
  ctrl.mouseDeltaX = 0;
  ctrl.mouseDeltaY = 0;
  return { dx, dy };
}

/**
 * Get current keyboard state.
 */
export function consumeZoomDelta(ctrl) {
  const delta = Number.isFinite(ctrl?.zoomDelta) ? ctrl.zoomDelta : 0;
  if (ctrl) ctrl.zoomDelta = 0;
  return delta;
}

export function getKeys(ctrl) {
  return ctrl.keys;
}

export function getInputActions(ctrl) {
  return ctrl?.actions && typeof ctrl.actions === "object" ? { ...ctrl.actions } : {};
}

export function getInputActionMap(ctrl) {
  if (!ctrl?.actionMap || typeof ctrl.actionMap !== "object") return {};
  return Object.fromEntries(Object.entries(ctrl.actionMap).map(([action, bindings]) => [action, [...bindings]]));
}

export function getMovementAxes(ctrl) {

  return Array.isArray(ctrl?.movementAxes) ? [...ctrl.movementAxes] : [0, 0, 0];

}

/**
 * Get last mouse position.
 */
export function getLastMousePosition(ctrl) {
  return { x: ctrl.lastMouseClientX, y: ctrl.lastMouseClientY };
}
