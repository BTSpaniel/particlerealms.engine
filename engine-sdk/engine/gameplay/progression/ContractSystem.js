// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export class ContractSystem {
  constructor(eventGraph, options) {
    const config = options || {}
    this._events = eventGraph
    this._templates = config.templates || []
    this._activeContracts = new Map()
    this._offered = new Set()
  }

  setTemplates(templates) {
    this._templates = templates || []
  }

  getTemplates() {
    return [...this._templates]
  }

  checkAwakening(entity) {
    if (!entity || !entity.resolve) return null

    for (const template of this._templates) {
      if (this._offered.has(`${entity.id}:${template.id}`)) continue
      if (this._activeContracts.has(`${entity.id}:${template.id}`)) continue

      for (const counter of template.triggerCounters || []) {
        const value = entity.resolve.counters?.[counter] || 0
        if (value >= template.resolveThreshold) {
          return template
        }
      }
    }

    return null
  }

  awaken(entityId, template) {
    const key = `${entityId}:${template.id}`
    this._offered.add(key)

    const contract = {
      id: template.id,
      name: template.name,
      resolvePath: template.resolvePath,
      vow: template.vow,
      limit: template.limit,
      cost: template.cost,
      condition: template.condition,
      effect: template.effect,
      description: template.description,
      awakened: Date.now(),
      active: true
    }

    this._activeContracts.set(key, contract)

    if (this._events) {
      this._events.emit({
        type: 'contract.awaken',
        target: entityId,
        data: { contractId: template.id, name: template.name, vow: template.vow },
        tags: ['contract', 'resolve', template.resolvePath],
        description: `Contract awakened: ${template.name}. "${template.vow}"`
      })
    }

    return contract
  }

  getContracts(entityId) {
    const contracts = []
    for (const [key, contract] of this._activeContracts) {
      if (key.startsWith(entityId + ':') && contract.active) {
        contracts.push(contract)
      }
    }
    return contracts
  }

  formatContract(contract) {
    return [
      `═══ ${contract.name} ═══`,
      `"${contract.vow}"`,
      ``,
      `Effect: ${contract.effect}`,
      `Cost: ${contract.cost}`,
      `Limit: ${contract.limit}`,
      `Condition: ${contract.condition}`,
    ].join('\n')
  }
}

export default ContractSystem
