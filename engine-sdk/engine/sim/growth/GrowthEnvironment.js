// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  GROWTH_SCHEMAS,
  GROWTH_SCHEMA_VERSION,
  assertGrowthKeys,
  compareGrowthIds,
  failGrowth,
  freezeGrowthJson,
  normalizeGrowthUnitVector,
  normalizeGrowthVector3,
  quantizeGrowthNumber,
  requireGrowthIdentifier,
  requireGrowthInteger,
  requireGrowthNumber,
  requireGrowthPlainObject,
} from './GrowthContracts.js';
import {
  growthVectorAdd,
  growthVectorDistance,
  growthVectorDot,
  growthVectorLength,
  growthVectorNormalize,
  growthVectorScale,
  growthVectorSubtract,
} from './GrowthState.js';

const ENVIRONMENT_KEYS = [
  'schema', 'version', 'id', 'revision', 'season', 'gravity', 'tropisms',
  'ambientLight', 'directionalLights', 'pointLights', 'resourceFields',
  'obstacles', 'baseResources', 'climate',
];

export function resolveGrowthSeason(input = {}) {
  requireGrowthPlainObject(input, 'environment.season');
  assertGrowthKeys(input, ['year', 'phase', 'name', 'growthFactor', 'leafFactor'], 'environment.season');
  const phase = requireGrowthNumber(input.phase ?? 0.3, 'environment.season.phase', { minimum: 0, maximum: 1 });
  const expectedName = phase < 0.2 ? 'dormant' : phase < 0.45 ? 'spring' : phase < 0.75 ? 'summer' : 'autumn';
  const name = String(input.name ?? expectedName);
  if (!['dormant', 'spring', 'summer', 'autumn'].includes(name)) {
    failGrowth('GROWTH_SEASON_NAME', `Unsupported growth season '${name}'`);
  }
  const defaults = {
    dormant: [0.05, 0],
    spring: [1, 0.85],
    summer: [0.8, 1],
    autumn: [0.25, 0.35],
  }[name];
  return Object.freeze({
    year: requireGrowthInteger(input.year ?? 0, 'environment.season.year'),
    phase,
    name,
    growthFactor: requireGrowthNumber(input.growthFactor ?? defaults[0], 'environment.season.growthFactor', { minimum: 0, maximum: 2 }),
    leafFactor: requireGrowthNumber(input.leafFactor ?? defaults[1], 'environment.season.leafFactor', { minimum: 0, maximum: 1 }),
  });
}

function normalizeTropisms(input = {}) {
  requireGrowthPlainObject(input, 'environment.tropisms');
  assertGrowthKeys(input, [
    'phototropism', 'gravitropism', 'rootGravitropism', 'hydrotropism', 'thigmotropism', 'inertia',
  ], 'environment.tropisms');
  return Object.freeze({
    phototropism: requireGrowthNumber(input.phototropism ?? 0.35, 'environment.tropisms.phototropism', { minimum: 0, maximum: 4 }),
    gravitropism: requireGrowthNumber(input.gravitropism ?? 0.2, 'environment.tropisms.gravitropism', { minimum: -4, maximum: 4 }),
    rootGravitropism: requireGrowthNumber(input.rootGravitropism ?? 0.8, 'environment.tropisms.rootGravitropism', { minimum: -4, maximum: 4 }),
    hydrotropism: requireGrowthNumber(input.hydrotropism ?? 0.35, 'environment.tropisms.hydrotropism', { minimum: 0, maximum: 4 }),
    thigmotropism: requireGrowthNumber(input.thigmotropism ?? 1.2, 'environment.tropisms.thigmotropism', { minimum: 0, maximum: 8 }),
    inertia: requireGrowthNumber(input.inertia ?? 1, 'environment.tropisms.inertia', { minimum: 0, maximum: 8 }),
  });
}

