// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  density: 900,
  friction: 0.1,
  restitution: 0.05,
  solid:  { enableLJ: true },
  liquid: { enableLJ: true, enableSPH: true, enableChemistry: true },
  gas:    { enableLJ: true },
  plasma: { enableEM: true, enableBlackbody: true },
};
