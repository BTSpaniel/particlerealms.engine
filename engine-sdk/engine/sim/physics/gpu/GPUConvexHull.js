/**
 * GPUConvexHull.js — CPU-side Quickhull 3D + GPU Buffer Helpers
 * 
 * Computes convex hulls from vertex data (runs once at cook time, not per-frame).
 * Produces GPU-compatible hull data for narrowphase collision detection.
 * 
 * PhysX 5 GPU limits enforced:
 * - Max 64 vertices per hull
 * - Max 32 vertices per face
 * - Hulls exceeding these limits are simplified
 * 
 * Algorithm: Incremental Quickhull 3D
 * - Find initial tetrahedron from extreme points
 * - Iteratively add furthest point from each face
 * - Expand horizon edges, rebuild faces
 * 
 * Also builds precomputed support maps for GJK:
 * - For 128 sampled directions, store the support vertex index
 * - Enables O(1) support queries on GPU
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const MAX_HULL_VERTICES = 64;  // PhysX 5 GPU limit
export const MAX_HULL_FACES = 128;
export const MAX_VERTS_PER_FACE = 32; // PhysX 5 GPU limit
export const SUPPORT_MAP_DIRECTIONS = 128;

const EPSILON = 1e-8;

// ============================================================================
// QUICKHULL 3D
// ============================================================================

/**
 * Compute a 3D convex hull from a set of vertices.
 * @param {Float32Array|number[]} vertices - Flat array of xyz positions (length = N*3)
 * @param {Object} [options]
 * @param {number} [options.maxVertices=64] - Max vertices in output hull
 * @returns {{ vertices: Float32Array, faces: Array, normals: Float32Array, adjacency: Array }}
 */
