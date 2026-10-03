// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * EventRouter - Event capture/target/bubble routing system for Plauna
 * Handles DOM-style event propagation with capture and bubble phases
 */

export class EventRouter {
    constructor() {
        this.eventListeners = new Map(); // eventType -> Set of listeners
        this.globalListeners = new Map();   // eventType -> Set of global listeners
        this.focusManager = null;
        this.performanceStats = {
            totalEvents: 0,
            totalTime: 0,
            averageTime: 0
        };
    }

    // Set focus manager
    setFocusManager(focusManager) {
        this.focusManager = focusManager;
    }

    // Add event listener to a specific node
    addEventListener(node, eventType, handler, options = {}) {
        const key = `${node.id}_${eventType}`;
        
        if (!this.eventListeners.has(key)) {
            this.eventListeners.set(key, new Set());
        }
        
        const listener = {
            handler,
            capture: options.capture || false,
            passive: options.passive || false,
            once: options.once || false
        };
        
        this.eventListeners.get(key).add(listener);
        
        // Return remove function
        return () => this.removeEventListener(node, eventType, handler, options);
    }

    // Remove event listener from a node
    removeEventListener(node, eventType, handler, options = {}) {
        const key = `${node.id}_${eventType}`;
        const listeners = this.eventListeners.get(key);
        
        if (listeners) {
            for (const listener of listeners) {
                if (listener.handler === handler && 
                    listener.capture === (options.capture || false)) {
                    listeners.delete(listener);
                    
                    if (listeners.size === 0) {
                        this.eventListeners.delete(key);
                    }
                    
                    break;
                }
            }
        }
    }

    // Add global event listener
    addGlobalListener(eventType, handler, options = {}) {
        if (!this.globalListeners.has(eventType)) {
            this.globalListeners.set(eventType, new Set());
        }
        
        const listener = {
            handler,
            capture: options.capture || false,
            passive: options.passive || false,
            once: options.once || false
        };
        
        this.globalListeners.get(eventType).add(listener);
        
        // Return remove function
        return () => this.removeGlobalListener(eventType, handler, options);
    }

    // Remove global event listener
    removeGlobalListener(eventType, handler, options = {}) {
        const listeners = this.globalListeners.get(eventType);
        
        if (listeners) {
            for (const listener of listeners) {
                if (listener.handler === handler && 
                    listener.capture === (options.capture || false)) {
                    listeners.delete(listener);
                    
                    if (listeners.size === 0) {
                        this.globalListeners.delete(eventType);
                    }
                    
                    break;
                }
            }
        }
    }

    // Route event through the visual tree
    routeEvent(event, targetNode, rootNode) {
        const startTime = performance.now();
        
        // Create event object
        const plaunaEvent = this.createEvent(event, targetNode);
        
        try {
            // Capture phase
            if (!this.capturePhase(plaunaEvent, targetNode, rootNode)) {
                return false; // Event was cancelled
            }
            
            // Target phase
            if (!this.targetPhase(plaunaEvent, targetNode)) {
                return false; // Event was cancelled
            }
            
            // Bubble phase
            if (!this.bubblePhase(plaunaEvent, targetNode, rootNode)) {
                return false; // Event was cancelled
            }
            
            return !plaunaEvent.defaultPrevented;
            
        } finally {
            // Update performance stats
            const duration = performance.now() - startTime;
            this.performanceStats.totalEvents++;
            this.performanceStats.totalTime += duration;
            this.performanceStats.averageTime = this.performanceStats.totalTime / this.performanceStats.totalEvents;
        }
    }

    // Capture phase
    capturePhase(event, targetNode, rootNode) {
        const capturePath = [];
        
        // Build capture path (root to target)
        let current = targetNode;
        while (current && current !== rootNode) {
            capturePath.unshift(current);
            current = current.parent;
        }
        
        if (rootNode && !capturePath.includes(rootNode)) {
            capturePath.unshift(rootNode);
        }
        
        // Execute capture listeners
        for (const node of capturePath) {
            if (this.executeListeners(node, event, 'capture')) {
                return false; // Event was stopped
            }
            
            if (event.propagationStopped) {
                break;
            }
        }
        
        return true;
    }

