// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Plauna - Advanced UI System for Particle Engine
 * Browser-first UI runtime with hybrid DOM/GPU rendering
 *
 * ============================================================================
 * MODULE STRUCTURE
 * ============================================================================
 *
 * This is the main entry point for the Plauna UI system. It re-exports
 * all public APIs in a structured, organized manner.
 *
 * Export Categories:
 *
 * Core System:
 * - createPlaunaApp: Main application entry point
 * - PlaunaModuleTester: Module testing utilities
 * - UINode, DIRTY, NODE_STATE: Core retained-mode UI tree
 * - VisualTree: Visual tree management
 *
 * UI Components:
 * - PlaunaSmartContextMenu: Type-aware context menu for debugging
 * - PlaunaTextService: Internationalization service (Pretext)
 * - PlaunaSurfaceManager: Surface/layer management
 * - PlaunaGPUBridge: WebGPU integration bridge
 *
 * Widget System:
 * - Layout widgets: Grid, Divider, Spacer
 * - Primitive widgets: Button, Panel, Text, Modal, Tooltip, Badge, Avatar, Progress, Skeleton
 * - Form widgets: Input, Checkbox, Radio, Switch, Select, Textarea, Slider, Rating
 * - Navigation widgets: Tabs, Dropdown, Breadcrumb, Pagination
 * - Data view widgets: ListView, Card
 *
 * Utilities:
 * - Style system: Design tokens, theme management
 * - Console system: PlaunaConsole for debugging
 * - Notification system: Toast, Notify
 * - Showcase system: WidgetShowcase for widget gallery
 * - Particle controller: ParticleController for particle integration
 *
 * Lab/Development:
 * - mountPlaunaWorkbenchLab: Workbench development environment
 * - mountShowcaseApp: Widget showcase application
 */

// ============================================================================
// CORE SYSTEM EXPORTS
// ============================================================================

export { PLAUNA_VERSION, PLAUNA_FULL, BUILD_TAG } from '../engine/version.js';
export { createPlaunaApp } from './core/app.js';
export { PlaunaModuleTester } from './core/ModuleTester.js';

// ============================================================================
// UI COMPONENT EXPORTS
// ============================================================================

export { PlaunaSmartContextMenu } from './ui/SmartContextMenu.js';
export { PlaunaTextService } from './text/pretext-service.js';
export { PlaunaSurfaceManager } from './surface/surface-manager.js';
export { PlaunaGPUBridge } from './particle/bridge.js';

// ============================================================================
// LAB/DEVELOPMENT EXPORTS
// ============================================================================

export { mountPlaunaWorkbenchLab } from './lab/workbench-lab.js';
export { mountShowcaseApp, ShowcaseApp } from './lab/showcase-app.js';

// ============================================================================
// MOTION / TRANSITIONS
// ============================================================================

export { TransitionEngine, TransitionUtils } from './motion/TransitionEngine.js';
export { PageTransition, startPageTransition } from './motion/PageTransition.js';

// ============================================================================
// CONSOLE SYSTEM EXPORTS
// ============================================================================

export { createPlaunaConsole, getPlaunaConsole, PlaunaConsole } from './console/PlaunaConsole.js';

// ============================================================================
// STYLE SYSTEM EXPORTS
// ============================================================================

export * from './style/index.js';

// ============================================================================
// CORE UINODE EXPORTS
// ============================================================================

export { UINode, DIRTY, NODE_STATE, INPUT_FLAGS, RENDER_FLAGS } from './core/UINode.js';

// ============================================================================
// VISUAL TREE EXPORTS
// ============================================================================

export { VisualTree } from './core/VisualTree.js';

// ============================================================================
// CORE UTILITIES EXPORTS
// ============================================================================

export * from './core/registry.js';
export * from './core/events.js';
export { StateStore, createStore, useStore } from './core/StateStore.js';
export { BindingEngine, BindingUtils } from './core/BindingEngine.js';

// ============================================================================
// NOTIFICATION SYSTEM EXPORTS
// ============================================================================

export { Toast, ToastManager } from './ui/ToastManager.js';
export { Notify, NotificationSystem } from './notifications/NotificationSystem.js';

// ============================================================================
// WIDGET SHOWCASE SYSTEM EXPORTS
// ============================================================================

export { WidgetShowcase, widgetShowcase } from './ui/WidgetShowcase.js';

// ============================================================================
// PARTICLE CONTROLLER EXPORTS
// ============================================================================

export { ParticleController } from './particle/ParticleController.js';

// ============================================================================
// LAYOUT WIDGET EXPORTS
// ============================================================================

export { Grid } from './widgets/Layout/Grid.js';
export { Divider } from './widgets/Layout/Divider.js';
export { Spacer } from './widgets/Layout/Spacer.js';

// ============================================================================
// PRIMITIVE WIDGET EXPORTS
// ============================================================================

export { Button } from './widgets/Primitive/Button.js';
export { Panel } from './widgets/Primitive/Panel.js';
export { Text } from './widgets/Primitive/Text.js';
export { Modal } from './widgets/Primitive/Modal.js';
export { Tooltip } from './widgets/Primitive/Tooltip.js';
export { Badge } from './widgets/Primitive/Badge.js';
export { Avatar } from './widgets/Primitive/Avatar.js';
export { Progress } from './widgets/Primitive/Progress.js';
export { Skeleton } from './widgets/Primitive/Skeleton.js';

// ============================================================================
// FORM WIDGET EXPORTS
// ============================================================================

export { Input } from './widgets/Form/Input.js';
export { Checkbox } from './widgets/Form/Checkbox.js';
export { Radio } from './widgets/Form/Radio.js';
export { Switch } from './widgets/Form/Switch.js';
export { Select } from './widgets/Form/Select.js';
export { Textarea } from './widgets/Form/Textarea.js';
export { Slider } from './widgets/Form/Slider.js';
export { Rating } from './widgets/Form/Rating.js';

// ============================================================================
// NAVIGATION WIDGET EXPORTS
// ============================================================================

export { Tabs } from './widgets/Navigation/Tabs.js';
export { Dropdown } from './widgets/Navigation/Dropdown.js';
export { Breadcrumb } from './widgets/Navigation/Breadcrumb.js';
export { Pagination } from './widgets/Navigation/Pagination.js';

// ============================================================================
// DATA VIEW WIDGET EXPORTS
// ============================================================================

export { ListView } from './widgets/DataViews/ListView.js';
export { Card } from './widgets/DataViews/Card.js';
