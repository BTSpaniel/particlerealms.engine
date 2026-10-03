// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { normalizePose } from './BodyPoses.js'
import { createNeuralMotor, deserializeMotor, getNeuralInferenceBackendReport } from './NeuralMotor.js'
import { createOrganState, getOrganReadback } from './anatomy/OrganSystem.js'

export function getActiveBodyFallbackReport(gpu = null) {
  const pose = normalizePose({ id: 'fallback_pose', bones: { pelvis: [0, 1, 0] } })
  const organs = createOrganState(null, null)
  const brain = createNeuralMotor('newborn', 'fallback-report')
  const invalidBrainRejected = deserializeMotor(brain, { magic: 'OLD_UNKNOWN_BRAIN', version: 0, bytes: '' }, { silent: true }) === false
  const inference = getNeuralInferenceBackendReport(1, gpu)
  return {
    missingRotation: {
      ok: Array.isArray(pose.rotations?.pelvis) && pose.rotations.pelvis[3] === 1,
      fallback: 'identityQuaternion',
    },
    missingOrganData: {
      ok: Object.keys(organs).length === 0 && getOrganReadback(organs) != null,
      fallback: 'emptyOrganMap',
    },
    missingGpuSupport: {
      ok: inference.backend === 'cpu',
      fallback: inference.backend,
      reason: inference.reason,
    },
    oldSave: {
      ok: invalidBrainRejected,
      fallback: 'rejectInvalidBrainWithoutMutation',
    },
  }
}

export function isActiveBodyFallbackReportOk(report) {
  return !!report
    && report.missingRotation?.ok === true
    && report.missingOrganData?.ok === true
    && report.missingGpuSupport?.ok === true
    && report.oldSave?.ok === true
}
