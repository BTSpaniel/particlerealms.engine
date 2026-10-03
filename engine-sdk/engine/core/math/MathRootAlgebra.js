// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const ROOT_ALGEBRA_GENERATOR_NAMES = ['i', 'j', 'k', 'l', 'm', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'];

function assertRootAlgebraN(n) {
  if (!Number.isInteger(n) || n < 1 || n > 30) {
    throw new RangeError('Root algebra dimension exponent n must be an integer from 1 to 30.');
  }
}

export function rootAlgebraMask(n) {
  assertRootAlgebraN(n);
  return (1 << n) - 1;
}

export function rootAlgebraDimension(n) {
  assertRootAlgebraN(n);
  return 1 << n;
}

export function rootAlgebraGeneratorName(index) {
  if (index >= 0 && index < ROOT_ALGEBRA_GENERATOR_NAMES.length) {
    return ROOT_ALGEBRA_GENERATOR_NAMES[index];
  }
  return `g${index}`;
}

export function rootAlgebraBasisName(mask, n = 4) {
  assertRootAlgebraN(n);
  const m = mask & rootAlgebraMask(n);
  if (m === 0) {
    return '1';
  }
  const parts = [];
  for (let bit = 0; bit < n; bit++) {
    if ((m & (1 << bit)) !== 0) {
      parts.push(rootAlgebraGeneratorName(bit));
    }
  }
  return parts.join('');
}

export function rootAlgebraFormatElement(element, n = 4) {
  const sign = element && element.sign < 0 ? '-' : '+';
  const mask = element && Number.isInteger(element.mask) ? element.mask : 0;
  const name = rootAlgebraBasisName(mask, n);
  if (name === '1') {
    return sign === '-' ? '-1' : '+1';
  }
  return `${sign}${name}`;
}

export function rootAlgebraSquare(n, basisMask) {
  assertRootAlgebraN(n);
  const mask = rootAlgebraMask(n);
  const a = basisMask & mask;
  const sign = (a & 1) === 0 ? 1 : -1;
  return { sign, mask: (a >>> 1) & mask };
}

function maskToGeneratorList(mask, n) {
  const out = [];
  for (let bit = 0; bit < n; bit++) {
    if ((mask & (1 << bit)) !== 0) {
      out.push(bit);
    }
  }
  return out;
}

function listToMask(list) {
  let mask = 0;
  for (let i = 0; i < list.length; i++) {
    mask |= 1 << list[i];
  }
  return mask;
}

export function rootAlgebraMultiply(n, leftMask, rightMask) {
  assertRootAlgebraN(n);
  const fullMask = rootAlgebraMask(n);
  let sign = 1;
  const list = maskToGeneratorList(leftMask & fullMask, n).concat(maskToGeneratorList(rightMask & fullMask, n));
  let changed = true;
  let guard = 0;
  while (changed && guard++ < n * n * 8 + 64) {
    changed = false;
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (a > b) {
        list[i] = b;
        list[i + 1] = a;
        sign = -sign;
        changed = true;
        break;
      }
      if (a === b) {
        if (a === 0) {
          sign = -sign;
          list.splice(i, 2);
        } else {
          list.splice(i, 2, a - 1);
        }
        changed = true;
        break;
      }
    }
  }
  if (guard >= n * n * 8 + 64) {
    throw new Error('Root algebra reduction did not converge.');
  }
  return { sign, mask: listToMask(list) & fullMask };
}

