// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const TAU = Math.PI * 2;

const V3_MANIFEST_URL = './assets/abyssal-divers-v3/frames/manifest.json';
const V3_STYLE_ID = 'abyssal-diver-v3-sequence-styles';
const V3_ACTION_NAMES = Object.freeze({
  swim: 'swim',
  light: 'light',
  search: 'inspect',
  point: 'signal',
});

const ACTION_ROWS = Object.freeze({ swim: 0, light: 1, search: 2, point: 3 });
const ACTION_SEQUENCES = Object.freeze({
  swim: Object.freeze([0, 1, 2, 3]),
  // Frame zero is the reach toward the torch. Keep illumination on the three
  // frames where the generated lamp is visibly in hand.
  light: Object.freeze([1, 2, 3, 2]),
  search: Object.freeze([0, 1, 2, 3, 2, 1]),
  point: Object.freeze([0, 1, 2, 3, 2, 1]),
});
const ACTION_FPS = Object.freeze({ swim: 5.2, light: 4.1, search: 3.2, point: 2.8 });
const V2_ATLAS = Object.freeze({
  width: 2048,
  height: 1024,
  columns: 4,
  rows: 4,
  cellWidth: 512,
  cellHeight: 256,
});
const V2_PAGE_NAMES = Object.freeze(['body', 'limbs', 'actions']);
const V2_PROP_ROWS = Object.freeze({ light: 0, search: 1, point: 2 });
const V2_PROP_GEOMETRY = Object.freeze({
  light: Object.freeze({ width: 38, height: 19, grip: Object.freeze([210 / 512, 0.5]) }),
  search: Object.freeze({ width: 70, height: 35, grip: Object.freeze([0.5, 0.5]) }),
});
const V2_DEFAULT_LAYOUT = Object.freeze({
  legs: Object.freeze([10, 73, 82, 41]),
  farArm: Object.freeze([58, 56, 66, 33]),
  nearArm: Object.freeze([60, 56, 68, 34]),
});
const V2_RIG_STYLE_ID = 'abyssal-diver-v2-rig-styles';
const V2_FIXED_REGISTRATION = Object.freeze({
  legs: Object.freeze([[0, 0], [4.5, 0], [4.5, 0], [0, 0]]),
  nearArm: Object.freeze([[0, 0], [0.8, 0], [1.8, 0], [3.2, 0]]),
  farArm: Object.freeze([[0, 0], [0, 0], [0, 0], [-1.8, 0]]),
  recoveryArm: Object.freeze([[0, 0], [0.8, 0], [-1.2, 0], [0, 0]]),
});
const MISSION_STATES = Object.freeze([
  Object.freeze({ name: 'swim', duration: 14 }),
  Object.freeze({ name: 'light', duration: 9 }),
  Object.freeze({ name: 'search', duration: 11 }),
  Object.freeze({ name: 'point', duration: 6 }),
  Object.freeze({ name: 'search', duration: 8 }),
]);

