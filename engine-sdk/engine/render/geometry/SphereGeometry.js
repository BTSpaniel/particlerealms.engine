// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

function createSpherePositionsAndNormals(radius, widthSegments, heightSegments) {
  const positions = [];
  const normals = [];
  const uvs = [];

  for (let y = 0; y <= heightSegments; y++) {
    const theta = (y / heightSegments) * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let x = 0; x <= widthSegments; x++) {
      const phi = (x / widthSegments) * Math.PI * 2;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      const px = radius * sinTheta * cosPhi;
      const py = radius * cosTheta;
      const pz = radius * sinTheta * sinPhi;

      positions.push(px, py, pz);
      normals.push(sinTheta * cosPhi, cosTheta, sinTheta * sinPhi);
      uvs.push(x / widthSegments, 1 - y / heightSegments);
    }
  }

  return { positions, normals, uvs };
}

function createSphereIndices(widthSegments, heightSegments) {
  const indices = [];

  for (let y = 0; y < heightSegments; y++) {
    for (let x = 0; x < widthSegments; x++) {
      const a = y * (widthSegments + 1) + x;
      const b = a + widthSegments + 1;

      indices.push(a, b, a + 1);
      indices.push(b, b + 1, a + 1);
    }
  }

  return indices;
}

export function createSphereGeometry(radius = 0.5, widthSegments = 16, heightSegments = 12) {
  const { positions, normals, uvs } = createSpherePositionsAndNormals(radius, widthSegments, heightSegments);
  const indices = createSphereIndices(widthSegments, heightSegments);
  return { positions, normals, uvs, indices };
}
