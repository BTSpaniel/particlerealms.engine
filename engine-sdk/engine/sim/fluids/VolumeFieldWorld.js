// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createStorageBuffer, destroyBuffers } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

function normalizeGridSize(gridSize) {
  if (!Array.isArray(gridSize) || gridSize.length < 3) {
    return [128, 128, 128];
  }
  const x = Math.max(1, gridSize[0] | 0);
  const y = Math.max(1, gridSize[1] | 0);
  const z = Math.max(1, gridSize[2] | 0);
  return [x, y, z];
}

export async function createVolumeFieldWorld(gpuDevice, options = {}) {
  if (!gpuDevice || typeof gpuDevice.getDevice !== "function") {
    throw new Error("createVolumeFieldWorld: gpuDevice (GpuDevice) is required");
  }

  const device = gpuDevice.getDevice();
  if (!device) {
    throw new Error("createVolumeFieldWorld: gpuDevice.getDevice() returned null");
  }

  const gridSize = normalizeGridSize(options.gridSize);
  const gridSizeX = gridSize[0];
  const gridSizeY = gridSize[1];
  const gridSizeZ = gridSize[2];

  const cellCount = gridSizeX * gridSizeY * gridSizeZ;
  if (!Number.isFinite(cellCount) || cellCount <= 0) {
    throw new Error("createVolumeFieldWorld: invalid grid size");
  }

  const scalarByteSize = cellCount * 4;
  const colorByteSize = cellCount * 16;

  const densityBuffer = createStorageBuffer(device, scalarByteSize, {
    label: "VolumeFieldWorld.density",
  });
  const colorBuffer = createStorageBuffer(device, colorByteSize, {
    label: "VolumeFieldWorld.color",
  });

  const tempDensityBuffer = createStorageBuffer(device, scalarByteSize, {
    label: "VolumeFieldWorld.tempDensity",
  });
  const tempColorBuffer = createStorageBuffer(device, colorByteSize, {
    label: "VolumeFieldWorld.tempColor",
  });

  labelResource(densityBuffer, "VolumeFieldWorld.density");
  labelResource(colorBuffer, "VolumeFieldWorld.color");
  labelResource(tempDensityBuffer, "VolumeFieldWorld.tempDensity");
  labelResource(tempColorBuffer, "VolumeFieldWorld.tempColor");

  return {
    gpuDevice,
    device,
    gridSizeX,
    gridSizeY,
    gridSizeZ,
    cellCount,
    densityBuffer,
    colorBuffer,
    tempDensityBuffer,
    tempColorBuffer,
    scalarByteSize,
    colorByteSize,
    worldMin: null,
    worldMax: null,
  };
}

export function destroyVolumeFieldWorld(world) {
  if (!world) return;
  destroyBuffers([world.densityBuffer, world.colorBuffer, world.tempDensityBuffer, world.tempColorBuffer]);
  world.densityBuffer = null;
  world.colorBuffer = null;
  world.tempDensityBuffer = null;
  world.tempColorBuffer = null;
}
