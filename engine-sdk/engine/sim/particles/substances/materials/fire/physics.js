// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  density: 0.3,
  friction: 0.0,
  restitution: 0.0,
  solid:  { enableLJ: true, enableNBody: true },
  liquid: { enableLJ: true },
  gas:    { enableLJ: true, enableChemistry: true },
  plasma: { enableEM: true, enableNBody: true, enableBlackbody: true },
};
