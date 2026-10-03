// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { statsSum, statsMean, statsVariance, statsPopulationVariance, statsMin, statsMax } from '../math/MathStatistics.js';
import { compensatedSum } from '../math/RobustNumericMath.js';
import { attributeBounds } from '../math/MeshAttributeMath.js';
import { mat4TransformPoint } from '../math/MathMat.js';
import { imageHistogramReport, imageLuminanceMap } from '../math/ImageMath.js';
import { analyzeDocumentImage, DOCUMENT_IMAGE_MAX_PIXELS } from '../math/DocumentImageMath.js';
import { analyzeDocumentRegions } from '../math/DocumentRegionMath.js';
import { matrixMultiplyF32, validateMatrixMultiply } from '../gpu/MatmulKernel.js';
import { fft, ifft } from '../math/MathSignal.js';
import { audioWaveformPeaks, audioWindowedRmsReport } from '../math/AudioMath.js';
import { crc32 } from '../math/ChecksumMath.js';
import { byteFrequencyHistogram, histogramEntropyReport } from '../math/MathEntropy.js';
import { deepFreezeJson } from '../schema/StrictJsonValue.js';
import { validateTriangularClothGpuProgram, executeTriangularClothProgramJs } from '../../sim/cloth/triangular/gpu-program.js';
import { assertComputeContract, projectComputeContractValue } from './ComputeContracts.js';

const PREFIX = 'math.';
const CONTRACT_BASE = 'https://particlerealms.online/schemas/compute/';
const SPECS = [
    ['stats.summary', 'numeric', 'math.statistics', ['values'], false],
    ['robust.compensated-sum', 'numeric', 'math.robust-numeric', ['values'], false],
    ['geometry.attribute-bounds', 'geometry', 'math.mesh-attribute', ['positions'], false],
    ['geometry.transform-points', 'geometry', 'math.mat', ['positions', 'matrix'], true],
    ['image.histogram', 'image', 'math.image', ['image'], true],
    ['image.luminance', 'image', 'math.image', ['image'], true],
    ['image.document-analysis', 'image', 'math.document-image', ['image'], false],
    ['matrix.multiply', 'numeric', 'math.matrix', ['a', 'b'], false],
    ['geometry.cloth-iteration', 'geometry', 'engine.cloth.triangular', ['positions', 'velocities', 'constraints', 'curves', 'colors'], false],
    ['signal.fft', 'audio', 'math.signal', ['real'], false],
    ['signal.ifft', 'audio', 'math.signal', ['real', 'imag'], false],
    ['audio.waveform-peaks', 'audio', 'math.audio', ['samples'], false],
    ['audio.windowed-rms', 'audio', 'math.audio', ['samples'], false],
    ['binary.crc32', 'binary', 'math.checksum', ['bytes'], false],
    ['binary.histogram', 'binary', 'math.entropy', ['bytes'], true],
    ['compression.entropy', 'compression', 'math.entropy', ['bytes'], false],
];
const REFERENCE_EXPORTS = Object.freeze({
    'stats.summary': ['statsSum', 'statsMean', 'statsVariance', 'statsPopulationVariance', 'statsMin', 'statsMax'],
    'robust.compensated-sum': ['compensatedSum'],
    'geometry.attribute-bounds': ['attributeBounds'],
    'geometry.transform-points': ['mat4TransformPoint'],
    'image.histogram': ['imageHistogramReport'], 'image.luminance': ['imageLuminanceMap'],
    'image.document-analysis': ['analyzeDocumentImage'], 'matrix.multiply': ['matrixMultiplyF32'],
    'geometry.cloth-iteration': ['executeTriangularClothProgramJs'],
    'signal.fft': ['fft'], 'signal.ifft': ['ifft'],
    'audio.waveform-peaks': ['audioWaveformPeaks'], 'audio.windowed-rms': ['audioWindowedRmsReport'],
    'binary.crc32': ['crc32'], 'binary.histogram': ['byteFrequencyHistogram'],
    'compression.entropy': ['entropyReport', 'histogramEntropyReport'],
});