function normalizeLight(input, index, kind) {
  const path = `environment.${kind}Lights[${index}]`;
  requireGrowthPlainObject(input, path);
  if (kind === 'directional') {
    assertGrowthKeys(input, ['id', 'direction', 'intensity'], path);
    return Object.freeze({
      id: requireGrowthIdentifier(input.id, `${path}.id`),
      direction: normalizeGrowthUnitVector(input.direction, `${path}.direction`, [0, -1, 0]),
      intensity: requireGrowthNumber(input.intensity ?? 1, `${path}.intensity`, { minimum: 0 }),
    });
  }
  assertGrowthKeys(input, ['id', 'position', 'intensity', 'range'], path);
  return Object.freeze({
    id: requireGrowthIdentifier(input.id, `${path}.id`),
    position: normalizeGrowthVector3(input.position, `${path}.position`),
    intensity: requireGrowthNumber(input.intensity ?? 1, `${path}.intensity`, { minimum: 0 }),
    range: requireGrowthNumber(input.range ?? 20, `${path}.range`, { strictlyPositive: true }),
  });
}

function normalizeResourceField(input, index) {
  const path = `environment.resourceFields[${index}]`;
  requireGrowthPlainObject(input, path);
  assertGrowthKeys(input, ['id', 'position', 'radius', 'water', 'nutrients'], path);
  return Object.freeze({
    id: requireGrowthIdentifier(input.id, `${path}.id`),
    position: normalizeGrowthVector3(input.position, `${path}.position`),
    radius: requireGrowthNumber(input.radius ?? 5, `${path}.radius`, { strictlyPositive: true }),
    water: requireGrowthNumber(input.water ?? 0, `${path}.water`, { minimum: 0 }),
    nutrients: requireGrowthNumber(input.nutrients ?? 0, `${path}.nutrients`, { minimum: 0 }),
  });
}

function normalizeObstacle(input, index) {
  const path = `environment.obstacles[${index}]`;
  requireGrowthPlainObject(input, path);
  const kind = String(input.kind ?? 'sphere');
  if (kind === 'sphere') {
    assertGrowthKeys(input, ['id', 'kind', 'center', 'radius', 'clearance'], path);
    return Object.freeze({
      id: requireGrowthIdentifier(input.id, `${path}.id`),
      kind,
      center: normalizeGrowthVector3(input.center, `${path}.center`),
      radius: requireGrowthNumber(input.radius, `${path}.radius`, { strictlyPositive: true }),
      clearance: requireGrowthNumber(input.clearance ?? 0, `${path}.clearance`, { minimum: 0 }),
    });
  }
  if (kind === 'aabb') {
    assertGrowthKeys(input, ['id', 'kind', 'min', 'max', 'clearance'], path);
    const min = normalizeGrowthVector3(input.min, `${path}.min`);
    const max = normalizeGrowthVector3(input.max, `${path}.max`);
    for (let axis = 0; axis < 3; axis++) {
      if (!(min[axis] < max[axis])) failGrowth('GROWTH_OBSTACLE_BOUNDS', `${path}.min must be less than max on every axis`);
    }
    return Object.freeze({
      id: requireGrowthIdentifier(input.id, `${path}.id`),
      kind,
      min,
      max,
      clearance: requireGrowthNumber(input.clearance ?? 0, `${path}.clearance`, { minimum: 0 }),
    });
  }
  failGrowth('GROWTH_OBSTACLE_KIND', `${path}.kind '${kind}' is unsupported`);
}

function uniqueSorted(entries, label) {
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) failGrowth('GROWTH_DUPLICATE_ENVIRONMENT_ID', `Duplicate ${label} id '${entry.id}'`);
    ids.add(entry.id);
  }
  return entries.sort((left, right) => compareGrowthIds(left.id, right.id));
}

