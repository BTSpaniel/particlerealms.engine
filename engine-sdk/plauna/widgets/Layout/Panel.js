// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Panel - Content panel widget for Plauna
 * Provides panel containers with various styles and configurations
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { clamp as clampScalar } from '../../../engine/core/math/MathScalar.js';

let _layoutPanelSequence = 0;

function _newLayoutPanelId() {
    return `panel-${Date.now()}-${++_layoutPanelSequence}`;
}

export class Panel extends UINode {
    // Widget metadata
    static id = 'panel-layout';
    static name = 'Panel';
    static category = 'layout';
    static icon = '📦';
    static description = 'Layout panel';
    static tags = ['layout', 'panel'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            title: '',
            variant: 'default',
            collapsible: false
        };
    }
    
    static create(container, options = {}) {
        const instance = new Panel(_newLayoutPanelId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newLayoutPanelId(), options = {}) {
        super(id, 'panel');
        
        // Panel-specific properties
        this.variant = options.variant || 'default'; // default, card, elevated, outlined, filled, glass, bordered
        this.size = options.size || 'md'; // xs, sm, md, lg, xl, fluid
        this.padding = options.padding || 'md'; // none, xs, sm, md, lg, xl, xxxl
        this.margin = options.margin || 'none'; // none, xs, sm, md, lg, xl
        this.borderRadius = options.borderRadius || 'md'; // none, sm, md, lg, xl, full
        this.shadow = options.shadow || 'none'; // none, sm, md, lg, xl
        this.background = options.background || 'default'; // default, primary, secondary, accent, surface, transparent, gradient
        this.maxWidth = options.maxWidth || 'none'; // none, sm, md, lg, xl, 2xl, 3xl, 4xl, 5xl, 6xl, 7xl, full
        this.alignment = options.alignment || 'left'; // left, center, right, justify
        this.verticalAlignment = options.verticalAlignment || 'top'; // top, center, bottom, stretch
        this.overflow = options.overflow || 'visible'; // visible, hidden, scroll, auto
        this.display = options.display || 'block'; // block, flex, grid
        this.flexDirection = options.flexDirection || 'column'; // row, column, row-reverse, column-reverse
        this.justifyContent = options.justifyContent || 'flex-start'; // flex-start, flex-end, center, space-between, space-around, space-evenly
        this.alignItems = options.alignItems || 'stretch'; // flex-start, flex-end, center, baseline, stretch
        this.gap = options.gap || 'md'; // none, xs, sm, md, lg, xl
        this.position = options.position || 'static'; // static, relative, absolute, fixed, sticky
        this.zIndex = options.zIndex || 'auto'; // auto, 1-50
        this.opacity = options.opacity || '100'; // 0-100
        this.transition = options.transition || 'none'; // none, all, colors, transform, opacity
        this.hoverable = options.hoverable || false;
        this.clickable = options.clickable || false;
        this.resizable = options.resizable || false;
        this.collapsible = options.collapsible || false;
        this.collapsed = options.collapsed || false;
        this.border = options.border || 'none'; // none, all, top, bottom, left, right
        this.borderColor = options.borderColor || 'medium'; // light, medium, dark
        this.borderWidth = options.borderWidth || '1px'; // 1px, 2px, 3px, 4px
        this.aspectRatio = options.aspectRatio || null; // null, 1/1, 4/3, 16/9, 21/9, etc.
        
        // Panel content structure
        this.title = options.title || null;
        this.subtitle = options.subtitle || null;
        this.description = options.description || null;
        this.showHeader = options.showHeader !== false;
        this.showFooter = options.showFooter || false;
        this.footerContent = options.footerContent || null;
        this.showActions = options.showActions || false;
        this.actions = options.actions || [];
        
        // Semantic attributes
        this.ariaLabel = options.ariaLabel || null;
        this.ariaLabelledby = options.ariaLabelledby || null;
        this.ariaDescribedby = options.ariaDescribedby || null;
        this.ariaExpanded = this.collapsible ? (!this.collapsed).toString() : null;
        
        // Set semantic role
        this.role = options.role || 'region';
        this.setAttribute('aria-label', this.ariaLabel || 'Content panel');
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build panel structure
        this.buildPanel();
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
            border: this.getBorderValue(),
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
            textAlign: this.alignment,
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
                minHeight: '120px',
                minWidth: '200px'
            },
            sm: {
                minHeight: '160px',
                minWidth: '280px'
            },
            md: {
                minHeight: '200px',
                minWidth: '320px'
            },
            lg: {
                minHeight: '240px',
                minWidth: '400px'
            },
            xl: {
                minHeight: '280px',
                minWidth: '480px'
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
            },
            bordered: {
                backgroundColor: tokens.get('colors.background.primary'),
                border: '2px solid ' + tokens.get('colors.border.medium'),
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
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
    
    getBorderValue() {
        if (this.border === 'none' || this.variant === 'glass') {
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
                    type: 'panelClick',
                    bubbles: true,
                    detail: { panel: this }
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
                type: 'panelResize',
                bubbles: true,
                detail: {
                    panel: this,
                    width: this.offsetWidth,
                    height: this.offsetHeight
                }
            });
        };
        
        document.addEventListener('mousemove', handleResize);
        document.addEventListener('mouseup', stopResize);
    }
    
    buildPanel() {
        this.innerHTML = '';
        
        // Create header if needed
        if (this.showHeader && (this.title || this.subtitle || this.showActions)) {
            const header = this.createHeader();
            this.appendChild(header);
        }
        
        // Create main content area
        const main = document.createElement('div');
        main.className = 'plauna-panel__main';
        main.style.cssText = (
            'flex: 1;' +
            'display: ' + (this.display === 'flex' ? 'flex' : 'block') + ';' +
            'flex-direction: ' + (this.display === 'flex' ? this.flexDirection : 'initial') + ';' +
            'gap: ' + this.getGap() + ';'
        );
        this.appendChild(main);
        
        // Create footer if needed
        if (this.showFooter && this.footerContent) {
            const footer = this.createFooter();
            this.appendChild(footer);
        }
    }
    
    createHeader() {
        const header = document.createElement('div');
        header.className = 'plauna-panel__header';
        header.style.cssText = (
            'display: flex;' +
            'justify-content: space-between;' +
            'align-items: flex-start;' +
            'gap: ' + tokens.get('spacing.md') + ';' +
            'margin-bottom: ' + tokens.get('spacing.lg') + ';'
        );
        
        // Create title section
        const titleSection = document.createElement('div');
        titleSection.className = 'plauna-panel__title-section';
        titleSection.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'flex: 1;'
        );
        
        // Add title
        if (this.title) {
            const titleElement = document.createElement('h3');
            titleElement.className = 'plauna-panel__title';
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
            subtitleElement.className = 'plauna-panel__subtitle';
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
        
        header.appendChild(titleSection);
        
        // Add actions if needed
        if (this.showActions && this.actions.length > 0) {
            const actionsSection = document.createElement('div');
            actionsSection.className = 'plauna-panel__actions';
            actionsSection.style.cssText = (
                'display: flex;' +
                'gap: ' + tokens.get('spacing.sm') + ';' +
                'align-items: center;'
            );
            
            this.actions.forEach(action => {
                const actionButton = document.createElement('button');
                actionButton.className = 'plauna-panel__action';
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
        
        // Add collapse toggle if collapsible
        if (this.collapsible) {
            const collapseToggle = document.createElement('button');
            collapseToggle.className = 'plauna-panel__collapse-toggle';
            collapseToggle.textContent = this.collapsed ? '▼' : '▲';
            collapseToggle.style.cssText = (
                'background: transparent;' +
                'border: none;' +
                'color: ' + tokens.get('colors.text.secondary') + ';' +
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'cursor: pointer;' +
                'padding: ' + tokens.get('spacing.xs') + ';' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'transition: all 150ms ease;'
            );
            
            collapseToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleCollapse();
            });
            
            header.appendChild(collapseToggle);
        }
        
        return header;
    }
    
    createFooter() {
        const footer = document.createElement('div');
        footer.className = 'plauna-panel__footer';
        footer.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: ' + (this.alignment === 'center' ? 'center' : this.alignment === 'right' ? 'flex-end' : 'flex-start') + ';' +
            'margin-top: ' + tokens.get('spacing.lg') + ';' +
            'padding-top: ' + tokens.get('spacing.md') + ';' +
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
    toggleCollapse() {
        if (!this.collapsible) return;
        
        this.collapsed = !this.collapsed;
        this.ariaExpanded = (!this.collapsed).toString();
        
        const main = this.querySelector('.plauna-panel__main');
        const collapseToggle = this.querySelector('.plauna-panel__collapse-toggle');
        
        if (main) {
            main.style.display = this.collapsed ? 'none' : '';
        }
        
        if (collapseToggle) {
            collapseToggle.textContent = this.collapsed ? '▼' : '▲';
        }
        
        this.dispatchEvent({
            type: 'panelToggle',
            bubbles: true,
            detail: {
                panel: this,
                collapsed: this.collapsed
            }
        });
        
        this.markDirty(DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
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
    
    setBackground(background) {
        if (this.background !== background) {
            this.background = background;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setTitle(title) {
        if (this.title !== title) {
            this.title = title;
            this.buildPanel();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSubtitle(subtitle) {
        if (this.subtitle !== subtitle) {
            this.subtitle = subtitle;
            this.buildPanel();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowHeader(showHeader) {
        if (this.showHeader !== showHeader) {
            this.showHeader = showHeader;
            this.buildPanel();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowFooter(showFooter) {
        if (this.showFooter !== showFooter) {
            this.showFooter = showFooter;
            this.buildPanel();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setFooterContent(footerContent) {
        if (this.footerContent !== footerContent) {
            this.footerContent = footerContent;
            this.buildPanel();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setActions(actions) {
        if (this.actions !== actions) {
            this.actions = actions;
            this.buildPanel();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setCollapsible(collapsible) {
        if (this.collapsible !== collapsible) {
            this.collapsible = collapsible;
            this.ariaExpanded = collapsible ? (!this.collapsed).toString() : null;
            this.buildPanel();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    // Query selector helper
    querySelector(selector) {
        return this.element?.querySelector(selector);
    }
    
    // Static factory methods
    static createPanel(id, options = {}) {
        return new Panel(id, options);
    }
    
    static createCard(id, options = {}) {
        return new Panel(id, {
            variant: 'card',
            padding: 'lg',
            shadow: 'sm',
            borderRadius: 'md',
            ...options
        });
    }
    
    static createElevated(id, options = {}) {
        return new Panel(id, {
            variant: 'elevated',
            padding: 'lg',
            shadow: 'md',
            borderRadius: 'lg',
            hoverable: true,
            ...options
        });
    }
    
    static createOutlined(id, options = {}) {
        return new Panel(id, {
            variant: 'outlined',
            padding: 'md',
            borderRadius: 'md',
            ...options
        });
    }
    
    static createGlass(id, options = {}) {
        return new Panel(id, {
            variant: 'glass',
            padding: 'lg',
            borderRadius: 'lg',
            hoverable: true,
            ...options
        });
    }
    
    static createSidebar(id, options = {}) {
        return new Panel(id, {
            variant: 'outlined',
            padding: 'md',
            borderRadius: 'sm',
            display: 'flex',
            flexDirection: 'column',
            gap: 'sm',
            ...options
        });
    }
    
    static createWidget(id, options = {}) {
        return new Panel(id, {
            variant: 'elevated',
            padding: 'lg',
            borderRadius: 'md',
            shadow: 'md',
            ...options
        });
    }
    
    static createInfoCard(id, options = {}) {
        return new Panel(id, {
            variant: 'card',
            padding: 'lg',
            borderRadius: 'md',
            shadow: 'sm',
            background: 'surface',
            ...options
        });
    }
    
    static createAlert(id, options = {}) {
        return new Panel(id, {
            variant: 'outlined',
            padding: 'md',
            borderRadius: 'md',
            border: 'left',
            borderColor: 'medium',
            borderWidth: '4px',
            ...options
        });
    }
    
    static createCollapsible(id, options = {}) {
        return new Panel(id, {
            variant: 'card',
            padding: 'lg',
            borderRadius: 'md',
            shadow: 'sm',
            collapsible: true,
            ...options
        });
    }
    
    static createDashboard(id, options = {}) {
        return new Panel(id, {
            variant: 'elevated',
            padding: 'lg',
            borderRadius: 'lg',
            shadow: 'md',
            display: 'grid',
            gap: 'lg',
            ...options
        });
    }
    
    static createSettings(id, options = {}) {
        return new Panel(id, {
            variant: 'outlined',
            padding: 'lg',
            borderRadius: 'md',
            display: 'flex',
            flexDirection: 'column',
            gap: 'md',
            ...options
        });
    }
}
