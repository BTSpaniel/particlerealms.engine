// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export {
    GPU_MATTER_SPATIAL_INDEX_SCHEMA,
    GPU_MATTER_SPATIAL_INDEX_VERSION,
    GpuMatterSpatialIndex,
    createGpuMatterSpatialIndex,
    validateGpuMatterSpatialIndexSnapshot,
} from './GpuMatterSpatialIndex.js';

export {
    MATTER_QUALITY_MODES,
    MATTER_PHYSICAL_TIERS,
    MATTER_FIDELITY_GOVERNOR_SCHEMA,
    MATTER_FIDELITY_GOVERNOR_VERSION,
    MatterFidelityGovernor,
    createMatterFidelityGovernor,
    validateMatterFidelityGovernorSnapshot,
} from './MatterFidelityGovernor.js';

export {
    MATTER_GPU_PACKET_ARENA_SCHEMA,
    MATTER_GPU_PACKET_ARENA_VERSION,
    MATTER_GPU_PACKET_PAGE_BYTES_PER_SLOT,
    MATTER_GPU_PACKET_PAGE_FIXED_BYTES,
    MATTER_GPU_PACKET_RECORD_BYTES,
    MATTER_GPU_PACKET_UPLOAD_BYTES_PER_SLOT,
    MatterGpuPacketArena,
    MatterGpuPacketArenaError,
    createMatterGpuPacketArena,
    validateMatterGpuPacketArenaSnapshot,
} from './MatterGpuPacketArena.js';

export {
    MATTER_BENCHMARK_REPORT_SCHEMA,
    MATTER_BENCHMARK_REPORT_VERSION,
    MATTER_FRAME_DIAGNOSTICS_RECEIPT_SCHEMA,
    MATTER_FRAME_DIAGNOSTICS_RECEIPT_VERSION,
    MATTER_FRAME_STAGES,
    MATTER_REPLAY_CHECKPOINT_SCHEMA,
    MATTER_REPLAY_CHECKPOINT_VERSION,
    MatterDiagnostics,
    MatterFramePipeline,
    MatterReplayController,
    createMatterDiagnostics,
    createMatterFramePipeline,
    createMatterReplayController,
} from './MatterRuntimeCoordinator.js';

export {
    projectMatterKinematicSamplesToPackets,
} from './MatterKinematicProjection.js';
