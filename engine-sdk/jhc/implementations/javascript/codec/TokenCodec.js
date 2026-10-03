// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * TokenCodec.js — lossless token-based text compression for JHC1 resources.
 *
 * This is a simple, deterministic dictionary codec for JavaScript, HTML, and
 * CSS source text. It tokenizes text into alternating word / non-word runs and
 * encodes common tokens with single-byte opcodes. Unknown tokens are raw-escaped.
 * Future syntax and non-ASCII content are always preserved via raw escapes.
 */

const WORD_RE = /[A-Za-z0-9_]+|[^A-Za-z0-9_]+/g;

const OPCODE_RAW_1 = 0xF0;
const OPCODE_RAW_2 = 0xF1;
const OPCODE_RAW_4 = 0xF2;
const OPCODE_DICT_2 = 0xF3;
const MAX_DICT_1 = 240;

function makeDict(tokens) {
  const list = [];
  const map = new Map();
  for (const token of tokens) {
    if (map.has(token)) continue;
    if (list.length >= MAX_DICT_1) break;
    map.set(token, list.length);
    list.push(token);
  }
  return { list, map };
}

const DICTIONARIES = {
  common: makeDict([
    ' ', '\n', '\t', '    ',
    '{', '}', '(', ')', '[', ']', ';', ':', ',', '.',
    '=', '==', '===', '!=', '!==', '=>',
    '+', '-', '*', '/', '%', '++', '--',
    '&&', '||', '!', '?', '...', '&', '|', '^', '~',
    '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
    '<', '>', '<=', '>=', '<<', '>>', '>>>',
    "'", '"', '`', '#', '/', '//', '/*', '*/',
    '<', '>', '</', '/>', '<!--', '-->', '<!DOCTYPE',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
  ]),
  js: makeDict([
    'function', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while',
    'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw',
    'new', 'delete', 'typeof', 'instanceof', 'in', 'of', 'void', 'this', 'with',
    'async', 'await', 'import', 'export', 'from', 'as', 'default', 'class', 'extends',
    'super', 'static', 'get', 'set', 'constructor', 'yield', 'debugger',
    'Object', 'Array', 'String', 'Number', 'Boolean', 'JSON', 'Math', 'Date', 'RegExp',
    'Map', 'Set', 'Promise', 'fetch', 'console', 'window', 'document', 'globalThis',
    'setTimeout', 'setInterval', 'addEventListener', 'removeEventListener', 'querySelector',
    'querySelectorAll', 'createElement', 'appendChild', 'removeChild', 'innerHTML', 'textContent',
    'style', 'classList', 'className', 'add', 'remove', 'toggle', 'contains', 'forEach',
    'map', 'filter', 'reduce', 'join', 'split', 'slice', 'splice', 'push', 'pop', 'shift',
    'unshift', 'indexOf', 'includes', 'find', 'findIndex', 'sort', 'reverse', 'length',
    'toString', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'keys', 'values', 'entries',
    'assign', 'create', 'defineProperty', 'hasOwnProperty', 'prototype', 'call', 'apply',
    'bind', 'then', 'catch', 'finally', 'resolve', 'reject', 'all', 'race', 'allSettled',
    'any', 'log', 'warn', 'error', 'info', 'e', 'err', 'i', 'j', 'k', 'n', 'm', 'x', 'y', 'z',
    'a', 'b', 'c', 'd', 'o', 's', 't', 'u', 'v', 'w', 'h', 'el', 'elem', 'data', 'value',
    'key', 'id', 'name', 'type', 'options', 'config', 'result', 'msg', 'item', 'idx', 'len',
    'arr', 'obj', 'fn', 'cb', 'res', 'req', 'out', 'self', 'that', 'ctx', 'state', 'props',
    'event', 'target', 'current', 'parent', 'child', 'children', 'root', 'container', 'panel',
    'body', 'div', 'span', 'button', 'input', 'main', 'section', 'header', 'footer', 'nav',
    'article', 'aside', 'canvas', 'img', 'svg', 'path', 'on', 'is', 'to', 'of', 'get', 'set',
    'has', 'add', 'map', 'filter', 'reduce', 'forEach', 'push', 'pop', 'shift', 'unshift',
    'slice', 'splice', 'join', 'split', 'trim', 'replace', 'match', 'search', 'indexOf',
    'includes', 'startsWith', 'endsWith', 'charAt', 'charCodeAt', 'fromCharCode', 'fromCodePoint',
    'substring', 'substr', 'toString', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'stringify',
    'parse', 'keys', 'values', 'entries', 'assign', 'create', 'defineProperty', 'getOwnPropertyNames',
    'hasOwnProperty', 'hasOwn', 'property', 'constructor', 'valueOf', 'length', 'push', 'call',
    'apply', 'bind', 'then', 'catch', 'finally', 'resolve', 'reject', 'all', 'race', 'allSettled',
    'any',
  ]),
  html: makeDict([
    'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base', 'bdi', 'bdo',
    'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'cite', 'code', 'col', 'colgroup',
    'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em', 'embed',
    'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head',
    'header', 'hgroup', 'hr', 'html', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'label', 'legend',
    'li', 'link', 'main', 'map', 'mark', 'math', 'menu', 'meta', 'meter', 'nav', 'noscript', 'object',
    'ol', 'optgroup', 'option', 'output', 'p', 'picture', 'pre', 'progress', 'q', 'rp', 'rt', 'ruby',
    's', 'samp', 'script', 'search', 'section', 'select', 'slot', 'small', 'source', 'span', 'strong',
    'style', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th',
    'thead', 'time', 'title', 'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr',
    'class', 'id', 'style', 'src', 'href', 'type', 'name', 'value', 'disabled', 'checked', 'selected',
    'hidden', 'required', 'readonly', 'placeholder', 'title', 'alt', 'rel', 'target', 'charset', 'content',
    'http-equiv', 'viewport', 'width', 'height', 'class="', 'id="', 'style="', 'src="', 'href="',
    'type="', 'name="', 'value="', '="', 'data-', 'aria-', 'role', 'tabindex', 'hidden', 'open',
    'defer', 'async', 'crossorigin', 'integrity', 'nomodule', 'referrerpolicy', 'sandbox', 'allow',
    'autoplay', 'controls', 'loop', 'muted', 'preload', 'poster', 'srcset', 'sizes', 'alt=', 'lang',
    'dir', 'translate', 'draggable', 'spellcheck', 'contenteditable', 'download', 'target="', 'rel="',
    'xmlns', 'viewBox', 'fill', 'stroke', 'd', 'points', 'cx', 'cy', 'r', 'x', 'y', 'width=', 'height=',
    'xml:lang', 'xml:space', 'xlink:href', 'svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline',
    'polygon', 'text', 'tspan', 'path', 'defs', 'use', 'clipPath', 'mask', 'pattern', 'linearGradient',
    'radialGradient', 'stop', 'offset', 'transform', 'opacity', 'fill-', 'stroke-', 'stroke-width',
    'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule', 'preserveAspectRatio',
  ]),
  json: makeDict([
    '{', '}', '[', ']', ':', ',', '"', '\\', '/', 'true', 'false', 'null',
    'applicationId', 'applicationVersion', 'format', 'name', 'publisher', 'entry',
    'requiredFeatures', 'resources', 'blockmap', 'files', 'version', 'packageId',
    'builtAt', 'format', 'path', 'mime', 'id', 'hash', 'representation', 'decodedLength',
    'licenseText', 'manifest', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    'test.', 'com.', 'org.', 'io', 'app', 'v', 'app-', 'com.', 'webgpu', 'jhc-1.0',
  ]),
  css: makeDict([
    'color', 'background', 'background-color', 'border', 'border-radius', 'display', 'position',
    'width', 'height', 'top', 'left', 'right', 'bottom', 'margin', 'padding', 'font', 'font-size',
    'font-family', 'font-weight', 'text-align', 'text-decoration', 'overflow', 'visibility', 'opacity',
    'transform', 'transition', 'animation', 'flex', 'grid', 'box-shadow', 'cursor', 'z-index',
    'pointer-events', 'white-space', 'content', 'align-items', 'justify-content', 'flex-direction',
    'gap', 'order', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'align-self', 'justify-self',
    'grid-template', 'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-area',
    'min-width', 'max-width', 'min-height', 'max-height', 'margin-top', 'margin-right', 'margin-bottom',
    'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top',
    'border-right', 'border-bottom', 'border-left', 'border-width', 'border-style', 'border-color',
    'outline', 'outline-offset', 'box-sizing', 'float', 'clear', 'clip', 'filter', 'mix-blend-mode',
    'background-image', 'background-size', 'background-position', 'background-repeat', 'background-attachment',
    'color:', 'background:', 'display:', 'position:', 'width:', 'height:', 'margin:', 'padding:', 'font:',
    'px', 'em', 'rem', '%', 'vh', 'vw', 'vmin', 'vmax', 'ex', 'ch', 'cm', 'mm', 'in', 'pt', 'pc',
    '!important', 'inherit', 'initial', 'unset', 'auto', 'none', 'block', 'inline', 'inline-block',
    'flex', 'inline-flex', 'grid', 'inline-grid', 'table', 'table-cell', 'table-row', 'list-item',
    'absolute', 'relative', 'fixed', 'static', 'sticky', 'center', 'left', 'right', 'top', 'bottom',
    'row', 'column', 'wrap', 'nowrap', 'wrap-reverse', 'row-reverse', 'column-reverse', 'start', 'end',
    'flex-start', 'flex-end', 'space-between', 'space-around', 'space-evenly', 'stretch', 'baseline',
    'rgba', 'rgb', 'hsl', 'hsla', 'var', 'calc', 'min', 'max', 'clamp', 'transparent', 'solid', 'dashed',
    'dotted', 'double', 'groove', 'ridge', 'inset', 'outset', 'hidden', 'visible', 'scroll', 'no-repeat',
    'repeat', 'repeat-x', 'repeat-y', 'cover', 'contain', 'pointer', 'default', 'not-allowed', 'wait',
    'text', 'all', 'none', 'border-box', 'content-box', 'padding-box', 'margin-box', 'fill-box', 'stroke-box',
    'view-box', '0', '1px', '2px', '4px', '8px', '16px', '32px', '100%', '100vh', '100vw', '1rem', '0.5',
    '0.25', '1em', '9999', '0px', 'border-box', 'content-box', 'padding-box', 'margin-box', '0s', '1s',
    '0.2s', '0.3s', '0.5s', 'ease', 'linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier',
    'translate', 'translateX', 'translateY', 'translateZ', 'scale', 'scaleX', 'scaleY', 'rotate',
    'skewX', 'skewY', 'matrix', 'matrix3d', 'perspective', 'rotateX', 'rotateY', 'rotateZ', 'rotate3d',
    'scaleZ', 'translate3d', 'scale3d', 'all', 'opacity', 'transform', 'color', 'background-color',
  ]),
};

