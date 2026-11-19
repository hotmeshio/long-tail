/**
 * A command's args against the JSON Schema its op declares (codec rowOps
 * `args`), checked with the same pass that checks a resolver form, by the
 * commands route and by the gateway before it sends.
 */

import { validateResolverForm } from '../../shared/form-validation';

/** Why `args` fail the op's declared schema; null when they pass or the op declares none. */
export function argsRefusal(op: string, schema: Record<string, unknown> | undefined, args: Record<string, unknown>): string | null {
  const errors = validateResolverForm(schema, args);
  if (!errors.length) return null;
  return `${op} args: ${errors.map((e) => `${e.field} ${e.message}`).join('; ')}`;
}
