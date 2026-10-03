// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ============================================================================
 * PlaunaApp - Main Plauna Application Class
 * ============================================================================
 *
 * PlaunaApp is the main application class that integrates Plauna UI with the
 * Particle Engine. It manages the visual tree, rendering, events, and
 * development tools.
 *
 * CORE COMPONENTS:
 * - VisualTree: Retained-mode UI tree (UINode hierarchy)
 * - DOMRenderer: Renders visual tree to DOM elements
 * - PlaunaEventSystem: Event handling and dispatching
 * - ThemeManager: Theme management and CSS variable application
 * - TransitionEngine: Animation and transition system
 * - PlaunaTextService: Text internationalization (pretext)
 * - PlaunaSurfaceManager: Surface/layer management
 * - PlaunaGPUBridge: GPU integration bridge
 * - PlaunaRegistry: Component registry
 *
 * DEVELOPMENT TOOLS:
 * - TreeInspector: Visual tree inspector for debugging
 * - StyleInspector: Style inspector for debugging
 * - HotReload: Hot module replacement for development
 * - PlaunaModuleTester: Module testing framework
 * - PlaunaSmartContextMenu: Context-aware right-click menu
 *
 * INTEGRATION WITH PARTICLE ENGINE:
 * - Uses ECS World from engine/ecs/world/World.js
 * - Integrates with GPU via PlaunaGPUBridge
 * - Uses PlaunaSurfaceManager for surface management
 * - Text engine integration (pretext or custom)
 *
 * INITIALIZATION FLOW:
 * 1. createPlaunaApp(options) - Factory function
 * 2. PlaunaApp constructor - Sets up core components
 * 3. initialize() - Initializes all subsystems
 * 4. mount() - Mounts to root DOM element
 *
 * OPTIONS:
 * - root: Required DOM element to mount to
 * - getVGPU: Function to get VGPU instance
 * - engine: Particle engine instance
 * - editor: Editor instance (optional)
 * - useCSS: Enable CSS injection (default: true)
 * - textEngine: Text engine to use ('pretext' or custom)
 * - enableModuleTester: Enable module tester (default: true)
 * - enableSmartContextMenu: Enable smart context menu (default: true)
 *
 * PUBLIC API:
 * - mount(): Mount app to root element
 * - destroy(): Cleanup and destroy app
 * - addComponent(): Add component to registry
 * - getComponent(): Get component from registry
 * - visualTree: Access visual tree instance
 * - renderer: Access DOM renderer instance
 * - eventSystem: Access event system instance
 * - themeManager: Access theme manager instance
 *
 * LIFECYCLE:
 * - Created via createPlaunaApp() factory
 * - Must call mount() to display UI
 * - Call destroy() to cleanup
 *
 * USAGE:
 *   const app = await createPlaunaApp({
 *       root: document.body,
 *       getVGPU: () => vgpuInstance,
 *       engine: particleEngine
 *   });
 *   await app.mount();
 *   // ... use app
 *   app.destroy();
 */

import { createWorld, createEntity } from '../../engine/ecs/world/World.js';
import { setEntityComponent } from '../../engine/ecs/storage/ArchetypeStorage.js';
import { PlaunaTextService } from '../text/pretext-service.js';
import { PlaunaSurfaceManager } from '../surface/surface-manager.js';
import { PlaunaGPUBridge } from '../particle/bridge.js';
import { PlaunaRegistry } from './registry.js';
import { PlaunaEventSystem } from './events.js';
import { VisualTree } from './VisualTree.js';
import { DOMRenderer } from './DOMRenderer.js';
import { ThemeManager } from '../style/ThemeManager.js';
import { TransitionEngine } from '../motion/TransitionEngine.js';
import { createPlaunaConsole } from '../console/PlaunaConsole.js';
import { PlaunaSmartContextMenu } from '../ui/SmartContextMenu.js';
import { StateStore } from './StateStore.js';
import { BindingEngine } from './BindingEngine.js';
import { StateChannelClient } from '../../engine/network/stateChannels/StateChannelClient.js';
import { resolveStateChannelTransport } from '../../engine/network/stateChannels/StateChannelTransportResolver.js';
import '../ecs/components.js';