export function rootAlgebraTraceMultiply(n, leftMask, rightMask) {
  assertRootAlgebraN(n);
  const fullMask = rootAlgebraMask(n);
  let sign = 1;
  const list = maskToGeneratorList(leftMask & fullMask, n).concat(maskToGeneratorList(rightMask & fullMask, n));
  const steps = [{
    op: 'start',
    sign,
    list: list.slice(),
    text: `${rootAlgebraBasisName(leftMask, n)} × ${rootAlgebraBasisName(rightMask, n)}`,
  }];
  let changed = true;
  let guard = 0;
  while (changed && guard++ < n * n * 8 + 64) {
    changed = false;
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (a > b) {
        list[i] = b;
        list[i + 1] = a;
        sign = -sign;
        steps.push({
          op: 'swap',
          sign,
          list: list.slice(),
          text: `${rootAlgebraGeneratorName(a)}${rootAlgebraGeneratorName(b)} = -${rootAlgebraGeneratorName(b)}${rootAlgebraGeneratorName(a)}`,
        });
        changed = true;
        break;
      }
      if (a === b) {
        if (a === 0) {
          sign = -sign;
          list.splice(i, 2);
          steps.push({
            op: 'square-negative-one',
            sign,
            list: list.slice(),
            text: `${rootAlgebraGeneratorName(a)}² = -1`,
          });
        } else {
          list.splice(i, 2, a - 1);
          steps.push({
            op: 'square-root',
            sign,
            list: list.slice(),
            text: `${rootAlgebraGeneratorName(a)}² = ${rootAlgebraGeneratorName(a - 1)}`,
          });
        }
        changed = true;
        break;
      }
    }
  }
  if (guard >= n * n * 8 + 64) {
    throw new Error('Root algebra trace reduction did not converge.');
  }
  const result = { sign, mask: listToMask(list) & fullMask };
  steps.push({
    op: 'result',
    sign,
    list: list.slice(),
    text: rootAlgebraFormatElement(result, n),
  });
  return { leftMask: leftMask & fullMask, rightMask: rightMask & fullMask, result, steps };
}

export function rootAlgebraReverseMaskBits(mask, n) {
  assertRootAlgebraN(n);
  let out = 0;
  const m = mask & rootAlgebraMask(n);
  for (let bit = 0; bit < n; bit++) {
    if ((m & (1 << bit)) !== 0) {
      out |= 1 << (n - 1 - bit);
    }
  }
  return out >>> 0;
}

export function rootAlgebraEncodedMultiply(n, leftMask, rightMask, options = {}) {
  assertRootAlgebraN(n);
  const fullMask = rootAlgebraMask(n);
  const reverseOperand = options.reverseOperand || 'right';
  const signMode = options.signMode || 'carryParity';
  const a = leftMask & fullMask;
  const b = rightMask & fullMask;
  const encodedLeft = reverseOperand === 'left' || reverseOperand === 'both' ? rootAlgebraReverseMaskBits(a, n) : a;
  const encodedRight = reverseOperand === 'right' || reverseOperand === 'both' ? rootAlgebraReverseMaskBits(b, n) : b;
  const sum = encodedLeft + encodedRight;
  const productMask = sum & fullMask;
  const carryMask = sum >>> n;
  let internalCarries = 0;
  let carry = 0;
  const carryBits = [];
  for (let bit = 0; bit < n; bit++) {
    const bitSum = ((encodedLeft >>> bit) & 1) + ((encodedRight >>> bit) & 1) + carry;
    carry = bitSum >= 2 ? 1 : 0;
    carryBits.push(carry);
    if (carry) {
      internalCarries ^= 1;
    }
  }
  let sign = 1;
  if (signMode === 'carryOut') {
    sign = carryMask & 1 ? -1 : 1;
  } else if (signMode === 'lowBit') {
    sign = sum & 1 ? -1 : 1;
  } else if (signMode === 'droppedBit') {
    sign = a & 1 ? -1 : 1;
  } else {
    sign = internalCarries ? -1 : 1;
  }
  return { sign, mask: productMask, carryMask, encodedLeft, encodedRight, sum, carryBits, internalCarryParity: internalCarries };
}

export function rootAlgebraEncodedTrace(n, leftMask, rightMask, options = {}) {
  const result = rootAlgebraEncodedMultiply(n, leftMask, rightMask, options);
  return {
    ...result,
    n,
    leftMask: leftMask & rootAlgebraMask(n),
    rightMask: rightMask & rootAlgebraMask(n),
    reverseOperand: options.reverseOperand || 'right',
    signMode: options.signMode || 'carryParity',
  };
}

