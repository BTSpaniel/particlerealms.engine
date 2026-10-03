// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
    ELECTRICAL_CIRCUIT_VERSION,
    ELECTRICAL_COMPONENT_DEFINITIONS,
    ELECTRICAL_LIMITS,
    ElectricalContractError,
    normalizeElectricalCircuitDocument,
} from './ElectricalContracts.js';
import { UnionFind } from '../../core/math/UnionFind.js';

export const COMPILED_ELECTRICAL_CIRCUIT_SCHEMA = 'engine.electrical.compiled-circuit';
export const COMPILED_ELECTRICAL_CIRCUIT_VERSION = '1.0.0';

const IDEAL_DC_TOLERANCE = 1e-12;

function indexedUnion(ids) {
    const orderedIds = [...ids].sort();
    const indexById = new Map(orderedIds.map((id, index) => [id, index]));
    const unionFind = new UnionFind(orderedIds.length);
    return {
        find(id) {
            return unionFind.find(indexById.get(id));
        },
        union(left, right) {
            unionFind.union(indexById.get(left), indexById.get(right));
        },
    };
}

function freezeTree(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) freezeTree(child);
    return Object.freeze(value);
}

function diagnostic(code, message, path = '$.circuit', details = null) {
    return freezeTree({
        code,
        message,
        path,
        details: details == null ? null : details,
    });
}

function failure(error) {
    const item = error instanceof ElectricalContractError
        ? diagnostic(error.code, error.message, error.path, error.details)
        : error && typeof error === 'object' && typeof error.code === 'string'
            ? diagnostic(error.code, String(error.message), error.path, error.details)
            : diagnostic(
                'ELECTRICAL_COMPILE_INTERNAL',
                error instanceof Error ? error.message : String(error),
            );
    return Object.freeze({
        ok: false,
        errors: Object.freeze([item]),
        warnings: Object.freeze([]),
        compiled: null,
    });
}

function compileError(code, message, path = '$.circuit', details = null) {
    const error = new Error(message);
    error.name = 'ElectricalCompileError';
    error.code = code;
    error.path = path;
    error.details = details;
    throw error;
}

function plainIndex(entries) {
    return Object.freeze(Object.fromEntries(entries));
}

function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

function componentPortNet(component, portName, terminalToCanonicalNet) {
    const terminalRef = component.ports[portName];
    if (!terminalRef) {
        compileError(
            'ELECTRICAL_COMPILE_PORT',
            'Component ' + component.id + ' has no port ' + portName,
            '$.circuit.components.' + component.id + '.ports.' + portName,
        );
    }
    const netId = terminalToCanonicalNet.get(terminalRef);
    if (!netId) {
        compileError(
            'ELECTRICAL_COMPILE_UNASSIGNED_TERMINAL',
            'Terminal ' + terminalRef + ' is not assigned to a net',
            '$.circuit.components.' + component.id + '.ports.' + portName,
        );
    }
    return netId;
}

