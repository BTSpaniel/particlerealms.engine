// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const TAU = Math.PI * 2;
const LEGACY_ATLAS_COLUMNS = 2;
const LEGACY_ATLAS_ROWS = 2;
const ATLAS_STYLE_ID = 'abyss-fauna-descriptor-style';

const ECOSYSTEM_ASSETS = Object.freeze({
  habitat: './assets/abyssal-fauna/vent-habitat-kit-v1.png',
  benthic: './assets/abyssal-fauna/vent-benthic-cycles-v1.png',
  visitor: './assets/abyssal-fauna/abyssal-visitor-cycles-v1.png',
});

const VISITOR_ROWS = Object.freeze(['ratfish', 'grenadier', 'dumbo-octopus', 'siphonophore']);

const DEFAULT_VISITOR_PROFILE = Object.freeze({
  atlases: Object.freeze([
    Object.freeze({ url: ECOSYSTEM_ASSETS.visitor, columns: 4, rows: 4 }),
  ]),
  frameRate: 7.2,
  size: 228,
  minSpeed: 8,
  maxSpeed: 19,
  turnRate: 13,
  registrationCellSize: 512,
});

const DEFAULT_GROUND_ACTORS = Object.freeze([
  // The late-scroll ecosystem lives on cool lower rock pockets, not over the
  // hot vent throat. Viewport-bottom anchors keep that staging stable at every
  // aspect ratio while the authored geology still supplies the ground plane.
  Object.freeze({ kind: 'habitat', name: 'black-smoker', asset: 'habitat', row: 0, column: 0, layer: 'far', depth: 0.38, size: 150, viewportX: 0.39, bottomInset: 0.10, rockZone: 'left-shelf', facing: 1, heat: 0.12, opacity: 0.12, occlusion: 0.48, blend: 'luminosity', tilt: -0.025 }),
  Object.freeze({ kind: 'habitat', name: 'white-smoker', asset: 'habitat', row: 0, column: 2, layer: 'far', depth: 0.36, size: 125, viewportX: 0.72, bottomInset: 0.09, rockZone: 'right-shelf', facing: -1, heat: 0.1, opacity: 0.08, occlusion: 0.5, blend: 'luminosity', tilt: 0.035 }),
  Object.freeze({ kind: 'habitat', name: 'pillow-basalt', asset: 'habitat', row: 1, column: 0, layer: 'far', depth: 0.48, size: 105, viewportX: 0.27, bottomInset: 0.035, rockZone: 'left-shelf', facing: 1, heat: 0.1, opacity: 0.16, occlusion: 0.52, blend: 'luminosity', tilt: -0.045 }),
  Object.freeze({ kind: 'habitat', name: 'riftia-tube-worms', asset: 'habitat', row: 3, column: 0, layer: 'mid', depth: 0.66, size: 64, viewportX: 0.17, bottomInset: 0.10, rockZone: 'left-shelf', facing: 1, heat: 0.18, opacity: 0.42, occlusion: 0.42, tilt: -0.018 }),
  Object.freeze({ kind: 'habitat', name: 'mussel-bed', asset: 'habitat', row: 3, column: 2, layer: 'mid', depth: 0.72, size: 70, viewportX: 0.79, bottomInset: 0.075, rockZone: 'right-shelf', facing: 1, heat: 0.16, opacity: 0.38, occlusion: 0.48, blend: 'luminosity', tilt: 0.028 }),
  Object.freeze({ kind: 'habitat', name: 'iron-microbial-mat', asset: 'habitat', row: 2, column: 1, layer: 'mid', depth: 0.78, size: 86, viewportX: 0.28, bottomInset: 0.025, rockZone: 'left-shelf', facing: -1, heat: 0.14, opacity: 0.26, occlusion: 0.55, tilt: -0.02 }),
  Object.freeze({ kind: 'benthic', name: 'vent-crab', asset: 'benthic', row: 0, layer: 'mid', depth: 0.72, size: 46, viewportX: 0.22, bottomInset: 0.08, rockZone: 'left-shelf', frameRate: 6.4, facing: 1, heat: 0.12, opacity: 0.48, occlusion: 0.35, tilt: -0.04 }),
  Object.freeze({ kind: 'benthic', name: 'squat-lobster', asset: 'benthic', row: 1, layer: 'mid', depth: 0.76, size: 48, viewportX: 0.83, bottomInset: 0.105, rockZone: 'right-shelf', frameRate: 6.8, facing: -1, heat: 0.14, opacity: 0.46, occlusion: 0.36, tilt: 0.035 }),
  Object.freeze({ kind: 'habitat', name: 'limpet-grazers', asset: 'habitat', row: 3, column: 3, layer: 'near', depth: 0.92, size: 54, viewportX: 0.91, bottomInset: 0.035, rockZone: 'right-shelf', facing: -1, heat: 0.1, opacity: 0.38, occlusion: 0.48, blend: 'luminosity', tilt: 0.08 }),
  Object.freeze({ kind: 'benthic', name: 'pompeii-worm', asset: 'benthic', row: 2, layer: 'near', depth: 0.94, size: 38, viewportX: 0.13, bottomInset: 0.085, rockZone: 'left-shelf', frameRate: 4.8, facing: 1, heat: 0.18, opacity: 0.44, occlusion: 0.4, tilt: -0.09 }),
  Object.freeze({ kind: 'benthic', name: 'vent-scaleworm', asset: 'benthic', row: 3, layer: 'near', depth: 0.98, size: 40, viewportX: 0.88, bottomInset: 0.06, rockZone: 'right-shelf', frameRate: 5.1, facing: -1, heat: 0.16, opacity: 0.44, occlusion: 0.36, tilt: 0.06 }),
]);

const PROFILE_ATLAS_CACHE = new WeakMap();

const DEFAULT_SPECIES = Object.freeze({
  eelpout: Object.freeze({
    sheets: Object.freeze([
      './assets/abyssal-fauna/eelpout-sheet-1-v1.png',
      './assets/abyssal-fauna/eelpout-sheet-2-v1.png',
      './assets/abyssal-fauna/eelpout-sheet-3-v1.png',
    ]),
    frameRate: 10.2,
    size: 235,
    minSpeed: 12,
    maxSpeed: 29,
    turnRate: 18,
    registrationCellSize: 627,
    registration: Object.freeze([
      Object.freeze([-10, 0]), Object.freeze([6, -3]), Object.freeze([-3, 73]), Object.freeze([10, 74]),
      Object.freeze([-8, 0]), Object.freeze([7, -1]), Object.freeze([-8, 65]), Object.freeze([14, 48]),
      Object.freeze([-8, -4]), Object.freeze([8, -6]), Object.freeze([-8, 71]), Object.freeze([10, 72]),
    ]),
  }),
  sculpin: Object.freeze({
    sheets: Object.freeze([
      './assets/abyssal-fauna/sculpin-sheet-1-v1.png',
      './assets/abyssal-fauna/sculpin-sheet-2-v1.png',
      './assets/abyssal-fauna/sculpin-sheet-3-v1.png',
    ]),
    frameRate: 11.4,
    size: 168,
    minSpeed: 9,
    maxSpeed: 23,
    turnRate: 22,
    registrationCellSize: 627,
    registration: Object.freeze([
      Object.freeze([-10, -6]), Object.freeze([11, -11]), Object.freeze([-14, 56]), Object.freeze([14, 47]),
      Object.freeze([-12, 0]), Object.freeze([8, -8]), Object.freeze([-15, 59]), Object.freeze([14, 47]),
      Object.freeze([-9, -7]), Object.freeze([15, -8]), Object.freeze([-13, 55]), Object.freeze([15, 53]),
    ]),
  }),
});

