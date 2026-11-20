/**
 * x-lt-confidence: review state for a form a model filled in. The workflow
 * proposes values (`envelope.formDefaults`) and scores them
 * (`envelope.confidence`, the same shape, numbers in [0, 1]); the schema root
 * declares the tranches a score falls into:
 *
 *   "x-lt-confidence": {
 *     "tranches": [
 *       { "below": 0.6, "label": "Low",   "tone": "error" },
 *       { "below": 0.9, "label": "Check", "tone": "warning" }
 *     ]
 *   }
 *
 * A score falls into the first tranche whose `below` it is under; a score at
 * or above every threshold is confident and carries no tranche. Every field
 * with a proposal also reports whether the answer differs from it, so the
 * form shows what a value was and what it became, before and after submit.
 * `scores` and `proposed` name other context paths when the workflow keeps
 * them elsewhere. `"facets": true` stamps a review summary onto the row's
 * metadata when it resolves (see x-lt-confidence-facets). A field opts out
 * with `"x-lt-confidence": false`. Pure: the dashboard renders with it, and
 * workflows and agents can diff with it.
 */
import { resolveCtxPath } from './ctx-path';
import { isDisplayOnlyField } from './display-only-widgets';
import { mapPayloadToForm } from './x-lt-bind';
import { comparable } from './answer-compare';
import { diffList, type ListDiff } from './x-lt-list-diff';
import { isListSchema, itemSchemaOf } from './x-lt-list';

export const CONFIDENCE_TONES = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
} as const;

export type ConfidenceTone = (typeof CONFIDENCE_TONES)[keyof typeof CONFIDENCE_TONES];

export interface ConfidenceTranche {
  below: number;
  label: string;
  tone: ConfidenceTone;
}

export interface ConfidenceSpec {
  scores: string;
  proposed: string;
  tranches: ConfidenceTranche[];
  /** Stamp the review summary onto the row's metadata at resolve. */
  facets: boolean;
}

export const CONFIDENCE_SCORES_PATH = 'envelope.confidence';
export const CONFIDENCE_PROPOSED_PATH = 'envelope.formDefaults';

export const DEFAULT_CONFIDENCE_TRANCHES: readonly ConfidenceTranche[] = [
  { below: 0.6, label: 'Low', tone: CONFIDENCE_TONES.ERROR },
  { below: 0.85, label: 'Check', tone: CONFIDENCE_TONES.WARNING },
];

const TONES: ReadonlySet<string> = new Set(Object.values(CONFIDENCE_TONES));

function readTranches(raw: unknown): ConfidenceTranche[] {
  if (!Array.isArray(raw)) return [...DEFAULT_CONFIDENCE_TRANCHES];
  const byThreshold = new Map<number, ConfidenceTranche>();
  for (const entry of raw) {
    const t = (entry ?? {}) as Record<string, unknown>;
    if (typeof t.below !== 'number' || !Number.isFinite(t.below) || t.below <= 0 || t.below > 1) continue;
    if (typeof t.label !== 'string' || t.label.trim().length === 0) continue;
    const tone = typeof t.tone === 'string' && TONES.has(t.tone) ? t.tone as ConfidenceTone : CONFIDENCE_TONES.WARNING;
    if (!byThreshold.has(t.below)) byThreshold.set(t.below, { below: t.below, label: t.label.trim(), tone });
  }
  return [...byThreshold.values()].sort((a, b) => a.below - b.below);
}

