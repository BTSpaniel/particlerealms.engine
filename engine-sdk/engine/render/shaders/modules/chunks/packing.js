// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Normalized integer packing helpers mirrored from engine/core/math/MathPacking.js.
 */

export const packingWGSL = /* wgsl */`
fn packUNORM8(value : f32) -> u32 {
  return u32(round(clamp(value, 0.0, 1.0) * 255.0)) & 0xffu;
}

fn unpackUNORM8(value : u32) -> f32 {
  return f32(value & 0xffu) / 255.0;
}

fn packUNORM16(value : f32) -> u32 {
  return u32(round(clamp(value, 0.0, 1.0) * 65535.0)) & 0xffffu;
}

fn unpackUNORM16(value : u32) -> f32 {
  return f32(value & 0xffffu) / 65535.0;
}

fn packSNORM8(value : f32) -> u32 {
  let signedValue = i32(round(clamp(value, -1.0, 1.0) * 127.0));
  if (signedValue < 0) {
    return u32(signedValue + 256) & 0xffu;
  }
  return u32(signedValue) & 0xffu;
}

fn unpackSNORM8(value : u32) -> f32 {
  let signedValue = i32(value & 0xffu);
  if (signedValue > 127) {
    return f32(signedValue - 256) / 127.0;
  }
  return f32(signedValue) / 127.0;
}

fn packSNORM16(value : f32) -> u32 {
  let signedValue = i32(round(clamp(value, -1.0, 1.0) * 32767.0));
  if (signedValue < 0) {
    return u32(signedValue + 65536) & 0xffffu;
  }
  return u32(signedValue) & 0xffffu;
}

fn unpackSNORM16(value : u32) -> f32 {
  let signedValue = i32(value & 0xffffu);
  if (signedValue > 32767) {
    return f32(signedValue - 65536) / 32767.0;
  }
  return f32(signedValue) / 32767.0;
}
`;

export default packingWGSL;
