// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Skeleton - Content loading placeholder widget for Plauna
 * Provides loading placeholders with realistic shapes and shimmer animation
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { uniformDistribution } from '../../../engine/core/math/MathRandom.js';

let _skeletonSequence = 0;

function _newSkeletonId() {
    return `skeleton-${Date.now()}-${++_skeletonSequence}`;
}

export class Skeleton extends UINode {
    // Widget metadata
    static id = 'skeleton';
    static name = 'Skeleton';
    static category = 'primitive';
    static icon = '💀';
    static description = 'Skeleton loading placeholder';
    static tags = ['primitive', 'skeleton', 'loading'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            type: 'text',
            width: '100%',
            height: '20px',
            count: 1
        };
    }

    static stories() {
        return {
            'Default': { type: 'text' },
            'Avatar': { type: 'avatar', circleSize: 'md' },
            'Button': { type: 'button', buttonSize: 'md' },
            'Paragraph': { type: 'paragraph', lines: 3 }
        };
    }
    
    static create(container, options = {}) {
        const instance = new Skeleton(_newSkeletonId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newSkeletonId(), options = {}) {
        super(id, 'skeleton');
        
        // Skeleton-specific properties
        this.type = options.type || 'text'; // text, avatar, button, card, image, input, paragraph
        this.width = options.width || null; // null = auto
        this.height = options.height || null; // null = auto
        this.variant = options.variant || 'default'; // default, rounded, sharp, circle
        this.animated = options.animated !== false;
        this.lines = options.lines || 3; // for paragraph type
        this.circleSize = options.circleSize || 'md';
        this.buttonSize = options.buttonSize || 'md';
        
        // Set accessibility
        /**
         * Accessibility pattern for loading placeholders.
         *
         * ARIA attributes for screen reader support:
         * - role="presentation": Skeleton is purely decorative
         * - ariaHidden="true": Hidden from screen readers
         * - ariaLabel: Provides context for debugging tools
         *
         * Skeletons are visual loading indicators that don't convey
         * semantic information, so they should be hidden from assistive tech.
         */
        this.role = 'presentation';
        this.ariaLabel = 'Loading content placeholder';
        this.ariaHidden = 'true';
        
        // Set default styles
        this.setupStyles();
        
        // Build skeleton structure
        this.buildSkeleton();
    }
    
    setupStyles() {
        const typeStyles = this.getTypeStyles();
        const variantStyles = this.getVariantStyles();
        
        this.setStyles({
            display: 'block',
            backgroundColor: 'transparent',
            borderRadius: variantStyles.borderRadius,
            overflow: 'hidden',
            ...typeStyles,
        });
    }

    /**
     * Get shimmer animation styles for loading effect.
     *
     * Modern shimmer animation pattern:
     * - Static: Solid background color when animation is disabled
     * - Animated: Linear gradient moving across the background
     * - Background size 200% allows gradient to slide across
     * - Animation duration 1.5s for smooth, non-distracting motion
     * - willChange hint for GPU acceleration
     *
     * The gradient moves from quaternary → secondary → quaternary colors,
     * creating a light sweep effect that indicates content is loading.
     */
    getShimmerStyles() {
        if (!this.animated) {
            return {
                backgroundColor: 'var(--bg-quaternary)'
            };
        }

        return {
            backgroundColor: 'var(--bg-quaternary)',
            backgroundImage: 'linear-gradient(90deg, var(--bg-quaternary) 0%, var(--bg-secondary) 50%, var(--bg-quaternary) 100%)',
            backgroundSize: '200% 100%',
            backgroundPosition: '0% 0%',
            animation: 'skeletonShimmer 1.5s ease-in-out infinite',
            willChange: 'background-position'
        };
    }
    
    getTypeStyles() {
        const types = {
            text: {
                width: this.width || '100%',
                height: '1em',
                lineHeight: '1',
                marginBottom: '0.5em'
            },
            avatar: {
                width: this.width || this.getAvatarSize(),
                height: this.height || this.getAvatarSize(),
                borderRadius: '50%'
            },
            button: {
                width: this.width || this.getButtonSize().width,
                height: this.height || this.getButtonSize().height,
                borderRadius: this.getVariantStyles().borderRadius
            },
            card: {
                width: this.width || '100%',
                height: this.height || '120px',
                borderRadius: this.getVariantStyles().borderRadius
            },
            image: {
                width: this.width || '100%',
                height: this.height || '200px',
                borderRadius: this.getVariantStyles().borderRadius
            },
            input: {
                width: this.width || '100%',
                height: this.height || '40px',
                borderRadius: this.getVariantStyles().borderRadius
            },
            paragraph: {
                width: this.width || '100%',
                borderRadius: this.getVariantStyles().borderRadius
            }
        };
        return types[this.type] || types.text;
    }
    
    getAvatarSize() {
        const sizes = {
            xs: '24px',
            sm: '32px',
            md: '40px',
            lg: '48px',
            xl: '64px',
            '2xl': '96px'
        };
        return sizes[this.circleSize] || sizes.md;
    }
    
    getButtonSize() {
        const sizes = {
            xs: { width: '80px', height: '32px' },
            sm: { width: '100px', height: '40px' },
            md: { width: '120px', height: '48px' },
            lg: { width: '140px', height: '56px' },
            xl: { width: '160px', height: '64px' },
            '2xl': { width: '200px', height: '80px' }
        };
        return sizes[this.buttonSize] || sizes.md;
    }
    
    getVariantStyles() {
        const variants = {
            default: {
                borderRadius: 'var(--border-radius-md)'
            },
            rounded: {
                borderRadius: 'var(--border-radius-lg)'
            },
            sharp: {
                borderRadius: 'var(--border-radius-sm)'
            },
            circle: {
                borderRadius: '50%'
            }
        };
        return variants[this.variant] || variants.default;
    }
    
    getAnimationStyles() {
        if (!this.animated) {
            return {};
        }
        
        return {
            backgroundImage: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent, rgba(255, 255, 255, 0.2))',
            backgroundSize: '200% 200%',
            backgroundPosition: '0% 0%',
            animation: 'skeletonShimmer 1.5s ease-in-out infinite'
        };
    }
    
    buildSkeleton() {
        this.innerHTML = '';
        
        switch (this.type) {
            case 'text':
                this.buildTextSkeleton();
                break;
            case 'avatar':
                this.buildAvatarSkeleton();
                break;
            case 'button':
                this.buildButtonSkeleton();
                break;
            case 'card':
                this.buildCardSkeleton();
                break;
            case 'image':
                this.buildImageSkeleton();
                break;
            case 'input':
                this.buildInputSkeleton();
                break;
            case 'paragraph':
                this.buildParagraphSkeleton();
                break;
            default:
                this.buildTextSkeleton();
                break;
        }
    }
    
    buildTextSkeleton() {
        const text = new UINode(`${this.id}-text`, 'span');
        text.setStyles({
            display: 'inline-block',
            width: this.width || '100%',
            height: '1em',
            lineHeight: '1',
            borderRadius: 'var(--border-radius-full)',
            marginBottom: '0.5em'
        });
        text.setStyles(this.getShimmerStyles());
        this.appendChild(text);
    }
    
    buildAvatarSkeleton() {
        const avatar = new UINode(`${this.id}-avatar`, 'div');
        avatar.setStyles({
            width: this.getAvatarSize(),
            height: this.getAvatarSize(),
            borderRadius: '50%'
        });
        avatar.setStyles(this.getShimmerStyles());
        this.appendChild(avatar);
    }
    
    buildButtonSkeleton() {
        const button = new UINode(`${this.id}-button`, 'div');
        button.setStyles({
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: this.getButtonSize().width,
            height: this.getButtonSize().height,
            borderRadius: this.getVariantStyles().borderRadius
        });
        button.setStyles(this.getShimmerStyles());
        this.appendChild(button);
    }
    
    buildCardSkeleton() {
        const card = new UINode(`${this.id}-card`, 'div');
        card.setStyles({
            width: this.width || '100%',
            height: this.height || '120px',
            borderRadius: this.getVariantStyles().borderRadius
        });
        card.setStyles(this.getShimmerStyles());
        this.appendChild(card);
    }
    
    buildImageSkeleton() {
        const image = new UINode(`${this.id}-image`, 'div');
        image.setStyles({
            width: this.width || '100%',
            height: this.height || '200px',
            borderRadius: this.getVariantStyles().borderRadius
        });
        image.setStyles(this.getShimmerStyles());
        this.appendChild(image);
    }
    
    buildInputSkeleton() {
        const input = new UINode(`${this.id}-input`, 'div');
        input.setStyles({
            width: this.width || '100%',
            height: this.height || '40px',
            borderRadius: this.getVariantStyles().borderRadius
        });
        input.setStyles(this.getShimmerStyles());
        this.appendChild(input);
    }
    
    buildParagraphSkeleton() {
        const container = new UINode(`${this.id}-paragraph`, 'div');
        container.setStyles({
            width: this.width || '100%',
            borderRadius: this.getVariantStyles().borderRadius,
            backgroundColor: 'transparent',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '2px 0'
        });
        
        // Create multiple text lines
        for (let i = 0; i < this.lines; i++) {
            const line = new UINode(`${container.id}-line-${i}`, 'div');
            
            // Random width for more realistic appearance
            const width = this.getRandomWidth();
            line.setStyles({
                width: width + '%',
                height: '10px',
                lineHeight: '1',
                borderRadius: 'var(--border-radius-full)',
                marginBottom: '0'
            });
            line.setStyles(this.getShimmerStyles());
            
            container.appendChild(line);
        }
        
        this.appendChild(container);
    }
    
    getRandomWidth() {
        // Generate random width between 60% and 100% for more realistic skeleton appearance
        return Math.floor(uniformDistribution(60, 101, Math.random));
    }
    
    setType(type) {
        if (type !== this.type) {
            this.type = type;
            this.setupStyles();
            this.buildSkeleton();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setWidth(width) {
        if (width !== this.width) {
            this.width = width;
            this.setupStyles();
            this.buildSkeleton();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setHeight(height) {
        if (height !== this.height) {
            this.height = height;
            this.setupStyles();
            this.buildSkeleton();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setVariant(variant) {
        if (variant !== this.variant) {
            this.variant = variant;
            this.setupStyles();
            this.buildSkeleton();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setAnimated(animated) {
        if (animated !== this.animated) {
            this.animated = animated;
            this.setupStyles();
            this.buildSkeleton();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setLines(lines) {
        if (lines !== this.lines) {
            this.lines = lines;
            if (this.type === 'paragraph') {
                this.buildSkeleton();
                this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
            }
        }
    }
    
    setCircleSize(size) {
        if (size !== this.circleSize) {
            this.circleSize = size;
            if (this.type === 'avatar') {
                this.setupStyles();
                this.buildSkeleton();
                this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
            }
        }
    }
    
    setButtonSize(size) {
        if (size !== this.buttonSize) {
            this.buttonSize = size;
            if (this.type === 'button') {
                this.setupStyles();
                this.buildSkeleton();
                this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
            }
        }
    }
    
    // Static factory methods for common skeleton types
    static createTextSkeleton(id, options = {}) {
        return new Skeleton(id, {
            type: 'text',
            width: options.width || null,
            ...options
        });
    }
    
    static createAvatarSkeleton(id, options = {}) {
        return new Skeleton(id, {
            type: 'avatar',
            circleSize: options.size || 'md',
            ...options
        });
    }
    
    static createButtonSkeleton(id, options = {}) {
        return new Skeleton(id, {
            type: 'button',
            buttonSize: options.size || 'md',
            variant: options.variant || 'default',
            ...options
        });
    }
    
    static createCardSkeleton(id, options = {}) {
        return new Skeleton(id, {
            type: 'card',
            width: options.width || '100%',
            height: options.height || '120px',
            variant: options.variant || 'default',
            ...options
        });
    }
    
    static createImageSkeleton(id, options = {}) {
        return new Skeleton(id, {
            type: 'image',
            width: options.width || '100%',
            height: options.height || '200px',
            variant: options.variant || 'default',
            ...options
        });
    }
    
    static createInputSkeleton(id, options = {}) {
        return new Skeleton(id, {
            type: 'input',
            width: options.width || '100%',
            height: options.height || '40px',
            variant: options.variant || 'default',
            ...options
        });
    }
    
    static createParagraphSkeleton(id, options = {}) {
        return new Skeleton(id, {
            type: 'paragraph',
            lines: options.lines || 3,
            width: options.width || '100%',
            variant: options.variant || 'default',
            animated: options.animated !== false,
            ...options
        });
    }
    
    // CSS animations for skeleton shimmer effect
    static getCSSAnimations() {
        return `
            @keyframes skeletonShimmer {
                0% {
                    background-position: -200% 0;
                }
                100% {
                    background-position: 200% 0;
                }
            }
        `;
    }
}
