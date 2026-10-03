// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathSignal.js - FFT and Signal Processing
// FFT, window functions, filters, convolution, spectral analysis

import { PI, TAU } from './MathConstants.js';
import { random } from './MathRandom.js';
import { lerp } from './MathScalar.js';

// ============================================================================
// FAST FOURIER TRANSFORM
// ============================================================================

// Cooley-Tukey FFT (radix-2)
export function fft(real, imag = null) {
  const n = real.length;

  if ((n & (n - 1)) !== 0) {
    throw new Error('FFT size must be a power of 2');
  }

  // Initialize imaginary part if not provided
  if (!imag) {
    imag = new Array(n).fill(0);
  }

  // Bit reversal permutation
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    const j = _reverseBits(i, bits);
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  // Cooley-Tukey iterative FFT
  for (let size = 2; size <= n; size *= 2) {
    const halfSize = size / 2;
    const angleStep = -TAU / size;

    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < halfSize; j++) {
        const angle = angleStep * j;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const idx1 = i + j;
        const idx2 = i + j + halfSize;

        const tReal = cos * real[idx2] - sin * imag[idx2];
        const tImag = sin * real[idx2] + cos * imag[idx2];

        real[idx2] = real[idx1] - tReal;
        imag[idx2] = imag[idx1] - tImag;
        real[idx1] = real[idx1] + tReal;
        imag[idx1] = imag[idx1] + tImag;
      }
    }
  }

  return { real, imag };
}

// Inverse FFT
export function ifft(real, imag) {
  const n = real.length;

  // Conjugate
  for (let i = 0; i < n; i++) {
    imag[i] = -imag[i];
  }

  // Forward FFT
  const result = fft(real, imag);

  // Conjugate and scale
  for (let i = 0; i < n; i++) {
    result.real[i] /= n;
    result.imag[i] = -result.imag[i] / n;
  }

  return result;
}

// Real FFT (optimized for real input)
export function rfft(input) {
  const n = input.length;
  return fft([...input], new Array(n).fill(0));
}

// Power spectrum
export function powerSpectrum(real, imag) {
  return real.map((r, i) => r * r + imag[i] * imag[i]);
}

// Magnitude spectrum
export function magnitudeSpectrum(real, imag) {
  return real.map((r, i) => Math.sqrt(r * r + imag[i] * imag[i]));
}

// Phase spectrum
export function phaseSpectrum(real, imag) {
  return real.map((r, i) => Math.atan2(imag[i], r));
}

// Frequency bins for FFT output
export function fftFrequencies(n, sampleRate) {
  const frequencies = new Array(n);
  for (let i = 0; i < n; i++) {
    frequencies[i] = (i < n / 2) ? (i * sampleRate / n) : ((i - n) * sampleRate / n);
  }
  return frequencies;
}

// Positive frequency bins only
export function rfftFrequencies(n, sampleRate) {
  const numBins = Math.floor(n / 2) + 1;
  const frequencies = new Array(numBins);
  for (let i = 0; i < numBins; i++) {
    frequencies[i] = i * sampleRate / n;
  }
  return frequencies;
}

// 2D FFT. The optional fourth argument preserves existing real-only callers.
// Input arrays are copied; neither real nor imaginary input is mutated.
export function fft2D(data, width, height, imaginary = null) {
  width = _positiveInteger(width, 'width');
  height = _positiveInteger(height, 'height');
  if (!Number.isInteger(Math.log2(width)) || !Number.isInteger(Math.log2(height))) {
    throw new RangeError('2D FFT width and height must be powers of two');
  }
  const count = width * height;
  if (!Number.isSafeInteger(count) || _signalSamples(data).length !== count
      || imaginary !== null && _signalSamples(imaginary).length !== count) {
    throw new RangeError('2D FFT input lengths must equal width * height');
  }
  const inputReal = Array.from(data, (value, index) => _finiteSample(value, index, 'real'));
  const inputImag = imaginary === null ? new Array(count).fill(0)
    : Array.from(imaginary, (value, index) => _finiteSample(value, index, 'imag'));
  // Row-wise FFT
  const rowResult = [];
  for (let y = 0; y < height; y++) {
    const row = inputReal.slice(y * width, (y + 1) * width);
    const rowImag = inputImag.slice(y * width, (y + 1) * width);
    const { real, imag } = fft(row, rowImag);
    rowResult.push({ real, imag });
  }

  // Column-wise FFT
  const resultReal = new Array(width * height);
  const resultImag = new Array(width * height);

  for (let x = 0; x < width; x++) {
    const colReal = rowResult.map(r => r.real[x]);
    const colImag = rowResult.map(r => r.imag[x]);
    const { real, imag } = fft(colReal, colImag);

    for (let y = 0; y < height; y++) {
      resultReal[y * width + x] = real[y];
      resultImag[y * width + x] = imag[y];
    }
  }

  return { real: resultReal, imag: resultImag, width, height };
}

