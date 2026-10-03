// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



// Bezier Distance Field Compute Shader

// Fast distance queries for line-based voxel generation

//

// Methods:

// 1. Capsule chain: Union of line segment capsules (~20 cycles)

// 2. Newton refinement: Iterative closest point (~50 cycles)

// 3. Hybrid: Capsule guess + Newton polish (~35 cycles)

//

// Used for: Tree branches, roots, tunnels, structural beams



// ============================================================================

// STRUCTURES

// ============================================================================



struct BezierCurve {

    p0: vec4f,  // xyz = control point, w = unused

    p1: vec4f,

    p2: vec4f,

    p3: vec4f,  // xyz = control point, w = radius

}



struct Segment {

    start: vec3f,

    end: vec3f,

    radius: f32,

}



struct Uniforms {

    gridSize: vec3u,

    segmentCount: u32,

    curveCount: u32,

    smoothness: f32,  // For smooth min blending

    pad0: u32,

    pad1: u32,

}



// ============================================================================

// BINDINGS

// ============================================================================



@group(0) @binding(0) var<storage, read> curves: array<BezierCurve>;

@group(0) @binding(1) var<storage, read> segments: array<vec4f>; // [start.xyz, end.x], [end.yz, radius, pad]

@group(0) @binding(2) var<storage, read_write> densityField: array<f32>;

@group(0) @binding(3) var<uniform> uniforms: Uniforms;



// ============================================================================

// DISTANCE FUNCTIONS

// ============================================================================



// Distance to a capsule (line segment with radius)

fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {

    let pa = p - a;

    let ba = b - a;

    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);

    return length(pa - ba * h) - r;

}



// Smooth minimum for blending shapes

fn smin(a: f32, b: f32, k: f32) -> f32 {

    let h = max(k - abs(a - b), 0.0) / k;

    return min(a, b) - h * h * k * 0.25;

}



// Smooth maximum (for intersection)

fn smax(a: f32, b: f32, k: f32) -> f32 {

    return -smin(-a, -b, k);

}



// ============================================================================

// BEZIER EVALUATION (De Casteljau)

// ============================================================================



fn evaluateBezier(curve: BezierCurve, t: f32) -> vec3f {

    let mt = 1.0 - t;

    

    // De Casteljau's algorithm

    let a = mix(curve.p0.xyz, curve.p1.xyz, t);

    let b = mix(curve.p1.xyz, curve.p2.xyz, t);

    let c = mix(curve.p2.xyz, curve.p3.xyz, t);

    

    let d = mix(a, b, t);

    let e = mix(b, c, t);

    

    return mix(d, e, t);

}



fn evaluateBezierDerivative(curve: BezierCurve, t: f32) -> vec3f {

    let mt = 1.0 - t;

    let mt2 = mt * mt;

    let t2 = t * t;

    

    let d0 = curve.p1.xyz - curve.p0.xyz;

    let d1 = curve.p2.xyz - curve.p1.xyz;

    let d2 = curve.p3.xyz - curve.p2.xyz;

    

    return 3.0 * mt2 * d0 + 6.0 * mt * t * d1 + 3.0 * t2 * d2;

}



fn evaluateBezierSecondDerivative(curve: BezierCurve, t: f32) -> vec3f {

    let mt = 1.0 - t;

    

    let a = curve.p2.xyz - 2.0 * curve.p1.xyz + curve.p0.xyz;

    let b = curve.p3.xyz - 2.0 * curve.p2.xyz + curve.p1.xyz;

    

    return 6.0 * mt * a + 6.0 * t * b;

}



// ============================================================================

// BEZIER DISTANCE - CAPSULE APPROXIMATION

// ============================================================================



// Fast: Approximate curve as chain of capsules

fn bezierDistanceCapsule(p: vec3f, curve: BezierCurve, numSegments: u32) -> f32 {

    let radius = curve.p3.w;

    var minDist = 1e10;

    

    let dt = 1.0 / f32(numSegments);

    var prev = evaluateBezier(curve, 0.0);

    

    for (var i = 1u; i <= numSegments; i++) {

        let t = f32(i) * dt;

        let curr = evaluateBezier(curve, t);

        

        let dist = sdCapsule(p, prev, curr, radius);

        minDist = min(minDist, dist);

        

        prev = curr;

    }

    

    return minDist;

}



