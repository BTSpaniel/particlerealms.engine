// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Collapse - Collapsible content widget for Plauna
 * Provides collapsible/expandable content areas with smooth animations
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _collapseSequence = 0;

function _newCollapseId() {
    return `collapse-${Date.now()}-${++_collapseSequence}`;
}

export class Collapse extends UINode {
    // Widget metadata
    static id = 'collapse';
    static name = 'Collapse';
    static category = 'layout';
    static icon = '📦';
    static description = 'Collapsible container';
    static tags = ['layout', 'collapse', 'accordion'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            title: '',
            open: false,
            variant: 'default'
        };
    }
    
    static create(container, options = {}) {
        const instance = new Collapse(_newCollapseId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newCollapseId(), options = {}) {
        super(id, 'collapse');
        
        // Collapse-specific properties
        this.variant = options.variant || 'default'; // default, card, outlined, bordered, ghost
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.padding = options.padding || 'md'; // none, xs, sm, md, lg, xl, xxxl
        this.borderRadius = options.borderRadius || 'md'; // none, sm, md, lg, xl, full
        this.shadow = options.shadow || 'none'; // none, sm, md, lg, xl
        this.background = options.background || 'default'; // default, primary, secondary, accent, surface, transparent
        this.border = options.border || 'none'; // none, all, top, bottom, left, right
        this.borderColor = options.borderColor || 'medium'; // light, medium, dark
        this.borderWidth = options.borderWidth || '1px'; // 1px, 2px, 3px, 4px
        this.collapsed = options.collapsed !== false; // true = collapsed, false = expanded
        this.collapsible = options.collapsible !== false;
        this.animationDuration = options.animationDuration || '300ms'; // 100ms, 200ms, 300ms, 400ms, 500ms
        this.animationEasing = options.animationEasing || 'ease'; // ease, ease-in, ease-out, ease-in-out, linear
        this.showIcon = options.showIcon !== false;
        this.iconPosition = options.iconPosition || 'right'; // left, right
        this.iconCollapsed = options.iconCollapsed || '▼'; // ▼, ▶, +, chevron-down, etc.
        this.iconExpanded = options.iconExpanded || '▲'; // ▲, ▼, -, chevron-up, etc.
        this.persistState = options.persistState || false;
        this.storageKey = options.storageKey || `collapse-${id}`;
        
        // Content structure
        this.title = options.title || null;
        this.subtitle = options.subtitle || null;
        this.description = options.description || null;
        this.showHeader = options.showHeader !== false;
        this.headerActions = options.headerActions || [];
        this.footerContent = options.footerContent || null;
        this.showFooter = options.showFooter || false;
        
        // Accessibility
        this.ariaLabel = options.ariaLabel || null;
        this.ariaLabelledby = options.ariaLabelledby || null;
        this.ariaDescribedby = options.ariaDescribedby || null;
        
        // Set semantic role
        this.role = 'region';
        this.setAttribute('aria-label', this.ariaLabel || 'Collapsible content');
        this.setAttribute('aria-expanded', (!this.collapsed).toString());
        this.setAttribute('aria-controls', `${id}-content`);
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Load persisted state if needed
        if (this.persistState) {
            this.loadPersistedState();
        }
        
        // Build collapse structure
        this.buildCollapse();
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        const spacingStyles = this.getSpacingStyles();
        const visualStyles = this.getVisualStyles();
        
        this.setStyles({
            display: 'block',
            padding: this.getPaddingValue(),
            backgroundColor: this.getBackgroundColor(),
            color: this.getTextColor(),
            border: this.getBorderValue(),
            borderRadius: this.getBorderRadiusValue(),
            boxShadow: this.getShadowValue(),
            overflow: 'hidden',
            position: 'relative',
            transition: `all ${this.animationDuration} ${this.animationEasing}`,
            cursor: this.collapsible ? 'pointer' : 'default',
            outline: 'none',
            boxSizing: 'border-box',
            ...sizeStyles,
            ...variantStyles,
            ...spacingStyles,
            ...visualStyles
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
                backgroundColor: this.getBackgroundColor(),
                border: 'none',
                boxShadow: 'none'
            },
            card: {
                backgroundColor: tokens.get('colors.background.primary'),
                border: '1px solid ' + tokens.get('colors.border.light'),
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
            },
            outlined: {
                backgroundColor: 'transparent',
                border: '2px solid ' + tokens.get('colors.border.medium'),
                boxShadow: 'none'
            },
            bordered: {
                backgroundColor: tokens.get('colors.background.primary'),
                border: '1px solid ' + tokens.get('colors.border.medium'),
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)'
            },
            ghost: {
                backgroundColor: 'transparent',
                border: '1px solid ' + tokens.get('colors.border.light'),
                boxShadow: 'none'
            }
        };
        return variants[this.variant] || variants.default;
    }
    
    getSpacingStyles() {
        return {
            padding: this.getPaddingValue()
        };
    }
    
    getVisualStyles() {
        return {
            borderRadius: this.getBorderRadiusValue(),
            boxShadow: this.getShadowValue()
        };
    }
    
    getPaddingValue() {
        const paddings = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl'),
            xxxl: tokens.get('spacing.xxxl')
        };
        return paddings[this.padding] || paddings.md;
    }
    
    getBorderRadiusValue() {
        const radii = {
            none: '0',
            sm: tokens.get('borderRadius.sm'),
            md: tokens.get('borderRadius.md'),
            lg: tokens.get('borderRadius.lg'),
            xl: tokens.get('borderRadius.xl'),
            full: '9999px'
        };
        return radii[this.borderRadius] || radii.md;
    }
    
    getShadowValue() {
        const shadows = {
            none: 'none',
            sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
            md: '0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)',
            lg: '0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05)',
            xl: '0 20px 25px rgba(0, 0, 0, 0.1), 0 10px 10px rgba(0, 0, 0, 0.04)'
        };
        return shadows[this.shadow] || shadows.none;
    }
    
    getBorderValue() {
        if (this.border === 'none') {
            return 'none';
        }
        
        const borderColors = {
            light: tokens.get('colors.border.light'),
            medium: tokens.get('colors.border.medium'),
            dark: tokens.get('colors.border.dark')
        };
        
        const borderColor = borderColors[this.borderColor] || borderColors.medium;
        const borderWidth = this.borderWidth || '1px';
        
        if (this.border === 'all') {
            return borderWidth + ' solid ' + borderColor;
        } else if (this.border === 'top') {
            return 'border-top: ' + borderWidth + ' solid ' + borderColor;
        } else if (this.border === 'bottom') {
            return 'border-bottom: ' + borderWidth + ' solid ' + borderColor;
        } else if (this.border === 'left') {
            return 'border-left: ' + borderWidth + ' solid ' + borderColor;
        } else if (this.border === 'right') {
            return 'border-right: ' + borderWidth + ' solid ' + borderColor;
        }
        
        return 'none';
    }
    
    getBackgroundColor() {
        const backgrounds = {
            default: tokens.get('colors.background.primary'),
            primary: tokens.get('colors.primary'),
            secondary: tokens.get('colors.secondary'),
            accent: tokens.get('colors.accent'),
            surface: tokens.get('colors.surface'),
            transparent: 'transparent'
        };
        return backgrounds[this.background] || backgrounds.default;
    }
    
    getTextColor() {
        const colors = {
            default: tokens.get('colors.text.primary'),
            primary: tokens.get('colors.text.inverse'),
            secondary: tokens.get('colors.text.inverse'),
            accent: tokens.get('colors.text.inverse'),
            surface: tokens.get('colors.text.primary'),
            transparent: tokens.get('colors.text.primary')
        };
        return colors[this.background] || colors.default;
    }
    
    setupEventHandlers() {
        if (this.collapsible) {
            this.addEventListener('click', (e) => {
                // Only toggle if clicking on header or toggle area
                if (e.target.closest('.plauna-collapse__header') || e.target.closest('.plauna-collapse__toggle')) {
                    e.stopPropagation();
                    this.toggle();
                }
            });
            
            // Keyboard support
            this.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.toggle();
                }
            });
        }
    }
    
    buildCollapse() {
        this.innerHTML = '';
        
        // Create header if needed
        if (this.showHeader) {
            const header = this.createHeader();
            this.appendChild(header);
        }
        
        // Create content container
        const contentContainer = document.createElement('div');
        contentContainer.className = 'plauna-collapse__content-container';
        contentContainer.id = `${this.id}-content`;
        contentContainer.setAttribute('role', 'region');
        contentContainer.setAttribute('aria-labelledby', `${this.id}-header`);
        contentContainer.style.cssText = (
            'overflow: hidden;' +
            'transition: max-height ' + this.animationDuration + ' ' + this.animationEasing + ', opacity ' + this.animationDuration + ' ' + this.animationEasing + ';' +
            'max-height: ' + (this.collapsed ? '0px' : '1000px') + ';' +
            'opacity: ' + (this.collapsed ? '0' : '1') + ';'
        );
        
        // Create content area
        const content = document.createElement('div');
        content.className = 'plauna-collapse__content';
        content.style.cssText = (
            'padding: ' + (this.showHeader ? '0' : this.getPaddingValue()) + ';' +
            'padding-top: ' + (this.showHeader ? '0' : this.getPaddingValue()) + ';'
        );
        
        contentContainer.appendChild(content);
        this.appendChild(contentContainer);
        
        // Create footer if needed
        if (this.showFooter && this.footerContent) {
            const footer = this.createFooter();
            this.appendChild(footer);
        }
        
        // Store references
        this._contentContainer = contentContainer;
        this._content = content;
    }
    
    createHeader() {
        const header = document.createElement('div');
        header.className = 'plauna-collapse__header';
        header.id = `${this.id}-header`;
        header.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: space-between;' +
            'gap: ' + tokens.get('spacing.md') + ';' +
            'padding: ' + this.getPaddingValue() + ';' +
            'cursor: ' + (this.collapsible ? 'pointer' : 'default') + ';' +
            'user-select: none;'
        );
        
        // Create title section
        const titleSection = document.createElement('div');
        titleSection.className = 'plauna-collapse__title-section';
        titleSection.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'flex: 1;'
        );
        
        // Add icon if positioned on left
        if (this.showIcon && this.iconPosition === 'left') {
            const icon = this.createIcon();
            titleSection.appendChild(icon);
        }
        
        // Add title
        if (this.title) {
            const titleElement = document.createElement('h3');
            titleElement.className = 'plauna-collapse__title';
            titleElement.textContent = this.title;
            titleElement.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.lg') + ';' +
                'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
                'color: ' + this.getTextColor() + ';' +
                'margin: 0;' +
                'line-height: 1.2;'
            );
            titleSection.appendChild(titleElement);
        }
        
        // Add subtitle
        if (this.subtitle) {
            const subtitleElement = document.createElement('p');
            subtitleElement.className = 'plauna-collapse__subtitle';
            subtitleElement.textContent = this.subtitle;
            subtitleElement.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.normal') + ';' +
                'color: ' + tokens.get('colors.text.secondary') + ';' +
                'margin: 0;' +
                'line-height: 1.4;'
            );
            titleSection.appendChild(subtitleElement);
        }
        
        // Add description
        if (this.description) {
            const descriptionElement = document.createElement('p');
            descriptionElement.className = 'plauna-collapse__description';
            descriptionElement.textContent = this.description;
            descriptionElement.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.normal') + ';' +
                'color: ' + tokens.get('colors.text.secondary') + ';' +
                'margin: 0;' +
                'line-height: 1.5;'
            );
            titleSection.appendChild(descriptionElement);
        }
        
        header.appendChild(titleSection);
        
        // Add header actions if needed
        if (this.headerActions.length > 0) {
            const actionsSection = document.createElement('div');
            actionsSection.className = 'plauna-collapse__header-actions';
            actionsSection.style.cssText = (
                'display: flex;' +
                'gap: ' + tokens.get('spacing.sm') + ';' +
                'align-items: center;'
            );
            
            this.headerActions.forEach(action => {
                const actionButton = document.createElement('button');
                actionButton.className = 'plauna-collapse__header-action';
                actionButton.textContent = action.text || 'Action';
                actionButton.style.cssText = (
                    'padding: ' + tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm') + ';' +
                    'background: ' + (action.variant === 'primary' ? tokens.get('colors.primary') : 'transparent') + ';' +
                    'color: ' + (action.variant === 'primary' ? tokens.get('colors.text.inverse') : tokens.get('colors.text.secondary')) + ';' +
                    'border: 1px solid ' + (action.variant === 'primary' ? tokens.get('colors.primary') : tokens.get('colors.border.medium')) + ';' +
                    'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                    'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                    'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                    'cursor: pointer;' +
                    'transition: all 150ms ease;'
                );
                
                if (action.onClick) {
                    actionButton.addEventListener('click', (e) => {
                        e.stopPropagation();
                        action.onClick(this, e);
                    });
                }
                
                actionsSection.appendChild(actionButton);
            });
            
            header.appendChild(actionsSection);
        }
        
        // Add icon if positioned on right
        if (this.showIcon && this.iconPosition === 'right') {
            const icon = this.createIcon();
            header.appendChild(icon);
        }
        
        return header;
    }
    
    createIcon() {
        const icon = document.createElement('div');
        icon.className = 'plauna-collapse__icon';
        icon.textContent = this.collapsed ? this.iconCollapsed : this.iconExpanded;
        icon.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'width: 20px;' +
            'height: 20px;' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'transition: transform ' + this.animationDuration + ' ' + this.animationEasing + ';' +
            'transform: rotate(' + (this.collapsed ? '0deg' : '180deg') + ');'
        );
        this._icon = icon;
        return icon;
    }
    
    createFooter() {
        const footer = document.createElement('div');
        footer.className = 'plauna-collapse__footer';
        footer.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: flex-start;' +
            'padding: ' + this.getPaddingValue() + ';' +
            'padding-top: 0;' +
            'border-top: 1px solid ' + tokens.get('colors.border.light') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';'
        );
        
        if (typeof this.footerContent === 'string') {
            footer.textContent = this.footerContent;
        } else {
            footer.appendChild(this.footerContent);
        }
        
        return footer;
    }
    
    // Public methods
    toggle() {
        if (!this.collapsible) return;
        
        this.collapsed = !this.collapsed;
        this.setAttribute('aria-expanded', (!this.collapsed).toString());
        
        // Update content container
        if (this._contentContainer) {
            if (this.collapsed) {
                this._contentContainer.style.maxHeight = '0px';
                this._contentContainer.style.opacity = '0';
            } else {
                // Get the actual height
                const contentHeight = this._content.scrollHeight;
                this._contentContainer.style.maxHeight = contentHeight + 'px';
                this._contentContainer.style.opacity = '1';
                
                // Reset max-height after animation
                setTimeout(() => {
                    if (!this.collapsed) {
                        this._contentContainer.style.maxHeight = 'none';
                    }
                }, parseFloat(this.animationDuration));
            }
        }
        
        // Update icon
        if (this._icon) {
            this._icon.textContent = this.collapsed ? this.iconCollapsed : this.iconExpanded;
            this._icon.style.transform = 'rotate(' + (this.collapsed ? '0deg' : '180deg') + ')';
        }
        
        // Persist state if needed
        if (this.persistState) {
            this.savePersistedState();
        }
        
        // Dispatch event
        this.dispatchEvent({
            type: 'collapseToggle',
            bubbles: true,
            detail: {
                collapse: this,
                collapsed: this.collapsed
            }
        });
        
        this.markDirty(DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    expand() {
        if (this.collapsed) {
            this.toggle();
        }
    }
    
    collapse() {
        if (!this.collapsed) {
            this.toggle();
        }
    }
    
    setCollapsed(collapsed) {
        if (this.collapsed !== collapsed) {
            this.toggle();
        }
    }
    
    setTitle(title) {
        if (this.title !== title) {
            this.title = title;
            this.buildCollapse();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSubtitle(subtitle) {
        if (this.subtitle !== subtitle) {
            this.subtitle = subtitle;
            this.buildCollapse();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setDescription(description) {
        if (this.description !== description) {
            this.description = description;
            this.buildCollapse();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setContent(content) {
        if (this._content) {
            this._content.innerHTML = '';
            if (typeof content === 'string') {
                this._content.textContent = content;
            } else if (content instanceof HTMLElement) {
                this._content.appendChild(content);
            }
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setAnimationDuration(duration) {
        if (this.animationDuration !== duration) {
            this.animationDuration = duration;
            this.setupStyles();
            this.buildCollapse();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    loadPersistedState() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored !== null) {
                this.collapsed = stored === 'true';
                this.setAttribute('aria-expanded', (!this.collapsed).toString());
            }
        } catch (error) {
            // Ignore localStorage errors
        }
    }
    
    savePersistedState() {
        try {
            localStorage.setItem(this.storageKey, this.collapsed.toString());
        } catch (error) {
            // Ignore localStorage errors
        }
    }
    
    // Query selector helper
    querySelector(selector) {
        return this.element?.querySelector(selector);
    }
    
    // Static factory methods
    static createCollapse(id, options = {}) {
        return new Collapse(id, options);
    }
    
    static createCard(id, options = {}) {
        return new Collapse(id, {
            variant: 'card',
            padding: 'lg',
            shadow: 'sm',
            borderRadius: 'md',
            ...options
        });
    }
    
    static createOutlined(id, options = {}) {
        return new Collapse(id, {
            variant: 'outlined',
            padding: 'md',
            borderRadius: 'md',
            ...options
        });
    }
    
    static createBordered(id, options = {}) {
        return new Collapse(id, {
            variant: 'bordered',
            padding: 'md',
            borderRadius: 'sm',
            ...options
        });
    }
    
    static createGhost(id, options = {}) {
        return new Collapse(id, {
            variant: 'ghost',
            padding: 'md',
            borderRadius: 'sm',
            ...options
        });
    }
    
    static createAccordion(id, options = {}) {
        return new Collapse(id, {
            variant: 'card',
            padding: 'md',
            borderRadius: 'sm',
            shadow: 'none',
            border: 'bottom',
            animationDuration: '250ms',
            ...options
        });
    }
    
    static createFAQ(id, options = {}) {
        return new Collapse(id, {
            variant: 'outlined',
            padding: 'lg',
            borderRadius: 'md',
            animationDuration: '300ms',
            showIcon: true,
            iconPosition: 'right',
            ...options
        });
    }
    
    static createSidebar(id, options = {}) {
        return new Collapse(id, {
            variant: 'ghost',
            padding: 'md',
            borderRadius: 'none',
            border: 'none',
            animationDuration: '200ms',
            showIcon: true,
            iconPosition: 'left',
            ...options
        });
    }
    
    static createNested(id, options = {}) {
        return new Collapse(id, {
            variant: 'bordered',
            padding: 'sm',
            borderRadius: 'sm',
            border: 'left',
            borderWidth: '3px',
            animationDuration: '250ms',
            showIcon: true,
            iconPosition: 'right',
            ...options
        });
    }
}