// Data-only schemas describe the value returned by wait() and the typed arrays
// obtainable with readCopy() on its named output handles. Shape expressions are
// descriptive metadata, never executable code.
const IMAGE_VALUE = { type: 'object', fields: { width: 'integer', height: 'integer', pixelCount: 'integer' } };
const COUNT_VALUE = { type: 'object', fields: { count: 'integer' } };
const HISTOGRAM_OUTPUT = { dtype: 'u32', shape: [256] };
const SYMBOL_VALUE = { type: 'object', fields: { symbol: 'integer', count: 'integer', probability: 'number' } };
const RESULT_CONTRACTS = deepFreezeJson({
    'geometry.cloth-iteration': { value: { type:'object', fields:{ vertexCount:'integer', constraintCount:'integer', iterations:'integer' } }, outputs:{
        positions:{dtype:'f32',shape:['inputs.positions.length']},iterationStart:{dtype:'f32',shape:['inputs.positions.length']},
        constraints:{dtype:'u8',shape:['inputs.constraints.length']},reports:{dtype:'f32',shape:['inputs.constraints.length / 20']} },
        semantics:'Owned triangular XPBD advection and material projections, 1–48 iterations in ordered disjoint colors with retained multipliers; zero iterations requires advection-only work. Millimetre consumers pack SI metres. Outputs are candidate endpoints; caller must perform continuous collision, material, revision and convergence acceptance. This operation does not establish settled cloth or physical garment fit.' },
    'image.document-analysis': { value: { type: 'object', fields: { schema: 'string', recognitionProfile: 'optional string', width: 'integer', height: 'integer',
        glyphCount: 'integer', featureSize: 'integer', lines: 'array', issues: 'array', transforms: 'object', threshold: 'object',
        coordinateUnit: 'string', componentCount: 'integer', regions: 'optional array', partitions: 'array', partitionFeatureCount: 'integer', partitionStats: 'object' } }, outputs: {
        gray: { dtype: 'f32', shape: ['parameters.width * parameters.height'] }, mask: { dtype: 'u8', shape: ['parameters.width * parameters.height'] },
        features: { dtype: 'f32', shape: ['value.glyphCount * 580'] }, partitionFeatures: { dtype: 'f32', shape: ['value.partitionFeatureCount * 580'] } },
        semantics: 'White-composited bounded document segmentation. Mask and gray use analysis pixels; line/glyph boxes and quads map to original pixels. Features are normalized 24x24 ink plus four bounded geometric metrics. Default printed metrics retain line-relative scale; explicit handprint uses per-glyph scale and admits bounded sparse character crops without changing budgets or source coordinates. Optional regions delegates to math.document-regions over the same mask and adds source-pixel line, ink-boundary and artwork candidates. Recognition and sewing interpretation are caller responsibilities.' },
    'matrix.multiply': { value: { type: 'object', fields: { rows: 'integer', columns: 'integer' } }, outputs: {
        matrix: { dtype: 'f32', shape: ['parameters.rows * parameters.columns'], layout: 'row-major rows x columns' } },
        semantics: 'A[rows,inner] times B[inner,columns]. Finite Float32 inputs within ±10000, compensated Float32 product accumulation, bounded dimensions and operation count. CPU and GPU use the same shared kernel contract.' },
    'stats.summary': { value: { type: 'object', fields: { count: 'integer', sum: 'number', mean: 'number',
        variance: 'number', populationVariance: 'number', min: 'number', max: 'number' } }, outputs: {},
        semantics: 'Empty inputs return count 0 and numeric +0. Sum and two-pass variance retain IEEE nonfinite behavior; min/max start with the first value and use strict comparisons.' },
    'robust.compensated-sum': { value: { type: 'object', fields: { valid: 'boolean', count: 'integer', finiteCount: 'integer',
        nonFiniteCount: 'integer', nanCount: 'integer', infiniteCount: 'integer', rawSum: 'number', compensation: 'number',
        sum: 'number', absoluteSum: 'number' } }, outputs: {},
        semantics: 'Neumaier summation in input order over finite samples, with all rejected nonfinite samples counted. Empty sums are +0.' },
    'geometry.attribute-bounds': { value: { type: 'object', fields: { count: 'integer',
        min: { type: 'array', items: 'number', length: 'parameters.componentCount ?? 3' },
        max: { type: 'array', items: 'number', length: 'parameters.componentCount ?? 3' } } }, outputs: {},
        semantics: 'Count is floor(positions.length / componentCount). Ignore trailing components and each nonfinite component independently; components without finite samples return +0. Min/max preserve Math.min/Math.max signed zero.' },
    'geometry.transform-points': { value: COUNT_VALUE, outputs: { positions: { dtype: 'f64',
        dtypeByPrecision: { f64: 'f64', f32: 'f32' }, shape: ['inputs.positions.length'], layout: 'packed xyz tuples' } },
        semantics: 'Column-major 4x4 transform; multiply by 1/w unless abs(w) < 1e-6, when the multiplier is 1. CPU backends calculate in f64 then cast the requested output.' },
    'image.histogram': { value: IMAGE_VALUE, outputs: { r: HISTOGRAM_OUTPUT, g: HISTOGRAM_OUTPUT, b: HISTOGRAM_OUTPUT,
        a: { ...HISTOGRAM_OUTPUT, presentWhen: 'parameters.includeAlpha !== false' },
        luminance: { ...HISTOGRAM_OUTPUT, presentWhen: 'parameters.includeLuminance !== false' } },
        semantics: 'Exact uint32 channel counts. Encoded luminance uses finite coefficients, then round and clamp to 0..255; nonfinite computed luminance uses bin 0.' },
    'image.luminance': { value: IMAGE_VALUE, outputs: { luminance: { dtype: 'f32', shape: ['parameters.width * parameters.height'], layout: 'row-major pixels' } },
        semantics: 'Encoded RGB weighted sum, optionally scaled by 1/255. CPU backends calculate in f64 then cast to f32, retaining IEEE nonfinite results.' },
    'signal.fft': { value: COUNT_VALUE, outputs: { real: { dtype: 'f64', shape: ['inputs.real.length'] }, imag: { dtype: 'f64', shape: ['inputs.real.length'] } },
        semantics: 'Forward unnormalized radix-2 complex FFT. Missing imaginary input is zero-filled. Empty input produces empty outputs.' },
    'signal.ifft': { value: COUNT_VALUE, outputs: { real: { dtype: 'f64', shape: ['inputs.real.length'] }, imag: { dtype: 'f64', shape: ['inputs.real.length'] } },
        semantics: 'Inverse radix-2 complex FFT divided by input length. Empty input produces empty outputs.' },
    'audio.waveform-peaks': { value: { type: 'object', fields: { sampleCount: 'integer', bucketCount: 'integer',
        buckets: { type: 'array', length: 'parameters.bucketCount', items: { type: 'object', fields: { index: 'integer',
            start: 'integer', end: 'integer', min: 'number', max: 'number', peakAbs: 'number' } } } } }, outputs: {},
        semantics: 'Finite PCM only. Buckets use floor(index * sampleCount / bucketCount), contain at least one sample for nonempty input, and may overlap. Empty buckets return +0; extrema preserve signed zero.' },
    'audio.windowed-rms': { value: { type: 'object', fields: { sampleCount: 'integer', windowSize: 'integer', hopSize: 'integer',
        frameCount: 'integer', averageRms: 'number', maxRms: 'number', peakAbs: 'number', frames: { type: 'array',
            length: 'ceil(inputs.samples.length / (parameters.hopSize ?? parameters.windowSize))', items: { type: 'object', fields: {
                index: 'integer', start: 'integer', end: 'integer', sampleCount: 'integer', rms: 'number', peakAbs: 'number' } } } } }, outputs: {},
        semantics: 'Finite PCM only, including a final partial frame. Preserve requested safe-integer window/hop sizes. Empty input returns zero frames and +0 aggregates.' },
    'binary.crc32': { value: { type: 'integer', dtype: 'u32' }, outputs: {}, semantics: 'IEEE CRC32 with optional previousCrc seed; return an unsigned 32-bit number.' },
    'binary.histogram': { value: { type: 'object', fields: { byteLength: 'integer' } }, outputs: { histogram: HISTOGRAM_OUTPUT },
        semantics: 'Exact uint32 counts for all 256 byte values; empty input returns zero bins.' },
    'compression.entropy': { value: { type: 'object', fields: { sampleCount: 'integer', symbolCount: 'integer', uniqueSymbolCount: 'integer',
        entropy: 'number', entropyBitsPerSymbol: 'number', minEntropy: 'number', maxEntropy: 'number', normalizedEntropy: 'number',
        redundancy: 'number', collisionProbability: 'number', health: 'string', mostCommon: SYMBOL_VALUE, leastCommonObserved: SYMBOL_VALUE,
        probabilities: { type: 'typed-array', dtype: 'f64', shape: [256] }, compression: { type: 'object', fields: { sampleCount: 'integer',
            rawBits: 'number', rawBytes: 'number', lowerBoundBits: 'number', lowerBoundBytes: 'number', idealCompressionRatio: 'number', possibleSavingsRatio: 'number' } } } }, outputs: {},
        semantics: 'Exact byte histogram followed by the existing JS entropy report, base 2 and 256 symbols. probabilities is a cloned Float64Array inside value; the report estimates compression and does not encode bytes.' },
});
const EXACT_COMPARISON = deepFreezeJson({ mode: 'exact', numberEquality: 'Object.is', nan: 'equal', signedZero: 'preserve',
    structure: 'identical field names, array lengths and typed-array dtypes' });
