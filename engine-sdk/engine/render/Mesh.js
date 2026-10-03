// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createVertexBuffer, createIndexBuffer, destroyBuffers } from "../core/gpu/GpuBuffer.js";
import { IndexedClusterCuller } from "./IndexedClusterCuller.js";

export function computeBoundsFromInterleavedPositions(vertexData, strideFloats, positionOffsetFloats = 0) {
  const data = vertexData instanceof Float32Array
    ? vertexData
    : new Float32Array(vertexData.buffer, vertexData.byteOffset, vertexData.byteLength / 4);

  const vertexCount = Math.floor(data.length / strideFloats);
  if (vertexCount === 0) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      center: [0, 0, 0],
      radius: 0,
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < vertexCount; i++) {
    const base = i * strideFloats + positionOffsetFloats;
    const x = data[base + 0];
    const y = data[base + 1];
    const z = data[base + 2];

    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;

  const dx = maxX - cx;
  const dy = maxY - cy;
  const dz = maxZ - cz;
  const radius = Math.sqrt(dx * dx + dy * dy + dz * dz);

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [cx, cy, cz],
    radius,
  };
}

export function createMesh(device, description) {
  if (!device) {
    throw new Error("createMesh: device is required");
  }
  if (!description || typeof description !== "object") {
    throw new Error("createMesh: description object is required");
  }

  const {
    id,
    label,
    vertexData,
    vertexStride,
    attributes,
    indexData,
    indexFormat,
    topology,
    bounds,
    materialId,
    enableClusterCulling,
  } = description;

  if (!vertexData) {
    throw new Error("createMesh: vertexData (Float32Array) is required");
  }
  if (!vertexStride || vertexStride <= 0) {
    throw new Error("createMesh: vertexStride (bytes) must be > 0");
  }

  const vertexArray =
    vertexData instanceof Float32Array
      ? vertexData
      : new Float32Array(vertexData.buffer, vertexData.byteOffset, vertexData.byteLength / 4);

  const strideFloats = vertexStride / 4;
  const vertexCount = Math.floor(vertexArray.length / strideFloats);

  if (indexData && !(indexData instanceof Uint16Array) && !(indexData instanceof Uint32Array)) {
    throw new Error("createMesh: indexData must be Uint16Array or Uint32Array");
  }

  let vertexBuffer = null;
  let indexBuffer = null;
  let indexCount = 0;
  let indexFmt = null;

  try {
    vertexBuffer = createVertexBuffer(device, vertexArray, {
      label: label ? `${label}_vb` : undefined,
    });
    if (indexData) {
      indexBuffer = createIndexBuffer(device, indexData, {
        label: label ? `${label}_ib` : undefined,
      });
      indexCount = indexData.length;
      indexFmt = indexFormat || (indexData instanceof Uint16Array ? "uint16" : "uint32");
    }
  } catch (error) {
    try {
      destroyBuffers([indexBuffer, vertexBuffer]);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "createMesh: GPU upload and rollback both failed"
      );
    }
    throw error;
  }

  const meshBounds = bounds ||
    computeBoundsFromInterleavedPositions(vertexArray, strideFloats, 0);

  let ownedVertexBuffer = vertexBuffer;
  let ownedIndexBuffer = indexBuffer;
  const mesh = {
    id: id || label || "mesh",
    label: label || null,
    vertexBuffer,
    indexBuffer,
    vertexStride,
    vertexCount,
    indexCount,
    indexFormat: indexFmt,
    attributes: Array.isArray(attributes) ? attributes.slice() : [],
    topology: topology || "triangle-list",
    bounds: meshBounds,
    materialId: materialId || null,
    destroy() {
      const errors = [];
      if (this.indexedClusterCuller && typeof this.indexedClusterCuller.destroy === "function") {
        const culler = this.indexedClusterCuller;
        try {
          culler.destroy();
        } catch (error) {
          errors.push(error);
        } finally {
          this.indexedClusterCuller = null;
        }
      }
      if (ownedIndexBuffer) {
        const buffer = ownedIndexBuffer;
        try {
          destroyBuffers(buffer);
        } catch (error) {
          errors.push(error);
        } finally {
          ownedIndexBuffer = null;
        }
      }
      if (ownedVertexBuffer) {
        const buffer = ownedVertexBuffer;
        try {
          destroyBuffers(buffer);
        } catch (error) {
          errors.push(error);
        } finally {
          ownedVertexBuffer = null;
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, `Mesh '${this.id}' cleanup failed`);
      }
    },
  };

  if (enableClusterCulling && indexData && vertexCount > 0 && indexData.length > 0) {
    let culler = null;
    try {
      const attrList = Array.isArray(attributes) ? attributes : [];
      const posAttr = attrList.find((a) => a && (a.name === "position" || a.location === 0));
      const posOffsetFloats = ((posAttr && typeof posAttr.offset === "number" ? posAttr.offset : 0) / 4) | 0;

      const strideFloats = (vertexStride / 4) | 0;
      const positions = new Float32Array(vertexCount * 3);
      for (let i = 0; i < vertexCount; i++) {
        const src = i * strideFloats + posOffsetFloats;
        const dst = i * 3;
        positions[dst + 0] = vertexArray[src + 0];
        positions[dst + 1] = vertexArray[src + 1];
        positions[dst + 2] = vertexArray[src + 2];
      }

      const idx32 = indexData instanceof Uint32Array ? indexData : new Uint32Array(indexData);

      culler = new IndexedClusterCuller(device);
      culler.initialize();
      culler.setGeometry(positions, idx32);
      mesh.indexedClusterCuller = culler;
    } catch (err) {
      let cullerCleanupError = null;
      try {
        culler?.destroy?.();
      } catch (cleanupError) {
        cullerCleanupError = cleanupError;
      }

      const cleanupWasUncertain = err instanceof AggregateError || cullerCleanupError != null;
      if (cleanupWasUncertain) {
        const errors = [err];
        if (cullerCleanupError) errors.push(cullerCleanupError);
        try {
          mesh.destroy();
        } catch (meshCleanupError) {
          errors.push(meshCleanupError);
        }
        if (errors.length === 1) throw err;
        throw new AggregateError(
          errors,
          "createMesh: cluster-culler initialization and rollback failed"
        );
      }

      console.warn('[Mesh] enableClusterCulling failed:', err?.message ?? err);
    }
  }

  return mesh;
}