/**
 * PlaunaApp factory function.
 *
 * Application factory pattern:
 * - Creates PlaunaApp instance with provided options
 * - Initializes core components (visual tree, renderer, events)
 * - Sets up development tools if enabled
 * - Returns ready-to-use app instance
 *
 * @param {Object} options - Configuration options
 * @param {HTMLElement} options.root - Required DOM element to mount to
 * @param {Function} options.getVGPU - Function to get VGPU instance
 * @param {Object} options.engine - Particle engine instance
 * @param {Object} options.editor - Editor instance (optional)
 * @param {boolean} options.useCSS - Enable CSS injection (default: true)
 * @param {string} options.textEngine - Text engine to use ('pretext' or custom)
 * @param {boolean} options.enableModuleTester - Enable module tester (default: true)
 * @param {boolean} options.enableSmartContextMenu - Enable smart context menu (default: true)
 * @param {Function} options.onSmartContextAssist - Receive a bounded semantic assist descriptor
 * @param {boolean} options.enableDeveloperTools - Mount Plauna inspectors (default: true)
 * @param {boolean} options.enableHotReload - Poll source files in development (default: true)
 * @returns {Promise<PlaunaApp>} Initialized PlaunaApp instance
 */
export async function createPlaunaApp(options = {}) {
    const {
        root,
        getVGPU,
        engine,
        editor,
        useCSS = true,
        textEngine = 'pretext',
        enableModuleTester = true,
        enableSmartContextMenu = true,
        enableDeveloperTools = true,
        enableHotReload = true,
        initialState = {},
        stateStore = null,
        stateChannelClient = null,
        stateChannelTransport = null,
        stateChannel = null,
        dispatchIntent = null,
        onSmartContextPresence = null,
        onSmartContextAssist = null,
    } = options;

    if (!root) {
        throw new Error('Plauna requires a root DOM element');
    }

    const app = new PlaunaApp({
        root,
        getVGPU,
        engine,
        editor,
        useCSS,
        textEngine,
        enableModuleTester,
        enableSmartContextMenu,
        enableDeveloperTools,
        enableHotReload,
        initialState,
        stateStore,
        stateChannelClient,
        stateChannelTransport,
        stateChannel,
        dispatchIntent,
        onSmartContextPresence,
        onSmartContextAssist,
    });

    await app.initialize();
    if (typeof window !== 'undefined') {
        window.PlaunaRuntime = app;
    }
    return app;
}

/**
 * PlaunaApp - Main Plauna application class.
 *
 * Application architecture:
 * - Integrates Plauna UI with Particle Engine
 * - Manages visual tree, rendering, events, and development tools
 * - Provides public API for component registration and access
 *
 * Core systems:
 * - uiWorld: ECS World for UI entities
 * - textService: Internationalization service
 * - surfaceManager: Surface/layer management
 * - gpuBridge: GPU integration bridge
 * - registry: Component registry
 * - events: Event system
 *
 * Retained-mode systems:
 * - visualTree: UINode hierarchy
 * - domRenderer: DOM renderer
 * - themeManager: Theme management
 * - transitionEngine: Animation system
 *
 * Development tools:
 * - treeInspector: Visual tree inspector
 * - styleInspector: Style inspector
 * - hotReload: Hot module replacement
 * - moduleTester: Module testing framework
 * - smartContextMenu: Context-aware menu
 */
