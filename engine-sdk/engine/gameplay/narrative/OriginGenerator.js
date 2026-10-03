// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { randomElement, uniformDistribution } from '../../core/math/MathRandom.js'

/**
 * OriginGenerator — Creates a player's origin from extracted tags.
 *
 * Generates: family, parents, town, culture, name negotiation,
 * childhood memories, and first crisis event.
 */

// ── Name pools ──
const FAMILY_NAMES = {
  eastern: ['Ashborne', 'Kiyara', 'Hoshino', 'Tanegawa', 'Kurosawa', 'Mikami', 'Harada', 'Nakamura'],
  western: ['Thornwall', 'Ashford', 'Blackwell', 'Ironwood', 'Stonehill', 'Ravencroft', 'Windmere', 'Galeheart'],
  coastal: ['Tidecaller', 'Saltwind', 'Deephelm', 'Driftwood', 'Shellcrest', 'Stormwatch', 'Anchorborn'],
  underground: ['Deepvein', 'Cavecrest', 'Irondelve', 'Darkhollow', 'Tunnelborn', 'Stonewalk', 'Ashpit']
}

const FIRST_NAMES = {
  eastern: { male: ['Kael', 'Ren', 'Hiro', 'Shin', 'Yuu', 'Akira', 'Kai', 'Sora'], female: ['Mira', 'Yuki', 'Hana', 'Rin', 'Aoi', 'Sakura', 'Nao', 'Emi'] },
  western: { male: ['Arlo', 'Finn', 'Cole', 'Reed', 'Ash', 'Wren', 'Bram', 'Jace'], female: ['Lyra', 'Ivy', 'Wren', 'Sage', 'Fern', 'Rowan', 'Elara', 'Maren'] },
  coastal: { male: ['Cove', 'Reef', 'Storm', 'Tide', 'Bay', 'Drift', 'Helm', 'Wake'], female: ['Coral', 'Pearl', 'Marina', 'Siren', 'Shell', 'Wave', 'Luna', 'Isla'] },
  underground: { male: ['Dug', 'Flint', 'Ore', 'Slab', 'Coal', 'Gravel', 'Forge', 'Anvil'], female: ['Ember', 'Cinder', 'Onyx', 'Slate', 'Ruby', 'Garnet', 'Pyrite', 'Crystal'] }
}

const PARENT_TRAITS = {
  kind: ['gentle', 'caring', 'warm', 'nurturing'],
  strict: ['stern', 'disciplined', 'demanding', 'rigid'],
  absent: ['distant', 'busy', 'neglectful', 'working'],
  protective: ['watchful', 'fierce', 'paranoid', 'sheltering'],
  broken: ['tired', 'sad', 'drinking', 'grieving']
}

const CHILDHOOD_MEMORIES = [
  { type: 'warm', text: 'A warm evening by the fire, {parent} telling stories.' },
  { type: 'fear', text: 'The night you heard shouting outside and hid under the bed.' },
  { type: 'wonder', text: 'The first time you saw the {landmark} and felt the world was bigger than your home.' },
  { type: 'bond', text: '{sibling} held your hand when the thunder came.' },
  { type: 'loss', text: 'The day {parent} didn\'t come home until dawn, and you waited by the door.' },
  { type: 'courage', text: 'You stood between {sibling} and the older kids. You were shaking, but you didn\'t move.' },
  { type: 'hunger', text: 'The winter when there was only enough bread for one meal a day.' },
  { type: 'gift', text: '{parent} gave you a small {item}. "Keep this," they said. "It was mine when I was your age."' }
]

const CRISIS_TYPES = [
  { type: 'famine', text: 'A food shortage hit {town}. The poor suffered most.', tags: ['hunger', 'survival'] },
  { type: 'raid', text: 'Raiders attacked {town} at dawn. Fires. Screaming.', tags: ['violence', 'fear'] },
  { type: 'betrayal', text: 'Someone your family trusted sold them out. The guards came.', tags: ['betrayal', 'crime'] },
  { type: 'illness', text: 'A sickness swept through {town}. {parent} fell ill.', tags: ['illness', 'fear'] },
  { type: 'debt', text: 'The debt collectors came. They said the family owed more than they could pay in a lifetime.', tags: ['debt', 'poverty'] },
  { type: 'disappearance', text: '{parent} went out one morning and never returned.', tags: ['loss', 'mystery'] }
]

const LANDMARKS = ['great wall', 'ancient tree', 'glowing cavern', 'ocean horizon', 'mountain peak', 'night market']
const SMALL_ITEMS = ['carved stone', 'iron ring', 'wooden whistle', 'smooth pebble', 'feather charm', 'old coin']

