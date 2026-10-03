// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * StorageBackends.js - Storage backend implementations
 * Extracted from WorldStorage.js for modularity
 * 
 * Includes:
 * - OPFSBackend (Origin Private File System)
 * - IndexedDBBackend (fallback)
 * - FileSystemBackend (user-selected folder)
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const REGIONS_DIR = 'regions';

// ============================================================================
// OPFS STORAGE BACKEND
// ============================================================================

export class OPFSBackend {
    constructor() {
        this.rootDir = null;
        this.worldDir = null;
        this.regionsDir = null;
        this.initialized = false;
    }
    
    async init(worldName) {
        try {
            this.rootDir = await navigator.storage.getDirectory();
            const worldsDir = await this.rootDir.getDirectoryHandle('worlds', { create: true });
            this.worldDir = await worldsDir.getDirectoryHandle(worldName, { create: true });
            this.regionsDir = await this.worldDir.getDirectoryHandle(REGIONS_DIR, { create: true });
            this.backupsDir = await this.worldDir.getDirectoryHandle('backups', { create: true });
            await this._cleanupTempFiles();
            this.initialized = true;
            return true;
        } catch (error) {
            console.error('[OPFSBackend] Init failed:', error);
            return false;
        }
    }
    
    async writeFile(filename, data, dir = null, retries = 3) {
        const targetDir = dir || this.worldDir;
        const tempFilename = `.${filename}.tmp`;
        
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const tempHandle = await targetDir.getFileHandle(tempFilename, { create: true });
                const writable = await tempHandle.createWritable();
                await writable.write(data);
                await writable.close();
                
                try { await targetDir.removeEntry(filename); } catch (e) {}
                
                const finalHandle = await targetDir.getFileHandle(filename, { create: true });
                const finalWritable = await finalHandle.createWritable();
                await finalWritable.write(data);
                await finalWritable.close();
                
                try { await targetDir.removeEntry(tempFilename); } catch (e) {}
                return;
            } catch (error) {
                if (error.name === 'QuotaExceededError') throw error;
                if (attempt === retries) throw error;
                await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt)));
            }
        }
    }
    
    async readFile(filename, dir = null) {
        try {
            const targetDir = dir || this.worldDir;
            const fileHandle = await targetDir.getFileHandle(filename);
            const file = await fileHandle.getFile();
            const buffer = await file.arrayBuffer();
            return new Uint8Array(buffer);
        } catch (error) {
            if (error.name === 'NotFoundError') return null;
            throw error;
        }
    }
    
    async deleteFile(filename, dir = null) {
        try {
            const targetDir = dir || this.worldDir;
            await targetDir.removeEntry(filename);
        } catch (error) {
            if (error.name !== 'NotFoundError') throw error;
        }
    }
    
    async listFiles(dir = null) {
        const targetDir = dir || this.worldDir;
        const files = [];
        for await (const entry of targetDir.values()) {
            if (entry.kind === 'file') files.push(entry.name);
        }
        return files;
    }
    
    async writeRegion(filename, data) {
        await this.writeFile(filename, data, this.regionsDir);
    }
    
    async readRegion(filename) {
        return this.readFile(filename, this.regionsDir);
    }
    
    async listRegions() {
        return this.listFiles(this.regionsDir);
    }
    
    async listRegionFiles() {
        return this.listRegions();
    }
    
    async _cleanupTempFiles() {
        try {
            for await (const entry of this.worldDir.values()) {
                if (entry.kind === 'file' && entry.name.startsWith('.') && entry.name.endsWith('.tmp')) {
                    try { await this.worldDir.removeEntry(entry.name); } catch (e) {}
                }
            }
            for await (const entry of this.regionsDir.values()) {
                if (entry.kind === 'file' && entry.name.startsWith('.') && entry.name.endsWith('.tmp')) {
                    try { await this.regionsDir.removeEntry(entry.name); } catch (e) {}
                }
            }
        } catch (e) {}
    }
}

// ============================================================================
// INDEXEDDB FALLBACK
// ============================================================================

export class IndexedDBBackend {
    constructor() {
        this.db = null;
        this.worldName = null;
    }
    
