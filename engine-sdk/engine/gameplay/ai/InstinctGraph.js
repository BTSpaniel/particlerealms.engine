// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export class InstinctGraph {
  constructor(entitySystem, options) {
    const config = options || {}
    this._entities = entitySystem
    this._roleInstincts = config.roleInstincts || {}
    this._culturalOverrides = config.culturalOverrides || {}
    this._emergencyInstinct = config.emergencyInstinct || 'flee'
    this._opinionCache = new Map()
    this._cacheLifetime = config.cacheLifetime || 30000
  }

  setRoleInstincts(roleInstincts) {
    this._roleInstincts = roleInstincts || {}
  }

  setCulturalOverrides(culturalOverrides) {
    this._culturalOverrides = culturalOverrides || {}
  }

  getInstinct(entityId, situationTag) {
    const entity = this._entities.get(entityId)
    if (!entity) return null

    if ((entity.mood?.fear || 0) > 85 || (entity.mood?.stress || 0) > 90) {
      return this._emergencyInstinct
    }

    const archetype = entity.brain?.archetype
    if (archetype && this._roleInstincts[archetype]) {
      const instincts = this._roleInstincts[archetype]
      if (instincts[situationTag]) return instincts[situationTag]
    }

    const cultural = this._getCulturalResponse(entity, situationTag)
    if (cultural) return cultural

    return null
  }

  getDefaultBehavior(entityId) {
    const entity = this._entities.get(entityId)
    if (!entity) return 'idle'

    const archetype = entity.brain?.archetype
    if (archetype && this._roleInstincts[archetype]) {
      return this._roleInstincts[archetype].default || 'idle'
    }

    return 'idle'
  }

  getOpinion(entityId, targetId) {
    const cacheKey = `${entityId}:${targetId}`
    const cached = this._opinionCache.get(cacheKey)
    if (cached && Date.now() - cached.lastUpdated < this._cacheLifetime) {
      return cached
    }

    const entity = this._entities.get(entityId)
    if (!entity) return { opinion: 'unknown', trust: 0, threat: 0, usefulness: 0, lastUpdated: Date.now() }

    const rel = entity.relationships?.edges?.[targetId]
    if (!rel) {
      const result = { opinion: 'stranger', trust: 0, threat: 0, usefulness: 0, lastUpdated: Date.now() }
      this._opinionCache.set(cacheKey, result)
      return result
    }

    let opinion = 'neutral'
    const trust = rel.trust || 0
    const fear = rel.fear || 0
    const love = rel.love || 0
    const hate = rel.hate || 0

    if (love > 50) opinion = 'beloved'
    else if (trust > 40 && (rel.loyalty || 0) > 30) opinion = 'trusted_ally'
    else if (trust > 20) opinion = 'friendly'
    else if (hate > 40) opinion = 'enemy'
    else if (fear > 40) opinion = 'feared'
    else if (trust < -20) opinion = 'distrusted'

    const result = {
      opinion,
      trust,
      threat: Math.max(fear, hate) - trust,
      usefulness: trust + (rel.respect || 0),
      lastUpdated: Date.now()
    }

    this._opinionCache.set(cacheKey, result)
    return result
  }

  compressMemories(entityId) {
    const entity = this._entities.get(entityId)
    if (!entity) return

    const memories = entity.memories?.keyMemories || []
    if (memories.length < 10) return

    const recentWindow = Date.now() - 120000
    const recent = memories.filter(m => m.timestamp > recentWindow)

    const patterns = {}
    for (const m of recent) {
      patterns[m.type] = (patterns[m.type] || 0) + 1
    }

    if (!entity.memories.sensitivities) entity.memories.sensitivities = {}
    for (const [type, count] of Object.entries(patterns)) {
      if (count >= 3) {
        entity.memories.sensitivities[type] = Math.min(1.0, (entity.memories.sensitivities[type] || 0) + 0.1 * count)
      }
    }
  }

  invalidateCache(entityId) {
    for (const key of this._opinionCache.keys()) {
      if (key.startsWith(entityId + ':') || key.endsWith(':' + entityId)) {
        this._opinionCache.delete(key)
      }
    }
  }

  clear() {
    this._opinionCache.clear()
  }

  _getCulturalResponse(entity, situationTag) {
    const culture = entity.identity?.culture
    if (!culture) return null
    const cultural = this._culturalOverrides[culture]
    return cultural ? cultural[situationTag] || null : null
  }
}

export default InstinctGraph