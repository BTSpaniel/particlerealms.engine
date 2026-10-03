/**
 * OGCContact.js - Offset Geometric Contact Model
 * 
 * Implementation of the SIGGRAPH 2025 paper:
 * "Offset Geometric Contact for Real-Time Simulation"
 * Chen et al., 2025
 * 
 * Key features:
 * - Guaranteed penetration-free simulation
 * - Orthogonal contact forces (along face normals, not radial)
 * - Large contact radius support (2-5mm without artifacts)
 * - No CCD required - uses conservative displacement bounds
 * - GPU-efficient parallel local operations
 * 
 * The offset geometry approach inflates primitives by a contact radius,
 * computes distance to the offset surface, and applies smooth barrier
 * energy that activates before penetration occurs.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default contact radius (meters) - paper recommends 2-5mm for cloth */
export const DEFAULT_CONTACT_RADIUS = 0.003; // 3mm

/** Barrier energy activation distance (multiple of contact radius) */
export const BARRIER_ACTIVATION_RATIO = 2.0;

/** Minimum distance to prevent numerical issues */
export const MIN_DISTANCE = 1e-8;

/** Fixed-point scale for GPU atomics */
export const FIXED_SCALE = 1e6;

// ============================================================================
// BARRIER ENERGY FUNCTIONS (CPU)
// ============================================================================

/**
 * OGC Barrier energy function g(d) = d²(2r - d)²
 * Smooth C1 continuous, zero at d=0 and d=2r
 * Maximum at d=r
 * 
 * @param {number} d - Distance to offset surface
 * @param {number} r - Contact radius
 * @returns {number} Barrier energy
 */
export function barrierEnergy(d, r) {
    if (d <= 0 || d >= 2 * r) return 0;
    const term = 2 * r - d;
    return d * d * term * term;
}

/**
 * Derivative of barrier energy: g'(d) = 2d(2r-d)(2r-2d)
 * Used for force computation
 * 
 * @param {number} d - Distance to offset surface
 * @param {number} r - Contact radius
 * @returns {number} Barrier force magnitude (negative = repulsive)
 */
export function barrierForce(d, r) {
    if (d <= 0 || d >= 2 * r) return 0;
    const term1 = 2 * r - d;
    const term2 = 2 * r - 2 * d;
    return 2 * d * term1 * term2;
}

/**
 * Normalized barrier energy for stability
 * Scales to [0, 1] range with maximum at d=r
 * 
 * @param {number} d - Distance
 * @param {number} r - Contact radius
 * @returns {number} Normalized energy [0, 1]
 */
export function normalizedBarrierEnergy(d, r) {
    const maxEnergy = r * r * r * r; // Maximum at d=r
    return barrierEnergy(d, r) / maxEnergy;
}

/**
 * Compute conservative displacement bound for a vertex
 * This is the maximum safe movement before barrier check is needed
 * 
 * @param {number} currentDistance - Current distance to nearest obstacle
 * @param {number} contactRadius - Contact radius r
 * @returns {number} Maximum safe displacement
 */
export function conservativeDisplacementBound(currentDistance, contactRadius) {
    // Can move at most half the distance to activation zone
    const activationDist = 2 * contactRadius;
    if (currentDistance >= activationDist) {
        return (currentDistance - activationDist) * 0.5;
    }
    // Already in activation zone - use smaller bound
    return Math.max(0, currentDistance * 0.25);
}

// ============================================================================
// OFFSET GEOMETRY PRIMITIVES (CPU)
// ============================================================================

// Cached result objects for hot-path distance functions (eliminates ~4000 allocs/frame)
const _sphereResult = { distance: 0, normal: [0, 1, 0] };
const _planeResult = { distance: 0, normal: [0, 1, 0] };
const _capsuleResult = { distance: 0, normal: [0, 1, 0], t: 0 };
const _boxResult = { distance: 0, normal: [0, 1, 0] };

/**
 * Distance from point to offset sphere (sphere with radius inflated by r)
 * @param {Array} p - Point [x, y, z]
 * @param {Array} center - Sphere center [x, y, z]
 * @param {number} radius - Original sphere radius
 * @param {number} r - Contact offset radius
 * @returns {{distance: number, normal: Array}} Distance and contact normal
 */
