// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ============================================================================
 * WidgetRenderer - UINode to DOM Converter
 * ============================================================================
 *
 * WidgetRenderer is the bridge between Plauna's retained UINode tree and the
 * actual browser DOM. It converts UINode instances into DOM elements recursively.
 *
 * RENDERING PIPELINE:
 * 1. render(node) - Entry point, converts UINode tree to DOM tree
 * 2. createDOMElement(node) - Creates appropriate DOM element for UINode type
 * 3. Applies styles, classes, IDs, text content, and attributes
 * 4. Recursively renders children and appends to parent
 * 5. Returns root DOM element ready for insertion into document
 *
 * MAPPING TABLES:
 * - nodeToDOM: Map<UINode, HTMLElement> - UINode → DOM element
 * - domToNode: Map<HTMLElement, UINode> - DOM element → UINode (reverse lookup)
 *
 * ELEMENT TYPE MAPPING:
 * - SVG elements: svg, circle, path, etc. → created with createElementNS
 * - Text nodes: type='text' → rendered as <span>
 * - Form elements: button, input, textarea, select, label, form, img → native elements
 * - HTML elements: h1-h6, p, div, header, footer, nav, etc. → native elements
 * - Unknown types: fallback to <div>
 *
 * SPECIAL HANDLING:
 * - Raw HTMLElements: If node is already an HTMLElement, return it directly
 * - Pre-existing DOM: If node.element exists (created by widget), use it
 * - Back-reference: Sets element._plaunaNode for reverse lookup (used by SmartContextMenu)
 *
 * STYLE APPLICATION:
 * 1. node.style: Direct inline styles (highest priority)
 * 2. node.computedStyle: Computed styles from layout engine
 * 3. node.className: CSS class names
 * 4. node.id: Element ID
 *
 * TEXT CONTENT:
 * - node.textContent: Plain text content
 * - node.innerHTML: HTML string content
 * - If node has children, text content is ignored
 */

export class WidgetRenderer {
    constructor(options = {}) {
        this.nodeToDOM = new Map();
        this.domToNode = new Map();
    }

    /**
     * Render a UINode widget tree to DOM
     * @param {UINode} node - Root UINode to render
     * @returns {HTMLElement} Rendered DOM element
     */
    render(node) {
        if (!node) return null;

        if (typeof HTMLElement !== 'undefined' && node instanceof HTMLElement) {
            return node;
        }
        
        // If widget already has a DOM element (created via document.createElement), use it
        if (node.element && node.element instanceof HTMLElement) {
            return node.element;
        }
        
        // Create DOM element
        const element = this.createDOMElement(node);
        
        // Render children
        if (node.children && node.children.length > 0) {
            for (const child of node.children) {
                const childElement = this.render(child);
                if (childElement) {
                    element.appendChild(childElement);
                }
            }
        }
        
        return element;
    }

    /**
     * Create DOM element from UINode
     * @param {UINode} node - UINode to convert
     * @returns {HTMLElement} DOM element
     */
    createDOMElement(node) {
        // Determine element type
        let element;
        const type = node.type || 'div';

        const svgElements = new Set([
            'svg', 'circle', 'defs', 'g', 'line', 'path', 'polygon', 'polyline',
            'rect', 'stop', 'tspan', 'ellipse', 'clipPath', 'linearGradient',
            'radialGradient'
        ]);

        if (svgElements.has(type)) {
            element = document.createElementNS('http://www.w3.org/2000/svg', type);
        } else if (type === 'text') {
            element = document.createElement('span');
        } else if (['button', 'input', 'textarea', 'select', 'label', 'form', 'img'].includes(type)) {
            element = document.createElement(type);
        } else if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'div', 'header', 'footer', 'nav', 'section', 'article', 'aside', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td'].includes(type)) {
            element = document.createElement(type);
        } else {
            element = document.createElement('div');
        }

        // Set element reference on UINode so widgets can access DOM properties
        node.element = element;
        element._plaunaNode = node;

        // Apply ID
        if (node.id) {
            element.id = node.id;
        }

        // Apply classes
        if (node.className) {
            element.className = node.className;
        }

        // Apply styles
        if (node.style && typeof node.style === 'object') {
            Object.assign(element.style, node.style);
        }

        // Apply computed styles
        if (node.computedStyle && typeof node.computedStyle === 'object') {
            Object.assign(element.style, node.computedStyle);
        }

        // Apply text content
        if (node.textContent && !node.children?.length) {
            element.textContent = node.textContent;
        }