export function createScreenQuadMesh(device, options = {}) {
  const positionsAndUVs = new Float32Array([
    // x,    y,   z,   u,  v
    -1, -1, 0,   0,  0,
     1, -1, 0,   1,  0,
    -1,  1, 0,   0,  1,
     1,  1, 0,   1,  1,
  ]);

  const indices = new Uint16Array([
    0, 1, 2,
    2, 1, 3,
  ]);

  return createMesh(device, {
    id: options.id || "screen_quad",
    label: options.label || "ScreenQuadMesh",
    vertexData: positionsAndUVs,
    vertexStride: 5 * 4,
    attributes: [
      {
        name: "position",
        location: 0,
        offset: 0,
        format: "float32x3",
      },
      {
        name: "uv",
        location: 1,
        offset: 12,
        format: "float32x2",
      },
    ],
    indexData: indices,
    topology: "triangle-list",
    enableClusterCulling: !!options.enableClusterCulling,
  });
}

function buildSphereGeometry(radius, widthSegments, heightSegments) {
  const vertices = [];
  const indicesArray = [];

  for (let y = 0; y <= heightSegments; y++) {
    const v = y / heightSegments;
    const theta = v * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let x = 0; x <= widthSegments; x++) {
      const u = x / widthSegments;
      const phi = u * Math.PI * 2;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      const nx = sinTheta * cosPhi;
      const ny = cosTheta;
      const nz = sinTheta * sinPhi;

      const px = nx * radius;
      const py = ny * radius;
      const pz = nz * radius;

      vertices.push(px, py, pz, nx, ny, nz, u, 1.0 - v);
    }
  }

  const vertsPerRow = widthSegments + 1;
  for (let y = 0; y < heightSegments; y++) {
    for (let x = 0; x < widthSegments; x++) {
      const i0 = y * vertsPerRow + x;
      const i1 = i0 + 1;
      const i2 = i0 + vertsPerRow;
      const i3 = i2 + 1;

      indicesArray.push(i0, i2, i1);
      indicesArray.push(i1, i2, i3);
    }
  }

  const vertexData = new Float32Array(vertices);
  const indexData =
    vertexData.length / 8 > 65535
      ? new Uint32Array(indicesArray)
      : new Uint16Array(indicesArray);

  return { vertexData, indexData };
}