const DEFAULT_MEMBERS = Object.freeze([
  Object.freeze({
    id: 'leader',
    role: 'team-lead',
    atlas: './assets/abyssal-divers/diver-leader-atlas-v1.png',
    size: 248,
    depth: 0.86,
    formationX: 0,
    formationY: 8,
    animationRate: 0.94,
    response: 1.8,
    phase: 0.3,
    v2Layout: Object.freeze({
      legs: Object.freeze([9, 72, 82, 41]),
      farArm: Object.freeze([57, 56, 66, 33]),
      nearArm: Object.freeze([61, 56, 68, 34]),
    }),
    v2NearArmRemap: Object.freeze({ 'light:3': 2 }),
    v2PropOwnedActions: Object.freeze(['search']),
    torchSockets: Object.freeze([null, [97.8, 63.2], [96.2, 63.1], [95.0, 64.0]]),
    torchColor: '191, 242, 255',
    v2Sockets: Object.freeze({
      lightGrip: Object.freeze([[79.9, 56.0], [82.8, 56.0], [84.8, 56.0], [84.8, 56.0]]),
      lightLens: Object.freeze([[95.0, 56.0], [97.6, 56.0], [99.0, 56.0], [97.8, 56.0]]),
      searchGrip: Object.freeze([[73.2, 55.0], [74.0, 54.2], [74.6, 55.1], [73.8, 55.8]]),
      pointGrip: Object.freeze([[75.0, 52.8], [77.4, 51.8], [79.2, 51.3], [77.2, 52.0]]),
    }),
  }),
  Object.freeze({
    id: 'geologist',
    role: 'marine-geologist',
    atlas: './assets/abyssal-divers/diver-geologist-atlas-v1.png',
    size: 226,
    depth: 0.78,
    formationX: -190,
    formationY: -30,
    animationRate: 1.06,
    response: 1.55,
    phase: 2.2,
    searchPropRow: 3,
    v2Layout: Object.freeze({
      legs: Object.freeze([10, 74, 82, 41]),
      farArm: Object.freeze([59, 55.5, 66, 33]),
      nearArm: Object.freeze([60, 56, 68, 34]),
    }),
    v2PropFrameRemap: Object.freeze({
      'search:0': 0,
      'search:1': 0,
      'search:2': 0,
      'search:3': 0,
    }),
    v2PropGeometry: Object.freeze({
      search: Object.freeze({ width: 70, height: 35, grip: Object.freeze([0.75, 0.70]) }),
    }),
    torchSockets: Object.freeze([null, [91.0, 64.5], [88.0, 64.5], [90.5, 62.8]]),
    torchColor: '202, 245, 255',
    v2Sockets: Object.freeze({
      lightGrip: Object.freeze([[77.1, 56.0], [83.4, 56.0], [79.5, 56.0], [77.1, 56.0]]),
      lightLens: Object.freeze([[90.2, 56.0], [96.5, 56.0], [92.4, 56.0], [90.2, 56.0]]),
      searchGrip: Object.freeze([[71.8, 57.4], [72.8, 56.7], [73.6, 57.5], [72.6, 58.2]]),
      pointGrip: Object.freeze([[73.6, 55.0], [76.0, 54.0], [78.2, 53.5], [75.8, 54.2]]),
    }),
  }),
  Object.freeze({
    id: 'surveyor',
    role: 'survey-photographer',
    atlas: './assets/abyssal-divers/diver-surveyor-atlas-v1.png',
    size: 237,
    depth: 0.7,
    formationX: -355,
    formationY: 36,
    animationRate: 0.88,
    response: 1.42,
    phase: 4.35,
    v2Layout: Object.freeze({
      legs: Object.freeze([9, 73, 82, 41]),
      farArm: Object.freeze([58, 54, 66, 33]),
      nearArm: Object.freeze([58, 55, 68, 34]),
    }),
    v2BodyRowRemap: Object.freeze({ search: ACTION_ROWS.swim }),
    v2NearArmRemap: Object.freeze({ 'light:2': 1, 'swim:2': 1, 'search:2': 1, 'point:2': 1 }),
    v2PropGeometry: Object.freeze({
      search: Object.freeze({ width: 70, height: 35, grip: Object.freeze([0.22, 0.63]) }),
    }),
    v2RecoveryArmRemap: Object.freeze({ 1: 0 }),
    torchSockets: Object.freeze([null, [98.0, 60.2], [94.5, 60.0], [88.5, 59.5]]),
    torchColor: '180, 235, 255',
    v2Sockets: Object.freeze({
      lightGrip: Object.freeze([[69.0, 55.0], [81.9, 55.0], [81.9, 55.0], [81.8, 55.0]]),
      lightLens: Object.freeze([[83.4, 55.0], [95.9, 55.0], [96.2, 55.0], [96.5, 55.0]]),
      searchGrip: Object.freeze([[72.4, 54.4], [73.4, 53.8], [74.2, 54.6], [73.2, 55.2]]),
      pointGrip: Object.freeze([[74.4, 52.2], [76.8, 51.2], [79.0, 50.8], [76.6, 51.4]]),
    }),
    // The generated surveyor atlas has a detached 93-pixel cyan fragment in
    // flashlight cel 2. Reuse the adjacent registered cel instead of ever
    // presenting the contaminated drawing.
    frameRemap: Object.freeze({ 'light:2': 1 }),
  }),
]);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(value) {
  const normalized = clamp(value, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function v2PagesFor(memberId) {
  const base = `./assets/abyssal-divers-v2/${memberId}`;
  return Object.freeze({
    body: `${base}-body-v2.png`,
    limbs: `${base}-limbs-v2.png`,
    actions: `${base}-actions-v2.png`,
  });
}

function validV2Atlas(result) {
  return result.loaded
    && result.width === V2_ATLAS.width
    && result.height === V2_ATLAS.height
    && result.width % V2_ATLAS.columns === 0
    && result.height % V2_ATLAS.rows === 0
    && result.width / V2_ATLAS.columns === V2_ATLAS.cellWidth
    && result.height / V2_ATLAS.rows === V2_ATLAS.cellHeight;
}

function atlasMetadataUrl(atlasUrl) {
  return atlasUrl.replace(/\.png$/i, '.atlas.json');
}

async function preloadAtlasMetadata(url) {
  try {
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) return { url, loaded: false, status: response.status, descriptor: null };
    return { url, loaded: true, status: response.status, descriptor: await response.json() };
  } catch (error) {
    return { url, loaded: false, status: 0, descriptor: null, error: String(error) };
  }
}

function validV2Metadata(result) {
  const descriptor = result.descriptor;
  if (!result.loaded
      || descriptor?.width !== V2_ATLAS.width
      || descriptor?.height !== V2_ATLAS.height
      || descriptor?.columns !== V2_ATLAS.columns
      || descriptor?.rows !== V2_ATLAS.rows
      || descriptor?.cell_width !== V2_ATLAS.cellWidth
      || descriptor?.cell_height !== V2_ATLAS.cellHeight
      || !Array.isArray(descriptor?.cells)
      || descriptor.cells.length !== V2_ATLAS.columns * V2_ATLAS.rows) return false;
  const occupied = new Set();
  for (const cell of descriptor.cells) {
    const key = `${cell.row}:${cell.column}`;
    const bbox = cell.runtime_bbox;
    if (!Number.isInteger(cell.row)
        || !Number.isInteger(cell.column)
        || cell.row < 0 || cell.row >= V2_ATLAS.rows
        || cell.column < 0 || cell.column >= V2_ATLAS.columns
        || occupied.has(key)
        || !Array.isArray(bbox) || bbox.length !== 4
        || bbox.some((value) => !Number.isFinite(value))
        || bbox[0] < 0 || bbox[1] < 0
        || bbox[2] > V2_ATLAS.cellWidth || bbox[3] > V2_ATLAS.cellHeight
        || bbox[2] <= bbox[0] || bbox[3] <= bbox[1]
        || cell.clipped === true) return false;
    occupied.add(key);
  }
  return true;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length * 0.5);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function registrationOffsets(descriptor, row, edge, fallback) {
  if (!descriptor) return fallback;
  const cells = descriptor.cells
    .filter((cell) => cell.row === row)
    .sort((left, right) => left.column - right.column);
  if (cells.length !== V2_ATLAS.columns) return fallback;
  const anchors = cells.map((cell) => {
    const [left, top, right, bottom] = cell.runtime_bbox;
    return [edge === 'right' ? right : left, (top + bottom) * 0.5];
  });
  const targetX = median(anchors.map((anchor) => anchor[0]));
  const targetY = median(anchors.map((anchor) => anchor[1]));
  return anchors.map(([x, y]) => [
    ((targetX - x) / V2_ATLAS.cellWidth) * 100,
    ((targetY - y) / V2_ATLAS.cellHeight) * 100,
  ]);
}

function ensureV2RigStyles() {
  if (document.getElementById(V2_RIG_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = V2_RIG_STYLE_ID;
  style.textContent = `
    .abyss-diver[data-renderer="v2-cutout"] .abyss-diver-sprite { display: none; }
    .abyss-diver-rig {
      position: absolute;
      inset: 0;
      z-index: 2;
      display: block;
      isolation: isolate;
      backface-visibility: hidden;
      filter:
        blur(var(--diver-blur))
        brightness(var(--diver-brightness))
        saturate(var(--diver-saturation))
        sepia(var(--diver-warmth))
        drop-shadow(0 6px 10px rgba(0, 3, 12, .58))
        drop-shadow(0 0 9px rgba(73, 201, 255, .08));
    }
    .abyss-diver-rig-part {
      position: absolute;
      left: var(--part-x, 50%);
      top: var(--part-y, 50%);
      width: var(--part-width, 100%);
      height: var(--part-height, 50%);
      display: block;
      opacity: 1;
      transform: translate(-50%, -50%) translate(var(--part-registration-x, 0%), var(--part-registration-y, 0%));
      background-repeat: no-repeat;
      background-size: var(--atlas-size-x, 400%) var(--atlas-size-y, 400%);
      backface-visibility: hidden;
      image-rendering: auto;
      pointer-events: none;
      will-change: background-position;
    }
    .abyss-diver-rig-part[data-part="legs"] { z-index: 1; --part-x: 10%; --part-y: 61%; --part-width: 82%; --part-height: 41%; }
    .abyss-diver-rig-part[data-part="far-arm"] { z-index: 2; --part-x: 74%; --part-y: 49%; --part-width: 66%; --part-height: 33%; }
    .abyss-diver-rig-part[data-part="body"] { z-index: 3; --part-width: 100%; --part-height: 50%; }
    .abyss-diver-rig-part[data-part="near-arm"] { z-index: 4; --part-x: 77%; --part-y: 51%; --part-width: 68%; --part-height: 34%; }
    .abyss-diver-rig-part[data-part="prop"] { z-index: 5; --part-width: 46%; --part-height: 23%; }
  `;
  document.head.appendChild(style);
}

function createV2RigPart(name, atlasUrl) {
  const part = document.createElement('span');
  part.className = 'abyss-diver-rig-part';
  part.dataset.part = name;
  part.style.backgroundImage = `url("${atlasUrl}")`;
  part.style.setProperty('--atlas-size-x', `${V2_ATLAS.columns * 100}%`);
  part.style.setProperty('--atlas-size-y', `${V2_ATLAS.rows * 100}%`);
  return part;
}

function applyV2PartLayout(part, layout) {
  const [x, y, width, height] = layout;
  part.style.setProperty('--part-x', `${x}%`);
  part.style.setProperty('--part-y', `${y}%`);
  part.style.setProperty('--part-width', `${width}%`);
  part.style.setProperty('--part-height', `${height}%`);
}

function preloadAtlas(url, requireDecode = false) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = async () => {
      let decoded = true;
      if (typeof image.decode === 'function') {
        try { await image.decode(); } catch (_) { decoded = false; }
      }
      resolve({
        url,
        loaded: requireDecode ? decoded : true,
        decoded,
        width: image.naturalWidth,
        height: image.naturalHeight,
        image,
      });
    };
    image.onerror = () => resolve({
      url,
      loaded: false,
      decoded: false,
      width: 0,
      height: 0,
      image: null,
    });
    image.src = url;
  });
}

