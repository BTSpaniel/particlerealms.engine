// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import * as ui from '../../sdk/ui/index.js';
import { HistoryService } from '../../core/history/index.js';
import { createDrawingViewport } from './viewport.js';
import { createColorControl, createDrawingToolControl, createLayersPanel } from './controls.js';
import { VECTOR_SCHEMA, normalizeVectorModel, vectorModelBounds, vectorModelToSvg, vectorPathData, vectorTransformPoint } from './vectorModel.js';
import { snapVectorPoint, resolveRulerFrame } from './vectorGeometry.js';
import { resolveVectorDimensions } from './dimensions.js';
import { formatMeasurement, rulerStepPixels } from './measurement.js';
import { normalizeFeatureDefinition } from './featureControls.js';

const NS = 'http://www.w3.org/2000/svg';
let surfaceSequence = 0;
const TOOLS = Object.freeze([{ id: 'select', label: 'Select / move' }, { id: 'node', label: 'Edit points' }, { id: 'line', label: 'Line' }, { id: 'curve', label: 'Cubic curve' }, { id: 'pen', label: 'Connected path' }, { id: 'freehand', label: 'Freehand note' }, { id: 'text', label: 'Text label' }]);
const EDITOR_CSS = `
.fx-vector-editor{background:var(--fx-bg-app);color:var(--fx-text);}
.fx-vector-editor__chrome{flex:0 1 auto;min-height:44px;overflow:auto;scrollbar-width:thin;}
.fx-vector-editor__tools{flex-wrap:wrap;gap:var(--fx-space-2);padding:var(--fx-space-2);}
.fx-vector-editor__tools .fx-toolbar__spacer{display:none;}
.fx-vector-editor__tool-group{display:flex;align-items:center;gap:var(--fx-space-2);min-width:0;}
.fx-vector-editor__view-tools{margin-left:auto;}
.fx-vector-editor__actions{min-height:40px;padding:var(--fx-space-1) var(--fx-space-2);gap:var(--fx-space-1);flex-wrap:wrap;}
.fx-vector-editor__actions .fx-btn{flex:0 0 auto;white-space:nowrap;}
.fx-vector-editor__actions .fx-toolbar__spacer{display:none;}
.fx-vector-editor .fx-btn[aria-pressed="true"]{background:var(--fx-accent-soft);color:var(--fx-accent);border-color:var(--fx-accent);}
.fx-vector-editor__workspace{position:relative;display:flex;min-height:100px;flex:1;overflow:hidden;}
.fx-vector-editor__side{display:flex;flex-direction:column;gap:var(--fx-space-3);width:216px;flex:0 0 216px;min-width:0;overflow:auto;padding:var(--fx-space-2);border-left:1px solid var(--fx-border);background:var(--fx-bg-surface);}
.fx-vector-editor__side[hidden],.fx-vector-editor__label[hidden],.fx-vector-editor__coordinates[hidden]{display:none;}
.fx-vector-editor__coordinates{display:grid;grid-template-columns:1fr 1fr;gap:var(--fx-space-2);padding-top:var(--fx-space-2);border-top:1px solid var(--fx-border);}
.fx-vector-editor__coordinates .fx-field{min-width:0;}
.fx-vector-editor__side-header{display:flex;align-items:center;justify-content:space-between;gap:var(--fx-space-2);}
.fx-vector-editor__side-header .fx-label{color:var(--fx-text);font-weight:var(--fx-weight-bold);}
.fx-vector-editor[data-compact="true"] .fx-vector-editor__side{position:absolute;inset:var(--fx-space-2) var(--fx-space-2) var(--fx-space-2) auto;z-index:5;width:min(260px,calc(100% - 48px));border:1px solid var(--fx-border-strong);border-radius:var(--fx-radius);box-shadow:var(--fx-shadow-lg);}
.fx-vector-editor__hint{flex:1;min-width:0;}
.fx-vector-editor__zoom{flex:none;font-variant-numeric:tabular-nums;}
.fx-vector-editor svg:focus-visible{outline:2px solid var(--fx-accent);}
`;
function svgNode(name, attrs) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) if (value != null) node.setAttribute(key, String(value));
  return node;
}

