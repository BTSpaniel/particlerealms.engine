// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ============================================================================
 * DOMRenderer - Visual Tree to DOM Renderer
 * ============================================================================
 *
 * DOMRenderer connects Plauna's retained-mode UINode system to the browser DOM.
 * It takes a VisualTree (rooted UINode tree) and renders it to actual DOM elements.
 *
 * DIFFERENCES FROM WidgetRenderer:
 * - WidgetRenderer: Converts single UINode widgets to DOM (used by widgets themselves)
 * - DOMRenderer: Renders entire visual tree from game/engine to DOM (used by PlaunaApp)
 *
 * RENDERING FLOW:
 * 1. render(visualTree) - Entry point, renders entire tree to container
 * 2. renderNode(node) - Recursively renders node and all children
 * 3. createDOMElement(node) - Creates DOM element based on node type
 * 4. Applies styles, attributes, and content
 * 5. Updates mapping tables for bidirectional lookup
 *
 * MAPPING TABLES:
 * - nodeToDOM: Map<UINode, HTMLElement> - UINode → DOM element
 * - domToNode: Map<HTMLElement, UINode> - DOM element → UINode (reverse lookup)
 * - renderedNodes: Set<UINode> - Track which nodes have been rendered
 *
 * ELEMENT TYPE HANDLING:
 * - 'text': Renders as <div> with text content
 * - 'button': <button> element
 * - 'input': <input> element with type, value, placeholder, validation attributes
 * - 'image': <img> element with src, alt
 * - 'svg': SVG namespace elements for graphics
 * - Other: <div> as fallback
 *
 * DIRTY FLAG PROCESSING:
 * - DIRTY.STYLE: Re-apply inline styles to DOM
 * - DIRTY.LAYOUT: Re-compute position/size
 * - DIRTY.PAINT: Re-render entire node
 * - DIRTY.TEXT: Update text content
 * - DIRTY.CHILDREN: Re-render child subtree
 *
 * UPDATE MECHANISM:
 * - updateNode(node): Incrementally updates a single node based on dirty flags
 * - updateDOMElement(element, node): Applies node properties to DOM element
 * - processStyleDirty(nodes): Batch updates for style changes
 *
 * TEXT SERVICE:
 * - Optional textService for internationalization
 * - If provided, wraps text content through translation layer
 */

/**
 * DOMRenderer - Visual tree to DOM renderer.
 *
 * Rendering pattern:
 * - Connects Plauna's retained-mode UINode system to browser DOM
 * - Renders entire visual tree from game/engine to DOM
 * - Bidirectional mapping (UINode ↔ DOM element)
 * - Dirty flag processing for incremental updates
 * - Text service integration for internationalization
 *
 * Differences from WidgetRenderer:
 * - WidgetRenderer: Converts single UINode widgets to DOM (used by widgets)
 * - DOMRenderer: Renders entire visual tree from game/engine (used by PlaunaApp)
 *
 * Mapping tables:
 * - nodeToDOM: UINode → DOM element mapping
 * - domToNode: DOM element → UINode (reverse lookup)
 * - renderedNodes: Set of rendered UINodes
 */
import { DIRTY } from './UINode.js';

export class DOMRenderer {
    constructor(options = {}) {
        this.container = options.container || document.body;
        this.textService = options.textService || null;
        this.usePretext = options.usePretext !== false;
        this.nodeToDOM = new Map();
        this.domToNode = new Map();
        this.renderedNodes = new Set();
        this.debugMode = options.debug || false;
    }

    // Render the entire visual tree
    render(visualTree) {
        if (!visualTree || !visualTree.root) {
            console.warn('[DOMRenderer] No visual tree or root node to render');
            return;
        }

        // Clear existing content
        this.clear();

        // Render the root node
        const rootDOM = this.renderNode(visualTree.root);
        
        if (rootDOM && this.container) {
            this.container.appendChild(rootDOM);
        }

        if (this.debugMode) {
            console.log('[DOMRenderer] Rendered visual tree with', this.nodeToDOM.size, 'nodes');
        }
    }

    // Render a single node and its children
    renderNode(node) {
        if (this.nodeToDOM.has(node)) {
            return this.nodeToDOM.get(node);
        }

        // Create DOM element for this node
        const domElement = this.createDOMElement(node);
        
        // Debug: Log what we're creating
        if (this.debugMode && node.id && node.id.includes('background-layer')) {
            console.log('Creating background layer:', node.style);
            console.log('DOM element styles:', domElement.style.cssText);
        }
        
        // Store mapping
        this.nodeToDOM.set(node, domElement);
        this.domToNode.set(domElement, node);
        this.renderedNodes.add(node);

        // Render children
        for (const child of node.children) {
            const childDOM = this.renderNode(child);
            if (childDOM) {
                domElement.appendChild(childDOM);
            }
        }

        return domElement;
    }

