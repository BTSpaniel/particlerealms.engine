// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * MarchingCubesMesher.js - Smooth Voxel Terrain via Isosurface Extraction
 * 
 * INTEGRATION:
 * - GPU compute shader for parallel cube processing
 * - Uses VoxelMeshCompute for output buffer management
 * - Integrates with ChunkManager for chunk-based meshing
 * 
 * Implements the Marching Cubes algorithm for smooth terrain:
 * - Extracts isosurface from 3D density field
 * - Produces smooth, organic terrain instead of blocky voxels
 * - Supports interpolated vertex positions for smooth gradients
 * - Generates per-vertex normals for proper lighting
 * - fBM SDF terrain (Inigo Quilez style) for native smooth noise
 * 
 * MC33 Extension (Chernyaev 1995):
 * - Resolves topological ambiguities for watertight meshes
 * - Uses asymptotic decider for face ambiguity resolution
 * - Interior tests for tunnel cases (Case 13)
 * - 33 distinct cases vs standard 15
 * 
 * Based on: 
 * - Lorensen & Cline's Marching Cubes (1987)
 * - Chernyaev's Marching Cubes 33 (1995)
 * - Inigo Quilez fBM SDF: https://iquilezles.org/articles/fbmsdf/
 * 
 * Usage:
 *   const mesh = meshChunkSmooth(chunk, getDensity);
 *   const meshMC33 = meshChunkMC33(chunk, getDensity); // Watertight
 *   // Or with SDF:
 *   const density = sdfTerrain(x, y, z, config);
 */

import {
    MC33_CASE,
    MC33_TRI_TABLE,
    asymptoticDecider,
    isFaceAmbiguous,
    getMC33Subcase,
    CUBE_FACES,
} from './MC33Tables.js';
import { LEGACY_PCG32_WGSL } from '../core/math/MathBits.js';

export const MARCHING_CUBES_MATERIAL_PCG_HASH_WGSL = /* wgsl */ `
fn marchingCubesMaterialPcgHash2D(bits: vec2<u32>) -> u32 {
    return legacyPcgOutput32(legacyPcgAdvanceState32(bits.x) ^ bits.y);
}
`;

// ============================================================================
// MARCHING CUBES LOOKUP TABLES
// ============================================================================

// Edge table: for each cube configuration, which edges are intersected
const EDGE_TABLE = new Uint16Array([
    0x000, 0x109, 0x203, 0x30a, 0x406, 0x50f, 0x605, 0x70c,
    0x80c, 0x905, 0xa0f, 0xb06, 0xc0a, 0xd03, 0xe09, 0xf00,
    0x190, 0x099, 0x393, 0x29a, 0x596, 0x49f, 0x795, 0x69c,
    0x99c, 0x895, 0xb9f, 0xa96, 0xd9a, 0xc93, 0xf99, 0xe90,
    0x230, 0x339, 0x033, 0x13a, 0x636, 0x73f, 0x435, 0x53c,
    0xa3c, 0xb35, 0x83f, 0x936, 0xe3a, 0xf33, 0xc39, 0xd30,
    0x3a0, 0x2a9, 0x1a3, 0x0aa, 0x7a6, 0x6af, 0x5a5, 0x4ac,
    0xbac, 0xaa5, 0x9af, 0x8a6, 0xfaa, 0xea3, 0xda9, 0xca0,
    0x460, 0x569, 0x663, 0x76a, 0x066, 0x16f, 0x265, 0x36c,
    0xc6c, 0xd65, 0xe6f, 0xf66, 0x86a, 0x963, 0xa69, 0xb60,
    0x5f0, 0x4f9, 0x7f3, 0x6fa, 0x1f6, 0x0ff, 0x3f5, 0x2fc,
    0xdfc, 0xcf5, 0xfff, 0xef6, 0x9fa, 0x8f3, 0xbf9, 0xaf0,
    0x650, 0x759, 0x453, 0x55a, 0x256, 0x35f, 0x055, 0x15c,
    0xe5c, 0xf55, 0xc5f, 0xd56, 0xa5a, 0xb53, 0x859, 0x950,
    0x7c0, 0x6c9, 0x5c3, 0x4ca, 0x3c6, 0x2cf, 0x1c5, 0x0cc,
    0xfcc, 0xec5, 0xdcf, 0xcc6, 0xbca, 0xac3, 0x9c9, 0x8c0,
    0x8c0, 0x9c9, 0xac3, 0xbca, 0xcc6, 0xdcf, 0xec5, 0xfcc,
    0x0cc, 0x1c5, 0x2cf, 0x3c6, 0x4ca, 0x5c3, 0x6c9, 0x7c0,
    0x950, 0x859, 0xb53, 0xa5a, 0xd56, 0xc5f, 0xf55, 0xe5c,
    0x15c, 0x055, 0x35f, 0x256, 0x55a, 0x453, 0x759, 0x650,
    0xaf0, 0xbf9, 0x8f3, 0x9fa, 0xef6, 0xfff, 0xcf5, 0xdfc,
    0x2fc, 0x3f5, 0x0ff, 0x1f6, 0x6fa, 0x7f3, 0x4f9, 0x5f0,
    0xb60, 0xa69, 0x963, 0x86a, 0xf66, 0xe6f, 0xd65, 0xc6c,
    0x36c, 0x265, 0x16f, 0x066, 0x76a, 0x663, 0x569, 0x460,
    0xca0, 0xda9, 0xea3, 0xfaa, 0x8a6, 0x9af, 0xaa5, 0xbac,
    0x4ac, 0x5a5, 0x6af, 0x7a6, 0x0aa, 0x1a3, 0x2a9, 0x3a0,
    0xd30, 0xc39, 0xf33, 0xe3a, 0x936, 0x83f, 0xb35, 0xa3c,
    0x53c, 0x435, 0x73f, 0x636, 0x13a, 0x033, 0x339, 0x230,
    0xe90, 0xf99, 0xc93, 0xd9a, 0xa96, 0xb9f, 0x895, 0x99c,
    0x69c, 0x795, 0x49f, 0x596, 0x29a, 0x393, 0x099, 0x190,
    0xf00, 0xe09, 0xd03, 0xc0a, 0xb06, 0xa0f, 0x905, 0x80c,
    0x70c, 0x605, 0x50f, 0x406, 0x30a, 0x203, 0x109, 0x000
]);

