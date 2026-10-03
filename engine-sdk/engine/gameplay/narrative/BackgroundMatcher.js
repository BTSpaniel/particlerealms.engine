// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * BackgroundMatcher — Extracts origin tags from player-written background text.
 *
 * The player types a "soul memory" and the system extracts semantic tags
 * that drive world generation: family type, culture, social status,
 * early hardships, resolve seeds, and starting storylets.
 *
 * Uses keyword/phrase matching with weighted scoring. No heavy ML needed
 * for the first playable — just pattern matching with synonyms.
 */

/**
 * Tag definitions: each tag has keywords/phrases that trigger it,
 * a category, and a weight.
 */
const TAG_DEFINITIONS = [
  // ── Economic / Social Status ──
  { tag: 'poverty', category: 'status', keywords: ['poor', 'hungry', 'starving', 'nothing', 'slums', 'begged', 'scraps', 'gutter', 'destitute', 'broke', 'penniless', 'impoverished'], weight: 1.0 },
  { tag: 'wealth', category: 'status', keywords: ['rich', 'wealthy', 'noble', 'mansion', 'gold', 'luxury', 'privileged', 'fortune', 'estate', 'affluent'], weight: 1.0 },
  { tag: 'middle_class', category: 'status', keywords: ['merchant', 'trader', 'shop', 'business', 'comfortable', 'modest', 'working'], weight: 0.7 },

  // ── Family ──
  { tag: 'family_protector', category: 'resolve', keywords: ['protected', 'protect', 'shielded', 'saved my', 'kept safe', 'guarded', 'watched over', 'took care of'], weight: 1.2 },
  { tag: 'sibling_bond', category: 'family', keywords: ['brother', 'sister', 'sibling', 'twin', 'little sister', 'big brother', 'younger', 'older sibling'], weight: 1.0 },
  { tag: 'orphan', category: 'family', keywords: ['orphan', 'no parents', 'parents died', 'alone', 'abandoned', 'left behind', 'no family', 'lost everyone'], weight: 1.2 },
  { tag: 'single_parent', category: 'family', keywords: ['only my mother', 'only my father', 'raised by', 'single parent', 'just mom', 'just dad', 'mother alone', 'father alone'], weight: 0.8 },
  { tag: 'large_family', category: 'family', keywords: ['many siblings', 'big family', 'large family', 'crowded home', 'lots of brothers', 'lots of sisters'], weight: 0.7 },

  // ── Hardship ──
  { tag: 'hardship', category: 'origin', keywords: ['hard', 'difficult', 'struggled', 'suffered', 'pain', 'tough', 'rough', 'harsh', 'brutal', 'cruel'], weight: 0.8 },
  { tag: 'betrayal', category: 'trauma', keywords: ['betrayed', 'betrayal', 'stabbed in the back', 'lied to', 'tricked', 'deceived', 'sold out', 'turned on'], weight: 1.1 },
  { tag: 'loss', category: 'trauma', keywords: ['lost', 'death', 'died', 'killed', 'murdered', 'gone', 'passed away', 'funeral', 'grief', 'mourning'], weight: 1.0 },
  { tag: 'illness', category: 'trauma', keywords: ['sick', 'ill', 'plague', 'disease', 'fever', 'weakness', 'bedridden', 'coughing', 'infection'], weight: 0.8 },
  { tag: 'debt', category: 'trauma', keywords: ['debt', 'owed', 'loan', 'collector', 'payment', 'indentured', 'borrowed'], weight: 0.9 },

  // ── Crime / Street ──
  { tag: 'survival_theft', category: 'resolve', keywords: ['stole', 'steal', 'stolen', 'thief', 'took food', 'pickpocket', 'swiped', 'nabbed', 'five-finger'], weight: 1.0 },
  { tag: 'street_life', category: 'origin', keywords: ['street', 'alley', 'underground', 'gang', 'criminal', 'outlaw', 'running', 'hiding', 'fugitive'], weight: 0.9 },
  { tag: 'witness_violence', category: 'trauma', keywords: ['saw violence', 'witnessed', 'watched someone die', 'blood', 'violence', 'attack', 'massacre', 'war'], weight: 1.0 },

  // ── Personality / Values ──
  { tag: 'anti_noble', category: 'values', keywords: ['hated nobles', 'hate rich', 'despise', 'corrupt', 'unfair', 'unjust', 'oppressor', 'tyrant', 'ruling class'], weight: 0.9 },
  { tag: 'kind', category: 'values', keywords: ['kind', 'gentle', 'caring', 'helped', 'shared', 'gave', 'generous', 'compassionate', 'warm'], weight: 0.8 },
  { tag: 'brave', category: 'values', keywords: ['brave', 'courage', 'fearless', 'stood up', 'faced', 'fought back', 'defiant', 'bold', 'daring'], weight: 0.9 },
  { tag: 'cunning', category: 'values', keywords: ['clever', 'cunning', 'smart', 'tricked', 'outsmarted', 'schemed', 'planned', 'manipulated', 'wits'], weight: 0.8 },
  { tag: 'loner', category: 'values', keywords: ['alone', 'lonely', 'solitary', 'no friends', 'kept to myself', 'isolated', 'withdrawn', 'outcast'], weight: 0.7 },
  { tag: 'loyal', category: 'values', keywords: ['loyal', 'faithful', 'devoted', 'never left', 'stood by', 'always there', 'promised', 'sworn'], weight: 0.9 },

  // ── Resolve Seeds ──
  { tag: 'guardian_resolve', category: 'resolve', keywords: ['protect', 'shield', 'defend', 'guardian', 'kept safe', 'saved', 'bodyguard', 'watch over'], weight: 1.3 },
  { tag: 'hunter_resolve', category: 'resolve', keywords: ['hunt', 'track', 'prey', 'chase', 'pursue', 'stalk', 'target', 'revenge'], weight: 1.1 },
  { tag: 'builder_resolve', category: 'resolve', keywords: ['build', 'built', 'construct', 'create', 'made', 'crafted', 'shelter', 'home'], weight: 1.0 },
  { tag: 'survivor_resolve', category: 'resolve', keywords: ['survive', 'survived', 'endured', 'lived through', 'made it', 'persevered', 'held on'], weight: 1.0 },
  { tag: 'redeemer_resolve', category: 'resolve', keywords: ['free', 'freed', 'liberate', 'rescue', 'save others', 'break chains', 'release', 'redeem'], weight: 1.2 },
  { tag: 'trickster_resolve', category: 'resolve', keywords: ['trick', 'deceive', 'con', 'disguise', 'pretend', 'fool', 'cheat', 'swindle'], weight: 0.9 },

  // ── Location / Culture ──
  { tag: 'rural', category: 'origin', keywords: ['farm', 'village', 'countryside', 'rural', 'fields', 'harvest', 'animals', 'barn'], weight: 0.7 },
  { tag: 'urban', category: 'origin', keywords: ['city', 'town', 'market', 'streets', 'crowded', 'buildings', 'urban', 'district'], weight: 0.7 },
  { tag: 'underground', category: 'origin', keywords: ['underground', 'tunnel', 'cave', 'mine', 'below', 'deep', 'darkness', 'subterranean'], weight: 0.8 },
  { tag: 'coastal', category: 'origin', keywords: ['sea', 'ocean', 'port', 'ship', 'sailor', 'fish', 'waves', 'dock', 'harbor'], weight: 0.7 },

  // ── Skills / Background ──
  { tag: 'healer', category: 'skill', keywords: ['heal', 'healed', 'medicine', 'herbs', 'doctor', 'nurse', 'bandage', 'cure', 'remedy'], weight: 0.9 },
  { tag: 'fighter', category: 'skill', keywords: ['fight', 'fought', 'warrior', 'soldier', 'battle', 'combat', 'sword', 'weapon', 'fist'], weight: 0.9 },
  { tag: 'crafter', category: 'skill', keywords: ['craft', 'forge', 'smith', 'tools', 'workshop', 'tinker', 'repair', 'build things'], weight: 0.8 },
]

