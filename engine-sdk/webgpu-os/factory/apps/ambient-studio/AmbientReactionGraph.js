// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { cloneStrictJson } from '../../../../engine/core/schema/StrictJsonValue.js';
import { audioAutomationSetTargetValue } from '../../../../engine/core/math/AudioAutomationMath.js';

export const AMBIENT_REACTION_NODE_TYPE = 'reaction.fx-glow';
export const AMBIENT_REACTION_PORT = Object.freeze({ id: 'reaction', label: 'OS reaction', type: 'AmbientReaction', required: false, multiple: true });
const COLOR = /^#[0-9a-f]{6}$/i;
const SILENT = Object.freeze({ background: 'transparent', opacity: 0, accent: null });

/** Defaults are saved only when an artist adds this optional node. */
export function createAmbientReactionParams() {
    return { version: 1, enabled: true, colorSource: 'fixed', color: '#5b7cff', centerX: .5, centerY: .5, radius: .65,
        softness: .7, baseOpacity: 0, energyGain: .25, beatGain: .1, maxOpacity: .5, attack: .15, release: 1,
        floor: 0, ceiling: 1, curve: 1, freshSeconds: .5, fadeSeconds: 1.5 };
}

const BOUNDS = { centerX: [-2, 3], centerY: [-2, 3], radius: [.01, 4], softness: [0, 1],
    baseOpacity: [0, 1], energyGain: [0, 2], beatGain: [0, 2], maxOpacity: [0, 1], attack: [0, 10], release: [0, 20],
    floor: [0, 1], ceiling: [.001, 1], curve: [.1, 8], freshSeconds: [0, 10], fadeSeconds: [.01, 30] };
export function normalizeAmbientReactionParams(value) {
    const params = cloneStrictJson(value, '$.reaction');
    const keys = Object.keys(createAmbientReactionParams());
    if (!params || Array.isArray(params) || Object.keys(params).length !== keys.length || keys.some(key => !Object.hasOwn(params, key))) throw new TypeError('Reaction glow requires its complete saved parameters.');
    if (params.version !== 1 || typeof params.enabled !== 'boolean' || !['fixed', 'fx-accent'].includes(params.colorSource) || !COLOR.test(params.color)) throw new TypeError('Invalid reaction version, enabled flag or color policy.');
    for (const [key, [minimum, maximum]] of Object.entries(BOUNDS)) if (typeof params[key] !== 'number' || params[key] < minimum || params[key] > maximum) throw new TypeError(`Reaction ${key} must be in [${minimum}, ${maximum}].`);
    if (params.ceiling <= params.floor) throw new TypeError('Reaction ceiling must exceed its floor.');
    params.color = params.color.toLowerCase();
    return params;
}

export function isAmbientReactionNode(node) { return node?.type === AMBIENT_REACTION_NODE_TYPE; }
export function ambientReactionNodeDefinition(type) {
    if (type !== AMBIENT_REACTION_NODE_TYPE) return null;
    const defaults = createAmbientReactionParams();
    return { type, label: 'OS activity glow', family: 'Response', category: 'Response', glyph: '◉',
        description: 'An optional saved glow. Its position, color, calibration and timing belong to this node. Disconnect or delete it to remove the glow.',
        inputs: [], outputs: [{ ...AMBIENT_REACTION_PORT, multiple: false }],
        params: Object.entries(defaults).map(([id, value]) => ({ id, label: id.replace(/([A-Z])/g, ' $1'), default: value,
            ...(BOUNDS[id] ? { type: 'number', min: BOUNDS[id][0], max: BOUNDS[id][1], step: .01 }
                : id === 'version' ? { type: 'number', min: 1, max: 1, step: 1 }
                    : id === 'colorSource' ? { type: 'select', options: ['fixed', 'fx-accent'] }
                        : { type: id === 'color' ? 'color' : 'boolean' }) })), locked: false };
}
export function withAmbientReactionInput(definition, type) {
    return definition && type === 'output.wallpaper' ? { ...definition, inputs: [...definition.inputs, AMBIENT_REACTION_PORT] } : definition;
}

export function normalizeAmbientReaction(value) {
    if (value === null) return null;
    const reaction = cloneStrictJson(value, '$.reaction');
    if (!reaction || Array.isArray(reaction) || Object.keys(reaction).length !== 2 || reaction.version !== 1 || !Array.isArray(reaction.glows) || reaction.glows.length > 8) throw new TypeError('Invalid saved reaction config.');
    const ids = new Set();
    return { version: 1, glows: reaction.glows.map(glow => {
        const { nodeId, ...params } = glow;
        if (typeof nodeId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(nodeId) || ids.has(nodeId)) throw new TypeError('Reaction glow IDs must be bounded unique IDs.');
        ids.add(nodeId); return { nodeId, ...normalizeAmbientReactionParams(params) };
    }) };
}

