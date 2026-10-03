// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { INSPECTOR_THEME } from "./InspectorTheme.js";
import { degreesToRadians } from "../../../core/math/UnitMath.js";
import { hexToRgb, rgbToHex } from "../../../core/math/MathColor.js";

/**
 * Create a themed section box (card-like container)
 */
export function createThemedBox(doc, title, options = {}) {
  const box = doc.createElement("div");
  Object.assign(box.style, INSPECTOR_THEME.components.section.base);
  if (options.marginTop) box.style.marginTop = options.marginTop;

  if (title) {
    const titleEl = doc.createElement("div");
    titleEl.textContent = title;
    titleEl.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
    titleEl.style.marginBottom = INSPECTOR_THEME.spacing.md;
    titleEl.style.color = options.titleColor || INSPECTOR_THEME.colors.text.accent;
    titleEl.style.fontSize = INSPECTOR_THEME.fontSize.lg;
    box.appendChild(titleEl);
  }

  return box;
}

/**
 * Create a themed stat item (for performance stats, etc.)
 */
export function createStatItem(doc, label, value, color) {
  const item = doc.createElement("div");
  item.style.background = INSPECTOR_THEME.colors.bg.secondary;
  item.style.padding = `${INSPECTOR_THEME.spacing.sm} ${INSPECTOR_THEME.spacing.md}`;
  item.style.borderRadius = INSPECTOR_THEME.radius.sm;
  item.style.border = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;

  const labelEl = doc.createElement("div");
  labelEl.textContent = label;
  labelEl.style.fontSize = INSPECTOR_THEME.fontSize.sm;
  labelEl.style.color = INSPECTOR_THEME.colors.text.muted;
  labelEl.style.marginBottom = INSPECTOR_THEME.spacing.xs;

  const valueEl = doc.createElement("div");
  valueEl.textContent = value;
  valueEl.style.fontSize = INSPECTOR_THEME.fontSize.xxl;
  valueEl.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
  valueEl.style.color = color || INSPECTOR_THEME.colors.text.primary;
  valueEl.style.fontFamily = "monospace";

  item.appendChild(labelEl);
  item.appendChild(valueEl);
  return { item, valueEl, labelEl };
}

/**
 * Create a themed checkbox row
 */
export function createThemedCheckboxRow(doc, label, checked, onChange) {
  const row = doc.createElement("label");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.gap = INSPECTOR_THEME.spacing.md;
  row.style.fontSize = INSPECTOR_THEME.fontSize.md;
  row.style.cursor = "pointer";
  row.style.padding = `${INSPECTOR_THEME.spacing.xs} 0`;

  const cb = doc.createElement("input");
  cb.type = "checkbox";
  cb.checked = !!checked;
  cb.style.accentColor = INSPECTOR_THEME.colors.semantic.info;
  cb.onchange = () => onChange(cb.checked);
  row.appendChild(cb);

  const text = doc.createElement("span");
  text.textContent = label;
  text.style.color = INSPECTOR_THEME.colors.text.primary;
  row.appendChild(text);

  return row;
}

/**
 * Create a themed slider with label and value display
 */
export function createThemedSlider(doc, options = {}) {
  const {
    label,
    min = 0,
    max = 1,
    step = 0.1,
    value = 0.5,
    accent,
    onChange,
    snapPoints,
    tickCount,
    precision = 2,
    formatValue,
    snapToPoints,
  } = options;

  const container = doc.createElement("div");
  container.style.marginBottom = INSPECTOR_THEME.spacing.md;

  const labelRow = doc.createElement("div");
  labelRow.style.display = "flex";
  labelRow.style.justifyContent = "space-between";
  labelRow.style.alignItems = "center";
  labelRow.style.marginBottom = INSPECTOR_THEME.spacing.sm;

  const labelEl = doc.createElement("span");
  labelEl.textContent = label;
  labelEl.style.fontSize = INSPECTOR_THEME.fontSize.md;
  labelEl.style.color = INSPECTOR_THEME.colors.text.secondary;
  labelRow.appendChild(labelEl);

  const valueEl = doc.createElement("span");
  valueEl.style.fontSize = INSPECTOR_THEME.fontSize.md;
  valueEl.style.color = INSPECTOR_THEME.colors.text.primary;
  valueEl.style.fontFamily = "monospace";
  valueEl.style.fontWeight = INSPECTOR_THEME.fontWeight.medium;
  labelRow.appendChild(valueEl);

  container.appendChild(labelRow);

  const slider = doc.createElement("input");
  slider.type = "range";
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  const initialValue = Number.isFinite(value) ? value : min;
  slider.value = String(initialValue);
  slider.style.width = "100%";
  slider.style.accentColor = accent || INSPECTOR_THEME.colors.semantic.info;
  slider.style.cursor = "pointer";

  const resolvedSnapPoints = getSnapPoints(min, max, snapPoints, tickCount);
  const shouldSnap = resolvedSnapPoints && snapToPoints === true;

  const updateValueDisplay = (val) => {
    valueEl.textContent = formatSliderValue(val, formatValue, precision);
  };
  updateValueDisplay(initialValue);

  slider.oninput = () => {
    let v = parseFloat(slider.value);
    if (!Number.isFinite(v)) {
      return;
    }
    if (shouldSnap) {
      v = snapValueToPoints(v, resolvedSnapPoints);
      slider.value = String(v);
    }
    updateValueDisplay(v);
    if (onChange) onChange(v);
  };

  container.appendChild(slider);
  if (resolvedSnapPoints) {
    container.appendChild(createSliderTicks(doc, resolvedSnapPoints));
  }
  return { container, slider, valueEl };
}

export function createSliderTicks(doc, snapPoints) {
  const ticks = doc.createElement("div");
  ticks.style.position = "relative";
  ticks.style.width = "100%";
  ticks.style.height = "10px";
  ticks.style.marginTop = `${INSPECTOR_THEME.spacing.xs}`;

  const track = doc.createElement("div");
  track.style.position = "absolute";
  track.style.left = "0";
  track.style.right = "0";
  track.style.top = "50%";
  track.style.height = "2px";
  track.style.transform = "translateY(-50%)";
  track.style.background = INSPECTOR_THEME.colors.border.light;
  track.style.opacity = "0.4";
  ticks.appendChild(track);

  const min = snapPoints[0];
  const max = snapPoints[snapPoints.length - 1];
  const range = max - min || 1;

  snapPoints.forEach((point) => {
    const tick = doc.createElement("div");
    tick.style.position = "absolute";
    const percent = ((point - min) / range) * 100;
    tick.style.left = `${percent}%`;
    tick.style.width = "2px";
    tick.style.height = "10px";
    tick.style.background = INSPECTOR_THEME.colors.semantic.info;
    tick.style.transform = "translateX(-1px)";
    tick.style.opacity = point === min || point === max ? "0.4" : "0.8";
    ticks.appendChild(tick);
  });

  return ticks;
}

export function getSnapPoints(min, max, snapPoints, tickCount = 6) {
  if (Array.isArray(snapPoints) && snapPoints.length > 1) {
    return snapPoints;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return null;
  }
  const count = Math.max(2, Math.min(12, tickCount || 6));
  if (count <= 2) {
    return [min, max];
  }
  const range = max - min;
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push(min + (range * i) / (count - 1));
  }
  return points;
}

