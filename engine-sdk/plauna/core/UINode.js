// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ============================================================================
 * UINode - Retained Visual Tree Node
 * ============================================================================
 *
 * UINode is the base class for all UI nodes in Plauna's retained visual tree.
 * It represents a node in a virtual DOM-like tree that can be rendered to actual DOM.
 *
 * KEY CONCEPTS:
 * - Retained Mode: The tree persists in memory and is incrementally updated
 * - Dirty Flags: Bits that track what parts of the node need re-rendering
 * - Layout Box: Computed layout metrics (position, size, margins, padding)
 * - Event Handlers: Map of event types to handler functions
 * - Accessibility: ARIA attributes and role information
 *
 * DIRTY FLAGS (bitmask):
 * - STYLE: CSS styles changed → re-apply styles to DOM
 * - LAYOUT: Position/size changed → re-compute layout
 * - PAINT: Visual appearance changed → re-render to DOM
 * - TEXT: Text content changed → update text nodes
 * - ACCESSIBILITY: ARIA attributes changed → update DOM attributes
 * - CHILDREN: Child nodes added/removed → re-render subtree
 * - FOCUS: Focus state changed → update focus ring
 *
 * NODE STATE (bitmask):
 * - VISIBLE: Node is visible
 * - FOCUSED: Node has keyboard focus
 * - HOVERED: Mouse is over the node
 * - ACTIVE: Node is being pressed/clicked
 * - DISABLED: Node is disabled
 * - FOCUSABLE: Node can receive focus
 * - CHECKED: Checkbox/radio is checked
 * - SELECTED: Option is selected
 * - LOADING: Node is in loading/processing state
 * - ERROR: Node is in error/validation failure state
 *
 * INPUT FLAGS (bitmask):
 * - POINTER_CAPTURE: Node captures pointer events
 * - KEYBOARD_CAPTURE: Node captures keyboard events
 * - DRAG_TARGET: Node is a drag target
 * - DROP_TARGET: Node is a drop target
 * - SCROLLABLE: Node can be scrolled
 *
 * RENDER FLAGS (bitmask):
 * - CLIPS_CONTENT: Children outside bounds are clipped
 * - OPAQUE: Node is fully opaque (optimization hint)
 * - REQUIRES_LAYER: Needs separate compositing layer
 * - TRANSFORM_CHANGED: Transform property changed
 * - OPACITY_CHANGED: Opacity property changed
 *
 * TREE STRUCTURE:
 * - parent: Reference to parent UINode
 * - children: Array of child UINodes
 * - firstChild/lastChild: Linked list pointers for fast traversal
 * - nextSibling/previousSibling: Linked list pointers for siblings
 *
 * LAYOUT BOX:
 * - x, y: Position relative to parent
 * - width, height: Computed size
 * - minX, minY, maxX, maxY: Computed bounds
 * - paddingLeft, paddingTop, paddingRight, paddingBottom: Padding
 * - marginLeft, marginTop, marginRight, marginBottom: Margin
 * - borderLeft, borderTop, borderRight, borderBottom: Border width
 */

import { PlaunaConsole } from '../console/PlaunaConsole.js';

/**
 * UINode - Retained visual tree node.
 *
 * UINode pattern:
 * - Base class for all UI nodes in Plauna's retained visual tree
 * - Virtual DOM-like tree that persists in memory
 * - Incrementally updated via dirty flags
 * - Supports tree structure (parent/children/siblings)
 * - Event handling and accessibility support
 *
 * Key concepts:
 * - Dirty flags: Track what needs re-rendering
 * - Layout box: Computed layout metrics
 * - Event handlers: Map of event types to functions
 * - Accessibility: ARIA attributes and role information
 */
export const DIRTY = {
    STYLE: 1 << 0,
    LAYOUT: 1 << 1,
    PAINT: 1 << 2,
    TEXT: 1 << 3,
    ACCESSIBILITY: 1 << 4,
    CHILDREN: 1 << 5,
    FOCUS: 1 << 6
};

