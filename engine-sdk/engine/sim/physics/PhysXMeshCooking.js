// Local register helpers (avoid circular import with PhysXPhysicsWorld)
function registerConvexMesh(world, meshId, pxConvexMesh) {
  if (!world || !world.convexMeshes || !meshId || !pxConvexMesh) { return; }
  world.convexMeshes.set(meshId, pxConvexMesh);
}
function registerTriangleMesh(world, meshId, pxTriangleMesh) {
  if (!world || !world.triangleMeshes || !meshId || !pxTriangleMesh) { return; }
  world.triangleMeshes.set(meshId, pxTriangleMesh);
}

function ensureFloat32Array(source) {
  if (source instanceof Float32Array) {
    return source;
  }
  if (Array.isArray(source)) {
    return new Float32Array(source);
  }
  if (source && source.buffer instanceof ArrayBuffer) {
    return new Float32Array(source.buffer, source.byteOffset, source.byteLength / 4);
  }
  return null;
}

function ensureIndexArray(source) {
  if (!source) {
    return null;
  }
  if (source instanceof Uint16Array || source instanceof Uint32Array) {
    return source;
  }
  if (Array.isArray(source)) {
    const maxIndex = source.length ? Math.max.apply(null, source) : 0;
    if (!Number.isFinite(maxIndex) || maxIndex < 0) {
      return null;
    }
    if (maxIndex <= 65535) {
      return new Uint16Array(source);
    }
    return new Uint32Array(source);
  }
  if (source.buffer instanceof ArrayBuffer) {
    if (source instanceof Uint16Array || source instanceof Uint32Array) {
      return source;
    }
    const asU32 = new Uint32Array(source.buffer, source.byteOffset, source.byteLength / 4);
    const maxIndex = asU32.length ? Math.max.apply(null, Array.from(asU32)) : 0;
    if (!Number.isFinite(maxIndex) || maxIndex < 0) {
      return null;
    }
    if (maxIndex <= 65535) {
      return new Uint16Array(asU32);
    }
    return asU32;
  }
  return null;
}

function getCookingParams(world) {
  if (!world || !world.module || !world.tolerances) {
    return null;
  }
  if (world.cookingParams) {
    return world.cookingParams;
  }
  const PhysX = world.module;
  if (!PhysX.PxCookingParams) {
    return null;
  }
  const params = new PhysX.PxCookingParams(world.tolerances);
  try {
    if (typeof params.set_suppressTriangleMeshRemapTable === "function") {
      params.set_suppressTriangleMeshRemapTable(true);
    } else {
      params.suppressTriangleMeshRemapTable = true;
    }
  } catch (_) {}
  try {
    if (typeof params.set_buildTriangleAdjacencies === "function") {
      params.set_buildTriangleAdjacencies(true);
    } else {
      params.buildTriangleAdjacencies = true;
    }
  } catch (_) {}
  try {
    if (typeof params.set_meshWeldTolerance === "function") {
      params.set_meshWeldTolerance(1e-4);
    } else {
      params.meshWeldTolerance = 1e-4;
    }
  } catch (_) {}
  try {
    if (PhysX.PxMeshPreprocessingFlags && PhysX.PxMeshPreprocessingFlagEnum) {
      const flags = new PhysX.PxMeshPreprocessingFlags(0);
      if (typeof PhysX.PxMeshPreprocessingFlagEnum.eWELD_VERTICES !== "undefined") {
        flags.raise(PhysX.PxMeshPreprocessingFlagEnum.eWELD_VERTICES);
      }
      if (typeof params.set_meshPreprocessParams === "function") {
        params.set_meshPreprocessParams(flags);
      } else {
        params.meshPreprocessParams = flags;
      }
    }
  } catch (_) {}
  world.cookingParams = params;
  return params;
}

function cookConvexMeshInternal(world, positions) {
  if (!world || !world.module || !world.tolerances) {
    return null;
  }
  const PhysX = world.module;
  const helpers =
    PhysX.NativeArrayHelpers && PhysX.NativeArrayHelpers.prototype
      ? PhysX.NativeArrayHelpers.prototype
      : null;
  if (
    !helpers ||
    !helpers.setRealAt ||
    !PhysX._webidl_malloc ||
    !PhysX._webidl_free
  ) {
    return null;
  }
  const params = getCookingParams(world);
  if (!params || !PhysX.CreateConvexMesh || !PhysX.PxConvexMeshDesc || !PhysX.PxBoundedData) {
    return null;
  }

  const vertices = ensureFloat32Array(positions);
  if (!vertices || vertices.length === 0 || vertices.length % 3 !== 0) {
    return null;
  }
  const vertexCount = vertices.length / 3;
  if (!Number.isFinite(vertexCount) || vertexCount <= 0) {
    return null;
  }

  const byteLength = vertices.byteLength;
  const ptr = PhysX._webidl_malloc(byteLength);
  if (!ptr) {
    return null;
  }

  try {
    for (let i = 0; i < vertices.length; i++) {
      helpers.setRealAt(ptr, i, vertices[i]);
    }

    const points = new PhysX.PxBoundedData();
    points.count = vertexCount;
    points.stride = 3 * 4;
    points.data = ptr;

    const desc = new PhysX.PxConvexMeshDesc();
    desc.points = points;

    if (PhysX.PxConvexFlags && PhysX.PxConvexFlagEnum &&
        typeof PhysX.PxConvexFlagEnum.eCOMPUTE_CONVEX !== "undefined") {
      const flags = new PhysX.PxConvexFlags(0);
      flags.raise(PhysX.PxConvexFlagEnum.eCOMPUTE_CONVEX);
      desc.flags = flags;
    }

    const mesh = PhysX.CreateConvexMesh(params, desc);
    if (!mesh) {
      return null;
    }
    return mesh;
  } finally {
    try {
      PhysX._webidl_free(ptr);
    } catch (_) {}
  }
}

