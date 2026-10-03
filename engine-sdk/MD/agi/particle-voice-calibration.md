---
title: ParticleVoice Calibration
description: Save listening evidence, compare controlled voice changes, and inspect authorized reference recordings in Speech Studio.
updated: 2026-09-08
---

<!--
SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
-->

# ParticleVoice Calibration

Speech Studio saves the audio people actually evaluated and provides a workspace for comparing controlled synthesis changes. This guide covers the current authored voice and its calibration tools. The learned speech, singing and voice-capsule roadmap has separate implementation and data requirements.

## Open Speech Studio

Start the repository's Python development server, then open `/agi/particle_voice/lab/voice-lab.html` over HTTP. Choose **Enable audio** when ready to listen. The studio uses the existing WebGPU voice model and shared AudioWorklet playback owner.

```bash
python start_server.py
```

The current experimental renderer is an authored articulatory waveguide with a 64 kHz model clock and 100 Hz control frames. Playback uses the actual audio-context sample rate. The master plan's future 32 kHz neural interface is not the current renderer's clock. Source: `agi/particle_voice/model/ParticleVoiceModel.js` and `agi/particle_voice/lab/VoiceLabDiagnostics.js`.

Revision `particle-voice-articulation-r12` distinguishes reduced schwa (`AH0`) from full STRUT (`AH1` and `AH2`). It reuses the existing neutral vowel geometry and carries lexical stress through vowel targets, neighboring stop gestures, glide overlap and silent preparation. Calls without stress retain the original isolated AH profile. Six dictionary entries restore primary stress so `one`, `plus`, `up`, `what`, `what's` and `just` keep full vowels. Source: `model/ArticulationHead.js` and `frontend/PronunciationLexicon.js` within `agi/particle_voice/`.

