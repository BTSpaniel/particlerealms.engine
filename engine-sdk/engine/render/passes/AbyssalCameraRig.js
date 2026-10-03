// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

function validPlaneElements(elements) {
  return [...(elements ?? [])].filter((element) => element instanceof HTMLDivElement);
}

/**
 * Applies a restrained floating-camera offset to isolated DOM scenery planes.
 * WebGPU/2D canvases and document-root styles are deliberately excluded so
 * animation cannot invalidate the page or disrupt GPU presentation textures.
 */
export class AbyssalCameraRig {
  constructor(options = {}) {
    this.planes = {
      far: validPlaneElements(options.planes?.far),
      mid: validPlaneElements(options.planes?.mid),
      near: validPlaneElements(options.planes?.near),
    };
    this.targetFps = Math.max(12, Math.min(30, options.targetFps ?? 24));
    this.strength = Math.max(0.1, Math.min(1.5, options.strength ?? 0.72));
    this.frameInterval = 1000 / this.targetFps;
    this.lastFrameAt = 0;
    this.startedAt = 0;
    this.frameHandle = 0;
    this.destroyed = false;
    this.paused = document.hidden;
    this._tick = this._tick.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
  }

  init() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.documentElement.dataset.abyssalCamera = 'reduced';
      return this;
    }
    document.documentElement.dataset.abyssalCamera = 'active';
    document.addEventListener('visibilitychange', this._onVisibility, { passive: true });
    this.frameHandle = requestAnimationFrame(this._tick);
    console.info(`[AbyssalCameraRig] Isolated DOM camera active at ${this.targetFps} FPS; canvases remain locked.`);
    return this;
  }

  _onVisibility() {
    this.paused = document.hidden;
    this.lastFrameAt = 0;
    this.startedAt = 0;
  }

  _tick(timestamp) {
    if (this.destroyed) return;
    this.frameHandle = requestAnimationFrame(this._tick);
    if (this.paused || timestamp - this.lastFrameAt < this.frameInterval) return;
    if (!this.startedAt) this.startedAt = timestamp;
    this.lastFrameAt = timestamp;
    this._publish((timestamp - this.startedAt) * 0.001);
  }

  _publish(time) {
    const x = (Math.sin(time * 0.18) * 2.1 + Math.sin(time * 0.41 + 1.1) * 0.7) * this.strength;
    const y = (Math.cos(time * 0.13 + 0.3) * 2.5 + Math.sin(time * 0.29) * 0.65) * this.strength;
    const roll = (Math.sin(time * 0.1 - 0.6) * 0.045 + Math.sin(time * 0.23) * 0.015) * this.strength;
    const depths = { far: 0.32, mid: 0.64, near: 1 };
    for (const [plane, elements] of Object.entries(this.planes)) {
      const depth = depths[plane];
      for (const element of elements) {
        element.style.translate = `${(x * depth).toFixed(3)}px ${(y * depth).toFixed(3)}px`;
        element.style.rotate = `${(roll * depth).toFixed(4)}deg`;
      }
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.frameHandle);
    document.removeEventListener('visibilitychange', this._onVisibility);
    for (const elements of Object.values(this.planes)) {
      for (const element of elements) {
        element.style.removeProperty('translate');
        element.style.removeProperty('rotate');
      }
    }
    delete document.documentElement.dataset.abyssalCamera;
    console.info('[AbyssalCameraRig] Isolated DOM camera stopped.');
  }
}

export function startAbyssalCameraRig(options) {
  return new AbyssalCameraRig(options).init();
}
