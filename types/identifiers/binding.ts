/** How a binding was made: through the API, a scan step, or a workflow. */
export type BoundVia = 'api' | 'scan' | 'workflow';

/** A scheme's binding settings (lt_config_scan_schemes.identifier). */
export interface SchemeIdentifier {
  /** Roles that may bind and retire this scheme's values, besides role managers. */
  binders?: string[];
  /** A target holds one live value: binding a new one retires the old. Off: a target may hold many. */
  exclusiveTarget?: boolean;
}

/** One pairing of a scanned value with the thing it stands for, live until retired. */
export interface IdentifierBinding {
  id: string;
  scheme_version: number;
  raw: string;
  target: string;
  exclusive: boolean;
  bound_by: string | null;
  bound_via: BoundVia;
  bound_at: string;
  retired_at: string | null;
  retired_by: string | null;
}

export interface BindingQuery {
  target?: string;
  raw?: string;
  /** Retired rows too, newest first. */
  includeRetired?: boolean;
  limit?: number;
  offset?: number;
}
