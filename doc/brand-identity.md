# BurnGuard identity

BurnGuard is a local AI design workspace: describe an idea, refine it on canvas, and take the files with you.

![BurnGuard mark](images/burnguard-mark.png)

The mark combines two folded canvas planes into a compact **B**. Its open center echoes a working canvas; the lower plane provides a stable frame. Keep the BurnGuard name and existing navy, cobalt, and off-white visual direction.

| Role | Color | Use |
|---|---|---|
| Navy | `#17233B` | Brand framing and wordmark |
| Cobalt | `#2454E0` | Main action and creative emphasis; matches the workspace accent token |
| Off-white | `#F6F8FA` | Workspace background |
| White | `#FFFFFF` | Mark backing and content surfaces |

Use the existing application sans-serif stack for the live **BurnGuard** wordmark, with semibold weight and normal tracking. Keep text separate from the raster mark so it stays sharp and accessible. No additional font dependency is required.

Use `packages/frontend/public/brand/burnguard-mark.png` in the app and `doc/images/burnguard-mark.png` in documentation. These are identical opaque PNGs with white backing, not transparent assets. Display the full square with `object-fit: contain` on a white rounded badge, including in dark mode. Prefer at least 32 px for the app mark; the browser favicon is a compact exception. Do not stretch, recolor, crop, add shadows inside the image, or use the mark as a replacement for functional toolbar icons. Pair it with the name wherever space permits. When adjacent text already names BurnGuard, the image can have empty alternative text.

The existing README cover remains the expressive illustration; this mark provides the compact product identity.

## Generation provenance

Created on 2026-09-09 with the built-in OpenAI image generation tool using the `imagegen` skill. Prompt direction: a compact abstract B made of two folded canvas planes, navy and cobalt, no vendor marks or wordmark. One generation and one background correction were used. The first result contained a rendered transparency checkerboard; the selected correction replaces it with white. The selected image was visually inspected for its silhouette, internal opening, clean background, and absence of extra text. The generated raster contains slight tonal variation; palette values above specify UI colors rather than exact pixel colors. No SVG tracing, manual raster editing, or vector master is included.