export function distanceToOffsetSphere(p, center, radius, r) {
    const dx = p[0] - center[0];
    const dy = p[1] - center[1];
    const dz = p[2] - center[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    const res = _sphereResult;
    if (dist < MIN_DISTANCE) {
        res.distance = radius + r;
        res.normal[0] = 0; res.normal[1] = 1; res.normal[2] = 0;
        return res;
    }
    
    const invDist = 1 / dist;
    res.distance = dist - (radius + r);
    res.normal[0] = dx * invDist; res.normal[1] = dy * invDist; res.normal[2] = dz * invDist;
    return res;
}

/**
 * Distance from point to offset plane (plane pushed by r along normal)
 * @param {Array} p - Point [x, y, z]
 * @param {Array} planePoint - Point on plane
 * @param {Array} planeNormal - Plane normal (unit vector)
 * @param {number} r - Contact offset radius
 * @returns {{distance: number, normal: Array}}
 */
export function distanceToOffsetPlane(p, planePoint, planeNormal, r) {
    const dx = p[0] - planePoint[0];
    const dy = p[1] - planePoint[1];
    const dz = p[2] - planePoint[2];
    const dist = dx * planeNormal[0] + dy * planeNormal[1] + dz * planeNormal[2];
    
    const res = _planeResult;
    res.distance = dist - r;
    res.normal[0] = planeNormal[0]; res.normal[1] = planeNormal[1]; res.normal[2] = planeNormal[2];
    return res;
}

/**
 * Distance from point to offset capsule
 * @param {Array} p - Point [x, y, z]
 * @param {Array} a - Capsule start [x, y, z]
 * @param {Array} b - Capsule end [x, y, z]
 * @param {number} radius - Capsule radius
 * @param {number} r - Contact offset radius
 * @returns {{distance: number, normal: Array, t: number}}
 */
export function distanceToOffsetCapsule(p, a, b, radius, r) {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const apx = p[0] - a[0];
    const apy = p[1] - a[1];
    const apz = p[2] - a[2];
    
    const abLen2 = abx * abx + aby * aby + abz * abz;
    let t = 0;
    
    if (abLen2 > MIN_DISTANCE) {
        t = (apx * abx + apy * aby + apz * abz) / abLen2;
        t = Math.max(0, Math.min(1, t));
    }
    
    const closestX = a[0] + t * abx;
    const closestY = a[1] + t * aby;
    const closestZ = a[2] + t * abz;
    
    const dx = p[0] - closestX;
    const dy = p[1] - closestY;
    const dz = p[2] - closestZ;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    const res = _capsuleResult;
    res.t = t;
    if (dist < MIN_DISTANCE) {
        res.distance = radius + r;
        res.normal[0] = 0; res.normal[1] = 1; res.normal[2] = 0;
        if (Math.abs(aby) > 0.9) { res.normal[0] = 1; res.normal[1] = 0; }
        return res;
    }
    
    const invDist = 1 / dist;
    res.distance = dist - (radius + r);
    res.normal[0] = dx * invDist; res.normal[1] = dy * invDist; res.normal[2] = dz * invDist;
    return res;
}

/**
 * Distance from point to offset box (OBB with offset shell)
 * Handles rotated boxes by transforming into local space.
 * @param {Array} p - Point [x, y, z]
 * @param {Array} center - Box center [x, y, z]
 * @param {Array} halfExtents - Half-extents [hx, hy, hz]
 * @param {Array} rotation - Quaternion [x, y, z, w] (identity = [0,0,0,1])
 * @param {number} r - Contact offset radius (particle radius added by caller)
 * @returns {{distance: number, normal: Array}}
 */
export function distanceToOffsetBox(p, center, halfExtents, rotation, r) {
    const res = _boxResult;
    const hx = halfExtents[0], hy = halfExtents[1], hz = halfExtents[2];
    
    // Translate point relative to box center
    let lx = p[0] - center[0];
    let ly = p[1] - center[1];
    let lz = p[2] - center[2];
    
    // Rotate point into box local space (inverse quaternion = conjugate for unit quat)
    const qx = rotation[0], qy = rotation[1], qz = rotation[2], qw = rotation[3];
    // Inverse rotation: q* = [-x, -y, -z, w]
    // v' = q* * v * q  (but for inverse rotation of a vector, use q_conj * v * q)
    // Optimized quaternion-vector rotation: v' = v + 2*w*(w×v) + 2*(q×(q×v))
    // For conjugate: negate q xyz
    const nqx = -qx, nqy = -qy, nqz = -qz;
    // t = 2 * cross(nq, v)
    const tx = 2 * (nqy * lz - nqz * ly);
    const ty = 2 * (nqz * lx - nqx * lz);
    const tz = 2 * (nqx * ly - nqy * lx);
    // v' = v + w*t + cross(nq, t)
    lx = lx + qw * tx + (nqy * tz - nqz * ty);
    ly = ly + qw * ty + (nqz * tx - nqx * tz);
    lz = lz + qw * tz + (nqx * ty - nqy * tx);
    
    // Signed distance to AABB in local space
    // For each axis: distance outside = max(0, |local| - halfExtent)
    // Signed distance: positive outside, negative inside
    const dx = Math.abs(lx) - hx;
    const dy = Math.abs(ly) - hy;
    const dz = Math.abs(lz) - hz;
    
    // Outside distance (clamped to 0 for axes that are inside)
    const oxd = Math.max(dx, 0);
    const oyd = Math.max(dy, 0);
    const ozd = Math.max(dz, 0);
    const outsideDist = Math.sqrt(oxd * oxd + oyd * oyd + ozd * ozd);
    
    // Inside distance (negative, max of the three axis distances)
    const insideDist = Math.min(Math.max(dx, dy, dz), 0);
    
    const signedDist = outsideDist + insideDist;
    
    // Compute normal in local space
    let nx, ny, nz;
    if (outsideDist > MIN_DISTANCE) {
        // Outside: normal points from closest surface point to particle
        nx = oxd > 0 ? (lx > 0 ? oxd : -oxd) : 0;
        ny = oyd > 0 ? (ly > 0 ? oyd : -oyd) : 0;
        nz = ozd > 0 ? (lz > 0 ? ozd : -ozd) : 0;
        const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (nLen > MIN_DISTANCE) {
            const inv = 1 / nLen;
            nx *= inv; ny *= inv; nz *= inv;
        } else {
            nx = 0; ny = 1; nz = 0;
        }
    } else {
        // Inside: normal points along the axis of least penetration
        if (dx >= dy && dx >= dz) {
            nx = lx > 0 ? 1 : -1; ny = 0; nz = 0;
        } else if (dy >= dx && dy >= dz) {
            nx = 0; ny = ly > 0 ? 1 : -1; nz = 0;
        } else {
            nx = 0; ny = 0; nz = lz > 0 ? 1 : -1;
        }
    }
    
    // Rotate normal back to world space (forward rotation with original quaternion)
    const t2x = 2 * (qy * nz - qz * ny);
    const t2y = 2 * (qz * nx - qx * nz);
    const t2z = 2 * (qx * ny - qy * nx);
    res.normal[0] = nx + qw * t2x + (qy * t2z - qz * t2y);
    res.normal[1] = ny + qw * t2y + (qz * t2x - qx * t2z);
    res.normal[2] = nz + qw * t2z + (qx * t2y - qy * t2x);
    
    res.distance = signedDist - r;
    return res;
}

// ============================================================================
// ANALYTIC SDF EVALUATOR (CPU) — for PBD rope-entity collision
// Evaluates signed distance + normal in LOCAL space (unit scale).
// Supports all spawnable sdfShape types.
// ============================================================================

const _sdfResult = { distance: 0, normal: [0, 1, 0] };

/**
 * Evaluate an analytic SDF in local space (no transform — caller handles that).
 * @param {string} shape - SDF shape type ('box','sphere','capsule','cylinder','torus')
 * @param {Array} params - Shape parameters [p0, p1, p2, p3]
 * @param {number} lx - Local-space X
 * @param {number} ly - Local-space Y
 * @param {number} lz - Local-space Z
 * @returns {{distance: number, normal: Array}} Signed distance and outward normal
 */
export function evaluateAnalyticSDF(shape, params, lx, ly, lz) {
    const res = _sdfResult;
    let dist, nx, ny, nz;
    
    switch (shape) {
        case 'box': {
            const hx = params[0], hy = params[1], hz = params[2];
            const dx = Math.abs(lx) - hx;
            const dy = Math.abs(ly) - hy;
            const dz = Math.abs(lz) - hz;
            const ox = Math.max(dx, 0), oy = Math.max(dy, 0), oz = Math.max(dz, 0);
            const outsideDist = Math.sqrt(ox * ox + oy * oy + oz * oz);
            const insideDist = Math.min(Math.max(dx, dy, dz), 0);
            dist = outsideDist + insideDist;
            if (outsideDist > MIN_DISTANCE) {
                const cnx = ox > 0 ? (lx > 0 ? ox : -ox) : 0;
                const cny = oy > 0 ? (ly > 0 ? oy : -oy) : 0;
                const cnz = oz > 0 ? (lz > 0 ? oz : -oz) : 0;
                const nLen = Math.sqrt(cnx * cnx + cny * cny + cnz * cnz);
                if (nLen > MIN_DISTANCE) { nx = cnx / nLen; ny = cny / nLen; nz = cnz / nLen; }
                else { nx = 0; ny = 1; nz = 0; }
            } else {
                if (dx >= dy && dx >= dz) { nx = lx > 0 ? 1 : -1; ny = 0; nz = 0; }
                else if (dy >= dx && dy >= dz) { nx = 0; ny = ly > 0 ? 1 : -1; nz = 0; }
                else { nx = 0; ny = 0; nz = lz > 0 ? 1 : -1; }
            }
            break;
        }
        case 'sphere': {
            const r = params[0];
            const d = Math.sqrt(lx * lx + ly * ly + lz * lz);
            dist = d - r;
            if (d > MIN_DISTANCE) { nx = lx / d; ny = ly / d; nz = lz / d; }
            else { nx = 0; ny = 1; nz = 0; }
            break;
        }
        case 'capsule': {
            // Y-axis capsule: params = [radius, cylinderHalfHeight]
            const r = params[0], halfH = params[1];
            const cy = Math.max(-halfH, Math.min(halfH, ly));
            const dx = lx, dy = ly - cy, dz = lz;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            dist = d - r;
            if (d > MIN_DISTANCE) { nx = dx / d; ny = dy / d; nz = dz / d; }
            else { nx = 0; ny = 1; nz = 0; }
            break;
        }
        case 'cylinder': {
            // Y-axis cylinder: params = [radius, halfHeight]
            const r = params[0], halfH = params[1];
            const radial = Math.sqrt(lx * lx + lz * lz);
            const dR = radial - r;
            const dY = Math.abs(ly) - halfH;
            if (dR > 0 && dY > 0) {
                dist = Math.sqrt(dR * dR + dY * dY);
                // Corner: blend radial and vertical normals
                const nLen = dist;
                const rNx = radial > MIN_DISTANCE ? lx / radial : 0;
                const rNz = radial > MIN_DISTANCE ? lz / radial : 0;
                nx = (dR * rNx) / nLen;
                ny = (dY * (ly > 0 ? 1 : -1)) / nLen;
                nz = (dR * rNz) / nLen;
            } else if (dR > dY) {
                dist = dR;
                if (radial > MIN_DISTANCE) { nx = lx / radial; ny = 0; nz = lz / radial; }
                else { nx = 1; ny = 0; nz = 0; }
            } else {
                dist = dY;
                nx = 0; ny = ly > 0 ? 1 : -1; nz = 0;
            }
            break;
        }
        case 'torus': {
            // XZ-plane torus: params = [majorRadius, minorRadius]
            const R = params[0], r = params[1];
            const radialXZ = Math.sqrt(lx * lx + lz * lz);
            const qx = radialXZ - R;
            const qDist = Math.sqrt(qx * qx + ly * ly);
            dist = qDist - r;
            if (qDist > MIN_DISTANCE) {
                // Gradient of torus SDF
                const torusNx = qx / qDist;
                const torusNy = ly / qDist;
                // Project radial component back to XZ plane
                if (radialXZ > MIN_DISTANCE) {
                    nx = torusNx * (lx / radialXZ);
                    ny = torusNy;
                    nz = torusNx * (lz / radialXZ);
                } else {
                    nx = torusNx; ny = torusNy; nz = 0;
                }
            } else {
                nx = 0; ny = 1; nz = 0;
            }
            break;
        }
        default: {
            // Fallback: treat as bounding box using params as halfExtents
            // Complex shapes (gear, helix, arch, etc.) use this path
            const hx = params[0] || 0.5, hy = params[1] || 0.5, hz = params[2] || 0.5;
            const dx2 = Math.abs(lx) - hx;
            const dy2 = Math.abs(ly) - hy;
            const dz2 = Math.abs(lz) - hz;
            const ox2 = Math.max(dx2, 0), oy2 = Math.max(dy2, 0), oz2 = Math.max(dz2, 0);
            dist = Math.sqrt(ox2 * ox2 + oy2 * oy2 + oz2 * oz2) + Math.min(Math.max(dx2, dy2, dz2), 0);
            if (dx2 >= dy2 && dx2 >= dz2) { nx = lx > 0 ? 1 : -1; ny = 0; nz = 0; }
            else if (dy2 >= dx2 && dy2 >= dz2) { nx = 0; ny = ly > 0 ? 1 : -1; nz = 0; }
            else { nx = 0; ny = 0; nz = lz > 0 ? 1 : -1; }
            break;
        }
    }
    
    res.distance = dist;
    res.normal[0] = nx; res.normal[1] = ny; res.normal[2] = nz;
    return res;
}

/**
 * Distance from point to offset edge (line segment with offset radius)
 * @param {Array} p - Point [x, y, z]
 * @param {Array} a - Edge start [x, y, z]
 * @param {Array} b - Edge end [x, y, z]
 * @param {number} r - Contact offset radius
 * @returns {{distance: number, normal: Array, t: number}}
 */
export function distanceToOffsetEdge(p, a, b, r) {
    return distanceToOffsetCapsule(p, a, b, 0, r);
}

/**
 * Distance from point to offset triangle (triangle with offset shell)
 * Uses the face normal for orthogonal contact
 * @param {Array} p - Point [x, y, z]
 * @param {Array} v0 - Triangle vertex 0
 * @param {Array} v1 - Triangle vertex 1
 * @param {Array} v2 - Triangle vertex 2
 * @param {number} r - Contact offset radius
 * @returns {{distance: number, normal: Array, type: string}}
 */
export function distanceToOffsetTriangle(p, v0, v1, v2, r) {
    // Compute triangle edges
    const e0 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
    const e1 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
    
    // Face normal (cross product)
    const nx = e0[1] * e1[2] - e0[2] * e1[1];
    const ny = e0[2] * e1[0] - e0[0] * e1[2];
    const nz = e0[0] * e1[1] - e0[1] * e1[0];
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    
    if (nLen < MIN_DISTANCE) {
        // Degenerate triangle
        return { distance: Infinity, normal: [0, 1, 0], type: 'degenerate' };
    }
    
    const invNLen = 1 / nLen;
    const normal = [nx * invNLen, ny * invNLen, nz * invNLen];
    
    // Distance to plane
    const d0 = [p[0] - v0[0], p[1] - v0[1], p[2] - v0[2]];
    const planeDist = d0[0] * normal[0] + d0[1] * normal[1] + d0[2] * normal[2];
    
    // Project point onto plane
    const projX = p[0] - planeDist * normal[0];
    const projY = p[1] - planeDist * normal[1];
    const projZ = p[2] - planeDist * normal[2];
    
    // Check if projection is inside triangle using barycentric coords
    const dot00 = e0[0] * e0[0] + e0[1] * e0[1] + e0[2] * e0[2];
    const dot01 = e0[0] * e1[0] + e0[1] * e1[1] + e0[2] * e1[2];
    const dot11 = e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2];
    
    const dp = [projX - v0[0], projY - v0[1], projZ - v0[2]];
    const dot0p = e0[0] * dp[0] + e0[1] * dp[1] + e0[2] * dp[2];
    const dot1p = e1[0] * dp[0] + e1[1] * dp[1] + e1[2] * dp[2];
    
    const denom = dot00 * dot11 - dot01 * dot01;
    if (Math.abs(denom) < MIN_DISTANCE) {
        return { distance: Infinity, normal, type: 'degenerate' };
    }
    
    const invDenom = 1 / denom;
    const u = (dot11 * dot0p - dot01 * dot1p) * invDenom;
    const v = (dot00 * dot1p - dot01 * dot0p) * invDenom;
    
    // Inside triangle - use face normal (orthogonal contact)
    if (u >= 0 && v >= 0 && u + v <= 1) {
        const signedDist = planeDist;
        const absD = Math.abs(signedDist);
        const contactNormal = signedDist >= 0 ? normal : [-normal[0], -normal[1], -normal[2]];
        return {
            distance: absD - r,
            normal: contactNormal,
            type: 'face',
        };
    }
    
    // Outside triangle - find closest feature (edge or vertex)
    let minDist = Infinity;
    let closestNormal = normal;
    let closestType = 'edge';
    
    // Check edges
    const edges = [[v0, v1], [v1, v2], [v2, v0]];
    for (const [ea, eb] of edges) {
        const edgeResult = distanceToOffsetEdge(p, ea, eb, r);
        if (edgeResult.distance < minDist) {
            minDist = edgeResult.distance;
            closestNormal = edgeResult.normal;
            closestType = 'edge';
        }
    }
    
    // Check vertices
    const vertices = [v0, v1, v2];
    for (const vert of vertices) {
        const result = distanceToOffsetSphere(p, vert, 0, r);
        if (result.distance < minDist) {
            minDist = result.distance;
            closestNormal = result.normal;
            closestType = 'vertex';
        }
    }
    
    return { distance: minDist, normal: closestNormal, type: closestType };
}