    // Target phase
    targetPhase(event, targetNode) {
        // Execute target listeners
        return !this.executeListeners(targetNode, event, 'target');
    }

    // Bubble phase
    bubblePhase(event, targetNode, rootNode) {
        // Build bubble path (target to root)
        const bubblePath = [];
        let current = targetNode.parent;
        
        while (current && current !== rootNode) {
            bubblePath.push(current);
            current = current.parent;
        }
        
        if (rootNode && !bubblePath.includes(rootNode)) {
            bubblePath.push(rootNode);
        }
        
        // Execute bubble listeners
        for (const node of bubblePath) {
            if (this.executeListeners(node, event, 'bubble')) {
                return false; // Event was stopped
            }
            
            if (event.propagationStopped) {
                break;
            }
        }
        
        return true;
    }

    // Execute listeners for a node
    executeListeners(node, event, phase) {
        const key = `${node.id}_${event.type}`;
        const listeners = this.eventListeners.get(key);
        
        if (!listeners) return false;
        
        let stopped = false;
        const toRemove = [];
        
        for (const listener of listeners) {
            // Check phase
            if (phase === 'capture' && !listener.capture) continue;
            if (phase === 'target' && listener.capture) continue;
            if (phase === 'bubble' && listener.capture) continue;
            
            try {
                // Execute listener
                const result = listener.handler.call(node, event);
                
                // Handle once listeners
                if (listener.once) {
                    toRemove.push(listener);
                }
                
                // Check if listener returned false to stop propagation
                if (result === false) {
                    stopped = true;
                    break;
                }
                
            } catch (error) {
                console.error(`Error in event listener for ${event.type} on node ${node.id}:`, error);
            }
        }
        
        // Remove once listeners
        for (const listener of toRemove) {
            listeners.delete(listener);
        }
        
        return stopped;
    }

    // Execute global listeners
    executeGlobalListeners(event, phase) {
        const listeners = this.globalListeners.get(event.type);
        
        if (!listeners) return;
        
        const toRemove = [];
        
        for (const listener of listeners) {
            // Check phase
            if (phase === 'capture' && !listener.capture) continue;
            if (phase === 'target' && listener.capture) continue;
            if (phase === 'bubble' && listener.capture) continue;
            
            try {
                listener.handler(event);
                
                // Handle once listeners
                if (listener.once) {
                    toRemove.push(listener);
                }
                
            } catch (error) {
                console.error(`Error in global event listener for ${event.type}:`, error);
            }
        }
        
        // Remove once listeners
        for (const listener of toRemove) {
            listeners.delete(listener);
        }
    }

    // Create Plauna event object
    createEvent(originalEvent, targetNode) {
        const event = {
            type: originalEvent.type,
            target: targetNode,
            currentTarget: targetNode,
            timeStamp: Date.now(),
            
            // Mouse/pointer properties
            clientX: originalEvent.clientX || 0,
            clientY: originalEvent.clientY || 0,
            screenX: originalEvent.screenX || 0,
            screenY: originalEvent.screenY || 0,
            button: originalEvent.button || 0,
            buttons: originalEvent.buttons || 0,
            
            // Keyboard properties
            key: originalEvent.key || '',
            code: originalEvent.code || '',
            ctrlKey: originalEvent.ctrlKey || false,
            shiftKey: originalEvent.shiftKey || false,
            altKey: originalEvent.altKey || false,
            metaKey: originalEvent.metaKey || false,
            
            // Event state
            defaultPrevented: false,
            propagationStopped: false,
            immediatePropagationStopped: false,
            
            // Event methods
            preventDefault: function() {
                this.defaultPrevented = true;
            },
            stopPropagation: function() {
                this.propagationStopped = true;
            },
            stopImmediatePropagation: function() {
                this.immediatePropagationStopped = true;
                this.propagationStopped = true;
            }
        };
        
        return event;
    }

