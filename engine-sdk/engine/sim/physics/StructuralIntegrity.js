/**
 * StructuralIntegrity.js - Structural Integrity and Collapse System
 * 
 * Implements realistic structural mechanics for destructible buildings:
 * - Iterative relaxation solver for force propagation
 * - Stress accumulation and breaking thresholds
 * - Connectivity analysis with flood-fill from anchors
 * - Chain reaction cascading collapse
 * 
 * Based on constraint relaxation similar to Verlet physics but for
 * structural connections rather than particle positions.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Material strength multipliers */
const MATERIAL_STRENGTH = {
    wood: 0.6,
    stone: 1.0,
    brick: 0.8,
    concrete: 1.2,
    metal: 1.5,
    glass: 0.2,
    default: 1.0,
};

/** Material density for mass calculation (kg/m³) */
const MATERIAL_DENSITY = {
    wood: 600,
    stone: 2500,
    brick: 1800,
    concrete: 2400,
    metal: 7800,
    glass: 2500,
    default: 2000,
};

/** Gravity constant */
const GRAVITY = 9.81;

/** Maximum solver iterations per frame */
const MAX_ITERATIONS = 10;

/** Minimum stress to propagate (prevents infinite loops) */
const MIN_STRESS_THRESHOLD = 0.001;

// ============================================================================
// ANCHOR TYPES
// ============================================================================

export const ANCHOR_TYPE = {
    NONE: 0,          // Not anchored - can fall
    GROUND: 1,        // Connected to world ground
    FOUNDATION: 2,    // Part of foundation structure
    FIXED: 3,         // Permanently fixed (indestructible)
};

// ============================================================================
// STRUCTURAL NODE
// ============================================================================

/**
 * A node in the structural graph (corresponds to a fragment or chunk)
 */
export class StructuralNode {
    constructor(id, position, mass = 1.0, material = 'stone') {
        this.id = id;
        this.position = [...position];  // [x, y, z]
        this.mass = mass;
        this.material = material;
        
        // Structural properties
        this.anchorType = ANCHOR_TYPE.NONE;
        this.anchorDistance = Infinity;  // Distance to nearest anchor (in graph edges)
        this.strength = MATERIAL_STRENGTH[material] || MATERIAL_STRENGTH.default;
        
        // Current state
        this.stress = 0;              // Accumulated stress (0-1, breaks at 1)
        this.load = 0;                // Current load from above
        this.supportedMass = 0;       // Total mass this node supports
        this.isSupported = false;     // Connected to an anchor?
        this.isFalling = false;       // Disconnected and falling
        this.isDestroyed = false;     // Completely destroyed
        
        // Connections
        this.connections = [];        // Array of StructuralEdge
        
        // Reference to physics fragment (if applicable)
        this.fragment = null;
        
        // For flood-fill traversal
        this._visited = false;
        this._component = -1;
    }
    
    /** Get total weight (mass * gravity) */
    getWeight() {
        return this.mass * GRAVITY;
    }
    
    /** Check if this node is an anchor */
    isAnchor() {
        return this.anchorType !== ANCHOR_TYPE.NONE;
    }
    
    /** Apply damage to this node */
    applyDamage(amount) {
        this.stress += amount / this.strength;
        return this.stress >= 1.0;
    }
    
    /** Reset per-frame state */
    resetFrameState() {
        this.load = 0;
        this.supportedMass = 0;
        this._visited = false;
    }
}

// ============================================================================
// STRUCTURAL EDGE
// ============================================================================

/**
 * An edge connecting two structural nodes
 */
export class StructuralEdge {
    constructor(nodeA, nodeB, contactArea = 1.0) {
        this.nodeA = nodeA;
        this.nodeB = nodeB;
        this.contactArea = contactArea;  // m²
        
        // Calculate rest length
        const dx = nodeB.position[0] - nodeA.position[0];
        const dy = nodeB.position[1] - nodeA.position[1];
        const dz = nodeB.position[2] - nodeA.position[2];
        this.restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        // Edge properties
        this.strength = Math.min(nodeA.strength, nodeB.strength) * contactArea;
        this.maxLoad = this.strength * 10000;  // N - base capacity
        
        // Current state
        this.currentLoad = 0;         // Force transmitted through edge
        this.stress = 0;              // 0-1, breaks at 1
        this.isBroken = false;
        
        // Direction vector (A to B, normalized)
        const len = this.restLength || 1;
        this.direction = [dx / len, dy / len, dz / len];
        
        // Is this a vertical support edge?
        this.isVerticalSupport = Math.abs(this.direction[1]) > 0.7;
    }
    
