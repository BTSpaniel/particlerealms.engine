// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { particleStructsWGSL } from "./particles_shared.js";
import {
  LEGACY_PARTICLE_VERTEX_QUALITY_PCG_WGSL,
  LEGACY_PCG32_WGSL,
} from '../../../../core/math/MathBits.js';

/**
 * ============================================================================
 * PARTICLE BILLBOARD VERTEX SHADER
 * ============================================================================
 * 
 * This shader renders particles as SCREEN-ALIGNED quads (always face camera).
 * 
 * HOW IT WORKS:
 *   1. Each particle is rendered as 6 vertices (2 triangles = 1 quad)
 *   2. The particle center is transformed to CLIP SPACE first
 *   3. Screen-space offsets are added to create a quad that always faces the camera
 *   4. Per-particle data (color, size, shape) is read from the meta buffer
 * 
 * INPUTS (from GPU buffers):
 *   - uPositions[ii]: vec4 containing [x, y, z, age]
 *   - uMeta[ii]: vec4 containing [r, g, b, packed_size_shape]
 *   - uVelocities[ii]: vec4 containing [vx, vy, vz, lifetime]
 *   - uParams: Default fallback values
 * 
 * OUTPUTS (to fragment shader):
 *   - position: Clip-space position for rasterization
 *   - color: RGBA color from emitter
 *   - localPos: Normalized quad coordinates (-1 to 1) for shape rendering
 *   - age: Particle age for lifetime effects
 *   - shape: Shape type (0=sphere, 1=point, 2=soft, 3=spark)
 *   - lifetime: Per-particle lifetime from emitter
 * 
 * SIZE/SHAPE/BEHAVIOR ENCODING:
 *   The meta.w value packs size, renderMode, shape, and behavior:
 *   meta.w = size * 1000 + renderMode * 100 + shape * 10 + behavior
 *   - size: 0-65 (floor(meta.w / 1000))
 *   - renderMode: 0-9 (floor(meta.w / 100) % 10)
 *   - shape: 0-9 (floor(meta.w / 10) % 10)
 *   - behavior: 0-9 (meta.w % 10)
 *   Example: 4302 = size 4, renderMode 3, shape 0, behavior 2
 */
