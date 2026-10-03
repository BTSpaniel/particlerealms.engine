// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { degreesToRadians } from "../../../../core/math/UnitMath.js";

export function createGyroAimControl(doc, options = {}) {
  const emitterCfg = options.emitterCfg || {};
  const setGhostOffset =
    typeof options.setGhostOffset === "function" ? options.setGhostOffset : null;

  if (
    typeof emitterCfg.aimYawDeg !== "number" ||
    !Number.isFinite(emitterCfg.aimYawDeg)
  ) {
    emitterCfg.aimYawDeg = 0;
  }
  if (
    typeof emitterCfg.aimPitchDeg !== "number" ||
    !Number.isFinite(emitterCfg.aimPitchDeg)
  ) {
    emitterCfg.aimPitchDeg = 0;
  }
  if (
    typeof emitterCfg.aimRadius !== "number" ||
    !Number.isFinite(emitterCfg.aimRadius) ||
    emitterCfg.aimRadius <= 0
  ) {
    emitterCfg.aimRadius = 2.5;
  }

  let yawDeg = emitterCfg.aimYawDeg;
  let pitchDeg = emitterCfg.aimPitchDeg;
  let lastDirX = 0;
  let lastDirY = 0;
  let lastDirZ = 1;
  let readoutValue = null;

  const root = doc.createElement("div");
  root.style.display = "flex";
  root.style.alignItems = "center";
  root.style.justifyContent = "flex-start";
  root.style.gap = "14px";

  const canvas = doc.createElement("canvas");
  canvas.width = 120;
  canvas.height = 120;
  canvas.style.width = "120px";
  canvas.style.height = "120px";
  canvas.style.background = "#0a0a0f";
  canvas.style.borderRadius = "999px";
  canvas.style.border = "1px solid #0a0a0f";
  canvas.style.boxShadow =
    "0 0 0 1px rgba(15,23,42,0.9), 0 0 30px rgba(15,23,42,0.9)";
  canvas.style.cursor = "grab";
  root.appendChild(canvas);

  const readout = doc.createElement("div");
  readout.style.display = "flex";
  readout.style.flexDirection = "column";
  readout.style.justifyContent = "center";
  readout.style.rowGap = "3px";
  readout.style.minWidth = "96px";

  const readoutLabel = doc.createElement("div");
  readoutLabel.textContent = "Yaw / Pitch";
  readoutLabel.style.fontSize = "10px";
  readoutLabel.style.color = "#9ca3af";
  readoutLabel.style.userSelect = "none";
  readout.appendChild(readoutLabel);

  readoutValue = doc.createElement("div");
  readoutValue.style.fontSize = "13px";
  readoutValue.style.fontWeight = "600";
  readoutValue.style.fontFamily =
    "system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  readoutValue.style.color = "#e5e7eb";
  readoutValue.style.textShadow =
    "0 0 2px #000000, 0 0 5px #000000, 0 0 1px #ffffff";
  readout.appendChild(readoutValue);

  root.appendChild(readout);

  const ctx = canvas.getContext("2d");

  function updateDirectionAndGhost() {
    const step = 1;
    yawDeg = Math.round(yawDeg / step) * step;
    pitchDeg = Math.round(pitchDeg / step) * step;
    if (pitchDeg < -80) pitchDeg = -80;
    if (pitchDeg > 80) pitchDeg = 80;
    emitterCfg.aimYawDeg = yawDeg;
    emitterCfg.aimPitchDeg = pitchDeg;

    const yawRad = degreesToRadians(yawDeg);
    const pitchRad = degreesToRadians(pitchDeg);
    const cy = Math.cos(yawRad);
    const sy = Math.sin(yawRad);
    const cp = Math.cos(pitchRad);
    const sp = Math.sin(pitchRad);

    let dirX = sy * cp;
    let dirY = sp;
    let dirZ = cy * cp;

    const len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1;
    const nx = dirX / len;
    const ny = dirY / len;
    const nz = dirZ / len;

    lastDirX = nx;
    lastDirY = ny;
    lastDirZ = nz;

    emitterCfg.direction = [nx, ny, nz];

    if (setGhostOffset) {
      const r = emitterCfg.aimRadius;
      setGhostOffset([nx * r, ny * r, nz * r]);
    }

    draw();
    updateReadout();
  }

  function drawRings(rOuter) {
    const ringCount = 3;
    for (let i = 0; i < ringCount; i++) {
      const t = i / (ringCount - 1 || 1);
      const r = rOuter * (0.4 + 0.5 * t);
      const alpha = 0.5 - t * 0.25;
      ctx.strokeStyle = `rgba(15,23,42,${alpha.toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawFace(rOuter) {
    const rInner = rOuter * 0.9;

    const grad = ctx.createRadialGradient(0, 0, rInner * 0.1, 0, 0, rInner);
    grad.addColorStop(0, "#0a0a0f");
    grad.addColorStop(0.5, "#0a0a0f");
    grad.addColorStop(1, "#0a0a0f");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, rInner, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(15,23,42,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, rInner, 0, Math.PI * 2);
    ctx.stroke();

    drawRings(rInner * 0.95);

    const axisRadius = rInner * 0.72;
    ctx.strokeStyle = "rgba(15,23,42,0.9)";
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(-axisRadius, 0);
    ctx.lineTo(axisRadius, 0);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -axisRadius);
    ctx.lineTo(0, axisRadius);
    ctx.stroke();

    const labelRadius = rInner * 0.82;
    ctx.font = "9px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillStyle = "#ef4444";
    ctx.fillText("W", -labelRadius, 0);

    ctx.fillStyle = "#3b82f6";
    ctx.fillText("E", labelRadius, 0);

    ctx.fillStyle = "#f9fafb";
    ctx.fillText("N", 0, -labelRadius);

    ctx.fillStyle = "#000000";
    ctx.fillText("S", 0, labelRadius);
  }

  function getRotorStrokeColor() {
    const nx = lastDirX;
    const ny = lastDirY;

    const tHoriz = Math.max(0, Math.min(1, (nx + 1) * 0.5));

    const rWest = 239;
    const gWest = 68;
    const bWest = 68;
    const rEast = 59;
    const gEast = 130;
    const bEast = 246;

    let r = rWest + (rEast - rWest) * tHoriz;
    let g = gWest + (gEast - gWest) * tHoriz;
    let b = bWest + (bEast - bWest) * tHoriz;

    const tVert = Math.max(0, Math.min(1, (ny + 1) * 0.5));
    const light = 0.15 + 0.85 * tVert;
    r *= light;
    g *= light;
    b *= light;

    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));

    const ri = Math.round(r);
    const gi = Math.round(g);
    const bi = Math.round(b);
    return `rgb(${ri}, ${gi}, ${bi})`;
  }

  function updateReadout() {
    if (!readoutValue) return;
    const yawText = `${Math.round(yawDeg)}°`;
    const pitchText = `${Math.round(pitchDeg)}°`;
    const label = `${yawText} / ${pitchText}`;
    readoutValue.textContent = label;
    const labelColor = getRotorStrokeColor();
    readoutValue.style.color = labelColor;
  }

  function drawRotor(rOuter) {
    const yawRad = degreesToRadians(yawDeg);
    const pitchNorm = pitchDeg / 90;
    const rRotor = rOuter * (0.25 + 0.65 * (1 - Math.abs(pitchNorm)));
    const rx = Math.sin(yawRad) * rRotor;
    const ry = -Math.cos(yawRad) * rRotor;

    const tailLen = rOuter * 0.12;
    const tx = -Math.sin(yawRad) * tailLen * 0.3;
    const ty = Math.cos(yawRad) * tailLen * 0.3;
    const strokeColor = getRotorStrokeColor();

    ctx.lineCap = "round";

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(rx, ry);
    ctx.stroke();

    ctx.strokeStyle = "rgba(249,250,251,0.9)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(rx, ry);
    ctx.stroke();

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(rx, ry);
    ctx.stroke();

    ctx.fillStyle = "#f9fafb";
    ctx.beginPath();
    ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(56,189,248,0.18)";
    ctx.beginPath();
    ctx.arc(0, 0, rOuter * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw() {
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const rOuter = Math.min(w, h) * 0.45;

    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(cx, cy);

    drawFace(rOuter);
    drawRotor(rOuter * 0.9);

    ctx.restore();
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = "grabbing";
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    const yawSpeed = 0.4;
    const pitchSpeed = 0.4;

    yawDeg += dx * yawSpeed;
    pitchDeg -= dy * pitchSpeed;

    updateDirectionAndGhost();
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = "grab";
    if (e && e.pointerId != null && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  }

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointerleave", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  updateDirectionAndGhost();

  return { element: root };
}