export class PlaunaApp {
    constructor(options) {
        this.root = options.root;
        this.getVGPU = options.getVGPU;
        this.engine = options.engine || window.ParticleEngine;
        this.editor = options.editor;
        this.useCSS = options.useCSS;
        this.textEngine = options.textEngine;
        this.enableModuleTester = options.enableModuleTester !== false;
        this.enableSmartContextMenu = options.enableSmartContextMenu !== false;
        this.enableDeveloperTools = options.enableDeveloperTools !== false;
        this.enableHotReload = options.enableHotReload !== false;
        this.onSmartContextPresence = typeof options.onSmartContextPresence === 'function'
            ? options.onSmartContextPresence
            : null;
        this.onSmartContextAssist = typeof options.onSmartContextAssist === 'function'
            ? options.onSmartContextAssist
            : null;
        this.stateStore = options.stateStore ?? new StateStore(options.initialState ?? {});
        this.ownsStateStore = !options.stateStore;
        this.stateChannelClient = options.stateChannelClient ?? null;
        this.stateChannelTransport = options.stateChannelTransport ?? null;
        this.ownsStateChannelClient = false;
        this.ownsStateChannelTransport = false;
        if (!this.stateChannelClient && options.stateChannel?.contract) {
            const descriptor = options.stateChannel;
            this.stateChannelClient = new StateChannelClient(descriptor.contract, {
                clientId: descriptor.clientId,
                timeoutMs: descriptor.timeoutMs,
                logger: descriptor.logger,
            });
            this.stateChannelTransport = resolveStateChannelTransport({
                ...descriptor,
                channelId: descriptor.contract.id,
            });
            this.ownsStateChannelClient = true;
            this.ownsStateChannelTransport = true;
        }
        this.stateChannelRelease = null;
        this.bindingEngine = new BindingEngine({
            store: this.stateStore,
            dispatchIntent: options.dispatchIntent ?? ((intent) => this.dispatchIntent(intent)),
        });
        
        // Core systems
        this.uiWorld = null;
        this.textService = null;
        this.surfaceManager = null;
        this.gpuBridge = null;
        this.registry = new PlaunaRegistry();
        this.events = new PlaunaEventSystem();
        
        // Retained-mode systems
        this.visualTree = null;
        this.domRenderer = null;
        this.themeManager = null;
        this.transitionEngine = null;
        this.treeInspector = null;
        this.styleInspector = null;
        this.hotReload = null;
        this.smartContextMenu = null;
        
        // Console system
        this.console = null;
        this.moduleTester = null;
        this._inspectorRefreshTimer = null;
        
        // State
        this.initialized = false;
        this.activeWorkspace = null;
        this.workspaces = new Map();
    }

