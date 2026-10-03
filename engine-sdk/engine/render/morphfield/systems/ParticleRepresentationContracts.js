// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

export function deepFreezeParticleContract(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value)) deepFreezeParticleContract(entry, seen);
  return Object.freeze(value);
}

export function particleRecord(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value;
}

export function particleIdentifier(value, path) {
  const result = String(value ?? '');
  if (!IDENTIFIER.test(result)) throw new TypeError(`${path} has invalid identifier syntax`);
  return result;
}

export function particleSemver(value, path) {
  const result = String(value ?? '');
  if (!SEMVER.test(result)) throw new TypeError(`${path} must be a semantic version`);
  return result;
}

export function particleFinite(value, path, {
  minimum = -Number.MAX_VALUE,
  maximum = Number.MAX_VALUE,
} = {}) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new RangeError(`${path} must be finite in [${minimum}, ${maximum}]`);
  }
  return result;
}

export function particleInteger(value, path, {
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
} = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${path} must be a safe integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

export function particleRevision(value, path) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  return particleIdentifier(value, path);
}

export function particleEnum(value, allowed, path) {
  const result = String(value ?? '');
  if (!allowed.includes(result)) {
    throw new RangeError(`${path} must be one of: ${allowed.join(', ')}`);
  }
  return result;
}

export function particleVec3(value, path, fallback = null) {
  const source = value ?? fallback;
  if ((!Array.isArray(source) && !ArrayBuffer.isView(source)) || source.length < 3) {
    throw new TypeError(`${path} requires three values`);
  }
  return [
    particleFinite(source[0], `${path}[0]`),
    particleFinite(source[1], `${path}[1]`),
    particleFinite(source[2], `${path}[2]`),
  ];
}

export function particleMat3(value, path, fallback = null) {
  const source = value ?? fallback;
  if ((!Array.isArray(source) && !ArrayBuffer.isView(source)) || source.length < 9) {
    throw new TypeError(`${path} requires nine values`);
  }
  return Array.from(source).slice(0, 9).map((entry, index) => (
    particleFinite(entry, `${path}[${index}]`)
  ));
}

export function particleMagnitude(value) {
  return Math.hypot(...value);
}

export function particleRelativeError(reference, candidate, floor = 1e-12) {
  return Math.abs(candidate - reference) / Math.max(Math.abs(reference), floor);
}

export function particleVectorDistance(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

export function particleFingerprint(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function canonicalParticleStrings(values, path) {
  if (!Array.isArray(values)) throw new TypeError(`${path} must be an array`);
  const normalized = values.map((value, index) => particleIdentifier(value, `${path}[${index}]`));
  normalized.sort();
  for (let index = 1; index < normalized.length; index++) {
    if (normalized[index] === normalized[index - 1]) {
      throw new Error(`${path} contains duplicate '${normalized[index]}'`);
    }
  }
  return normalized;
}
