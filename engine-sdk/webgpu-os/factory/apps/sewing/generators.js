// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { pathItem, polygonPath, seamAllowance, grainline, closedContour, cuttingContours, refreshDerived } from './geometry.js';
import { normalizeVectorModel, vectorModelBounds, vectorPathData } from '../../components/drawing/index.js';
import { newId, timestamp } from './record-values.js';

export const TEMPLATE_FIELDS = Object.freeze({
  tote: [['width', 'Finished width', 360], ['height', 'Finished height', 320], ['depth', 'Depth', 100], ['handleLength', 'Handle cut length', 650], ['handleWidth', 'Finished handle width', 25], ['seamAllowance', 'Seam allowance', 10]],
  quilt: [['blockSize', 'Finished block size', 300], ['rows', 'Block rows', 3], ['columns', 'Block columns', 3], ['seamAllowance', 'Seam allowance', 6.35]],
  skirt: [['waist', 'Waist circumference', 800], ['ease', 'Wearing ease', 10], ['length', 'Finished skirt length', 600], ['bandHeight', 'Finished waistband height', 35], ['overlap', 'Closure overlap', 30], ['seamAllowance', 'Seam allowance', 10], ['hem', 'Hem allowance', 20]],
});

function positive(value, label, min = 1, max = 10000) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return n;
}
const rectangle = (id, name, x, y, width, height, metadata) => polygonPath(id, name, [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }], metadata);
function label(id, text, x, y) { return { id, name: text, type: 'text', x, y, text, fontSize: 6, fill: '#172933', stroke: '#172933', strokeWidth: .2, visible: true, locked: true }; }

function draft(name, template, options, items, pieces, instructions, checks) {
  const model = normalizeVectorModel({ schema: 'factory.vector.v1', unit: 'mm', items });
  return { id: newId(), name, createdAt: timestamp(), recipe: { template, version: 1, options: structuredClone(options) },
    model, bounds: vectorModelBounds(model, 20), pieces, instructions, checks, validation: 'Digital construction checked; physical sample not yet recorded',
    sampleVerified: false, sampleNotes: '', manual: false };
}

export function generateTote(options) {
  const width = positive(options.width, 'Width', 80, 1500), height = positive(options.height, 'Height', 80, 1500);
  const depth = positive(options.depth, 'Depth', 20, Math.min(width, height));
  const sa = positive(options.seamAllowance, 'Seam allowance', 1, 40), handles = positive(options.handleLength, 'Handle length', 100, 2000);
  const handleWidth = positive(options.handleWidth, 'Handle width', 10, 100), lining = options.lining !== false;
  const panelW = width + depth, panelH = height + depth / 2, items = [], pieces = [];
  for (const [index, fabric] of (lining ? ['Outer', 'Lining'] : ['Outer']).entries()) {
    const id = `tote-${fabric.toLowerCase()}`, x = index * (panelW + 70), y = 0;
    const seam = rectangle(id, `${fabric} panel`, x, y, panelW, panelH, { role: 'seam', cutQuantity: 2, material: fabric });
    items.push(seam, seamAllowance(seam, sa), grainline(seam), label(`${id}-label`, `${fabric.toUpperCase()} · Cut 2`, x + 15, y + 25));
    pieces.push({ id, name: `${fabric} panel`, cutQuantity: 2, material: fabric, cutWidthMm: panelW + 2 * sa, cutHeightMm: panelH + 2 * sa,
      note: `Box each bottom corner with a ${depth} mm seam measured ${depth / 2} mm from the seam intersection` });
  }
  const handle = rectangle('tote-handles', 'Handles', 0, panelH + 70, handles, handleWidth * 4, { role: 'cut', cutQuantity: 2 });
  items.push(handle, label('tote-handles-label', 'HANDLES · Cut 2 · fold edges to center, then fold in half', 10, panelH + 85));
  pieces.push({ id: handle.id, name: 'Handle strips', cutQuantity: 2, material: 'Outer', cutWidthMm: handles, cutHeightMm: handleWidth * 4, note: 'Cut size includes folding; no extra seam allowance' });
  return draft('Boxed tote', 'tote', { ...options, lining }, items, pieces, [
    `Cut the listed panels. Finished bag: ${width} × ${height} × ${depth} mm; all panel seams ${sa} mm.`,
    'Prepare handle strips: fold both long edges to the center, fold in half again, press, and topstitch both long sides.',
    `Place outer panels right sides together. Sew side and bottom seams at ${sa} mm.`,
    `Flatten each bottom corner, aligning side and bottom seam. Mark ${depth / 2} mm from their intersection toward the bag; sew across a ${depth} mm line. Trim excess leaving ${sa} mm.`,
    'Baste one handle to each outer panel, ends equally spaced from center and pointing toward the bag bottom. Keep ends clear of side seams.',
    ...(lining ? [`Repeat panel/corner construction for lining, leaving a 100 mm turning gap in its bottom seam.`,
      `With outer and lining right sides together, enclose the handles and sew around the top at ${sa} mm.`,
      'Turn through the lining gap, close the gap, press the top edge and topstitch.'] : [
      `Finish exposed seams. Fold the top edge inward ${sa} mm, press, secure handles, and topstitch. The cut panels already include this top allowance; finished height stays ${height} mm.`,
    ]),
    'Check handle security and record the sewn dimensions before marking the template sample verified.',
  ], ['Outer and lining attachment perimeters match', 'Box-corner construction accounts for finished depth', 'Handle cut dimensions include folding']);
}