const INHERITED_RELATION_OPTIONS = {
  debt: {
    allies: [{ entityId: 'healer_yuna', name: 'Yuna', role: 'healer', trust: 25, reason: 'helped your family through debt sickness' }],
    enemies: [{ entityId: 'shopkeeper_varn', name: 'Varn', role: 'shopkeeper', resentment: 35, reason: 'keeps an old family debt ledger' }]
  },
  illness: {
    allies: [{ entityId: 'healer_yuna', name: 'Yuna', role: 'healer', trust: 35, reason: 'treated your family during sickness' }],
    enemies: [{ entityId: 'drunk_maro', name: 'Maro', role: 'laborer', resentment: 20, reason: 'blamed your family for spreading illness' }]
  },
  famine: {
    allies: [{ entityId: 'baker_olga', name: 'Olga', role: 'baker', trust: 30, reason: 'quietly shared bread when food ran out' }],
    enemies: [{ entityId: 'shopkeeper_varn', name: 'Varn', role: 'shopkeeper', resentment: 25, reason: 'profited from hunger near your family' }]
  },
  raid: {
    allies: [{ entityId: 'guard_tomas', name: 'Tomas', role: 'guard', trust: 25, reason: 'stood near your family during the raid' }],
    enemies: [{ entityId: 'thief_jin', name: 'Jin', role: 'thief', resentment: 25, reason: 'was tied to raiders who hurt your street' }]
  },
  betrayal: {
    allies: [{ entityId: 'informant_ren', name: 'Ren', role: 'informant', trust: 20, reason: 'knows who betrayed your family' }],
    enemies: [{ entityId: 'elder_saya', name: 'Saya', role: 'elder', resentment: 30, reason: 'accepted the official version of the betrayal' }]
  },
  disappearance: {
    allies: [{ entityId: 'widow_hana', name: 'Hana', role: 'widow', trust: 25, reason: 'kept watch when your family searched at night' }],
    enemies: [{ entityId: 'informant_ren', name: 'Ren', role: 'informant', resentment: 25, reason: 'knows more about the disappearance than he admits' }]
  },
  wealthy: {
    allies: [{ entityId: 'smith_drak', name: 'Drak', role: 'blacksmith', trust: 20, reason: 'once worked under your family patronage' }],
    enemies: [{ entityId: 'thief_jin', name: 'Jin', role: 'thief', resentment: 30, reason: 'sees your family as a rich target' }]
  },
  outcast: {
    allies: [{ entityId: 'beggar_renn', name: 'Renn', role: 'beggar', trust: 25, reason: 'shared shelter with your family on the edges' }],
    enemies: [{ entityId: 'guard_sela', name: 'Sela', role: 'guard', resentment: 25, reason: 'keeps your family under suspicion' }]
  }
}

const FAMILY_VALUE_BY_TAG = {
  family_protector: 'protection',
  sibling_bond: 'kinship',
  anti_noble: 'justice',
  kind: 'compassion',
  brave: 'courage',
  cunning: 'cleverness',
  loner: 'self_reliance',
  loyal: 'loyalty',
  survival_theft: 'survival',
  guardian_resolve: 'protection',
  hunter_resolve: 'vengeance',
  builder_resolve: 'craft',
  survivor_resolve: 'endurance',
  redeemer_resolve: 'freedom',
  trickster_resolve: 'cleverness',
  healer: 'mercy',
  fighter: 'strength',
  crafter: 'craft'
}

const FAMILY_VALUES_BY_STATUS = {
  poor: ['survival', 'kinship'],
  wealthy: ['legacy', 'status'],
  merchant: ['trade', 'reputation'],
  outcast: ['self_reliance', 'secrecy'],
  common: ['stability', 'neighborliness']
}

const LINEAGE_BY_CULTURE = {
  eastern: ['keepers of winter rice', 'wall-watch families', 'river shrine caretakers', 'old market scribes'],
  western: ['borderward tenants', 'fallen minor gentry', 'guild-bound craftsmen', 'old road wardens'],
  coastal: ['storm-season fishers', 'harbor pilots', 'salt-house keepers', 'wreck salvagers'],
  underground: ['deep tunnel cutters', 'ore oath families', 'lamp keepers', 'stone singers']
}