function cookTriangleMeshInternal(world, positions, indices) {
  if (!world || !world.module || !world.tolerances) {
    return null;
  }
  const PhysX = world.module;
  const helpers =
    PhysX.NativeArrayHelpers && PhysX.NativeArrayHelpers.prototype
      ? PhysX.NativeArrayHelpers.prototype
      : null;
  if (
    !helpers ||
    !helpers.setRealAt ||
    !helpers.setU16At ||
    !helpers.setU32At ||
    !PhysX._webidl_malloc ||
    !PhysX._webidl_free
  ) {
    return null;
  }
  const params = getCookingParams(world);
  if (!params || !PhysX.CreateTriangleMesh || !PhysX.PxTriangleMeshDesc || !PhysX.PxBoundedData) {
    return null;
  }

  const vertices = ensureFloat32Array(positions);
  if (!vertices || vertices.length === 0 || vertices.length % 3 !== 0) {
    return null;
  }
  const vertexCount = vertices.length / 3;
  if (!Number.isFinite(vertexCount) || vertexCount <= 0) {
    return null;
  }

  const indexArray = ensureIndexArray(indices);
  if (!indexArray || indexArray.length === 0 || indexArray.length % 3 !== 0) {
    return null;
  }
  const triangleCount = indexArray.length / 3;
  if (!Number.isFinite(triangleCount) || triangleCount <= 0) {
    return null;
  }

  const vertexBytes = vertices.byteLength;
  const indexBytes = indexArray.byteLength;
  const vPtr = PhysX._webidl_malloc(vertexBytes);
  const iPtr = PhysX._webidl_malloc(indexBytes);
  if (!vPtr || !iPtr) {
    if (vPtr) {
      try {
        PhysX._webidl_free(vPtr);
      } catch (_) {}
    }
    if (iPtr) {
      try {
        PhysX._webidl_free(iPtr);
      } catch (_) {}
    }
    return null;
  }

  try {
    for (let i = 0; i < vertices.length; i++) {
      helpers.setRealAt(vPtr, i, vertices[i]);
    }
    if (indexArray instanceof Uint16Array) {
      for (let i = 0; i < indexArray.length; i++) {
        helpers.setU16At(iPtr, i, indexArray[i]);
      }
    } else {
      for (let i = 0; i < indexArray.length; i++) {
        helpers.setU32At(iPtr, i, indexArray[i]);
      }
    }

    const points = new PhysX.PxBoundedData();
    points.count = vertexCount;
    points.stride = 3 * 4;
    points.data = vPtr;

    const triangles = new PhysX.PxBoundedData();
    triangles.count = triangleCount;
    triangles.stride = 3 * indexArray.BYTES_PER_ELEMENT;
    triangles.data = iPtr;

    const desc = new PhysX.PxTriangleMeshDesc();
    desc.points = points;
    desc.triangles = triangles;
    
    if (PhysX.PxMeshFlags && PhysX.PxMeshFlagEnum) {
      try {
        const meshFlags = new PhysX.PxMeshFlags(0);
        if (indexArray instanceof Uint16Array && typeof PhysX.PxMeshFlagEnum.e16_BIT_INDICES !== "undefined") {
          meshFlags.raise(PhysX.PxMeshFlagEnum.e16_BIT_INDICES);
        }
        desc.set_flags(meshFlags);
        PhysX.destroy(meshFlags);
      } catch (_) {}
    }

    const mesh = PhysX.CreateTriangleMesh(params, desc);
    if (!mesh) {
      return null;
    }
    return mesh;
  } finally {
    try {
      PhysX._webidl_free(vPtr);
    } catch (_) {}
    try {
      PhysX._webidl_free(iPtr);
    } catch (_) {}
  }
}

export function cookAndRegisterConvexMeshForWorld(world, meshId, positions) {
  if (!world || !meshId) {
    return null;
  }
  const mesh = cookConvexMeshInternal(world, positions);
  if (!mesh) {
    return null;
  }
  registerConvexMesh(world, meshId, mesh);
  return mesh;
}

export function cookAndRegisterTriangleMeshForWorld(world, meshId, positions, indices) {
  if (!world || !meshId) {
    return null;
  }
  const mesh = cookTriangleMeshInternal(world, positions, indices);
  if (!mesh) {
    return null;
  }
  registerTriangleMesh(world, meshId, mesh);
  return mesh;
}

export { cookAndRegisterConvexMeshForWorld as PhysXMeshCooking };
