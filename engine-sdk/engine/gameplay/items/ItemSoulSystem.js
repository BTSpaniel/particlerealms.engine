// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { randomElement } from '../../core/math/MathRandom.js'

/**
 * ItemSoulSystem — Items slowly gain souls through history.
 *
 * Stages: Normal → Remembered → Resonant → Awakened → Talking → Contract Item
 *
 * Soul growth triggers: named, used often, saved someone, repaired many times,
 * inherited, used in major battles, exposed to domains, part of a contract,
 * emotionally important, connected to death/rescue/betrayal/redemption.
 */

export const SoulStage = Object.freeze({
  NORMAL:     0,
  REMEMBERED: 1,
  RESONANT:   2,
  AWAKENED:   3,
  TALKING:    4,
  CONTRACT:   5
})

export const SOUL_STAGE_NAMES = ['Normal', 'Remembered', 'Resonant', 'Awakened', 'Talking', 'Contract']

export class ItemSoulSystem {
  /**
   * @param {import('../events/index.js').EventGraph} eventGraph
   */
  constructor(eventGraph) {
    this._events = eventGraph
    /** @type {Map<string, object>} Item ID → soul data */
    this._souls = new Map()
  }

  /**
   * Initialize or get soul data for an item.
   * @param {string} itemId
   * @returns {object} Soul data
   */
  getSoul(itemId) {
    if (!this._souls.has(itemId)) {
      this._souls.set(itemId, {
        itemId,
        stage: SoulStage.NORMAL,
        name: null,
        history: [],
        useCount: 0,
        battleCount: 0,
        repairCount: 0,
        savedSomeone: false,
        inherited: false,
        domainExposure: 0,
        contractLinked: false,
        emotionalWeight: 0,
        connectedEvents: [],
        mood: 'dormant',
        preference: null,
        will: null,
        whispers: []
      })
    }
    return this._souls.get(itemId)
  }

  /**
   * Record an item event that may advance its soul.
   *
   * @param {string} itemId
   * @param {string} eventType - 'used', 'named', 'saved_someone', 'repaired', 'inherited', 'battle', 'domain_exposure', 'contract', 'emotional', 'death', 'rescue', 'betrayal', 'redemption'
   * @param {object} [data]
   */
  recordEvent(itemId, eventType, data) {
    const soul = this.getSoul(itemId)

    soul.history.push({ type: eventType, data: data || {}, timestamp: Date.now() })

    switch (eventType) {
      case 'used': soul.useCount++; break
      case 'named': soul.name = data.name; soul.emotionalWeight += 5; break
      case 'saved_someone': soul.savedSomeone = true; soul.emotionalWeight += 20; break
      case 'repaired': soul.repairCount++; break
      case 'inherited': soul.inherited = true; soul.emotionalWeight += 10; break
      case 'battle': soul.battleCount++; soul.emotionalWeight += 3; break
      case 'domain_exposure': soul.domainExposure++; break
      case 'contract': soul.contractLinked = true; soul.emotionalWeight += 15; break
      case 'emotional': soul.emotionalWeight += data.weight || 5; break
      case 'death': soul.emotionalWeight += 25; soul.connectedEvents.push('death'); break
      case 'rescue': soul.emotionalWeight += 15; soul.connectedEvents.push('rescue'); break
      case 'betrayal': soul.emotionalWeight += 10; soul.connectedEvents.push('betrayal'); break
      case 'redemption': soul.emotionalWeight += 20; soul.connectedEvents.push('redemption'); break
    }

    // Check for stage advancement
    const newStage = this._evaluateStage(soul)
    if (newStage > soul.stage) {
      const oldStage = soul.stage
      soul.stage = newStage
      this._onStageAdvance(soul, oldStage, newStage)
    }
  }

  /**
   * Get a whisper from a talking item.
   * @param {string} itemId
   * @returns {string|null}
   */
  getWhisper(itemId) {
    const soul = this.getSoul(itemId)
    if (soul.stage < SoulStage.TALKING) return null

    const whispers = [
      'The item hums faintly.',
      'You feel a warmth from it.',
      'It pulses in your hand.',
      'A memory surfaces... not yours.',
      'It knows this place.',
      'It remembers blood.',
      'It wants to protect you.',
      'It resists. It doesn\'t like this.',
    ]

    if (soul.savedSomeone) whispers.push('It remembers saving a life. It glows softly.')
    if (soul.connectedEvents.includes('death')) whispers.push('It has tasted death. It is heavier now.')
    if (soul.connectedEvents.includes('redemption')) whispers.push('It hums with purpose. Freedom.')

    return randomElement(whispers, Math.random)
  }

