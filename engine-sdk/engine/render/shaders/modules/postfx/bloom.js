// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Bloom Post-Process Effect
 * 
 * A multi-pass bloom effect:
 *   1. Threshold pass - Extract bright pixels
 *   2. Downsample passes - Blur at multiple resolutions
 *   3. Upsample passes - Combine blur levels
 *   4. Composite - Blend bloom with original
 * 
 * For simplicity, this is a single-pass approximation using
 * a separable Gaussian blur on bright pixels.
 */

// Bloom threshold - extract bright pixels
export const bloomThresholdWGSL = /* wgsl */`
struct BloomParams {
  threshold : f32,
  softKnee : f32,
  intensity : f32,
  _pad : f32,
  texelSize : vec2<f32>,
  _pad2 : vec2<f32>,
};

@group(0) @binding(0) var<uniform> params : BloomParams;
@group(0) @binding(1) var inputTex : texture_2d<f32>;

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VSOut {
  var out : VSOut;
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  let pos = positions[vertexIndex];
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + 0.5;
  out.uv.y = 1.0 - out.uv.y;
  return out;
}

// Soft threshold with knee
fn softThreshold(color : vec3<f32>, threshold : f32, knee : f32) -> vec3<f32> {
  let brightness = max(max(color.r, color.g), color.b);
  let soft = brightness - threshold + knee;
  let soft2 = clamp(soft, 0.0, 2.0 * knee);
  let soft3 = soft2 * soft2 / (4.0 * knee + 0.00001);
  let contribution = max(soft3, brightness - threshold);
  let factor = max(contribution, 0.0) / max(brightness, 0.00001);
  return color * factor;
}

@fragment
fn fs_threshold(input : VSOut) -> @location(0) vec4<f32> {
  let pixelCoord = vec2<i32>(input.uv * vec2<f32>(textureDimensions(inputTex)));
  let color = textureLoad(inputTex, pixelCoord, 0).rgb;
  let bright = softThreshold(color, params.threshold, params.softKnee);
  return vec4<f32>(bright, 1.0);
}
`;

// Bloom blur pass (horizontal or vertical based on direction param)
export const bloomBlurWGSL = /* wgsl */`
struct BloomParams {
  threshold : f32,
  softKnee : f32,
  intensity : f32,
  _pad : f32,
  texelSize : vec2<f32>,
  direction : vec2<f32>,  // (1,0) for horizontal, (0,1) for vertical
};

@group(0) @binding(0) var<uniform> params : BloomParams;
@group(0) @binding(1) var inputTex : texture_2d<f32>;

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VSOut {
  var out : VSOut;
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  let pos = positions[vertexIndex];
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + 0.5;
  out.uv.y = 1.0 - out.uv.y;
  return out;
}

// 9-tap Gaussian blur weights
const BLUR_WEIGHTS = array<f32, 5>(
  0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216
);

@fragment
fn fs_blur(input : VSOut) -> @location(0) vec4<f32> {
  let texSize = vec2<f32>(textureDimensions(inputTex));
  let pixelCoord = vec2<i32>(input.uv * texSize);
  let offset = params.direction * params.texelSize;
  
  // Center sample
  var result = textureLoad(inputTex, pixelCoord, 0).rgb * BLUR_WEIGHTS[0];
  
  // Symmetric samples
  for (var i = 1; i < 5; i = i + 1) {
    let off = vec2<i32>(params.direction * f32(i));
    result = result + textureLoad(inputTex, pixelCoord + off, 0).rgb * BLUR_WEIGHTS[i];
    result = result + textureLoad(inputTex, pixelCoord - off, 0).rgb * BLUR_WEIGHTS[i];
  }
  
  return vec4<f32>(result, 1.0);
}
`;

// Bloom composite - blend bloom with original
export const bloomCompositeWGSL = /* wgsl */`
struct BloomParams {
  threshold : f32,
  softKnee : f32,
  intensity : f32,
  _pad : f32,
  texelSize : vec2<f32>,
  _pad2 : vec2<f32>,
};

@group(0) @binding(0) var<uniform> params : BloomParams;
@group(0) @binding(1) var sceneTex : texture_2d<f32>;
@group(0) @binding(2) var bloomTex : texture_2d<f32>;

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VSOut {
  var out : VSOut;
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  let pos = positions[vertexIndex];
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + 0.5;
  out.uv.y = 1.0 - out.uv.y;
  return out;
}

@fragment
fn fs_composite(input : VSOut) -> @location(0) vec4<f32> {
  let pixelCoord = vec2<i32>(input.uv * vec2<f32>(textureDimensions(sceneTex)));
  let sceneColor = textureLoad(sceneTex, pixelCoord, 0).rgb;
  let bloomColor = textureLoad(bloomTex, pixelCoord, 0).rgb;
  
  // Additive blend with intensity control
  let result = sceneColor + bloomColor * params.intensity;
  
  return vec4<f32>(result, 1.0);
}
`;

// Single-pass approximation bloom (simpler, less accurate but faster)
export const bloomSinglePassWGSL = /* wgsl */`
struct BloomParams {
  threshold : f32,
  softKnee : f32,
  intensity : f32,
  radius : f32,
  texelSize : vec2<f32>,
  _pad : vec2<f32>,
};

@group(0) @binding(0) var<uniform> params : BloomParams;
@group(0) @binding(1) var inputTex : texture_2d<f32>;

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VSOut {
  var out : VSOut;
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  let pos = positions[vertexIndex];
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + 0.5;
  out.uv.y = 1.0 - out.uv.y;
  return out;
}

// Extract brightness above threshold
fn extractBright(color : vec3<f32>, threshold : f32, knee : f32) -> vec3<f32> {
  let brightness = max(max(color.r, color.g), color.b);
  let soft = clamp(brightness - threshold + knee, 0.0, 2.0 * knee);
  let contribution = soft * soft / (4.0 * knee + 0.0001);
  let factor = max(contribution, brightness - threshold) / max(brightness, 0.0001);
  return color * max(factor, 0.0);
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  let texSize = vec2<f32>(textureDimensions(inputTex));
  let pixelCoord = vec2<i32>(input.uv * texSize);
  
  // Get original color
  let sceneColor = textureLoad(inputTex, pixelCoord, 0).rgb;
  
  // Sample bloom in a cross pattern (fast approximation)
  var bloom = vec3<f32>(0.0);
  let radius = i32(params.radius);
  var totalWeight = 0.0;
  
  for (var i = -radius; i <= radius; i = i + 1) {
    let weight = 1.0 - abs(f32(i)) / f32(radius + 1);
    let wSq = weight * weight;
    
    // Horizontal
    let sampleH = textureLoad(inputTex, pixelCoord + vec2<i32>(i, 0), 0).rgb;
    bloom = bloom + extractBright(sampleH, params.threshold, params.softKnee) * wSq;
    
    // Vertical (skip center to avoid double count)
    if (i != 0) {
      let sampleV = textureLoad(inputTex, pixelCoord + vec2<i32>(0, i), 0).rgb;
      bloom = bloom + extractBright(sampleV, params.threshold, params.softKnee) * wSq;
      totalWeight = totalWeight + wSq;
    }
    totalWeight = totalWeight + wSq;
  }
  
  bloom = bloom / totalWeight;
  
  // Combine with original
  let result = sceneColor + bloom * params.intensity;
  
  return vec4<f32>(result, 1.0);
}
`;

export default {
  bloomThresholdWGSL,
  bloomBlurWGSL,
  bloomCompositeWGSL,
  bloomSinglePassWGSL,
};
