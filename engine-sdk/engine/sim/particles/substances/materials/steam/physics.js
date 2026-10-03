// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  density: 0.6,
  friction: 0.0,
  restitution: 0.0,
  solid:  {},
  liquid: { enableLJ: true, enableSPH: true },
  gas:    { enableLJ: true },
  plasma: { enableEM: true, enableBlackbody: true },
};