const GENERATIONAL_INFLUENCE_BY_VALUE = {
  protection: { trait: 'watchful', pressure: 'protect the vulnerable' },
  kinship: { trait: 'family-bound', pressure: 'keep the family together' },
  justice: { trait: 'defiant', pressure: 'answer old wrongs' },
  compassion: { trait: 'merciful', pressure: 'help before judging' },
  courage: { trait: 'bold', pressure: 'stand when others run' },
  cleverness: { trait: 'resourceful', pressure: 'survive through wit' },
  self_reliance: { trait: 'guarded', pressure: 'owe no one' },
  loyalty: { trait: 'steadfast', pressure: 'never abandon your own' },
  survival: { trait: 'hardy', pressure: 'live through scarcity' },
  legacy: { trait: 'proud', pressure: 'restore the family name' },
  status: { trait: 'polished', pressure: 'protect appearances' },
  trade: { trait: 'practical', pressure: 'turn every tie into exchange' },
  reputation: { trait: 'careful', pressure: 'avoid public shame' },
  secrecy: { trait: 'quiet', pressure: 'hide family truths' },
  stability: { trait: 'steady', pressure: 'avoid reckless change' },
  neighborliness: { trait: 'open-handed', pressure: 'keep peace nearby' },
  absence: { trait: 'searching', pressure: 'find what was lost' },
  sacrifice: { trait: 'dutiful', pressure: 'repay old sacrifices' },
  duty: { trait: 'responsible', pressure: 'carry your share' },
  vengeance: { trait: 'unforgiving', pressure: 'settle old blood' },
  craft: { trait: 'skilled', pressure: 'make something that lasts' },
  endurance: { trait: 'stubborn', pressure: 'outlast every hardship' },
  freedom: { trait: 'unbound', pressure: 'break inherited chains' },
  mercy: { trait: 'gentle', pressure: 'heal inherited wounds' },
  strength: { trait: 'unyielding', pressure: 'prove the family cannot be broken' }
}

const RESOLVE_SEED_BY_VALUE = {
  protection: 'guardian',
  kinship: 'guardian',
  justice: 'redeemer',
  compassion: 'healer',
  courage: 'guardian',
  cleverness: 'trickster',
  self_reliance: 'survivor',
  loyalty: 'guardian',
  survival: 'survivor',
  legacy: 'builder',
  status: 'builder',
  trade: 'builder',
  reputation: 'guardian',
  secrecy: 'trickster',
  stability: 'builder',
  neighborliness: 'guardian',
  absence: 'seeker',
  sacrifice: 'guardian',
  duty: 'guardian',
  vengeance: 'hunter',
  craft: 'builder',
  endurance: 'survivor',
  freedom: 'redeemer',
  mercy: 'healer',
  strength: 'guardian'
}

const FAMILY_LEGEND_TITLES_BY_VALUE = {
  protection: ['The Night Watch', 'The Door That Held'],
  kinship: ['The Unbroken Table', 'The Hand Across Winter'],
  justice: ['The Bell That Would Not Silence', 'The Debt of Truth'],
  compassion: ['The Bowl Passed On', 'The Mercy Road'],
  courage: ['The Stand at Dawn', 'The Shaking Blade'],
  cleverness: ['The False Key', 'The Three Names Trick'],
  self_reliance: ['The Empty Road', 'The One Who Needed No Lord'],
  loyalty: ['The Promise Kept', 'The Last Lantern'],
  survival: ['The Winter Crust', 'The Cellar Year'],
  legacy: ['The Fallen Crest', 'The Name Restored'],
  status: ['The Guest Seat', 'The Silk Vow'],
  trade: ['The Honest Weight', 'The Salt Bargain'],
  reputation: ['The Clean Ledger', 'The Witness Mark'],
  secrecy: ['The Hidden Room', 'The Name Under Stone'],
  stability: ['The Stone Threshold', 'The Year Nothing Broke'],
  neighborliness: ['The Open Gate', 'The Shared Roof'],
  absence: ['The Missing Footsteps', 'The Window Kept Lit'],
  sacrifice: ['The Meal Given Away', 'The Coat in Snow'],
  duty: ['The Burden Bell', 'The Chosen Watch'],
  vengeance: ['The Red Account', 'The Oath After Ash'],
  craft: ['The Last Good Nail', 'The Masterwork Scar'],
  endurance: ['The Long Hunger', 'The Unbent Back'],
  freedom: ['The Broken Chain', 'The Door Without Locks'],
  mercy: ['The Hand Stayed', 'The Wound Washed Clean'],
  strength: ['The Beam That Did Not Snap', 'The Stone-Lifter']
}

const ANCESTRAL_ITEM_BY_VALUE = {
  protection: { type: 'wood_shield', name: 'Watch Shield' },
  kinship: { type: 'bread', name: 'Table Loaf' },
  justice: { type: 'key', name: 'Witness Key' },
  compassion: { type: 'potion', name: 'Mercy Vial' },
  courage: { type: 'sword', name: 'Dawn Blade' },
  cleverness: { type: 'knife', name: 'False Key Knife' },
  self_reliance: { type: 'torch', name: 'Road Lantern' },
  loyalty: { type: 'torch', name: 'Last Lantern' },
  survival: { type: 'knife', name: 'Winter Knife' },
  legacy: { type: 'coin', name: 'Crest Coin' },
  status: { type: 'cloth_armor', name: 'Guest Cloth' },
  trade: { type: 'coin', name: 'Honest Weight Coin' },
  reputation: { type: 'key', name: 'Ledger Key' },
  secrecy: { type: 'key', name: 'Hidden Room Key' },
  stability: { type: 'hammer', name: 'Threshold Hammer' },
  neighborliness: { type: 'bread', name: 'Shared Roof Bread' },
  absence: { type: 'torch', name: 'Window Lantern' },
  sacrifice: { type: 'cloth_armor', name: 'Snow Coat' },
  duty: { type: 'hammer', name: 'Burden Hammer' },
  vengeance: { type: 'bow', name: 'Red Account Bow' },
  craft: { type: 'hammer', name: 'Masterwork Hammer' },
  endurance: { type: 'pickaxe', name: 'Unbent Pick' },
  freedom: { type: 'key', name: 'Broken Chain Key' },
  mercy: { type: 'potion', name: 'Washed Wound Vial' },
  strength: { type: 'club', name: 'Stone-Lifter Club' }
}

