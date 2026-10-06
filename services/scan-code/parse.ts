import { parseScanCode as parseShared, type ScanParseFailure } from '../../shared/scan-code';
import {
  SCAN_TEMPLATE_TOKENS,
  SCAN_TEMPLATE_BAGS,
  type ScanTemplateBag,
  type ParsedScanCode,
  type ScanScheme,
} from '../../types';

export type { ScanParseFailure };

export type ScanParseResult =
  | { ok: true; parsed: ParsedScanCode; scheme: ScanScheme }
  | { ok: false; failure: ScanParseFailure };

/** Parse a raw scan string against the configured schemes. Pure; see shared/scan-code. */
export function parseScanCode(raw: string, schemes: ScanScheme[]): ScanParseResult {
  return parseShared(raw, schemes);
}

export interface ScanTemplateContext {
  target: string;
  category: string;
  scannedAt: string;
  /** The code as scanned; defaults to the target. */
  code?: string;
  /** The acting user's single live claim, its metadata; absent when none or ambiguous. */
  claim?: Record<string, unknown>;
  /** The row the step located (item-mode accumulate, hold), its metadata. */
  item?: Record<string, unknown>;
  /** The held subject's row: its metadata plus `id`. */
  subject?: Record<string, unknown>;
  /** The container a subject step located, its metadata. */
  container?: Record<string, unknown>;
  /** The batch a fill step read: `pending`, `total`, `filled`. */
  fill?: Record<string, unknown>;
}

/** A bag token the context cannot resolve. */
export class ScanTemplateError extends Error {
  constructor(readonly token: string, readonly reason: string) {
    super(`scan template ${token}: ${reason}`);
    this.name = 'ScanTemplateError';
  }
}

const BAG_TOKEN = /\{(claim|item|subject|container|fill)\.([a-zA-Z0-9_]+)\}/g;

const MISSING_BAG: Record<ScanTemplateBag, string> = {
  claim: 'the actor holds no single live claim',
  item: 'no located item row on this step',
  subject: 'no subject is held',
  container: 'no container was located',
  fill: 'no batch was read',
};

/** True when any string in the params mentions a `{claim.…}` token. */
export function mentionsClaimToken(value: unknown): boolean {
  return JSON.stringify(value ?? null).includes(`{${SCAN_TEMPLATE_BAGS.CLAIM}.`);
}

function resolveBagToken(ctx: ScanTemplateContext, bag: ScanTemplateBag, facet: string, token: string): string {
  const source = ctx[bag];
  if (!source) throw new ScanTemplateError(token, MISSING_BAG[bag]);
  const v = source[facet];
  if (v === undefined || v === null || v === '') {
    throw new ScanTemplateError(token, `facet ${facet} is absent`);
  }
  if (Array.isArray(v)) return v.join(', ');
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/**
 * Replace the template tokens inside string values of a params object.
 * Deep, pure, non-mutating. The scan tokens are plain text replacement; the
 * bag tokens (`{claim.x}`, `{item.x}`, `{subject.x}`, `{container.x}`,
 * `{fill.x}`) read the context's facet bags and throw
 * {@link ScanTemplateError} when they cannot resolve, so a literal token
 * never reaches a row. No expression language.
 */
export function interpolateScanTemplate<T>(value: T, ctx: ScanTemplateContext): T {
  if (typeof value === 'string') {
    const scanned = value
      .split(SCAN_TEMPLATE_TOKENS.TARGET).join(ctx.target)
      .split(SCAN_TEMPLATE_TOKENS.CATEGORY).join(ctx.category)
      .split(SCAN_TEMPLATE_TOKENS.SCANNED_AT).join(ctx.scannedAt)
      .split(SCAN_TEMPLATE_TOKENS.CODE).join(ctx.code ?? ctx.target);
    return scanned.replace(BAG_TOKEN, (token, bag: ScanTemplateBag, facet: string) =>
      resolveBagToken(ctx, bag, facet, token)) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolateScanTemplate(v, ctx)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = interpolateScanTemplate(v, ctx);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Render refusal copy, degrading instead of failing: a token with nothing to
 * read becomes an empty string, so a refusal always has words to show.
 */
export function renderScanCopy(markdown: string, ctx: ScanTemplateContext): string {
  try {
    return interpolateScanTemplate(markdown, ctx);
  } catch {
    const safe = markdown.replace(BAG_TOKEN, (token, bag: ScanTemplateBag, facet: string) => {
      try {
        return resolveBagToken(ctx, bag, facet, token);
      } catch {
        return '';
      }
    });
    return interpolateScanTemplate(safe, ctx);
  }
}
