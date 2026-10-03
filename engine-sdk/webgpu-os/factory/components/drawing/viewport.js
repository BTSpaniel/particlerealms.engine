// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import * as ui from '../../sdk/ui/index.js';
import { formatMeasurement, rulerStepPixels } from './measurement.js';
import { hitCanvasSurface } from './surfaceCoordinates.js';

/** Shared fit calculation, previously owned by Paint's workspace layout. */
export function resolveFitZoom({ viewportWidth, viewportHeight, documentWidth, documentHeight, minZoom = .08, maxZoom = 2 } = {}) {
  if (![viewportWidth, viewportHeight, documentWidth, documentHeight].map(Number).every(Number.isFinite)) return null;
  if (viewportWidth < 8 || viewportHeight < 8 || documentWidth <= 0 || documentHeight <= 0) return null;
  const lower = Math.max(.001, Number(minZoom) || .08), upper = Math.max(lower, Number(maxZoom) || 2);
  return Math.max(lower, Math.min(upper, Math.min(viewportWidth / documentWidth, viewportHeight / documentHeight)));
}

export function createDrawingViewport({ bounds = { x: 0, y: 0, width: 210, height: 297 }, content = null, unit = 'mm', onViewChange = null, onNavigationStart = null, minZoom = .01, maxZoom = 100, navigation = true } = {}) {
  const root = ui.el('div', { class: 'fx-drawing-viewport', style: 'position:relative;min-width:0;min-height:100px;flex:1;overflow:hidden;background:var(--fx-bg-app);touch-action:none;' });
  ui.ensureUI(root);
  const stage = ui.el('div', { style: 'position:absolute;left:0;top:0;transform-origin:0 0;background:#fff;color:#17212b;box-shadow:var(--fx-shadow);' });
  const ruler = ui.el('div', { 'aria-hidden': 'true', style: 'position:absolute;left:0;top:0;right:0;height:22px;border-bottom:1px solid var(--fx-border);background:var(--fx-bg-raised);color:var(--fx-text-muted);pointer-events:none;overflow:hidden;font:var(--fx-text-xs) var(--fx-font-mono);z-index:3;' });
  const verticalRuler = ui.el('div', { 'aria-hidden': 'true', style: 'position:absolute;left:0;top:22px;bottom:0;width:22px;border-right:1px solid var(--fx-border);background:var(--fx-bg-raised);color:var(--fx-text-muted);pointer-events:none;overflow:hidden;font:var(--fx-text-xs) var(--fx-font-mono);z-index:3;' });
  const grid = ui.el('div', { style: 'position:absolute;inset:0;pointer-events:none;opacity:.22;' });
  stage.append(grid);
  const minimap = ui.button({ title: 'Drawing overview · arrow keys pan · Enter fits' });
  minimap.setAttribute('aria-label', 'Navigate drawing overview. Click to center; arrow keys move the view. Enter fits the document.');
  minimap.style.cssText = 'position:absolute;right:var(--fx-space-3);bottom:var(--fx-space-3);width:110px;height:78px;padding:0;border:1px solid var(--fx-border-strong);border-radius:var(--fx-radius-sm);background:var(--fx-bg-raised);box-shadow:var(--fx-shadow);overflow:hidden;z-index:3;';
  const miniDocument = ui.el('div', { style: 'position:absolute;background:#fff;border:1px solid var(--fx-border-strong);pointer-events:none;' });
  const miniView = ui.el('div', { style: 'position:absolute;border:2px solid var(--fx-accent);background:var(--fx-accent-soft);pointer-events:none;' });
  minimap.append(miniDocument, miniView); root.append(stage, ruler, verticalRuler, minimap);
  let gridState = { visible: false, spacing: unit === 'mm' ? 10 : 32 };
  let area, view = { x: 0, y: 0, zoom: 1 }, fitted = false, explicitView = false, destroyed = false;
  let dragging = null, pinch = null;
  const pointers = new Map(), offs = [];
  const on = (target, event, fn, opts) => offs.push(ui.on(target, event, fn, opts));
  function setBounds(next) {
    if (![next?.x, next?.y, next?.width, next?.height].every(Number.isFinite) || next.width <= 0 || next.height <= 0) throw new TypeError('Invalid drawing bounds');
    area = { ...next };
    stage.style.width = `${area.width}px`; stage.style.height = `${area.height}px`;
    setGrid(); render();
  }
  function render() {
    if (!area || destroyed) return;
    stage.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.zoom})`;
    const dpi = unit === 'mm' ? 25.4 : 72;
    const step = rulerStepPixels(view.zoom, dpi, unit), ticks = [];
    const first = Math.floor((area.x - view.x / view.zoom) / step) * step;
    const end = area.x + (root.clientWidth - view.x) / view.zoom;
    for (let value = first, count = 0; value <= end && count < 200; value += step, count++) {
      ticks.push(ui.el('span', { style: `position:absolute;border-left:1px solid currentColor;height:8px;top:0;left:${view.x + (value - area.x) * view.zoom}px;padding-left:3px;white-space:nowrap;`, text: formatMeasurement(value, dpi, unit) }));
    }
    ruler.replaceChildren(...ticks);
    const verticalTicks = [];
    for (let value = Math.floor((area.y - view.y / view.zoom) / step) * step, count = 0; value <= area.y + (root.clientHeight - view.y) / view.zoom && count < 200; value += step, count++) {
      verticalTicks.push(ui.el('span', { style: `position:absolute;border-top:1px solid currentColor;width:8px;left:0;top:${view.y + (value - area.y) * view.zoom - 22}px;writing-mode:vertical-rl;padding-top:3px;white-space:nowrap;`, text: formatMeasurement(value, dpi, unit) }));
    }
    verticalRuler.replaceChildren(...verticalTicks);
    minimap.style.display = root.clientHeight < 160 ? 'none' : '';
    const ratio = Math.min(100 / area.width, 68 / area.height), left = (110 - area.width * ratio) / 2, top = (78 - area.height * ratio) / 2;
    Object.assign(miniDocument.style, { left: `${left}px`, top: `${top}px`, width: `${area.width * ratio}px`, height: `${area.height * ratio}px` });
    Object.assign(miniView.style, { left: `${left - view.x / view.zoom * ratio}px`, top: `${top - view.y / view.zoom * ratio}px`, width: `${root.clientWidth / view.zoom * ratio}px`, height: `${root.clientHeight / view.zoom * ratio}px` });
    onViewChange?.({ ...view });
  }
  function setViewState(next) {
    if (destroyed) return;
    for (const key of ['x', 'y', 'zoom']) if (next[key] != null && !Number.isFinite(next[key])) throw new TypeError('Invalid view state');
    view = { ...view, ...next, zoom: Math.max(minZoom, Math.min(maxZoom, next.zoom ?? view.zoom)) };
    explicitView = true;
    fitted = false; render();
  }
  function fit() {
    const zoom = resolveFitZoom({ viewportWidth: root.clientWidth - 40, viewportHeight: root.clientHeight - 60, documentWidth: area.width, documentHeight: area.height, minZoom, maxZoom });
    if (zoom == null) return false;
    view = { x: (root.clientWidth - area.width * zoom) / 2, y: 32 + (root.clientHeight - 40 - area.height * zoom) / 2, zoom };
    fitted = true; render(); return true;
  }
  function toDocumentPoint(event) {
    const point = hitCanvasSurface({ clientX: event.clientX, clientY: event.clientY, stage, documentWidth: area.width, documentHeight: area.height, workspaceBounds: area, displayWidth: area.width, displayHeight: area.height, scale: view.zoom });
    return { x: point.x, y: point.y };
  }
  function zoomAt(clientX, clientY, zoom) {
    const point = toDocumentPoint({ clientX, clientY }), r = root.getBoundingClientRect();
    const next = Math.max(minZoom, Math.min(maxZoom, zoom));
    setViewState({ zoom: next, x: clientX - r.left - (point.x - area.x) * next, y: clientY - r.top - (point.y - area.y) * next });
  }
  function setGrid(next = {}) {
    const spacing = next.spacing ?? gridState.spacing;
    if (!Number.isFinite(spacing) || spacing <= 0 || spacing > 10000) throw new RangeError('Grid spacing must be a positive document-unit length');
    gridState = { visible: next.visible ?? gridState.visible, spacing };
    grid.style.display = gridState.visible ? 'block' : 'none';
    const gridColor = 'color-mix(in srgb,var(--fx-accent) 60%,#17212b)';
    grid.style.backgroundImage = `linear-gradient(to right,${gridColor} 1px,transparent 1px),linear-gradient(to bottom,${gridColor} 1px,transparent 1px)`;
    grid.style.backgroundSize = `${spacing}px ${spacing}px`;
    grid.style.backgroundPosition = `${-area.x % spacing}px ${-area.y % spacing}px`;
  }
  on(minimap, 'pointerdown', event => event.stopPropagation());
  on(minimap, 'click', event => {
    if (event.detail === 0) { onNavigationStart?.(); fit(); return; }
    const rect = minimap.getBoundingClientRect(), ratio = Math.min(100 / area.width, 68 / area.height);
    const x = (event.clientX - rect.left - (110 - area.width * ratio) / 2) / ratio, y = (event.clientY - rect.top - (78 - area.height * ratio) / 2) / ratio;
    onNavigationStart?.(); setViewState({ x: root.clientWidth / 2 - x * view.zoom, y: root.clientHeight / 2 - y * view.zoom });
  });
  on(minimap, 'keydown', event => {
    const delta = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[event.key];
    if (delta) { event.preventDefault(); event.stopPropagation(); onNavigationStart?.(); setViewState({ x: view.x + delta[0], y: view.y + delta[1] }); }
  });
  if (navigation) {
    on(root, 'wheel', event => {
      if (event.target.closest?.('input,select,textarea')) return;
      event.preventDefault();
      const unitSize = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientHeight : 1;
      zoomAt(event.clientX, event.clientY, view.zoom * Math.exp(-Math.max(-1200, Math.min(1200, event.deltaY * unitSize)) * .0016));
    }, { passive: false });
    on(root, 'pointerdown', event => {
      if (event.pointerType === 'touch') {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.size === 2) {
          onNavigationStart?.();
          const [a, b] = [...pointers.values()];
          pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: view.zoom, point: toDocumentPoint({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }) };
        }
      }
      if (event.button === 1 || (event.button === 0 && event.altKey)) {
        onNavigationStart?.();
        event.preventDefault(); event.stopPropagation(); root.setPointerCapture(event.pointerId);
        dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, view: { ...view } };
      }
    }, true);
    on(root, 'pointermove', event => {
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const next = Math.max(minZoom, Math.min(maxZoom, pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance)), rect = root.getBoundingClientRect();
        setViewState({ zoom: next, x: (a.x + b.x) / 2 - rect.left - (pinch.point.x - area.x) * next, y: (a.y + b.y) / 2 - rect.top - (pinch.point.y - area.y) * next });
      }
      if (dragging?.id !== event.pointerId) return;
      event.stopPropagation(); setViewState({ x: dragging.view.x + event.clientX - dragging.x, y: dragging.view.y + event.clientY - dragging.y });
    }, true);
    const finish = event => { pointers.delete(event.pointerId); if (pointers.size < 2) pinch = null; if (dragging?.id === event.pointerId) dragging = null; };
    on(root, 'pointerup', finish); on(root, 'pointercancel', finish);
  }
  // A part may mount while its owning panel is hidden. Fit once it has bounds,
  // including when a compact window first expands; preserve explicit navigation.
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (fitted || !explicitView) fit(); else render(); }) : null;
  observer?.observe(root);
  setBounds(bounds);
  if (content) stage.append(content);
  const frame = requestAnimationFrame(() => { if (!explicitView) fit(); });
  console.debug('[Factory][drawing.viewport][mount]');
  return {
    root, stage, ready: Promise.resolve(), fit, setBounds, setViewState, toDocumentPoint, setGrid,
    getGrid: () => ({ ...gridState }),
    getViewState: () => ({ ...view }), getBounds: () => ({ ...area }),
    setContent(node) { stage.replaceChildren(grid, ...(node ? [node] : [])); },
    destroy() { if (destroyed) return; destroyed = true; cancelAnimationFrame(frame); observer?.disconnect(); offs.splice(0).forEach(off => off()); root.remove(); console.debug('[Factory][drawing.viewport][destroy]'); },
  };
}
