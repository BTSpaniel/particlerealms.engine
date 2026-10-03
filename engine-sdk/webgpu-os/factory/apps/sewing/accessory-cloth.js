// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { createAccessoryPatternMeshes } from './accessory-meshes.js';
import { analyzePanelTopology, refinePhysicalMeshEdges, refinePhysicalMeshFaces } from '../../components/mesh/physicalMesh.js';
import { improvePhysicalPanelTriangulation, improvePhysicalPanelInterior } from '../../components/mesh/panelTriangulation.js';
import { normalizeClothMaterial } from '../../../../engine/sim/cloth/triangular/materials.js';
import { prepareClothAssemblySeed } from '../../../../engine/sim/cloth/triangular/assembly-seed.js';
import { createTriangularClothWorker } from '../../../../engine/sim/cloth/triangular/index.js';
import { createPatternGenerator } from '../../components/pattern-generation/index.js';
import { closestPointOnSegment } from '../../../../engine/core/math/MathGeometry.js';

const fail = (code, message) => Object.assign(new Error(message), { code });

/** One complete authored glove; the opening and all uncut rest coordinates survive. */
export async function prepareAccessoryAssembly(draft, { sourceRevision, copyIndex = 0, estimatedPreset, pinMode = 'none', signal } = {}) {
  const deadline = performance.now() + 30000;
  const check = () => { signal?.throwIfAborted(); if (performance.now() >= deadline) throw fail('BUDGET_EXHAUSTED', 'Glove assembly preparation reached its 30-second budget'); }; check();
  if (!['fingerless-glove', 'fingered-glove'].includes(draft?.accessory?.kind)) throw fail('UNSUPPORTED_ASSEMBLY', 'This assembly adapter requires an authored two-panel glove');
  if (typeof sourceRevision !== 'string' || !sourceRevision || sourceRevision.length > 256) throw fail('INVALID_REVISION', 'Glove assembly requires its saved source revision');
  if (estimatedPreset !== 'stretch-knit') throw fail('MATERIAL_ESTIMATE_REQUIRED', 'Choose the explicit stretch-knit preview estimate before preparing this glove');
  if (!Number.isSafeInteger(copyIndex) || copyIndex < 0 || copyIndex > 1 || !['none', 'wrist'].includes(pinMode)) throw fail('INVALID_ASSEMBLY_OPTION', 'Choose an available glove and its supported holding points');
  signal?.throwIfAborted();
  const flat = createAccessoryPatternMeshes(draft, { sourceRevision, toleranceMm: .05, maxBoundarySegmentMm: 10, maxTriangleAreaMm2: 400, signal });
  const selected = flat.meshes.filter(mesh => mesh.copyIndex === copyIndex);
  if (selected.length !== 2 || !selected.some(mesh => mesh.patternPieceId === 'glove-palm') || !selected.some(mesh => mesh.patternPieceId === 'glove-back')) throw fail('MISSING_GLOVE', 'The selected complete glove is absent from the cutting quantities');
  const seams = flat.seams.filter(seam => seam.copyIndex === copyIndex);
  if (seams.some(seam => seam.status !== 'boundary-mapped' || !seam.confirmed || seam.reverse || seam.a.chains.length !== seam.b.chains.length)) throw fail('UNSUPPORTED_SEAM', 'The glove needs its confirmed matching independent seam segments');
  const seamVertices = new Map(selected.map(mesh => [mesh.id, new Set()]));
  for (const seam of seams) for (const side of [seam.a, seam.b]) for (const chain of side.chains) for (const id of chain.vertexIds) seamVertices.get(chain.meshId)?.add(id);
  const meshes = selected.map(input => {
    const mesh = improvePhysicalPanelTriangulation(input, { check });
    // A centroid inserted into a long, narrow web triangle creates an even
    // thinner membrane face. Keep those constrained faces intact and add free
    // interior samples only where every child retains useful numerical shape.
    const stableFaces = mesh.faceIds.filter((_, face) => {
      const points = mesh.triangles.slice(face * 3, face * 3 + 3).map(index => mesh.positions.slice(index * 3, index * 3 + 2));
      const area2 = Math.abs((points[1][0] - points[0][0]) * (points[2][1] - points[0][1]) - (points[1][1] - points[0][1]) * (points[2][0] - points[0][0]));
      const edgeSquares = points.reduce((sum, point, index) => { const next = points[(index + 1) % 3]; return sum + (point[0] - next[0]) ** 2 + (point[1] - next[1]) ** 2; }, 0);
      return 2 * Math.sqrt(3) * area2 / edgeSquares >= .25;
    });
    const refined = draft.accessory.kind === 'fingered-glove'
      ? refinePhysicalMeshFaces(mesh, { faceIds: stableFaces })
      : refinePhysicalMeshEdges(mesh, { edgeIds: analyzePanelTopology(mesh).edges.filter(edge => edge.faces.length === 2 && seamVertices.get(mesh.id).has(mesh.vertexIds[edge.a]) && seamVertices.get(mesh.id).has(mesh.vertexIds[edge.b])).map(edge => edge.id) });
    return improvePhysicalPanelInterior(refined, { vertexIds: refined.vertexIds.filter(id => !mesh.vertexIds.includes(id)), check });
  });
  const material = normalizeClothMaterial({ id: 'accessory:stretch-knit', role: 'fabric', estimatedPreset,
    ...(draft.accessory.kind === 'fingered-glove' ? { bendingNm: { value: .0000025, status: 'estimated', source: 'Explicit five-finger preview estimate; not measured fabric' } } : {}) });
  const descriptor = { sourceRevision, positionsMm: [], restPositions2dMm: [], triangles: [], trianglePieceIds: [], grainDirections: [], triangleMaterialIds: [], materials: [material.source], seams: [], attachments: [], pins: [], colliders: [], options: { selfContact: true } };
  const mapping = [], localMaps = new Map();
  for (const mesh of meshes) {
    signal?.throwIfAborted();
    const byId = new Map(mesh.vertexIds.map((id, index) => [id, index])), sourceIndices = new Map(mesh.source2D.vertexIds.map((id, index) => [id, index])), global = [];
    const direction = mesh.patternPieceId === 'glove-palm' ? 1 : -1;
    for (const id of mesh.vertexIds) {
      const index = sourceIndices.get(id), point = mesh.source2D.positions.slice(index * 2, index * 2 + 2);
      global.push(descriptor.positionsMm.length);
      descriptor.positionsMm.push([point[0], point[1], direction]); descriptor.restPositions2dMm.push(point);
    }
    for (let f = 0; f < mesh.faceIds.length; f++) { descriptor.triangles.push(mesh.triangles.slice(f * 3, f * 3 + 3).map(i => global[i])); descriptor.trianglePieceIds.push(mesh.id); descriptor.grainDirections.push([0, 1]); descriptor.triangleMaterialIds.push(material.id); }
    mapping.push({ pieceId: mesh.id, vertexIndices: global }); localMaps.set(mesh.id, { byId, global });
  }
  for (const seam of seams) for (let i = 0; i < seam.a.chains.length; i++) {
    const map = chain => { const local = localMaps.get(chain.meshId); return chain.vertexIds.map(id => local.global[local.byId.get(id)]); };
    const a = seam.a.chains[i], b = seam.b.chains[i];
    if (Math.abs(a.lengthMm - b.lengthMm) > Math.max(.5, a.lengthMm * .001)) throw fail('SEAM_MISMATCH', 'A glove seam segment lost its matching length');
    descriptor.seams.push({ id: `${seam.id}:segment-${i}`, a: map(a), b: map(b), easeMm: 0, complianceMPerN: 0 });
  }
  // A piecewise-linear seed can amplify slopes in narrow curve triangles.
  // Bound the actual per-face derivative, preserving the authored 2D chart.
  const fixed = new Set(descriptor.seams.flatMap(seam => [...seam.a, ...seam.b]));
  const slopeFaces = descriptor.triangles.map(ids => {
    const [a, b, c] = ids.map(id => descriptor.restPositions2dMm[id]), x1 = b[0] - a[0], y1 = b[1] - a[1], x2 = c[0] - a[0], y2 = c[1] - a[1], determinant = x1 * y2 - y1 * x2;
    return { ids, dx: [(y1 - y2) / determinant, y2 / determinant, -y1 / determinant], dy: [(x2 - x1) / determinant, -x2 / determinant, x1 / determinant] };
  });
  const ownerByVertex = [], seamSegments = new Map(mapping.map(owner => [owner.pieceId, []]));
  for (const owner of mapping) for (const id of owner.vertexIndices) ownerByVertex[id] = owner.pieceId;
  for (const seam of descriptor.seams) for (const side of [seam.a, seam.b]) for (let i = 1; i < side.length; i++) seamSegments.get(ownerByVertex[side[0]]).push([side[i - 1], side[i]].map(id => [...descriptor.restPositions2dMm[id], 0]));
  const heights = descriptor.positionsMm.map((_, id) => {
    if (id % 128 === 0) check();
    if (fixed.has(id)) return 0;
    const point = [...descriptor.restPositions2dMm[id], 0]; let distance = Infinity;
    for (const [a, b] of seamSegments.get(ownerByVertex[id])) {
      const closest = closestPointOnSegment(point, a, b); distance = Math.min(distance, Math.hypot(point[0] - closest[0], point[1] - closest[1]));
    }
    return distance;
  });
  const maximumSlope = Math.max(...slopeFaces.map(face => Math.hypot(face.ids.reduce((sum, id, i) => sum + heights[id] * face.dx[i], 0), face.ids.reduce((sum, id, i) => sum + heights[id] * face.dy[i], 0))));
  if (!(maximumSlope > 0) || !Number.isFinite(maximumSlope)) throw fail('ASSEMBLY_SEED_INFEASIBLE', 'The glove has no usable interior surface for assembly');
  // Five finger webs need a gentler starting shell than the simpler open glove.
  // The accepted seed still clears its real thickness/contact checks, while its
  // default 1/60 s, 4-substep Engine solve remains inside supplied curve data.
  const relativeSlopeLimit = draft.accessory.kind === 'fingered-glove' ? .45 : .9;
  const scale = relativeSlopeLimit / maximumSlope;
  console.debug('[Sewing][accessory-assembly][initial-slope]', { relativeSlopeLimit, maximumSlope });
  descriptor.positionsMm.forEach((point, id) => { point[2] = (point[2] < 0 ? -1 : 1) * heights[id] * scale; });
  if (copyIndex === 1) {
    const width = Math.max(...descriptor.positionsMm.map(point => point[0]));
    descriptor.positionsMm.forEach(point => { point[0] = width - point[0]; });
  }
  if (pinMode === 'wrist') {
    const palm = meshes.find(mesh => mesh.patternPieceId === 'glove-palm'), wrist = palm.boundary.edges.find(edge => edge.edgeId === 'wrist-opening'), local = localMaps.get(palm.id);
    if (!wrist) throw fail('MISSING_OPENING', 'The glove wrist opening is unavailable');
    for (const id of [wrist.vertexIds[0], wrist.vertexIds.at(-1)]) descriptor.pins.push({ vertex: local.global[local.byId.get(id)] });
  }
  check(); let prepared;
  const seedInput = { ...descriptor, pins: [...new Set([...fixed, ...descriptor.pins.map(pin => pin.vertex)])].map(vertex => ({ vertex })) };
  try { prepared = await prepareClothAssemblySeed(seedInput, { positionsMm: descriptor.positionsMm, kind: 'authored-separated-two-panel-glove', sourceRevision, maximumCorrectionMm: 1, budgetMs: Math.min(5000, deadline - performance.now()), signal }); prepared.pins = descriptor.pins; prepared.assemblySeed.temporaryHolds = 'confirmed seam vertices'; }
  catch (error) { const ids = [...(error.details?.lastContact?.leftIds || []), ...(error.details?.lastContact?.rightIds || [])]; console.debug('[Sewing][accessory-assembly][contact-rejected]', JSON.stringify({ maximumHeightMm: Math.max(...descriptor.positionsMm.map(point => Math.abs(point[2]))), points: ids.map(id => {
    return { id, point: descriptor.positionsMm[id], fixed: fixed.has(id), piece: ownerByVertex[id], distanceToSeamMm: heights[id] };
  }) })); throw error; }
  const posed = meshes.map(mesh => ({ ...mesh, positions: mapping.find(map => map.pieceId === mesh.id).vertexIndices.flatMap(id => prepared.positionsMm[id]), presentation: 'authored-assembly-seed', derived: { sourceRevision, status: 'initial-assembly', physicalFitVerified: false } }));
  console.debug('[Sewing][accessory-assembly][ready]', { kind: draft.accessory.kind, copyIndex, vertices: prepared.positionsMm.length, seams: prepared.seams.length });
  return { descriptor: prepared, meshes: posed, mapping, copyIndex, pinMode, issues: [{ code: 'INITIAL_ASSEMBLY', message: 'The separated two-panel pose is a checked simulation starting shape. It does not establish hand fit or finished dimensions.', severity: 'information' }], readiness: { assemblyEstablished: true, clothReady: true, physicalFitVerified: false } };
}

