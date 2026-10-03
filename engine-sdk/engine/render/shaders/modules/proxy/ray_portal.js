// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Ray Portal WGSL Shader Module
 *
 * Provides WGSL functions for all proxy geometry quality tiers:
 *   ULTRA  — TLAS/BLAS two-level BVH traversal with ray redirect
 *   HIGH   — SDF cone marching proxy
 *   MED    — True impostor (billboarded SDF/height-field)
 *   LOW    — Octahedral impostor atlas sampling
 *
 * All functions are pure WGSL and intended to be embedded via template
 * literals into compute shader source strings.
 */

export const RAY_PORTAL_WGSL = /* wgsl */`

// ============================================================================
// SHARED STRUCTURES
// ============================================================================

struct ProxyRay {
    origin    : vec3<f32>,
    direction : vec3<f32>,
    tmin      : f32,
    tmax      : f32,
}

struct ProxyHit {
    hit      : bool,
    t        : f32,
    position : vec3<f32>,
    normal   : vec3<f32>,
    uv       : vec2<f32>,
    assetId  : u32,
}

fn proxyNoHit() -> ProxyHit {
    var h : ProxyHit;
    h.hit = false;
    h.t   = 1e10;
    return h;
}

// ============================================================================
// COORDINATE SPACE HELPERS
// ============================================================================

// Transform a ray by a 4x4 matrix (for object-space redirect).
// Used to move the ray into the proxy's local object space (TLAS→BLAS).
fn transformRay(ray: ProxyRay, mat: mat4x4<f32>) -> ProxyRay {
    var r : ProxyRay;
    r.origin    = (mat * vec4<f32>(ray.origin, 1.0)).xyz;
    r.direction = normalize((mat * vec4<f32>(ray.direction, 0.0)).xyz);
    r.tmin      = ray.tmin;
    r.tmax      = ray.tmax;
    return r;
}

// Transform a surface normal from object space back to world space.
// Uses transpose(inverse(mat)) = just the upper-left 3x3 of the inverse.
fn transformNormal(n: vec3<f32>, invMat: mat4x4<f32>) -> vec3<f32> {
    let m = mat3x3<f32>(invMat[0].xyz, invMat[1].xyz, invMat[2].xyz);
    return normalize(transpose(m) * n);
}

// ============================================================================
// PORTAL RAY REDIRECT (ULTRA tier — Blender Ray Portal equivalent)
// ============================================================================

// Redirects an incoming world-space ray through a proxy portal.
// invProxyMat: inverse of the proxy instance's world transform (pre-computed CPU side).
// The returned ray is in the target asset's local object space, ready for BLAS traversal.
fn portalRedirectRay(worldRay: ProxyRay, invProxyMat: mat4x4<f32>) -> ProxyRay {
    return transformRay(worldRay, invProxyMat);
}

// ============================================================================
// TLAS / BLAS TRAVERSAL HELPERS
// ============================================================================

struct TLASInstance {
    aabbMin     : vec3<f32>,
    blasOffset  : u32,
    aabbMax     : vec3<f32>,
    instanceId  : u32,
    invWorldMat : mat4x4<f32>,
}

struct BLASNode {
    aabbMin     : vec3<f32>,
    leftChild   : u32,
    aabbMax     : vec3<f32>,
    rightChild  : u32,
    triOffset   : u32,
    triCount    : u32,
    _pad0       : u32,
    _pad1       : u32,
}

// Slab method AABB intersection — returns tEnter or -1 on miss.
fn rayAABBPortal(ray: ProxyRay, bmin: vec3<f32>, bmax: vec3<f32>) -> f32 {
    let invDir = 1.0 / ray.direction;
    let t1 = (bmin - ray.origin) * invDir;
    let t2 = (bmax - ray.origin) * invDir;
    let tMin = max(max(min(t1.x, t2.x), min(t1.y, t2.y)), min(t1.z, t2.z));
    let tMax = min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z));
    if (tMax < 0.0 || tMin > tMax) { return -1.0; }
    return select(tMin, 0.0, tMin < 0.0);
}

// Möller–Trumbore ray-triangle intersection.
fn rayTriPortal(
    ray: ProxyRay,
    v0: vec3<f32>, v1: vec3<f32>, v2: vec3<f32>
) -> f32 {
    let edge1 = v1 - v0;
    let edge2 = v2 - v0;
    let h = cross(ray.direction, edge2);
    let a = dot(edge1, h);
    if (abs(a) < 1e-8) { return -1.0; }
    let f = 1.0 / a;
    let s = ray.origin - v0;
    let u = f * dot(s, h);
    if (u < 0.0 || u > 1.0) { return -1.0; }
    let q = cross(s, edge1);
    let v = f * dot(ray.direction, q);
    if (v < 0.0 || u + v > 1.0) { return -1.0; }
    let t = f * dot(edge2, q);
    return select(-1.0, t, t > ray.tmin && t < ray.tmax);
}

// ============================================================================
// SDF CONE MARCHING (HIGH tier)
// ============================================================================

// Reads a 3D SDF texture at normalized [0,1] coordinates.
// texCoords must be clamped to [0,1]^3 before sampling.
fn sampleSDF3D(sdfTex: texture_3d<f32>, sdfSampler: sampler, texCoords: vec3<f32>) -> f32 {
    return textureSampleLevel(sdfTex, sdfSampler, texCoords, 0.0).r;
}

// Cone march (sphere tracing) through an SDF bounding box.
// The ray is already in proxy object space (range [-1,1] on each axis).
// sdfScale: converts SDF value (world units) to normalized [0,1] step size.
// Returns a ProxyHit with position and gradient normal.
fn marchSDF(
    ray        : ProxyRay,
    sdfTex     : texture_3d<f32>,
    sdfSampler : sampler,
    sdfScale   : f32,
    maxSteps   : i32
) -> ProxyHit {
    // Convert ray from object space [-1,1] to SDF texture space [0,1]
    let boxMin = vec3<f32>(-1.0);
    let boxMax = vec3<f32>(1.0);
    let tBox = rayAABBPortal(ray, boxMin, boxMax);
    if (tBox < 0.0) { return proxyNoHit(); }

    var t = tBox + 0.001;
    for (var i = 0; i < maxSteps; i++) {
        let p  = ray.origin + ray.direction * t;
        let uv = (p - boxMin) / (boxMax - boxMin);
        if (any(uv < vec3<f32>(0.0)) || any(uv > vec3<f32>(1.0))) { break; }

        let dist = sampleSDF3D(sdfTex, sdfSampler, uv) * sdfScale;
        if (dist < 0.001) {
            // Compute gradient normal via central differences
            let eps = 0.004;
            let nx = sampleSDF3D(sdfTex, sdfSampler, uv + vec3<f32>(eps, 0.0, 0.0))
                   - sampleSDF3D(sdfTex, sdfSampler, uv - vec3<f32>(eps, 0.0, 0.0));
            let ny = sampleSDF3D(sdfTex, sdfSampler, uv + vec3<f32>(0.0, eps, 0.0))
                   - sampleSDF3D(sdfTex, sdfSampler, uv - vec3<f32>(0.0, eps, 0.0));
            let nz = sampleSDF3D(sdfTex, sdfSampler, uv + vec3<f32>(0.0, 0.0, eps))
                   - sampleSDF3D(sdfTex, sdfSampler, uv - vec3<f32>(0.0, 0.0, eps));
            var hit : ProxyHit;
            hit.hit      = true;
            hit.t        = t;
            hit.position = p;
            hit.normal   = normalize(vec3<f32>(nx, ny, nz));
            hit.uv       = uv.xy;
            return hit;
        }
        t += max(dist, 0.001);
        if (t > ray.tmax) { break; }
    }
    return proxyNoHit();
}

// ============================================================================
// TRUE IMPOSTOR — BILLBOARD HEIGHT FIELD RAY MARCH (MED tier)
// ============================================================================

// Ray marches through a height field stored in a 2D texture (R channel = height).
// The impostor is a camera-facing quad. Ray is in local quad space where
// XY are [-0.5, 0.5] UVs and Z is depth from the quad plane.
fn marchHeightField(
    ray      : ProxyRay,
    hfTex    : texture_2d<f32>,
    hfSampler: sampler,
    maxSteps : i32,
    stepSize : f32
) -> ProxyHit {
    // Only march if ray is going into the quad (positive Z direction in quad space)
    if (ray.direction.z <= 0.001) { return proxyNoHit(); }

    // Start at the front face of the quad volume [0, 1] in depth
    let tStart = -ray.origin.z / ray.direction.z;
    var t = max(tStart, 0.0);

    var prevHeight = 0.0;
    var prevT = t;

    for (var i = 0; i < maxSteps; i++) {
        let p  = ray.origin + ray.direction * t;
        let uv = p.xy + vec2<f32>(0.5);
        if (any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0))) { break; }

        let surfHeight = textureSampleLevel(hfTex, hfSampler, uv, 0.0).r;
        let rayDepth   = p.z;

        if (rayDepth > surfHeight) {
            // Binary search refinement between prevT and t
            var lo = prevT;
            var hi = t;
            for (var b = 0; b < 5; b++) {
                let mid  = (lo + hi) * 0.5;
                let pm   = ray.origin + ray.direction * mid;
                let uvm  = pm.xy + vec2<f32>(0.5);
                let hm   = textureSampleLevel(hfTex, hfSampler, uvm, 0.0).r;
                if (pm.z > hm) { hi = mid; } else { lo = mid; }
            }
            let pFinal = ray.origin + ray.direction * ((lo + hi) * 0.5);
            let uvFinal = pFinal.xy + vec2<f32>(0.5);
            // Approximate normal from height-field gradient
            let eps = 0.005;
            let hx = textureSampleLevel(hfTex, hfSampler, uvFinal + vec2<f32>(eps, 0.0), 0.0).r
                   - textureSampleLevel(hfTex, hfSampler, uvFinal - vec2<f32>(eps, 0.0), 0.0).r;
            let hy = textureSampleLevel(hfTex, hfSampler, uvFinal + vec2<f32>(0.0, eps), 0.0).r
                   - textureSampleLevel(hfTex, hfSampler, uvFinal - vec2<f32>(0.0, eps), 0.0).r;
            var hit : ProxyHit;
            hit.hit      = true;
            hit.t        = (lo + hi) * 0.5;
            hit.position = pFinal;
            hit.normal   = normalize(vec3<f32>(-hx / (2.0 * eps), -hy / (2.0 * eps), 1.0));
            hit.uv       = uvFinal;
            return hit;
        }
        prevHeight = surfHeight;
        prevT      = t;
        t += stepSize;
    }
    return proxyNoHit();
}

// ============================================================================
// OCTAHEDRAL IMPOSTOR SAMPLING (LOW tier)
// ============================================================================

// Encode a unit direction vector to octahedral coordinates [0,1]^2.
fn dirToOctahedral(dir: vec3<f32>) -> vec2<f32> {
    let n  = dir / (abs(dir.x) + abs(dir.y) + abs(dir.z));
    var uv = n.xy;
    if (n.z < 0.0) {
        uv = (1.0 - abs(uv.yx)) * sign(uv);
    }
    return uv * 0.5 + vec2<f32>(0.5);
}

// Sample the octahedral impostor atlas.
// atlasSize: number of frames along one axis of the square atlas (e.g. 4 → 4×4=16 frames).
// frameSize: [0,1] size of one frame in atlas UV space = 1/atlasSize.
// Returns blended color from the 3 nearest octahedral frames.
fn sampleOctahedral(
    viewDir    : vec3<f32>,
    atlasTex   : texture_2d<f32>,
    atlasSampler: sampler,
    atlasFrames: u32
) -> vec4<f32> {
    let frameCount = f32(atlasFrames);
    let frameSize  = 1.0 / frameCount;
    let oct        = dirToOctahedral(viewDir);

    // Find nearest frame index
    let frameUV   = oct * frameCount;
    let frameIdx  = clamp(vec2<u32>(vec2<i32>(floor(frameUV))), vec2<u32>(0u), vec2<u32>(atlasFrames - 1u));
    let localUV   = fract(frameUV);

    // Bilinearly blend 4 atlas frames for smooth transition
    let f00 = frameIdx;
    let f10 = min(frameIdx + vec2<u32>(1u, 0u), vec2<u32>(atlasFrames - 1u));
    let f01 = min(frameIdx + vec2<u32>(0u, 1u), vec2<u32>(atlasFrames - 1u));
    let f11 = min(frameIdx + vec2<u32>(1u, 1u), vec2<u32>(atlasFrames - 1u));

    let sampleFrame = vec2<f32>(0.5) * frameSize; // center of frame in atlas UV

    let uv00 = (vec2<f32>(f00) + sampleFrame) * frameSize;
    let uv10 = (vec2<f32>(f10) + sampleFrame) * frameSize;
    let uv01 = (vec2<f32>(f01) + sampleFrame) * frameSize;
    let uv11 = (vec2<f32>(f11) + sampleFrame) * frameSize;

    let c00 = textureSampleLevel(atlasTex, atlasSampler, uv00, 0.0);
    let c10 = textureSampleLevel(atlasTex, atlasSampler, uv10, 0.0);
    let c01 = textureSampleLevel(atlasTex, atlasSampler, uv01, 0.0);
    let c11 = textureSampleLevel(atlasTex, atlasSampler, uv11, 0.0);

    return mix(mix(c00, c10, localUV.x), mix(c01, c11, localUV.x), localUV.y);
}

// ============================================================================
// BILLBOARD ALIGNMENT
// ============================================================================

// Build a rotation matrix that aligns the billboard Z-axis to point at the camera.
// instancePos: world position of the proxy instance.
// cameraPos:   world position of the camera.
// Returns mat3 columns: right, up, forward.
fn alignBillboardToCamera(instancePos: vec3<f32>, cameraPos: vec3<f32>) -> mat3x3<f32> {
    let forward = normalize(cameraPos - instancePos);
    let worldUp = vec3<f32>(0.0, 1.0, 0.0);
    let right   = normalize(cross(worldUp, forward));
    let up      = cross(forward, right);
    return mat3x3<f32>(right, up, forward);
}

// ============================================================================
// TRANSPARENCY DEPTH GUARD
// ============================================================================

// Returns true if we have remaining bounce budget for proxy transparency.
// bounceCount is the current number of transparent surfaces already pierced.
// maxBounces should be set per-frame based on cluster density read-back.
fn allowTransparencyBounce(bounceCount: u32, maxBounces: u32) -> bool {
    return bounceCount < maxBounces;
}

// ============================================================================
// PROXY QUALITY TIER CONSTANTS
// ============================================================================

const PROXY_TIER_ULTRA    : u32 = 0u; // TLAS/BLAS per-pixel ray
const PROXY_TIER_HIGH     : u32 = 1u; // SDF cone march
const PROXY_TIER_MED      : u32 = 2u; // True impostor (height field)
const PROXY_TIER_LOW      : u32 = 3u; // Octahedral atlas sample
const PROXY_TIER_DISABLED : u32 = 4u; // Fall through to standard LOD

`;

export default RAY_PORTAL_WGSL;
