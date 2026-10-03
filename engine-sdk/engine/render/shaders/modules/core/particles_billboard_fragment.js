// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ============================================================================
 * PARTICLE FRAGMENT SHADER - PER-PARTICLE SHAPE RENDERING
 * ============================================================================
 * 
 * This shader renders each particle according to its emitter's shape setting.
 * The shape type is passed from the vertex shader (extracted from meta buffer).
 * 
 * SHAPE TYPES:
 * 
 *   0 = SPHERE
 *       - 3D shaded ball with fake diffuse lighting
 *       - Hard circle cutoff (no square corners)
 *       - Calculates fake Z depth for sphere surface
 *       - Applies directional light from upper-right
 *       - Best for: fire, water drops, magic orbs
 * 
 *   1 = POINT
 *       - Tiny bright dot with small radius
 *       - Extra bright center for visibility
 *       - Discards most of the quad for small appearance
 *       - Best for: sparks, stars, snow, dust
 * 
 *   2 = SOFT
 *       - Organic smoke/cloud shape with noise-distorted edges
 *       - Uses FBM noise to break circular silhouette
 *       - Wispy tendrils and irregular boundaries
 *       - Best for: smoke, fog, clouds, magic auras
 * 
 *   3 = SPARK
 *       - Star/cross shape with 4 points
 *       - Creates X pattern with bright center
 *       - Good for emphasis and magical effects
 *       - Best for: magic sparks, highlights, flares
 * 
 * INPUTS (from vertex shader):
 *   - localPos.xy: Normalized position within quad (-1 to 1)
 *   - color: RGBA from emitter
 *   - age: Particle age for lifetime fading
 *   - shape: Shape type (0-3)
 * 
 * OUTPUT:
 *   - Final RGBA color with alpha for blending
 */