function dictionaryFor(language) {
  const base = DICTIONARIES.common;
  const extra = DICTIONARIES[language] || base;
  if (extra === base) return base;
  const merged = [...base.list];
  const map = new Map(base.map);
  for (const token of extra.list) {
    if (!map.has(token)) {
      if (merged.length >= MAX_DICT_1) break;
      map.set(token, merged.length);
      merged.push(token);
    }
  }
  return { list: merged, map };
}

function tokenize(text) {
  const tokens = [];
  WORD_RE.lastIndex = 0;
  let m;
  while ((m = WORD_RE.exec(text)) !== null) {
    tokens.push(m[0]);
  }
  return tokens;
}

function writeString(out, s) {
  const te = new TextEncoder();
  const bytes = te.encode(s);
  out.push(...bytes);
  return bytes.length;
}

function readString(view, pos, length) {
  const bytes = view.subarray(pos, pos + length);
  const td = new TextDecoder();
  return td.decode(bytes);
}

export class TokenCodec {
  static canEncode(text, language = 'js') {
    try {
      this.encode(text, language);
      return true;
    } catch {
      return false;
    }
  }

  static encode(text, language = 'js') {
    const dict = dictionaryFor(language);
    const tokens = tokenize(text);
    const out = [];
    for (const token of tokens) {
      const op = dict.map.get(token);
      if (op !== undefined) {
        out.push(op);
      } else {
        const te = new TextEncoder();
        const bytes = te.encode(token);
        if (bytes.length <= 255) {
          out.push(OPCODE_RAW_1, bytes.length, ...bytes);
        } else if (bytes.length <= 65535) {
          out.push(OPCODE_RAW_2, bytes.length & 0xff, (bytes.length >> 8) & 0xff, ...bytes);
        } else if (bytes.length <= 4294967295) {
          out.push(
            OPCODE_RAW_4,
            bytes.length & 0xff,
            (bytes.length >> 8) & 0xff,
            (bytes.length >> 16) & 0xff,
            (bytes.length >> 24) & 0xff,
            ...bytes,
          );
        } else {
          throw new Error('Token too long for token codec');
        }
      }
    }
    return new Uint8Array(out);
  }

