// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// FormatMath.js - reusable signatures, MIME helpers, SemVer, text ranges, token cursors, and chunk tables.

import {
  bufferByteView,
  bufferRangeReport,
  bufferRead,
  bufferValueByteSize,
  decodeUtf8,
  encodeUtf8,
} from './BufferMath.js';

const DEFAULT_MIME_TYPE = 'application/octet-stream';
const MIME_TOKEN_RE = /^[!#$%&'*+.^_`|~0-9a-z-]+$/i;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export const FORMAT_EXTENSION_MIME_TYPES = Object.freeze({
  '.bin': 'application/octet-stream',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.gz': 'application/gzip',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.json': 'application/json',
  '.ktx2': 'image/ktx2',
  '.mjs': 'text/javascript',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.ts': 'text/javascript',
  '.tsx': 'text/javascript',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
});

function bytesFromAscii(text) {
  return Object.freeze(Array.from(String(text), (char) => char.charCodeAt(0) & 0xff));
}

function signature(definition) {
  return Object.freeze({
    ...definition,
    bytes: definition.bytes ? Object.freeze(Array.from(definition.bytes, (byte) => byte & 0xff)) : undefined,
    matches: definition.matches
      ? Object.freeze(definition.matches.map((match) => Object.freeze({
        byteOffset: match.byteOffset ?? 0,
        bytes: Object.freeze(Array.from(match.bytes, (byte) => byte & 0xff)),
      })))
      : undefined,
  });
}

export const MAGIC_NUMBER_SIGNATURES = Object.freeze([
  signature({ id: 'png', label: 'PNG image', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], mimeType: 'image/png', extension: '.png', kind: 'image' }),
  signature({ id: 'jpeg', label: 'JPEG image', bytes: [0xff, 0xd8, 0xff], mimeType: 'image/jpeg', extension: '.jpg', kind: 'image' }),
  signature({ id: 'gif87a', label: 'GIF87a image', bytes: bytesFromAscii('GIF87a'), mimeType: 'image/gif', extension: '.gif', kind: 'image' }),
  signature({ id: 'gif89a', label: 'GIF89a image', bytes: bytesFromAscii('GIF89a'), mimeType: 'image/gif', extension: '.gif', kind: 'image' }),
  signature({ id: 'webp', label: 'WebP image', matches: [{ byteOffset: 0, bytes: bytesFromAscii('RIFF') }, { byteOffset: 8, bytes: bytesFromAscii('WEBP') }], mimeType: 'image/webp', extension: '.webp', kind: 'image' }),
  signature({ id: 'svg-xml', label: 'SVG XML text', bytes: bytesFromAscii('<svg'), mimeType: 'image/svg+xml', extension: '.svg', kind: 'image-text' }),
  signature({ id: 'pdf', label: 'PDF document', bytes: bytesFromAscii('%PDF-'), mimeType: 'application/pdf', extension: '.pdf', kind: 'document' }),
  signature({ id: 'zip-local', label: 'ZIP local file header', bytes: [0x50, 0x4b, 0x03, 0x04], mimeType: 'application/zip', extension: '.zip', kind: 'archive' }),
  signature({ id: 'zip-empty', label: 'ZIP empty archive', bytes: [0x50, 0x4b, 0x05, 0x06], mimeType: 'application/zip', extension: '.zip', kind: 'archive' }),
  signature({ id: 'zip-spanned', label: 'ZIP spanned archive', bytes: [0x50, 0x4b, 0x07, 0x08], mimeType: 'application/zip', extension: '.zip', kind: 'archive' }),
  signature({ id: 'gzip', label: 'GZIP stream', bytes: [0x1f, 0x8b], mimeType: 'application/gzip', extension: '.gz', kind: 'archive' }),
  signature({ id: 'rar4', label: 'RAR archive', bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00], mimeType: 'application/vnd.rar', extension: '.rar', kind: 'archive' }),
  signature({ id: 'rar5', label: 'RAR5 archive', bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00], mimeType: 'application/vnd.rar', extension: '.rar', kind: 'archive' }),
  signature({ id: '7z', label: '7-Zip archive', bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], mimeType: 'application/x-7z-compressed', extension: '.7z', kind: 'archive' }),
  signature({ id: 'wasm', label: 'WebAssembly module', bytes: [0x00, 0x61, 0x73, 0x6d], mimeType: 'application/wasm', extension: '.wasm', kind: 'binary-module' }),
  signature({ id: 'glb', label: 'Binary glTF', bytes: bytesFromAscii('glTF'), mimeType: 'model/gltf-binary', extension: '.glb', kind: 'asset' }),
  signature({ id: 'ktx2', label: 'KTX2 texture', bytes: [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a], mimeType: 'image/ktx2', extension: '.ktx2', kind: 'texture' }),
  signature({ id: 'ogg', label: 'Ogg stream', bytes: bytesFromAscii('OggS'), mimeType: 'application/ogg', extension: '.ogg', kind: 'media' }),
  signature({ id: 'id3', label: 'ID3 audio tag', bytes: bytesFromAscii('ID3'), mimeType: 'audio/mpeg', extension: '.mp3', kind: 'media' }),
]);

function finiteInteger(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    throw new RangeError(`${name} must be a finite integer`);
  }
  return number;
}

function nonnegativeInteger(value, name) {
  const number = finiteInteger(value, name);
  if (number < 0) {
    throw new RangeError(`${name} must be nonnegative`);
  }
  return number;
}

function positiveInteger(value, name) {
  const number = finiteInteger(value, name);
  if (number <= 0) {
    throw new RangeError(`${name} must be positive`);
  }
  return number;
}

function formatByteView(data) {
  if (typeof data === 'string') return encodeUtf8(data);
  if (Array.isArray(data)) return Uint8Array.from(data, (byte) => Number(byte) & 0xff);
  return bufferByteView(data);
}

function hexByte(byte, uppercase) {
  const hex = (byte & 0xff).toString(16).padStart(2, '0');
  return uppercase ? hex.toUpperCase() : hex;
}

