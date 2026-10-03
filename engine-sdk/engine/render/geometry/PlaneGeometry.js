// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

function createPlanePositions(size, y) {
  const s = size / 2;
  return [
    -s, y, -s,
    s, y, -s,
    s, y, s,
    -s, y, s,
  ];
}

function createPlaneNormals() {
  return [
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
  ];
}

function createPlaneIndices() {
  return [0, 1, 2, 0, 2, 3];
}

function createPlaneUVs() {
  return [0, 1, 1, 1, 1, 0, 0, 0];
}

export function createPlaneGeometry(size = 10, y = 0) {
  const positions = createPlanePositions(size, y);
  const normals = createPlaneNormals();
  const uvs = createPlaneUVs();
  const indices = createPlaneIndices();
  return { positions, normals, uvs, indices };
}
