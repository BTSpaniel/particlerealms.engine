// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const ACTIVE_BODY_SIMULATION_TIERS = Object.freeze({
  VISUAL_ONLY: 'visualOnly',
  KINEMATIC: 'kinematic',
  WARM_PBD: 'warmPbd',
  FULL_ACTIVE: 'fullActiveBody',
  FULL_ANATOMY: 'fullAnatomy',
})

export function classifyActiveBodySimulationTier(input = {}) {
  const distance = Number.isFinite(input.distance) ? Math.max(0, input.distance) : Infinity
  const importance = clamp01(input.importance ?? 0)
  const visible = input.visible !== false
  const interactive = !!input.interactive
  const threat = !!input.threat
  const state = input.state || null
  const injured = !!input.injured
  const unstable = state === 'stumble' || state === 'fallen' || state === 'getup' || state === 'ko' || (input.balanceError ?? 0) > 0.58
  if (interactive || threat || injured || state === 'ko') return ACTIVE_BODY_SIMULATION_TIERS.FULL_ANATOMY
  if (unstable || importance >= 0.85 || distance <= 12) return ACTIVE_BODY_SIMULATION_TIERS.FULL_ACTIVE
  if (visible && (importance >= 0.45 || distance <= 24)) return ACTIVE_BODY_SIMULATION_TIERS.WARM_PBD
  if (visible && distance <= 48) return ACTIVE_BODY_SIMULATION_TIERS.KINEMATIC
  return ACTIVE_BODY_SIMULATION_TIERS.VISUAL_ONLY
}

export function buildActiveBodySimulationTierReport(bodies = [], observer = {}) {
  const observerPosition = Array.isArray(observer.position) ? observer.position : [0, 0, 0]
  const counts = Object.fromEntries(Object.values(ACTIVE_BODY_SIMULATION_TIERS).map(tier => [tier, 0]))
  const entries = bodies.map(body => {
    const position = Array.isArray(body.position) ? body.position : null
    const distance = position ? horizontalDistance(observerPosition, position) : Infinity
    const tier = classifyActiveBodySimulationTier({ ...body, distance })
    counts[tier]++
    return {
      entityId: body.entityId,
      tier,
      distance: Number.isFinite(distance) ? round2(distance) : null,
      importance: clamp01(body.importance ?? 0),
      state: body.state ?? null,
      visible: body.visible !== false,
      interactive: !!body.interactive,
      threat: !!body.threat,
      injured: !!body.injured,
    }
  })
  return {
    observerPosition: [...observerPosition],
    counts,
    entries,
    total: entries.length,
  }
}

export function estimateActiveBodyImportance(body = {}) {
  let importance = 0.2
  const state = body.state
  if (state === 'stumble') importance = Math.max(importance, 0.7)
  if (state === 'fallen' || state === 'getup' || state === 'ko') importance = Math.max(importance, 1.0)
  if ((body.balanceError ?? 0) > 0.28) importance = Math.max(importance, 0.6)
  if ((body.balanceError ?? 0) > 0.58) importance = Math.max(importance, 0.9)
  return clamp01(importance)
}

function horizontalDistance(a, b) {
  const ax = a[0] ?? 0
  const az = a[2] ?? a[1] ?? 0
  const bx = b[0] ?? 0
  const bz = b[2] ?? b[1] ?? 0
  return Math.hypot(ax - bx, az - bz)
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
}

function round2(v) {
  return Math.round(v * 100) / 100
}