/** All expensive preparation uses the existing Factory worker lifetime. */
export function createAccessoryAssemblyGenerator({ signal, onLog } = {}) {
  return createPatternGenerator({ workerUrl: new URL('./accessory-assembly-worker.js', import.meta.url), version: 'sewing.accessory-assembly.v1', signal, onLog,
    validateRequest({ draft, options = {} }) {
      if (!['fingerless-glove', 'fingered-glove'].includes(draft?.accessory?.kind) || !Array.isArray(draft.model?.items) || draft.model.items.length > 2000) throw fail('UNSUPPORTED_ASSEMBLY', 'Choose a supported authored glove');
      if (!options || typeof options !== 'object' || Object.keys(options).some(key => !['sourceRevision', 'copyIndex', 'estimatedPreset', 'pinMode'].includes(key))) throw fail('INVALID_ASSEMBLY_OPTION', 'Unsupported glove assembly option');
      return { design: draft.accessory.kind, draft: structuredClone(draft), options: structuredClone(options) };
    } });
}

/** Numerical execution stays in the shared Engine, with the same retained vertex map. */
export async function createAccessorySimulation(prepared, { signal, backend = 'javascript-reference', compute } = {}) {
  const simulation = await createTriangularClothWorker(prepared.descriptor, { signal, backend, compute });
  const decorate = result => ({ ...result, issues: [...prepared.issues, ...result.issues] });
  return Object.freeze({ descriptor: prepared.descriptor, mapping: prepared.mapping, issues: prepared.issues,
    step: async options => decorate(await simulation.step(options)), settle: async options => decorate(await simulation.settle(options)), snapshot: () => decorate(simulation.snapshot()), dispose: () => simulation.dispose(),
    meshes(result) {
      if (result?.sourceRevision !== prepared.descriptor.sourceRevision || result.positionsMm?.length !== prepared.descriptor.positionsMm.length || result.positionsMm.some(point => !Array.isArray(point) || point.length !== 3 || point.some(value => !Number.isFinite(value)))) throw fail('STALE_SIMULATION', 'This glove preview does not match its saved source revision');
      return prepared.meshes.map(mesh => ({ ...structuredClone(mesh), positions: prepared.mapping.find(value => value.pieceId === mesh.id).vertexIndices.flatMap(id => result.positionsMm[id]), derived: { sourceRevision: result.sourceRevision, status: result.status, kind: 'cloth-preview', physicalFitVerified: false } }));
    } });
}
