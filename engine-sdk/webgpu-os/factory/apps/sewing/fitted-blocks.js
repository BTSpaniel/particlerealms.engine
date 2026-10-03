// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { getPatternDesignSchema, validatePatternGeneration } from '../../components/pattern-generation/schema.js';
import { normalizeVectorModel, vectorPathLength, vectorEdges, vectorPathData, vectorModelBounds } from '../../components/drawing/index.js';
import { pathItem, closedContour, seamAllowance, grainline, notch } from './geometry.js';
import { createTemplateDraft, label, assertDraftCuttable } from './generators.js';
import { accessorySeamLength as seamLength } from './accessory-generators.js';
import { contentHash } from '../../../../engine/matter/fabric/FabricSupport.js';
import { cloneStrictJson } from '../../../../engine/core/schema/StrictJsonValue.js';

export const NATIVE_FITTED_VERSION = '1.0.1';
const field = (id, label, min = 1, max = 2500, unit = 'mm') => ({ id, label, min, max, unit });
const option = (label, value, min, max, description = '') => ({ label, type: 'number', unit: 'mm', ...(value == null ? {} : { default: value }), min, max, description });
const common = { experimental: true, version: NATIVE_FITTED_VERSION };
export const PATTERN_DESIGNS = Object.freeze([
  { ...common, id: 'bodice-block', name: 'Native dartless bodice and sleeve',
    description: 'A dartless balance and muslin block with separate front/back arcs and a matched sleeve. Neckline and armhole curves are adjustable drafting estimates. It does not reconstruct bust cups or darts; fit and shape the muslin manually.',
    exampleMeasurements: Object.freeze({ chest: 960, chestFront: 500, waist: 760, waistBack: 380, neck: 360, shoulderToShoulder: 400, shoulderSlope: 15, hpsToWaistFront: 450, hpsToWaistBack: 420, waistToArmpit: 200, biceps: 300, elbow: 270, shoulderToElbow: 330, shoulderToWrist: 580, wrist: 160 }),
    measurements: [field('chest', 'Chest / full bust circumference', 500), field('chestFront', 'Front chest arc, side seam to side seam', 200), field('waist', 'Waist circumference', 400), field('waistBack', 'Back waist arc, side seam to side seam', 150), field('neck', 'Neck circumference', 200, 700), field('shoulderToShoulder', 'Shoulder point to shoulder point', 200, 700), field('shoulderSlope', 'Shoulder slope', 0, 40, 'deg'), field('hpsToWaistFront', 'High shoulder point to front waist', 250, 800), field('hpsToWaistBack', 'High shoulder point to back waist', 250, 800), field('waistToArmpit', 'Waist to armpit', 100, 450), field('biceps', 'Biceps circumference', 150, 800), field('elbow', 'Bent elbow circumference', 120, 700), field('shoulderToElbow', 'Shoulder point to elbow', 150, 500), field('shoulderToWrist', 'Shoulder point to wrist', 300, 1000), field('wrist', 'Wrist circumference', 100, 400)],
    options: { chestEaseMm: option('Chest wearing ease', 60, 0, 200), waistEaseMm: option('Waist wearing ease', 40, 0, 200), bicepsEaseMm: option('Biceps wearing ease', 50, 0, 150), elbowEaseMm: option('Elbow wearing ease', 40, 0, 150), wristEaseMm: option('Wrist opening ease', 60, 0, 150), sleeveCapEaseMm: option('Sleeve cap ease', 8, 0, 30), neckWidthAdjustmentMm: option('Neck width adjustment', 0, -20, 40, 'Draft estimate starts at neck circumference / 6; adjust after fitting.'), frontNeckDepthAdjustmentMm: option('Front neck depth adjustment', 0, -30, 80, 'Draft estimate starts at neck circumference / 5.'), backNeckDepthAdjustmentMm: option('Back neck depth adjustment', 0, -10, 40, 'Draft estimate starts at neck circumference / 20.'), armscyeInsetMm: option('Armhole curve inset', 20, 0, 50, 'Authored curve control offset, not a body measurement.') } },
  { ...common, id: 'trouser-block', name: 'Native dartless trouser block',
    description: 'Front/back muslin panels with an explicit seated rise and chosen crotch extensions. Waist shaping uses side seams without darts. Curves and seat balance require manual fitting; this is not a finished trouser style.',
    exampleMeasurements: Object.freeze({ waist: 760, waistBack: 380, seat: 1000, seatBack: 520, upperLeg: 560, knee: 400, ankle: 240, seatedRise: 280, waistToSeat: 200, waistToKnee: 600, waistToFloor: 1050 }),
    exampleOptions: Object.freeze({ frontCrotchExtensionMm: 30, backCrotchExtensionMm: 70 }),
    measurements: [field('waist', 'Waist circumference', 400), field('waistBack', 'Back waist arc, side seam to side seam', 150), field('seat', 'Seat circumference', 500), field('seatBack', 'Back seat arc, side seam to side seam', 200), field('upperLeg', 'Upper thigh circumference', 250, 1200), field('knee', 'Bent knee circumference', 200, 900), field('ankle', 'Ankle circumference', 150, 600), field('seatedRise', 'Seated waist to chair depth', 150, 500), field('waistToSeat', 'Waist to fullest seat level', 80, 400), field('waistToKnee', 'Waist to knee level', 350, 850), field('waistToFloor', 'Waist to floor', 600, 1600)],
    options: { waistEaseMm: option('Waist wearing ease', 40, 0, 200), seatEaseMm: option('Seat wearing ease', 60, 0, 200), thighEaseMm: option('Minimum thigh ease', 40, 0, 150), kneeEaseMm: option('Knee wearing ease', 40, 0, 150), ankleEaseMm: option('Ankle opening ease', 80, 0, 200), hemClearanceMm: option('Hem above floor', 40, 0, 150), frontCrotchExtensionMm: option('Front crotch drafting extension', null, 10, 140, 'Choose an explicit horizontal draft extension; it cannot be inferred uniquely from seat circumference.'), backCrotchExtensionMm: option('Back crotch drafting extension', null, 20, 200, 'Choose an explicit horizontal draft extension; check the seat and sitting balance in a muslin.') } },
]);

