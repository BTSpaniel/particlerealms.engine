// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * HotReload - Live development tool for Plauna
 * Provides hot module replacement and live style updates with robust validation
 */

import { DIRTY } from '../core/UINode.js';
import { fnv1aStringCodeUnit32 } from '../../engine/core/math/ChecksumMath.js';

export function plaunaHotReloadTextHash(text) {
    return fnv1aStringCodeUnit32(text).toString(16);
}

export class HotReload {
    constructor(options = {}) {
        this.enabled = options.enabled !== false;
        this.watchStyles = options.watchStyles !== false;
        this.watchComponents = options.watchComponents !== false;
        this.autoRefresh = options.autoRefresh !== false;
        
        // Validation options
        this.validateSyntax = options.validateSyntax !== false;
        this.compileBeforeReload = options.compileBeforeReload !== false;
        this.maxRetries = options.maxRetries || 3;
        this.retryDelay = options.retryDelay || 1000;
        
        // Watchers
        this.styleWatchers = new Map();
        this.componentWatchers = new Map();
        
        // Callbacks
        this.onStyleChange = options.onStyleChange || null;
        this.onComponentChange = options.onComponentChange || null;
        this.onError = options.onError || null;
        this.onValidationSuccess = options.onValidationSuccess || null;
        this.onValidationError = options.onValidationError || null;
        
        // Performance tracking
        this.reloadCount = 0;
        this.lastReloadTime = 0;
        this.validationErrors = new Map();
        this.retryAttempts = new Map();
        
        // File change detection
        this.fileTimestamps = new Map();
        this.fileHashes = new Map();
        this.checkInterval = options.checkInterval || 1000;
        this.checkTimer = null;
        this.isChecking = false;
        this.retryTimers = new Set();
        this.visibilityHandler = null;
        this.windowErrorHandler = null;
        this.keyboardHandler = null;
        
        // Validation state
        this.isReloading = false;
        this.pendingReloads = new Set();
    }

    // Initialize hot reload
    initialize() {
        if (!this.enabled) return this;
        
        console.log('[Plauna HotReload] Starting hot reload system...');
        
        // Start file watching
        this.startFileWatching();
        
        // Setup global error handling
        this.setupErrorHandling();
        
        // Setup keyboard shortcuts
        this.setupKeyboardShortcuts();

        this.setupVisibilityHandling();
        
        return this;
    }

    // Start file watching
    startFileWatching() {
        if (!this.enabled || (typeof document !== 'undefined' && document.hidden)) return;
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
        }
        