export function normalizeGrowthEnvironment(input = {}) {
  requireGrowthPlainObject(input, 'environment');
  assertGrowthKeys(input, ENVIRONMENT_KEYS, 'environment');
  if ((input.schema ?? GROWTH_SCHEMAS.environment) !== GROWTH_SCHEMAS.environment
      || Number(input.version ?? GROWTH_SCHEMA_VERSION) !== GROWTH_SCHEMA_VERSION) {
    failGrowth('GROWTH_ENVIRONMENT_VERSION', `Expected ${GROWTH_SCHEMAS.environment} v${GROWTH_SCHEMA_VERSION}`);
  }
  const directionalLights = input.directionalLights ?? [{ id: 'sun', direction: [-0.25, -1, -0.15], intensity: 1 }];
  const pointLights = input.pointLights ?? [];
  const resourceFields = input.resourceFields ?? [];
  const obstacles = input.obstacles ?? [];
  if (![directionalLights, pointLights, resourceFields, obstacles].every(Array.isArray)) {
    failGrowth('GROWTH_ENVIRONMENT_ARRAY', 'Environment light, resource, and obstacle collections must be arrays');
  }
  const baseResources = input.baseResources ?? {};
  requireGrowthPlainObject(baseResources, 'environment.baseResources');
  assertGrowthKeys(baseResources, ['water', 'nutrients'], 'environment.baseResources');
  const climate = input.climate ?? {};
  requireGrowthPlainObject(climate, 'environment.climate');
  assertGrowthKeys(climate, ['temperatureC', 'precipitation', 'wind'], 'environment.climate');
  return Object.freeze({
    schema: GROWTH_SCHEMAS.environment,
    version: GROWTH_SCHEMA_VERSION,
    id: requireGrowthIdentifier(input.id ?? 'growth.environment.default', 'environment.id'),
    revision: requireGrowthIdentifier(input.revision ?? 'growth.environment.default.v1', 'environment.revision'),
    season: resolveGrowthSeason(input.season),
    gravity: normalizeGrowthUnitVector(input.gravity, 'environment.gravity', [0, -1, 0]),
    tropisms: normalizeTropisms(input.tropisms),
    ambientLight: requireGrowthNumber(input.ambientLight ?? 0.15, 'environment.ambientLight', { minimum: 0 }),
    directionalLights: Object.freeze(uniqueSorted(directionalLights.map((light, index) => normalizeLight(light, index, 'directional')), 'directional light')),
    pointLights: Object.freeze(uniqueSorted(pointLights.map((light, index) => normalizeLight(light, index, 'point')), 'point light')),
    resourceFields: Object.freeze(uniqueSorted(resourceFields.map(normalizeResourceField), 'resource field')),
    obstacles: Object.freeze(uniqueSorted(obstacles.map(normalizeObstacle), 'obstacle')),
    baseResources: Object.freeze({
      water: requireGrowthNumber(baseResources.water ?? 0.5, 'environment.baseResources.water', { minimum: 0 }),
      nutrients: requireGrowthNumber(baseResources.nutrients ?? 0.5, 'environment.baseResources.nutrients', { minimum: 0 }),
    }),
    climate: Object.freeze({
      temperatureC: requireGrowthNumber(climate.temperatureC ?? 18, 'environment.climate.temperatureC', { minimum: -100, maximum: 100 }),
      precipitation: requireGrowthNumber(climate.precipitation ?? 0.5, 'environment.climate.precipitation', { minimum: 0 }),
      wind: normalizeGrowthVector3(climate.wind, 'environment.climate.wind', [0, 0, 0]),
    }),
  });
}

function competitionOcclusion(position, competitors) {
  let occlusion = 0;
  const sorted = [...competitors].sort((left, right) => compareGrowthIds(left.id, right.id));
  for (const competitor of sorted) {
    if (!competitor || !Array.isArray(competitor.position) || competitor.position.length !== 3) continue;
    const radius = Math.max(0, Number(competitor.radius ?? competitor.size ?? 0));
    const vertical = competitor.position[1] - position[1];
    if (vertical <= 0) continue;
    const horizontal = Math.hypot(competitor.position[0] - position[0], competitor.position[2] - position[2]);
    const influence = radius + vertical * 0.2;
    if (horizontal < influence && influence > 0) occlusion += (1 - horizontal / influence) * Math.min(1, vertical / (radius + 1));
  }
  return Math.min(0.95, quantizeGrowthNumber(occlusion));
}

