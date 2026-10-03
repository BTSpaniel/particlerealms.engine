// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathRect2.js - 2D Axis-Aligned Bounding Box / Rectangle (Godot Rect2 / Three.js Box2 parity)
// Rect represented as { minX, minY, maxX, maxY }
// Consolidates: MathGeometry.pointInRect/rectRect, workflow-canvas bounding box logic

// ============================================================================
// CREATION
// ============================================================================

export const rect2Create = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });

export const rect2FromCenterSize = (cx, cy, w, h) => ({
  minX: cx - w * 0.5, minY: cy - h * 0.5,
  maxX: cx + w * 0.5, maxY: cy + h * 0.5,
});

export const rect2FromPositionSize = (x, y, w, h) => ({
  minX: x, minY: y, maxX: x + w, maxY: y + h,
});

export function rect2FromPoints(points) {
  if (points.length === 0) return rect2Create(0, 0, 0, 0);
  let minX = points[0][0], minY = points[0][1];
  let maxX = minX, maxY = minY;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

export const rect2Zero = () => ({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
export const rect2Clone = (r) => ({ minX: r.minX, minY: r.minY, maxX: r.maxX, maxY: r.maxY });
export const rect2Copy = (out, r) => { out.minX = r.minX; out.minY = r.minY; out.maxX = r.maxX; out.maxY = r.maxY; return out; };

// ============================================================================
// QUERY
// ============================================================================

export const rect2CenterX = (r) => (r.minX + r.maxX) * 0.5;
export const rect2CenterY = (r) => (r.minY + r.maxY) * 0.5;
export const rect2Center = (r) => [(r.minX + r.maxX) * 0.5, (r.minY + r.maxY) * 0.5];
export const rect2Width = (r) => r.maxX - r.minX;
export const rect2Height = (r) => r.maxY - r.minY;
export const rect2Size = (r) => [r.maxX - r.minX, r.maxY - r.minY];
export const rect2Area = (r) => (r.maxX - r.minX) * (r.maxY - r.minY);
export const rect2Perimeter = (r) => 2 * ((r.maxX - r.minX) + (r.maxY - r.minY));
export const rect2AspectRatio = (r) => { const h = r.maxY - r.minY; return h === 0 ? 0 : (r.maxX - r.minX) / h; };
export const rect2IsEmpty = (r) => r.maxX <= r.minX || r.maxY <= r.minY;
export const rect2IsFinite = (r) => Number.isFinite(r.minX) && Number.isFinite(r.minY) && Number.isFinite(r.maxX) && Number.isFinite(r.maxY);

// ============================================================================
// TESTS
// ============================================================================

export const rect2ContainsPoint = (r, x, y) =>
  x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;

export const rect2ContainsPointV = (r, p) =>
  p[0] >= r.minX && p[0] <= r.maxX && p[1] >= r.minY && p[1] <= r.maxY;

export const rect2ContainsRect = (outer, inner) =>
  inner.minX >= outer.minX && inner.maxX <= outer.maxX &&
  inner.minY >= outer.minY && inner.maxY <= outer.maxY;

export const rect2IntersectsRect = (a, b) =>
  a.minX <= b.maxX && a.maxX >= b.minX &&
  a.minY <= b.maxY && a.maxY >= b.minY;

// ============================================================================
// MODIFY
// ============================================================================

export const rect2ExpandPoint = (r, x, y) => ({
  minX: Math.min(r.minX, x), minY: Math.min(r.minY, y),
  maxX: Math.max(r.maxX, x), maxY: Math.max(r.maxY, y),
});

export const rect2ExpandPointV = (r, p) => rect2ExpandPoint(r, p[0], p[1]);

export const rect2Merge = (a, b) => ({
  minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
});

export const rect2Grow = (r, amount) => ({
  minX: r.minX - amount, minY: r.minY - amount,
  maxX: r.maxX + amount, maxY: r.maxY + amount,
});

export const rect2GrowV = (r, ax, ay) => ({
  minX: r.minX - ax, minY: r.minY - ay,
  maxX: r.maxX + ax, maxY: r.maxY + ay,
});

export const rect2Translate = (r, dx, dy) => ({
  minX: r.minX + dx, minY: r.minY + dy,
  maxX: r.maxX + dx, maxY: r.maxY + dy,
});

export const rect2Scale = (r, sx, sy) => {
  const cx = (r.minX + r.maxX) * 0.5, cy = (r.minY + r.maxY) * 0.5;
  const hw = (r.maxX - r.minX) * 0.5 * sx, hh = (r.maxY - r.minY) * 0.5 * (sy !== undefined ? sy : sx);
  return { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh };
};

// ============================================================================
// CLAMP
// ============================================================================

export const rect2ClampPoint = (r, x, y) => [
  Math.max(r.minX, Math.min(r.maxX, x)),
  Math.max(r.minY, Math.min(r.maxY, y)),
];

export const rect2ClampPointV = (r, p) => rect2ClampPoint(r, p[0], p[1]);

// ============================================================================
// INTERSECTION (overlapping region)
// ============================================================================

export function rect2Intersection(a, b) {
  const minX = Math.max(a.minX, b.minX);
  const minY = Math.max(a.minY, b.minY);
  const maxX = Math.min(a.maxX, b.maxX);
  const maxY = Math.min(a.maxY, b.maxY);
  if (maxX < minX || maxY < minY) return null;
  return { minX, minY, maxX, maxY };
}

// ============================================================================
// DISTANCE
// ============================================================================

export function rect2DistanceToPoint(r, x, y) {
  const cx = Math.max(r.minX, Math.min(r.maxX, x));
  const cy = Math.max(r.minY, Math.min(r.maxY, y));
  const dx = x - cx, dy = y - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

export const rect2DistanceToPointV = (r, p) => rect2DistanceToPoint(r, p[0], p[1]);

// ============================================================================
// CORNERS
// ============================================================================

export const rect2GetCorners = (r) => [
  [r.minX, r.minY], [r.maxX, r.minY],
  [r.maxX, r.maxY], [r.minX, r.maxY],
];

// ============================================================================
// COMPARISON
// ============================================================================

export const rect2Equals = (a, b) =>
  a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;

export function rect2ApproxEquals(a, b, eps = 1e-6) {
  return Math.abs(a.minX - b.minX) < eps && Math.abs(a.minY - b.minY) < eps &&
    Math.abs(a.maxX - b.maxX) < eps && Math.abs(a.maxY - b.maxY) < eps;
}