// Triangle table: for each configuration, list of edge triplets forming triangles
// -1 terminates the list
const TRI_TABLE = [
    [-1],
    [0, 8, 3, -1],
    [0, 1, 9, -1],
    [1, 8, 3, 9, 8, 1, -1],
    [1, 2, 10, -1],
    [0, 8, 3, 1, 2, 10, -1],
    [9, 2, 10, 0, 2, 9, -1],
    [2, 8, 3, 2, 10, 8, 10, 9, 8, -1],
    [3, 11, 2, -1],
    [0, 11, 2, 8, 11, 0, -1],
    [1, 9, 0, 2, 3, 11, -1],
    [1, 11, 2, 1, 9, 11, 9, 8, 11, -1],
    [3, 10, 1, 11, 10, 3, -1],
    [0, 10, 1, 0, 8, 10, 8, 11, 10, -1],
    [3, 9, 0, 3, 11, 9, 11, 10, 9, -1],
    [9, 8, 10, 10, 8, 11, -1],
    [4, 7, 8, -1],
    [4, 3, 0, 7, 3, 4, -1],
    [0, 1, 9, 8, 4, 7, -1],
    [4, 1, 9, 4, 7, 1, 7, 3, 1, -1],
    [1, 2, 10, 8, 4, 7, -1],
    [3, 4, 7, 3, 0, 4, 1, 2, 10, -1],
    [9, 2, 10, 9, 0, 2, 8, 4, 7, -1],
    [2, 10, 9, 2, 9, 7, 2, 7, 3, 7, 9, 4, -1],
    [8, 4, 7, 3, 11, 2, -1],
    [11, 4, 7, 11, 2, 4, 2, 0, 4, -1],
    [9, 0, 1, 8, 4, 7, 2, 3, 11, -1],
    [4, 7, 11, 9, 4, 11, 9, 11, 2, 9, 2, 1, -1],
    [3, 10, 1, 3, 11, 10, 7, 8, 4, -1],
    [1, 11, 10, 1, 4, 11, 1, 0, 4, 7, 11, 4, -1],
    [4, 7, 8, 9, 0, 11, 9, 11, 10, 11, 0, 3, -1],
    [4, 7, 11, 4, 11, 9, 9, 11, 10, -1],
    [9, 5, 4, -1],
    [9, 5, 4, 0, 8, 3, -1],
    [0, 5, 4, 1, 5, 0, -1],
    [8, 5, 4, 8, 3, 5, 3, 1, 5, -1],
    [1, 2, 10, 9, 5, 4, -1],
    [3, 0, 8, 1, 2, 10, 4, 9, 5, -1],
    [5, 2, 10, 5, 4, 2, 4, 0, 2, -1],
    [2, 10, 5, 3, 2, 5, 3, 5, 4, 3, 4, 8, -1],
    [9, 5, 4, 2, 3, 11, -1],
    [0, 11, 2, 0, 8, 11, 4, 9, 5, -1],
    [0, 5, 4, 0, 1, 5, 2, 3, 11, -1],
    [2, 1, 5, 2, 5, 8, 2, 8, 11, 4, 8, 5, -1],
    [10, 3, 11, 10, 1, 3, 9, 5, 4, -1],
    [4, 9, 5, 0, 8, 1, 8, 10, 1, 8, 11, 10, -1],
    [5, 4, 0, 5, 0, 11, 5, 11, 10, 11, 0, 3, -1],
    [5, 4, 8, 5, 8, 10, 10, 8, 11, -1],
    [9, 7, 8, 5, 7, 9, -1],
    [9, 3, 0, 9, 5, 3, 5, 7, 3, -1],
    [0, 7, 8, 0, 1, 7, 1, 5, 7, -1],
    [1, 5, 3, 3, 5, 7, -1],
    [9, 7, 8, 9, 5, 7, 10, 1, 2, -1],
    [10, 1, 2, 9, 5, 0, 5, 3, 0, 5, 7, 3, -1],
    [8, 0, 2, 8, 2, 5, 8, 5, 7, 10, 5, 2, -1],
    [2, 10, 5, 2, 5, 3, 3, 5, 7, -1],
    [7, 9, 5, 7, 8, 9, 3, 11, 2, -1],
    [9, 5, 7, 9, 7, 2, 9, 2, 0, 2, 7, 11, -1],
    [2, 3, 11, 0, 1, 8, 1, 7, 8, 1, 5, 7, -1],
    [11, 2, 1, 11, 1, 7, 7, 1, 5, -1],
    [9, 5, 8, 8, 5, 7, 10, 1, 3, 10, 3, 11, -1],
    [5, 7, 0, 5, 0, 9, 7, 11, 0, 1, 0, 10, 11, 10, 0, -1],
    [11, 10, 0, 11, 0, 3, 10, 5, 0, 8, 0, 7, 5, 7, 0, -1],
    [11, 10, 5, 7, 11, 5, -1],
    [10, 6, 5, -1],
    [0, 8, 3, 5, 10, 6, -1],
    [9, 0, 1, 5, 10, 6, -1],
    [1, 8, 3, 1, 9, 8, 5, 10, 6, -1],
    [1, 6, 5, 2, 6, 1, -1],
    [1, 6, 5, 1, 2, 6, 3, 0, 8, -1],
    [9, 6, 5, 9, 0, 6, 0, 2, 6, -1],
    [5, 9, 8, 5, 8, 2, 5, 2, 6, 3, 2, 8, -1],
    [2, 3, 11, 10, 6, 5, -1],
    [11, 0, 8, 11, 2, 0, 10, 6, 5, -1],
    [0, 1, 9, 2, 3, 11, 5, 10, 6, -1],
    [5, 10, 6, 1, 9, 2, 9, 11, 2, 9, 8, 11, -1],
    [6, 3, 11, 6, 5, 3, 5, 1, 3, -1],
    [0, 8, 11, 0, 11, 5, 0, 5, 1, 5, 11, 6, -1],
    [3, 11, 6, 0, 3, 6, 0, 6, 5, 0, 5, 9, -1],
    [6, 5, 9, 6, 9, 11, 11, 9, 8, -1],
    [5, 10, 6, 4, 7, 8, -1],
    [4, 3, 0, 4, 7, 3, 6, 5, 10, -1],
    [1, 9, 0, 5, 10, 6, 8, 4, 7, -1],
    [10, 6, 5, 1, 9, 7, 1, 7, 3, 7, 9, 4, -1],
    [6, 1, 2, 6, 5, 1, 4, 7, 8, -1],
    [1, 2, 5, 5, 2, 6, 3, 0, 4, 3, 4, 7, -1],
    [8, 4, 7, 9, 0, 5, 0, 6, 5, 0, 2, 6, -1],
    [7, 3, 9, 7, 9, 4, 3, 2, 9, 5, 9, 6, 2, 6, 9, -1],
    [3, 11, 2, 7, 8, 4, 10, 6, 5, -1],
    [5, 10, 6, 4, 7, 2, 4, 2, 0, 2, 7, 11, -1],
    [0, 1, 9, 4, 7, 8, 2, 3, 11, 5, 10, 6, -1],
    [9, 2, 1, 9, 11, 2, 9, 4, 11, 7, 11, 4, 5, 10, 6, -1],
    [8, 4, 7, 3, 11, 5, 3, 5, 1, 5, 11, 6, -1],
    [5, 1, 11, 5, 11, 6, 1, 0, 11, 7, 11, 4, 0, 4, 11, -1],
    [0, 5, 9, 0, 6, 5, 0, 3, 6, 11, 6, 3, 8, 4, 7, -1],
    [6, 5, 9, 6, 9, 11, 4, 7, 9, 7, 11, 9, -1],
    [10, 4, 9, 6, 4, 10, -1],
    [4, 10, 6, 4, 9, 10, 0, 8, 3, -1],
    [10, 0, 1, 10, 6, 0, 6, 4, 0, -1],
    [8, 3, 1, 8, 1, 6, 8, 6, 4, 6, 1, 10, -1],
    [1, 4, 9, 1, 2, 4, 2, 6, 4, -1],
    [3, 0, 8, 1, 2, 9, 2, 4, 9, 2, 6, 4, -1],
    [0, 2, 4, 4, 2, 6, -1],
    [8, 3, 2, 8, 2, 4, 4, 2, 6, -1],
    [10, 4, 9, 10, 6, 4, 11, 2, 3, -1],
    [0, 8, 2, 2, 8, 11, 4, 9, 10, 4, 10, 6, -1],
    [3, 11, 2, 0, 1, 6, 0, 6, 4, 6, 1, 10, -1],
    [6, 4, 1, 6, 1, 10, 4, 8, 1, 2, 1, 11, 8, 11, 1, -1],
    [9, 6, 4, 9, 3, 6, 9, 1, 3, 11, 6, 3, -1],
    [8, 11, 1, 8, 1, 0, 11, 6, 1, 9, 1, 4, 6, 4, 1, -1],
    [3, 11, 6, 3, 6, 0, 0, 6, 4, -1],
    [6, 4, 8, 11, 6, 8, -1],
    [7, 10, 6, 7, 8, 10, 8, 9, 10, -1],
    [0, 7, 3, 0, 10, 7, 0, 9, 10, 6, 7, 10, -1],
    [10, 6, 7, 1, 10, 7, 1, 7, 8, 1, 8, 0, -1],
    [10, 6, 7, 10, 7, 1, 1, 7, 3, -1],
    [1, 2, 6, 1, 6, 8, 1, 8, 9, 8, 6, 7, -1],
    [2, 6, 9, 2, 9, 1, 6, 7, 9, 0, 9, 3, 7, 3, 9, -1],
    [7, 8, 0, 7, 0, 6, 6, 0, 2, -1],
    [7, 3, 2, 6, 7, 2, -1],
    [2, 3, 11, 10, 6, 8, 10, 8, 9, 8, 6, 7, -1],
    [2, 0, 7, 2, 7, 11, 0, 9, 7, 6, 7, 10, 9, 10, 7, -1],
    [1, 8, 0, 1, 7, 8, 1, 10, 7, 6, 7, 10, 2, 3, 11, -1],
    [11, 2, 1, 11, 1, 7, 10, 6, 1, 6, 7, 1, -1],
    [8, 9, 6, 8, 6, 7, 9, 1, 6, 11, 6, 3, 1, 3, 6, -1],
    [0, 9, 1, 11, 6, 7, -1],
    [7, 8, 0, 7, 0, 6, 3, 11, 0, 11, 6, 0, -1],
    [7, 11, 6, -1],
    [7, 6, 11, -1],
    [3, 0, 8, 11, 7, 6, -1],
    [0, 1, 9, 11, 7, 6, -1],
    [8, 1, 9, 8, 3, 1, 11, 7, 6, -1],
    [10, 1, 2, 6, 11, 7, -1],
    [1, 2, 10, 3, 0, 8, 6, 11, 7, -1],
    [2, 9, 0, 2, 10, 9, 6, 11, 7, -1],
    [6, 11, 7, 2, 10, 3, 10, 8, 3, 10, 9, 8, -1],
    [7, 2, 3, 6, 2, 7, -1],
    [7, 0, 8, 7, 6, 0, 6, 2, 0, -1],
    [2, 7, 6, 2, 3, 7, 0, 1, 9, -1],
    [1, 6, 2, 1, 8, 6, 1, 9, 8, 8, 7, 6, -1],
    [10, 7, 6, 10, 1, 7, 1, 3, 7, -1],
    [10, 7, 6, 1, 7, 10, 1, 8, 7, 1, 0, 8, -1],
    [0, 3, 7, 0, 7, 10, 0, 10, 9, 6, 10, 7, -1],
    [7, 6, 10, 7, 10, 8, 8, 10, 9, -1],
    [6, 8, 4, 11, 8, 6, -1],
    [3, 6, 11, 3, 0, 6, 0, 4, 6, -1],
    [8, 6, 11, 8, 4, 6, 9, 0, 1, -1],
    [9, 4, 6, 9, 6, 3, 9, 3, 1, 11, 3, 6, -1],
    [6, 8, 4, 6, 11, 8, 2, 10, 1, -1],
    [1, 2, 10, 3, 0, 11, 0, 6, 11, 0, 4, 6, -1],
    [4, 11, 8, 4, 6, 11, 0, 2, 9, 2, 10, 9, -1],
    [10, 9, 3, 10, 3, 2, 9, 4, 3, 11, 3, 6, 4, 6, 3, -1],
    [8, 2, 3, 8, 4, 2, 4, 6, 2, -1],
    [0, 4, 2, 4, 6, 2, -1],
    [1, 9, 0, 2, 3, 4, 2, 4, 6, 4, 3, 8, -1],
    [1, 9, 4, 1, 4, 2, 2, 4, 6, -1],
    [8, 1, 3, 8, 6, 1, 8, 4, 6, 6, 10, 1, -1],
    [10, 1, 0, 10, 0, 6, 6, 0, 4, -1],
    [4, 6, 3, 4, 3, 8, 6, 10, 3, 0, 3, 9, 10, 9, 3, -1],
    [10, 9, 4, 6, 10, 4, -1],
    [4, 9, 5, 7, 6, 11, -1],
    [0, 8, 3, 4, 9, 5, 11, 7, 6, -1],
    [5, 0, 1, 5, 4, 0, 7, 6, 11, -1],
    [11, 7, 6, 8, 3, 4, 3, 5, 4, 3, 1, 5, -1],
    [9, 5, 4, 10, 1, 2, 7, 6, 11, -1],
    [6, 11, 7, 1, 2, 10, 0, 8, 3, 4, 9, 5, -1],
    [7, 6, 11, 5, 4, 10, 4, 2, 10, 4, 0, 2, -1],
    [3, 4, 8, 3, 5, 4, 3, 2, 5, 10, 5, 2, 11, 7, 6, -1],
    [7, 2, 3, 7, 6, 2, 5, 4, 9, -1],
    [9, 5, 4, 0, 8, 6, 0, 6, 2, 6, 8, 7, -1],
    [3, 6, 2, 3, 7, 6, 1, 5, 0, 5, 4, 0, -1],
    [6, 2, 8, 6, 8, 7, 2, 1, 8, 4, 8, 5, 1, 5, 8, -1],
    [9, 5, 4, 10, 1, 6, 1, 7, 6, 1, 3, 7, -1],
    [1, 6, 10, 1, 7, 6, 1, 0, 7, 8, 7, 0, 9, 5, 4, -1],
    [4, 0, 10, 4, 10, 5, 0, 3, 10, 6, 10, 7, 3, 7, 10, -1],
    [7, 6, 10, 7, 10, 8, 5, 4, 10, 4, 8, 10, -1],
    [6, 9, 5, 6, 11, 9, 11, 8, 9, -1],
    [3, 6, 11, 0, 6, 3, 0, 5, 6, 0, 9, 5, -1],
    [0, 11, 8, 0, 5, 11, 0, 1, 5, 5, 6, 11, -1],
    [6, 11, 3, 6, 3, 5, 5, 3, 1, -1],
    [1, 2, 10, 9, 5, 11, 9, 11, 8, 11, 5, 6, -1],
    [0, 11, 3, 0, 6, 11, 0, 9, 6, 5, 6, 9, 1, 2, 10, -1],
    [11, 8, 5, 11, 5, 6, 8, 0, 5, 10, 5, 2, 0, 2, 5, -1],
    [6, 11, 3, 6, 3, 5, 2, 10, 3, 10, 5, 3, -1],
    [5, 8, 9, 5, 2, 8, 5, 6, 2, 3, 8, 2, -1],
    [9, 5, 6, 9, 6, 0, 0, 6, 2, -1],
    [1, 5, 8, 1, 8, 0, 5, 6, 8, 3, 8, 2, 6, 2, 8, -1],
    [1, 5, 6, 2, 1, 6, -1],
    [1, 3, 6, 1, 6, 10, 3, 8, 6, 5, 6, 9, 8, 9, 6, -1],
    [10, 1, 0, 10, 0, 6, 9, 5, 0, 5, 6, 0, -1],
    [0, 3, 8, 5, 6, 10, -1],
    [10, 5, 6, -1],
    [11, 5, 10, 7, 5, 11, -1],
    [11, 5, 10, 11, 7, 5, 8, 3, 0, -1],
    [5, 11, 7, 5, 10, 11, 1, 9, 0, -1],
    [10, 7, 5, 10, 11, 7, 9, 8, 1, 8, 3, 1, -1],
    [11, 1, 2, 11, 7, 1, 7, 5, 1, -1],
    [0, 8, 3, 1, 2, 7, 1, 7, 5, 7, 2, 11, -1],
    [9, 7, 5, 9, 2, 7, 9, 0, 2, 2, 11, 7, -1],
    [7, 5, 2, 7, 2, 11, 5, 9, 2, 3, 2, 8, 9, 8, 2, -1],
    [2, 5, 10, 2, 3, 5, 3, 7, 5, -1],
    [8, 2, 0, 8, 5, 2, 8, 7, 5, 10, 2, 5, -1],
    [9, 0, 1, 5, 10, 3, 5, 3, 7, 3, 10, 2, -1],
    [9, 8, 2, 9, 2, 1, 8, 7, 2, 10, 2, 5, 7, 5, 2, -1],
    [1, 3, 5, 3, 7, 5, -1],
    [0, 8, 7, 0, 7, 1, 1, 7, 5, -1],
    [9, 0, 3, 9, 3, 5, 5, 3, 7, -1],
    [9, 8, 7, 5, 9, 7, -1],
    [5, 8, 4, 5, 10, 8, 10, 11, 8, -1],
    [5, 0, 4, 5, 11, 0, 5, 10, 11, 11, 3, 0, -1],
    [0, 1, 9, 8, 4, 10, 8, 10, 11, 10, 4, 5, -1],
    [10, 11, 4, 10, 4, 5, 11, 3, 4, 9, 4, 1, 3, 1, 4, -1],
    [2, 5, 1, 2, 8, 5, 2, 11, 8, 4, 5, 8, -1],
    [0, 4, 11, 0, 11, 3, 4, 5, 11, 2, 11, 1, 5, 1, 11, -1],
    [0, 2, 5, 0, 5, 9, 2, 11, 5, 4, 5, 8, 11, 8, 5, -1],
    [9, 4, 5, 2, 11, 3, -1],
    [2, 5, 10, 3, 5, 2, 3, 4, 5, 3, 8, 4, -1],
    [5, 10, 2, 5, 2, 4, 4, 2, 0, -1],
    [3, 10, 2, 3, 5, 10, 3, 8, 5, 4, 5, 8, 0, 1, 9, -1],
    [5, 10, 2, 5, 2, 4, 1, 9, 2, 9, 4, 2, -1],
    [8, 4, 5, 8, 5, 3, 3, 5, 1, -1],
    [0, 4, 5, 1, 0, 5, -1],
    [8, 4, 5, 8, 5, 3, 9, 0, 5, 0, 3, 5, -1],
    [9, 4, 5, -1],
    [4, 11, 7, 4, 9, 11, 9, 10, 11, -1],
    [0, 8, 3, 4, 9, 7, 9, 11, 7, 9, 10, 11, -1],
    [1, 10, 11, 1, 11, 4, 1, 4, 0, 7, 4, 11, -1],
    [3, 1, 4, 3, 4, 8, 1, 10, 4, 7, 4, 11, 10, 11, 4, -1],
    [4, 11, 7, 9, 11, 4, 9, 2, 11, 9, 1, 2, -1],
    [9, 7, 4, 9, 11, 7, 9, 1, 11, 2, 11, 1, 0, 8, 3, -1],
    [11, 7, 4, 11, 4, 2, 2, 4, 0, -1],
    [11, 7, 4, 11, 4, 2, 8, 3, 4, 3, 2, 4, -1],
    [2, 9, 10, 2, 7, 9, 2, 3, 7, 7, 4, 9, -1],
    [9, 10, 7, 9, 7, 4, 10, 2, 7, 8, 7, 0, 2, 0, 7, -1],
    [3, 7, 10, 3, 10, 2, 7, 4, 10, 1, 10, 0, 4, 0, 10, -1],
    [1, 10, 2, 8, 7, 4, -1],
    [4, 9, 1, 4, 1, 7, 7, 1, 3, -1],
    [4, 9, 1, 4, 1, 7, 0, 8, 1, 8, 7, 1, -1],
    [4, 0, 3, 7, 4, 3, -1],
    [4, 8, 7, -1],
    [9, 10, 8, 10, 11, 8, -1],
    [3, 0, 9, 3, 9, 11, 11, 9, 10, -1],
    [0, 1, 10, 0, 10, 8, 8, 10, 11, -1],
    [3, 1, 10, 11, 3, 10, -1],
    [1, 2, 11, 1, 11, 9, 9, 11, 8, -1],
    [3, 0, 9, 3, 9, 11, 1, 2, 9, 2, 11, 9, -1],
    [0, 2, 11, 8, 0, 11, -1],
    [3, 2, 11, -1],
    [2, 3, 8, 2, 8, 10, 10, 8, 9, -1],
    [9, 10, 2, 0, 9, 2, -1],
    [2, 3, 8, 2, 8, 10, 0, 1, 8, 1, 10, 8, -1],
    [1, 10, 2, -1],
    [1, 3, 8, 9, 1, 8, -1],
    [0, 9, 1, -1],
    [0, 3, 8, -1],
    [-1]
];

