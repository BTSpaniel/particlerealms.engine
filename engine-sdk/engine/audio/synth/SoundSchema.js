// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SoundSchema.js — JSON Schema Definitions for All Sound Types
 *
 * Each schema defines every parameter with:
 *   type, min, max, step, default, label, description, unit, group
 *
 * Used by:
 *   - AudioNodeInspector: auto-generate UI controls from schema
 *   - VariationGenerator: derive ranges/limits automatically
 *   - Validation: validateParams() catches bad data on import/paste
 *   - Sound Palette: self-describing serialized entries
 *
 * Schema field types:
 *   'float'   → slider (min/max/step)
 *   'int'     → integer slider or number input
 *   'enum'    → dropdown (options array)
 *   'bool'    → toggle
 *   'string'  → text input
 *   'array'   → special handling per context
 */

// ============================================================================
// SFX GENERATOR SCHEMA (sfxr-style)
// ============================================================================

export const SFX_SCHEMA = {
    _meta: { name: 'SFX Generator', icon: '~', category: 'sfx', description: 'sfxr-style parametric sound effects' },

    waveType:     { type: 'enum', options: [
        { value: 0, label: 'Square' },
        { value: 1, label: 'Sawtooth' },
        { value: 2, label: 'Sine' },
        { value: 3, label: 'Noise' },
        { value: 4, label: 'Triangle' },
        { value: 5, label: 'Breaker' },
    ], default: 0, label: 'Waveform', group: 'waveform', description: 'Base oscillator shape' },

    // Envelope
    attackTime:    { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Attack', group: 'envelope', unit: 's', description: 'Volume ramp-up time' },
    sustainTime:   { type: 'float', min: 0, max: 1, step: 0.01, default: 0.3, label: 'Sustain', group: 'envelope', unit: 's', description: 'Sustain duration' },
    sustainPunch:  { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Sustain Punch', group: 'envelope', description: 'Extra volume burst at sustain start' },
    decayTime:     { type: 'float', min: 0, max: 1, step: 0.01, default: 0.4, label: 'Decay', group: 'envelope', unit: 's', description: 'Volume fade-out time' },

    // Frequency
    startFrequency:  { type: 'float', min: 0, max: 1, step: 0.01, default: 0.3, label: 'Start Freq', group: 'frequency', description: 'Initial frequency (0-1 → 0-1500 Hz)' },
    minFrequency:    { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Min Freq', group: 'frequency', description: 'Frequency floor (cuts off below)' },
    slide:           { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'Freq Slide', group: 'frequency', description: 'Frequency change over time' },
    deltaSlide:      { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'Slide Accel', group: 'frequency', description: 'Acceleration of frequency slide' },

    // Vibrato
    vibratoDepth:  { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Vibrato Depth', group: 'vibrato', description: 'Pitch oscillation amount' },
    vibratoSpeed:  { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Vibrato Speed', group: 'vibrato', description: 'Pitch oscillation rate' },

    // Arp
    arpMod:        { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'Arp Mod', group: 'arpeggiation', description: 'Frequency multiplier change' },
    arpSpeed:      { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Arp Speed', group: 'arpeggiation', description: 'Time before arp kicks in' },

    // Duty
    dutyCycle:     { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Duty Cycle', group: 'duty', description: 'Square wave pulse width' },
    dutySweep:     { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'Duty Sweep', group: 'duty', description: 'Pulse width change over time' },

    // Retrigger
    repeatSpeed:   { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Repeat Speed', group: 'retrigger', description: 'Retrigger rate (0=off)' },

    // Flanger
    flangerOffset: { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'Flanger Offset', group: 'flanger', description: 'Phaser offset amount' },
    flangerSweep:  { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'Flanger Sweep', group: 'flanger', description: 'Phaser sweep rate' },

    // LP Filter
    lpFilterCutoff:      { type: 'float', min: 0, max: 1, step: 0.01, default: 1.0, label: 'LP Cutoff', group: 'filter', description: 'Low-pass filter cutoff (1=disabled)' },
    lpFilterCutoffSweep: { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'LP Sweep', group: 'filter', description: 'LP cutoff change over time' },
    lpFilterResonance:   { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'LP Resonance', group: 'filter', description: 'LP filter resonance amount' },

    // HP Filter
    hpFilterCutoff:      { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'HP Cutoff', group: 'filter', description: 'High-pass filter cutoff (0=disabled)' },
    hpFilterCutoffSweep: { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'HP Sweep', group: 'filter', description: 'HP cutoff change over time' },

    // Output
    masterVolume:  { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Volume', group: 'output', description: 'Master output volume' },
    sampleRate:    { type: 'int', min: 8000, max: 96000, step: 1000, default: 44100, label: 'Sample Rate', group: 'output', unit: 'Hz', description: 'Render sample rate' },
    sampleSize:    { type: 'enum', options: [{ value: 8, label: '8-bit' }, { value: 16, label: '16-bit' }], default: 8, label: 'Bit Depth', group: 'output', description: 'Sample resolution' },
};

// ============================================================================
// FM SYNTHESIS SCHEMA
// ============================================================================

export const FM_SCHEMA = {
    _meta: { name: 'FM Synth', icon: 'F', category: 'fm', description: 'Frequency modulation synthesis' },

    carrierFreq:   { type: 'float', min: 20, max: 8000, step: 1, default: 440, label: 'Carrier Freq', group: 'carrier', unit: 'Hz', description: 'Fundamental pitch' },
    modRatio:      { type: 'float', min: 0.1, max: 16, step: 0.1, default: 2.0, label: 'Mod Ratio', group: 'modulator', description: 'Modulator frequency as ratio of carrier' },
    modDepth:      { type: 'float', min: 0, max: 5000, step: 1, default: 200, label: 'Mod Depth', group: 'modulator', unit: 'Hz', description: 'Modulation intensity' },
    feedback:      { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Feedback', group: 'modulator', description: 'Operator self-modulation' },

    // Carrier envelope
    attack:        { type: 'float', min: 0.001, max: 2, step: 0.001, default: 0.005, label: 'Attack', group: 'carrier_env', unit: 's', description: 'Carrier attack time' },
    decay:         { type: 'float', min: 0.001, max: 2, step: 0.01, default: 0.2, label: 'Decay', group: 'carrier_env', unit: 's', description: 'Carrier decay time' },
    sustain:       { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Sustain', group: 'carrier_env', description: 'Carrier sustain level' },
    release:       { type: 'float', min: 0.01, max: 5, step: 0.01, default: 0.5, label: 'Release', group: 'carrier_env', unit: 's', description: 'Carrier release time' },

    // Modulator envelope
    modAttack:     { type: 'float', min: 0.001, max: 2, step: 0.001, default: 0.001, label: 'Mod Attack', group: 'mod_env', unit: 's', description: 'Modulator attack time' },
    modDecay:      { type: 'float', min: 0.001, max: 2, step: 0.01, default: 0.3, label: 'Mod Decay', group: 'mod_env', unit: 's', description: 'Modulator decay time' },
    modSustain:    { type: 'float', min: 0, max: 1, step: 0.01, default: 0.2, label: 'Mod Sustain', group: 'mod_env', description: 'Modulator sustain level' },
    modRelease:    { type: 'float', min: 0.01, max: 5, step: 0.01, default: 0.3, label: 'Mod Release', group: 'mod_env', unit: 's', description: 'Modulator release time' },

    // Output
    duration:      { type: 'float', min: 0.1, max: 10, step: 0.1, default: 1.5, label: 'Duration', group: 'output', unit: 's', description: 'Total sound duration' },
    volume:        { type: 'float', min: 0, max: 1, step: 0.01, default: 0.7, label: 'Volume', group: 'output', description: 'Master output volume' },
};

// ============================================================================
// KARPLUS-STRONG SCHEMA
// ============================================================================

export const KARPLUS_SCHEMA = {
    _meta: { name: 'Plucked String', icon: 'K', category: 'karplus', description: 'Karplus-Strong physical modeling synthesis' },

    frequency:     { type: 'float', min: 20, max: 4000, step: 1, default: 220, label: 'Frequency', group: 'pitch', unit: 'Hz', description: 'Fundamental pitch' },
    decay:         { type: 'float', min: 0.1, max: 10, step: 0.1, default: 2.0, label: 'Decay', group: 'timbre', unit: 's', description: 'How long the string rings' },
    brightness:    { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Brightness', group: 'timbre', description: '0=dark/muted, 1=bright/metallic' },
    excitation:    { type: 'enum', options: [
        { value: 'noise', label: 'Noise' },
        { value: 'impulse', label: 'Impulse' },
        { value: 'sine', label: 'Sine' },
    ], default: 'noise', label: 'Excitation', group: 'timbre', description: 'Initial energy source' },
    stretch:       { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Stretch', group: 'timbre', description: 'Allpass stretch factor (inharmonicity)' },
    volume:        { type: 'float', min: 0, max: 1, step: 0.01, default: 0.8, label: 'Volume', group: 'output', description: 'Output volume' },
    duration:      { type: 'float', min: 0.1, max: 15, step: 0.1, default: 3.0, label: 'Duration', group: 'output', unit: 's', description: 'Max render duration' },
};

// ============================================================================
// GRANULAR SCHEMA
// ============================================================================

export const GRANULAR_SCHEMA = {
    _meta: { name: 'Granular Synth', icon: ':', category: 'granular', description: 'Granular synthesis — texture from tiny grains' },

    position:       { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Position', group: 'grains', description: 'Playback position in source buffer (normalized)' },
    positionRandom: { type: 'float', min: 0, max: 1, step: 0.01, default: 0.1, label: 'Pos Random', group: 'grains', description: 'Random scatter around position' },
    grainSize:      { type: 'float', min: 0.005, max: 0.5, step: 0.005, default: 0.08, label: 'Grain Size', group: 'grains', unit: 's', description: 'Duration of each grain' },
    density:        { type: 'float', min: 1, max: 100, step: 1, default: 20, label: 'Density', group: 'grains', unit: '/s', description: 'Grains spawned per second' },
    pitchBase:      { type: 'float', min: 0.1, max: 4, step: 0.01, default: 1.0, label: 'Pitch', group: 'pitch', description: 'Base playback rate' },
    pitchRandom:    { type: 'float', min: 0, max: 1, step: 0.01, default: 0.05, label: 'Pitch Random', group: 'pitch', description: 'Random pitch variation' },
    panSpread:      { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Pan Spread', group: 'stereo', description: 'Stereo scatter width' },
    envelope:       { type: 'enum', options: [
        { value: 'hann', label: 'Hann' },
        { value: 'triangle', label: 'Triangle' },
        { value: 'trapezoid', label: 'Trapezoid' },
    ], default: 'hann', label: 'Envelope', group: 'grains', description: 'Grain amplitude window shape' },
    reverse:        { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Reverse Prob', group: 'grains', description: 'Probability of reversed grains' },
    volume:         { type: 'float', min: 0, max: 1, step: 0.01, default: 0.8, label: 'Volume', group: 'output', description: 'Output volume' },
};

// ============================================================================
// OSCILLATOR SCHEMA
// ============================================================================

export const OSCILLATOR_SCHEMA = {
    _meta: { name: 'Oscillator', icon: '~', category: 'oscillator', description: 'Multi-waveform oscillator with unison and sub' },

    frequency:     { type: 'float', min: 20, max: 20000, step: 1, default: 440, label: 'Frequency', group: 'pitch', unit: 'Hz', description: 'Base frequency' },
    detune:        { type: 'float', min: -1200, max: 1200, step: 1, default: 0, label: 'Detune', group: 'pitch', unit: 'cents', description: 'Fine tuning in cents' },
    shape:         { type: 'enum', options: [
        { value: 'sine', label: 'Sine' },
        { value: 'square', label: 'Square' },
        { value: 'sawtooth', label: 'Sawtooth' },
        { value: 'triangle', label: 'Triangle' },
        { value: 'pulse', label: 'Pulse' },
        { value: 'supersaw', label: 'Supersaw' },
    ], default: 'sine', label: 'Shape', group: 'waveform', description: 'Oscillator waveform' },
    pulseWidth:    { type: 'float', min: 0.01, max: 0.99, step: 0.01, default: 0.5, label: 'Pulse Width', group: 'waveform', description: 'Duty cycle for pulse wave (0.5=square)' },
    unisonVoices:  { type: 'int', min: 1, max: 8, step: 1, default: 1, label: 'Unison Voices', group: 'unison', description: 'Number of detuned voices' },
    unisonDetune:  { type: 'float', min: 0, max: 100, step: 1, default: 10, label: 'Unison Detune', group: 'unison', unit: 'cents', description: 'Spread between unison voices' },
    subOctave:     { type: 'int', min: 0, max: 2, step: 1, default: 0, label: 'Sub Octave', group: 'sub', description: '0=off, 1=-1 octave, 2=-2 octaves' },
    subMix:        { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Sub Mix', group: 'sub', description: 'Sub-oscillator volume' },
    volume:        { type: 'float', min: 0, max: 1, step: 0.01, default: 0.8, label: 'Volume', group: 'output', description: 'Output volume' },
};

// ============================================================================
// NOISE GENERATOR SCHEMA
// ============================================================================

export const NOISE_SCHEMA = {
    _meta: { name: 'Noise Generator', icon: 'N', category: 'noise', description: 'Multi-color noise generator' },

    color:         { type: 'enum', options: [
        { value: 'white', label: 'White (flat)' },
        { value: 'pink', label: 'Pink (-3dB/oct)' },
        { value: 'brown', label: 'Brown (-6dB/oct)' },
        { value: 'blue', label: 'Blue (+3dB/oct)' },
        { value: 'violet', label: 'Violet (+6dB/oct)' },
        { value: 'grey', label: 'Grey (A-weighted)' },
        { value: 'velvet', label: 'Velvet (sparse)' },
        { value: 'crackle', label: 'Crackle (impulses)' },
    ], default: 'white', label: 'Color', group: 'noise', description: 'Spectral shape of noise' },
    density:       { type: 'float', min: 1, max: 1000, step: 1, default: 100, label: 'Density', group: 'noise', unit: '/s', description: 'Impulses per second (velvet/crackle only)' },
    bandwidth:     { type: 'float', min: 100, max: 20000, step: 100, default: 20000, label: 'Bandwidth', group: 'filter', unit: 'Hz', description: 'Low-pass cutoff frequency' },
    stereoSpread:  { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Stereo Spread', group: 'stereo', description: '0=mono, 1=full stereo decorrelation' },
    volume:        { type: 'float', min: 0, max: 1, step: 0.01, default: 0.8, label: 'Volume', group: 'output', description: 'Output volume' },
};

// ============================================================================
// IMPULSE SCHEMA
// ============================================================================

export const IMPULSE_SCHEMA = {
    _meta: { name: 'Impulse Generator', icon: '!', category: 'impulse', description: 'Excitation impulse generator' },

    rate:          { type: 'float', min: 0.1, max: 100, step: 0.1, default: 10, label: 'Rate', group: 'timing', unit: '/s', description: 'Impulses per second' },
    shape:         { type: 'enum', options: [
        { value: 'click', label: 'Click' },
        { value: 'burst', label: 'Burst' },
        { value: 'noise', label: 'Noise' },
        { value: 'chirp', label: 'Chirp' },
        { value: 'sine', label: 'Sine' },
        { value: 'triangle', label: 'Triangle' },
    ], default: 'click', label: 'Shape', group: 'impulse', description: 'Excitation waveform type' },
    jitter:        { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Jitter', group: 'timing', description: 'Timing randomization' },
    attack:        { type: 'float', min: 0.0001, max: 0.1, step: 0.001, default: 0.001, label: 'Attack', group: 'envelope', unit: 's', description: 'Attack time' },
    decay:         { type: 'float', min: 0.001, max: 0.5, step: 0.001, default: 0.01, label: 'Decay', group: 'envelope', unit: 's', description: 'Decay time' },
    burstLength:   { type: 'float', min: 0.001, max: 0.1, step: 0.001, default: 0.005, label: 'Burst Length', group: 'impulse', unit: 's', description: 'Noise burst duration' },
    pitch:         { type: 'float', min: 50, max: 5000, step: 10, default: 1000, label: 'Pitch', group: 'impulse', unit: 'Hz', description: 'Frequency for tonal shapes' },
    velocityMin:   { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Vel Min', group: 'velocity', description: 'Minimum amplitude' },
    velocityMax:   { type: 'float', min: 0, max: 1, step: 0.01, default: 1.0, label: 'Vel Max', group: 'velocity', description: 'Maximum amplitude' },
};

// ============================================================================
// MODAL BANK SCHEMA
// ============================================================================

export const MODAL_SCHEMA = {
    _meta: { name: 'Modal Bank', icon: 'M', category: 'modal', description: 'Resonant body physical modeling' },

    material:      { type: 'enum', options: [
        { value: 'metal', label: 'Metal' },
        { value: 'glass', label: 'Glass' },
        { value: 'wood', label: 'Wood' },
        { value: 'ceramic', label: 'Ceramic' },
        { value: 'plastic', label: 'Plastic' },
        { value: 'membrane', label: 'Membrane' },
        { value: 'string', label: 'String' },
        { value: 'bell', label: 'Bell' },
    ], default: 'metal', label: 'Material', group: 'material', description: 'Physical material preset' },
    frequency:     { type: 'float', min: 20, max: 5000, step: 1, default: 440, label: 'Frequency', group: 'pitch', unit: 'Hz', description: 'Fundamental frequency' },
    modeCount:     { type: 'int', min: 2, max: 64, step: 1, default: 12, label: 'Modes', group: 'modes', description: 'Number of resonant modes' },
    inharmonicity: { type: 'float', min: -0.1, max: 2, step: 0.001, default: 0, label: 'Inharmonicity', group: 'modes', description: 'Mode frequency stretch' },
    damping:       { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Damping', group: 'decay', description: 'Overall decay time' },
    highDamp:      { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'High Damp', group: 'decay', description: 'High-frequency damping' },
    brightness:    { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Brightness', group: 'timbre', description: 'Spectral tilt' },
    strikePosition:{ type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Strike Pos', group: 'excitation', description: 'Excitation position on body' },
    size:          { type: 'float', min: 0.1, max: 10, step: 0.1, default: 1.0, label: 'Size', group: 'material', description: 'Object size scaling' },
};

// ============================================================================
// WAVEGUIDE SCHEMA
// ============================================================================

export const WAVEGUIDE_SCHEMA = {
    _meta: { name: 'Waveguide', icon: 'W', category: 'waveguide', description: 'Digital waveguide physical modeling' },

    frequency:     { type: 'float', min: 20, max: 2000, step: 1, default: 220, label: 'Frequency', group: 'pitch', unit: 'Hz', description: 'Fundamental frequency' },
    damping:       { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Damping', group: 'decay', description: 'Energy loss per cycle' },
    feedback:      { type: 'float', min: 0, max: 0.999, step: 0.001, default: 0.99, label: 'Feedback', group: 'decay', description: 'Loop gain' },
    termination:   { type: 'enum', options: [
        { value: 'rigid', label: 'Rigid' },
        { value: 'free', label: 'Free' },
        { value: 'lossy', label: 'Lossy' },
        { value: 'dispersive', label: 'Dispersive' },
    ], default: 'rigid', label: 'Termination', group: 'physics', description: 'Boundary condition type' },
    mode:          { type: 'enum', options: [
        { value: 'string', label: 'String' },
        { value: 'tube', label: 'Tube (closed)' },
        { value: 'open', label: 'Tube (open)' },
    ], default: 'string', label: 'Mode', group: 'physics', description: 'Waveguide model type' },
    excitePos:     { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Excite Pos', group: 'position', description: 'Excitation injection point' },
    pickupPos:     { type: 'float', min: 0, max: 1, step: 0.01, default: 0.25, label: 'Pickup Pos', group: 'position', description: 'Output sampling point' },
    dispersion:    { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Dispersion', group: 'physics', description: 'Frequency-dependent propagation' },
    brightness:    { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Brightness', group: 'timbre', description: 'Reflection filter cutoff' },
};

// ============================================================================
// SAMPLE PLAYER SCHEMA
// ============================================================================

export const SAMPLE_SCHEMA = {
    _meta: { name: 'Sample Player', icon: 'S', category: 'sample', description: 'Advanced sample playback' },

    rate:          { type: 'float', min: 0.1, max: 4, step: 0.01, default: 1.0, label: 'Rate', group: 'playback', description: 'Playback speed' },
    loop:          { type: 'bool', default: false, label: 'Loop', group: 'playback', description: 'Enable looping' },
    loopMode:      { type: 'enum', options: [
        { value: 'forward', label: 'Forward' },
        { value: 'pingpong', label: 'Ping-Pong' },
        { value: 'reverse', label: 'Reverse' },
    ], default: 'forward', label: 'Loop Mode', group: 'playback', description: 'Loop playback direction' },
    startTime:     { type: 'float', min: 0, max: 60, step: 0.01, default: 0, label: 'Start', group: 'region', unit: 's', description: 'Playback start point' },
    endTime:       { type: 'float', min: -1, max: 60, step: 0.01, default: -1, label: 'End', group: 'region', unit: 's', description: 'Playback end point (-1=buffer end)' },
    loopStart:     { type: 'float', min: 0, max: 60, step: 0.01, default: 0, label: 'Loop Start', group: 'region', unit: 's', description: 'Loop region start' },
    loopEnd:       { type: 'float', min: -1, max: 60, step: 0.01, default: -1, label: 'Loop End', group: 'region', unit: 's', description: 'Loop region end' },
    crossfade:     { type: 'float', min: 0, max: 1, step: 0.01, default: 0.01, label: 'Crossfade', group: 'region', unit: 's', description: 'Loop crossfade duration' },
    attack:        { type: 'float', min: 0, max: 2, step: 0.01, default: 0, label: 'Attack', group: 'envelope', unit: 's', description: 'Amplitude attack time' },
    decay:         { type: 'float', min: 0, max: 2, step: 0.01, default: 0, label: 'Decay', group: 'envelope', unit: 's', description: 'Amplitude decay time' },
    sustain:       { type: 'float', min: 0, max: 1, step: 0.01, default: 1, label: 'Sustain', group: 'envelope', description: 'Sustain level' },
    release:       { type: 'float', min: 0.01, max: 5, step: 0.01, default: 0.01, label: 'Release', group: 'envelope', unit: 's', description: 'Release time' },
};

// ============================================================================
// FORMANT FILTER SCHEMA
// ============================================================================

export const FORMANT_SCHEMA = {
    _meta: { name: 'Formant Filter', icon: 'V', category: 'formant', description: 'Vocal formant resonance filter bank' },

    vowel:         { type: 'enum', options: [
        { value: 'A', label: 'A (ah)' },
        { value: 'E', label: 'E (eh)' },
        { value: 'I', label: 'I (ee)' },
        { value: 'O', label: 'O (oh)' },
        { value: 'U', label: 'U (oo)' },
        { value: 'growl', label: 'Growl' },
        { value: 'hiss', label: 'Hiss' },
        { value: 'roar', label: 'Roar' },
        { value: 'alien', label: 'Alien' },
        { value: 'ghost', label: 'Ghost' },
    ], default: 'A', label: 'Vowel', group: 'formant', description: 'Formant preset' },
    formantCount:  { type: 'int', min: 1, max: 5, step: 1, default: 5, label: 'Formant Count', group: 'formant', description: 'Number of parallel formant bands' },
    morphTime:     { type: 'float', min: 0, max: 2, step: 0.01, default: 0.1, label: 'Morph Time', group: 'formant', unit: 's', description: 'Transition time between vowels' },
    volume:        { type: 'float', min: 0, max: 1, step: 0.01, default: 1.0, label: 'Volume', group: 'output', description: 'Output gain' },
};

// ============================================================================
// SOUND BLENDER SCHEMA
// ============================================================================

export const BLEND_SCHEMA = {
    _meta: { name: 'Sound Blender', icon: 'B', category: 'blend', description: 'Multi-layer sound mixer with variation' },

    mode:          { type: 'enum', options: [
        { value: 'simultaneous', label: 'Simultaneous' },
        { value: 'sequential', label: 'Sequential' },
        { value: 'random', label: 'Random Pick' },
        { value: 'roundrobin', label: 'Round Robin' },
    ], default: 'simultaneous', label: 'Trigger Mode', group: 'blend', description: 'How layers are triggered' },
    fadeCurve:     { type: 'enum', options: [
        { value: 'linear', label: 'Linear' },
        { value: 'equalpower', label: 'Equal Power' },
        { value: 'cosine', label: 'Cosine' },
    ], default: 'linear', label: 'Fade Curve', group: 'blend', description: 'Crossfade interpolation curve' },
    masterVolume:  { type: 'float', min: 0, max: 1, step: 0.01, default: 1.0, label: 'Master Volume', group: 'output', description: 'Overall output volume' },
};

export const BLEND_LAYER_SCHEMA = {
    _meta: { name: 'Blend Layer', description: 'Per-layer settings within a Sound Blender' },

    volume:        { type: 'float', min: 0, max: 2, step: 0.01, default: 1.0, label: 'Volume', group: 'level', description: 'Layer volume' },
    pitch:         { type: 'float', min: 0.1, max: 4, step: 0.01, default: 1.0, label: 'Pitch', group: 'level', description: 'Playback rate' },
    delay:         { type: 'float', min: 0, max: 2, step: 0.01, default: 0, label: 'Delay', group: 'timing', unit: 's', description: 'Start offset' },
    pan:           { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'Pan', group: 'stereo', description: 'Stereo position' },
    volumeRandom:  { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Vol Random', group: 'variation', description: 'Random volume range ±' },
    pitchRandom:   { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Pitch Random', group: 'variation', description: 'Random pitch range ±' },
    delayRandom:   { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Delay Random', group: 'variation', unit: 's', description: 'Random delay range ±' },
    panRandom:     { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Pan Random', group: 'variation', description: 'Random pan range ±' },
    reverse:       { type: 'bool', default: false, label: 'Reverse', group: 'playback', description: 'Play buffer backwards' },
    enabled:       { type: 'bool', default: true, label: 'Enabled', group: 'playback', description: 'Include this layer' },
};

// ============================================================================
// SCHEMA REGISTRY
// ============================================================================

export const SOUND_SCHEMAS = {
    sfx: SFX_SCHEMA,
    fm: FM_SCHEMA,
    karplus: KARPLUS_SCHEMA,
    granular: GRANULAR_SCHEMA,
    oscillator: OSCILLATOR_SCHEMA,
    noise: NOISE_SCHEMA,
    impulse: IMPULSE_SCHEMA,
    modal: MODAL_SCHEMA,
    waveguide: WAVEGUIDE_SCHEMA,
    sample: SAMPLE_SCHEMA,
    formant: FORMANT_SCHEMA,
    blend: BLEND_SCHEMA,
    blendLayer: BLEND_LAYER_SCHEMA,
};

/**
 * Get a schema by type name.
 * @param {string} type - 'sfx', 'fm', 'karplus', 'granular', 'formant', 'blend', 'blendLayer'
 * @returns {Object|null}
 */
export function getSchema(type) {
    return SOUND_SCHEMAS[type] || null;
}

/**
 * Get all schema names.
 * @returns {string[]}
 */
export function getSchemaNames() {
    return Object.keys(SOUND_SCHEMAS);
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate a params object against a schema.
 * Returns { valid, errors, sanitized }.
 * - sanitized: a clean copy with missing keys filled from defaults and out-of-range values clamped.
 * - errors: array of { key, message } for any issues found.
 *
 * @param {Object} params - The parameter object to validate
 * @param {Object} schema - The schema to validate against
 * @returns {{ valid: boolean, errors: Array<{key:string, message:string}>, sanitized: Object }}
 */
export function validateParams(params, schema) {
    const errors = [];
    const sanitized = {};

    for (const [key, def] of Object.entries(schema)) {
        if (key === '_meta') continue;

        const val = params[key];

        // Missing → use default
        if (val === undefined || val === null) {
            sanitized[key] = def.default;
            continue;
        }

        switch (def.type) {
            case 'float': {
                const num = Number(val);
                if (isNaN(num)) {
                    errors.push({ key, message: `Expected number, got ${typeof val}` });
                    sanitized[key] = def.default;
                } else if (num < def.min || num > def.max) {
                    errors.push({ key, message: `${num} out of range [${def.min}, ${def.max}]` });
                    sanitized[key] = Math.max(def.min, Math.min(def.max, num));
                } else {
                    sanitized[key] = num;
                }
                break;
            }
            case 'int': {
                const num = Math.round(Number(val));
                if (isNaN(num)) {
                    errors.push({ key, message: `Expected integer, got ${typeof val}` });
                    sanitized[key] = def.default;
                } else if (num < def.min || num > def.max) {
                    errors.push({ key, message: `${num} out of range [${def.min}, ${def.max}]` });
                    sanitized[key] = Math.max(def.min, Math.min(def.max, num));
                } else {
                    sanitized[key] = num;
                }
                break;
            }
            case 'enum': {
                const validValues = def.options.map(o => typeof o === 'object' ? o.value : o);
                if (!validValues.includes(val)) {
                    errors.push({ key, message: `Invalid option "${val}". Valid: ${validValues.join(', ')}` });
                    sanitized[key] = def.default;
                } else {
                    sanitized[key] = val;
                }
                break;
            }
            case 'bool': {
                sanitized[key] = !!val;
                break;
            }
            case 'string': {
                sanitized[key] = String(val);
                break;
            }
            default:
                sanitized[key] = val;
        }
    }

    // Warn about unknown keys (but still pass them through)
    for (const key of Object.keys(params)) {
        if (key === '_meta') continue;
        if (!(key in schema)) {
            // Unknown key — pass through silently (forward compat)
            sanitized[key] = params[key];
        }
    }

    return { valid: errors.length === 0, errors, sanitized };
}

/**
 * Create default params from a schema.
 * @param {Object} schema
 * @returns {Object}
 */
export function defaultsFromSchema(schema) {
    const result = {};
    for (const [key, def] of Object.entries(schema)) {
        if (key === '_meta') continue;
        result[key] = def.default;
    }
    return result;
}

/**
 * Extract variation ranges from a schema (for VariationGenerator).
 * Returns { ranges, limits } where:
 *   ranges[key] = (max - min) * proportion
 *   limits[key] = [min, max]
 *
 * @param {Object} schema
 * @param {number} proportion - What fraction of the full range to vary (default 0.1 = 10%)
 * @returns {{ ranges: Object, limits: Object }}
 */
export function variationRangesFromSchema(schema, proportion = 0.1) {
    const ranges = {};
    const limits = {};

    for (const [key, def] of Object.entries(schema)) {
        if (key === '_meta') continue;
        if (def.type === 'float' || def.type === 'int') {
            ranges[key] = (def.max - def.min) * proportion;
            limits[key] = [def.min, def.max];
        }
    }

    return { ranges, limits };
}

/**
 * Get parameter groups from a schema (for UI grouping).
 * @param {Object} schema
 * @returns {Map<string, string[]>} group name → array of param keys
 */
export function getParamGroups(schema) {
    const groups = new Map();

    for (const [key, def] of Object.entries(schema)) {
        if (key === '_meta') continue;
        const group = def.group || 'general';
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(key);
    }

    return groups;
}