// Get approximate closest t from capsule chain

fn bezierClosestTCapsule(p: vec3f, curve: BezierCurve, numSegments: u32) -> f32 {

    var minDist = 1e10;

    var bestT = 0.0;

    

    let dt = 1.0 / f32(numSegments);

    var prev = evaluateBezier(curve, 0.0);

    

    for (var i = 1u; i <= numSegments; i++) {

        let t = f32(i) * dt;

        let curr = evaluateBezier(curve, t);

        

        // Capsule distance

        let pa = p - prev;

        let ba = curr - prev;

        let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);

        let dist = length(pa - ba * h);

        

        if (dist < minDist) {

            minDist = dist;

            bestT = (f32(i - 1u) + h) * dt;

        }

        

        prev = curr;

    }

    

    return bestT;

}



// ============================================================================

// BEZIER DISTANCE - NEWTON-RAPHSON REFINEMENT

// ============================================================================



// Accurate: Iteratively find closest point

fn bezierClosestNewton(p: vec3f, curve: BezierCurve, initialT: f32, iterations: u32) -> f32 {

    var t = initialT;

    

    for (var i = 0u; i < iterations; i++) {

        let B = evaluateBezier(curve, t);

        let dB = evaluateBezierDerivative(curve, t);

        let ddB = evaluateBezierSecondDerivative(curve, t);

        

        // f(t) = (B - p) · B' (should be zero at minimum)

        let diff = B - p;

        let f = dot(diff, dB);

        

        // f'(t) = B' · B' + (B - p) · B''

        let df = dot(dB, dB) + dot(diff, ddB);

        

        if (abs(df) < 0.0001) { break; }

        

        // Newton step

        t = t - f / df;

        

        // Clamp to [0, 1]

        t = clamp(t, 0.0, 1.0);

    }

    

    let closestPoint = evaluateBezier(curve, t);

    return length(p - closestPoint) - curve.p3.w;

}



// ============================================================================

// HYBRID: CAPSULE GUESS + NEWTON REFINEMENT

// ============================================================================



fn bezierDistanceHybrid(p: vec3f, curve: BezierCurve) -> f32 {

    // Fast capsule approximation for initial guess

    let initialT = bezierClosestTCapsule(p, curve, 8u);

    

    // Refine with Newton (4 iterations usually enough)

    return bezierClosestNewton(p, curve, initialT, 4u);

}



// ============================================================================

// MULTI-CURVE DISTANCE

// ============================================================================



fn multiCurveDistance(p: vec3f, numCurves: u32) -> f32 {

    var minDist = 1e10;

    

    for (var i = 0u; i < numCurves; i++) {

        let dist = bezierDistanceCapsule(p, curves[i], 16u);

        minDist = min(minDist, dist);

    }

    

    return minDist;

}



fn multiCurveDistanceSmooth(p: vec3f, numCurves: u32, smoothness: f32) -> f32 {

    if (numCurves == 0u) { return 1e10; }

    

    var result = bezierDistanceCapsule(p, curves[0], 16u);

    

    for (var i = 1u; i < numCurves; i++) {

        let dist = bezierDistanceCapsule(p, curves[i], 16u);

        result = smin(result, dist, smoothness);

    }

    

    return result;

}



// ============================================================================

// SEGMENT-BASED DISTANCE (Pre-sampled curves)

// ============================================================================



// For pre-sampled segments stored as [start, end, radius]

fn segmentDistance(p: vec3f, segmentIdx: u32) -> f32 {

    // Segments stored as pairs of vec4: [start.xyz, end.x], [end.yz, radius, pad]

    let idx = segmentIdx * 2u;

    let v0 = segments[idx];

    let v1 = segments[idx + 1u];

    

    let start = v0.xyz;

    let endPt = vec3f(v0.w, v1.xy);

    let radius = v1.z;

    

    return sdCapsule(p, start, endPt, radius);

}