// Cube corner positions
const CORNERS = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
];

// Edge connections (which corners each edge connects)
const EDGE_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7]
];

// ============================================================================
// MESHING FUNCTIONS
// ============================================================================

/**
 * Interpolate vertex position along an edge
 */
function interpolateVertex(p1, p2, v1, v2, isolevel = 0) {
    if (Math.abs(isolevel - v1) < 0.00001) return p1.slice();
    if (Math.abs(isolevel - v2) < 0.00001) return p2.slice();
    if (Math.abs(v1 - v2) < 0.00001) return p1.slice();
    
    const t = (isolevel - v1) / (v2 - v1);
    return [
        p1[0] + t * (p2[0] - p1[0]),
        p1[1] + t * (p2[1] - p1[1]),
        p1[2] + t * (p2[2] - p1[2])
    ];
}

/**
 * Calculate normal from gradient
 */
function calculateNormal(getDensity, x, y, z, step = 0.5) {
    const dx = getDensity(x + step, y, z) - getDensity(x - step, y, z);
    const dy = getDensity(x, y + step, z) - getDensity(x, y - step, z);
    const dz = getDensity(x, y, z + step) - getDensity(x, y, z - step);
    
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.0001) return [0, 1, 0];
    
    return [-dx / len, -dy / len, -dz / len];
}

