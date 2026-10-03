// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Time - Time picker widget for Plauna
 * Provides time selection with various formats and validation
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { degreesToRadians } from '../../../engine/core/math/UnitMath.js';

let _timeSequence = 0;

function _newTimeId() {
    return `time-${Date.now()}-${++_timeSequence}`;
}

export class Time extends UINode {
    // Widget metadata
    static id = 'time';
    static name = 'Time';
    static category = 'input';
    static icon = '⏰';
    static description = 'Time picker input';
    static tags = ['input', 'time', 'picker'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            value: '',
            format: '24h',
            disabled: false
        };
    }
    
    static create(container, options = {}) {
        const instance = new Time(_newTimeId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newTimeId(), options = {}) {
        super(id, 'time');
        
        // Time-specific properties
        this.value = options.value || '';
        this.format = options.format || '24h'; // 12h, 24h
        this.step = options.step || 1; // minutes step
        this.min = options.min || null;
        this.max = options.max || null;
        this.disabled = options.disabled || false;
        this.required = options.required || false;
        this.readonly = options.readonly || false;
        
        // UI properties
        this.label = options.label || 'Time';
        this.placeholder = options.placeholder || 'Select time';
        this.helper = options.helper || '';
        this.error = options.error || '';
        this.size = options.size || 'md'; // sm, md, lg
        this.variant = options.variant || 'default'; // default, compact, inline
        this.clockEnabled = options.showClock !== false;
        this.defaultOpen = options.defaultOpen || false;
        
        // Clock properties
        this.hour24 = this.format === '24h';
        this.showSeconds = options.showSeconds || false;
        
        // Events
        this.onChange = options.onChange || (() => {});
        this.onFocus = options.onFocus || (() => {});
        this.onBlur = options.onBlur || (() => {});
        this.onTimeSelect = options.onTimeSelect || (() => {});
        
        // Accessibility
        this.ariaLabel = options.ariaLabel || this.label;
        this.ariaDescribedBy = options.ariaDescribedBy || null;
        
        // Set default styles
        this.setupStyles();
        
        // Create time input structure
        this.createTimeStructure();
        
        // Setup event handlers
        this.setupEventHandlers();

        if (this.defaultOpen && this.clockEnabled) {
            this.showClock();
        }
    }
    
    createTimeStructure() {
        // Create container
        this.container = document.createElement('div');
        this.container.className = 'plauna-time-container';
        this.container.setAttribute('data-size', this.size);
        this.container.setAttribute('data-variant', this.variant);
        
        // Create label if provided
        if (this.label) {
            this.labelElement = document.createElement('label');
            this.labelElement.className = 'plauna-time-label';
            this.labelElement.textContent = this.label;
            this.labelElement.setAttribute('for', this.id);
            this.labelElement.style.cssText = this.getLabelStyles();
            this.container.appendChild(this.labelElement);
        }
        
        // Create input wrapper
        this.inputWrapper = document.createElement('div');
        this.inputWrapper.className = 'plauna-time-input-wrapper';
        this.inputWrapper.style.cssText = this.getInputWrapperStyles();
        
        // Create hidden time input
        this.timeInput = document.createElement('input');
        this.timeInput.type = 'time';
        this.timeInput.value = this.formatForInput(this.value);
        this.timeInput.min = this.formatForInput(this.min);
        this.timeInput.max = this.formatForInput(this.max);
        this.timeInput.step = this.step;
        this.timeInput.disabled = this.disabled;
        this.timeInput.required = this.required;
        this.timeInput.readOnly = this.readonly;
        this.timeInput.style.cssText = 'display: none;';
        
        // Create text input for custom formatting
        this.textInput = document.createElement('input');
        this.textInput.type = 'text';
        this.textInput.value = this.formatForDisplay(this.value);
        this.textInput.placeholder = this.placeholder;
        this.textInput.disabled = this.disabled;
        this.textInput.readOnly = this.readonly;
        this.textInput.style.cssText = this.getTextInputStyles();
        
        // Create clock button
        this.clockButton = document.createElement('button');
        this.clockButton.type = 'button';
        this.clockButton.textContent = '🕐';
        this.clockButton.style.cssText = this.getClockButtonStyles();
        
        // Assemble input wrapper
        this.inputWrapper.appendChild(this.textInput);
        if (this.clockEnabled) {
            this.inputWrapper.appendChild(this.clockButton);
        }
        
        // Create clock dropdown
        if (this.clockEnabled) {
            this.clockDropdown = document.createElement('div');
            this.clockDropdown.className = 'plauna-time-clock';
            this.clockDropdown.style.cssText = this.getClockDropdownStyles();
            this.createClockContent();
        }
        
        // Create helper text if provided
        if (this.helper) {
            this.helperElement = document.createElement('div');
            this.helperElement.className = 'plauna-time-helper';
            this.helperElement.textContent = this.helper;
            this.helperElement.style.cssText = this.getHelperStyles();
            this.container.appendChild(this.helperElement);
        }
        
        // Assemble container
        this.container.appendChild(this.timeInput);
        this.container.appendChild(this.inputWrapper);
        
        if (this.clockDropdown) {
            this.container.appendChild(this.clockDropdown);
        }
        
        // Set container styles
        this.container.style.cssText = this.getContainerStyles();
        
        // Append to this element
        this.appendChild(this.container);
    }
    
    createClockContent() {
        // Clock header
        const header = document.createElement('div');
        header.style.cssText = (
            'display: flex;' +
            'justify-content: space-between;' +
            'align-items: center;' +
            'padding: 14px 16px;' +
            'border-bottom: 1px solid rgba(148, 163, 184, 0.14);'
        );
        
        // Time display
        this.timeDisplay = document.createElement('div');
        this.timeDisplay.style.cssText = (
            'font-size: 18px;' +
            'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
            'color: rgba(248, 250, 252, 0.96);' +
            'font-family: monospace;' +
            'min-width: 80px;' +
            'text-align: center;'
        );
        
        header.appendChild(this.timeDisplay);
        
        // Clock face
        const clockFace = document.createElement('div');
        clockFace.style.cssText = (
            'position: relative;' +
            'width: 220px;' +
            'height: 220px;' +
            'margin: 16px auto;' +
            'border: 1px solid rgba(148, 163, 184, 0.20);' +
            'border-radius: 50%;' +
            'background: radial-gradient(circle at center, rgba(59, 130, 246, 0.08), rgba(15, 23, 42, 0.96) 68%);' +
            'box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 24px 48px rgba(2, 6, 23, 0.24);'
        );
        
        // Clock center
        const center = document.createElement('div');
        center.style.cssText = (
            'position: absolute;' +
            'top: 50%;' +
            'left: 50%;' +
            'width: 8px;' +
            'height: 8px;' +
            'background: linear-gradient(180deg, rgba(59, 130, 246, 0.98), rgba(37, 99, 235, 0.94));' +
            'border-radius: 50%;' +
            'transform: translate(-50%, -50%);'
        );
        clockFace.appendChild(center);
        
        // Hour markers
        for (let i = 0; i < 12; i++) {
            const marker = document.createElement('div');
            const angle = degreesToRadians(i * 30 - 90);
            const isMainHour = i % 3 === 0;
            const length = isMainHour ? 8 : 4;
            const width = isMainHour ? 2 : 1;
            
            marker.style.cssText = (
                'position: absolute;' +
                'top: 50%;' +
                'left: 50%;' +
                'width: ' + width + 'px;' +
                'height: ' + length + 'px;' +
                'background: rgba(248, 250, 252, 0.62);' +
                'transform-origin: center;' +
                'transform: translate(-50%, -50%) rotate(' + (i * 30) + 'deg) translateY(-' + (100 - length/2) + 'px);'
            );
            clockFace.appendChild(marker);
        }
        
        // Hour numbers
        for (let i = 1; i <= 12; i++) {
            const number = document.createElement('div');
            const angle = degreesToRadians(i * 30 - 90);
            const radius = 80;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            
            number.textContent = i.toString();
            number.style.cssText = (
                'position: absolute;' +
                'top: 50%;' +
                'left: 50%;' +
                'width: 20px;' +
                'height: 20px;' +
                'font-size: 12px;' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'color: rgba(248, 250, 252, 0.92);' +
                'text-align: center;' +
                'line-height: 20px;' +
                'transform: translate(calc(-50% + ' + x + 'px), calc(-50% + ' + y + 'px));'
            );
            clockFace.appendChild(number);
        }
        
        // Hour hand
        this.hourHand = document.createElement('div');
        this.hourHand.style.cssText = (
            'position: absolute;' +
            'top: 50%;' +
            'left: 50%;' +
            'width: 4px;' +
            'height: 60px;' +
            'background: rgba(248, 250, 252, 0.92);' +
            'border-radius: 2px;' +
            'transform-origin: center bottom;' +
            'transform: translate(-50%, -100%) rotate(0deg);' +
            'transition: transform 150ms ease;'
        );
        clockFace.appendChild(this.hourHand);
        
        // Minute hand
        this.minuteHand = document.createElement('div');
        this.minuteHand.style.cssText = (
            'position: absolute;' +
            'top: 50%;' +
            'left: 50%;' +
            'width: 3px;' +
            'height: 80px;' +
            'background: linear-gradient(180deg, rgba(59, 130, 246, 0.98), rgba(37, 99, 235, 0.94));' +
            'border-radius: 1.5px;' +
            'transform-origin: center bottom;' +
            'transform: translate(-50%, -100%) rotate(0deg);' +
            'transition: transform 150ms ease;'
        );
        clockFace.appendChild(this.minuteHand);
        
        // Second hand (optional)
        if (this.showSeconds) {
            this.secondHand = document.createElement('div');
            this.secondHand.style.cssText = (
                'position: absolute;' +
                'top: 50%;' +
                'left: 50%;' +
                'width: 1px;' +
                'height: 90px;' +
                'background: #ef4444;' +
                'border-radius: 0.5px;' +
                'transform-origin: center bottom;' +
                'transform: translate(-50%, -100%) rotate(0deg);' +
                'transition: transform 150ms ease;'
            );
            clockFace.appendChild(this.secondHand);
        }
        
        // Time input controls
        const controls = document.createElement('div');
        controls.style.cssText = (
            'display: flex;' +
            'justify-content: center;' +
            'gap: ' + tokens.get('spacing.md') + ';' +
            'padding: 14px 16px 16px;' +
            'border-top: 1px solid rgba(148, 163, 184, 0.14);'
        );
        
        // Hour input
        const hourGroup = document.createElement('div');
        hourGroup.style.cssText = 'text-align: center;';
        
        const hourLabel = document.createElement('div');
        hourLabel.textContent = 'Hour';
        hourLabel.style.cssText = (
            'font-size: ' + tokens.get('fontSizes.xs') + ';' +
            'color: rgba(248, 250, 252, 0.70);' +
            'margin-bottom: 4px;'
        );
        
        this.hourInput = document.createElement('input');
        this.hourInput.type = 'number';
        this.hourInput.min = this.hour24 ? '0' : '1';
        this.hourInput.max = this.hour24 ? '23' : '12';
        this.hourInput.style.cssText = (
            'width: 60px;' +
            'text-align: center;' +
            'border: 1px solid rgba(148, 163, 184, 0.20);' +
            'border-radius: 12px;' +
            'padding: 8px 10px;' +
            'background: rgba(15, 23, 42, 0.04);' +
            'color: rgba(248, 250, 252, 0.96);' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';'
        );
        
        hourGroup.appendChild(hourLabel);
        hourGroup.appendChild(this.hourInput);
        
        // Minute input
        const minuteGroup = document.createElement('div');
        minuteGroup.style.cssText = 'text-align: center;';
        
        const minuteLabel = document.createElement('div');
        minuteLabel.textContent = 'Min';
        minuteLabel.style.cssText = (
            'font-size: ' + tokens.get('fontSizes.xs') + ';' +
            'color: rgba(248, 250, 252, 0.70);' +
            'margin-bottom: 4px;'
        );
        
        this.minuteInput = document.createElement('input');
        this.minuteInput.type = 'number';
        this.minuteInput.min = '0';
        this.minuteInput.max = '59';
        this.minuteInput.style.cssText = (
            'width: 60px;' +
            'text-align: center;' +
            'border: 1px solid rgba(148, 163, 184, 0.20);' +
            'border-radius: 12px;' +
            'padding: 8px 10px;' +
            'background: rgba(15, 23, 42, 0.04);' +
            'color: rgba(248, 250, 252, 0.96);' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';'
        );
        
        minuteGroup.appendChild(minuteLabel);
        minuteGroup.appendChild(this.minuteInput);
        
        // AM/PM toggle (12h format)
        if (!this.hour24) {
            const ampmGroup = document.createElement('div');
            ampmGroup.style.cssText = 'text-align: center;';
            
            const ampmLabel = document.createElement('div');
            ampmLabel.textContent = 'Period';
            ampmLabel.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                'color: rgba(248, 250, 252, 0.70);' +
                'margin-bottom: 4px;'
            );
            
            this.ampmToggle = document.createElement('button');
            this.ampmToggle.type = 'button';
            this.ampmToggle.textContent = 'AM';
            this.ampmToggle.style.cssText = (
                'width: 60px;' +
                'padding: 8px 10px;' +
                'border: 1px solid rgba(148, 163, 184, 0.20);' +
                'border-radius: 12px;' +
                'background: rgba(15, 23, 42, 0.04);' +
                'color: rgba(248, 250, 252, 0.96);' +
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'cursor: pointer;'
            );
            
            this.ampmToggle.addEventListener('click', () => {
                this.ampmToggle.textContent = this.ampmToggle.textContent === 'AM' ? 'PM' : 'AM';
                this.updateFromInputs();
            });
            
            ampmGroup.appendChild(ampmLabel);
            ampmGroup.appendChild(this.ampmToggle);
            controls.appendChild(ampmGroup);
        }
        
        controls.appendChild(hourGroup);
        controls.appendChild(minuteGroup);
        
        // Assemble clock
        this.clockDropdown.appendChild(header);
        this.clockDropdown.appendChild(clockFace);
        this.clockDropdown.appendChild(controls);
        
        // Initialize clock
        this.currentTime = this.parseTime(this.value) || new Date();
        this.updateClock();
    }
    
    setupEventHandlers() {
        // Time input change
        this.timeInput.addEventListener('input', (e) => {
            this.setValue(e.target.value);
        });
        
        // Text input change
        this.textInput.addEventListener('input', (e) => {
            const value = e.target.value;
            const parsed = this.parseTime(value);
            if (parsed) {
                this.setValue(this.formatForInput(parsed));
            }
        });
        
        // Text input blur
        this.textInput.addEventListener('blur', () => {
            const value = this.textInput.value;
            const parsed = this.parseTime(value);
            if (parsed) {
                this.setValue(this.formatForInput(parsed));
            } else {
                this.textInput.value = this.formatForDisplay(this.value);
            }
            this.onBlur();
        });
        
        // Clock button click
        if (this.clockButton) {
            this.clockButton.addEventListener('click', () => {
                this.toggleClock();
            });
        }
        
        // Clock input changes
        if (this.hourInput) {
            this.hourInput.addEventListener('input', () => this.updateFromInputs());
        }
        
        if (this.minuteInput) {
            this.minuteInput.addEventListener('input', () => this.updateFromInputs());
        }
        
        // Focus/blur events
        this.textInput.addEventListener('focus', () => {
            this.onFocus();
        });
        
        // Click outside to close clock
        document.addEventListener('click', (e) => {
            if (this.clockDropdown && !this.container.contains(e.target)) {
                this.hideClock();
            }
        });
        
        // Keyboard events
        this.textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const value = this.textInput.value;
                const parsed = this.parseTime(value);
                if (parsed) {
                    this.setValue(this.formatForInput(parsed));
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.showClock();
            }
        });
    }
    
    setValue(value) {
        const parsed = this.parseTime(value);
        if (parsed && this.isValidTime(parsed)) {
            this.value = this.formatForInput(parsed);
            this.timeInput.value = this.value;
            this.textInput.value = this.formatForDisplay(parsed);
            this.currentTime = parsed;
            this.updateClock();
            this.onChange(this.value);
            this.onTimeSelect(parsed);
            this.markDirty(DIRTY.VALUE);
        }
    }
    
    toggleClock() {
        if (!this.clockDropdown) return;
        if (this.clockDropdown.style.display === 'none') {
            this.showClock();
        } else {
            this.hideClock();
        }
    }
    
    showClock() {
        if (this.clockDropdown) {
            this.clockDropdown.style.display = 'block';
            this.updateClock();
        }
    }
    
    hideClock() {
        if (this.clockDropdown) {
            this.clockDropdown.style.display = 'none';
        }
    }
    
    updateFromInputs() {
        let hours = parseInt(this.hourInput.value) || 0;
        const minutes = parseInt(this.minuteInput.value) || 0;
        
        if (!this.hour24) {
            const period = this.ampmToggle.textContent;
            if (period === 'PM' && hours !== 12) {
                hours += 12;
            } else if (period === 'AM' && hours === 12) {
                hours = 0;
            }
        }
        
        const date = new Date();
        date.setHours(hours, minutes, 0, 0);
        this.setValue(this.formatForInput(date));
    }
    
    updateClock() {
        if (!this.timeDisplay) return;
        
        const hours = this.currentTime.getHours();
        const minutes = this.currentTime.getMinutes();
        const seconds = this.currentTime.getSeconds();
        
        // Update time display
        let displayHours = hours;
        let period = '';
        
        if (!this.hour24) {
            period = hours >= 12 ? ' PM' : ' AM';
            displayHours = hours % 12 || 12;
        }
        
        const timeString = this.showSeconds 
            ? `${displayHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}${period}`
            : `${displayHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}${period}`;
        
        this.timeDisplay.textContent = timeString;
        
        // Update clock hands
        if (this.hourHand) {
            const hourAngle = ((hours % 12) + minutes / 60) * 30 - 90;
            this.hourHand.style.transform = `translate(-50%, -100%) rotate(${hourAngle}deg)`;
        }
        
        if (this.minuteHand) {
            const minuteAngle = (minutes + seconds / 60) * 6 - 90;
            this.minuteHand.style.transform = `translate(-50%, -100%) rotate(${minuteAngle}deg)`;
        }
        
        if (this.secondHand) {
            const secondAngle = seconds * 6 - 90;
            this.secondHand.style.transform = `translate(-50%, -100%) rotate(${secondAngle}deg)`;
        }
        
        // Update input fields
        if (this.hourInput) {
            this.hourInput.value = this.hour24 ? hours : (hours % 12 || 12);
        }
        
        if (this.minuteInput) {
            this.minuteInput.value = minutes;
        }
        
        if (this.ampmToggle) {
            this.ampmToggle.textContent = hours >= 12 ? 'PM' : 'AM';
        }
    }
    
    parseTime(value) {
        if (!value) return null;
        
        // Try native time parsing first
        const native = new Date();
        const timeMatch = value.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
        
        if (timeMatch) {
            let hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const seconds = timeMatch[3] ? parseInt(timeMatch[3]) : 0;
            const period = timeMatch[4] ? timeMatch[4].toLowerCase() : null;
            
            if (!this.hour24 && period) {
                if (period === 'pm' && hours !== 12) {
                    hours += 12;
                } else if (period === 'am' && hours === 12) {
                    hours = 0;
                }
            }
            
            native.setHours(hours, minutes, seconds, 0);
            return native;
        }
        
        return null;
    }
    
    formatForInput(time) {
        if (!time) return '';
        
        if (typeof time === 'string') {
            time = this.parseTime(time);
        }
        
        if (!time || isNaN(time.getTime())) return '';
        
        const hours = time.getHours();
        const minutes = time.getMinutes();
        const seconds = time.getSeconds();
        
        return this.showSeconds 
            ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
            : `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
    
    formatForDisplay(time) {
        if (!time) return '';
        
        if (typeof time === 'string') {
            time = this.parseTime(time);
        }
        
        if (!time || isNaN(time.getTime())) return '';
        
        let hours = time.getHours();
        const minutes = time.getMinutes();
        const seconds = time.getSeconds();
        
        if (!this.hour24) {
            const period = hours >= 12 ? ' PM' : ' AM';
            hours = hours % 12 || 12;
            return this.showSeconds 
                ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}${period}`
                : `${hours}:${minutes.toString().padStart(2, '0')}${period}`;
        }
        
        return this.formatForInput(time);
    }
    
    isValidTime(time) {
        if (!time || isNaN(time.getTime())) return false;
        
        if (this.min) {
            const minTime = this.parseTime(this.min);
            if (minTime && time < minTime) return false;
        }
        
        if (this.max) {
            const maxTime = this.parseTime(this.max);
            if (maxTime && time > maxTime) return false;
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
    
    getClockButtonStyles() {
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
    
    getClockDropdownStyles() {
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
        this.hour24 = format === '24h';
        this.textInput.value = this.formatForDisplay(this.value);
        this.updateClock();
        this.markDirty(DIRTY.PROPS);
    }
    
    setShowSeconds(show) {
        this.showSeconds = show;
        this.textInput.value = this.formatForDisplay(this.value);
        this.updateClock();
        this.markDirty(DIRTY.PROPS);
    }
    
    setMin(min) {
        this.min = min;
        this.timeInput.min = this.formatForInput(min);
        this.markDirty(DIRTY.PROPS);
    }
    
    setMax(max) {
        this.max = max;
        this.timeInput.max = this.formatForInput(max);
        this.markDirty(DIRTY.PROPS);
    }
    
    setDisabled(disabled) {
        this.disabled = disabled;
        if (this.timeInput) {
            this.timeInput.disabled = disabled;
        }
        if (this.textInput) {
            this.textInput.disabled = disabled;
        }
        if (this.clockButton) {
            this.clockButton.disabled = disabled;
        }
        this.markDirty(DIRTY.PROPS);
    }
    
    // Getter methods
    getValue() {
        return this.value;
    }
    
    getTime() {
        return this.parseTime(this.value);
    }
    
    getHours() {
        const time = this.getTime();
        return time ? time.getHours() : 0;
    }
    
    getMinutes() {
        const time = this.getTime();
        return time ? time.getMinutes() : 0;
    }
    
    getSeconds() {
        const time = this.getTime();
        return time ? time.getSeconds() : 0;
    }
    
    // Static factory methods
    static create(container, options = {}) {
        const id = options.id || _newTimeId();
        const time = new Time(id, options);
        return time;
    }
    
    static getDefaultOptions() {
        return {
            value: '',
            format: '24h',
            step: 1,
            disabled: false
        };
    }
    
    static create24HourPicker(id, options = {}) {
        return new Time(id, {
            format: '24h',
            ...options
        });
    }
    
    static create12HourPicker(id, options = {}) {
        return new Time(id, {
            format: '12h',
            ...options
        });
    }
    
    static createCompactTimePicker(id, options = {}) {
        return new Time(id, {
            variant: 'compact',
            ...options
        });
    }
    
    static createTimeWithSeconds(id, options = {}) {
        return new Time(id, {
            showSeconds: true,
            ...options
        });
    }

    static stories() {
        return {
            Digital24: {
                value: '14:35',
                format: '24h',
                defaultOpen: true,
                label: '24h Digital'
            },
            Digital12: {
                value: '2:35 PM',
                format: '12h',
                defaultOpen: true,
                label: '12h Digital'
            },
            Analog: {
                value: '09:15',
                format: '24h',
                defaultOpen: true,
                label: 'Analog Clock'
            },
            WithSeconds: {
                value: '14:35:20',
                format: '24h',
                showSeconds: true,
                defaultOpen: true,
                label: 'With Seconds'
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
        if (this.timeInput) {
            this.timeInput.removeEventListener('input', this.onChange);
        }
        if (this.textInput) {
            this.textInput.removeEventListener('input', this.onChange);
        }
        
        this.innerHTML = '';
    }
}
