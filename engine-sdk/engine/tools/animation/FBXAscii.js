// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { quatFromEulerDeg, quatMultiply, quatNormalize } from "../../core/math/MathQuat.js";
import { mat4MultiplyInto, mat4FromRotationTranslationScale } from "../../core/math/MathMat.js";
import { mat4Inverse } from "../../core/math/EngineMath.js";
import { lerp } from "../../core/math/MathScalar.js";

const FBX_TIME_UNIT = 46186158000;

function _countBraces(line) {
  let d = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 123) d++;
    else if (c === 125) d--;
  }
  return d;
}

function _parsePLine(line) {
  const m = line.match(/^P:\s*"([^"]+)",\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)",\s*(.*)$/);
  if (!m) return null;
  const name = m[1];
  const type = m[2];
  const valuePart = m[5].trim();
  const parts = valuePart.length ? valuePart.split(",").map((s) => s.trim()) : [];
  const nums = [];
  for (const p of parts) {
    if (!p.length) continue;
    const n = Number(p);
    if (Number.isFinite(n)) nums.push(n);
  }
  if (type === "KTime") {
    const n = Number(parts[0]);
    return { name, value: Number.isFinite(n) ? n : 0 };
  }
  if (type === "bool" || type === "enum" || type === "int" || type === "Integer" || type === "Number" || type === "double") {
    const n = Number(parts[0]);
    return { name, value: Number.isFinite(n) ? n : 0 };
  }
  if (type === "Vector3D" || type === "Lcl Translation" || type === "Lcl Rotation" || type === "Lcl Scaling" || type === "ColorRGB") {
    return { name, value: nums.slice(0, 3) };
  }
  return { name, value: parts.length === 1 ? parts[0] : parts };
}

function _parseArrayBlock(lines, startIndex) {
  let i = startIndex;
  let foundA = false;
  let depth = 0;
  const out = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    depth += _countBraces(line);
    const t = line.trim();
    if (!foundA) {
      const ai = t.indexOf("a:");
      if (ai !== -1) {
        foundA = true;
        const tail = t.slice(ai + 2).trim();
        if (tail.length) {
          for (const s of tail.split(",")) {
            const n = Number(s.trim());
            if (Number.isFinite(n)) out.push(n);
          }
        }
      }
    } else {
      if (t.startsWith("}") && depth <= 0) {
        break;
      }
      for (const s of t.split(",")) {
        const n = Number(s.trim());
        if (Number.isFinite(n)) out.push(n);
      }
    }
    if (foundA && depth <= 0 && t.startsWith("}")) break;
  }
  return { values: out, endIndex: i };
}

function _gatherObjectBlock(lines, startIndex) {
  const block = [];
  let depth = 0;
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    block.push(line);
    depth += _countBraces(line);
    if (i > startIndex && depth <= 0) return { block, endIndex: i };
  }
  return { block, endIndex: lines.length - 1 };
}

