// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { mat4Identity, mat4Translate, mat4Scale } from "../../core/math/EngineMath.js";

export function getGhostPreviewInfo(params) {
  if (!params) {
    return null;
  }
  const position = params.position;
  if (!Array.isArray(position) || position.length < 3) {
    return null;
  }

  const type = params.spawnType || "cube";
  const cubeMesh = params.cubeMesh || null;
  const sphereMesh = params.sphereMesh || null;
  const planeMesh = params.planeMesh || null;
  const cylinderMesh = params.cylinderMesh || null;

  let model = mat4Translate(
    mat4Identity(),
    position[0],
    position[1],
    position[2],
  );

  let mesh = cubeMesh;
  if (type === "sphere" && sphereMesh) {
    mesh = sphereMesh;
  } else if (type === "plane" && planeMesh) {
    mesh = planeMesh;
  } else if ((type === "cylinder" || type === "pillar") && cylinderMesh) {
    mesh = cylinderMesh;
  }

  if (!mesh) {
    return null;
  }

  let scale = params.previewScale;
  if (!Array.isArray(scale) || scale.length < 3) {
    scale = [1, 1, 1];
  }
  model = mat4Scale(model, scale[0], scale[1], scale[2]);

  let color = params.previewColor;
  if (!Array.isArray(color) || color.length < 3) {
    color = [0.6, 0.9, 1.6];
  }

  const alpha = typeof params.previewAlpha === "number" ? params.previewAlpha : 0.5;

  return { model, mesh, color, alpha };
}

export function createGhostSelectionState() {
  return {
    ghosts: [],
    activeGhostId: null,
    nextGhostId: 1,
  };
}

function findGhostIndexById(selection, id) {
  if (!selection || !Array.isArray(selection.ghosts)) {
    return -1;
  }
  const list = selection.ghosts;
  for (let i = 0; i < list.length; i++) {
    const g = list[i];
    if (g && g.id === id) {
      return i;
    }
  }
  return -1;
}

function ensureActiveGhost(selection) {
  if (!selection) {
    return null;
  }
  if (!Array.isArray(selection.ghosts)) {
    selection.ghosts = [];
  }
  const list = selection.ghosts;
  let id = selection.activeGhostId;
  if (id != null) {
    const idx = findGhostIndexById(selection, id);
    if (idx >= 0) {
      return list[idx];
    }
  }
  const nextId = typeof selection.nextGhostId === "number" && selection.nextGhostId > 0
    ? selection.nextGhostId | 0
    : 1;
  selection.nextGhostId = nextId + 1;
  const ghost = {
    id: nextId,
    basePosition: null,
    offset: [0, 0, 0],
    type: "cube",
  };
  list.push(ghost);
  selection.activeGhostId = nextId;
  return ghost;
}

export function addGhostToSelection(selection, options) {
  const state = selection;
  if (!state) {
    return null;
  }
  const nextId = typeof state.nextGhostId === "number" && state.nextGhostId > 0
    ? state.nextGhostId | 0
    : 1;
  state.nextGhostId = nextId + 1;
  let basePosition = null;
  if (options && Array.isArray(options.basePosition) && options.basePosition.length >= 3) {
    basePosition = [options.basePosition[0], options.basePosition[1], options.basePosition[2]];
  }
  let offset = [0, 0, 0];
  if (options && Array.isArray(options.offset) && options.offset.length >= 3) {
    offset = [options.offset[0], options.offset[1], options.offset[2]];
  }
  const type = options && typeof options.type === "string" ? options.type : "cube";
  if (!Array.isArray(state.ghosts)) {
    state.ghosts = [];
  }
  const ghost = {
    id: nextId,
    basePosition,
    offset,
    type,
  };
  state.ghosts.push(ghost);
  if (state.activeGhostId == null) {
    state.activeGhostId = nextId;
  }
  return ghost;
}

export function setActiveGhostInSelection(selection, id) {
  if (!selection) {
    return;
  }
  const idx = findGhostIndexById(selection, id);
  if (idx < 0) {
    return;
  }
  selection.activeGhostId = id;
}

export function setActiveGhostBasePosition(selection, position, type) {
  if (!selection) {
    return;
  }
  if (!Array.isArray(position) || position.length < 3) {
    return;
  }
  const ghost = ensureActiveGhost(selection);
  if (!ghost) {
    return;
  }
  ghost.basePosition = [position[0], position[1], position[2]];
  ghost.offset = [0, 0, 0];
  if (typeof type === "string" && type.length > 0) {
    ghost.type = type;
  }
}

export function setActiveGhostOffset(selection, offset) {
  if (!selection) {
    return;
  }
  if (!Array.isArray(offset) || offset.length < 3) {
    return;
  }
  const ghost = ensureActiveGhost(selection);
  if (!ghost) {
    return;
  }
  ghost.offset = [offset[0], offset[1], offset[2]];
}

export function getGhostWorldPosition(ghost) {
  if (!ghost) {
    return null;
  }
  const base = ghost.basePosition;
  const off = ghost.offset;
  if (!Array.isArray(base) || base.length < 3) {
    return null;
  }
  const dx = Array.isArray(off) && off.length >= 3 ? off[0] : 0;
  const dy = Array.isArray(off) && off.length >= 3 ? off[1] : 0;
  const dz = Array.isArray(off) && off.length >= 3 ? off[2] : 0;
  return [base[0] + dx, base[1] + dy, base[2] + dz];
}

export function getActiveGhost(selection) {
  if (!selection || !Array.isArray(selection.ghosts)) {
    return null;
  }
  const id = selection.activeGhostId;
  if (id == null) {
    return null;
  }
  const idx = findGhostIndexById(selection, id);
  if (idx < 0) {
    return null;
  }
  return selection.ghosts[idx] || null;
}

export function getActiveGhostWorldPosition(selection) {
  const ghost = getActiveGhost(selection);
  if (!ghost) {
    return null;
  }
  return getGhostWorldPosition(ghost);
}
