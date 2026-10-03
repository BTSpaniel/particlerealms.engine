// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * DirtyGraph - Optimized dirty flag propagation and update scheduling.
 *
 * Dirty flag management pattern:
 * - Efficient dirty flag propagation for large UI trees
 * - Categorizes dirty flags by type (STYLE, LAYOUT, PAINT, etc.)
 * - Batch processing of dirty nodes
 * - Performance tracking for propagation timing
 *
 * Propagation rules:
 * - LAYOUT dirtiness propagates to parent
 * - PAINT dirtiness propagates to parent if node affects parent's paint
 * - CHILDREN dirtiness propagates to descendants
 * - STYLE dirtiness propagates to descendants if style affects them
 *
 * Architecture:
 * - dirtyNodes: Set of all dirty nodes
 * - dirtySets: Map of flag → Set of nodes (categorized by flag type)
 * - propagationQueue: Queue for deferred propagations
 * - isProcessing: Flag to prevent re-entrant propagation
 */
import { DIRTY } from './UINode.js';

export class DirtyGraph {
    constructor() {
        this.dirtyNodes = new Set();
        this.dirtySets = new Map(); // flag -> Set of nodes
        this.propagationQueue = [];
        this.isProcessing = false;
        
        // Performance tracking
        this.totalNodesProcessed = 0;
        this.totalPropagationTime = 0;
        
        // Initialize dirty sets for each flag
        this.dirtySets.set(DIRTY.STYLE, new Set());
        this.dirtySets.set(DIRTY.LAYOUT, new Set());
        this.dirtySets.set(DIRTY.PAINT, new Set());
        this.dirtySets.set(DIRTY.TEXT, new Set());
        this.dirtySets.set(DIRTY.ACCESSIBILITY, new Set());
        this.dirtySets.set(DIRTY.CHILDREN, new Set());
        this.dirtySets.set(DIRTY.FOCUS, new Set());
    }

    // Mark a node as dirty
    markDirty(node, flags) {
        const wasDirty = this.dirtyNodes.has(node);
        const oldFlags = node.dirtyFlags;
        
        node.dirtyFlags |= flags;
        this.dirtyNodes.add(node);
        
        // Add to specific dirty sets
        for (const [flag, set] of this.dirtySets) {
            if (flags & flag) {
                set.add(node);
            }
        }
        
        // Propagate dirtiness if needed
        if (!wasDirty || (node.dirtyFlags & ~oldFlags)) {
            this.propagateDirtiness(node, flags & ~oldFlags);
        }
    }

    // Propagate dirty flags to related nodes
    propagateDirtiness(node, newFlags) {
        if (this.isProcessing) {
            // Defer propagation if we're already processing
            this.propagationQueue.push({ node, flags: newFlags });
            return;
        }
        
        this.isProcessing = true;
        const startTime = performance.now();
        
        try {
            this.processPropagation(node, newFlags);
        } finally {
            this.isProcessing = false;
            this.totalPropagationTime += performance.now() - startTime;
            
            // Process deferred propagations
            if (this.propagationQueue.length > 0) {
                const deferred = this.propagationQueue.splice(0);
                for (const { node: deferredNode, flags: deferredFlags } of deferred) {
                    this.processPropagation(deferredNode, deferredFlags);
                }
            }
        }
    }

    processPropagation(node, flags) {
        // Propagate layout dirtiness to parent
        if (flags & DIRTY.LAYOUT && node.parent) {
            this.markDirty(node.parent, DIRTY.LAYOUT);
        }
        
        // Propagate paint dirtiness to parent if node affects parent's paint
        if (flags & DIRTY.PAINT && node.parent && this.affectsParentPaint(node)) {
            this.markDirty(node.parent, DIRTY.PAINT);
        }
        
        // Propagate children dirtiness to descendants
        if (flags & DIRTY.CHILDREN && node.children.length > 0) {
            for (const child of node.children) {
                this.markDirty(child, DIRTY.CHILDREN | DIRTY.LAYOUT);
            }
        }
        
        // Propagate style dirtiness to descendants if needed
        if (flags & DIRTY.STYLE && this.styleAffectsDescendants(node)) {
            for (const child of node.children) {
                this.markDirty(child, DIRTY.STYLE);
            }
        }
        
        // Propagate accessibility dirtiness to descendants
        if (flags & DIRTY.ACCESSIBILITY && node.children.length > 0) {
            for (const child of node.children) {
                this.markDirty(child, DIRTY.ACCESSIBILITY);
            }
        }
    }

