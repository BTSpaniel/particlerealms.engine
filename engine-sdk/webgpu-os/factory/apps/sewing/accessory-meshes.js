// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { createPhysicalContourMesh } from '../../components/mesh/contourMesh.js';
import { vectorModelBounds } from '../../components/drawing/index.js';
import { inspectAccessoryDraft } from './accessory-generators.js';

const fail = (code, message) => Object.assign(new Error(message), { code });

/** Authored accessory outlines and sewing references, with no invented assembly.
 * Copies remain separate cutting identities; the editable flat source is never
 * replaced by a rectangular stand-in or by a simulated position.
 */
export function createAccessoryPatternMeshes(draft, { sourceRevision = draft.sourceRevision || draft.id, toleranceMm = .002, maxBoundarySegmentMm = 25, maxTriangleAreaMm2 = 2500, signal } = {}) {
  const deadline = performance.now() + 30000;
  const remainingBudget = () => { signal?.throwIfAborted(); const remaining = deadline - performance.now(); if (remaining <= 0) throw fail('MESH_BUDGET', 'The complete accessory exceeded its 30-second meshing budget'); return remaining; };
  inspectAccessoryDraft(draft); signal?.throwIfAborted();
  const required = new Map(draft.pieces.map(piece => [piece.id, {}])), internal = new Map(), issues = [], templates = new Map(), instances = new Map(), meshes = [];
  const sheetBounds = vectorModelBounds({ items: draft.model.items.filter(item => required.has(item.id)) }, 0);
  const requireReference = (reference, owner) => {
    for (const segment of reference.segments) {
      let fractions = required.get(segment.pieceId);
      if (!fractions) {
        const item = draft.model.items.find(item => item.id === segment.pieceId);
        if (required.has(item?.metadata?.pieceId) && ['dart', 'fold'].includes(item.metadata.role)) {
          if (!internal.has(item.id)) internal.set(item.id, { item, requiredFractions: {} });
          fractions = internal.get(item.id).requiredFractions;
        } else { if (!issues.some(issue => issue.owner === owner && issue.pieceId === segment.pieceId)) issues.push({ code: 'INTERNAL_CONSTRAINT_REQUIRED', owner, pieceId: segment.pieceId, message: 'This sewing feature needs an explicit parent piece and constrained mesh edges before assembly.' }); continue; }
      }
      (fractions[segment.edgeId] ||= []).push(segment.start, segment.end);
    }
  };
  for (const seam of draft.accessory.seamPairs) { requireReference(seam.a, seam.id); requireReference(seam.b, seam.id); }
  for (const opening of draft.accessory.openings) requireReference(opening.reference, opening.id);
  for (const piece of draft.pieces) {
    signal?.throwIfAborted();
    const item = draft.model.items.find(item => item.id === piece.id); if (!item || !Number.isSafeInteger(piece.cutQuantity) || piece.cutQuantity < 1 || piece.cutQuantity > 50) throw fail('INVALID_CUTTING_PIECE', 'An accessory cutting piece or quantity is missing');
    const bounds = vectorModelBounds({ items: [item] }, 0), originMm = [bounds.x, bounds.y];
    const constraintPaths = [...internal.values()].filter(value => value.item.metadata.pieceId === piece.id);
    const base = createPhysicalContourMesh(item, { sourceRevision, originMm, toleranceMm, maxBoundarySegmentMm, maxTriangleAreaMm2, requiredFractions: required.get(piece.id), constraintPaths, timeBudgetMs: remainingBudget(), signal });
    templates.set(piece.id, base); const copies = [];
    for (let copy = 0; copy < piece.cutQuantity; copy++) {
      remainingBudget();
      const mesh = structuredClone(base); mesh.id = `${piece.id}:copy-${copy + 1}`; mesh.name = `${piece.name}${piece.cutQuantity > 1 ? ` · ${copy + 1} of ${piece.cutQuantity}` : ''}`;
      mesh.patternPieceId = piece.id; mesh.copyIndex = copy; mesh.material = piece.material; mesh.presentation = 'flat-pattern'; mesh.flatPlacementMm = [originMm[0], originMm[1] + copy * (sheetBounds.height + 40), 0];
      // Display placement is explicit and reversible; physical source2D stays local.
      mesh.positions = mesh.positions.map((value, i) => value + mesh.flatPlacementMm[i % 3]);
      copies.push(mesh); meshes.push(mesh);
      if (meshes.length > 500 || meshes.reduce((sum, value) => sum + value.vertexIds.length, 0) > 20000 || meshes.reduce((sum, value) => sum + value.faceIds.length, 0) > 40000) throw fail('MESH_BUDGET', 'The complete accessory exceeds the shared preview mesh budget');
    }
    instances.set(piece.id, copies);
  }
  function mapReference(reference, copy) {
    const segments = [];
    for (const part of reference.segments) {
      const parentId = internal.get(part.pieceId)?.item.metadata.pieceId || part.pieceId;
      const base = templates.get(parentId), instance = instances.get(parentId)?.[copy];
      if (!base) return { status: 'needs-internal-constraint', segments: [], chains: [] };
      if (!instance) throw fail('INCOMPATIBLE_QUANTITY', 'A sewing relationship references a copy that is not present in its cutting list');
      const constraintKind = parentId === part.pieceId ? 'boundary' : 'internal';
      const edge = (constraintKind === 'boundary' ? base.boundary.edges : base.constraints.paths.find(path => path.id === part.pieceId)?.edges)?.find(edge => edge.edgeId === part.edgeId);
      if (!edge) throw fail('ORPHAN_SEAM', 'A sewing edge was not retained by the physical mesh');
      const start = edge.fractions.findIndex(t => Math.abs(t - part.start) <= 1e-10), end = edge.fractions.findIndex(t => Math.abs(t - part.end) <= 1e-10);
      if (start < 0 || end < 0 || start === end) throw fail('UNMAPPED_SEAM', 'A sewing interval lost its physical boundary location');
      const vertexIds = edge.vertexIds.slice(Math.min(start, end), Math.max(start, end) + 1); if (end < start) vertexIds.reverse();
      segments.push({ meshId: instance.id, pieceId: part.pieceId, physicalPieceId: parentId, constraintKind, edgeId: part.edgeId, start: part.start, end: part.end, vertexIds, lengthMm: edge.sourceLengthMm * Math.abs(part.end - part.start) });
    }
    const chains = [];
    for (const segment of segments) {
      const previous = chains.at(-1);
      if (previous?.meshId === segment.meshId && previous.vertexIds.at(-1) === segment.vertexIds[0]) { previous.vertexIds.push(...segment.vertexIds.slice(1)); previous.lengthMm += segment.lengthMm; }
      else chains.push({ meshId: segment.meshId, vertexIds: [...segment.vertexIds], lengthMm: segment.lengthMm });
    }
    return { status: 'mapped', segments, chains, lengthMm: segments.reduce((sum, segment) => sum + segment.lengthMm, 0) };
  }
  const seams = draft.accessory.seamPairs.flatMap(seam => {
    if (!Number.isSafeInteger(seam.repeatCount) || seam.repeatCount < 1 || seam.repeatCount > 50) throw fail('INVALID_SEAM_QUANTITY', 'An accessory sewing operation needs a valid repetition count');
    return Array.from({ length: seam.repeatCount }, (_, copy) => {
      const a = mapReference(seam.a, copy), b = mapReference(seam.b, copy);
      return { ...structuredClone(seam), id: `${seam.id}:copy-${copy + 1}`, sourceSeamId: seam.id, copyIndex: copy, a, b,
        status: a.status !== 'mapped' || b.status !== 'mapped' ? 'needs-internal-constraint' : [...a.segments, ...b.segments].some(segment => segment.constraintKind === 'internal') ? 'constraint-mapped' : 'boundary-mapped', assemblyEstablished: false };
    });
  });
  const openings = draft.accessory.openings.map(opening => ({ ...structuredClone(opening), copies: Array.from({ length: Math.max(...opening.reference.segments.map(segment => instances.get(internal.get(segment.pieceId)?.item.metadata.pieceId || segment.pieceId)?.length || 1)) }, (_, copy) => mapReference(opening.reference, copy)) }));
  remainingBudget();
  return { schema: 'sewing.accessory-meshes.v1', sourceRevision, meshes, seams, openings, issues,
    readiness: { geometryEditable: true, boundaryRelationshipsMapped: seams.every(seam => ['boundary-mapped', 'constraint-mapped'].includes(seam.status)), assemblyEstablished: false, clothReady: false, physicalFitVerified: false },
    presentation: { kind: 'flat-patterns', note: 'Actual flat cutting pieces and sewing references. Assembled shaping and fabric fit have not been established.' } };
}