/** Validate every reaction branch; only connections to the selected output execute. */
export function readAmbientReactionGraph(project) {
    const graph = project?.graph;
    if (!graph?.nodes?.some(isAmbientReactionNode)) {
        if (graph?.connections?.some(edge => edge.to?.portId === 'reaction' || edge.from?.portId === 'reaction')) throw new TypeError('Reaction connections require a saved reaction node.');
        return null;
    }
    const nodes = new Map(graph.nodes.map(node => [node.id, node])), glows = new Map();
    if (nodes.size !== graph.nodes.length) throw new TypeError('Reaction graphs require unique node IDs.');
    for (const node of graph.nodes.filter(isAmbientReactionNode)) glows.set(node.id, normalizeAmbientReactionParams(node.params));
    if (glows.size > 8) throw new TypeError('A wallpaper supports at most eight saved reaction glows.');
    const edgeIds = new Set(), selected = [], occupied = new Set();
    for (const edge of graph.connections) {
        if (edgeIds.has(edge.id)) throw new TypeError('Reaction graph connection IDs must be unique.');
        edgeIds.add(edge.id);
        const from = nodes.get(edge.from?.nodeId), to = nodes.get(edge.to?.nodeId);
        if (!isAmbientReactionNode(from) && !isAmbientReactionNode(to) && edge.from?.portId !== 'reaction' && edge.to?.portId !== 'reaction') continue;
        if (!isAmbientReactionNode(from) || to?.type !== 'output.wallpaper' || edge.from.portId !== 'reaction' || edge.to.portId !== 'reaction') throw new TypeError('Connect reaction glows only to a wallpaper output reaction port.');
        const key = `${from.id}:${to.id}`;
        if (occupied.has(key)) throw new TypeError('Duplicate reaction glow connection.');
        occupied.add(key);
        if (to.id === project.runtime?.entryNodeId) selected.push({ nodeId: from.id, ...glows.get(from.id) });
    }
    return selected.length ? { version: 1, glows: selected.sort((a, b) => a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0) } : null;
}

/** Existing render compilers consume their original surface graph unchanged. */
export function stripAmbientReactionGraph(project) {
    readAmbientReactionGraph(project);
    if (!project.graph?.nodes?.some(isAmbientReactionNode)) return project;
    const ids = new Set(project.graph.nodes.filter(isAmbientReactionNode).map(node => node.id));
    return { ...project, graph: { ...project.graph, nodes: project.graph.nodes.filter(node => !ids.has(node.id)),
        connections: project.graph.connections.filter(edge => !ids.has(edge.from.nodeId) && !ids.has(edge.to.nodeId)) } };
}

export function createAmbientReactionState() { return { lastTime: null, reaction: null, levels: new Map() }; }

/** Pure renderer contract. Permission and policy remain host-owned; no timers or DOM. */
export function sampleAmbientReaction(reaction, frame, { now = performance.now(), wallTime = Date.now(), accessibility = {}, hidden = false, suspended = false, frozen = false } = {}, state = createAmbientReactionState()) {
    if (state.reaction !== reaction) { state.reaction = reaction; state.lastTime = null; state.levels.clear(); }
    if (!reaction || frozen || hidden || suspended || accessibility.reducedMotion || accessibility.forcedColors || accessibility.reduceTransparency || accessibility.reducedTransparency || !Number.isFinite(now)) {
        state.lastTime = null; state.levels.clear(); return SILENT;
    }
    if (state.lastTime !== null && now < state.lastTime) state.levels.clear();
    const dt = state.lastTime === null || now < state.lastTime ? 0 : (now - state.lastTime) / 1000;
    state.lastTime = now;
    const age = (wallTime - Number(frame?.ts)) / 1000, stamped = frame && Number.isFinite(age) && age >= -1;
    const backgrounds = []; let accent = null;
    for (const glow of reaction.glows) {
        const fade = stamped ? Math.max(0, 1 - Math.max(0, age - glow.freshSeconds) / glow.fadeSeconds) : 0;
        const energy = typeof frame?.energy === 'number' && Number.isFinite(frame.energy) ? Math.max(0, Math.min(1, (frame.energy - glow.floor) / (glow.ceiling - glow.floor))) ** glow.curve : 0;
        const target = glow.enabled ? Math.min(glow.maxOpacity, glow.baseOpacity + fade * (energy * glow.energyGain + (frame?.beat === true ? glow.beatGain : 0))) : 0;
        const previous = state.levels.get(glow.nodeId) ?? 0;
        const tau = target > previous ? glow.attack : glow.release;
        const level = tau === 0 ? target : audioAutomationSetTargetValue(previous, target, 0, tau, dt);
        state.levels.set(glow.nodeId, level);
        const color = glow.colorSource === 'fixed' ? glow.color : COLOR.test(frame?.accent) ? frame.accent.toLowerCase() : null;
        if (!color || level <= .000001) continue;
        accent = color;
        backgrounds.push(`radial-gradient(circle at ${glow.centerX * 100}% ${glow.centerY * 100}%, color-mix(in srgb, ${color} ${(level * 100).toFixed(5)}%, transparent) 0%, transparent ${(glow.radius * 100).toFixed(5)}%)`);
        // A sharp inner core is independently authored by the saved softness.
        if (glow.softness < 1) backgrounds[backgrounds.length - 1] = backgrounds.at(-1).replace(' 0%,', ` ${(glow.radius * (1 - glow.softness) * 100).toFixed(5)}%,`);
    }
    return backgrounds.length ? { background: backgrounds.join(', '), opacity: 1, accent } : SILENT;
}