    // Create DOM element from UINode
    createDOMElement(node) {
        let element;

        // Create appropriate element type
        switch (node.type) {
            case 'text':
                element = document.createElement('div');
                break;
            case 'button':
                element = document.createElement('button');
                break;
            case 'input':
                element = document.createElement('input');
                element.type = node.type || 'text';
                element.value = node.value || '';
                element.placeholder = node.placeholder || '';
                
                // Handle additional input attributes
                if (node.maxLength !== null) {
                    element.maxLength = node.maxLength;
                }
                if (node.minLength !== null) {
                    element.minLength = node.minLength;
                }
                if (node.pattern !== null) {
                    element.pattern = node.pattern;
                }
                if (node.required !== null) {
                    element.required = node.required;
                }
                if (node.readonly !== null) {
                    element.readOnly = node.readonly;
                }
                if (node.disabled !== null) {
                    element.disabled = node.disabled;
                }
                break;
            case 'panel':
            case 'container':
            default:
                element = document.createElement('div');
                break;
        }

        // Apply styles
        this.applyStyles(element, node);

        // Apply accessibility
        this.applyAccessibility(element, node);

        // Set ID and class
        if (node.id) {
            element.id = node.id;
        }

        if (node.className) {
            element.className = node.className;
        }

        // Add event listeners
        this.attachEventListeners(element, node);

        // Store reference back to UINode
        element._plaunaNode = node;

        if (node.type === 'text' || node.type === 'button') {
            this.renderTextNode(element, node);
        }

        return element;
    }

    getTextStyle(node) {
        const styles = { ...(node.computedStyle || {}), ...(node.style || {}) };
        const fontSize = Number.parseFloat(styles.fontSize) || 14;
        const numericLineHeight = Number.parseFloat(styles.lineHeight);
        const fontWeight = Number.parseInt(styles.fontWeight, 10) || 400;
        return {
            fontFamily: styles.fontFamily || 'Inter',
            fontSize,
            fontWeight,
            lineHeight: Number.isFinite(numericLineHeight) ? numericLineHeight : Math.round(fontSize * 1.45),
            color: typeof styles.color === 'string' ? this.resolveColorToken(styles.color) : styles.color
        };
    }

    getTextLayoutWidth(node) {
        const styles = { ...(node.computedStyle || {}), ...(node.style || {}) };
        const explicitWidth = Number.parseFloat(styles.width);
        if (Number.isFinite(explicitWidth) && explicitWidth > 0) {
            return explicitWidth;
        }
        if (node.layoutBox && Number.isFinite(node.layoutBox.width) && node.layoutBox.width > 0) {
            return node.layoutBox.width;
        }
        return null;
    }

    renderTextNode(element, node) {
        const text = node.textContent || '';
        if (!this.usePretext || !this.textService) {
            element.textContent = text;
            return;
        }

        const style = this.getTextStyle(node);
        const width = this.getTextLayoutWidth(node);
        const handle = this.textService.prepare(text, style);
        const layout = this.textService.layout(handle, width, style.lineHeight);

        element.innerHTML = '';
        element.dataset.pretext = '1';
        element.style.display = 'inline-flex';
        element.style.flexDirection = 'column';
        element.style.alignItems = 'flex-start';
        element.style.whiteSpace = 'normal';
        element.style.lineHeight = `${style.lineHeight}px`;
        if (width) {
            element.style.width = `${width}px`;
        }
        element.style.minHeight = `${layout.height}px`;

        for (const line of layout.lines) {
            const lineElement = document.createElement('span');
            lineElement.textContent = line;
            lineElement.style.display = 'block';
            lineElement.style.lineHeight = `${style.lineHeight}px`;
            lineElement.style.fontFamily = style.fontFamily;
            lineElement.style.fontSize = `${style.fontSize}px`;
            lineElement.style.fontWeight = String(style.fontWeight);
            if (style.color) {
                lineElement.style.color = style.color;
            }
            element.appendChild(lineElement);
        }
    }

    // Apply styles from UINode to DOM element
    applyStyles(element, node) {
        const styles = node.style || {};
        const computedStyle = node.computedStyle || {};

        // Merge computed and explicit styles
        const allStyles = { ...computedStyle, ...styles };

        // Apply each style property
        for (const [property, value] of Object.entries(allStyles)) {
            if (value !== undefined && value !== null) {
                // Handle design token colors
                if (typeof value === 'string' && value.startsWith('color(')) {
                    const resolvedValue = this.resolveColorToken(value);
                    if (resolvedValue && resolvedValue !== value) {
                        element.style[property] = resolvedValue;
                    }
                } else {
                    element.style[property] = value;
                }
            }
        }
    }

