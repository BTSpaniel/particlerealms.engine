// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  density: 2500,
  friction: 0.8,
  restitution: 0.05,
  solid:  { enableLJ: true, enableNBody: true },
  liquid: { enableLJ: true, enableSPH: true, enableChemistry: true },
  gas:    { enableLJ: true },
  plasma: { enableEM: true, enableNBody: true, enableBlackbody: true },
};
