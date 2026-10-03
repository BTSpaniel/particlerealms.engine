// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { mathCommonWGSL } from "../chunks/math_common.js";

const volumeIsoSurfaceCoreWGSL = /* wgsl */`
struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

struct FrameData {
  viewProj    : mat4x4<f32>,
  invViewProj : mat4x4<f32>,
  cameraPos   : vec3<f32>,
  time        : f32,
  volumeMin   : vec3<f32>,
  isoThreshold : f32,
  volumeMax   : vec3<f32>,
  fillBlend   : f32,
};

struct GridData {
  resolution : vec3<f32>,
  _pad0      : f32,
};

@group(0) @binding(0) var<uniform> frame : FrameData;
@group(1) @binding(0) var<storage, read> densityField : array<f32>;
@group(1) @binding(1) var<storage, read> colorField : array<vec4<f32>>;
@group(1) @binding(2) var<uniform> grid : GridData;
@group(2) @binding(0) var sceneDepth : texture_depth_2d;

const MAX_STEPS : u32 = 128u;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VSOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  var out : VSOut;
  out.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  out.uv = pos[vertexIndex] * 0.5 + 0.5;
  return out;
}

fn intersectBox(ro : vec3<f32>, rd : vec3<f32>, boxMin : vec3<f32>, boxMax : vec3<f32>) -> vec2<f32> {
  let eps = 0.0001;
  let invRd = vec3<f32>(
    select(1.0 / rd.x, 1e10 * sign(rd.x + eps), abs(rd.x) < eps),
    select(1.0 / rd.y, 1e10 * sign(rd.y + eps), abs(rd.y) < eps),
    select(1.0 / rd.z, 1e10 * sign(rd.z + eps), abs(rd.z) < eps)
  );
  let t0 = (boxMin - ro) * invRd;
  let t1 = (boxMax - ro) * invRd;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let tNear = max(max(tmin.x, tmin.y), tmin.z);
  let tFar = min(min(tmax.x, tmax.y), tmax.z);
  return vec2<f32>(max(tNear, 0.0), tFar);
}

fn sampleDensityRaw(cellCoord : vec3<i32>) -> f32 {
  let res = vec3<i32>(grid.resolution);
  let c = clamp(cellCoord, vec3<i32>(0), res - 1);
  let idx = c.z * res.x * res.y + c.y * res.x + c.x;
  if (u32(idx) >= arrayLength(&densityField)) {
    return 0.0;
  }
  return densityField[idx];
}

fn sampleDensity(worldPos : vec3<f32>) -> f32 {
  let volumeSize = frame.volumeMax - frame.volumeMin;
  let normalized = (worldPos - frame.volumeMin) / volumeSize;
  if (any(normalized < vec3<f32>(0.0)) || any(normalized > vec3<f32>(1.0))) {
    return 0.0;
  }
  let gridPos = normalized * grid.resolution - 0.5;
  let cellMin = vec3<i32>(floor(gridPos));
  let f = fract(gridPos);

  let d000 = sampleDensityRaw(cellMin + vec3<i32>(0, 0, 0));
  let d100 = sampleDensityRaw(cellMin + vec3<i32>(1, 0, 0));
  let d010 = sampleDensityRaw(cellMin + vec3<i32>(0, 1, 0));
  let d110 = sampleDensityRaw(cellMin + vec3<i32>(1, 1, 0));
  let d001 = sampleDensityRaw(cellMin + vec3<i32>(0, 0, 1));
  let d101 = sampleDensityRaw(cellMin + vec3<i32>(1, 0, 1));
  let d011 = sampleDensityRaw(cellMin + vec3<i32>(0, 1, 1));
  let d111 = sampleDensityRaw(cellMin + vec3<i32>(1, 1, 1));

  let d00 = mix(d000, d100, f.x);
  let d10 = mix(d010, d110, f.x);
  let d01 = mix(d001, d101, f.x);
  let d11 = mix(d011, d111, f.x);

  let d0 = mix(d00, d10, f.y);
  let d1 = mix(d01, d11, f.y);

  return mix(d0, d1, f.z);
}

fn sampleColorRaw(cellCoord : vec3<i32>) -> vec4<f32> {
  let res = vec3<i32>(grid.resolution);
  let c = clamp(cellCoord, vec3<i32>(0), res - 1);
  let idx = c.z * res.x * res.y + c.y * res.x + c.x;
  if (u32(idx) >= arrayLength(&colorField)) {
    return vec4<f32>(0.0);
  }
  return colorField[idx];
}

fn sampleColor(worldPos : vec3<f32>) -> vec3<f32> {
  let volumeSize = frame.volumeMax - frame.volumeMin;
  let normalized = (worldPos - frame.volumeMin) / volumeSize;
  if (any(normalized < vec3<f32>(0.0)) || any(normalized > vec3<f32>(1.0))) {
    return vec3<f32>(1.0);
  }
  let gridPos = normalized * grid.resolution - 0.5;
  let cellMin = vec3<i32>(floor(gridPos));
  let f = fract(gridPos);

  let c000 = sampleColorRaw(cellMin + vec3<i32>(0, 0, 0));
  let c100 = sampleColorRaw(cellMin + vec3<i32>(1, 0, 0));
  let c010 = sampleColorRaw(cellMin + vec3<i32>(0, 1, 0));
  let c110 = sampleColorRaw(cellMin + vec3<i32>(1, 1, 0));
  let c001 = sampleColorRaw(cellMin + vec3<i32>(0, 0, 1));
  let c101 = sampleColorRaw(cellMin + vec3<i32>(1, 0, 1));
  let c011 = sampleColorRaw(cellMin + vec3<i32>(0, 1, 1));
  let c111 = sampleColorRaw(cellMin + vec3<i32>(1, 1, 1));

  let c00 = mix(c000, c100, f.x);
  let c10 = mix(c010, c110, f.x);
  let c01 = mix(c001, c101, f.x);
  let c11 = mix(c011, c111, f.x);

  let c0 = mix(c00, c10, f.y);
  let c1 = mix(c01, c11, f.y);

  let c = mix(c0, c1, f.z);
  let weight = c.a;
  if (weight < 0.001) {
    return vec3<f32>(1.0);
  }
  return c.rgb / weight;
}

fn estimateNormal(worldPos : vec3<f32>) -> vec3<f32> {
  let cellSize = (frame.volumeMax - frame.volumeMin) / grid.resolution;
  let eps = max(0.25 * min(min(cellSize.x, cellSize.y), cellSize.z), 1e-4);
  let dx = sampleDensity(worldPos + vec3<f32>(eps, 0.0, 0.0)) - sampleDensity(worldPos - vec3<f32>(eps, 0.0, 0.0));
  let dy = sampleDensity(worldPos + vec3<f32>(0.0, eps, 0.0)) - sampleDensity(worldPos - vec3<f32>(0.0, eps, 0.0));
  let dz = sampleDensity(worldPos + vec3<f32>(0.0, 0.0, eps)) - sampleDensity(worldPos - vec3<f32>(0.0, 0.0, eps));
  return normalize(vec3<f32>(dx, dy, dz));
}

fn shadeSurface(worldPos : vec3<f32>, normal : vec3<f32>, viewDir : vec3<f32>) -> vec3<f32> {
  let baseColor = sampleColor(worldPos);
  let sunDir = normalize(vec3<f32>(0.4, 1.0, 0.2));
  let diff = max(dot(normal, sunDir), 0.0);
  let halfV = normalize(sunDir - viewDir);
  let spec = pow(max(dot(normal, halfV), 0.0), 32.0);
  let ambient = 0.25;
  return baseColor * (ambient + diff) + vec3<f32>(spec * 0.15);
}

fn integrateVolume(ro : vec3<f32>, rd : vec3<f32>, tMin : f32, tMax : f32) -> vec4<f32> {
  let dt = (tMax - tMin) / f32(MAX_STEPS);
  var t = tMin;
  var trans = 1.0;
  var col = vec3<f32>(0.0);
  for (var i = 0u; i < MAX_STEPS; i = i + 1u) {
    if (t >= tMax || trans < 0.01) {
      break;
    }
    let p = ro + rd * t;
    let d = sampleDensity(p);
    if (d > 0.001) {
      let c = sampleColor(p);
      let a = 1.0 - exp(-d * dt * 2.0);
      col = col + c * a * trans;
      trans = trans * (1.0 - a);
    }
    t = t + dt;
  }
  return vec4<f32>(col, 1.0 - trans);
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  let ndcX = input.uv.x * 2.0 - 1.0;
  let ndcY = input.uv.y * 2.0 - 1.0;

  let clipFar = vec4<f32>(ndcX, ndcY, 1.0, 1.0);
  var worldFar = frame.invViewProj * clipFar;
  worldFar = worldFar / worldFar.w;

  let ro = frame.cameraPos;
  let rd = normalize(worldFar.xyz - ro);

  let hit = intersectBox(ro, rd, frame.volumeMin, frame.volumeMax);
  var tMin = hit.x;
  var tMax = hit.y;

  if (tMax <= tMin) {
    return vec4<f32>(0.0);
  }

  let pixelCoord = vec2<i32>(i32(input.position.x), i32(input.position.y));
  let depth = textureLoad(sceneDepth, pixelCoord, 0);
  if (depth > 0.0 && depth < 1.0) {
    let clipZ = depth;
    let clipDepth = vec4<f32>(ndcX, ndcY, clipZ, 1.0);
    var worldDepth = frame.invViewProj * clipDepth;
    worldDepth = worldDepth / worldDepth.w;
    let tDepth = dot(worldDepth.xyz - ro, rd);
    tMax = min(tMax, tDepth);
  }

  if (tMax <= tMin) {
    return vec4<f32>(0.0);
  }

  let threshold = frame.isoThreshold;
  let dt = (tMax - tMin) / f32(MAX_STEPS);

  var t = tMin;
  var prevD = sampleDensity(ro + rd * t);
  var found = false;
  var tHit = t;

  for (var i = 0u; i < MAX_STEPS; i = i + 1u) {
    if (t >= tMax) {
      break;
    }
    t = t + dt;
    let d = sampleDensity(ro + rd * t);
    if (prevD < threshold && d >= threshold) {
      found = true;
      tHit = t;
      break;
    }
    prevD = d;
  }

  if (!found) {
    if (frame.fillBlend > 0.001) {
      return integrateVolume(ro, rd, tMin, tMax);
    }
    return vec4<f32>(0.0);
  }

  var tLo = max(tMin, tHit - dt);
  var tHi = tHit;
  for (var j = 0u; j < 5u; j = j + 1u) {
    let tm = 0.5 * (tLo + tHi);
    let dm = sampleDensity(ro + rd * tm);
    if (dm >= threshold) {
      tHi = tm;
    } else {
      tLo = tm;
    }
  }

  let pHit = ro + rd * tHi;
  let n = estimateNormal(pHit);
  let surfaceColor = shadeSurface(pHit, n, rd);
  let surface = vec4<f32>(surfaceColor, 1.0);

  if (frame.fillBlend > 0.001) {
    let vol = integrateVolume(ro, rd, tMin, tMax);
    return mix(surface, vol, clamp(frame.fillBlend, 0.0, 1.0));
  }

  return surface;
}
`;

export const volumeIsoSurfaceWGSL = mathCommonWGSL + volumeIsoSurfaceCoreWGSL;
