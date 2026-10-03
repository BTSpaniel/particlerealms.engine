// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PhysicsRopeComponentEditor.js - Rope Property Editor
 * 
 * Renders rope-specific properties in the entity inspector when a rope entity is selected.
 * Uses shared ROPE_INSPECTOR_SCHEMA from RopeSchema.js for full consistency with RopeTool.
 */

import { INSPECTOR_THEME } from "../ui/InspectorTheme.js";
import { renderInspectorSchema, createPropertySection } from "../ui/InspectorControls.js";
import { ROPE_INSPECTOR_SCHEMA } from "../../../../editor/js/spawnables/physics/RopeSchema.js";

/**
 * Render the PhysicsRope component editor using shared schema
 */
export function renderPhysicsRopeComponentEditor(doc, container, entitiesState) {
    const data = entitiesState.pendingComponentValue;
    if (!data) {
        console.warn('[PhysicsRopeComponentEditor] No data');
        return;
    }

    // === ATTACHED TO (custom section - only show if rope is attached to entities) ===
    const hasAttachments = data.startEntityId != null || data.endEntityId != null;
    if (hasAttachments) {
        const attachedSection = createPropertySection(doc, container, "Attached To");
        
        const createEntityLink = (entityId, label) => {
            const btn = doc.createElement("button");
            btn.textContent = label || `Entity ${entityId}`;
            btn.dataset.entityId = entityId;
            btn.style.cssText = `
                background: transparent;
                border: none;
                padding: 2px 6px;
                cursor: pointer;
                color: ${INSPECTOR_THEME.colors.text.accent};
                font-size: 12px;
                text-align: left;
                border-radius: 4px;
                transition: all 0.15s ease;
            `;
            btn.onmouseenter = () => { 
                btn.style.textDecoration = "underline";
                btn.style.background = "rgba(59, 130, 246, 0.15)";
                if (entitiesState.onEntityHover) entitiesState.onEntityHover(entityId);
            };
            btn.onmouseleave = () => { 
                btn.style.textDecoration = "none";
                btn.style.background = "transparent";
                if (entitiesState.onEntityHover) entitiesState.onEntityHover(null);
            };
            btn.onclick = () => {
                if (entitiesState.selectEntity) entitiesState.selectEntity(entityId);
            };
            return btn;
        };
        
        const getEntityLabel = (entityId) => {
            if (entityId == null) return null;
            if (entitiesState.getEntityLabel) return entitiesState.getEntityLabel(entityId);
            return `Entity ${entityId}`;
        };
        
        if (data.startEntityId != null) {
            const startRow = doc.createElement("div");
            startRow.style.cssText = "display: grid; grid-template-columns: 80px 1fr; gap: 8px; align-items: center; margin-bottom: 6px;";
            const startLabel = doc.createElement("span");
            startLabel.textContent = "Start";
            startLabel.style.cssText = `font-size: 12px; color: ${INSPECTOR_THEME.colors.text.muted};`;
            startRow.appendChild(startLabel);
            startRow.appendChild(createEntityLink(data.startEntityId, getEntityLabel(data.startEntityId)));
            attachedSection.appendChild(startRow);
        }
        
        if (data.endEntityId != null) {
            const endRow = doc.createElement("div");
            endRow.style.cssText = "display: grid; grid-template-columns: 80px 1fr; gap: 8px; align-items: center; margin-bottom: 6px;";
            const endLabel = doc.createElement("span");
            endLabel.textContent = "End";
            endLabel.style.cssText = `font-size: 12px; color: ${INSPECTOR_THEME.colors.text.muted};`;
            endRow.appendChild(endLabel);
            endRow.appendChild(createEntityLink(data.endEntityId, getEntityLabel(data.endEntityId)));
            attachedSection.appendChild(endRow);
        }
    }

    // === USE SHARED SCHEMA FOR ALL ROPE PROPERTIES ===
    // Transform schema fields to work with the component data model
    const transformedSections = ROPE_INSPECTOR_SCHEMA.sections.map(section => ({
        ...section,
        fields: section.fields.map(field => {
            // Check showIf condition
            if (field.showIf) {
                if (typeof field.showIf === 'function') {
                    if (!field.showIf(data)) return null;
                } else if (typeof field.showIf === 'string') {
                    if (!data[field.showIf]) return null;
                }
            }
            
            // Transform field to use path-based access
            return {
                ...field,
                path: field.key,
                // For select fields, convert options to items format
                items: field.options || field.items,
            };
        }).filter(Boolean), // Remove null fields (hidden by showIf)
    }));

    // Render using shared schema renderer
    renderInspectorSchema(doc, container, transformedSections, {
        model: data,
        onApply: () => {
            if (typeof entitiesState.applyPendingComponent === 'function') {
                entitiesState.applyPendingComponent();
            }
        },
    });
}
