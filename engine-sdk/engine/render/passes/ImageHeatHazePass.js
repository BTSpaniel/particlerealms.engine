// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ImageHeatHazePass.js - Layered water optics for an authored mineral plate.
 *
 * This is the static-image counterpart to ParticleDistortionRenderer. The
 * authored plate owns geology; this pass owns water refraction, attenuation,
 * caustics, texture-broken god rays, heat haze, and color-aware lava emission.
 */

import { acquireGpuDeviceForConsumer } from '../../core/gpu/GpuDeviceOwnership.js';

const IMAGE_HEAT_HAZE_WGSL = /* wgsl */ `
struct HeatHazeUniforms {
  time: f32,
  strength: f32,
  viewportAspect: f32,
  imageAspect: f32,
  sourceScale: vec2<f32>,
  sourceOffset: vec2<f32>,
  ventAnchor: vec2<f32>,
  plumeRadius: vec2<f32>,
  smokeStrength: f32,
  smokeSpeed: f32,
  godRayStrength: f32,
  godRaySpeed: f32,
  waterRippleStrength: f32,
  waterRippleSpeed: f32,
  causticsStrength: f32,
  _waterPad: f32,
  fireGlowStrength: f32,
  _firePad0: f32,
  _firePad1: f32,
  _firePad2: f32,
};

@group(0) @binding(0) var<uniform> haze: HeatHazeUniforms;
@group(0) @binding(1) var sourceImage: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var godRayBreakupTexture: texture_2d<f32>;
@group(0) @binding(4) var godRaySampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let x = f32((vertexIndex << 1u) & 2u);
  let y = f32(vertexIndex & 2u);
  var output: VertexOutput;
  output.position = vec4<f32>(x * 2.0 - 1.0, -(y * 2.0 - 1.0), 0.0, 1.0);
  output.uv = vec2<f32>(x, y);
  return output;
}

fn plumeMask(uv: vec2<f32>) -> f32 {
  let rise = (haze.ventAnchor.y - uv.y) / max(haze.plumeRadius.y, 0.001);
  let vertical = smoothstep(-0.08, 0.10, rise) * (1.0 - smoothstep(0.78, 1.18, rise));
  let widening = 0.34 + clamp(rise, 0.0, 1.0) * 0.54;
  let lateral = abs(uv.x - haze.ventAnchor.x) / max(haze.plumeRadius.x * widening, 0.001);
  return vertical * (1.0 - smoothstep(0.58, 1.0, lateral));
}

fn smokeMask(uv: vec2<f32>) -> f32 {
  let rise = (haze.ventAnchor.y - uv.y) / max(haze.plumeRadius.y, 0.001);
  let centerDrift = haze.ventAnchor.x - clamp(rise, 0.0, 1.6) * 0.028;
  let widening = 0.42 + clamp(rise, 0.0, 1.6) * 0.40;
  let lateral = abs(uv.x - centerDrift) / max(haze.plumeRadius.x * widening, 0.001);
  let vertical = smoothstep(0.10, 0.30, rise) * (1.0 - smoothstep(1.36, 1.72, rise));
  return vertical * (1.0 - smoothstep(0.62, 1.0, lateral));
}

fn screenToSourceUV(screenUV: vec2<f32>) -> vec2<f32> {
  return clamp(
    screenUV * haze.sourceScale + haze.sourceOffset,
    vec2<f32>(0.001),
    vec2<f32>(0.999)
  );
}

// Match UnderwaterPass's crossed-wave refraction, but keep the amplitude low
// enough that the authored illustration remains the visual authority.
fn underwaterRippleOffset(screenUV: vec2<f32>) -> vec2<f32> {
  let rippleTime = haze.time * haze.waterRippleSpeed;
  let surfaceWeight = mix(1.0, 0.42, smoothstep(0.0, 1.0, screenUV.y));
  let waveX = sin(
    screenUV.y * 18.0 + rippleTime * 2.1 +
    sin(screenUV.x * 8.0 - rippleTime * 0.55) * 1.2
  );
  let waveY = cos(
    screenUV.x * 15.0 - rippleTime * 1.4 +
    sin(screenUV.y * 11.0 + rippleTime * 0.42) * 0.85
  );
  let crossWave = sin((screenUV.x * 1.4 + screenUV.y) * 31.0 + rippleTime * 1.1);
  return vec2<f32>(
    waveX + crossWave * 0.28,
    waveY * 0.62 + crossWave * 0.18
  ) * haze.waterRippleStrength * surfaceWeight;
}

// Two refracted wave families form narrow, moving caustic ridges without a
// tiled texture. Their contribution fades with depth and toward the edges.
fn underwaterCaustics(screenUV: vec2<f32>) -> f32 {
  let causticTime = haze.time * haze.waterRippleSpeed;
  let p = screenUV * vec2<f32>(23.0, 17.0);
  let waveA = sin(p.x + sin(p.y * 0.72 + causticTime * 0.73) * 1.4);
  let waveB = cos(p.y * 1.13 + cos(p.x * 0.61 - causticTime * 0.52) * 1.3);
  let ridge = pow(max(0.0, 1.0 - abs(waveA - waveB) * 0.72), 7.0);
  let depthFade = 1.0 - smoothstep(0.08, 0.94, screenUV.y);
  let leftField = 1.0 - smoothstep(0.48, 0.80, screenUV.x);
  let shimmer = 0.78 + sin(causticTime * 1.7 + screenUV.x * 13.0) * 0.22;
  return ridge * depthFade * leftField * shimmer;
}

// A compact authored breakup texture supplies the irregular cel-painted edges
// while JavaScript/WebGPU supplies all motion, projection, and intensity.
fn godRayBreakup(screenUV: vec2<f32>) -> f32 {
  let shimmerTime = haze.time * haze.godRaySpeed;
  let driftA = vec2<f32>(-shimmerTime * 0.041, shimmerTime * 0.026);
  let driftB = vec2<f32>(shimmerTime * 0.027, -shimmerTime * 0.019);
  let textureA = textureSample(
    godRayBreakupTexture,
    godRaySampler,
    fract(screenUV * vec2<f32>(1.14, 0.92) + driftA)
  ).rgb;
  let textureB = textureSample(
    godRayBreakupTexture,
    godRaySampler,
    fract(vec2<f32>(1.0 - screenUV.x, screenUV.y) * vec2<f32>(0.78, 1.17) + driftB)
  ).rgb;
  let luminanceA = dot(textureA, vec3<f32>(0.2126, 0.7152, 0.0722));
  let luminanceB = dot(textureB, vec3<f32>(0.2126, 0.7152, 0.0722));
  return smoothstep(0.035, 0.58, max(luminanceA, luminanceB * 0.72));
}

// Low-tap screen-space scattering after GPU Gems 3, Chapter 13. Bright source
// pixels are accumulated toward an above-surface light with exponential decay.
fn godRayScatter(screenUV: vec2<f32>) -> vec3<f32> {
  let shimmerTime = haze.time * haze.godRaySpeed;
  let lightPosition = vec2<f32>(0.43 + sin(shimmerTime * 0.35) * 0.028, -0.10);
  let waveShimmer = 0.88 + sin(screenUV.x * 29.0 - shimmerTime * 3.1 + sin(screenUV.y * 17.0 + shimmerTime)) * 0.12;
  let rayStep = (screenUV - lightPosition) * (0.061 + waveShimmer * 0.006);
  var samplePosition = screenUV;
  var illuminationDecay = 0.92;
  var scattering = vec3<f32>(0.0);

  for (var sampleIndex = 0u; sampleIndex < 5u; sampleIndex += 1u) {
    samplePosition -= rayStep;
    let source = textureSample(sourceImage, sourceSampler, screenToSourceUV(samplePosition)).rgb;
    let luminance = dot(source, vec3<f32>(0.2126, 0.7152, 0.0722));
    let sourceGate = smoothstep(0.34, 0.82, luminance);
    scattering += source * sourceGate * illuminationDecay;
    illuminationDecay *= 0.76;
  }

  let depthAttenuation = (1.0 - smoothstep(0.08, 0.92, screenUV.y)) * smoothstep(-0.02, 0.08, screenUV.y);
  let lateralFade = 1.0 - smoothstep(0.42, 0.82, abs(screenUV.x - 0.24));
  let authoredBreakup = 0.34 + godRayBreakup(screenUV) * 0.92;
  let leftFanCoordinate = screenUV.x + screenUV.y * 0.24 - 0.22 + sin(shimmerTime * 0.31) * 0.018;
  let rightFanCoordinate = screenUV.x - screenUV.y * 0.20 - 0.78 + sin(shimmerTime * 0.27 + 1.7) * 0.014;
  let leftFan = pow(max(0.0, 0.5 + cos(leftFanCoordinate * 34.0) * 0.5), 9.0) * lateralFade;
  let rightFade = 1.0 - smoothstep(0.28, 0.58, abs(screenUV.x - 0.82));
  let rightFan = pow(max(0.0, 0.5 + cos(rightFanCoordinate * 39.0) * 0.5), 11.0) * rightFade * 0.58;
  let directShafts = vec3<f32>(0.18, 0.66, 0.92)
    * (leftFan + rightFan)
    * authoredBreakup
    * depthAttenuation
    * haze.godRayStrength
    * 0.82;
  let scatteredShafts = scattering
    * vec3<f32>(0.34, 0.78, 1.0)
    * haze.godRayStrength
    * waveShimmer
    * authoredBreakup
    * depthAttenuation
    * lateralFade;
  return scatteredShafts + directShafts;
}

fn warmEmissionAt(sourceUV: vec2<f32>) -> vec3<f32> {
  let source = textureSample(
    sourceImage,
    sourceSampler,
    clamp(sourceUV, vec2<f32>(0.001), vec2<f32>(0.999))
  ).rgb;
  let warmDominance = source.r - max(source.b * 1.35, source.g * 0.48);
  let warmMask = smoothstep(0.06, 0.42, warmDominance);
  let brightnessMask = smoothstep(0.14, 0.78, source.r + source.g * 0.45);
  let emissionColor = vec3<f32>(
    source.r,
    source.g * 0.84 + source.r * 0.12,
    source.b * 0.25
  );
  return emissionColor * warmMask * brightnessMask;
}

// Sparse multi-radius bloom. No center sample is used: the painted fire stays
// authoritative while only neighboring warm pixels create a soft halo.
fn colorAwareFireGlow(sourceUV: vec2<f32>) -> vec3<f32> {
  let nearRadius = vec2<f32>(0.0065, 0.00975);
  let farRadius = vec2<f32>(0.012, 0.018);
  var halo = vec3<f32>(0.0);
  halo += warmEmissionAt(sourceUV + vec2<f32>(nearRadius.x, 0.0)) * 0.14;
  halo += warmEmissionAt(sourceUV - vec2<f32>(nearRadius.x, 0.0)) * 0.14;
  halo += warmEmissionAt(sourceUV + vec2<f32>(0.0, nearRadius.y)) * 0.14;
  halo += warmEmissionAt(sourceUV - vec2<f32>(0.0, nearRadius.y)) * 0.14;
  halo += warmEmissionAt(sourceUV + farRadius) * 0.08;
  halo += warmEmissionAt(sourceUV - farRadius) * 0.08;
  halo += warmEmissionAt(sourceUV + vec2<f32>(farRadius.x, -farRadius.y)) * 0.08;
  halo += warmEmissionAt(sourceUV + vec2<f32>(-farRadius.x, farRadius.y)) * 0.08;
  let pulse = 0.90
    + sin(haze.time * 0.82) * 0.055
    + sin(haze.time * 1.93 + 0.8) * 0.035;
  return halo * haze.fireGlowStrength * pulse;
}

// Animated energy travels only through pixels identified as warm authored
// fissures. The texture itself therefore decides where lava is allowed to move.
fn colorAwareLavaFlow(sourceUV: vec2<f32>) -> vec3<f32> {
  let emission = warmEmissionAt(sourceUV);
  let primaryPhase = sourceUV.y * 76.0 + sourceUV.x * 19.0 - haze.time * 3.15;
  let secondaryPhase = sourceUV.y * 41.0 - sourceUV.x * 37.0 - haze.time * 1.86;
  let primaryPulse = pow(0.5 + 0.5 * sin(primaryPhase), 7.0);
  let secondaryPulse = pow(0.5 + 0.5 * sin(secondaryPhase), 10.0);
  let irregularity = 0.74 + sin(sourceUV.x * 113.0 + sourceUV.y * 59.0 + haze.time * 0.71) * 0.26;
  return emission * (0.035 + primaryPulse * 0.19 + secondaryPulse * 0.08) * irregularity * haze.fireGlowStrength;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let mask = plumeMask(input.uv);
  let phaseA = input.uv.y * 93.0 + haze.time * 2.15;
  let phaseB = input.uv.x * 71.0 - haze.time * 1.37;
  let phaseC = (input.uv.x + input.uv.y) * 137.0 + haze.time * 0.81;
  let wave = vec2<f32>(
    sin(phaseA) * 0.58 + sin(phaseC) * 0.28,
    cos(phaseB) * 0.36 + sin(phaseA * 0.61) * 0.18
  );
  let smoke = smokeMask(input.uv);
  let smokeTime = haze.time * haze.smokeSpeed;
  let smokeCurl = vec2<f32>(
    sin(input.uv.y * 31.0 - smokeTime * 2.3 + sin(input.uv.x * 19.0 + smokeTime) * 0.8),
    cos(input.uv.x * 37.0 + smokeTime * 1.4 + sin(input.uv.y * 23.0 - smokeTime) * 0.55) * 0.46
  );
  let screenOffset =
    wave * haze.strength * mask +
    smokeCurl * haze.smokeStrength * smoke +
    underwaterRippleOffset(input.uv);
  let sourceUV = screenToSourceUV(input.uv + screenOffset);
  var color = textureSample(sourceImage, sourceSampler, sourceUV).rgb;

  // Match the authored page grade while keeping the refraction itself colorless.
  let upperShade = mix(0.10, 0.25, smoothstep(0.0, 0.52, input.uv.y));
  let lowerShade = mix(upperShade, 0.64, smoothstep(0.52, 1.0, input.uv.y));
  let waterColumn = smoothstep(0.02, 0.98, input.uv.y);
  color *= mix(vec3<f32>(0.82, 0.96, 1.04), vec3<f32>(0.64, 0.82, 0.91), waterColumn * 0.58);
  color += vec3<f32>(0.004, 0.032, 0.052) * (1.0 - waterColumn * 0.46);
  color = mix(color, vec3<f32>(0.019, 0.027, 0.067), lowerShade);
  color += colorAwareFireGlow(sourceUV);
  color += colorAwareLavaFlow(sourceUV);
  color += vec3<f32>(0.10, 0.52, 0.64) * underwaterCaustics(input.uv) * haze.causticsStrength;
  color += godRayScatter(input.uv);
  return vec4<f32>(color, 1.0);
}
`;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Project a point in authored-image UV space into the backdrop viewport.
 * Keep this in sync with the landing page's background-size breakpoints.
 */
