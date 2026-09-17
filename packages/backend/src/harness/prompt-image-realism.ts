/**
 * Product-owned realism contract for generated raster imagery. Emitted once per prompt through
 * DESIGN_CRAFT_RULES so every route, model and context mode shares one copy.
 */

/** Prompt words that mark generic generated art; image prompts must describe the scene instead. */
export const PHOTOREALISM_PROMPT_BLOCKLIST = [
  "abstract",
  "ultra-detailed",
  "8k",
  "trending",
  "masterpiece",
  "digital art",
  "concept art",
  "ethereal",
  "surreal",
  "dreamlike",
] as const;

export const IMAGE_REALISM_RULES = `Image realism contract:
- Default to photorealistic photography for every generated raster image: a concrete subject, a real setting and one visible moment that belongs to the section's content. Write each image prompt as a photographer's brief, never as a list of adjectives.
- Abstract imagery is prohibited unless the current request explicitly asks for it: no gradient blobs, glowing particles, floating geometric shapes, network lines, holograms, "digital" swirls, generic technology or space backdrops, ornamental 3D renders, and no decorative image whose only content is color, light or texture. When a section has no obvious subject, photograph a real object, place, product or person at work drawn from the brief instead of an abstraction.
- State what a camera would record: subject and action, environment and time of day, camera distance and lens (35 mm environmental, 50 mm, 85 mm portrait, macro), aperture and depth of field, light source with its direction and softness, real materials with ordinary wear, natural color and exposure, an off-center or candid composition where it fits, and a text-safe area for HTML copy.
- Avoid the signatures of generated art: perfect symmetry, a centered subject on an empty glowing backdrop, plastic or airbrushed skin, flawless surfaces, hypersaturated palettes, HDR halos, lens flare on everything, impossible reflections, floating or melting objects, garbled lettering, extra fingers or limbs, cloned faces and tiled textures. Do not write ${PHOTOREALISM_PROMPT_BLOCKLIST.map((term) => `"${term}"`).join(", ")} in an image prompt; describe the scene instead.
- A non-photographic treatment (illustration, painting, collage, clay, pixel, low-poly or a 3D object render) is allowed only when the saved image style selects it or the current request asks for it. Even then the image keeps a concrete subject and composition and never becomes abstract decoration.
- Inspect every generated image at its display size before accepting it. Reject and regenerate on any signature above, on unreadable or invented text, on an anatomy or reflection error, or when the image does not show the section's real subject. Report the inspection actually performed.`;
