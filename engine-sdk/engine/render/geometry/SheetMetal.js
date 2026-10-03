// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SheetMetal.js — folded sheet-metal solids and their flat patterns.
 *
 * Unfolding is often lumped in with "needs a real CAD kernel", but it is not the
 * same class of problem as tolerant surface booleans. The domain is restricted:
 * planar faces joined by cylindrical bends of known radius. Walk the bend
 * sequence, rotate each face about its bend line, and account for the material
 * that stretches through the bend with the standard K-factor bend allowance.
 * That is linear algebra plus a documented empirical formula.
 *
 *   Bend allowance   BA  = theta * (R + K * T)
 *   Outside setback  OSSB = (R + T) * tan(theta / 2)
 *   Bend deduction   BD  = 2 * OSSB - BA
 *
 * `K` locates the neutral axis as a fraction of thickness from the INSIDE
 * surface. K = 0.5 puts it at mid-thickness, which conserves volume exactly;
 * real steel runs nearer K = 0.44, meaning the blank is shorter than the folded
 * mid-surface because the outer fibres stretch. Both behaviours fall out of the
 * formula rather than being special-cased.
 *
 * Scope: a bend SEQUENCE about parallel axes — brackets, channels, Z-bends,
 * hems, U-profiles. That is the classic 2D sheet-metal model, and it means the
 * folded part is exactly an extruded cross-section, so it reuses the tested
 * profile extruder. Flanges on mutually perpendicular edges would need a general
 * face-adjacency unfold and are NOT claimed here.
 *
 * Cross-section is built in XZ and extruded along Y by the part width.
 */

import { makeProfile } from './Profile2D.js';
import { extrudeProfile } from './ProfileSolidGeometry.js';

const EPSILON = 1e-12;
const DEG = Math.PI / 180;

function rotate2(vector, radians) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [vector[0] * cos - vector[1] * sin, vector[0] * sin + vector[1] * cos];
}

function leftNormal(direction) {
  return [-direction[1], direction[0]];
}

/** BA = theta * (R + K * T) — the developed length of the bend region. */
export function bendAllowanceMeters(angleDegrees, insideRadiusMeters, thicknessMeters, kFactor) {
  return Math.abs(angleDegrees) * DEG * (insideRadiusMeters + kFactor * thicknessMeters);
}

/** OSSB = (R + T) * tan(theta / 2), measured from the bend apex. */
export function outsideSetbackMeters(angleDegrees, insideRadiusMeters, thicknessMeters) {
  return (insideRadiusMeters + thicknessMeters) * Math.tan(Math.abs(angleDegrees) * DEG / 2);
}

/** BD = 2 * OSSB - BA. */
export function bendDeductionMeters(angleDegrees, insideRadiusMeters, thicknessMeters, kFactor) {
  return 2 * outsideSetbackMeters(angleDegrees, insideRadiusMeters, thicknessMeters)
    - bendAllowanceMeters(angleDegrees, insideRadiusMeters, thicknessMeters, kFactor);
}

function normalizeSpec(spec) {
  const thickness = Number(spec?.thicknessMeters);
  if (!(thickness > 0)) throw new Error('SheetMetal: thicknessMeters must be positive');
  const width = Number(spec?.widthMeters);
  if (!(width > 0)) throw new Error('SheetMetal: widthMeters must be positive');
  const kFactor = spec?.kFactor == null ? 0.44 : Number(spec.kFactor);
  if (!(kFactor >= 0 && kFactor <= 1)) throw new Error('SheetMetal: kFactor must be within 0..1');
  const runs = (spec?.runsMeters ?? []).map(Number);
  if (runs.length < 1 || runs.some(value => !(value > 0))) {
    throw new Error('SheetMetal: runsMeters must hold at least one positive length');
  }
  const bends = (spec?.bends ?? []).map(bend => ({
    angleDegrees: Number(bend?.angleDegrees),
    insideRadiusMeters: Number(bend?.insideRadiusMeters),
    direction: bend?.direction === 'down' ? 'down' : 'up',
  }));
  if (bends.length !== runs.length - 1) {
    throw new Error(`SheetMetal: expected ${runs.length - 1} bends between ${runs.length} runs, received ${bends.length}`);
  }
  for (const bend of bends) {
    if (!Number.isFinite(bend.angleDegrees) || Math.abs(bend.angleDegrees) <= 0 || Math.abs(bend.angleDegrees) >= 180) {
      throw new Error('SheetMetal: each bend angleDegrees must be within 0..180 exclusive');
    }
    if (!(bend.insideRadiusMeters > 0)) {
      throw new Error('SheetMetal: each bend needs a positive insideRadiusMeters');
    }
  }
  return { thickness, width, kFactor, runs, bends };
}

/**
 * Walk the bend sequence along the MID-SURFACE, emitting densely sampled
 * stations of `{ point, normal }`. Offsetting these by +/- T/2 gives the two
 * faces of the cross-section.
 */