export function createSphereMesh(device, options = {}) {
  const radius = typeof options.radius === "number" ? options.radius : 1.0;
  const widthSegments = Math.max(3, (options.widthSegments | 0) || 16);
  const heightSegments = Math.max(2, (options.heightSegments | 0) || 12);

  const { vertexData, indexData } = buildSphereGeometry(
    radius,
    widthSegments,
    heightSegments
  );

  return createMesh(device, {
    id: options.id || "unit_sphere",
    label: options.label || "UnitSphereMesh",
    vertexData,
    vertexStride: 8 * 4,
    attributes: [
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
      {
        name: "uv",
        location: 2,
        offset: 24,
        format: "float32x2",
      },
    ],
    indexData,
    topology: "triangle-list",
  });
}

export function getVertexBufferLayoutForMesh(mesh, slot = 0) {
  if (!mesh) {
    throw new Error("getVertexBufferLayoutForMesh: mesh is required");
  }

  return {
    arrayStride: mesh.vertexStride,
    stepMode: "vertex",
    attributes: mesh.attributes.map((attr) => ({
      shaderLocation: attr.location,
      offset: attr.offset,
      format: attr.format,
    })),
    slot,
  };
}

export function createUnitCubeMesh(device, options = {}) {
  // 24 vertices (4 per face) with position and normal
  const data = new Float32Array([
    // Front face
    -1, -1,  1,   0,  0,  1,
     1, -1,  1,   0,  0,  1,
    -1,  1,  1,   0,  0,  1,
     1,  1,  1,   0,  0,  1,
    // Back face
     1, -1, -1,   0,  0, -1,
    -1, -1, -1,   0,  0, -1,
     1,  1, -1,   0,  0, -1,
    -1,  1, -1,   0,  0, -1,
    // Left face
    -1, -1, -1,  -1,  0,  0,
    -1, -1,  1,  -1,  0,  0,
    -1,  1, -1,  -1,  0,  0,
    -1,  1,  1,  -1,  0,  0,
    // Right face
     1, -1,  1,   1,  0,  0,
     1, -1, -1,   1,  0,  0,
     1,  1,  1,   1,  0,  0,
     1,  1, -1,   1,  0,  0,
    // Top face
    -1,  1,  1,   0,  1,  0,
     1,  1,  1,   0,  1,  0,
    -1,  1, -1,   0,  1,  0,
     1,  1, -1,   0,  1,  0,
    // Bottom face
    -1, -1, -1,   0, -1,  0,
     1, -1, -1,   0, -1,  0,
    -1, -1,  1,   0, -1,  0,
     1, -1,  1,   0, -1,  0,
  ]);

  const indices = new Uint16Array([
    // Front
    0, 1, 2,  2, 1, 3,
    // Back
    4, 5, 6,  6, 5, 7,
    // Left
    8, 9,10, 10, 9,11,
    // Right
   12,13,14, 14,13,15,
    // Top
   16,17,18, 18,17,19,
    // Bottom
   20,21,22, 22,21,23,
  ]);

  return createMesh(device, {
    id: options.id || "unit_cube",
    label: options.label || "UnitCubeMesh",
    vertexData: data,
    vertexStride: 6 * 4,
    attributes: [
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
    ],
    indexData: indices,
    topology: "triangle-list",
    enableClusterCulling: !!options.enableClusterCulling,
  });
}
