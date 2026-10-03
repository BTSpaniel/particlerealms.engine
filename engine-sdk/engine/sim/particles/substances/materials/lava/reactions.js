// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  onContact: {
    water: { effect: 'steam_explosion', killSelf: false, killOther: true, energy: 2000 },
    ice: { effect: 'steam_burst', killSelf: false, killOther: true, energy: 1500 },
  },
  dissolves: [],
  freezeBelow: 1000,
  evaporateAbove: 2500,
};
