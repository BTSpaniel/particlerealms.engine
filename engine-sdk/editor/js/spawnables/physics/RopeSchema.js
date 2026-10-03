// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// =============================================================================
// ROPE SCHEMA - Shared schema for RopeTool and PhysicsRopeComponentEditor
// =============================================================================

/**
 * Fiber material properties - affects both physics and rendering
 */
import { FIBER_MATERIALS } from '../../../../engine/sim/cloth/FiberMaterials.js';
export { FIBER_MATERIALS };

/**
 * Default values for rope properties
 */
export const ROPE_DEFAULTS = {
    // Basic rope properties
    length: 'auto',
    segments: 20,
    stiffness: 0.9,
    damping: 0.98,
    gravity: -9.8,
    radius: 0.01,
    color: [0.6, 0.4, 0.2, 1],
    // Multi-thread twisted rope
    threadCount: 1,
    threadRadius: 0.003,
    twistRate: 4.0,           // 4 twists per meter (more visible)
    twistDirection: 'clockwise',
    bundleRadius: 0.02,       // 2cm bundle radius (more visible helix)
    plyDirection: 'balanced',
    // Chain constraint physics
    chainStrength: Infinity,
    chainStiffness: 1.0,
    enableTwoWayCoupling: true,
    tensionStiffness: 50.0,
    // Attachments
    fixStart: true,
    fixEnd: true,
    // Fiber material
    fiberMaterial: 'hemp',
    materialPreset: 'rope',
    // Color blending
    enableColorBlend: false,
    secondaryColor: [0.9, 0.85, 0.8, 1],
    blendRatio: 0.5,
    blendNoiseScale: 5.0,
    blendFollowsTwist: true,
    // Rendering style
    anisotropy: 0.5,
    sheenStrength: 0.3,
    roughness: 0.6,
    // Procedural styling
    enableFraying: false,
    frayingAmount: 0.2,
    frayingLength: 0.015,
    // Advanced effects
    enableBending: false,
    bendingStiffness: 0.3,
    enableSprings: false,
    springStiffness: 0.5,
    // Surface interaction
    sticky: false,
    adhesionStrength: 1.0,
    cohesive: false,
    cohesionRadius: 0.5,
    friction: 0.5,
    restitution: 0.1,
};

/**
 * Material presets for quick setup
 */
export const MATERIAL_PRESETS = [
    { value: 'rope', label: 'Rope (default)' },
    { value: 'rubber', label: 'Rubber (bouncy)' },
    { value: 'slime', label: 'Slime (sticky+cohesive)' },
    { value: 'water', label: 'Water (cohesive+slippery)' },
    { value: 'honey', label: 'Honey (sticky+viscous)' },
    { value: 'cloth', label: 'Cloth (breakable)' },
    { value: 'chain', label: 'Chain (metal)' },
    { value: 'web', label: 'Web (sticky+breakable)' },
    { value: 'balloon', label: 'Balloon (bouncy+light)' },
    { value: 'mud', label: 'Mud (sticky+viscous+cohesive)' },
];

/**
 * Fiber material options for dropdown
 */
export const FIBER_MATERIAL_OPTIONS = [
    { value: 'cotton', label: 'Cotton (soft, matte)' },
    { value: 'wool', label: 'Wool (fuzzy, elastic)' },
    { value: 'silk', label: 'Silk (shiny, smooth)' },
    { value: 'nylon', label: 'Nylon (plastic, springy)' },
    { value: 'hemp', label: 'Hemp (rough, strong)' },
    { value: 'steel', label: 'Steel Cable (metallic)' },
    { value: 'chain', label: 'Chain (metal links)' },
    { value: 'vine', label: 'Vine (organic, flexible)' },
    { value: 'wire', label: 'Wire (thin metal)' },
];

/**
 * Unified inspector schema for rope properties
 * Used by both RopeTool and PhysicsRopeComponentEditor
 * 
 * Organized into logical groups with the most commonly used options first
 */