    async initialize() {
        console.log('[Plauna] Initializing advanced UI system...');
        this.root.classList.add('plauna-root');
        
        // Initialize PlaunaConsole first
        this.console = createPlaunaConsole();

        if (this.stateChannelClient) {
            if (this.stateChannelTransport) await this.stateChannelClient.connect(this.stateChannelTransport);
            this.stateChannelRelease = this.stateChannelClient.subscribe((projection) => {
                this.stateStore.setState(projection);
            });
            this.console.info('State channel projection binding initialized');
        }
        
        // Create dedicated UI world using existing engine pattern
        this.uiWorld = createWorld({
            name: 'UI',
            phases: ['uiBuild', 'uiLayout', 'uiRender', 'uiSync']
        });

        // Initialize retained-mode visual tree
        this.visualTree = new VisualTree();
        this.console.visualtree('initialized');

        // Initialize theme manager
        this.themeManager = new ThemeManager();
        this.console.info('Theme manager initialized');

        // Initialize transition engine
        this.transitionEngine = new TransitionEngine();
        this.console.info('Transition engine initialized');

        // Initialize text service
        this.textService = new PlaunaTextService({
            engine: this.textEngine
        });
        await this.textService.initialize();
        this.console.info('Text service initialized');

        this.domRenderer = new DOMRenderer({
            container: this.root,
            textService: this.textService,
            usePretext: true
        });
        this.visualTree.onPaintUpdate = (nodes) => {
            if (!this.visualTree.root) {
                return;
            }
            if (!this.domRenderer.getDOMElement(this.visualTree.root)) {
                this.domRenderer.render(this.visualTree);
                return;
            }
            for (const node of nodes) {
                if (!this.domRenderer.getDOMElement(node)) {
                    this.domRenderer.render(this.visualTree);
                    return;
                }
                this.domRenderer.updateNode(node);
            }
        };
        this.visualTree.onLayoutUpdate = (nodes) => {
            for (const node of nodes) {
                if (this.domRenderer.getDOMElement(node)) {
                    this.domRenderer.updateNode(node);
                }
            }
        };

        // Initialize GPU bridge only when a VGPU instance is actually available.
        const vgpu = typeof this.getVGPU === 'function' ? this.getVGPU() : null;
        if (vgpu) {
            this.gpuBridge = new PlaunaGPUBridge({
                getVGPU: () => vgpu,
                engine: this.engine,
                uiWorld: this.uiWorld,
                textService: this.textService
            });
            await this.gpuBridge.initialize();
            this.console.info('GPU bridge initialized');
        } else {
            this.console.info('GPU bridge not available - running in DOM-only mode');
        }

        // Initialize surface manager
        this.surfaceManager = new PlaunaSurfaceManager({
            gpuBridge: this.gpuBridge,
            registry: this.registry
        });
        await this.surfaceManager.initialize();
        this.console.info('Surface manager initialized');

        // Load CSS if enabled
        if (this.useCSS) {
            await this.loadStyles();
        }

        // Create default workspace
        await this.createDefaultWorkspace();

        // Initialize developer tools
        if (this.enableDeveloperTools) {
            await this.initializeDeveloperTools();
        }

        // Initialize smart context menu overlay
        if (this.enableSmartContextMenu) {
            await this.initializeSmartContextMenu();
        }

        // Initialize hot reload
        if (this.enableHotReload) {
            await this.initializeHotReload();
        }

        this.initialized = true;
        console.log('[Plauna] Initialization complete');
        
        // Emit ready event
        this.events.emit('plauna:ready', { app: this });
    }

    async loadStyles() {
        // Load Plauna CSS once and resolve relative to the module URL.
        if (document.querySelector('link[data-plauna-styles="1"]')) {
            return;
        }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = new URL('../styles/plauna.css', import.meta.url).href;
        link.dataset.plaunaStyles = '1';
        document.head.appendChild(link);
    }

    async createDefaultWorkspace() {
        const workspace = await this.createWorkspace({
            id: 'default',
            title: 'Default Workspace',
            layout: {
                left: [{ view: 'inspector' }],
                center: [{ group: 'tabs', children: ['viewport'] }],
                right: [{ view: 'assets' }],
                bottom: [{ view: 'console' }]
            }
        });
        
        this.activeWorkspace = workspace;
        return workspace;
    }

    async createWorkspace(config) {
        const workspace = {
            id: config.id,
            title: config.title,
            config: config,
            entities: new Map(),
            zones: new Map(),
            views: new Map(),
            surfaces: new Map()
        };

        // Create workspace entity in UI world
        const workspaceEntity = createEntity(this.uiWorld);
        setEntityComponent(this.uiWorld, workspaceEntity, 'UIWorkspace', {
            id: workspace.id,
            label: workspace.title,
            shellEntity: workspaceEntity
        });

        workspace.entity = workspaceEntity;
        this.workspaces.set(workspace.id, workspace);

        // Initialize zones
        await this.initializeWorkspaceZones(workspace);

        this.events.emit('plauna:workspace-created', { workspace });
        return workspace;
    }

    async initializeWorkspaceZones(workspace) {
        const zones = ['left', 'center', 'right', 'bottom', 'overlay'];
        
        for (const zoneKind of zones) {
            const zoneEntity = createEntity(this.uiWorld);
            setEntityComponent(this.uiWorld, zoneEntity, 'UIZone', {
                kind: zoneKind,
                parentWorkspace: workspace.entity,
                order: zones.indexOf(zoneKind),
                visible: true
            });

            workspace.zones.set(zoneKind, zoneEntity);
        }
    }

