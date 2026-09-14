/**
 * ES module view of the liquid glass ring, for Node, bundlers and pages that are always served
 * over http.
 *
 * The implementation lives in `liquid-glass.js`, which is a classic script on purpose: a browser
 * blocks module imports over `file://`, so an exported artifact opened by double-clicking it would
 * render nothing. That file publishes the API on a global; this wrapper re-exports it by name so
 * `import { renderLiquidGlassRing } from "./liquid-glass.mjs"` keeps working. One implementation,
 * two entry points, no duplicated physics.
 */
import "./liquid-glass.js";

const api = globalThis.LiquidGlass;
if (!api) throw new Error("liquid_glass_not_loaded");

export const RING_OUTER = api.RING_OUTER;
export const SHADOW_OUTER = api.SHADOW_OUTER;
export const GLASS_COLOR = api.GLASS_COLOR;
export const lensProfile = api.lensProfile;
export const refractedRadius = api.refractedRadius;
export const renderLiquidGlassRing = api.renderLiquidGlassRing;
export default api;