    /** Get the other node in this edge */
    getOther(node) {
        return node === this.nodeA ? this.nodeB : this.nodeA;
    }
    
    /** Apply load to this edge */
    applyLoad(force) {
        this.currentLoad += Math.abs(force);
        this.stress = this.currentLoad / this.maxLoad;
        
        if (this.stress >= 1.0 && !this.isBroken) {
            this.isBroken = true;
            return true;  // Just broke
        }
        return false;
    }
    
    /** Reset per-frame state */
    resetFrameState() {
        this.currentLoad = 0;
        // Note: stress persists between frames (damage accumulation)
    }
    
    /** Check if edge can transmit force */
    isActive() {
        return !this.isBroken && !this.nodeA.isDestroyed && !this.nodeB.isDestroyed;
    }
}

// ============================================================================
// STRUCTURAL INTEGRITY SOLVER
// ============================================================================

/**
 * Main structural integrity system
 */
export class StructuralIntegritySolver {
    constructor() {
        this.nodes = new Map();       // id -> StructuralNode
        this.edges = [];              // Array of StructuralEdge
        this.anchors = new Set();     // Set of anchor node IDs
        
        // Solver parameters
        this.iterations = MAX_ITERATIONS;
        this.damageRate = 0.1;        // How fast stress accumulates
        this.propagationFactor = 0.8; // How much stress spreads to neighbors
        this.repairRate = 0.01;       // Slow natural stress relief
        
        // Callbacks
        this.onNodeBreak = null;      // Called when node breaks
        this.onEdgeBreak = null;      // Called when edge breaks
        this.onRegionDetach = null;   // Called when region disconnects
        
        // Stats
        this.stats = {
            nodeCount: 0,
            edgeCount: 0,
            anchorCount: 0,
            brokenEdges: 0,
            fallingNodes: 0,
            componentsCount: 0,
        };
    }
    
    // ========================================================================
    // GRAPH CONSTRUCTION
    // ========================================================================
    
    /**
     * Add a node to the structure
     * @param {string|number} id - Unique identifier
     * @param {number[]} position - [x, y, z]
     * @param {number} mass - Mass in kg
     * @param {string} material - Material type
     * @returns {StructuralNode}
     */
    addNode(id, position, mass = 1.0, material = 'stone') {
        const node = new StructuralNode(id, position, mass, material);
        this.nodes.set(id, node);
        this.stats.nodeCount = this.nodes.size;
        return node;
    }
    
    /**
     * Remove a node and its connections
     * @param {string|number} id 
     */
    removeNode(id) {
        const node = this.nodes.get(id);
        if (!node) return;
        
        // Remove all edges connected to this node
        this.edges = this.edges.filter(edge => {
            if (edge.nodeA === node || edge.nodeB === node) {
                // Remove from other node's connections
                const other = edge.getOther(node);
                other.connections = other.connections.filter(e => e !== edge);
                return false;
            }
            return true;
        });
        
        // Remove from anchors if applicable
        this.anchors.delete(id);
        
        // Remove node
        this.nodes.delete(id);
        this.stats.nodeCount = this.nodes.size;
    }
    
    /**
     * Connect two nodes
     * @param {string|number} idA 
     * @param {string|number} idB 
     * @param {number} contactArea - Contact area in m²
     * @returns {StructuralEdge|null}
     */
    connect(idA, idB, contactArea = 1.0) {
        const nodeA = this.nodes.get(idA);
        const nodeB = this.nodes.get(idB);
        
        if (!nodeA || !nodeB) return null;
        
        // Check if already connected
        for (const edge of nodeA.connections) {
            if (edge.getOther(nodeA) === nodeB) {
                return edge;  // Already connected
            }
        }
        
        const edge = new StructuralEdge(nodeA, nodeB, contactArea);
        nodeA.connections.push(edge);
        nodeB.connections.push(edge);
        this.edges.push(edge);
        this.stats.edgeCount = this.edges.length;
        
        return edge;
    }
    
