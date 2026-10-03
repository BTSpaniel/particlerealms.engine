// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export function createCapsuleGeometry(radius = 0.3, height = 1.0, radialSegments = 16, hemisphereSegments = 8) {
    radialSegments = Number.isFinite(Number(radialSegments)) ? Math.max(3, Math.floor(Number(radialSegments))) : 3;
    hemisphereSegments = Number.isFinite(Number(hemisphereSegments)) ? Math.max(1, Math.floor(Number(hemisphereSegments))) : 1;
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    
    const cylinderHeight = height - radius * 2;
    const halfCylinder = cylinderHeight / 2;
    
    for (let y = 0; y <= hemisphereSegments; y++) {
        const theta = (y / hemisphereSegments) * Math.PI * 0.5;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        
        for (let x = 0; x <= radialSegments; x++) {
            const phi = (x / radialSegments) * Math.PI * 2;
            const sinPhi = Math.sin(phi);
            const cosPhi = Math.cos(phi);
            
            const nx = sinTheta * cosPhi;
            const ny = cosTheta;
            const nz = sinTheta * sinPhi;
            
            positions.push(radius * nx, halfCylinder + radius * ny, radius * nz);
            normals.push(nx, ny, nz);
            uvs.push(x / radialSegments, y / (hemisphereSegments * 4));
        }
    }
    
    const topRingStart = (hemisphereSegments + 1) * (radialSegments + 1);
    for (let x = 0; x <= radialSegments; x++) {
        const phi = (x / radialSegments) * Math.PI * 2;
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);
        
        positions.push(radius * cosPhi, -halfCylinder, radius * sinPhi);
        normals.push(cosPhi, 0, sinPhi);
        uvs.push(x / radialSegments, 0.75);
    }
    
    const bottomHemiStart = topRingStart + radialSegments + 1;
    for (let y = 0; y <= hemisphereSegments; y++) {
        const theta = Math.PI * 0.5 + (y / hemisphereSegments) * Math.PI * 0.5;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        
        for (let x = 0; x <= radialSegments; x++) {
            const phi = (x / radialSegments) * Math.PI * 2;
            const sinPhi = Math.sin(phi);
            const cosPhi = Math.cos(phi);
            
            const nx = sinTheta * cosPhi;
            const ny = cosTheta;
            const nz = sinTheta * sinPhi;
            
            positions.push(radius * nx, -halfCylinder + radius * ny, radius * nz);
            normals.push(nx, ny, nz);
            uvs.push(x / radialSegments, 0.75 + y / (hemisphereSegments * 4));
        }
    }
    
    for (let y = 0; y < hemisphereSegments; y++) {
        for (let x = 0; x < radialSegments; x++) {
            const a = y * (radialSegments + 1) + x;
            const b = a + radialSegments + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    
    const lastTopRow = hemisphereSegments * (radialSegments + 1);
    for (let x = 0; x < radialSegments; x++) {
        const a = lastTopRow + x;
        const b = topRingStart + x;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
    
    for (let x = 0; x < radialSegments; x++) {
        const a = topRingStart + x;
        const b = bottomHemiStart + x;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
    
    for (let y = 0; y < hemisphereSegments; y++) {
        for (let x = 0; x < radialSegments; x++) {
            const a = bottomHemiStart + y * (radialSegments + 1) + x;
            const b = a + radialSegments + 1;
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
