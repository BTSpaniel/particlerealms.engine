// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const NEXEL_FRAME_UNIFORM_BYTES = 128;

export function finiteNexelNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clampNexelNumber(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function checkedNexelU32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`${label} must be an unsigned 32-bit integer`);
  }
  return value >>> 0;
}

export function finiteNexelVector(value, length, label) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length < length) {
    throw new TypeError(`${label} must provide ${length} finite values`);
  }
  const result = Array.from(value).slice(0, length).map(Number);
  if (!result.every(Number.isFinite)) throw new TypeError(`${label} must provide ${length} finite values`);
  return result;
}

export function packNexelRgba8(color) {
  if (Number.isInteger(color) && color >= 0 && color <= 0xffffffff) return color >>> 0;
  const values = finiteNexelVector(color || [0.35, 0.9, 1, 1], 3, 'Nexel cluster color');
  const alpha = color?.length >= 4 ? finiteNexelNumber(color[3], 1) : 1;
  const channel = value => Math.round(clampNexelNumber(value, 0, 1) * 255) & 0xff;
  return (channel(values[0]) | (channel(values[1]) << 8) | (channel(values[2]) << 16)
    | (channel(alpha) << 24)) >>> 0;
}

export function nextNexelCapacity(required, maximum) {
  let capacity = 1;
  while (capacity < required && capacity < maximum) capacity *= 2;
  return Math.min(Math.max(1, capacity), maximum);
}

export async function assertNexelShaderCompiles(module, label) {
  if (typeof module?.getCompilationInfo !== 'function') return;
  const info = await module.getCompilationInfo();
  const errors = (info?.messages || []).filter(message => message.type === 'error');
  if (errors.length > 0) {
    throw new Error(`${label} shader compilation failed:\n${errors.map(error => (
      `${error.lineNum || 0}:${error.linePos || 0} ${error.message}`
    )).join('\n')}`);
  }
}

export function writeNexelFrameUniforms(target, {
  camera,
  viewport,
  time,
  frameCount,
  quality,
  pointGain,
  projectionScale,
  opacity,
} = {}) {
  if (!(target instanceof Float32Array) || target.byteLength !== NEXEL_FRAME_UNIFORM_BYTES) {
    throw new RangeError('Nexel frame uniform target must be exactly 128 bytes');
  }
  const matrix = finiteNexelVector(
    camera?.viewProjectionMatrix || camera?.viewProjection || camera?.mvp,
    16,
    'Nexel cluster view-projection matrix',
  );
  const right = finiteNexelVector(camera?.right || [1, 0, 0], 3, 'Nexel cluster camera right');
  const up = finiteNexelVector(camera?.up || [0, 1, 0], 3, 'Nexel cluster camera up');
  const width = Math.max(1, Math.floor(finiteNexelNumber(viewport?.width, 1)));
  const height = Math.max(1, Math.floor(finiteNexelNumber(viewport?.height, 1)));
  target.set(matrix, 0);
  target.set([right[0], right[1], right[2], 0], 16);
  target.set([up[0], up[1], up[2], 0], 20);
  target.set([width, height, finiteNexelNumber(time), finiteNexelNumber(frameCount)], 24);
  target.set([
    finiteNexelNumber(quality, 1),
    finiteNexelNumber(pointGain, 0.036),
    finiteNexelNumber(projectionScale, 0.48),
    clampNexelNumber(finiteNexelNumber(opacity, 1), 0, 1),
  ], 28);
  return Object.freeze({ width, height });
}

export function createNexelOverlayPassDescriptor(label, target, depthFormat) {
  if (!target?.colorView) throw new TypeError(`${label} requires target.colorView`);
  if (depthFormat && !target.depthView) throw new TypeError(`${label} requires target.depthView`);
  return {
    label,
    colorAttachments: [{
      view: target.colorView,
      loadOp: 'load',
      storeOp: target.colorStoreOp || 'store',
    }],
    ...(depthFormat ? {
      depthStencilAttachment: {
        view: target.depthView,
        depthLoadOp: 'load',
        depthStoreOp: target.depthStoreOp || 'store',
      },
    } : {}),
  };
}

export default Object.freeze({
  NEXEL_FRAME_UNIFORM_BYTES,
  assertNexelShaderCompiles,
  checkedNexelU32,
  clampNexelNumber,
  createNexelOverlayPassDescriptor,
  finiteNexelNumber,
  finiteNexelVector,
  nextNexelCapacity,
  packNexelRgba8,
  writeNexelFrameUniforms,
});
