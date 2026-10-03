// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * DomainGraph — Local rule overrides.
 *
 * A domain is a personal law forced onto an area. Domains are rare and earned.
 * They modify rules within a radius, cost stamina/resolve to maintain,
 * and have weaknesses and failure conditions.
 *
 * Domain rules are priority 8 in RuleGraph — they can override local reality
 * but not engine safety or physics.
 */

import { createRule, RuleCategory, RuleEffect } from '../rules/index.js'

let _nextDomainId = 1

export class DomainGraph {
  /**
   * @param {import('../rules/index.js').RuleGraph} ruleGraph
   * @param {import('../events/index.js').EventGraph} eventGraph
   * @param {object} entitySystem
   */
  constructor(ruleGraph, eventGraph, entitySystem, options) {
    const config = options || {}
    this._rules = ruleGraph
    this._events = eventGraph
    this._entities = entitySystem
    this._templates = config.templates || []

    /** @type {Map<string, object>} Active domains by domain ID */
    this._activeDomains = new Map()
  }

  /**
   * Check if an entity qualifies to activate a domain.
   *
   * @param {object} entity
   * @returns {object|null} Domain template or null
   */
  checkEligibility(entity) {
    if (!entity || !entity.resolve) return null

    for (const template of this._templates) {
      if (entity.resolve.activePath !== template.resolvePath) continue
      if (entity.resolve.intensity < 0.5) continue

      // Check resolve counter sum for this path
      const counters = entity.resolve.counters
      let sum = 0
      for (const v of Object.values(counters)) sum += v
      if (sum < template.resolveThreshold) continue

      // Check not already active
      if (this._activeDomains.has(`${entity.id}:${template.id}`)) continue

      return template
    }

    return null
  }

  /**
   * Activate a domain for an entity.
   *
   * @param {string} entityId
   * @param {object} template
   * @param {number} wx - World X center
   * @param {number} wz - World Z center
   * @returns {object} Active domain instance
   */
  activate(entityId, template, wx, wz) {
    const key = `${entityId}:${template.id}`

    const domain = {
      id: `domain_${_nextDomainId++}`,
      templateId: template.id,
      name: template.name,
      owner: entityId,
      centerX: wx,
      centerZ: wz,
      radius: template.radius,
      effects: { ...template.effects },
      cost: { ...template.cost },
      weakness: template.weakness,
      failureCondition: template.failureCondition,
      visualEffect: template.visualEffect,
      activatedAt: Date.now(),
      expiresAt: Date.now() + template.duration,
      active: true,
      ruleIds: []
    }

    // Register domain rules in RuleGraph
    for (const [effect, value] of Object.entries(template.effects)) {
      const rule = createRule({
        name: `domain_${template.id}_${effect}`,
        category: RuleCategory.DOMAIN,
        source: key,
        effect: RuleEffect.MODIFY,
        condition: (action, ctx) => {
          // Only applies within domain radius
          if (!ctx.wx || !ctx.wz) return false
          const dx = ctx.wx - domain.centerX
          const dz = ctx.wz - domain.centerZ
          return (dx * dx + dz * dz) <= (domain.radius * domain.radius)
        },
        apply: (action) => ({ domainEffect: effect, value }),
        tags: ['domain', template.resolvePath],
        description: `${template.name}: ${effect} = ${value}`,
        expiry: domain.expiresAt
      })
      const ruleId = this._rules.addRule(rule)
      domain.ruleIds.push(ruleId)
    }

    this._activeDomains.set(key, domain)

    // Update entity
    const entity = this._entities.get(entityId)
    if (entity) {
      entity.domains.activeDomain = domain.id
      entity.domains.owned.push({
        id: domain.id,
        templateId: template.id,
        name: template.name
      })
    }

    this._events.emit({
      type: 'domain.activated',
      sender: entityId,
      data: {
        domainId: domain.id,
        name: template.name,
        radius: template.radius,
        center: [wx, wz],
        effects: template.effects
      },
      tags: ['domain', template.resolvePath],
      description: `${template.name} activated! ${template.description}`
    })

    return domain
  }

  /**
   * Deactivate a domain (expired, failure, or manual).
   *
   * @param {string} domainKey - "entityId:templateId"
   */
  deactivate(domainKey) {
    const domain = this._activeDomains.get(domainKey)
    if (!domain) return

    // Remove rules
    for (const ruleId of domain.ruleIds) {
      this._rules.removeRule(ruleId)
    }

    domain.active = false
    this._activeDomains.delete(domainKey)

    // Update entity
    const entity = this._entities.get(domain.owner)
    if (entity) {
      entity.domains.activeDomain = null
    }

    this._events.emit({
      type: 'domain.deactivated',
      sender: domain.owner,
      data: { domainId: domain.id, name: domain.name },
      tags: ['domain'],
      description: `${domain.name} faded.`
    })
  }

  /**
   * Update all active domains — check expiry, failure conditions, cost.
   * Call every tick.
   */
  update() {
    const now = Date.now()

    for (const [key, domain] of this._activeDomains) {
      // Expiry
      if (now >= domain.expiresAt) {
        this.deactivate(key)
        continue
      }

      // Stamina cost (TODO: drain entity stamina)
    }
  }

  /**
   * Check if a world position is inside any active domain.
   *
   * @param {number} wx
   * @param {number} wz
   * @returns {object[]} Array of active domains covering this position
   */
  getDomainsAt(wx, wz) {
    const result = []
    for (const domain of this._activeDomains.values()) {
      const dx = wx - domain.centerX
      const dz = wz - domain.centerZ
      if (dx * dx + dz * dz <= domain.radius * domain.radius) {
        result.push(domain)
      }
    }
    return result
  }

  /**
   * Get all active domains.
   * @returns {object[]}
   */
  getActive() {
    return [...this._activeDomains.values()]
  }

  /**
   * Format domain info as text.
   * @param {object} domain
   * @returns {string}
   */
  formatDomain(domain) {
    const remaining = Math.max(0, domain.expiresAt - Date.now())
    return [
      `\u2550\u2550\u2550 ${domain.name} \u2550\u2550\u2550`,
      `Owner: ${domain.owner}`,
      `Radius: ${domain.radius}`,
      `Center: (${domain.centerX}, ${domain.centerZ})`,
      `Effects: ${JSON.stringify(domain.effects)}`,
      `Weakness: ${domain.weakness}`,
      `Time remaining: ${(remaining / 1000).toFixed(1)}s`,
      `Visual: ${domain.visualEffect}`
    ].join('\n')
  }

  /** Clear all domains */
  clear() {
    for (const key of [...this._activeDomains.keys()]) {
      this.deactivate(key)
    }
  }
}

export default DomainGraph