export function parseFBXAscii(text) {
  const lines = text.split(/\r?\n/);

  const models = new Map();
  const animStacks = new Map();
  const animLayers = new Map();
  const curveNodes = new Map();
  const curves = new Map();
  const connections = [];

  let unitScale = 1;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();

    if (t.startsWith("Model:")) {
      const m = t.match(/^Model:\s*(\d+),\s*"Model::([^"]+)",\s*"([^"]*)"/);
      if (!m) continue;
      const id = Number(m[1]);
      const name = m[2];
      const limbType = m[3];
      const { block, endIndex } = _gatherObjectBlock(lines, i);
      const props = new Map();
      for (let j = 0; j < block.length; j++) {
        const bt = block[j].trim();
        if (bt.startsWith("P:")) {
          const p = _parsePLine(bt);
          if (p) props.set(p.name, p.value);
        }
      }
      models.set(id, { id, name, limbType, props });
      i = endIndex;
      continue;
    }

    if (t.startsWith("AnimationStack:")) {
      const m = t.match(/^AnimationStack:\s*(\d+),\s*"AnimStack::([^"]+)",/);
      if (!m) continue;
      const id = Number(m[1]);
      const name = m[2];
      const { block, endIndex } = _gatherObjectBlock(lines, i);
      const props = new Map();
      for (const bl of block) {
        const bt = bl.trim();
        if (bt.startsWith("P:")) {
          const p = _parsePLine(bt);
          if (p) props.set(p.name, p.value);
        }
      }
      animStacks.set(id, { id, name, props });
      i = endIndex;
      continue;
    }

    if (t.startsWith("AnimationLayer:")) {
      const m = t.match(/^AnimationLayer:\s*(\d+),\s*"AnimLayer::([^"]+)",/);
      if (!m) continue;
      const id = Number(m[1]);
      const name = m[2];
      animLayers.set(id, { id, name });
      const { endIndex } = _gatherObjectBlock(lines, i);
      i = endIndex;
      continue;
    }

    if (t.startsWith("AnimationCurveNode:")) {
      const m = t.match(/^AnimationCurveNode:\s*(\d+),\s*"AnimCurveNode::([^"]*)",/);
      if (!m) continue;
      const id = Number(m[1]);
      const shortName = m[2];
      const { block, endIndex } = _gatherObjectBlock(lines, i);
      const props = new Map();
      for (const bl of block) {
        const bt = bl.trim();
        if (bt.startsWith("P:")) {
          const p = _parsePLine(bt);
          if (p) props.set(p.name, p.value);
        }
      }
      curveNodes.set(id, { id, shortName, props });
      i = endIndex;
      continue;
    }

    if (t.startsWith("AnimationCurve:")) {
      const m = t.match(/^AnimationCurve:\s*(\d+),/);
      if (!m) continue;
      const id = Number(m[1]);
      const { block, endIndex } = _gatherObjectBlock(lines, i);
      let keyTimes = null;
      let keyValues = null;
      for (let j = 0; j < block.length; j++) {
        const bt = block[j].trim();
        if (bt.startsWith("KeyTime:")) {
          const { values } = _parseArrayBlock(block, j);
          keyTimes = values;
        }
        if (bt.startsWith("KeyValueFloat:")) {
          const { values } = _parseArrayBlock(block, j);
          keyValues = values;
        }
      }
      curves.set(id, { id, keyTimes: keyTimes ?? [], keyValues: keyValues ?? [] });
      i = endIndex;
      continue;
    }

    if (t.startsWith("Connections:")) {
      const { block, endIndex } = _gatherObjectBlock(lines, i);
      for (const bl of block) {
        const bt = bl.trim();
        if (!bt.startsWith("C:")) continue;
        const m = bt.match(/^C:\s*"(OO|OP)",\s*(\d+),\s*(\d+)(?:,\s*"([^"]+)")?/);
        if (!m) continue;
        const kind = m[1];
        const from = Number(m[2]);
        const to = Number(m[3]);
        const prop = m[4] ?? null;
        connections.push({ kind, from, to, prop });
      }
      i = endIndex;
      continue;
    }

    if (unitScale === 1 && t.includes('P: "UnitScaleFactor"')) {
      const m = t.match(/P:\s*"UnitScaleFactor"[\s\S]*?,\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > 0) unitScale = n;
      }
      continue;
    }
  }

  return { models, animStacks, animLayers, curveNodes, curves, connections, unitScale };
}

function _rotationOrderToString(order) {
  switch (order | 0) {
    case 0:
      return "XYZ";
    case 1:
      return "XZY";
    case 2:
      return "YZX";
    case 3:
      return "YXZ";
    case 4:
      return "ZXY";
    case 5:
      return "ZYX";
    default:
      return "XYZ";
  }
}

