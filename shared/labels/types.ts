// Label sheet model. Pure data in millimetres: the dashboard preview, browser
// print, PDF and ZPL all render the same LabelSheet.

export const LABEL_SYMBOLOGIES = ['code128', 'qrcode', 'datamatrix'] as const;
export type LabelSymbology = (typeof LABEL_SYMBOLOGIES)[number];

/** How a code's caption band prints on black-only stock: filled, outlined, or bare text. */
export const LABEL_TONES = ['solid', 'outline', 'plain'] as const;
export type LabelTone = (typeof LABEL_TONES)[number];

/** A sheet of labels (office printer) or a thermal roll (one label per page). */
export interface LabelMedia {
  id: string;
  name: string;
  family: 'sheet' | 'thermal';
  pageWidthMm: number;
  pageHeightMm: number;
  columns: number;
  rows: number;
  labelWidthMm: number;
  labelHeightMm: number;
  marginTopMm: number;
  marginLeftMm: number;
  gutterXMm: number;
  gutterYMm: number;
  cornerRadiusMm: number;
  /** Thermal print resolution in dots per inch. */
  dpi?: number;
  /** The narrowest bar or module a scanner reads reliably from this stock. */
  minModuleMm: number;
}

/** One code on a label: the payload, the act it names, and its band tone. */
export interface LabelCode {
  code: string;
  caption: string;
  tone: LabelTone;
}

/** What one label says, before layout. A masked label draws placeholders instead of codes. */
export interface LabelContent {
  title?: string;
  lines: string[];
  codes: LabelCode[];
  masked?: boolean;
}

export interface LabelTextElement {
  kind: 'text';
  x: number;
  y: number;
  w: number;
  /** Font size in millimetres (the em box). */
  size: number;
  text: string;
  weight: 'regular' | 'bold';
  align: 'left' | 'center';
  /** White text, printed over a solid band. */
  inverse?: boolean;
}

export interface LabelRectElement {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Filled black when true; outlined with `stroke` mm otherwise. */
  fill: boolean;
  stroke?: number;
}

export interface LabelSymbolElement {
  kind: 'symbol';
  x: number;
  y: number;
  w: number;
  h: number;
  symbology: LabelSymbology;
  /** The encoded payload; empty when masked. */
  data: string;
  moduleMm: number;
  /** Dark modules as an SVG path in module units; empty when masked. */
  path: string;
  masked?: boolean;
}

export type LabelElement = LabelTextElement | LabelRectElement | LabelSymbolElement;

export interface PlacedLabel {
  /** Position on the page, counted from 0, left to right then top to bottom. */
  slot: number;
  /** Index of the label in the job's input. */
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  elements: LabelElement[];
}

export interface LabelPage {
  labels: PlacedLabel[];
}

export const LABEL_WARNING_KINDS = [
  'scale', 'quiet_zone', 'unencodable', 'unparseable', 'rule_disabled', 'unresolved', 'overflow', 'missing_token',
] as const;
export type LabelWarningKind = (typeof LABEL_WARNING_KINDS)[number];

export interface LabelWarning {
  /** Index of the label in the job's input. */
  index: number;
  kind: LabelWarningKind;
  detail: string;
}

export interface LabelSheet {
  media: LabelMedia;
  pages: LabelPage[];
  cutMarks: boolean;
  warnings: LabelWarning[];
}
