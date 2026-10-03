// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * TreeInspector - Visual tree inspector for Plauna
 * Provides debugging and inspection of the UI visual tree
 */

import { UINode, NODE_STATE, DIRTY } from '../core/UINode.js';

export class TreeInspector {
    constructor(options = {}) {
        this.rootNode = options.rootNode || null;
        this.selectedNode = options.selectedNode || null;
        this.maxDepth = options.maxDepth || 10;
        this.showDirty = options.showDirty || false;
        this.showPerformance = options.showPerformance || false;
        
        // Inspector UI
        this.container = null;
        this.treeView = null;
        this.propertiesView = null;
        this.performanceView = null;
        
        // Event handlers
        this.onNodeSelected = options.onNodeSelected || null;
        this.onNodeHovered = options.onNodeHovered || null;
        
        // Performance tracking
        this.updateCount = 0;
        this.lastUpdateTime = 0;
    }

    // Initialize inspector
    initialize(container) {
        this.container = container;
        
        // Create inspector layout
        this.createInspectorLayout();
        
        // Bind events
        this.bindEvents();
        
        // Initial render
        this.render();
        
        return this;
    }

    // Create inspector layout
    createInspectorLayout() {
        if (!this.container) return;
        
        // Clear container
        while (this.container.children.length > 0) {
            this.container.removeChild(this.container.children[0]);
        }
        
        // Create main layout
        const layout = new UINode('plauna-inspector', 'inspector-layout');
        layout.setStyles({
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            backgroundColor: '#1e1e1e',
            color: '#ffffff',
            fontFamily: 'monospace',
            fontSize: 12,
            overflow: 'hidden'
        });
        
        // Create header
        const header = this.createHeader();
        layout.appendChild(header);
        
        // Create content area
        const content = new UINode('inspector-content', 'inspector-content');
        content.setStyles({
            display: 'flex',
            flexDirection: 'row',
            flex: 1,
            overflow: 'hidden'
        });
        
        // Create tree view
        this.treeView = this.createTreeView();
        content.appendChild(this.treeView);
        
        // Create properties view
        this.propertiesView = this.createPropertiesView();
        content.appendChild(this.propertiesView);
        
        // Create performance view
        this.performanceView = this.createPerformanceView();
        content.appendChild(this.performanceView);
        
        layout.appendChild(content);
        
        // Add to container
        this.container.appendChild(layout);
    }

    // Create header
    createHeader() {
        const header = new UINode('inspector-header', 'inspector-header');
        header.setStyles({
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            backgroundColor: '#2d2d2d',
            borderBottom: '1px solid #444444',
            fontSize: 14,
            fontWeight: 'bold'
        });
        
        // Title
        const title = new UINode('inspector-title', 'inspector-title');
        title.textContent = 'Plauna Tree Inspector';
        title.setStyles({
            color: '#ffffff',
            fontWeight: 'bold'
        });
        header.appendChild(title);
        
        // Controls
        const controls = new UINode('inspector-controls', 'inspector-controls');
        controls.setStyles({
            display: 'flex',
            flexDirection: 'row',
            gap: '8px'
        });
        
        // Refresh button
        const refreshBtn = this.createButton('Refresh', () => this.render());
        controls.appendChild(refreshBtn);
        
        // Toggle dirty flag display
        const dirtyBtn = this.createButton('Dirty', () => {
            this.showDirty = !this.showDirty;
            this.render();
        });
        controls.appendChild(dirtyBtn);
        
        // Toggle performance view
        const perfBtn = this.createButton('Perf', () => {
            this.showPerformance = !this.showPerformance;
            this.render();
        });
        controls.appendChild(perfBtn);
        
        header.appendChild(controls);
        
        return header;
    }

    // Create button
    createButton(text, onClick) {
        const button = new UINode('inspector-btn', 'inspector-button');
        button.textContent = text;
        button.setStyles({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4px 8px',
            backgroundColor: '#444444',
            color: '#ffffff',
            border: '1px solid #666666',
            borderRadius: '4px',
            fontSize: 11,
            cursor: 'pointer',
            userSelect: 'none'
        });
        
        button.addEventListener('click', onClick);
        
        return button;
    }

    // Create tree view
    createTreeView() {
        const treeView = new UINode('tree-view', 'tree-view');
        treeView.setStyles({
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minWidth: '300px',
            backgroundColor: '#1e1e1e',
            borderRight: '1px solid #444444',
            overflow: 'auto',
            padding: '8px'
        });
        
        return treeView;
    }

