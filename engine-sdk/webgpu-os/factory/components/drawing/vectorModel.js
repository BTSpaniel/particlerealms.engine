// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { CubicBezier } from '../../../../engine/core/math/BezierCurves.js';

export const VECTOR_SCHEMA = 'factory.vector.v1';
const KEYS = { M: ['x', 'y'], L: ['x', 'y'], C: ['x1', 'y1', 'x2', 'y2', 'x', 'y'], Z: [] };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const escapeXml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/** Basic 2D DXF from the retained drawing. Curves use an explicit source-unit tolerance. */
export function vectorModelToDxf(value, { tolerance = .05 } = {}) {
  const model = normalizeVectorModel(value);
  if (!finite(tolerance) || tolerance <= 0 || tolerance > 1) throw new RangeError('DXF curve tolerance must be greater than zero and at most one drawing unit');
  const lines = ['0','SECTION','2','HEADER','9','$ACADVER','1','AC1015','9','$INSUNITS','70',model.unit === 'mm' ? '4' : '0','0','ENDSEC','0','SECTION','2','ENTITIES'];
  const clean = text => String(text).replace(/[\r\n\u0000-\u001f]/g, ' ');
  for (const item of model.items) {
    if (!item.visible) continue;
    const layer = clean(item.metadata?.role || 'DRAWING').replace(/[^\w-]/g, '_').toUpperCase();
    if (item.type === 'text') {
      const p = vectorTransformPoint(item, item), t = item.transform;
      lines.push('0','TEXT','100','AcDbEntity','8',layer,'100','AcDbText','10',String(p.x),'20',String(-p.y),'40',String(item.fontSize * Math.abs(t.scaleY)),'1',clean(item.text),'50',String(-t.rotation),'41',String(Math.abs(t.scaleX / t.scaleY))); continue;
    }
    const contours = []; let commands = [];
    for (const command of item.commands) { if (command.type === 'M' && commands.length) { contours.push(commands); commands = []; } commands.push(command); }
    if (commands.length) contours.push(commands);
    for (const commands of contours) {
      const points = flattenVectorPath({ ...item, commands }, tolerance), closed = commands.at(-1).type === 'Z';
      if (closed && points.length > 1 && Math.hypot(points[0].x - points.at(-1).x, points[0].y - points.at(-1).y) < 1e-9) points.pop();
      if (points.length < 2) continue;
      lines.push('0','LWPOLYLINE','100','AcDbEntity','8',layer,'100','AcDbPolyline','90',String(points.length),'70',closed ? '1' : '0');
      for (const p of points) lines.push('10',String(p.x),'20',String(-p.y));
    }
  }
  return [...lines,'0','ENDSEC','0','EOF'].join('\r\n');
}

/** Reject malformed geometry instead of silently changing its physical size. */
export function validateVectorModel(model) {
  const errors = [];
  if (!model || model.schema !== VECTOR_SCHEMA) errors.push('Unsupported vector document schema');
  if (!['mm', 'px'].includes(model?.unit)) errors.push('Vector document unit must be mm or px');
  if (!Array.isArray(model?.items)) return [...errors, 'Vector document items must be an array'];
  if (model.items.length > 10000) errors.push('Vector document exceeds 10000 objects');
  const ids = new Set();
  for (const item of model.items) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) errors.push('Object IDs must be unique nonempty strings');
    ids.add(item?.id);
    if (item?.type === 'path') {
      if (!Array.isArray(item.commands) || item.commands.length > 100000 || item.commands[0]?.type !== 'M') {
        errors.push(`${item.id}: a path must start with M and contain at most 100000 commands`);
        continue;
      }
      const references = new Set();
      for (const command of item.commands) {
        const keys = KEYS[command?.type];
        if (!keys || keys.some(key => !finite(command[key]))) errors.push(`${item.id}: invalid path command`);
        for (const key of ['nodeId', 'edgeId', 'contourId']) if (command?.[key] != null) {
          if (typeof command[key] !== 'string' || !command[key] || command[key].length > 256 || references.has(command[key])) errors.push(`${item.id}: duplicate or invalid geometry reference`);
          references.add(command[key]);
        }
      }
      if (item.referenceSequence != null && (!Number.isSafeInteger(item.referenceSequence) || item.referenceSequence < 0)) errors.push(`${item.id}: invalid geometry reference sequence`);
      if (item.fillRule != null && !['nonzero', 'evenodd'].includes(item.fillRule)) errors.push(`${item.id}: unsupported fill rule`);
    } else if (item?.type === 'text') {
      if (![item.x, item.y, item.fontSize ?? 5].every(finite) || (item.fontSize ?? 5) <= 0 || typeof item.text !== 'string') errors.push(`${item.id}: invalid text object`);
    } else errors.push(`${item?.id}: unknown object type`);
    if (item?.strokeWidth != null && (!finite(item.strokeWidth) || item.strokeWidth < 0)) errors.push(`${item.id}: invalid stroke width`);
    for (const key of ['x', 'y', 'rotation', 'scaleX', 'scaleY']) {
      if (item?.transform?.[key] != null && !finite(item.transform[key])) errors.push(`${item.id}: invalid transform`);
    }
    if (item?.transform?.scaleX === 0 || item?.transform?.scaleY === 0) errors.push(`${item.id}: transform must be invertible`);
  }
  return errors;
}

