// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Tabs - Tab navigation widget for Plauna
 * Provides tabbed interface with keyboard navigation and styling
 */

import { UINode, NODE_STATE } from '../../core/UINode.js';

export class Tabs extends UINode {
    constructor(id, options = {}) {
        super(id, 'tabs');
        
        // Tabs-specific properties
        this.tabs = [];
        this.activeTab = options.activeTab || 0;
        this.orientation = options.orientation || 'horizontal';
        this.variant = options.variant || 'default';
        this.stretch = options.stretch || false;
        this.disabled = options.disabled || false;
        
        // Set accessibility
        this.role = 'tablist';
        this.setState(NODE_STATE.FOCUSABLE, !this.disabled);
        
        // Set default styles
        this.setStyles({
            display: 'flex',
            flexDirection: this.orientation === 'horizontal' ? 'row' : 'column',
            backgroundColor: 'transparent',
            border: 'none',
            outline: 'none'
        });
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Add initial tabs if provided
        if (options.tabs) {
            options.tabs.forEach((tab, index) => {
                this.addTab(tab.title, tab.content, tab.options);
            });
            this.setActiveTab(this.activeTab);
        }
    }

    // Add a tab
    addTab(title, content, options = {}) {
        const tabIndex = this.tabs.length;
        const tabId = `${this.id}-tab-${tabIndex}`;
        const panelId = `${this.id}-panel-${tabIndex}`;
        
        // Create tab button
        const tabButton = new UINode(tabId, 'tab');
        tabButton.role = 'tab';
        tabButton.setState(NODE_STATE.FOCUSABLE, !this.disabled);
        tabButton.ariaSelected = tabIndex === this.activeTab;
        tabButton.ariaControls = panelId;
        tabButton.tabIndex = tabIndex === this.activeTab ? '0' : '-1';
        
        tabButton.setStyles({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: this.orientation === 'horizontal' ? 'spacing.sm spacing.md' : 'spacing.md',
            backgroundColor: tabIndex === this.activeTab ? 'color(background.primary)' : 'transparent',
            color: tabIndex === this.activeTab ? 'color(primary.500)' : 'color(text.secondary)',
            border: 'none',
            borderBottom: this.orientation === 'horizontal' && tabIndex === this.activeTab ? 
                `2px solid color(primary.500)` : '2px solid transparent',
            borderRadius: this.orientation === 'horizontal' ? 'radius.sm radius.sm 0 0' : 'radius.sm',
            fontSize: 14,
            fontWeight: tabIndex === this.activeTab ? 'typography.fontWeight.medium' : 'typography.fontWeight.regular',
            cursor: this.disabled ? 'not-allowed' : 'pointer',
            userSelect: 'none',
            transition: 'all 150ms ease',
            outline: 'none',
            flex: this.stretch ? '1' : 'none'
        });
        
        // Add tab content
        if (title) {
            const titleNode = new UINode(`${tabId}-title`, 'tab-title');
            titleNode.textContent = title;
            titleNode.setStyles({
                display: 'block',
                fontSize: 'inherit',
                fontWeight: 'inherit',
                color: 'inherit'
            });
            tabButton.appendChild(titleNode);
        }
        
        // Create tab panel
        const tabPanel = new UINode(panelId, 'tab-panel');
        tabPanel.role = 'tabpanel';
        tabPanel.ariaLabelledBy = tabId;
        tabPanel.hidden = tabIndex !== this.activeTab;
        tabPanel.setStyles({
            display: tabIndex === this.activeTab ? 'block' : 'none',
            padding: 'spacing.md',
            backgroundColor: 'color(background.primary)',
            border: `1px solid color(text.tertiary)`,
            borderTop: 'none',
            borderRadius: this.orientation === 'horizontal' ? '0 0 radius.md radius.md' : 'radius.md',
            outline: 'none'
        });
        
        // Add content to panel
        if (typeof content === 'string') {
            tabPanel.textContent = content;
        } else if (content instanceof UINode) {
            tabPanel.appendChild(content);
        }
        
        // Add tab event handlers
        this.setupTabEventHandlers(tabButton, tabIndex);
        
        // Add to tabs array
        this.tabs.push({
            button: tabButton,
            panel: tabPanel,
            title,
            content,
            options: { ...options, index: tabIndex }
        });
        
        // Add to DOM
        this.appendChild(tabButton);
        
        // Add panel to parent or create container
        if (this.parent) {
            this.parent.appendChild(tabPanel);
        } else {
            // Create a container for panels if no parent
            if (!this._panelContainer) {
                this._panelContainer = new UINode(`${this.id}-panels`, 'tab-panels');
                this._panelContainer.setStyles({
                    display: 'block',
                    outline: 'none'
                });
                this.parent.appendChild(this._panelContainer);
            }
            this._panelContainer.appendChild(tabPanel);
        }
        
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        return tabIndex;
    }