export const getNativePatternDesign = id => getPatternDesignSchema(id, PATTERN_DESIGNS);
function fail(code, message) { throw Object.assign(new Error(message), { name: 'NativeFittedBlockError', code }); }
export function validateNativePatternRequest(request = {}) {
  const clean = validatePatternGeneration(request, getNativePatternDesign(request.design)), m = clean.measurements, o = clean.options;
  for (const [part, whole] of [['waistBack', 'waist'], ['chestFront', 'chest'], ['seatBack', 'seat']]) if (m[part] != null && !(m[part] < m[whole] * .75 && m[part] > m[whole] * .25)) fail('ARC_PROPORTIONS', `${part} must be the measured arc between side seams, between one quarter and three quarters of ${whole}.`);
  if (request.sourceRevision != null && !(typeof request.sourceRevision === 'string' ? request.sourceRevision.trim().length > 0 : typeof request.sourceRevision === 'number' && Number.isFinite(request.sourceRevision))) fail('INVALID_REVISION', 'The source revision must be a nonempty string or finite number.');
  const measurementRevision = cloneStrictJson(request.measurementRevision ?? null, '$.measurementRevision');
  if (clean.seamAllowanceMm > 25) fail('INVALID_ALLOWANCE', 'These balance blocks support a seam allowance up to 25 mm.');
  if (clean.design === 'bodice-block') {
    if (!(m.shoulderToElbow < m.shoulderToWrist - 100 && m.waistToArmpit < Math.min(m.hpsToWaistFront, m.hpsToWaistBack) - 80)) fail('BODY_PROPORTIONS', 'Check the elbow, wrist and armpit heights: the block needs positive upper/lower arm and armhole depths.');
    if (m.elbow + o.elbowEaseMm > m.biceps + o.bicepsEaseMm || m.wrist + o.wristEaseMm > m.elbow + o.elbowEaseMm) fail('SLEEVE_PROPORTIONS', 'The supported sleeve narrows from biceps to elbow to wrist. Increase the corresponding ease or check those measurements.');
  } else {
    for (const key of ['frontCrotchExtensionMm', 'backCrotchExtensionMm']) if (o[key] == null) fail('DRAFT_PARAMETER_REQUIRED', `Choose ${key === 'frontCrotchExtensionMm' ? 'front' : 'back'} crotch drafting extension explicitly.`);
    if (!(m.waistToSeat + 30 < m.seatedRise && m.seatedRise + 100 < m.waistToKnee && m.waistToKnee + 150 < m.waistToFloor - o.hemClearanceMm)) fail('RISE_PROPORTIONS', 'Seat, seated crotch, knee and hem levels must be ordered with enough room for the leg transitions.');
    if (!(m.ankle + o.ankleEaseMm <= m.knee + o.kneeEaseMm && m.knee + o.kneeEaseMm <= m.upperLeg + o.thighEaseMm)) fail('LEG_PROPORTIONS', 'The supported trouser narrows from thigh to knee to ankle. Check the measurements and ease.');
  }
  return { ...clean, measurementRevision, ...(request.sourceRevision == null ? {} : { sourceRevision: request.sourceRevision }) };
}

