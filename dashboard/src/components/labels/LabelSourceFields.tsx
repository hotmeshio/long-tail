import { SelectField, TextArea, TextField } from '../common/form/Field';
import type { LabelSource } from '../../api/labels';

export type EditableSource = Extract<LabelSource, { kind: 'list' | 'range' }>;

export const DEFAULT_RANGE: EditableSource = { kind: 'range', prefix: '', from: 1, to: 10, pad: 0 };

/** A pasted list or a numeric range: the targets an admin types. */
export function LabelSourceFields({ value, onChange }: { value: EditableSource; onChange: (next: EditableSource) => void }) {
  return (
    <div className="space-y-3">
      <SelectField
        label="Targets"
        hint="A range numbers targets in sequence; a list can carry a column per text token."
        value={value.kind}
        options={[{ value: 'range', label: 'A numbered range' }, { value: 'list', label: 'A pasted list' }]}
        onChange={(e) => onChange(e.target.value === 'list' ? { kind: 'list', text: '' } : DEFAULT_RANGE)}
      />
      {value.kind === 'range' ? (
        <div className="grid gap-3 grid-cols-2 @form-cols:grid-cols-4">
          <TextField label="Prefix" value={value.prefix ?? ''} onChange={(e) => onChange({ ...value, prefix: e.target.value })} placeholder="A-" />
          <TextField label="From" type="number" min={0} value={value.from} onChange={(e) => onChange({ ...value, from: Number(e.target.value) })} />
          <TextField label="To" type="number" min={0} value={value.to} onChange={(e) => onChange({ ...value, to: Number(e.target.value) })} />
          <TextField label="Digits" hint="Pads with zeros: 2 prints 01." type="number" min={0} max={12} value={value.pad ?? 0} onChange={(e) => onChange({ ...value, pad: Number(e.target.value) })} />
        </div>
      ) : (
        <TextArea
          label="List"
          hint='One target per line. Start with a header such as "target,subtitle" to fill {item.subtitle}.'
          rows={6}
          value={value.text}
          onChange={(e) => onChange({ kind: 'list', text: e.target.value })}
        />
      )}
    </div>
  );
}