  static decode(bytes, language = 'js') {
    const dict = dictionaryFor(language);
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const parts = [];
    let i = 0;
    while (i < view.length) {
      const op = view[i];
      if (op < MAX_DICT_1) {
        parts.push(dict.list[op]);
        i++;
      } else if (op === OPCODE_RAW_1) {
        if (i + 1 >= view.length) throw new Error('Truncated token stream');
        const length = view[i + 1];
        if (i + 2 + length > view.length) throw new Error('Truncated token stream');
        parts.push(readString(view, i + 2, length));
        i += 2 + length;
      } else if (op === OPCODE_RAW_2) {
        if (i + 2 >= view.length) throw new Error('Truncated token stream');
        const length = view[i + 1] | (view[i + 2] << 8);
        if (i + 3 + length > view.length) throw new Error('Truncated token stream');
        parts.push(readString(view, i + 3, length));
        i += 3 + length;
      } else if (op === OPCODE_RAW_4) {
        if (i + 4 >= view.length) throw new Error('Truncated token stream');
        const length = view[i + 1] | (view[i + 2] << 8) | (view[i + 3] << 16) | (view[i + 4] << 24);
        if (i + 5 + length > view.length) throw new Error('Truncated token stream');
        parts.push(readString(view, i + 5, length));
        i += 5 + length;
      } else if (op === OPCODE_DICT_2) {
        // Reserved for application/chunk dictionary extension (Phase 5-2).
        throw new Error('Application dictionary opcodes not yet implemented');
      } else {
        throw new Error(`Unknown token opcode: ${op}`);
      }
    }
    return parts.join('');
  }
}

export default TokenCodec;