    /**
     * Set a node as an anchor (connected to ground)
     * @param {string|number} id 
     * @param {number} anchorType - ANCHOR_TYPE value
     */
    setAnchor(id, anchorType = ANCHOR_TYPE.GROUND) {
        const node = this.nodes.get(id);
        if (!node) return;
        
        node.anchorType = anchorType;
        node.anchorDistance = 0;
        node.isSupported = true;
        this.anchors.add(id);
        this.stats.anchorCount = this.anchors.size;
    }
    
    /**
     * Auto-detect anchors based on Y position (nodes touching ground)
     * @param {number} groundY - Y level of ground
     * @param {number} tolerance - Distance tolerance
     */
    autoDetectAnchors(groundY = 0, tolerance = 0.5) {
        for (const [id, node] of this.nodes) {
            if (node.position[1] <= groundY + tolerance) {
                this.setAnchor(id, ANCHOR_TYPE.GROUND);
            }
        }
    }
    
    // ========================================================================
    // SOLVER
    // ========================================================================
    
    /**
     * Main update - run one frame of structural simulation
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        // Reset per-frame state
        for (const node of this.nodes.values()) {
            node.resetFrameState();
        }
        for (const edge of this.edges) {
            edge.resetFrameState();
        }
        
        // Step 1: Propagate anchor distances (BFS from anchors)
        this._propagateAnchorDistances();
        
        // Step 2: Calculate loads (top-down weight accumulation)
        this._calculateLoads();
        
        // Step 3: Iterative relaxation (distribute stress)
        for (let i = 0; i < this.iterations; i++) {
            const converged = this._relaxationStep(dt);
            if (converged) break;
        }
        
        // Step 4: Check for breaks
        this._checkBreaks();
        
        // Step 5: Find disconnected regions
        this._findDisconnectedRegions();
        
        // Step 6: Apply natural stress relief (slow healing)
        this._applyStressRelief(dt);
        
        // Update stats
        this.stats.brokenEdges = this.edges.filter(e => e.isBroken).length;
        this.stats.fallingNodes = [...this.nodes.values()].filter(n => n.isFalling).length;
    }
    
    /**
     * Propagate anchor distances using BFS
     */
    _propagateAnchorDistances() {
        // Reset all distances
        for (const node of this.nodes.values()) {
            if (!node.isAnchor()) {
                node.anchorDistance = Infinity;
                node.isSupported = false;
            }
        }
        
        // BFS from anchors
        const queue = [];
        for (const anchorId of this.anchors) {
            const anchor = this.nodes.get(anchorId);
            if (anchor && !anchor.isDestroyed) {
                queue.push(anchor);
            }
        }
        
        while (queue.length > 0) {
            const node = queue.shift();
            
            for (const edge of node.connections) {
                if (!edge.isActive()) continue;
                
                const neighbor = edge.getOther(node);
                const newDist = node.anchorDistance + 1;
                
                if (newDist < neighbor.anchorDistance) {
                    neighbor.anchorDistance = newDist;
                    neighbor.isSupported = true;
                    queue.push(neighbor);
                }
            }
        }
    }
    
    /**
     * Calculate loads from top down (weight accumulation)
     */
    _calculateLoads() {
        // Sort nodes by height (top to bottom)
        const sorted = [...this.nodes.values()]
            .filter(n => !n.isDestroyed && !n.isFalling)
            .sort((a, b) => b.position[1] - a.position[1]);
        
        for (const node of sorted) {
            // This node's weight plus everything it's supporting
            const totalWeight = node.getWeight() + node.supportedMass * GRAVITY;
            node.load = totalWeight;
            
            // Distribute to supports below
            const supports = node.connections
                .filter(e => e.isActive() && e.isVerticalSupport)
                .map(e => ({ edge: e, node: e.getOther(node) }))
                .filter(s => s.node.position[1] < node.position[1]);
            
            if (supports.length === 0) continue;
            
            // Distribute weight evenly among supports
            const loadPerSupport = totalWeight / supports.length;
            
            for (const support of supports) {
                support.edge.applyLoad(loadPerSupport);
                support.node.supportedMass += node.mass + node.supportedMass / supports.length;
            }
        }
    }
    
