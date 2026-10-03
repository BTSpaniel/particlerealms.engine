// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  onContact: {
    metal: { effect: 'corrode', killSelf: false, killOther: true, energy: 300 },
    wood: { effect: 'dissolve', killSelf: false, killOther: true, energy: 200 },
  },
  dissolves: ['metal', 'wood', 'stone'],
  freezeBelow: 200,
  evaporateAbove: 380,
};
