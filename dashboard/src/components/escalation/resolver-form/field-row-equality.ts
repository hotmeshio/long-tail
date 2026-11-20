import type { ShowIfContext } from '../../../lib/x-lt-show-if';

type Schema = Record<string, any>;
interface RowProps {
  fieldKey: string;
  schema?: Schema | null;
  fieldSchema?: Schema;
  escalationContext?: ShowIfContext;
  [prop: string]: unknown;
}

const liveFormUse = new WeakMap<object, boolean>();

/** Whether a field's schema reads the live form (`resolver.*` or `input.*`), so its row must follow every edit. */
function usesLiveForm(fieldSchema: Schema | undefined): boolean {
  if (!fieldSchema) return true;
  let live = liveFormUse.get(fieldSchema);
  if (live === undefined) {
    const text = JSON.stringify(fieldSchema);
    live = text.includes('resolver.') || text.includes('input.') || text.includes('{{resolver') || text.includes('{{input');
    liveFormUse.set(fieldSchema, live);
  }
  return live;
}

function sameContext(a: ShowIfContext | undefined, b: ShowIfContext | undefined, live: boolean): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!live && (key === 'resolver' || key === 'input')) continue;
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false;
  }
  return true;
}

const SIMPLE_PROPS = ['fieldKey', 'value', 'onChange', 'onBlur', 'schema', 'fieldSchema', 'isRequired', 'isReadOnly', 'locked', 'error', 'submitAttempted'];

/** A row re-renders for its own value, schema, error and the context it reads, not for another field's edit. */
export function sameFieldRow(prev: RowProps, next: RowProps): boolean {
  if (SIMPLE_PROPS.some((k) => !Object.is(prev[k], next[k]))) return false;
  const fieldSchema = next.fieldSchema ?? (next.schema?.properties?.[next.fieldKey] as Schema | undefined);
  return sameContext(prev.escalationContext, next.escalationContext, usesLiveForm(fieldSchema));
}