export function byteSignature(data, options = {}) {
  const bytes = formatByteView(data);
  const byteOffset = nonnegativeInteger(options.byteOffset ?? 0, 'byteOffset');
  const availableLength = Math.max(0, bytes.byteLength - byteOffset);
  const requestedLength = options.byteLength === undefined ? availableLength : nonnegativeInteger(options.byteLength, 'byteLength');
  const byteLength = options.maxBytes === undefined
    ? requestedLength
    : Math.min(requestedLength, nonnegativeInteger(options.maxBytes, 'maxBytes'));
  const report = bufferRangeReport(bytes, byteOffset, byteLength);
  if (!report.valid) {
    throw new RangeError(`byteSignature range ${report.reason}: offset ${report.byteOffset}, length ${report.byteLength}, available ${report.availableBytes}`);
  }
  const uppercase = options.uppercase === true;
  const separator = String(options.separator ?? '');
  return Array.from(bytes.subarray(byteOffset, byteOffset + byteLength), (byte) => hexByte(byte, uppercase)).join(separator);
}

export function hexToBytes(hex, options = {}) {
  const text = String(hex ?? '');
  const byteOffset = nonnegativeInteger(options.byteOffset ?? 0, 'byteOffset');
  const availablePairs = Math.max(0, Math.floor((text.length - byteOffset) / 2));
  const byteLength = options.byteLength === undefined
    ? availablePairs
    : nonnegativeInteger(options.byteLength, 'byteLength');
  if (byteOffset + byteLength * 2 > text.length) {
    throw new RangeError(`hexToBytes range out-of-bounds: offset ${byteOffset}, length ${byteLength}, available pairs ${availablePairs}`);
  }
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i += 1) {
    bytes[i] = Number.parseInt(text.slice(byteOffset + i * 2, byteOffset + i * 2 + 2), 16);
  }
  return bytes;
}

function signatureChunks(definition) {
  if (definition.matches) return definition.matches;
  return [Object.freeze({ byteOffset: 0, bytes: definition.bytes ?? Object.freeze([]) })];
}

function signatureMatches(bytes, definition, baseOffset) {
  const chunks = signatureChunks(definition);
  return chunks.every((chunk) => {
    const start = baseOffset + chunk.byteOffset;
    if (start < 0 || start + chunk.bytes.length > bytes.byteLength) return false;
    for (let i = 0; i < chunk.bytes.length; i += 1) {
      if (bytes[start + i] !== chunk.bytes[i]) return false;
    }
    return true;
  });
}

function signatureByteLength(definition) {
  return signatureChunks(definition).reduce((max, chunk) => Math.max(max, chunk.byteOffset + chunk.bytes.length), 0);
}

export function magicNumberDetect(data, options = {}) {
  const bytes = formatByteView(data);
  const byteOffset = nonnegativeInteger(options.byteOffset ?? 0, 'byteOffset');
  const signatures = options.signatures ?? MAGIC_NUMBER_SIGNATURES;
  const matches = [];
  for (const definition of signatures) {
    const localOffset = nonnegativeInteger(definition.byteOffset ?? 0, `${definition.id ?? 'signature'}.byteOffset`);
    const absoluteOffset = byteOffset + localOffset;
    if (signatureMatches(bytes, definition, absoluteOffset)) {
      const byteLength = signatureByteLength(definition);
      matches.push({
        id: definition.id,
        label: definition.label,
        mimeType: definition.mimeType,
        extension: definition.extension,
        kind: definition.kind,
        byteOffset: absoluteOffset,
        byteLength,
        signatureHex: byteSignature(bytes, { byteOffset: absoluteOffset, byteLength: Math.min(byteLength, bytes.byteLength - absoluteOffset) }),
      });
    }
  }
  const best = matches[0] ?? null;
  return {
    matched: !!best,
    id: best?.id ?? null,
    label: best?.label ?? null,
    mimeType: best?.mimeType ?? null,
    extension: best?.extension ?? null,
    kind: best?.kind ?? null,
    byteOffset,
    byteLength: bytes.byteLength,
    signatureHex: byteSignature(bytes, { byteOffset, byteLength: Math.min(nonnegativeInteger(options.previewBytes ?? 16, 'previewBytes'), Math.max(0, bytes.byteLength - byteOffset)) }),
    matches: Object.freeze(matches),
  };
}

