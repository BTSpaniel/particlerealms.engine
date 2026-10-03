// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/weapon/WeaponSocketDetector.js — find weapon sockets + moving
// parts by NAME (priority-ordered patterns) and resolve the forward/aim axis +
// muzzle by geometry (a firearm is long along the barrel; the muzzle is the
// front-most node along that axis). Hints + confidence; ambiguous → editor.
// GAME ABSTRACTION ONLY — no real-firearm dimensions or ballistics here.

import { computeWorldMatrices, transformPoint } from '../vehicle/VehicleMath.js';
import { aabbSize } from '../../core/math/MathGeometry.js';
import { MOVING_PART, WEAPON_TYPE, REQUIRED_SOCKETS } from './WeaponRig.js';

// Socket patterns in PRIORITY order (most specific first so e.g. a foregrip is
// not swallowed by the generic grip rule).
const SOCKET_RULES = [
  ['muzzle', /muzzle|flash|suppress|silencer|crown|barreltip|barrel_tip/],
  ['gripSecondary', /foregrip|frontgrip|grip2|grip_b|secondarygrip|handguard|foreend|fore_end/],
  ['sight', /sight|optic|scope|reddot|red_dot|irons?|aimpoint/],
  ['rail', /rail|picatinny|mount/],
  ['magazine', /magazine|magwell|mag_|\bmag\b|clip/],
  ['ejectionPort', /ejection|ejector|port/],
  ['chamber', /chamber|breech/],
  ['trigger', /trigger/],
  ['stock', /stock|butt/],
  ['barrel', /barrel|bbl/],
  ['gripPrimary', /pistolgrip|pistol_grip|\bgrip\b|handle|backstrap/],
];

const PART_RULES = [
  [MOVING_PART.CHARGING_HANDLE, /charging|cocking|chargehandle|charge_handle/],
  [MOVING_PART.SLIDE, /slide/],
  [MOVING_PART.BOLT, /bolt(?!.?catch)/],
  [MOVING_PART.HAMMER, /hammer|striker/],
  [MOVING_PART.CYLINDER, /cylinder/],
  [MOVING_PART.MAGAZINE, /magazine|magwell|mag_|\bmag\b/],
  [MOVING_PART.SAFETY, /safety|selector/],
  [MOVING_PART.TRIGGER, /trigger/],
];

function worldCenter(world, id) {
  const m = world.get(id);
  return m ? transformPoint(m, [0, 0, 0]) : [0, 0, 0];
}

function meshWorldBounds(model, world) {
  const byMesh = new Map((model.meshes || []).map((mm) => [mm.id, mm]));
  const byPrim = new Map((model.primitives || []).map((p) => [p.id, p]));
  let min = [Infinity, Infinity, Infinity]; let max = [-Infinity, -Infinity, -Infinity]; let any = false;
  for (const n of model.nodes || []) {
    const mesh = n.mesh && byMesh.get(n.mesh);
    if (!mesh) continue;
    const wm = world.get(n.id);
    for (const pid of mesh.primitives) {
      const b = byPrim.get(pid)?.bounds; if (!b) continue; any = true;
      for (let i = 0; i < 8; i++) {
        const c = [(i & 1) ? b.max[0] : b.min[0], (i & 2) ? b.max[1] : b.min[1], (i & 4) ? b.max[2] : b.min[2]];
        const w = transformPoint(wm, c);
        for (let k = 0; k < 3; k++) { if (w[k] < min[k]) min[k] = w[k]; if (w[k] > max[k]) max[k] = w[k]; }
      }
    }
  }
  return any ? { min, max, size: aabbSize({ min, max }) } : null;
}

