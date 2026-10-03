// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Modal - Overlay dialog widget for Plauna
 * Provides modal dialogs with focus trapping, accessibility, and backdrop
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';

let _modalSequence = 0;

function _newModalId() {
    return `modal-${Date.now()}-${++_modalSequence}`;
}

export class Modal extends UINode {
    // Widget metadata
    static id = 'modal';
    static name = 'Modal';
    static category = 'primitive';
    static icon = '📦';
    static description = 'Modal dialog overlay';
    static tags = ['primitive', 'modal', 'dialog'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            title: '',
            content: '',
            open: false,
            size: 'md',
            showcase: false // Use relative positioning for widget gallery
        };
    }

    static stories() {
        return {
            'Default': { title: 'Modal Dialog', content: 'This is a modal dialog content.', open: true, showcase: true },
            'Small': { title: 'Small Modal', content: 'Small modal content.', size: 'sm', open: true, showcase: true },
            'Large': { title: 'Large Modal', content: 'Large modal content with more space.', size: 'lg', open: true, showcase: true }
        };
    }
    
    static create(container, options = {}) {
        const instance = new Modal(_newModalId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newModalId(), options = {}) {
        super(id, 'modal');

        // Modal-specific properties
        this.title = options.title || '';
        this.content = options.content || '';
        this.open = options.open || false;
        this.closable = options.closable !== false;
        this.size = options.size || 'md';
        this.variant = options.variant || 'default';
        this.showBackdrop = options.showBackdrop !== false;
        this.closeOnEscape = options.closeOnEscape !== false;
        this.closeOnBackdrop = options.closeOnBackdrop !== false;
        this.showcase = options.showcase || false; // Use relative positioning for showcase

        // Focus management
        /**
         * Focus management for modal dialogs.
         *
         * Modern modal accessibility pattern:
         * - previousFocus: Stores element that had focus before modal opened
         * - focusableElements: List of focusable elements within modal
         * - initialFocusElement: First element to focus when modal opens
         *
         * This enables focus trapping: keyboard navigation stays within modal
         * and focus is restored to previous element when modal closes.
         */
        this.previousFocus = null;
        this.focusableElements = [];
        this.initialFocusElement = null;

        // Set accessibility
        /**
         * Accessibility pattern for modal dialogs.
         *
         * ARIA attributes for screen reader support:
         * - role="dialog": Identifies element as a dialog
         * - ariaModal="true": Indicates content outside modal is inert
         * - ariaLabelledBy: References title element for description
         * - ariaDescribedBy: References content element for description
         */
        this.role = 'dialog';
        this.ariaModal = 'true';
        this.ariaLabelledBy = `${this.id}-title`;
        this.ariaDescribedBy = `${this.id}-content`;

        // Set default styles for modal container
        const positionStyle = this.showcase ? 'relative' : 'fixed';
        this.setStyles({
            position: positionStyle,
            top: this.showcase ? 'auto' : '0',
            left: this.showcase ? 'auto' : '0',
            right: this.showcase ? 'auto' : '0',
            bottom: this.showcase ? 'auto' : '0',
            display: this.open ? 'flex' : 'none',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: this.showcase ? '1' : '1000',
            outline: 'none',
            width: this.showcase ? '100%' : 'auto',
            height: this.showcase ? '100%' : 'auto',
            backgroundColor: this.showcase ? 'rgba(0, 0, 0, 0.3)' : 'transparent'
        });
        
        // Create backdrop
        /**
         * Modern backdrop pattern for modal dialogs.
         *
         * Backdrop provides visual separation from page content:
         * - Semi-transparent background (rgba(0, 0, 0, 0.5)) for dimming
         * - Backdrop filter blur for glassy layered effect
         * - Full coverage (absolute positioning) to obscure underlying content
         * - Click handler for backdrop dismissal if enabled
         */
        if (this.showBackdrop && !this.showcase) {
            this.backdrop = new UINode(`${this.id}-backdrop`, 'div');
            this.backdrop.setStyles({
                position: 'absolute',
                top: '0',
                left: '0',
                right: '0',
                bottom: '0',
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                backdropFilter: 'blur(2px)',
                zIndex: '999'
            });
            this.appendChild(this.backdrop);
        }
        
        // Create modal panel
        this.panel = new UINode(`${this.id}-panel`, 'div');
        this.setupPanelStyles();
        this.appendChild(this.panel);
        
        // Setup event handlers
        this.setupEventHandlers();

        // Initialize modal content
        this.updateContent();

        // Apply open state
        this.updateOpenState();
    }
    
    setupPanelStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();

        this.panel.setStyles({
            position: this.showcase ? 'relative' : 'relative',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-medium)',
            borderRadius: 'var(--border-radius-lg)',
            boxShadow: 'var(--shadow-xl)',
            maxWidth: this.showcase ? '100%' : '90vw',
            maxHeight: this.showcase ? '100%' : '90vh',
            overflow: 'hidden',
            transform: 'scale(0.95)',
            opacity: '0',
            transition: 'all 200ms ease-out',
            ...sizeStyles,
            ...variantStyles
        });
    }
    
    getSizeStyles() {
        const sizes = this.showcase ? {
            xs: { width: '100%', minHeight: '120px' },
            sm: { width: '100%', minHeight: '140px' },
            md: { width: '100%', minHeight: '160px' },
            lg: { width: '100%', minHeight: '180px' },
            xl: { width: '100%', minHeight: '200px' },
            full: { width: '100%', height: '100%', minHeight: 'auto' }
        } : {
            xs: { width: '320px', minHeight: '160px' },
            sm: { width: '400px', minHeight: '200px' },
            md: { width: '500px', minHeight: '280px' },
            lg: { width: '700px', minHeight: '400px' },
            xl: { width: '900px', minHeight: '500px' },
            full: { width: '95vw', height: '95vh', minHeight: 'auto' }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        const variants = {
            default: {
                border: '1px solid var(--border-medium)'
            },
            danger: {
                border: '1px solid var(--color-error)',
                boxShadow: '0 0 0 1px var(--color-error), var(--shadow-xl)'
            },
            warning: {
                border: '1px solid var(--color-warning)',
                boxShadow: '0 0 0 1px var(--color-warning), var(--shadow-xl)'
            },
            success: {
                border: '1px solid var(--color-success)',
                boxShadow: '0 0 0 1px var(--color-success), var(--shadow-xl)'
            }
        };
        return variants[this.variant] || variants.default;
    }

    updateOpenState() {
        // Update container display
        this.setStyle('display', this.open ? 'flex' : 'none');

        // Update backdrop visibility (only if it exists)
        if (this.backdrop) {
            this.backdrop.setStyle('display', this.open ? 'block' : 'none');
        }

        // Update panel animation state
        if (this.open) {
            this.panel.setStyle('opacity', '1');
            this.panel.setStyle('transform', 'scale(1)');
        } else {
            this.panel.setStyle('opacity', '0');
            this.panel.setStyle('transform', 'scale(0.95)');
        }
    }

    open() {
        if (!this.open) {
            this.open = true;
            this.updateOpenState();
            this.dispatchEvent({ type: 'open', bubbles: true });
        }
    }

    close() {
        if (this.open) {
            this.open = false;
            this.updateOpenState();
            this.dispatchEvent({ type: 'close', bubbles: true });
        }
    }

    setupEventHandlers() {
        // Escape key handler
        if (this.closeOnEscape) {
            this.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && this.open) {
                    this.close();
                }
            });
        }

        // Backdrop click handler (skip in showcase mode)
        if (this.showBackdrop && this.backdrop && !this.showcase && this.closeOnBackdrop) {
            this.backdrop.addEventListener('click', () => {
                if (this.open) {
                    this.close();
                }
            });
        }

        // Focus trap handler
        this.addEventListener('keydown', (event) => {
            if (!this.open) return;

            if (event.key === 'Tab') {
                this.trapFocus(event);
            }
        });
    }
    
    updateContent() {
        this.panel.innerHTML = '';
        
        // Header
        if (this.title || this.closable) {
            const header = new UINode(`${this.id}-header`, 'header');
            header.setStyles({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--spacing-lg) var(--spacing-xl)',
                borderBottom: '1px solid var(--border-light)',
                backgroundColor: 'var(--bg-secondary)'
            });
            
            if (this.title) {
                const title = new UINode(`${this.id}-title`, 'h2');
                title.setStyles({
                    margin: '0',
                    fontSize: 'var(--font-size-lg)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--text-primary)',
                    lineHeight: 1.2
                });
                title.textContent = this.title;
                header.appendChild(title);
            }
            
            if (this.closable) {
                const closeButton = new UINode(`${this.id}-close`, 'button');
                closeButton.setStyles({
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '32px',
                    height: '32px',
                    border: 'none',
                    borderRadius: 'var(--border-radius-md)',
                    backgroundColor: 'transparent',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '18px',
                    lineHeight: 1,
                    transition: 'all 150ms ease'
                });
                
                closeButton.addEventListener('click', () => this.close());
                closeButton.addEventListener('mouseenter', () => {
                    closeButton.setStyle('backgroundColor', 'var(--bg-tertiary)');
                    closeButton.setStyle('color', 'var(--text-primary)');
                });
                closeButton.addEventListener('mouseleave', () => {
                    closeButton.setStyle('backgroundColor', 'transparent');
                    closeButton.setStyle('color', 'var(--text-secondary)');
                });
                
                closeButton.innerHTML = '×';
                closeButton.ariaLabel = 'Close modal';
                header.appendChild(closeButton);
            }
            
            this.panel.appendChild(header);
        }
        
        // Content
        if (this.content) {
            const content = new UINode(`${this.id}-content`, 'div');
            content.setStyles({
                padding: 'var(--spacing-xl)',
                flex: '1',
                overflow: 'auto',
                color: 'var(--text-primary)',
                fontSize: 'var(--font-size-md)',
                lineHeight: 'var(--line-height-normal)'
            });
            
            if (typeof this.content === 'string') {
                content.textContent = this.content;
            } else if (this.content instanceof UINode) {
                content.appendChild(this.content);
            }
            
            this.panel.appendChild(content);
        }
    }
    
    trapFocus(event) {
        this.updateFocusableElements();
        
        if (this.focusableElements.length === 0) return;
        
        const firstElement = this.focusableElements[0];
        const lastElement = this.focusableElements[this.focusableElements.length - 1];
        
        if (event.shiftKey) {
            if (document.activeElement === firstElement) {
                event.preventDefault();
                lastElement.focus();
            }
        } else {
            if (document.activeElement === lastElement) {
                event.preventDefault();
                firstElement.focus();
            }
        }
    }
    
    updateFocusableElements() {
        // Get all focusable elements within the modal
        const selector = [
            'button:not([disabled])',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            'a[href]',
            '[tabindex]:not([tabindex="-1"])',
            '[contenteditable="true"]'
        ].join(', ');
        
        this.focusableElements = Array.from(
            this.panel.element?.querySelectorAll(selector) || []
        ).filter(element => {
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
        });
    }
    
    open() {
        if (this.open) return;
        
        this.open = true;
        this.setStyle('display', 'flex');
        this.markDirty(DIRTY.PAINT);
        
        // Store previous focus
        this.previousFocus = document.activeElement;
        
        // Animate in
        requestAnimationFrame(() => {
            this.panel.setStyle('transform', 'scale(1)');
            this.panel.setStyle('opacity', '1');
        });
        
        // Set initial focus
        requestAnimationFrame(() => {
            this.updateFocusableElements();
            if (this.initialFocusElement && this.focusableElements.includes(this.initialFocusElement)) {
                this.initialFocusElement.focus();
            } else if (this.focusableElements.length > 0) {
                this.focusableElements[0].focus();
            } else {
                this.element?.focus();
            }
        });
        
        // Prevent body scroll
        document.body.style.overflow = 'hidden';
        
        // Emit open event
        this.dispatchEvent({ type: 'open', bubbles: false });
    }
    
    close() {
        if (!this.open) return;
        
        this.open = false;
        
        // Animate out
        this.panel.setStyle('transform', 'scale(0.95)');
        this.panel.setStyle('opacity', '0');
        
        setTimeout(() => {
            this.setStyle('display', 'none');
            this.markDirty(DIRTY.PAINT);
        }, 200);
        
        // Restore focus
        if (this.previousFocus && this.previousFocus.focus) {
            this.previousFocus.focus();
        }
        
        // Restore body scroll
        document.body.style.overflow = '';
        
        // Emit close event
        this.dispatchEvent({ type: 'close', bubbles: false });
    }
    
    setTitle(title) {
        this.title = title;
        this.updateContent();
        this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
    }
    
    setContent(content) {
        this.content = content;
        this.updateContent();
        this.markDirty(DIRTY.PAINT);
    }
    
    setSize(size) {
        this.size = size;
        this.setupPanelStyles();
        this.markDirty(DIRTY.PAINT);
    }
    
    setVariant(variant) {
        this.variant = variant;
        this.setupPanelStyles();
        this.markDirty(DIRTY.PAINT);
    }
    
    setInitialFocusElement(element) {
        this.initialFocusElement = element;
    }
    
    destroy() {
        if (this.open) {
            this.close();
        }
        super.destroy();
    }
}