    // Resolve color tokens
    resolveColorToken(token) {
        // Simple token resolution - in a real system this would be more sophisticated
        const tokenMap = {
            'color(text.primary)': '#ffffff',
            'color(text.secondary)': '#a0a0a0',
            'color(background.primary)': '#07111d',
            'color(background.secondary)': '#1a2332',
            'color(background.tertiary)': '#2a3442',
            'color(border.primary)': '#333333',
            'color(primary.500)': '#3b82f6',
            'color(background.info)': '#3b82f6',
            'color(background.success)': '#10b981',
            'color(background.warning)': '#f59e0b',
            'color(background.error)': '#ef4444',
            'color(background.accent)': '#8b5cf6'
        };

        return tokenMap[token] || token;
    }

    // Apply accessibility attributes
    applyAccessibility(element, node) {
        if (node.role) {
            element.setAttribute('role', node.role);
        }

        if (node.ariaLabel) {
            element.setAttribute('aria-label', node.ariaLabel);
        }

        if (node.ariaDescription) {
            element.setAttribute('aria-describedby', node.ariaDescription);
        }

        if (node.ariaExpanded != null) {
            element.setAttribute('aria-expanded', node.ariaExpanded);
        }

        if (node.ariaSelected != null) {
            element.setAttribute('aria-selected', node.ariaSelected);
        }

        if (node.ariaHidden != null) {
            element.setAttribute('aria-hidden', node.ariaHidden);
        }

        if (node.ariaLive != null) {
            element.setAttribute('aria-live', node.ariaLive);
        }

        if (node.ariaModal != null) {
            element.setAttribute('aria-modal', node.ariaModal);
        }

        if (node.ariaLabelledBy != null) {
            element.setAttribute('aria-labelledby', node.ariaLabelledBy);
        }

        if (node.ariaDescribedBy != null) {
            element.setAttribute('aria-describedby', node.ariaDescribedBy);
        }

        if (node.ariaDisabled != null) {
            element.setAttribute('aria-disabled', node.ariaDisabled);
        }

        if (node.ariaRequired != null) {
            element.setAttribute('aria-required', node.ariaRequired);
        }

        if (node.ariaReadOnly != null) {
            element.setAttribute('aria-readonly', node.ariaReadOnly);
        }

        if (node.ariaMultiSelectable != null) {
            element.setAttribute('aria-multiselectable', node.ariaMultiSelectable);
        }

        if (node.ariaOrientation != null) {
            element.setAttribute('aria-orientation', node.ariaOrientation);
        }

        if (node.ariaControls != null) {
            element.setAttribute('aria-controls', node.ariaControls);
        }

        if (node.tabIndex != null) {
            element.setAttribute('tabindex', node.tabIndex);
        }

        if (node.hidden != null) {
            element.hidden = Boolean(node.hidden);
        }

        // Handle state flags
        if (Number.isInteger(node.stateFlags)) {
            // Simple state flag handling without require
            const DISABLED = 1 << 4;
            const VISIBLE = 1 << 0;
            const FOCUSED = 1 << 1;
            
            if (node.stateFlags & DISABLED) {
                element.setAttribute('aria-disabled', 'true');
                element.disabled = true;
            } else {
                element.disabled = false;
            }

            if (!(node.stateFlags & VISIBLE)) {
                element.setAttribute('aria-hidden', 'true');
                // Don't set display: none here - let the UINode styles control visibility
            } else if (node.ariaHidden == null) {
                element.removeAttribute('aria-hidden');
            }

            if (node.stateFlags & FOCUSED) {
                element.setAttribute('aria-focused', 'true');
                // Don't auto-focus, just mark as focused
            }
        }
    }

