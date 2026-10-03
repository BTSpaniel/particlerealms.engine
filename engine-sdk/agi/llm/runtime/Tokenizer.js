// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { GEMMA4_SPECIAL_TOKENS } from './PromptTemplate.js';

export class Tokenizer {
    constructor(options = {}) {
        this.name = options.name ?? 'unloaded';
        this.vocabSize = options.vocabSize ?? 0;
        this.specialTokens = { ...GEMMA4_SPECIAL_TOKENS, ...(options.specialTokens ?? {}) };
        this.specialTokenIds = { ...(options.specialTokenIds ?? {}) };
        this.metadata = options.metadata ?? {};
        this.loaded = !!options.loaded;
        this.mode = options.mode ?? 'metadata-only';
        this.tokens = options.tokens ?? [];
        this.scores = options.scores ?? [];
        this.merges = options.merges ?? [];
        this.tokenToId = null;
        this.scoreValues = null;
        this.mergeRanks = null;
        this.maxTokenLength = 0;
        this.encodeCache = new Map();
        this.encodeCacheStats = {
            hits: 0,
            misses: 0,
            inserts: 0,
            evictions: 0,
            bypasses: 0,
        };
        this.blockedTokenCache = new Map();
        this.blockedTokenCacheStats = { hits: 0, misses: 0 };
        this.maxEncodeCacheEntries = Math.max(0, Math.floor(Number(options.maxEncodeCacheEntries ?? 128) || 0));
        this.maxEncodeCacheChars = Math.max(0, Math.floor(Number(options.maxEncodeCacheChars ?? 65536) || 0));
    }

    static fromGemmaConfig(config = {}, tokenizerConfig = {}) {
        const text = config.text_config ?? config;
        const specialTokens = {
            bos: tokenizerConfig.bos_token ?? '<bos>',
            eos: tokenizerConfig.eos_token ?? '<eos>',
            pad: tokenizerConfig.pad_token ?? '<pad>',
            startTurn: tokenizerConfig.sot_token ?? '<|turn>',
            endTurn: tokenizerConfig.eot_token ?? '<turn|>',
            startChannel: tokenizerConfig.soc_token ?? '<|channel>',
            endChannel: tokenizerConfig.eoc_token ?? '<channel|>',
            toolCall: tokenizerConfig.stc_token ?? '<|tool_call>',
            toolResponse: tokenizerConfig.str_token ?? '<|tool_response>',
            think: tokenizerConfig.think_token ?? '<|think|>',
        };
        return new Tokenizer({
            name: tokenizerConfig.tokenizer_class ?? 'GemmaTokenizer',
            vocabSize: Number(text.vocab_size ?? config.vocab_size ?? 0),
            specialTokens,
            specialTokenIds: {
                bos: text.bos_token_id ?? config.bos_token_id,
                eos: text.eos_token_id ?? config.eos_token_id,
                pad: text.pad_token_id ?? config.pad_token_id,
            },
            metadata: { modelType: config.model_type ?? text.model_type ?? 'gemma4' },
            loaded: false,
            mode: 'metadata-only',
        });
    }