export const NODE_STATE = {
    VISIBLE: 1 << 0,
    FOCUSED: 1 << 1,
    HOVERED: 1 << 2,
    ACTIVE: 1 << 3,
    DISABLED: 1 << 4,
    FOCUSABLE: 1 << 5,
    CHECKED: 1 << 6,
    SELECTED: 1 << 7,
    LOADING: 1 << 8,
    ERROR: 1 << 9
};

export const INPUT_FLAGS = {
    POINTER_CAPTURE: 1 << 0,
    KEYBOARD_CAPTURE: 1 << 1,
    DRAG_TARGET: 1 << 2,
    DROP_TARGET: 1 << 3,
    SCROLLABLE: 1 << 4
};

export const RENDER_FLAGS = {
    CLIPS_CONTENT: 1 << 0,
    OPAQUE: 1 << 1,
    REQUIRES_LAYER: 1 << 2,
    TRANSFORM_CHANGED: 1 << 3,
    OPACITY_CHANGED: 1 << 4
};

export class UINode {
    constructor(id, type = 'node') {
        // Core identity
        this.id = id;
        this.type = type;
        
        // Log node creation
        PlaunaConsole.uinode('created', `${id} (${type})`);
        
        // Tree structure
        this.parent = null;
        this.children = [];
        this.firstChild = null;
        this.lastChild = null;
        this.nextSibling = null;
        this.previousSibling = null;
        
        // Layout and styling
        this.style = {};
        this.computedStyle = null;
        this.layoutBox = {
            x: 0, y: 0, width: 0, height: 0,
            minX: 0, minY: 0, maxX: 0, maxY: 0,
            paddingLeft: 0, paddingTop: 0,
            paddingRight: 0, paddingBottom: 0,
            marginLeft: 0, marginTop: 0,
            marginRight: 0, marginBottom: 0,
            borderLeft: 0, borderTop: 0,
            borderRight: 0, borderBottom: 0
        };
        
        // Content and text
        this.textContent = '';
        this.innerHTML = '';
        
        // DOM element reference (set by WidgetRenderer)
        this.element = null;
        
        // State and flags
        this.stateFlags = NODE_STATE.VISIBLE | NODE_STATE.FOCUSABLE;
        this.inputFlags = 0;
        this.renderFlags = 0;
        this.dirtyFlags = 0;
        
        // Event handlers
        this.eventHandlers = new Map();
        
        // Data binding
        this.bindings = new Map();
        
        // Accessibility
        this.role = null;
        this.ariaLabel = null;
        this.ariaDescription = null;
        this.ariaExpanded = null;
        this.ariaSelected = null;
        
        // Animation
        this.animations = new Map();
        this.transitions = new Map();
        
        // Metadata
        this.userData = {};
        this.tag = null;
        this.className = '';
        
        // Performance tracking
        this.lastLayoutTime = 0;
        this.lastPaintTime = 0;
        this.layoutCount = 0;
        this.paintCount = 0;
    }

    // Get underlying DOM element (after rendering)
    getDOMElement() {
        return this.element;
    }

    // Tree manipulation methods
    appendChild(child) {
        if (child.parent) {
            child.parent.removeChild(child);
        }
        
        child.parent = this;
        
        if (!this.firstChild) {
            this.firstChild = child;
            this.lastChild = child;
        } else {
            child.previousSibling = this.lastChild;
            this.lastChild.nextSibling = child;
            this.lastChild = child;
        }
        
        this.children.push(child);
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.ACCESSIBILITY);
        