// ============================================================================
// OGC CONTACT SOLVER (CPU)
// ============================================================================

/**
 * Apply OGC barrier force to a particle
 * @param {Object} particle - Particle with position, velocity, invMass
 * @param {number} distance - Distance to offset surface
 * @param {Array} normal - Contact normal
 * @param {number} contactRadius - Contact radius r
 * @param {number} stiffness - Barrier stiffness
 * @param {number} dt - Time step
 */
export function applyOGCForce(particle, distance, normal, contactRadius, stiffness, dt) {
    if (particle.invMass <= 0) return;
    
    const r = contactRadius;
    const activationDist = 2 * r;
    
    if (distance >= activationDist) return;
    
    // Barrier force magnitude
    const forceMag = -barrierForce(distance, r) * stiffness;
    
    // Apply force along normal (orthogonal to surface)
    const impulse = forceMag * dt * particle.invMass;
    
    particle.velocity[0] += normal[0] * impulse;
    particle.velocity[1] += normal[1] * impulse;
    particle.velocity[2] += normal[2] * impulse;
}

/**
 * Apply OGC position correction (for PBD-style solvers)
 * @param {Object} particle - Particle with position, invMass
 * @param {number} distance - Distance to offset surface
 * @param {Array} normal - Contact normal
 * @param {number} contactRadius - Contact radius r
 * @param {number} compliance - XPBD compliance (0 = stiff)
 * @param {number} dt - Time step
 * @returns {number} Constraint violation for convergence check
 */
