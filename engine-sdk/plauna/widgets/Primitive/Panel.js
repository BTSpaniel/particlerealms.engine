// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Panel - Basic container widget for Plauna
 * Provides a container for other UI elements with styling and layout options
 */

import { UINode, DIRTY } from '../../core/UINode.js';

let _panelSequence = 0;

function _newPanelId() {
    return `panel-${Date.now()}-${++_panelSequence}`;
}

export class Panel extends UINode {
    // Widget metadata
    static id = 'panel-primitive';
    static name = 'Panel';
    static category = 'primitive';
    static icon = '📋';
    static description = 'Primitive panel container';
    static tags = ['primitive', 'panel', 'container'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            title: '',
            variant: 'default',
            collapsible: false
        };
    }

    static stories() {
        return {
            'Default': { title: 'Panel', content: 'Panel content area', showcase: true, closable: false, variant: 'elevated' },
            'Large': { title: 'Large Panel', content: 'Larger content area for layout testing.', showcase: true, closable: false, variant: 'elevated' }
        };
    }
    
    static create(container, options = {}) {
        const instance = new Panel(_newPanelId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newPanelId(), options = {}) {
        super(id, 'panel');
        
        // Panel-specific properties
        this.title = options.title || '';
        this.icon = options.icon || '';
        this.content = options.content || '';
        this.closable = options.closable !== false;
        this.resizable = options.resizable !== false;
        this.draggable = options.draggable || false;
        this.showcase = options.showcase || false;
        this.variant = options.variant || 'default';

        const hasShowcaseLayout = this.showcase;
        
        // Set default styles
        /**
         * Modern panel surface pattern for container widgets.
         *
         * Panel surface uses card-like elevation:
         * - Subtle shadow (var(--shadow-sm)) for depth
         * - Border (var(--border-medium)) for definition
         * - Border-radius (var(--border-radius-md)) for modern appearance
         * - Background color (var(--bg-secondary)) for contrast
         * - Flex column layout for vertical stacking
         */
        this.setStyles({
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            borderRadius: 'var(--border-radius-md)',
            boxShadow: 'var(--shadow-sm)',
            padding: hasShowcaseLayout ? '0' : 'var(--spacing-md)',
            gap: hasShowcaseLayout ? '0' : 'var(--spacing-md)',
            minWidth: '320px',
            minHeight: hasShowcaseLayout ? '240px' : '200px',
            overflow: 'hidden'
        });

        if (this.showcase) {
            this.buildShowcasePanel();
        }

        this.setVariant(this.variant);
        
        // Add event handlers
        if (this.closable) {
            this.setupCloseHandler();
        }
        
        if (this.draggable) {
            this.setupDragHandler();
        }
        
        if (this.resizable) {
            this.setupResizeHandler();
        }
    }

    // Set panel title
    setTitle(title) {
        this.title = title;
        this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
    }

    buildShowcasePanel() {
        const header = this.addHeader(this.title || 'Panel');
        if (header) {
            header.setStyle('padding', 'var(--spacing-lg) var(--spacing-xl)');
        }

        const content = this.addContent({ padding: 'var(--spacing-xl)' });
        content.setStyles({
            backgroundColor: 'var(--bg-primary)',
            minHeight: '160px',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-md)',
            borderTop: '1px solid var(--border-light)'
        });

        if (this.content instanceof UINode) {
            content.appendChild(this.content);
        } else if (typeof this.content === 'string' && this.content) {
            const body = new UINode(`${this.id}-body`, 'div');
            body.textContent = this.content;
            body.setStyles({
                color: 'var(--text-primary)',
                fontSize: 'var(--font-size-md)',
                lineHeight: 'var(--line-height-normal)',
                padding: 'var(--spacing-lg)',
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-light)',
                borderRadius: 'var(--border-radius-md)'
            });
            content.appendChild(body);
        }

        const footer = new UINode(`${this.id}-showcase-footer`, 'div');
        footer.setStyles({
            display: 'flex',
            gap: 'var(--spacing-sm)',
            justifyContent: 'flex-end',
            marginTop: 'auto',
            paddingTop: 'var(--spacing-sm)'
        });

        const primary = new UINode(`${this.id}-showcase-primary`, 'button');
        primary.textContent = 'Primary Action';
        primary.setStyles({
            padding: '8px 12px',
            minWidth: '0',
            minHeight: '0',
            border: 'none',
            borderRadius: 'var(--border-radius-md)',
            backgroundColor: 'var(--color-primary-500)',
            color: 'var(--text-inverse)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--font-weight-medium)',
            lineHeight: 1
        });

        const secondary = new UINode(`${this.id}-showcase-secondary`, 'button');
        secondary.textContent = 'Secondary';
        secondary.setStyles({
            padding: '8px 12px',
            minWidth: '0',
            minHeight: '0',
            border: '1px solid var(--border-medium)',
            borderRadius: 'var(--border-radius-md)',
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--font-weight-medium)',
            lineHeight: 1
        });

        footer.appendChild(secondary);
        footer.appendChild(primary);
        content.appendChild(footer);
    }

    // Set panel icon
    setIcon(icon) {
        this.icon = icon;
        this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
    }

    // Set closable
    setClosable(closable) {
        this.closable = closable;
        this.markDirty(DIRTY.PAINT);
    }

    // Set resizable
    setResizable(resizable) {
        this.resizable = resizable;
        this.markDirty(DIRTY.PAINT);
    }

    // Set draggable
    setDraggable(draggable) {
        this.draggable = draggable;
        this.markDirty(DIRTY.PAINT);
    }

    // Setup close handler
    setupCloseHandler() {
        this.addEventListener('close', (event) => {
            if (this.onClose) {
                this.onClose();
            }
        });
    }

    // Setup drag handler
    setupDragHandler() {
        let isDragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let startLeft = 0;
        let startTop = 0;
        
        this.addEventListener('mousedown', (event) => {
            if (event.button === 0) { // Left click
                isDragging = true;
                dragStartX = event.clientX;
                dragStartY = event.clientY;
                startLeft = this.layoutBox.x;
                startTop = this.layoutBox.y;
                
                this.setState(NODE_STATE.ACTIVE, true);
                this.markDirty(DIRTY.PAINT);
            }
        });
        
        const handleMouseMove = (event) => {
            if (!isDragging) return;
            
            const deltaX = event.clientX - dragStartX;
            const deltaY = event.clientY - dragStartY;
            
            this.setLayoutBounds(
                startLeft + deltaX,
                startTop + deltaY,
                this.layoutBox.width,
                this.layoutBox.height
            );
            
            this.markDirty(DIRTY.PAINT);
        };
        
        const handleMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                this.setState(NODE_STATE.ACTIVE, false);
                this.markDirty(DIRTY.PAINT);
            }
        };
        
        // Add global listeners
        this.addEventListener('mousemove', handleMouseMove);
        this.addEventListener('mouseup', handleMouseUp);
    }

    // Setup resize handler
    setupResizeHandler() {
        let isResizing = false;
        let resizeStartX = 0;
        let resizeStartY = 0;
        let startWidth = 0;
        let startHeight = 0;
        let resizeHandle = null;
        
        this.addEventListener('mousedown', (event) => {
            const resizeEdge = this.getResizeEdge(event);
            
            if (resizeEdge) {
                isResizing = true;
                resizeHandle = resizeEdge;
                resizeStartX = event.clientX;
                resizeStartY = event.clientY;
                startWidth = this.layoutBox.width;
                startHeight = this.layoutBox.height;
                
                this.setState(NODE_STATE.ACTIVE, true);
                this.markDirty(DIRTY.PAINT);
                
                event.preventDefault();
            }
        });
        
        const handleMouseMove = (event) => {
            if (!isResizing) return;
            
            const deltaX = event.clientX - resizeStartX;
            const deltaY = event.clientY - resizeStartY;
            
            let newWidth = startWidth;
            let newHeight = startHeight;
            
            switch (resizeHandle) {
                case 'right':
                    newWidth = Math.max(240, startWidth + deltaX);
                    break;
                case 'bottom':
                    newHeight = Math.max(120, startHeight + deltaY);
                    break;
                case 'bottom-right':
                    newWidth = Math.max(240, startWidth + deltaX);
                    newHeight = Math.max(120, startHeight + deltaY);
                    break;
            }
            
            this.setLayoutBounds(
                this.layoutBox.x,
                this.layoutBox.y,
                newWidth,
                newHeight
            );
            
            this.markDirty(DIRTY.LAYOUT | DIRTY.PAINT);
        };
        
        const handleMouseUp = () => {
            if (isResizing) {
                isResizing = false;
                resizeHandle = null;
                this.setState(NODE_STATE.ACTIVE, false);
                this.markDirty(DIRTY.PAINT);
            }
        };
        
        // Add global listeners
        this.addEventListener('mousemove', handleMouseMove);
        this.addEventListener('mouseup', handleMouseUp);
    }

    // Get resize edge at coordinates
    getResizeEdge(event) {
        const box = this.layoutBox;
        const x = event.clientX - box.x;
        const y = event.clientY - box.y;
        const edgeThreshold = 8;
        
        // Check resize handles
        if (x >= box.width - edgeThreshold && y >= box.height - edgeThreshold) {
            return 'bottom-right';
        }
        if (x >= box.width - edgeThreshold) {
            return 'right';
        }
        if (y >= box.height - edgeThreshold) {
            return 'bottom';
        }
        
        return null;
    }

    // Add header to panel
    addHeader(title = null, options = {}) {
        const headerId = `${this.id}-header`;
        const header = new UINode(headerId, 'panel-header');
        
        if (title !== null) {
            this.title = title;
        }
        
        header.setStyles({
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 'var(--spacing-lg) var(--spacing-xl)',
            borderBottom: '1px solid var(--border-light)',
            minHeight: '56px',
            backgroundColor: 'var(--bg-secondary)',
            cursor: this.draggable ? 'move' : 'default'
        });
        
        // Add title text
        if (this.title || this.icon) {
            const titleText = new UINode(`${headerId}-title`, 'panel-title');
            titleText.textContent = this.icon ? `${this.icon} ${this.title}` : this.title;
            titleText.setStyles({
                fontSize: 'var(--font-size-md)',
                fontWeight: 'var(--font-weight-semibold)',
                color: 'var(--text-primary)',
                userSelect: 'none'
            });
            
            header.appendChild(titleText);
        }
        
        // Add close button
        if (this.closable) {
            const closeButton = new UINode(`${headerId}-close`, 'panel-close-button');
            closeButton.textContent = '✕';
            closeButton.setStyles({
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 'var(--border-radius-md)',
                backgroundColor: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '14px',
                userSelect: 'none'
            });
            
            closeButton.addEventListener('mouseenter', () => {
                closeButton.setStyle('backgroundColor', 'var(--bg-tertiary)');
                closeButton.setStyle('color', 'var(--text-primary)');
            });
            
            closeButton.addEventListener('mouseleave', () => {
                closeButton.setStyle('backgroundColor', 'transparent');
                closeButton.setStyle('color', 'var(--text-secondary)');
            });
            
            closeButton.addEventListener('click', () => {
                const closeEvent = {
                    type: 'close',
                    target: this,
                    defaultPrevented: false,
                    preventDefault: () => { closeEvent.defaultPrevented = true; }
                };
                
                this.dispatchEvent(closeEvent);
                
                if (!closeEvent.defaultPrevented) {
                    this.destroy();
                }
            });
            
            header.appendChild(closeButton);
        }
        
        // Insert header at the beginning
        if (this.firstChild) {
            this.insertBefore(header, this.firstChild);
        } else {
            this.appendChild(header);
        }
        
        return header;
    }

    // Add content area to panel
    addContent(options = {}) {
        const contentId = `${this.id}-content`;
        const content = new UINode(contentId, 'panel-content');
        
        content.setStyles({
            flex: 1,
            overflow: 'auto',
            padding: options.padding || 'var(--spacing-lg)',
            backgroundColor: options.backgroundColor || 'transparent'
        });
        
        this.appendChild(content);
        
        return content;
    }

    // Add footer to panel
    addFooter(content, options = {}) {
        const footerId = `${this.id}-footer`;
        const footer = new UINode(footerId, 'panel-footer');
        
        footer.setStyles({
            display: 'flex',
            flexDirection: 'row',
            justifyContent: options.justifyContent || 'flex-end',
            alignItems: 'center',
            gap: 'var(--spacing-md)',
            padding: 'var(--spacing-md) var(--spacing-lg)',
            borderTop: '1px solid var(--border-light)',
            minHeight: '56px',
            backgroundColor: 'var(--bg-secondary)'
        });
        
        if (typeof content === 'string') {
            footer.textContent = content;
        } else if (content instanceof UINode) {
            footer.appendChild(content);
        }
        
        this.appendChild(footer);
        
        return footer;
    }

    // Set panel variant
    setVariant(variant) {
        switch (variant) {
            case 'card':
                this.setStyles({
                    backgroundColor: 'var(--bg-primary)',
                    boxShadow: 'var(--shadow-md)',
                    border: 'none'
                });
                break;
                
            case 'elevated':
                this.setStyles({
                    boxShadow: 'var(--shadow-lg)'
                });
                break;
                
            case 'outlined':
                this.setStyles({
                    backgroundColor: 'transparent',
                    border: '2px solid var(--border-medium)'
                });
                break;
                
            case 'ghost':
                this.setStyles({
                    backgroundColor: 'transparent',
                    border: 'none',
                    boxShadow: 'none'
                });
                break;
                
            default:
                // Default panel styling
                break;
        }
        
        this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
    }

    // Get panel info
    getInfo() {
        return {
            ...this.getDebugInfo(),
            title: this.title,
            icon: this.icon,
            closable: this.closable,
            resizable: this.resizable,
            draggable: this.draggable,
            childCount: this.children.length
        };
    }

    // Override destroy to clean up panel-specific resources
    destroy() {
        // Remove global listeners if they were added
        if (this.draggable || this.resizable) {
            // Note: In a real implementation, we'd need to track and remove global listeners
            // For now, the listeners will be cleaned up when the node is destroyed
        }
        
        // Call parent destroy
        super.destroy();
    }
}

