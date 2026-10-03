// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * NPCBrain — Tiny JavaScript brain for each NPC.
 *
 * Inputs feed drives. The strongest LEGAL drive wins (RuleGraph filters).
 * Memory changes the weights over time.
 *
 * Drives: fight, flee, protect, steal, obey, betray, comfort, digBuild, follow, reportCrime
 */

export const DriveType = Object.freeze({
  FIGHT:        'fight',
  FLEE:         'flee',
  PROTECT:      'protect',
  STEAL:        'steal',
  OBEY:         'obey',
  BETRAY:       'betray',
  COMFORT:      'comfort',
  DIG_BUILD:    'digBuild',
  FOLLOW:       'follow',
  REPORT_CRIME: 'reportCrime'
})

export class NPCBrain {
  /**
   * @param {import('../rules/index.js').RuleGraph} ruleGraph
   * @param {import('../events/index.js').EventGraph} eventGraph
   */
  constructor(ruleGraph, eventGraph, options) {
    const config = options || {}
    this._rules = ruleGraph
    this._events = eventGraph
    this._archetypeBonuses = config.archetypeBonuses || {}
  }

  /**
   * Compute drives for an NPC based on their current state and context.
   *
   * @param {object} entity - Full entity object
   * @param {object} context - { nearbyEntities, threats, opportunities, location }
   * @returns {object} { drives: { drive: score }[], winner: string, action: object }
   */
  think(entity, context) {
    const mood = entity.mood
    const brain = entity.brain
    const personality = entity.personality

    // Base drive scores from mood + brain weights
    const drives = {}

    // Fight: anger + bravery - fear
    drives[DriveType.FIGHT] = (mood.anger || 0) * 0.3 + (mood.bravery || 50) * 0.2 - (mood.fear || 0) * 0.4 + (brain.drives.fight || 0)

    // Flee: fear + pain - bravery
    drives[DriveType.FLEE] = (mood.fear || 0) * 0.5 + (mood.stress || 0) * 0.2 - (mood.bravery || 50) * 0.15 + (brain.drives.flee || 0)

    // Protect: loyalty + empathy + love (toward nearby allies)
    const allyNearby = context.nearbyEntities ? context.nearbyEntities.some(e => {
      const rel = entity.relationships.edges[e.id]
      return rel && (rel.loyalty > 30 || rel.love > 30)
    }) : false
    drives[DriveType.PROTECT] = allyNearby ? ((mood.bravery || 50) * 0.3 + (mood.empathy || 50) * 0.2 + (brain.drives.protect || 0)) : 0

    // Steal: hunger + greed - honesty
    drives[DriveType.STEAL] = (mood.hunger || 0) * 0.3 + (mood.greed || 0) * 0.3 - (mood.honesty || 50) * 0.2 + (brain.drives.steal || 0)

    // Obey: faction loyalty + fear
    drives[DriveType.OBEY] = (mood.fear || 0) * 0.15 + (brain.drives.obey || 0)

    // Betray: resentment + greed + ambition - loyalty
    drives[DriveType.BETRAY] = (mood.resentment || 0) * 0.3 + (mood.greed || 0) * 0.2 + (mood.ambition || 50) * 0.1 - (brain.drives.obey || 0) * 0.5 + (brain.drives.betray || 0)

    // Comfort: empathy + nearby distressed entity
    const distressedNearby = context.nearbyEntities ? context.nearbyEntities.some(e => (e.mood.fear || 0) > 50 || (e.mood.stress || 0) > 50) : false
    drives[DriveType.COMFORT] = distressedNearby ? ((mood.empathy || 50) * 0.3 + (brain.drives.comfort || 0)) : 0

    // Dig/Build: curiosity + brain weight
    drives[DriveType.DIG_BUILD] = (mood.curiosity || 50) * 0.1 + (brain.drives.digBuild || 0)

    // Follow: attachment to a leader/player
    drives[DriveType.FOLLOW] = (brain.drives.follow || 0)

    // Report crime: honesty + duty
    const crimeNearby = context.crimeNearby || false
    drives[DriveType.REPORT_CRIME] = crimeNearby ? ((mood.honesty || 50) * 0.3 + (brain.drives.reportCrime || 0)) : 0

    // Apply archetype bonuses
    if (brain.archetype) {
      const bonuses = this._archetypeBonuses[brain.archetype]
      if (bonuses) {
        for (const [drive, bonus] of Object.entries(bonuses)) {
          drives[drive] = (drives[drive] || 0) + bonus
        }
      }
    }

    // Apply memory-weighted modifications
    this._applyMemoryWeights(entity, drives)

    const instinctDrive = mapInstinctToDrive(context.fastInstinct)
    if (instinctDrive) {
      drives[instinctDrive] = (drives[instinctDrive] || 0) + 25
    }

    // Clamp negatives to 0
    for (const key of Object.keys(drives)) {
      drives[key] = Math.max(0, drives[key])
    }

    // Sort by strength
    const sorted = Object.entries(drives).sort((a, b) => b[1] - a[1])

    // Find strongest LEGAL drive
    let winner = null
    let winnerAction = null

    for (const [drive, score] of sorted) {
      if (score <= 0) break

      const action = { type: drive, actor: entity.id, score }
      const check = this._rules.isAllowed(action, context)

      if (check.allowed) {
        winner = drive
        winnerAction = action
        break
      }
    }

    const motorIntent = makeMotorIntent(winner, context.fastInstinct)

    // Record decision
    if (brain.decisionHistory.length > 20) brain.decisionHistory.shift()
    brain.decisionHistory.push({
      drive: winner,
      score: winner ? drives[winner] : 0,
      instinct: context.fastInstinct || null,
      timestamp: Date.now()
    })
    brain.activeInstinct = winner
    brain.fastInstinct = context.fastInstinct || null
    brain.activeMotorIntent = motorIntent

    return {
      drives: sorted.map(([d, s]) => ({ drive: d, score: Math.round(s * 10) / 10 })),
      winner,
      action: winnerAction,
      motorIntent
    }
  }

