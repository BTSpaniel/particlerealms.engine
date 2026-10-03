// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { morton2DEncode } from '../math/MathBits.js';

/** Focus-first, deterministic Morton tile order shared by progressive views.
 * Every output pixel belongs to exactly one clipped tile. Scheduling and
 * source-generation ownership remain with the caller. */
export function planProgressiveTiles(width, height, options = {}) {
  const safeWidth = Math.max(1, Math.floor(Number(width) || 1));
  const safeHeight = Math.max(1, Math.floor(Number(height) || 1));
  const tileSize = Math.max(16, Math.min(512, Math.floor(Number(options.tileSize) || 64)));
  const columns = Math.ceil(safeWidth / tileSize);
  const rows = Math.ceil(safeHeight / tileSize);
  const rawFocusX = Number(options.focusX);
  const rawFocusY = Number(options.focusY);
  const focusX = Math.max(0, Math.min(1, Number.isFinite(rawFocusX) ? rawFocusX : .5));
  const focusY = Math.max(0, Math.min(1, Number.isFinite(rawFocusY) ? rawFocusY : .5));
  const focusPixelX = Math.min(safeWidth - 1, Math.floor(focusX * safeWidth));
  const focusPixelY = Math.min(safeHeight - 1, Math.floor(focusY * safeHeight));
  const focusColumn = Math.floor(focusPixelX / tileSize);
  const focusRow = Math.floor(focusPixelY / tileSize);
  const tiles = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * tileSize;
      const y = row * tileSize;
      const tileWidth = Math.min(tileSize, safeWidth - x);
      const tileHeight = Math.min(tileSize, safeHeight - y);
      const dx = column - focusColumn;
      const dy = row - focusRow;
      tiles.push({
        x,
        y,
        width: tileWidth,
        height: tileHeight,
        column,
        row,
        ring: Math.max(Math.abs(dx), Math.abs(dy)),
        distance: Math.hypot(dx, dy),
        morton: morton2DEncode(column, row) >>> 0,
      });
    }
  }

  tiles.sort((a, b) => a.ring - b.ring || a.distance - b.distance || a.morton - b.morton);
  return tiles;
}