export function generateQuilt(options) {
  const blockSize = positive(options.blockSize, 'Block size', 30, 1500), rows = positive(options.rows, 'Rows', 1, 30), columns = positive(options.columns, 'Columns', 1, 30);
  if (!Number.isInteger(rows) || !Number.isInteger(columns)) throw new Error('Quilt rows and columns must be whole numbers');
  const cells = { square: 1, 'four-patch': 2, 'nine-patch': 3 }[options.blockType || 'four-patch'];
  if (!cells) throw new Error('Choose a supported quilt block');
  const sa = positive(options.seamAllowance, 'Seam allowance', .1, 30), unit = blockSize / cells;
  const totals = [0, 0];
  for (let r = 0; r < rows * cells; r++) for (let c = 0; c < columns * cells; c++) totals[(r + c) % 2]++;
  const items = [], pieces = [];
  for (let i = 0; i < 2; i++) {
    if (!totals[i]) continue;
    const id = `quilt-${i}`, name = `Fabric ${i ? 'B' : 'A'} square`, x = i * (unit + 70);
    const seam = rectangle(id, name, x, 0, unit, unit, { role: 'seam', cutQuantity: totals[i] });
    items.push(seam, seamAllowance(seam, sa), label(`${id}-label`, `${name} · Cut ${totals[i]}`, x + 5, 15));
    pieces.push({ id, name, cutQuantity: totals[i], material: `Fabric ${i ? 'B' : 'A'}`, cutWidthMm: unit + 2 * sa, cutHeightMm: unit + 2 * sa,
      note: `${unit} mm finished cell; ${blockSize + 2 * sa} mm unfinished block` });
  }
  return draft(`${options.blockType || 'four-patch'} quilt`, 'quilt', options, items, pieces, [
    `Finished top: ${columns * blockSize} × ${rows * blockSize} mm before borders. Cut squares ${unit + 2 * sa} × ${unit + 2 * sa} mm.`,
    `Use an exact ${sa} mm seam allowance throughout. A quarter inch is 6.35 mm.`,
    `Arrange ${rows * cells} rows of ${columns * cells} squares alternating A and B like a checkerboard. Begin the first row with A, the second with B.`,
    `Assemble each ${cells} × ${cells} group as a block. Sew cells into rows, then join rows; press adjacent seams in opposite directions.`,
    `Check each block measures ${blockSize + 2 * sa} mm unfinished. Join ${columns} blocks per row, then ${rows} rows.`,
    'Measure the completed top, then select backing/batting with the extra margins required by your quilting method. Binding and borders are separate project materials.',
  ], ['Cut dimensions include two edge allowances', 'Fabric quantities sum to the complete grid', 'Finished and unfinished dimensions are distinct']);
}

