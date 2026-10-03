// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Doppler Color Shader - Frequency-to-Color Visualization
// Maps electromagnetic frequencies to visible colors for temporal effects
//
// Use cases:
// - Visualize time-reflected waves (backward propagation)
// - Show frequency shifts from time crystal interactions
// - Doppler effect visualization
// - Photonic time crystal band gap indication
//
// Color mapping:
// - Red: Low frequency / redshifted (time dilation)
// - Green: Base frequency (normal)
// - Blue: High frequency / blueshifted (time compression)
// - Purple glow: Time-reflected waves

// ============================================================================
// CONSTANTS
// ============================================================================

// Visible spectrum frequency bounds (Hz, scaled for f32)
const FREQ_RED: f32 = 4.3e14;      // ~700nm
const FREQ_VIOLET: f32 = 7.5e14;   // ~400nm
const FREQ_GREEN: f32 = 5.7e14;    // ~530nm (base reference)

// Speed of light (for wavelength conversion)
const C: f32 = 2.998e8;

const PI: f32 = 3.14159265359;
const TWO_PI: f32 = 6.28318530718;

// ============================================================================
// STRUCTURES
// ============================================================================

struct Uniforms {
    time: f32,
    baseFrequency: f32,      // Reference frequency for Doppler
    frequencyScale: f32,     // Visualization scaling factor
    phaseSpeed: f32,         // Animation speed for phase visualization

    viewMatrix: mat4x4f,
    projMatrix: mat4x4f,

    timeReflectionGlow: f32, // Glow intensity for time-reflected rays
    bandGapIndicator: f32,   // Highlight band gap frequencies
    saturation: f32,         // Color saturation
    brightness: f32,         // Overall brightness
}

struct RaySegment {
    start: vec3f,
    direction: vec3f,
    length: f32,
    frequency: f32,
    amplitude: f32,
    phase: f32,
    isTimeReflected: f32,    // 1.0 if time-reflected, 0.0 otherwise
    pad: f32,
}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
    @location(1) frequency: f32,
    @location(2) phase: f32,
    @location(3) isTimeReflected: f32,
    @location(4) worldPos: vec3f,
}

// ============================================================================
// BINDINGS
// ============================================================================

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> rays: array<RaySegment>;

// ============================================================================
// FREQUENCY TO COLOR FUNCTIONS
// ============================================================================

// Convert frequency to RGB color (visible spectrum approximation)
fn frequencyToRGB(freq: f32) -> vec3f {
    // Normalize to [0, 1] range within visible spectrum
    let t = clamp((freq - FREQ_RED) / (FREQ_VIOLET - FREQ_RED), 0.0, 1.0);

    var r: f32;
    var g: f32;
    var b: f32;

    // Piecewise linear approximation of visible spectrum
    if (t < 0.2) {
        // Red to orange (700nm - 620nm)
        r = 1.0;
        g = t * 5.0 * 0.5;
        b = 0.0;
    } else if (t < 0.35) {
        // Orange to yellow (620nm - 580nm)
        r = 1.0;
        g = 0.5 + (t - 0.2) / 0.15 * 0.5;
        b = 0.0;
    } else if (t < 0.5) {
        // Yellow to green (580nm - 530nm)
        r = 1.0 - (t - 0.35) / 0.15;
        g = 1.0;
        b = 0.0;
    } else if (t < 0.65) {
        // Green to cyan (530nm - 490nm)
        r = 0.0;
        g = 1.0;
        b = (t - 0.5) / 0.15;
    } else if (t < 0.8) {
        // Cyan to blue (490nm - 450nm)
        r = 0.0;
        g = 1.0 - (t - 0.65) / 0.15;
        b = 1.0;
    } else {
        // Blue to violet (450nm - 400nm)
        r = (t - 0.8) / 0.2 * 0.5;
        g = 0.0;
        b = 1.0;
    }

    return vec3f(r, g, b);
}

// Apply Doppler shift visualization
fn dopplerColor(baseFreq: f32, observedFreq: f32) -> vec3f {
    let ratio = observedFreq / baseFreq;

    // Get base color from observed frequency
    var color = frequencyToRGB(observedFreq);

    // Enhance shift visualization
    if (ratio > 1.1) {
        // Strong blueshift - add blue tint
        color = mix(color, vec3f(0.3, 0.5, 1.0), min((ratio - 1.0) * 0.5, 0.5));
    } else if (ratio < 0.9) {
        // Strong redshift - add red tint
        color = mix(color, vec3f(1.0, 0.3, 0.1), min((1.0 - ratio) * 0.5, 0.5));
    }

    return color;
}

