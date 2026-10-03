// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Portable binary microstructure tools for Nexel render clusters and voxel
 * bricks. These helpers describe local storage and verification only; they do
 * not replace a chunk CRC/authentication tag or an outer error-correcting code.
 */

import { morton3DDecode, morton3DEncode, popCount } from '../../../core/math/MathBits.js';
import {
  crc32,
  fnv1a32,
  fnv1aTaggedUint32Sequence32,
} from '../../../core/math/ChecksumMath.js';

export const NEXEL_MICROCUBE_MODE = Object.freeze({
  UNIFORM1: 0,
  AFFINE4: 1,
  DICT4: 2,
  RAW8: 3,
});

export const NEXEL_DESCRIPTOR_LAYOUT = Object.freeze({
  mortonCoordinate: Object.freeze({ shift: 0, bits: 15, maximum: 0x7fff }),
  material: Object.freeze({ shift: 15, bits: 6, maximum: 0x3f }),
  morphology: Object.freeze({ shift: 21, bits: 4, maximum: 0x0f }),
  state: Object.freeze({ shift: 25, bits: 3, maximum: 0x07 }),
  lod: Object.freeze({ shift: 28, bits: 2, maximum: 0x03 }),
  flags: Object.freeze({ shift: 30, bits: 2, maximum: 0x03 }),
});

export const NEXEL_CLUSTER_CORNER_ORDER = Object.freeze([0, 7, 3, 4, 1, 6, 2, 5]);

function affineCubeReferenceSample(morphology, corner) {
  const x = corner & 1;
  const y = (corner >>> 1) & 1;
  const z = (corner >>> 2) & 1;
  return ((morphology & 1) ^ (((morphology >>> 1) & 1) & x)
    ^ (((morphology >>> 2) & 1) & y) ^ (((morphology >>> 3) & 1) & z)) & 1;
}

/**
 * Compile the eight affine Boolean equations into one u32 of nibble masks,
 * then exhaustively prove the branch-free parity plan against the reducer.
 * This follows Root Algebra Lab's validated-plan discipline without adopting
 * its deliberately research-only carry/sign multiplier.
 */
export function compileNexelAffineDecodePlan() {
  const equationMasks = Array.from({ length: 8 }, (_, corner) => 1 | (corner << 1));
  let packedMasks = 0;
  equationMasks.forEach((mask, corner) => { packedMasks = (packedMasks | (mask << (corner * 4))) >>> 0; });
  const occupancyWords = [0, 0, 0, 0];
  const activeCornerWords = [];
  for (let morphology = 0; morphology < 16; morphology += 1) {
    let occupancy = 0;
    for (let corner = 0; corner < 8; corner += 1) {
      const mask = equationMasks[corner];
      const planned = popCount(morphology & mask) & 1;
      if (planned !== affineCubeReferenceSample(morphology, corner)) {
        throw new Error(`Nexel affine decode plan failed at morphology ${morphology}, corner ${corner}`);
      }
      occupancy |= planned << corner;
    }
    occupancyWords[morphology >>> 2] = (occupancyWords[morphology >>> 2]
      | (occupancy << ((morphology & 3) * 8))) >>> 0;
    const activeCorners = NEXEL_CLUSTER_CORNER_ORDER.filter(corner => ((occupancy >>> corner) & 1) !== 0);
    let packedCorners = 0;
    for (let rank = 0; rank < 8; rank += 1) {
      packedCorners = (packedCorners | ((activeCorners[rank] ?? 0x0f) << (rank * 4))) >>> 0;
    }
    activeCornerWords.push(packedCorners);
  }
  for (let morphology = 0; morphology < 16; morphology += 1) {
    for (let scramble = 0; scramble < 8; scramble += 1) {
      const translated = morphology ^ (popCount((morphology >>> 1) & scramble) & 1);
      const packedCorners = activeCornerWords[translated];
      const expected = NEXEL_CLUSTER_CORNER_ORDER
        .map(corner => corner ^ scramble)
        .filter(corner => affineCubeReferenceSample(morphology, corner) !== 0);
      for (let rank = 0; rank < 8; rank += 1) {
        const encoded = (packedCorners >>> (rank * 4)) & 0x0f;
        const decoded = encoded < 8 ? encoded ^ scramble : 0x0f;
        if (decoded !== (expected[rank] ?? 0x0f)) {
          throw new Error(`Nexel active-corner plan failed at morphology ${morphology}, scramble ${scramble}, rank ${rank}`);
        }
      }
    }
  }
  const signature = fnv1aTaggedUint32Sequence32(
    [packedMasks, ...occupancyWords, ...activeCornerWords],
    { tag: 'particle-realms.nexel.affine-decode-plan.v2' },
  );
  return Object.freeze({
    schema: 'particle-realms.nexel.affine-decode-plan',
    version: 2,
    equationMasks: Object.freeze(equationMasks),
    packedMasks: packedMasks >>> 0,
    occupancyWords: Object.freeze(occupancyWords),
    activeCornerWords: Object.freeze(activeCornerWords),
    proofCases: 16 * 8 + 16 * 8 * 8,
    signature,
    operations: Object.freeze(['packed-lookup', 'mask', 'population-count', 'parity']),
  });
}