export function normalizeVectorModel(value = { schema: VECTOR_SCHEMA, unit: 'mm', items: [] }) {
  const model = structuredClone(value);
  const errors = validateVectorModel(model);
  if (errors.length) throw new TypeError(errors.join('; '));
  model.items = model.items.map(item => ({
    ...item, name: String(item.name || item.id), visible: item.visible !== false, locked: item.locked === true,
    stroke: safePaint(item.stroke, '#17212b'), fill: safePaint(item.fill, 'none'), strokeWidth: item.strokeWidth ?? .35,
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, ...item.transform },
  }));
  for (const item of model.items) if (item.type === 'path') assignVectorReferences(item);
  return model;
}

/** Existing command IDs survive edits. The saved counter prevents deleted IDs being reused. */
export function assignVectorReferences(item) {
  if (item?.type !== 'path' || !Array.isArray(item.commands)) throw new TypeError('Geometry references require a path');
  let sequence = item.referenceSequence ?? 0;
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new TypeError('Invalid geometry reference sequence');
  const used = new Set(item.commands.flatMap(command => ['nodeId', 'edgeId', 'contourId'].map(key => command[key]).filter(Boolean)));
  const allocate = kind => { let id; do { if (sequence === Number.MAX_SAFE_INTEGER) throw new RangeError('Geometry reference sequence exhausted'); id = `${kind}${++sequence}`; } while (used.has(id)); used.add(id); return id; };
  for (const command of item.commands) {
    if (command.type !== 'Z') command.nodeId ??= allocate('n');
    if (command.type === 'M') command.contourId ??= allocate('c');
    else command.edgeId ??= allocate('e');
  }
  item.referenceSequence = sequence;
  return item;
}

function safePaint(value, fallback) {
  // No url(), external image, or CSS execution surfaces in native vector assets.
  return typeof value === 'string' && /^(?:none|#[0-9a-f]{3,8}|[a-z]{1,24}|rgba?\([\d\s.,%]+\))$/i.test(value) ? value : fallback;
}

export function vectorTransformPoint(item, point, inverse = false) {
  const t = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, ...item?.transform };
  const angle = t.rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  if (inverse) {
    const x = point.x - t.x, y = point.y - t.y;
    return { x: (x * c + y * s) / t.scaleX, y: (-x * s + y * c) / t.scaleY };
  }
  const x = point.x * t.scaleX, y = point.y * t.scaleY;
  return { x: x * c - y * s + t.x, y: x * s + y * c + t.y };
}

export function vectorPathData(item) {
  return item.commands.map(command => `${command.type}${KEYS[command.type].map(key => command[key]).join(' ')}`).join(' ');
}

/** Flatten in transformed document units. M starts a new contour (move:true). */
export function flattenVectorPath(item, tolerance = .1) {
  if (item?.type !== 'path') return [];
  if (!finite(tolerance) || tolerance <= 0) throw new RangeError('Tolerance must be positive');
  const points = [];
  let point = null, start = null;
  const append = (p, move = false) => points.push({ ...vectorTransformPoint(item, p), ...(move ? { move: true } : {}) });
  for (const command of item.commands) {
    if (command.type === 'M') { point = { x: command.x, y: command.y }; start = point; append(point, true); }
    if (command.type === 'L') { point = { x: command.x, y: command.y }; append(point); }
    if (command.type === 'Z' && start) { point = start; append(point); }
    if (command.type === 'C' && point) {
      const transformed = [point, { x: command.x1, y: command.y1 }, { x: command.x2, y: command.y2 }, command].map(p => vectorTransformPoint(item, p));
      const curve = new CubicBezier(...transformed.map(p => [p.x, p.y, 0]));
      flattenCurve(curve, tolerance, points, 0);
      point = { x: command.x, y: command.y };
    }
  }
  return points;
}

