// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { randomElement } from '../../core/math/MathRandom.js'

/**
 * DialogueSystem — Dynamic narrative template system.
 *
 * Pipeline: event → intent → template → mood → voice layer → relationship tone → final line
 *
 * NPC speech uses templates, not generative AI. The voice layer changes
 * sentence length, glue words, confidence, politeness, swearing, emotional intensity.
 */

export const VoiceStyle = Object.freeze({
  BLUNT:      'blunt',
  NERVOUS:    'nervous',
  LOYAL:      'loyal',
  SARCASTIC:  'sarcastic',
  COLD:       'cold',
  FORMAL:     'formal',
  GENTLE:     'gentle',
  AGGRESSIVE: 'aggressive',
  CHILDISH:   'childish',
  ARROGANT:   'arrogant',
  HOPEFUL:    'hopeful',
  TIRED:      'tired',
  BROKEN:     'broken',
  ANIMAL:     'animal'
})

/**
 * Dialogue templates indexed by intent.
 * Each intent has base text and voice-style variants.
 */
const TEMPLATES = {
  greet: {
    base: 'Hello.',
    variants: {
      blunt: ['Hey.', 'What.', 'You again.'],
      nervous: ['Oh, h-hi...', 'Um, hello...', 'You startled me.'],
      loyal: ['Good to see you.', 'I\'m here.', 'Always.'],
      sarcastic: ['Oh, joy. You\'re here.', 'What an honor.', 'My favorite person.'],
      cold: ['...', 'What do you want.', 'Speak.'],
      formal: ['Greetings.', 'Welcome.', 'Good day.'],
      gentle: ['Hello, friend.', 'It\'s nice to see you.', 'How are you?'],
      aggressive: ['What do you want.', 'Don\'t waste my time.', 'Talk fast.'],
      childish: ['Hi hi!', 'Hey! Over here!', 'Hiya!'],
      arrogant: ['You may speak.', 'Ah. You.', 'I\'ll allow it.'],
      hopeful: ['Hey! I was hoping you\'d come.', 'Oh good, you\'re here.', 'I\'m glad you came.'],
      tired: ['...hey.', 'Oh. Hi.', 'Mm.'],
      broken: ['...', 'You\'re still here?', 'I didn\'t expect anyone.'],
      animal: ['Ruff.', 'Mrrp.', '*sniff*']
    }
  },
  danger_nearby: {
    base: 'Something is nearby.',
    variants: {
      blunt: ['Heads up. Something\'s close.', 'Watch it.'],
      nervous: ['I think something\'s close. We should not be here.', 'Did you hear that?!'],
      loyal: ['Stay behind me. I\'ll handle it.', 'I won\'t let anything happen to you.'],
      sarcastic: ['Oh great, company.', 'Because things weren\'t bad enough.'],
      cold: ['Threat detected.', 'Movement ahead.'],
      formal: ['I must inform you — there is danger nearby.', 'Please be cautious.'],
      gentle: ['Be careful... something is close.', 'Stay near me, okay?'],
      aggressive: ['Something\'s here. Get ready.', 'Finally. Something to hit.'],
      childish: ['Scary! Something\'s coming!', 'I don\'t like this...'],
      arrogant: ['How tedious. More obstacles.', 'I suppose I must deal with this.'],
      hopeful: ['We can handle this. Together.', 'Don\'t worry, we\'ve got this!'],
      tired: ['More trouble... of course.', 'Can we just... not?'],
      broken: ['It doesn\'t matter.', 'Let them come.'],
      animal: ['Grrr...', '*ears pin back*', '*low warning sound*']
    }
  },
  thank_you: {
    base: 'Thank you.',
    variants: {
      blunt: ['Thanks.', 'Appreciate it.'],
      nervous: ['T-thank you so much!', 'I... really appreciate this.'],
      loyal: ['I won\'t forget this.', 'You have my gratitude, always.'],
      sarcastic: ['Well, that was surprisingly useful.', 'I\'m almost impressed.'],
      cold: ['Noted.', 'Acceptable.'],
      formal: ['You have my sincere thanks.', 'I am in your debt.'],
      gentle: ['That was really kind of you.', 'Thank you from the bottom of my heart.'],
      aggressive: ['Yeah, thanks. Now let\'s move.', 'Good. Keep it up.'],
      childish: ['Thank you thank you thank you!', 'You\'re the best!'],
      arrogant: ['I suppose you did well. For once.', 'I\'ll remember this... perhaps.'],
      hopeful: ['See? Things are getting better!', 'Thank you. I knew we could do this.'],
      tired: ['Thanks... I needed that.', 'Mm. Thank you.'],
      broken: ['...thank you.', 'I didn\'t deserve that.'],
      animal: ['*happy tail flick*', '*content sound*', '*leans closer*']
    }
  },
  hungry: {
    base: 'I\'m hungry.',
    variants: {
      blunt: ['I need food.', 'Starving.'],
      nervous: ['My stomach is... I\'m so hungry.', 'Can we find food? Please?'],
      loyal: ['I can wait. You eat first.', 'Don\'t worry about me.'],
      sarcastic: ['Remember food? That thing we used to eat?', 'My kingdom for a crumb.'],
      cold: ['Sustenance required.', 'Fuel is low.'],
      gentle: ['I\'m getting a bit hungry...', 'Could we find something to eat?'],
      childish: ['Hungry! So hungry!', 'My tummy hurts...'],
      tired: ['Food would be nice... but so would sleep.', 'Too tired to be hungry. Almost.'],
      broken: ['I\'ve been hungry before. I can take it.', 'Doesn\'t matter.'],
      animal: ['*sniffs for food*', '*hungry whine*', '*watches your hands*']
    }
  },
  fear: {
    base: 'I\'m scared.',
    variants: {
      blunt: ['This is bad.', 'We need to go.'],
      nervous: ['I-I\'m scared... really scared.', 'Can we leave? Please?'],
      loyal: ['I\'m afraid, but I\'m not leaving you.', 'Even if I\'m scared... I\'ll stay.'],
      aggressive: ['I\'m not scared. I\'m angry.', 'Try me.'],
      childish: ['I don\'t want to be here!', 'I want to go home!'],
      hopeful: ['It\'s scary, but we\'ll make it.', 'We\'ve survived worse. ...haven\'t we?'],
      broken: ['Fear. I remember fear.', 'It doesn\'t get easier.'],
      animal: ['*backs away*', '*startled chirp*', '*tail goes low*']
    }
  },
  recruited: {
    base: 'I\'ll follow you.',
    variants: {
      blunt: ['Fine. Lead the way.', 'Let\'s go.'],
      nervous: ['O-okay... I\'ll try my best!', 'I hope I don\'t slow you down...'],
      loyal: ['Wherever you go, I follow.', 'You have my word.'],
      childish: ['Yay! Adventure!', 'I\'ll come with you!'],
      hopeful: ['This feels right. Let\'s do this.', 'Together. I like the sound of that.'],
      tired: ['Sure. Why not.', 'I was going to sit here forever anyway.'],
      broken: ['...okay.', 'I have nothing else.'],
      animal: ['*pads after you*', '*tail lifts*', '*stays close*']
    }
  },
  memory_reference: {
    base: 'I remember...',
    variants: {
      blunt: ['I remember what you did.', 'Don\'t think I forgot.'],
      nervous: ['I still think about... what happened.', 'I can\'t forget it.'],
      loyal: ['I remember when you saved me.', 'That day changed everything.'],
      gentle: ['I still carry that memory with me.', 'Some things stay with you.'],
      childish: ['Remember that time? That was crazy!', 'I\'ll never forget!'],
      broken: ['I wish I could forget.', 'The memories don\'t stop.'],
      animal: ['*recognizes your scent*', '*remembers this place*', '*watches you quietly*']
    }
  }
}

