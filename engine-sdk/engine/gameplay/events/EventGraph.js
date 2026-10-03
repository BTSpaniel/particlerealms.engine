// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * EventGraph — The event bus and event log for LIFE.
 *
 * Every meaningful thing in the world becomes an event.
 * Events power: memories, dialogue, reputation, crimes, family history,
 * item souls, resolve changes, and storylet triggers.
 *
 * Events are immutable once created. The log is append-only.
 * Listeners can subscribe to event types or use wildcard '*'.
 */

let _nextEventId = 1

/**
 * Creates an immutable event object.
 *
 * @param {object} config
 * @param {string} config.type - Event type (e.g. 'npc.stole', 'player.born', 'combat.hit')
 * @param {string} [config.sender] - Entity ID of who caused this event
 * @param {string} [config.target] - Entity ID of who this event affects
 * @param {object} [config.data] - Arbitrary payload
 * @param {string} [config.location] - Where it happened (location ID or coordinates)
 * @param {string[]} [config.witnesses] - Entity IDs of who saw it
 * @param {string[]} [config.tags] - Content tags (hunger, betrayal, family, fear, etc.)
 * @param {string} [config.description] - Human-readable description
 * @returns {object} Frozen event object
 */
export function createEvent(config) {
  if (!config.type) {
    throw new Error('EventGraph: Event must have a type.')
  }

  return Object.freeze({
    id: _nextEventId++,
    type: config.type,
    sender: config.sender || null,
    target: config.target || null,
    data: Object.freeze(config.data || {}),
    location: config.location || null,
    witnesses: Object.freeze(config.witnesses || []),
    tags: Object.freeze(config.tags || []),
    description: config.description || '',
    timestamp: config.timestamp || Date.now(),
    frame: config.frame || 0
  })
}

/**
 * EventGraph — global event bus + per-entity event logs.
 */
export class EventGraph {
  constructor() {
    /** @type {Map<string, Set<function>>} Listeners by event type */
    this._listeners = new Map()

    /** @type {object[]} Global event log (append-only) */
    this._globalLog = []

    /** @type {Map<string, object[]>} Per-entity event logs (entity ID → events) */
    this._entityLogs = new Map()

    /** @type {Map<string, object[]>} Per-location event logs */
    this._locationLogs = new Map()

    /** @type {Map<string, object[]>} Per-tag event index */
    this._tagIndex = new Map()

    /** @type {number} Max events in global log before oldest are archived */
    this.maxGlobalLogSize = 100000

    /** @type {number} Max events per entity log */
    this.maxEntityLogSize = 1000

    /** @type {number} Current game frame (set externally each tick) */
    this.currentFrame = 0

    /** @type {boolean} Whether to log events to console (debug) */
    this.debugLog = false
  }

  /**
   * Emit an event. Notifies all matching listeners and stores in logs.
   *
   * @param {object} eventOrConfig - A frozen event (from createEvent) or a config object
   * @returns {object} The emitted event
   */
  emit(eventOrConfig) {
    // Accept either a pre-created event or a config
    const event = Object.isFrozen(eventOrConfig)
      ? eventOrConfig
      : createEvent({ ...eventOrConfig, frame: this.currentFrame })

    // Debug logging — prettified JSON
    if (this.debugLog) {
      console.log(`[EventGraph] ${event.type}`, JSON.stringify(event, null, 2))
    }

    // Store in global log
    this._globalLog.push(event)
    if (this._globalLog.length > this.maxGlobalLogSize) {
      // Remove oldest 10%
      const removeCount = Math.floor(this.maxGlobalLogSize * 0.1)
      this._globalLog.splice(0, removeCount)
    }

    // Store in entity logs (sender and target)
    if (event.sender) this._appendEntityLog(event.sender, event)
    if (event.target && event.target !== event.sender) this._appendEntityLog(event.target, event)
    for (const witness of event.witnesses) {
      if (witness !== event.sender && witness !== event.target) {
        this._appendEntityLog(witness, event)
      }
    }

    // Store in location log
    if (event.location) {
      if (!this._locationLogs.has(event.location)) {
        this._locationLogs.set(event.location, [])
      }
      this._locationLogs.get(event.location).push(event)
    }

    // Store in tag index
    for (const tag of event.tags) {
      if (!this._tagIndex.has(tag)) {
        this._tagIndex.set(tag, [])
      }
      this._tagIndex.get(tag).push(event)
    }

    // Notify listeners
    this._notify(event.type, event)
    this._notify('*', event)

    return event
  }

