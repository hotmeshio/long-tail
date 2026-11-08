import type { LabelMedia } from '../../shared/labels/types';
import type { LabelSource } from './source';
import type { LabelTemplate } from './template';

export type LabelJobAction = 'print' | 'reissue' | 'bind';

/** How issued labels leave the server. */
export type LabelOutput = 'sheet' | 'pdf' | 'zpl' | `transport:${string}`;

/** A row of lt_label_jobs: who asked for which labels, never the identity codes. */
export interface LabelJob {
  id: string;
  action: LabelJobAction;
  requested_by: string | null;
  idempotency_key: string | null;
  template_name: string | null;
  template_revision: number | null;
  template_snapshot: LabelTemplate | null;
  scheme_version: number | null;
  scheme_kind: string | null;
  sensitive: boolean;
  source: LabelSource | Record<string, unknown>;
  subject_user_ids: string[] | null;
  targets: string[] | null;
  label_count: number;
  media: LabelMedia | null;
  output: string | null;
  /** When a transport accepted the job; null until then, and for pull outputs. */
  delivered_at?: Date | null;
  created_at: Date;
}

/** Layout choices for one job. */
export interface LabelLayoutRequest {
  /** A preset id or a custom grid; defaults to the template's media, then the deployment default. */
  media?: string | LabelMedia;
  startPosition?: number;
  copies?: number;
  onePerPage?: boolean;
  cutMarks?: boolean;
}

export interface LabelIssueRequest {
  template: string;
  source: LabelSource;
  layout?: LabelLayoutRequest;
  output: LabelOutput;
  /** Required for a sensitive template: the caller saw the confirmation. */
  confirm?: boolean;
  /** A repeat with the same key returns the first job instead of printing again. */
  idempotencyKey?: string;
  /** Where the transport sends the job; its meaning belongs to the transport (a printer, a queue, a route). */
  destination?: string;
  /** Print only these of the source's targets (action) or user ids (identity). */
  only?: string[];
}
