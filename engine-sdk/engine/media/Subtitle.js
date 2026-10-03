// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const MAX_BYTES = 1024 * 1024;
const MAX_CUES = 20000;

function timestamp(value) {
    const match = /^(?:(\d{1,3}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value.trim());
    if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) throw new Error('Invalid subtitle timestamp');
    return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

/** Parse SRT/WebVTT into bounded plain-text cues; cue text never becomes HTML. */
export function parseSubtitles(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('Subtitle exceeds 1 MiB');
    const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
    const cues = [];
    for (const block of blocks) {
        const lines = block.split('\n');
        if (/^(WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0])) continue;
        const index = lines.findIndex(line => line.includes('-->'));
        if (index < 0) continue;
        const match = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(lines[index]);
        if (!match) throw new Error('Invalid subtitle cue');
        const start = timestamp(match[1]), end = timestamp(match[2]);
        if (end <= start) throw new Error('Subtitle cue ends before it starts');
        const content = lines.slice(index + 1).join('\n').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        if (content.length > 10000) throw new Error('Subtitle cue is too long');
        cues.push(Object.freeze({ start, end, text: content }));
        if (cues.length > MAX_CUES) throw new Error('Too many subtitle cues');
    }
    return cues.sort((a, b) => a.start - b.start);
}

export function subtitleTextAt(cues, position) {
    return cues.filter(cue => cue.start <= position && cue.end > position).map(cue => cue.text).join('\n');
}

export function subtitlesToVtt(cues) {
    const format = time => {
        const ms = Math.round(time * 1000);
        return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
    };
    return 'WEBVTT\n\n' + cues.map((cue, index) => `${index + 1}\n${format(cue.start)} --> ${format(cue.end)}\n${cue.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}\n`).join('\n');
}
