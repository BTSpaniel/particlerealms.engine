// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ============================================================================
 * NotificationSystem - Centralized Notification Management
 * ============================================================================
 *
 * NotificationSystem provides a unified API for user notifications, separating
 * them from debug logging and integrating with ToastManager for UI feedback.
 *
 * NOTIFICATION CHANNELS:
 * 1. Toasts: UI notifications via ToastManager (top-right corner)
 * 2. Console: Browser console.log/error/warn for debugging
 * 3. Sounds: Optional audio feedback using Web Audio API
 *
 * NOTIFICATION LEVELS (priority order):
 * - debug (0): Development debugging information
 * - info (1): General informational messages
 * - success (2): Success confirmations
 * - warning (3): Warning messages
 * - error (4): Error messages
 * - critical (5): Critical errors requiring immediate attention
 *
 * NOTIFICATION TYPES:
 * - system: System-level notifications (startup, shutdown, etc.)
 * - action: User action feedback (clicks, submissions, etc.)
 * - validation: Form validation errors
 * - performance: Performance metrics and warnings
 * - security: Security-related alerts
 * - network: Network request status
 *
 * GROUPING:
 * - createGroup(name, options): Create a notification group
 * - Groups collect related notifications and report summary
 * - Useful for batch operations or multi-step processes
 *
 * CONVENIENCE METHODS:
 * - debug(message, type, data): Debug-level notification
 * - info(message, type, data): Info-level notification
 * - success(message, type, data): Success-level notification
 * - warning(message, type, data): Warning-level notification
 * - error(message, type, data): Error-level notification
 * - critical(message, type, data): Critical-level notification
 *
 * SOUND EFFECTS:
 * - Uses Web Audio API to generate simple beep sounds
 * - Different frequencies for different levels
 * - Can be disabled via enableSounds option
 *
 * MIN LEVEL FILTERING:
 * - minLevel option filters notifications below specified level
 * - Useful for suppressing debug messages in production
 *
 * INTEGRATION:
 * - Uses global Toast from ToastManager for UI toasts
 * - Toast position defaults to top-right
 * - Console output includes prefix (default: '[Plauna]')
 *
 * USAGE:
 *   const notify = new NotificationSystem({ minLevel: 'info' });
 *   notify.success('File saved successfully', 'action');
 *   notify.error('Failed to load data', 'network', { url: '/api/data' });
 */

import { Toast } from '../ui/ToastManager.js';
import { byteSignature } from '../../engine/core/math/FormatMath.js';

let notificationIdSequence = 0;

function createNotificationId() {
    const cryptoApi = globalThis.crypto;
    let entropy = '';
    try {
        if (typeof cryptoApi?.randomUUID === 'function') {
            entropy = cryptoApi.randomUUID().replace(/-/g, '').slice(0, 9);
        } else if (typeof cryptoApi?.getRandomValues === 'function') {
            entropy = byteSignature(cryptoApi.getRandomValues(new Uint8Array(8))).slice(0, 9);
        }
    } catch (_) {
        entropy = '';
    }
    if (!entropy) entropy = (++notificationIdSequence).toString(36).padStart(9, '0');
    return `notif_${Date.now()}_${entropy}`;
}

export class NotificationSystem {
    constructor(options = {}) {
        this.enableToasts = options.enableToasts !== false;
        this.enableConsole = options.enableConsole !== false;
        this.enableSounds = options.enableSounds || false;
        this.prefix = options.prefix || '[Plauna]';
        
        // Notification levels
        this.levels = {
            debug: 0,
            info: 1,
            success: 2,
            warning: 3,
            error: 4,
            critical: 5
        };
        
        this.minLevel = this.levels[options.minLevel] || this.levels.info;
        
        // Sound effects (if enabled)
        this.sounds = {
            success: this.createSound(800, 0.1, 100),
            error: this.createSound(300, 0.2, 200),
            warning: this.createSound(600, 0.15, 150),
            info: this.createSound(1000, 0.1, 100)
        };
    }

