// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Signed Distance Field Primitives
 * 
 * Common SDF shapes for ray marching.
 * Used by: volume rendering, procedural geometry, collision detection
 * 
 * Functions:
 *   - sdSphere(p, r) - Sphere SDF
 *   - sdBox(p, b) - Box SDF
 *   - sdPlane(p, n) - Plane SDF (n.xyz = normal, n.w = distance)
 *   - sdCapsule(p, a, b, r) - Capsule/cylinder SDF
 *   - sdTorus(p, t) - Torus SDF
 *   - opUnion(d1, d2) - Union of two SDFs
 *   - opSubtract(d1, d2) - Subtraction (d1 - d2)
 *   - opIntersect(d1, d2) - Intersection
 *   - opSmoothUnion(d1, d2, k) - Smooth blend union
 */

export const sdfPrimitivesWGSL = /* wgsl */`
// ============================================================================
// SDF PRIMITIVES
// ============================================================================

// Sphere: p = sample point, r = radius
fn sdSphere(p : vec3<f32>, r : f32) -> f32 {
  return length(p) - r;
}

// Box: p = sample point, b = half-extents
fn sdBox(p : vec3<f32>, b : vec3<f32>) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec3<f32>(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0);
}

// Plane: p = sample point, n = vec4(normal.xyz, distance)
// Normal must be normalized
fn sdPlane(p : vec3<f32>, n : vec4<f32>) -> f32 {
  return dot(p, n.xyz) + n.w;
}

// Capsule: a, b = endpoints, r = radius
fn sdCapsule(p : vec3<f32>, a : vec3<f32>, b : vec3<f32>, r : f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// Torus: t.x = major radius, t.y = minor radius
fn sdTorus(p : vec3<f32>, t : vec2<f32>) -> f32 {
  let q = vec2<f32>(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

// Round box: b = half-extents, r = corner radius
fn sdRoundBox(p : vec3<f32>, b : vec3<f32>, r : f32) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

// ============================================================================
// SDF OPERATIONS
// ============================================================================

// Union: min of two SDFs
fn opUnion(d1 : f32, d2 : f32) -> f32 {
  return min(d1, d2);
}

// Subtraction: d1 minus d2
fn opSubtract(d1 : f32, d2 : f32) -> f32 {
  return max(d1, -d2);
}

// Intersection: where both shapes exist
fn opIntersect(d1 : f32, d2 : f32) -> f32 {
  return max(d1, d2);
}

// Smooth union: k controls blend radius
fn opSmoothUnion(d1 : f32, d2 : f32, k : f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

// Smooth subtraction
fn opSmoothSubtract(d1 : f32, d2 : f32, k : f32) -> f32 {
  let h = clamp(0.5 - 0.5 * (d2 + d1) / k, 0.0, 1.0);
  return mix(d1, -d2, h) + k * h * (1.0 - h);
}

// Smooth intersection
fn opSmoothIntersect(d1 : f32, d2 : f32, k : f32) -> f32 {
  let h = clamp(0.5 - 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) + k * h * (1.0 - h);
}

// ============================================================================
// SDF TRANSFORMS
// ============================================================================

// Translate point (for transforming SDF position)
fn opTranslate(p : vec3<f32>, offset : vec3<f32>) -> vec3<f32> {
  return p - offset;
}

// Repeat infinitely in all directions
fn opRepeat(p : vec3<f32>, spacing : vec3<f32>) -> vec3<f32> {
  return p - spacing * floor(p / spacing) - spacing * 0.5;
}

// Repeat with limited count
fn opRepeatLimited(p : vec3<f32>, spacing : f32, limits : vec3<f32>) -> vec3<f32> {
  return p - spacing * clamp(round(p / spacing), -limits, limits);
}

// ============================================================================
// METABALLS / BLOBS
// ============================================================================

// Metaball potential function (inverse square falloff)
fn metaballPotential(p : vec3<f32>, center : vec3<f32>, radius : f32) -> f32 {
  let d = length(p - center);
  if (d < 0.0001) { return 1000.0; }
  return radius * radius / (d * d);
}

// Metaball potential to SDF approximation
fn metaballToSDF(potential : f32, threshold : f32) -> f32 {
  // Approximate SDF from potential field
  return (threshold - potential) * 0.5;
}

// Blend two metaball potentials
fn blendMetaballs(p1 : f32, p2 : f32) -> f32 {
  return p1 + p2;
}

// ============================================================================
// RAYMARCHING UTILITIES
// ============================================================================

// Calculate SDF normal using tetrahedron technique (4 samples)
fn calcNormalSDF(p : vec3<f32>, eps : f32) -> vec3<f32> {
  // Note: Replace mapSDF with your scene's SDF function
  // This is a template showing the technique
  let k = vec2<f32>(1.0, -1.0);
  return normalize(
    k.xyy * 0.0 + // mapSDF(p + k.xyy * eps)
    k.yyx * 0.0 + // mapSDF(p + k.yyx * eps)
    k.yxy * 0.0 + // mapSDF(p + k.yxy * eps)
    k.xxx * 0.0   // mapSDF(p + k.xxx * eps)
  );
}

// Rainbow/iridescent coloring based on value and time
fn rainbowColor(value : f32, time : f32, uv : vec2<f32>) -> vec3<f32> {
  return 0.5 + 0.5 * cos(value + time * 3.0 + vec3<f32>(uv.x, uv.y, uv.x) * 2.0 + vec3<f32>(0.0, 2.0, 4.0));
}

// Depth fog falloff
fn depthFog(color : vec3<f32>, depth : f32, density : f32) -> vec3<f32> {
  return color * exp(-depth * density);
}

// ============================================================================
// ADDITIONAL PRIMITIVES (IQ Collection)
// ============================================================================

// Cylinder: h.x = radius, h.y = half-height
fn sdCylinder(p : vec3<f32>, h : vec2<f32>) -> f32 {
  let d = abs(vec2<f32>(length(p.xz), p.y)) - h;
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2<f32>(0.0)));
}

// Cone: c.x = sin angle, c.y = cos angle, h = height
fn sdCone(p : vec3<f32>, c : vec2<f32>, h : f32) -> f32 {
  let q = length(p.xz);
  return max(dot(c, vec2<f32>(q, p.y)), -h - p.y);
}

// Ellipsoid: r = radii in each axis
fn sdEllipsoid(p : vec3<f32>, r : vec3<f32>) -> f32 {
  let k0 = length(p / r);
  let k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / k1;
}

// Hex prism: h.x = edge length, h.y = half-height
fn sdHexPrism(p : vec3<f32>, h : vec2<f32>) -> f32 {
  let k = vec3<f32>(-0.8660254, 0.5, 0.57735);
  var q = abs(p);
  q = vec3<f32>(q.x - 2.0 * min(dot(k.xy, q.xy), 0.0) * k.x,
                q.y - 2.0 * min(dot(k.xy, q.xy), 0.0) * k.y,
                q.z);
  let d = vec2<f32>(
    length(q.xy - vec2<f32>(clamp(q.x, -k.z * h.x, k.z * h.x), h.x)) * sign(q.y - h.x),
    q.z - h.y
  );
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2<f32>(0.0)));
}

// Round cone: r1, r2 = end radii, h = height
fn sdRoundCone(p : vec3<f32>, r1 : f32, r2 : f32, h : f32) -> f32 {
  let b = (r1 - r2) / h;
  let a = sqrt(1.0 - b * b);
  let q = vec2<f32>(length(p.xz), p.y);
  let k = dot(q, vec2<f32>(-b, a));
  if (k < 0.0) { return length(q) - r1; }
  if (k > a * h) { return length(q - vec2<f32>(0.0, h)) - r2; }
  return dot(q, vec2<f32>(a, b)) - r1;
}

// Onion (hollows a shape)
fn opOnion(d : f32, thickness : f32) -> f32 {
  return abs(d) - thickness;
}

// Round (expands a shape)
fn opRound(d : f32, r : f32) -> f32 {
  return d - r;
}
`;
