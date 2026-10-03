// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  CERTIFICATE_BUNDLE_BYTES,
  CERTIFICATE_RECORD_BYTES,
  FIELDLET_HEADER_BYTES,
  FIELDLET_HEADER_WORD,
  INVALID_REF,
  META_LAYOUT,
  QUERY_MASK,
} from './constants.js';
import { failMorphField, invariant } from './errors.js';

const F32_MAX = 3.4028234663852886e38;
const f32Bits = new Uint32Array(1);
const f32Value = new Float32Array(f32Bits.buffer);

function checkedUnsigned(value, maximum, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > maximum) {
    failMorphField('ABI_RANGE_ERROR', `${name} must be an integer in [0, ${maximum}]`, {
      name,
      value,
      maximum,
    });
  }
  return number >>> 0;
}

function checkedRef(value, name) {
  return checkedUnsigned(value, 0xffffffff, name);
}

function finiteNonNegative(value, name, options = {}) {
  const number = Number(value);
  const minimum = options.strictlyPositive ? Number.MIN_VALUE : 0;
  if (!Number.isFinite(number) || number < minimum || (options.strictlyPositive && number === 0)) {
    failMorphField('INVALID_CERTIFICATE', `${name} must be ${options.strictlyPositive ? 'positive' : 'non-negative'} and finite`, {
      name,
      value,
    });
  }
  return number;
}

function conservativeF32NonNegative(value, name, options = {}) {
  const number = finiteNonNegative(value, name, options);
  if (number > F32_MAX) {
    failMorphField('INVALID_CERTIFICATE', `${name} exceeds the finite f32 range`, { name, value });
  }
  const rounded = Math.fround(number);
  if (rounded >= number) return rounded;
  f32Value[0] = rounded;
  f32Bits[0] += 1;
  return f32Value[0];
}

function finiteF32(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > F32_MAX) {
    failMorphField('ABI_RANGE_ERROR', `${name} must be finite and representable by f32`, {
      name,
      value,
      maximumMagnitude: F32_MAX,
    });
  }
  return Object.is(number, -0) ? 0 : number;
}

function adjacentF32(value, towardPositive) {
  f32Value[0] = value;
  const rounded = f32Value[0];
  if (rounded === 0) {
    f32Bits[0] = towardPositive ? 0x00000001 : 0x80000001;
  } else if ((rounded > 0) === towardPositive) {
    f32Bits[0] += 1;
  } else {
    f32Bits[0] -= 1;
  }
  return f32Value[0];
}

function conservativeF32Bound(value, direction, name) {
  const number = finiteF32(value, name);
  const rounded = Math.fround(number);
  if (direction < 0) return rounded <= number ? rounded : adjacentF32(rounded, false);
  return rounded >= number ? rounded : adjacentF32(rounded, true);
}

export function createOutwardF32Bounds(bounds, expansion = 0) {
  const minimum = bounds?.min;
  const maximum = bounds?.max;
  if ((!Array.isArray(minimum) && !ArrayBuffer.isView(minimum)) || minimum.length !== 3
      || (!Array.isArray(maximum) && !ArrayBuffer.isView(maximum)) || maximum.length !== 3) {
    failMorphField('INVALID_BOUNDS', 'createOutwardF32Bounds requires three-component min and max arrays');
  }
  const radius = finiteNonNegative(expansion, 'boundsExpansion');
  const packedMin = [];
  const packedMax = [];
  for (let axis = 0; axis < 3; axis++) {
    const sourceMin = finiteF32(minimum[axis], `bounds.min[${axis}]`);
    const sourceMax = finiteF32(maximum[axis], `bounds.max[${axis}]`);
    if (!(sourceMin < sourceMax)) {
      failMorphField('INVALID_BOUNDS', 'Bounds must be strictly ordered on every axis before expansion', {
        axis,
        min: sourceMin,
        max: sourceMax,
      });
    }
    const min = finiteF32(sourceMin - radius, `bounds.min[${axis}] - expansion`);
    const max = finiteF32(sourceMax + radius, `bounds.max[${axis}] + expansion`);
    if (!(min < max)) {
      failMorphField('INVALID_BOUNDS', 'Expanded bounds must remain strictly ordered on every axis', {
        axis,
        min,
        max,
        expansion: radius,
      });
    }
    packedMin.push(conservativeF32Bound(min, -1, `bounds.min[${axis}]`));
    packedMax.push(conservativeF32Bound(max, 1, `bounds.max[${axis}]`));
  }
  return Object.freeze({
    min: Object.freeze(packedMin),
    max: Object.freeze(packedMax),
  });
}

