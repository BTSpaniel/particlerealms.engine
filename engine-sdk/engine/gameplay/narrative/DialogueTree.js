// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { randomElement } from '../../core/math/MathRandom.js'

/**
 * DialogueTree — Branching conversation system with context-aware choices.
 *
 * Architecture (from Gamasutra "Poor Man's Dialogue Tree"):
 *   Text node  — NPC speaks a line
 *   Choice node — player picks from 1-4 options
 *   Branch node — auto-branches based on variables (trust, knowledge, etc.)
 *   Set node    — changes a dialogue variable
 *   End node    — conversation ends
 *
 * Choices are filtered by conditions (trust level, knowledge, items, etc.).
 * NPCs can refuse to share info (name, secrets) if trust is too low.
 */

let _nextNodeId = 1

export const NodeType = Object.freeze({
  TEXT:   'text',
  CHOICE: 'choice',
  BRANCH: 'branch',
  SET:    'set',
  END:    'end'
})

/**
 * Create a dialogue node.
 */
export function node(type, data) {
  return { id: _nextNodeId++, type, ...data }
}

/**
 * Shorthand builders.
 */
export function textNode(speaker, text, next) {
  return node(NodeType.TEXT, { speaker, text, next })
}

export function choiceNode(prompt, choices) {
  return node(NodeType.CHOICE, { prompt, choices })
}

export function branchNode(variable, branches, fallback) {
  return node(NodeType.BRANCH, { variable, branches, fallback })
}

export function setNode(variable, value, next) {
  return node(NodeType.SET, { variable, value, next })
}

export function endNode(action) {
  return node(NodeType.END, { action })
}

/**
 * DialogueRunner — Executes a dialogue tree, manages state, and produces UI output.
 */
export class DialogueRunner {
  /**
   * @param {import('../../core/EntitySystem.js').EntitySystem} entities
   * @param {import('../events/EventGraph.js').EventGraph} events
   */
  constructor(entities, events) {
    this._entities = entities
    this._events = events

    /** @type {Map<string, object>} Node registry: nodeId → node */
    this._nodes = new Map()

    /** @type {Map<string, *>} Dialogue variables: "entityId:varName" → value */
    this._vars = new Map()

    /** @type {object|null} Current active conversation */
    this.active = null

    /** @type {string[]} IDs of entities eavesdropping on active conversation */
    this._eavesdroppers = []

    /** @type {Map<string, object>} Pending NPC-initiated conversations: npcId → { reason, urgency, cooldown } */
    this._pendingInitiations = new Map()

    /** @type {number} Cooldown between NPC initiations (ms) */
    this._lastInitiation = 0
    this.initiationCooldown = 15000
  }

  /**
   * Register nodes from a dialogue tree.
   * @param {object[]} nodes
   */
  registerNodes(nodes) {
    for (const n of nodes) {
      this._nodes.set(n.id, n)
    }
  }

  /**
   * Get a dialogue variable.
   * @param {string} entityId
   * @param {string} varName
   * @returns {*}
   */
  getVar(entityId, varName) {
    return this._vars.get(`${entityId}:${varName}`)
  }

  /**
   * Set a dialogue variable.
   */
  setVar(entityId, varName, value) {
    this._vars.set(`${entityId}:${varName}`, value)
  }

  /**
   * Check if player knows an NPC's name.
   */
  knowsName(entityId) {
    return this.getVar(entityId, 'knows_name') === true
  }

