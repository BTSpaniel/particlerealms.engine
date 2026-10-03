// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PatchRunner.worklet.js - AudioWorkletProcessor
 * 
 * Executes a compiled patch graph at sample rate (128 samples/block).
 * Receives compiled plans via MessagePort, reads game params from
 * SharedArrayBuffer, and outputs synthesized audio.
 * 
 * Register with: audioContext.audioWorklet.addModule('PatchRunner.worklet.js')
 */

// ============================================================================
// NODE PROCESSORS (sample-level DSP)
// ============================================================================

const TWO_PI = Math.PI * 2;

const NODE_PROCESSORS = {
  // --- GENERATORS ---

  Oscillator: {
    init(state, params) {
      state.phase = 0;
    },
    process(state, params, inputs, output, blockSize, sampleRate) {
      const freq = params.frequency || 440;
      const detune = params.detune || 0;
      const actualFreq = freq * Math.pow(2, detune / 1200);
      const phaseInc = actualFreq / sampleRate;
      const shape = params.shape || 'sine';

      for (let i = 0; i < blockSize; i++) {
        let sample = 0;
        switch (shape) {
          case 'sine':
            sample = Math.sin(state.phase * TWO_PI);
            break;
          case 'saw':
            sample = 2 * (state.phase - Math.floor(state.phase + 0.5));
            break;
          case 'square':
            sample = state.phase % 1 < 0.5 ? 1 : -1;
            break;
          case 'triangle':
            sample = 4 * Math.abs((state.phase % 1) - 0.5) - 1;
            break;
        }
        output[i] = sample;
        state.phase += phaseInc;
        if (state.phase >= 1) state.phase -= 1;
      }
    },
  },

  NoiseGenerator: {
    init(state, params) {
      state.b0 = 0; state.b1 = 0; state.b2 = 0;
      state.b3 = 0; state.b4 = 0; state.b5 = 0; state.b6 = 0;
      state.lastBrown = 0;
      state.lastBlue = 0;
      state.cracklePhase = 0;
      state.nextCrackle = 0;
      state.velvetPhase = 0;
      state.nextVelvet = 0;
    },
    process(state, params, inputs, output, blockSize, sampleRate) {
      const color = params.color || 'white';
      const density = params.density ?? 50;
      for (let i = 0; i < blockSize; i++) {
        const white = Math.random() * 2 - 1;
        switch (color) {
          case 'pink':
            state.b0 = 0.99886 * state.b0 + white * 0.0555179;
            state.b1 = 0.99332 * state.b1 + white * 0.0750759;
            state.b2 = 0.96900 * state.b2 + white * 0.1538520;
            state.b3 = 0.86650 * state.b3 + white * 0.3104856;
            state.b4 = 0.55000 * state.b4 + white * 0.5329522;
            state.b5 = -0.7616 * state.b5 - white * 0.0168980;
            output[i] = (state.b0 + state.b1 + state.b2 + state.b3 + state.b4 + state.b5 + state.b6 + white * 0.5362) * 0.11;
            state.b6 = white * 0.115926;
            break;
          case 'brown':
            state.lastBrown = (state.lastBrown + (0.02 * white)) / 1.02;
            output[i] = state.lastBrown * 3.5;
            break;
          case 'blue':
            // Differentiated white noise (high frequency emphasis)
            output[i] = white - state.lastBlue;
            state.lastBlue = white;
            break;
          case 'violet':
            // Double-differentiated (even more high frequency)
            const diff = white - state.lastBlue;
            output[i] = diff - state.b0;
            state.b0 = diff;
            state.lastBlue = white;
            break;
          case 'grey':
            // A-weighted approximation (perceptually flat)
            state.b0 = 0.99886 * state.b0 + white * 0.0555179;
            state.b1 = 0.99332 * state.b1 + white * 0.0750759;
            const pink = (state.b0 + state.b1 + white * 0.5) * 0.3;
            output[i] = (pink + white * 0.5) * 0.7;
            break;
          case 'velvet':
            // Sparse random impulses (velvet noise)
            if (state.velvetPhase >= state.nextVelvet) {
              output[i] = (Math.random() > 0.5 ? 1 : -1) * (0.7 + Math.random() * 0.3);
              const interval = sampleRate / Math.max(density, 1);
              state.nextVelvet = state.velvetPhase + interval * (0.5 + Math.random());
            } else {
              output[i] = 0;
            }
            state.velvetPhase++;
            break;
          case 'crackle':
            // Impulse bursts with noise tails (fire crackle pops)
            if (state.cracklePhase >= state.nextCrackle) {
              // Start a new crackle pop
              const burstLen = Math.floor(sampleRate * 0.002 * (0.5 + Math.random()));
              state.crackleLen = burstLen;
              state.crackleAmp = 0.8 + Math.random() * 0.2;
              state.cracklePos = 0;
              const interval = sampleRate / Math.max(density, 1);
              state.nextCrackle = state.cracklePhase + interval * (0.3 + Math.random() * 1.4);
            }
            if (state.cracklePos < state.crackleLen) {
              // Exponential decay burst with noise
              const env = Math.exp(-state.cracklePos / (state.crackleLen * 0.3));
              output[i] = (Math.random() * 2 - 1) * env * state.crackleAmp;
              state.cracklePos++;
            } else {
              output[i] = 0;
            }
            state.cracklePhase++;
            break;
          default: // white
            output[i] = white;
            break;
        }
      }
    },
  },

  Impulse: {
    init(state, params) {
      state.phase = 0;
      state.nextImpulse = 0;
    },
    process(state, params, inputs, output, blockSize, sampleRate) {
      const rate = params.rate || 10;
      const jitter = params.jitter || 0;
      const interval = sampleRate / Math.max(rate, 0.1);

      for (let i = 0; i < blockSize; i++) {
        if (state.phase >= state.nextImpulse) {
          output[i] = 1.0;
          const jitterAmount = jitter * interval * (Math.random() * 2 - 1);
          state.nextImpulse = state.phase + interval + jitterAmount;
        } else {
          output[i] = 0;
        }
        state.phase++;
      }
    },
  },

  // --- PROCESSORS ---

  Filter: {
    init(state, params) {
      state.x1 = 0; state.x2 = 0;
      state.y1 = 0; state.y2 = 0;
      state.a0 = 1; state.a1 = 0; state.a2 = 0;
      state.b1 = 0; state.b2 = 0;
      state._lastFreq = -1; state._lastQ = -1; state._lastType = '';
    },
    process(state, params, inputs, output, blockSize, sampleRate) {
      const input = inputs.in;
      const freq = Math.max(20, Math.min(sampleRate * 0.49, params.frequency || 1000));
      const Q = Math.max(0.1, params.Q || 1.0);
      const type = params.type || 'lowpass';

      // Recompute coefficients if params changed
      if (freq !== state._lastFreq || Q !== state._lastQ || type !== state._lastType) {
        _computeBiquadCoeffs(state, type, freq, Q, sampleRate);
        state._lastFreq = freq;
        state._lastQ = Q;
        state._lastType = type;
      }

      for (let i = 0; i < blockSize; i++) {
        const x0 = input ? input[i] : 0;
        const y0 = state.a0 * x0 + state.a1 * state.x1 + state.a2 * state.x2
                    - state.b1 * state.y1 - state.b2 * state.y2;
        state.x2 = state.x1; state.x1 = x0;
        state.y2 = state.y1; state.y1 = y0;
        output[i] = y0;
      }
    },
  },

  Gain: {
    init() {},
    process(state, params, inputs, output, blockSize) {
      const input = inputs.in;
      const vol = params.volume ?? 1.0;
      for (let i = 0; i < blockSize; i++) {
        output[i] = (input ? input[i] : 0) * vol;
      }
    },
  },

  Envelope: {
    init(state) {
      state.stage = 0; // 0=idle, 1=attack, 2=decay, 3=sustain, 4=release
      state.level = 0;
      state.gateWasOn = false;
    },
    process(state, params, inputs, output, blockSize, sampleRate) {
      const gate = inputs.gate;
      const a = Math.max(0.001, params.attack || 0.01);
      const d = Math.max(0.001, params.decay || 0.1);
      const s = params.sustain ?? 0.7;
      const r = Math.max(0.001, params.release || 0.3);

      const attackRate = 1.0 / (a * sampleRate);
      const decayRate = 1.0 / (d * sampleRate);
      const releaseRate = 1.0 / (r * sampleRate);

      for (let i = 0; i < blockSize; i++) {
        const gateOn = gate ? gate[i] > 0.5 : false;

        if (gateOn && !state.gateWasOn) {
          state.stage = 1; // Attack
        } else if (!gateOn && state.gateWasOn) {
          state.stage = 4; // Release
        }
        state.gateWasOn = gateOn;

        switch (state.stage) {
          case 1: // Attack
            state.level += attackRate;
            if (state.level >= 1.0) { state.level = 1.0; state.stage = 2; }
            break;
          case 2: // Decay
            state.level -= decayRate * (state.level - s);
            if (state.level <= s + 0.001) { state.level = s; state.stage = 3; }
            break;
          case 3: // Sustain
            state.level = s;
            break;
          case 4: // Release
            state.level -= releaseRate * state.level;
            if (state.level <= 0.001) { state.level = 0; state.stage = 0; }
            break;
          default:
            state.level = 0;
            break;
        }
        output[i] = state.level;
      }
    },
  },

  // --- MODULATORS ---

  LFO: {
    init(state) { state.phase = 0; },
    process(state, params, inputs, output, blockSize, sampleRate) {
      const rate = params.rate || 1.0;
      const depth = params.depth || 1.0;
      const shape = params.shape || 'sine';
      const phaseInc = rate / sampleRate;

      for (let i = 0; i < blockSize; i++) {
        let val = 0;
        switch (shape) {
          case 'sine': val = Math.sin(state.phase * TWO_PI); break;
          case 'saw': val = 2 * (state.phase % 1) - 1; break;
          case 'square': val = state.phase % 1 < 0.5 ? 1 : -1; break;
          case 'triangle': val = 4 * Math.abs((state.phase % 1) - 0.5) - 1; break;
        }
        output[i] = val * depth;
        state.phase += phaseInc;
        if (state.phase >= 1) state.phase -= 1;
      }
    },
  },

  GameParam: {
    init(state) { state.value = 0; },
    process(state, params, inputs, output, blockSize) {
      // Value updated externally via SharedArrayBuffer
      const val = state.value ?? params.defaultValue ?? 0;
      for (let i = 0; i < blockSize; i++) {
        output[i] = val;
      }
    },
  },

  MathOp: {
    init() {},
    process(state, params, inputs, output, blockSize) {
      const a = inputs.a;
      const b = inputs.b;
      const op = params.operation || 'add';

      for (let i = 0; i < blockSize; i++) {
        const va = a ? a[i] : 0;
        const vb = b ? b[i] : (params.operand ?? 0);
        switch (op) {
          case 'add': output[i] = va + vb; break;
          case 'mul': output[i] = va * vb; break;
          case 'sub': output[i] = va - vb; break;
          case 'div': output[i] = vb !== 0 ? va / vb : 0; break;
          case 'clamp': output[i] = Math.max(params.min ?? 0, Math.min(params.max ?? 1, va)); break;
          case 'abs': output[i] = Math.abs(va); break;
          case 'pow': output[i] = Math.pow(Math.abs(va), vb) * Math.sign(va); break;
          default: output[i] = va; break;
        }
      }
    },
  },

  // --- PHYSICAL MODELING ---

  Waveguide: {
    init(state, params) {
      const sampleRate = 48000; // Will be overwritten on first process
      const maxDelay = Math.ceil(sampleRate / 20); // Support down to 20 Hz
      state.delayLine = new Float32Array(maxDelay);
      state.delayLength = maxDelay;
      state.writePos = 0;
      state.lpState = 0;
      state.allpassState = 0;
      state.sampleRate = sampleRate;
    },
    process(state, params, inputs, output, blockSize, sampleRate) {
      const excitation = inputs.excitation;
      const frequency = Math.max(20, params.frequency || 220);
      const feedback = Math.min(0.9999, params.feedback ?? 0.99);
      const damping = params.damping ?? 0.5;
      const brightness = params.brightness ?? 0.5;
      const mode = params.mode || 'string';

      // Calculate delay length from frequency
      const delayLength = Math.max(2, Math.floor(sampleRate / frequency));
      
      // Ensure delay line is big enough
      if (delayLength > state.delayLine.length) {
        const newLine = new Float32Array(delayLength + 128);
        newLine.set(state.delayLine);
        state.delayLine = newLine;
      }

      // LP filter coefficient (damping)
      const lpCoeff = (1 - brightness) * 0.5 + damping * 0.3;
      
      // Reflection coefficient based on mode
      const reflectSign = mode === 'string' ? -1 : 1;

      for (let i = 0; i < blockSize; i++) {
        // Read from delay line
        let readPos = state.writePos - delayLength;
        if (readPos < 0) readPos += state.delayLine.length;
        
        const delayed = state.delayLine[readPos];
        
        // LP filter at reflection
        state.lpState = delayed * (1 - lpCoeff) + state.lpState * lpCoeff;
        
        // Apply feedback and reflection
        let reflected = state.lpState * feedback * reflectSign;
        
        // Add excitation
        const exc = excitation ? excitation[i] * 0.3 : 0;
        
        // Write to delay line
        state.delayLine[state.writePos] = reflected + exc;
        
        // Output
        output[i] = delayed;
        
        state.writePos++;
        if (state.writePos >= state.delayLine.length) state.writePos = 0;
      }
    },
  },

  ModalBank: {
    init(state, params) {
      // Initialize modal resonators
      state.modes = [];
      state.initialized = false;
    },
    process(state, params, inputs, output, blockSize, sampleRate) {
      const excitation = inputs.excitation;
      const frequency = params.frequency || 440;
      const modeCount = Math.min(24, params.modeCount || 12);
      const damping = params.damping ?? 0.5;
      const brightness = params.brightness ?? 0.5;
      const material = params.material || 'metal';
      const inharmonicity = params.inharmonicity ?? 0;

      // Initialize modes if needed
      if (!state.initialized || state.modes.length !== modeCount) {
        state.modes = [];
        for (let m = 0; m < modeCount; m++) {
          // Calculate mode frequency based on material
          let ratio;
          switch (material) {
            case 'metal':
            case 'bell':
              // Inharmonic: f_n = f_0 * sqrt(n^2 + B*n^4)
              ratio = Math.sqrt((m + 1) * (m + 1) + inharmonicity * Math.pow(m + 1, 4) * 0.0001);
              break;
            case 'glass':
              // Glass modes
              ratio = Math.pow(m + 1, 1.5) * 0.7;
              break;
            case 'wood':
              // Wood is more harmonic
              ratio = (m + 1) * (1 + inharmonicity * m * 0.01);
              break;
            case 'membrane':
              // Bessel zeros approximation
              ratio = [1, 1.59, 2.14, 2.30, 2.65, 2.92, 3.16, 3.50, 3.60, 3.65, 4.06, 4.15][m] || (m + 1);
              break;
            default:
              ratio = m + 1;
          }
          
          const modeFreq = frequency * ratio;
          const modeDecay = Math.exp(-damping * (1 + m * 0.5) * 0.001);
          const modeAmp = Math.pow(0.7, m) * (1 - m * (1 - brightness) * 0.05);
          
          state.modes.push({
            freq: modeFreq,
            decay: modeDecay,
            amp: Math.max(0, modeAmp),
            phase: 0,
            energy: 0,
          });
        }
        state.initialized = true;
      }

      // Clear output
      for (let i = 0; i < blockSize; i++) output[i] = 0;

      // Process each mode
      const TWO_PI = Math.PI * 2;
      for (const mode of state.modes) {
        if (mode.freq > sampleRate * 0.45) continue; // Skip modes above Nyquist
        
        const phaseInc = mode.freq / sampleRate;
        
        for (let i = 0; i < blockSize; i++) {
          // Add excitation energy
          if (excitation) {
            mode.energy += Math.abs(excitation[i]) * mode.amp;
          }
          
          // Decay energy
          mode.energy *= mode.decay;
          
          // Generate resonance
          if (mode.energy > 0.0001) {
            output[i] += Math.sin(mode.phase * TWO_PI) * mode.energy * 0.15;
          }
          
          mode.phase += phaseInc;
          if (mode.phase >= 1) mode.phase -= 1;
        }
      }
    },
  },

  // --- EFFECTS (sync: WebAudioNodeFactory.js) ---

  Delay: {
    init(state, params) {
      const maxSamples = Math.ceil(48000 * 5);
      state.buffer = new Float32Array(maxSamples);
      state.writePos = 0;
      state.bufLen = maxSamples;
    },
    process(state, params, inputs, output, blockSize, sampleRate) {
      const input = inputs.in;
      const time = Math.max(0.001, params.time || 0.25);
      const feedback = Math.min(0.98, params.feedback || 0.3);
      const mix = params.mix ?? 0.5;
      const delaySamples = Math.min(state.bufLen - 1, Math.floor(time * sampleRate));

      for (let i = 0; i < blockSize; i++) {
        const dry = input ? input[i] : 0;
        const readPos = (state.writePos - delaySamples + state.bufLen) % state.bufLen;
        const wet = state.buffer[readPos];
        state.buffer[state.writePos] = dry + wet * feedback;
        state.writePos = (state.writePos + 1) % state.bufLen;
        output[i] = dry * (1 - mix) + wet * mix;
      }
    },
  },

  Reverb: {
    init(state) {
      // Simple Schroeder reverb with 4 comb filters + 2 allpass
      const combLengths = [1557, 1617, 1491, 1422];
      const allpassLengths = [225, 556];
      state.combs = combLengths.map(len => ({ buf: new Float32Array(len), pos: 0, len }));
      state.allpasses = allpassLengths.map(len => ({ buf: new Float32Array(len), pos: 0, len }));
    },
    process(state, params, inputs, output, blockSize) {
      const input = inputs.in;
      const mix = params.mix ?? 0.3;
      const damping = params.damping ?? 0.5;
      const roomSize = Math.min(0.98, params.roomSize ?? 0.5);

      for (let i = 0; i < blockSize; i++) {
        const dry = input ? input[i] : 0;
        let wet = 0;

        // Sum of comb filters
        for (const comb of state.combs) {
          const delayed = comb.buf[comb.pos];
          comb.buf[comb.pos] = dry + delayed * roomSize * (1 - damping * 0.5);
          comb.pos = (comb.pos + 1) % comb.len;
          wet += delayed;
        }
        wet *= 0.25;

        // Series allpass
        for (const ap of state.allpasses) {
          const delayed = ap.buf[ap.pos];
          const tmp = wet + delayed * 0.5;
          ap.buf[ap.pos] = wet - delayed * 0.5;
          ap.pos = (ap.pos + 1) % ap.len;
          wet = tmp;
        }

        output[i] = dry * (1 - mix) + wet * mix;
      }
    },
  },

  Compressor: {
    init(state) {
      state.envelope = 0;
    },
    process(state, params, inputs, output, blockSize, sampleRate) {
      const input = inputs.in;
      const threshold = params.threshold ?? -12;
      const ratio = Math.max(1, params.ratio ?? 4);
      const attack = Math.max(0.0001, params.attack ?? 0.003);
      const release = Math.max(0.001, params.release ?? 0.1);
      const threshLin = Math.pow(10, threshold / 20);
      const attackCoeff = Math.exp(-1 / (attack * sampleRate));
      const releaseCoeff = Math.exp(-1 / (release * sampleRate));

      for (let i = 0; i < blockSize; i++) {
        const x = input ? input[i] : 0;
        const absX = Math.abs(x);
        state.envelope = absX > state.envelope
          ? attackCoeff * state.envelope + (1 - attackCoeff) * absX
          : releaseCoeff * state.envelope + (1 - releaseCoeff) * absX;
        let gain = 1;
        if (state.envelope > threshLin) {
          gain = threshLin * Math.pow(state.envelope / threshLin, 1 / ratio - 1);
        }
        output[i] = x * gain;
      }
    },
  },

  Waveshaper: {
    init() {},
    process(state, params, inputs, output, blockSize) {
      const input = inputs.in;
      const drive = params.drive || 1.0;
      for (let i = 0; i < blockSize; i++) {
        const x = input ? input[i] * drive : 0;
        output[i] = Math.tanh(x);
      }
    },
  },

  CombFilter: {
    init(state) {
      state.buffer = new Float32Array(48000);
      state.writePos = 0;
    },
    process(state, params, inputs, output, blockSize, sampleRate) {
      const input = inputs.in;
      const delay = Math.max(0.0001, params.delay || 0.01);
      const feedback = Math.min(0.99, params.feedback || 0.5);
      const delaySamples = Math.min(state.buffer.length - 1, Math.floor(delay * sampleRate));
      for (let i = 0; i < blockSize; i++) {
        const dry = input ? input[i] : 0;
        const readPos = (state.writePos - delaySamples + state.buffer.length) % state.buffer.length;
        const delayed = state.buffer[readPos];
        state.buffer[state.writePos] = dry + delayed * feedback;
        state.writePos = (state.writePos + 1) % state.buffer.length;
        output[i] = delayed;
      }
    },
  },

  // --- ADVANCED SYNTHESIS (sync: WebAudioNodeFactory.js) ---

  KarplusStrong: {
    init(state, params) {
      const maxDelay = Math.ceil(48000 / 20);
      state.buffer = new Float32Array(maxDelay);
      state.writePos = 0;
      state.prevFiltered = 0;
      state.excited = false;
    },
    process(state, params, inputs, output, blockSize, sampleRate) {
      const freq = params.frequency || 220;
      const decay = params.decay ?? 2.0;
      const brightness = params.brightness ?? 0.5;
      const vol = params.volume ?? 0.8;
      const delaySamples = Math.max(2, Math.round(sampleRate / freq));
      const lpCoeff = (1 - brightness) * 0.5;
      const decayFactor = Math.pow(0.001, 1.0 / (decay * sampleRate));

      // Self-excite with noise burst on first block
      if (!state.excited) {
        for (let i = 0; i < Math.min(delaySamples, state.buffer.length); i++) {
          state.buffer[i] = (Math.random() * 2 - 1);
        }
        state.excited = true;
      }

      for (let i = 0; i < blockSize; i++) {
        const readPos = (state.writePos - delaySamples + state.buffer.length) % state.buffer.length;
        const sample = state.buffer[readPos];
        const filtered = sample * (1 - lpCoeff) + state.prevFiltered * lpCoeff;
        state.prevFiltered = filtered;
        state.buffer[state.writePos] = filtered * decayFactor;
        state.writePos = (state.writePos + 1) % state.buffer.length;
        output[i] = sample * vol;
      }
    },
  },

  FMOperator: {
    init(state) {
      state.carrierPhase = 0;
      state.modPhase = 0;
      state.envLevel = 0;
      state.modEnvLevel = 0;
      state.time = 0;
    },
    process(state, params, inputs, output, blockSize, sampleRate) {
      const carrierFreq = params.carrierFreq ?? params.frequency ?? 440;
      const modRatio = params.modRatio ?? params.ratio ?? 2.0;
      const modDepth = params.modDepth ?? params.depth ?? 200;
      const vol = params.volume ?? 0.7;
      const attack = Math.max(0.001, params.attack || 0.005);
      const decay = Math.max(0.001, params.decay || 0.2);
      const sustain = params.sustain ?? 0.5;
      const modAttack = Math.max(0.001, params.modAttack || 0.001);
      const modDecay = Math.max(0.001, params.modDecay || 0.3);
      const modSustain = params.modSustain ?? 0.2;
      const modFreq = carrierFreq * modRatio;

      for (let i = 0; i < blockSize; i++) {
        // Carrier envelope
        if (state.time < attack) {
          state.envLevel = state.time / attack;
        } else if (state.time < attack + decay) {
          state.envLevel = 1 - (1 - sustain) * ((state.time - attack) / decay);
        } else {
          state.envLevel = sustain;
        }
        // Mod envelope
        if (state.time < modAttack) {
          state.modEnvLevel = state.time / modAttack;
        } else if (state.time < modAttack + modDecay) {
          state.modEnvLevel = 1 - (1 - modSustain) * ((state.time - modAttack) / modDecay);
        } else {
          state.modEnvLevel = modSustain;
        }

        const modSample = Math.sin(state.modPhase * TWO_PI) * modDepth * state.modEnvLevel;
        const carrierSample = Math.sin(state.carrierPhase * TWO_PI + modSample / carrierFreq * TWO_PI);
        output[i] = carrierSample * state.envLevel * vol;

        state.carrierPhase += carrierFreq / sampleRate;
        state.modPhase += modFreq / sampleRate;
        if (state.carrierPhase >= 1) state.carrierPhase -= 1;
        if (state.modPhase >= 1) state.modPhase -= 1;
        state.time += 1 / sampleRate;
      }
    },
  },

  FormantFilter: {
    init(state) {
      // 3-band formant bank state
      state.filters = [];
      for (let i = 0; i < 3; i++) {
        state.filters.push({ x1: 0, x2: 0, y1: 0, y2: 0, a0: 1, a1: 0, a2: 0, b1: 0, b2: 0 });
      }
    },
    process(state, params, inputs, output, blockSize, sampleRate) {
      const input = inputs.in;
      const FORMANTS = {
        A: [800, 1200, 2500], E: [400, 2000, 2800], I: [300, 2300, 3000],
        O: [500, 800, 2800], U: [350, 600, 2400],
      };
      const vowel = params.vowel || 'A';
      const freqs = FORMANTS[vowel] || FORMANTS.A;
      const Q = 8;

      // Update coefficients
      for (let f = 0; f < state.filters.length; f++) {
        const w0 = TWO_PI * (freqs[f] || 440) / sampleRate;
        const alpha = Math.sin(w0) / (2 * Q);
        const cosw0 = Math.cos(w0);
        const a0 = 1 + alpha;
        state.filters[f].a0 = alpha / a0;
        state.filters[f].a1 = 0;
        state.filters[f].a2 = -alpha / a0;
        state.filters[f].b1 = -2 * cosw0 / a0;
        state.filters[f].b2 = (1 - alpha) / a0;
      }

      for (let i = 0; i < blockSize; i++) {
        const x = input ? input[i] : 0;
        let sum = 0;
        for (const f of state.filters) {
          const y = f.a0 * x + f.a1 * f.x1 + f.a2 * f.x2 - f.b1 * f.y1 - f.b2 * f.y2;
          f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y;
          sum += y;
        }
        output[i] = sum * (params.volume ?? 1.0) / state.filters.length;
      }
    },
  },

  GrainCloud: {
    init(state) {
      // Generate noise buffer for grains
      const len = 48000 * 2;
      state.noiseBuf = new Float32Array(len);
      for (let i = 0; i < len; i++) state.noiseBuf[i] = Math.random() * 2 - 1;
      state.readPos = 0;
    },
    process(state, params, inputs, output, blockSize, sampleRate) {
      const vol = params.volume ?? 0.8;
      const density = params.density || 20;
      const grainSize = params.grainSize || 0.08;
      const pitchBase = params.pitchBase || 1.0;
      const grainSamples = Math.ceil(grainSize * sampleRate);
      const spaceSamples = Math.ceil(sampleRate / density);
      const len = state.noiseBuf.length;

      for (let i = 0; i < blockSize; i++) {
        const posInGrain = state.readPos % spaceSamples;
        if (posInGrain < grainSamples) {
          const env = Math.sin(Math.PI * posInGrain / grainSamples);
          const idx = Math.floor(state.readPos * pitchBase) % len;
          output[i] = state.noiseBuf[idx] * env * vol;
        } else {
          output[i] = 0;
        }
        state.readPos++;
      }
    },
  },

  // --- PASS-THROUGH / UTILITY ---

  SoundBlender: {
    init() {},
    process(state, params, inputs, output, blockSize) {
      const input = inputs.in;
      const vol = params.masterVolume ?? 1.0;
      for (let i = 0; i < blockSize; i++) {
        output[i] = (input ? input[i] : 0) * vol;
      }
    },
  },

  RandomWalk: {
    init(state) { state.value = 0; },
    process(state, params, inputs, output, blockSize) {
      const speed = params.speed ?? 0.01;
      for (let i = 0; i < blockSize; i++) {
        state.value += (Math.random() * 2 - 1) * speed;
        state.value = Math.max(-1, Math.min(1, state.value));
        output[i] = state.value * (params.value ?? 1.0);
      }
    },
  },

  Output: {
    init() {},
    process(state, params, inputs, output, blockSize) {
      const input = inputs.in;
      if (input) {
        for (let i = 0; i < blockSize; i++) output[i] = input[i];
      }
    },
  },
};