export function applyOGCPositionCorrection(particle, distance, normal, contactRadius, compliance, dt) {
    if (particle.invMass <= 0) return 0;
    
    const r = contactRadius;
    
    // Only correct if penetrating offset surface
    if (distance >= 0) return 0;
    
    // Push out to surface
    const correction = -distance;
    const effectiveMass = particle.invMass;
    const alpha = compliance / (dt * dt);
    const deltaLambda = correction / (effectiveMass + alpha);
    
    particle.position[0] += normal[0] * deltaLambda * effectiveMass;
    particle.position[1] += normal[1] * deltaLambda * effectiveMass;
    particle.position[2] += normal[2] * deltaLambda * effectiveMass;
    
    return Math.abs(distance);
}

// ============================================================================
// OGC CONTACT MANAGER
// ============================================================================

/**
 * Manages OGC contacts for a simulation
 */
export class OGCContactManager {
    constructor(options = {}) {
        this.contactRadius = options.contactRadius ?? DEFAULT_CONTACT_RADIUS;
        this.stiffness = options.stiffness ?? 10000;
        this.compliance = options.compliance ?? 0;
        this.iterations = options.iterations ?? 4;
        
        // Collider storage
        this.spheres = [];
        this.planes = [];
        this.capsules = [];
        this.triangles = [];
        
        // Statistics
        this.stats = {
            activeContacts: 0,
            maxPenetration: 0,
            barrierEnergy: 0,
        };
    }
    
