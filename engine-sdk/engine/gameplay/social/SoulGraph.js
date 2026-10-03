// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SoulGraph — The social nervous system of the world.
 *
 * Each NPC is a "neuron" node. Relationships are weighted edges.
 * Events are signals. Mood is activation state. Memory is weight change.
 * Actions are outputs. The graph propagates influence through connections.
 *
 * NPC = soul node
 * Relationship = weighted edge (trust, fear, love, hate, loyalty, resentment, familiarity)
 * Event = signal
 * Mood = activation state
 * Memory = weight change
 * Action = output
 */

export class SoulGraph {
  /**
   * @param {object} entitySystem
   * @param {import('../events/index.js').EventGraph} eventGraph
   */
  constructor(entitySystem, eventGraph) {
    this._entities = entitySystem
    this._events = eventGraph
  }

  /**
   * Get all relationship edges for an entity, with computed influence scores.
   *
   * @param {string} entityId
   * @returns {object[]} Array of { targetId, targetName, trust, fear, love, hate, loyalty, resentment, familiarity, influence, dominant }
   */
  getEdges(entityId) {
    const entity = this._entities.get(entityId)
    if (!entity) return []

    const edges = []
    for (const [targetId, rel] of Object.entries(entity.relationships.edges)) {
      const target = this._entities.get(targetId)
      edges.push({
        targetId,
        targetName: target ? target.identity.name : targetId,
        ...rel,
        influence: this._computeInfluence(rel),
        dominant: this._getDominant(rel)
      })
    }

    return edges.sort((a, b) => b.influence - a.influence)
  }

  /**
   * Propagate a social signal through the graph.
   * When an event affects an entity, connected entities react based on their relationship.
   *
   * @param {string} sourceId - Entity that caused the event
   * @param {string} eventType - Type of event (crime, kindness, betrayal, etc.)
   * @param {object} data - Event data
   * @returns {object[]} Array of reactions { entityId, reaction, magnitude }
   */
  propagateSignal(sourceId, eventType, data) {
    const reactions = []
    const source = this._entities.get(sourceId)
    if (!source) return reactions

    // Find all entities that have a relationship with the source
    for (const entity of this._entities.all()) {
      if (entity.id === sourceId) continue
      const rel = entity.relationships.edges[sourceId]
      if (!rel) continue

      const reaction = this._computeReaction(rel, eventType, data)
      if (reaction) {
        reactions.push({
          entityId: entity.id,
          entityName: entity.identity.name,
          reaction: reaction.type,
          magnitude: reaction.magnitude,
          moodChanges: reaction.moodChanges,
          relationshipChanges: reaction.relationshipChanges
        })

        // Apply mood changes
        if (reaction.moodChanges) {
          for (const [key, delta] of Object.entries(reaction.moodChanges)) {
            if (entity.mood[key] !== undefined) {
              entity.mood[key] = Math.max(0, Math.min(100, entity.mood[key] + delta))
            }
          }
        }

        // Apply relationship changes
        if (reaction.relationshipChanges) {
          for (const [key, delta] of Object.entries(reaction.relationshipChanges)) {
            if (rel[key] !== undefined) {
              rel[key] = Math.max(-100, Math.min(100, rel[key] + delta))
            }
          }
        }
      }
    }

    return reactions
  }

  /**
   * Find the strongest connection paths between two entities (up to 3 hops).
   *
   * @param {string} fromId
   * @param {string} toId
   * @returns {object|null} { path: string[], totalInfluence: number }
   */
  findPath(fromId, toId) {
    // BFS up to 3 hops
    const visited = new Set([fromId])
    const queue = [{ id: fromId, path: [fromId], influence: 1.0 }]
    let best = null

    while (queue.length > 0) {
      const current = queue.shift()
      if (current.path.length > 4) continue

      const entity = this._entities.get(current.id)
      if (!entity) continue

      for (const [targetId, rel] of Object.entries(entity.relationships.edges)) {
        if (visited.has(targetId)) continue

        const edgeInfluence = this._computeInfluence(rel) / 100
        const totalInfluence = current.influence * edgeInfluence
        const newPath = [...current.path, targetId]

        if (targetId === toId) {
          if (!best || totalInfluence > best.totalInfluence) {
            best = { path: newPath, totalInfluence }
          }
        } else if (newPath.length < 4) {
          visited.add(targetId)
          queue.push({ id: targetId, path: newPath, influence: totalInfluence })
        }
      }
    }

    return best
  }