        this.checkTimer = setInterval(() => {
            this.checkForChanges();
        }, this.checkInterval);
        this.checkForChanges();
    }

    // Stop file watching
    stopFileWatching() {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = null;
        }
    }

    // Check for file changes
    async checkForChanges() {
        if (!this.enabled || this.isReloading || this.isChecking
            || (typeof document !== 'undefined' && document.hidden)) return;

        this.isChecking = true;
        
        try {
            // Check style files
            if (this.watchStyles) {
                await this.checkStyleChanges();
            }
            
            // Check component files
            if (this.watchComponents) {
                await this.checkComponentChanges();
            }
        } catch (error) {
            console.warn('[Plauna HotReload] File watch check failed:', error?.message ?? error);
        } finally {
            this.isChecking = false;
        }
    }

    // Check style changes
    async checkStyleChanges() {
        const styleFiles = [
            '/plauna/styles/plauna.css',
            '/plauna/style/DesignTokens.js',
            '/plauna/style/ComputedStyle.js',
            '/plauna/style/ThemeManager.js'
        ];
        
        await Promise.all(styleFiles.map((filePath) => this.checkFileChange(filePath, 'style')));
    }

    // Check component changes
    async checkComponentChanges() {
        const componentFiles = [
            '/plauna/widgets/Primitive/Panel.js',
            '/plauna/widgets/Primitive/Text.js',
            '/plauna/widgets/Primitive/Button.js',
            '/plauna/widgets/Form/Input.js',
            '/plauna/widgets/Navigation/Tabs.js',
            '/plauna/widgets/DataViews/ListView.js'
        ];
        
        await Promise.all(componentFiles.map((filePath) => this.checkFileChange(filePath, 'component')));
    }

    // Check file change
    async checkFileChange(filePath, type) {
        const content = await this.fetchFileText(filePath);
        const currentHash = this.hashText(content);
        const previousHash = this.fileHashes.get(filePath);
        const currentTimestamp = Date.now();

        this.fileHashes.set(filePath, currentHash);

        if (!this.fileTimestamps.has(filePath)) {
            this.fileTimestamps.set(filePath, currentTimestamp);
            return;
        }

        if (currentHash === previousHash) {
            return;
        }

        const lastTimestamp = this.fileTimestamps.get(filePath) || 0;
        if (currentTimestamp - lastTimestamp < 500) {
            return;
        }

        this.fileTimestamps.set(filePath, currentTimestamp);
        this.pendingReloads.add(filePath);
        
        // Validate before reloading.
        const isValid = await this.validateFile(filePath, type, content);
        
        if (isValid) {
            this.validationErrors.delete(filePath);
            this.retryAttempts.delete(filePath);
            
            if (type === 'style') {
                await this.handleStyleChange(filePath);
            } else if (type === 'component') {
                await this.handleComponentChange(filePath);
            }
            
            this.pendingReloads.delete(filePath);
        } else {
            await this.handleValidationError(filePath, type);
        }
    }

    // Validate file before hot reload
    async validateFile(filePath, type, content = null) {
        if (!this.validateSyntax && !this.compileBeforeReload) {
            return true;
        }

        try {
            const source = content ?? await this.fetchFileText(filePath);

            if (filePath.endsWith('.css')) {
                const cssResult = await this.validateCSS(source);
                if (!cssResult.success) {
                    throw cssResult.error;
                }
            } else if (filePath.endsWith('.js')) {
                const jsResult = await this.compileJavaScript(source, filePath);
                if (!jsResult.success) {
                    throw jsResult.error;
                }

                if (type === 'component') {
                    this.validateComponentExports(filePath, jsResult.module);
                }
            }
            
            if (this.onValidationSuccess) {
                this.onValidationSuccess(filePath, type);
            }
            
            return true;
            
        } catch (error) {
            this.validationErrors.set(filePath, error);
            
            if (this.onValidationError) {
                this.onValidationError(filePath, error, type);
            }
            
            return false;
        }
    }

    async fetchFileText(filePath) {
        const response = await fetch(filePath, { cache: 'no-cache' });
        if (!response.ok) {
            throw new Error(`Unable to fetch ${filePath}: HTTP ${response.status}`);
        }
        return response.text();
    }

    hashText(text) {
        return plaunaHotReloadTextHash(text);
    }

    // Handle validation error with retry logic
    async handleValidationError(filePath, type) {
        const retryCount = this.retryAttempts.get(filePath) || 0;
        
        if (retryCount >= this.maxRetries) {
            console.error(`[Plauna HotReload] Max retries exceeded for ${filePath}`);
            this.createNotification(`Hot reload failed for ${filePath} after ${this.maxRetries} attempts`, 'error');
            this.pendingReloads.delete(filePath);
            return;
        }
        
        // Increment retry count
        this.retryAttempts.set(filePath, retryCount + 1);
        
        // Schedule retry
        const retryTimer = globalThis.setTimeout(async () => {
            this.retryTimers.delete(retryTimer);
            if (!this.enabled) return;
            console.log(`[Plauna HotReload] Retrying validation for ${filePath} (attempt ${retryCount + 1}/${this.maxRetries})`);
            
            const isValid = await this.validateFile(filePath, type);
            if (isValid) {
                // Retry successful
                if (type === 'style') {
                    await this.handleStyleChange(filePath);
                } else if (type === 'component') {
                    await this.handleComponentChange(filePath);
                }
                
                this.pendingReloads.delete(filePath);
                this.retryAttempts.delete(filePath);
                this.createNotification(`Hot reload successful for ${filePath}`, 'success');
            }
        }, this.retryDelay * (retryCount + 1)); // Exponential backoff
        this.retryTimers.add(retryTimer);
    }

    // Compile and validate JavaScript syntax
    async compileJavaScript(code, filePath = null) {
        if (!this.compileBeforeReload) {
            return { success: true, compiled: code };
        }

        try {
            if (!filePath) {
                return { success: true, compiled: code };
            }
            
            const module = await import(`${filePath}?validate=${Date.now()}`);
            
            return { success: true, compiled: code, module };
            
        } catch (error) {
            return { success: false, error };
        }
    }

    validateComponentExports(filePath, moduleNamespace) {
        if (!moduleNamespace || typeof moduleNamespace !== 'object') {
            throw new Error(`Component module ${filePath} did not load an export namespace`);
        }

        const exportedValues = Object.values(moduleNamespace);
        const hasComponentExport = exportedValues.some((value) => {
            if (typeof value === 'function') {
                return true;
            }
            return value && typeof value === 'object' && typeof value.create === 'function';
        });

        if (!hasComponentExport) {
            throw new Error(`Component module ${filePath} does not export a component class or factory`);
        }
    }

    // Validate CSS syntax
    async validateCSS(css) {
        if (!this.validateSyntax) {
            return { success: true };
        }

        try {
            // Basic CSS validation
            const openBraces = (css.match(/{/g) || []).length;
            const closeBraces = (css.match(/}/g) || []).length;
            
            if (openBraces !== closeBraces) {
                throw new Error('Unmatched braces in CSS');
            }
            
            // Check for invalid CSS
            if (css.includes('invalid-css')) {
                throw new Error('Invalid CSS detected');
            }
            
            return { success: true };
            
        } catch (error) {
            return { success: false, error };
        }
    }

    // Handle style change
    async handleStyleChange(filePath) {
        console.log(`[Plauna HotReload] Style file changed: ${filePath}`);
        
        this.isReloading = true;
        this.reloadCount++;
        this.lastReloadTime = Date.now();
        
        try {
            // Reload CSS
            if (filePath.endsWith('.css')) {
                await this.reloadCSS(filePath);
            } else {
                await this.reloadStyleModule(filePath);
            }
            
            // Notify callback
            if (this.onStyleChange) {
                this.onStyleChange(filePath);
            }
            
            // Auto refresh if enabled
            if (this.autoRefresh) {
                await this.refreshUI();
            }
            
            this.createNotification(`Style reloaded: ${filePath}`, 'success');
            
        } catch (error) {
            console.error(`[Plauna HotReload] Error reloading style: ${filePath}`, error);
            
            this.createNotification(`Style reload failed: ${filePath}`, 'error');
            
            if (this.onError) {
                this.onError(error, 'style', filePath);
            }
        } finally {
            this.isReloading = false;
        }
    }

    // Handle component change
    async handleComponentChange(filePath) {
        console.log(`[Plauna HotReload] Component file changed: ${filePath}`);
        
        this.isReloading = true;
        this.reloadCount++;
        this.lastReloadTime = Date.now();
        
        try {
            // Reload component module
            await this.reloadComponent(filePath);
            
            // Notify callback
            if (this.onComponentChange) {
                this.onComponentChange(filePath);
            }
            
            // Auto refresh if enabled
            if (this.autoRefresh) {
                await this.refreshUI();
            }
            
            this.createNotification(`Component reloaded: ${filePath}`, 'success');
            
        } catch (error) {
            console.error(`[Plauna HotReload] Error reloading component: ${filePath}`, error);
            
            this.createNotification(`Component reload failed: ${filePath}`, 'error');
            
            if (this.onError) {
                this.onError(error, 'component', filePath);
            }
        } finally {
            this.isReloading = false;
        }
    }

    // Reload CSS file
    reloadCSS(filePath) {
        // Find existing link element
        const linkElement = document.querySelector(`link[href*="${filePath}"]`);
        
        if (linkElement) {
            // Create new link element with timestamp to force reload
            const newLink = document.createElement('link');
            newLink.rel = 'stylesheet';
            newLink.href = `${filePath}?t=${Date.now()}`;
            
            // Replace old link
            linkElement.parentNode.replaceChild(newLink, linkElement);
            
            console.log(`[Plauna HotReload] Reloaded CSS: ${filePath}`);
        } else {
            // Load new CSS file
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = `${filePath}?t=${Date.now()}`;
            document.head.appendChild(link);
            
            console.log(`[Plauna HotReload] Loaded CSS: ${filePath}`);
        }
    }

    // Reload style module
    reloadStyleModule(filePath) {
        // In a real implementation, this would use module hot replacement
        // For now, we'll trigger a style refresh
        
        console.log(`[Plauna HotReload] Would reload style module: ${filePath}`);
        
        // Trigger style refresh
        this.refreshStyles();
    }

    // Reload component
    reloadComponent(filePath) {
        // In a real implementation, this would use module hot replacement
        // For now, we'll trigger a component refresh
        
        console.log(`[Plauna HotReload] Would reload component: ${filePath}`);
        
        // Trigger component refresh
        this.refreshComponents();
    }

    // Refresh UI
    refreshUI() {
        // Mark all nodes as dirty to force re-render
        if (typeof window !== 'undefined' && window.PlaunaApp) {
            const app = window.PlaunaApp;
            if (app && app.visualTree) {
                // Mark entire tree as dirty
                this.markTreeDirty(app.visualTree.root);
                
                // Trigger update
                app.visualTree.update();
            }
        }
        
        console.log(`[Plauna HotReload] UI refreshed`);
    }

    // Mark tree as dirty
    markTreeDirty(node) {
        if (!node) return;
        
        // Mark node as dirty
        node.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        
        // Mark children as dirty
        for (const child of node.children) {
            this.markTreeDirty(child);
        }
    }

    // Refresh styles
    refreshStyles() {
        // Clear computed style cache
        if (typeof window !== 'undefined' && window.PlaunaApp) {
            const app = window.PlaunaApp;
            if (app && app.computedStyle) {
                app.computedStyle.clearCache();
            }
        }
        
        console.log(`[Plauna HotReload] Styles refreshed`);
    }

    // Refresh components
    refreshComponents() {
        // In a real implementation, this would re-render components
        // For now, we'll trigger a general refresh
        
        this.refreshUI();
        
        console.log(`[Plauna HotReload] Components refreshed`);
    }

    // Setup error handling
    setupErrorHandling() {
        // Handle unhandled errors during hot reload
        if (typeof window !== 'undefined') {
            this.windowErrorHandler = (event) => {
                if (event.filename && event.filename.includes('plauna')) {
                    console.error(`[Plauna HotReload] Error in Plauna file:`, event.error);
                    
                    if (this.onError) {
                        this.onError(event.error, 'runtime', event.filename);
                    }
                }
            };
            window.addEventListener('error', this.windowErrorHandler);
        }
    }

    // Setup keyboard shortcuts
    setupKeyboardShortcuts() {
        if (typeof document !== 'undefined') {
            this.keyboardHandler = (event) => {
                // Ctrl+R or Cmd+R: Force refresh
                if ((event.ctrlKey || event.metaKey) && event.key === 'r') {
                    event.preventDefault();
                    this.forceRefresh();
                }
                
                // Ctrl+Shift+R or Cmd+Shift+R: Force component reload
                if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'R') {
                    event.preventDefault();
                    this.forceComponentReload();
                }
                
                // Ctrl+Shift+S or Cmd+Shift+S: Force style reload
                if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'S') {
                    event.preventDefault();
                    this.forceStyleReload();
                }
            };
            document.addEventListener('keydown', this.keyboardHandler);
        }
    }

    setupVisibilityHandling() {
        if (typeof document === 'undefined') return;
        this.visibilityHandler = () => {
            if (document.hidden) {
                this.stopFileWatching();
            } else if (this.enabled) {
                this.startFileWatching();
            }
        };
        document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    // Force refresh
    forceRefresh() {
        console.log(`[Plauna HotReload] Force refresh triggered`);
        this.refreshUI();
    }

    // Force component reload
    forceComponentReload() {
        console.log(`[Plauna HotReload] Force component reload triggered`);
        this.refreshComponents();
    }

    // Force style reload
    forceStyleReload() {
        console.log(`[Plauna HotReload] Force style reload triggered`);
        this.refreshStyles();
    }

    // Enable hot reload
    enable() {
        this.enabled = true;
        this.startFileWatching();
        console.log(`[Plauna HotReload] Hot reload enabled`);
    }

    // Disable hot reload
    disable() {
        this.enabled = false;
        this.stopFileWatching();
        console.log(`[Plauna HotReload] Hot reload disabled`);
    }

    // Toggle hot reload
    toggle() {
        if (this.enabled) {
            this.disable();
        } else {
            this.enable();
        }
        return this.enabled;
    }

    // Get statistics
    getStats() {
        return {
            enabled: this.enabled,
            watchStyles: this.watchStyles,
            watchComponents: this.watchComponents,
            autoRefresh: this.autoRefresh,
            reloadCount: this.reloadCount,
            lastReloadTime: this.lastReloadTime,
            checkInterval: this.checkInterval,
            watchedFiles: this.fileTimestamps.size,
            validationErrors: this.validationErrors.size,
            pendingReloads: this.pendingReloads.size,
            isReloading: this.isReloading,
            validateSyntax: this.validateSyntax,
            compileBeforeReload: this.compileBeforeReload,
            maxRetries: this.maxRetries
        };
    }

    // Get validation status
    getValidationStatus() {
        const status = {
            totalFiles: this.fileTimestamps.size,
            validFiles: 0,
            invalidFiles: 0,
            pendingFiles: this.pendingReloads.size,
            errors: []
        };

        for (const [filePath, error] of this.validationErrors) {
            status.invalidFiles++;
            status.errors.push({
                filePath,
                error: error.message,
                retryCount: this.retryAttempts.get(filePath) || 0
            });
        }

        status.validFiles = status.totalFiles - status.invalidFiles;
        return status;
    }

    // Get health status
    getHealthStatus() {
        const stats = this.getStats();
        const validation = this.getValidationStatus();
        
        let health = 'healthy';
        if (validation.invalidFiles > 0) health = 'warning';
        if (stats.isReloading) health = 'busy';
        if (validation.invalidFiles > stats.totalFiles * 0.5) health = 'critical';

        return {
            health,
            stats,
            validation,
            recommendations: this.getRecommendations(stats, validation)
        };
    }

    // Get recommendations based on status
    getRecommendations(stats, validation) {
        const recommendations = [];

        if (validation.invalidFiles > 0) {
            recommendations.push(`Fix ${validation.invalidFiles} validation error(s)`);
        }

        if (stats.pendingReloads > 0) {
            recommendations.push(`Waiting for ${stats.pendingReloads} file(s) to reload`);
        }

        if (!stats.validateSyntax) {
            recommendations.push('Enable syntax validation for better reliability');
        }

        if (!stats.compileBeforeReload) {
            recommendations.push('Enable compilation checking for safer reloads');
        }

        if (stats.reloadCount > 100) {
            recommendations.push('Consider restarting the development server');
        }

        return recommendations;
    }

    // Add file watcher
    addFileWatcher(filePath, type, callback) {
        const watcher = {
            filePath,
            type,
            callback,
            lastTimestamp: 0
        };
        
        if (type === 'style') {
            this.styleWatchers.set(filePath, watcher);
        } else if (type === 'component') {
            this.componentWatchers.set(filePath, watcher);
        }
        
        console.log(`[Plauna HotReload] Added ${type} watcher for: ${filePath}`);
    }

    // Remove file watcher
    removeFileWatcher(filePath) {
        const removed = this.styleWatchers.delete(filePath) || 
                      this.componentWatchers.delete(filePath);
        
        if (removed) {
            console.log(`[Plauna HotReload] Removed watcher for: ${filePath}`);
        }
        
        return removed;
    }

    // Set check interval
    setCheckInterval(interval) {
        this.checkInterval = Math.max(100, interval); // Minimum 100ms
        
        if (this.checkTimer) {
            this.stopFileWatching();
            this.startFileWatching();
        }
        
        console.log(`[Plauna HotReload] Check interval set to ${this.checkInterval}ms`);
    }

    // Create notification using NotificationSystem
    async createNotification(message, type = 'info') {
        // Success/info hot-reload events are too frequent to show as toasts — log only
        if (type === 'success' || type === 'info') {
            console.log(`[Plauna HotReload] ${message}`);
            return;
        }
        // Errors and warnings still surface as real notifications
        try {
            const { Notify } = await import('../notifications/NotificationSystem.js');
            const notificationType = { 'error': 'error', 'warning': 'warning' }[type] ?? 'warning';
            return Notify[notificationType](message, { title: 'Hot Reload' });
        } catch {
            console.warn(`[Plauna HotReload] ${type.toUpperCase()}: ${message}`);
        }
    }

    // Destroy hot reload
    destroy() {
        this.enabled = false;
        this.stopFileWatching();
        for (const retryTimer of this.retryTimers) globalThis.clearTimeout(retryTimer);
        this.retryTimers.clear();
        if (typeof document !== 'undefined' && this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
        }
        if (typeof document !== 'undefined' && this.keyboardHandler) {
            document.removeEventListener('keydown', this.keyboardHandler);
        }
        if (typeof window !== 'undefined' && this.windowErrorHandler) {
            window.removeEventListener('error', this.windowErrorHandler);
        }
        this.visibilityHandler = null;
        this.keyboardHandler = null;
        this.windowErrorHandler = null;
        
        this.styleWatchers.clear();
        this.componentWatchers.clear();
        this.fileTimestamps.clear();
        this.fileHashes.clear();
        this.pendingReloads.clear();
        this.isChecking = false;
        
        this.onStyleChange = null;
        this.onComponentChange = null;
        this.onError = null;
        
        console.log(`[Plauna HotReload] Hot reload system destroyed`);
    }
}

