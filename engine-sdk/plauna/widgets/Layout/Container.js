// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Container - Layout container widget for Plauna
 * Provides flexible container with multiple variants and layouts
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { clamp as clampScalar } from '../../../engine/core/math/MathScalar.js';

let _containerSequence = 0;

function _newContainerId() {
    return `container-${Date.now()}-${++_containerSequence}`;
}

export class Container extends UINode {
    // Widget metadata
    static id = 'container';
    static name = 'Container';
    static category = 'layout';
    static icon = '📦';
    static description = 'Layout container';
    static tags = ['layout', 'container'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            direction: 'column',
            gap: 'md',
            align: 'stretch'
        };
    }
    
    static create(container, options = {}) {
        const instance = new Container(_newContainerId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newContainerId(), options = {}) {
        super(id, 'container');
        
        // Container-specific properties
        this.variant = options.variant || 'default'; // default, card, elevated, outlined, filled, glass
        this.size = options.size || 'md'; // xs, sm, md, lg, xl, fluid
        this.padding = options.padding || 'md'; // none, xs, sm, md, lg, xl, xxxl
        this.margin = options.margin || 'none'; // none, xs, sm, md, lg, xl
        this.borderRadius = options.borderRadius || 'md'; // none, sm, md, lg, xl, full
        this.shadow = options.shadow || 'none'; // none, sm, md, lg, xl
        this.background = options.background || 'default'; // default, primary, secondary, accent, surface, transparent
        this.maxWidth = options.maxWidth || 'none'; // none, sm, md, lg, xl, 2xl, 3xl, 4xl, 5xl, 6xl, 7xl, full
        this.alignment = options.alignment || 'left'; // left, center, right, justify
        this.verticalAlignment = options.verticalAlignment || 'top'; // top, center, bottom, stretch
        this.overflow = options.overflow || 'visible'; // visible, hidden, scroll, auto
        this.display = options.display || 'block'; // block, flex, grid, inline, inline-block, inline-flex
        this.flexDirection = options.flexDirection || 'row'; // row, column, row-reverse, column-reverse
        this.justifyContent = options.justifyContent || 'flex-start'; // flex-start, flex-end, center, space-between, space-around, space-evenly
        this.alignItems = options.alignItems || 'stretch'; // flex-start, flex-end, center, baseline, stretch
        this.gap = options.gap || 'none'; // none, xs, sm, md, lg, xl
        this.aspectRatio = options.aspectRatio || null; // null, 1/1, 4/3, 16/9, 21/9, etc.
        this.position = options.position || 'static'; // static, relative, absolute, fixed, sticky
        this.zIndex = options.zIndex || 'auto'; // auto, 1-50
        this.opacity = options.opacity || '100'; // 0-100
        this.transition = options.transition || 'none'; // none, all, colors, transform, opacity
        this.hoverable = options.hoverable || false;
        this.clickable = options.clickable || false;
        this.resizable = options.resizable || false;
        this.scrollable = options.scrollable || false;
        
        // Set accessibility
        this.role = options.role || 'region';
        this.ariaLabel = options.ariaLabel || null;
        this.ariaLabelledby = options.ariaLabelledby || null;
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build container structure
        this.buildContainer();
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
            borderRadius: this.getBorderRadiusValue(),
            boxShadow: this.getShadowValue(),
            maxWidth: this.getMaxWidthValue(),
            overflow: this.overflow,
            position: this.position,
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
                minHeight: '100px',
                minWidth: '100px'
            },
            sm: {
                minHeight: '200px',
                minWidth: '200px'
            },
            md: {
                minHeight: '300px',
                minWidth: '300px'
            },
            lg: {
                minHeight: '400px',
                minWidth: '400px'
            },
            xl: {
                minHeight: '500px',
                minWidth: '500px'
            },
            fluid: {
                minHeight: 'auto',
                minWidth: 'auto'
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
            elevated: {
                backgroundColor: tokens.get('colors.background.primary'),
                border: 'none',
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)'
            },
            outlined: {
                backgroundColor: 'transparent',
                border: '2px solid ' + tokens.get('colors.border.medium'),
                boxShadow: 'none'
            },
            filled: {
                backgroundColor: tokens.get('colors.background.secondary'),
                border: 'none',
                boxShadow: 'none'
            },
            glass: {
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
                backdropFilter: 'blur(4px)'
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
            },
            inline: {
                display: 'inline'
            },
            'inline-block': {
                display: 'inline-block'
            },
            'inline-flex': {
                display: 'inline-flex',
                flexDirection: this.flexDirection,
                justifyContent: this.justifyContent,
                alignItems: this.alignItems
            }
        };
        return layouts[this.display] || layouts.block;
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
        
        if (this.aspectRatio) {
            styles.aspectRatio = this.aspectRatio;
        }
        
        return styles;
    }
    
    getDisplay() {
        return this.display;
    }
    
    getFlexDirection() {
        return this.display === 'flex' || this.display === 'inline-flex' ? this.flexDirection : 'initial';
    }
    
    getJustifyContent() {
        return this.display === 'flex' || this.display === 'inline-flex' ? this.justifyContent : 'initial';
    }
    
    getAlignItems() {
        return this.display === 'flex' || this.display === 'inline-flex' ? this.alignItems : 'initial';
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
        return gaps[this.gap] || gaps.none;
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
    
    getBorder() {
        if (this.variant === 'outlined') {
            return '2px solid ' + tokens.get('colors.border.medium');
        } else if (this.variant === 'glass') {
            return '1px solid rgba(255, 255, 255, 0.2)';
        } else if (this.variant === 'card') {
            return '1px solid ' + tokens.get('colors.border.light');
        }
        return 'none';
    }
    
    getCursorValue() {
        if (this.clickable) {
            return 'pointer';
        } else if (this.resizable) {
            return 'nwse-resize';
        }
        return 'default';
    }
    
    setupEventHandlers() {
        if (this.clickable) {
            this.addEventListener('click', (e) => {
                this.dispatchEvent({
                    type: 'containerClick',
                    bubbles: true,
                    detail: { container: this }
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
        
        if (this.resizable) {
            this.addEventListener('mousedown', (e) => {
                this.startResize(e);
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
    
    startResize(e) {
        e.preventDefault();
        
        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = this.offsetWidth;
        const startHeight = this.offsetHeight;
        
        const handleResize = (e) => {
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            
            const newWidth = Math.max(100, startWidth + deltaX);
            const newHeight = Math.max(100, startHeight + deltaY);
            
            this.style.width = newWidth + 'px';
            this.style.height = newHeight + 'px';
        };
        
        const stopResize = () => {
            document.removeEventListener('mousemove', handleResize);
            document.removeEventListener('mouseup', stopResize);
            
            this.dispatchEvent({
                type: 'containerResize',
                bubbles: true,
                detail: {
                    container: this,
                    width: this.offsetWidth,
                    height: this.offsetHeight
                }
            });
        };
        
        document.addEventListener('mousemove', handleResize);
        document.addEventListener('mouseup', stopResize);
    }
    
    buildContainer() {
        // Container is typically just a wrapper, so no complex structure needed
        // Content will be added by the user
    }
    
    // Public methods
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
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
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setMargin(margin) {
        if (this.margin !== margin) {
            this.margin = margin;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setBorderRadius(borderRadius) {
        if (this.borderRadius !== borderRadius) {
            this.borderRadius = borderRadius;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShadow(shadow) {
        if (this.shadow !== shadow) {
            this.shadow = shadow;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setBackground(background) {
        if (this.background !== background) {
            this.background = background;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setMaxWidth(maxWidth) {
        if (this.maxWidth !== maxWidth) {
            this.maxWidth = maxWidth;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setDisplay(display) {
        if (this.display !== display) {
            this.display = display;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setFlexDirection(flexDirection) {
        if (this.flexDirection !== flexDirection) {
            this.flexDirection = flexDirection;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setJustifyContent(justifyContent) {
        if (this.justifyContent !== justifyContent) {
            this.justifyContent = justifyContent;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setAlignItems(alignItems) {
        if (this.alignItems !== alignItems) {
            this.alignItems = alignItems;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setGap(gap) {
        if (this.gap !== gap) {
            this.gap = gap;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setOverflow(overflow) {
        if (this.overflow !== overflow) {
            this.overflow = overflow;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setPosition(position) {
        if (this.position !== position) {
            this.position = position;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setZIndex(zIndex) {
        if (this.zIndex !== zIndex) {
            this.zIndex = zIndex;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setOpacity(opacity) {
        if (this.opacity !== opacity) {
            this.opacity = opacity;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setTransition(transition) {
        if (this.transition !== transition) {
            this.transition = transition;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setHoverable(hoverable) {
        if (this.hoverable !== hoverable) {
            this.hoverable = hoverable;
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setClickable(clickable) {
        if (this.clickable !== clickable) {
            this.clickable = clickable;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setResizable(resizable) {
        if (this.resizable !== resizable) {
            this.resizable = resizable;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setAspectRatio(aspectRatio) {
        if (this.aspectRatio !== aspectRatio) {
            this.aspectRatio = aspectRatio;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    // Query selector helper
    querySelector(selector) {
        return this.element?.querySelector(selector);
    }
    
    // Static factory methods
    static createContainer(id, options = {}) {
        return new Container(id, options);
    }
    
    static createCard(id, options = {}) {
        return new Container(id, { variant: 'card', padding: 'lg', ...options });
    }
    
    static createElevated(id, options = {}) {
        return new Container(id, { variant: 'elevated', padding: 'lg', ...options });
    }
    
    static createOutlined(id, options = {}) {
        return new Container(id, { variant: 'outlined', padding: 'md', ...options });
    }
    
    static createFilled(id, options = {}) {
        return new Container(id, { variant: 'filled', padding: 'md', ...options });
    }
    
    static createGlass(id, options = {}) {
        return new Container(id, { variant: 'glass', padding: 'lg', ...options });
    }
    
    static createFlex(id, options = {}) {
        return new Container(id, { display: 'flex', ...options });
    }
    
    static createGrid(id, options = {}) {
        return new Container(id, { display: 'grid', ...options });
    }
    
    static createCentered(id, options = {}) {
        return new Container(id, { 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            ...options 
        });
    }
    
    static createSidebar(id, options = {}) {
        return new Container(id, { 
            display: 'flex', 
            flexDirection: 'column', 
            variant: 'elevated',
            padding: 'lg',
            ...options 
        });
    }
    
    static createMain(id, options = {}) {
        return new Container(id, { 
            display: 'flex', 
            flexDirection: 'column', 
            maxWidth: '4xl',
            margin: 'auto',
            padding: 'lg',
            ...options 
        });
    }
    
    static createSection(id, options = {}) {
        return new Container(id, { 
            display: 'flex', 
            flexDirection: 'column',
            padding: 'xl',
            margin: 'lg',
            variant: 'default',
            ...options 
        });
    }
    
    static createModal(id, options = {}) {
        return new Container(id, { 
            variant: 'elevated', 
            padding: 'xl', 
            borderRadius: 'lg',
            shadow: 'lg',
            maxWidth: 'md',
            position: 'relative',
            ...options 
        });
    }
    
    static createPanel(id, options = {}) {
        return new Container(id, { 
            variant: 'card', 
            padding: 'lg', 
            borderRadius: 'md',
            shadow: 'sm',
            ...options 
        });
    }
    
    static createHero(id, options = {}) {
        return new Container(id, { 
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 'xxxl',
            minHeight: '500px',
            background: 'primary',
            ...options 
        });
    }
    
    static createSidebarPanel(id, options = {}) {
        return new Container(id, { 
            display: 'flex', 
            flexDirection: 'column', 
            variant: 'outlined',
            padding: 'md',
            borderRadius: 'sm',
            gap: 'sm',
            ...options 
        });
    }
    
    static createContent(id, options = {}) {
        return new Container(id, { 
            display: 'flex', 
            flexDirection: 'column', 
            padding: 'lg',
            gap: 'md',
            ...options 
        });
    }
    
    static createFooter(id, options = {}) {
        return new Container(id, { 
            display: 'flex', 
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 'lg',
            background: 'secondary',
            ...options 
        });
    }
}
