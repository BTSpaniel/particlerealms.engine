// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * RuleGraph — The master rule resolver for LIFE.
 *
 * Everything in the world passes through RuleGraph to decide what is legal.
 * Rules have priorities (1=highest), conditions, effects, and sources.
 * When rules conflict, the highest priority wins. Ties break by specificity.
 *
 * Priority levels:
 *   1 = Engine safety (cannot crash the game)
 *   2 = Physics / material (fire burns wood)
 *   3 = Survival / body (hunger kills)
 *   4 = World rules (gravity, time)
 *   5 = Law / faction (city forbids theft)
 *   6 = Item rules (sword needs two hands)
 *   7 = Contract rules (guardian vow restricts solo fighting)
 *   8 = Domain rules (domain overrides local reality)
 *   9 = Temporary status / visual (buff, aura, particle effect)
 */

// Rule categories
export const RuleCategory = Object.freeze({
  ENGINE_SAFETY:    'engine_safety',
  PHYSICS_MATERIAL: 'physics_material',
  SURVIVAL_BODY:    'survival_body',
  WORLD:            'world',
  LAW_FACTION:      'law_faction',
  ITEM:             'item',
  CONTRACT:         'contract',
  DOMAIN:           'domain',
  TEMPORARY_VISUAL: 'temporary_visual'
})

// Category to priority mapping
const CATEGORY_PRIORITY = Object.freeze({
  [RuleCategory.ENGINE_SAFETY]:    1,
  [RuleCategory.PHYSICS_MATERIAL]: 2,
  [RuleCategory.SURVIVAL_BODY]:    3,
  [RuleCategory.WORLD]:            4,
  [RuleCategory.LAW_FACTION]:      5,
  [RuleCategory.ITEM]:             6,
  [RuleCategory.CONTRACT]:         7,
  [RuleCategory.DOMAIN]:           8,
  [RuleCategory.TEMPORARY_VISUAL]: 9
})

// Rule effect types
export const RuleEffect = Object.freeze({
  ALLOW:   'allow',
  DENY:    'deny',
  MODIFY:  'modify',
  REPLACE: 'replace',
  TRIGGER: 'trigger'
})

let _nextRuleId = 1

/**
 * Creates a new rule object.
 *
 * @param {object} config
 * @param {string} config.name - Human-readable rule name
 * @param {string} config.category - One of RuleCategory values
 * @param {string} config.source - Who/what created this rule (entity id, system name, etc.)
 * @param {string} config.effect - One of RuleEffect values
 * @param {function} config.condition - (action, context) => boolean — when does this rule apply?
 * @param {function|*} config.apply - (action, context) => result — what happens when rule fires
 * @param {string[]} [config.tags] - Content tags for filtering
 * @param {number} [config.specificity] - Higher = more specific (breaks ties within same priority)
 * @param {number} [config.expiry] - Timestamp when rule expires, null for permanent
 * @param {string} [config.description] - Human-readable explanation
 * @returns {object} Frozen rule object
 */
export function createRule(config) {
  const category = config.category
  if (!CATEGORY_PRIORITY[category]) {
    throw new Error(`RuleGraph: Unknown category "${category}". Use RuleCategory constants.`)
  }

  const rule = Object.freeze({
    id: _nextRuleId++,
    name: config.name || 'unnamed_rule',
    category,
    priority: CATEGORY_PRIORITY[category],
    source: config.source || 'system',
    effect: config.effect || RuleEffect.ALLOW,
    condition: config.condition || (() => true),
    apply: config.apply || (() => true),
    tags: Object.freeze(config.tags || []),
    specificity: config.specificity || 0,
    expiry: config.expiry || null,
    description: config.description || '',
    createdAt: Date.now()
  })

  return rule
}

/**
 * RuleGraph — singleton-style rule management and resolution.
 */
