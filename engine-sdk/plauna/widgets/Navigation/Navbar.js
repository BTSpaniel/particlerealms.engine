// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Navbar - Navigation bar widget for Plauna
 * Provides navbar functionality with multiple variants and layouts
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _navbarSequence = 0;

function _newNavbarId() {
    return `navbar-${Date.now()}-${++_navbarSequence}`;
}

export class Navbar extends UINode {
    // Widget metadata
    static id = 'navbar';
    static name = 'Navbar';
    static category = 'navigation';
    static icon = '📍';
    static description = 'Navigation bar';
    static tags = ['navigation', 'navbar'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            brand: '',
            items: [],
            variant: 'default'
        };
    }
    
    static create(container, options = {}) {
        const instance = new Navbar(_newNavbarId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newNavbarId(), options = {}) {
        super(id, 'navbar');
        
        // Navbar-specific properties
        this.brand = options.brand || '';
        this.brandLogo = options.brandLogo || null;
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error, info
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.position = options.position || 'top'; // top, bottom, fixed-top, fixed-bottom
        this.sticky = options.sticky || false;
        this.transparent = options.transparent || false;
        this.collapsible = options.collapsible || false;
        this.items = options.items || [];
        this.actions = options.actions || [];
        this.showBrand = options.showBrand !== false;
        this.showActions = options.showActions !== false;
        this.centered = options.centered || false;
        
        // State management
        this.isCollapsed = this.collapsible;
        this.isStuck = false;
        
        // Set accessibility
        this.role = 'navigation';
        this.ariaLabel = options.ariaLabel || 'Main navigation';
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build navbar structure
        this.buildNavbar();
        
        // Setup scroll listener for sticky behavior
        if (this.sticky) {
            this.setupScrollListener();
        }
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        const positionStyles = this.getPositionStyles();
        
        this.setStyles({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: tokens.get('spacing.md'),
            padding: this.getPadding(),
            backgroundColor: this.getBackgroundColor(),
            color: this.getTextColor(),
            border: 'none',
            borderBottom: this.position === 'top' ? '1px solid ' + this.getBorderColor() : 'none',
            borderTop: this.position === 'bottom' ? '1px solid ' + this.getBorderColor() : 'none',
            fontSize: 'inherit',
            fontWeight: tokens.get('fontWeights.medium'),
            outline: 'none',
            position: this.getPositionValue(),
            top: this.position === 'top' || this.position === 'fixed-top' ? '0' : 'auto',
            bottom: this.position === 'bottom' || this.position === 'fixed-bottom' ? '0' : 'auto',
            left: '0',
            right: '0',
            width: '100%',
            zIndex: this.position.includes('fixed') ? '1000' : '1',
            transition: 'all 150ms ease',
            ...sizeStyles,
            ...variantStyles,
            ...positionStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                fontSize: tokens.get('fontSizes.xs'),
                padding: tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md')
            },
            sm: {
                fontSize: tokens.get('fontSizes.sm'),
                padding: tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg')
            },
            md: {
                fontSize: tokens.get('fontSizes.md'),
                padding: tokens.get('spacing.lg') + ' ' + tokens.get('spacing.xl')
            },
            lg: {
                fontSize: tokens.get('fontSizes.lg'),
                padding: tokens.get('spacing.xl') + ' ' + tokens.get('spacing.xxl')
            },
            xl: {
                fontSize: tokens.get('fontSizes.xl'),
                padding: tokens.get('spacing.xxl') + ' ' + tokens.get('spacing.xxxl')
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getPadding() {
        const sizes = {
            xs: tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md'),
            sm: tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg'),
            md: tokens.get('spacing.lg') + ' ' + tokens.get('spacing.xl'),
            lg: tokens.get('spacing.xl') + ' ' + tokens.get('spacing.xxl'),
            xl: tokens.get('spacing.xxl') + ' ' + tokens.get('spacing.xxxl')
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        const variants = {
            default: {
                backgroundColor: this.transparent ? 'transparent' : tokens.get('colors.background.primary'),
                color: tokens.get('colors.text.primary'),
                borderColor: tokens.get('colors.border.medium')
            },
            primary: {
                backgroundColor: this.transparent ? 'transparent' : tokens.get('colors.primary'),
                color: 'white',
                borderColor: tokens.get('colors.primary')
            },
            secondary: {
                backgroundColor: this.transparent ? 'transparent' : tokens.get('colors.secondary'),
                color: 'white',
                borderColor: tokens.get('colors.secondary')
            },
            success: {
                backgroundColor: this.transparent ? 'transparent' : tokens.get('colors.success'),
                color: 'white',
                borderColor: tokens.get('colors.success')
            },
            warning: {
                backgroundColor: this.transparent ? 'transparent' : tokens.get('colors.warning'),
                color: 'white',
                borderColor: tokens.get('colors.warning')
            },
            error: {
                backgroundColor: this.transparent ? 'transparent' : tokens.get('colors.error'),
                color: 'white',
                borderColor: tokens.get('colors.error')
            },
            info: {
                backgroundColor: this.transparent ? 'transparent' : tokens.get('colors.info'),
                color: 'white',
                borderColor: tokens.get('colors.info')
            }
        };
        return variants[this.variant] || variants.default;
    }
    
    getPositionStyles() {
        const positions = {
            'top': {
                position: 'relative'
            },
            'bottom': {
                position: 'relative'
            },
            'fixed-top': {
                position: 'fixed',
                top: '0'
            },
            'fixed-bottom': {
                position: 'fixed',
                bottom: '0'
            }
        };
        return positions[this.position] || positions['top'];
    }
    
    getPositionValue() {
        if (this.position.includes('fixed')) {
            return 'fixed';
        }
        return 'relative';
    }
    
    getBackgroundColor() {
        if (this.transparent) {
            return 'transparent';
        }
        
        const variantColors = {
            default: tokens.get('colors.background.primary'),
            primary: tokens.get('colors.primary'),
            secondary: tokens.get('colors.secondary'),
            success: tokens.get('colors.success'),
            warning: tokens.get('colors.warning'),
            error: tokens.get('colors.error'),
            info: tokens.get('colors.info')
        };
        return variantColors[this.variant] || variantColors.default;
    }
    
    getTextColor() {
        const variantColors = {
            default: tokens.get('colors.text.primary'),
            primary: 'white',
            secondary: 'white',
            success: 'white',
            warning: 'white',
            error: 'white',
            info: 'white'
        };
        return variantColors[this.variant] || variantColors.default;
    }
    
    getBorderColor() {
        const variantColors = {
            default: tokens.get('colors.border.medium'),
            primary: tokens.get('colors.primary'),
            secondary: tokens.get('colors.secondary'),
            success: tokens.get('colors.success'),
            warning: tokens.get('colors.warning'),
            error: tokens.get('colors.error'),
            info: tokens.get('colors.info')
        };
        return variantColors[this.variant] || variantColors.default;
    }
    
    setupEventHandlers() {
        this.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isCollapsed) {
                this.toggleCollapse();
            }
        });
    }
    
    setupScrollListener() {
        let lastScrollY = 0;
        
        const handleScroll = () => {
            const currentScrollY = window.scrollY;
            const shouldBeStuck = currentScrollY > 100;
            
            if (shouldBeStuck !== this.isStuck) {
                this.isStuck = shouldBeStuck;
                this.updateStickyState();
            }
            
            lastScrollY = currentScrollY;
        };
        
        window.addEventListener('scroll', handleScroll, { passive: true });
        
        // Store handler for cleanup
        this._scrollHandler = handleScroll;
    }
    
    updateStickyState() {
        if (this.isStuck) {
            this.setStyle('boxShadow', '0 4px 12px rgba(0, 0, 0, 0.1)');
            this.setStyle('backdropFilter', 'blur(4px)');
        } else {
            this.setStyle('boxShadow', 'none');
            this.setStyle('backdropFilter', 'none');
        }
        
        this.markDirty(DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'stickyChange',
            bubbles: true,
            detail: {
                isStuck: this.isStuck
            }
        });
    }
    
    buildNavbar() {
        this.innerHTML = '';
        
        // Create navbar container
        const navbarContainer = document.createElement('div');
        navbarContainer.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: ' + (this.centered ? 'center' : 'space-between') + ';' +
            'gap: ' + tokens.get('spacing.md') + ';' +
            'width: 100%;' +
            'max-width: ' + (this.centered ? '1200px' : '100%') + ';' +
            'margin: 0 auto;'
        );
        
        // Create brand section
        if (this.showBrand && (this.brand || this.brandLogo)) {
            const brandSection = this.createBrandSection();
            navbarContainer.appendChild(brandSection);
        }
        
        // Create navigation items
        if (this.items.length > 0) {
            const navItems = this.createNavItems();
            navbarContainer.appendChild(navItems);
        }
        
        // Create actions section
        if (this.showActions && this.actions.length > 0) {
            const actionsSection = this.createActionsSection();
            navbarContainer.appendChild(actionsSection);
        }
        
        // Create collapse toggle for mobile
        if (this.collapsible) {
            const collapseToggle = this.createCollapseToggle();
            navbarContainer.appendChild(collapseToggle);
        }
        
        this.appendChild(navbarContainer);
    }
    
    createBrandSection() {
        const brandSection = document.createElement('div');
        brandSection.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'font-size: ' + tokens.get('fontSizes.lg') + ';' +
            'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
            'color: inherit;' +
            'text-decoration: none;' +
            'cursor: pointer;' +
            'transition: all 150ms ease;'
        );
        
        // Add brand logo if present
        if (this.brandLogo) {
            const logo = document.createElement('img');
            logo.src = this.brandLogo.src;
            logo.alt = this.brandLogo.alt || this.brand;
            logo.style.cssText = (
                'height: 32px;' +
                'width: auto;' +
                'object-fit: contain;' +
                'flex-shrink: 0;'
            );
            brandSection.appendChild(logo);
        }
        
        // Add brand text
        if (this.brand) {
            const brandText = document.createElement('span');
            brandText.textContent = this.brand;
            brandText.style.cssText = (
                'color: inherit;' +
                'font-weight: inherit;' +
                'font-size: inherit;'
            );
            brandSection.appendChild(brandText);
        }
        
        // Add hover effect
        brandSection.addEventListener('mouseenter', () => {
            brandSection.style.opacity = '0.8';
        });
        
        brandSection.addEventListener('mouseleave', () => {
            brandSection.style.opacity = '1';
        });
        
        brandSection.addEventListener('click', (e) => {
            e.stopPropagation();
            this.dispatchEvent({
                type: 'brandClick',
                bubbles: true,
                detail: {
                    brand: this.brand,
                    logo: this.brandLogo
                }
            });
        });
        
        return brandSection;
    }
    
    createNavItems() {
        const navItems = document.createElement('div');
        navItems.style.cssText = (
            'display: ' + (this.collapsible && this.isCollapsed ? 'none' : 'flex') + ';' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.md') + ';' +
            'flex: 1;' +
            'justify-content: ' + (this.centered ? 'center' : 'flex-start') + ';'
        );
        
        this.items.forEach((item, index) => {
            const navItem = document.createElement('a');
            navItem.href = item.href || '#';
            navItem.textContent = item.label;
            navItem.setAttribute('aria-current', item.active ? 'page' : 'false');
            navItem.style.cssText = (
                'color: ' + (item.active ? this.getTextColor() : tokens.get('colors.text.secondary')) + ';' +
                'text-decoration: none;' +
                'font-weight: ' + (item.active ? tokens.get('fontWeights.semibold') : tokens.get('fontWeights.medium')) + ';' +
                'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'transition: all 150ms ease;' +
                'position: relative;' +
                'cursor: pointer;'
            );
            
            // Add active indicator
            if (item.active) {
                const indicator = document.createElement('div');
                indicator.style.cssText = (
                    'position: absolute;' +
                    'bottom: -2px;' +
                    'left: 0;' +
                    'right: 0;' +
                    'height: 2px;' +
                    'background: ' + this.getTextColor() + ';' +
                    'border-radius: 1px;'
                );
                navItem.appendChild(indicator);
            }
            
            // Add hover effect
            navItem.addEventListener('mouseenter', () => {
                if (!item.active) {
                    navItem.style.color = this.getTextColor();
                    navItem.style.background = 'rgba(255, 255, 255, 0.1)';
                }
            });
            
            navItem.addEventListener('mouseleave', () => {
                if (!item.active) {
                    navItem.style.color = tokens.get('colors.text.secondary');
                    navItem.style.background = 'transparent';
                }
            });
            
            // Add click handler
            navItem.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                this.dispatchEvent({
                    type: 'navItemClick',
                    bubbles: true,
                    detail: {
                        item: item,
                        index: index
                    }
                });
            });
            
            navItems.appendChild(navItem);
        });
        
        return navItems;
    }
    
    createActionsSection() {
        const actionsSection = document.createElement('div');
        actionsSection.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'margin-left: auto;'
        );
        
        this.actions.forEach((action, index) => {
            const actionButton = document.createElement('button');
            actionButton.type = 'button';
            actionButton.textContent = action.label;
            actionButton.setAttribute('aria-label', action.ariaLabel || action.label);
            actionButton.style.cssText = (
                'background: ' + (action.variant === 'solid' ? this.getTextColor() : 'transparent') + ';' +
                'color: ' + (action.variant === 'solid' ? this.getBackgroundColor() : this.getTextColor()) + ';' +
                'border: 1px solid ' + (action.variant === 'solid' ? this.getTextColor() : this.getTextColor()) + ';' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'cursor: pointer;' +
                'transition: all 150ms ease;' +
                'display: flex;' +
                'align-items: center;' +
                'gap: ' + tokens.get('spacing.xs') + ';'
            );
            
            // Add icon if present
            if (action.icon) {
                const icon = document.createElement('span');
                icon.textContent = action.icon;
                icon.style.cssText = (
                    'font-size: 16px;' +
                    'color: inherit;'
                );
                actionButton.insertBefore(icon, actionButton.firstChild);
            }
            
            // Add hover effect
            actionButton.addEventListener('mouseenter', () => {
                if (action.variant === 'solid') {
                    actionButton.style.background = 'rgba(255, 255, 255, 0.1)';
                    actionButton.style.color = this.getTextColor();
                } else {
                    actionButton.style.background = this.getTextColor();
                    actionButton.style.color = this.getBackgroundColor();
                }
            });
            
            actionButton.addEventListener('mouseleave', () => {
                actionButton.style.background = action.variant === 'solid' ? this.getTextColor() : 'transparent';
                actionButton.style.color = action.variant === 'solid' ? this.getBackgroundColor() : this.getTextColor();
            });
            
            // Add click handler
            actionButton.addEventListener('click', (e) => {
                e.stopPropagation();
                if (action.onClick && typeof action.onClick === 'function') {
                    action.onClick({
                        action: action,
                        index: index
                    });
                }
                
                this.dispatchEvent({
                    type: 'actionClick',
                    bubbles: true,
                    detail: {
                        action: action,
                        index: index
                    }
                });
            });
            
            actionsSection.appendChild(actionButton);
        });
        
        return actionsSection;
    }
    
    createCollapseToggle() {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.setAttribute('aria-label', 'Toggle navigation');
        toggle.setAttribute('aria-expanded', (!this.isCollapsed).toString());
        toggle.style.cssText = (
            'display: none;' +
            'background: transparent;' +
            'border: none;' +
            'color: ' + this.getTextColor() + ';' +
            'font-size: 24px;' +
            'cursor: pointer;' +
            'padding: ' + tokens.get('spacing.sm') + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'transition: all 150ms ease;'
        );
        
        toggle.innerHTML = this.isCollapsed ? '☰' : '✕';
        
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleCollapse();
        });
        
        // Show toggle on mobile (simulate with media query)
        const showToggle = () => {
            const shouldShow = window.innerWidth < 768;
            toggle.style.display = shouldShow ? 'block' : 'none';
        };
        
        window.addEventListener('resize', showToggle);
        showToggle();
        
        // Store handler for cleanup
        this._resizeHandler = showToggle;
        
        return toggle;
    }
    
    // Public methods
    setBrand(brand) {
        if (this.brand !== brand) {
            this.brand = brand;
            this.buildNavbar();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setBrandLogo(logo) {
        if (this.brandLogo !== logo) {
            this.brandLogo = logo;
            this.buildNavbar();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.buildNavbar();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildNavbar();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setPosition(position) {
        if (this.position !== position) {
            this.position = position;
            this.setupStyles();
            this.buildNavbar();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSticky(sticky) {
        if (this.sticky !== sticky) {
            this.sticky = sticky;
            if (sticky) {
                this.setupScrollListener();
            } else if (this._scrollHandler) {
                window.removeEventListener('scroll', this._scrollHandler);
                this._scrollHandler = null;
            }
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }
    
    setTransparent(transparent) {
        if (this.transparent !== transparent) {
            this.transparent = transparent;
            this.setupStyles();
            this.buildNavbar();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setCollapsible(collapsible) {
        if (this.collapsible !== collapsible) {
            this.collapsible = collapsible;
            this.isCollapsed = collapsible;
            this.buildNavbar();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setItems(items) {
        this.items = items || [];
        this.buildNavbar();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setActions(actions) {
        this.actions = actions || [];
        this.buildNavbar();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setShowBrand(showBrand) {
        if (this.showBrand !== showBrand) {
            this.showBrand = showBrand;
            this.buildNavbar();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowActions(showActions) {
        if (this.showActions !== showActions) {
            this.showActions = showActions;
            this.buildNavbar();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setCentered(centered) {
        if (this.centered !== centered) {
            this.centered = centered;
            this.buildNavbar();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    toggleCollapse() {
        this.isCollapsed = !this.isCollapsed;
        this.buildNavbar();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'collapseToggle',
            bubbles: true,
            detail: {
                isCollapsed: this.isCollapsed
            }
        });
    }
    
    collapse() {
        if (!this.isCollapsed) {
            this.toggleCollapse();
        }
    }
    
    expand() {
        if (this.isCollapsed) {
            this.toggleCollapse();
        }
    }
    
    // Query selector helper
    querySelector(selector) {
        return this.element?.querySelector(selector);
    }
    
    // Static factory methods
    static createNavbar(id, options = {}) {
        return new Navbar(id, options);
    }
    
    static createPrimaryNavbar(id, options = {}) {
        return new Navbar(id, { variant: 'primary', ...options });
    }
    
    static createSecondaryNavbar(id, options = {}) {
        return new Navbar(id, { variant: 'secondary', ...options });
    }
    
    static createSuccessNavbar(id, options = {}) {
        return new Navbar(id, { variant: 'success', ...options });
    }
    
    static createWarningNavbar(id, options = {}) {
        return new Navbar(id, { variant: 'warning', ...options });
    }
    
    static createErrorNavbar(id, options = {}) {
        return new Navbar(id, { variant: 'error', ...options });
    }
    
    static createInfoNavbar(id, options = {}) {
        return new Navbar(id, { variant: 'info', ...options });
    }
    
    static createTopNavbar(id, options = {}) {
        return new Navbar(id, { position: 'top', ...options });
    }
    
    static createBottomNavbar(id, options = {}) {
        return new Navbar(id, { position: 'bottom', ...options });
    }
    
    static createFixedTopNavbar(id, options = {}) {
        return new Navbar(id, { position: 'fixed-top', ...options });
    }
    
    static createFixedBottomNavbar(id, options = {}) {
        return new Navbar(id, { position: 'fixed-bottom', ...options });
    }
    
    static createStickyNavbar(id, options = {}) {
        return new Navbar(id, { sticky: true, ...options });
    }
    
    static createTransparentNavbar(id, options = {}) {
        return new Navbar(id, { transparent: true, ...options });
    }
    
    static createCollapsibleNavbar(id, options = {}) {
        return new Navbar(id, { collapsible: true, ...options });
    }
    
    static createCenteredNavbar(id, options = {}) {
        return new Navbar(id, { centered: true, ...options });
    }
    
    static createApplicationNavbar(id, options = {}) {
        return new Navbar(id, {
            variant: 'primary',
            position: 'fixed-top',
            sticky: true,
            showBrand: true,
            showActions: true,
            ...options
        });
    }
    
    static createMinimalNavbar(id, options = {}) {
        return new Navbar(id, {
            variant: 'default',
            position: 'top',
            transparent: true,
            showBrand: true,
            showActions: false,
            ...options
        });
    }
    
    static createMobileNavbar(id, options = {}) {
        return new Navbar(id, {
            variant: 'primary',
            position: 'fixed-bottom',
            collapsible: true,
            showBrand: false,
            showActions: true,
            ...options
        });
    }
    
    static createSidebarNavbar(id, options = {}) {
        return new Navbar(id, {
            variant: 'secondary',
            position: 'fixed-top',
            centered: false,
            showBrand: true,
            showActions: true,
            ...options
        });
    }
}
