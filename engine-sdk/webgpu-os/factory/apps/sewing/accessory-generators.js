// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { positive, rectangle, label, createTemplateDraft, assertDraftCuttable } from './generators.js';
import { pathItem, seamAllowance, grainline, closedContour } from './geometry.js';
import { normalizeVectorModel, vectorEdges, vectorModelBounds, vectorPathData } from '../../components/drawing/index.js';

/** Original dimension rules for sewn fabric accessories. A numerical draft is not a fitted or thermally validated product. */
export const ACCESSORY_SPECS = Object.freeze({
  'bowl-cosy': { name: 'Darted bowl cosy', fields: [['flatWidth', 'Flat square at stitching line', 250], ['dartIntake', 'Intake of each dart', 24], ['dartDepth', 'Dart depth from stitching line', 50], ['seamAllowance', 'Seam allowance', 6]], experimental: true },
  'stretch-sock': { name: 'Two-panel stretch sock', fields: [['footLength', 'Heel to longest toe', 260], ['footCircumference', 'Body circumference around ball of foot', 240], ['toeCircumference', 'Body circumference around toes', 200], ['ankleCircumference', 'Body ankle circumference', 230], ['heelDiagonal', 'Body circumference around heel and instep', 320], ['legHeight', 'Leg above the instep transition', 100], ['cuffHeight', 'Finished folded cuff height', 25], ['reductionPercent', 'Circumference reduction (%)', 5], ['fabricStretchPercent', 'Tested fabric extension across foot (%)', 60], ['fabricLengthStretchPercent', 'Tested fabric extension along foot (%)', 25], ['seamAllowance', 'Seam allowance', 4]], experimental: true },
  'fingerless-glove': { name: 'Fingerless stretch glove', fields: [['handCircumference', 'Body knuckle circumference, excluding thumb', 210], ['wristCircumference', 'Body wrist circumference', 170], ['palmLength', 'Wrist to open finger edge', 95], ['thumbWebHeight', 'Wrist to thumb web', 50], ['thumbCircumference', 'Body thumb circumference', 65], ['thumbLength', 'Thumb coverage from its base', 28], ['thumbAngle', 'Thumb spread angle (degrees)', 35], ['reductionPercent', 'Circumference reduction (%)', 5], ['fabricStretchPercent', 'Tested fabric extension across hand (%)', 60], ['fabricLengthStretchPercent', 'Tested fabric extension along hand (%)', 25], ['seamAllowance', 'Seam and single-turn hem allowance', 3]], experimental: true },
  'fingered-glove': { name: 'Five-finger stretch glove', fields: [['handCircumference', 'Body knuckle circumference, excluding thumb', 210], ['wristCircumference', 'Body wrist circumference', 170], ['palmLength', 'Wrist to finger webs', 100], ['thumbWebHeight', 'Wrist to thumb web', 45], ['thumbCircumference', 'Body thumb circumference', 65], ['thumbLength', 'Thumb base to tip', 60], ['thumbAngle', 'Thumb spread angle (degrees)', 35], ['indexCircumference', 'Body index finger circumference', 62], ['indexLength', 'Index web to tip', 75], ['middleCircumference', 'Body middle finger circumference', 65], ['middleLength', 'Middle web to tip', 82], ['ringCircumference', 'Body ring finger circumference', 60], ['ringLength', 'Ring web to tip', 76], ['littleCircumference', 'Body little finger circumference', 53], ['littleLength', 'Little finger web to tip', 58], ['webGap', 'Space between spread fingers on flat draft', 10], ['reductionPercent', 'Circumference reduction (%)', 5], ['fabricStretchPercent', 'Tested fabric extension across hand (%)', 60], ['fabricLengthStretchPercent', 'Tested fabric extension along hand (%)', 25], ['seamAllowance', 'Seam and single-turn hem allowance', 3]], experimental: true },
});

export function accessoryDefaults(kind) {
  const spec = ACCESSORY_SPECS[kind]; if (!spec) throw new Error('Choose a supported accessory design');
  return Object.fromEntries(spec.fields.map(([key, , value]) => [key, value]));
}