const FFT_COMPARISON = deepFreezeJson({ mode: 'absolute-relative', absoluteTolerance: 1e-10, relativeTolerance: 1e-10,
    formula: 'abs(actual - reference) <= absoluteTolerance + relativeTolerance * abs(reference)',
    domain: 'finite inputs with finite intermediate and output values', nonFinite: 'same classification and infinity sign', signedZero: 'equivalent',
    structure: 'identical field names, array lengths and typed-array dtypes' });
const GPU_COMPARISON = deepFreezeJson({ mode: 'absolute-relative', absoluteTolerance: 1e-4, relativeTolerance: 2e-5,
    formula: 'abs(actual - reference) <= absoluteTolerance + relativeTolerance * abs(reference)', precision: 'f32',
    domain: 'finite bounded inputs with finite f32 intermediate and output values; ill-conditioned cancellation and projective w near the 1e-6 branch require CPU execution',
    rejectionCode: 'COMPUTE_PRECISION_UNSUPPORTED', rejection: 'GPU execution rejects values outside its conservative arithmetic and conditioning error bound before publishing outputs',
    nonFinite: 'not covered by the finite comparison domain', signedZero: 'equivalent',
    structure: 'identical field names, array lengths and typed-array dtypes' });

export const COMPUTE_OPERATION_VERSION = 1;
export const COMPUTE_OPERATIONS = Object.freeze(SPECS.map(([name, domain, moduleId, inputs, parallel]) => {
    const addedJs = name === 'image.document-analysis' || name === 'matrix.multiply' || name === 'geometry.cloth-iteration';
    const gpuImplemented = name === 'geometry.transform-points' || name === 'image.luminance' || name === 'matrix.multiply' || name === 'geometry.cloth-iteration';
    const wasmVariants = Object.freeze(addedJs ? [] : gpuImplemented ? ['scalar', 'simd', 'threads', 'threads-simd']
        : parallel ? ['scalar', 'threads'] : ['scalar']);
    return Object.freeze(assertComputeContract('operation', { id: `${PREFIX}${name}@1`, version: 1, name, domain, moduleId,
        inputs: Object.freeze(inputs), cpuExports: Object.freeze(REFERENCE_EXPORTS[name]), parallel, deterministic: true,
        precisions: Object.freeze(name === 'geometry.transform-points' ? ['f64', 'f32']
            : name === 'image.luminance' || addedJs ? ['f32'] : name.endsWith('histogram') || name === 'binary.crc32' ? ['exact'] : ['f64']),
        defaultPrecision: name === 'image.luminance' || addedJs ? 'f32' : name.endsWith('histogram') || name === 'binary.crc32' ? 'exact' : 'f64',
        wasmVariants,
        result: RESULT_CONTRACTS[name],
        parameterSchema: `${CONTRACT_BASE}operation-parameters.v1.schema.json#/$defs/${name}`,
        requestSchema: `${CONTRACT_BASE}job-request.v1.schema.json`, resultSchema: `${CONTRACT_BASE}job-result.v1.schema.json`,
        comparison: Object.freeze({ cpu: name.startsWith('signal.') ? FFT_COMPARISON : EXACT_COMPARISON,
            ...(gpuImplemented ? { webgpu: GPU_COMPARISON } : {}) }),
        gpuPrecisions: Object.freeze(gpuImplemented ? ['f32'] : []),
        backends: Object.freeze(['js', ...wasmVariants.map(variant => `wasm-${variant}`), ...(gpuImplemented ? ['webgpu'] : [])]) }));
}));
const BY_ID = new Map(COMPUTE_OPERATIONS.map(item => [item.id, item]));