const P = (x, y) => ({ x, y });
const M = p => ({ type: 'M', ...p });
const L = (p, edgeId) => ({ type: 'L', ...p, edgeId });
const C = (a, b, end, edgeId) => ({ type: 'C', x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...end, edgeId });
const curveLength = (start, command) => vectorPathLength(pathItem('measurement', '', [M(start), command]), .002);
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const ref = (pieceId, ...edgeIds) => ({ segments: edgeIds.map(edgeId => ({ pieceId, edgeId, start: 0, end: 1 })) });
const reverseCurve = (start, command, edgeId = command.edgeId) => C(P(command.x2, command.y2), P(command.x1, command.y1), start, edgeId);

/** Bracketed domain fit, using shared physical curve lengths, never pixel lengths. */
function fit(context, name, evaluate, target, lo, hi) {
  let a = evaluate(lo) - target, b = evaluate(hi) - target;
  if (![a, b].every(Number.isFinite) || a * b > 0) fail('INCOMPATIBLE_DIMENSIONS', `${name} cannot match the supplied dimensions within the supported curve range.`);
  if (Math.abs(a) < .002) return lo;
  if (Math.abs(b) < .002) return hi;
  for (let iteration = 0; iteration < 60; iteration++) {
    context.signal?.throwIfAborted(); const mid = (lo + hi) / 2, value = evaluate(mid) - target;
    if (!Number.isFinite(value)) fail('NONFINITE_GEOMETRY', `${name} produced a non-finite physical curve.`);
    if (Math.abs(value) < .002) { context.fits.push({ name, iterations: iteration + 1, residualMm: value, parameter: mid }); return mid; }
    if (a * value <= 0) { hi = mid; b = value; } else { lo = mid; a = value; }
  }
  fail('FIT_BUDGET_EXHAUSTED', `${name} did not converge within 60 scalar steps.`);
}
function bow(a, b, amount, side, edgeId) {
  const dx = b.x - a.x, dy = b.y - a.y, d = distance(a, b), nx = side * dy / d, ny = -side * dx / d;
  return C(P(a.x + dx / 3 + amount * nx, a.y + dy / 3 + amount * ny), P(a.x + dx * 2 / 3 + amount * nx, a.y + dy * 2 / 3 + amount * ny), b, edgeId);
}
function matchBows(context, name, segments, side = 1) {
  const target = Math.max(...segments.map(([a, b]) => distance(a, b)));
  return segments.map(([a, b, edgeId]) => {
    const amount = fit(context, name, n => curveLength(a, bow(a, b, n, side, edgeId)), target, 0, Math.min(80, Math.abs(b.y - a.y) * .4));
    return bow(a, b, amount, side, edgeId);
  });
}
function addPiece(context, id, name, commands, x, note) {
  const shifted = commands.map(command => Object.fromEntries(Object.entries(command).map(([key, value]) => [key, ['x', 'x1', 'x2'].includes(key) ? value + x : value])));
  const item = normalizeVectorModel({ schema: 'factory.vector.v1', unit: 'mm', items: [pathItem(id, name, shifted, { role: 'seam', cutQuantity: 2, material: 'Stable woven muslin', mirrored: true })] }).items[0];
  closedContour(item);
  let cut;
  try {
    cut = context.request.seamAllowanceMm ? seamAllowance(item, context.request.seamAllowanceMm) : { ...structuredClone(item), id: `${id}-cut`, name: `${name} cut line`, locked: true, metadata: { role: 'cut', templateSourceId: id, seamSignature: JSON.stringify(item.commands), seamAllowanceMm: 0 } };
  } catch (error) {
    fail('CUTTING_CONTOUR_INVALID', `${name}: the ${context.request.seamAllowanceMm} mm allowance cannot form a valid cutting contour. Reduce the allowance or revise the outline. ${error.message}`);
  }
  const bounds = vectorModelBounds({ items: [cut] }, 0);
  context.items.push(item, cut, grainline(item), label(`${id}-label`, `${name} · cut 2 mirrored`, bounds.x, bounds.y - 12));
  context.pieces.push({ id, name, cutQuantity: 2, mirrored: true, onFold: false, material: 'Stable woven muslin', cutWidthMm: bounds.width, cutHeightMm: bounds.height, note });
  return item;
}
function pair(context, id, a, b, easeMm = 0, reverse = false) { context.pairs.push({ id, a, b, easeMm, reverse, confirmed: true, provenance: 'authored-native-rule', seamAllowanceMm: context.request.seamAllowanceMm }); }
function dim(context, id, labelText, valueMm, role, fields) { context.dimensions.push({ id, label: labelText, valueMm, role, fields, provenance: 'authored-relationship' }); }
function capNotches(context, itemId, edgeId, count) {
  const item = context.items.find(p => p.id === itemId), edges = vectorEdges(item, .002), index = edges.findIndex(e => e.edgeId === edgeId);
  const start = edges.slice(0, index).reduce((sum, edge) => sum + edge.length, 0), at = start + edges[index].length / 2;
  for (let i = 0; i < count; i++) { const mark = notch(item, at + (i - (count - 1) / 2) * 3, 3); mark.name = count === 1 ? 'Front sleeve match' : 'Back sleeve match'; context.items.push(mark); }
}