  /**
   * Start a conversation with an NPC.
   * Returns the first dialogue output (text + choices for player).
   *
   * @param {string} playerId
   * @param {string} npcId
   * @returns {object} { speakerName, text, choices, ended, npcId }
   */
  startConversation(playerId, npcId) {
    const npc = this._entities.get(npcId)
    const player = this._entities.get(playerId)
    if (!npc || !player) return { text: '...', choices: [], ended: true, npcId }

    const rel = npc.relationships.edges[playerId] || {}
    const trust = rel.trust || 0
    const familiarity = rel.familiarity || 0

    // Build context
    const ctx = {
      playerId, npcId, npc, player, trust, familiarity,
      knowsName: this.knowsName(npcId),
      npcHungry: (npc.mood.hunger || 0) > 50,
      npcScared: (npc.mood.fear || 0) > 40,
      npcAnger: (npc.mood.anger || 0) > 30,
      playerHasFood: false // TODO: check inventory
    }

    // Generate dynamic greeting + choices
    const displayName = ctx.knowsName ? npc.identity.name : '???'
    const voice = npc.personality.voiceStyle || npc.dialogue_profile?.voiceLayer || 'neutral'

    // NPC greeting based on trust
    let greeting
    if (trust > 40) greeting = this._voiceLine(voice, 'greet_friendly')
    else if (trust > 0) greeting = this._voiceLine(voice, 'greet_neutral')
    else if (trust < -20) greeting = this._voiceLine(voice, 'greet_hostile')
    else greeting = this._voiceLine(voice, 'greet_stranger')

    // Build available choices based on context
    const choices = this._buildChoices(ctx)

    this.active = { playerId, npcId, ctx }

    this._events.emit({
      type: 'dialogue.start',
      sender: playerId,
      target: npcId,
      tags: ['dialogue', 'social'],
      description: `Started conversation with ${displayName}`
    })

    return {
      speakerName: displayName,
      speakerRole: npc.identity.role,
      text: greeting,
      choices,
      ended: false,
      npcId
    }
  }

  /**
   * Player selects a choice. Returns next dialogue output.
   *
   * @param {string} choiceId
   * @returns {object} { speakerName, text, choices, ended, npcId, effects }
   */
  selectChoice(choiceId) {
    if (!this.active) return { text: '...', choices: [], ended: true }

    const { playerId, npcId, ctx } = this.active
    const npc = this._entities.get(npcId)
    if (!npc) return { text: '...', choices: [], ended: true }

    const displayName = this.knowsName(npcId) ? npc.identity.name : '???'
    const voice = npc.personality.voiceStyle || 'neutral'
    const rel = npc.relationships.edges[playerId] || {}
    const trust = rel.trust || 0
    const effects = {}

    let responseText = ''
    let nextChoices = []
    let ended = false

    switch (choiceId) {
      case 'ask_name': {
        if (trust >= 10 || (rel.familiarity || 0) > 20) {
          this.setVar(npcId, 'knows_name', true)
          responseText = this._voiceLine(voice, 'tell_name', { name: npc.identity.name })
          effects.learnedName = true
          effects.trustChange = 5
          this._modifyRelationship(npcId, playerId, { familiarity: 10, trust: 5 })
        } else if (trust >= -10) {
          responseText = this._voiceLine(voice, 'refuse_name_mild')
          effects.trustChange = -2
          this._modifyRelationship(npcId, playerId, { trust: -2 })
        } else {
          responseText = this._voiceLine(voice, 'refuse_name_hostile')
          effects.trustChange = -5
          this._modifyRelationship(npcId, playerId, { trust: -5 })
          ended = true
        }
        break
      }

      case 'ask_howAreYou': {
        responseText = this._voiceLine(voice, 'how_are_you', { npc })
        effects.trustChange = 2
        this._modifyRelationship(npcId, playerId, { familiarity: 5, trust: 2 })
        break
      }

      case 'ask_whatsWrong': {
        if ((npc.mood.fear || 0) > 30 || (npc.mood.stress || 0) > 40) {
          responseText = this._voiceLine(voice, 'share_worry', { npc })
          effects.trustChange = 5
          this._modifyRelationship(npcId, playerId, { trust: 5, familiarity: 8 })
        } else {
          responseText = this._voiceLine(voice, 'nothing_wrong')
        }
        break
      }

      case 'ask_aboutTown': {
        responseText = this._voiceLine(voice, 'about_town')
        effects.trustChange = 1
        this._modifyRelationship(npcId, playerId, { familiarity: 3 })
        break
      }

      case 'offer_help': {
        responseText = this._voiceLine(voice, 'offer_help_response', { trust })
        effects.trustChange = trust > 0 ? 8 : 3
        this._modifyRelationship(npcId, playerId, { trust: effects.trustChange, loyalty: 3 })
        break
      }

      case 'threaten': {
        responseText = this._voiceLine(voice, 'threatened')
        effects.trustChange = -15
        this._modifyRelationship(npcId, playerId, { trust: -15, fear: 20, hate: 10 })
        ended = true
        break
      }

      case 'goodbye': {
        responseText = this._voiceLine(voice, 'goodbye')
        ended = true
        break
      }

      default: {
        responseText = '...'
        ended = true
      }
    }

    // Update context
    ctx.knowsName = this.knowsName(npcId)
    ctx.trust = (npc.relationships.edges[playerId] || {}).trust || 0

    if (!ended) {
      nextChoices = this._buildChoices(ctx)
      if (nextChoices.length === 0) ended = true
    }

    this._events.emit({
      type: 'dialogue.choice',
      sender: playerId, target: npcId,
      data: { choice: choiceId, response: responseText, effects },
      tags: ['dialogue', 'social'],
      description: `[${choiceId}] → ${responseText.substring(0, 50)}`
    })

    if (ended) this.active = null

    return {
      speakerName: this.knowsName(npcId) ? npc.identity.name : '???',
      speakerRole: npc.identity.role,
      text: responseText,
      choices: nextChoices,
      ended,
      npcId,
      effects
    }
  }