function pick(arr) { return randomElement(arr, Math.random) }

function pickUnique(arr, usedSet) {
  const available = arr.filter(n => !usedSet.has(n))
  const name = available.length > 0 ? pick(available) : pick(arr) + '\''
  usedSet.add(name)
  return name
}

function generateMixedHeritage(origin, primaryCulture) {
  const cultureByTag = {
    rural: 'eastern',
    urban: 'western',
    coastal: 'coastal',
    underground: 'underground'
  }
  const cultures = []
  for (const tag of origin.topTags || []) {
    const culture = cultureByTag[tag]
    if (culture && !cultures.includes(culture)) cultures.push(culture)
  }
  const secondaryCulture = cultures.find(culture => culture !== primaryCulture) || null
  if (!secondaryCulture) {
    return {
      mixed: false,
      primaryCulture,
      secondaryCulture: null,
      influences: [primaryCulture]
    }
  }
  return {
    mixed: true,
    primaryCulture,
    secondaryCulture,
    influences: [primaryCulture, secondaryCulture]
  }
}

/**
 * Generate a full origin from mapped tags.
 *
 * @param {object} origin - From mapTagsToOrigin()
 * @param {string} [suggestedName] - Player's suggested name
 * @returns {object} Full origin data
 */
export function generateOrigin(origin, suggestedName) {
  // Determine culture from town type
  const cultureMap = { village: 'eastern', city: 'western', port: 'coastal', underground: 'underground', town: 'eastern' }
  const culture = cultureMap[origin.townType] || 'eastern'

  // Family name
  const familyName = pick(FAMILY_NAMES[culture] || FAMILY_NAMES.eastern)
  const heritage = generateMixedHeritage(origin, culture)

  // Parents
  const parentTraitPool = origin.hardships.includes('loss') ? 'broken'
    : origin.socialStatus === 'poor' ? 'absent'
    : origin.familyType === 'orphan' ? 'absent'
    : 'kind'

  // Track all used names to prevent any collisions
  const usedNames = new Set()

  const mother = {
    name: pickUnique(FIRST_NAMES[culture].female, usedNames),
    familyName,
    traits: [pick(PARENT_TRAITS[parentTraitPool]), pick(PARENT_TRAITS.protective)],
    alive: origin.familyType !== 'orphan',
    role: 'parent'
  }

  const father = {
    name: pickUnique(FIRST_NAMES[culture].male, usedNames),
    familyName,
    traits: [pick(PARENT_TRAITS[origin.socialStatus === 'poor' ? 'strict' : 'kind'])],
    alive: origin.familyType !== 'orphan' && origin.familyType !== 'single_parent',
    role: 'parent'
  }

  // Name negotiation (before sibling so player name is also tracked)
  const nameResult = negotiateName(suggestedName, culture, familyName, mother)
  usedNames.add(nameResult.finalName)

  // Sibling (name must not collide with parents or player)
  const hasSibling = origin.topTags.includes('sibling_bond') || Math.random() < 0.5
  let sibling = null
  if (hasSibling) {
    const sibGender = Math.random() < 0.5 ? 'female' : 'male'
    sibling = {
      name: pickUnique(FIRST_NAMES[culture][sibGender], usedNames),
      familyName,
      age: Math.floor(uniformDistribution(6, 12, Math.random)),
      role: 'sibling'
    }
  }

  // Town
  const townNames = {
    village: ['Millhaven', 'Greenhollow', 'Dustfield', 'Sunridge'],
    city: ['Irongate', 'Ashwall', 'Grandport', 'Highspire'],
    port: ['Tidehollow', 'Saltmere', 'Driftwatch', 'Harborlight'],
    underground: ['Deepvault', 'Darkhollow', 'Ashpit', 'Irondelve'],
    town: ['Haven', 'Millbrook', 'Stonecross', 'Ridgeway']
  }
  const townName = pick(townNames[origin.townType] || townNames.town)

  // Childhood memory
  const memory = generateChildhoodMemory(mother, father, sibling, townName)

  // First crisis
  const crisis = selectCrisis(origin, townName, mother, father)

  // Family reputation
  const familyReputation = origin.socialStatus === 'poor' ? -15
    : origin.socialStatus === 'wealthy' ? 30
    : origin.socialStatus === 'outcast' ? -30
    : 0

  const familyWealth = origin.socialStatus === 'poor' ? 5
    : origin.socialStatus === 'wealthy' ? 80
    : origin.socialStatus === 'merchant' ? 40
    : 15

  const inheritedRelations = generateInheritedRelations(origin, crisis)
  const familyValues = generateFamilyValues(origin)
  const familyConflicts = generateFamilyConflicts(origin, crisis, familyValues)
  const familyGenerations = generateIntergenerationalRelationships(origin, familyName, culture, mother, father, sibling, nameResult, familyValues, familyConflicts, usedNames)

  return {
    culture,
    heritage,
    familyName,
    familyType: origin.familyType,
    socialStatus: origin.socialStatus,
    townName,
    townType: origin.townType,
    mother,
    father,
    sibling,
    nameResult,
    memory,
    crisis,
    familyReputation,
    familyWealth,
    lineage: familyGenerations.lineage,
    familyGenerations,
    inheritedTraits: familyGenerations.inheritedTraits || [],
    inheritedEnemies: inheritedRelations.enemies || [],
    inheritedRelations,
    familyValues,
    familyConflicts,
    resolveSeed: origin.resolveSeed,
    startingStorylets: origin.startingStorylets,
    topTags: origin.topTags
  }
}

