// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MC33 Marching Cubes GPU Compute Shader
// Watertight mesh extraction with asymptotic decider
//
// Based on: Chernyaev (1995), Custodio (2013)
// Target: WebGPU WGSL

// ============================================================================
// UNIFORMS & BINDINGS
// ============================================================================

struct Uniforms {
    gridSize: vec3u,
    isolevel: f32,
    scale: f32,
    originX: f32,
    originY: f32,
    originZ: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> density: array<f32>;
@group(0) @binding(2) var<storage, read_write> vertices: array<f32>;
@group(0) @binding(3) var<storage, read_write> vertexCounter: atomic<u32>;

// Lookup tables stored in storage buffers
@group(1) @binding(0) var<storage, read> edgeTable: array<u32>;
@group(1) @binding(1) var<storage, read> triTable: array<i32>;
@group(1) @binding(2) var<storage, read> mc33Case: array<u32>;

// ============================================================================
// CONSTANTS
// ============================================================================

// Cube corner offsets
const CORNERS: array<vec3u, 8> = array<vec3u, 8>(
    vec3u(0u, 0u, 0u), vec3u(1u, 0u, 0u), vec3u(1u, 1u, 0u), vec3u(0u, 1u, 0u),
    vec3u(0u, 0u, 1u), vec3u(1u, 0u, 1u), vec3u(1u, 1u, 1u), vec3u(0u, 1u, 1u)
);

// Edge connections (which corners each edge connects)
const EDGE_A: array<u32, 12> = array<u32, 12>(0u, 1u, 2u, 3u, 4u, 5u, 6u, 7u, 0u, 1u, 2u, 3u);
const EDGE_B: array<u32, 12> = array<u32, 12>(1u, 2u, 3u, 0u, 5u, 6u, 7u, 4u, 4u, 5u, 6u, 7u);

// Face corner indices (for ambiguity testing)
const FACE_CORNERS: array<vec4u, 6> = array<vec4u, 6>(
    vec4u(0u, 3u, 2u, 1u),  // -Z
    vec4u(4u, 5u, 6u, 7u),  // +Z
    vec4u(0u, 1u, 5u, 4u),  // -Y
    vec4u(2u, 3u, 7u, 6u),  // +Y
    vec4u(0u, 4u, 7u, 3u),  // -X
    vec4u(1u, 2u, 6u, 5u)   // +X
);

// Maximum triangles per cube (MC33 can have up to 5)
const MAX_TRIS_PER_CUBE: u32 = 5u;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Convert 3D grid position to 1D index
fn gridIndex(pos: vec3u) -> u32 {
    let size = uniforms.gridSize;
    return pos.x + pos.y * (size.x + 1u) + pos.z * (size.x + 1u) * (size.y + 1u);
}

// Sample density at grid position
fn sampleDensity(pos: vec3u) -> f32 {
    return density[gridIndex(pos)];
}

// Linear interpolation
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    return a + t * (b - a);
}

// Interpolate vertex position along edge
fn interpolateEdge(p1: vec3f, p2: vec3f, v1: f32, v2: f32, iso: f32) -> vec3f {
    if (abs(iso - v1) < 0.00001) { return p1; }
    if (abs(iso - v2) < 0.00001) { return p2; }
    if (abs(v1 - v2) < 0.00001) { return p1; }

    let t = (iso - v1) / (v2 - v1);
    return vec3f(
        lerp(p1.x, p2.x, t),
        lerp(p1.y, p2.y, t),
        lerp(p1.z, p2.z, t)
    );
}

// Calculate normal from gradient (central differences)
fn calculateNormal(pos: vec3u) -> vec3f {
    let dx = sampleDensity(pos + vec3u(1u, 0u, 0u)) - sampleDensity(pos - vec3u(1u, 0u, 0u));
    let dy = sampleDensity(pos + vec3u(0u, 1u, 0u)) - sampleDensity(pos - vec3u(0u, 1u, 0u));
    let dz = sampleDensity(pos + vec3u(0u, 0u, 1u)) - sampleDensity(pos - vec3u(0u, 0u, 1u));

    let grad = vec3f(-dx, -dy, -dz);
    let len = length(grad);
    if (len < 0.0001) { return vec3f(0.0, 1.0, 0.0); }
    return grad / len;
}

