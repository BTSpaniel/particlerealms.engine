// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  NEXEL_ACTIVE_CORNER_LUT,
  NEXEL_AFFINE_DECODE_PLAN,
  NEXEL_AFFINE_OCCUPANCY_LUT,
} from '../systems/NexelMicrostructure.js';

function wgslU32(value) {
  return `0x${(value >>> 0).toString(16).padStart(8, '0')}u`;
}

export const NEXEL_AFFINE_SHADER_PLAN_SIGNATURE = NEXEL_AFFINE_DECODE_PLAN.signature;

const OCCUPANCY_LUT_WGSL = NEXEL_AFFINE_OCCUPANCY_LUT.map(wgslU32).join(', ');
const ACTIVE_CORNER_LUT_WGSL = NEXEL_ACTIVE_CORNER_LUT.map(wgslU32).join(',\n  ');

/** Root-Algebra-style immutable execution plan shared by every Nexel shader. */
export const NEXEL_AFFINE_DECODER_WGSL = /* wgsl */`
const AFFINE_PARITY_PLAN: u32 = ${wgslU32(NEXEL_AFFINE_DECODE_PLAN.packedMasks)};
const AFFINE_OCCUPANCY_LUT = array<u32, 4>(
  ${OCCUPANCY_LUT_WGSL},
);
const ACTIVE_CORNER_LUT = array<u32, 16>(
  ${ACTIVE_CORNER_LUT_WGSL},
);

fn affineSample(code: u32, corner: u32) -> u32 {
  let equationMask = (AFFINE_PARITY_PLAN >> (corner * 4u)) & 0x0fu;
  return countOneBits(code & equationMask) & 1u;
}

fn affineOccupancy(code: u32) -> u32 {
  let packedPatterns = AFFINE_OCCUPANCY_LUT[code >> 2u];
  return (packedPatterns >> ((code & 3u) * 8u)) & 0xffu;
}

fn affineOccupiedCount(code: u32) -> u32 {
  var occupied = select(4u, 0u, code == 0u);
  occupied = select(occupied, 8u, code == 1u);
  return occupied;
}

fn affineActiveCorner(code: u32, activeRank: u32, scramble: u32) -> u32 {
  let translatedCode = code ^ (countOneBits((code >> 1u) & scramble) & 1u);
  let packedCorners = ACTIVE_CORNER_LUT[translatedCode];
  let encodedCorner = (packedCorners >> (activeRank * 4u)) & 0x0fu;
  return select(8u, encodedCorner ^ scramble, encodedCorner < 8u);
}

fn parity4(pattern: u32, a: u32, b: u32, c: u32, d: u32) -> u32 {
  return ((pattern >> a) ^ (pattern >> b) ^ (pattern >> c) ^ (pattern >> d)) & 1u;
}

fn faceSyndrome(pattern: u32) -> u32 {
  return parity4(pattern, 0u, 2u, 4u, 6u)
    | (parity4(pattern, 1u, 3u, 5u, 7u) << 1u)
    | (parity4(pattern, 0u, 1u, 4u, 5u) << 2u)
    | (parity4(pattern, 2u, 3u, 6u, 7u) << 3u)
    | (parity4(pattern, 0u, 1u, 2u, 3u) << 4u)
    | (parity4(pattern, 4u, 5u, 6u, 7u) << 5u);
}

fn diagnosticActiveCorner(pattern: u32, activeRank: u32, scramble: u32) -> u32 {
  const order = array<u32, 8>(0u, 7u, 3u, 4u, 1u, 6u, 2u, 5u);
  var occupiedRank = 0u;
  for (var sequence = 0u; sequence < 8u; sequence += 1u) {
    let corner = order[sequence] ^ scramble;
    if (((pattern >> corner) & 1u) != 0u) {
      if (occupiedRank == activeRank) { return corner; }
      occupiedRank += 1u;
    }
  }
  return 8u;
}
`;

export default NEXEL_AFFINE_DECODER_WGSL;