const K = 4 * (Math.SQRT2 - 1) / 3;
const segment = (pieceId, edgeId, start = 0, end = 1) => ({ pieceId, edgeId, start, end });
const reference = (...segments) => ({ segments });
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function translated(commands, x, y = 0) {
  return commands.map(command => Object.fromEntries(Object.entries(command).map(([key, value]) => [key, ['x', 'x1', 'x2'].includes(key) ? value + x : ['y', 'y1', 'y2'].includes(key) ? value + y : value])));
}
function context(kind, options) { return { kind, options, items: [], pieces: [], seamPairs: [], openings: [], features: [], dimensions: [], materialChecks: [], instructions: [], checks: [] }; }
function addPiece(c, id, name, commands, { x = 0, y = 0, quantity = 1, material = 'Four-way stretch knit', allowance = c.options.seamAllowance, note = '' } = {}) {
  const item = normalizeVectorModel({ schema: 'factory.vector.v1', unit: 'mm', items: [pathItem(id, name, translated(commands, x, y), { role: 'seam', cutQuantity: quantity, material })] }).items[0];
  closedContour(item);
  let cut;
  try { cut = seamAllowance(item, allowance); } catch (error) { fail('INVALID_ALLOWANCE', `${name}: ${error.message}. Reduce the allowance or increase the space around this feature.`); }
  const bounds = vectorModelBounds({ items: [cut] }, 0);
  c.items.push(item, cut, grainline(item));
  c.pieces.push({ id, name, cutQuantity: quantity, material, cutWidthMm: bounds.width, cutHeightMm: bounds.height, note: `${note} Cutting contour includes ${allowance} mm allowance.`.trim() });
  return item;
}
function pair(c, id, a, b, { method = 'stretch-stitch', reverse = false, repeatCount = 1, note = '' } = {}) {
  c.seamPairs.push({ id, a, b, reverse, easeMm: 0, seamAllowanceMm: c.options.seamAllowance, method, repeatCount, confirmed: true, provenance: 'authored-template', note });
}
function itemReferences(item, accept = () => true) { return reference(...vectorEdges(item).filter(accept).map(edge => segment(item.id, edge.edgeId))); }
function opening(c, id, name, ref, finish) { c.openings.push({ id, name, reference: ref, finish, sewnClosed: false }); }
function dimension(c, id, labelText, valueMm, role, fields) { c.dimensions.push({ id, label: labelText, valueMm, role, fields, provenance: 'authored-relationship' }); }

/** Evaluate retained edge identities with arc-length fractions. Deleted edges cannot silently bind to their neighbours. */
export function accessorySeamLength(model, ref) {
  if (!ref?.segments?.length) fail('ORPHAN_SEAM', 'An accessory seam has no retained edge references');
  let length = 0;
  for (const part of ref.segments) {
    const item = model.items.find(candidate => candidate.id === part.pieceId), edge = vectorEdges(item, .002).find(candidate => candidate.edgeId === part.edgeId);
    if (!edge || ![part.start, part.end].every(n => Number.isFinite(n) && n >= 0 && n <= 1) || part.start === part.end) fail('ORPHAN_SEAM', 'An accessory seam references a missing edge or invalid interval');
    length += edge.length * Math.abs(part.end - part.start);
  }
  return length;
}

export function inspectAccessoryDraft(draft) {
  if (draft?.accessory?.schema !== 'sewing.accessory.v1') fail('INVALID_ACCESSORY', 'Choose an accessory draft with authored sewing relationships');
  assertDraftCuttable(draft);
  for (const source of draft.accessory.authoredPaths) {
    const current = draft.model.items.find(item => item.id === source.id);
    if (!current || vectorPathData(current) !== source.path || Object.entries({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }).some(([key, value]) => current.transform[key] !== value)) fail('PATTERN_UPDATE_REQUIRED', 'The accessory outline changed. Review its measurements and sewing relationships before generating a cutting copy.');
  }
  const seams = draft.accessory.seamPairs.map(seam => {
    const a = accessorySeamLength(draft.model, seam.a), b = accessorySeamLength(draft.model, seam.b), differenceMm = b - a - seam.easeMm, toleranceMm = Math.max(.5, Math.max(a, b) * .001);
    if (Math.abs(differenceMm) > toleranceMm) fail('SEAM_MISMATCH', `${seam.id}: paired sewing lines differ by ${differenceMm.toFixed(2)} mm`);
    return { id: seam.id, aMm: a, bMm: b, differenceMm, toleranceMm };
  });
  const openings = draft.accessory.openings.map(value => ({ id: value.id, lengthMm: accessorySeamLength(draft.model, value.reference) }));
  return { sourceRevision: draft.accessory.sourceRevision, status: 'numerically-checked', seams, openings, printChecked: false, sampleVerified: draft.sampleVerified === true };
}

