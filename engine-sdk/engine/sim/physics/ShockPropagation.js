/**
 * ShockPropagation.js - Shock Propagation for Stable Stacking
 * 
 * Based on "Nonconvex Rigid Bodies with Stacking" (Guendelman et al., SIGGRAPH 2003)
 * and NVIDIA PhysX best practices.
 * 
 * Problem: Standard iterative solvers struggle with deep stacks of objects.
 * Objects at the bottom don't "know" about the weight above them, causing
 * jitter and instability.
 * 
 * Solution: Process contacts in a specific order, propagating forces from
 * the ground upward through the contact graph. This ensures each layer
 * is stable before processing the next.
 * 
 * Key Techniques:
 * - Contact graph construction
 * - Topological sorting by "height" from ground
 * - Bottom-up constraint solving
 * - Velocity-level shock propagation
 */

/**
 * Contact graph node representing a physics body
 */
class ContactNode {
    constructor(bodyId, body) {
        this.bodyId = bodyId;
        this.body = body;
        this.contacts = [];     // Contacts with other bodies
        this.level = -1;        // Distance from ground (-1 = unassigned)
        this.isStatic = body.isStatic || body.simMode === 'static';
        this.isGround = this.isStatic; // Static bodies are "ground"
        this.mass = body.mass || 1.0;
        this.invMass = this.isStatic ? 0 : 1.0 / this.mass;
    }
}

/**
 * Contact edge representing a collision between two bodies
 */
class ContactEdge {
    constructor(nodeA, nodeB, contactData) {
        this.nodeA = nodeA;
        this.nodeB = nodeB;
        this.normal = contactData.normal || [0, 1, 0];
        this.penetration = contactData.penetration || 0;
        this.point = contactData.point || [0, 0, 0];
        this.friction = contactData.friction || 0.5;
        this.restitution = contactData.restitution || 0.25;
        this.impulse = 0;
        this.frictionImpulse = [0, 0];
    }
}

/**
 * Shock propagation solver for stable stacking
 */
export class ShockPropagationSolver {
    constructor(options = {}) {
        this.nodes = new Map();     // bodyId -> ContactNode
        this.edges = [];            // All contact edges
        this.levels = [];           // Bodies grouped by level
        this.iterations = options.iterations || 8;
        this.shockIterations = options.shockIterations || 4;
        this.baumgarte = options.baumgarte || 0.2; // Position correction factor
        this.slop = options.slop || 0.005;         // Allowed penetration
    }
    
    /**
     * Clear all contacts for a new frame
     */
    clear() {
        this.nodes.clear();
        this.edges = [];
        this.levels = [];
    }
    
    /**
     * Add a body to the contact graph
     * @param {string|number} bodyId - Unique body identifier
     * @param {Object} body - Body data {mass, isStatic, position, velocity, ...}
     */
    addBody(bodyId, body) {
        if (!this.nodes.has(bodyId)) {
            this.nodes.set(bodyId, new ContactNode(bodyId, body));
        }
    }
    
    /**
     * Add a contact between two bodies
     * @param {string|number} bodyIdA - First body ID
     * @param {string|number} bodyIdB - Second body ID
     * @param {Object} contactData - Contact info {normal, penetration, point, friction}
     */
    addContact(bodyIdA, bodyIdB, contactData) {
        const nodeA = this.nodes.get(bodyIdA);
        const nodeB = this.nodes.get(bodyIdB);
        
        if (!nodeA || !nodeB) {
            console.warn('[ShockPropagation] Missing node for contact');
            return;
        }
        
        const edge = new ContactEdge(nodeA, nodeB, contactData);
        this.edges.push(edge);
        nodeA.contacts.push(edge);
        nodeB.contacts.push(edge);
    }
    