export function packFieldletMeta({ subtype = 0, family = 0, queryMask = 0, flags = 0 } = {}) {
  const subtypeValue = checkedUnsigned(subtype, META_LAYOUT.SUBTYPE_MASK, 'subtype');
  const familyValue = checkedUnsigned(family, META_LAYOUT.FAMILY_MASK, 'family');
  const queryValue = checkedUnsigned(queryMask, META_LAYOUT.QUERY_MASK, 'queryMask');
  const flagValue = checkedUnsigned(flags, META_LAYOUT.FLAG_MASK, 'flags');
  return (
    (subtypeValue << META_LAYOUT.SUBTYPE_SHIFT)
    | (familyValue << META_LAYOUT.FAMILY_SHIFT)
    | (queryValue << META_LAYOUT.QUERY_SHIFT)
    | (flagValue << META_LAYOUT.FLAG_SHIFT)
  ) >>> 0;
}

export function unpackFieldletMeta(meta) {
  const value = checkedUnsigned(meta, 0xffffffff, 'meta');
  return Object.freeze({
    subtype: (value >>> META_LAYOUT.SUBTYPE_SHIFT) & META_LAYOUT.SUBTYPE_MASK,
    family: (value >>> META_LAYOUT.FAMILY_SHIFT) & META_LAYOUT.FAMILY_MASK,
    queryMask: (value >>> META_LAYOUT.QUERY_SHIFT) & META_LAYOUT.QUERY_MASK,
    flags: (value >>> META_LAYOUT.FLAG_SHIFT) & META_LAYOUT.FLAG_MASK,
  });
}

export function createFieldletHeader({ boundsRef, payloadRef, meta, certificateRef = INVALID_REF }) {
  return new Uint32Array([
    checkedRef(boundsRef, 'boundsRef'),
    checkedRef(payloadRef, 'payloadRef'),
    checkedRef(meta, 'meta'),
    checkedRef(certificateRef, 'certificateRef'),
  ]);
}

export function writeFieldletHeader(view, byteOffset, header) {
  invariant(view instanceof DataView, 'EXPECTED_DATA_VIEW', 'writeFieldletHeader requires a DataView');
  invariant(Number.isSafeInteger(byteOffset) && byteOffset >= 0 && byteOffset + FIELDLET_HEADER_BYTES <= view.byteLength,
    'ABI_BUFFER_RANGE', 'Fieldlet header exceeds the destination DataView', { byteOffset, byteLength: view.byteLength });
  const words = createFieldletHeader(header);
  for (let word = 0; word < words.length; word++) view.setUint32(byteOffset + word * 4, words[word], true);
}

export function readFieldletHeader(view, byteOffset = 0) {
  invariant(view instanceof DataView, 'EXPECTED_DATA_VIEW', 'readFieldletHeader requires a DataView');
  invariant(Number.isSafeInteger(byteOffset) && byteOffset >= 0 && byteOffset + FIELDLET_HEADER_BYTES <= view.byteLength,
    'ABI_BUFFER_RANGE', 'Fieldlet header exceeds the source DataView', { byteOffset, byteLength: view.byteLength });
  const boundsRef = view.getUint32(byteOffset + FIELDLET_HEADER_WORD.BOUNDS_REF * 4, true);
  const payloadRef = view.getUint32(byteOffset + FIELDLET_HEADER_WORD.PAYLOAD_REF * 4, true);
  const meta = view.getUint32(byteOffset + FIELDLET_HEADER_WORD.META * 4, true);
  const certificateRef = view.getUint32(byteOffset + FIELDLET_HEADER_WORD.CERTIFICATE_REF * 4, true);
  return Object.freeze({ boundsRef, payloadRef, meta, certificateRef, ...unpackFieldletMeta(meta) });
}