    static fromGGUFMetadata(metadata = {}) {
        const tokens = metadata['tokenizer.ggml.tokens'];
        const scores = metadata['tokenizer.ggml.scores'];
        const merges = metadata['tokenizer.ggml.merges'];
        const tokenValues = Array.isArray(tokens) ? tokens : tokens?.values;
        const scoreValues = Array.isArray(scores) ? scores : scores?.values;
        const mergeValues = Array.isArray(merges) ? merges : merges?.values;
        const vocabSize = Number(tokens?.length ?? tokens?.values?.length ?? metadata['llama.vocab_size'] ?? 0);
        const model = metadata['tokenizer.ggml.model'] ?? 'gguf-tokenizer';
        const isBpe = String(model).toLowerCase() === 'gemma4' || Array.isArray(mergeValues);
        const tokensLoaded = Array.isArray(tokens) || (Array.isArray(tokens?.values) && !tokens.truncated);
        const mergesLoaded = !isBpe || Array.isArray(merges) || (Array.isArray(merges?.values) && !merges.truncated);
        const specialTokenIds = {
            bos: metadata['tokenizer.ggml.bos_token_id'],
            eos: metadata['tokenizer.ggml.eos_token_id'],
            pad: metadata['tokenizer.ggml.padding_token_id'],
            unk: metadata['tokenizer.ggml.unknown_token_id'],
        };
        const specialTokens = { ...GEMMA4_SPECIAL_TOKENS };
        const knownSpecials = {
            startTurn: '<|turn>',
            endTurn: '<turn|>',
            startChannel: '<|channel>',
            endChannel: '<channel|>',
            think: '<|think|>',
            toolCall: '<|tool_call>',
            toolCallEnd: '<tool_call|>',
            toolResponse: '<|tool_response>',
            toolResponseEnd: '<tool_response|>',
            tool: '<|tool>',
            toolEnd: '<tool|>',
            imageBegin: '<|image>',
            image: '<|image|>',
            imageEnd: '<image|>',
            audioBegin: '<|audio>',
            audio: '<|audio|>',
            audioEnd: '<audio|>',
            video: '<|video|>',
            quote: '<|"|>',
        };
        for (const [key, token] of Object.entries(knownSpecials)) {
            const id = tokenValues?.indexOf?.(token) ?? -1;
            if (id >= 0) {
                specialTokens[key] = token;
                specialTokenIds[key] = id;
            }
        }
        return new Tokenizer({
            name: model,
            vocabSize,
            specialTokens,
            specialTokenIds,
            metadata,
            tokens: tokenValues ?? [],
            scores: scoreValues ?? [],
            merges: mergeValues ?? [],
            loaded: tokensLoaded && mergesLoaded,
            mode: tokensLoaded || Array.isArray(tokens?.values) ? (isBpe ? 'gguf-bpe' : 'gguf-metadata') : 'metadata-only',
        });
    }

    encode(text, options = {}) {
        if (!this.loaded) {
            if (options.allowEstimate) return this.estimateTokens(text);
            throw new Error('Tokenizer encode unavailable: tokenizer vocabulary is metadata-only.');
        }
        const cacheKey = this.encodeCacheKey(text, options);
        if (cacheKey) {
            const cached = this.encodeCache.get(cacheKey);
            if (cached) {
                cached.lastUsed = Date.now();
                this.encodeCacheStats.hits++;
                return cached.ids.slice();
            }
            this.encodeCacheStats.misses++;
        } else {
            this.encodeCacheStats.bypasses++;
        }
        const ids = this._isBpe() ? this.encodeBPE(text, options) : this.encodeUnigram(text, options);
        if (cacheKey) this.storeEncodeCache(cacheKey, ids);
        return ids;
    }

    decode(ids, options = {}) {
        if (!this.loaded) throw new Error('Tokenizer decode unavailable: tokenizer vocabulary is metadata-only.');
        const skipSpecial = options.skipSpecial !== false;
        const pieces = [];
        const specialIds = new Set(Object.values(this.specialTokenIds).filter(v => Number.isFinite(Number(v))).map(Number));
        for (const id of ids ?? []) {
            const index = Number(id);
            if (!Number.isFinite(index) || index < 0 || index >= this.tokens.length) continue;
            if (skipSpecial && specialIds.has(index)) continue;
            pieces.push(this.tokens[index] ?? '');
        }
        return pieces.join('').replace(/▁/g, ' ').replace(/^ /, '');
    }

    count(text, options = {}) {
        return this.encode(text, { allowEstimate: true, ...options }).length;
    }

    estimateTokens(text) {
        const source = String(text ?? '');
        const matches = source.match(/<\|[^>]+>|\S+|\s+/g) ?? [];
        return matches.filter(part => part.trim().length > 0 || part.length > 3).map((part, index) => ({
            id: -1,
            index,
            text: part,
            estimated: true,
        }));
    }

