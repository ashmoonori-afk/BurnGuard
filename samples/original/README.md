# Original sample collection

Four fictional brands, twelve finished examples, and four matching design systems were authored for BurnGuard. Each brand includes a responsive web design, a six-slide presentation, and a 1080×1350 graphic. Brands, copy, and pictured objects are invented sample content, not offers from operating businesses.

| Brand | Direction | Content |
|---|---|---|
| SONNEL | Precision sound-synthesis lab | A cobalt sound instrument, silver controls, ice grey and navy |
| FOLIOVER | Material-culture editorial | A journal of overlooked objects, warm paper, forest and chartreuse |
| ODDWARD | Experimental studio | Chrome sculpture, emphatic typography, black, lime and magenta |
| VELUNE | Nocturnal lighting atelier | A moonlit mint/opal luminaire, deep plum, orchid and serif typography |

`assets/hero.png` in each brand folder is a newly generated 1536×1024 image. The seed process copies that shared asset into each project and design-system directory. HTML references `assets/hero.png`; relative links work inside the resulting self-contained app projects and exports. Decks inline BurnGuard's existing deck runtime. No reference-site images or text are bundled.

Broad references, reviewed September 9, 2026: [teenage engineering](https://teenage.engineering/) for product-led industrial hierarchy; [COOL HUNTING](https://coolhunting.com/) for editorial curation; [Heretic](https://www.heretic.wtf/) for expressive scale and studio storytelling; [Luxury Clone](https://luxurycloneaustralia.com/) for collection-led presentation. The sample concepts and visual compositions were developed independently.

Generated image directions:

- SONNEL: an invented cobalt-blue triangular sound instrument with a precision silver dial, photographed in an icy architectural studio with hard daylight and cold stone.
- FOLIOVER: a translucent amber resin ribbon, moss-coloured paper block, cobalt ceramic sphere, handmade paper and architectural shadows.
- ODDWARD: an oversized inflated chrome knot on a lime plinth, with a magenta panel in a black gallery space.
- VELUNE: an invented mint/opal glass crescent luminaire on a deep-plum stone base, in a nocturnal plum gallery with moonlight and cool lavender reflections.

All four images were generated using the built-in ImageGen tool; no reference images were supplied. The wording, token systems and layouts are authored specifically for these samples. New examples are seeded once and remain deleted if the user removes them; an update does not overwrite edited copies.

## Typography
The samples use locally bundled free fonts: Space Grotesk and IBM Plex Mono for SONNEL; DM Serif Display and Gowun Batang for FOLIOVER and VELUNE; Bebas Neue for ODDWARD; Pretendard for Korean body text, with DM Sans for VELUNE English body text. Each HTML loads fonts/fonts.css. The seeder copies the shared fonts directory into every project and system, keeping exports self-contained. Retain font licenses and provenance from fonts/README.md when distributing generated work. No Google Fonts network request is required at runtime.