export const NEXEL_AFFINE_DECODE_PLAN = compileNexelAffineDecodePlan();
export const NEXEL_AFFINE_OCCUPANCY_LUT = NEXEL_AFFINE_DECODE_PLAN.occupancyWords;
export const NEXEL_ACTIVE_CORNER_LUT = NEXEL_AFFINE_DECODE_PLAN.activeCornerWords;

const MICRO_CUBES_PER_BRICK = 64;
const AFFINE_CODES_PER_WORD = 8;
const AFFINE_BRICK_WORDS = MICRO_CUBES_PER_BRICK / AFFINE_CODES_PER_WORD;
const FACE_COUNT = 6;
const COMPILED_DICTIONARY_PLANS = new WeakSet();

function integerInRange(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function occupancyByte(value, label = 'Nexel microcube occupancy') {
  return integerInRange(value, 0, 0xff, label);
}

function normalizeDictionary(dictionary) {
  if (COMPILED_DICTIONARY_PLANS.has(dictionary)) return dictionary.entries;
  if (dictionary === undefined || dictionary === null) return Object.freeze([]);
  if (!Array.isArray(dictionary) && !ArrayBuffer.isView(dictionary)) {
    throw new TypeError('Nexel microcube dictionary must be an array-like collection');
  }
  if (dictionary.length > 16) throw new RangeError('Nexel DICT4 supports at most sixteen entries');
  const normalized = Array.from(dictionary, (value, index) => occupancyByte(value, `Nexel dictionary entry ${index}`));
  if (new Set(normalized).size !== normalized.length) {
    throw new RangeError('Nexel microcube dictionary entries must be unique');
  }
  return Object.freeze(normalized);
}

/** Compile an immutable exact dictionary and reverse lookup once per codebook. */
export function compileNexelDictionary(dictionary = []) {
  const entries = normalizeDictionary(dictionary);
  const reverse = new Int16Array(256);
  reverse.fill(-1);
  entries.forEach((occupancy, index) => { reverse[occupancy] = index; });
  const signature = fnv1aTaggedUint32Sequence32(entries, {
    tag: 'particle-realms.nexel.dictionary-plan.v1',
  });
  const plan = Object.freeze({
    schema: 'particle-realms.nexel.dictionary-plan',
    version: 1,
    entries,
    signature,
    exact: true,
    indexOf(pattern) {
      return reverse[occupancyByte(pattern)];
    },
  });
  COMPILED_DICTIONARY_PLANS.add(plan);
  return plan;
}

/** Evaluate one corner of an RM(1,3) affine microcube. */
export function affineCubeSample(morphology, corner) {
  const code = integerInRange(morphology, 0, 0x0f, 'Nexel affine morphology');
  const cell = integerInRange(corner, 0, 7, 'Nexel microcube corner');
  const equationMask = (NEXEL_AFFINE_DECODE_PLAN.packedMasks >>> (cell * 4)) & 0x0f;
  return countSetBits8(code & equationMask) & 1;
}

/** Expand an affine morphology into its exact eight-bit occupancy mask. */
export function expandAffineCube(morphology) {
  const code = integerInRange(morphology, 0, 0x0f, 'Nexel affine morphology');
  return (NEXEL_AFFINE_OCCUPANCY_LUT[code >>> 2] >>> ((code & 3) * 8)) & 0xff;
}

/** Return the affine morphology for a pattern, or null for a non-codeword. */
export function decodeAffineCube(pattern) {
  const occupancy = occupancyByte(pattern);
  const p0 = occupancy & 1;
  const morphology = p0
    | ((p0 ^ ((occupancy >>> 1) & 1)) << 1)
    | ((p0 ^ ((occupancy >>> 2) & 1)) << 2)
    | ((p0 ^ ((occupancy >>> 4) & 1)) << 3);
  return expandAffineCube(morphology) === occupancy ? morphology : null;
}

function parity4(pattern, a, b, c, d) {
  return (((pattern >>> a) ^ (pattern >>> b) ^ (pattern >>> c) ^ (pattern >>> d)) & 1) >>> 0;
}

/**
 * Six-bit local face-parity syndrome ordered x0,x1,y0,y1,z0,z1. A valid
 * RM(1,3) word has zero syndrome; another valid word can still evade it.
 */
export function affineFaceParitySyndrome(pattern) {
  const occupancy = occupancyByte(pattern);
  const parities = [
    parity4(occupancy, 0, 2, 4, 6),
    parity4(occupancy, 1, 3, 5, 7),
    parity4(occupancy, 0, 1, 4, 5),
    parity4(occupancy, 2, 3, 6, 7),
    parity4(occupancy, 0, 1, 2, 3),
    parity4(occupancy, 4, 5, 6, 7),
  ];
  return parities.reduce((syndrome, parity, face) => syndrome | (parity << face), 0) >>> 0;
}

export function inspectAffineCube(pattern) {
  const occupancy = occupancyByte(pattern);
  const morphology = decodeAffineCube(occupancy);
  const syndrome = affineFaceParitySyndrome(occupancy);
  return Object.freeze({
    occupancy,
    morphology,
    valid: morphology !== null && syndrome === 0,
    syndrome,
    occupiedCells: countSetBits8(occupancy),
  });
}

export function countSetBits8(value) {
  return popCount(occupancyByte(value));
}

export function hammingDistance8(left, right) {
  return countSetBits8(occupancyByte(left, 'Left occupancy') ^ occupancyByte(right, 'Right occupancy'));
}

/** Interleave three five-bit coordinates into the descriptor's 15-bit Morton field. */
export function packNexelMorton3D5(x, y, z) {
  const coordinates = [x, y, z].map((value, axis) => (
    integerInRange(value, 0, 31, `Nexel Morton axis ${axis}`)
  ));
  return morton3DEncode(coordinates[0], coordinates[1], coordinates[2]) & 0x7fff;
}

export function unpackNexelMorton3D5(mortonCoordinate) {
  const morton = integerInRange(mortonCoordinate, 0, 0x7fff, 'Nexel Morton coordinate');
  return Object.freeze(morton3DDecode(morton).map(value => value & 31));
}

/** Choose the smallest lossless local mode under the supplied dictionary. */
export function encodeNexelMicrocube(pattern, { dictionary } = {}) {
  const occupancy = occupancyByte(pattern);
  if (occupancy === 0 || occupancy === 0xff) {
    return Object.freeze({ mode: NEXEL_MICROCUBE_MODE.UNIFORM1, payload: occupancy === 0xff ? 1 : 0, occupancy });
  }
  const morphology = decodeAffineCube(occupancy);
  if (morphology !== null) {
    return Object.freeze({ mode: NEXEL_MICROCUBE_MODE.AFFINE4, payload: morphology, occupancy });
  }
  const dictionaryPlan = COMPILED_DICTIONARY_PLANS.has(dictionary)
    ? dictionary
    : compileNexelDictionary(dictionary);
  const dictionaryIndex = dictionaryPlan.indexOf(occupancy);
  if (dictionaryIndex >= 0) {
    return Object.freeze({ mode: NEXEL_MICROCUBE_MODE.DICT4, payload: dictionaryIndex, occupancy });
  }
  return Object.freeze({ mode: NEXEL_MICROCUBE_MODE.RAW8, payload: occupancy, occupancy });
}

export function decodeNexelMicrocube(encoded, { dictionary } = {}) {
  if (!encoded || typeof encoded !== 'object') throw new TypeError('Encoded Nexel microcube is required');
  const mode = integerInRange(encoded.mode, 0, 3, 'Nexel microcube mode');
  const payload = Number(encoded.payload);
  if (mode === NEXEL_MICROCUBE_MODE.UNIFORM1) {
    return integerInRange(payload, 0, 1, 'UNIFORM1 payload') ? 0xff : 0;
  }
  if (mode === NEXEL_MICROCUBE_MODE.AFFINE4) {
    return expandAffineCube(integerInRange(payload, 0, 0x0f, 'AFFINE4 payload'));
  }
  if (mode === NEXEL_MICROCUBE_MODE.DICT4) {
    const codebook = normalizeDictionary(dictionary);
    const index = integerInRange(payload, 0, 0x0f, 'DICT4 payload');
    if (index >= codebook.length) throw new RangeError(`DICT4 payload ${index} is outside dictionary length ${codebook.length}`);
    return codebook[index];
  }
  return occupancyByte(payload, 'RAW8 payload');
}

/** Pack the research descriptor: 15/6/4/3/2/2 exact integer fields. */
export function packNexelDescriptor({
  mortonCoordinate = 0,
  material = 0,
  morphology = 0,
  state = 0,
  lod = 0,
  flags = 0,
} = {}) {
  const fields = { mortonCoordinate, material, morphology, state, lod, flags };
  let word = 0;
  for (const [name, layout] of Object.entries(NEXEL_DESCRIPTOR_LAYOUT)) {
    const value = integerInRange(fields[name], 0, layout.maximum, `Nexel descriptor ${name}`);
    word = (word | (value << layout.shift)) >>> 0;
  }
  return word >>> 0;
}

export function unpackNexelDescriptor(word) {
  const packed = integerInRange(word, 0, 0xffffffff, 'Packed Nexel descriptor') >>> 0;
  const result = {};
  for (const [name, layout] of Object.entries(NEXEL_DESCRIPTOR_LAYOUT)) {
    result[name] = (packed >>> layout.shift) & layout.maximum;
  }
  return Object.freeze(result);
}

/** Pack sixty-four affine microcubes into eight u32 words (32 bytes). */
export function packAffine4Brick(patterns) {
  if ((!Array.isArray(patterns) && !ArrayBuffer.isView(patterns)) || patterns.length !== MICRO_CUBES_PER_BRICK) {
    throw new RangeError('AFFINE4 brick requires exactly sixty-four microcube patterns');
  }
  const words = new Uint32Array(AFFINE_BRICK_WORDS);
  for (let index = 0; index < patterns.length; index += 1) {
    const morphology = decodeAffineCube(occupancyByte(patterns[index], `AFFINE4 brick pattern ${index}`));
    if (morphology === null) throw new RangeError(`AFFINE4 brick pattern ${index} is not an RM(1,3) codeword`);
    words[index >>> 3] |= morphology << ((index & 7) * 4);
  }
  return words;
}

/** Pack already-proven morphology nibbles without expanding and re-decoding. */
export function packAffine4Morphologies(morphologies) {
  if ((!Array.isArray(morphologies) && !ArrayBuffer.isView(morphologies))
      || morphologies.length !== MICRO_CUBES_PER_BRICK) {
    throw new RangeError('AFFINE4 morphology brick requires exactly sixty-four codes');
  }
  const words = new Uint32Array(AFFINE_BRICK_WORDS);
  for (let index = 0; index < morphologies.length; index += 1) {
    const morphology = integerInRange(morphologies[index], 0, 0x0f, `AFFINE4 morphology ${index}`);
    words[index >>> 3] |= morphology << ((index & 7) * 4);
  }
  return words;
}

export function unpackAffine4Brick(words) {
  if (!(words instanceof Uint32Array) || words.length !== AFFINE_BRICK_WORDS) {
    throw new RangeError('Packed AFFINE4 brick requires exactly eight u32 words');
  }
  const patterns = new Uint8Array(MICRO_CUBES_PER_BRICK);
  for (let index = 0; index < patterns.length; index += 1) {
    patterns[index] = expandAffineCube((words[index >>> 3] >>> ((index & 7) * 4)) & 0x0f);
  }
  return patterns;
}

export function crc32Bytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('CRC32 input must be a Uint8Array');
  return crc32(bytes);
}

