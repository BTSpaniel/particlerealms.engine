// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  density: 2200,
  friction: 0.6,
  restitution: 0.35,
  solid:  { enableLJ: true, enableNBody: true },
  liquid: { enableLJ: true },
  gas:    { enableLJ: true },
  plasma: { enableEM: true, enableBlackbody: true },
};
