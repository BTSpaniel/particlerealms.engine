// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createMesh as createEngineMesh } from "../Mesh.js";

const STATIC_POSITION_NORMAL_ATTRIBUTES = [
  {
    name: "position",
    location: 0,
    offset: 0,
    format: "float32x3",
  },
  {
    name: "normal",
    location: 1,
    offset: 12,
    format: "float32x3",
  },
];

const STATIC_POSITION_NORMAL_UV_TANGENT_ATTRIBUTES = [
  ...STATIC_POSITION_NORMAL_ATTRIBUTES,
  {
    name: "uv",
    location: 2,
    offset: 24,
    format: "float32x2",
  },
  {
    name: "tangent",
    location: 3,
    offset: 32,
    format: "float32x4",
  },
];

function cloneAttributes(attributes) {
  return attributes.map((attribute) => ({ ...attribute }));
}

export function staticMeshVertexLayoutForGeometry(geometry) {
  if (!geometry || !geometry.positions || !geometry.normals) {
    return null;
  }

  const positionCount = Math.floor(geometry.positions.length / 3);
  if (geometry.normals.length < positionCount * 3) {
    return null;
  }

  const hasUVs = positionCount > 0 && !!geometry.uvs && geometry.uvs.length >= positionCount * 2;
  const hasTangents = positionCount > 0 && !!geometry.tangents && geometry.tangents.length >= positionCount * 4;
  const strideFloats = hasTangents ? 12 : 6;
  const attributes = cloneAttributes(
    hasTangents
      ? STATIC_POSITION_NORMAL_UV_TANGENT_ATTRIBUTES
      : STATIC_POSITION_NORMAL_ATTRIBUTES
  );

  return {
    positionCount,
    hasUVs,
    hasTangents,
    strideFloats,
    vertexStride: strideFloats * 4,
    attributes,
  };
}

export function staticMeshVertexDataFromGeometry(geometry) {
  const layout = staticMeshVertexLayoutForGeometry(geometry);
  if (!layout) {
    return null;
  }

  const { positionCount, strideFloats, hasUVs, hasTangents } = layout;
  const vertexData = new Float32Array(positionCount * strideFloats);

  for (let i = 0; i < positionCount; i++) {
    const pi = i * 3;
    const vi = i * strideFloats;

    vertexData[vi + 0] = geometry.positions[pi + 0];
    vertexData[vi + 1] = geometry.positions[pi + 1];
    vertexData[vi + 2] = geometry.positions[pi + 2];

    vertexData[vi + 3] = geometry.normals[pi + 0];
    vertexData[vi + 4] = geometry.normals[pi + 1];
    vertexData[vi + 5] = geometry.normals[pi + 2];

    if (hasTangents) {
      const ui = i * 2;
      const ti = i * 4;

      vertexData[vi + 6] = hasUVs ? geometry.uvs[ui + 0] : 0;
      vertexData[vi + 7] = hasUVs ? geometry.uvs[ui + 1] : 0;
      vertexData[vi + 8] = geometry.tangents[ti + 0];
      vertexData[vi + 9] = geometry.tangents[ti + 1];
      vertexData[vi + 10] = geometry.tangents[ti + 2];
      vertexData[vi + 11] = geometry.tangents[ti + 3];
    }
  }

  return {
    vertexData,
    layout,
  };
}

export function buildStaticMeshFromGeometry(device, geometry, label, options = {}) {
  if (!device) {
    return null;
  }

  const meshData = staticMeshVertexDataFromGeometry(geometry);
  if (!meshData) {
    return null;
  }

  const { vertexData, layout } = meshData;
  const { positionCount, vertexStride, attributes } = layout;
  const indexArray = geometry.indices || [];
  const useUint32 = positionCount > 65535;
  const indexData = useUint32
    ? new Uint32Array(indexArray)
    : new Uint16Array(indexArray);

  return createEngineMesh(device, {
    id: label,
    label,
    vertexData,
    vertexStride,
    attributes,
    indexData,
    topology: "triangle-list",
    enableClusterCulling: !!options.enableClusterCulling,
  });
}
