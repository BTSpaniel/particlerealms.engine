// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { GpuDevice } from './GpuDevice.js';

export const GPU_DEVICE_OWNERSHIP_POLICIES = Object.freeze({
  SHARED_KERNEL: 'shared-kernel',
  DEDICATED_OWNED: 'dedicated-owned',
  STANDALONE_FALLBACK: 'standalone-fallback',
  DIAGNOSTIC_TEMPORARY: 'diagnostic-temporary',
  WORKER_OWNED: 'worker-owned',
});

const OWNERSHIP_VALUES = new Set(Object.values(GPU_DEVICE_OWNERSHIP_POLICIES));

export function normalizeGpuDeviceOwnership(value, hasInjectedDevice = false) {
  const ownership = value || (hasInjectedDevice
    ? GPU_DEVICE_OWNERSHIP_POLICIES.SHARED_KERNEL
    : GPU_DEVICE_OWNERSHIP_POLICIES.STANDALONE_FALLBACK);
  if (!OWNERSHIP_VALUES.has(ownership)) {
    throw new TypeError(`Unknown GPU device ownership policy '${ownership}'`);
  }
  return ownership;
}

function unwrapGpuDevice(value) {
  if (!value) return null;
  if (typeof value.getDevice === 'function') return value.getDevice();
  return value;
}

/**
 * Acquire an explicit consumer lease. Injected devices are always preferred;
 * standalone acquisition is owned by this lease and is the only path that may
 * destroy its GPUDevice during release.
 */
export async function acquireGpuDeviceForConsumer(options = {}) {
  const ownerId = String(options.ownerId || '').trim();
  if (!ownerId) throw new TypeError('GPU consumer ownerId is required');

  const injected = options.gpuDevice || options.device || null;
  const ownership = normalizeGpuDeviceOwnership(options.ownership, Boolean(injected));
  const explicitlyOwned = options.ownsDevice === true;
  if (ownership === GPU_DEVICE_OWNERSHIP_POLICIES.SHARED_KERNEL && explicitlyOwned) {
    throw new Error('A shared-kernel GPU device cannot be consumer-owned');
  }
  if (!injected && ownership === GPU_DEVICE_OWNERSHIP_POLICIES.SHARED_KERNEL) {
    const error = new Error(`GPU consumer '${ownerId}' requires an injected shared-kernel device`);
    error.code = 'GPU_SHARED_DEVICE_REQUIRED';
    throw error;
  }

  let gpuDevice = injected && typeof injected.getDevice === 'function' ? injected : null;
  let device = unwrapGpuDevice(injected);
  let ownsDevice = explicitlyOwned;
  if (!device) {
    gpuDevice = await GpuDevice.create({
      profile: options.profile || 'baseline-render',
      label: options.label || ownerId,
      adapterOptions: options.adapterOptions,
      requiredFeatures: options.requiredFeatures,
      optionalFeatures: options.optionalFeatures,
      requiredLimits: options.requiredLimits,
    });
    device = gpuDevice.getDevice();
    ownsDevice = true;
  }
  if (!device || gpuDevice?.lost || gpuDevice?.destroyed) {
    const error = new Error(`GPU consumer '${ownerId}' received an unavailable device`);
    error.code = 'GPU_DEVICE_UNAVAILABLE';
    throw error;
  }

  let released = false;
  const release = () => {
    if (released) return false;
    released = true;
    if (ownsDevice) {
      if (gpuDevice && typeof gpuDevice.destroy === 'function') gpuDevice.destroy();
      else if (typeof device.destroy === 'function') device.destroy();
    }
    return true;
  };
  return Object.freeze({
    ownerId,
    ownership,
    ownsDevice,
    gpuDevice,
    device,
    adapter: gpuDevice?.getAdapter?.() ?? null,
    generation: gpuDevice?.generation ?? options.generation ?? 0,
    get released() { return released; },
    release,
  });
}
