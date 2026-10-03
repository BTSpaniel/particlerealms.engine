// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { ParametricLSystemProgram } from '../../../../../engine/sim/growth/programs/ParametricLSystemProgram.js';
import { deriveGrowthEntityId, deriveGrowthLineage } from '../../../../../engine/sim/growth/GrowthLineageRng.js';
import { deepFreezeJson } from '../../../../../engine/core/schema/StrictJsonValue.js';
import { hash01 } from './SpatialCore.js';
import { quatLookAt } from '../../../../../engine/core/math/MathQuat.js';

export const SPATIAL_TREE_GENERATOR_VERSION = 1;
export const SPATIAL_TREE_SPECIES = Object.freeze(['oak', 'pine', 'birch', 'willow']);
const cache = new Map();
let cacheEntities = 0, cacheHits = 0, cacheMisses = 0;
const CACHE_ENTITIES = 50000, CACHE_ENTRIES = 256;
export function spatialTreeCacheDiagnostics() { return { entries: cache.size, entities: cacheEntities, hits: cacheHits, misses: cacheMisses, maxEntries: CACHE_ENTRIES, maxEntities: CACHE_ENTITIES }; }
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const length = vector => Math.hypot(...vector);
const unit = vector => { const size = length(vector) || 1; return vector.map(value => value / size); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function spatialTreeIdentity(text) { let result = 2166136261; for (const character of text) result = Math.imul(result ^ character.charCodeAt(0), 16777619); return result >>> 0; }

/** A finite curved lamina shared by authored tree leaves and ground vegetation.
 * Length is the complete petiole-to-tip span, not a Gaussian standard deviation. */
export function spatialLeafSurface(center, tangent, normal, size, width, curvature = .1, blade = false) {
    const u = unit(tangent), n = unit(normal), v = unit(cross(n, u));
    const boundary = blade ? [[-.5, 0], [-.22, .5], [.5, 0], [-.22, -.5]] :
        [[-.5, 0], [-.32, .38], [-.08, .5], [.25, .36], [.5, 0], [.22, -.35], [-.09, -.46], [-.35, -.31]];
    const point = (x, y) => center.map((value, axis) => value + size * (u[axis] * x + v[axis] * y * width + n[axis] * curvature * (1 - 4 * x * x) * (1 - Math.abs(y))));
    const middle = point(0, 0), outline = boundary.map(([x, y]) => point(x, y)), result = [];
    for (let index = 0; index < outline.length; index++) {
        const a = outline[index], b = outline[(index + 1) % outline.length];
        const faceNormal = unit(cross(b.map((value, axis) => value - middle[axis]), a.map((value, axis) => value - middle[axis])));
        for (const local of [middle, b, a]) result.push({ local, normal: faceNormal });
    }
    return result;
}
function twigCone(start, end, radius) {
    const axis = unit(end.map((value, at) => value - start[at])), side = unit(cross(axis, Math.abs(axis[1]) < .95 ? [0, 1, 0] : [1, 0, 0])), up = unit(cross(axis, side));
    const ring = Array.from({ length: 3 }, (_, index) => start.map((value, at) => value + radius * (side[at] * Math.cos(index * Math.PI * 2 / 3) + up[at] * Math.sin(index * Math.PI * 2 / 3))));
    const vertices = [];
    for (let index = 0; index < 3; index++) {
        const a = ring[index], b = ring[(index + 1) % 3], n = unit(cross(b.map((value, at) => value - a[at]), end.map((value, at) => value - a[at])));
        for (const local of [a, b, end]) vertices.push({ local, normal: n });
    }
    for (const local of [ring[0], ring[2], ring[1]]) vertices.push({ local, normal: axis.map(value => -value) });
    return vertices;
}

/** Species grammars are input to the engine's canonical, seeded growth program.
 * The adapter never implements a second turtle or branch-growth executor. */
function treeGrammar(params) {
    const angle = params.branchAngle * Math.PI / 180;
    if (params.species === 'pine') {
        const levels = 5 + params.generations * 2;
        let axiom = 'F(.22)';
        for (let level = 0; level < levels; level++) {
            const fraction = level / levels, spread = (.43 * (1 - fraction) + .035).toFixed(5);
            axiom += `!(.055)F(.10)`;
            for (let branch = 0; branch < 5; branch++) {
                const roll = (branch * Math.PI * 2 / 5 + level * 2.39996).toFixed(5);
                const tilt = (Math.PI * .5 - .10 + fraction * .16).toFixed(5);
                axiom += `[/(${roll})&(${tilt})!(.018)F(${spread})`;
                for (const side of [-1, 1]) axiom += `[+(${side * angle * .60})!(.009)F(${(Number(spread) * .32).toFixed(5)})L(.12)]`;
                axiom += 'L(.12)]';
            }
        }
        return { axiom, rules: [], generations: 0 };
    }
    const broad = params.species === 'oak', droop = params.species === 'willow';
    const successor = `F($0*.92)[&(${angle})F($0*.67)L(.12)][/(2.39996)&(${angle * (broad ? 1.1 : .85)})F($0*.72)L(.12)][/(4.79992)&(${angle * (droop ? 1.65 : .95)})F($0*.63)L(.12)]F($0*.79)`;
    return { axiom: 'F(.42)', rules: [{ predecessor: 'F', successor }], generations: params.generations };
}

function treeStructure(params) {
    const key = JSON.stringify([params.generatorVersion, params.species, params.seed, params.generations, params.branchAngle, params.radiusDecay, params.jitter]);
    if (cache.has(key)) { const result = cache.get(key); cache.delete(key); cache.set(key, result); cacheHits++; return result; }
    cacheMisses++;
    const grammar = treeGrammar(params), program = new ParametricLSystemProgram({ ...grammar, initialRadius: .055, radiusDecay: params.radiusDecay, jitter: params.jitter, maxNewPerTick: 128 });
    let state = program.initialize({ assetId: `ambient.tree.v1.${params.seed}`, seed: params.seed, ...grammar,
        environment: { season: { name: 'summer', phase: .55 }, tropisms: { phototropism: .08, gravitropism: 0, inertia: 4 } } });
    for (let tick = 0; !state.programState.completed; tick++) {
        if (tick >= 128) throw new TypeError('Tree growth exceeded its bounded canonical program budget');
        state = program.step(state, {}, { maxNewEntities: 128 }).state;
    }
    const result = deepFreezeJson({ branches: state.branches, leaves: state.leaves, hash: state.stateHash, program: state.program });
    const entities = result.branches.length + result.leaves.length;
    while (cache.size && (cache.size >= CACHE_ENTRIES || cacheEntities + entities > CACHE_ENTITIES)) {
        const oldest = cache.keys().next().value, discarded = cache.get(oldest);
        cacheEntities -= discarded.branches.length + discarded.leaves.length; cache.delete(oldest);
    }
    cache.set(key, result);
    cacheEntities += entities;
    return result;
}

export function spatialTreeStructure(params) {
    const source = treeStructure(params), minimum = [Infinity, 0, Infinity], maximum = [-Infinity, 0, -Infinity];
    for (const branch of source.branches) for (const point of [branch.start, branch.end]) for (let axis = 0; axis < 3; axis++) {
        minimum[axis] = Math.min(minimum[axis], point[axis]); maximum[axis] = Math.max(maximum[axis], point[axis]);
    }
    const vertical = params.height / Math.max(.0001, maximum[1]), horizontal = params.crownWidth / Math.max(.0001, maximum[0] - minimum[0], maximum[2] - minimum[2]);
    const lean = params.trunkLean ?? 0, bendDirection = hash01(params.seed + 37) * Math.PI * 2;
    const mapped = vector => { const y = vector[1] * vertical, bend = lean * params.height * Math.pow(y / params.height, 2);
        let x = vector[0] * horizontal, z = vector[2] * horizontal;
        if (params.crownDepthScale != null && params.crownDepthScale !== 1) z *= params.crownDepthScale;
        if (params.crownTwist) { const angle = params.crownTwist * Math.PI / 180 * Math.pow(Math.max(0, y / params.height), 1.35), oldX = x;
            x = oldX * Math.cos(angle) - z * Math.sin(angle); z = oldX * Math.sin(angle) + z * Math.cos(angle); }
        return [x + bend * Math.cos(bendDirection), y, z + bend * Math.sin(bendDirection)]; };
    // Pipe-model radii use the actual engine hierarchy. Terminal twigs taper to
    // points rather than presenting repeated sawn-off ends at every leaf group.
    const children = new Map(), tips = new Map();
    for (const branch of source.branches) if (branch.parentId) children.set(branch.parentId, [...(children.get(branch.parentId) ?? []), branch.id]);
    for (const branch of [...source.branches].reverse()) tips.set(branch.id, (children.get(branch.id) ?? []).reduce((sum, id) => sum + (tips.get(id) ?? 1), 0) || 1);
    const rootTips = tips.get(source.branches[0].id);
    const omitted = new Set(params.omitBranches), overrides = new Map(params.branchOverrides.map(value => [value.id, value])), branches = [], byId = new Map();
    for (const original of source.branches) {
        if (omitted.has(original.id) || original.parentId && !byId.has(original.parentId)) continue;
        const parent = byId.get(original.parentId), oldStart = mapped(original.start), oldEnd = mapped(original.end), override = overrides.get(original.id);
        const shift = parent ? parent.end.map((value, axis) => value - parent.originalEnd[axis]) : [0, 0, 0];
        const start = oldStart.map((value, axis) => value + shift[axis] + (override?.offset?.[axis] ?? 0));
        const end = oldEnd.map((value, axis) => start[axis] + (value - oldStart[axis]) * (override?.lengthScale ?? 1));
        const terminal = !children.has(original.id), radius = params.trunkRadius * Math.pow(tips.get(original.id) / rootTips, .62 + (.78 - params.radiusDecay) * 1.25) * (terminal ? .55 : 1) * (override?.radiusScale ?? 1);
        const childRadius = id => params.trunkRadius * Math.pow(tips.get(id) / rootTips, .62 + (.78 - params.radiusDecay) * 1.25) * (!children.has(id) ? .55 : 1) * (overrides.get(id)?.radiusScale ?? 1);
        const endRadius = params.leafProfile === 'lamina' && !terminal ? Math.max(...children.get(original.id).map(childRadius)) : radius * (terminal ? .06 : .82);
        const branch = { id: original.id, lineage: original.lineage, parentId: original.parentId, start, end, originalEnd: oldEnd,
            radius: Math.max(.0012, radius), endRadius: Math.max(.0006, endRadius), order: original.lineage.split('/').length - 1 };
        branches.push(branch); byId.set(branch.id, branch);
    }
    const omittedLeaves = new Set(params.omitLeaves), leaves = source.leaves.filter(leaf => byId.has(leaf.parentId) && !omittedLeaves.has(leaf.id)).map(leaf => {
        const branch = byId.get(leaf.parentId), position = mapped(leaf.position).map((value, axis) => value + branch.end[axis] - branch.originalEnd[axis]);
        return { id: leaf.id, lineage: leaf.lineage, parentId: leaf.parentId, position, normal: leaf.normal, order: branch.order };
    });
    return { version: 1, species: params.species, seed: params.seed, program: source.program, sourceHash: source.hash, branches, leaves, authoredLeafCount: source.leaves.length };
}

/** Optional foliage stems extend canonical leaf-bearing limbs, using the same
 * cone emitter as pine sprigs. Stable engine lineage IDs remain independently
 * editable. An offset steers the endpoint while the root stays attached. */
function spatialTreeFoliageShoots(params, structure, perLeaf) {
    const count = Math.min(params.foliageShoots ?? 0, perLeaf), spread = params.foliageShootSpread ?? .5;
    if (!count || !spread || params.species === 'pine' || params.leafProfile !== 'lamina') return null;
    const branches = new Map(structure.branches.map(branch => [branch.id, branch])), omitted = new Set(params.omitBranches), overrides = new Map(params.branchOverrides.map(value => [value.id, value])), result = new Map();
    for (const leaf of structure.leaves) {
        const branch = branches.get(leaf.parentId), delta = branch.end.map((value, axis) => value - branch.start[axis]), axis = unit(delta);
        const side = unit(cross(axis, Math.abs(axis[1]) < .95 ? [0, 1, 0] : [1, 0, 0])), up = unit(cross(axis, side));
        const cluster = Math.min(params.crownWidth * .22, Math.max(.18, length(delta) * .8)), phase = hash01(spatialTreeIdentity(`${params.seed}:${leaf.id}`)) * Math.PI * 2;
        const shoots = [];
        for (let index = 0; index < count; index++) {
            const lineage = deriveGrowthLineage(leaf.lineage, 'branch', 30000 + index), id = deriveGrowthEntityId('branch', lineage), override = overrides.get(id);
            const angle = phase + index * 2.39996, outward = side.map((value, at) => value * Math.cos(angle) + up[at] * Math.sin(angle)), direction = unit(axis.map((value, at) => value * .28 + outward[at] * .96));
            const fraction = .12 + .78 * (index + .5) / count, start = branch.start.map((value, at) => value + delta[at] * fraction);
            const end = start.map((value, at) => value + direction[at] * cluster * spread * (override?.lengthScale ?? 1) + (override?.offset?.[at] ?? 0));
            shoots.push({ id, lineage, parentId: branch.id, start, end, radius: Math.max(.0012, Math.min(.006, branch.radius * .12)) * (override?.radiusScale ?? 1),
                sampleStart: Math.ceil(index * perLeaf / count), sampleEnd: Math.ceil((index + 1) * perLeaf / count), omitted: omitted.has(id) });
        }
        result.set(leaf.id, shoots);
    }
    return result;
}

export function spatialTreeSampleAllocation(params, budget, structure = spatialTreeStructure(params)) {
    const samples = Math.min(Math.floor(budget * params.leafDensity), structure.authoredLeafCount * 72);
    const perLeaf = structure.authoredLeafCount ? Math.floor(samples / structure.authoredLeafCount) : 0;
    const solidPerLeaf = params.foliageSurface === 'mesh' ? perLeaf : params.foliageSurface === 'hybrid' ? Math.floor(perLeaf * (params.leafMeshFraction ?? .15)) : 0;
    const sprigs = params.species === 'pine' && params.pineSprigs && params.leafProfile === 'lamina' ? Math.ceil(perLeaf / 12) : 0;
    const joinedEnds = new Set(structure.branches.map(branch => branch.parentId).filter(Boolean));
    const barkVertices = structure.branches.reduce((sum, branch) => sum + params.radialSegments * (params.leafProfile === 'lamina' && joinedEnds.has(branch.id) ? 6 : 9), 0);
    const foliageShoots = spatialTreeFoliageShoots(params, structure, perLeaf);
    if (foliageShoots) {
        let splats = 0, foliageVertices = 0;
        for (const shoots of foliageShoots.values()) for (const shoot of shoots) if (!shoot.omitted) {
            const solid = Math.max(0, Math.min(shoot.sampleEnd, solidPerLeaf) - shoot.sampleStart);
            splats += shoot.sampleEnd - shoot.sampleStart - solid; foliageVertices += 12 + solid * 24;
        }
        return { perLeaf, solidPerLeaf, splats, meshVertices: barkVertices + foliageVertices, foliageShoots };
    }
    return { perLeaf, solidPerLeaf, splats: structure.leaves.length * (perLeaf - solidPerLeaf),
        meshVertices: barkVertices + structure.leaves.length * (solidPerLeaf * (params.leafProfile === 'lamina' ? 24 : 6) + sprigs * 12) };
}

/** Complete trunks/branches use real opaque triangles; foliage uses oriented
 * finite leaf surfels. No image plane or hidden reverse-side copy is involved. */
export function createSpatialTree(params, budget, world, groundY = 0) {
    const structure = spatialTreeStructure(params), raw = [], phases = [], wind = [], splatMaterials = [], mesh = [], meshNormals = [], meshWind = [], meshMaterials = [], entities = [];
    const yaw = params.yaw * Math.PI / 180, cs = Math.cos(yaw), sn = Math.sin(yaw), ground = groundY / params.scale;
    const position = local => world(local[0], local[1] + ground, local[2]);
    const normal = local => [local[0] * cs - local[2] * sn, local[1], local[0] * sn + local[2] * cs];
    const bark = rgb(params.barkColor), green = rgb(params.leafColor), gold = rgb(params.autumnColor);
    const azimuth = params.lightAzimuth * Math.PI / 180, elevation = params.lightElevation * Math.PI / 180;
    const sun = [Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)];
    const shade = (color, n, leaf = false) => { const direct = n.reduce((sum, value, axis) => sum + value * sun[axis], 0), diffuse = leaf ? Math.abs(direct) : Math.max(0, direct); return color.map((value, axis) => Math.min(1, value * (.44 + diffuse * .64) + diffuse * [0.025, .022, .014][axis])); };
    // A shared root and phase keep junctions connected. Continuous height-based
    // flexibility supplies primary bending; small leaf phase differences give
    // local flutter without claiming an articulated physical wind simulation.
    const windAt = (local, leaf = null) => [...position([0, 0, 0]), Math.pow(Math.max(0, local[1] / params.height), 1.8),
        hash01(params.seed) * Math.PI * 2 + (leaf ? (hash01(spatialTreeIdentity(leaf.id)) - .5) * .12 : 0), params.windStrength,
        params.windFrequency, params.windDirection * Math.PI / 180 + yaw];
    const branches = new Map(structure.branches.map(branch => [branch.id, branch]));
    const joinedEnds = new Set(structure.branches.map(branch => branch.parentId).filter(Boolean));
    const sides = params.radialSegments;
    for (const branch of structure.branches) {
        const start = mesh.length / 6, axis = unit(branch.end.map((value, i) => value - branch.start[i]));
        const tangent = unit(cross(axis, Math.abs(axis[1]) < .95 ? [0, 1, 0] : [1, 0, 0])), bitangent = unit(cross(axis, tangent));
        const vertex = (t, segment) => {
            const angle = segment / sides * Math.PI * 2, n = tangent.map((value, i) => value * Math.cos(angle) + bitangent[i] * Math.sin(angle));
            const height = branch.start[1] + (branch.end[1] - branch.start[1]) * t;
            const buttress = 1 + Math.max(0, 1 - height / Math.max(.2, params.height * .08)) * .65;
            const radius = (branch.radius * (1 - t) + branch.endRadius * t) * buttress * (.94 + .06 * Math.sin(angle * 3 + params.seed));
            const local = branch.start.map((value, i) => value + (branch.end[i] - value) * t + n[i] * radius);
            const taper = (branch.endRadius - branch.radius) / Math.max(.001, length(branch.end.map((value, at) => value - branch.start[at])));
            const transformed = normal(params.leafProfile === 'lamina' ? unit(n.map((value, at) => value - axis[at] * taper)) : n), grain = .65 + hash01(spatialTreeIdentity(`${branch.id}:${segment % sides}`)) * .42;
            return { local, n: transformed, color: bark.map(value => value * grain), wind: windAt(local) };
        };
        for (let side = 0; side < sides; side++) {
            const a = vertex(0, side), b = vertex(0, side + 1), c = vertex(1, side), d = vertex(1, side + 1);
            for (const value of [a, b, c, c, b, d]) { mesh.push(...position(value.local), ...value.color); meshNormals.push(...value.n); meshWind.push(...value.wind); meshMaterials.push(2); }
        }
        // A closed tip prevents a rear/overhead camera seeing through the tube.
        for (let side = 0; side < sides && !(params.leafProfile === 'lamina' && joinedEnds.has(branch.id)); side++) {
            for (const local of [branch.end, vertex(1, side).local, vertex(1, side + 1).local]) {
                const n = normal(axis); mesh.push(...position(local), ...bark); meshNormals.push(...n); meshWind.push(...windAt(local)); meshMaterials.push(2);
            }
        }
        entities.push({ id: branch.id, parentId: branch.parentId, kind: 'branch', lineage: branch.lineage, meshStart: start, meshCount: mesh.length / 6 - start,
            start: position(branch.start), end: position(branch.end), radius: branch.radius * params.scale });
    }
    const allocation = spatialTreeSampleAllocation(params, budget, structure), { perLeaf, solidPerLeaf } = allocation, lamina = params.leafProfile === 'lamina';
    for (const leaf of structure.leaves) {
        const branch = branches.get(leaf.parentId), identity = spatialTreeIdentity(`${params.seed}:${leaf.id}`), start = raw.length / 14, meshStart = mesh.length / 6;
        const broad = params.species !== 'pine', cluster = Math.min(params.crownWidth * (broad ? .22 : .14), Math.max(.18, length(branch.end.map((value, i) => value - branch.start[i])) * .8));
        const sprigs = [], needleSprigs = !broad && lamina && params.pineSprigs;
        const foliageShoots = allocation.foliageShoots?.get(leaf.id);
        if (foliageShoots) for (const shoot of foliageShoots) if (!shoot.omitted) {
            const shootMeshStart = mesh.length / 6;
            for (const vertex of twigCone(shoot.start, shoot.end, shoot.radius)) {
                mesh.push(...position(vertex.local), ...bark); meshNormals.push(...normal(vertex.normal)); meshWind.push(...windAt(vertex.local, leaf)); meshMaterials.push(2);
            }
            entities.push({ id: shoot.id, parentId: shoot.parentId, kind: 'branch', lineage: shoot.lineage, foliageId: leaf.id,
                meshStart: shootMeshStart, meshCount: 12, start: position(shoot.start), end: position(shoot.end), radius: shoot.radius * params.scale });
        }
        if (needleSprigs) for (let sprig = 0; sprig < Math.ceil(perLeaf / 12); sprig++) {
            const axis = unit(branch.end.map((value, at) => value - branch.start[at])), right = unit(cross(axis, Math.abs(axis[1]) < .95 ? [0, 1, 0] : [1, 0, 0]));
            const heading = hash01(identity + sprig * 97) * Math.PI * 2, up = unit(cross(axis, right)), outward = right.map((value, at) => value * Math.cos(heading) + up[at] * Math.sin(heading));
            const direction = unit(axis.map((value, at) => value * .60 + outward[at] * .72)), fraction = .12 + .83 * (sprig + .5) / Math.ceil(perLeaf / 12);
            const base = branch.start.map((value, at) => value + (branch.end[at] - value) * fraction), end = base.map((value, at) => value + direction[at] * params.leafSize * 3.2);
            const sprigMeshStart = mesh.length / 6;
            for (const vertex of twigCone(base, end, .0025)) { mesh.push(...position(vertex.local), ...bark); meshNormals.push(...normal(vertex.normal)); meshWind.push(...windAt(vertex.local, leaf)); meshMaterials.push(2); }
            entities.push({ id: `${leaf.id}.sprig.${sprig}`, parentId: leaf.parentId, kind: 'sprig', meshStart: sprigMeshStart, meshCount: 12, start: position(base), end: position(end), radius: .0025 * params.scale });
            sprigs.push({ base, end, direction, side: unit(cross(direction, outward)) });
        }
        for (let sample = 0; sample < perLeaf; sample++) {
            const shoot = foliageShoots?.[Math.floor(sample * foliageShoots.length / perLeaf)];
            if (shoot?.omitted) continue;
            let sequence = 0; const rand = () => hash01(identity + sample * 104729 + ++sequence);
            const theta = rand() * Math.PI * 2, elevation = rand() * 2 - 1, radius = cluster * Math.cbrt(rand()), width = params.leafSize * (.7 + rand() * .6);
            const horizontal = Math.sqrt(1 - elevation * elevation), along = rand() * (lamina ? .95 : .52);
            let local = leaf.position.map((value, i) => value + radius * [Math.cos(theta) * horizontal, elevation * .64, Math.sin(theta) * horizontal][i] - (branch.end[i] - branch.start[i]) * along);
            if (params.species === 'willow') local[1] -= radius * 1.8;
            const normalY = lamina ? .22 + rand() * .75 : rand() * 1.6 - .8, horizontalNormal = Math.sqrt(1 - normalY * normalY);
            let n = [Math.cos(theta) * horizontalNormal, normalY, Math.sin(theta) * horizontalNormal];
            let needleDirection = null;
            if (needleSprigs) {
                const sprig = sprigs[Math.floor(sample / 12)], pair = Math.floor(sample % 12 / 2), side = sample % 2 ? 1 : -1;
                needleDirection = unit(sprig.direction.map((value, at) => value * .48 + sprig.side[at] * side * .88));
                const root = sprig.base.map((value, at) => value + (sprig.end[at] - value) * (.12 + pair * .15));
                local = root.map((value, at) => value + needleDirection[at] * width * .5); n = unit(cross(needleDirection, sprig.direction));
            } else if (lamina && broad) {
                const attachment = shoot ?? branch, axis = unit(attachment.end.map((value, at) => value - attachment.start[at])), side = unit(cross(axis, Math.abs(axis[1]) < .95 ? [0, 1, 0] : [1, 0, 0])), up = unit(cross(axis, side));
                const angle = sample * 2.39996 + hash01(identity) * Math.PI * 2, outward = side.map((value, at) => value * Math.cos(angle) + up[at] * Math.sin(angle));
                needleDirection = unit(axis.map((value, at) => value * .30 + outward[at] * .95));
                n = unit([0, 1, 0].map((value, at) => value - needleDirection[at] * needleDirection[1]));
                const root = attachment.start.map((value, at) => value + (attachment.end[at] - value) * (.10 + along * .90) + outward[at] * attachment.radius * .75);
                local = root.map((value, at) => value + needleDirection[at] * width * .5);
            }
            const transformed = normal(n);
            const twig = branch.end.map((value, axis) => value - branch.start[axis]), projected = twig.map((value, axis) => value - n[axis] * twig.reduce((sum, entry, at) => sum + entry * n[at], 0));
            const tangent = needleDirection ?? (lamina && length(projected) > .0001 ? unit(projected) : unit(cross(n, Math.abs(n[1]) < .95 ? [0, 1, 0] : [1, 0, 0])));
            const bitangent = unit(cross(n, tangent)), w = Math.sqrt(Math.max(.00001, (1 + transformed[1]) * .5));
            const q = lamina ? quatLookAt(normal(cross(tangent, n)), transformed) : null, rotation = q ? [q[3], q[0], q[1], q[2]] : [w, transformed[2] / (2 * w), 0, -transformed[0] / (2 * w)];
            const fall = params.autumn * rand(), albedo = green.map((value, i) => (value * (1 - fall) + gold[i] * fall) * (.80 + rand() * .32));
            if (sample < solidPerLeaf) {
                if (lamina) {
                    const leafWidth = params.species === 'pine' ? .10 : params.species === 'willow' ? .24 : params.species === 'birch' ? .46 : .60;
                    for (const vertex of spatialLeafSurface(local, tangent, n, width, leafWidth, params.leafCurvature ?? .10)) {
                        mesh.push(...position(vertex.local), ...albedo); meshNormals.push(...normal(vertex.normal)); meshWind.push(...windAt(vertex.local, leaf)); meshMaterials.push(3);
                    }
                } else {
                    const outline = [[-1, 0], [0, .55], [1, 0], [0, -.55]], vertices = outline.map(([u, v]) => local.map((value, axis) => value + width * (tangent[axis] * u + bitangent[axis] * v)));
                    for (const index of [0, 2, 1, 0, 3, 2]) { mesh.push(...position(vertices[index]), ...albedo); meshNormals.push(...transformed); meshWind.push(...windAt(vertices[index], leaf)); meshMaterials.push(3); }
                }
            } else {
                const color = lamina ? albedo : shade(albedo, transformed, true);
                raw.push(...position(local), width * (lamina ? .25 : 1) * params.scale, width * (lamina ? needleSprigs ? .006 : .016 : broad ? .14 : .10) * params.scale, width * (lamina ? (broad ? .12 : needleSprigs ? .012 : .025) : broad ? .72 : .38) * params.scale, ...rotation, ...color, params.opacity);
                phases.push(spatialTreeIdentity(`${params.seed}:${leaf.id}:${sample}`)); wind.push(...windAt(local, leaf));
                splatMaterials.push(lamina ? 3 : 0);
            }
        }
        entities.push({ id: leaf.id, parentId: leaf.parentId, kind: 'foliage', lineage: leaf.lineage, start, count: raw.length / 14 - start, meshStart, meshCount: mesh.length / 6 - meshStart });
    }
    return { raw, phases, wind, splatMaterials, mesh, meshNormals, meshWind, meshMaterials, metadata: { version: 1, generator: 'engine.l-system.parametric', generatorVersion: params.generatorVersion,
        sourceHash: structure.sourceHash, species: params.species, seed: params.seed, observed: false, provenance: 'Complete procedural tree; hidden surfaces are generated, not reconstructed observations.', entities } };
}