function generateFamilyValues(origin) {
  const values = []
  const add = (value) => {
    if (value && !values.includes(value)) values.push(value)
  }

  for (const value of FAMILY_VALUES_BY_STATUS[origin.socialStatus] || FAMILY_VALUES_BY_STATUS.common) add(value)
  if (origin.familyType === 'orphan') add('absence')
  if (origin.familyType === 'single_parent') add('sacrifice')
  if (origin.familyType === 'large') add('duty')

  for (const tag of origin.topTags || []) add(FAMILY_VALUE_BY_TAG[tag])

  return values.slice(0, 4)
}

function generateFamilyConflicts(origin, crisis, familyValues) {
  const conflicts = []
  const add = (conflict) => {
    if (!conflicts.some(existing => existing.id === conflict.id)) conflicts.push(conflict)
  }

  if (origin.socialStatus === 'poor') {
    add({ id: 'scarcity_vs_dignity', pressure: 'survival', opposingValue: 'dignity', severity: 45, text: 'Your family argues over what dignity is worth when food is missing.' })
  }
  if (origin.socialStatus === 'wealthy') {
    add({ id: 'legacy_vs_freedom', pressure: 'expectation', opposingValue: 'freedom', severity: 35, text: 'Your family expects old privilege to be protected, even when you want your own path.' })
  }
  if (origin.socialStatus === 'outcast') {
    add({ id: 'secrecy_vs_belonging', pressure: 'suspicion', opposingValue: 'belonging', severity: 40, text: 'Your family survives by staying hidden, but isolation has a cost.' })
  }
  if (origin.familyType === 'orphan') {
    add({ id: 'absence_vs_identity', pressure: 'loss', opposingValue: 'lineage', severity: 50, text: 'No one can agree what your family name should still mean.' })
  }
  if (origin.familyType === 'single_parent') {
    add({ id: 'sacrifice_vs_resentment', pressure: 'burden', opposingValue: 'gratitude', severity: 35, text: 'One parent carried too much, and love sometimes sounds like resentment.' })
  }

  const crisisConflict = {
    debt: { id: 'debt_vs_honor', pressure: 'debt', opposingValue: 'honor', severity: 50, text: 'Old debts make every favor feel dangerous.' },
    betrayal: { id: 'trust_vs_suspicion', pressure: 'betrayal', opposingValue: 'trust', severity: 55, text: 'A betrayal taught your family to question every open hand.' },
    illness: { id: 'care_vs_exhaustion', pressure: 'illness', opposingValue: 'care', severity: 40, text: 'Sickness made care sacred, but exhaustion left scars.' },
    famine: { id: 'sharing_vs_survival', pressure: 'hunger', opposingValue: 'generosity', severity: 45, text: 'Hunger split the family between sharing and hoarding.' },
    raid: { id: 'vengeance_vs_safety', pressure: 'violence', opposingValue: 'safety', severity: 50, text: 'Some want revenge for the raid; others only want the family safe.' },
    disappearance: { id: 'hope_vs_acceptance', pressure: 'mystery', opposingValue: 'acceptance', severity: 45, text: 'A disappearance left the family trapped between hope and letting go.' }
  }[crisis.type]
  if (crisisConflict) add(crisisConflict)

  if (familyValues.includes('justice') && familyValues.includes('survival')) {
    add({ id: 'justice_vs_survival', pressure: 'unfairness', opposingValue: 'survival', severity: 35, text: 'Your family wants justice, but survival keeps demanding compromise.' })
  }

  return conflicts.slice(0, 3)
}