export function formatExtensionFromPath(pathOrExtension) {
  const clean = String(pathOrExtension ?? '')
    .trim()
    .replace(/[?#].*$/, '');
  if (!clean) return '';
  const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  const filename = clean.slice(slash + 1);
  if (!filename) return '';
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return '';
  if (dot === 0 && filename.indexOf('.', 1) < 0) return filename.length > 1 ? filename.toLowerCase() : '';
  return filename.slice(dot).toLowerCase();
}

export function formatMimeFromExtension(pathOrExtension, fallback = DEFAULT_MIME_TYPE) {
  const extension = formatExtensionFromPath(pathOrExtension);
  return FORMAT_EXTENSION_MIME_TYPES[extension] ?? fallback;
}

function splitMimeSections(input) {
  const sections = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  for (const char of String(input ?? '')) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quoted) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (char === ';' && !quoted) {
      sections.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  sections.push(current);
  return sections;
}

function unquoteMimeValue(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') {
    return trimmed.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  return trimmed;
}

export function parseMimeType(input) {
  const raw = String(input ?? '').trim();
  if (!raw) {
    return { valid: false, type: '', subtype: '', essence: '', parameters: Object.freeze({}), error: 'empty' };
  }
  const sections = splitMimeSections(raw);
  const essenceRaw = sections.shift().trim();
  const slash = essenceRaw.indexOf('/');
  if (slash <= 0 || slash === essenceRaw.length - 1) {
    return { valid: false, type: '', subtype: '', essence: '', parameters: Object.freeze({}), error: 'missing-type-or-subtype' };
  }
  const type = essenceRaw.slice(0, slash).trim().toLowerCase();
  const subtype = essenceRaw.slice(slash + 1).trim().toLowerCase();
  if (!MIME_TOKEN_RE.test(type) || !MIME_TOKEN_RE.test(subtype)) {
    return { valid: false, type, subtype, essence: `${type}/${subtype}`, parameters: Object.freeze({}), error: 'invalid-token' };
  }
  const parameters = {};
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    const equals = trimmed.indexOf('=');
    if (equals <= 0) {
      return { valid: false, type, subtype, essence: `${type}/${subtype}`, parameters: Object.freeze(parameters), error: 'invalid-parameter' };
    }
    const name = trimmed.slice(0, equals).trim().toLowerCase();
    if (!MIME_TOKEN_RE.test(name)) {
      return { valid: false, type, subtype, essence: `${type}/${subtype}`, parameters: Object.freeze(parameters), error: 'invalid-parameter-name' };
    }
    parameters[name] = unquoteMimeValue(trimmed.slice(equals + 1));
  }
  return {
    valid: true,
    type,
    subtype,
    essence: `${type}/${subtype}`,
    parameters: Object.freeze(parameters),
    error: '',
  };
}

export function mimeTypeGroupReport(input) {
  const parsed = parseMimeType(input);
  const essence = parsed.essence;
  const image = parsed.valid && parsed.type === 'image';
  const audioVideo = parsed.valid && (parsed.type === 'audio' || parsed.type === 'video');
  const font = parsed.valid && (parsed.type === 'font' || essence === 'application/font-woff' || essence === 'application/woff2');
  const zip = parsed.valid && (essence === 'application/zip' || parsed.subtype.endsWith('+zip'));
  const archive = parsed.valid && (
    zip ||
    essence === 'application/gzip' ||
    essence === 'application/x-tar' ||
    essence === 'application/x-7z-compressed' ||
    essence === 'application/vnd.rar'
  );
  const xml = parsed.valid && (essence === 'application/xml' || essence === 'text/xml' || parsed.subtype.endsWith('+xml'));
  const html = parsed.valid && essence === 'text/html';
  const javascript = parsed.valid && (
    essence === 'text/javascript' ||
    essence === 'application/javascript' ||
    essence === 'text/ecmascript' ||
    essence === 'application/ecmascript'
  );
  const json = parsed.valid && (essence === 'application/json' || essence === 'text/json' || parsed.subtype.endsWith('+json'));
  return {
    ...parsed,
    image,
    audioVideo,
    font,
    zip,
    archive,
    xml,
    html,
    javascript,
    json,
    scriptable: html || javascript || xml || essence === 'image/svg+xml',
  };
}

function likelyBinary(bytes) {
  const limit = Math.min(bytes.byteLength, 512);
  if (limit === 0) return false;
  let control = 0;
  for (let i = 0; i < limit; i += 1) {
    const byte = bytes[i];
    if (byte === 0) return true;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) control += 1;
  }
  return control / limit > 0.05;
}

function contentMimeFromText(bytes) {
  if (likelyBinary(bytes)) return null;
  const text = decodeUtf8(bytes.subarray(0, Math.min(bytes.byteLength, 4096)), { fatal: false }).trimStart().replace(/^\uFEFF/, '');
  if (!text) return 'text/plain';
  const lowered = text.slice(0, 80).toLowerCase();
  if (lowered.startsWith('<!doctype html') || lowered.startsWith('<html')) return 'text/html';
  if (lowered.startsWith('<svg')) return 'image/svg+xml';
  if (lowered.startsWith('<?xml')) return 'application/xml';
  if (lowered.startsWith('{') || lowered.startsWith('[')) return 'application/json';
  return 'text/plain';
}

export function formatMimeSniff(data, options = {}) {
  const bytes = formatByteView(data);
  const magic = magicNumberDetect(bytes, options.magicOptions ?? {});
  const extension = formatExtensionFromPath(options.extension ?? options.path ?? options.filename ?? '');
  const extensionMimeType = extension ? formatMimeFromExtension(extension, '') : '';
  const supplied = parseMimeType(options.suppliedMimeType ?? options.mimeType ?? '');
  const binaryLikely = likelyBinary(bytes);

  let mimeType = '';
  let source = '';
  if (magic.matched && magic.mimeType) {
    mimeType = magic.mimeType;
    source = 'magic';
  } else if (extensionMimeType) {
    mimeType = extensionMimeType;
    source = 'extension';
  } else if (supplied.valid && supplied.essence !== DEFAULT_MIME_TYPE) {
    mimeType = supplied.essence;
    source = 'supplied';
  } else {
    mimeType = contentMimeFromText(bytes) ?? options.fallback ?? DEFAULT_MIME_TYPE;
    source = mimeType === (options.fallback ?? DEFAULT_MIME_TYPE) && mimeType === DEFAULT_MIME_TYPE ? 'fallback' : 'content';
  }

  return {
    mimeType,
    source,
    extension,
    suppliedMimeType: supplied.valid ? supplied.essence : '',
    magic,
    groups: mimeTypeGroupReport(mimeType),
    binaryLikely,
  };
}

