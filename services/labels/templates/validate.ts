// Template validation against its scheme, its rules and the identity keys.

import { LABEL_SYMBOLOGIES, LABEL_TONES } from '../../../shared/labels/types';
import { isMintableScheme } from '../../../shared/labels/compose';
import { unknownLabelTokens, userTokenKeys, listLabelTokens } from '../../../shared/labels/tokens';
import { SCAN_SCHEME_KINDS, type ScanRule, type ScanScheme } from '../../../types';
import type { LabelTemplateInput } from '../../../types/labels';

/** A template declaration that cannot be stored. */
export class LabelTemplateValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'LabelTemplateValidationError';
  }
}

export const MAX_TEMPLATE_CODES = 4;
export const MAX_TEMPLATE_LINES = 2;
const MAX_TEXT_LENGTH = 160;
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

function fail(message: string): never {
  throw new LabelTemplateValidationError(message);
}

function assertText(label: string, text: unknown): void {
  if (typeof text !== 'string') fail(`${label} must be text`);
  if (text.length > MAX_TEXT_LENGTH) fail(`${label} is longer than ${MAX_TEXT_LENGTH} characters`);
}

export interface TemplateContext {
  scheme: ScanScheme | null;
  rules: ScanRule[];
  /** Every identity key in use, so a token can never print a credential as text. */
  identityKeys: string[];
  /** Media preset ids the deployment knows. */
  mediaIds: string[];
}

/** Throws LabelTemplateValidationError unless the template fits its scheme. */
export function assertValidTemplate(input: LabelTemplateInput, ctx: TemplateContext): void {
  if (typeof input.name !== 'string' || !NAME.test(input.name)) {
    fail('name must be lowercase letters, digits and dashes, starting with a letter or digit');
  }
  const { scheme } = ctx;
  if (!scheme) fail(`scan scheme ${input.scheme_version} does not exist`);
  if (!isMintableScheme(scheme)) {
    fail(`scheme ${scheme.version} reads ${scheme.encoding} codes; templates print fixed and delimited codes only`);
  }
  if (!input.title || typeof input.title !== 'string') fail('title is required');
  assertText('title', input.title);
  if (input.description != null) assertText('description', input.description);

  if (!Array.isArray(input.codes) || input.codes.length < 1 || input.codes.length > MAX_TEMPLATE_CODES) {
    fail(`a template prints 1 to ${MAX_TEMPLATE_CODES} codes`);
  }
  const categories = new Set<string>();
  for (const code of input.codes) {
    if (!ctx.rules.some((r) => r.category === code.category)) {
      fail(`scheme ${scheme.version} has no rule for category "${code.category}"`);
    }
    if (categories.has(code.category)) fail(`category "${code.category}" is printed twice`);
    categories.add(code.category);
    if (!(LABEL_TONES as readonly string[]).includes(code.tone)) fail(`tone must be one of ${LABEL_TONES.join(', ')}`);
    if (code.caption != null) assertText('caption', code.caption);
  }

  const lines = input.text?.lines ?? [];
  if (!Array.isArray(lines) || lines.length > MAX_TEMPLATE_LINES) fail(`a template prints up to ${MAX_TEMPLATE_LINES} lines`);
  const texts = [input.text?.title ?? '', ...lines, ...input.codes.map((c) => c.caption ?? '')];
  texts.forEach((t, i) => assertText(i === 0 ? 'text title' : 'text line', t));

  const identity = scheme.kind === SCAN_SCHEME_KINDS.IDENTITY;
  for (const text of texts) {
    const unknown = unknownLabelTokens(text);
    if (unknown.length) fail(`unknown token {${unknown[0]}}; use {target}, {item.<facet>}, {user.<key>} or {scheme.name}`);
    const tokens = listLabelTokens(text);
    if (identity && tokens.some((t) => t.startsWith('item.'))) fail('an identity template reads {user.<key>} tokens, not {item.<facet>}');
    if (!identity && tokens.some((t) => t.startsWith('user.'))) fail('{user.<key>} tokens print on identity templates only');
    const credential = userTokenKeys(text).find((k) => ctx.identityKeys.includes(k) || k === scheme.target_facet);
    if (credential) fail(`{user.${credential}} is an identity credential and never prints as text`);
    if (identity && tokens.includes('target')) fail('{target} on an identity template is the credential; it never prints as text');
  }

  const symbology = input.symbology ?? 'code128';
  if (!(LABEL_SYMBOLOGIES as readonly string[]).includes(symbology)) {
    fail(`symbology must be one of ${LABEL_SYMBOLOGIES.join(', ')}`);
  }
  if (input.media != null && !ctx.mediaIds.includes(input.media)) fail(`unknown media "${input.media}"`);
  if (identity && input.sensitive === false) fail('a template on an identity scheme is always sensitive');
}
