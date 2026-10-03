// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PatchCompiler.js - Compile Patch JSON → Execution Graph
 * 
 * Parses a patch JSON descriptor, validates nodes and wires,
 * performs topological sort, detects feedback loops, and outputs
 * a compiled execution plan for PatchRunner.worklet.js.
 */

// ============================================================================
// NODE TYPE REGISTRY
// ============================================================================

const NODE_TYPES = new Map();

/**
 * Register a node type for the compiler.
 * @param {string} type - Node type name (e.g. 'Oscillator', 'Filter')
 * @param {Object} def - { inputs: string[], outputs: string[], params: Object }
 */
export function registerNodeType(type, def) {
  NODE_TYPES.set(type, def);
}

/**
 * Get all registered node types.
 * @returns {Map}
 */
export function getNodeTypes() {
  return NODE_TYPES;
}

// Register built-in types
registerNodeType('Output', { inputs: ['in'], outputs: [], params: {} });
registerNodeType('Oscillator', { inputs: [], outputs: ['out'], params: { frequency: 440, detune: 0, shape: 'sine', pulseWidth: 0.5, unisonVoices: 1, unisonDetune: 10, subOctave: 0, subMix: 0.5 } });
registerNodeType('NoiseGenerator', { inputs: [], outputs: ['out'], params: { color: 'white', density: 1.0, bandwidth: 20000, stereoSpread: 0 } });
registerNodeType('Impulse', { inputs: [], outputs: ['out'], params: { rate: 10, shape: 'click', jitter: 0.5, attack: 0.001, decay: 0.01, burstLength: 0.005, pitch: 1000, velocityMin: 0.5, velocityMax: 1.0 } });
registerNodeType('GrainCloud', { inputs: ['trigger'], outputs: ['out'], params: { grainSize: 0.05, density: 20, pitchSpread: 0.1, scatter: 0.5, position: 0.5, positionRandom: 0.1, envelope: 'hann', freeze: false, scrubSpeed: 1.0, pitchMode: 'random', reverse: 0 } });
registerNodeType('ModalBank', { inputs: ['excitation'], outputs: ['out'], params: { material: 'metal', frequency: 440, modeCount: 12, inharmonicity: 0, damping: 0.5, highDamp: 0.5, brightness: 0.5, strikePosition: 0.5, size: 1.0, modes: [] } });
registerNodeType('Waveguide', { inputs: ['excitation'], outputs: ['out'], params: { frequency: 220, length: 0.01, damping: 0.5, feedback: 0.99, termination: 'rigid', excitePos: 0.5, pickupPos: 0.25, dispersion: 0, mode: 'string', brightness: 0.5 } });
registerNodeType('SamplePlayer', { inputs: ['trigger'], outputs: ['out'], params: { buffer: null, rate: 1.0, loop: false, loopMode: 'forward', startTime: 0, endTime: -1, loopStart: 0, loopEnd: -1, crossfade: 0.01, attack: 0, decay: 0, sustain: 1, release: 0.01 } });
registerNodeType('Filter', { inputs: ['in'], outputs: ['out'], params: { type: 'lowpass', frequency: 1000, Q: 1.0, gain: 0 } });
registerNodeType('CombFilter', { inputs: ['in'], outputs: ['out'], params: { delay: 0.01, feedforward: 0.5, feedback: 0.5 } });
registerNodeType('Waveshaper', { inputs: ['in'], outputs: ['out'], params: { curve: 'tanh', drive: 1.0, mix: 1.0 } });
registerNodeType('Delay', { inputs: ['in'], outputs: ['out'], params: { time: 0.25, feedback: 0.3, mix: 0.5 } });
registerNodeType('Reverb', { inputs: ['in'], outputs: ['out'], params: { roomSize: 0.5, damping: 0.5, mix: 0.3 } });
registerNodeType('Compressor', { inputs: ['in'], outputs: ['out'], params: { threshold: -12, ratio: 4, attack: 0.003, release: 0.1 } });
registerNodeType('Envelope', { inputs: ['gate'], outputs: ['out'], params: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3, curve: 1.0 } });
registerNodeType('Gain', { inputs: ['in'], outputs: ['out'], params: { volume: 1.0 } });
registerNodeType('LFO', { inputs: [], outputs: ['out'], params: { rate: 1.0, depth: 1.0, shape: 'sine', phase: 0 } });
registerNodeType('RandomWalk', { inputs: [], outputs: ['out'], params: { rate: 1.0, range: 1.0, smoothing: 0.1 } });
registerNodeType('GameParam', { inputs: [], outputs: ['out'], params: { paramId: '', defaultValue: 0 } });
registerNodeType('MathOp', { inputs: ['a', 'b'], outputs: ['out'], params: { operation: 'add' } });

