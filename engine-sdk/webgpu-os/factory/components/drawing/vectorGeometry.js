// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { lineLineIntersection, closestPointOnSegment } from '../../../../engine/core/math/MathGeometry.js';
import { flattenVectorPath, vectorTransformPoint } from './vectorModel.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const point = value => ({ x: value.x, y: value.y });

/** Inbound command edges, with contour-local endpoints; never bridge two M commands. */
export function vectorEdges(item, tolerance = .01) {
  if (item?.type !== 'path') return [];
  const edges = []; let current = null, start = null, contourId = null;
  for (const command of item.commands) {
    if (command.type === 'M') { current = start = command; contourId = command.contourId; continue; }
    if (!current) continue;
    const end = command.type === 'Z' ? start : command;
    const local = { ...item, commands: [{ type: 'M', x: current.x, y: current.y }, command.type === 'Z' ? { type: 'L', x: end.x, y: end.y } : command] };
    const points = flattenVectorPath(local, tolerance), lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths.at(-1) + distance(points[i - 1], points[i]));
    edges.push({ itemId: item.id, edgeId: command.edgeId, contourId, fromNodeId: current.nodeId, toNodeId: end.nodeId, points, lengths, length: lengths.at(-1), command });
    current = end;
  }
  return edges;
}

/** t is normalized arc length, not a curve's polynomial parameter. */
export function pointOnVectorEdge(edge, t = .5) {
  if (!edge || !Number.isFinite(t) || t < 0 || t > 1) throw new TypeError('Edge position must be a fraction from 0 to 1');
  const at = t * edge.length;
  for (let i = 1; i < edge.points.length; i++) {
    if (at > edge.lengths[i] && i < edge.points.length - 1) continue;
    const a = edge.points[i - 1], b = edge.points[i], span = edge.lengths[i] - edge.lengths[i - 1];
    const fraction = span > 0 ? (at - edge.lengths[i - 1]) / span : 0;
    return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
  }
  return point(edge.points[0]);
}

/** References fail visibly when deleted. There is no nearest-node repair or index fallback. */
export function resolveVectorReference(model, reference, { tolerance = .01 } = {}) {
  const item = model?.items?.find(value => value.id === reference?.itemId);
  if (!item || item.type !== 'path') return { status: 'orphan', issue: 'Referenced piece no longer exists', reference };
  if (reference.nodeId) {
    const command = item.commands.find(value => value.nodeId === reference.nodeId);
    if (!command) return { status: 'orphan', issue: 'Referenced point no longer exists', reference };
    return { status: 'resolved', point: vectorTransformPoint(item, command), reference };
  }
  const edge = vectorEdges(item, tolerance).find(value => value.edgeId === reference.edgeId);
  if (!edge) return { status: 'orphan', issue: 'Referenced edge no longer exists', reference };
  return { status: 'resolved', point: pointOnVectorEdge(edge, reference.t ?? .5), edge, reference };
}

/** Compound closed contours retain holes in the original fill rule, independent of winding. */
export function vectorContours(item, tolerance = .01) {
  if (item?.type !== 'path') return [];
  const contours = []; let commands = [];
  const flush = () => {
    if (!commands.length) return;
    const points = flattenVectorPath({ ...item, commands }, tolerance);
    const closed = commands.at(-1).type === 'Z';
    const signedArea = closed ? points.reduce((area, p, i) => i ? area + points[i - 1].x * p.y - p.x * points[i - 1].y : area, 0) / 2 : null;
    contours.push({ id: commands[0].contourId, points, closed, signedArea, fillRule: item.fillRule ?? 'nonzero' });
  };
  for (const command of item.commands) { if (command.type === 'M') { flush(); commands = []; } commands.push(command); }
  flush(); return contours;
}

