// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Safe evaluator for offline-trained JHC adaptive-codec policies. */
const FEATURES = new Set([
  'log2_bytes', 'ascii_ratio', 'whitespace_ratio', 'identifier_ratio',
  'unique_byte_ratio', 'repeated_quad_ratio',
]);

export function codecFeatures(content) {
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content ?? 0);
  const size = bytes.length;
  if (!size) return Object.fromEntries([...FEATURES].map(name => [name, 0]));
  let ascii = 0, whitespace = 0, identifiers = 0;
  const unique = new Set();
  const quads = new Set();
  for (let i = 0; i < size; i++) {
    const byte = bytes[i];
    if (byte < 128) ascii++;
    if (byte === 32 || byte === 9 || byte === 10 || byte === 13) whitespace++;
    if ((byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) ||
        (byte >= 97 && byte <= 122) || byte === 36 || byte === 95) identifiers++;
    unique.add(byte);
    if (i + 3 < size) quads.add(`${byte},${bytes[i + 1]},${bytes[i + 2]},${bytes[i + 3]}`);
  }
  const quadCount = Math.max(0, size - 3);
  return {
    log2_bytes: Math.log2(size + 1),
    ascii_ratio: ascii / size,
    whitespace_ratio: whitespace / size,
    identifier_ratio: identifiers / size,
    unique_byte_ratio: unique.size / Math.min(size, 256),
    repeated_quad_ratio: quadCount ? 1 - quads.size / quadCount : 0,
  };
}

export function shouldTryTokenCodec(policy, content) {
  if (!policy) return true;
  if (policy.schema !== 'jhc-adaptive-policy-v1' || policy.safety?.neverExpand !== true) return true;
  const values = codecFeatures(content);
  let node = policy.model;
  for (let depth = 0; depth < 16; depth++) {
    if (!node || typeof node !== 'object') return true;
    if (node.leaf === true) return node.tryToken === true;
    if (!FEATURES.has(node.feature) || !Number.isFinite(node.threshold)) return true;
    node = values[node.feature] <= node.threshold ? node.left : node.right;
  }
  return true;
}