export const ROPE_INSPECTOR_SCHEMA = {
    sections: [
        // ═══════════════════════════════════════════════════════════════
        // QUICK SETUP - Most common options upfront
        // ═══════════════════════════════════════════════════════════════
        {
            title: '🎨 Color & Appearance',
            collapsed: false,
            fields: [
                { key: 'color', label: 'Primary Color', type: 'color' },
                { key: 'secondaryColor', label: 'Secondary Color', type: 'color' },
                { key: 'enableColorBlend', label: 'Blend Colors', type: 'checkbox' },
                { key: 'blendRatio', label: 'Mix Ratio', type: 'slider', min: 0, max: 1, step: 0.05 },
                { key: 'blendNoiseScale', label: 'Pattern Scale', type: 'slider', min: 1, max: 20, step: 0.5 },
            ]
        },
        {
            title: '📏 Size & Material',
            collapsed: false,
            fields: [
                { key: 'radius', label: 'Thickness', type: 'slider', min: 0.001, max: 0.1, step: 0.001 },
                { key: 'radiusPreset', label: 'Quick Size', type: 'preset-buttons', presets: [
                    { name: '🧵 Thread', value: 0.0005 },
                    { name: '🪡 String', value: 0.002 },
                    { name: '🪢 Rope', value: 0.01 },
                    { name: '⚡ Cable', value: 0.03 },
                ], targetKey: 'radius' },
                { key: 'fiberMaterial', label: 'Material', type: 'select', options: FIBER_MATERIAL_OPTIONS },
                { key: 'segments', label: 'Segments', type: 'slider', min: 5, max: 100, step: 1 },
            ]
        },
        {
            title: '⚙️ Physics',
            collapsed: false,
            fields: [
                { key: 'stiffness', label: 'Stiffness', type: 'slider', min: 0, max: 1, step: 0.01 },
                { key: 'damping', label: 'Damping', type: 'slider', min: 0.8, max: 1, step: 0.01 },
                { key: 'gravity', label: 'Gravity', type: 'slider', min: -20, max: 0, step: 0.1 },
                { key: 'fixStart', label: 'Pin Start', type: 'checkbox' },
                { key: 'fixEnd', label: 'Pin End', type: 'checkbox' },
            ]
        },
        // ═══════════════════════════════════════════════════════════════
        // ADVANCED - More detailed options
        // ═══════════════════════════════════════════════════════════════
        {
            title: '✨ Shading',
            collapsed: true,
            fields: [
                { key: 'anisotropy', label: 'Fiber Shine', type: 'slider', min: 0, max: 1, step: 0.05 },
                { key: 'sheenStrength', label: 'Fuzz/Sheen', type: 'slider', min: 0, max: 1, step: 0.05 },
                { key: 'roughness', label: 'Roughness', type: 'slider', min: 0, max: 1, step: 0.05 },
                { key: 'enableFraying', label: 'Enable Fraying', type: 'checkbox' },
                { key: 'frayingAmount', label: 'Fray Density', type: 'slider', min: 0, max: 1, step: 0.05, showIf: 'enableFraying' },
                { key: 'frayingLength', label: 'Fray Length', type: 'slider', min: 0.001, max: 0.05, step: 0.001, showIf: 'enableFraying' },
            ]
        },
        {
            title: '🔗 Multi-Thread Chain',
            collapsed: true,
            fields: [
                { key: 'threadCount', label: 'Thread Count', type: 'slider', min: 1, max: 12, step: 1 },
                { key: 'twistRate', label: 'Twist Rate', type: 'slider', min: 1, max: 20, step: 0.5 },
                { key: 'bundleRadius', label: 'Bundle Size', type: 'slider', min: 0.005, max: 0.1, step: 0.005 },
                { key: 'threadRadius', label: 'Thread Size', type: 'slider', min: 0.001, max: 0.02, step: 0.001 },
                { key: 'twistDirection', label: 'Twist Direction', type: 'select', options: [
                    { value: 'clockwise', label: '↻ Clockwise (Z-twist)' },
                    { value: 'counterclockwise', label: '↺ Counter-clockwise (S-twist)' },
                ] },
            ]
        },
        {
            title: '🎯 Constraint',
            collapsed: true,
            fields: [
                { key: 'chainStiffness', label: 'Length Stiffness', type: 'slider', min: 0, max: 1, step: 0.01 },
                { key: 'chainStrength', label: 'Break Force (N)', type: 'number', min: 0, step: 100 },
                { key: 'enableTwoWayCoupling', label: 'Pull Objects', type: 'checkbox' },
                { key: 'tensionStiffness', label: 'Pull Force', type: 'slider', min: 1, max: 200, step: 1, showIf: 'enableTwoWayCoupling' },
            ]
        },
        {
            title: '🧪 Advanced Effects',
            collapsed: true,
            fields: [
                { key: 'enableBending', label: 'Bending Resistance', type: 'checkbox' },
                { key: 'bendingStiffness', label: 'Bend Stiffness', type: 'slider', min: 0, max: 1, step: 0.01, showIf: 'enableBending' },
                { key: 'enableSprings', label: 'Spring Mode', type: 'checkbox' },
                { key: 'springStiffness', label: 'Spring Force', type: 'slider', min: 0, max: 1, step: 0.01, showIf: 'enableSprings' },
            ]
        },
        {
            title: '🧲 Surface Interaction',
            collapsed: true,
            fields: [
                { key: 'sticky', label: 'Sticky', type: 'checkbox' },
                { key: 'adhesionStrength', label: 'Stick Force', type: 'slider', min: 0, max: 5, step: 0.1, showIf: 'sticky' },
                { key: 'cohesive', label: 'Self-Attract', type: 'checkbox' },
                { key: 'cohesionRadius', label: 'Attract Range', type: 'slider', min: 0.1, max: 2, step: 0.1, showIf: 'cohesive' },
                { key: 'friction', label: 'Friction', type: 'slider', min: 0, max: 1, step: 0.05 },
                { key: 'restitution', label: 'Bounciness', type: 'slider', min: 0, max: 1, step: 0.05 },
            ]
        },
        {
            title: '🔥 Environment Interaction',
            collapsed: true,
            fields: [
                { key: 'enableInteraction', label: 'Enable Interaction', type: 'checkbox' },
                { key: 'interactionRadius', label: 'Interaction Radius', type: 'slider', min: 0.1, max: 5, step: 0.1, showIf: 'enableInteraction' },
                { key: 'burnTemperatureOverride', label: 'Burn Temp (K)', type: 'number', min: 0, max: 5000, step: 10, showIf: 'enableInteraction' },
                { key: 'moistureCapacityOverride', label: 'Moisture Capacity', type: 'slider', min: 0, max: 1, step: 0.05, showIf: 'enableInteraction' },
                { key: 'thermalConductivityOverride', label: 'Thermal Conductivity', type: 'slider', min: 0, max: 1, step: 0.05, showIf: 'enableInteraction' },
            ]
        },
        {
            title: '📦 Presets',
            collapsed: true,
            fields: [
                { key: 'materialPreset', label: 'Material Preset', type: 'select', options: MATERIAL_PRESETS },
            ]
        },
    ]
};

/**
 * Get fiber material properties by name
 */
export function getFiberMaterial(name) {
    return FIBER_MATERIALS[name] || FIBER_MATERIALS.hemp;
}

/**
 * Apply fiber material preset to rope data
 */
export function applyFiberMaterial(data, materialName) {
    const mat = getFiberMaterial(materialName);
    return {
        ...data,
        fiberMaterial: materialName,
        anisotropy: mat.anisotropy,
        sheenStrength: mat.sheenStrength,
        roughness: mat.roughness,
        bendingStiffness: mat.bendingStiffness,
        damping: mat.damping,
    };
}