export function projectImagePointToViewport(
  imageUV,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
  imageAspect = 1.5,
) {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  const mobile = width <= 720;
  const displayHeight = mobile ? 860 : Math.max(width, 1500) / imageAspect;
  const displayWidth = mobile ? displayHeight * imageAspect : Math.max(width, 1500);
  const cropX = Math.max(0, (displayWidth - width) * 0.5);
  const sourceScaleX = width / displayWidth;
  const sourceScaleY = height / displayHeight;
  const sourceOffsetX = cropX / displayWidth;

  return {
    displayWidth,
    displayHeight,
    sourceScaleX,
    sourceScaleY,
    sourceOffsetX,
    x: imageUV[0] * displayWidth - cropX,
    y: imageUV[1] * displayHeight,
  };
}

async function assertShaderCompiles(shaderModule) {
  if (typeof shaderModule.getCompilationInfo !== 'function') return;
  const info = await shaderModule.getCompilationInfo();
  const errors = info.messages.filter((message) => message.type === 'error');
  if (errors.length) {
    throw new Error(errors.map((message) => `${message.lineNum}:${message.linePos} ${message.message}`).join('\n'));
  }
}

export class ImageHeatHazePass {
  constructor(canvas, options = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('ImageHeatHazePass requires a canvas');
    this.canvas = canvas;
    this.deviceInput = options.gpuDevice || options.device || null;
    this.deviceOwnership = options.deviceOwnership || options.ownership || null;
    this.ownsDevice = options.ownsDevice === true;
    this.gpuProfile = options.profile || 'baseline-render';
    this.acquireDeviceLease = typeof options.acquireDeviceLease === 'function'
      ? options.acquireDeviceLease
      : acquireGpuDeviceForConsumer;
    this.fetchResource = typeof options.fetchResource === 'function'
      ? options.fetchResource
      : (...args) => fetch(...args);
    this.createBitmap = typeof options.createBitmap === 'function'
      ? options.createBitmap
      : (...args) => createImageBitmap(...args);
    this.deviceLease = null;
    this.imageUrl = options.imageUrl;
    this.lightTextureUrl = options.lightTextureUrl ?? null;
    this.strength = options.strength ?? 0.0042;
    this.smokeStrength = options.smokeStrength ?? 0.0064;
    this.smokeSpeed = options.smokeSpeed ?? 0.42;
    this.godRayStrength = options.godRayStrength ?? 0.026;
    this.godRaySpeed = options.godRaySpeed ?? 0.18;
    this.waterRippleStrength = options.waterRippleStrength ?? 0.00115;
    this.waterRippleSpeed = options.waterRippleSpeed ?? 0.36;
    this.causticsStrength = options.causticsStrength ?? 0.018;
    this.fireGlowStrength = options.fireGlowStrength ?? 0.24;
    this.lightingOpacity = 1;
    this.targetFrameMs = 1000 / (options.targetFps ?? 30);
    this.ventImageUV = options.ventImageUV ?? [0.604, 0.565];
    this.plumeRadius = options.plumeRadius ?? [0.15, 0.37];
    this.maxPixelRatio = options.maxPixelRatio ?? 1.5;
    this.frameRequest = 0;
    this.running = false;
    this.motionPaused = false;
    this.destroyed = false;
    this.initialized = false;
    this.lifecycleEpoch = 0;
    this.initPromise = null;
    this.initAbortController = null;
    this.failed = false;
    this.firstFrameSettled = false;
    this.firstFrameValidationPending = false;
    this.startedAt = 0;
    this.lastRenderedAt = 0;
    this.uniformData = new Float32Array(24);
    this.onFailure = typeof options.onFailure === 'function' ? options.onFailure : null;
    this.firstFrame = new Promise((resolve, reject) => {
      this.resolveFirstFrame = resolve;
      this.rejectFirstFrame = reject;
    });
    // Destruction must settle firstFrame even when a caller only observes init().
    this.firstFrame.catch(() => {});
    this.onResize = () => this.resize();
    this.onVisibility = () => {
      if (document.hidden) this.stop();
      else if (!this.motionPaused) this.start();
    };
  }

