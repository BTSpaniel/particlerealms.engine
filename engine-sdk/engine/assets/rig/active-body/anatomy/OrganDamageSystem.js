// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export function createOrganDamageState() {
  return {
    wounds: [],
    bleedingRate: 0,
    hypoxia: 0,
    shock: 0,
    diseaseBurden: 0,
    status: 'stable',
    lastStepDt: 0,
  }
}

export function applyOrganDamage(state, organs, target, amount, options = {}) {
  if (!state || !organs || amount <= 0) return null
  const organ = resolveTargetOrgan(organs, target)
  if (!organ) return null
  const type = options.type || 'blunt'
  const severity = Math.max(0, amount)
  const integrityLoss = severityToIntegrityLoss(severity, type)
  organ.integrity = round3(Math.max(0, (organ.integrity ?? 1) - integrityLoss))
  if (type === 'hypoxia') organ.oxygenation = round3(Math.max(0, (organ.oxygenation ?? 1) - severity * 0.01))
  if (type === 'shock') organ.perfusion = round3(Math.max(0, (organ.perfusion ?? 1) - severity * 0.012))
  if (type === 'disease') organ.function = round3(Math.max(0, (organ.function ?? 1) - severity * 0.008))
  const bleeding = bleedingFor(type, severity, organ)
  const wound = {
    id: `${organ.id}:${state.wounds.length + 1}`,
    organId: organ.id,
    type,
    severity: round3(severity),
    bleeding: round3(bleeding),
    penetrating: type === 'penetration',
    timestamp: options.timestamp ?? Date.now(),
  }
  state.wounds.push(wound)
  state.bleedingRate = round3(state.bleedingRate + bleeding)
  updateOrganStatus(organ)
  updateDamageStatus(state)
  return wound
}

export function stepOrganDamage(state, organs, inputs = {}, dt = 0) {
  if (!state || dt <= 0) return state
  const circulation = inputs.circulation || null
  const oxygenDelivery = circulation?.oxygenDelivery ?? 1
  const systemicPerfusion = circulation?.systemicPerfusion ?? 1
  state.hypoxia = round3(Math.max(0, Math.min(1, state.hypoxia + (1 - oxygenDelivery) * dt * 0.08 - oxygenDelivery * dt * 0.025)))
  state.shock = round3(Math.max(0, Math.min(1, state.shock + (1 - systemicPerfusion) * dt * 0.09 + state.bleedingRate * dt * 0.015 - systemicPerfusion * dt * 0.02)))
  state.diseaseBurden = round3(Math.max(0, Math.min(1, state.diseaseBurden - dt * 0.002)))
  state.bleedingRate = round3(Math.max(0, state.bleedingRate - dt * 0.002))
  if (organs) {
    for (const organ of Object.values(organs)) updateOrganStatus(organ)
  }
  updateDamageStatus(state)
  state.lastStepDt = dt
  return state
}

export function getOrganDamageReadback(state) {
  if (!state) return null
  return {
    wounds: state.wounds.map(wound => ({ ...wound })),
    bleedingRate: state.bleedingRate,
    hypoxia: state.hypoxia,
    shock: state.shock,
    diseaseBurden: state.diseaseBurden,
    status: state.status,
  }
}

function resolveTargetOrgan(organs, target) {
  if (organs[target]) return organs[target]
  if (target === 'lungs') return organs.leftLung || organs.rightLung || null
  if (target === 'abdomen') return organs.liver || organs.stomach || organs.intestines || null
  if (target === 'torso') return organs.heart || organs.leftLung || organs.liver || null
  return null
}

function severityToIntegrityLoss(severity, type) {
  const scale = type === 'penetration' ? 0.018 : type === 'blunt' ? 0.01 : type === 'disease' ? 0.004 : 0.006
  return Math.max(0, Math.min(0.85, severity * scale))
}

function bleedingFor(type, severity, organ) {
  if (type === 'hypoxia' || type === 'shock' || type === 'disease') return 0
  const vitalMul = organ.vital ? 1.25 : 0.8
  const typeMul = type === 'penetration' ? 0.018 : 0.007
  return Math.max(0, Math.min(1, severity * typeMul * vitalMul))
}

function updateOrganStatus(organ) {
  const integrity = organ.integrity ?? 1
  const perfusion = organ.perfusion ?? 1
  const oxygenation = organ.oxygenation ?? 1
  if (integrity <= 0.15 || perfusion <= 0.2 || oxygenation <= 0.25) organ.status = 'failing'
  else if (integrity < 0.65 || perfusion < 0.7 || oxygenation < 0.75) organ.status = 'injured'
  else organ.status = 'normal'
  organ.function = round3(Math.max(0, Math.min(1.1, integrity * perfusion * oxygenation)))
}

function updateDamageStatus(state) {
  if (state.shock > 0.75 || state.hypoxia > 0.75 || state.bleedingRate > 0.65) state.status = 'critical'
  else if (state.shock > 0.35 || state.hypoxia > 0.35 || state.bleedingRate > 0.2 || state.wounds.length > 0) state.status = 'injured'
  else state.status = 'stable'
}

function round3(v) {
  return Math.round(v * 1000) / 1000
}