export function listComputeOperations(filters = {}) {
    return COMPUTE_OPERATIONS.filter(item => (!filters.domain || item.domain === filters.domain)
        && (!filters.moduleId || item.moduleId === filters.moduleId));
}

export function getComputeOperation(id) { return BY_ID.get(id) || null; }

function failure(code, message) { const error = new Error(message); error.code = code; return error; }
function integer(value, name, minimum = 0) {
    if (!Number.isSafeInteger(value) || value < minimum) throw failure('COMPUTE_INVALID_INPUT', `${name} must be an integer >= ${minimum}`);
    return value;
}
function numeric(value, name) {
    if (!(value instanceof Float32Array || value instanceof Float64Array))
        throw failure('COMPUTE_INVALID_INPUT', `${name} must be a Float32Array or Float64Array`);
    return value;
}
function bytes(value, name) {
    if (!(value instanceof Uint8Array || value instanceof Uint8ClampedArray))
        throw failure('COMPUTE_INVALID_INPUT', `${name} must be an unsigned byte array`);
    return value;
}
function coefficients(parameters) {
    const result = parameters.coefficients ?? [0.2126, 0.7152, 0.0722];
    if ((!Array.isArray(result) && !ArrayBuffer.isView(result)) || result.length !== 3
        || !Array.from(result).every(Number.isFinite)) throw failure('COMPUTE_INVALID_INPUT', 'coefficients must contain three finite numbers');
    return Array.from(result);
}

/**
 * Project consumed controls, with the same defaults/coercions as the native
 * helpers, into each operation's canonical parameter schema. Caller extensions
 * remain bounded and retained by the runtime but are deliberately omitted here.
 * Arrays of samples never enter schema validation; only three coefficients do.
 */
export function projectComputeOperationParameters(operation, parameters = {}) {
    const descriptor = getComputeOperation(operation);
    if (!descriptor) throw failure('COMPUTE_UNKNOWN_OPERATION', `Unknown compute operation: ${operation}`);
    const p = parameters, name = descriptor.name;
    let effective = {};
    if (name === 'geometry.attribute-bounds') effective = { componentCount: p.componentCount ?? 3 };
    else if(name === 'geometry.cloth-iteration') effective = {h:p.h,iterations:p.iterations??1,damping:p.damping??1,gravity:p.gravity??[0,0,0],advect:p.advect===true};
    else if (name === 'matrix.multiply') effective = { rows: p.rows, inner: p.inner, columns: p.columns };
    else if (name.startsWith('image.')) {
        effective = { width: p.width, height: p.height, coefficients: coefficients(p), mode: p.mode || 'encoded',
            output: p.output || 'float32', alphaWeight: Boolean(p.alphaWeight || p.includeAlphaWeight), byteOutput: Boolean(p.byteOutput) };
        if (name === 'image.histogram') Object.assign(effective, { includeAlpha: p.includeAlpha !== false, includeLuminance: p.includeLuminance !== false });
        else if (name === 'image.luminance') effective.normalized = Boolean(p.normalized || p.normalizedOutput);
        else {
            Object.assign(effective, { maxPixels: p.maxPixels ?? DOCUMENT_IMAGE_MAX_PIXELS, budgetMs: p.budgetMs ?? 10000,
                maxGlyphs: p.maxGlyphs ?? 5000, maxComponents: p.maxComponents ?? 20000, threshold: p.threshold ?? 'auto',
                deskew: p.deskew !== false, recognitionProfile: p.recognitionProfile ?? 'printed', regions: Boolean(p.regions) });
            if (p.regions) {
                const region = p.regionOptions ?? {};
                effective.regionOptions = { budgetMs: region.budgetMs ?? 5000, maxRegions: region.maxRegions ?? 256,
                    maxContourPoints: region.maxContourPoints ?? 20000, maxBoundaryEdges: region.maxBoundaryEdges ?? 200000,
                    minLineLength: region.minLineLength ?? 48, minContourArea: region.minContourArea ?? 144,
                    maxLineWidth: region.maxLineWidth ?? 12, maxComponents: region.maxComponents ?? 20000,
                    sourceId: region.sourceId ?? null, pageNumber: region.pageNumber ?? null, sourceRevision: region.sourceRevision ?? null };
            }
        }
    } else if (name === 'audio.waveform-peaks') effective = { bucketCount: p.bucketCount };
    else if (name === 'audio.windowed-rms') effective = { windowSize: p.windowSize, hopSize: p.hopSize ?? p.windowSize };
    else if (name === 'binary.crc32') effective = { previousCrc: Number(p.previousCrc ?? 0) >>> 0 };
    else if (name === 'compression.entropy') effective = { symbolBits: p.symbolBits ?? 8 };
    const projection = projectComputeContractValue(effective);
    return assertComputeContract(descriptor.parameterSchema, projection);
}