function microcubePatternAt(patterns, microX, microY, microZ) {
  return patterns[microX + microY * 4 + microZ * 16];
}

function voxelAt(patterns, x, y, z) {
  const pattern = microcubePatternAt(patterns, x >>> 1, y >>> 1, z >>> 1);
  const corner = (x & 1) | ((y & 1) << 1) | ((z & 1) << 2);
  return (pattern >>> corner) & 1;
}

function fnv1aFace(patterns, face) {
  const rows = new Uint8Array(8);
  for (let row = 0; row < 8; row += 1) {
    let byte = 0;
    for (let column = 0; column < 8; column += 1) {
      let x;
      let y;
      let z;
      if (face < 2) {
        x = face; y = column; z = row;
        if (face === 1) x = 7;
      } else if (face < 4) {
        x = column; y = face === 2 ? 0 : 7; z = row;
      } else {
        x = column; y = row; z = face === 4 ? 0 : 7;
      }
      byte |= voxelAt(patterns, x, y, z) << column;
    }
    rows[row] = byte;
  }
  return fnv1a32(rows);
}

export function computeAffineBrickFaceSignatures(patterns) {
  if ((!Array.isArray(patterns) && !ArrayBuffer.isView(patterns)) || patterns.length !== MICRO_CUBES_PER_BRICK) {
    throw new RangeError('Nexel face signatures require sixty-four microcube patterns');
  }
  const normalized = Uint8Array.from(patterns, (value, index) => occupancyByte(value, `Nexel brick pattern ${index}`));
  return Uint32Array.from({ length: FACE_COUNT }, (_, face) => fnv1aFace(normalized, face));
}

