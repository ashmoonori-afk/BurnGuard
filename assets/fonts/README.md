# Bundled fonts

Load `fonts.css` for all 39 families and read `fonts.md` before choosing a typeface: it documents every family's traits, measured Hangul coverage, file size, best uses and pairings. The manifest records each original font URL, its SIL Open Font License 1.1 file (with copyright notices), the measured count of modern Hangul syllables (U+AC00-U+D7A3) and any Reserved Font Names. Keep those license files with redistributed fonts.

The original six Google Fonts files were downloaded from the official `google/fonts` repository on 2026-09-09; the 32 families added on 2026-09-11 were downloaded from `google/fonts` at commit `8e44913e4ff26fc997e6856c1ec40ff4791c98c5` (the manifest `source` URLs are pinned to that commit). All were losslessly packaged as WOFF2 with fontTools 4.62 and Brotli. No glyph subsetting was performed and no WOFF metadata block was written; the only table dropped is the TTF `DSIG` signature, which the WOFF2 specification requires encoders to remove. Per the OFL FAQ (2.2.1) such a conversion is not a Modified Version, so families with Reserved Font Names keep their original names. Do not subset these files without renaming them.

Pretendard Variable comes directly from `orioncactus/pretendard` and is byte-identical to the existing sample font. Pretendard is an upstream Korean companion, not a Google Fonts family.

All faces are upright. Static families ship weight 400 only (Sunflower-class multi-weight statics were not included). Variable ranges are recorded in the manifest and CSS. Total WOFF2 payload: 17.4 MiB across 39 files; this folder is copied into every new project, so keep additions deliberate.