    async init(worldName) {
        this.worldName = worldName;
        
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(`WorldStorage_${worldName}`, 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => { this.db = request.result; resolve(true); };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('files')) {
                    db.createObjectStore('files', { keyPath: 'path' });
                }
                if (!db.objectStoreNames.contains('regions')) {
                    db.createObjectStore('regions', { keyPath: 'filename' });
                }
            };
        });
    }
    
    async writeFile(filename, data) {
        return this._put('files', { path: filename, data: Array.from(data), timestamp: Date.now() });
    }
    
    async readFile(filename) {
        const result = await this._get('files', filename);
        return result ? new Uint8Array(result.data) : null;
    }
    
    async deleteFile(filename) {
        return this._delete('files', filename);
    }
    
    async writeRegion(filename, data) {
        return this._put('regions', { filename, data: Array.from(data), timestamp: Date.now() });
    }
    
    async readRegion(filename) {
        const result = await this._get('regions', filename);
        return result ? new Uint8Array(result.data) : null;
    }
    
    async listRegions() {
        return this._getAllKeys('regions');
    }
    
    _put(storeName, data) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(data);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    
    _get(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    
    _delete(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    
    _getAllKeys(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAllKeys();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

// ============================================================================
// FILE SYSTEM BACKEND
// ============================================================================

export class FileSystemBackend {
    constructor() {
        this.rootDir = null;
        this.worldDir = null;
        this.regionsDir = null;
        this.initialized = false;
        this.rootId = null;
    }
    
    async init(worldName, dirHandle = null, getOrCreateRootId = null) {
        try {
            if (!dirHandle) {
                console.log('[FileSystemBackend] No directory handle provided.');
                return false;
            }
            
            const permission = await dirHandle.queryPermission({ mode: 'readwrite' });
            if (permission !== 'granted') {
                const requested = await dirHandle.requestPermission({ mode: 'readwrite' });
                if (requested !== 'granted') return false;
            }
            
            this.rootDir = dirHandle;
            
            if (getOrCreateRootId) {
                this.rootId = await getOrCreateRootId(this.rootDir);
            }
            
            const worldsDir = await this.rootDir.getDirectoryHandle('worlds', { create: true });
            this.worldDir = await worldsDir.getDirectoryHandle(worldName, { create: true });
            this.regionsDir = await this.worldDir.getDirectoryHandle('regions', { create: true });
            
            this.initialized = true;
            this.worldName = worldName;
            return true;
        } catch (error) {
            console.error('[FileSystemBackend] Init failed:', error);
            return false;
        }
    }
    
    async selectFolder(worldName, getOrCreateRootId = null) {
        try {
            const dirHandle = await window.showDirectoryPicker({
                id: 'worldStorage',
                mode: 'readwrite',
                startIn: 'documents',
            });
            return await this.init(worldName, dirHandle, getOrCreateRootId);
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('[FileSystemBackend] Folder selection failed:', error);
            }
            return false;
        }
    }
    
    async writeFile(filename, data, dir = null, retries = 2) {
        const targetDir = dir || this.worldDir;
        
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const fileHandle = await targetDir.getFileHandle(filename, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(data);
                await writable.close();
                return;
            } catch (error) {
                const isStaleHandle = error.message?.includes('state had changed') || error.name === 'InvalidStateError';
                if (isStaleHandle && attempt < retries) {
                    await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
                    continue;
                }
                throw error;
            }
        }
    }
    
    async readFile(filename, dir = null) {
        try {
            const targetDir = dir || this.worldDir;
            const fileHandle = await targetDir.getFileHandle(filename);
            const file = await fileHandle.getFile();
            const buffer = await file.arrayBuffer();
            return new Uint8Array(buffer);
        } catch (error) {
            if (error.name === 'NotFoundError') return null;
            throw error;
        }
    }
    
    async deleteFile(filename, dir = null) {
        try {
            const targetDir = dir || this.worldDir;
            await targetDir.removeEntry(filename);
        } catch (error) {
            if (error.name !== 'NotFoundError') throw error;
        }
    }
    
    async listFiles(dir = null) {
        const targetDir = dir || this.worldDir;
        const files = [];
        for await (const entry of targetDir.values()) {
            if (entry.kind === 'file') files.push(entry.name);
        }
        return files;
    }
    
    async writeRegion(filename, data) {
        await this.writeFile(filename, data, this.regionsDir);
    }
    
    async readRegion(filename) {
        return this.readFile(filename, this.regionsDir);
    }
    
    async listRegions() {
        return this.listFiles(this.regionsDir);
    }
    
    async listRegionFiles() {
        return this.listRegions();
    }
}
