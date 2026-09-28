import type { FigmaImportNodeSummary } from "@bg/shared/figma-import";

export type FigmaRectangle = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type FigmaImportPaint = {
  readonly type: string;
  readonly color?: {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a?: number;
  };
  readonly visible?: boolean;
};

export type FigmaImportTypography = {
  readonly fontFamily?: string;
  readonly fontWeight?: number;
  readonly fontSize?: number;
  readonly lineHeightPx?: number;
  readonly letterSpacing?: number;
  readonly textCase?: string;
  readonly textDecoration?: string;
};

export type FigmaImportNode = {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly children: readonly FigmaImportNode[];
  readonly characters?: string;
  readonly absoluteBoundingBox?: FigmaRectangle;
  readonly fills: readonly FigmaImportPaint[];
  readonly style: FigmaImportTypography | null;
  readonly styles: Readonly<Record<string, string>>;
  readonly boundVariableIds: Readonly<Record<string, readonly string[]>>;
  readonly layoutMode?: string;
  readonly primaryAxisAlignItems?: string;
  readonly counterAxisAlignItems?: string;
  readonly primaryAxisSizingMode?: string;
  readonly counterAxisSizingMode?: string;
  readonly itemSpacing?: number;
  readonly counterAxisSpacing?: number;
  readonly paddingTop?: number;
  readonly paddingRight?: number;
  readonly paddingBottom?: number;
  readonly paddingLeft?: number;
  readonly cornerRadius?: number;
};

export type FigmaIdentityCatalog = Readonly<Record<string, {
  readonly name: string;
  readonly kind?: string;
}>>;

export type FigmaImportDocument = {
  readonly name: string;
  readonly version: string;
  readonly last_modified: string;
  readonly document: FigmaImportNode;
  readonly styles: FigmaIdentityCatalog;
  readonly variables: FigmaIdentityCatalog;
};

export type FigmaImportableNode = FigmaImportNodeSummary;
