// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { parsePronunciation } from './PronunciationLexicon.js';

/** Project-authored English defaults, not a learned dictionary. Names remain editable. */
export const DOMAIN_PRONUNCIATIONS = Object.freeze({
    navi: 'N AA2 V IY',
    // Operator reviewed 2026-09-04: "ZY-rah", rhyming with Myra.
    zyra: 'Z AY2 R AH',
    realmforge: 'R EH2 L M F AO1 R JH',
    realm: 'R EH2 L M',
    realms: 'R EH2 L M Z',
    echo: 'EH2 K OW',
    ai: 'EY1 AY2',
    webgpu: 'W EH2 B JH IY1 P IY1 Y UW1',
    storylet: 'S T AO2 R IY L EH1 T',
    storylets: 'S T AO2 R IY L EH1 T S',
    mailbox: 'M EY2 L B AA1 K S',
    mailboxes: 'M EY2 L B AA1 K S IH Z',
    avatar: 'AE2 V AH T AA1 R',
    agenda: 'AH JH EH2 N D AH',
    particle: 'P AA2 R T AH K AH L',
    cognition: 'K AA G N IH2 SH AH N',
});

/** Validate a candidate without changing any model. Stress 2 is primary, 1 secondary. */
export function reviewPronunciationCandidate(word, pronunciation) {
    if (typeof word !== 'string' || !/^[a-z]+(?:'[a-z]+)*$/i.test(word.trim()) || word.trim().length > 64) {
        throw new TypeError('A pronunciation override requires one English word (maximum 64 characters).');
    }
    if (typeof pronunciation !== 'string' || pronunciation.length > 512) {
        throw new TypeError('A pronunciation must contain at most 512 characters.');
    }
    const key = word.trim().toLowerCase();
    const canonical = pronunciation.trim().replace(/\s+/g, ' ');
    const parsed = parsePronunciation(canonical, key);
    if (parsed.phonemeIds.length > 64) throw new RangeError('A word may contain at most 64 phonemes.');
    return Object.freeze({ word: key, pronunciation: canonical, source: 'operator-review' });
}
