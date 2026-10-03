// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { normalizeFluidGridSize, DEFAULT_FLUID_GRID_SIZE } from "./FluidConfig.js";

export function createFluidCpuWorld(options = {}) {
  const grid = normalizeFluidGridSize(options.gridSize || DEFAULT_FLUID_GRID_SIZE);
  const gridSizeX = grid[0];
  const gridSizeY = grid[1];
  const gridSizeZ = grid[2];
  const cellCount = gridSizeX * gridSizeY * gridSizeZ;
  const velocity = new Float32Array(cellCount * 3);
  const density = new Float32Array(cellCount);
  return {
    gridSizeX,
    gridSizeY,
    gridSizeZ,
    cellCount,
    velocity,
    density,
    time: 0,
  };
}

export function destroyFluidCpuWorld(world) {
  if (!world) {
    return;
  }
  world.velocity = null;
  world.density = null;
}

function index3D(world, x, y, z) {
  const gx = world.gridSizeX;
  const gy = world.gridSizeY;
  return x + y * gx + z * gx * gy;
}

export function stepFluidCpuWorld(world, deltaSeconds) {
  if (!world) {
    return;
  }
  const dt = Number(deltaSeconds);
  if (!Number.isFinite(dt) || dt <= 0) {
    return;
  }
  world.time += dt;

  const gx = world.gridSizeX | 0;
  const gy = world.gridSizeY | 0;
  const gz = world.gridSizeZ | 0;
  const vel = world.velocity;
  const dens = world.density;
  const damping = 0.98;
  const t = world.time;

  for (let z = 0; z < gz; z++) {
    const cz = z - gz * 0.5;
    for (let y = 0; y < gy; y++) {
      const cy = y - gy * 0.5;
      for (let x = 0; x < gx; x++) {
        const cx = x - gx * 0.5;
        const idx = index3D(world, x, y, z);
        const base = idx * 3;

        let vx = vel[base + 0];
        let vy = vel[base + 1];
        let vz = vel[base + 2];

        const swirlScale = 0.3;
        const sx = -cy * swirlScale;
        const sz = cx * swirlScale;
        vx += sx * dt;
        vz += sz * dt;

        const wave = Math.sin((cx + t) * 0.3) * 0.1;
        vy += wave * dt;

        vx *= damping;
        vy *= damping;
        vz *= damping;

        vel[base + 0] = vx;
        vel[base + 1] = vy;
        vel[base + 2] = vz;

        dens[idx] *= damping;
      }
    }
  }
}

export function applyFluidSourcesCpu(world, options = {}) {
  if (!world) {
    return;
  }
  const sources = Array.isArray(options.sources) ? options.sources : [];
  if (sources.length === 0) {
    return;
  }

  const worldMin = Array.isArray(options.worldMin) ? options.worldMin : [-10, -10, -10];
  const worldMax = Array.isArray(options.worldMax) ? options.worldMax : [10, 10, 10];

  const gx = world.gridSizeX | 0;
  const gy = world.gridSizeY | 0;
  const gz = world.gridSizeZ | 0;
  const vel = world.velocity;
  const dens = world.density;

  const sizeX = worldMax[0] - worldMin[0] || 1;
  const sizeY = worldMax[1] - worldMin[1] || 1;
  const sizeZ = worldMax[2] - worldMin[2] || 1;

  for (let s = 0; s < sources.length; s++) {
    const src = sources[s];
    const pos = Array.isArray(src.position) ? src.position : [0, 0, 0];
    const radiusValue = Number(src.radius);
    const strengthValue = Number(src.strength);
    const radius = Number.isFinite(radiusValue) && radiusValue > 0 ? radiusValue : 0;
    const strength = Number.isFinite(strengthValue) ? strengthValue : 0;
    if (radius <= 0 || strength === 0) {
      continue;
    }

    const nx = (pos[0] - worldMin[0]) / sizeX;
    const ny = (pos[1] - worldMin[1]) / sizeY;
    const nz = (pos[2] - worldMin[2]) / sizeZ;

    const cx = Math.max(0, Math.min(gx - 1, Math.round(nx * (gx - 1))));
    const cy = Math.max(0, Math.min(gy - 1, Math.round(ny * (gy - 1))));
    const cz = Math.max(0, Math.min(gz - 1, Math.round(nz * (gz - 1))));

    const cellsPerWorldX = gx / sizeX;
    const cellsPerWorldY = gy / sizeY;
    const cellsPerWorldZ = gz / sizeZ;
    const radiusCells = Math.max(
      1,
      Math.round(
        Math.max(
          radius * cellsPerWorldX,
          radius * cellsPerWorldY,
          radius * cellsPerWorldZ
        )
      )
    );
    const r2 = radiusCells * radiusCells;

    for (let dz = -radiusCells; dz <= radiusCells; dz++) {
      const z = cz + dz;
      if (z < 0 || z >= gz) {
        continue;
      }
      for (let dy = -radiusCells; dy <= radiusCells; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= gy) {
          continue;
        }
        for (let dx = -radiusCells; dx <= radiusCells; dx++) {
          const x = cx + dx;
          if (x < 0 || x >= gx) {
            continue;
          }
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > r2) {
            continue;
          }

          const idx = index3D(world, x, y, z);
          const base = idx * 3;
          const dist = Math.sqrt(d2);
          const t = 1 - dist / radiusCells;
          const falloff = t * t;

          dens[idx] += strength * falloff;

          if (dist > 0.0001) {
            const invDist = 1 / dist;
            const scale = strength * falloff * 0.1;
            vel[base + 0] += dx * invDist * scale;
            vel[base + 1] += dy * invDist * scale;
            vel[base + 2] += dz * invDist * scale;
          }
        }
      }
    }
  }
}