    /**
     * Clear all colliders
     */
    clear() {
        this.spheres.length = 0;
        this.planes.length = 0;
        this.capsules.length = 0;
        this.triangles.length = 0;
    }
    
    /**
     * Add a sphere collider
     */
    addSphere(center, radius) {
        this.spheres.push({ center: [...center], radius });
    }
    
    /**
     * Add a plane collider
     */
    addPlane(point, normal) {
        const len = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2);
        this.planes.push({
            point: [...point],
            normal: [normal[0] / len, normal[1] / len, normal[2] / len],
        });
    }
    
    /**
     * Add a capsule collider
     */
    addCapsule(a, b, radius) {
        this.capsules.push({ a: [...a], b: [...b], radius });
    }
    
    /**
     * Add a ground plane at y=0
     */
    addGroundPlane(y = 0) {
        this.addPlane([0, y, 0], [0, 1, 0]);
    }
    
    /**
     * Find closest contact for a point
     * @param {Array} point - Point [x, y, z]
     * @returns {{distance: number, normal: Array, type: string}|null}
     */
    findClosestContact(point) {
        let minDist = Infinity;
        let closestNormal = null;
        let closestType = null;
        
        const r = this.contactRadius;
        
        // Check spheres
        for (const sphere of this.spheres) {
            const result = distanceToOffsetSphere(point, sphere.center, sphere.radius, r);
            if (result.distance < minDist) {
                minDist = result.distance;
                closestNormal = result.normal;
                closestType = 'sphere';
            }
        }
        
        // Check planes
        for (const plane of this.planes) {
            const result = distanceToOffsetPlane(point, plane.point, plane.normal, r);
            if (result.distance < minDist) {
                minDist = result.distance;
                closestNormal = result.normal;
                closestType = 'plane';
            }
        }
        
        // Check capsules
        for (const capsule of this.capsules) {
            const result = distanceToOffsetCapsule(point, capsule.a, capsule.b, capsule.radius, r);
            if (result.distance < minDist) {
                minDist = result.distance;
                closestNormal = result.normal;
                closestType = 'capsule';
            }
        }
        
        if (closestNormal === null) return null;
        
        return { distance: minDist, normal: closestNormal, type: closestType };
    }
    
    /**
     * Solve contacts for an array of particles (PBD style)
     * @param {Array} particles - Array of {position, velocity, invMass}
     * @param {number} dt - Time step
     */
    solveContacts(particles, dt) {
        this.stats.activeContacts = 0;
        this.stats.maxPenetration = 0;
        this.stats.barrierEnergy = 0;
        
        const r = this.contactRadius;
        const activationDist = 2 * r;
        
        for (let iter = 0; iter < this.iterations; iter++) {
            for (const particle of particles) {
                if (particle.invMass <= 0) continue;
                
                const contact = this.findClosestContact(particle.position);
                if (!contact) continue;
                
                if (contact.distance < activationDist) {
                    this.stats.activeContacts++;
                    
                    if (contact.distance < 0) {
                        this.stats.maxPenetration = Math.max(
                            this.stats.maxPenetration,
                            -contact.distance
                        );
                    }
                    
                    // Apply position correction
                    applyOGCPositionCorrection(
                        particle,
                        contact.distance,
                        contact.normal,
                        r,
                        this.compliance,
                        dt
                    );
                    
                    // Apply barrier force
                    applyOGCForce(
                        particle,
                        contact.distance,
                        contact.normal,
                        r,
                        this.stiffness,
                        dt / this.iterations
                    );
                    
                    this.stats.barrierEnergy += barrierEnergy(contact.distance, r);
                }
            }
        }
    }
}

