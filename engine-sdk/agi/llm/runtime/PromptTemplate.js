// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const GEMMA4_SPECIAL_TOKENS = Object.freeze({
    bos: '<bos>',
    eos: '<eos>',
    startTurn: '<|turn>',
    endTurn: '<turn|>',
    startChannel: '<|channel>',
    endChannel: '<channel|>',
    think: '<|think|>',
    toolCall: '<|tool_call>',
    toolCallEnd: '<tool_call|>',
    toolResponse: '<|tool_response>',
});

export class PromptTemplate {
    constructor(options = {}) {
        this.specialTokens = { ...GEMMA4_SPECIAL_TOKENS, ...(options.specialTokens ?? {}) };
        this.defaultSystem = options.defaultSystem ?? '';
    }

    formatChat(messages = [], options = {}) {
        const system = options.system ?? this.defaultSystem;
        const turns = [];
        if (system) turns.push({ role: 'system', content: system });
        for (const msg of messages) {
            if (!msg || typeof msg.content !== 'string') continue;
            turns.push({ role: normalizeRole(msg.role), content: msg.content });
        }
        const continueFinal = options.continueFinalMessage === true;
        const finalIndex = turns.length - 1;
        const parts = [this.specialTokens.bos];
        let continuedFinal = false;
        for (let index = 0; index < turns.length; index++) {
            const turn = turns[index];
            const isFinalAssistant = continueFinal && index === finalIndex && turn.role === 'model';
            if (isFinalAssistant) {
                parts.push(`${this.specialTokens.startTurn}${turn.role}\n${turn.content}`);
                continuedFinal = true;
                continue;
            }
            parts.push(`${this.specialTokens.startTurn}${turn.role}\n${turn.content}${this.specialTokens.endTurn}\n`);
        }
        if (!continuedFinal && options.addAssistantPrefix !== false) {
            parts.push(`${this.specialTokens.startTurn}model\n`);
        }
        return parts.join('');
    }

    preview(messages = [], options = {}) {
        const text = this.formatChat(messages, options);
        return {
            format: 'gemma4-chat',
            text,
            charCount: text.length,
            byteCount: new TextEncoder().encode(text).byteLength,
            continueFinalMessage: options.continueFinalMessage === true,
        };
    }
}

function normalizeRole(role) {
    if (role === 'assistant' || role === 'model') return 'model';
    if (role === 'system' || role === 'tool') return role;
    return 'user';
}

export default PromptTemplate;