function buildCanonicalNets(document, componentsById) {
    const terminalOwner = new Map();
    for (const component of document.components) {
        for (const terminalRef of Object.values(component.ports)) {
            terminalOwner.set(terminalRef, component.id);
        }
    }

    const terminalToAuthoredNet = new Map();
    for (const net of document.nets) {
        for (const terminalRef of net.terminalRefs) {
            if (!terminalOwner.has(terminalRef)) {
                compileError(
                    'ELECTRICAL_COMPILE_UNKNOWN_TERMINAL',
                    'Net ' + net.id + ' contains unknown terminal ' + terminalRef,
                    '$.circuit.nets.' + net.id + '.terminalRefs',
                );
            }
            if (terminalToAuthoredNet.has(terminalRef)) {
                compileError(
                    'ELECTRICAL_COMPILE_TERMINAL_MULTIPLE_NETS',
                    'Terminal ' + terminalRef + ' belongs to more than one authored net',
                    '$.circuit.nets.' + net.id + '.terminalRefs',
                    {
                        firstNetId: terminalToAuthoredNet.get(terminalRef),
                        secondNetId: net.id,
                    },
                );
            }
            terminalToAuthoredNet.set(terminalRef, net.id);
        }
    }
    for (const terminalRef of [...terminalOwner.keys()].sort()) {
        if (!terminalToAuthoredNet.has(terminalRef)) {
            compileError(
                'ELECTRICAL_COMPILE_UNASSIGNED_TERMINAL',
                'Terminal ' + terminalRef + ' is not assigned to any authored net',
                '$.circuit.components.' + terminalOwner.get(terminalRef) + '.ports',
            );
        }
    }

    const authoredNetUnion = indexedUnion(document.nets.map((net) => net.id));
    for (const component of document.components) {
        const definition = ELECTRICAL_COMPONENT_DEFINITIONS[component.kind];
        if (!definition.idealUnion) continue;
        const netIds = Object.values(component.ports)
            .map((terminalRef) => terminalToAuthoredNet.get(terminalRef))
            .sort();
        for (let index = 1; index < netIds.length; index += 1) {
            authoredNetUnion.union(netIds[0], netIds[index]);
        }
    }

    const aliasesByRoot = new Map();
    for (const net of document.nets) {
        const root = authoredNetUnion.find(net.id);
        if (!aliasesByRoot.has(root)) aliasesByRoot.set(root, []);
        aliasesByRoot.get(root).push(net.id);
    }
    const canonicalByAuthored = new Map();
    const canonicalNets = [...aliasesByRoot.values()].map((aliases) => {
        aliases.sort();
        const id = aliases[0];
        for (const alias of aliases) canonicalByAuthored.set(alias, id);
        const terminalRefs = aliases.flatMap((alias) => {
            const net = document.nets.find((candidate) => candidate.id === alias);
            return net.terminalRefs;
        }).sort();
        return { id, aliases, terminalRefs };
    }).sort((left, right) => compareText(left.id, right.id));

    const terminalToCanonicalNet = new Map();
    for (const [terminalRef, authoredNetId] of terminalToAuthoredNet) {
        terminalToCanonicalNet.set(terminalRef, canonicalByAuthored.get(authoredNetId));
    }

    const referenceEntriesByCanonical = new Map();
    for (const authoredReference of document.referenceNets) {
        const canonicalId = canonicalByAuthored.get(authoredReference);
        if (!referenceEntriesByCanonical.has(canonicalId)) {
            referenceEntriesByCanonical.set(canonicalId, []);
        }
        referenceEntriesByCanonical.get(canonicalId).push(authoredReference);
    }
    for (const [canonicalId, references] of referenceEntriesByCanonical) {
        if (references.length > 1) {
            compileError(
                'ELECTRICAL_COMPILE_MULTIPLE_REFERENCES',
                'Ideal-wire union gives net ' + canonicalId + ' multiple explicit references',
                '$.circuit.referenceNets',
                { canonicalNetId: canonicalId, referenceNetIds: [...references].sort() },
            );
        }
    }

    for (const component of componentsById.values()) {
        if (component.kind !== 'reference') continue;
        const canonicalId = componentPortNet(component, 'terminal', terminalToCanonicalNet);
        if (!referenceEntriesByCanonical.has(canonicalId)) {
            compileError(
                'ELECTRICAL_COMPILE_REFERENCE_COMPONENT',
                'Reference component ' + component.id + ' is not on an explicit reference net',
                '$.circuit.components.' + component.id,
                { canonicalNetId: canonicalId },
            );
        }
    }

    return {
        canonicalNets,
        canonicalByAuthored,
        terminalToCanonicalNet,
        referenceEntriesByCanonical,
    };
}

