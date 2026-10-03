<!--
SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
-->

# Video Player and Watch Party

Video Player (`os.video-player`) opens browser files, dropped files, virtual-filesystem paths, and HTTP(S) sources. Watch Party is a mode of this same app. Open a video, expand **Watch Party**, enter a display name, and select **Start Watch Party**. SecureMesh opens the same player with its current source through an account-bound handoff. A party contains one host and at most five viewers. The host controls the source and timeline; each viewer controls local sound and display. Legacy `os.watch-party` navigation resolves to the canonical player before process launch and navigation queuing.

The lightweight browser entry is `/webgpu-os/watch-party.html`. Without an invitation it opens the complete player with local-file, URL, playlist, and party controls. Invitation links open that same player in restricted viewer mode. Following an invitation fragment within the already-open page releases the previous player and party before entering viewer mode. The page loads the shared engine media runtime without booting the OS, registering an OS account, or joining a SecureMesh call. Guests enter a display name and explicitly select **Join**. Pending hosting and joining can be canceled. If browser autoplay is blocked, the player displays **Enable playback**. Local playback can load even when secure Web Crypto or WebRTC is unavailable; hosting and joining remain disabled in that environment.

Sources: `engine/media/VideoPlayer.js`, `engine/media/WatchPartyView.js`, `webgpu-os/factory/apps/video-player/VideoPlayerApp.js`, `webgpu-os/kernel/SubsurfaceManager.js`, `webgpu-os/watch-party-boot.js`.

## Playback and playlists

The engine player owns source loading, cancellation, playback, seeking, rate, volume, subtitles, fullscreen, and capability-dependent picture-in-picture. Native playback uses the browser's installed media implementations. Direct HTTP(S) HLS uses locally vendored hls.js 1.7.3 on supported MediaSource devices, with native HLS fallback otherwise. Loose local manifests cannot resolve sibling segment files. HLS distribution files and their hashes are recorded in `vendor/hls.js/provenance.json`; `tools/vendor_hls.py` verifies the pinned archive before extracting pristine files. Selection follows the [pinned upstream recommendation](https://github.com/video-dev/hls.js/blob/v1.7.3/README.md#alternative-setup).

