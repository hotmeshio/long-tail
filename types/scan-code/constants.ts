/**
 * Scan-code constants: encodings, scheme kinds, verbs, outcomes, and the
 * template vocabulary.
 *
 * A scan code is a plain string from any input source (barcode scanner,
 * RFID reader, manual entry) encoding version:category:target. The scheme
 * (selected by the leading TWO digits, 10-99) declares which escalation
 * metadata facet the target resolves against and how the string parses.
 * The rule (selected by the single-digit category, 0-9) is an ordered list
 * of condition/action steps over the escalation surface plus a fallback.
 * Both indices are assigned automatically; operators name entries, not numbers.
 */

export const SCAN_ENCODINGS = {
  /** Digits only, fixed widths — fits UPC-A/EAN/ITF labels. */
  FIXED: 'fixed',
  /** Delimiter-separated text — Code 128 / QR / DataMatrix labels. */
  DELIMITED: 'delimited',
  /**
   * Manufacturer barcodes (UPC-A, EAN-13, EAN-8, GTIN-14). The code carries
   * no scheme or category; a valid check digit identifies it, the target is
   * the 14-digit GTIN, and the scheme's single rule is category '0'.
   */
  GTIN: 'gtin',
} as const;
export type ScanEncoding = (typeof SCAN_ENCODINGS)[keyof typeof SCAN_ENCODINGS];

/** The only rule category a GTIN scheme has: the code itself carries none. */
export const GTIN_CATEGORY = '0';

/** Code lengths a GTIN scheme reads: EAN-8, UPC-A, EAN-13, GTIN-14. */
export const GTIN_LENGTHS: readonly number[] = [8, 12, 13, 14];

export const SCAN_SCHEME_KINDS = {
  /** The ECA model: the target resolves against escalations; the rule's steps run. */
  ACTION: 'action',
  /**
   * A badge: the target resolves against users (target_facet names the
   * lt_users.metadata key it matches) and a match mints a short-lived
   * acting-identity grant. Identity schemes never walk steps.
   */
  IDENTITY: 'identity',
} as const;
export type ScanSchemeKind = (typeof SCAN_SCHEME_KINDS)[keyof typeof SCAN_SCHEME_KINDS];

/** How an identity scheme's grant is spent. */
export const SCAN_GRANT_SCOPES = {
  /** Each mutating act spends one use. */
  ACTION: 'action',
  /** The first act binds the grant to the held subject; acts on it then spend nothing. */
  SUBJECT: 'subject',
} as const;
export type ScanGrantScope = (typeof SCAN_GRANT_SCOPES)[keyof typeof SCAN_GRANT_SCOPES];

export const SCAN_VERBS = {
  SHOW_DETAIL: 'show-detail',
  SHOW_LIST: 'show-list',
  CLAIM: 'claim',
  CLAIM_SHOW_DETAIL: 'claim-show-detail',
  RELEASE: 'release',
  RESOLVE: 'resolve',
  ESCALATE: 'escalate',
  CANCEL: 'cancel',
  /**
   * Add to an accumulator escalation. Item mode (`containerFacet`): the scan
   * locates the item's own row and joins the container sharing that facet.
   * Subject mode (`from: 'subject'`): the held subject joins the scanned
   * container. Into-subject (`into: 'subject'`): the held subject collects
   * the scanned code. Otherwise the scan locates the container and adds
   * `params.itemKey`.
   */
  ACCUMULATE: 'accumulate',
  /** Locate the row, then PRESENT its reality + the step's labeled choices. */
  PRESENT: 'present',
  /**
   * Locate the row and HOLD it as the station's subject: the next scans act
   * on it. Writes nothing and spends no badge use.
   */
  HOLD: 'hold',
  /** Fill one open batch slot whose key is the scanned code. */
  FILL: 'fill',
} as const;
export type ScanVerb = (typeof SCAN_VERBS)[keyof typeof SCAN_VERBS];

/** Verbs that change escalation state (may carry a confirm prompt). */
export const SCAN_MUTATING_VERBS: readonly ScanVerb[] = [
  SCAN_VERBS.CLAIM,
  SCAN_VERBS.CLAIM_SHOW_DETAIL,
  SCAN_VERBS.RELEASE,
  SCAN_VERBS.RESOLVE,
  SCAN_VERBS.ESCALATE,
  SCAN_VERBS.CANCEL,
  SCAN_VERBS.ACCUMULATE,
  SCAN_VERBS.FILL,
];