export function sampleGrowthLight(environmentInput, positionInput, { competitors = [] } = {}) {
  const environment = normalizeGrowthEnvironment(environmentInput);
  const position = normalizeGrowthVector3(positionInput, 'light sample position');
  if (!Array.isArray(competitors)) failGrowth('GROWTH_LIGHT_COMPETITORS', 'Light competitors must be an array');
  let intensity = environment.ambientLight;
  let direction = [0, 0, 0];
  for (const light of environment.directionalLights) {
    const towardLight = growthVectorScale(light.direction, -1);
    direction = growthVectorAdd(direction, growthVectorScale(towardLight, light.intensity));
    intensity += light.intensity;
  }
  for (const light of environment.pointLights) {
    const offset = growthVectorSubtract(light.position, position);
    const distance = growthVectorLength(offset);
    if (distance >= light.range) continue;
    const attenuation = light.intensity * (1 - distance / light.range) ** 2;
    direction = growthVectorAdd(direction, growthVectorScale(growthVectorNormalize(offset), attenuation));
    intensity += attenuation;
  }
  const occlusion = competitionOcclusion(position, competitors);
  return freezeGrowthJson({
    intensity: quantizeGrowthNumber(intensity * (1 - occlusion)),
    direction: growthVectorNormalize(direction, [0, 1, 0]),
    occlusion,
  }, '$.lightSample');
}

export function sampleGrowthResources(environmentInput, positionInput) {
  const environment = normalizeGrowthEnvironment(environmentInput);
  const position = normalizeGrowthVector3(positionInput, 'resource sample position');
  let water = environment.baseResources.water + environment.climate.precipitation;
  let nutrients = environment.baseResources.nutrients;
  let gradient = [0, 0, 0];
  for (const field of environment.resourceFields) {
    const offset = growthVectorSubtract(field.position, position);
    const distance = growthVectorLength(offset);
    if (distance >= field.radius) continue;
    const weight = 1 - distance / field.radius;
    water += field.water * weight;
    nutrients += field.nutrients * weight;
    gradient = growthVectorAdd(gradient, growthVectorScale(growthVectorNormalize(offset, [0, -1, 0]), weight * (field.water + field.nutrients)));
  }
  return freezeGrowthJson({
    water: quantizeGrowthNumber(water),
    nutrients: quantizeGrowthNumber(nutrients),
    direction: growthVectorNormalize(gradient, [0, -1, 0]),
  }, '$.resourceSample');
}

function closestPointAabb(point, obstacle) {
  return [0, 1, 2].map(axis => Math.max(obstacle.min[axis], Math.min(obstacle.max[axis], point[axis])));
}

function obstaclePenetration(point, obstacle, radius) {
  if (obstacle.kind === 'sphere') {
    const offset = growthVectorSubtract(point, obstacle.center);
    const distance = growthVectorLength(offset);
    const combined = obstacle.radius + obstacle.clearance + radius;
    return distance < combined ? { depth: combined - distance, normal: growthVectorNormalize(offset, [1, 0, 0]) } : null;
  }
  const clearance = obstacle.clearance + radius;
  const expanded = {
    min: obstacle.min.map(value => value - clearance),
    max: obstacle.max.map(value => value + clearance),
  };
  const inside = [0, 1, 2].every(axis => point[axis] >= expanded.min[axis] && point[axis] <= expanded.max[axis]);
  if (!inside) {
    const closest = closestPointAabb(point, expanded);
    const distance = growthVectorDistance(point, closest);
    return distance < 1e-6 ? null : null;
  }
  const candidates = [];
  for (let axis = 0; axis < 3; axis++) {
    candidates.push({ depth: point[axis] - expanded.min[axis], normal: [0, 0, 0] });
    candidates[candidates.length - 1].normal[axis] = -1;
    candidates.push({ depth: expanded.max[axis] - point[axis], normal: [0, 0, 0] });
    candidates[candidates.length - 1].normal[axis] = 1;
  }
  candidates.sort((left, right) => left.depth - right.depth);
  return candidates[0];
}

