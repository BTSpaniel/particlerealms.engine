// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WidgetItem - Base class for all Plauna widgets.
 * 
 * Follows the same pattern as SpawnableItem from the editor:
 * - Static properties for metadata
 * - Static methods for configuration
 * - Registry-based discovery
 * - Category-based organization
 * 
 * @example Basic widget:
 * ```js
 * export class MyWidget extends WidgetItem {
 *     static id = 'my-widget';
 *     static name = 'My Widget';
 *     static icon = '🔧';
 *     static category = 'custom';
 *     static description = 'A custom widget for specific use case';
 *     
 *     static create(container, options = {}) {
 *         return new MyWidget(container, options);
 *     }
 * }
 * ```
 */
export class WidgetItem {
    static id = 'unknown';
    static name = 'Unknown Widget';
    static icon = '❓';
    static category = 'misc';
    static description = '';
    static tags = [];
    static dependencies = [];
    
    /**
     * Default widget options
     * @returns {Object} Default configuration
     */
    static getDefaultOptions() {
        return {
            theme: 'auto',
            size: 'medium',
            disabled: false,
            readonly: false
        };
    }
    
    /**
     * Widget theme tokens configuration
     * @returns {Object} Theme token requirements
     */
    static getThemeTokens() {
        return {
            colors: ['primary', 'background', 'text'],
            spacing: ['sm', 'md', 'lg'],
            borderRadius: ['sm', 'md'],
            fontSizes: ['sm', 'md', 'lg']
        };
    }
    
    /**
     * Widget event handlers configuration
     * @returns {Array} List of supported events
     */
    static getSupportedEvents() {
        return ['change', 'focus', 'blur', 'click'];
    }
    
    /**
     * Create widget instance
     * @param {HTMLElement} container - Container element
     * @param {Object} options - Widget options
     * @returns {Object} Widget instance
     */
    static create(container, options = {}) {
        const defaultOptions = this.getDefaultOptions();
        const mergedOptions = { ...defaultOptions, ...options };
        
        console.log(`[${this.name}] Creating widget with options:`, mergedOptions);
        
        // This should be overridden by each widget class
        throw new Error(`create() method must be implemented by ${this.name}`);
    }
    
    /**
     * Validate widget options
     * @param {Object} options - Options to validate
     * @returns {Object} Validated and cleaned options
     */
    static validateOptions(options = {}) {
        const defaultOptions = this.getDefaultOptions();
        const validated = { ...defaultOptions };
        
        // Basic validation - override in subclasses for specific validation
        for (const [key, value] of Object.entries(options)) {
            if (key in defaultOptions) {
                validated[key] = value;
            } else {
                console.warn(`[${this.name}] Unknown option: ${key}`);
            }
        }
        
        return validated;
    }
    
    /**
     * Get widget metadata
     * @returns {Object} Widget information
     */
    static getMetadata() {
        return {
            id: this.id,
            name: this.name,
            icon: this.icon,
            category: this.category,
            description: this.description,
            tags: this.tags,
            dependencies: this.dependencies,
            supportedEvents: this.getSupportedEvents(),
            themeTokens: this.getThemeTokens()
        };
    }
    
    /**
     * Check if widget supports a specific event
     * @param {string} event - Event name
     * @returns {boolean} Whether event is supported
     */
    static supportsEvent(event) {
        return this.getSupportedEvents().includes(event);
    }
    
    /**
     * Get widget documentation
     * @returns {Object} Documentation structure
     */
    static getDocumentation() {
        return {
            description: this.description || `A ${this.name} widget`,
            usage: `// Create ${this.name}\nconst widget = ${this.name}.create(container, options);`,
            options: this.getDefaultOptions(),
            events: this.getSupportedEvents(),
            examples: []
        };
    }
}
