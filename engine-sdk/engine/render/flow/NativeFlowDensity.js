// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
/** The host exposes velocity sparse level 1; density is level 0. Pinned Flow
 * Sparse.cpp generates adjacent levels from the SAME locations/hash table:
 * level 0 has one more cell bit per axis and its global mapping begins exactly
 * numLocations words before level 1. Do not use velocity addresses on density.
 * Validate the native atlas dimensions so a future layout change fails loudly.
 */
export function densityMetadata(output, target, scale) {
    const level = output.level;
    if (!level || level.length !== 32 || !output.velocity?.size || !output.density?.size)
        throw new Error('Flow density view requires the verified native sparse layout');
    target.set(level);
    const floats = new Float32Array(target.buffer, target.byteOffset, target.length);
    for (let axis = 0; axis < 3; ++axis) {
        const velocityBits = level[4 + axis], densityBits = velocityBits + 1;
        if (velocityBits > 9 || level[axis] !== (1 << velocityBits) - 1
            || output.density.size[axis] * ((1 << velocityBits) + 2)
                !== output.velocity.size[axis] * ((1 << densityBits) + 2))
            throw new Error('Native Flow density/velocity atlas levels no longer match the verified layout');
        target[axis] = (1 << densityBits) - 1;
        target[4 + axis] = densityBits;
        target[24 + axis] = output.density.size[axis];
        floats[28 + axis] = 1 / output.density.size[axis];
        scale[axis] = 1 << densityBits;
    }
    target[3] = 1 << (target[4] + target[5] + target[6]);
    if (level[18] < level[7] || level[19] < level[7] * 32)
        throw new Error('Invalid native Flow sparse level offsets');
    target[18] -= level[7];
    target[19] -= level[7] * 32;
}

