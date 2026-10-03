// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { positiveSafeEntityHandleReport } from "../../ecs/world/World.js";

export function createBlackboard(initial = {}) {
  const data = {};
  if (initial && typeof initial === "object") {
    const keys = Object.keys(initial);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      data[key] = initial[key];
    }
  }
  return { data };
}

export function getBlackboardValue(blackboard, key, defaultValue) {
  if (!blackboard || !blackboard.data || typeof key !== "string") {
    return defaultValue;
  }
  if (Object.prototype.hasOwnProperty.call(blackboard.data, key)) {
    return blackboard.data[key];
  }
  return defaultValue;
}

export function setBlackboardValue(blackboard, key, value) {
  if (!blackboard || !blackboard.data || typeof key !== "string") {
    return;
  }
  blackboard.data[key] = value;
}

export function removeBlackboardValue(blackboard, key) {
  if (!blackboard || !blackboard.data || typeof key !== "string") {
    return;
  }
  if (Object.prototype.hasOwnProperty.call(blackboard.data, key)) {
    delete blackboard.data[key];
  }
}

export function clearBlackboard(blackboard) {
  if (!blackboard || !blackboard.data) {
    return;
  }
  const keys = Object.keys(blackboard.data);
  for (let i = 0; i < keys.length; i++) {
    delete blackboard.data[keys[i]];
  }
}

export function exportBlackboard(blackboard) {
  if (!blackboard || !blackboard.data) {
    return {};
  }
  const out = {};
  const keys = Object.keys(blackboard.data);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    out[key] = blackboard.data[key];
  }
  return out;
}

export function createBlackboardRegistry() {
  const boards = new Map();

  function get(entityId) {
    const entity = positiveSafeEntityHandleReport(entityId);
    if (!entity.valid) return null;
    const id = entity.value;
    let bb = boards.get(id) || null;
    if (!bb) {
      bb = createBlackboard();
      boards.set(id, bb);
    }
    return bb;
  }

  function has(entityId) {
    const entity = positiveSafeEntityHandleReport(entityId);
    return entity.valid && boards.has(entity.value);
  }

  function deleteBoard(entityId) {
    const entity = positiveSafeEntityHandleReport(entityId);
    return entity.valid ? boards.delete(entity.value) : false;
  }

  function clear() {
    boards.clear();
  }

  function exportAll() {
    const out = {};
    for (const [id, bb] of boards.entries()) {
      out[id] = exportBlackboard(bb);
    }
    return out;
  }

  return {
    get,
    has,
    delete: deleteBoard,
    clear,
    exportAll,
  };
}