// ============================================================================
// WGSL SHADER SNIPPETS FOR GPU IMPLEMENTATION
// ============================================================================

/**
 * WGSL snippet for OGC barrier functions
 */
export const OGC_BARRIER_WGSL = /* wgsl */`
// OGC Barrier energy: g(d) = d²(2r - d)²
fn ogcBarrierEnergy(d: f32, r: f32) -> f32 {
    if (d <= 0.0 || d >= 2.0 * r) { return 0.0; }
    let term = 2.0 * r - d;
    return d * d * term * term;
}

// OGC Barrier force: g'(d) = 2d(2r-d)(2r-2d)
fn ogcBarrierForce(d: f32, r: f32) -> f32 {
    if (d <= 0.0 || d >= 2.0 * r) { return 0.0; }
    let term1 = 2.0 * r - d;
    let term2 = 2.0 * r - 2.0 * d;
    return 2.0 * d * term1 * term2;
}

// Conservative displacement bound
fn ogcConservativeBound(currentDist: f32, r: f32) -> f32 {
    let activationDist = 2.0 * r;
    if (currentDist >= activationDist) {
        return (currentDist - activationDist) * 0.5;
    }
    return max(0.0, currentDist * 0.25);
}
`;

/**
 * WGSL snippet for offset geometry distance functions
 */
