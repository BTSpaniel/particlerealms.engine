// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export function createBioelectricSignalState() {
  return {
    ecg: { phase: 0, amplitude: 1, rate: 69, rhythm: 'sinus', signal: 0 },
    eeg: { arousal: 0.35, disruption: 0, signal: 0, state: 'awake' },
    emg: { activity: 0, fatigue: 0, signal: 0, tone: 'resting' },
    time: 0,
    lastStepDt: 0,
  }
}

export function stepBioelectricSignals(state, inputs = {}, dt = 0) {
  if (!state) return null
  const rhythms = inputs.rhythms || null
  const neuralMotor = inputs.neuralMotor || null
  const vitalSigns = inputs.vitalSigns || null
  const fatigue = Math.max(0, Math.min(1, inputs.fatigue ?? 0))
  const motorActivity = Math.max(0, Math.min(1, inputs.motorActivity ?? 0))
  const heartPhase = rhythms?.phases?.[0] ?? state.ecg.phase
  const heartRate = vitalSigns?.heartRate ?? rhythms?.heartBPM ?? state.ecg.rate
  const neuroDisruption = estimateNeuralDisruption(neuralMotor)
  state.time += dt
  state.ecg = {
    phase: heartPhase,
    amplitude: round3(0.8 + Math.min(0.4, heartRate / 240)),
    rate: round1(heartRate),
    rhythm: rhythms?.coherence != null && rhythms.coherence < 0.35 ? 'irregular' : 'sinus',
    signal: round3(ecgWave(heartPhase)),
  }
  state.eeg = {
    arousal: round3(Math.max(0, Math.min(1, 0.35 + (inputs.adrenaline ?? 0) * 0.45 + neuroDisruption * 0.35))),
    disruption: round3(neuroDisruption),
    signal: round3(eegWave(state.time, neuroDisruption)),
    state: neuroDisruption > 0.65 ? 'disrupted' : (inputs.adrenaline ?? 0) > 0.5 ? 'alert' : 'awake',
  }
  state.emg = {
    activity: round3(motorActivity),
    fatigue: round3(fatigue),
    signal: round3(Math.max(0, Math.min(1, motorActivity * (1 - fatigue * 0.35) + fatigue * 0.2))),
    tone: motorActivity > 0.7 ? 'active' : motorActivity > 0.25 ? 'postural' : 'resting',
  }
  state.lastStepDt = dt
  return state
}

export function getBioelectricSignalReadback(state) {
  if (!state) return null
  return {
    ecg: { ...state.ecg },
    eeg: { ...state.eeg },
    emg: { ...state.emg },
  }
}

function estimateNeuralDisruption(neuralMotor) {
  const mod = neuralMotor?.modifiers || null
  if (!mod) return 0
  return Math.max(0, Math.min(1,
    (mod.noise ?? 0) * 0.35 +
    (mod.dropout ?? 0) * 0.7 +
    (mod.seizureAmp ?? 0) * 0.45 +
    Math.max(0, 1 - (mod.scale ?? 1)) * 0.5 +
    (neuralMotor.brainDamage ?? 0) * 0.25
  ))
}

function ecgWave(phase) {
  const t = ((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  const p = gaussian(t, 0.65, 0.08) * 0.12
  const q = -gaussian(t, 1.25, 0.035) * 0.18
  const r = gaussian(t, 1.34, 0.025) * 1.0
  const s = -gaussian(t, 1.43, 0.04) * 0.25
  const tw = gaussian(t, 2.15, 0.16) * 0.35
  return p + q + r + s + tw
}

function eegWave(time, disruption) {
  const alpha = Math.sin(time * 10) * 0.35
  const beta = Math.sin(time * 22.5) * 0.18
  const noise = Math.sin(time * 47.3) * disruption * 0.35
  return alpha + beta + noise
}

function gaussian(x, mu, sigma) {
  const d = (x - mu) / sigma
  return Math.exp(-0.5 * d * d)
}

function round1(v) {
  return Math.round(v * 10) / 10
}

function round3(v) {
  return Math.round(v * 1000) / 1000
}
