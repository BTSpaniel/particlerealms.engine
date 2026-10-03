// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ItemOwnership — Tracks who owns what, detects theft, handles transfers.
 */

export const TransferType = Object.freeze({
  TRADE:       'trade',
  GIFT:        'gift',
  INHERITANCE: 'inheritance',
  THEFT:       'theft',
  LOOT:        'loot',
  FOUND:       'found',
  CRAFTED:     'crafted'
})

let _nextItemId = 1

export function createOwnedItem(config) {
  return {
    id: config.id || `item_${_nextItemId++}`,
    type: config.type,
    name: config.name || config.type,
    owner: config.owner || null,
    previousOwners: [],
    location: config.location || null,
    value: config.value || 1,
    history: [],
    createdAt: Date.now()
  }
}

export class ItemOwnership {
  /**
   * @param {import('../events/EventGraph.js').EventGraph} eventGraph
   */
  constructor(eventGraph) {
    this._events = eventGraph
    /** @type {Map<string, object>} Item ID → item */
    this._items = new Map()
    /** @type {Map<string, Set<string>>} Owner ID → item IDs */
    this._byOwner = new Map()
  }

  /** Register an owned item */
  register(item) {
    this._items.set(item.id, item)
    if (item.owner) {
      if (!this._byOwner.has(item.owner)) this._byOwner.set(item.owner, new Set())
      this._byOwner.get(item.owner).add(item.id)
    }
    return item.id
  }

  /** Get item by ID */
  get(id) { return this._items.get(id) || null }

  /** Get all items owned by entity */
  getOwnedBy(entityId) {
    const set = this._byOwner.get(entityId)
    if (!set) return []
    return [...set].map(id => this._items.get(id)).filter(Boolean)
  }

  /**
   * Transfer ownership.
   * @param {string} itemId
   * @param {string} newOwner
   * @param {string} transferType - TransferType
   * @returns {boolean}
   */
  transfer(itemId, newOwner, transferType) {
    const item = this._items.get(itemId)
    if (!item) return false

    const oldOwner = item.owner

    // Remove from old owner index
    if (oldOwner) {
      const set = this._byOwner.get(oldOwner)
      if (set) { set.delete(itemId); if (set.size === 0) this._byOwner.delete(oldOwner) }
    }

    // Track history
    if (oldOwner) item.previousOwners.push(oldOwner)
    item.history.push({ from: oldOwner, to: newOwner, type: transferType, timestamp: Date.now() })

    // Set new owner
    item.owner = newOwner
    if (!this._byOwner.has(newOwner)) this._byOwner.set(newOwner, new Set())
    this._byOwner.get(newOwner).add(itemId)

    this._events.emit({
      type: `item.${transferType}`,
      sender: oldOwner,
      target: newOwner,
      data: { itemId, itemName: item.name, transferType },
      tags: ['item', transferType],
      description: `${item.name} transferred: ${oldOwner || 'none'} → ${newOwner} (${transferType})`
    })

    return true
  }

  /**
   * Check if a transfer would be theft.
   * @param {string} itemId
   * @param {string} takerId
   * @returns {boolean}
   */
  isTheft(itemId, takerId) {
    const item = this._items.get(itemId)
    return item && item.owner && item.owner !== takerId
  }

  get size() { return this._items.size }
  clear() { this._items.clear(); this._byOwner.clear() }
}

export default ItemOwnership