function splitCommaSections(input) {
  const sections = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  for (const char of String(input ?? '')) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quoted) {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (char === ',' && !quoted) {
      sections.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  sections.push(current);
  return sections;
}

function normalizeAcceptSections(accept) {
  if (Array.isArray(accept)) return accept.map((entry) => String(entry ?? ''));
  return splitCommaSections(accept);
}

function parseAcceptQuality(value) {
  const q = Number(value);
  if (!Number.isFinite(q) || q < 0 || q > 1) return NaN;
  return q;
}

function parseAcceptItem(rawItem, index) {
  const raw = String(rawItem ?? '').trim();
  const sections = splitMimeSections(raw);
  const value = String(sections.shift() ?? '').trim().toLowerCase();
  const parameters = {};
  const errors = [];
  let q = 1;

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    const equals = trimmed.indexOf('=');
    if (equals <= 0) {
      errors.push('invalid-parameter');
      continue;
    }
    const name = trimmed.slice(0, equals).trim().toLowerCase();
    const parameterValue = unquoteMimeValue(trimmed.slice(equals + 1));
    if (!MIME_TOKEN_RE.test(name)) {
      errors.push('invalid-parameter-name');
      continue;
    }
    parameters[name] = parameterValue;
    if (name === 'q') {
      q = parseAcceptQuality(parameterValue);
      if (!Number.isFinite(q)) errors.push('invalid-q');
    }
  }

  if (!value) {
    return Object.freeze({
      valid: false,
      raw,
      index,
      kind: 'invalid',
      value,
      extension: '',
      type: '',
      subtype: '',
      essence: '',
      parameters: Object.freeze(parameters),
      q,
      specificity: -1,
      errors: Object.freeze(['empty', ...errors]),
    });
  }

  if (value === '*' || value === '*/*') {
    return Object.freeze({
      valid: errors.length === 0,
      raw,
      index,
      kind: 'wildcard',
      value: '*/*',
      extension: '',
      type: '*',
      subtype: '*',
      essence: '*/*',
      parameters: Object.freeze(parameters),
      q,
      specificity: 0,
      errors: Object.freeze(errors),
    });
  }

  if (value.startsWith('.')) {
    const extension = value.length > 1 && !/\s/.test(value) ? value : '';
    if (!extension) errors.push('invalid-extension');
    return Object.freeze({
      valid: extension.length > 0 && errors.length === 0,
      raw,
      index,
      kind: 'extension',
      value: extension,
      extension,
      type: '',
      subtype: '',
      essence: '',
      parameters: Object.freeze(parameters),
      q,
      specificity: 3,
      errors: Object.freeze(errors),
    });
  }

  const slash = value.indexOf('/');
  const type = slash > 0 ? value.slice(0, slash) : '';
  const subtype = slash > 0 ? value.slice(slash + 1) : '';
  if (slash <= 0 || slash === value.length - 1 || !MIME_TOKEN_RE.test(type) || (subtype !== '*' && !MIME_TOKEN_RE.test(subtype))) {
    errors.push('invalid-mime');
    return Object.freeze({
      valid: false,
      raw,
      index,
      kind: 'invalid',
      value,
      extension: '',
      type,
      subtype,
      essence: type && subtype ? `${type}/${subtype}` : '',
      parameters: Object.freeze(parameters),
      q,
      specificity: -1,
      errors: Object.freeze(errors),
    });
  }

  return Object.freeze({
    valid: errors.length === 0,
    raw,
    index,
    kind: subtype === '*' ? 'mime-wildcard' : 'mime',
    value,
    extension: '',
    type,
    subtype,
    essence: `${type}/${subtype}`,
    parameters: Object.freeze(parameters),
    q,
    specificity: subtype === '*' ? 1 : 2,
    errors: Object.freeze(errors),
  });
}

export function formatAcceptListReport(accept) {
  const rawItems = normalizeAcceptSections(accept).map((entry) => String(entry ?? '').trim()).filter(Boolean);
  const items = rawItems.map((entry, index) => parseAcceptItem(entry, index));
  const errors = items.flatMap((item) => item.errors.map((error) => `${item.index}:${error}`));
  return {
    valid: errors.length === 0,
    raw: Array.isArray(accept) ? Object.freeze(rawItems) : String(accept ?? ''),
    itemCount: items.length,
    acceptsAny: items.length === 0 || items.some((item) => item.valid && item.kind === 'wildcard' && item.q > 0),
    items: Object.freeze(items),
    errors: Object.freeze(errors),
  };
}

function candidateMimeTypes(source, options, extension) {
  const candidates = [];
  const add = (value, reason) => {
    const parsed = parseMimeType(value);
    if (!parsed.valid) return;
    if (candidates.some((candidate) => candidate.mimeType === parsed.essence)) return;
    candidates.push(Object.freeze({ mimeType: parsed.essence, reason, groups: mimeTypeGroupReport(parsed.essence) }));
  };
  add(source?.type, 'type');
  add(source?.mimeType, 'mimeType');
  add(options?.mimeType, 'options');
  if (extension) add(formatMimeFromExtension(extension, ''), 'extension');
  return candidates;
}

function matchAcceptItemToMime(item, parsedMime) {
  if (!parsedMime.valid) return false;
  if (item.kind === 'wildcard') return true;
  if (item.kind === 'mime') return parsedMime.essence === item.essence;
  if (item.kind === 'mime-wildcard') return parsedMime.type === item.type;
  return false;
}

function matchAcceptItemToEvidence(item, extension, mimeCandidates) {
  if (!item.valid || item.q <= 0) return null;
  if (item.kind === 'wildcard') return { kind: 'wildcard', value: '*/*', specificity: item.specificity };
  if (item.kind === 'extension' && extension && item.extension === extension) {
    return { kind: 'extension', value: extension, specificity: item.specificity };
  }
  for (const candidate of mimeCandidates) {
    const parsed = parseMimeType(candidate.mimeType);
    if (matchAcceptItemToMime(item, parsed)) {
      return { kind: item.kind, value: candidate.mimeType, specificity: item.specificity, reason: candidate.reason };
    }
  }
  return null;
}