    encodeGreedy(text, options = {}) {
        this._ensureLookup();
        const addBos = options.addBos ?? false;
        const addEos = options.addEos ?? false;
        const ids = [];
        const source = String(text ?? '');
        const specialPieces = this._specialPieces();
        if (addBos && !source.startsWith(this.specialTokens.bos) && Number.isFinite(Number(this.specialTokenIds.bos))) {
            ids.push(Number(this.specialTokenIds.bos));
        }
        let i = 0;
        while (i < source.length) {
            const special = specialPieces.find(piece => source.startsWith(piece.text, i));
            if (special) {
                ids.push(special.id);
                i += special.text.length;
                continue;
            }
            let nextSpecial = source.length;
            for (const piece of specialPieces) {
                const index = source.indexOf(piece.text, i + 1);
                if (index >= 0 && index < nextSpecial) nextSpecial = index;
            }
            ids.push(...this._encodeNormalSegment(source.slice(i, nextSpecial)));
            i = nextSpecial;
        }
        if (addEos && Number.isFinite(Number(this.specialTokenIds.eos))) ids.push(Number(this.specialTokenIds.eos));
        return ids;
    }

    encodeUnigram(text, options = {}) {
        this._ensureLookup();
        if (!this._hasUsableScores()) return this.encodeGreedy(text, options);
        const addBos = options.addBos ?? false;
        const addEos = options.addEos ?? false;
        const ids = [];
        const source = String(text ?? '');
        const specialPieces = this._specialPieces();
        if (addBos && !source.startsWith(this.specialTokens.bos) && Number.isFinite(Number(this.specialTokenIds.bos))) {
            ids.push(Number(this.specialTokenIds.bos));
        }
        let i = 0;
        while (i < source.length) {
            const special = specialPieces.find(piece => source.startsWith(piece.text, i));
            if (special) {
                ids.push(special.id);
                i += special.text.length;
                continue;
            }
            let nextSpecial = source.length;
            for (const piece of specialPieces) {
                const index = source.indexOf(piece.text, i + 1);
                if (index >= 0 && index < nextSpecial) nextSpecial = index;
            }
            ids.push(...this._encodeUnigramSegment(source.slice(i, nextSpecial), options));
            i = nextSpecial;
        }
        if (addEos && Number.isFinite(Number(this.specialTokenIds.eos))) ids.push(Number(this.specialTokenIds.eos));
        return ids;
    }

    encodeBPE(text, options = {}) {
        this._ensureLookup();
        const addBos = options.addBos ?? false;
        const addEos = options.addEos ?? false;
        const ids = [];
        const source = String(text ?? '');
        const specialPieces = this._specialPieces();
        if (addBos && !source.startsWith(this.specialTokens.bos) && Number.isFinite(Number(this.specialTokenIds.bos))) {
            ids.push(Number(this.specialTokenIds.bos));
        }
        let i = 0;
        while (i < source.length) {
            const special = specialPieces.find(piece => source.startsWith(piece.text, i));
            if (special) {
                ids.push(special.id);
                i += special.text.length;
                continue;
            }
            let nextSpecial = source.length;
            for (const piece of specialPieces) {
                const index = source.indexOf(piece.text, i + 1);
                if (index >= 0 && index < nextSpecial) nextSpecial = index;
            }
            ids.push(...this._encodeBpeSegment(source.slice(i, nextSpecial)));
            i = nextSpecial;
        }
        if (addEos && Number.isFinite(Number(this.specialTokenIds.eos))) ids.push(Number(this.specialTokenIds.eos));
        return ids;
    }

