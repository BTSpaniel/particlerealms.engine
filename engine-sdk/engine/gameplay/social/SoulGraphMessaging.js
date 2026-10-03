// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { uniformDistribution } from '../../core/math/MathRandom.js'

/**
 * SoulGraph Messaging — The social communication network.
 *
 * Messages propagate through relationship channels: direct speech, family gossip,
 * faction reports, town rumors, witnesses. Truth decays and distorts with each hop.
 *
 * A message has: sender, target, topic, truthLevel, urgency, emotion,
 * sourceTrust, location, peopleInvolved, expiryTime, spreadRange.
 */

let _nextMsgId = 1

export const MessageChannel = Object.freeze({
  DIRECT:   'direct',
  FAMILY:   'family_gossip',
  FACTION:  'faction_report',
  RUMOR:    'town_rumor',
  WITNESS:  'witness',
  EMERGENCY:'emergency'
})

/**
 * Create a message.
 */
export function createMessage(config) {
  return Object.freeze({
    id: _nextMsgId++,
    sender: config.sender,
    target: config.target || null,
    topic: config.topic,
    about: config.about || null,
    truthLevel: config.truthLevel !== undefined ? config.truthLevel : 1.0,
    urgency: config.urgency || 0.5,
    emotion: config.emotion || 'neutral',
    sourceTrust: config.sourceTrust || 0.5,
    location: config.location || null,
    peopleInvolved: Object.freeze(config.peopleInvolved || []),
    channel: config.channel || MessageChannel.DIRECT,
    spreadRange: config.spreadRange || 1,
    hops: config.hops || 0,
    maxHops: config.maxHops || 5,
    expiryTime: config.expiryTime || (Date.now() + 300000),
    createdAt: Date.now(),
    data: Object.freeze(config.data || {})
  })
}

export class SoulGraphMessaging {
  /**
   * @param {object} entitySystem
   * @param {import('../events/index.js').EventGraph} eventGraph
   */
  constructor(entitySystem, eventGraph) {
    this._entities = entitySystem
    this._events = eventGraph

    /** @type {object[]} Pending messages to deliver */
    this._pending = []

    /** @type {object[]} Delivered message log */
    this._delivered = []
    this.maxDelivered = 500

    /** @type {number} Truth decay per hop (multiplied) */
    this.truthDecayRate = 0.85

    /** @type {number} Chance of distortion per hop */
    this.distortionChance = 0.15
  }

  /**
   * Send a message. It enters the pending queue for propagation.
   *
   * @param {object} config - Message config (passed to createMessage)
   * @returns {object} The created message
   */
  send(config) {
    const msg = createMessage(config)
    this._pending.push(msg)
    return msg
  }

  /**
   * Process all pending messages — deliver and propagate.
   * Call this once per game tick or every N ticks.
   *
   * @returns {object[]} All delivery results this tick
   */
  processTick() {
    const results = []
    const newPending = []

    for (const msg of this._pending) {
      // Check expiry
      if (Date.now() > msg.expiryTime) continue

      if (msg.target) {
        // Direct message
        const result = this._deliver(msg, msg.target)
        if (result) results.push(result)
      } else {
        // Broadcast — find nearby entities by channel
        const recipients = this._findRecipients(msg)
        for (const recipientId of recipients) {
          const result = this._deliver(msg, recipientId)
          if (result) results.push(result)
        }
      }

      // Propagation: if message has spread range and hops left, create forwarded copies
      if (msg.hops < msg.maxHops && msg.spreadRange > 0) {
        const forwarders = this._findForwarders(msg)
        for (const fwdId of forwarders) {
          const fwdMsg = createMessage({
            ...msg,
            sender: fwdId,
            target: null,
            hops: msg.hops + 1,
            truthLevel: msg.truthLevel * this.truthDecayRate,
            sourceTrust: Math.max(0, msg.sourceTrust - 0.1),
            spreadRange: msg.spreadRange - 1
          })
          newPending.push(fwdMsg)
        }
      }
    }

    this._pending = newPending
    return results
  }

