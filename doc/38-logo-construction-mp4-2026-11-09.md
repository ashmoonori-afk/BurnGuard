# The construction draw-in MP4 export (2026-11-09)

Phase P5 of the next logo version, last export. doc/36 added the draw-in GIF and doc/37 the menu
entries; this record adds the same draw-in as an MP4, for places that take video but not GIF (slide
tools, social posts), behind a codec probe that points to the GIF when H.264 is missing.

## What the export does

- Format `construction_mp4`, no options, logo projects only (`format_requires_logo` from the service
  and the route, before an export authority exists), like the GIF.
- The frames are the GIF's frames. `export-construction-gif.ts` now exposes
  `readConstructionRecord` (missing or invalid records fail as `construction_missing` /
  `construction_invalid`) and `forEachConstructionFrame` (480 x 480 on white, one frame per 100 ms of
  the draw-in, at most 120, the last one held 2 s). The GIF output is unchanged.
- `export-construction-mp4.ts` launches the bundled Chromium, opens an empty page on a routed
  `https://construction-encoder.burnguard.invalid` origin (WebCodecs exists only in a secure
  context; nothing reaches the network), and probes `VideoEncoder.isConfigSupported` for
  `avc1.42001e` (constrained baseline, level 3.0: no B-frames, so samples arrive in display order).
  A Chromium without that encoder fails the export as `construction_mp4_unsupported` before any frame
  is sent.
- Each frame goes to the page as a PNG, becomes a `VideoFrame` with its own timestamp and duration,
  and is encoded with `avc: { format: "avc" }`. The first frame is a key frame. The video plays once
  and stops on the finished drawing; a player's loop setting decides the rest.
- `mp4-writer.ts` writes `ftyp`, `moov` (one video track, every sample in one chunk, timescale
  1000) and `mdat`, with the encoder's decoder configuration record as `avcC`. No creation times, so
  the same samples give the same bytes.
- The file is `<slug>-construction-r<rev>.mp4`, `video/mp4`. The receipt records
  `{ frames, width, height, bytes }`, the GIF's shape; export parity counts it as one page. The ring
  of the tests is 22 frames, 4.1 s, about 50 KB. Files over 8 MiB fail as `construction_too_large`.
- Migration `0031_construction_mp4_export_format.sql` widens `ck_exports_format` (rebuilt from 0030).

## The menu

The logo export menu lists `Construction draw-in MP4` after the GIF, disabled with the same
`construction_missing` reason until the record exists (doc/37). A failed MP4 export whose message
carries `construction_mp4_unsupported` shows `export.construction.mp4_unsupported`, which tells the
person to export the same draw-in as a GIF.

## Checks

- `mp4-writer.test.ts`: an independent reader (`tests/helpers/mp4-parse.ts`, written from ISO/IEC
  14496-12) finds one video track with the same samples, durations, key frames and `avcC`; equal
  durations are stored as runs; the bytes are deterministic; empty input and a non-key first sample
  are refused.
- `logo-construction-mp4.test.ts` (real Chromium, `BG_BROWSER_SMOKE=1`): the export holds one
  constrained-baseline sample per GIF frame with the GIF's durations, and decoding every sample with
  `VideoDecoder` gives first and last pictures within a mean luma difference of 4 of the source
  frames, with ink in the ring band and paper in its hole. A codec no encoder has fails as
  `construction_mp4_unsupported`, writes nothing and closes the browser. A missing record fails
  before any browser starts. The suite runs in the OS matrix, so the probe is exercised on macOS
  arm64, Windows x64 and Ubuntu.
- `logo-export.test.ts`: the route and service refuse a prototype project, and a logo project's
  export succeeds through the pipeline with a parsed receipt.
- Outside the suites, `ffprobe` reads the ring export as H.264 Constrained Baseline, 480 x 480,
  22 frames, 4.1 s, and `ffmpeg` decodes it without errors.

## Not in this phase

- The geometry JSON inside the plain `svg` export stays deferred (doc/35).
- A dark-theme video, like the GIF and the sheet.
