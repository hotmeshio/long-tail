import type { LTReadScope, LTWriteScope } from '../api/types';

// The work-surface scope a `member` carries, presented as named grants. Each
// preset is a point in the (read, write) lattice (write ⊆ read). admin/superadmin
// always act on all and never show a scope picker.
export interface ScopePreset {
  value: string; // `${read}|${write}`
  label: string;
  read_scope: LTReadScope;
  write_scope: LTWriteScope;
}

// Labels are parallel and structured around the two axes (see / act) so the
// difference between profiles is scannable, not a run-on sentence.
export const SCOPE_PRESETS: ScopePreset[] = [
  { value: 'all|all', label: 'See all · act on all', read_scope: 'all', write_scope: 'all' },
  { value: 'all|self', label: 'See all · act on self', read_scope: 'all', write_scope: 'self' },
  { value: 'self|self', label: 'See self · act on self', read_scope: 'self', write_scope: 'self' },
  { value: 'all|none', label: 'See all · read-only', read_scope: 'all', write_scope: 'none' },
  { value: 'self|none', label: 'See self · read-only', read_scope: 'self', write_scope: 'none' },
];

export const DEFAULT_SCOPE_VALUE = 'all|all';

export function scopeKey(read: LTReadScope, write: LTWriteScope): string {
  return `${read}|${write}`;
}

export function scopePreset(value: string): ScopePreset {
  return SCOPE_PRESETS.find((p) => p.value === value) ?? SCOPE_PRESETS[0];
}