export function rootAlgebraGenerateTable(n, multiply = rootAlgebraMultiply) {
  assertRootAlgebraN(n);
  const dimension = rootAlgebraDimension(n);
  const rows = [];
  for (let a = 0; a < dimension; a++) {
    const row = [];
    for (let b = 0; b < dimension; b++) {
      row.push(multiply(n, a, b));
    }
    rows.push(row);
  }
  return rows;
}

function freezeRootAlgebraTerms(outputs) {
  return Object.freeze(outputs.map((terms) => Object.freeze(
    terms.map((term) => Object.freeze({ ...term })),
  )));
}

function rootAlgebraPlanSignature(outputs, square = false) {
  return outputs.map((terms, output) => {
    const body = terms.map((term) => {
      const coefficient = term.coefficient === 1 ? '+' : term.coefficient === -1 ? '-' : `${term.coefficient > 0 ? '+' : ''}${term.coefficient}*`;
      return square
        ? `${coefficient}${term.left}${term.right === term.left ? '²' : `:${term.right}`}`
        : `${coefficient}${term.left}:${term.right}`;
    }).join('').replace(/^\+/, '');
    return `${output}=${body || '0'}`;
  }).join('|');
}

/**
 * Compile the reducer into immutable bilinear and square execution plans.
 * Experimental encoders never enter this path: callers may require the exact
 * algebraic laws their optimized kernel depends on before code is generated.
 */
export function rootAlgebraCompileExecutionPlan(n, options = {}) {
  assertRootAlgebraN(n);
  if (n > 4) throw new RangeError('Root algebra execution plans are limited to n <= 4.');
  const dimension = rootAlgebraDimension(n);
  const multiply = options.multiply || rootAlgebraMultiply;
  const outputs = Array.from({ length: dimension }, () => []);
  for (let left = 0; left < dimension; left++) {
    for (let right = 0; right < dimension; right++) {
      const product = multiply(n, left, right);
      if (!product || !Number.isInteger(product.mask) || ![-1, 1].includes(product.sign) || product.mask < 0 || product.mask >= dimension) {
        throw new Error(`Root algebra product ${left} × ${right} is not a closed signed basis element.`);
      }
      outputs[product.mask].push({ left, right, coefficient: product.sign });
    }
  }
  const squareMaps = Array.from({ length: dimension }, () => new Map());
  for (let output = 0; output < dimension; output++) {
    for (const term of outputs[output]) {
      const left = Math.min(term.left, term.right); const right = Math.max(term.left, term.right); const key = `${left}:${right}`;
      const entry = squareMaps[output].get(key) || { left, right, coefficient: 0 };
      entry.coefficient += term.coefficient; squareMaps[output].set(key, entry);
    }
  }
  const squareOutputs = squareMaps.map((terms) => [...terms.values()].filter((term) => term.coefficient !== 0));
  const laws = rootAlgebraPropertyReport(n, { multiply, zeroDivisorLimit: 1 });
  const requirements = Object.freeze({
    associative: options.requireAssociative === true,
    commutative: options.requireCommutative === true,
    alternative: options.requireAlternative === true,
    squareRuleConsistent: options.requireSquareRule !== false,
  });
  const failures = Object.freeze(Object.entries(requirements).filter(([law, required]) => required && !laws[law]).map(([law]) => law));
  const plan = {
    schema: 'particle-realms.root-algebra.execution-plan', version: 1, n, dimension,
    outputs: freezeRootAlgebraTerms(outputs), squareOutputs: freezeRootAlgebraTerms(squareOutputs),
    requirements, accepted: failures.length === 0, failures,
    laws: Object.freeze({ closed: laws.closed, commutative: laws.commutative, associative: laws.associative, alternative: laws.alternative, squareRuleConsistent: laws.squareRuleConsistent }),
  };
  plan.productSignature = rootAlgebraPlanSignature(plan.outputs);
  plan.squareSignature = rootAlgebraPlanSignature(plan.squareOutputs, true);
  if (!plan.accepted && options.allowInvalid !== true) throw new Error(`Root algebra execution plan rejected: ${failures.join(', ')}`);
  return Object.freeze(plan);
}