export class DialogueSystem {
  /**
   * @param {import('../../core/EntitySystem.js').EntitySystem} entitySystem
   */
  constructor(entitySystem) {
    this._entities = entitySystem
  }

  /**
   * Generate a dialogue line for an NPC given an intent and context.
   *
   * @param {string} entityId - NPC entity ID
   * @param {string} intent - Dialogue intent (greet, danger_nearby, thank_you, etc.)
   * @param {object} [context] - { targetId, mood, relationship }
   * @returns {object} { text, voice, mood, intent, speakerId }
   */
  generate(entityId, intent, context) {
    const entity = this._entities.get(entityId)
    if (!entity) return { text: '...', voice: 'neutral', mood: 'neutral', intent, speakerId: entityId }

    const profileVoice = entity.dialogue_profile.voiceLayer
    const voice = profileVoice && profileVoice !== 'neutral' ? profileVoice : (entity.personality.voiceStyle || 'blunt')
    const mood = this._getDominantMood(entity)

    // Get template
    const template = TEMPLATES[intent]
    if (!template) {
      return { text: '...', voice, mood, intent, speakerId: entityId }
    }

    // Pick variant by voice style
    let text
    const variants = template.variants[voice]
    if (variants && variants.length > 0) {
      text = randomElement(variants, Math.random)
    } else {
      text = template.base
    }

    // Mood modification
    text = this._applyMoodModifier(text, mood, entity)

    // Memory reference injection
    if (context && context.targetId && Math.random() < 0.2) {
      const memRef = this._getMemoryReference(entity, context.targetId)
      if (memRef) text += ' ' + memRef
    }

    return {
      text,
      voice,
      mood,
      intent,
      speakerId: entityId,
      speakerName: entity.identity.name
    }
  }