function buildElectricalIslands(document, canonicalState) {
    const netIds = canonicalState.canonicalNets.map((net) => net.id);
    const islandUnion = indexedUnion(netIds);

    for (const component of document.components) {
        const definition = ELECTRICAL_COMPONENT_DEFINITIONS[component.kind];
        for (const declaredGroup of definition.islandGroups) {
            const portNames = declaredGroup.length === 1 && declaredGroup[0] === '*'
                ? Object.keys(component.ports).sort()
                : declaredGroup;
            const groupNets = portNames.map((portName) =>
                componentPortNet(component, portName, canonicalState.terminalToCanonicalNet));
            for (let index = 1; index < groupNets.length; index += 1) {
                islandUnion.union(groupNets[0], groupNets[index]);
            }
        }
    }

    const netsByIsland = new Map();
    for (const netId of netIds) {
        const root = islandUnion.find(netId);
        if (!netsByIsland.has(root)) netsByIsland.set(root, []);
        netsByIsland.get(root).push(netId);
    }

    const referenceCanonicalIds = new Set(canonicalState.referenceEntriesByCanonical.keys());
    const islands = [...netsByIsland.values()].map((islandNetIds) => {
        islandNetIds.sort();
        const references = islandNetIds.filter((netId) => referenceCanonicalIds.has(netId));
        if (references.length === 0) {
            compileError(
                'ELECTRICAL_COMPILE_FLOATING_ISLAND',
                'Electrical island ' + islandNetIds[0] + ' has no explicit reference net',
                '$.circuit.referenceNets',
                { islandNetIds },
            );
        }
        if (references.length > 1) {
            compileError(
                'ELECTRICAL_COMPILE_MULTIPLE_REFERENCES',
                'Electrical island ' + islandNetIds[0] + ' has multiple explicit reference nets',
                '$.circuit.referenceNets',
                { islandNetIds, referenceNetIds: references },
            );
        }
        const componentIds = document.components
            .filter((component) => Object.values(component.ports).some((terminalRef) =>
                islandNetIds.includes(canonicalState.terminalToCanonicalNet.get(terminalRef))))
            .map((component) => component.id)
            .sort();
        return {
            id: islandNetIds[0],
            netIds: islandNetIds,
            referenceNetId: references[0],
            componentIds,
        };
    }).sort((left, right) => compareText(left.id, right.id));

    const islandByNet = new Map();
    islands.forEach((island, index) => {
        island.index = index;
        for (const netId of island.netIds) islandByNet.set(netId, island.id);
    });
    return { islands, islandByNet };
}

function validateDependentControls(document) {
    const componentsById = new Map(document.components.map((component) => [component.id, component]));
    for (const component of document.components) {
        const definition = ELECTRICAL_COMPONENT_DEFINITIONS[component.kind];
        if (definition.control?.mode !== 'branch-current') continue;
        const controlComponentId = component.parameters.controlComponentId;
        const control = componentsById.get(controlComponentId);
        if (!control) {
            compileError(
                'ELECTRICAL_COMPILE_CONTROL_COMPONENT',
                'Dependent source ' + component.id + ' references missing control component ' +
                controlComponentId,
                '$.circuit.components.' + component.id + '.parameters.controlComponentId',
            );
        }
        const branches = ELECTRICAL_COMPONENT_DEFINITIONS[control.kind].branchUnknowns;
        if (branches.length === 0) {
            compileError(
                'ELECTRICAL_COMPILE_CONTROL_BRANCH',
                'Control component ' + control.id + ' has no branch-current unknown',
                '$.circuit.components.' + component.id + '.parameters.controlComponentId',
            );
        }
        const requested = component.parameters.controlBranch;
        if (requested != null && !branches.includes(requested)) {
            compileError(
                'ELECTRICAL_COMPILE_CONTROL_BRANCH',
                'Control component ' + control.id + ' has no branch ' + requested,
                '$.circuit.components.' + component.id + '.parameters.controlBranch',
                { availableBranches: branches },
            );
        }
        if (requested == null && branches.length !== 1) {
            compileError(
                'ELECTRICAL_COMPILE_CONTROL_BRANCH_AMBIGUOUS',
                'Dependent source ' + component.id + ' must select one control branch',
                '$.circuit.components.' + component.id + '.parameters.controlBranch',
                { availableBranches: branches },
            );
        }
    }
}

function validateTemperatureProbeTargets(document) {
    const componentsById = new Map(document.components.map((component) => [component.id, component]));
    for (const probe of document.components) {
        if (probe.kind !== 'probe.temperature') continue;
        const componentId = probe.parameters.componentId;
        if (!componentsById.has(componentId)) {
            compileError(
                'ELECTRICAL_COMPILE_TEMPERATURE_PROBE_TARGET',
                'Temperature probe ' + probe.id + ' references missing component ' + componentId,
                '$.circuit.components.' + probe.id + '.parameters.componentId',
                { probeId: probe.id, componentId },
            );
        }
    }
}

