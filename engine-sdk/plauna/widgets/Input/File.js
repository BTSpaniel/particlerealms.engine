// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * File - File input widget for Plauna
 * Provides file upload functionality with drag-and-drop support
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { formatAcceptMatchReport } from '../../../engine/core/math/FormatMath.js';

let _fileSequence = 0;

function _newFileId() {
    return `file-${Date.now()}-${++_fileSequence}`;
}

export class File extends UINode {
    // Widget metadata
    static id = 'file';
    static name = 'File';
    static category = 'input';
    static icon = '📁';
    static description = 'File upload input';
    static tags = ['input', 'file', 'upload'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            accept: '*/*',
            multiple: false,
            disabled: false
        };
    }
    
    static create(container, options = {}) {
        const instance = new File(_newFileId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newFileId(), options = {}) {
        super(id, 'file');
        
        // File-specific properties
        this.accept = options.accept || '*/*'; // MIME types or file extensions
        this.multiple = options.multiple || false;
        this.required = options.required || false;
        this.disabled = options.disabled || false;
        this.capture = options.capture || null; // 'user', 'environment'
        this.maxSize = options.maxSize || null; // in bytes
        this.maxFiles = options.maxFiles || null;
        
        // UI properties
        this.label = options.label || 'Choose file';
        this.placeholder = options.placeholder || 'No file selected';
        this.helper = options.helper || '';
        this.error = options.error || '';
        this.variant = options.variant || 'default'; // default, drag-drop, compact
        this.size = options.size || 'md'; // sm, md, lg
        
        // Drag and drop
        this.dragOver = false;
        this.files = [];
        
        // Events
        this.onChange = options.onChange || (() => {});
        this.onFileSelect = options.onFileSelect || (() => {});
        this.onFileRemove = options.onFileRemove || (() => {});
        this.onError = options.onError || (() => {});
        
        // Accessibility
        this.ariaLabel = options.ariaLabel || this.label;
        this.ariaDescribedBy = options.ariaDescribedBy || null;
        
        // Set default styles
        this.setupStyles();
        
        // Create file input structure
        this.createFileStructure();
        
        // Setup event handlers
        this.setupEventHandlers();
    }
    
    createFileStructure() {
        // Create container
        this.container = document.createElement('div');
        this.container.className = 'plauna-file-container';
        this.container.setAttribute('data-size', this.size);
        this.container.setAttribute('data-variant', this.variant);
        
        // Create hidden file input
        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = this.accept;
        this.fileInput.multiple = this.multiple;
        this.fileInput.required = this.required;
        this.fileInput.disabled = this.disabled;
        this.fileInput.style.cssText = 'display: none;';
        
        if (this.capture) {
            this.fileInput.setAttribute('capture', this.capture);
        }
        
        // Create label if provided
        if (this.label) {
            this.labelElement = document.createElement('label');
            this.labelElement.className = 'plauna-file-label';
            this.labelElement.textContent = this.label;
            this.labelElement.setAttribute('for', this.id);
            this.labelElement.style.cssText = this.getLabelStyles();
            this.container.appendChild(this.labelElement);
        }
        
        // Create file drop zone
        this.dropZone = document.createElement('div');
        this.dropZone.className = 'plauna-file-dropzone';
        this.dropZone.style.cssText = this.getDropZoneStyles();
        
        // Create drop zone content
        const dropContent = document.createElement('div');
        dropContent.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'align-items: center;' +
            'justify-content: center;' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'padding: ' + tokens.get('spacing.lg') + ';' +
            'text-align: center;'
        );
        
        // Upload icon
        const uploadIcon = document.createElement('div');
        uploadIcon.textContent = '📁';
        uploadIcon.style.cssText = (
            'font-size: 48px;' +
            'opacity: 0.6;' +
            'margin-bottom: ' + tokens.get('spacing.sm') + ';'
        );
        
        // Drop text
        const dropText = document.createElement('div');
        dropText.textContent = this.placeholder;
        dropText.style.cssText = (
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'margin-bottom: ' + tokens.get('spacing.xs') + ';'
        );
        
        // Browse button
        const browseButton = document.createElement('button');
        browseButton.type = 'button';
        browseButton.textContent = 'Browse files';
        browseButton.style.cssText = (
            'background: ' + tokens.get('colors.primary') + ';' +
            'color: ' + tokens.get('colors.text.inverse') + ';' +
            'border: none;' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'padding: ' + tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm') + ';' +
            'font-size: ' + tokens.get('fontSizes.xs') + ';' +
            'cursor: pointer;' +
            'transition: all 150ms ease;'
        );
        
        browseButton.addEventListener('click', () => {
            this.fileInput.click();
        });
        
        browseButton.addEventListener('mouseenter', () => {
            browseButton.style.background = '#2563eb';
        });
        
        browseButton.addEventListener('mouseleave', () => {
            browseButton.style.background = tokens.get('colors.primary');
        });
        
        dropContent.appendChild(uploadIcon);
        dropContent.appendChild(dropText);
        dropContent.appendChild(browseButton);
        this.dropZone.appendChild(dropContent);
        
        // Create file list
        this.fileList = document.createElement('div');
        this.fileList.className = 'plauna-file-list';
        this.fileList.style.cssText = this.getFileListStyles();
        
        // Create helper text if provided
        if (this.helper) {
            this.helperElement = document.createElement('div');
            this.helperElement.className = 'plauna-file-helper';
            this.helperElement.textContent = this.helper;
            this.helperElement.style.cssText = this.getHelperStyles();
            this.container.appendChild(this.helperElement);
        }
        
        // Assemble container
        this.container.appendChild(this.fileInput);
        this.container.appendChild(this.dropZone);
        this.container.appendChild(this.fileList);
        
        // Set container styles
        this.container.style.cssText = this.getContainerStyles();
        
        // Append to this element
        this.appendChild(this.container);
    }
    
    setupEventHandlers() {
        // File input change
        this.fileInput.addEventListener('change', (e) => {
            this.handleFiles(e.target.files);
        });
        
        // Drag and drop events
        this.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dragOver = true;
            this.updateDropZoneStyles();
        });
        
        this.dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            this.dragOver = false;
            this.updateDropZoneStyles();
        });
        
        this.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dragOver = false;
            this.handleFiles(e.dataTransfer.files);
            this.updateDropZoneStyles();
        });
        
        // Prevent default drag behaviors
        this.dropZone.addEventListener('dragenter', (e) => {
            e.preventDefault();
        });
    }
    
    handleFiles(fileList) {
        const files = Array.from(fileList);
        
        // Validate file count
        if (this.maxFiles && files.length > this.maxFiles) {
            this.onError(`Maximum ${this.maxFiles} files allowed`);
            return;
        }
        
        // Validate each file
        const validFiles = [];
        for (const file of files) {
            if (this.validateFile(file)) {
                validFiles.push(file);
            }
        }
        
        // Update files
        this.files = this.multiple ? [...this.files, ...validFiles] : validFiles.slice(0, 1);
        
        // Update UI
        this.updateFileList();
        this.updateDropZoneText();
        
        // Trigger events
        this.onChange(this.files);
        validFiles.forEach(file => this.onFileSelect(file));
        
        this.markDirty(DIRTY.VALUE | DIRTY.CHILDREN);
    }
    
    validateFile(file) {
        // Check file size
        if (this.maxSize && file.size > this.maxSize) {
            this.onError(`File "${file.name}" exceeds maximum size of ${this.formatFileSize(this.maxSize)}`);
            return false;
        }
        
        // Check file type (basic validation)
        if (this.accept !== '*/*') {
            const acceptReport = formatAcceptMatchReport({
                name: file.name,
                type: file.type || '',
                size: file.size,
            }, this.accept);

            if (!acceptReport.valid) {
                this.onError(`File "${file.name}" accept filter is invalid`);
                return false;
            }
            if (!acceptReport.accepted) {
                this.onError(`File "${file.name}" is not an accepted type`);
                return false;
            }
        }

        return true;
    }
    
    updateFileList() {
        this.fileList.innerHTML = '';
        
        if (this.files.length === 0) {
            return;
        }
        
        this.files.forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.style.cssText = (
                'display: flex;' +
                'align-items: center;' +
                'justify-content: space-between;' +
                'padding: ' + tokens.get('spacing.sm') + ';' +
                'background: rgba(255, 255, 255, 0.05);' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'margin-bottom: ' + tokens.get('spacing.xs') + ';'
            );
            
            // File info
            const fileInfo = document.createElement('div');
            fileInfo.style.cssText = (
                'display: flex;' +
                'flex-direction: column;' +
                'gap: 2px;' +
                'flex: 1;'
            );
            
            const fileName = document.createElement('div');
            fileName.textContent = file.name;
            fileName.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'color: ' + tokens.get('colors.text.primary') + ';' +
                'overflow: hidden;' +
                'text-overflow: ellipsis;' +
                'white-space: nowrap;'
            );
            
            const fileSize = document.createElement('div');
            fileSize.textContent = this.formatFileSize(file.size);
            fileSize.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                'color: ' + tokens.get('colors.text.secondary') + ';'
            );
            
            fileInfo.appendChild(fileName);
            fileInfo.appendChild(fileSize);
            
            // Remove button
            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.textContent = '✕';
            removeButton.style.cssText = (
                'background: transparent;' +
                'color: ' + tokens.get('colors.text.secondary') + ';' +
                'border: none;' +
                'border-radius: 50%;' +
                'width: 20px;' +
                'height: 20px;' +
                'font-size: 12px;' +
                'cursor: pointer;' +
                'display: flex;' +
                'align-items: center;' +
                'justify-content: center;' +
                'transition: all 150ms ease;'
            );
            
            removeButton.addEventListener('click', () => {
                this.removeFile(index);
            });
            
            removeButton.addEventListener('mouseenter', () => {
                removeButton.style.background = 'rgba(239, 68, 68, 0.1)';
                removeButton.style.color = '#ef4444';
            });
            
            removeButton.addEventListener('mouseleave', () => {
                removeButton.style.background = 'transparent';
                removeButton.style.color = tokens.get('colors.text.secondary');
            });
            
            fileItem.appendChild(fileInfo);
            fileItem.appendChild(removeButton);
            this.fileList.appendChild(fileItem);
        });
    }
    
    removeFile(index) {
        const removedFile = this.files[index];
        this.files.splice(index, 1);
        this.updateFileList();
        this.updateDropZoneText();
        this.onFileRemove(removedFile);
        this.onChange(this.files);
        this.markDirty(DIRTY.VALUE | DIRTY.CHILDREN);
    }
    
    updateDropZoneText() {
        const dropText = this.dropZone.querySelector('div > div:nth-child(2)');
        if (dropText) {
            if (this.files.length > 0) {
                const fileCount = this.files.length;
                dropText.textContent = fileCount === 1 ? '1 file selected' : `${fileCount} files selected`;
            } else {
                dropText.textContent = this.placeholder;
            }
        }
    }
    
    updateDropZoneStyles() {
        if (this.dragOver) {
            this.dropZone.style.background = 'rgba(59, 130, 246, 0.1)';
            this.dropZone.style.borderColor = tokens.get('colors.primary');
        } else {
            this.dropZone.style.background = 'rgba(255, 255, 255, 0.05)';
            this.dropZone.style.borderColor = tokens.get('colors.border.medium');
        }
    }
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
            'width: 100%;'
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
    
    getDropZoneStyles() {
        return (
            'border: 2px dashed ' + tokens.get('colors.border.medium') + ';' +
            'border-radius: ' + tokens.get('borderRadius.md') + ';' +
            'background: rgba(255, 255, 255, 0.05);' +
            'transition: all 150ms ease;' +
            'cursor: pointer;' +
            'position: relative;'
        );
    }
    
    getFileListStyles() {
        return (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'margin-top: ' + tokens.get('spacing.sm') + ';' +
            'max-height: 200px;' +
            'overflow-y: auto;'
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
    setFiles(files) {
        this.files = Array.isArray(files) ? files : [files];
        this.updateFileList();
        this.updateDropZoneText();
        this.markDirty(DIRTY.VALUE | DIRTY.CHILDREN);
    }
    
    setDisabled(disabled) {
        this.disabled = disabled;
        if (this.fileInput) {
            this.fileInput.disabled = disabled;
        }
        this.markDirty(DIRTY.PROPS);
    }
    
    setError(error) {
        this.error = error;
        this.markDirty(DIRTY.PROPS);
    }
    
    // Getter methods
    getFiles() {
        return this.files;
    }
    
    getFileCount() {
        return this.files.length;
    }
    
    getTotalSize() {
        return this.files.reduce((total, file) => total + file.size, 0);
    }
    
    // Static factory methods
    static createSingleFileInput(id, options = {}) {
        return new File(id, {
            multiple: false,
            ...options
        });
    }
    
    static createMultiFileInput(id, options = {}) {
        return new File(id, {
            multiple: true,
            ...options
        });
    }
    
    static createImageUploader(id, options = {}) {
        return new File(id, {
            accept: 'image/*',
            multiple: true,
            ...options
        });
    }
    
    static createDocumentUploader(id, options = {}) {
        return new File(id, {
            accept: '.pdf,.doc,.docx,.txt',
            multiple: false,
            ...options
        });
    }
    
    // Clear all files
    clear() {
        this.files = [];
        this.fileInput.value = '';
        this.updateFileList();
        this.updateDropZoneText();
        this.markDirty(DIRTY.VALUE | DIRTY.CHILDREN);
    }
    
    // Cleanup
    destroy() {
        if (this.fileInput) {
            this.fileInput.removeEventListener('change', this.onChange);
        }
        
        this.innerHTML = '';
    }
}