// Inverse 2D FFT
export function ifft2D(real, imag, width, height) {
  // Conjugate
  const conjImag = imag == null ? null : Array.from(_signalSamples(imag), (value, index) => -_finiteSample(value, index, 'imag'));

  // Forward 2D FFT
  const result = fft2D(real, width, height, conjImag);

  // Conjugate and scale
  const n = result.width * result.height;
  return {
    real: result.real.map(x => x / n),
    imag: result.imag.map(x => -x / n),
    width: result.width,
    height: result.height
  };
}

// ============================================================================
// WINDOW FUNCTIONS
// ============================================================================

export function hannWindow(n) {
  const window = new Array(n);
  for (let i = 0; i < n; i++) {
    window[i] = 0.5 * (1 - Math.cos(TAU * i / (n - 1)));
  }
  return window;
}

export function hammingWindow(n) {
  const window = new Array(n);
  for (let i = 0; i < n; i++) {
    window[i] = 0.54 - 0.46 * Math.cos(TAU * i / (n - 1));
  }
  return window;
}

export function blackmanWindow(n) {
  const window = new Array(n);
  const a0 = 0.42, a1 = 0.5, a2 = 0.08;
  for (let i = 0; i < n; i++) {
    window[i] = a0 - a1 * Math.cos(TAU * i / (n - 1)) + a2 * Math.cos(2 * TAU * i / (n - 1));
  }
  return window;
}

export function blackmanHarrisWindow(n) {
  const window = new Array(n);
  const a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
  for (let i = 0; i < n; i++) {
    const x = TAU * i / (n - 1);
    window[i] = a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x) - a3 * Math.cos(3 * x);
  }
  return window;
}

export function kaiserWindow(n, beta = 5) {
  const window = new Array(n);
  const i0Beta = _besselI0(beta);
  const half = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const x = (i - half) / half;
    window[i] = _besselI0(beta * Math.sqrt(1 - x * x)) / i0Beta;
  }
  return window;
}

export function gaussianWindow(n, sigma = 0.4) {
  const window = new Array(n);
  const half = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const x = (i - half) / (sigma * half);
    window[i] = Math.exp(-0.5 * x * x);
  }
  return window;
}

export function triangularWindow(n) {
  const window = new Array(n);
  const half = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    window[i] = 1 - Math.abs((i - half) / half);
  }
  return window;
}

export function flatTopWindow(n) {
  const window = new Array(n);
  const a0 = 0.21557895, a1 = 0.41663158, a2 = 0.277263158, a3 = 0.083578947, a4 = 0.006947368;
  for (let i = 0; i < n; i++) {
    const x = TAU * i / (n - 1);
    window[i] = a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x) - a3 * Math.cos(3 * x) + a4 * Math.cos(4 * x);
  }
  return window;
}

export function rectangularWindow(n) {
  return new Array(n).fill(1);
}

// Apply window to signal
export function applyWindow(signal, window) {
  return signal.map((s, i) => s * window[i]);
}

// ============================================================================
// FILTERS
// ============================================================================

// ============================================================================
// SIGNAL MEASUREMENTS AND RESAMPLING
// ============================================================================

export function signalEnergy(signal) {
  const samples = _signalSamples(signal);
  let energy = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = _finiteSample(samples[i], i, 'signal');
    energy += sample * sample;
  }
  return energy;
}

export function signalMean(signal) {
  const samples = _signalSamples(signal);
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += _finiteSample(samples[i], i, 'signal');
  }
  return sum / samples.length;
}

