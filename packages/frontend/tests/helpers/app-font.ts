export function appFontResponse(pathname: string): Response | null {
  if (pathname !== "/assets/fonts/PretendardVariable.woff2") return null;
  return new Response(Bun.file(new URL("../../../../assets/fonts/PretendardVariable.woff2", import.meta.url)), {
    headers: { "content-type": "font/woff2" },
  });
}