export const particlesBillboardVertexWGSL = /* wgsl */`

${LEGACY_PCG32_WGSL}
${LEGACY_PARTICLE_VERTEX_QUALITY_PCG_WGSL}
${particleStructsWGSL}

@vertex
fn vs_main(@builtin(vertex_index) vi : u32, @builtin(instance_index) ii : u32) -> VSOut {
  // GAP 18: alive list indirection — instance_index maps into compact alive list
  // aliveList[ii] gives the actual particle slot; if aliveList is empty, fall back to direct index
  let slot = uAliveList[ii];

  let pos4 = uPositions[slot];
  let center = pos4.xyz;
  let age = pos4.w;
  
  // Get per-particle lifetime from velocity buffer (set by emitter)
  let vel4 = uVelocities[slot];
  let lifetime = max(vel4.w, 0.1); // Prevent division by zero
  
  // Per-particle metadata: [r, g, b, packed physics+rendering data]
  // Pack format: mass * 1e8 + drag * 1e6 + size * 1e4 + renderMode * 1e3 + shape * 10 + behavior
  let particleMeta = uMeta[slot];
  let particleColor = particleMeta.rgb;
  let packedValue = select(uParams.defaultSize * 1e5, particleMeta.w, particleMeta.w > 0.001);
  // Extract size, shape, renderMode from packed value (mass/drag handled by compute shader)
  let particleSize = (floor(packedValue / 1e4) % 100.0) * 0.1;  // Size is in 1e4 position, 0-99, decoded to 0.0-9.9
  let renderMode = floor(packedValue / 1e3) % 10.0;     // RenderMode is in 1e3 position, 0-9
  let particleShape = floor(packedValue / 10.0) % 10.0; // Shape is in 10s position, 0-9
  // behavior at position 1s - handled by compute shader

  // Quad corner offsets (normalized -1 to 1)
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
  );

  // Normalized time through particle's life (0 = birth, 1 = death)
  let t = clamp(age / lifetime, 0.0, 1.0);
  
  // Size animation: grow in quickly, stay mostly constant, shrink only near the end
  let fadeIn = smoothstep(0.0, 0.08, t);
  // Start shrinking around 90% of lifetime so visual duration matches lifetime closely
  let fadeOut = 1.0 - smoothstep(0.9, 1.0, t);
  let sizeFactor = fadeIn * fadeOut * 0.9 + 0.1;
  
  // Hide dead particles by setting size to 0
  let isDead = select(1.0, 0.0, age >= lifetime);
  
  // Get velocity for motion stretching
  let velocity = vel4.xyz;
  let speed = length(velocity);
  
  // Get corner offset for this vertex
  var corner = corners[vi % 6u];
  
  // Get camera basis vectors for world-space billboarding
  let viewRight = uFrame.viewRight;
  let viewUp = uFrame.viewUp;
  
  // We'll compute world-space offset after calculating radius
  // Transform particle center to clip space for culling checks
  let clipPos = uFrame.viewProj * vec4<f32>(center, 1.0);
  
  // ===== FRUSTUM CULLING =====
  // Skip particles outside camera view (saves fragment shader work)
  // Use margin of 1.3 to account for particle size and prevent popping
  // NOTE: Far plane check removed - let GPU handle clipping for infinite distance
  let frustumMargin = 1.3;
  let outsideFrustum = 
    clipPos.w <= 0.0 ||                                    // Behind camera
    abs(clipPos.x) > clipPos.w * frustumMargin ||          // Outside left/right
    abs(clipPos.y) > clipPos.w * frustumMargin;            // Outside top/bottom
  
  // If outside frustum, we'll set radius to 0 later (no fragments generated)
  let frustumCull = select(1.0, 0.0, outsideFrustum);
  
  // Velocity stretching: elongate particle along velocity direction
  // stretchFactor > 0 enables proportional stretch, 0 = disabled
  let stretchFactor = uParams.stretchFactor;
  if (speed > 0.5 && stretchFactor > 0.001) {
    // World-space velocity-aligned stretch
    let stretchAmount = clamp(speed * stretchFactor * 0.1, 0.0, 3.0);
    // Project velocity to screen space for billboard stretch
    let velClip = uFrame.viewProj * vec4<f32>(velocity, 0.0);
    let velScreen = normalize(vec2<f32>(velClip.x, velClip.y));
    let cornerDot = dot(corner, velScreen);
    corner = corner + velScreen * cornerDot * stretchAmount;
  } else if (speed > 0.5 && stretchFactor < -0.001) {
    // Legacy screen-space stretch (negative stretchFactor = old behavior)
    let velClip = uFrame.viewProj * vec4<f32>(velocity, 0.0);
    let velScreen = normalize(vec2<f32>(velClip.x, velClip.y));
    let stretchAmount = clamp(speed * 0.1, 0.0, 0.8);
    let cornerDot = dot(corner, velScreen);
    corner = corner + velScreen * cornerDot * stretchAmount;
  }
  
  // ===== DYNAMIC QUALITY SYSTEM =====
  // quality: 0.0 = emergency mode (cull aggressively), 1.0 = full quality
  // cullThreshold: max instance index to render (0 = no limit)
  let quality = uParams.quality;
  let lodBias = uParams.lodBias;
  let cullThreshold = uParams.cullThreshold;
  
  // Emergency culling: skip particles beyond threshold when FPS is tanking
  // This is the nuclear option - just don't render late particles
  let emergencyCull = select(1.0, 0.0, cullThreshold > 0.0 && f32(ii) > cullThreshold);
  
  // Quality-based FADE (not cull!) - smoothly reduce alpha instead of popping
  // Use instance index + particle position as cheap pseudo-random
  // This prevents jarring pop-in/out when quality fluctuates
  let pseudoRandom = legacyParticleVertexQualityRandomFloat01(ii, bitcast<u32>(center.x));
  // Fade particles smoothly based on quality - no hard culling
  // At quality 1.0: all particles full opacity
  // At quality 0.5: particles with pseudoRandom > 0.5 start fading
  let qualityFade = select(1.0, smoothstep(quality - 0.1, quality + 0.1, pseudoRandom), quality < 0.95);
  let stochasticCull = 1.0; // Never hard-cull, use qualityFade for smooth transition
  
  // Cull invalid particles: extreme positions or NaN values (artifacts from bad interpolation)
  let isInvalidPos = abs(center.x) > 1e9 || abs(center.y) > 1e9 || abs(center.z) > 1e9;
  let isNaN = center.x != center.x || center.y != center.y || center.z != center.z || age != age;
  let invalidCull = select(1.0, 0.0, isInvalidPos || isNaN);
  
  // Near-camera fade using clip W (proportional to view distance)
  // Small W = close to camera, large W = far away
  // Particles start fading at W < 2, fully gone at W < 0.5
  let nearFade = smoothstep(0.5, 2.0, clipPos.w);
  
  // ===== DISTANCE-BASED LOD =====
  // Note: Proper LOD reduces particle COUNT, not size. Perspective handles size naturally.
  // We keep distanceLod = 1.0 for correct world-space sizing.
  let distanceLod = 1.0;
  
  // No artificial screen-size limiting - let perspective handle sizing naturally
  let screenSizeLimit = 1.0;
  
  // ===== DEPTH-BASED OCCLUSION CULLING =====
  // Skip rendering particles that are likely obscured by closer particles.
  // For soft/fog shapes that overlap heavily, aggressively cull back particles.
  let isSoftShape = (particleShape == 2.0 || particleShape == 7.0);
  
  // Compute a "depth rank" based on clip Z (0 = near, 1 = far)
  let depthRank = clamp(clipPos.z / clipPos.w, 0.0, 1.0);
  
  // Occlusion fade disabled - render all particles at full opacity regardless of depth
  var occlusionFade = 1.0;
  
  // ===== COMBINE ALL CULLING FACTORS =====
  // Particle radius from per-particle size with all culling factors
  let baseRadius = particleSize * sizeFactor * 0.5 * isDead;  // 0.5 = world units scale
  let qualityCulling = emergencyCull * stochasticCull * invalidCull;
  let radius = baseRadius * nearFade * screenSizeLimit * occlusionFade * frustumCull * distanceLod * qualityCulling;
  
  // ===== UV DATA + PER-PARTICLE ROTATION =====
  // Read UV data early — needed for rotation angle and opacity
  let uv4 = uUVs[slot];
  let particleOpacity = select(0.85, clamp(uv4.z, 0.0, 1.0), uv4.z > 0.0001);
  // uv.w stores initial rotation angle (set at emit time, random per particle)
  // rotationRate from params adds animated spin over lifetime
  let initialRotation = uv4.w;
  let particleRotation = initialRotation + age * uParams.rotationRate;
  let cosR = cos(particleRotation);
  let sinR = sin(particleRotation);
  let rotatedCorner = vec2<f32>(
    corner.x * cosR - corner.y * sinR,
    corner.x * sinR + corner.y * cosR
  );
  
  // ===== WORLD-SPACE BILLBOARDING (with facing mode support) =====
  // facingMode: 0=screen-aligned, 1=velocity-aligned, 2=world-Y-axis, 3=horizontal-only
  var billRight = viewRight;
  var billUp = viewUp;
  let fm = i32(uParams.facingMode + 0.5);
  if (fm == 1 && speed > 0.5) {
    // Velocity-aligned: long axis follows velocity direction in world space
    let velDir = normalize(velocity);
    let camFwd = normalize(cross(viewRight, viewUp));
    billRight = normalize(cross(velDir, camFwd));
    billUp = velDir;
  } else if (fm == 2) {
    // World-Y-axis: always upright, rotate around Y to face camera
    billUp = vec3<f32>(0.0, 1.0, 0.0);
    let camFwd = normalize(cross(viewRight, viewUp));
    billRight = normalize(cross(billUp, camFwd));
  } else if (fm == 3) {
    // Horizontal-only: flat on ground plane, face camera from above
    billRight = viewRight;
    billUp = vec3<f32>(0.0, 0.0, -1.0); // Lay flat pointing forward
    let camFwd = normalize(cross(viewRight, viewUp));
    billRight = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), camFwd));
    billUp = normalize(cross(camFwd, billRight));
  }
  // Mode 0 (default): use viewRight/viewUp as-is (screen-aligned)

  let worldOffset = billRight * rotatedCorner.x * radius + billUp * rotatedCorner.y * radius;
  let worldPos = center + worldOffset;
  
  // Transform offset world position to clip space
  var finalClip = uFrame.viewProj * vec4<f32>(worldPos, 1.0);

  var out : VSOut;
  out.position = finalClip;
  // Pass through original color unchanged - texture sampling will handle final color
  // Apply quality fade to alpha for smooth quality transitions (no popping)
  out.color = vec4<f32>(particleColor, particleOpacity * qualityFade);
  out.localPos = vec3<f32>(corner, 0.0); // Pass normalized corner for sphere shading
  out.age = age;
  out.shape = particleShape;
  out.lifetime = lifetime;
  out.renderMode = renderMode;
  out.uv = uv4.xy;
  out.worldY = worldPos.y;  // Pass world Y for ground clipping
  out.viewDepth = finalClip.w;  // View-space depth (distance from camera) for near-fade
  return out;
}
`;
