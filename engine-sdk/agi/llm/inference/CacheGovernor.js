// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const MiB = 1024 * 1024;

export class CacheGovernor {
    constructor({ logger = console } = {}) {
        this.logger = logger;
        this.planCount = 0;
        this.lastPlan = null;
    }

    planPreload(tensors = [], options = {}) {
        const plan = planAdaptivePreload(tensors, options);
        this.planCount++;
        this.lastPlan = compactPreloadPlan(plan);
        return plan;
    }

    snapshot() {
        return {
            enabled: true,
            plans: this.planCount,
            lastPlan: this.lastPlan,
        };
    }
}

export function planAdaptivePreload(tensors = [], options = {}) {
    const startedAt = performance.now?.() ?? Date.now();
    const cap = Math.max(0, Number(options.maxBytes ?? 0) || 0);
    const adaptive = options.adaptive !== false;
    const candidates = [...(tensors ?? [])]
        .map(tensor => normalizeTensorInfo(tensor))
        .filter(tensor => tensor.name && tensor.byteSize > 0);
    if (!Number.isFinite(cap) || cap <= 0 || !candidates.length) {
        return {
            selected: [],
            selectedBytes: 0,
            skippedByCap: candidates.length,
            planned: candidates.length,
            capBytes: cap,
            adaptive,
            elapsedMs: Math.max(0, (performance.now?.() ?? Date.now()) - startedAt),
        };
    }

    const ranked = candidates
        .map(tensor => ({
            ...tensor,
            family: weightFamily(tensor.name),
            score: adaptive
                ? adaptiveWeightPriority(tensor)
                : staticWeightPriority(tensor),
        }))
        .sort((a, b) => b.score - a.score
            || a.basePriority - b.basePriority
            || a.byteSize - b.byteSize
            || a.name.localeCompare(b.name));

    const selected = [];
    let selectedBytes = 0;
    for (const tensor of ranked) {
        if (selectedBytes + tensor.byteSize > cap) continue;
        selected.push(tensor.name);
        selectedBytes += tensor.byteSize;
    }

    return {
        selected,
        selectedBytes,
        skippedByCap: Math.max(0, ranked.length - selected.length),
        planned: ranked.length,
        capBytes: cap,
        adaptive,
        topFamilies: familyCounts(ranked.slice(0, Math.min(32, ranked.length))),
        selectedFamilies: familyCounts(ranked.filter(tensor => selected.includes(tensor.name))),
        selectedSample: selected.slice(0, 12),
        elapsedMs: Math.max(0, (performance.now?.() ?? Date.now()) - startedAt),
    };
}

export function adaptiveWeightPriority(tensor) {
    const info = normalizeTensorInfo(tensor);
    const family = weightFamily(info.name);
    const gpu = info.entryStats?.gpu ?? {};
    const host = info.entryStats?.host ?? {};
    const hits = Number(gpu.hits ?? info.gpuHits ?? 0) || 0;
    const hostHits = Number(host.hits ?? info.hostHits ?? 0) || 0;
    const uploads = Number(gpu.uploads ?? info.uploads ?? 0) || 0;
    const warmed = gpu.warmed === true || info.warmed === true;
    const resident = gpu.resident === true || info.gpuResident === true;
    const hostResident = host.resident === true || info.hostResident === true;
    const base = 12000 - Math.max(0, info.basePriority) * 14;
    const hitBonus = Math.min(5000, Math.log2(1 + hits) * 700);
    const hostBonus = Math.min(900, Math.log2(1 + hostHits) * 180);
    const uploadBonus = Math.min(1800, uploads * 140);
    const residencyBonus = (resident ? 2600 : 0) + (hostResident ? 450 : 0) + (warmed ? 600 : 0);
    const sizePenalty = Math.min(2400, info.byteSize / MiB * 0.35);
    return base + family.preloadScore + hitBonus + hostBonus + uploadBonus + residencyBonus - sizePenalty;
}