    // Remove a tab
    removeTab(index) {
        if (index < 0 || index >= this.tabs.length) return false;
        
        const tab = this.tabs[index];
        const wasActive = index === this.activeTab;
        
        // Remove from DOM
        this.removeChild(tab.button);
        if (this._panelContainer) {
            this._panelContainer.removeChild(tab.panel);
        } else if (this.parent) {
            this.parent.removeChild(tab.panel);
        }
        
        // Remove from array
        this.tabs.splice(index, 1);
        
        // Update indices
        this.tabs.forEach((tab, i) => {
            tab.button.id = `${this.id}-tab-${i}`;
            tab.button.ariaControls = `${this.id}-panel-${i}`;
            tab.panel.id = `${this.id}-panel-${i}`;
            tab.panel.ariaLabelledBy = `${this.id}-tab-${i}`;
            tab.options.index = i;
        });
        
        // Adjust active tab if necessary
        if (wasActive) {
            if (this.tabs.length > 0) {
                this.setActiveTab(Math.min(index, this.tabs.length - 1));
            } else {
                this.activeTab = -1;
            }
        } else if (index < this.activeTab) {
            this.activeTab--;
        }
        
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        return true;
    }

    // Set active tab
    setActiveTab(index) {
        if (index < 0 || index >= this.tabs.length) return false;
        
        if (this.activeTab === index) return true;
        
        const oldIndex = this.activeTab;
        this.activeTab = index;
        
        // Update old tab
        if (oldIndex >= 0 && oldIndex < this.tabs.length) {
            const oldTab = this.tabs[oldIndex];
            oldTab.button.ariaSelected = 'false';
            oldTab.button.tabIndex = '-1';
            oldTab.panel.hidden = 'true';
            
            // Update old tab styles
            oldTab.button.setStyles({
                backgroundColor: 'transparent',
                color: 'color(text.secondary)',
                borderBottom: '2px solid transparent',
                fontWeight: 'typography.fontWeight.regular'
            });
            
            oldTab.panel.setStyles({
                display: 'none'
            });
        }
        
        // Update new tab
        const newTab = this.tabs[index];
        newTab.button.ariaSelected = 'true';
        newTab.button.tabIndex = '0';
        newTab.panel.hidden = 'false';
        
        // Update new tab styles
        newTab.button.setStyles({
            backgroundColor: 'color(background.primary)',
            color: 'color(primary.500)',
            borderBottom: `2px solid color(primary.500)`,
            fontWeight: 'typography.fontWeight.medium'
        });
        
        newTab.panel.setStyles({
            display: 'block'
        });
        
        // Focus new tab button
        newTab.button.focus();
        
        this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        
        // Emit tab change event
        this.emitTabChange(oldIndex, index);
        
        return true;
    }

    // Get active tab
    getActiveTab() {
        return this.activeTab;
    }

    // Get tab by index
    getTab(index) {
        return this.tabs[index] || null;
    }

    // Get all tabs
    getAllTabs() {
        return this.tabs.map(tab => ({
            title: tab.title,
            index: tab.options.index,
            isActive: tab.options.index === this.activeTab
        }));
    }

    // Set orientation
    setOrientation(orientation) {
        if (this.orientation !== orientation) {
            this.orientation = orientation;
            this.setStyle('flexDirection', orientation === 'horizontal' ? 'row' : 'column');
            
            // Update tab button styles
            this.tabs.forEach(tab => {
                const isHorizontal = orientation === 'horizontal';
                tab.button.setStyles({
                    padding: isHorizontal ? 'spacing.sm spacing.md' : 'spacing.md',
                    borderBottom: isHorizontal && tab.options.index === this.activeTab ? 
                        `2px solid color(primary.500)` : '2px solid transparent',
                    borderRight: !isHorizontal && tab.options.index === this.activeTab ? 
                        `2px solid color(primary.500)` : '2px solid transparent',
                    borderRadius: isHorizontal ? 'radius.sm radius.sm 0 0' : 'radius.sm'
                });
                
                tab.panel.setStyles({
                    borderTop: isHorizontal ? 'none' : `1px solid color(text.tertiary)`,
                    borderLeft: !isHorizontal ? 'none' : `1px solid color(text.tertiary)`,
                    borderRadius: isHorizontal ? '0 0 radius.md radius.md' : 'radius.md'
                });
            });
            
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }

    // Set variant
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.applyVariant();
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }

    // Apply variant styles
    applyVariant() {
        switch (this.variant) {
            case 'pills':
                this.tabs.forEach(tab => {
                    tab.button.setStyles({
                        borderRadius: 'radius.full',
                        border: `1px solid ${tab.options.index === this.activeTab ? 'color(primary.500)' : 'color(text.tertiary)'}`,
                        borderBottom: 'none',
                        margin: this.orientation === 'horizontal' ? '0 spacing.xs 0 0' : '0 0 spacing.xs 0'
                    });
                });
                break;
                
            case 'underline':
                this.tabs.forEach(tab => {
                    tab.button.setStyles({
                        backgroundColor: 'transparent',
                        border: 'none',
                        borderBottom: tab.options.index === this.activeTab ? 
                            `2px solid color(primary.500)` : '2px solid transparent',
                        borderRadius: 'radius.none'
                    });
                });
                break;
                
            case 'card':
                this.setStyles({
                    backgroundColor: 'color(background.secondary)',
                    borderRadius: 'radius.md',
                    padding: 'spacing.xs'
                });
                break;
                
            default:
                // Default variant already applied
                break;
        }
    }

