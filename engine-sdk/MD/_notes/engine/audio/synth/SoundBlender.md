### Audio Graph Architecture

The audio system uses a node-based graph architecture. AudioNodes connect to form processing chains: sources (oscillator, buffer) → effects (filter, delay, reverb) → destination (speakers). All processing happens on the audio thread via the Web Audio API with automatic sample rate conversion.

**Example: Creating a sound effect chain**
```js
import { AudioContext } from 'engine/audio/AudioContext.js';
import { OscillatorNode } from 'engine/audio/OscillatorNode.js';
import { GainNode } from 'engine/audio/GainNode.js';
import { BiquadFilterNode } from 'engine/audio/BiquadFilterNode.js';

const ctx = new AudioContext();

// Build chain: oscillator → filter → gain → speakers
const osc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 440 });
const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 800 });
const gain = new GainNode(ctx, { gain: 0.5 });

osc.connect(filter);
filter.connect(gain);
gain.connect(ctx.destination);

// Trigger sound with envelope
osc.start();
gain.gain.setTargetAtTime(0, ctx.currentTime + 0.1, 0.1);  // Decay
osc.stop(ctx.currentTime + 2);
```

**See also:** [Audio](/engine/audio.md) · [Engine Overview](/engine/overview.md)