export function adaptiveEvictionScore(name, entry = {}, options = {}) {
    if (entry?.protected || (options.protectedName && name === options.protectedName)) return Number.POSITIVE_INFINITY;
    if (options.adaptive === false && !options.policy) return Number(entry?.lastUsed ?? 0) || 0;
    const family = weightFamily(name);
    const hits = Number(entry?.hits ?? 0) || 0;
    const uploads = Number(entry?.uploads ?? 0) || 0;
    const lastUsed = Number(entry?.lastUsed ?? 0) || 0;
    const byteSize = Number(entry?.byteSize ?? 0) || 0;
    const sizePenalty = Math.min(2000, byteSize / MiB * 0.5);
    return lastUsed + family.keepScore + Math.min(5000, hits * 25) + Math.min(2000, uploads * 100) - sizePenalty;
}

export function weightFamily(name) {
    const value = String(name ?? '');
    if (value === 'token_embd.weight' || value === 'per_layer_token_embd.weight') {
        return { key: 'embedding', preloadScore: 9000, keepScore: 9000 };
    }
    if (value === 'per_layer_model_proj.weight') {
        return { key: 'per-layer-proj', preloadScore: 8200, keepScore: 8200 };
    }
    if (value.includes('.inp_gate.') || value.includes('.proj.')) {
        return { key: 'per-layer-input', preloadScore: 7200, keepScore: 7200 };
    }
    if (value.includes('.attn_q.') || value.includes('.attn_k.') || value.includes('.attn_v.')) {
        return { key: 'attention-qkv', preloadScore: 6000, keepScore: 6200 };
    }
    if (value.includes('.attn_output.')) {
        return { key: 'attention-out', preloadScore: 5600, keepScore: 5900 };
    }
    if (value.includes('.ffn_gate.') || value.includes('.ffn_up.')) {
        return { key: 'ffn-in', preloadScore: 5200, keepScore: 5600 };
    }
    if (value.includes('.ffn_down.')) {
        return { key: 'ffn-out', preloadScore: 5000, keepScore: 5500 };
    }
    if (value.includes('_norm.weight') || value.includes('.norm.weight')) {
        return { key: 'norm', preloadScore: 4400, keepScore: 6200 };
    }
    return { key: 'other', preloadScore: 1000, keepScore: 1000 };
}

function normalizeTensorInfo(tensor) {
    if (typeof tensor === 'string') {
        return { name: tensor, byteSize: 0, basePriority: 9999, entryStats: null };
    }
    return {
        name: String(tensor?.name ?? ''),
        byteSize: Math.max(0, Number(tensor?.byteSize ?? 0) || 0),
        basePriority: finiteOr(tensor?.basePriority, 9999),
        entryStats: tensor?.entryStats ?? null,
        gpuHits: Number(tensor?.gpuHits ?? 0) || 0,
        hostHits: Number(tensor?.hostHits ?? 0) || 0,
        uploads: Number(tensor?.uploads ?? 0) || 0,
        gpuResident: tensor?.gpuResident === true,
        hostResident: tensor?.hostResident === true,
        warmed: tensor?.warmed === true,
    };
}

function finiteOr(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function staticWeightPriority(tensor) {
    const info = normalizeTensorInfo(tensor);
    return 12000 - Math.max(0, info.basePriority) * 14 - Math.min(2400, info.byteSize / MiB * 0.35);
}

function familyCounts(tensors) {
    const counts = {};
    for (const tensor of tensors) {
        const key = tensor.family?.key ?? weightFamily(tensor.name).key;
        counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
}

function compactPreloadPlan(plan) {
    return {
        adaptive: plan.adaptive,
        planned: plan.planned,
        selected: Array.isArray(plan.selected) ? plan.selected.length : 0,
        selectedBytes: plan.selectedBytes,
        skippedByCap: plan.skippedByCap,
        capBytes: plan.capBytes,
        selectedFamilies: plan.selectedFamilies,
        selectedSample: plan.selectedSample,
        elapsedMs: plan.elapsedMs,
    };
}

export default CacheGovernor;
