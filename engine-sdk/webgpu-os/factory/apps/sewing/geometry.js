// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { flattenVectorPath, vectorPathLength, normalizeVectorModel } from '../../components/drawing/index.js';
import { pointInPolygon2D } from '../../../../engine/core/math/MathGeometry.js';

const EPS = 1e-7;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const SEAM_TOLERANCE_MM = 0.05;

export function pathItem(id, name, commands, metadata = {}) {
  return { id, name, type: 'path', commands, stroke: '#172933', strokeWidth: .35, fill: 'none', visible: true,
    locked: false, transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, metadata };
}

export function polygonPath(id, name, points, metadata = {}) {
  return pathItem(id, name, [...points.map((p, index) => ({ type: index ? 'L' : 'M', x: p.x, y: p.y })), { type: 'Z' }], metadata);
}

export function polygonArea(points) {
  return points.reduce((sum, point, index) => sum + cross(point, points[(index + 1) % points.length]), 0) / 2;
}

function intersects(a, b, c, d) {
  const ab = sub(b, a), cd = sub(d, c), denom = cross(ab, cd), ac = sub(c, a);
  if (Math.abs(denom) < EPS) {
    if (Math.abs(cross(ac, ab)) > EPS) return false;
    const axis = Math.abs(ab.x) >= Math.abs(ab.y) ? 'x' : 'y';
    return Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) <= Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) + EPS;
  }
  const t = cross(ac, cd) / denom, u = cross(ac, ab) / denom;
  return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS;
}

export function validateContour(points) {
  const area = polygonArea(points);
  if (points.length < 3 || points.length > 20000 || !Number.isFinite(area) || Math.abs(area) < .01) throw new Error('A cutting contour must enclose a finite non-zero area');
  const edges = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || distance(a, b) < EPS) throw new Error('Contour has an invalid or zero-length edge');
    edges.push({ i, a, b, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) });
  }
  // Sweep on the less-overlapping axis; reject non-overlapping edge boxes
  // before exact intersections, avoiding all-pairs work for detailed curves.
  const width = Math.max(...edges.map(e => e.maxX)) - Math.min(...edges.map(e => e.minX));
  const height = Math.max(...edges.map(e => e.maxY)) - Math.min(...edges.map(e => e.minY));
  const xLoad = edges.reduce((n, e) => n + e.maxX - e.minX, 0) / Math.max(width, EPS);
  const yLoad = edges.reduce((n, e) => n + e.maxY - e.minY, 0) / Math.max(height, EPS);
  const [minKey, maxKey, otherMin, otherMax] = xLoad <= yLoad ? ['minX', 'maxX', 'minY', 'maxY'] : ['minY', 'maxY', 'minX', 'maxX'];
  edges.sort((a, b) => a[minKey] - b[minKey]);
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i];
    for (let j = i + 1; j < edges.length && edges[j][minKey] <= a[maxKey] + EPS; j++) {
      const b = edges[j], separation = Math.abs(a.i - b.i);
      if (separation === 1 || separation === points.length - 1 || a[otherMax] < b[otherMin] - EPS || b[otherMax] < a[otherMin] - EPS) continue;
      if (intersects(a.a, a.b, b.a, b.b)) throw new Error('Cutting contour intersects itself; correct the highlighted piece before export');
    }
  }
  return points;
}

export function closedContour(item) {
  if (item?.type !== 'path' || item.commands.at(-1)?.type !== 'Z' || item.commands.filter(c => c.type === 'M').length !== 1) {
    throw new Error('Select one closed, single-contour pattern piece');
  }
  const points = [];
  for (const { x, y } of flattenVectorPath(item, SEAM_TOLERANCE_MM)) {
    const point = { x, y };
    if (!points.length || distance(points.at(-1), point) >= EPS) points.push(point);
  }
  // SVG Z may follow an explicit L or C ending at the first point. Those
  // equivalent closures must not create a phantom zero-length cutting edge.
  while (points.length > 1 && distance(points[0], points.at(-1)) < EPS) points.pop();
  return validateContour(points);
}

/** Validate actual compound cutting boundaries without joining separate M contours. */
export function cuttingContours(item) {
  const parts = []; let commands = [];
  for (const command of item.commands || []) {
    if (command.type === 'M' && commands.length) { parts.push(closedContour({ ...item, commands })); commands = []; }
    commands.push(command);
  }
  if (commands.length) parts.push(closedContour({ ...item, commands }));
  if (!parts.length) throw new Error('A cutting piece needs a closed contour');
  let pairs = 0;
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const a = parts[i], b = parts[j];
    for (let x = 0; x < a.length; x++) for (let y = 0; y < b.length; y++) {
      if (++pairs > 2000000) throw new Error('Compound contour checks exceeded the geometry budget');
      if (intersects(a[x], a[(x + 1) % a.length], b[y], b[(y + 1) % b.length])) throw new Error('Cutting boundaries cross or touch; correct the opening before export');
    }
  }
  return parts;
}

