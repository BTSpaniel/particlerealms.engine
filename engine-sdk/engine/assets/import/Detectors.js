// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/import/Detectors.js — hierarchy, part, and semantic detection
// (spec §6). These produce hints, never assertions: every detection carries a
// confidence and is editor-correctable. Detection by name is the cheap first
// pass; geometry-based detection (cylinders → wheels, symmetry, etc.) is layered
// in by the phase that needs it (vehicles, humanoids, weapons).

/**
 * Summarize the preserved source hierarchy.
 * @returns {{ roots:string[], nodeCount:number, depth:number, meshNodes:number }}
 */
export function detectHierarchy(model) {
  const nodes = model.nodes || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots = nodes.filter((n) => !n.parent).map((n) => n.id);
  let depth = 0;
  const depthOf = (id, seen = new Set()) => {
    if (seen.has(id)) return 0; seen.add(id);
    const n = byId.get(id); if (!n || n.children.length === 0) return 1;
    return 1 + Math.max(...n.children.map((c) => depthOf(c, seen)));
  };
  for (const r of roots) depth = Math.max(depth, depthOf(r));
  const meshNodes = nodes.filter((n) => n.mesh).length;
  const summary = { roots, nodeCount: nodes.length, depth, meshNodes };
  model.metadata.hierarchy = summary;
  return summary;
}

// Keyword → semantic part kind. Ordered specific→general; first match wins.
const PART_KEYWORDS = [
  // vehicle
  [/wheel|tire|tyre|rim/i, 'wheel', 'vehicle'],
  [/hub|axle/i, 'hub', 'vehicle'],
  [/door/i, 'door', 'vehicle'],
  [/glass|window|windshield|windscreen/i, 'glass', 'vehicle'],
  [/head ?light|tail ?light|light|lamp/i, 'light', 'vehicle'],
  [/bumper/i, 'bumper', 'vehicle'],
  [/chassis|body|frame/i, 'chassis', 'vehicle'],
  // weapon
  [/muzzle/i, 'muzzle', 'weapon'],
  [/barrel/i, 'barrel', 'weapon'],
  [/magazine|mag\b|clip/i, 'magazine', 'weapon'],
  [/trigger/i, 'trigger', 'weapon'],
  [/bolt|slide|charging/i, 'bolt', 'weapon'],
  [/grip|handle/i, 'grip', 'weapon'],
  [/sight|scope|optic/i, 'sight', 'weapon'],
  // humanoid
  [/hips?|pelvis/i, 'hips', 'humanoid'],
  [/spine|chest|torso/i, 'spine', 'humanoid'],
  [/neck/i, 'neck', 'humanoid'],
  [/head|skull/i, 'head', 'humanoid'],
  [/shoulder|clavicle/i, 'shoulder', 'humanoid'],
  [/upper ?arm|\barm\b/i, 'arm', 'humanoid'],
  [/fore ?arm|lower ?arm/i, 'forearm', 'humanoid'],
  [/hand|wrist|palm/i, 'hand', 'humanoid'],
  [/finger|thumb|index|middle|ring|pinky|little/i, 'finger', 'humanoid'],
  [/thigh|upper ?leg/i, 'thigh', 'humanoid'],
  [/calf|shin|lower ?leg/i, 'shin', 'humanoid'],
  [/foot|ankle/i, 'foot', 'humanoid'],
  [/toe/i, 'toe', 'humanoid'],
];

const SIDE = [[/\b(l|left|_l|\.l)\b|left/i, 'left'], [/\b(r|right|_r|\.r)\b|right/i, 'right'], [/front|fwd|fl|fr/i, 'front'], [/rear|back|rl|rr/i, 'rear']];

function sideOf(name) {
  for (const [re, side] of SIDE) if (re.test(name)) return side;
  return null;
}

/**
 * Detect semantic parts by node name. Populates model.detectedParts.
 * @returns {Array<{nodeId:string, name:string, kind:string, domain:string, side:string|null, confidence:number}>}
 */
export function detectParts(model) {
  const parts = [];
  for (const n of model.nodes || []) {
    const name = n.name || '';
    for (const [re, kind, domain] of PART_KEYWORDS) {
      if (re.test(name)) {
        parts.push({ nodeId: n.id, name, kind, domain, side: sideOf(name), confidence: 0.7 });
        break;
      }
    }
  }
  model.detectedParts = parts;
  return parts;
}

/**
 * Roll detected parts up to a guessed runtime domain (vehicle/humanoid/weapon).
 * @returns {{ domain:string|null, scores:object, confidence:number }}
 */
export function detectSemanticDomain(model) {
  const parts = model.detectedParts?.length ? model.detectedParts : detectParts(model);
  const scores = {};
  for (const p of parts) scores[p.domain] = (scores[p.domain] || 0) + 1;
  let domain = null; let best = 0; let total = 0;
  for (const [d, c] of Object.entries(scores)) { total += c; if (c > best) { best = c; domain = d; } }
  const confidence = total > 0 ? best / total : 0;
  const result = { domain, scores, confidence };
  model.metadata.semanticDomain = result;
  return result;
}
