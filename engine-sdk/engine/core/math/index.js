// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * engine/core/math/index.js - Math Utilities Barrel Export
 */

// ============================================================================
// CORE MATH (existing) - vec3 ops now in MathVec3.js, quat/mat4 still here
// ============================================================================
export {
  // quat ops live in MathQuat.js now (quatRotateVec3 etc. are re-exported from there)
  mat4Identity, mat4Multiply, mat4Translate, mat4Scale,
  mat4PerspectiveRad, mat4PerspectiveRadWebGPU,
  mat4PerspectiveDeg, mat4PerspectiveDegWebGPU,
  mat4Orthographic, mat4OrthographicWebGPU,
  mat4LookAt, mat4Inverse, mat4FromRotationTranslation,
} from './EngineMath.js';

// ============================================================================
// NEW MODULAR MATH LIBRARY
// ============================================================================

// Constants - PI, TAU, EPSILON, physical constants
export * from './MathConstants.js';

// Scalar utilities - clamp, lerp, smoothstep, remap, angle utils
export * from './MathScalar.js';

// Unit conversion - angles, time, samples, tempo, frequency, audio, bytes, pixels, scalar grid/chunk
export * from './UnitMath.js';

// Compression - RLE, delta, palette, varint, entropy, LZ window, dictionary, Huffman, and range-model reports
export * from './CompressionMath.js';

// Lossy compression - DCT, coefficient quantization, residual, and reconstruction reports
export * from './LossyCompressionMath.js';

// Vec2 - Complete 2D vector operations
export * from './MathVec2.js';

// Vec3 - Complete 3D vector operations
export * from './MathVec3.js';

// Vec4 - Complete 4D vector operations (general purpose)
export * from './MathVec4.js';

// Quaternion - Extended quaternion operations (slerp, euler, lookAt)
export * from './MathQuat.js';

// Matrices - Mat2, Mat3, extended Mat4 operations
export * from './MathMat.js';

// Plane - Plane creation, query, intersection, transform
export * from './MathPlane.js';

// Ray - Ray creation, intersection tests, closest point queries
export * from './MathRay.js';

// Line3/Segment - Line segment operations, segment-segment closest point
export * from './MathLine3.js';

// Rect2 - 2D axis-aligned bounding box / rectangle
export * from './MathRect2.js';

// Spatial hierarchy - shared refittable Float64 BVH for rendering and simulation
export { AabbBvh } from './AabbBvh.js';

// Tetrahedral cages - static micro-BVHs with piecewise-affine deformation
export * from './TetrahedralCageAccel.js';
export * from './TetrahedralCageCompiler.js';

// Dual Quaternion - Skinning, rigid body interpolation, screw motion
export * from './MathDualQuat.js';

// Packing - Half-float, SNORM/UNORM, RGB9E5, R11G11B10F for GPU
export * from './MathPacking.js';

// Precision - tolerance checks, split-double world coordinates, JSON round-trip helpers
export * from './MathPrecision.js';

// Robust numerics - float64 classification, ULP policy, stable sums, cancellation, and filtered predicates
export * from './RobustNumericMath.js';

// Exact calculator - bounded typed AST, normalized integer/rational arithmetic, and canonical values
export * from './ExactCalculatorCore.js';

// Exact calculation receipts - content-addressed, bounded deterministic replay evidence
export * from './ExactCalculationReceipt.js';
export * from './ExactCalibrationEvidence.js';

// Registry - inspectable metadata for stable math modules/functions
export * from './MathRegistry.js';

// WGSL registry - inspectable metadata for shader chunks and CPU/WGSL mirrors
export * from './WGSLRegistry.js';

// Quantization - signed range, UNORM16 arrays, vector quantization, error bounds
export * from './QuantMath.js';

// Mesh attributes - glTF accessor decode, quantized attribute metadata, index bounds
export * from './MeshAttributeMath.js';

// Polynomial - Root solvers (linear, quadratic, cubic, quartic), Horner eval
export * from './MathPolynomial.js';

// Statistics - Running stats (Welford), array stats, EMA, windowed stats
export * from './MathStatistics.js';

