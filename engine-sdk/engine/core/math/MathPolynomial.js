// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathPolynomial.js - Polynomial root solvers and evaluation
// Consolidates: AIAiming.js inline quadratic, SpeculativeContacts.js quadratic CCD
// Standard in game math libraries for intersection tests, predictive aim, CCD

import { EPSILON } from './MathConstants.js';

// ============================================================================
// EVALUATION
// ============================================================================

/** Evaluate polynomial using Horner's method: coeffs[0]*x^n + coeffs[1]*x^(n-1) + ... + coeffs[n] */
export function polyEval(coeffs, x) {
  let result = coeffs[0];
  for (let i = 1; i < coeffs.length; i++) {
    result = result * x + coeffs[i];
  }
  return result;
}

/** Derivative coefficients: returns new array of degree n-1 */
export function polyDerivative(coeffs) {
  const n = coeffs.length - 1;
  if (n <= 0) return [0];
  const d = new Array(n);
  for (let i = 0; i < n; i++) {
    d[i] = coeffs[i] * (n - i);
  }
  return d;
}

/** Evaluate polynomial and its derivative simultaneously (Horner's) */
export function polyEvalWithDerivative(coeffs, x) {
  const n = coeffs.length - 1;
  let val = coeffs[0];
  let deriv = 0;
  for (let i = 1; i <= n; i++) {
    deriv = deriv * x + val;
    val = val * x + coeffs[i];
  }
  return { value: val, derivative: deriv };
}

// ============================================================================
// LINEAR: ax + b = 0
// ============================================================================

export function solveLinear(a, b) {
  if (Math.abs(a) < EPSILON) return [];
  return [-b / a];
}

// ============================================================================
// QUADRATIC: ax² + bx + c = 0
// Numerically stable formulation (avoids catastrophic cancellation)
// ============================================================================

export function solveQuadratic(a, b, c) {
  if (Math.abs(a) < EPSILON) return solveLinear(b, c);

  const disc = b * b - 4 * a * c;
  if (disc < -EPSILON) return [];
  if (disc < EPSILON) return [-b / (2 * a)];

  // Stable form: avoid subtracting nearly-equal numbers
  const sqrtDisc = Math.sqrt(disc);
  const q = -0.5 * (b + Math.sign(b) * sqrtDisc);

  // Handle b ≈ 0 edge case
  if (Math.abs(b) < EPSILON) {
    const r = sqrtDisc / (2 * a);
    return [-r, r].sort((x, y) => x - y);
  }

  const r1 = q / a;
  const r2 = c / q;
  return r1 < r2 ? [r1, r2] : [r2, r1];
}

/** Smallest positive root of quadratic, or null */
export function solveQuadraticPositive(a, b, c) {
  const roots = solveQuadratic(a, b, c);
  for (let i = 0; i < roots.length; i++) {
    if (roots[i] > EPSILON) return roots[i];
  }
  return null;
}

// ============================================================================
// CUBIC: ax³ + bx² + cx + d = 0 (Cardano's method)
// ============================================================================

export function solveCubic(a, b, c, d) {
  if (Math.abs(a) < EPSILON) return solveQuadratic(b, c, d);

  // Normalize to x³ + px² + qx + r = 0
  const p = b / a, q = c / a, r = d / a;

  // Depressed cubic: t³ + pt + q = 0 where x = t - p/3
  const p3 = p / 3;
  const Q = (3 * q - p * p) / 9;
  const R = (9 * p * q - 27 * r - 2 * p * p * p) / 54;
  const D = Q * Q * Q + R * R;

  const roots = [];

  if (D > EPSILON) {
    // One real root
    const sqrtD = Math.sqrt(D);
    const S = Math.cbrt(R + sqrtD);
    const T = Math.cbrt(R - sqrtD);
    roots.push(S + T - p3);
  } else if (D > -EPSILON) {
    // All real, at least two equal
    if (Math.abs(R) < EPSILON) {
      roots.push(-p3);
    } else {
      const S = Math.cbrt(R);
      roots.push(2 * S - p3);
      roots.push(-S - p3);
    }
  } else {
    // Three distinct real roots (casus irreducibilis)
    const theta = Math.acos(R / Math.sqrt(-Q * Q * Q));
    const twoSqrtNegQ = 2 * Math.sqrt(-Q);
    roots.push(twoSqrtNegQ * Math.cos(theta / 3) - p3);
    roots.push(twoSqrtNegQ * Math.cos((theta + 2 * Math.PI) / 3) - p3);
    roots.push(twoSqrtNegQ * Math.cos((theta + 4 * Math.PI) / 3) - p3);
  }

  return roots.sort((x, y) => x - y);
}