function finish(c) {
  const spec = ACCESSORY_SPECS[c.kind];
  c.items.push(label(`${c.kind}-validation`, 'EXPERIMENTAL · Check a fabric sample before making the final item', 0, vectorModelBounds({ items: c.items }, 0).y - 20));
  const result = createTemplateDraft(spec.name, c.kind, c.options, c.items, c.pieces, c.instructions, c.checks);
  result.experimental = true;
  result.validation = 'Sewing lines and cutting contours checked numerically; fabric fit, physical print and sewn sample remain unverified';
  result.accessory = { schema: 'sewing.accessory.v1', sourceRevision: c.options.sourceRevision ?? result.id, kind: c.kind, construction: c.construction, seamPairs: c.seamPairs, openings: c.openings, features: c.features, dimensions: c.dimensions, materialChecks: c.materialChecks, thermalUse: { status: 'not-validated', materialRecipe: null }, authoredPaths: result.model.items.filter(item => item.metadata?.role === 'seam' || item.metadata?.role === 'dart').map(item => ({ id: item.id, path: vectorPathData(item) })) };
  result.accessory.verification = inspectAccessoryDraft(result);
  result.originalModel = structuredClone(result.model);
  return result;
}

function validateOptions(kind, input) {
  const defaults = accessoryDefaults(kind), options = { ...defaults, ...input };
  for (const [key, description] of ACCESSORY_SPECS[kind].fields) options[key] = positive(options[key], description, key.endsWith('Percent') ? 0 : .1, key.endsWith('Percent') ? 300 : 3000);
  options.seamAllowance = positive(options.seamAllowance, 'Seam allowance', 1, kind.includes('glove') ? 8 : 20);
  if (options.sourceRevision != null && !['string', 'number'].includes(typeof options.sourceRevision)) fail('INVALID_REVISION', 'The source revision must be a string or number');
  if (input.pair != null && typeof input.pair !== 'boolean') fail('INVALID_QUANTITY', 'Pair must be true or false');
  options.pair = kind === 'bowl-cosy' ? false : input.pair !== false;
  return options;
}

function stretchChecks(c, { bodyCircumference, openingCircumference, passCircumference }) {
  const reduction = positive(c.options.reductionPercent, 'Circumference reduction', 0, 20) / 100;
  const requiredWear = 100 * (1 / (1 - reduction) - 1), requiredPass = Math.max(0, 100 * (passCircumference / openingCircumference - 1));
  const required = Math.max(requiredWear, requiredPass);
  if (c.options.fabricStretchPercent + 1e-9 < required) fail('INSUFFICIENT_STRETCH', `The opening needs at least ${required.toFixed(1)}% extension to pass the supplied body circumference. Increase the opening or select fabric with a sufficient measured extension.`);
  if (c.options.fabricLengthStretchPercent < 20) fail('FOUR_WAY_STRETCH_REQUIRED', 'This two-panel construction requires at least 20% measured extension along the body as well as across it. Choose a four-way stretch fabric and check recovery.');
  c.materialChecks.push({ id: 'stretch', requiredWearExtensionPercent: requiredWear, requiredDonningExtensionPercent: requiredPass, suppliedCrossExtensionPercent: c.options.fabricStretchPercent, suppliedLengthExtensionPercent: c.options.fabricLengthStretchPercent, recovery: 'unrecorded', status: 'sample-required', note: 'Measured extension is a necessary opening check. It does not establish comfort, pressure, recovery or fit.' });
  dimension(c, 'body-circumference', 'Supplied body circumference', bodyCircumference, 'body', [c.kind === 'stretch-sock' ? 'footCircumference' : 'handCircumference']);
  return 1 - reduction;
}