    // Find node at coordinates
    getNodeAtCoordinates(rootNode, x, y) {
        const nodes = [];
        
        // Collect all nodes in reverse order (top to bottom)
        this.traverseDepthFirstReverse(rootNode, node => {
            if (this.isPointInNode(node, x, y)) {
                nodes.push(node);
            }
        });
        
        // Return the topmost node
        return nodes[0] || null;
    }

    // Check if point is in node
    isPointInNode(node, x, y) {
        const box = node.layoutBox;
        
        // Simple rectangular hit test
        return x >= box.x && x <= box.x + box.width &&
               y >= box.y && y <= box.y + box.height;
    }

    // Traverse tree in reverse depth-first order
    traverseDepthFirstReverse(node, callback) {
        // Visit children first (reverse order)
        for (let i = node.children.length - 1; i >= 0; i--) {
            this.traverseDepthFirstReverse(node.children[i], callback);
        }
        
        // Visit node
        callback(node);
    }

    // Handle special events
    handleFocusEvent(event, targetNode, rootNode) {
        if (!this.focusManager) return;
        
        switch (event.type) {
            case 'focus':
                this.focusManager.setFocusedNode(targetNode);
                break;
            case 'blur':
                this.focusManager.setFocusedNode(null);
                break;
            case 'keydown':
                this.handleKeyboardNavigation(event, targetNode, rootNode);
                break;
        }
    }

    // Handle keyboard navigation
    handleKeyboardNavigation(event, targetNode, rootNode) {
        if (!this.focusManager) return;
        
        switch (event.key) {
            case 'Tab':
                event.preventDefault();
                const nextFocusable = this.focusManager.getNextFocusable(
                    targetNode, 
                    event.shiftKey ? -1 : 1
                );
                if (nextFocusable) {
                    this.focusManager.setFocusedNode(nextFocusable);
                }
                break;
            case 'ArrowUp':
            case 'ArrowDown':
            case 'ArrowLeft':
            case 'ArrowRight':
                if (!event.ctrlKey && !event.metaKey) {
                    event.preventDefault();
                    const direction = this.getArrowDirection(event.key);
                    const nextFocusable = this.focusManager.getFocusableInDirection(
                        targetNode,
                        direction
                    );
                    if (nextFocusable) {
                        this.focusManager.setFocusedNode(nextFocusable);
                    }
                }
                break;
            case 'Enter':
            case ' ':
                // Activate focused node
                if (targetNode.hasState(NODE_STATE.FOCUSED)) {
                    this.activateNode(targetNode);
                    event.preventDefault();
                }
                break;
        }
    }

    // Get arrow direction
    getArrowDirection(key) {
        switch (key) {
            case 'ArrowUp': return 'up';
            case 'ArrowDown': return 'down';
            case 'ArrowLeft': return 'left';
            case 'ArrowRight': return 'right';
            default: return null;
        }
    }

    // Activate node (simulate click)
    activateNode(node) {
        const clickEvent = {
            type: 'click',
            target: node,
            currentTarget: node,
            timeStamp: Date.now(),
            clientX: node.layoutBox.x + node.layoutBox.width / 2,
            clientY: node.layoutBox.y + node.layoutBox.height / 2,
            button: 0,
            defaultPrevented: false,
            propagationStopped: false,
            immediatePropagationStopped: false,
            preventDefault: function() { this.defaultPrevented = true; },
            stopPropagation: function() { this.propagationStopped = true; },
            stopImmediatePropagation: function() { 
                this.immediatePropagationStopped = true; 
                this.propagationStopped = true; 
            }
        };
        
        // Dispatch click event
        node.dispatchEvent(clickEvent);
    }

    // Get performance stats
    getPerformanceStats() {
        return { ...this.performanceStats };
    }

    // Reset performance stats
    resetPerformanceStats() {
        this.performanceStats = {
            totalEvents: 0,
            totalTime: 0,
            averageTime: 0
        };
    }

    // Clear all listeners
    clearAllListeners() {
        this.eventListeners.clear();
        this.globalListeners.clear();
    }

    // Debug methods
    printListeners() {
        console.log('Event Listeners:');
        
        for (const [key, listeners] of this.eventListeners) {
            console.log(`  ${key}: ${listeners.size} listeners`);
        }
        
        console.log('Global Listeners:');
        
        for (const [eventType, listeners] of this.globalListeners) {
            console.log(`  ${eventType}: ${listeners.size} listeners`);
        }
    }