/** Validate the bounded, transferable v1 contract before allocation or dispatch. */
export function validateComputeOperation(task, options = {}) {
    const descriptor = getComputeOperation(task?.operation);
    if (!descriptor) throw failure('COMPUTE_UNKNOWN_OPERATION', `Unknown compute operation: ${task?.operation}`);
    const inputs = task.inputs || {};
    const parameters = task.parameters || {};
    if (task.policy?.precision && !descriptor.precisions.includes(task.policy.precision))
        throw failure('COMPUTE_INVALID_INPUT', `Unsupported ${descriptor.name} precision: ${task.policy.precision}`);
    for (const name of descriptor.inputs) {
        if (name === 'image' || name === 'bytes' || descriptor.name==='geometry.cloth-iteration'&&name==='constraints') bytes(inputs[name], name);
        else if(descriptor.name==='geometry.cloth-iteration'&&name==='colors'){if(!(inputs[name] instanceof Uint32Array))throw failure('COMPUTE_INVALID_INPUT','Cloth colors require unsigned32-bit counts');}
        else numeric(inputs[name], name);
    }
    const name = descriptor.name;
    if(name==='geometry.cloth-iteration')validateTriangularClothGpuProgram(inputs,parameters);
    if (name === 'matrix.multiply') {
        try { validateMatrixMultiply(inputs.a, inputs.b, parameters, { scanValues: Boolean(options.scanValues) }); }
        catch (error) { throw failure('COMPUTE_INVALID_INPUT', error.message); }
    }
    if (name === 'geometry.attribute-bounds') integer(parameters.componentCount ?? 3, 'componentCount', 1);
    if (name === 'geometry.transform-points') {
        if (inputs.positions.length % 3 || inputs.matrix.length !== 16)
            throw failure('COMPUTE_INVALID_INPUT', 'Transforms require complete xyz tuples and a 4x4 matrix');
    }
    if (name.startsWith('image.')) {
        const width = integer(parameters.width, 'width', 1);
        const height = integer(parameters.height, 'height', 1);
        if (!Number.isSafeInteger(width * height * 4) || width * height * 4 !== inputs.image.length)
            throw failure('COMPUTE_INVALID_INPUT', 'RGBA dimensions must exactly match the image bytes');
        coefficients(parameters);
        if (parameters.mode && parameters.mode !== 'encoded') throw failure('COMPUTE_INVALID_INPUT', 'Image v1 supports encoded luminance only');
        if (parameters.output && parameters.output !== 'float32') throw failure('COMPUTE_INVALID_INPUT', 'Image v1 luminance output is float32');
        if (parameters.alphaWeight || parameters.includeAlphaWeight || parameters.byteOutput)
            throw failure('COMPUTE_INVALID_INPUT', 'Image v1 does not support alpha weighting or byte output');
        if (name === 'image.document-analysis') {
            const maxPixels = integer(parameters.maxPixels ?? DOCUMENT_IMAGE_MAX_PIXELS, 'maxPixels', 1);
            if (maxPixels > DOCUMENT_IMAGE_MAX_PIXELS || width * height > maxPixels || width > 16384 || height > 16384)
                throw failure('COMPUTE_INVALID_INPUT', 'Document raster exceeds the bounded pixel limit');
            for (const [key, fallback, limit] of [['budgetMs', 10000, 120000], ['maxGlyphs', 5000, 10000], ['maxComponents', 20000, 40000]])
                if (integer(parameters[key] ?? fallback, key, 1) > limit) throw failure('COMPUTE_INVALID_INPUT', `${key} exceeds document analysis limit`);
            if (parameters.threshold && !['auto', 'otsu', 'adaptive'].includes(parameters.threshold)) throw failure('COMPUTE_INVALID_INPUT', 'Unsupported document threshold');
            if (parameters.recognitionProfile !== undefined && !['printed', 'handprint'].includes(parameters.recognitionProfile)) throw failure('COMPUTE_INVALID_INPUT', 'Unsupported document recognition profile');
        }
    }
    if (name.startsWith('signal.')) {
        const count = inputs.real.length;
        if (count > 0x40000000 || (count & (count - 1))) throw failure('COMPUTE_INVALID_INPUT', 'FFT length must be zero or a power of two');
        if (inputs.imag !== undefined && numeric(inputs.imag, 'imag').length !== count)
            throw failure('COMPUTE_INVALID_INPUT', 'FFT real and imaginary lengths must match');
    }
    if (name.startsWith('audio.')) {
        if (options.scanValues) for (const value of inputs.samples) if (!Number.isFinite(value)) throw failure('COMPUTE_INVALID_INPUT', 'Audio samples must be finite');
        if (name === 'audio.waveform-peaks') integer(parameters.bucketCount, 'bucketCount', 1);
        else { integer(parameters.windowSize, 'windowSize', 1); integer(parameters.hopSize ?? parameters.windowSize, 'hopSize', 1); }
    }
    if (name === 'compression.entropy') integer(parameters.symbolBits ?? 8, 'symbolBits', 1);
    projectComputeOperationParameters(task.operation, parameters);
    return descriptor;
}

function histogramResult(report) {
    const { width, height, pixelCount, ...bins } = report;
    const outputs = {};
    for (const [name, value] of Object.entries(bins)) if (value) outputs[name] = value;
    return { value: { width, height, pixelCount }, outputs };
}

