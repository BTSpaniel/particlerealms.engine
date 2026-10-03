// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Upload - File upload widget for Plauna
 * Provides advanced file upload with drag-and-drop, progress, and preview
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { formatAcceptMatchReport } from '../../../engine/core/math/FormatMath.js';
import { uniformDistribution } from '../../../engine/core/math/MathRandom.js';

let _uploadSequence = 0;

function _newUploadId() {
    return `upload-${Date.now()}-${++_uploadSequence}`;
}

export class Upload extends UINode {
    // Widget metadata
    static id = 'upload';
    static name = 'Upload';
    static category = 'input';
    static icon = '⬆️';
    static description = 'File upload widget';
    static tags = ['input', 'upload', 'file'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            accept: '*/*',
            multiple: false,
            disabled: false
        };
    }
    
    static create(container, options = {}) {
        const instance = new Upload(_newUploadId(), options);
        if (container && container instanceof HTMLElement) {
            const { widgetRenderer } = require('../WidgetRenderer.js');
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newUploadId(), options = {}) {
        super(id, 'upload');
        
        // Upload-specific properties
        this.files = options.files || [];
        this.accept = options.accept || '*/*'; // MIME types or file extensions
        this.multiple = options.multiple || false;
        this.maxFiles = options.maxFiles || 5;
        this.maxSize = options.maxSize || 10 * 1024 * 1024; // 10MB default
        this.required = options.required || false;
        this.disabled = options.disabled || false;
        
        // UI properties
        this.label = options.label || 'Upload files';
        this.helper = options.helper || '';
        this.error = options.error || '';
        this.size = options.size || 'md'; // sm, md, lg
        this.variant = options.variant || 'default'; // default, compact, inline
        this.showPreview = options.showPreview !== false;
        this.showProgress = options.showProgress !== false;
        this.dragOver = false;
        
        // Upload state
        this.uploading = false;
        this.uploadProgress = 0;
        this.uploadedFiles = [];
        
        // Events
        this.onSelect = options.onSelect || (() => {});
        this.onUpload = options.onUpload || (() => {});
        this.onProgress = options.onProgress || (() => {});
        this.onComplete = options.onComplete || (() => {});
        this.onError = options.onError || (() => {});
        this.onRemove = options.onRemove || (() => {});
        
        // Accessibility
        this.ariaLabel = options.ariaLabel || this.label;
        this.ariaDescribedBy = options.ariaDescribedBy || null;
        
        // Set default styles
        this.setupStyles();
        
        // Create upload structure
        this.createUploadStructure();
        
        // Setup event handlers
        this.setupEventHandlers();
    }
    
    createUploadStructure() {
        // Create container
        this.container = document.createElement('div');
        this.container.className = 'plauna-upload-container';
        this.container.setAttribute('data-size', this.size);
        this.container.setAttribute('data-variant', this.variant);
        
        // Create label if provided
        if (this.label) {
            this.labelElement = document.createElement('label');
            this.labelElement.className = 'plauna-upload-label';
            this.labelElement.textContent = this.label;
            this.labelElement.setAttribute('for', this.id);
            this.labelElement.style.cssText = this.getLabelStyles();
            this.container.appendChild(this.labelElement);
        }
        
        // Create upload area
        this.uploadArea = document.createElement('div');
        this.uploadArea.className = 'plauna-upload-area';
        this.uploadArea.style.cssText = this.getUploadAreaStyles();
        
        // Create upload content
        const uploadContent = document.createElement('div');
        uploadContent.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'align-items: center;' +
            'justify-content: center;' +
            'gap: ' + tokens.get('spacing.md') + ';' +
            'padding: ' + tokens.get('spacing.xl') + ';' +
            'text-align: center;'
        );
        
        // Upload icon
        const uploadIcon = document.createElement('div');
        uploadIcon.textContent = '📤';
        uploadIcon.style.cssText = (
            'font-size: 48px;' +
            'opacity: 0.6;' +
            'margin-bottom: ' + tokens.get('spacing.sm') + ';'
        );
        
        // Upload text
        const uploadText = document.createElement('div');
        uploadText.textContent = this.multiple ? 'Drag & drop files here or click to browse' : 'Drag & drop a file here or click to browse';
        uploadText.style.cssText = (
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'margin-bottom: ' + tokens.get('spacing.xs') + ';'
        );
        
        // Subtitle
        const subtitle = document.createElement('div');
        subtitle.textContent = this.getSubtitleText();
        subtitle.style.cssText = (
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'font-size: ' + tokens.get('fontSizes.xs') + ';'
        );
        
        // Browse button
        const browseButton = document.createElement('button');
        browseButton.type = 'button';
        browseButton.textContent = 'Browse files';
        browseButton.style.cssText = this.getBrowseButtonStyles();
        
        browseButton.addEventListener('click', () => {
            this.openFileDialog();
        });
        
        browseButton.addEventListener('mouseenter', () => {
            browseButton.style.background = '#2563eb';
        });
        
        browseButton.addEventListener('mouseleave', () => {
            browseButton.style.background = tokens.get('colors.primary');
        });
        
        // Hidden file input
        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = this.accept;
        this.fileInput.multiple = this.multiple;
        this.fileInput.disabled = this.disabled;
        this.fileInput.required = this.required;
        this.fileInput.style.cssText = 'display: none;';
        
        this.fileInput.addEventListener('change', (e) => {
            this.handleFiles(e.target.files);
        });
        
        uploadContent.appendChild(uploadIcon);
        uploadContent.appendChild(uploadText);
        uploadContent.appendChild(subtitle);
        uploadContent.appendChild(browseButton);
        
        this.uploadArea.appendChild(uploadContent);
        
        // Create files list
        this.filesList = document.createElement('div');
        this.filesList.className = 'plauna-upload-files';
        this.filesList.style.cssText = this.getFilesListStyles();
        this.updateFilesList();
        
        // Create progress bar if enabled
        if (this.showProgress) {
            this.progressBar = document.createElement('div');
            this.progressBar.className = 'plauna-upload-progress';
            this.progressBar.style.cssText = this.getProgressBarStyles();
            this.progressBar.style.display = 'none';
            
            this.progressFill = document.createElement('div');
            this.progressFill.style.cssText = this.getProgressFillStyles();
            
            this.progressText = document.createElement('div');
            this.progressText.style.cssText = this.getProgressTextStyles();
            
            this.progressBar.appendChild(this.progressFill);
            this.progressBar.appendChild(this.progressText);
        }
        
        // Create helper text if provided
        if (this.helper) {
            this.helperElement = document.createElement('div');
            this.helperElement.className = 'plauna-upload-helper';
            this.helperElement.textContent = this.helper;
            this.helperElement.style.cssText = this.getHelperStyles();
            this.container.appendChild(this.helperElement);
        }
        
        // Assemble container
        this.container.appendChild(this.fileInput);
        this.container.appendChild(this.uploadArea);
        
        if (this.progressBar) {
            this.container.appendChild(this.progressBar);
        }
        
        this.container.appendChild(this.filesList);
        
        // Set container styles
        this.container.style.cssText = this.getContainerStyles();
        
        // Append to this element
        this.appendChild(this.container);
    }
    
    setupEventHandlers() {
        // Drag and drop events
        this.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dragOver = true;
            this.updateUploadAreaStyles();
        });
        
        this.uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            this.dragOver = false;
            this.updateUploadAreaStyles();
        });
        
        this.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dragOver = false;
            this.handleFiles(e.dataTransfer.files);
            this.updateUploadAreaStyles();
        });
        
        // Prevent default drag behaviors
        this.uploadArea.addEventListener('dragenter', (e) => {
            e.preventDefault();
        });
    }
    
    handleFiles(fileList) {
        const files = Array.from(fileList);
        
        // Validate file count
        const remainingSlots = this.maxFiles - this.files.length;
        if (files.length > remainingSlots) {
            this.onError(`Maximum ${this.maxFiles} files allowed. Only ${remainingSlots} more can be added.`);
            files = files.slice(0, remainingSlots);
        }
        
        // Validate each file
        const validFiles = [];
        for (const file of files) {
            if (this.validateFile(file)) {
                validFiles.push(file);
            }
        }
        
        // Add files
        this.files = [...this.files, ...validFiles];
        
        // Update UI
        this.updateFilesList();
        this.updateUploadAreaText();
        
        // Trigger events
        this.onSelect(validFiles);
        this.markDirty(DIRTY.VALUE | DIRTY.CHILDREN);
    }
    
    validateFile(file) {
        // Check file size
        if (file.size > this.maxSize) {
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
    
    openFileDialog() {
        this.fileInput.click();
    }
    
    updateFilesList() {
        if (!this.filesList) return;
        
        this.filesList.innerHTML = '';
        
        if (this.files.length === 0) {
            return;
        }
        
        this.files.forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'plauna-upload-file-item';
            fileItem.style.cssText = this.getFileItemStyles();
            
            // File info
            const fileInfo = document.createElement('div');
            fileInfo.style.cssText = (
                'display: flex;' +
                'flex-direction: column;' +
                'gap: 4px;' +
                'flex: 1;'
            );
            
            // File name
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
            
            // File details
            const fileDetails = document.createElement('div');
            fileDetails.style.cssText = (
                'display: flex;' +
                'align-items: center;' +
                'gap: ' + tokens.get('spacing.sm') + ';'
            );
            
            // File size
            const fileSize = document.createElement('div');
            fileSize.textContent = this.formatFileSize(file.size);
            fileSize.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                'color: ' + tokens.get('colors.text.secondary') + ';'
            );
            
            // File status
            const fileStatus = document.createElement('div');
            fileStatus.textContent = this.getFileStatus(file);
            fileStatus.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'padding: 2px 6px;' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'background: ' + this.getStatusColor(file) + ';' +
                'color: white;'
            );
            
            fileDetails.appendChild(fileSize);
            fileDetails.appendChild(fileStatus);
            
            fileInfo.appendChild(fileName);
            fileInfo.appendChild(fileDetails);
            
            // Actions
            const actions = document.createElement('div');
            actions.style.cssText = (
                'display: flex;' +
                'gap: ' + tokens.get('spacing.xs') + ';' +
                'align-items: center;'
            );
            
            // Preview button
            if (this.showPreview && this.isImageFile(file)) {
                const previewButton = document.createElement('button');
                previewButton.type = 'button';
                previewButton.textContent = '👁';
                previewButton.style.cssText = this.getActionButtonStyles();
                
                previewButton.addEventListener('click', () => {
                    this.previewFile(file);
                });
                
                actions.appendChild(previewButton);
            }
            
            // Upload button
            if (!this.uploadedFiles.includes(file)) {
                const uploadButton = document.createElement('button');
                uploadButton.type = 'button';
                uploadButton.textContent = '↑';
                uploadButton.style.cssText = this.getActionButtonStyles();
                
                uploadButton.addEventListener('click', () => {
                    this.uploadFile(file);
                });
                
                actions.appendChild(uploadButton);
            }
            
            // Remove button
            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.textContent = '✕';
            removeButton.style.cssText = this.getActionButtonStyles();
            
            removeButton.addEventListener('click', () => {
                this.removeFile(index);
            });
            
            actions.appendChild(removeButton);
            
            // Progress bar for individual file
            let fileProgress = null;
            if (this.showProgress) {
                fileProgress = document.createElement('div');
                fileProgress.style.cssText = this.getFileProgressStyles();
                fileProgress.style.display = 'none';
                
                const progressFill = document.createElement('div');
                progressFill.style.cssText = (
                    'height: 100%;' +
                    'background: ' + tokens.get('colors.primary') + ';' +
                    'border-radius: inherit;' +
                    'transition: width 150ms ease;'
                );
                
                fileProgress.appendChild(progressFill);
                actions.appendChild(fileProgress);
            }
            
            fileItem.appendChild(fileInfo);
            fileItem.appendChild(actions);
            
            // Store references for progress updates
            fileItem._file = file;
            fileItem._progressFill = progressFill;
            fileItem._fileProgress = fileProgress;
            
            this.filesList.appendChild(fileItem);
        });
    }
    
    uploadFile(file) {
        if (this.uploading) return;
        
        this.uploading = true;
        this.onUpload(file);
        
        // Simulate upload progress
        let progress = 0;
        const interval = setInterval(() => {
            progress += uniformDistribution(0, 20, Math.random);
            if (progress >= 100) {
                progress = 100;
                clearInterval(interval);
                this.uploading = false;
                this.uploadedFiles.push(file);
                this.onComplete(file);
                this.updateFileProgress(file, 100);
            } else {
                this.updateFileProgress(file, progress);
                this.onProgress(file, progress);
            }
        }, 200);
    }
    
    updateFileProgress(file, progress) {
        const fileItem = Array.from(this.filesList.children).find(
            item => item._file === file
        );
        
        if (fileItem && fileItem._progressFill) {
            fileItem._progressFill.style.width = progress + '%';
            
            if (fileItem._fileProgress) {
                if (progress === 100) {
                    fileItem._fileProgress.style.display = 'none';
                } else {
                    fileItem._fileProgress.style.display = 'block';
                }
            }
        }
        
        // Update overall progress
        this.updateOverallProgress();
    }
    
    updateOverallProgress() {
        if (!this.progressBar) return;
        
        const totalFiles = this.files.length;
        const uploadedFiles = this.uploadedFiles.length;
        const overallProgress = totalFiles > 0 ? (uploadedFiles / totalFiles) * 100 : 0;
        
        this.progressFill.style.width = overallProgress + '%';
        this.progressText.textContent = `${uploadedFiles} / ${totalFiles} files uploaded`;
        
        if (this.uploading || uploadedFiles > 0) {
            this.progressBar.style.display = 'block';
        } else {
            this.progressBar.style.display = 'none';
        }
    }
    
    removeFile(index) {
        const removedFile = this.files[index];
        this.files.splice(index, 1);
        
        // Remove from uploaded files if present
        const uploadedIndex = this.uploadedFiles.indexOf(removedFile);
        if (uploadedIndex > -1) {
            this.uploadedFiles.splice(uploadedIndex, 1);
        }
        
        this.updateFilesList();
        this.updateOverallProgress();
        this.onRemove(removedFile);
        this.markDirty(DIRTY.VALUE | DIRTY.CHILDREN);
    }
    
    previewFile(file) {
        if (!this.isImageFile(file)) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            // Create preview modal
            const modal = document.createElement('div');
            modal.style.cssText = (
                'position: fixed;' +
                'top: 50%;' +
                'left: 50%;' +
                'transform: translate(-50%, -50%);' +
                'background: rgba(0, 0, 0, 0.9);' +
                'border-radius: 8px;' +
                'padding: 20px;' +
                'z-index: 1000;' +
                'cursor: pointer;'
            );
            
            const img = document.createElement('img');
            img.src = e.target.result;
            img.style.cssText = (
                'max-width: 80vw;' +
                'max-height: 80vh;' +
                'object-fit: contain;'
            );
            
            modal.appendChild(img);
            document.body.appendChild(modal);
            
            modal.addEventListener('click', () => {
                document.body.removeChild(modal);
            });
        };
        
        reader.readAsDataURL(file);
    }
    
    updateUploadAreaText() {
        const uploadText = this.uploadArea.querySelector('div > div:nth-child(2)');
        const subtitle = this.uploadArea.querySelector('div > div:nth-child(3)');
        
        if (uploadText) {
            if (this.files.length > 0) {
                uploadText.textContent = `${this.files.length} file${this.files.length !== 1 ? 's' : ''} selected`;
            } else {
                uploadText.textContent = this.multiple ? 'Drag & drop files here or click to browse' : 'Drag & drop a file here or click to browse';
            }
        }
        
        if (subtitle) {
            subtitle.textContent = this.getSubtitleText();
        }
    }
    
    updateUploadAreaStyles() {
        if (this.dragOver) {
            this.uploadArea.style.background = 'rgba(59, 130, 246, 0.1)';
            this.uploadArea.style.borderColor = tokens.get('colors.primary');
        } else {
            this.uploadArea.style.background = 'rgba(255, 255, 255, 0.05)';
            this.uploadArea.style.borderColor = tokens.get('colors.border.medium');
        }
    }
    
    getSubtitleText() {
        const parts = [];
        if (this.maxFiles > 0) {
            parts.push(`Max ${this.maxFiles} files`);
        }
        if (this.maxSize > 0) {
            parts.push(`Max ${this.formatFileSize(this.maxSize)} each`);
        }
        if (this.accept !== '*/*') {
            parts.push(`Accepted: ${this.accept}`);
        }
        return parts.join(' • ');
    }
    
    isImageFile(file) {
        return file.type.startsWith('image/');
    }
    
    getFileStatus(file) {
        if (this.uploadedFiles.includes(file)) {
            return 'Uploaded';
        }
        return 'Pending';
    }
    
    getStatusColor(file) {
        if (this.uploadedFiles.includes(file)) {
            return tokens.get('colors.success');
        }
        return tokens.get('colors.warning');
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
    
    getUploadAreaStyles() {
        return (
            'border: 2px dashed ' + tokens.get('colors.border.medium') + ';' +
            'border-radius: ' + tokens.get('borderRadius.md') + ';' +
            'background: rgba(255, 255, 255, 0.05);' +
            'transition: all 150ms ease;' +
            'cursor: pointer;' +
            'position: relative;'
        );
    }
    
    getFilesListStyles() {
        return (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'margin-top: ' + tokens.get('spacing.md') + ';' +
            'max-height: 300px;' +
            'overflow-y: auto;'
        );
    }
    
    getFileItemStyles() {
        return (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: space-between;' +
            'padding: ' + tokens.get('spacing.sm') + ';' +
            'background: rgba(255, 255, 255, 0.05);' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'border: 1px solid ' + tokens.get('colors.border.light') + ';'
        );
    }
    
    getActionButtonStyles() {
        return (
            'background: transparent;' +
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'border: 1px solid ' + tokens.get('colors.border.medium') + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'width: 24px;' +
            'height: 24px;' +
            'font-size: 12px;' +
            'cursor: pointer;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'transition: all 150ms ease;'
        );
    }
    
    getFileProgressStyles() {
        return (
            'width: 100px;' +
            'height: 4px;' +
            'background: ' + tokens.get('colors.border.light') + ';' +
            'border-radius: 2px;' +
            'overflow: hidden;'
        );
    }
    
    getProgressBarStyles() {
        return (
            'margin-top: ' + tokens.get('spacing.sm') + ';' +
            'background: ' + tokens.get('colors.border.light') + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'height: 8px;' +
            'overflow: hidden;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: space-between;' +
            'padding: 0 ' + tokens.get('spacing.sm') + ';'
        );
    }
    
    getProgressFillStyles() {
        return (
            'height: 100%;' +
            'background: ' + tokens.get('colors.primary') + ';' +
            'border-radius: inherit;' +
            'transition: width 150ms ease;'
        );
    }
    
    getProgressTextStyles() {
        return (
            'font-size: ' + tokens.get('fontSizes.xs') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';'
        );
    }
    
    getBrowseButtonStyles() {
        return (
            'background: ' + tokens.get('colors.primary') + ';' +
            'color: ' + tokens.get('colors.text.inverse') + ';' +
            'border: none;' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'cursor: pointer;' +
            'transition: all 150ms ease;'
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
        this.uploadedFiles = []; // Reset uploaded files
        this.updateFilesList();
        this.updateOverallProgress();
        this.markDirty(DIRTY.VALUE | DIRTY.CHILDREN);
    }
    
    setMaxFiles(maxFiles) {
        this.maxFiles = maxFiles;
        this.markDirty(DIRTY.PROPS);
    }
    
    setMaxSize(maxSize) {
        this.maxSize = maxSize;
        this.markDirty(DIRTY.PROPS);
    }
    
    setDisabled(disabled) {
        this.disabled = disabled;
        if (this.fileInput) {
            this.fileInput.disabled = disabled;
        }
        this.markDirty(DIRTY.PROPS);
    }
    
    // Getter methods
    getFiles() {
        return this.files;
    }
    
    getFileCount() {
        return this.files.length;
    }
    
    getUploadedFiles() {
        return this.uploadedFiles;
    }
    
    getTotalSize() {
        return this.files.reduce((total, file) => total + file.size, 0);
    }
    
    // Static factory methods
    static create(container, options = {}) {
        const id = options.id || _newUploadId();
        const upload = new Upload(id, options);
        if (container) {
            container.appendChild(upload.element);
        }
        return upload;
    }
    
    static getDefaultOptions() {
        return {
            files: [],
            accept: '*/*',
            multiple: false,
            maxFiles: 5,
            maxSize: 10 * 1024 * 1024,
            disabled: false
        };
    }
    
    static createSingleFileUpload(id, options = {}) {
        return new Upload(id, {
            multiple: false,
            maxFiles: 1,
            ...options
        });
    }
    
    static createMultiFileUpload(id, options = {}) {
        return new Upload(id, {
            multiple: true,
            ...options
        });
    }
    
    static createImageUpload(id, options = {}) {
        return new Upload(id, {
            accept: 'image/*',
            showPreview: true,
            ...options
        });
    }
    
    static createDocumentUpload(id, options = {}) {
        return new Upload(id, {
            accept: '.pdf,.doc,.docx,.txt',
            multiple: false,
            ...options
        });
    }
    
    // Cleanup
    destroy() {
        if (this.fileInput) {
            this.fileInput.removeEventListener('change', this.onSelect);
        }
        
        this.innerHTML = '';
    }
}
