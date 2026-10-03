// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import identity from './identity.js';
import chemistry from './chemistry.js';
import thermal from './thermal.js';
import physics from './physics.js';
import sph from './sph.js';
import visual from './visual.js';
import emitter from './emitter.js';
import audio from './audio.js';
import decals from './decals.js';
import reactions from './reactions.js';
import spell from './spell.js';

export default { ...identity, chemistry, thermal, physics, sph, visual, emitter, audio, decals, reactions, spell };