export function signalRms(signal) {
  const samples = _signalSamples(signal);
  return samples.length === 0 ? 0 : Math.sqrt(signalEnergy(samples) / samples.length);
}

export function signalPeakReport(signal) {
  const samples = _signalSamples(signal);
  if (samples.length === 0) {
    return {
      sampleCount: 0,
      min: null,
      max: null,
      peak: 0,
      peakAbs: 0,
      peakIndex: -1,
      peakToPeak: 0
    };
  }

  let min = Infinity;
  let max = -Infinity;
  let peak = 0;
  let peakAbs = -Infinity;
  let peakIndex = -1;
  for (let i = 0; i < samples.length; i++) {
    const sample = _finiteSample(samples[i], i, 'signal');
    const abs = Math.abs(sample);
    if (sample < min) min = sample;
    if (sample > max) max = sample;
    if (abs > peakAbs) {
      peak = sample;
      peakAbs = abs;
      peakIndex = i;
    }
  }

  return {
    sampleCount: samples.length,
    min,
    max,
    peak,
    peakAbs,
    peakIndex,
    peakToPeak: max - min
  };
}

export function zeroCrossingCount(signal, options = {}) {
  const samples = _signalSamples(signal);
  const countZeroTouches = options.countZeroTouches === true;
  let crossings = 0;
  let previousSign = 0;

  for (let i = 0; i < samples.length; i++) {
    const sample = _finiteSample(samples[i], i, 'signal');
    const sign = Math.sign(sample);
    if (sign === 0) {
      if (countZeroTouches && previousSign !== 0) crossings++;
      continue;
    }
    if (previousSign !== 0 && sign !== previousSign) crossings++;
    previousSign = sign;
  }

  return crossings;
}

export function zeroCrossingRate(signal, options = {}) {
  const samples = _signalSamples(signal);
  if (samples.length < 2) return 0;
  return zeroCrossingCount(samples, options) / (samples.length - 1);
}

export function signalSummaryReport(signal, options = {}) {
  const samples = _signalSamples(signal);
  const sampleRate = options.sampleRate === undefined ? null : _positiveFinite(options.sampleRate, 'sampleRate');
  let finiteCount = 0;
  let nonFiniteCount = 0;
  let sum = 0;
  let energy = 0;
  let min = Infinity;
  let max = -Infinity;
  let peak = 0;
  let peakAbs = -Infinity;
  let peakIndex = -1;

  for (let i = 0; i < samples.length; i++) {
    const sample = Number(samples[i]);
    if (!Number.isFinite(sample)) {
      nonFiniteCount++;
      continue;
    }
    finiteCount++;
    sum += sample;
    energy += sample * sample;
    if (sample < min) min = sample;
    if (sample > max) max = sample;
    const abs = Math.abs(sample);
    if (abs > peakAbs) {
      peak = sample;
      peakAbs = abs;
      peakIndex = i;
    }
  }

  const mean = finiteCount === 0 ? 0 : sum / finiteCount;
  const rms = finiteCount === 0 ? 0 : Math.sqrt(energy / finiteCount);
  const zeroCrossings = nonFiniteCount === 0 ? zeroCrossingCount(samples, options) : null;
  const zeroCrossRate = zeroCrossings === null || samples.length < 2 ? null : zeroCrossings / (samples.length - 1);
  const finiteMin = finiteCount === 0 ? null : min;
  const finiteMax = finiteCount === 0 ? null : max;
  const finitePeakAbs = finiteCount === 0 ? 0 : peakAbs;

  return {
    valid: nonFiniteCount === 0,
    sampleCount: samples.length,
    finiteCount,
    nonFiniteCount,
    sampleRate,
    durationSeconds: sampleRate === null ? null : samples.length / sampleRate,
    sum,
    mean,
    dcOffset: mean,
    min: finiteMin,
    max: finiteMax,
    peak,
    peakAbs: finitePeakAbs,
    peakIndex,
    peakToPeak: finiteCount === 0 ? 0 : finiteMax - finiteMin,
    energy,
    rms,
    crestFactor: rms === 0 ? 0 : finitePeakAbs / rms,
    zeroCrossings,
    zeroCrossingRate: zeroCrossRate
  };
}