export function snapValueToPoints(value, snapPoints) {
  if (!Array.isArray(snapPoints) || snapPoints.length === 0) {
    return value;
  }
  let closest = snapPoints[0];
  let minDiff = Math.abs(value - closest);
  for (let i = 1; i < snapPoints.length; i++) {
    const diff = Math.abs(value - snapPoints[i]);
    if (diff < minDiff) {
      closest = snapPoints[i];
      minDiff = diff;
    }
  }
  return closest;
}

export function formatSliderValue(value, formatter, precision = 2) {
  if (typeof formatter === "function") {
    return formatter(value);
  }
  const safePrecision = Number.isFinite(precision) ? Math.max(0, precision) : 2;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return String(value ?? "");
  }
  return value.toFixed(safePrecision);
}

export function createPropertySection(doc, container, titleText) {
  const section = doc.createElement("div");
  section.style.marginBottom = INSPECTOR_THEME.spacing.xl;

  const title = doc.createElement("div");
  title.textContent = titleText;
  title.style.fontSize = INSPECTOR_THEME.fontSize.md;
  title.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
  title.style.letterSpacing = "0.06em";
  title.style.textTransform = "uppercase";
  title.style.color = INSPECTOR_THEME.colors.text.secondary;
  title.style.marginBottom = INSPECTOR_THEME.spacing.md;
  title.style.paddingBottom = INSPECTOR_THEME.spacing.sm;
  title.style.borderBottom = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;
  title.style.userSelect = "none";
  section.appendChild(title);

  container.appendChild(section);
  return section;
}

export function createCollapsibleSection(doc, container, titleText, startCollapsed = false) {
  const section = doc.createElement("div");
  section.style.marginBottom = INSPECTOR_THEME.spacing.lg;

  const header = doc.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.gap = "8px";
  header.style.cursor = "pointer";
  header.style.padding = "8px 0";
  header.style.borderBottom = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;
  header.style.marginBottom = INSPECTOR_THEME.spacing.md;
  header.style.userSelect = "none";
  header.style.transition = "all 0.15s ease";

  const arrow = doc.createElement("span");
  arrow.textContent = startCollapsed ? "▶" : "▼";
  arrow.style.fontSize = "10px";
  arrow.style.color = INSPECTOR_THEME.colors.text.muted;
  arrow.style.transition = "transform 0.15s ease";
  arrow.style.width = "12px";
  header.appendChild(arrow);

  const title = doc.createElement("span");
  title.textContent = titleText;
  title.style.fontSize = INSPECTOR_THEME.fontSize.md;
  title.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
  title.style.letterSpacing = "0.04em";
  title.style.color = INSPECTOR_THEME.colors.text.secondary;
  title.style.flex = "1";
  header.appendChild(title);

  section.appendChild(header);

  const content = doc.createElement("div");
  content.style.overflow = "hidden";
  content.style.transition = "max-height 0.2s ease, opacity 0.15s ease";
  if (startCollapsed) {
    content.style.maxHeight = "0";
    content.style.opacity = "0";
  } else {
    content.style.maxHeight = "2000px";
    content.style.opacity = "1";
  }
  section.appendChild(content);

  let isCollapsed = startCollapsed;
  header.onclick = () => {
    isCollapsed = !isCollapsed;
    arrow.textContent = isCollapsed ? "▶" : "▼";
    if (isCollapsed) {
      content.style.maxHeight = "0";
      content.style.opacity = "0";
    } else {
      content.style.maxHeight = "2000px";
      content.style.opacity = "1";
    }
  };

  header.onmouseenter = () => {
    header.style.background = INSPECTOR_THEME.colors.bg.tertiary;
  };
  header.onmouseleave = () => {
    header.style.background = "transparent";
  };

  container.appendChild(section);
  return content; // Return content div so fields get added to it
}

export function addSelectRow(doc, section, labelText, items, getValue, setValue) {
  const row = doc.createElement("div");
  row.style.display = "grid";
  row.style.gridTemplateColumns = "110px 1fr";
  row.style.gap = INSPECTOR_THEME.spacing.md;
  row.style.alignItems = "center";
  row.style.marginBottom = INSPECTOR_THEME.spacing.md;

  const label = doc.createElement("div");
  label.textContent = labelText;
  label.style.fontSize = INSPECTOR_THEME.fontSize.lg;
  label.style.color = INSPECTOR_THEME.colors.text.primary;
  label.style.userSelect = "none";
  row.appendChild(label);

  const select = doc.createElement("select");
  Object.assign(select.style, INSPECTOR_THEME.components.input.base);
  select.style.cursor = "pointer";
  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item) continue;
    const opt = doc.createElement("option");
    const value = item.value != null ? String(item.value) : "";
    opt.value = value;
    opt.textContent = item.label != null ? String(item.label) : value;
    select.appendChild(opt);
  }

  bindSelectInput(select, {
    getValue,
    setValue,
    commitOn: "change",
  });

  row.appendChild(select);
  section.appendChild(row);
  return { row, select };
}

