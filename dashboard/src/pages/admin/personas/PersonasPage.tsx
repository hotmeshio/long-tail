import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Pencil } from 'lucide-react';
import { usePersonas } from '../../../api/personas';
import type { LTPersonaRecord } from '../../../api/types';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { RolePill } from '../../../components/common/display/RolePill';
import { CreatePersonaModal } from './CreatePersonaModal';
import { AssigneesPanel } from './AssigneesPanel';

// ── Grid columns ──────────────────────────────────────────────────────────────
// PERSONA(title, 180px) | KEY(140px) | DESCRIPTION(1fr) | ROLES(220px) | USERS(56px) | CONFIGURE(40px)
// Mirrors the Roles list: display title leads, exact key is the secondary
// field, the bundle's role pills preview on the right. Clicking a row selects
// it for the Assignees panel (the 90% path); the pencil opens configuration.
const GRID = '180px 140px 1fr 220px 56px 40px';

const CELL_TEXT = 'text-text-secondary transition-colors group-hover/row:text-text-primary';
const HDR = 'text-2xs font-semibold uppercase tracking-widest text-text-quaternary';
const CELL_PY = 'py-2';
const ROW_PY = 'py-2.5';

/** Title Case fallback derived from the key, same convention as roles. */
function displayPersonaTitle(p: LTPersonaRecord): string {
  if (p.title) return p.title;
  return p.key.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function TableHead() {
  return (
    <div
      className="grid gap-4 px-3 border-b border-surface-border bg-surface"
      style={{ gridTemplateColumns: GRID }}
    >
      <span className={`${HDR} ${CELL_PY} flex items-center`}>Persona</span>
      <span className={`${HDR} ${CELL_PY} flex items-center`}>Key</span>
      <span className={`${HDR} ${CELL_PY} flex items-center`}>Description</span>
      <span className={`${HDR} ${CELL_PY} flex items-center`}>Roles</span>
      <span className={`${HDR} ${CELL_PY} flex items-center justify-end`}>Users</span>
      <span className={CELL_PY} />
    </div>
  );
}

const ROLE_PREVIEW_LIMIT = 3;

function PersonaRow({ persona, active, onClick, onConfigure }: {
  persona: LTPersonaRecord;
  active: boolean;
  onClick: () => void;
  onConfigure: () => void;
}) {
  const roles = persona.roles ?? [];
  const preview = roles.slice(0, ROLE_PREVIEW_LIMIT);
  const overflow = roles.length - preview.length;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      className={`grid gap-4 px-3 cursor-pointer group/row transition-colors ${active ? 'bg-surface-hover/60' : 'hover:bg-surface-hover/30'}`}
      style={{ gridTemplateColumns: GRID }}
    >
      <span className={`flex items-center min-w-0 text-sm truncate ${ROW_PY} ${CELL_TEXT}`}>
        {displayPersonaTitle(persona)}
      </span>

      <span className={`flex items-center text-xs font-mono truncate ${ROW_PY} text-text-tertiary transition-colors group-hover/row:text-text-secondary`}>
        {persona.key}
      </span>

      <span className={`flex items-center min-w-0 text-xs text-text-tertiary truncate ${ROW_PY} transition-colors group-hover/row:text-text-secondary`}>
        {persona.description ?? ''}
      </span>

      <div className={`flex items-center flex-wrap gap-x-2.5 gap-y-0.5 min-w-0 ${ROW_PY}`}>
        {preview.map((r) => (
          <span key={r.role} className="min-w-0 truncate text-text-secondary">
            <RolePill role={r.role} tone="inherit" />
          </span>
        ))}
        {overflow > 0 && (
          <span className="text-2xs text-text-quaternary tabular-nums">+{overflow}</span>
        )}
      </div>

      <span className={`flex items-center justify-end text-sm tabular-nums ${ROW_PY} transition-colors ${CELL_TEXT}`}>
        {persona.user_count > 0 ? persona.user_count : ''}
      </span>

      <span className={`flex items-center justify-end ${ROW_PY}`}>
        <button
          onClick={(e) => { e.stopPropagation(); onConfigure(); }}
          className="text-text-quaternary/70 hover:text-accent transition-colors"
          title={`Configure ${displayPersonaTitle(persona)}`}
          aria-label={`Configure ${displayPersonaTitle(persona)}`}
        >
          <Pencil className="w-3.5 h-3.5" strokeWidth={1.5} />
        </button>
      </span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function PersonasPage() {
  const navigate = useNavigate();
  const { data, isLoading } = usePersonas();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const personas = data?.personas ?? [];

  const filtered = useMemo(() => {
    const sorted = [...personas].sort((a, b) =>
      displayPersonaTitle(a).localeCompare(displayPersonaTitle(b)),
    );
    if (!search.trim()) return sorted;
    const q = search.toLowerCase();
    return sorted.filter(
      (p) =>
        p.key.toLowerCase().includes(q) ||
        displayPersonaTitle(p).toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.roles?.some((r) => r.role.toLowerCase().includes(q)),
    );
  }, [personas, search]);

  return (
    <div>
      <PageHeader
        title="Personas"
        docsHash="#docs:dashboard.md:personas"
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary text-xs flex items-center gap-1.5"
          >
            + Add Persona
          </button>
        }
      />

      {/* Table left, Assignees right — the same split as Accounts. Selecting a
          row targets the panel; the row pencil opens the persona's config. */}
      <div className="grid grid-cols-1 @split:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="overflow-x-clip">
          {!isLoading && personas.length > 0 && (
            <div className="sticky top-0 z-20 bg-surface pt-3">
              <div className="bg-surface-sunken rounded-lg px-5 py-3 mb-3 flex items-center gap-3">
                <Search className="w-3 h-3 text-text-quaternary shrink-0" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${personas.length} personas…`}
                  className="input w-56"
                />
                {search && filtered.length !== personas.length && (
                  <span className="text-2xs text-text-quaternary tabular-nums shrink-0">
                    {filtered.length} of {personas.length}
                  </span>
                )}
              </div>
              {filtered.length > 0 && <TableHead />}
            </div>
          )}

          {isLoading ? (
            <div className="animate-pulse space-y-3 mt-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-surface-sunken rounded w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-text-tertiary mt-8">
              {search
                ? 'Clear the search to see all personas.'
                : 'Create a persona to bundle roles into a one-step assignment.'}
            </p>
          ) : (
            <div className="divide-y divide-surface-border/30">
              {filtered.map((persona) => (
                <PersonaRow
                  key={persona.key}
                  persona={persona}
                  active={persona.key === selectedKey}
                  onClick={() => setSelectedKey(persona.key)}
                  onConfigure={() => navigate(`/admin/personas/${encodeURIComponent(persona.key)}`)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="sticky top-4">
          <AssigneesPanel personaKey={selectedKey} />
        </div>
      </div>

      <CreatePersonaModal open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
