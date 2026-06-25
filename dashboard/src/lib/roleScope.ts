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

export const SCOPE_PRESETS: ScopePreset[] = [
  { value: 'all|all', label: 'Search & act on all', read_scope: 'all', write_scope: 'all' },
  { value: 'all|self', label: 'See all, act on own', read_scope: 'all', write_scope: 'self' },
  { value: 'self|self', label: 'Own items only', read_scope: 'self', write_scope: 'self' },
  { value: 'all|none', label: 'Read-only — whole queue', read_scope: 'all', write_scope: 'none' },
  { value: 'self|none', label: 'Read-only — own items', read_scope: 'self', write_scope: 'none' },
];

export const DEFAULT_SCOPE_VALUE = 'all|all';

export function scopeKey(read: LTReadScope, write: LTWriteScope): string {
  return `${read}|${write}`;
}

export function scopePreset(value: string): ScopePreset {
  return SCOPE_PRESETS.find((p) => p.value === value) ?? SCOPE_PRESETS[0];
}

/** Short label for a member's scope, e.g. "see all, act on own". Empty for admin tiers. */
export function scopeLabel(read: LTReadScope, write: LTWriteScope): string {
  return SCOPE_PRESETS.find((p) => p.read_scope === read && p.write_scope === write)?.label
    ?? `${read}/${write}`;
}