export const particlesBillboardFragmentWGSL = /* wgsl */`
// ============================================================================
// NOISE FUNCTIONS FOR ORGANIC SMOKE SHAPE
// ============================================================================

// Fast 2D hash for noise generation
fn smokeHash2d(p: vec2<f32>) -> f32 {
  let k = vec2<f32>(0.3183099, 0.3678794);
  let q = p * k + k.yx;
  return fract(16.0 * k.x * fract(q.x * q.y * (q.x + q.y)));
}

// Value noise with smooth interpolation
fn smokeValueNoise2d(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  // Quintic interpolation for smoother result
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  
  let a = smokeHash2d(i + vec2<f32>(0.0, 0.0));
  let b = smokeHash2d(i + vec2<f32>(1.0, 0.0));
  let c = smokeHash2d(i + vec2<f32>(0.0, 1.0));
  let d = smokeHash2d(i + vec2<f32>(1.0, 1.0));
  
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// FBM (Fractal Brownian Motion) for organic patterns
fn smokeFbm2d(p: vec2<f32>, octaves: i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  var pos = p;
  
  for (var i = 0; i < octaves; i = i + 1) {
    value = value + amplitude * smokeValueNoise2d(pos * frequency);
    amplitude = amplitude * 0.5;
    frequency = frequency * 2.0;
    // Rotate each octave slightly to reduce axis-aligned artifacts
    pos = vec2<f32>(pos.x * 0.866 - pos.y * 0.5, pos.x * 0.5 + pos.y * 0.866);
  }
  return value;
}

// Ridged noise for wispy tendrils
fn smokeRidgedNoise2d(p: vec2<f32>) -> f32 {
  return 1.0 - abs(smokeValueNoise2d(p) * 2.0 - 1.0);
}

// Curl noise from value noise gradient for turbulent flow
fn smokeCurl2d(p: vec2<f32>) -> vec2<f32> {
  let e = 0.12;
  let n1 = smokeValueNoise2d(p + vec2<f32>(0.0, e));
  let n2 = smokeValueNoise2d(p + vec2<f32>(0.0, -e));
  let n3 = smokeValueNoise2d(p + vec2<f32>(e, 0.0));
  let n4 = smokeValueNoise2d(p + vec2<f32>(-e, 0.0));
  let dx = n1 - n2;
  let dy = n3 - n4;
  let curl = vec2<f32>(dx, -dy);
  let len = max(length(curl), 0.001);
  return curl / len;
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  // ===== NEAR-PLANE FADE (fly-through fix) =====
  // Fade particles as camera gets very close to avoid pop-in/clipping artifacts
  // viewDepth is the view-space distance from camera
  let nearFadeStart = 0.5;  // Start fading at 0.5 units from camera
  let nearFadeEnd = 2.0;    // Fully visible at 2.0 units
  let nearFade = smoothstep(nearFadeStart, nearFadeEnd, input.viewDepth);
  
  // ===== GROUND FEATHERING =====
  // Smoothly fade particles near ground instead of hard cutoff
  // Discard only well below ground, fade in the transition zone
  let groundFade = smoothstep(-0.5, 1.5, input.worldY);
  if (input.worldY < -0.5) {
    discard;
  }
  
  let dist = length(input.localPos.xy);
  let shape = i32(input.shape + 0.5); // Round to nearest int
  let rm = i32(input.renderMode + 0.5);
  
  // Use per-particle lifetime from emitter
  let lifetime = max(input.lifetime, 0.1);
  let t = clamp(input.age / lifetime, 0.0, 1.0);
  
  // Discard dead particles strictly at end of life
  let isSolid = select(0.0, 1.0, rm == 2 || rm == 4);
  if (isSolid < 0.5 && t >= 1.0) {
    discard;
  }
  
  // Fade in quickly, then keep most of the brightness until near the end
  let fadeIn = smoothstep(0.0, 0.05, t);
  // Start fading only over the last 10% of lifetime
  let fadeOut = 1.0 - smoothstep(0.9, 1.0, t);
  let fadeInAge = smoothstep(0.0, 0.12, input.age);
  let lifeMask = mix(fadeIn * fadeOut, fadeInAge, isSolid);

  var color = input.color.rgb;
  var alpha = input.color.a * lifeMask;

  // ===== COLOR GRADIENT LUT =====
  // When enabled, sample albedo texture as 1D color ramp (Niagara/PopcornFX parity)
  // t maps to U coordinate, gradient provides RGBA (overrides vertex color + alpha)
  if (uParams.useColorGradient > 0.5) {
    let gradSample = textureSampleLevel(uAlbedoTex, uAlbedoSampler, vec2<f32>(t, 0.5), 0.0);
    color = gradSample.rgb;
    alpha = gradSample.a * lifeMask;
  }

  // ========== SHAPE 0: SPHERE (3D shaded ball) ==========
  if (shape == 0) {
    if (dist > 1.0) { discard; }
    let z = sqrt(1.0 - dist * dist);
    let lightDir = normalize(-uFrame.sunDir);
    let normal = vec3<f32>(input.localPos.xy, z);
    // Wrap lighting: softer falloff for translucent spheres
    let wrapDiffuse = dot(normal, lightDir) * 0.5 + 0.5;
    let sunContrib = uFrame.sunColor * uFrame.sunIntensity * wrapDiffuse;
    let ambContrib = uFrame.ambientColor * uFrame.ambientIntensity;
    let lighting = sunContrib + ambContrib;
    let glow = 1.0 + (1.0 - dist) * 0.5;
    color = color * lighting * glow;
    alpha = alpha * (1.0 - smoothstep(0.8, 1.0, dist));
  }
  // ========== SHAPE 1: POINT (tiny bright dot) ==========
  else if (shape == 1) {
    if (dist > 0.5) { discard; }
    let intensity = 1.0 - smoothstep(0.0, 0.5, dist);
    color = color * (1.0 + intensity * 2.0); // Extra bright center
    alpha = alpha * intensity;
  }
  // ========== SHAPE 2: SOFT / SMOKE (Organic noise-distorted edges) ==========
  // Uses FBM noise to create wispy, natural-looking smoke instead of perfect circles
  // The noise distorts the distance field to create irregular organic boundaries
  else if (shape == 2) {
    // Create unique seed per particle using age and position for variation
    let seed = input.age * 0.3 + input.worldY * 0.7;
    let baseCoord = input.localPos.xy * 2.5 + vec2<f32>(seed, seed * 0.7);
    let curl = smokeCurl2d(baseCoord * 0.8) * 0.35;
    let noiseCoord = baseCoord + curl;
    
    // Multi-octave noise for organic edge distortion
    let edgeNoise = smokeFbm2d(noiseCoord, 3) * 2.0 - 1.0;  // -1 to 1 range
    
    // Ridged noise creates wispy tendril patterns
    let wispNoise = smokeRidgedNoise2d(noiseCoord * 1.5 + vec2<f32>(seed * 0.5, 0.0));
    
    // Combine noises: edge distortion + wispy tendrils
    let noiseDistortion = edgeNoise * 0.35 + wispNoise * 0.15;
    
    // Distort the distance from center using noise
    // This breaks the circular silhouette into organic shapes
    let angle = atan2(input.localPos.y, input.localPos.x);
    let angularNoise = smokeFbm2d(vec2<f32>(angle * 2.0 + seed, dist * 3.0), 2);
    let distortedDist = dist + noiseDistortion + (angularNoise - 0.5) * 0.25;
    
    // Soft density falloff with noise-distorted boundary
    let density = 1.0 - smoothstep(0.0, 1.0, distortedDist);
    let detail = smokeFbm2d(noiseCoord * 3.2, 3);
    let layeredDensity = clamp(density * (0.7 + detail * 0.6), 0.0, 1.0);
    
    // Create wispy edges that fade out irregularly
    let wispyEdge = smoothstep(0.6, 1.0, distortedDist);
    let wispDensity = layeredDensity * (1.0 - wispyEdge * 0.5);
    
    // Apply smoothstep for organic blob feel
    let blobDensity = wispDensity * wispDensity * (3.0 - 2.0 * wispDensity);
    
    // Subtle internal detail variation for depth
    let internalNoise = smokeFbm2d(input.localPos.xy * 4.0 + vec2<f32>(seed * 2.0, 0.0), 2);
    let scattering = blobDensity * (0.25 + 0.35 * (1.0 - distortedDist)) + internalNoise * 0.08;
    let scatterColor = vec3<f32>(0.9, 0.88, 0.82);
    color = color * (0.85 + blobDensity * 0.4 + internalNoise * 0.15) + scatterColor * scattering * 0.15;
    
    // Alpha with organic falloff - softer edges blend naturally
    alpha = alpha * blobDensity * (0.35 + scattering * 0.15);
    
    // Discard fully transparent fragments for performance
    if (alpha < 0.001) { discard; }
  }
  // ========== SHAPE 3: SPARK (star/cross shape) ==========
  else if (shape == 3) {
    let ax = abs(input.localPos.x);
    let ay = abs(input.localPos.y);
    let cross = min(ax, ay);
    let sparkMask = 1.0 - smoothstep(0.0, 0.3, cross);
    if (dist > 1.0 && sparkMask < 0.1) { discard; }
    color = color * (1.0 + sparkMask * 2.0);
    alpha = alpha * max(sparkMask, 1.0 - smoothstep(0.0, 0.3, dist));
  }
  // ========== SHAPE 4: RING (hollow circle) ==========
  else if (shape == 4) {
    let inner = 0.4;
    let outer = 0.8;
    let innerMask = 1.0 - smoothstep(inner - 0.05, inner + 0.05, dist);
    let outerMask = smoothstep(outer - 0.05, outer + 0.05, dist);
    let ringMask = innerMask * outerMask;
    if (ringMask < 0.01) { discard; }
    color = color * (1.0 + ringMask);
    alpha = alpha * ringMask;
  }
  // ========== SHAPE 5: BEAM (vertical light column) ==========
  else if (shape == 5) {
    let ax = abs(input.localPos.x);
    let beamMask = 1.0 - smoothstep(0.0, 0.3, ax);
    if (dist > 1.2 && beamMask < 0.05) { discard; }
    color = color * (1.0 + beamMask * 1.5);
    alpha = alpha * beamMask;
  }
  // ========== SHAPE 6: RUNE (circle + cross glyph) ==========
  else if (shape == 6) {
    let circle = 1.0 - smoothstep(0.7, 1.0, dist);
    let ax = abs(input.localPos.x);
    let ay = abs(input.localPos.y);
    let cross = 1.0 - smoothstep(0.0, 0.2, min(ax, ay));
    let runeMask = max(circle, cross);
    if (runeMask < 0.05) { discard; }
    color = color * (1.0 + runeMask * 1.5);
    alpha = alpha * runeMask;
  }
  // ========== SHAPE 7: MIST (organic volumetric fog with noise) ==========
  // Wide soft glow with noise-distorted edges for natural fog/mist appearance
  else if (shape == 7) {
    // Unique seed per particle for variation
    let seed = input.age * 0.2 + input.worldY * 0.5;
    let baseCoord = input.localPos.xy * 1.8 + vec2<f32>(seed, seed * 0.6);
    let curl = smokeCurl2d(baseCoord * 0.6) * 0.45;
    let noiseCoord = baseCoord + curl;
    
    // Slower, larger-scale noise for mist (fewer octaves, wider features)
    let mistNoise = smokeFbm2d(noiseCoord, 2) * 2.0 - 1.0;
    
    // Angular variation for non-circular boundary
    let angle = atan2(input.localPos.y, input.localPos.x);
    let angularWarp = smokeFbm2d(vec2<f32>(angle * 1.5 + seed, dist * 2.0), 2);
    
    // Distort distance for organic shape
    let distortedDist = dist + mistNoise * 0.3 + (angularWarp - 0.5) * 0.2;
    
    // Soft exponential falloff with distorted boundary
    let mistFalloff = exp(-distortedDist * distortedDist * 0.6);
    let mistDetail = smokeFbm2d(noiseCoord * 2.6, 3);
    let layeredMist = clamp(mistFalloff * (0.75 + mistDetail * 0.5), 0.0, 1.0);
    
    // Internal density variation for depth
    let internalNoise = smokeFbm2d(input.localPos.xy * 2.5 + vec2<f32>(seed * 1.5, 0.0), 2);
    let mistScatter = layeredMist * 0.25 + internalNoise * 0.1;
    
    // Boost brightness for volumetric density appearance
    color = color * (1.6 + layeredMist * 0.5 + internalNoise * 0.2) + vec3<f32>(0.85, 0.88, 0.95) * mistScatter * 0.12;
    
    // Very low alpha - many particles build up opacity naturally
    alpha = alpha * layeredMist * (0.28 + mistScatter * 0.15);
    
    if (alpha < 0.001) { discard; }
  }
  // ========== SHAPE 8: HALO (ring + soft glow) ==========
  else if (shape == 8) {
    // Soft core
    let core = exp(-dist * dist * 1.5);
    // Ring shell
    let inner = 0.45;
    let outer = 0.85;
    let innerMask = 1.0 - smoothstep(inner - 0.05, inner + 0.05, dist);
    let outerMask = smoothstep(outer - 0.05, outer + 0.05, dist);
    let ringMask = innerMask * outerMask;
    let haloMask = max(core, ringMask);
    if (haloMask < 0.01) { discard; }
    color = color * (1.0 + haloMask);
    alpha = alpha * haloMask;
  }
  // ========== SHAPE 9: ORB (sphere + mist aura) ==========
  else if (shape == 9) {
    // Inner sphere lighting
    var orbColor = color;
    var orbAlpha = alpha;
    if (dist <= 1.0) {
      let z = sqrt(max(1.0 - dist * dist, 0.0));
      let lightDir = normalize(-uFrame.sunDir);
      let normal = vec3<f32>(input.localPos.xy, z);
      let wrapDiffuse = dot(normal, lightDir) * 0.5 + 0.5;
      let sunContrib = uFrame.sunColor * uFrame.sunIntensity * wrapDiffuse;
      let ambContrib = uFrame.ambientColor * uFrame.ambientIntensity;
      let lighting = sunContrib + ambContrib;
      let glow = 1.0 + (1.0 - dist) * 0.5;
      orbColor = orbColor * lighting * glow;
      orbAlpha = orbAlpha * (1.0 - smoothstep(0.8, 1.0, dist));
    }
    // Outer mist aura
    let auraFalloff = exp(-dist * dist * 0.8);
    let auraAlpha = alpha * auraFalloff * 0.7;
    let auraColor = color * (1.0 + auraFalloff * 0.3);
    // Combine sphere core and aura
    color = mix(auraColor, orbColor, orbAlpha);
    alpha = max(orbAlpha, auraAlpha);
  }
  // ========== SHAPE 10: CARD (rectangular quad, soft edges) ==========
  else if (shape == 10) {
    let ax = abs(input.localPos.x);
    let ay = abs(input.localPos.y);
    // Soft edge feathering towards the border of the quad
    let edgeX = smoothstep(0.8, 1.0, ax);
    let edgeY = smoothstep(0.8, 1.0, ay);
    let edge = max(edgeX, edgeY);
    if (edge >= 1.0) { discard; }
    let cardMask = 1.0 - edge;
    color = color * (1.0 + cardMask * 0.5);
    alpha = alpha * cardMask;
  }
  // ========== SHAPE 11: LIGHTNING (jagged bolt) ==========
  else if (shape == 11) {
    let p = input.localPos.xy;
    // Zig-zag center line using a sine wave along Y
    let centerX = 0.3 * sin(p.y * 8.0);
    let dx = abs(p.x - centerX);
    let thickness = 0.18;
    let boltMask = 1.0 - smoothstep(thickness, thickness + 0.06, dx);
    // Fade out towards the ends
    let tipFalloff = 1.0 - smoothstep(0.7, 1.0, abs(p.y));
    let mask = boltMask * tipFalloff;
    if (mask < 0.05) { discard; }
    color = color * (1.0 + mask * 2.0);
    alpha = alpha * mask;
  }
  // ========== SHAPE 12: HEX SHIELD (segmented ring) ==========
  else if (shape == 12) {
    let p = input.localPos.xy;
    let d = length(p);
    // Base ring
    let inner = 0.5;
    let outer = 0.95;
    let innerMask = 1.0 - smoothstep(inner - 0.04, inner + 0.04, d);
    let outerMask = smoothstep(outer - 0.04, outer + 0.04, d);
    let ringMask = innerMask * outerMask;
    // Six-fold modulation to hint at a hex pattern
    let angle = atan2(p.y, p.x);
    let seg = abs(sin(angle * 3.0)); // 6 segments
    let segmentMask = 1.0 - smoothstep(0.3, 0.9, seg);
    let hexMask = ringMask * (0.5 + 0.5 * segmentMask);
    if (hexMask < 0.05) { discard; }
    color = color * (1.0 + hexMask * 1.5);
    alpha = alpha * hexMask;
  }
  // ========== SHAPE 13: GAUSSIAN SPLAT (true 2D Gaussian distribution) ==========
  // Mimics Gaussian Splatting visual style - no brightness modification, just soft edges
  else if (shape == 13) {
    // True 2D Gaussian: G(x,y) = exp(-(x² + y²) / (2σ²))
    // σ = 0.5 gives good coverage with soft edges
    let sigma = 0.5;
    let gaussianFalloff = exp(-(dist * dist) / (2.0 * sigma * sigma));
    
    // NO brightness boost - preserve original texture/vertex color exactly
    // Alpha uses the Gaussian curve directly - soft blend everywhere
    alpha = alpha * gaussianFalloff;
    
    // No discard - let alpha blending handle transparency
  }
  // ========== DEFAULT: Circle fallback ==========
  else {
    if (dist > 1.0) { discard; }
    alpha = alpha * (1.0 - smoothstep(0.5, 1.0, dist));
  }

  // Render mode 4: Texture sampling
  if (rm == 4) {
    let tex = textureSampleLevel(uAlbedoTex, uAlbedoSampler, input.uv, 0.0);
    color = tex.rgb;
    if (tex.a > 0.01) {
      alpha = alpha * tex.a;
    }
  }

  // ===== SOFT PARTICLES (DEPTH FADE) =====
  // Compare particle fragment depth with scene depth to fade at geometry intersections
  // This eliminates hard seams where particles intersect opaque geometry
  let screenUV = input.position.xy / vec2<f32>(textureDimensions(uSceneDepth));
  let sceneDepthVal = textureLoad(uSceneDepth, vec2<i32>(input.position.xy), 0);
  let particleDepth = input.position.z;
  // Depth difference: positive = particle is in front of scene
  let depthDiff = sceneDepthVal - particleDepth;
  // Fade range: softness factor controls how gradual the fade is
  // Smaller values = harder edge, larger values = softer fade
  let softFade = smoothstep(0.0, 0.005, depthDiff);

  // Apply ground feathering, near-fade, and soft particle fade to final alpha
  alpha = alpha * groundFade * nearFade * softFade;
  
  return vec4<f32>(color, alpha);
}
`;
