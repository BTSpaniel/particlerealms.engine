// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export function createNervousSystemState() {
  const contactSense = estimateContactSense(null)
  return {
    spinalCord: { integrity: 1, conduction: 1, reflexGain: 1, status: 'normal' },
    peripheralNerves: buildPeripheralNerveMap(1, 1, contactSense.regions),
    autonomic: { sympatheticTone: 0.35, parasympatheticTone: 0.45, stress: 0, status: 'balanced' },
    motor: { authority: 1, disruption: 0, activity: 0, fatigueLoad: 0, stanceSupport: 1, swingClearance: 1, grip: 1, brace: 1, protect: 1, recover: 1, status: 'normal' },
    sensory: { pain: 0, proprioception: 1, touchPressure: 0, temperature: 0, vibration: 0, impact: 0, contactCount: 0, status: 'normal' },
    sensoryRegions: buildSensoryRegionMap(1, contactSense.regions),
    physiology: { perfusion: 1, oxygenDelivery: 1, fatigue: 0, pain: 0, adrenaline: 0, motorScale: 1 },
    status: 'normal',
    lastStepDt: 0,
  }
}

export function stepNervousSystem(state, inputs = {}, dt = 0) {
  if (!state) return null
  const neuralMotor = inputs.neuralMotor || null
  const vitalSigns = inputs.vitalSigns || null
  const circulation = inputs.circulation || null
  const bioelectricSignals = inputs.bioelectricSignals || null
  const organDamage = inputs.organDamage || null
  const contactSense = estimateContactSense(inputs.contactTelemetry || null)
  const adrenaline = Math.max(0, Math.min(1, inputs.adrenaline ?? 0))
  const fatigue = clamp01(inputs.fatigue ?? 0)
  const motorActivity = clamp01(inputs.motorActivity ?? 0)
  const neuroDisruption = estimateNeuroDisruption(neuralMotor, bioelectricSignals)
  const systemicStress = estimateSystemicStress(vitalSigns, organDamage, adrenaline)
  const pain = Math.max(estimatePain(organDamage), contactSense.pain * 0.5)
  const perfusion = clamp01(circulation?.systemicPerfusion ?? vitalSigns?.perfusionIndex ?? 1)
  const oxygenDelivery = clamp01(circulation?.oxygenDelivery ?? ((vitalSigns?.spo2 ?? 98) / 98))
  const physiologyScale = clamp01(0.55 + Math.min(perfusion, oxygenDelivery) * 0.45 - fatigue * 0.12)
  state.spinalCord.conduction = round3(Math.max(0, Math.min(1, state.spinalCord.integrity * (1 - neuroDisruption * 0.35))))
  state.spinalCord.reflexGain = round3(Math.max(0, Math.min(1.5, 1 + systemicStress * 0.25 + adrenaline * 0.25 - neuroDisruption * 0.5)))
  state.spinalCord.status = state.spinalCord.conduction < 0.35 ? 'impaired' : 'normal'
  state.autonomic.sympatheticTone = round3(Math.max(0, Math.min(1, 0.35 + adrenaline * 0.45 + systemicStress * 0.35 + pain * 0.2)))
  state.autonomic.parasympatheticTone = round3(Math.max(0, Math.min(1, 0.5 - state.autonomic.sympatheticTone * 0.35 - systemicStress * 0.15)))
  state.autonomic.stress = round3(systemicStress)
  state.autonomic.status = state.autonomic.sympatheticTone > 0.75 ? 'fightFlight' : state.autonomic.parasympatheticTone > 0.65 ? 'restDigest' : 'balanced'
  state.motor.disruption = round3(neuroDisruption)
  const authorityTarget = clamp01(state.spinalCord.conduction * (1 - neuroDisruption * 0.7) * physiologyScale)
  const authorityBlend = dt > 0 ? clamp01(dt * 0.5) : 1
  const previousAuthority = clamp01(state.motor.authority ?? authorityTarget)
  state.motor.authority = round3(previousAuthority + (authorityTarget - previousAuthority) * authorityBlend)
  state.motor.activity = round3(motorActivity)
  state.motor.fatigueLoad = round3(fatigue)
  state.motor.stanceSupport = round3(clamp01(state.motor.authority * (1 - fatigue * 0.16)))
  state.motor.swingClearance = round3(clamp01(state.motor.authority * (1 - fatigue * 0.12)))
  state.motor.grip = round3(clamp01(state.motor.authority * (1 - fatigue * 0.18)))
  state.motor.brace = round3(clamp01(state.motor.authority * (1 + pain * 0.25 + adrenaline * 0.05)))
  state.motor.protect = round3(clamp01(state.motor.authority * (1 + pain * 0.35 + adrenaline * 0.08)))
  state.motor.recover = round3(clamp01(state.motor.authority * (1 - fatigue * 0.1)))
  state.motor.status = state.motor.authority < 0.25 ? 'offline' : state.motor.authority < 0.65 ? 'impaired' : 'normal'
  state.physiology = { perfusion: round3(perfusion), oxygenDelivery: round3(oxygenDelivery), fatigue: round3(fatigue), pain: round3(pain), adrenaline: round3(adrenaline), motorScale: round3(physiologyScale) }
  state.sensory.pain = round3(pain)
  state.sensory.proprioception = round3(Math.max(0, Math.min(1, state.spinalCord.conduction * (1 - neuroDisruption * 0.25))))
  state.sensory.touchPressure = round3(contactSense.touchPressure)
  state.sensory.temperature = round3(contactSense.temperature)
  state.sensory.vibration = round3(contactSense.vibration)
  state.sensory.impact = round3(contactSense.impact)
  state.sensory.contactCount = contactSense.contactCount
  state.sensory.status = state.sensory.proprioception < 0.45 ? 'impaired' : pain > 0.6 ? 'painDominant' : 'normal'
  state.peripheralNerves = buildPeripheralNerveMap(state.motor.authority, state.sensory.proprioception, contactSense.regions)
  state.sensoryRegions = buildSensoryRegionMap(state.sensory.proprioception, contactSense.regions)
  state.status = classifyNervousStatus(state)
  state.lastStepDt = dt
  return state
}