export function formatAcceptMatchReport(file, accept, options = {}) {
  const source = file && typeof file === 'object' && !(file instanceof ArrayBuffer) && !ArrayBuffer.isView(file)
    ? file
    : { path: String(file ?? '') };
  const path = String(source.path ?? source.name ?? source.filename ?? options.path ?? options.filename ?? '');
  const explicitExtension = source.extension ?? options.extension;
  const extension = explicitExtension ? String(explicitExtension).toLowerCase() : formatExtensionFromPath(path);
  const data = source.data ?? options.data;
  const sniffed = data === undefined ? null : formatMimeSniff(data, { path, mimeType: source.type ?? source.mimeType ?? options.mimeType ?? '' });
  const mimeCandidates = candidateMimeTypes(source, options, extension);
  if (sniffed?.mimeType && !mimeCandidates.some((candidate) => candidate.mimeType === sniffed.mimeType)) {
    mimeCandidates.push(Object.freeze({ mimeType: sniffed.mimeType, reason: 'sniff', groups: sniffed.groups }));
  }
  const acceptReport = formatAcceptListReport(accept);

  if (acceptReport.items.length === 0) {
    return {
      valid: acceptReport.valid,
      accepted: true,
      reason: 'no-filter',
      extension,
      mimeType: mimeCandidates[0]?.mimeType ?? '',
      mimeCandidates: Object.freeze(mimeCandidates),
      sniffed,
      accept: acceptReport,
      matchedBy: null,
      matchIndex: -1,
    };
  }

  let best = null;
  for (const item of acceptReport.items) {
    const evidence = matchAcceptItemToEvidence(item, extension, mimeCandidates);
    if (!evidence) continue;
    const score = item.q * 100 + evidence.specificity;
    if (!best || score > best.score || (score === best.score && item.index < best.item.index)) {
      best = { item, evidence, score };
    }
  }

  return {
    valid: acceptReport.valid,
    accepted: !!best,
    reason: best ? 'matched' : (extension || mimeCandidates.length > 0 ? 'not-accepted' : 'no-format-evidence'),
    extension,
    mimeType: mimeCandidates[0]?.mimeType ?? '',
    mimeCandidates: Object.freeze(mimeCandidates),
    sniffed,
    accept: acceptReport,
    matchedBy: best ? Object.freeze({
      index: best.item.index,
      kind: best.evidence.kind,
      value: best.evidence.value,
      q: best.item.q,
      reason: best.evidence.reason ?? best.item.kind,
    }) : null,
    matchIndex: best?.item.index ?? -1,
  };
}

export function formatAcceptHeaderReport(acceptHeader, offeredMimeTypes, options = {}) {
  const offered = Array.from(offeredMimeTypes ?? [], (entry, index) => {
    const mimeType = typeof entry === 'string' ? entry : (entry.mimeType ?? entry.type ?? '');
    const parsed = parseMimeType(mimeType);
    return Object.freeze({
      index,
      mimeType: parsed.valid ? parsed.essence : String(mimeType ?? ''),
      parsed,
      data: typeof entry === 'string' ? null : entry,
    });
  });
  const accept = formatAcceptListReport(acceptHeader ?? '*/*');
  const candidates = [];
  for (const offer of offered) {
    if (!offer.parsed.valid) {
      candidates.push(Object.freeze({ offerIndex: offer.index, mimeType: offer.mimeType, valid: false, accepted: false, q: 0, specificity: -1 }));
      continue;
    }
    let bestItem = null;
    for (const item of accept.items.length > 0 ? accept.items : [parseAcceptItem('*/*', 0)]) {
      if (item.q <= 0 || !matchAcceptItemToMime(item, offer.parsed)) continue;
      if (!bestItem || item.q > bestItem.q || (item.q === bestItem.q && item.specificity > bestItem.specificity)) {
        bestItem = item;
      }
    }
    candidates.push(Object.freeze({
      offerIndex: offer.index,
      mimeType: offer.mimeType,
      valid: true,
      accepted: !!bestItem,
      q: bestItem?.q ?? 0,
      specificity: bestItem?.specificity ?? -1,
      acceptIndex: bestItem?.index ?? -1,
    }));
  }

  const accepted = candidates.filter((candidate) => candidate.accepted);
  accepted.sort((left, right) => (
    right.q - left.q ||
    right.specificity - left.specificity ||
    left.offerIndex - right.offerIndex ||
    left.acceptIndex - right.acceptIndex
  ));
  const best = accepted[0] ?? null;
  return {
    valid: accept.valid && offered.every((offer) => offer.parsed.valid),
    accepted: !!best,
    bestMimeType: best?.mimeType ?? '',
    bestOfferIndex: best?.offerIndex ?? -1,
    bestAcceptIndex: best?.acceptIndex ?? -1,
    bestQ: best?.q ?? 0,
    accept,
    offered: Object.freeze(offered),
    candidates: Object.freeze(candidates),
    errors: Object.freeze([
      ...accept.errors,
      ...offered.filter((offer) => !offer.parsed.valid).map((offer) => `offered:${offer.index}:invalid-mime`),
    ]),
  };
}

export function parseSemanticVersion(version) {
  const raw = String(version ?? '').trim();
  const match = SEMVER_RE.exec(raw);
  if (!match) {
    return { valid: false, version: raw, major: NaN, minor: NaN, patch: NaN, prerelease: Object.freeze([]), build: Object.freeze([]), error: 'invalid-semver' };
  }
  return {
    valid: true,
    version: raw,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: Object.freeze(match[4] ? match[4].split('.') : []),
    build: Object.freeze(match[5] ? match[5].split('.') : []),
    error: '',
  };
}

function numericIdentifier(identifier) {
  return /^(0|[1-9]\d*)$/.test(identifier);
}

function compareNumberLike(left, right) {
  const leftText = String(left).replace(/^0+(?=\d)/, '');
  const rightText = String(right).replace(/^0+(?=\d)/, '');
  if (leftText.length !== rightText.length) return leftText.length < rightText.length ? -1 : 1;
  if (leftText === rightText) return 0;
  return leftText < rightText ? -1 : 1;
}

export function semanticVersionCompare(leftVersion, rightVersion) {
  const left = parseSemanticVersion(leftVersion);
  const right = parseSemanticVersion(rightVersion);
  if (!left.valid) throw new RangeError(`invalid semantic version: ${leftVersion}`);
  if (!right.valid) throw new RangeError(`invalid semantic version: ${rightVersion}`);

  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
  }

  const leftPre = left.prerelease;
  const rightPre = right.prerelease;
  if (leftPre.length === 0 && rightPre.length === 0) return 0;
  if (leftPre.length === 0) return 1;
  if (rightPre.length === 0) return -1;

  const count = Math.max(leftPre.length, rightPre.length);
  for (let i = 0; i < count; i += 1) {
    const leftId = leftPre[i];
    const rightId = rightPre[i];
    if (leftId === undefined) return -1;
    if (rightId === undefined) return 1;
    const leftNumeric = numericIdentifier(leftId);
    const rightNumeric = numericIdentifier(rightId);
    if (leftNumeric && rightNumeric) {
      const compared = compareNumberLike(leftId, rightId);
      if (compared !== 0) return compared;
      continue;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    if (leftId !== rightId) return leftId < rightId ? -1 : 1;
  }
  return 0;
}

