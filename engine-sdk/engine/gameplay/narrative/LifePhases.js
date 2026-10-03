// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * LifePhases — Controls the origin sequence: birth → childhood → crisis → youth → main game.
 *
 * Each phase runs a sequence of events and storylets, then transitions to the next.
 * The player watches/interacts through text during early phases, then gains full control at Youth.
 */

export const Phase = Object.freeze({
  BACKGROUND: 'background',
  BIRTH:      'birth',
  CHILDHOOD:  'childhood',
  CRISIS:     'crisis',
  YOUTH:      'youth',
  MAIN_GAME:  'main_game'
})

export class LifePhases {
  /**
   * @param {object} systems - { game, eventGraph, entitySystem }
   */
  constructor(systems) {
    this._game = systems.game
    this._events = systems.eventGraph
    this._entities = systems.entitySystem

    this.currentPhase = Phase.BACKGROUND
    this.origin = null
    this.phaseLog = []

    /** @type {function[]} Listeners called on phase change */
    this._onPhaseChange = []

    /** @type {function[]} Listeners called on narrative text */
    this._onNarrative = []
  }

  /**
   * Register a phase change listener.
   * @param {function} fn - (phase, data) => void
   */
  onPhaseChange(fn) { this._onPhaseChange.push(fn) }

  /**
   * Register a narrative text listener (for UI display).
   * @param {function} fn - (text, type) => void
   */
  onNarrative(fn) { this._onNarrative.push(fn) }

  /**
   * Start the origin sequence with generated origin data.
   * @param {object} origin - From OriginGenerator.generateOrigin()
   */
  start(origin) {
    this.origin = origin
    this._setPhase(Phase.BIRTH)
    this._runBirth()
  }

  /**
   * Advance to the next phase (called by UI when player clicks "continue").
   */
  advance() {
    switch (this.currentPhase) {
      case Phase.BIRTH:
        this._setPhase(Phase.CHILDHOOD)
        this._runChildhood()
        break
      case Phase.CHILDHOOD:
        this._setPhase(Phase.CRISIS)
        this._runCrisis()
        break
      case Phase.CRISIS:
        this._setPhase(Phase.YOUTH)
        this._runYouth()
        break
      case Phase.YOUTH:
        this._setPhase(Phase.MAIN_GAME)
        break
    }
  }

  // ── Phase runners ──

  _runBirth() {
    const o = this.origin

    this._narrate(`You are born into the ${o.familyName} family in ${o.townName}.`, 'birth')

    // Name
    this._narrate(o.nameResult.explanation, 'name')
    if (o.nameResult.nickname) {
      this._narrate(`Your nickname is "${o.nameResult.nickname}".`, 'name')
    }

    // Family
    if (o.mother.alive) {
      this._narrate(`Your mother is ${o.mother.name}. She is ${o.mother.traits.join(' and ')}.`, 'family')
    }
    if (o.father.alive) {
      this._narrate(`Your father is ${o.father.name}. He is ${o.father.traits.join(' and ')}.`, 'family')
    }
    if (o.sibling) {
      this._narrate(`You have a sibling: ${o.sibling.name}, age ${o.sibling.age}.`, 'family')
    }
    if (o.familyType === 'orphan') {
      this._narrate('You have no family. You were raised by the town.', 'family')
    }

    // Status
    const statusText = {
      poor: 'Your family is poor. Every day is a struggle.',
      wealthy: 'Your family is wealthy. Comfort is familiar, but so is expectation.',
      merchant: 'Your family runs a modest business. You know the value of things.',
      outcast: 'Your family lives on the edges. The town barely tolerates you.',
      common: 'Your family is ordinary. Neither rich nor poor.'
    }
    this._narrate(statusText[o.socialStatus] || statusText.common, 'status')

    // Emit events
    this._events.emit({
      type: 'player.born',
      target: 'player',
      data: { family: o.familyName, town: o.townName, culture: o.culture, status: o.socialStatus },
      tags: ['birth', 'family', o.socialStatus],
      description: `Born into the ${o.familyName} family in ${o.townName}.`
    })

    this._events.emit({
      type: 'family.name_assigned',
      target: 'player',
      data: { ...o.nameResult },
      tags: ['birth', 'identity'],
      description: o.nameResult.explanation
    })
  }

  _runChildhood() {
    const o = this.origin

    this._narrate('── Childhood ──', 'phase')
    this._narrate('Years pass. You are small, but the world is teaching you.', 'childhood')

    // Memory
    this._narrate(o.memory.text, 'memory')

    // Add memory to player entity
    if (this._entities.has('player')) {
      this._entities.get('player').memories.keyMemories.push({
        type: o.memory.type,
        summary: o.memory.text,
        importance: 0.8,
        emotion: o.memory.type === 'warm' ? 'love' : o.memory.type === 'fear' ? 'fear' : 'neutral',
        timestamp: Date.now()
      })
    }

    this._events.emit({
      type: 'childhood.memory',
      target: 'player',
      data: { memoryType: o.memory.type },
      tags: ['childhood', 'memory'],
      description: o.memory.text
    })

    this._narrate('You learn the shape of your world: who is kind, who is dangerous, where the food is, where to hide.', 'childhood')
  }

  _runCrisis() {
    const o = this.origin

    this._narrate('── First Crisis ──', 'phase')
    this._narrate(o.crisis.text, 'crisis')

    // Emotional impact
    if (this._entities.has('player')) {
      const pe = this._entities.get('player')
      pe.mood.fear = Math.min(100, pe.mood.fear + 30)
      pe.mood.stress = Math.min(100, pe.mood.stress + 25)
    }

    this._events.emit({
      type: 'crisis.' + o.crisis.type,
      target: 'player',
      data: { crisisType: o.crisis.type, town: o.townName },
      tags: ['crisis', ...o.crisis.tags],
      description: o.crisis.text
    })

    this._narrate('Everything changes. You are no longer just a child.', 'crisis')

    // Resolve seed
    if (o.resolveSeed) {
      this._narrate(`Something stirs inside you. A quiet voice: you know what matters now.`, 'resolve')
      this._events.emit({
        type: 'resolve.seed',
        target: 'player',
        data: { seed: o.resolveSeed },
        tags: ['resolve', o.resolveSeed],
        description: `Resolve seed: ${o.resolveSeed}`
      })
    }
  }

  _runYouth() {
    const o = this.origin

    this._narrate('── Youth ──', 'phase')
    this._narrate('You are old enough now. The world is yours to face.', 'youth')
    this._narrate(`You stand in ${o.townName}. The air smells like ${o.townType === 'port' ? 'salt and fish' : o.townType === 'underground' ? 'damp stone' : 'dust and smoke'}.`, 'youth')
    this._narrate('What will you do?', 'youth')

    this._events.emit({
      type: 'player.youth',
      target: 'player',
      data: { town: o.townName },
      tags: ['youth', 'control'],
      description: 'Player gains control.'
    })
  }

  // ── Internal ──

  _setPhase(phase) {
    this.currentPhase = phase
    this.phaseLog.push({ phase, timestamp: Date.now() })
    for (const fn of this._onPhaseChange) fn(phase, this.origin)
  }

  _narrate(text, type) {
    for (const fn of this._onNarrative) fn(text, type || 'general')
  }
}

export default LifePhases
