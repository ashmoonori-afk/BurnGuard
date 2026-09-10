import type { GraphicSetKind } from "./graphic";

export type PlatformPreset = {
  readonly id: string;
  readonly kind: GraphicSetKind;
  readonly placement: string;
  readonly width: number;
  readonly height: number;
  readonly confidence: "verified" | "unverified";
  readonly verified_on: "2026-09-09";
  readonly source_ref: number;
  readonly rule_source: "platform" | "burnguard_default";
  readonly limits: {
    readonly max_frames?: number;
    readonly max_bytes?: number;
  };
  readonly safe_zone?: {
    readonly top: number;
    readonly bottom: number;
    readonly left?: number;
    readonly right?: number;
  };
};

const verifiedOn = "2026-09-09" as const;

export const PLATFORM_PRESETS = [
  { id: "instagram-feed-square", kind: "card_news", placement: "Instagram feed 1:1", width: 1080, height: 1080, confidence: "verified", verified_on: verifiedOn, source_ref: 24, rule_source: "platform", limits: { max_frames: 20, max_bytes: 30_000_000 } },
  { id: "instagram-feed-portrait", kind: "card_news", placement: "Instagram feed 4:5", width: 1080, height: 1350, confidence: "verified", verified_on: verifiedOn, source_ref: 24, rule_source: "platform", limits: { max_frames: 20, max_bytes: 30_000_000 } },
  { id: "instagram-feed-three-four", kind: "card_news", placement: "Instagram feed 3:4", width: 1080, height: 1440, confidence: "unverified", verified_on: verifiedOn, source_ref: 23, rule_source: "burnguard_default", limits: { max_frames: 20 } },
  { id: "facebook-feed-carousel", kind: "card_news", placement: "Facebook feed carousel", width: 1080, height: 1080, confidence: "verified", verified_on: verifiedOn, source_ref: 25, rule_source: "platform", limits: { max_frames: 10, max_bytes: 30_000_000 } },
  { id: "facebook-stories-carousel", kind: "card_news", placement: "Facebook Stories carousel", width: 1080, height: 1920, confidence: "verified", verified_on: verifiedOn, source_ref: 26, rule_source: "platform", limits: {}, safe_zone: { top: 250, bottom: 250 } },
  { id: "kakao-channel-card-square", kind: "card_news", placement: "KakaoTalk Channel card view 1:1", width: 720, height: 720, confidence: "unverified", verified_on: verifiedOn, source_ref: 29, rule_source: "platform", limits: { max_frames: 40, max_bytes: 20_000_000 } },
  { id: "kakao-channel-card-portrait", kind: "card_news", placement: "KakaoTalk Channel card view 3:4", width: 720, height: 960, confidence: "unverified", verified_on: verifiedOn, source_ref: 29, rule_source: "platform", limits: { max_frames: 40, max_bytes: 20_000_000 } },
  { id: "smartstore-product-detail", kind: "product_detail", placement: "Naver Smart Store product detail", width: 860, height: 16_000, confidence: "unverified", verified_on: verifiedOn, source_ref: 33, rule_source: "platform", limits: { max_bytes: 20_000_000 } },
  { id: "coupang-product-detail", kind: "product_detail", placement: "Coupang product detail", width: 780, height: 16_000, confidence: "unverified", verified_on: verifiedOn, source_ref: 34, rule_source: "platform", limits: { max_frames: 20, max_bytes: 5_000_000 } },
  { id: "meta-square", kind: "banner_set", placement: "Meta square", width: 1080, height: 1080, confidence: "verified", verified_on: verifiedOn, source_ref: 24, rule_source: "platform", limits: { max_bytes: 30_000_000 } },
  { id: "meta-feed-portrait", kind: "banner_set", placement: "Meta feed 4:5", width: 1080, height: 1350, confidence: "verified", verified_on: verifiedOn, source_ref: 24, rule_source: "platform", limits: { max_bytes: 30_000_000 } },
  { id: "meta-story", kind: "banner_set", placement: "Meta Stories 9:16", width: 1080, height: 1920, confidence: "verified", verified_on: verifiedOn, source_ref: 26, rule_source: "platform", limits: {}, safe_zone: { top: 250, bottom: 250 } },
  { id: "naver-gfa-mobile-da", kind: "banner_set", placement: "Naver GFA mobile DA", width: 1250, height: 560, confidence: "unverified", verified_on: verifiedOn, source_ref: 37, rule_source: "platform", limits: {} },
  { id: "naver-gfa-native-wide", kind: "banner_set", placement: "Naver GFA native 16:9", width: 1200, height: 628, confidence: "unverified", verified_on: verifiedOn, source_ref: 37, rule_source: "platform", limits: {} },
  { id: "naver-gfa-native-square", kind: "banner_set", placement: "Naver GFA native 1:1", width: 1200, height: 1200, confidence: "unverified", verified_on: verifiedOn, source_ref: 37, rule_source: "platform", limits: {} },
  { id: "naver-gfa-native-thumbnail", kind: "banner_set", placement: "Naver GFA native thumbnail", width: 342, height: 228, confidence: "unverified", verified_on: verifiedOn, source_ref: 37, rule_source: "platform", limits: {} },
  { id: "naver-gfa-image-feed", kind: "banner_set", placement: "Naver GFA image feed", width: 1200, height: 680, confidence: "unverified", verified_on: verifiedOn, source_ref: 37, rule_source: "platform", limits: {} },
  { id: "naver-gfa-smart-channel", kind: "banner_set", placement: "Naver GFA smart channel", width: 750, height: 160, confidence: "unverified", verified_on: verifiedOn, source_ref: 37, rule_source: "platform", limits: {} },
  { id: "naver-gfa-smart-channel-tall", kind: "banner_set", placement: "Naver GFA smart channel tall", width: 750, height: 200, confidence: "unverified", verified_on: verifiedOn, source_ref: 37, rule_source: "platform", limits: {} },
  { id: "naver-gfa-special-da", kind: "banner_set", placement: "Naver GFA special DA", width: 750, height: 280, confidence: "unverified", verified_on: verifiedOn, source_ref: 37, rule_source: "platform", limits: {} },
  { id: "naver-gfa-collection", kind: "banner_set", placement: "Naver GFA collection", width: 600, height: 600, confidence: "unverified", verified_on: verifiedOn, source_ref: 37, rule_source: "platform", limits: {} },
  { id: "naver-gfa-comment", kind: "banner_set", placement: "Naver GFA comment", width: 112, height: 112, confidence: "unverified", verified_on: verifiedOn, source_ref: 37, rule_source: "platform", limits: {} },
  { id: "naver-gfa-mobile-da-legacy", kind: "banner_set", placement: "Naver GFA legacy mobile DA", width: 1250, height: 370, confidence: "unverified", verified_on: verifiedOn, source_ref: 37, rule_source: "platform", limits: {} },
  { id: "kakao-bizboard", kind: "banner_set", placement: "Kakao Bizboard", width: 1029, height: 258, confidence: "unverified", verified_on: verifiedOn, source_ref: 38, rule_source: "platform", limits: { max_bytes: 300_000 } },
  { id: "google-display-medium-rectangle", kind: "banner_set", placement: "Google display medium rectangle", width: 300, height: 250, confidence: "unverified", verified_on: verifiedOn, source_ref: 39, rule_source: "platform", limits: { max_bytes: 150_000 } },
  { id: "youtube-thumbnail", kind: "thumbnail", placement: "YouTube thumbnail 16:9", width: 1280, height: 720, confidence: "unverified", verified_on: verifiedOn, source_ref: 40, rule_source: "burnguard_default", limits: { max_bytes: 50_000_000 } },
  { id: "marketplace-thumbnail", kind: "thumbnail", placement: "Marketplace thumbnail", width: 1000, height: 1000, confidence: "unverified", verified_on: verifiedOn, source_ref: 35, rule_source: "burnguard_default", limits: {} },
  { id: "business-card-working-area", kind: "print", placement: "Business card working area at 300 dpi", width: 1110, height: 626, confidence: "unverified", verified_on: verifiedOn, source_ref: 41, rule_source: "platform", limits: {} },
] as const satisfies readonly PlatformPreset[];
