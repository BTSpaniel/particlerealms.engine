// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/rig/RagdollSim.js — a tiny, GENERIC Verlet/PBD ragdoll runtime
// that simulates ANY ragdoll descriptor from RagdollBuilder (humanoid, creature,
// healed/mirrored limbs). Each bone joint is a particle; each bone is a distance
// constraint to its parent (Jakobsen "Advanced Character Physics"). Gravity +
// ground + a few constraint iterations give a stable, believable flop with no
// dependency on a fixed humanoid template. Pure JS / deterministic / GPU-free.

import {
  vec3Add,
  vec3Cross,
  vec3Dot,
  vec3Lerp,
  vec3Scale,
  vec3Sub,
} from '../../core/math/MathVec3.js';
import { clamp } from '../../core/math/MathScalar.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = vlen(a) || 1e-9; return [a[0] / l, a[1] / l, a[2] / l]; };
const D2R = Math.PI / 180;
// Signed angle (rad) from unit a to unit b measured about unit axis n.
const signedAngle = (a, b, n) => Math.atan2(vec3Dot(vec3Cross(a, b), n), vec3Dot(a, b));
// Rotate vector v about unit axis by `ang` (Rodrigues).
function rotateAboutAxis(v, axis, ang) {
  const c = Math.cos(ang); const s = Math.sin(ang); const k = vec3Dot(axis, v) * (1 - c);
  const cx = vec3Cross(axis, v);
  return [v[0] * c + cx[0] * s + axis[0] * k, v[1] * c + cx[1] * s + axis[1] * k, v[2] * c + cx[2] * s + axis[2] * k];
}
// Rotate v by the rotation taking unit aFrom → unit aTo (keeps a vector attached to a swinging bone).
function rotateBetween(aFrom, aTo, v) {
  const axis = vec3Cross(aFrom, aTo); const al = vlen(axis);
  if (al < 1e-7) return v.slice();
  return rotateAboutAxis(v, [axis[0] / al, axis[1] / al, axis[2] / al], Math.atan2(al, vec3Dot(aFrom, aTo)));
}
// Closest points between two bone segments. Self-collision uses this instead of
// joint-to-joint spacing so limbs behave like capsules, not loose point clouds.
function closestSegments(p1, q1, p2, q2) {
  const d1 = vec3Sub(q1, p1); const d2 = vec3Sub(q2, p2); const r = vec3Sub(p1, p2);
  const a = vec3Dot(d1, d1); const e = vec3Dot(d2, d2); const f = vec3Dot(d2, r);
  let s = 0; let t = 0;
  if (a <= 1e-8 && e <= 1e-8) { s = 0; t = 0; }
  else if (a <= 1e-8) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = vec3Dot(d1, r);
    if (e <= 1e-8) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = vec3Dot(d1, d2); const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  const c1 = vec3Add(p1, vec3Scale(d1, s));
  const c2 = vec3Add(p2, vec3Scale(d2, t));
  return { s, t, c1, c2, delta: vec3Sub(c2, c1), dist: dist(c1, c2) };
}

/**
 * @param {object} ragdoll RagdollBuilder output ({ bones:[{position,parentIndex}] })
 * @param {object} [opts] { gravity:[x,y,z], ground:number|null, damping, iterations, pinned:number[] }
 */
