// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WebAudioNodeFactory.js — Unified Web Audio Node Factory
 * 
 * Central factory for creating main-thread Web Audio nodes from patch graph
 * node definitions. Delegates to modular node files where possible.
 * 
 * Used by AudioEditorPanel.js for preview playback.
 * 
 * Usage:
 *   import { createWebAudioNode, buildVoice } from './WebAudioNodeFactory.js';
 *   const node = createWebAudioNode(ctx, { type: 'Waveguide', params: {...} }, pitchRatio);
 *   const voice = buildVoice(ctx, patchJSON, pitchRatio);
 */

import { createWaveguide } from './nodes/WaveguideNode.js';
import { createModalBank } from './nodes/ModalBankNode.js';
import { createNoiseBuffer } from './nodes/NoiseGeneratorNode.js';
import { createFormantFilter, setFormantVowel, FORMANT_PRESETS } from './nodes/FormantFilterNode.js';
import { uniformDistribution } from '../../core/math/MathRandom.js';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Normalize oscillator wave shape names to Web Audio API values.
 */
export function normalizeWaveShape(shape) {
  const s = String(shape || 'sine').toLowerCase();
  if (s === 'saw') return 'sawtooth';
  if (s === 'sawtooth' || s === 'sine' || s === 'square' || s === 'triangle') return s;
  return 'sine';
}

// ============================================================================
// VOICE BUILDER
// ============================================================================

/**
 * Build a complete voice from a patch graph, scaling frequencies by pitchRatio.
 * @param {AudioContext} ctx
 * @param {Object} patch - { nodes: [...], wires: [...] }
 * @param {number} pitchRatio
 * @returns {{ output: AudioNode, sources: AudioNode[], audioNodes: Map }|null}
 */
export function buildVoice(ctx, patch, pitchRatio = 1.0) {
  const audioNodes = new Map();
  const sources = [];

  for (const n of patch.nodes) {
    const created = createWebAudioNode(ctx, n, pitchRatio);
    if (created) {
      audioNodes.set(n.id, created);
      if (created.sources) sources.push(...created.sources);
    }
  }

  // Wire nodes together
  for (const wire of patch.wires) {
    const [fromId] = wire.from.split(':');
    const [toId, toPort] = wire.to.split(':');
    const fromNode = audioNodes.get(fromId);
    const toNode = audioNodes.get(toId);
    const toInput = toNode?.inputMap?.[toPort] ?? toNode?.input;
    if (fromNode?.output && toInput) {
      try { fromNode.output.connect(toInput); } catch (_) {}
    }
  }

  // Find output node
  const outputNodeDef = patch.nodes.find(n => n.type === 'Output');
  if (!outputNodeDef) return null;
  const outAudio = audioNodes.get(outputNodeDef.id);
  if (!outAudio?.output) return null;

  return { output: outAudio.output, sources, audioNodes };
}

// ============================================================================
// NODE FACTORY
// ============================================================================

/**
 * Create a Web Audio node (or subgraph) for a given patch graph node definition.
 * Returns { output, input, inputMap?, sources } or null.
 * 
 * @param {AudioContext} ctx
 * @param {Object} node - { id, type, params }
 * @param {number} pitchRatio - Frequency scaling factor
 * @returns {Object|null}
 */