// ============================================================================
// MC33 ASYMPTOTIC DECIDER
// ============================================================================

// Check if a face has alternating corner signs (ambiguous)
fn isFaceAmbiguous(cubeIndex: u32, faceIndex: u32) -> bool {
    let corners = FACE_CORNERS[faceIndex];
    let s0 = (cubeIndex >> corners.x) & 1u;
    let s1 = (cubeIndex >> corners.y) & 1u;
    let s2 = (cubeIndex >> corners.z) & 1u;
    let s3 = (cubeIndex >> corners.w) & 1u;

    // Ambiguous if signs alternate around face
    return (s0 != s1) && (s1 != s2) && (s2 != s3) && (s3 != s0);
}

// Asymptotic decider for face ambiguity
// Returns: 1 = separating, -1 = connecting, 0 = not ambiguous
fn asymptoticDecider(v0: f32, v1: f32, v2: f32, v3: f32) -> i32 {
    // Check alternating signs
    let s0 = select(-1, 1, v0 > 0.0);
    let s1 = select(-1, 1, v1 > 0.0);
    let s2 = select(-1, 1, v2 > 0.0);
    let s3 = select(-1, 1, v3 > 0.0);

    if (s0 == s1 || s1 == s2 || s2 == s3 || s3 == s0) {
        return 0; // Not ambiguous
    }

    // Q = v0*v2 - v1*v3
    let Q = v0 * v2 - v1 * v3;

    if (Q > 0.0) {
        return 1;  // Separating
    } else if (Q < 0.0) {
        return -1; // Connecting
    }

    return s0; // Tiebreaker
}

// Interior test for Case 13 tunnels
fn interiorTest(values: array<f32, 8>) -> i32 {
    var sum: f32 = 0.0;
    for (var i = 0u; i < 8u; i++) {
        sum += values[i];
    }
    let centerValue = sum / 8.0;

    if (centerValue > 0.0) { return 1; }
    if (centerValue < 0.0) { return -1; }
    return 0;
}

// Get MC33 subcase from face tests
fn getMC33Subcase(cubeIndex: u32, values: array<f32, 8>) -> u32 {
    var faceResults: u32 = 0u;

    // Test each face for ambiguity
    for (var f = 0u; f < 6u; f++) {
        if (isFaceAmbiguous(cubeIndex, f)) {
            let corners = FACE_CORNERS[f];
            let result = asymptoticDecider(
                values[corners.x],
                values[corners.y],
                values[corners.z],
                values[corners.w]
            );
            if (result > 0) {
                faceResults |= (1u << f);
            }
        }
    }

    return faceResults;
}