  /**
   * End current conversation.
   */
  endConversation() {
    this.active = null
  }

  // ── Internal ──

  _buildChoices(ctx) {
    const choices = []
    const { trust, knowsName, npcScared, npcHungry } = ctx

    // Always available
    if (!knowsName) {
      choices.push({ id: 'ask_name', text: 'What\'s your name?', icon: '?' })
    }

    choices.push({ id: 'ask_howAreYou', text: 'How are you?', icon: '💬' })

    if (npcScared || npcHungry) {
      choices.push({ id: 'ask_whatsWrong', text: 'Something wrong?', icon: '❓' })
    }

    choices.push({ id: 'ask_aboutTown', text: 'Tell me about this place.', icon: '🏘' })

    if (trust > 10) {
      choices.push({ id: 'offer_help', text: 'Need any help?', icon: '🤝' })
    }

    if (trust < 10) {
      choices.push({ id: 'threaten', text: '[Threaten]', icon: '⚔', dangerous: true })
    }

    choices.push({ id: 'goodbye', text: 'Goodbye.', icon: '👋' })

    // Limit to 4 + goodbye
    return choices.slice(0, 5)
  }

  _modifyRelationship(fromId, toId, changes) {
    const entity = this._entities.get(fromId)
    if (!entity) return
    if (!entity.relationships.edges[toId]) {
      entity.relationships.edges[toId] = { trust: 0, fear: 0, love: 0, hate: 0, loyalty: 0, respect: 0, resentment: 0, familiarity: 0 }
    }
    const rel = entity.relationships.edges[toId]
    for (const [k, v] of Object.entries(changes)) {
      if (rel[k] !== undefined) rel[k] = Math.max(-100, Math.min(100, rel[k] + v))
    }
  }

  _voiceLine(voice, intent, data) {
    const lines = VOICE_LINES[intent]
    if (!lines) return '...'
    const pool = lines[voice] || lines.neutral || ['...']
    let text = randomElement(pool, Math.random)

    // Template substitution
    if (data) {
      if (data.name) text = text.replace('{name}', data.name)
      if (data.npc) {
        if ((data.npc.mood.fear || 0) > 40) text = text.replace('{feeling}', 'scared')
        else if ((data.npc.mood.hunger || 0) > 50) text = text.replace('{feeling}', 'hungry')
        else if ((data.npc.mood.stress || 0) > 40) text = text.replace('{feeling}', 'stressed')
        else text = text.replace('{feeling}', 'fine')
      }
      if (data.trust !== undefined) {
        text = text.replace('{trust_reaction}', data.trust > 30 ? 'I appreciate that.' : 'Hmm. We\'ll see.')
      }
    }
    return text
  }

  // ════════════════════════════════════════════════════════════════
  // NPC-INITIATED CONVERSATIONS
  // ════════════════════════════════════════════════════════════════