export class RuleGraph {
  constructor() {
    /** @type {Map<number, object>} All registered rules by ID */
    this._rules = new Map()

    /** @type {Map<string, Set<number>>} Rules indexed by category */
    this._byCategory = new Map()

    /** @type {Map<string, Set<number>>} Rules indexed by tag */
    this._byTag = new Map()

    /** @type {Map<string, Set<number>>} Rules indexed by source */
    this._bySource = new Map()

    /** @type {Array<object>} Trace log for the most recent query (debug) */
    this._lastTrace = []

    /** @type {boolean} Whether to record traces */
    this.traceEnabled = true
  }

  /**
   * Register a rule.
   * @param {object} rule - A rule created by createRule()
   * @returns {number} The rule's ID
   */
  addRule(rule) {
    if (this._rules.has(rule.id)) {
      throw new Error(`RuleGraph: Rule ID ${rule.id} already registered.`)
    }

    this._rules.set(rule.id, rule)

    // Index by category
    if (!this._byCategory.has(rule.category)) {
      this._byCategory.set(rule.category, new Set())
    }
    this._byCategory.get(rule.category).add(rule.id)

    // Index by tags
    for (const tag of rule.tags) {
      if (!this._byTag.has(tag)) {
        this._byTag.set(tag, new Set())
      }
      this._byTag.get(tag).add(rule.id)
    }

    // Index by source
    if (!this._bySource.has(rule.source)) {
      this._bySource.set(rule.source, new Set())
    }
    this._bySource.get(rule.source).add(rule.id)

    return rule.id
  }

  /**
   * Remove a rule by ID.
   * @param {number} ruleId
   * @returns {boolean} Whether the rule was found and removed
   */
  removeRule(ruleId) {
    const rule = this._rules.get(ruleId)
    if (!rule) return false

    this._rules.delete(ruleId)

    // Remove from category index
    const catSet = this._byCategory.get(rule.category)
    if (catSet) {
      catSet.delete(ruleId)
      if (catSet.size === 0) this._byCategory.delete(rule.category)
    }

    // Remove from tag indexes
    for (const tag of rule.tags) {
      const tagSet = this._byTag.get(tag)
      if (tagSet) {
        tagSet.delete(ruleId)
        if (tagSet.size === 0) this._byTag.delete(tag)
      }
    }

    // Remove from source index
    const srcSet = this._bySource.get(rule.source)
    if (srcSet) {
      srcSet.delete(ruleId)
      if (srcSet.size === 0) this._bySource.delete(rule.source)
    }

    return true
  }

  /**
   * Remove all rules from a specific source.
   * @param {string} source
   * @returns {number} Number of rules removed
   */
  removeRulesBySource(source) {
    const srcSet = this._bySource.get(source)
    if (!srcSet) return 0

    const ids = [...srcSet]
    let count = 0
    for (const id of ids) {
      if (this.removeRule(id)) count++
    }
    return count
  }

  /**
   * Get a rule by ID.
   * @param {number} ruleId
   * @returns {object|null}
   */
  getRule(ruleId) {
    return this._rules.get(ruleId) || null
  }

  /**
   * Remove expired rules. Call periodically.
   * @param {number} [now] - Current timestamp, defaults to Date.now()
   * @returns {number} Number of rules removed
   */
  purgeExpired(now) {
    now = now || Date.now()
    let count = 0
    for (const [id, rule] of this._rules) {
      if (rule.expiry !== null && rule.expiry <= now) {
        this.removeRule(id)
        count++
      }
    }
    return count
  }

