// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { runtimeFrameDeltaSeconds } from "../math/FrameMath.js";

export function createMainLoop(options = {}) {
  const update = typeof options.update === "function" ? options.update : null;
  const render = typeof options.render === "function" ? options.render : null;

  const fixedDelta =
    typeof options.fixedDelta === "number" && options.fixedDelta > 0
      ? options.fixedDelta
      : 1 / 60;
  const maxDelta =
    typeof options.maxDelta === "number" && options.maxDelta > 0
      ? options.maxDelta
      : 0.25;

  const pauseOnHidden = options.pauseOnHidden !== false;

  let running = false;
  let paused = false;
  let wasHidden = false;  // Track if we were just hidden
  let hiddenStartTime = 0; // When we became hidden (performance.now)
  let hiddenDuration = 0;  // How long we were hidden (seconds)
  let catchupFrames = 0;  // Frames remaining in slow-motion catchup mode
  let lastTime = 0;
  let accumulator = 0;
  let frameIndex = 0;
  let animationFrameId = null;

  // Catchup mode settings
  const CATCHUP_DURATION = 30;     // Frames to spend catching up (0.5 sec at 60fps)
  const CATCHUP_SIM_SCALE = 0.3;   // Run sim at 30% speed during catchup

  function frame(timestampMs) {
    if (!running) {
      return;
    }

    const now = timestampMs / 1000;

    // If we were hidden and just came back, enter catchup mode
    // This prevents trying to "catch up" 30 seconds of time all at once
    if (wasHidden || !lastTime) {
      // Calculate how long we were hidden
      if (hiddenStartTime > 0) {
        hiddenDuration = (performance.now() - hiddenStartTime) / 1000;
      } else {
        hiddenDuration = 0;
      }
      hiddenStartTime = 0;
      
      lastTime = now;
      accumulator = 0;  // Clear any accumulated time
      wasHidden = false;
      catchupFrames = CATCHUP_DURATION; // Enter slow-motion catchup mode
    }

    let delta = runtimeFrameDeltaSeconds(timestampMs, lastTime * 1000, Infinity);
    lastTime = now;

    // Clamp delta to prevent huge spikes (e.g., debugger pause, GC stall)
    if (delta > maxDelta) {
      delta = maxDelta;
      accumulator = 0; // Reset accumulator on spike
      catchupFrames = Math.max(catchupFrames, 10); // Ensure some catchup time
    }

    // Calculate effective sim scale (reduced during catchup)
    let simScaleMod = 1.0;
    if (catchupFrames > 0) {
      // Gradually increase from CATCHUP_SIM_SCALE back to 1.0
      const progress = 1.0 - (catchupFrames / CATCHUP_DURATION);
      simScaleMod = CATCHUP_SIM_SCALE + (1.0 - CATCHUP_SIM_SCALE) * progress;
      catchupFrames--;
    }

    if (!paused) {
      accumulator += delta;
      let stepCount = 0;

      // Limit sub-steps to prevent spiral of death
      const maxSubSteps =
        typeof options.maxSubSteps === "number" && options.maxSubSteps > 0
          ? Math.min(options.maxSubSteps, 4)
          : 4;

      // Cap accumulator to prevent infinite catch-up attempts
      if (accumulator > maxSubSteps * fixedDelta) {
        accumulator = maxSubSteps * fixedDelta;
      }

      while (accumulator >= fixedDelta && stepCount < maxSubSteps) {
        if (update) {
          // Pass simScaleMod so simulation can slow down during catchup
          update(fixedDelta, {
            time: now,
            delta,
            frameIndex,
            stepIndex: stepCount,
            simScaleMod,  // Multiplier for sim speed (0.3 to 1.0 during catchup)
            catching: catchupFrames > 0,
            hiddenDuration: stepCount === 0 ? hiddenDuration : 0, // Only on first step
          });
          // Clear hidden duration after first step uses it
          if (stepCount === 0 && hiddenDuration > 0) {
            hiddenDuration = 0;
          }
        }
        accumulator -= fixedDelta;
        stepCount += 1;
      }

      if (render) {
        render(delta, {
          time: now,
          delta,
          frameIndex,
          accumulator,
        });
      }

      frameIndex += 1;
    }

    animationFrameId = requestAnimationFrame(frame);
  }

  function start() {
    if (running) {
      return;
    }
    running = true;
    paused = false;
    lastTime = 0;
    accumulator = 0;
    frameIndex = 0;
    animationFrameId = requestAnimationFrame(frame);
  }

  function stop() {
    if (!running) {
      return;
    }
    running = false;
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  function setPaused(value) {
    paused = !!value;
  }

  function isRunning() {
    return running;
  }

  function isPaused() {
    return paused;
  }

  let visibilityHandler = null;
  let focusHandler = null;
  let blurHandler = null;

  if (typeof document !== "undefined") {
    visibilityHandler = () => {
      const hidden = document.hidden;
      if (hidden) {
        // Mark that we're going hidden - will reset timing on resume
        wasHidden = true;
        hiddenStartTime = performance.now(); // Track when we went hidden
      }
      if (pauseOnHidden) {
        setPaused(hidden);
      }
      if (typeof options.onVisibilityChange === "function") {
        options.onVisibilityChange({
          hidden,
          visibilityState: document.visibilityState,
        });
      }
    };

    document.addEventListener("visibilitychange", visibilityHandler);
  }

  if (typeof window !== "undefined") {
    focusHandler = () => {
      if (typeof options.onFocusChange === "function") {
        options.onFocusChange({ focused: true });
      }
      // When regaining focus, reset timing to prevent catch-up spikes
      wasHidden = true;
      if (pauseOnHidden && typeof document !== "undefined" && !document.hidden) {
        setPaused(false);
      }
    };

    blurHandler = () => {
      if (typeof options.onFocusChange === "function") {
        options.onFocusChange({ focused: false });
      }
      // Mark as hidden when blurred too (covers Alt+Tab, clicking other apps)
      wasHidden = true;
      if (hiddenStartTime === 0) {
        hiddenStartTime = performance.now();
      }
    };

    window.addEventListener("focus", focusHandler);
    window.addEventListener("blur", blurHandler);
  }

  function dispose() {
    stop();

    if (visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", visibilityHandler);
    }

    if (typeof window !== "undefined") {
      if (focusHandler) {
        window.removeEventListener("focus", focusHandler);
      }
      if (blurHandler) {
        window.removeEventListener("blur", blurHandler);
      }
    }
  }

  if (options.autoStart) {
    start();
  }

  return {
    start,
    stop,
    setPaused,
    isRunning,
    isPaused,
    dispose,
  };
}
