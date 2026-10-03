// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/humanoid/FingerGenerator.js — synthesize finger bones from a hand
// mesh when the source skeleton has none (the browser-friendly geometric approach:
// detect open-hand fingertip "lobes", not ML). Method:
//   1. Build a hand frame from the wrist→fingertip direction; the lateral spread
//      axis (fingers fan out) and palm normal (thinnest) come from 2-D PCA of the
//      vertices in the plane perpendicular to forward.
//   2. Take the far band of vertices (toward the tips) and cluster them along the
//      lateral axis — each cluster is one finger lobe.
//   3. Label the shortest extreme lobe as the thumb; order the rest index→pinky.
//   4. Emit a short straight bone chain (proximal→intermediate→distal→tip) per
//      finger. If fewer than four lobes separate (a closed fist / low-poly hand),
//      report `detected:false` so the caller falls back to a single paddle.
//
// Pure geometry, GPU-free, deterministic → unit-testable.

import { FINGERS, FINGER_JOINTS, createFinger, HAND_SOURCE } from './HandRig.js';
import {
  vec3Add,
  vec3Cross,
  vec3Dot,
  vec3Scale,
  vec3Sub,
} from '../../core/math/MathVec3.js';

const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Any unit vector perpendicular to f. */
function perp(f) {
  const ref = Math.abs(f[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return norm(vec3Cross(f, ref));
}

/**
 * Build the hand frame: forward (given), plus lateral (max in-plane spread) and
 * palmNormal (min in-plane spread) from 2-D PCA in the plane ⊥ forward.
 */
function handFrame(rels, f) {
  const a = perp(f); const b = norm(vec3Cross(f, a));
  let xx = 0; let xy = 0; let yy = 0; let n = 0;
  for (const r of rels) {
    const p = vec3Sub(r, vec3Scale(f, vec3Dot(r, f))); // project into the plane ⊥ f
    const pa = vec3Dot(p, a); const pb = vec3Dot(p, b);
    xx += pa * pa; xy += pa * pb; yy += pb * pb; n++;
  }
  if (n) { xx /= n; xy /= n; yy /= n; }
  const theta = 0.5 * Math.atan2(2 * xy, xx - yy); // major-axis angle
  const lateral = norm(vec3Add(vec3Scale(a, Math.cos(theta)), vec3Scale(b, Math.sin(theta))));
  const palmNormal = norm(vec3Cross(f, lateral));
  return { lateral, palmNormal };
}

/**
 * Generate finger bones from hand vertices.
 * @param {number[][]} vertices world/model-space points of the hand mesh
 * @param {object} opts { wrist:[x,y,z], forward:[x,y,z], side, fingerStart=0.5, gap=0.08, joints=4 }
 * @returns {{detected:boolean, fingers:object[], handLength:number, count:number, lateral:number[], palmNormal:number[]}}
 */
export function generateFingers(vertices, opts = {}) {
  const wrist = opts.wrist || [0, 0, 0];
  const f = norm(opts.forward || [0, 0, 1]);
  const rels = vertices.map((v) => vec3Sub(v, wrist));
  const fail = (reason) => ({ detected: false, fingers: [], handLength: 0, count: 0, lateral: [1, 0, 0], palmNormal: [0, 1, 0], reason });
  if (rels.length < 12) return fail('too-few-verts');

  const { lateral, palmNormal } = handFrame(rels, f);
  const pts = rels.map((r) => ({ fc: vec3Dot(r, f), lc: vec3Dot(r, lateral), nc: vec3Dot(r, palmNormal) }))
    .filter((p) => p.fc > 0); // in front of the wrist
  if (!pts.length) return fail('behind-wrist');

  const handLength = Math.max(...pts.map((p) => p.fc));
  const fingerStart = (opts.fingerStart ?? 0.5) * handLength;
  const band = pts.filter((p) => p.fc >= fingerStart);
  if (band.length < 5) return fail('no-finger-band');

  // cluster the band along the lateral axis (gaps between fingers)
  band.sort((p, q) => p.lc - q.lc);
  const spanL = band[band.length - 1].lc - band[0].lc || 1;
  const gap = (opts.gap ?? 0.08) * spanL;
  const clusters = [];
  let cur = [band[0]];
  for (let i = 1; i < band.length; i++) {
    if (band[i].lc - band[i - 1].lc > gap) { clusters.push(cur); cur = []; }
    cur.push(band[i]);
  }
  clusters.push(cur);

  // describe each lobe by its tip + lateral position
  let lobes = clusters.map((c) => {
    let tip = c[0]; let sumLc = 0; let sumNc = 0;
    for (const p of c) { if (p.fc > tip.fc) tip = p; sumLc += p.lc; sumNc += p.nc; }
    return { tipFc: tip.fc, lc: sumLc / c.length, nc: sumNc / c.length, count: c.length };
  }).sort((u, v) => u.lc - v.lc);

  if (lobes.length < 4) return { ...fail('fist-or-lowpoly'), handLength };
  if (lobes.length > 5) lobes = lobes.slice().sort((u, v) => v.tipFc - u.tipFc).slice(0, 5).sort((u, v) => u.lc - v.lc);

  // thumb = the shortest of the two extreme lobes; the rest are index→pinky
  const left = lobes[0]; const right = lobes[lobes.length - 1];
  const thumbIsLeft = left.tipFc <= right.tipFc;
  const thumb = thumbIsLeft ? lobes.shift() : lobes.pop();
  if (!thumbIsLeft) lobes.reverse(); // order so index is adjacent to the thumb
  const ordered = [thumb, ...lobes];

  const palmEnd = 0.42 * handLength;
  const jointCount = opts.joints ?? FINGER_JOINTS.length;
  const at = (fc, lc, nc) => vec3Add(vec3Add(vec3Add(wrist, vec3Scale(f, fc)), vec3Scale(lateral, lc)), vec3Scale(palmNormal, nc));

  const fingers = ordered.slice(0, 5).map((lobe, i) => {
    const reach = Math.max(0.02 * handLength, lobe.tipFc - palmEnd);
    const frac = [0, 0.4, 0.72, 1];
    const joints = [];
    for (let j = 0; j < jointCount; j++) {
      const t = frac[Math.min(j, frac.length - 1)];
      joints.push({ position: at(palmEnd + reach * t, lobe.lc, lobe.nc) });
    }
    return createFinger({ name: FINGERS[i] || `finger${i}`, joints, source: HAND_SOURCE.GENERATED });
  });

  return { detected: true, fingers, handLength, count: fingers.length, lateral, palmNormal };
}
