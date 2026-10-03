// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

function createSkyboxPositions(size) {
  const s = size / 2;
  return [
    // Front
    -s, -s, s, s, -s, s, s, s, s, -s, s, s,
    // Back
    -s, -s, -s, -s, s, -s, s, s, -s, s, -s, -s,
    // Top
    -s, s, -s, -s, s, s, s, s, s, s, s, -s,
    // Bottom
    -s, -s, -s, s, -s, -s, s, -s, s, -s, -s, s,
    // Right
    s, -s, -s, s, s, -s, s, s, s, s, -s, s,
    // Left
    -s, -s, -s, -s, -s, s, -s, s, s, -s, s, -s,
  ];
}

function createSkyboxNormals() {
  return [
    // Front (inward)
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    // Back (inward)
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    // Top (inward)
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    // Bottom (inward)
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    // Right (inward)
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
    // Left (inward)
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
  ];
}

function createSkyboxIndices() {
  return [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    8, 9, 10, 8, 10, 11,
    12, 14, 13, 12, 15, 14,
    16, 18, 17, 16, 19, 18,
    20, 21, 22, 20, 22, 23,
  ];
}

export function createSkyboxGeometry(size = 50) {
  const positions = createSkyboxPositions(size);
  const normals = createSkyboxNormals();
  const indices = createSkyboxIndices();
  return { positions, normals, indices };
}
