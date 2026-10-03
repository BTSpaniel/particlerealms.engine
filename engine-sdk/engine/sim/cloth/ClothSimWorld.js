// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Core cloth simulation world (CPU, mass-spring / constraint based)
// This module is intentionally minimal for now: it defines the data
// structure and lifecycle, without a full simulation implementation.

export function createClothSimWorld(options = {}) {
  const world = {
    name: typeof options.name === "string" ? options.name : "ClothSimWorld",
    instances: [],
    nextInstanceId: 1,
  };

  return world;
}

export function destroyClothSimWorld(world) {
  if (!world) {
    return;
  }
  world.instances = [];
}

function isCornerPinned(x, y, segmentsX, segmentsY, constraints) {
  if (!constraints) {
    return false;
  }

  const atTop = y === 0;
  const atBottom = y === segmentsY;
  const atLeft = x === 0;
  const atRight = x === segmentsX;

  if (atTop && atLeft && constraints.attachTopLeft) {
    return true;
  }
  if (atTop && atRight && constraints.attachTopRight) {
    return true;
  }
  if (atBottom && atLeft && constraints.attachBottomLeft) {
    return true;
  }
  if (atBottom && atRight && constraints.attachBottomRight) {
    return true;
  }

  return false;
}

function buildGridParticlesForInstance(instance) {
  const topology = instance && instance.topology ? instance.topology : null;
  if (!topology || topology.type !== "grid") {
    return;
  }

  const widthValue = Number(topology.width);
  const heightValue = Number(topology.height);
  const width = Number.isFinite(widthValue) && widthValue > 0 ? widthValue : 1;
  const height = Number.isFinite(heightValue) && heightValue > 0 ? heightValue : 1;

  const sxValue = Number(topology.segmentsX);
  const syValue = Number(topology.segmentsY);
  const segmentsX = Number.isFinite(sxValue) && sxValue > 0 ? sxValue | 0 : 10;
  const segmentsY = Number.isFinite(syValue) && syValue > 0 ? syValue | 0 : 10;

  const vertexCountX = segmentsX + 1;
  const vertexCountY = segmentsY + 1;
  const totalVertices = vertexCountX * vertexCountY;
  if (totalVertices <= 0) {
    instance.particles = [];
    instance.vertexCountX = 0;
    instance.vertexCountY = 0;
    return;
  }

  const material = instance.material || {};
  const densityValue = Number(material.density);
  const density = Number.isFinite(densityValue) && densityValue > 0 ? densityValue : 1;

  const area = width * height;
  let massPerVertex = area * density / totalVertices;
  if (!Number.isFinite(massPerVertex) || massPerVertex <= 0) {
    massPerVertex = 1;
  }
  const baseInvMass = 1 / massPerVertex;

  const transform = instance.transform || {};
  const position = Array.isArray(transform.position) ? transform.position : [0, 0, 0];
  const originX = Number.isFinite(position[0]) ? position[0] : 0;
  const originY = Number.isFinite(position[1]) ? position[1] : 0;
  const originZ = Number.isFinite(position[2]) ? position[2] : 0;

  const invSegmentsX = segmentsX > 0 ? 1 / segmentsX : 0;
  const invSegmentsY = segmentsY > 0 ? 1 / segmentsY : 0;

  const particles = new Array(totalVertices);

  let index = 0;
  for (let y = 0; y < vertexCountY; y++) {
    const v = segmentsY > 0 ? y * invSegmentsY : 0;
    const restY = originY - v * height;

    for (let x = 0; x < vertexCountX; x++) {
      const u = segmentsX > 0 ? x * invSegmentsX : 0;
      const restX = originX + (u * width - width * 0.5);
      const restZ = originZ;

      const fixed = isCornerPinned(x, y, segmentsX, segmentsY, instance.constraints);
      const invMass = fixed ? 0 : baseInvMass;

      const posX = restX;
      const posY = restY;
      const posZ = restZ;

      const restPosition = [posX, posY, posZ];
      const positionVec = [posX, posY, posZ];
      const prevPosition = [posX, posY, posZ];

      const anchorOffset = fixed
        ? [posX - originX, posY - originY, posZ - originZ]
        : null;

      particles[index] = {
        position: positionVec,
        prevPosition,
        restPosition,
        invMass,
        fixed,
        anchorOffset,
      };

      index++;
    }
  }

  instance.particles = particles;
  instance.vertexCountX = vertexCountX;
  instance.vertexCountY = vertexCountY;
  instance.segmentsX = segmentsX;
  instance.segmentsY = segmentsY;
  instance.restLengthX = segmentsX > 0 ? width / segmentsX : 0;
  instance.restLengthY = segmentsY > 0 ? height / segmentsY : 0;
}