function arc(radius, start, end) {
  const count = Math.ceil(Math.abs(end - start) / (Math.PI / 4)), result = [];
  for (let i = 0; i < count; i++) {
    const a = start + (end - start) * i / count, b = start + (end - start) * (i + 1) / count, k = 4 / 3 * Math.tan((b - a) / 4);
    result.push({ type: 'C', x1: radius * (Math.cos(a) - k * Math.sin(a)), y1: radius * (Math.sin(a) + k * Math.cos(a)),
      x2: radius * (Math.cos(b) + k * Math.sin(b)), y2: radius * (Math.sin(b) - k * Math.cos(b)), x: radius * Math.cos(b), y: radius * Math.sin(b) });
  }
  return result;
}

export function generateSkirt(options) {
  if (options.fullness != null && !['full', 'half'].includes(options.fullness)) throw new Error('Choose a full or half circle skirt');
  const waist = positive(options.waist, 'Waist', 300, 2500), ease = positive(options.ease, 'Ease', 0, 100);
  const length = positive(options.length, 'Length', 100, 1600), band = positive(options.bandHeight, 'Band height', 10, 150);
  const overlap = positive(options.overlap, 'Closure overlap', 10, 80), sa = positive(options.seamAllowance, 'Seam allowance', 1, 30), hem = positive(options.hem, 'Hem', 5, 60);
  const fullness = options.fullness === 'half' ? .5 : 1, theta = Math.PI * fullness, circumference = waist + ease;
  const radius = circumference / (2 * Math.PI * fullness), outer = radius + length;
  if (radius - sa <= sa) throw new Error('Waist allowance is too large for this skirt radius');
  const seam = pathItem('skirt-panel', 'Skirt panel', [{ type: 'M', x: radius, y: 0 }, { type: 'L', x: outer, y: 0 },
    ...arc(outer, 0, theta), { type: 'L', x: radius * Math.cos(theta), y: radius * Math.sin(theta) }, ...arc(radius, theta, 0), { type: 'Z' }], { role: 'seam', cutQuantity: 2 });
  const rCut = radius - sa, outerCut = outer + hem, startOuter = -Math.asin(sa / outerCut), endOuter = theta - startOuter;
  const startInner = -Math.asin(sa / rCut), endInner = theta - startInner;
  const cut = pathItem('skirt-panel-cut', 'Skirt panel cutting line', [{ type: 'M', x: rCut * Math.cos(startInner), y: -sa },
    { type: 'L', x: outerCut * Math.cos(startOuter), y: -sa }, ...arc(outerCut, startOuter, endOuter),
    { type: 'L', x: rCut * Math.cos(endInner), y: rCut * Math.sin(endInner) }, ...arc(rCut, endInner, startInner), { type: 'Z' }],
    { role: 'cut', templateSourceId: seam.id, seamSignature: JSON.stringify(seam.commands), seamAllowanceMm: sa, hemMm: hem });
  cut.stroke = '#0a867a'; cut.locked = true;
  closedContour(cut);
  const bandCut = rectangle('skirt-waistband', 'Waistband cutting line', outer + 80, 0, circumference + overlap + 2 * sa, 2 * band + 2 * sa, { role: 'cut', cutQuantity: 1 });
  const items = [seam, cut, grainline(seam), label('skirt-label', 'SKIRT PANEL · Cut 2 · zipper in one side seam', radius + 20, 35), bandCut,
    label('band-label', 'WAISTBAND · Cut 1 fabric + interfacing', outer + 90, 25)];
  return draft(`${fullness === 1 ? 'Full' : 'Half'} circle skirt`, 'skirt', options, items, [
    { id: seam.id, name: 'Skirt panel', cutQuantity: 2, material: 'Stable woven', note: `Waist seam radius ${radius.toFixed(2)} mm; waist seam allowance ${sa} mm; hem ${hem} mm` },
    { id: bandCut.id, name: 'Waistband', cutQuantity: 1, material: 'Fabric + interfacing', cutWidthMm: circumference + overlap + 2 * sa, cutHeightMm: 2 * band + 2 * sa, note: `${overlap} mm closure overlap` },
  ], [
    `Use stable woven fabric. Waist seam circumference is ${circumference} mm, including ${ease} mm wearing ease. Prepare fabric first.`,
    `Cut two skirt panels, one waistband and matching interfacing. Check the full pattern footprint against usable fabric; never shrink the print to fit fabric.`,
    `Sew both side seams at ${sa} mm, leaving a zipper opening in one seam. Insert the zipper using its manufacturer's method.`,
    `Interface the waistband. Mark ${sa} mm end allowances and ${overlap} mm overlap separately. Match the ${circumference} mm attachment length to the skirt waist.`,
    `Attach the waistband at ${sa} mm; fold lengthwise, finish the ends, turn and secure the inner edge. Add a button/hook closure at the overlap.`,
    `Hang the skirt to allow bias sections to settle, level the hem, then finish within the ${hem} mm hem allowance.`,
    'Fit a sample and record waistband comfort and hem behavior before using valuable fabric.',
  ], ['Panel waist arcs equal waist plus explicit ease', 'Waist cut radius subtracts seam allowance', 'Hem and side allowances are independent']);
}