// Time reflection glow effect (purple/magenta for backward waves)
fn timeReflectionColor(baseColor: vec3f, intensity: f32) -> vec3f {
    let reflectionTint = vec3f(0.8, 0.2, 1.0);  // Purple/magenta
    return mix(baseColor, reflectionTint, intensity * 0.5);
}

// Band gap indicator (highlight blocked frequencies)
fn bandGapHighlight(color: vec3f, inBandGap: bool) -> vec3f {
    if (inBandGap) {
        // Pulsing dark red for blocked frequencies
        let pulse = sin(u.time * 5.0) * 0.3 + 0.7;
        return mix(color, vec3f(0.3, 0.0, 0.0), 0.7) * pulse;
    }
    return color;
}

// ============================================================================
// PHASE VISUALIZATION
// ============================================================================

// Visualize wave phase as intensity modulation
fn phaseIntensity(phase: f32, frequency: f32) -> f32 {
    // Animate phase based on frequency and time
    let animatedPhase = phase + u.time * frequency * u.phaseSpeed;
    return 0.5 + 0.5 * cos(animatedPhase);
}

// Create wave pattern along ray
fn wavePattern(t: f32, frequency: f32, phase: f32) -> f32 {
    // Wavelength visualization (scaled for visibility)
    let wavelengthScale = 0.01;  // Adjust for visible waves
    let k = TWO_PI * frequency * wavelengthScale;
    return 0.5 + 0.5 * sin(k * t + phase + u.time * u.phaseSpeed);
}

// ============================================================================
// VERTEX SHADER - RAY SEGMENTS
// ============================================================================

@vertex
fn vs_ray(@builtin(vertex_index) vertexIndex: u32,
          @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
    var output: VertexOutput;

    let ray = rays[instanceIndex];

    // Create line segment vertices (0 = start, 1 = end)
    let t = f32(vertexIndex);
    let worldPos = ray.start + ray.direction * ray.length * t;

    // Transform to clip space
    let viewPos = u.viewMatrix * vec4f(worldPos, 1.0);
    output.position = u.projMatrix * viewPos;

    // Compute color from frequency
    var color = dopplerColor(u.baseFrequency, ray.frequency);

    // Apply time reflection glow
    if (ray.isTimeReflected > 0.5) {
        color = timeReflectionColor(color, u.timeReflectionGlow);
    }

    // Modulate by amplitude
    let alpha = clamp(ray.amplitude, 0.0, 1.0);
    output.color = vec4f(color * u.brightness, alpha);

    output.frequency = ray.frequency;
    output.phase = ray.phase;
    output.isTimeReflected = ray.isTimeReflected;
    output.worldPos = worldPos;

    return output;
}

// ============================================================================
// FRAGMENT SHADER - RAY VISUALIZATION
// ============================================================================

@fragment
fn fs_ray(input: VertexOutput) -> @location(0) vec4f {
    var color = input.color.rgb;

    // Apply phase-based intensity modulation
    let phaseModulation = phaseIntensity(input.phase, input.frequency);
    color = color * (0.7 + 0.3 * phaseModulation);

    // Time-reflected ray special effect
    if (input.isTimeReflected > 0.5) {
        // Pulsing glow
        let pulse = 0.8 + 0.2 * sin(u.time * 8.0);
        color = color * pulse;

        // Add outline glow
        color = color + vec3f(0.2, 0.05, 0.3) * pulse;
    }

    // Apply saturation
    let luminance = dot(color, vec3f(0.299, 0.587, 0.114));
    color = mix(vec3f(luminance), color, u.saturation);

    return vec4f(color, input.color.a);
}

// ============================================================================
// FULLSCREEN POST-PROCESS - TEMPORAL DISTORTION
// ============================================================================

struct FullscreenOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
}

@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex: u32) -> FullscreenOutput {
    var output: FullscreenOutput;

    // Fullscreen triangle
    let x = f32((vertexIndex << 1u) & 2u);
    let y = f32(vertexIndex & 2u);

    output.position = vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
    output.uv = vec2f(x, 1.0 - y);

    return output;
}

@group(1) @binding(0) var sceneTex: texture_2d<f32>;
@group(1) @binding(1) var sceneSampler: sampler;
@group(1) @binding(2) var<uniform> distortion: TemporalDistortion;

struct TemporalDistortion {
    center: vec2f,
    radius: f32,
    strength: f32,
    frequencyShift: f32,
    timeReflectionActive: f32,
    pad: vec2f,
}

