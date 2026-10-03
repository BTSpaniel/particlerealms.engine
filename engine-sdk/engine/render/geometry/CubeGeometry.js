// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

function createCubePositions(size) {
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

function createCubeNormals() {
  return [
    // Front
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    // Back
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    // Top
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    // Bottom
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    // Right
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    // Left
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  ];
}

function createCubeIndices() {
  return [
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
    8, 9, 10, 8, 10, 11,
    12, 13, 14, 12, 14, 15,
    16, 17, 18, 16, 18, 19,
    20, 21, 22, 20, 22, 23,
  ];
}

function createCubeUVs() {
  const face = [0, 0, 1, 0, 1, 1, 0, 1];
  return Array.from({ length: 6 }, () => face).flat();
}

export function createCubeGeometry(size = 1) {
  const positions = createCubePositions(size);
  const normals = createCubeNormals();
  const uvs = createCubeUVs();
  const indices = createCubeIndices();
  return { positions, normals, uvs, indices };
}
