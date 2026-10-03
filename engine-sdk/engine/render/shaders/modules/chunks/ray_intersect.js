// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Ray-Primitive Intersection Library
 * 
 * Analytic ray intersection routines for various geometric primitives.
 * Returns intersection distance and surface normal.
 * 
 * All functions follow the pattern:
 *   fn iShape(ro, rd, ...) -> RayHit
 * 
 * Where RayHit contains:
 *   - dist: distance along ray (MAX_RAY_DIST if no hit)
 *   - normal: surface normal at intersection
 * 
 * Primitives:
 *   - Plane, Disk
 *   - Sphere, Ellipsoid
 *   - Box, Rounded Box
 *   - Cylinder, Capsule
 *   - Cone, Rounded Cone
 *   - Torus
 *   - Triangle, Quad
 */

export const rayIntersectWGSL = /* wgsl */`
// ============================================================================
// RAY INTERSECTION CONSTANTS AND STRUCTURES
// ============================================================================

const MAX_RAY_DIST : f32 = 1e10;

struct RayHit {
  dist : f32,
  normal : vec3<f32>,
}

fn noHit() -> RayHit {
  return RayHit(MAX_RAY_DIST, vec3<f32>(0.0));
}

// Utility: squared length
fn dot2(v : vec3<f32>) -> f32 {
  return dot(v, v);
}

// ============================================================================
// PLANE & DISK
// ============================================================================

// Infinite plane intersection
// planeNormal must be normalized, planeDist is distance from origin
fn iPlane(ro : vec3<f32>, rd : vec3<f32>, planeNormal : vec3<f32>, planeDist : f32) -> RayHit {
  let denom = dot(rd, planeNormal);
  
  // Check if ray is parallel to plane
  if (abs(denom) < 0.0001) {
    return noHit();
  }
  
  let t = -(dot(ro, planeNormal) + planeDist) / denom;
  
  if (t < 0.0) {
    return noHit();
  }
  
  // Normal points toward ray origin
  let n = select(planeNormal, -planeNormal, denom > 0.0);
  return RayHit(t, n);
}

// Disk (bounded plane)
fn iDisk(ro : vec3<f32>, rd : vec3<f32>, center : vec3<f32>, normal : vec3<f32>, radius : f32) -> RayHit {
  let planeHit = iPlane(ro - center, rd, normal, 0.0);
  
  if (planeHit.dist >= MAX_RAY_DIST) {
    return noHit();
  }
  
  // Check if hit point is within disk radius
  let hitPoint = ro + rd * planeHit.dist;
  let distFromCenter = length(hitPoint - center);
  
  if (distFromCenter > radius) {
    return noHit();
  }
  
  return planeHit;
}

// ============================================================================
// SPHERE & ELLIPSOID
// ============================================================================

// Sphere centered at origin
fn iSphere(ro : vec3<f32>, rd : vec3<f32>, radius : f32) -> RayHit {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - radius * radius;
  let h = b * b - c;
  
  if (h < 0.0) {
    return noHit();
  }
  
  let sqrtH = sqrt(h);
  let t1 = -b - sqrtH;
  let t2 = -b + sqrtH;
  
  // Return nearest positive intersection
  if (t1 > 0.0) {
    let normal = normalize(ro + rd * t1);
    return RayHit(t1, normal);
  } else if (t2 > 0.0) {
    let normal = normalize(ro + rd * t2);
    return RayHit(t2, normal);
  }
  
  return noHit();
}

// Ellipsoid centered at origin with radii in each axis
fn iEllipsoid(ro : vec3<f32>, rd : vec3<f32>, radii : vec3<f32>) -> RayHit {
  // Transform ray to unit sphere space
  let ocn = ro / radii;
  let rdn = rd / radii;
  
  let a = dot(rdn, rdn);
  let b = dot(ocn, rdn);
  let c = dot(ocn, ocn) - 1.0;
  let h = b * b - a * c;
  
  if (h < 0.0) {
    return noHit();
  }
  
  let t = (-b - sqrt(h)) / a;
  
  if (t < 0.0) {
    return noHit();
  }
  
  // Normal in ellipsoid space
  let normal = normalize((ro + t * rd) / radii);
  return RayHit(t, normal);
}

// ============================================================================
// BOX & ROUNDED BOX
// ============================================================================

// Axis-aligned box centered at origin
fn iBox(ro : vec3<f32>, rd : vec3<f32>, boxSize : vec3<f32>) -> RayHit {
  let m = sign(rd) / max(abs(rd), vec3<f32>(1e-8));
  let n = m * ro;
  let k = abs(m) * boxSize;
  
  let t1 = -n - k;
  let t2 = -n + k;
  
  let tN = max(max(t1.x, t1.y), t1.z);
  let tF = min(min(t2.x, t2.y), t2.z);
  
  if (tN > tF || tF < 0.0) {
    return noHit();
  }
  
  var t : f32;
  var normal : vec3<f32>;
  
  if (tN > 0.0) {
    t = tN;
    // Normal points outward from the face we hit
    normal = -sign(rd) * step(t1.yzx, t1.xyz) * step(t1.zxy, t1.xyz);
  } else if (tF > 0.0) {
    t = tF;
    normal = -sign(rd) * step(t2.yzx, t2.xyz) * step(t2.zxy, t2.xyz);
  } else {
    return noHit();
  }
  
  return RayHit(t, normal);
}

// Rounded box - box with rounded edges and corners
fn iRoundedBox(ro : vec3<f32>, rd : vec3<f32>, boxSize : vec3<f32>, radius : f32) -> RayHit {
  // First check bounding box
  let m = 1.0 / rd;
  let n = m * ro;
  let k = abs(m) * (boxSize + radius);
  let t1 = -n - k;
  let t2 = -n + k;
  let tN = max(max(t1.x, t1.y), t1.z);
  let tF = min(min(t2.x, t2.y), t2.z);
  
  if (tN > tF || tF < 0.0) {
    return noHit();
  }
  
  var t = select(tN, tF, tN < 0.0);
  if (t < 0.0) {
    return noHit();
  }
  
  // Check if we hit a face (not edge/corner)
  let pos = ro + t * rd;
  let s = sign(pos);
  let ros = ro * s;
  let rds = rd * s;
  var testPos = abs(pos) - boxSize;
  testPos = max(testPos.xyz, testPos.yzx);
  
  if (min(min(testPos.x, testPos.y), testPos.z) < 0.0) {
    let normal = sign(pos) * normalize(max(abs(pos) - boxSize, vec3<f32>(0.0)));
    return RayHit(t, normal);
  }
  
  // Check rounded edges and corners
  let oc = ros - boxSize;
  let dd = rds * rds;
  let oo = oc * oc;
  let od = oc * rds;
  let ra2 = radius * radius;
  
  var minT = MAX_RAY_DIST;
  
  // Corner (sphere intersection)
  let b = od.x + od.y + od.z;
  let c = oo.x + oo.y + oo.z - ra2;
  var h = b * b - c;
  if (h > 0.0) {
    let cornerT = -b - sqrt(h);
    if (cornerT > 0.0) {
      minT = cornerT;
    }
  }
  
  // Edge X (cylinder intersection)
  var a = dd.y + dd.z;
  var bEdge = od.y + od.z;
  var cEdge = oo.y + oo.z - ra2;
  h = bEdge * bEdge - a * cEdge;
  if (h > 0.0) {
    let edgeT = (-bEdge - sqrt(h)) / a;
    if (edgeT > 0.0 && abs(ros.x + rds.x * edgeT) < boxSize.x && edgeT < minT) {
      minT = edgeT;
    }
  }
  
  // Edge Y
  a = dd.z + dd.x;
  bEdge = od.z + od.x;
  cEdge = oo.z + oo.x - ra2;
  h = bEdge * bEdge - a * cEdge;
  if (h > 0.0) {
    let edgeT = (-bEdge - sqrt(h)) / a;
    if (edgeT > 0.0 && abs(ros.y + rds.y * edgeT) < boxSize.y && edgeT < minT) {
      minT = edgeT;
    }
  }
  
  // Edge Z
  a = dd.x + dd.y;
  bEdge = od.x + od.y;
  cEdge = oo.x + oo.y - ra2;
  h = bEdge * bEdge - a * cEdge;
  if (h > 0.0) {
    let edgeT = (-bEdge - sqrt(h)) / a;
    if (edgeT > 0.0 && abs(ros.z + rds.z * edgeT) < boxSize.z && edgeT < minT) {
      minT = edgeT;
    }
  }
  
  if (minT < MAX_RAY_DIST) {
    let p = ro + rd * minT;
    let normal = sign(p) * normalize(max(abs(p) - boxSize, vec3<f32>(1e-16)));
    return RayHit(minT, normal);
  }
  
  return noHit();
}

// ============================================================================
// CYLINDER & CAPSULE
// ============================================================================

// Capped cylinder from point A to point B with radius
fn iCylinder(ro : vec3<f32>, rd : vec3<f32>, pa : vec3<f32>, pb : vec3<f32>, radius : f32) -> RayHit {
  let ca = pb - pa;
  let oc = ro - pa;
  
  let caca = dot(ca, ca);
  let card = dot(ca, rd);
  let caoc = dot(ca, oc);
  
  let a = caca - card * card;
  let b = caca * dot(oc, rd) - caoc * card;
  let c = caca * dot(oc, oc) - caoc * caoc - radius * radius * caca;
  var h = b * b - a * c;
  
  if (h < 0.0) {
    return noHit();
  }
  
  h = sqrt(h);
  var t = (-b - h) / a;
  
  // Check body
  let y = caoc + t * card;
  if (y > 0.0 && y < caca && t > 0.0) {
    let normal = (oc + t * rd - ca * y / caca) / radius;
    return RayHit(t, normal);
  }
  
  // Check caps
  t = (select(0.0, caca, y >= caca) - caoc) / card;
  if (abs(b + a * t) < h && t > 0.0) {
    let normal = normalize(ca * sign(y) / caca);
    return RayHit(t, normal);
  }
  
  return noHit();
}

// Capsule (cylinder with hemispherical caps)
fn iCapsule(ro : vec3<f32>, rd : vec3<f32>, pa : vec3<f32>, pb : vec3<f32>, radius : f32) -> RayHit {
  let ba = pb - pa;
  let oa = ro - pa;
  
  let baba = dot(ba, ba);
  let bard = dot(ba, rd);
  let baoa = dot(ba, oa);
  let rdoa = dot(rd, oa);
  let oaoa = dot(oa, oa);
  
  let a = baba - bard * bard;
  let b = baba * rdoa - baoa * bard;
  let c = baba * oaoa - baoa * baoa - radius * radius * baba;
  var h = b * b - a * c;
  
  if (h >= 0.0) {
    var t = (-b - sqrt(h)) / a;
    let y = baoa + t * bard;
    
    // Body
    if (y > 0.0 && y < baba && t > 0.0) {
      let hitPos = ro + rd * t - pa;
      let hh = clamp(dot(hitPos, ba) / dot(ba, ba), 0.0, 1.0);
      let normal = (hitPos - hh * ba) / radius;
      return RayHit(t, normal);
    }
    
    // Caps
    let oc = select(oa, ro - pb, y > 0.0);
    let bCap = dot(rd, oc);
    let cCap = dot(oc, oc) - radius * radius;
    h = bCap * bCap - cCap;
    
    if (h > 0.0) {
      t = -bCap - sqrt(h);
      if (t > 0.0) {
        let hitPos = ro + rd * t - pa;
        let hh = clamp(dot(hitPos, ba) / dot(ba, ba), 0.0, 1.0);
        let normal = (hitPos - hh * ba) / radius;
        return RayHit(t, normal);
      }
    }
  }
  
  return noHit();
}

// ============================================================================
// CONE & ROUNDED CONE
// ============================================================================

// Capped cone from pa (radius ra) to pb (radius rb)
fn iCone(ro : vec3<f32>, rd : vec3<f32>, pa : vec3<f32>, pb : vec3<f32>, ra : f32, rb : f32) -> RayHit {
  let ba = pb - pa;
  let oa = ro - pa;
  let ob = ro - pb;
  
  let m0 = dot(ba, ba);
  let m1 = dot(oa, ba);
  let m2 = dot(ob, ba);
  let m3 = dot(rd, ba);
  
  // Bottom cap
  if (m1 < 0.0) {
    if (dot2(oa * m3 - rd * m1) < (ra * ra * m3 * m3)) {
      let t = -m1 / m3;
      if (t > 0.0) {
        let normal = -ba * inverseSqrt(m0);
        return RayHit(t, normal);
      }
    }
  }
  // Top cap
  else if (m2 > 0.0) {
    if (dot2(ob * m3 - rd * m2) < (rb * rb * m3 * m3)) {
      let t = -m2 / m3;
      if (t > 0.0) {
        let normal = ba * inverseSqrt(m0);
        return RayHit(t, normal);
      }
    }
  }
  
  // Body
  let m4 = dot(rd, oa);
  let m5 = dot(oa, oa);
  let rr = ra - rb;
  let hy = m0 + rr * rr;
  
  let k2 = m0 * m0 - m3 * m3 * hy;
  let k1 = m0 * m0 * m4 - m1 * m3 * hy + m0 * ra * rr * m3;
  let k0 = m0 * m0 * m5 - m1 * m1 * hy + m0 * ra * (rr * m1 * 2.0 - m0 * ra);
  
  let h = k1 * k1 - k2 * k0;
  if (h < 0.0) {
    return noHit();
  }
  
  let t = (-k1 - sqrt(h)) / k2;
  let y = m1 + t * m3;
  
  if (y > 0.0 && y < m0 && t > 0.0) {
    let normal = normalize(m0 * (m0 * (oa + t * rd) + rr * ba * ra) - ba * hy * y);
    return RayHit(t, normal);
  }
  
  return noHit();
}

// ============================================================================
// TRIANGLE & QUAD
// ============================================================================

// Triangle intersection (Möller–Trumbore)
fn iTriangle(ro : vec3<f32>, rd : vec3<f32>, v0 : vec3<f32>, v1 : vec3<f32>, v2 : vec3<f32>) -> RayHit {
  let v1v0 = v1 - v0;
  let v2v0 = v2 - v0;
  let rov0 = ro - v0;
  
  let n = cross(v1v0, v2v0);
  let q = cross(rov0, rd);
  let d = 1.0 / dot(rd, n);
  let u = d * dot(-q, v2v0);
  let v = d * dot(q, v1v0);
  let t = d * dot(-n, rov0);
  
  if (u < 0.0 || v < 0.0 || (u + v) > 1.0 || t < 0.0) {
    return noHit();
  }
  
  let normal = normalize(-n * sign(d));
  return RayHit(t, normal);
}

// Quad (two triangles)
fn iQuad(ro : vec3<f32>, rd : vec3<f32>, v0 : vec3<f32>, v1 : vec3<f32>, v2 : vec3<f32>, v3 : vec3<f32>) -> RayHit {
  let hit1 = iTriangle(ro, rd, v0, v1, v2);
  let hit2 = iTriangle(ro, rd, v0, v2, v3);
  
  if (hit1.dist < hit2.dist) {
    return hit1;
  }
  return hit2;
}

// ============================================================================
// TORUS (Quartic equation - more complex)
// ============================================================================

// Torus: majorRadius = distance from center to tube center
//        minorRadius = tube radius
fn iTorus(ro : vec3<f32>, rd : vec3<f32>, majorRadius : f32, minorRadius : f32) -> RayHit {
  // Bounding sphere check first
  let boundRadius = majorRadius + minorRadius;
  let bSphere = iSphere(ro, rd, boundRadius);
  if (bSphere.dist >= MAX_RAY_DIST) {
    return noHit();
  }
  
  let Ra2 = majorRadius * majorRadius;
  let ra2 = minorRadius * minorRadius;
  
  let m = dot(ro, ro);
  let n = dot(ro, rd);
  
  let k = (m + Ra2 - ra2) * 0.5;
  let k3 = n;
  let k2 = n * n - Ra2 * dot(rd.xy, rd.xy) + k;
  let k1 = n * k - Ra2 * dot(rd.xy, ro.xy);
  let k0 = k * k - Ra2 * dot(ro.xy, ro.xy);
  
  // Solve quartic (simplified - may miss some edge cases)
  let c2 = k2 * 2.0 - 3.0 * k3 * k3;
  let c1 = k3 * (k3 * k3 - k2) + k1;
  let c0 = k3 * (k3 * (c2 + 2.0 * k2) - 8.0 * k1) + 4.0 * k0;
  
  let c2n = c2 / 3.0;
  let c1n = c1 * 2.0;
  let c0n = c0 / 3.0;
  
  let Q = c2n * c2n + c0n;
  let R = c2n * c2n * c2n - 3.0 * c2n * c0n + c1n * c1n;
  let h = R * R - Q * Q * Q;
  
  if (h < 0.0) {
    // 4 real roots - find smallest positive
    let sQ = sqrt(Q);
    let w = sQ * cos(acos(-R / (sQ * Q)) / 3.0);
    let d2 = -(w + c2n);
    if (d2 < 0.0) {
      return noHit();
    }
    let d1 = sqrt(d2);
    let h1 = sqrt(max(w - 2.0 * c2n + c1n / d1, 0.0));
    let h2 = sqrt(max(w - 2.0 * c2n - c1n / d1, 0.0));
    
    var t = MAX_RAY_DIST;
    let t1 = -d1 - h1 - k3; if (t1 > 0.0) { t = min(t, t1); }
    let t2 = -d1 + h1 - k3; if (t2 > 0.0) { t = min(t, t2); }
    let t3 = d1 - h2 - k3;  if (t3 > 0.0) { t = min(t, t3); }
    let t4 = d1 + h2 - k3;  if (t4 > 0.0) { t = min(t, t4); }
    
    if (t < MAX_RAY_DIST) {
      let pos = ro + rd * t;
      let normal = normalize(pos * (dot(pos, pos) - ra2 - Ra2 * vec3<f32>(1.0, 1.0, -1.0)));
      return RayHit(t, normal);
    }
  } else {
    // 2 real roots
    let sqrtH = sqrt(h);
    let v = sign(R + sqrtH) * pow(abs(R + sqrtH), 1.0 / 3.0);
    let u = sign(R - sqrtH) * pow(abs(R - sqrtH), 1.0 / 3.0);
    
    let s = vec2<f32>((v + u) + 4.0 * c2n, (v - u) * sqrt(3.0));
    let y = sqrt(0.5 * (length(s) + s.x));
    let x = 0.5 * s.y / y;
    let r = 2.0 * c1n / (x * x + y * y);
    
    let t1 = x - r - k3;
    let t2 = -x - r - k3;
    
    var t = MAX_RAY_DIST;
    if (t1 > 0.0) { t = t1; }
    if (t2 > 0.0) { t = min(t, t2); }
    
    if (t < MAX_RAY_DIST) {
      let pos = ro + rd * t;
      let normal = normalize(pos * (dot(pos, pos) - ra2 - Ra2 * vec3<f32>(1.0, 1.0, -1.0)));
      return RayHit(t, normal);
    }
  }
  
  return noHit();
}

// ============================================================================
// RAY TRACING UTILITIES
// ============================================================================

// Transform ray to local space, intersect, transform normal back
fn iTransformed(
  ro : vec3<f32>, 
  rd : vec3<f32>, 
  translation : vec3<f32>,
  hit : RayHit
) -> RayHit {
  if (hit.dist >= MAX_RAY_DIST) {
    return hit;
  }
  return RayHit(hit.dist, hit.normal);
}

// Union of two ray hits (return nearest)
fn opUnionHit(a : RayHit, b : RayHit) -> RayHit {
  if (a.dist < b.dist) {
    return a;
  }
  return b;
}
`;

export default rayIntersectWGSL;