function bodice(context) {
  const m = context.request.measurements, o = context.request.options, neckW = m.neck / 6 + o.neckWidthAdjustmentMm, shoulder = m.shoulderToShoulder / 2, drop = (shoulder - neckW) * Math.tan(m.shoulderSlope * Math.PI / 180);
  const data = ['front', 'back'].map((name, index) => {
    const height = index ? m.hpsToWaistBack : m.hpsToWaistFront, chest = (index ? m.chest - m.chestFront : m.chestFront) / 2 + o.chestEaseMm / 4;
    const waist = (index ? m.waistBack : m.waist - m.waistBack) / 2 + o.waistEaseMm / 4, neckD = index ? m.neck / 20 + o.backNeckDepthAdjustmentMm : m.neck / 5 + o.frontNeckDepthAdjustmentMm;
    const arm = P(chest, height - m.waistToArmpit), waistEnd = P(waist, height), shoulderEnd = P(shoulder, drop);
    if (!(neckW > 15 && neckW < shoulder - 35 && chest > shoulder + 5 && neckD > 5 && neckD < arm.y - 40 && arm.y > drop + 70 && waist > neckW + 20)) fail('BODICE_PROPORTIONS', 'The neck, shoulder, chest arcs and vertical balance cannot form a supported armhole. Check the measured arcs and explicit curve adjustments.');
    const armCurve = C(P(shoulder - o.armscyeInsetMm, drop + (arm.y - drop) * .55), P(chest - Math.max(15, (chest - shoulder) * .6), arm.y), arm, 'armhole');
    return { name, height, chest, waist, neckD, arm, waistEnd, shoulderEnd, armCurve };
  });
  const sides = matchBows(context, 'Front/back side seams', data.map(d => [d.arm, d.waistEnd, 'side']));
  let x = 0;
  for (const [i, d] of data.entries()) {
    const commands = [M(P(0, d.height)), L(P(0, d.neckD), 'centre'), C(P(0, d.neckD * .45), P(neckW * .45, 0), P(neckW, 0), 'neckline'), L(d.shoulderEnd, 'shoulder'), d.armCurve, sides[i], L(P(0, d.height), 'waist'), { type: 'Z', edgeId: 'closure' }];
    addPiece(context, `bodice-${d.name}`, `${d.name === 'front' ? 'Front' : 'Back'} balance panel`, commands, x, 'Paired centre seam, not a fold. No bust/waist darts are drafted; mark balance lines and shape the muslin manually.');
    d.offset = x; x += Math.max(d.chest, d.waist) + 100;
    dim(context, `${d.name}-chest-arc`, `${d.name} finished chest arc`, d.chest * 2, 'finished', ['chest', 'chestFront', 'chestEaseMm']);
    dim(context, `${d.name}-waist-arc`, `${d.name} finished waist arc`, d.waist * 2, 'finished', ['waist', 'waistBack', 'waistEaseMm']);
    dim(context, `${d.name}-balance`, `${d.name} high shoulder to waist`, d.height, 'body', [i ? 'hpsToWaistBack' : 'hpsToWaistFront']);
  }
  pair(context, 'shoulders', ref('bodice-front', 'shoulder'), ref('bodice-back', 'shoulder'));
  pair(context, 'body-sides', ref('bodice-front', 'side'), ref('bodice-back', 'side'));
  const arms = data.map(d => curveLength(d.shoulderEnd, d.armCurve)), totalArm = arms[0] + arms[1], capTargets = arms.map(n => n + o.sleeveCapEaseMm * n / totalArm);
  const biceps = m.biceps + o.bicepsEaseMm, elbow = m.elbow + o.elbowEaseMm, wrist = m.wrist + o.wristEaseMm;
  const quarter = (width, height, edgeId) => C(P(0, height * .45), P(width * .45, 0), P(width, 0), edgeId);
  const halfWidth = (height, target) => fit(context, 'Sleeve cap half width', w => curveLength(P(0, height), quarter(w, height, 'cap')), target, 0, target);
  const capHeight = fit(context, 'Sleeve cap height', h => halfWidth(h, capTargets[0]) + halfWidth(h, capTargets[1]), biceps, 5, Math.min(m.shoulderToElbow - 60, Math.min(...capTargets) * .98));
  const frontWidth = halfWidth(capHeight, capTargets[0]), backWidth = biceps - frontWidth;
  if (!(frontWidth > biceps * .2 && backWidth > biceps * .2 && capHeight < m.shoulderToElbow - 60)) fail('SLEEVE_CAP_PROPORTIONS', 'The armhole arcs cannot produce a supported sleeve cap at this biceps width and elbow height.');
  const left = P(0, capHeight), peak = P(frontWidth, 0), right = P(biceps, capHeight), elbowL = P((biceps - elbow) / 2, m.shoulderToElbow), elbowR = P((biceps + elbow) / 2, m.shoulderToElbow), wristL = P((biceps - wrist) / 2, m.shoulderToWrist), wristR = P((biceps + wrist) / 2, m.shoulderToWrist);
  addPiece(context, 'bodice-sleeve', 'Matched balance sleeve', [M(left), quarter(frontWidth, capHeight, 'cap-front'), C(P(peak.x + backWidth * .55, 0), P(biceps, capHeight * .45), right, 'cap-back'), L(elbowR, 'underarm-upper-back'), L(wristR, 'underarm-lower-back'), L(wristL, 'wrist'), L(elbowL, 'underarm-lower-front'), L(left, 'underarm-upper-front'), { type: 'Z', edgeId: 'closure' }], x, 'Keep the lower wrist seam open for the fitting. This block does not include a cuff or closure and does not establish hand passage.');
  for (let i = 0; i < 2; i++) pair(context, `sleeve-cap-${data[i].name}`, ref(`bodice-${data[i].name}`, 'armhole'), ref('bodice-sleeve', `cap-${data[i].name}`), capTargets[i] - arms[i], i === 0);
  capNotches(context, 'bodice-front', 'armhole', 1); capNotches(context, 'bodice-back', 'armhole', 2);
  capNotches(context, 'bodice-sleeve', 'cap-front', 1); capNotches(context, 'bodice-sleeve', 'cap-back', 2);
  pair(context, 'sleeve-upper-underarm', ref('bodice-sleeve', 'underarm-upper-front'), ref('bodice-sleeve', 'underarm-upper-back'), 0, true);
  pair(context, 'sleeve-lower-underarm', ref('bodice-sleeve', 'underarm-lower-front'), ref('bodice-sleeve', 'underarm-lower-back'), 0, true);
  for (const [id, value, fields] of [['biceps', biceps, ['biceps', 'bicepsEaseMm']], ['elbow', elbow, ['elbow', 'elbowEaseMm']], ['wrist', wrist, ['wrist', 'wristEaseMm']], ['cap-height', capHeight, ['chest', 'chestFront', 'hpsToWaistFront', 'hpsToWaistBack', 'biceps', 'sleeveCapEaseMm']]]) dim(context, `sleeve-${id}`, `Sleeve ${id}`, value, 'finished', fields);
  context.levels = { front: { offsetX: data[0].offset, chestY: data[0].arm.y, waistY: data[0].height }, back: { offsetX: data[1].offset, chestY: data[1].arm.y, waistY: data[1].height }, sleeve: { offsetX: x, bicepsY: capHeight, elbowY: m.shoulderToElbow, wristY: m.shoulderToWrist } };
  context.instructions = ['This is a dartless balance/muslin block, not a cup-fitted bodice. Transfer the front/back, shoulder, side and sleeve labels before cutting.', 'Cut every listed piece twice as a mirrored pair. Centre seams have the stated allowance; none of these pieces is cut on a fold.', 'Mark chest, waist, elbow and cap apex balance points. Baste centre seams, leaving a front opening for fitting; then baste matched shoulders and sides.', `Baste each sleeve upper/lower underarm seam, leaving the wrist opening available. Match front/back cap sections to their named armholes; distribute the recorded ${o.sleeveCapEaseMm} mm cap ease without pleats.`, 'Check front/back balance, shoulder placement, reach and bent-elbow comfort. Adjust the neckline/armhole estimates and develop any required bust/waist darts on a separate muslin revision.', 'Do not use the muslin to claim a finished closure, cuff, cup shape or physical print calibration. Record those checks separately.'];
}