export function createWebAudioNode(ctx, node, pitchRatio = 1.0) {
  const p = node.params || {};
  const sources = [];

  switch (node.type) {

    // ── Generators ──────────────────────────────────────────────────────

    case 'Oscillator': {
      const osc = ctx.createOscillator();
      osc.type = normalizeWaveShape(p.shape);
      osc.frequency.value = (p.frequency || 440) * pitchRatio;
      osc.detune.value = p.detune || 0;
      sources.push(osc);
      return { output: osc, input: null, sources };
    }

    case 'NoiseGenerator': {
      // Delegate to NoiseGeneratorNode.js for all 8 colors
      const color = p.color || 'white';
      const density = p.density ?? 50;
      const buffer = createNoiseBuffer(ctx, color, 2.0, { density });
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      sources.push(src);
      return { output: src, input: null, sources };
    }

    // ── Processors ──────────────────────────────────────────────────────

    case 'Filter': {
      const f = ctx.createBiquadFilter();
      f.type = p.type || 'lowpass';
      f.frequency.value = (p.frequency || 1000) * pitchRatio;
      f.Q.value = p.Q || 1.0;
      return { output: f, input: f, sources };
    }

    case 'Gain': {
      const g = ctx.createGain();
      g.gain.value = p.volume ?? 1.0;
      return { output: g, input: g, sources };
    }

    case 'Envelope': {
      // Auto-trigger envelope: ramp up then hold at sustain
      const g = ctx.createGain();
      const t = ctx.currentTime;
      const a = Math.max(0.001, p.attack || 0.01);
      const d = Math.max(0.001, p.decay || 0.1);
      const s = p.sustain ?? 0.7;
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(1.0, t + a);
      g.gain.linearRampToValueAtTime(Math.max(0.001, s), t + a + d);
      return { output: g, input: g, sources };
    }

    case 'LFO': {
      const osc = ctx.createOscillator();
      osc.type = normalizeWaveShape(p.shape);
      osc.frequency.value = p.rate || 1.0;
      const g = ctx.createGain();
      g.gain.value = p.depth || 1.0;
      osc.connect(g);
      sources.push(osc);
      return { output: g, input: null, sources };
    }

    case 'Delay': {
      const delay = ctx.createDelay(5);
      delay.delayTime.value = p.time || 0.25;
      // Simple feedback via gain
      const fbGain = ctx.createGain();
      fbGain.gain.value = p.feedback || 0.3;
      delay.connect(fbGain);
      fbGain.connect(delay);
      // Dry/wet mix
      const wetGain = ctx.createGain();
      wetGain.gain.value = p.mix ?? 0.5;
      delay.connect(wetGain);
      const dryGain = ctx.createGain();
      dryGain.gain.value = 1.0 - (p.mix ?? 0.5);
      const merger = ctx.createGain();
      wetGain.connect(merger);
      dryGain.connect(merger);
      // Input splits to delay and dry
      const input = ctx.createGain();
      input.connect(delay);
      input.connect(dryGain);
      return { output: merger, input, sources };
    }

    case 'Reverb': {
      // Simple convolution reverb with generated impulse
      const conv = ctx.createConvolver();
      const len = Math.max(0.1, (p.roomSize || 0.5) * 3) * ctx.sampleRate;
      const irBuf = ctx.createBuffer(2, len, ctx.sampleRate);
      const damp = p.damping ?? 0.5;
      for (let ch = 0; ch < 2; ch++) {
        const d = irBuf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          d[i] = uniformDistribution(-1, 1, Math.random) * Math.pow(1 - i / len, 1 + damp * 3);
        }
      }
      conv.buffer = irBuf;
      // Dry/wet
      const wetG = ctx.createGain();
      wetG.gain.value = p.mix ?? 0.3;
      conv.connect(wetG);
      const dryG = ctx.createGain();
      dryG.gain.value = 1.0 - (p.mix ?? 0.3);
      const out = ctx.createGain();
      wetG.connect(out);
      dryG.connect(out);
      const inp = ctx.createGain();
      inp.connect(conv);
      inp.connect(dryG);
      return { output: out, input: inp, sources };
    }

    case 'Compressor': {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = p.threshold ?? -12;
      comp.ratio.value = p.ratio ?? 4;
      comp.attack.value = p.attack ?? 0.003;
      comp.release.value = p.release ?? 0.1;
      return { output: comp, input: comp, sources };
    }

    case 'Waveshaper': {
      const ws = ctx.createWaveShaper();
      const samples = 256;
      const curve = new Float32Array(samples);
      const drive = p.drive || 1.0;
      for (let i = 0; i < samples; i++) {
        const x = (i / (samples - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * drive);
      }
      ws.curve = curve;
      ws.oversample = '2x';
      return { output: ws, input: ws, sources };
    }

    case 'CombFilter': {
      const delay = ctx.createDelay(1);
      delay.delayTime.value = p.delay || 0.01;
      const fbG = ctx.createGain();
      fbG.gain.value = p.feedback || 0.5;
      delay.connect(fbG);
      fbG.connect(delay);
      const inp = ctx.createGain();
      inp.connect(delay);
      return { output: delay, input: inp, sources };
    }

    case 'Output': {
      // Pass-through — will be connected to master gain externally
      const g = ctx.createGain();
      g.gain.value = 1.0;
      return { output: g, input: g, sources };
    }

    // ── Synthesis (delegated to modular node files) ─────────────────────

    case 'Waveguide': {
      // Delegate to WaveguideNode.js createWaveguide()
      const wg = createWaveguide(ctx, {
        frequency: (p.frequency || 220) * pitchRatio,
        damping: p.damping ?? 0.5,
        feedback: Math.min(0.999, p.feedback ?? 0.99),
        brightness: p.brightness ?? 0.5,
        mode: p.mode || 'string',
      });
      return {
        output: wg.output,
        input: wg.input,
        inputMap: { excitation: wg.input },
        sources,
        _engine: wg,
      };
    }

    case 'ModalBank': {
      // Delegate to ModalBankNode.js createModalBank()
      const mb = createModalBank(ctx, {
        frequency: (p.frequency || 440) * pitchRatio,
        material: p.material || 'metal',
        modeCount: Math.min(16, p.modeCount || 8),
        damping: p.damping,
        brightness: p.brightness,
        inharmonicity: p.inharmonicity,
        strikePosition: p.strikePosition ?? 0.5,
      });
      // Create an input gain to fan out to all resonator filters
      const inp = ctx.createGain();
      inp.gain.value = 1.0;
      mb.connectExcitation(inp);
      return {
        output: mb.output,
        input: inp,
        inputMap: { excitation: inp },
        sources,
        _engine: mb,
      };
    }

    case 'KarplusStrong': {
      // Karplus-Strong: noise burst → tuned delay line with filtered feedback
      const freq = (p.frequency || 220) * pitchRatio;
      const decay = p.decay ?? 2.0;
      const brightness = p.brightness ?? 0.5;
      const vol = p.volume ?? 0.8;

      // Excitation: short noise burst (~2ms)
      const burstLen = Math.ceil(ctx.sampleRate * 0.003);
      const burstBuf = ctx.createBuffer(1, burstLen, ctx.sampleRate);
      const bd = burstBuf.getChannelData(0);
      const excType = p.excitation || 'noise';
      if (excType === 'impulse') {
        bd[0] = 1.0;
      } else if (excType === 'sine') {
        for (let i = 0; i < burstLen; i++) bd[i] = Math.sin(2 * Math.PI * freq * i / ctx.sampleRate);
      } else {
        for (let i = 0; i < burstLen; i++) bd[i] = uniformDistribution(-1, 1, Math.random);
      }
      const burst = ctx.createBufferSource();
      burst.buffer = burstBuf;
      sources.push(burst);

      // Tuned delay line (period = 1/freq)
      const delayTime = 1 / freq;
      const dl = ctx.createDelay(1);
      dl.delayTime.value = delayTime;

      // Feedback gain — controls decay
      const fbGain = ctx.createGain();
      const fbVal = Math.pow(0.001, delayTime / Math.max(0.01, decay));
      fbGain.gain.value = Math.min(0.999, fbVal);

      // Lowpass in feedback loop — brightness
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.value = 1000 + brightness * 15000;
      lpf.Q.value = 0.5;

      // Wire feedback loop: delay → lpf → fbGain → delay
      dl.connect(lpf);
      lpf.connect(fbGain);
      fbGain.connect(dl);

      // Burst feeds into the delay line
      const inputGain = ctx.createGain();
      inputGain.gain.value = 1.0;
      burst.connect(inputGain);
      inputGain.connect(dl);

      // Output tap from delay
      const outGain = ctx.createGain();
      outGain.gain.value = vol;
      dl.connect(outGain);

      return { output: outGain, input: inputGain, sources };
    }

    case 'FMOperator': {
      // FM synthesis: internal modulator + optional external modulation input
      const carrierFreq = (p.carrierFreq ?? p.frequency ?? 440) * pitchRatio;
      const modRatio = p.modRatio ?? p.ratio ?? 2.0;
      const modDepth = (p.modDepth ?? p.depth ?? 200) * pitchRatio;
      const vol = p.volume ?? 0.7;
      const t = ctx.currentTime;

      // Carrier oscillator
      const carrier = ctx.createOscillator();
      carrier.type = 'sine';
      carrier.frequency.value = carrierFreq;
      sources.push(carrier);

      // Modulator oscillator
      const mod = ctx.createOscillator();
      mod.type = 'sine';
      mod.frequency.value = carrierFreq * modRatio;
      sources.push(mod);

      // Modulation depth gain
      const modGain = ctx.createGain();
      const ma = Math.max(0.001, p.modAttack || 0.001);
      const md = Math.max(0.001, p.modDecay || 0.3);
      const ms = p.modSustain ?? 0.2;
      modGain.gain.setValueAtTime(0.001, t);
      modGain.gain.linearRampToValueAtTime(modDepth, t + ma);
      modGain.gain.linearRampToValueAtTime(Math.max(0.001, modDepth * ms), t + ma + md);

      mod.connect(modGain);
      modGain.connect(carrier.frequency);

      // Carrier envelope
      const envGain = ctx.createGain();
      const ca = Math.max(0.001, p.attack || 0.005);
      const cd = Math.max(0.001, p.decay || 0.2);
      const cs = p.sustain ?? 0.5;
      envGain.gain.setValueAtTime(0.001, t);
      envGain.gain.linearRampToValueAtTime(vol, t + ca);
      envGain.gain.linearRampToValueAtTime(Math.max(0.001, vol * cs), t + ca + cd);

      carrier.connect(envGain);

      return {
        output: envGain,
        input: carrier.frequency,
        inputMap: { modulation: carrier.frequency },
        sources,
      };
    }

    case 'FormantFilter': {
      // Delegate to FormantFilterNode.js createFormantFilter()
      const vowel = p.vowel || 'A';
      const ff = createFormantFilter(ctx, {
        vowel,
        formantCount: Math.min(p.formantCount || 5, 5),
        volume: p.volume ?? 1.0,
      });
      // Apply initial vowel
      if (FORMANT_PRESETS[vowel]) {
        setFormantVowel(ff, vowel);
      }
      return { output: ff.output, input: ff.input, sources };
    }

    case 'ModalImpactModel': {
      // Modal synthesis: sum of decaying sinusoids at harmonic/inharmonic frequencies
      const freq = (p.frequency || 440) * pitchRatio;
      const modes = p.modes || 6;
      const decay = p.decay ?? 1.0;
      const spread = p.spread ?? 1.0;
      const vol = p.volume ?? 0.7;
      const t = ctx.currentTime;

      const out = ctx.createGain();
      out.gain.value = vol / modes;

      for (let i = 0; i < modes; i++) {
        const ratio = (i + 1) + spread * i * 0.03 * (i + 1);
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * ratio;
        sources.push(osc);

        const env = ctx.createGain();
        const modeDecay = decay / (1 + i * 0.5);
        env.gain.setValueAtTime(1.0, t);
        env.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.01, modeDecay));
        osc.connect(env);
        env.connect(out);
      }
      return { output: out, input: null, sources };
    }

    // ── Atoms ───────────────────────────────────────────────────────────

    case 'CrackleAtom': case 'HissAtom': {
      const bufSize = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) d[i] = uniformDistribution(-1, 1, Math.random);
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = node.type === 'CrackleAtom' ? 3000 : 2000;
      const g = ctx.createGain();
      g.gain.value = p.volume ?? 0.5;
      src.connect(f); f.connect(g);
      sources.push(src);
      return { output: g, input: null, sources };
    }

    case 'WhooshAtom': {
      const bufSize = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) d[i] = uniformDistribution(-1, 1, Math.random);
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = p.centerFreq || 500; f.Q.value = 2;
      sources.push(src);
      src.connect(f);
      return { output: f, input: null, sources };
    }

    case 'DropAtom': {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(p.pitch || 400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(p.amplitude || 0.8, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
      osc.connect(g);
      sources.push(osc);
      return { output: g, input: null, sources };
    }

    case 'RumbleAtom': {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = (p.cutoff || 40) * pitchRatio;
      const g = ctx.createGain();
      g.gain.value = p.volume || 0.6;
      osc.connect(g);
      sources.push(osc);
      return { output: g, input: null, sources };
    }

    // ── Physics Models ──────────────────────────────────────────────────

    case 'CombustionModel': {
      // Fire/combustion: layered filtered noise (low rumble + mid crackle + high hiss)
      const vol = p.volume ?? 0.6;
      const intensity = p.intensity ?? 0.5;
      const out = ctx.createGain();
      out.gain.value = vol;
      const bands = [
        { type: 'lowpass', freq: 200, gain: 0.6 + intensity * 0.4 },
        { type: 'bandpass', freq: 800 + intensity * 1200, gain: 0.4 },
        { type: 'highpass', freq: 3000 + intensity * 3000, gain: 0.2 * intensity },
      ];
      for (const b of bands) {
        const bufSize = ctx.sampleRate * 2;
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) d[i] = uniformDistribution(-1, 1, Math.random);
        const src = ctx.createBufferSource();
        src.buffer = buf; src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = b.type; f.frequency.value = b.freq; f.Q.value = 1.5;
        const g = ctx.createGain(); g.gain.value = b.gain;
        src.connect(f); f.connect(g); g.connect(out);
        sources.push(src);
      }
      return { output: out, input: null, sources };
    }

    case 'FluidModel': {
      // Water/fluid: filtered noise with slow LFO modulating bandpass
      const vol = p.volume ?? 0.5;
      const flow = p.flow ?? 0.5;
      const bufSize = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) d[i] = uniformDistribution(-1, 1, Math.random);
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      sources.push(src);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 400 + flow * 800; bp.Q.value = 1.0;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = 0.3 + flow * 2;
      const lfoG = ctx.createGain(); lfoG.gain.value = 200 + flow * 500;
      lfo.connect(lfoG); lfoG.connect(bp.frequency);
      sources.push(lfo);
      const g = ctx.createGain(); g.gain.value = vol;
      src.connect(bp); bp.connect(g);
      return { output: g, input: null, sources };
    }

    case 'WindModel': {
      // Wind: shaped noise with slow amplitude modulation
      const vol = p.volume ?? 0.5;
      const speed = p.speed ?? 0.5;
      const bufSize = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) d[i] = uniformDistribution(-1, 1, Math.random);
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      sources.push(src);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 300 + speed * 1500; bp.Q.value = 0.5;
      const ampLfo = ctx.createOscillator();
      ampLfo.type = 'sine'; ampLfo.frequency.value = 0.1 + speed * 0.5;
      const ampG = ctx.createGain(); ampG.gain.value = vol * 0.3;
      const outG = ctx.createGain(); outG.gain.value = vol * 0.7;
      ampLfo.connect(ampG); ampG.connect(outG.gain);
      sources.push(ampLfo);
      src.connect(bp); bp.connect(outG);
      return { output: outG, input: null, sources };
    }

    case 'WeatherModel': {
      // Weather: very low rumble + rain-like noise
      const vol = p.volume ?? 0.4;
      const out = ctx.createGain(); out.gain.value = vol;
      // Thunder rumble
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = 30 * pitchRatio;
      const rumG = ctx.createGain(); rumG.gain.value = 0.3;
      osc.connect(rumG); rumG.connect(out);
      sources.push(osc);
      // Rain noise
      const bufSize = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const dd = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) dd[i] = uniformDistribution(-1, 1, Math.random);
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 4000; hp.Q.value = 0.5;
      const rainG = ctx.createGain(); rainG.gain.value = 0.5;
      src.connect(hp); hp.connect(rainG); rainG.connect(out);
      sources.push(src);
      return { output: out, input: null, sources };
    }

    // ── Utility ─────────────────────────────────────────────────────────

    case 'SoundBlender': {
      // Pass-through mixer — actual blending is done via wiring
      const g = ctx.createGain();
      g.gain.value = p.masterVolume ?? 1.0;
      return { output: g, input: g, sources };
    }

    case 'GrainCloud': {
      // Granular: rapid micro-grains of noise
      const vol = p.volume ?? 0.8;
      const density = p.density || 20;
      const grainSize = p.grainSize || 0.08;
      const totalLen = Math.max(0.5, density * grainSize * 2);
      const bufSize = Math.ceil(ctx.sampleRate * totalLen);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const d = buf.getChannelData(0);
      const grainSamples = Math.ceil(grainSize * ctx.sampleRate);
      const spaceSamples = Math.ceil(ctx.sampleRate / density);
      for (let pos = 0; pos < bufSize; pos += spaceSamples) {
        for (let g = 0; g < grainSamples && pos + g < bufSize; g++) {
          const env = Math.sin(Math.PI * g / grainSamples);
          d[pos + g] = uniformDistribution(-1, 1, Math.random) * env;
        }
      }
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      src.playbackRate.value = (p.pitchBase || 1.0) * pitchRatio;
      sources.push(src);
      const g = ctx.createGain(); g.gain.value = vol;
      src.connect(g);
      return { output: g, input: null, sources };
    }

    case 'GameParam': case 'MathOp': case 'RandomWalk': {
      // Control/modulation nodes — pass-through with constant offset
      const g = ctx.createGain();
      g.gain.value = p.value ?? 1.0;
      return { output: g, input: g, sources };
    }

    default: {
      // Unknown type — pass-through gain node
      const g = ctx.createGain();
      g.gain.value = 1.0;
      return { output: g, input: g, sources };
    }
  }
}