    /**
     * One iteration of stress relaxation
     * @returns {boolean} True if converged
     */
    _relaxationStep(dt) {
        let maxChange = 0;
        
        for (const edge of this.edges) {
            if (!edge.isActive()) continue;
            
            // Calculate stress from load
            const loadStress = edge.stress * this.damageRate * dt;
            
            // Apply to connected nodes
            if (loadStress > MIN_STRESS_THRESHOLD) {
                const stressA = edge.nodeA.applyDamage(loadStress * 0.5);
                const stressB = edge.nodeB.applyDamage(loadStress * 0.5);
                maxChange = Math.max(maxChange, loadStress);
            }
            
            // Propagate existing node stress to neighbors
            const avgStress = (edge.nodeA.stress + edge.nodeB.stress) / 2;
            const diff = Math.abs(edge.nodeA.stress - edge.nodeB.stress);
            
            if (diff > MIN_STRESS_THRESHOLD) {
                const transfer = diff * this.propagationFactor * 0.1;
                if (edge.nodeA.stress > edge.nodeB.stress) {
                    edge.nodeA.stress -= transfer;
                    edge.nodeB.stress += transfer;
                } else {
                    edge.nodeB.stress -= transfer;
                    edge.nodeA.stress += transfer;
                }
                maxChange = Math.max(maxChange, transfer);
            }
        }
        
        return maxChange < MIN_STRESS_THRESHOLD;
    }
    
    /**
     * Check for and handle breaks
     */
    _checkBreaks() {
        // Check edges
        for (const edge of this.edges) {
            if (edge.isBroken && edge._justBroke === undefined) {
                edge._justBroke = true;
                if (this.onEdgeBreak) {
                    this.onEdgeBreak(edge);
                }
            }
        }
        
        // Check nodes
        for (const node of this.nodes.values()) {
            if (node.stress >= 1.0 && !node.isDestroyed) {
                node.isDestroyed = true;
                if (this.onNodeBreak) {
                    this.onNodeBreak(node);
                }
            }
        }
    }
    
    /**
     * Find regions disconnected from anchors
     */
    _findDisconnectedRegions() {
        // Reset component IDs
        for (const node of this.nodes.values()) {
            node._component = -1;
        }
        
        let componentId = 0;
        const components = [];
        
        // Flood-fill to find connected components
        for (const node of this.nodes.values()) {
            if (node._component >= 0 || node.isDestroyed) continue;
            
            const component = {
                id: componentId,
                nodes: [],
                hasAnchor: false,
                totalMass: 0,
                centroid: [0, 0, 0],
            };
            
            // BFS flood-fill
            const queue = [node];
            node._component = componentId;
            
            while (queue.length > 0) {
                const current = queue.shift();
                component.nodes.push(current);
                component.totalMass += current.mass;
                component.centroid[0] += current.position[0] * current.mass;
                component.centroid[1] += current.position[1] * current.mass;
                component.centroid[2] += current.position[2] * current.mass;
                
                if (current.isAnchor()) {
                    component.hasAnchor = true;
                }
                
                for (const edge of current.connections) {
                    if (!edge.isActive()) continue;
                    
                    const neighbor = edge.getOther(current);
                    if (neighbor._component < 0 && !neighbor.isDestroyed) {
                        neighbor._component = componentId;
                        queue.push(neighbor);
                    }
                }
            }
            
            // Normalize centroid
            if (component.totalMass > 0) {
                component.centroid[0] /= component.totalMass;
                component.centroid[1] /= component.totalMass;
                component.centroid[2] /= component.totalMass;
            }
            
            components.push(component);
            componentId++;
        }
        
        this.stats.componentsCount = components.length;
        
        // Handle disconnected components (no anchor)
        for (const component of components) {
            if (!component.hasAnchor && component.nodes.length > 0) {
                // This region is falling!
                for (const node of component.nodes) {
                    if (!node.isFalling) {
                        node.isFalling = true;
                        node.isSupported = false;
                    }
                }
                
                if (this.onRegionDetach) {
                    this.onRegionDetach(component);
                }
            }
        }
        
        return components;
    }
    
