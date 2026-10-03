Neural network definitions for AGI agents. Supports feedforward, recurrent
(LSTM/GRU), transformer, and custom architectures. Networks map observations
to actions and are trained via policy gradients (PPO) or Q-learning.

### Creating a network

```js
import { NetworkArchitecture } from "agi/brain/NetworkArchitecture.js";

// Simple feedforward policy network
const policy = new NetworkArchitecture({
  type: "feedforward",
  inputSize: 64,     // Observation vector size
  hiddenLayers: [128, 128],
  outputSize: 8,   // Action space size
  activation: "relu",
  outputActivation: "tanh"  // Continuous actions: -1 to 1
});

// Value network (critic) for PPO
const value = new NetworkArchitecture({
  type: "feedforward",
  inputSize: 64,
  hiddenLayers: [128, 128],
  outputSize: 1,     // Single value estimate
  activation: "relu"
});

// LSTM for sequential memory
const recurrent = new NetworkArchitecture({
  type: "lstm",
  inputSize: 32,
  lstmUnits: 64,
  outputSize: 4,
  numLayers: 2       // Stacked LSTM
});
```

### Observation preprocessing

```js
// Combined visual + vector observations
const network = new NetworkArchitecture({
  type: "multi-input",
  inputs: {
    vision: {
      type: "conv2d",
      shape: [64, 64, 3],  // Width, height, channels
      convLayers: [
        { filters: 32, kernel: 3, stride: 2 },
        { filters: 64, kernel: 3, stride: 2 },
        { filters: 64, kernel: 3, stride: 2 }
      ],
      flatten: true
    },
    sensors: {
      type: "dense",
      size: 16
    }
  },
  fusion: "concat",     // Concatenate conv output + sensor vector
  hiddenLayers: [256],
  outputSize: 8
});
```

### Training configuration

```js
// PPO training setup
const agent = new NetworkArchitecture({
  type: "ppo",
  policy: {
    type: "feedforward",
    inputSize: 64,
    hiddenLayers: [256, 256],
    outputSize: 8
  },
  value: {
    type: "feedforward",
    inputSize: 64,
    hiddenLayers: [256, 256],
    outputSize: 1
  },
  training: {
    learningRate: 3e-4,
    gamma: 0.99,           // Discount factor
    lambda: 0.95,          // GAE lambda
    epsilon: 0.2,          // PPO clip range
    epochs: 4,             // Optimization epochs per batch
    batchSize: 64,
    entropyCoef: 0.01    // Exploration bonus
  }
});
```

### Forward pass (inference)

```js
// Single observation
const observation = world.getObservation();  // Float32Array[64]
const action = network.forward(observation);  // Float32Array[8]

// Batch forward (training)
const batchObservations = getBatch(64);       // [64, 64] tensor
const batchActions = network.forward(batchObservations);  // [64, 8]
```

### Saving and loading

```js
// Save trained weights
const checkpoint = await network.save();
await storage.write("/checkpoints/agent-v1.json", checkpoint);

// Load and resume
const saved = await storage.read("/checkpoints/agent-v1.json");
const restored = NetworkArchitecture.load(saved);

// Transfer learning: load base, modify head
const base = NetworkArchitecture.load(pretrainedWeights);
base.replaceHead({ outputSize: newActionSpace });  // Keep feature layers
```

### Gotchas

- **Input normalization**: Networks expect normalized inputs (mean=0, std=1).
  Use `ObservationBuilder` to add normalization layers.
- **Action bounds**: Continuous outputs use tanh (-1, 1) — scale to your action
  space externally. Discrete actions use softmax + argmax.
- **Gradient clipping**: Essential for recurrent nets. PPO config defaults to
  clip by norm (0.5), but increase for very deep nets.

**See also:** [AGI Training Guide](/agi/training-guide.md) · [ExperienceBuffer](./ExperienceBuffer.md) · [PolicyNetwork](./PolicyNetwork.md)