    _encodeBpeSegment(text) {
        const normalized = normalizeGemmaBpeInput(text);
        if (!normalized) return [];
        const nodes = Array.from(normalized, (value, order) => ({
            value,
            order,
            previous: order - 1,
            next: order + 1,
            version: 0,
            alive: true,
        }));
        if (nodes.length) nodes[nodes.length - 1].next = -1;
        const heap = [];
        const enqueue = leftIndex => {
            if (leftIndex < 0) return;
            const left = nodes[leftIndex];
            const rightIndex = left?.next ?? -1;
            const right = rightIndex >= 0 ? nodes[rightIndex] : null;
            if (!left?.alive || !right?.alive) return;
            const rank = this.mergeRanks.get(pairKey(left.value, right.value));
            if (rank === undefined) return;
            heapPush(heap, { rank, order: left.order, leftIndex, rightIndex, leftVersion: left.version, rightVersion: right.version });
        };
        for (let index = 0; index < nodes.length - 1; index++) enqueue(index);
        while (heap.length) {
            const candidate = heapPop(heap);
            const left = nodes[candidate.leftIndex];
            const right = nodes[candidate.rightIndex];
            if (!left?.alive || !right?.alive || left.next !== candidate.rightIndex) continue;
            if (left.version !== candidate.leftVersion || right.version !== candidate.rightVersion) continue;
            left.value += right.value;
            left.version++;
            left.next = right.next;
            right.alive = false;
            right.version++;
            if (right.next >= 0) {
                nodes[right.next].previous = candidate.leftIndex;
            }
            enqueue(left.previous);
            enqueue(candidate.leftIndex);
        }
        const pieces = nodes.filter(node => node.alive).map(node => node.value);
        const ids = [];
        const unk = Number(this.specialTokenIds.unk);
        for (const piece of pieces) {
            const id = this.tokenToId.get(piece);
            if (id !== undefined) {
                ids.push(id);
                continue;
            }
            const fallback = this._byteFallbackIds(piece);
            if (fallback.length) ids.push(...fallback);
            else if (Number.isFinite(unk)) ids.push(unk);
        }
        return ids;
    }

    _byteFallbackIds(text) {
        const ids = [];
        for (const byte of new TextEncoder().encode(String(text ?? ''))) {
            const id = this.tokenToId.get(`<0x${byte.toString(16).toUpperCase().padStart(2, '0')}>`);
            if (id === undefined) return [];
            ids.push(id);
        }
        return ids;
    }

    _encodeNormalSegment(text) {
        const normalized = normalizeSentencePieceInput(text);
        const ids = [];
        let i = 0;
        while (i < normalized.length) {
            let found = null;
            const max = Math.min(this.maxTokenLength, normalized.length - i);
            for (let len = max; len > 0; len--) {
                const piece = normalized.slice(i, i + len);
                const id = this.tokenToId.get(piece);
                if (id !== undefined) {
                    found = { id, len };
                    break;
                }
            }
            if (found) {
                ids.push(found.id);
                i += found.len;
            } else {
                const unk = Number(this.specialTokenIds.unk);
                if (Number.isFinite(unk)) ids.push(unk);
                i += 1;
            }
        }
        return ids;
    }

    _encodeUnigramSegment(text, options = {}) {
        const normalized = normalizeSentencePieceInput(text);
        if (!normalized) return [];
        const length = normalized.length;
        const searchLimit = Math.max(1, Math.min(this.maxTokenLength, Number(options.maxPieceSearchLength ?? 128)));
        const unk = Number(this.specialTokenIds.unk);
        const unkPenalty = Number(options.unknownPenalty ?? this._unknownPenalty());
        const dp = Array.from({ length: length + 1 }, () => ({
            score: Number.NEGATIVE_INFINITY,
            prev: -1,
            id: -1,
        }));
        dp[0].score = 0;
        for (let i = 0; i < length; i++) {
            if (!Number.isFinite(dp[i].score)) continue;
            const maxLen = Math.min(searchLimit, length - i);
            for (let len = 1; len <= maxLen; len++) {
                const piece = normalized.slice(i, i + len);
                const id = this.tokenToId.get(piece);
                if (id === undefined) continue;
                const score = dp[i].score + this._scoreFor(id);
                if (score > dp[i + len].score) {
                    dp[i + len] = { score, prev: i, id };
                }
            }
            if (Number.isFinite(unk) && i + 1 <= length) {
                const score = dp[i].score + unkPenalty;
                if (score > dp[i + 1].score) {
                    dp[i + 1] = { score, prev: i, id: unk };
                }
            }
        }
        if (!Number.isFinite(dp[length].score)) return this._encodeNormalSegment(text);
        const ids = [];
        for (let i = length; i > 0;) {
            const cell = dp[i];
            if (cell.prev < 0 || !Number.isFinite(Number(cell.id))) return this._encodeNormalSegment(text);
            ids.push(Number(cell.id));
            i = cell.prev;
        }
        ids.reverse();
        return ids;
    }