  /**
   * Queue an NPC to initiate a conversation with the player.
   * Called by NPC brain, storylets, or world director.
   *
   * @param {string} npcId
   * @param {string} reason - Why they want to talk (e.g. 'warn_danger', 'ask_favor', 'share_rumor', 'confront')
   * @param {number} [urgency=5] - Higher = more likely to interrupt (1-10)
   */
  queueInitiation(npcId, reason, urgency) {
    this._pendingInitiations.set(npcId, {
      reason,
      urgency: urgency || 5,
      queuedAt: Date.now()
    })
  }

  /**
   * Check if any NPC wants to initiate conversation. Call each tick.
   * Returns the highest-urgency pending initiation, or null.
   *
   * @param {object} playerPos - { wx, wz }
   * @param {number} maxDist - Max distance for NPC to approach
   * @returns {object|null} { npcId, reason, urgency } or null
   */
  checkInitiations(playerPos, maxDist) {
    if (this.active) return null
    if (Date.now() - this._lastInitiation < this.initiationCooldown) return null

    let best = null, bestUrgency = 0

    for (const [npcId, data] of this._pendingInitiations) {
      const entity = this._entities.get(npcId)
      if (!entity || !entity.identity.alive) { this._pendingInitiations.delete(npcId); continue }

      // Check proximity
      const ex = entity._worldX !== undefined ? entity._worldX : 15
      const ez = entity._worldZ !== undefined ? entity._worldZ : 15
      const dist = Math.sqrt((playerPos.wx - ex) ** 2 + (playerPos.wz - ez) ** 2)
      if (dist > maxDist) continue

      if (data.urgency > bestUrgency) {
        best = { npcId, ...data }
        bestUrgency = data.urgency
      }
    }

    return best
  }

  /**
   * Start an NPC-initiated conversation. NPC speaks first, player responds.
   *
   * @param {string} npcId
   * @param {string} reason
   * @returns {object} { speakerName, text, choices, ended, npcId, initiatedBy }
   */
  startNPCInitiated(npcId, reason) {
    this._pendingInitiations.delete(npcId)
    this._lastInitiation = Date.now()

    const npc = this._entities.get(npcId)
    if (!npc) return { text: '...', choices: [], ended: true, npcId }

    const voice = npc.personality.voiceStyle || 'neutral'
    const displayName = this.knowsName(npcId) ? npc.identity.name : '???'
    const rel = npc.relationships.edges['player'] || {}
    const trust = rel.trust || 0

    // NPC opening line based on reason
    const openingLines = {
      warn_danger: { text: this._voiceLine(voice, 'npc_warn_danger'), responseChoices: ['ask_details', 'thank_warning', 'dismiss', 'goodbye'] },
      ask_favor: { text: this._voiceLine(voice, 'npc_ask_favor'), responseChoices: ['accept_favor', 'refuse_favor', 'ask_details', 'goodbye'] },
      share_rumor: { text: this._voiceLine(voice, 'npc_share_rumor'), responseChoices: ['ask_details', 'who_told_you', 'dont_care', 'goodbye'] },
      confront: { text: this._voiceLine(voice, 'npc_confront'), responseChoices: ['apologize', 'defend_self', 'threaten', 'goodbye'] },
      greet_player: { text: this._voiceLine(voice, trust > 20 ? 'greet_friendly' : 'greet_neutral'), responseChoices: ['ask_name', 'ask_howAreYou', 'ask_aboutTown', 'goodbye'] },
    }

    const opening = openingLines[reason] || openingLines.greet_player
    const choices = this._buildResponseChoices(opening.responseChoices, npc, trust)

    this.active = { playerId: 'player', npcId, ctx: { playerId: 'player', npcId, npc, trust, knowsName: this.knowsName(npcId) } }
    this._detectEavesdroppers(npcId)

    this._events.emit({
      type: 'dialogue.npc_initiated',
      sender: npcId, target: 'player',
      data: { reason, eavesdroppers: this._eavesdroppers },
      tags: ['dialogue', 'social'],
      description: `${displayName} approaches you to talk (${reason}).`
    })

    return {
      speakerName: displayName,
      speakerRole: npc.identity.role,
      text: opening.text,
      choices,
      ended: false,
      npcId,
      initiatedBy: npcId,
      eavesdroppers: this._eavesdroppers.map(id => {
        const e = this._entities.get(id)
        return { id, name: this.knowsName(id) ? e?.identity.name : '???', role: e?.identity.role }
      })
    }
  }

