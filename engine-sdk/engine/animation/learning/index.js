// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export { SkeletonHierarchy } from './SkeletonHierarchy.js'
export { MotionClip } from './MotionClip.js'
export { MotionDataset } from './MotionDataset.js'
export {
  buildJointPositionDataset,
  buildMotionFeatureIndex,
  fillRagdollFeature,
} from './MotionFeatures.js'
export { MotionMatcher } from './MotionMatcher.js'
export {
  extractMotionClipFromGltf,
  extractMotionDatasetFromGltf,
} from './GltfMotionExtractor.js'
export {
  extractMotionClipFromFbxAscii,
  extractMotionDatasetFromFbxAsciiEntries,
  extractMotionDatasetFromFbxFiles,
  extractMotionDatasetFromFbxDirectoryHandle,
} from './FbxMotionExtractor.js'

import { SkeletonHierarchy } from './SkeletonHierarchy.js'
import { MotionClip } from './MotionClip.js'
import { MotionDataset } from './MotionDataset.js'
import * as MotionFeatures from './MotionFeatures.js'
import { MotionMatcher } from './MotionMatcher.js'
import * as GltfMotionExtractor from './GltfMotionExtractor.js'
import * as FbxMotionExtractor from './FbxMotionExtractor.js'

export const AnimationLearning = {
  SkeletonHierarchy,
  MotionClip,
  MotionDataset,
  MotionFeatures,
  MotionMatcher,
  ...GltfMotionExtractor,
  ...FbxMotionExtractor,
}

export default AnimationLearning