export function addVectorRow(doc, section, options = {}) {
  const labelText = options.label != null ? String(options.label) : "";
  const axes = Array.isArray(options.axes) && options.axes.length > 0 ? options.axes : ["X", "Y", "Z"];
  const step = typeof options.step === "number" && Number.isFinite(options.step) ? options.step : 0.01;
  const precision =
    typeof options.precision === "number" && Number.isFinite(options.precision)
      ? Math.max(0, options.precision)
      : 3;
  const getValueAt = typeof options.getValueAt === "function" ? options.getValueAt : () => 0;
  const setValueAt = typeof options.setValueAt === "function" ? options.setValueAt : null;
  const sanitize = typeof options.sanitize === "function" ? options.sanitize : null;
  const axisColors = options.axisColors || { X: "#ef4444", Y: "#22c55e", Z: "#3b82f6", W: "#a855f7" };

  const row = doc.createElement("div");
  row.style.display = "grid";
  row.style.gridTemplateColumns = labelText ? "110px 1fr" : "1fr";
  row.style.gap = INSPECTOR_THEME.spacing.md;
  row.style.alignItems = "center";
  row.style.marginBottom = INSPECTOR_THEME.spacing.md;

  if (labelText) {
    const label = doc.createElement("div");
    label.textContent = labelText;
    label.style.fontSize = INSPECTOR_THEME.fontSize.lg;
    label.style.color = INSPECTOR_THEME.colors.text.primary;
    label.style.userSelect = "none";
    row.appendChild(label);
  }

  const inputsRow = doc.createElement("div");
  inputsRow.style.display = "flex";
  inputsRow.style.gap = "6px";
  inputsRow.style.alignItems = "center";
  inputsRow.classList.add("inspector-number-group");

  const bindings = [];
  const inputs = [];
  const refreshAll = () => {
    for (let i = 0; i < bindings.length; i++) {
      const b = bindings[i];
      if (b && typeof b.refresh === "function") {
        b.refresh();
      }
    }
  };

  for (let i = 0; i < axes.length; i++) {
    const axis = String(axes[i]);
    const axisColor = axisColors[axis] || INSPECTOR_THEME.colors.text.accent;
    
    const inputGroup = doc.createElement("div");
    inputGroup.style.cssText = `
      flex: 1;
      display: flex;
      align-items: center;
      background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(0,0,0,0.1) 100%);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 6px;
      overflow: hidden;
      transition: all 0.15s ease;
      position: relative;
    `;
    
    // Hover glow effect
    inputGroup.onmouseenter = () => {
      inputGroup.style.borderColor = `${axisColor}50`;
      inputGroup.style.boxShadow = `0 0 8px ${axisColor}20, inset 0 1px 0 rgba(255,255,255,0.05)`;
    };
    inputGroup.onmouseleave = () => {
      inputGroup.style.borderColor = "rgba(255,255,255,0.08)";
      inputGroup.style.boxShadow = "none";
    };

    // Scrubable axis label (drag to change value like Blender/Photoshop)
    const axisLabel = doc.createElement("span");
    axisLabel.textContent = axis;
    axisLabel.title = "Drag up/down to scrub value";
    axisLabel.style.cssText = `
      padding: 8px 10px;
      font-size: 11px;
      font-weight: 700;
      color: ${axisColor};
      background: linear-gradient(180deg, ${axisColor}25 0%, ${axisColor}15 100%);
      min-width: 24px;
      text-align: center;
      cursor: ns-resize;
      user-select: none;
      border-right: 1px solid ${axisColor}30;
      transition: all 0.15s ease;
    `;
    
    // Scrub drag behavior (vertical: up increases, down decreases)
    let scrubStartY = 0;
    let scrubStartValue = 0;
    let isScrubbing = false;
    let scrubDialPopup = null;
    
    const showScrubDial = (value, x, y) => {
      if (!scrubDialPopup) {
        scrubDialPopup = doc.createElement("div");
        scrubDialPopup.style.cssText = `
          position: fixed;
          z-index: 10000;
          pointer-events: none;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        `;
        doc.body.appendChild(scrubDialPopup);
      }
      
      const dialSize = 72;
      const cx = dialSize / 2;
      const cy = dialSize / 2;
      const outerRadius = dialSize / 2 - 4;
      const innerRadius = 8;
      
      // Spinning wheel rotation based on value (like Price is Right wheel)
      // Rotates continuously as value changes - multiply by larger number for faster spin feel
      const rotation = value * 36; // 36 degrees per unit = full rotation every 10 units
      
      // Create wheel segments/spokes (like a windmill)
      const spokeCount = 12;
      const spokes = [];
      const pegs = [];
      
      for (let s = 0; s < spokeCount; s++) {
        const baseAngle = (s / spokeCount) * Math.PI * 2;
        const angle = baseAngle + degreesToRadians(rotation);
        
        // Alternating colors for wheel segments
        const isEven = s % 2 === 0;
        const spokeColor = isEven ? axisColor : `${axisColor}60`;
        
        // Spoke line
        const x1 = cx + Math.cos(angle) * innerRadius;
        const y1 = cy + Math.sin(angle) * innerRadius;
        const x2 = cx + Math.cos(angle) * (outerRadius - 6);
        const y2 = cy + Math.sin(angle) * (outerRadius - 6);
        spokes.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${spokeColor}" stroke-width="3" stroke-linecap="round"/>`);
        
        // Peg at end of spoke (like Price is Right wheel)
        const pegX = cx + Math.cos(angle) * (outerRadius - 3);
        const pegY = cy + Math.sin(angle) * (outerRadius - 3);
        pegs.push(`<circle cx="${pegX}" cy="${pegY}" r="4" fill="${isEven ? axisColor : 'rgba(255,255,255,0.3)'}" stroke="rgba(0,0,0,0.3)" stroke-width="1"/>`);
      }
      
      // Create outer tick marks (stationary reference)
      const tickCount = 24;
      const ticks = [];
      for (let t = 0; t < tickCount; t++) {
        const angle = (t / tickCount) * Math.PI * 2 - Math.PI / 2;
        const isMajor = t % 6 === 0;
        const r1 = outerRadius + 2;
        const r2 = outerRadius + (isMajor ? 8 : 5);
        const tx1 = cx + Math.cos(angle) * r1;
        const ty1 = cy + Math.sin(angle) * r1;
        const tx2 = cx + Math.cos(angle) * r2;
        const ty2 = cy + Math.sin(angle) * r2;
        ticks.push(`<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="rgba(255,255,255,${isMajor ? 0.4 : 0.15})" stroke-width="${isMajor ? 2 : 1}"/>`);
      }
      
      // Pointer/flapper at top (stationary)
      const pointerY = cy - outerRadius - 2;
      
      scrubDialPopup.innerHTML = `
        <svg width="${dialSize + 20}" height="${dialSize + 20}" style="filter: drop-shadow(0 4px 20px rgba(0,0,0,0.7));">
          <g transform="translate(10, 10)">
            <!-- Outer ring glow -->
            <circle cx="${cx}" cy="${cy}" r="${outerRadius + 1}" fill="none" stroke="${axisColor}30" stroke-width="3"/>
            <!-- Wheel background -->
            <circle cx="${cx}" cy="${cy}" r="${outerRadius}" fill="rgba(8,8,14,0.95)" stroke="${axisColor}50" stroke-width="2"/>
            <!-- Spokes -->
            ${spokes.join('')}
            <!-- Pegs -->
            ${pegs.join('')}
            <!-- Center hub -->
            <circle cx="${cx}" cy="${cy}" r="${innerRadius}" fill="rgba(20,20,30,1)" stroke="${axisColor}" stroke-width="2"/>
            <circle cx="${cx}" cy="${cy}" r="4" fill="${axisColor}"/>
            <!-- Stationary tick marks outside -->
            ${ticks.join('')}
            <!-- Pointer/flapper at top -->
            <polygon points="${cx},${pointerY - 10} ${cx - 6},${pointerY + 2} ${cx + 6},${pointerY + 2}" fill="${axisColor}" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
          </g>
          <defs>
            <filter id="wheelGlow${i}" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
        </svg>
        <div style="
          background: linear-gradient(180deg, rgba(20,20,28,0.98) 0%, rgba(10,10,14,0.98) 100%);
          border: 1px solid ${axisColor}50;
          border-radius: 8px;
          padding: 6px 14px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 15px;
          font-weight: 700;
          color: ${axisColor};
          box-shadow: 0 4px 20px rgba(0,0,0,0.6), 0 0 30px ${axisColor}25;
          letter-spacing: 0.02em;
        ">${value.toFixed(precision)}</div>
      `;
      
      scrubDialPopup.style.left = `${x}px`;
      scrubDialPopup.style.top = `${y - dialSize - 80}px`;
      scrubDialPopup.style.opacity = "1";
      scrubDialPopup.style.transform = "scale(1) translateX(-50%)";
      scrubDialPopup.style.transition = "opacity 0.1s, transform 0.1s";
    };
    
    const hideScrubDial = () => {
      if (scrubDialPopup) {
        scrubDialPopup.style.opacity = "0";
        scrubDialPopup.style.transform = "scale(0.9) translateX(-50%)";
        setTimeout(() => {
          if (scrubDialPopup && scrubDialPopup.parentNode) {
            scrubDialPopup.parentNode.removeChild(scrubDialPopup);
            scrubDialPopup = null;
          }
        }, 100);
      }
    };
    
    axisLabel.onmousedown = (e) => {
      e.preventDefault();
      isScrubbing = true;
      scrubStartY = e.clientY;
      scrubStartValue = Number(getValueAt(i)) || 0;
      axisLabel.style.background = `linear-gradient(180deg, ${axisColor}40 0%, ${axisColor}25 100%)`;
      doc.body.style.cursor = "ns-resize";
      
      // Show dial immediately
      const rect = inputGroup.getBoundingClientRect();
      showScrubDial(scrubStartValue, rect.left + rect.width / 2, rect.top);
      
      const onMouseMove = (moveE) => {
        if (!isScrubbing) return;
        const dy = scrubStartY - moveE.clientY; // Inverted: up = positive
        // Modifier keys: Shift = x10, Alt = x0.1
        let multiplier = step;
        if (moveE.shiftKey) multiplier = step * 10;
        if (moveE.altKey) multiplier = step * 0.1;
        
        let newValue = scrubStartValue + (dy * multiplier * 0.3);
        if (sanitize) {
          newValue = sanitize(newValue, { eventType: "scrub", input: inputs[i], event: moveE }, i);
        }
        if (setValueAt) {
          setValueAt(i, newValue, { eventType: "scrub", event: moveE }, { refreshAll });
        }
        refreshAll();
        
        // Update dial
        showScrubDial(newValue, rect.left + rect.width / 2, rect.top);
      };
      
      const onMouseUp = () => {
        isScrubbing = false;
        axisLabel.style.background = `linear-gradient(180deg, ${axisColor}25 0%, ${axisColor}15 100%)`;
        doc.body.style.cursor = "";
        hideScrubDial();
        doc.removeEventListener("mousemove", onMouseMove);
        doc.removeEventListener("mouseup", onMouseUp);
      };
      
      doc.addEventListener("mousemove", onMouseMove);
      doc.addEventListener("mouseup", onMouseUp);
    };
    
    // Hover effect on label
    axisLabel.onmouseenter = () => {
      if (!isScrubbing) {
        axisLabel.style.background = `linear-gradient(180deg, ${axisColor}35 0%, ${axisColor}20 100%)`;
      }
    };
    axisLabel.onmouseleave = () => {
      if (!isScrubbing) {
        axisLabel.style.background = `linear-gradient(180deg, ${axisColor}25 0%, ${axisColor}15 100%)`;
      }
    };
    
    inputGroup.appendChild(axisLabel);

    const input = doc.createElement("input");
    input.type = "number";
    input.step = String(step);
    input.style.cssText = `
      flex: 1;
      width: 100%;
      padding: 8px 8px;
      border: none;
      background: transparent;
      color: #e2e8f0;
      font-size: 12px;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-weight: 500;
      outline: none;
      text-align: right;
      -moz-appearance: textfield;
    `;
    input.classList.add("inspector-number-input");
    inputs.push(input);

    const binding = bindNumberInput(input, {
      getValue: () => Number(getValueAt(i)) || 0,
      setValue: (v, ctx) => {
        if (!setValueAt) return;
        setValueAt(i, v, ctx, { refreshAll });
      },
      precision,
      commitOn: "change",
      sanitize: sanitize ? (v, ctx) => sanitize(v, ctx, i) : null,
    });
    bindings.push(binding);

    // Select all on focus
    input.addEventListener("focus", () => {
      input.select();
      inputGroup.style.borderColor = `${axisColor}60`;
      inputGroup.style.boxShadow = `0 0 12px ${axisColor}30, inset 0 1px 0 rgba(255,255,255,0.08)`;
    });
    
    input.addEventListener("blur", () => {
      inputGroup.style.borderColor = "rgba(255,255,255,0.08)";
      inputGroup.style.boxShadow = "none";
    });
    
    // Keyboard shortcuts: Arrow keys with modifiers
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const direction = e.key === "ArrowUp" ? 1 : -1;
        let increment = step;
        if (e.shiftKey) increment = step * 10;
        if (e.altKey) increment = step * 0.1;
        if (e.ctrlKey || e.metaKey) increment = step * 100;
        
        let currentVal = Number(getValueAt(i)) || 0;
        let newValue = currentVal + (direction * increment);
        if (sanitize) {
          newValue = sanitize(newValue, { eventType: "keyboard", input, event: e }, i);
        }
        if (setValueAt) {
          setValueAt(i, newValue, { eventType: "keyboard", event: e }, { refreshAll });
        }
        refreshAll();
      }
    });
    
    // Mouse wheel support - reuses the scrub dial
    let wheelDialTimeout = null;
    
    inputGroup.addEventListener("wheel", (e) => {
      e.preventDefault();
      const direction = e.deltaY < 0 ? 1 : -1;
      let increment = step;
      if (e.shiftKey) increment = step * 10;
      if (e.altKey) increment = step * 0.1;
      if (e.ctrlKey || e.metaKey) increment = step * 100;
      
      let currentVal = Number(getValueAt(i)) || 0;
      let newValue = currentVal + (direction * increment);
      if (sanitize) {
        newValue = sanitize(newValue, { eventType: "wheel", input, event: e }, i);
      }
      if (setValueAt) {
        setValueAt(i, newValue, { eventType: "wheel", event: e }, { refreshAll });
      }
      refreshAll();
      
      // Show gauge dial popup (same as scrub)
      const rect = inputGroup.getBoundingClientRect();
      showScrubDial(newValue, rect.left + rect.width / 2, rect.top);
      
      // Hide dial after delay
      clearTimeout(wheelDialTimeout);
      wheelDialTimeout = setTimeout(hideScrubDial, 600);
    }, { passive: false });

    inputGroup.appendChild(input);
    inputsRow.appendChild(inputGroup);
  }

  row.appendChild(inputsRow);
  section.appendChild(row);

  return { row, refreshAll };
}