    // Create properties view
    createPropertiesView() {
        const propertiesView = new UINode('properties-view', 'properties-view');
        propertiesView.setStyles({
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minWidth: '300px',
            backgroundColor: '#1e1e1e',
            borderRight: '1px solid #444444',
            overflow: 'auto',
            padding: '8px'
        });
        
        return propertiesView;
    }

    // Create performance view
    createPerformanceView() {
        const performanceView = new UINode('performance-view', 'performance-view');
        performanceView.setStyles({
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minWidth: '250px',
            backgroundColor: '#1e1e1e',
            overflow: 'auto',
            padding: '8px'
        });
        
        return performanceView;
    }

    // Bind events
    bindEvents() {
        // Auto-refresh on interval
        setInterval(() => {
            this.render();
        }, 1000); // Update every second
    }

    // Set root node
    setRootNode(node) {
        this.rootNode = node;
        this.render();
    }

    // Set selected node
    setSelectedNode(node) {
        this.selectedNode = node;
        this.renderProperties();
        
        if (this.onNodeSelected) {
            this.onNodeSelected(node);
        }
    }

    // Render inspector
    render() {
        this.updateCount++;
        this.lastUpdateTime = Date.now();
        
        this.renderTree();
        this.renderProperties();
        this.renderPerformance();
    }

    // Render tree view
    renderTree() {
        if (!this.treeView || !this.rootNode) return;
        
        // Clear tree view
        while (this.treeView.children.length > 0) {
            this.treeView.removeChild(this.treeView.children[0]);
        }
        
        // Render tree
        this.renderTreeNode(this.rootNode, this.treeView, 0);
    }

    // Render tree node
    renderTreeNode(node, parent, depth) {
        if (depth >= this.maxDepth) return;
        
        // Create node element
        const nodeElement = this.createTreeNodeElement(node, depth);
        parent.appendChild(nodeElement);
        
        // Render children
        if (node.children && node.children.length > 0) {
            const childrenContainer = new UINode(`${node.id}-children`, 'tree-children');
            childrenContainer.setStyles({
                marginLeft: '16px',
                borderLeft: '1px solid #444444'
            });
            
            for (const child of node.children) {
                this.renderTreeNode(child, childrenContainer, depth + 1);
            }
            
            parent.appendChild(childrenContainer);
        }
    }

    // Create tree node element
    createTreeNodeElement(node, depth) {
        const element = new UINode(`tree-node-${node.id}`, 'tree-node');
        
        // Determine node color based on state
        let color = '#ffffff';
        let backgroundColor = '#2d2d2d';
        
        if (node === this.selectedNode) {
            backgroundColor = '#0078d4';
        } else if (node.hasState(NODE_STATE.FOCUSED)) {
            backgroundColor = '#404040';
        } else if (node.hasState(NODE_STATE.HOVERED)) {
            backgroundColor = '#353535';
        }
        
        // Show dirty flag if enabled
        let dirtyIndicator = '';
        if (this.showDirty && node.isDirty(DIRTY.ALL)) {
            dirtyIndicator = ' *';
            color = '#ff6b6b';
        }
        
        element.setStyles({
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            padding: '2px 4px',
            backgroundColor,
            color,
            cursor: 'pointer',
            userSelect: 'none',
            fontSize: 11
        });
        
        // Add expand/collapse indicator
        const expandIndicator = new UINode(`${element.id}-expand`, 'expand-indicator');
        expandIndicator.textContent = node.children && node.children.length > 0 ? '▼' : '─';
        expandIndicator.setStyles({
            width: '12px',
            textAlign: 'center',
            color: '#888888'
        });
        element.appendChild(expandIndicator);
        
        // Add node type
        const typeLabel = new UINode(`${element.id}-type`, 'node-type');
        typeLabel.textContent = node.type;
        typeLabel.setStyles({
            color: '#4fc3f7',
            fontWeight: 'bold',
            marginRight: '4px'
        });
        element.appendChild(typeLabel);
        
        // Add node ID
        const idLabel = new UINode(`${element.id}-id`, 'node-id');
        idLabel.textContent = `#${node.id}`;
        idLabel.setStyles({
            color: '#81c784',
            marginRight: '4px'
        });
        element.appendChild(idLabel);
        
        // Add dirty indicator
        if (dirtyIndicator) {
            const dirtyLabel = new UINode(`${element.id}-dirty`, 'dirty-indicator');
            dirtyLabel.textContent = dirtyIndicator;
            dirtyLabel.setStyles({
                color: '#ff6b6b',
                fontWeight: 'bold'
            });
            element.appendChild(dirtyLabel);
        }
        
        // Add child count
        if (node.children && node.children.length > 0) {
            const countLabel = new UINode(`${element.id}-count`, 'child-count');
            countLabel.textContent = `(${node.children.length})`;
            countLabel.setStyles({
                color: '#888888',
                fontSize: 10
            });
            element.appendChild(countLabel);
        }
        
        // Add click handler
        element.addEventListener('click', () => {
            this.setSelectedNode(node);
        });
        
        // Add hover handler
        element.addEventListener('mouseenter', () => {
            if (this.onNodeHovered) {
                this.onNodeHovered(node);
            }
        });
        
        return element;
    }

