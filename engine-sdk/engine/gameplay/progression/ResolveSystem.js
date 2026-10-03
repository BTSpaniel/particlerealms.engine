// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export class ResolveSystem {
  constructor(eventGraph, contractSystem, options) {
    const config = options || {}
    this._events = eventGraph
    this._contracts = contractSystem
    this._pathWeights = config.pathWeights || {}
  }

  setPathWeights(pathWeights) {
    this._pathWeights = pathWeights || {}
  }

  getPathWeights() {
    return { ...this._pathWeights }
  }

  evaluate(entity) {
    if (!entity || !entity.resolve) return null

    const counters = entity.resolve.counters || {}
    const scores = {}

    for (const [path, weights] of Object.entries(this._pathWeights)) {
      let score = 0
      for (const [counter, weight] of Object.entries(weights)) {
        score += (counters[counter] || 0) * weight
      }
      scores[path] = Math.round(score * 10) / 10
    }

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
    const topPath = sorted[0] && sorted[0][1] > 0 ? sorted[0][0] : null
    const topScore = sorted[0] ? sorted[0][1] : 0
    const secondScore = sorted[1] ? sorted[1][1] : 0
    const intensity = topScore > 0 ? Math.min(1.0, (topScore - secondScore) / Math.max(1, topScore)) : 0

    if (topPath && topPath !== entity.resolve.activePath) {
      const prevPath = entity.resolve.activePath
      entity.resolve.activePath = topPath
      entity.resolve.intensity = intensity
      entity.resolve.paths = scores

      if (this._events) {
        this._events.emit({
          type: 'resolve.path_changed',
          target: entity.id,
          data: { from: prevPath, to: topPath, intensity, scores },
          tags: ['resolve', topPath],
          description: `${entity.identity.name}'s resolve shifts toward ${topPath} (intensity: ${(intensity * 100).toFixed(0)}%)`
        })
      }
    } else {
      entity.resolve.intensity = intensity
      entity.resolve.paths = scores
    }

    let contractReady = null
    if (this._contracts) {
      contractReady = this._contracts.checkAwakening(entity)
    }

    return { scores, activePath: topPath, intensity, contractReady }
  }

  recordBehavior(entity, counter, amount) {
    if (!entity || !entity.resolve) return null

    if (!entity.resolve.counters) entity.resolve.counters = {}
    entity.resolve.counters[counter] = (entity.resolve.counters[counter] || 0) + (amount || 1)

    if (this._events) {
      this._events.emit({
        type: 'resolve.behavior',
        target: entity.id,
        data: { counter, value: entity.resolve.counters[counter] },
        tags: ['resolve'],
        description: `${entity.identity.name}: ${counter} +${amount || 1}`
      })
    }

    return this.evaluate(entity)
  }

  formatReport(entity) {
    const result = this.evaluate(entity)
    if (!result) return '(no resolve data)'

    const lines = [`═══ Resolve: ${entity.identity.name} ═══`]
    lines.push(`Active path: ${result.activePath || 'none'} (intensity: ${(result.intensity * 100).toFixed(0)}%)`)
    lines.push('')
    lines.push('Path scores:')
    for (const [path, score] of Object.entries(result.scores).sort((a, b) => b[1] - a[1])) {
      if (score > 0) {
        const bar = '█'.repeat(Math.min(20, Math.round(score)))
        lines.push(`  ${path.padEnd(18)} ${bar} ${score}`)
      }
    }
    lines.push('')
    lines.push('Behavior counters:')
    for (const [k, v] of Object.entries(entity.resolve.counters || {})) {
      if (v > 0) lines.push(`  ${k}: ${v}`)
    }
    if (result.contractReady) {
      lines.push('')
      lines.push(`⚠ CONTRACT READY: ${result.contractReady.name}`)
    }
    return lines.join('\n')
  }
}

export default ResolveSystem