export function computeConvexHull(vertices, options = {}) {
    const maxVerts = options.maxVertices ?? MAX_HULL_VERTICES;
    const verts = vertices instanceof Float32Array ? vertices : new Float32Array(vertices);
    const numVerts = verts.length / 3;

    if (numVerts < 4) {
        console.warn('[GPUConvexHull] Need at least 4 vertices for a 3D hull');
        return null;
    }

    // ── Step 1: Find initial tetrahedron ──────────────────────────────────

    const extreme = _findExtremePoints(verts, numVerts);
    const tetra = _buildInitialTetrahedron(verts, numVerts, extreme);
    if (!tetra) {
        console.warn('[GPUConvexHull] Degenerate input — could not build initial tetrahedron');
        return null;
    }

    // ── Step 2: Assign points to faces ────────────────────────────────────

    let faces = tetra.faces; // Array of { verts: [i,j,k], normal: [nx,ny,nz], dist: d, outside: [] }
    const usedVerts = new Set(tetra.usedIndices);

    for (let i = 0; i < numVerts; i++) {
        if (usedVerts.has(i)) continue;
        const px = verts[i * 3], py = verts[i * 3 + 1], pz = verts[i * 3 + 2];

        let bestFace = -1, bestDist = EPSILON;
        for (let f = 0; f < faces.length; f++) {
            const d = _distToPlane(px, py, pz, faces[f].normal, faces[f].dist);
            if (d > bestDist) {
                bestDist = d;
                bestFace = f;
            }
        }
        if (bestFace >= 0) {
            faces[bestFace].outside.push(i);
        }
    }

    // ── Step 3: Iterative expansion ───────────────────────────────────────

    let iterations = 0;
    const maxIterations = numVerts * 2;

    while (iterations++ < maxIterations) {
        // Find face with furthest outside point
        let bestFaceIdx = -1, bestPointIdx = -1, bestPointDist = -Infinity;

        for (let f = 0; f < faces.length; f++) {
            const outside = faces[f].outside;
            if (outside.length === 0) continue;

            for (const pi of outside) {
                const d = _distToPlane(
                    verts[pi * 3], verts[pi * 3 + 1], verts[pi * 3 + 2],
                    faces[f].normal, faces[f].dist,
                );
                if (d > bestPointDist) {
                    bestPointDist = d;
                    bestPointIdx = pi;
                    bestFaceIdx = f;
                }
            }
        }

        if (bestFaceIdx < 0) break; // All points inside hull

        // Check vertex limit
        if (usedVerts.size >= maxVerts) break;

        const eye = bestPointIdx;
        const eyeX = verts[eye * 3], eyeY = verts[eye * 3 + 1], eyeZ = verts[eye * 3 + 2];

        // Find visible faces from eye point
        const visible = new Set();
        for (let f = 0; f < faces.length; f++) {
            if (_distToPlane(eyeX, eyeY, eyeZ, faces[f].normal, faces[f].dist) > EPSILON) {
                visible.add(f);
            }
        }

        // Find horizon edges (edges shared by exactly one visible face)
        const horizonEdges = [];
        for (const fi of visible) {
            const fv = faces[fi].verts;
            for (let e = 0; e < fv.length; e++) {
                const a = fv[e], b = fv[(e + 1) % fv.length];
                // Check if neighbor face (sharing edge b→a) is not visible
                let neighborVisible = false;
                for (const fj of visible) {
                    if (fj === fi) continue;
                    const nv = faces[fj].verts;
                    for (let ne = 0; ne < nv.length; ne++) {
                        if (nv[ne] === b && nv[(ne + 1) % nv.length] === a) {
                            neighborVisible = true;
                            break;
                        }
                    }
                    if (neighborVisible) break;
                }
                if (!neighborVisible) {
                    horizonEdges.push([a, b]);
                }
            }
        }

        if (horizonEdges.length < 3) break; // Degenerate

        // Collect orphaned outside points from visible faces
        const orphans = [];
        for (const fi of visible) {
            for (const pi of faces[fi].outside) {
                if (pi !== eye) orphans.push(pi);
            }
        }

        // Remove visible faces (reverse order to preserve indices)
        const sortedVisible = [...visible].sort((a, b) => b - a);
        for (const fi of sortedVisible) {
            faces.splice(fi, 1);
        }

        // Create new faces from horizon edges to eye point
        const newFaces = [];
        for (const [a, b] of horizonEdges) {
            const face = _makeFace(verts, a, b, eye);
            if (face) {
                face.outside = [];
                newFaces.push(face);
            }
        }

        faces = faces.concat(newFaces);
        usedVerts.add(eye);

        // Reassign orphaned points
        for (const pi of orphans) {
            const px = verts[pi * 3], py = verts[pi * 3 + 1], pz = verts[pi * 3 + 2];
            let bf = -1, bd = EPSILON;
            for (let f = 0; f < faces.length; f++) {
                const d = _distToPlane(px, py, pz, faces[f].normal, faces[f].dist);
                if (d > bd) { bd = d; bf = f; }
            }
            if (bf >= 0) {
                faces[bf].outside.push(pi);
            }
        }
    }

    // ── Step 4: Extract hull data ─────────────────────────────────────────

    // Collect unique vertices used in faces
    const vertexSet = new Set();
    for (const f of faces) {
        for (const vi of f.verts) vertexSet.add(vi);
    }

    const vertexMap = new Map();
    const hullVerts = [];
    let idx = 0;
    for (const vi of vertexSet) {
        vertexMap.set(vi, idx++);
        hullVerts.push(verts[vi * 3], verts[vi * 3 + 1], verts[vi * 3 + 2]);
    }

    const hullVertices = new Float32Array(hullVerts);
    const hullFaces = faces.map(f => ({
        vertexIndices: f.verts.map(vi => vertexMap.get(vi)),
        normal: f.normal,
        offset: f.dist,
    }));

    const hullNormals = new Float32Array(hullFaces.length * 4);
    for (let i = 0; i < hullFaces.length; i++) {
        hullNormals[i * 4]     = hullFaces[i].normal[0];
        hullNormals[i * 4 + 1] = hullFaces[i].normal[1];
        hullNormals[i * 4 + 2] = hullFaces[i].normal[2];
        hullNormals[i * 4 + 3] = hullFaces[i].offset;
    }

    return {
        vertices: hullVertices,
        vertexCount: hullVertices.length / 3,
        faces: hullFaces,
        faceCount: hullFaces.length,
        normals: hullNormals,
    };
}

// ============================================================================
// SUPPORT MAP (for GJK on GPU)
// ============================================================================

/**
 * Build precomputed support map for fast GPU GJK.
 * For each of N uniformly sampled directions, stores the index of the
 * furthest vertex in that direction.
 * 
 * @param {{ vertices: Float32Array }} hull
 * @param {number} [numDirections=128]
 * @returns {Uint32Array} Support vertex indices (one per direction)
 */
export function buildSupportMap(hull, numDirections = SUPPORT_MAP_DIRECTIONS) {
    const verts = hull.vertices;
    const numVerts = verts.length / 3;
    const directions = _generateUniformDirections(numDirections);
    const map = new Uint32Array(numDirections);

    for (let d = 0; d < numDirections; d++) {
        const dx = directions[d * 3], dy = directions[d * 3 + 1], dz = directions[d * 3 + 2];
        let bestIdx = 0, bestDot = -Infinity;

        for (let v = 0; v < numVerts; v++) {
            const dot = verts[v * 3] * dx + verts[v * 3 + 1] * dy + verts[v * 3 + 2] * dz;
            if (dot > bestDot) {
                bestDot = dot;
                bestIdx = v;
            }
        }
        map[d] = bestIdx;
    }

    return map;
}

