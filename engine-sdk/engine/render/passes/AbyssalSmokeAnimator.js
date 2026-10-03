// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const FRAME_COUNT = 12;
const CELL_SIZE = 627;
const TAU = Math.PI * 2;

const DEFAULT_SHEETS = Object.freeze([
  './assets/abyssal-layers/smoke-atlas-1-v3.png',
  './assets/abyssal-layers/smoke-atlas-2-v3.png',
  './assets/abyssal-layers/smoke-atlas-3-v3.png',
]);

// Every cel is registered to the same source-space vent point. The offsets are
// measured from the alpha silhouette rather than the square atlas cell, so the
// changing plume cannot pull its emission point sideways between drawings.
const DEFAULT_REGISTRATION = Object.freeze([
  Object.freeze([-31.88, 25]), Object.freeze([80.86, 25]),
  Object.freeze([-36.47, 48]), Object.freeze([52.22, 48]),
  Object.freeze([-30.04, 1]), Object.freeze([97.93, 2]),
  Object.freeze([-34.11, 29]), Object.freeze([80.52, 28]),
  Object.freeze([-28.85, -4]), Object.freeze([98.33, -3]),
  Object.freeze([-52.51, 37]), Object.freeze([97.99, 34]),
]);

const TRACK_OFFSETS = Object.freeze([0, 0.5]);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / Math.max(0.00001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function preloadSheet(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = async () => {
      try { await image.decode(); } catch (_) { /* onload already proved the bitmap is usable */ }
      resolve({ url, loaded: true });
    };
    image.onerror = () => resolve({ url, loaded: false });
    image.src = url;
  });
}

/**
 * Cross-faded cel animator for the authored abyssal mineral plume.
 *
 * Two staggered lifecycles share the registered atlas. Each lifecycle changes
 * drawing, rises, spreads, sheds opacity, and disappears while its successor
 * is already forming at the vent. Adjacent-frame alpha always sums to one,
 * which prevents the bright flashes produced by transition races.
 */
export class AbyssalSmokeAnimator {
  constructor(stage, options = {}) {
    if (!stage) throw new Error('AbyssalSmokeAnimator requires a stage element.');
    this.stage = stage;
    this.sheets = options.sheets ?? DEFAULT_SHEETS;
    this.registration = options.registration ?? DEFAULT_REGISTRATION;
    this.targetFps = clamp(options.targetFps ?? 30, 12, 60);
    this.cycleDuration = clamp(options.cycleDuration ?? 8400, 4800, 16000);
    this.baseOpacity = clamp(options.baseOpacity ?? 0.54, 0.2, 0.8);
    this.tracks = [];
    this.frameHandle = 0;
    this.lastRenderTimestamp = 0;
    this.startedAt = 0;
    this.stageSize = 1;
    this.destroyed = false;
    this.motionPaused = false;
    this.frozenElapsed = 0;
    this.paused = document.hidden;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._tick = this._tick.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
  }

  init() {
    const trackCount = this.reducedMotion ? 1 : TRACK_OFFSETS.length;
    for (let index = 0; index < trackCount; index += 1) this._createTrack(index);
    this._measureStage();
    addEventListener('resize', this._onResize, { passive: true });
    document.addEventListener('visibilitychange', this._onVisibility);

    document.documentElement.dataset.abyssalSmoke = 'loading';
    document.documentElement.dataset.smokeFrames = String(FRAME_COUNT);
    document.documentElement.dataset.smokeTracks = String(trackCount);
    document.documentElement.dataset.smokeCycleMs = String(this.cycleDuration);

    Promise.all(this.sheets.map(preloadSheet)).then((results) => {
      if (this.destroyed) return;
      const missing = results.filter((entry) => !entry.loaded).map((entry) => entry.url);
      if (missing.length > 0) {
        document.documentElement.dataset.abyssalSmoke = 'degraded';
        console.warn('[AbyssalSmoke] Sprite atlases failed to load.', missing);
      } else {
        document.documentElement.dataset.abyssalSmoke = this.reducedMotion ? 'reduced' : 'active';
        console.info(`[AbyssalSmoke] ${FRAME_COUNT} registered frames ready across ${this.sheets.length} atlases.`);
      }

      if (this.reducedMotion) {
        this._renderStatic();
        return;
      }
      this.startedAt = performance.now();
      this.frameHandle = requestAnimationFrame(this._tick);
    });
    return this;
  }

  _createTrack(index) {
    const node = document.createElement('span');
    node.className = 'abyss-smoke-track';
    node.dataset.smokeTrack = String(index);
    node.setAttribute('aria-hidden', 'true');
    const cels = [0, 1].map((slot) => {
      const cel = document.createElement('i');
      cel.className = 'abyss-smoke-frame';
      cel.dataset.smokeSlot = String(slot);
      node.appendChild(cel);
      return cel;
    });
    this.stage.appendChild(node);
    this.tracks.push({ node, cels, frames: [-1, -1] });
  }

