// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  onContact: {
    fire: { effect: 'steam_burst', killSelf: true, killOther: false, energy: 300 },
    lava: { effect: 'steam_burst', killSelf: true, killOther: false, energy: 1000 },
  },
  dissolves: [],
  freezeBelow: 0,
  evaporateAbove: 273,
};
