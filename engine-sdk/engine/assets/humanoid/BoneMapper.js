// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/humanoid/BoneMapper.js — map a source skeleton's bones onto the
// canonical humanoid slots (HumanoidRig) by NAME first (Mixamo / VRM / generic
// rig conventions), then hierarchy for the spine chain. Every mapping is a hint;
// ambiguous/extra bones are reported as `unmapped` and missing required slots as
// `missing` so the editor can correct (rule 62). Pure + GPU-free (gate-testable).

import { HUMANOID_BONES, REQUIRED_BONES, BODY_SIDE } from './HumanoidRig.js';

// Common rig prefixes to strip before keyword matching.
const PREFIX_RE = /^(mixamorig[:_]?|j_bip_|armature[|:]?|bip01[ _]?|bip_?|def[-_]|b_|bn_|cc_base_|root_)/;

/** Conservative left/right detection — explicit words or delimited single tokens. */
function detectSide(lower) {
  if (/left/.test(lower)) return BODY_SIDE.LEFT;
  if (/right/.test(lower)) return BODY_SIDE.RIGHT;
  // delimited side token: _l_, .l, -l, " l", l at start/end next to a delimiter/digit
  if (/(^|[_.\-\s])(l|lf|lft)([_.\-\s]|\d|$)/.test(lower)) return BODY_SIDE.LEFT;
  if (/(^|[_.\-\s])(r|rt|rgt)([_.\-\s]|\d|$)/.test(lower)) return BODY_SIDE.RIGHT;
  return BODY_SIDE.CENTER;
}

/** Classify a (prefix-stripped, lowercased) bone name into a body part token. */
function basePart(n) {
  if (/toe/.test(n)) return 'toes';
  if (/foot|ankle/.test(n)) return 'foot';
  if (/lowerleg|lowleg|calf|shin|knee/.test(n)) return 'lowerLeg';
  if (/upperleg|upleg|thigh/.test(n)) return 'upperLeg';
  if (/leg/.test(n)) return 'lowerLeg';            // bare "leg" (e.g. Mixamo) = shin
  if (/hand|wrist/.test(n)) return 'hand';
  if (/forearm|lowerarm|lowarm|elbow/.test(n)) return 'lowerArm';
  if (/upperarm|uparm/.test(n)) return 'upperArm';
  if (/shoulder|clavicle|collar/.test(n)) return 'shoulder';
  if (/arm/.test(n)) return 'upperArm';            // bare "arm" (Mixamo) = upper arm
  if (/head/.test(n)) return 'head';
  if (/neck/.test(n)) return 'neck';
  if (/upperchest|chestupper/.test(n)) return 'upperChest';
  if (/chest/.test(n)) return 'chest';
  if (/spine/.test(n)) return 'spine';
  if (/hips|hip|pelvis|root/.test(n)) return 'hips';
  return null;
}

const SIDED = new Set(['shoulder', 'upperArm', 'lowerArm', 'hand', 'upperLeg', 'lowerLeg', 'foot', 'toes']);
const CENTER_PARTS = new Set(['hips', 'spine', 'chest', 'upperChest', 'neck', 'head']);

function slotFor(part, side) {
  if (CENTER_PARTS.has(part)) return part; // spine chain resolved later
  if (!SIDED.has(part)) return null;
  if (side === BODY_SIDE.LEFT) return 'left' + part[0].toUpperCase() + part.slice(1);
  if (side === BODY_SIDE.RIGHT) return 'right' + part[0].toUpperCase() + part.slice(1);
  return null; // a limb with no side is ambiguous → unmapped
}

/** Candidate bone nodes: skin joints if present, else every node. */
function jointNodes(model) {
  const ids = new Set();
  for (const skin of model.skins || []) for (const j of skin.raw?.joints || []) ids.add(`node:${j}`);
  return ids.size ? (model.nodes || []).filter((n) => ids.has(n.id)) : (model.nodes || []);
}

/**
 * Map a model's skeleton to canonical humanoid bones.
 * @param {object} model EngineModel
 * @param {object} [opts]
 * @returns {{bones:object, missing:string[], unmapped:string[], confidence:number, source:string, skeletonRoot:string|null, usedHierarchy:boolean}}
 */
export function mapBones(model, opts = {}) {
  const byId = new Map((model.nodes || []).map((n) => [n.id, n]));
  const depth = (n) => { let d = 0; let c = n; while (c && c.parent && d < 64) { c = byId.get(c.parent); d++; } return d; };

  const nodes = jointNodes(model);
  const bones = {};
  const unmapped = [];
  const torso = []; // spine/chest/upperChest candidates for hierarchy ordering
  let usedHierarchy = false;

  for (const node of nodes) {
    const lower = (node.name || '').toLowerCase();
    const stripped = lower.replace(PREFIX_RE, '');
    const part = basePart(stripped);
    if (!part) continue;
    const side = detectSide(lower);

    if (part === 'spine' || part === 'chest' || part === 'upperChest') {
      torso.push({ id: node.id, part, depth: depth(node) });
      continue;
    }
    const slot = slotFor(part, side);
    if (!slot) { unmapped.push(node.id); continue; }
    if (bones[slot]) { unmapped.push(node.id); continue; } // keep first; extras → editor
    bones[slot] = node.id;
  }

  // Resolve the torso chain by depth: nearest-to-hips = spine, then chest,
  // then upperChest. Explicit chest/upperChest names take their own slot.
  if (torso.length) {
    torso.sort((a, b) => a.depth - b.depth);
    const order = ['spine', 'chest', 'upperChest'];
    let oi = 0;
    for (const tb of torso) {
      let slot = null;
      if (tb.part === 'chest' && !bones.chest) slot = 'chest';
      else if (tb.part === 'upperChest' && !bones.upperChest) slot = 'upperChest';
      else { while (oi < order.length && bones[order[oi]]) oi++; slot = order[oi] || null; }
      if (slot && !bones[slot]) { bones[slot] = tb.id; if (tb.part === 'spine') usedHierarchy = true; }
      else unmapped.push(tb.id);
    }
  }

  const missing = REQUIRED_BONES.filter((s) => !bones[s]);
  const presentReq = REQUIRED_BONES.length - missing.length;
  const confidence = REQUIRED_BONES.length ? presentReq / REQUIRED_BONES.length : 0;

  return {
    bones,
    missing,
    unmapped,
    confidence,
    source: usedHierarchy ? 'mixed' : 'name',
    skeletonRoot: bones.hips || null,
    usedHierarchy,
    mappedCount: Object.keys(bones).length,
    totalSlots: HUMANOID_BONES.length,
  };
}
