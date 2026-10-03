// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { INSPECTOR_THEME } from "../ui/InspectorTheme.js";
import { renderInspectorSchema } from "../ui/InspectorControls.js";
import { getEntityComponent, setEntityComponent } from "../../../../engine/ecs/storage/ArchetypeStorage.js";
import { rgbToHex } from "../../../core/math/MathColor.js";

// Global snap settings (shared across all transform editors and viewport)
export const SNAP_SETTINGS = {
  enabled: true,
  position: 0.25,
  rotation: 15,
  scale: 0.1,
  presets: {
    position: [0.1, 0.25, 0.5, 1.0, 5.0, 10, 25, 50, 100, 250],
    rotation: [5, 15, 30, 45, 90],
    scale: [0.05, 0.1, 0.25, 0.5, 1.0]
  }
};

function snapValue(value, snapSize, enabled) {
  if (!enabled || snapSize <= 0) return value;
  return Math.round(value / snapSize) * snapSize;
}

export function renderTransformComponentEditor(doc, container, state) {
  const comp = state.pendingComponentValue || {};
  if (!Array.isArray(comp.position)) {
    comp.position = [0, 0, 0];
  }
  if (!Array.isArray(comp.rotation)) {
    comp.rotation = [0, 0, 0, 1];
  }
  if (!Array.isArray(comp.scale)) {
    comp.scale = [1, 1, 1];
  }
  state.pendingComponentValue = comp;

  function autoApply() {
    if (state && typeof state.applyPendingComponent === "function") {
      state.applyPendingComponent();
    }
  }

  // Main container
  const wrapper = doc.createElement("div");
  wrapper.style.padding = "12px";
  
  // Transform header with snap controls
  const titleRow = doc.createElement("div");
  titleRow.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  `;
  
  const titleLeft = doc.createElement("div");
  titleLeft.style.display = "flex";
  titleLeft.style.alignItems = "center";
  titleLeft.style.gap = "8px";
  
  const titleIcon = doc.createElement("span");
  titleIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2">
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
  </svg>`;
  titleLeft.appendChild(titleIcon);
  
  const title = doc.createElement("span");
  title.textContent = "Transform";
  title.style.cssText = `
    font-size: 13px;
    font-weight: 700;
    color: #e2e8f0;
    letter-spacing: 0.02em;
  `;
  titleLeft.appendChild(title);
  
  titleRow.appendChild(titleLeft);
  
  // Snap toggle - pill style
  const snapToggle = doc.createElement("button");
  const updateSnapToggleStyle = () => {
    snapToggle.innerHTML = SNAP_SETTINGS.enabled 
      ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:5px;"><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/></svg>Snap`
      : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:5px;opacity:0.5;"><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/></svg>Snap`;
    snapToggle.style.cssText = `
      display: flex;
      align-items: center;
      padding: 6px 12px;
      border: 1px solid ${SNAP_SETTINGS.enabled ? "#3b82f6" : "rgba(255,255,255,0.1)"};
      border-radius: 20px;
      background: ${SNAP_SETTINGS.enabled ? "linear-gradient(180deg, rgba(59,130,246,0.3) 0%, rgba(59,130,246,0.15) 100%)" : "rgba(255,255,255,0.03)"};
      color: ${SNAP_SETTINGS.enabled ? "#60a5fa" : "#64748b"};
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
      transition: all 0.2s ease;
      box-shadow: ${SNAP_SETTINGS.enabled ? "0 0 12px rgba(59,130,246,0.2), inset 0 1px 0 rgba(255,255,255,0.1)" : "none"};
    `;
  };
  updateSnapToggleStyle();
  snapToggle.title = "Toggle Grid Snap (affects Position & Scale)";
  
  snapToggle.addEventListener("click", () => {
    SNAP_SETTINGS.enabled = !SNAP_SETTINGS.enabled;
    updateSnapToggleStyle();
  });
  
  snapToggle.onmouseenter = () => {
    if (!SNAP_SETTINGS.enabled) {
      snapToggle.style.borderColor = "rgba(255,255,255,0.2)";
      snapToggle.style.background = "rgba(255,255,255,0.05)";
    }
  };
  snapToggle.onmouseleave = () => {
    updateSnapToggleStyle();
  };
  
  titleRow.appendChild(snapToggle);
  wrapper.appendChild(titleRow);
  
  // Snap Settings Panel - collapsible card style
  const snapPanel = doc.createElement("div");
  snapPanel.style.cssText = `
    background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(0,0,0,0.05) 100%);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 10px;
    padding: 12px;
    margin-bottom: 16px;
  `;
  
  const snapTitle = doc.createElement("div");
  snapTitle.style.cssText = `
    font-size: 10px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
  `;
  snapTitle.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg> Grid Snap Settings`;
  snapPanel.appendChild(snapTitle);
  
  const snapGrid = doc.createElement("div");
  snapGrid.style.cssText = `
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px;
  `;
  
  // Helper to create snap size selector with modern styling
  function createSnapSelector(label, currentValue, presets, onChange, accentColor) {
    const col = doc.createElement("div");
    
    const lbl = doc.createElement("div");
    lbl.textContent = label;
    lbl.style.cssText = `
      font-size: 10px;
      font-weight: 600;
      color: #94a3b8;
      margin-bottom: 6px;
    `;
    col.appendChild(lbl);
    
    const select = doc.createElement("select");
    select.style.cssText = `
      width: 100%;
      padding: 6px 8px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 6px;
      background: linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(0,0,0,0.1) 100%);
      color: #e2e8f0;
      font-size: 11px;
      font-family: 'JetBrains Mono', monospace;
      font-weight: 500;
      cursor: pointer;
      outline: none;
      transition: all 0.15s ease;
    `;
    
    select.onfocus = () => {
      select.style.borderColor = accentColor + "60";
      select.style.boxShadow = `0 0 8px ${accentColor}20`;
    };
    select.onblur = () => {
      select.style.borderColor = "rgba(255,255,255,0.08)";
      select.style.boxShadow = "none";
    };
    
    presets.forEach(p => {
      const opt = doc.createElement("option");
      opt.value = p;
      opt.textContent = p;
      if (p === currentValue) opt.selected = true;
      select.appendChild(opt);
    });
    
    select.addEventListener("change", () => {
      onChange(parseFloat(select.value));
    });
    
    col.appendChild(select);
    return col;
  }
  
  snapGrid.appendChild(createSnapSelector("Position", SNAP_SETTINGS.position, SNAP_SETTINGS.presets.position, (v) => { SNAP_SETTINGS.position = v; }, "#3b82f6"));
  snapGrid.appendChild(createSnapSelector("Rotation", SNAP_SETTINGS.rotation, SNAP_SETTINGS.presets.rotation, (v) => { SNAP_SETTINGS.rotation = v; }, "#8b5cf6"));
  snapGrid.appendChild(createSnapSelector("Scale", SNAP_SETTINGS.scale, SNAP_SETTINGS.presets.scale, (v) => { SNAP_SETTINGS.scale = v; }, "#22c55e"));
  
  snapPanel.appendChild(snapGrid);
  wrapper.appendChild(snapPanel);

  const schema = [
    {
      title: "Position",
      fields: [
        {
          type: "vec3",
          label: "",
          path: "position",
          step: 0.1,
          precision: 3,
          sanitize: (v) => {
            if (!SNAP_SETTINGS.enabled) return v;
            return snapValue(v, SNAP_SETTINGS.position, true);
          },
        },
      ],
    },
    {
      title: "Rotation (Quat)",
      fields: [
        {
          type: "vec4",
          label: "",
          path: "rotation",
          step: 0.01,
          precision: 3,
          sanitize: (v) => {
            if (!SNAP_SETTINGS.enabled) return v;
            // Convert rotation snap (degrees) to quaternion-friendly value
            // For quaternion components, snap to smaller increments based on rotation setting
            const snapAmount = SNAP_SETTINGS.rotation / 360; // Normalize to 0-1 range
            return snapValue(v, snapAmount, true);
          },
        },
      ],
    },
    {
      title: "Scale (Shift = uniform)",
      fields: [
        {
          type: "vec3",
          label: "",
          path: "scale",
          step: 0.1,
          precision: 3,
          sanitize: (v) => {
            // Prevent negative/tiny scale (min 0.1)
            let val = Math.max(0.1, v);
            if (SNAP_SETTINGS.enabled) {
              val = snapValue(val, SNAP_SETTINGS.scale, true);
            }
            return Math.max(0.1, val);
          },
          setValueAt: (idx, v, ctx, helpers) => {
            const evt = ctx && ctx.event;
            if (evt && evt.shiftKey) {
              comp.scale[0] = v;
              comp.scale[1] = v;
              comp.scale[2] = v;
              if (helpers && typeof helpers.refreshAll === "function") {
                helpers.refreshAll();
              }
            } else {
              comp.scale[idx] = v;
            }
            autoApply();
          },
        },
      ],
    },
  ];

  renderInspectorSchema(doc, wrapper, schema, {
    model: comp,
    onApply: autoApply,
  });
  
  // Reset button - modern danger style
  const resetBtn = doc.createElement("button");
  resetBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>Reset Transform`;
  resetBtn.style.cssText = `
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px 16px;
    margin-top: 16px;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(0,0,0,0.05) 100%);
    color: #94a3b8;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    transition: all 0.2s ease;
  `;
  
  resetBtn.addEventListener("mouseenter", () => {
    resetBtn.style.background = "linear-gradient(180deg, rgba(239,68,68,0.15) 0%, rgba(239,68,68,0.08) 100%)";
    resetBtn.style.borderColor = "rgba(239,68,68,0.4)";
    resetBtn.style.color = "#f87171";
    resetBtn.style.boxShadow = "0 0 12px rgba(239,68,68,0.15)";
  });
  
  resetBtn.addEventListener("mouseleave", () => {
    resetBtn.style.background = "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(0,0,0,0.05) 100%)";
    resetBtn.style.borderColor = "rgba(255,255,255,0.08)";
    resetBtn.style.color = "#94a3b8";
    resetBtn.style.boxShadow = "none";
  });
  
  resetBtn.addEventListener("click", () => {
    comp.position = [0, 0, 0];
    comp.rotation = [0, 0, 0, 1];
    comp.scale = [1, 1, 1];
    autoApply();
    // Re-render
    container.innerHTML = "";
    renderTransformComponentEditor(doc, container, state);
  });
  
  wrapper.appendChild(resetBtn);
  
  // ===== COLOR SECTION - Edit Renderable tintColor =====
  const world = state.getWorld ? state.getWorld() : null;
  const entityId = state.selectedEntityId;
  
  if (world && entityId != null) {
    let renderable = null;
    try {
      renderable = getEntityComponent(world, entityId, 'Renderable');
    } catch (e) {
      // Renderable component may not exist
    }
    
    // Show "Add Color" button for entities without Renderable component
    if (!renderable || !Array.isArray(renderable.tintColor)) {
      const addColorSection = doc.createElement("div");
      addColorSection.style.cssText = `
        margin-top: 20px;
        padding: 12px;
        background: linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(0,0,0,0.03) 100%);
        border: 1px dashed rgba(255,255,255,0.1);
        border-radius: 10px;
        text-align: center;
      `;
      
      const addColorBtn = doc.createElement("button");
      addColorBtn.innerHTML = `<span style="margin-right:6px;">🎨</span> Add Color`;
      addColorBtn.style.cssText = `
        padding: 10px 20px;
        border: 1px solid rgba(59,130,246,0.4);
        border-radius: 8px;
        background: linear-gradient(180deg, rgba(59,130,246,0.2) 0%, rgba(59,130,246,0.1) 100%);
        color: #60a5fa;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        transition: all 0.2s ease;
      `;
      addColorBtn.onmouseenter = () => {
        addColorBtn.style.background = "linear-gradient(180deg, rgba(59,130,246,0.3) 0%, rgba(59,130,246,0.2) 100%)";
        addColorBtn.style.borderColor = "rgba(59,130,246,0.6)";
        addColorBtn.style.boxShadow = "0 0 12px rgba(59,130,246,0.2)";
      };
      addColorBtn.onmouseleave = () => {
        addColorBtn.style.background = "linear-gradient(180deg, rgba(59,130,246,0.2) 0%, rgba(59,130,246,0.1) 100%)";
        addColorBtn.style.borderColor = "rgba(59,130,246,0.4)";
        addColorBtn.style.boxShadow = "none";
      };
      addColorBtn.onclick = () => {
        // Add Renderable component with default white color
        // Note: Don't set meshId to null - that causes entity to be skipped in rendering
        try {
          setEntityComponent(world, entityId, 'Renderable', {
            tintColor: [1, 1, 1, 1],
            visible: true,
            castShadow: true,
            receiveShadow: true,
            layer: 0,
          });
          // Re-render to show color editor
          container.innerHTML = "";
          renderTransformComponentEditor(doc, container, state);
        } catch (e) {
          console.error('[TransformEditor] Failed to add Renderable:', e);
        }
      };
      
      const hint = doc.createElement("div");
      hint.textContent = "Entity has no color properties yet";
      hint.style.cssText = `
        font-size: 10px;
        color: #64748b;
        margin-bottom: 10px;
      `;
      
      addColorSection.appendChild(hint);
      addColorSection.appendChild(addColorBtn);
      wrapper.appendChild(addColorSection);
    } else if (renderable && Array.isArray(renderable.tintColor)) {
      const colorSection = doc.createElement("div");
      colorSection.style.cssText = `
        margin-top: 20px;
        padding: 12px;
        background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(0,0,0,0.05) 100%);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 10px;
      `;
      
      const colorTitle = doc.createElement("div");
      colorTitle.style.cssText = `
        font-size: 10px;
        font-weight: 700;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 6px;
      `;
      colorTitle.innerHTML = `<span style="font-size:14px;">🎨</span> Entity Color`;
      colorSection.appendChild(colorTitle);
      
      // Color preview with hex value
      const previewRow = doc.createElement("div");
      previewRow.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
      `;
      
      const colorPreview = doc.createElement("div");
      colorPreview.style.cssText = `
        width: 48px;
        height: 48px;
        border-radius: 8px;
        border: 2px solid rgba(255,255,255,0.1);
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        flex-shrink: 0;
      `;
      
      const hexDisplay = doc.createElement("div");
      hexDisplay.style.cssText = `
        font-family: 'JetBrains Mono', monospace;
        font-size: 14px;
        font-weight: 600;
        color: #e2e8f0;
      `;
      
      function updateColorPreview() {
        const r = Math.round(Math.min(1, Math.max(0, renderable.tintColor[0])) * 255);
        const g = Math.round(Math.min(1, Math.max(0, renderable.tintColor[1])) * 255);
        const b = Math.round(Math.min(1, Math.max(0, renderable.tintColor[2])) * 255);
        const a = Math.min(1, Math.max(0, renderable.tintColor[3]));
        colorPreview.style.background = `rgba(${r}, ${g}, ${b}, ${a})`;
        hexDisplay.textContent = rgbToHex(renderable.tintColor).toUpperCase();
      }
      updateColorPreview();
      
      previewRow.appendChild(colorPreview);
      previewRow.appendChild(hexDisplay);
      colorSection.appendChild(previewRow);
      
      // RGBA sliders
      const sliderContainer = doc.createElement("div");
      sliderContainer.style.cssText = `display: flex; flex-direction: column; gap: 8px;`;
      
      function createColorSlider(label, index, accentColor) {
        const row = doc.createElement("div");
        row.style.cssText = `display: flex; align-items: center; gap: 8px;`;
        
        const lbl = doc.createElement("div");
        lbl.textContent = label;
        lbl.style.cssText = `
          width: 16px;
          font-size: 11px;
          font-weight: 700;
          color: ${accentColor};
        `;
        row.appendChild(lbl);
        
        const slider = doc.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = "1";
        slider.step = "0.01";
        slider.value = renderable.tintColor[index];
        slider.style.cssText = `
          flex: 1;
          height: 6px;
          -webkit-appearance: none;
          background: linear-gradient(90deg, rgba(0,0,0,0.3), ${accentColor});
          border-radius: 3px;
          cursor: pointer;
        `;
        
        const valInput = doc.createElement("input");
        valInput.type = "number";
        valInput.min = "0";
        valInput.max = "1";
        valInput.step = "0.01";
        valInput.value = renderable.tintColor[index].toFixed(2);
        valInput.style.cssText = `
          width: 50px;
          padding: 4px 6px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 4px;
          background: rgba(0,0,0,0.2);
          color: #e2e8f0;
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          text-align: right;
        `;
        
        function applyColorChange(newVal) {
          const clamped = Math.min(1, Math.max(0, parseFloat(newVal) || 0));
          renderable.tintColor[index] = clamped;
          slider.value = clamped;
          valInput.value = clamped.toFixed(2);
          updateColorPreview();
          // Save to ECS
          try {
            setEntityComponent(world, entityId, 'Renderable', renderable);
          } catch (e) {
            console.warn('[TransformEditor] Failed to save Renderable:', e);
          }
        }
        
        slider.addEventListener("input", () => applyColorChange(slider.value));
        valInput.addEventListener("change", () => applyColorChange(valInput.value));
        
        row.appendChild(slider);
        row.appendChild(valInput);
        return row;
      }
      
      sliderContainer.appendChild(createColorSlider("R", 0, "#ef4444"));
      sliderContainer.appendChild(createColorSlider("G", 1, "#22c55e"));
      sliderContainer.appendChild(createColorSlider("B", 2, "#3b82f6"));
      sliderContainer.appendChild(createColorSlider("A", 3, "#a855f7"));
      
      colorSection.appendChild(sliderContainer);
      wrapper.appendChild(colorSection);
    }
  }
  
  // ===== PHYSICS SECTION - Edit PhysicsBody mass/density/centerOfMass =====
  if (world && entityId != null) {
    let physicsBody = null;
    try {
      physicsBody = getEntityComponent(world, entityId, 'PhysicsBody');
    } catch (e) {
      // PhysicsBody component may not exist
    }
    
    // Show physics section if entity has PhysicsBody, or show "Add Physics" button
    const physicsSection = doc.createElement("div");
    physicsSection.style.cssText = `
      margin-top: 20px;
      padding: 12px;
      background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(0,0,0,0.05) 100%);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 10px;
    `;
    
    const physicsTitle = doc.createElement("div");
    physicsTitle.style.cssText = `
      font-size: 10px;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    `;
    physicsTitle.innerHTML = `<span style="font-size:14px;">⚖️</span> Physics Properties`;
    physicsSection.appendChild(physicsTitle);
    
    if (!physicsBody) {
      // Show "Add Physics" button
      const hint = doc.createElement("div");
      hint.textContent = "Entity has no physics body";
      hint.style.cssText = `font-size: 10px; color: #64748b; margin-bottom: 10px; text-align: center;`;
      physicsSection.appendChild(hint);
      
      const addPhysicsBtn = doc.createElement("button");
      addPhysicsBtn.innerHTML = `<span style="margin-right:6px;">⚖️</span> Add Physics Body`;
      addPhysicsBtn.style.cssText = `
        width: 100%;
        padding: 10px 20px;
        border: 1px solid rgba(234,179,8,0.4);
        border-radius: 8px;
        background: linear-gradient(180deg, rgba(234,179,8,0.2) 0%, rgba(234,179,8,0.1) 100%);
        color: #fbbf24;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        transition: all 0.2s ease;
      `;
      addPhysicsBtn.onmouseenter = () => {
        addPhysicsBtn.style.background = "linear-gradient(180deg, rgba(234,179,8,0.3) 0%, rgba(234,179,8,0.2) 100%)";
        addPhysicsBtn.style.boxShadow = "0 0 12px rgba(234,179,8,0.2)";
      };
      addPhysicsBtn.onmouseleave = () => {
        addPhysicsBtn.style.background = "linear-gradient(180deg, rgba(234,179,8,0.2) 0%, rgba(234,179,8,0.1) 100%)";
        addPhysicsBtn.style.boxShadow = "none";
      };
      addPhysicsBtn.onclick = () => {
        try {
          setEntityComponent(world, entityId, 'PhysicsBody', {
            simMode: 'dynamic',
            mass: 1.0,
            density: 1.0,
            linearDamping: 0.1,
            angularDamping: 0.1,
            centerOfMass: [0, 0, 0],
            linearVelocity: [0, 0, 0],
            angularVelocity: [0, 0, 0],
          });
          container.innerHTML = "";
          renderTransformComponentEditor(doc, container, state);
        } catch (e) {
          console.error('[TransformEditor] Failed to add PhysicsBody:', e);
        }
      };
      physicsSection.appendChild(addPhysicsBtn);
    } else {
      // Ensure defaults
      if (typeof physicsBody.mass !== 'number' || !Number.isFinite(physicsBody.mass)) {
        physicsBody.mass = 1.0;
      }
      if (typeof physicsBody.density !== 'number' || !Number.isFinite(physicsBody.density)) {
        physicsBody.density = 1.0;
      }
      if (!Array.isArray(physicsBody.centerOfMass) || physicsBody.centerOfMass.length < 3) {
        physicsBody.centerOfMass = [0, 0, 0];
      }
      
      // Sim Mode selector
      const simModeRow = doc.createElement("div");
      simModeRow.style.cssText = `display: flex; align-items: center; gap: 8px; margin-bottom: 12px;`;
      
      const simModeLabel = doc.createElement("div");
      simModeLabel.textContent = "Mode";
      simModeLabel.style.cssText = `width: 70px; font-size: 11px; color: #94a3b8;`;
      simModeRow.appendChild(simModeLabel);
      
      const simModeSelect = doc.createElement("select");
      simModeSelect.style.cssText = `
        flex: 1;
        padding: 6px 8px;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 6px;
        background: rgba(0,0,0,0.2);
        color: #e2e8f0;
        font-size: 11px;
        cursor: pointer;
      `;
      ['dynamic', 'kinematic', 'static'].forEach(mode => {
        const opt = doc.createElement("option");
        opt.value = mode;
        opt.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
        if (physicsBody.simMode === mode) opt.selected = true;
        simModeSelect.appendChild(opt);
      });
      simModeSelect.onchange = () => {
        physicsBody.simMode = simModeSelect.value;
        applyPhysicsChanges();
      };
      simModeRow.appendChild(simModeSelect);
      physicsSection.appendChild(simModeRow);
      
      // Helper to create number input row
      function createPhysicsInput(label, value, min, max, step, onChange, unit = '', accentColor = '#eab308') {
        const row = doc.createElement("div");
        row.style.cssText = `display: flex; align-items: center; gap: 8px; margin-bottom: 8px;`;
        
        const lbl = doc.createElement("div");
        lbl.textContent = label;
        lbl.style.cssText = `width: 70px; font-size: 11px; color: #94a3b8;`;
        row.appendChild(lbl);
        
        const slider = doc.createElement("input");
        slider.type = "range";
        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = value;
        slider.style.cssText = `
          flex: 1;
          height: 6px;
          -webkit-appearance: none;
          background: linear-gradient(90deg, rgba(0,0,0,0.3), ${accentColor});
          border-radius: 3px;
          cursor: pointer;
        `;
        
        const valInput = doc.createElement("input");
        valInput.type = "number";
        valInput.min = min;
        valInput.max = max;
        valInput.step = step;
        valInput.value = value;
        valInput.style.cssText = `
          width: 60px;
          padding: 4px 6px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 4px;
          background: rgba(0,0,0,0.2);
          color: #e2e8f0;
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          text-align: right;
        `;
        
        const unitLbl = doc.createElement("span");
        unitLbl.textContent = unit;
        unitLbl.style.cssText = `font-size: 10px; color: #64748b; width: 20px;`;
        
        function applyChange(newVal) {
          const num = parseFloat(newVal) || 0;
          slider.value = num;
          valInput.value = num;
          onChange(num);
        }
        
        slider.addEventListener("input", () => applyChange(slider.value));
        valInput.addEventListener("change", () => applyChange(valInput.value));
        
        row.appendChild(slider);
        row.appendChild(valInput);
        if (unit) row.appendChild(unitLbl);
        return row;
      }
      
      // Mass input
      physicsSection.appendChild(createPhysicsInput("Mass", physicsBody.mass, 0.1, 1000, 0.1, (v) => {
        physicsBody.mass = v;
        applyPhysicsChanges();
      }, 'kg', '#eab308'));
      
      // Density input
      physicsSection.appendChild(createPhysicsInput("Density", physicsBody.density, 0.1, 100, 0.1, (v) => {
        physicsBody.density = v;
        applyPhysicsChanges();
      }, 'kg/m³', '#f97316'));
      
      // Damping
      physicsSection.appendChild(createPhysicsInput("Lin Damp", physicsBody.linearDamping || 0, 0, 10, 0.01, (v) => {
        physicsBody.linearDamping = v;
        applyPhysicsChanges();
      }, '', '#06b6d4'));
      
      physicsSection.appendChild(createPhysicsInput("Ang Damp", physicsBody.angularDamping || 0, 0, 10, 0.01, (v) => {
        physicsBody.angularDamping = v;
        applyPhysicsChanges();
      }, '', '#8b5cf6'));
      
      // Center of Mass section
      const comTitle = doc.createElement("div");
      comTitle.textContent = "⚡ Center of Mass Offset";
      comTitle.style.cssText = `
        font-size: 10px;
        font-weight: 600;
        color: #64748b;
        margin-top: 12px;
        margin-bottom: 8px;
        padding-top: 8px;
        border-top: 1px solid rgba(255,255,255,0.06);
      `;
      physicsSection.appendChild(comTitle);
      
      // CoM XYZ inputs
      function createCoMInput(label, index, accentColor) {
        const row = doc.createElement("div");
        row.style.cssText = `display: flex; align-items: center; gap: 8px; margin-bottom: 6px;`;
        
        const lbl = doc.createElement("div");
        lbl.textContent = label;
        lbl.style.cssText = `width: 16px; font-size: 11px; font-weight: 700; color: ${accentColor};`;
        row.appendChild(lbl);
        
        const slider = doc.createElement("input");
        slider.type = "range";
        slider.min = "-2";
        slider.max = "2";
        slider.step = "0.01";
        slider.value = physicsBody.centerOfMass[index];
        slider.style.cssText = `
          flex: 1;
          height: 6px;
          -webkit-appearance: none;
          background: linear-gradient(90deg, ${accentColor}40, ${accentColor});
          border-radius: 3px;
          cursor: pointer;
        `;
        
        const valInput = doc.createElement("input");
        valInput.type = "number";
        valInput.step = "0.01";
        valInput.value = physicsBody.centerOfMass[index].toFixed(2);
        valInput.style.cssText = `
          width: 50px;
          padding: 4px 6px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 4px;
          background: rgba(0,0,0,0.2);
          color: #e2e8f0;
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          text-align: right;
        `;
        
        function applyCoMChange(newVal) {
          const num = parseFloat(newVal) || 0;
          physicsBody.centerOfMass[index] = num;
          slider.value = num;
          valInput.value = num.toFixed(2);
          applyPhysicsChanges();
        }
        
        slider.addEventListener("input", () => applyCoMChange(slider.value));
        valInput.addEventListener("change", () => applyCoMChange(valInput.value));
        
        row.appendChild(slider);
        row.appendChild(valInput);
        return row;
      }
      
      physicsSection.appendChild(createCoMInput("X", 0, "#ef4444"));
      physicsSection.appendChild(createCoMInput("Y", 1, "#22c55e"));
      physicsSection.appendChild(createCoMInput("Z", 2, "#3b82f6"));
      
      // Reset CoM button
      const resetCoMBtn = doc.createElement("button");
      resetCoMBtn.textContent = "Reset CoM to Center";
      resetCoMBtn.style.cssText = `
        width: 100%;
        padding: 6px 12px;
        margin-top: 8px;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 6px;
        background: rgba(255,255,255,0.03);
        color: #94a3b8;
        cursor: pointer;
        font-size: 11px;
        transition: all 0.2s ease;
      `;
      resetCoMBtn.onmouseenter = () => {
        resetCoMBtn.style.background = "rgba(255,255,255,0.06)";
        resetCoMBtn.style.color = "#e2e8f0";
      };
      resetCoMBtn.onmouseleave = () => {
        resetCoMBtn.style.background = "rgba(255,255,255,0.03)";
        resetCoMBtn.style.color = "#94a3b8";
      };
      resetCoMBtn.onclick = () => {
        physicsBody.centerOfMass = [0, 0, 0];
        applyPhysicsChanges();
        container.innerHTML = "";
        renderTransformComponentEditor(doc, container, state);
      };
      physicsSection.appendChild(resetCoMBtn);
      
      // Function to apply physics changes to ECS and live physics body
      function applyPhysicsChanges() {
        try {
          setEntityComponent(world, entityId, 'PhysicsBody', physicsBody);
          
          // Also update live physics body if it exists
          if (state.editor && state.editor.entityBodyHandles && state.editor.physicsWorld) {
            const handle = state.editor.entityBodyHandles.get(entityId);
            if (handle != null && state.editor._physxFns) {
              const { getBody } = state.editor._physxFns;
              if (getBody) {
                const body = getBody(state.editor.physicsWorld, handle);
                if (body && body._actor) {
                  const PhysX = state.editor.physicsWorld.module;
                  try {
                    // Update mass
                    if (PhysX.PxRigidBodyExt && typeof PhysX.PxRigidBodyExt.setMassAndUpdateInertia === 'function') {
                      PhysX.PxRigidBodyExt.setMassAndUpdateInertia(body._actor, physicsBody.mass);
                    }
                    // Update damping
                    if (typeof body._actor.setLinearDamping === 'function') {
                      body._actor.setLinearDamping(physicsBody.linearDamping || 0);
                    }
                    if (typeof body._actor.setAngularDamping === 'function') {
                      body._actor.setAngularDamping(physicsBody.angularDamping || 0);
                    }
                    // Update center of mass
                    if (typeof body._actor.setCMassLocalPose === 'function' && Array.isArray(physicsBody.centerOfMass)) {
                      const comPos = new PhysX.PxVec3(physicsBody.centerOfMass[0], physicsBody.centerOfMass[1], physicsBody.centerOfMass[2]);
                      const comRot = new PhysX.PxQuat(0, 0, 0, 1);
                      const comPose = new PhysX.PxTransform(comPos, comRot);
                      body._actor.setCMassLocalPose(comPose);
                      PhysX.destroy(comPos);
                      PhysX.destroy(comRot);
                      PhysX.destroy(comPose);
                    }
                  } catch (e) {
                    console.warn('[TransformEditor] Failed to update live physics:', e);
                  }
                }
              }
            }
          }
        } catch (e) {
          console.warn('[TransformEditor] Failed to save PhysicsBody:', e);
        }
      }
    }
    
    wrapper.appendChild(physicsSection);
  }
  
  container.appendChild(wrapper);
}