function trousers(context) {
  const m = context.request.measurements, o = context.request.options, kneeWidth = (m.knee + o.kneeEaseMm) / 2, ankleWidth = (m.ankle + o.ankleEaseMm) / 2, hemY = m.waistToFloor - o.hemClearanceMm;
  const data = ['front', 'back'].map((name, i) => {
    const waist = (i ? m.waistBack : m.waist - m.waistBack) / 2 + o.waistEaseMm / 4, seat = (i ? m.seatBack : m.seat - m.seatBack) / 2 + o.seatEaseMm / 4, extension = i ? o.backCrotchExtensionMm : o.frontCrotchExtensionMm, center = (seat - extension) / 2;
    if (waist > seat || extension > seat * .6 || center <= 20) fail('TROUSER_PROPORTIONS', 'The supported dartless panels need a positive leg centre and seat width at least as wide as the waist. Check arcs and drafting extensions.');
    return { name, waist, seat, extension, center, waistP: P(waist, 0), seatP: P(seat, m.waistToSeat), kneeOut: P(center + kneeWidth / 2, m.waistToKnee), kneeIn: P(center - kneeWidth / 2, m.waistToKnee), hemOut: P(center + ankleWidth / 2, hemY), hemIn: P(center - ankleWidth / 2, hemY), crotch: P(-extension, m.seatedRise) };
  });
  const upperSides = matchBows(context, 'Waist-to-seat outseams', data.map(d => [d.waistP, d.seatP, 'side-waist-seat']));
  const middleSides = matchBows(context, 'Seat-to-knee outseams', data.map(d => [d.seatP, d.kneeOut, 'side-seat-knee']));
  const inseams = matchBows(context, 'Crotch-to-knee inseams', data.map(d => [d.crotch, d.kneeIn, 'inside-crotch-knee']), -1);
  let x = o.frontCrotchExtensionMm + 20;
  for (const [i, d] of data.entries()) {
    const crotchCurve = C(P(-d.extension * .4, m.seatedRise), P(0, m.waistToSeat + (m.seatedRise - m.waistToSeat) * .5), P(0, m.waistToSeat), 'crotch-rise');
    addPiece(context, `trouser-${d.name}`, `${i ? 'Back' : 'Front'} trouser balance panel`, [M(P(0, 0)), L(d.waistP, 'waist'), upperSides[i], middleSides[i], L(d.hemOut, 'side-knee-hem'), L(d.hemIn, 'hem'), L(d.kneeIn, 'inside-knee-hem'), reverseCurve(d.crotch, inseams[i]), crotchCurve, L(P(0, 0), 'centre-rise'), { type: 'Z', edgeId: 'closure' }], x, 'Dartless waist shaping is in the side seam. Crotch extensions are chosen drafting inputs, not inferred fit. No waistband, fly or closure is included.');
    d.offset = x; x += d.seat + d.extension + 120;
    dim(context, `${d.name}-waist-arc`, `${d.name} finished waist arc`, d.waist * 2, 'finished', ['waist', 'waistBack', 'waistEaseMm']);
    dim(context, `${d.name}-seat-arc`, `${d.name} finished seat arc`, d.seat * 2, 'finished', ['seat', 'seatBack', 'seatEaseMm']);
    dim(context, `${d.name}-crotch-extension`, `${d.name} chosen crotch extension`, d.extension, 'drafting-parameter', [i ? 'backCrotchExtensionMm' : 'frontCrotchExtensionMm']);
  }
  for (const edge of ['side-waist-seat', 'side-seat-knee', 'side-knee-hem', 'inside-crotch-knee', 'inside-knee-hem']) pair(context, edge, ref('trouser-front', edge), ref('trouser-back', edge));
  context.levels = Object.fromEntries(data.map(d => [d.name, { offsetX: d.offset, waistY: 0, seatY: m.waistToSeat, thighY: m.seatedRise, kneeY: m.waistToKnee, hemY }]));
  dim(context, 'knee-circumference', 'Finished knee circumference', kneeWidth * 2, 'finished', ['knee', 'kneeEaseMm']);
  dim(context, 'ankle-circumference', 'Finished ankle circumference', ankleWidth * 2, 'finished', ['ankle', 'ankleEaseMm']);
  dim(context, 'hem-level', 'Vertical waist-to-hem level', hemY, 'finished', ['waistToFloor', 'hemClearanceMm']);
  context.instructions = ['This is a dartless trouser balance/muslin block with explicit seated depth and drafting extensions; it does not infer seat shape or total crotch length from circumference.', 'Cut two mirrored front panels and two mirrored back panels. Transfer waist, seat and knee levels and front/back labels.', 'Baste front to back at each named side and inseam segment, matching the seat/knee level marks. Join the two legs at the crotch and leave a waist opening for fitting.', 'Stabilize the waist temporarily; no waistband, fly, pockets or closure are drafted. Check the actual thigh and knee clearances, sitting, walking and crotch balance.', 'Develop any required waist darts, seat shaping and final garment details on a new fitted muslin revision. Preserve the original measurement record.', 'Check physical print scale and sew a sample before treating any draft as validated.'];
}

