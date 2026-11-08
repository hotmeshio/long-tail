import { SelectField } from '../common/form/Field';
import { useRoles } from '../../api/roles';
import type { LabelSource } from '../../api/labels';

export type UserSource = Extract<LabelSource, { kind: 'users' }>;

/** Whose badges print when no one is selected: every badge holder, or every holder in one role. */
export function BadgeSourceFields({ value, onChange }: { value: UserSource; onChange: (next: UserSource) => void }) {
  const { data } = useRoles();
  return (
    <div className="space-y-3">
      <SelectField
        label="Badges for"
        hint="Users without a badge are left out; up to 200 badges print per job."
        value={value.role === undefined ? 'all' : 'role'}
        options={[{ value: 'all', label: 'Everyone with a badge' }, { value: 'role', label: 'Everyone in a role' }]}
        onChange={(e) => onChange(e.target.value === 'role' ? { kind: 'users', role: '' } : { kind: 'users' })}
      />
      {value.role !== undefined && (
        <SelectField
          label="Role"
          value={value.role}
          placeholder="Choose…"
          options={(data?.roles ?? []).map((r) => ({ value: r, label: r }))}
          onChange={(e) => onChange({ kind: 'users', role: e.target.value })}
        />
      )}
    </div>
  );
}
