// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ============================================================================
 * ToastManager - Unified Toast Notification System
 * ============================================================================
 *
 * ToastManager provides a user-friendly toast notification system for Plauna.
 * It separates UI notifications from debug logging and provides a clean API.
 *
 * TOAST POSITIONS:
 * - top-right: Top-right corner (default)
 * - top-left: Top-left corner
 * - top-center: Top-center
 * - bottom-right: Bottom-right corner
 * - bottom-left: Bottom-left corner
 * - bottom-center: Bottom-center
 *
 * TOAST TYPES:
 * - success: Green checkmark, 3s duration
 * - error: Red X, 5s duration
 * - warning: Yellow warning, 4s duration
 * - info: Blue info, 3s duration
 * - loading: Gray spinner, indefinite (must be manually dismissed)
 *
 * TOAST LIFECYCLE:
 * 1. show(options): Creates toast element and appends to container
 * 2. Animate in: Slide-in animation based on position
 * 3. Display: Shows for duration (or indefinite)
 * 4. Animate out: Slide-out animation
 * 5. Remove: Element removed from DOM
 *
 * TOAST STRUCTURE:
 * - Container: Fixed-position div at specified position
 * - Toast Element: Individual toast with type styling
 * - Icon: Type-specific icon (✓, ✕, ⚠, ℹ, ⟳)
 * - Content: Title and optional description
 * - Close Button: X button to dismiss manually
 * - Progress Bar: Optional countdown indicator
 *
 * AUTO-DISMISS:
 * - maxToasts: Maximum concurrent toasts (default: 5)
 * - defaultDuration: Default display time (default: 4000ms)
 * - Oldest toasts are dismissed when limit is reached
 * - Loading toasts have indefinite duration (duration: 0)
 *
 * ANIMATIONS:
 * - Slide-in/out based on position
 * - Fade effect for smooth transitions
 * - CSS transitions defined in Toast.css
 *
 * CONVENIENCE METHODS:
 * - success(message, options): Show success toast
 * - error(message, options): Show error toast
 * - warning(message, options): Show warning toast
 * - info(message, options): Show info toast
 * - loading(message, options): Show loading toast
 *
 * GLOBAL SINGLETON:
 * - Toast.initialize() creates global singleton
 * - Toast.show() uses global singleton
 * - Used by NotificationSystem and widget gallery
 *
 * USAGE:
 *   const manager = new ToastManager({ position: 'top-right' });
 *   manager.success('Operation completed');
 *   manager.error('Failed to save', { duration: 6000 });
 *
 *   // Or use global singleton
 *   Toast.initialize();
 *   Toast.show('Hello world', 'info');
 */

/**
 * ToastManager - Unified toast notification system.
 *
 * Toast pattern:
 * - Fixed-position container at specified position
 * - Type-specific styling (success, error, warning, info, loading)
 * - Auto-dismiss with configurable duration
 * - Slide-in/out animations based on position
 * - Max concurrent toast limit with FIFO dismissal
 *
 * Lifecycle:
 * 1. show(): Creates toast and appends to container
 * 2. Animate in: Slide-in based on position
 * 3. Display: Shows for duration (or indefinite for loading)
 * 4. Animate out: Slide-out animation
 * 5. Remove: Element removed from DOM
 */
export class ToastManager {
    constructor(options = {}) {
        this.maxToasts = options.maxToasts || 5;
        this.defaultDuration = options.defaultDuration || 4000;
        this.position = options.position || 'top-right';
        this.container = null;
        this.toasts = new Map();
        this.toastId = 0;
        
        // Toast types with their default styling
        this.toastTypes = {
            success: {
                background: '#10b981',
                icon: '✓',
                duration: 3000
            },
            error: {
                background: '#ef4444',
                icon: '✕',
                duration: 5000
            },
            warning: {
                background: '#f59e0b',
                icon: '⚠',
                duration: 4000
            },
            info: {
                background: '#3b82f6',
                icon: 'ℹ',
                duration: 3000
            },
            loading: {
                background: '#6b7280',
                icon: '⟳',
                duration: 0 // Indefinite until manually dismissed
            }
        };
        
        this.initialize();
    }

    // Initialize toast container
    initialize() {
        if (typeof document === 'undefined') return;
        
        // Create container
        this.container = document.createElement('div');
        this.container.id = 'plauna-toast-container';
        this.container.className = 'plauna-toast-container';
        
        // Set container styles based on position
        const positionStyles = this.getPositionStyles();
        this.container.style.cssText = Object.entries(positionStyles).map(([key, value]) => 
            `${key.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${value}`
        ).join('; ');
        
        document.body.appendChild(this.container);
        
        // Add global styles if not already present
        this.addGlobalStyles();
    }

