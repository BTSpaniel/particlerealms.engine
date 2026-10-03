// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/humanoid/FingerMapper.js — detect EXISTING finger bones under a
// hand node by name (Mixamo "LeftHandIndex1..3", VRM "J_Bip_L_Index_Proximal",
// generic "index_01"), grouping them into canonical fingers with palm→tip joint
// order. Used before procedural generation: if the artist rigged fingers, keep
// them; only synthesize when none are found.

import { FINGERS, createFinger, HAND_SOURCE } from './HandRig.js';

const FINGER_RE = [
  ['thumb', /thumb/],
  ['index', /index|point/],
  ['middle', /middle|\bmid\b|mid_/],
  ['ring', /ring/],
  ['pinky', /pinky|little|pink/],
];

// Joint order keywords (palm→tip), used when there is no trailing number.
const JOINT_RANK = [
  [/meta|carp/, 0], [/prox|1\b|_1/, 1], [/inter|mid|2\b|_2/, 2], [/dist|3\b|_3/, 3], [/tip|end|4\b|_4/, 4],
];

function fingerOf(name) {
  for (const [f, re] of FINGER_RE) if (re.test(name)) return f;
  return null;
}

function jointOrder(name) {
  const m = name.match(/(\d+)\s*$/);
  if (m) return parseInt(m[1], 10);
  for (const [re, rank] of JOINT_RANK) if (re.test(name)) return rank;
  return 0;
}

/** Collect descendant node ids of a node (DFS). */
function descendants(byId, rootId) {
  const out = [];
  const stack = [...(byId.get(rootId)?.children || [])];
  while (stack.length) {
    const id = stack.pop();
    const n = byId.get(id);
    if (!n) continue;
    out.push(id);
    for (const c of n.children || []) stack.push(c);
  }
  return out;
}

/**
 * Map existing finger bones under a hand node.
 * @param {object} model EngineModel
 * @param {string} handNodeId
 * @returns {{fingers:object[], count:number, detected:boolean}}
 */
export function mapFingers(model, handNodeId) {
  const byId = new Map((model.nodes || []).map((n) => [n.id, n]));
  if (!handNodeId || !byId.has(handNodeId)) return { fingers: [], count: 0, detected: false };

  const groups = new Map(); // fingerName → [{nodeId, order, name}]
  for (const id of descendants(byId, handNodeId)) {
    const lower = (byId.get(id).name || '').toLowerCase();
    const finger = fingerOf(lower);
    if (!finger) continue;
    if (!groups.has(finger)) groups.set(finger, []);
    groups.get(finger).push({ nodeId: id, order: jointOrder(lower) });
  }

  const fingers = [];
  for (const name of FINGERS) {
    const g = groups.get(name);
    if (!g || !g.length) continue;
    g.sort((a, b) => a.order - b.order);
    fingers.push(createFinger({ name, joints: g.map((j) => ({ nodeId: j.nodeId })), source: HAND_SOURCE.SKELETON }));
  }
  // Respect partial finger rigs: many low-poly characters rig only thumb+index
  // (a deliberate choice / "mitten" hand). ≥2 named fingers ⇒ use the artist's
  // bones rather than synthesizing a full hand from the mesh. A lone false-match
  // (e.g. a stray "ring"/"point" bone) still falls through to generation.
  return { fingers, count: fingers.length, detected: fingers.length >= 2 };
}
