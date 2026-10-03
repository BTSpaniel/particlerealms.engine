// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// BufferMath.js - reusable byte views, endian-safe DataView reads/writes, UTF-8 helpers, and cursors.

const DEFAULT_ENDIAN = 'little';

export const BUFFER_ENDIAN = Object.freeze({
  little: 'little',
  big: 'big',
});

export const BUFFER_VALUE_TYPES = Object.freeze({
  u8: Object.freeze({ byteSize: 1, get: 'getUint8', set: 'setUint8', endian: false, bigint: false }),
  i8: Object.freeze({ byteSize: 1, get: 'getInt8', set: 'setInt8', endian: false, bigint: false }),
  u16: Object.freeze({ byteSize: 2, get: 'getUint16', set: 'setUint16', endian: true, bigint: false }),
  i16: Object.freeze({ byteSize: 2, get: 'getInt16', set: 'setInt16', endian: true, bigint: false }),
  u32: Object.freeze({ byteSize: 4, get: 'getUint32', set: 'setUint32', endian: true, bigint: false }),
  i32: Object.freeze({ byteSize: 4, get: 'getInt32', set: 'setInt32', endian: true, bigint: false }),
  f32: Object.freeze({ byteSize: 4, get: 'getFloat32', set: 'setFloat32', endian: true, bigint: false }),
  f64: Object.freeze({ byteSize: 8, get: 'getFloat64', set: 'setFloat64', endian: true, bigint: false }),
  u64: Object.freeze({ byteSize: 8, get: 'getBigUint64', set: 'setBigUint64', endian: true, bigint: true }),
  i64: Object.freeze({ byteSize: 8, get: 'getBigInt64', set: 'setBigInt64', endian: true, bigint: true }),
});

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

function normalizeType(type) {
  const key = String(type ?? '').trim().toLowerCase();
  const info = BUFFER_VALUE_TYPES[key];
  if (!info) {
    throw new RangeError(`unsupported buffer value type: ${type}`);
  }
  return { key, info };
}

export function bufferLittleEndian(endian = DEFAULT_ENDIAN) {
  if (typeof endian === 'boolean') return endian;
  const key = String(endian ?? DEFAULT_ENDIAN).trim().toLowerCase();
  if (key === 'le' || key === 'little' || key === 'little-endian') return true;
  if (key === 'be' || key === 'big' || key === 'big-endian') return false;
  throw new RangeError(`unsupported buffer endian: ${endian}`);
}

export function bufferEndianName(endian = DEFAULT_ENDIAN) {
  return bufferLittleEndian(endian) ? BUFFER_ENDIAN.little : BUFFER_ENDIAN.big;
}

export function bufferValueByteSize(type) {
  return normalizeType(type).info.byteSize;
}

export function bufferByteView(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new TypeError('data must be an ArrayBuffer or typed-array view');
}

