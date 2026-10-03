// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  GROWTH_LIMITS,
  GROWTH_PROGRAM_IDS,
  failGrowth,
  freezeGrowthJson,
  requireGrowthIdentifier,
  requireGrowthInteger,
  requireGrowthNumber,
  validateGrowthStepTiming,
} from '../GrowthContracts.js';
import { evaluateGrowthSegment, normalizeGrowthEnvironment } from '../GrowthEnvironment.js';
import {
  GrowthRngStreams,
  deriveGrowthEntityId,
  deriveGrowthLineage,
  restoreGrowthRngStreams,
} from '../GrowthLineageRng.js';
import {
  commitGrowthStep,
  createGrowthBudgetStall,
  createInitialGrowthState,
  growthVectorAdd,
  growthVectorCross,
  growthVectorDot,
  growthVectorNormalize,
  growthVectorScale,
  hashGrowthState,
  normalizeGrowthState,
  restoreGrowthState,
  snapshotGrowthState,
} from '../GrowthState.js';

const PROGRAM_VERSION = 1;
const SYMBOLS = new Set(['F', 'G', 'L', 'O', '+', '-', '&', '^', '\\', '/', '|', '[', ']', '!']);
const PARAMETER_EXPRESSION = /^\$(\d+)(?:([+*/-])(-?(?:\d+(?:\.\d*)?|\.\d+)))?$/u;
const NUMBER_EXPRESSION = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/u;

function tokenize(text, { expressions = false } = {}) {
  if (typeof text !== 'string' || text.length === 0) failGrowth('GROWTH_LSYSTEM_TEXT', 'L-system source must be a non-empty string');
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const symbol = text[index];
    if (/\s/u.test(symbol)) { index += 1; continue; }
    if (!SYMBOLS.has(symbol)) failGrowth('GROWTH_LSYSTEM_SYMBOL', `Unsupported L-system symbol '${symbol}' at ${index}`);
    index += 1;
    const parameters = [];
    if (text[index] === '(') {
      const close = text.indexOf(')', index + 1);
      if (close < 0) failGrowth('GROWTH_LSYSTEM_PARAMETER', `Unclosed parameter list after '${symbol}'`);
      const body = text.slice(index + 1, close).trim();
      if (body.length > 0) {
        for (const raw of body.split(',').map(value => value.trim())) {
          if (expressions) {
            if (!NUMBER_EXPRESSION.test(raw) && !PARAMETER_EXPRESSION.test(raw)) {
              failGrowth('GROWTH_LSYSTEM_EXPRESSION', `Unsupported parameter expression '${raw}'`);
            }
            parameters.push(raw);
          } else {
            parameters.push(requireGrowthNumber(Number(raw), `L-system ${symbol} parameter`));
          }
        }
      }
      index = close + 1;
    }
    tokens.push({ symbol, parameters });
  }
  return tokens;
}

function evaluateExpression(expression, predecessorParameters) {
  if (NUMBER_EXPRESSION.test(expression)) return requireGrowthNumber(Number(expression), 'L-system literal');
  const match = PARAMETER_EXPRESSION.exec(expression);
  if (!match) failGrowth('GROWTH_LSYSTEM_EXPRESSION', `Invalid expression '${expression}'`);
  const parameterIndex = Number(match[1]);
  if (parameterIndex >= predecessorParameters.length) {
    failGrowth('GROWTH_LSYSTEM_PARAMETER_INDEX', `Expression '${expression}' references a missing predecessor parameter`);
  }
  const left = predecessorParameters[parameterIndex];
  if (!match[2]) return left;
  const right = Number(match[3]);
  let result;
  switch (match[2]) {
    case '+': result = left + right; break;
    case '-': result = left - right; break;
    case '*': result = left * right; break;
    case '/':
      if (right === 0) failGrowth('GROWTH_LSYSTEM_DIVIDE_ZERO', `Expression '${expression}' divides by zero`);
      result = left / right;
      break;
    default: failGrowth('GROWTH_LSYSTEM_EXPRESSION', `Invalid operator in '${expression}'`);
  }
  return requireGrowthNumber(result, `L-system expression ${expression}`);
}

