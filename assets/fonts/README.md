# Bundled fonts

Load `fonts.css` for all seven families. The manifest records each original font URL and its accompanying SIL Open Font License 1.1 file, including copyright notices. Keep those license files with redistributed fonts.

The six Google Fonts files were downloaded from the official `google/fonts` repository on 2026-09-09 and losslessly packaged as WOFF2 using the already installed fontTools and Node Brotli support. No glyph subsetting was performed. Gowun Batang includes every modern Hangul syllable (U+AC00–U+D7A3).

Pretendard Variable comes directly from `orioncactus/pretendard` and is byte-identical to the existing sample font. It also includes every modern Hangul syllable. Pretendard is an upstream Korean companion, not a Google Fonts family.

All faces are upright; static display, serif and mono faces provide weight 400. Variable ranges are recorded in the manifest and CSS.
