// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Avatar - User representation widget for Plauna
 * Provides image, icon, and text fallback with status indicators
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

let _avatarSequence = 0;

function _newAvatarId() {
    return `avatar-${Date.now()}-${++_avatarSequence}`;
}

export class Avatar extends UINode {
    // Widget metadata
    static id = 'avatar';
    static name = 'Avatar';
    static category = 'primitive';
    static icon = '👤';
    static description = 'User avatar display';
    static tags = ['primitive', 'avatar', 'user'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            src: '',
            initials: '',
            size: 'md',
            status: null
        };
    }

    static stories() {
        return {
            'Default':   { name: 'Alex B',    size: 'md' },
            'Small':     { name: 'Sam M',     size: 'sm' },
            'Large':     { name: 'Lee G',     size: 'lg' },
            'Online':    { name: 'Ana K',     size: 'md', status: 'online' },
            'Offline':   { name: 'Omar F',    size: 'md', status: 'offline' },
        };
    }
    
    static create(container, options = {}) {
        const instance = new Avatar(_newAvatarId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newAvatarId(), options = {}) {
        super(id, 'avatar');
        
        // Avatar-specific properties
        this.src = options.src || null;
        this.alt = options.alt || '';
        this.name = options.name || '';
        this.icon = options.icon || null;
        this.size = options.size || 'md';
        this.shape = options.shape || 'circle'; // circle, square, rounded
        this.status = options.status || null; // online, offline, busy, away
        this.showStatus = options.showStatus !== false;
        this.fallback = options.fallback || 'initials'; // initials, icon, placeholder
        
        // Track if image has successfully loaded
        this.imageLoaded = false;

        // Set accessibility
        this.role = 'img';
        this.ariaLabel = this.generateAriaLabel();
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build avatar structure
        this.buildAvatar();
        
        // Load image if provided
        if (this.src) {
            this.loadImage();
        }
    }
    
    /**
     * Setup modern avatar surface styling.
     *
     * Modern design pattern: soft card-like surface with subtle border and shadow.
     * - Border provides definition without harshness
     * - Box shadow adds depth and lift from background
     * - Backdrop filter creates glassy blur effect behind avatar
     * - Transitions are set on transform, shadow, border, and background for smooth state changes
     *
     * This treatment aligns with modern avatar/profile patterns that use subtle elevation
     * rather than flat colors, making the avatar feel more tactile and interactive.
     */
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const shapeStyles = this.getShapeStyles();
        
        this.setStyles({
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            background: 'linear-gradient(180deg, rgba(59, 130, 246, 0.16), rgba(15, 23, 42, 0.08))',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 10px 24px rgba(15, 23, 42, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.10)',
            backdropFilter: 'saturate(1.15) blur(10px)',
            color: 'var(--text-primary)',
            fontFamily: 'inherit',
            fontWeight: '700',
            textAlign: 'center',
            textDecoration: 'none',
            overflow: 'hidden',
            userSelect: 'none',
            transition: 'transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease, background-color 160ms ease',
            outline: 'none',
            ...sizeStyles,
            ...shapeStyles
        });
    }
    
    /**
     * Get size-specific dimensions and typography.
     *
     * Size scale follows modern UI conventions with consistent spacing:
     * - xs: 24px - Small avatars for compact lists (e.g., user menus)
     * - sm: 32px - Small avatars for inline mentions
     * - md: 40px - Default size for most use cases
     * - lg: 48px - Large avatars for profile headers
     * - xl: 64px - Extra large for hero sections
     * - 2xl: 96px - Extra extra large for detailed profile views
     *
     * Font size scales proportionally with container size for
     * consistent visual weight across all sizes.
     */
    getSizeStyles() {
        const sizes = {
            xs: {
                width: '24px',
                height: '24px',
                fontSize: 'var(--font-size-xs)',
                lineHeight: '24px'
            },
            sm: {
                width: '32px',
                height: '32px',
                fontSize: 'var(--font-size-sm)',
                lineHeight: '32px'
            },
            md: {
                width: '40px',
                height: '40px',
                fontSize: 'var(--font-size-md)',
                lineHeight: '40px'
            },
            lg: {
                width: '48px',
                height: '48px',
                fontSize: 'var(--font-size-lg)',
                lineHeight: '48px'
            },
            xl: {
                width: '64px',
                height: '64px',
                fontSize: 'var(--font-size-xl)',
                lineHeight: '64px'
            },
            '2xl': {
                width: '96px',
                height: '96px',
                fontSize: 'var(--font-size-2xl)',
                lineHeight: '96px'
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    /**
     * Get shape-specific border-radius values.
     *
     * Shape variants provide flexibility for different UI contexts:
     * - circle: 50% border-radius for classic circular profile images
     * - square: Small border-radius for modern card-like avatars
     * - rounded: Medium border-radius for softer square profiles
     *
     * Uses design tokens for consistent border-radius values across
     * the entire UI system.
     */
    getShapeStyles() {
        const shapes = {
            circle: {
                borderRadius: '50%'
            },
            square: {
                borderRadius: 'var(--border-radius-sm)'
            },
            rounded: {
                borderRadius: 'var(--border-radius-md)'
            }
        };
        return shapes[this.shape] || shapes.circle;
    }
    
    /**
     * Setup modern interaction event handlers.
     *
     * Implements modern accessibility and interaction patterns:
     * - Hover state: subtle scale-up and shadow elevation for tactile feedback
     * - Focus state: clear focus ring with primary color for keyboard navigation visibility
     * - Base shadow is restored on blur to maintain modern surface appearance
     * - Border is preserved across states (not cleared on blur) for consistent definition
     *
     * The focus ring uses a dual-layer shadow (outer ring + inner shadow) for high
     * visibility against both light and dark backgrounds, following WCAG 2.1 guidelines.
     */
    setupEventHandlers() {
        // Mouse enter: subtle scale and elevated shadow for tactile hover feedback
        this.addEventListener('mouseenter', () => {
            this.setStyle('transform', 'scale(1.05)');
            this.setStyle('boxShadow', 'var(--shadow-md)');
        });
        
        // Mouse leave: restore base scale and maintain subtle base shadow
        this.addEventListener('mouseleave', () => {
            this.setStyle('transform', 'scale(1)');
            this.setStyle('boxShadow', 'var(--shadow-sm)');
        });
        
        // Focus: clear focus ring with primary color and elevated shadow
        // Uses dual-layer shadow for visibility across backgrounds
        this.addEventListener('focus', () => {
            this.setStyle('transform', 'scale(1.05)');
            this.setStyle('boxShadow', '0 0 0 3px rgba(14, 165, 233, 0.18), var(--shadow-md)');
            this.setStyle('border', '1px solid rgba(14, 165, 233, 0.45)');
        });
        
        // Blur: restore base surface appearance with subtle shadow and neutral border
        this.addEventListener('blur', () => {
            this.setStyle('transform', 'scale(1)');
            this.setStyle('boxShadow', 'var(--shadow-sm)');
            this.setStyle('border', '1px solid rgba(148, 163, 184, 0.18)');
        });
    }
    
    /**
     * Build the avatar's DOM structure.
     *
     * Layered structure for flexible avatar rendering:
     * 1. Container: Base element with surface styling and event handlers
     * 2. Content layer: Image, icon, or initials (mutually exclusive)
     * 3. Status indicator: Optional dot in corner for presence (online/offline/busy)
     *
     * This pattern allows avatars to gracefully degrade from images
     * to icons to text based on availability and preferences.
     */
    buildAvatar() {
        this.innerHTML = '';
        
        // Create avatar content container
        this.content = new UINode(`${this.id}-content`, 'div');
        this.content.setStyles({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            position: 'relative'
        });
        this.appendChild(this.content);
        
        // Create status indicator
        if (this.showStatus) {
            this.createStatusIndicator();
        }
        
        // Update content
        this.updateContent();
    }

    createStatusIndicator() {
        if (this.statusIndicator) {
            return this.statusIndicator;
        }

        this.statusIndicator = new UINode(`${this.id}-status`, 'div');
        this.statusIndicator.setStyles({
            position: 'absolute',
            bottom: '0',
            right: '0',
            width: this.getStatusSize(),
            height: this.getStatusSize(),
            borderRadius: '50%',
            border: '2px solid var(--bg-primary)',
            backgroundColor: this.getStatusColor(),
            zIndex: '1'
        });
        this.appendChild(this.statusIndicator);
        return this.statusIndicator;
    }
    
    getStatusSize() {
        const statusSizes = {
            xs: '8px',
            sm: '10px',
            md: '12px',
            lg: '14px',
            xl: '16px',
            '2xl': '20px'
        };
        return statusSizes[this.size] || statusSizes.md;
    }
    
    getStatusColor() {
        const statusColors = {
            online: 'var(--color-success)',
            offline: 'var(--text-disabled)',
            busy: 'var(--color-error)',
            away: 'var(--color-warning)',
            focus: 'var(--color-primary-500)'
        };
        return statusColors[this.status] || 'transparent';
    }
    
    updateContent() {
        this.content.innerHTML = '';
        
        if (this.imageLoaded && !this.hasState(NODE_STATE.ERROR)) {
            // Show image
            const img = new UINode(`${this.id}-img`, 'img');
            img.setStyles({
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block'
            });
            // Store src/alt in userData for later DOM access
            img.userData.src = this.src;
            img.userData.alt = this.alt || this.name;
            img.userData.onerror = () => this.handleImageError();
            this.content.appendChild(img);
        } else {
            // Show fallback
            this.renderFallback();
        }
    }
    
    renderFallback() {
        let fallbackContent = null;
        
        switch (this.fallback) {
            case 'initials':
                fallbackContent = this.renderInitials();
                break;
            case 'icon':
                fallbackContent = this.renderIcon();
                break;
            case 'placeholder':
                fallbackContent = this.renderPlaceholder();
                break;
            default:
                fallbackContent = this.renderInitials();
        }
        
        if (fallbackContent) {
            this.content.appendChild(fallbackContent);
        }
    }
    
    renderInitials() {
        const initials = this.getInitials();
        const text = new UINode(`${this.id}-initials`, 'span');
        text.textContent = initials;
        text.setStyles({
            fontSize: 'inherit',
            fontWeight: 'inherit',
            color: 'inherit',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            textShadow: '0 1px 1px rgba(15, 23, 42, 0.22)'
        });
        return text;
    }
    
    renderIcon() {
        if (!this.icon) {
            return this.renderPlaceholder();
        }
        
        const icon = new UINode(`${this.id}-icon`, 'span');
        icon.textContent = this.icon;
        icon.setStyles({
            fontSize: '60%',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textShadow: '0 1px 1px rgba(255, 255, 255, 0.18)'
        });
        return icon;
    }
    
    renderPlaceholder() {
        const placeholder = new UINode(`${this.id}-placeholder`, 'span');
        placeholder.textContent = '?';
        placeholder.setStyles({
            fontSize: 'inherit',
            fontWeight: 'inherit',
            color: 'var(--text-secondary)',
            opacity: '0.85'
        });
        return placeholder;
    }
    
    getInitials() {
        if (!this.name) {
            return '?';
        }
        
        const names = this.name.trim().split(/\s+/);
        if (names.length === 1) {
            return names[0].charAt(0).toUpperCase();
        } else {
            return (names[0].charAt(0) + names[names.length - 1].charAt(0)).toUpperCase();
        }
    }
    
    /**
     * Load avatar image asynchronously.
     *
     * Async image loading pattern with error handling:
     * - Creates Image object to preload image before rendering
     * - Sets onload handler to mark image as loaded and update content
     * - Sets onerror handler to fall back to initials/icon/placeholder
     * - Updates dirty flags to trigger re-render when image loads or fails
     *
     * This pattern ensures avatars always display something, even if
     * the image fails to load or the network is slow.
     */
    loadImage() {
        if (!this.src) return;
        
        const img = new Image();
        img.onload = () => {
            this.imageLoaded = true;
            this.setState(NODE_STATE.ERROR, false);
            this.updateContent();
            this.markDirty(DIRTY.PAINT);
        };
        img.onerror = () => {
            this.handleImageError();
        };
        img.src = this.src;
    }
    
    /**
     * Handle image loading errors.
     *
     * Fallback strategy when image fails to load:
     * - Marks image as not loaded and error state
     * - Triggers content update to fall back to initials/icon/placeholder
     * - Updates dirty flags to re-render with fallback content
     *
     * This follows the progressive enhancement pattern: try the best
     * option (image), then fall back to alternatives (initials, icon, placeholder).
     */
    handleImageError() {
        this.imageLoaded = false;
        this.setState(NODE_STATE.ERROR, true);
        this.updateContent();
        this.markDirty(DIRTY.PAINT);
    }
    
    /**
     * Generate accessible label for screen readers.
     *
     * Modern accessibility pattern: uses fallback chain for descriptive labels.
     * - Prefers explicit name (user's display name)
     * - Falls back to alt text (image description)
     * - Falls back to initials (generated from name) for avatars without alt
     * - Includes shape for context (circle/square/rounded)
     * - Includes status for presence information
     *
     * This ensures screen readers always have meaningful text even when
     * images fail to load or alt text is omitted, following WCAG 2.1 guidelines.
     */
    generateAriaLabel() {
        const parts = [];
        if (this.name) parts.push(this.name);
        else if (this.alt) parts.push(this.alt);
        else parts.push(this.getInitials());
        if (this.shape) parts.push(this.shape);
        if (this.status) parts.push(`status: ${this.status}`);
        return parts.join(', ');
    }
    
    setSrc(src, alt = '') {
        this.src = src;
        this.alt = alt || this.alt;
        this.imageLoaded = false;
        this.setState(NODE_STATE.ERROR, false);
        
        if (src) {
            this.loadImage();
        } else {
            this.updateContent();
        }
        
        this.ariaLabel = this.generateAriaLabel();
        this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
    }
    
    setName(name) {
        this.name = name;
        this.ariaLabel = this.generateAriaLabel();
        
        if (!this.imageLoaded || this.hasState(NODE_STATE.ERROR)) {
            this.updateContent();
        }
        
        this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
    }
    
    setIcon(icon) {
        this.icon = icon;
        if (!this.imageLoaded || this.hasState(NODE_STATE.ERROR)) {
            this.updateContent();
        }
        this.markDirty(DIRTY.PAINT);
    }
    
    setSize(size) {
        this.size = size;
        this.setupStyles();
        
        // Update status indicator size
        if (this.statusIndicator) {
            this.statusIndicator.setStyle('width', this.getStatusSize());
            this.statusIndicator.setStyle('height', this.getStatusSize());
        }
        
        this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
    }
    
    setShape(shape) {
        this.shape = shape;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
    }
    
    setStatus(status) {
        this.status = status;
        this.ariaLabel = this.generateAriaLabel();
        
        if (this.statusIndicator) {
            if (status) {
                this.statusIndicator.setStyle('display', 'block');
                this.statusIndicator.setStyle('backgroundColor', this.getStatusColor());
            } else {
                this.statusIndicator.setStyle('display', 'none');
            }
        }
        
        this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
    }
    
    setShowStatus(showStatus) {
        this.showStatus = showStatus;
        
        if (showStatus) {
            const indicator = this.createStatusIndicator();
            indicator.setStyle('display', this.status ? 'block' : 'none');
            indicator.setStyle('width', this.getStatusSize());
            indicator.setStyle('height', this.getStatusSize());
            if (this.status) {
                indicator.setStyle('backgroundColor', this.getStatusColor());
            }
        } else if (this.statusIndicator) {
            this.statusIndicator.setStyle('display', 'none');
        }
        
        this.markDirty(DIRTY.PAINT);
    }
    
    setFallback(fallback) {
        this.fallback = fallback;
        if (!this.imageLoaded || this.hasState(NODE_STATE.ERROR)) {
            this.updateContent();
        }
        this.markDirty(DIRTY.PAINT);
    }
    
    // Static factory methods for common avatar types
    static create(container, options = {}) {
        const id = options.id || _newAvatarId();
        const avatar = new Avatar(id, options);
        if (container) {
            container.appendChild(avatar.element);
        }
        return avatar;
    }
    
    static getDefaultOptions() {
        return {
            src: null,
            name: '',
            size: 'md',
            shape: 'circle',
            fallback: 'initials'
        };
    }
    
    static createUserAvatar(id, user, options = {}) {
        return new Avatar(id, {
            src: user.avatar,
            name: user.name,
            status: user.status,
            size: options.size || 'md',
            shape: options.shape || 'circle',
            ...options
        });
    }
    
    static createTeamAvatar(id, members, options = {}) {
        const avatar = new Avatar(id, {
            size: options.size || 'lg',
            shape: 'rounded',
            fallback: 'icon',
            icon: '👥',
            ...options
        });
        
        // For team avatars, you could implement stacked avatars
        // This is a simplified version that shows a group icon
        return avatar;
    }
    
    static createInitialsAvatar(id, name, options = {}) {
        return new Avatar(id, {
            name: name,
            fallback: 'initials',
            size: options.size || 'md',
            shape: options.shape || 'circle',
            ...options
        });
    }
}