fn allSegmentsDistance(p: vec3f) -> f32 {

    var minDist = 1e10;

    let numSegs = uniforms.segmentCount;

    

    for (var i = 0u; i < numSegs; i++) {

        let dist = segmentDistance(p, i);

        minDist = min(minDist, dist);

    }

    

    return minDist;

}



// ============================================================================

// MAIN COMPUTE KERNELS

// ============================================================================



// Generate density field from curves

@compute @workgroup_size(8, 8, 8)

fn generateDensityField(@builtin(global_invocation_id) gid: vec3u) {

    let size = uniforms.gridSize;

    

    if (gid.x >= size.x || gid.y >= size.y || gid.z >= size.z) {

        return;

    }

    

    let idx = gid.x + gid.y * size.x + gid.z * size.x * size.y;

    let p = vec3f(gid) + vec3f(0.5); // Cell center

    

    // Compute distance to all curves

    let dist = multiCurveDistanceSmooth(p, uniforms.curveCount, uniforms.smoothness);

    

    // Store as density (negative inside, positive outside)

    densityField[idx] = -dist; // Invert for MC convention (positive = solid)

}



// Faster version using pre-sampled segments

@compute @workgroup_size(8, 8, 8)

fn generateDensityFromSegments(@builtin(global_invocation_id) gid: vec3u) {

    let size = uniforms.gridSize;

    

    if (gid.x >= size.x || gid.y >= size.y || gid.z >= size.z) {

        return;

    }

    

    let idx = gid.x + gid.y * size.x + gid.z * size.x * size.y;

    let p = vec3f(gid) + vec3f(0.5);

    

    let dist = allSegmentsDistance(p);

    densityField[idx] = -dist;

}



// Single point query (for debugging/testing)

@compute @workgroup_size(1)

fn queryDistance(

    @builtin(global_invocation_id) gid: vec3u

) {

    let p = vec3f(gid);

    let dist = multiCurveDistance(p, uniforms.curveCount);

    densityField[0] = dist;

}



// ============================================================================

// TAPERED CURVES (Varying radius along length)

// ============================================================================



fn bezierDistanceTapered(p: vec3f, curve: BezierCurve, startRadius: f32, endRadius: f32) -> f32 {

    var minDist = 1e10;

    let numSegments = 16u;

    let dt = 1.0 / f32(numSegments);

    

    var prev = evaluateBezier(curve, 0.0);

    var prevR = startRadius;

    

    for (var i = 1u; i <= numSegments; i++) {

        let t = f32(i) * dt;

        let curr = evaluateBezier(curve, t);

        let currR = mix(startRadius, endRadius, t);

        

        // Tapered capsule (cone frustum)

        let dist = sdTaperedCapsule(p, prev, curr, prevR, currR);

        minDist = min(minDist, dist);

        

        prev = curr;

        prevR = currR;

    }

    

    return minDist;

}



// Distance to tapered capsule (cone frustum)

fn sdTaperedCapsule(p: vec3f, a: vec3f, b: vec3f, ra: f32, rb: f32) -> f32 {

    let ba = b - a;

    let pa = p - a;

    

    let baba = dot(ba, ba);

    let paba = dot(pa, ba);

    

    let x = sqrt(dot(pa, pa) - paba * paba / baba);

    let h = clamp(paba / baba, 0.0, 1.0);

    

    let r = mix(ra, rb, h);

    return x - r;

}



// ============================================================================

// BRANCHING SUPPORT

// ============================================================================



// For tree/root structures with smooth branch joints

fn branchJointDistance(p: vec3f, parent: BezierCurve, child: BezierCurve, blendRadius: f32) -> f32 {

    let parentDist = bezierDistanceCapsule(p, parent, 16u);

    let childDist = bezierDistanceCapsule(p, child, 16u);

    

    // Smooth blend at junction

    return smin(parentDist, childDist, blendRadius);

}
