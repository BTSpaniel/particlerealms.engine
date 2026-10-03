// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * UnderwaterSiltField.js - Lightweight interactive particulate atmosphere.
 *
 * A capped Canvas2D pass draws shallow caustic traces, depth-layered volcanic
 * ash/mineral flecks, and upper-left refracted light shafts. Particles follow a slow analytic
 * flow field and receive a local tangential impulse when the pointer disturbs
 * the water. The module has no runtime dependencies so release pages can ship
 * it beside the standalone authored-image backdrop pass.
 */

const TAU = Math.PI * 2;

function hash01(value) {
  const x = Math.sin(value * 91.3458 + 17.234) * 47453.5453;
  return x - Math.floor(x);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createParticle(index, width, height) {
  const depth = 0.16 + hash01(index * 7.13 + 1.7) * 0.84;
  const kindRoll = hash01(index * 13.71 + 9.4);
  const sizeRoll = hash01(index * 19.37 + 3.2);
  const sizeBand = sizeRoll > 0.94 ? 2.6 : sizeRoll > 0.72 ? 1.45 : 0.72;
  return {
    x: hash01(index * 2.31 + 4.2) * width,
    y: hash01(index * 5.93 + 8.1) * height,
    vx: 0,
    vy: 0,
    depth,
    size: (0.55 + depth * 1.35 + hash01(index * 3.17) * 0.75) * sizeBand,
    stretch: 1 + hash01(index * 29.53 + 6.8) * 1.2,
    phase: hash01(index * 11.39 + 2.6) * TAU,
    rotation: hash01(index * 17.41 + 7.3) * TAU,
    spin: (hash01(index * 23.91 + 5.1) - 0.5) * 0.7,
    kind: kindRoll > 0.94 ? 2 : kindRoll > 0.58 ? 1 : 0,
  };
}

function createExhaustBubble(index) {
  return {
    index,
    active: false,
    ownerId: '',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: 1,
    riseSpeed: 20,
    depth: 0.8,
    age: 0,
    lifetime: 6,
    phase: 0,
    wobbleHz: 2,
    wobbleAmplitude: 1,
    opacity: 0.5,
    streamSign: 1,
  };
}

export class UnderwaterSiltField {
  constructor(canvas, options = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new TypeError('UnderwaterSiltField requires a canvas');
    }
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Could not create the underwater Canvas2D context');

    this.canvas = canvas;
    this.context = context;
    this.particleCount = Math.max(24, options.particleCount ?? 104);
    this.targetFrameMs = 1000 / Math.max(1, options.targetFps ?? 30);
    this.maxPixelRatio = Math.max(1, options.maxPixelRatio ?? 1.25);
    this.pointerRadius = Math.max(80, options.pointerRadius ?? 210);
    this.imageUrl = options.imageUrl ?? null;
    this.backdropProjection = options.backdropProjection ?? null;
    this.fireGlowStrength = clamp(options.fireGlowStrength ?? 0.20, 0, 0.4);
    this.environmentLightingEnabled = options.environmentLightingEnabled !== false;
    this.fireLightingEnabled = options.fireLightingEnabled !== false;
    this.lightingOpacity = 1;
    this.exhaustOpacity = 1;
    this.interactionRegion = options.interactionRegion ?? null;
    this.pointerIdleMs = clamp(options.pointerIdleMs ?? 220, 120, 600);
    this.bubbleSourceProvider = options.bubbleSourceProvider ?? null;
    this.wakeSourceProvider = options.wakeSourceProvider ?? null;
    this.bubblesPerDiver = Math.round(clamp(options.bubblesPerDiver ?? 100, 24, 180));
    this.maxBubbleSources = Math.round(clamp(options.maxBubbleSources ?? 3, 1, 8));
    this.maxLiveBubblesPerDiver = Math.round(clamp(
      options.maxLiveBubblesPerDiver ?? 180,
      this.bubblesPerDiver,
      260,
    ));
    this.fireEmissionMask = null;
    this.particles = [];
    this.exhaustBubbles = Array.from(
      { length: this.maxBubbleSources * this.maxLiveBubblesPerDiver },
      (_, index) => createExhaustBubble(index),
    );
    this.breathStates = new Map();
    this.bubblePoolCursor = 0;
    this.bubbleSerial = 0;
    this.lastActiveBubbleCount = -1;
    this.providerWarnings = new Set();
    this.width = 1;
    this.height = 1;
    this.pixelRatio = 1;
    this.running = false;
    this.motionPaused = false;
    this.frameRequest = 0;
    this.startedAt = 0;
    this.lastRenderedAt = 0;
    this.pointer = {
      x: -1000,
      y: -1000,
      vx: 0,
      vy: 0,
      speed: 0,
      energy: 0,
      spin: 1,
      lastAt: 0,
      active: false,
    };

    this.onResize = () => this.resize();
    this.onPointerMove = (event) => this.handlePointerMove(event);
    this.onPointerLeave = () => { this.pointer.active = false; };
    this.onVisibility = () => {
      if (document.hidden) this.stop();
      else if (!this.motionPaused) this.start();
    };
  }

  init() {
    this.resize();
    window.addEventListener('resize', this.onResize, { passive: true });
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
    window.addEventListener('blur', this.onPointerLeave);
    document.addEventListener('visibilitychange', this.onVisibility);
    console.info(`[UnderwaterSiltField] ready ${this.particles.length} silt particles and ${this.exhaustBubbles.length} pooled exhaust bubbles at 30 FPS`);
    this.canvas.dataset.siltParticles = String(this.particles.length);
    this.canvas.dataset.siltTargetFps = String(Math.round(1000 / this.targetFrameMs));
    this.canvas.dataset.exhaustBubblesPerBreath = String(this.bubblesPerDiver);
    this.canvas.dataset.exhaustBubbleCapacity = String(this.exhaustBubbles.length);
    this.canvas.dataset.exhaustBubbles = '0';
    if (typeof this.bubbleSourceProvider === 'function') {
      document.documentElement.dataset.diverBubbles = 'canvas';
    }
    this.canvas.dataset.environmentLighting = this.environmentLightingEnabled ? 'canvas' : 'webgpu';
    this.canvas.dataset.fireLighting = this.fireLightingEnabled ? 'canvas' : 'webgpu';
    if (this.imageUrl && this.backdropProjection && this.fireGlowStrength > 0) {
      this.buildFireEmissionMask().catch((error) => {
        this.canvas.dataset.fireGlow = 'unavailable';
        console.warn('[UnderwaterSiltField] Color-aware fire glow unavailable.', error);
      });
    }
    return this;
  }

  async buildFireEmissionMask() {
    const response = await fetch(this.imageUrl);
    if (!response.ok) throw new Error(`Could not fetch fire artwork (${response.status})`);
    const bitmap = await createImageBitmap(await response.blob());
    const mask = document.createElement('canvas');
    mask.width = 384;
    mask.height = 256;
    const maskContext = mask.getContext('2d', { willReadFrequently: true });
    if (!maskContext) {
      bitmap.close?.();
      throw new Error('Could not create the fire emission-mask context');
    }

    maskContext.drawImage(bitmap, 0, 0, mask.width, mask.height);
    bitmap.close?.();
    const pixels = maskContext.getImageData(0, 0, mask.width, mask.height);
    const data = pixels.data;
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index] / 255;
      const green = data[index + 1] / 255;
      const blue = data[index + 2] / 255;
      const warmDominance = red - Math.max(blue * 1.35, green * 0.48);
      const warmMask = clamp((warmDominance - 0.06) * 2.6, 0, 1);
      const brightnessMask = clamp((red + green * 0.45 - 0.20) * 1.4, 0, 1);
      const emission = (warmMask ** 1.4) * (brightnessMask ** 1.25);

      // Preserve the authored heat colors so every irregular vein emits its
      // own hue instead of being covered by a generic orange gradient.
      data[index] = Math.min(255, Math.round(red * 344));
      data[index + 1] = Math.min(255, Math.round((green * 0.92 + red * 0.10) * 255));
      data[index + 2] = Math.min(255, Math.round(blue * 89));
      data[index + 3] = Math.round(emission * 255);
    }
    maskContext.putImageData(pixels, 0, 0);
    this.fireEmissionMask = mask;
    this.canvas.dataset.fireGlow = 'ready';
    console.info('[UnderwaterSiltField] Color-aware fire and lava-vein glow ready');
  }

  resize() {
    const previousWidth = this.width;
    const previousHeight = this.height;
    this.width = Math.max(1, window.innerWidth);
    this.height = Math.max(1, window.innerHeight);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    this.canvas.width = Math.round(this.width * this.pixelRatio);
    this.canvas.height = Math.round(this.height * this.pixelRatio);
    this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);

    if (!this.particles.length) {
      this.particles = Array.from(
        { length: this.particleCount },
        (_, index) => createParticle(index, this.width, this.height),
      );
      return;
    }

    const scaleX = this.width / Math.max(1, previousWidth);
    const scaleY = this.height / Math.max(1, previousHeight);
    for (const particle of this.particles) {
      particle.x *= scaleX;
      particle.y *= scaleY;
    }
    const radiusScale = Math.sqrt(scaleX * scaleY);
    for (const bubble of this.exhaustBubbles) {
      if (!bubble.active) continue;
      bubble.x *= scaleX;
      bubble.y *= scaleY;
      bubble.radius *= radiusScale;
    }
  }

  handlePointerMove(event) {
    if (event.pointerType === 'touch') return;
    const eventTarget = event.target instanceof Element ? event.target : null;
    if (eventTarget?.closest('a, button, input, select, textarea, pre, code, nav, [role="button"]')) {
      this.pointer.active = false;
      return;
    }

    let sample = event;
    if (typeof event.getCoalescedEvents === 'function') {
      const samples = event.getCoalescedEvents();
      if (samples.length) sample = samples[samples.length - 1];
    }

    if (this.interactionRegion) {
      const region = typeof this.interactionRegion === 'string'
        ? document.querySelector(this.interactionRegion)
        : this.interactionRegion;
      const bounds = region?.getBoundingClientRect();
      if (!bounds || sample.clientX < bounds.left || sample.clientX > bounds.right
        || sample.clientY < bounds.top || sample.clientY > bounds.bottom) {
        this.pointer.active = false;
        return;
      }
    }

    const now = performance.now();
    const deltaSeconds = clamp((now - this.pointer.lastAt) * 0.001, 1 / 240, 0.08);
    const previousX = this.pointer.x;
    const previousY = this.pointer.y;
    const hadPosition = this.pointer.lastAt > 0;
    const dx = hadPosition ? sample.clientX - previousX : 0;
    const dy = hadPosition ? sample.clientY - previousY : 0;
    const vx = dx / deltaSeconds;
    const vy = dy / deltaSeconds;
    const speed = Math.hypot(vx, vy);

    this.pointer.x = sample.clientX;
    this.pointer.y = sample.clientY;
    this.pointer.vx = clamp(vx, -1800, 1800);
    this.pointer.vy = clamp(vy, -1800, 1800);
    this.pointer.speed = Math.min(speed, 1800);
    this.pointer.energy = clamp(0.24 + speed / 1050, 0.24, 1);
    this.pointer.spin = Math.abs(vx) > Math.abs(vy) ? Math.sign(vx || 1) : -Math.sign(vy || -1);
    this.pointer.lastAt = now;
    this.pointer.active = true;

  }

  drawGodRays(time) {
    const ctx = this.context;
    const rayHeight = this.height * 0.68;
    ctx.save();
    ctx.globalAlpha = this.lightingOpacity;
    ctx.globalCompositeOperation = 'screen';
    ctx.filter = 'blur(4px)';

    const paintRay = (sourceX, endX, halfWidth, height, shimmer, intensity) => {
      const gradient = ctx.createLinearGradient(sourceX, 0, endX, height);
      gradient.addColorStop(0, `rgba(115, 224, 245, ${intensity * shimmer})`);
      gradient.addColorStop(0.52, `rgba(61, 173, 207, ${intensity * 0.42 * shimmer})`);
      gradient.addColorStop(1, 'rgba(25, 103, 139, 0)');
      ctx.beginPath();
      ctx.moveTo(sourceX - 5, -8);
      ctx.lineTo(sourceX + 5, -8);
      ctx.lineTo(endX + halfWidth, height);
      ctx.lineTo(endX - halfWidth, height);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    };

    for (let ray = 0; ray < 4; ray += 1) {
      const shimmer = 0.7 + Math.sin(time * 0.7 + ray * 1.83) * 0.22
        + Math.sin(time * 2.1 + ray * 2.7) * 0.08;
      const sway = Math.sin(time * 0.18 + ray * 1.37) * this.width * 0.024;
      const sourceX = this.width * (0.27 + ray * 0.052) + sway * 0.35;
      const endX = sourceX - this.width * (0.105 + ray * 0.031) + sway;
      const breathe = 0.9 + Math.sin(time * 0.31 + ray) * 0.1;
      const halfWidth = this.width * (0.022 + ray * 0.008) * breathe;
      paintRay(sourceX, endX, halfWidth, rayHeight, shimmer, 0.12);
    }

    // Two quieter counter-rays balance the far side without mirroring the
    // primary fan. Their independent phases make the surface light irregular.
    for (let ray = 0; ray < 2; ray += 1) {
      const shimmer = 0.68 + Math.sin(time * 0.83 + ray * 2.43) * 0.23
        + Math.sin(time * 2.37 + ray * 1.31) * 0.07;
      const sway = Math.sin(time * 0.15 + ray * 2.17) * this.width * 0.018;
      const sourceX = this.width * (0.77 + ray * 0.075) + sway * 0.3;
      const endX = sourceX + this.width * (0.095 + ray * 0.026) + sway;
      const breathe = 0.92 + Math.sin(time * 0.27 + ray * 1.7) * 0.08;
      const halfWidth = this.width * (0.018 + ray * 0.007) * breathe;
      paintRay(sourceX, endX, halfWidth, rayHeight * 0.86, shimmer, 0.085);
    }
    ctx.restore();
  }

  drawCausticTraces(time) {
    const ctx = this.context;
    ctx.save();
    ctx.globalAlpha = this.lightingOpacity;
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    ctx.filter = 'blur(0.35px)';

    for (let band = 0; band < 5; band += 1) {
      const baseY = this.height * (0.035 + band * 0.067);
      const depthFade = 1 - band / 6;
      const fieldWidth = this.width * 0.64;
      const strokeGradient = ctx.createLinearGradient(0, 0, fieldWidth, 0);
      strokeGradient.addColorStop(0, `rgba(118, 235, 251, ${0.052 * depthFade})`);
      strokeGradient.addColorStop(0.72, `rgba(74, 197, 226, ${0.026 * depthFade})`);
      strokeGradient.addColorStop(1, 'rgba(51, 160, 198, 0)');
      ctx.beginPath();
      for (let x = -24; x <= fieldWidth + 24; x += 28) {
        const y = baseY
          + Math.sin(x * 0.009 + time * 0.42 + band * 1.7) * (3.5 + band * 0.7)
          + Math.sin(x * 0.021 - time * 0.27 + band) * 1.8;
        if (x < 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.setLineDash([24 + band * 4, 17 + band * 3]);
      ctx.lineDashOffset = -time * (5 + band * 0.7) + band * 13;
      ctx.strokeStyle = strokeGradient;
      ctx.lineWidth = 0.9 + depthFade * 0.7;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawFireGlow(time) {
    if (!this.fireEmissionMask || typeof this.backdropProjection !== 'function') return;
    const projection = this.backdropProjection();
    if (!projection) return;

    const drawX = -projection.sourceOffsetX * projection.displayWidth;
    const pulse = 0.9
      + Math.sin(time * 0.82) * 0.055
      + Math.sin(time * 1.93 + 0.8) * 0.035;
    const ctx = this.context;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = this.fireGlowStrength * this.lightingOpacity * pulse;
    ctx.filter = 'blur(28px) saturate(1.28)';
    ctx.drawImage(
      this.fireEmissionMask,
      drawX,
      0,
      projection.displayWidth,
      projection.displayHeight,
    );
    ctx.globalAlpha = this.fireGlowStrength * this.lightingOpacity * 0.42 * pulse;
    ctx.filter = 'blur(10px) saturate(1.16)';
    ctx.drawImage(
      this.fireEmissionMask,
      drawX,
      0,
      projection.displayWidth,
      projection.displayHeight,
    );
    // Thin traveling exposures are clipped by the warm-pixel mask, so the
    // authored lava network controls both the route and shape of every pulse.
    ctx.globalCompositeOperation = 'lighter';
    ctx.filter = 'blur(1.2px) saturate(1.38) brightness(1.24)';
    for (let stream = 0; stream < 4; stream += 1) {
      const progress = (time * (0.045 + stream * 0.003) + stream * 0.247) % 1;
      const bandY = projection.displayHeight * (0.49 + progress * 0.49);
      const bandHeight = 4 + stream * 1.6;
      ctx.save();
      ctx.beginPath();
      ctx.rect(drawX, bandY - bandHeight, projection.displayWidth, bandHeight * 2);
      ctx.clip();
      ctx.globalAlpha = this.fireGlowStrength * this.lightingOpacity * (0.20 + stream * 0.018);
      ctx.drawImage(
        this.fireEmissionMask,
        drawX,
        0,
        projection.displayWidth,
        projection.displayHeight,
      );
      ctx.restore();
    }
    ctx.restore();
  }

  sampleWaterFlow(x, y, depth, phase, time) {
    const depthSpeed = 0.42 + depth * 0.88;
    return {
      x: (
        Math.sin(y * 0.008 + time * 0.24 + phase) * 7.5 +
        Math.cos(x * 0.0045 - time * 0.17 + phase * 0.7) * 4.0
      ) * depthSpeed,
      y: (
        Math.cos(x * 0.006 + time * 0.19 + phase) * 4.2 -
        (2.2 + depth * 5.5)
      ) * depthSpeed,
    };
  }

  updateAndDrawParticles(time, deltaSeconds) {
    const ctx = this.context;
    const activeCount = this.width <= 720
      ? Math.round(this.particles.length * 0.62)
      : this.particles.length;
    const pointer = this.pointer;
    const pointerRadius = this.pointerRadius + Math.min(pointer.speed * 0.025, 45);
    const velocityDamping = Math.exp(-deltaSeconds * 1.65);

    if (pointer.active && performance.now() - pointer.lastAt > this.pointerIdleMs) {
      pointer.active = false;
    }
    pointer.energy *= Math.exp(-deltaSeconds * (pointer.active ? 1.25 : 3.2));
    pointer.vx *= Math.exp(-deltaSeconds * 4.2);
    pointer.vy *= Math.exp(-deltaSeconds * 4.2);
    pointer.speed *= Math.exp(-deltaSeconds * 3.4);

    for (let index = 0; index < activeCount; index += 1) {
      const particle = this.particles[index];
      const depthSpeed = 0.42 + particle.depth * 0.88;
      const flow = this.sampleWaterFlow(
        particle.x,
        particle.y,
        particle.depth,
        particle.phase,
        time,
      );

      particle.vx = particle.vx * velocityDamping + flow.x * deltaSeconds * 1.8;
      particle.vy = particle.vy * velocityDamping + flow.y * deltaSeconds * 1.8;

      if (pointer.energy > 0.015) {
        const dx = particle.x - pointer.x;
        const dy = particle.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 0.001 && distance < pointerRadius) {
          const normalizedDistance = distance / pointerRadius;
          const influence = (1 - normalizedDistance) ** 2 * pointer.energy;
          const tangentX = (-dy / distance) * pointer.spin;
          const tangentY = (dx / distance) * pointer.spin;
          const outwardX = dx / distance;
          const outwardY = dy / distance;
          const vortex = (95 + pointer.speed * 0.11) * influence * depthSpeed;
          particle.vx += (tangentX * vortex + outwardX * vortex * 0.24) * deltaSeconds;
          particle.vy += (tangentY * vortex + outwardY * vortex * 0.24) * deltaSeconds;
          particle.vx += pointer.vx * influence * deltaSeconds * 0.085;
          particle.vy += pointer.vy * influence * deltaSeconds * 0.085;
        }
      }

      particle.x += particle.vx * deltaSeconds;
      particle.y += particle.vy * deltaSeconds;
      particle.rotation += particle.spin * deltaSeconds;

      const margin = 18;
      if (particle.x < -margin) particle.x = this.width + margin;
      else if (particle.x > this.width + margin) particle.x = -margin;
      if (particle.y < -margin) particle.y = this.height + margin;
      else if (particle.y > this.height + margin) particle.y = -margin;

      const pulse = 0.78 + Math.sin(time * 0.72 + particle.phase) * 0.22;
      const alpha = (0.13 + particle.depth * 0.27) * pulse;
      ctx.save();
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.rotation);
      ctx.beginPath();
      ctx.ellipse(0, 0, particle.size * particle.stretch, particle.size * 0.44, 0, 0, TAU);
      if (particle.kind === 0) ctx.fillStyle = `rgba(4, 13, 18, ${alpha})`;
      else if (particle.kind === 1) ctx.fillStyle = `rgba(90, 184, 199, ${alpha * 0.78})`;
      else ctx.fillStyle = `rgba(221, 105, 48, ${alpha * 0.62})`;
      ctx.fill();

      if (particle.kind !== 0 && particle.depth > 0.58) {
        ctx.beginPath();
        ctx.moveTo(-particle.size * 0.6, -particle.size * 0.12);
        ctx.lineTo(particle.size * 0.5, -particle.size * 0.12);
        ctx.strokeStyle = `rgba(196, 245, 249, ${alpha * 0.32})`;
        ctx.lineWidth = 0.55;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  readSourceProvider(provider, label) {
    if (typeof provider !== 'function') return [];
    try {
      const sources = provider();
      if (!Array.isArray(sources)) return [];
      return sources.filter((source) => Number.isFinite(source?.x) && Number.isFinite(source?.y));
    } catch (error) {
      if (!this.providerWarnings.has(label)) {
        this.providerWarnings.add(label);
        console.warn(`[UnderwaterSiltField] ${label} provider failed; preserving the ambient field.`, error);
      }
      return [];
    }
  }

  getBreathState(source, sourceIndex) {
    const id = String(source.id ?? sourceIndex);
    let state = this.breathStates.get(id);
    if (state) return state;
    const cycleSeed = hash01(sourceIndex * 11.73 + 4.91);
    const phaseSeed = Number.isFinite(source.phase)
      ? ((source.phase % TAU) + TAU) % TAU / TAU
      : hash01(sourceIndex * 17.29 + 3.41);
    const cycleDuration = 5.7 + cycleSeed * 1.35;
    state = {
      id,
      cycleDuration,
      exhaleDuration: 1.85 + hash01(sourceIndex * 5.61 + 8.37) * 0.45,
      phaseOffset: phaseSeed * cycleDuration,
      cycleIndex: null,
      emitted: 0,
      activeCount: 0,
    };
    this.breathStates.set(id, state);
    return state;
  }

  acquireExhaustBubble(state) {
    if (state.activeCount >= this.maxLiveBubblesPerDiver) return null;
    for (let offset = 0; offset < this.exhaustBubbles.length; offset += 1) {
      const index = (this.bubblePoolCursor + offset) % this.exhaustBubbles.length;
      const bubble = this.exhaustBubbles[index];
      if (bubble.active) continue;
      this.bubblePoolCursor = (index + 1) % this.exhaustBubbles.length;
      bubble.active = true;
      state.activeCount += 1;
      return bubble;
    }
    return null;
  }

  deactivateExhaustBubble(bubble) {
    if (!bubble.active) return;
    const state = this.breathStates.get(bubble.ownerId);
    if (state) state.activeCount = Math.max(0, state.activeCount - 1);
    bubble.active = false;
    bubble.ownerId = '';
  }

  spawnExhaustBubble(source, state) {
    const bubble = this.acquireExhaustBubble(state);
    if (!bubble) return;

    const serial = this.bubbleSerial;
    this.bubbleSerial += 1;
    const sizeRoll = hash01(serial * 13.17 + 0.83);
    const detailRoll = hash01(serial * 23.41 + 5.17);
    let radius;
    if (sizeRoll < 0.55) radius = 0.48 + detailRoll * 0.52;
    else if (sizeRoll < 0.85) radius = 1.0 + detailRoll * 0.78;
    else if (sizeRoll < 0.97) radius = 1.8 + detailRoll * 1.45;
    else radius = 3.35 + detailRoll * 2.25;

    const sourceSize = Math.max(80, source.size ?? 170);
    const sourceScale = clamp(sourceSize / 180, 0.7, 1.35);
    const direction = Math.sign(source.direction || 1);
    const streamSign = serial % 2 === 0 ? -1 : 1;
    const scatter = hash01(serial * 31.63 + 9.71) - 0.5;
    const pxPerMeter = sourceSize / 1.7;
    bubble.ownerId = state.id;
    bubble.x = source.x - direction * (1.5 + detailRoll * 3.5) + scatter * 2.5;
    bubble.y = source.y + streamSign * (2.2 + sourceSize * 0.012) + scatter * 1.8;
    bubble.vx = (source.vx ?? 0) * 0.16 - direction * (3 + detailRoll * 8);
    bubble.vy = (source.vy ?? 0) * 0.08 + streamSign * (2.5 + detailRoll * 4.5) + 4;
    bubble.radius = radius * sourceScale;
    bubble.riseSpeed = pxPerMeter * (0.14 + hash01(serial * 7.39 + 2.11) * 0.18);
    bubble.depth = clamp(source.depth ?? 0.82, 0.28, 1.08);
    bubble.age = 0;
    bubble.lifetime = 5.1 + hash01(serial * 19.23 + 1.37) * 2.7;
    bubble.phase = hash01(serial * 3.97 + 7.81) * TAU;
    bubble.wobbleHz = 1.8 + hash01(serial * 29.11 + 6.53) * 2.8;
    bubble.wobbleAmplitude = bubble.radius * (0.55 + hash01(serial * 37.19 + 4.27) * 1.35);
    bubble.opacity = 0.36 + bubble.depth * 0.28 + detailRoll * 0.12;
    bubble.streamSign = streamSign;
  }

  emitBreathPulses(time, sources) {
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      const source = sources[sourceIndex];
      const state = this.getBreathState(source, sourceIndex);
      const absoluteCycleTime = time + state.phaseOffset;
      const cycleIndex = Math.floor(absoluteCycleTime / state.cycleDuration);
      const localTime = absoluteCycleTime - cycleIndex * state.cycleDuration;
      const progress = clamp(localTime / state.exhaleDuration, 0, 1);
      const cumulativePulse = 0.5 - Math.cos(progress * Math.PI) * 0.5;
      const targetEmitted = localTime < state.exhaleDuration
        ? Math.floor(cumulativePulse * this.bubblesPerDiver)
        : this.bubblesPerDiver;

      if (state.cycleIndex === null) {
        // Join an in-progress breath without dumping its missing history into
        // one frame. Subsequent frames emit the remainder of the pulse.
        state.cycleIndex = cycleIndex;
        state.emitted = targetEmitted;
        continue;
      }
      if (cycleIndex !== state.cycleIndex) {
        state.cycleIndex = cycleIndex;
        state.emitted = 0;
      }
      if (localTime >= state.exhaleDuration) {
        state.emitted = this.bubblesPerDiver;
        continue;
      }

      const spawnCount = Math.max(0, targetEmitted - state.emitted);
      for (let index = 0; index < spawnCount; index += 1) {
        this.spawnExhaustBubble(source, state);
      }
      state.emitted = targetEmitted;
    }
  }

  updateAndDrawExhaustBubbles(time, deltaSeconds) {
    const sources = this.readSourceProvider(this.bubbleSourceProvider, 'bubble-source');
    const wakes = this.readSourceProvider(this.wakeSourceProvider, 'wake-source');
    if (this.exhaustOpacity > 0.015) this.emitBreathPulses(time, sources);
    const activeSourceIds = new Set(sources.map((source, index) => String(source.id ?? index)));
    const pointer = this.pointer;
    const ctx = this.context;
    let activeCount = 0;

    ctx.save();
    ctx.lineCap = 'round';
    for (const bubble of this.exhaustBubbles) {
      if (!bubble.active) continue;
      bubble.age += deltaSeconds;
      if (!activeSourceIds.has(bubble.ownerId)) {
        bubble.lifetime = Math.min(bubble.lifetime, bubble.age + 0.8);
      }
      if (bubble.age >= bubble.lifetime || bubble.y < -40
        || bubble.x < -80 || bubble.x > this.width + 80) {
        this.deactivateExhaustBubble(bubble);
        continue;
      }

      const water = this.sampleWaterFlow(bubble.x, bubble.y, bubble.depth, bubble.phase, time);
      const youngPlumeLift = 1 + Math.exp(-bubble.age * 1.25) * 0.24;
      const targetVx = water.x * 0.86;
      const targetVy = -bubble.riseSpeed * youngPlumeLift + water.y * 0.38;
      const currentResponse = 1 - Math.exp(-deltaSeconds * 0.82);
      const buoyancyResponse = 1 - Math.exp(-deltaSeconds * 1.28);
      bubble.vx += (targetVx - bubble.vx) * currentResponse;
      bubble.vy += (targetVy - bubble.vy) * buoyancyResponse;

      for (const wake of wakes) {
        if (Number.isFinite(wake.depth) && Math.abs(wake.depth - bubble.depth) > 0.3) continue;
        const radius = Math.max(8, wake.radius ?? 40);
        const dx = bubble.x - wake.x;
        const dy = bubble.y - wake.y;
        if (Math.abs(dx) > radius || Math.abs(dy) > radius) continue;
        const distance = Math.hypot(dx, dy);
        if (distance < 0.001 || distance >= radius) continue;
        const influence = (1 - distance / radius) ** 2;
        const coupling = wake.kind === 'diver' ? 0.82 : 0.34;
        const wakeStrength = clamp(wake.strength ?? 0.5, 0, 1.5);
        bubble.vx += ((wake.vx ?? 0) - bubble.vx) * influence * coupling * deltaSeconds;
        bubble.vy += ((wake.vy ?? 0) - bubble.vy) * influence * coupling * deltaSeconds;
        const tangentX = -dy / distance;
        const tangentY = dx / distance;
        const curl = (18 + Math.hypot(wake.vx ?? 0, wake.vy ?? 0) * 0.08)
          * influence * wakeStrength * Math.sign(wake.direction || 1);
        bubble.vx += tangentX * curl * deltaSeconds;
        bubble.vy += tangentY * curl * deltaSeconds;
      }

      if (pointer.energy > 0.02) {
        const dx = bubble.x - pointer.x;
        const dy = bubble.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 0.001 && distance < this.pointerRadius) {
          const influence = (1 - distance / this.pointerRadius) ** 2 * pointer.energy;
          bubble.vx += (-dy / distance) * pointer.spin * influence * 54 * deltaSeconds;
          bubble.vy += (dx / distance) * pointer.spin * influence * 54 * deltaSeconds;
        }
      }

      bubble.x += bubble.vx * deltaSeconds;
      bubble.y += bubble.vy * deltaSeconds;
      activeCount += 1;

      const lifeProgress = bubble.age / bubble.lifetime;
      const expansion = 1 + lifeProgress * (0.08 + (1 - bubble.depth) * 0.08);
      const radius = bubble.radius * expansion;
      const screenX = bubble.x + Math.sin(
        bubble.age * bubble.wobbleHz * TAU + bubble.phase,
      ) * bubble.wobbleAmplitude;
      const fadeIn = clamp(bubble.age / 0.16, 0, 1);
      const fadeOut = clamp((1 - lifeProgress) / 0.28, 0, 1);
      const alpha = bubble.opacity * fadeIn * fadeOut * this.exhaustOpacity;

      if (radius < 1.05) {
        ctx.beginPath();
        ctx.arc(screenX, bubble.y, Math.max(0.42, radius * 0.72), 0, TAU);
        ctx.fillStyle = `rgba(178, 235, 247, ${alpha * 0.72})`;
        ctx.fill();
        continue;
      }

      if (radius > 2.35) {
        ctx.beginPath();
        ctx.arc(screenX, bubble.y, radius * 0.93, 0, TAU);
        ctx.fillStyle = `rgba(8, 37, 56, ${alpha * 0.16})`;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(screenX, bubble.y, radius, 0, TAU);
      ctx.strokeStyle = `rgba(117, 211, 235, ${alpha * 0.72})`;
      ctx.lineWidth = clamp(radius * 0.18, 0.55, 1.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(screenX - radius * 0.16, bubble.y - radius * 0.14, radius * 0.69, 3.55, 5.2);
      ctx.strokeStyle = `rgba(232, 253, 255, ${alpha * 0.82})`;
      ctx.lineWidth = clamp(radius * 0.13, 0.48, 0.9);
      ctx.stroke();
    }
    ctx.restore();

    if (activeCount !== this.lastActiveBubbleCount) {
      this.lastActiveBubbleCount = activeCount;
      this.canvas.dataset.exhaustBubbles = String(activeCount);
      this.canvas.dataset.exhaustSources = String(sources.length);
    }
  }

  render = (timestamp) => {
    if (!this.running) return;
    if (timestamp - this.lastRenderedAt < this.targetFrameMs) {
      this.frameRequest = requestAnimationFrame(this.render);
      return;
    }

    const elapsed = this.startedAt ? (timestamp - this.startedAt) * 0.001 : 0;
    const deltaSeconds = clamp((timestamp - (this.lastRenderedAt || timestamp)) * 0.001, 0, 0.05);
    if (!this.startedAt) this.startedAt = timestamp;
    this.lastRenderedAt = timestamp;
    this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.context.clearRect(0, 0, this.width, this.height);
    if (this.environmentLightingEnabled) {
      this.drawGodRays(elapsed);
      this.drawCausticTraces(elapsed);
    }
    if (this.fireLightingEnabled) this.drawFireGlow(elapsed);
    this.updateAndDrawParticles(elapsed, deltaSeconds);
    this.updateAndDrawExhaustBubbles(elapsed, deltaSeconds);
    this.frameRequest = requestAnimationFrame(this.render);
  };

  start() {
    if (this.running || this.motionPaused || document.hidden) return;
    this.running = true;
    this.frameRequest = requestAnimationFrame(this.render);
  }

  stop() {
    this.running = false;
    if (this.frameRequest) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
  }

  setPaused(paused) {
    this.motionPaused = Boolean(paused);
    if (this.motionPaused) this.stop();
    else this.start();
  }

  setEnvironmentalLightingEnabled(enabled) {
    this.environmentLightingEnabled = Boolean(enabled);
    this.canvas.dataset.environmentLighting = this.environmentLightingEnabled ? 'canvas' : 'webgpu';
  }

  setFireLightingEnabled(enabled) {
    this.fireLightingEnabled = Boolean(enabled);
    this.canvas.dataset.fireLighting = this.fireLightingEnabled ? 'canvas' : 'webgpu';
  }

  /** Fades authored illumination without removing water, silt, or active flow. */
  setSceneTransition({ lightingOpacity = this.lightingOpacity, exhaustOpacity = this.exhaustOpacity } = {}) {
    this.lightingOpacity = clamp(Number(lightingOpacity) || 0, 0, 1);
    this.exhaustOpacity = clamp(Number(exhaustOpacity) || 0, 0, 1);
    this.canvas.dataset.sceneLightingOpacity = this.lightingOpacity.toFixed(3);
    this.canvas.dataset.exhaustOpacity = this.exhaustOpacity.toFixed(3);
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointermove', this.onPointerMove);
    document.documentElement.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('blur', this.onPointerLeave);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.particles.length = 0;
    this.exhaustBubbles.length = 0;
    this.breathStates.clear();
    if (document.documentElement.dataset.diverBubbles === 'canvas') {
      delete document.documentElement.dataset.diverBubbles;
    }
    this.context.clearRect(0, 0, this.width, this.height);
  }
}

export function startUnderwaterSiltField(canvas, options = {}) {
  const field = new UnderwaterSiltField(canvas, options).init();
  field.start();
  return field;
}