export function getValueAtPath(obj, path) {
  if (!obj || !path) {
    return undefined;
  }
  const parts = String(path).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    if (cur == null) {
      return undefined;
    }
    const asIndex = Number(key);
    if (Array.isArray(cur) && Number.isFinite(asIndex)) {
      cur = cur[asIndex];
    } else {
      cur = cur[key];
    }
  }
  return cur;
}

export function setValueAtPath(obj, path, value) {
  if (!obj || !path) {
    return false;
  }
  const parts = String(path).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const asIndex = Number(key);
    if (Array.isArray(cur) && Number.isFinite(asIndex)) {
      if (cur[asIndex] == null) {
        cur[asIndex] = {};
      }
      cur = cur[asIndex];
      continue;
    }
    if (cur[key] == null || typeof cur[key] !== "object") {
      cur[key] = {};
    }
    cur = cur[key];
  }
  const last = parts[parts.length - 1];
  const lastIndex = Number(last);
  if (Array.isArray(cur) && Number.isFinite(lastIndex)) {
    cur[lastIndex] = value;
    return true;
  }
  cur[last] = value;
  return true;
}

export function renderInspectorSchema(doc, container, schema, ctx = {}) {
  const model = ctx.model;
  const onApply = typeof ctx.onApply === "function" ? ctx.onApply : null;
  const sections = Array.isArray(schema) ? schema : [];

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (!s) continue;
    const sectionTitle = s.title != null ? String(s.title) : "";
    const isCollapsed = s.collapsed === true;
    const section = createCollapsibleSection(doc, container, sectionTitle, isCollapsed);
    const fields = Array.isArray(s.fields) ? s.fields : [];

    for (let j = 0; j < fields.length; j++) {
      const f = fields[j];
      if (!f) continue;
      const type = f.type || "number";
      const label = f.label != null ? String(f.label) : "";
      const path = typeof f.path === "string" ? f.path : null;
      const getValue =
        typeof f.getValue === "function"
          ? f.getValue
          : () => (model && path ? getValueAtPath(model, path) : undefined);
      const setValue =
        typeof f.setValue === "function"
          ? f.setValue
          : (v) => {
              if (model && path) {
                setValueAtPath(model, path, v);
              }
              if (onApply) {
                onApply();
              }
            };

      if (type === "vec3" || type === "vec4") {
        const size = type === "vec4" ? 4 : 3;
        const axes = Array.isArray(f.axes) && f.axes.length >= size
          ? f.axes
          : size === 4
            ? ["X", "Y", "Z", "W"]
            : ["X", "Y", "Z"];
        const step = typeof f.step === "number" && Number.isFinite(f.step) ? f.step : 0.01;
        const precision = typeof f.precision === "number" && Number.isFinite(f.precision) ? f.precision : 3;
        const sanitize = typeof f.sanitize === "function" ? f.sanitize : null;

        const customSetValueAt = typeof f.setValueAt === "function" ? f.setValueAt : null;
        const ensureArray = () => {
          let arr = getValue();
          if (!Array.isArray(arr)) {
            arr = [];
          }
          if (arr.length < size) {
            for (let k = arr.length; k < size; k++) {
              arr[k] = 0;
            }
          }
          if (model && path && !Array.isArray(getValueAtPath(model, path))) {
            setValueAtPath(model, path, arr);
          }
          return arr;
        };

        addVectorRow(doc, section, {
          label: label,
          axes,
          step,
          precision,
          sanitize: sanitize ? (v, c, idx) => sanitize(v, c, idx) : null,
          getValueAt: (idx) => {
            const arr = ensureArray();
            return arr[idx];
          },
          setValueAt: (idx, v, c, helpers) => {
            if (customSetValueAt) {
              customSetValueAt(idx, v, c, helpers);
              return;
            }
            const arr = ensureArray();
            arr[idx] = v;
            if (onApply) {
              onApply();
            }
          },
        });
      } else if (type === "slider") {
        addSliderRow(
          doc,
          section,
          label,
          Number(f.min) || 0,
          Number(f.max) || 1,
          Number(f.step) || 0.01,
          () => Number(getValue()) || 0,
          (v) => setValue(v),
          f.options || {},
        );
      } else if (type === "checkbox") {
        addCheckboxRow(doc, section, label, () => !!getValue(), (v) => setValue(!!v));
      } else if (type === "text") {
        addTextRow(doc, section, label, () => getValue(), (v) => setValue(v));
      } else if (type === "select") {
        const items = Array.isArray(f.items) ? f.items : [];
        addSelectRow(doc, section, label, items, () => getValue(), (v) => setValue(v));
      } else if (type === "color") {
        // Color picker for RGBA values
        const row = doc.createElement("div");
        row.style.display = "grid";
        row.style.gridTemplateColumns = "110px 1fr";
        row.style.gap = INSPECTOR_THEME.spacing.md;
        row.style.alignItems = "center";
        row.style.marginBottom = INSPECTOR_THEME.spacing.md;

        const labelEl = doc.createElement("div");
        labelEl.textContent = label;
        labelEl.style.fontSize = INSPECTOR_THEME.fontSize.lg;
        labelEl.style.color = INSPECTOR_THEME.colors.text.primary;
        labelEl.style.userSelect = "none";
        row.appendChild(labelEl);

        const wrap = doc.createElement("div");
        wrap.style.display = "flex";
        wrap.style.alignItems = "center";
        wrap.style.gap = "10px";

        const colorInput = doc.createElement("input");
        colorInput.type = "color";
        const rgbaToHex = (rgba) => {
          if (!rgba || !Array.isArray(rgba)) return '#996633';
          return rgbToHex([rgba[0] || 0, rgba[1] || 0, rgba[2] || 0]);
        };
        const hexToRgba = (hex) => {
          const [r, g, b] = hexToRgb(hex);
          return [r, g, b, 1];
        };
        colorInput.value = rgbaToHex(getValue());
        Object.assign(colorInput.style, {
          width: "48px",
          height: "32px",
          border: `2px solid ${INSPECTOR_THEME.colors.border.medium}`,
          borderRadius: "6px",
          cursor: "pointer",
          padding: "2px",
          background: INSPECTOR_THEME.colors.bg.tertiary,
        });
        colorInput.oninput = () => setValue(hexToRgba(colorInput.value));
        wrap.appendChild(colorInput);

        // Hex display
        const hexDisplay = doc.createElement("span");
        hexDisplay.textContent = rgbaToHex(getValue()).toUpperCase();
        hexDisplay.style.fontSize = "11px";
        hexDisplay.style.fontFamily = "monospace";
        hexDisplay.style.color = INSPECTOR_THEME.colors.text.secondary;
        hexDisplay.style.padding = "4px 8px";
        hexDisplay.style.background = INSPECTOR_THEME.colors.bg.tertiary;
        hexDisplay.style.borderRadius = "4px";
        colorInput.oninput = () => {
          setValue(hexToRgba(colorInput.value));
          hexDisplay.textContent = colorInput.value.toUpperCase();
        };
        wrap.appendChild(hexDisplay);

        row.appendChild(wrap);
        section.appendChild(row);
      } else if (type === "preset-buttons") {
        const row = doc.createElement("div");
        row.style.display = "grid";
        row.style.gridTemplateColumns = "110px 1fr";
        row.style.gap = INSPECTOR_THEME.spacing.md;
        row.style.alignItems = "center";
        row.style.marginBottom = INSPECTOR_THEME.spacing.md;

        const labelEl = doc.createElement("div");
        labelEl.textContent = label;
        labelEl.style.fontSize = INSPECTOR_THEME.fontSize.lg;
        labelEl.style.color = INSPECTOR_THEME.colors.text.primary;
        labelEl.style.userSelect = "none";
        row.appendChild(labelEl);

        const wrap = doc.createElement("div");
        wrap.style.display = "flex";
        wrap.style.gap = "6px";
        wrap.style.flexWrap = "wrap";

        const presets = Array.isArray(f.presets) ? f.presets : [];
        const refreshActive = () => {
          const current = getValue();
          for (let k = 0; k < wrap.children.length; k++) {
            const btn = wrap.children[k];
            if (!btn || btn.tagName !== 'BUTTON') continue;
            const v = btn.dataset && Object.prototype.hasOwnProperty.call(btn.dataset, 'presetValue')
              ? parseFloat(btn.dataset.presetValue)
              : null;
            const active = typeof current === 'number' && Number.isFinite(current) && v != null && Math.abs(current - v) < 1e-12;
            const baseStyle = INSPECTOR_THEME.components.button.base;
            const variantStyle = active ? INSPECTOR_THEME.components.button.primary : INSPECTOR_THEME.components.button.secondary;
            Object.assign(btn.style, baseStyle, variantStyle);
          }
        };

        for (let p = 0; p < presets.length; p++) {
          const preset = presets[p];
          if (!preset) continue;
          const btn = doc.createElement('button');
          btn.textContent = preset.name != null ? String(preset.name) : 'Preset';
          btn.dataset.presetValue = String(preset.value);
          btn.onclick = () => {
            setValue(preset.value);
            refreshActive();
          };
          wrap.appendChild(btn);
        }

        row.appendChild(wrap);
        section.appendChild(row);
        refreshActive();
      } else {
        addNumberRow(
          doc,
          section,
          label,
          () => Number(getValue()) || 0,
          (v) => setValue(v),
          f.step,
        );
      }
    }
  }
}