function midSurfaceStations({ thickness, runs, bends }, arcSegments) {
  const half = thickness / 2;
  let point = [0, 0];
  let direction = [1, 0];
  const stations = [{ point, normal: leftNormal(direction) }];
  runs.forEach((run, index) => {
    // Straight run: the normal is constant, so two stations suffice.
    point = [point[0] + direction[0] * run, point[1] + direction[1] * run];
    stations.push({ point, normal: leftNormal(direction) });
    const bend = bends[index];
    if (!bend) return;
    // Turning 'up' curves toward the left normal; the inside of the bend is on
    // that side, so the centre sits R + T/2 away along it.
    const sign = bend.direction === 'up' ? 1 : -1;
    const normal = leftNormal(direction);
    const centre = [
      point[0] + sign * (bend.insideRadiusMeters + half) * normal[0],
      point[1] + sign * (bend.insideRadiusMeters + half) * normal[1],
    ];
    const radial = [point[0] - centre[0], point[1] - centre[1]];
    const sweep = sign * Math.abs(bend.angleDegrees) * DEG;
    const steps = Math.max(1, Math.floor(arcSegments));
    for (let step = 1; step <= steps; step++) {
      const angle = (sweep * step) / steps;
      const rotated = rotate2(radial, angle);
      const at = [centre[0] + rotated[0], centre[1] + rotated[1]];
      const tangent = rotate2(direction, angle);
      stations.push({ point: at, normal: leftNormal(tangent) });
    }
    direction = rotate2(direction, sweep);
    point = stations[stations.length - 1].point;
  });
  return stations;
}

/**
 * Build a folded sheet-metal part and its flat pattern.
 *
 * `runsMeters` are the FLAT lengths between bend tangent lines (the first and
 * last also run to the free edge). Measuring flange length to the outside edge
 * instead is a different convention; this one is unambiguous and is what the
 * developed length below assumes.
 *
 * @param {object} spec
 * @param {number} spec.thicknessMeters
 * @param {number} spec.widthMeters
 * @param {number[]} spec.runsMeters
 * @param {Array<{angleDegrees:number,insideRadiusMeters:number,direction?:'up'|'down'}>} spec.bends
 * @param {number} [spec.kFactor] Neutral axis position from the inside face.
 * @param {number} [spec.arcSegments] Facets per bend.
 */
export function buildSheetMetalPart(spec, { arcSegments = 6 } = {}) {
  const normalized = normalizeSpec(spec);
  const { thickness, width, kFactor, runs, bends } = normalized;
  const half = thickness / 2;
  const stations = midSurfaceStations(normalized, arcSegments);

  // Cross-section: forward along one face, back along the other.
  const outer = stations.map(({ point, normal }) => [
    point[0] + normal[0] * half,
    point[1] + normal[1] * half,
  ]);
  const inner = stations.map(({ point, normal }) => [
    point[0] - normal[0] * half,
    point[1] - normal[1] * half,
  ]);
  const section = makeProfile([...outer, ...inner.reverse()]);
  const solid = extrudeProfile(section, { depth: width });

  // Flat pattern: straight runs plus one bend allowance per bend.
  const bendLines = [];
  let cursor = 0;
  runs.forEach((run, index) => {
    cursor += run;
    const bend = bends[index];
    if (!bend) return;
    const allowance = bendAllowanceMeters(
      bend.angleDegrees,
      bend.insideRadiusMeters,
      thickness,
      kFactor,
    );
    bendLines.push({
      startMeters: cursor,
      endMeters: cursor + allowance,
      angleDegrees: bend.angleDegrees,
      insideRadiusMeters: bend.insideRadiusMeters,
      direction: bend.direction,
      bendAllowanceMeters: allowance,
      outsideSetbackMeters: outsideSetbackMeters(bend.angleDegrees, bend.insideRadiusMeters, thickness),
      bendDeductionMeters: bendDeductionMeters(bend.angleDegrees, bend.insideRadiusMeters, thickness, kFactor),
    });
    cursor += allowance;
  });
  const developedLengthMeters = cursor;

  // Mid-surface arc length, for comparison against the developed length. These
  // agree only at K = 0.5; the gap is the modelled fibre stretch.
  const midSurfaceLengthMeters = runs.reduce((sum, run) => sum + run, 0)
    + bends.reduce((sum, bend) => (
      sum + Math.abs(bend.angleDegrees) * DEG * (bend.insideRadiusMeters + half)
    ), 0);

  return {
    solid,
    section,
    flatPattern: {
      lengthMeters: developedLengthMeters,
      widthMeters: width,
      thicknessMeters: thickness,
      kFactor,
      bendLines: Object.freeze(bendLines),
      // The blank is a plain rectangle for a parallel bend sequence.
      outline: Object.freeze([
        [0, 0], [developedLengthMeters, 0],
        [developedLengthMeters, width], [0, width],
      ]),
    },
    developedLengthMeters,
    midSurfaceLengthMeters,
    blankVolumeMeters3: developedLengthMeters * width * thickness,
    foldedVolumeMeters3: midSurfaceLengthMeters * width * thickness,
  };
}

export default buildSheetMetalPart;
