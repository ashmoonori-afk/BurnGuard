/**
 * Content-Security-Policy applied to every artifact document BurnGuard renders
 * from project or design-system files: the canvas `srcdoc` (as a `<meta>`),
 * and the raw file routes when a browser frames them (as a header).
 *
 * The artifact keeps scripts and inline styles because generated prototypes
 * rely on them, but it can only talk to the BurnGuard origin: no outbound
 * fetch/XHR/beacon, no form submission, no nested frames or plugins. Google
 * Fonts stays reachable because generated artifacts commonly link it and the
 * export renderer already treats every other remote resource as a failure.
 */
export const GOOGLE_FONTS_STYLE_HOST = "https://fonts.googleapis.com";
export const GOOGLE_FONTS_FILE_HOST = "https://fonts.gstatic.com";

export function artifactContentSecurityPolicy(origin: string): string {
  return [
    `default-src ${origin} data: blob:`,
    `script-src ${origin} 'unsafe-inline' 'unsafe-eval' blob:`,
    `style-src ${origin} 'unsafe-inline' ${GOOGLE_FONTS_STYLE_HOST}`,
    `font-src ${origin} data: ${GOOGLE_FONTS_FILE_HOST}`,
    `img-src ${origin} data: blob:`,
    `media-src ${origin} data: blob:`,
    `connect-src ${origin}`,
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    `base-uri ${origin}`,
  ].join("; ");
}

/** Application shell responses: the SPA must never be embedded by another page. */
export const APP_SHELL_SECURITY_HEADERS = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
} as const;
