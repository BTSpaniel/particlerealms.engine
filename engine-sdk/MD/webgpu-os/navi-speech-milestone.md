---
title: Navi Speech Milestone
description: Experimental ParticleVoice diagnostics, shared voice controls, and the remaining human release gates.
updated: 2026-09-05
---

# Navi Speech Milestone

ParticleVoice remains experimental. The speech-first upgrade has executable pronunciation diagnostics, interruptible output, and shared Navi voice controls. The user has confirmed understanding the repaired diagnostic sentence, but the complete blind intelligibility suite and assistant/world upgrade are not finished.

The first user listening check on 2026-09-04 failed: `N AA2 V IY` was perceived as a throat-vibration buzz, not understandable speech. This is qualitative failure evidence, not a scored corpus result. Text and explicit-phone plans for Navi produce identical articulation data; pronunciation labels alone cannot resolve that acoustic failure. Do not advance the release gate on the strength of automated signal tests.

The second check recognized Navi but still described its sound as unpleasant. Echo was heard as "oh," and "Hello there, my name is Zyra" remained unintelligible. This is another failed listening check, not a pass or an improvement percentage. In the measured text/explicit Navi Echo plans, EH, K, and OW are all present with identical controls and durations. Zyra used an uncertain spelling fallback during that check. The user subsequently reviewed it as "ZY-rah," rhyming with Myra; the domain pronunciation is now `Z AY2 R AH`. This lexical correction does not establish an acoustic improvement.

After the source, outlet, and consonant-release corrections, the third listening check succeeded: the user reported hearing all of "Hello there, my name is Zyra." This is a human-confirmed diagnostic-sentence smoke test, not an 85% minimal-pair score or a 90% held-out sentence score. Keep this distinction when reporting readiness.

The user subsequently reported a missing F in "fuck." Its text and explicit `F AH2 K` paths produce identical phonemes and audio; the frontend is not dropping or filtering the word. After the source-placement correction, the user confirmed that F works. This is another qualitative diagnostic pass, not a complete corpus result. The next reported problems were B in "bee" and "bitch," W/P generally, and S heard as a click followed by "pth." Diagnostic traces retain `B IY2`, `B IH2 CH`, `W IY2` (we), `W EY2` (way), `P IY2` (pea), and `S S` (lowercase sss). The user describes B/P/W as "better" after pressure preparation, which is partial qualitative improvement rather than full acceptance. After excluding fricative and affricate onsets from preparation, the user confirmed S is now a steady hiss. This resolves that specific click/pth report; the broader release gate remains open.

## Try the authored voice box

Serve the repository with `python start_server.py`. Open `/agi/particle_voice/lab/voice-lab.html` over HTTP and select **Start audio**. Nothing requests microphone access in this lab.

1. Enter a short sentence and select **Inspect text above**. The trace shows normalized words, phonemes, authored stress, half-open word indexes, and pronunciation sources. Rule-generated results carry warnings.
2. Compare **Speak** with **Speak explicit phones**. For example, `N AA2 V IY | EH2 K OW` specifies Navi and Echo without inserting a pause at the word separator. Stress is `0` unstressed, `1` secondary, and `2` primary; this is not CMUdict stress numbering.
3. Expand **Blind listening evaluation**. Choose text-generated or explicit-phone minimal pairs, then enter what you actually hear. Do not inspect or train against the held-out sentence answers. Stopped, skipped, and incompletely drained trials do not count as completed listening evidence.
4. Export the local JSON report if wanted. No audio or answers are uploaded. The report requires all 20 pair trials and all 50 held-out sentences before calculating a complete-session gate.

The requested thresholds are at least 85% pair recognition and 90% human word recognition on the held-out sentences. These require user listening confirmation. Signal stability, GPU tests, and automated transcription cannot establish this result.

Sources: `agi/particle_voice/lab/voice-lab.html`, `VoiceLabDiagnostics.js`, and `ListeningEvaluation.js`.

## Acoustic corrections after listening failures

The diagnosis used the ordinary diagnostic word Navi, not the held-out sentence corpus. Its text and explicit-phone control arrays matched, and the AA/IY geometry retained calibrated formants. Raw GPU output nevertheless put N about 13.7 dB and V about 10.6 dB above AA. Removing the nasal branch reduced N by 20.6 dB without changing the central vowels; removing V turbulence changed V by only 0.067 dB. Those ablations locate separate nasal-branch and voiced-source balance problems before the limiter or resampler.