export function rootAlgebraEvaluateExecutionPlan(plan, left, right = null) {
  if (!plan?.accepted || !Array.isArray(plan.outputs) || !Array.isArray(plan.squareOutputs)) throw new TypeError('A validated root algebra execution plan is required.');
  const leftValues = Array.from(left || [], Number); const square = right == null; const rightValues = square ? leftValues : Array.from(right || [], Number);
  if (leftValues.length !== plan.dimension || rightValues.length !== plan.dimension || !leftValues.every(Number.isFinite) || !rightValues.every(Number.isFinite)) throw new TypeError(`Execution plan operands must contain ${plan.dimension} finite components.`);
  return (square ? plan.squareOutputs : plan.outputs).map((terms) => terms.reduce((sum, term) => sum + term.coefficient * leftValues[term.left] * rightValues[term.right], 0));
}

function wgslCombineTerms(terms, expression, addFunction) {
  if (!terms.length) return '0.';
  const values = terms.map((term) => {
    const magnitude = Math.abs(term.coefficient); let value = expression(term);
    if (magnitude !== 1) value = `(${value}*${magnitude}.)`;
    return term.coefficient < 0 ? `-${value}` : value;
  });
  if (!addFunction) return values.join('+').replace(/\+\-/g, '-');
  return values.slice(1).reduce((sum, value) => `${addFunction}(${sum},${value})`, values[0]);
}

/** Generate a branch-free WGSL product or square directly from a validated plan. */
export function rootAlgebraExecutionPlanWGSL(plan, options = {}) {
  if (!plan?.accepted) throw new TypeError('Cannot generate WGSL from a rejected root algebra plan.');
  if (plan.dimension < 2 || plan.dimension > 4) throw new RangeError('WGSL algebra plans require 2 to 4 components.');
  const square = options.square === true;
  const components = options.components || ['x', 'y', 'z', 'w'].slice(0, plan.dimension);
  if (!Array.isArray(components) || components.length !== plan.dimension || components.some((item) => !/^[A-Za-z_]\w*$/.test(item))) throw new TypeError('WGSL component names must match the execution-plan dimension.');
  const functionName = options.functionName || (square ? 'rootSquare' : 'rootProduct');
  const inputType = options.inputType || `vec${plan.dimension}<f32>`;
  const outputType = options.outputType || inputType;
  const constructor = typeof options.constructor === 'string' && options.constructor ? options.constructor : outputType;
  const multiplyFunction = options.multiplyFunction || '';
  const addFunction = options.addFunction || '';
  const operands = square ? `a:${inputType}` : `a:${inputType},b:${inputType}`;
  const source = square ? plan.squareOutputs : plan.outputs;
  const fields = source.map((terms) => wgslCombineTerms(terms, (term) => {
    const left = `a.${components[term.left]}`; const right = `${square ? 'a' : 'b'}.${components[term.right]}`;
    return multiplyFunction ? `${multiplyFunction}(${left},${right})` : `(${left}*${right})`;
  }, addFunction));
  return `fn ${functionName}(${operands})->${outputType}{return ${constructor}(${fields.join(',')});}`;
}

