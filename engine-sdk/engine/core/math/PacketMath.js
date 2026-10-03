// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// PacketMath.js - reusable packet sequence, ACK range, fragmentation, flight, and loss helpers.

import { mod } from './MathScalar.js';

export const PACKET_SEQUENCE_BITS_DEFAULT = 32;
export const PACKET_SEQUENCE_BITS_MAX_SAFE = 52;
export const PACKET_LOSS_PACKET_THRESHOLD = 3;
export const PACKET_LOSS_TIME_THRESHOLD = 9 / 8;
export const PACKET_LOSS_GRANULARITY_MS = 1;
export const PACKET_DEFAULT_DATAGRAM_BYTES = 1200;

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new RangeError(`${name} must be finite`);
  }
  return number;
}

function finiteInteger(value, name) {
  const number = finiteNumber(value, name);
  if (!Number.isInteger(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${name} must be a safe integer`);
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

function nonnegativeNumber(value, name) {
  const number = finiteNumber(value, name);
  if (number < 0) {
    throw new RangeError(`${name} must be nonnegative`);
  }
  return number;
}

function positiveNumber(value, name) {
  const number = finiteNumber(value, name);
  if (number <= 0) {
    throw new RangeError(`${name} must be positive`);
  }
  return number;
}

function normalizeSequenceBits(bits = PACKET_SEQUENCE_BITS_DEFAULT) {
  const normalized = positiveInteger(bits, 'sequenceBits');
  if (normalized > PACKET_SEQUENCE_BITS_MAX_SAFE) {
    throw new RangeError(`sequenceBits must be less than or equal to ${PACKET_SEQUENCE_BITS_MAX_SAFE}`);
  }
  return normalized;
}

function freezeRange(range) {
  return Object.freeze({ ...range });
}

function uniqueSortedPacketNumbers(packetNumbers, name = 'packetNumbers') {
  if (!packetNumbers || typeof packetNumbers[Symbol.iterator] !== 'function') {
    throw new TypeError(`${name} must be iterable`);
  }
  const unique = new Set();
  for (const packetNumber of packetNumbers) {
    unique.add(nonnegativeInteger(packetNumber, `${name}[]`));
  }
  return [...unique].sort((a, b) => a - b);
}

export function packetSequenceModulo(sequenceBits = PACKET_SEQUENCE_BITS_DEFAULT) {
  return 2 ** normalizeSequenceBits(sequenceBits);
}

export function wrapPacketSequence(sequence, sequenceBits = PACKET_SEQUENCE_BITS_DEFAULT) {
  const number = finiteInteger(sequence, 'sequence');
  const modulo = packetSequenceModulo(sequenceBits);
  return mod(number, modulo);
}

export function advancePacketSequence(sequence, increment = 1, sequenceBits = PACKET_SEQUENCE_BITS_DEFAULT) {
  const bits = normalizeSequenceBits(sequenceBits);
  const value = wrapPacketSequence(sequence, bits);
  const step = nonnegativeInteger(increment, 'increment');
  const maxStep = (packetSequenceModulo(bits) / 2) - 1;
  if (step > maxStep) {
    throw new RangeError('increment exceeds the defined serial-number addition range');
  }
  return wrapPacketSequence(value + step, bits);
}

export function packetSequenceForwardDelta(fromSequence, toSequence, sequenceBits = PACKET_SEQUENCE_BITS_DEFAULT) {
  const bits = normalizeSequenceBits(sequenceBits);
  const modulo = packetSequenceModulo(bits);
  const from = wrapPacketSequence(fromSequence, bits);
  const to = wrapPacketSequence(toSequence, bits);
  return to >= from ? to - from : (to + modulo) - from;
}

export function packetSequenceSignedDelta(fromSequence, toSequence, sequenceBits = PACKET_SEQUENCE_BITS_DEFAULT) {
  const bits = normalizeSequenceBits(sequenceBits);
  const modulo = packetSequenceModulo(bits);
  const half = modulo / 2;
  const forward = packetSequenceForwardDelta(fromSequence, toSequence, bits);
  if (forward === 0) return 0;
  if (forward === half) return null;
  return forward < half ? forward : forward - modulo;
}

export function comparePacketSequence(leftSequence, rightSequence, sequenceBits = PACKET_SEQUENCE_BITS_DEFAULT) {
  const delta = packetSequenceSignedDelta(leftSequence, rightSequence, sequenceBits);
  if (delta === null) return null;
  if (delta === 0) return 0;
  return delta > 0 ? -1 : 1;
}

export function isPacketSequenceNewer(candidateSequence, baselineSequence, sequenceBits = PACKET_SEQUENCE_BITS_DEFAULT) {
  return comparePacketSequence(candidateSequence, baselineSequence, sequenceBits) === 1;
}

export function packetSequenceWindowReport(sequence, windowStart, windowSize, sequenceBits = PACKET_SEQUENCE_BITS_DEFAULT) {
  const bits = normalizeSequenceBits(sequenceBits);
  const size = nonnegativeInteger(windowSize, 'windowSize');
  const modulo = packetSequenceModulo(bits);
  const half = modulo / 2;
  if (size > half) {
    throw new RangeError('windowSize must be less than or equal to half the sequence space');
  }
  const offset = packetSequenceForwardDelta(windowStart, sequence, bits);
  return {
    sequence: wrapPacketSequence(sequence, bits),
    windowStart: wrapPacketSequence(windowStart, bits),
    windowSize: size,
    sequenceBits: bits,
    offset,
    inWindow: offset < size,
  };
}

export function packetAckRangeReport(packetNumbers = [], options = {}) {
  const sorted = uniqueSortedPacketNumbers(packetNumbers);
  const minimumPacketNumber = options.minimumPacketNumber === undefined
    ? 0
    : nonnegativeInteger(options.minimumPacketNumber, 'minimumPacketNumber');
  const filtered = sorted.filter((packetNumber) => packetNumber >= minimumPacketNumber);
  const ranges = [];
  for (const packetNumber of filtered) {
    const last = ranges[ranges.length - 1];
    if (last && packetNumber === last.largest + 1) {
      last.largest = packetNumber;
      last.count += 1;
      last.ackRangeLength = last.largest - last.smallest;
    } else {
      ranges.push({ smallest: packetNumber, largest: packetNumber, count: 1, ackRangeLength: 0 });
    }
  }

  const descending = ranges.reverse();
  const maxRanges = options.maxRanges === undefined || options.maxRanges === Infinity
    ? descending.length
    : positiveInteger(options.maxRanges, 'maxRanges');
  const limited = descending.slice(0, maxRanges);
  const encodedAckRanges = [];
  for (let i = 1; i < limited.length; i += 1) {
    const previous = limited[i - 1];
    const current = limited[i];
    encodedAckRanges.push(Object.freeze({
      gap: previous.smallest - current.largest - 2,
      ackRangeLength: current.ackRangeLength,
      smallest: current.smallest,
      largest: current.largest,
    }));
  }

  const firstRange = limited[0] ?? null;
  return {
    packetCount: filtered.length,
    rangeCount: limited.length,
    droppedRangeCount: Math.max(0, descending.length - limited.length),
    largestAcknowledged: firstRange ? firstRange.largest : null,
    firstAckRange: firstRange ? firstRange.ackRangeLength : 0,
    ackRangeCount: Math.max(0, limited.length - 1),
    minimumPacketNumber,
    ranges: Object.freeze(limited.map(freezeRange)),
    encodedAckRanges: Object.freeze(encodedAckRanges),
  };
}

export function packetMissingRangeReport(options = {}) {
  const expectedStart = nonnegativeInteger(options.expectedStart ?? options.minimumPacketNumber ?? 0, 'expectedStart');
  const expectedEnd = nonnegativeInteger(options.expectedEnd ?? options.maximumPacketNumber, 'expectedEnd');
  if (expectedEnd < expectedStart) {
    throw new RangeError('expectedEnd must be greater than or equal to expectedStart');
  }

  const sourceRanges = options.ackRanges
    ? Array.from(options.ackRanges)
    : packetAckRangeReport(options.receivedPackets ?? [], {
      minimumPacketNumber: expectedStart,
      maxRanges: options.maxRanges,
    }).ranges;

  const receivedRanges = sourceRanges
    .map((range, index) => {
      const smallest = nonnegativeInteger(range.smallest, `ackRanges[${index}].smallest`);
      const largest = nonnegativeInteger(range.largest, `ackRanges[${index}].largest`);
      if (largest < smallest) throw new RangeError(`ackRanges[${index}] largest must be >= smallest`);
      return {
        smallest: Math.max(expectedStart, smallest),
        largest: Math.min(expectedEnd, largest),
      };
    })
    .filter((range) => range.smallest <= range.largest)
    .sort((a, b) => a.smallest - b.smallest);

  const merged = [];
  for (const range of receivedRanges) {
    const last = merged[merged.length - 1];
    if (last && range.smallest <= last.largest + 1) {
      last.largest = Math.max(last.largest, range.largest);
    } else {
      merged.push({ ...range });
    }
  }

  const missingRanges = [];
  let cursor = expectedStart;
  for (const range of merged) {
    if (range.smallest > cursor) {
      missingRanges.push({ smallest: cursor, largest: range.smallest - 1, count: range.smallest - cursor });
    }
    cursor = Math.max(cursor, range.largest + 1);
  }
  if (cursor <= expectedEnd) {
    missingRanges.push({ smallest: cursor, largest: expectedEnd, count: expectedEnd - cursor + 1 });
  }

  const expectedCount = expectedEnd - expectedStart + 1;
  const missingCount = missingRanges.reduce((sum, range) => sum + range.count, 0);
  return {
    expectedStart,
    expectedEnd,
    expectedCount,
    receivedCount: expectedCount - missingCount,
    missingCount,
    complete: missingCount === 0,
    receivedRanges: Object.freeze(merged.map(freezeRange)),
    missingRanges: Object.freeze(missingRanges.map(freezeRange)),
  };
}

export function packetPayloadBudgetReport(options = {}) {
  const datagramBytes = positiveInteger(options.datagramBytes ?? options.mtuBytes ?? PACKET_DEFAULT_DATAGRAM_BYTES, 'datagramBytes');
  const headerBytes = nonnegativeInteger(options.headerBytes ?? 0, 'headerBytes');
  const trailerBytes = nonnegativeInteger(options.trailerBytes ?? options.authTagBytes ?? 0, 'trailerBytes');
  const reservedBytes = nonnegativeInteger(options.reservedBytes ?? 0, 'reservedBytes');
  const overheadBytes = headerBytes + trailerBytes + reservedBytes;
  const maxPayloadBytes = datagramBytes - overheadBytes;
  if (maxPayloadBytes <= 0) {
    throw new RangeError('packet overhead must leave at least one payload byte');
  }
  return {
    datagramBytes,
    headerBytes,
    trailerBytes,
    reservedBytes,
    overheadBytes,
    maxPayloadBytes,
    efficiencyRatio: maxPayloadBytes / datagramBytes,
  };
}

export function packetFragmentPlan(payloadBytes, options = {}) {
  const payload = nonnegativeInteger(payloadBytes, 'payloadBytes');
  const budget = packetPayloadBudgetReport(options);
  const fragmentCount = payload === 0 ? 0 : Math.ceil(payload / budget.maxPayloadBytes);
  const fragments = [];
  for (let index = 0; index < fragmentCount; index += 1) {
    const offset = index * budget.maxPayloadBytes;
    const length = Math.min(budget.maxPayloadBytes, payload - offset);
    fragments.push(Object.freeze({
      index,
      offset,
      length,
      endOffset: offset + length,
      moreFragments: index < fragmentCount - 1,
    }));
  }
  return {
    payloadBytes: payload,
    fragmentCount,
    datagramBytes: budget.datagramBytes,
    maxPayloadBytes: budget.maxPayloadBytes,
    overheadBytes: budget.overheadBytes,
    wireBytes: fragmentCount * budget.datagramBytes,
    payloadEfficiencyRatio: fragmentCount === 0 ? 1 : payload / (fragmentCount * budget.datagramBytes),
    fragments: Object.freeze(fragments),
  };
}

export function packetReassemblyReport(fragments = [], options = {}) {
  if (!fragments || typeof fragments[Symbol.iterator] !== 'function') {
    throw new TypeError('fragments must be iterable');
  }
  const totalBytes = nonnegativeInteger(options.totalBytes, 'totalBytes');
  const ranges = [];
  let suppliedBytes = 0;
  let fragmentCount = 0;
  for (const fragment of fragments) {
    const offset = nonnegativeInteger(fragment.offset, 'fragment.offset');
    const length = nonnegativeInteger(fragment.length, 'fragment.length');
    const endOffset = Math.min(totalBytes, offset + length);
    suppliedBytes += length;
    fragmentCount += 1;
    if (length > 0 && offset < totalBytes) {
      ranges.push({ smallest: offset, largest: endOffset - 1 });
    }
  }
  ranges.sort((a, b) => a.smallest - b.smallest);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.smallest <= last.largest + 1) {
      last.largest = Math.max(last.largest, range.largest);
    } else {
      merged.push({ ...range });
    }
  }
  const missing = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.smallest > cursor) {
      missing.push({ smallest: cursor, largest: range.smallest - 1, count: range.smallest - cursor });
    }
    cursor = Math.max(cursor, range.largest + 1);
  }
  if (cursor < totalBytes) {
    missing.push({ smallest: cursor, largest: totalBytes - 1, count: totalBytes - cursor });
  }
  const receivedBytes = merged.reduce((sum, range) => sum + range.largest - range.smallest + 1, 0);
  return {
    totalBytes,
    fragmentCount,
    suppliedBytes,
    receivedBytes,
    duplicateOrOverlapBytes: Math.max(0, suppliedBytes - receivedBytes),
    missingBytes: totalBytes - receivedBytes,
    complete: receivedBytes === totalBytes,
    receivedRanges: Object.freeze(merged.map(freezeRange)),
    missingRanges: Object.freeze(missing.map(freezeRange)),
  };
}

export function packetFlightReport(packets = []) {
  if (!packets || typeof packets[Symbol.iterator] !== 'function') {
    throw new TypeError('packets must be iterable');
  }
  let packetCount = 0;
  let inFlightCount = 0;
  let ackElicitingCount = 0;
  let paddingOnlyCount = 0;
  let acknowledgedCount = 0;
  let lostCount = 0;
  let discardedCount = 0;
  let bytesInFlight = 0;
  let totalBytes = 0;

  for (const packet of packets) {
    const bytes = nonnegativeInteger(packet.bytes ?? packet.sizeBytes ?? packet.datagramBytes ?? 0, 'packet.bytes');
    const acknowledged = packet.acknowledged === true || packet.acked === true;
    const lost = packet.lost === true;
    const discarded = packet.discarded === true;
    const ackEliciting = packet.ackEliciting !== false && packet.paddingOnly !== true;
    const padding = packet.padding === true || packet.paddingOnly === true;
    const inFlight = packet.inFlight === undefined
      ? ((ackEliciting || padding) && !acknowledged && !lost && !discarded)
      : packet.inFlight === true;

    packetCount += 1;
    totalBytes += bytes;
    if (ackEliciting) ackElicitingCount += 1;
    if (padding && !ackEliciting) paddingOnlyCount += 1;
    if (acknowledged) acknowledgedCount += 1;
    if (lost) lostCount += 1;
    if (discarded) discardedCount += 1;
    if (inFlight) {
      inFlightCount += 1;
      bytesInFlight += bytes;
    }
  }

  return {
    packetCount,
    totalBytes,
    inFlightCount,
    bytesInFlight,
    ackElicitingCount,
    paddingOnlyCount,
    acknowledgedCount,
    lostCount,
    discardedCount,
  };
}

export function packetSendWindowReport(options = {}) {
  const congestionWindowBytes = positiveInteger(options.congestionWindowBytes ?? options.windowBytes, 'congestionWindowBytes');
  const receiveWindowBytes = options.receiveWindowBytes === undefined
    ? congestionWindowBytes
    : positiveInteger(options.receiveWindowBytes, 'receiveWindowBytes');
  const bytesInFlight = nonnegativeInteger(options.bytesInFlight ?? 0, 'bytesInFlight');
  const maxDatagramBytes = positiveInteger(options.maxDatagramBytes ?? options.datagramBytes ?? PACKET_DEFAULT_DATAGRAM_BYTES, 'maxDatagramBytes');
  const queuedBytes = options.queuedBytes === undefined ? null : nonnegativeInteger(options.queuedBytes, 'queuedBytes');
  const effectiveWindowBytes = Math.min(congestionWindowBytes, receiveWindowBytes);
  const availableBytes = Math.max(0, effectiveWindowBytes - bytesInFlight);
  const sendableBytes = queuedBytes === null ? availableBytes : Math.min(availableBytes, queuedBytes);
  return {
    congestionWindowBytes,
    receiveWindowBytes,
    effectiveWindowBytes,
    bytesInFlight,
    availableBytes,
    maxDatagramBytes,
    availablePackets: Math.floor(availableBytes / maxDatagramBytes),
    queuedBytes,
    sendableBytes,
    sendablePackets: Math.floor(sendableBytes / maxDatagramBytes),
    canSend: sendableBytes > 0,
    blockedByWindow: availableBytes === 0,
    blockedByQueue: queuedBytes !== null && queuedBytes === 0,
  };
}

export function packetLossCandidateReport(sentPackets = [], options = {}) {
  if (!sentPackets || typeof sentPackets[Symbol.iterator] !== 'function') {
    throw new TypeError('sentPackets must be iterable');
  }
  const largestAcknowledgedPacket = nonnegativeInteger(
    options.largestAcknowledgedPacket ?? options.largestAckedPacket,
    'largestAcknowledgedPacket',
  );
  const latestRttMs = nonnegativeNumber(options.latestRttMs ?? 0, 'latestRttMs');
  const smoothedRttMs = nonnegativeNumber(options.smoothedRttMs ?? 0, 'smoothedRttMs');
  const nowMs = finiteNumber(options.nowMs, 'nowMs');
  const packetThreshold = positiveInteger(options.packetThreshold ?? PACKET_LOSS_PACKET_THRESHOLD, 'packetThreshold');
  const timeThreshold = positiveNumber(options.timeThreshold ?? PACKET_LOSS_TIME_THRESHOLD, 'timeThreshold');
  const granularityMs = positiveNumber(options.granularityMs ?? PACKET_LOSS_GRANULARITY_MS, 'granularityMs');
  const lossDelayMs = Math.max(timeThreshold * Math.max(latestRttMs, smoothedRttMs), granularityMs);
  const lostSendTimeMs = nowMs - lossDelayMs;
  const lostPackets = [];
  let lossTimeMs = null;

  for (const packet of sentPackets) {
    const packetNumber = nonnegativeInteger(packet.packetNumber ?? packet.number, 'packet.packetNumber');
    const timeSentMs = finiteNumber(packet.timeSentMs ?? packet.sentAtMs, 'packet.timeSentMs');
    if (packet.acknowledged === true || packet.acked === true || packet.lost === true || packet.discarded === true) {
      continue;
    }
    if (packetNumber > largestAcknowledgedPacket) {
      continue;
    }
    const lostByPacketThreshold = largestAcknowledgedPacket >= packetNumber + packetThreshold;
    const lostByTimeThreshold = timeSentMs <= lostSendTimeMs;
    if (lostByPacketThreshold || lostByTimeThreshold) {
      lostPackets.push(Object.freeze({
        packetNumber,
        timeSentMs,
        lostByPacketThreshold,
        lostByTimeThreshold,
      }));
    } else {
      const candidateLossTimeMs = timeSentMs + lossDelayMs;
      lossTimeMs = lossTimeMs === null ? candidateLossTimeMs : Math.min(lossTimeMs, candidateLossTimeMs);
    }
  }

  return {
    largestAcknowledgedPacket,
    latestRttMs,
    smoothedRttMs,
    nowMs,
    packetThreshold,
    timeThreshold,
    granularityMs,
    lossDelayMs,
    lostSendTimeMs,
    lossTimeMs,
    lostCount: lostPackets.length,
    lostPackets: Object.freeze(lostPackets),
  };
}

export function quicPacketNumberEncodingBytes(packetNumber, largestAcknowledgedPacket = null) {
  const number = nonnegativeInteger(packetNumber, 'packetNumber');
  if (largestAcknowledgedPacket === null || largestAcknowledgedPacket === undefined) {
    if (number <= 0xff) return 1;
    if (number <= 0xffff) return 2;
    if (number <= 0xffffff) return 3;
    if (number <= 0xffffffff) return 4;
    throw new RangeError('packetNumber requires more than 4 encoded bytes');
  }
  const largestAcked = nonnegativeInteger(largestAcknowledgedPacket, 'largestAcknowledgedPacket');
  if (number <= largestAcked) {
    throw new RangeError('packetNumber must be greater than largestAcknowledgedPacket');
  }
  const outstandingRange = number - largestAcked;
  for (let bytes = 1; bytes <= 4; bytes += 1) {
    const window = 2 ** (bytes * 8);
    if (window > 2 * outstandingRange) return bytes;
  }
  return 4;
}

export function quicDecodeTruncatedPacketNumber(largestReceivedPacket, truncatedPacketNumber, packetNumberBits) {
  const largestReceived = nonnegativeInteger(largestReceivedPacket, 'largestReceivedPacket');
  const bits = positiveInteger(packetNumberBits, 'packetNumberBits');
  if (bits > 32) {
    throw new RangeError('packetNumberBits must be less than or equal to 32');
  }
  const window = 2 ** bits;
  const halfWindow = window / 2;
  const truncated = nonnegativeInteger(truncatedPacketNumber, 'truncatedPacketNumber');
  if (truncated >= window) {
    throw new RangeError('truncatedPacketNumber must fit within packetNumberBits');
  }
  const expectedPacket = largestReceived + 1;
  const candidateBase = Math.floor(expectedPacket / window) * window;
  let candidate = candidateBase + truncated;
  if (candidate <= expectedPacket - halfWindow && candidate + window <= Number.MAX_SAFE_INTEGER) {
    candidate += window;
  } else if (candidate > expectedPacket + halfWindow && candidate >= window) {
    candidate -= window;
  }
  return candidate;
}
