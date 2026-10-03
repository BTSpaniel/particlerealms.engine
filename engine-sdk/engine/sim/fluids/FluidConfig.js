// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const DEFAULT_FLUID_GRID_SIZE = [64, 64, 64];

export function normalizeFluidGridSize(input) {
  const fallback = DEFAULT_FLUID_GRID_SIZE;
  const src = Array.isArray(input) ? input : fallback;

  const x = Number(src[0]);
  const y = Number(src[1]);
  const z = Number(src[2]);

  const gx = Number.isFinite(x) && x > 0 ? (x | 0) : fallback[0];
  const gy = Number.isFinite(y) && y > 0 ? (y | 0) : fallback[1];
  const gz = Number.isFinite(z) && z > 0 ? (z | 0) : fallback[2];

  return [gx, gy, gz];
}