export function rootAlgebraValidate(n, options = {}) {
  assertRootAlgebraN(n);
  const dimension = rootAlgebraDimension(n);
  const encodedOptions = options.encodedOptions || {};
  const result = {
    n,
    dimension,
    squareMismatches: 0,
    antiCommutingGeneratorPairs: 0,
    antiCommutingFailures: 0,
    encodedMismatches: 0,
  };
  for (let a = 0; a < dimension; a++) {
    const sq = rootAlgebraSquare(n, a);
    const mul = rootAlgebraMultiply(n, a, a);
    if (sq.sign !== mul.sign || sq.mask !== mul.mask) {
      result.squareMismatches++;
    }
    const enc = rootAlgebraEncodedMultiply(n, a, a, encodedOptions);
    if (sq.sign !== enc.sign || sq.mask !== enc.mask) {
      result.encodedMismatches++;
    }
  }
  for (let ia = 0; ia < n; ia++) {
    for (let ib = ia + 1; ib < n; ib++) {
      const a = 1 << ia;
      const b = 1 << ib;
      const ab = rootAlgebraMultiply(n, a, b);
      const ba = rootAlgebraMultiply(n, b, a);
      result.antiCommutingGeneratorPairs++;
      if (ab.mask !== ba.mask || ab.sign !== -ba.sign) {
        result.antiCommutingFailures++;
      }
    }
  }
  result.ok = result.squareMismatches === 0 && result.antiCommutingFailures === 0;
  return result;
}

function sameRootElement(a, b) {
  return a.sign === b.sign && a.mask === b.mask;
}

export function rootAlgebraPropertyReport(n, options = {}) {
  assertRootAlgebraN(n);
  const dimension = rootAlgebraDimension(n);
  const multiply = options.multiply || rootAlgebraMultiply;
  const report = {
    n,
    dimension,
    closed: true,
    commutativeFailures: 0,
    associativityFailures: 0,
    leftAlternativeFailures: 0,
    rightAlternativeFailures: 0,
    squareRuleFailures: 0,
    firstCommutativeFailure: null,
    firstAssociativityFailure: null,
    firstLeftAlternativeFailure: null,
    firstRightAlternativeFailure: null,
    firstSquareRuleFailure: null,
    simpleZeroDivisors: [],
  };
  for (let a = 0; a < dimension; a++) {
    const sq = rootAlgebraSquare(n, a);
    const aa = multiply(n, a, a);
    if (!sameRootElement(sq, aa)) {
      report.squareRuleFailures++;
      if (!report.firstSquareRuleFailure) {
        report.firstSquareRuleFailure = { a, square: sq, multiply: aa };
      }
    }
    for (let b = 0; b < dimension; b++) {
      const ab = multiply(n, a, b);
      const ba = multiply(n, b, a);
      if (ab.mask !== ba.mask || ab.sign !== ba.sign) {
        report.commutativeFailures++;
        if (!report.firstCommutativeFailure) {
          report.firstCommutativeFailure = { a, b, ab, ba };
        }
      }
      const aabLeft = multiply(n, aa.mask, b);
      aabLeft.sign *= aa.sign;
      const abRight = multiply(n, a, ab.mask);
      abRight.sign *= ab.sign;
      if (!sameRootElement(aabLeft, abRight)) {
        report.leftAlternativeFailures++;
        if (!report.firstLeftAlternativeFailure) {
          report.firstLeftAlternativeFailure = { a, b, left: aabLeft, right: abRight };
        }
      }
      const bb = multiply(n, b, b);
      const abbLeft = multiply(n, ab.mask, b);
      abbLeft.sign *= ab.sign;
      const abbRight = multiply(n, a, bb.mask);
      abbRight.sign *= bb.sign;
      if (!sameRootElement(abbLeft, abbRight)) {
        report.rightAlternativeFailures++;
        if (!report.firstRightAlternativeFailure) {
          report.firstRightAlternativeFailure = { a, b, left: abbLeft, right: abbRight };
        }
      }
      for (let c = 0; c < dimension; c++) {
        const bc = multiply(n, b, c);
        const left = multiply(n, ab.mask, c);
        left.sign *= ab.sign;
        const right = multiply(n, a, bc.mask);
        right.sign *= bc.sign;
        if (!sameRootElement(left, right)) {
          report.associativityFailures++;
          if (!report.firstAssociativityFailure) {
            report.firstAssociativityFailure = { a, b, c, left, right };
          }
        }
      }
    }
  }
  report.commutative = report.commutativeFailures === 0;
  report.associative = report.associativityFailures === 0;
  report.alternative = report.leftAlternativeFailures === 0 && report.rightAlternativeFailures === 0;
  report.squareRuleConsistent = report.squareRuleFailures === 0;
  report.simpleZeroDivisors = rootAlgebraFindSimpleZeroDivisors(n, { limit: options.zeroDivisorLimit || 6 });
  return report;
}