function canonicalBrickTransform(origin, scale) {
  if ((!Array.isArray(origin) && !ArrayBuffer.isView(origin))
      || origin.length !== 3 || !Array.from(origin).every(Number.isFinite)) {
    throw new TypeError('Nexel brick origin must contain three finite numbers');
  }
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('Nexel brick scale must be positive and finite');
  const transform = Float32Array.from([origin[0], origin[1], origin[2], scale]);
  if (!Array.from(transform).every(Number.isFinite) || !(transform[3] > 0)) {
    throw new RangeError('Nexel brick transform must remain finite in the GPU f32 representation');
  }
  return transform;
}

function affineBrickIntegrityWords(packed, transform, generation, signatures, generations) {
  const words = new Uint32Array(
    packed.length + 1 + transform.length + 1 + signatures.length + generations.length,
  );
  let cursor = 0;
  words.set(packed, cursor); cursor += packed.length;
  words[cursor] = NEXEL_MICROCUBE_MODE.AFFINE4; cursor += 1;
  words.set(new Uint32Array(transform.buffer, transform.byteOffset, transform.length), cursor);
  cursor += transform.length;
  words[cursor] = generation >>> 0; cursor += 1;
  words.set(signatures, cursor); cursor += signatures.length;
  words.set(generations, cursor);
  return words;
}