  /**
   * Get all items at or above a soul stage.
   * @param {number} minStage
   * @returns {object[]}
   */
  getByStage(minStage) {
    const results = []
    for (const soul of this._souls.values()) {
      if (soul.stage >= minStage) results.push(soul)
    }
    return results
  }

  /** Get all tracked souls */
  getAll() { return [...this._souls.values()] }

  /** Format soul info */
  formatSoul(soul) {
    return [
      `═══ ${soul.name || soul.itemId} ═══`,
      `Stage: ${SOUL_STAGE_NAMES[soul.stage]} (${soul.stage}/5)`,
      `Uses: ${soul.useCount} | Battles: ${soul.battleCount} | Repairs: ${soul.repairCount}`,
      `Emotional weight: ${soul.emotionalWeight}`,
      `Saved someone: ${soul.savedSomeone}`,
      `Inherited: ${soul.inherited}`,
      `Domain exposure: ${soul.domainExposure}`,
      `Connected events: ${soul.connectedEvents.join(', ') || 'none'}`,
      soul.stage >= SoulStage.AWAKENED ? `Mood: ${soul.mood}` : '',
      soul.stage >= SoulStage.TALKING ? `Will: ${soul.will || 'forming'}` : '',
    ].filter(Boolean).join('\n')
  }

  // ── Internal ──

  _evaluateStage(soul) {
    // Stage 1: Remembered — named or used 10+ times
    if (soul.stage < SoulStage.REMEMBERED) {
      if (soul.name || soul.useCount >= 10) return SoulStage.REMEMBERED
    }
    // Stage 2: Resonant — emotional weight > 20 or domain exposure > 3
    if (soul.stage < SoulStage.RESONANT) {
      if (soul.emotionalWeight >= 20 || soul.domainExposure >= 3) return SoulStage.RESONANT
    }
    // Stage 3: Awakened — emotional weight > 50 and multiple connected events
    if (soul.stage < SoulStage.AWAKENED) {
      if (soul.emotionalWeight >= 50 && soul.connectedEvents.length >= 2) return SoulStage.AWAKENED
    }
    // Stage 4: Talking — emotional weight > 80 or savedSomeone + battle count > 5
    if (soul.stage < SoulStage.TALKING) {
      if (soul.emotionalWeight >= 80 || (soul.savedSomeone && soul.battleCount >= 5)) return SoulStage.TALKING
    }
    // Stage 5: Contract — contractLinked and emotional weight > 100
    if (soul.stage < SoulStage.CONTRACT) {
      if (soul.contractLinked && soul.emotionalWeight >= 100) return SoulStage.CONTRACT
    }

    return soul.stage
  }

  _onStageAdvance(soul, from, to) {
    // Set awakened properties
    if (to >= SoulStage.AWAKENED && !soul.mood) {
      soul.mood = soul.savedSomeone ? 'protective' : soul.battleCount > 3 ? 'fierce' : 'curious'
    }
    if (to >= SoulStage.AWAKENED && !soul.preference) {
      soul.preference = soul.connectedEvents.includes('rescue') ? 'builders_and_rescuers' : 'warriors'
    }
    if (to >= SoulStage.TALKING && !soul.will) {
      soul.will = soul.savedSomeone ? 'protect' : soul.connectedEvents.includes('betrayal') ? 'revenge' : 'purpose'
    }

    this._events.emit({
      type: 'itemsoul.stage_advance',
      data: { itemId: soul.itemId, name: soul.name, fromStage: SOUL_STAGE_NAMES[from], toStage: SOUL_STAGE_NAMES[to] },
      tags: ['item_soul', SOUL_STAGE_NAMES[to].toLowerCase()],
      description: `${soul.name || soul.itemId} advanced to ${SOUL_STAGE_NAMES[to]} stage!`
    })
  }

  clear() { this._souls.clear() }
}

export default ItemSoulSystem