export const OGC_DISTANCE_WGSL = /* wgsl */`
const OGC_MIN_DIST: f32 = 1e-8;

// Distance to offset sphere
fn distToOffsetSphere(p: vec3<f32>, center: vec3<f32>, radius: f32, r: f32) -> vec4<f32> {
    let delta = p - center;
    let dist = length(delta);
    if (dist < OGC_MIN_DIST) {
        return vec4<f32>(0.0, 1.0, 0.0, radius + r);
    }
    let normal = delta / dist;
    return vec4<f32>(normal, dist - (radius + r));
}

// Distance to offset plane
fn distToOffsetPlane(p: vec3<f32>, planePoint: vec3<f32>, planeNormal: vec3<f32>, r: f32) -> vec4<f32> {
    let dist = dot(p - planePoint, planeNormal);
    return vec4<f32>(planeNormal, dist - r);
}

// Distance to offset capsule
fn distToOffsetCapsule(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, radius: f32, r: f32) -> vec4<f32> {
    let ab = b - a;
    let ap = p - a;
    let abLen2 = dot(ab, ab);
    
    var t = 0.0;
    if (abLen2 > OGC_MIN_DIST) {
        t = clamp(dot(ap, ab) / abLen2, 0.0, 1.0);
    }
    
    let closest = a + t * ab;
    let delta = p - closest;
    let dist = length(delta);
    
    if (dist < OGC_MIN_DIST) {
        return vec4<f32>(0.0, 1.0, 0.0, radius + r);
    }
    
    let normal = delta / dist;
    return vec4<f32>(normal, dist - (radius + r));
}
`;