function applySpring(p1, p2, restLength, stiffness) {
  if (!p1 || !p2) {
    return;
  }
  if (!Number.isFinite(restLength) || restLength <= 0) {
    return;
  }
  if (!Number.isFinite(stiffness) || stiffness <= 0) {
    return;
  }
  const pos1 = p1.position;
  const pos2 = p2.position;
  if (!pos1 || !pos2 || pos1.length < 3 || pos2.length < 3) {
    return;
  }
  const dx = pos2[0] - pos1[0];
  const dy = pos2[1] - pos1[1];
  const dz = pos2[2] - pos1[2];
  const distSq = dx * dx + dy * dy + dz * dz;
  if (!(distSq > 0)) {
    return;
  }
  const dist = Math.sqrt(distSq);
  if (!Number.isFinite(dist) || dist <= 0) {
    return;
  }
  const diff = (dist - restLength) / dist;
  const force = diff * stiffness * 0.5;
  if (!p1.fixed && p1.invMass !== 0) {
    pos1[0] += dx * force;
    pos1[1] += dy * force;
    pos1[2] += dz * force;
  }
  if (!p2.fixed && p2.invMass !== 0) {
    pos2[0] -= dx * force;
    pos2[1] -= dy * force;
    pos2[2] -= dz * force;
  }
}