    _hasUsableScores() {
        if (this.scoreValues instanceof Float32Array) return this.scoreValues.length >= this.tokens.length;
        return ArrayBuffer.isView(this.scores)
            ? this.scores.length >= this.tokens.length
            : Array.isArray(this.scores) && this.scores.length >= this.tokens.length;
    }

    _scoreFor(id) {
        const score = this.scoreValues?.[id];
        return Number.isFinite(score) ? score : -20;
    }

    _unknownPenalty() {
        if (!this.scoreValues?.length) return -1000000;
        let minScore = 0;
        for (const score of this.scoreValues) {
            if (Number.isFinite(score) && score < minScore) minScore = score;
        }
        return minScore - 1000000;
    }

    _specialPieces() {
        return Object.values(this.specialTokens)
            .filter(value => typeof value === 'string' && value.length)
            .map(text => ({ text, id: this.tokenToId.get(text) ?? this.specialTokenIds[tokenKeyFor(this.specialTokens, text)] }))
            .filter(piece => Number.isFinite(Number(piece.id)))
            .map(piece => ({ ...piece, id: Number(piece.id) }))
            .sort((a, b) => b.text.length - a.text.length);
    }

    textOnlyBlockedTokenIds(options = {}) {
        const asciiOnly = options.asciiOnly === true;
        const plainTextOnly = options.plainTextOnly !== false;
        const strictPlainTextOnly = options.strictPlainTextOnly === true;
        const cacheKey = `${asciiOnly ? 1 : 0}:${plainTextOnly ? 1 : 0}:${strictPlainTextOnly ? 1 : 0}`;
        const cached = this.blockedTokenCache.get(cacheKey);
        if (cached) {
            this.blockedTokenCacheStats.hits++;
            return cached.slice();
        }
        this.blockedTokenCacheStats.misses++;
        const stop = new Set(this.stopTokenIds());
        const blocked = [];
        for (const [key, value] of Object.entries(this.specialTokenIds)) {
            const id = Number(value);
            if (!Number.isFinite(id) || stop.has(id)) continue;
            if (key === 'unk') continue;
            blocked.push(id);
        }
        for (let id = 0; id < this.tokens.length; id++) {
            if (stop.has(id)) continue;
            const token = this.tokens[id];
            if (typeof token !== 'string') continue;
            if (isUnsafeGeneratedToken(token, { asciiOnly, plainTextOnly })) blocked.push(id);
            if (strictPlainTextOnly && isUnsafePlainChatToken(token)) blocked.push(id);
        }
        const result = [...new Set(blocked)];
        this.blockedTokenCache.set(cacheKey, result);
        return result.slice();
    }

    stopTokenIds() {
        return [this.specialTokenIds.eos, this.specialTokenIds.endTurn]
            .filter(value => Number.isFinite(Number(value)))
            .map(Number);
    }

    encodeCacheKey(text, options = {}) {
        if (!this.maxEncodeCacheEntries || !this.maxEncodeCacheChars) return '';
        const source = String(text ?? '');
        if (source.length > this.maxEncodeCacheChars) return '';
        return JSON.stringify({
            addBos: options.addBos ?? false,
            addEos: options.addEos ?? false,
            maxPieceSearchLength: options.maxPieceSearchLength ?? null,
            unknownPenalty: options.unknownPenalty ?? null,
            mode: this.mode,
            name: this.name,
            text: source,
        });
    }