    // Create a simple sound effect
    createSound(frequency, duration, volume) {
        if (!this.enableSounds || typeof AudioContext === 'undefined') {
            return null;
        }
        
        return () => {
            try {
                const audioContext = new AudioContext();
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                
                oscillator.frequency.value = frequency;
                oscillator.type = 'sine';
                
                gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration / 1000);
                
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + duration / 1000);
            } catch (error) {
                // Silently fail for audio errors
            }
        };
    }

    // Play sound effect
    playSound(type) {
        if (!this.enableSounds || !this.sounds[type]) return;
        
        try {
            this.sounds[type]();
        } catch (error) {
            // Silently fail for audio errors
        }
    }

    // Core notification method
    notify(level, message, options = {}) {
        const levelNum = this.levels[level] || this.levels.info;
        
        // Check if we should show this notification
        if (levelNum < this.minLevel) return;

        const { title, details, duration, toast, console: enableConsole, sound } = options;
        const fullMessage = title ? `${title}: ${message}` : message;
        const prefixedMessage = `${this.prefix} ${fullMessage}`;

        // Console logging
        if (enableConsole !== false && this.enableConsole) {
            this.logToConsole(level, prefixedMessage, details);
        }

        // Toast notifications
        if (toast !== false && this.enableToasts && this.shouldShowToast(level)) {
            this.showToast(level, message, title, duration);
        }

        // Sound effects
        if (sound !== false) {
            this.playSound(level);
        }

        // Return notification info
        return {
            level,
            message,
            title,
            timestamp: Date.now(),
            id: this.generateNotificationId()
        };
    }

    // Log to console with appropriate level
    logToConsole(level, message, details) {
        const consoleMethod = {
            debug: 'debug',
            info: 'info',
            success: 'info',
            warning: 'warn',
            error: 'error',
            critical: 'error'
        }[level] || 'log';

        if (details) {
            console[consoleMethod](message, details);
        } else {
            console[consoleMethod](message);
        }
    }

    // Show toast notification
    showToast(level, message, title, duration) {
        const toastType = {
            debug: 'info',
            info: 'info',
            success: 'success',
            warning: 'warning',
            error: 'error',
            critical: 'error'
        }[level] || 'info';

        const toastMessage = title ? `${title}: ${message}` : message;
        const toastDuration = duration || this.getDefaultToastDuration(level);

        return Toast.show(toastMessage, toastType, { duration: toastDuration });
    }

    // Check if we should show toast for this level
    shouldShowToast(level) {
        const toastLevels = ['success', 'warning', 'error', 'critical'];
        return toastLevels.includes(level);
    }

    // Get default toast duration for level
    getDefaultToastDuration(level) {
        const durations = {
            debug: 3000,
            info: 3000,
            success: 3000,
            warning: 4000,
            error: 5000,
            critical: 7000
        };
        return durations[level] || 3000;
    }

    // Generate unique notification ID
    generateNotificationId() {
        return createNotificationId();
    }

    // Convenience methods for different notification types
    debug(message, options = {}) {
        return this.notify('debug', message, options);
    }

    info(message, options = {}) {
        return this.notify('info', message, options);
    }

    success(message, options = {}) {
        return this.notify('success', message, options);
    }

    warning(message, options = {}) {
        return this.notify('warning', message, options);
    }

    error(message, options = {}) {
        return this.notify('error', message, options);
    }

    critical(message, options = {}) {
        return this.notify('critical', message, options);
    }

    // System notifications (for framework events)
    system(message, options = {}) {
        return this.info(message, { ...options, title: 'System' });
    }

    // User action notifications
    action(message, options = {}) {
        return this.success(message, { ...options, title: 'Action' });
    }

    // Validation notifications
    validation(message, options = {}) {
        return this.warning(message, { ...options, title: 'Validation' });
    }

    // Performance notifications
    performance(message, options = {}) {
        return this.info(message, { ...options, title: 'Performance' });
    }

    // Security notifications
    security(message, options = {}) {
        return this.warning(message, { ...options, title: 'Security', sound: true });
    }

    // Network notifications
    network(message, options = {}) {
        const level = message.includes('error') || message.includes('failed') ? 'error' : 'info';
        return this.notify(level, message, { ...options, title: 'Network' });
    }

    // Create notification group (for batch notifications)
    createGroup(name, options = {}) {
        const group = {
            name,
            notifications: [],
            add: (level, message, opts = {}) => {
                const notification = this.notify(level, message, { ...options, ...opts, title: name });
                group.notifications.push(notification);
                return notification;
            },
            clear: () => {
                group.notifications = [];
            },
            getStats: () => {
                const stats = {};
                group.notifications.forEach(notif => {
                    stats[notif.level] = (stats[notif.level] || 0) + 1;
                });
                return stats;
            }
        };

        return group;
    }

    // Set minimum notification level
    setMinLevel(level) {
        this.minLevel = this.levels[level] || this.levels.info;
    }

    // Enable/disable toast notifications
    setToasts(enabled) {
        this.enableToasts = enabled;
    }

    // Enable/disable console logging
    setConsole(enabled) {
        this.enableConsole = enabled;
    }

    // Enable/disable sound effects
    setSounds(enabled) {
        this.enableSounds = enabled;
    }

    // Get notification statistics
    getStats() {
        return {
            enableToasts: this.enableToasts,
            enableConsole: this.enableConsole,
            enableSounds: this.enableSounds,
            minLevel: this.minLevel,
            prefix: this.prefix
        };
    }
}