/** Snap radius is supplied in document units by the viewport, so physical geometry never rounds. */
export function snapVectorPoint(model, input, { radius = 2, tolerance = .01, kinds = ['endpoint', 'midpoint', 'intersection', 'path'], excludeItemIds = [], excludeNodeRefs = [] } = {}) {
  if (![input?.x, input?.y, radius, tolerance].every(Number.isFinite) || radius <= 0 || tolerance <= 0) throw new TypeError('Invalid geometry snap query');
  const candidates = [], nearby = [];
  const excluded = (itemId, nodeId) => excludeNodeRefs.some(ref => ref.itemId === itemId && ref.nodeId === nodeId);
  const add = (p, kind, reference, extra = {}) => { const d = distance(p, input); if (d <= radius) candidates.push({ point: point(p), kind, reference, distance: d, tolerance, ...extra }); };
  for (const item of model.items) {
    if (item.type !== 'path' || item.visible === false || excludeItemIds.includes(item.id)) continue;
    if (kinds.includes('endpoint')) for (const command of item.commands) if (command.type !== 'Z' && !excluded(item.id, command.nodeId)) {
      add(vectorTransformPoint(item, command), 'endpoint', { itemId: item.id, nodeId: command.nodeId });
    }
    for (const edge of vectorEdges(item, tolerance)) {
      if (excluded(item.id, edge.fromNodeId) || excluded(item.id, edge.toNodeId)) continue;
      if (kinds.includes('midpoint')) add(pointOnVectorEdge(edge), 'midpoint', { itemId: item.id, edgeId: edge.edgeId, t: .5 });
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1], b = edge.points[i];
        const closest = closestPointOnSegment([input.x, input.y, 0], [a.x, a.y, 0], [b.x, b.y, 0]);
        const p = { x: closest[0], y: closest[1] };
        if (distance(p, input) > radius) continue;
        const reference = { itemId: item.id, edgeId: edge.edgeId, t: edge.length ? (edge.lengths[i - 1] + distance(a, p)) / edge.length : 0 };
        if (kinds.includes('path')) add(p, 'path', reference);
        if (kinds.includes('intersection')) nearby.push({ a, b, edge, offset: edge.lengths[i - 1], reference });
      }
    }
  }
  if (nearby.length > 2000) throw new RangeError('Too many nearby edges; zoom in to resolve this snap');
  if (kinds.includes('intersection')) for (let i = 0; i < nearby.length; i++) for (let j = i + 1; j < nearby.length; j++) {
    const a = nearby[i], b = nearby[j];
    if (a.edge.itemId === b.edge.itemId && a.edge.edgeId === b.edge.edgeId) continue;
    const hit = lineLineIntersection([a.a.x, a.a.y], [a.b.x, a.b.y], [b.a.x, b.a.y], [b.b.x, b.b.y]);
    if (!hit) continue;
    const p = { x: hit[0], y: hit[1] }, ref = segment => ({ itemId: segment.edge.itemId, edgeId: segment.edge.edgeId, t: segment.edge.length ? (segment.offset + distance(segment.a, p)) / segment.edge.length : 0 });
    add(p, 'intersection', ref(a), { relatedReferences: [ref(a), ref(b)] });
  }
  const rank = { endpoint: 0, intersection: 1, midpoint: 2, path: 3 };
  candidates.sort((a, b) => rank[a.kind] - rank[b.kind] || a.distance - b.distance);
  return candidates[0] ?? { point: point(input), kind: null, reference: null, distance: 0, tolerance };
}

/** An oriented ruler is resolved from persistent references, never screen pixels. */
export function resolveRulerFrame(model, frame) {
  if (!frame) return null;
  const origin = resolveVectorReference(model, frame.origin), axis = resolveVectorReference(model, frame.axis);
  if (origin.status !== 'resolved' || axis.status !== 'resolved') return { status: 'orphan', issue: 'The ruler origin or direction was removed' };
  const length = distance(origin.point, axis.point);
  if (length < 1e-9) return { status: 'invalid', issue: 'Choose two distinct ruler anchors' };
  return { status: 'resolved', origin: origin.point, direction: { x: (axis.point.x - origin.point.x) / length, y: (axis.point.y - origin.point.y) / length }, label: String(frame.label || 'Piece ruler') };
}

export function pointInRulerFrame(input, frame) {
  if (frame?.status !== 'resolved') throw new TypeError('A resolved ruler frame is required');
  const x = input.x - frame.origin.x, y = input.y - frame.origin.y, d = frame.direction;
  return { x: x * d.x + y * d.y, y: -x * d.y + y * d.x };
}
