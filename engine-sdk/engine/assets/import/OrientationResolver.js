// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/import/OrientationResolver.js — axis/scale/origin inference
// (spec §6). Never trust source orientation; never bake corrections into source.
// We infer a non-destructive ImportTransform (axis correction quat + scale +
// origin) with a confidence, and a policy decides whether to auto-apply, mark
// reviewable, preview only, or stay neutral and require manual correction.

import { createImportTransform } from '../EngineModel.js';
import { axisCorrectionQuat, unitScaleToMeters } from '../CanonicalSpace.js';

export const CONFIDENCE_POLICY = Object.freeze({
  AUTO: 'auto',       // >= 0.95 — apply automatically
  REVIEW: 'review',   // >= 0.75 — apply but flag for review
  PREVIEW: 'preview', // >= 0.50 — preview in editor, do not auto-apply
  NEUTRAL: 'neutral', // < 0.50 — import neutral, require correction
});

export function classifyConfidence(c) {
  if (c >= 0.95) return CONFIDENCE_POLICY.AUTO;
  if (c >= 0.75) return CONFIDENCE_POLICY.REVIEW;
  if (c >= 0.50) return CONFIDENCE_POLICY.PREVIEW;
  return CONFIDENCE_POLICY.NEUTRAL;
}

// Declared source conventions per format. glTF is authoritatively Y-up/Z-forward
// (spec), so it earns high confidence; others are guesses.
const FORMAT_CONVENTION = {
  gltf: { up: '+Y', forward: '+Z', confidence: 0.97 },
  glb: { up: '+Y', forward: '+Z', confidence: 0.97 },
  obj: { up: '+Y', forward: '-Z', confidence: 0.6 },
  ply: { up: '+Y', forward: '+Z', confidence: 0.5 },
  stl: { up: '+Z', forward: '-Y', confidence: 0.5 }, // CAD/print exports are often Z-up
};

/**
 * Infer an ImportTransform for a model.
 * @param {object} model EngineModel (uses sourceFormat + bounds)
 * @param {object} [opts] { unitHint, upAxis, forwardAxis } explicit overrides win
 * @returns {{ transform:object, policy:string, signals:object }}
 */
export function resolveOrientation(model, opts = {}) {
  const fmt = String(model.sourceFormat || '').toLowerCase();
  const conv = FORMAT_CONVENTION[fmt] || { up: '+Y', forward: '+Z', confidence: 0.4 };

  const upAxis = opts.upAxis || conv.up;
  const forwardAxis = opts.forwardAxis || conv.forward;
  let confidence = (opts.upAxis || opts.forwardAxis) ? 0.98 : conv.confidence;

  // Scale: explicit unit hint wins; otherwise guess from bounds magnitude.
  let scaleCorrection = 1;
  const signals = { format: fmt, formatConfidence: conv.confidence };
  if (opts.unitHint) {
    scaleCorrection = unitScaleToMeters(opts.unitHint);
    signals.unitHint = opts.unitHint;
    confidence = Math.max(confidence, 0.9);
  } else if (model.bounds) {
    const size = Math.max(
      model.bounds.max[0] - model.bounds.min[0],
      model.bounds.max[1] - model.bounds.min[1],
      model.bounds.max[2] - model.bounds.min[2],
    );
    signals.maxExtent = size;
    // Heuristic unit guess for unit-less formats (STL/OBJ/PLY).
    if (fmt === 'stl' || fmt === 'obj' || fmt === 'ply') {
      if (size > 2000) { scaleCorrection = 0.001; signals.unitGuess = 'mm'; }
      else if (size > 50) { scaleCorrection = 0.01; signals.unitGuess = 'cm'; }
      else signals.unitGuess = 'm';
    }
  }

  // Origin: suggest dropping the model onto the ground plane (min Y → 0), applied
  // after axis correction. Non-destructive: stored, not baked.
  let originCorrection = [0, 0, 0];
  if (model.bounds && opts.groundAlign !== false) {
    originCorrection = [
      -(model.bounds.center[0]),
      -(model.bounds.min[1]),
      -(model.bounds.center[2]),
    ].map((v) => v * scaleCorrection);
  }

  const transform = createImportTransform({
    upAxis, forwardAxis,
    axisCorrection: axisCorrectionQuat(upAxis, forwardAxis),
    scaleCorrection,
    originCorrection,
    confidence,
  });

  const policy = classifyConfidence(confidence);
  model.importTransform = transform;
  model.metadata.orientation = { policy, signals };
  return { transform, policy, signals };
}