  init() {
    if (this.destroyed) return Promise.reject(this.createLifecycleError());
    if (this.initialized) return Promise.resolve(this);
    if (this.initPromise) return this.initPromise;

    const lifecycleEpoch = ++this.lifecycleEpoch;
    const initPromise = this.initialize(lifecycleEpoch);
    this.initPromise = initPromise;
    const clearInitPromise = () => {
      if (this.initPromise === initPromise) this.initPromise = null;
    };
    initPromise.then(clearInitPromise, (error) => {
      clearInitPromise();
      if (!this.firstFrameSettled) {
        this.firstFrameSettled = true;
        this.firstFrameValidationPending = false;
        this.rejectFirstFrame(error);
      }
    });
    return initPromise;
  }

  isLifecycleCurrent(lifecycleEpoch) {
    return !this.destroyed && lifecycleEpoch === this.lifecycleEpoch;
  }

  createLifecycleError() {
    const error = new Error('ImageHeatHazePass initialization was revoked by destroy()');
    error.code = 'IMAGE_HEAT_HAZE_LIFECYCLE_REVOKED';
    return error;
  }

  assertLifecycleCurrent(lifecycleEpoch) {
    if (!this.isLifecycleCurrent(lifecycleEpoch)) throw this.createLifecycleError();
  }