export function executeJsOperation(task) {
    const { name } = validateComputeOperation(task, { scanValues: true });
    const i = task.inputs; const p = task.parameters || {};
    switch (name) {
        case 'matrix.multiply': return { value: { rows: p.rows, columns: p.columns }, outputs: { matrix: matrixMultiplyF32(i.a, i.b, p) } };
        case 'geometry.cloth-iteration': return executeTriangularClothProgramJs(i,p);
        case 'image.document-analysis': {
            const analysis = analyzeDocumentImage({ data: i.image, width: p.width, height: p.height }, p);
            if (p.regions) { const regions = analyzeDocumentRegions(analysis, p.regionOptions); analysis.regions = regions.regions; analysis.issues.push(...regions.issues); }
            const { gray, mask, features, partitionFeatures, ...value } = analysis;
            return { value, outputs: { gray, mask, features, partitionFeatures } };
        }
        case 'stats.summary': return { value: { count: i.values.length, sum: statsSum(i.values), mean: statsMean(i.values),
            variance: statsVariance(i.values), populationVariance: statsPopulationVariance(i.values), min: statsMin(i.values), max: statsMax(i.values) }, outputs: {} };
        case 'robust.compensated-sum': return { value: compensatedSum(i.values), outputs: {} };
        case 'geometry.attribute-bounds': return { value: attributeBounds(i.positions, p.componentCount ?? 3), outputs: {} };
        case 'geometry.transform-points': {
            const positions = task.policy?.precision === 'f32' ? new Float32Array(i.positions.length) : new Float64Array(i.positions.length);
            for (let index = 0; index < positions.length; index += 3) positions.set(mat4TransformPoint(i.matrix, i.positions.subarray(index, index + 3)), index);
            return { value: { count: positions.length / 3 }, outputs: { positions } };
        }
        case 'image.histogram': return histogramResult(imageHistogramReport({ data: i.image, width: p.width, height: p.height }, p));
        case 'image.luminance': return { value: { width: p.width, height: p.height, pixelCount: p.width * p.height },
            outputs: { luminance: imageLuminanceMap({ data: i.image, width: p.width, height: p.height }, p) } };
        case 'signal.fft': case 'signal.ifft': {
            const real = new Float64Array(i.real); const imag = i.imag ? new Float64Array(i.imag) : new Float64Array(real.length);
            if (name === 'signal.fft') fft(real, imag); else ifft(real, imag);
            return { value: { count: real.length }, outputs: { real, imag } };
        }
        case 'audio.waveform-peaks': return { value: audioWaveformPeaks(i.samples, p.bucketCount), outputs: {} };
        case 'audio.windowed-rms': return { value: audioWindowedRmsReport(i.samples, p.windowSize, p.hopSize ?? p.windowSize), outputs: {} };
        case 'binary.crc32': return { value: crc32(i.bytes, p.previousCrc ?? 0), outputs: {} };
        case 'binary.histogram': return { value: { byteLength: i.bytes.length }, outputs: { histogram: byteFrequencyHistogram(i.bytes) } };
        case 'compression.entropy': return { value: histogramEntropyReport(byteFrequencyHistogram(i.bytes), { symbolCount: 256, symbolBits: p.symbolBits ?? 8 }), outputs: {} };
        default: throw failure('COMPUTE_UNKNOWN_OPERATION', name);
    }
}

/** Conservative arena requirement, excluding the worker's separately reserved stack. */
export function estimateComputeMemory(task) {
    const { name } = validateComputeOperation(task);
    let total = 65536;
    for (const [key, value] of Object.entries(task.inputs)) total += value.length * (key === 'image' || key === 'bytes' ? 1 : 8) + 16;
    const p = task.parameters || {};
    if (name === 'matrix.multiply') total += p.rows * p.columns * 4;
    if(name==='geometry.cloth-iteration')total+=task.inputs.positions.byteLength*4+task.inputs.constraints.byteLength*6+task.inputs.curves.byteLength*3;
    if (name === 'image.document-analysis') total += p.width * p.height * 40 + (p.maxGlyphs ?? 5000) * 4096 + (p.maxComponents ?? 20000) * 512 + 384 * 580 * 8 + 192 * 2048;
    if (name === 'audio.waveform-peaks') total += p.bucketCount * 24;
    if (name === 'audio.windowed-rms') total += Math.ceil(task.inputs.samples.length / (p.hopSize ?? p.windowSize)) * 16;
    if (name === 'geometry.attribute-bounds') total += (p.componentCount ?? 3) * 16;
    if (name === 'geometry.transform-points') total += task.inputs.positions.length * 8;
    if (name === 'image.histogram') total += 5120;
    if (name === 'image.luminance') total += task.inputs.image.length;
    if (name.startsWith('signal.')) total += task.inputs.real.length * (task.inputs.imag ? 8 : 16);
    if (name.startsWith('binary.') || name === 'compression.entropy') total += 1024;
    if (!Number.isSafeInteger(total)) throw failure('COMPUTE_MEMORY_LIMIT', 'Compute allocation exceeds addressable memory');
    return Math.ceil(total / 65536) * 65536;
}

