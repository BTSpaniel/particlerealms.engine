// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Web Worker Pool - Multi-threaded asset loading and processing
 * Eliminates main thread blocking during heavy operations
 */

export class WorkerPool {
    constructor(workerScript, poolSize = navigator.hardwareConcurrency || 4) {
        this.workerScript = workerScript;
        this.poolSize = Math.min(poolSize, 8); // Cap at 8 workers
        this.workers = [];
        this.availableWorkers = [];
        this.taskQueue = [];
        this.nextTaskId = 0;
        this.pendingTasks = new Map();
        
        this.stats = {
            tasksCompleted: 0,
            tasksFailed: 0,
            totalProcessingTime: 0,
        };
    }

    async init() {
        const promises = [];
        for (let i = 0; i < this.poolSize; i++) {
            promises.push(this._createWorker(i));
        }
        await Promise.all(promises);
        console.log(`[WorkerPool] Initialized ${this.poolSize} workers`);
    }

    async _createWorker(id) {
        return new Promise((resolve, reject) => {
            try {
                const worker = new Worker(this.workerScript, { type: 'module' });
                
                worker.onmessage = (e) => this._handleWorkerMessage(worker, e);
                worker.onerror = (e) => this._handleWorkerError(worker, e);
                
                worker._id = id;
                worker._busy = false;
                
                this.workers.push(worker);
                this.availableWorkers.push(worker);
                
                resolve(worker);
            } catch (err) {
                reject(err);
            }
        });
    }

    _handleWorkerMessage(worker, event) {
        const { taskId, result, error, duration } = event.data;
        
        const task = this.pendingTasks.get(taskId);
        if (!task) return;
        
        this.pendingTasks.delete(taskId);
        worker._busy = false;
        this.availableWorkers.push(worker);
        
        if (error) {
            this.stats.tasksFailed++;
            task.reject(new Error(error));
        } else {
            this.stats.tasksCompleted++;
            this.stats.totalProcessingTime += duration || 0;
            task.resolve(result);
        }
        
        // Process next queued task
        this._processQueue();
    }

    _handleWorkerError(worker, error) {
        console.error(`[WorkerPool] Worker ${worker._id} error:`, error);
        
        // Find and reject all tasks assigned to this worker
        for (const [taskId, task] of this.pendingTasks.entries()) {
            if (task.worker === worker) {
                this.pendingTasks.delete(taskId);
                task.reject(new Error('Worker crashed'));
            }
        }
        
        worker._busy = false;
        this.availableWorkers.push(worker);
    }

    async execute(taskData, priority = 0) {
        return new Promise((resolve, reject) => {
            const taskId = this.nextTaskId++;
            const task = {
                id: taskId,
                data: taskData,
                priority,
                resolve,
                reject,
                createdAt: performance.now(),
            };
            
            this.taskQueue.push(task);
            this.taskQueue.sort((a, b) => b.priority - a.priority); // Higher priority first
            
            this._processQueue();
        });
    }

    _processQueue() {
        while (this.taskQueue.length > 0 && this.availableWorkers.length > 0) {
            const task = this.taskQueue.shift();
            const worker = this.availableWorkers.shift();
            
            worker._busy = true;
            task.worker = worker;
            this.pendingTasks.set(task.id, task);
            
            worker.postMessage({
                taskId: task.id,
                data: task.data,
            });
        }
    }

    async executeAll(tasks, priority = 0) {
        const promises = tasks.map(taskData => this.execute(taskData, priority));
        return Promise.all(promises);
    }

    getStats() {
        return {
            ...this.stats,
            poolSize: this.poolSize,
            busyWorkers: this.workers.filter(w => w._busy).length,
            queuedTasks: this.taskQueue.length,
            pendingTasks: this.pendingTasks.size,
            avgProcessingTime: this.stats.tasksCompleted > 0 
                ? this.stats.totalProcessingTime / this.stats.tasksCompleted 
                : 0,
        };
    }

    terminate() {
        for (const worker of this.workers) {
            worker.terminate();
        }
        this.workers = [];
        this.availableWorkers = [];
        this.taskQueue = [];
        this.pendingTasks.clear();
    }
}