    async enhanceExistingPanels(editorPanels) {
        console.log('[Plauna] Enhancing existing editor panels...');
        
        // Enhance inspector with Pretext measurements
        if (editorPanels.inspector) {
            await this.enhanceInspectorPanel(editorPanels.inspector);
        }

        // Enhance viewport with GPU surfaces
        if (editorPanels.viewport) {
            await this.enhanceViewportPanel(editorPanels.viewport);
        }

        // Enhance asset panel with advanced layout
        if (editorPanels.assets) {
            await this.enhanceAssetPanel(editorPanels.assets);
        }

        this.events.emit('plauna:panels-enhanced', { panels: editorPanels });
    }

    async enhanceInspectorPanel(inspectorPanel) {
        if (!this.textService) return;

        // Add Pretext measurements to existing inspector
        const originalRefresh = inspectorPanel.refresh.bind(inspectorPanel);
        inspectorPanel.refresh = () => {
            originalRefresh();
            this.addAdvancedLayoutToInspector(inspectorPanel);
        };

        // Enhance panel header with text measurement
        const header = inspectorPanel.container.querySelector('.panel-header');
        if (header) {
            this.textService.measureElement(header);
        }
    }

    async enhanceViewportPanel(viewportPanel) {
        if (!this.surfaceManager || !viewportPanel.vgpu) return;

        // Add GPU surface capabilities to existing viewport
        const surfaceRenderer = this.surfaceManager.createRenderer(viewportPanel.vgpu);
        viewportPanel.addSurfaceRenderer?.(surfaceRenderer);

        // Add GPU text labels
        if (this.textService && this.gpuBridge) {
            const textRenderer = this.gpuBridge.buildGlyphQuads();
            viewportPanel.addTextRenderer?.(textRenderer);
        }
    }

    async enhanceAssetPanel(assetPanel) {
        if (!this.textService) return;

        // Add virtual list measurements
        const assetList = assetPanel.container.querySelector('.asset-list');
        if (assetList) {
            this.textService.enableVirtualScrolling(assetList);
        }
    }

    addAdvancedLayoutToInspector(inspectorPanel) {
        // Add advanced layout features using Pretext measurements
        const sections = inspectorPanel.container.querySelectorAll('.inspector-section');
        sections.forEach(section => {
            if (this.textService) {
                this.textService.measureSection(section);
            }
        });
    }

    // Public API methods
    registerView(id, config) {
        this.registry.registerView(id, config);
    }

    registerSurface(id, config) {
        this.registry.registerSurface(id, config);
    }

    createSurface(config) {
        if (!this.surfaceManager) {
            throw new Error('Surface manager not initialized');
        }
        return this.surfaceManager.create(config);
    }

    measureText(text, style) {
        if (!this.textService) {
            throw new Error('Text service not initialized');
        }
        return this.textService.measure(text, style);
    }

    bindOneWay(node, property, sourcePath, options = {}) {
        return this.bindingEngine.bindOneWay(node, property, sourcePath, options);
    }

    bindTwoWay(node, property, sourcePath, options = {}) {
        return this.bindingEngine.bindTwoWay(node, property, sourcePath, options);
    }

    bindIntent(node, eventType, intent, options = {}) {
        return this.bindingEngine.bindIntent(node, eventType, intent, options);
    }

    dispatchIntent(intent) {
        if (!this.stateChannelClient) throw new Error('PlaunaApp has no state channel client');
        const payload = intent.payload ?? (
            Object.hasOwn(intent, 'path') ? { path: intent.path, value: intent.value } : null
        );
        return this.stateChannelClient.submit(intent.action, payload, intent.options ?? {});
    }