  /**
   * Subscribe to events of a given type.
   *
   * @param {string} type - Event type to listen for, or '*' for all
   * @param {function} handler - (event) => void
   * @returns {function} Unsubscribe function
   */
  on(type, handler) {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set())
    }
    this._listeners.get(type).add(handler)

    return () => this.off(type, handler)
  }

  /**
   * Subscribe to the next event of a given type (auto-unsubscribes).
   *
   * @param {string} type
   * @param {function} handler
   * @returns {function} Unsubscribe function (in case you want to cancel early)
   */
  once(type, handler) {
    const wrapped = (event) => {
      this.off(type, wrapped)
      handler(event)
    }
    return this.on(type, wrapped)
  }

  /**
   * Unsubscribe a handler from an event type.
   *
   * @param {string} type
   * @param {function} handler
   */
  off(type, handler) {
    const set = this._listeners.get(type)
    if (set) {
      set.delete(handler)
      if (set.size === 0) this._listeners.delete(type)
    }
  }

  /**
   * Query the global event log.
   *
   * @param {object} [filter]
   * @param {string} [filter.type] - Event type (exact match)
   * @param {string} [filter.sender] - Sender entity ID
   * @param {string} [filter.target] - Target entity ID
   * @param {string} [filter.tag] - Must have this tag
   * @param {string} [filter.location] - Location ID
   * @param {number} [filter.since] - Only events after this timestamp
   * @param {number} [filter.sinceFrame] - Only events after this frame
   * @param {number} [filter.limit] - Max results (most recent first)
   * @returns {object[]} Matching events, newest first
   */
  query(filter) {
    let results

    // Use indexes when possible
    if (filter && filter.tag && this._tagIndex.has(filter.tag)) {
      results = [...this._tagIndex.get(filter.tag)]
    } else if (filter && filter.location && this._locationLogs.has(filter.location)) {
      results = [...this._locationLogs.get(filter.location)]
    } else {
      results = [...this._globalLog]
    }

    if (filter) {
      if (filter.type) results = results.filter(e => e.type === filter.type)
      if (filter.sender) results = results.filter(e => e.sender === filter.sender)
      if (filter.target) results = results.filter(e => e.target === filter.target)
      if (filter.tag) results = results.filter(e => e.tags.includes(filter.tag))
      if (filter.location) results = results.filter(e => e.location === filter.location)
      if (filter.since) results = results.filter(e => e.timestamp >= filter.since)
      if (filter.sinceFrame) results = results.filter(e => e.frame >= filter.sinceFrame)
    }

    // Newest first
    results.reverse()

    if (filter && filter.limit) {
      results = results.slice(0, filter.limit)
    }

    return results
  }

  /**
   * Get the event log for a specific entity.
   *
   * @param {string} entityId
   * @param {object} [filter]
   * @param {string} [filter.type]
   * @param {number} [filter.limit]
   * @param {number} [filter.since]
   * @returns {object[]} Events involving this entity, newest first
   */
  getEntityLog(entityId, filter) {
    const log = this._entityLogs.get(entityId) || []
    let results = [...log]

    if (filter) {
      if (filter.type) results = results.filter(e => e.type === filter.type)
      if (filter.since) results = results.filter(e => e.timestamp >= filter.since)
    }

    results.reverse()

    if (filter && filter.limit) {
      results = results.slice(0, filter.limit)
    }

    return results
  }

  /**
   * Get events at a specific location.
   *
   * @param {string} locationId
   * @param {number} [limit]
   * @returns {object[]}
   */
  getLocationLog(locationId, limit) {
    const log = this._locationLogs.get(locationId) || []
    const results = [...log].reverse()
    return limit ? results.slice(0, limit) : results
  }

  /**
   * Get events with a specific tag.
   *
   * @param {string} tag
   * @param {number} [limit]
   * @returns {object[]}
   */
  getByTag(tag, limit) {
    const log = this._tagIndex.get(tag) || []
    const results = [...log].reverse()
    return limit ? results.slice(0, limit) : results
  }

  /**
   * Replay events matching a filter, calling a handler for each.
   * Useful for rebuilding state from event history.
   *
   * @param {object} filter - Same as query() filter
   * @param {function} handler - (event) => void
   */
  replay(filter, handler) {
    const events = this.query(filter)
    // Replay in chronological order (oldest first)
    for (let i = events.length - 1; i >= 0; i--) {
      handler(events[i])
    }
  }

  /**
   * Count events matching a filter.
   *
   * @param {object} [filter]
   * @returns {number}
   */
  count(filter) {
    return this.query(filter).length
  }

  /**
   * Check if any event matching filter exists.
   *
   * @param {object} filter
   * @returns {boolean}
   */
  has(filter) {
    return this.query({ ...filter, limit: 1 }).length > 0
  }

  /**
   * Get stats for debugging.
   * @returns {object}
   */
  getStats() {
    return {
      globalLogSize: this._globalLog.length,
      entityLogCount: this._entityLogs.size,
      locationLogCount: this._locationLogs.size,
      tagCount: this._tagIndex.size,
      listenerCount: this._countListeners(),
      listenerTypes: [...this._listeners.keys()]
    }
  }

  /**
   * Clear all logs and listeners. Use for testing or full reset.
   */
  clear() {
    this._globalLog.length = 0
    this._entityLogs.clear()
    this._locationLogs.clear()
    this._tagIndex.clear()
    this._listeners.clear()
  }

  /**
   * Serialize the global log to a plain array (for save).
   * @param {number} [limit] - Max events to save
   * @returns {object[]}
   */
  serialize(limit) {
    const log = limit ? this._globalLog.slice(-limit) : this._globalLog
    return log.map(e => ({
      id: e.id,
      type: e.type,
      sender: e.sender,
      target: e.target,
      data: e.data,
      location: e.location,
      witnesses: [...e.witnesses],
      tags: [...e.tags],
      description: e.description,
      timestamp: e.timestamp,
      frame: e.frame
    }))
  }

  // ── Internal ──

  /** @private */
  _appendEntityLog(entityId, event) {
    if (!this._entityLogs.has(entityId)) {
      this._entityLogs.set(entityId, [])
    }
    const log = this._entityLogs.get(entityId)
    log.push(event)
    if (log.length > this.maxEntityLogSize) {
      // Remove oldest 10%
      const removeCount = Math.floor(this.maxEntityLogSize * 0.1)
      log.splice(0, removeCount)
    }
  }

  /** @private */
  _notify(type, event) {
    const set = this._listeners.get(type)
    if (!set) return
    for (const handler of set) {
      try {
        handler(event)
      } catch (err) {
        console.error(`[EventGraph] Listener error for "${type}":`, err)
      }
    }
  }

  /** @private */
  _countListeners() {
    let count = 0
    for (const set of this._listeners.values()) {
      count += set.size
    }
    return count
  }
}

export default EventGraph
