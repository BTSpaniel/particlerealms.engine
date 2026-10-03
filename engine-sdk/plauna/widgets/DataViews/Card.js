// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Card - Flexible content container widget for Plauna
 * Provides header, body, and footer slots with variant system
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _cardSequence = 0;

function _newCardId() {
    return `card-${Date.now()}-${++_cardSequence}`;
}

export class Card extends UINode {
    // Widget metadata
    static id = 'card';
    static name = 'Card';
    static category = 'dataviews';
    static icon = '📇';
    static description = 'Flexible content container';
    static tags = ['dataviews', 'card', 'container'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            variant: 'default',
            size: 'md',
            elevated: false,
            interactive: false
        };
    }
    
    static create(container, options = {}) {
        const instance = new Card(_newCardId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newCardId(), options = {}) {
        super(id, 'card');
        
        // Card-specific properties
        this.variant = options.variant || 'default';
        this.size = options.size || 'md';
        this.elevated = options.elevated || false;
        this.interactive = options.interactive || false;
        this.padding = options.padding || null; // null = default for size
        
        // Content slots
        this.header = null;
        this.body = null;
        this.footer = null;
        this.image = null;
        this.actions = null;
        
        // Image properties
        this.imageSrc = options.imageSrc || null;
        this.imageAlt = options.imageAlt || '';
        this.imageAspectRatio = options.imageAspectRatio || '16/9';
        this.imagePosition = options.imagePosition || 'top'; // top, bottom, background
        
        // Set accessibility
        this.role = this.interactive ? 'article' : 'region';
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build card structure
        this.buildCard();
        
        // Set initial content
        if (options.header) this.setHeader(options.header);
        if (options.body) this.setBody(options.body);
        if (options.footer) this.setFooter(options.footer);
        if (options.actions) this.setActions(options.actions);
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        const paddingStyles = this.getPaddingStyles();
        
        this.setStyles({
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: tokens.get('colors.background.primary'),
            border: `1px solid ${tokens.get('colors.border.medium')}`,
            borderRadius: tokens.get('borderRadius.md'),
            boxShadow: this.elevated ? tokens.get('shadows.lg') : tokens.get('shadows.sm'),
            overflow: 'hidden',
            transition: 'all 200ms ease',
            outline: 'none',
            cursor: this.interactive ? 'pointer' : 'default',
            ...sizeStyles,
            ...variantStyles,
            ...paddingStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                minWidth: '200px',
                maxWidth: '280px'
            },
            sm: {
                minWidth: '280px',
                maxWidth: '360px'
            },
            md: {
                minWidth: '320px',
                maxWidth: '400px'
            },
            lg: {
                minWidth: '360px',
                maxWidth: '480px'
            },
            xl: {
                minWidth: '400px',
                maxWidth: '560px'
            },
            fluid: {
                minWidth: 'auto',
                maxWidth: 'none'
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        const variants = {
            default: {
                border: `1px solid ${tokens.get('colors.border.medium')}`
            },
            elevated: {
                border: `1px solid ${tokens.get('colors.border.light')}`,
                boxShadow: tokens.get('shadows.xl')
            },
            outlined: {
                border: `2px solid ${tokens.get('colors.primary.500')}`,
                boxShadow: 'none'
            },
            filled: {
                border: 'none',
                backgroundColor: tokens.get('colors.background.tertiary')
            },
            interactive: {
                border: `1px solid ${tokens.get('colors.border.medium')}`,
                cursor: 'pointer',
                transform: 'translateY(0)',
                boxShadow: tokens.get('shadows.md')
            }
        };
        return variants[this.variant] || variants.default;
    }
    
    getPaddingStyles() {
        if (this.padding !== null) {
            return { padding: this.padding };
        }
        
        const paddings = {
            xs: { padding: tokens.get('spacing.sm') },
            sm: { padding: tokens.get('spacing.md') },
            md: { padding: tokens.get('spacing.lg') },
            lg: { padding: tokens.get('spacing.xl') },
            xl: { padding: tokens.get('spacing.xxl') }
        };
        return paddings[this.size] || paddings.md;
    }
    
    setupEventHandlers() {
        if (this.interactive) {
            this.addEventListener('mouseenter', () => {
                this.setStyle('transform', 'translateY(-2px)');
                this.setStyle('boxShadow', tokens.get('shadows.xl'));
            });
            
            this.addEventListener('mouseleave', () => {
                this.setStyle('transform', 'translateY(0)');
                this.setStyle('boxShadow', this.elevated ? tokens.get('shadows.lg') : tokens.get('shadows.md'));
            });
            
            this.addEventListener('focus', () => {
                this.setStyle('transform', 'translateY(-2px)');
                this.setStyle('boxShadow', tokens.get('shadows.xl'));
                this.setStyle('border-color', tokens.get('colors.primary.500'));
            });
            
            this.addEventListener('blur', () => {
                this.setStyle('transform', 'translateY(0)');
                this.setStyle('boxShadow', this.elevated ? tokens.get('shadows.lg') : tokens.get('shadows.md'));
                this.setStyle('border-color', tokens.get('colors.border.medium'));
            });
        }
    }
    
    buildCard() {
        // Clear existing content
        this.innerHTML = '';
        
        // Background image (if specified)
        if (this.imageSrc && this.imagePosition === 'background') {
            this.createBackgroundImage();
        }
        
        // Top image (if specified)
        if (this.imageSrc && this.imagePosition === 'top') {
            this.createTopImage();
        }
        
        // Header
        this.header = new UINode(`${this.id}-header`, 'header');
        this.header.setStyles({
            display: this.hasContent('header') ? 'block' : 'none',
            paddingBottom: tokens.get('spacing.md'),
            borderBottom: this.hasContent('body') ? `1px solid ${tokens.get('colors.border.subtle')}` : 'none'
        });
        this.appendChild(this.header);
        
        // Body (main content area)
        this.body = new UINode(`${this.id}-body`, 'div');
        this.body.setStyles({
            display: 'flex',
            flexDirection: 'column',
            flex: '1',
            gap: tokens.get('spacing.sm')
        });
        this.appendChild(this.body);
        
        // Footer
        this.footer = new UINode(`${this.id}-footer`, 'footer');
        this.footer.setStyles({
            display: this.hasContent('footer') ? 'block' : 'none',
            paddingTop: this.hasContent('body') ? tokens.get('spacing.md') : '0',
            borderTop: this.hasContent('body') ? `1px solid ${tokens.get('colors.border.subtle')}` : 'none'
        });
        this.appendChild(this.footer);
        
        // Actions
        this.actions = new UINode(`${this.id}-actions`, 'div');
        this.actions.setStyles({
            display: this.hasContent('actions') ? 'flex' : 'none',
            justifyContent: 'flex-end',
            gap: tokens.get('spacing.sm'),
            paddingTop: this.hasContent('body') || this.hasContent('footer') ? tokens.get('spacing.md') : '0',
            borderTop: (this.hasContent('body') || this.hasContent('footer')) ? `1px solid ${tokens.get('colors.border.subtle')}` : 'none'
        });
        this.appendChild(this.actions);
        
        // Bottom image (if specified)
        if (this.imageSrc && this.imagePosition === 'bottom') {
            this.createBottomImage();
        }
    }
    
    createBackgroundImage() {
        this.setStyle('position', 'relative');
        this.setStyle('backgroundImage', `url(${this.imageSrc})`);
        this.setStyle('backgroundSize', 'cover');
        this.setStyle('backgroundPosition', 'center');
        this.setStyle('backgroundRepeat', 'no-repeat');
        
        // Add overlay for better text readability
        const overlay = new UINode(`${this.id}-overlay`, 'div');
        overlay.setStyles({
            position: 'absolute',
            top: '0',
            left: '0',
            right: '0',
            bottom: '0',
            background: 'rgba(0, 0, 0, 0.4)',
            zIndex: '1'
        });
        this.insertBefore(overlay, this.firstChild);
        
        // Ensure content is above overlay
        this.children.forEach(child => {
            if (child !== overlay) {
                child.setStyle('position', 'relative');
                child.setStyle('zIndex', '2');
            }
        });
    }
    
    createTopImage() {
        this.image = new UINode(`${this.id}-image`, 'img');
        this.image.setStyles({
            width: '100%',
            height: 'auto',
            maxHeight: '200px',
            objectFit: 'cover',
            display: 'block'
        });
        this.insertBefore(this.image, this.firstChild);
        
        // Set image properties
        if (this.imageSrc) {
            this.image.element.src = this.imageSrc;
            this.image.element.alt = this.imageAlt;
        }
    }
    
    createBottomImage() {
        this.image = new UINode(`${this.id}-image`, 'img');
        this.image.setStyles({
            width: '100%',
            height: 'auto',
            maxHeight: '200px',
            objectFit: 'cover',
            display: 'block'
        });
        this.appendChild(this.image);
        
        // Set image properties
        if (this.imageSrc) {
            this.image.element.src = this.imageSrc;
            this.image.element.alt = this.imageAlt;
        }
    }
    
    hasContent(slot) {
        switch (slot) {
            case 'header': return this.header && this.header.children.length > 0;
            case 'body': return this.body && this.body.children.length > 0;
            case 'footer': return this.footer && this.footer.children.length > 0;
            case 'actions': return this.actions && this.actions.children.length > 0;
            default: return false;
        }
    }
    
    setHeader(content) {
        this.header.innerHTML = '';
        if (typeof content === 'string') {
            this.header.textContent = content;
        } else if (content instanceof UINode) {
            this.header.appendChild(content);
        }
        this.updateSlotStyles('header');
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setBody(content) {
        this.body.innerHTML = '';
        if (typeof content === 'string') {
            this.body.textContent = content;
        } else if (content instanceof UINode) {
            this.body.appendChild(content);
        }
        this.updateSlotStyles('body');
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setFooter(content) {
        this.footer.innerHTML = '';
        if (typeof content === 'string') {
            this.footer.textContent = content;
        } else if (content instanceof UINode) {
            this.footer.appendChild(content);
        }
        this.updateSlotStyles('footer');
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setActions(actions) {
        this.actions.innerHTML = '';
        if (Array.isArray(actions)) {
            actions.forEach(action => {
                if (typeof action === 'string') {
                    // Create simple text button
                    const button = new UINode(`${this.id}-action-${action}`, 'button');
                    button.textContent = action;
                    button.setStyles({
                        padding: `${tokens.get('spacing.xs')} ${tokens.get('spacing.md')}`,
                        backgroundColor: tokens.get('colors.primary.500'),
                        color: tokens.get('colors.text.inverse'),
                        border: 'none',
                        borderRadius: tokens.get('borderRadius.sm'),
                        fontSize: tokens.get('fontSizes.sm'),
                        fontWeight: tokens.get('fontWeights.medium'),
                        cursor: 'pointer',
                        transition: 'all 150ms ease'
                    });
                    this.actions.appendChild(button);
                } else if (action instanceof UINode) {
                    this.actions.appendChild(action);
                }
            });
        } else if (actions instanceof UINode) {
            this.actions.appendChild(actions);
        }
        this.updateSlotStyles('actions');
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    updateSlotStyles(slot) {
        const hasContent = this.hasContent(slot);
        const slotNode = this[slot];
        
        if (!slotNode) return;
        
        switch (slot) {
            case 'header':
                slotNode.setStyle('display', hasContent ? 'block' : 'none');
                slotNode.setStyle('paddingBottom', hasContent && this.hasContent('body') ? tokens.get('spacing.md') : '0');
                slotNode.setStyle('borderBottom', hasContent && this.hasContent('body') ? `1px solid ${tokens.get('colors.border.subtle')}` : 'none');
                break;
            case 'body':
                // Body is always visible as the main content area
                break;
            case 'footer':
                slotNode.setStyle('display', hasContent ? 'block' : 'none');
                slotNode.setStyle('paddingTop', hasContent && this.hasContent('body') ? tokens.get('spacing.md') : '0');
                slotNode.setStyle('borderTop', hasContent && this.hasContent('body') ? `1px solid ${tokens.get('colors.border.subtle')}` : 'none');
                break;
            case 'actions':
                slotNode.setStyle('display', hasContent ? 'flex' : 'none');
                slotNode.setStyle('paddingTop', hasContent && (this.hasContent('body') || this.hasContent('footer')) ? tokens.get('spacing.md') : '0');
                slotNode.setStyle('borderTop', hasContent && (this.hasContent('body') || this.hasContent('footer')) ? `1px solid ${tokens.get('colors.border.subtle')}` : 'none');
                break;
        }
    }
    
    setImage(src, alt = '', position = 'top') {
        this.imageSrc = src;
        this.imageAlt = alt;
        this.imagePosition = position;
        this.buildCard();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setVariant(variant) {
        this.variant = variant;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
    }
    
    setSize(size) {
        this.size = size;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setElevated(elevated) {
        this.elevated = elevated;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
    }
    
    setInteractive(interactive) {
        this.interactive = interactive;
        this.role = interactive ? 'article' : 'region';
        this.setupStyles();
        this.setupEventHandlers();
        this.markDirty(DIRTY.STYLE | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
    }
    
    setPadding(padding) {
        this.padding = padding;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
    }
    
    // Static factory methods for common card types
    static createProductCard(id, product, options = {}) {
        const card = new Card(id, {
            variant: 'elevated',
            size: 'md',
            interactive: true,
            imageSrc: product.image,
            imageAlt: product.name,
            ...options
        });
        
        // Header with title
        const header = new UINode(`${id}-title`, 'h3');
        header.textContent = product.name;
        header.setStyles({
            margin: '0',
            fontSize: tokens.get('fontSizes.lg'),
            fontWeight: tokens.get('fontWeights.semibold'),
            color: tokens.get('colors.text.primary')
        });
        card.setHeader(header);
        
        // Body with description
        card.setBody(product.description);
        
        // Footer with price
        const footer = new UINode(`${id}-price`, 'div');
        footer.textContent = `$${product.price}`;
        footer.setStyles({
            fontSize: tokens.get('fontSizes.xl'),
            fontWeight: tokens.get('fontWeights.bold'),
            color: tokens.get('colors.primary.600')
        });
        card.setFooter(footer);
        
        return card;
    }
    
    static createProfileCard(id, profile, options = {}) {
        const card = new Card(id, {
            variant: 'default',
            size: 'md',
            imageSrc: profile.avatar,
            imageAlt: profile.name,
            ...options
        });
        
        // Header with name
        const header = new UINode(`${id}-name`, 'h3');
        header.textContent = profile.name;
        header.setStyles({
            margin: '0',
            fontSize: tokens.get('fontSizes.lg'),
            fontWeight: tokens.get('fontWeights.semibold'),
            color: tokens.get('colors.text.primary'),
            textAlign: 'center'
        });
        card.setHeader(header);
        
        // Body with bio
        card.setBody(profile.bio);
        
        // Footer with status
        const footer = new UINode(`${id}-status`, 'div');
        footer.textContent = profile.status;
        footer.setStyles({
            fontSize: tokens.get('fontSizes.sm'),
            color: tokens.get('colors.text.secondary'),
            textAlign: 'center',
            fontStyle: 'italic'
        });
        card.setFooter(footer);
        
        return card;
    }
}
