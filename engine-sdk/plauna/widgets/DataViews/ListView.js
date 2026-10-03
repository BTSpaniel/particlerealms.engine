// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ListView - Data display widget for Plauna
 * Provides virtualized list rendering with selection and sorting
 */

import { UINode, NODE_STATE } from '../../core/UINode.js';

let _listViewSequence = 0;

function _newListViewId() {
    return `listview-${Date.now()}-${++_listViewSequence}`;
}

export class ListView extends UINode {
    // Widget metadata
    static id = 'listview';
    static name = 'ListView';
    static category = 'dataviews';
    static icon = '📋';
    static description = 'Virtualized list view';
    static tags = ['dataviews', 'listview', 'virtualized'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            items: [],
            itemHeight: 32,
            visibleCount: 10,
            virtualized: true
        };
    }
    
    static create(container, options = {}) {
        const instance = new ListView(_newListViewId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newListViewId(), options = {}) {
        super(id, 'listview');
        
        // ListView-specific properties
        this.items = options.items || [];
        this.itemHeight = options.itemHeight || 32;
        this.visibleCount = options.visibleCount || 10;
        this.selectedIndex = options.selectedIndex || -1;
        this.multiSelect = options.multiSelect || false;
        this.virtualized = options.virtualized !== false;
        this.sortable = options.sortable || false;
        this.sortField = options.sortField || null;
        this.sortDirection = options.sortDirection || 'asc';
        
        // Virtual scrolling
        this.scrollTop = 0;
        this.totalHeight = this.items.length * this.itemHeight;
        this.visibleStart = 0;
        this.visibleEnd = Math.min(this.visibleCount, this.items.length);
        
        // Rendering
        this.itemRenderer = options.itemRenderer || this.defaultItemRenderer;
        this.itemKey = options.itemKey || ((item, index) => index);
        
        // Set accessibility
        this.role = 'listbox';
        this.setState(NODE_STATE.FOCUSABLE, true);
        this.ariaMultiSelectable = this.multiSelect;
        this.ariaOrientation = 'vertical';
        
        // Set default styles
        this.setStyles({
            display: 'block',
            overflow: 'auto',
            backgroundColor: 'color(background.primary)',
            border: `1px solid color(text.tertiary)`,
            borderRadius: 'radius.md',
            outline: 'none',
            position: 'relative'
        });
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Initial render
        this.renderItems();
    }

    // Set items
    setItems(items) {
        this.items = items;
        this.totalHeight = items.length * this.itemHeight;
        this.selectedIndex = -1;
        this.updateVisibleRange();
        this.renderItems();
    }

    // Get items
    getItems() {
        return this.items;
    }

    // Get selected items
    getSelectedItems() {
        if (this.multiSelect) {
            return this.items.filter((item, index) => this.isItemSelected(index));
        } else if (this.selectedIndex >= 0) {
            return [this.items[this.selectedIndex]];
        }
        return [];
    }

    // Set selected index
    setSelectedIndex(index) {
        if (index < -1 || index >= this.items.length) return false;
        
        const oldIndex = this.selectedIndex;
        this.selectedIndex = index;
        
        // Update selection
        this.updateSelection(oldIndex, index);
        
        // Ensure selected item is visible
        if (index >= 0) {
            this.scrollToIndex(index);
        }
        
        // Emit selection change
        this.emitSelectionChange(oldIndex, index);
        
        return true;
    }

    // Select item
    selectItem(index, addToSelection = false) {
        if (index < 0 || index >= this.items.length) return false;
        
        if (this.multiSelect && addToSelection) {
            this.toggleItemSelection(index);
        } else {
            this.setSelectedIndex(index);
        }
        
        return true;
    }

    // Clear selection
    clearSelection() {
        const oldIndex = this.selectedIndex;
        this.selectedIndex = -1;
        this.selectedIndices = new Set();
        this.updateSelection(oldIndex, -1);
        this.emitSelectionChange(oldIndex, -1);
    }

    // Toggle item selection
    toggleItemSelection(index) {
        if (!this.multiSelect) return;
        
        if (!this.selectedIndices) {
            this.selectedIndices = new Set();
        }
        
        const wasSelected = this.selectedIndices.has(index);
        if (wasSelected) {
            this.selectedIndices.delete(index);
        } else {
            this.selectedIndices.add(index);
        }
        
        // Update visual selection
        this.updateItemSelection(index, !wasSelected);
    }

    // Check if item is selected
    isItemSelected(index) {
        if (this.multiSelect) {
            return this.selectedIndices ? this.selectedIndices.has(index) : false;
        }
        return this.selectedIndex === index;
    }

    // Scroll to index
    scrollToIndex(index) {
        if (index < 0 || index >= this.items.length) return;
        
        const itemTop = index * this.itemHeight;
        const itemBottom = itemTop + this.itemHeight;
        const containerHeight = this.layoutBox.height;
        const currentScrollTop = this.scrollTop;
        
        // Check if item is already visible
        if (itemTop >= currentScrollTop && itemBottom <= currentScrollTop + containerHeight) {
            return;
        }
        
        // Scroll to make item visible
        let newScrollTop = currentScrollTop;
        
        if (itemTop < currentScrollTop) {
            newScrollTop = itemTop;
        } else if (itemBottom > currentScrollTop + containerHeight) {
            newScrollTop = itemBottom - containerHeight;
        }
        
        this.setScrollTop(newScrollTop);
    }

    // Set scroll top
    setScrollTop(scrollTop) {
        const maxScrollTop = Math.max(0, this.totalHeight - this.layoutBox.height);
        this.scrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop));
        this.updateVisibleRange();
        this.renderItems();
    }

    // Update visible range
    updateVisibleRange() {
        if (!this.virtualized) {
            this.visibleStart = 0;
            this.visibleEnd = this.items.length;
            return;
        }
        
        const start = Math.floor(this.scrollTop / this.itemHeight);
        this.visibleStart = Math.max(0, start);
        this.visibleEnd = Math.min(
            this.visibleStart + this.visibleCount + 1, // +1 for buffer
            this.items.length
        );
    }

    // Sort items
    sortItems(field = null, direction = null) {
        if (!this.sortable) return;
        
        this.sortField = field || this.sortField;
        this.sortDirection = direction || this.sortDirection;
        
        if (!this.sortField) return;
        
        this.items.sort((a, b) => {
            const aVal = this.getSortValue(a, this.sortField);
            const bVal = this.getSortValue(b, this.sortField);
            
            let comparison = 0;
            if (aVal < bVal) comparison = -1;
            else if (aVal > bVal) comparison = 1;
            
            return this.sortDirection === 'desc' ? -comparison : comparison;
        });
        
        this.renderItems();
    }

    // Get sort value
    getSortValue(item, field) {
        if (typeof item === 'object' && item !== null) {
            return item[field];
        }
        return item;
    }

    // Render items
    renderItems() {
        // Clear existing items
        while (this.children.length > 0) {
            this.removeChild(this.children[0]);
        }
        
        if (this.virtualized) {
            this.renderVirtualizedItems();
        } else {
            this.renderAllItems();
        }
    }

    // Render virtualized items
    renderVirtualizedItems() {
        // Create container for virtual items
        const container = new UINode(`${this.id}-container`, 'list-container');
        container.setStyles({
            display: 'block',
            height: `${this.totalHeight}px`,
            position: 'relative'
        });
        
        // Add spacer for scroll offset
        const spacer = new UINode(`${this.id}-spacer`, 'list-spacer');
        spacer.setStyles({
            display: 'block',
            height: `${this.visibleStart * this.itemHeight}px`,
            width: '100%'
        });
        container.appendChild(spacer);
        
        // Render visible items
        for (let i = this.visibleStart; i < this.visibleEnd; i++) {
            const item = this.items[i];
            const itemNode = this.renderItem(item, i);
            itemNode.setStyle('position', 'absolute');
            itemNode.setStyle('top', `${i * this.itemHeight}px`);
            itemNode.setStyle('width', '100%');
            itemNode.setStyle('height', `${this.itemHeight}px`);
            container.appendChild(itemNode);
        }
        
        this.appendChild(container);
    }

    // Render all items
    renderAllItems() {
        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            const itemNode = this.renderItem(item, i);
            this.appendChild(itemNode);
        }
    }

    // Render single item
    renderItem(item, index) {
        const itemKey = this.itemKey(item, index);
        const itemId = `${this.id}-item-${itemKey}`;
        
        const itemNode = new UINode(itemId, 'list-item');
        itemNode.role = 'option';
        itemNode.ariaSelected = this.isItemSelected(index);
        itemNode.setState(NODE_STATE.SELECTED, this.isItemSelected(index));
        
        // Set item styles
        itemNode.setStyles({
            display: 'flex',
            alignItems: 'center',
            padding: 'spacing.sm spacing.md',
            backgroundColor: this.isItemSelected(index) ? 
                'color(primary.50)' : 'transparent',
            color: this.isItemSelected(index) ? 
                'color(primary.600)' : 'color.text.primary',
            border: 'none',
            borderBottom: `1px solid color(text.tertiary)`,
            cursor: 'pointer',
            userSelect: 'none',
            transition: 'all 150ms ease',
            outline: 'none'
        });
        
        // Hover styles
        itemNode.setStyles({
            ':hover': {
                backgroundColor: 'color(background.secondary)'
            }
        });
        
        // Focus styles
        itemNode.setStyles({
            ':focus': {
                backgroundColor: 'color(primary.100)',
                outline: '2px solid color(primary.500)',
                outlineOffset: '-2px'
            }
        });
        
        // Render item content
        const content = this.itemRenderer(item, index, itemNode);
        if (content) {
            if (typeof content === 'string') {
                itemNode.textContent = content;
            } else if (content instanceof UINode) {
                itemNode.appendChild(content);
            }
        }
        
        // Add item event handlers
        this.setupItemEventHandlers(itemNode, index);
        
        return itemNode;
    }

    // Default item renderer
    defaultItemRenderer(item, index, itemNode) {
        const textNode = new UINode(`${itemNode.id}-text`, 'item-text');
        textNode.textContent = typeof item === 'string' ? item : JSON.stringify(item);
        textNode.setStyles({
            display: 'block',
            fontSize: 14,
            color: 'inherit',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
        });
        return textNode;
    }

    // Setup item event handlers
    setupItemEventHandlers(itemNode, index) {
        // Click handler
        itemNode.addEventListener('click', (event) => {
            event.preventDefault();
            this.selectItem(index, event.ctrlKey || event.metaKey);
        });
        
        // Double click handler
        itemNode.addEventListener('dblclick', (event) => {
            event.preventDefault();
            this.emitItemAction(index, 'double-click');
        });
        
        // Keyboard navigation
        itemNode.addEventListener('keydown', (event) => {
            this.handleItemKeydown(event, index);
        });
    }

    // Handle item keydown
    handleItemKeydown(event, index) {
        switch (event.key) {
            case 'ArrowUp':
                event.preventDefault();
                this.navigateItems(-1);
                break;
                
            case 'ArrowDown':
                event.preventDefault();
                this.navigateItems(1);
                break;
                
            case 'Home':
                event.preventDefault();
                this.setSelectedIndex(0);
                break;
                
            case 'End':
                event.preventDefault();
                this.setSelectedIndex(this.items.length - 1);
                break;
                
            case 'Enter':
            case ' ':
                event.preventDefault();
                this.selectItem(index, event.ctrlKey || event.metaKey);
                this.emitItemAction(index, 'activate');
                break;
                
            case 'a':
            case 'A':
                if (event.ctrlKey || event.metaKey) {
                    event.preventDefault();
                    this.selectAll();
                }
                break;
        }
    }

    // Navigate items
    navigateItems(direction) {
        if (this.items.length === 0) return;
        
        let newIndex = this.selectedIndex;
        
        if (newIndex === -1) {
            newIndex = direction > 0 ? 0 : this.items.length - 1;
        } else {
            newIndex += direction;
        }
        
        newIndex = Math.max(0, Math.min(newIndex, this.items.length - 1));
        this.setSelectedIndex(newIndex);
    }

    // Select all items
    selectAll() {
        if (!this.multiSelect) return;
        
        this.selectedIndices = new Set();
        for (let i = 0; i < this.items.length; i++) {
            this.selectedIndices.add(i);
        }
        
        this.renderItems();
        this.emitSelectionChange(-1, -1);
    }

    // Update selection
    updateSelection(oldIndex, newIndex) {
        if (this.virtualized) {
            // Update only visible items
            this.updateVisibleSelection(oldIndex, newIndex);
        } else {
            // Update all items
            this.updateAllSelection(oldIndex, newIndex);
        }
    }

    // Update visible selection
    updateVisibleSelection(oldIndex, newIndex) {
        // Update old item if visible
        if (oldIndex >= this.visibleStart && oldIndex < this.visibleEnd) {
            const oldItem = this.findItemNode(oldIndex);
            if (oldItem) {
                this.updateItemSelection(oldIndex, false, oldItem);
            }
        }
        
        // Update new item if visible
        if (newIndex >= this.visibleStart && newIndex < this.visibleEnd) {
            const newItem = this.findItemNode(newIndex);
            if (newItem) {
                this.updateItemSelection(newIndex, true, newItem);
            }
        }
    }

    // Update all selection
    updateAllSelection(oldIndex, newIndex) {
        const children = this.getChildren();
        
        // Update old item
        if (oldIndex >= 0 && oldIndex < children.length) {
            this.updateItemSelection(oldIndex, false, children[oldIndex]);
        }
        
        // Update new item
        if (newIndex >= 0 && newIndex < children.length) {
            this.updateItemSelection(newIndex, true, children[newIndex]);
        }
    }

    // Update item selection
    updateItemSelection(index, selected, itemNode = null) {
        if (!itemNode) {
            itemNode = this.findItemNode(index);
        }
        
        if (!itemNode) return;
        
        itemNode.setState(NODE_STATE.SELECTED, selected);
        itemNode.ariaSelected = selected;
        
        // Update styles
        itemNode.setStyles({
            backgroundColor: selected ? 'color(primary.50)' : 'transparent',
            color: selected ? 'color(primary.600)' : 'color.text.primary'
        });
    }

    // Find item node
    findItemNode(index) {
        if (this.virtualized) {
            // Search in virtualized container
            const container = this.findChild('list-container');
            if (container) {
                const itemKey = this.itemKey(this.items[index], index);
                return container.findChild(`list-item-${itemKey}`);
            }
        } else {
            // Search in direct children
            const children = this.getChildren();
            if (index >= 0 && index < children.length) {
                return children[index];
            }
        }
        
        return null;
    }

    // Setup event handlers
    setupEventHandlers() {
        // Scroll handler
        this.addEventListener('scroll', (event) => {
            this.setScrollTop(event.target.scrollTop);
        });
        
        // Focus management
        this.addEventListener('focus', () => {
            if (this.selectedIndex >= 0) {
                const itemNode = this.findItemNode(this.selectedIndex);
                if (itemNode) {
                    itemNode.focus();
                }
            }
        });
    }

    // Emit selection change
    emitSelectionChange(oldIndex, newIndex) {
        const changeEvent = {
            type: 'selection-change',
            target: this,
            oldIndex,
            newIndex,
            selectedItems: this.getSelectedItems(),
            defaultPrevented: false,
            preventDefault: () => { changeEvent.defaultPrevented = true; }
        };
        
        this.dispatchEvent(changeEvent);
        
        if (!changeEvent.defaultPrevented) {
            this.handleSelectionChange(oldIndex, newIndex);
        }
    }

    // Handle selection change
    handleSelectionChange(oldIndex, newIndex) {
        this.emit('selection-changed', {
            target: this,
            oldIndex,
            newIndex,
            selectedItems: this.getSelectedItems()
        });
    }

    // Emit item action
    emitItemAction(index, action) {
        const actionEvent = {
            type: 'item-action',
            target: this,
            index,
            action,
            item: this.items[index],
            defaultPrevented: false,
            preventDefault: () => { actionEvent.defaultPrevented = true; }
        };
        
        this.dispatchEvent(actionEvent);
        
        if (!actionEvent.defaultPrevented) {
            this.handleItemAction(index, action);
        }
    }

    // Handle item action
    handleItemAction(index, action) {
        this.emit('item-action', {
            target: this,
            index,
            action,
            item: this.items[index]
        });
    }

    // Get list view info
    getInfo() {
        return {
            ...this.getDebugInfo(),
            itemCount: this.items.length,
            selectedIndex: this.selectedIndex,
            selectedItems: this.getSelectedItems(),
            itemHeight: this.itemHeight,
            visibleCount: this.visibleCount,
            virtualized: this.virtualized,
            multiSelect: this.multiSelect,
            sortable: this.sortable,
            sortField: this.sortField,
            sortDirection: this.sortDirection,
            scrollTop: this.scrollTop,
            totalHeight: this.totalHeight,
            visibleStart: this.visibleStart,
            visibleEnd: this.visibleEnd
        };
    }

    // Override destroy to clean up list view specific resources
    destroy() {
        // Clear all items
        this.items = [];
        this.selectedIndices = null;
        
        // Call parent destroy
        super.destroy();
    }
}

