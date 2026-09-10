import type { ExportFormat } from "./export";

export type PlatformGuidePlatform = "cafe24" | "imweb";
export type PlatformGuideStatus = "verified" | "unverified";

export type PlatformGuideStep = {
  readonly title: string;
  readonly body: string;
  /** Whether the vendor behavior this step relies on was confirmed on an official page (doc/14 section 13). */
  readonly status: PlatformGuideStatus;
  readonly source_ref?: number;
};

export type PlatformGuide = {
  readonly platform: PlatformGuidePlatform;
  readonly title: string;
  readonly summary: string;
  readonly prerequisites: readonly string[];
  readonly steps: readonly PlatformGuideStep[];
  readonly rollback: readonly string[];
  readonly unsupported: readonly string[];
  readonly verification_note: string;
  readonly checked_on: "2026-09-09";
};

const CAFE24_GUIDE: PlatformGuide = {
  platform: "cafe24",
  title: "카페24 스마트디자인 설치 가이드",
  summary: "이 패키지는 카페24 클래식 스마트디자인용 전용 레이아웃 1개, 화면 조각(pages/), 에셋(web/) 으로 구성됩니다. 쇼핑몰 관리자 화면에서 아래 순서대로 직접 올립니다.",
  prerequisites: [
    "쇼핑몰 스킨이 클래식 스마트디자인인지 확인합니다. 스마트디자인 Easy 는 HTML 편집 경로가 없어 지원하지 않습니다.",
    "관리자 > 디자인 > 파일업로더 또는 FTP 클라이언트 접근 권한이 필요합니다.",
  ],
  steps: [
    { title: "1. 에셋 업로드", body: "패키지의 web/<프로젝트 슬러그>/ 폴더를 파일업로더 또는 FTP로 그대로 올립니다. 페이지 조각의 에셋 경로는 내보내기 옵션 asset_base_url(기본 /web/upload/burnguard/<슬러그>/)을 기준으로 이미 바뀌어 있습니다. 파일업로더가 woff2 를 거부하면 FTP 클라이언트로 올리거나 시스템 폰트로 대체하세요.", status: "unverified", source_ref: 8 },
    { title: "2. 전용 레이아웃 만들기", body: "디자인 편집창 > HTML보기에서 새 레이아웃 파일 /layout/burnguard-layout.html 을 만들고 패키지의 layout/burnguard-layout.html 내용을 붙여넣어 저장합니다. 쇼핑몰의 기존 layout.html 은 수정하지 않습니다(수정하면 모든 화면에 반영됩니다).", status: "verified", source_ref: 1 },
    { title: "3. 화면 추가", body: "페이지마다 쇼핑몰 화면 추가를 실행한 뒤 HTML보기에 pages/<페이지>.html 내용을 붙여넣습니다. 첫 줄 <!--@layout(/layout/burnguard-layout.html)--> 은 자동 삽입된 layout.html 참조를 대체하므로 지우지 마세요. 레이아웃을 다른 경로로 저장했다면 첫 줄 경로를 그에 맞게 고칩니다.", status: "verified", source_ref: 2 },
    { title: "4. 메뉴 연결", body: "컨트롤 패널 > 메뉴 > URL 입력에서 새 화면 URL을 메뉴에 연결합니다. 새 화면의 URL 패턴은 스킨마다 다를 수 있으므로 lint.json 의 unresolved link 항목을 확인해 페이지 간 링크를 맞춥니다.", status: "unverified", source_ref: 10 },
    { title: "5. 미리보기와 저장", body: "편집창 미리보기로 데스크톱과 모바일을 확인한 뒤 저장합니다. 저장 이력에서 이전 버전으로 되돌릴 수 있습니다.", status: "verified", source_ref: 2 },
  ],
  rollback: [
    "추가한 화면을 삭제하고 /layout/burnguard-layout.html 을 삭제합니다.",
    "업로드한 web/<슬러그>/ 폴더를 삭제합니다.",
    "디자인 백업/복구는 HTML만 저장하며 이미지는 포함하지 않습니다.",
  ],
  unsupported: [
    "스마트디자인 Easy 스킨",
    "Admin API 를 통한 자동 업로드(승인된 클라이언트 전용)",
    "jQuery 동봉(스마트디자인에 이미 내장되어 충돌 위험)",
    "woff2 → woff 자동 변환",
  ],
  verification_note: "이 패키지는 공식 문서 기준으로만 검증되었습니다(documentation-tested). 실제 카페24 테스트 쇼핑몰 설치는 아직 확인되지 않았습니다.",
  checked_on: "2026-09-09",
};

