// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Pure configuration, layout, and validation math shared by long-range particle solvers. */

export const PARTICLE_LONG_RANGE_BACKENDS = Object.freeze({
  DIRECT: 'direct',
  FMM: 'fmm',
  PME: 'pme',
  ESP: 'esp',
});

export const PARTICLE_LONG_RANGE_BOUNDARIES = Object.freeze({
  OPEN: 'open',
  PERIODIC: 'periodic',
});

export const FMM_MIN_DEPTH = 2;
export const FMM_MAX_DEPTH = 5;
export const FMM_DEFAULT_LEAF_OCCUPANCY = 32;
export const FMM_CELL_MOMENT_BYTES = 16;
export const FMM_CELL_LOCAL_BYTES = 64;
export const PARTICLE_MESH_MIN_GRID_SIZE = 8;
export const PARTICLE_MESH_MAX_GRID_SIZE = 64;
export const PARTICLE_MESH_WINDOW_SAMPLES = 256;

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite.`);
  return number;
}

function positiveInteger(value, name) {
  const number = Math.trunc(finiteNumber(value, name));
  if (number < 1) throw new RangeError(`${name} must be a positive integer.`);
  return number;
}

export function fmmLevelCellCount(level) {
  const depth = Math.trunc(finiteNumber(level, 'FMM level'));
  if (depth < 0 || depth > FMM_MAX_DEPTH) {
    throw new RangeError(`FMM level must be in [0, ${FMM_MAX_DEPTH}].`);
  }
  return 8 ** depth;
}

export function fmmLevelOffset(level) {
  const depth = Math.trunc(finiteNumber(level, 'FMM level'));
  if (depth < 0 || depth > FMM_MAX_DEPTH) {
    throw new RangeError(`FMM level must be in [0, ${FMM_MAX_DEPTH}].`);
  }
  return (8 ** depth - 1) / 7;
}

export function fmmTotalCellCount(depth) {
  const level = Math.trunc(finiteNumber(depth, 'FMM depth'));
  if (level < FMM_MIN_DEPTH || level > FMM_MAX_DEPTH) {
    throw new RangeError(`FMM depth must be in [${FMM_MIN_DEPTH}, ${FMM_MAX_DEPTH}].`);
  }
  return fmmLevelOffset(level) + fmmLevelCellCount(level);
}

export function fmmSelectDepth(particleCount, options = {}) {
  const count = positiveInteger(particleCount, 'particleCount');
  const targetLeafOccupancy = positiveInteger(
    options.targetLeafOccupancy ?? FMM_DEFAULT_LEAF_OCCUPANCY,
    'targetLeafOccupancy',
  );
  const minimum = Math.max(FMM_MIN_DEPTH, Math.trunc(options.minimumDepth ?? FMM_MIN_DEPTH));
  const maximum = Math.min(FMM_MAX_DEPTH, Math.trunc(options.maximumDepth ?? FMM_MAX_DEPTH));
  if (minimum > maximum) throw new RangeError('minimumDepth cannot exceed maximumDepth.');
  for (let depth = minimum; depth <= maximum; depth += 1) {
    if (count / fmmLevelCellCount(depth) <= targetLeafOccupancy) return depth;
  }
  return maximum;
}

export function normalizeFmmConfig(config = {}) {
  const particleCount = positiveInteger(config.particleCount ?? 1, 'particleCount');
  const depth = config.depth == null
    ? fmmSelectDepth(particleCount, config)
    : Math.trunc(finiteNumber(config.depth, 'depth'));
  if (depth < FMM_MIN_DEPTH || depth > FMM_MAX_DEPTH) {
    throw new RangeError(`depth must be in [${FMM_MIN_DEPTH}, ${FMM_MAX_DEPTH}].`);
  }
  const domainHalfExtent = finiteNumber(config.domainHalfExtent ?? 8, 'domainHalfExtent');
  const softening = finiteNumber(config.softening ?? 0.05, 'softening');
  const coupling = finiteNumber(config.coupling ?? 1, 'coupling');
  const maxAcceleration = finiteNumber(config.maxAcceleration ?? 100, 'maxAcceleration');
  const damping = finiteNumber(config.damping ?? 1, 'damping');
  if (domainHalfExtent <= 0) throw new RangeError('domainHalfExtent must be positive.');
  if (softening < 0) throw new RangeError('softening cannot be negative.');
  if (maxAcceleration <= 0) throw new RangeError('maxAcceleration must be positive.');
  if (damping < 0 || damping > 1) throw new RangeError('damping must be in [0, 1].');
  return Object.freeze({
    backend: PARTICLE_LONG_RANGE_BACKENDS.FMM,
    boundary: PARTICLE_LONG_RANGE_BOUNDARIES.OPEN,
    particleCount,
    depth,
    domainHalfExtent,
    softening,
    coupling,
    maxAcceleration,
    damping,
    defaultSource: finiteNumber(config.defaultSource ?? 1, 'defaultSource'),
    useParticleMass: config.useParticleMass !== false,
    targetLeafOccupancy: positiveInteger(
      config.targetLeafOccupancy ?? FMM_DEFAULT_LEAF_OCCUPANCY,
      'targetLeafOccupancy',
    ),
  });
}

export function estimateFmmMemory(config = {}) {
  const normalized = normalizeFmmConfig(config);
  const leaves = fmmLevelCellCount(normalized.depth);
  const cells = fmmTotalCellCount(normalized.depth);
  const particles = normalized.particleCount;
  const breakdown = Object.freeze({
    moments: cells * FMM_CELL_MOMENT_BYTES,
    locals: cells * FMM_CELL_LOCAL_BYTES,
    leafCounts: leaves * 4,
    leafOffsets: (leaves + 1) * 4,
    leafCursors: leaves * 4,
    particleLeafKeys: particles * 4,
    sortedParticleIndices: particles * 4,
    diagnostics: 16,
    params: 64,
  });
  return Object.freeze({
    depth: normalized.depth,
    leaves,
    cells,
    breakdown,
    totalBytes: Object.values(breakdown).reduce((sum, value) => sum + value, 0),
  });
}

function powerOfTwo(value, name) {
  const number = positiveInteger(value, name);
  if ((number & (number - 1)) !== 0) throw new RangeError(`${name} must be a power of two.`);
  return number;
}

export function normalizeParticleMeshConfig(config = {}) {
  const backend = String(config.backend ?? PARTICLE_LONG_RANGE_BACKENDS.PME).toLowerCase();
  if (backend !== PARTICLE_LONG_RANGE_BACKENDS.PME && backend !== PARTICLE_LONG_RANGE_BACKENDS.ESP) {
    throw new RangeError("Particle-mesh backend must be 'pme' or 'esp'.");
  }
  const particleCount = positiveInteger(config.particleCount ?? 1, 'particleCount');
  const gridSize = powerOfTwo(config.gridSize ?? (backend === PARTICLE_LONG_RANGE_BACKENDS.ESP ? 16 : 32), 'gridSize');
  if (gridSize < PARTICLE_MESH_MIN_GRID_SIZE || gridSize > PARTICLE_MESH_MAX_GRID_SIZE) {
    throw new RangeError(`gridSize must be in [${PARTICLE_MESH_MIN_GRID_SIZE}, ${PARTICLE_MESH_MAX_GRID_SIZE}].`);
  }
  const domainHalfExtent = finiteNumber(config.domainHalfExtent ?? 8, 'domainHalfExtent');
  const coupling = finiteNumber(config.coupling ?? 1, 'coupling');
  const maxAcceleration = finiteNumber(config.maxAcceleration ?? 100, 'maxAcceleration');
  const damping = finiteNumber(config.damping ?? 1, 'damping');
  const windowRadius = finiteNumber(
    config.windowRadius ?? (backend === PARTICLE_LONG_RANGE_BACKENDS.ESP ? 3 : 2),
    'windowRadius',
  );
  const prolateBandwidth = finiteNumber(config.prolateBandwidth ?? 12, 'prolateBandwidth');
  const cellWidth = (2 * domainHalfExtent) / gridSize;
  const ewaldAlpha = finiteNumber(config.ewaldAlpha ?? (1.25 / cellWidth), 'ewaldAlpha');
  const realCutoff = finiteNumber(config.realCutoff ?? (2 * cellWidth), 'realCutoff');
  const deconvolutionLimit = finiteNumber(config.deconvolutionLimit ?? 16, 'deconvolutionLimit');
  if (domainHalfExtent <= 0) throw new RangeError('domainHalfExtent must be positive.');
  if (maxAcceleration <= 0) throw new RangeError('maxAcceleration must be positive.');
  if (damping < 0 || damping > 1) throw new RangeError('damping must be in [0, 1].');
  if (windowRadius < 1 || windowRadius > 4) throw new RangeError('windowRadius must be in [1, 4].');
  if (Math.ceil(windowRadius) * 2 >= gridSize) {
    throw new RangeError('windowRadius must be smaller than half the periodic grid.');
  }
  if (prolateBandwidth < 1 || prolateBandwidth > 32) throw new RangeError('prolateBandwidth must be in [1, 32].');
  if (ewaldAlpha <= 0) throw new RangeError('ewaldAlpha must be positive.');
  if (realCutoff <= 0 || realCutoff >= domainHalfExtent) {
    throw new RangeError('realCutoff must be positive and smaller than domainHalfExtent.');
  }
  if (Math.ceil(realCutoff / cellWidth) > 4) {
    throw new RangeError('realCutoff cannot span more than four mesh cells.');
  }
  if (deconvolutionLimit < 1) throw new RangeError('deconvolutionLimit must be at least 1.');
  return Object.freeze({
    backend,
    boundary: PARTICLE_LONG_RANGE_BOUNDARIES.PERIODIC,
    particleCount,
    gridSize,
    domainHalfExtent,
    coupling,
    maxAcceleration,
    damping,
    defaultSource: finiteNumber(config.defaultSource ?? 1, 'defaultSource'),
    useParticleMass: config.useParticleMass !== false,
    windowRadius,
    prolateBandwidth,
    ewaldAlpha,
    realCutoff,
    deconvolutionLimit,
  });
}

export function estimateParticleMeshMemory(config = {}) {
  const normalized = normalizeParticleMeshConfig(config);
  const cells = normalized.gridSize ** 3;
  const particles = normalized.particleCount;
  const breakdown = Object.freeze({
    spectralA: cells * 8,
    spectralB: cells * 8,
    cellCounts: cells * 4,
    cellOffsets: (cells + 1) * 4,
    cellCursors: cells * 4,
    particleCellKeys: particles * 4,
    sortedParticleIndices: particles * 4,
    windowTable: PARTICLE_MESH_WINDOW_SAMPLES * 4 * 3,
    windowSpectrum: normalized.gridSize * 4,
    splitSpectrum: cells * 4,
    diagnostics: 16,
    params: 64,
  });
  return Object.freeze({
    gridSize: normalized.gridSize,
    cells,
    breakdown,
    totalBytes: Object.values(breakdown).reduce((sum, value) => sum + value, 0),
  });
}

/**
 * Samples the positive, even, order-zero PSWF. Inverse iteration solves the
 * spheroidal Sturm-Liouville operator in an orthonormal even-Legendre basis;
 * the GPU linearly interpolates the resulting half-window.
 */
export function generateProlateWindowTable(options = {}) {
  const samples = positiveInteger(options.samples ?? PARTICLE_MESH_WINDOW_SAMPLES, 'samples');
  const bandwidth = finiteNumber(options.bandwidth ?? 7.5, 'bandwidth');
  const iterations = positiveInteger(options.iterations ?? 32, 'iterations');
  if (samples < 16 || samples > 1024) throw new RangeError('samples must be in [16, 1024].');
  if (bandwidth < 1 || bandwidth > 32) throw new RangeError('bandwidth must be in [1, 32].');
  const basisSize = Math.min(64, samples);
  const diagonal = new Float64Array(basisSize);
  const offDiagonal = new Float64Array(basisSize - 1);
  const squaredBandwidth = bandwidth * bandwidth;
  const coupling = (degree) => degree < 0
    ? 0
    : (degree + 1) / Math.sqrt((2 * degree + 1) * (2 * degree + 3));
  for (let basis = 0; basis < basisSize; basis += 1) {
    const degree = basis * 2;
    diagonal[basis] = degree * (degree + 1)
      + squaredBandwidth * (coupling(degree) ** 2 + coupling(degree - 1) ** 2);
    if (basis < basisSize - 1) {
      offDiagonal[basis] = squaredBandwidth * coupling(degree) * coupling(degree + 1);
    }
  }

  let vector = new Float64Array(basisSize);
  vector[0] = 1;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const reducedDiagonal = new Float64Array(diagonal);
    const rightHandSide = new Float64Array(vector);
    for (let row = 1; row < basisSize; row += 1) {
      const scale = offDiagonal[row - 1] / reducedDiagonal[row - 1];
      reducedDiagonal[row] -= scale * offDiagonal[row - 1];
      rightHandSide[row] -= scale * rightHandSide[row - 1];
    }
    const next = new Float64Array(basisSize);
    next[basisSize - 1] = rightHandSide[basisSize - 1] / reducedDiagonal[basisSize - 1];
    for (let row = basisSize - 2; row >= 0; row -= 1) {
      next[row] = (rightHandSide[row] - offDiagonal[row] * next[row + 1]) / reducedDiagonal[row];
    }
    let normSquared = 0;
    for (const value of next) normSquared += value * value;
    const inverseNorm = 1 / Math.sqrt(Math.max(normSquared, Number.EPSILON));
    for (let index = 0; index < basisSize; index += 1) next[index] *= inverseNorm;
    vector = next;
  }

  const evaluated = new Float64Array(samples);
  for (let index = 0; index < samples; index += 1) {
    const x = index / (samples - 1);
    let previous = 1;
    let current = x;
    let value = vector[0] / Math.sqrt(2);
    let basis = 1;
    for (let degree = 2; degree <= (basisSize - 1) * 2; degree += 1) {
      const polynomial = ((2 * degree - 1) * x * current - (degree - 1) * previous) / degree;
      previous = current;
      current = polynomial;
      if ((degree & 1) === 0) {
        value += vector[basis] * Math.sqrt((2 * degree + 1) / 2) * polynomial;
        basis += 1;
      }
    }
    evaluated[index] = value;
  }
  const sign = evaluated[0] < 0 ? -1 : 1;
  const peak = Math.abs(evaluated[0]);
  const table = new Float32Array(samples);
  for (let index = 0; index < samples; index += 1) {
    table[index] = Math.max(0, sign * evaluated[index] / Math.max(peak, Number.EPSILON));
  }
  return table;
}

/**
 * Builds the normalized radial density and complementary local kernel used by
 * the PSWF Ewald split. The density integrates to one on [0, 1], while the
 * complement falls from one to zero at the real-space cutoff.
 */
export function generateProlateSplitTable(windowTable) {
  if (!ArrayBuffer.isView(windowTable) && !Array.isArray(windowTable)) {
    throw new TypeError('windowTable must be an array-like sequence.');
  }
  const samples = windowTable.length;
  if (samples < 16 || samples > 1024) throw new RangeError('windowTable length must be in [16, 1024].');
  const step = 1 / (samples - 1);
  let integral = 0;
  for (let index = 0; index < samples; index += 1) {
    const value = finiteNumber(windowTable[index], `windowTable[${index}]`);
    if (value < 0) throw new RangeError('windowTable values cannot be negative.');
    integral += value * (index === 0 || index === samples - 1 ? 0.5 : 1) * step;
  }
  if (!(integral > Number.EPSILON)) throw new RangeError('windowTable must have a positive integral.');

  const density = new Float32Array(samples);
  const complement = new Float32Array(samples);
  let cumulative = 0;
  density[0] = finiteNumber(windowTable[0], 'windowTable[0]') / integral;
  complement[0] = 1;
  for (let index = 1; index < samples; index += 1) {
    density[index] = finiteNumber(windowTable[index], `windowTable[${index}]`) / integral;
    cumulative += 0.5 * (density[index - 1] + density[index]) * step;
    complement[index] = Math.max(0, 1 - cumulative);
  }
  complement[samples - 1] = 0;
  return Object.freeze({ density, complement, integral });
}

/** Cosine transform of the normalized even PSWF splitting kernel. */
export function prolateSplitFourierResponse(splitDensity, angularFrequency) {
  if (!ArrayBuffer.isView(splitDensity) && !Array.isArray(splitDensity)) {
    throw new TypeError('splitDensity must be an array-like sequence.');
  }
  const samples = splitDensity.length;
  if (samples < 16 || samples > 1024) throw new RangeError('splitDensity length must be in [16, 1024].');
  const frequency = finiteNumber(angularFrequency, 'angularFrequency');
  if (frequency < 0) throw new RangeError('angularFrequency cannot be negative.');
  const step = 1 / (samples - 1);
  let response = 0;
  for (let index = 0; index < samples; index += 1) {
    const density = finiteNumber(splitDensity[index], `splitDensity[${index}]`);
    const quadrature = index === 0 || index === samples - 1 ? 0.5 : 1;
    response += density * Math.cos(frequency * index * step) * quadrature * step;
  }
  return response;
}

export function fmmCellCoordinate(index, level) {
  const size = 2 ** Math.trunc(level);
  const cell = Math.trunc(finiteNumber(index, 'cell index'));
  if (cell < 0 || cell >= size ** 3) throw new RangeError('cell index is outside the level.');
  let code = cell >>> 0;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let bit = 0; bit < level; bit += 1) {
    x |= ((code >>> (bit * 3)) & 1) << bit;
    y |= ((code >>> (bit * 3 + 1)) & 1) << bit;
    z |= ((code >>> (bit * 3 + 2)) & 1) << bit;
  }
  return Object.freeze({ x, y, z });
}

export function fmmMortonCellIndex(x, y, z, level) {
  const size = 2 ** Math.trunc(level);
  const coordinates = [x, y, z].map((value, axis) => {
    const coordinate = Math.trunc(finiteNumber(value, `cell coordinate ${axis}`));
    if (coordinate < 0 || coordinate >= size) throw new RangeError('cell coordinate is outside the level.');
    return coordinate;
  });
  let code = 0;
  for (let bit = 0; bit < level; bit += 1) {
    code |= ((coordinates[0] >>> bit) & 1) << (bit * 3);
    code |= ((coordinates[1] >>> bit) & 1) << (bit * 3 + 1);
    code |= ((coordinates[2] >>> bit) & 1) << (bit * 3 + 2);
  }
  return code >>> 0;
}

export function fmmInteractionCells(targetIndex, level) {
  if (level < 2) return Object.freeze([]);
  const target = fmmCellCoordinate(targetIndex, level);
  const size = 2 ** level;
  const parent = { x: target.x >>> 1, y: target.y >>> 1, z: target.z >>> 1 };
  const interactions = [];
  for (let pz = parent.z - 1; pz <= parent.z + 1; pz += 1) {
    for (let py = parent.y - 1; py <= parent.y + 1; py += 1) {
      for (let px = parent.x - 1; px <= parent.x + 1; px += 1) {
        if (px < 0 || py < 0 || pz < 0 || px >= size / 2 || py >= size / 2 || pz >= size / 2) continue;
        for (let child = 0; child < 8; child += 1) {
          const sx = px * 2 + (child & 1);
          const sy = py * 2 + ((child >>> 1) & 1);
          const sz = pz * 2 + ((child >>> 2) & 1);
          if (Math.abs(sx - target.x) <= 1 && Math.abs(sy - target.y) <= 1 && Math.abs(sz - target.z) <= 1) continue;
          interactions.push(fmmMortonCellIndex(sx, sy, sz, level));
        }
      }
    }
  }
  return Object.freeze(interactions);
}

export function directLongRangeAccelerations(positions, sources, options = {}) {
  if (!Array.isArray(positions) && !ArrayBuffer.isView(positions)) {
    throw new TypeError('positions must be an array-like xyz sequence.');
  }
  if (positions.length % 3 !== 0) throw new RangeError('positions length must be divisible by 3.');
  const count = positions.length / 3;
  if ((!Array.isArray(sources) && !ArrayBuffer.isView(sources)) || sources.length !== count) {
    throw new RangeError('sources must contain one finite value per position.');
  }
  const coupling = finiteNumber(options.coupling ?? 1, 'coupling');
  const softening = finiteNumber(options.softening ?? 0, 'softening');
  if (softening < 0) throw new RangeError('softening cannot be negative.');
  const softSquared = softening * softening;
  const result = new Float64Array(count * 3);
  for (let target = 0; target < count; target += 1) {
    const tx = finiteNumber(positions[target * 3], 'position x');
    const ty = finiteNumber(positions[target * 3 + 1], 'position y');
    const tz = finiteNumber(positions[target * 3 + 2], 'position z');
    for (let source = 0; source < count; source += 1) {
      if (source === target) continue;
      const dx = finiteNumber(positions[source * 3], 'position x') - tx;
      const dy = finiteNumber(positions[source * 3 + 1], 'position y') - ty;
      const dz = finiteNumber(positions[source * 3 + 2], 'position z') - tz;
      const inverseDistance = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz + softSquared);
      const scale = coupling * finiteNumber(sources[source], 'source') * inverseDistance ** 3;
      result[target * 3] += dx * scale;
      result[target * 3 + 1] += dy * scale;
      result[target * 3 + 2] += dz * scale;
    }
  }
  return result;
}

export function compareLongRangeVectors(reference, approximate) {
  if ((!Array.isArray(reference) && !ArrayBuffer.isView(reference))
      || (!Array.isArray(approximate) && !ArrayBuffer.isView(approximate))
      || reference.length !== approximate.length || reference.length === 0) {
    throw new RangeError('reference and approximate must be equal non-empty array-like vectors.');
  }
  let errorSquared = 0;
  let referenceSquared = 0;
  let maximumAbsoluteError = 0;
  for (let index = 0; index < reference.length; index += 1) {
    const expected = finiteNumber(reference[index], 'reference value');
    const actual = finiteNumber(approximate[index], 'approximate value');
    const error = actual - expected;
    errorSquared += error * error;
    referenceSquared += expected * expected;
    maximumAbsoluteError = Math.max(maximumAbsoluteError, Math.abs(error));
  }
  return Object.freeze({
    relativeL2: Math.sqrt(errorSquared / Math.max(referenceSquared, Number.EPSILON)),
    rms: Math.sqrt(errorSquared / reference.length),
    maximumAbsoluteError,
  });
}

export default {
  normalizeFmmConfig,
  estimateFmmMemory,
  fmmLevelCellCount,
  fmmLevelOffset,
  fmmTotalCellCount,
  fmmSelectDepth,
  fmmCellCoordinate,
  fmmMortonCellIndex,
  fmmInteractionCells,
  directLongRangeAccelerations,
  compareLongRangeVectors,
  normalizeParticleMeshConfig,
  estimateParticleMeshMemory,
  generateProlateWindowTable,
  generateProlateSplitTable,
  prolateSplitFourierResponse,
};
