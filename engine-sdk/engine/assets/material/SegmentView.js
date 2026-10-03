// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/material/SegmentView.js — non-destructive segmentation (spec §8).
//
// We need modular breaking (swap tires, detach doors, tint glass, split a
// magazine) WITHOUT destroying the source. A SegmentView references original
// primitive ids / index ranges / materials — it never copies or rewrites
// geometry. A physical split is only baked later, on export or when a detachable
// part is actually created. This keeps skeletons, UVs, and morph targets intact.

export const SEGMENT_MODE = Object.freeze({
  NODE: 'node', MESH: 'mesh', PRIMITIVE: 'primitive', MATERIAL: 'material',
  COMPONENT: 'component', SEMANTIC: 'semantic',
});

/**
 * Create a non-destructive segment view of a model.
 * @param {object} model EngineModel
 * @param {string} mode  one of SEGMENT_MODE
 * @returns {{ mode:string, baked:false, segments:Array<{key:string, label:string, primitiveIds:string[], materialId?:string, nodeId?:string}> }}
 */
export function createSegmentView(model, mode = SEGMENT_MODE.MATERIAL) {
  const groups = new Map();
  const add = (key, label, primId, extra = {}) => {
    if (!groups.has(key)) groups.set(key, { key, label, primitiveIds: [], ...extra });
    groups.get(key).primitiveIds.push(primId);
  };

  const nodeByMesh = new Map();
  for (const n of model.nodes || []) if (n.mesh && !nodeByMesh.has(n.mesh)) nodeByMesh.set(n.mesh, n);
  const partByNode = new Map((model.detectedParts || []).map((p) => [p.nodeId, p]));

  for (const prim of model.primitives || []) {
    switch (mode) {
      case SEGMENT_MODE.PRIMITIVE:
        add(prim.id, prim.id, prim.id); break;
      case SEGMENT_MODE.MESH:
        add(prim.mesh, prim.mesh, prim.id); break;
      case SEGMENT_MODE.MATERIAL: {
        const key = prim.material || '__unbound__';
        const mat = (model.materials || []).find((m) => m.id === prim.material);
        add(key, mat?.name || key, prim.id, { materialId: prim.material ?? null }); break;
      }
      case SEGMENT_MODE.NODE: {
        const node = nodeByMesh.get(prim.mesh);
        const key = node?.id || '__detached__';
        add(key, node?.name || key, prim.id, { nodeId: node?.id ?? null }); break;
      }
      case SEGMENT_MODE.SEMANTIC: {
        const node = nodeByMesh.get(prim.mesh);
        const part = node ? partByNode.get(node.id) : null;
        const key = part ? `${part.kind}${part.side ? ':' + part.side : ''}` : '__unclassified__';
        add(key, key, prim.id, { nodeId: node?.id ?? null }); break;
      }
      case SEGMENT_MODE.COMPONENT:
        add(prim.id, `${prim.id} (component)`, prim.id); break; // connected-component split is a Phase 3 geometry pass
      default:
        add(prim.id, prim.id, prim.id);
    }
  }

  return { mode, baked: false, segments: [...groups.values()] };
}

/**
 * Bake a single segment into a standalone EngineModel-like payload (only when a
 * detachable part is actually needed — e.g. export). Geometry is copied here,
 * the source model is left untouched.
 */
export function bakeSegment(model, segmentView, segmentKey) {
  const seg = segmentView.segments.find((s) => s.key === segmentKey);
  if (!seg) throw new Error(`bakeSegment: unknown segment '${segmentKey}'`);
  const primitives = seg.primitiveIds.map((id) => model.primitives.find((p) => p.id === id)).filter(Boolean);
  return { source: model.id, key: segmentKey, label: seg.label, baked: true, primitives };
}
