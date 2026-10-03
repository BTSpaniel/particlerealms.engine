// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

let _nextPowerId = 1

export function createPower(config) {
  return {
    id: config.id || `power_${_nextPowerId++}`,
    name: config.name,
    source: config.source,
    resolvePath: config.resolvePath,
    condition: config.condition || (() => true),
    cost: config.cost || {},
    effect: config.effect || {},
    target: config.target || 'self',
    limit: config.limit || null,
    growthRule: config.growthRule || null,
    failureRule: config.failureRule || null,
    description: config.description || '',
    level: config.level || 1,
    experience: 0,
    active: false,
    lastUsed: 0,
    cooldown: config.cooldown || 0,
    failureCount: 0
  }
}

export class PowerGraph {
  constructor(eventGraph, entitySystem, options) {
    const config = options || {}
    this._events = eventGraph
    this._entities = entitySystem
    this._templates = config.templates || []
  }

  setTemplates(templates) {
    this._templates = templates || []
  }

  getTemplates() {
    return [...this._templates]
  }

  grant(entityId, templateId) {
    const template = this._templates.find(t => t.id === templateId)
    if (!template) return null

    const entity = this._entities?.get ? this._entities.get(entityId) : null
    if (!entity) return null
    if (!entity.powers) entity.powers = {}
    if (!Array.isArray(entity.powers.active)) entity.powers.active = []

    const power = createPower(template)
    entity.powers.active.push(power)

    if (this._events) {
      this._events.emit({
        type: 'power.granted',
        target: entityId,
        data: { powerId: power.id, name: power.name, resolvePath: power.resolvePath },
        tags: ['power', 'progression', power.resolvePath],
        description: `${entity.identity?.name || entity.id || entityId} gained power: ${power.name}`
      })
    }

    return power
  }

  checkGrowth(entity) {
    if (!entity?.powers?.active) return

    for (const power of entity.powers.active) {
      if (!power.growthRule) continue

      const counterValue = entity.resolve?.counters?.[power.growthRule.counter] || 0
      const expectedLevel = Math.floor(counterValue / power.growthRule.perLevel) + 1

      if (expectedLevel > power.level) {
        power.level = expectedLevel
        power.experience = counterValue

        if (this._events) {
          this._events.emit({
            type: 'power.levelup',
            target: entity.id,
            data: { powerId: power.id, name: power.name, level: power.level },
            tags: ['power', 'progression'],
            description: `${entity.identity?.name || entity.id}'s ${power.name} grew to level ${power.level}!`
          })
        }
      }
    }
  }

  checkFailure(entity) {
    if (!entity?.powers?.active) return

    for (const power of entity.powers.active) {
      if (!power.failureRule) continue

      const counterValue = entity.resolve?.counters?.[power.failureRule.counter] || 0
      if (counterValue >= power.failureRule.threshold) {
        power.failureCount++
        power.level = Math.max(1, power.level - 1)

        if (this._events) {
          this._events.emit({
            type: 'power.weakened',
            target: entity.id,
            data: { powerId: power.id, name: power.name, level: power.level, reason: power.failureRule.counter },
            tags: ['power', 'failure'],
            description: `${entity.identity?.name || entity.id}'s ${power.name} weakened! (${power.failureRule.counter})`
          })
        }
      }
    }
  }

  getPowers(entityId) {
    const entity = this._entities?.get ? this._entities.get(entityId) : null
    if (!entity?.powers?.active) return []
    return entity.powers.active
  }

  formatPower(power) {
    return [
      `═══ ${power.name} (Lv.${power.level}) ═══`,
      power.description,
      `Source: ${power.source}`,
      `Cost: ${JSON.stringify(power.cost)}`,
      `Effect: ${JSON.stringify(power.effect)}`,
      `Limit: ${power.limit || 'none'}`,
      `Cooldown: ${power.cooldown}ms`
    ].join('\n')
  }
}

export default PowerGraph