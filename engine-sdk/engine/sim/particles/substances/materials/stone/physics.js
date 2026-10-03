// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  density: 2700,
  friction: 0.7,
  restitution: 0.3,
  solid:  { enableLJ: true, enableNBody: true },
  liquid: { enableLJ: true, enableSPH: true },
  gas:    { enableLJ: true },
  plasma: { enableEM: true, enableBlackbody: true },
};
