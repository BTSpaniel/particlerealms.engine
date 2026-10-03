// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const metrics = {
  buffersCreated: 0,
  bufferBytesAllocated: 0,
  bufferByUsage: {
    vertex: { count: 0, bytes: 0 },
    index: { count: 0, bytes: 0 },
    uniform: { count: 0, bytes: 0 },
    storage: { count: 0, bytes: 0 },
    staging: { count: 0, bytes: 0 },
    other: { count: 0, bytes: 0 },
  },
  texturesCreated: 0,
  texturePixelsAllocated: 0,
};

export function recordBufferCreate(byteSize, usageKind = "other") {
  const size =
    typeof byteSize === "number" && Number.isFinite(byteSize) && byteSize > 0
      ? Math.floor(byteSize)
      : 0;

  const key = Object.prototype.hasOwnProperty.call(metrics.bufferByUsage, usageKind)
    ? usageKind
    : "other";

  metrics.buffersCreated += 1;
  metrics.bufferBytesAllocated += size;

  const bucket = metrics.bufferByUsage[key];
  bucket.count += 1;
  bucket.bytes += size;
}

export function recordTextureCreate(width, height) {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  metrics.texturesCreated += 1;
  metrics.texturePixelsAllocated += w * h;
}

export function getGpuMetrics() {
  return {
    buffersCreated: metrics.buffersCreated,
    bufferBytesAllocated: metrics.bufferBytesAllocated,
    bufferByUsage: {
      vertex: { ...metrics.bufferByUsage.vertex },
      index: { ...metrics.bufferByUsage.index },
      uniform: { ...metrics.bufferByUsage.uniform },
      storage: { ...metrics.bufferByUsage.storage },
      staging: { ...metrics.bufferByUsage.staging },
      other: { ...metrics.bufferByUsage.other },
    },
    texturesCreated: metrics.texturesCreated,
    texturePixelsAllocated: metrics.texturePixelsAllocated,
  };
}

export function resetGpuMetrics() {
  metrics.buffersCreated = 0;
  metrics.bufferBytesAllocated = 0;
  metrics.bufferByUsage.vertex.count = 0;
  metrics.bufferByUsage.vertex.bytes = 0;
  metrics.bufferByUsage.index.count = 0;
  metrics.bufferByUsage.index.bytes = 0;
  metrics.bufferByUsage.uniform.count = 0;
  metrics.bufferByUsage.uniform.bytes = 0;
  metrics.bufferByUsage.storage.count = 0;
  metrics.bufferByUsage.storage.bytes = 0;
  metrics.bufferByUsage.staging.count = 0;
  metrics.bufferByUsage.staging.bytes = 0;
  metrics.bufferByUsage.other.count = 0;
  metrics.bufferByUsage.other.bytes = 0;
  metrics.texturesCreated = 0;
  metrics.texturePixelsAllocated = 0;
}
