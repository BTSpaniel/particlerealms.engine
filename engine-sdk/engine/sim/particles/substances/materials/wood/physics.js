// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  density: 600,
  friction: 0.5,
  restitution: 0.2,
  solid:  { enableLJ: true, enableNBody: true },
  liquid: { enableLJ: true },
  gas:    { enableLJ: true, enableChemistry: true },
  plasma: { enableEM: true, enableBlackbody: true },
};