function _evalCurveAt(curve, tKTime) {
  const times = curve.keyTimes;
  const vals = curve.keyValues;
  const n = Math.min(times.length, vals.length);
  if (n === 0) return 0;
  if (n === 1) return vals[0];

  if (tKTime <= times[0]) return vals[0];
  if (tKTime >= times[n - 1]) return vals[n - 1];

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= tKTime) lo = mid;
    else hi = mid;
  }

  const t0 = times[lo];
  const t1 = times[hi];
  const v0 = vals[lo];
  const v1 = vals[hi];
  const f = (tKTime - t0) / Math.max(1e-9, t1 - t0);
  return lerp(v0, v1, f);
}

function _buildConnectionMaps(fbx) {
  const parentOf = new Map();
  const childrenOf = new Map();

  const modelPropCurveNode = new Map();
  const curveNodeAxisCurve = new Map();
  const stackLayers = new Map();
  const layerCurveNodes = new Map();

  for (const c of fbx.connections) {
    if (c.kind === "OO") {
      parentOf.set(c.from, c.to);
      if (!childrenOf.has(c.to)) childrenOf.set(c.to, []);
      childrenOf.get(c.to).push(c.from);
      if (fbx.animStacks.has(c.to) && fbx.animLayers.has(c.from)) {
        if (!stackLayers.has(c.to)) stackLayers.set(c.to, []);
        stackLayers.get(c.to).push(c.from);
      }
      if (fbx.animLayers.has(c.to) && fbx.curveNodes.has(c.from)) {
        if (!layerCurveNodes.has(c.to)) layerCurveNodes.set(c.to, []);
        layerCurveNodes.get(c.to).push(c.from);
      }
      continue;
    }

    if (c.kind === "OP") {
      if (fbx.curveNodes.has(c.from) && fbx.models.has(c.to) && c.prop) {
        modelPropCurveNode.set(`${c.to}|${c.prop}`, c.from);
      }
      if (fbx.curves.has(c.from) && fbx.curveNodes.has(c.to) && c.prop) {
        curveNodeAxisCurve.set(`${c.to}|${c.prop}`, c.from);
      }
      continue;
    }
  }

  return { parentOf, childrenOf, modelPropCurveNode, curveNodeAxisCurve, stackLayers, layerCurveNodes };
}

export function buildMixamoSkeletonFromFBX(fbx, opts = {}) {
  const { rootName = "mixamorig:Hips" } = opts;
  const { parentOf, childrenOf } = _buildConnectionMaps(fbx);

  let rootId = null;
  for (const [id, m] of fbx.models) {
    if (m.name === rootName) {
      rootId = id;
      break;
    }
  }
  if (rootId === null) {
    for (const [id, m] of fbx.models) {
      const p = parentOf.get(id);
      if (p === 0 && m.limbType === "LimbNode") {
        rootId = id;
        break;
      }
    }
  }
  if (rootId === null) throw new Error("FBXAscii: could not find skeleton root");

  const jointIds = [];
  const jointIdToIndex = new Map();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    const m = fbx.models.get(id);
    if (!m) continue;
    if (m.limbType === "LimbNode") {
      jointIdToIndex.set(id, jointIds.length);
      jointIds.push(id);
    }
    const kids = childrenOf.get(id) || [];
    for (let k = kids.length - 1; k >= 0; k--) {
      const cid = kids[k];
      if (fbx.models.has(cid)) stack.push(cid);
    }
  }

  const nodes = [];
  for (const id of jointIds) {
    const m = fbx.models.get(id);
    const props = m.props;
    const t = props.get("Lcl Translation") ?? [0, 0, 0];
    const r = props.get("Lcl Rotation") ?? [0, 0, 0];
    const s = props.get("Lcl Scaling") ?? [1, 1, 1];
    const pre = props.get("PreRotation") ?? [0, 0, 0];
    const post = props.get("PostRotation") ?? [0, 0, 0];
    const rotOrder = props.get("RotationOrder") ?? 0;
    nodes.push({
      id,
      name: m.name,
      translation: [t[0], t[1], t[2]],
      rotationEulerDeg: [r[0], r[1], r[2]],
      scale: [s[0], s[1], s[2]],
      preRotationEulerDeg: [pre[0], pre[1], pre[2]],
      postRotationEulerDeg: [post[0], post[1], post[2]],
      rotationOrder: rotOrder,
      parent: null,
      children: [],
    });
  }

  for (let i = 0; i < nodes.length; i++) {
    const id = nodes[i].id;
    const pid = parentOf.get(id);
    if (pid === undefined || pid === null) continue;
    const pIndex = jointIdToIndex.get(pid);
    if (pIndex === undefined) continue;
    nodes[i].parent = pIndex;
    nodes[pIndex].children.push(i);
  }

  return { rootId, jointIds, jointIdToIndex, nodes };
}