function versionCoreFromParts(parts) {
  return `${parts.major}.${parts.minor}.${parts.patch}`;
}

function parseVersionCore(token) {
  const parts = String(token ?? '').trim().split('.');
  if (parts.length > 3 || parts.length === 0) return { valid: false, error: 'invalid-version-core' };
  const normalized = [];
  let wildcardIndex = -1;
  for (let i = 0; i < 3; i += 1) {
    const part = parts[i] ?? 'x';
    if (/^(x|\*)$/i.test(part)) {
      if (wildcardIndex < 0) wildcardIndex = i;
      normalized.push(0);
      continue;
    }
    if (!/^(0|[1-9]\d*)$/.test(part)) return { valid: false, error: 'invalid-version-core' };
    if (wildcardIndex >= 0) return { valid: false, error: 'wildcard-order' };
    normalized.push(Number(part));
  }
  return {
    valid: true,
    major: normalized[0],
    minor: normalized[1],
    patch: normalized[2],
    wildcardIndex,
    error: '',
  };
}

function upperForWildcard(core) {
  if (core.wildcardIndex === 0) return null;
  if (core.wildcardIndex === 1) return { major: core.major + 1, minor: 0, patch: 0 };
  if (core.wildcardIndex === 2) return { major: core.major, minor: core.minor + 1, patch: 0 };
  return null;
}

function caretUpper(core) {
  if (core.major > 0) return { major: core.major + 1, minor: 0, patch: 0 };
  if (core.minor > 0) return { major: 0, minor: core.minor + 1, patch: 0 };
  return { major: 0, minor: 0, patch: core.patch + 1 };
}

function tildeUpper(core) {
  if (core.wildcardIndex === 1) return { major: core.major + 1, minor: 0, patch: 0 };
  return { major: core.major, minor: core.minor + 1, patch: 0 };
}

function semverCompareTo(left, operator, right) {
  const compared = semanticVersionCompare(left, right);
  switch (operator) {
    case '>': return compared > 0;
    case '>=': return compared >= 0;
    case '<': return compared < 0;
    case '<=': return compared <= 0;
    case '=': return compared === 0;
    default: return false;
  }
}

function expandSemverToken(token) {
  const raw = String(token ?? '').trim();
  if (!raw || raw === '*' || /^x$/i.test(raw)) return [];
  const caret = raw.startsWith('^');
  const tilde = raw.startsWith('~');
  if (caret || tilde) {
    const core = parseVersionCore(raw.slice(1));
    if (!core.valid || core.wildcardIndex >= 0) return [{ valid: false, raw, error: core.error || 'invalid-range' }];
    const lower = versionCoreFromParts(core);
    const upper = versionCoreFromParts(caret ? caretUpper(core) : tildeUpper(core));
    return [
      { valid: true, raw, operator: '>=', version: lower },
      { valid: true, raw, operator: '<', version: upper },
    ];
  }

  const comparator = /^(<=|>=|<|>|=)?(.+)$/.exec(raw);
  if (!comparator) return [{ valid: false, raw, error: 'invalid-comparator' }];
  const operator = comparator[1] ?? '=';
  const version = comparator[2].trim();
  const core = parseVersionCore(version);
  if (core.valid && core.wildcardIndex >= 0) {
    const constraints = [{ valid: true, raw, operator: '>=', version: versionCoreFromParts(core) }];
    const upper = upperForWildcard(core);
    if (upper) constraints.push({ valid: true, raw, operator: '<', version: versionCoreFromParts(upper) });
    return constraints;
  }
  const parsed = parseSemanticVersion(version);
  if (!parsed.valid) return [{ valid: false, raw, error: parsed.error }];
  return [{ valid: true, raw, operator, version: parsed.version }];
}

function semanticVersionAlternativeReport(version, alternative, index) {
  const tokens = String(alternative ?? '')
    .trim()
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const expanded = tokens.length === 0 ? [] : tokens.flatMap(expandSemverToken);
  const constraints = expanded.filter((constraint) => constraint.valid);
  const errors = expanded.filter((constraint) => !constraint.valid).map((constraint) => `${constraint.raw}:${constraint.error}`);
  let satisfied = errors.length === 0;
  if (satisfied) {
    for (const constraint of constraints) {
      if (!semverCompareTo(version, constraint.operator, constraint.version)) {
        satisfied = false;
        break;
      }
    }
  }
  return Object.freeze({
    index,
    raw: String(alternative ?? '').trim(),
    valid: errors.length === 0,
    satisfied,
    constraints: Object.freeze(constraints.map((constraint) => Object.freeze({ ...constraint }))),
    errors: Object.freeze(errors),
  });
}

export function semanticVersionRangeReport(version, range = '*') {
  const parsed = parseSemanticVersion(version);
  const rawRange = String(range ?? '*').trim() || '*';
  if (!parsed.valid) {
    return {
      valid: false,
      version: String(version ?? '').trim(),
      range: rawRange,
      satisfied: false,
      alternatives: Object.freeze([]),
      errors: Object.freeze([parsed.error]),
    };
  }
  const alternatives = rawRange.split(/\s*\|\|\s*/).map((alternative, index) => semanticVersionAlternativeReport(parsed.version, alternative, index));
  const errors = alternatives.flatMap((alternative) => alternative.errors.map((error) => `${alternative.index}:${error}`));
  return {
    valid: errors.length === 0,
    version: parsed.version,
    range: rawRange,
    satisfied: alternatives.some((alternative) => alternative.satisfied),
    alternatives: Object.freeze(alternatives),
    errors: Object.freeze(errors),
  };
}

