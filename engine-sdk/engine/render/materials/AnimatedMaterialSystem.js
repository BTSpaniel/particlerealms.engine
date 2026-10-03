// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AnimatedMaterialSystem.js
 * 
 * Per-frame evaluation of animated material node graphs.
 * Materials with Time nodes in their graph get evaluated every frame,
 * producing live PBR values (baseColor, metallic, roughness, emissive)
 * that the viewport renderer uses instead of static material definitions.
 */

import { NODE_TYPES } from '../../../editor/js/components/MaterialNodeTypes.js';

// ── Cached animated PBR results ─────────────────────────────────
// materialId → { baseColor, metallic, roughness, emissive, normal, ao, alpha }
const _animatedCache = new Map();

// materialId → { nodes, connections } (preset graph data)
const _animatedGraphs = new Map();

let _initialized = false;
let _materialLibrary = null;

/**
 * Initialize the animated material system.
 * Scans all materials for animated node graphs and caches them.
 * @param {Object} materialLibrary - MaterialLibrary instance
 */
export async function initAnimatedMaterials(materialLibrary) {
    _materialLibrary = materialLibrary;
    _animatedGraphs.clear();
    _animatedCache.clear();

    if (!materialLibrary) return;

    let presetModule = null;
    try {
        presetModule = await import('../../../editor/js/components/MaterialNodePresets.js');
    } catch (e) {
        console.warn('[AnimatedMaterialSystem] Could not load MaterialNodePresets:', e.message);
        return;
    }

    const allMats = materialLibrary.getAll();
    for (const mat of allMats) {
        _tryRegisterAnimated(mat, presetModule);
    }

    // Subscribe to library changes so new materials get picked up
    materialLibrary.subscribe((event, materialId) => {
        _refreshAnimatedList(presetModule);
    });

    _initialized = true;
    console.log(`[AnimatedMaterialSystem] Initialized: ${_animatedGraphs.size} animated materials`);
}

function _tryRegisterAnimated(mat, presetModule) {
    // Check user-saved graph first
    let graphData = mat.nodeGraph || null;
    if (!graphData && presetModule) {
        graphData = presetModule.getPresetGraph(mat.id);
    }
    if (!graphData?.nodes) return;

    // Only register if the graph has a Time node (animated)
    const hasTime = graphData.nodes.some(n => n.type === 'time');
    if (!hasTime) return;

    _animatedGraphs.set(mat.id, graphData);
}

function _refreshAnimatedList(presetModule) {
    if (!_materialLibrary) return;
    const allMats = _materialLibrary.getAll();
    const currentIds = new Set(allMats.map(m => m.id));

    // Remove deleted materials
    for (const id of _animatedGraphs.keys()) {
        if (!currentIds.has(id)) {
            _animatedGraphs.delete(id);
            _animatedCache.delete(id);
        }
    }

    // Add new animated materials
    for (const mat of allMats) {
        if (!_animatedGraphs.has(mat.id)) {
            _tryRegisterAnimated(mat, presetModule);
        }
    }
}

/**
 * Evaluate all animated material graphs for this frame.
 * Call once per frame before rendering entities.
 */
export function tickAnimatedMaterials() {
    if (_animatedGraphs.size === 0) return;

    for (const [matId, graphData] of _animatedGraphs) {
        try {
            const pbr = _evaluateGraphData(graphData);
            if (pbr) {
                _animatedCache.set(matId, pbr);
            }
        } catch (e) {
            // Skip failed evaluations silently
        }
    }
}

/**
 * Get the current-frame animated PBR values for a material.
 * Returns null if the material is not animated.
 * @param {string} materialId
 * @returns {Object|null} { baseColor, metallic, roughness, emissive, ... }
 */
export function getAnimatedPBR(materialId) {
    return _animatedCache.get(materialId) || null;
}

/**
 * Check if a material is registered as animated.
 * @param {string} materialId
 * @returns {boolean}
 */