function expandWord(axiom, rules, generations) {
  let word = tokenize(axiom);
  for (let generation = 0; generation < generations; generation++) {
    const next = [];
    for (const token of word) {
      const successor = rules.get(token.symbol);
      if (!successor) {
        next.push(token);
      } else {
        for (const output of successor) {
          next.push({
            symbol: output.symbol,
            parameters: output.parameters.map(expression => evaluateExpression(expression, token.parameters)),
          });
        }
      }
      if (next.length > GROWTH_LIMITS.MAX_LSYSTEM_SYMBOLS) {
        failGrowth('GROWTH_LSYSTEM_SYMBOL_LIMIT', `L-system expansion exceeds ${GROWTH_LIMITS.MAX_LSYSTEM_SYMBOLS} symbols`);
      }
    }
    word = next;
  }
  let stackDepth = 0;
  let maximumDepth = 0;
  for (const token of word) {
    if (token.symbol === '[') maximumDepth = Math.max(maximumDepth, ++stackDepth);
    if (token.symbol === ']' && --stackDepth < 0) failGrowth('GROWTH_LSYSTEM_STACK', 'L-system word closes a branch stack that was never opened');
  }
  if (stackDepth !== 0) failGrowth('GROWTH_LSYSTEM_STACK', 'L-system word leaves branch stacks open');
  if (maximumDepth > GROWTH_LIMITS.MAX_TURTLE_STACK_DEPTH) {
    failGrowth('GROWTH_LSYSTEM_STACK_LIMIT', `L-system stack exceeds ${GROWTH_LIMITS.MAX_TURTLE_STACK_DEPTH}`);
  }
  return word;
}

function rotate(vector, axis, angle) {
  const unitAxis = growthVectorNormalize(axis);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return growthVectorNormalize(growthVectorAdd(
    growthVectorAdd(
      growthVectorScale(vector, cosine),
      growthVectorScale(growthVectorCross(unitAxis, vector), sine),
    ),
    growthVectorScale(unitAxis, growthVectorDot(unitAxis, vector) * (1 - cosine)),
  ), vector);
}

function rotateTurtle(turtle, axisName, angle) {
  const axis = turtle[axisName];
  for (const key of ['forward', 'right', 'up']) {
    if (key !== axisName) turtle[key] = rotate(turtle[key], axis, angle);
  }
}

function cloneTurtle(turtle) {
  return JSON.parse(JSON.stringify(turtle));
}

function normalizeRules(input) {
  const rules = input ?? [{
    predecessor: 'F',
    successor: 'F($0*0.92)[+(0.45)F($0*0.72)L(0.12)][-(0.45)F($0*0.72)L(0.12)]',
  }];
  if (!Array.isArray(rules)) failGrowth('GROWTH_LSYSTEM_RULES', 'L-system rules must be an array');
  const map = new Map();
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index];
    if (!rule || typeof rule !== 'object') failGrowth('GROWTH_LSYSTEM_RULE', `Rule ${index} must be an object`);
    const predecessor = String(rule.predecessor ?? '');
    if (!SYMBOLS.has(predecessor) || predecessor.length !== 1) failGrowth('GROWTH_LSYSTEM_PREDECESSOR', `Rule ${index} predecessor is invalid`);
    if (map.has(predecessor)) failGrowth('GROWTH_LSYSTEM_DUPLICATE_RULE', `Duplicate rule for '${predecessor}'`);
    map.set(predecessor, tokenize(rule.successor, { expressions: true }));
  }
  return map;
}

export class ParametricLSystemProgram {
  constructor(options = {}) {
    this.id = GROWTH_PROGRAM_IDS.PARAMETRIC_LSYSTEM;
    this.version = PROGRAM_VERSION;
    this.label = 'Parametric L-system';
    this.options = freezeGrowthJson({
      axiom: String(options.axiom ?? 'F(0.55)'),
      rules: options.rules ?? [{ predecessor: 'F', successor: 'F($0*0.92)[+(0.45)F($0*0.72)L(0.12)][-(0.45)F($0*0.72)L(0.12)]' }],
      generations: requireGrowthInteger(options.generations ?? 4, 'L-system generations', { maximum: GROWTH_LIMITS.MAX_LSYSTEM_GENERATIONS }),
      initialRadius: requireGrowthNumber(options.initialRadius ?? 0.055, 'L-system initialRadius', { strictlyPositive: true }),
      radiusDecay: requireGrowthNumber(options.radiusDecay ?? 0.82, 'L-system radiusDecay', { minimum: 0.05, maximum: 1 }),
      angle: requireGrowthNumber(options.angle ?? 0.45, 'L-system angle', { minimum: 0, maximum: Math.PI }),
      maxNewPerTick: requireGrowthInteger(options.maxNewPerTick ?? 64, 'L-system maxNewPerTick', { minimum: 1, maximum: 128 }),
      jitter: requireGrowthNumber(options.jitter ?? 0.02, 'L-system jitter', { minimum: 0, maximum: 0.5 }),
    }, '$.lSystemOptions');
    // Validate syntax immediately; expansion remains seed/definition specific.
    tokenize(this.options.axiom);
    normalizeRules(this.options.rules);
  }