// Entropy - histograms, probability tables, entropy, divergence, and health reports
export * from './MathEntropy.js';

// Quality - MSE/RMSE/MAE, PSNR, SSIM-lite/windowed reports, channel/image reports, SNR, frame/audio error, quality-size scoring
export * from './MathQuality.js';

// Validation - finite, range, alignment, histogram, probability, schema, and typed-array reports
export * from './MathValidation.js';

// Benchmark/Profile - rates, throughput, memory estimates, latency, frame budget, and stage reports
export * from './BenchmarkMath.js';
export * from './ProfileMath.js';

// Tensor shapes - broadcast, strides, dtype sizes, layouts, operator shapes, graph memory
export * from './TensorShapeMath.js';
export * from './TensorSpatialMath.js';

// Memory layout - byte alignment, buffer field layouts, WGSL structs, std140 reports
export * from './MemoryLayoutMath.js';

// SIMD layout - v128 lane metadata, masks, chunk plans, alignment, and SoA/AoS reports
export * from './SIMDLayoutMath.js';

// Text metrics - grapheme cursors, run metrics, wrapping, baselines, selection rects, and glyph atlas reports
export * from './TextMetricMath.js';

// Navigation math - nav portals, string pulling, path metrics, area costs, refs, smoothing, and steering targets
export * from './NavigationMath.js';

// Scene query math - hit sorting, filters, sweeps, overlaps, penetration, and broadphase scoring
export * from './SceneQueryMath.js';

// Constraint math - joint limits, springs, motors, projection drift, and drive envelopes
export * from './ConstraintMath.js';

// XR math - WebXR-shaped pose, view, projection, reference-space, and depth reports
export * from './XRMath.js';

// Buffer math - byte views, endian-safe reads/writes, UTF-8 helpers, and cursors
export * from './BufferMath.js';

// Checksum math - CRC32, Adler32, FNV-1a, typed sequence hashes, rolling hashes, block reports, and digests
export * from './ChecksumMath.js';

// Format math - byte signatures, MIME/accept helpers, SemVer ranges, text ranges, token cursors, and chunk tables
export * from './FormatMath.js';

// Radio math - RF power, noise floor, path loss, link budget, channel capacity, and interference
export * from './RadioMath.js';

// Network metric math - RTT, jitter, loss, throughput, goodput, rates, and timeout estimators
export * from './NetworkMetricMath.js';

// Jitter math - packet delay variation, RTP/WebRTC jitter, and adaptive buffer reports
export * from './JitterMath.js';

// Packet math - sequence spaces, ACK ranges, fragments, flight windows, and loss candidates
export * from './PacketMath.js';

// Queue math - queue depth, drain delay, buckets, fair shares, rate ramps, and backpressure
export * from './QueueMath.js';

// Congestion math - congestion windows, pacing, Reno, QUIC, and CUBIC reports
export * from './CongestionMath.js';

// Mesh math - peer graph, link quality, gossip fanout, relay, and partition reports
export * from './MeshMath.js';

// Signal quality math - combined radio/WebRTC signal health scoring reports
export * from './SignalQualityMath.js';

// Channel math - channel ranges, guard bands, hopsets, interference, and planning reports
export * from './ChannelMath.js';

// Spherical Harmonics - SH evaluate, project, convolve, irradiance, rotate
export * from './MathSphericalHarmonics.js';

// Grid - CPU trilinear/bilinear sampling, discrete gradient/divergence/curl/laplacian, advection
export * from './MathGrid.js';

// Bits - Morton codes, Hilbert curves, hash functions, bit manipulation
export * from './MathBits.js';

// Noise - Perlin, Simplex, Value, Voronoi, FBM, Ridged, Curl
export * from './MathNoise.js';

// Easing - Easing functions, Bezier curves, splines
export * from './MathEasing.js';

// Animation timing - timing progress, keyframe brackets, channel sampling, and keyframe reduction reports
export * from './AnimationTimeMath.js';

// Geometry - SDF, ray intersections, AABB, frustum culling
export * from './MathGeometry.js';