// ============================================================================
// QUARTIC: ax⁴ + bx³ + cx² + dx + e = 0 (Ferrari's method)
// ============================================================================

export function solveQuartic(a, b, c, d, e) {
  if (Math.abs(a) < EPSILON) return solveCubic(b, c, d, e);

  // Normalize to x⁴ + px³ + qx² + rx + s = 0
  const p = b / a, q = c / a, r = d / a, s = e / a;

  // Depressed quartic via x = t - p/4
  const p4 = p / 4;
  const p2 = p * p;
  const q1 = q - 3 * p2 / 8;
  const r1 = r + p2 * p / 8 - p * q / 2;
  const s1 = s - 3 * p2 * p2 / 256 + p2 * q / 16 - p * r / 4;

  if (Math.abs(r1) < EPSILON) {
    // Biquadratic: t⁴ + q1*t² + s1 = 0
    const quadRoots = solveQuadratic(1, q1, s1);
    const roots = [];
    for (const u of quadRoots) {
      if (u >= 0) {
        const su = Math.sqrt(u);
        roots.push(su - p4);
        roots.push(-su - p4);
      } else if (u > -EPSILON) {
        roots.push(-p4);
      }
    }
    return roots.sort((x, y) => x - y);
  }

  // Resolvent cubic: y³ + (q1/2)y² + ((q1²-4s1)/16)y - r1²/64 = 0
  const cubicRoots = solveCubic(1, q1 / 2, (q1 * q1 - 4 * s1) / 16, -r1 * r1 / 64);

  // Find a positive root of the resolvent cubic
  let y = 0;
  for (const cr of cubicRoots) {
    if (cr > EPSILON) { y = cr; break; }
  }
  if (y <= EPSILON && cubicRoots.length > 0) y = cubicRoots[cubicRoots.length - 1];

  const sqrtY = Math.sqrt(Math.max(0, y));
  if (sqrtY < EPSILON) {
    // Fallback to biquadratic
    return solveQuadratic(1, q1, s1).flatMap(u => {
      if (u >= 0) { const su = Math.sqrt(u); return [su - p4, -su - p4]; }
      return [];
    }).sort((x, y) => x - y);
  }

  const alpha = q1 / 2 + y;
  const beta = sqrtY;
  const gamma = r1 / (2 * sqrtY);

  const roots = [];
  const r1a = solveQuadratic(1, beta, alpha / 2 - gamma);
  const r1b = solveQuadratic(1, -beta, alpha / 2 + gamma);
  for (const root of r1a) roots.push(root - p4);
  for (const root of r1b) roots.push(root - p4);

  return roots.sort((x, y) => x - y);
}

// ============================================================================
// NEWTON-RAPHSON ROOT REFINEMENT
// ============================================================================

export function polyNewtonRoot(coeffs, guess, maxIter = 20, tolerance = EPSILON) {
  let x = guess;
  for (let i = 0; i < maxIter; i++) {
    const { value, derivative } = polyEvalWithDerivative(coeffs, x);
    if (Math.abs(derivative) < EPSILON) break;
    const dx = value / derivative;
    x -= dx;
    if (Math.abs(dx) < tolerance) break;
  }
  return x;
}