// Sound Atoms (macro nodes — expanded into sub-graphs by compiler)
registerNodeType('CrackleAtom', { inputs: [], outputs: ['out'], params: { density: 30, brightness: 0.5 } });
registerNodeType('WhooshAtom', { inputs: [], outputs: ['out'], params: { centerFreq: 500, bandwidth: 200 } });
registerNodeType('DropAtom', { inputs: [], outputs: ['out'], params: { pitch: 400, amplitude: 0.8 } });
registerNodeType('HissAtom', { inputs: [], outputs: ['out'], params: { cutoff: 2000, volume: 0.5 } });
registerNodeType('RumbleAtom', { inputs: [], outputs: ['out'], params: { cutoff: 80, volume: 0.6 } });

// Advanced synthesis
registerNodeType('KarplusStrong', { inputs: ['trigger'], outputs: ['out'], params: { frequency: 220, decay: 2.0, brightness: 0.5, excitation: 'noise', stretch: 0 } });
registerNodeType('FMOperator', { inputs: ['modulation'], outputs: ['out'], params: {
  carrierFreq: 440,
  modRatio: 2.0,
  modDepth: 200,
  feedback: 0,
  attack: 0.005,
  decay: 0.2,
  sustain: 0.5,
  modAttack: 0.001,
  modDecay: 0.3,
  modSustain: 0.2,
  volume: 0.7,
} });
registerNodeType('FormantFilter', { inputs: ['in'], outputs: ['out'], params: { vowel: 'A', morphTime: 0.1, formantCount: 5 } });
registerNodeType('SoundBlender', { inputs: ['a', 'b', 'c', 'd'], outputs: ['out'], params: { mode: 'simultaneous', fadeCurve: 'linear', masterVolume: 1.0 } });

// Physics models
registerNodeType('ModalImpactModel', { inputs: ['trigger'], outputs: ['out'], params: { material: 'metal' } });
registerNodeType('CombustionModel', { inputs: [], outputs: ['out'], params: { intensity: 0.5 } });
registerNodeType('FluidModel', { inputs: [], outputs: ['out'], params: { splashRate: 10 } });
registerNodeType('WindModel', { inputs: [], outputs: ['out'], params: { speed: 5, gustiness: 0.3 } });
registerNodeType('WeatherModel', { inputs: [], outputs: ['out'], params: { type: 'rain', intensity: 0.5 } });

// Instrument presets (macro nodes)
registerNodeType('PianoInstrument', { inputs: ['gate', 'note'], outputs: ['out'], params: { type: 'grand', brightness: 0.5, hardness: 0.5, resonance: 0.3, volume: 0.8 } });
registerNodeType('StringsInstrument', { inputs: ['gate', 'note'], outputs: ['out'], params: { type: 'ensemble', attack: 0.3, vibrato: 0.3, brightness: 0.5, volume: 0.8 } });
registerNodeType('BrassInstrument', { inputs: ['gate', 'note'], outputs: ['out'], params: { type: 'trumpet', brightness: 0.6, growl: 0.2, attack: 0.05, volume: 0.8 } });
registerNodeType('PadSynth', { inputs: ['gate', 'note'], outputs: ['out'], params: { type: 'warm', attack: 0.5, release: 1.0, detune: 10, brightness: 0.4, volume: 0.7 } });
registerNodeType('LeadSynth', { inputs: ['gate', 'note'], outputs: ['out'], params: { type: 'square', glide: 0.05, pulseWidth: 0.5, filterEnv: 0.5, volume: 0.8 } });
registerNodeType('BassSynth', { inputs: ['gate', 'note'], outputs: ['out'], params: { type: 'sub', drive: 0.3, filterFreq: 800, filterEnv: 0.4, volume: 0.8 } });
registerNodeType('DrumSynth', { inputs: ['trigger'], outputs: ['out'], params: { type: 'kick', pitch: 60, decay: 0.3, tone: 0.5, snap: 0.5, volume: 0.9 } });

// MIDI input
registerNodeType('MidiInput', { inputs: [], outputs: ['gate', 'note', 'velocity', 'cc'], params: { channel: 0, ccNumber: 1, transpose: 0, velocityCurve: 'linear' } });
registerNodeType('MidiCCMap', { inputs: ['cc'], outputs: ['out'], params: { ccNumber: 1, min: 0, max: 1, curve: 'linear' } });

// Sequencer and arpeggiator
registerNodeType('StepSequencer', { inputs: ['clock'], outputs: ['gate', 'note', 'velocity'], params: { steps: 16, rate: '1/16', swing: 0, pattern: [], notePattern: [], velocityPattern: [] } });
registerNodeType('Arpeggiator', { inputs: ['gate', 'note'], outputs: ['gate', 'note'], params: { mode: 'up', octaves: 2, rate: '1/16', swing: 0, gateLength: 0.5 } });
registerNodeType('Clock', { inputs: [], outputs: ['tick', 'beat', 'bar'], params: { bpm: 120, timeSignature: '4/4', swing: 0, running: true } });