/** Mitered polygon offset; ambiguous/narrow intersections fail instead of cutting. */
export function offsetContour(points, amount, { inward = false } = {}) {
  validateContour(points);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100) throw new Error('Seam allowance must be greater than 0 and at most 100 mm');
  const direction = Math.sign(polygonArea(points));
  const edges = points.map((a, i) => {
    const v = sub(points[(i + 1) % points.length], a), length = Math.hypot(v.x, v.y);
    const offset = inward ? -amount : amount;
    const n = { x: direction * v.y / length * offset, y: -direction * v.x / length * offset };
    return { p: { x: a.x + n.x, y: a.y + n.y }, v, n };
  });
  const result = points.map((point, index) => {
    const before = edges[(index + edges.length - 1) % edges.length], after = edges[index];
    const determinant = cross(before.v, after.v);
    if (Math.abs(determinant) < EPS) return { x: point.x + after.n.x, y: point.y + after.n.y };
    const t = cross(sub(after.p, before.p), after.v) / determinant;
    const intersection = { x: before.p.x + before.v.x * t, y: before.p.y + before.v.y * t };
    if (distance(intersection, point) > 8 * amount) throw new Error('Seam allowance produces an extreme corner; round or reshape that corner first');
    return intersection;
  });
  validateContour(result);
  if (Math.sign(polygonArea(result)) !== direction) throw new Error('Seam allowance collapses the piece');
  if (inward && (Math.abs(polygonArea(result)) >= Math.abs(polygonArea(points)) || result.some((p, i) => { const next = result[(i + 1) % result.length], edge = sub(points[(i + 1) % points.length], points[i]); return (next.x - p.x) * edge.x + (next.y - p.y) * edge.y <= 0; }))) throw new Error('Seam allowance collapses or reverses an opening edge');
  return result;
}

export function seamAllowance(item, amount) {
  const contours = cuttingContours(item), polygons = contours.map(points => points.map(p => [p.x, p.y]));
  const offsets = contours.map((points, index) => offsetContour(points, Number(amount), { inward: polygons.filter((polygon, i) => i !== index && pointInPolygon2D(polygons[index][0], polygon)).length % 2 === 1 }));
  const output = pathItem(`${item.id}-allowance`, `${item.name} — cut line`, offsets.flatMap((points, i) => polygonPath(`contour-${i}`, '', points).commands), { role: 'cut', sourceId: item.id, seamAllowanceMm: Number(amount) });
  if (contours.length > 1) output.fillRule = 'evenodd'; cuttingContours(output);
  output.stroke = '#0a867a'; output.locked = true;
  return output;
}

export function grainline(item, angle = 90) {
  angle = Number(angle);
  if (!Number.isFinite(angle)) throw new Error('Enter a finite grainline angle');
  const contours = cuttingContours(item), a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const projectedContours = contours.map(points => points.map(p => ({ u: p.x * c + p.y * s, v: -p.x * s + p.y * c })));
  const projected = projectedContours.flat();
  const min = Math.min(...projected.map(p => p.v)), max = Math.max(...projected.map(p => p.v));
  let best = null;
  // Odd/even scan-line intervals are inside even strongly concave pieces.
  // The bounded scan also avoids placing a skirt grainline in its waist cutout.
  for (let scan = 1; scan < 32; scan++) {
    const v = min + (max - min) * scan / 32, crossings = [];
    for (const boundary of projectedContours) for (let index = 0; index < boundary.length; index++) {
      const p = boundary[index], q = boundary[(index + 1) % boundary.length];
      if ((p.v <= v && q.v > v) || (q.v <= v && p.v > v)) crossings.push(p.u + (q.u - p.u) * (v - p.v) / (q.v - p.v));
    }
    crossings.sort((x, y) => x - y);
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const width = crossings[index + 1] - crossings[index];
      if (!best || width > best.width) best = { v, start: crossings[index] + width * .2, end: crossings[index + 1] - width * .2, width };
    }
  }
  if (!best || best.width <= EPS) throw new Error('This piece has no space for a grainline');
  const world = (u, v) => ({ x: u * c - v * s, y: u * s + v * c });
  const start = world(best.start, best.v), end = world(best.end, best.v);
  const commands = [{ type: 'M', ...start }, { type: 'L', ...end }];
  let arrow = Math.min(7, best.width * .1);
  const insideSegment = (p, q) => !contours.some(points => points.some((r, index) => intersects(p, q, r, points[(index + 1) % points.length])));
  while (arrow > EPS) {
    const left = world(best.end - Math.cos(.5) * arrow, best.v - Math.sin(.5) * arrow);
    const right = world(best.end - Math.cos(.5) * arrow, best.v + Math.sin(.5) * arrow);
    if (insideSegment(end, left) && insideSegment(end, right)) {
      commands.push({ type: 'M', ...left }, { type: 'L', ...end }, { type: 'L', ...right }); break;
    }
    arrow /= 2;
  }
  return pathItem(`${item.id}-grainline`, `${item.name} grainline`, commands, { role: 'grainline', sourceId: item.id, angle });
}

