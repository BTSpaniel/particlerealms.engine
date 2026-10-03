// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PlaunaEventSystem - Event system for Plauna.
 *
 * Event bus pattern:
 * - Simple publish-subscribe event system
 * - Follows existing engine/ editor patterns
 * - Supports multiple listeners per event
 * - Returns unsubscribe function for cleanup
 * - Error handling for faulty event handlers
 *
 * Features:
 * - on(): Subscribe to event with callback
 * - off(): Unsubscribe from event
 * - emit(): Dispatch event to all listeners
 * - once(): Subscribe for single event occurrence
 * - removeAllListeners(): Clean up listeners
 */
export class PlaunaEventSystem {
    constructor() {
        this.listeners = new Map();
    }

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);
        
        // Return unsubscribe function
        return () => {
            const callbacks = this.listeners.get(event);
            if (callbacks) {
                callbacks.delete(callback);
                if (callbacks.size === 0) {
                    this.listeners.delete(event);
                }
            }
        };
    }

    off(event, callback) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.delete(callback);
            if (callbacks.size === 0) {
                this.listeners.delete(event);
            }
        }
    }

    emit(event, data) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            for (const callback of callbacks) {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`[Plauna] Event handler error for ${event}:`, error);
                }
            }
        }
    }

    once(event, callback) {
        const onceCallback = (data) => {
            callback(data);
            this.off(event, onceCallback);
        };
        return this.on(event, onceCallback);
    }

    removeAllListeners(event) {
        if (event) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
    }

    getListenerCount(event) {
        const callbacks = this.listeners.get(event);
        return callbacks ? callbacks.size : 0;
    }

    hasListeners(event) {
        return this.listeners.has(event) && this.listeners.get(event).size > 0;
    }
}
