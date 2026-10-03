// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/material/SurfaceBinding.js — bind materials to surfaces (spec §7).
//
// Material assignment happens at the primitive/submesh level, not per-image. A
// SurfaceBinding records exactly which node/mesh/primitive a material covers,
// which UV set it uses, and (when known) the semantic part — so segmentation and
// editing can target real surfaces and bindings survive non-destructive splits.

/**
 * Build surface bindings for a model (material ↔ primitive). Populates
 * model.surfaceBindings and returns them.
 * @returns {object[]}
 */
export function buildSurfaceBindings(model) {
  // mesh id → first node that draws it (for the semantic part + node id)
  const nodeByMesh = new Map();
  for (const n of model.nodes || []) if (n.mesh && !nodeByMesh.has(n.mesh)) nodeByMesh.set(n.mesh, n);
  const partByNode = new Map((model.detectedParts || []).map((p) => [p.nodeId, p]));

  const bindings = [];
  for (const prim of model.primitives || []) {
    const node = nodeByMesh.get(prim.mesh) || null;
    const mat = prim.material ? (model.materials || []).find((m) => m.id === prim.material) : null;
    const uvSet = mat?.textures?.baseColor?.uvSet ?? 0;
    const part = node ? partByNode.get(node.id) : null;
    bindings.push({
      nodeId: node?.id ?? null,
      meshId: prim.mesh,
      primitiveId: prim.id,
      materialId: prim.material ?? null,
      uvSet,
      indexRange: prim.indices ? [0, prim.indices.length] : null,
      semanticPart: part ? `${part.kind}${part.side ? ':' + part.side : ''}` : null,
    });
  }
  model.surfaceBindings = bindings;
  return bindings;
}
