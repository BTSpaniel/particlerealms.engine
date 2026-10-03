// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * List - Basic list widget for Plauna
 * Provides list functionality with multiple variants and states
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { uniformDistribution } from '../../../engine/core/math/MathRandom.js';

let _listSequence = 0;

function _newListId() {
    return `list-${Date.now()}-${++_listSequence}`;
}

export class List extends UINode {
    // Widget metadata
    static id = 'list';
    static name = 'List';
    static category = 'dataviews';
    static icon = '📝';
    static description = 'Basic list widget';
    static tags = ['dataviews', 'list'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            items: [],
            variant: 'default',
            size: 'md',
            ordered: false
        };
    }
    
    static create(container, options = {}) {
        const instance = new List(_newListId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newListId(), options = {}) {
        super(id, 'list');
        
        // List-specific properties
        this.items = options.items || [];
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.ordered = options.ordered || false;
        this.horizontal = options.horizontal || false;
        this.striped = options.striped || false;
        this.bordered = options.bordered || false;
        this.hoverable = options.hoverable || false;
        this.selectable = options.selectable || false;
        this.multiSelect = options.multiSelect || false;
        this.loading = options.loading || false;
        this.empty = options.empty || 'No items to display';
        
        // State management
        this.selectedItems = new Set();
        
        // Set accessibility
        this.role = this.ordered ? 'list' : 'list';
        this.ariaMultiSelectable = this.multiSelect;
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build list structure
        this.buildList();
        
        // Initialize items
        if (options.items) {
            this.setItems(options.items);
        }
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        
        this.setStyles({
            display: this.horizontal ? 'flex' : 'block',
            flexDirection: this.horizontal ? 'row' : 'column',
            gap: tokens.get('spacing.sm'),
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
            if (this.selectable) {
                const itemElement = e.target.closest('[data-list-item]');
                if (itemElement) {
                    const itemIndex = parseInt(itemElement.dataset.listItem);
                    this.toggleItemSelection(itemIndex, e.ctrlKey || e.metaKey);
                    e.preventDefault();
                }
            }
        });
        
        this.addEventListener('keydown', (e) => {
            switch (e.key) {
                case 'ArrowUp':
                case 'ArrowDown':
                case 'Home':
                case 'End':
                    this.handleKeyboardNavigation(e);
                    break;
                case ' ':
                case 'Enter':
                    if (this.selectable && this.focusedItem !== null) {
                        e.preventDefault();
                        this.toggleItemSelection(this.focusedItem, e.ctrlKey || e.metaKey);
                    }
                    break;
            }
        });
    }
    
    buildList() {
        this.innerHTML = '';
        
        // Create list element
        const listElement = this.ordered ? 
            document.createElement('ol') : 
            document.createElement('ul');
        
        listElement.style.cssText = (
            'list-style: ' + (this.ordered ? 'decimal' : 'none') + ';' +
            'margin: 0;' +
            'padding: 0;' +
            'display: ' + (this.horizontal ? 'flex' : 'block') + ';' +
            'flex-direction: ' + (this.horizontal ? 'row' : 'column') + ';' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'border: ' + (this.bordered ? '1px solid ' + tokens.get('colors.border.medium') : 'none') + ';' +
            'border-radius: ' + tokens.get('borderRadius.md') + ';' +
            'overflow: auto;'
        );
        
        this.listElement = listElement;
        this.appendChild(listElement);
        
        // Render initial items
        this.renderItems();
    }
    
    renderItems() {
        if (!this.listElement) return;
        
        this.listElement.innerHTML = '';
        
        if (this.loading) {
            // Show loading state
            const loadingItem = document.createElement('li');
            loadingItem.style.cssText = (
                'padding: ' + tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg') + ';' +
                'color: ' + tokens.get('colors.text.secondary') + ';' +
                'font-style: italic;'
            );
            loadingItem.textContent = 'Loading...';
            this.listElement.appendChild(loadingItem);
            return;
        }
        
        if (this.items.length === 0) {
            // Show empty state
            const emptyItem = document.createElement('li');
            emptyItem.style.cssText = (
                'padding: ' + tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg') + ';' +
                'color: ' + tokens.get('colors.text.secondary') + ';' +
                'font-style: italic;'
            );
            emptyItem.textContent = this.empty;
            this.listElement.appendChild(emptyItem);
            return;
        }
        
        // Render list items
        this.items.forEach((item, index) => {
            const itemElement = this.createItemElement(item, index);
            this.listElement.appendChild(itemElement);
        });
    }
    
    createItemElement(item, index) {
        const isSelected = this.selectedItems.has(index);
        
        const itemElement = document.createElement('li');
        itemElement.dataset.listItem = index.toString();
        itemElement.setAttribute('role', 'listitem');
        itemElement.setAttribute('aria-selected', isSelected.toString());
        itemElement.style.cssText = (
            'padding: ' + tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg') + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'cursor: ' + (this.selectable ? 'pointer' : 'default') + ';' +
            'transition: all 150ms ease;' +
            'background: ' + (isSelected ? this.getSelectedBackgroundColor() : 'transparent') + ';' +
            'color: ' + (isSelected ? this.getSelectedTextColor() : 'inherit') + ';' +
            'border: ' + (this.bordered ? '1px solid ' + tokens.get('colors.border.light') : 'none') + ';' +
            'display: ' + (this.horizontal ? 'inline-flex' : 'flex') + ';' +
            'align-items: ' + (this.horizontal ? 'center' : 'flex-start') + ';' +
            'gap: ' + tokens.get('spacing.sm') + ';'
        );
        
        // Add hover effect for selectable lists
        if (this.hoverable || this.selectable) {
            itemElement.addEventListener('mouseenter', () => {
                if (!isSelected) {
                    itemElement.style.background = tokens.get('colors.background.tertiary');
                }
            });
            
            itemElement.addEventListener('mouseleave', () => {
                if (!isSelected) {
                    itemElement.style.background = 'transparent';
                }
            });
        }
        
        // Add striped effect
        if (this.striped && index % 2 === 1) {
            itemElement.style.background = tokens.get('colors.background.secondary');
        }
        
        // Add item icon if present
        if (item.icon) {
            const icon = document.createElement('span');
            icon.textContent = item.icon;
            icon.style.cssText = (
                'width: 16px;' +
                'height: 16px;' +
                'display: flex;' +
                'align-items: center;' +
                'justify-content: center;' +
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'color: ' + tokens.get('colors.text.secondary') + ';' +
                'flex-shrink: 0;'
            );
            itemElement.appendChild(icon);
        }
        
        // Add item content
        const content = document.createElement('span');
        content.textContent = item.label || item.content || '';
        content.style.cssText = (
            'flex: 1;' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'color: inherit;'
        );
        itemElement.appendChild(content);
        
        // Add badge if present
        if (item.badge) {
            const badge = document.createElement('span');
            badge.textContent = item.badge;
            badge.style.cssText = (
                'background: ' + tokens.get('colors.primary.500') + ';' +
                'color: white;' +
                'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
                'padding: 2px 6px;' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'margin-left: ' + tokens.get('spacing.sm') + ';' +
                'flex-shrink: 0;'
            );
            itemElement.appendChild(badge);
        }
        
        // Add action if present
        if (item.action) {
            const actionButton = document.createElement('button');
            actionButton.textContent = item.action.label || 'Action';
            actionButton.style.cssText = (
                'padding: ' + tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm') + ';' +
                'background: ' + tokens.get('colors.background.primary') + ';' +
                'color: ' + tokens.get('colors.text.primary') + ';' +
                'border: 1px solid ' + tokens.get('colors.border.medium') + ';' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'cursor: pointer;' +
                'transition: all 150ms ease;' +
                'flex-shrink: 0;'
            );
            
            actionButton.addEventListener('click', (e) => {
                e.stopPropagation();
                if (item.action.onClick && typeof item.action.onClick === 'function') {
                    item.action.onClick(item, index);
                }
            });
            
            itemElement.appendChild(actionButton);
        }
        
        return itemElement;
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
    setItems(items) {
        this.items = items || [];
        this.renderItems();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    addItem(item) {
        this.items.push(item);
        this.renderItems();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    removeItem(index) {
        if (index >= 0 && index < this.items.length) {
            this.items.splice(index, 1);
            this.selectedItems.delete(index);
            this.renderItems();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    toggleItemSelection(index, multiSelect = false) {
        if (!this.selectable) return;
        
        if (this.multiSelect) {
            if (this.selectedItems.has(index)) {
                this.selectedItems.delete(index);
            } else {
                this.selectedItems.add(index);
            }
        } else {
            this.selectedItems.clear();
            this.selectedItems.add(index);
        }
        
        this.renderItems();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'selectionChange',
            bubbles: true,
            detail: {
                index,
                selectedItems: Array.from(this.selectedItems),
                item: this.items[index],
                multiSelect: this.multiSelect
            }
        });
    }
    
    clearSelection() {
        this.selectedItems.clear();
        this.renderItems();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setLoading(loading) {
        this.loading = loading;
        this.renderItems();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.renderItems();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.renderItems();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setOrdered(ordered) {
        if (this.ordered !== ordered) {
            this.ordered = ordered;
            this.buildList();
            this.renderItems();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setHorizontal(horizontal) {
        if (this.horizontal !== horizontal) {
            this.horizontal = horizontal;
            this.setupStyles();
            this.buildList();
            this.renderItems();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setStriped(striped) {
        if (this.striped !== striped) {
            this.striped = striped;
            this.renderItems();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setBordered(bordered) {
        if (this.bordered !== bordered) {
            this.bordered = bordered;
            this.buildList();
            this.renderItems();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setHoverable(hoverable) {
        if (this.hoverable !== hoverable) {
            this.hoverable = hoverable;
            this.renderItems();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
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
                if (this.selectedItems.size > 0) {
                    const firstSelected = Array.from(this.selectedItems)[0];
                    this.selectedItems.clear();
                    this.selectedItems.add(firstSelected);
                }
            }
            this.renderItems();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setEmpty(empty) {
        if (this.empty !== empty) {
            this.empty = empty;
            this.renderItems();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    handleKeyboardNavigation(e) {
        // Implementation for keyboard navigation
        // This would handle arrow keys, Home, End, etc.
    }
    
    // Static factory methods
    static createList(id, options = {}) {
        return new List(id, options);
    }
    
    static createPrimaryList(id, options = {}) {
        return new List(id, { variant: 'primary', ...options });
    }
    
    static createSuccessList(id, options = {}) {
        return new List(id, { variant: 'success', ...options });
    }
    
    static createWarningList(id, options = {}) {
        return new List(id, { variant: 'warning', ...options });
    }
    
    static createErrorList(id, options = {}) {
        return new List(id, { variant: 'error', ...options });
    }
    
    static createSmallList(id, options = {}) {
        return new List(id, { size: 'sm', ...options });
    }
    
    static createLargeList(id, options = {}) {
        return new List(id, { size: 'lg', ...options });
    }
    
    static createXLargeList(id, options = {}) {
        return new List(id, { size: 'xl', ...options });
    }
    
    static createOrderedList(id, options = {}) {
        return new List(id, { ordered: true, ...options });
    }
    
    static createHorizontalList(id, options = {}) {
        return new List(id, { horizontal: true, ...options });
    }
    
    static createStripedList(id, options = {}) {
        return new List(id, { striped: true, ...options });
    }
    
    static createBorderedList(id, options = {}) {
        return new List(id, { bordered: true, ...options });
    }
    
    static createSelectableList(id, options = {}) {
        return new List(id, { selectable: true, ...options });
    }
    
    static createMultiSelectList(id, options = {}) {
        return new List(id, { selectable: true, multiSelect: true, ...options });
    }
    
    static createIconList(id, options = {}) {
        return new List(id, { showIcons: true, ...options });
    }
    
    static createBadgeList(id, options = {}) {
        return new List(id, { 
            items: options.items?.map(item => ({
                ...item,
                badge: Math.floor(uniformDistribution(0, 100, Math.random))
            })),
            ...options
        });
    }
    
    static createActionList(id, options = {}) {
        return new List(id, {
            items: options.items?.map(item => ({
                ...item,
                action: {
                    label: 'View',
                    onClick: (item, index) => {
                        console.log('Action clicked:', item, index);
                    }
                }
            })),
            ...options
        });
    }
}
