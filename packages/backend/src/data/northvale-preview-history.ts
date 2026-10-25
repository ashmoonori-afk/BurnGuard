/**
 * Exact SHA-256 bytes shipped under northvale-capital (LF and CRLF).
 * Previews: f686c6db through 7377236b. Tokens: f686c6db and f30807c8.
 * Do not normalize unknown installed bytes into a legacy match.
 */
export const NORTHVALE_PREVIEW_HISTORY = {
  "colors_and_type.css": [
    "cc0f71061a320f91adb0a0c3b1a32096e2b3fc6116406cb5d0e63704af4b3730",
    "f25f8bd119b4e3b94238e27f2094e9911e5b42c1b336381e0ab1a8580481969a",
    "b52e0b4cb6c6642c3d9d544f70d86a8cfada7d56467fd032d12ecc9727e5a219",
    "bda68a29e64f14fe63b9d33007a9bb4e8ad2daeacfd83d6b6d7f90818c97f0e0",
  ],
  "preview/colors-neutrals.html": [
    "4a8dd5313474797c2e791bf84fbe582a1aebb4aed080148a68cf89cc4256be1d",
    "7a99ba64f6dc0ac43c3db51cecd92d713d18d6fc019dacf66c9f5bc6ec5049be",
  ],
  "preview/colors-ramps.html": [
    "82c3c3eccc322a26975982a8b0a4b285d14c198319afda1b5d7096909d5ffdf8",
    "6ad491ffad30157a4dc138983bfb94cdc9aaf59f337e924c73e65099056b7574",
  ],
  "preview/colors-charts.html": [
    "b49a36a79ab0add15b8b9ed879f80256de9ea51b6678b93dedece06689b752a2",
    "6b99d85145f6c2b6ef5ffa37e795ec431ea91a51b60a7d3332d5879a974603ed",
  ],
  "preview/brand-icons.html": [
    "0ee49aafc1d84ecb8e5ce049da1b36aba7961c0fb7a3f59dc98c45faeea97e5f",
    "81484c1ef32fbd2faaa8a8e096b4a18b7a4530d22880eee4b37962ae8da288b8",
  ],
} as const satisfies Readonly<Record<string, readonly string[]>>;
