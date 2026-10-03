// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  density: 7870,
  friction: 0.6,
  restitution: 0.4,
  solid:  { enableLJ: true, enableNBody: true },
  liquid: { enableLJ: true, enableSPH: true },
  gas:    { enableLJ: true },
  plasma: { enableEM: true, enableNBody: true, enableBlackbody: true },
};