/** Recover a physical horizontal section through the retained vector contour. */
function sectionAt(item, y) {
  const xs = [];
  for (const edge of vectorEdges(item, .002)) for (let i = 1; i < edge.points.length; i++) {
    const a = edge.points[i - 1], b = edge.points[i];
    if (Math.abs(a.y - y) < 1e-7) xs.push(a.x);
    if (Math.abs(b.y - y) < 1e-7) xs.push(b.x);
    if ((a.y < y && b.y > y) || (b.y < y && a.y > y)) xs.push(a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y));
  }
  if (xs.length < 2) fail('MISSING_SECTION', 'A retained measurement level no longer intersects the piece.');
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  return { minX, maxX, width: maxX - minX };
}
/** A saved check belongs to these authored inputs and relationships, never later edits. */
function authoredStateHash(draft) {
  const f = draft.fitted, r = draft.recipe;
  const recipe = { template: r.template, version: r.version, backend: r.backend, measurements: r.measurements, options: r.options, seamAllowanceMm: r.seamAllowanceMm, measurementRevision: r.measurementRevision, units: r.units, angleUnits: r.angleUnits };
  return contentHash({ recipe, sourceRevision: f.sourceRevision, kind: f.kind, seamPairs: f.seamPairs, dimensions: f.dimensions, levels: f.levels, authoredPaths: f.authoredPaths, pieces: draft.pieces });
}
export function inspectNativeFittedBlock(draft) {
  const f = draft.fitted;
  if (f?.schema !== 'sewing.native-fitted.v1') fail('MISSING_RELATIONSHIPS', 'This draft has no native fitting relationships.');
  if (!f.authoredStateHash || authoredStateHash(draft) !== f.authoredStateHash) fail('PATTERN_UPDATE_REQUIRED', 'The native inputs, revision or sewing relationships changed. Generate a new revision before reusing its numerical checks.');
  assertDraftCuttable(draft);
  for (const source of f.authoredPaths) {
    const item = draft.model.items.find(p => p.id === source.id);
    if (!item || !item.visible || vectorPathData(item) !== source.path || contentHash(item.metadata) !== source.metadataHash || Object.entries({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }).some(([key, value]) => item.transform?.[key] !== value)) fail('PATTERN_UPDATE_REQUIRED', 'A native outline or match mark changed. Recheck its dimensions and seam relationships before treating it as a generated block.');
  }
  const seams = f.seamPairs.map(pair => {
    const aMm = seamLength(draft.model, pair.a), bMm = seamLength(draft.model, pair.b), differenceMm = bMm - aMm - pair.easeMm, toleranceMm = Math.max(.5, Math.max(aMm, bMm) * .001);
    if (![aMm, bMm, pair.easeMm, differenceMm].every(Number.isFinite) || Math.abs(differenceMm) > toleranceMm) fail('SEAM_MISMATCH', `${pair.id} differs by ${differenceMm.toFixed(3)} mm after recorded ease.`);
    return { id: pair.id, aMm, bMm, easeMm: pair.easeMm, differenceMm, toleranceMm };
  });
  const m = draft.recipe.measurements, o = draft.recipe.options, section = (piece, level) => sectionAt(draft.model.items.find(p => p.id === piece), level).width;
  const dimensions = [];
  const check = (id, actual, expected) => { if (![actual, expected].every(Number.isFinite) || Math.abs(actual - expected) > .1) fail('DIMENSION_MISMATCH', `${id} is ${actual.toFixed(3)} mm; expected ${expected.toFixed(3)} mm.`); dimensions.push({ id, valueMm: actual, expectedMm: expected }); };
  if (draft.recipe.template === 'bodice-block') {
    for (const name of ['front', 'back']) {
      const levels = f.levels[name], front = name === 'front';
      check(`${name}-chest-arc`, section(`bodice-${name}`, levels.chestY) * 2, (front ? m.chestFront : m.chest - m.chestFront) + o.chestEaseMm / 2);
      check(`${name}-waist-arc`, section(`bodice-${name}`, levels.waistY) * 2, (front ? m.waist - m.waistBack : m.waistBack) + o.waistEaseMm / 2);
    }
    for (const [id, level, expected] of [['biceps', f.levels.sleeve.bicepsY, m.biceps + o.bicepsEaseMm], ['elbow', m.shoulderToElbow, m.elbow + o.elbowEaseMm], ['wrist', m.shoulderToWrist, m.wrist + o.wristEaseMm]]) check(`sleeve-${id}`, section('bodice-sleeve', level), expected);
  } else {
    for (const name of ['front', 'back']) {
      const levels = f.levels[name], front = name === 'front';
      check(`${name}-waist-arc`, section(`trouser-${name}`, levels.waistY) * 2, (front ? m.waist - m.waistBack : m.waistBack) + o.waistEaseMm / 2);
      check(`${name}-seat-arc`, section(`trouser-${name}`, levels.seatY) * 2, (front ? m.seat - m.seatBack : m.seatBack) + o.seatEaseMm / 2);
    }
    for (const [id, y, expected] of [['knee', m.waistToKnee, m.knee + o.kneeEaseMm], ['ankle', f.levels.front.hemY, m.ankle + o.ankleEaseMm]]) check(id, section('trouser-front', y) + section('trouser-back', y), expected);
    const thigh = section('trouser-front', m.seatedRise) + section('trouser-back', m.seatedRise);
    if (thigh + .1 < m.upperLeg + o.thighEaseMm) fail('INSUFFICIENT_THIGH_CLEARANCE', `The actual crotch-level panels provide ${thigh.toFixed(1)} mm around the thigh; ${m.upperLeg + o.thighEaseMm} mm is required. Adjust the declared extensions or seat ease and fit a muslin.`);
    dimensions.push({ id: 'thigh', valueMm: thigh, minimumMm: m.upperLeg + o.thighEaseMm });
  }
  return { sourceRevision: f.sourceRevision, status: 'numerically-checked', seams, dimensions, physicalPrint: 'not-checked', muslin: 'not-checked', fittedBodyShape: 'not-validated' };
}

