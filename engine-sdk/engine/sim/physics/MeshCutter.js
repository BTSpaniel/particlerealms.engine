/**
 * MeshCutter.js - Mesh Cutting and Fragment Generation System
 * 
 * Cuts meshes along Voronoi cell boundaries to create realistic fragments.
 * Uses plane-triangle intersection to split geometry.
 * 
 * Features:
 * - Triangle classification (front/back/spanning)
 * - Edge-plane intersection computation
 * - Cap geometry generation for cut faces
 * - UV coordinate preservation
 * - Convex hull generation for PhysX
 */

// ============================================================================
// MATH UTILITIES
// ============================================================================

const EPSILON = 1e-6;

/** Dot product of two vec3 */
function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Cross product of two vec3 */
function cross(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}

/** Subtract two vec3 */
function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Add two vec3 */
function add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** Scale vec3 by scalar */
function scale(v, s) {
    return [v[0] * s, v[1] * s, v[2] * s];
}

/** Normalize vec3 */
function normalize(v) {
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (len < EPSILON) return [0, 0, 0];
    return [v[0] / len, v[1] / len, v[2] / len];
}

/** Length of vec3 */
function length(v) {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/** Lerp between two vec3 */
function lerp(a, b, t) {
    return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ];
}

// ============================================================================
// PLANE CLASS
// ============================================================================

export class Plane {
    constructor(normal, distance) {
        this.normal = normalize(normal);
        this.distance = distance;
    }
    
    /** Create plane from point and normal */
    static fromPointNormal(point, normal) {
        const n = normalize(normal);
        const d = -dot(n, point);
        return new Plane(n, d);
    }
    
    /** Create plane from three points */
    static fromPoints(p1, p2, p3) {
        const v1 = sub(p2, p1);
        const v2 = sub(p3, p1);
        const normal = normalize(cross(v1, v2));
        const distance = -dot(normal, p1);
        return new Plane(normal, distance);
    }
    
    /** Signed distance from point to plane */
    distanceToPoint(point) {
        return dot(this.normal, point) + this.distance;
    }
    
    /** Classify point relative to plane */
    classifyPoint(point) {
        const d = this.distanceToPoint(point);
        if (d > EPSILON) return 1;   // Front
        if (d < -EPSILON) return -1; // Back
        return 0;                     // On plane
    }
    
    /** Get intersection point of line segment with plane */
    intersectSegment(p1, p2) {
        const d1 = this.distanceToPoint(p1);
        const d2 = this.distanceToPoint(p2);
        
        if (Math.abs(d1 - d2) < EPSILON) {
            return null; // Parallel
        }
        
        const t = d1 / (d1 - d2);
        if (t < 0 || t > 1) {
            return null; // Intersection outside segment
        }
        
        return lerp(p1, p2, t);
    }
}

// ============================================================================
// VERTEX CLASS
// ============================================================================

export class Vertex {
    constructor(position, normal = [0, 1, 0], uv = [0, 0], color = [1, 1, 1, 1]) {
        this.position = position;
        this.normal = normal;
        this.uv = uv;
        this.color = color;
    }
    
    /** Interpolate between two vertices */
    static lerp(v1, v2, t) {
        return new Vertex(
            lerp(v1.position, v2.position, t),
            normalize(lerp(v1.normal, v2.normal, t)),
            [v1.uv[0] + (v2.uv[0] - v1.uv[0]) * t, v1.uv[1] + (v2.uv[1] - v1.uv[1]) * t],
            [
                v1.color[0] + (v2.color[0] - v1.color[0]) * t,
                v1.color[1] + (v2.color[1] - v1.color[1]) * t,
                v1.color[2] + (v2.color[2] - v1.color[2]) * t,
                v1.color[3] + (v2.color[3] - v1.color[3]) * t,
            ]
        );
    }
    
    clone() {
        return new Vertex(
            [...this.position],
            [...this.normal],
            [...this.uv],
            [...this.color]
        );
    }
}