function updateGridRenderDataForInstance(instance) {
  if (!instance || !Array.isArray(instance.particles)) {
    return;
  }

  const topology = instance.topology || {};
  if (topology.type !== "grid") {
    return;
  }

  const vertexCountX = instance.vertexCountX | 0;
  const vertexCountY = instance.vertexCountY | 0;
  if (vertexCountX <= 0 || vertexCountY <= 0) {
    return;
  }

  const totalVertices = vertexCountX * vertexCountY;
  if (totalVertices <= 0) {
    return;
  }

  const particles = instance.particles;
  if (particles.length < totalVertices) {
    return;
  }

  let render = instance.render;
  if (!render) {
    render = {
      positions: null,
      normals: null,
      indices: null,
      vertexCount: 0,
      indexCount: 0,
    };
    instance.render = render;
  }

  const positionCount = totalVertices * 3;
  if (!render.positions || render.positions.length !== positionCount) {
    render.positions = new Float32Array(positionCount);
  }
  if (!render.normals || render.normals.length !== positionCount) {
    render.normals = new Float32Array(positionCount);
  }

  const segmentsX = instance.segmentsX | 0;
  const segmentsY = instance.segmentsY | 0;
  let expectedIndexCount = 0;
  if (segmentsX > 0 && segmentsY > 0) {
    expectedIndexCount = segmentsX * segmentsY * 6;
  }

  if (
    expectedIndexCount > 0 &&
    (!render.indices || render.indices.length !== expectedIndexCount)
  ) {
    const useUint32 = totalVertices > 65535;
    const indices = useUint32
      ? new Uint32Array(expectedIndexCount)
      : new Uint16Array(expectedIndexCount);

    let offset = 0;
    for (let y = 0; y < segmentsY; y++) {
      for (let x = 0; x < segmentsX; x++) {
        const i0 = y * vertexCountX + x;
        const i1 = i0 + 1;
        const i2 = i0 + vertexCountX;
        const i3 = i2 + 1;

        indices[offset + 0] = i0;
        indices[offset + 1] = i2;
        indices[offset + 2] = i1;
        indices[offset + 3] = i1;
        indices[offset + 4] = i2;
        indices[offset + 5] = i3;
        offset += 6;
      }
    }

    render.indices = indices;
    render.indexCount = expectedIndexCount;
  }

  const positions = render.positions;
  const normals = render.normals;
  const indices = render.indices;

  if (!positions || !normals || !indices || indices.length === 0) {
    return;
  }

  for (let i = 0; i < totalVertices; i++) {
    const p = particles[i];
    const pos = p && p.position;
    const base = i * 3;
    if (!pos || pos.length < 3) {
      positions[base + 0] = 0;
      positions[base + 1] = 0;
      positions[base + 2] = 0;
    } else {
      positions[base + 0] = pos[0];
      positions[base + 1] = pos[1];
      positions[base + 2] = pos[2];
    }
    normals[base + 0] = 0;
    normals[base + 1] = 0;
    normals[base + 2] = 0;
  }

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i + 0] | 0;
    const i1 = indices[i + 1] | 0;
    const i2 = indices[i + 2] | 0;

    if (
      i0 < 0 ||
      i1 < 0 ||
      i2 < 0 ||
      i0 >= totalVertices ||
      i1 >= totalVertices ||
      i2 >= totalVertices
    ) {
      continue;
    }

    const b0 = i0 * 3;
    const b1 = i1 * 3;
    const b2 = i2 * 3;

    const x0 = positions[b0 + 0];
    const y0 = positions[b0 + 1];
    const z0 = positions[b0 + 2];
    const x1 = positions[b1 + 0];
    const y1 = positions[b1 + 1];
    const z1 = positions[b1 + 2];
    const x2 = positions[b2 + 0];
    const y2 = positions[b2 + 1];
    const z2 = positions[b2 + 2];

    const e1x = x1 - x0;
    const e1y = y1 - y0;
    const e1z = z1 - z0;
    const e2x = x2 - x0;
    const e2y = y2 - y0;
    const e2z = z2 - z0;

    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    normals[b0 + 0] += nx;
    normals[b0 + 1] += ny;
    normals[b0 + 2] += nz;
    normals[b1 + 0] += nx;
    normals[b1 + 1] += ny;
    normals[b1 + 2] += nz;
    normals[b2 + 0] += nx;
    normals[b2 + 1] += ny;
    normals[b2 + 2] += nz;
  }

  for (let i = 0; i < totalVertices; i++) {
    const base = i * 3;
    const nx = normals[base + 0];
    const ny = normals[base + 1];
    const nz = normals[base + 2];
    const lenSq = nx * nx + ny * ny + nz * nz;
    if (lenSq > 0) {
      const invLen = 1 / Math.sqrt(lenSq);
      normals[base + 0] = nx * invLen;
      normals[base + 1] = ny * invLen;
      normals[base + 2] = nz * invLen;
    } else {
      normals[base + 0] = 0;
      normals[base + 1] = 1;
      normals[base + 2] = 0;
    }
  }

  render.vertexCount = totalVertices;
}

export function addClothInstance(world, descriptor) {
  if (!world) {
    throw new Error("addClothInstance: world is required");
  }

  const id = world.nextInstanceId | 0;
  world.nextInstanceId = id + 1;

  const instance = {
    id,
    entityId: descriptor && descriptor.entityId !== undefined ? descriptor.entityId : null,
    topology: descriptor && descriptor.topology ? descriptor.topology : null,
    material: descriptor && descriptor.material ? descriptor.material : null,
    constraints: descriptor && descriptor.constraints ? descriptor.constraints : null,
    transform: descriptor && descriptor.transform ? descriptor.transform : null,
    // Simulation buffers/structures will be allocated in a later step.
    particles: null,
    structuralConstraints: null,
    bendConstraints: null,
    shearConstraints: null,
  };

  buildGridParticlesForInstance(instance);

  world.instances.push(instance);
  return instance.id;
}

