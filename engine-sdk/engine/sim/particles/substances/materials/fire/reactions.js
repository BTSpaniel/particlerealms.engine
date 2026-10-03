// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  onContact: {
    water: { effect: 'steam_burst', killSelf: true, killOther: false, energy: 500 },
    ice: { effect: 'steam_burst', killSelf: true, killOther: true, energy: 400 },
  },
  dissolves: [],
  freezeBelow: 0,
  evaporateAbove: 0,
};