  /**
   * Execute the winning drive's action.
   *
   * @param {object} entity
   * @param {string} drive
   * @param {object} context
   * @returns {object|null} Action result
   */
  execute(entity, drive, context) {
    switch (drive) {
      case DriveType.FIGHT:
        return this._executeFight(entity, context)
      case DriveType.FLEE:
        return this._executeFlee(entity, context)
      case DriveType.PROTECT:
        return this._executeProtect(entity, context)
      case DriveType.REPORT_CRIME:
        return this._executeReportCrime(entity, context)
      case DriveType.FOLLOW:
        return { type: 'follow', actor: entity.id }
      case DriveType.COMFORT:
        return { type: 'comfort', actor: entity.id }
      default:
        return { type: drive, actor: entity.id }
    }
  }

  // ── Internal ──

  _applyMemoryWeights(entity, drives) {
    const patterns = entity.memories.compressedPatterns
    if (!patterns) return

    // High betrayal sensitivity → more flee, less trust
    if (patterns.betrayal && patterns.betrayal.count > 2) {
      drives[DriveType.FLEE] += patterns.betrayal.count * 2
      drives[DriveType.BETRAY] += patterns.betrayal.count
    }

    // High crime witness count → more report
    if (patterns.crime_witnessed && patterns.crime_witnessed.count > 1) {
      drives[DriveType.REPORT_CRIME] += patterns.crime_witnessed.count * 3
    }

    // Positive memories boost protect
    if (patterns.family && patterns.family.count > 0) {
      drives[DriveType.PROTECT] += patterns.family.count * 2
    }
  }

  _executeFight(entity, context) {
    const threats = (context.nearbyEntities || []).filter(e => {
      const rel = entity.relationships.edges[e.id]
      return rel && (rel.hate > 20 || rel.fear > 40)
    })
    const target = threats[0]
    if (target) {
      this._events.emit({
        type: 'npc.attack',
        sender: entity.id,
        target: target.id,
        data: { drive: 'fight' },
        tags: ['combat', 'npc'],
        description: `${entity.identity.name} attacks ${target.identity.name}!`
      })
      return { type: 'attack', actor: entity.id, target: target.id }
    }
    return null
  }

  _executeFlee(entity, context) {
    if (!entity._lastFleeTime || (performance.now() - entity._lastFleeTime > 5000)) {
      entity._lastFleeTime = performance.now()
      this._events.emit({
        type: 'npc.flee',
        sender: entity.id,
        data: { drive: 'flee' },
        tags: ['npc'],
        description: `${entity.identity.name} is fleeing!`
      })
    }
    return { type: 'flee', actor: entity.id }
  }

  _executeProtect(entity, context) {
    const allies = (context.nearbyEntities || []).filter(e => {
      const rel = entity.relationships.edges[e.id]
      return rel && (rel.loyalty > 30 || rel.love > 30)
    })
    const ally = allies[0]
    if (ally) {
      if (!entity._lastProtectTime || (performance.now() - entity._lastProtectTime > 5000)) {
        entity._lastProtectTime = performance.now()
        this._events.emit({
          type: 'npc.protect',
          sender: entity.id,
          target: ally.id,
          data: { drive: 'protect' },
          tags: ['social', 'npc'],
          description: `${entity.identity.name} moves to protect ${ally.identity.name}!`
        })
      }
      return { type: 'protect', actor: entity.id, target: ally.id }
    }
    return null
  }

  _executeReportCrime(entity, context) {
    this._events.emit({
      type: 'npc.report_crime',
      sender: entity.id,
      data: { drive: 'reportCrime' },
      tags: ['crime', 'social', 'npc'],
      description: `${entity.identity.name} reports a crime!`
    })
    return { type: 'report_crime', actor: entity.id }
  }
}

function mapInstinctToDrive(instinct) {
  switch (instinct) {
    case 'fight': return DriveType.FIGHT
    case 'flee': return DriveType.FLEE
    case 'protect':
    case 'protect_area':
    case 'heal': return DriveType.PROTECT
    case 'follow': return DriveType.FOLLOW
    case 'report':
    case 'call_guard':
    case 'alert':
    case 'alert_authority': return DriveType.REPORT_CRIME
    case 'steal':
    case 'assess_steal': return DriveType.STEAL
    default: return null
  }
}

function makeMotorIntent(drive, instinct) {
  const active = instinct || drive || null
  return {
    drive: drive || null,
    instinct: instinct || null,
    guard: active === DriveType.PROTECT || active === 'protect_area' || active === 'call_guard',
    brace: active === DriveType.FLEE || active === 'flee' || active === 'sees_danger',
    attack: active === DriveType.FIGHT || active === 'fight',
    recover: active === 'heal',
  }
}

export default NPCBrain