export function formatCompatibilityReport(candidate, requirements = {}, options = {}) {
  const acceptValue = requirements.accept ?? requirements.accepts ?? options.accept;
  const versionRange = requirements.semverRange ?? requirements.versionRange ?? options.semverRange ?? options.versionRange;
  const version = candidate?.version ?? candidate?.semver ?? options.version;
  const accept = acceptValue === undefined ? null : formatAcceptMatchReport(candidate, acceptValue, options.acceptOptions ?? {});
  const versionReport = versionRange === undefined ? null : semanticVersionRangeReport(version, versionRange);
  const checks = [
    accept ? Object.freeze({ id: 'accept', valid: accept.valid, passed: accept.accepted, reason: accept.reason }) : null,
    versionReport ? Object.freeze({ id: 'semver', valid: versionReport.valid, passed: versionReport.satisfied, reason: versionReport.satisfied ? 'matched' : 'out-of-range' }) : null,
  ].filter(Boolean);
  return {
    valid: checks.every((check) => check.valid),
    compatible: checks.length === 0 ? true : checks.every((check) => check.valid && check.passed),
    checks: Object.freeze(checks),
    accept,
    version: versionReport,
    errors: Object.freeze([
      ...(accept?.accept.errors ?? []),
      ...(versionReport?.errors ?? []),
    ]),
  };
}

function versionTokens(value) {
  return String(value ?? '')
    .trim()
    .split(/[\s._+\-]+/)
    .flatMap((part) => part.match(/\d+|[A-Za-z]+|[^A-Za-z0-9]+/g) ?? [])
    .filter((token) => token.length > 0);
}

function tokenIsZero(token) {
  return /^\d+$/.test(token) && Number(token) === 0;
}

export function versionCompare(leftVersion, rightVersion) {
  const left = versionTokens(leftVersion);
  const right = versionTokens(rightVersion);
  const count = Math.max(left.length, right.length);
  for (let i = 0; i < count; i += 1) {
    const leftToken = left[i];
    const rightToken = right[i];
    if (leftToken === undefined) return right.slice(i).every(tokenIsZero) ? 0 : -1;
    if (rightToken === undefined) return left.slice(i).every(tokenIsZero) ? 0 : 1;
    const leftNumeric = /^\d+$/.test(leftToken);
    const rightNumeric = /^\d+$/.test(rightToken);
    if (leftNumeric && rightNumeric) {
      const compared = compareNumberLike(leftToken, rightToken);
      if (compared !== 0) return compared;
      continue;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? 1 : -1;
    const leftLower = leftToken.toLowerCase();
    const rightLower = rightToken.toLowerCase();
    if (leftLower !== rightLower) return leftLower < rightLower ? -1 : 1;
  }
  return 0;
}

export function lineColumnMap(text) {
  const source = String(text ?? '');
  const lineStarts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  return Object.freeze({
    text: source,
    length: source.length,
    lineStarts: Object.freeze(lineStarts),
    lineCount: lineStarts.length,
  });
}

function normalizeLineMap(mapOrText) {
  return mapOrText && typeof mapOrText === 'object' && Array.isArray(mapOrText.lineStarts)
    ? mapOrText
    : lineColumnMap(mapOrText);
}

function lineIndexForOffset(lineStarts, index) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lineStarts[mid] <= index) {
      if (mid === lineStarts.length - 1 || lineStarts[mid + 1] > index) return mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return 0;
}

export function lineColumnAt(mapOrText, index) {
  const map = normalizeLineMap(mapOrText);
  const offset = nonnegativeInteger(index, 'index');
  if (offset > map.length) throw new RangeError(`index out of bounds: ${offset} > ${map.length}`);
  const lineIndex = lineIndexForOffset(map.lineStarts, offset);
  return {
    index: offset,
    line: lineIndex + 1,
    column: offset - map.lineStarts[lineIndex] + 1,
  };
}

export function lineColumnToIndex(mapOrText, line, column) {
  const map = normalizeLineMap(mapOrText);
  const lineNumber = positiveInteger(line, 'line');
  const columnNumber = positiveInteger(column, 'column');
  if (lineNumber > map.lineStarts.length) throw new RangeError(`line out of bounds: ${lineNumber} > ${map.lineStarts.length}`);
  const start = map.lineStarts[lineNumber - 1];
  const nextStart = lineNumber < map.lineStarts.length ? map.lineStarts[lineNumber] : map.length + 1;
  const index = start + columnNumber - 1;
  if (index >= nextStart) throw new RangeError(`column out of bounds: ${columnNumber}`);
  return index;
}

export function rangeSpan(start, end, options = {}) {
  const startNumber = Number(start);
  const endNumber = Number(end);
  const finite = Number.isFinite(startNumber) && Number.isFinite(endNumber);
  const integer = Number.isInteger(startNumber) && Number.isInteger(endNumber);
  const nonnegative = finite && startNumber >= 0 && endNumber >= 0;
  const ordered = finite && endNumber >= startNumber;
  const length = finite && ordered ? endNumber - startNumber : NaN;
  const limit = options.limit === undefined ? Infinity : nonnegativeInteger(options.limit, 'limit');
  const within = finite && ordered && endNumber <= limit;
  const valid = finite && integer && nonnegative && ordered && within;
  return {
    valid,
    start: startNumber,
    end: endNumber,
    length,
    limit,
    within,
    finite,
    integer,
    nonnegative,
    ordered,
    reason: valid
      ? 'valid'
      : (!finite ? 'non-finite' : (!integer ? 'non-integer' : (!nonnegative ? 'negative' : (!ordered ? 'reversed' : 'out-of-bounds')))),
  };
}

function normalizeChunkFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) throw new TypeError('fields must be a nonempty array');
  let nextOffset = 0;
  return fields.map((field, index) => {
    const name = String(field.name ?? `field${index}`);
    const type = String(field.type ?? 'u8').toLowerCase();
    const byteSize = bufferValueByteSize(type);
    const byteOffset = nonnegativeInteger(field.byteOffset ?? field.relativeOffset ?? nextOffset, `${name}.byteOffset`);
    nextOffset = byteOffset + byteSize;
    return Object.freeze({ name, type, byteOffset, byteSize });
  });
}

