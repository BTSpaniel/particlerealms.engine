// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Compatibility entry point. Implementation is split by vehicle subsystem in
// ./vehicle so existing engine and playground import paths remain stable.
export { createPhysXVehicle, isPhysXVehicleSupported } from './vehicle/index.js';