export function resampleLengthForRate(sampleCount, sourceSampleRate, targetSampleRate) {
  const count = _nonnegativeInteger(sampleCount, 'sampleCount');
  const sourceRate = _positiveFinite(sourceSampleRate, 'sourceSampleRate');
  const targetRate = _positiveFinite(targetSampleRate, 'targetSampleRate');
  return Math.max(1, Math.round(count * targetRate / sourceRate));
}

export function resampleNearest(signal, targetLength) {
  const samples = _signalSamples(signal);
  const length = _positiveInteger(targetLength, 'targetLength');
  if (samples.length === 0) return new Array(length).fill(0);
  if (samples.length === 1 || length === 1) return new Array(length).fill(_finiteSample(samples[0], 0, 'signal'));

  const result = new Array(length);
  const scale = (samples.length - 1) / (length - 1);
  for (let i = 0; i < length; i++) {
    const sourceIndex = Math.round(i * scale);
    result[i] = _finiteSample(samples[sourceIndex], sourceIndex, 'signal');
  }
  return result;
}

export function resampleLinear(signal, targetLength) {
  const samples = _signalSamples(signal);
  const length = _positiveInteger(targetLength, 'targetLength');
  if (samples.length === 0) return new Array(length).fill(0);
  if (samples.length === 1 || length === 1) return new Array(length).fill(_finiteSample(samples[0], 0, 'signal'));

  const result = new Array(length);
  const scale = (samples.length - 1) / (length - 1);
  for (let i = 0; i < length; i++) {
    const sourcePosition = i * scale;
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const fraction = sourcePosition - leftIndex;
    const left = _finiteSample(samples[leftIndex], leftIndex, 'signal');
    const right = _finiteSample(samples[rightIndex], rightIndex, 'signal');
    result[i] = lerp(left, right, fraction);
  }
  return result;
}

// Moving average filter
export function movingAverage(signal, windowSize) {
  const result = new Array(signal.length);
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < signal.length; i++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - halfWindow); j <= Math.min(signal.length - 1, i + halfWindow); j++) {
      sum += signal[j];
      count++;
    }
    result[i] = sum / count;
  }

  return result;
}

// Exponential moving average
export function exponentialMovingAverage(signal, alpha = 0.3) {
  const result = new Array(signal.length);
  result[0] = signal[0];

  for (let i = 1; i < signal.length; i++) {
    result[i] = alpha * signal[i] + (1 - alpha) * result[i - 1];
  }

  return result;
}

// Median filter
export function medianFilter(signal, windowSize) {
  const result = new Array(signal.length);
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < signal.length; i++) {
    const window = [];
    for (let j = Math.max(0, i - halfWindow); j <= Math.min(signal.length - 1, i + halfWindow); j++) {
      window.push(signal[j]);
    }
    window.sort((a, b) => a - b);
    result[i] = window[Math.floor(window.length / 2)];
  }

  return result;
}

// Savitzky-Golay filter (simplified - window 5, polynomial order 2)
export function savitzkyGolayFilter(signal) {
  const result = new Array(signal.length);
  const coeffs = [-3, 12, 17, 12, -3];
  const norm = 35;

  result[0] = signal[0];
  result[1] = signal[1];
  result[signal.length - 2] = signal[signal.length - 2];
  result[signal.length - 1] = signal[signal.length - 1];

  for (let i = 2; i < signal.length - 2; i++) {
    result[i] = (coeffs[0] * signal[i - 2] + coeffs[1] * signal[i - 1] +
                 coeffs[2] * signal[i] + coeffs[3] * signal[i + 1] +
                 coeffs[4] * signal[i + 2]) / norm;
  }

  return result;
}

// Butterworth lowpass filter coefficients (1st order)
export function butterworthLowpass1(cutoffFreq, sampleRate) {
  const wc = Math.tan(PI * cutoffFreq / sampleRate);
  const k = 1 / (1 + wc);
  return {
    b: [wc * k, wc * k],
    a: [1, (wc - 1) * k]
  };
}

// Butterworth highpass filter coefficients (1st order)
export function butterworthHighpass1(cutoffFreq, sampleRate) {
  const wc = Math.tan(PI * cutoffFreq / sampleRate);
  const k = 1 / (1 + wc);
  return {
    b: [k, -k],
    a: [1, (wc - 1) * k]
  };
}