    /**
     * Apply slow natural stress relief
     */
    _applyStressRelief(dt) {
        for (const node of this.nodes.values()) {
            if (node.stress > 0 && node.stress < 1.0) {
                node.stress = Math.max(0, node.stress - this.repairRate * dt);
            }
        }
        
        for (const edge of this.edges) {
            if (edge.stress > 0 && edge.stress < 1.0 && !edge.isBroken) {
                edge.stress = Math.max(0, edge.stress - this.repairRate * dt);
            }
        }
    }
    
    // ========================================================================
    // DAMAGE APPLICATION
    // ========================================================================
    
    /**
     * Apply damage at a point (explosion, impact, etc.)
     * @param {number[]} point - [x, y, z]
     * @param {number} radius - Damage radius
     * @param {number} amount - Damage amount (0-1 for full destruction)
     * @param {string} falloff - 'linear', 'quadratic', 'constant'
     */
    applyDamage(point, radius, amount, falloff = 'quadratic') {
        const radiusSq = radius * radius;
        
        for (const node of this.nodes.values()) {
            const dx = node.position[0] - point[0];
            const dy = node.position[1] - point[1];
            const dz = node.position[2] - point[2];
            const distSq = dx * dx + dy * dy + dz * dz;
            
            if (distSq > radiusSq) continue;
            
            const dist = Math.sqrt(distSq);
            let factor = 1.0;
            
            switch (falloff) {
                case 'linear':
                    factor = 1 - dist / radius;
                    break;
                case 'quadratic':
                    factor = 1 - (dist / radius) ** 2;
                    break;
                case 'constant':
                    factor = 1.0;
                    break;
            }
            
            node.applyDamage(amount * factor);
        }
        
        // Also damage edges
        for (const edge of this.edges) {
            if (!edge.isActive()) continue;
            
            // Check midpoint of edge
            const mx = (edge.nodeA.position[0] + edge.nodeB.position[0]) / 2;
            const my = (edge.nodeA.position[1] + edge.nodeB.position[1]) / 2;
            const mz = (edge.nodeA.position[2] + edge.nodeB.position[2]) / 2;
            
            const dx = mx - point[0];
            const dy = my - point[1];
            const dz = mz - point[2];
            const distSq = dx * dx + dy * dy + dz * dz;
            
            if (distSq > radiusSq) continue;
            
            const dist = Math.sqrt(distSq);
            let factor = 1.0;
            
            switch (falloff) {
                case 'linear':
                    factor = 1 - dist / radius;
                    break;
                case 'quadratic':
                    factor = 1 - (dist / radius) ** 2;
                    break;
            }
            
            edge.stress += amount * factor / edge.strength;
        }
    }
    
    /**
     * Apply impulse (directional force) at a point
     * @param {number[]} point - [x, y, z]
     * @param {number[]} direction - Normalized direction
     * @param {number} force - Force magnitude
     * @param {number} radius - Effect radius
     */
    applyImpulse(point, direction, force, radius) {
        const radiusSq = radius * radius;
        
        for (const node of this.nodes.values()) {
            const dx = node.position[0] - point[0];
            const dy = node.position[1] - point[1];
            const dz = node.position[2] - point[2];
            const distSq = dx * dx + dy * dy + dz * dz;
            
            if (distSq > radiusSq) continue;
            
            const dist = Math.sqrt(distSq);
            const falloff = 1 - dist / radius;
            const impulse = force * falloff / node.mass;
            
            // Apply to fragment if exists
            if (node.fragment) {
                node.fragment.velocity[0] += direction[0] * impulse;
                node.fragment.velocity[1] += direction[1] * impulse;
                node.fragment.velocity[2] += direction[2] * impulse;
            }
            
            // Stress from impulse
            node.applyDamage(impulse * 0.01);
        }
    }
    
    // ========================================================================
    // UTILITIES
    // ========================================================================
    
