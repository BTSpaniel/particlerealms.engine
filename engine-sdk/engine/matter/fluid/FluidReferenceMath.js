// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Small allocation-explicit vector helpers for deterministic CPU references. */

export const FLUID_REFERENCE_EPSILON = 1e-12;

export function addVector3(left, right) {
    return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

export function subtractVector3(left, right) {
    return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

export function scaleVector3(value, factor) {
    return [value[0] * factor, value[1] * factor, value[2] * factor];
}

export function dotVector3(left, right) {
    return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

export function crossVector3(left, right) {
    return [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    ];
}

export function vector3Length(value) {
    return Math.hypot(value[0], value[1], value[2]);
}

export function normalizeVector3(value, fallback = [0, 1, 0]) {
    const magnitude = vector3Length(value);
    return magnitude > FLUID_REFERENCE_EPSILON
        ? scaleVector3(value, 1 / magnitude)
        : [...fallback];
}

export function clampUnit(value) {
    return Math.max(0, Math.min(1, value));
}