  /**
   * Build player response choices for NPC-initiated conversations.
   */
  _buildResponseChoices(choiceIds, npc, trust) {
    const RESPONSE_LABELS = {
      ask_details: { text: 'Tell me more.', icon: '❓' },
      thank_warning: { text: 'Thanks for the warning.', icon: '👍' },
      dismiss: { text: 'I don\'t care.', icon: '😐' },
      accept_favor: { text: 'I\'ll help.', icon: '🤝' },
      refuse_favor: { text: 'Not my problem.', icon: '✋' },
      who_told_you: { text: 'Who told you that?', icon: '🔍' },
      dont_care: { text: 'Not interested.', icon: '😐' },
      apologize: { text: 'I\'m sorry.', icon: '🙏' },
      defend_self: { text: 'I had my reasons.', icon: '💬' },
      ask_name: { text: 'What\'s your name?', icon: '?' },
      ask_howAreYou: { text: 'How are you?', icon: '💬' },
      ask_aboutTown: { text: 'Tell me about this place.', icon: '🏘' },
      threaten: { text: '[Threaten]', icon: '⚔', dangerous: true },
      goodbye: { text: 'Goodbye.', icon: '👋' }
    }

    return choiceIds.map(id => ({ id, ...RESPONSE_LABELS[id] })).filter(Boolean).slice(0, 5)
  }

  // ════════════════════════════════════════════════════════════════
  // EAVESDROPPERS & GROUP CONVERSATIONS
  // ════════════════════════════════════════════════════════════════

  /**
   * Detect nearby NPCs who can overhear the conversation.
   * They may react, interject, or remember what was said.
   */
  _detectEavesdroppers(mainNpcId) {
    this._eavesdroppers = []
    const mainNpc = this._entities.get(mainNpcId)
    if (!mainNpc) return

    const mainLoc = mainNpc.location?.current

    for (const entity of this._entities.all()) {
      if (entity.id === mainNpcId || entity.id === 'player') continue
      if (!entity.identity.alive) continue

      // Same location = can hear
      if (entity.location?.current === mainLoc) {
        this._eavesdroppers.push(entity.id)
      }
    }
  }

  /**
   * Get eavesdropper reactions to a conversation choice.
   * Some NPCs may interject if the topic affects them.
   *
   * @param {string} choiceId
   * @returns {object[]} Array of { entityId, name, reaction, text }
   */
  getEavesdropperReactions(choiceId) {
    const reactions = []

    for (const eid of this._eavesdroppers) {
      const entity = this._entities.get(eid)
      if (!entity) continue

      const voice = entity.personality?.voiceStyle || 'neutral'
      const rel = entity.relationships?.edges?.['player'] || {}
      const trust = rel.trust || 0

      // Chance to react based on personality
      const reactChance = (entity.mood?.curiosity || 50) / 200 + (choiceId === 'threaten' ? 0.5 : 0)
      if (Math.random() > reactChance) continue

      let reaction = null

      if (choiceId === 'threaten') {
        if (trust > 20) {
          reaction = { type: 'defend_player_target', text: this._voiceLine(voice, 'eavesdrop_defend') }
        } else if ((entity.brain?.archetype === 'guard')) {
          reaction = { type: 'intervene', text: this._voiceLine(voice, 'eavesdrop_guard_intervene') }
        } else {
          reaction = { type: 'scared', text: this._voiceLine(voice, 'eavesdrop_scared') }
        }
      } else if (choiceId === 'ask_name') {
        // Eavesdropper also learns the name if NPC shares it
        reaction = { type: 'overheard_name', text: null }
      } else if (choiceId === 'apologize') {
        if (trust > 10) {
          reaction = { type: 'sympathize', text: this._voiceLine(voice, 'eavesdrop_sympathize') }
        }
      }

      if (reaction) {
        // Create memory for eavesdropper
        this._entities.addMemory(eid, {
          type: 'overheard',
          summary: `Overheard conversation between player and ${this.active?.npcId}. Player chose: ${choiceId}.`,
          importance: choiceId === 'threaten' ? 0.8 : 0.3,
          emotion: choiceId === 'threaten' ? 'fear' : 'curiosity'
        })

        reactions.push({
          entityId: eid,
          name: this.knowsName(eid) ? entity.identity.name : '???',
          role: entity.identity.role,
          ...reaction
        })
      }
    }

    return reactions
  }