/** Worker transport copies, detached result copies, and bounded JS report/scratch allowance. */
export function estimateComputeTransferBytes(task) {
    const { name } = validateComputeOperation(task);
    const i = task.inputs; const p = task.parameters || {};
    const inputBytes = Object.values(i).reduce((sum, value) => sum + value.byteLength, 0);
    let outputBytes = 0; let reportBytes = 512; let scratchBytes = 65536;
    if (name === 'matrix.multiply') outputBytes = p.rows * p.columns * 4;
    if(name==='geometry.cloth-iteration'){outputBytes=i.positions.byteLength*2+i.constraints.byteLength*1.2;scratchBytes+=i.constraints.byteLength*8+i.curves.byteLength*4+i.positions.byteLength*8;}
    if (name === 'image.document-analysis') {
        outputBytes = p.width * p.height * 5 + ((p.maxGlyphs ?? 5000) + 384) * 580 * 4;
        reportBytes += (p.maxGlyphs ?? 5000) * 2048 + (p.maxComponents ?? 20000) * 512 + 192 * 2048;
        scratchBytes += p.width * p.height * 32;
    }
    if (name === 'geometry.transform-points') outputBytes = i.positions.length * (task.policy?.precision === 'f32' ? 4 : 8);
    if (name === 'geometry.attribute-bounds') reportBytes += (p.componentCount ?? 3) * 32;
    if (name === 'image.histogram') outputBytes = 5120;
    if (name === 'image.luminance') outputBytes = i.image.length;
    if (name.startsWith('signal.')) outputBytes = i.real.length * 16;
    if (name === 'binary.histogram') outputBytes = 1024;
    if (name === 'compression.entropy') reportBytes += 8192;
    if (name === 'robust.compensated-sum') scratchBytes += i.values.length * 24;
    if (name === 'audio.waveform-peaks') reportBytes += p.bucketCount * 256;
    if (name === 'audio.windowed-rms') {
        reportBytes += Math.ceil(i.samples.length / (p.hopSize ?? p.windowSize)) * 256;
        scratchBytes += Math.min(i.samples.length, p.windowSize) * 8;
    }
    const total = inputBytes + outputBytes * 2 + reportBytes * 2 + scratchBytes;
    if (!Number.isSafeInteger(total)) throw failure('COMPUTE_MEMORY_LIMIT', 'Compute transfer estimate exceeds addressable memory');
    return total;
}

function createArena(memory, start, end) {
    let cursor = Math.ceil(start / 16) * 16;
    const allocate = (Type, count, source = null) => {
        const size = count * Type.BYTES_PER_ELEMENT;
        const offset = cursor;
        cursor = Math.ceil((cursor + size) / 16) * 16;
        if (!Number.isSafeInteger(cursor) || cursor > end || cursor > memory.buffer.byteLength)
            throw failure('COMPUTE_MEMORY_LIMIT', 'Wasm worker arena is too small');
        const view = new Type(memory.buffer, offset, count);
        if (source) view.set(source); else view.fill(0);
        return { offset, view };
    };
    return { allocate, get bytesUsed() { return cursor - start; } };
}

