// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { DefaultEngineConfig } from "./EngineDefaultConfig.js";

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function deepMerge(target, source) {
  if (!isPlainObject(source)) {
    return target;
  }
  const out = target;
  for (const key of Object.keys(source)) {
    const sVal = source[key];
    const tVal = out[key];
    if (isPlainObject(tVal) && isPlainObject(sVal)) {
      out[key] = deepMerge({ ...tVal }, sVal);
    } else {
      out[key] = sVal;
    }
  }
  return out;
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (trimmed === "" ) return "";

  if (trimmed[0] === "[" && trimmed[trimmed.length - 1] === "]") {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  const num = Number(trimmed);
  if (!Number.isNaN(num)) {
    return num;
  }

  return trimmed;
}

export function parseSimpleYaml(text) {
  const root = {};
  const stack = [{ indent: -1, obj: root }];

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine) continue;

    let indent = 0;
    while (indent < rawLine.length && rawLine[indent] === " ") {
      indent++;
    }
    const line = rawLine.slice(indent).trim();
    if (!line || line.startsWith("#")) continue;

    const level = Math.floor(indent / 2);
    while (stack.length > 1 && stack[stack.length - 1].indent >= level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }

    const key = line.slice(0, colonIndex).trim();
    const rest = line.slice(colonIndex + 1);
    if (!rest.trim()) {
      const child = {};
      parent[key] = child;
      stack.push({ indent: level, obj: child });
      continue;
    }

    const value = parseScalar(rest);
    parent[key] = value;
  }

  return root;
}

export async function loadEngineConfig(options = {}) {
  const { configUrl = "./engine.cfg", logger = null } = options;

  let config = cloneConfig(DefaultEngineConfig);

  if (typeof fetch !== "function") {
    return config;
  }

  try {
    const response = await fetch(configUrl);
    if (!response.ok) {
      if (logger && typeof logger.warn === "function") {
        logger.warn(
          `[EngineConfig] Config file not found or failed to load: ${configUrl} (status ${response.status})`,
        );
      }
      return config;
    }

    const text = await response.text();
    const overrides = parseSimpleYaml(text);
    config = deepMerge(config, overrides || {});
    if (logger && typeof logger.info === "function") {
      logger.info("[EngineConfig] Loaded config overrides from engine.cfg");
    }
  } catch (error) {
    if (logger && typeof logger.warn === "function") {
      logger.warn("[EngineConfig] Failed to load engine.cfg", { error });
    }
  }

  return config;
}