// New synthesis types
registerNodeType('Additive', { inputs: [], outputs: ['out'], params: { frequency: 440, partialCount: 16, spectralTilt: 0, evenOdd: 0.5, detune: 0 } });
registerNodeType('Wavetable', { inputs: [], outputs: ['out'], params: { frequency: 440, table: 'basic', position: 0, morph: 0, detune: 0 } });
registerNodeType('PhaseDistortion', { inputs: [], outputs: ['out'], params: { frequency: 440, shape: 'saw', distortion: 0.5, resonance: 0.3 } });
registerNodeType('Subtractive', { inputs: ['gate', 'note'], outputs: ['out'], params: { oscShape: 'saw', filterType: 'lowpass', filterFreq: 2000, filterRes: 0.5, filterEnv: 0.5, attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3 } });

// ============================================================================
// COMPILE
// ============================================================================

/**
 * Compile a patch JSON into an execution plan.
 * @param {Object} patch - Patch descriptor { id, name, nodes, wires, exposed }
 * @returns {{ ok: boolean, plan?: Object, error?: string }}
 */
export function compilePatch(patch) {
  if (!patch || !patch.nodes || !patch.wires) {
    return { ok: false, error: 'Patch must have nodes and wires arrays' };
  }

  // Validate nodes
  const nodeMap = new Map();
  for (const node of patch.nodes) {
    if (!node.id || !node.type) {
      return { ok: false, error: `Node missing id or type: ${JSON.stringify(node)}` };
    }
    if (!NODE_TYPES.has(node.type)) {
      return { ok: false, error: `Unknown node type: ${node.type}` };
    }
    if (nodeMap.has(node.id)) {
      return { ok: false, error: `Duplicate node id: ${node.id}` };
    }
    nodeMap.set(node.id, node);
  }

  // Find output node
  let outputNodeId = null;
  for (const node of patch.nodes) {
    if (node.type === 'Output') {
      outputNodeId = node.id;
      break;
    }
  }
  if (!outputNodeId) {
    return { ok: false, error: 'Patch must have an Output node' };
  }

  // Build adjacency (dependencies)
  const deps = new Map(); // nodeId → Set of nodeIds it depends on
  for (const node of patch.nodes) {
    deps.set(node.id, new Set());
  }

  for (const wire of patch.wires) {
    const [fromNodeId, fromPort] = String(wire.from || '').split(':');
    const [toNodeId, toPort] = String(wire.to || '').split(':');
    if (!nodeMap.has(fromNodeId)) {
      return { ok: false, error: `Wire references unknown source node: ${fromNodeId}` };
    }
    if (!nodeMap.has(toNodeId)) {
      return { ok: false, error: `Wire references unknown target node: ${toNodeId}` };
    }

    const fromType = nodeMap.get(fromNodeId).type;
    const toType = nodeMap.get(toNodeId).type;
    const fromDef = NODE_TYPES.get(fromType);
    const toDef = NODE_TYPES.get(toType);
    if (!fromPort || !fromDef?.outputs?.includes(fromPort)) {
      return { ok: false, error: `Wire uses invalid source port: ${wire.from}` };
    }
    if (!toPort || !toDef?.inputs?.includes(toPort)) {
      return { ok: false, error: `Wire uses invalid target port: ${wire.to}` };
    }

    deps.get(toNodeId).add(fromNodeId);
  }

  // Topological sort (Kahn's algorithm)
  const inDegree = new Map();
  for (const [id, depSet] of deps) {
    inDegree.set(id, depSet.size);
  }

  const queue = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted = [];
  while (queue.length > 0) {
    const id = queue.shift();
    sorted.push(id);

    for (const [otherId, depSet] of deps) {
      if (depSet.has(id)) {
        depSet.delete(id);
        inDegree.set(otherId, inDegree.get(otherId) - 1);
        if (inDegree.get(otherId) === 0) {
          queue.push(otherId);
        }
      }
    }
  }

  if (sorted.length !== patch.nodes.length) {
    return { ok: false, error: 'Feedback loop detected in patch graph' };
  }

  // Build execution plan
  const executionOrder = sorted.map(id => {
    const node = nodeMap.get(id);
    const typeDef = NODE_TYPES.get(node.type);
    return {
      id: node.id,
      type: node.type,
      params: { ...(typeDef.params || {}), ...(node.params || {}) },
    };
  });

  // Build wire map (for the worklet)
  const wireMap = patch.wires.map(w => ({
    from: w.from,  // "nodeId:portName"
    to: w.to,      // "nodeId:portName"
  }));

  // Build exposed params
  const exposed = (patch.exposed || []).map(e => ({
    param: e.param,     // "nodeId.paramName"
    name: e.name,       // External name
    range: e.range || [0, 1],
    defaultValue: e.defaultValue ?? null,
  }));

  return {
    ok: true,
    plan: {
      id: patch.id || 'unnamed',
      name: patch.name || 'Untitled Patch',
      executionOrder,
      wires: wireMap,
      exposed,
      outputNodeId,
    },
  };
}

/**
 * Validate a patch without fully compiling.
 * @param {Object} patch
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePatch(patch) {
  const result = compilePatch(patch);
  if (result.ok) return { valid: true, errors: [] };
  return { valid: false, errors: [result.error] };
}