function bowl(c) {
  const { flatWidth: s, dartIntake: intake, dartDepth: depth, seamAllowance: sa } = c.options;
  if (s < 100 || s > 700 || intake >= s * .45 || depth >= s * .45 || depth < intake / 2 || s - intake <= 4 * sa) fail('DART_GEOMETRY', 'Use a 100–700 mm flat square, with non-overlapping darts less than 45% of its width and depth at least half the intake.');
  c.construction = 'two-square-shells-with-four-darts-each';
  const shells = [];
  for (const [index, name] of ['Outer', 'Inner'].entries()) {
    const id = `cosy-${name.toLowerCase()}`, x = index * (s + 60), square = rectangle(id, `${name} shell`, 0, 0, s, s, {});
    square.commands.slice(1).forEach((command, edge) => { command.edgeId = `rim-${edge}`; });
    const item = addPiece(c, id, `${name} shell`, square.commands, { x, material: `${name} fabric`, note: 'Cut one. Transfer four dart legs and fold axes; do not cut dart wedges before sewing.' }); shells.push(item);
    const batting = rectangle(`${id}-batting`, `${name} batting`, x, s + 55, s + 2 * sa, s + 2 * sa, { role: 'cut', cutQuantity: 1, material: 'Batting' });
    c.items.push(batting, label(`${id}-batting-label`, `${name} batting · Cut 1 · quilt to wrong side before darts`, x + 5, s + 75));
    c.pieces.push({ id: batting.id, name: `${name} batting`, cutQuantity: 1, material: 'Batting', cutWidthMm: s + 2 * sa, cutHeightMm: s + 2 * sa, note: 'Full cut square. Trim batting bulk within seam allowances after sewing. No thermal suitability is implied.' });
    for (let side = 0; side < 4; side++) {
      const rotate = p => { let q = p; for (let i = 0; i < side; i++) q = { x: s - q.y, y: q.x }; return { x: q.x + x, y: q.y }; };
      const a = rotate({ x: (s - intake) / 2, y: 0 }), b = rotate({ x: (s + intake) / 2, y: 0 }), tip = rotate({ x: s / 2, y: depth }), mouth = rotate({ x: s / 2, y: 0 });
      const dart = pathItem(`${id}-dart-${side}`, `${name} dart ${side + 1}`, [{ type: 'M', ...a }, { type: 'L', ...tip, edgeId: 'leg-a' }, { type: 'L', ...b, edgeId: 'leg-b' }], { role: 'dart', pieceId: id, intakeMm: intake, depthMm: depth });
      c.items.push(dart, pathItem(`${dart.id}-fold`, 'Dart fold axis', [{ type: 'M', ...mouth }, { type: 'L', ...tip }], { role: 'fold', pieceId: id }));
      pair(c, dart.id, reference(segment(dart.id, 'leg-a')), reference(segment(dart.id, 'leg-b')), { method: 'dart', reverse: true, note: 'Fold through the apex, match legs right sides together, and taper to the point.' });
      c.features.push({ id: dart.id, kind: 'dart', pieceId: id, apex: tip, intakeMm: intake, depthMm: depth, legLengthMm: Math.hypot(depth, intake / 2), battingPieceId: batting.id });
    }
  }
  const sides = item => reference(...[0, 1, 2, 3].flatMap(side => [segment(item.id, `rim-${side}`, 0, .5 - intake / (2 * s)), segment(item.id, `rim-${side}`, .5 + intake / (2 * s), 1)]));
  pair(c, 'join-cosy-rims', sides(shells[0]), sides(shells[1]), { method: 'stitch-and-turn', note: 'Exclude closed dart intakes. Leave a turning gap between a corner and a dart, then close it by topstitching.' });
  dimension(c, 'flat-square', 'Flat stitching square before darts', s, 'flat', ['flatWidth']);
  dimension(c, 'cut-square', 'Fabric and batting cut square', s + 2 * sa, 'cutting', ['flatWidth', 'seamAllowance']);
  dimension(c, 'darted-rim', 'Rim sewing length after closing four darts', 4 * (s - intake), 'sewing-line', ['flatWidth', 'dartIntake']);
  c.instructions.push(`Cut the four listed squares. The ${s} mm dimension is the flat stitching square before darts; assembled bowl diameter and depth require a fabric sample.`, 'Baste each batting square to the wrong side of its matching fabric. Quilt the layers together before forming darts.', `For each of four darts per shell, fold on its marked axis with fabric right sides together. Match the ${Math.hypot(depth, intake / 2).toFixed(1)} mm legs, stitch from the edge to the apex and secure the thread tails.`, `Trim dart bulk only after checking the stitched shape, leaving ${sa} mm beside each dart seam. Press neighbouring shell darts in opposite directions.`, `Place the two shaped shells right sides together. Match corners and dart ends, and sew the rim at ${sa} mm, leaving a turning gap between a corner and a dart.`, 'Trim corner bulk within the allowance, turn through the gap, and topstitch the rim closed. Check the fit against the actual bowl and record the sample.', 'This is a sewn holder pattern. Microwave or other thermal use is unverified and needs a specific material recipe and separate validation.');
  c.checks.push('Eight equal-leg darts remain marked on uncut squares', 'Post-dart rim lengths match between both shells', 'Original flat dimensions do not claim an assembled bowl fit');
  return finish(c);
}