The first correction keeps oscillator phase in cycles across pitch changes, uses the direct-tract LF return ratio 0.012, and applies a bounded 0.2 voiced-obstruent excitation gain at both initial and subsequent frames. Reduced voicing drive in constricted voiced sounds is consistent with [experimental work on voiced fricative production](https://pmc.ncbi.nlm.nih.gov/articles/PMC2856513/); this exact gain is an authored approximation, not a coefficient measured from a human speaker.

The second investigation found that reducing nasal gain alone did not fix closed-lip sounds: M stayed much too loud with the nasal branch entirely disabled. The tract was mixing boundary pressure as audible output without accounting for mouth opening. The output now converts each oral/nasal contribution to normalized outlet volume using the actual outlet area and reflection coefficient. The temporary 0.1 nasal gain is superseded by this conversion; its default is unity. Source excitation also converts to the tract's pressure-wave convention using the reciprocal of the actual inlet area, once per sample. These use a shared 6 cm² reference scale, not per-word or per-vowel normalization. The pressure/airflow relation follows [the NCVS source-filter equations](https://www.ncvs.org/archive/ncvs/tutorials/voiceprod/equation/chapter6/index.html); outlet-volume radiation is described in [Jackson's aeroacoustic model](https://eprints.soton.ac.uk/254111/1/Jackson_PhD00.pdf).

K release now retains the originating stop's voicing instead of reading the following vowel. Its envelope cannot interpolate a future burst backward into the closed interval. Oral turbulence uses deterministic, band-limited white noise instead of the previous first-differenced noise, which concentrated most power above the useful speech band at the 64 kHz model rate. The source reuses the existing windowed-sinc filter design, with 65 taps and a 10 kHz cutoff capped safely below Nyquist at lower rates. This cutoff is an engineering choice, not a universal frication spectrum. The source has no chunk warmup, and the articulation envelope is applied after filtering. See [Shadle's noise-source research](https://eprints.soton.ac.uk/250106/) and [Jackson and Shadle's aeroacoustic synthesis work](https://eprints.soton.ac.uk/253337/).

The F investigation located its steady turbulence source inside the narrow channel. In a controlled GPU comparison, moving that source beyond the channel recovered 9.81 dB of central F noise without changing the following AH or K. `ArticulationHead` now derives steady oral-fricative injection from the downstream edge of its existing constriction span, clamped to legal junctions. The 32-section F/V source moves from junction 28 to 30. Tests cover exact grid-edge cases at other resolutions; HH stays on the glottal aspiration path, and affricate and stop-release routing are unchanged. No vowel geometry, pressure setting, frication gain, or bandwidth is changed by this repair. The initial respiratory ramp was evaluated separately from source placement. Source location relative to the constriction is consistent with [aeroacoustic source-location research](https://pmc.ncbi.nlm.nih.gov/articles/PMC2981115/); measured energy recovery is not itself proof of human intelligibility.

The subsequent B investigation found an intact closure and release, but weak initial airflow. Eligible planned speech now explicitly prepares its respiratory reservoir during the existing leading `SIL` frames. Stops, approximants, nasals, and vowels can use this preparation. Fricative and affricate onsets retain the previous pressure path: preparing S produced a first-2-ms noise spike about 8 dB above its sustained noise. The original zero-pressure frame data stays unchanged, and an actual post-LF source gate plus zero noise envelopes keep eligible prepared prefixes exactly silent. Manual physiology does not opt in implicitly. All-structural sequences, unpadded input, leading `BREATH`/`SP`, and later pauses do not acquire preparation. The lab reports the prepared pressure, absolute speech onset, and relative source hold. Custom chunks that straddle onset remain muted until the next chunk boundary; the reported hold can extend onset by less than one chunk. Invalid metadata rejects before solver allocation. Sources: `ArticulationHead.js`, `ParticleVoiceModel.js`, `ParticleTract.js`, and `VoiceLabDiagnostics.js`.

Preparation does not retime bursts or change vowel shapes, pitch, or source gains after the silence gate. The separate chunk-interpolated geometry/release-clock mismatch remains: in the B diagnostic, the burst starts about 2 ms before the rendered lips open. A timing ablation and pressure ablation were measured separately; only pressure preparation is implemented in this candidate. Automated prefix, manual-path, and cancellation tests do not replace human B/P/W/S listening confirmation.

Vowel geometry, neutral base pitch, and authored identity are preserved. These are deterministic source and boundary corrections, not a learned voice or a complete coupled glottis/nasal pressure solver. The nasal branch still lacks a true energy-conserving three-port junction. The user-confirmed sentence demonstrates qualitative intelligibility; broader human listening evaluation remains required.

The lab's runtime panel projects the initialized model's actual prosody, articulation, and resolved tract configuration. It shows inlet/output reference scale, reflection coefficients, wall loss, and turbulence bandwidth without exposing GPU handles or blind-listening targets. Sources: `ParticleTract.js`, `ArticulationHead.js`, `ParticleVoiceModel.js`, `VoiceLabDiagnostics.js`, and the `source_volume_mix.js`, `outlet_volume_mix.js`, and `constriction_noise.js` kernels under `agi/particle_voice/`.

## Shared OS controls

Unlock Navi and select a conversation. Both the avatar popup and AI Echo expose **Hold to talk**, **Enable open mic**, **Stop voice**, and **Read reply**. Hold-to-talk supports pointer, Space, and Enter. Releasing submits finalized recognition; interim speech remains a draft. Open microphone is enabled only for the current live session, uses half-duplex turn-taking, and displays a persistent shell Stop control.

Recognition and spoken output are selected separately. ParticleVoice is the default authored output. Browser speech is an alternative, not a replacement for the authored voice box. Local browser recognition is capability-checked using `processLocally` and `available()`. Missing local recognition never silently enables online processing or installs a language pack. Browser synthesis checks each voice's `localService`. Separate consent switches govern remote input and output. See [recognition locality](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally) and [synthesis locality](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService).

The smart-router transcription choice currently reports unavailable: the normal cognition route has no verified transient-audio speech operation. An ordinary text model is not labeled a speech engine. The source registry and bounded recorded-input adapter accept trusted injected implementations, but no custom provider, server, native companion, or pretrained model is installed or automatically registered.

Per-Navi preferences, popup drafts, and reviewed pronunciation corrections use encrypted cognition storage. Microphone armed state is never persisted. Identity, mailbox/route, privacy/source, lock, hidden-document, and permission changes stop voice. Changing popup/full-chat presentation within the same conversation does not acquire another microphone. **Stop voice** stops speech and capture; it does not cancel a tool transaction or decide an approval.

Sources: `webgpu-os/kernel/navi/NaviVoiceKernelBinding.js`, `NaviVoiceSession.js`, `NaviBrowserVoice.js`, `NaviTranscriptionVoice.js`, `NaviVoiceSourceRegistry.js`, `NaviAssistantStateStore.js`, and `webgpu-os/shared/NaviVoiceControls.js`.

### Playback feedback and microphone ownership

ParticleVoice now supplies measured RMS/peak levels from its actual Web Audio
output to the shared voice session and Navi's speaking display. Planned phoneme
timing advances against the playback worklet's consumed-sample counter. It is
not a measurement of mouth geometry. Browser speech does not expose equivalent
PCM evidence and keeps amplitude unavailable rather than inventing it from text.
Stop, source changes, and late generation callbacks clear or reject stale visual
updates along with audio cancellation.

Speech input first acquires one exclusive, non-queued Web Lock across OS tabs
on the same origin. A second tab cannot steal the microphone. The lease remains
held until a pending source open or asynchronous abort has actually settled.
Browsers without this coordination capability report input unavailable; text
and spoken output stay functional. The lease does not request microphone
permission, replace consent, or reopen capture after boot.

Sources: `webgpu-os/kernel/navi/NaviMicrophoneLease.js`, `NaviVoiceSession.js`,
`voice/NaviPlaybackEvidence.js`, `voice/ParticleVoiceOutput.js`, and
`webgpu-os/shell/echo-guide/EchoGuidePresence.js`.

### Pronunciation corrections in Navi development

Saving a correction through the existing OS voice controls now refreshes the
current Navi's development graph after the encrypted save succeeds. The graph
independently reopens that identity's assistant-state record and validates a
pronunciation-only projection. It excludes drafts and preferences; public
provenance contains a content hash rather than the private words and phones.

The **Pronunciation correction history** node is a candidate memory reference,
not an active voice policy. Its proof records `observed`, with no successful
listening receipt or automatic policy proposal. The saved override already
affects ParticleVoice through its existing frontend; the graph does not apply it
a second time, train model weights, or promote lab JSON into trusted evidence.
The node explains that its local gym checks structure, not intelligibility.

The aggregate reference includes the current overrides and the existing bounded
128-entry correction history, including removals. Content-addressed revision
zero prevents unrelated draft/settings writes from duplicating growth events.
A changed correction invalidates the old source hash. Unavailable or malformed
voice evidence is omitted without disabling unrelated growth sources. Identity
revocation or owner replacement during a save cannot refresh or emit state into
another Navi.

Verification covers real AES-GCM/IndexedDB reopening, stale ownership, source
tampering, unrelated draft changes, removal/restoration, and graph admission.
The five focused binding/state/service suites passed 88 tests; the existing
development-panel suite passed another 17. These are storage and lifecycle
checks, not a voice acceptance result.

Sources: `webgpu-os/kernel/navi/NaviAssistantStateStore.js`,
`NaviDevelopmentKernelBinding.js`, `NaviVoiceKernelBinding.js`,
`NaviDevelopmentService.js`, and `tests/navi/navi-assistant-state.test.js`.

## Synthesis and admission boundaries

The actual speaking path uses the authored text frontend, prosody, articulation, and GPU tract. It does not run the untrained phoneme encoder. Output uses the returned sample rate; the default tract runs at 64 kHz with 256-sample chunks, or 4 ms per chunk. Cancellation invalidates pending synthesis/readbacks and resets playback queues. Sentence output and word timings are bounded; playback start/end comes from consumed audio rather than a timer pretending to be speech.

The older component `ARCHITECTURE.md` and `spec/DeviceContract-v0.md` describe the 32 kHz Phase -1/0 probe baseline. They are historical reference sources, not the current synthesis-rate contract. Do not copy that rate into a playback adapter. `PolyphaseResampler` accepts the returned model rate and actual AudioContext rate; the current 64 kHz to 48 kHz case is L=3, M=4.

Navi quick prompts receive `navi-prompt-admission-v1` receipts only after durable mailbox intake. The receipt contains the stable request ID, session ID, and inbound mailbox-entry ID. Spoken responses must match the exact admitted request, even when two replies have identical wording. Busy quick-prompt admission fails closed and retains the draft; existing full-chat task steering remains separate.

Sources: `agi/particle_voice/model/ParticleVoiceModel.js`, `agi/particle_voice/streaming/VoicePlayback.js`, `webgpu-os/kernel/navi/voice/ParticleVoiceOutput.js`, `NaviAssistantSurfaceChannel.js`, and `webgpu-os/apps/ai-echo/factory.js`.

### Cold-start prompt admission

The avatar's cold-start path now starts AI Echo's existing background owner
without queuing the question as a volatile app action. It retains the original
bounded request while the app mounts, then delivers it once to the registered
primary receiver. Startup failure or timeout leaves the draft intact and cannot
leave a queued question to execute unexpectedly after a later mount.

The readiness wait is bound to the captured operator and Navi. Explicit mailbox
routes must still match the selected catalog revision, active mailbox, session,
and context. The channel accepts only its exact, still-pending request object
for this one-time continuation; copying an envelope cannot resume it. Missing
primary handlers do not recurse into the cold-start fallback. Captured app
context is not replaced by whichever surface happens to be visible after boot.
If a contextless question was typed before startup restored a conversation
catalog, Navi retains it for explicit mailbox confirmation instead of inheriting
the newly restored active conversation. The popup pins its draft during pending
admission and reconciles selection only after settlement. A failed unrouted
question remains visible under **Unsent draft · choose conversation**. Copy it,
select the intended mailbox, and paste it before sending; this explicit recovery
does not overwrite a draft already belonging to that mailbox.

The popup clears an unchanged draft only after a valid durable admission
receipt for the selected conversation. A bare `accepted: true` response is not
enough. Voice already requires that receipt; stopping audio remains separate
from cancelling a question already admitted to the mailbox.

This repairs the pre-admission cold-start gap, not all runtime ownership. AI
Echo's mounted implementation still owns execution. Reload after durable intake
but before its acknowledgement remains an uncertain-outcome recovery boundary;
this milestone does not promise exactly-once automatic retries across reboot.
The readiness guard also does not replace a commit-time Navi identity fence:
the mounted factory's lifecycle check alone is not proof that the same primary
Navi remains selected throughout an asynchronous mailbox write. That remains a
coordinator/store acceptance gate before claiming end-to-end identity isolation.
The channel validates receipt shape and session; caller-minted request
idempotency is still a follow-up. Admitted-draft cleanup is not yet crash-atomic,
and the visible unsent-recovery marker lasts for the current mounted guide.
Persisting that marker and reconciling already-admitted drafts after remount are
required before claiming complete cross-reboot conversation recovery.
The older trusted cold app-action handler remains available for compatibility,
but new avatar and voice submissions do not use that volatile prompt queue.

Sources: `webgpu-os/shell/Desktop.js`,
`webgpu-os/kernel/navi/NaviAssistantSurfaceChannel.js`, and
`webgpu-os/shell/echo-guide/EchoGuidePresence.js`.

## Lower-latency synthesis

The latency upgrade reduces generation wait, not the speed at which words are
spoken. `ParticleVoiceModel` now defaults to `renderBatchChunks: 8`. The solver
still applies distinct controls and ordered GPU submissions every 256 samples
(4 ms at 64 kHz). Two bounded staging slots collect consecutive PCM chunks and
their optional visualization fields. Each group shares one readback instead of
waiting for a separate map after every chunk. Batch size 1 remains the reference
path. No untrained phoneme encoder, pretrained model, codec, or external speech
service is introduced.

The lab reuses the production `streamSentences()` and `playSentenceStream()`
path. It plays the first ready sentence while subsequent sentences are generated.
Each sentence retains whole-unit RMS normalization and limiting. This is not
sample-by-sample synthesis delivery: the first bounded sentence must finish
rendering before it can play. Alphabet mode now renders each letter as its own
unit, matching the isolated-letter context instead of using one declining pitch
contour across all 26 letters.

Paired local NVIDIA Blackwell measurements on 2026-09-05 used the same
configuration except batch size. These are machine-specific measurements, not
latency guarantees under arbitrary GPU load.

| Render | Batch 1 | Batch 8 | Verification |
| --- | --- | --- | --- |
| Warm `bee`, visualization disabled | 611 ms | 43 ms | Exact PCM match |
| Diagnostic sentence, visualization disabled | 2,839 ms | 264 ms | Exact PCM match |
| Warm `bee`, visualization enabled | 740 ms | 83 ms | Exact PCM and snapshot match |
| Diagnostic sentence, visualization enabled | 3,167 ms | 296 ms | Exact PCM and snapshot match |

The 163-chunk word uses 21 readbacks; the 658-chunk sentence uses 83. Raw levels,
limiter output, and all snapshot fields/timestamps match the reference. Actual
lab UI checks measured about 262 ms from warm playback invocation to the first
consumed audio sample for the diagnostic sentence. This includes planned leading
silence, but not speaker/device latency. Cold startup can still take longer and
is not claimed to be instantaneous. Browser output requests interactive latency;
the browser may choose a different actual latency, as described by
[AudioContext latency options](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext).

Cancellation checks run before each GPU submission and after readback. Pending
slots settle and release before a new render resets the solver. A handle has
one consumer; a third simultaneous batch is refused. The lab reports the actual
batch size, readback count, first queued/consumed times, and final drain status.
These ordered copies respect the [WebGPU mapping and queue model](https://gpuweb.github.io/gpuweb/).

Healthy playback can exceed the old fixed ten-second enqueue deadline. The
playback bridge now bounds lack of progress separately from the audio's expected
duration. A genuine timeout clears its queued tail and reports failure. The full
26-letter UI sequence drained all 18.16 seconds in the new per-letter mode;
Stop followed by a fresh letter also passed. Word callbacks cannot escape after
a callback itself stops the generation.

Reproduce the browser checks with:

```bash
python tests/particle-voice/run_voice_production_streaming_tests.py
python tests/particle-voice/run_voice_lab_streaming.py
```

Sources: `agi/particle_voice/model/ParticleVoiceModel.js`,
`agi/particle_voice/articulatory/ParticleTract.js`,
`agi/particle_voice/streaming/VoicePlayback.js`, and
`agi/particle_voice/lab/voice-lab.html`.

## Speech Studio: classroom and tuning

The same `agi/particle_voice/lab/voice-lab.html` page now opens as a responsive
Speech Studio. The listening classroom is the primary activity, with simple
tuning alongside it and text/manual practice below. Technical configuration,
pronunciation overrides, the existing blind evaluation, and solver snapshots
remain available under **Under the hood**. There are no external fonts, image
downloads, new speech dependencies, or automatic training.

Select **Start audio**, then **Start new lesson**. Each of the 26 shuffled
letter names plays through the authored letter lexicon and real ParticleVoice
tract. Four shuffled letter choices and **I couldn't tell** become available
only after audio finishes. Replays are allowed; stopping an attempted replay
requires another completed playback before answering. Feedback reveals the
target only after submission. **Next sound** advances the lesson; skipping is
unscored and makes the final report incomplete.

**Copy results JSON** or **Download JSON** returns the full report: choices,
answers, uncertainty, skips, replay counts, confusions, and actual synthesis,
playback, and tuning evidence. Copy failure leaves a selectable report for
manual copying. Results stay in the current tab until a new lesson or reload;
nothing is automatically uploaded or persisted. A classroom score is not the
85% minimal-pair or 90% held-out sentence acceptance gate.

The four session-only tuning controls start at the exact authored defaults.
Editing a slider does not change the voice until **Apply** or **Apply and
preview** is selected. **Reset defaults** restores all four controls without
rewriting an earlier listening report. Tuning is locked during rendering and
listening sessions so the reported configuration stays tied to each sound.

| Control | Range | Actual parameter |
| --- | --- | --- |
| Pitch | 80–140% | Prosody base frequency |
| Breathiness | 0–300% | Aspiration during voiced sounds |
| Hiss strength | 50–150% | Oral frication amplitude, not every consonant |
| Output level | 50–120% | Target RMS; the existing limiter remains enabled |

These controls do not change word duration, calibrated vowel geometry, sample
rate, or chunk size. They are listening experiments, not a promise that a
global slider can repair individual phonemes. Start at a comfortable low volume.

The release-sidecar closure now includes the local stylesheet and tuning module.
Missing CSS or a changed CSS dependency contract fails release validation rather
than shipping an unstyled page. Source-page updates do not modify older ZIPs.

Sources: `agi/particle_voice/lab/voice-lab.html`, `voice-lab.css`,
`VoiceLabTuning.js`, `VoiceLabDiagnostics.js`, `ListeningEvaluation.js`, and
`bundler/site.py`.

## Alphabet review on 2026-09-05

The A-Z review distinguishes letter names, word pronunciation, and intelligibility. All 26 individual **Say letter** operations in the packaged lab generated finite, nonzero audio and drained completely. This is playback evidence only. The user reports **K, L, M, N, O, Q, R, V, and X** unclear both individually and in **Say ABCs**, then adds that **P, E, and G** need work. That flags 12 letter names; the other letters have no new failure report, not a scored listening pass. No acoustic settings were changed during this review.

The current letter-name targets use the project's `2 = primary` stress convention. Z currently uses "zee"; this review does not silently switch dialect or authored identity. (Source: `agi/particle_voice/frontend/PronunciationLexicon.js`, `LETTER_NAMES`.)

| Letter | Current name phones | User feedback |
| --- | --- | --- |
| A | `EY2` | No new report |
| B | `B IY2` | No new report |
| C | `S IY2` | No new report |
| D | `D IY2` | No new report |
| E | `IY2` | Needs work |
| F | `EH2 F` | No new report |
| G | `JH IY2` | Needs work |
| H | `EY2 CH` | No new report |
| I | `AY2` | No new report |
| J | `JH EY2` | No new report |
| K | `K EY2` | Unclear in both modes |
| L | `EH2 L` | Unclear in both modes |
| M | `EH2 M` | Unclear in both modes |
| N | `EH2 N` | Unclear in both modes |
| O | `OW2` | Unclear in both modes |
| P | `P IY2` | Needs work |
| Q | `K Y UW2` | Unclear in both modes |
| R | `AA2 R` | Unclear in both modes |
| S | `EH2 S` | No new report |
| T | `T IY2` | No new report |
| U | `Y UW2` | No new report |
| V | `V IY2` | Unclear in both modes |
| W | `D AH2 B AH L Y UW` | No new report |
| X | `EH2 K S` | Unclear in both modes |
| Y | `W AY2` | No new report |
| Z | `Z IY2` | No new report |

### Confirmed playback and diagnostic gaps

- **Full alphabet timeout, since repaired in source:** the earlier packaged lab produced 968,448 samples at 64 kHz, or 15.132 seconds, with a fixed 10-second enqueue deadline and a 4-second ring. A repeated run wrote only 671,487 of 726,336 resampled samples at 48 kHz, then reported stopped while about 3.95 seconds remained queued. This was distinct from the isolated-letter complaints. [Lower-latency synthesis](#lower-latency-synthesis) records the replacement per-letter streaming and progress-aware timeout checks; the current source lab completes all 26 letters. An older release ZIP does not gain this fix automatically. (Sources: `agi/particle_voice/lab/voice-lab.html`, `speakText`/`play`; `agi/particle_voice/streaming/VoicePlayback.js`, `_enqueueResampledNow`.)
- **Inspect/play mismatch, repaired in source:** **Speak**, tuning preview and **Inspect text above** now share the existing single-letter practice rule. For example, `a.` previews and speaks `EY2`, while the article in `A bird.` remains `AH`. **Inspect selected letter** uses the letter-name sequence used by the lesson. Previews do not initialize audio or invent timing for a whole paragraph. Each streamed practice render displays its actual returned plan, pronunciation source and local word timing, labeled with its unit number. Starting a new render clears the previous trace; cancelled generations and active listening sessions cannot reveal a new trace. (Sources: `voice-lab.html`, `practiceTextRequest`/`letterSequence`; `VoiceLabDiagnostics.js`, `recordPronunciation` and inspection handlers.)
- **Assistant spelling context:** the normalizer deliberately marks all-caps only for tokens longer than one character. Consequently ordinary text "Press B." produces consonant `B`, not `B IY2`; "Say A." produces article `AH`. The lab's local letter-name workaround does not solve this across Navi output. A correction must preserve articles and ordinary words rather than globally replacing every A. (Sources: `frontend/TextNormalizer.js`, `wasAllCaps`; `frontend/G2PModel.js`, `pronounce`.)

### Confirmed word-rule errors

These are observed frontend outputs, before synthesis. The ten unambiguous corrections now use the existing core lexicon, based on the linked dictionary pronunciations and the project's primary-stress convention. Their word traces report `lexicon`; custom lexicons and reviewed session overrides retain precedence. The dialect-dependent first vowel of `arrow` remains unresolved. These lexical corrections do not change the r3 acoustic controls or establish human intelligibility.

| Diagnostic word | Previous fallback phones | Current correction or open candidate |
| --- | --- | --- |
| [baby](https://dictionary.cambridge.org/dictionary/english/baby) | `B AE2 B IY` | `B EY2 B IY` |
| [father](https://dictionary.cambridge.org/pronunciation/english/father) | `F AE2 TH ER` | `F AA2 DH ER` |
| [ahead](https://dictionary.cambridge.org/pronunciation/english/ahead) | `AE HH IY2 D` | `AH HH EH2 D` |
| [full](https://dictionary.cambridge.org/pronunciation/english/full) | `F AH2 L` | `F UH2 L` |
| [cow](https://dictionary.cambridge.org/pronunciation/english/cow) | `K OW2` | `K AW2` |
| [arrow](https://dictionary.cambridge.org/pronunciation/english/arrow) | `AA R R OW2` | Unchanged; `EH2 R OW` or `AE2 R OW` remains dialect-dependent |
| [rose](https://dictionary.cambridge.org/pronunciation/english/rose) | `R OW2 S` | `R OW2 Z` |
| [measure](https://dictionary.cambridge.org/pronunciation/english/measure) | `M IY2 S ER` | `M EH2 ZH ER` |
| [blue](https://dictionary.cambridge.org/pronunciation/english/blue) | `B L AH2 EH` | `B L UW2` |
| [away](https://dictionary.cambridge.org/pronunciation/english/away) | `AO EY2` | `AH W EY2` |
| [exam](https://dictionary.cambridge.org/pronunciation/english/exam) | `EH K S AE2 M` | `IH G Z AE2 M` |

The word probes cover hard/soft C and G, vowels, consonant clusters, and initial/medial/final consonants. Additional `vision` and `sing` probes retain `ZH` and `NG`; together with the alphabet/word traces this reaches all 39 nonstructural phone symbols. Coverage does not certify pronunciation or audible distinction. Dialect variants such as the first vowels of "coffee" and "zebra" are not automatically classified as bugs. (Sources: `frontend/G2PModel.js`, `LTS_RULES`; `frontend/PhonemeSet.js`.)

### Focused acoustic measurements and next checks

The read-only GPU audit uses the unchanged 64 kHz, 256-sample, 32-section oral/24-section nasal model. Measurements distinguish nonzero audio from recognizable phonetic cues. No held-out listening answers were used to tune the model.

- **V:** isolated V raw RMS is 0.001234 versus 0.014605 for its following IY, about 21.5 dB lower. Its first 20 ms are especially weak. A medial/full-pressure V comparison is stronger, but also changes surrounding articulation; it is not a pure one-variable proof. Test startup excitation and geometry separately, preserving the S transient guard.
- **L/R:** raw RMS is not near silence (L 0.01924; R 0.02064), but only about 0.092%/0.499% of their rendered energy occupies 1.5-3 kHz in the measured windows. Inspect actual voiced formant prominence and transitions before changing calibrated shapes or applying gain.
- **M/N:** the measured murmur is strong (RMS 0.02293/0.03380), yet both centroids are about 171 Hz with over 98% of energy below 500 Hz. This points to a need to test place cues, transitions, and the simplified nasal coupling. Similar steady murmurs alone do not establish the complete cause of the human failure.
- **K/P/Q:** the closure interval is nearly silent, which is expected for a stop and is not a release-strength measurement. Isolate burst contribution and its timing against the realized opening. Q includes K plus Y/UW, so each component needs separate checks.
- **E/O:** the isolated O/OW render is nonzero (RMS 0.01958). The available detailed IY spectrum comes from the vowel in "bee," not an isolated-E spectral experiment. Both E and O completed actual isolated playback, but neither has passed the user's clarity check. Do not infer a missing vowel or change global volume from this evidence.
- **G:** the name is `JH IY2`, not velar `G IY2`. The individual letter completes playback, but a dedicated JH release/startup ablation was not completed in this review.
- **X:** its EH, K, and S intervals all contain energy. Its S interval has substantial high-frequency energy, so transition/segmentation tests are more informative than declaring it dropped.

Before the latency repair, full ABCs and isolated letters were not acoustic-equivalent controls. The single-utterance planner used utterance-wide pitch declination and a final-phrase terminal contour. Respiratory preparation applied only before the first letter, not after each 300 ms period silence. The audit measured substantially weaker starts for later ABC letters. The new lab stream renders each letter separately, but this does not resolve complaints that also occur in isolation. A separate one-second-ring bench was not the real lab's four-second-ring playback; use the actual UI counts in the historical timeout finding, not that smaller-ring result. (Sources: `model/ProsodyPlanner.js`, `model/ArticulationHead.js`, `model/ParticleVoiceModel.js`, `articulatory/ParticleTract.js`.)

Bounded full-alphabet delivery, queue cleanup, selected-mode diagnostics and the ten unambiguous word entries are implemented. The r3 section records the subsequent controlled acoustic repairs. Assistant-wide single-letter spelling remains open: the output API currently accepts ordinary text without explicit token spelling intent. Adding capitalization guesses would not preserve article `a`; a future explicit reading mode must survive both phoneme lowering and sentence splitting. Preserve the human-confirmed F/S/default-sentence gains and obtain the next r3 listening report before further acoustic tuning.

### First classroom listening report

The user's 2026-09-05 report records **11 correct of 25 answered (44%)**, with
one additional skipped letter. The 14 non-correct answers comprise 11 named
confusions and three **I couldn't tell** responses. This is multiple-choice
feedback with revealed answers between trials, not a blind sentence score or
an acceptance pass. The exported status correctly remains **incomplete**.

| Outcome | Letters or target → selected answer |
| --- | --- |
| Correct | A, B, C, F, I, O, R, V, W, Y, Z |
| Unclear | U, M, Q |
| Confused | X → S; L → M; E → B; T → E; N → M; J → K; G → Z; D → G; P → D; H → A; K → A |
| Skipped after listening | S; no clarity outcome |

All 48 attempted plays drained, with exact written/resampled counts and no
queued remainder, failed attempts, or missing playback evidence. Configuration
and tuning were identical throughout: all four sliders at 100%, 64 kHz model,
256-sample chunks, batch size 8, visualization enabled, and 48 kHz output.
Repeated letters retained identical non-timing synthesis metrics. Recorded
generation time ranged from 54.9 to 147.8 ms, with an 86.5 ms median. These are
within-session render measurements, not cold-start or speaker latency.

M and E each needed six plays; U needed four and Q three. Prioritize controlled
M/L/N comparisons, U/Q, and the E/B confusion, then the onset/release contrasts
in the table. These choices identify what was confused, not the acoustic cause.
Preserve this default-configuration baseline and the already confirmed speech
gains before trying isolated changes. S still needs a scored response.

### Second classroom report and affricate repair

The second user report scored **18/25 (72%)**, with Y skipped before playback.
Replays fell from 22 to 9. Eight previously non-correct letters became correct,
including L/M/N; S also received its first correct response. G, E, Q, D, T and K
remained non-correct, and F changed from correct to a selection of S. G was
selected as E after six plays; Q remained unclear after four. K was selected as
A in both runs. All 34 new plays drained fully, with median generation 105.6 ms.
The settings and captured non-timing metrics matched the first run. Distractor
sets differed for 17 letters, so the higher score is not a controlled acoustic
A/B result. The older reports contain no PCM digest or deployed-build hash.

The G investigation found a confirmed gesture defect. Its letter name uses
`JH IY2`; the `JH` affricate should contain closure and release, but its target
started opening immediately while the smoothed tract was still trying to close.
The minimum reached 0.0788 cm², above the existing 0.05 cm² closure threshold.
No closure was latched and no release burst was generated. The same defect
affected the `JH` in J and the voiceless `CH` gesture.

`ArticulationHead.profileAtProgress()` now holds the authored closure target
through the first half of an affricate, then opens toward the same final channel.
The noise envelope stays off during the closure phase and while the measured
geometry remains closed. Existing release detection adds the burst on opening.
The padded JH plan now contains six closed frames and releases at 150 ms instead
of never closing. Total phoneme duration, endpoint profiles, vowel calibration,
plain fricatives and respiratory startup eligibility are unchanged.

Controlled GPU comparisons separated the hold from the noise gate, with matched
burst-disabled controls and unity maximum auto-gain to retain linear differences.
JH/CH release contributions changed from exactly zero to nonzero. Gating CH's
premature noise reduced pre-release RMS by approximately 26–29 dB while retaining
the recovered burst. All 12 comparison renders were finite, and onset transients
did not increase. These measurements verify the implementation, not perceptual
acceptance. G/J and words containing CH still need human listening confirmation.

Speech research supports testing temporal cues together rather than treating
one amplitude increase as sufficient: see the experiments on
[affricate/fricative duration and rise time](https://pubmed.ncbi.nlm.nih.gov/1603646/)
and [dynamic stop-release cues](https://pmc.ncbi.nlm.nih.gov/articles/PMC3515858/).
The chosen half-span gesture is an authored implementation setting, not a
universal measured timing rule for every speaker or context.

Sources: `agi/particle_voice/model/ArticulationHead.js`,
`tests/particle-voice/articulation-head.html`, and
`tests/particle-voice/voice-model-end-to-end.html`.

### Classroom onset and consonant corrections

The next classroom run scored 17/25 (68%), with E unclear after five identical
renders and K, F, S, G, T, V and D misidentified. Its two uploaded exports were
byte-identical and count as one session. It does not pass the speech release
gate or establish an acoustic regression from the earlier 18/25 session.

The `particle-voice-articulation-r3` changes address measured control defects:

- E's first audible gesture moved from a neutral tract into IY. Its first-frame
  resonances were 438/1772 Hz, approaching the authored 270/2291 Hz target over
  60 ms. Initial vowels now prepare their first gesture during existing muted
  leading silence. The vowel targets, durations and diphthong glides remain.
- Initial oral fricatives prepare their channel during that same silence before
  respiratory drive becomes audible. This removes reservoir starvation without
  exposing the onset spike produced by preparing pressure alone. Glottal HH,
  affricates, manual streams and unpadded sequences keep their existing paths.
- Unvoiced excitation decays with a separate authored 8 ms time constant;
  voiced onset retains 30 ms. The previous shared envelope left substantial
  preceding-vowel phonation in the middle of F. The correction preserves source
  continuity and the positive excitation floor while exposing the frication.
- Affricate turbulence and its opening burst enter downstream of the narrow
  channel. Injecting them inside the channel suppressed the measured G/J release
  contribution by about 5 dB. Closure timing and source amplitudes remain intact.
- Stop transients now wait for the interpolated tract to open. Immutable burst
  provenance separates those transients from the existing combined controls;
  steady frication and aspiration keep their timing. Controlled GPU K/Q probes
  measured 1.915/1.854 times the previous release-band energy at equal gain.
  The alignment preserves caller amplitude/routing edits and falls back to the
  existing path for conflicting sources or an ambiguous held final frame.

The new GPU regressions measure silent prefixes, onset-to-sustain levels,
initial-to-medial fricative levels, and phonation versus turbulence using
controlled source ablation. Reintroducing an unprepared gesture or the old
30 ms unvoiced decay fails the corresponding regression. These are acoustic
implementation checks; a new human listening run is still required.

Research supports separating preparatory gestures and voicing transitions from
steady vowel or fricative targets; see
[anticipatory vocal-tract posturing](https://pmc.ncbi.nlm.nih.gov/articles/PMC4711920/)
and [glottal opening during fricatives](https://www.isca-archive.org/interspeech_2017/elie17_interspeech.html).
The numerical timing constants remain authored approximations.

Sources: `agi/particle_voice/model/ArticulationHead.js`,
`agi/particle_voice/model/ParticleVoiceModel.js`,
`tests/particle-voice/articulation-head.html`,
`tests/particle-voice/voice-model-end-to-end.html`, and
`tests/particle-voice/stop-release-alignment.html`.

### Reproducible listening evidence

New classroom and blind-listening exports identify the authored acoustic
revision (`particle-voice-articulation-r3` for the current classroom corrections;
`particle-voice-articulation-r2` identifies the earlier closure repair), the
randomization algorithm version, and each playback's actual resolved model
configuration. The revision is an authored label, not a signed build attestation.
Configuration is captured from the model that rendered the sound, including a
tract created lazily on the first render; later tuning cannot rewrite it.

Each completed playback also records a SHA-256 identity of the model's mono
float32 PCM before resampling. The digest covers a versioned encoding prefix,
sample rate, sample count, and little-endian sample bytes. It distinguishes
identical rendered audio from merely matching summary metrics. It does not
identify the speaker output, prove intelligibility, or authenticate the listener.
No raw PCM is included in the JSON or persisted by this feature.

The synthesis evidence also records `alignedReleaseCount` and
`maxReleaseDelaySamples`, so subsequent reports show how many generated stop
bursts used alignment and the largest modeled delay. These are synthesis
measurements, not hardware playback latency.

Hashing runs alongside playback. Stop and generation changes prevent late
hashes from admitting stale answers. Missing or failed WebCrypto is explicitly
reported as unavailable and does not disable otherwise successful speech.
Existing seeded trial and choice order are unchanged. The 20 provenance tests
cover known digest vectors, buffer views, cancellation, unavailable hashing,
lazy configuration, owner replacement, and both export modes.

The r2 GPU/worklet UI check completed all 26 automated **I couldn't tell**
answers, tuning, Stop/recovery, and full JSON copy on both the source tree and an
isolated 47-asset release closure. No microphone or external request was made.
This validates delivery and reporting, not human speech recognition. The full
packaged OS and RealmForge-load acceptance gates remain separate.

Sources: `agi/particle_voice/lab/VoiceLabDiagnostics.js`, `ListeningEvaluation.js`,
`agi/particle_voice/risk/ReceiptCrypto.js`,
`tests/particle-voice/listening-provenance.html`, and
`tests/particle-voice/run_voice_lab_streaming.py`.

### Stop-release experiment and r3 follow-up

A separate K/Q experiment found that the head starts the release burst at
130 ms while the chunk-interpolated tract remains closed until about 132 ms.
Delaying only the burst by one current 4 ms render chunk increased measured
early burst contribution by approximately 3.8–4.1 dB, without changing the late
vowel. Relocating the source junction did not help. These earlier controlled GPU
experiments motivated the r3 follow-up; a fixed 4 ms delay was not shipped.

The existing shared amplitude/index streams combine release turbulence with
other noise. The r3 implementation uses separate immutable burst provenance to
align eligible transients with modeled opening, while preserving authoritative
amplitude/routing edits and the legacy path when alignment is ambiguous. Steady
frication and aspiration are not globally delayed. Q already had a stronger
measured burst than K, so this timing defect does not by itself explain every Q
listening failure. Human acceptance remains open.

## Remaining rollout gates

- Obtain controlled minimal-pair and sentence listening results beyond the first classroom report. Repair confirmed acoustic failures using the diagnostic corpus without changing calibrated geometry on speculation.
- Verify speech under actual RealmForge GPU load and real microphone/speaker conditions. Acoustic interruption is not enabled by this milestone.
- Finish moving prompt/run ownership out of AI Echo's mounted implementation. Durable quick-prompt receipts and direct side questions do not yet make that runtime UI-independent. Exact-task Stop/Steer is implemented; Pause/Resume remains unavailable until the executor supports it.
- Expand beyond the implemented scheduler-backed agenda, revision-bound RealmForge context, disposable 3D previews, and measured hover body. Protected-storage and genuine authority-provider prerequisites still gate full Virtual Realm embodiment. See [Navi Growth and AI Gym](navi-development.md) for the current integrations and limits.
- Extend the verified program/task/screen outcome loop to broader world curricula. Program receipt inspection and separate improvement drafts preserve existing staged-edit approvals. Pronunciation overrides affect the real frontend, but do not imply autonomous model training or self-authorized code changes.
- Exercise cold boot, recovery, touch/keyboard, reduced motion, source/device failure, and complete packaged OS behavior before removing any experimental label.

## See also

- [WebGPU OS Architecture](architecture.md)
- [Installed System Releases](installed-system-releases.md)
- [RealmForge Modular Workbench](realmforge.md)
- [AGI Overview](../agi/overview.md)