function ensureV3SequenceStyles() {
  if (document.getElementById(V3_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = V3_STYLE_ID;
  style.textContent = `
    .abyss-diver-canvas {
      position: absolute;
      left: 0;
      top: 25%;
      z-index: 2;
      display: none;
      width: 100%;
      height: 50%;
      pointer-events: none;
      backface-visibility: hidden;
      image-rendering: auto;
      filter:
        blur(var(--diver-blur))
        brightness(var(--diver-brightness))
        saturate(var(--diver-saturation))
        sepia(var(--diver-warmth))
        drop-shadow(0 6px 10px rgba(0, 3, 12, .58))
        drop-shadow(0 0 9px rgba(73, 201, 255, .08));
    }
    .abyss-diver[data-renderer="v3-sequence"] .abyss-diver-canvas {
      display: block;
    }
    .abyss-diver[data-renderer="v3-sequence"] .abyss-diver-sprite { display: none; }
    .abyss-diver[data-renderer="v3-sequence"] .abyss-diver-rig { display: none; }
  `;
  document.head.appendChild(style);
}

function resolveV3Manifest(manifest, manifestUrl, members) {
  if (manifest?.version !== 3
      || manifest?.renderer !== 'full-body-png-sequence'
      || !/^[a-f0-9]{16}$/.test(manifest?.asset_version ?? '')
      || manifest?.canvas?.width !== 512
      || manifest?.canvas?.height !== 256
      || typeof manifest?.roles !== 'object') {
    throw new Error('V3 diver manifest header is invalid');
  }
  const manifestBase = new URL(manifestUrl, document.baseURI);
  const roles = {};
  for (const member of members) {
    const role = manifest.roles[member.id];
    if (!role || typeof role.actions !== 'object') {
      throw new Error(`V3 diver role is missing: ${member.id}`);
    }
    const actions = {};
    for (const actionName of Object.values(V3_ACTION_NAMES)) {
      const action = role.actions[actionName];
      if (!action
          || !Number.isFinite(action.fps)
          || action.fps <= 0
          || !Array.isArray(action.frames)
          || action.frames.length < 4) {
        throw new Error(`V3 diver action is invalid: ${member.id}/${actionName}`);
      }
      actions[actionName] = {
        fps: action.fps,
        frames: action.frames.map((entry, frameIndex) => {
          if (typeof entry?.file !== 'string' || !entry.file.endsWith('.png')) {
            throw new Error(`V3 frame path is invalid: ${member.id}/${actionName}/${frameIndex}`);
          }
          if (actionName === 'light'
              && (!Array.isArray(entry.light_socket)
                || entry.light_socket.length !== 2
                || entry.light_socket.some((value) => !Number.isFinite(value)))) {
            throw new Error(`V3 flashlight socket is invalid: ${member.id}/${frameIndex}`);
          }
          const frameUrl = new URL(entry.file, manifestBase);
          frameUrl.searchParams.set('v', manifest.asset_version);
          return {
            url: frameUrl.href,
            lightSocket: entry.light_socket ?? null,
          };
        }),
      };
    }
    roles[member.id] = { actions };
  }
  return { roles, width: manifest.canvas.width, height: manifest.canvas.height };
}

async function preloadV3FrameSet(members) {
  try {
    const response = await fetch(V3_MANIFEST_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
    const frameSet = resolveV3Manifest(await response.json(), V3_MANIFEST_URL, members);
    const urls = members.flatMap((member) => Object.values(frameSet.roles[member.id].actions)
      .flatMap((action) => action.frames.map((frame) => frame.url)));
    const results = await Promise.all(urls.map((url) => preloadAtlas(url, true)));
    const invalid = results.filter((entry) => !entry.loaded
      || entry.width !== frameSet.width
      || entry.height !== frameSet.height);
    if (invalid.length > 0) {
      return { loaded: false, frameSet: null, invalid, total: results.length };
    }
    const decodedImages = new Map(results.map((entry) => [entry.url, entry.image]));
    for (const role of Object.values(frameSet.roles)) {
      for (const action of Object.values(role.actions)) {
        for (const frame of action.frames) frame.image = decodedImages.get(frame.url) ?? null;
      }
    }
    return { loaded: true, frameSet, invalid: [], total: results.length };
  } catch (error) {
    return { loaded: false, frameSet: null, invalid: [], total: 0, error: String(error) };
  }
}

function createBubbleEmitter() {
  const emitter = document.createElement('span');
  emitter.className = 'abyss-diver-exhale';
  for (let index = 0; index < 3; index += 1) {
    const bubble = document.createElement('i');
    bubble.style.setProperty('--bubble-size', `${3 + index * 1.3}px`);
    bubble.style.setProperty('--bubble-delay', `${index * -0.83}s`);
    bubble.style.setProperty('--bubble-x', `${8 + index * 5}px`);
    bubble.style.setProperty('--bubble-y', `${-42 - index * 12}px`);
    emitter.appendChild(bubble);
  }
  return emitter;
}

/**
 * Authored three-person dive team for the abyssal landing scene.
 *
 * The team uses a deterministic mission-state controller instead of random
 * action switching: swim, illuminate, inspect, signal, then inspect again.
 * Individual response, phase, depth, and kick timing keep the formation alive
 * without compromising buddy proximity or opaque paint ordering.
 */
export class AbyssalDiveTeam {
  constructor(layers, options = {}) {
    this.layers = layers;
    this.members = options.members ?? DEFAULT_MEMBERS;
    this.targetFps = clamp(options.targetFps ?? 30, 12, 60);
    this.cruiseSpeed = clamp(options.cruiseSpeed ?? 22, 8, 52);
    this.width = Math.max(1, innerWidth);
    this.height = Math.max(1, innerHeight);
    this.center = { x: this.width * 0.4, y: this.height * 0.22 };
    this.scrollProgress = 0;
    this.scrollOffsetY = 0;
    this.direction = 1;
    this.stateIndex = 0;
    this.stateClock = 7;
    this.divers = [];
    this.frameHandle = 0;
    this.lastTimestamp = 0;
    this.lastSimulationTimestamp = 0;
    this.destroyed = false;
    this.sceneActive = true;
    this.motionPaused = false;
    this.paused = document.hidden;
    this._onResize = this._onResize.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
    this._tick = this._tick.bind(this);
  }

  init() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.documentElement.dataset.abyssalDiveTeam = 'reduced';
      return this;
    }

    for (let index = 0; index < this.members.length; index += 1) {
      this._createDiver(this.members[index], index);
    }
    this._setMissionState(MISSION_STATES[this.stateIndex].name, true);

    addEventListener('resize', this._onResize, { passive: true });
    document.addEventListener('visibilitychange', this._onVisibility);

    const v3Load = preloadV3FrameSet(this.members);
    const v1Load = Promise.all(this.members.map((member) => preloadAtlas(member.atlas)));
    const v2Load = Promise.all(this.members.flatMap((member) => {
      const pages = v2PagesFor(member.id);
      return V2_PAGE_NAMES.map((page) => preloadAtlas(pages[page], true).then((result) => ({
        ...result,
        memberId: member.id,
        page,
      })));
    }));
    const v2MetadataLoad = Promise.all(this.members.flatMap((member) => {
      const pages = v2PagesFor(member.id);
      return V2_PAGE_NAMES.map((page) => preloadAtlasMetadata(atlasMetadataUrl(pages[page])).then((result) => ({
        ...result,
        memberId: member.id,
        page,
      })));
    }));
    Promise.all([v3Load, v1Load, v2Load, v2MetadataLoad]).then(([v3Result, v1Results, v2Results, v2MetadataResults]) => {
      if (this.destroyed) return;
      const invalidV2 = v2Results.filter((entry) => !validV2Atlas(entry));
      const invalidV2Metadata = v2MetadataResults.filter((entry) => !validV2Metadata(entry));
      let v3Active = false;
      let v2Active = false;
      if (v3Result.loaded) {
        try {
          ensureV3SequenceStyles();
          for (const diver of this.divers) {
            this._activateV3Diver(diver, v3Result.frameSet.roles[diver.profile.id]);
          }
          v3Active = true;
        } catch (error) {
          for (const diver of this.divers) this._restoreV1Diver(diver);
          console.warn('[AbyssalDiveTeam] Diver V3 activation failed; falling back atomically.', error);
        }
      }
      if (!v3Active
          && v2Results.length === this.members.length * V2_PAGE_NAMES.length
          && v2MetadataResults.length === v2Results.length
          && invalidV2.length === 0
          && invalidV2Metadata.length === 0) {
        try {
          ensureV2RigStyles();
          for (const diver of this.divers) {
            const metadata = Object.fromEntries(v2MetadataResults
              .filter((entry) => entry.memberId === diver.profile.id)
              .map((entry) => [entry.page, entry.descriptor]));
            this._activateV2Diver(diver, metadata);
          }
          v2Active = true;
        } catch (error) {
          for (const diver of this.divers) this._restoreV1Diver(diver);
          console.warn('[AbyssalDiveTeam] Diver V2 rig activation failed; V1 restored before reveal.', error);
        }
      }
      if (v3Active) {
        document.documentElement.dataset.abyssalDiverRenderer = 'v3-sequence';
        console.info(`[AbyssalDiveTeam] ${v3Result.total} decoded full-body V3 frames ready; single-cel renderer active.`);
      } else if (v2Active) {
        document.documentElement.dataset.abyssalDiverRenderer = 'v2-cutout';
        console.info(`[AbyssalDiveTeam] ${v2Results.length} integer-grid V2 pages and descriptors ready; shared modular cutout rig active.`);
      } else {
        const invalidV1 = v1Results.filter((entry) => !entry.loaded || entry.width !== entry.height);
        document.documentElement.dataset.abyssalDiverRenderer = 'v1-fallback';
        if (invalidV1.length > 0) console.warn('[AbyssalDiveTeam] V1 fallback atlas validation failed.', invalidV1);
        console.warn('[AbyssalDiveTeam] Diver V3/V2 unavailable; preserving complete V1 atlas renderer.', {
          v3: v3Result,
          invalidPages: invalidV2,
          invalidMetadata: invalidV2Metadata,
        });
      }
      for (const diver of this.divers) diver.node.style.visibility = '';
      if (!this.frameHandle) this.frameHandle = requestAnimationFrame(this._tick);
    });

    document.documentElement.dataset.abyssalDiveTeam = 'active';
    document.documentElement.dataset.abyssalDiverCount = String(this.divers.length);
    document.documentElement.dataset.abyssalDiverRoles = this.members.map((member) => member.role).join(',');
    console.info(`[AbyssalDiveTeam] ${this.divers.length} divers deployed in buddy formation.`);
    return this;
  }

  _createDiver(profile, index) {
    const node = document.createElement('i');
    node.className = `abyss-diver abyss-diver-${profile.id}`;
    node.dataset.diver = profile.id;
    node.dataset.role = profile.role;
    node.setAttribute('aria-hidden', 'true');

    const beam = document.createElement('span');
    beam.className = 'abyss-diver-beam';
    const lamp = document.createElement('span');
    lamp.className = 'abyss-diver-lamp';
    const sprite = document.createElement('span');
    sprite.className = 'abyss-diver-sprite';
    sprite.style.backgroundImage = `url("${profile.atlas}")`;
    const canvas = document.createElement('canvas');
    canvas.className = 'abyss-diver-canvas';
    canvas.width = 512;
    canvas.height = 256;
    canvas.hidden = true;
    node.append(beam, sprite, canvas, lamp, createBubbleEmitter());

    const layerName = this._layerForDepth(profile.depth);
    this.layers[layerName].appendChild(node);
    const diver = {
      node,
      sprite,
      canvas,
      canvasContext: null,
      beam,
      lamp,
      profile,
      index,
      x: this.center.x + profile.formationX,
      y: this.center.y + profile.formationY,
      previousX: this.center.x + profile.formationX,
      previousY: this.center.y + profile.formationY,
      velocityX: 0,
      velocityY: 0,
      screenSize: profile.size,
      depth: profile.depth,
      layerName,
      action: 'swim',
      animationClock: profile.phase,
      kickClock: profile.phase * 0.73,
      renderer: 'v1-atlas',
      v3Role: null,
      rig: null,
      parts: null,
      v2Metadata: null,
      registrations: null,
      partFrames: Object.create(null),
      actionLocalFrame: 0,
      v2PoseKey: '',
      frame: -1,
    };
    node.style.opacity = '1';
    node.style.visibility = 'hidden';
    node.dataset.renderer = diver.renderer;
    this.divers.push(diver);
    this._setFrame(diver, 0);
  }

  _activateV2Diver(diver, metadata) {
    const pages = v2PagesFor(diver.profile.id);
    const rig = document.createElement('span');
    rig.className = 'abyss-diver-rig';
    rig.setAttribute('aria-hidden', 'true');
    const parts = {
      legs: createV2RigPart('legs', pages.limbs),
      farArm: createV2RigPart('far-arm', pages.limbs),
      body: createV2RigPart('body', pages.body),
      nearArm: createV2RigPart('near-arm', pages.limbs),
      prop: createV2RigPart('prop', pages.actions),
    };
    const layout = diver.profile.v2Layout ?? V2_DEFAULT_LAYOUT;
    applyV2PartLayout(parts.legs, layout.legs ?? V2_DEFAULT_LAYOUT.legs);
    applyV2PartLayout(parts.farArm, layout.farArm ?? V2_DEFAULT_LAYOUT.farArm);
    applyV2PartLayout(parts.nearArm, layout.nearArm ?? V2_DEFAULT_LAYOUT.nearArm);
    // The generated torso cels already paint the rear arm. Retain the part in
    // the atomic rig for metadata compatibility, but never composite a second
    // rear arm over the same shoulder.
    parts.farArm.style.display = 'none';
    parts.prop.style.display = 'none';
    rig.append(parts.legs, parts.farArm, parts.body, parts.nearArm, parts.prop);
    diver.node.insertBefore(rig, diver.sprite);
    diver.rig = rig;
    diver.parts = parts;
    diver.v2Metadata = metadata;
    diver.registrations = {
      legs: registrationOffsets(metadata.limbs, 0, 'right', V2_FIXED_REGISTRATION.legs),
      nearArm: registrationOffsets(metadata.limbs, 1, 'left', V2_FIXED_REGISTRATION.nearArm),
      farArm: registrationOffsets(metadata.limbs, 2, 'left', V2_FIXED_REGISTRATION.farArm),
      recoveryArm: registrationOffsets(metadata.limbs, 3, 'left', V2_FIXED_REGISTRATION.recoveryArm),
    };
    diver.renderer = 'v2-cutout';
    diver.v3Role = null;
    diver.canvasContext = null;
    diver.canvas.hidden = true;
    diver.node.dataset.renderer = diver.renderer;
    diver.frame = -1;
    diver.actionLocalFrame = 0;
    diver.v2PoseKey = '';
    diver.partFrames = Object.create(null);
    this._setFrame(diver, Math.floor(diver.animationClock));
    this._updateV2Rig(diver, 0, performance.now() * 0.001);
  }

  _restoreV1Diver(diver) {
    diver.rig?.remove();
    diver.rig = null;
    diver.parts = null;
    diver.v2Metadata = null;
    diver.registrations = null;
    diver.renderer = 'v1-atlas';
    diver.v3Role = null;
    diver.canvasContext = null;
    diver.canvas.hidden = true;
    diver.node.dataset.renderer = diver.renderer;
    diver.node.dataset.prop = 'none';
    delete diver.node.dataset.flashlightLens;
    diver.frame = -1;
    diver.actionLocalFrame = 0;
    diver.v2PoseKey = '';
    diver.partFrames = Object.create(null);
    this._setFrame(diver, Math.floor(diver.animationClock));
  }

  _activateV3Diver(diver, role) {
    if (!role?.actions) throw new Error(`Missing decoded V3 role: ${diver.profile.id}`);
    const canvasContext = diver.canvas.getContext('2d', { alpha: true });
    if (!canvasContext) throw new Error(`V3 diver canvas unavailable: ${diver.profile.id}`);
    for (const action of Object.values(role.actions)) {
      if (action.frames.some((frame) => !frame.image?.complete || frame.image.naturalWidth !== 512 || frame.image.naturalHeight !== 256)) {
        throw new Error(`V3 diver contains an undecoded frame: ${diver.profile.id}`);
      }
    }
    diver.rig?.remove();
    diver.rig = null;
    diver.parts = null;
    diver.v2Metadata = null;
    diver.registrations = null;
    diver.v3Role = role;
    diver.canvasContext = canvasContext;
    diver.canvasContext.imageSmoothingEnabled = true;
    diver.canvasContext.imageSmoothingQuality = 'high';
    diver.canvas.hidden = false;
    diver.renderer = 'v3-sequence';
    diver.node.dataset.renderer = diver.renderer;
    diver.node.dataset.rigOwner = 'full-body-cel';
    diver.node.dataset.prop = diver.action === 'swim' ? 'none' : 'baked';
    diver.frame = -1;
    diver.animationClock = diver.profile.phase % this._frameCountForAction(diver, diver.action);
    this._setFrame(diver, Math.floor(diver.animationClock));
  }

  _onResize() {
    const widthScale = innerWidth / Math.max(1, this.width);
    const heightScale = innerHeight / Math.max(1, this.height);
    this.width = Math.max(1, innerWidth);
    this.height = Math.max(1, innerHeight);
    this.center.x *= widthScale;
    this.center.y *= heightScale;
    for (const diver of this.divers) {
      diver.x *= widthScale;
      diver.y *= heightScale;
      diver.previousX = diver.x;
      diver.previousY = diver.y;
    }
    this._updateScrollOffset();
  }

  _onVisibility() {
    this.paused = document.hidden || this.motionPaused;
    this.lastTimestamp = 0;
    this.lastSimulationTimestamp = 0;
  }

  setActive(active) {
    const nextActive = Boolean(active);
    if (this.sceneActive === nextActive) return;
    this.sceneActive = nextActive;
    for (const diver of this.divers) diver.node.style.display = this.sceneActive ? '' : 'none';
    this.lastTimestamp = 0;
    this.lastSimulationTimestamp = 0;
  }

  _updateScrollOffset() {
    const descent = smoothstep((this.scrollProgress - 0.03) / 0.75);
    this.scrollOffsetY = this.height * 0.42 * descent;
    for (const diver of this.divers) {
      diver.node.style.setProperty('--diver-scroll-y', `${this.scrollOffsetY.toFixed(2)}px`);
    }
    document.documentElement.dataset.abyssalDiverDescent = descent.toFixed(3);
  }

  /** Keeps the survey formation descending with the reader, even while paused. */
  setScrollProgress(progress) {
    this.scrollProgress = clamp(Number(progress) || 0, 0, 1);
    this._updateScrollOffset();
  }

  setPaused(paused) {
    this.motionPaused = Boolean(paused);
    this._onVisibility();
  }

  /**
   * Viewport-space regulator exhaust anchors consumed by the shared water pass.
   * The full-body cels are painted in a 2:1 band inside a square stage, so the
   * forward quarter of that stage tracks the face/regulator across every role.
   */
  getExhaustSources() {
    if (!this.sceneActive || this.destroyed) return [];
    return this.divers
      .filter((diver) => diver.node.style.visibility !== 'hidden' && diver.node.style.display !== 'none')
      .map((diver) => ({
        id: diver.profile.id,
        x: diver.x + this.direction * diver.screenSize * 0.245,
        y: diver.y + this.scrollOffsetY - diver.screenSize * 0.035,
        vx: diver.velocityX,
        vy: diver.velocityY,
        size: diver.screenSize,
        depth: diver.depth,
        direction: this.direction,
        phase: diver.profile.phase,
      }));
  }

  /** Viewport-space bodies used for local bubble entrainment and fin wakes. */
  getWakeSources() {
    if (!this.sceneActive || this.destroyed) return [];
    return this.divers
      .filter((diver) => diver.node.style.visibility !== 'hidden' && diver.node.style.display !== 'none')
      .map((diver) => ({
        id: `diver:${diver.profile.id}`,
        kind: 'diver',
        x: diver.x - this.direction * diver.screenSize * 0.08,
        y: diver.y + this.scrollOffsetY,
        vx: diver.velocityX,
        vy: diver.velocityY,
        radius: diver.screenSize * 0.42,
        strength: 1,
        depth: diver.depth,
        direction: this.direction,
      }));
  }

  _layerForDepth(depth) {
    return depth < 0.5 ? 'far' : depth < 0.8 ? 'mid' : 'near';
  }

  _actionsForMission(name) {
    if (name === 'light') return ['light', 'search', 'light'];
    if (name === 'search') return ['light', 'search', 'search'];
    if (name === 'point') return ['point', 'search', 'light'];
    return ['swim', 'swim', 'swim'];
  }

  _v3Action(action) {
    return V3_ACTION_NAMES[action] ?? V3_ACTION_NAMES.swim;
  }

  _frameCountForAction(diver, action) {
    if (diver.renderer === 'v3-sequence') {
      return diver.v3Role?.actions?.[this._v3Action(action)]?.frames?.length ?? 1;
    }
    return ACTION_SEQUENCES[action]?.length ?? 1;
  }

  _setMissionState(name, initial = false) {
    const actions = this._actionsForMission(name);
    for (let index = 0; index < this.divers.length; index += 1) {
      const diver = this.divers[index];
      const nextAction = actions[index] ?? 'swim';
      if (nextAction === diver.action && !initial) continue;
      diver.action = nextAction;
      diver.animationClock = diver.profile.phase % this._frameCountForAction(diver, nextAction);
      diver.node.dataset.action = nextAction;
      // Publish the action's first painted cel and authored socket before the
      // beam becomes visible, avoiding a one-frame emitter at the old pose.
      this._setFrame(diver, Math.floor(diver.animationClock));
      diver.node.style.setProperty('--beam-active', nextAction === 'light' ? '1' : '0');
    }
    document.documentElement.dataset.abyssalDiveMission = name;
    if (!initial) console.debug(`[AbyssalDiveTeam] Mission state -> ${name}.`);
  }

  _advanceMission(deltaSeconds) {
    const current = MISSION_STATES[this.stateIndex];
    this.stateClock += deltaSeconds;
    if (this.stateClock < current.duration) return;
    this.stateClock %= current.duration;
    this.stateIndex = (this.stateIndex + 1) % MISSION_STATES.length;
    this._setMissionState(MISSION_STATES[this.stateIndex].name);
  }

  _setV2AtlasCell(diver, partName, row, column) {
    const safeRow = ((Math.trunc(row) % V2_ATLAS.rows) + V2_ATLAS.rows) % V2_ATLAS.rows;
    const safeColumn = ((Math.trunc(column) % V2_ATLAS.columns) + V2_ATLAS.columns) % V2_ATLAS.columns;
    const frame = safeRow * V2_ATLAS.columns + safeColumn;
    if (diver.partFrames[partName] === frame) return;
    diver.partFrames[partName] = frame;
    const part = diver.parts[partName];
    const x = V2_ATLAS.columns > 1 ? safeColumn * (100 / (V2_ATLAS.columns - 1)) : 0;
    const y = V2_ATLAS.rows > 1 ? safeRow * (100 / (V2_ATLAS.rows - 1)) : 0;
    part.style.backgroundPosition = `${x}% ${y}%`;
    const registrationName = partName === 'nearArm' && safeRow === 3 ? 'recoveryArm' : partName;
    const [registrationX, registrationY] = diver.registrations?.[registrationName]?.[safeColumn] ?? [0, 0];
    part.style.setProperty('--part-registration-x', `${registrationX.toFixed(3)}%`);
    part.style.setProperty('--part-registration-y', `${registrationY.toFixed(3)}%`);
    part.dataset.frame = String(frame);
  }

  _setV2ActionFrame(diver, localFrame) {
    const action = diver.action;
    diver.actionLocalFrame = localFrame;
    const poseKey = `${action}:${localFrame}`;
    if (poseKey === diver.v2PoseKey) return;
    diver.v2PoseKey = poseKey;
    const actionFrame = ACTION_ROWS[action] * V2_ATLAS.columns + localFrame;
    const bodyRow = diver.profile.v2BodyRowRemap?.[action] ?? ACTION_ROWS[action];
    diver.frame = actionFrame;
    this._setV2AtlasCell(diver, 'body', bodyRow, localFrame);

    const propRow = action === 'search'
      ? (diver.profile.searchPropRow ?? V2_PROP_ROWS.search)
      : V2_PROP_ROWS[action];
    const bodyOwnsAction = diver.profile.v2BodyOwnedActions?.includes(action) ?? false;
    const suppressProp = action === 'point'
      || bodyOwnsAction
      || (diver.profile.v2SuppressProps?.includes(action) ?? false);
    const hasProp = propRow !== undefined && !suppressProp;
    const propOwnsArms = hasProp
      && (diver.profile.v2PropOwnedActions?.includes(action) ?? false);
    diver.parts.nearArm.style.display = bodyOwnsAction || propOwnsArms ? 'none' : 'block';
    diver.parts.farArm.style.display = 'none';
    diver.parts.prop.style.display = hasProp ? 'block' : 'none';
    diver.node.dataset.prop = hasProp ? action : 'none';
    diver.node.dataset.rigOwner = bodyOwnsAction
      ? 'body'
      : propOwnsArms
        ? 'prop'
        : hasProp
          ? 'front-arm+prop'
          : 'front-arm';
    if (hasProp) {
      const propFrame = diver.profile.v2PropFrameRemap?.[`${action}:${localFrame}`] ?? localFrame;
      this._setV2AtlasCell(diver, 'prop', propRow, propFrame);
      const socketName = `${action}Grip`;
      const grip = diver.profile.v2Sockets?.[socketName]?.[localFrame] ?? [76, 58];
      const geometry = diver.profile.v2PropGeometry?.[action]
        ?? V2_PROP_GEOMETRY[action]
        ?? V2_PROP_GEOMETRY.search;
      const centerX = grip[0] + (0.5 - geometry.grip[0]) * geometry.width;
      const centerY = grip[1] + (0.5 - geometry.grip[1]) * geometry.height;
      diver.parts.prop.style.setProperty('--part-x', `${centerX}%`);
      diver.parts.prop.style.setProperty('--part-y', `${centerY}%`);
      diver.parts.prop.style.setProperty('--part-width', `${geometry.width}%`);
      diver.parts.prop.style.setProperty('--part-height', `${geometry.height}%`);
      diver.node.style.setProperty('--hand-grip-x', `${grip[0]}%`);
      diver.node.style.setProperty('--hand-grip-y', `${grip[1]}%`);
    }

    if (action === 'light') {
      const lens = diver.profile.v2Sockets?.lightLens?.[localFrame] ?? [92, 58];
      diver.node.style.setProperty('--beam-origin-x', `${lens[0]}%`);
      diver.node.style.setProperty('--beam-origin-y', `${lens[1]}%`);
      diver.node.style.setProperty('--torch-rgb', diver.profile.torchColor);
      diver.node.dataset.flashlightLens = `${lens[0]},${lens[1]}`;
    } else {
      delete diver.node.dataset.flashlightLens;
    }
    diver.node.dataset.frame = String(actionFrame);
  }

  _updateV2Rig(diver, deltaSeconds, time) {
    if (diver.renderer !== 'v2-cutout' || !diver.parts) return;
    const actionRate = diver.action === 'swim' ? 1 : diver.action === 'light' ? 0.62 : 0.44;
    diver.kickClock = (diver.kickClock + deltaSeconds * (2.6 + diver.index * 0.17) * actionRate) % TAU;
    const phase = diver.kickClock;
    const legFrame = Math.floor((phase / TAU) * V2_ATLAS.columns) % V2_ATLAS.columns;
    const cyclicNearFrame = Math.floor((((phase + 0.72 + diver.profile.phase * 0.07) % TAU) / TAU) * V2_ATLAS.columns) % V2_ATLAS.columns;
    let nearArmFrame = diver.action === 'swim'
      ? cyclicNearFrame
      : (diver.actionLocalFrame ?? 0);
    nearArmFrame = diver.profile.v2NearArmRemap?.[`${diver.action}:${nearArmFrame}`]
      ?? nearArmFrame;
    const nearArmRow = diver.action === 'point' ? 3 : 1;
    if (nearArmRow === 3) {
      nearArmFrame = diver.profile.v2RecoveryArmRemap?.[nearArmFrame] ?? nearArmFrame;
    }
    this._setV2AtlasCell(diver, 'legs', 0, legFrame);
    this._setV2AtlasCell(diver, 'nearArm', nearArmRow, nearArmFrame);
  }

  _setFrame(diver, sequenceFrame) {
    if (diver.renderer === 'v3-sequence') {
      const actionName = this._v3Action(diver.action);
      const action = diver.v3Role.actions[actionName];
      const frameIndex = ((Math.trunc(sequenceFrame) % action.frames.length) + action.frames.length) % action.frames.length;
      const frame = action.frames[frameIndex];
      const frameKey = `${actionName}:${frameIndex}`;
      if (diver.frame === frameKey) return;
      if (!frame.image || !diver.canvasContext) return;
      // One persistent canvas remains composited for the diver's lifetime.
      // Browsers cannot paint between these statements inside the same frame,
      // so clear + draw replaces the cel atomically without URL-layer flashes.
      diver.canvasContext.clearRect(0, 0, diver.canvas.width, diver.canvas.height);
      diver.canvasContext.drawImage(frame.image, 0, 0, diver.canvas.width, diver.canvas.height);
      diver.frame = frameKey;
      diver.node.dataset.frame = String(frameIndex);
      diver.node.dataset.prop = diver.action === 'swim' ? 'none' : 'baked';
      diver.node.dataset.rigOwner = 'full-body-cel';
      if (diver.action === 'light' && frame.lightSocket) {
        const originX = frame.lightSocket[0] * 100;
        const originY = 25 + frame.lightSocket[1] * 50;
        diver.node.style.setProperty('--beam-origin-x', `${originX.toFixed(3)}%`);
        diver.node.style.setProperty('--beam-origin-y', `${originY.toFixed(3)}%`);
        diver.node.style.setProperty('--torch-rgb', diver.profile.torchColor);
        diver.node.dataset.flashlightLens = `${originX.toFixed(3)},${originY.toFixed(3)}`;
      } else {
        delete diver.node.dataset.flashlightLens;
      }
      return;
    }
    const sequence = ACTION_SEQUENCES[diver.action];
    const sequenceLocalFrame = sequence[sequenceFrame % sequence.length];
    if (diver.renderer === 'v2-cutout') {
      this._setV2ActionFrame(diver, sequenceLocalFrame);
      return;
    }
    const localFrame = diver.profile.frameRemap?.[`${diver.action}:${sequenceLocalFrame}`]
      ?? sequenceLocalFrame;
    const frame = ACTION_ROWS[diver.action] * 4 + localFrame;
    if (frame === diver.frame) return;
    diver.frame = frame;
    const column = frame % 4;
    const row = Math.floor(frame / 4);
    diver.sprite.style.backgroundPosition = `${column * (100 / 3)}% ${row * (100 / 3)}%`;
    if (diver.action === 'light') {
      const [originX, originY] = diver.profile.torchSockets[localFrame];
      diver.node.style.setProperty('--beam-origin-x', `${originX}%`);
      diver.node.style.setProperty('--beam-origin-y', `${originY}%`);
      diver.node.style.setProperty('--torch-rgb', diver.profile.torchColor);
    }
    diver.node.dataset.frame = String(frame);
  }

  _updateMember(diver, deltaSeconds, time) {
    const profile = diver.profile;
    const formationX = profile.formationX * this.direction;
    const waterDriftX = Math.sin(time * 0.23 + profile.phase) * (9 + diver.index * 1.2);
    const waterDriftY = Math.sin(time * (0.37 + diver.index * 0.035) + profile.phase) * (7 + diver.index * 1.8);
    const targetX = this.center.x + formationX + waterDriftX;
    const targetY = this.center.y + profile.formationY + waterDriftY;
    const response = 1 - Math.exp(-profile.response * deltaSeconds);

    diver.previousX = diver.x;
    diver.previousY = diver.y;
    diver.x += (targetX - diver.x) * response;
    diver.y += (targetY - diver.y) * response;
    const velocityX = (diver.x - diver.previousX) / Math.max(0.001, deltaSeconds);
    const velocityY = (diver.y - diver.previousY) / Math.max(0.001, deltaSeconds);
    diver.velocityX = velocityX;
    diver.velocityY = velocityY;

    const depthTarget = clamp(profile.depth + Math.sin(time * 0.12 + profile.phase) * 0.045, 0.58, 0.96);
    diver.depth += (depthTarget - diver.depth) * deltaSeconds * 0.32;
    const animationFps = diver.renderer === 'v3-sequence'
      ? diver.v3Role.actions[this._v3Action(diver.action)].fps
      : ACTION_FPS[diver.action];
    diver.animationClock += deltaSeconds * animationFps * profile.animationRate;
    this._setFrame(diver, Math.floor(diver.animationClock));
    this._updateV2Rig(diver, deltaSeconds, time);

    const depthScale = 0.68 + diver.depth * 0.42;
    const size = profile.size * depthScale;
    diver.screenSize = size;
    const pitch = clamp(Math.atan2(velocityY, Math.max(16, Math.abs(velocityX))) * 0.32
      + Math.sin(time * 0.41 + profile.phase) * 0.025, -0.18, 0.18);
    const beamSweep = Math.sin(diver.animationClock * 0.62 + profile.phase) * 4.5;
    const displayY = diver.y + this.scrollOffsetY;
    const warmth = clamp(1 - Math.hypot((diver.x - this.width * 0.5) / (this.width * 0.38), (displayY - this.height * 0.58) / (this.height * 0.46)), 0, 1);

    diver.node.style.width = `${size.toFixed(1)}px`;
    diver.node.style.height = `${size.toFixed(1)}px`;
    diver.node.style.zIndex = String(Math.round(diver.depth * 10000) + 40 + diver.index);
    diver.node.style.setProperty('--diver-blur', `${((1 - diver.depth) * 0.65).toFixed(3)}px`);
    diver.node.style.setProperty('--diver-brightness', (0.71 + diver.depth * 0.29 + warmth * 0.1).toFixed(3));
    diver.node.style.setProperty('--diver-saturation', (0.72 + diver.depth * 0.32).toFixed(3));
    diver.node.style.setProperty('--diver-warmth', (warmth * 0.22).toFixed(3));
    diver.node.style.setProperty('--beam-sweep', `${beamSweep.toFixed(2)}deg`);
    diver.node.style.transform = `translate3d(${(diver.x - size * 0.5).toFixed(2)}px, calc(${(diver.y - size * 0.5).toFixed(2)}px + var(--diver-scroll-y, 0px)), 0) rotate(${(pitch * this.direction).toFixed(4)}rad) scaleX(${this.direction})`;
    diver.node.dataset.depth = diver.depth.toFixed(3);
  }

  _simulate(deltaSeconds, timestamp) {
    const time = timestamp * 0.001;
    this._advanceMission(deltaSeconds);
    const mission = MISSION_STATES[this.stateIndex].name;
    const speedScale = mission === 'swim' ? 1 : mission === 'light' ? 0.7 : mission === 'search' ? 0.22 : 0.12;
    this.center.x += this.direction * this.cruiseSpeed * speedScale * deltaSeconds;
    this.center.y = this.height * (0.22 + Math.sin(time * 0.09) * 0.024);

    const margin = 430;
    if (this.direction > 0 && this.center.x > this.width + margin) {
      this.center.x = this.width + margin;
      this.direction = -1;
      this.stateIndex = 0;
      this.stateClock = 0;
      this._setMissionState('swim');
      console.info('[AbyssalDiveTeam] Formation turned at the right survey boundary.');
    } else if (this.direction < 0 && this.center.x < -margin) {
      this.center.x = -margin;
      this.direction = 1;
      this.stateIndex = 0;
      this.stateClock = 0;
      this._setMissionState('swim');
      console.info('[AbyssalDiveTeam] Formation turned at the left survey boundary.');
    }

    for (const diver of this.divers) this._updateMember(diver, deltaSeconds, time);
  }

  _tick(timestamp) {
    if (this.destroyed) return;
    this.frameHandle = requestAnimationFrame(this._tick);
    if (this.paused || !this.sceneActive) return;
    const targetFrameMs = 1000 / this.targetFps;
    if (timestamp - this.lastSimulationTimestamp < targetFrameMs) return;
    const deltaSeconds = this.lastTimestamp > 0
      ? clamp((timestamp - this.lastTimestamp) * 0.001, 0.001, 0.05)
      : targetFrameMs * 0.001;
    this.lastTimestamp = timestamp;
    this.lastSimulationTimestamp = timestamp;
    this._simulate(deltaSeconds, timestamp);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.frameHandle);
    removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    for (const diver of this.divers) diver.node.remove();
    this.divers.length = 0;
    delete document.documentElement.dataset.abyssalDiverCount;
    delete document.documentElement.dataset.abyssalDiverRoles;
    delete document.documentElement.dataset.abyssalDiveMission;
    delete document.documentElement.dataset.abyssalDiverRenderer;
    console.info('[AbyssalDiveTeam] Team controller destroyed.');
  }
}

export function startAbyssalDiveTeam(layers, options = {}) {
  return new AbyssalDiveTeam(layers, options).init();
}