  /**
   * Get the "social temperature" of an entity — how much social pressure they're under.
   *
   * @param {string} entityId
   * @returns {object} { pressure, positiveInfluence, negativeInfluence, isolationRisk }
   */
  getSocialTemperature(entityId) {
    const edges = this.getEdges(entityId)
    let positive = 0, negative = 0

    for (const edge of edges) {
      if (edge.trust > 0 || edge.love > 0 || edge.loyalty > 0) {
        positive += Math.max(edge.trust, 0) + Math.max(edge.love, 0) + Math.max(edge.loyalty, 0)
      }
      if (edge.fear > 0 || edge.hate > 0 || edge.resentment > 0) {
        negative += edge.fear + Math.max(edge.hate, 0) + edge.resentment
      }
    }

    return {
      pressure: negative - positive * 0.5,
      positiveInfluence: positive,
      negativeInfluence: negative,
      isolationRisk: edges.length < 2 ? 1.0 : edges.length < 4 ? 0.5 : 0.0,
      connectionCount: edges.length
    }
  }

  // ── Internal ──

  _computeInfluence(rel) {
    return Math.abs(rel.trust || 0) + Math.abs(rel.fear || 0) +
           Math.abs(rel.love || 0) + Math.abs(rel.hate || 0) +
           Math.abs(rel.loyalty || 0) + Math.abs(rel.resentment || 0) +
           (rel.familiarity || 0) * 0.5
  }

  _getDominant(rel) {
    const feelings = [
      { name: 'trust', v: rel.trust || 0 },
      { name: 'fear', v: rel.fear || 0 },
      { name: 'love', v: rel.love || 0 },
      { name: 'hate', v: rel.hate || 0 },
      { name: 'loyalty', v: rel.loyalty || 0 },
      { name: 'resentment', v: rel.resentment || 0 }
    ]
    feelings.sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    return feelings[0].v !== 0 ? feelings[0].name : 'neutral'
  }

  _computeReaction(rel, eventType, data) {
    const reactions = {
      'crime.theft': () => {
        const trustDelta = rel.trust > 30 ? -15 : -5 // Trusted people lose more trust
        return {
          type: 'disapproval',
          magnitude: Math.abs(trustDelta),
          moodChanges: { anger: 10, stress: 5 },
          relationshipChanges: { trust: trustDelta, respect: -5 }
        }
      },
      'combat.hit': () => {
        if (rel.loyalty > 30) {
          return { type: 'concern', magnitude: 15, moodChanges: { fear: 10, stress: 10 }, relationshipChanges: {} }
        }
        return { type: 'wariness', magnitude: 5, moodChanges: { fear: 5 }, relationshipChanges: { fear: 10 } }
      },
      'combat.kill': () => {
        if (rel.loyalty > 50) {
          return { type: 'shock', magnitude: 30, moodChanges: { fear: 20, stress: 15 }, relationshipChanges: { fear: 15 } }
        }
        return { type: 'fear', magnitude: 20, moodChanges: { fear: 25 }, relationshipChanges: { fear: 20, trust: -10 } }
      },
      'social.recruit': () => {
        if (rel.trust > 20) {
          return { type: 'approval', magnitude: 10, moodChanges: { hope: 10 }, relationshipChanges: { trust: 5, respect: 5 } }
        }
        return null
      },
      'world.build': () => {
        return { type: 'respect', magnitude: 5, moodChanges: {}, relationshipChanges: { respect: 3 } }
      }
    }

    const handler = reactions[eventType]
    return handler ? handler() : null
  }
}

export default SoulGraph