/**
 * Extract origin tags from player-written background text.
 *
 * @param {string} text - The player's "soul memory" text
 * @returns {object} { tags: { tag: score }[], topTags: string[], categories: { category: tag[] }, rawScores: { tag: number } }
 */
export function extractOriginTags(text) {
  if (!text || text.trim().length === 0) {
    return { tags: {}, topTags: [], categories: {}, rawScores: {} }
  }

  const lower = text.toLowerCase()
  const scores = {}

  for (const def of TAG_DEFINITIONS) {
    let score = 0
    for (const kw of def.keywords) {
      if (lower.includes(kw)) {
        // Longer phrases are worth more
        const phraseBonus = kw.includes(' ') ? 1.5 : 1.0
        score += def.weight * phraseBonus
      }
    }
    if (score > 0) {
      scores[def.tag] = (scores[def.tag] || 0) + score
    }
  }

  // Normalize scores to 0-1 range
  const maxScore = Math.max(1, ...Object.values(scores))
  const tags = {}
  for (const [tag, score] of Object.entries(scores)) {
    tags[tag] = Math.min(1.0, score / maxScore)
  }

  // Top tags (sorted by score)
  const topTags = Object.entries(tags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => t)

  // Group by category
  const categories = {}
  for (const def of TAG_DEFINITIONS) {
    if (tags[def.tag]) {
      if (!categories[def.category]) categories[def.category] = []
      if (!categories[def.category].includes(def.tag)) {
        categories[def.category].push(def.tag)
      }
    }
  }

  return { tags, topTags, categories, rawScores: scores }
}

