// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CitySystem — City templates, population, economy, laws, reputation.
 */

let _nextCityId = 1

export function createCity(config) {
  return {
    id: config.id || `city_${_nextCityId++}`,
    name: config.name,
    type: config.type || 'town',
    culture: config.culture || 'eastern',
    population: config.population || [],
    laws: config.laws || {},
    economy: {
      shops: config.shops || [],
      jobs: config.jobs || [],
      tradeRoutes: config.tradeRoutes || [],
      wealth: config.wealth || 50,
      foodSupply: config.foodSupply || 50
    },
    reputation: config.reputation || {},
    factions: config.factions || [],
    buildings: config.buildings || [],
    locations: config.locations || [],
    description: config.description || ''
  }
}

export class CitySystem {
  /**
   * @param {import('../events/EventGraph.js').EventGraph} eventGraph
   */
  constructor(eventGraph) {
    this._events = eventGraph
    /** @type {Map<string, object>} */
    this._cities = new Map()
  }

  add(city) { this._cities.set(city.id, city); return city.id }
  get(id) { return this._cities.get(id) || null }
  getAll() { return [...this._cities.values()] }

  /** Add entity to city population */
  addResident(cityId, entityId) {
    const city = this._cities.get(cityId)
    if (city && !city.population.includes(entityId)) {
      city.population.push(entityId)
    }
  }

  /** Remove entity from city population */
  removeResident(cityId, entityId) {
    const city = this._cities.get(cityId)
    if (city) city.population = city.population.filter(id => id !== entityId)
  }

  /** Get city reputation toward an entity */
  getReputation(cityId, entityId) {
    const city = this._cities.get(cityId)
    return city ? (city.reputation[entityId] || 0) : 0
  }

  /** Modify city reputation */
  modifyReputation(cityId, entityId, delta) {
    const city = this._cities.get(cityId)
    if (!city) return
    city.reputation[entityId] = Math.max(-100, Math.min(100, (city.reputation[entityId] || 0) + delta))
  }

  /** Get city by name */
  getByName(name) {
    for (const city of this._cities.values()) {
      if (city.name === name) return city
    }
    return null
  }

  get size() { return this._cities.size }
  clear() { this._cities.clear() }
}

export default CitySystem