/** Retained drawing surface shared by Paint and document-based design tools. */
export function createVectorEditorSurface({ model = { schema: VECTOR_SCHEMA, unit: 'mm', items: [] }, bounds = null, unit = model.unit, referenceElement = null, onChange = null, history = null, onSelectionChange = null,
  featureHandles = [], onFeatureEdit = null, dimensions = null, onDimensionSelect = null, rulerFrame = null, snapping = false } = {}) {
  const instanceId = `drawing.vector.${++surfaceSequence}`;
  const ownHistory = history ? null : new HistoryService();
  const undo = history ?? { push: entry => ownHistory.push(instanceId, entry), undo: () => ownHistory.undo(instanceId), redo: () => ownHistory.redo(instanceId), clear: () => ownHistory.dropStack(instanceId) };
  let data = normalizeVectorModel(model), area = bounds ?? vectorModelBounds(data), activeId = '', tool = 'select', selectedNode = null;
  let drag = null, penId = null, destroyed = false, sequence = 0, notifiedId = null, panelOpen = null, compact = false;
  let features = checkedFeatures(featureHandles), snapEnabled = snapping, rulerDefinition = rulerFrame, dimensionResults = { dimensions: [], issues: [], items: [] }, dimensionVisibility = 'selected';
  if (dimensions) data.dimensions = structuredClone(dimensions);
  const root = ui.scope(ui.el('section', { class: 'fx-vector-editor', 'aria-label': 'Vector drawing editor', style: 'display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;overflow:hidden;' }));
  root.dataset.drawingSurface = 'vector';
  ui.ensureUI(root);
  ui.injectAppCss(root, 'fx-vector-editor-styles', EDITOR_CSS);
  const zoomReadout = ui.el('span', { class: 'fx-vector-editor__zoom', 'aria-label': 'Drawing zoom', text: '100%' });
  const svg = svgNode('svg', { xmlns: NS, viewBox: `${area.x} ${area.y} ${area.width} ${area.height}`, width: '100%', height: '100%', tabindex: '0', role: 'application', 'aria-label': 'Drawing canvas. Choose a tool; Alt drag to pan, wheel to zoom. Enter finishes a path, Escape cancels.' });
  svg.style.cssText = 'position:absolute;inset:0;overflow:visible;touch-action:none;outline-offset:2px;';
  const reference = ui.el('div', { style: 'position:absolute;inset:0;pointer-events:none;overflow:hidden;' });
  if (referenceElement) reference.append(referenceElement);
  const artwork = svgNode('g', {}), measurementLayer = svgNode('g', { 'data-dimension-layer': '' }), rulerLayer = svgNode('g', { 'data-piece-ruler': '', 'pointer-events': 'none' }), handles = svgNode('g', {}), featureLayer = svgNode('g', { 'data-feature-layer': '' });
  svg.append(artwork, measurementLayer, rulerLayer, handles, featureLayer);
  const content = ui.el('div', { style: 'position:absolute;inset:0;' }, [reference, svg]);
  let viewport;
  viewport = createDrawingViewport({ bounds: area, content, unit, onViewChange: view => { zoomReadout.textContent = `${Math.round(view.zoom * 100)}%`; renderHandles(); renderMeasurements(); }, onNavigationStart: () => finishDrag(null, true) });
  const color = createColorControl({ value: '#17212b', onChange: value => { if (activeId) commit('Change stroke color', () => { selected().stroke = value; }); } });
  const toolControl = createDrawingToolControl({ tools: TOOLS, value: tool, onChange: setTool });
  toolControl.root.style.cssText = 'width:150px;max-width:100%;flex:0 1 150px;';
  const labelInput = ui.input({ value: 'Label', placeholder: 'Text label' }); labelInput.setAttribute('aria-label', 'Label text');
  labelInput.style.cssText = 'width:140px;flex:0 1 140px;';
  const labelField = ui.el('div', { class: 'fx-vector-editor__label', hidden: true }, labelInput);
  const widthInput = ui.input({ type: 'number', value: .35, onChange: value => { const n = Number(value); if (activeId && Number.isFinite(n) && n > 0) commit('Change line width', () => { selected().strokeWidth = n; }); } });
  widthInput.min = '.01'; widthInput.step = '.1'; widthInput.style.cssText = 'width:66px;padding:6px;'; widthInput.setAttribute('aria-label', `Stroke width (${unit})`);
  widthInput.title = `Stroke width in ${unit}`;
  const status = ui.el('span', { class: 'fx-vector-editor__hint', role: 'status', text: 'Select an object, or choose a drawing tool.' });
  const panelButton = ui.button({ label: 'Objects', size: 'sm', title: 'Show or hide drawing objects', onClick: () => { panelOpen = side.hidden; renderPanel(); } });
  panelButton.setAttribute('aria-controls', `${instanceId}.objects`);
  const tools = ui.toolbar({ start: [
    ui.el('div', { class: 'fx-vector-editor__tool-group' }, [toolControl.root, color.root, widthInput]), labelField,
    ui.el('div', { class: 'fx-vector-editor__tool-group fx-vector-editor__view-tools' }, [ui.button({ label: 'Fit', size: 'sm', title: 'Fit the whole document', onClick: () => viewport.fit() }), ui.button({ label: 'Undo', size: 'sm', onClick: () => undo.undo?.() }), ui.button({ label: 'Redo', size: 'sm', onClick: () => undo.redo?.() }), panelButton]),
  ] });
  tools.classList.add('fx-vector-editor__tools');
  const closeButton = ui.button({ label: 'Close path', size: 'sm', title: 'Join the last point to the first point', onClick: closePath });
  const rotateButton = ui.button({ label: 'Rotate 15°', size: 'sm', onClick: () => transformSelection('rotation', 15) });
  const mirrorXButton = ui.button({ label: 'Mirror horizontal', size: 'sm', onClick: () => transformSelection('scaleX', -1) });
  const mirrorYButton = ui.button({ label: 'Mirror vertical', size: 'sm', onClick: () => transformSelection('scaleY', -1) });
  const deleteButton = ui.button({ label: 'Delete', variant: 'danger', size: 'sm', onClick: deleteSelected });
  const gridButton = ui.button({ label: 'Grid', size: 'sm', title: `Show a ${unit === 'mm' ? '10 mm' : '32 px'} drawing grid`, onClick: () => { viewport.setGrid({ visible: !viewport.getGrid().visible }); gridButton.setAttribute('aria-pressed', String(viewport.getGrid().visible)); } });
  gridButton.setAttribute('aria-pressed', 'false');
  const snapButton = ui.button({ label: 'Snap', size: 'sm', title: 'Snap to endpoints, path midpoints, intersections and edges', onClick: () => { snapEnabled = !snapEnabled; snapButton.setAttribute('aria-pressed', String(snapEnabled)); } });
  snapButton.setAttribute('aria-pressed', String(snapEnabled));
  const measurementsButton = ui.button({ label: 'Measurements', size: 'sm', title: 'Show all attached measurements or selected-piece measurements', onClick: () => { dimensionVisibility = dimensionVisibility === 'all' ? 'selected' : 'all'; measurementsButton.setAttribute('aria-pressed', String(dimensionVisibility === 'all')); renderMeasurements(); } });
  measurementsButton.setAttribute('aria-pressed', 'false');
  const actions = ui.toolbar({ start: [
    gridButton, snapButton, measurementsButton, closeButton, rotateButton, mirrorXButton, mirrorYButton, deleteButton,
  ] });
  actions.classList.add('fx-vector-editor__actions');
  actions.setAttribute('role', 'group'); actions.setAttribute('aria-label', 'Object and view actions');
  const layers = createLayersPanel({ label: 'Drawing objects', onCommand: layerCommand });
  const coords = ui.el('div', { class: 'fx-vector-editor__coordinates', hidden: true });
  const xInput = coordinateInput('X'), yInput = coordinateInput('Y');
  coords.append(ui.field(`X (${unit})`, xInput), ui.field(`Y (${unit})`, yInput));
  const sideClose = ui.button({ label: 'Hide', variant: 'ghost', size: 'sm', title: 'Hide drawing objects', onClick: () => { panelOpen = false; renderPanel(); panelButton.focus(); } });
  const side = ui.el('aside', { id: `${instanceId}.objects`, class: 'fx-vector-editor__side', 'aria-label': 'Object inspector' }, [ui.el('div', { class: 'fx-vector-editor__side-header' }, [ui.label('Object inspector'), sideClose]), layers.root, coords]);
  const chrome = ui.el('div', { class: 'fx-vector-editor__chrome', role: 'region', 'aria-label': 'Drawing tools', tabindex: '0' }, [tools, actions]);
  root.append(chrome, ui.el('div', { class: 'fx-vector-editor__workspace' }, [viewport.root, side]), ui.statusbar([status, zoomReadout]));
  const offs = [];
  function renderPanel() {
    const focusWasInside = side.contains(document.activeElement);
    side.hidden = !(panelOpen ?? !compact);
    panelButton.setAttribute('aria-expanded', String(!side.hidden));
    panelButton.setAttribute('aria-pressed', String(!side.hidden));
    if (side.hidden && focusWasInside) panelButton.focus({ preventScroll: true });
  }
  offs.push(ui.on(side, 'keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); panelOpen = false; renderPanel(); }
  }));
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(entries => {
    compact = entries[0].contentRect.width < 640; root.dataset.compact = String(compact); renderPanel();
  }) : null;
  resizeObserver?.observe(root); renderPanel();
  const on = (event, fn) => offs.push(ui.on(svg, event, fn));
  function selected() { return data.items.find(item => item.id === activeId); }
  function clone() { return structuredClone(data); }
  function notifySelection() { notifiedId = activeId; onSelectionChange?.(activeId, selected() ? structuredClone(selected()) : null); }
  function publish(label, before, after) {
    onChange?.(clone(), { label, before: structuredClone(before), after: structuredClone(after) });
    notifySelection();
    console.debug('[Factory][drawing.vector][change]', { label, objects: data.items.length });
  }
  function restore(snapshot, label) { if (destroyed) return; const before = clone(); data = normalizeVectorModel(snapshot); render(); publish(label, before, data); }
  function finishCommit(label, before) {
    const after = normalizeVectorModel(data);
    if (JSON.stringify(before) === JSON.stringify(after)) { render(); return; }
    data = after;
    undo.push?.({ label, undo: () => restore(before, `Undo ${label}`), redo: () => restore(after, `Redo ${label}`) });
    render(); publish(label, before, after);
  }
  function commit(label, mutation) { const before = clone(); mutation(); finishCommit(label, before); }
  function setTool(next) {
    if (!TOOLS.some(t => t.id === next)) throw new TypeError('Unknown drawing tool');
    finishDrag(null, true); finishPen(); tool = next; toolControl.setValue(next); selectedNode = null;
    labelField.hidden = next !== 'text';
    status.textContent = next === 'pen' ? 'Click connected points. Enter finishes; Close path joins the ends.' : next === 'curve' ? 'Drag endpoints, then Edit points to adjust curve handles.' : next === 'freehand' ? 'Drag to draw a freehand annotation.' : 'Alt drag pans. Wheel zooms. Select objects to edit.';
    render();
  }
  function select(id) { activeId = data.items.some(item => item.id === id) ? id : ''; selectedNode = null; render(); }
  function newItem(type = 'path') {
    let id; do { id = `${instanceId}.${++sequence}`; } while (data.items.some(item => item.id === id));
    return { id, name: type === 'text' ? 'Label' : 'Path', type, commands: [], stroke: color.getValue(), strokeWidth: Math.max(.01, Number(widthInput.value) || .35), fill: type === 'text' ? color.getValue() : 'none', visible: true, locked: false, transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } };
  }
  function render() {
    if (destroyed) return;
    if (activeId && !data.items.some(item => item.id === activeId)) { activeId = ''; selectedNode = null; }
    artwork.replaceChildren(...data.items.filter(item => item.visible).map(item => {
      const t = item.transform, attrs = { 'data-item-id': item.id, stroke: item.stroke, 'stroke-width': item.strokeWidth, fill: item.fill, 'fill-rule': item.fillRule ?? 'nonzero', transform: `translate(${t.x} ${t.y}) rotate(${t.rotation}) scale(${t.scaleX} ${t.scaleY})` };
      const element = item.type === 'path' ? svgNode('path', { ...attrs, d: vectorPathData(item) }) : svgNode('text', { ...attrs, x: item.x, y: item.y, 'font-size': item.fontSize ?? 5, 'font-family': 'sans-serif' });
      if (item.type === 'text') element.textContent = item.text;
      element.style.pointerEvents = item.locked ? 'none' : 'visiblePainted';
      return element;
    }));
    layers.setRows(data.items.map(item => ({ ...item, canReorder: true })), activeId);
    const item = selected();
    closeButton.disabled = !item || item.locked || item.type !== 'path' || item.commands.length < 3 || item.commands.at(-1).type === 'Z';
    rotateButton.disabled = mirrorXButton.disabled = mirrorYButton.disabled = deleteButton.disabled = !item || item.locked;
    if (item) { color.setValue(item.stroke); widthInput.value = item.strokeWidth; }
    const p = selectedNode && item?.commands?.[selectedNode.index];
    coords.hidden = tool !== 'node' || !p;
    xInput.disabled = yInput.disabled = !p || item?.locked;
    if (p) { xInput.value = p[selectedNode.x]; yInput.value = p[selectedNode.y]; }
    renderHandles(); renderMeasurements();
    if (activeId !== notifiedId) notifySelection();
  }
  function renderHandles() {
    if (!handles || destroyed) return;
    handles.replaceChildren();
    const zoom = viewport?.getViewState?.().zoom || 1;
    featureLayer.replaceChildren(...features.flatMap(feature => {
      if (![feature.x, feature.y, feature.value].every(Number.isFinite)) return [];
      const handle = svgNode('circle', { cx: feature.x, cy: feature.y, r: 7 / zoom, fill: 'var(--fx-accent)', stroke: 'var(--fx-bg-surface)', 'stroke-width': 2 / zoom,
        'data-feature-id': feature.id, tabindex: feature.disabled ? '-1' : '0', role: 'slider', 'aria-label': feature.label || feature.id, 'aria-valuenow': feature.value,
        'aria-valuemin': feature.min, 'aria-valuemax': feature.max, 'aria-disabled': String(!!feature.disabled), 'pointer-events': feature.disabled ? 'none' : 'all' });
      const title = svgNode('title', {}); title.textContent = `${feature.label || feature.id}: ${feature.value}. Drag or use arrow keys.`; handle.append(title);
      return [handle];
    }));
    const item = selected();
    if (!item || !item.visible || item.locked) return;
    if (item.type === 'path') {
      const t = item.transform;
      handles.append(svgNode('path', { d: vectorPathData(item), transform: `translate(${t.x} ${t.y}) rotate(${t.rotation}) scale(${t.scaleX} ${t.scaleY})`, fill: 'none', stroke: 'var(--fx-accent)', 'stroke-width': 1 / zoom, 'stroke-dasharray': `${5 / zoom} ${3 / zoom}`, 'pointer-events': 'none' }));
      if (tool === 'node') item.commands.forEach((command, index) => {
        if (command.type === 'Z') return;
        const keys = command.type === 'C' ? [['x1', 'y1'], ['x2', 'y2'], ['x', 'y']] : [['x', 'y']];
        keys.forEach(([x, y]) => {
          const p = vectorTransformPoint(item, { x: command[x], y: command[y] });
          handles.append(svgNode('circle', { cx: p.x, cy: p.y, r: 5 / zoom, fill: x === 'x' ? 'var(--fx-bg-surface)' : 'var(--fx-warning)', stroke: 'var(--fx-accent)', 'stroke-width': 1 / zoom, 'data-node-index': index, 'data-node-x': x, 'data-node-y': y, 'data-item-id': item.id, tabindex: '0', role: 'button', 'aria-label': `Point ${index + 1} ${x === 'x' ? 'endpoint' : 'control'}; arrow keys move this point` }));
        });
      });
    }
  }
  function checkedFeatures(next) {
    if (!Array.isArray(next) || next.length > 2000) throw new TypeError('Feature handles must be an array of at most 2000 entries');
    const ids = new Set();
    return next.map(feature => { const checked = normalizeFeatureDefinition(feature, { handle: true }); if (ids.has(checked.id)) throw new TypeError('Feature handle IDs must be unique'); ids.add(checked.id); return checked; });
  }
  function renderMeasurements() {
    if (destroyed) return;
    dimensionResults = resolveVectorDimensions(data);
    const zoom = viewport?.getViewState?.().zoom || 1;
    const visibleIds = new Set(dimensionResults.dimensions.filter(result => dimensionVisibility === 'all' || dimensionVisibility === 'selected' && [...(result.definition?.anchors || []), ...(result.definition?.edgeRefs || [])].some(ref => ref.itemId === activeId)).map(result => result.id));
    measurementLayer.replaceChildren(...dimensionResults.items.filter(item => visibleIds.has(item.metadata.dimensionId)).map(item => {
      const attrs = { 'data-dimension-id': item.metadata.dimensionId, fill: item.fill, stroke: item.stroke, 'stroke-width': Math.max(item.strokeWidth ?? 0, .6 / zoom), 'pointer-events': item.type === 'text' ? 'all' : 'none' };
      const element = item.type === 'text' ? svgNode('text', { ...attrs, x: item.x, y: item.y, 'font-size': Math.max(item.fontSize, 10 / zoom), 'font-family': 'sans-serif', tabindex: '0', role: 'button', 'aria-label': item.text }) : svgNode('path', { ...attrs, d: vectorPathData(item) });
      if (item.type === 'text') element.textContent = item.text;
      return element;
    }));
    rulerLayer.replaceChildren();
    const frame = resolveRulerFrame(data, rulerDefinition);
    if (frame?.status === 'resolved') {
      const span = Math.max(area.width, area.height), step = rulerStepPixels(zoom, unit === 'mm' ? 25.4 : 72, unit), d = frame.direction;
      const position = (x, y) => ({ x: frame.origin.x + d.x * x - d.y * y, y: frame.origin.y + d.y * x + d.x * y });
      const path = [];
      for (const axis of [0, 1]) {
        const a = position(axis ? 0 : -span, axis ? -span : 0), b = position(axis ? 0 : span, axis ? span : 0);
        path.push({ type: 'M', ...a }, { type: 'L', ...b });
        for (let value = Math.ceil(-span / step) * step, count = 0; value <= span && count < 200; value += step, count++) {
          const start = position(axis ? 0 : value, axis ? value : 0), end = position(axis ? 4 / zoom : value, axis ? value : 4 / zoom);
          path.push({ type: 'M', ...start }, { type: 'L', ...end });
          const text = svgNode('text', { x: end.x + 3 / zoom, y: end.y - 3 / zoom, 'font-size': 10 / zoom, fill: 'var(--fx-accent)', 'font-family': 'sans-serif' });
          text.textContent = formatMeasurement(value, unit === 'mm' ? 25.4 : 72, unit); rulerLayer.append(text);
        }
      }
      rulerLayer.prepend(svgNode('path', { d: vectorPathData({ commands: path }), stroke: 'var(--fx-accent)', 'stroke-width': 1 / zoom, fill: 'none', opacity: '.8' }));
    }
  }
  function drawingPoint(event, options = {}) {
    const point = viewport.toDocumentPoint(event);
    if (!snapEnabled || event.shiftKey) return point;
    try { return snapVectorPoint(data, point, { radius: 8 / viewport.getViewState().zoom, ...options }).point; }
    catch (error) { status.textContent = error.message; return point; }
  }
  function featureEvent(phase, descriptor, value, point) {
    onFeatureEdit?.({ phase, featureId: descriptor.id, value, before: descriptor.value, point, source: 'handle' });
  }
  function coordinateInput(axis) {
    const input = ui.input({ type: 'number', onChange: value => {
      const item = selected(), numeric = Number(value);
      if (!selectedNode || !item || item.locked || !Number.isFinite(numeric)) return;
      commit('Set point coordinates', () => { item.commands[selectedNode.index][selectedNode[axis.toLowerCase()]] = numeric; });
    } });
    input.step = '.1'; input.style.cssText = 'width:100%;min-width:0;'; input.setAttribute('aria-label', `${axis} coordinate`); return input;
  }
  function transformSelection(property, amount) {
    const item = selected(); if (!item || item.locked) return;
    commit(property === 'rotation' ? 'Rotate object' : 'Mirror object', () => {
      const local = { ...item, transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } };
      const b = vectorModelBounds({ items: [local] }, 0), center = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      const before = vectorTransformPoint(item, center);
      item.transform[property] = property === 'rotation' ? item.transform[property] + amount : item.transform[property] * amount;
      const after = vectorTransformPoint(item, center);
      item.transform.x += before.x - after.x; item.transform.y += before.y - after.y;
    });
  }
  function deleteSelected() { const item = selected(); if (!item || item.locked) return; commit('Delete object', () => { data.items = data.items.filter(i => i.id !== activeId); activeId = ''; penId = null; }); }
  function closePath() { const item = selected(); if (item?.type !== 'path' || item.locked || item.commands.length < 3 || item.commands.at(-1).type === 'Z') return; commit('Close path', () => item.commands.push({ type: 'Z' })); penId = null; }
  function finishPen() { penId = null; }
  function layerCommand(command) {
    if (command.type === 'select') return select(command.id);
    const item = data.items.find(i => i.id === command.id); if (!item) return;
    commit(`Layer ${command.type}`, () => {
      if (command.type === 'visibility') item.visible = command.value;
      if (command.type === 'lock') item.locked = command.value;
      if (command.type === 'move') { const index = data.items.indexOf(item), next = index + command.direction; if (next >= 0 && next < data.items.length) [data.items[index], data.items[next]] = [data.items[next], data.items[index]]; }
    });
  }
  on('pointerdown', event => {
    if (event.button !== 0 || event.altKey || event.isPrimary === false || drag) return;
    event.preventDefault(); svg.focus();
    const featureId = event.target.closest?.('[data-feature-id]')?.getAttribute('data-feature-id');
    if (featureId) {
      const feature = features.find(value => value.id === featureId); if (!feature || feature.disabled || !onFeatureEdit) return;
      const point = viewport.toDocumentPoint(event);
      try { featureEvent('begin', feature, feature.value, point); drag = { id: event.pointerId, start: point, mode: 'feature', descriptor: structuredClone(feature), value: feature.value }; svg.setPointerCapture(event.pointerId); }
      catch (error) { status.textContent = error.message; }
      return;
    }
    const dimensionId = event.target.closest?.('[data-dimension-id]')?.getAttribute('data-dimension-id');
    if (dimensionId) { onDimensionSelect?.(dimensionResults.dimensions.find(value => value.id === dimensionId)); return; }
    const point = drawingPoint(event), targetId = event.target.closest?.('[data-item-id]')?.getAttribute('data-item-id');
    if (tool === 'text') { commit('Add label', () => { const item = { ...newItem('text'), x: point.x, y: point.y, fontSize: unit === 'mm' ? 5 : 20, text: labelInput.value || 'Label' }; data.items.push(item); activeId = item.id; }); return; }
    if (tool === 'pen') {
      commit('Add path point', () => {
        let item = data.items.find(i => i.id === penId);
        if (!item) { item = newItem(); item.commands.push({ type: 'M', ...point }); data.items.push(item); penId = activeId = item.id; }
        else item.commands.push({ type: 'L', ...vectorTransformPoint(item, point, true) });
      }); return;
    }
    if (tool === 'select' || tool === 'node') {
      if (targetId) activeId = targetId; else { select(''); return; }
      const item = selected(); if (!item || item.locked) return;
      const nodeIndex = event.target.getAttribute('data-node-index');
      selectedNode = nodeIndex != null ? { index: Number(nodeIndex), x: event.target.getAttribute('data-node-x'), y: event.target.getAttribute('data-node-y') } : null;
      drag = { id: event.pointerId, start: point, before: clone(), mode: selectedNode ? 'node' : 'move', node: selectedNode, itemId: activeId };
      render();
    } else {
      const before = clone(), item = newItem(); item.commands = [{ type: 'M', ...point }, { type: 'L', ...point }];
      if (tool === 'curve') item.commands[1] = { type: 'C', ...point, x1: point.x, y1: point.y, x2: point.x, y2: point.y };
      data.items.push(item); activeId = item.id;
      drag = { id: event.pointerId, start: point, before, mode: tool, itemId: item.id }; render();
    }
    svg.setPointerCapture(event.pointerId);
  });
  on('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    if (drag.mode === 'feature') {
      const point = viewport.toDocumentPoint(event), feature = drag.descriptor, direction = feature.direction ?? (feature.axis === 'x' ? { x: 1, y: 0 } : { x: 0, y: 1 });
      const norm = Math.hypot(direction.x, direction.y) || 1;
      let value = feature.value + ((point.x - drag.start.x) * direction.x + (point.y - drag.start.y) * direction.y) / norm * (feature.unitsPerDocumentUnit ?? 1);
      if (feature.step > 0) value = feature.value + Math.round((value - feature.value) / feature.step) * feature.step;
      value = Math.max(feature.min ?? -Infinity, Math.min(feature.max ?? Infinity, value));
      try { featureEvent('preview', feature, value, point); if (drag) drag.value = value; }
      catch (error) { finishDrag(null, true); status.textContent = error.message; }
      return;
    }
    const originalNode = drag.mode === 'node' ? drag.before.items.find(i => i.id === drag.itemId)?.commands[drag.node.index]?.nodeId : null;
    const point = drawingPoint(event, { excludeItemIds: drag.mode === 'move' ? [drag.itemId] : [], excludeNodeRefs: originalNode ? [{ itemId: drag.itemId, nodeId: originalNode }] : [] }), item = data.items.find(i => i.id === drag.itemId);
    if (!item) return;
    if (drag.mode === 'move') {
      const original = drag.before.items.find(i => i.id === item.id);
      item.transform.x = original.transform.x + point.x - drag.start.x; item.transform.y = original.transform.y + point.y - drag.start.y;
    } else if (drag.mode === 'node') {
      const local = vectorTransformPoint(item, point, true), command = item.commands[drag.node.index];
      command[drag.node.x] = local.x; command[drag.node.y] = local.y;
    } else if (drag.mode === 'freehand') {
      for (const sample of event.getCoalescedEvents?.() ?? [event]) {
        const p = viewport.toDocumentPoint(sample), last = item.commands.at(-1);
        if (Math.hypot(p.x - last.x, p.y - last.y) * viewport.getViewState().zoom >= 1) item.commands.push({ type: 'L', ...p });
      }
    } else if (drag.mode === 'line') item.commands[1] = { type: 'L', ...point };
    else if (drag.mode === 'curve') { const dx = point.x - drag.start.x; item.commands[1] = { type: 'C', ...point, x1: drag.start.x + dx / 3, y1: drag.start.y, x2: point.x - dx / 3, y2: point.y }; }
    render();
  });
  function finishDrag(event, cancel = false) {
    if (!drag || event && event.pointerId !== drag.id) return;
    const transaction = drag; drag = null;
    if (transaction.mode === 'feature') {
      try { featureEvent(cancel ? 'cancel' : 'commit', transaction.descriptor, cancel ? transaction.descriptor.value : transaction.value, null); }
      catch (error) { status.textContent = error.message; try { featureEvent('cancel', transaction.descriptor, transaction.descriptor.value, null); } catch { /* caller already reported the failed rule */ } }
      renderHandles(); return;
    }
    if (cancel) { data = transaction.before; render(); }
    else finishCommit(`Edit ${transaction.mode}`, transaction.before);
  }
  on('pointerup', event => finishDrag(event)); on('pointercancel', event => finishDrag(event, true)); on('lostpointercapture', event => finishDrag(event, true));
  on('keydown', event => {
    if (event.isComposing || event.defaultPrevented) return;
    const dimensionId = event.target.getAttribute?.('data-dimension-id');
    if (dimensionId && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onDimensionSelect?.(dimensionResults.dimensions.find(value => value.id === dimensionId)); return; }
    const featureId = event.target.getAttribute?.('data-feature-id');
    if (featureId && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      const feature = features.find(value => value.id === featureId); if (!feature || feature.disabled || !onFeatureEdit) return;
      event.preventDefault();
      const value = Math.max(feature.min ?? -Infinity, Math.min(feature.max ?? Infinity, feature.value + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) * (feature.step || 1) * (event.shiftKey ? 10 : 1)));
      try { featureEvent('begin', feature, feature.value, null); featureEvent('preview', feature, value, null); featureEvent('commit', feature, value, null); }
      catch (error) { try { featureEvent('cancel', feature, feature.value, null); } finally { status.textContent = error.message; } }
      [...featureLayer.children].find(node => node.getAttribute('data-feature-id') === featureId)?.focus(); return;
    }
    if (event.key === 'Escape') { event.preventDefault(); finishDrag(null, true); finishPen(); }
    if (event.key === 'Enter') { event.preventDefault(); finishPen(); }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? undo.redo?.() : undo.undo?.(); }
    const step = event.shiftKey ? 10 : 1;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (delta && selected() && !selected().locked) {
      event.preventDefault();
      const index = event.target.getAttribute?.('data-node-index');
      if (index != null) {
        const x = event.target.getAttribute('data-node-x'), y = event.target.getAttribute('data-node-y');
        selectedNode = { index: Number(index), x, y };
        commit('Nudge point', () => { selected().commands[Number(index)][x] += delta[0]; selected().commands[Number(index)][y] += delta[1]; });
        handles.querySelector(`[data-node-index="${Number(index)}"][data-node-x="${x}"]`)?.focus();
      } else commit('Nudge object', () => { selected().transform.x += delta[0]; selected().transform.y += delta[1]; });
    }
  });
  render();
  console.debug('[Factory][drawing.vector][mount]', { id: instanceId });
  return {
    root, ready: Promise.resolve(), viewport, setTool, select,
    getModel: clone, getViewState: viewport.getViewState, setViewState: viewport.setViewState,
    setModel(next, { preserveInteraction = false, preserveHistory = false } = {}) {
      const normalized = normalizeVectorModel(next);
      if (normalized.unit !== unit) throw new TypeError('Recreate the editor to change document units');
      if (!preserveInteraction) { finishDrag(null, true); finishPen(); activeId = ''; }
      data = normalized;
      if (activeId && !data.items.some(item => item.id === activeId)) activeId = '';
      if (penId && !data.items.some(item => item.id === penId)) penId = null;
      if (!preserveHistory) undo.clear?.();
      render();
    },
    setBounds(next) { area = next; viewport.setBounds(next); svg.setAttribute('viewBox', `${next.x} ${next.y} ${next.width} ${next.height}`); },
    setReferenceElement(node) { reference.replaceChildren(...(node ? [node] : [])); },
    setDimensions(next) { resolveVectorDimensions(data, { dimensions: next }); data.dimensions = structuredClone(next); renderMeasurements(); },
    setDimensionVisibility(value) { if (!['all', 'selected', 'none'].includes(value)) throw new TypeError('Unknown dimension visibility'); dimensionVisibility = value; measurementsButton.setAttribute('aria-pressed', String(value === 'all')); renderMeasurements(); },
    getDimensionDiagnostics: () => structuredClone(dimensionResults.issues),
    getDimensionItems: () => structuredClone(dimensionResults.items),
    setFeatureHandles(next) { features = checkedFeatures(next); renderHandles(); },
    setRulerFrame(next) { rulerDefinition = structuredClone(next); renderMeasurements(); return resolveRulerFrame(data, rulerDefinition); },
    getRulerFrame: () => resolveRulerFrame(data, rulerDefinition),
    setSnapping(value) { snapEnabled = !!value; snapButton.setAttribute('aria-pressed', String(snapEnabled)); },
    exportSvg: ({ includeDimensions = false, ...options } = {}) => vectorModelToSvg(includeDimensions ? { ...data, items: [...data.items, ...dimensionResults.items] } : data, { ...(includeDimensions ? {} : { bounds: area }), ...options }),
    destroy() { if (destroyed) return; finishDrag(null, true); destroyed = true; resizeObserver?.disconnect(); offs.splice(0).forEach(off => off()); viewport.destroy(); color.destroy(); layers.destroy(); toolControl.destroy(); ownHistory?.dropStack(instanceId); root.remove(); console.debug('[Factory][drawing.vector][destroy]', { id: instanceId }); },
  };
}
