import type { RoleDetail } from '../../../api/roles';

// ── Shared helpers for the role detail page and its sections ─────────────────

export function safePrettyPrint(value: unknown): string {
  if (value == null) return '';
  return JSON.stringify(value, null, 2);
}

export function safeParseJson(text: string): { ok: boolean; value?: Record<string, unknown> } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: undefined };
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) return { ok: false };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false };
  }
}

// Mirrors the server-side facet key rule (metadata keys are interpolated as a
// JSON path, so they are strictly validated).
export const FACET_KEY = /^[a-zA-Z0-9_]+$/;

// ── Kiosk flag — the reserved `kiosk` key in the role's properties bag ────────
// The draft keeps properties as a JSON string; these read/flip the one key
// without disturbing the rest of the bag.

export function readKioskFlag(properties: string): boolean {
  const parsed = safeParseJson(properties);
  return parsed.ok && parsed.value?.kiosk === true;
}

/** Flip the kiosk key; returns the updated JSON string, or null when the bag
 *  is unparseable (leave it untouched rather than destroy user data). */
export function toggleKioskFlag(properties: string): string | null {
  const parsed = safeParseJson(properties);
  if (!parsed.ok) return null;
  const bag: Record<string, unknown> = { ...(parsed.value ?? {}) };
  if (bag.kiosk === true) delete bag.kiosk;
  else bag.kiosk = true;
  return JSON.stringify(bag, null, 2);
}

// ── Draft state — one draft across every section; the shell owns it ──────────

export interface Draft {
  title: string;
  description: string;
  ops_visible: boolean;
  ops_home_default: boolean;
  enforce_schema: boolean;
  parent_role: string;
  metadata_schema: string;
  properties: string;
  sla_minutes: string;
  target_per_hour: string;
  worker_count: string;
  priority_threshold_minutes: string;
  priority_facet: string;
  entity_facet: string;
  entity_state_source: 'role' | 'subtype';
}

export interface DraftErrors {
  metadata_schema?: string;
  properties?: string;
  priority_facet?: string;
  entity_facet?: string;
}

export const EMPTY_DRAFT: Draft = {
  title: '', description: '', ops_visible: false, ops_home_default: false, enforce_schema: false, parent_role: '',
  metadata_schema: '', properties: '{}',
  sla_minutes: '', target_per_hour: '', worker_count: '',
  priority_threshold_minutes: '', priority_facet: '', entity_facet: '', entity_state_source: 'role',
};

export function draftFrom(role: RoleDetail): Draft {
  return {
    title: role.title ?? '',
    description: role.description ?? '',
    ops_visible: role.ops_visible,
    ops_home_default: role.ops_home_default,
    enforce_schema: role.enforce_schema,
    parent_role: role.parent_role ?? '',
    metadata_schema: safePrettyPrint(role.metadata_schema),
    properties: safePrettyPrint(role.properties) || '{}',
    sla_minutes: role.sla_minutes != null ? String(role.sla_minutes) : '',
    target_per_hour: role.target_per_hour != null ? String(role.target_per_hour) : '',
    worker_count: role.worker_count != null ? String(role.worker_count) : '',
    priority_threshold_minutes: role.priority_threshold_minutes != null ? String(role.priority_threshold_minutes) : '',
    priority_facet: role.priority_facet ?? '',
    entity_facet: role.entity_facet ?? '',
    entity_state_source: role.entity_state_source ?? 'role',
  };
}

/** Props every draft-backed section receives from the shell. */
export interface SectionProps {
  role: RoleDetail;
  draft: Draft;
  update: (changes: Partial<Draft>) => void;
  errors: DraftErrors;
}

// ── Section group — eyebrow (icon + tiny title + annotation) over a left-ruled
//    body. The page's single grouping treatment; fields inside a group use plain
//    form-field labels, never a second heading tier. ──────────────────────────

export function SectionGroup({
  icon: Icon,
  label,
  annotation,
  aside,
  accent = false,
  children,
}: {
  icon: React.ElementType;
  label: string;
  annotation?: string;
  aside?: React.ReactNode;
  accent?: boolean;
  children: React.ReactNode;
}) {
  const hue = accent ? 'text-accent' : 'text-text-tertiary';
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon className={`w-3 h-3 ${hue} shrink-0`} strokeWidth={1.5} />
          <span className={`text-2xs font-semibold uppercase tracking-widest ${hue}`}>{label}</span>
          {annotation && (
            <span className="text-2xs text-text-quaternary truncate">— {annotation}</span>
          )}
        </div>
        {aside}
      </div>
      <div className={`border-l-2 pl-5 ${accent ? 'border-accent/15' : 'border-surface-border/60'}`}>
        {children}
      </div>
    </div>
  );
}

/** Live-save indicator shown in a group's eyebrow. */
export function LiveBadge() {
  return (
    <div className="flex items-center gap-1">
      <span className="w-2.5 h-2.5 rounded-full dot-ring bg-status-success" />
      <span className="text-2xs font-semibold uppercase tracking-widest text-status-success">Live</span>
    </div>
  );
}

/** The page's one switch treatment — identical markup everywhere it appears. */
export function Toggle({
  checked,
  onChange,
  title,
}: {
  checked: boolean;
  onChange: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onChange}
      title={title}
      className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
        checked ? 'bg-accent' : 'bg-surface-border'
      }`}
    >
      <span
        className={`absolute top-[3px] left-0 w-3.5 h-3.5 rounded-full bg-text-inverse transition-transform shadow ${
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}

/**
 * Where chosen pills land — no enclosing box. Empty, it shows the instruction
 * (which doubles as the hint); filled, it shows the pills and drops the text.
 * The instruction is sized to occupy about the same height a pill row would, so
 * the control barely changes size as items come and go.
 */
export function PillWell({ items, empty, onRemove }: { items: string[]; empty: string; onRemove: (item: string) => void }) {
  if (items.length === 0) {
    return <p className="text-2xs text-text-tertiary leading-relaxed">{empty}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-2xs bg-accent/10 rounded-sm font-mono text-accent"
        >
          {item}
          <button
            onClick={() => onRemove(item)}
            className="text-accent/50 hover:text-status-error transition-colors leading-none ml-0.5"
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
