// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  onContact: {
    fire: { effect: 'steam_burst', killSelf: false, killOther: true, energy: 500 },
    lava: { effect: 'steam_explosion', killSelf: true, killOther: false, energy: 2000 },
  },
  dissolves: ['salt', 'sugar'],
  freezeBelow: 273,
  evaporateAbove: 373,
};
