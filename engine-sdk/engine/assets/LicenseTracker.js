// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/LicenseTracker.js — license metadata + import gate (spec §21).
//
// License metadata is mandatory before import. Marketplace assets are licensed,
// not sold, and portability varies. The hard rules: only import assets the user
// owns or is licensed to use; never rip copyrighted game assets; never bypass
// DRM; store license metadata; warn on unknown/restricted licenses. This gate
// is advisory by default (warn) and can be set strict (block) per project.

import { createLicenseBlock, licenseNeedsReview } from './AssetRecord.js';

export const GATE = Object.freeze({ ALLOW: 'allow', WARN: 'warn', BLOCK: 'block' });

export class LicenseTracker {
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.strict=false] block (rather than warn) on review-needed
   * @param {Set<string>} [opts.bannedSources] sources that are always blocked
   */
  constructor(opts = {}) {
    this._strict = !!opts.strict;
    this._banned = new Set(opts.bannedSources ?? []);
    this._records = new Map(); // assetId → license block (audit trail)
  }

  setStrict(on) { this._strict = !!on; }

  /** Record/normalize a license block for an asset id. */
  record(assetId, license) {
    const block = createLicenseBlock(license);
    this._records.set(String(assetId), block);
    return block;
  }

  get(assetId) { return this._records.get(String(assetId)) ?? null; }

  /**
   * Evaluate whether an asset may be imported.
   * @param {object} license a license block (or partial)
   * @returns {{ gate:string, allowed:boolean, reasons:string[] }}
   */
  evaluate(license) {
    const block = createLicenseBlock(license);
    const reasons = [];

    if (this._banned.has(block.source)) {
      return { gate: GATE.BLOCK, allowed: false, reasons: [`source '${block.source}' is banned`] };
    }
    if (block.allowsEngineConversion === false) {
      return { gate: GATE.BLOCK, allowed: false, reasons: ['license forbids engine conversion'] };
    }

    if (licenseNeedsReview(block)) {
      reasons.push('license is unknown or unverified — verify you own/are licensed for this asset');
      const gate = this._strict ? GATE.BLOCK : GATE.WARN;
      return { gate, allowed: gate !== GATE.BLOCK, reasons };
    }

    if (block.requiresAttribution) reasons.push('attribution required at use');
    return { gate: GATE.ALLOW, allowed: true, reasons };
  }
}