function generateIntergenerationalRelationships(origin, familyName, culture, mother, father, sibling, nameResult, familyValues, familyConflicts, usedNames) {
  const primaryValue = familyValues[0] || 'stability'
  const secondaryValue = familyValues[1] || primaryValue
  const primaryInfluence = GENERATIONAL_INFLUENCE_BY_VALUE[primaryValue] || GENERATIONAL_INFLUENCE_BY_VALUE.stability
  const secondaryInfluence = GENERATIONAL_INFLUENCE_BY_VALUE[secondaryValue] || primaryInfluence
  const lineage = `${familyName}, ${pick(LINEAGE_BY_CULTURE[culture] || LINEAGE_BY_CULTURE.eastern)}`

  const maternalGrandparent = {
    id: 'maternal_grandparent',
    name: pickUnique(FIRST_NAMES[culture].female.concat(FIRST_NAMES[culture].male), usedNames),
    relation: 'maternal grandparent',
    familyName,
    alive: origin.familyType !== 'orphan' && Math.random() < 0.65,
    inheritedTrait: primaryInfluence.trait,
    pressure: primaryInfluence.pressure,
    value: primaryValue,
    link: mother.alive ? mother.name : 'your missing mother'
  }

  const paternalGrandparent = {
    id: 'paternal_grandparent',
    name: pickUnique(FIRST_NAMES[culture].male.concat(FIRST_NAMES[culture].female), usedNames),
    relation: 'paternal grandparent',
    familyName,
    alive: father.alive && Math.random() < 0.55,
    inheritedTrait: secondaryInfluence.trait,
    pressure: secondaryInfluence.pressure,
    value: secondaryValue,
    link: father.alive ? father.name : 'your absent father'
  }

  const legacyPressure = familyConflicts[0]
    ? `${familyConflicts[0].pressure} shaped how older generations treated the family.`
    : `The older generations still expect you to ${primaryInfluence.pressure}.`
  const familyTree = buildFamilyTree(familyName, culture, mother, father, sibling, nameResult, maternalGrandparent, paternalGrandparent, primaryInfluence, secondaryInfluence, usedNames)
  const inheritedResolveSeeds = buildInheritedResolveSeeds([maternalGrandparent, paternalGrandparent], familyValues)
  const familyLegends = buildFamilyLegends([maternalGrandparent, paternalGrandparent], familyValues, familyConflicts, lineage)
  const ancestralItems = buildAncestralItems(familyLegends, [maternalGrandparent, paternalGrandparent], familyName)

  return {
    lineage,
    ancestors: [maternalGrandparent, paternalGrandparent],
    inheritedTraits: [maternalGrandparent.inheritedTrait, paternalGrandparent.inheritedTrait],
    inheritedResolveSeeds,
    familyLegends,
    ancestralItems,
    familyTree,
    legacyPressure
  }
}

function buildInheritedResolveSeeds(ancestors, familyValues) {
  const seeds = []
  const addSeed = (seed, source, strength) => {
    if (!seed) return
    const existing = seeds.find(item => item.seed === seed)
    if (existing) {
      existing.strength = Math.min(1, existing.strength + strength)
      existing.sources.push(source)
      return
    }
    seeds.push({ seed, strength, sources: [source] })
  }

  for (const ancestor of ancestors) {
    addSeed(RESOLVE_SEED_BY_VALUE[ancestor.value], {
      ancestorId: ancestor.id,
      ancestorName: ancestor.name,
      value: ancestor.value,
      trait: ancestor.inheritedTrait
    }, ancestor.alive ? 0.35 : 0.25)
  }

  for (const value of familyValues || []) {
    addSeed(RESOLVE_SEED_BY_VALUE[value], { value, trait: GENERATIONAL_INFLUENCE_BY_VALUE[value]?.trait || value }, 0.15)
  }

  return seeds
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3)
}