    storeEncodeCache(key, ids) {
        if (!key || !Array.isArray(ids)) return;
        if (this.encodeCache.has(key)) this.encodeCache.delete(key);
        while (this.encodeCache.size >= this.maxEncodeCacheEntries && this.encodeCache.size) {
            let oldestKey = '';
            let oldestUsed = Number.POSITIVE_INFINITY;
            for (const [candidateKey, entry] of this.encodeCache.entries()) {
                const used = Number(entry.lastUsed ?? 0);
                if (used < oldestUsed) {
                    oldestUsed = used;
                    oldestKey = candidateKey;
                }
            }
            if (!oldestKey) break;
            this.encodeCache.delete(oldestKey);
            this.encodeCacheStats.evictions++;
        }
        this.encodeCache.set(key, {
            ids: ids.slice(),
            tokenCount: ids.length,
            lastUsed: Date.now(),
        });
        this.encodeCacheStats.inserts++;
    }

    cacheStats() {
        let tokens = 0;
        for (const entry of this.encodeCache.values()) tokens += Number(entry.tokenCount ?? 0);
        return {
            encodeEntries: this.encodeCache.size,
            encodeTokens: tokens,
            maxEncodeEntries: this.maxEncodeCacheEntries,
            maxEncodeChars: this.maxEncodeCacheChars,
            ...this.encodeCacheStats,
            blockedTokenEntries: this.blockedTokenCache.size,
            blockedTokenHits: this.blockedTokenCacheStats.hits,
            blockedTokenMisses: this.blockedTokenCacheStats.misses,
        };
    }

    _ensureLookup() {
        if (this.tokenToId) return;
        this.tokenToId = new Map();
        this.mergeRanks = new Map();
        this.maxTokenLength = 0;
        this.scoreValues = new Float32Array(this.tokens.length);
        for (let i = 0; i < this.tokens.length; i++) {
            const token = this.tokens[i];
            const score = Number(this.scores?.[i]);
            this.scoreValues[i] = Number.isFinite(score) ? score : -20;
            if (typeof token !== 'string') continue;
            if (!this.tokenToId.has(token)) this.tokenToId.set(token, i);
            this.maxTokenLength = Math.max(this.maxTokenLength, token.length);
        }
        for (let i = 0; i < this.merges.length; i++) {
            const pair = parseMergePair(this.merges[i]);
            if (!pair) continue;
            if (!this.tokenToId.has(pair.left + pair.right)) continue;
            const key = pairKey(pair.left, pair.right);
            if (!this.mergeRanks.has(key)) this.mergeRanks.set(key, i);
        }
    }

    info() {
        this._ensureLookup();
        return {
            name: this.name,
            vocabSize: this.vocabSize,
            loaded: this.loaded,
            mode: this.mode,
            specialTokens: this.specialTokens,
            specialTokenIds: this.specialTokenIds,
            hasVocabulary: this.tokens.length > 0,
            hasScores: this._hasUsableScores(),
            hasMerges: this.merges.length > 0,
            mergeCount: this.merges.length,
            mergeRankCount: this.mergeRanks?.size ?? 0,
            cache: this.cacheStats(),
            algorithm: this._isBpe()
                ? 'bpe-merge-rank'
                : (this._hasUsableScores() ? 'sentencepiece-unigram-viterbi' : 'greedy-longest-match'),
        };
    }

    workerState() {
        return {
            name: this.name,
            vocabSize: this.vocabSize,
            specialTokens: this.specialTokens,
            specialTokenIds: this.specialTokenIds,
            metadata: {},
            loaded: this.loaded,
            mode: this.mode,
            tokens: this.tokens,
            scores: this.scores,
            merges: this.merges,
            maxEncodeCacheEntries: this.maxEncodeCacheEntries,
            maxEncodeCacheChars: this.maxEncodeCacheChars,
        };
    }

    _isBpe() {
        return String(this.name).toLowerCase() === 'gemma4' || this.merges.length > 0;
    }
}

function normalizeSentencePieceInput(text) {
    const source = String(text ?? '').replace(/\r\n/g, '\n').replace(/\t/g, ' ').trim();
    if (!source) return '';
    return '▁' + source.replace(/ /g, '▁');
}