function addSparseTerm(out, mask, coeff) {
  if (coeff === 0) {
    return;
  }
  out.set(mask, (out.get(mask) || 0) + coeff);
  if (out.get(mask) === 0) {
    out.delete(mask);
  }
}

function multiplySparseRootElements(n, left, right) {
  const out = new Map();
  for (const [aMask, aCoeff] of left.entries()) {
    for (const [bMask, bCoeff] of right.entries()) {
      const product = rootAlgebraMultiply(n, aMask, bMask);
      addSparseTerm(out, product.mask, aCoeff * bCoeff * product.sign);
    }
  }
  return out;
}

function sparseElementText(element, n) {
  if (element.size === 0) {
    return '0';
  }
  const parts = [];
  for (const [mask, coeff] of element.entries()) {
    const basis = rootAlgebraBasisName(mask, n);
    const sign = coeff < 0 ? '-' : '+';
    const mag = Math.abs(coeff);
    parts.push(`${sign}${mag === 1 ? '' : mag}${basis === '1' ? '' : basis}`);
  }
  return parts.join(' ').replace(/^\+/, '');
}

export function rootAlgebraFindSimpleZeroDivisors(n, options = {}) {
  assertRootAlgebraN(n);
  const dimension = rootAlgebraDimension(n);
  const limit = Math.max(0, options.limit || 6);
  const candidates = [];
  for (let a = 0; a < dimension; a++) {
    for (let b = a + 1; b < dimension; b++) {
      for (const s of [-1, 1]) {
        const element = new Map();
        addSparseTerm(element, a, 1);
        addSparseTerm(element, b, s);
        candidates.push(element);
      }
    }
  }
  const found = [];
  for (let i = 0; i < candidates.length && found.length < limit; i++) {
    for (let j = i; j < candidates.length && found.length < limit; j++) {
      const product = multiplySparseRootElements(n, candidates[i], candidates[j]);
      if (product.size === 0) {
        found.push({
          left: sparseElementText(candidates[i], n),
          right: sparseElementText(candidates[j], n),
          product: '0',
        });
      }
    }
  }
  return found;
}

export function rootAlgebraSearchEncodedMultipliers(n, options = {}) {
  assertRootAlgebraN(n);
  if (n > 5) {
    throw new RangeError('Root algebra encoded multiplier search is limited to n <= 5.');
  }
  const reverseOperands = options.reverseOperands || ['right', 'left', 'both', 'none'];
  const signModes = options.signModes || ['carryParity', 'carryOut', 'lowBit', 'droppedBit'];
  const dimension = rootAlgebraDimension(n);
  const results = [];
  for (const reverseOperand of reverseOperands) {
    for (const signMode of signModes) {
      let tableMismatches = 0;
      let squareMismatches = 0;
      let firstMismatch = null;
      for (let a = 0; a < dimension; a++) {
        const sq = rootAlgebraSquare(n, a);
        const encSq = rootAlgebraEncodedMultiply(n, a, a, { reverseOperand, signMode });
        if (!sameRootElement(sq, encSq)) {
          squareMismatches++;
        }
        for (let b = 0; b < dimension; b++) {
          const ref = rootAlgebraMultiply(n, a, b);
          const enc = rootAlgebraEncodedMultiply(n, a, b, { reverseOperand, signMode });
          if (!sameRootElement(ref, enc)) {
            tableMismatches++;
            if (!firstMismatch) {
              firstMismatch = { a, b, ref, enc };
            }
          }
        }
      }
      results.push({ reverseOperand, signMode, tableMismatches, squareMismatches, firstMismatch });
    }
  }
  results.sort((a, b) => a.tableMismatches - b.tableMismatches || a.squareMismatches - b.squareMismatches);
  return results;
}
