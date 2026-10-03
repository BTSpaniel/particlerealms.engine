// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export function createConeGeometry(radius = 0.5, height = 1.0, segments = 16) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    
    const halfHeight = height / 2;
    const slopeAngle = Math.atan2(radius, height);
    const ny = Math.cos(slopeAngle);
    const nLen = Math.sin(slopeAngle);
    
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        
        positions.push(0, halfHeight, 0);
        normals.push(cos * nLen, ny, sin * nLen);
        uvs.push(i / segments, 0);
        
        positions.push(cos * radius, -halfHeight, sin * radius);
        normals.push(cos * nLen, ny, sin * nLen);
        uvs.push(i / segments, 1);
    }
    
    for (let i = 0; i < segments; i++) {
        const tip = i * 2;
        const base1 = tip + 1;
        const base2 = tip + 3;
        indices.push(tip, base1, base2);
    }
    
    const baseCenterIndex = positions.length / 3;
    positions.push(0, -halfHeight, 0);
    normals.push(0, -1, 0);
    uvs.push(0.5, 0.5);
    
    const baseRingStart = positions.length / 3;
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        positions.push(Math.cos(angle) * radius, -halfHeight, Math.sin(angle) * radius);
        normals.push(0, -1, 0);
        uvs.push(0.5 + Math.cos(angle) * 0.5, 0.5 - Math.sin(angle) * 0.5);
    }
    
    for (let i = 0; i < segments; i++) {
        indices.push(baseCenterIndex, baseRingStart + i + 1, baseRingStart + i);
    }
    
    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        indices: new Uint16Array(indices),
    };
}