An empty player explains how to open media and disables unavailable controls. PiP appears only for loaded native video when the browser API and policy permit it. Audio-only streams and custom canvas output do not advertise native video PiP. This follows the metadata, video-track, policy, and activation requirements in the [W3C Picture-in-Picture algorithm](https://www.w3.org/TR/picture-in-picture/) and the [WHATWG media readiness states](https://html.spec.whatwg.org/multipage/media.html#ready-states). Clearing or replacing media resets the autoplay unlock state.

Playlists support next/previous, reordering, shuffle, repeat, and JSON/M3U interchange. Persisted HTTP(S) and OS paths remain usable references. Browser-selected files require reselection after a fresh session because their Blob references are temporary. WebVTT and SRT subtitles are supported.

For a remote URL that will be restreamed, select **Enable restreaming for remote URLs** before loading it. The source server must allow CORS so the browser can export its pixels and audio. URLs without this option still use ordinary native playback and can use same-source synchronization. A capture failure explains when the source cannot be exported.

Sources: `engine/media/Playlist.js`, `engine/media/Subtitle.js`, `engine/media/PlayerView.js`, `engine/media/VideoPlayer.js`.

## Invitations and admission

WP1 invitations contain 52 grouped Crockford-base32 payload characters: a 128-bit random seed and the first 128 bits of SHA-256 over the host's raw signing public key. A link carries the same code in `watch-party.html#invite=<code>`. Case and grouping are normalized; unsupported versions, lengths, alphabets, and nonzero padding are rejected.

Domain-separated HKDF derives independent rendezvous and admission-proof keys. Before accepting playback or signaling, the guest verifies the pinned host and signed descriptor. Admission binds a fresh challenge, invitation proof, and temporary guest signing identity. Reservations are serialized so pending and admitted viewers together never exceed five.

Invitations expire after 24 hours by default and allow multiple joins. Rotation rejects new joins through the old code while retaining admitted viewers. Removing a viewer closes their content connections and rotates the invitation. Closing the host ends the party; viewers cannot elect themselves host. Guest refresh creates a fresh in-memory identity.

Party grants authorize only this party's control and content connections. They confer no Passport, friend, group, filesystem, or OS permissions. The daemon attaches verified sender identity metadata to encrypted signals and can direct signals to a verified session. Admitted peers receive separate private rendezvous routes so invitation rotation can retire the admission route without disrupting their connections.

Sources: `engine/media/party/Invite.js`, `engine/media/party/Protocol.js`, `engine/media/party/WatchParty.js`, `engine/media/party/PartyPeer.js`, `engine/network/daemon/ParticleNetworkDaemon.js`.

## Realm Network integration

Inside the OS, the kernel acquires each party's rendezvous lease through `NetworkDriver.acquirePartyRendezvous()`. Acquisition requires the enabled, running unified browser endpoint and an enabled pinned Particle V2 server from the current Realm Network configuration. The driver supplies the configured pins; app options cannot replace them or the daemon factory. Resident presence can be disabled while a foreground party remains available.

Each party retains its own fresh, nonpersistent signing identity. The driver does not substitute the OS profile or device identity. It tracks the lease under `os.video-player`, exposes a `party-v2` connection status without invitation material or temporary keys, and limits app status views to that app's leases. Issued signaling operations recheck the app mount, active account, network permission, quarantine, and operator generation. App closure, account changes, endpoint opt-out, server trust changes, operator drain, and driver destruction release the lease and end the party.

The standalone browser entry uses the same engine daemon registry and pinned rendezvous implementation directly. It does not boot an OS account or depend on SecureMesh. SecureMesh is an optional source handoff into Video Player.

Sources: `webgpu-os/drivers/NetworkDriver.js`, `webgpu-os/kernel/Syscalls.js`, `engine/network/daemon/ParticleNetworkDaemonRegistry.js`, `tests/media-network-bridge.test.js`.

## Synchronization and host restreaming

Shared HTTP(S) sources can synchronize to host playback state. Host-only sources use dedicated WebRTC program connections with both video and audio. Native restreaming is the default. Cross-origin sources must permit capture; capture or canvas-security failures are displayed instead of silently substituting another source.

Program audio branches before local listening gain. Muting the host's player, app mixer, or system mixer therefore does not mute the audience's program. Capture leases, tracks, object URLs, timers, subscriptions, and codec workers are released on source changes or disposal. The OS handoff broker binds each issued player and party to its app mount and active account; a share token is short-lived and can be redeemed once by the canonical Video Player. Party and borrowed-source operations recheck the current mount, network grant, and quarantine state. A party reservation remains owned until asynchronous cleanup completes. Failed SecureMesh navigation cancels its pending handoff without disposing the source.

The optional authored-codec transport explicitly scales input to a 360p/24 preset. Lossless describes the RGBA frames entering the encoder after any declared resizing. Binary packets carry timestamps, reference identifiers, source revisions, checksums, and keyframe flags. Fragmentation and backpressure bound delivery. Late joins request a decodable keyframe; changing source or seeking invalidates old references and audio scheduling.

Sources: `engine/media/LiveCodecSession.js`, `engine/media/LiveAudioWorklet.js`, `engine/media/party/PartyPeer.js`, `webgpu-os/drivers/AudioDriver.js`, `webgpu-os/kernel/MediaPlayerShareBroker.js`, `webgpu-os/kernel/Syscalls.js`.

## Authored codec capabilities

Our JavaScript implementations remain separate from native media playback and WebCodecs. Calling WebCodecs invokes a browser implementation; it does not make that implementation ours. See the [W3C WebCodecs specification](https://www.w3.org/TR/webcodecs/).

| Implementation | Supported input and tools | Validation boundary |
| --- | --- | --- |
| PRV lossless v1 | RGBA8 tiled frames, previous-frame reuse, solid/palette/RLE/raw modes; up to 1280×720 at 30 fps | Exact decoded encoder-input bytes; bounds, CRC, references, and corrupt-stream rejection |
| PRV lossy v1 | Deterministic integer 8×8 Walsh-Hadamard transform, quantization, coefficient coding, reconstructed-frame prediction, SDR 4:2:0 | Encoder/decoder reconstruction parity and deterministic output |
| H.264 restricted encoder/decoder | Constrained Baseline; progressive 8-bit 4:2:0, all-IDR I_PCM, one slice, deblocking disabled; Annex B. Levels are selected conservatively from bitrate and dimensions (3.1 for the small fixture; 5.0 for 640×360/24; 6.2 for 1280×720/30) | Independent browser software decoder accepted cropped pictures; I_PCM is uncompressed and this decoder rejects other H.264 tools and insufficient declared levels |
| MPEG-1 restricted encoder/decoder | Progressive 8-bit 4:2:0 DC-only intra pictures, 24/25/30 fps, one slice per macroblock row | Normative golden fixture and independent JSMpeg picture decoding |
| MPEG-2 restricted encoder/decoder | Main profile at High-1440 level, progressive 8-bit 4:2:0 DC-only intra pictures, 24/25/30 fps | Common intra picture syntax cross-checked with JSMpeg; extension syntax checked against H.262; a full independent MPEG-2 decoder check remains outstanding |
| AV1 restricted encoder/decoder | Main 8-bit, monochrome two-color palette per 64×64 intra tile in AV01 IVF, static CDFs, no residuals or filters; dimensions in multiples of 64 from 64×64 through 1024×512, up to 30 fps | Seventeen input-derived images decoded through the independent browser software AV1 decoder match authored decoder luma samples; hardware compatibility varies; color and general AV1 tools are unsupported |

These restricted standard decoders are not general decoders for ordinary compressed movies. Unsupported profiles and tools return explicit errors. Native playback remains available for ordinary browser-supported files. Capability declarations are in `engine/media/codecs/index.js`; normative standard behavior comes from [H.264](https://www.itu.int/rec/T-REC-H.264), [H.262](https://www.itu.int/rec/T-REC-H.262), and the [AV1 specification](https://aomedia.org/specifications/av1/). Broader support requires independent interoperability and the applicable [H.264 conformance](https://www.itu.int/rec/T-REC-H.264.1) or AV1 fixtures before changing the declared capabilities.

PRV1 containers include a checked seek index, keyframes at most two seconds apart, and optional timestamped PCM16 audio. Seeking resets audio and reconstructs from the indexed keyframe. Parsing limits dimensions, frame counts, byte allocations, packet sizes, and reference chains. Worker clients cap outstanding requests and terminate timed-out workers.

Sources: `engine/media/codecs/Container.js`, `engine/media/codecs/FramePacket.js`, `engine/media/codecs/LosslessCodec.js`, `engine/media/codecs/LossyCodec.js`, `engine/media/codecs/H264Pcm.js`, `engine/media/codecs/MpegIntra.js`, `engine/media/codecs/AV1Intra.js`, `engine/media/codecs/CodecClient.js`.

## Deployment and verification

Internet invitations require a publicly reachable HTTPS guest page and working Particle V2 rendezvous plus ICE/TURN infrastructure. Localhost invitation links are local-only. Remote parties require secure Web Crypto. ICE configuration is validated and expiring credentials are refreshed through the existing network stack.

Source and bundled releases include the guest entry, its transitive modules, codec workers, audio worklet, and pinned HLS assets. Build validation rejects missing modules and worker assets before publish. Guest-page CSP and service-worker navigation are tested separately from the OS launcher.

Run the relevant checks from the repository root:

```powershell
python -B tests/run_media_owner_audio.py
python -B engine/media/party/tests/run_party_tests.py
python -B tests/run_media_codecs.py
python -B tests/run_media_player_smoke.py
python -B tests/run_media_readiness.py
python -B tests/run_media_app_alias.py
python -B tests/run_media_unified_boundaries.py
python -B tests/run_media_network_bridge.py
python -B tests/run_media_ui.py
python -B tests/run_watch_party_guest.py
python -B tests/run_securemesh_media_regressions.py
python -B engine/media/codecs/av1-tests/run_av1_tests.py
python -B -m unittest bundler.tests.test_watch_party_assets
python MD/tools/build_docs.py
python MD/tools/build_llms.py
```

Browser evidence covers Chrome local crypto, RTP/SCTP, received video and audio waveforms, admission capacity, invitation rejection, rotation, authority boundaries, codec reconstruction, and program export. Local rendezvous substitutes are test infrastructure only. Adverse-NAT TURN, Firefox, and Safari still require environment-specific verification.

The production network probe on 2026-10-01 stopped before authentication because the browser blocked `https://discovery.particlerealms.online/v2/manifest` for missing CORS permission from the fresh loopback origin. No production admission or content connection was established. A separate direct HTTP diagnostic returned Cloudflare 403/1010; that status is not asserted for the browser request. Both isolated probe contexts ended with their identities, routes, and daemon leases released. Fix manifest delivery and allowed guest origins at the service before advertising Internet invitations. The opt-in diagnostic is `python -B engine/media/party/tests/probe_party_network.py`; it is excluded from offline tests.

Synthetic codec benchmarks are recorded with their fixture and device context in test evidence. They do not predict arbitrary video compression or latency. For example, a 640×360, 12-frame lossy fixture at quantizer 12 produced 176,821 encoded bytes from 11,059,200 input bytes, with encoder median 46.2 ms and decoder median 23.2 ms in one headless Chrome run. These timings exceed a 24 fps frame budget for this run; the implementation exposes drops and backpressure rather than promising real-time performance. Measure real-source bytes, encode/decode latency, accounted buffers, dropped frames, and audio/video drift before advertising performance.

The opt-in HLS check (`python -B tests/run_media_hls_online.py --allow-network`) uses the official pinned hls.js README sample. The observed shared-player run decoded 1280×720 video, advanced beyond two seconds, produced a nonzero PCM waveform, and used the local vendored worker under the exact guest CSP with no playback or CSP errors. Network availability remains an external requirement; the cleanup-aborted segment is preserved in `tests/media-hls-online-shared-observed.txt`.

Sources: `tests/media-codecs.test.js`, `engine/media/party/tests/party.test.js`, `tests/media-owner-audio.test.js`, `bundler/tests/test_watch_party_assets.py`, `bundler/site.py`.