export function generateNativeFittedBlock(request = {}) {
  request.signal?.throwIfAborted();
  const clean = validateNativePatternRequest(request), spec = getNativePatternDesign(clean.design), context = { request: clean, signal: request.signal, items: [], pieces: [], pairs: [], dimensions: [], fits: [], instructions: [] };
  console.debug('[Sewing:native-fitting] start', { design: clean.design, version: NATIVE_FITTED_VERSION });
  if (clean.design === 'bodice-block') bodice(context); else trousers(context);
  for (const [name, levels] of Object.entries(context.levels)) {
    const itemId = `${clean.design === 'bodice-block' ? 'bodice' : 'trouser'}-${name}`, item = context.items.find(p => p.id === itemId);
    for (const [key, y] of Object.entries(levels)) if (key.endsWith('Y') && !['waistY', 'hemY', 'wristY'].includes(key)) {
      const section = sectionAt(item, y), line = pathItem(`${itemId}-${key}-balance`, `${key.slice(0, -1)} balance line`, [M(P(section.minX, y)), L(P(section.maxX, y), `${key}-line`)], { role: 'balance-reference', measurementLevel: key });
      line.stroke = '#687b82'; line.strokeWidth = .2; line.locked = true;
      const text = label(`${line.id}-label`, key.slice(0, -1), section.minX + 5, y - 3); text.fontSize = 4;
      context.items.push(line, text);
    }
  }
  const end = vectorModelBounds({ items: context.items }, 0);
  context.items.push(label('native-fitting-scope', 'DARTLESS MUSLIN BLOCK · cut 2 mirrored per piece · shape and fit manually', end.x, end.y + end.height + 18));
  const result = createTemplateDraft(spec.name, clean.design, clean.options, context.items, context.pieces, context.instructions, ['Native physical contours checked', 'Named sewing segments matched against actual curve lengths', 'Body measurements, drafting estimates and wearing ease remain separate']);
  result.recipe = { ...result.recipe, version: NATIVE_FITTED_VERSION, backend: 'factory-native', measurements: structuredClone(clean.measurements), options: structuredClone(clean.options), seamAllowanceMm: clean.seamAllowanceMm, measurementRevision: structuredClone(request.measurementRevision ?? null), units: 'mm', angleUnits: 'deg' };
  result.experimental = true; result.validation = 'Native dartless balance/muslin block. Geometry and named seams checked; body fit, cup/seat shaping, physical printing and a sewn muslin remain unverified.';
  result.fitted = { schema: 'sewing.native-fitted.v1', sourceRevision: request.sourceRevision ?? result.id, kind: clean.design, scope: spec.description, seamPairs: context.pairs, dimensions: context.dimensions, levels: context.levels, scalarFits: context.fits, authoredPaths: result.model.items.filter(item => ['seam', 'notch', 'balance-reference'].includes(item.metadata?.role)).map(item => ({ id: item.id, path: vectorPathData(item), metadataHash: contentHash(item.metadata) })) };
  result.fitted.authoredStateHash = authoredStateHash(result);
  result.fitted.verification = inspectNativeFittedBlock(result); result.originalModel = structuredClone(result.model);
  request.signal?.throwIfAborted();
  console.debug('[Sewing:native-fitting] complete', { design: clean.design, pieces: result.pieces.length, seams: context.pairs.length, sourceRevision: result.fitted.sourceRevision });
  return result;
}