    // Setup tab event handlers
    setupTabEventHandlers(tabButton, index) {
        // Click handler
        tabButton.addEventListener('click', () => {
            if (!this.disabled) {
                this.setActiveTab(index);
            }
        });
        
        // Keyboard navigation
        tabButton.addEventListener('keydown', (event) => {
            if (this.disabled) return;
            
            switch (event.key) {
                case 'ArrowLeft':
                case 'ArrowUp':
                    if (this.orientation === 'horizontal' && event.key === 'ArrowLeft' ||
                        this.orientation === 'vertical' && event.key === 'ArrowUp') {
                        event.preventDefault();
                        this.navigateTab(-1);
                    }
                    break;
                    
                case 'ArrowRight':
                case 'ArrowDown':
                    if (this.orientation === 'horizontal' && event.key === 'ArrowRight' ||
                        this.orientation === 'vertical' && event.key === 'ArrowDown') {
                        event.preventDefault();
                        this.navigateTab(1);
                    }
                    break;
                    
                case 'Home':
                    event.preventDefault();
                    this.setActiveTab(0);
                    break;
                    
                case 'End':
                    event.preventDefault();
                    this.setActiveTab(this.tabs.length - 1);
                    break;
                    
                case 'Enter':
                case ' ':
                    event.preventDefault();
                    this.setActiveTab(index);
                    break;
            }
        });
    }

    // Navigate tabs
    navigateTab(direction) {
        if (this.tabs.length === 0) return;
        
        let newIndex = this.activeTab + direction;
        
        // Wrap around
        if (newIndex < 0) {
            newIndex = this.tabs.length - 1;
        } else if (newIndex >= this.tabs.length) {
            newIndex = 0;
        }
        
        this.setActiveTab(newIndex);
    }

    // Setup event handlers
    setupEventHandlers() {
        // Focus management
        this.addEventListener('focus', () => {
            if (this.activeTab >= 0 && this.tabs[this.activeTab]) {
                this.tabs[this.activeTab].button.focus();
            }
        });
    }

    // Emit tab change event
    emitTabChange(oldIndex, newIndex) {
        const changeEvent = {
            type: 'tab-change',
            target: this,
            oldIndex,
            newIndex,
            oldTab: this.tabs[oldIndex] || null,
            newTab: this.tabs[newIndex] || null,
            defaultPrevented: false,
            preventDefault: () => { changeEvent.defaultPrevented = true; }
        };
        
        this.dispatchEvent(changeEvent);
        
        if (!changeEvent.defaultPrevented) {
            this.handleTabChange(oldIndex, newIndex);
        }
    }

    // Handle tab change
    handleTabChange(oldIndex, newIndex) {
        // Placeholder for custom tab change handling
        this.emit('tab-changed', {
            target: this,
            oldIndex,
            newIndex,
            oldTab: this.tabs[oldIndex] || null,
            newTab: this.tabs[newIndex] || null
        });
    }

    // Get tabs info
    getInfo() {
        return {
            ...this.getDebugInfo(),
            tabs: this.getAllTabs(),
            activeTab: this.activeTab,
            orientation: this.orientation,
            variant: this.variant,
            stretch: this.stretch,
            disabled: this.disabled
        };
    }

    // Override destroy to clean up tabs-specific resources
    destroy() {
        // Clean up all tabs
        for (const tab of this.tabs) {
            tab.button.destroy();
            tab.panel.destroy();
        }
        
        // Clean up panel container
        if (this._panelContainer) {
            this._panelContainer.destroy();
        }
        
        this.tabs = [];
        this.activeTab = -1;
        
        // Call parent destroy
        super.destroy();
    }
}

// Tabs factory functions
export const TabsFactory = {
    // Create basic tabs
    create(id, options = {}) {
        return new Tabs(id, options);
    },
    
    // Create tabs with predefined tabs
    createWithTabs(id, tabs, options = {}) {
        return new Tabs(id, { tabs, ...options });
    },
    
    // Create vertical tabs
    createVertical(id, options = {}) {
        return new Tabs(id, { orientation: 'vertical', ...options });
    },
    
    // Create stretched tabs
    createStretched(id, options = {}) {
        return new Tabs(id, { stretch: true, ...options });
    },
    
    // Create pill tabs
    createPills(id, options = {}) {
        return new Tabs(id, { variant: 'pills', ...options });
    },
    
    // Create underline tabs
    createUnderline(id, options = {}) {
        return new Tabs(id, { variant: 'underline', ...options });
    },
    
    // Create card tabs
    createCard(id, options = {}) {
        return new Tabs(id, { variant: 'card', ...options });
    }
};
