// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export function createCirculatoryState() {
  return {
    bloodVolume: 1,
    cardiacOutput: 5,
    meanArterialPressure: 93,
    systemicPerfusion: 1,
    oxygenDelivery: 1,
    organFlows: Object.create(null),
    status: 'normal',
    lastStepDt: 0,
  }
}

export function stepCirculation(state, inputs = {}, dt = 0) {
  if (!state) return null
  const organs = inputs.organs || null
  const vitals = inputs.vitalSigns || null
  const adrenaline = Math.max(0, Math.min(1, inputs.adrenaline ?? 0))
  const fatigue = Math.max(0, Math.min(1, inputs.fatigue ?? 0))
  const heartRate = vitals?.heartRate ?? 69
  const map = vitals?.bloodPressure?.meanArterialPressure ?? state.meanArterialPressure
  const spo2 = vitals?.spo2 ?? 98
  const strokeVolume = Math.max(35, Math.min(105, 70 + adrenaline * 18 - fatigue * 10))
  const cardiacOutput = heartRate * strokeVolume / 1000
  const pressurePerfusion = Math.max(0, Math.min(1.25, (map - 45) / 55))
  const outputPerfusion = Math.max(0, Math.min(1.25, cardiacOutput / 5))
  const systemicPerfusion = Math.max(0, Math.min(1.2, pressurePerfusion * 0.55 + outputPerfusion * 0.45))
  const oxygenDelivery = Math.max(0, Math.min(1.2, systemicPerfusion * (spo2 / 98)))
  state.cardiacOutput = round2(cardiacOutput)
  state.meanArterialPressure = Math.round(map)
  state.systemicPerfusion = round3(systemicPerfusion)
  state.oxygenDelivery = round3(oxygenDelivery)
  state.status = classifyCirculation(systemicPerfusion, oxygenDelivery, map)
  state.organFlows = updateOrganPerfusion(organs, systemicPerfusion, oxygenDelivery)
  state.lastStepDt = dt
  return state
}

export function getCirculatoryReadback(state) {
  if (!state) return null
  return {
    bloodVolume: state.bloodVolume,
    cardiacOutput: state.cardiacOutput,
    meanArterialPressure: state.meanArterialPressure,
    systemicPerfusion: state.systemicPerfusion,
    oxygenDelivery: state.oxygenDelivery,
    organFlows: copyOrganFlows(state.organFlows),
    graph: getCirculationGraphReadback(state),
    status: state.status,
  }
}

export function getCirculationGraphReadback(state) {
  if (!state) return null
  const systemicPerfusion = clampFlow(state.systemicPerfusion ?? 1)
  const oxygenDelivery = clampFlow(state.oxygenDelivery ?? 1)
  const limbPerfusion = buildLimbPerfusion(systemicPerfusion, oxygenDelivery)
  const nodes = [
    { id: 'heart', region: 'torso', role: 'pump', perfusion: systemicPerfusion, oxygenation: oxygenDelivery, status: state.status, color: flowColor(systemicPerfusion, true) },
    { id: 'torso', region: 'torso', role: 'trunk', perfusion: systemicPerfusion, oxygenation: oxygenDelivery, status: state.status, color: flowColor(systemicPerfusion, true) },
  ]
  const links = [{
    id: 'heart:torso',
    from: 'heart',
    to: 'torso',
    channel: 'arterial',
    flow: systemicPerfusion,
    oxygenation: oxygenDelivery,
    pulse: flowPulse(state),
    color: flowColor(systemicPerfusion, true),
  }]
  for (const [region, perfusion] of Object.entries(limbPerfusion)) {
    nodes.push({
      id: region,
      region,
      role: 'limb',
      perfusion,
      oxygenation: oxygenDelivery,
      status: perfusion < 0.45 ? 'critical' : perfusion < 0.7 ? 'low' : 'normal',
      color: flowColor(perfusion, true),
    })
    links.push({
      id: `torso:${region}:arterial`,
      from: 'torso',
      to: region,
      channel: 'arterial',
      flow: perfusion,
      oxygenation: oxygenDelivery,
      pulse: flowPulse(state),
      color: flowColor(perfusion, true),
    })
    links.push({
      id: `${region}:heart:venous`,
      from: region,
      to: 'heart',
      channel: 'venous',
      flow: round3(perfusion * 0.92),
      oxygenation: round3(oxygenDelivery * 0.78),
      pulse: round3(flowPulse(state) * 0.75),
      color: flowColor(perfusion, false),
    })
  }
  for (const [organId, flow] of Object.entries(state.organFlows || {})) {
    const perfusion = clampFlow(flow?.perfusion ?? systemicPerfusion)
    const oxygenation = clampFlow(flow?.oxygenation ?? oxygenDelivery)
    nodes.push({
      id: `organ:${organId}`,
      region: 'organ',
      role: 'organ',
      organId,
      perfusion,
      oxygenation,
      status: flow?.status ?? 'normal',
      color: flowColor(perfusion, true),
    })
    links.push({
      id: `torso:organ:${organId}:arterial`,
      from: 'torso',
      to: `organ:${organId}`,
      channel: 'arterial',
      flow: perfusion,
      oxygenation,
      pulse: flowPulse(state),
      color: flowColor(perfusion, true),
    })
  }
  return {
    version: 1,
    nodes,
    links,
    limbPerfusion,
    summary: {
      systemicPerfusion,
      oxygenDelivery,
      cardiacOutput: state.cardiacOutput,
      meanArterialPressure: state.meanArterialPressure,
      status: state.status,
    },
  }
}

