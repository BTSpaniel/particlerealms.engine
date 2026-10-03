// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/workstation/WorkstationState.js — CRDT-backed group workstation
// surface (network plan §18/§19: shared desktop layout, app registry,
// folders, agents — distinct from any member's personal desktop).
//
// Reuses the Causal State Engine's approved CRDT types (ORSet for
// pinned-apps/folders/agents membership, LWWRegister for per-window layout
// and wallpaper) unmodified: every mutation returns a NEW state object
// (non-mutating join algebra), so replicas that exchange state in any order
// converge without coordination.

import { ORSet, LWWRegister } from '../../state/consistency/CRDT.js';

/** Create an empty workstation CRDT state. */
export function createWorkstationState() {
  return {
    pinnedApps: new ORSet(),
    folders: new ORSet(),
    agents: new ORSet(),
    windowLayout: new Map(), // windowId -> LWWRegister(layoutObject)
    wallpaper: new LWWRegister(null, 0, ''),
  };
}

export function pinApp(state, appId) { return { ...state, pinnedApps: state.pinnedApps.add(appId) }; }
export function unpinApp(state, appId) { return { ...state, pinnedApps: state.pinnedApps.remove(appId) }; }
export function addFolder(state, folderId) { return { ...state, folders: state.folders.add(folderId) }; }
export function removeFolder(state, folderId) { return { ...state, folders: state.folders.remove(folderId) }; }
export function addAgent(state, agentId) { return { ...state, agents: state.agents.add(agentId) }; }
export function removeAgent(state, agentId) { return { ...state, agents: state.agents.remove(agentId) }; }

/** Set a window's layout (LWW: highest (ts, node) wins on merge). */
export function setWindowLayout(state, windowId, layout, ts, node = '') {
  const next = new Map(state.windowLayout);
  const existing = next.get(windowId) || new LWWRegister(null, 0, '');
  next.set(windowId, existing.set(layout, ts, node));
  return { ...state, windowLayout: next };
}

export function getWindowLayout(state, windowId) {
  return state.windowLayout.get(windowId)?.value() ?? null;
}

export function setWallpaper(state, wallpaper, ts, node = '') {
  return { ...state, wallpaper: state.wallpaper.set(wallpaper, ts, node) };
}

/** Join two workstation states (CRDT merge — order-independent, convergent). */
export function mergeWorkstationState(a, b) {
  const windowLayout = new Map(a.windowLayout);
  for (const [id, reg] of b.windowLayout) {
    const existing = windowLayout.get(id);
    windowLayout.set(id, existing ? existing.merge(reg) : reg);
  }
  return {
    pinnedApps: a.pinnedApps.merge(b.pinnedApps),
    folders: a.folders.merge(b.folders),
    agents: a.agents.merge(b.agents),
    windowLayout,
    wallpaper: a.wallpaper.merge(b.wallpaper),
  };
}

/** Plain, JSON-serializable snapshot (for hashing/checkpointing/transport). */
export function snapshotWorkstationState(state) {
  return {
    pinnedApps: state.pinnedApps.value(),
    folders: state.folders.value(),
    agents: state.agents.value(),
    windowLayout: Object.fromEntries([...state.windowLayout.entries()].map(([id, reg]) => [id, reg.value()])),
    wallpaper: state.wallpaper.value(),
  };
}