function buildFamilyLegends(ancestors, familyValues, familyConflicts, lineage) {
  const legends = []
  const values = familyValues?.length ? familyValues : ['stability']
  for (let i = 0; i < Math.min(2, values.length); i++) {
    const value = values[i]
    const ancestor = ancestors[i % ancestors.length]
    const titles = FAMILY_LEGEND_TITLES_BY_VALUE[value] || FAMILY_LEGEND_TITLES_BY_VALUE.stability
    const title = titles[i % titles.length]
    legends.push({
      id: `${value}_family_legend`,
      title,
      value,
      sourceAncestorId: ancestor.id,
      sourceAncestorName: ancestor.name,
      text: `${title}: ${ancestor.name} is remembered for choosing ${value.replace(/_/g, ' ')} when ${lineage} was tested.`,
      truth: i === 0 ? 'widely_told' : 'contested',
      renown: 60 - i * 10
    })
  }
  if (familyConflicts?.[0]) {
    const conflict = familyConflicts[0]
    legends.push({
      id: `${conflict.id}_legend`,
      title: `The ${conflict.pressure.replace(/_/g, ' ')} Lesson`,
      value: conflict.pressure,
      sourceAncestorId: ancestors[0]?.id || 'family_line',
      sourceAncestorName: ancestors[0]?.name || 'the family line',
      text: `${conflict.text} Older relatives still retell it as a warning.`,
      truth: 'contested',
      renown: Math.min(90, 45 + conflict.severity)
    })
  }
  return legends.slice(0, 3)
}

function buildAncestralItems(familyLegends, ancestors, familyName) {
  return (familyLegends || []).slice(0, 2).map((legend, index) => {
    const ancestor = ancestors.find(item => item.id === legend.sourceAncestorId) || ancestors[index % ancestors.length]
    const template = ANCESTRAL_ITEM_BY_VALUE[legend.value] || ANCESTRAL_ITEM_BY_VALUE.stability
    return {
      id: `${familyName.toLowerCase()}_${legend.id}_item`,
      type: template.type,
      name: `${familyName} ${template.name}`,
      sourceLegendId: legend.id,
      sourceLegendTitle: legend.title,
      sourceAncestorId: ancestor?.id || legend.sourceAncestorId,
      sourceAncestorName: ancestor?.name || legend.sourceAncestorName,
      emotionalWeight: Math.max(15, Math.round(legend.renown * 0.35)),
      history: legend.text,
      tags: ['ancestral', legend.value, template.type]
    }
  })
}

function buildFamilyTree(familyName, culture, mother, father, sibling, nameResult, maternalGrandparent, paternalGrandparent, primaryInfluence, secondaryInfluence, usedNames) {
  const namePool = FIRST_NAMES[culture].female.concat(FIRST_NAMES[culture].male)
  const makeAncestor = (id, relation, influence, branch, childIds) => ({
    id,
    name: pickUnique(namePool, usedNames),
    relation,
    familyName,
    generation: -3,
    alive: false,
    inheritedTrait: influence.trait,
    pressure: influence.pressure,
    value: branch === 'maternal' ? maternalGrandparent.value : paternalGrandparent.value,
    branch,
    childIds
  })

  const greatGrandparents = [
    makeAncestor('maternal_maternal_great_grandparent', 'maternal great-grandparent', primaryInfluence, 'maternal', ['maternal_grandparent']),
    makeAncestor('maternal_paternal_great_grandparent', 'maternal great-grandparent', primaryInfluence, 'maternal', ['maternal_grandparent']),
    makeAncestor('paternal_maternal_great_grandparent', 'paternal great-grandparent', secondaryInfluence, 'paternal', ['paternal_grandparent']),
    makeAncestor('paternal_paternal_great_grandparent', 'paternal great-grandparent', secondaryInfluence, 'paternal', ['paternal_grandparent'])
  ]

  const nodes = [
    ...greatGrandparents,
    { ...maternalGrandparent, generation: -2, branch: 'maternal', parentIds: ['maternal_maternal_great_grandparent', 'maternal_paternal_great_grandparent'], childIds: ['mother'] },
    { ...paternalGrandparent, generation: -2, branch: 'paternal', parentIds: ['paternal_maternal_great_grandparent', 'paternal_paternal_great_grandparent'], childIds: ['father'] },
    { id: 'mother', name: mother.name, relation: 'mother', familyName, generation: -1, alive: mother.alive, traits: mother.traits || [], branch: 'maternal', parentIds: ['maternal_grandparent'], childIds: sibling ? ['player', 'sibling'] : ['player'] },
    { id: 'father', name: father.name, relation: 'father', familyName, generation: -1, alive: father.alive, traits: father.traits || [], branch: 'paternal', parentIds: ['paternal_grandparent'], childIds: sibling ? ['player', 'sibling'] : ['player'] },
    { id: 'player', name: nameResult.finalName, relation: 'self', familyName, generation: 0, alive: true, parentIds: ['mother', 'father'], childIds: [] }
  ]

  if (sibling) {
    nodes.push({ id: 'sibling', name: sibling.name, relation: 'sibling', familyName, generation: 0, alive: true, parentIds: ['mother', 'father'], childIds: [] })
  }

  const links = []
  for (const node of nodes) {
    for (const childId of node.childIds || []) links.push({ from: node.id, to: childId, type: 'parent' })
  }

  return {
    rootId: 'player',
    generationCount: 4,
    branches: {
      maternal: ['maternal_maternal_great_grandparent', 'maternal_paternal_great_grandparent', 'maternal_grandparent', 'mother'],
      paternal: ['paternal_maternal_great_grandparent', 'paternal_paternal_great_grandparent', 'paternal_grandparent', 'father']
    },
    nodes,
    links
  }
}

