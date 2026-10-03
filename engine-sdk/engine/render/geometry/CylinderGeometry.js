// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

function radialDirection(index, segments) {
  if (index === segments) return { cos: 1, sin: 0 };
  const theta = (index / segments) * Math.PI * 2;
  return { cos: Math.cos(theta), sin: Math.sin(theta) };
}

function createCylinderSide(radius, halfHeight, radialSegments, heightSegments, positions, normals, uvs, indices) {
  const rs = Math.max(3, radialSegments | 0);
  const hs = Math.max(1, heightSegments | 0);
  const ringVertexCount = rs + 1;

  for (let yIndex = 0; yIndex <= hs; yIndex++) {
    const v = yIndex / hs;
    const y = -halfHeight + v * (halfHeight * 2);

    for (let i = 0; i <= rs; i++) {
      const u = i / rs;
      const { cos, sin } = radialDirection(i, rs);
      const x = radius * cos;
      const z = radius * sin;

      positions.push(x, y, z);
      normals.push(cos, 0, sin);
      uvs.push(u, 1 - v);
    }
  }

  for (let yIndex = 0; yIndex < hs; yIndex++) {
    const ring0 = yIndex * ringVertexCount;
    const ring1 = (yIndex + 1) * ringVertexCount;
    for (let i = 0; i < rs; i++) {
      const i0 = ring0 + i;
      const i1 = ring0 + i + 1;
      const i2 = ring1 + i;
      const i3 = ring1 + i + 1;

      indices.push(i0, i2, i1);
      indices.push(i1, i2, i3);
    }
  }

  return { rs, hs, ringVertexCount };
}

// Hollow cylinder (tube) - open top and bottom
export function createHollowCylinderGeometry(
  outerRadius = 0.5,
  innerRadius = 0.4,
  height = 1.0,
  radialSegments = 24,
) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  
  const rs = Math.max(3, radialSegments | 0);
  const halfHeight = height * 0.5;
  
  // Outer wall (normals pointing out)
  for (let i = 0; i <= rs; i++) {
    const { cos, sin } = radialDirection(i, rs);
    positions.push(outerRadius * cos, -halfHeight, outerRadius * sin);
    positions.push(outerRadius * cos, halfHeight, outerRadius * sin);
    normals.push(cos, 0, sin);
    normals.push(cos, 0, sin);
    uvs.push(i / rs, 1, i / rs, 0);
  }
  
  const outerStart = 0;
  for (let i = 0; i < rs; i++) {
    const i0 = outerStart + i * 2;
    const i1 = i0 + 1;
    const i2 = i0 + 2;
    const i3 = i0 + 3;
    indices.push(i0, i2, i1);
    indices.push(i1, i2, i3);
  }
  
  // Inner wall (normals pointing in)
  const innerStart = positions.length / 3;
  for (let i = 0; i <= rs; i++) {
    const { cos, sin } = radialDirection(i, rs);
    positions.push(innerRadius * cos, -halfHeight, innerRadius * sin);
    positions.push(innerRadius * cos, halfHeight, innerRadius * sin);
    normals.push(-cos, 0, -sin);
    normals.push(-cos, 0, -sin);
    uvs.push(1 - i / rs, 1, 1 - i / rs, 0);
  }
  
  for (let i = 0; i < rs; i++) {
    const i0 = innerStart + i * 2;
    const i1 = i0 + 1;
    const i2 = i0 + 2;
    const i3 = i0 + 3;
    indices.push(i0, i1, i2);
    indices.push(i1, i3, i2);
  }
  
  // Top ring (connects outer to inner at top)
  const topStart = positions.length / 3;
  const uvRadius = Math.max(Math.abs(outerRadius), Math.abs(innerRadius), Number.EPSILON);
  for (let i = 0; i <= rs; i++) {
    const { cos, sin } = radialDirection(i, rs);
    positions.push(outerRadius * cos, halfHeight, outerRadius * sin);
    positions.push(innerRadius * cos, halfHeight, innerRadius * sin);
    normals.push(0, 1, 0);
    normals.push(0, 1, 0);
    uvs.push(
      0.5 + (outerRadius * cos) / (2 * uvRadius), 0.5 + (outerRadius * sin) / (2 * uvRadius),
      0.5 + (innerRadius * cos) / (2 * uvRadius), 0.5 + (innerRadius * sin) / (2 * uvRadius),
    );
  }
  
  for (let i = 0; i < rs; i++) {
    const i0 = topStart + i * 2;
    const i1 = i0 + 1;
    const i2 = i0 + 2;
    const i3 = i0 + 3;
    indices.push(i0, i1, i2);
    indices.push(i1, i3, i2);
  }
  
  // Bottom ring (connects outer to inner at bottom)
  const bottomStart = positions.length / 3;
  for (let i = 0; i <= rs; i++) {
    const { cos, sin } = radialDirection(i, rs);
    positions.push(outerRadius * cos, -halfHeight, outerRadius * sin);
    positions.push(innerRadius * cos, -halfHeight, innerRadius * sin);
    normals.push(0, -1, 0);
    normals.push(0, -1, 0);
    uvs.push(
      0.5 + (outerRadius * cos) / (2 * uvRadius), 0.5 - (outerRadius * sin) / (2 * uvRadius),
      0.5 + (innerRadius * cos) / (2 * uvRadius), 0.5 - (innerRadius * sin) / (2 * uvRadius),
    );
  }
  
  for (let i = 0; i < rs; i++) {
    const i0 = bottomStart + i * 2;
    const i1 = i0 + 1;
    const i2 = i0 + 2;
    const i3 = i0 + 3;
    indices.push(i0, i2, i1);
    indices.push(i1, i2, i3);
  }
  
  return { positions, normals, uvs, indices };
}

export function createCylinderGeometry(
  radius = 0.5,
  height = 1.0,
  radialSegments = 16,
  heightSegments = 1,
) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const r = Math.max(0.0001, Number(radius) || 0.5);
  const h = Math.max(0.0001, Number(height) || 1.0);
  const halfHeight = h * 0.5;

  const sideInfo = createCylinderSide(
    r,
    halfHeight,
    radialSegments,
    heightSegments,
    positions,
    normals,
    uvs,
    indices,
  );

  const rs = sideInfo.rs;
  const ringVertexCount = sideInfo.ringVertexCount;

  const topCenterIndex = positions.length / 3;
  positions.push(0, halfHeight, 0);
  normals.push(0, 1, 0);
  uvs.push(0.5, 0.5);

  const topRingStart = heightSegments * ringVertexCount;
  for (let i = 0; i < rs; i++) {
    const i0 = topRingStart + i;
    const i1 = topRingStart + i + 1;
    indices.push(topCenterIndex, i0, i1);
  }

  const bottomCenterIndex = positions.length / 3;
  positions.push(0, -halfHeight, 0);
  normals.push(0, -1, 0);
  uvs.push(0.5, 0.5);

  const bottomRingStart = 0;
  for (let i = 0; i < rs; i++) {
    const i0 = bottomRingStart + i;
    const i1 = bottomRingStart + i + 1;
    indices.push(bottomCenterIndex, i1, i0);
  }

  return { positions, normals, uvs, indices };
}
