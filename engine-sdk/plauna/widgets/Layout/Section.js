// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Section - Content section widget for Plauna
 * Provides semantic section containers with layout and styling options
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { clamp as clampScalar } from '../../../engine/core/math/MathScalar.js';

let _sectionSequence = 0;

function _newSectionId() {
    return `section-${Date.now()}-${++_sectionSequence}`;
}

export class Section extends UINode {
    // Widget metadata
    static id = 'section';
    static name = 'Section';
    static category = 'layout';
    static icon = '📄';
    static description = 'Section container';
    static tags = ['layout', 'section'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            title: '',
            variant: 'default',
            padding: 'md'
        };
    }
    
    static create(container, options = {}) {
        const instance = new Section(_newSectionId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newSectionId(), options = {}) {
        super(id, 'section');
        
        // Section-specific properties
        this.variant = options.variant || 'default'; // default, primary, secondary, accent, muted, outlined, elevated
        this.size = options.size || 'md'; // xs, sm, md, lg, xl, fluid
        this.padding = options.padding || 'xl'; // none, xs, sm, md, lg, xl, xxxl
        this.margin = options.margin || 'lg'; // none, xs, sm, md, lg, xl
        this.borderRadius = options.borderRadius || 'none'; // none, sm, md, lg, xl, full
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
        this.separators = options.separators || 'none'; // none, top, bottom, both
        this.heading = options.heading || null; // heading text or object
        this.headingLevel = options.headingLevel || 'h2'; // h1, h2, h3, h4, h5, h6
        this.subheading = options.subheading || null; // subheading text
        this.description = options.description || null; // description text
        this.showHeader = options.showHeader !== false;
        this.showFooter = options.showFooter || false;
        this.footerContent = options.footerContent || null;
        
        // Semantic attributes
        this.ariaLabel = options.ariaLabel || null;
        this.ariaLabelledby = options.ariaLabelledby || null;
        this.ariaDescribedby = options.ariaDescribedby || null;
        
        // Set semantic role
        this.role = 'region';
        this.setAttribute('aria-label', this.ariaLabel || 'Content section');
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build section structure
        this.buildSection();
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
                minHeight: '200px'
            },
            sm: {
                minHeight: '300px'
            },
            md: {
                minHeight: '400px'
            },
            lg: {
                minHeight: '500px'
            },
            xl: {
                minHeight: '600px'
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
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
            },
            secondary: {
                backgroundColor: tokens.get('colors.secondary'),
                color: tokens.get('colors.text.inverse'),
                border: 'none',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
            },
            accent: {
                backgroundColor: tokens.get('colors.accent'),
                color: tokens.get('colors.text.inverse'),
                border: 'none',
                boxShadow: '0 4px 8px rgba(139, 92, 246, 0.2)'
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
                border: '2px solid ' + tokens.get('colors.border.medium'),
                boxShadow: 'none'
            },
            elevated: {
                backgroundColor: tokens.get('colors.background.primary'),
                color: tokens.get('colors.text.primary'),
                border: '1px solid ' + tokens.get('colors.border.light'),
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)'
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
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
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
        return paddings[this.padding] || paddings.xl;
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
        return margins[this.margin] || margins.lg;
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
        if (this.variant === 'outlined') {
            return '2px solid ' + tokens.get('colors.border.medium');
        } else if (this.variant === 'elevated') {
            return '1px solid ' + tokens.get('colors.border.light');
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
                    type: 'sectionClick',
                    bubbles: true,
                    detail: { section: this }
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
    
    buildSection() {
        this.innerHTML = '';
        
        // Create header if needed
        if (this.showHeader && (this.heading || this.subheading || this.description)) {
            const header = this.createHeader();
            this.appendChild(header);
        }
        
        // Create main content area
        const main = document.createElement('div');
        main.className = 'plauna-section__main';
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
        const header = document.createElement('header');
        header.className = 'plauna-section__header';
        header.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'margin-bottom: ' + tokens.get('spacing.lg') + ';' +
            'text-align: ' + this.alignment + ';'
        );
        
        // Add heading
        if (this.heading) {
            const headingElement = document.createElement(this.headingLevel);
            headingElement.className = 'plauna-section__heading';
            headingElement.textContent = typeof this.heading === 'string' ? this.heading : this.heading.text || '';
            headingElement.style.cssText = (
                'font-size: ' + this.getHeadingSize() + ';' +
                'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
                'color: ' + this.getHeadingColor() + ';' +
                'margin: 0;' +
                'line-height: 1.2;'
            );
            
            if (this.heading.id) {
                headingElement.id = this.heading.id;
                this.setAttribute('aria-labelledby', headingElement.id);
            }
            
            header.appendChild(headingElement);
        }
        
        // Add subheading
        if (this.subheading) {
            const subheadingElement = document.createElement('p');
            subheadingElement.className = 'plauna-section__subheading';
            subheadingElement.textContent = this.subheading;
            subheadingElement.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.lg') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'color: ' + this.getSubheadingColor() + ';' +
                'margin: 0;' +
                'line-height: 1.4;'
            );
            header.appendChild(subheadingElement);
        }
        
        // Add description
        if (this.description) {
            const descriptionElement = document.createElement('p');
            descriptionElement.className = 'plauna-section__description';
            descriptionElement.textContent = this.description;
            descriptionElement.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.md') + ';' +
                'font-weight: ' + tokens.get('fontWeights.normal') + ';' +
                'color: ' + this.getDescriptionColor() + ';' +
                'margin: 0;' +
                'line-height: 1.6;'
            );
            
            if (this.description.id) {
                this.setAttribute('aria-describedby', this.description.id);
            }
            
            header.appendChild(descriptionElement);
        }
        
        return header;
    }
    
    createFooter() {
        const footer = document.createElement('footer');
        footer.className = 'plauna-section__footer';
        footer.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: ' + (this.alignment === 'center' ? 'center' : this.alignment === 'right' ? 'flex-end' : 'flex-start') + ';' +
            'margin-top: ' + tokens.get('spacing.lg') + ';' +
            'padding-top: ' + tokens.get('spacing.md') + ';' +
            'border-top: 1px solid ' + tokens.get('colors.border.light') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'color: ' + this.getDescriptionColor() + ';'
        );
        
        if (typeof this.footerContent === 'string') {
            footer.textContent = this.footerContent;
        } else {
            footer.appendChild(this.footerContent);
        }
        
        return footer;
    }
    
    getHeadingSize() {
        const sizes = {
            h1: '32px',
            h2: '28px',
            h3: '24px',
            h4: '20px',
            h5: '18px',
            h6: '16px'
        };
        return sizes[this.headingLevel] || sizes.h2;
    }
    
    getHeadingColor() {
        const colors = {
            default: tokens.get('colors.text.primary'),
            primary: tokens.get('colors.text.inverse'),
            secondary: tokens.get('colors.text.inverse'),
            accent: tokens.get('colors.text.inverse'),
            muted: tokens.get('colors.text.primary'),
            outlined: tokens.get('colors.text.primary'),
            elevated: tokens.get('colors.text.primary')
        };
        return colors[this.variant] || colors.default;
    }
    
    getSubheadingColor() {
        const colors = {
            default: tokens.get('colors.text.secondary'),
            primary: 'rgba(255, 255, 255, 0.9)',
            secondary: 'rgba(255, 255, 255, 0.9)',
            accent: 'rgba(255, 255, 255, 0.9)',
            muted: tokens.get('colors.text.secondary'),
            outlined: tokens.get('colors.text.secondary'),
            elevated: tokens.get('colors.text.secondary')
        };
        return colors[this.variant] || colors.default;
    }
    
    getDescriptionColor() {
        const colors = {
            default: tokens.get('colors.text.secondary'),
            primary: 'rgba(255, 255, 255, 0.8)',
            secondary: 'rgba(255, 255, 255, 0.8)',
            accent: 'rgba(255, 255, 255, 0.8)',
            muted: tokens.get('colors.text.secondary'),
            outlined: tokens.get('colors.text.secondary'),
            elevated: tokens.get('colors.text.secondary')
        };
        return colors[this.variant] || colors.default;
    }
    
    // Public methods
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.buildSection();
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
    
    setBackground(background) {
        if (this.background !== background) {
            this.background = background;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setHeading(heading) {
        if (this.heading !== heading) {
            this.heading = heading;
            this.buildSection();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSubheading(subheading) {
        if (this.subheading !== subheading) {
            this.subheading = subheading;
            this.buildSection();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setDescription(description) {
        if (this.description !== description) {
            this.description = description;
            this.buildSection();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowHeader(showHeader) {
        if (this.showHeader !== showHeader) {
            this.showHeader = showHeader;
            this.buildSection();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowFooter(showFooter) {
        if (this.showFooter !== showFooter) {
            this.showFooter = showFooter;
            this.buildSection();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setFooterContent(footerContent) {
        if (this.footerContent !== footerContent) {
            this.footerContent = footerContent;
            this.buildSection();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSeparators(separators) {
        if (this.separators !== separators) {
            this.separators = separators;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setAlignment(alignment) {
        if (this.alignment !== alignment) {
            this.alignment = alignment;
            this.setupStyles();
            this.buildSection();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    // Query selector helper
    querySelector(selector) {
        return this.element?.querySelector(selector);
    }
    
    // Static factory methods
    static createSection(id, options = {}) {
        return new Section(id, options);
    }
    
    static createHeroSection(id, options = {}) {
        return new Section(id, {
            variant: 'primary',
            size: 'xl',
            padding: 'xxxl',
            alignment: 'center',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            ...options
        });
    }
    
    static createContentSection(id, options = {}) {
        return new Section(id, {
            variant: 'default',
            size: 'md',
            padding: 'xl',
            margin: 'lg',
            maxWidth: '4xl',
            ...options
        });
    }
    
    static createFeatureSection(id, options = {}) {
        return new Section(id, {
            variant: 'muted',
            size: 'lg',
            padding: 'xl',
            display: 'grid',
            gap: 'lg',
            ...options
        });
    }
    
    static createTestimonialSection(id, options = {}) {
        return new Section(id, {
            variant: 'elevated',
            size: 'md',
            padding: 'xl',
            alignment: 'center',
            borderRadius: 'lg',
            shadow: 'lg',
            ...options
        });
    }
    
    static createCallToActionSection(id, options = {}) {
        return new Section(id, {
            variant: 'accent',
            size: 'md',
            padding: 'xl',
            alignment: 'center',
            borderRadius: 'md',
            ...options
        });
    }
    
    static createSidebarSection(id, options = {}) {
        return new Section(id, {
            variant: 'outlined',
            size: 'md',
            padding: 'lg',
            margin: 'none',
            borderRadius: 'md',
            ...options
        });
    }
    
    static createFooterSection(id, options = {}) {
        return new Section(id, {
            variant: 'secondary',
            size: 'md',
            padding: 'xl',
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            separators: 'top',
            ...options
        });
    }
    
    static createHeaderSection(id, options = {}) {
        return new Section(id, {
            variant: 'default',
            size: 'md',
            padding: 'lg',
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            separators: 'bottom',
            ...options
        });
    }
}