function idealDcConstraint(component, terminalToCanonicalNet) {
    if (component.kind === 'voltage-source.dc') {
        if ((component.parameters.seriesResistanceOhms ?? 0) > 0) return null;
        return {
            componentId: component.id,
            positiveNetId: componentPortNet(component, 'positive', terminalToCanonicalNet),
            negativeNetId: componentPortNet(component, 'negative', terminalToCanonicalNet),
            voltageVolts: component.parameters.voltageVolts,
        };
    }
    if (component.kind === 'supply.dc' &&
        component.parameters.internalResistanceOhms === 0) {
        return {
            componentId: component.id,
            positiveNetId: componentPortNet(component, 'positive', terminalToCanonicalNet),
            negativeNetId: componentPortNet(component, 'negative', terminalToCanonicalNet),
            voltageVolts: component.parameters.openCircuitVoltageVolts,
        };
    }
    return null;
}

function validateIdealDcSources(document, terminalToCanonicalNet) {
    const constraints = document.components
        .map((component) => idealDcConstraint(component, terminalToCanonicalNet))
        .filter(Boolean)
        .sort((left, right) => compareText(left.componentId, right.componentId));
    const adjacency = new Map();
    const addEdge = (from, to, delta, componentId) => {
        if (!adjacency.has(from)) adjacency.set(from, []);
        adjacency.get(from).push({ to, delta, componentId });
    };
    for (const constraint of constraints) {
        addEdge(
            constraint.positiveNetId,
            constraint.negativeNetId,
            -constraint.voltageVolts,
            constraint.componentId,
        );
        addEdge(
            constraint.negativeNetId,
            constraint.positiveNetId,
            constraint.voltageVolts,
            constraint.componentId,
        );
    }
    for (const edges of adjacency.values()) {
        edges.sort((left, right) =>
            compareText(left.to, right.to) || compareText(left.componentId, right.componentId));
    }

    const potentials = new Map();
    const assignedBy = new Map();
    for (const start of [...adjacency.keys()].sort()) {
        if (potentials.has(start)) continue;
        potentials.set(start, 0);
        assignedBy.set(start, null);
        const queue = [start];
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
            const from = queue[cursor];
            const fromPotential = potentials.get(from);
            for (const edge of adjacency.get(from) ?? []) {
                const expected = fromPotential + edge.delta;
                if (!potentials.has(edge.to)) {
                    potentials.set(edge.to, expected);
                    assignedBy.set(edge.to, edge.componentId);
                    queue.push(edge.to);
                    continue;
                }
                const actual = potentials.get(edge.to);
                const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
                if (Math.abs(actual - expected) > IDEAL_DC_TOLERANCE * scale) {
                    compileError(
                        'ELECTRICAL_COMPILE_CONTRADICTORY_IDEAL_DC',
                        'Ideal DC source ' + edge.componentId +
                        ' contradicts the existing voltage constraints',
                        '$.circuit.components.' + edge.componentId,
                        {
                            fromNetId: from,
                            toNetId: edge.to,
                            expectedVolts: expected,
                            actualVolts: actual,
                            previousComponentId: assignedBy.get(edge.to),
                        },
                    );
                }
            }
        }
    }
}

function buildUnknowns(document, canonicalState) {
    const referenceCanonicalIds = new Set(canonicalState.referenceEntriesByCanonical.keys());
    const unknowns = [];
    for (const net of canonicalState.canonicalNets) {
        if (referenceCanonicalIds.has(net.id)) continue;
        unknowns.push({
            id: 'voltage:' + net.id,
            kind: 'node-voltage',
            netId: net.id,
        });
    }
    const nodeUnknownCount = unknowns.length;
    for (const component of document.components) {
        const definition = ELECTRICAL_COMPONENT_DEFINITIONS[component.kind];
        for (const branch of definition.branchUnknowns) {
            unknowns.push({
                id: 'current:' + component.id + ':' + branch,
                kind: 'branch-current',
                componentId: component.id,
                branch,
            });
        }
    }
    if (unknowns.length > ELECTRICAL_LIMITS.maximumUnknowns) {
        compileError(
            'ELECTRICAL_COMPILE_UNKNOWN_LIMIT',
            'Circuit requires ' + unknowns.length + ' MNA unknowns; maximum is ' +
            ELECTRICAL_LIMITS.maximumUnknowns,
            '$.circuit.components',
            {
                nodeUnknownCount,
                branchUnknownCount: unknowns.length - nodeUnknownCount,
                maximumUnknowns: ELECTRICAL_LIMITS.maximumUnknowns,
            },
        );
    }
    unknowns.forEach((unknown, index) => {
        unknown.index = index;
    });
    return {
        unknowns,
        nodeUnknownCount,
        branchUnknownCount: unknowns.length - nodeUnknownCount,
    };
}