// Global notification system instance
let globalNotificationSystem = null;

// Notification utility functions
export const Notify = {
    // Initialize global notification system
    initialize(options = {}) {
        if (globalNotificationSystem) {
            globalNotificationSystem = null;
        }
        globalNotificationSystem = new NotificationSystem(options);
        return globalNotificationSystem;
    },
    
    // Get global instance
    getInstance() {
        if (!globalNotificationSystem) {
            globalNotificationSystem = new NotificationSystem();
        }
        return globalNotificationSystem;
    },
    
    // Convenience methods that use global instance
    debug(message, options = {}) {
        return this.getInstance().debug(message, options);
    },
    
    info(message, options = {}) {
        return this.getInstance().info(message, options);
    },
    
    success(message, options = {}) {
        return this.getInstance().success(message, options);
    },
    
    warning(message, options = {}) {
        return this.getInstance().warning(message, options);
    },
    
    error(message, options = {}) {
        return this.getInstance().error(message, options);
    },
    
    critical(message, options = {}) {
        return this.getInstance().critical(message, options);
    },
    
    system(message, options = {}) {
        return this.getInstance().system(message, options);
    },
    
    action(message, options = {}) {
        return this.getInstance().action(message, options);
    },
    
    validation(message, options = {}) {
        return this.getInstance().validation(message, options);
    },
    
    performance(message, options = {}) {
        return this.getInstance().performance(message, options);
    },
    
    security(message, options = {}) {
        return this.getInstance().security(message, options);
    },
    
    network(message, options = {}) {
        return this.getInstance().network(message, options);
    },
    
    createGroup(name, options = {}) {
        return this.getInstance().createGroup(name, options);
    },
    
    setMinLevel(level) {
        return this.getInstance().setMinLevel(level);
    },
    
    setToasts(enabled) {
        return this.getInstance().setToasts(enabled);
    },
    
    setConsole(enabled) {
        return this.getInstance().setConsole(enabled);
    },
    
    setSounds(enabled) {
        return this.getInstance().setSounds(enabled);
    },
    
    getStats() {
        return this.getInstance().getStats();
    }
};

// Auto-initialize in browser environment
if (typeof window !== 'undefined') {
    // Initialize global notification system
    Notify.initialize({
        enableToasts: true,
        enableConsole: true,
        enableSounds: false, // Disabled by default to avoid annoying users
        minLevel: 'info'
    });
    
    // Make available globally
    window.PlaunaNotify = Notify;
}