/**
 * Map extracted tags to world generation parameters.
 *
 * @param {object} tagResult - From extractOriginTags()
 * @returns {object} { familyType, socialStatus, culture, hardships, resolveSeed, startingStorylets, townType }
 */
export function mapTagsToOrigin(tagResult) {
  const { tags, topTags, categories } = tagResult

  // Family type
  let familyType = 'nuclear'
  if (tags.orphan) familyType = 'orphan'
  else if (tags.single_parent) familyType = 'single_parent'
  else if (tags.large_family) familyType = 'large'

  // Social status
  let socialStatus = 'common'
  if (tags.poverty) socialStatus = 'poor'
  else if (tags.wealth) socialStatus = 'wealthy'
  else if (tags.middle_class) socialStatus = 'merchant'
  else if (tags.street_life) socialStatus = 'outcast'

  // Town type
  let townType = 'town'
  if (tags.rural) townType = 'village'
  else if (tags.urban) townType = 'city'
  else if (tags.underground) townType = 'underground'
  else if (tags.coastal) townType = 'port'

  // Hardships
  const hardships = []
  if (tags.betrayal) hardships.push('betrayal')
  if (tags.loss) hardships.push('loss')
  if (tags.illness) hardships.push('illness')
  if (tags.debt) hardships.push('debt')
  if (tags.witness_violence) hardships.push('violence')
  if (tags.hardship) hardships.push('general_hardship')

  // Resolve seed
  let resolveSeed = null
  const resolveTag = (categories.resolve || [])
    .sort((a, b) => (tags[b] || 0) - (tags[a] || 0))[0]

  if (resolveTag) {
    const seedMap = {
      guardian_resolve: 'guardian',
      family_protector: 'guardian',
      hunter_resolve: 'hunter',
      builder_resolve: 'builder',
      survivor_resolve: 'survivor',
      survival_theft: 'street_survivor',
      redeemer_resolve: 'redeemer',
      trickster_resolve: 'trickster'
    }
    resolveSeed = seedMap[resolveTag] || null
  }

  // Starting storylets
  const startingStorylets = []
  if (tags.sibling_bond) startingStorylets.push('sibling_bond')
  if (tags.orphan) startingStorylets.push('orphan_origin')
  if (tags.poverty) startingStorylets.push('food_shortage')
  if (tags.debt) startingStorylets.push('debt_collector')
  if (tags.betrayal) startingStorylets.push('trust_broken')
  if (tags.loss) startingStorylets.push('grief_memory')
  if (tags.street_life) startingStorylets.push('street_chase')

  return {
    familyType,
    socialStatus,
    townType,
    hardships,
    resolveSeed,
    startingStorylets,
    topTags
  }
}

export default { extractOriginTags, mapTagsToOrigin }