// ============================================================================
// MAIN COMPUTE KERNEL
// ============================================================================

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let gridSize = uniforms.gridSize;

    // Bounds check (one less than grid size for cube processing)
    if (gid.x >= gridSize.x - 1u || gid.y >= gridSize.y - 1u || gid.z >= gridSize.z - 1u) {
        return;
    }

    let iso = uniforms.isolevel;
    let scale = uniforms.scale;
    let origin = vec3f(uniforms.originX, uniforms.originY, uniforms.originZ);

    // Sample 8 corners
    var cornerValues: array<f32, 8>;
    var cornerPositions: array<vec3f, 8>;

    for (var i = 0u; i < 8u; i++) {
        let cornerPos = gid + CORNERS[i];
        cornerValues[i] = sampleDensity(cornerPos);
        cornerPositions[i] = origin + vec3f(cornerPos) * scale;
    }

    // Build cube index from corner signs
    var cubeIndex: u32 = 0u;
    for (var i = 0u; i < 8u; i++) {
        if (cornerValues[i] < iso) {
            cubeIndex |= (1u << i);
        }
    }

    // Early out if cube is entirely inside or outside
    let edgeBits = edgeTable[cubeIndex];
    if (edgeBits == 0u) {
        return;
    }

    // Compute edge intersection vertices
    var edgeVertices: array<vec3f, 12>;
    for (var e = 0u; e < 12u; e++) {
        if ((edgeBits & (1u << e)) != 0u) {
            let c1 = EDGE_A[e];
            let c2 = EDGE_B[e];
            edgeVertices[e] = interpolateEdge(
                cornerPositions[c1], cornerPositions[c2],
                cornerValues[c1], cornerValues[c2],
                iso
            );
        }
    }

    // Get MC33 case for potential ambiguity resolution
    let mc33CaseIdx = mc33Case[cubeIndex];
    let subcase = getMC33Subcase(cubeIndex, cornerValues);

    // Lookup triangle table offset
    // triTable format: flat array, 16 entries per config, -1 terminated
    let triOffset = cubeIndex * 16u;

    // Generate triangles
    var i: u32 = 0u;
    loop {
        let e0 = triTable[triOffset + i];
        if (e0 == -1) { break; }

        let e1 = triTable[triOffset + i + 1u];
        let e2 = triTable[triOffset + i + 2u];

        // Get triangle vertices
        let v0 = edgeVertices[u32(e0)];
        let v1 = edgeVertices[u32(e1)];
        let v2 = edgeVertices[u32(e2)];

        // Calculate face normal (cross product)
        let edge1 = v1 - v0;
        let edge2 = v2 - v0;
        var normal = normalize(cross(edge1, edge2));

        // Allocate vertex slots (3 vertices, 6 floats each: pos + normal)
        let vertBase = atomicAdd(&vertexCounter, 3u) * 6u;

        // Write vertex 0
        vertices[vertBase + 0u] = v0.x;
        vertices[vertBase + 1u] = v0.y;
        vertices[vertBase + 2u] = v0.z;
        vertices[vertBase + 3u] = normal.x;
        vertices[vertBase + 4u] = normal.y;
        vertices[vertBase + 5u] = normal.z;

        // Write vertex 1
        vertices[vertBase + 6u] = v1.x;
        vertices[vertBase + 7u] = v1.y;
        vertices[vertBase + 8u] = v1.z;
        vertices[vertBase + 9u] = normal.x;
        vertices[vertBase + 10u] = normal.y;
        vertices[vertBase + 11u] = normal.z;

        // Write vertex 2
        vertices[vertBase + 12u] = v2.x;
        vertices[vertBase + 13u] = v2.y;
        vertices[vertBase + 14u] = v2.z;
        vertices[vertBase + 15u] = normal.x;
        vertices[vertBase + 16u] = normal.y;
        vertices[vertBase + 17u] = normal.z;

        i += 3u;

        // Safety limit
        if (i >= 15u) { break; }
    }
}

// ============================================================================
// ALTERNATIVE: Per-Vertex Normal Calculation
// ============================================================================

// Second pass kernel for smooth normals (optional)
// Uses gradient-based normals instead of face normals

@compute @workgroup_size(256)
fn computeSmoothNormals(@builtin(global_invocation_id) gid: vec3u) {
    let vertIdx = gid.x;
    let vertCount = atomicLoad(&vertexCounter);

    if (vertIdx >= vertCount) { return; }

    // Read vertex position
    let base = vertIdx * 6u;
    let pos = vec3f(
        vertices[base + 0u],
        vertices[base + 1u],
        vertices[base + 2u]
    );

    // Convert back to grid space for gradient sampling
    let origin = vec3f(uniforms.originX, uniforms.originY, uniforms.originZ);
    let gridPos = (pos - origin) / uniforms.scale;
    let gridPosU = vec3u(u32(gridPos.x), u32(gridPos.y), u32(gridPos.z));

    // Calculate gradient normal
    let normal = calculateNormal(gridPosU);

    // Write back
    vertices[base + 3u] = normal.x;
    vertices[base + 4u] = normal.y;
    vertices[base + 5u] = normal.z;
}