function normalizeGemmaBpeInput(text) {
    return String(text ?? '').replace(/\r\n/g, '\n').replace(/ /g, '▁');
}

function parseMergePair(value) {
    if (Array.isArray(value) && value.length >= 2) return { left: String(value[0]), right: String(value[1]) };
    const text = String(value ?? '');
    const index = text.lastIndexOf(' ');
    if (index <= 0 || index >= text.length - 1) return null;
    return { left: text.slice(0, index), right: text.slice(index + 1) };
}

function pairKey(left, right) {
    return `${left}\u0000${right}`;
}

function heapPush(heap, value) {
    heap.push(value);
    let index = heap.length - 1;
    while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (!mergeCandidateBefore(value, heap[parent])) break;
        heap[index] = heap[parent];
        index = parent;
    }
    heap[index] = value;
}

function heapPop(heap) {
    const first = heap[0];
    const last = heap.pop();
    if (!heap.length) return first;
    let index = 0;
    while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= heap.length) break;
        let child = left;
        if (right < heap.length && mergeCandidateBefore(heap[right], heap[left])) child = right;
        if (!mergeCandidateBefore(heap[child], last)) break;
        heap[index] = heap[child];
        index = child;
    }
    heap[index] = last;
    return first;
}

function mergeCandidateBefore(left, right) {
    return left.rank < right.rank || (left.rank === right.rank && left.order < right.order);
}

function isUnsafeGeneratedToken(token, { asciiOnly = false, plainTextOnly = true } = {}) {
    if (!token) return false;
    if (token.includes('<') || token.includes('>')) return true;
    if (token.includes('<|') || token.includes('|>') || token.includes('<turn|>')) return true;
    if (token.includes('<image') || token.includes('image|>')) return true;
    if (token.includes('<audio') || token.includes('audio|>')) return true;
    if (token.includes('<video') || token.includes('video|>')) return true;
    if (/^<unused\d+>$/.test(token)) return true;
    if (plainTextOnly && /(?:\*\*|__|```|`|<\/?[a-z][a-z0-9_-]*)/i.test(token)) return true;
    if (plainTextOnly && /^[\s▁]*[#*_~|\\/{}`[\]()<>]+[\s▁]*$/.test(token)) return true;
    if (plainTextOnly && isUrlLikeToken(token)) return true;
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(token)) return true;
    if (!asciiOnly) return false;
    for (let i = 0; i < token.length; i++) {
        const code = token.charCodeAt(i);
        if (code <= 0x7f) continue;
        if (token[i] === '▁') continue;
        return true;
    }
    return false;
}

function isUrlLikeToken(token) {
    const value = String(token ?? '').replace(/▁/g, ' ').trim().toLowerCase();
    if (!value) return false;
    if (value === 'http' || value === 'https' || value === 'www') return true;
    if (value.includes('://') || value.includes('www.')) return true;
    if (/\.(?:com|net|org|io|ai|app|dev|gg|co|us|uk|ca)\b/.test(value)) return true;
    if (/^[./:]+$/.test(value) && value.includes('/')) return true;
    return false;
}

function isUnsafePlainChatToken(token) {
    const value = String(token ?? '').replace(/▁/g, ' ').trim();
    if (!value) return false;
    if (/[$@\\{}[\]^=]/.test(value)) return true;
    if (/\b(?:WriteLine|Profiler|PlayerDataCache|dataGridView|lexemeCount)\b/i.test(value)) return true;
    if (/[A-Za-z]{1,3}\d/.test(value)) return true;
    if (/[a-z][A-Z][a-zA-Z]{2,}/.test(value)) return true;
    if (/^[A-Z0-9_.-]{3,}$/.test(value) && /[A-Z]/.test(value)) return true;
    if (/^[^\w\s.,!?;:'"()/-]+$/.test(value)) return true;
    return false;
}

function tokenKeyFor(tokens, text) {
    for (const [key, value] of Object.entries(tokens)) {
        if (value === text) return key;
    }
    return '';
}

export default Tokenizer;