/**
 * Upload hull data to a GPU buffer for narrowphase use.
 * Layout: [vertexCount(u32), faceCount(u32), pad, pad] + [vertices (vec4)] + [normals (vec4)] + [supportMap (u32)]
 * 
 * @param {GPUDevice} device
 * @param {{ vertices: Float32Array, normals: Float32Array, vertexCount: number, faceCount: number }} hull
 * @param {Uint32Array} [supportMap] - From buildSupportMap()
 * @returns {GPUBuffer}
 */
export function hullToGPUBuffer(device, hull, supportMap = null) {
    const vertCount = hull.vertexCount;
    const faceCount = hull.faceCount;

    // Pad vertices to vec4
    const vertsPadded = new Float32Array(vertCount * 4);
    for (let i = 0; i < vertCount; i++) {
        vertsPadded[i * 4]     = hull.vertices[i * 3];
        vertsPadded[i * 4 + 1] = hull.vertices[i * 3 + 1];
        vertsPadded[i * 4 + 2] = hull.vertices[i * 3 + 2];
        vertsPadded[i * 4 + 3] = 0;
    }

    // Header: 4 u32
    const headerSize = 16;
    const vertsSize = vertCount * 16;
    const normalsSize = faceCount * 16;
    const supportSize = supportMap ? supportMap.length * 4 : 0;
    const totalSize = headerSize + vertsSize + normalsSize + supportSize;

    const buffer = device.createBuffer({
        label: `ConvexHull_${vertCount}v_${faceCount}f`,
        size: Math.max(totalSize, 16),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Write header
    const header = new Uint32Array([vertCount, faceCount, supportMap ? supportMap.length : 0, 0]);
    device.queue.writeBuffer(buffer, 0, header);

    // Write vertices
    device.queue.writeBuffer(buffer, headerSize, vertsPadded);

    // Write normals
    device.queue.writeBuffer(buffer, headerSize + vertsSize, hull.normals);

    // Write support map
    if (supportMap) {
        device.queue.writeBuffer(buffer, headerSize + vertsSize + normalsSize, supportMap);
    }

    return buffer;
}

/**
 * Compute AABB half-extents from hull vertices (for broadphase).
 * @param {{ vertices: Float32Array, vertexCount: number }} hull
 * @returns {number[]} [halfX, halfY, halfZ]
 */
export function hullHalfExtents(hull) {
    const verts = hull.vertices;
    const n = hull.vertexCount;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < n; i++) {
        const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    return [
        (maxX - minX) * 0.5,
        (maxY - minY) * 0.5,
        (maxZ - minZ) * 0.5,
    ];
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function _findExtremePoints(verts, numVerts) {
    const extreme = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
    let mnX = Infinity, mxX = -Infinity;
    let mnY = Infinity, mxY = -Infinity;
    let mnZ = Infinity, mxZ = -Infinity;

    for (let i = 0; i < numVerts; i++) {
        const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
        if (x < mnX) { mnX = x; extreme.minX = i; }
        if (x > mxX) { mxX = x; extreme.maxX = i; }
        if (y < mnY) { mnY = y; extreme.minY = i; }
        if (y > mxY) { mxY = y; extreme.maxY = i; }
        if (z < mnZ) { mnZ = z; extreme.minZ = i; }
        if (z > mxZ) { mxZ = z; extreme.maxZ = i; }
    }
    return extreme;
}

function _buildInitialTetrahedron(verts, numVerts, extreme) {
    // Find two most distant extreme points
    const candidates = [extreme.minX, extreme.maxX, extreme.minY, extreme.maxY, extreme.minZ, extreme.maxZ];
    let bestI = 0, bestJ = 1, bestDist2 = 0;
    for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
            const d2 = _dist2(verts, candidates[i], candidates[j]);
            if (d2 > bestDist2) { bestDist2 = d2; bestI = candidates[i]; bestJ = candidates[j]; }
        }
    }
    if (bestDist2 < EPSILON) return null;

    // Find point most distant from line bestI→bestJ
    let bestK = -1, bestLineDist = 0;
    const ax = verts[bestI * 3], ay = verts[bestI * 3 + 1], az = verts[bestI * 3 + 2];
    const bx = verts[bestJ * 3], by = verts[bestJ * 3 + 1], bz = verts[bestJ * 3 + 2];
    for (let i = 0; i < numVerts; i++) {
        if (i === bestI || i === bestJ) continue;
        const d = _distToLine(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2], ax, ay, az, bx, by, bz);
        if (d > bestLineDist) { bestLineDist = d; bestK = i; }
    }
    if (bestK < 0 || bestLineDist < EPSILON) return null;

    // Find point most distant from plane formed by bestI, bestJ, bestK
    const n = _triangleNormal(verts, bestI, bestJ, bestK);
    const d0 = -(n[0] * ax + n[1] * ay + n[2] * az);
    let bestL = -1, bestPlaneDist = 0;
    for (let i = 0; i < numVerts; i++) {
        if (i === bestI || i === bestJ || i === bestK) continue;
        const d = Math.abs(_distToPlane(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2], n, d0));
        if (d > bestPlaneDist) { bestPlaneDist = d; bestL = i; }
    }
    if (bestL < 0 || bestPlaneDist < EPSILON) return null;

    // Ensure correct winding (outward normals)
    const usedIndices = [bestI, bestJ, bestK, bestL];
    const cx = verts[bestL * 3], cy = verts[bestL * 3 + 1], cz = verts[bestL * 3 + 2];
    const side = _distToPlane(cx, cy, cz, n, d0);

    let a, b, c;
    if (side > 0) {
        a = bestI; b = bestK; c = bestJ; // Flip winding
    } else {
        a = bestI; b = bestJ; c = bestK;
    }
    const dd = bestL;

    const faces = [
        _makeFace(verts, a, b, c),
        _makeFace(verts, a, b, dd),
        _makeFace(verts, b, c, dd),
        _makeFace(verts, c, a, dd),
    ].filter(f => f !== null);

    // Ensure all face normals point outward (away from centroid)
    const centX = (verts[a * 3] + verts[b * 3] + verts[c * 3] + verts[dd * 3]) / 4;
    const centY = (verts[a * 3 + 1] + verts[b * 3 + 1] + verts[c * 3 + 1] + verts[dd * 3 + 1]) / 4;
    const centZ = (verts[a * 3 + 2] + verts[b * 3 + 2] + verts[c * 3 + 2] + verts[dd * 3 + 2]) / 4;

    for (const face of faces) {
        const fv0 = face.verts[0];
        const toFace = [
            verts[fv0 * 3] - centX,
            verts[fv0 * 3 + 1] - centY,
            verts[fv0 * 3 + 2] - centZ,
        ];
        const dotN = face.normal[0] * toFace[0] + face.normal[1] * toFace[1] + face.normal[2] * toFace[2];
        if (dotN < 0) {
            // Flip normal and winding
            face.normal[0] *= -1; face.normal[1] *= -1; face.normal[2] *= -1;
            face.dist *= -1;
            face.verts.reverse();
        }
    }

    return { faces, usedIndices };
}