  /**
   * Check if a specific NPC wants to interject into the active conversation.
   * Returns an interjection or null.
   *
   * @param {string} entityId
   * @returns {object|null} { text, intent }
   */
  checkInterjection(entityId) {
    if (!this.active) return null
    if (!this._eavesdroppers.includes(entityId)) return null

    const entity = this._entities.get(entityId)
    if (!entity) return null

    const voice = entity.personality?.voiceStyle || 'neutral'
    const mainNpc = this._entities.get(this.active.npcId)

    // Guards interject if they hear crime discussion
    if (entity.brain?.archetype === 'guard') {
      return { text: this._voiceLine(voice, 'guard_interject'), intent: 'authority' }
    }

    // Friends of the NPC being talked to might join
    const relToMain = entity.relationships?.edges?.[this.active.npcId]
    if (relToMain && (relToMain.loyalty || 0) > 30) {
      return { text: this._voiceLine(voice, 'friend_interject'), intent: 'support' }
    }

    return null
  }
}

// ── Additional voice lines for NPC-initiated and eavesdropping ──
const NPC_INIT_LINES = {
  npc_warn_danger: {
    nervous: ['H-hey! You need to be careful. Something bad is happening.', 'Wait! Don\'t go that way!'],
    blunt: ['Heads up. Danger ahead.', 'You should know — trouble\'s coming.'],
    gentle: ['Excuse me... I wanted to warn you. Please be careful.', 'I don\'t mean to worry you, but...'],
    childish: ['Hey! Hey! Scary things over there!', 'Don\'t go there! It\'s bad!'],
    neutral: ['You should know — there\'s danger nearby.', 'Be warned.']
  },
  npc_ask_favor: {
    nervous: ['Um... could you... I need help with something.', 'I hate to ask, but...'],
    blunt: ['I need a favor.', 'Help me with something.'],
    gentle: ['I\'m sorry to bother you, but could you help me?', 'If you have a moment...'],
    childish: ['Can you help me? Pleeease?', 'I need help!'],
    neutral: ['I could use your help.', 'Got a minute?']
  },
  npc_share_rumor: {
    sarcastic: ['You didn\'t hear this from me, but...', 'Want to hear something interesting?'],
    nervous: ['I probably shouldn\'t tell you this, but...', 'Don\'t tell anyone I said this...'],
    blunt: ['Word is going around.', 'Listen — people are talking.'],
    neutral: ['I heard something you might want to know.', 'There\'s a rumor.']
  },
  npc_confront: {
    aggressive: ['We need to talk. Now.', 'What you did — we\'re not done.'],
    cold: ['I know what you did.', 'Don\'t think I forgot.'],
    nervous: ['I... I saw what happened. Why did you do that?', 'We need to talk about what you did.'],
    neutral: ['I have something to say to you.', 'We should talk.']
  },
  eavesdrop_defend: {
    loyal: ['Hey, leave them alone.', 'Back off.'],
    aggressive: ['You want a problem? Keep talking.', 'Try that again.'],
    neutral: ['That\'s enough.', 'Easy.']
  },
  eavesdrop_guard_intervene: {
    formal: ['What\'s going on here?', 'Break it up.'],
    blunt: ['Problem here?', 'I heard that. Watch yourself.'],
    neutral: ['Keep it civil.', 'I\'m watching.']
  },
  eavesdrop_scared: {
    nervous: ['...!', '*backs away*'],
    childish: ['Scary...', '*hides*'],
    neutral: ['...']
  },
  eavesdrop_sympathize: {
    gentle: ['It\'s okay. We all make mistakes.', '*nods quietly*'],
    neutral: ['...'],
  },
  guard_interject: {
    formal: ['Excuse me. I couldn\'t help but overhear.', 'I\'ll need to ask you both some questions.'],
    blunt: ['Hold it. What\'s this about?', 'I heard everything.'],
    neutral: ['A moment, please.', 'What\'s going on here?']
  },
  friend_interject: {
    loyal: ['I\'m with them on this.', 'They\'re right, you know.'],
    gentle: ['If I may...', 'Can I add something?'],
    childish: ['Me too! I want to talk too!', 'Hey! What about me?'],
    neutral: ['I agree.', 'For what it\'s worth...']
  }
}

