// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const EquipSlot = Object.freeze({
  WEAPON: 'weapon',
  ARMOR: 'armor',
  OFFHAND: 'offhand',
  TOOL: 'tool'
})

export function defaultResolveEquipSlot(itemData) {
  if (!itemData) return null
  if (itemData.type === 'weapon') return EquipSlot.WEAPON
  if (itemData.type === 'armor' && itemData.slot === 'offhand') return EquipSlot.OFFHAND
  if (itemData.type === 'armor') return EquipSlot.ARMOR
  if (itemData.type === 'tool') return EquipSlot.TOOL
  return null
}

export class Inventory {
  constructor(maxSlots, options) {
    const config = typeof maxSlots === 'object' && maxSlots !== null ? maxSlots : (options || {})
    this.maxSlots = typeof maxSlots === 'number' ? maxSlots : (config.maxSlots || 20)
    this._itemDefinitions = config.items || config.itemDefinitions || {}
    this._itemNames = config.itemNames || null
    this._resolveEquipSlot = config.resolveEquipSlot || defaultResolveEquipSlot
    this._items = new Map()
    this._equipped = new Map()
  }

  setItemDefinitions(itemDefinitions, itemNames) {
    this._itemDefinitions = itemDefinitions || {}
    if (itemNames) this._itemNames = itemNames
  }

  getItemData(type) {
    return this._itemDefinitions[type] || null
  }

  getItemName(type) {
    const data = this.getItemData(type)
    return this._itemNames?.[type] || data?.name || type
  }

  equip(type) {
    if (!this.has(type)) return { equipped: false, slot: null, unequipped: null }
    const data = this.getItemData(type)
    if (!data) return { equipped: false, slot: null, unequipped: null }

    const slot = this._resolveEquipSlot(data, type, this)
    if (!slot) return { equipped: false, slot: null, unequipped: null }

    const prev = this._equipped.get(slot) || null
    this._equipped.set(slot, type)
    return { equipped: true, slot, unequipped: prev }
  }

  unequip(slot) {
    const prev = this._equipped.get(slot) || null
    this._equipped.delete(slot)
    return prev
  }

  getEquipped(slot) {
    const type = this._equipped.get(slot)
    if (!type) return null
    return { type, data: this.getItemData(type) }
  }

  getAllEquipped() {
    return {
      weapon: this.getEquipped(EquipSlot.WEAPON),
      armor: this.getEquipped(EquipSlot.ARMOR),
      offhand: this.getEquipped(EquipSlot.OFFHAND),
      tool: this.getEquipped(EquipSlot.TOOL)
    }
  }

  add(type, count) {
    const n = count || 1
    const current = this._items.get(type) || 0
    if (!this._items.has(type) && this._items.size >= this.maxSlots) {
      return false
    }
    this._items.set(type, current + n)
    return true
  }

  remove(type, count) {
    const n = count || 1
    const current = this._items.get(type) || 0
    if (current < n) return false
    if (current === n) {
      this._items.delete(type)
    } else {
      this._items.set(type, current - n)
    }
    return true
  }

  has(type, count) {
    return (this._items.get(type) || 0) >= (count || 1)
  }

  getCount(type) {
    return this._items.get(type) || 0
  }

  getAll() {
    const out = []
    for (const [type, count] of this._items) {
      out.push({ type, name: this.getItemName(type), count })
    }
    return out
  }

  get size() {
    return this._items.size
  }

  get totalCount() {
    let sum = 0
    for (const c of this._items.values()) sum += c
    return sum
  }

  clear() {
    this._items.clear()
    this._equipped.clear()
  }
}

export function createInventory(maxSlots, options) {
  return new Inventory(maxSlots, options)
}

export default Inventory