export function generateTemplate(template, options) {
  const generator = { tote: generateTote, quilt: generateQuilt, skirt: generateSkirt }[template];
  if (!generator) throw new Error('Unknown sewing template');
  return generator(options);
}

export function assertDraftCuttable(draftRecord) {
  if (draftRecord.cuttingIssues?.length) throw new Error('Correct the reported pattern contours before cutting export');
  const model = normalizeVectorModel(draftRecord.model);
  if (['import', 'trace'].includes(draftRecord.recipe?.template)) {
    const roles = new Set(['cut', 'seam', 'grainline', 'fold', 'notch', 'dart']);
    model.items = model.items.filter(item => item.type === 'path' && roles.has(item.metadata?.role) && !item.metadata?.reviewReasons?.length);
    if (!model.items.some(item => item.visible && item.metadata?.role === 'cut')) throw new Error('Confirm a closed cutting contour before exporting an imported or traced pattern. Unclassified references remain available in the original and SVG.');
  }
  const refreshed = refreshDerived(model);
  for (const item of model.items) {
    if (!item.visible || item.type !== 'path') continue;
    if (item.metadata?.role === 'cut' || item.metadata?.role === 'seam') cuttingContours(item);
    if (item.metadata?.sourceId && item.metadata?.role === 'cut') {
      const actual = refreshed.items.find(candidate => candidate.id === item.id);
      if (!actual || vectorPathData(actual) !== vectorPathData(item)) throw new Error('A cutting line is stale. Regenerate the allowance before cutting export');
    }
    if (item.metadata?.templateSourceId) {
      const parent = model.items.find(candidate => candidate.id === item.metadata.templateSourceId);
      const identity = item.metadata.seamTransformSignature ? JSON.parse(item.metadata.seamTransformSignature) : { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
      if (!parent || vectorPathData(parent) !== vectorPathData({ commands: JSON.parse(item.metadata.seamSignature) }) || ['x','y','rotation','scaleX','scaleY'].some(key => !Number.isFinite(identity[key]) || parent.transform?.[key] !== identity[key])) {
        throw new Error('This template has been reshaped; regenerate or replace its cutting lines before cutting export');
      }
    }
  }
  return model;
}

// Construction generators share the existing physical piece and revision builders.
export { positive, rectangle, label, draft as createTemplateDraft };
