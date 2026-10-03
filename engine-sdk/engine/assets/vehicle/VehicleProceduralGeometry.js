// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

function vectorBounds(min, max) {
  const center = min.map((value, index) => (value + max[index]) / 2);
  return { min, max, center, radius: Math.hypot(...max.map((value, index) => value - center[index])) };
}

export function computeMeshBounds(position) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < position.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = position[index + axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  return vectorBounds(min, max);
}

export function aggregateBounds(bounds) {
  if (!bounds.length) return vectorBounds([0, 0, 0], [0, 0, 0]);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const bound of bounds) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], bound.min[axis]);
      max[axis] = Math.max(max[axis], bound.max[axis]);
    }
  }
  return vectorBounds(min, max);
}

export function translateMesh(mesh, offset) {
  const position = new Float32Array(mesh.position.length);
  for (let index = 0; index < mesh.position.length; index += 3) {
    position[index] = mesh.position[index] + offset[0];
    position[index + 1] = mesh.position[index + 1] + offset[1];
    position[index + 2] = mesh.position[index + 2] + offset[2];
  }
  return { ...mesh, position };
}

export function makeBoxMesh(size) {
  const x = size[0] / 2;
  const y = size[1] / 2;
  const z = size[2] / 2;
  const faces = [
    [[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z]],
    [[-x, -y, z], [-x, y, z], [-x, y, -z], [-x, -y, -z]],
    [[-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z]],
    [[-x, -y, z], [-x, -y, -z], [x, -y, -z], [x, -y, z]],
    [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]],
    [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]],
  ];
  return meshFromQuads(faces);
}

function meshFromQuads(faces) {
  const position = new Float32Array(faces.length * 12);
  const normal = new Float32Array(faces.length * 12);
  const uv0 = new Float32Array(faces.length * 8);
  const indices = new Uint32Array(faces.length * 6);
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  faces.forEach((quad, face) => {
    const ab = quad[1].map((value, axis) => value - quad[0][axis]);
    const ac = quad[2].map((value, axis) => value - quad[0][axis]);
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const inverseLength = 1 / Math.max(1e-8, Math.hypot(...cross));
    const faceNormal = cross.map(value => value * inverseLength);
    quad.forEach((vertex, vertexIndex) => {
      position.set(vertex, (face * 4 + vertexIndex) * 3);
      normal.set(faceNormal, (face * 4 + vertexIndex) * 3);
      uv0.set(uvs[vertexIndex], (face * 4 + vertexIndex) * 2);
    });
    const vertex = face * 4;
    indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], face * 6);
  });
  return { position, normal, uv0, indices, vertexCount: faces.length * 4 };
}

/**
 * +Z-forward tapered box. Size is conventional XYZ: width, height, length.
 * Insets shorten the upper face from the +Z front or -Z rear.
 */
export function makeTaperedBoxMesh(size, options = {}) {
  const width = size[0];
  const height = size[1];
  const length = size[2];
  const topWidth = Math.min(width, options.topWidth ?? width);
  const frontInset = Math.max(0, options.frontInset ?? 0);
  const rearInset = Math.max(0, options.rearInset ?? 0);
  const xBottom = width / 2;
  const xTop = topWidth / 2;
  const yBottom = -height / 2;
  const yTop = height / 2;
  const zFront = length / 2;
  const zRear = -length / 2;
  const corners = {
    flb: [xBottom, yBottom, zFront], frb: [-xBottom, yBottom, zFront],
    rlb: [xBottom, yBottom, zRear], rrb: [-xBottom, yBottom, zRear],
    flt: [xTop, yTop, zFront - frontInset], frt: [-xTop, yTop, zFront - frontInset],
    rlt: [xTop, yTop, zRear + rearInset], rrt: [-xTop, yTop, zRear + rearInset],
  };
  return meshFromQuads([
    [corners.frb, corners.frt, corners.flt, corners.flb],
    [corners.rlb, corners.rlt, corners.rrt, corners.rrb],
    [corners.rrt, corners.rlt, corners.flt, corners.frt],
    [corners.rlb, corners.rrb, corners.frb, corners.flb],
    [corners.flb, corners.flt, corners.rlt, corners.rlb],
    [corners.rrb, corners.rrt, corners.frt, corners.frb],
  ]);
}

/** Indexed cylinder whose axle is local X, matching +Z-forward vehicle wheels. */
export function makeCylinderMesh(radius, width, segments = 20) {
  if (!Number.isSafeInteger(segments) || segments < 3) throw new TypeError('Cylinder segments must be an integer >= 3');
  const halfWidth = width / 2;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let segment = 0; segment <= segments; segment++) {
    const t = segment / segments;
    const angle = t * Math.PI * 2;
    const y = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    positions.push([-halfWidth, y, z], [halfWidth, y, z]);
    normals.push([0, y / radius, z / radius], [0, y / radius, z / radius]);
    uvs.push([t, 0], [t, 1]);
  }
  for (let segment = 0; segment < segments; segment++) {
    const first = segment * 2;
    indices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2);
  }
  for (const side of [-1, 1]) {
    const center = positions.length;
    positions.push([side * halfWidth, 0, 0]);
    normals.push([side, 0, 0]);
    uvs.push([0.5, 0.5]);
    const ring = positions.length;
    for (let segment = 0; segment <= segments; segment++) {
      const angle = segment / segments * Math.PI * 2;
      const y = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      positions.push([side * halfWidth, y, z]);
      normals.push([side, 0, 0]);
      uvs.push([0.5 + y / radius * 0.5, 0.5 + z / radius * 0.5]);
    }
    for (let segment = 0; segment < segments; segment++) {
      if (side < 0) indices.push(center, ring + segment + 1, ring + segment);
      else indices.push(center, ring + segment, ring + segment + 1);
    }
  }
  const position = new Float32Array(positions.length * 3);
  const normal = new Float32Array(normals.length * 3);
  const uv0 = new Float32Array(uvs.length * 2);
  positions.forEach((value, index) => position.set(value, index * 3));
  normals.forEach((value, index) => normal.set(value, index * 3));
  uvs.forEach((value, index) => uv0.set(value, index * 2));
  return { position, normal, uv0, indices: new Uint32Array(indices), vertexCount: positions.length };
}