function createAffineNexelBrickFromPayload(packed, {
  origin = [0, 0, 0],
  scale = 1,
  generation = 0,
  neighborGenerations = [0, 0, 0, 0, 0, 0],
} = {}) {
  const transform = canonicalBrickTransform(origin, scale);
  integerInRange(generation, 0, 0xffffffff, 'Nexel brick generation');
  if ((!Array.isArray(neighborGenerations) && !ArrayBuffer.isView(neighborGenerations))
      || neighborGenerations.length !== FACE_COUNT) {
    throw new RangeError('Nexel brick requires six neighbor generations');
  }
  const bytes = new Uint8Array(packed.buffer, packed.byteOffset, packed.byteLength);
  const expanded = unpackAffine4Brick(packed);
  const signatures = computeAffineBrickFaceSignatures(expanded);
  const generations = Uint32Array.from(neighborGenerations, (value, face) => (
    integerInRange(value, 0, 0xffffffff, `Nexel neighbor generation ${face}`) >>> 0
  ));
  const integrityWords = affineBrickIntegrityWords(
    packed,
    transform,
    generation,
    signatures,
    generations,
  );
  const payloadCrc32 = crc32Bytes(bytes);
  const crc32 = crc32Bytes(new Uint8Array(
    integrityWords.buffer,
    integrityWords.byteOffset,
    integrityWords.byteLength,
  ));
  return Object.freeze({
    mode: NEXEL_MICROCUBE_MODE.AFFINE4,
    origin: Object.freeze(Array.from(transform.slice(0, 3))),
    scale: transform[3],
    generation: generation >>> 0,
    get payload() { return packed.slice(); },
    payloadBytes: packed.byteLength,
    expandedCells: 512,
    payloadCrc32,
    crc32,
    get faceSignatures() { return signatures.slice(); },
    get neighborGenerations() { return generations.slice(); },
    integrityScope: 'affine4-payload-placement-faces-generations-crc32-not-authenticated',
  });
}

export function createAffineNexelBrick(patterns, options = {}) {
  return createAffineNexelBrickFromPayload(packAffine4Brick(patterns), options);
}