export function getNervousSystemReadback(state) {
  if (!state) return null
  return {
    spinalCord: { ...state.spinalCord },
    peripheralNerves: copyPeripheralNerves(state.peripheralNerves),
    autonomic: { ...state.autonomic },
    motor: { ...state.motor },
    sensory: { ...state.sensory },
    sensoryRegions: copyPeripheralNerves(state.sensoryRegions),
    physiology: { ...(state.physiology || {}) },
    nerveGraph: getNerveGraphReadback(state),
    status: state.status,
  }
}

export function getNerveGraphReadback(state) {
  if (!state) return null
  const nerves = state.peripheralNerves || {}
  const nodes = [{
    id: 'spinalCord',
    region: 'spine',
    role: 'root',
    signalStrength: round3(clamp01(state.spinalCord?.conduction ?? 1)),
    reflexGain: round3(Math.max(0, Math.min(1.5, state.spinalCord?.reflexGain ?? 1))),
    motorIntensity: round3(clamp01(state.motor?.authority ?? 1)),
    sensoryIntensity: round3(clamp01(state.sensory?.proprioception ?? 1)),
    status: state.spinalCord?.status ?? 'normal',
    color: nerveColor(state.spinalCord?.status ?? 'normal', state.spinalCord?.conduction ?? 1),
  }]
  const links = []
  let motorSum = 0
  let sensorySum = 0
  let impairedCount = 0
  for (const region of NERVOUS_REGIONS) {
    const nerve = nerves[region] || {}
    const motor = clamp01(nerve.motor ?? 0)
    const sensory = clamp01(nerve.sensory ?? 0)
    const touch = clamp01(nerve.touch ?? 0)
    const pain = clamp01(nerve.pain ?? 0)
    const signalStrength = round3(Math.max(motor, sensory, touch, pain))
    const status = nerve.status ?? 'normal'
    if (status !== 'normal') impairedCount++
    motorSum += motor
    sensorySum += Math.max(sensory, touch)
    nodes.push({
      id: region,
      region,
      role: 'peripheral',
      signalStrength,
      motorIntensity: round3(motor),
      sensoryIntensity: round3(Math.max(sensory, touch)),
      painIntensity: round3(pain),
      status,
      color: nerveColor(status, signalStrength),
    })
    links.push({
      id: `spinalCord:${region}`,
      from: 'spinalCord',
      to: region,
      channel: 'mixed',
      motorIntensity: round3(motor),
      sensoryIntensity: round3(Math.max(sensory, touch)),
      signalStrength,
      color: nerveColor(status, signalStrength),
    })
  }
  return {
    version: 1,
    root: 'spinalCord',
    nodes,
    links,
    summary: {
      averageMotor: round3(motorSum / NERVOUS_REGIONS.length),
      averageSensory: round3(sensorySum / NERVOUS_REGIONS.length),
      impairedCount,
      status: state.status,
    },
  }
}

