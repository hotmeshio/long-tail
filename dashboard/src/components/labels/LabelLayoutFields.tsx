import { SelectField, TextField } from '../common/form/Field';
import type { LabelLayout } from '../../api/labels';
import type { LabelMedia } from '../../../../shared/labels/types';

/** Media, start position on a partly used sheet, copies, and page options. */
export function LabelLayoutFields({ media, value, onChange }: {
  media: LabelMedia[];
  value: LabelLayout;
  onChange: (next: LabelLayout) => void;
}) {
  const chosen = media.find((m) => m.id === value.media);
  const slots = chosen ? chosen.columns * chosen.rows : 1;
  return (
    <div className="space-y-3">
      <SelectField
        label="Media"
        hint="The label stock or thermal roll in the printer."
        value={value.media ?? ''}
        options={media.map((m) => ({ value: m.id, label: m.name }))}
        onChange={(e) => onChange({ ...value, media: e.target.value, startPosition: 1 })}
      />
      <div className="grid gap-3 grid-cols-2">
        <TextField
          label="Start at label"
          hint={slots > 1 ? `Skips used labels on the first sheet (1 to ${slots}).` : 'One label per page on this media.'}
          type="number"
          min={1}
          max={slots}
          disabled={slots === 1}
          value={value.startPosition ?? 1}
          onChange={(e) => onChange({ ...value, startPosition: Number(e.target.value) })}
        />
        <TextField
          label="Copies"
          hint="Of each label, printed together."
          type="number"
          min={1}
          max={50}
          value={value.copies ?? 1}
          onChange={(e) => onChange({ ...value, copies: Number(e.target.value) })}
        />
      </div>
      {chosen?.family === 'sheet' && (
        <div className="grid gap-3 grid-cols-2">
          <SelectField
            label="Per page"
            value={value.onePerPage ? 'one' : 'fill'}
            options={[{ value: 'fill', label: 'Fill each sheet' }, { value: 'one', label: 'One label per page' }]}
            onChange={(e) => onChange({ ...value, onePerPage: e.target.value === 'one' })}
          />
          <SelectField
            label="Cut marks"
            hint="For card stock you trim by hand."
            value={value.cutMarks ? 'yes' : 'no'}
            options={[{ value: 'no', label: 'None' }, { value: 'yes', label: 'Print cut marks' }]}
            onChange={(e) => onChange({ ...value, cutMarks: e.target.value === 'yes' })}
          />
        </div>
      )}
    </div>
  );
}