// Apply IIR filter
export function iirFilter(signal, b, a) {
  const result = new Array(signal.length).fill(0);

  for (let i = 0; i < signal.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (i - j >= 0) {
        result[i] += b[j] * signal[i - j];
      }
    }
    for (let j = 1; j < a.length; j++) {
      if (i - j >= 0) {
        result[i] -= a[j] * result[i - j];
      }
    }
    result[i] /= a[0];
  }

  return result;
}

// FIR filter
export function firFilter(signal, coefficients) {
  const result = new Array(signal.length).fill(0);
  const n = coefficients.length;

  for (let i = 0; i < signal.length; i++) {
    for (let j = 0; j < n; j++) {
      if (i - j >= 0) {
        result[i] += coefficients[j] * signal[i - j];
      }
    }
  }

  return result;
}

// Generate FIR lowpass coefficients (sinc-based)
export function firLowpassCoeffs(cutoffFreq, sampleRate, numTaps) {
  const coeffs = new Array(numTaps);
  const wc = TAU * cutoffFreq / sampleRate;
  const mid = (numTaps - 1) / 2;

  for (let i = 0; i < numTaps; i++) {
    if (i === mid) {
      coeffs[i] = wc / PI;
    } else {
      const x = i - mid;
      coeffs[i] = Math.sin(wc * x) / (PI * x);
    }
  }

  // Apply window
  const window = hammingWindow(numTaps);
  for (let i = 0; i < numTaps; i++) {
    coeffs[i] *= window[i];
  }

  // Normalize
  const sum = coeffs.reduce((a, b) => a + b, 0);
  for (let i = 0; i < numTaps; i++) {
    coeffs[i] /= sum;
  }

  return coeffs;
}

// Generate FIR highpass coefficients
export function firHighpassCoeffs(cutoffFreq, sampleRate, numTaps) {
  const lowpass = firLowpassCoeffs(cutoffFreq, sampleRate, numTaps);
  const mid = Math.floor(numTaps / 2);

  return lowpass.map((c, i) => (i === mid ? 1 - c : -c));
}

// Generate FIR bandpass coefficients
export function firBandpassCoeffs(lowFreq, highFreq, sampleRate, numTaps) {
  const lowpass = firLowpassCoeffs(highFreq, sampleRate, numTaps);
  const highpass = firHighpassCoeffs(lowFreq, sampleRate, numTaps);

  return lowpass.map((l, i) => l + highpass[i]);
}

// ============================================================================
// CONVOLUTION
// ============================================================================

// Linear convolution
export function convolve(signal, kernel) {
  const n = signal.length;
  const m = kernel.length;
  const result = new Array(n + m - 1).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      result[i + j] += signal[i] * kernel[j];
    }
  }

  return result;
}

// Same-size convolution
export function convolveSame(signal, kernel) {
  const full = convolve(signal, kernel);
  const offset = Math.floor(kernel.length / 2);
  return full.slice(offset, offset + signal.length);
}

// FFT-based convolution (faster for large signals)
export function convolveFFT(signal, kernel) {
  const n = signal.length + kernel.length - 1;
  const paddedSize = _nextPowerOf2(n);

  // Zero-pad
  const paddedSignal = [...signal, ...new Array(paddedSize - signal.length).fill(0)];
  const paddedKernel = [...kernel, ...new Array(paddedSize - kernel.length).fill(0)];

  // FFT
  const signalFFT = fft(paddedSignal);
  const kernelFFT = fft(paddedKernel);

  // Multiply in frequency domain
  const resultReal = new Array(paddedSize);
  const resultImag = new Array(paddedSize);
  for (let i = 0; i < paddedSize; i++) {
    resultReal[i] = signalFFT.real[i] * kernelFFT.real[i] - signalFFT.imag[i] * kernelFFT.imag[i];
    resultImag[i] = signalFFT.real[i] * kernelFFT.imag[i] + signalFFT.imag[i] * kernelFFT.real[i];
  }

  // IFFT
  const result = ifft(resultReal, resultImag);

  return result.real.slice(0, n);
}

// Cross-correlation
export function crossCorrelation(signal1, signal2) {
  const reversed = [...signal2].reverse();
  return convolve(signal1, reversed);
}