function estimateNeuroDisruption(neuralMotor, bioelectricSignals) {
  const mod = neuralMotor?.modifiers || null
  const eegDisruption = bioelectricSignals?.eeg?.disruption ?? 0
  if (!mod) return Math.max(0, Math.min(1, eegDisruption))
  return Math.max(0, Math.min(1,
    eegDisruption * 0.5 +
    (mod.noise ?? 0) * 0.25 +
    (mod.dropout ?? 0) * 0.75 +
    (mod.seizureAmp ?? 0) * 0.45 +
    Math.max(0, 1 - (mod.scale ?? 1)) * 0.65 +
    (neuralMotor.brainDamage ?? 0) * 0.2
  ))
}

function estimateSystemicStress(vitalSigns, organDamage, adrenaline) {
  const spo2Stress = Math.max(0, (94 - (vitalSigns?.spo2 ?? 98)) / 24)
  const pressureStress = Math.max(0, (65 - (vitalSigns?.bloodPressure?.meanArterialPressure ?? 93)) / 35)
  const damageStress = Math.max(organDamage?.shock ?? 0, organDamage?.hypoxia ?? 0, organDamage?.bleedingRate ?? 0)
  return Math.max(0, Math.min(1, adrenaline * 0.35 + spo2Stress * 0.35 + pressureStress * 0.35 + damageStress * 0.5))
}

function estimatePain(organDamage) {
  if (!organDamage) return 0
  const woundPain = Math.min(1, (organDamage.wounds?.length || 0) * 0.12)
  return Math.max(0, Math.min(1, woundPain + (organDamage.bleedingRate ?? 0) * 0.25 + (organDamage.shock ?? 0) * 0.2))
}

const NERVOUS_REGIONS = ['head', 'torso', 'leftArm', 'rightArm', 'leftHand', 'rightHand', 'leftLeg', 'rightLeg', 'leftFoot', 'rightFoot']

function estimateContactSense(contactTelemetry) {
  const regions = createContactRegionMap()
  let contactCount = 0
  let totalPressure = 0
  let maxPressure = 0
  let maxVibration = 0
  let maxImpact = 0
  let maxPain = 0
  for (const record of Object.values(contactTelemetry?.byBone || {})) {
    if (!record || record.missing) continue
    const pressure = clamp01(record.pressure ?? 0)
    const slipRisk = clamp01(record.slipRisk ?? 0)
    const slipSpeed = Math.max(0, record.slipSpeed ?? 0)
    const normalVelocity = record.normalVelocity ?? 0
    const impact = record.contact ? clamp01(Math.max(0, -normalVelocity) / 4 + pressure * 0.35) : 0
    const vibration = record.contact ? clamp01(slipSpeed / 2 + slipRisk * 0.4) : 0
    const pain = record.contact ? clamp01(Math.max(0, pressure - 0.75) * 2 + impact * 0.45 + slipRisk * 0.2) : 0
    const region = regions[regionForContactRecord(record)] || regions.torso
    region.contact = region.contact || !!record.contact
    region.touch = Math.max(region.touch, record.contact ? Math.max(pressure, 0.2) : 0)
    region.pressure = Math.max(region.pressure, pressure)
    region.pain = Math.max(region.pain, pain)
    region.temperature = 0
    region.vibration = Math.max(region.vibration, vibration)
    region.impact = Math.max(region.impact, impact)
    if (record.contact) contactCount++
    totalPressure += pressure
    maxPressure = Math.max(maxPressure, pressure)
    maxVibration = Math.max(maxVibration, vibration)
    maxImpact = Math.max(maxImpact, impact)
    maxPain = Math.max(maxPain, pain)
  }
  return {
    regions,
    contactCount,
    touchPressure: round3(clamp01(Math.max(maxPressure, totalPressure / 2))),
    temperature: 0,
    vibration: round3(maxVibration),
    impact: round3(maxImpact),
    pain: round3(maxPain),
  }
}

