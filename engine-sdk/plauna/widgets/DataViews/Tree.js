// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Tree - Hierarchical data display widget for Plauna
 * Provides tree functionality with expand/collapse and navigation
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _treeSequence = 0;

function _newTreeId() {
    return `tree-${Date.now()}-${++_treeSequence}`;
}

export class Tree extends UINode {
    // Widget metadata
    static id = 'tree';
    static name = 'Tree';
    static category = 'dataviews';
    static icon = '🌳';
    static description = 'Hierarchical tree widget';
    static tags = ['dataviews', 'tree', 'hierarchy'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            data: [],
            variant: 'default',
            size: 'md',
            selectable: false
        };
    }
    
    static create(container, options = {}) {
        const instance = new Tree(_newTreeId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newTreeId(), options = {}) {
        super(id, 'tree');
        
        // Tree-specific properties
        this.data = options.data || [];
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.expandedNodes = new Set(options.expandedNodes || []);
        this.selectedNode = options.selectedNode || null;
        this.selectable = options.selectable || false;
        this.multiSelect = options.multiSelect || false;
        this.showIcons = options.showIcons !== false;
        this.showLines = options.showLines !== false;
        this.loading = options.loading || false;
        this.empty = options.empty || 'No items to display';
        
        // State management
        this.nodeElements = new Map();
        
        // Set accessibility
        this.role = 'tree';
        this.ariaMultiSelectable = this.multiSelect;
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build tree structure
        this.buildTree();
        
        // Initialize data
        if (options.data) {
            this.setData(options.data);
        }
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        
        this.setStyles({
            display: 'block',
            width: '100%',
            outline: 'none',
            ...sizeStyles,
            ...variantStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                fontSize: tokens.get('fontSizes.xs')
            },
            sm: {
                fontSize: tokens.get('fontSizes.sm')
            },
            md: {
                fontSize: tokens.get('fontSizes.md')
            },
            lg: {
                fontSize: tokens.get('fontSizes.lg')
            },
            xl: {
                fontSize: tokens.get('fontSizes.xl')
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        const variants = {
            default: {
                color: tokens.get('colors.text.primary')
            },
            primary: {
                color: tokens.get('colors.primary.600')
            },
            secondary: {
                color: tokens.get('colors.secondary.600')
            },
            success: {
                color: tokens.get('colors.success')
            },
            warning: {
                color: tokens.get('colors.warning')
            },
            error: {
                color: tokens.get('colors.error')
            }
        };
        return variants[this.variant] || variants.default;
    }
    
    setupEventHandlers() {
        this.addEventListener('click', (e) => {
            const nodeElement = e.target.closest('[data-tree-node]');
            const expandIcon = e.target.closest('[data-tree-expand]');
            
            if (expandIcon) {
                const nodeId = expandIcon.dataset.treeNode;
                this.toggleNode(nodeId);
                e.preventDefault();
                e.stopPropagation();
            } else if (nodeElement && this.selectable) {
                const nodeId = nodeElement.dataset.treeNode;
                this.selectNode(nodeId, e.ctrlKey || e.metaKey);
                e.preventDefault();
                e.stopPropagation();
            }
        });
        
        this.addEventListener('keydown', (e) => {
            this.handleKeyboardNavigation(e);
        });
    }
    
    buildTree() {
        this.innerHTML = '';
        this.nodeElements.clear();
        
        // Create tree container
        const treeContainer = new UINode(`${this.id}-container`, 'div');
        treeContainer.setStyles({
            padding: tokens.get('spacing.md')
        });
        
        // Create tree root
        const treeRoot = document.createElement('div');
        treeRoot.setAttribute('role', 'tree');
        treeRoot.style.cssText = (
            'list-style: none;' +
            'margin: 0;' +
            'padding: 0;'
        );
        
        treeContainer.element.appendChild(treeRoot);
        this.treeRoot = treeRoot;
        this.appendChild(treeContainer);
        
        // Render initial data
        this.renderData();
    }
    
    renderData() {
        if (!this.treeRoot) return;
        
        this.treeRoot.innerHTML = '';
        
        if (this.loading) {
            // Show loading state
            const loadingItem = document.createElement('div');
            loadingItem.style.cssText = (
                'padding: ' + tokens.get('spacing.md') + ';' +
                'color: ' + tokens.get('colors.text.secondary') + ';' +
                'font-style: italic;'
            );
            loadingItem.textContent = 'Loading...';
            this.treeRoot.appendChild(loadingItem);
            return;
        }
        
        if (this.data.length === 0) {
            // Show empty state
            const emptyItem = document.createElement('div');
            emptyItem.style.cssText = (
                'padding: ' + tokens.get('spacing.md') + ';' +
                'color: ' + tokens.get('colors.text.secondary') + ';' +
                'font-style: italic;'
            );
            emptyItem.textContent = this.empty;
            this.treeRoot.appendChild(emptyItem);
            return;
        }
        
        // Render tree nodes
        this.data.forEach(node => {
            const nodeElement = this.createNodeElement(node, 0);
            this.treeRoot.appendChild(nodeElement);
        });
    }
    
    createNodeElement(node, level) {
        const hasChildren = node.children && node.children.length > 0;
        const isExpanded = this.expandedNodes.has(node.id);
        const isSelected = this.selectedNode === node.id || (this.multiSelect && this.selectedNodes?.has(node.id));
        
        // Create node container
        const nodeContainer = document.createElement('div');
        nodeContainer.dataset.treeNode = node.id;
        nodeContainer.setAttribute('role', 'treeitem');
        nodeContainer.setAttribute('aria-expanded', hasChildren ? isExpanded.toString() : 'false');
        nodeContainer.setAttribute('aria-selected', isSelected.toString());
        nodeContainer.setAttribute('aria-level', (level + 1).toString());
        nodeContainer.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'margin-left: ' + (level * 24) + 'px;' +
            'position: relative;'
        );
        
        if (this.showLines && level > 0) {
            // Add vertical line for tree structure
            const verticalLine = document.createElement('div');
            verticalLine.style.cssText = (
                'position: absolute;' +
                'left: ' + ((level * 24) - 12) + 'px;' +
                'top: 0;' +
                'bottom: 0;' +
                'width: 1px;' +
                'background: ' + tokens.get('colors.border.light') + ';'
            );
            nodeContainer.appendChild(verticalLine);
        }
        
        // Create node content
        const nodeContent = document.createElement('div');
        nodeContent.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'cursor: ' + (this.selectable ? 'pointer' : 'default') + ';' +
            'transition: all 150ms ease;' +
            'background: ' + (isSelected ? this.getSelectedBackgroundColor() : 'transparent') + ';' +
            'color: ' + (isSelected ? this.getSelectedTextColor() : 'inherit') + ';'
        );
        
        // Add hover effect for selectable nodes
        if (this.selectable) {
            nodeContent.addEventListener('mouseenter', () => {
                if (!isSelected) {
                    nodeContent.style.background = tokens.get('colors.background.tertiary');
                }
            });
            
            nodeContent.addEventListener('mouseleave', () => {
                if (!isSelected) {
                    nodeContent.style.background = 'transparent';
                }
            });
        }
        
        // Add expand/collapse icon if has children
        if (hasChildren) {
            const expandIcon = document.createElement('button');
            expandIcon.dataset.treeNode = node.id;
            expandIcon.dataset.treeExpand = 'true';
            expandIcon.setAttribute('aria-label', isExpanded ? 'Collapse' : 'Expand');
            expandIcon.style.cssText = (
                'width: 16px;' +
                'height: 16px;' +
                'background: transparent;' +
                'border: none;' +
                'cursor: pointer;' +
                'padding: 0;' +
                'margin: 0;' +
                'display: flex;' +
                'align-items: center;' +
                'justify-content: center;' +
                'transition: transform 150ms ease;'
            );
            
            // Create chevron icon
            const chevron = document.createElement('span');
            chevron.textContent = isExpanded ? '▼' : '▶';
            chevron.style.cssText = (
                'font-size: 10px;' +
                'color: ' + tokens.get('colors.text.secondary') + ';' +
                'transition: transform 150ms ease;'
            );
            
            if (isExpanded) {
                chevron.style.transform = 'rotate(0deg)';
            } else {
                chevron.style.transform = 'rotate(-90deg)';
            }
            
            expandIcon.appendChild(chevron);
            nodeContent.appendChild(expandIcon);
        } else {
            // Add spacer for alignment
            const spacer = document.createElement('span');
            spacer.style.cssText = (
                'width: 16px;' +
                'height: 16px;' +
                'display: inline-block;'
            );
            nodeContent.appendChild(spacer);
        }
        
        // Add node icon if enabled
        if (this.showIcons && node.icon) {
            const icon = document.createElement('span');
            icon.textContent = node.icon;
            icon.style.cssText = (
                'width: 16px;' +
                'height: 16px;' +
                'display: flex;' +
                'align-items: center;' +
                'justify-content: center;' +
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'color: ' + tokens.get('colors.text.secondary') + ';'
            );
            nodeContent.appendChild(icon);
        }
        
        // Add node label
        const label = document.createElement('span');
        label.textContent = node.label || node.id;
        label.style.cssText = (
            'flex: 1;' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'color: inherit;'
        );
        nodeContent.appendChild(label);
        
        // Add badge if present
        if (node.badge) {
            const badge = document.createElement('span');
            badge.textContent = node.badge;
            badge.style.cssText = (
                'background: ' + tokens.get('colors.primary.500') + ';' +
                'color: white;' +
                'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
                'padding: 2px 6px;' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'margin-left: ' + tokens.get('spacing.sm') + ';'
            );
            nodeContent.appendChild(badge);
        }
        
        nodeContainer.appendChild(nodeContent);
        
        // Add children if expanded
        if (hasChildren && isExpanded) {
            const childrenContainer = document.createElement('div');
            childrenContainer.setAttribute('role', 'group');
            childrenContainer.style.cssText = (
                'list-style: none;' +
                'margin: 0;' +
                'padding: 0;' +
                'margin-top: ' + tokens.get('spacing.xs') + ';'
            );
            
            node.children.forEach(child => {
                const childElement = this.createNodeElement(child, level + 1);
                childrenContainer.appendChild(childElement);
            });
            
            nodeContainer.appendChild(childrenContainer);
        }
        
        // Store node element reference
        this.nodeElements.set(node.id, {
            container: nodeContainer,
            content: nodeContent,
            expandIcon: expandIcon,
            chevron: chevron,
            childrenContainer: childrenContainer
        });
        
        return nodeContainer;
    }
    
    getSelectedBackgroundColor() {
        const variantColors = {
            default: tokens.get('colors.primary.50'),
            primary: tokens.get('colors.primary.100'),
            secondary: tokens.get('colors.secondary.100'),
            success: tokens.get('colors.success.100'),
            warning: tokens.get('colors.warning.100'),
            error: tokens.get('colors.error.100')
        };
        return variantColors[this.variant] || variantColors.default;
    }
    
    getSelectedTextColor() {
        const variantColors = {
            default: tokens.get('colors.primary.700'),
            primary: tokens.get('colors.primary.700'),
            secondary: tokens.get('colors.secondary.700'),
            success: tokens.get('colors.success'),
            warning: tokens.get('colors.warning'),
            error: tokens.get('colors.error')
        };
        return variantColors[this.variant] || variantColors.default;
    }
    
    // Public methods
    setData(data) {
        this.data = data || [];
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    toggleNode(nodeId) {
        if (this.expandedNodes.has(nodeId)) {
            this.collapseNode(nodeId);
        } else {
            this.expandNode(nodeId);
        }
    }
    
    expandNode(nodeId) {
        this.expandedNodes.add(nodeId);
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'nodeExpand',
            bubbles: true,
            detail: { nodeId }
        });
    }
    
    collapseNode(nodeId) {
        this.expandedNodes.delete(nodeId);
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'nodeCollapse',
            bubbles: true,
            detail: { nodeId }
        });
    }
    
    expandAll() {
        this.getAllNodeIds(this.data).forEach(nodeId => {
            this.expandedNodes.add(nodeId);
        });
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    collapseAll() {
        this.expandedNodes.clear();
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    getAllNodeIds(data = this.data) {
        const ids = [];
        
        data.forEach(node => {
            ids.push(node.id);
            if (node.children && node.children.length > 0) {
                ids.push(...this.getAllNodeIds(node.children));
            }
        });
        
        return ids;
    }
    
    selectNode(nodeId, multiSelect = false) {
        if (!this.selectable) return;
        
        if (this.multiSelect) {
            if (this.selectedNodes.has(nodeId)) {
                this.selectedNodes.delete(nodeId);
            } else {
                this.selectedNodes.add(nodeId);
            }
        } else {
            this.selectedNode = nodeId;
            this.selectedNodes = new Set([nodeId]);
        }
        
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'selectionChange',
            bubbles: true,
            detail: {
                nodeId,
                selectedNodes: Array.from(this.selectedNodes),
                multiSelect: this.multiSelect
            }
        });
    }
    
    clearSelection() {
        this.selectedNode = null;
        this.selectedNodes.clear();
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setLoading(loading) {
        this.loading = loading;
        this.renderData();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.renderData();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.renderData();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSelectable(selectable) {
        if (this.selectable !== selectable) {
            this.selectable = selectable;
            this.clearSelection();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setMultiSelect(multiSelect) {
        if (this.multiSelect !== multiSelect) {
            this.multiSelect = multiSelect;
            if (!multiSelect) {
                // Convert multi-selection to single selection
                if (this.selectedNodes.size > 0) {
                    this.selectedNode = Array.from(this.selectedNodes)[0];
                    this.selectedNodes = new Set([this.selectedNode]);
                }
            }
            this.renderData();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowIcons(showIcons) {
        if (this.showIcons !== showIcons) {
            this.showIcons = showIcons;
            this.renderData();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowLines(showLines) {
        if (this.showLines !== showLines) {
            this.showLines = showLines;
            this.renderData();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setEmpty(empty) {
        if (this.empty !== empty) {
            this.empty = empty;
            this.renderData();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    handleKeyboardNavigation(e) {
        // Implementation for keyboard navigation
        // This would handle arrow keys, Home, End, etc.
    }
    
    // Static factory methods
    static createTree(id, options = {}) {
        return new Tree(id, options);
    }
    
    static createPrimaryTree(id, options = {}) {
        return new Tree(id, { variant: 'primary', ...options });
    }
    
    static createSuccessTree(id, options = {}) {
        return new Tree(id, { variant: 'success', ...options });
    }
    
    static createWarningTree(id, options = {}) {
        return new Tree(id, { variant: 'warning', ...options });
    }
    
    static createErrorTree(id, options = {}) {
        return new Tree(id, { variant: 'error', ...options });
    }
    
    static createSmallTree(id, options = {}) {
        return new Tree(id, { size: 'sm', ...options });
    }
    
    static createLargeTree(id, options = {}) {
        return new Tree(id, { size: 'lg', ...options });
    }
    
    static createXLargeTree(id, options = {}) {
        return new Tree(id, { size: 'xl', ...options });
    }
    
    static createSelectableTree(id, options = {}) {
        return new Tree(id, { selectable: true, ...options });
    }
    
    static createMultiSelectTree(id, options = {}) {
        return new Tree(id, { selectable: true, multiSelect: true, ...options });
    }
    
    static createFileTree(id, options = {}) {
        return new Tree(id, { showIcons: true, showLines: true, ...options });
    }
    
    static createFolderTree(id, options = {}) {
        return new Tree(id, { showIcons: true, showLines: true, ...options });
    }
}
