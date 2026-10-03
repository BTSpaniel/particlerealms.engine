// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// 
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { analyzeDocumentImage } from '../../../../engine/core/math/DocumentImageMath.js';
import { analyzeDocumentRegions } from '../../../../engine/core/math/DocumentRegionMath.js';

self.onmessage = ({ data }) => {
  try {
    const result = analyzeDocumentImage(data.image, data.options);
    if (data.options?.regions) {
      const regions = analyzeDocumentRegions(result, data.options.regionOptions);
      result.regions = regions.regions; result.issues.push(...regions.issues);
    }
    postMessage({ type: 'result', result }, [result.gray.buffer, result.mask.buffer, result.features.buffer, result.partitionFeatures.buffer]);
  } catch (error) { postMessage({ type: 'failure', message: error.message, code: error.code || 'DOCUMENT_ANALYSIS_FAILED' }); }
};