// ============================================================================
// TRIANGLE CLASS
// ============================================================================

export class Triangle {
    constructor(v0, v1, v2) {
        this.vertices = [v0, v1, v2];
    }
    
    /** Get triangle normal */
    getNormal() {
        const v1 = sub(this.vertices[1].position, this.vertices[0].position);
        const v2 = sub(this.vertices[2].position, this.vertices[0].position);
        return normalize(cross(v1, v2));
    }
    
    /** Get triangle centroid */
    getCentroid() {
        const p0 = this.vertices[0].position;
        const p1 = this.vertices[1].position;
        const p2 = this.vertices[2].position;
        return [
            (p0[0] + p1[0] + p2[0]) / 3,
            (p0[1] + p1[1] + p2[1]) / 3,
            (p0[2] + p1[2] + p2[2]) / 3,
        ];
    }
    
    /** Classify triangle vs plane */
    classify(plane) {
        let front = 0, back = 0, on = 0;
        
        for (const v of this.vertices) {
            const side = plane.classifyPoint(v.position);
            if (side > 0) front++;
            else if (side < 0) back++;
            else on++;
        }
        
        if (front > 0 && back === 0) return 'front';
        if (back > 0 && front === 0) return 'back';
        if (front === 0 && back === 0) return 'coplanar';
        return 'spanning';
    }
    
    /** Split triangle by plane, returns { front: [], back: [] } */
    split(plane) {
        const front = [];
        const back = [];
        
        const sides = this.vertices.map(v => plane.classifyPoint(v.position));
        
        // Quick check for non-spanning cases
        if (!sides.includes(1) || !sides.includes(-1)) {
            if (sides.every(s => s >= 0)) {
                return { front: [this], back: [] };
            } else {
                return { front: [], back: [this] };
            }
        }
        
        // Split spanning triangle
        const frontVerts = [];
        const backVerts = [];
        
        for (let i = 0; i < 3; i++) {
            const v0 = this.vertices[i];
            const v1 = this.vertices[(i + 1) % 3];
            const s0 = sides[i];
            const s1 = sides[(i + 1) % 3];
            
            if (s0 >= 0) frontVerts.push(v0.clone());
            if (s0 <= 0) backVerts.push(v0.clone());
            
            // Check if edge crosses plane
            if ((s0 > 0 && s1 < 0) || (s0 < 0 && s1 > 0)) {
                const d0 = plane.distanceToPoint(v0.position);
                const d1 = plane.distanceToPoint(v1.position);
                const t = d0 / (d0 - d1);
                const intersection = Vertex.lerp(v0, v1, t);
                
                frontVerts.push(intersection.clone());
                backVerts.push(intersection.clone());
            }
        }
        
        // Triangulate the resulting polygons
        this._triangulate(frontVerts, front);
        this._triangulate(backVerts, back);
        
        return { front, back };
    }
    
    /** Triangulate a convex polygon */
    _triangulate(verts, output) {
        if (verts.length < 3) return;
        
        for (let i = 1; i < verts.length - 1; i++) {
            output.push(new Triangle(verts[0], verts[i], verts[i + 1]));
        }
    }
}

// ============================================================================
// MESH FRAGMENT CLASS
// ============================================================================

export class MeshFragment {
    constructor(cellId = -1) {
        this.cellId = cellId;
        this.triangles = [];
        this.capTriangles = [];  // Triangles on cut surfaces
        this.bounds = null;
        this.centroid = null;
        this.volume = 0;
        this.convexHull = null;  // For PhysX
    }
    
    /** Add triangle to fragment */
    addTriangle(triangle) {
        this.triangles.push(triangle);
    }
    
    /** Add cap triangle (cut surface) */
    addCapTriangle(triangle) {
        this.capTriangles.push(triangle);
    }
    