function sock(c) {
  const o = c.options, factor = 1 - positive(o.reductionPercent, 'Circumference reduction', 0, 20) / 100, openingSize = o.ankleCircumference * factor;
  stretchChecks(c, { bodyCircumference: o.footCircumference, openingCircumference: openingSize, passCircumference: o.heelDiagonal });
  const length = positive(o.footLength, 'Foot length', 100, 400), height = o.footCircumference * factor / 2, ankle = openingSize / 2, toe = o.toeCircumference * factor / 2;
  if (o.heelDiagonal < o.ankleCircumference || toe > height || ankle > length * .6 || height > length * .65 || toe < 25 || o.legHeight < 20 || o.cuffHeight < 8) fail('SOCK_PROPORTIONS', 'Check the supplied foot/ankle dimensions: the heel diagonal must exceed the ankle, toes must not exceed the ball circumference, and the foot must leave room for an instep transition.');
  const rx = Math.min(length * .12, toe / 2), ry = toe / 2, heel = Math.min(height * .2, ankle * .2), blend = Math.min((length - rx - ankle) / 3, height * .3), top = height + blend + o.legHeight;
  if (blend <= 2 * o.seamAllowance) fail('SOCK_PROPORTIONS', 'The ankle leaves too little foot length for a usable instep curve.');
  const commands = [{ type: 'M', x: heel, y: 0 }, { type: 'L', x: length - rx, y: 0, edgeId: 'sole' },
    { type: 'C', x1: length - rx + K * rx, y1: 0, x2: length, y2: ry - K * ry, x: length, y: ry, edgeId: 'toe-lower' },
    { type: 'C', x1: length, y1: ry + K * ry, x2: length - rx + K * rx, y2: toe, x: length - rx, y: toe, edgeId: 'toe-upper' },
    { type: 'L', x: ankle + blend, y: height, edgeId: 'instep' }, { type: 'C', x1: ankle, y1: height, x2: ankle, y2: height, x: ankle, y: height + blend, edgeId: 'instep-curve' },
    { type: 'L', x: ankle, y: top, edgeId: 'front-leg' }, { type: 'L', x: 0, y: top, edgeId: 'ankle-opening' }, { type: 'L', x: 0, y: heel, edgeId: 'back-leg' },
    { type: 'C', x1: 0, y1: heel * (1 - K), x2: heel * (1 - K), y2: 0, x: heel, y: 0, edgeId: 'heel' }, { type: 'Z', edgeId: 'closure' }];
  // Explicit curve closure is equivalent to Z; do not treat its zero-length edge as a sewing segment.
  const quantity = o.pair ? 2 : 1, a = addPiece(c, 'sock-a', 'Sock side A', commands, { quantity, note: 'For each sock, pair this piece right sides together with side B. Greatest stretch runs across the foot/leg.' }), b = addPiece(c, 'sock-b', 'Sock side B', commands, { x: length + 60, quantity, note: 'Cut the mirror of side A for each sock. The seam runs around the foot and up front/back of the leg.' });
  for (const [id, edges] of [['foot', ['sole', 'toe-lower', 'toe-upper', 'instep', 'instep-curve']], ['leg-back-heel', ['front-leg', 'back-leg', 'heel']]]) pair(c, `sock-${id}`, itemReferences(a, edge => edges.includes(edge.edgeId)), itemReferences(b, edge => edges.includes(edge.edgeId)), { repeatCount: quantity });
  const cuffCommands = rectangle('cuff', '', 0, 0, openingSize, 2 * o.cuffHeight, {}).commands;
  cuffCommands.slice(1).forEach((command, i) => { command.edgeId = ['attach-a', 'short-a', 'attach-b', 'short-b'][i]; });
  const cuff = addPiece(c, 'sock-cuff', 'Folded ankle cuff', cuffCommands, { y: top + 50, quantity, note: 'Cuff cut length includes its joining allowances; the folded edge remains open around the ankle.' });
  pair(c, 'cuff-short-seam', reference(segment(cuff.id, 'short-a')), reference(segment(cuff.id, 'short-b')), { reverse: true, repeatCount: quantity });
  for (const edge of ['attach-a', 'attach-b']) pair(c, `cuff-${edge}`, reference(segment(cuff.id, edge)), reference(segment(a.id, 'ankle-opening'), segment(b.id, 'ankle-opening')), { reverse: edge === 'attach-b', repeatCount: quantity, note: 'Both raw cuff edges attach together as a folded band. Match cuff half marks to the two sock side seams; no easing is inferred.' });
  const fold = pathItem('sock-cuff-fold', 'Cuff fold, never sew closed', [{ type: 'M', x: 0, y: top + 50 + o.cuffHeight }, { type: 'L', x: openingSize, y: top + 50 + o.cuffHeight, edgeId: 'fold' }], { role: 'fold', pieceId: cuff.id }); c.items.push(fold);
  opening(c, 'ankle', 'Finished ankle opening', reference(segment(fold.id, 'fold')), 'Folded cuff');
  c.construction = 'two-mirrored-side-panels-and-folded-cuff';
  dimension(c, 'foot-length', 'Flat heel-to-toe stitching extent', length, 'flat', ['footLength']);
  dimension(c, 'foot-half-circumference', 'Flat ball-of-foot height per side', height, 'flat', ['footCircumference', 'reductionPercent']);
  dimension(c, 'ankle', 'Cuff attachment and opening circumference', openingSize, 'sewing-line', ['ankleCircumference', 'reductionPercent']);
  c.instructions.push(`Cut ${quantity} of each side, mirrored for each sock, and ${quantity} cuff band${quantity === 1 ? '' : 's'}. This experimental two-panel shape has a centre-sole seam; check seam comfort on a sample.`, 'Prewash and test the actual fabric in both directions, including recovery. Align the greatest stretch across the flat foot and leg; do not substitute woven fabric.', `Place side A and B right sides together. Match heel, toe and instep marks. Use a narrow stretch stitch at ${o.seamAllowance} mm around the foot and up both leg edges, leaving the ankle opening unsewn.`, `Join each cuff at its short edges, right sides together. Fold wrong sides together to a ${o.cuffHeight} mm finished band and mark the halfway point opposite its seam.`, 'Insert the sock into its cuff with right sides together. Match cuff seam and halfway mark to the sock seams, align both raw cuff edges to the ankle edge, and stretch-stitch all three layers together.', 'Finish seam bulk appropriately for the fabric, turn, and check heel passage, toe room, recovery and centre-sole seam comfort. Adjust the draft and record a sewn sample before making final socks.');
  c.checks.push('Two explicitly mirrored foot/leg seam paths match', 'Each cuff attachment edge matches both ankle edges together', 'Heel passage is checked against supplied fabric extension, separately from fit');
  return finish(c);
}

