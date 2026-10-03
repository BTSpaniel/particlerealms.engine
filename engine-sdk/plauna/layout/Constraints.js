// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Constraints - Size constraint system for Plauna layout
 * Handles min/max/preferred sizes and constraint resolution
 */

import { resolvePlaunaLayoutConstraints } from './LayoutSizing.js';
import { clamp as clampScalar } from '../../engine/core/math/MathScalar.js';

export class Constraints {
    constructor(min = 0, max = Infinity, preferred = 0) {
        this.min = min;
        this.max = max;
        this.preferred = preferred;
    }

    static create(options = {}) {
        return new Constraints(
            options.min || 0,
            options.max !== undefined ? options.max : Infinity,
            options.preferred || 0
        );
    }

    // Create constraints from style properties
    static fromStyle(style, containerSize) {
        const { min, max, preferred } = resolvePlaunaLayoutConstraints(style, containerSize);

        return new Constraints(min, max, preferred);
    }

    // Constrain a value to these constraints
    constrain(value) {
        return Math.max(this.min, clampScalar(value, this.min, this.max));
    }

    // Check if value satisfies constraints
    satisfies(value) {
        return value >= this.min && value <= this.max;
    }

    // Get the best value within constraints
    getBestValue() {
        if (this.satisfies(this.preferred)) {
            return this.preferred;
        }
        if (this.preferred < this.min) {
            return this.min;
        }
        return this.max;
    }

    // Merge with another constraint
    merge(other) {
        return new Constraints(
            Math.max(this.min, other.min),
            Math.min(this.max, other.max),
            this.preferred // Keep original preferred
        );
    }

    // Clone constraints
    clone() {
        return new Constraints(this.min, this.max, this.preferred);
    }

    // Check if constraints are valid
    isValid() {
        return this.min <= this.max && this.min >= 0;
    }

    // Get constraint range
    getRange() {
        return this.max - this.min;
    }

    // Check if constraints are tight (min == max)
    isTight() {
        return this.min === this.max;
    }

    // Check if constraints are loose (large range)
    isLoose() {
        return this.getRange() > this.min * 0.5;
    }

    // Convert to string
    toString() {
        return `Constraints(min=${this.min}, max=${this.max}, preferred=${this.preferred})`;
    }
}

// Box constraints for both dimensions
export class BoxConstraints {
    constructor(width = new Constraints(), height = new Constraints()) {
        this.width = width;
        this.height = height;
    }

    static create(options = {}) {
        return new BoxConstraints(
            Constraints.create(options.width || {}),
            Constraints.create(options.height || {})
        );
    }

    // Create from style properties
    static fromStyle(style, containerWidth, containerHeight) {
        return new BoxConstraints(
            Constraints.fromStyle(style, containerWidth),
            Constraints.fromStyle(style, containerHeight)
        );
    }

    // Constrain a size
    constrainSize(width, height) {
        return {
            width: this.width.constrain(width),
            height: this.height.constrain(height)
        };
    }

    // Get best size within constraints
    getBestSize() {
        return {
            width: this.width.getBestValue(),
            height: this.height.getBestValue()
        };
    }

    // Merge with another box constraint
    merge(other) {
        return new BoxConstraints(
            this.width.merge(other.width),
            this.height.merge(other.height)
        );
    }

    // Clone box constraints
    clone() {
        return new BoxConstraints(this.width.clone(), this.height.clone());
    }

    // Check if constraints are valid
    isValid() {
        return this.width.isValid() && this.height.isValid();
    }

    // Check if constraints are tight in both dimensions
    isTight() {
        return this.width.isTight() && this.height.isTight();
    }

    // Check if constraints are loose in any dimension
    isLoose() {
        return this.width.isLoose() || this.height.isLoose();
    }

    // Convert to string
    toString() {
        return `BoxConstraints(width=${this.width}, height=${this.height})`;
    }
}

// Layout constraint types
export const LayoutConstraintType = {
    FIXED: 'fixed',
    EXPAND: 'expand',
    WRAP_CONTENT: 'wrap_content',
    MATCH_PARENT: 'match_parent'
};

// Layout constraint utilities
export class LayoutConstraints {
    // Create fixed size constraint
    static fixed(width, height) {
        return BoxConstraints.create({
            width: { min: width, max: width, preferred: width },
            height: { min: height, max: height, preferred: height }
        });
    }

    // Create expand constraint (fill available space)
    static expand(minWidth = 0, minHeight = 0) {
        return BoxConstraints.create({
            width: { min: minWidth, max: Infinity, preferred: Infinity },
            height: { min: minHeight, max: Infinity, preferred: Infinity }
        });
    }

