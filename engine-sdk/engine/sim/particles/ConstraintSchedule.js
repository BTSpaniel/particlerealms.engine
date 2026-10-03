// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Independent constraints share a dispatch; shared particles require a barrier. */
export function buildConstraintSchedule(records) {
    const colors = [], occupied = [];
    records.forEach((data, index) => {
        if (!data || (data[15] & 1)) return;
        const type = data[0];
        const particles = [data[1]];
        if (type !== 1 && data[2] !== 0xffffffff) particles.push(data[2]);
        if (type === 2 || type === 3) particles.push(data[3]);
        let color = 0;
        while (occupied[color] && particles.some(p => occupied[color].has(p))) color++;
        colors[color] ??= []; occupied[color] ??= new Set();
        colors[color].push(index); particles.forEach(p => occupied[color].add(p));
    });
    return colors;
}

export function refreshConstraintSchedule(system, device) {
    if (!system.scheduleDirty || !system.bindingEntries) return;
    for (const batch of system.batches) batch.params.destroy();
    const colors = buildConstraintSchedule(system.records);
    if (colors.length) device.queue.writeBuffer(system.scheduleBuffer, 0, new Uint32Array(colors.flat()));
    let offset = 0;
    system.batches = colors.map(indices => {
        const params = device.createBuffer({ label: 'RopeConstraint.batch', size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const entries = system.bindingEntries.map(e => e.binding === 0 ? { binding: 0, resource: { buffer: params } } : e);
        const bindGroup = device.createBindGroup({ layout: system.pipeline.getBindGroupLayout(0), entries });
        const batch = { params, bindGroup, count: indices.length, offset };
        offset += indices.length;
        return batch;
    });
    system.scheduleDirty = false;
}
