// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Core Storylet Library — Initial content for the StoryGraph.
 *
 * Each storylet has trigger conditions, cast selection, and execution logic.
 */

import { createStorylet, StoryletRarity } from '../StoryGraph.js'

export const CORE_STORYLETS = [
  createStorylet({
    id: 'food_shortage',
    name: 'Food Shortage',
    tags: ['survival', 'hunger', 'crisis'],
    priority: 7,
    rarity: StoryletRarity.COMMON,
    cooldown: 120000,
    locationVariants: {
      haven_market: 'Market stalls sit half-empty. The smell of bread is everywhere, but coin and kindness are both running thin.',
      haven_slums: 'In the slums, hunger moves from door to door like weather. Every cupboard sounds hollow.',
      haven_alley: 'In the alley shadows, hunger sharpens every glance. Someone nearby is already deciding what can be stolen.'
    },
    cultureVariants: {
      eastern: 'The rice jars are nearly empty. Hunger is not just a private shame now; the whole household feels it.',
      western: 'The pantry is bare, and the old road customs say a hungry house must either beg, buy, or take.',
      coastal: 'The nets brought in too little. Salt wind cannot fill a stomach, and the dockside prices keep rising.',
      underground: 'The ration lamps burn low. Below ground, an empty store-room can become a death sentence.'
    },
    canTrigger: (ws) => (ws.playerHunger || 0) > 50 && !ws.recentFoodShortage,
    execute: (ws) => ({
      narrative: 'Supplies are running low. The hunger is getting worse. You need to find food — or take it.',
      consequences: { hunger: +20, stress: +15, morale: -10 },
      memories: [{ type: 'hardship', summary: 'Food ran out again.', importance: 0.6, emotion: 'fear' }]
    }),
    description: 'Triggers when player hunger is high.'
  }),

  createStorylet({
    id: 'companion_questions',
    name: 'Companion Questions Your Actions',
    tags: ['social', 'dialogue', 'companion'],
    priority: 6,
    rarity: StoryletRarity.UNCOMMON,
    cooldown: 90000,
    relationshipVariants: {
      trusted: (ws) => `${ws.companionName || 'Your companion'} lowers their voice. "I trust you, so tell me the truth. Was there another way?"`,
      friendly: (ws) => `${ws.companionName || 'Your companion'} looks worried rather than angry. "I know you had reasons, but this scares me."`,
      wary: (ws) => `${ws.companionName || 'Your companion'} takes a step back. "I should have known you would do something like this."`,
      hostile: (ws) => `${ws.companionName || 'Your companion'} glares at you. "There it is. The person I was warned about."`
    },
    canTrigger: (ws) => ws.hasCompanion && (ws.recentCrimes || 0) > 0,
    selectCast: (ws) => ({ companion: ws.companionId }),
    execute: (ws, cast) => ({
      narrative: `${ws.companionName || 'Your companion'} looks at you differently. "What you did back there... was that really necessary?"`,
      consequences: { companionTrust: -5 },
      memories: [{ type: 'social', summary: 'Companion questioned my choices.', importance: 0.7, emotion: 'guilt' }]
    }),
    description: 'Companion questions player after crimes.'
  }),

  createStorylet({
    id: 'stranger_needs_help',
    name: 'Stranger Needs Help',
    tags: ['social', 'exploration', 'choice'],
    priority: 5,
    rarity: StoryletRarity.COMMON,
    cooldown: 180000,
    locationVariants: {
      haven_market: 'Between the market crates, you find someone clutching a torn sleeve. Shoppers step around them without slowing.',
      haven_forge: 'Near the forge heat, someone sits against the wall with soot on their face and a shaking hand held out.',
      haven_alley: 'A figure slumps in the alley dark. Help would be risky here; walking away would be easy.'
    },
    cultureVariants: {
      eastern: 'Someone bows too low from pain, trying not to shame anyone by asking for help.',
      western: 'A traveler by the road clutches a torn sleeve, caught between pride and pleading.',
      coastal: 'A dockhand with salt-cracked hands reaches for help before the tide crowd swallows them.',
      underground: 'A miner slumps beneath a lamp, one hand raised so the dark will not take them unnoticed.'
    },
    canTrigger: (ws) => ws.isExploring && Math.random() < 0.3,
    execute: (ws) => ({
      narrative: 'You find someone injured on the road. They reach out a trembling hand. Help could cost you supplies. Ignoring them costs nothing — except maybe something else.',
      choices: ['Help them (costs supplies)', 'Walk past'],
      consequences: { choice_required: true },
      memories: [{ type: 'encounter', summary: 'Found an injured stranger.', importance: 0.5, emotion: 'empathy' }]
    }),
    description: 'Random encounter — moral choice.'
  }),

  createStorylet({
    id: 'item_resonates',
    name: 'Item Begins to Resonate',
    tags: ['item_soul', 'mystery'],
    priority: 6,
    rarity: StoryletRarity.RARE,
    cooldown: 300000,
    maxFires: 3,
    canTrigger: (ws) => ws.hasUsedItemOften,
    execute: (ws) => ({
      narrative: 'Your most-used tool feels warm. Not from use — from something else. It hums faintly when you hold it still. Is it remembering?',
      consequences: { itemSoulProgress: true },
      memories: [{ type: 'item_soul', summary: 'My tool started resonating.', importance: 0.8, emotion: 'wonder' }]
    }),
    description: 'Fires when an item has been used frequently.'
  }),

  createStorylet({
    id: 'resolve_forming',
    name: 'Resolve Begins to Form',
    tags: ['resolve', 'identity', 'progression'],
    priority: 8,
    rarity: StoryletRarity.UNCOMMON,
    cooldown: 300000,
    maxFires: 1,
    canTrigger: (ws) => ws.resolveIntensity > 0.3 && ws.resolvePath,
    execute: (ws) => {
      const hints = {
        guardian: 'You catch yourself stepping between danger and those behind you. It\'s instinct now.',
        hunter: 'Your eyes track movement before your mind registers it. The hunt is becoming part of you.',
        burrower: 'Your hands know the earth. Every wall, every tunnel — they speak to you now.',
        street_survivor: 'You know every exit, every shadow. Survival isn\'t something you do — it\'s what you are.',
        redeemer: 'When you see chains, something burns. Not anger. Purpose.',
        warden: 'You look at every structure and see what it could become. What you could build.',
        trickster: 'The lie comes easier now. Not because you\'re bad — because you\'re good at it.'
      }
      return {
        narrative: hints[ws.resolvePath] || 'Something inside you is changing. Your actions are becoming your identity.',
        consequences: { resolveBoost: true },
        memories: [{ type: 'resolve', summary: `My resolve is forming: ${ws.resolvePath}.`, importance: 0.9, emotion: 'determination' }]
      }
    },
    description: 'First resolve awareness — fires once.'
  }),

  createStorylet({
    id: 'rumor_about_player',
    name: 'Rumor About You',
    tags: ['social', 'reputation'],
    priority: 5,
    rarity: StoryletRarity.COMMON,
    cooldown: 120000,
    locationVariants: {
      haven_market: 'A market whisper follows you between the stalls. Your name travels faster than your feet.',
      haven_hall: 'Inside Haven Hall, your reputation sounds more official. The whisper has weight here.',
      haven_alley: 'The alley rumor is uglier than the market version. Every retelling grows teeth.'
    },
    cultureVariants: {
      eastern: 'Your name passes from mouth to mouth with careful pauses, each retelling measuring honor and shame.',
      western: 'Your name is being weighed like coin: what you did, what it cost, and who profits by remembering.',
      coastal: 'Dockside rumor rides faster than gulls. By evening, every crew will have a version of you.',
      underground: 'Below-ground whispers carry through stone. By lamp-change, your name is in tunnels you have never walked.'
    },
    relationshipVariants: {
      trusted: 'Someone defends you before the rumor can turn ugly. "I know them. There is more to the story."',
      friendly: 'The rumor comes softened by people who want to believe better of you.',
      wary: 'The rumor finds ready ears. People who barely know you start filling in the worst parts.',
      hostile: 'Enemies repeat the rumor with satisfaction, polishing every detail into a weapon.'
    },
    canTrigger: (ws) => (ws.playerReputation || 0) !== 0,
    execute: (ws) => {
      const rep = ws.playerReputation || 0
      if (rep > 20) {
        return {
          narrative: 'You overhear someone talking about you. "That one? They helped the old baker last week. Good person." The words feel strange. Warm.',
          consequences: {},
          memories: [{ type: 'social', summary: 'People say good things about me.', importance: 0.5, emotion: 'pride' }]
        }
      } else {
        return {
          narrative: 'You catch a whisper. "...stole from the market. Watch your pockets." They don\'t see you listening. Your stomach tightens.',
          consequences: { suspicion: +5 },
          memories: [{ type: 'social', summary: 'People talk behind my back.', importance: 0.5, emotion: 'shame' }]
        }
      }
    },
    description: 'NPCs talk about the player based on reputation.'
  }),

  createStorylet({
    id: 'debt_collector',
    name: 'Debt Collector Arrives',
    tags: ['crime', 'faction', 'pressure'],
    priority: 7,
    rarity: StoryletRarity.UNCOMMON,
    cooldown: 240000,
    locationVariants: {
      haven_slums: 'The debt collector finds your door in the slums as if poverty itself gave directions.',
      haven_market: 'The collector corners your family near the market stalls, smiling where everyone can see.',
      haven_hall: 'In Haven Hall, the debt sounds clean and legal. That makes it worse.'
    },
    cultureVariants: {
      eastern: 'The collector names the debt like an old family stain, and every elder nearby pretends not to listen.',
      western: 'The collector carries papers, seals, and a smile sharp enough to make cruelty sound lawful.',
      coastal: 'The debt is counted in dock fees, spoiled nets, and favors owed to people who never forget.',
      underground: 'The collector speaks of ration shares and lamp oil. Underground, debt can cut off light itself.'
    },
    canTrigger: (ws) => ws.familyWealth < 10 && ws.socialStatus === 'poor',
    execute: (ws) => ({
      narrative: 'A tall figure appears at the door. "Your family owes. You have three days." The door closes. Your mother doesn\'t look at you.',
      consequences: { familyStress: +30, debt: true },
      memories: [{ type: 'hardship', summary: 'The debt collector came. Three days.', importance: 0.9, emotion: 'fear' }]
    }),
    description: 'Fires for poor families — debt pressure.'
  }),

  createStorylet({
    id: 'family_conflict_erupts',
    name: 'Family Conflict Erupts',
    tags: ['family', 'conflict', 'pressure'],
    priority: 7,
    rarity: StoryletRarity.UNCOMMON,
    cooldown: 210000,
    canTrigger: (ws) => ws.familyConflict && ws.hasParent && (ws.familyConflictSeverity || 0) >= 35,
    execute: (ws) => ({
      narrative: `${ws.parentName || 'Your parent'} cannot hold it in anymore. ${ws.familyConflictText || 'The family pressure finally breaks into the open.'}`,
      consequences: { familyStress: +20, playerStress: +10 },
      memories: [{ type: 'family_conflict', summary: ws.familyConflictText || 'A family argument erupted.', importance: 0.85, emotion: ws.familyConflictPressure || 'stress' }]
    }),
    description: 'Generated family conflict becomes active story content.'
  }),

  createStorylet({
    id: 'family_conflict_choice',
    name: 'Caught Between Family Demands',
    tags: ['family', 'choice', 'conflict'],
    priority: 8,
    rarity: StoryletRarity.RARE,
    cooldown: 300000,
    canTrigger: (ws) => ws.familyConflict && (ws.familyConflictSeverity || 0) >= 45,
    execute: (ws) => ({
      narrative: `The pressure at home sharpens into a choice. ${ws.familyConflictText || 'Your family wants two different futures from you.'}`,
      choices: [
        `Protect ${ws.familyOpposingValue || 'the family'} even if it costs you`,
        `Push back against the pressure and choose your own path`
      ],
      consequences: { choice_required: true, familyConflict: ws.familyConflictId || true },
      memories: [{ type: 'family_conflict', summary: `I had to choose how to answer ${ws.familyConflictPressure || 'family pressure'}.`, importance: 0.9, emotion: 'conflict' }]
    }),
    description: 'Escalated family conflict that forces a response.'
  }),

  createStorylet({
    id: 'sibling_in_danger',
    name: 'Sibling in Danger',
    tags: ['family', 'crisis', 'choice'],
    priority: 8,
    rarity: StoryletRarity.RARE,
    cooldown: 300000,
    relationshipVariants: {
      beloved: (ws) => `${ws.siblingName || 'Your sibling'} is missing, and love turns every heartbeat into panic.`,
      trusted: (ws) => `${ws.siblingName || 'Your sibling'} trusted you to notice. Now every delay feels like betrayal.`,
      wary: (ws) => `${ws.siblingName || 'Your sibling'} is gone, and old distance makes the fear harder to name.`
    },
    locationVariants: {
      haven_market: (ws) => `${ws.siblingName || 'Your sibling'} vanished somewhere between the market stalls. Too many people saw nothing.`,
      haven_slums: (ws) => `${ws.siblingName || 'Your sibling'} should have been back from the slums by now. The neighbors avoid your eyes.`,
      haven_alley: (ws) => `${ws.siblingName || 'Your sibling'} was last seen near the alley mouth. That is not a place children vanish safely.`
    },
    canTrigger: (ws) => ws.hasSibling && Math.random() < 0.2,
    execute: (ws) => ({
      narrative: `${ws.siblingName || 'Your sibling'} went to the market and hasn't come back. It's been hours. Something is wrong.`,
      consequences: { choice_required: true, urgency: 'high' },
      memories: [{ type: 'family', summary: 'My sibling went missing.', importance: 1.0, emotion: 'fear' }]
    }),
    description: 'Family crisis — sibling missing.'
  }),

  createStorylet({
    id: 'contract_test',
    name: 'Your Vow is Tested',
    tags: ['contract', 'resolve', 'choice'],
    priority: 9,
    rarity: StoryletRarity.LEGENDARY,
    cooldown: 600000,
    canTrigger: (ws) => ws.hasContract,
    execute: (ws) => ({
      narrative: 'The situation forces a choice. Keeping your vow means sacrifice. Breaking it would be easier — but what would that cost?',
      choices: ['Keep the vow (sacrifice)', 'Break the vow (easier path)'],
      consequences: { choice_required: true },
      memories: [{ type: 'contract', summary: 'My vow was tested.', importance: 1.0, emotion: 'conflict' }]
    }),
    description: 'Tests whether the player holds to their contract vow.'
  }),

  createStorylet({
    id: 'calm_moment',
    name: 'A Moment of Peace',
    tags: ['social', 'rest', 'relief'],
    priority: 3,
    rarity: StoryletRarity.COMMON,
    cooldown: 180000,
    canTrigger: (ws) => (ws.playerStress || 0) < 20 && (ws.recentFights || 0) === 0,
    execute: (ws) => ({
      narrative: 'For once, nothing is on fire. The evening is quiet. Someone nearby is humming. It\'s not much — but it\'s enough.',
      consequences: { stress: -10, morale: +10, hope: +5 },
      memories: [{ type: 'peace', summary: 'A rare moment of quiet.', importance: 0.4, emotion: 'peace' }]
    }),
    description: 'Relief event during calm periods.'
  })
]

export default CORE_STORYLETS
