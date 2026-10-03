// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  ADAPTIVE_QUALITY_TIERS,
  AdaptiveQualityGovernor,
} from "../../../core/gpu/AdaptiveQualityGovernor.js";

export { AdaptiveQualityGovernor };

const MINIMUM_HYBRID_SHADOW_LEVEL = 1;

function morphFieldShadowLevel(value, fallback = MINIMUM_HYBRID_SHADOW_LEVEL) {
  const numeric = Number(value);
  const level = Number.isFinite(numeric) ? Math.floor(numeric) : fallback;
  return Math.max(MINIMUM_HYBRID_SHADOW_LEVEL, Math.min(3, level));
}

export const MORPHFIELD_QUALITY_TIERS = Object.freeze(Object.fromEntries(
  ADAPTIVE_QUALITY_TIERS.map((tier) => [tier.name, Object.freeze({
    ...tier,
    // MorphField quality tiers change semantic work, not presentation
    // resolution. A smaller active extent is allowed only when the host makes
    // an explicit renderScale request; Auto never assumes that fewer pixels
    // will improve delivery without a same-workload GPU comparison.
    renderScale: 1,
    resolutionPolicy: 'native',
    resolutionReason: 'unproven-benefit',
    // A hard directional shadow is MorphField's continuity baseline. Generic
    // quality level zero still reduces other renderers, but it must not turn
    // every MorphField shadow off when Auto crosses a tier boundary.
    shadowLevel: morphFieldShadowLevel(tier.shadowLevel),
  })]),
));

export function normalizeQualityDecision(decision, fallback, options = {}) {
  const source = decision || fallback;
  if (!source || typeof source !== 'object') {
    throw new TypeError('MorphField: a quality decision or fallback is required');
  }
  const fallbackDecision = fallback && typeof fallback === 'object' ? fallback : source;
  const tierName = String(source.tier || source.name || fallbackDecision.name || fallbackDecision.tier);
  const base = MORPHFIELD_QUALITY_TIERS[tierName];
  if (!base) throw new RangeError(`MorphField: unknown quality tier ${tierName}`);
  const requestedScale = Math.max(0.25, Math.min(1, Number(source.renderScale ?? base.renderScale)));
  // A generic Engine governor decision is not permission to reduce a
  // MorphField target. The host must mark the request explicitly so an
  // unrelated renderer's scaled tier cannot silently blur this renderer.
  const explicitScale = options.allowResolutionScaling === true
    && source.resolutionPolicy === 'host-explicit'
    && requestedScale < 1;
  const nativeReason = source.resolutionPolicy === 'native' && source.resolutionReason
    ? String(source.resolutionReason)
    : base.resolutionReason;
  return Object.freeze({
    ...fallbackDecision,
    ...base,
    ...source,
    name: tierName,
    tier: tierName,
    renderScale: explicitScale ? requestedScale : 1,
    resolutionPolicy: explicitScale ? 'host-explicit' : 'native',
    resolutionReason: explicitScale
      ? String(source.resolutionReason || 'host-explicit-scale')
      : nativeReason,
    maxTraceSteps: Math.max(8, Math.min(192, Math.floor(Number(source.maxTraceSteps ?? base.maxTraceSteps)))),
    pathBounces: Math.max(1, Math.min(8, Math.floor(Number(source.pathBounces ?? base.pathBounces)))),
    shadowLevel: morphFieldShadowLevel(source.shadowLevel, base.shadowLevel),
  });
}
