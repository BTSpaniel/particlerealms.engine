// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SpatialHash.js - Fast spatial queries for particles and entities
 * 
 * Uses a grid-based hash for O(1) average-case neighbor queries.
 */

export class SpatialHash {
    /**
     * @param {number} cellSize - Size of each grid cell
     */
    constructor(cellSize = 4) {
        this.cellSize = cellSize;
        this.invCellSize = 1 / cellSize;
        this.cells = new Map();  // Map<string, Set<object>>
    }
    
    /** Get cell key for a position */
    _key(x, y, z) {
        const cx = Math.floor(x * this.invCellSize);
        const cy = Math.floor(y * this.invCellSize);
        const cz = Math.floor(z * this.invCellSize);
        return `${cx},${cy},${cz}`;
    }
    
    /** Clear all entries */
    clear() {
        this.cells.clear();
    }
    
    /** Insert an object with position */
    insert(obj, x, y, z) {
        const key = this._key(x, y, z);
        let cell = this.cells.get(key);
        if (!cell) {
            cell = new Set();
            this.cells.set(key, cell);
        }
        cell.add(obj);
        
        // Store position on object for later removal
        obj._spatialKey = key;
        obj._spatialX = x;
        obj._spatialY = y;
        obj._spatialZ = z;
    }
    
    /** Remove an object */
    remove(obj) {
        if (!obj._spatialKey) return;
        const cell = this.cells.get(obj._spatialKey);
        if (cell) {
            cell.delete(obj);
            if (cell.size === 0) {
                this.cells.delete(obj._spatialKey);
            }
        }
        obj._spatialKey = null;
    }
    
    /** Update object position */
    update(obj, x, y, z) {
        const newKey = this._key(x, y, z);
        if (obj._spatialKey !== newKey) {
            this.remove(obj);
            this.insert(obj, x, y, z);
        } else {
            obj._spatialX = x;
            obj._spatialY = y;
            obj._spatialZ = z;
        }
    }
    
    /** Query all objects within radius of a point */
    queryRadius(x, y, z, radius, results = []) {
        const minCx = Math.floor((x - radius) * this.invCellSize);
        const maxCx = Math.floor((x + radius) * this.invCellSize);
        const minCy = Math.floor((y - radius) * this.invCellSize);
        const maxCy = Math.floor((y + radius) * this.invCellSize);
        const minCz = Math.floor((z - radius) * this.invCellSize);
        const maxCz = Math.floor((z + radius) * this.invCellSize);
        
        const radiusSq = radius * radius;
        
        for (let cz = minCz; cz <= maxCz; cz++) {
            for (let cy = minCy; cy <= maxCy; cy++) {
                for (let cx = minCx; cx <= maxCx; cx++) {
                    const cell = this.cells.get(`${cx},${cy},${cz}`);
                    if (!cell) continue;
                    
                    for (const obj of cell) {
                        const dx = obj._spatialX - x;
                        const dy = obj._spatialY - y;
                        const dz = obj._spatialZ - z;
                        const distSq = dx * dx + dy * dy + dz * dz;
                        
                        if (distSq <= radiusSq) {
                            results.push({ obj, distSq, dist: Math.sqrt(distSq) });
                        }
                    }
                }
            }
        }
        
        return results;
    }
    
    /** Query all objects in a cell */
    queryCell(x, y, z) {
        const cell = this.cells.get(this._key(x, y, z));
        return cell ? Array.from(cell) : [];
    }
    
    /** Get total object count */
    get size() {
        let count = 0;
        for (const cell of this.cells.values()) {
            count += cell.size;
        }
        return count;
    }
}

export default SpatialHash;