/** The schema's confidence declaration, or null when the form declares none. */
export function readConfidenceSpec(schema: Record<string, unknown> | null | undefined): ConfidenceSpec | null {
  const raw = schema?.['x-lt-confidence'];
  if (raw === true) {
    return {
      scores: CONFIDENCE_SCORES_PATH,
      proposed: CONFIDENCE_PROPOSED_PATH,
      tranches: [...DEFAULT_CONFIDENCE_TRANCHES],
      facets: false,
    };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const spec = raw as Record<string, unknown>;
  return {
    scores: typeof spec.scores === 'string' && spec.scores ? spec.scores : CONFIDENCE_SCORES_PATH,
    proposed: typeof spec.proposed === 'string' && spec.proposed ? spec.proposed : CONFIDENCE_PROPOSED_PATH,
    tranches: readTranches(spec.tranches),
    facets: spec.facets === true,
  };
}

/** The tranche a score falls into, or null when the score clears every threshold. */
export function trancheFor(tranches: readonly ConfidenceTranche[], score: number): ConfidenceTranche | null {
  for (const tranche of tranches) {
    if (score < tranche.below) return tranche;
  }
  return null;
}

export { comparable as comparableAnswer } from './answer-compare';

/**
 * Whether an answer differs from what was proposed for it. Given the field's
 * schema, a list compares item by item (keyed or unordered when declared).
 */
export function differsFromProposal(
  proposed: unknown,
  current: unknown,
  fieldSchema?: Record<string, unknown> | null,
): boolean {
  if (fieldSchema && isListSchema(fieldSchema) && (Array.isArray(proposed) || Array.isArray(current))) {
    return diffList(proposed, current, fieldSchema).changed;
  }
  return comparable(proposed) !== comparable(current);
}

export interface FieldReview {
  /** The field's score in [0, 1], when the workflow scored it. */
  score?: number;
  /** The tranche the score falls into; absent when confident or unscored. */
  tranche?: ConfidenceTranche;
  /** Whether the workflow proposed a value for the field. */
  hasProposal: boolean;
  /** The proposed value, in form shape. */
  proposed?: unknown;
  /** Whether the current answer differs from the proposal. */
  changed: boolean;
  /** For a list: its items added, removed and edited against the proposal. */
  diff?: ListDiff;
  /** For a list scored per item: each item's tranche (null when confident or unscored). */
  itemTranches?: Array<ConfidenceTranche | null>;
  /** For a list of rows scored per cell: each row's cell tranches. */
  cellTranches?: Array<Record<string, ConfidenceTranche | null> | null>;
}

function asFormMap(
  source: unknown,
  formSchema: Record<string, unknown>,
): Record<string, unknown> {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  try {
    return mapPayloadToForm(source as Record<string, unknown>, formSchema);
  } catch {
    return {};
  }
}

/**
 * The review state of every field the spec covers: its score and tranche,
 * its proposal, and whether `values` (the live form, or a submitted payload
 * mapped back to form shape) differs from it. Proposals and scores are read
 * in payload shape and mapped through x-lt-bind, like formDefaults.
 */
export function buildFormReview(
  spec: ConfidenceSpec,
  formSchema: Record<string, unknown>,
  ctx: Record<string, unknown> | undefined,
  values: Record<string, unknown>,
): Record<string, FieldReview> {
  const props = (formSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const scores = asFormMap(resolveCtxPath(spec.scores, ctx), formSchema);
  const proposals = asFormMap(resolveCtxPath(spec.proposed, ctx), formSchema);
  const review: Record<string, FieldReview> = {};
  for (const [key, def] of Object.entries(props)) {
    if (def?.['x-lt-confidence'] === false || isDisplayOnlyField(def)) continue;
    const items = Array.isArray(scores[key]) ? readItemScores(scores[key] as unknown[], def, spec.tranches) : null;
    const raw = items ? items.score : scores[key];
    const score = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : undefined;
    const hasProposal = key in proposals;
    if (score === undefined && !hasProposal) continue;
    const tranche = score === undefined ? null : trancheFor(spec.tranches, score);
    const list = isListSchema(def) && hasProposal && (Array.isArray(proposals[key]) || Array.isArray(values[key]));
    const diff = list ? diffList(proposals[key], values[key], def) : undefined;
    review[key] = {
      ...(score !== undefined ? { score } : {}),
      ...(tranche ? { tranche } : {}),
      hasProposal,
      ...(hasProposal ? { proposed: proposals[key] } : {}),
      changed: hasProposal && (diff ? diff.changed : differsFromProposal(proposals[key], values[key], def)),
      ...(diff ? { diff } : {}),
      ...(items?.itemTranches ? { itemTranches: items.itemTranches } : {}),
      ...(items?.cellTranches ? { cellTranches: items.cellTranches } : {}),
    };
  }
  return review;
}

const clamp = (n: number) => Math.min(Math.max(n, 0), 1);
const isScore = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Per-item scores aligned with a list's value: a number scores a pill or a
 * row, an object of numbers scores a row's cells. The field's score is the
 * lowest one, so its tranche is the worst of its items. A column declared
 * `x-lt-confidence: false` is not scored.
 */
function readItemScores(
  raw: unknown[],
  def: Record<string, unknown>,
  tranches: readonly ConfidenceTranche[],
): { score?: number; itemTranches?: Array<ConfidenceTranche | null>; cellTranches?: Array<Record<string, ConfidenceTranche | null> | null> } {
  const columns = (itemSchemaOf(def)?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const all: number[] = [];
  const itemTranches: Array<ConfidenceTranche | null> = [];
  const cellTranches: Array<Record<string, ConfidenceTranche | null> | null> = [];
  let anyCells = false;
  for (const entry of raw) {
    if (isScore(entry)) {
      all.push(clamp(entry));
      itemTranches.push(trancheFor(tranches, clamp(entry)));
      cellTranches.push(null);
      continue;
    }
    const cells: Record<string, ConfidenceTranche | null> = {};
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      for (const [name, v] of Object.entries(entry as Record<string, unknown>)) {
        if (!isScore(v) || columns[name]?.['x-lt-confidence'] === false) continue;
        all.push(clamp(v));
        cells[name] = trancheFor(tranches, clamp(v));
        anyCells = true;
      }
    }
    const worst = Object.values(cells).filter((t): t is ConfidenceTranche => t !== null).sort((a, b) => a.below - b.below)[0];
    itemTranches.push(worst ?? null);
    cellTranches.push(Object.keys(cells).length > 0 ? cells : null);
  }
  return { ...(all.length > 0 ? { score: Math.min(...all) } : {}), itemTranches, ...(anyCells ? { cellTranches } : {}) };
}

export interface ReviewSummary {
  /** Field keys per tranche label, in tranche order. */
  tranches: Array<{ tranche: ConfidenceTranche; fields: string[] }>;
  /** Field keys whose answer differs from the proposal. */
  changed: string[];
  /** List items added, removed and edited across the shown fields. */
  itemsChanged: number;
}

/** Counts for the form's legend, over the fields actually shown, in their order. */
export function summarizeReview(
  spec: ConfidenceSpec,
  review: Record<string, FieldReview>,
  shownKeys: readonly string[],
): ReviewSummary {
  const tranches = spec.tranches.map((tranche) => ({ tranche, fields: [] as string[] }));
  const changed: string[] = [];
  let itemsChanged = 0;
  for (const key of shownKeys) {
    const field = review[key];
    if (!field) continue;
    if (field.tranche) tranches.find((t) => t.tranche.below === field.tranche!.below)?.fields.push(key);
    if (field.changed) changed.push(key);
    itemsChanged += field.diff?.itemsChanged ?? 0;
  }
  return { tranches, changed, itemsChanged };
}