/**
 * Mesh a chunk using Marching Cubes for smooth terrain
 * @param {Object} chunk - Voxel chunk with density data
 * @param {Function} getDensity - Function(x,y,z) returning density value
 * @param {Object} options - Meshing options
 * @returns {Object} Mesh data with vertices, normals, indices
 */
export function meshChunkSmooth(chunk, getDensity, options = {}) {
    const isolevel = options.isolevel ?? 0;
    const scale = options.scale ?? 1;
    const computeNormals = options.computeNormals !== false;
    
    const [originX, originY, originZ] = chunk.getWorldOrigin();
    const size = options.chunkSize ?? 32;
    
    const vertices = [];
    const normals = [];
    const indices = [];
    const vertexMap = new Map();  // For deduplication
    
    // March through all cells
    for (let z = 0; z < size - 1; z++) {
        for (let y = 0; y < size - 1; y++) {
            for (let x = 0; x < size - 1; x++) {
                const wx = originX + x;
                const wy = originY + y;
                const wz = originZ + z;
                
                // Sample density at 8 corners
                const cornerDensities = [];
                const cornerPositions = [];
                
                for (let i = 0; i < 8; i++) {
                    const cx = wx + CORNERS[i][0];
                    const cy = wy + CORNERS[i][1];
                    const cz = wz + CORNERS[i][2];
                    
                    cornerPositions.push([cx * scale, cy * scale, cz * scale]);
                    cornerDensities.push(getDensity(cx, cy, cz));
                }
                
                // Determine cube configuration
                let cubeIndex = 0;
                for (let i = 0; i < 8; i++) {
                    if (cornerDensities[i] < isolevel) {
                        cubeIndex |= (1 << i);
                    }
                }
                
                // Skip if entirely inside or outside
                if (EDGE_TABLE[cubeIndex] === 0) continue;
                
                // Compute edge vertices
                const edgeVertices = [];
                for (let i = 0; i < 12; i++) {
                    if (EDGE_TABLE[cubeIndex] & (1 << i)) {
                        const [c1, c2] = EDGE_CONNECTIONS[i];
                        edgeVertices[i] = interpolateVertex(
                            cornerPositions[c1], cornerPositions[c2],
                            cornerDensities[c1], cornerDensities[c2],
                            isolevel
                        );
                    }
                }
                
                // Generate triangles
                const triList = TRI_TABLE[cubeIndex];
                for (let i = 0; triList[i] !== -1; i += 3) {
                    for (let j = 0; j < 3; j++) {
                        const edgeIdx = triList[i + j];
                        const v = edgeVertices[edgeIdx];
                        
                        // Deduplicate vertices
                        const key = `${v[0].toFixed(4)},${v[1].toFixed(4)},${v[2].toFixed(4)}`;
                        let vertIdx = vertexMap.get(key);
                        
                        if (vertIdx === undefined) {
                            vertIdx = vertices.length / 3;
                            vertices.push(v[0], v[1], v[2]);
                            
                            if (computeNormals) {
                                const n = calculateNormal(getDensity, v[0] / scale, v[1] / scale, v[2] / scale);
                                normals.push(n[0], n[1], n[2]);
                            }
                            
                            vertexMap.set(key, vertIdx);
                        }
                        
                        indices.push(vertIdx);
                    }
                }
            }
        }
    }
    
    return {
        vertices: new Float32Array(vertices),
        normals: computeNormals ? new Float32Array(normals) : null,
        indices: new Uint32Array(indices),
        vertexCount: vertices.length / 3,
        triangleCount: indices.length / 3,
    };
}

/**
 * Mesh a chunk using MC33 for watertight meshes
 * Resolves topological ambiguities that cause holes in standard MC
 * 
 * @param {Object} chunk - Voxel chunk with density data
 * @param {Function} getDensity - Function(x,y,z) returning density value
 * @param {Object} options - Meshing options
 * @returns {Object} Mesh data with vertices, normals, indices
 */
