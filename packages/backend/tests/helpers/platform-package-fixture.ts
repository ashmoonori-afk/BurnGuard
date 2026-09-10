import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const FIXTURE_ENTRYPOINT = "home.html";
export const OVER_BUDGET_IMAGE_BYTES = 200_000;

const SHARED_CSS = ':root{--brand:#123456}html{font-size:16px}body{margin:0;font-family:"Pretendard",system-ui}header[data-bg-shared]{display:flex}';
const PAGE_CSS = "@media (min-width:600px){.hero{padding:40px}}@keyframes fade{from{opacity:0}to{opacity:1}}.hero{color:var(--brand);animation:fade 1s}#cta{padding:8px}";

function page(title: string, current: string, main: string): string {
  const link = (href: string, label: string): string => `<a href="./${href}"${href === current ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="css/site.css">`
    + `<style>/* @bg-shared-css */${SHARED_CSS}/* @bg-page-css */${PAGE_CSS}</style></head><body>`
    + `<header data-bg-shared="header"><nav data-bg-shared="nav">${link("home.html", "홈")}${link("about.html", "소개")}</nav></header>`
    + `<main data-bg-content><!-- editorial note -->${main}</main>`
    + `<footer data-bg-shared="footer">© BurnGuard</footer>`
    + `<script src="js/app.js"></script><script src="js/jquery-3.7.1.min.js"></script></body></html>`;
}

/** Stages a two-page site whose closure covers CSS imports, srcset, fonts, scripts and a private document directory. */
export async function stagePlatformFixture(main = '<section class="hero" id="hero"><h1>안녕하세요</h1><img src="img/hero.png" srcset="img/hero.png 1x, img/hero@2x.png 2x" alt="대문 이미지"><p id="cta">지금 시작하기</p></section>'): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "bg-platform-fixture-"));
  for (const directory of ["css", "js", "img", "fonts", "docs/attachments"]) await mkdir(path.join(root, directory), { recursive: true });
  await writeFile(path.join(root, FIXTURE_ENTRYPOINT), page("홈", "home.html", main));
  await writeFile(path.join(root, "about.html"), page("소개", "about.html", '<section class="hero" id="about-hero"><h1>회사 소개</h1><p>우리는 만듭니다</p></section>'));
  await writeFile(path.join(root, "css", "site.css"), '@import "base.css";.hero{background:url(../img/bg.png) no-repeat}@font-face{font-family:"Pretendard";src:url(../fonts/Pretendard-Regular.woff2) format("woff2");font-display:swap}');
  await writeFile(path.join(root, "css", "base.css"), ".hero h1{letter-spacing:-0.02em}");
  await writeFile(path.join(root, "js", "app.js"), "document.addEventListener('DOMContentLoaded',()=>{});");
  await writeFile(path.join(root, "js", "jquery-3.7.1.min.js"), "/* vendored jquery stub */");
  await writeFile(path.join(root, "img", "hero.png"), Buffer.alloc(2048, 7));
  await writeFile(path.join(root, "img", "hero@2x.png"), Buffer.alloc(4096, 9));
  await writeFile(path.join(root, "img", "bg.png"), Buffer.alloc(OVER_BUDGET_IMAGE_BYTES, 3));
  await writeFile(path.join(root, "fonts", "Pretendard-Regular.woff2"), Buffer.alloc(1024, 1));
  await writeFile(path.join(root, "fonts", "OFL.txt"), "SIL Open Font License 1.1");
  await writeFile(path.join(root, "docs", "attachments", "private-brief.txt"), "internal only");
  return root;
}