// ============================================================================
// BIQUAD COEFFICIENT COMPUTATION
// ============================================================================

function _computeBiquadCoeffs(state, type, freq, Q, sampleRate) {
  const w0 = TWO_PI * freq / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);

  let b0, b1, b2, a0, a1, a2;

  switch (type) {
    case 'lowpass':
      b0 = (1 - cosw0) / 2; b1 = 1 - cosw0; b2 = b0;
      a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cosw0) / 2; b1 = -(1 + cosw0); b2 = b0;
      a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
      break;
    case 'bandpass':
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
      break;
    case 'notch':
      b0 = 1; b1 = -2 * cosw0; b2 = 1;
      a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
      break;
    default: // passthrough
      state.a0 = 1; state.a1 = 0; state.a2 = 0;
      state.b1 = 0; state.b2 = 0;
      return;
  }

  // Normalize
  state.a0 = b0 / a0;
  state.a1 = b1 / a0;
  state.a2 = b2 / a0;
  state.b1 = a1 / a0;
  state.b2 = a2 / a0;
}

// ============================================================================
// PATCH RUNNER PROCESSOR
// ============================================================================

class PatchRunnerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.plan = null;
    this.nodeStates = new Map();   // nodeId → state object
    this.wireBuffers = new Map();  // "nodeId:port" → Float32Array(128)
    this.outputBuffer = new Float32Array(128);
    this.sharedParams = null;      // SharedArrayBuffer view
    this.exposedMap = new Map();   // paramName → { nodeId, paramName, sharedIndex }

    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'loadPlan':
        this._loadPlan(msg.plan);
        break;
      case 'setParam':
        this._setParam(msg.nodeId, msg.paramName, msg.value);
        break;
      case 'setSharedBuffer':
        this.sharedParams = new Float32Array(msg.buffer);
        break;
      case 'stop':
        this.plan = null;
        break;
    }
  }

  _loadPlan(plan) {
    this.plan = plan;
    this.nodeStates.clear();
    this.wireBuffers.clear();
    this.exposedMap.clear();

    // Init node states
    for (const node of plan.executionOrder) {
      const processor = NODE_PROCESSORS[node.type];
      const state = {};
      if (processor && processor.init) {
        processor.init(state, node.params);
      }
      this.nodeStates.set(node.id, { state, params: { ...node.params }, processor });
    }

    // Allocate wire buffers
    for (const wire of plan.wires) {
      if (!this.wireBuffers.has(wire.from)) {
        this.wireBuffers.set(wire.from, new Float32Array(128));
      }
    }

    // Build exposed param map
    if (plan.exposed) {
      for (let i = 0; i < plan.exposed.length; i++) {
        const exp = plan.exposed[i];
        const [nodeId, paramName] = exp.param.split('.');
        this.exposedMap.set(exp.name, { nodeId, paramName, sharedIndex: i });
      }
    }
  }

  _setParam(nodeId, paramName, value) {
    const nodeData = this.nodeStates.get(nodeId);
    if (nodeData) {
      nodeData.params[paramName] = value;
    }
  }

  process(inputs, outputs, parameters) {
    if (!this.plan) {
      // Silence
      const out = outputs[0];
      if (out && out[0]) out[0].fill(0);
      if (out && out[1]) out[1].fill(0);
      return true;
    }

    const blockSize = 128;

    // Read shared params into exposed node params
    if (this.sharedParams) {
      for (const [name, map] of this.exposedMap) {
        const val = this.sharedParams[map.sharedIndex];
        const nodeData = this.nodeStates.get(map.nodeId);
        if (nodeData && Number.isFinite(val)) {
          nodeData.params[map.paramName] = val;
        }
      }
    }

    // Execute nodes in topological order
    for (const node of this.plan.executionOrder) {
      const nodeData = this.nodeStates.get(node.id);
      if (!nodeData || !nodeData.processor) continue;

      // Gather inputs from wires
      const nodeInputs = {};
      for (const wire of this.plan.wires) {
        const [toNodeId, toPort] = wire.to.split(':');
        if (toNodeId === node.id) {
          const srcBuf = this.wireBuffers.get(wire.from);
          if (srcBuf) {
            nodeInputs[toPort] = srcBuf;
          }
        }
      }

      // Allocate output buffer for this node
      const nodeOutput = new Float32Array(blockSize);

      // Process
      nodeData.processor.process(
        nodeData.state,
        nodeData.params,
        nodeInputs,
        nodeOutput,
        blockSize,
        sampleRate
      );

      // Store output in wire buffers
      // Find all wires originating from this node
      for (const wire of this.plan.wires) {
        const [fromNodeId] = wire.from.split(':');
        if (fromNodeId === node.id) {
          let buf = this.wireBuffers.get(wire.from);
          if (!buf) {
            buf = new Float32Array(blockSize);
            this.wireBuffers.set(wire.from, buf);
          }
          buf.set(nodeOutput);
        }
      }

      // If this is the output node, copy to final output
      if (node.id === this.plan.outputNodeId) {
        this.outputBuffer.set(nodeOutput);
      }
    }

    // Write to AudioWorklet output
    const out = outputs[0];
    if (out) {
      for (let ch = 0; ch < out.length; ch++) {
        out[ch].set(this.outputBuffer);
      }
    }

    return true;
  }
}

registerProcessor('patch-runner', PatchRunnerProcessor);