export function isAnimatedMaterial(materialId) {
    return _animatedGraphs.has(materialId);
}

// ── Lightweight graph evaluator (mirrors MaterialNodeGraph._evaluateGraph) ──

function _evaluateGraphData(graphData) {
    const nodes = [];
    for (const nd of graphData.nodes) {
        const def = NODE_TYPES[nd.type];
        if (!def) continue;
        nodes.push({ id: nd.id, type: nd.type, params: nd.params || {} });
    }

    const connections = graphData.connections || [];
    const nodeMap = new Map();
    for (const n of nodes) nodeMap.set(n.id, n);

    // Topological sort
    const inDegree = new Map();
    const depEdges = new Map();
    for (const n of nodes) {
        inDegree.set(n.id, 0);
        depEdges.set(n.id, []);
    }
    for (const c of connections) {
        if (!nodeMap.has(c.fromNode) || !nodeMap.has(c.toNode)) continue;
        inDegree.set(c.toNode, (inDegree.get(c.toNode) || 0) + 1);
        depEdges.get(c.toNode).push({ fromId: c.fromNode, fromPort: c.fromPort, toPort: c.toPort });
    }

    const queue = [];
    for (const [id, deg] of inDegree) {
        if (deg === 0) queue.push(id);
    }
    const order = [];
    while (queue.length > 0) {
        const id = queue.shift();
        order.push(id);
        for (const c of connections) {
            if (c.fromNode !== id) continue;
            const nd = inDegree.get(c.toNode) - 1;
            inDegree.set(c.toNode, nd);
            if (nd === 0) queue.push(c.toNode);
        }
    }

    // Evaluate
    const outputs = new Map();
    for (const nodeId of order) {
        const node = nodeMap.get(nodeId);
        if (!node) continue;
        const def = NODE_TYPES[node.type];
        if (!def || !def.evaluate) {
            outputs.set(nodeId, {});
            continue;
        }

        const inputValues = {};
        if (def.inputs) {
            for (let i = 0; i < def.inputs.length; i++) {
                const inp = def.inputs[i];
                const conn = depEdges.get(nodeId).find(e => e.toPort === i);
                if (conn) {
                    const srcOutputs = outputs.get(conn.fromId);
                    const srcDef = NODE_TYPES[nodeMap.get(conn.fromId)?.type];
                    if (srcOutputs && srcDef?.outputs?.[conn.fromPort]) {
                        inputValues[inp.id] = srcOutputs[srcDef.outputs[conn.fromPort].id];
                    }
                }
                if (inputValues[inp.id] === undefined) {
                    inputValues[inp.id] = inp.default;
                }
            }
        }

        try {
            const result = def._regNode
                ? def.evaluate(node.params, inputValues)
                : def.evaluate(inputValues, node.params);
            outputs.set(nodeId, result || {});
        } catch (e) {
            outputs.set(nodeId, {});
        }
    }

    // Extract PBR Output
    const pbrNode = nodes.find(n => n.type === 'pbr_output');
    if (!pbrNode) return null;

    const pbrDef = NODE_TYPES['pbr_output'];
    const pbrInputs = {};
    if (pbrDef.inputs) {
        for (let i = 0; i < pbrDef.inputs.length; i++) {
            const inp = pbrDef.inputs[i];
            const conn = connections.find(c => c.toNode === pbrNode.id && c.toPort === i);
            if (conn) {
                const srcOutputs = outputs.get(conn.fromNode);
                const srcDef = NODE_TYPES[nodeMap.get(conn.fromNode)?.type];
                if (srcOutputs && srcDef?.outputs?.[conn.fromPort]) {
                    pbrInputs[inp.id] = srcOutputs[srcDef.outputs[conn.fromPort].id];
                    continue;
                }
            }
            pbrInputs[inp.id] = inp.default;
        }
    }

    return pbrInputs;
}
