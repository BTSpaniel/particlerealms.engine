// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

function createGroundPositions(size) {
  const s = size / 2;
  return [
    -s, 0, -s,
    s, 0, -s,
    s, 0, s,
    -s, 0, s,
  ];
}

function createGroundNormals() {
  return [
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
  ];
}

function createGroundIndices() {
  return [0, 1, 2, 0, 2, 3];
}

export function createGroundGeometry(size = 30) {
  const positions = createGroundPositions(size);
  const normals = createGroundNormals();
  const indices = createGroundIndices();
  return { positions, normals, indices };
}
