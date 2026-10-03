// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Date - Date picker widget for Plauna
 * Provides date selection with various formats and validation
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';

const NativeDate = globalThis.Date;

let _dateSequence = 0;

function _newDateId() {
    return `date-${NativeDate.now()}-${++_dateSequence}`;
}

export class Date extends UINode {
    // Widget metadata
    static id = 'date';
    static name = 'Date';
    static category = 'input';
    static icon = '📅';
    static description = 'Date picker input';
    static tags = ['input', 'date', 'picker'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            value: '',
            format: 'YYYY-MM-DD',
            disabled: false
        };
    }
    
    static create(container, options = {}) {
        const instance = new Date(_newDateId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newDateId(), options = {}) {
        super(id, 'date');
        
        // Date-specific properties
        this.value = options.value || '';
        this.format = options.format || 'YYYY-MM-DD'; // YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY
        this.locale = options.locale || (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
        this.min = options.min || null;
        this.max = options.max || null;
        this.disabled = options.disabled || false;
        this.required = options.required || false;
        this.readonly = options.readonly || false;
        
        // UI properties
        this.label = options.label || 'Date';
        this.placeholder = options.placeholder || 'Select date';
        this.helper = options.helper || '';
        this.error = options.error || '';
        this.size = options.size || 'md'; // sm, md, lg
        this.variant = options.variant || 'default'; // default, compact, inline
        this.calendarEnabled = options.showCalendar !== false;
        this.defaultOpen = options.defaultOpen || false;
        
        // Calendar properties
        this.firstDayOfWeek = options.firstDayOfWeek || 0; // 0 = Sunday, 1 = Monday
        this.showWeekNumbers = options.showWeekNumbers || false;
        this.highlightToday = options.highlightToday !== false;
        this.highlightWeekends = options.highlightWeekends || false;
        
        // Events
        this.onChange = options.onChange || (() => {});
        this.onFocus = options.onFocus || (() => {});
        this.onBlur = options.onBlur || (() => {});
        this.onDateSelect = options.onDateSelect || (() => {});
        
        // Accessibility
        this.ariaLabel = options.ariaLabel || this.label;
        this.ariaDescribedBy = options.ariaDescribedBy || null;
        
        // Set default styles
        this.setupStyles();
        
        // Create date input structure
        this.createDateStructure();
        
        // Setup event handlers
        this.setupEventHandlers();

        if (this.defaultOpen && this.calendarEnabled) {
            this.showCalendar();
        }
    }
    
    createDateStructure() {
        // Create container
        this.container = document.createElement('div');
        this.container.className = 'plauna-date-container';
        this.container.setAttribute('data-size', this.size);
        this.container.setAttribute('data-variant', this.variant);
        
        // Create label if provided
        if (this.label) {
            this.labelElement = document.createElement('label');
            this.labelElement.className = 'plauna-date-label';
            this.labelElement.textContent = this.label;
            this.labelElement.setAttribute('for', this.id);
            this.labelElement.style.cssText = this.getLabelStyles();
            this.container.appendChild(this.labelElement);
        }
        
        // Create input wrapper
        this.inputWrapper = document.createElement('div');
        this.inputWrapper.className = 'plauna-date-input-wrapper';
        this.inputWrapper.style.cssText = this.getInputWrapperStyles();
        
        // Create hidden date input
        this.dateInput = document.createElement('input');
        this.dateInput.type = 'date';
        this.dateInput.value = this.formatForInput(this.value);
        this.dateInput.min = this.formatForInput(this.min);
        this.dateInput.max = this.formatForInput(this.max);
        this.dateInput.disabled = this.disabled;
        this.dateInput.required = this.required;
        this.dateInput.readOnly = this.readonly;
        this.dateInput.style.cssText = 'display: none;';
        
        // Create text input for custom formatting
        this.textInput = document.createElement('input');
        this.textInput.type = 'text';
        this.textInput.value = this.formatForDisplay(this.value);
        this.textInput.placeholder = this.placeholder;
        this.textInput.disabled = this.disabled;
        this.textInput.readOnly = this.readonly;
        this.textInput.style.cssText = this.getTextInputStyles();
        
        // Create calendar button
        this.calendarButton = document.createElement('button');
        this.calendarButton.type = 'button';
        this.calendarButton.textContent = '📅';
        this.calendarButton.style.cssText = this.getCalendarButtonStyles();
        
        // Assemble input wrapper
        this.inputWrapper.appendChild(this.textInput);
        if (this.calendarEnabled) {
            this.inputWrapper.appendChild(this.calendarButton);
        }
        
        // Create calendar dropdown
        if (this.calendarEnabled) {
            this.calendarDropdown = document.createElement('div');
            this.calendarDropdown.className = 'plauna-date-calendar';
            this.calendarDropdown.style.cssText = this.getCalendarDropdownStyles();
            this.createCalendarContent();
        }
        
        // Create helper text if provided
        if (this.helper) {
            this.helperElement = document.createElement('div');
            this.helperElement.className = 'plauna-date-helper';
            this.helperElement.textContent = this.helper;
            this.helperElement.style.cssText = this.getHelperStyles();
            this.container.appendChild(this.helperElement);
        }
        
        // Assemble container
        this.container.appendChild(this.dateInput);
        this.container.appendChild(this.inputWrapper);
        
        if (this.calendarDropdown) {
            this.container.appendChild(this.calendarDropdown);
        }
        
        // Set container styles
        this.container.style.cssText = this.getContainerStyles();
        
        // Append to this element
        this.appendChild(this.container);
    }
    
    createCalendarContent() {
        // Calendar header
        const header = document.createElement('div');
        header.style.cssText = (
            'display: flex;' +
            'justify-content: space-between;' +
            'align-items: center;' +
            'padding: ' + tokens.get('spacing.sm') + ';' +
            'border-bottom: 1px solid ' + tokens.get('colors.border.light') + ';'
        );
        
        // Previous month button
        const prevButton = document.createElement('button');
        prevButton.type = 'button';
        prevButton.textContent = '‹';
        prevButton.style.cssText = this.getNavButtonStyles();
        prevButton.addEventListener('click', () => this.navigateMonth(-1));
        
        // Month/year display
        this.monthYearDisplay = document.createElement('div');
        this.monthYearDisplay.style.cssText = (
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'color: ' + tokens.get('colors.text.primary') + ';'
        );
        
        // Next month button
        const nextButton = document.createElement('button');
        nextButton.type = 'button';
        nextButton.textContent = '›';
        nextButton.style.cssText = this.getNavButtonStyles();
        nextButton.addEventListener('click', () => this.navigateMonth(1));
        
        header.appendChild(prevButton);
        header.appendChild(this.monthYearDisplay);
        header.appendChild(nextButton);
        
        // Calendar grid
        const grid = document.createElement('div');
        grid.style.cssText = (
            'display: grid;' +
            'grid-template-columns: repeat(7, 1fr);' +
            'gap: 1px;' +
            'padding: ' + tokens.get('spacing.sm') + ';'
        );
        
        // Day headers
        const weekdayFormatter = new Intl.DateTimeFormat(this.locale, { weekday: 'short' });
        const weekOffset = this.firstDayOfWeek === 1 ? 1 : 0;
        for (let i = 0; i < 7; i++) {
            const dayIndex = (weekOffset + i) % 7;
            const sampleDate = new NativeDate(2024, 0, 7 + dayIndex);
            const day = weekdayFormatter.format(sampleDate);
            const dayHeader = document.createElement('div');
            dayHeader.textContent = day;
            dayHeader.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
                'color: rgba(248, 250, 252, 0.74);' +
                'text-align: center;' +
                'padding: 8px 4px 6px;'
            );
            grid.appendChild(dayHeader);
        }
        
        // Calendar days
        this.calendarDays = [];
        for (let i = 0; i < 42; i++) {
            const dayButton = document.createElement('button');
            dayButton.type = 'button';
            dayButton.style.cssText = this.getDayButtonStyles();
            dayButton.addEventListener('click', () => this.selectDay(i));
            grid.appendChild(dayButton);
            this.calendarDays.push(dayButton);
        }
        
        // Assemble calendar
        this.calendarDropdown.appendChild(header);
        this.calendarDropdown.appendChild(grid);
        
        // Initialize calendar
        this.currentDate = this.parseDate(this.value) || new NativeDate();
        this.updateCalendar();
    }
    
    setupEventHandlers() {
        // Date input change
        this.dateInput.addEventListener('input', (e) => {
            this.setValue(e.target.value);
        });
        
        // Text input change
        this.textInput.addEventListener('input', (e) => {
            const value = e.target.value;
            const parsed = this.parseDate(value);
            if (parsed) {
                this.setValue(this.formatForInput(parsed));
            }
        });
        
        // Text input blur
        this.textInput.addEventListener('blur', () => {
            const value = this.textInput.value;
            const parsed = this.parseDate(value);
            if (parsed) {
                this.setValue(this.formatForInput(parsed));
            } else {
                this.textInput.value = this.formatForDisplay(this.value);
            }
            this.onBlur();
        });
        
        // Calendar button click
        if (this.calendarButton) {
            this.calendarButton.addEventListener('click', () => {
                this.toggleCalendar();
            });
        }
        
        // Focus/blur events
        this.textInput.addEventListener('focus', () => {
            this.onFocus();
        });
        
        // Click outside to close calendar
        document.addEventListener('click', (e) => {
            if (this.calendarDropdown && !this.container.contains(e.target)) {
                this.hideCalendar();
            }
        });
        
        // Keyboard events
        this.textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const value = this.textInput.value;
                const parsed = this.parseDate(value);
                if (parsed) {
                    this.setValue(this.formatForInput(parsed));
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.showCalendar();
            }
        });
    }
    
    setValue(value) {
        const parsed = this.parseDate(value);
        if (parsed && this.isValidDate(parsed)) {
            this.value = this.formatForInput(parsed);
            this.dateInput.value = this.value;
            this.textInput.value = this.formatForDisplay(parsed);
            this.currentDate = parsed;
            this.updateCalendar();
            this.onChange(this.value);
            this.onDateSelect(parsed);
            this.markDirty(DIRTY.VALUE);
        }
    }
    
    toggleCalendar() {
        if (!this.calendarDropdown) return;
        if (this.calendarDropdown.style.display === 'none') {
            this.showCalendar();
        } else {
            this.hideCalendar();
        }
    }
    
    showCalendar() {
        if (this.calendarDropdown) {
            this.calendarDropdown.style.display = 'block';
            this.updateCalendar();
        }
    }
    
    hideCalendar() {
        if (this.calendarDropdown) {
            this.calendarDropdown.style.display = 'none';
        }
    }
    
    navigateMonth(direction) {
        this.currentDate.setMonth(this.currentDate.getMonth() + direction);
        this.updateCalendar();
    }
    
    selectDay(index) {
        const dayDate = this.getDateForDay(index);
        if (dayDate && this.isValidDate(dayDate)) {
            this.setValue(this.formatForInput(dayDate));
            this.hideCalendar();
        }
    }
    
    updateCalendar() {
        if (!this.monthYearDisplay || !this.calendarDays) return;
        
        // Update month/year display
        this.monthYearDisplay.textContent = new Intl.DateTimeFormat(this.locale, {
            month: 'long',
            year: 'numeric'
        }).format(this.currentDate);
        
        // Calculate calendar days
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const firstDay = new NativeDate(year, month, 1);
        const startDate = new NativeDate(firstDay);
        
        // Adjust to first day of week
        const dayOfWeek = firstDay.getDay();
        startDate.setDate(startDate.getDate() - (dayOfWeek - this.firstDayOfWeek + 7) % 7);
        
        // Update day buttons
        const today = new NativeDate();
        today.setHours(0, 0, 0, 0);
        
        for (let i = 0; i < 42; i++) {
            const currentDate = new NativeDate(startDate);
            currentDate.setDate(startDate.getDate() + i);
            
            const button = this.calendarDays[i];
            button.textContent = currentDate.getDate();
            button.disabled = currentDate.getMonth() !== month;
            
            // Reset styles
            button.style.background = 'transparent';
            button.style.color = tokens.get('colors.text.primary');
            button.style.fontWeight = tokens.get('fontWeights.normal');
            
            // Highlight today
            if (this.highlightToday && currentDate.getTime() === today.getTime()) {
                button.style.background = tokens.get('colors.primary');
                button.style.color = tokens.get('colors.text.inverse');
                button.style.fontWeight = tokens.get('fontWeights.bold');
            }
            
            // Highlight weekends
            if (this.highlightWeekends && (currentDate.getDay() === 0 || currentDate.getDay() === 6)) {
                button.style.color = tokens.get('colors.error');
            }
            
            // Highlight selected date
            const selectedDate = this.parseDate(this.value);
            if (selectedDate && currentDate.getTime() === selectedDate.getTime()) {
                button.style.background = tokens.get('colors.secondary');
                button.style.color = tokens.get('colors.text.inverse');
            }
        }
    }

    getLocaleDateOrder() {
        try {
            const sample = new Intl.DateTimeFormat(this.locale, {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).formatToParts(new NativeDate(2001, 10, 22));
            const order = sample
                .filter(part => part.type === 'year' || part.type === 'month' || part.type === 'day')
                .map(part => part.type[0])
                .join('');
            return order || 'ymd';
        } catch {
            return 'ymd';
        }
    }

    parseDateParts(parts, order) {
        const a = Number(parts[0]);
        const b = Number(parts[1]);
        const c = Number(parts[2]);

        if (parts.some(part => Number.isNaN(Number(part)))) {
            return null;
        }

        if (order === 'mdy') {
            return new NativeDate(c, a - 1, b);
        }
        if (order === 'dmy') {
            return new NativeDate(c, b - 1, a);
        }
        return new NativeDate(a, b - 1, c);
    }
    
    getDateForDay(index) {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const firstDay = new NativeDate(year, month, 1);
        const startDate = new NativeDate(firstDay);
        
        const dayOfWeek = firstDay.getDay();
        startDate.setDate(startDate.getDate() - (dayOfWeek - this.firstDayOfWeek + 7) % 7);
        
        const result = new NativeDate(startDate);
        result.setDate(startDate.getDate() + index);
        return result;
    }
    
    parseDate(value) {
        if (!value) return null;

        const normalized = String(value).trim();

        // ISO / native-safe parsing
        const isoMatch = normalized.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
        if (isoMatch) {
            const parsed = new NativeDate(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
            parsed.setHours(0, 0, 0, 0);
            return parsed;
        }

        const chunkMatch = normalized.match(/^(\d{1,4})[\/.-](\d{1,2})[\/.-](\d{1,4})$/);
        if (chunkMatch) {
            const order = this.format === 'MM/DD/YYYY'
                ? 'mdy'
                : this.format === 'DD/MM/YYYY'
                    ? 'dmy'
                    : this.format === 'locale'
                        ? this.getLocaleDateOrder()
                        : 'ymd';
            const parsed = this.parseDateParts([chunkMatch[1], chunkMatch[2], chunkMatch[3]], order);
            if (parsed && !isNaN(parsed.getTime())) {
                parsed.setHours(0, 0, 0, 0);
                return parsed;
            }
        }

        const native = new NativeDate(normalized);
        if (!isNaN(native.getTime())) {
            native.setHours(0, 0, 0, 0);
            return native;
        }

        return null;
    }
    
    formatForInput(date) {
        if (!date) return '';
        
        if (typeof date === 'string') {
            date = this.parseDate(date);
        }
        
        if (!date || isNaN(date.getTime())) return '';
        
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        
        return `${year}-${month}-${day}`;
    }
    
    formatForDisplay(date) {
        if (!date) return '';
        
        if (typeof date === 'string') {
            date = this.parseDate(date);
        }
        
        if (!date || isNaN(date.getTime())) return '';
        
        switch (this.format) {
            case 'locale':
                return new Intl.DateTimeFormat(this.locale, {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }).format(date);
            case 'MM/DD/YYYY':
                return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
            case 'DD/MM/YYYY':
                return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
            default:
                return this.formatForInput(date);
        }
    }
    
    isValidDate(date) {
        if (!date || isNaN(date.getTime())) return false;
        
        if (this.min) {
            const minDate = this.parseDate(this.min);
            if (minDate && date < minDate) return false;
        }
        
        if (this.max) {
            const maxDate = this.parseDate(this.max);
            if (maxDate && date > maxDate) return false;
        }
        
        return true;
    }
    
    setupStyles() {
        this.setStyles({
            display: 'block',
            width: '100%'
        });
    }
    
    getContainerStyles() {
        return (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'width: 100%;' +
            'position: relative;'
        );
    }
    
    getLabelStyles() {
        return (
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'color: ' + tokens.get('colors.text.primary') + ';' +
            'margin-bottom: ' + tokens.get('spacing.xs') + ';' +
            'cursor: pointer;'
        );
    }
    
    getInputWrapperStyles() {
        return (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'width: 100%;'
        );
    }
    
    getTextInputStyles() {
        const sizeStyles = this.getSizeStyles();
        return (
            'flex: 1;' +
            'border: 1px solid rgba(148, 163, 184, 0.20);' +
            'border-radius: 14px;' +
            'background: rgba(15, 23, 42, 0.04);' +
            'color: ' + tokens.get('colors.text.primary') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'font-family: monospace;' +
            'outline: none;' +
            'transition: all 160ms ease;' +
            'box-sizing: border-box;' +
            'box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.08), 0 8px 18px rgba(15, 23, 42, 0.08);' +
            sizeStyles
        );
    }
    
    getSizeStyles() {
        const sizes = {
            sm: 'padding: 4px 8px;',
            md: 'padding: 6px 12px;',
            lg: 'padding: 8px 16px;'
        };
        return sizes[this.size] || sizes.md;
    }
    
    getCalendarButtonStyles() {
        return (
            'background: rgba(15, 23, 42, 0.04);' +
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'border: 1px solid rgba(148, 163, 184, 0.20);' +
            'border-radius: 14px;' +
            'padding: 10px 12px;' +
            'font-size: 14px;' +
            'cursor: pointer;' +
            'transition: all 160ms ease;' +
            'box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.08), 0 8px 18px rgba(15, 23, 42, 0.08);'
        );
    }
    
    getCalendarDropdownStyles() {
        return (
            'position: absolute;' +
            'top: 100%;' +
            'left: 0;' +
            'z-index: 1000;' +
            'background: rgba(15, 23, 42, 0.92);' +
            'border: 1px solid rgba(148, 163, 184, 0.20);' +
            'border-radius: 18px;' +
            'box-shadow: 0 24px 56px rgba(2, 6, 23, 0.24);' +
            'margin-top: 8px;' +
            'display: none;' +
            'min-width: 320px;' +
            'backdrop-filter: blur(18px) saturate(140%);'
        );
    }
    
    getNavButtonStyles() {
        return (
            'background: rgba(255, 255, 255, 0.04);' +
            'color: ' + tokens.get('colors.text.primary') + ';' +
            'border: 1px solid rgba(148, 163, 184, 0.18);' +
            'padding: 6px 10px;' +
            'font-size: 16px;' +
            'cursor: pointer;' +
            'border-radius: 12px;' +
            'transition: all 160ms ease;'
        );
    }
    
    getDayButtonStyles() {
        return (
            'background: rgba(255, 255, 255, 0.02);' +
            'color: ' + tokens.get('colors.text.primary') + ';' +
            'border: 1px solid transparent;' +
            'padding: 8px;' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'cursor: pointer;' +
            'border-radius: 12px;' +
            'transition: all 160ms ease;' +
            'min-height: 36px;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;'
        );
    }
    
    getHelperStyles() {
        return (
            'font-size: ' + tokens.get('fontSizes.xs') + ';' +
            'font-weight: ' + tokens.get('fontWeights.normal') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';'
        );
    }
    
    // Setter methods
    setFormat(format) {
        this.format = format;
        this.textInput.value = this.formatForDisplay(this.value);
        this.markDirty(DIRTY.PROPS);
    }
    
    setMin(min) {
        this.min = min;
        this.dateInput.min = this.formatForInput(min);
        this.markDirty(DIRTY.PROPS);
    }
    
    setMax(max) {
        this.max = max;
        this.dateInput.max = this.formatForInput(max);
        this.markDirty(DIRTY.PROPS);
    }
    
    setDisabled(disabled) {
        this.disabled = disabled;
        if (this.dateInput) {
            this.dateInput.disabled = disabled;
        }
        if (this.textInput) {
            this.textInput.disabled = disabled;
        }
        if (this.calendarButton) {
            this.calendarButton.disabled = disabled;
        }
        this.markDirty(DIRTY.PROPS);
    }
    
    // Getter methods
    getValue() {
        return this.value;
    }
    
    getDate() {
        return this.parseDate(this.value);
    }
    
    // Static factory methods
    static createStandardDatePicker(id, options = {}) {
        return new Date(id, {
            format: 'YYYY-MM-DD',
            ...options
        });
    }
    
    static createUsDatePicker(id, options = {}) {
        return new Date(id, {
            format: 'MM/DD/YYYY',
            ...options
        });
    }
    
    static createEuDatePicker(id, options = {}) {
        return new Date(id, {
            format: 'DD/MM/YYYY',
            ...options
        });
    }
    
    static createCompactDatePicker(id, options = {}) {
        return new Date(id, {
            variant: 'compact',
            ...options
        });
    }

    static stories() {
        return {
            ISO: {
                value: '2026-04-06',
                format: 'YYYY-MM-DD',
                locale: 'en-CA',
                label: 'ISO Date',
                defaultOpen: true
            },
            US: {
                value: '04/06/2026',
                format: 'MM/DD/YYYY',
                locale: 'en-US',
                label: 'US Date',
                defaultOpen: true
            },
            EU: {
                value: '06/04/2026',
                format: 'DD/MM/YYYY',
                locale: 'en-GB',
                firstDayOfWeek: 1,
                label: 'EU Date',
                defaultOpen: true
            },
            Locale: {
                value: '2026-04-06',
                format: 'locale',
                locale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
                firstDayOfWeek: 1,
                showWeekNumbers: true,
                label: 'Locale Date',
                defaultOpen: true
            }
        };
    }
    
    // Focus methods
    focus() {
        if (this.textInput) {
            this.textInput.focus();
        }
    }
    
    blur() {
        if (this.textInput) {
            this.textInput.blur();
        }
    }
    
    // Cleanup
    destroy() {
        if (this.dateInput) {
            this.dateInput.removeEventListener('input', this.onChange);
        }
        if (this.textInput) {
            this.textInput.removeEventListener('input', this.onChange);
        }
        
        this.innerHTML = '';
    }
}