export function chunkTableParse(data, options = {}) {
  const bytes = formatByteView(data);
  const byteOffset = nonnegativeInteger(options.byteOffset ?? 0, 'byteOffset');
  const endian = options.endian ?? options.littleEndian ?? 'little';
  const errors = [];
  let fields = [];
  let entryByteLength = 0;
  let entryCount = 0;

  try {
    fields = normalizeChunkFields(options.fields ?? []);
    const minimumEntryLength = fields.reduce((max, field) => Math.max(max, field.byteOffset + field.byteSize), 0);
    entryByteLength = options.entryByteLength === undefined
      ? minimumEntryLength
      : positiveInteger(options.entryByteLength, 'entryByteLength');
    if (entryByteLength < minimumEntryLength) errors.push('entry-byte-length-too-small');
    const availableEntries = Math.floor(Math.max(0, bytes.byteLength - byteOffset) / entryByteLength);
    entryCount = options.entryCount === undefined ? availableEntries : nonnegativeInteger(options.entryCount, 'entryCount');
  } catch (error) {
    return {
      valid: false,
      byteOffset,
      entryCount: 0,
      entryByteLength: 0,
      byteLength: 0,
      entries: Object.freeze([]),
      fields: Object.freeze([]),
      errors: Object.freeze([String(error?.message ?? error)]),
    };
  }

  const byteLength = entryByteLength * entryCount;
  const range = bufferRangeReport(bytes, byteOffset, byteLength, { alignment: options.alignment ?? 1 });
  if (!range.valid) errors.push(`range-${range.reason}`);

  const entries = [];
  if (errors.length === 0) {
    for (let index = 0; index < entryCount; index += 1) {
      const entryOffset = byteOffset + index * entryByteLength;
      const entry = { index, byteOffset: entryOffset };
      for (const field of fields) {
        entry[field.name] = bufferRead(bytes, field.type, entryOffset + field.byteOffset, { endian });
      }
      entries.push(Object.freeze(entry));
    }
  }

  return {
    valid: errors.length === 0,
    byteOffset,
    entryCount,
    entryByteLength,
    byteLength,
    entries: Object.freeze(entries),
    fields: Object.freeze(fields),
    errors: Object.freeze(errors),
  };
}

function predicateMatches(predicate, char, index, text) {
  if (typeof predicate === 'function') return predicate(char, index, text) === true;
  if (predicate instanceof RegExp) {
    const flags = predicate.flags.includes('g') ? predicate.flags.replace('g', '') : predicate.flags;
    return new RegExp(predicate.source, flags).test(char);
  }
  if (typeof predicate === 'string') return predicate.length > 0 && text.startsWith(predicate, index);
  return false;
}

function tokenResult(cursor, start, end) {
  const location = lineColumnAt(cursor.lineMap, start);
  return Object.freeze({
    value: cursor.text.slice(start, end),
    start,
    end,
    length: end - start,
    line: location.line,
    column: location.column,
  });
}

export class TokenCursor {
  constructor(text, options = {}) {
    this.text = String(text ?? '');
    this.offset = nonnegativeInteger(options.offset ?? 0, 'offset');
    if (this.offset > this.text.length) throw new RangeError(`offset out of bounds: ${this.offset} > ${this.text.length}`);
    this.lineMap = lineColumnMap(this.text);
  }

  get eof() {
    return this.offset >= this.text.length;
  }

  get remaining() {
    return Math.max(0, this.text.length - this.offset);
  }

  location() {
    return lineColumnAt(this.lineMap, this.offset);
  }

  seek(index) {
    const offset = nonnegativeInteger(index, 'index');
    if (offset > this.text.length) throw new RangeError(`index out of bounds: ${offset} > ${this.text.length}`);
    this.offset = offset;
    return this;
  }

  peek(count = 1) {
    const length = nonnegativeInteger(count, 'count');
    return this.text.slice(this.offset, this.offset + length);
  }

  read(count = 1) {
    const length = nonnegativeInteger(count, 'count');
    const start = this.offset;
    const end = Math.min(this.text.length, this.offset + length);
    this.offset = end;
    return tokenResult(this, start, end);
  }

  skipWhitespace() {
    while (!this.eof && /\s/.test(this.text[this.offset])) this.offset += 1;
    return this;
  }

  readWhile(predicate) {
    const start = this.offset;
    while (!this.eof && predicateMatches(predicate, this.text[this.offset], this.offset, this.text)) this.offset += 1;
    return tokenResult(this, start, this.offset);
  }

  readUntil(predicate) {
    const start = this.offset;
    if (predicate instanceof RegExp && predicate.source === '$') {
      this.offset = this.text.length;
      return tokenResult(this, start, this.offset);
    }
    while (!this.eof && !predicateMatches(predicate, this.text[this.offset], this.offset, this.text)) this.offset += 1;
    return tokenResult(this, start, this.offset);
  }

  expect(value) {
    const expected = String(value ?? '');
    if (!this.text.startsWith(expected, this.offset)) {
      const location = this.location();
      throw new SyntaxError(`expected "${expected}" at ${location.line}:${location.column}`);
    }
    return this.read(expected.length);
  }
}

export function createTokenCursor(text, options = {}) {
  return new TokenCursor(text, options);
}

export default Object.freeze({
  FORMAT_EXTENSION_MIME_TYPES,
  MAGIC_NUMBER_SIGNATURES,
  TokenCursor,
  byteSignature,
  chunkTableParse,
  createTokenCursor,
  formatAcceptHeaderReport,
  formatAcceptListReport,
  formatAcceptMatchReport,
  formatCompatibilityReport,
  formatExtensionFromPath,
  formatMimeFromExtension,
  formatMimeSniff,
  hexToBytes,
  lineColumnAt,
  lineColumnMap,
  lineColumnToIndex,
  magicNumberDetect,
  mimeTypeGroupReport,
  parseMimeType,
  parseSemanticVersion,
  rangeSpan,
  semanticVersionCompare,
  semanticVersionRangeReport,
  versionCompare,
});