export function createCertificateBundle({
  surfaceRef = INVALID_REF,
  mediumRef = INVALID_REF,
  motionRef = INVALID_REF,
  collisionRef = INVALID_REF,
} = {}) {
  return new Uint32Array([
    checkedRef(surfaceRef, 'surfaceRef'),
    checkedRef(mediumRef, 'mediumRef'),
    checkedRef(motionRef, 'motionRef'),
    checkedRef(collisionRef, 'collisionRef'),
  ]);
}

export function createSurfaceCertificate({
  fieldValueErrorMax = 0,
  lipschitzMax,
  fallbackBand = 0,
  motionRadiusMax = 0,
}) {
  return new Float32Array([
    conservativeF32NonNegative(fieldValueErrorMax, 'fieldValueErrorMax'),
    conservativeF32NonNegative(lipschitzMax, 'lipschitzMax', { strictlyPositive: true }),
    conservativeF32NonNegative(fallbackBand, 'fallbackBand'),
    conservativeF32NonNegative(motionRadiusMax, 'motionRadiusMax'),
  ]);
}

export function createMediumCertificate({
  densityMax = 0,
  extinctionMax = 0,
  emissionLuminanceMax = 0,
  motionRadiusMax = 0,
} = {}) {
  return new Float32Array([
    conservativeF32NonNegative(densityMax, 'densityMax'),
    conservativeF32NonNegative(extinctionMax, 'extinctionMax'),
    conservativeF32NonNegative(emissionLuminanceMax, 'emissionLuminanceMax'),
    conservativeF32NonNegative(motionRadiusMax, 'motionRadiusMax'),
  ]);
}

export function createMotionCertificate({
  displacementMax = 0,
  speedMax = 0,
  accelerationMax = 0,
  validDuration = 0,
} = {}) {
  return new Float32Array([
    conservativeF32NonNegative(displacementMax, 'displacementMax'),
    conservativeF32NonNegative(speedMax, 'speedMax'),
    conservativeF32NonNegative(accelerationMax, 'accelerationMax'),
    conservativeF32NonNegative(validDuration, 'validDuration'),
  ]);
}

export function createCollisionCertificate({
  fieldValueErrorMax = 0,
  lipschitzMax,
  contactOffset,
  contactSlop = 0,
  motionRadiusMax = 0,
}) {
  const predictiveOffset = contactOffset ?? contactSlop;
  return new Float32Array([
    conservativeF32NonNegative(fieldValueErrorMax, 'fieldValueErrorMax'),
    conservativeF32NonNegative(lipschitzMax, 'lipschitzMax', { strictlyPositive: true }),
    conservativeF32NonNegative(predictiveOffset, 'contactOffset'),
    conservativeF32NonNegative(motionRadiusMax, 'motionRadiusMax'),
  ]);
}

export function safeCertifiedStep(fieldEstimate, certificate) {
  const estimate = Number(fieldEstimate);
  if (!Number.isFinite(estimate)) return 0;
  const values = (ArrayBuffer.isView(certificate) || Array.isArray(certificate))
    ? certificate
    : [certificate?.fieldValueErrorMax, certificate?.lipschitzMax];
  const error = Number(values[0]);
  const lipschitz = Number(values[1]);
  if (!Number.isFinite(error) || error < 0 || !Number.isFinite(lipschitz) || lipschitz <= 0) return 0;
  return Math.max(estimate - error, 0) / lipschitz;
}

export function validateFieldletAbi() {
  invariant(FIELDLET_HEADER_BYTES === 16, 'ABI_LAYOUT_ERROR', 'Fieldlet header must remain exactly 16 bytes');
  invariant(CERTIFICATE_BUNDLE_BYTES === 16, 'ABI_LAYOUT_ERROR', 'Certificate bundle must remain exactly 16 bytes');
  invariant(CERTIFICATE_RECORD_BYTES === 16, 'ABI_LAYOUT_ERROR', 'Certificate records must remain exactly 16 bytes');
  invariant(QUERY_MASK.ALL === 0x3f, 'ABI_LAYOUT_ERROR', 'Typed query mask must occupy exactly six bits');
  const allFields = packFieldletMeta({ subtype: 0xfff, family: 0xf, queryMask: 0x3f, flags: 0x3ff });
  invariant(allFields === 0xffffffff, 'ABI_LAYOUT_ERROR', 'Fieldlet meta fields must fill exactly 32 bits');
  return true;
}