/** Build a brick directly from its sixty-four affine morphology nibbles. */
export function createAffineNexelBrickFromMorphologies(morphologies, options = {}) {
  return createAffineNexelBrickFromPayload(packAffine4Morphologies(morphologies), options);
}

/** Recompute every local brick invariant without trusting stored TypedArrays. */
export function verifyAffineNexelBrick(brick) {
  if (!brick || typeof brick !== 'object') throw new TypeError('Affine Nexel brick is required');
  const mode = integerInRange(brick.mode, 0, 3, 'Nexel brick mode');
  if (mode !== NEXEL_MICROCUBE_MODE.AFFINE4) {
    throw new RangeError('Affine Nexel brick mode must be AFFINE4');
  }
  const transform = canonicalBrickTransform(brick.origin, brick.scale);
  const payload = brick.payload;
  if (!(payload instanceof Uint32Array) || payload.length !== AFFINE_BRICK_WORDS) {
    throw new RangeError('Affine Nexel brick payload must contain eight u32 words');
  }
  const generation = integerInRange(brick.generation, 0, 0xffffffff, 'Nexel brick generation') >>> 0;
  const expectedFaces = brick.faceSignatures;
  const generations = brick.neighborGenerations;
  if (!(expectedFaces instanceof Uint32Array) || expectedFaces.length !== FACE_COUNT
      || !(generations instanceof Uint32Array) || generations.length !== FACE_COUNT) {
    throw new RangeError('Affine Nexel brick integrity metadata must contain six face records');
  }
  const patterns = unpackAffine4Brick(payload);
  const actualFaces = computeAffineBrickFaceSignatures(patterns);
  const faceMismatches = [];
  for (let face = 0; face < FACE_COUNT; face += 1) {
    if (actualFaces[face] !== expectedFaces[face]) faceMismatches.push(face);
    integerInRange(generations[face], 0, 0xffffffff, `Nexel neighbor generation ${face}`);
  }
  const integrityWords = affineBrickIntegrityWords(
    payload,
    transform,
    generation,
    actualFaces,
    generations,
  );
  const payloadCrc32 = crc32Bytes(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength));
  const crc32 = crc32Bytes(new Uint8Array(
    integrityWords.buffer,
    integrityWords.byteOffset,
    integrityWords.byteLength,
  ));
  const expectedPayloadCrc32 = integerInRange(
    brick.payloadCrc32,
    0,
    0xffffffff,
    'Nexel brick payload CRC32',
  ) >>> 0;
  const expectedCrc32 = integerInRange(brick.crc32, 0, 0xffffffff, 'Nexel brick CRC32') >>> 0;
  return Object.freeze({
    valid: faceMismatches.length === 0
      && payloadCrc32 === expectedPayloadCrc32
      && crc32 === expectedCrc32,
    payloadCrc32,
    crc32,
    faceMismatches: Object.freeze(faceMismatches),
    authenticated: false,
  });
}

/** Return a deterministic, exact permutation of the eight microcube corners. */
export function nexelClusterCornerOrder(seed = 0) {
  const scramble = integerInRange(seed, 0, 0xffffffff, 'Nexel cluster seed') & 7;
  return Object.freeze(NEXEL_CLUSTER_CORNER_ORDER.map(corner => corner ^ scramble));
}

export default Object.freeze({
  NEXEL_CLUSTER_CORNER_ORDER,
  NEXEL_ACTIVE_CORNER_LUT,
  NEXEL_AFFINE_DECODE_PLAN,
  NEXEL_AFFINE_OCCUPANCY_LUT,
  NEXEL_DESCRIPTOR_LAYOUT,
  NEXEL_MICROCUBE_MODE,
  affineCubeSample,
  affineFaceParitySyndrome,
  computeAffineBrickFaceSignatures,
  compileNexelAffineDecodePlan,
  compileNexelDictionary,
  countSetBits8,
  createAffineNexelBrick,
  createAffineNexelBrickFromMorphologies,
  crc32Bytes,
  decodeAffineCube,
  decodeNexelMicrocube,
  encodeNexelMicrocube,
  expandAffineCube,
  hammingDistance8,
  inspectAffineCube,
  nexelClusterCornerOrder,
  packAffine4Brick,
  packAffine4Morphologies,
  packNexelDescriptor,
  packNexelMorton3D5,
  unpackAffine4Brick,
  unpackNexelDescriptor,
  unpackNexelMorton3D5,
  verifyAffineNexelBrick,
});
