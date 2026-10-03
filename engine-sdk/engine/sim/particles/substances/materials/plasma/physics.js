// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  density: 0.01,
  friction: 0.0,
  restitution: 0.0,
  solid:  {},
  liquid: {},
  gas:    { enableLJ: true },
  plasma: { enableEM: true, enableNBody: true, enableBlackbody: true },
};