Schwa also varies with context and duration; the neutral profile is an authored approximation, not a fitted universal target. The representation distinction is described by [Cohen Priva and Strand](https://urielcpublic.s3.amazonaws.com/papers/CohenPriva_Strand_Schwa-Accepted.pdf). The existing gesture model still determines actual movement and geometry-dependent release routing. This correction does not change burst bandwidth or establish a listening-quality score.

The r11 punctuation correction remains: the existing pitch contour applies to every phrase in a multi-phrase plan. Earlier revisions applied it only to the last phrase. Source: `model/ProsodyPlanner.js` within `agi/particle_voice/`.

The text frontend resolves explicit whole-word entries before attempting regular `s` and `ed` endings from known stems. It preserves stem pronunciation and stress, then chooses the ending from the final sound, so `picked` ends in T and `birds` ends in Z. Derived pronunciations remain marked as approximate rules and retain their stem provenance. Unknown stems, ambiguous analyses and known exceptions use the existing fallback. This does not resolve word senses such as weather `wind` versus the verb `wind`; review that pronunciation explicitly. Source: `frontend/G2PModel.js` and `frontend/PronunciationLexicon.js` within `agi/particle_voice/`.

## American voice previews

Revision `particle-voice-articulation-r14` adds **American male** and **American female** to the existing voice settings. Enable audio and choose **Voice**: selection immediately applies the visible settings without playing sound. Use **Play preview** to hear the selected voice. Optional **Fine tuning** slider edits remain drafts until **Apply**, **Apply and preview**, or another voice selection. The status identifies the active voice; a failed replacement restores its selection. Finish an active listening test before changing voices. Reset returns to the original male settings. Source: `lab/VoiceLabTuning.js` and `lab/voice-lab.html` within `agi/particle_voice/`.

**Say ABCs**, replaying its punctuation-separated alphabet text, and entering a single letter all use the letter-name pronunciation path. For example, `a. b. c.` speaks the names A, B and C rather than the article A or isolated consonants. Ordinary prose such as `a book` retains text pronunciation. Preview, tuning preview, inspection and three-tone generation share the same decision. The studio blocks other audio/test actions while a voice replacement is pending, then permits playback after the applied configuration is published.

Both presets use the same owned synthesizer and American pronunciation frontend. The male preset starts at 120 Hz with 32 oral and 24 nasal sections; the female preset starts at 205 Hz with 30 oral and 23 nasal sections. At the 64 kHz model clock, their modeled oral lengths are 17.0 cm and 15.9375 cm. These are authored candidates, not trained speakers or measured population norms. Joint pitch and formant changes affect perceived voice identity; pitch alone does not establish it. See [Hillenbrand and Clark (2009)](https://pubmed.ncbi.nlm.nih.gov/19525544/). Source: `model/VoicePresets.js` and `articulatory/ParticleTract.js`.

Tuning receipts record the base preset separately from effective parameters. Schema 2 retains voice identity; a schema 1 tuning snapshot restores the original male defaults. A replacement model also rebuilds the manual articulator at the selected section count while retaining the existing pronunciation overrides and playback owner.

R14 corrects reviewed sounds or stress in `ready`, `getting`, `better`, `seventeen`, `seventeenth`, `phase`, `sink`, `easy`, `beside` and `six`. A final stop can begin approaching an immediately following word's vowel within the same explicitly identified phrase. This changes the vowel background while retaining word-specific aspiration and K–S rules. Punctuation, invalid metadata and discontinuous frame maps block the new overlap. Sources: `frontend/PronunciationLexicon.js` and `model/ArticulationHead.js`.

Multiword questions beginning with a wh-word, including contractions such as “what's,” receive a falling default. Yes/no questions and isolated echo words retain the existing question contour. This is a text heuristic, not a discourse model; `whQuestionF0Scale` controls its strength without changing durations. Ordinary American wh-questions frequently fall, while rising variants serve other discourse functions. See [Hedberg and colleagues (2010)](https://www.isca-archive.org/speechprosody_2010/hedberg10_speechprosody.html). Source: `model/ProsodyPlanner.js`.

The lisp-like listening report remains an open quality issue. Controlled S/Z source-position experiments mainly increased noise level and reduced relative vowel level, without a clear recognition gain, so those changes were rejected. S/SH spectra remain distinct; weak TH, vowel/coda recognition and connected-speech errors still need listening evidence. The two exact-minute recordings, automated transcriptions and engineering checks do **not** establish an 8/10 naturalness or fluency rating. Record those ratings separately from correctness.

## Compare three tones of one voice

In **Preview**, apply either voice, enter a short example, then open **Three-tone comparison (experimental)** and choose **Generate comparison**. Each comparison uses one voice at low, middle and high pitch. The low and high passes are three semitones below and above the applied pitch. Switch the applied voice and generate again to compare the other voice separately. The preview limit is 15 seconds; the underlying analysis helper accepts up to 60 seconds.

**Mid (original)** supplies the original waveform. **Recovered** uses the three passes to estimate a small change to its spectral balance. It retains the middle pass's complex phase and applies the correction only inside guarded, stable monophthong regions. Consonants, nasal overlap, strong breathiness and vowel boundaries bypass the correction exactly in the raw samples. The processor never sums the three voices. Short or ineligible examples can produce an exact bypass; the result reports that explicitly. Source: `lab/VoiceToneRecovery.js` and `lab/VoiceTonePanel.js` within `agi/particle_voice/`.

All passes share the original phones, timing, tract geometry and noise controls. Only four LF source timing arrays change with pitch. The spectral estimator follows the peak-envelope principle described by [Röbel and Rodet (2005)](https://dafx.de/paper-archive/2005/P_030.pdf), with four iterations, a level-normalized median and a correction bounded to 3 dB. These choices define an experiment; they are not a validated voice repair. Source pitch also changes absolute excitation tilt, so envelope differences cannot be attributed solely to missing tract detail.

Previews match whole-clip RMS using recorded scalar gains and common peak headroom. Equal RMS does not guarantee equal perceived loudness. **Download WAVs & results** preserves the unmodified low, mid, high and recovered WAVs, the frozen plan, applied configuration and hash receipts. Saved comparisons reopen from this browser's existing experiment store. This optional comparison leaves the applied voice and classroom scoring unchanged; it does not establish an 8/10 quality score or enable automatic training.

After **Mid (original)** and **Recovered** finish playing, optionally answer **Which is clearer?** Choose either version, **About the same**, or **Couldn't judge**. The saved response identifies the exact WAVs, playback gains and completed plays. The labels remain visible, so this is a preference from practice, not a blind listening score. Hashes protect the saved data and audio; a source revision name alone is not a hash of every loaded synthesis module.

The first fixed-script experiment reproduces both r14 middle recordings exactly. One cached offline recognizer returns identical middle/recovered transcripts for both 60-second recordings and eight short examples, each tested in both conditions. There is no demonstrated recognition gain: `moon`/`noon`, `think`/`sink` and stop-word confusions remain. Keep this processing experimental. Exact dry samples protect the declared regions; they do not establish that every possible transient inside a processed vowel is unchanged.

## X and stop–fricative blends

Revision `particle-voice-articulation-r13` gives an overlapping stop release and oral fricative separate noise sources. K's fading burst therefore stays at its release location while S develops at its own location. The optional second source preserves the existing single-source path for earlier physiology records, manual routing overrides and unrelated sounds. Sources: `model/ArticulationHead.js`, `model/ParticleVoiceModel.js`, `articulatory/ParticleTract.js` and `nn/kernels/articulatory/coupled_tract_waveguide.js` within `agi/particle_voice/`. Independent localized constriction sources follow the approach discussed by [Birkholz (2014)](https://www.vocaltractlab.de/publications/birkholz-2014-issp.pdf).

The same revision moves the modeled K closure forward only immediately before S within its authored word and vowel context. The normalized position of 0.50 is an acoustic calibration for this renderer, not a universal anatomical measurement. Isolated K, reverse S–K sequences and K before another word retain their prior geometry. English velar contact varies with vowel context and speaker; see [Liker and Gibbon (2008)](https://pubmed.ncbi.nlm.nih.gov/18253872/). The earlier experimental S preparation and global K relocation were not adopted.

In the saved 17-item comparison, two local Whisper-family recognizers both identify the revised X. One also improves six, fix and books; neither loses a previously correct output in those items. Nine protected items retain their exact baseline WAVs. This is a limited automated comparison, not a human listening-quality score or proof that every K sound is correct. Pronunciations, word durations and vowel targets remain unchanged.

## Preserve a listening result

1. Use **Listening tests** to complete a test. Answer what you understood before revealing the target.
2. Optionally choose **Guessing**, **Unsure** or **Sure**. Use **More feedback** for separate quality ratings and problem notes.
3. Open the saved test and download **WAVs + results** to retain the exact generated samples and response history together.

The archive preserves float32 model PCM before playback resampling. Its manifest maps trials and plays to content-addressed WAVs. A drained playback receipt records software completion; it does not measure physical speaker output. Historical JSON-only reports cannot recover discarded audio. Source: `VoiceLessonAudioArchive.js` and `VoiceLessonAudioPanel.js` in `agi/particle_voice/lab/`.

Confidence and quality remain separate from correctness. Feedback events distinguish changed fields in `patch` from carried-forward `values`. Interpret a field's timing using the event that changed it. Unprovided ratings mean unrated. Source: `ListeningFeedback.js` and `ListeningEvaluation.js`.

## Compare a controlled change

1. Open **Compare changes**, create a K comparison, or import a saved experiment bundle.
2. Prepare the comparison audio. Pause and resume when needed; completed identical plans reuse their saved PCM.
3. Complete anonymous first transcriptions before replay or inspection. Separate A/B judgments ask about clarity and naturalness.
4. Inspect completed sounds and an authorized reference recording to investigate the difference.
5. Use **Review a candidate for this lab** to see the required matched evidence. Acceptance selects saved lab assets; rollback restores the previous lab selection.

The existing comparison freezes 20 targets and four conditions: baseline, K release location, voiced-vowel entry carryover, and both controls. These are diagnostic interventions, not independently validated repairs. The release control changes the noise injection junction and its cavity response; it is not an independent burst equalizer. Source: `VoiceExperimentControls.js` and `VoiceExperimentRunner.js`.

The current acceptance policy requires matched human first answers for key, tea, cap, cool, X and the number sentence. Other rendered contexts are available for inspection but are not all acceptance gates. This policy does not certify production release or the full master plan. It cannot promote automated test answers as human evidence.

## Inspect references without changing the evidence

Import a recording with its corrected transcript and authorization. The experiment retains original file bytes separately from decoded mono PCM. Reference sample coordinates use the decoded asset's recorded clock, which can differ from both the original file's clock and the generated sound's clock. Source: `VoiceExperimentStore.js`.

Inspection reveals intended text and records exposure. An already exposed target cannot supply a fresh blind answer in that experiment. A reference recording and manual boundary correction are diagnostic evidence; they are not automatic training or proof of correct pronunciation.

Keep intended synthesis events separate from reference annotations. A plan can contain a release timestamp even when the audible cue is inadequate. Spectral differences likewise do not establish that a listener can recognize a contrast.

### Compare a short sound region

1. Open **Preview saved sounds & reference audio** after leaving the listening review. Show a generated sound and load its reference. If none is saved, **Add reference recording** opens the existing importer.
2. Drag a region in either waveform or enter start and end times. Each selection can span up to ten seconds. Exact sample controls remain available for precise edits.
3. Open **Timing markers** to select a planned word, phone or release, or a manually annotated reference event. Use **Fit selections** to inspect short regions and **Whole recordings** to restore the full view.
4. Mark corresponding moments and choose **Align marked samples**. Alignment shifts the display only. **Use recording starts** disables that shift; the saved state retains whether alignment was enabled.
5. Open **Compare sound energy** for spectra and spectrograms. Each clip retains its own sample rate. Both displays use common frequency and amplitude scales, with window size, hop and any retained-window sampling reported.
6. Choose **Play selection** to audition the original selected samples through the shared playback owner. This diagnostic crop does not add a whole-word playback or answer to the listening record.
7. Choose **Save inspected regions** to preserve both regions, anchors, alignment state and analysis settings. **Restore saved regions**, reload and experiment export retain the same view parameters.

For example, compare a short K onset against a reference onset, then widen both selections to include vowel entry. Keep the complete recordings available: an isolated crop is a different listening context from the word. Exact selections can introduce cut-edge clicks; check the complete recording before diagnosing a click. Sources: `VoiceReferenceInspector.js`, `VoiceExperimentPanel.js`, `VoiceExperimentRunner.js` and `VoiceExperimentStore.js` in `agi/particle_voice/lab/`.

Reference comparison records are append-only and bind their integer sample coordinates to the exact generated and decoded-reference assets. Hash and range validation runs during save, load and import, including historical revisions. A manually aligned display is not an automatically measured alignment.

## Master plan implementation boundary

| Area | Current boundary |
| --- | --- |
| Reproducible trials | Exact plans, model PCM, settings, response history and verified bundles exist. A newly created comparison plans the current model; importing a report alone does not import its original audio. |
| Controlled K experiments | Four fixed conditions exist, with bounded controls and unchanged synthesis defaults. |
| Review and rollback | Anonymous transcription, separate preferences and lab selection receipts exist. There is no automatic replacement of the live voice. |
| Reference learning | Original/decoded recordings, visible manual annotations, aligned region inspection and spectral diagnostics exist. Forced alignment and reference-to-physiology inference are not implemented. |
| T03 comparison scope | The reference-inspection portion exists. A comparison-specific direct-phone editor and matched offline/streamed rendering comparison remain subsequent work. |
| Search and reuse | Identical-plan render reuse exists. Configurable optimizers, context calibration and selective review remain subsequent work. |
| Learned speech and singing | Training data, verified backward operators, trained models, performance editing and independent quality gates are still required. |

The next acoustic repair needs a discriminating comparison, independent listening and transfer evidence. Completing renders or implementing an editor is not evidence that synthesis quality improved. Source: `buildVoiceExperimentCapability()` in `VoiceExperimentControls.js` and `acceptanceStatus()` in `VoiceExperimentRunner.js`.

## See also

- [AGI index](index.md)
- [GPU device sharing](../concepts/gpu-device-sharing.md)
- [AGI architecture](architecture.md)