    /**
     * Build level structure from contact graph
     * Uses BFS from static (ground) bodies
     */
    _buildLevels() {
        this.levels = [];
        
        // Reset all levels
        for (const node of this.nodes.values()) {
            node.level = node.isGround ? 0 : -1;
        }
        
        // BFS from ground bodies
        const queue = [];
        for (const node of this.nodes.values()) {
            if (node.isGround) {
                queue.push(node);
            }
        }
        
        // Assign levels based on distance from ground
        while (queue.length > 0) {
            const current = queue.shift();
            
            for (const edge of current.contacts) {
                const neighbor = edge.nodeA === current ? edge.nodeB : edge.nodeA;
                
                if (neighbor.level === -1 && !neighbor.isStatic) {
                    // Check if contact normal points "up" from current to neighbor
                    // This determines the support relationship
                    const normalToNeighbor = edge.nodeA === current 
                        ? edge.normal 
                        : [-edge.normal[0], -edge.normal[1], -edge.normal[2]];
                    
                    // If normal points up, neighbor is above current
                    if (normalToNeighbor[1] > 0.5) {
                        neighbor.level = current.level + 1;
                        queue.push(neighbor);
                    }
                }
            }
        }
        
        // Handle floating objects (not connected to ground)
        for (const node of this.nodes.values()) {
            if (node.level === -1 && !node.isStatic) {
                node.level = 1000; // High level for floating objects
            }
        }
        
        // Group by levels
        const maxLevel = Math.max(...Array.from(this.nodes.values()).map(n => n.level));
        for (let i = 0; i <= maxLevel; i++) {
            this.levels[i] = [];
        }
        
        for (const node of this.nodes.values()) {
            if (node.level >= 0 && node.level <= maxLevel) {
                this.levels[node.level].push(node);
            }
        }
    }
    
    /**
     * Solve all contacts using shock propagation
     * @param {number} dt - Time step
     */
    solve(dt) {
        if (this.edges.length === 0) return;
        
        // Build level structure
        this._buildLevels();
        
        // Phase 1: Shock propagation (bottom-up)
        // Process each level from ground up
        for (let level = 0; level < this.levels.length; level++) {
            const levelBodies = this.levels[level];
            if (!levelBodies || levelBodies.length === 0) continue;
            
            // Collect contacts involving this level
            const levelContacts = this.edges.filter(edge => {
                const levelA = edge.nodeA.level;
                const levelB = edge.nodeB.level;
                return levelA === level || levelB === level;
            });
            
            // Solve these contacts with shock iterations
            for (let iter = 0; iter < this.shockIterations; iter++) {
                for (const edge of levelContacts) {
                    this._solveContact(edge, dt, true);
                }
            }
            
            // "Freeze" velocities at this level before moving up
            // This prevents the solver from undoing work
            for (const node of levelBodies) {
                if (!node.isStatic && node.body.linearVelocity) {
                    // Store solved velocity
                    node.solvedVelocity = [...node.body.linearVelocity];
                    node.solvedAngularVelocity = [...(node.body.angularVelocity || [0, 0, 0])];
                }
            }
        }
        
        // Phase 2: Regular iterative solving for fine-tuning
        for (let iter = 0; iter < this.iterations; iter++) {
            for (const edge of this.edges) {
                this._solveContact(edge, dt, false);
            }
        }
    }
    
    /**
     * Solve a single contact constraint
     */
    _solveContact(edge, dt, isShockPhase) {
        const nodeA = edge.nodeA;
        const nodeB = edge.nodeB;
        
        if (nodeA.isStatic && nodeB.isStatic) return;
        
        const bodyA = nodeA.body;
        const bodyB = nodeB.body;
        
        // Get velocities
        const velA = bodyA.linearVelocity || [0, 0, 0];
        const velB = bodyB.linearVelocity || [0, 0, 0];
        
        // Relative velocity at contact point
        const relVelX = velB[0] - velA[0];
        const relVelY = velB[1] - velA[1];
        const relVelZ = velB[2] - velA[2];
        
        // Normal velocity
        const normalVel = relVelX * edge.normal[0] + 
                          relVelY * edge.normal[1] + 
                          relVelZ * edge.normal[2];
        
        // Don't resolve separating contacts
        if (normalVel > 0) return;
        
        // Effective mass
        const invMassA = nodeA.invMass;
        const invMassB = nodeB.invMass;
        const effectiveMass = invMassA + invMassB;
        
        if (effectiveMass === 0) return;
        
        // Restitution
        const restitution = isShockPhase ? 0 : edge.restitution;
        
        // Baumgarte stabilization (position correction)
        const bias = this.baumgarte / dt * Math.max(0, edge.penetration - this.slop);
        
        // Impulse magnitude
        let j = -(1 + restitution) * normalVel + bias;
        j /= effectiveMass;
        
        // Clamp to prevent pulling
        const oldImpulse = edge.impulse;
        edge.impulse = Math.max(oldImpulse + j, 0);
        j = edge.impulse - oldImpulse;
        
        // Apply impulse
        const impulseX = edge.normal[0] * j;
        const impulseY = edge.normal[1] * j;
        const impulseZ = edge.normal[2] * j;
        
        if (!nodeA.isStatic && bodyA.linearVelocity) {
            bodyA.linearVelocity[0] -= impulseX * invMassA;
            bodyA.linearVelocity[1] -= impulseY * invMassA;
            bodyA.linearVelocity[2] -= impulseZ * invMassA;
        }
        
        if (!nodeB.isStatic && bodyB.linearVelocity) {
            bodyB.linearVelocity[0] += impulseX * invMassB;
            bodyB.linearVelocity[1] += impulseY * invMassB;
            bodyB.linearVelocity[2] += impulseZ * invMassB;
        }
        
        // Friction impulse
        this._solveFriction(edge, invMassA, invMassB, j);
    }
    