    destroy() {
        console.log('[Plauna] Shutting down...');

        if (this._inspectorRefreshTimer !== null) {
            globalThis.clearInterval(this._inspectorRefreshTimer);
            this._inspectorRefreshTimer = null;
        }
        this.hotReload?.destroy?.();
        this.hotReload = null;
        document.getElementById('plauna-tree-inspector')?.remove();
        document.getElementById('plauna-style-inspector')?.remove();
        this.treeInspector = null;
        this.styleInspector = null;
        if (typeof window !== 'undefined' && window.PlaunaRuntime === this) {
            delete window.PlaunaRuntime;
        }

        this.stateChannelRelease?.();
        this.stateChannelRelease = null;
        this.bindingEngine.destroy();
        this.stateChannelClient?.disconnect?.();
        if (this.ownsStateChannelTransport) this.stateChannelTransport?.destroy?.();
        this.stateChannelTransport = null;
        if (this.ownsStateStore) this.stateStore.destroy();
        
        if (this.smartContextMenu) {
            this.smartContextMenu.destroy();
            this.smartContextMenu = null;
        }
        this.onSmartContextPresence = null;
        this.onSmartContextAssist = null;

        if (this.transitionEngine) {
            this.transitionEngine.destroy();
            this.transitionEngine = null;
        }

        // Destroy GPU resources
        if (this.gpuBridge) {
            this.gpuBridge.destroy();
        }

        // Destroy surface manager
        if (this.surfaceManager) {
            this.surfaceManager.destroy();
        }

        if (this.domRenderer) {
            this.domRenderer.destroy();
        }

        // Destroy text service
        if (this.textService) {
            this.textService.destroy();
        }

        // Clear workspaces
        this.workspaces.clear();

        // Emit destroyed event
        this.events.emit('plauna:destroyed', { app: this });

        this.initialized = false;
    }

    // Initialize developer tools
    async initializeDeveloperTools() {
        if (typeof window === 'undefined') return;
        
        console.log('[Plauna] Initializing developer tools...');
        
        // Create simple DOM-based tree inspector
        const inspectorContainer = document.createElement('div');
        inspectorContainer.id = 'plauna-tree-inspector';
        inspectorContainer.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            width: 400px;
            height: 300px;
            background: #1e1e1e;
            border: 1px solid #444;
            border-radius: 8px;
            z-index: 10000;
            display: none;
            font-family: monospace;
            font-size: 12px;
            color: white;
            overflow: auto;
            padding: 8px;
        `;
        document.body.appendChild(inspectorContainer);
        
        // Create simple tree inspector
        this.treeInspector = {
            container: inspectorContainer,
            selectedNode: null,
            render: () => {
                if (!this.visualTree || !this.visualTree.root) return;
                
                let html = '<div style="color: #4fc3f7; font-weight: bold; margin-bottom: 8px;">Visual Tree Inspector</div>';
                
                const renderNode = (node, depth = 0) => {
                    const indent = '  '.repeat(depth);
                    const selected = node === this.treeInspector.selectedNode ? ' style="background: #0078d4;"' : '';
                    const dirty = node.isDirty && node.isDirty(1) ? ' *' : '';
                    
                    html += `<div${selected}>${indent}${node.type}#${node.id}${dirty}</div>`;
                    
                    if (node.children) {
                        for (const child of node.children) {
                            renderNode(child, depth + 1);
                        }
                    }
                };
                