        return child;
    }

    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index === -1) return null;
        
        this.children.splice(index, 1);
        child.parent = null;
        
        // Update sibling links
        if (child.previousSibling) {
            child.previousSibling.nextSibling = child.nextSibling;
        }
        if (child.nextSibling) {
            child.nextSibling.previousSibling = child.previousSibling;
        }
        if (this.firstChild === child) {
            this.firstChild = child.nextSibling;
        }
        if (this.lastChild === child) {
            this.lastChild = child.previousSibling;
        }
        
        child.previousSibling = null;
        child.nextSibling = null;
        
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.ACCESSIBILITY);
        
        return child;
    }

    insertBefore(newChild, referenceChild) {
        if (!referenceChild) {
            return this.appendChild(newChild);
        }
        
        if (newChild.parent) {
            newChild.parent.removeChild(newChild);
        }
        
        const refIndex = this.children.indexOf(referenceChild);
        if (refIndex === -1) return null;
        
        this.children.splice(refIndex, 0, newChild);
        newChild.parent = this;
        
        // Update sibling links
        newChild.nextSibling = referenceChild;
        newChild.previousSibling = referenceChild.previousSibling;
        if (referenceChild.previousSibling) {
            referenceChild.previousSibling.nextSibling = newChild;
        }
        if (this.firstChild === referenceChild) {
            this.firstChild = newChild;
        }
        referenceChild.previousSibling = newChild;
        
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.ACCESSIBILITY);
        
        return newChild;
    }

    replaceChild(newChild, oldChild) {
        const index = this.children.indexOf(oldChild);
        if (index === -1) return null;
        
        this.children[index] = newChild;
        
        // Update parent and sibling links
        newChild.parent = this;
        newChild.nextSibling = oldChild.nextSibling;
        newChild.previousSibling = oldChild.previousSibling;
        
        if (oldChild.previousSibling) {
            oldChild.previousSibling.nextSibling = newChild;
        }
        if (oldChild.nextSibling) {
            oldChild.nextSibling.previousSibling = newChild;
        }
        if (this.firstChild === oldChild) {
            this.firstChild = newChild;
        }
        if (this.lastChild === oldChild) {
            this.lastChild = newChild;
        }
        
        oldChild.parent = null;
        oldChild.nextSibling = null;
        oldChild.previousSibling = null;
        
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.ACCESSIBILITY);
        
        return oldChild;
    }

    // Dirty flag management
    markDirty(flags) {
        const oldFlags = this.dirtyFlags;
        this.dirtyFlags |= flags;
        
        // Log dirty flag changes (only for significant changes)
        if (oldFlags !== this.dirtyFlags && (flags & (DIRTY.STYLE | DIRTY.LAYOUT))) {
            PlaunaConsole.uinode('dirty', this.id, { flags, dirtyFlags: this.dirtyFlags });
        }
        
        // Propagate layout dirtiness to parent
        if (flags & DIRTY.LAYOUT && this.parent) {
            this.parent.markDirty(DIRTY.LAYOUT);
        }
    }

    clearDirty(flags) {
        this.dirtyFlags &= ~flags;
    }

    isDirty(flags) {
        return (this.dirtyFlags & flags) !== 0;
    }

    // State management
    setState(state, enabled = true) {
        const oldFlags = this.stateFlags;
        if (enabled) {
            this.stateFlags |= state;
        } else {
            this.stateFlags &= ~state;
        }
        
        if (oldFlags !== this.stateFlags) {
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }

    hasState(state) {
        return (this.stateFlags & state) !== 0;
    }

    // Input flag management
    setInputFlag(flag, enabled = true) {
        const oldFlags = this.inputFlags;
        if (enabled) {
            this.inputFlags |= flag;
        } else {
            this.inputFlags &= ~flag;
        }
        
        if (oldFlags !== this.inputFlags) {
            this.markDirty(DIRTY.ACCESSIBILITY);
        }
    }

    hasInputFlag(flag) {
        return (this.inputFlags & flag) !== 0;
    }

    // Render flag management
    setRenderFlag(flag, enabled = true) {
        const oldFlags = this.renderFlags;
        if (enabled) {
            this.renderFlags |= flag;
        } else {
            this.renderFlags &= ~flag;
        }
        
        if (oldFlags !== this.renderFlags) {
            this.markDirty(DIRTY.PAINT);
        }
    }

    hasRenderFlag(flag) {
        return (this.renderFlags & flag) !== 0;
    }

    // Event handling
    addEventListener(eventType, handler) {
        if (!this.eventHandlers.has(eventType)) {
            this.eventHandlers.set(eventType, []);
        }
        this.eventHandlers.get(eventType).push(handler);
    }

    removeEventListener(eventType, handler) {
        const handlers = this.eventHandlers.get(eventType);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index !== -1) {
                handlers.splice(index, 1);
                if (handlers.length === 0) {
                    this.eventHandlers.delete(eventType);
                }
            }
        }
    }

    dispatchEvent(event) {
        const handlers = this.eventHandlers.get(event.type);
        if (handlers) {
            for (const handler of handlers) {
                handler.call(this, event);
            }
        }
        return !event.defaultPrevented;
    }

    // Styling methods
    setStyle(property, value) {
        if (this.style[property] !== value) {
            const oldValue = this.style[property];
            this.style[property] = value;
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
            
            // Log style changes
            PlaunaConsole.uinode('style', this.id, { property, oldValue, value });
        }
    }

    setStyles(styles) {
        let changed = false;
        for (const [property, value] of Object.entries(styles)) {
            if (this.style[property] !== value) {
                this.style[property] = value;
                changed = true;
            }
        }
        if (changed) {
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }

    getStyle(property) {
        return this.style[property];
    }

    // Layout box methods
    getLayoutBounds() {
        return {
            x: this.layoutBox.x,
            y: this.layoutBox.y,
            width: this.layoutBox.width,
            height: this.layoutBox.height
        };
    }

    setLayoutBounds(x, y, width, height) {
        const changed = this.layoutBox.x !== x || 
                        this.layoutBox.y !== y || 
                        this.layoutBox.width !== width || 
                        this.layoutBox.height !== height;
        
        if (changed) {
            this.layoutBox.x = x;
            this.layoutBox.y = y;
            this.layoutBox.width = width;
            this.layoutBox.height = height;
            this.markDirty(DIRTY.PAINT);
        }
    }

    // Content methods
    setTextContent(text) {
        if (this.textContent !== text) {
            this.textContent = text;
            this.innerHTML = '';
            this.markDirty(DIRTY.TEXT | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }

    // Query methods
    querySelector(selector) {
        // Simple selector implementation for now
        if (this.matches(selector)) {
            return this;
        }
        
        for (const child of this.children) {
            const result = child.querySelector(selector);
            if (result) return result;
        }
        
        return null;
    }

    querySelectorAll(selector) {
        const results = [];
        
        if (this.matches(selector)) {
            results.push(this);
        }
        
        for (const child of this.children) {
            results.push(...child.querySelectorAll(selector));
        }
        
        return results;
    }

    matches(selector) {
        // Very simple selector matching for now
        if (selector.startsWith('.')) {
            const className = selector.slice(1);
            return this.className.includes(className);
        }
        if (selector.startsWith('#')) {
            const id = selector.slice(1);
            return this.id === id;
        }
        if (selector === this.type) {
            return true;
        }
        return false;
    }

    // Tree traversal
    getFirstChild() {
        return this.firstChild;
    }

    getLastChild() {
        return this.lastChild;
    }

    getNextSibling() {
        return this.nextSibling;
    }

    getPreviousSibling() {
        return this.previousSibling;
    }

    getParent() {
        return this.parent;
    }

    getChildren() {
        return [...this.children];
    }

    getChildCount() {
        return this.children.length;
    }

    hasChildren() {
        return this.children.length > 0;
    }

    // Utility methods
    isDescendantOf(node) {
        let current = this.parent;
        while (current) {
            if (current === node) return true;
            current = current.parent;
        }
        return false;
    }

    getRoot() {
        let current = this;
        while (current.parent) {
            current = current.parent;
        }
        return current;
    }

    // Debug methods
    getDebugInfo() {
        return {
            id: this.id,
            type: this.type,
            dirtyFlags: this.dirtyFlags,
            stateFlags: this.stateFlags,
            childCount: this.children.length,
            layoutBox: { ...this.layoutBox },
            style: { ...this.style }
        };
    }

    // Cleanup
    destroy() {
        // Log destruction
        PlaunaConsole.uinode('destroyed', this.id);
        
        // Remove from parent
        if (this.parent) {
            this.parent.removeChild(this);
        }
        
        // Destroy all children
        for (const child of [...this.children]) {
            child.destroy();
        }
        
        // Clear references
        this.parent = null;
        this.children = [];
        this.firstChild = null;
        this.lastChild = null;
        this.nextSibling = null;
        this.previousSibling = null;
        this.eventHandlers.clear();
        this.bindings.clear();
        this.animations.clear();
        this.transitions.clear();
    }

    // Find direct child by ID
    findChild(id) {
        for (const child of this.children) {
            if (child.id === id) {
                return child;
            }
        }
        return null;
    }
}
