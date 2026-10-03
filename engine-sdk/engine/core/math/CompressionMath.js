// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// CompressionMath.js - pure compression primitive reports and planning helpers.

import {
  createPalette,
  decodePalette,
  deltaDecode,
  deltaEncode,
  packVLInt,
  runLengthDecode,
  runLengthEncode,
  unpackVLInt,
} from '../compression/CompressionUtils.js';
import { compressionRatioReport } from './BenchmarkMath.js';
import {
  entropyCompressionEstimate,
  entropyReport,
} from './MathEntropy.js';

const DEFAULT_VALUE_BYTES = 1;
const DEFAULT_NUMERIC_BYTES = 4;
const DEFAULT_RLE_MAX_RUN_LENGTH = 255;
const DEFAULT_DEFLATE_WINDOW_BYTES = 32768;
const DEFAULT_DEFLATE_MAX_MATCH_LENGTH = 258;
const DEFAULT_DEFLATE_MIN_MATCH_LENGTH = 3;
const DEFAULT_DEFLATE_BLOCK_BYTES = 32768;
const DEFAULT_HUFFMAN_CODE_LENGTH_BITS = 5;
const DEFAULT_RANGE_COUNT_BYTES = 2;
const DEFAULT_RANGE_FLUSH_BITS = 32;
const DEFAULT_DICTIONARY_MIN_LENGTH = 3;
const DEFAULT_DICTIONARY_MAX_LENGTH = 16;
const DEFAULT_DICTIONARY_TOKEN_BYTES = 1;
const MAX_VLINT_VALUE = 0x3fffff;
const INT32_MIN = -0x80000000;
const INT32_MAX = 0x7fffffff;
const CANDIDATE_PRIORITY = new Map([
  ['raw', 0],
  ['rle', 1],
  ['palette', 2],
  ['dictionary', 3],
  ['delta', 4],
  ['varint', 5],
  ['huffman', 6],
  ['range-model', 7],
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

function positiveByteCount(value, name) {
  return positiveInteger(value, name);
}

function arrayFromIterable(values, name = 'values') {
  if (!values || typeof values[Symbol.iterator] !== 'function') {
    throw new TypeError(`${name} must be an iterable`);
  }
  return Array.from(values);
}

function numericArray(values, name = 'values') {
  return arrayFromIterable(values, name).map((value, index) => {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new RangeError(`${name}[${index}] must be finite`);
    }
    return number;
  });
}

function integerArray(values, name = 'values') {
  return arrayFromIterable(values, name).map((value, index) => finiteInteger(value, `${name}[${index}]`));
}

function byteLengthFromBits(bitLength) {
  return Math.ceil(Math.max(0, bitLength) / 8);
}

function symbolToken(value) {
  return `${typeof value}:${String(value)}`;
}

function sequenceKey(source, start, length) {
  const parts = [];
  for (let offset = 0; offset < length; offset++) {
    parts.push(symbolToken(source[start + offset]));
  }
  return parts.join('\u001f');
}

function frequencyEntries(source) {
  const map = new Map();
  for (const value of source) {
    let entry = map.get(value);
    if (!entry) {
      entry = {
        symbol: value,
        count: 0,
        order: map.size,
      };
      map.set(value, entry);
    }
    entry.count++;
  }
  return Array.from(map.values());
}

function sortFrequencyEntries(entries) {
  return entries
    .slice()
    .sort((left, right) => right.count - left.count || left.order - right.order);
}

function nonOverlappingPositions(positions, length) {
  const selected = [];
  let nextStart = 0;
  for (const position of positions) {
    if (position >= nextStart) {
      selected.push(position);
      nextStart = position + length;
    }
  }
  return selected;
}

function arraysEqual(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function sizeReport(inputBytes, outputBytes, quality = 1) {
  return compressionRatioReport({ inputBytes, outputBytes, quality });
}

function candidate(id, outputBytes, report) {
  return {
    id,
    outputBytes,
    compressionRatio: report.compressionRatio,
    savingsRatio: report.savingsRatio,
    wouldExpand: outputBytes > report.inputBytes,
  };
}

function candidateTieBreak(left, right) {
  return (CANDIDATE_PRIORITY.get(left.id) ?? 99) - (CANDIDATE_PRIORITY.get(right.id) ?? 99)
    || left.id.localeCompare(right.id);
}

export function compressionZigZagEncode(value) {
  const integer = finiteInteger(value, 'value');
  if (integer < INT32_MIN || integer > INT32_MAX) {
    throw new RangeError('value must fit a signed 32-bit integer');
  }
  return integer < 0 ? ((-integer * 2) - 1) : integer * 2;
}

export function compressionZigZagDecode(encoded) {
  const integer = nonnegativeInteger(encoded, 'encoded');
  if (integer > 0xffffffff) {
    throw new RangeError('encoded must fit an unsigned 32-bit integer');
  }
  return integer % 2 === 0 ? integer / 2 : -((integer + 1) / 2);
}

export function compressionRunLengthReport(values, options = {}) {
  const source = arrayFromIterable(values);
  const valueBytes = positiveByteCount(options.valueBytes ?? DEFAULT_VALUE_BYTES, 'valueBytes');
  const countBytes = positiveByteCount(options.countBytes ?? 1, 'countBytes');
  const maxRunLength = options.maxRunLength === Infinity
    ? Infinity
    : positiveInteger(options.maxRunLength ?? DEFAULT_RLE_MAX_RUN_LENGTH, 'maxRunLength');
  const runs = runLengthEncode(source).map(([value, count]) => ({ value, count }));
  const decoded = runLengthDecode(runs.map((run) => [run.value, run.count]));
  let splitRunCount = 0;
  let longestRunLength = 0;

  for (const run of runs) {
    longestRunLength = Math.max(longestRunLength, run.count);
    splitRunCount += maxRunLength === Infinity ? 1 : Math.ceil(run.count / maxRunLength);
  }

  const rawByteLength = source.length * valueBytes;
  const encodedByteLength = splitRunCount * (valueBytes + countBytes);
  const ratio = sizeReport(rawByteLength, encodedByteLength);

  return {
    sampleCount: source.length,
    runCount: runs.length,
    splitRunCount,
    maxRunLength,
    longestRunLength,
    averageRunLength: runs.length > 0 ? source.length / runs.length : 0,
    rawByteLength,
    encodedByteLength,
    compressionRatio: ratio.compressionRatio,
    savingsRatio: ratio.savingsRatio,
    wouldExpand: encodedByteLength > rawByteLength,
    roundTrip: arraysEqual(source, decoded),
    runs,
  };
}

export function compressionDeltaReport(values, options = {}) {
  const source = numericArray(values);
  const valueBytes = positiveByteCount(options.valueBytes ?? DEFAULT_NUMERIC_BYTES, 'valueBytes');
  const deltas = deltaEncode(source);
  const decoded = deltaDecode(deltas);
  let minDelta = 0;
  let maxDelta = 0;
  let maxAbsDelta = 0;
  let zeroDeltaCount = 0;
  let monotonicNondecreasing = true;
  let monotonicNonincreasing = true;

  for (let index = 0; index < deltas.length; index++) {
    const delta = Number(deltas[index]);
    if (index === 0 || delta < minDelta) minDelta = delta;
    if (index === 0 || delta > maxDelta) maxDelta = delta;
    maxAbsDelta = Math.max(maxAbsDelta, Math.abs(delta));
    if (delta === 0) zeroDeltaCount++;
    if (index > 0 && source[index] < source[index - 1]) monotonicNondecreasing = false;
    if (index > 0 && source[index] > source[index - 1]) monotonicNonincreasing = false;
  }

  const deltaBitWidth = deltas.length === 0
    ? 0
    : Math.max(1, Math.ceil(Math.log2(maxAbsDelta + 1)) + (minDelta < 0 ? 1 : 0));
  const rawByteLength = source.length * valueBytes;
  const encodedByteLength = byteLengthFromBits(source.length * deltaBitWidth);
  const ratio = sizeReport(rawByteLength, encodedByteLength);

  return {
    sampleCount: source.length,
    deltas,
    minDelta,
    maxDelta,
    maxAbsDelta,
    zeroDeltaCount,
    zeroDeltaRatio: source.length > 0 ? zeroDeltaCount / source.length : 0,
    deltaBitWidth,
    rawByteLength,
    encodedByteLength,
    compressionRatio: ratio.compressionRatio,
    savingsRatio: ratio.savingsRatio,
    wouldExpand: encodedByteLength > rawByteLength,
    monotonicNondecreasing,
    monotonicNonincreasing,
    roundTrip: arraysEqual(source, decoded),
  };
}

export function compressionPaletteReport(values, options = {}) {
  const source = arrayFromIterable(values);
  const valueBytes = positiveByteCount(options.valueBytes ?? DEFAULT_VALUE_BYTES, 'valueBytes');
  const { palette, indices } = createPalette(source);
  const indexBits = options.indexBits === undefined
    ? (palette.length <= 1 ? 0 : Math.ceil(Math.log2(palette.length)))
    : nonnegativeInteger(options.indexBits, 'indexBits');
  const decoded = decodePalette(palette, indices);
  const rawByteLength = source.length * valueBytes;
  const paletteByteLength = palette.length * valueBytes;
  const indexByteLength = byteLengthFromBits(source.length * indexBits);
  const encodedByteLength = paletteByteLength + indexByteLength;
  const ratio = sizeReport(rawByteLength, encodedByteLength);

  return {
    sampleCount: source.length,
    uniqueValueCount: palette.length,
    palette,
    indices,
    indexBits,
    rawByteLength,
    paletteByteLength,
    indexByteLength,
    encodedByteLength,
    compressionRatio: ratio.compressionRatio,
    savingsRatio: ratio.savingsRatio,
    wouldExpand: encodedByteLength > rawByteLength,
    roundTrip: arraysEqual(source, decoded),
  };
}

export function compressionVarintReport(values, options = {}) {
  const source = integerArray(values);
  const signed = !!options.signed;
  const rawBytesPerValue = positiveByteCount(options.rawBytesPerValue ?? DEFAULT_NUMERIC_BYTES, 'rawBytesPerValue');
  const encodedValues = source.map((value, index) => {
    const encoded = signed ? compressionZigZagEncode(value) : nonnegativeInteger(value, `values[${index}]`);
    if (encoded > MAX_VLINT_VALUE) {
      throw new RangeError(`values[${index}] encodes beyond the current VLInt max`);
    }
    return encoded;
  });
  const packed = packVLInt(encodedValues);
  const unpacked = unpackVLInt(packed);
  const decodedValues = signed ? unpacked.map(compressionZigZagDecode) : unpacked;
  const rawByteLength = source.length * rawBytesPerValue;
  const encodedByteLength = packed.byteLength;
  const ratio = sizeReport(rawByteLength, encodedByteLength);

  return {
    sampleCount: source.length,
    signed,
    maxEncodedValue: encodedValues.reduce((max, value) => Math.max(max, value), 0),
    rawByteLength,
    encodedByteLength,
    averageBytesPerValue: source.length > 0 ? encodedByteLength / source.length : 0,
    compressionRatio: ratio.compressionRatio,
    savingsRatio: ratio.savingsRatio,
    wouldExpand: encodedByteLength > rawByteLength,
    roundTrip: arraysEqual(source, decodedValues),
    encodedValues,
    packedBytes: Array.from(packed),
    decodedValues,
  };
}

export function compressionEntropyPlan(data, options = {}) {
  const symbolBits = positiveInteger(options.symbolBits ?? 8, 'symbolBits');
  const report = entropyReport(data, { symbolBits });
  const estimate = entropyCompressionEstimate(report.sampleCount, report.entropyBitsPerSymbol, { symbolBits });
  const ratio = sizeReport(estimate.rawBytes, estimate.lowerBoundBytes);

  return {
    sampleCount: report.sampleCount,
    uniqueSymbolCount: report.uniqueSymbolCount,
    entropyBitsPerSymbol: report.entropyBitsPerSymbol,
    normalizedEntropy: report.normalizedEntropy,
    redundancy: report.redundancy,
    health: report.health,
    rawByteLength: estimate.rawBytes,
    lowerBoundByteLength: estimate.lowerBoundBytes,
    possibleSavingsRatio: estimate.possibleSavingsRatio,
    idealCompressionRatio: ratio.compressionRatio,
    lowerBoundExpansion: estimate.lowerBoundBytes > estimate.rawBytes,
    mostCommon: report.mostCommon,
    leastCommonObserved: report.leastCommonObserved,
  };
}

export function compressionLz77WindowReport(options = {}) {
  const inputBytes = nonnegativeInteger(options.inputBytes ?? 0, 'inputBytes');
  const windowBytes = positiveInteger(options.windowBytes ?? DEFAULT_DEFLATE_WINDOW_BYTES, 'windowBytes');
  const minMatchLength = positiveInteger(options.minMatchLength ?? DEFAULT_DEFLATE_MIN_MATCH_LENGTH, 'minMatchLength');
  const maxMatchLength = positiveInteger(options.maxMatchLength ?? DEFAULT_DEFLATE_MAX_MATCH_LENGTH, 'maxMatchLength');
  const blockBytes = positiveInteger(options.blockBytes ?? DEFAULT_DEFLATE_BLOCK_BYTES, 'blockBytes');
  if (maxMatchLength < minMatchLength) {
    throw new RangeError('maxMatchLength must be >= minMatchLength');
  }

  const blockCount = inputBytes === 0 ? 0 : Math.ceil(inputBytes / blockBytes);
  const worstCaseExpansionBytes = blockCount * 5;
  const searchableHistoryBytes = Math.min(windowBytes, Math.max(0, inputBytes - 1));
  const canReferenceHistory = inputBytes >= minMatchLength;

  return {
    inputBytes,
    windowBytes,
    minMatchLength,
    maxMatchLength,
    blockBytes,
    blockCount,
    searchableHistoryBytes,
    canReferenceHistory,
    worstCaseExpansionBytes,
    worstCaseOutputBytes: inputBytes + worstCaseExpansionBytes,
    worstCaseExpansionRatio: inputBytes > 0 ? worstCaseExpansionBytes / inputBytes : 0,
  };
}

export function compressionHuffmanLengthReport(values, options = {}) {
  const source = arrayFromIterable(values);
  const valueBytes = positiveByteCount(options.valueBytes ?? DEFAULT_VALUE_BYTES, 'valueBytes');
  const symbolBytes = positiveByteCount(options.symbolBytes ?? valueBytes, 'symbolBytes');
  const codeLengthBits = positiveInteger(options.codeLengthBits ?? DEFAULT_HUFFMAN_CODE_LENGTH_BITS, 'codeLengthBits');
  const includeCodebook = options.includeCodebook !== false;
  const singleSymbolCodeLength = nonnegativeInteger(options.singleSymbolCodeLength ?? 1, 'singleSymbolCodeLength');
  const entries = frequencyEntries(source);
  const lengths = new Array(entries.length).fill(0);

  if (entries.length === 1) {
    lengths[0] = singleSymbolCodeLength;
  } else if (entries.length > 1) {
    const nodes = entries.map((entry) => ({
      weight: entry.count,
      order: entry.order,
      indexes: [entry.order],
    }));
    while (nodes.length > 1) {
      nodes.sort((left, right) => left.weight - right.weight || left.order - right.order);
      const left = nodes.shift();
      const right = nodes.shift();
      for (const index of left.indexes) lengths[index]++;
      for (const index of right.indexes) lengths[index]++;
      nodes.push({
        weight: left.weight + right.weight,
        order: Math.min(left.order, right.order),
        indexes: left.indexes.concat(right.indexes),
      });
    }
  }

  let payloadBitLength = 0;
  let maxCodeLength = 0;
  const codeLengths = sortFrequencyEntries(entries).map((entry) => {
    const codeLength = lengths[entry.order] ?? 0;
    const bitLength = entry.count * codeLength;
    payloadBitLength += bitLength;
    maxCodeLength = Math.max(maxCodeLength, codeLength);
    return {
      symbol: entry.symbol,
      count: entry.count,
      probability: source.length > 0 ? entry.count / source.length : 0,
      codeLength,
      bitLength,
    };
  });

  const rawByteLength = source.length * valueBytes;
  const payloadByteLength = byteLengthFromBits(payloadBitLength);
  const codebookByteLength = includeCodebook
    ? entries.length * (symbolBytes + byteLengthFromBits(codeLengthBits))
    : 0;
  const encodedByteLength = payloadByteLength + codebookByteLength;
  const ratio = sizeReport(rawByteLength, encodedByteLength);

  return {
    sampleCount: source.length,
    uniqueSymbolCount: entries.length,
    valueBytes,
    symbolBytes,
    codeLengthBits,
    includeCodebook,
    maxCodeLength,
    payloadBitLength,
    payloadByteLength,
    codebookByteLength,
    rawByteLength,
    encodedByteLength,
    compressionRatio: ratio.compressionRatio,
    savingsRatio: ratio.savingsRatio,
    wouldExpand: encodedByteLength > rawByteLength,
    codeLengths,
  };
}

export function compressionRangeModelReport(values, options = {}) {
  const source = arrayFromIterable(values);
  const valueBytes = positiveByteCount(options.valueBytes ?? DEFAULT_VALUE_BYTES, 'valueBytes');
  const symbolBytes = positiveByteCount(options.symbolBytes ?? valueBytes, 'symbolBytes');
  const countBytes = positiveByteCount(options.countBytes ?? DEFAULT_RANGE_COUNT_BYTES, 'countBytes');
  const flushBits = nonnegativeInteger(options.flushBits ?? DEFAULT_RANGE_FLUSH_BITS, 'flushBits');
  const includeModel = options.includeModel !== false;
  const entries = sortFrequencyEntries(frequencyEntries(source));
  let cumulative = 0;
  let payloadBitLength = 0;
  const model = entries.map((entry) => {
    const low = cumulative;
    cumulative += entry.count;
    const probability = source.length > 0 ? entry.count / source.length : 0;
    const selfInformationBits = probability > 0 ? -Math.log2(probability) : 0;
    payloadBitLength += entry.count * selfInformationBits;
    return {
      symbol: entry.symbol,
      count: entry.count,
      probability,
      cumulativeLow: low,
      cumulativeHigh: cumulative,
      selfInformationBits,
    };
  });

  const rawByteLength = source.length * valueBytes;
  const payloadBitsWithFlush = source.length > 0 ? Math.ceil(payloadBitLength) + flushBits : 0;
  const payloadByteLength = byteLengthFromBits(payloadBitsWithFlush);
  const modelByteLength = includeModel ? entries.length * (symbolBytes + countBytes) : 0;
  const encodedByteLength = payloadByteLength + modelByteLength;
  const ratio = sizeReport(rawByteLength, encodedByteLength);

  return {
    sampleCount: source.length,
    uniqueSymbolCount: entries.length,
    valueBytes,
    symbolBytes,
    countBytes,
    flushBits,
    includeModel,
    payloadBitLength,
    payloadBitsWithFlush,
    payloadByteLength,
    modelByteLength,
    rawByteLength,
    encodedByteLength,
    compressionRatio: ratio.compressionRatio,
    savingsRatio: ratio.savingsRatio,
    wouldExpand: encodedByteLength > rawByteLength,
    model,
  };
}

export function compressionDictionaryMatchReport(values, options = {}) {
  const source = arrayFromIterable(values);
  const valueBytes = positiveByteCount(options.valueBytes ?? DEFAULT_VALUE_BYTES, 'valueBytes');
  const tokenBytes = positiveByteCount(options.tokenBytes ?? DEFAULT_DICTIONARY_TOKEN_BYTES, 'tokenBytes');
  const minLength = positiveInteger(options.minLength ?? DEFAULT_DICTIONARY_MIN_LENGTH, 'minLength');
  const maxLength = positiveInteger(options.maxLength ?? Math.min(DEFAULT_DICTIONARY_MAX_LENGTH, Math.max(minLength, source.length)), 'maxLength');
  const minOccurrences = positiveInteger(options.minOccurrences ?? 2, 'minOccurrences');
  const maxCandidates = positiveInteger(options.maxCandidates ?? 8, 'maxCandidates');
  if (maxLength < minLength) {
    throw new RangeError('maxLength must be >= minLength');
  }

  const rawByteLength = source.length * valueBytes;
  const candidates = [];
  const dictionary = new Map();
  const lastLength = Math.min(maxLength, source.length);
  for (let length = minLength; length <= lastLength; length++) {
    for (let start = 0; start <= source.length - length; start++) {
      const key = sequenceKey(source, start, length);
      let entry = dictionary.get(key);
      if (!entry) {
        entry = {
          sequence: source.slice(start, start + length),
          positions: [],
          length,
        };
        dictionary.set(key, entry);
      }
      entry.positions.push(start);
    }
  }

  for (const entry of dictionary.values()) {
    if (entry.positions.length < minOccurrences) continue;
    const positions = nonOverlappingPositions(entry.positions, entry.length);
    if (positions.length < minOccurrences) continue;
    const rawBytesCovered = positions.length * entry.length * valueBytes;
    const dictionaryByteLength = entry.length * valueBytes;
    const tokenByteLength = positions.length * tokenBytes;
    const encodedByteLength = rawByteLength - rawBytesCovered + dictionaryByteLength + tokenByteLength;
    const savingsBytes = rawByteLength - encodedByteLength;
    candidates.push({
      sequence: entry.sequence,
      length: entry.length,
      occurrenceCount: entry.positions.length,
      nonOverlappingOccurrenceCount: positions.length,
      positions,
      rawBytesCovered,
      dictionaryByteLength,
      tokenByteLength,
      encodedByteLength,
      savingsBytes,
      savingsRatio: rawByteLength > 0 ? savingsBytes / rawByteLength : 0,
      wouldExpand: encodedByteLength > rawByteLength,
    });
  }

  candidates.sort((left, right) => right.savingsBytes - left.savingsBytes
    || left.encodedByteLength - right.encodedByteLength
    || right.length - left.length
    || left.positions[0] - right.positions[0]);
  const limitedCandidates = candidates.slice(0, maxCandidates);
  const best = limitedCandidates[0] ?? null;
  const encodedByteLength = best ? best.encodedByteLength : rawByteLength;
  const ratio = sizeReport(rawByteLength, encodedByteLength);

  return {
    sampleCount: source.length,
    valueBytes,
    tokenBytes,
    minLength,
    maxLength,
    minOccurrences,
    rawByteLength,
    encodedByteLength,
    compressionRatio: ratio.compressionRatio,
    savingsRatio: ratio.savingsRatio,
    wouldExpand: encodedByteLength > rawByteLength,
    candidateCount: candidates.length,
    best,
    candidates: limitedCandidates,
  };
}

export function compressionPrimitivePlan(values, options = {}) {
  const valueBytes = positiveByteCount(options.valueBytes ?? DEFAULT_VALUE_BYTES, 'valueBytes');
  const candidates = [];
  const source = arrayFromIterable(values);
  const rawByteLength = source.length * valueBytes;
  const rawReport = sizeReport(rawByteLength, rawByteLength);
  candidates.push(candidate('raw', rawByteLength, rawReport));

  const rle = compressionRunLengthReport(source, {
    valueBytes,
    countBytes: options.countBytes ?? 1,
    maxRunLength: options.maxRunLength ?? DEFAULT_RLE_MAX_RUN_LENGTH,
  });
  candidates.push(candidate('rle', rle.encodedByteLength, sizeReport(rawByteLength, rle.encodedByteLength)));

  const palette = compressionPaletteReport(source, {
    valueBytes,
    indexBits: options.indexBits,
  });
  candidates.push(candidate('palette', palette.encodedByteLength, sizeReport(rawByteLength, palette.encodedByteLength)));

  const dictionary = compressionDictionaryMatchReport(source, {
    valueBytes,
    tokenBytes: options.dictionaryTokenBytes ?? DEFAULT_DICTIONARY_TOKEN_BYTES,
    minLength: options.dictionaryMinLength ?? DEFAULT_DICTIONARY_MIN_LENGTH,
    maxLength: options.dictionaryMaxLength ?? Math.min(DEFAULT_DICTIONARY_MAX_LENGTH, Math.max(DEFAULT_DICTIONARY_MIN_LENGTH, source.length)),
    minOccurrences: options.dictionaryMinOccurrences ?? 2,
  });
  candidates.push(candidate('dictionary', dictionary.encodedByteLength, sizeReport(rawByteLength, dictionary.encodedByteLength)));

  let delta = null;
  try {
    delta = compressionDeltaReport(source, { valueBytes: options.numericBytes ?? DEFAULT_NUMERIC_BYTES });
    candidates.push(candidate('delta', delta.encodedByteLength, sizeReport(rawByteLength, delta.encodedByteLength)));
  } catch (error) {
    delta = { valid: false, reason: String(error?.message ?? error) };
  }

  let varint = null;
  try {
    varint = compressionVarintReport(source, {
      signed: !!options.signedVarint,
      rawBytesPerValue: options.numericBytes ?? DEFAULT_NUMERIC_BYTES,
    });
    candidates.push(candidate('varint', varint.encodedByteLength, sizeReport(rawByteLength, varint.encodedByteLength)));
  } catch (error) {
    varint = { valid: false, reason: String(error?.message ?? error) };
  }

  const huffman = compressionHuffmanLengthReport(source, {
    valueBytes,
    includeCodebook: options.includeHuffmanCodebook,
    codeLengthBits: options.huffmanCodeLengthBits ?? DEFAULT_HUFFMAN_CODE_LENGTH_BITS,
  });
  candidates.push(candidate('huffman', huffman.encodedByteLength, sizeReport(rawByteLength, huffman.encodedByteLength)));

  const rangeModel = compressionRangeModelReport(source, {
    valueBytes,
    includeModel: options.includeRangeModel,
    countBytes: options.rangeCountBytes ?? DEFAULT_RANGE_COUNT_BYTES,
    flushBits: options.rangeFlushBits ?? DEFAULT_RANGE_FLUSH_BITS,
  });
  candidates.push(candidate('range-model', rangeModel.encodedByteLength, sizeReport(rawByteLength, rangeModel.encodedByteLength)));

  candidates.sort((left, right) => left.outputBytes - right.outputBytes || candidateTieBreak(left, right));
  const best = candidates[0] ?? candidate('raw', 0, rawReport);

  return {
    sampleCount: source.length,
    rawByteLength,
    best,
    candidates,
    rle,
    palette,
    dictionary,
    delta,
    varint,
    huffman,
    rangeModel,
  };
}

export default {
  compressionZigZagEncode,
  compressionZigZagDecode,
  compressionRunLengthReport,
  compressionDeltaReport,
  compressionPaletteReport,
  compressionVarintReport,
  compressionEntropyPlan,
  compressionLz77WindowReport,
  compressionHuffmanLengthReport,
  compressionRangeModelReport,
  compressionDictionaryMatchReport,
  compressionPrimitivePlan,
};
