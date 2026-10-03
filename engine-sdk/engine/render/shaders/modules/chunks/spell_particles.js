// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Spell Particle Effects - WGSL Shader Chunk
 * 
 * Particle behaviors for spell effects including projectiles,
 * shields, auras, and various magical effects.
 */

export const spellParticlesWGSL = /* wgsl */`
// ============================================================================
// SPELL PARTICLE CONSTANTS
// ============================================================================

const SPELL_PI : f32 = 3.14159265359;
const SPELL_TWO_PI : f32 = 6.28318530718;

// Particle behavior types
const BEHAVIOR_TRAIL : u32 = 0u;
const BEHAVIOR_ORBITAL : u32 = 1u;
const BEHAVIOR_RISING : u32 = 2u;
const BEHAVIOR_SPIRAL : u32 = 3u;
const BEHAVIOR_EXPLOSION : u32 = 4u;
const BEHAVIOR_WIND : u32 = 5u;

// ============================================================================
// SPELL PARTICLE STRUCTURES
// ============================================================================

struct SpellParticle {
  position : vec3<f32>,
  velocity : vec3<f32>,
  color : vec4<f32>,
  life : f32,
  decay : f32,
  size : f32,
  angle : f32,
  angleSpeed : f32,
  behavior : u32,
  padding : vec2<f32>,
}

struct SpellParams {
  primaryColor : vec4<f32>,
  secondaryColor : vec4<f32>,
  tertiaryColor : vec4<f32>,
  speed : f32,
  size : f32,
  intensity : f32,
  particleCount : f32,
  gravity : f32,
  spinSpeed : f32,
  time : f32,
  deltaTime : f32,
}

// ============================================================================
// SPELL PARTICLE BEHAVIORS
// ============================================================================

// Update particle based on behavior type
fn updateSpellParticle(
  p : SpellParticle,
  params : SpellParams,
  center : vec3<f32>
) -> SpellParticle {
  var out = p;
  
  // Reduce life
  out.life = out.life - out.decay * params.deltaTime;
  
  // Skip if dead
  if (out.life <= 0.0) {
    return out;
  }
  
  switch (p.behavior) {
    case BEHAVIOR_TRAIL: {
      // Standard trail - move with velocity, apply gravity
      out.position = out.position + out.velocity * params.deltaTime;
      out.velocity.y = out.velocity.y - params.gravity * 9.8 * params.deltaTime;
    }
    
    case BEHAVIOR_ORBITAL: {
      // Orbit around center
      out.angle = out.angle + out.angleSpeed * params.deltaTime;
      let radius = length(p.position - center);
      out.position.x = center.x + radius * sin(out.angle);
      out.position.z = center.z + radius * cos(out.angle);
      out.position.y = center.y + sin(out.angle * 2.0) * 0.3;
    }
    
    case BEHAVIOR_RISING: {
      // Float upward with slight drift
      out.position = out.position + out.velocity * params.deltaTime;
      out.position.x = out.position.x + sin(params.time * 3.0 + p.angle) * 0.01;
      out.position.z = out.position.z + cos(params.time * 2.5 + p.angle) * 0.01;
    }
    
    case BEHAVIOR_SPIRAL: {
      // Spiral inward/upward
      out.angle = out.angle + out.angleSpeed * params.deltaTime;
      let dist = length(vec2<f32>(p.position.x - center.x, p.position.z - center.z));
      let newDist = max(0.1, dist * 0.98);
      out.position.x = center.x + newDist * cos(out.angle);
      out.position.z = center.z + newDist * sin(out.angle);
      out.position.y = out.position.y + params.deltaTime * 0.5;
    }
    
    case BEHAVIOR_EXPLOSION: {
      // Radial explosion with gravity
      out.position = out.position + out.velocity * params.deltaTime;
      out.velocity.y = out.velocity.y - 9.8 * params.deltaTime;
    }
    
    case BEHAVIOR_WIND: {
      // Upward wind with turbulence
      out.position = out.position + out.velocity * params.deltaTime;
      out.position.x = out.position.x + sin(params.time * 5.0 + p.position.y) * 0.02;
      out.position.z = out.position.z + cos(params.time * 4.0 + p.position.y) * 0.02;
    }
    
    default: {
      out.position = out.position + out.velocity * params.deltaTime;
    }
  }
  
  return out;
}

// ============================================================================
// SPELL PARTICLE SPAWNING
// ============================================================================

// Initialize particle for projectile trail
fn spawnProjectileTrail(
  seed : vec3<f32>,
  params : SpellParams,
  projectilePos : vec3<f32>
) -> SpellParticle {
  var p : SpellParticle;
  
  p.position = projectilePos + (seed - 0.5) * 0.3 * params.size;
  p.velocity = vec3<f32>(
    (seed.x - 0.5) * 0.5,
    seed.y * 0.5 + 0.2,  // Rising
    (seed.z - 0.5) * 0.5
  );
  p.color = params.primaryColor;
  p.life = 1.0;
  p.decay = 0.02 + seed.x * 0.02;
  p.size = 0.05 + seed.y * 0.05 * params.size;
  p.angle = seed.z * SPELL_TWO_PI;
  p.angleSpeed = 0.0;
  p.behavior = BEHAVIOR_TRAIL;
  
  return p;
}

// Initialize particle for shield orbit
fn spawnShieldParticle(
  seed : vec3<f32>,
  params : SpellParams,
  center : vec3<f32>
) -> SpellParticle {
  var p : SpellParticle;
  
  let theta = seed.x * SPELL_TWO_PI;
  let phi = seed.y * SPELL_PI;
  let r = params.size;
  
  p.position = center + vec3<f32>(
    r * sin(phi) * cos(theta),
    r * sin(phi) * sin(theta),
    r * cos(phi)
  );
  p.velocity = vec3<f32>(0.0);
  p.color = params.primaryColor;
  p.life = 1.0;
  p.decay = 0.005;
  p.size = 0.05 + seed.z * 0.05;
  p.angle = theta;
  p.angleSpeed = 0.02 + seed.z * 0.02;
  p.behavior = BEHAVIOR_ORBITAL;
  
  return p;
}

// Initialize particle for healing effect
fn spawnHealParticle(
  seed : vec3<f32>,
  params : SpellParams,
  center : vec3<f32>
) -> SpellParticle {
  var p : SpellParticle;
  
  let angle = seed.x * SPELL_TWO_PI;
  let radius = seed.y * params.size;
  
  p.position = center + vec3<f32>(
    radius * cos(angle),
    seed.z * 2.0 - 1.0,
    radius * sin(angle)
  );
  p.velocity = vec3<f32>(0.0, 0.5 + seed.y * 0.5, 0.0);
  p.color = params.primaryColor;
  p.life = 1.0;
  p.decay = 0.008;
  p.size = 0.04 + seed.z * 0.04 * params.size;
  p.angle = angle;
  p.angleSpeed = 0.1;
  p.behavior = BEHAVIOR_RISING;
  
  return p;
}

// Initialize particle for wind/flight effect
fn spawnWindParticle(
  seed : vec3<f32>,
  params : SpellParams,
  center : vec3<f32>
) -> SpellParticle {
  var p : SpellParticle;
  
  let angle = seed.x * SPELL_TWO_PI;
  let radius = seed.y * 0.8;
  
  p.position = center + vec3<f32>(
    radius * cos(angle),
    -seed.z * 2.0,
    radius * sin(angle)
  );
  p.velocity = vec3<f32>(
    (seed.x - 0.5) * 0.5,
    seed.y * 2.0 + 1.0,
    (seed.z - 0.5) * 0.5
  );
  p.color = params.primaryColor;
  p.life = 1.0;
  p.decay = 0.01;
  p.size = 0.02 + seed.y * 0.03;
  p.angle = angle;
  p.angleSpeed = (seed.x - 0.5) * 0.1;
  p.behavior = BEHAVIOR_WIND;
  
  return p;
}

// Initialize particle for vortex/teleport effect
fn spawnVortexParticle(
  seed : vec3<f32>,
  params : SpellParams,
  center : vec3<f32>
) -> SpellParticle {
  var p : SpellParticle;
  
  let angle = seed.x * SPELL_TWO_PI;
  let radius = seed.y * params.size * 2.0;
  
  p.position = center + vec3<f32>(
    radius * cos(angle),
    seed.z * 2.0 - 1.0,
    radius * sin(angle)
  );
  p.velocity = vec3<f32>(0.0);
  p.color = params.primaryColor;
  p.life = 1.0;
  p.decay = 0.015;
  p.size = 0.05 + seed.z * 0.05 * params.size;
  p.angle = angle;
  p.angleSpeed = 0.1 + seed.y * 0.1;
  p.behavior = BEHAVIOR_SPIRAL;
  
  return p;
}

// Initialize particle for explosion impact
fn spawnExplosionParticle(
  seed : vec3<f32>,
  params : SpellParams,
  impactPos : vec3<f32>
) -> SpellParticle {
  var p : SpellParticle;
  
  let theta = seed.x * SPELL_TWO_PI;
  let phi = seed.y * SPELL_PI;
  let speed = seed.z * 3.0 + 1.0;
  
  p.position = impactPos;
  p.velocity = vec3<f32>(
    sin(phi) * cos(theta) * speed,
    abs(sin(phi) * sin(theta) * speed),
    cos(phi) * speed
  );
  p.color = params.primaryColor;
  p.life = 1.0;
  p.decay = 0.02;
  p.size = 0.05 + seed.z * 0.1 * params.size;
  p.angle = 0.0;
  p.angleSpeed = 0.0;
  p.behavior = BEHAVIOR_EXPLOSION;
  
  return p;
}

// ============================================================================
// SPELL COLOR UTILITIES
// ============================================================================

// Blend particle color based on life
fn blendSpellColor(
  primary : vec4<f32>,
  secondary : vec4<f32>,
  tertiary : vec4<f32>,
  life : f32,
  intensity : f32
) -> vec4<f32> {
  // Fade from primary -> secondary -> tertiary as life decreases
  var color : vec4<f32>;
  
  if (life > 0.6) {
    let t = (life - 0.6) / 0.4;
    color = mix(secondary, primary, t);
  } else if (life > 0.3) {
    let t = (life - 0.3) / 0.3;
    color = mix(tertiary, secondary, t);
  } else {
    let t = life / 0.3;
    color = tertiary * t;
  }
  
  color.a = life * intensity;
  return color;
}

// Sparkle effect for heal/magic particles
fn applySparkle(
  color : vec4<f32>,
  time : f32,
  particleId : f32
) -> vec4<f32> {
  let sparkle = sin(time * 10.0 + particleId * 100.0) * 0.5 + 0.5;
  let boosted = color.rgb * (1.0 + sparkle * 0.5);
  return vec4<f32>(boosted, color.a);
}

// Pulse effect for auras/shields
fn applyPulse(
  color : vec4<f32>,
  time : f32,
  pulseSpeed : f32
) -> vec4<f32> {
  let pulse = sin(time * pulseSpeed) * 0.2 + 0.8;
  return vec4<f32>(color.rgb * pulse, color.a * pulse);
}

// ============================================================================
// SPELL GEOMETRY
// ============================================================================

// Point sprite size based on distance and particle size
fn calculatePointSize(
  viewPos : vec3<f32>,
  particleSize : f32,
  intensity : f32
) -> f32 {
  let dist = length(viewPos);
  let size = particleSize * intensity * 100.0 / max(dist, 0.1);
  return clamp(size, 1.0, 64.0);
}

// Billboard rotation matrix for facing camera
fn billboardMatrix(cameraRight : vec3<f32>, cameraUp : vec3<f32>) -> mat3x3<f32> {
  let forward = cross(cameraRight, cameraUp);
  return mat3x3<f32>(cameraRight, cameraUp, forward);
}
`;

export default spellParticlesWGSL;