  /**
   * Get available intents for an NPC given current context.
   *
   * @param {string} entityId
   * @param {object} context
   * @returns {string[]}
   */
  getAvailableIntents(entityId, context) {
    const entity = this._entities.get(entityId)
    if (!entity) return ['greet']

    const intents = ['greet']
    if ((entity.mood.hunger || 0) > 50) intents.push('hungry')
    if ((entity.mood.fear || 0) > 40) intents.push('fear')
    if (context && context.dangerNearby) intents.push('danger_nearby')

    return intents
  }

  // ── Internal ──

  _getDominantMood(entity) {
    const m = entity.mood
    const moods = [
      { name: 'fear', v: m.fear || 0 },
      { name: 'anger', v: m.anger || 0 },
      { name: 'joy', v: m.joy || 0 },
      { name: 'stress', v: m.stress || 0 },
      { name: 'hope', v: m.hope || 0 }
    ]
    moods.sort((a, b) => b.v - a.v)
    return moods[0].v > 30 ? moods[0].name : 'neutral'
  }

  _applyMoodModifier(text, mood, entity) {
    // Add ellipsis for fear/stress
    if (mood === 'fear' && Math.random() < 0.3) {
      text = text.replace(/\.$/, '...')
    }
    // Add exclamation for anger
    if (mood === 'anger' && Math.random() < 0.3) {
      text = text.replace(/\.$/, '!')
    }
    return text
  }

  _getMemoryReference(entity, targetId) {
    const memories = entity.memories.keyMemories
    const relevant = memories.filter(m =>
      m.summary && m.summary.includes(targetId) && m.importance > 0.5
    )
    if (relevant.length === 0) return null

    const mem = randomElement(relevant, Math.random)
    const refs = [
      `I still remember... ${mem.summary.substring(0, 40)}`,
      `That reminds me of what happened before.`,
      `After everything we\'ve been through...`
    ]
    return randomElement(refs, Math.random)
  }
}

export default DialogueSystem