function inferType(model, sockets, parts) {
  const name = (model.name || '').toLowerCase();
  if (parts.some((p) => p.motion === MOVING_PART.CYLINDER) || /revolver/.test(name)) return WEAPON_TYPE.REVOLVER;
  if (/shotgun|pump/.test(name)) return WEAPON_TYPE.SHOTGUN;
  if (/smg|mp5|uzi|mp7|p90/.test(name)) return WEAPON_TYPE.SMG;
  if (/rifle|ar15|ar_15|\bak\b|m4|m16|carbine|\bsks\b/.test(name)) return WEAPON_TYPE.RIFLE;
  if (/pistol|glock|handgun|\b1911\b/.test(name)) return WEAPON_TYPE.PISTOL;
  // geometry fallback: a shoulder stock implies a long gun
  return sockets.stock ? WEAPON_TYPE.RIFLE : WEAPON_TYPE.PISTOL;
}

/**
 * Detect weapon sockets, moving parts, forward axis, and muzzle.
 * @param {object} model EngineModel
 * @returns {object} detection result
 */
export function detectWeapon(model) {
  const world = computeWorldMatrices(model);
  const nodes = model.nodes || [];

  // sockets (first node to match a rule wins that socket)
  const sockets = {};
  const usedNodes = new Set();
  for (const node of nodes) {
    const lower = (node.name || '').toLowerCase();
    for (const [socket, re] of SOCKET_RULES) {
      if (sockets[socket]) continue;
      if (re.test(lower)) { sockets[socket] = { nodeId: node.id, localPosition: worldCenter(world, node.id) }; usedNodes.add(node.id); break; }
    }
  }

  // moving parts (a node may be both a socket and a moving part, e.g. magazine)
  const movingParts = [];
  const seenPart = new Set();
  for (const node of nodes) {
    const lower = (node.name || '').toLowerCase();
    for (const [motion, re] of PART_RULES) {
      if (seenPart.has(motion)) continue;
      if (re.test(lower)) {
        const axis = (motion === MOVING_PART.SLIDE || motion === MOVING_PART.BOLT || motion === MOVING_PART.CHARGING_HANDLE)
          ? 'forward' : (motion === MOVING_PART.MAGAZINE ? 'down' : 'rotate');
        movingParts.push({ nodeId: node.id, motion, axis, travel: 0 });
        seenPart.add(motion);
        break;
      }
    }
  }

  // forward axis = longest world-bounds axis (the barrel runs the length of a gun)
  const wb = meshWorldBounds(model, world);
  let fwdIdx = 2;
  if (wb) fwdIdx = wb.size.indexOf(Math.max(...wb.size));
  const forwardAxis = [fwdIdx === 0 ? 1 : 0, fwdIdx === 1 ? 1 : 0, fwdIdx === 2 ? 1 : 0];

  // muzzle: a named muzzle wins; else the front-most mesh node along forward.
  let muzzleNode = sockets.muzzle?.nodeId || null;
  if (!muzzleNode) {
    let best = -Infinity;
    for (const n of nodes) {
      if (!n.mesh) continue;
      const c = worldCenter(world, n.id);
      const d = c[fwdIdx];
      if (d > best) { best = d; muzzleNode = n.id; }
    }
    if (muzzleNode) sockets.muzzle = { nodeId: muzzleNode, localPosition: worldCenter(world, muzzleNode) };
  }

  const barrelLength = wb ? wb.size[fwdIdx] : 0;
  const type = inferType(model, sockets, movingParts);

  const missing = REQUIRED_SOCKETS.filter((s) => !sockets[s]);
  const confidence = REQUIRED_SOCKETS.length ? (REQUIRED_SOCKETS.length - missing.length) / REQUIRED_SOCKETS.length : 0;
  const partNodes = new Set(movingParts.map((p) => p.nodeId));
  const unmapped = nodes.filter((n) => n.mesh && !usedNodes.has(n.id) && !partNodes.has(n.id) && n.id !== muzzleNode).map((n) => n.id);

  return { type, sockets, movingParts, forwardAxis, muzzleNode, barrelLength, missing, confidence, unmapped };
}