const IMWEB_GUIDE: PlatformGuide = {
  platform: "imweb",
  title: "아임웹 코드 위젯 설치 가이드",
  summary: "이 패키지는 페이지별 코드 위젯 조각(pages/*.imweb.html)과 공통 코드(common/header-code.html, common/footer-code.html)로 구성됩니다. 사이트 내비게이션은 아임웹의 메뉴를 그대로 씁니다.",
  prerequisites: [
    "아임웹 사이트 관리자 권한과 코드 위젯을 쓸 수 있는 요금제가 필요합니다.",
    "큰 이미지는 아임웹 게시판에 첨부해 얻은 URL 로 호스팅해야 합니다(아임웹은 FTP 를 지원하지 않습니다).",
  ],
  steps: [
    { title: "1. 페이지(메뉴) 추가", body: "페이지마다 메뉴를 추가합니다. 준비 중에는 메뉴 숨김으로 상단 메뉴에서 감출 수 있습니다.", status: "verified", source_ref: 12 },
    { title: "2. 공통 코드 삽입", body: "설정 > SEO > 고급 설정 > 공통 코드 삽입에서 common/header-code.html 내용을 Header Code 에, common/footer-code.html 내용을 Footer Code 에 붙여넣습니다.", status: "verified", source_ref: 15 },
    { title: "3. 이미지 호스팅", body: "lint.json 에 imweb_image_needs_hosting 이 있으면 해당 이미지를 게시판 게시물에 첨부해 URL 을 복사한 뒤, 내보내기 옵션의 asset_base_url 에 입력하고 다시 내보냅니다. 작은 이미지는 이미 조각 안에 포함되어 있습니다.", status: "verified", source_ref: 16 },
    { title: "4. 코드 위젯 붙여넣기", body: "각 페이지에 코드 위젯을 추가하고 pages/<페이지>.imweb.html 내용을 붙여넣습니다. 디자인 모드에서는 빈 상자로 보이며 미리보기 모드에서만 렌더링됩니다. 한 위젯은 100만 자를 넘을 수 없고 HTML 주석은 저장 시 제거됩니다.", status: "verified", source_ref: 13 },
    { title: "5. 미리보기 후 게시", body: "미리보기에서 데스크톱과 모바일을 확인한 뒤 게시하기를 눌러야 변경이 반영됩니다.", status: "verified", source_ref: 12 },
    { title: "6. 폰트", body: "기본값은 시스템 폰트 폴백입니다. Google Fonts 링크를 쓰려면 내보내기 옵션에서 명시적으로 켜야 하며, 이 경우 외부 요청이 발생합니다. 아임웹은 폰트 파일 업로드를 지원하지 않는 것으로 알려져 있습니다.", status: "unverified", source_ref: 18 },
  ],
  rollback: [
    "추가한 코드 위젯을 삭제하고 게시하기를 다시 실행합니다.",
    "공통 코드 삽입에서 붙여넣은 Header/Footer Code 를 제거합니다.",
    "추가한 메뉴를 삭제합니다.",
  ],
  unsupported: [
    "커스텀 위젯(탭당 1만 자 제한)",
    "FTP 또는 파일 API 업로드",
    "Open API 스크립트 푸시",
    "폼과 iframe 동작 보장",
    "폰트 파일 업로드",
  ],
  verification_note: "이 패키지는 공식 문서 기준으로만 검증되었습니다(documentation-tested). 실제 아임웹 테스트 사이트 설치는 아직 확인되지 않았습니다.",
  checked_on: "2026-09-09",
};

export const PLATFORM_GUIDES: Readonly<Record<PlatformGuidePlatform, PlatformGuide>> = {
  cafe24: CAFE24_GUIDE,
  imweb: IMWEB_GUIDE,
};

export function platformGuideFor(format: ExportFormat): PlatformGuide | null {
  if (format === "cafe24_package") return PLATFORM_GUIDES.cafe24;
  if (format === "imweb_package") return PLATFORM_GUIDES.imweb;
  return null;
}