/** Execute approved exports only; reports and transferable copies remain in JavaScript. */
export function executeWasmOperation(task, context) {
    const { name } = validateComputeOperation(task, { scanValues: true });
    const { instance, memory, arenaStart = 65536, arenaEnd = memory.buffer.byteLength, cancelOffset = 0 } = context;
    const arena = createArena(memory, arenaStart, arenaEnd);
    const alloc = (Type, count, source) => arena.allocate(Type, count, source);
    const doubles = source => alloc(Float64Array, source.length, source);
    const i = task.inputs; const p = task.parameters || {};
    const invoke = (exportName, args) => {
        const fn = instance.exports[exportName];
        if (typeof fn !== 'function') throw failure('COMPUTE_ABI_MISMATCH', `Missing Wasm export ${exportName}`);
        const status = fn(...args, cancelOffset);
        if (exportName !== 'crc32' && status !== 0) throw failure(status === 1 ? 'COMPUTE_CANCELLED' : 'COMPUTE_KERNEL_FAILED', `Wasm ${exportName} did not complete`);
        return status;
    };
    let result;
    switch (name) {
        case 'stats.summary': {
            const input = doubles(i.values); const out = alloc(Float64Array, 6);
            invoke('stats', [input.offset, i.values.length, out.offset]);
            const [sum, mean, variance, populationVariance, min, max] = out.view;
            result = { value: { count: i.values.length, sum, mean, variance, populationVariance, min, max }, outputs: {} }; break;
        }
        case 'robust.compensated-sum': {
            const values = Float64Array.from(i.values).filter(Number.isFinite);
            const input = doubles(values); const out = alloc(Float64Array, 4);
            invoke('compensated_sum', [input.offset, values.length, out.offset]);
            const [rawSum, compensation, sum, absoluteSum] = out.view;
            let nanCount = 0; for (const value of i.values) if (Number.isNaN(value)) nanCount++;
            result = { value: { valid: values.length === i.values.length, count: i.values.length, finiteCount: values.length,
                nonFiniteCount: i.values.length - values.length, nanCount, infiniteCount: i.values.length - values.length - nanCount,
                rawSum, compensation, sum, absoluteSum }, outputs: {} }; break;
        }
        case 'geometry.attribute-bounds': {
            const input = doubles(i.positions); const components = p.componentCount ?? 3; const out = alloc(Float64Array, components * 2);
            invoke('bounds', [input.offset, Math.floor(i.positions.length / components), components, out.offset]);
            result = { value: { min: Array.from(out.view.subarray(0, components)), max: Array.from(out.view.subarray(components)),
                count: Math.floor(i.positions.length / components) }, outputs: {} }; break;
        }
        case 'geometry.transform-points': {
            const input = doubles(i.positions); const matrix = doubles(i.matrix); const out = alloc(Float64Array, i.positions.length);
            invoke('transform_points', [input.offset, i.positions.length / 3, matrix.offset, out.offset]);
            result = { value: { count: i.positions.length / 3 }, outputs: { positions: task.policy?.precision === 'f32' ? new Float32Array(out.view) : new Float64Array(out.view) } }; break;
        }
        case 'image.histogram': case 'image.luminance': {
            const input = alloc(Uint8Array, i.image.length, i.image); const pixels = p.width * p.height; const coeff = coefficients(p);
            if (name === 'image.histogram') {
                const out = alloc(Uint32Array, 1280);
                invoke('rgba_histogram', [input.offset, pixels, out.offset, ...coeff]);
                const outputs = {};
                for (const [index, key] of ['r', 'g', 'b', 'a', 'luminance'].entries()) {
                    if (key === 'a' && p.includeAlpha === false || key === 'luminance' && p.includeLuminance === false) continue;
                    outputs[key] = new Uint32Array(out.view.subarray(index * 256, (index + 1) * 256));
                }
                result = { value: { width: p.width, height: p.height, pixelCount: pixels }, outputs };
            } else {
                const out = alloc(Float32Array, pixels);
                invoke('luminance', [input.offset, pixels, out.offset, ...coeff, p.normalized || p.normalizedOutput ? 1 / 255 : 1]);
                result = { value: { width: p.width, height: p.height, pixelCount: pixels }, outputs: { luminance: new Float32Array(out.view) } };
            }
            break;
        }
        case 'signal.fft': case 'signal.ifft': {
            const count = i.real.length; const real = doubles(i.real); const imag = i.imag ? doubles(i.imag) : alloc(Float64Array, count);
            if (count === 0) { result = { value: { count }, outputs: { real: new Float64Array(0), imag: new Float64Array(0) } }; break; }
            const twiddles = alloc(Float64Array, count);
            for (let index = 0; index < count / 2; index++) { twiddles.view[index * 2] = Math.cos(2 * Math.PI * index / count); twiddles.view[index * 2 + 1] = Math.sin(2 * Math.PI * index / count); }
            invoke('fft', [real.offset, imag.offset, count, twiddles.offset, name === 'signal.ifft' ? 1 : 0]);
            result = { value: { count }, outputs: { real: new Float64Array(real.view), imag: new Float64Array(imag.view) } }; break;
        }
        case 'audio.waveform-peaks': {
            const input = doubles(i.samples); const count = i.samples.length; const buckets = p.bucketCount; const out = alloc(Float64Array, buckets * 3);
            invoke('waveform', [input.offset, count, buckets, out.offset]);
            const records = Array.from({ length: buckets }, (_, index) => {
                const start = Math.floor(index * count / buckets); const end = count ? Math.min(count, Math.max(start + 1, Math.floor((index + 1) * count / buckets))) : 0;
                return { index, start, end, min: out.view[index * 3], max: out.view[index * 3 + 1], peakAbs: out.view[index * 3 + 2] };
            });
            result = { value: { sampleCount: count, bucketCount: buckets, buckets: records }, outputs: {} }; break;
        }
        case 'audio.windowed-rms': {
            const input = doubles(i.samples); const count = i.samples.length; const windowSize = p.windowSize; const hopSize = p.hopSize ?? windowSize;
            const frames = Math.ceil(count / hopSize); const out = alloc(Float64Array, frames * 2);
            invoke('windowed_rms', [input.offset, count, Math.min(windowSize, Math.max(count, 1)), Math.min(hopSize, Math.max(count, 1)), out.offset]);
            let sum = 0; let maxRms = 0; let peakAbs = 0;
            const records = Array.from({ length: frames }, (_, index) => { const start = index * hopSize; const end = Math.min(count, start + windowSize);
                const rms = out.view[index * 2]; const peak = out.view[index * 2 + 1]; sum += rms; maxRms = Math.max(maxRms, rms); peakAbs = Math.max(peakAbs, peak);
                return { index, start, end, sampleCount: end - start, rms, peakAbs: peak }; });
            result = { value: { sampleCount: count, windowSize, hopSize, frameCount: frames, averageRms: frames ? sum / frames : 0, maxRms, peakAbs, frames: records }, outputs: {} }; break;
        }
        case 'binary.crc32': case 'binary.histogram': case 'compression.entropy': {
            const input = alloc(Uint8Array, i.bytes.length, i.bytes);
            if (name === 'binary.crc32') result = { value: invoke('crc32', [input.offset, i.bytes.length, p.previousCrc ?? 0]) >>> 0, outputs: {} };
            else { const out = alloc(Uint32Array, 256); invoke('byte_histogram', [input.offset, i.bytes.length, out.offset]);
                result = name === 'binary.histogram' ? { value: { byteLength: i.bytes.length }, outputs: { histogram: new Uint32Array(out.view) } }
                    : { value: histogramEntropyReport(out.view, { symbolCount: 256, symbolBits: p.symbolBits ?? 8 }), outputs: {} }; }
            break;
        }
        default: throw failure('COMPUTE_UNKNOWN_OPERATION', name);
    }
    return { ...result, metrics: { arenaBytes: arena.bytesUsed } };
}

/** Merge only explicitly partition-safe v1 operations; caller supplies ordered partitions. */
export function mergeComputePartitions(operation, parts, task) {
    const descriptor = getComputeOperation(operation);
    if (!descriptor?.parallel || parts.length === 0) throw failure('COMPUTE_INVALID_PARTITION', 'Operation does not support partition merging');
    const outputs = {};
    for (const key of Object.keys(parts[0].outputs)) {
        const source = parts[0].outputs[key];
        const isHistogram = descriptor.name.endsWith('histogram');
        const length = isHistogram ? source.length : parts.reduce((total, part) => total + part.outputs[key].length, 0);
        const result = new source.constructor(length); let offset = 0;
        for (const part of parts) {
            if (isHistogram) for (let index = 0; index < length; index++) result[index] += part.outputs[key][index];
            else { result.set(part.outputs[key], offset); offset += part.outputs[key].length; }
        }
        outputs[key] = result;
    }
    const p = task.parameters || {};
    const value = descriptor.name.startsWith('image.') ? { width: p.width, height: p.height, pixelCount: p.width * p.height }
        : descriptor.name === 'binary.histogram' ? { byteLength: task.inputs.bytes.length }
            : { count: task.inputs.positions.length / 3 };
    return { value, outputs };
}