        // Apply innerHTML (if no children)
        if (node.innerHTML && !node.children?.length) {
            element.innerHTML = node.innerHTML;
        }

        // Apply accessibility attributes
        if (node.role) {
            element.setAttribute('role', node.role);
        }
        if (node.ariaLabel) {
            element.setAttribute('aria-label', node.ariaLabel);
        }
        if (node.ariaDescription) {
            element.setAttribute('aria-description', node.ariaDescription);
        }
        if (node.ariaLabelledBy) {
            element.setAttribute('aria-labelledby', node.ariaLabelledBy);
        }
        if (node.ariaDescribedBy) {
            element.setAttribute('aria-describedby', node.ariaDescribedBy);
        }
        if (node.ariaChecked !== undefined) {
            element.setAttribute('aria-checked', node.ariaChecked);
        }
        if (node.ariaSelected !== undefined) {
            element.setAttribute('aria-selected', node.ariaSelected);
        }
        if (node.ariaExpanded !== undefined) {
            element.setAttribute('aria-expanded', node.ariaExpanded);
        }
        if (node.ariaDisabled !== undefined) {
            element.setAttribute('aria-disabled', node.ariaDisabled);
        }
        if (node.ariaRequired !== undefined) {
            element.setAttribute('aria-required', node.ariaRequired);
        }
        if (node.ariaModal) {
            element.setAttribute('aria-modal', node.ariaModal);
        }
        if (node.ariaLive) {
            element.setAttribute('aria-live', node.ariaLive);
        }

        // Apply data attributes and DOM properties
        if (node.userData && typeof node.userData === 'object') {
            for (const [key, value] of Object.entries(node.userData)) {
                // Handle special DOM properties
                if (key === 'src' && type === 'img') {
                    element.src = value;
                } else if (key === 'alt' && type === 'img') {
                    element.alt = value;
                } else if (key === 'href' && type === 'a') {
                    element.href = value;
                } else if (key === 'value' && ['input', 'textarea', 'select'].includes(type)) {
                    element.value = value;
                } else if (key === 'checked' && type === 'input') {
                    element.checked = value;
                } else if (key === 'disabled') {
                    element.disabled = value;
                } else if (key === 'placeholder') {
                    element.placeholder = value;
                } else if (key === 'type' && type === 'input') {
                    element.type = value;
                } else if (key === 'name') {
                    element.name = value;
                } else if (key === 'required') {
                    element.required = value;
                } else if (key === 'readonly') {
                    element.readOnly = value;
                } else if (typeof value !== 'function') {
                    // Only set as data attribute if not a function
                    element.setAttribute(`data-${key}`, value);
                }
            }
        }

        // Apply event listeners
        if (node.eventHandlers && node.eventHandlers.size > 0) {
            for (const [eventType, handler] of node.eventHandlers) {
                element.addEventListener(eventType, handler);
            }
        }

        return element;
    }

    /**
     * Update existing DOM element from UINode
     * @param {UINode} node - UINode with updates
     * @param {HTMLElement} element - DOM element to update
     */
    updateDOMElement(node, element) {
        // Update styles
        if (node.style && typeof node.style === 'object') {
            Object.assign(element.style, node.style);
        }

        // Update text content
        if (node.textContent) {
            element.textContent = node.textContent;
        }

        // Update innerHTML
        if (node.innerHTML) {
            element.innerHTML = node.innerHTML;
        }

        // Update classes
        if (node.className) {
            element.className = node.className;
        }
    }

    /**
     * Get DOM element for a node
     * @param {UINode} node - UINode to resolve
     * @returns {HTMLElement|null} DOM element for the node
     */
    getDOMElement(node) {
        return this.nodeToDOM.get(node) || node?.element || null;
    }

    /**
     * Unmount and clean up a rendered widget
     * @param {UINode|HTMLElement} nodeOrElement - Node or element to unmount
     */
    unmount(nodeOrElement) {
        let element;
        let node;

        if (nodeOrElement instanceof HTMLElement) {
            element = nodeOrElement;
            node = this.domToNode.get(element);
        } else {
            node = nodeOrElement;
            element = this.nodeToDOM.get(node);
        }

        if (element && element.parentElement) {
            element.parentElement.removeChild(element);
        }

        if (node) {
            this.nodeToDOM.delete(node);
        }
        if (element) {
            this.domToNode.delete(element);
        }
    }

    /**
     * Clear all mappings
     */
    clear() {
        this.nodeToDOM.clear();
        this.domToNode.clear();
    }
}

// Global renderer instance
export const widgetRenderer = new WidgetRenderer();