export function bufferDataView(data) {
  if (data instanceof DataView) return data;
  const bytes = bufferByteView(data);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function bufferRangeReport(data, byteOffset = 0, byteLength = 0, options = {}) {
  let availableBytes = 0;
  let dataValid = true;
  let dataError = '';
  try {
    availableBytes = bufferByteView(data).byteLength;
  } catch (error) {
    dataValid = false;
    dataError = String(error?.message ?? error);
  }

  const offset = Number(byteOffset);
  const length = Number(byteLength);
  const finite = Number.isFinite(offset) && Number.isFinite(length);
  const integer = Number.isInteger(offset) && Number.isInteger(length);
  const nonnegative = finite && offset >= 0 && length >= 0;
  const endOffset = finite ? offset + length : NaN;
  const within = dataValid && finite && integer && nonnegative && endOffset <= availableBytes;
  const expectedAlignment = options.alignment === undefined ? 1 : positiveInteger(options.alignment, 'alignment');
  const aligned = finite && integer && nonnegative && expectedAlignment > 0 && offset % expectedAlignment === 0;
  const valid = dataValid && within && aligned;

  return {
    valid,
    dataValid,
    dataError,
    byteOffset: offset,
    byteLength: length,
    endOffset,
    availableBytes,
    finite,
    integer,
    nonnegative,
    within,
    alignment: expectedAlignment,
    aligned,
    remainingBytes: dataValid && finite && integer ? Math.max(0, availableBytes - Math.max(0, endOffset)) : 0,
    reason: valid
      ? 'valid'
      : (!dataValid ? 'invalid-data' : (!finite ? 'non-finite' : (!integer ? 'non-integer' : (!nonnegative ? 'negative' : (!aligned ? 'unaligned' : 'out-of-bounds'))))),
  };
}

function assertRange(data, byteOffset, byteLength, label = 'buffer range') {
  const report = bufferRangeReport(data, byteOffset, byteLength);
  if (!report.valid) {
    throw new RangeError(`${label} ${report.reason}: offset ${report.byteOffset}, length ${report.byteLength}, available ${report.availableBytes}`);
  }
  return report;
}

export function bufferRead(data, type, byteOffset, options = {}) {
  const { key, info } = normalizeType(type);
  assertRange(data, byteOffset, info.byteSize, `${key} read`);
  const view = bufferDataView(data);
  if (info.endian) {
    return view[info.get](byteOffset, bufferLittleEndian(options.endian ?? options.littleEndian ?? DEFAULT_ENDIAN));
  }
  return view[info.get](byteOffset);
}

export function bufferWrite(data, type, byteOffset, value, options = {}) {
  const { key, info } = normalizeType(type);
  assertRange(data, byteOffset, info.byteSize, `${key} write`);
  const view = bufferDataView(data);
  const writeValue = info.bigint ? BigInt(value) : Number(value);
  if (info.endian) {
    view[info.set](byteOffset, writeValue, bufferLittleEndian(options.endian ?? options.littleEndian ?? DEFAULT_ENDIAN));
  } else {
    view[info.set](byteOffset, writeValue);
  }
  return {
    type: key,
    byteOffset,
    byteLength: info.byteSize,
    endOffset: byteOffset + info.byteSize,
    value: writeValue,
    endian: info.endian ? bufferEndianName(options.endian ?? options.littleEndian ?? DEFAULT_ENDIAN) : 'none',
  };
}

export function encodeUtf8(text) {
  return new TextEncoder().encode(String(text ?? ''));
}

export function decodeUtf8(data, options = {}) {
  const bytes = bufferByteView(data);
  const decoder = new TextDecoder(options.encoding ?? 'utf-8', {
    fatal: options.fatal === true,
    ignoreBOM: options.ignoreBOM === true,
  });
  return decoder.decode(bytes);
}

export function bufferReadUtf8(data, byteOffset, byteLength, options = {}) {
  assertRange(data, byteOffset, byteLength, 'utf8 read');
  const bytes = bufferByteView(data);
  return decodeUtf8(bytes.subarray(byteOffset, byteOffset + byteLength), options);
}

export function bufferWriteUtf8(data, byteOffset, text, options = {}) {
  const encoded = encodeUtf8(text);
  const fixedByteLength = options.byteLength === undefined ? encoded.byteLength : nonnegativeInteger(options.byteLength, 'byteLength');
  const byteLength = options.byteLength === undefined ? encoded.byteLength : fixedByteLength;
  assertRange(data, byteOffset, byteLength, 'utf8 write');
  const bytes = bufferByteView(data);
  const writeLength = Math.min(encoded.byteLength, byteLength);
  bytes.set(encoded.subarray(0, writeLength), byteOffset);
  if (byteLength > writeLength) {
    bytes.fill(nonnegativeInteger(options.padByte ?? 0, 'padByte') & 0xff, byteOffset + writeLength, byteOffset + byteLength);
  }
  return {
    byteOffset,
    byteLength,
    bytesWritten: writeLength,
    truncated: encoded.byteLength > byteLength,
    endOffset: byteOffset + byteLength,
  };
}

export function concatBufferBytes(chunks) {
  if (!chunks || (typeof chunks[Symbol.iterator] !== 'function' && typeof chunks.length !== 'number')) {
    throw new TypeError('chunks must be an iterable or array-like list');
  }
  const views = Array.from(chunks, (chunk) => bufferByteView(chunk));
  const byteLength = views.reduce((sum, view) => sum + view.byteLength, 0);
  const out = new Uint8Array(byteLength);
  let offset = 0;
  for (const view of views) {
    out.set(view, offset);
    offset += view.byteLength;
  }
  return out;
}

export class BufferCursor {
  constructor(dataOrByteLength, options = {}) {
    const data = typeof dataOrByteLength === 'number'
      ? new ArrayBuffer(nonnegativeInteger(dataOrByteLength, 'dataOrByteLength'))
      : dataOrByteLength;
    this.bytes = bufferByteView(data);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.offset = nonnegativeInteger(options.offset ?? 0, 'offset');
    this.endian = bufferEndianName(options.endian ?? options.littleEndian ?? DEFAULT_ENDIAN);
    assertRange(this.bytes, this.offset, 0, 'cursor offset');
  }

  get byteLength() {
    return this.bytes.byteLength;
  }

  get remainingBytes() {
    return Math.max(0, this.byteLength - this.offset);
  }

  report(byteLength = 0) {
    return bufferRangeReport(this.bytes, this.offset, byteLength);
  }

  ensure(byteLength) {
    const length = nonnegativeInteger(byteLength, 'byteLength');
    assertRange(this.bytes, this.offset, length, 'cursor');
    return this;
  }

  seek(byteOffset) {
    const offset = nonnegativeInteger(byteOffset, 'byteOffset');
    assertRange(this.bytes, offset, 0, 'cursor seek');
    this.offset = offset;
    return this;
  }

  skip(byteLength) {
    const length = nonnegativeInteger(byteLength, 'byteLength');
    return this.seek(this.offset + length);
  }

  align(alignment) {
    const align = positiveInteger(alignment, 'alignment');
    return this.seek(Math.ceil(this.offset / align) * align);
  }

  read(type, options = {}) {
    const { key, info } = normalizeType(type);
    this.ensure(info.byteSize);
    const value = bufferRead(this.bytes, key, this.offset, { endian: options.endian ?? this.endian });
    this.offset += info.byteSize;
    return value;
  }

  write(type, value, options = {}) {
    const { key, info } = normalizeType(type);
    this.ensure(info.byteSize);
    const report = bufferWrite(this.bytes, key, this.offset, value, { endian: options.endian ?? this.endian });
    this.offset += info.byteSize;
    return report;
  }

  readBytes(byteLength) {
    const length = nonnegativeInteger(byteLength, 'byteLength');
    this.ensure(length);
    const out = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  writeBytes(values) {
    const source = bufferByteView(values);
    this.ensure(source.byteLength);
    this.bytes.set(source, this.offset);
    this.offset += source.byteLength;
    return {
      byteLength: source.byteLength,
      endOffset: this.offset,
    };
  }

  readUtf8(byteLength, options = {}) {
    const length = nonnegativeInteger(byteLength, 'byteLength');
    const text = bufferReadUtf8(this.bytes, this.offset, length, options);
    this.offset += length;
    return text;
  }

  writeUtf8(text, options = {}) {
    const report = bufferWriteUtf8(this.bytes, this.offset, text, options);
    this.offset = report.endOffset;
    return report;
  }

  readLengthPrefixedUtf8(lengthType = 'u32', options = {}) {
    const length = Number(this.read(lengthType, options));
    return this.readUtf8(length, options);
  }

  writeLengthPrefixedUtf8(text, lengthType = 'u32', options = {}) {
    const encoded = encodeUtf8(text);
    this.write(lengthType, encoded.byteLength, options);
    this.writeBytes(encoded);
    return {
      byteLength: bufferValueByteSize(lengthType) + encoded.byteLength,
      stringByteLength: encoded.byteLength,
      endOffset: this.offset,
    };
  }

  toUint8Array() {
    return this.bytes;
  }

  toArrayBuffer() {
    return this.bytes.buffer.slice(this.bytes.byteOffset, this.bytes.byteOffset + this.bytes.byteLength);
  }
}

export function createBufferCursor(dataOrByteLength, options = {}) {
  return new BufferCursor(dataOrByteLength, options);
}

export function bufferCursorReport(cursor) {
  if (!cursor || typeof cursor.offset !== 'number' || typeof cursor.byteLength !== 'number') {
    throw new TypeError('cursor must be a BufferCursor-like object');
  }
  return {
    valid: cursor.offset >= 0 && cursor.offset <= cursor.byteLength,
    byteOffset: cursor.offset,
    byteLength: cursor.byteLength,
    remainingBytes: Math.max(0, cursor.byteLength - cursor.offset),
    endian: cursor.endian ?? DEFAULT_ENDIAN,
  };
}

export default {
  BUFFER_ENDIAN,
  BUFFER_VALUE_TYPES,
  BufferCursor,
  bufferLittleEndian,
  bufferEndianName,
  bufferValueByteSize,
  bufferByteView,
  bufferDataView,
  bufferRangeReport,
  bufferRead,
  bufferWrite,
  encodeUtf8,
  decodeUtf8,
  bufferReadUtf8,
  bufferWriteUtf8,
  concatBufferBytes,
  createBufferCursor,
  bufferCursorReport,
};