    // Create wrap content constraint
    static wrapContent(minWidth = 0, minHeight = 0, maxWidth = Infinity, maxHeight = Infinity) {
        return BoxConstraints.create({
            width: { min: minWidth, max: maxWidth, preferred: 0 },
            height: { min: minHeight, max: maxHeight, preferred: 0 }
        });
    }

    // Create match parent constraint
    static matchParent(minWidth = 0, minHeight = 0) {
        return BoxConstraints.create({
            width: { min: minWidth, max: Infinity, preferred: Infinity },
            height: { min: minHeight, max: Infinity, preferred: Infinity }
        });
    }

    // Create aspect ratio constraint
    static aspectRatio(aspectRatio, baseWidth = null, baseHeight = null) {
        if (baseWidth !== null) {
            const height = baseWidth / aspectRatio;
            return BoxConstraints.create({
                width: { min: baseWidth, max: baseWidth, preferred: baseWidth },
                height: { min: height, max: height, preferred: height }
            });
        } else if (baseHeight !== null) {
            const width = baseHeight * aspectRatio;
            return BoxConstraints.create({
                width: { min: width, max: width, preferred: width },
                height: { min: baseHeight, max: baseHeight, preferred: baseHeight }
            });
        } else {
            // Aspect ratio constraint without base size
            return BoxConstraints.create({
                width: { min: 0, max: Infinity, preferred: 0 },
                height: { min: 0, max: Infinity, preferred: 0 }
            });
        }
    }

    // Apply aspect ratio to existing constraints
    static applyAspectRatio(constraints, aspectRatio) {
        const result = constraints.clone();
        
        // If width is constrained, calculate height
        if (constraints.width.max !== Infinity) {
            const height = constraints.width.max / aspectRatio;
            result.height.min = height;
            result.height.max = height;
            result.height.preferred = height;
        }
        // If height is constrained, calculate width
        else if (constraints.height.max !== Infinity) {
            const width = constraints.height.max * aspectRatio;
            result.width.min = width;
            result.width.max = width;
            result.width.preferred = width;
        }
        
        return result;
    }
}

// Constraint resolver for complex layouts
export class ConstraintResolver {
    constructor() {
        this.constraints = new Map();
    }

    // Add constraint for a node
    addConstraint(nodeId, constraints) {
        this.constraints.set(nodeId, constraints);
    }

    // Get constraint for a node
    getConstraint(nodeId) {
        return this.constraints.get(nodeId);
    }

    // Remove constraint for a node
    removeConstraint(nodeId) {
        this.constraints.delete(nodeId);
    }

    // Resolve constraints for a hierarchy
    resolveHierarchy(rootNode) {
        const resolved = new Map();
        
        this.resolveNode(rootNode, resolved, BoxConstraints.create());
        
        return resolved;
    }

    // Resolve constraints for a single node
    resolveNode(node, resolved, parentConstraints) {
        const nodeConstraint = this.constraints.get(node.id);
        if (!nodeConstraint) {
            resolved.set(node.id, parentConstraints);
            return parentConstraints;
        }

        // Merge with parent constraints
        const merged = parentConstraints.merge(nodeConstraint);
        resolved.set(node.id, merged);

        // Resolve children
        for (const child of node.children) {
            this.resolveNode(child, resolved, merged);
        }

        return merged;
    }

    // Validate all constraints
    validate() {
        const errors = [];

        for (const [nodeId, constraints] of this.constraints) {
            if (!constraints.isValid()) {
                errors.push(`Invalid constraints for node ${nodeId}: ${constraints}`);
            }
        }

        return errors;
    }

    // Clear all constraints
    clear() {
        this.constraints.clear();
    }
}

// Utility functions for common constraint patterns
export const ConstraintUtils = {
    // Create minimum size constraint
    minWidth(width) {
        return Constraints.create({ min: width, max: Infinity, preferred: width });
    },

    minHeight(height) {
        return Constraints.create({ min: height, max: Infinity, preferred: height });
    },

    // Create maximum size constraint
    maxWidth(width) {
        return Constraints.create({ min: 0, max: width, preferred: 0 });
    },

    maxHeight(height) {
        return Constraints.create({ min: 0, max: height, preferred: 0 });
    },

    // Create exact size constraint
    exactSize(width, height) {
        return BoxConstraints.fixed(width, height);
    },

    // Create range constraint
    range(min, max, preferred = min) {
        return Constraints.create({ min, max, preferred });
    },

    // Create percentage constraint
    percentage(percent, containerSize) {
        const value = (percent / 100) * containerSize;
        return Constraints.create({ min: value, max: value, preferred: value });
    },

    // Create responsive constraint (min-content, max-content)
    responsive(minContent = 0, maxContent = Infinity) {
        return Constraints.create({ min: minContent, max: maxContent, preferred: minContent });
    }
};
