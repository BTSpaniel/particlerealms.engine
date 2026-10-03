// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * HeaderFooter - Header and Footer widget for Plauna
 * Provides semantic header and footer containers with comprehensive styling options
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { clamp as clampScalar } from '../../../engine/core/math/MathScalar.js';

let _headerFooterSequence = 0;

function _newHeaderFooterId() {
    return `header-footer-${Date.now()}-${++_headerFooterSequence}`;
}

export class HeaderFooter extends UINode {
    // Widget metadata
    static id = 'header-footer';
    static name = 'HeaderFooter';
    static category = 'layout';
    static icon = '📋';
    static description = 'Header and footer layout';
    static tags = ['layout', 'header', 'footer'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            headerHeight: 'auto',
            footerHeight: 'auto',
            variant: 'default'
        };
    }
    
    static create(container, options = {}) {
        const instance = new HeaderFooter(_newHeaderFooterId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newHeaderFooterId(), options = {}) {
        super(id, 'header-footer');
        
        // HeaderFooter-specific properties
        this.type = options.type || 'header'; // header, footer
        this.variant = options.variant || 'default'; // default, primary, secondary, accent, muted, outlined, elevated, sticky, fixed
        this.size = options.size || 'md'; // xs, sm, md, lg, xl, fluid
        this.padding = options.padding || 'md'; // none, xs, sm, md, lg, xl, xxxl
        this.margin = options.margin || 'none'; // none, xs, sm, md, lg, xl
        this.borderRadius = options.borderRadius || 'none'; // none, sm, md, lg, xl, full
        this.shadow = options.shadow || 'none'; // none, sm, md, lg, xl
        this.background = options.background || 'default'; // default, primary, secondary, accent, surface, transparent, gradient
        this.maxWidth = options.maxWidth || 'none'; // none, sm, md, lg, xl, 2xl, 3xl, 4xl, 5xl, 6xl, 7xl, full
        this.alignment = options.alignment || 'left'; // left, center, right, justify, space-between, space-around, space-evenly
        this.verticalAlignment = options.verticalAlignment || 'center'; // top, center, bottom, stretch
        this.overflow = options.overflow || 'visible'; // visible, hidden, scroll, auto
        this.display = options.display || 'flex'; // block, flex, grid
        this.flexDirection = options.flexDirection || 'row'; // row, column, row-reverse, column-reverse
        this.justifyContent = options.justifyContent || 'flex-start'; // flex-start, flex-end, center, space-between, space-around, space-evenly
        this.alignItems = options.alignItems || 'center'; // flex-start, flex-end, center, baseline, stretch
        this.gap = options.gap || 'md'; // none, xs, sm, md, lg, xl
        this.position = options.position || 'static'; // static, relative, absolute, fixed, sticky
        this.zIndex = options.zIndex || 'auto'; // auto, 1-50
        this.opacity = options.opacity || '100'; // 0-100
        this.transition = options.transition || 'none'; // none, all, colors, transform, opacity
        this.hoverable = options.hoverable || false;
        this.clickable = options.clickable || false;
        this.separators = options.separators || 'none'; // none, top, bottom, both
        this.border = options.border || 'none'; // none, all, top, bottom, left, right
        this.borderColor = options.borderColor || 'medium'; // light, medium, dark
        this.borderWidth = options.borderWidth || '1px'; // 1px, 2px, 3px, 4px
        
        // Content structure
        this.brand = options.brand || null; // brand text or object
        this.brandLink = options.brandLink || null; // brand link URL
        this.navigation = options.navigation || []; // navigation items
        this.actions = options.actions || []; // action buttons
        this.copyright = options.copyright || null; // copyright text
        this.description = options.description || null; // description text
        this.showBrand = options.showBrand !== false;
        this.showNavigation = options.showNavigation !== false;
        this.showActions = options.showActions !== false;
        this.showCopyright = options.showCopyright !== false;
        this.showDescription = options.showDescription || false;
        
        // Layout options
        this.responsive = options.responsive || false; // responsive behavior
        this.stickyOffset = options.stickyOffset || 0; // offset for sticky positioning
        this.fixedOffset = options.fixedOffset || 0; // offset for fixed positioning
        
        // Semantic attributes
        this.ariaLabel = options.ariaLabel || null;
        this.ariaLabelledby = options.ariaLabelledby || null;
        this.ariaDescribedby = options.ariaDescribedby || null;
        
        // Set semantic role
        this.role = this.type === 'header' ? 'banner' : 'contentinfo';
        this.setAttribute('aria-label', this.ariaLabel || `${this.type} content`);
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build header/footer structure
        this.buildHeaderFooter();
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        const layoutStyles = this.getLayoutStyles();
        const spacingStyles = this.getSpacingStyles();
        const visualStyles = this.getVisualStyles();
        
        this.setStyles({
            display: this.getDisplay(),
            flexDirection: this.getFlexDirection(),
            justifyContent: this.getJustifyContent(),
            alignItems: this.getAlignItems(),
            gap: this.getGap(),
            padding: this.getPaddingValue(),
            margin: this.getMarginValue(),
            backgroundColor: this.getBackgroundColor(),
            color: this.getTextColor(),
            border: this.getBorder(),
            borderTop: this.getBorderTop(),
            borderBottom: this.getBorderBottom(),
            borderRadius: this.getBorderRadiusValue(),
            boxShadow: this.getShadowValue(),
            maxWidth: this.getMaxWidthValue(),
            overflow: this.overflow,
            position: this.getPositionValue(),
            zIndex: this.getZIndexValue(),
            opacity: this.getOpacityValue(),
            transition: this.getTransitionValue(),
            cursor: this.getCursorValue(),
            outline: 'none',
            boxSizing: 'border-box',
            ...sizeStyles,
            ...variantStyles,
            ...layoutStyles,
            ...spacingStyles,
            ...visualStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                minHeight: '40px'
            },
            sm: {
                minHeight: '48px'
            },
            md: {
                minHeight: '56px'
            },
            lg: {
                minHeight: '64px'
            },
            xl: {
                minHeight: '72px'
            },
            fluid: {
                minHeight: 'auto'
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
            primary: {
                backgroundColor: tokens.get('colors.primary'),
                color: tokens.get('colors.text.inverse'),
                border: 'none',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
            },
            secondary: {
                backgroundColor: tokens.get('colors.secondary'),
                color: tokens.get('colors.text.inverse'),
                border: 'none',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)'
            },
            accent: {
                backgroundColor: tokens.get('colors.accent'),
                color: tokens.get('colors.text.inverse'),
                border: 'none',
                boxShadow: '0 2px 4px rgba(139, 92, 246, 0.2)'
            },
            muted: {
                backgroundColor: tokens.get('colors.background.secondary'),
                color: tokens.get('colors.text.primary'),
                border: 'none',
                boxShadow: 'none'
            },
            outlined: {
                backgroundColor: 'transparent',
                color: tokens.get('colors.text.primary'),
                border: '1px solid ' + tokens.get('colors.border.medium'),
                boxShadow: 'none'
            },
            elevated: {
                backgroundColor: tokens.get('colors.background.primary'),
                color: tokens.get('colors.text.primary'),
                border: '1px solid ' + tokens.get('colors.border.light'),
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)'
            },
            sticky: {
                backgroundColor: tokens.get('colors.background.primary'),
                color: tokens.get('colors.text.primary'),
                border: '1px solid ' + tokens.get('colors.border.light'),
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                backdropFilter: 'blur(8px)'
            },
            fixed: {
                backgroundColor: tokens.get('colors.background.primary'),
                color: tokens.get('colors.text.primary'),
                border: '1px solid ' + tokens.get('colors.border.medium'),
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
            }
        };
        return variants[this.variant] || variants.default;
    }
    
    getLayoutStyles() {
        const layouts = {
            block: {
                display: 'block'
            },
            flex: {
                display: 'flex',
                flexDirection: this.flexDirection,
                justifyContent: this.justifyContent,
                alignItems: this.alignItems
            },
            grid: {
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: this.getGap()
            }
        };
        return layouts[this.display] || layouts.flex;
    }
    
    getSpacingStyles() {
        return {
            padding: this.getPaddingValue(),
            margin: this.getMarginValue(),
            gap: this.getGap()
        };
    }
    
    getVisualStyles() {
        const styles = {
            borderRadius: this.getBorderRadiusValue(),
            boxShadow: this.getShadowValue(),
            maxWidth: this.getMaxWidthValue(),
            opacity: this.getOpacityValue(),
            transition: this.getTransitionValue()
        };
        
        if (this.separators !== 'none') {
            if (this.separators === 'top' || this.separators === 'both') {
                styles.borderTop = '1px solid ' + tokens.get('colors.border.light');
            }
            if (this.separators === 'bottom' || this.separators === 'both') {
                styles.borderBottom = '1px solid ' + tokens.get('colors.border.light');
            }
        }
        
        return styles;
    }
    
    getDisplay() {
        return this.display;
    }
    
    getFlexDirection() {
        return this.display === 'flex' ? this.flexDirection : 'initial';
    }
    
    getJustifyContent() {
        return this.display === 'flex' ? this.justifyContent : 'initial';
    }
    
    getAlignItems() {
        return this.display === 'flex' ? this.alignItems : 'initial';
    }
    
    getGap() {
        const gaps = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl')
        };
        return gaps[this.gap] || gaps.md;
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
    
    getMarginValue() {
        const margins = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl')
        };
        return margins[this.margin] || margins.none;
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
        return radii[this.borderRadius] || radii.none;
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
    
    getMaxWidthValue() {
        const maxWidths = {
            none: 'none',
            sm: '640px',
            md: '768px',
            lg: '1024px',
            xl: '1280px',
            '2xl': '1536px',
            '3xl': '1920px',
            '4xl': '2560px',
            '5xl': '3200px',
            '6xl': '3840px',
            '7xl': '4480px',
            full: '100%'
        };
        return maxWidths[this.maxWidth] || maxWidths.none;
    }
    
    getZIndexValue() {
        const zIndices = {
            auto: 'auto',
            '1': '1',
            '10': '10',
            '20': '20',
            '30': '30',
            '40': '40',
            '50': '50'
        };
        return zIndices[this.zIndex] || zIndices.auto;
    }
    
    getOpacityValue() {
        const opacity = parseInt(this.opacity) / 100;
        return Math.max(0, clampScalar(opacity, 0, 1));
    }
    
    getTransitionValue() {
        const transitions = {
            none: 'none',
            all: 'all 150ms ease',
            colors: 'color 150ms ease, background-color 150ms ease, border-color 150ms ease',
            transform: 'transform 150ms ease',
            opacity: 'opacity 150ms ease'
        };
        return transitions[this.transition] || transitions.none;
    }
    
    getBackgroundColor() {
        const backgrounds = {
            default: tokens.get('colors.background.primary'),
            primary: tokens.get('colors.primary'),
            secondary: tokens.get('colors.secondary'),
            accent: tokens.get('colors.accent'),
            surface: tokens.get('colors.surface'),
            transparent: 'transparent',
            gradient: 'linear-gradient(135deg, ' + tokens.get('colors.primary') + ' 0%, ' + tokens.get('colors.accent') + ' 100%)'
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
            transparent: tokens.get('colors.text.primary'),
            gradient: tokens.get('colors.text.inverse')
        };
        return colors[this.background] || colors.default;
    }
    
    getBorder() {
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
    
    getBorderTop() {
        if (this.separators === 'top' || this.separators === 'both') {
            return '1px solid ' + tokens.get('colors.border.light');
        }
        return 'none';
    }
    
    getBorderBottom() {
        if (this.separators === 'bottom' || this.separators === 'both') {
            return '1px solid ' + tokens.get('colors.border.light');
        }
        return 'none';
    }
    
    getPositionValue() {
        let position = this.position;
        
        if (this.position === 'sticky') {
            position = 'sticky';
        } else if (this.position === 'fixed') {
            position = 'fixed';
        }
        
        if ((this.position === 'sticky' || this.position === 'fixed') && this.type === 'header') {
            return position + ' top';
        } else if ((this.position === 'sticky' || this.position === 'fixed') && this.type === 'footer') {
            return position + ' bottom';
        }
        
        return position;
    }
    
    getCursorValue() {
        if (this.clickable) {
            return 'pointer';
        }
        return 'default';
    }
    
    setupEventHandlers() {
        if (this.clickable) {
            this.addEventListener('click', (e) => {
                this.dispatchEvent({
                    type: 'headerFooterClick',
                    bubbles: true,
                    detail: { headerFooter: this }
                });
            });
            
            this.addEventListener('mouseenter', () => {
                if (this.hoverable) {
                    this.style.transform = 'translateY(-2px)';
                    this.style.boxShadow = this.getEnhancedShadow();
                }
            });
            
            this.addEventListener('mouseleave', () => {
                if (this.hoverable) {
                    this.style.transform = 'translateY(0)';
                    this.style.boxShadow = this.getShadowValue();
                }
            });
        }
    }
    
    getEnhancedShadow() {
        const baseShadow = this.getShadowValue();
        if (baseShadow === 'none') {
            return '0 4px 6px rgba(0, 0, 0, 0.1)';
        }
        return baseShadow.replace('0.1', '0.15').replace('0.05', '0.08');
    }
    
    buildHeaderFooter() {
        this.innerHTML = '';
        
        // Create main content container
        const main = document.createElement('div');
        main.className = 'plauna-header-footer__main';
        main.style.cssText = (
            'display: ' + (this.display === 'flex' ? 'flex' : 'block') + ';' +
            'flex-direction: ' + (this.display === 'flex' ? this.flexDirection : 'initial') + ';' +
            'justify-content: ' + (this.display === 'flex' ? this.justifyContent : 'initial') + ';' +
            'align-items: ' + (this.display === 'flex' ? this.alignItems : 'initial') + ';' +
            'gap: ' + this.getGap() + ';' +
            'width: 100%;'
        );
        
        // Add brand if needed
        if (this.showBrand && this.brand) {
            const brandSection = this.createBrand();
            main.appendChild(brandSection);
        }
        
        // Add navigation if needed
        if (this.showNavigation && this.navigation.length > 0) {
            const navSection = this.createNavigation();
            main.appendChild(navSection);
        }
        
        // Add description if needed
        if (this.showDescription && this.description) {
            const descSection = this.createDescription();
            main.appendChild(descSection);
        }
        
        // Add actions if needed
        if (this.showActions && this.actions.length > 0) {
            const actionsSection = this.createActions();
            main.appendChild(actionsSection);
        }
        
        this.appendChild(main);
        
        // Add copyright if needed (footer only)
        if (this.type === 'footer' && this.showCopyright && this.copyright) {
            const copyrightSection = this.createCopyright();
            this.appendChild(copyrightSection);
        }
    }
    
    createBrand() {
        const brandSection = document.createElement('div');
        brandSection.className = 'plauna-header-footer__brand';
        brandSection.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.sm') + ';'
        );
        
        const brandElement = document.createElement(this.brandLink ? 'a' : 'div');
        brandElement.className = 'plauna-header-footer__brand-element';
        brandElement.textContent = typeof this.brand === 'string' ? this.brand : this.brand.text || '';
        brandElement.style.cssText = (
            'font-size: ' + tokens.get('fontSizes.lg') + ';' +
            'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
            'color: ' + this.getTextColor() + ';' +
            'text-decoration: none;' +
            'line-height: 1.2;'
        );
        
        if (this.brandLink && this.brandLink.href) {
            brandElement.href = this.brandLink.href;
            brandElement.target = this.brandLink.target || '_self';
        }
        
        if (this.brand.onClick) {
            brandElement.addEventListener('click', (e) => {
                if (this.brandLink) {
                    e.preventDefault();
                }
                this.brand.onClick(this, e);
            });
        }
        
        brandSection.appendChild(brandElement);
        return brandSection;
    }
    
    createNavigation() {
        const navSection = document.createElement('nav');
        navSection.className = 'plauna-header-footer__navigation';
        navSection.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.lg') + ';'
        );
        
        this.navigation.forEach((item, index) => {
            const navItem = document.createElement('a');
            navItem.className = 'plauna-header-footer__nav-item';
            navItem.textContent = item.text || '';
            navItem.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'color: ' + this.getTextColor() + ';' +
                'text-decoration: none;' +
                'padding: ' + tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm') + ';' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'transition: all 150ms ease;' +
                'cursor: pointer;'
            );
            
            if (item.href) {
                navItem.href = item.href;
                navItem.target = item.target || '_self';
            }
            
            if (item.active) {
                navItem.style.background = 'rgba(255, 255, 255, 0.1)';
                navItem.style.color = this.getTextColor();
            }
            
            if (item.onClick) {
                navItem.addEventListener('click', (e) => {
                    if (item.href) {
                        e.preventDefault();
                    }
                    item.onClick(this, e);
                });
            }
            
            navItem.addEventListener('mouseenter', () => {
                if (!item.active) {
                    navItem.style.background = 'rgba(255, 255, 255, 0.1)';
                }
            });
            
            navItem.addEventListener('mouseleave', () => {
                if (!item.active) {
                    navItem.style.background = 'transparent';
                }
            });
            
            navSection.appendChild(navItem);
        });
        
        return navSection;
    }
    
    createDescription() {
        const descSection = document.createElement('div');
        descSection.className = 'plauna-header-footer__description';
        descSection.style.cssText = (
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'line-height: 1.4;'
        );
        descSection.textContent = this.description;
        return descSection;
    }
    
    createActions() {
        const actionsSection = document.createElement('div');
        actionsSection.className = 'plauna-header-footer__actions';
        actionsSection.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.sm') + ';'
        );
        
        this.actions.forEach((action, index) => {
            const actionButton = document.createElement('button');
            actionButton.className = 'plauna-header-footer__action';
            actionButton.textContent = action.text || 'Action';
            actionButton.style.cssText = (
                'padding: ' + tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm') + ';' +
                'background: ' + (action.variant === 'primary' ? tokens.get('colors.primary') : 'transparent') + ';' +
                'color: ' + (action.variant === 'primary' ? tokens.get('colors.text.inverse') : this.getTextColor()) + ';' +
                'border: 1px solid ' + (action.variant === 'primary' ? tokens.get('colors.primary') : tokens.get('colors.border.medium')) + ';' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'cursor: pointer;' +
                'transition: all 150ms ease;'
            );
            
            if (action.onClick) {
                actionButton.addEventListener('click', (e) => {
                    action.onClick(this, e);
                });
            }
            
            actionButton.addEventListener('mouseenter', () => {
                if (action.variant === 'primary') {
                    actionButton.style.background = 'rgba(255, 255, 255, 0.1)';
                    actionButton.style.color = tokens.get('colors.primary');
                } else {
                    actionButton.style.background = 'rgba(255, 255, 255, 0.1)';
                    actionButton.style.color = this.getTextColor();
                }
            });
            
            actionButton.addEventListener('mouseleave', () => {
                if (action.variant === 'primary') {
                    actionButton.style.background = tokens.get('colors.primary');
                    actionButton.style.color = tokens.get('colors.text.inverse');
                } else {
                    actionButton.style.background = 'transparent';
                    actionButton.style.color = this.getTextColor();
                }
            });
            
            actionsSection.appendChild(actionButton);
        });
        
        return actionsSection;
    }
    
    createCopyright() {
        const copyrightSection = document.createElement('div');
        copyrightSection.className = 'plauna-header-footer__copyright';
        copyrightSection.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'font-size: ' + tokens.get('fontSizes.xs') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'line-height: 1.4;' +
            'margin-top: ' + tokens.get('spacing.md') + ';' +
            'padding-top: ' + tokens.get('spacing.md') + ';' +
            'border-top: 1px solid ' + tokens.get('colors.border.light') + ';'
        );
        copyrightSection.textContent = this.copyright;
        return copyrightSection;
    }
    
    // Public methods
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.buildHeaderFooter();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setPadding(padding) {
        if (this.padding !== padding) {
            this.padding = padding;
            this.setupStyles();
            this.buildHeaderFooter();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setBackground(background) {
        if (this.background !== background) {
            this.background = background;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setBrand(brand) {
        if (this.brand !== brand) {
            this.brand = brand;
            this.buildHeaderFooter();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setNavigation(navigation) {
        if (this.navigation !== navigation) {
            this.navigation = navigation;
            this.buildHeaderFooter();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setActions(actions) {
        if (this.actions !== actions) {
            this.actions = actions;
            this.buildHeaderFooter();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setCopyright(copyright) {
        if (this.copyright !== copyright) {
            this.copyright = copyright;
            if (this.type === 'footer') {
                this.buildHeaderFooter();
                this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
            }
        }
    }
    
    setDescription(description) {
        if (this.description !== description) {
            this.description = description;
            this.buildHeaderFooter();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setAlignment(alignment) {
        if (this.alignment !== alignment) {
            this.alignment = alignment;
            this.setupStyles();
            this.buildHeaderFooter();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSeparators(separators) {
        if (this.separators !== separators) {
            this.separators = separators;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    // Query selector helper
    querySelector(selector) {
        return this.element?.querySelector(selector);
    }
    
    // Static factory methods
    static createHeader(id, options = {}) {
        return new HeaderFooter(id, { type: 'header', ...options });
    }
    
    static createFooter(id, options = {}) {
        return new HeaderFooter(id, { type: 'footer', ...options });
    }
    
    static createPrimaryHeader(id, options = {}) {
        return new HeaderFooter(id, {
            type: 'header',
            variant: 'primary',
            padding: 'lg',
            size: 'md',
            ...options
        });
    }
    
    static createPrimaryFooter(id, options = {}) {
        return new HeaderFooter(id, {
            type: 'footer',
            variant: 'primary',
            padding: 'lg',
            size: 'md',
            ...options
        });
    }
    
    static createSecondaryHeader(id, options = {}) {
        return new HeaderFooter(id, {
            type: 'header',
            variant: 'secondary',
            padding: 'md',
            size: 'sm',
            ...options
        });
    }
    
    static createSecondaryFooter(id, options = {}) {
        return new HeaderFooter(id, {
            type: 'footer',
            variant: 'secondary',
            padding: 'md',
            size: 'sm',
            ...options
        });
    }
    
    static createStickyHeader(id, options = {}) {
        return new HeaderFooter(id, {
            type: 'header',
            variant: 'sticky',
            padding: 'md',
            size: 'md',
            position: 'sticky',
            stickyOffset: 0,
            ...options
        });
    }
    
    static createFixedHeader(id, options = {}) {
        return new HeaderFooter(id, {
            type: 'header',
            variant: 'fixed',
            padding: 'md',
            size: 'md',
            position: 'fixed',
            fixedOffset: 0,
            ...options
        });
    }
    
    static createStickyFooter(id, options = {}) {
        return new HeaderFooter(id, {
            type: 'footer',
            variant: 'sticky',
            padding: 'md',
            size: 'md',
            position: 'sticky',
            stickyOffset: 0,
            ...options
        });
    }
    
    static createFixedFooter(id, options = {}) {
        return new HeaderFooter(id, {
            type: 'footer',
            variant: 'fixed',
            padding: 'md',
            size: 'md',
            position: 'fixed',
            fixedOffset: 0,
            ...options
        });
    }
    
    static createOutlinedHeader(id, options = {}) {
        return new HeaderFooter(id, {
            type: 'header',
            variant: 'outlined',
            padding: 'md',
            size: 'md',
            ...options
        });
    }
    
    static createOutlinedFooter(id, options = {}) {
        return new HeaderFooter(id, {
            type: 'footer',
            variant: 'outlined',
            padding: 'md',
            size: 'md',
            ...options
        });
    }
    
    static createElevatedHeader(id, options = {}) {
        return new HeaderFooter(id, {
            type: 'header',
            variant: 'elevated',
            padding: 'lg',
            size: 'md',
            ...options
        });
    }
    
    static createElevatedFooter(id, options = {}) {
        return new HeaderFooter(id, {
            type: 'footer',
            variant: 'elevated',
            padding: 'lg',
            size: 'md',
            ...options
        });
    }
}