export function removeClothInstance(world, instanceId) {
  if (!world || !Array.isArray(world.instances)) {
    return;
  }
  const id = instanceId | 0;
  const list = world.instances;
  for (let i = 0; i < list.length; i++) {
    const inst = list[i];
    if (inst && inst.id === id) {
      list.splice(i, 1);
      return;
    }
  }
}

export function stepClothSimWorld(world, deltaSeconds, options = {}) {
  if (!world || !Array.isArray(world.instances)) {
    return;
  }

  const dtRaw = Number(deltaSeconds);
  if (!Number.isFinite(dtRaw) || dtRaw <= 0) {
    return;
  }

  const maxDtOption = options.maxDelta;
  let maxDt = 0.05;
  if (
    typeof maxDtOption === "number" &&
    Number.isFinite(maxDtOption) &&
    maxDtOption > 0
  ) {
    maxDt = maxDtOption;
  }

  const dt = dtRaw > maxDt ? maxDt : dtRaw;
  const dt2 = dt * dt;

  const baseGravity = -9.81;

  const collisionResolver =
    options && typeof options.resolveParticleCollision === "function"
      ? options.resolveParticleCollision
      : null;

  for (let i = 0; i < world.instances.length; i++) {
    const instance = world.instances[i];
    if (!instance || !Array.isArray(instance.particles)) {
      continue;
    }

    const particles = instance.particles;
    if (!particles.length) {
      continue;
    }

    const material = instance.material || {};
    const gravityScaleRaw = Number(material.gravityScale);
    const gravityScale =
      Number.isFinite(gravityScaleRaw) && gravityScaleRaw > 0
        ? gravityScaleRaw
        : 1;

    const dampingRaw = Number(material.damping);
    let damping = 0;
    if (Number.isFinite(dampingRaw) && dampingRaw >= 0) {
      if (dampingRaw > 1) {
        damping = 1;
      } else {
        damping = dampingRaw;
      }
    }

    const gravityY = baseGravity * gravityScale;

    for (let p = 0; p < particles.length; p++) {
      const particle = particles[p];
      if (!particle || particle.fixed || particle.invMass === 0) {
        continue;
      }

      const pos = particle.position;
      const prev = particle.prevPosition;
      if (!pos || !prev || pos.length < 3 || prev.length < 3) {
        continue;
      }

      const currentX = pos[0];
      const currentY = pos[1];
      const currentZ = pos[2];

      const velX = (pos[0] - prev[0]) * (1 - damping);
      const velY = (pos[1] - prev[1]) * (1 - damping);
      const velZ = (pos[2] - prev[2]) * (1 - damping);

      const accelX = 0;
      const accelY = gravityY;
      const accelZ = 0;

      pos[0] = pos[0] + velX + accelX * dt2;
      pos[1] = pos[1] + velY + accelY * dt2;
      pos[2] = pos[2] + velZ + accelZ * dt2;

      prev[0] = currentX;
      prev[1] = currentY;
      prev[2] = currentZ;
    }

    const vertexCountX = instance.vertexCountX | 0;
    const vertexCountY = instance.vertexCountY | 0;
    if (vertexCountX <= 0 || vertexCountY <= 0) {
      continue;
    }

    const restLengthX = instance.restLengthX;
    const restLengthY = instance.restLengthY;

    const stretchRaw = Number(material.stretchStiffness);
    let stretchStiffness = 1;
    if (Number.isFinite(stretchRaw) && stretchRaw > 0) {
      stretchStiffness = stretchRaw;
    }

    const bendRaw = Number(material.bendStiffness);
    let bendStiffness = 0;
    if (Number.isFinite(bendRaw) && bendRaw > 0) {
      bendStiffness = bendRaw;
    }

    const shearRestLength =
      restLengthX > 0 && restLengthY > 0
        ? Math.sqrt(restLengthX * restLengthX + restLengthY * restLengthY)
        : 0;
    const bendRestLengthX = restLengthX > 0 ? restLengthX * 2 : 0;
    const bendRestLengthY = restLengthY > 0 ? restLengthY * 2 : 0;

    const iterationsOption = options.structuralIterations;
    let iterations = 1;
    if (
      typeof iterationsOption === "number" &&
      Number.isFinite(iterationsOption) &&
      iterationsOption >= 1
    ) {
      const it = iterationsOption | 0;
      iterations = it > 0 ? it : 1;
    }

    for (let iter = 0; iter < iterations; iter++) {
      for (let y = 0; y < vertexCountY; y++) {
        for (let x = 0; x < vertexCountX; x++) {
          const index = y * vertexCountX + x;
          const p1 = particles[index];
          if (!p1) {
            continue;
          }

          if (x < vertexCountX - 1 && restLengthX > 0) {
            const p2 = particles[index + 1];
            applySpring(p1, p2, restLengthX, stretchStiffness);
          }
          if (y < vertexCountY - 1 && restLengthY > 0) {
            const p3 = particles[index + vertexCountX];
            applySpring(p1, p3, restLengthY, stretchStiffness);
          }

          if (
            shearRestLength > 0 &&
            stretchStiffness > 0 &&
            y < vertexCountY - 1
          ) {
            if (x < vertexCountX - 1) {
              const pDiag1 = particles[index + vertexCountX + 1];
              applySpring(p1, pDiag1, shearRestLength, stretchStiffness);
            }
            if (x > 0) {
              const pDiag2 = particles[index + vertexCountX - 1];
              applySpring(p1, pDiag2, shearRestLength, stretchStiffness);
            }
          }

          if (bendStiffness > 0) {
            if (bendRestLengthX > 0 && x < vertexCountX - 2) {
              const pBx = particles[index + 2];
              applySpring(p1, pBx, bendRestLengthX, bendStiffness);
            }
            if (bendRestLengthY > 0 && y < vertexCountY - 2) {
              const pBy = particles[index + vertexCountX * 2];
              applySpring(p1, pBy, bendRestLengthY, bendStiffness);
            }
          }
        }
      }
    }

    if (collisionResolver) {
      for (let p = 0; p < particles.length; p++) {
        const particle = particles[p];
        if (!particle || particle.fixed || particle.invMass === 0) {
          continue;
        }
        const pos = particle.position;
        const prev = particle.prevPosition;
        if (!pos || !prev || pos.length < 3 || prev.length < 3) {
          continue;
        }
        const result = collisionResolver(instance, particle, prev, pos);
        if (
          result &&
          Array.isArray(result) &&
          result.length >= 3 &&
          Number.isFinite(result[0]) &&
          Number.isFinite(result[1]) &&
          Number.isFinite(result[2])
        ) {
          pos[0] = result[0];
          pos[1] = result[1];
          pos[2] = result[2];
        }
      }
    }

    updateGridRenderDataForInstance(instance);
  }
}

export function getClothInstanceRenderData(world, instanceId) {
  if (!world || !Array.isArray(world.instances)) {
    return null;
  }

  const id = instanceId | 0;
  const instances = world.instances;
  for (let i = 0; i < instances.length; i++) {
    const instance = instances[i];
    if (!instance || instance.id !== id) {
      continue;
    }

    updateGridRenderDataForInstance(instance);

    const render = instance.render;
    if (!render || !render.positions || !render.normals || !render.indices) {
      return null;
    }

    const vertexCountX = instance.vertexCountX | 0;
    const vertexCountY = instance.vertexCountY | 0;
    const vertexCount = vertexCountX > 0 && vertexCountY > 0
      ? vertexCountX * vertexCountY
      : render.vertexCount | 0;

    return {
      positions: render.positions,
      normals: render.normals,
      indices: render.indices,
      vertexCount,
      indexCount: render.indices.length | 0,
      vertexCountX,
      vertexCountY,
    };
  }

  return null;
}
