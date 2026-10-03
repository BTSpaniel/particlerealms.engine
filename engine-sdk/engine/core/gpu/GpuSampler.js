// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const samplerCache = new WeakMap();

function getDeviceCache(device) {
  let entry = samplerCache.get(device);
  if (!entry) {
    entry = {};
    samplerCache.set(device, entry);
  }
  return entry;
}

export function getDefaultSampler(device) {
  const cache = getDeviceCache(device);
  if (cache.defaultSampler) {
    return cache.defaultSampler;
  }

  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    addressModeW: "clamp-to-edge",
  });

  cache.defaultSampler = sampler;
  return sampler;
}

export function getPointSampler(device) {
  const cache = getDeviceCache(device);
  if (cache.pointSampler) {
    return cache.pointSampler;
  }

  const sampler = device.createSampler({
    magFilter: "nearest",
    minFilter: "nearest",
    mipmapFilter: "nearest",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    addressModeW: "clamp-to-edge",
  });

  cache.pointSampler = sampler;
  return sampler;
}

export function getLinearSampler(device) {
  const cache = getDeviceCache(device);
  if (cache.linearSampler) {
    return cache.linearSampler;
  }

  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "linear",
    addressModeU: "repeat",
    addressModeV: "repeat",
    addressModeW: "repeat",
  });

  cache.linearSampler = sampler;
  return sampler;
}
