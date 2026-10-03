// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export function createVitalSignsState() {
  return {
    heartRate: 69,
    respirationRate: 15,
    bloodPressure: { systolic: 120, diastolic: 80, meanArterialPressure: 93 },
    spo2: 98,
    perfusionIndex: 1,
    respiratoryDrive: 0,
    status: 'normal',
    lastStepDt: 0,
  }
}

export function stepVitalSigns(state, inputs = {}, dt = 0) {
  if (!state) return null
  const rhythms = inputs.rhythms || null
  const diaphragm = inputs.diaphragm || null
  const organs = inputs.organs || null
  const fatigue = Math.max(0, Math.min(1, inputs.fatigue ?? 0))
  const adrenaline = Math.max(0, Math.min(1, inputs.adrenaline ?? 0))
  const heartRate = rhythms?.heartBPM ?? state.heartRate
  const respirationRate = diaphragm?.respirationRate || rhythms?.breathRate || state.respirationRate
  const perfusionIndex = estimatePerfusionIndex(organs)
  const lungFunction = estimateLungFunction(organs)
  const respiratoryDrive = Math.max(0, Math.min(1, diaphragm?.contraction ?? 0))
  const systolic = 110 + adrenaline * 28 + fatigue * 12 + Math.max(0, heartRate - 80) * 0.18
  const diastolic = 70 + adrenaline * 14 + fatigue * 7 + Math.max(0, heartRate - 80) * 0.08
  const spo2 = Math.max(70, Math.min(99, 98 - (1 - lungFunction) * 25 - (1 - perfusionIndex) * 8 + respiratoryDrive * 1.5))
  state.heartRate = round1(heartRate)
  state.respirationRate = round1(respirationRate)
  state.bloodPressure = {
    systolic: Math.round(systolic),
    diastolic: Math.round(diastolic),
    meanArterialPressure: Math.round(diastolic + (systolic - diastolic) / 3),
  }
  state.spo2 = round1(spo2)
  state.perfusionIndex = round3(perfusionIndex)
  state.respiratoryDrive = round3(respiratoryDrive)
  state.status = classifyVitalStatus(state)
  state.lastStepDt = dt
  return state
}

export function getVitalSignsReadback(state) {
  if (!state) return null
  return {
    heartRate: state.heartRate,
    respirationRate: state.respirationRate,
    bloodPressure: { ...state.bloodPressure },
    spo2: state.spo2,
    perfusionIndex: state.perfusionIndex,
    respiratoryDrive: state.respiratoryDrive,
    status: state.status,
  }
}

function estimatePerfusionIndex(organs) {
  if (!organs) return 1
  let total = 0
  let count = 0
  for (const organ of Object.values(organs)) {
    if (!organ.vital) continue
    total += organ.perfusion ?? 1
    count++
  }
  return count > 0 ? Math.max(0, Math.min(1, total / count)) : 1
}

function estimateLungFunction(organs) {
  if (!organs) return 1
  const left = organs.leftLung?.function ?? 1
  const right = organs.rightLung?.function ?? 1
  const leftO2 = organs.leftLung?.oxygenation ?? 1
  const rightO2 = organs.rightLung?.oxygenation ?? 1
  return Math.max(0, Math.min(1, (left + right + leftO2 + rightO2) * 0.25))
}

function classifyVitalStatus(state) {
  if (state.spo2 < 85 || state.bloodPressure.meanArterialPressure < 55) return 'critical'
  if (state.spo2 < 92 || state.heartRate > 140 || state.respirationRate > 30) return 'distressed'
  if (state.heartRate > 105 || state.respirationRate > 22) return 'elevated'
  return 'normal'
}

function round1(v) {
  return Math.round(v * 10) / 10
}

function round3(v) {
  return Math.round(v * 1000) / 1000
}