    /** Compute bounding box */
    computeBounds() {
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        
        for (const tri of [...this.triangles, ...this.capTriangles]) {
            for (const v of tri.vertices) {
                const p = v.position;
                min[0] = Math.min(min[0], p[0]);
                min[1] = Math.min(min[1], p[1]);
                min[2] = Math.min(min[2], p[2]);
                max[0] = Math.max(max[0], p[0]);
                max[1] = Math.max(max[1], p[1]);
                max[2] = Math.max(max[2], p[2]);
            }
        }
        
        this.bounds = { min, max };
        return this.bounds;
    }
    
    /** Compute centroid */
    computeCentroid() {
        let cx = 0, cy = 0, cz = 0, count = 0;
        
        for (const tri of [...this.triangles, ...this.capTriangles]) {
            const c = tri.getCentroid();
            cx += c[0];
            cy += c[1];
            cz += c[2];
            count++;
        }
        
        if (count > 0) {
            this.centroid = [cx / count, cy / count, cz / count];
        } else {
            this.centroid = [0, 0, 0];
        }
        
        return this.centroid;
    }
    
    /** Estimate volume using bounding box */
    computeVolume() {
        if (!this.bounds) this.computeBounds();
        const b = this.bounds;
        this.volume = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
        return this.volume;
    }
    