  initialize(definition = {}, seedOverride = undefined) {
    const assetId = requireGrowthIdentifier(definition.assetId ?? 'growth.lsystem.asset', 'assetId');
    const seed = requireGrowthInteger(seedOverride ?? definition.seed ?? 0, 'seed', { maximum: 0xffffffff });
    const environment = normalizeGrowthEnvironment(definition.environment ?? {});
    const axiom = String(definition.axiom ?? this.options.axiom);
    const rulesInput = definition.rules ?? this.options.rules;
    const generations = requireGrowthInteger(definition.generations ?? this.options.generations, 'L-system generations', { maximum: GROWTH_LIMITS.MAX_LSYSTEM_GENERATIONS });
    const rules = normalizeRules(rulesInput);
    const word = expandWord(axiom, rules, generations);
    const origin = Array.isArray(definition.origin) ? definition.origin : [0, 0, 0];
    const streams = new GrowthRngStreams({ assetSeed: seed, programId: this.id, programVersion: this.version });
    const turtle = {
      position: origin,
      forward: [0, 1, 0],
      right: [1, 0, 0],
      up: [0, 0, 1],
      parentId: null,
      parentLineage: null,
      nextOrdinal: 0,
      leafOrdinal: 0,
      fruitOrdinal: 0,
      radius: this.options.initialRadius,
    };
    const rootTurtle = {
      position: origin,
      forward: [0, -1, 0],
      right: [1, 0, 0],
      up: [0, 0, -1],
      parentId: null,
      parentLineage: null,
      nextOrdinal: 0,
      radius: this.options.initialRadius * 0.75,
    };
    return createInitialGrowthState({
      assetId,
      seed,
      programId: this.id,
      programVersion: this.version,
      environmentRevision: environment.revision,
      season: environment.season,
      rngStreams: streams.snapshot(),
      programState: {
        environment,
        axiom,
        rules: rulesInput,
        generations,
        word,
        cursor: 0,
        turtle,
        stack: [],
        rootTurtle,
        nextBranchOrdinalByParent: {},
        nextRootOrdinalByParent: {},
        nextLeafOrdinalByParent: {},
        nextFruitOrdinalByParent: {},
        completed: false,
      },
    });
  }