export function sampleMixamoFBXAnimationClip(fbx, skeleton, opts = {}) {
  const { animStackName = "mixamo.com", fps = 60, lengthScale = 1 } = opts;
  const maps = _buildConnectionMaps(fbx);

  const allowedCurveNodes = new Set();

  let stackId = null;
  for (const [id, s] of fbx.animStacks) {
    if (s.name === animStackName) {
      stackId = id;
      break;
    }
  }
  if (stackId === null) {
    for (const [id] of fbx.animStacks) {
      stackId = id;
      break;
    }
  }
  if (stackId === null) throw new Error("FBXAscii: no AnimationStack found");

  const layerIds = maps.stackLayers.get(stackId) || [];
  for (const lid of layerIds) {
    const cns = maps.layerCurveNodes.get(lid) || [];
    for (const cn of cns) allowedCurveNodes.add(cn);
  }

  const stack = fbx.animStacks.get(stackId);
  const localStop = stack?.props?.get("LocalStop") ?? 0;
  let durationK = localStop;
  if (!(durationK > 0)) {
    for (const c of fbx.curves.values()) {
      const n = c.keyTimes.length;
      if (n) durationK = Math.max(durationK, c.keyTimes[n - 1]);
    }
  }
  if (!(durationK > 0)) durationK = 0;

  const durationSec = durationK / FBX_TIME_UNIT;
  const frameCount = Math.max(1, Math.floor(durationSec * fps + 0.5) + 1);

  const jointCount = skeleton.nodes.length;
  const translations = new Float32Array(frameCount * jointCount * 3);
  const rotations = new Float32Array(frameCount * jointCount * 4);

  const preQ = new Array(jointCount);
  const postQ = new Array(jointCount);
  const orderStr = new Array(jointCount);
  const baseT = new Array(jointCount);

  for (let j = 0; j < jointCount; j++) {
    const n = skeleton.nodes[j];
    orderStr[j] = _rotationOrderToString(n.rotationOrder);
    preQ[j] = quatFromEulerDeg(n.preRotationEulerDeg[0], n.preRotationEulerDeg[1], n.preRotationEulerDeg[2], "XYZ");
    postQ[j] = quatFromEulerDeg(n.postRotationEulerDeg[0], n.postRotationEulerDeg[1], n.postRotationEulerDeg[2], "XYZ");
    baseT[j] = n.translation;
  }

  for (let f = 0; f < frameCount; f++) {
    const tSec = fps > 0 ? f / fps : 0;
    const tK = tSec * FBX_TIME_UNIT;

    for (let j = 0; j < jointCount; j++) {
      const jointId = skeleton.jointIds[j];

      let tx = baseT[j][0];
      let ty = baseT[j][1];
      let tz = baseT[j][2];

      const tNodeId = maps.modelPropCurveNode.get(`${jointId}|Lcl Translation`);
      if (tNodeId !== undefined && (allowedCurveNodes.size === 0 || allowedCurveNodes.has(tNodeId))) {
        const cx = maps.curveNodeAxisCurve.get(`${tNodeId}|d|X`);
        const cy = maps.curveNodeAxisCurve.get(`${tNodeId}|d|Y`);
        const cz = maps.curveNodeAxisCurve.get(`${tNodeId}|d|Z`);
        if (cx !== undefined) tx = _evalCurveAt(fbx.curves.get(cx), tK);
        if (cy !== undefined) ty = _evalCurveAt(fbx.curves.get(cy), tK);
        if (cz !== undefined) tz = _evalCurveAt(fbx.curves.get(cz), tK);
      }

      const baseTi = (f * jointCount + j) * 3;
      translations[baseTi + 0] = tx * lengthScale;
      translations[baseTi + 1] = ty * lengthScale;
      translations[baseTi + 2] = tz * lengthScale;

      let rx = skeleton.nodes[j].rotationEulerDeg[0];
      let ry = skeleton.nodes[j].rotationEulerDeg[1];
      let rz = skeleton.nodes[j].rotationEulerDeg[2];

      const rNodeId = maps.modelPropCurveNode.get(`${jointId}|Lcl Rotation`);
      if (rNodeId !== undefined && (allowedCurveNodes.size === 0 || allowedCurveNodes.has(rNodeId))) {
        const cx = maps.curveNodeAxisCurve.get(`${rNodeId}|d|X`);
        const cy = maps.curveNodeAxisCurve.get(`${rNodeId}|d|Y`);
        const cz = maps.curveNodeAxisCurve.get(`${rNodeId}|d|Z`);
        if (cx !== undefined) rx = _evalCurveAt(fbx.curves.get(cx), tK);
        if (cy !== undefined) ry = _evalCurveAt(fbx.curves.get(cy), tK);
        if (cz !== undefined) rz = _evalCurveAt(fbx.curves.get(cz), tK);
      }

      const rotQ = quatFromEulerDeg(rx, ry, rz, orderStr[j]);
      const q = quatNormalize(quatMultiply(quatMultiply(preQ[j], rotQ), postQ[j]));
      const baseRi = (f * jointCount + j) * 4;
      rotations[baseRi + 0] = q[0];
      rotations[baseRi + 1] = q[1];
      rotations[baseRi + 2] = q[2];
      rotations[baseRi + 3] = q[3];
    }
  }

  return {
    name: stack.name,
    fps,
    durationSec,
    frameCount,
    jointCount,
    jointNames: skeleton.nodes.map((n) => n.name),
    parentIndices: Int16Array.from(skeleton.nodes.map((n) => (n.parent === null ? -1 : n.parent))),
    translations,
    rotations,
    lengthScale,
    unitScaleFactor: fbx.unitScale,
  };
}

 function _copyMat16(out, outOffset, m) {
  out[outOffset + 0] = m[0];
  out[outOffset + 1] = m[1];
  out[outOffset + 2] = m[2];
  out[outOffset + 3] = m[3];
  out[outOffset + 4] = m[4];
  out[outOffset + 5] = m[5];
  out[outOffset + 6] = m[6];
  out[outOffset + 7] = m[7];
  out[outOffset + 8] = m[8];
  out[outOffset + 9] = m[9];
  out[outOffset + 10] = m[10];
  out[outOffset + 11] = m[11];
  out[outOffset + 12] = m[12];
  out[outOffset + 13] = m[13];
  out[outOffset + 14] = m[14];
  out[outOffset + 15] = m[15];
 }

 export function findSkeletonJointIndexByName(skeleton, jointName) {
  if (!skeleton?.nodes?.length) return -1;
  for (let i = 0; i < skeleton.nodes.length; i++) {
    if (skeleton.nodes[i].name === jointName) return i;
  }
  return -1;
 }

 export function computeClipLocalMatricesAtFrame(clip, skeleton, frameIndex, out = null) {
  const jointCount = clip.jointCount | 0;
  const frameCount = clip.frameCount | 0;
  const fi = Math.max(0, Math.min(frameCount - 1, frameIndex | 0));
  if (!out) out = new Float32Array(jointCount * 16);
  if (out.length < jointCount * 16) throw new Error("FBXAscii: out buffer too small");
  if (!skeleton?.nodes || skeleton.nodes.length !== jointCount) throw new Error("FBXAscii: skeleton/clip jointCount mismatch");

  for (let j = 0; j < jointCount; j++) {
    const ti = (fi * jointCount + j) * 3;
    const ri = (fi * jointCount + j) * 4;
    const t = [clip.translations[ti + 0], clip.translations[ti + 1], clip.translations[ti + 2]];
    const q = [clip.rotations[ri + 0], clip.rotations[ri + 1], clip.rotations[ri + 2], clip.rotations[ri + 3]];
    const s = skeleton.nodes[j].scale ?? [1, 1, 1];
    const m = mat4FromRotationTranslationScale(q, t, s);
    _copyMat16(out, j * 16, m);
  }

  return out;
 }

 export function computeClipGlobalMatricesAtFrame(clip, skeleton, frameIndex, out = null) {
  const jointCount = clip.jointCount | 0;
  const frameCount = clip.frameCount | 0;
  const fi = Math.max(0, Math.min(frameCount - 1, frameIndex | 0));
  if (!out) out = new Float32Array(jointCount * 16);
  if (out.length < jointCount * 16) throw new Error("FBXAscii: out buffer too small");
  if (!skeleton?.nodes || skeleton.nodes.length !== jointCount) throw new Error("FBXAscii: skeleton/clip jointCount mismatch");

  computeClipLocalMatricesAtFrame(clip, skeleton, fi, out);
  const tmp = new Float32Array(16);

  for (let j = 0; j < jointCount; j++) {
    const parent = skeleton.nodes[j].parent;
    if (parent === null || parent === undefined || parent < 0) continue;
    const parentOff = parent * 16;
    const localOff = j * 16;
    mat4MultiplyInto(tmp, out.subarray(parentOff, parentOff + 16), out.subarray(localOff, localOff + 16));
    _copyMat16(out, localOff, tmp);
  }

  return out;
 }

 export function extractRootTranslationTrack(clip, skeleton, opts = {}) {
  const { rootJointName = "mixamorig:Hips" } = opts;
  const rootIndex = findSkeletonJointIndexByName(skeleton, rootJointName);
  if (rootIndex < 0) throw new Error("FBXAscii: root joint not found");
  const frameCount = clip.frameCount | 0;
  const jointCount = clip.jointCount | 0;
  const out = new Float32Array(frameCount * 3);
  for (let f = 0; f < frameCount; f++) {
    const ti = (f * jointCount + rootIndex) * 3;
    out[f * 3 + 0] = clip.translations[ti + 0];
    out[f * 3 + 1] = clip.translations[ti + 1];
    out[f * 3 + 2] = clip.translations[ti + 2];
  }
  return out;
}

