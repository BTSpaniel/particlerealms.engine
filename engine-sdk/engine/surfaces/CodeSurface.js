// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/surfaces/CodeSurface.js — an editable, syntax-lite code view rendered to
// a canvas so it can live on a mesh. Supports typing, Backspace, Enter, arrow
// navigation, Home/End, and vertical scroll that follows the caret. Highlighting
// is intentionally lightweight (comments / strings / numbers / keywords) — enough
// to read code on a surface without pulling in a full language grammar.

import { make2DCanvas } from './CanvasSurface.js';

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class',
  'new', 'import', 'export', 'from', 'await', 'async', 'true', 'false', 'null', 'undefined',
  'this', 'of', 'in', 'typeof', 'break', 'continue', 'switch', 'case', 'default',
]);

const THEME = {
  bg: '#0b1020', gutter: '#11182e', gutterText: '#46506e', text: '#d7e0f4',
  keyword: '#7cc7ff', string: '#9be58b', number: '#ffd479', comment: '#5a6784',
  caret: '#5eead4',
};

function tokenize(line) {
  const out = [];
  const ci = line.indexOf('//');
  const code = ci >= 0 ? line.slice(0, ci) : line;
  const comment = ci >= 0 ? line.slice(ci) : '';
  const re = /(["'`])(?:\\.|(?!\1).)*\1?|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*|\s+|[^\s\w]/g;
  let m;
  while ((m = re.exec(code))) {
    const tok = m[0];
    let color = THEME.text;
    if (/^["'`]/.test(tok)) color = THEME.string;
    else if (/^\d/.test(tok)) color = THEME.number;
    else if (KEYWORDS.has(tok)) color = THEME.keyword;
    out.push({ text: tok, color });
  }
  if (comment) out.push({ text: comment, color: THEME.comment });
  return out;
}

/**
 * @param {object} opts { width, height, text, fontSize, editable }
 */
export function createCodeSurface(opts = {}) {
  const width = Math.max(1, Math.floor(opts.width ?? 768));
  const height = Math.max(1, Math.floor(opts.height ?? 512));
  const { canvas, ctx } = make2DCanvas(width, height);
  const fontSize = opts.fontSize ?? 18;
  const lineH = Math.round(fontSize * 1.4);
  const pad = 10;
  const gutterW = Math.round(fontSize * 2.6);
  const editable = opts.editable !== false;

  let lines = String(opts.text ?? '').split('\n');
  if (!lines.length) lines = [''];
  const caret = { row: 0, col: 0 };
  let scroll = 0; // first visible row
  let blink = 0;

  const self = { canvas, ctx, width, height, flipY: false, dirty: true };

  function rowsVisible() { return Math.max(1, Math.floor((self.height - pad * 2) / lineH)); }
  function clampCaret() {
    caret.row = Math.max(0, Math.min(lines.length - 1, caret.row));
    caret.col = Math.max(0, Math.min(lines[caret.row].length, caret.col));
  }
  function ensureCaretVisible() {
    const vis = rowsVisible();
    if (caret.row < scroll) scroll = caret.row;
    else if (caret.row >= scroll + vis) scroll = caret.row - vis + 1;
    scroll = Math.max(0, Math.min(Math.max(0, lines.length - vis), scroll));
  }

  function setText(text) { lines = String(text ?? '').split('\n'); if (!lines.length) lines = ['']; caret.row = caret.col = 0; scroll = 0; self.dirty = true; }
  function getText() { return lines.join('\n'); }

  function insert(str) {
    const ln = lines[caret.row];
    if (str === '\n') {
      const before = ln.slice(0, caret.col); const after = ln.slice(caret.col);
      lines.splice(caret.row, 1, before, after);
      caret.row++; caret.col = 0;
    } else {
      lines[caret.row] = ln.slice(0, caret.col) + str + ln.slice(caret.col);
      caret.col += str.length;
    }
    self.dirty = true;
  }
  function backspace() {
    if (caret.col > 0) {
      const ln = lines[caret.row];
      lines[caret.row] = ln.slice(0, caret.col - 1) + ln.slice(caret.col);
      caret.col--;
    } else if (caret.row > 0) {
      const prev = lines[caret.row - 1];
      caret.col = prev.length;
      lines[caret.row - 1] = prev + lines[caret.row];
      lines.splice(caret.row, 1);
      caret.row--;
    }
    self.dirty = true;
  }

  self.render = function render(dt = 0) {
    blink = (blink + dt) % 1.0;
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, self.width, self.height);
    ctx.fillStyle = THEME.gutter;
    ctx.fillRect(0, 0, gutterW, self.height);
    ctx.font = `${fontSize}px ui-monospace, Consolas, monospace`;
    ctx.textBaseline = 'top';
    const vis = rowsVisible();
    for (let r = scroll; r < Math.min(lines.length, scroll + vis); r++) {
      const y = pad + (r - scroll) * lineH;
      ctx.fillStyle = THEME.gutterText;
      ctx.fillText(String(r + 1).padStart(3, ' '), 6, y);
      let x = gutterW + pad;
      for (const tok of tokenize(lines[r])) {
        ctx.fillStyle = tok.color;
        ctx.fillText(tok.text, x, y);
        x += ctx.measureText(tok.text).width;
      }
    }
    // caret
    if (editable && blink < 0.6 && caret.row >= scroll && caret.row < scroll + vis) {
      const pre = lines[caret.row].slice(0, caret.col);
      const cx = gutterW + pad + ctx.measureText(pre).width;
      const cy = pad + (caret.row - scroll) * lineH;
      ctx.fillStyle = THEME.caret;
      ctx.fillRect(cx, cy, 2, fontSize);
    }
    if (self.realtime) self.dirty = true;
  };
  self.realtime = !!opts.caretBlink; // blink needs realtime; otherwise static until edited

  self.onKey = function onKey(e) {
    if (!editable) return;
    const k = e.key;
    if (k === 'Backspace') backspace();
    else if (k === 'Enter') insert('\n');
    else if (k === 'Tab') insert('  ');
    else if (k === 'ArrowLeft') { caret.col > 0 ? caret.col-- : (caret.row > 0 && (caret.row--, caret.col = lines[caret.row].length)); }
    else if (k === 'ArrowRight') { caret.col < lines[caret.row].length ? caret.col++ : (caret.row < lines.length - 1 && (caret.row++, caret.col = 0)); }
    else if (k === 'ArrowUp') caret.row--;
    else if (k === 'ArrowDown') caret.row++;
    else if (k === 'Home') caret.col = 0;
    else if (k === 'End') caret.col = lines[caret.row].length;
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey) insert(k);
    else return;
    clampCaret(); ensureCaretVisible(); self.dirty = true;
  };

  self.onPointer = function onPointer(e) {
    // e.u/e.v in [0,1] surface space → place caret.
    if (e.type !== 'down' || typeof e.u !== 'number') return;
    const px = e.u * self.width; const py = e.v * self.height;
    const row = Math.max(0, Math.min(lines.length - 1, scroll + Math.floor((py - pad) / lineH)));
    caret.row = row;
    // approximate column by measuring progressively
    const target = px - gutterW - pad; let col = 0; let w = 0;
    const ln = lines[row];
    while (col < ln.length) { const cw = ctx.measureText(ln[col]).width; if (w + cw / 2 > target) break; w += cw; col++; }
    caret.col = col; clampCaret(); self.dirty = true;
  };

  self.resize = function resize(w, h) { self.width = canvas.width = Math.max(1, Math.floor(w)); self.height = canvas.height = Math.max(1, Math.floor(h)); self.dirty = true; };
  self.setText = setText;
  self.getText = getText;
  self.dispose = function dispose() {};
  return self;
}