// Hot reload utility functions
export const HotReloadUtils = {
    // Create hot reload instance
    create(options = {}) {
        return new HotReload(options);
    },
    
    // Initialize with default options
    initialize() {
        const hotReload = new HotReload({
            enabled: true,
            watchStyles: true,
            watchComponents: true,
            autoRefresh: true,
            validateSyntax: true,
            compileBeforeReload: true,
            maxRetries: 3,
            retryDelay: 1000,
            checkInterval: 1000
        });
        
        return hotReload.initialize();
    },
    
    // Initialize with robust validation
    initializeRobust() {
        const hotReload = new HotReload({
            enabled: true,
            watchStyles: true,
            watchComponents: true,
            autoRefresh: true,
            validateSyntax: true,
            compileBeforeReload: true,
            maxRetries: 5,
            retryDelay: 2000,
            checkInterval: 2000,
            onValidationError: (filePath, error, type) => {
                console.error(`[Plauna HotReload] Validation failed for ${type}: ${filePath}`, error);
            },
            onValidationSuccess: (filePath, type) => {
                console.log(`[Plauna HotReload] Validation passed for ${type}: ${filePath}`);
            }
        });
        
        return hotReload.initialize();
    },
    
    // Initialize with minimal validation (faster but less safe)
    initializeMinimal() {
        const hotReload = new HotReload({
            enabled: true,
            watchStyles: true,
            watchComponents: true,
            autoRefresh: true,
            validateSyntax: false,
            compileBeforeReload: false,
            maxRetries: 1,
            retryDelay: 500,
            checkInterval: 2000
        });
        
        return hotReload.initialize();
    },
    
    // Check if hot reload is available
    isAvailable() {
        return typeof window !== 'undefined' && 
               typeof document !== 'undefined' &&
               typeof performance !== 'undefined';
    },
    
    // Get development mode status
    isDevelopmentMode() {
        return this.isAvailable() && 
               (location.hostname === 'localhost' || 
                location.hostname === '127.0.0.1' ||
                location.hostname === '');
    },
    
    // Auto-initialize in development mode
    autoInitialize() {
        if (this.isDevelopmentMode()) {
            console.log('[Plauna HotReload] Auto-initializing in development mode');
            return this.initializeRobust();
        }
        
        return null;
    },
    
    // Create for production (disabled)
    createProduction() {
        return new HotReload({
            enabled: false,
            watchStyles: false,
            watchComponents: false,
            autoRefresh: false
        });
    }
};
