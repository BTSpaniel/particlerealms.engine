// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  onContact: {
    fire: { effect: 'steam_burst', killSelf: true, killOther: true, energy: 400 },
    lava: { effect: 'steam_burst', killSelf: true, killOther: false, energy: 1500 },
  },
  dissolves: [],
  freezeBelow: 0,
  evaporateAbove: 273,
};