function createContactRegionMap() {
  const out = Object.create(null)
  for (const region of NERVOUS_REGIONS) {
    out[region] = { contact: false, touch: 0, pressure: 0, pain: 0, temperature: 0, vibration: 0, impact: 0 }
  }
  return out
}

function regionForContactRecord(record) {
  switch (record.id) {
    case 'head': return 'head'
    case 'leftHand': return 'leftHand'
    case 'rightHand': return 'rightHand'
    case 'leftShin': return 'leftLeg'
    case 'rightShin': return 'rightLeg'
    case 'leftFoot': return 'leftFoot'
    case 'rightFoot': return 'rightFoot'
    default: return 'torso'
  }
}

function buildPeripheralNerveMap(motorAuthority, proprioception, contactRegions = null) {
  const out = Object.create(null)
  for (const region of NERVOUS_REGIONS) {
    const contact = contactRegions?.[region] || null
    out[region] = {
      motor: round3(motorAuthority),
      sensory: round3(proprioception),
      touch: round3(contact?.touch ?? 0),
      pain: round3(contact?.pain ?? 0),
      vibration: round3(contact?.vibration ?? 0),
      impact: round3(contact?.impact ?? 0),
      status: motorAuthority < 0.35 || proprioception < 0.35 ? 'impaired' : 'normal',
    }
  }
  return out
}

function buildSensoryRegionMap(proprioception, contactRegions = null) {
  const out = Object.create(null)
  for (const region of NERVOUS_REGIONS) {
    const contact = contactRegions?.[region] || null
    out[region] = {
      contact: !!contact?.contact,
      touch: round3(contact?.touch ?? 0),
      pressure: round3(contact?.pressure ?? 0),
      pain: round3(contact?.pain ?? 0),
      temperature: round3(contact?.temperature ?? 0),
      proprioception: round3(proprioception),
      vibration: round3(contact?.vibration ?? 0),
      impact: round3(contact?.impact ?? 0),
      status: proprioception < 0.35 ? 'impaired' : (contact?.pain ?? 0) > 0.6 ? 'pain' : 'normal',
    }
  }
  return out
}

function classifyNervousStatus(state) {
  if (state.motor.status === 'offline' || state.spinalCord.status === 'impaired') return 'critical'
  if (state.motor.status === 'impaired' || state.sensory.status !== 'normal' || state.autonomic.status === 'fightFlight') return 'stressed'
  return 'normal'
}

function copyPeripheralNerves(nerves) {
  const out = Object.create(null)
  for (const [id, nerve] of Object.entries(nerves || {})) out[id] = { ...nerve }
  return out
}

function nerveColor(status, signalStrength) {
  const signal = clamp01(signalStrength)
  if (status === 'offline' || status === 'impaired' || signal < 0.35) return '#F44336'
  if (status !== 'normal' || signal < 0.65) return '#FFC107'
  return '#4CAF50'
}

function round3(v) {
  return Math.round(v * 1000) / 1000
}

function clamp01(value) {
  const v = Number(value)
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}
