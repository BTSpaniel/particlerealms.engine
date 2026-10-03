// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { integer, Writer } from './Binary.js';

export class Bits {
    constructor() { this.writer = new Writer(); this.byte = 0; this.used = 0; }
    bit(value) { this.byte = this.byte * 2 + (value ? 1 : 0); if (++this.used === 8) { this.writer.u8(this.byte); this.byte = 0; this.used = 0; } }
    bits(value, count) { for (let i = count - 1; i >= 0; i--) this.bit(Math.floor(value / 2 ** i) % 2); }
    ue(value) { integer(value, 0, 0x7ffffffe, 'Exp-Golomb value'); const code = value + 1, length = Math.floor(Math.log2(code)); for (let i = 0; i < length; i++) this.bit(0); this.bits(code, length + 1); }
    se(value) { this.ue(value > 0 ? value * 2 - 1 : -value * 2); }
    align() { while (this.used) this.bit(0); }
    data(bytes) { if (this.used) throw new Error('samples must be byte aligned'); this.writer.data(bytes); }
    finish(rbsp = true) { if (rbsp) this.bit(1); this.align(); return this.writer.finish(); }
}

export class ReadBits {
    constructor(bytes) { this.bytes = bytes; this.position = 0; }
    bit() { if (this.position >= this.bytes.length * 8) throw new RangeError('truncated codec bitstream'); const result = (this.bytes[this.position >>> 3] >>> (7 - this.position % 8)) & 1; this.position++; return result; }
    bits(count) { let result = 0; for (let i = 0; i < count; i++) result = result * 2 + this.bit(); return result; }
    ue(maximum = 65535) { let leading = 0; while (!this.bit()) { if (++leading > 31) throw new RangeError('Exp-Golomb value exceeds bounds'); } const value = 2 ** leading - 1 + this.bits(leading); return integer(value, 0, maximum, 'Exp-Golomb value'); }
    se() { const value = this.ue(); return value % 2 ? (value + 1) / 2 : -value / 2; }
    align() { while (this.position % 8) if (this.bit()) throw new RangeError('nonzero sample alignment bit'); }
    data(count) { if (this.position % 8 || count > this.bytes.length - this.position / 8) throw new RangeError('truncated aligned samples'); const start = this.position / 8; this.position += count * 8; return this.bytes.subarray(start, start + count); }
    end() { if (this.bit() !== 1) throw new RangeError('missing RBSP stop bit'); this.zeroEnd(); }
    zeroEnd() { if (this.bytes.length * 8 - this.position > 7) throw new RangeError('extra codec bitstream data'); while (this.position < this.bytes.length * 8) if (this.bit()) throw new RangeError('invalid bitstream padding'); }
}