export const SCAN_OUTCOMES = {
  /** A step matched and its action ran (or the located item is returned for show verbs). */
  EXECUTED: 'executed',
  /** A show-list step matched multiple escalations. */
  MATCHED_LIST: 'matched_list',
  /** A confirm step located its target; the client must confirm before the per-id action runs. */
  CONFIRM_REQUIRED: 'confirm_required',
  /** No step matched; render the rule's fallback screen. */
  NO_MATCH_FALLBACK: 'no_match_fallback',
  /** Unknown/disabled scheme version or category. */
  UNCONFIGURED: 'unconfigured',
  /** The code string did not parse under the scheme. */
  INVALID_CODE: 'invalid_code',
  /** The caller's roles do not permit the matched action. */
  FORBIDDEN: 'forbidden',
  /** A concurrent actor won the row (double scan). */
  CONFLICT: 'conflict',
  /** An identity scan matched a user; the response carries the acting grant. */
  IDENTITY_PRIMED: 'identity_primed',
  /** An identity scan matched no user; render the rule's fallback screen. */
  IDENTITY_UNKNOWN: 'identity_unknown',
  /**
   * The step/choice requires an acting identity the request cannot satisfy
   * (no grant, a dead grant, or a write-incapable principal); render the
   * rule's notPrimed screen. Distinct from FORBIDDEN — the acting user's own
   * RBAC was never consulted.
   */
  NOT_PRIMED: 'not_primed',
  /** A PRESENT step located its row; the response carries reality + choices. */
  CHOICES: 'choices',
  /**
   * An accumulate step in item mode located the item's row, but no pending
   * container carries its facet: the previous container closed and its
   * successor has not parked yet. The response carries the item row and the
   * facet so the station can say "container closing, scan again".
   */
  NO_OPEN_CONTAINER: 'no_open_container',
  /** A HOLD step located its row; the response carries the subject to hold. */
  HELD: 'held',
  /**
   * The scan was understood and deliberately not acted on: the wrong
   * container, an item the record does not expect, a row someone else holds.
   * Nothing was written; the response carries the words to show.
   */
  REFUSED: 'refused',
  /** The held subject moved on (resolved, re-parked, unreadable); scan the item again. */
  SUBJECT_STALE: 'subject_stale',
} as const;
export type ScanOutcome = (typeof SCAN_OUTCOMES)[keyof typeof SCAN_OUTCOMES];

export const SCAN_AVAILABILITY = {
  AVAILABLE: 'available',
  CLAIMED: 'claimed',
  MINE: 'mine',
  ANY: 'any',
} as const;
export type ScanAvailability = (typeof SCAN_AVAILABILITY)[keyof typeof SCAN_AVAILABILITY];

export const SCAN_CARDINALITY = {
  FIRST: 'first',
  MANY: 'many',
} as const;
export type ScanCardinality = (typeof SCAN_CARDINALITY)[keyof typeof SCAN_CARDINALITY];

/** Metadata keys stamped onto escalations touched by a scan (provenance). */
export const SCAN_PROVENANCE_KEYS = {
  SCHEME: 'scanScheme',
  CATEGORY: 'scanCategory',
  ACTION_NAME: 'scanActionName',
  SCANNED_AT: 'scannedAt',
  /** The authenticated device principal when a mutation ran under an acting identity. */
  STATION: 'scanStation',
} as const;

/** The ephemeral-keystore label acting-identity grants are minted under. */
export const ACTING_IDENTITY_LABEL = 'acting_identity';

/**
 * Template tokens usable inside step params (item key, resolver payload,
 * metadata, refusal copy). `{scan.code}` is the raw code as scanned.
 */
export const SCAN_TEMPLATE_TOKENS = {
  TARGET: '{scan.target}',
  CATEGORY: '{scan.category}',
  SCANNED_AT: '{scan.scannedAt}',
  CODE: '{scan.code}',
} as const;

/**
 * Facet-bag token prefixes. `{claim.x}` reads the actor's single live claim,
 * `{item.x}` the row the step located, `{subject.x}` the held subject row,
 * `{container.x}` the container a subject step located, and `{fill.x}` the
 * batch a fill step read. A token that cannot resolve fails the step instead
 * of writing the literal.
 */
export const SCAN_TEMPLATE_BAGS = {
  CLAIM: 'claim',
  ITEM: 'item',
  SUBJECT: 'subject',
  CONTAINER: 'container',
  FILL: 'fill',
} as const;
export type ScanTemplateBag = (typeof SCAN_TEMPLATE_BAGS)[keyof typeof SCAN_TEMPLATE_BAGS];

/** Default seconds a held subject lives on the station. */
export const SCAN_HOLD_TTL_DEFAULT_SECONDS = 45;
export const SCAN_HOLD_TTL_MIN_SECONDS = 5;
export const SCAN_HOLD_TTL_MAX_SECONDS = 600;

/** Separator between a code and its ordinal in batch keys (`<gtin>#2`). */
export const SCAN_FILL_SEPARATOR_DEFAULT = '#';