    /**
     * Build structure from fragments
     * @param {Array} fragments - PhysicsFragment array
     * @param {number} connectionRadius - Max distance to connect fragments
     */
    buildFromFragments(fragments, connectionRadius = 2.0) {
        this.clear();
        
        const radiusSq = connectionRadius * connectionRadius;
        
        // Create nodes
        for (const frag of fragments) {
            const node = this.addNode(
                frag.mesh.cellId,
                frag.centerOfMass,
                frag.mass,
                frag.material
            );
            node.fragment = frag;
        }
        
        // Create edges based on proximity
        const nodeArray = [...this.nodes.values()];
        for (let i = 0; i < nodeArray.length; i++) {
            for (let j = i + 1; j < nodeArray.length; j++) {
                const a = nodeArray[i];
                const b = nodeArray[j];
                
                const dx = a.position[0] - b.position[0];
                const dy = a.position[1] - b.position[1];
                const dz = a.position[2] - b.position[2];
                const distSq = dx * dx + dy * dy + dz * dz;
                
                if (distSq < radiusSq) {
                    // Estimate contact area based on proximity
                    const dist = Math.sqrt(distSq);
                    const contactArea = Math.max(0.1, 1 - dist / connectionRadius);
                    this.connect(a.id, b.id, contactArea);
                }
            }
        }
        
        // Auto-detect anchors
        this.autoDetectAnchors(0, 1.0);
    }
    
    /**
     * Build structure from voxel chunks
     * @param {Map} chunks - ChunkManager chunks
     * @param {number} chunkSize - Size of each chunk
     */
    buildFromChunks(chunks, chunkSize = 32) {
        this.clear();
        
        // Create node per chunk
        for (const [key, chunk] of chunks) {
            if (chunk.solidCount === 0) continue;
            
            const position = [
                (chunk.cx + 0.5) * chunkSize,
                (chunk.cy + 0.5) * chunkSize,
                (chunk.cz + 0.5) * chunkSize,
            ];
            
            // Mass based on solid count
            const volume = chunk.solidCount;  // Each voxel is 1m³
            const density = 2000;  // Average stone density
            const mass = volume * density;
            
            const node = this.addNode(key, position, mass, 'stone');
            node.chunk = chunk;
        }
        
        // Connect adjacent chunks
        for (const [key, chunk] of chunks) {
            if (chunk.solidCount === 0) continue;
            
            const node = this.nodes.get(key);
            if (!node) continue;
            
            // Check 6 neighbors
            const neighbors = [
                `${chunk.cx + 1},${chunk.cy},${chunk.cz}`,
                `${chunk.cx - 1},${chunk.cy},${chunk.cz}`,
                `${chunk.cx},${chunk.cy + 1},${chunk.cz}`,
                `${chunk.cx},${chunk.cy - 1},${chunk.cz}`,
                `${chunk.cx},${chunk.cy},${chunk.cz + 1}`,
                `${chunk.cx},${chunk.cy},${chunk.cz - 1}`,
            ];
            
            for (const nKey of neighbors) {
                if (this.nodes.has(nKey)) {
                    this.connect(key, nKey, chunkSize * chunkSize * 0.1);  // ~10% contact
                }
            }
        }
        
        // Auto-detect ground anchors
        this.autoDetectAnchors(chunkSize * 0.5, chunkSize);
    }
    
    /**
     * Clear all structure data
     */
    clear() {
        this.nodes.clear();
        this.edges = [];
        this.anchors.clear();
        this.stats = {
            nodeCount: 0,
            edgeCount: 0,
            anchorCount: 0,
            brokenEdges: 0,
            fallingNodes: 0,
            componentsCount: 0,
        };
    }
    
    /**
     * Get all falling nodes
     * @returns {StructuralNode[]}
     */
    getFallingNodes() {
        return [...this.nodes.values()].filter(n => n.isFalling);
    }
    
    /**
     * Get stress visualization data
     * @returns {Array} Array of {position, stress, isAnchor}
     */
    getStressVisualization() {
        return [...this.nodes.values()].map(node => ({
            position: node.position,
            stress: node.stress,
            isAnchor: node.isAnchor(),
            isSupported: node.isSupported,
            isFalling: node.isFalling,
        }));
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [structural_integrity] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.maxSupportDistance = parseInt(cfg.max_support_distance) || 16;
        this.collapseEnabled = cfg.collapse_enabled !== false;
        this.collapseDelay = parseFloat(cfg.collapse_delay) || 0.5;
    }
}

export default StructuralIntegritySolver;