// ListView factory functions
export const ListViewFactory = {
    // Create basic list view
    create(id, options = {}) {
        return new ListView(id, options);
    },
    
    // Create with items
    createWithItems(id, items, options = {}) {
        return new ListView(id, { items, ...options });
    },
    
    // Create virtualized list
    createVirtualized(id, items, options = {}) {
        return new ListView(id, { items, virtualized: true, ...options });
    },
    
    // Create multi-select list
    createMultiSelect(id, items, options = {}) {
        return new ListView(id, { items, multiSelect: true, ...options });
    },
    
    // Create sortable list
    createSortable(id, items, options = {}) {
        return new ListView(id, { items, sortable: true, ...options });
    },
    
    // Create data grid
    createDataGrid(id, columns, rows, options = {}) {
        const listView = new ListView(id, {
            items: rows,
            itemRenderer: (row, index, itemNode) => {
                const rowNode = new UINode(`${itemNode.id}-row`, 'data-row');
                rowNode.setStyles({
                    display: 'flex',
                    alignItems: 'center',
                    width: '100%'
                });
                
                columns.forEach((column, colIndex) => {
                    const cellNode = new UINode(`${rowNode.id}-cell-${colIndex}`, 'data-cell');
                    cellNode.textContent = row[column.field] || '';
                    cellNode.setStyles({
                        flex: column.width || 1,
                        padding: 'spacing.sm',
                        fontSize: 14,
                        color: 'inherit',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                    });
                    rowNode.appendChild(cellNode);
                });
                
                return rowNode;
            },
            ...options
        });
        
        return listView;
    }
};