    // Validate event system
    validate() {
        const errors = [];
        
        // Check for invalid listener configurations
        for (const [key, listeners] of this.eventListeners) {
            for (const listener of listeners) {
                if (typeof listener.handler !== 'function') {
                    errors.push(`Invalid handler for ${key}`);
                }
            }
        }
        
        // Check global listeners
        for (const [eventType, listeners] of this.globalListeners) {
            for (const listener of listeners) {
                if (typeof listener.handler !== 'function') {
                    errors.push(`Invalid global handler for ${eventType}`);
                }
            }
        }
        
        if (errors.length > 0) {
            console.error('EventRouter validation errors:', errors);
            return false;
        }
        
        return true;
    }

    // Destroy
    destroy() {
        this.clearAllListeners();
        this.focusManager = null;
        this.resetPerformanceStats();
    }
}

// Event type constants
export const EVENT_TYPES = {
    // Mouse events
    CLICK: 'click',
    DOUBLE_CLICK: 'dblclick',
    MOUSE_DOWN: 'mousedown',
    MOUSE_UP: 'mouseup',
    MOUSE_MOVE: 'mousemove',
    MOUSE_ENTER: 'mouseenter',
    MOUSE_LEAVE: 'mouseleave',
    MOUSE_OVER: 'mouseover',
    MOUSE_OUT: 'mouseout',
    WHEEL: 'wheel',
    
    // Keyboard events
    KEY_DOWN: 'keydown',
    KEY_UP: 'keyup',
    KEY_PRESS: 'keypress',
    
    // Focus events
    FOCUS: 'focus',
    BLUR: 'blur',
    FOCUS_IN: 'focusin',
    FOCUS_OUT: 'focusout',
    
    // Touch events
    TOUCH_START: 'touchstart',
    TOUCH_END: 'touchend',
    TOUCH_MOVE: 'touchmove',
    TOUCH_CANCEL: 'touchcancel',
    
    // Drag events
    DRAG_START: 'dragstart',
    DRAG: 'drag',
    DRAG_END: 'dragend',
    DRAG_ENTER: 'dragenter',
    DRAG_LEAVE: 'dragleave',
    DRAG_OVER: 'dragover',
    DROP: 'drop',
    
    // Form events
    SUBMIT: 'submit',
    RESET: 'reset',
    CHANGE: 'change',
    INPUT: 'input'
};

// Utility functions for event handling
export const EventUtils = {
    // Check if event is a mouse event
    isMouseEvent(event) {
        return EVENT_TYPES.CLICK in EVENT_TYPES && 
               Object.values(EVENT_TYPES).includes(event.type);
    },
    
    // Check if event is a keyboard event
    isKeyboardEvent(event) {
        return event.type === EVENT_TYPES.KEY_DOWN || 
               event.type === EVENT_TYPES.KEY_UP || 
               event.type === EVENT_TYPES.KEY_PRESS;
    },
    
    // Check if event is a touch event
    isTouchEvent(event) {
        return event.type.startsWith('touch');
    },
    
    // Get event coordinates relative to a node
    getRelativeCoordinates(event, node) {
        const box = node.layoutBox;
        return {
            x: event.clientX - box.x,
            y: event.clientY - box.y
        };
    },
    
    // Check if event modifier keys are pressed
    hasModifierKeys(event) {
        return event.ctrlKey || event.shiftKey || event.altKey || event.metaKey;
    },
    
    // Create synthetic event
    createSyntheticEvent(type, properties = {}) {
        return {
            type,
            timeStamp: Date.now(),
            defaultPrevented: false,
            propagationStopped: false,
            immediatePropagationStopped: false,
            preventDefault: function() { this.defaultPrevented = true; },
            stopPropagation: function() { this.propagationStopped = true; },
            stopImmediatePropagation: function() { 
                this.immediatePropagationStopped = true; 
                this.propagationStopped = true; 
            },
            ...properties
        };
    }
};