function glove(c) {
  const o = c.options, fingered = c.kind === 'fingered-glove', factor = 1 - positive(o.reductionPercent, 'Circumference reduction', 0, 20) / 100, wrist = o.wristCircumference * factor / 2, palm = o.handCircumference * factor / 2;
  stretchChecks(c, { bodyCircumference: o.handCircumference, openingCircumference: 2 * wrist, passCircumference: o.handCircumference });
  const thumbWidth = o.thumbCircumference * factor / 2, thumbRadius = thumbWidth / 2, angle = positive(o.thumbAngle, 'Thumb angle', 15, 60) * Math.PI / 180, palmLength = positive(o.palmLength, 'Palm length', 45, 200);
  if (wrist > palm || o.thumbWebHeight < thumbWidth || o.thumbWebHeight > palmLength * .75 || o.thumbLength <= (fingered ? thumbRadius + 8 : 10)) fail('HAND_PROPORTIONS', 'Check wrist, hand, thumb length and web position. Leave room below the thumb web and between its tip and the index finger.');
  const commands = [{ type: 'M', x: -wrist / 2, y: 0 }, { type: 'L', x: wrist / 2, y: 0, edgeId: 'wrist-opening' }, { type: 'L', x: palm / 2, y: palmLength * .55, edgeId: 'outer-palm' }];
  if (fingered) {
    const gap = positive(o.webGap, 'Finger gap', 2 * o.seamAllowance + 2, 30), fingers = ['little', 'ring', 'middle', 'index'].map(name => ({ name, width: positive(o[`${name}Circumference`], `${name} circumference`, 25, 100) * factor / 2, length: positive(o[`${name}Length`], `${name} length`, 25, 140) }));
    const bankWidth = fingers.reduce((sum, f) => sum + f.width, 0) + gap * 3;
    if (bankWidth > palm * 2) fail('FINGER_SPREAD', 'The finger widths and web spaces exceed twice the flat palm width. Check circumferences or reduce the spaces/allowance.');
    let x = bankWidth / 2;
    for (const [i, finger] of fingers.entries()) {
      const r = finger.width / 2, top = palmLength + finger.length;
      if (finger.length <= r + 8) fail('FINGER_PROPORTIONS', `The ${finger.name} finger is too short for its supplied circumference.`);
      if (!i) commands.push({ type: 'L', x, y: palmLength, edgeId: `${finger.name}-base-right` });
      commands.push({ type: 'L', x, y: top - r, edgeId: `${finger.name}-right` },
        { type: 'C', x1: x, y1: top - r + K * r, x2: x - r + K * r, y2: top, x: x - r, y: top, edgeId: `${finger.name}-tip-right` },
        { type: 'C', x1: x - r - K * r, y1: top, x2: x - 2 * r, y2: top - r + K * r, x: x - 2 * r, y: top - r, edgeId: `${finger.name}-tip-left` },
        { type: 'L', x: x - 2 * r, y: palmLength, edgeId: `${finger.name}-left` });
      x -= 2 * r;
      if (i < fingers.length - 1) {
        const radius = gap / 2, y = palmLength;
        commands.push({ type: 'C', x1: x, y1: y - K * radius, x2: x - radius + K * radius, y2: y - radius, x: x - radius, y: y - radius, edgeId: `web-${i}-right` },
          { type: 'C', x1: x - radius - K * radius, y1: y - radius, x2: x - gap, y2: y - K * radius, x: x - gap, y, edgeId: `web-${i}-left` });
        c.features.push({ id: `finger-web-${i}`, kind: 'finger-web', between: [finger.name, fingers[i + 1].name], point: { x: x - radius, y: y - radius }, openingWidthMm: gap, minimumCutChannelMm: gap - 2 * o.seamAllowance, note: 'Rounded web cutting channel. Clip only within the allowance after sewing, without cutting the stitching.' });
        x -= gap;
      }
      dimension(c, `${finger.name}-width`, `${finger.name} flat finger width`, finger.width, 'flat', [`${finger.name}Circumference`, 'reductionPercent']);
      dimension(c, `${finger.name}-length`, `${finger.name} web-to-tip extent`, finger.length, 'flat', [`${finger.name}Length`]);
    }
  } else commands.push({ type: 'L', x: palm / 2, y: palmLength, edgeId: 'upper-outer-palm' }, { type: 'L', x: -palm / 2, y: palmLength, edgeId: 'finger-opening' });
  const axis = { x: -Math.cos(angle), y: Math.sin(angle) }, normal = { x: Math.sin(angle), y: Math.cos(angle) }, center = { x: -palm / 2, y: o.thumbWebHeight - Math.cos(angle) * thumbRadius };
  const thumbPoint = (along, across) => ({ x: center.x + axis.x * along + normal.x * across, y: center.y + axis.y * along + normal.y * across });
  const root = thumbPoint(0, thumbRadius), end = o.thumbLength - (fingered ? thumbRadius : 0);
  commands.push({ type: 'L', ...root, edgeId: 'thumb-web' }, { type: 'L', ...thumbPoint(end, thumbRadius), edgeId: 'thumb-upper' });
  if (fingered) commands.push({ type: 'C', ...Object.fromEntries(Object.entries(thumbPoint(end + K * thumbRadius, thumbRadius)).map(([key, value]) => [`${key}1`, value])), ...Object.fromEntries(Object.entries(thumbPoint(end + thumbRadius, K * thumbRadius)).map(([key, value]) => [`${key}2`, value])), ...thumbPoint(end + thumbRadius, 0), edgeId: 'thumb-tip-upper' },
    { type: 'C', ...Object.fromEntries(Object.entries(thumbPoint(end + thumbRadius, -K * thumbRadius)).map(([key, value]) => [`${key}1`, value])), ...Object.fromEntries(Object.entries(thumbPoint(end + K * thumbRadius, -thumbRadius)).map(([key, value]) => [`${key}2`, value])), ...thumbPoint(end, -thumbRadius), edgeId: 'thumb-tip-lower' });
  else commands.push({ type: 'L', ...thumbPoint(end, -thumbRadius), edgeId: 'thumb-opening' });
  commands.push({ type: 'L', ...thumbPoint(0, -thumbRadius), edgeId: 'thumb-lower' }, { type: 'Z', edgeId: 'lower-inner-palm' });
  c.features.push({ id: 'thumb-web', kind: 'thumb-web', point: root, note: 'Thumb and index web is an authored concave join. Clip the sewn allowance cautiously; never cut through the seam.' });
  const quantity = o.pair ? 2 : 1, proto = pathItem('prototype', 'Glove', commands), bounds = vectorModelBounds({ items: [proto] }, 0), separation = bounds.width + 50;
  let a, b;
  try { a = addPiece(c, 'glove-palm', 'Glove palm', commands, { quantity, note: 'Two-panel stretch construction. For a pair, cut one right-hand and one left-hand palm.' }); b = addPiece(c, 'glove-back', 'Glove back', commands, { x: separation, quantity, note: 'Cut to match each palm right sides together. For a pair, mirror the complete second glove.' }); }
  catch (error) { if (error.code) throw error; fail('HAND_CONTOUR', `The thumb/fingers intersect for these measurements. Adjust the thumb web, spread or lengths. ${error.message}`); }
  for (const item of [a, b]) {
    for (const [edgeId, name] of [['wrist-opening', 'Wrist'], ...(!fingered ? [['finger-opening', 'Fingers'], ['thumb-opening', 'Thumb']] : [])]) opening(c, `${item.id}-${edgeId}`, `${item.name}: ${name}`, reference(segment(item.id, edgeId)), `Turn ${o.seamAllowance} mm once and stretch-stitch; do not join this edge to its matching panel.`);
  }
  pair(c, 'glove-outline', itemReferences(a, edge => !edge.edgeId.endsWith('-opening') && edge.length > 1e-8), itemReferences(b, edge => !edge.edgeId.endsWith('-opening') && edge.length > 1e-8), { repeatCount: quantity, note: 'Match the two panels by corresponding named fingers, thumb and webs, right sides together. Open hems are excluded.' });
  for (const [index, feature] of c.features.entries()) {
    feature.pieceIds = [a.id, b.id];
    for (const [item, offset] of [[a, 0], [b, separation]]) c.items.push({ ...label(`${item.id}-${feature.id}-label`, String(index + 1), feature.point.x + offset + 2, feature.point.y - 3), metadata: { role: 'annotation', calloutFeatureId: feature.id, pieceId: item.id } });
  }
  const cutBounds = vectorModelBounds({ items: c.items.filter(item => item.metadata?.role === 'cut') }, 0);
  c.items.push({ ...label('glove-web-callout-key', `Web${c.features.length > 1 ? `s 1–${c.features.length}` : ' 1'}: after sewing, clip the allowance toward each web; stop before the stitching.`, cutBounds.x, cutBounds.y + cutBounds.height + 16), metadata: { role: 'annotation', calloutKey: true } });
  c.construction = fingered ? 'two-panel-four-way-stretch-five-finger-glove' : 'two-panel-four-way-stretch-open-finger-and-thumb-glove';
  dimension(c, 'palm-width', 'Flat palm width between side seams', palm, 'flat', ['handCircumference', 'reductionPercent']);
  dimension(c, 'wrist-circumference', 'Two-panel wrist opening circumference', 2 * wrist, 'sewing-line', ['wristCircumference', 'reductionPercent']);
  dimension(c, 'thumb-width', 'Flat thumb width', thumbWidth, 'flat', ['thumbCircumference', 'reductionPercent']);
  c.instructions.push(`Cut ${quantity} palm${quantity === 1 ? '' : 's'} and ${quantity} back${quantity === 1 ? '' : 's'} from four-way stretch fabric. For a pair, mirror the complete second glove so both hands are supplied.`, 'Prewash and test stretch and recovery in both directions. Compare the printed seam outline with the actual hand before cutting; this two-panel draft does not contain woven-glove fourchettes or a fitted 3D thumb block.', `Finish the wrist${fingered ? '' : ', finger and thumb'} openings with a single ${o.seamAllowance} mm turn and a stretch stitch. Keep these edges open.`, `Place matching palm and back right sides together. Sew the outline at ${o.seamAllowance} mm, matching each named finger and thumb. Stop at each open hem; do not sew across it.`, fingered ? 'Sew slowly around each rounded fingertip and web. Try the glove inside out, then trim excess allowance and clip the finger/thumb webs only as needed to turn, stopping short of the stitching.' : 'Clip the thumb-web allowance only as needed for turning, stopping short of the stitching. The open thumb and finger hems remain separate.', 'Turn and test finger reach, thumb motion, web depth, wrist passage and fabric recovery. Record each hand’s sample and alterations before using the pattern for final fabric.');
  c.checks.push(fingered ? 'Five separately dimensioned digits with three finger-web cutting channels and an authored thumb web' : 'Wrist, finger and thumb openings excluded from panel joining', 'Matching mirrored panel edges retain stable identities', 'Body measurements remain separate from reduced flat widths');
  return finish(c);
}

export function generateAccessory(kind, input = {}) {
  const options = validateOptions(kind, input), c = context(kind, options);
  return kind === 'bowl-cosy' ? bowl(c) : kind === 'stretch-sock' ? sock(c) : glove(c);
}
