/**
 * x-lt-invoke: start a workflow from inside a form. A display-only field
 * declares the target workflow and how the form's context maps into the
 * invoke payload:
 *
 *   "x-lt-widget": "invoke",
 *   "x-lt-invoke": {
 *     "workflow": "printPamphlet",
 *     "data": { "order": { "id": "{{metadata.orderId}}" }, "copies": 1 },
 *     "metadata": { "escalationId": "{{escalation.id}}" },
 *     "modal": true,
 *     "confirm": "Print a pamphlet for {{metadata.orderId}}?",
 *     "variant": "link",
 *     "icon": true
 *   }
 *
 * `data` is the nested payload the invoke API receives. In direct mode it is
 * posted as resolved; in modal mode it prefills the workflow's own input form
 * through the x-lt-bind inversion. One declaration serves both.
 *
 * Interpolation keeps types: a leaf that is exactly one `{{domain.path}}`
 * token becomes the raw context value (a number stays a number); a leaf that
 * mixes text and tokens becomes a string; a token with no value drops its key
 * so the target's own defaults apply. Objects and arrays recurse; every other
 * leaf passes through unchanged.
 */
import { DISPLAY_ONLY_WIDGET_NAMES } from './display-only-widgets';
import { hasInterpolation, interpolatePath, resolveCtxPath } from './ctx-path';

export const X_LT_INVOKE = 'x-lt-invoke';
export const INVOKE_WIDGET = DISPLAY_ONLY_WIDGET_NAMES.INVOKE;

export const INVOKE_VARIANTS = {
  LINK: 'link',
  BUTTON: 'button',
} as const;
export type InvokeVariant = (typeof INVOKE_VARIANTS)[keyof typeof INVOKE_VARIANTS];

export interface InvokeConfig {
  /** The workflow_type to start. */
  workflow: string;
  /** Nested invoke `data` template; leaves interpolate against the context. */
  data: Record<string, unknown>;
  /** Extra run metadata template, merged over the workflow's declared metadata. */
  metadata: Record<string, unknown>;
  /** Open the workflow's input form prefilled instead of posting directly. */
  modal: boolean;
  /** Direct mode only: a prompt to confirm before posting; tokens interpolate. */
  confirm: string | null;
  variant: InvokeVariant;
  /** Lead the label with the workflow's registered icon. */
  icon: boolean;
}

export interface InvokePayload {
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

type Ctx = Record<string, unknown> | null | undefined;

const WHOLE_TOKEN_PATTERN = /^\{\{\s*([^{}]+?)\s*\}\}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isVariant(value: unknown): value is InvokeVariant {
  return value === INVOKE_VARIANTS.LINK || value === INVOKE_VARIANTS.BUTTON;
}

/** The field's invoke declaration, or null when it names no workflow. */
export function readInvokeConfig(
  fieldSchema: Record<string, unknown> | null | undefined,
): InvokeConfig | null {
  const raw = fieldSchema?.[X_LT_INVOKE];
  if (!isPlainObject(raw)) return null;
  const workflow = raw.workflow;
  if (typeof workflow !== 'string' || workflow.trim().length === 0) return null;
  const confirm = raw.confirm;
  return {
    workflow: workflow.trim(),
    data: isPlainObject(raw.data) ? raw.data : {},
    metadata: isPlainObject(raw.metadata) ? raw.metadata : {},
    modal: raw.modal === true,
    confirm: typeof confirm === 'string' && confirm.trim().length > 0 ? confirm : null,
    variant: isVariant(raw.variant) ? raw.variant : INVOKE_VARIANTS.LINK,
    icon: raw.icon !== false,
  };
}

/**
 * Resolve one template value against the context, keeping the type of a
 * whole-token leaf. Returns undefined for a token with no value so the
 * caller omits the key.
 */
export function interpolateInvokeValue(value: unknown, ctx: Ctx): unknown {
  if (typeof value === 'string') {
    const whole = WHOLE_TOKEN_PATTERN.exec(value);
    if (whole) {
      const resolved = resolveCtxPath(whole[1], ctx ?? undefined);
      return resolved === null ? undefined : resolved;
    }
    if (hasInterpolation(value)) return interpolatePath(value, ctx ?? undefined) ?? undefined;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolateInvokeValue(v, ctx)).filter((v) => v !== undefined);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      const resolved = interpolateInvokeValue(v, ctx);
      if (resolved !== undefined) out[key] = resolved;
    }
    return out;
  }
  return value;
}

/** The invoke payload for one context: `data` and `metadata` fully resolved. */
export function resolveInvokePayload(config: InvokeConfig, ctx: Ctx): InvokePayload {
  return {
    data: interpolateInvokeValue(config.data, ctx) as Record<string, unknown>,
    metadata: interpolateInvokeValue(config.metadata, ctx) as Record<string, unknown>,
  };
}