    /** Generate convex hull points for PhysX */
    computeConvexHull() {
        const points = [];
        
        for (const tri of [...this.triangles, ...this.capTriangles]) {
            for (const v of tri.vertices) {
                points.push([...v.position]);
            }
        }
        
        // Simple approach: use unique vertices
        // A proper implementation would use QuickHull algorithm
        const unique = [];
        const seen = new Set();
        
        for (const p of points) {
            const key = `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(p);
            }
        }
        
        this.convexHull = unique;
        return this.convexHull;
    }
    
    /** Convert to GPU-ready vertex/index arrays */
    toArrays() {
        const vertices = [];
        const indices = [];
        let vertexIndex = 0;
        
        for (const tri of [...this.triangles, ...this.capTriangles]) {
            for (const v of tri.vertices) {
                vertices.push(
                    v.position[0], v.position[1], v.position[2],
                    v.normal[0], v.normal[1], v.normal[2],
                    v.color[0], v.color[1], v.color[2], v.color[3]
                );
            }
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
            vertexIndex += 3;
        }
        
        return {
            vertices: new Float32Array(vertices),
            indices: new Uint32Array(indices),
            vertexCount: vertexIndex,
            indexCount: indices.length,
        };
    }
}

// ============================================================================
// MESH CUTTER CLASS
// ============================================================================

export class MeshCutter {
    constructor() {
        this.capColor = [0.3, 0.3, 0.35, 1.0];  // Color for cut surfaces
    }
    
    /**
     * Cut a mesh by a single plane
     * @param {Triangle[]} triangles - Input triangles
     * @param {Plane} plane - Cutting plane
     * @param {boolean} generateCaps - Whether to generate cap geometry
     * @returns {{ front: MeshFragment, back: MeshFragment }}
     */
    cutByPlane(triangles, plane, generateCaps = true) {
        const front = new MeshFragment();
        const back = new MeshFragment();
        const capEdges = [];  // For cap generation
        
        for (const tri of triangles) {
            const classification = tri.classify(plane);
            
            switch (classification) {
                case 'front':
                    front.addTriangle(tri);
                    break;
                    
                case 'back':
                    back.addTriangle(tri);
                    break;
                    
                case 'coplanar':
                    // Add to front by convention
                    front.addTriangle(tri);
                    break;
                    
                case 'spanning':
                    const result = tri.split(plane);
                    for (const t of result.front) front.addTriangle(t);
                    for (const t of result.back) back.addTriangle(t);
                    
                    // Collect cap edges
                    if (generateCaps) {
                        this._collectCapEdges(tri, plane, capEdges);
                    }
                    break;
            }
        }
        
        // Generate cap geometry
        if (generateCaps && capEdges.length >= 3) {
            this._generateCaps(capEdges, plane, front, back);
        }
        
        // Compute properties
        front.computeBounds();
        front.computeCentroid();
        back.computeBounds();
        back.computeCentroid();
        
        return { front, back };
    }
    
    /**
     * Cut mesh by multiple planes (from Voronoi boundaries)
     * @param {Triangle[]} triangles - Input triangles
     * @param {Plane[]} planes - Cutting planes
     * @returns {MeshFragment[]} Array of fragments
     */
    cutByPlanes(triangles, planes) {
        if (planes.length === 0) {
            const fragment = new MeshFragment(0);
            for (const t of triangles) fragment.addTriangle(t);
            fragment.computeBounds();
            fragment.computeCentroid();
            return [fragment];
        }
        
        // Use BSP-style recursive cutting
        let fragments = [triangles];
        
        for (let i = 0; i < planes.length; i++) {
            const plane = planes[i];
            const newFragments = [];
            
            for (const tris of fragments) {
                if (tris.length === 0) continue;
                
                const { front, back } = this.cutByPlane(tris, plane, true);
                
                if (front.triangles.length > 0 || front.capTriangles.length > 0) {
                    newFragments.push([...front.triangles, ...front.capTriangles]);
                }
                if (back.triangles.length > 0 || back.capTriangles.length > 0) {
                    newFragments.push([...back.triangles, ...back.capTriangles]);
                }
            }
            
            fragments = newFragments;
        }
        
        // Convert to MeshFragment objects
        return fragments.map((tris, idx) => {
            const frag = new MeshFragment(idx);
            for (const t of tris) frag.addTriangle(t);
            frag.computeBounds();
            frag.computeCentroid();
            frag.computeVolume();
            return frag;
        }).filter(f => f.triangles.length > 0);
    }
    
    /**
     * Cut mesh using Voronoi cell assignments (centroid-based, fast but imprecise).
     * Only assigns whole triangles — does NOT split triangles across cell boundaries.
     * Use cutByVoronoiExact for low-poly meshes that need proper clipping.
     * @param {Triangle[]} triangles - Input triangles
     * @param {Function} getCellId - Function(point) returning cell ID
     * @returns {Map<number, MeshFragment>} Map of cell ID to fragment
     */
    cutByVoronoi(triangles, getCellId) {
        const fragments = new Map();
        
        for (const tri of triangles) {
            const centroid = tri.getCentroid();
            const cellId = getCellId(centroid);
            
            if (!fragments.has(cellId)) {
                fragments.set(cellId, new MeshFragment(cellId));
            }
            
            fragments.get(cellId).addTriangle(tri);
        }
        
        // Compute properties for each fragment
        for (const frag of fragments.values()) {
            frag.computeBounds();
            frag.computeCentroid();
            frag.computeVolume();
        }
        
        return fragments;
    }

    /**
     * Cut mesh into exact Voronoi cells using bisecting-plane clipping.
     * For each seed, clips the full mesh against bisecting planes with every
     * other seed, keeping only the region closest to that seed. Properly splits
     * triangles that span cell boundaries and generates cap geometry at cuts.
     *
     * @param {Triangle[]} triangles - Input triangles
     * @param {Array<{id: number, x: number, y: number, z: number}>} seeds - Voronoi seeds
     * @returns {Map<number, MeshFragment>} Map of cell ID to fragment
     */
    cutByVoronoiExact(triangles, seeds) {
        const fragments = new Map();

        for (const seed of seeds) {
            let remaining = [...triangles];

            for (const other of seeds) {
                if (other.id === seed.id || remaining.length === 0) continue;

                // Bisecting plane: midpoint between seeds, normal toward current seed
                const mid = [
                    (seed.x + other.x) * 0.5,
                    (seed.y + other.y) * 0.5,
                    (seed.z + other.z) * 0.5,
                ];
                const n = [
                    seed.x - other.x,
                    seed.y - other.y,
                    seed.z - other.z,
                ];
                const nrm = normalize(n);
                const plane = Plane.fromPointNormal(mid, nrm);

                // Cut and keep the front side (closer to current seed)
                const { front } = this.cutByPlane(remaining, plane, true);
                remaining = [...front.triangles, ...front.capTriangles];
            }

            if (remaining.length > 0) {
                const frag = new MeshFragment(seed.id);
                for (const t of remaining) frag.addTriangle(t);
                frag.computeBounds();
                frag.computeCentroid();
                frag.computeVolume();
                fragments.set(seed.id, frag);
            }
        }

        return fragments;
    }
    
    /** Collect edges that lie on the cutting plane */
    _collectCapEdges(triangle, plane, edges) {
        for (let i = 0; i < 3; i++) {
            const v0 = triangle.vertices[i];
            const v1 = triangle.vertices[(i + 1) % 3];
            const s0 = plane.classifyPoint(v0.position);
            const s1 = plane.classifyPoint(v1.position);
            
            // Edge crosses plane
            if ((s0 > 0 && s1 < 0) || (s0 < 0 && s1 > 0)) {
                const d0 = plane.distanceToPoint(v0.position);
                const d1 = plane.distanceToPoint(v1.position);
                const t = d0 / (d0 - d1);
                const intersection = lerp(v0.position, v1.position, t);
                edges.push(intersection);
            }
        }
    }
    
    /** Generate cap triangles for cut surface */
    _generateCaps(edgePoints, plane, frontFrag, backFrag) {
        if (edgePoints.length < 3) return;
        
        // Compute centroid of cap polygon
        let cx = 0, cy = 0, cz = 0;
        for (const p of edgePoints) {
            cx += p[0]; cy += p[1]; cz += p[2];
        }
        cx /= edgePoints.length;
        cy /= edgePoints.length;
        cz /= edgePoints.length;
        const center = [cx, cy, cz];
        
        // Sort points by angle around centroid
        const normal = plane.normal;
        const tangent = this._getTangent(normal);
        const bitangent = cross(normal, tangent);
        
        const sorted = edgePoints.map(p => {
            const dx = p[0] - cx;
            const dy = p[1] - cy;
            const dz = p[2] - cz;
            const angle = Math.atan2(
                dx * bitangent[0] + dy * bitangent[1] + dz * bitangent[2],
                dx * tangent[0] + dy * tangent[1] + dz * tangent[2]
            );
            return { point: p, angle };
        }).sort((a, b) => a.angle - b.angle);
        
        // Create fan triangulation from center
        for (let i = 0; i < sorted.length; i++) {
            const p0 = center;
            const p1 = sorted[i].point;
            const p2 = sorted[(i + 1) % sorted.length].point;
            
            // Front cap (normal pointing same as plane)
            const frontTri = new Triangle(
                new Vertex(p0, normal, [0.5, 0.5], this.capColor),
                new Vertex(p1, normal, [0, 0], this.capColor),
                new Vertex(p2, normal, [1, 0], this.capColor)
            );
            frontFrag.addCapTriangle(frontTri);
            
            // Back cap (normal pointing opposite)
            const backNormal = scale(normal, -1);
            const backTri = new Triangle(
                new Vertex(p0, backNormal, [0.5, 0.5], this.capColor),
                new Vertex(p2, backNormal, [1, 0], this.capColor),
                new Vertex(p1, backNormal, [0, 0], this.capColor)
            );
            backFrag.addCapTriangle(backTri);
        }
    }
    
    /** Get a tangent vector perpendicular to normal */
    _getTangent(normal) {
        const absX = Math.abs(normal[0]);
        const absY = Math.abs(normal[1]);
        const absZ = Math.abs(normal[2]);
        
        let tangent;
        if (absX <= absY && absX <= absZ) {
            tangent = [1, 0, 0];
        } else if (absY <= absX && absY <= absZ) {
            tangent = [0, 1, 0];
        } else {
            tangent = [0, 0, 1];
        }
        
        // Make orthogonal to normal
        const d = dot(tangent, normal);
        tangent = [
            tangent[0] - d * normal[0],
            tangent[1] - d * normal[1],
            tangent[2] - d * normal[2],
        ];
        
        return normalize(tangent);
    }
}

export default MeshCutter;