/**
 * Compile strict circuit topology into deterministic nets, islands, and MNA
 * unknown indices. The report never exposes partially compiled authority.
 */
export function compileElectricalCircuit(documentValue) {
    try {
        const document = normalizeElectricalCircuitDocument(documentValue);
        const componentsById = new Map(document.components.map((component) => [
            component.id,
            component,
        ]));
        validateDependentControls(document);
        validateTemperatureProbeTargets(document);
        const canonicalState = buildCanonicalNets(document, componentsById);
        const islandState = buildElectricalIslands(document, canonicalState);
        validateIdealDcSources(document, canonicalState.terminalToCanonicalNet);
        const unknownState = buildUnknowns(document, canonicalState);

        const referenceCanonicalIds = new Set(canonicalState.referenceEntriesByCanonical.keys());
        const nets = canonicalState.canonicalNets.map((net, index) => freezeTree({
            id: net.id,
            index,
            aliases: [...net.aliases],
            terminalRefs: [...net.terminalRefs],
            reference: referenceCanonicalIds.has(net.id),
            islandId: islandState.islandByNet.get(net.id),
        }));
        const components = document.components.map((component, index) => freezeTree({
            ...component,
            index,
            portNetIds: Object.freeze(Object.fromEntries(
                Object.entries(component.ports).map(([portName, terminalRef]) => [
                    portName,
                    canonicalState.terminalToCanonicalNet.get(terminalRef),
                ]),
            )),
            branchUnknowns: [...ELECTRICAL_COMPONENT_DEFINITIONS[component.kind].branchUnknowns],
        }));
        const unknowns = unknownState.unknowns.map((unknown) => freezeTree({ ...unknown }));
        const compiled = freezeTree({
            schema: COMPILED_ELECTRICAL_CIRCUIT_SCHEMA,
            version: COMPILED_ELECTRICAL_CIRCUIT_VERSION,
            sourceSchemaVersion: ELECTRICAL_CIRCUIT_VERSION,
            id: document.id,
            settings: document.settings,
            probes: [...document.probes],
            components,
            nets,
            islands: islandState.islands.map((island) => freezeTree({ ...island })),
            unknowns,
            nodeUnknownCount: unknownState.nodeUnknownCount,
            branchUnknownCount: unknownState.branchUnknownCount,
            unknownCount: unknowns.length,
            indices: {
                componentById: plainIndex(components.map((component) => [
                    component.id,
                    component.index,
                ])),
                netById: plainIndex(nets.flatMap((net) =>
                    net.aliases.map((alias) => [alias, net.index]))),
                terminalToNet: plainIndex([...canonicalState.terminalToCanonicalNet.entries()]
                    .sort(([left], [right]) => compareText(left, right))
                    .map(([terminalRef, netId]) => [
                        terminalRef,
                        nets.find((net) => net.id === netId).index,
                    ])),
                unknownById: plainIndex(unknowns.map((unknown) => [
                    unknown.id,
                    unknown.index,
                ])),
            },
        });
        return Object.freeze({
            ok: true,
            errors: Object.freeze([]),
            warnings: Object.freeze([]),
            compiled,
        });
    } catch (error) {
        return failure(error);
    }
}

export function compileElectricalCircuitOrThrow(documentValue) {
    const report = compileElectricalCircuit(documentValue);
    if (!report.ok) {
        const first = report.errors[0];
        const error = new Error(first.message);
        error.name = 'ElectricalCompileError';
        error.code = first.code;
        error.path = first.path;
        error.details = first.details;
        throw error;
    }
    return report.compiled;
}

export function isCompiledElectricalCircuit(value) {
    return Boolean(
        value &&
        value.schema === COMPILED_ELECTRICAL_CIRCUIT_SCHEMA &&
        value.version === COMPILED_ELECTRICAL_CIRCUIT_VERSION &&
        Number.isSafeInteger(value.unknownCount) &&
        value.unknownCount >= 0 &&
        value.unknownCount <= ELECTRICAL_LIMITS.maximumUnknowns &&
        Array.isArray(value.probes) &&
        Array.isArray(value.components) &&
        Array.isArray(value.nets) &&
        Array.isArray(value.islands) &&
        Array.isArray(value.unknowns),
    );
}

export default compileElectricalCircuit;