const DEFAULT_PLANES = Object.freeze([
  Object.freeze({ name: 'far', count: 4, depth: 0.38, species: Object.freeze(['eelpout', 'eelpout', 'eelpout', 'sculpin']) }),
  Object.freeze({ name: 'mid', count: 2, depth: 0.68, species: Object.freeze(['eelpout', 'sculpin']) }),
  Object.freeze({ name: 'near', count: 1, depth: 1.0, species: Object.freeze(['sculpin']) }),
]);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(value) {
  const normalized = clamp(value, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function length(x, y) {
  return Math.hypot(x, y);
}

function createRandom(seed = 0x51f15e) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function ensureDescriptorAtlasStyle() {
  if (document.getElementById(ATLAS_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = ATLAS_STYLE_ID;
  style.textContent = `
    .abyss-fauna::before {
      background-size: var(--fauna-frame-0-size, 200% 200%);
    }
    .abyss-fauna::after {
      background-size: var(--fauna-frame-1-size, 200% 200%);
    }
  `;
  document.head.appendChild(style);
}

function getProfileAtlases(profile) {
  const cached = PROFILE_ATLAS_CACHE.get(profile);
  if (cached) return cached;

  const source = profile.atlases ?? profile.sheets ?? [];
  const atlases = source.map((entry) => {
    if (typeof entry === 'string') {
      return Object.freeze({
        url: entry,
        columns: profile.atlasColumns ?? LEGACY_ATLAS_COLUMNS,
        rows: profile.atlasRows ?? LEGACY_ATLAS_ROWS,
      });
    }
    return Object.freeze({
      url: entry.url,
      columns: Math.max(1, Math.floor(entry.columns ?? profile.atlasColumns ?? LEGACY_ATLAS_COLUMNS)),
      rows: Math.max(1, Math.floor(entry.rows ?? profile.atlasRows ?? LEGACY_ATLAS_ROWS)),
      frameCount: entry.frameCount,
    });
  }).filter((entry) => entry.url);
  PROFILE_ATLAS_CACHE.set(profile, atlases);
  return atlases;
}

function getProfileFrameCount(profile) {
  if (profile.frameSequence?.length) return profile.frameSequence.length;
  if (Number.isFinite(profile.frameCount)) return Math.max(1, Math.floor(profile.frameCount));
  return Math.max(1, getProfileAtlases(profile).reduce((total, atlas) => (
    total + Math.min(atlas.columns * atlas.rows, atlas.frameCount ?? Number.POSITIVE_INFINITY)
  ), 0));
}

function resolveAtlasFrame(profile, timelineFrame) {
  const timelineLength = getProfileFrameCount(profile);
  const normalizedFrame = ((timelineFrame % timelineLength) + timelineLength) % timelineLength;
  const sourceFrame = profile.frameSequence?.[normalizedFrame] ?? normalizedFrame;
  let remaining = sourceFrame;

  for (const atlas of getProfileAtlases(profile)) {
    const capacity = Math.min(atlas.columns * atlas.rows, atlas.frameCount ?? Number.POSITIVE_INFINITY);
    if (remaining < capacity) {
      return {
        atlas,
        column: remaining % atlas.columns,
        row: Math.floor(remaining / atlas.columns),
        normalizedFrame,
        sourceFrame,
      };
    }
    remaining -= capacity;
  }
  throw new RangeError(`Fauna frame ${sourceFrame} exceeds its atlas descriptors.`);
}

function createFourByFourProfile(assetUrl, row, frameRate, size, column = null) {
  const frameSequence = column === null
    ? Object.freeze([0, 1, 2, 3].map((offset) => row * 4 + offset))
    : Object.freeze([row * 4 + column]);
  return Object.freeze({
    atlases: Object.freeze([Object.freeze({ url: assetUrl, columns: 4, rows: 4 })]),
    frameSequence,
    frameRate,
    size,
    minSpeed: 0,
    maxSpeed: 0,
    turnRate: 0,
    registrationCellSize: 512,
  });
}

function preloadSheet(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = async () => {
      // Some Chromium/driver combinations leave decode() pending for an image
      // that has already completed. Never let one atlas hold the entire field.
      let decodeDeadline = 0;
      try {
        await Promise.race([
          image.decode(),
          new Promise((settle) => { decodeDeadline = setTimeout(settle, 1600); }),
        ]);
      } catch (_) { /* onload already proved the bitmap is usable */ }
      clearTimeout(decodeDeadline);
      resolve({ url, loaded: true, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => resolve({ url, loaded: false });
    image.src = url;
  });
}

/**
 * Small DOM fauna field for the authored abyssal landing scene.
 * Local flock rules are deliberately limited to fish on the same depth plane.
 */
export class AbyssalFaunaField {
  constructor(layers, options = {}) {
    this.layers = layers;
    this.ecosystemLayers = options.ecosystemLayers ?? layers;
    this.species = options.species ?? DEFAULT_SPECIES;
    this.planes = options.planes ?? DEFAULT_PLANES;
    this.ecosystemAssets = Object.freeze({ ...ECOSYSTEM_ASSETS, ...(options.ecosystemAssets ?? {}) });
    this.visitorProfile = options.visitorProfile ?? DEFAULT_VISITOR_PROFILE;
    this.groundActorSpecs = options.groundActors ?? DEFAULT_GROUND_ACTORS;
    this.ecosystemEnabled = options.ecosystem !== false;
    this.ventProjection = options.ventProjection ?? (() => ({ x: innerWidth * 0.5, y: innerHeight * 0.56 }));
    this.targetFps = clamp(options.targetFps ?? 30, 12, 60);
    this.pointerRadius = clamp(options.pointerRadius ?? 210, 80, 420);
    this.random = createRandom(options.seed ?? 0xa8b55a1);
    this.fish = [];
    this.groundActors = [];
    this.loadedAssetUrls = new Set();
    this.pointer = { x: -1000, y: -1000, active: false, lastAt: 0 };
    this.interactionRegion = options.interactionRegion ?? null;
    this.layoutExclusion = options.layoutExclusion ?? null;
    this.pointerIdleMs = clamp(options.pointerIdleMs ?? 220, 120, 600);
    this.width = Math.max(1, innerWidth);
    this.height = Math.max(1, innerHeight);
    this.frameHandle = 0;
    this.lastTimestamp = 0;
    this.lastSimulationTimestamp = 0;
    this.destroyed = false;
    this.sceneActive = true;
    this.scrollProgress = 0;
    this.heroProgress = 0;
    this.swimmerPresence = 1;
    this.ecosystemReveal = 0;
    this.motionPaused = false;
    this.paused = document.hidden;
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
    this._tick = this._tick.bind(this);
  }

  init() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.documentElement.dataset.abyssalFauna = 'reduced';
      document.documentElement.dataset.abyssalEcosystem = 'reduced';
      console.info('[AbyssalFauna] Reduced motion requested; fauna and ecosystem animation disabled.');
      return this;
    }

    ensureDescriptorAtlasStyle();

    for (const plane of this.planes) {
      const layer = this.layers[plane.name];
      if (!layer) throw new Error(`Missing abyssal fauna layer: ${plane.name}`);
      for (let index = 0; index < plane.count; index += 1) {
        this._createFish(layer, plane, plane.species[index % plane.species.length], index);
      }
    }
    this._updateDepthStacks();

    addEventListener('pointermove', this._onPointerMove, { passive: true });
    addEventListener('pointerout', this._onPointerLeave, { passive: true });
    addEventListener('resize', this._onResize, { passive: true });
    document.addEventListener('visibilitychange', this._onVisibility);
    this._measureLayoutExclusion();

    const baseSheetUrls = Object.values(this.species).flatMap((entry) => (
      getProfileAtlases(entry).map((atlas) => atlas.url)
    ));
    const ecosystemUrls = this.ecosystemEnabled
      ? [
        ...getProfileAtlases(this.visitorProfile).map((atlas) => atlas.url),
        this.ecosystemAssets.habitat,
        this.ecosystemAssets.benthic,
      ]
      : [];
    const sheetUrls = [...new Set([...baseSheetUrls, ...ecosystemUrls])];
    Promise.all(sheetUrls.map(preloadSheet)).then((results) => {
      if (this.destroyed) return;
      const missing = results.filter((entry) => !entry.loaded).map((entry) => entry.url);
      this.loadedAssetUrls = new Set(results.filter((entry) => entry.loaded).map((entry) => entry.url));
      if (missing.length > 0) console.warn('[AbyssalFauna] Sprite sheets failed to load.', missing);
      else console.info(`[AbyssalFauna] ${results.length} sprite sheets ready.`);
      this._validateAtlasResults(results);

      if (this.ecosystemEnabled && getProfileAtlases(this.visitorProfile).every((atlas) => this.loadedAssetUrls.has(atlas.url))) {
        this._activateRareVisitor();
      }
      if (this.ecosystemEnabled) this._createGroundEcosystem();
      this._updateDepthStacks();
      // Establish every transform while actors are still hidden. This avoids a
      // one-frame origin flash when a late-decoding atlas joins the scene.
      this._simulate(0, performance.now());
      for (const fish of this.fish) fish.node.style.visibility = '';
      for (const actor of this.groundActors) actor.node.style.visibility = '';
      this._updateRuntimeTelemetry();
      if (!this.frameHandle) this.frameHandle = requestAnimationFrame(this._tick);
    });

    document.documentElement.dataset.abyssalFauna = 'active';
    document.documentElement.dataset.faunaCount = String(this.fish.length);
    document.documentElement.dataset.faunaSpecies = Object.keys(this.species).join(',');
    document.documentElement.dataset.faunaTargetFps = String(this.targetFps);
    console.info(`[AbyssalFauna] ${this.fish.length} fish across ${this.planes.length} depth planes.`);
    return this;
  }

  _createFish(layer, plane, speciesName, index) {
    const profile = this.species[speciesName];
    if (!profile) throw new Error(`Unknown abyssal fauna species: ${speciesName}`);

    const node = document.createElement('i');
    node.className = `abyss-fauna abyss-fauna-${speciesName}`;
    node.dataset.species = speciesName;
    node.dataset.depthPlane = plane.name;
    node.setAttribute('aria-hidden', 'true');
    layer.appendChild(node);

    const direction = this.random() > 0.5 ? 1 : -1;
    const depthVariance = 0.88 + this.random() * 0.22;
    const size = profile.size * plane.depth * depthVariance;
    const speed = profile.minSpeed + this.random() * (profile.maxSpeed - profile.minSpeed);
    const heading = (this.random() - 0.5) * 0.24;
    const frameCount = getProfileFrameCount(profile);
    const fish = {
      node,
      plane: plane.name,
      depth: clamp(plane.depth * depthVariance, 0.28, 1.06),
      speciesName,
      profile,
      baseScale: depthVariance,
      size,
      x: ((index + this.random() * 0.8) / plane.count) * this.width,
      y: this.height * (0.12 + this.random() * 0.28),
      displayY: 0,
      vx: Math.cos(heading) * speed * direction,
      vy: Math.sin(heading) * speed,
      phase: this.random() * TAU,
      wanderPhase: this.random() * TAU,
      wanderRate: 0.24 + this.random() * 0.42,
      bobRate: 0.6 + this.random() * 0.75,
      bobAmplitude: (speciesName === 'sculpin' ? 4.5 : 2.8) * (0.72 + this.random() * 0.56),
      pitchBias: (this.random() - 0.5) * (speciesName === 'sculpin' ? 0.13 : 0.085),
      cruiseScale: 0.78 + this.random() * 0.46,
      animationRate: 0.82 + this.random() * 0.36,
      turnScale: 0.76 + this.random() * 0.5,
      personalSpace: 0.82 + this.random() * 0.38,
      depthPhase: this.random() * TAU,
      depthRate: 0.045 + this.random() * 0.035,
      homeDepth: plane.depth,
      depthAmplitude: plane.name === 'mid' ? 0.34 : 0.3,
      layerName: plane.name,
      stackId: this.fish.length,
      stackOrder: -1,
      bottomResident: speciesName === 'sculpin' && plane.name !== 'far',
      rockZone: this.fish.length % 2 === 0 ? 'left-shelf' : 'right-shelf',
      presentationScale: speciesName === 'sculpin' && plane.name !== 'far' ? 0.58 : 1,
      heat: 0,
      animationClock: this.random() * frameCount,
      frameCount,
      frame: -1,
      frameSlot: 1,
    };
    node.style.width = `${size.toFixed(1)}px`;
    node.style.height = `${size.toFixed(1)}px`;
    node.style.opacity = '1';
    node.style.visibility = 'hidden';
    node.style.display = fish.bottomResident ? 'none' : '';
    node.dataset.scrollRole = fish.bottomResident ? 'bottom-resident' : 'upper-swimmer';
    node.dataset.rockZone = fish.rockZone;
    this.fish.push(fish);
    this._setSpriteFrame(fish, Math.floor(fish.animationClock) % frameCount);
  }

  _activateRareVisitor() {
    const farCandidates = this.fish.filter((fish) => fish.plane === 'far');
    if (farCandidates.length === 0) return;
    const visitor = farCandidates[farCandidates.length - 1];
    const row = Math.floor(this.random() * VISITOR_ROWS.length);
    const visitorName = VISITOR_ROWS[row];
    const baseProfile = this.visitorProfile;
    const profile = Object.freeze({
      ...baseProfile,
      frameSequence: Object.freeze([0, 1, 2, 3].map((offset) => row * 4 + offset)),
    });

    visitor.profile = profile;
    visitor.speciesName = `visitor-${visitorName}`;
    visitor.node.className = `abyss-fauna abyss-fauna-visitor abyss-fauna-${visitorName}`;
    visitor.node.dataset.species = visitor.speciesName;
    visitor.frameCount = getProfileFrameCount(profile);
    visitor.animationClock = this.random() * visitor.frameCount;
    visitor.frame = -1;
    visitor.frameSlot = 1;
    visitor.baseScale = 0.9 + this.random() * 0.12;
    visitor.size = profile.size * visitor.depth * visitor.baseScale;
    visitor.node.style.width = `${visitor.size.toFixed(1)}px`;
    visitor.node.style.height = `${visitor.size.toFixed(1)}px`;
    visitor.cruiseScale = 0.92 + this.random() * 0.2;
    visitor.animationRate = 0.9 + this.random() * 0.2;
    visitor.bobAmplitude = 2.1 * (0.8 + this.random() * 0.4);
    visitor.pitchBias = (this.random() - 0.5) * 0.06;
    this._setSpriteFrame(visitor, Math.floor(visitor.animationClock));
    console.info(`[AbyssalFauna] Rare ${visitorName} visitor assigned to one far-plane slot.`);
  }

  _validateAtlasResults(results) {
    const expectations = new Map();
    for (const profile of [...Object.values(this.species), this.visitorProfile]) {
      for (const atlas of getProfileAtlases(profile)) expectations.set(atlas.url, atlas);
    }
    expectations.set(this.ecosystemAssets.habitat, { columns: 4, rows: 4 });
    expectations.set(this.ecosystemAssets.benthic, { columns: 4, rows: 4 });

    let validCount = 0;
    for (const result of results) {
      if (!result.loaded) continue;
      const atlas = expectations.get(result.url);
      if (!atlas) continue;
      if (result.width % atlas.columns !== 0 || result.height % atlas.rows !== 0) {
        console.warn(
          `[AbyssalFauna] Atlas grid mismatch for ${result.url}: ${result.width}x${result.height} cannot form an exact ${atlas.columns}x${atlas.rows} grid.`,
        );
        continue;
      }
      validCount += 1;
    }
    console.info(`[AbyssalFauna] ${validCount} descriptor atlas grids validated.`);
  }

  _createGroundEcosystem() {
    for (let index = 0; index < this.groundActorSpecs.length; index += 1) {
      const spec = this.groundActorSpecs[index];
      const assetUrl = this.ecosystemAssets[spec.asset];
      if (!assetUrl || !this.loadedAssetUrls.has(assetUrl)) continue;
      const layer = this.ecosystemLayers[spec.layer] ?? this.layers[spec.layer];
      if (!layer) {
        console.warn(`[AbyssalFauna] Missing ${spec.layer} layer for ecosystem actor ${spec.name}.`);
        continue;
      }
      const profile = createFourByFourProfile(
        assetUrl,
        clamp(Math.floor(spec.row ?? 0), 0, 3),
        Math.max(0, spec.frameRate ?? 0),
        Math.max(24, spec.size ?? 128),
        spec.kind === 'habitat' ? clamp(Math.floor(spec.column ?? 0), 0, 3) : null,
      );
      const node = document.createElement('i');
      node.className = `abyss-fauna abyss-ecosystem abyss-ecosystem-${spec.kind} abyss-ecosystem-${spec.name}`;
      node.dataset.species = spec.name;
      node.dataset.depthPlane = spec.layer;
      node.dataset.ecosystemKind = spec.kind;
      node.setAttribute('aria-hidden', 'true');
      layer.appendChild(node);

      const frameCount = getProfileFrameCount(profile);
      const actor = {
        node,
        kind: spec.kind,
        name: spec.name,
        profile,
        layerName: spec.layer,
        plane: spec.layer,
        depth: clamp(spec.depth ?? 0.75, 0.28, 1.06),
        size: profile.size,
        baseSize: profile.size,
        offsetX: spec.offsetX ?? 0,
        offsetY: spec.offsetY ?? 180,
        imageUV: Array.isArray(spec.imageUV) ? spec.imageUV.slice(0, 2) : null,
        viewportX: Number.isFinite(spec.viewportX) ? clamp(spec.viewportX, -0.1, 1.1) : null,
        bottomInset: Number.isFinite(spec.bottomInset) ? clamp(spec.bottomInset, -0.1, 0.5) : null,
        rockZone: spec.rockZone ?? 'vent-rim',
        facing: spec.facing ?? 1,
        heat: clamp(spec.heat ?? 0.3, 0, 1),
        baseHeat: clamp(spec.heat ?? 0.3, 0, 1),
        baseOpacity: clamp(spec.opacity ?? 0.7, 0.08, 1),
        occlusion: clamp(spec.occlusion ?? 0.14, 0, 0.55),
        blend: spec.blend ?? 'normal',
        tilt: Number.isFinite(spec.tilt) ? spec.tilt : 0,
        layoutAttenuation: 1,
        phase: this.random() * TAU,
        animationRate: 0.9 + this.random() * 0.2,
        animationClock: this.random() * frameCount,
        frameCount,
        frame: -1,
        frameSlot: 1,
        stackId: this.fish.length + this.groundActors.length,
        stackOrder: -1,
        x: 0,
        y: 0,
      };
      node.style.width = `${actor.size.toFixed(1)}px`;
      node.style.height = `${actor.size.toFixed(1)}px`;
      node.style.opacity = '0';
      node.style.mixBlendMode = actor.blend;
      node.style.setProperty('--ecosystem-occlusion-start', `${(100 - actor.occlusion * 100).toFixed(1)}%`);
      node.style.visibility = 'hidden';
      node.style.display = this.sceneActive && this.ecosystemReveal > 0.015 ? '' : 'none';
      node.dataset.rockZone = actor.rockZone;
      this.groundActors.push(actor);
      this._setSpriteFrame(actor, Math.floor(actor.animationClock));
    }
    this._measureLayoutExclusion();
    console.info(`[AbyssalFauna] ${this.groundActors.length} lower-rock ecosystem actors ready.`);
  }

  _measureLayoutExclusion() {
    const target = typeof this.layoutExclusion === 'string'
      ? document.querySelector(this.layoutExclusion)
      : this.layoutExclusion;
    const bounds = target?.getBoundingClientRect();
    this.layoutExclusionBounds = bounds
      ? { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom }
      : null;
  }

  _updateRuntimeTelemetry() {
    const species = [...new Set(this.fish.map((fish) => fish.speciesName))];
    document.documentElement.dataset.faunaCount = String(this.fish.length);
    document.documentElement.dataset.faunaSpecies = species.join(',');
    document.documentElement.dataset.bottomResidentCount = String(this.fish.filter((fish) => fish.bottomResident).length);
    document.documentElement.dataset.abyssalEcosystem = this.groundActors.length > 0 ? 'active' : 'unavailable';
    document.documentElement.dataset.ecosystemCount = String(this.groundActors.length);
  }

  _onPointerMove(event) {
    if (!this.sceneActive || event.pointerType === 'touch') return;
    const eventTarget = event.target instanceof Element ? event.target : null;
    if (eventTarget?.closest('a, button, input, select, textarea, pre, code, nav, [role="button"]')) {
      this.pointer.active = false;
      return;
    }
    if (this.interactionRegion) {
      const region = typeof this.interactionRegion === 'string'
        ? document.querySelector(this.interactionRegion)
        : this.interactionRegion;
      const bounds = region?.getBoundingClientRect();
      if (!bounds || event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom) {
        this.pointer.active = false;
        return;
      }
    }
    this.pointer.x = event.clientX;
    this.pointer.y = event.clientY;
    this.pointer.lastAt = performance.now();
    this.pointer.active = true;
  }

  _onPointerLeave(event) {
    if (!event.relatedTarget) this.pointer.active = false;
  }

  _onResize() {
    const previousWidth = this.width;
    const previousHeight = this.height;
    this.width = Math.max(1, innerWidth);
    this.height = Math.max(1, innerHeight);
    for (const fish of this.fish) {
      fish.x = (fish.x / Math.max(1, previousWidth)) * this.width;
      fish.y = (fish.y / Math.max(1, previousHeight)) * this.height;
    }
    this._measureLayoutExclusion();
  }

  _onVisibility() {
    this.paused = document.hidden || this.motionPaused;
    this.lastTimestamp = 0;
    this.lastSimulationTimestamp = 0;
  }

  _syncFishScrollPresentation(fish) {
    const opacity = fish.bottomResident ? this.ecosystemReveal : this.swimmerPresence;
    const present = opacity > 0;
    fish.node.style.opacity = opacity.toFixed(3);
    fish.node.style.display = this.sceneActive && present ? '' : 'none';
  }

  setActive(active) {
    const nextActive = Boolean(active);
    if (this.sceneActive === nextActive) return;
    this.sceneActive = nextActive;
    this.pointer.active = false;
    for (const fish of this.fish) {
      this._syncFishScrollPresentation(fish);
    }
    for (const actor of this.groundActors) {
      actor.node.style.display = this.sceneActive && this.ecosystemReveal > 0.015 ? '' : 'none';
    }
    this.lastTimestamp = 0;
    this.lastSimulationTimestamp = 0;
  }

  /**
   * Directs the fixed fauna layers through the page's scroll story. Upper
   * swimmers dissolve continuously through the hero descent; two small
   * sculpin remain solid and re-enter beside the lower rock shelves with the
   * benthic ecosystem near the page bottom.
   */
  setScrollProgress(progress, heroProgress = progress) {
    const normalized = clamp(Number(progress) || 0, 0, 1);
    const heroDepth = clamp(Number(heroProgress) || 0, 0, 1);
    if (Math.abs(normalized - this.scrollProgress) < 0.0005
      && Math.abs(heroDepth - this.heroProgress) < 0.0005) return;
    const previousEcosystemReveal = this.ecosystemReveal;
    this.scrollProgress = normalized;
    this.heroProgress = heroDepth;
    this.swimmerPresence = 1 - smoothstep((heroDepth - 0.18) / 0.52);
    this.ecosystemReveal = smoothstep((normalized - 0.68) / 0.18);

    if (previousEcosystemReveal <= 0 && this.ecosystemReveal > 0) {
      for (const fish of this.fish) {
        if (!fish.bottomResident) continue;
        const shelfX = fish.rockZone === 'left-shelf' ? 0.2 : 0.8;
        fish.x = this.width * (shelfX + Math.sin(fish.phase) * 0.06);
        fish.y = this.height * (0.78 + (0.5 + 0.5 * Math.cos(fish.phase)) * 0.1);
      }
    }

    for (const fish of this.fish) {
      this._syncFishScrollPresentation(fish);
    }
    for (const actor of this.groundActors) {
      actor.node.style.display = this.sceneActive && this.ecosystemReveal > 0.015 ? '' : 'none';
    }

    document.documentElement.dataset.abyssalSwimmerPresence = this.swimmerPresence.toFixed(3);
    document.documentElement.dataset.abyssalEcosystemReveal = this.ecosystemReveal.toFixed(3);
  }

  setPaused(paused) {
    this.motionPaused = Boolean(paused);
    this._onVisibility();
  }

  /**
   * Read-only viewport-space wakes for lightweight effects that share this
   * scene. Only swimming fish participate; grounded habitat actors do not.
   */
  getWakeSources() {
    if (!this.sceneActive || this.destroyed) return [];
    return this.fish
      .filter((fish) => fish.node.style.visibility !== 'hidden' && fish.node.style.display !== 'none')
      .map((fish) => ({
        id: `fish:${fish.stackId}`,
        kind: 'fish',
        x: fish.x - Math.sign(fish.vx || 1) * fish.size * 0.2,
        y: Number.isFinite(fish.displayY) ? fish.displayY : fish.y,
        vx: fish.vx,
        vy: fish.vy,
        radius: fish.size * 0.36,
        strength: 0.34 + fish.depth * 0.16,
        depth: fish.depth,
        direction: Math.sign(fish.vx || 1),
      }));
  }

  _setSpriteFrame(fish, frame, forceRegistration = false) {
    if (frame === fish.frame && !forceRegistration) return;
    const isNewFrame = frame !== fish.frame;
    if (isNewFrame) {
      fish.frame = frame;
      fish.frameSlot = 1 - fish.frameSlot;
    }
    const resolved = resolveAtlasFrame(fish.profile, frame);
    const registration = fish.profile.registration?.[resolved.sourceFrame]
      ?? fish.profile.registration?.[resolved.normalizedFrame]
      ?? [0, 0];
    const [sourceOffsetX, sourceOffsetY] = registration;
    const registrationScale = fish.size / (fish.profile.registrationCellSize ?? 512);
    const offsetX = sourceOffsetX * registrationScale;
    const offsetY = sourceOffsetY * registrationScale;
    const columnPercent = resolved.atlas.columns > 1
      ? (resolved.column / (resolved.atlas.columns - 1)) * 100
      : 0;
    const rowPercent = resolved.atlas.rows > 1
      ? (resolved.row / (resolved.atlas.rows - 1)) * 100
      : 0;
    const position = `calc(${columnPercent.toFixed(5)}% + ${offsetX.toFixed(2)}px) calc(${rowPercent.toFixed(5)}% + ${offsetY.toFixed(2)}px)`;
    const backgroundSize = `${resolved.atlas.columns * 100}% ${resolved.atlas.rows * 100}%`;
    const slot = fish.frameSlot;
    fish.node.style.setProperty(`--fauna-frame-${slot}-image`, `url("${resolved.atlas.url}")`);
    fish.node.style.setProperty(`--fauna-frame-${slot}-position`, position);
    fish.node.style.setProperty(`--fauna-frame-${slot}-size`, backgroundSize);
    if (isNewFrame) fish.node.dataset.frameSlot = String(slot);
  }

  _applySchooling(fish, acceleration) {
    let neighborCount = 0;
    let alignmentX = 0;
    let alignmentY = 0;
    let cohesionX = 0;
    let cohesionY = 0;
    let separationX = 0;
    let separationY = 0;
    const perception = 145 + fish.depth * 55;

    for (const other of this.fish) {
      if (other === fish || Math.abs(other.depth - fish.depth) > 0.2) continue;
      const dx = other.x - fish.x;
      const dy = other.y - fish.y;
      const distance = length(dx, dy);
      if (distance <= 0.001 || distance > perception) continue;
      neighborCount += 1;
      alignmentX += other.vx;
      alignmentY += other.vy;
      cohesionX += other.x;
      cohesionY += other.y;
      const separationRadius = (72 * fish.depth + 26) * fish.personalSpace;
      if (distance < separationRadius) {
        const pressure = 1 - distance / separationRadius;
        separationX -= (dx / distance) * pressure;
        separationY -= (dy / distance) * pressure;
      }
    }

    if (neighborCount === 0) return;
    alignmentX = alignmentX / neighborCount - fish.vx;
    alignmentY = alignmentY / neighborCount - fish.vy;
    cohesionX = cohesionX / neighborCount - fish.x;
    cohesionY = cohesionY / neighborCount - fish.y;
    acceleration.x += alignmentX * 0.15 + cohesionX * 0.01 + separationX * 36;
    acceleration.y += alignmentY * 0.15 + cohesionY * 0.01 + separationY * 36;
  }

  _applyAvoidance(fish, acceleration, vent) {
    const ventRadiusX = 150 + fish.depth * 115;
    const ventRadiusY = 105 + fish.depth * 75;
    const ventDX = fish.x - vent.x;
    const ventDY = fish.y - vent.y;
    const ventDistance = Math.hypot(ventDX / ventRadiusX, ventDY / ventRadiusY);
    const thermalDistance = (ventDX / (ventRadiusX * 2.2)) ** 2 + (ventDY / (ventRadiusY * 2.4)) ** 2;
    const thermalDepth = Math.exp(-(((fish.depth - 0.82) / 0.28) ** 2));
    fish.heat = clamp(Math.exp(-thermalDistance * 1.25) * thermalDepth, 0, 1);
    if (ventDistance < 1) {
      const pressure = (1 - ventDistance) * 62;
      const safeDistance = Math.max(0.001, length(ventDX, ventDY));
      acceleration.x += (ventDX / safeDistance) * pressure;
      acceleration.y += (ventDY / safeDistance) * pressure;
    }

    const plumeWidth = 68 + fish.depth * 64;
    if (fish.y < vent.y && Math.abs(ventDX) < plumeWidth) {
      const plumePressure = (1 - Math.abs(ventDX) / plumeWidth) * (1 - clamp((vent.y - fish.y) / (this.height * 0.7), 0, 1));
      acceleration.x += Math.sign(ventDX || fish.vx || 1) * plumePressure * 40;
      acceleration.y -= plumePressure * 7;
    }

    if (!this.pointer.active) return;
    const pointerDX = fish.x - this.pointer.x;
    const pointerDY = fish.y - this.pointer.y;
    const pointerDistance = length(pointerDX, pointerDY);
    const radius = this.pointerRadius * (0.75 + fish.depth * 0.35);
    if (pointerDistance > 0.001 && pointerDistance < radius) {
      const pressure = (1 - pointerDistance / radius) ** 2;
      acceleration.x += (pointerDX / pointerDistance) * pressure * 118;
      acceleration.y += (pointerDY / pointerDistance) * pressure * 118;
    }
  }

  _updateDepth(fish, deltaSeconds, time) {
    const depthWave = 0.5 + 0.5 * Math.sin(time * fish.depthRate + fish.depthPhase);
    const speciesBias = fish.speciesName === 'sculpin' ? -0.035 : 0.02;
    const targetDepth = clamp(
      fish.homeDepth + (depthWave * 2 - 1) * fish.depthAmplitude + speciesBias,
      0.28,
      1.06,
    );
    fish.depth += (targetDepth - fish.depth) * deltaSeconds * 0.12;
    fish.depth = clamp(fish.depth, 0.28, 1.06);

    const nextSize = fish.profile.size * fish.depth * fish.baseScale * fish.presentationScale;
    if (Math.abs(nextSize - fish.size) > 0.08) {
      fish.size = nextSize;
      fish.node.style.width = `${nextSize.toFixed(1)}px`;
      fish.node.style.height = `${nextSize.toFixed(1)}px`;
      this._setSpriteFrame(fish, fish.frame, true);
    }
    fish.node.dataset.depth = fish.depth.toFixed(3);
  }

  _updateGroundActors(deltaSeconds, time, vent) {
    const sceneScale = clamp(((vent.displayWidth ?? this.width) / 1536) * 0.82, 0.66, 1.04);
    for (const actor of this.groundActors) {
      const depthScale = 0.76 + actor.depth * 0.24;
      const nextSize = actor.baseSize * sceneScale * depthScale;
      if (Math.abs(nextSize - actor.size) > 0.08) {
        actor.size = nextSize;
        actor.node.style.width = `${nextSize.toFixed(1)}px`;
        actor.node.style.height = `${nextSize.toFixed(1)}px`;
        this._setSpriteFrame(actor, actor.frame, true);
      }

      const imageCropX = (vent.sourceOffsetX ?? 0) * (vent.displayWidth ?? this.width);
      const viewportAnchored = Number.isFinite(actor.viewportX) && Number.isFinite(actor.bottomInset);
      const anchorX = viewportAnchored
        ? actor.viewportX * this.width
        : actor.imageUV && vent.displayWidth
          ? actor.imageUV[0] * vent.displayWidth - imageCropX
          : vent.x + actor.offsetX * sceneScale;
      const anchorY = viewportAnchored
        ? this.height * (1 - actor.bottomInset)
        : actor.imageUV && vent.displayHeight
          ? actor.imageUV[1] * vent.displayHeight
          : vent.y + actor.offsetY * sceneScale;
      actor.x = clamp(anchorX, -actor.size * 0.15, this.width + actor.size * 0.15);
      actor.y = clamp(anchorY, this.height * 0.46, this.height + actor.size * 0.22);

      const actorLeft = actor.x - actor.size * 0.5;
      const actorTop = actor.y - actor.size * 0.96875;
      const exclusion = this.layoutExclusionBounds;
      let layoutTarget = 1;
      if (exclusion && this.scrollProgress < 0.5) {
        const overlapWidth = Math.max(0, Math.min(actor.x + actor.size * 0.5, exclusion.right) - Math.max(actorLeft, exclusion.left));
        const overlapHeight = Math.max(0, Math.min(actor.y, exclusion.bottom) - Math.max(actorTop, exclusion.top));
        const overlapRatio = (overlapWidth * overlapHeight) / Math.max(1, actor.size * actor.size * 0.68);
        layoutTarget = clamp(1 - overlapRatio * 0.82, 0.28, 1);
      }
      actor.layoutAttenuation += (layoutTarget - actor.layoutAttenuation) * clamp(deltaSeconds * 7, 0, 1);

      const thermalX = (actor.x - vent.x) / Math.max(1, 230 * sceneScale);
      const thermalY = (actor.y - (vent.y + 175 * sceneScale)) / Math.max(1, 165 * sceneScale);
      const localWarmth = Math.exp(-(thermalX * thermalX + thermalY * thermalY) * 1.2);
      actor.heat = clamp(actor.baseHeat * 0.52 + localWarmth * 0.48, 0, 1);

      if (actor.profile.frameRate > 0 && actor.frameCount > 1) {
        actor.animationClock = (
          actor.animationClock + deltaSeconds * actor.profile.frameRate * actor.animationRate
        ) % actor.frameCount;
        this._setSpriteFrame(actor, Math.floor(actor.animationClock));
      }

      const pointerDistance = this.pointer.active
        ? Math.hypot(actor.x - this.pointer.x, actor.y - this.pointer.y)
        : Number.POSITIVE_INFINITY;
      const pointerPressure = actor.kind === 'benthic'
        ? clamp(1 - pointerDistance / (this.pointerRadius * 0.72), 0, 1)
        : 0;
      const retreatDirection = Math.sign(actor.x - this.pointer.x || actor.facing);
      const retreatX = retreatDirection * pointerPressure * 12 * sceneScale;
      const groundBob = actor.kind === 'benthic'
        ? Math.sin(time * 0.72 + actor.phase) * 1.1 * sceneScale
        : 0;
      const sway = actor.name.includes('tube-worms')
        ? Math.sin(time * 0.31 + actor.phase) * 0.012
        : 0;
      actor.node.style.transformOrigin = '50% 96.875%';
      actor.node.style.transform = `translate3d(${(actor.x + retreatX - actor.size * 0.5).toFixed(2)}px, ${(actor.y + groundBob - actor.size * 0.96875).toFixed(2)}px, 0) rotate(${(actor.tilt + sway).toFixed(4)}rad) scaleX(${actor.facing})`;
      actor.node.dataset.depth = actor.depth.toFixed(3);
      this._applySceneGrade(actor);
    }
  }

  _updateDepthStacks() {
    // Opacity is not a depth cue: overlapping animals must remain solid. Sort
    // every paint plane by exact depth; creation order resolves true ties.
    for (const layerName of Object.keys(this.layers)) {
      const siblings = [...this.fish, ...this.groundActors]
        .filter((fish) => fish.layerName === layerName)
        .sort((left, right) => left.depth - right.depth || left.stackId - right.stackId);
      for (let index = 0; index < siblings.length; index += 1) {
        const fish = siblings[index];
        // Quantized absolute depth keeps independently managed opaque divers
        // and fish in one compatible paint order inside the shared layer.
        const stackOrder = Math.round(fish.depth * 10000) + index;
        if (stackOrder === fish.stackOrder) continue;
        fish.stackOrder = stackOrder;
        fish.node.style.zIndex = String(stackOrder);
        fish.node.dataset.depthStack = String(stackOrder);
      }
    }
  }

  _applySceneGrade(fish) {
    const heat = fish.heat;
    if (fish.kind) {
      const waterHaze = clamp((1.04 - fish.depth) / 0.72, 0, 1);
      const habitatDim = fish.kind === 'habitat' ? 0.06 : 0;
      const fogDim = waterHaze * 0.09;
      fish.node.style.opacity = (fish.baseOpacity * fish.layoutAttenuation * (0.8 + fish.depth * 0.2)).toFixed(3);
      fish.node.style.setProperty('--fauna-blur', `${(waterHaze * 1.18).toFixed(3)}px`);
      fish.node.style.setProperty('--fauna-brightness', (0.46 + fish.depth * 0.22 + heat * 0.09 - habitatDim - fogDim).toFixed(3));
      fish.node.style.setProperty('--fauna-saturation', (0.39 + fish.depth * 0.25 + heat * 0.1).toFixed(3));
      fish.node.style.setProperty('--fauna-contrast', (0.86 + fish.depth * 0.1).toFixed(3));
      fish.node.style.setProperty('--cyan-light', (waterHaze * 0.16).toFixed(3));
      fish.node.style.setProperty('--cyan-glow-size', `${(2 + waterHaze * 5).toFixed(2)}px`);
      fish.node.style.setProperty('--fauna-sepia', (heat * 0.08).toFixed(3));
      fish.node.style.setProperty('--lava-light', (heat * 0.18).toFixed(3));
      fish.node.style.setProperty('--lava-glow-size', `${(2 + heat * 6).toFixed(2)}px`);
      return;
    }
    const speciesDim = fish.speciesName === 'eelpout' ? 0.12 : 0;
    fish.node.style.setProperty('--fauna-blur', `${((1.06 - fish.depth) * 0.72).toFixed(3)}px`);
    fish.node.style.setProperty('--fauna-brightness', (0.68 + fish.depth * 0.24 + heat * 0.38 - speciesDim).toFixed(3));
    fish.node.style.setProperty('--fauna-saturation', (0.62 + fish.depth * 0.34 + heat * 0.22).toFixed(3));
    fish.node.style.setProperty('--fauna-contrast', '1');
    fish.node.style.setProperty('--cyan-light', '0');
    fish.node.style.setProperty('--fauna-sepia', (heat * 0.26).toFixed(3));
    fish.node.style.setProperty('--lava-light', (heat * 0.62).toFixed(3));
    fish.node.style.setProperty('--lava-glow-size', `${(2 + heat * 15).toFixed(2)}px`);
  }

  _simulate(deltaSeconds, timestamp) {
    const vent = this.ventProjection();
    const margin = 150;
    const time = timestamp * 0.001;

    if (this.pointer.active && performance.now() - this.pointer.lastAt > this.pointerIdleMs) {
      this.pointer.active = false;
    }
    for (const fish of this.fish) this._updateDepth(fish, deltaSeconds, time);
    this._updateGroundActors(deltaSeconds, time, vent);
    this._updateDepthStacks();

    for (const fish of this.fish) {
      const acceleration = { x: 0, y: 0 };
      this._applySchooling(fish, acceleration);
      this._applyAvoidance(fish, acceleration, vent);
      this._applySceneGrade(fish);

      const current = Math.sin(time * 0.16 + fish.phase + fish.y * 0.004) * 2.6;
      const depthBand = fish.bottomResident
        ? this.height * (0.77 + 0.11 * (0.5 + 0.5 * Math.sin(fish.phase * 1.7)))
        : this.height * (0.12 + 0.28 * (0.5 + 0.5 * Math.sin(fish.phase * 1.7)));
      const individualWander = time * fish.wanderRate + fish.wanderPhase;
      acceleration.x += current + Math.sin(individualWander * 0.73) * 1.35;
      acceleration.y += (depthBand - fish.y) * 0.0025 + Math.cos(individualWander) * 1.8;
      if (fish.bottomResident) {
        const shelfCenter = this.width * (fish.rockZone === 'left-shelf' ? 0.2 : 0.8);
        acceleration.x += (shelfCenter - fish.x) * 0.0045;
      }

      fish.vx += acceleration.x * deltaSeconds;
      fish.vy += acceleration.y * deltaSeconds;
      const speed = Math.max(0.001, length(fish.vx, fish.vy));
      const desiredMinimum = fish.profile.minSpeed * fish.cruiseScale * (0.82 + fish.depth * 0.24);
      const desiredMaximum = fish.profile.maxSpeed * fish.cruiseScale * (0.82 + fish.depth * 0.28);
      const clampedSpeed = clamp(speed, desiredMinimum, desiredMaximum);
      const steeringBlend = clamp(fish.profile.turnRate * fish.turnScale * deltaSeconds, 0, 1);
      fish.vx += ((fish.vx / speed) * clampedSpeed - fish.vx) * steeringBlend;
      fish.vy += ((fish.vy / speed) * clampedSpeed - fish.vy) * steeringBlend;

      fish.x += fish.vx * deltaSeconds;
      fish.y += fish.vy * deltaSeconds;
      if (fish.bottomResident) {
        const shelfLeft = this.width * (fish.rockZone === 'left-shelf' ? 0.06 : 0.68);
        const shelfRight = this.width * (fish.rockZone === 'left-shelf' ? 0.34 : 0.94);
        if (fish.x < shelfLeft && fish.vx < 0) fish.vx = Math.abs(fish.vx) * 0.82;
        else if (fish.x > shelfRight && fish.vx > 0) fish.vx = -Math.abs(fish.vx) * 0.82;
        fish.x = clamp(fish.x, shelfLeft - fish.size * 0.2, shelfRight + fish.size * 0.2);
        fish.y = clamp(fish.y, this.height * 0.68, this.height * 0.94);
      } else {
        if (fish.x < -margin) fish.x = this.width + margin;
        else if (fish.x > this.width + margin) fish.x = -margin;
        fish.y = clamp(fish.y, -fish.size * 0.18, this.height * 0.46 + fish.size * 0.18);
      }
      if (fish.y <= 0 && fish.vy < 0) fish.vy = Math.abs(fish.vy) * 0.72;
      if (fish.y >= this.height && fish.vy > 0) fish.vy = -Math.abs(fish.vy) * 0.72;

      const swimRate = 0.72 + clampedSpeed / Math.max(1, fish.profile.maxSpeed) * 0.48;
      fish.animationClock = (
        fish.animationClock + deltaSeconds * fish.profile.frameRate * fish.animationRate * swimRate
      ) % fish.frameCount;
      this._setSpriteFrame(fish, Math.floor(fish.animationClock));

      const facing = fish.vx >= 0 ? 1 : -1;
      const naturalTilt = Math.sin(time * fish.bobRate + fish.wanderPhase) * (fish.speciesName === 'sculpin' ? 0.055 : 0.032);
      const pitchLimit = fish.speciesName === 'sculpin' ? 0.34 : 0.25;
      const pitch = clamp(Math.atan2(fish.vy, Math.abs(fish.vx)) + fish.pitchBias + naturalTilt, -pitchLimit, pitchLimit);
      const bob = Math.sin(time * fish.bobRate + fish.phase) * fish.bobAmplitude * fish.depth;
      fish.displayY = fish.y + bob;
      fish.node.style.transform = `translate3d(${(fish.x - fish.size * 0.5).toFixed(2)}px, ${(fish.y + bob - fish.size * 0.5).toFixed(2)}px, 0) rotate(${(pitch * facing).toFixed(4)}rad) scaleX(${facing})`;
    }
  }

  _tick(timestamp) {
    if (this.destroyed) return;
    this.frameHandle = requestAnimationFrame(this._tick);
    if (this.paused || !this.sceneActive) return;
    const targetFrameMs = 1000 / this.targetFps;
    if (timestamp - this.lastSimulationTimestamp < targetFrameMs) return;
    const deltaSeconds = this.lastTimestamp > 0 ? clamp((timestamp - this.lastTimestamp) * 0.001, 0.001, 0.05) : targetFrameMs * 0.001;
    this.lastTimestamp = timestamp;
    this.lastSimulationTimestamp = timestamp;
    this._simulate(deltaSeconds, timestamp);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.frameHandle);
    removeEventListener('pointermove', this._onPointerMove);
    removeEventListener('pointerout', this._onPointerLeave);
    removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    for (const fish of this.fish) fish.node.remove();
    for (const actor of this.groundActors) actor.node.remove();
    this.fish.length = 0;
    this.groundActors.length = 0;
    delete document.documentElement.dataset.faunaCount;
    delete document.documentElement.dataset.bottomResidentCount;
    delete document.documentElement.dataset.ecosystemCount;
    delete document.documentElement.dataset.abyssalEcosystem;
    console.info('[AbyssalFauna] Field destroyed.');
  }
}

export function startAbyssalFaunaField(layers, options = {}) {
  return new AbyssalFaunaField(layers, options).init();
}