    // Render properties view
    renderProperties() {
        if (!this.propertiesView) return;
        
        // Clear properties view
        while (this.propertiesView.children.length > 0) {
            this.propertiesView.removeChild(this.propertiesView.children[0]);
        }
        
        if (!this.selectedNode) {
            const emptyState = new UINode('empty-properties', 'empty-state');
            emptyState.textContent = 'Select a node to view properties';
            emptyState.setStyles({
                color: '#888888',
                fontStyle: 'italic',
                textAlign: 'center',
                padding: '20px'
            });
            this.propertiesView.appendChild(emptyState);
            return;
        }
        
        // Render node properties
        this.renderPropertySection('Basic Info', this.getBasicProperties());
        this.renderPropertySection('Layout', this.getLayoutProperties());
        this.renderPropertySection('Style', this.getStyleProperties());
        this.renderPropertySection('State', this.getStateProperties());
        this.renderPropertySection('Performance', this.getPerformanceProperties());
    }

    // Render property section
    renderPropertySection(title, properties) {
        const section = new UINode(`properties-${title.toLowerCase().replace(' ', '-')}`, 'property-section');
        section.setStyles({
            marginBottom: '16px'
        });
        
        // Section header
        const header = new UINode(`${section.id}-header`, 'section-header');
        header.textContent = title;
        header.setStyles({
            color: '#4fc3f7',
            fontWeight: 'bold',
            marginBottom: '4px',
            fontSize: 12
        });
        section.appendChild(header);
        
        // Properties
        for (const [key, value] of Object.entries(properties)) {
            const property = this.createPropertyElement(key, value);
            section.appendChild(property);
        }
        
        this.propertiesView.appendChild(section);
    }

    // Create property element
    createPropertyElement(key, value) {
        const element = new UINode(`property-${key}`, 'property');
        element.setStyles({
            display: 'flex',
            flexDirection: 'row',
            marginBottom: '2px',
            fontSize: 11
        });
        
        // Key
        const keyElement = new UINode(`${element.id}-key`, 'property-key');
        keyElement.textContent = key;
        keyElement.setStyles({
            color: '#888888',
            width: '120px',
            flexShrink: 0
        });
        element.appendChild(keyElement);
        
        // Value
        const valueElement = new UINode(`${element.id}-value`, 'property-value');
        valueElement.textContent = this.formatPropertyValue(value);
        valueElement.setStyles({
            color: '#ffffff',
            flex: 1,
            wordBreak: 'break-all'
        });
        element.appendChild(valueElement);
        
        return element;
    }

    // Format property value
    formatPropertyValue(value) {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        if (typeof value === 'number') return value.toString();
        if (typeof value === 'string') return `"${value}"`;
        if (typeof value === 'object') {
            return JSON.stringify(value, null, 2);
        }
        return String(value);
    }

    // Get basic properties
    getBasicProperties() {
        if (!this.selectedNode) return {};
        
        return {
            'ID': this.selectedNode.id,
            'Type': this.selectedNode.type,
            'Parent': this.selectedNode.parent ? this.selectedNode.parent.id : 'none',
            'Children': this.selectedNode.children.length,
            'Tag': this.selectedNode.tag || 'none',
            'Class': this.selectedNode.className || 'none'
        };
    }

    // Get layout properties
    getLayoutProperties() {
        if (!this.selectedNode) return {};
        
        const box = this.selectedNode.layoutBox;
        return {
            'X': Math.round(box.x),
            'Y': Math.round(box.y),
            'Width': Math.round(box.width),
            'Height': Math.round(box.height),
            'MinX': Math.round(box.minX),
            'MinY': Math.round(box.minY),
            'MaxX': Math.round(box.maxX),
            'MaxY': Math.round(box.maxY)
        };
    }

    // Get style properties
    getStyleProperties() {
        if (!this.selectedNode) return {};
        
        const styles = {};
        for (const [key, value] of Object.entries(this.selectedNode.style)) {
            styles[key] = value;
        }
        return styles;
    }