export function extractRootMotion(clip, skeleton, opts = {}) {
  const { rootJointName = "mixamorig:Hips" } = opts;
  const rootIndex = findSkeletonJointIndexByName(skeleton, rootJointName);
  if (rootIndex < 0) throw new Error("FBXAscii: root joint not found");
  const frameCount = clip.frameCount | 0;
  const jointCount = clip.jointCount | 0;

  const positions = new Float32Array(frameCount * 3);
  const deltas = new Float32Array(frameCount * 3);
  const relativePositions = new Float32Array(frameCount * 3);

  let p0x = 0;
  let p0y = 0;
  let p0z = 0;
  let prevX = 0;
  let prevY = 0;
  let prevZ = 0;

  for (let f = 0; f < frameCount; f++) {
    const ti = (f * jointCount + rootIndex) * 3;
    const x = clip.translations[ti + 0];
    const y = clip.translations[ti + 1];
    const z = clip.translations[ti + 2];

    positions[f * 3 + 0] = x;
    positions[f * 3 + 1] = y;
    positions[f * 3 + 2] = z;

    if (f === 0) {
      p0x = x;
      p0y = y;
      p0z = z;
      prevX = x;
      prevY = y;
      prevZ = z;
      deltas[0] = 0;
      deltas[1] = 0;
      deltas[2] = 0;
    } else {
      deltas[f * 3 + 0] = x - prevX;
      deltas[f * 3 + 1] = y - prevY;
      deltas[f * 3 + 2] = z - prevZ;
      prevX = x;
      prevY = y;
      prevZ = z;
    }

    relativePositions[f * 3 + 0] = x - p0x;
    relativePositions[f * 3 + 1] = y - p0y;
    relativePositions[f * 3 + 2] = z - p0z;
  }

  return { rootIndex, rootJointName, positions, deltas, relativePositions };
}