    /**
     * Solve friction constraint
     */
    _solveFriction(edge, invMassA, invMassB, normalImpulse) {
        const nodeA = edge.nodeA;
        const nodeB = edge.nodeB;
        const bodyA = nodeA.body;
        const bodyB = nodeB.body;
        
        // Get velocities
        const velA = bodyA.linearVelocity || [0, 0, 0];
        const velB = bodyB.linearVelocity || [0, 0, 0];
        
        // Relative velocity
        const relVelX = velB[0] - velA[0];
        const relVelY = velB[1] - velA[1];
        const relVelZ = velB[2] - velA[2];
        
        // Tangent velocity (remove normal component)
        const normalVel = relVelX * edge.normal[0] + 
                          relVelY * edge.normal[1] + 
                          relVelZ * edge.normal[2];
        
        const tangentX = relVelX - edge.normal[0] * normalVel;
        const tangentY = relVelY - edge.normal[1] * normalVel;
        const tangentZ = relVelZ - edge.normal[2] * normalVel;
        
        const tangentLen = Math.sqrt(tangentX * tangentX + tangentY * tangentY + tangentZ * tangentZ);
        if (tangentLen < 1e-6) return;
        
        // Normalize tangent
        const invTangentLen = 1 / tangentLen;
        const tX = tangentX * invTangentLen;
        const tY = tangentY * invTangentLen;
        const tZ = tangentZ * invTangentLen;
        
        // Friction impulse (clamped by Coulomb friction)
        const effectiveMass = invMassA + invMassB;
        let jt = -tangentLen / effectiveMass;
        
        const maxFriction = edge.friction * Math.abs(normalImpulse);
        jt = Math.max(-maxFriction, Math.min(maxFriction, jt));
        
        // Apply friction impulse
        const frictionX = tX * jt;
        const frictionY = tY * jt;
        const frictionZ = tZ * jt;
        
        if (!nodeA.isStatic && bodyA.linearVelocity) {
            bodyA.linearVelocity[0] -= frictionX * invMassA;
            bodyA.linearVelocity[1] -= frictionY * invMassA;
            bodyA.linearVelocity[2] -= frictionZ * invMassA;
        }
        
        if (!nodeB.isStatic && bodyB.linearVelocity) {
            bodyB.linearVelocity[0] += frictionX * invMassB;
            bodyB.linearVelocity[1] += frictionY * invMassB;
            bodyB.linearVelocity[2] += frictionZ * invMassB;
        }
    }
    
    /**
     * Get debug info about the contact graph
     */
    getDebugInfo() {
        return {
            bodyCount: this.nodes.size,
            contactCount: this.edges.length,
            levelCount: this.levels.length,
            levels: this.levels.map((level, i) => ({
                level: i,
                bodyCount: level ? level.length : 0,
            })),
        };
    }
}

/**
 * Integrate shock propagation with existing physics world
 * Call this after broad/narrow phase but before velocity integration
 * 
 * @param {Object} world - Physics world
 * @param {Array} contacts - Contact pairs from narrow phase
 * @param {number} dt - Time step
 */
export function applyShockPropagation(world, contacts, dt) {
    const solver = new ShockPropagationSolver();
    
    // Add all bodies
    for (const [id, body] of world.bodies || []) {
        solver.addBody(id, body);
    }
    
    // Add contacts
    for (const contact of contacts) {
        solver.addContact(contact.bodyIdA, contact.bodyIdB, {
            normal: contact.normal,
            penetration: contact.penetration,
            point: contact.point,
            friction: contact.friction || 0.5,
            restitution: contact.restitution || 0.25,
        });
    }
    
    // Solve
    solver.solve(dt);
    
    return solver.getDebugInfo();
}
