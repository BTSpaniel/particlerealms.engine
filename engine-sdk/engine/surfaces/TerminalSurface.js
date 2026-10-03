// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/surfaces/TerminalSurface.js — an interactive terminal/REPL rendered to a
// canvas so it can live on a mesh. It keeps a scrollback buffer + an input line,
// echoes typing, and dispatches a command on Enter via `onCommand(line) -> string
// | string[] | void`. Safe by design: it only renders its OWN buffer — there is
// no shell, no eval, nothing external (the host wires whatever onCommand does).

import { make2DCanvas } from './CanvasSurface.js';

const THEME = { bg: '#05080f', text: '#cfe3d6', prompt: '#5eead4', dim: '#5a6784', caret: '#9be58b' };

/**
 * @param {object} opts { width, height, fontSize, prompt, banner, maxLines, onCommand }
 */
export function createTerminalSurface(opts = {}) {
  const width = Math.max(1, Math.floor(opts.width ?? 768));
  const height = Math.max(1, Math.floor(opts.height ?? 512));
  const { canvas, ctx } = make2DCanvas(width, height);
  const fontSize = opts.fontSize ?? 18;
  const lineH = Math.round(fontSize * 1.35);
  const pad = 12;
  const prompt = opts.prompt ?? '$ ';
  const maxLines = opts.maxLines ?? 500;

  const buffer = []; // scrollback (strings, may contain a leading color tag)
  let input = '';
  let blink = 0;

  const self = { canvas, ctx, width, height, flipY: false, dirty: true, realtime: !!opts.caretBlink };

  function push(line) {
    for (const l of String(line).split('\n')) buffer.push(l);
    while (buffer.length > maxLines) buffer.shift();
    self.dirty = true;
  }
  if (opts.banner) push(opts.banner);

  function run() {
    push(`${prompt}${input}`);
    const cmd = input;
    input = '';
    try {
      const out = opts.onCommand ? opts.onCommand(cmd) : undefined;
      if (Array.isArray(out)) out.forEach((l) => push(l));
      else if (typeof out === 'string' && out.length) push(out);
    } catch (e) {
      push(`error: ${e?.message ?? e}`);
    }
    self.dirty = true;
  }

  function rowsVisible() { return Math.max(1, Math.floor((self.height - pad * 2) / lineH) - 1); }

  self.render = function render(dt = 0) {
    blink = (blink + dt) % 1.0;
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, self.width, self.height);
    ctx.font = `${fontSize}px ui-monospace, Consolas, monospace`;
    ctx.textBaseline = 'top';
    const vis = rowsVisible();
    const start = Math.max(0, buffer.length - vis);
    let y = pad;
    for (let i = start; i < buffer.length; i++) {
      ctx.fillStyle = buffer[i].startsWith(prompt) ? THEME.dim : THEME.text;
      ctx.fillText(buffer[i], pad, y);
      y += lineH;
    }
    // input line
    ctx.fillStyle = THEME.prompt; ctx.fillText(prompt, pad, y);
    const px = pad + ctx.measureText(prompt).width;
    ctx.fillStyle = THEME.text; ctx.fillText(input, px, y);
    if (blink < 0.6) {
      const cx = px + ctx.measureText(input).width;
      ctx.fillStyle = THEME.caret; ctx.fillRect(cx, y, 9, fontSize);
    }
    if (self.realtime) self.dirty = true;
  };

  self.onKey = function onKey(e) {
    const k = e.key;
    if (k === 'Enter') run();
    else if (k === 'Backspace') { input = input.slice(0, -1); self.dirty = true; }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey) { input += k; self.dirty = true; }
    else return;
  };

  self.print = push;
  self.clear = function clear() { buffer.length = 0; self.dirty = true; };
  self.resize = function resize(w, h) { self.width = canvas.width = Math.max(1, Math.floor(w)); self.height = canvas.height = Math.max(1, Math.floor(h)); self.dirty = true; };
  self.dispose = function dispose() {};
  return self;
}