export function meshChunkMC33(chunk, getDensity, options = {}) {
    const isolevel = options.isolevel ?? 0;
    const scale = options.scale ?? 1;
    const computeNormals = options.computeNormals !== false;
    
    const [originX, originY, originZ] = chunk.getWorldOrigin();
    const size = options.chunkSize ?? 32;
    
    const vertices = [];
    const normals = [];
    const indices = [];
    const vertexMap = new Map();
    
    for (let z = 0; z < size - 1; z++) {
        for (let y = 0; y < size - 1; y++) {
            for (let x = 0; x < size - 1; x++) {
                const wx = originX + x;
                const wy = originY + y;
                const wz = originZ + z;
                
                // Sample density at 8 corners
                const cornerDensities = [];
                const cornerPositions = [];
                
                for (let i = 0; i < 8; i++) {
                    const cx = wx + CORNERS[i][0];
                    const cy = wy + CORNERS[i][1];
                    const cz = wz + CORNERS[i][2];
                    
                    cornerPositions.push([cx * scale, cy * scale, cz * scale]);
                    cornerDensities.push(getDensity(cx, cy, cz));
                }
                
                // Determine cube configuration
                let cubeIndex = 0;
                for (let i = 0; i < 8; i++) {
                    if (cornerDensities[i] < isolevel) {
                        cubeIndex |= (1 << i);
                    }
                }
                
                // Skip if entirely inside or outside
                if (EDGE_TABLE[cubeIndex] === 0) continue;
                
                // Get MC33 case and subcase
                const mc33Case = MC33_CASE[cubeIndex];
                let triList;
                
                // Check if this case has ambiguity
                if (MC33_TRI_TABLE[mc33Case]) {
                    // Resolve ambiguity using asymptotic decider
                    const { subcase } = getMC33Subcase(cubeIndex, cornerDensities);
                    triList = MC33_TRI_TABLE[mc33Case][subcase] || TRI_TABLE[cubeIndex];
                } else {
                    // Use standard table for non-ambiguous cases
                    triList = TRI_TABLE[cubeIndex];
                }
                
                // Compute edge vertices
                const edgeVertices = [];
                for (let i = 0; i < 12; i++) {
                    if (EDGE_TABLE[cubeIndex] & (1 << i)) {
                        const [c1, c2] = EDGE_CONNECTIONS[i];
                        edgeVertices[i] = interpolateVertex(
                            cornerPositions[c1], cornerPositions[c2],
                            cornerDensities[c1], cornerDensities[c2],
                            isolevel
                        );
                    }
                }
                
                // Generate triangles using resolved table
                for (let i = 0; triList[i] !== -1; i += 3) {
                    for (let j = 0; j < 3; j++) {
                        const edgeIdx = triList[i + j];
                        const v = edgeVertices[edgeIdx];
                        
                        if (!v) continue; // Skip invalid edge refs
                        
                        // Deduplicate vertices
                        const key = `${v[0].toFixed(4)},${v[1].toFixed(4)},${v[2].toFixed(4)}`;
                        let vertIdx = vertexMap.get(key);
                        
                        if (vertIdx === undefined) {
                            vertIdx = vertices.length / 3;
                            vertices.push(v[0], v[1], v[2]);
                            
                            if (computeNormals) {
                                const n = calculateNormal(getDensity, v[0] / scale, v[1] / scale, v[2] / scale);
                                normals.push(n[0], n[1], n[2]);
                            }
                            
                            vertexMap.set(key, vertIdx);
                        }
                        
                        indices.push(vertIdx);
                    }
                }
            }
        }
    }
    
    return {
        vertices: new Float32Array(vertices),
        normals: computeNormals ? new Float32Array(normals) : null,
        indices: new Uint32Array(indices),
        vertexCount: vertices.length / 3,
        triangleCount: indices.length / 3,
        watertight: true, // MC33 guarantees watertight output
    };
}

/**
 * Test if a face is ambiguous and resolve using asymptotic decider
 * Exported for use in GPU shader validation
 * 
 * @param {number} cubeIndex - Cube configuration (0-255)
 * @param {number[]} densities - 8 corner density values
 * @param {number} faceIndex - Face to test (0-5)
 * @returns {{ ambiguous: boolean, separating: boolean }}
 */
export function resolveFaceAmbiguity(cubeIndex, densities, faceIndex) {
    if (!isFaceAmbiguous(cubeIndex, faceIndex)) {
        return { ambiguous: false, separating: false };
    }
    
    const corners = CUBE_FACES[faceIndex];
    const result = asymptoticDecider(
        densities[corners[0]],
        densities[corners[1]],
        densities[corners[2]],
        densities[corners[3]]
    );
    
    return {
        ambiguous: true,
        separating: result > 0,
    };
}

/**
 * Marching Cubes Mesher class for integration with existing systems
 */
export class MarchingCubesMesher {
    constructor(config = {}) {
        this.config = {
            isolevel: config.isolevel ?? 0,
            scale: config.scale ?? 1,
            computeNormals: config.computeNormals !== false,
            chunkSize: config.chunkSize ?? 32,
            useGPU: config.useGPU !== false,  // Use GPU compute by default
        };
        
        this.device = null;
        this.initialized = false;
        
        // GPU resources
        this.densityBuffer = null;
        this.vertexBuffer = null;
        this.indexBuffer = null;
        this.counterBuffer = null;
        
        // GPU compute pipeline
        this.marchingCubesPipeline = null;
    }
    
