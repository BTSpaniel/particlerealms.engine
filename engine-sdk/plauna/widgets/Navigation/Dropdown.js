// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Dropdown - Context menu widget for Plauna
 * Provides dropdown menus with keyboard navigation and accessibility
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _dropdownSequence = 0;

function _newDropdownId() {
    return `dropdown-${Date.now()}-${++_dropdownSequence}`;
}

export class Dropdown extends UINode {
    // Widget metadata
    static id = 'dropdown';
    static name = 'Dropdown';
    static category = 'navigation';
    static icon = '▼';
    static description = 'Dropdown menu';
    static tags = ['navigation', 'dropdown', 'menu'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            items: [],
            trigger: 'click',
            placement: 'bottom'
        };
    }
    
    static create(container, options = {}) {
        const instance = new Dropdown(_newDropdownId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newDropdownId(), options = {}) {
        super(id, 'dropdown');
        
        // Dropdown-specific properties
        this.items = options.items || [];
        this.placement = options.placement || 'bottom-start';
        this.trigger = options.trigger || 'click'; // click, hover, context
        this.disabled = options.disabled || false;
        this.variant = options.variant || 'default';
        this.size = options.size || 'md';
        this.closeOnSelect = options.closeOnSelect !== false;
        this.closeOnEscape = options.closeOnEscape !== false;
        this.closeOnOutside = options.closeOnOutside !== false;
        
        // State management
        this.open = false;
        this.selectedIndex = -1;
        this.targetElement = null;
        this.cleanupHandlers = null;
        
        // Set accessibility
        this.role = 'menu';
        this.ariaHidden = 'true';
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Update menu items
        this.updateItems();
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        
        this.setStyles({
            position: 'absolute',
            top: '0',
            left: '0',
            zIndex: '1002',
            display: 'none',
            opacity: '0',
            transform: 'scale(0.95) translateY(-8px)',
            transition: 'all 150ms ease-out',
            minWidth: '180px',
            maxWidth: '300px',
            backgroundColor: tokens.get('colors.background.primary'),
            border: `1px solid ${tokens.get('colors.border.medium')}`,
            borderRadius: tokens.get('borderRadius.md'),
            boxShadow: tokens.get('shadows.lg'),
            overflow: 'hidden',
            outline: 'none',
            ...sizeStyles,
            ...variantStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            sm: {
                fontSize: tokens.get('fontSizes.sm'),
                padding: '4px 0'
            },
            md: {
                fontSize: tokens.get('fontSizes.md'),
                padding: '6px 0'
            },
            lg: {
                fontSize: tokens.get('fontSizes.lg'),
                padding: '8px 0'
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        const variants = {
            default: {
                border: `1px solid ${tokens.get('colors.border.medium')}`
            },
            minimal: {
                border: 'none',
                boxShadow: tokens.get('shadows.md')
            },
            elevated: {
                border: `1px solid ${tokens.get('colors.border.light')}`,
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)'
            }
        };
        return variants[this.variant] || variants.default;
    }
    
    setupEventHandlers() {
        // Keyboard navigation
        this.addEventListener('keydown', (event) => {
            if (!this.open) return;
            
            switch (event.key) {
                case 'Escape':
                    event.preventDefault();
                    if (this.closeOnEscape) {
                        this.close();
                    }
                    break;
                case 'ArrowDown':
                    event.preventDefault();
                    this.navigateNext();
                    break;
                case 'ArrowUp':
                    event.preventDefault();
                    this.navigatePrevious();
                    break;
                case 'Home':
                    event.preventDefault();
                    this.navigateFirst();
                    break;
                case 'End':
                    event.preventDefault();
                    this.navigateLast();
                    break;
                case 'Enter':
                case ' ':
                    event.preventDefault();
                    this.selectCurrent();
                    break;
            }
        });
        
        // Click outside handler
        if (this.closeOnOutside) {
            document.addEventListener('click', (event) => {
                if (this.open && !this.element.contains(event.target) && !this.targetElement?.contains(event.target)) {
                    this.close();
                }
            });
        }
    }
    
    updateItems() {
        this.innerHTML = '';
        
        this.items.forEach((item, index) => {
            const menuItem = this.createMenuItem(item, index);
            this.appendChild(menuItem);
        });
        
        this.markDirty(DIRTY.PAINT);
    }
    
    createMenuItem(item, index) {
        const menuItem = new UINode(`${this.id}-item-${index}`, 'div');
        
        // Set accessibility
        menuItem.role = 'menuitem';
        menuItem.ariaDisabled = item.disabled ? 'true' : 'false';
        if (item.checked) {
            menuItem.ariaChecked = 'true';
        }
        
        // Set styles
        menuItem.setStyles({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `${tokens.get('spacing.sm')} ${tokens.get('spacing.md')}`,
            color: item.disabled ? tokens.get('colors.text.disabled') : tokens.get('colors.text.primary'),
            backgroundColor: 'transparent',
            border: 'none',
            cursor: item.disabled ? 'not-allowed' : 'pointer',
            fontSize: 'inherit',
            fontWeight: tokens.get('fontWeights.medium'),
            lineHeight: tokens.get('lineHeights.normal'),
            textDecoration: 'none',
            transition: 'all 150ms ease',
            outline: 'none'
        });
        
        // Create content
        const content = new UINode(`${menuItem.id}-content`, 'div');
        content.setStyles({
            display: 'flex',
            alignItems: 'center',
            gap: tokens.get('spacing.sm'),
            flex: '1'
        });
        
        // Add icon if present
        if (item.icon) {
            const icon = new UINode(`${menuItem.id}-icon`, 'span');
            icon.setStyles({
                display: 'flex',
                alignItems: 'center',
                fontSize: '16px',
                color: item.disabled ? tokens.get('colors.text.disabled') : tokens.get('colors.text.secondary')
            });
            icon.innerHTML = item.icon;
            content.appendChild(icon);
        }
        
        // Add label
        const label = new UINode(`${menuItem.id}-label`, 'span');
        label.textContent = item.label;
        content.appendChild(label);
        
        // Add shortcut if present
        if (item.shortcut) {
            const shortcut = new UINode(`${menuItem.id}-shortcut`, 'span');
            shortcut.setStyles({
                fontSize: tokens.get('fontSizes.xs'),
                color: tokens.get('colors.text.muted'),
                marginLeft: 'auto'
            });
            shortcut.textContent = item.shortcut;
            content.appendChild(shortcut);
        }
        
        menuItem.appendChild(content);
        
        // Add checkbox for checkable items
        if (item.checkable && item.checked !== undefined) {
            const check = new UINode(`${menuItem.id}-check`, 'span');
            check.setStyles({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '16px',
                height: '16px',
                fontSize: '12px',
                color: tokens.get('colors.primary.500'),
                marginLeft: tokens.get('spacing.sm')
            });
            check.innerHTML = item.checked ? '✓' : '';
            menuItem.appendChild(check);
        }
        
        // Add hover and focus styles
        if (!item.disabled) {
            menuItem.addEventListener('mouseenter', () => {
                menuItem.setStyle('backgroundColor', tokens.get('colors.background.tertiary'));
                this.selectedIndex = index;
            });
            
            menuItem.addEventListener('mouseleave', () => {
                menuItem.setStyle('backgroundColor', 'transparent');
            });
            
            menuItem.addEventListener('focus', () => {
                menuItem.setStyle('backgroundColor', tokens.get('colors.background.tertiary'));
                this.selectedIndex = index;
            });
            
            menuItem.addEventListener('blur', () => {
                menuItem.setStyle('backgroundColor', 'transparent');
            });
            
            menuItem.addEventListener('click', () => {
                this.selectItem(index);
            });
        }
        
        // Store item data
        menuItem._itemData = item;
        menuItem._itemIndex = index;
        
        return menuItem;
    }
    
    attachTo(element) {
        if (!element || this.targetElement === element) return;
        
        // Detach from previous element
        this.detach();
        
        this.targetElement = element;
        this.ariaHidden = 'true';
        
        // Setup trigger handlers
        const handlers = [];
        
        if (this.trigger === 'click') {
            const toggleHandler = (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.toggle();
            };
            
            element.addEventListener('click', toggleHandler);
            handlers.push({ event: 'click', handler: toggleHandler });
        } else if (this.trigger === 'hover') {
            const showHandler = () => this.show();
            const hideHandler = () => this.hide();
            
            element.addEventListener('mouseenter', showHandler);
            element.addEventListener('mouseleave', hideHandler);
            
            // Keep dropdown open when hovering over it
            this.addEventListener('mouseenter', showHandler);
            this.addEventListener('mouseleave', hideHandler);
            
            handlers.push(
                { event: 'mouseenter', handler: showHandler },
                { event: 'mouseleave', handler: hideHandler }
            );
        } else if (this.trigger === 'context') {
            const contextHandler = (event) => {
                event.preventDefault();
                this.show(event.clientX, event.clientY);
            };
            
            element.addEventListener('contextmenu', contextHandler);
            handlers.push({ event: 'contextmenu', handler: contextHandler });
        }
        
        // Store cleanup function
        this.cleanupHandlers = () => {
            handlers.forEach(({ event, handler }) => {
                element.removeEventListener(event, handler);
            });
        };
        
        // Set accessibility attributes
        element.setAttribute('aria-haspopup', 'true');
        element.setAttribute('aria-expanded', 'false');
        element.setAttribute('aria-controls', this.id);
    }
    
    detach() {
        if (this.cleanupHandlers) {
            this.cleanupHandlers();
            this.cleanupHandlers = null;
        }
        
        if (this.targetElement) {
            this.targetElement.removeAttribute('aria-haspopup');
            this.targetElement.removeAttribute('aria-expanded');
            this.targetElement.removeAttribute('aria-controls');
            this.targetElement = null;
        }
        
        this.close();
    }
    
    show(x = null, y = null) {
        if (this.disabled || this.open || !this.targetElement) return;
        
        this.open = true;
        this.ariaHidden = 'false';
        this.setStyle('display', 'block');
        
        // Update target element
        if (this.targetElement) {
            this.targetElement.setAttribute('aria-expanded', 'true');
        }
        
        // Position the dropdown
        if (x !== null && y !== null) {
            // Position at specific coordinates
            this.setStyle('left', `${x}px`);
            this.setStyle('top', `${y}px`);
        } else {
            // Position relative to target element
            this.updatePosition();
        }
        
        // Animate in
        requestAnimationFrame(() => {
            this.setStyle('opacity', '1');
            this.setStyle('transform', 'scale(1) translateY(0)');
        });
        
        // Focus for keyboard navigation
        requestAnimationFrame(() => {
            this.element?.focus();
            this.selectedIndex = -1;
        });
        
        // Emit show event
        this.dispatchEvent({ type: 'show', bubbles: false });
    }
    
    hide() {
        if (!this.open) return;
        
        this.open = false;
        this.ariaHidden = 'true';
        
        // Update target element
        if (this.targetElement) {
            this.targetElement.setAttribute('aria-expanded', 'false');
        }
        
        // Animate out
        this.setStyle('opacity', '0');
        this.setStyle('transform', 'scale(0.95) translateY(-8px)');
        
        setTimeout(() => {
            this.setStyle('display', 'none');
        }, 150);
        
        this.selectedIndex = -1;
        
        // Emit hide event
        this.dispatchEvent({ type: 'hide', bubbles: false });
    }
    
    toggle() {
        if (this.open) {
            this.hide();
        } else {
            this.show();
        }
    }
    
    updatePosition() {
        if (!this.targetElement || !this.element) return;
        
        const targetRect = this.targetElement.getBoundingClientRect();
        const dropdownRect = this.element.getBoundingClientRect();
        
        // Calculate position based on placement
        const position = this.calculatePosition(targetRect, dropdownRect);
        
        // Apply position
        this.setStyle('left', `${position.x}px`);
        this.setStyle('top', `${position.y}px`);
    }
    
    calculatePosition(targetRect, dropdownRect) {
        const scrollX = window.pageXOffset;
        const scrollY = window.pageYOffset;
        
        // Available positions
        const positions = {
            'bottom-start': {
                x: targetRect.left + scrollX,
                y: targetRect.bottom + scrollY + 4
            },
            'bottom-end': {
                x: targetRect.right - dropdownRect.width + scrollX,
                y: targetRect.bottom + scrollY + 4
            },
            'top-start': {
                x: targetRect.left + scrollX,
                y: targetRect.top - dropdownRect.height - 4 + scrollY
            },
            'top-end': {
                x: targetRect.right - dropdownRect.width + scrollX,
                y: targetRect.top - dropdownRect.height - 4 + scrollY
            },
            'right-start': {
                x: targetRect.right + 4 + scrollX,
                y: targetRect.top + scrollY
            },
            'left-start': {
                x: targetRect.left - dropdownRect.width - 4 + scrollX,
                y: targetRect.top + scrollY
            }
        };
        
        let position = positions[this.placement] || positions['bottom-start'];
        
        // Adjust if dropdown would go outside viewport
        const viewport = {
            width: window.innerWidth,
            height: window.innerHeight,
            scrollTop: scrollY,
            scrollLeft: scrollX
        };
        
        // Ensure dropdown stays within viewport
        if (position.x < viewport.scrollLeft + 10) {
            position.x = viewport.scrollLeft + 10;
        } else if (position.x + dropdownRect.width > viewport.scrollLeft + viewport.width - 10) {
            position.x = viewport.scrollLeft + viewport.width - dropdownRect.width - 10;
        }
        
        if (position.y < viewport.scrollTop + 10) {
            position.y = viewport.scrollTop + 10;
        } else if (position.y + dropdownRect.height > viewport.scrollTop + viewport.height - 10) {
            position.y = viewport.scrollTop + viewport.height - dropdownRect.height - 10;
        }
        
        return position;
    }
    
    navigateNext() {
        const enabledItems = this.items.filter(item => !item.disabled);
        if (enabledItems.length === 0) return;
        
        const currentIndex = enabledItems.findIndex(item => 
            this.items.indexOf(item) === this.selectedIndex
        );
        const nextIndex = (currentIndex + 1) % enabledItems.length;
        this.selectedIndex = this.items.indexOf(enabledItems[nextIndex]);
        this.focusItem(this.selectedIndex);
    }
    
    navigatePrevious() {
        const enabledItems = this.items.filter(item => !item.disabled);
        if (enabledItems.length === 0) return;
        
        const currentIndex = enabledItems.findIndex(item => 
            this.items.indexOf(item) === this.selectedIndex
        );
        const prevIndex = currentIndex <= 0 ? enabledItems.length - 1 : currentIndex - 1;
        this.selectedIndex = this.items.indexOf(enabledItems[prevIndex]);
        this.focusItem(this.selectedIndex);
    }
    
    navigateFirst() {
        const firstEnabled = this.items.findIndex(item => !item.disabled);
        if (firstEnabled !== -1) {
            this.selectedIndex = firstEnabled;
            this.focusItem(this.selectedIndex);
        }
    }
    
    navigateLast() {
        const lastEnabled = this.items.map(item => !item.disabled).lastIndexOf(true);
        if (lastEnabled !== -1) {
            this.selectedIndex = lastEnabled;
            this.focusItem(this.selectedIndex);
        }
    }
    
    focusItem(index) {
        const itemElement = this.children[index]?.element;
        if (itemElement) {
            itemElement.focus();
        }
    }
    
    selectCurrent() {
        if (this.selectedIndex >= 0 && this.selectedIndex < this.items.length) {
            this.selectItem(this.selectedIndex);
        }
    }
    
    selectItem(index) {
        const item = this.items[index];
        if (!item || item.disabled) return;
        
        // Handle checkable items
        if (item.checkable && item.checked !== undefined) {
            item.checked = !item.checked;
            this.updateItems();
        }
        
        // Execute action
        if (item.action) {
            item.action(item);
        }
        
        // Emit select event
        this.dispatchEvent({
            type: 'select',
            bubbles: false,
            detail: { item, index }
        });
        
        // Close if configured
        if (this.closeOnSelect) {
            this.hide();
        }
    }
    
    setItems(items) {
        this.items = items;
        this.updateItems();
    }
    
    setDisabled(disabled) {
        this.disabled = disabled;
        if (disabled) {
            this.hide();
        }
        this.markDirty(DIRTY.ACCESSIBILITY);
    }
    
    destroy() {
        this.detach();
        super.destroy();
    }
}