/**
 * WGSL snippet for OGC contact solving
 */
export const OGC_SOLVE_WGSL = /* wgsl */`
// Apply OGC position correction
fn ogcPositionCorrection(
    pos: vec3<f32>,
    dist: f32,
    normal: vec3<f32>,
    r: f32,
    invMass: f32
) -> vec3<f32> {
    if (invMass <= 0.0 || dist >= 0.0) {
        return pos;
    }
    // Push out to surface
    let correction = -dist;
    return pos + normal * correction;
}

// Apply OGC barrier velocity correction
fn ogcVelocityCorrection(
    vel: vec3<f32>,
    dist: f32,
    normal: vec3<f32>,
    r: f32,
    stiffness: f32,
    dt: f32,
    invMass: f32
) -> vec3<f32> {
    if (invMass <= 0.0) { return vel; }
    
    let activationDist = 2.0 * r;
    if (dist >= activationDist) { return vel; }
    
    let forceMag = -ogcBarrierForce(dist, r) * stiffness;
    let impulse = forceMag * dt * invMass;
    
    return vel + normal * impulse;
}
`;

/**
 * Complete WGSL module for OGC
 */
export const OGC_WGSL_MODULE = OGC_BARRIER_WGSL + OGC_DISTANCE_WGSL + OGC_SOLVE_WGSL;

// ============================================================================
// EXPORTS
// ============================================================================

export default {
    DEFAULT_CONTACT_RADIUS,
    BARRIER_ACTIVATION_RATIO,
    barrierEnergy,
    barrierForce,
    normalizedBarrierEnergy,
    conservativeDisplacementBound,
    distanceToOffsetSphere,
    distanceToOffsetPlane,
    distanceToOffsetCapsule,
    distanceToOffsetEdge,
    distanceToOffsetTriangle,
    applyOGCForce,
    applyOGCPositionCorrection,
    OGCContactManager,
    OGC_WGSL_MODULE,
};
