import { cookAndRegisterConvexMeshForWorld } from "./PhysXMeshCooking.js";

const cookedMeshCache = new Map();
let _dynamicMeshSequence = 0;

function _newDynamicMeshId() {
    return `dynamic:${Date.now()}:${++_dynamicMeshSequence}`;
}

export function cookMeshColliderFromVertices(world, meshId, positions) {
    if (!world || !meshId || !positions) return null;
    
    const cacheKey = meshId;
    if (cookedMeshCache.has(cacheKey)) {
        return cookedMeshCache.get(cacheKey);
    }
    
    if (world.convexMeshes && world.convexMeshes.get(meshId)) {
        cookedMeshCache.set(cacheKey, meshId);
        return meshId;
    }
    
    const posArray = positions instanceof Float32Array 
        ? positions 
        : new Float32Array(positions);
    
    if (posArray.length < 9) return null;
    
    const mesh = cookAndRegisterConvexMeshForWorld(world, meshId, posArray);
    if (mesh) {
        cookedMeshCache.set(cacheKey, meshId);
        return meshId;
    }
    return null;
}

export function cookMeshColliderFromRenderMesh(world, renderMesh) {
    if (!world || !renderMesh) return null;
    
    const meshId = renderMesh.id || renderMesh.label || _newDynamicMeshId();
    
    let positions = null;
    
    if (renderMesh.positions) {
        positions = renderMesh.positions;
    } else if (renderMesh.vertexData && renderMesh.vertexStride) {
        const stride = renderMesh.vertexStride / 4;
        const vertexCount = renderMesh.vertexCount || Math.floor(renderMesh.vertexData.length / stride);
        positions = new Float32Array(vertexCount * 3);
        for (let i = 0; i < vertexCount; i++) {
            positions[i * 3] = renderMesh.vertexData[i * stride];
            positions[i * 3 + 1] = renderMesh.vertexData[i * stride + 1];
            positions[i * 3 + 2] = renderMesh.vertexData[i * stride + 2];
        }
    }
    
    if (!positions || positions.length < 9) return null;
    
    return cookMeshColliderFromVertices(world, meshId, positions);
}

export function getColliderConfigForMesh(meshId, halfExtents = [0.5, 0.5, 0.5]) {
    return {
        shape: 'convexMesh',
        meshId: meshId,
        halfExtents: halfExtents,
        isTrigger: false
    };
}

export function createUniversalCollider(world, meshType, geometryFn, halfExtents = [0.5, 0.5, 0.5], material = null, density = 1.0) {
    const meshId = `universal:collider:${meshType}`;
    
    if (world.convexMeshes && world.convexMeshes.get(meshId)) {
        return buildColliderConfig(meshId, halfExtents, material, density);
    }
    
    if (typeof geometryFn === 'function') {
        const geometry = geometryFn();
        if (geometry && geometry.positions) {
            const cooked = cookMeshColliderFromVertices(world, meshId, geometry.positions);
            if (cooked) {
                return buildColliderConfig(meshId, halfExtents, material, density);
            }
        }
    }
    
    return { shape: 'box', halfExtents, isTrigger: false, material, density };
}

function buildColliderConfig(meshId, halfExtents, material, density) {
    const config = {
        shape: 'convexMesh',
        meshId: meshId,
        halfExtents: halfExtents,
        isTrigger: false
    };
    if (material) config.material = material;
    if (density && density !== 1.0) config.density = density;
    return config;
}

export function clearMeshColliderCache() {
    cookedMeshCache.clear();
}