function flattenCurve(curve, tolerance, points, depth) {
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const polygon = distance(curve.p0, curve.p1) + distance(curve.p1, curve.p2) + distance(curve.p2, curve.p3);
  const chord = distance(curve.p0, curve.p3);
  if (polygon - chord <= tolerance || depth >= 22) {
    points.push({ x: curve.p3[0], y: curve.p3[1] });
    return;
  }
  const halves = curve.subdivide(.5);
  flattenCurve(halves[0], tolerance / 2, points, depth + 1);
  flattenCurve(halves[1], tolerance / 2, points, depth + 1);
}

export function vectorPathLength(item, tolerance = .1) {
  const points = flattenVectorPath(item, tolerance);
  return points.reduce((length, p, i) => length + (i && !p.move ? Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) : 0), 0);
}

let textMeasurementContext;
function textCorners(item) {
  const size = item.fontSize ?? 5;
  if (textMeasurementContext === undefined) {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : globalThis.document?.createElement?.('canvas');
    textMeasurementContext = canvas?.getContext('2d') ?? null;
  }
  const ctx = textMeasurementContext;
  if (ctx) ctx.font = `${size}px sans-serif`;
  const metrics = ctx?.measureText(item.text);
  const left = item.x - Math.max(0, metrics?.actualBoundingBoxLeft ?? 0);
  const right = item.x + Math.max(metrics?.width ?? item.text.length * size, metrics?.actualBoundingBoxRight ?? 0);
  const top = item.y - Math.max(size, metrics?.actualBoundingBoxAscent ?? size);
  const bottom = item.y + Math.max(size * .3, metrics?.actualBoundingBoxDescent ?? size * .3);
  return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }].map(p => vectorTransformPoint(item, p));
}

/** Conservative text extents include ascenders, descenders and object transforms. */
export function vectorModelBounds(model, padding = 5) {
  const points = model.items.filter(item => item.visible !== false).flatMap(item => item.type === 'path' ? flattenVectorPath(item) : textCorners(item));
  if (!points.length) return { x: 0, y: 0, width: 210, height: 297 };
  const extent = points.reduce((b, p) => ({ left: Math.min(b.left, p.x), top: Math.min(b.top, p.y), right: Math.max(b.right, p.x), bottom: Math.max(b.bottom, p.y) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  const x = extent.left - padding, y = extent.top - padding;
  return { x, y, width: Math.max(1, extent.right - x + padding), height: Math.max(1, extent.bottom - y + padding) };
}

export function vectorModelToSvg(value, { bounds = null, title = 'Vector drawing' } = {}) {
  const model = normalizeVectorModel(value);
  const b = bounds ?? vectorModelBounds(model);
  if (![b.x, b.y, b.width, b.height].every(finite) || b.width <= 0 || b.height <= 0) throw new TypeError('Invalid export bounds');
  const objects = model.items.filter(item => item.visible).map(item => {
    const t = item.transform;
    const attrs = `id="${escapeXml(item.id)}" transform="translate(${t.x} ${t.y}) rotate(${t.rotation}) scale(${t.scaleX} ${t.scaleY})" stroke="${escapeXml(item.stroke)}" stroke-width="${item.strokeWidth}" fill="${escapeXml(item.fill)}" fill-rule="${item.fillRule ?? 'nonzero'}"`;
    return item.type === 'path'
      ? `<path ${attrs} d="${vectorPathData(item)}"/>`
      : `<text ${attrs} x="${item.x}" y="${item.y}" font-size="${item.fontSize ?? 5}" font-family="sans-serif">${escapeXml(item.text)}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}${model.unit}" height="${b.height}${model.unit}" viewBox="${b.x} ${b.y} ${b.width} ${b.height}"><title>${escapeXml(title)}</title>${objects.join('')}</svg>`;
}