  step(stateInput, input = {}, budget = {}) {
    const state = this.restore(stateInput);
    validateGrowthStepTiming(state, input);
    const draft = JSON.parse(JSON.stringify(state));
    delete draft.stateHash;
    const environment = normalizeGrowthEnvironment(input.environment ?? draft.programState.environment);
    draft.programState.environment = environment;
    draft.environmentRevision = environment.revision;
    draft.season = environment.season;
    const streams = restoreGrowthRngStreams(state);
    const maximum = Math.min(
      this.options.maxNewPerTick,
      requireGrowthInteger(budget.maxNewEntities ?? GROWTH_LIMITS.MAX_NEW_ENTITIES_PER_TICK, 'budget.maxNewEntities', {
        minimum: 0,
        maximum: GROWTH_LIMITS.MAX_NEW_ENTITIES_PER_TICK,
      }),
    );
    const programState = draft.programState;
    const requested = programState.word.length - programState.cursor;
    if (maximum === 0 && requested > 0) {
      return createGrowthBudgetStall(state, { requested, programId: this.id, unit: 'symbols', telemetry: { cursor: programState.cursor } });
    }
    const turtle = programState.turtle;
    const rootTurtle = programState.rootTurtle;
    const events = [];
    let created = 0;
    let processed = 0;
    while (programState.cursor < programState.word.length && created < maximum && processed < 4096) {
      const token = programState.word[programState.cursor++];
      processed += 1;
      const value = token.parameters[0];
      switch (token.symbol) {
        case 'F': {
          const length = requireGrowthNumber(value ?? 0.25, 'L-system F length', { strictlyPositive: true });
          const ordinal = turtle.parentId === null
            ? 0
            : (programState.nextBranchOrdinalByParent[turtle.parentId] ?? 0);
          const lineage = turtle.parentLineage === null
            ? deriveGrowthLineage(null, 'root', 0)
            : deriveGrowthLineage(turtle.parentLineage, 'branch', ordinal);
          if (turtle.parentId !== null) programState.nextBranchOrdinalByParent[turtle.parentId] = ordinal + 1;
          const rng = streams.stream(lineage, 'turtle-jitter');
          const jittered = growthVectorNormalize(growthVectorAdd(turtle.forward, [
            rng.nextSignedFloat() * this.options.jitter,
            rng.nextSignedFloat() * this.options.jitter,
            rng.nextSignedFloat() * this.options.jitter,
          ]), turtle.forward);
          const evaluated = evaluateGrowthSegment(environment, {
            start: turtle.position,
            direction: jittered,
            length,
            radius: turtle.radius,
            kind: 'branch',
            competitors: draft.leaves.map(leaf => ({ id: leaf.id, position: leaf.position, radius: leaf.size })),
          });
          if (!evaluated.allowed) {
            events.push({ type: 'growth.obstacle-rejected', lineage, details: { obstacleId: evaluated.obstacle.obstacleId } });
            break;
          }
          const id = deriveGrowthEntityId('branch', lineage);
          draft.branches.push({
            id,
            lineage,
            parentId: turtle.parentId,
            kind: 'branch',
            start: turtle.position,
            end: evaluated.end,
            radius: turtle.radius,
            age: 0,
            vigor: Math.min(2, evaluated.light.intensity),
            resource: evaluated.resources.water + evaluated.resources.nutrients,
            active: true,
          });
          turtle.position = evaluated.end;
          turtle.forward = evaluated.direction;
          turtle.parentId = id;
          turtle.parentLineage = lineage;
          turtle.nextOrdinal = 0;
          turtle.leafOrdinal = 0;
          turtle.fruitOrdinal = 0;
          turtle.radius *= this.options.radiusDecay;
          created += 1;
          break;
        }
        case 'G': {
          const length = requireGrowthNumber(value ?? 0.2, 'L-system G length', { strictlyPositive: true });
          const ordinal = rootTurtle.parentId === null
            ? 0
            : (programState.nextRootOrdinalByParent[rootTurtle.parentId] ?? 0);
          const lineage = rootTurtle.parentLineage === null
            ? deriveGrowthLineage(null, 'root', 0)
            : deriveGrowthLineage(rootTurtle.parentLineage, 'root', ordinal);
          if (rootTurtle.parentId !== null) programState.nextRootOrdinalByParent[rootTurtle.parentId] = ordinal + 1;
          const evaluated = evaluateGrowthSegment(environment, {
            start: rootTurtle.position,
            direction: rootTurtle.forward,
            length,
            radius: rootTurtle.radius,
            kind: 'root',
          });
          if (!evaluated.allowed) {
            events.push({ type: 'growth.obstacle-rejected', lineage, details: { obstacleId: evaluated.obstacle.obstacleId } });
            break;
          }
          const id = deriveGrowthEntityId('root', lineage);
          draft.roots.push({
            id,
            lineage,
            parentId: rootTurtle.parentId,
            kind: 'root',
            start: rootTurtle.position,
            end: evaluated.end,
            radius: rootTurtle.radius,
            age: 0,
            vigor: 1,
            resource: evaluated.resources.water + evaluated.resources.nutrients,
            active: true,
          });
          rootTurtle.position = evaluated.end;
          rootTurtle.forward = evaluated.direction;
          rootTurtle.parentId = id;
          rootTurtle.parentLineage = lineage;
          rootTurtle.nextOrdinal = 0;
          rootTurtle.radius *= this.options.radiusDecay;
          created += 1;
          break;
        }
        case 'L':
          if (turtle.parentId !== null && environment.season.leafFactor > 0 && created < maximum) {
            const ordinal = programState.nextLeafOrdinalByParent[turtle.parentId] ?? 0;
            programState.nextLeafOrdinalByParent[turtle.parentId] = ordinal + 1;
            const lineage = deriveGrowthLineage(turtle.parentLineage, 'leaf', 10_000 + ordinal);
            draft.leaves.push({
              id: deriveGrowthEntityId('leaf', lineage), lineage, parentId: turtle.parentId,
              position: turtle.position, normal: turtle.up, size: (value ?? 0.1) * environment.season.leafFactor,
              age: 0, health: 1, active: true,
            });
            created += 1;
          }
          break;
        case 'O':
          if (turtle.parentId !== null && environment.season.name === 'summer' && created < maximum) {
            const ordinal = programState.nextFruitOrdinalByParent[turtle.parentId] ?? 0;
            programState.nextFruitOrdinalByParent[turtle.parentId] = ordinal + 1;
            const lineage = deriveGrowthLineage(turtle.parentLineage, 'fruit', 20_000 + ordinal);
            draft.fruits.push({
              id: deriveGrowthEntityId('fruit', lineage), lineage, parentId: turtle.parentId,
              position: turtle.position, size: value ?? 0.08, age: 0, ripeness: 0, health: 1, active: true,
            });
            created += 1;
          }
          break;
        case '+': rotateTurtle(turtle, 'up', value ?? this.options.angle); break;
        case '-': rotateTurtle(turtle, 'up', -(value ?? this.options.angle)); break;
        case '&': rotateTurtle(turtle, 'right', value ?? this.options.angle); break;
        case '^': rotateTurtle(turtle, 'right', -(value ?? this.options.angle)); break;
        case '\\': rotateTurtle(turtle, 'forward', value ?? this.options.angle); break;
        case '/': rotateTurtle(turtle, 'forward', -(value ?? this.options.angle)); break;
        case '|': rotateTurtle(turtle, 'up', Math.PI); break;
        case '[':
          if (programState.stack.length >= GROWTH_LIMITS.MAX_TURTLE_STACK_DEPTH) failGrowth('GROWTH_LSYSTEM_STACK_LIMIT', 'L-system runtime stack limit exceeded');
          programState.stack.push(cloneTurtle(turtle));
          break;
        case ']': {
          const restored = programState.stack.pop();
          if (!restored) failGrowth('GROWTH_LSYSTEM_STACK', 'L-system runtime stack underflow');
          Object.assign(turtle, restored);
          break;
        }
        case '!': turtle.radius = requireGrowthNumber(value ?? turtle.radius * this.options.radiusDecay, 'L-system radius', { strictlyPositive: true }); break;
        default: failGrowth('GROWTH_LSYSTEM_SYMBOL', `Unsupported L-system symbol '${token.symbol}'`);
      }
    }
    const completed = programState.cursor === programState.word.length;
    const retained = programState.word.length - programState.cursor;
    if (retained > 0 && created >= maximum) {
      events.push({ type: 'growth.budget-limited', details: { requested, committed: processed, retained, unit: 'symbols' } });
    }
    if (completed && !programState.completed) events.push({ type: 'growth.completed', details: { programId: this.id } });
    programState.completed = completed;
    draft.rngStreams = streams.snapshot();
    const committed = commitGrowthStep(state, draft, { reason: 'l-system-step', events });
    return Object.freeze({
      ...committed,
      events: committed.patch.events,
      telemetry: freezeGrowthJson({
        programId: this.id,
        tick: committed.state.tick,
        cursor: programState.cursor,
        symbols: programState.word.length,
        stackDepth: programState.stack.length,
        created,
        processed,
        completed,
        requested,
        committed: processed,
        retained,
        backlog: retained,
      }, '$.lSystemTelemetry'),
    });
  }

  snapshot(state) { return snapshotGrowthState(this.assertStateIdentity(state)); }
  restore(snapshot) { return this.assertStateIdentity(restoreGrowthState(snapshot)); }
  hash(state) { return hashGrowthState(this.assertStateIdentity(state)); }

  assertStateIdentity(stateInput) {
    const state = normalizeGrowthState(stateInput);
    if (state.program.id !== this.id || state.program.version !== this.version) {
      failGrowth('GROWTH_PROGRAM_STATE_IDENTITY', `State does not belong to ${this.id} v${this.version}`);
    }
    return state;
  }
}

export function createParametricLSystemProgram(options) {
  return new ParametricLSystemProgram(options);
}