export function notch(item, atMm, depth = 3) {
  const points = closedContour(item), total = vectorPathLength(item, SEAM_TOLERANCE_MM);
  if (!Number.isFinite(atMm) || atMm < 0 || atMm >= total) throw new Error(`Notch distance must be between 0 and ${total.toFixed(1)} mm`);
  let remaining = atMm;
  for (let index = 0; index < points.length; index++) {
    const a = points[index], b = points[(index + 1) % points.length], length = distance(a, b);
    if (remaining <= length) {
      const t = remaining / length, p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const sign = Math.sign(polygonArea(points));
      return pathItem(`${item.id}-notch-${atMm}`, 'Notch', [{ type: 'M', ...p }, { type: 'L', x: p.x + sign * (b.y - a.y) / length * depth, y: p.y - sign * (b.x - a.x) / length * depth }],
        { role: 'notch', sourceId: item.id, atMm, depth });
    }
    remaining -= length;
  }
  throw new Error('Notch could not be placed');
}

/** Rebuild derived geometry after edits, keeping original inputs authoritative. */
export function refreshDerived(model) {
  const source = normalizeVectorModel(model), items = source.items.filter(item => !item.metadata?.sourceId);
  for (const item of source.items.filter(item => item.metadata?.sourceId)) {
    const parent = items.find(candidate => candidate.id === item.metadata.sourceId);
    if (!parent) continue;
    let derived;
    if (item.metadata.role === 'cut') derived = seamAllowance(parent, item.metadata.seamAllowanceMm);
    else if (item.metadata.role === 'grainline') derived = grainline(parent, item.metadata.angle);
    else if (item.metadata.role === 'notch') derived = notch(parent, item.metadata.atMm, item.metadata.depth);
    else { items.push(item); continue; }
    // Derived coordinates follow the source; user layer presentation does not.
    for (const field of ['id', 'name', 'visible', 'locked', 'stroke', 'fill', 'strokeWidth']) derived[field] = item[field];
    items.push(derived);
  }
  return { ...source, items };
}

/** Cut across a closed piece; retain both halves as explicit native pieces. */
export function slashAndSpread(item, { axis = 'y', position, distanceMm = 0, rotationDeg = 0 }) {
  if (!['x', 'y'].includes(axis) || ![position, distanceMm, rotationDeg].every(Number.isFinite)) throw new Error('Enter finite slash coordinates');
  const points = closedContour(item);
  const clip = sign => {
    const output = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const da = sign * (a[axis] - position), db = sign * (b[axis] - position);
      if (da >= -EPS) output.push({ ...a });
      if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
        const t = (position - a[axis]) / (b[axis] - a[axis]);
        output.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
      }
    }
    return validateContour(output);
  };
  const fixed = clip(-1), moving = clip(1), pivot = moving.find(point => Math.abs(point[axis] - position) < EPS);
  if (!pivot) throw new Error('Slash line does not cross the piece');
  const angle = rotationDeg * Math.PI / 180;
  const transformed = moving.map(point => {
    const p = sub(point, pivot), output = { x: pivot.x + p.x * Math.cos(angle) - p.y * Math.sin(angle), y: pivot.y + p.x * Math.sin(angle) + p.y * Math.cos(angle) };
    output[axis] += distanceMm;
    return output;
  });
  return [polygonPath(`${item.id}-fixed`, `${item.name} fixed`, fixed, { ...item.metadata, altered: true }),
    polygonPath(`${item.id}-spread`, `${item.name} spread`, validateContour(transformed), { ...item.metadata, altered: true })];
}

/** Lengthen a section while retaining its continuous outline (shortening may fail validation). */
export function lengthenPiece(item, axis, position, amount) {
  if (!['x', 'y'].includes(axis) || ![position, amount].every(Number.isFinite)) throw new Error('Enter finite alteration coordinates and distance');
  if (amount === 0) { closedContour(item); return structuredClone(item); }
  const pieces = slashAndSpread(item, { axis, position, distanceMm: 0, rotationDeg: 0 });
  const original = closedContour(item), result = [];
  for (let i = 0; i < original.length; i++) {
    const a = original[i], b = original[(i + 1) % original.length], p = { ...a };
    if (p[axis] > position) p[axis] += amount;
    result.push(p);
    if ((a[axis] < position && b[axis] > position) || (a[axis] > position && b[axis] < position)) {
      const t = (position - a[axis]) / (b[axis] - a[axis]), q = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      const shifted = { ...q, [axis]: q[axis] + amount };
      result.push(...(a[axis] < position ? [q, shifted] : [shifted, q]));
    }
  }
  if (!pieces.length) throw new Error('No altered section');
  return polygonPath(item.id, item.name, validateContour(result), { ...item.metadata, altered: true });
}