  async initialize(lifecycleEpoch) {
    this.assertLifecycleCurrent(lifecycleEpoch);
    if (!navigator.gpu) throw new Error('WebGPU is unavailable');
    if (!this.imageUrl) throw new Error('ImageHeatHazePass requires imageUrl');

    const candidateDeviceLease = await this.acquireDeviceLease({
      ownerId: 'image-heat-haze',
      device: this.deviceInput,
      ownership: this.deviceOwnership,
      ownsDevice: this.ownsDevice,
      profile: this.gpuProfile,
      label: 'ImageHeatHaze.device',
    });
    if (!this.isLifecycleCurrent(lifecycleEpoch)) {
      candidateDeviceLease?.release?.();
      throw this.createLifecycleError();
    }
    this.deviceLease = candidateDeviceLease;
    this.device = candidateDeviceLease.device;
    this.context = this.canvas.getContext('webgpu');
    if (!this.context) throw new Error('Could not create a WebGPU canvas context');

    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });

    this.initAbortController = new AbortController();
    const fetchOptions = { signal: this.initAbortController.signal };
    const [response, lightResponse] = await Promise.all([
      this.fetchResource(this.imageUrl, fetchOptions),
      this.lightTextureUrl ? this.fetchResource(this.lightTextureUrl, fetchOptions) : Promise.resolve(null),
    ]);
    this.assertLifecycleCurrent(lifecycleEpoch);
    this.initAbortController = null;
    if (!response.ok) throw new Error(`Backdrop request failed with HTTP ${response.status}`);
    if (lightResponse && !lightResponse.ok) {
      throw new Error(`God-ray texture request failed with HTTP ${lightResponse.status}`);
    }
    const imageBlob = await response.blob();
    this.assertLifecycleCurrent(lifecycleEpoch);
    const candidateBitmap = await this.createBitmap(imageBlob);
    if (!this.isLifecycleCurrent(lifecycleEpoch)) {
      candidateBitmap?.close?.();
      throw this.createLifecycleError();
    }
    this.bitmap = candidateBitmap;

    let candidateLightBitmap = null;
    if (lightResponse) {
      const lightBlob = await lightResponse.blob();
      this.assertLifecycleCurrent(lifecycleEpoch);
      candidateLightBitmap = await this.createBitmap(lightBlob);
      if (!this.isLifecycleCurrent(lifecycleEpoch)) {
        candidateLightBitmap?.close?.();
        throw this.createLifecycleError();
      }
    }
    this.lightBitmap = candidateLightBitmap;
    const device = this.device;
    device.pushErrorScope('validation');
    let uploadError = null;
    let uploadCompletion = Promise.resolve();
    try {
      this.imageTexture = this.device.createTexture({
        label: 'ImageHeatHaze.source',
        size: [this.bitmap.width, this.bitmap.height, 1],
        format: 'rgba8unorm-srgb',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.device.queue.copyExternalImageToTexture(
        { source: this.bitmap },
        { texture: this.imageTexture },
        [this.bitmap.width, this.bitmap.height]
      );
      this.lightTexture = this.device.createTexture({
        label: 'ImageHeatHaze.godRayBreakup',
        size: [this.lightBitmap?.width ?? 1, this.lightBitmap?.height ?? 1, 1],
        format: 'rgba8unorm-srgb',
        // Dawn validates copyExternalImageToTexture destinations as renderable
        // textures on Windows, even though this texture is sampled afterward.
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      if (this.lightBitmap) {
        this.device.queue.copyExternalImageToTexture(
          { source: this.lightBitmap },
          { texture: this.lightTexture },
          [this.lightBitmap.width, this.lightBitmap.height],
        );
      } else {
        this.device.queue.writeTexture(
          { texture: this.lightTexture },
          new Uint8Array([255, 255, 255, 255]),
          { bytesPerRow: 4 },
          { width: 1, height: 1, depthOrArrayLayers: 1 },
        );
      }
      uploadCompletion = device.queue.onSubmittedWorkDone();
    } catch (error) {
      uploadError = error;
    }
    // Pop synchronously after encoding/submission. The returned promise may
    // settle later, but this consumer no longer occupies the device-global
    // error-scope stack while other shared-device work runs.
    const uploadValidationPromise = device.popErrorScope();
    try {
      await uploadCompletion;
    } catch (error) {
      if (!uploadError) uploadError = error;
    }
    let uploadValidationError = null;
    try {
      uploadValidationError = await uploadValidationPromise;
    } catch (error) {
      if (!uploadError) uploadError = error;
    }
    this.assertLifecycleCurrent(lifecycleEpoch);
    if (uploadError) throw uploadError;
    if (uploadValidationError) {
      throw new Error(`Image texture upload failed: ${uploadValidationError.message}`);
    }

    const shaderModule = device.createShaderModule({
      label: 'ImageHeatHaze.shader',
      code: IMAGE_HEAT_HAZE_WGSL,
    });
    await assertShaderCompiles(shaderModule);
    this.assertLifecycleCurrent(lifecycleEpoch);
    const pipeline = await device.createRenderPipelineAsync({
      label: 'ImageHeatHaze.pipeline',
      layout: 'auto',
      vertex: { module: shaderModule, entryPoint: 'vs_main' },
      fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.assertLifecycleCurrent(lifecycleEpoch);
    this.pipeline = pipeline;
    this.uniformBuffer = this.device.createBuffer({
      label: 'ImageHeatHaze.uniforms',
      size: this.uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.sampler = this.device.createSampler({
      label: 'ImageHeatHaze.sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.lightSampler = this.device.createSampler({
      label: 'ImageHeatHaze.godRaySampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
    });
    this.bindGroup = this.device.createBindGroup({
      label: 'ImageHeatHaze.bindGroup',
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.imageTexture.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: this.lightTexture.createView() },
        { binding: 4, resource: this.lightSampler },
      ],
    });

    this.resize();
    window.addEventListener('resize', this.onResize, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    device.lost.then((info) => {
      if (!this.isLifecycleCurrent(lifecycleEpoch) || this.device !== device) return;
      this.fail(new Error(`WebGPU device lost: ${info.message || info.reason}`));
    });
    this.canvas.dataset.waterOptics = 'separate-webgpu';
    this.canvas.dataset.godRayTexture = this.lightBitmap ? 'authored-animated' : 'procedural';
    this.initialized = true;
    console.info(`[ImageHeatHazePass] layered water optics ready ${this.bitmap.width}x${this.bitmap.height}`);
    return this;
  }

  resize() {
    if (!this.device) return;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    this.canvas.width = Math.round(width * pixelRatio);
    this.canvas.height = Math.round(height * pixelRatio);

    const imageAspect = this.bitmap.width / this.bitmap.height;
    const projection = projectImagePointToViewport(
      this.ventImageUV,
      width,
      height,
      imageAspect,
    );

    this.uniformData[2] = width / height;
    this.uniformData[3] = imageAspect;
    this.uniformData[4] = projection.sourceScaleX;
    this.uniformData[5] = projection.sourceScaleY;
    this.uniformData[6] = projection.sourceOffsetX;
    this.uniformData[7] = 0;
    this.uniformData[8] = projection.x / width;
    this.uniformData[9] = projection.y / height;
    this.uniformData[10] = this.plumeRadius[0];
    this.uniformData[11] = this.plumeRadius[1];
    this.uniformData[12] = this.smokeStrength;
    this.uniformData[13] = this.smokeSpeed;
    this.uniformData[14] = this.godRayStrength * this.lightingOpacity;
    this.uniformData[15] = this.godRaySpeed;
    this.uniformData[16] = this.waterRippleStrength;
    this.uniformData[17] = this.waterRippleSpeed;
    this.uniformData[18] = this.causticsStrength * this.lightingOpacity;
    this.uniformData[19] = 0;
    this.uniformData[20] = this.fireGlowStrength * this.lightingOpacity;
    this.uniformData[21] = 0;
    this.uniformData[22] = 0;
    this.uniformData[23] = 0;
  }

  render = (timestamp) => {
    if (!this.running || !this.device) return;
    const lifecycleEpoch = this.lifecycleEpoch;
    const device = this.device;
    if (timestamp - this.lastRenderedAt < this.targetFrameMs) {
      if (this.isLifecycleCurrent(lifecycleEpoch)) {
        this.frameRequest = requestAnimationFrame(this.render);
      }
      return;
    }
    this.lastRenderedAt = timestamp;
    if (!this.startedAt) this.startedAt = timestamp;
    this.uniformData[0] = (timestamp - this.startedAt) * 0.001;
    this.uniformData[1] = this.strength;
    const validateFirstFrame = !this.firstFrameSettled && !this.firstFrameValidationPending;
    if (validateFirstFrame) {
      this.firstFrameValidationPending = true;
      device.pushErrorScope('validation');
    }

    try {
      device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
      const encoder = device.createCommandEncoder({ label: 'ImageHeatHaze.encoder' });
      const pass = encoder.beginRenderPass({
        label: 'ImageHeatHaze.renderPass',
        colorAttachments: [{
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.019, g: 0.027, b: 0.067, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
    } catch (error) {
      if (validateFirstFrame) {
        device.popErrorScope().catch(() => {});
      }
      this.fail(error);
      return;
    }

    if (validateFirstFrame) {
      // Close the device-global scope before awaiting queue completion. Late
      // settlement observes only this already-popped scope promise.
      const validationPromise = device.popErrorScope();
      device.queue.onSubmittedWorkDone()
        .then(() => validationPromise)
        .then((validationError) => {
          if (!this.isLifecycleCurrent(lifecycleEpoch)
            || this.device !== device
            || this.firstFrameSettled) return;
          if (validationError) throw new Error(`First WebGPU frame failed: ${validationError.message}`);
          this.firstFrameSettled = true;
          this.firstFrameValidationPending = false;
          this.resolveFirstFrame(this);
          if (this.running) this.frameRequest = requestAnimationFrame(this.render);
        })
        .catch((error) => {
          if (this.isLifecycleCurrent(lifecycleEpoch) && this.device === device) this.fail(error);
        });
      return;
    }
    if (this.isLifecycleCurrent(lifecycleEpoch)) {
      this.frameRequest = requestAnimationFrame(this.render);
    }
  };

  fail(error) {
    if (this.failed || this.destroyed) return;
    this.failed = true;
    this.stop();
    this.canvas.dataset.waterOptics = 'failed';
    if (!this.firstFrameSettled) {
      this.firstFrameSettled = true;
      this.firstFrameValidationPending = false;
      this.rejectFirstFrame(error);
    }
    console.error('[ImageHeatHazePass] renderer stopped; authored artwork retained.', error);
    this.onFailure?.(error);
  }

  start() {
    if (this.running || !this.device || this.failed || this.destroyed || this.motionPaused || document.hidden) return;
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

  /** Fades scene lighting while preserving refraction, ripples, and heat flow. */
  setLightingOpacity(value) {
    this.lightingOpacity = clamp(Number(value) || 0, 0, 1);
    this.uniformData[14] = this.godRayStrength * this.lightingOpacity;
    this.uniformData[18] = this.causticsStrength * this.lightingOpacity;
    this.uniformData[20] = this.fireGlowStrength * this.lightingOpacity;
    this.canvas.dataset.lightingOpacity = this.lightingOpacity.toFixed(3);
  }

  destroy() {
    if (this.destroyed) return false;
    this.destroyed = true;
    this.initialized = false;
    this.lifecycleEpoch += 1;
    this.initAbortController?.abort?.();
    this.initAbortController = null;
    this.stop();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    try { this.imageTexture?.destroy?.(); } catch (_) {}
    try { this.lightTexture?.destroy?.(); } catch (_) {}
    try { this.uniformBuffer?.destroy?.(); } catch (_) {}
    try { this.bitmap?.close?.(); } catch (_) {}
    try { this.lightBitmap?.close?.(); } catch (_) {}
    try { this.context?.unconfigure?.(); } catch (_) {}
    try { this.deviceLease?.release?.(); } catch (_) {}
    if (!this.firstFrameSettled) {
      this.firstFrameSettled = true;
      this.firstFrameValidationPending = false;
      this.rejectFirstFrame(this.createLifecycleError());
    }
    this.imageTexture = null;
    this.lightTexture = null;
    this.uniformBuffer = null;
    this.bitmap = null;
    this.lightBitmap = null;
    this.pipeline = null;
    this.sampler = null;
    this.lightSampler = null;
    this.bindGroup = null;
    this.context = null;
    this.deviceLease = null;
    this.device = null;
    return true;
  }
}

export async function startImageHeatHaze(canvas, options = {}) {
  const pass = new ImageHeatHazePass(canvas, options);
  try {
    await pass.init();
    pass.start();
    await pass.firstFrame;
    return pass;
  } catch (error) {
    pass.destroy();
    throw error;
  }
}