// Panel factory functions
export const PanelFactory = {
    // Create basic panel
    create(id, options = {}) {
        return new Panel(id, options);
    },
    
    // Create dialog panel
    createDialog(id, title, options = {}) {
        const panel = new Panel(id, {
            title,
            closable: true,
            resizable: false,
            draggable: true,
            ...options
        });
        
        panel.setStyles({
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            minWidth: 320,
            minHeight: 240,
            maxHeight: '80vh',
            zIndex: 'zIndex.modal'
        });
        
        return panel;
    },
    
    // Create sidebar panel
    createSidebar(id, options = {}) {
        const panel = new Panel(id, {
            title: options.title || 'Sidebar',
            resizable: true,
            draggable: false,
            ...options
        });
        
        panel.setStyles({
            width: options.width || 280,
            height: '100%',
            minWidth: 200,
            maxWidth: 400,
            borderRight: `1px solid color(text.tertiary)`,
            borderRadius: 'radius.none'
        });
        
        return panel;
    },
    
    // Create toolbar panel
    createToolbar(id, options = {}) {
        const panel = new Panel(id, {
            title: options.title || 'Toolbar',
            closable: false,
            resizable: false,
            draggable: false,
            ...options
        });
        
        panel.setStyles({
            flexDirection: 'row',
            alignItems: 'center',
            padding: 'spacing.sm spacing.md',
            minHeight: 48,
            backgroundColor: 'color(background.secondary)',
            borderBottom: `1px solid color(text.tertiary)`,
            borderRadius: 'radius.none'
        });
        
        return panel;
    },
    
    // Create status panel
    createStatus(id, message, type = 'info', options = {}) {
        const panel = new Panel(id, {
            closable: true,
            resizable: false,
            draggable: true,
            ...options
        });
        
        panel.setStyles({
            position: 'absolute',
            bottom: 'spacing.lg',
            right: 'spacing.lg',
            minWidth: 200,
            maxWidth: 300,
            backgroundColor: this.getStatusColor(type),
            color: '#ffffff',
            border: 'none',
            boxShadow: 'shadow.lg',
            zIndex: 'zIndex.notification'
        });
        
        // Add content
        const content = panel.addContent({ padding: 'spacing.md' });
        content.textContent = message;
        
        return panel;
    },
    
    // Get status color
    getStatusColor(type) {
        switch (type) {
            case 'success':
                return '#10b981';
            case 'warning':
                return '#f59e0b';
            case 'error':
                return '#ef4444';
            case 'info':
            default:
                return '#3b82f6';
        }
    }
};