export function createRagdollSim(ragdoll, opts = {}) {
  const gravity = opts.gravity || [0, -9.8, 0];
  const ground = opts.ground ?? null;       // a Y plane; particles can't fall below it
  const damping = opts.damping ?? 0.99;
  const iterations = opts.iterationsPerSubstep ?? opts.iterations ?? 4;
  const friction = opts.friction ?? 0.6;
  const pinned = new Set(opts.pinned || []); // bone indices held in place (optional)

  const bones = ragdoll.bones || [];
  const bind = bones.map((b) => [...b.position]);
  const root0 = bind[0] || [0, 0, 0];
  const radius0 = Math.max(1e-3, ...bind.map((p) => dist(p, root0)));
  // `radius0` is the imported rig's scale proxy. All default caps derive from it
  // so a small creature and a tall humanoid get proportional stability limits.
  // Time guards clamp visual-frame spikes, then split the frame into substeps so
  // debugger pauses and tab stalls do not inject huge Verlet displacements.
  const substeps = Math.max(1, opts.substeps ?? 6);
  const maxSubDt = opts.maxSubDt ?? (1 / 120);
  const maxSubsteps = Math.max(substeps, opts.maxSubsteps ?? 48);
  const maxFrameDt = opts.maxFrameDt ?? 0.02;
  // Default velocity cap must NEVER clamp a legitimate free-fall, or falls play
  // out in slow motion (the clamp used to bite at radius0*8, which a drop of just
  // one body-height under realistic gravity already exceeds). Derive the cap from
  // the sim's own physics: terminal speed of a fall across the full bounds sphere
  // (v = √(2·|g|·2·boundsRadius), boundsRadius defaults to radius0*4 below), with
  // the old radius0*8 kept as the floor. Explicit opts.maxVelocity still wins.
  const gravityMag0 = Math.hypot(gravity[0], gravity[1], gravity[2]);
  const freefallCap = Math.sqrt(Math.max(0, 2 * gravityMag0 * (opts.boundsRadius ?? radius0 * 4) * 2));
  const maxVelocity = opts.maxVelocity ?? Math.max(radius0 * 8, freefallCap);
  const velocityClampFactor = opts.velocityClampFactor ?? 0.45;
  // Projection caps limit how far constraints may move a particle in one solve.
  // Distance constraints use `maxProjection`; angular constraints use smaller caps
  // except hinges, which need extra authority to recover from one-way over-bends.
  const maxProjection = opts.maxProjection ?? radius0 * 0.15;
  const angularProjection = opts.angularProjection ?? radius0 * 0.08;
  const angularBias = opts.angularBias ?? 0.75;
  const hingeProjection = opts.hingeProjection ?? radius0 * 0.28;
  const hingeBias = opts.hingeBias ?? 0.9;
  const maxDisplacement = opts.maxDisplacement ?? radius0 * 0.08;
  const boundsRadius = opts.boundsRadius ?? radius0 * 4;
  const repairFactor = opts.projectionVelocityRepair ?? 0.9;
  const clampBurstLimit = opts.clampBurstLimit ?? Math.max(8, bones.length >> 1);
  const clampBurstDamping = opts.clampBurstDamping ?? 0.35;
  // Self-collision is intentionally soft and capped. It prevents visible limb/core
  // interpenetration, but must never overpower hinge/cone limits or it creates a
  // collision-vs-joint feedback loop.
  const selfCollision = opts.selfCollision ?? true;
  const selfCollisionScale = opts.selfCollisionScale ?? 0.55;
  const selfCollisionIterations = opts.selfCollisionIterations ?? 1;
  const selfCollisionStrength = opts.selfCollisionStrength ?? 0.35;
  const selfCollisionProjection = opts.selfCollisionProjection ?? radius0 * 0.035;
  const globalDrag = opts.globalDrag ?? 0.012;
  // Spawn warmup lets a freshly imported skeleton settle into its constraints with
  // reduced gravity and extra damping. Without this, initial pose mismatch can turn
  // the first few frames into a large corrective impulse.
  const warmupTime = opts.warmupTime ?? 0.08;
  const warmupDamping = opts.warmupDamping ?? 0.93;
  const warmupGravityScale = opts.warmupGravityScale ?? 0.75;
  const maxHorizontalVelocity = opts.maxHorizontalVelocity ?? maxVelocity;
  const maxVerticalVelocity = opts.maxVerticalVelocity ?? maxVelocity * 1.5;
  let simAge = 0;
  let activeDamping = damping;
  let activeGravityScale = 1;
  let parts = bones.map((b) => ({ pos: [...b.position], prev: [...b.position] }));
  let stepStats = { substeps: 0, dt: 0, dtClamped: false, warmup: true, maxVelocity: 0, clampedVelocities: 0, postVelocityClamps: 0, maxProjection: 0, clampedProjections: 0, maxDisplacement: 0, clampedDisplacements: 0, boundsClamps: 0, nanRecoveries: 0, groundContacts: 0, clampBursts: 0, selfCollisions: 0 };
  // Primary stick constraints: each child joint is kept at its bind-pose distance
  // from the parent. `neighbors` tracks adjacent bones so self-collision can skip
  // connected segments that are supposed to touch.
  const cons = [];
  const neighbors = bones.map(() => new Set());
  const particleRadius = bones.map(() => radius0 * 0.045);
  for (let i = 0; i < bones.length; i++) {
    const pi = bones[i].parentIndex;
    if (pi >= 0 && bones[pi]) {
      const rest = Math.max(1e-4, dist(bones[i].position, bones[pi].position));
      cons.push({ i, j: pi, rest });
      neighbors[i].add(pi); neighbors[pi].add(i);
      particleRadius[i] = Math.max(particleRadius[i], rest * 0.22);
      particleRadius[pi] = Math.max(particleRadius[pi], rest * 0.18);
    }
  }

  // Rigidify HUBS (the pelvis, ribcage, a creature's central body): tie each bone's
  // child joints to one another with extra length constraints so the trunk can't
  // shear or "give out" at the hips — while every limb still articulates freely
  // from its now-stable root. (Jakobsen: "extra length constraints … to prevent
  // unnatural poses.") This is what stops the root/pelvis collapsing.
  const childrenByBone = bones.map(() => []);
  for (let i = 0; i < bones.length; i++) { const p = bones[i].parentIndex; if (p >= 0 && bones[p]) childrenByBone[p].push(i); }
  for (let r = 0; r < bones.length; r++) {
    const ch = childrenByBone[r];
    if (ch.length < 2) continue;
    for (let a = 0; a < ch.length; a++) for (let b = a + 1; b < ch.length; b++) {
      const ia = ch[a]; const ib = ch[b];
      cons.push({ i: ia, j: ib, rest: Math.max(1e-4, dist(bones[ia].position, bones[ib].position)), hub: true });
      neighbors[ia].add(ib); neighbors[ib].add(ia);
    }
    // Also brace each child back to the hub's PARENT (e.g. spine/legs ↔ the bone
    // above the pelvis) so the trunk keeps its shape through the root joint.
    const gp = bones[r].parentIndex;
    if (gp >= 0 && bones[gp]) for (const c of ch) {
      cons.push({ i: c, j: gp, rest: Math.max(1e-4, dist(bones[c].position, bones[gp].position)), hub: true });
      neighbors[c].add(gp); neighbors[gp].add(c);
    }
  }
  // Build non-adjacent segment pairs once from the bind pose. Pairs already close
  // in the rest pose are skipped so shoulders, hips, hands, and packed creature
  // anatomy do not start with permanent collision pressure.
  const boneSegments = [];
  for (let i = 0; i < bones.length; i++) {
    const p = bones[i].parentIndex;
    if (p >= 0 && bones[p]) boneSegments.push({ a: p, b: i, r: Math.max(particleRadius[p], particleRadius[i]) * selfCollisionScale });
  }
  const selfPairs = [];
  const noSelfCollisionBones = new Set();
  for (let i = 0; i < boneSegments.length; i++) for (let j = i + 1; j < boneSegments.length; j++) {
    const sa = boneSegments[i]; const sb = boneSegments[j];
    if (sa.a === sb.a || sa.a === sb.b || sa.b === sb.a || sa.b === sb.b) continue;
    if (neighbors[sa.a].has(sb.a) || neighbors[sa.a].has(sb.b) || neighbors[sa.b].has(sb.a) || neighbors[sa.b].has(sb.b)) continue;
    const min = Math.min(radius0 * 0.16, sa.r + sb.r);
    const rest = closestSegments(bind[sa.a], bind[sa.b], bind[sb.a], bind[sb.b]);
    if (rest.dist <= min * 1.35) continue;
    selfPairs.push({ a0: sa.a, a1: sa.b, b0: sb.a, b1: sb.b, min });
  }

  // Angular ROM as UNILATERAL distance constraints between a joint and its
  // grandparent (Jakobsen "Advanced Character Physics" §angular constraints — the
  // robust, jitter-free way to limit angles in a position-only solver; rotating
  // the child point directly fights gravity and jitters). The bend angle β between
  // the upper bone (gp→p, length a) and this bone (p→i, length b) maps to the
  // grandparent distance via the law of cosines:  d² = a² + b² + 2ab·cos β.
  // Allowing β ∈ [restβ−maxBend, restβ+maxBend] therefore bounds d ∈ [dMin, dMax]
  // (more bend ⇒ shorter d). Hinges fold far (twistDeg), balls swing in a cone
  // (swingDeg), saddles barely move — exactly the auto-detected joint limits.
  // Directional HINGE limits (knees/elbows): a real hinge bends ONE way only. The
  // distance ROM above limits the bend MAGNITUDE but not its sign, so a knee can
  // fold backwards. Here we build a SIGNED hinge for any joint whose builder gave a
  // `flexTarget` (the direction the outgoing bone moves when flexing, in this rig's
  // space). The hinge axis n0 = thigh × flexTarget; the signed bend about n is
  // clamped to [0, maxBend] (flexion only) and the shin is kept in the bend plane.
  // n tracks the parent bone so it stays correct as the limb (and body) rotate.
  const hingeCons = [];
  const signedHinge = new Set(); // joint particle i handled by a signed hinge → skip its symmetric ROM
  for (let i = 0; i < bones.length; i++) {
    const p = bones[i].parentIndex; if (p < 0 || !bones[p]) continue;
    const gp = bones[p].parentIndex; if (gp < 0 || !bones[gp]) continue;
    if (bones[p].jointType !== 'hinge' || !bones[p].flexTarget) continue;
    const t0 = unit(vec3Sub(bones[p].position, bones[gp].position));
    const n0raw = vec3Cross(t0, unit(bones[p].flexTarget));
    if (vlen(n0raw) < 1e-4) continue; // flex target parallel to the bone → can't orient
    const n0 = unit(n0raw);
    const shinLen = Math.max(1e-4, dist(bones[i].position, bones[p].position));
    // Clamp the hinge limit to a realistic maximum (130°) so knees/elbows can't
    // fold past anatomical range even if the rig data specifies a larger value.
    const maxBend = Math.min((bones[p].twistDeg ?? 140) * D2R, 130 * D2R);
    hingeCons.push({ i, p, gp, t0, n0, shinLen, hi: maxBend });
    signedHinge.add(i);
    noSelfCollisionBones.add(i);
  }

  // Body-referenced SWING CONE for ball joints (hips/shoulders). The symmetric ROM
  // above references the hip off the short lateral pelvis→socket bone, so its cone
  // is centred sideways and the leg lifts the wrong way. A `swingCone` instead
  // limits the OUTGOING bone (thigh) to a cone around a body axis (e.g. body-down =
  // hips−spine) that tracks the rigid pelvis as it tumbles. Only the axis is needed
  // (a cone is symmetric), so there's no frame/twist ambiguity.
  const coneCons = [];
  const swingCone = new Set(); // child particle handled by a cone → skip its symmetric ROM
  for (let p = 0; p < bones.length; p++) {
    const sc = bones[p].swingCone; if (!sc) continue;
    const child = sc.child;
    if (child == null || child < 0 || !bones[child]) continue;
    const len = Math.max(1e-4, dist(bones[child].position, bones[p].position));
    const con = { p, child, half: (sc.half ?? 70) * D2R, len };
    if (sc.carry && bones[sc.carry.cp] && bones[sc.carry.cgp]) {
      // CARRIED frame (shoulders): the cone centre + fwd/lat refs are stored at bind
      // and rotated each step by the parent (clavicle) bone's swing — so the arm's
      // limits track the torso, centred on the REST ARM direction (lateral in T-pose)
      // rather than body-down. This is the editor/Bullet rest-relative cone.
      con.carry = true; con.cp = sc.carry.cp; con.cgp = sc.carry.cgp;
      con.t0 = unit(vec3Sub(bones[con.cp].position, bones[con.cgp].position));
      con.center0 = unit(sc.carry.center0); con.fwd0 = unit(sc.carry.fwd0); con.lat0 = unit(sc.carry.lat0);
      con.maxFwd = (sc.maxFwd ?? 110) * D2R; con.maxBack = (sc.maxBack ?? 50) * D2R; con.maxSide = (sc.maxSide ?? 90) * D2R;
    } else if (bones[sc.aIdx] && bones[sc.bIdx]) {
      // Body-frame cone (hips): centre axis = pos[bIdx]−pos[aIdx] (e.g. hips−spine).
      con.aIdx = sc.aIdx; con.bIdx = sc.bIdx;
      // Optional ELLIPTICAL (anatomical) limits about a pelvis frame (lateral = R−L).
      if (sc.lIdx != null && bones[sc.lIdx] && bones[sc.rIdx]) {
        con.lIdx = sc.lIdx; con.rIdx = sc.rIdx; con.fwdSign = sc.fwdSign ?? 1;
        con.maxFwd = (sc.maxFwd ?? 100) * D2R; con.maxBack = (sc.maxBack ?? 25) * D2R; con.maxSide = (sc.maxSide ?? 45) * D2R;
      }
    } else continue; // no usable frame
    coneCons.push(con);
    swingCone.add(child);
    noSelfCollisionBones.add(child);
  }

  const angleCons = [];
  for (let i = 0; i < bones.length; i++) {
    if (signedHinge.has(i) || swingCone.has(i)) continue; // already a directional hinge / cone
    const p = bones[i].parentIndex; if (p < 0 || !bones[p]) continue;
    const gp = bones[p].parentIndex; if (gp < 0 || !bones[gp]) continue;
    const a = Math.max(1e-4, dist(bones[p].position, bones[gp].position));
    const b = Math.max(1e-4, dist(bones[i].position, bones[p].position));
    const rpd = unit(vec3Sub(bones[p].position, bones[gp].position));
    const rbd = unit(vec3Sub(bones[i].position, bones[p].position));
    const restBeta = Math.acos(clamp(vec3Dot(rpd, rbd), -1, 1));
    // The chain gp→p→i bends AT the middle joint p, so the ROM is bones[p]'s limit
    // (NOT bones[i]'s — that off-by-one let the hip borrow the knee's 150° range and
    // fold fully). Hinges fold far (twistDeg); ball/saddle swing within swingDeg.
    const jt = bones[p].jointType;
    const maxBend = ((jt === 'hinge' ? (bones[p].twistDeg ?? 120) : (bones[p].swingDeg ?? 60)) || 60) * D2R;
    const betaMin = Math.max(0, restBeta - maxBend);
    const betaMax = Math.min(Math.PI, restBeta + maxBend);
    const dOf = (beta) => Math.sqrt(Math.max(0, a * a + b * b + 2 * a * b * Math.cos(beta)));
    angleCons.push({ i, gp, dMin: dOf(betaMax), dMax: dOf(betaMin) });
  }

  // Solve the angle limits as clamped distance constraints (rest = clamp(d, …)),
  // distributing the correction over both endpoints like the bone sticks do.
  function applyAngleLimits() {
    for (const c of angleCons) {
      const A = parts[c.i]; const B = parts[c.gp];
      const dx = B.pos[0] - A.pos[0]; const dy = B.pos[1] - A.pos[1]; const dz = B.pos[2] - A.pos[2];
      const d = Math.hypot(dx, dy, dz) || 1e-6;
      const rest = d < c.dMin ? c.dMin : (d > c.dMax ? c.dMax : 0);
      if (!rest) continue; // within range
      const diff = ((d - rest) / d) * 0.5;
      const ap = pinned.has(c.i) ? 0 : (pinned.has(c.gp) ? 1 : 0.5);
      const bp = pinned.has(c.gp) ? 0 : (pinned.has(c.i) ? 1 : 0.5);
      movePart(c.i, dx * diff * (ap * 2) * angularBias, dy * diff * (ap * 2) * angularBias, dz * diff * (ap * 2) * angularBias, angularProjection, repairFactor);
      movePart(c.gp, -dx * diff * (bp * 2) * angularBias, -dy * diff * (bp * 2) * angularBias, -dz * diff * (bp * 2) * angularBias, angularProjection, repairFactor);
    }
  }

  // Directional hinge: keep the outgoing bone in the bend plane and only let it
  // flex one way (signed angle clamped to [0, hi]). The hinge axis tracks the
  // parent bone's current swing, so the knee/elbow stays anatomically correct even
  // as the whole body tumbles. Only the child joint moves (the parent is heavier).
  function applyHingeLimits() {
    for (const c of hingeCons) {
      if (pinned.has(c.i)) continue;
      const pp = parts[c.p].pos; const gpp = parts[c.gp].pos; const ip = parts[c.i].pos;
      const t = unit(vec3Sub(pp, gpp));                 // current parent bone (thigh)
      const n = unit(rotateBetween(c.t0, t, c.n0)); // hinge axis carried with the parent
      const s = unit(vec3Sub(ip, pp));                  // current outgoing bone (shin)
      const theta = clamp(signedAngle(t, s, n), 0, c.hi);
      const dir = rotateAboutAxis(t, n, theta);     // in-plane, correctly signed
      const target = vec3Add(pp, vec3Scale(dir, c.shinLen));
      const cur = parts[c.i].pos;
      const over = Math.max(0, signedAngle(t, s, n) - c.hi, -signedAngle(t, s, n));
      const cap = over > 2 * D2R ? Math.max(hingeProjection, radius0 * 0.30) : hingeProjection;
      setPartPos(c.i, vec3Lerp(cur, target, hingeBias), cap, repairFactor);
    }
  }

  // Evaluate a swing cone in the CURRENT pose → { pp, axis(=cone centre), s(=outgoing
  // bone dir), ang(=current swing), allowed(=limit at this azimuth) }. The cone frame
  // is either body-referenced (hips: axis = pos[bIdx]−pos[aIdx]) or CARRIED (shoulders:
  // rest centre/fwd/lat rotated by the parent bone's swing). The elliptical limit
  // varies with azimuth (forward vs back vs side); a plain cone uses `half`.
  function coneEval(c) {
    const pp = parts[c.p].pos;
    let axis; let fwd = null; let lat = null;
    if (c.carry) {
      const t = unit(vec3Sub(parts[c.cp].pos, parts[c.cgp].pos));
      axis = unit(rotateBetween(c.t0, t, c.center0));
      fwd = unit(rotateBetween(c.t0, t, c.fwd0));
      lat = unit(rotateBetween(c.t0, t, c.lat0));
    } else {
      axis = unit(vec3Sub(parts[c.bIdx].pos, parts[c.aIdx].pos));
      if (c.lIdx != null) {
        lat = unit(vec3Sub(parts[c.rIdx].pos, parts[c.lIdx].pos));
        let f = vec3Cross(lat, axis);
        if (vlen(f) > 1e-6) { f = unit(f); fwd = vec3Scale(f, c.fwdSign); }
      }
    }
    const s = unit(vec3Sub(parts[c.child].pos, pp));
    const cosT = clamp(vec3Dot(s, axis), -1, 1);
    const ang = Math.acos(cosT);
    let allowed = c.half;
    if (fwd) {
      const perp = vec3Sub(s, vec3Scale(axis, cosT));
      const pl = vlen(perp);
      if (pl > 1e-6) {
        const fc = vec3Dot(perp, fwd) / pl; const lc = vec3Dot(perp, lat) / pl; // azimuth unit components
        const aMax = fc >= 0 ? c.maxFwd : c.maxBack;
        const inv = Math.sqrt((fc * fc) / (aMax * aMax) + (lc * lc) / (c.maxSide * c.maxSide));
        allowed = inv > 1e-6 ? 1 / inv : aMax;
      } else allowed = Math.max(c.maxFwd, c.maxBack, c.maxSide);
    }
    return { pp, axis, s, ang, allowed };
  }

  // If the outgoing bone leaves the cone, rotate it back to the boundary (move child).
  function applyConeLimits() {
    for (const c of coneCons) {
      if (pinned.has(c.child)) continue;
      const e = coneEval(c);
      if (e.ang <= e.allowed) continue;
      let perpAxis = vec3Cross(e.axis, e.s); if (vlen(perpAxis) < 1e-6) continue; perpAxis = unit(perpAxis);
      const dir = rotateAboutAxis(e.axis, perpAxis, e.allowed); // axis rotated toward s by `allowed`
      const cap = e.ang - e.allowed > 2 * D2R ? Math.max(angularProjection, radius0 * 0.15) : angularProjection;
      setPartPos(c.child, vec3Add(e.pp, vec3Scale(dir, c.len)), cap, repairFactor);
    }
  }

  // Read-only swing/limit per cone (degrees) for the debug HUD — same frame math.
  function coneStatus() {
    return coneCons.map((c) => { const e = coneEval(c); return { p: c.p, child: c.child, swingDeg: e.ang / D2R, limitDeg: e.allowed / D2R }; });
  }

  // Reset restores the bind pose and restarts warmup. It is used when a model is
  // reloaded or a ragdoll demo restarts, and it clears every telemetry counter.
  function reset() { simAge = 0; parts = bones.map((b) => ({ pos: [...b.position], prev: [...b.position] })); stepStats = { ...stepStats, substeps: 0, dt: 0, dtClamped: false, warmup: true, maxVelocity: 0, clampedVelocities: 0, postVelocityClamps: 0, maxProjection: 0, clampedProjections: 0, maxDisplacement: 0, clampedDisplacements: 0, boundsClamps: 0, nanRecoveries: 0, groundContacts: 0, clampBursts: 0, selfCollisions: 0 }; }

  // NaN recovery is a last-resort fuse: if browser math or bad imported data creates
  // invalid particle state, snap that particle back to bind pose instead of letting
  // one bad value poison the whole skeleton.
  function finitePart(i) {
    const p = parts[i];
    if (Number.isFinite(p.pos[0]) && Number.isFinite(p.pos[1]) && Number.isFinite(p.pos[2]) && Number.isFinite(p.prev[0]) && Number.isFinite(p.prev[1]) && Number.isFinite(p.prev[2])) return;
    const b = bind[i] || root0;
    p.pos[0] = b[0]; p.pos[1] = b[1]; p.pos[2] = b[2]; p.prev[0] = b[0]; p.prev[1] = b[1]; p.prev[2] = b[2];
    stepStats.nanRecoveries++;
  }

  // Verlet velocity is implicit: pos-prev. Whenever a constraint moves `pos`, this
  // shifts `prev` with it so projection corrections do not become artificial speed.
  function repairPrev(i, dx, dy, dz, factor) {
    if (pinned.has(i)) return;
    const p = parts[i];
    p.prev[0] += dx * factor; p.prev[1] += dy * factor; p.prev[2] += dz * factor;
  }

  function movePart(i, dx, dy, dz, cap = maxProjection, prevFactor = null) {
    if (pinned.has(i)) return;
    const l = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(l) || l <= 0) return;
    let s = 1;
    if (Number.isFinite(cap) && l > cap) { s = cap / l; stepStats.clampedProjections++; }
    const mx = dx * s; const my = dy * s; const mz = dz * s;
    const p = parts[i];
    p.pos[0] += mx; p.pos[1] += my; p.pos[2] += mz;
    stepStats.maxProjection = Math.max(stepStats.maxProjection, Math.hypot(mx, my, mz));
    repairPrev(i, mx, my, mz, prevFactor ?? (l > maxProjection * 0.5 ? repairFactor : repairFactor * 0.35));
  }

  function setPartPos(i, target, cap = maxProjection, prevFactor = null) {
    if (pinned.has(i)) return;
    const p = parts[i];
    movePart(i, target[0] - p.pos[0], target[1] - p.pos[1], target[2] - p.pos[2], cap, prevFactor);
  }

  function enforceGround() {
    if (ground == null) return;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.pos[1] >= ground) continue;
      const dy = ground - p.pos[1];
      p.pos[1] = ground;
      p.prev[1] = ground;
      p.prev[0] = p.pos[0] - (p.pos[0] - p.prev[0]) * (1 - friction);
      p.prev[2] = p.pos[2] - (p.pos[2] - p.prev[2]) * (1 - friction);
      stepStats.groundContacts++;
      if (dy > maxProjection * 0.5) stepStats.clampedProjections++;
    }
  }

  function enforceBounds() {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const dx = p.pos[0] - root0[0]; const dy = p.pos[1] - root0[1]; const dz = p.pos[2] - root0[2];
      const l = Math.hypot(dx, dy, dz);
      if (l <= boundsRadius || l <= 1e-9) continue;
      const s = boundsRadius / l;
      p.pos[0] = root0[0] + dx * s; p.pos[1] = root0[1] + dy * s; p.pos[2] = root0[2] + dz * s;
      p.prev[0] = p.pos[0]; p.prev[1] = p.pos[1]; p.prev[2] = p.pos[2];
      stepStats.boundsClamps++;
    }
  }

  function moveSegment(a, b, t, dx, dy, dz) {
    movePart(a, dx * (1 - t), dy * (1 - t), dz * (1 - t), selfCollisionProjection, repairFactor * 0.25);
    movePart(b, dx * t, dy * t, dz * t, selfCollisionProjection, repairFactor * 0.25);
  }

  // Segment collision runs after distance/angular solving, not inside every solve
  // iteration. That ordering prevents collision pushes from repeatedly fighting the
  // hinge/cone projectors in the same substep.
  function applySelfCollision() {
    if (!selfCollision) return;
    for (let it = 0; it < selfCollisionIterations; it++) for (const c of selfPairs) {
      const hit = closestSegments(parts[c.a0].pos, parts[c.a1].pos, parts[c.b0].pos, parts[c.b1].pos);
      const d = hit.dist || 1e-6;
      if (d >= c.min) continue;
      if ((noSelfCollisionBones.has(c.a0) || noSelfCollisionBones.has(c.a1)) && (noSelfCollisionBones.has(c.b0) || noSelfCollisionBones.has(c.b1))) continue;
      const nx = hit.delta[0] / d; const ny = hit.delta[1] / d; const nz = hit.delta[2] / d;
      const push = (c.min - d) * selfCollisionStrength;
      moveSegment(c.a0, c.a1, hit.s, -nx * push, -ny * push, -nz * push);
      moveSegment(c.b0, c.b1, hit.t, nx * push, ny * push, nz * push);
      stepStats.selfCollisions++;
    }
  }

  // PBD/Verlet re-derives velocity from the final position delta. This post-solve
  // clamp catches velocity that was created by constraint projection, not by the
  // integration step, matching the stabilizer used by the Life active-body system.
  function clampPostProjectionVelocity(dt) {
    for (let i = 0; i < parts.length; i++) {
      if (pinned.has(i)) continue;
      const p = parts[i];
      let vx = (p.pos[0] - p.prev[0]) / Math.max(dt, 1e-6);
      let vy = (p.pos[1] - p.prev[1]) / Math.max(dt, 1e-6);
      let vz = (p.pos[2] - p.prev[2]) / Math.max(dt, 1e-6);
      const vh = Math.hypot(vx, vz);
      let changed = false;
      if (vh > maxHorizontalVelocity && vh > 1e-6) { const s = maxHorizontalVelocity / vh; vx *= s; vz *= s; changed = true; }
      if (vy > maxVerticalVelocity) { vy = maxVerticalVelocity; changed = true; }
      else if (vy < -maxVerticalVelocity) { vy = -maxVerticalVelocity; changed = true; }
      if (!changed) continue;
      p.prev[0] = p.pos[0] - vx * dt; p.prev[1] = p.pos[1] - vy * dt; p.prev[2] = p.pos[2] - vz * dt;
      stepStats.postVelocityClamps++;
    }
  }

  // Global drag damps whole-body spin. It is applied to implicit velocity only and
  // does not move positions, so it removes tumbling energy without shrinking bones.
  // TIME-NORMALIZED: `globalDrag` means "fraction removed per 60Hz frame", scaled
  // by each substep's dt. The old code applied the raw constant once per SUBSTEP
  // (6 substeps × 60fps = 360 applications/sec → 0.988^360 ≈ 1.3% velocity
  // retained per second) which silently destroyed nearly all momentum and made
  // every fall play out in slow motion.
  function applyGlobalDrag(dt) {
    if (globalDrag <= 0) return;
    const keep = Math.pow(1 - globalDrag, dt * 60);
    for (let i = 0; i < parts.length; i++) {
      if (pinned.has(i)) continue;
      const p = parts[i];
      p.prev[0] = p.pos[0] - (p.pos[0] - p.prev[0]) * keep;
      p.prev[1] = p.pos[1] - (p.pos[1] - p.prev[1]) * keep;
      p.prev[2] = p.pos[2] - (p.pos[2] - p.prev[2]) * keep;
    }
  }

  function clampDisplacement() {
    for (let i = 0; i < parts.length; i++) {
      if (pinned.has(i)) continue;
      const p = parts[i];
      const dx = p.pos[0] - p.prev[0]; const dy = p.pos[1] - p.prev[1]; const dz = p.pos[2] - p.prev[2];
      const l = Math.hypot(dx, dy, dz);
      stepStats.maxDisplacement = Math.max(stepStats.maxDisplacement, l);
      if (l <= maxDisplacement || l <= 1e-9) continue;
      const s = maxDisplacement / l;
      p.prev[0] = p.pos[0] - dx * s; p.prev[1] = p.pos[1] - dy * s; p.prev[2] = p.pos[2] - dz * s;
      stepStats.clampedDisplacements++;
    }
  }

  // Final angular passes run after collision/bounds because those systems can push
  // a limb back onto a limit. This gives hinges/cones last authority over anatomy.
  function finalizeAngularLimits(passes = 3) {
    for (let i = 0; i < passes; i++) {
      applyAngleLimits();
      applyConeLimits();
      applyHingeLimits();
      applyHingeLimits();
      enforceGround();
    }
  }

  // If many clamps fire in one substep, the solver is fighting a bad pose. Quenching
  // discards most implicit velocity so the next frame starts from the corrected pose
  // instead of launching away from it.
  function quenchClampBurst(v0, p0) {
    const burst = (stepStats.clampedVelocities - v0) + (stepStats.clampedProjections - p0);
    if (burst < clampBurstLimit) return;
    for (let i = 0; i < parts.length; i++) {
      if (pinned.has(i)) continue;
      const p = parts[i];
      p.prev[0] = p.pos[0] - (p.pos[0] - p.prev[0]) * clampBurstDamping;
      p.prev[1] = p.pos[1] - (p.pos[1] - p.prev[1]) * clampBurstDamping;
      p.prev[2] = p.pos[2] - (p.pos[2] - p.prev[2]) * clampBurstDamping;
    }
    stepStats.clampBursts++;
  }

  // One substep: integrate Verlet positions, solve sticks and angular limits, then
  // apply outer safety systems in a stable order. Constraint order matters here.
  function substep(dt) {
    const gdt = dt * dt;
    const maxStepVel = maxVelocity * dt;
    const damp = Math.pow(activeDamping, dt * 60);
    for (let k = 0; k < parts.length; k++) {
      finitePart(k);
      const p = parts[k];
      if (pinned.has(k)) { p.prev[0] = p.pos[0]; p.prev[1] = p.pos[1]; p.prev[2] = p.pos[2]; continue; }
      let vx = (p.pos[0] - p.prev[0]) * damp;
      let vy = (p.pos[1] - p.prev[1]) * damp;
      let vz = (p.pos[2] - p.prev[2]) * damp;
      const vl = Math.hypot(vx, vy, vz);
      stepStats.maxVelocity = Math.max(stepStats.maxVelocity, vl / Math.max(dt, 1e-6));
      if (vl > maxStepVel && vl > 1e-9) { const s = (maxStepVel * velocityClampFactor) / vl; vx *= s; vy *= s; vz *= s; stepStats.clampedVelocities++; }
      p.prev[0] = p.pos[0]; p.prev[1] = p.pos[1]; p.prev[2] = p.pos[2];
      p.pos[0] += vx + gravity[0] * activeGravityScale * gdt; p.pos[1] += vy + gravity[1] * activeGravityScale * gdt; p.pos[2] += vz + gravity[2] * activeGravityScale * gdt;
    }
    enforceGround();
    const vClamps0 = stepStats.clampedVelocities;
    const pClamps0 = stepStats.clampedProjections;
    for (let it = 0; it < iterations; it++) {
      for (const c of cons) {
        const a = parts[c.i]; const b = parts[c.j];
        const dx = b.pos[0] - a.pos[0]; const dy = b.pos[1] - a.pos[1]; const dz = b.pos[2] - a.pos[2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const diff = ((d - c.rest) / d) * 0.5;
        const ap = pinned.has(c.i) ? 0 : (pinned.has(c.j) ? 1 : 0.5);
        const bp = pinned.has(c.j) ? 0 : (pinned.has(c.i) ? 1 : 0.5);
        movePart(c.i, dx * diff * (ap * 2), dy * diff * (ap * 2), dz * diff * (ap * 2));
        movePart(c.j, -dx * diff * (bp * 2), -dy * diff * (bp * 2), -dz * diff * (bp * 2));
      }
      applyAngleLimits();
      applyConeLimits();
      applyHingeLimits();
      applyHingeLimits();
      enforceGround();
    }
    finalizeAngularLimits(4);
    clampDisplacement();
    enforceBounds();
    applySelfCollision();
    enforceGround();
    finalizeAngularLimits(6);
    clampPostProjectionVelocity(dt);
    applyGlobalDrag(dt);
    quenchClampBurst(vClamps0, pClamps0);
  }

  // Public frame step. It caps frame time, selects warmup coefficients, clears live
  // telemetry, then executes enough substeps to keep each sub-dt below `maxSubDt`.
  function step(dt) {
    const raw = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const frameDt = Math.min(raw, maxFrameDt);
    const warmup = simAge < warmupTime;
    activeDamping = warmup ? warmupDamping : damping;
    activeGravityScale = warmup ? warmupGravityScale : 1;
    stepStats = { substeps: 0, dt: frameDt, dtClamped: raw !== frameDt, warmup, maxVelocity: 0, clampedVelocities: 0, postVelocityClamps: 0, maxProjection: 0, clampedProjections: 0, maxDisplacement: 0, clampedDisplacements: 0, boundsClamps: 0, nanRecoveries: 0, groundContacts: 0, clampBursts: 0, selfCollisions: 0 };
    if (frameDt <= 0) return;
    const n = Math.min(maxSubsteps, Math.max(substeps, Math.ceil(frameDt / maxSubDt)));
    const subDt = frameDt / n;
    stepStats.substeps = n;
    for (let i = 0; i < n; i++) substep(subDt);
    simAge += frameDt;
  }

  // Expose raw constraints and live stats so the importer demo can print exactly
  // which hinge/cone/ROM or stability fuse is active while debugging a model.
  return {
    step,
    reset,
    get particles() { return parts; },
    positions() { return parts.map((p) => p.pos); },
    constraints: cons,
    angleConstraints: angleCons,
    hingeConstraints: hingeCons,
    coneConstraints: coneCons,
    coneStatus,
    stats() { return { ...stepStats }; },
    config: { substeps, maxSubDt, maxSubsteps, maxFrameDt, maxVelocity, maxHorizontalVelocity, maxVerticalVelocity, velocityClampFactor, maxProjection, angularProjection, angularBias, hingeProjection, hingeBias, maxDisplacement, boundsRadius, clampBurstLimit, clampBurstDamping, selfCollision, selfCollisionScale, selfCollisionIterations, selfCollisionStrength, selfCollisionProjection, globalDrag, warmupTime, warmupDamping, warmupGravityScale },
  };
}
