// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { canonicalize } from '../../../state/util/canonical.js';
import { deepFreeze, normalizeCapsuleBody, validateRealmCapsuleShape } from './RealmCapsuleSchema.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,255}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function assertContract(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) throw new TypeError('Capsule migration contract must be an object');
  const allowed = ['id', 'from', 'to', 'preview', 'apply', 'rollback', 'reversible'];
  for (const key of Object.keys(contract)) if (!allowed.includes(key)) throw new TypeError(`Capsule migration contract has unknown field ${key}`);
  if (typeof contract.id !== 'string' || !ID.test(contract.id)) throw new TypeError('Capsule migration id is invalid');
  if (typeof contract.from !== 'string' || !VERSION.test(contract.from)) throw new TypeError('Capsule migration from version is invalid');
  if (typeof contract.to !== 'string' || !VERSION.test(contract.to) || contract.to === contract.from) throw new TypeError('Capsule migration to version is invalid');
  if (contract.reversible !== true) throw new TypeError('Capsule migrations must explicitly declare reversible: true');
  for (const method of ['preview', 'apply', 'rollback']) {
    if (typeof contract[method] !== 'function') throw new TypeError(`Capsule migration requires ${method}()`);
  }
}

function capsuleBody(capsule) {
  const body = validateRealmCapsuleShape(capsule, { requireSignature: false });
  return normalizeCapsuleBody(body);
}

export class CapsuleMigrationRegistry {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this._contracts = new Map();
  }

  register(contract) {
    assertContract(contract);
    if (this._contracts.has(contract.id)) throw new Error(`Capsule migration ${contract.id} is already registered`);
    for (const existing of this._contracts.values()) {
      if (existing.from === contract.from && existing.to === contract.to) {
        throw new Error(`Capsule migration path ${contract.from} -> ${contract.to} is ambiguous`);
      }
    }
    this._contracts.set(contract.id, Object.freeze({ ...contract }));
    return () => this._contracts.delete(contract.id);
  }

  contracts() {
    return [...this._contracts.values()].map(contract => Object.freeze({
      id: contract.id,
      from: contract.from,
      to: contract.to,
      reversible: true,
    }));
  }

  _path(from, to) {
    if (from === to) return [];
    const queue = [{ version: from, steps: [] }];
    const visited = new Set([from]);
    while (queue.length) {
      const current = queue.shift();
      const outgoing = [...this._contracts.values()]
        .filter(contract => contract.from === current.version)
        .sort((a, b) => a.id.localeCompare(b.id));
      for (const contract of outgoing) {
        const steps = [...current.steps, contract];
        if (contract.to === to) return steps;
        if (!visited.has(contract.to)) {
          visited.add(contract.to);
          queue.push({ version: contract.to, steps });
        }
      }
    }
    throw new Error(`No reversible Capsule migration path from ${from} to ${to}`);
  }

  async preview(capsule, targetVersion, context = {}) {
    const original = capsuleBody(capsule);
    if (typeof targetVersion !== 'string' || !VERSION.test(targetVersion)) throw new TypeError('Target Capsule schema version is invalid');
    const contracts = this._path(original.compatibility.realmSchema, targetVersion);
    let draft = clone(original);
    const steps = [];
    for (const contract of contracts) {
      const before = canonicalize(draft);
      const summary = await contract.preview(clone(draft), Object.freeze({ ...context, direction: 'forward' }));
      if (canonicalize(draft) !== before) throw new Error(`Capsule migration ${contract.id} preview mutated its input`);
      const next = await contract.apply(clone(draft), Object.freeze({ ...context, dryRun: true }));
      draft = normalizeCapsuleBody(next);
      if (draft.compatibility.realmSchema !== contract.to) throw new Error(`Capsule migration ${contract.id} did not produce schema ${contract.to}`);
      steps.push({ id: contract.id, from: contract.from, to: contract.to, summary: clone(summary ?? null) });
    }
    return deepFreeze({
      format: 'realm-capsule-migration-plan-v1',
      sourceRoot: capsule.capsuleRoot ?? null,
      sourceVersion: original.compatibility.realmSchema,
      targetVersion,
      steps,
    });
  }

  async apply(capsule, plan, context = {}) {
    if (!plan || plan.format !== 'realm-capsule-migration-plan-v1' || !Array.isArray(plan.steps)) throw new TypeError('Invalid Capsule migration plan');
    if ((capsule.capsuleRoot ?? null) !== plan.sourceRoot) throw new Error('Capsule migration plan is bound to a different source root');
    const original = capsuleBody(capsule);
    if (original.compatibility.realmSchema !== plan.sourceVersion) throw new Error('Capsule migration source version changed after preview');
    let draft = clone(original);
    const applied = [];
    for (const planned of plan.steps) {
      const contract = this._contracts.get(planned.id);
      if (!contract || contract.from !== planned.from || contract.to !== planned.to) throw new Error(`Capsule migration contract ${planned.id} changed after preview`);
      if (draft.compatibility.realmSchema !== contract.from) throw new Error(`Capsule migration ${contract.id} received schema ${draft.compatibility.realmSchema}`);
      draft = normalizeCapsuleBody(await contract.apply(clone(draft), Object.freeze({ ...context, dryRun: false })));
      if (draft.compatibility.realmSchema !== contract.to) throw new Error(`Capsule migration ${contract.id} did not produce schema ${contract.to}`);
      applied.push(contract.id);
      this.logger.debug?.('[CapsuleMigration] applied', { id: contract.id, from: contract.from, to: contract.to });
    }
    if (draft.compatibility.realmSchema !== plan.targetVersion) throw new Error('Capsule migration did not reach the planned target version');
    return Object.freeze({
      draft: deepFreeze(draft),
      rollbackReceipt: deepFreeze({
        format: 'realm-capsule-migration-rollback-v1',
        sourceRoot: plan.sourceRoot,
        originalBody: original,
        applied,
      }),
    });
  }

  async rollback(currentDraft, receipt, context = {}) {
    if (!receipt || receipt.format !== 'realm-capsule-migration-rollback-v1' || !Array.isArray(receipt.applied)) {
      throw new TypeError('Invalid Capsule migration rollback receipt');
    }
    let draft = normalizeCapsuleBody(clone(currentDraft));
    for (const id of [...receipt.applied].reverse()) {
      const contract = this._contracts.get(id);
      if (!contract) throw new Error(`Capsule migration contract ${id} is unavailable for rollback`);
      if (draft.compatibility.realmSchema !== contract.to) throw new Error(`Capsule migration ${id} rollback received schema ${draft.compatibility.realmSchema}`);
      draft = normalizeCapsuleBody(await contract.rollback(clone(draft), Object.freeze({ ...context, direction: 'rollback' })));
      if (draft.compatibility.realmSchema !== contract.from) throw new Error(`Capsule migration ${id} rollback did not restore schema ${contract.from}`);
      this.logger.debug?.('[CapsuleMigration] rolled back', { id, from: contract.to, to: contract.from });
    }
    const original = normalizeCapsuleBody(receipt.originalBody);
    if (canonicalize(draft) !== canonicalize(original)) throw new Error('Capsule migration rollback did not restore the exact source body');
    return deepFreeze(draft);
  }
}
