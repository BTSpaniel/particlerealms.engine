// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Record primitives must not import workspace validation or its domain adapters.
export const newId = () => crypto.randomUUID();
export const cloneRecord = value => structuredClone(value);
export const timestamp = () => new Date().toISOString();