    // Clear dirty flags for a node
    clearDirty(node, flags) {
        const clearedFlags = node.dirtyFlags & flags;
        node.dirtyFlags &= ~flags;
        
        // Remove from dirty sets
        for (const [flag, set] of this.dirtySets) {
            if (clearedFlags & flag) {
                set.delete(node);
            }
        }
        
        // Remove from main dirty set if no longer dirty
        if (node.dirtyFlags === 0) {
            this.dirtyNodes.delete(node);
        }
    }

    // Get all nodes with specific dirty flags
    getDirtyNodes(flags = DIRTY.ALL) {
        if (flags === DIRTY.ALL) {
            return new Set(this.dirtyNodes);
        }
        
        const result = new Set();
        for (const [flag, set] of this.dirtySets) {
            if (flags & flag) {
                for (const node of set) {
                    result.add(node);
                }
            }
        }
        
        return result;
    }

    // Get dirty nodes sorted by dependency order
    getSortedDirtyNodes(flags = DIRTY.ALL) {
        const dirtyNodes = this.getDirtyNodes(flags);
        const nodes = Array.from(dirtyNodes);
        
        // Sort by depth (parents before children)
        nodes.sort((a, b) => this.getNodeDepth(a) - this.getNodeDepth(b));
        
        return nodes;
    }

    // Check if a node is dirty
    isDirty(node, flags = DIRTY.ALL) {
        return this.dirtyNodes.has(node) && (node.dirtyFlags & flags) !== 0;
    }

    // Check if any nodes are dirty
    hasDirtyNodes(flags = DIRTY.ALL) {
        if (flags === DIRTY.ALL) {
            return this.dirtyNodes.size > 0;
        }
        
        for (const [flag, set] of this.dirtySets) {
            if (flags & flag && set.size > 0) {
                return true;
            }
        }
        
        return false;
    }

    // Get count of dirty nodes by flag
    getDirtyCounts() {
        const counts = {};
        for (const [flag, set] of this.dirtySets) {
            counts[flag] = set.size;
        }
        counts.total = this.dirtyNodes.size;
        return counts;
    }

    // Helper methods
    getNodeDepth(node) {
        let depth = 0;
        let current = node;
        while (current.parent) {
            depth++;
            current = current.parent;
        }
        return depth;
    }

    affectsParentPaint(node) {
        // Nodes with certain properties affect parent's paint
        return node.hasRenderFlag(RENDER_FLAGS.TRANSFORM_CHANGED) ||
               node.hasRenderFlag(RENDER_FLAGS.OPACITY_CHANGED) ||
               node.style.position === 'absolute' ||
               node.style.position === 'relative';
    }

    styleAffectsDescendants(node) {
        // Certain style properties affect descendants
        return node.style.fontSize !== undefined ||
               node.style.fontFamily !== undefined ||
               node.style.color !== undefined ||
               node.style.visibility !== undefined ||
               node.style.pointerEvents !== undefined;
    }

    // Batch operations
    markDirtyBatch(nodes, flags) {
        for (const node of nodes) {
            this.markDirty(node, flags);
        }
    }

    clearDirtyBatch(nodes, flags) {
        for (const node of nodes) {
            this.clearDirty(node, flags);
        }
    }

    // Clear all dirty flags
    clearAllDirty() {
        for (const node of this.dirtyNodes) {
            node.dirtyFlags = 0;
        }
        
        this.dirtyNodes.clear();
        for (const set of this.dirtySets.values()) {
            set.clear();
        }
        
        this.propagationQueue = [];
    }

