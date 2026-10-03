// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export function createOrganState(anatomy = null, attachments = null) {
  const organs = anatomy?.organs || {}
  const out = Object.create(null)
  for (const [id, organ] of Object.entries(organs)) {
    out[id] = {
      id,
      container: organ.container || null,
      side: organ.side || 'center',
      vital: !!organ.vital,
      collisionGroup: organ.collisionGroup || 'organ',
      attachmentBones: resolveAttachmentBones(id, organ, attachments),
      integrity: 1,
      perfusion: 1,
      oxygenation: organ.container === 'ribCage' ? 1 : null,
      function: 1,
      status: 'normal',
    }
  }
  return out
}

export function getOrganReadback(organs) {
  if (!organs) return null
  const out = Object.create(null)
  for (const [id, organ] of Object.entries(organs)) {
    out[id] = {
      id,
      container: organ.container,
      side: organ.side,
      vital: organ.vital,
      collisionGroup: organ.collisionGroup,
      attachmentBones: [...organ.attachmentBones],
      integrity: organ.integrity,
      perfusion: organ.perfusion,
      oxygenation: organ.oxygenation,
      function: organ.function,
      status: organ.status,
    }
  }
  return out
}

function resolveAttachmentBones(id, organ, attachments) {
  if (Array.isArray(organ.attachmentBones)) return [...organ.attachmentBones]
  const fromIndex = attachments?.get?.(id)
  if (Array.isArray(fromIndex)) return [...fromIndex]
  return [organ.container].filter(Boolean)
}
