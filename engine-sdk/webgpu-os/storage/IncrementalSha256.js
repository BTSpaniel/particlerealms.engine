// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);

function rotr(value, count) {
    return (value >>> count) | (value << (32 - count));
}

/** Incremental SHA-256 with fixed 64-byte working storage. */
export class IncrementalSha256 {
    constructor() {
        this.state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
        this.buffer = new Uint8Array(64);
        this.bufferLength = 0;
        this.bytesHashed = 0;
        this.finished = false;
        this.words = new Uint32Array(64);
    }

    update(input) {
        if (this.finished) throw new Error('SHA-256 digest is already finalized');
        const bytes = input instanceof Uint8Array
            ? input
            : ArrayBuffer.isView(input)
                ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
                : null;
        if (!bytes) throw new TypeError('SHA-256 input must be an ArrayBuffer view');
        if (!Number.isSafeInteger(this.bytesHashed + bytes.byteLength)) throw new RangeError('SHA-256 input exceeds the safe byte range');
        this.bytesHashed += bytes.byteLength;
        let position = 0;
        while (position < bytes.length) {
            const take = Math.min(bytes.length - position, 64 - this.bufferLength);
            this.buffer.set(bytes.subarray(position, position + take), this.bufferLength);
            this.bufferLength += take;
            position += take;
            if (this.bufferLength === 64) {
                this._compress(this.buffer);
                this.bufferLength = 0;
            }
        }
        return this;
    }

    hex() {
        if (!this.finished) this._finish();
        return [...this.state].map(value => value.toString(16).padStart(8, '0')).join('');
    }

    _finish() {
        const bitsHigh = Math.floor(this.bytesHashed / 0x20000000);
        const bitsLow = (this.bytesHashed << 3) >>> 0;
        this.buffer[this.bufferLength++] = 0x80;
        if (this.bufferLength > 56) {
            this.buffer.fill(0, this.bufferLength);
            this._compress(this.buffer);
            this.bufferLength = 0;
        }
        this.buffer.fill(0, this.bufferLength, 56);
        const view = new DataView(this.buffer.buffer);
        view.setUint32(56, bitsHigh, false);
        view.setUint32(60, bitsLow, false);
        this._compress(this.buffer);
        this.finished = true;
    }

    _compress(chunk) {
        const words = this.words;
        const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(index * 4, false);
        for (let index = 16; index < 64; index += 1) {
            const left = words[index - 15];
            const right = words[index - 2];
            const sigma0 = rotr(left, 7) ^ rotr(left, 18) ^ (left >>> 3);
            const sigma1 = rotr(right, 17) ^ rotr(right, 19) ^ (right >>> 10);
            words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
        }
        let [a, b, c, d, e, f, g, h] = this.state;
        for (let index = 0; index < 64; index += 1) {
            const sigma1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const choice = (e & f) ^ (~e & g);
            const temporary1 = (h + sigma1 + choice + K[index] + words[index]) >>> 0;
            const sigma0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temporary2 = (sigma0 + majority) >>> 0;
            h = g; g = f; f = e; e = (d + temporary1) >>> 0; d = c; c = b; b = a; a = (temporary1 + temporary2) >>> 0;
        }
        this.state[0] = (this.state[0] + a) >>> 0;
        this.state[1] = (this.state[1] + b) >>> 0;
        this.state[2] = (this.state[2] + c) >>> 0;
        this.state[3] = (this.state[3] + d) >>> 0;
        this.state[4] = (this.state[4] + e) >>> 0;
        this.state[5] = (this.state[5] + f) >>> 0;
        this.state[6] = (this.state[6] + g) >>> 0;
        this.state[7] = (this.state[7] + h) >>> 0;
    }
}
