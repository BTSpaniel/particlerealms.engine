// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/facts/Fact.js — canonical facts + tombstones.
//
// Layer law: facts are MONOTONIC. We prefer adding facts, never deleting them.
// "Deletion" is a tombstone fact `revoked(<fact>)`; projection later decides
// what is currently valid. A fact is just a canonical string predicate so that
// {A,B} and {B,A} hash identically (see util/hashing.canonicalSetHash).

const TOMB_PREFIX = 'revoked(';

function canonicalArg(a) {
  if (typeof a === 'number') return Number.isFinite(a) ? String(a) : 'NaN';
  if (typeof a === 'string') return a;
  if (a === null || a === undefined) return 'nil';
  if (typeof a === 'boolean') return a ? 'true' : 'false';
  try { return JSON.stringify(a); } catch { return String(a); }
}

/** Build a canonical fact string: fact('hasKey','player','red') → "hasKey(player,red)". */
export function fact(predicate, ...args) {
  if (args.length === 0) return String(predicate);
  return `${predicate}(${args.map(canonicalArg).join(',')})`;
}

/** Wrap a fact as a tombstone (the monotonic stand-in for deletion). */
export function revoke(f) { return `${TOMB_PREFIX}${f})`; }

/** Is this fact a tombstone? */
export function isTombstone(f) {
  return typeof f === 'string' && f.startsWith(TOMB_PREFIX) && f.endsWith(')');
}

/** The fact a tombstone revokes, or null. */
export function tombstoneTarget(f) {
  return isTombstone(f) ? f.slice(TOMB_PREFIX.length, -1) : null;
}
