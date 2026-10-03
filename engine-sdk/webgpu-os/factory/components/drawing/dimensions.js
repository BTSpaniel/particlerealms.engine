// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { formatPhysicalLength } from './measurement.js';
import { resolveVectorReference, pointOnVectorEdge } from './vectorGeometry.js';

export const VECTOR_DIMENSION_KINDS = Object.freeze(['linear', 'horizontal', 'vertical', 'path', 'angle', 'offset']);
const length = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const at = (p, x, y) => ({ x: p.x + x, y: p.y + y });
const segment = (a, b) => [{ type: 'M', ...a }, { type: 'L', ...b }];

function pathRange(edge, from, to) {
  if (![from, to].every(Number.isFinite) || Math.min(from, to) < 0 || Math.max(from, to) > 1 || from === to) throw new TypeError('Choose a nonempty edge interval between 0 and 1');
  const low = Math.min(from, to), high = Math.max(from, to);
  const points = [pointOnVectorEdge(edge, low)];
  for (let i = 1; i < edge.points.length - 1; i++) if (edge.lengths[i] > low * edge.length && edge.lengths[i] < high * edge.length) points.push(edge.points[i]);
  points.push(pointOnVectorEdge(edge, high));
  return from <= to ? points : points.reverse();
}

function resolveDimension(model, definition, tolerance) {
  if (!definition || typeof definition.id !== 'string' || !definition.id || !VECTOR_DIMENSION_KINDS.includes(definition.kind)) throw new TypeError('Invalid attached dimension definition');
  if (definition.offset != null && !Number.isFinite(definition.offset)) throw new TypeError('Dimension offset must be finite');
  const resolve = ref => { const found = resolveVectorReference(model, ref, { tolerance }); if (found.status !== 'resolved') throw new Error(found.issue); return found; };
  let anchors, path = null, value;
  if (definition.kind === 'path') {
    if (!Array.isArray(definition.edgeRefs) || !definition.edgeRefs.length || definition.edgeRefs.length > 10000) throw new TypeError('A path measurement needs one or more edge references');
    path = []; value = 0;
    for (const ref of definition.edgeRefs) {
      const found = resolve(ref); if (!found.edge) throw new TypeError('Curve measurements require edges');
      const from = ref.from ?? 0, to = ref.to ?? 1, points = pathRange(found.edge, from, to);
      if (path.length && length(path.at(-1), points[0]) > tolerance) throw new Error('Measured edges are disconnected or ordered in the wrong direction');
      value += found.edge.length * Math.abs(to - from); path.push(...(path.length ? points.slice(1) : points));
    }
    anchors = [path[0], path.at(-1)];
  } else {
    const count = definition.kind === 'angle' ? 3 : 2;
    if (!Array.isArray(definition.anchors) || definition.anchors.length !== count) throw new TypeError(`This measurement needs ${count} attached anchors`);
    anchors = definition.anchors.map(ref => resolve(ref).point);
    const [a, b, c] = anchors;
    if (definition.kind === 'horizontal') value = Math.abs(b.x - a.x);
    else if (definition.kind === 'vertical') value = Math.abs(b.y - a.y);
    else if (definition.kind === 'angle') {
      if (length(a, b) < tolerance || length(b, c) < tolerance) throw new Error('Angle legs must have a measurable length');
      const cross = (a.x - b.x) * (c.y - b.y) - (a.y - b.y) * (c.x - b.x);
      const dot = (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y);
      value = Math.abs(Math.atan2(cross, dot)) * 180 / Math.PI;
    } else value = length(a, b);
  }
  return { id: definition.id, status: 'resolved', kind: definition.kind, value, unit: definition.kind === 'angle' ? 'deg' : model.unit,
    ...(model.unit === 'mm' && definition.kind !== 'angle' ? { valueMm: value } : {}), anchors, path,
    readOnly: !definition.driver, driver: definition.driver ?? null, definition };
}

