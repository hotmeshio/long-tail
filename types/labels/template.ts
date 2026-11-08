import type { LabelSymbology, LabelTone } from '../../shared/labels/types';

/** One code a template prints: a rule of its scheme, with the caption beside it. */
export interface LabelTemplateCode {
  category: string;
  /** The act the code names; defaults to the rule's name. */
  caption?: string | null;
  tone: LabelTone;
}

/** The text a template prints, in label tokens ({target}, {item.<facet>}, {user.<key>}). */
export interface LabelTemplateText {
  title?: string;
  lines?: string[];
}

/** What one printed label shows for a scan scheme. */
export interface LabelTemplate {
  name: string;
  scheme_version: number;
  title: string;
  description: string | null;
  codes: LabelTemplateCode[];
  text: LabelTemplateText;
  symbology: LabelSymbology;
  human_readable: boolean;
  /** The default media preset id. */
  media: string | null;
  /** Printing asks for confirmation and records who it names. Always true on an identity scheme. */
  sensitive: boolean;
  enabled: boolean;
  revision: number;
  source: 'code' | 'api';
  created_at?: Date;
  updated_at?: Date;
}

export interface LabelTemplateInput {
  name: string;
  scheme_version: number;
  title: string;
  description?: string | null;
  codes: LabelTemplateCode[];
  text?: LabelTemplateText;
  symbology?: LabelSymbology;
  human_readable?: boolean;
  media?: string | null;
  sensitive?: boolean;
  enabled?: boolean;
}