    // Attach event listeners
    attachEventListeners(element, node) {
        if (!node.eventHandlers) return;

        // Map UINode events to DOM events
        const eventMap = {
            'click': 'click',
            'mousedown': 'mousedown',
            'mouseup': 'mouseup',
            'mouseenter': 'mouseenter',
            'mouseleave': 'mouseleave',
            'focus': 'focus',
            'blur': 'blur',
            'keydown': 'keydown',
            'keyup': 'keyup',
            'input': 'input',
            'change': 'change'
        };

        for (const [uiEvent, domEvent] of Object.entries(eventMap)) {
            if (node.eventHandlers.has(uiEvent)) {
                element.addEventListener(domEvent, (event) => {
                    // Create synthetic event object
                    const syntheticEvent = {
                        type: uiEvent,
                        target: node,
                        originalEvent: event,
                        preventDefault: () => event.preventDefault(),
                        stopPropagation: () => event.stopPropagation()
                    };

                    // Call all handlers for this event
                    const handlers = node.eventHandlers.get(uiEvent);
                    if (handlers) {
                        for (const handler of handlers) {
                            try {
                                handler(syntheticEvent);
                            } catch (error) {
                                console.error(`[DOMRenderer] Error in ${uiEvent} handler:`, error);
                            }
                        }
                    }
                });
            }
        }

        // Handle special cases for input elements
        if (node.type === 'input') {
            element.addEventListener('input', (event) => {
                node.value = event.target.value;
                
                // Trigger change event
                if (node.eventHandlers.has('input-change')) {
                    const syntheticEvent = {
                        type: 'input-change',
                        target: node,
                        value: node.value,
                        originalEvent: event,
                        preventDefault: () => event.preventDefault(),
                        stopPropagation: () => event.stopPropagation()
                    };

                    const handlers = node.eventHandlers.get('input-change');
                    if (handlers) {
                        for (const handler of handlers) {
                            try {
                                handler(syntheticEvent);
                            } catch (error) {
                                console.error('[DOMRenderer] Error in input-change handler:', error);
                            }
                        }
                    }
                }
            });
        }
    }

    // Update a specific node
    updateNode(node) {
        const domElement = this.nodeToDOM.get(node);
        if (!domElement) {
            console.warn('[DOMRenderer] Node not rendered:', node);
            return;
        }

        // Update styles
        this.applyStyles(domElement, node);

        // Update accessibility
        this.applyAccessibility(domElement, node);

        // Update content if it's a text node
        if (node.type === 'text' || node.type === 'button') {
            this.renderTextNode(domElement, node);
        }

        // Update input value
        if (node.type === 'input' && domElement.tagName === 'INPUT') {
            domElement.value = node.value || '';
            domElement.placeholder = node.placeholder || '';
            
            // Update additional input attributes
            if (node.maxLength !== null) {
                domElement.maxLength = node.maxLength;
            }
            if (node.minLength !== null) {
                domElement.minLength = node.minLength;
            }
            if (node.pattern !== null) {
                domElement.pattern = node.pattern;
            }
            if (node.required !== null) {
                domElement.required = node.required;
            }
            if (node.readonly !== null) {
                domElement.readOnly = node.readonly;
            }
            if (node.disabled !== null) {
                domElement.disabled = node.disabled;
            }
        }

        if (this.debugMode) {
            console.log('[DOMRenderer] Updated node:', node.id);
        }
    }

    // Add a child node to DOM
    addChild(parentNode, childNode) {
        const parentDOM = this.nodeToDOM.get(parentNode);
        const childDOM = this.renderNode(childNode);

        if (parentDOM && childDOM) {
            parentDOM.appendChild(childDOM);
        }

        return childDOM;
    }

    // Remove a child node from DOM
    removeChild(parentNode, childNode) {
        const parentDOM = this.nodeToDOM.get(parentNode);
        const childDOM = this.nodeToDOM.get(childNode);

        if (parentDOM && childDOM && parentDOM.contains(childDOM)) {
            parentDOM.removeChild(childDOM);
        }

        // Clean up mappings
        this.nodeToDOM.delete(childNode);
        this.domToNode.delete(childDOM);
        this.renderedNodes.delete(childNode);
    }

    // Clear all rendered content
    clear() {
        if (this.container) {
            this.container.innerHTML = '';
        }

        this.nodeToDOM.clear();
        this.domToNode.clear();
        this.renderedNodes.clear();
    }

    // Get DOM element for a node
    getDOMElement(node) {
        return this.nodeToDOM.get(node);
    }

    // Get UINode for a DOM element
    getUINode(domElement) {
        return this.domToNode.get(domElement) || domElement._plaunaNode;
    }

    // Find a node by ID
    findNode(id) {
        for (const [node, domElement] of this.nodeToDOM) {
            if (node.id === id) {
                return node;
            }
        }
        return null;
    }

    // Find a DOM element by ID
    findDOMElement(id) {
        for (const [node, domElement] of this.nodeToDOM) {
            if (node.id === id) {
                return domElement;
            }
        }
        return null;
    }

    // Get statistics
    getStats() {
        return {
            renderedNodes: this.renderedNodes.size,
            nodeToDOMMappings: this.nodeToDOM.size,
            domToNodeMappings: this.domToNode.size
        };
    }

    // Destroy renderer
    destroy() {
        this.clear();
        this.container = null;
    }
}