function _makeFace(verts, a, b, c) {
    const n = _triangleNormal(verts, a, b, c);
    if (!n) return null;
    const d = -(n[0] * verts[a * 3] + n[1] * verts[a * 3 + 1] + n[2] * verts[a * 3 + 2]);
    return { verts: [a, b, c], normal: n, dist: d, outside: [] };
}

function _triangleNormal(verts, a, b, c) {
    const abx = verts[b * 3] - verts[a * 3];
    const aby = verts[b * 3 + 1] - verts[a * 3 + 1];
    const abz = verts[b * 3 + 2] - verts[a * 3 + 2];
    const acx = verts[c * 3] - verts[a * 3];
    const acy = verts[c * 3 + 1] - verts[a * 3 + 1];
    const acz = verts[c * 3 + 2] - verts[a * 3 + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < EPSILON) return null;
    return [nx / len, ny / len, nz / len];
}

function _distToPlane(px, py, pz, normal, dist) {
    return normal[0] * px + normal[1] * py + normal[2] * pz + dist;
}

function _dist2(verts, a, b) {
    const dx = verts[a * 3] - verts[b * 3];
    const dy = verts[a * 3 + 1] - verts[b * 3 + 1];
    const dz = verts[a * 3 + 2] - verts[b * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
}

function _distToLine(px, py, pz, ax, ay, az, bx, by, bz) {
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const crossX = apy * abz - apz * aby;
    const crossY = apz * abx - apx * abz;
    const crossZ = apx * aby - apy * abx;
    const crossLen = Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
    const abLen = Math.sqrt(abx * abx + aby * aby + abz * abz);
    return abLen > EPSILON ? crossLen / abLen : 0;
}

function _generateUniformDirections(n) {
    // Fibonacci sphere for uniform distribution
    const dirs = new Float32Array(n * 3);
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
        const y = 1 - (i / (n - 1)) * 2;
        const radiusXZ = Math.sqrt(1 - y * y);
        const theta = goldenAngle * i;
        dirs[i * 3]     = Math.cos(theta) * radiusXZ;
        dirs[i * 3 + 1] = y;
        dirs[i * 3 + 2] = Math.sin(theta) * radiusXZ;
    }
    return dirs;
}