// Color - color spaces, CSS parse reports, display/gamut/HDR reports, conversions, blend modes, palettes
export * from './MathColor.js';

// Blend - alpha compositing, premultiplied alpha, coverage, and dither helpers
export * from './BlendMath.js';

// Image - ImageData/RGBA pixel access, sampling, swizzle, alpha, histogram, luminance, and edges
export * from './ImageMath.js';

// Document pixels - thresholding, bounded segmentation, deskew, and glyph features
export * from './DocumentImageMath.js';
export * from './DocumentRegionMath.js';
export * from './DocumentQuadMath.js';
export { matrixMultiplyF32 } from '../gpu/MatmulKernel.js';

// Frame - ImageData-like frame difference, motion, residual, scene-change, and timing reports
export * from './FrameMath.js';

// Video - sequence-level frame timing, blending, scenes, keyframes, entropy, and thumbnail selection
export * from './VideoMath.js';

// Media timing - WebCodecs-shaped timestamps, cadence, A/V sync, color metadata, and codec queue pressure
export * from './MediaTimingMath.js';

// Sampling - sample-rate, index/time, window, spatial, stratified, weighted, importance, blue-noise, and playback reports
export * from './SamplingMath.js';

// Filter - reusable kernels, signal FIR, and CPU RGBA convolution helpers
export * from './FilterMath.js';

// Input signal - pointer/stylus pressure, tilt, smoothing, prediction, and stroke reports
export * from './InputSignalMath.js';

// DOM geometry - DOMPoint, DOMRect, DOMMatrix, canvas backing-store, and pointer coordinate reports
export * from './DOMGeometryMath.js';

// UI layout - CSS units, calc/min/max/clamp, constraints, flex-basis, and responsive steps
export * from './UILayoutMath.js';

// Texture - UV, atlas, triplanar, and mip-pyramid helpers
export * from './TextureMath.js';

// Random - Seeded RNGs, distributions, sampling, quasi-random sequences
export * from './MathRandom.js';

// Physics - Kinematics, dynamics, collision response, constraints
export * from './MathPhysics.js';

// Signal - FFT, window functions, filters, convolution, spectral analysis
export * from './MathSignal.js';

// Audio - PCM mixing, clipping, metering, panning, waveform, and spectral reports
export * from './AudioMath.js';

// Audio automation - AudioParam ramps, ADSR envelopes, and biquad coefficients/responses
export * from './AudioAutomationMath.js';

// Oscillator - waveform sampling, modulation, resonance, coupled phase dynamics
export * from './MathOscillator.js';

export * from './MathRootAlgebra.js';

// BVH (Bounding Volume Hierarchy)
// Note: EPSILON already exported from MathConstants.js
export {
    INF_T,
    BVHNode,
    BVHBuilder,
    rayTriangleIntersect,
    traverseBVH,
    BVH_TRAVERSAL_WGSL,
    serializeBVHForGPU,
    createRaycastMesh,
} from './BVHAccel.js';

// Bezier curves
export * from './BezierCurves.js';
export {
    sdCapsule,
    capsuleClosestT,
    bezierDistanceCapsule,
    bezierDistanceBatch,
    bezierClosestNewton,
    bezierDistanceHybrid,
    multiCurveDistance,
    multiCurveDistanceSmooth,
    curvesToGPUBuffer,
    curvesToSegments,
    BezierDistanceCompute,
} from './BezierDistance.js';

// Line networks
export {
    DEFAULT_RESOLUTION,
    DEFAULT_BLEND_RADIUS,
    Materials as LineMaterials,
    NetworkNode,
    NetworkEdge,
    LineNetwork,
    LineToVoxelizer,
    generateTree,
    generateRoots,
    generateTunnel,
    GPULineVoxelizer,
} from './LineToVoxel.js';

// Spatial data structures
export { SpatialHash } from './SpatialHash.js';
export { SpatialHashCompute } from './SpatialHashCompute.js';

// Union-Find
export { solveSparsePositive } from './SparsePositiveSolver.js';
export {
    UnionFind,
    VoxelUnionFind,
    HybridConnectivity,
} from './UnionFind.js';