// Apply temporal distortion effect to scene
@fragment
fn fs_temporal_distortion(input: FullscreenOutput) -> @location(0) vec4f {
    let uv = input.uv;

    // Distance from distortion center
    let dist = length(uv - distortion.center);
    let safeRadius = max(distortion.radius, 0.00001);
    let normalizedDist = dist / safeRadius;
    let distortionDir = select(vec2f(0.0), normalize(uv - distortion.center), dist > 0.00001);
    let ripple = sin(normalizedDist * 20.0 - u.time * 5.0) * distortion.strength;
    let offset = distortionDir * ripple * 0.02;
    let distortedUv = uv + offset;
    let aberration = distortion.frequencyShift * 0.01 * (1.0 - normalizedDist);
    let baseColor = textureSample(sceneTex, sceneSampler, uv);
    let colorR = textureSample(sceneTex, sceneSampler, distortedUv + vec2f(aberration, 0.0)).r;
    let colorG = textureSample(sceneTex, sceneSampler, distortedUv).g;
    let colorB = textureSample(sceneTex, sceneSampler, distortedUv - vec2f(aberration, 0.0)).b;

    if (dist < distortion.radius) {
        var color = vec3f(colorR, colorG, colorB);

        // Time reflection tint
        if (distortion.timeReflectionActive > 0.5) {
            let reflectionTint = vec3f(0.9, 0.7, 1.0);
            color = mix(color, color * reflectionTint, (1.0 - normalizedDist) * 0.3);
        }

        return vec4f(color, 1.0);
    }

    return baseColor;
}

// ============================================================================
// PHOTONIC CRYSTAL VISUALIZATION
// ============================================================================

struct CrystalVisualization {
    @builtin(position) position: vec4f,
    @location(0) worldPos: vec3f,
    @location(1) localPos: vec3f,
    @location(2) epsilon: f32,
}

@group(2) @binding(0) var<uniform> crystal: PhotonicCrystalParams;

struct PhotonicCrystalParams {
    position: vec3f,
    size: f32,
    baseEpsilon: f32,
    currentEpsilon: f32,
    modulationPhase: f32,
    isActive: f32,
}

// Visualize photonic crystal region
@fragment
fn fs_photonic_crystal(input: CrystalVisualization) -> @location(0) vec4f {
    // Normalize local position
    let localNorm = input.localPos / crystal.size;

    // Base color from epsilon value
    let epsilonRatio = crystal.currentEpsilon / crystal.baseEpsilon;
    var color: vec3f;

    if (epsilonRatio > 1.0) {
        // High epsilon - blue tint (slower light)
        color = mix(vec3f(0.3, 0.5, 0.8), vec3f(0.1, 0.2, 0.6), min(epsilonRatio - 1.0, 1.0));
    } else {
        // Low epsilon - red tint (faster light)
        color = mix(vec3f(0.8, 0.5, 0.3), vec3f(0.6, 0.2, 0.1), min(1.0 - epsilonRatio, 1.0));
    }

    // Modulation visualization
    let modPattern = sin(crystal.modulationPhase + length(localNorm) * 10.0);
    color = color * (0.8 + 0.2 * modPattern);

    // Edge glow
    let edgeDist = min(min(localNorm.x, 1.0 - localNorm.x),
                       min(min(localNorm.y, 1.0 - localNorm.y),
                           min(localNorm.z, 1.0 - localNorm.z)));
    let edgeGlow = exp(-edgeDist * 20.0) * 0.5;
    color = color + vec3f(0.3, 0.6, 1.0) * edgeGlow;

    // Alpha based on activity
    let alpha = 0.3 * crystal.isActive;

    return vec4f(color, alpha);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Convert wavelength (nm) to frequency (Hz)
fn wavelengthToFreq(wavelength_nm: f32) -> f32 {
    return C / (wavelength_nm * 1e-9);
}

// Convert frequency (Hz) to wavelength (nm)
fn freqToWavelength(freq: f32) -> f32 {
    return C / freq * 1e9;
}

// Check if frequency is in a momentum band gap
fn isInBandGap(freq: f32, gapCenter: f32, gapWidth: f32) -> bool {
    return abs(freq - gapCenter) < gapWidth * 0.5;
}

// Energy density visualization color
fn energyDensityColor(density: f32) -> vec3f {
    // Hot colormap
    let t = clamp(density, 0.0, 1.0);
    return vec3f(
        clamp(t * 3.0, 0.0, 1.0),
        clamp(t * 3.0 - 1.0, 0.0, 1.0),
        clamp(t * 3.0 - 2.0, 0.0, 1.0)
    );
}
