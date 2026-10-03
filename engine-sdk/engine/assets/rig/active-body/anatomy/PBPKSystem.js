// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export function createPBPKState() {
  return {
    substances: Object.create(null),
    totals: { absorbed: 0, metabolized: 0, excreted: 0, activeBurden: 0 },
    status: 'clear',
    lastStepDt: 0,
  }
}

export function addPBPKDose(state, substanceId, amount, options = {}) {
  if (!state || !substanceId || amount <= 0) return null
  const substance = state.substances[substanceId] || createSubstance(substanceId, options)
  substance.route = options.route || substance.route
  substance.compartments.gut += substance.route === 'ingested' ? amount : 0
  substance.compartments.blood += substance.route === 'injected' ? amount : 0
  substance.compartments.tissue += substance.route === 'inhaled' ? amount * 0.35 : 0
  substance.compartments.blood += substance.route === 'inhaled' ? amount * 0.65 : 0
  substance.doseTotal += amount
  state.substances[substanceId] = substance
  return substance
}

export function stepPBPK(state, inputs = {}, dt = 0) {
  if (!state || dt <= 0) return state
  const circulation = inputs.circulation || null
  const organs = inputs.organs || null
  const perfusion = Math.max(0.05, circulation?.systemicPerfusion ?? 1)
  const liverFunction = organs?.liver?.function ?? 1
  const kidneyFunction = organs?.kidneys?.function ?? 1
  let activeBurden = 0
  let absorbed = 0
  let metabolized = 0
  let excreted = 0
  for (const substance of Object.values(state.substances)) {
    const c = substance.compartments
    const gutToBlood = Math.min(c.gut, c.gut * substance.rates.absorption * dt)
    c.gut -= gutToBlood
    c.blood += gutToBlood
    const bloodToTissue = Math.min(c.blood, c.blood * substance.rates.distribution * perfusion * dt)
    const tissueToBlood = Math.min(c.tissue, c.tissue * substance.rates.redistribution * perfusion * dt)
    c.blood += tissueToBlood - bloodToTissue
    c.tissue += bloodToTissue - tissueToBlood
    const liverClearance = Math.min(c.blood, c.blood * substance.rates.metabolism * liverFunction * dt)
    c.blood -= liverClearance
    c.metabolized += liverClearance
    const renalClearance = Math.min(c.blood, c.blood * substance.rates.excretion * kidneyFunction * dt)
    c.blood -= renalClearance
    c.excreted += renalClearance
    substance.concentration = round3(c.blood + c.tissue * 0.35)
    substance.effect = round3(Math.max(0, Math.min(1, substance.concentration / Math.max(0.001, substance.potency))))
    substance.status = substance.effect > 0.7 ? 'high' : substance.effect > 0.2 ? 'active' : substance.concentration > 0.01 ? 'trace' : 'clear'
    absorbed += gutToBlood
    metabolized += liverClearance
    excreted += renalClearance
    activeBurden += substance.concentration
  }
  state.totals.absorbed = round3((state.totals.absorbed || 0) + absorbed)
  state.totals.metabolized = round3((state.totals.metabolized || 0) + metabolized)
  state.totals.excreted = round3((state.totals.excreted || 0) + excreted)
  state.totals.activeBurden = round3(activeBurden)
  state.status = activeBurden > 1 ? 'toxicLoad' : activeBurden > 0.05 ? 'active' : 'clear'
  state.lastStepDt = dt
  return state
}

export function getPBPKReadback(state) {
  if (!state) return null
  const substances = Object.create(null)
  for (const [id, substance] of Object.entries(state.substances)) {
    substances[id] = {
      id,
      route: substance.route,
      compartments: { ...substance.compartments },
      concentration: substance.concentration,
      effect: substance.effect,
      status: substance.status,
    }
  }
  return {
    substances,
    totals: { ...state.totals },
    status: state.status,
  }
}

function createSubstance(id, options) {
  return {
    id,
    route: options.route || 'ingested',
    potency: options.potency ?? 1,
    doseTotal: 0,
    concentration: 0,
    effect: 0,
    status: 'clear',
    rates: {
      absorption: options.absorptionRate ?? 0.35,
      distribution: options.distributionRate ?? 0.45,
      redistribution: options.redistributionRate ?? 0.18,
      metabolism: options.metabolismRate ?? 0.08,
      excretion: options.excretionRate ?? 0.045,
    },
    compartments: {
      gut: 0,
      blood: 0,
      tissue: 0,
      metabolized: 0,
      excreted: 0,
    },
  }
}

function round3(v) {
  return Math.round(v * 1000) / 1000
}
