// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

function wrappedDirection(index, segments) {
    if (index === segments) return { cos: 1, sin: 0 };
    const angle = (index / segments) * Math.PI * 2;
    return { cos: Math.cos(angle), sin: Math.sin(angle) };
}

export function createTorusGeometry(majorRadius = 0.4, minorRadius = 0.15, majorSegments = 24, minorSegments = 12) {
    majorSegments = Number.isFinite(Number(majorSegments)) ? Math.max(3, Math.floor(Number(majorSegments))) : 3;
    minorSegments = Number.isFinite(Number(minorSegments)) ? Math.max(3, Math.floor(Number(minorSegments))) : 3;
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    
    for (let i = 0; i <= majorSegments; i++) {
        const { cos: cosU, sin: sinU } = wrappedDirection(i, majorSegments);
        
        for (let j = 0; j <= minorSegments; j++) {
            const { cos: cosV, sin: sinV } = wrappedDirection(j, minorSegments);
            
            const x = (majorRadius + minorRadius * cosV) * cosU;
            const y = minorRadius * sinV;
            const z = (majorRadius + minorRadius * cosV) * sinU;
            
            positions.push(x, y, z);
            
            const centerX = majorRadius * cosU;
            const centerZ = majorRadius * sinU;
            const nx = x - centerX;
            const ny = y;
            const nz = z - centerZ;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            normals.push(nx / len, ny / len, nz / len);
            uvs.push(i / majorSegments, j / minorSegments);
        }
    }
    
    for (let i = 0; i < majorSegments; i++) {
        for (let j = 0; j < minorSegments; j++) {
            const a = i * (minorSegments + 1) + j;
            const b = a + minorSegments + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    
    const IndexArray = positions.length / 3 > 65_535 ? Uint32Array : Uint16Array;
    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        indices: new IndexArray(indices),
    };
}