export function addNumberRow(doc, section, labelText, getValue, setValue, step) {
  const row = doc.createElement("div");
  row.style.display = "grid";
  row.style.gridTemplateColumns = "110px 1fr";
  row.style.gap = INSPECTOR_THEME.spacing.md;
  row.style.alignItems = "center";
  row.style.marginBottom = INSPECTOR_THEME.spacing.md;

  const label = doc.createElement("div");
  label.textContent = labelText;
  label.style.fontSize = INSPECTOR_THEME.fontSize.lg;
  label.style.color = INSPECTOR_THEME.colors.text.primary;
  label.style.userSelect = "none";
  row.appendChild(label);

  const input = doc.createElement("input");
  input.type = "number";
  input.value = String(getValue());
  input.step = String(step || 0.1);
  Object.assign(input.style, INSPECTOR_THEME.components.input.base);
  input.classList.add("inspector-number-input");

  bindNumberInput(input, {
    getValue,
    setValue,
    commitOn: "change",
  });
  row.appendChild(input);

  section.appendChild(row);
}

export function bindNumberInput(input, options = {}) {
  if (!input) {
    return { refresh() {} };
  }

  const getValue = typeof options.getValue === "function" ? options.getValue : null;
  const setValue = typeof options.setValue === "function" ? options.setValue : null;
  const parseValue = typeof options.parseValue === "function" ? options.parseValue : (v) => parseFloat(v);
  const precision =
    typeof options.precision === "number" && Number.isFinite(options.precision)
      ? Math.max(0, options.precision)
      : null;
  const formatValue =
    typeof options.formatValue === "function"
      ? options.formatValue
      : (v) => {
          if (typeof v !== "number" || !Number.isFinite(v)) {
            return "";
          }
          return precision == null ? String(v) : v.toFixed(precision);
        };
  const sanitize = typeof options.sanitize === "function" ? options.sanitize : null;
  const min = typeof options.min === "number" && Number.isFinite(options.min) ? options.min : null;
  const max = typeof options.max === "number" && Number.isFinite(options.max) ? options.max : null;
  const commitOn = options.commitOn === "input" ? "input" : "change";
  const liveOn = options.liveOn === "input" ? "input" : null;

  function readModelValue() {
    if (!getValue) {
      const parsed = parseValue(input.value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    const v = getValue();
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }

  function writeDisplayValue(v) {
    input.value = formatValue(v);
  }

  function coerceValue(v, eventType, event) {
    let out = v;
    if (sanitize) {
      out = sanitize(out, { eventType, input, event });
    }
    if (typeof out !== "number" || !Number.isFinite(out)) {
      return null;
    }
    if (min != null && out < min) out = min;
    if (max != null && out > max) out = max;
    return out;
  }

  function applyValue(eventType, event) {
    if (!setValue) {
      return;
    }
    const parsed = parseValue(input.value);
    if (!Number.isFinite(parsed)) {
      const current = readModelValue();
      if (current != null) {
        writeDisplayValue(current);
      }
      return;
    }
    const coerced = coerceValue(parsed, eventType, event);
    if (coerced == null) {
      const current = readModelValue();
      if (current != null) {
        writeDisplayValue(current);
      }
      return;
    }
    setValue(coerced, { eventType, input, event });
    const next = readModelValue();
    if (next != null) {
      writeDisplayValue(next);
    }
  }

  if (liveOn) {
    input.addEventListener(liveOn, (e) => applyValue("input", e));
  }
  input.addEventListener(commitOn, (e) => applyValue(commitOn, e));

  const initial = readModelValue();
  if (initial != null) {
    writeDisplayValue(initial);
  }

  return {
    refresh() {
      const v = readModelValue();
      if (v != null) {
        writeDisplayValue(v);
      }
    },
  };
}

export function bindRangeInput(input, options = {}) {
  const opts = { ...options };
  if (opts.commitOn == null) {
    opts.commitOn = "input";
  }
  if (opts.liveOn == null) {
    opts.liveOn = null;
  }
  return bindNumberInput(input, opts);
}

export function bindTextInput(input, options = {}) {
  if (!input) {
    return { refresh() {} };
  }

  const getValue = typeof options.getValue === "function" ? options.getValue : null;
  const setValue = typeof options.setValue === "function" ? options.setValue : null;
  const parseValue = typeof options.parseValue === "function" ? options.parseValue : (v) => String(v ?? "");
  const formatValue = typeof options.formatValue === "function" ? options.formatValue : (v) => String(v ?? "");
  const sanitize = typeof options.sanitize === "function" ? options.sanitize : null;
  const commitOn = options.commitOn === "input" ? "input" : "change";
  const liveOn = options.liveOn === "input" ? "input" : null;

  function readModelValue() {
    if (!getValue) {
      return parseValue(input.value);
    }
    return getValue();
  }

  function writeDisplayValue(v) {
    input.value = formatValue(v);
  }

  function coerceValue(v, eventType, event) {
    let out = v;
    if (sanitize) {
      out = sanitize(out, { eventType, input, event });
    }
    return out;
  }

  function applyValue(eventType, event) {
    if (!setValue) {
      return;
    }
    const parsed = parseValue(input.value);
    const coerced = coerceValue(parsed, eventType, event);
    setValue(coerced, { eventType, input, event });
    const next = readModelValue();
    writeDisplayValue(next);
  }

  if (liveOn) {
    input.addEventListener(liveOn, (e) => applyValue("input", e));
  }
  input.addEventListener(commitOn, (e) => applyValue(commitOn, e));

  writeDisplayValue(readModelValue());

  return {
    refresh() {
      writeDisplayValue(readModelValue());
    },
  };
}

export function bindCheckboxInput(input, options = {}) {
  if (!input) {
    return { refresh() {} };
  }

  const getValue = typeof options.getValue === "function" ? options.getValue : null;
  const setValue = typeof options.setValue === "function" ? options.setValue : null;
  const commitOn = options.commitOn === "input" ? "input" : "change";

  function readModelValue() {
    if (!getValue) {
      return !!input.checked;
    }
    return !!getValue();
  }

  function writeDisplayValue(v) {
    input.checked = !!v;
  }

  function applyValue(eventType, event) {
    if (!setValue) {
      return;
    }
    setValue(!!input.checked, { eventType, input, event });
    writeDisplayValue(readModelValue());
  }

  input.addEventListener(commitOn, (e) => applyValue(commitOn, e));
  writeDisplayValue(readModelValue());

  return {
    refresh() {
      writeDisplayValue(readModelValue());
    },
  };
}

export function bindSelectInput(select, options = {}) {
  if (!select) {
    return { refresh() {} };
  }

  const getValue = typeof options.getValue === "function" ? options.getValue : null;
  const setValue = typeof options.setValue === "function" ? options.setValue : null;
  const commitOn = options.commitOn === "input" ? "input" : "change";

  function readModelValue() {
    if (!getValue) {
      return select.value;
    }
    const v = getValue();
    return v == null ? "" : String(v);
  }

  function writeDisplayValue(v) {
    select.value = v == null ? "" : String(v);
  }

  function applyValue(eventType, event) {
    if (!setValue) {
      return;
    }
    setValue(select.value, { eventType, input: select, event });
    writeDisplayValue(readModelValue());
  }

  select.addEventListener(commitOn, (e) => applyValue(commitOn, e));
  writeDisplayValue(readModelValue());

  return {
    refresh() {
      writeDisplayValue(readModelValue());
    },
  };
}

export function showInspectorTextInputModal(doc, options = {}) {
  const modalId = options.id || "inspector-text-input-modal";
  const titleText = options.title != null ? String(options.title) : "";
  const initialValue = options.value != null ? String(options.value) : "";
  const onSubmit = typeof options.onSubmit === "function" ? options.onSubmit : null;

  let modal = doc.getElementById(modalId);
  if (!modal) {
    modal = doc.createElement("div");
    modal.id = modalId;
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 10001;
      display: none;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;
    doc.body.appendChild(modal);
  }

  modal.innerHTML = "";

  const overlay = doc.createElement("div");
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  const content = doc.createElement("div");
  content.style.cssText = `
    background-color: #252526;
    border-radius: 8px;
    width: min(420px, 92vw);
    max-width: 92vw;
    overflow: hidden;
    border: 1px solid #464647;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  `;

  const header = doc.createElement("div");
  header.style.cssText = `
    padding: 14px 16px;
    border-bottom: 1px solid #464647;
    display: flex;
    align-items: center;
    justify-content: space-between;
  `;

  const title = doc.createElement("div");
  title.textContent = titleText;
  title.style.cssText = "color: #ffffff; font-size: 14px; font-weight: 600;";

  const closeBtn = doc.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.style.cssText = `
    background: none;
    border: none;
    color: #cccccc;
    font-size: 22px;
    cursor: pointer;
    width: 28px;
    height: 28px;
    border-radius: 4px;
  `;
  closeBtn.onmouseenter = () => {
    closeBtn.style.backgroundColor = "#464647";
    closeBtn.style.color = "#ffffff";
  };
  closeBtn.onmouseleave = () => {
    closeBtn.style.backgroundColor = "transparent";
    closeBtn.style.color = "#cccccc";
  };

  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = doc.createElement("div");
  body.style.cssText = "padding: 16px;";

  const input = doc.createElement("input");
  input.type = "text";
  input.value = initialValue;
  input.style.cssText = `
    width: 100%;
    background-color: #3c3c3c;
    border: 1px solid #464647;
    border-radius: 4px;
    color: #ffffff;
    padding: 10px 12px;
    font-size: 14px;
    box-sizing: border-box;
    outline: none;
  `;
  input.onfocus = () => {
    input.style.borderColor = "#0078d4";
    input.style.boxShadow = "0 0 0 2px rgba(0,120,212,0.2)";
  };
  input.onblur = () => {
    input.style.borderColor = "#464647";
    input.style.boxShadow = "none";
  };
  body.appendChild(input);

  const footer = doc.createElement("div");
  footer.style.cssText = "padding: 0 16px 16px; display: flex; gap: 10px; justify-content: flex-end;";

  const cancelBtn = doc.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText = "padding: 8px 14px; background: transparent; color: #cccccc; border: 1px solid #464647; border-radius: 4px; font-size: 13px; cursor: pointer;";
  cancelBtn.onmouseenter = () => {
    cancelBtn.style.backgroundColor = "#464647";
    cancelBtn.style.color = "#ffffff";
  };
  cancelBtn.onmouseleave = () => {
    cancelBtn.style.backgroundColor = "transparent";
    cancelBtn.style.color = "#cccccc";
  };

  const okBtn = doc.createElement("button");
  okBtn.textContent = "OK";
  okBtn.style.cssText = "padding: 8px 14px; background: #0078d4; color: #ffffff; border: 1px solid #106ebe; border-radius: 4px; font-size: 13px; cursor: pointer;";
  okBtn.onmouseenter = () => {
    okBtn.style.backgroundColor = "#106ebe";
  };
  okBtn.onmouseleave = () => {
    okBtn.style.backgroundColor = "#0078d4";
  };

  const close = () => {
    modal.style.display = "none";
  };
  closeBtn.onclick = close;
  cancelBtn.onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };

  const submit = () => {
    const value = input.value.trim();
    close();
    if (onSubmit) onSubmit(value);
  };
  okBtn.onclick = submit;
  input.onkeydown = (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") close();
  };

  footer.appendChild(cancelBtn);
  footer.appendChild(okBtn);

  content.appendChild(header);
  content.appendChild(body);
  content.appendChild(footer);
  overlay.appendChild(content);
  modal.appendChild(overlay);

  modal.style.display = "block";
  input.focus();
  input.select();
}

export function showInspectorContextMenu(doc, options = {}) {
  const menuId = options.id || "inspector-context-menu";
  const items = Array.isArray(options.items) ? options.items : [];
  const onAction = typeof options.onAction === "function" ? options.onAction : null;
  const x = Number(options.x);
  const y = Number(options.y);
  const safeX = Number.isFinite(x) ? x : 0;
  const safeY = Number.isFinite(y) ? y : 0;

  let menu = doc.getElementById(menuId);
  if (!menu) {
    menu = doc.createElement("div");
    menu.id = menuId;
    menu.className = "inspector-context-menu";
    menu.style.cssText = `
      position: fixed;
      background-color: #2d2d30;
      border: 1px solid #464647;
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      z-index: 10003;
      display: none;
      font-size: 13px;
      padding: 4px 0;
      min-width: 180px;
      max-height: calc(100vh - 16px);
      overflow-y: auto;
      pointer-events: auto;
    `;
    doc.body.appendChild(menu);
  }

  menu.className = "inspector-context-menu";

  if (!menu.__inspectorOutsideHandlerAttached) {
    Object.defineProperty(menu, "__inspectorOutsideHandlerAttached", { value: true });
    doc.addEventListener("click", (evt) => {
      try {
        if (evt && evt.target && evt.target.closest && evt.target.closest(".inspector-context-menu")) {
          return;
        }
        const menus = doc.querySelectorAll(".inspector-context-menu");
        menus.forEach((m) => {
          m.style.display = "none";
        });
      } catch (_) {}
    });
  }

  menu.innerHTML = "";
  for (const item of items) {
    if (!item) continue;
    if (item.type === "separator") {
      const sep = doc.createElement("div");
      sep.style.cssText = "height: 1px; background-color: #464647; margin: 4px 0;";
      menu.appendChild(sep);
      continue;
    }

    const disabled = !!item.disabled;
    const danger = !!item.danger;
    const row = doc.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.justifyContent = "space-between";
    row.style.gap = "12px";
    row.style.padding = "8px 16px";
    row.style.cursor = disabled ? "default" : "pointer";
    row.style.opacity = disabled ? "0.6" : "1";
    row.style.userSelect = "none";

    const label = doc.createElement("div");
    label.textContent = item.label != null ? String(item.label) : "";
    label.style.color = disabled ? "#666666" : danger ? "#ff6b6b" : "#cccccc";
    row.appendChild(label);

    if (item.shortcut) {
      const shortcut = doc.createElement("div");
      shortcut.textContent = String(item.shortcut);
      shortcut.style.fontSize = "11px";
      shortcut.style.opacity = "0.7";
      shortcut.style.color = "#8c8c8c";
      row.appendChild(shortcut);
    }

    if (!disabled) {
      row.onmouseenter = () => {
        row.style.backgroundColor = "#37373d";
        label.style.color = "#ffffff";
      };
      row.onmouseleave = () => {
        row.style.backgroundColor = "transparent";
        label.style.color = danger ? "#ff6b6b" : "#cccccc";
      };
      row.onclick = (evt) => {
        evt.stopPropagation();
        menu.style.display = "none";
        if (onAction) onAction(item.action);
      };
    }

    menu.appendChild(row);
  }

  const view = doc.defaultView || window;
  const margin = 8;
  menu.style.left = safeX + "px";
  menu.style.top = safeY + "px";
  menu.style.display = "block";

  try {
    const rect = menu.getBoundingClientRect();
    const vw = typeof view.innerWidth === "number" ? view.innerWidth : window.innerWidth;
    const vh = typeof view.innerHeight === "number" ? view.innerHeight : window.innerHeight;

    let left = safeX;
    let top = safeY;
    if (rect.right > vw - margin) {
      left = Math.max(margin, vw - rect.width - margin);
    }
    if (rect.bottom > vh - margin) {
      top = Math.max(margin, vh - rect.height - margin);
    }
    if (left < margin) left = margin;
    if (top < margin) top = margin;

    menu.style.left = left + "px";
    menu.style.top = top + "px";
  } catch (_) {}
  return menu;
}

export function addConfigRow(doc, container, options) {
  const opts = options || {};
  const labelText = opts.label != null ? String(opts.label) : "";
  const initialValue = opts.value != null ? opts.value : "";
  const type = opts.type || "number";

  const row = doc.createElement("div");
  row.style.display = "flex";
  row.style.justifyContent = "space-between";
  row.style.alignItems = "center";
  row.style.marginBottom = INSPECTOR_THEME.spacing.sm;
  row.style.fontSize = INSPECTOR_THEME.fontSize.md;

  const labelEl = doc.createElement("span");
  labelEl.textContent = labelText;
  labelEl.style.color = INSPECTOR_THEME.colors.text.muted;

  const input = doc.createElement("input");
  input.type = type;
  input.value = String(initialValue);
  input.style.width = "80px";
  input.style.background = INSPECTOR_THEME.colors.bg.active;
  input.style.border = `1px solid ${INSPECTOR_THEME.colors.border.light}`;
  input.style.borderRadius = INSPECTOR_THEME.radius.sm;
  input.style.color = INSPECTOR_THEME.colors.text.primary;
  input.style.padding = `${INSPECTOR_THEME.spacing.xs} ${INSPECTOR_THEME.spacing.sm}`;
  input.style.textAlign = "right";

  input.onchange = () => {
    if (typeof opts.onChange !== "function") {
      return;
    }
    if (type === "number") {
      const parsed = parseFloat(input.value);
      if (!Number.isFinite(parsed)) {
        return;
      }
      opts.onChange(parsed);
    } else {
      opts.onChange(input.value);
    }
  };

  row.appendChild(labelEl);
  row.appendChild(input);
  container.appendChild(row);
}

export function addSliderRow(
  doc,
  section,
  labelText,
  min,
  max,
  step,
  getValue,
  setValue,
  options = {},
) {
  const row = doc.createElement("div");
  row.style.display = "flex";
  row.style.flexDirection = "column";
  row.style.gap = INSPECTOR_THEME.spacing.sm;
  row.style.marginBottom = INSPECTOR_THEME.spacing.md;

  const label = doc.createElement("div");
  label.style.display = "flex";
  label.style.justifyContent = "space-between";
  label.style.alignItems = "center";
  
  const labelText_ = doc.createElement("span");
  labelText_.textContent = labelText;
  labelText_.style.fontSize = INSPECTOR_THEME.fontSize.md;
  labelText_.style.color = INSPECTOR_THEME.colors.text.secondary;
  label.appendChild(labelText_);

  const valueLabel = doc.createElement("span");
  valueLabel.style.fontSize = INSPECTOR_THEME.fontSize.md;
  valueLabel.style.color = INSPECTOR_THEME.colors.text.primary;
  valueLabel.style.fontFamily = "monospace";
  valueLabel.style.fontWeight = INSPECTOR_THEME.fontWeight.medium;
  valueLabel.classList.add("inspector-slider-value");
  label.appendChild(valueLabel);
  row.appendChild(label);

  const slider = doc.createElement("input");
  slider.type = "range";
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  const initial = getValue();
  slider.value = String(initial);
  slider.style.width = "100%";
  slider.style.accentColor = options.accent || INSPECTOR_THEME.colors.semantic.info;
  slider.style.cursor = "pointer";
  slider.classList.add("inspector-slider");
  slider.style.setProperty("--slider-accent", options.accent || INSPECTOR_THEME.colors.semantic.info);

  const resolvedSnap = getSnapPoints(min, max, options.snapPoints, options.tickCount);
  const shouldSnap = resolvedSnap && options.snapToPoints === true;
  const precision = typeof options.precision === "number" ? options.precision : 2;
  const updateValue = (val) => {
    valueLabel.textContent = formatSliderValue(val, options.formatValue, precision);
  };
  updateValue(initial);

  slider.oninput = function () {
    let v = parseFloat(slider.value);
    if (!Number.isFinite(v)) {
      return;
    }
    if (shouldSnap) {
      v = snapValueToPoints(v, resolvedSnap);
      slider.value = String(v);
    }
    setValue(v);
    updateValue(v);
  };

  row.appendChild(slider);
  if (resolvedSnap) {
    row.appendChild(createSliderTicks(doc, resolvedSnap));
  }
  section.appendChild(row);
}

export function addCheckboxRow(doc, section, labelText, getValue, setValue) {
  const row = doc.createElement("label");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.gap = INSPECTOR_THEME.spacing.md;
  row.style.marginBottom = INSPECTOR_THEME.spacing.sm;
  row.style.cursor = "pointer";
  row.style.padding = `${INSPECTOR_THEME.spacing.xs} 0`;

  const input = doc.createElement("input");
  input.type = "checkbox";
  input.checked = !!getValue();
  input.style.accentColor = INSPECTOR_THEME.colors.semantic.info;

  bindCheckboxInput(input, {
    getValue,
    setValue,
    commitOn: "change",
  });
  row.appendChild(input);

  const label = doc.createElement("span");
  label.textContent = labelText;
  label.style.fontSize = INSPECTOR_THEME.fontSize.md;
  label.style.color = INSPECTOR_THEME.colors.text.primary;
  row.appendChild(label);

  section.appendChild(row);
}

export function addTextRow(doc, section, labelText, getValue, setValue) {
  const row = doc.createElement("div");
  row.style.display = "grid";
  row.style.gridTemplateColumns = "110px 1fr";
  row.style.gap = INSPECTOR_THEME.spacing.md;
  row.style.alignItems = "center";
  row.style.marginBottom = INSPECTOR_THEME.spacing.md;

  const label = doc.createElement("div");
  label.textContent = labelText;
  label.style.fontSize = INSPECTOR_THEME.fontSize.lg;
  label.style.color = INSPECTOR_THEME.colors.text.primary;
  row.appendChild(label);

  const input = doc.createElement("input");
  input.type = "text";
  input.value = String(getValue() ?? "");
  Object.assign(input.style, INSPECTOR_THEME.components.input.base);

  bindTextInput(input, {
    getValue,
    setValue,
    commitOn: "change",
  });
  row.appendChild(input);

  section.appendChild(row);
}
