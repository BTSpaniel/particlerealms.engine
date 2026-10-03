// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Tooltip - Contextual help widget for Plauna
 * Provides positioning engine with arrow support and accessibility
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';

let _tooltipSequence = 0;

function _newTooltipId() {
    return `tooltip-${Date.now()}-${++_tooltipSequence}`;
}

export class Tooltip extends UINode {
    // Widget metadata
    static id = 'tooltip';
    static name = 'Tooltip';
    static category = 'primitive';
    static icon = '💬';
    static description = 'Tooltip hint element';
    static tags = ['primitive', 'tooltip'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            content: '',
            placement: 'top',
            delay: 200
        };
    }

    static stories() {
        return {
            'Default': { content: 'Tooltip text', placement: 'top', delay: 0 },
            'Bottom': { content: 'Bottom tooltip', placement: 'bottom', delay: 0 },
            'Left': { content: 'Left tooltip', placement: 'left', delay: 0 },
            'Right': { content: 'Right tooltip', placement: 'right', delay: 0 }
        };
    }
    
    static create(container, options = {}) {
        const instance = new Tooltip(_newTooltipId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newTooltipId(), options = {}) {
        super(id, 'tooltip');
        
        // Tooltip-specific properties
        this.content = options.content || '';
        this.placement = options.placement || 'top';
        this.variant = options.variant || 'default';
        this.size = options.size || 'md';
        this.delay = options.delay ?? 300;
        this.disabled = options.disabled || false;
        this.arrow = options.arrow !== false;
        this.trigger = options.trigger || 'hover'; // hover, focus, click, manual
        this.offset = options.offset ?? 8;
        this.showcase = options.showcase || false;
        
        // State management
        this.visible = false;
        this.targetElement = null;
        this.showTimeout = null;
        this.hideTimeout = null;
        this.cleanupHandlers = null;
        
        // Set accessibility
        /**
         * Accessibility pattern for tooltips.
         *
         * ARIA attributes for screen reader support:
         * - role="tooltip": Identifies element as a tooltip
         * - ariaHidden="true": Hidden from screen readers until shown
         * - Tooltip content is typically decorative or redundant to trigger text
         *
         * Modern tooltip pattern: content should be available through
         * other means (labels, descriptions) for full accessibility.
         */
        this.role = 'tooltip';
        this.ariaHidden = 'true';

        this.updateClassName();
        
        // Set default styles
        this.setStyles({
            position: this.showcase ? 'relative' : 'absolute',
            top: '0',
            left: '0',
            zIndex: '1001',
            pointerEvents: this.showcase ? 'auto' : 'none',
            opacity: this.showcase ? '1' : '0',
            transform: this.showcase ? 'none' : 'scale(0.8)',
            transition: 'transform 150ms ease-out, opacity 150ms ease-out, filter 150ms ease-out',
            maxWidth: '300px',
            wordWrap: 'break-word',
            display: 'inline-block',
            filter: 'drop-shadow(0 18px 36px rgba(2, 6, 23, 0.24))'
        });
        
        // Create tooltip content
        this.setupContent();
        
        // Create arrow if needed
        if (this.arrow) {
            this.setupArrow();
        }
    }

    updateClassName() {
        const variantClass = this.variant === 'default' ? 'dark' : this.variant;
        this.className = `tooltip tooltip--${this.placement} tooltip--${this.size} tooltip--${variantClass}`;
    }
    
    setupContent() {
        this.contentNode = new UINode(`${this.id}-content`, 'div');
        this.contentNode.setStyles({
            padding: '10px 14px',
            background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.84))',
            color: '#fff',
            borderRadius: '16px',
            fontSize: '13px',
            fontWeight: '600',
            lineHeight: '1.35',
            textAlign: 'center',
            boxShadow: '0 20px 48px rgba(2, 6, 23, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(148, 163, 184, 0.18)',
            position: 'relative',
            backdropFilter: 'blur(14px) saturate(140%)'
        });
        
        this.contentNode.textContent = this.content;
        this.appendChild(this.contentNode);
    }
    
    setupArrow() {
        this.arrowNode = new UINode(`${this.id}-arrow`, 'div');
        this.arrowNode.setStyles({
            position: 'absolute',
            width: '0',
            height: '0',
            borderStyle: 'solid',
            borderWidth: '6px',
            borderColor: 'transparent',
            filter: 'drop-shadow(0 4px 8px rgba(2, 6, 23, 0.16))'
        });
        this.appendChild(this.arrowNode);
    }
    
    getBackgroundColor() {
        const variants = {
            default: 'var(--text-primary)',
            primary: 'var(--color-primary-600)',
            success: 'var(--color-success)',
            warning: 'var(--color-warning)',
            error: 'var(--color-error)',
            inverse: 'var(--text-inverse)'
        };
        return variants[this.variant] || variants.default;
    }
    
    getArrowColor() {
        return this.getBackgroundColor();
    }
    
    attachTo(element) {
        if (!element || this.targetElement === element) return;
        
        // Detach from previous element
        this.detach();
        
        this.targetElement = element;
        this.ariaHidden = 'true';
        
        // Setup trigger handlers
        const handlers = [];
        
        if (this.trigger === 'hover') {
            const showHandler = () => this.scheduleShow();
            const hideHandler = () => this.scheduleHide();
            
            element.addEventListener('mouseenter', showHandler);
            element.addEventListener('mouseleave', hideHandler);
            element.addEventListener('focus', showHandler);
            element.addEventListener('blur', hideHandler);
            
            handlers.push(
                { event: 'mouseenter', handler: showHandler },
                { event: 'mouseleave', handler: hideHandler },
                { event: 'focus', handler: showHandler },
                { event: 'blur', handler: hideHandler }
            );
        } else if (this.trigger === 'focus') {
            const showHandler = () => this.show();
            const hideHandler = () => this.hide();
            
            element.addEventListener('focus', showHandler);
            element.addEventListener('blur', hideHandler);
            
            handlers.push(
                { event: 'focus', handler: showHandler },
                { event: 'blur', handler: hideHandler }
            );
        } else if (this.trigger === 'click') {
            const toggleHandler = (event) => {
                event.preventDefault();
                this.toggle();
            };
            
            element.addEventListener('click', toggleHandler);
            handlers.push({ event: 'click', handler: toggleHandler });
        }
        
        // Store cleanup function
        this.cleanupHandlers = () => {
            handlers.forEach(({ event, handler }) => {
                element.removeEventListener(event, handler);
            });
        };
        
        // Set accessibility attributes
        element.setAttribute('aria-describedby', this.id);
    }
    
    detach() {
        if (this.cleanupHandlers) {
            this.cleanupHandlers();
            this.cleanupHandlers = null;
        }
        
        if (this.targetElement) {
            this.targetElement.removeAttribute('aria-describedby');
            this.targetElement = null;
        }
        
        this.hide();
    }
    
    scheduleShow() {
        if (this.disabled) return;
        
        this.clearTimeouts();
        this.showTimeout = setTimeout(() => this.show(), this.delay);
    }
    
    scheduleHide() {
        this.clearTimeouts();
        this.hideTimeout = setTimeout(() => this.hide(), 100);
    }
    
    clearTimeouts() {
        if (this.showTimeout) {
            clearTimeout(this.showTimeout);
            this.showTimeout = null;
        }
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
    }
    
    show() {
        if (this.disabled || this.visible || (!this.targetElement && !this.showcase)) return;
        
        this.visible = true;
        this.ariaHidden = 'false';
        this.setStyle('pointerEvents', 'auto');
        this.element?.classList.add('tooltip--visible');
        if (this.element) {
            this.element.style.pointerEvents = 'auto';
            this.element.style.opacity = '1';
            this.element.style.transform = 'scale(1)';
        }
        
        // Update content if needed
        this.contentNode.textContent = this.content;
        this.contentNode.setStyle('backgroundColor', this.getBackgroundColor());
        
        // Position the tooltip
        this.updatePosition();
        
        // Animate in
        requestAnimationFrame(() => {
            this.setStyle('opacity', '1');
            this.setStyle('transform', 'scale(1)');
        });
        
        // Emit show event
        this.dispatchEvent({ type: 'show', bubbles: false });
    }
    
    hide() {
        if (!this.visible) return;
        
        this.visible = false;
        this.ariaHidden = 'true';
        this.setStyle('pointerEvents', 'none');
        this.element?.classList.remove('tooltip--visible');
        if (this.element) {
            this.element.style.pointerEvents = 'none';
            this.element.style.opacity = '0';
            this.element.style.transform = 'scale(0.8)';
        }
        
        // Animate out
        this.setStyle('opacity', '0');
        this.setStyle('transform', 'scale(0.8)');
        
        // Emit hide event
        this.dispatchEvent({ type: 'hide', bubbles: false });
    }
    
    toggle() {
        if (this.visible) {
            this.hide();
        } else {
            this.show();
        }
    }
    
    updatePosition() {
        if (!this.targetElement || !this.element) return;
        
        const targetRect = this.targetElement.getBoundingClientRect();
        const tooltipRect = this.element.getBoundingClientRect();
        
        // Calculate position
        const position = this.calculatePosition(targetRect, tooltipRect);
        
        // Apply position
        this.setStyle('left', `${position.x}px`);
        this.setStyle('top', `${position.y}px`);
        this.element.style.left = `${position.x}px`;
        this.element.style.top = `${position.y}px`;
        
        // Update arrow if present
        if (this.arrow && this.arrowNode) {
            this.updateArrow(position.placement, targetRect, tooltipRect);
        }
    }
    
    calculatePosition(targetRect, tooltipRect) {
        const scrollX = window.pageXOffset;
        const scrollY = window.pageYOffset;
        const { offset } = this;
        
        // Available positions
        const positions = {
            top: {
                x: targetRect.left + (targetRect.width - tooltipRect.width) / 2 + scrollX,
                y: targetRect.top - tooltipRect.height - offset + scrollY
            },
            bottom: {
                x: targetRect.left + (targetRect.width - tooltipRect.width) / 2 + scrollX,
                y: targetRect.bottom + offset + scrollY
            },
            left: {
                x: targetRect.left - tooltipRect.width - offset + scrollX,
                y: targetRect.top + (targetRect.height - tooltipRect.height) / 2 + scrollY
            },
            right: {
                x: targetRect.right + offset + scrollX,
                y: targetRect.top + (targetRect.height - tooltipRect.height) / 2 + scrollY
            }
        };
        
        // Check viewport boundaries and adjust if needed
        const viewport = {
            width: window.innerWidth,
            height: window.innerHeight,
            scrollTop: scrollY,
            scrollLeft: scrollX
        };
        
        let placement = this.placement;
        let position = positions[placement];
        
        // Adjust if tooltip would go outside viewport
        if (placement === 'top' && position.y < viewport.scrollTop) {
            placement = 'bottom';
            position = positions.bottom;
        } else if (placement === 'bottom' && position.y + tooltipRect.height > viewport.scrollTop + viewport.height) {
            placement = 'top';
            position = positions.top;
        } else if (placement === 'left' && position.x < viewport.scrollLeft) {
            placement = 'right';
            position = positions.right;
        } else if (placement === 'right' && position.x + tooltipRect.width > viewport.scrollLeft + viewport.width) {
            placement = 'left';
            position = positions.left;
        }
        
        // Ensure tooltip stays within viewport horizontally
        if (position.x < viewport.scrollLeft + 10) {
            position.x = viewport.scrollLeft + 10;
        } else if (position.x + tooltipRect.width > viewport.scrollLeft + viewport.width - 10) {
            position.x = viewport.scrollLeft + viewport.width - tooltipRect.width - 10;
        }
        
        // Ensure tooltip stays within viewport vertically
        if (position.y < viewport.scrollTop + 10) {
            position.y = viewport.scrollTop + 10;
        } else if (position.y + tooltipRect.height > viewport.scrollTop + viewport.height - 10) {
            position.y = viewport.scrollTop + viewport.height - tooltipRect.height - 10;
        }
        
        return { ...position, placement };
    }
    
    updateArrow(placement, targetRect, tooltipRect) {
        const arrowSize = 5;
        const arrowColor = this.getArrowColor();
        
        // Reset arrow styles
        this.arrowNode.setStyles({
            top: 'auto',
            left: 'auto',
            right: 'auto',
            bottom: 'auto',
            borderWidth: `${arrowSize}px`,
            borderColor: 'transparent'
        });
        
        switch (placement) {
            case 'top':
                this.arrowNode.setStyles({
                    bottom: `-${arrowSize}px`,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    borderTopColor: arrowColor
                });
                break;
            case 'bottom':
                this.arrowNode.setStyles({
                    top: `-${arrowSize}px`,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    borderBottomColor: arrowColor
                });
                break;
            case 'left':
                this.arrowNode.setStyles({
                    right: `-${arrowSize}px`,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    borderLeftColor: arrowColor
                });
                break;
            case 'right':
                this.arrowNode.setStyles({
                    left: `-${arrowSize}px`,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    borderRightColor: arrowColor
                });
                break;
        }
    }
    
    setContent(content) {
        this.content = content;
        if (this.visible) {
            this.contentNode.textContent = content;
            this.updatePosition();
        }
        this.markDirty(DIRTY.PAINT);
    }
    
    setPlacement(placement) {
        this.placement = placement;
        this.updateClassName();
        if (this.visible) {
            this.updatePosition();
        }
        this.markDirty(DIRTY.PAINT);
    }
    
    setVariant(variant) {
        this.variant = variant;
        this.updateClassName();
        const bgColor = this.getBackgroundColor();
        this.contentNode.setStyle('backgroundColor', bgColor);
        if (this.arrow && this.visible) {
            this.updatePosition(); // Updates arrow color
        }
        this.markDirty(DIRTY.PAINT);
    }
    
    setDisabled(disabled) {
        this.disabled = disabled;
        if (disabled) {
            this.hide();
        }
        this.markDirty(DIRTY.ACCESSIBILITY);
    }
    
    destroy() {
        this.detach();
        this.clearTimeouts();
        super.destroy();
    }
}