    // Get state properties
    getStateProperties() {
        if (!this.selectedNode) return {};
        
        const stateFlags = this.selectedNode.stateFlags;
        return {
            'Visible': this.selectedNode.hasState(NODE_STATE.VISIBLE),
            'Focused': this.selectedNode.hasState(NODE_STATE.FOCUSED),
            'Hovered': this.selectedNode.hasState(NODE_STATE.HOVERED),
            'Active': this.selectedNode.hasState(NODE_STATE.ACTIVE),
            'Disabled': this.selectedNode.hasState(NODE_STATE.DISABLED),
            'Focusable': this.selectedNode.hasState(NODE_STATE.FOCUSABLE),
            'Selected': this.selectedNode.hasState(NODE_STATE.SELECTED),
            'Dirty Flags': this.selectedNode.dirtyFlags.toString(2)
        };
    }

    // Get performance properties
    getPerformanceProperties() {
        if (!this.selectedNode) return {};
        
        return {
            'Layout Count': this.selectedNode.layoutCount,
            'Paint Count': this.selectedNode.paintCount,
            'Last Layout Time': `${this.selectedNode.lastLayoutTime.toFixed(2)}ms`,
            'Last Paint Time': `${this.selectedNode.lastPaintTime.toFixed(2)}ms`
        };
    }

    // Render performance view
    renderPerformance() {
        if (!this.performanceView) return;
        
        // Clear performance view
        while (this.performanceView.children.length > 0) {
            this.performanceView.removeChild(this.performanceView.children[0]);
        }
        
        if (!this.showPerformance) {
            const disabledState = new UINode('perf-disabled', 'perf-disabled');
            disabledState.textContent = 'Performance view disabled';
            disabledState.setStyles({
                color: '#888888',
                fontStyle: 'italic',
                textAlign: 'center',
                padding: '20px'
            });
            this.performanceView.appendChild(disabledState);
            return;
        }
        
        // Render performance metrics
        this.renderPerformanceSection('Inspector Stats', this.getInspectorStats());
        
        if (this.rootNode) {
            this.renderPerformanceSection('Tree Stats', this.getTreeStats());
        }
    }

    // Render performance section
    renderPerformanceSection(title, stats) {
        const section = new UINode(`perf-${title.toLowerCase().replace(' ', '-')}`, 'perf-section');
        section.setStyles({
            marginBottom: '16px'
        });
        
        // Section header
        const header = new UINode(`${section.id}-header`, 'perf-header');
        header.textContent = title;
        header.setStyles({
            color: '#4fc3f7',
            fontWeight: 'bold',
            marginBottom: '4px',
            fontSize: 12
        });
        section.appendChild(header);
        
        // Stats
        for (const [key, value] of Object.entries(stats)) {
            const stat = this.createPropertyElement(key, value);
            section.appendChild(stat);
        }
        
        this.performanceView.appendChild(section);
    }

    // Get inspector stats
    getInspectorStats() {
        return {
            'Updates': this.updateCount,
            'Last Update': new Date(this.lastUpdateTime).toLocaleTimeString(),
            'Selected Node': this.selectedNode ? this.selectedNode.id : 'none',
            'Show Dirty': this.showDirty,
            'Show Performance': this.showPerformance
        };
    }

    // Get tree stats
    getTreeStats() {
        if (!this.rootNode) return {};
        
        let totalNodes = 0;
        let dirtyNodes = 0;
        let maxDepth = 0;
        
        const traverse = (node, depth = 0) => {
            totalNodes++;
            if (node.isDirty(DIRTY.ALL)) dirtyNodes++;
            maxDepth = Math.max(maxDepth, depth);
            
            for (const child of node.children) {
                traverse(child, depth + 1);
            }
        };
        
        traverse(this.rootNode);
        
        return {
            'Total Nodes': totalNodes,
            'Dirty Nodes': dirtyNodes,
            'Max Depth': maxDepth,
            'Tree Height': this.rootNode.layoutBox.height,
            'Tree Width': this.rootNode.layoutBox.width
        };
    }

    // Destroy inspector
    destroy() {
        if (this.container) {
            while (this.container.children.length > 0) {
                this.container.removeChild(this.container.children[0]);
            }
        }
        
        this.rootNode = null;
        this.selectedNode = null;
        this.treeView = null;
        this.propertiesView = null;
        this.performanceView = null;
        this.onNodeSelected = null;
        this.onNodeHovered = null;
    }
}
