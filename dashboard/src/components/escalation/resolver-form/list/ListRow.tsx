import type { FieldControlProps } from '../field-control-props';
import type { JsonValue } from '../form-cells';
import type { ResolvedOption } from '../../../../lib/x-lt-options';
import type { ListControl } from '../../../../lib/x-lt-list';
import { MultiSelectField } from '../MultiSelectField';
import { PillsField } from './PillsField';
import { RowsField } from './RowsField';

/** The editable control for a list field, chosen by `listControlOf`. */
export function ListRow({ control, options, value, fieldSchema, context, locked, props }: {
  control: Exclude<ListControl, 'json'>;
  options?: ResolvedOption[];
  value: JsonValue;
  fieldSchema: Record<string, any> | undefined;
  context?: Record<string, unknown>;
  locked?: boolean;
  props: FieldControlProps;
}) {
  if (control === 'chips') return <MultiSelectField {...props} value={value} options={options ?? []} />;
  if (control === 'rows') return <RowsField {...props} value={value} fieldSchema={fieldSchema} context={context} locked={locked} />;
  return <PillsField {...props} value={value} fieldSchema={fieldSchema} options={control === 'picker' ? options ?? [] : undefined} context={context} locked={locked} />;
}