    // Get position styles for container
    getPositionStyles() {
        const positions = {
            'top-right': {
                position: 'fixed',
                top: '20px',
                right: '20px',
                zIndex: '10000',
                pointerEvents: 'none'
            },
            'top-left': {
                position: 'fixed',
                top: '20px',
                left: '20px',
                zIndex: '10000',
                pointerEvents: 'none'
            },
            'bottom-right': {
                position: 'fixed',
                bottom: '20px',
                right: '20px',
                zIndex: '10000',
                pointerEvents: 'none'
            },
            'bottom-left': {
                position: 'fixed',
                bottom: '20px',
                left: '20px',
                zIndex: '10000',
                pointerEvents: 'none'
            },
            'top-center': {
                position: 'fixed',
                top: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: '10000',
                pointerEvents: 'none'
            },
            'bottom-center': {
                position: 'fixed',
                bottom: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: '10000',
                pointerEvents: 'none'
            }
        };
        
        return positions[this.position] || positions['top-right'];
    }

    // Add global CSS styles
    addGlobalStyles() {
        if (document.getElementById('plauna-toast-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'plauna-toast-styles';
        style.textContent = `
            .plauna-toast {
                pointer-events: auto;
                margin-bottom: 8px;
                padding: 12px 16px;
                border-radius: 8px;
                color: white;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 14px;
                font-weight: 500;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                display: flex;
                align-items: center;
                gap: 8px;
                min-width: 250px;
                max-width: 400px;
                opacity: 0;
                transform: translateX(100%);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                cursor: pointer;
                user-select: none;
            }
            
            .plauna-toast.show {
                opacity: 1;
                transform: translateX(0);
            }
            
            .plauna-toast.hide {
                opacity: 0;
                transform: translateX(100%);
            }
            
            .plauna-toast-icon {
                flex-shrink: 0;
                font-size: 16px;
                font-weight: bold;
            }
            
            .plauna-toast-content {
                flex: 1;
                line-height: 1.4;
            }
            
            .plauna-toast-close {
                flex-shrink: 0;
                font-size: 18px;
                opacity: 0.7;
                cursor: pointer;
                padding: 0 4px;
                border-radius: 2px;
                transition: opacity 0.2s;
            }
            
            .plauna-toast-close:hover {
                opacity: 1;
                background: rgba(255, 255, 255, 0.1);
            }
            
            .plauna-toast.loading .plauna-toast-icon {
                animation: spin 1s linear infinite;
            }
            
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            
            .plauna-toast-container {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            
            @media (max-width: 640px) {
                .plauna-toast {
                    min-width: 200px;
                    max-width: calc(100vw - 40px);
                }
                
                .plauna-toast-container {
                    left: 20px !important;
                    right: 20px !important;
                    transform: none !important;
                }
            }
        `;
        
        document.head.appendChild(style);
    }

    /**
     * Show a toast notification.
     *
     * Toast creation pattern:
     * - Creates toast element with type-specific styling
     * - Adds icon, content, close button, and optional progress bar
     * - Appends to container at specified position
     * - Enforces max concurrent toast limit (dismisses oldest)
     * - Auto-dismisses after duration (0 for indefinite)
     * - Returns toast ID for update/dismiss operations
     *
     * @param {string} message - Toast message
     * @param {string} [type='info'] - Toast type (success, error, warning, info, loading)
     * @param {Object} [options] - Toast options
     * @param {number} [options.duration] - Display duration (ms, 0 for indefinite)
     * @param {string} [options.description] - Optional description
     * @param {boolean} [options.progress] - Show progress bar
     * @param {Function} [options.onDismiss] - Callback on dismiss
     * @returns {number} Toast ID
     */
    show(message, type = 'info', options = {}) {
        if (!this.container) {
            console.warn('[ToastManager] Container not initialized');
            return null;
        }

        const toastId = ++this.toastId;
        const toastType = this.toastTypes[type] || this.toastTypes.info;
        
        // Create toast element
        const toast = document.createElement('div');
        toast.className = `plauna-toast ${type}`;
        toast.dataset.toastId = toastId;
        
        // Create toast content
        const icon = document.createElement('span');
        icon.className = 'plauna-toast-icon';
        icon.textContent = toastType.icon;
        
        const content = document.createElement('span');
        content.className = 'plauna-toast-content';
        content.textContent = message;
        
        const close = document.createElement('span');
        close.className = 'plauna-toast-close';
        close.textContent = '×';
        
        // Assemble toast
        toast.appendChild(icon);
        toast.appendChild(content);
        toast.appendChild(close);
        
        // Set toast type background
        toast.style.background = toastType.background;
        
        // Add click handlers
        const dismiss = () => this.dismiss(toastId);
        toast.addEventListener('click', dismiss);
        close.addEventListener('click', (e) => {
            e.stopPropagation();
            dismiss();
        });
        
        // Add to container
        this.container.appendChild(toast);
        this.toasts.set(toastId, {
            element: toast,
            type,
            message,
            options,
            createdAt: Date.now()
        });
        
        // Limit number of toasts
        this.limitToasts();
        
        // Show animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
        
        // Auto-dismiss if duration is set
        const duration = options.duration !== undefined ? options.duration : toastType.duration;
        if (duration > 0) {
            setTimeout(() => this.dismiss(toastId), duration);
        }
        
        return toastId;
    }

    // Dismiss a specific toast
    dismiss(toastId) {
        const toast = this.toasts.get(toastId);
        if (!toast) return false;
        
        const { element } = toast;
        element.classList.add('hide');
        
        // Remove after animation
        setTimeout(() => {
            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
            this.toasts.delete(toastId);
        }, 300);
        
        return true;
    }

    // Dismiss all toasts
    dismissAll() {
        const toastIds = Array.from(this.toasts.keys());
        toastIds.forEach(id => this.dismiss(id));
    }

    // Limit number of visible toasts
    limitToasts() {
        if (this.toasts.size <= this.maxToasts) return;
        
        const toastIds = Array.from(this.toasts.keys());
        const toDismiss = toastIds.slice(0, toastIds.length - this.maxToasts);
        
        toDismiss.forEach(id => this.dismiss(id));
    }

    // Convenience methods for different toast types
    success(message, options = {}) {
        return this.show(message, 'success', options);
    }

    error(message, options = {}) {
        return this.show(message, 'error', options);
    }

    warning(message, options = {}) {
        return this.show(message, 'warning', options);
    }

    info(message, options = {}) {
        return this.show(message, 'info', options);
    }

    loading(message, options = {}) {
        return this.show(message, 'loading', options);
    }

    // Update an existing toast
    update(toastId, message, type = null) {
        const toast = this.toasts.get(toastId);
        if (!toast) return false;
        
        const { element } = toast;
        const content = element.querySelector('.plauna-toast-content');
        const icon = element.querySelector('.plauna-toast-icon');
        
        // Update message
        if (message !== undefined) {
            content.textContent = message;
            toast.message = message;
        }
        
        // Update type if provided
        if (type && type !== toast.type) {
            element.className = `plauna-toast ${type}`;
            const toastType = this.toastTypes[type] || this.toastTypes.info;
            icon.textContent = toastType.icon;
            element.style.background = toastType.background;
            toast.type = type;
        }
        
        return true;
    }

    // Get active toasts
    getActiveToasts() {
        return Array.from(this.toasts.entries()).map(([id, toast]) => ({
            id,
            type: toast.type,
            message: toast.message,
            createdAt: toast.createdAt,
            duration: this.toastTypes[toast.type]?.duration || 0
        }));
    }

    // Get statistics
    getStats() {
        const activeToasts = this.getActiveToasts();
        const typeCounts = {};
        
        activeToasts.forEach(toast => {
            typeCounts[toast.type] = (typeCounts[toast.type] || 0) + 1;
        });
        
        return {
            totalActive: activeToasts.length,
            maxToasts: this.maxToasts,
            typeCounts,
            position: this.position,
            defaultDuration: this.defaultDuration
        };
    }

    // Set position
    setPosition(position) {
        this.position = position;
        if (this.container) {
            const positionStyles = this.getPositionStyles();
            Object.entries(positionStyles).forEach(([key, value]) => {
                this.container.style[key] = value;
            });
        }
    }

    // Set max toasts
    setMaxToasts(max) {
        this.maxToasts = Math.max(1, max);
        this.limitToasts();
    }

    // Destroy toast manager
    destroy() {
        this.dismissAll();
        
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        
        this.toasts.clear();
        this.container = null;
    }
}

// Global toast manager instance
let globalToastManager = null;

// Toast utility functions
export const Toast = {
    // Initialize global toast manager
    initialize(options = {}) {
        if (globalToastManager) {
            globalToastManager.destroy();
        }
        globalToastManager = new ToastManager(options);
        return globalToastManager;
    },
    
    // Get global instance
    getInstance() {
        if (!globalToastManager) {
            globalToastManager = new ToastManager();
        }
        return globalToastManager;
    },
    
    // Convenience methods that use global instance
    show(message, type = 'info', options = {}) {
        return this.getInstance().show(message, type, options);
    },
    
    success(message, options = {}) {
        return this.getInstance().success(message, options);
    },
    
    error(message, options = {}) {
        return this.getInstance().error(message, options);
    },
    
    warning(message, options = {}) {
        return this.getInstance().warning(message, options);
    },
    
    info(message, options = {}) {
        return this.getInstance().info(message, options);
    },
    
    loading(message, options = {}) {
        return this.getInstance().loading(message, options);
    },
    
    dismiss(toastId) {
        return this.getInstance().dismiss(toastId);
    },
    
    dismissAll() {
        return this.getInstance().dismissAll();
    },
    
    update(toastId, message, type = null) {
        return this.getInstance().update(toastId, message, type);
    },
    
    getStats() {
        return this.getInstance().getStats();
    }
};

// Auto-initialize in browser environment
if (typeof window !== 'undefined') {
    // Initialize global toast manager
    Toast.initialize();
    
    // Make available globally
    window.PlaunaToast = Toast;
}