function dimensionArtwork(result, model, index, occupied) {
  const def = result.definition, scale = model.unit === 'px' ? 4 : 1, offset = def.offset ?? 10 * scale;
  const commands = []; let labelPoint;
  const arrow = (p, dx, dy) => {
    const size = 1.6 * scale, span = Math.hypot(dx, dy); if (span < 1e-12) return;
    const x = dx / span, y = dy / span;
    commands.push(...segment(at(p, x * size - y * size * .4, y * size + x * size * .4), p), ...segment(p, at(p, x * size + y * size * .4, y * size - x * size * .4)));
  };
  if (result.kind === 'angle') {
    const [a, b, c] = result.anchors, start = Math.atan2(a.y - b.y, a.x - b.x);
    let sweep = Math.atan2(c.y - b.y, c.x - b.x) - start;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    const radius = Math.max(3 * scale, Math.abs(offset));
    for (let i = 0; i <= 24; i++) commands.push({ type: i ? 'L' : 'M', x: b.x + Math.cos(start + sweep * i / 24) * radius, y: b.y + Math.sin(start + sweep * i / 24) * radius });
    labelPoint = at(b, Math.cos(start + sweep / 2) * (radius + 4 * scale), Math.sin(start + sweep / 2) * (radius + 4 * scale));
  } else if (result.kind === 'path') {
    result.path.forEach((p, i) => commands.push({ type: i ? 'L' : 'M', x: p.x, y: p.y }));
    const midpoint = result.path[Math.floor(result.path.length / 2)];
    labelPoint = at(midpoint, 0, -Math.abs(offset));
    commands.push(...segment(midpoint, labelPoint));
  } else {
    const [a, b] = result.anchors, span = length(a, b);
    let first, second;
    if (result.kind === 'horizontal') { first = { x: a.x, y: Math.min(a.y, b.y) - offset }; second = { x: b.x, y: first.y }; }
    else if (result.kind === 'vertical') { first = { x: Math.max(a.x, b.x) + offset, y: a.y }; second = { x: first.x, y: b.y }; }
    else { const dx = span ? -(b.y - a.y) / span * offset : 0, dy = span ? (b.x - a.x) / span * offset : -offset; first = at(a, dx, dy); second = at(b, dx, dy); }
    commands.push(...segment(a, first), ...segment(b, second), ...segment(first, second));
    arrow(first, second.x - first.x, second.y - first.y); arrow(second, first.x - second.x, first.y - second.y);
    labelPoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 - 2 * scale };
  }
  const formatted = result.unit === 'deg' ? `${Number(result.value.toFixed(2))}°` : model.unit === 'mm'
    ? formatPhysicalLength(result.value, { unit: def.unit ?? 'mm', precision: def.precision ?? 2 }) : `${Number(result.value.toFixed(2))} px`;
  const text = `${def.label ? `${def.label}: ` : ''}${formatted}`;
  const fontSize = 3.5 * scale, width = text.length * fontSize * .58;
  labelPoint.x -= width / 2;
  // Deterministic label placement. A leader makes displaced labels unambiguous.
  const initial = { ...labelPoint };
  for (let attempt = 0; attempt < occupied.length + 1; attempt++) {
    if (!occupied.some(box => labelPoint.x < box.x + box.width && labelPoint.x + width > box.x && Math.abs(labelPoint.y - box.y) < fontSize * 1.4)) break;
    labelPoint.y -= fontSize * 1.6;
  }
  occupied.push({ ...labelPoint, width });
  if (labelPoint.y !== initial.y) commands.push(...segment(initial, labelPoint));
  const metadata = { role: 'dimension', dimensionId: result.id, readOnly: result.readOnly };
  return [
    { id: `dimension-${index}-lines`, type: 'path', name: def.label || formatted, commands, stroke: '#495b68', strokeWidth: .22 * scale, fill: 'none', locked: true, metadata },
    { id: `dimension-${index}-label`, type: 'text', name: text, text, x: labelPoint.x, y: labelPoint.y, fontSize, fill: '#243645', stroke: 'none', locked: true, metadata },
  ];
}

/** Return printable vector annotations and diagnostics without mutating the document. */
export function resolveVectorDimensions(model, { dimensions = model.dimensions ?? [], tolerance = .01 } = {}) {
  if (!Array.isArray(dimensions) || dimensions.length > 2000 || !Number.isFinite(tolerance) || tolerance <= 0) throw new TypeError('Invalid dimensions or tolerance');
  const resolved = [], issues = [], items = [], ids = new Set(), occupied = [], itemIds = new Set(model.items.map(item => item.id));
  dimensions.forEach((definition, index) => {
    try {
      if (ids.has(definition?.id)) throw new TypeError('Dimension IDs must be unique');
      ids.add(definition?.id);
      const result = resolveDimension(model, definition, tolerance);
      const artwork = dimensionArtwork(result, model, index, occupied);
      for (const item of artwork) {
        const base = item.id; let suffix = 0;
        while (itemIds.has(item.id)) item.id = `${base}-${++suffix}`;
        itemIds.add(item.id);
      }
      items.push(...artwork); resolved.push(result);
    } catch (error) {
      const issue = { dimensionId: definition?.id ?? null, status: 'unresolved', message: error.message };
      issues.push(issue); resolved.push({ id: definition?.id ?? null, status: 'unresolved', value: null, issue: error.message, readOnly: true });
    }
  });
  return { dimensions: resolved, issues, items };
}