// ── Voice lines database ──
const VOICE_LINES = {
  greet_friendly: {
    blunt: ['Hey. Good to see you.', 'You again. What\'s up?'],
    nervous: ['Oh! Hi! I\'m glad you\'re here.', 'H-hello again!'],
    loyal: ['Welcome back. I\'m here.', 'Always good to see you.'],
    sarcastic: ['Oh look, my favorite person.', 'Back for more punishment?'],
    cold: ['You\'re here.', 'Speak.'],
    formal: ['Welcome. How may I help?', 'Good day to you.'],
    gentle: ['Hello, friend. It\'s nice to see you.', 'How are you today?'],
    aggressive: ['What do you need?', 'Talk. I\'m listening.'],
    childish: ['Hey hey! You came back!', 'Hiii!'],
    tired: ['Oh... hey.', 'Mm. Hi.'],
    broken: ['...you\'re still here.', 'Didn\'t expect you.'],
    neutral: ['Hello again.', 'Hey.']
  },
  greet_neutral: {
    blunt: ['Yeah?', 'What.'],
    nervous: ['Um... h-hello?', 'Can I help you...?'],
    childish: ['Hi! Who are you?', 'Hello!'],
    cold: ['...', 'What do you want.'],
    formal: ['Greetings.', 'Yes?'],
    gentle: ['Hello there.', 'Can I help?'],
    neutral: ['Hello.', 'Hey.']
  },
  greet_stranger: {
    blunt: ['Don\'t know you.', 'Who are you?'],
    nervous: ['I don\'t... who are you?', 'S-stay back.'],
    cold: ['I don\'t know you. What do you want.', '...'],
    childish: ['Who are you? Are you nice?', 'Hello stranger!'],
    formal: ['I don\'t believe we\'ve met.', 'State your business.'],
    neutral: ['Do I know you?', 'Yes?']
  },
  greet_hostile: {
    blunt: ['Get lost.', 'We\'re done.'],
    aggressive: ['You have some nerve showing your face.', 'Leave. Now.'],
    cold: ['Don\'t talk to me.', '...'],
    nervous: ['P-please leave me alone.', 'I don\'t want trouble.'],
    neutral: ['I have nothing to say to you.', 'Leave.']
  },
  tell_name: {
    blunt: ['I\'m {name}.', '{name}. Remember it.'],
    nervous: ['M-my name is {name}.', 'I\'m... {name}.'],
    loyal: ['{name}. And I won\'t forget yours.', 'Call me {name}.'],
    childish: ['I\'m {name}! What\'s your name?', '{name}! Nice to meet you!'],
    cold: ['{name}.', '...{name}.'],
    formal: ['My name is {name}. A pleasure.', 'You may call me {name}.'],
    gentle: ['I\'m {name}. It\'s nice to meet you.', '{name}. And you?'],
    sarcastic: ['{name}. Try not to wear it out.', 'The name\'s {name}. Don\'t forget it.'],
    neutral: ['{name}.', 'I\'m {name}.']
  },
  refuse_name_mild: {
    blunt: ['Why should I tell you?', 'Earn it.'],
    nervous: ['I don\'t... I\'d rather not say.', 'Not yet. Sorry.'],
    cold: ['No.', 'That\'s not your business.'],
    childish: ['Mmm... I\'m not supposed to talk to strangers.', 'Nuh-uh! Not telling!'],
    formal: ['I\'d prefer not to share that yet.', 'Perhaps another time.'],
    neutral: ['I don\'t know you well enough.', 'Maybe later.']
  },
  refuse_name_hostile: {
    blunt: ['No. Get lost.', 'Why would I tell YOU?'],
    aggressive: ['You don\'t deserve my name.', 'Leave before I make you.'],
    cold: ['...', 'We\'re done here.'],
    neutral: ['I don\'t trust you.', 'No.']
  },
  how_are_you: {
    blunt: ['I\'m {feeling}. You?', '{feeling}. What about it?'],
    nervous: ['I\'m... {feeling}, I think.', 'Not great, honestly.'],
    childish: ['I\'m {feeling}! Are you okay?', 'Hmm... {feeling}!'],
    gentle: ['I\'m {feeling}. Thank you for asking.', 'It\'s been a {feeling} kind of day.'],
    cold: ['{feeling}.', 'Does it matter?'],
    neutral: ['{feeling}, I suppose.', 'Getting by.']
  },
  share_worry: {
    nervous: ['I\'m scared... something feels wrong here.', 'I don\'t feel safe.'],
    childish: ['I\'m hungry... and scared.', 'Bad things keep happening...'],
    gentle: ['To be honest, I\'m worried. Things haven\'t been good.', 'It\'s getting harder.'],
    tired: ['Everything is... heavy. I\'m tired.', 'I don\'t know how long I can keep going.'],
    broken: ['It doesn\'t get better. It never does.', 'What\'s the point of talking about it?'],
    neutral: ['Things could be better.', 'There\'s trouble.']
  },
  nothing_wrong: {
    blunt: ['I\'m fine.', 'Nothing.'],
    neutral: ['Nothing special.', 'All good.'],
    childish: ['I\'m okay!', 'Nothing!']
  },
  about_town: {
    blunt: ['This place? It\'s rough. Watch your back.', 'Haven. Not as safe as the name implies.'],
    formal: ['Haven is a modest settlement. We survive.', 'There\'s a market, a forge, and the hall. The alleys... best avoided.'],
    childish: ['It\'s kinda scary sometimes, but there are nice people too!', 'The market has bread! And the forge is loud!'],
    gentle: ['Haven is small, but it\'s home. We look out for each other... mostly.', 'There are good people here. And some not so good.'],
    neutral: ['It\'s a town. People live. People struggle.', 'Haven. Named for hope, I think.']
  },
  offer_help_response: {
    nervous: ['R-really? You\'d help? {trust_reaction}', 'I... yes. Please.'],
    gentle: ['That\'s kind of you. {trust_reaction}', 'Thank you. Truly.'],
    childish: ['Yes yes yes! Help please!', 'You\'ll really help? Yay!'],
    cold: ['{trust_reaction}', 'We\'ll see.'],
    neutral: ['{trust_reaction}', 'I could use a hand.']
  },
  threatened: {
    nervous: ['P-please don\'t hurt me!', 'I\'ll go! I\'ll go!'],
    aggressive: ['You want to try that? Come on then.', 'Big mistake.'],
    cold: ['You\'ll regret that.', '...noted.'],
    childish: ['Stop it! Leave me alone!', 'You\'re mean!'],
    neutral: ['Back off.', 'Don\'t.']
  },
  goodbye: {
    blunt: ['Later.', 'Bye.'],
    nervous: ['O-okay... bye.', 'Be careful out there.'],
    loyal: ['Take care. I\'ll be here.', 'Until next time.'],
    childish: ['Byeee!', 'See you later!'],
    gentle: ['Take care of yourself.', 'Goodbye, friend.'],
    cold: ['...', 'Go.'],
    neutral: ['Goodbye.', 'See you.']
  }
}

// Merge NPC-initiated + eavesdrop lines into VOICE_LINES
for (const [intent, voices] of Object.entries(NPC_INIT_LINES)) {
  VOICE_LINES[intent] = voices
}

export default DialogueRunner
