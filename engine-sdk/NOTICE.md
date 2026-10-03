# Third-Party Notices

This project includes or can interoperate with third-party components that retain their original licenses.

## PhysX JavaScript/WebIDL Bindings

- **Package:** `physx-js-webidl`
- **Location:** `engine/sim/physics/`
- **License:** MIT
- **Upstream:** https://github.com/fabmax/physx-js-webidl

The installed runtime is a locally compiled upgrade to NVIDIA PhysX 5.11.0,
source tag `ovphysx-0.6.3`, commit `da950a3537927784951853c66618036f332ca0ce`.
It includes Blast 5.0.6 core, generated Flow WGSL and MIT-licensed build-lab
Rust/binding bridges. Exact files and capabilities are recorded in
`engine/sim/physics/runtime-manifest.json`. The original package metadata is
retained for attribution; it does not identify the upgraded binary.

- **PhysX SDK:** Apache-2.0; `engine/sim/physics/notices/PhysX-sdk-LICENSE.md`.
- **NVIDIA repository / Flow:** retained license in `engine/sim/physics/notices/PhysX-LICENSE.md`.
- **Blast:** retained license in `engine/sim/physics/notices/blast-sdk-LICENSE.md`.
- **Bindings and build-lab bridges:** retained MIT texts in `engine/sim/physics/notices/`.

## TensorFlow.js Vendor Files

- **Location:** `vendor/tfjs/`
- **License:** Apache License 2.0
- **Copyright:** Google LLC and contributors

## Shader and Noise References

Some shader/noise implementation notes reference public-domain or MIT-licensed material. Public release packaging should preserve any source-level attribution present in the included files.

## PDF.js and PDF output libraries

- **PDF.js:** `pdfjs-dist` 6.3.289, Mozilla Foundation and contributors, Apache-2.0. Location: `vendor/pdfjs/`. Upstream: https://github.com/mozilla/pdf.js . Original CMap, Foxit/Liberation font, ICC profile, OpenJPEG, JBIG2, and QCMS notices remain alongside the distributed files. Liberation fonts retain their GPL-2.0 license with the font embedding exception.
- **pdf-lib:** 1.17.1, Andrew Dillon, MIT. Location: `vendor/pdf-lib/`. Upstream: https://github.com/Hopding/pdf-lib . Original `LICENSE.md` is retained.
- **@pdf-lib/fontkit:** 1.1.1, Devon Govett, Andrew Dillon and contributors, MIT. Location: `vendor/pdf-fontkit/`. Upstream: https://github.com/Hopding/fontkit . Original distribution README and metadata retain the upstream license declaration; bundled dependencies retain their source notices.
- `tools/vendor_sewing_pdf.py` pins package archive SHA-512 integrity and verifies extracted distribution bytes. Upstream package metadata is retained as `distribution-metadata.json`; no Node build is required.

## FreeSewing fitting blocks

- **FreeSewing:** pinned 4.10.1 core, Bella, Titan, their plugin/source dependencies, Joost De Cock and contributors, MIT. Bella credits Bella Incognito and Joost De Cock in the upstream metadata. Upstream: https://github.com/freesewing/freesewing .
- **bezier-js:** 6.1.4, Pomax, MIT. Upstream: https://github.com/Pomax/bezierjs .
- **Lodash:** get 4.4.2, set 4.3.2, unset 4.5.2, cloneDeep 4.5.0, OpenJS Foundation and contributors, MIT. Original package licenses are retained.
- Location: `webgpu-os/vendor/freesewing-4.10.1/`. Original archives, package metadata/source, prepared browser modules, and integrity/provenance records are retained. Full upstream MIT texts omitted from the npm archives are supplied under `licenses/` with commit-pinned source URLs and hashes in `provenance.json`.
- `tools/prepare_freesewing.py` performs deterministic Python-only browser preparation. Compatibility changes are documented in provenance; original archived source is unchanged.
- These files remain as archived source and attribution for earlier generated patterns. Current Sewing fitting-worker deployment follows the project-owned worker's imports and does not stage the FreeSewing distribution. Existing saved pattern geometry and provenance remain readable; they do not require executing the archived generator.

## Genuine handprint training data

- **EMNIST Balanced:** Gregory Cohen, Saeed Afshar, Jonathan Tapson, and Andre van Schaik (2017), *EMNIST: an extension of MNIST to handwritten letters*, https://arxiv.org/abs/1702.05373 . Derived from NIST Special Database 19. Official data: https://www.nist.gov/itl/products-and-services/emnist-dataset .
- Data are acquired from the NIST-hosted archive, with the original README retained in the developer data directory. NIST public-information and data terms apply: https://www.nist.gov/copyrights-disclaimers . Credit to NIST and the EMNIST authors is retained; this project is not endorsed by NIST.
- `tools/fetch-handprint-data.ps1` verifies the original archive and selected compressed IDX members. `tests/sewing/train-handprint-base.html` trains our existing AGI learner in browser JavaScript. The project-generated handprint model contains derived normalized pixel features and source-row provenance, not downloaded pretrained weights or an external OCR runtime.
- Transformation: upright transpose of the published IDX raster, original-pixel threshold/crop through Engine, shared 580-value glyph features, seeded balanced subset of the training prefix, and validation-only threshold selection. The final 18,800 training rows are reserved for validation; the test split is not used to fit or choose thresholds.
- The 47-class mapping merges some upper/lowercase letters. This is isolated handprinted-character data; test images do not establish general cursive recognition or verified writer-disjoint performance. Original dataset files remain developer inputs under `tmp/handwriting/`, not customer runtime downloads.

## Connected handwritten-word developer data