  /**
   * Query: Is this action allowed given the current context?
   *
   * Gathers all matching rules, sorts by priority (ascending = higher priority first),
   * then by specificity (descending), and resolves conflicts.
   *
   * @param {object} action - Describes what is being attempted (type, actor, target, data)
   * @param {object} context - World state context (location, time, relationships, etc.)
   * @returns {object} { allowed: boolean, reason: string, matchedRules: object[], trace: object[] }
   */
  isAllowed(action, context) {
    const now = Date.now()
    const trace = []
    const matched = []

    // Gather all rules whose condition matches
    for (const [, rule] of this._rules) {
      // Skip expired
      if (rule.expiry !== null && rule.expiry <= now) continue

      let applies = false
      try {
        applies = rule.condition(action, context)
      } catch (err) {
        trace.push({
          ruleId: rule.id,
          ruleName: rule.name,
          phase: 'condition',
          error: err.message
        })
        continue
      }

      if (applies) {
        matched.push(rule)
        trace.push({
          ruleId: rule.id,
          ruleName: rule.name,
          category: rule.category,
          priority: rule.priority,
          specificity: rule.specificity,
          effect: rule.effect,
          phase: 'matched'
        })
      }
    }

    // Sort: lowest priority number first (highest authority), then highest specificity first
    matched.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      return b.specificity - a.specificity
    })

    // Resolve: walk from highest priority down
    let allowed = true
    let reason = 'No rules blocked this action.'
    let decidingRule = null

    for (const rule of matched) {
      if (rule.effect === RuleEffect.DENY) {
        allowed = false
        reason = `Denied by rule "${rule.name}" [${rule.category}, priority ${rule.priority}]: ${rule.description}`
        decidingRule = rule
        trace.push({
          ruleId: rule.id,
          ruleName: rule.name,
          phase: 'decided',
          decision: 'deny'
        })
        break
      }

      if (rule.effect === RuleEffect.ALLOW) {
        // An explicit allow at higher priority overrides lower denies
        allowed = true
        reason = `Allowed by rule "${rule.name}" [${rule.category}, priority ${rule.priority}]: ${rule.description}`
        decidingRule = rule
        trace.push({
          ruleId: rule.id,
          ruleName: rule.name,
          phase: 'decided',
          decision: 'allow'
        })
        break
      }
    }

    if (this.traceEnabled) {
      this._lastTrace = trace
    }

    return Object.freeze({
      allowed,
      reason,
      decidingRule,
      matchedRules: Object.freeze(matched),
      trace: Object.freeze(trace)
    })
  }

  /**
   * Query: What result does an action produce after all modify/replace rules?
   *
   * Runs the action through all matching MODIFY and REPLACE rules in priority order.
   *
   * @param {object} action
   * @param {object} context
   * @returns {object} { result: *, modifiers: object[], trace: object[] }
   */
  resolve(action, context) {
    const now = Date.now()
    const trace = []
    const modifiers = []
    let result = { ...action }

    // Gather matching modify/replace/trigger rules
    const matched = []
    for (const [, rule] of this._rules) {
      if (rule.expiry !== null && rule.expiry <= now) continue
      if (rule.effect !== RuleEffect.MODIFY &&
          rule.effect !== RuleEffect.REPLACE &&
          rule.effect !== RuleEffect.TRIGGER) continue

      let applies = false
      try {
        applies = rule.condition(action, context)
      } catch (err) {
        trace.push({ ruleId: rule.id, ruleName: rule.name, phase: 'condition', error: err.message })
        continue
      }

      if (applies) matched.push(rule)
    }

    // Sort by priority then specificity
    matched.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      return b.specificity - a.specificity
    })

    // Apply in order
    for (const rule of matched) {
      try {
        const applied = rule.apply(result, context)
        if (rule.effect === RuleEffect.REPLACE && applied !== undefined) {
          result = applied
        } else if (rule.effect === RuleEffect.MODIFY && applied !== undefined) {
          result = { ...result, ...applied }
        }
        // TRIGGER rules run side-effects but don't change result
        modifiers.push(rule)
        trace.push({
          ruleId: rule.id,
          ruleName: rule.name,
          phase: 'applied',
          effect: rule.effect
        })
      } catch (err) {
        trace.push({ ruleId: rule.id, ruleName: rule.name, phase: 'apply', error: err.message })
      }
    }

    if (this.traceEnabled) {
      this._lastTrace = trace
    }

    return Object.freeze({
      result,
      modifiers: Object.freeze(modifiers),
      trace: Object.freeze(trace)
    })
  }

  /**
   * Explain why a specific action would be allowed or denied.
   * Returns a human-readable explanation chain.
   *
   * @param {object} action
   * @param {object} context
   * @returns {object} { allowed, reason, chain: string[] }
   */
  explain(action, context) {
    const result = this.isAllowed(action, context)
    const chain = []

    for (const entry of result.trace) {
      if (entry.phase === 'matched') {
        chain.push(
          `[${entry.category} P${entry.priority}] "${entry.ruleName}" matched (effect: ${entry.effect}, specificity: ${entry.specificity})`
        )
      } else if (entry.phase === 'decided') {
        chain.push(
          `→ DECISION: ${entry.decision.toUpperCase()} by "${entry.ruleName}"`
        )
      } else if (entry.error) {
        chain.push(
          `⚠ Rule "${entry.ruleName}" errored during ${entry.phase}: ${entry.error}`
        )
      }
    }

    if (chain.length === 0) {
      chain.push('No rules matched this action. Default: allowed.')
    }

    return {
      allowed: result.allowed,
      reason: result.reason,
      chain
    }
  }

  /**
   * Get all active rules matching a filter.
   *
   * @param {object} [filter]
   * @param {string} [filter.category]
   * @param {string} [filter.tag]
   * @param {string} [filter.source]
   * @param {string} [filter.effect]
   * @returns {object[]}
   */
  getActiveRules(filter) {
    const now = Date.now()
    let candidates

    if (filter && filter.category && this._byCategory.has(filter.category)) {
      candidates = [...this._byCategory.get(filter.category)].map(id => this._rules.get(id))
    } else if (filter && filter.tag && this._byTag.has(filter.tag)) {
      candidates = [...this._byTag.get(filter.tag)].map(id => this._rules.get(id))
    } else if (filter && filter.source && this._bySource.has(filter.source)) {
      candidates = [...this._bySource.get(filter.source)].map(id => this._rules.get(id))
    } else {
      candidates = [...this._rules.values()]
    }

    // Filter expired
    candidates = candidates.filter(r => r && (r.expiry === null || r.expiry > now))

    // Apply remaining filters
    if (filter) {
      if (filter.category) candidates = candidates.filter(r => r.category === filter.category)
      if (filter.tag) candidates = candidates.filter(r => r.tags.includes(filter.tag))
      if (filter.source) candidates = candidates.filter(r => r.source === filter.source)
      if (filter.effect) candidates = candidates.filter(r => r.effect === filter.effect)
    }

    return candidates
  }

  /**
   * Get the trace log from the most recent isAllowed() or resolve() call.
   * @returns {object[]}
   */
  getLastTrace() {
    return this._lastTrace
  }

  /**
   * Get total number of registered rules.
   * @returns {number}
   */
  get size() {
    return this._rules.size
  }

  /**
   * Get stats for debugging.
   * @returns {object}
   */
  getStats() {
    const byCategory = {}
    for (const [cat, set] of this._byCategory) {
      byCategory[cat] = set.size
    }
    return {
      totalRules: this._rules.size,
      byCategory,
      tagCount: this._byTag.size,
      sourceCount: this._bySource.size
    }
  }

  /**
   * Remove all rules. Use for testing or full reset.
   */
  clear() {
    this._rules.clear()
    this._byCategory.clear()
    this._byTag.clear()
    this._bySource.clear()
    this._lastTrace = []
  }

  /**
   * Serialize all rules to a plain array (for save/debug).
   * Note: condition and apply functions are NOT serializable — only metadata is saved.
   * @returns {object[]}
   */
  serialize() {
    const out = []
    for (const [, rule] of this._rules) {
      out.push({
        id: rule.id,
        name: rule.name,
        category: rule.category,
        priority: rule.priority,
        source: rule.source,
        effect: rule.effect,
        tags: [...rule.tags],
        specificity: rule.specificity,
        expiry: rule.expiry,
        description: rule.description,
        createdAt: rule.createdAt
      })
    }
    return out
  }
}

export default RuleGraph