    // Performance metrics
    getPerformanceStats() {
        return {
            totalNodesProcessed: this.totalNodesProcessed,
            totalPropagationTime: this.totalPropagationTime,
            averagePropagationTime: this.totalNodesProcessed > 0 ? 
                this.totalPropagationTime / this.totalNodesProcessed : 0,
            dirtyCounts: this.getDirtyCounts(),
            propagationQueueLength: this.propagationQueue.length
        };
    }

    resetPerformanceStats() {
        this.totalNodesProcessed = 0;
        this.totalPropagationTime = 0;
    }

    // Debug methods
    printDirtyNodes(flags = DIRTY.ALL, maxNodes = 50) {
        const dirtyNodes = this.getSortedDirtyNodes(flags);
        const limited = dirtyNodes.slice(0, maxNodes);
        
        console.log(`Dirty nodes (${limited.length}/${dirtyNodes.length}):`);
        for (const node of limited) {
            console.log(`  ${node.type}#${node.id} (${this.getFlagNames(node.dirtyFlags)})`);
        }
        
        if (dirtyNodes.length > maxNodes) {
            console.log(`  ... and ${dirtyNodes.length - maxNodes} more`);
        }
    }

    getFlagNames(flags) {
        const names = [];
        for (const [flag, name] of Object.entries(DIRTY)) {
            if (flags & flag) {
                names.push(name);
            }
        }
        return names.join(', ');
    }

    // Validation
    validate() {
        const errors = [];
        
        // Check that dirtyNodes contains all nodes from dirtySets
        for (const [flag, set] of this.dirtySets) {
            for (const node of set) {
                if (!this.dirtyNodes.has(node)) {
                    errors.push(`Node ${node.id} in dirty set ${flag} but not in main dirty set`);
                }
                if ((node.dirtyFlags & flag) === 0) {
                    errors.push(`Node ${node.id} in dirty set ${flag} but flag not set`);
                }
            }
        }
        
        // Check that all nodes in dirtyNodes have corresponding dirty flags
        for (const node of this.dirtyNodes) {
            if (node.dirtyFlags === 0) {
                errors.push(`Node ${node.id} in dirty set but has no dirty flags`);
            }
            
            // Check that node is in appropriate dirty sets
            for (const [flag, set] of this.dirtySets) {
                if ((node.dirtyFlags & flag) && !set.has(node)) {
                    errors.push(`Node ${node.id} has dirty flag ${flag} but not in dirty set`);
                }
                if (!(node.dirtyFlags & flag) && set.has(node)) {
                    errors.push(`Node ${node.id} doesn't have dirty flag ${flag} but is in dirty set`);
                }
            }
        }
        
        if (errors.length > 0) {
            console.error('DirtyGraph validation errors:', errors);
            return false;
        }
        
        return true;
    }

    // Cleanup
    destroy() {
        this.clearAllDirty();
        this.dirtySets.clear();
        this.propagationQueue = [];
        this.isProcessing = false;
    }
}

// Static helper for creating dirty flag combinations
export const DirtyFlags = {
    STYLE_ONLY: DIRTY.STYLE,
    LAYOUT_ONLY: DIRTY.LAYOUT,
    PAINT_ONLY: DIRTY.PAINT,
    TEXT_ONLY: DIRTY.TEXT,
    ACCESSIBILITY_ONLY: DIRTY.ACCESSIBILITY,
    CHILDREN_ONLY: DIRTY.CHILDREN,
    FOCUS_ONLY: DIRTY.FOCUS,
    
    STYLE_LAYOUT: DIRTY.STYLE | DIRTY.LAYOUT,
    LAYOUT_PAINT: DIRTY.LAYOUT | DIRTY.PAINT,
    STYLE_PAINT: DIRTY.STYLE | DIRTY.PAINT,
    STYLE_LAYOUT_PAINT: DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT,
    
    TEXT_PAINT: DIRTY.TEXT | DIRTY.PAINT,
    CHILDREN_LAYOUT: DIRTY.CHILDREN | DIRTY.LAYOUT,
    
    ALL_RENDER: DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.TEXT,
    ALL_UI: DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.TEXT | DIRTY.ACCESSIBILITY,
    ALL: DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.TEXT | DIRTY.ACCESSIBILITY | DIRTY.CHILDREN | DIRTY.FOCUS
};