- **DHSD 1.0.0:** Nauman Riaz, Saifullah Saifullah, Stefan Agne, Andreas Dengel, and Sheraz Ahmed (2026), 5,939 genuine German handwritten geographic-name word images from 37 writers. Official release: https://zenodo.org/records/18743313 . Copyright remains with the authors; licensed under Creative Commons Attribution 4.0 International: https://creativecommons.org/licenses/by/4.0/ .
- Geographic names originate in OpenStreetMap. © OpenStreetMap contributors, available under the Open Database License: https://www.openstreetmap.org/copyright .
- `tools/fetch-connected-handwriting-data.ps1` verifies the original release archive and retains its original LICENSE, CITATION.cff, DATASHEET.md, source transcripts, writer IDs and per-image hashes. Original files remain developer data under `tmp/handwriting/dhsd/`; no external model weights or recognition code are copied.
- Project adaptations declare a separate deterministic split by whole writer IDs, a 256×32 white-paper image transform and ordered pixel-strip features. The authors' supplied train/test split overlaps writers and is not used to claim writer-disjoint performance. This narrow German-name corpus does not establish general English cursive recognition. The authors do not endorse this project.

## English handwriting photograph developer data

- **GNHK (2021):** Alex W. C. Lee, Jonathan Chung, and Marco Lee, *GNHK: A Dataset for English Handwriting in the Wild*, ICDAR 2021. Author repository and dataset terms: https://github.com/GoodNotes/GNHK-dataset . Copyright remains with the authors; the dataset is licensed under Creative Commons Attribution 4.0 International: https://creativecommons.org/licenses/by/4.0/ . The authors do not endorse this project.
- `tools/fetch-english-handwriting-data.ps1` retains the authors' complete license and README at commit `5be3842f4231d2b469198600c2b9b0a3745e4d34`. Because their original download page redirects to the current product home page, the archive is acquired from the public `staghado/GNHK-Dataset` mirror at commit `eaa67d396fd29b8b04e38d630da79f67db11b212`: https://huggingface.co/datasets/staghado/GNHK-Dataset . The 1,010,143,400-byte mirror archive has SHA-256 `5f4b470030b41cd80e32d3a5ae7bc8bc41acc79b4bf770a451e7ec54ca3be34d`. This verifies the mirrored bytes; an author-published checksum for the original archive was unavailable.
- Only source JPEG photographs and JSON annotations are extracted from the two contained data archives, with bounded paths, sizes, cardinality checks, and per-file hashes. The original 515 training and 172 test pages remain separate. Writer IDs are not supplied or inferred, so this document split is not described as writer-disjoint. Duplicate image hashes are recorded for exclusion or grouping before evaluation. The separately frozen DHSD writer benchmark remains unchanged.
- Original dataset files remain developer inputs under `tmp/handwriting/gnhk/`. Acquisition does not add recognition code, pretrained weights, an external OCR runtime, or a customer data download. Original bytes and transcripts are retained unchanged; derived crops, learning and evaluation must separately record their transforms and selected source identities.

## Ambient Studio local depth inference

- **Transformers.js 3.8.1:** Hugging Face and contributors, Apache-2.0. Pristine browser distribution and license in `vendor/transformers/3.8.1/`. Upstream: https://github.com/huggingface/transformers.js .
- **ONNX Runtime Web 1.22.0-dev.20250409-89f8206ba4:** Microsoft and contributors, MIT. The JSEP WASM loader/binary supplied with Transformers.js and the corresponding `LICENSE-onnxruntime` are retained. Upstream: https://github.com/microsoft/onnxruntime .
- Exact original file lengths, SHA-256 digests, and acquisition URLs are recorded in `vendor/transformers/3.8.1/provenance.json`. No CDN JavaScript is executed at runtime.
- **Optional Depth Anything V2 Small:** Apache-2.0 model by the Depth Anything authors, quantized ONNX conversion from `onnx-community/depth-anything-v2-small` at revision `c70d1ddbcd93c9bda8098268cc3554adf5e8dd4f`. Upstream: https://github.com/DepthAnything/Depth-Anything-V2 . The model is an explicit user download, content-verified by `AmbientDepthModelStore.js`, and is not bundled in releases or standalone wallpaper players.

## HLS browser playback

- **hls.js 1.7.3:** Dailymotion and contributors, Apache-2.0. Pristine browser ES module, worker, original license and distribution metadata are retained in `vendor/hls.js/`. Upstream: https://github.com/video-dev/hls.js .
- `tools/vendor_hls.py` verifies the package archive against a pinned SHA-512 integrity value and preserves per-file SHA-256 provenance. No npm installation or CDN execution is required. These browser implementations remain third-party code.

## AVR microcontroller execution

- **AVR8js 0.21.1:** Uri Shaked and contributors, MIT. Official project: https://github.com/wokwi/avr8js . The original package archive, distribution members and full MIT license remain in `vendor/avr8js/0.21.1/upstream/`.
- `tools/vendor_avr8js.py` checks pinned SHA-256 and SHA-512 archive digests and per-file provenance. Generated `browser/` copies only append `.js` to extensionless relative ES-module references. No npm installation or runtime CDN is required.
- Arduino profile pin maps and body/header dimensions cite the official Arduino AVR core, published pinouts and CAD archives in `RealmForgeMicrocontrollerProfiles.js`. ATmega64A is an authored lab carrier using Microchip's published device facts, rather than a commercial Arduino board. Product names belong to their respective owners; no endorsement is implied.

## Release Scope

The first public alpha is scoped to the engine SDK. Editor and Plauna artifacts are deferred unless a release target explicitly includes them.