function updateOrganPerfusion(organs, systemicPerfusion, oxygenDelivery) {
  const flows = Object.create(null)
  if (!organs) return flows
  for (const [id, organ] of Object.entries(organs)) {
    const demand = organDemand(id, organ)
    const flow = Math.max(0, Math.min(1.2, systemicPerfusion * demand))
    organ.perfusion = round3(flow)
    if (organ.container === 'ribCage' || id === 'leftLung' || id === 'rightLung') {
      organ.oxygenation = round3(Math.max(0, Math.min(1.1, oxygenDelivery * (id.includes('Lung') ? 1.02 : 0.98))))
    }
    organ.function = round3(Math.max(0, Math.min(1.1, (organ.integrity ?? 1) * (organ.perfusion ?? 1))))
    organ.status = classifyOrganStatus(organ)
    flows[id] = {
      perfusion: organ.perfusion,
      oxygenation: organ.oxygenation,
      demand,
      status: organ.status,
    }
  }
  return flows
}

function organDemand(id, organ) {
  if (id === 'heart') return 1.12
  if (id === 'leftLung' || id === 'rightLung') return 1.05
  if (id === 'kidneys') return 1.08
  if (organ.vital) return 1
  return 0.86
}

function classifyCirculation(perfusion, oxygenDelivery, map) {
  if (map < 55 || perfusion < 0.45 || oxygenDelivery < 0.45) return 'critical'
  if (perfusion < 0.7 || oxygenDelivery < 0.7) return 'low'
  if (perfusion > 1.1) return 'hyperdynamic'
  return 'normal'
}

function classifyOrganStatus(organ) {
  if ((organ.integrity ?? 1) < 0.35 || (organ.perfusion ?? 1) < 0.35) return 'failing'
  if ((organ.perfusion ?? 1) < 0.7 || (organ.function ?? 1) < 0.7) return 'underperfused'
  return 'normal'
}

function copyOrganFlows(flows) {
  const out = Object.create(null)
  for (const [id, flow] of Object.entries(flows || {})) out[id] = { ...flow }
  return out
}

function buildLimbPerfusion(systemicPerfusion, oxygenDelivery) {
  const base = clampFlow(systemicPerfusion * 0.82 + oxygenDelivery * 0.18)
  return {
    head: round3(clampFlow(base * 1.02)),
    leftArm: round3(clampFlow(base * 0.96)),
    rightArm: round3(clampFlow(base * 0.96)),
    leftHand: round3(clampFlow(base * 0.9)),
    rightHand: round3(clampFlow(base * 0.9)),
    leftLeg: round3(clampFlow(base * 0.94)),
    rightLeg: round3(clampFlow(base * 0.94)),
    leftFoot: round3(clampFlow(base * 0.86)),
    rightFoot: round3(clampFlow(base * 0.86)),
  }
}

function flowColor(flow, arterial) {
  const v = clampFlow(flow)
  if (!arterial) return v < 0.55 ? '#0D47A1' : '#1565C0'
  if (v < 0.45) return '#5D0A0A'
  if (v < 0.7) return '#8B1A1A'
  return '#D32F2F'
}

function flowPulse(state) {
  return round3(Math.max(0.35, Math.min(1.2, (state?.cardiacOutput ?? 5) / 5)))
}

function clampFlow(value) {
  const v = Number(value)
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1.2, v))
}

function round2(v) {
  return Math.round(v * 100) / 100
}

function round3(v) {
  return Math.round(v * 1000) / 1000
}