function generateInheritedRelations(origin, crisis) {
  const socialOption = INHERITED_RELATION_OPTIONS[origin.socialStatus]
  const crisisOption = INHERITED_RELATION_OPTIONS[crisis.type]
  const allies = []
  const enemies = []

  const addUnique = (list, item) => {
    if (!list.some(existing => existing.entityId === item.entityId)) list.push(item)
  }

  for (const ally of crisisOption?.allies || []) addUnique(allies, ally)
  for (const enemy of crisisOption?.enemies || []) addUnique(enemies, enemy)
  for (const ally of socialOption?.allies || []) addUnique(allies, ally)
  for (const enemy of socialOption?.enemies || []) addUnique(enemies, enemy)

  if (allies.length === 0) addUnique(allies, { entityId: 'baker_olga', name: 'Olga', role: 'baker', trust: 15, reason: 'remembers your family kindly' })
  if (enemies.length === 0 && origin.socialStatus === 'poor') addUnique(enemies, { entityId: 'shopkeeper_varn', name: 'Varn', role: 'shopkeeper', resentment: 15, reason: 'looks down on your family poverty' })

  return { allies, enemies }
}

/**
 * Name negotiation: family/culture can accept, modify, nickname, or reject.
 */
function negotiateName(suggested, culture, familyName, mother) {
  if (!suggested || suggested.trim().length === 0) {
    // No suggestion — family picks
    const given = pick(FIRST_NAMES[culture].male.concat(FIRST_NAMES[culture].female))
    return {
      outcome: 'family_chosen',
      finalName: given,
      legalName: `${given} ${familyName}`,
      nickname: null,
      explanation: `${mother.name} chose the name ${given}.`
    }
  }

  const name = suggested.trim()
  const roll = Math.random()

  if (roll < 0.4) {
    // Accepted
    return {
      outcome: 'accepted',
      finalName: name,
      legalName: `${name} ${familyName}`,
      nickname: null,
      explanation: `${mother.name} smiled. "${name}. That's a good name."`
    }
  } else if (roll < 0.65) {
    // Modified — pick a culture-appropriate name, keep suggested as nickname
    const cultureName = pick(FIRST_NAMES[culture].male.concat(FIRST_NAMES[culture].female).filter(n => n !== mother.name))
    return {
      outcome: 'modified',
      finalName: cultureName,
      legalName: `${cultureName} ${familyName}`,
      nickname: name,
      explanation: `${mother.name} considered. "How about ${cultureName}? But we'll still call you ${name}."`
    }
  } else if (roll < 0.85) {
    // Nickname — legal name is cultural, suggested becomes nickname
    const legalFirst = pick(FIRST_NAMES[culture].male.concat(FIRST_NAMES[culture].female))
    return {
      outcome: 'nickname',
      finalName: legalFirst,
      legalName: `${legalFirst} ${familyName}`,
      nickname: name,
      explanation: `Your legal name is ${legalFirst}, but everyone calls you "${name}".`
    }
  } else {
    // Rejected — family picks, suggested is forgotten
    const given = pick(FIRST_NAMES[culture].male.concat(FIRST_NAMES[culture].female))
    return {
      outcome: 'rejected',
      finalName: given,
      legalName: `${given} ${familyName}`,
      nickname: null,
      explanation: `${mother.name} shook her head. "No. You will be ${given}."`
    }
  }
}

function generateChildhoodMemory(mother, father, sibling, town) {
  const eligible = CHILDHOOD_MEMORIES.filter(m => {
    if (m.type === 'bond' && !sibling) return false
    return true
  })

  const template = pick(eligible)
  let text = template.text
  text = text.replace('{parent}', mother.alive ? mother.name : (father.alive ? father.name : 'your caretaker'))
  text = text.replace('{sibling}', sibling ? sibling.name : 'your friend')
  text = text.replace('{landmark}', pick(LANDMARKS))
  text = text.replace('{item}', pick(SMALL_ITEMS))
  text = text.replace('{town}', town)

  return { type: template.type, text }
}

function selectCrisis(origin, town, mother, father) {
  // Pick crisis that matches hardships
  let pool = CRISIS_TYPES
  if (origin.hardships.length > 0) {
    const matching = CRISIS_TYPES.filter(c =>
      c.tags.some(t => origin.hardships.includes(t))
    )
    if (matching.length > 0) pool = matching
  }

  const crisis = pick(pool)
  let text = crisis.text
  text = text.replace('{town}', town)
  text = text.replace('{parent}', mother.alive ? mother.name : (father.alive ? father.name : 'your caretaker'))

  return { type: crisis.type, text, tags: crisis.tags }
}

export default { generateOrigin }