  /**
   * Get delivered message log.
   * @param {number} [limit=20]
   * @returns {object[]}
   */
  getDelivered(limit) {
    return this._delivered.slice(-(limit || 20)).reverse()
  }

  /**
   * Get pending message count.
   * @returns {number}
   */
  get pendingCount() {
    return this._pending.length
  }

  // ── Internal ──

  _deliver(msg, targetId) {
    const target = this._entities.get(targetId)
    if (!target) return null
    if (targetId === msg.sender) return null

    // Check if target trusts sender enough to receive
    const rel = target.relationships.edges[msg.sender]
    const trustThreshold = msg.urgency > 0.8 ? -50 : 0 // Urgent messages get through easier
    if (rel && rel.trust < trustThreshold) return null

    // Apply distortion
    let finalTruth = msg.truthLevel
    if (Math.random() < this.distortionChance && msg.hops > 0) {
      finalTruth *= uniformDistribution(0.7, 1, Math.random)
    }

    const result = {
      messageId: msg.id,
      sender: msg.sender,
      recipient: targetId,
      topic: msg.topic,
      about: msg.about,
      truthLevel: finalTruth,
      emotion: msg.emotion,
      channel: msg.channel,
      hops: msg.hops,
      timestamp: Date.now()
    }

    // Add memory to recipient
    this._entities.addMemory(targetId, {
      type: 'message_received',
      summary: `Heard about ${msg.topic}${msg.about ? ' regarding ' + msg.about : ''} from ${msg.sender} (truth: ${Math.round(finalTruth * 100)}%)`,
      importance: msg.urgency,
      emotion: msg.emotion
    })

    // Emit event
    this._events.emit({
      type: 'social.message_delivered',
      sender: msg.sender,
      target: targetId,
      data: { topic: msg.topic, about: msg.about, truth: finalTruth, channel: msg.channel, hops: msg.hops },
      tags: ['social', 'message', msg.channel],
      description: `${msg.sender} told ${targetId} about "${msg.topic}" (truth: ${Math.round(finalTruth * 100)}%, hops: ${msg.hops})`
    })

    this._delivered.push(result)
    if (this._delivered.length > this.maxDelivered) {
      this._delivered.splice(0, this._delivered.length - this.maxDelivered)
    }

    return result
  }

  _findRecipients(msg) {
    const sender = this._entities.get(msg.sender)
    if (!sender) return []

    const recipients = []
    const senderLoc = sender.location.current

    for (const entity of this._entities.all()) {
      if (entity.id === msg.sender) continue

      const channelMatch = this._matchesChannel(msg.channel, msg.sender, entity)
      const nearby = entity.location.current === senderLoc

      if (channelMatch || (nearby && msg.channel === MessageChannel.DIRECT)) {
        recipients.push(entity.id)
      }
    }

    return recipients.slice(0, 10) // Cap per tick
  }

  _findForwarders(msg) {
    // Entities that received this message and might forward it
    const recent = this._delivered.filter(d => d.messageId === msg.id)
    return recent.map(d => d.recipient).slice(0, 3)
  }

  _matchesChannel(channel, senderId, targetEntity) {
    const sender = this._entities.get(senderId)
    if (!sender) return false

    switch (channel) {
      case MessageChannel.FAMILY:
        return targetEntity.family.familyName === sender.family.familyName
      case MessageChannel.FACTION:
        return targetEntity.faction.memberships.some(m => {
          const fm = sender.faction.memberships
          return fm.some(sm => (sm.factionId || sm) === (m.factionId || m))
        })
      case MessageChannel.RUMOR:
        return targetEntity.location.current === sender.location.current
      case MessageChannel.WITNESS:
        return targetEntity.location.current === sender.location.current
      case MessageChannel.EMERGENCY:
        return true // Emergency reaches everyone in range
      default:
        return false
    }
  }

  /** Clear all pending and delivered */
  clear() {
    this._pending = []
    this._delivered = []
  }
}

export default SoulGraphMessaging