// Autocorrelation
export function autocorrelation(signal) {
  return crossCorrelation(signal, signal);
}

// Normalized cross-correlation
export function normalizedCrossCorrelation(signal1, signal2) {
  const corr = crossCorrelation(signal1, signal2);
  const norm1 = Math.sqrt(signal1.reduce((s, x) => s + x * x, 0));
  const norm2 = Math.sqrt(signal2.reduce((s, x) => s + x * x, 0));
  const normFactor = norm1 * norm2;
  return corr.map(c => c / normFactor);
}

// ============================================================================
// SPECTRAL ANALYSIS
// ============================================================================

// Short-time Fourier Transform (STFT)
export function stft(signal, windowSize, hopSize, windowFn = hannWindow) {
  const window = windowFn(windowSize);
  const numFrames = Math.floor((signal.length - windowSize) / hopSize) + 1;
  const frames = [];

  for (let i = 0; i < numFrames; i++) {
    const start = i * hopSize;
    const frame = signal.slice(start, start + windowSize);
    const windowed = applyWindow(frame, window);
    frames.push(fft(windowed));
  }

  return { frames, windowSize, hopSize };
}

// Inverse STFT
export function istft(frames, windowSize, hopSize, outputLength) {
  const window = hannWindow(windowSize);
  const result = new Array(outputLength).fill(0);
  const windowSum = new Array(outputLength).fill(0);

  for (let i = 0; i < frames.length; i++) {
    const start = i * hopSize;
    const { real } = ifft([...frames[i].real], [...frames[i].imag]);

    for (let j = 0; j < windowSize && start + j < outputLength; j++) {
      result[start + j] += real[j] * window[j];
      windowSum[start + j] += window[j] * window[j];
    }
  }

  // Normalize by window sum
  for (let i = 0; i < outputLength; i++) {
    if (windowSum[i] > 1e-8) {
      result[i] /= windowSum[i];
    }
  }

  return result;
}

// Spectrogram (magnitude STFT)
export function spectrogram(signal, windowSize, hopSize, windowFn = hannWindow) {
  const { frames } = stft(signal, windowSize, hopSize, windowFn);
  return frames.map(f => magnitudeSpectrum(f.real, f.imag).slice(0, windowSize / 2 + 1));
}

// Mel filterbank
export function melFilterbank(numFilters, fftSize, sampleRate, lowFreq = 0, highFreq = null) {
  highFreq = highFreq ?? sampleRate / 2;

  const hzToMel = (hz) => 2595 * Math.log10(1 + hz / 700);
  const melToHz = (mel) => 700 * (Math.pow(10, mel / 2595) - 1);

  const lowMel = hzToMel(lowFreq);
  const highMel = hzToMel(highFreq);

  const melPoints = new Array(numFilters + 2);
  for (let i = 0; i < numFilters + 2; i++) {
    melPoints[i] = lowMel + (highMel - lowMel) * i / (numFilters + 1);
  }

  const hzPoints = melPoints.map(melToHz);
  const bins = hzPoints.map(hz => Math.floor((fftSize + 1) * hz / sampleRate));

  const filterbank = [];
  for (let i = 0; i < numFilters; i++) {
    const filter = new Array(Math.floor(fftSize / 2) + 1).fill(0);

    for (let j = bins[i]; j < bins[i + 1]; j++) {
      filter[j] = (j - bins[i]) / (bins[i + 1] - bins[i]);
    }
    for (let j = bins[i + 1]; j < bins[i + 2]; j++) {
      filter[j] = (bins[i + 2] - j) / (bins[i + 2] - bins[i + 1]);
    }

    filterbank.push(filter);
  }

  return filterbank;
}

// Apply mel filterbank to spectrum
export function applyMelFilterbank(spectrum, filterbank) {
  return filterbank.map(filter =>
    filter.reduce((sum, f, i) => sum + f * spectrum[i], 0)
  );
}