                renderNode(this.visualTree.root);
                inspectorContainer.innerHTML = html;
            }
        };
        
        // Create simple DOM-based style inspector
        const styleContainer = document.createElement('div');
        styleContainer.id = 'plauna-style-inspector';
        styleContainer.style.cssText = `
            position: fixed;
            bottom: 10px;
            right: 10px;
            width: 350px;
            height: 250px;
            background: #1e1e1e;
            border: 1px solid #444;
            border-radius: 8px;
            z-index: 10000;
            display: none;
            font-family: monospace;
            font-size: 12px;
            color: white;
            overflow: auto;
            padding: 8px;
        `;
        document.body.appendChild(styleContainer);
        
        // Create simple style inspector
        this.styleInspector = {
            container: styleContainer,
            selectedNode: null,
            render: () => {
                if (!this.styleInspector.selectedNode) {
                    styleContainer.innerHTML = '<div style="color: #888; font-style: italic;">Select a node to view styles</div>';
                    return;
                }
                
                const node = this.styleInspector.selectedNode;
                let html = '<div style="color: #4fc3f7; font-weight: bold; margin-bottom: 8px;">Style Inspector</div>';
                html += `<div style="color: #81c784;">${node.type}#${node.id}</div>`;
                
                if (node.style) {
                    for (const [property, value] of Object.entries(node.style)) {
                        html += `<div style="margin-left: 8px;">${property}: ${value}</div>`;
                    }
                }
                
                styleContainer.innerHTML = html;
            },
            setSelectedNode: (node) => {
                this.styleInspector.selectedNode = node;
                this.styleInspector.render();
            }
        };
        
        // Auto-render inspectors
        this._inspectorRefreshTimer = globalThis.setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return;
            this.treeInspector.render();
            this.styleInspector.render();
        }, 1000);

        if (this.enableModuleTester) {
            await this.initializeModuleTester();
        }

        console.log('[Plauna] Developer tools initialized');
    }

    // Initialize module tester
    async initializeModuleTester() {
        if (!this.console) return;

        const { PlaunaModuleTester } = await import('./ModuleTester.js');

        this.moduleTester = new PlaunaModuleTester({
            logger: this.console,
            coreChecks: [
                {
                    name: 'Plauna console is available',
                    run: () => Boolean(this.console && typeof this.console.info === 'function')
                },
                {
                    name: 'Text service is initialized',
                    run: () => Boolean(this.textService && this.textService.initialized)
                },
                {
                    name: 'Theme manager is available',
                    run: () => Boolean(this.themeManager && typeof this.themeManager.getCurrentTheme === 'function')
                },
                {
                    name: 'Widget registry is available',
                    run: () => Boolean(this.registry && typeof this.registry.registerView === 'function')
                },
                {
                    name: 'Default workspace exists',
                    run: () => Boolean(this.activeWorkspace && this.workspaces.has(this.activeWorkspace.id))
                }
            ]
        });

        await this.runModuleTests();
    }

    // Initialize smart context menu overlay
    async initializeSmartContextMenu() {
        if (typeof window === 'undefined' || !this.root) return;

        this.smartContextMenu = new PlaunaSmartContextMenu({
            app: this,
            root: this.root,
            visualTree: this.visualTree,
            domRenderer: this.domRenderer,
            console: this.console,
            radius: 140,
            maxNearby: 6,
            maxActions: 6,
            enabled: true,
            onPresenceChange: this.onSmartContextPresence,
            onAssistRequest: this.onSmartContextAssist,
        });

        this.console.info('Smart context menu initialized', {
            radius: 140,
            maxNearby: 6,
            maxActions: 6
        });
    }

    // Run module tester
    async runModuleTests() {
        if (!this.moduleTester) {
            return null;
        }

        const report = await this.moduleTester.run();
        this.console.info('Module tester summary', {
            corePassed: report.summary.corePassed,
            coreFailed: report.summary.coreFailed,
            widgetsPassed: report.summary.widgetsPassed,
            widgetsFailed: report.summary.widgetsFailed,
            widgetStoriesPassed: report.summary.widgetStoriesPassed,
            widgetStoriesFailed: report.summary.widgetStoriesFailed,
            durationMs: report.durationMs
        });

        if (report.summary.coreFailed > 0 || report.summary.widgetsFailed > 0 || report.summary.widgetStoriesFailed > 0) {
            this.console.warn('Module tester completed with issues', report.summary);
        } else {
            this.console.info('Module tester completed successfully', report.summary);
        }

        return report;
    }

    // Initialize hot reload
    async initializeHotReload() {
        if (typeof window === 'undefined') return;

        // Import HotReloadUtils
        const { HotReloadUtils } = await import('../editor/HotReload.js');

        // Hot reload polls dev source paths (/plauna/styles/*, /plauna/style/*,
        // /plauna/widgets/*) on an interval. In a deployed/bundled runtime those
        // raw paths 404 → noisy "text/html" MIME errors. Restrict the watcher to
        // development (localhost); in production keep a disabled instance so any
        // code referencing this.hotReload stays safe.
        if (!HotReloadUtils.isDevelopmentMode()) {
            this.hotReload = HotReloadUtils.createProduction();
            console.log('[Plauna] Hot reload disabled (production runtime).');
            return;
        }

        console.log('[Plauna] Initializing hot reload...');

        // Initialize robust hot reload with validation
        this.hotReload = HotReloadUtils.initializeRobust();
        
        // Set up validation callbacks
        this.hotReload.onValidationError = (filePath, error, type) => {
            // Log only — retries handle transient failures and will toast if they exhaust
            console.warn(`[Plauna] Validation error (will retry): ${type}: ${filePath}`, error?.message ?? error);
        };
        
        this.hotReload.onValidationSuccess = (filePath, type) => {
            console.log(`[Plauna] Validation passed for ${type}: ${filePath}`);
        };
        
        this.hotReload.onStyleChange = (filePath) => {
            console.log(`[Plauna] Hot reload: Style changed ${filePath}`);
            this.forceRefresh();
        };
        
        this.hotReload.onComponentChange = (filePath) => {
            console.log(`[Plauna] Hot reload: Component changed ${filePath}`);
            this.forceRefresh();
        };
        
        this.hotReload.onError = (error, type, filePath) => {
            console.error(`[Plauna] Hot reload error: ${type} in ${filePath}`, error);
            this.createNotification(`Hot reload error: ${filePath}`, 'error');
        };
        
        console.log('[Plauna] Hot reload initialized with validation');
    }

    // Toggle developer tools
    toggleDeveloperTools() {
        if (!this.treeInspector || !this.styleInspector) return;
        
        const inspector = document.getElementById('plauna-tree-inspector');
        const styleInspector = document.getElementById('plauna-style-inspector');
        
        if (inspector.style.display === 'none') {
            inspector.style.display = 'block';
            styleInspector.style.display = 'block';
        } else {
            inspector.style.display = 'none';
            styleInspector.style.display = 'none';
        }
    }

    // Get system statistics
    getSystemStats() {
        return {
            nodeCount: this.visualTree.root ? this.countNodes(this.visualTree.root) : 0,
            dirtyNodes: this.visualTree.dirtyNodes.size,
            fps: 60, // Placeholder - would be calculated
            memory: this.estimateMemory()
        };
    }

    // Count nodes recursively
    countNodes(node) {
        let count = 1;
        for (const child of node.children) {
            count += this.countNodes(child);
        }
        return count;
    }

    // Estimate memory usage
    estimateMemory() {
        if (typeof performance !== 'undefined' && performance.memory) {
            return Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
        }
        return 0;
    }

    // Force refresh
    forceRefresh() {
        if (this.visualTree && this.visualTree.root) {
            // Mark root as dirty if it has the method
            if (this.visualTree.root.markDirty) {
                this.visualTree.root.markDirty(1); // DIRTY.STYLE
            }
            
            // Update visual tree if it has the method
            if (this.visualTree.update) {
                this.visualTree.update();
            }
            
            console.log('Force refresh completed');
        }
    }

    // Toggle theme
    toggleTheme() {
        if (!this.themeManager) return;
        
        const newTheme = this.themeManager.currentTheme === 'light' ? 'dark' : 'light';
        this.themeManager.setTheme(newTheme);
    }

    // Create notification using NotificationSystem
    async createNotification(message, type = 'info') {
        try {
            // Import NotificationSystem dynamically
            const { Notify } = await import('../notifications/NotificationSystem.js');
            
            // Map notification types to notification levels
            const notificationType = {
                'error': 'error',
                'warning': 'warning', 
                'success': 'success',
                'info': 'info'
            }[type] || 'info';
            
            return Notify[notificationType](message, { title: 'Plauna' });
        } catch (error) {
            // Fallback to console if NotificationSystem is not available
            console.log(`[Plauna] ${type.toUpperCase()}: ${message}`);
        }
    }
}

// Make PlaunaApp available globally for debugging
if (typeof window !== 'undefined') {
    window.PlaunaApp = PlaunaApp;
}
