// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * engine/world/streaming/index.js - Chunk Streaming Barrel Export
 */

// Core streaming
export { ChunkStreaming, ChunkStreaming as ChunkStreamer, PRIORITY_BUCKET, PriorityBucketQueue, LoadRequestRingBuffer } from './ChunkStreaming.js';
export { ChunkStreamingCompute } from './ChunkStreamingCompute.js';
export { JOB_STATE, JOB_SOURCE, ChunkJobCoordinator } from './ChunkJobCoordinator.js';

// Loading strategies
export { LOAD_PATTERN, PriorityChunkLoader } from './PriorityChunkLoader.js';
export { ProgressiveChunkLoader } from './ProgressiveChunkLoader.js';
export { ZONE_STATE, ChunkLoadingZone } from './ChunkLoadingZone.js';
export { AdaptiveChunkBudget } from './AdaptiveChunkBudget.js';

// Workers & prediction
export { ChunkWorkerPool } from './ChunkWorkerPool.js';
export { MovementPredictor } from './MovementPredictor.js';

// Chunk state
export { ChunkUpdater } from './ChunkUpdater.js';
export { ChunkHistory, HistoryManager } from './ChunkHistory.js';
export { StructureType, GenerationPhase, ChunkSeamSystem } from './ChunkSeamSystem.js';