  _measureStage() {
    this.stageSize = Math.max(1, this.stage.getBoundingClientRect().width);
  }

  _onResize() {
    this._measureStage();
    this.tracks.forEach((track) => { track.frames = [-1, -1]; });
  }

  _onVisibility() {
    const nextPaused = document.hidden || this.motionPaused;
    if (nextPaused === this.paused) return;
    const now = performance.now();
    if (nextPaused) {
      this.frozenElapsed = this.startedAt ? (now - this.startedAt) % this.cycleDuration : 0;
    } else {
      this.startedAt = now - this.frozenElapsed;
    }
    this.paused = nextPaused;
    this.lastRenderTimestamp = 0;
  }

  setPaused(paused) {
    this.motionPaused = Boolean(paused);
    this._onVisibility();
  }

  _setFrame(track, slot, frame) {
    if (track.frames[slot] === frame) return;
    track.frames[slot] = frame;
    const sheetIndex = Math.floor(frame / 4);
    const cell = frame % 4;
    const [offsetX, offsetY] = this.registration[frame];
    const registrationScale = this.stageSize / CELL_SIZE;
    const positionX = `calc(${(cell % 2) * 100}% + ${(offsetX * registrationScale).toFixed(2)}px)`;
    const positionY = `calc(${Math.floor(cell / 2) * 100}% + ${(offsetY * registrationScale).toFixed(2)}px)`;
    const cel = track.cels[slot];
    cel.style.backgroundImage = `url("${this.sheets[sheetIndex]}")`;
    cel.style.backgroundPosition = `${positionX} ${positionY}`;
    cel.dataset.smokeFrame = String(frame + 1);
  }

  _renderTrack(track, phase, trackIndex) {
    const frameFloat = phase * FRAME_COUNT;
    const frame = Math.floor(frameFloat) % FRAME_COUNT;
    const nextFrame = (frame + 1) % FRAME_COUNT;
    const frameFraction = frameFloat - Math.floor(frameFloat);
    const blend = smoothstep(0.68, 0.96, frameFraction);
    this._setFrame(track, 0, frame);
    this._setFrame(track, 1, nextFrame);
    track.cels[0].style.opacity = (1 - blend).toFixed(4);
    track.cels[1].style.opacity = blend.toFixed(4);

    const fadeIn = smoothstep(0, 0.12, phase);
    const fadeOut = 1 - smoothstep(0.58, 0.99, phase);
    const envelope = fadeIn * fadeOut;
    const expansion = smoothstep(0.04, 0.78, phase);
    const direction = trackIndex === 0 ? -1 : 1;
    const drift = Math.sin(phase * TAU + trackIndex * 2.17) * 5 + direction * phase * 6;
    const rise = -4 - Math.pow(phase, 1.35) * (trackIndex === 0 ? 74 : 66);
    const rotation = direction * (-1.8 + phase * 4.8) + Math.sin(phase * TAU) * 1.1;
    const scaleX = 0.86 + expansion * (trackIndex === 0 ? 0.24 : 0.2);
    const scaleY = 0.9 + expansion * 0.14;

    track.node.style.opacity = (envelope * this.baseOpacity * (trackIndex === 0 ? 1 : 0.9)).toFixed(4);
    track.node.style.transform = `translate3d(${drift.toFixed(2)}px, ${rise.toFixed(2)}px, 0) rotate(${rotation.toFixed(3)}deg) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`;
    track.node.dataset.smokePhase = phase.toFixed(4);
  }

  _renderStatic() {
    const track = this.tracks[0];
    this._setFrame(track, 0, 5);
    this._setFrame(track, 1, 6);
    track.cels[0].style.opacity = '1';
    track.cels[1].style.opacity = '0';
    track.node.style.opacity = String(this.baseOpacity);
    track.node.style.transform = 'translate3d(0, -18px, 0) rotate(-0.8deg) scale(1.02, 1.02)';
  }

  _tick(timestamp) {
    if (this.destroyed) return;
    this.frameHandle = requestAnimationFrame(this._tick);
    if (this.paused) return;
    const targetFrameMs = 1000 / this.targetFps;
    if (timestamp - this.lastRenderTimestamp < targetFrameMs) return;
    this.lastRenderTimestamp = timestamp;
    const elapsed = (timestamp - this.startedAt) % this.cycleDuration;
    const basePhase = elapsed / this.cycleDuration;
    for (let index = 0; index < this.tracks.length; index += 1) {
      const phase = (basePhase + TRACK_OFFSETS[index]) % 1;
      this._renderTrack(this.tracks[index], phase, index);
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.frameHandle);
    removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    for (const track of this.tracks) track.node.remove();
    this.tracks.length = 0;
    delete document.documentElement.dataset.smokeFrames;
    delete document.documentElement.dataset.smokeTracks;
    console.info('[AbyssalSmoke] Animator destroyed.');
  }
}

export function startAbyssalSmokeAnimator(stage, options = {}) {
  return new AbyssalSmokeAnimator(stage, options).init();
}
