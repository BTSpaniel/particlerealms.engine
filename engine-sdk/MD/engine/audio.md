---
title: Audio System
description: A fully procedural audio engine — node-graph patch synthesis, 30+ node types, material-to-sound mapping from particle state, spatial audio, and physical-modeling synths.
updated: 2026-06-05
---

# Audio System

A fully procedural audio engine with node-graph synthesis, material-to-sound mapping, spatial audio, and real-time particle-driven sound generation — no pre-recorded samples required.

## Architecture

Three execution paths converge on the same patch format:

```text
┌─────────────────────────────────────┐
│  Audio Editor (AudioEditorPanel.js)  │  ← main-thread preview
│  WebAudioNodeFactory → Web Audio     │
├─────────────────────────────────────┤
│  Worklet Runtime (PatchRunner)       │  ← production playback
│  NODE_PROCESSORS → AudioWorklet      │
├─────────────────────────────────────┤
│  Particle Bridge                     │  ← real-time mapping
│  ParticleAudioBridge.js → patches    │
└─────────────────────────────────────┘
```

## Patch system

A **patch** is a JSON descriptor defining a node graph of audio generators and processors — the universal currency of the audio system.

```javascript
// Example patch: simple sine with envelope
{
  nodes: [
    { id: 'osc', type: 'Oscillator', params: { waveform: 'sine', frequency: 440 } },
    { id: 'env', type: 'ADSR', params: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.3 } },
    { id: 'out', type: 'Output' }
  ],
  connections: [
    { from: 'osc', to: 'env' },
    { from: 'env', to: 'out' }
  ]
}
```

### Node types

30+ node types organized by category:

| Category | Node types |
| --- | --- |
| Generators | Oscillator, Noise, GrainCloud |
| Processors | Filter, Delay, Reverb, Compressor, Waveshaper |
| Modulators | LFO, ADSR, Envelope, RandomWalk |
| Physics models | KarplusStrong, CombFilter, FMOperator, Waveguide, ModalBank |
| Atoms | CrackleAtom, HissAtom, RumbleAtom, ImpactAtom |
| Output | Output, SoundBlender |

## Material-to-sound mapping

`ParticleAudioBridge` maps particle substance properties to audio parameters in real time, so burning, flowing, or colliding particles generate sound procedurally:

- **Temperature** → pitch, brightness, crackle intensity.
- **Density** → body/weight of the sound.
- **Velocity** → whoosh intensity, impact force.
- **Phase** → which procedural patch to use (fire, water, wind).

## Spatial audio

`SpatialAudioEnvironment.js` provides 3D positional audio with distance attenuation, reverb zones, and environmental effects. Sources are positioned in world space and attenuated by listener distance.

## Synthesis modules

- **Waveguide** — bidirectional delay-line physical model for string/tube sounds (damping, reflection, excitation).
- **Modal bank** — resonant filter bank with material presets (metal, glass, wood) using Bessel zeros for accurate modal frequencies.
- **Noise generator** — 8 noise colors via Voss-McCartney: white, pink, brown, blue, violet, velvet, grey, crackle.

## Key files

| File | Purpose |
| --- | --- |
| `audio/synth/WebAudioNodeFactory.js` | Main-thread node creation (30+ types) |
| `audio/synth/NodeRegistry.js` | Node type registry and categories |
| `audio/synth/nodes/WaveguideNode.js` | Physical modeling waveguide |
| `audio/synth/nodes/ModalBankNode.js` | Resonant modal bank |
| `audio/bridge/SubstanceAudioResolver.js` | Material→audio parameter mapping |
| `sim/particles/ParticleAudioBridge.js` | Particle→audio bridge |
| `audio/SpatialAudioEnvironment.js` | 3D spatial audio |