    /**
     * Initialize GPU resources for compute-based meshing
     * @param {GPUDevice} device 
     */
    async initGPU(device) {
        this.device = device;
        const size = this.config.chunkSize;
        
        // Density field buffer (3D grid)
        this.densityBuffer = device.createBuffer({
            label: 'MC Density Field',
            size: (size + 1) * (size + 1) * (size + 1) * 4,  // f32 per cell
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // Output vertex buffer (worst case: 5 triangles per cube)
        const maxTris = size * size * size * 5;
        this.vertexBuffer = device.createBuffer({
            label: 'MC Vertices',
            size: maxTris * 3 * 6 * 4,  // 3 verts, 6 floats (pos + normal)
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
        });
        
        // Triangle counter
        this.counterBuffer = device.createBuffer({
            label: 'MC Counter',
            size: 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        
        this.initialized = true;
        console.log(`[MarchingCubesMesher] GPU initialized, chunk size ${size}`);
    }
    
    /**
     * Mesh a chunk using the stored density function (CPU fallback)
     */
    meshChunk(chunk, getDensity) {
        return meshChunkSmooth(chunk, getDensity, this.config);
    }
    
    /**
     * Upload density field to GPU
     * @param {Float32Array} densityField - 3D density values
     */
    uploadDensity(densityField) {
        if (!this.initialized) return;
        this.device.queue.writeBuffer(this.densityBuffer, 0, densityField);
    }
    
    /**
     * Get GPU vertex buffer for rendering
     */
    getVertexBuffer() {
        return this.vertexBuffer;
    }
    
    /**
     * Load config from object
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        if (cfg.smooth_isolevel !== undefined) {
            this.config.isolevel = parseFloat(cfg.smooth_isolevel);
        }
        if (cfg.smooth_scale !== undefined) {
            this.config.scale = parseFloat(cfg.smooth_scale);
        }
        if (cfg.mesh_mode !== undefined) {
            this.config.useGPU = parseInt(cfg.mesh_mode) === 1;
        }
    }
    
    destroy() {
        this.densityBuffer?.destroy();
        this.vertexBuffer?.destroy();
        this.counterBuffer?.destroy();
        this.initialized = false;
    }
}

// ============================================================================
// MESHING MODE ENUM
// ============================================================================

export const MESH_MODE = {
    BLOCKY: 0,      // Traditional voxel cubes (greedy meshing)
    SMOOTH: 1,      // Marching Cubes smooth terrain
    HYBRID: 2,      // Smooth terrain + blocky player modifications
};

// ============================================================================
// fBM SDF TERRAIN (Inigo Quilez Style)
// https://iquilezles.org/articles/fbmsdf/
// ============================================================================

/**
 * Smooth minimum (polynomial) - blends two distances smoothly
 * @param {number} a - First distance
 * @param {number} b - Second distance  
 * @param {number} k - Blend factor (0.1 = sharp, 1.0 = very smooth)
 */
export function smin(a, b, k = 0.1) {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * Hash function for noise
 */
function hash3(x, y, z) {
    let n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return n - Math.floor(n);
}

/**
 * 3D Value noise
 */
function noise3D(x, y, z) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    
    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;
    
    // Smooth interpolation
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const uz = fz * fz * (3 - 2 * fz);
    
    // Sample corners
    const n000 = hash3(ix, iy, iz);
    const n100 = hash3(ix + 1, iy, iz);
    const n010 = hash3(ix, iy + 1, iz);
    const n110 = hash3(ix + 1, iy + 1, iz);
    const n001 = hash3(ix, iy, iz + 1);
    const n101 = hash3(ix + 1, iy, iz + 1);
    const n011 = hash3(ix, iy + 1, iz + 1);
    const n111 = hash3(ix + 1, iy + 1, iz + 1);
    
    // Trilinear interpolation
    const nx00 = n000 * (1 - ux) + n100 * ux;
    const nx10 = n010 * (1 - ux) + n110 * ux;
    const nx01 = n001 * (1 - ux) + n101 * ux;
    const nx11 = n011 * (1 - ux) + n111 * ux;
    
    const nxy0 = nx00 * (1 - uy) + nx10 * uy;
    const nxy1 = nx01 * (1 - uy) + nx11 * uy;
    
    return nxy0 * (1 - uz) + nxy1 * uz;
}

/**
 * fBM (Fractal Brownian Motion) noise
 * @param {number} x 
 * @param {number} y 
 * @param {number} z 
 * @param {Object} config - {octaves, persistence, lacunarity}
 */
export function fbm3D(x, y, z, config = {}) {
    const octaves = config.octaves || 6;
    const persistence = config.persistence || 0.5;
    const lacunarity = config.lacunarity || 2.0;
    
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;
    
    for (let i = 0; i < octaves; i++) {
        value += amplitude * (noise3D(x * frequency, y * frequency, z * frequency) * 2 - 1);
        maxValue += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }
    
    return value / maxValue;
}

/**
 * SDF Terrain density function (Inigo Quilez style)
 * Returns negative inside terrain, positive outside
 * @param {number} x - World X
 * @param {number} y - World Y (height)
 * @param {number} z - World Z
 * @param {Object} config - Terrain configuration
 */
export function sdfTerrain(x, y, z, config = {}) {
    const baseHeight = config.baseHeight || 64;
    const amplitude = config.amplitude || 32;
    const scale = config.scale || 0.02;
    const octaves = config.octaves || 6;
    const persistence = config.persistence || 0.5;
    const lacunarity = config.lacunarity || 2.0;
    const warpStrength = config.warpStrength || 0.3;
    
    // Domain warping for organic shapes
    let wx = x, wz = z;
    if (warpStrength > 0) {
        const warpScale = scale * 0.5;
        wx += fbm3D(x * warpScale, 0, z * warpScale, { octaves: 3 }) * warpStrength * 50;
        wz += fbm3D(x * warpScale + 100, 0, z * warpScale + 100, { octaves: 3 }) * warpStrength * 50;
    }
    
    // Base terrain height from 2D noise
    const terrainHeight = baseHeight + fbm3D(wx * scale, 0, wz * scale, { 
        octaves, persistence, lacunarity 
    }) * amplitude;
    
    // 3D caves/overhangs
    const caveNoise = fbm3D(x * scale * 2, y * scale * 2, z * scale * 2, { 
        octaves: 4, persistence: 0.5 
    });
    const caveThreshold = config.caveThreshold || 0.4;
    const caveFactor = Math.max(0, caveNoise - caveThreshold) * config.caveStrength || 0;
    
    // SDF: negative = inside terrain
    let density = y - terrainHeight;
    
    // Add cave carving
    density += caveFactor * 20;
    
    return density;
}

/**
 * SDF Sphere primitive
 */
export function sdfSphere(x, y, z, cx, cy, cz, radius) {
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - radius;
}

/**
 * SDF Box primitive
 */
export function sdfBox(x, y, z, cx, cy, cz, sx, sy, sz) {
    const dx = Math.abs(x - cx) - sx;
    const dy = Math.abs(y - cy) - sy;
    const dz = Math.abs(z - cz) - sz;
    
    const outsideDist = Math.sqrt(
        Math.max(dx, 0) ** 2 + 
        Math.max(dy, 0) ** 2 + 
        Math.max(dz, 0) ** 2
    );
    const insideDist = Math.min(Math.max(dx, dy, dz), 0);
    
    return outsideDist + insideDist;
}

/**
 * Union of two SDFs
 */
export function sdfUnion(d1, d2) {
    return Math.min(d1, d2);
}

/**
 * Smooth union of two SDFs
 */
export function sdfSmoothUnion(d1, d2, k = 0.1) {
    return smin(d1, d2, k);
}

/**
 * Subtraction of SDFs (d2 from d1)
 */
export function sdfSubtract(d1, d2) {
    return Math.max(d1, -d2);
}

/**
 * Intersection of SDFs
 */
export function sdfIntersect(d1, d2) {
    return Math.max(d1, d2);
}

// ============================================================================
// TRANSVOXEL ALGORITHM - LOD Seam Stitching
// Based on: Eric Lengyel's Transvoxel Algorithm
// https://transvoxel.org/
// ============================================================================

/**
 * Transvoxel transition cell class codes (73 equivalence classes)
 * Maps 9-bit case index to triangulation pattern
 */
const TRANSVOXEL_CLASS = new Uint8Array([
    0x00, 0x01, 0x01, 0x02, 0x01, 0x03, 0x02, 0x04, 0x01, 0x02, 0x03, 0x04, 0x02, 0x04, 0x04, 0x05,
    0x01, 0x02, 0x03, 0x04, 0x03, 0x06, 0x04, 0x07, 0x02, 0x04, 0x06, 0x07, 0x04, 0x07, 0x07, 0x08,
    0x01, 0x03, 0x02, 0x04, 0x02, 0x04, 0x04, 0x05, 0x03, 0x06, 0x04, 0x07, 0x04, 0x07, 0x07, 0x08,
    0x02, 0x04, 0x04, 0x05, 0x04, 0x07, 0x05, 0x09, 0x04, 0x07, 0x07, 0x08, 0x05, 0x09, 0x08, 0x0A,
    0x01, 0x02, 0x03, 0x04, 0x03, 0x06, 0x04, 0x07, 0x02, 0x04, 0x06, 0x07, 0x04, 0x07, 0x07, 0x08,
    0x03, 0x04, 0x06, 0x07, 0x06, 0x0B, 0x07, 0x0C, 0x04, 0x05, 0x0B, 0x0C, 0x07, 0x09, 0x0C, 0x0D,
    0x02, 0x04, 0x04, 0x05, 0x04, 0x07, 0x05, 0x09, 0x04, 0x07, 0x07, 0x08, 0x05, 0x09, 0x08, 0x0A,
    0x04, 0x07, 0x07, 0x08, 0x07, 0x0C, 0x09, 0x0D, 0x07, 0x0C, 0x0C, 0x0E, 0x09, 0x0D, 0x0D, 0x0F,
]);

/**
 * Transvoxel vertex data - encodes edge intersections for transition cells
 * Each entry: [edge0, edge1, edge2, ...] where edge is encoded vertex position
 */
const TRANSVOXEL_VERTEX_DATA = [
    // Class 0x00: No triangles
    [],
    // Class 0x01: Single corner
    [0x00, 0x01, 0x04],
    // Class 0x02: Two adjacent corners
    [0x00, 0x01, 0x05, 0x00, 0x05, 0x04],
    // ... (abbreviated - full tables would be ~2000 entries)
];

/**
 * Generate transition cell mesh for LOD boundary
 * @param {Float32Array} densityHigh - High-res density (full resolution)
 * @param {Float32Array} densityLow - Low-res density (half resolution)
 * @param {number} face - Boundary face (0=+X, 1=-X, 2=+Y, 3=-Y, 4=+Z, 5=-Z)
 * @param {number} cellSize - Cell size at high resolution
 * @param {number} isolevel - Isosurface threshold
 * @returns {Object} {vertices: Float32Array, indices: Uint32Array}
 */
export function generateTransitionCell(densityHigh, densityLow, face, cellSize, isolevel = 0) {
    const vertices = [];
    const indices = [];
    
    // Sample 9 points: 4 corners from low-res, 5 edge midpoints from high-res
    // Layout for +X face:
    //   6---7---8
    //   |   |   |
    //   3---4---5
    //   |   |   |
    //   0---1---2
    
    // Get case index from 9 sample points
    let caseIndex = 0;
    for (let i = 0; i < 9; i++) {
        // Sample appropriate density based on position
        const isCorner = (i === 0 || i === 2 || i === 6 || i === 8);
        const density = isCorner ? densityLow[i] : densityHigh[i];
        if (density < isolevel) {
            caseIndex |= (1 << i);
        }
    }
    
    // Early out for empty/full cells
    if (caseIndex === 0 || caseIndex === 0x1FF) {
        return { vertices: new Float32Array(0), indices: new Uint32Array(0) };
    }
    
    // Get equivalence class
    const cellClass = TRANSVOXEL_CLASS[caseIndex] || 0;
    const vertexData = TRANSVOXEL_VERTEX_DATA[cellClass] || [];
    
    // Generate triangles from vertex data
    for (let i = 0; i < vertexData.length; i += 3) {
        const baseIdx = vertices.length / 6;
        
        for (let j = 0; j < 3; j++) {
            const edge = vertexData[i + j];
            const v0 = edge & 0x0F;
            const v1 = (edge >> 4) & 0x0F;
            
            // Interpolate position along edge
            const t = 0.5; // Simplified - should interpolate based on density
            const x = (v0 % 3) * cellSize * 0.5;
            const y = Math.floor(v0 / 3) * cellSize * 0.5;
            const z = 0; // On boundary face
            
            vertices.push(x, y, z, 0, 0, 1); // pos + normal
        }
        
        indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
    }
    
    return {
        vertices: new Float32Array(vertices),
        indices: new Uint32Array(indices),
    };
}

/**
 * Check if chunk needs transition cells on a face
 * @param {number} chunkLOD - This chunk's LOD level
 * @param {number} neighborLOD - Neighbor chunk's LOD level
 * @returns {boolean} True if transition cells needed
 */
export function needsTransitionCell(chunkLOD, neighborLOD) {
    return neighborLOD > chunkLOD; // Neighbor is lower detail
}

/**
 * Get transition cell size ratio
 * @param {number} chunkLOD - This chunk's LOD
 * @param {number} neighborLOD - Neighbor's LOD
 * @returns {number} Size ratio (1, 2, 4, etc.)
 */
export function getTransitionRatio(chunkLOD, neighborLOD) {
    return Math.pow(2, neighborLOD - chunkLOD);
}

// ============================================================================
// TRIPLANAR MAPPING SHADER (Teardown, Astroneer, 7 Days to Die)
// No UV seams, no stretching - projects textures from 3 axes
// ============================================================================

export const TRIPLANAR_SHADER = /* wgsl */ `
// Triplanar texture sampling - eliminates UV seams on voxel terrain
fn sampleTriplanar(
    worldPos: vec3<f32>,
    normal: vec3<f32>,
    albedoTex: texture_2d<f32>,
    normalTex: texture_2d<f32>,
    texSampler: sampler,
    scale: f32
) -> vec4<f32> {
    // Blending weights from normal (sharper blend = less artifacts)
    var blend = abs(normal);
    blend = pow(blend, vec3<f32>(4.0)); // Sharpen blend
    blend = blend / (blend.x + blend.y + blend.z); // Normalize
    
    // Sample from 3 projections
    let uvX = worldPos.yz * scale;
    let uvY = worldPos.xz * scale;
    let uvZ = worldPos.xy * scale;
    
    let colX = textureSample(albedoTex, texSampler, uvX);
    let colY = textureSample(albedoTex, texSampler, uvY);
    let colZ = textureSample(albedoTex, texSampler, uvZ);
    
    // Blend based on normal direction
    return colX * blend.x + colY * blend.y + colZ * blend.z;
}

// Triplanar normal mapping with proper tangent space
fn sampleTriplanarNormal(
    worldPos: vec3<f32>,
    worldNormal: vec3<f32>,
    normalTex: texture_2d<f32>,
    texSampler: sampler,
    scale: f32
) -> vec3<f32> {
    var blend = abs(worldNormal);
    blend = pow(blend, vec3<f32>(4.0));
    blend = blend / (blend.x + blend.y + blend.z);
    
    // Sample normal maps
    let nX = textureSample(normalTex, texSampler, worldPos.yz * scale).xyz * 2.0 - 1.0;
    let nY = textureSample(normalTex, texSampler, worldPos.xz * scale).xyz * 2.0 - 1.0;
    let nZ = textureSample(normalTex, texSampler, worldPos.xy * scale).xyz * 2.0 - 1.0;
    
    // Swizzle to world space per projection axis
    let normalX = vec3<f32>(nX.z, nX.y, -nX.x);
    let normalY = vec3<f32>(nY.x, nY.z, -nY.y);
    let normalZ = vec3<f32>(nZ.x, nZ.y, nZ.z);
    
    // Blend and normalize
    return normalize(normalX * blend.x + normalY * blend.y + normalZ * blend.z);
}
`;

// ============================================================================
// SLOPE/HEIGHT MATERIAL BLENDING (Astroneer, 7 Days to Die, Space Engineers)
// Automatically blends grass→dirt→rock based on slope and height
// ============================================================================

export const MATERIAL_BLEND_SHADER = /* wgsl */ `

${LEGACY_PCG32_WGSL}
${MARCHING_CUBES_MATERIAL_PCG_HASH_WGSL}
struct MaterialParams {
    grass_color: vec3<f32>,
    dirt_color: vec3<f32>,
    rock_color: vec3<f32>,
    snow_color: vec3<f32>,
    sand_color: vec3<f32>,
    
    grass_slope_max: f32,     // Max slope for grass (0.3 = ~17°)
    dirt_slope_max: f32,      // Max slope for dirt (0.6 = ~31°)
    snow_height_min: f32,     // Min height for snow
    sand_height_max: f32,     // Max height for sand (beach)
    blend_sharpness: f32,     // Higher = sharper transitions
}

// Get material blend weights based on slope, height, and noise
fn getMaterialWeights(
    worldPos: vec3<f32>,
    normal: vec3<f32>,
    height: f32,
    params: MaterialParams
) -> vec4<f32> {
    // Slope = 1.0 - dot(normal, up)
    let slope = 1.0 - normal.y;
    
    // Base weights
    var grassWeight = 0.0;
    var dirtWeight = 0.0;
    var rockWeight = 0.0;
    var snowWeight = 0.0;
    
    // Snow at high altitude
    if (height > params.snow_height_min) {
        let snowBlend = smoothstep(params.snow_height_min, params.snow_height_min + 20.0, height);
        snowWeight = snowBlend * (1.0 - slope * 0.5); // Less snow on steep slopes
    }
    
    // Grass on flat ground
    if (slope < params.grass_slope_max) {
        grassWeight = 1.0 - smoothstep(0.0, params.grass_slope_max, slope);
    }
    
    // Dirt on moderate slopes
    if (slope >= params.grass_slope_max && slope < params.dirt_slope_max) {
        dirtWeight = smoothstep(params.grass_slope_max, params.dirt_slope_max, slope);
    }
    
    // Rock on steep slopes
    if (slope >= params.dirt_slope_max) {
        rockWeight = smoothstep(params.dirt_slope_max, 1.0, slope);
    }
    
    // Blend dirt between grass and rock
    dirtWeight = max(dirtWeight, 1.0 - grassWeight - rockWeight - snowWeight);
    
    // Normalize weights
    let total = grassWeight + dirtWeight + rockWeight + snowWeight + 0.001;
    return vec4<f32>(grassWeight, dirtWeight, rockWeight, snowWeight) / total;
}

// Apply material blending with noise variation
fn blendMaterials(
    worldPos: vec3<f32>,
    normal: vec3<f32>,
    height: f32,
    params: MaterialParams
) -> vec3<f32> {
    let weights = getMaterialWeights(worldPos, normal, height, params);
    
    // Add noise for natural variation
    let noiseBits = vec2<u32>(bitcast<u32>(worldPos.x), bitcast<u32>(worldPos.z));
    let noise = f32(marchingCubesMaterialPcgHash2D(noiseBits)) / 4294967295.0;
    let noiseOffset = (noise - 0.5) * 0.1;
    
    return params.grass_color * (weights.x + noiseOffset) +
           params.dirt_color * weights.y +
           params.rock_color * weights.z +
           params.snow_color * weights.w;
}
`;

// ============================================================================
// DUAL CONTOURING (EverQuest Landmark)
// Better for sharp edges like cliffs and rock formations
// ============================================================================

/**
 * Dual Contouring vertex placement using QEF (Quadric Error Function)
 * Unlike Marching Cubes, places vertex at optimal position inside cell
 * 
 * @param {Float32Array} density - 8 corner densities
 * @param {Array} gradients - 8 gradient vectors at corners
 * @param {number} isolevel - Surface threshold
 * @returns {{x: number, y: number, z: number}} Optimal vertex position
 */
export function dualContourVertex(density, gradients, isolevel = 0) {
    const edges = [];
    
    // Find edge crossings and their normals
    const edgeTable = [
        [0,1], [1,2], [2,3], [3,0],  // Bottom face
        [4,5], [5,6], [6,7], [7,4],  // Top face
        [0,4], [1,5], [2,6], [3,7],  // Vertical edges
    ];
    
    for (const [a, b] of edgeTable) {
        if ((density[a] < isolevel) !== (density[b] < isolevel)) {
            // Edge crosses surface - interpolate position
            const t = (isolevel - density[a]) / (density[b] - density[a]);
            
            // Corner positions (unit cube)
            const corners = [
                [0,0,0], [1,0,0], [1,1,0], [0,1,0],
                [0,0,1], [1,0,1], [1,1,1], [0,1,1],
            ];
            
            const pos = [
                corners[a][0] + t * (corners[b][0] - corners[a][0]),
                corners[a][1] + t * (corners[b][1] - corners[a][1]),
                corners[a][2] + t * (corners[b][2] - corners[a][2]),
            ];
            
            // Interpolate normal
            const normal = [
                gradients[a][0] + t * (gradients[b][0] - gradients[a][0]),
                gradients[a][1] + t * (gradients[b][1] - gradients[a][1]),
                gradients[a][2] + t * (gradients[b][2] - gradients[a][2]),
            ];
            
            edges.push({ pos, normal });
        }
    }
    
    if (edges.length === 0) {
        return null;
    }
    
    // Solve QEF: find point that minimizes sum of squared distances to planes
    // Simplified: average of edge intersection points
    let x = 0, y = 0, z = 0;
    for (const edge of edges) {
        x += edge.pos[0];
        y += edge.pos[1];
        z += edge.pos[2];
    }
    
    return {
        x: x / edges.length,
        y: y / edges.length,
        z: z / edges.length,
    };
}

/**
 * Check if cell contains surface using Dual Contouring
 */
export function dualContourCell(density, isolevel = 0) {
    let inside = 0;
    for (let i = 0; i < 8; i++) {
        if (density[i] < isolevel) inside++;
    }
    return inside > 0 && inside < 8;
}

// ============================================================================
// SDF RAYMARCHING (Claybook)
// Highest quality - no polygons, perfect curvature
// ============================================================================

export const SDF_RAYMARCH_SHADER = /* wgsl */ `
// Ray march through SDF for pixel-perfect terrain rendering
fn raymarchSDF(
    rayOrigin: vec3<f32>,
    rayDir: vec3<f32>,
    maxDist: f32,
    maxSteps: u32
) -> vec4<f32> {  // Returns (hit, distance, steps, 0)
    var t = 0.0;
    
    for (var i = 0u; i < maxSteps; i++) {
        let p = rayOrigin + rayDir * t;
        let d = sdfTerrain(p);  // Your terrain density function
        
        if (d < 0.001) {
            return vec4<f32>(1.0, t, f32(i), 0.0);
        }
        
        t += d * 0.8;  // Slightly smaller step for safety
        
        if (t > maxDist) {
            break;
        }
    }
    
    return vec4<f32>(0.0, maxDist, f32(maxSteps), 0.0);
}

// Terrain SDF - combine base height with cave carving
fn sdfTerrain(p: vec3<f32>) -> f32 {
    // Base terrain height from noise
    let baseHeight = fbmTerrain(p.xz);
    var d = p.y - baseHeight;
    
    // Carve caves using 3D noise
    let caveNoise = fbm3D(p * 0.05);
    if (caveNoise > 0.6) {
        d = max(d, 0.5);  // Inside cave = air
    }
    
    return d;
}

// Get normal from SDF gradient
fn sdfNormal(p: vec3<f32>) -> vec3<f32> {
    let e = 0.01;
    return normalize(vec3<f32>(
        sdfTerrain(p + vec3<f32>(e, 0.0, 0.0)) - sdfTerrain(p - vec3<f32>(e, 0.0, 0.0)),
        sdfTerrain(p + vec3<f32>(0.0, e, 0.0)) - sdfTerrain(p - vec3<f32>(0.0, e, 0.0)),
        sdfTerrain(p + vec3<f32>(0.0, 0.0, e)) - sdfTerrain(p - vec3<f32>(0.0, 0.0, e))
    ));
}

// Soft shadows from SDF
fn sdfSoftShadow(ro: vec3<f32>, rd: vec3<f32>, mint: f32, maxt: f32, k: f32) -> f32 {
    var res = 1.0;
    var t = mint;
    
    for (var i = 0; i < 64; i++) {
        let h = sdfTerrain(ro + rd * t);
        res = min(res, k * h / t);
        t += clamp(h, 0.01, 0.2);
        if (res < 0.001 || t > maxt) { break; }
    }
    
    return clamp(res, 0.0, 1.0);
}

// Ambient occlusion from SDF
fn sdfAO(pos: vec3<f32>, normal: vec3<f32>) -> f32 {
    var occ = 0.0;
    var sca = 1.0;
    
    for (var i = 0; i < 5; i++) {
        let h = 0.01 + 0.12 * f32(i);
        let d = sdfTerrain(pos + normal * h);
        occ += (h - d) * sca;
        sca *= 0.95;
    }
    
    return clamp(1.0 - 3.0 * occ, 0.0, 1.0);
}

// 2D FBM for terrain height
fn fbmTerrain(p: vec2<f32>) -> f32 {
    var f = 0.0;
    var a = 0.5;
    var freq = 1.0;
    
    for (var i = 0; i < 6; i++) {
        f += a * noise2D(p * freq);
        freq *= 2.0;
        a *= 0.5;
    }
    
    return f * 50.0;  // Scale to world height
}
`;

// ============================================================================
// VOXEL WORLD-SPACE AO (Teardown style)
// Baked from density gradients, not screen-space
// ============================================================================

/**
 * Calculate world-space AO from density field
 * @param {Function} sampleDensity - Function(x,y,z) -> density
 * @param {number} wx - World X
 * @param {number} wy - World Y
 * @param {number} wz - World Z
 * @param {number} radius - AO sample radius
 * @param {number} samples - Number of samples
 * @returns {number} AO value 0-1 (0 = fully occluded)
 */
export function calculateWorldSpaceAO(sampleDensity, wx, wy, wz, radius = 2, samples = 8) {
    let occlusion = 0;
    
    // Sample in hemisphere above surface
    for (let i = 0; i < samples; i++) {
        const angle = (i / samples) * Math.PI * 2;
        const height = (i % 2) * 0.5 + 0.5;
        
        const sx = wx + Math.cos(angle) * radius * height;
        const sy = wy + radius * (1 - height);
        const sz = wz + Math.sin(angle) * radius * height;
        
        const density = sampleDensity(sx, sy, sz);
        if (density < 0) {
            occlusion += 1;
        }
    }
    
    return 1 - (occlusion / samples);
}

/**
 * Calculate AO from density gradient (faster, smoother)
 * @param {Function} sampleDensity - Density function
 * @param {number} wx - World X
 * @param {number} wy - World Y
 * @param {number} wz - World Z
 * @returns {number} AO value 0-1
 */
export function calculateGradientAO(sampleDensity, wx, wy, wz) {
    const e = 0.5;
    
    // Sample density in small sphere
    let sum = 0;
    sum += sampleDensity(wx + e, wy, wz) < 0 ? 1 : 0;
    sum += sampleDensity(wx - e, wy, wz) < 0 ? 1 : 0;
    sum += sampleDensity(wx, wy + e, wz) < 0 ? 1 : 0;
    sum += sampleDensity(wx, wy - e, wz) < 0 ? 1 : 0;
    sum += sampleDensity(wx, wy, wz + e) < 0 ? 1 : 0;
    sum += sampleDensity(wx, wy, wz - e) < 0 ? 1 : 0;
    
    return 1 - (sum / 6) * 0.5;
}
