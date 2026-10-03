// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const ACTIVE_BODY_PERFORMANCE_BUDGETS = Object.freeze({
  frameMs: 16.67,
  cpuPbdMs: 2.5,
  gpuInferenceMs: 1.5,
  anatomyMs: 0.75,
  renderingMs: 4,
  bodyCountCpuTarget: 20,
  bodyCountGpuBatchMin: 32,
})

export function getActiveBodyPerformanceBudgetReport(bodyCount = 0, measurements = {}) {
  const count = Math.max(0, bodyCount | 0)
  const estimates = estimateCosts(count, measurements)
  return {
    budgets: { ...ACTIVE_BODY_PERFORMANCE_BUDGETS },
    estimates,
    status: {
      cpuPbd: classify(estimates.cpuPbdMs, ACTIVE_BODY_PERFORMANCE_BUDGETS.cpuPbdMs),
      gpuInference: classify(estimates.gpuInferenceMs, ACTIVE_BODY_PERFORMANCE_BUDGETS.gpuInferenceMs),
      anatomy: classify(estimates.anatomyMs, ACTIVE_BODY_PERFORMANCE_BUDGETS.anatomyMs),
      rendering: classify(estimates.renderingMs, ACTIVE_BODY_PERFORMANCE_BUDGETS.renderingMs),
      frame: classify(estimates.totalMs, ACTIVE_BODY_PERFORMANCE_BUDGETS.frameMs),
    },
    recommendations: buildRecommendations(count, estimates),
  }
}

function estimateCosts(bodyCount, measurements) {
  const averageBones = measurements.averageBones ?? 20
  const physiologyModules = measurements.physiologyModules ?? 9
  const cpuPbdMs = round2(bodyCount * averageBones * 0.0045)
  const gpuInferenceMs = round2(bodyCount >= ACTIVE_BODY_PERFORMANCE_BUDGETS.bodyCountGpuBatchMin ? bodyCount * 0.018 : bodyCount * 0.035)
  const anatomyMs = round2(bodyCount * physiologyModules * 0.006)
  const renderingMs = round2(bodyCount * averageBones * 0.006)
  return {
    bodyCount,
    averageBones,
    physiologyModules,
    cpuPbdMs,
    gpuInferenceMs,
    anatomyMs,
    renderingMs,
    totalMs: round2(cpuPbdMs + gpuInferenceMs + anatomyMs + renderingMs),
  }
}

function classify(value, budget) {
  if (value > budget * 1.25) return 'over'
  if (value > budget) return 'warning'
  return 'ok'
}

function buildRecommendations(bodyCount, estimates) {
  const out = []
  if (bodyCount >= ACTIVE_BODY_PERFORMANCE_BUDGETS.bodyCountGpuBatchMin) out.push('gpu_inference_batching_recommended')
  if (estimates.cpuPbdMs > ACTIVE_BODY_PERFORMANCE_BUDGETS.cpuPbdMs) out.push('reduce_active_pbd_iterations_or_lod_body_count')
  if (estimates.anatomyMs > ACTIVE_BODY_PERFORMANCE_BUDGETS.anatomyMs) out.push('tick_anatomy_at_lower_rate_for_distant_bodies')
  if (estimates.renderingMs > ACTIVE_BODY_PERFORMANCE_BUDGETS.renderingMs) out.push('enable_render_lod_or_instance_debug_geometry')
  if (out.length === 0) out.push('within_budget')
  return out
}

function round2(v) {
  return Math.round(v * 100) / 100
}