// ============================================================================
// GENERAL REAL ROOTS (Companion matrix eigenvalue method is impractical in JS;
// use Sturm chain + bisection for robustness)
// ============================================================================

/** Count sign changes in array (for Sturm's theorem) */
function signChanges(arr) {
  let count = 0, prev = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === 0) continue;
    if (prev !== 0 && arr[i] * prev < 0) count++;
    prev = arr[i];
  }
  return count;
}

/** Build Sturm chain for polynomial */
function sturmChain(coeffs) {
  // Remove trailing zeros
  while (coeffs.length > 1 && Math.abs(coeffs[coeffs.length - 1]) < EPSILON) coeffs.pop();
  if (coeffs.length <= 1) return [coeffs];

  const chain = [coeffs, polyDerivative(coeffs)];
  for (let i = 0; i < 100; i++) {
    const a = chain[chain.length - 2];
    const b = chain[chain.length - 1];
    if (b.length <= 1) break;

    // Polynomial long division remainder (negated)
    const rem = polyRemainder(a, b);
    if (rem.every(c => Math.abs(c) < EPSILON)) break;
    chain.push(rem.map(c => -c));
  }
  return chain;
}

/** Polynomial remainder: remainder of a / b */
function polyRemainder(a, b) {
  if (b.length === 0 || (b.length === 1 && Math.abs(b[0]) < EPSILON)) return [...a];
  const r = [...a];
  const bLen = b.length;
  const bLead = b[0];
  while (r.length >= bLen && Math.abs(r[0]) > EPSILON) {
    const factor = r[0] / bLead;
    for (let i = 0; i < bLen; i++) {
      r[i] -= factor * b[i];
    }
    r.shift();
  }
  return r.length > 0 ? r : [0];
}

/** Count real roots in interval (a, b] using Sturm's theorem */
function sturmCount(chain, a, b) {
  const evalChain = (x) => chain.map(p => polyEval(p, x));
  return signChanges(evalChain(a)) - signChanges(evalChain(b));
}

/**
 * Find all real roots of an arbitrary polynomial using Sturm chain + bisection
 * @param {number[]} coeffs - Polynomial coefficients [a_n, a_{n-1}, ..., a_1, a_0]
 * @param {number} lo - Lower bound for root search (default: -1000)
 * @param {number} hi - Upper bound for root search (default: 1000)
 * @param {number} tolerance - Root accuracy (default: EPSILON)
 * @returns {number[]} Sorted array of real roots
 */
export function polyRealRoots(coeffs, lo = -1000, hi = 1000, tolerance = 1e-10) {
  if (coeffs.length <= 1) return [];
  if (coeffs.length === 2) return solveLinear(coeffs[0], coeffs[1]);
  if (coeffs.length === 3) return solveQuadratic(coeffs[0], coeffs[1], coeffs[2]);
  if (coeffs.length === 4) return solveCubic(coeffs[0], coeffs[1], coeffs[2], coeffs[3]);
  if (coeffs.length === 5) return solveQuartic(coeffs[0], coeffs[1], coeffs[2], coeffs[3], coeffs[4]);

  const chain = sturmChain([...coeffs]);
  const totalRoots = sturmCount(chain, lo, hi);
  if (totalRoots === 0) return [];

  const roots = [];

  function bisect(a, b, n) {
    if (n <= 0) return;
    if (b - a < tolerance) {
      roots.push((a + b) / 2);
      return;
    }
    const mid = (a + b) / 2;
    const leftCount = sturmCount(chain, a, mid);
    const rightCount = sturmCount(chain, mid, b);
    if (leftCount > 0) bisect(a, mid, leftCount);
    if (rightCount > 0) bisect(mid, b, rightCount);
  }

  bisect(lo, hi, totalRoots);
  // Refine with Newton-Raphson
  return roots.map(r => polyNewtonRoot(coeffs, r)).sort((a, b) => a - b);
}
