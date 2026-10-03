// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * engine/assets/rig/active-body/anatomy/index.js — anatomy subsystem barrel.
 *
 * Every other subsystem in the engine exposes a barrel (`voxel/index.js`,
 * `sim/ai/index.js`, `gameplay/perception/index.js`); the anatomy modules did
 * not, which is part of why they were unreachable from any compiled bundle.
 * This is purely additive — no module below is modified, and nothing that
 * already imports these files by path is affected.
 *
 * The subsystem models a body as interacting physiological systems rather
 * than a hit-point total:
 *
 * - `OrganSystem`        per-organ integrity, perfusion, oxygenation, function
 * - `OrganDamageSystem`  wounds by mechanism, bleeding, hypoxia, shock
 * - `CirculatorySystem`  cardiac output, per-limb and per-organ blood flow
 * - `NervousSystem`      spinal cord, 16 peripheral regions, motor authority,
 *                        and per-region motor/sensory/touch/pain channels
 * - `VitalSigns`         heart rate, respiration, blood pressure, SpO2
 * - `DiaphragmSystem`    breathing drive and rib/sternum coupling
 * - `BreathingBodyCoupling` breathing translated into bone pose offsets
 * - `SoftTissueSystem`   mass-spring tissue displacement and strain
 * - `PBPKSystem`         multi-compartment pharmacokinetics for any substance
 * - `BioelectricSignals` low-level signal propagation
 */

export * from './OrganSystem.js';
export * from './OrganDamageSystem.js';
export * from './CirculatorySystem.js';
export * from './NervousSystem.js';
export * from './VitalSigns.js';
export * from './DiaphragmSystem.js';
export * from './BreathingBodyCoupling.js';
export * from './SoftTissueSystem.js';
export * from './PBPKSystem.js';
export * from './BioelectricSignals.js';