export function buildTeacherJointPositionDataset(clip, skeleton, opts = {}) {
  const {
    rootJointName = "mixamorig:Hips",
    space = "root",
    includeVelocities = false,
    jointNames = null,
  } = opts;

  const frameCount = clip.frameCount | 0;
  const fps = clip.fps || 60;
  const dt = fps > 0 ? 1 / fps : 0;

  const allJointCount = clip.jointCount | 0;
  if (!skeleton?.nodes || skeleton.nodes.length !== allJointCount) {
    throw new Error("FBXAscii: skeleton/clip jointCount mismatch");
  }

  let jointIndices = null;
  if (Array.isArray(jointNames) && jointNames.length) {
    jointIndices = new Int16Array(jointNames.length);
    for (let i = 0; i < jointNames.length; i++) {
      const idx = findSkeletonJointIndexByName(skeleton, jointNames[i]);
      if (idx < 0) throw new Error(`FBXAscii: joint not found: ${jointNames[i]}`);
      jointIndices[i] = idx;
    }
  } else {
    jointIndices = new Int16Array(allJointCount);
    for (let i = 0; i < allJointCount; i++) jointIndices[i] = i;
  }

  const jointCount = jointIndices.length;
  const positions = new Float32Array(frameCount * jointCount * 3);
  const velocities = includeVelocities ? new Float32Array(frameCount * jointCount * 3) : null;

  const globals = new Float32Array(allJointCount * 16);
  const rootInv = new Float32Array(16);
  const tmp = new Float32Array(16);

  const rootIndex = findSkeletonJointIndexByName(skeleton, rootJointName);
  if (space === "root" && rootIndex < 0) throw new Error("FBXAscii: root joint not found");

  for (let f = 0; f < frameCount; f++) {
    computeClipGlobalMatricesAtFrame(clip, skeleton, f, globals);

    if (space === "root") {
      const rm = globals.subarray(rootIndex * 16, rootIndex * 16 + 16);
      const inv = mat4Inverse(rm);
      for (let k = 0; k < 16; k++) rootInv[k] = inv[k];
    }

    for (let ji = 0; ji < jointCount; ji++) {
      const j = jointIndices[ji];
      const m = globals.subarray(j * 16, j * 16 + 16);

      let px = m[12];
      let py = m[13];
      let pz = m[14];

      if (space === "root") {
        mat4MultiplyInto(tmp, rootInv, m);
        px = tmp[12];
        py = tmp[13];
        pz = tmp[14];
      }

      const outI = (f * jointCount + ji) * 3;
      positions[outI + 0] = px;
      positions[outI + 1] = py;
      positions[outI + 2] = pz;

      if (velocities) {
        if (f === 0 || dt === 0) {
          velocities[outI + 0] = 0;
          velocities[outI + 1] = 0;
          velocities[outI + 2] = 0;
        } else {
          const prevI = ((f - 1) * jointCount + ji) * 3;
          velocities[outI + 0] = (px - positions[prevI + 0]) / dt;
          velocities[outI + 1] = (py - positions[prevI + 1]) / dt;
          velocities[outI + 2] = (pz - positions[prevI + 2]) / dt;
        }
      }
    }
  }

  return {
    fps,
    dt,
    frameCount,
    space,
    rootJointName,
    rootIndex,
    jointNames: Array.isArray(jointNames) && jointNames.length ? jointNames.slice() : clip.jointNames,
    jointIndices,
    positions,
    velocities,
  };
}

export function loadMixamoFBXAscii(text, opts = {}) {
  const fbx = parseFBXAscii(text);
  const skeleton = buildMixamoSkeletonFromFBX(fbx, opts);
  const clip = sampleMixamoFBXAnimationClip(fbx, skeleton, opts);
  return { fbx, skeleton, clip };
}