// Mel-frequency cepstral coefficients (MFCC)
export function mfcc(signal, sampleRate, numCoeffs = 13, numFilters = 26, windowSize = 512, hopSize = 256) {
  const { frames } = stft(signal, windowSize, hopSize);
  const filterbank = melFilterbank(numFilters, windowSize, sampleRate);

  return frames.map(frame => {
    const spectrum = powerSpectrum(frame.real, frame.imag).slice(0, windowSize / 2 + 1);
    const melEnergies = applyMelFilterbank(spectrum, filterbank);

    // Log energies
    const logEnergies = melEnergies.map(e => Math.log(Math.max(e, 1e-10)));

    // DCT (Type II)
    const dct = new Array(numCoeffs);
    for (let k = 0; k < numCoeffs; k++) {
      let sum = 0;
      for (let n = 0; n < numFilters; n++) {
        sum += logEnergies[n] * Math.cos(PI * k * (n + 0.5) / numFilters);
      }
      dct[k] = sum;
    }

    return dct;
  });
}

// ============================================================================
// SIGNAL GENERATION
// ============================================================================

// Generate sine wave
export function generateSine(frequency, sampleRate, duration, amplitude = 1) {
  const numSamples = Math.floor(sampleRate * duration);
  const signal = new Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    signal[i] = amplitude * Math.sin(TAU * frequency * i / sampleRate);
  }
  return signal;
}

// Generate cosine wave
export function generateCosine(frequency, sampleRate, duration, amplitude = 1) {
  const numSamples = Math.floor(sampleRate * duration);
  const signal = new Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    signal[i] = amplitude * Math.cos(TAU * frequency * i / sampleRate);
  }
  return signal;
}

// Generate square wave
export function generateSquare(frequency, sampleRate, duration, amplitude = 1) {
  const numSamples = Math.floor(sampleRate * duration);
  const signal = new Array(numSamples);
  const period = sampleRate / frequency;
  for (let i = 0; i < numSamples; i++) {
    signal[i] = ((i % period) < period / 2) ? amplitude : -amplitude;
  }
  return signal;
}

// Generate sawtooth wave
export function generateSawtooth(frequency, sampleRate, duration, amplitude = 1) {
  const numSamples = Math.floor(sampleRate * duration);
  const signal = new Array(numSamples);
  const period = sampleRate / frequency;
  for (let i = 0; i < numSamples; i++) {
    signal[i] = amplitude * (2 * ((i % period) / period) - 1);
  }
  return signal;
}

// Generate triangle wave
export function generateTriangle(frequency, sampleRate, duration, amplitude = 1) {
  const numSamples = Math.floor(sampleRate * duration);
  const signal = new Array(numSamples);
  const period = sampleRate / frequency;
  for (let i = 0; i < numSamples; i++) {
    const t = (i % period) / period;
    signal[i] = amplitude * (4 * Math.abs(t - 0.5) - 1);
  }
  return signal;
}

// Generate white noise
export function generateWhiteNoise(sampleRate, duration, amplitude = 1) {
  const numSamples = Math.floor(sampleRate * duration);
  const signal = new Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    signal[i] = amplitude * (random() * 2 - 1);
  }
  return signal;
}

// Generate chirp (frequency sweep)
export function generateChirp(startFreq, endFreq, sampleRate, duration, amplitude = 1) {
  const numSamples = Math.floor(sampleRate * duration);
  const signal = new Array(numSamples);
  const freqRate = (endFreq - startFreq) / duration;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const freq = startFreq + freqRate * t / 2;
    signal[i] = amplitude * Math.sin(TAU * freq * t);
  }
  return signal;
}

// ============================================================================
// HELPERS
// ============================================================================

function _reverseBits(x, bits) {
  let result = 0;
  for (let i = 0; i < bits; i++) {
    result = (result << 1) | (x & 1);
    x >>= 1;
  }
  return result;
}

function _nextPowerOf2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function _besselI0(x) {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 50; k++) {
    term *= (x / (2 * k)) * (x / (2 * k));
    sum += term;
    if (term < 1e-12) break;
  }
  return sum;
}

function _signalSamples(signal) {
  if (!signal || typeof signal.length !== 'number') {
    throw new TypeError('signal must be an array-like object');
  }
  return signal;
}

function _finiteSample(value, index, name) {
  const sample = Number(value);
  if (!Number.isFinite(sample)) {
    throw new RangeError(`${name}[${index}] must be finite`);
  }
  return sample;
}

function _positiveFinite(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return number;
}

function _positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return number;
}

function _nonnegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new RangeError(`${name} must be a nonnegative safe integer`);
  }
  return number;
}