export function queryGrowthObstacle(environmentInput, startInput, endInput, { radius = 0, samples = 8 } = {}) {
  const environment = normalizeGrowthEnvironment(environmentInput);
  const start = normalizeGrowthVector3(startInput, 'obstacle query start');
  const end = normalizeGrowthVector3(endInput, 'obstacle query end');
  const sampleCount = requireGrowthInteger(samples, 'obstacle query samples', { minimum: 1, maximum: 64 });
  const branchRadius = requireGrowthNumber(radius, 'obstacle query radius', { minimum: 0 });
  let best = null;
  for (const obstacle of environment.obstacles) {
    for (let index = 0; index <= sampleCount; index++) {
      const t = index / sampleCount;
      const point = [0, 1, 2].map(axis => quantizeGrowthNumber(start[axis] + (end[axis] - start[axis]) * t));
      const hit = obstaclePenetration(point, obstacle, branchRadius);
      if (!hit) continue;
      const candidate = { obstacleId: obstacle.id, t: quantizeGrowthNumber(t), depth: quantizeGrowthNumber(hit.depth), normal: growthVectorNormalize(hit.normal) };
      if (!best || candidate.t < best.t || (candidate.t === best.t && compareGrowthIds(candidate.obstacleId, best.obstacleId) < 0)) best = candidate;
      break;
    }
  }
  return best ? freezeGrowthJson(best, '$.obstacleHit') : null;
}

export function steerGrowthDirection(environmentInput, {
  position,
  direction,
  kind = 'branch',
  competitors = [],
} = {}) {
  const environment = normalizeGrowthEnvironment(environmentInput);
  const origin = normalizeGrowthVector3(position, 'steering position');
  const desired = normalizeGrowthUnitVector(direction, 'steering direction');
  const light = sampleGrowthLight(environment, origin, { competitors });
  const resources = sampleGrowthResources(environment, origin);
  const tropisms = environment.tropisms;
  let steered = growthVectorScale(desired, tropisms.inertia);
  if (kind === 'root') {
    steered = growthVectorAdd(steered, growthVectorScale(environment.gravity, tropisms.rootGravitropism));
    steered = growthVectorAdd(steered, growthVectorScale(resources.direction, tropisms.hydrotropism));
  } else {
    steered = growthVectorAdd(steered, growthVectorScale(light.direction, tropisms.phototropism));
    steered = growthVectorAdd(steered, growthVectorScale(environment.gravity, -tropisms.gravitropism));
  }
  return freezeGrowthJson({ direction: growthVectorNormalize(steered, desired), light, resources }, '$.steering');
}

export function evaluateGrowthSegment(environmentInput, {
  start,
  direction,
  length,
  radius = 0.01,
  kind = 'branch',
  competitors = [],
} = {}) {
  const environment = normalizeGrowthEnvironment(environmentInput);
  const origin = normalizeGrowthVector3(start, 'segment start');
  const segmentLength = requireGrowthNumber(length, 'segment length', { strictlyPositive: true });
  const segmentRadius = requireGrowthNumber(radius, 'segment radius', { strictlyPositive: true });
  const steering = steerGrowthDirection(environment, { position: origin, direction, kind, competitors });
  let steeredDirection = steering.direction;
  let end = growthVectorAdd(origin, growthVectorScale(steeredDirection, segmentLength));
  let obstacle = queryGrowthObstacle(environment, origin, end, { radius: segmentRadius });
  if (obstacle) {
    steeredDirection = growthVectorNormalize(growthVectorAdd(
      steeredDirection,
      growthVectorScale(obstacle.normal, environment.tropisms.thigmotropism),
    ), steeredDirection);
    end = growthVectorAdd(origin, growthVectorScale(steeredDirection, segmentLength));
    const redirectedHit = queryGrowthObstacle(environment, origin, end, { radius: segmentRadius });
    if (redirectedHit) {
      return freezeGrowthJson({ allowed: false, start: origin, end, direction: steeredDirection, obstacle: redirectedHit, light: steering.light, resources: steering.resources }, '$.segmentEvaluation');
    }
  }
  return freezeGrowthJson({ allowed: true, start: origin, end, direction: steeredDirection, obstacle, light: steering.light, resources: steering.resources }, '$.segmentEvaluation');
}

export function snapshotGrowthEnvironment(environment) {
  return freezeGrowthJson(normalizeGrowthEnvironment(environment), '$.environmentSnapshot');
}

